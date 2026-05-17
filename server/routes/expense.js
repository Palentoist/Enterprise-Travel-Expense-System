const express = require('express')
const { body, validationResult } = require('express-validator')
const ExpenseClaim = require('../models/ExpenseClaim')
const TravelRequest = require('../models/TravelRequest')
const Notification = require('../models/Notification')
const { auth, authorize } = require('../middleware/auth')
const upload = require('../utils/multer')
const { Parser } = require('json2csv')
const AuditLog = require('../models/AuditLog')
const sendEmail = require('../utils/sendEmail')
const User = require('../models/User')
const dayjs = require('dayjs')

const router = express.Router()

// Create expense claim
router.post(
  '/',
  auth,
  (req, res, next) => {
    if (req.user.role !== 'Employee' && req.user.role !== 'Manager') {
      return res.status(403).json({ message: 'Only employees or managers can submit expense claims' })
    }
    next()
  },
  [
    body('travelRequest').notEmpty().withMessage('Travel request is required'),
    body('amount').isNumeric().withMessage('Valid amount is required'),
    body('description').notEmpty().withMessage('Description is required'),
    body('expenseDate').isISO8601().withMessage('Valid expense date is required'),
    body('category').notEmpty().withMessage('Category is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

      const travelRequest = await TravelRequest.findById(Number(req.body.travelRequest))
      if (!travelRequest || travelRequest.status !== 'Approved') {
        return res.status(400).json({ message: 'Invalid or unapproved travel request' })
      }

      const expenseDate = dayjs(req.body.expenseDate).startOf('day')
      const travelStart = dayjs(travelRequest.startDate).startOf('day')
      const travelEnd = dayjs(travelRequest.endDate).startOf('day')
      if (expenseDate.isBefore(travelStart) || expenseDate.isAfter(travelEnd)) {
        return res.status(400).json({ message: `Expense date must be within the travel period: ${travelStart.format('DD-MM-YYYY')} to ${travelEnd.format('DD-MM-YYYY')}` })
      }

      const expenseClaim = await ExpenseClaim.create({
        ...req.body,
        employee: req.user.id,
      })

      const io = req.app.get('io')
      const connectedUsers = req.app.get('connectedUsers')
      const employee = expenseClaim.employee

      if (employee.manager) {
        const managerUser = await User.findById(employee.manager.id)
        if (managerUser && managerUser.isActive) {
          const notif = await Notification.create({
            recipient: managerUser.id,
            title: `New Expense Claim Submitted`,
            message: `${employee.firstName} ${employee.lastName} submitted an expense claim of $${expenseClaim.amount} for ${expenseClaim.travelRequest.destination}.`,
            type: 'expense_submitted',
            relatedId: expenseClaim.id,
            relatedModel: 'ExpenseClaim',
          })
          const socketId = connectedUsers[String(managerUser.id)]
          if (socketId) io.to(socketId).emit('notification', notif)
        }
      }

      const admins = await User.find({ role: 'Admin', isActive: true })
      if (admins.length > 0) {
        const adminNotifs = await Notification.insertMany(admins.map(admin => ({
          recipient: admin.id,
          title: `Expense Claim Submitted`,
          message: `${employee.firstName} ${employee.lastName} submitted an expense claim of $${expenseClaim.amount} for ${expenseClaim.travelRequest.destination}.`,
          type: 'expense_submitted',
          relatedId: expenseClaim.id,
          relatedModel: 'ExpenseClaim',
        })))
        admins.forEach((admin, i) => {
          const socketId = connectedUsers[String(admin.id)]
          if (socketId) io.to(socketId).emit('notification', adminNotifs[i])
        })
      }

      const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
      sendEmail({
        to: employee.email,
        subject: 'Expense Claim Submitted',
        body: `<p>Dear <strong>${employee.firstName} ${employee.lastName}</strong>,</p><p>Your expense claim of <strong>$${expenseClaim.amount}</strong> for <strong>${expenseClaim.travelRequest.destination}</strong> has been <span style='color:#22c55e; font-weight:bold;'>successfully submitted</span> and is pending approval.</p><p>Submitted on: <strong>${now}</strong></p>`
      }).catch(() => {})

      if (employee.manager) {
        const managerUser = await User.findById(employee.manager.id)
        if (managerUser && managerUser.isActive) {
          sendEmail({
            to: managerUser.email,
            subject: 'New Expense Claim Submitted',
            body: `<p>Dear <strong>${managerUser.firstName} ${managerUser.lastName}</strong>,</p><p>A new expense claim has been submitted by <strong>${employee.firstName} ${employee.lastName}</strong> for <strong>${expenseClaim.travelRequest.destination}</strong>.</p><ul><li><strong>Amount:</strong> $${expenseClaim.amount}</li><li><strong>Submitted on:</strong> <span style='color:#6366f1;'>${now}</span></li></ul>`
          }).catch(() => {})
        }
      }

      res.status(201).json(expenseClaim)
    } catch (error) {
      res.status(500).json({ message: 'Server error' })
    }
  },
)

// Get expense claims
router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query
    const where = {}

    if (req.user.role === 'Employee') {
      where.employee = req.user.id
    } else if (req.user.role === 'Manager') {
      if (req.query.employee && req.query.employee === String(req.user.id)) {
        where.employee = req.user.id
      } else {
        const employees = await User.find({ managerId: req.user.id })
        where.employeeIds = employees.map(e => e.id)
      }
    }
    if (status) where.status = status

    const expenseClaims = await ExpenseClaim.find(where, { limit: Number(limit), skip: (page - 1) * limit })
    const total = await ExpenseClaim.countDocuments(where)

    res.json({ expenseClaims, totalPages: Math.ceil(total / limit), currentPage: page, total })
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Update expense claim status
router.patch('/:id/status', auth, authorize('Manager', 'Admin'), async (req, res) => {
  try {
    const { status, reviewComments } = req.body
    const expenseClaim = await ExpenseClaim.findById(Number(req.params.id))
    if (!expenseClaim) return res.status(404).json({ message: 'Expense claim not found' })

    const employee = expenseClaim.employee
    if (String(employee.id) === String(req.user.id)) {
      return res.status(403).json({ message: 'You cannot approve or reject your own expense claim.' })
    }

    const isFinal = expenseClaim.adminStatus === 'Approved' || expenseClaim.adminStatus === 'Rejected'
    if (isFinal) return res.status(400).json({ message: 'This claim is finalized by admin. No further action allowed.' })

    const updates = {}
    if (req.user.role === 'Manager') {
      const empManagerId = employee.manager ? employee.manager.id : null
      if (!empManagerId || String(empManagerId) !== String(req.user.id)) {
        return res.status(403).json({ message: 'You are not authorized to approve/reject this claim' })
      }
      if (expenseClaim.adminStatus === 'Approved' || expenseClaim.adminStatus === 'Rejected') {
        return res.status(400).json({ message: 'Admin has already made a final decision.' })
      }
      updates.managerStatus = status
      updates.managerReviewedBy = req.user.id
      updates.managerReviewComments = reviewComments
      updates.managerReviewDate = new Date()
      if (!expenseClaim.adminStatus || expenseClaim.adminStatus === 'Pending') {
        updates.status = status
      }
    } else if (req.user.role === 'Admin') {
      updates.adminStatus = status
      updates.adminReviewedBy = req.user.id
      updates.adminReviewComments = reviewComments
      updates.adminReviewDate = new Date()
      updates.status = status
    }

    const updated = await ExpenseClaim.updateById(expenseClaim.id, updates)
    res.json(updated)

    // Fire-and-forget
    ;(async () => {
      try {
        const io = req.app.get('io')
        const connectedUsers = req.app.get('connectedUsers')

        const employeeNotification = await Notification.create({
          recipient: employee.id,
          title: `Expense Claim ${status}`,
          message: `Your expense claim of $${expenseClaim.amount} for ${expenseClaim.travelRequest.destination} has been ${status.toLowerCase()} by ${req.user.firstName} ${req.user.lastName}.` + (reviewComments ? `\nComment: ${reviewComments}` : ''),
          type: status === 'Approved' ? 'expense_approved' : 'expense_rejected',
          relatedId: expenseClaim.id,
          relatedModel: 'ExpenseClaim',
        })
        const socketId = connectedUsers[String(employee.id)]
        if (socketId) io.to(socketId).emit('notification', employeeNotification)

        const admins = await User.find({ role: 'Admin', isActive: true })
        const adminNotifs = admins.filter(a => String(a.id) !== String(req.user.id)).map(admin => ({
          recipient: admin.id,
          title: `Expense Claim ${status} by ${req.user.firstName} ${req.user.lastName}`,
          message: `Expense claim of $${expenseClaim.amount} for ${expenseClaim.travelRequest.destination} submitted by ${employee.firstName} ${employee.lastName} has been ${status.toLowerCase()}.`,
          type: status === 'Approved' ? 'expense_approved' : 'expense_rejected',
          relatedId: expenseClaim.id,
          relatedModel: 'ExpenseClaim',
        }))
        if (adminNotifs.length > 0) Notification.insertMany(adminNotifs).catch(() => {})

        AuditLog.create({
          user: req.user.id,
          action: `ExpenseClaim ${status}`,
          details: `Claim ID: ${expenseClaim.id}, Amount: $${expenseClaim.amount}, Comment: ${reviewComments || ''}`,
        }).catch(() => {})

        if (employee.email) {
          sendEmail({
            to: employee.email,
            subject: `Your Expense Claim has been ${status}`,
            body: `<p>Dear <strong>${employee.firstName} ${employee.lastName}</strong>,</p><p>Your expense claim of <strong>$${expenseClaim.amount}</strong> for <strong>${expenseClaim.travelRequest.destination}</strong> has been <span style='color:${status === 'Approved' ? '#22c55e' : '#ef4444'}; font-weight:bold;'>${status.toLowerCase()}</span> by ${req.user.firstName} ${req.user.lastName} (${req.user.role}).</p>${reviewComments ? `<p><strong>Remarks:</strong> ${reviewComments}</p>` : ''}`
          }).catch(() => {})
        }
      } catch (err) {
        console.error('Side effect error:', err)
      }
    })()
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Upload receipt
router.post('/:id/receipt', auth, upload.single('receipt'), async (req, res) => {
  try {
    const claim = await ExpenseClaim.findById(Number(req.params.id))
    if (!claim) return res.status(404).json({ message: 'Expense claim not found' })
    if (String(claim.employeeId) !== String(req.user.id) && !['Admin', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized' })
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    const updated = await ExpenseClaim.updateById(claim.id, { receiptUrl: req.file.path })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' })
  }
})

// Export expense claims as CSV
router.get('/export', auth, authorize('Admin', 'Manager'), async (req, res) => {
  try {
    const where = {}
    if (req.user.role === 'Manager') {
      const employees = await User.find({ managerId: req.user.id })
      where.employeeIds = employees.map(e => e.id)
    }
    if (req.query.status) where.status = req.query.status
    if (req.query.start) where.createdAtGte = new Date(req.query.start)
    if (req.query.end) {
      const endDate = new Date(req.query.end)
      endDate.setDate(endDate.getDate() + 1)
      where.createdAtLt = endDate
    }

    let expenseClaims = await ExpenseClaim.findForExport(where)

    if (req.query.search) {
      const search = req.query.search.toLowerCase()
      expenseClaims = expenseClaims.filter(c =>
        (c.description && c.description.toLowerCase().includes(search)) ||
        (c.employee && ((c.employee.firstName && c.employee.firstName.toLowerCase().includes(search)) ||
          (c.employee.lastName && c.employee.lastName.toLowerCase().includes(search)))) ||
        (c.travelRequest && ((c.travelRequest.destination && c.travelRequest.destination.toLowerCase().includes(search)) ||
          (c.travelRequest.purpose && c.travelRequest.purpose.toLowerCase().includes(search))))
      )
    }

    if (expenseClaims.length === 0) return res.status(400).json({ message: 'No data to export' })

    const fields = [
      { label: 'Description', value: 'description' },
      { label: 'Amount', value: 'amount' },
      { label: 'Expense Date', value: row => row.expenseDate ? dayjs(row.expenseDate).format('DD/MM/YYYY') : '' },
      { label: 'Category', value: 'category' },
      { label: 'Status', value: 'status' },
      { label: 'Submission Date', value: row => row.createdAt ? dayjs(row.createdAt).format('DD/MM/YYYY') : '' },
      { label: 'Employee', value: row => row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : '' },
      { label: 'Department', value: row => row.employee ? row.employee.department : '' },
      { label: 'Travel Destination', value: row => row.travelRequest ? row.travelRequest.destination : '' },
      { label: 'Travel Purpose', value: row => row.travelRequest ? row.travelRequest.purpose : '' },
    ]
    const parser = new Parser({ fields })
    const csv = parser.parse(expenseClaims)
    res.header('Content-Type', 'text/csv')
    res.attachment('expense_claims.csv')
    return res.send(csv)
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router
