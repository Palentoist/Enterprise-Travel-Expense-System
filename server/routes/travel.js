const express = require('express')
const { body, validationResult } = require('express-validator')
const TravelRequest = require('../models/TravelRequest')
const Notification = require('../models/Notification')
const { auth, authorize } = require('../middleware/auth')
const { Parser } = require('json2csv')
const AuditLog = require('../models/AuditLog')
const sendEmail = require('../utils/sendEmail')
const User = require('../models/User')
const dayjs = require('dayjs')
const upload = require('../utils/multer')

const router = express.Router()

// Create travel request
router.post(
  '/',
  auth,
  (req, res, next) => {
    if (req.user.role !== 'Employee' && req.user.role !== 'Manager') {
      return res.status(403).json({ message: 'Only employees or managers can submit travel requests' })
    }
    next()
  },
  [
    body('destination').notEmpty().withMessage('Destination is required'),
    body('purpose').notEmpty().withMessage('Purpose is required'),
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    body('endDate').isISO8601().withMessage('Valid end date is required'),
    body('estimatedCost').isNumeric().withMessage('Valid estimated cost is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

      const today = dayjs().startOf('day')
      const startDate = dayjs(req.body.startDate).startOf('day')
      const endDate = dayjs(req.body.endDate).startOf('day')
      if (startDate.isBefore(today)) {
        return res.status(400).json({ message: 'Travel start date must be today or a future date.' })
      }
      if (endDate.isBefore(startDate)) {
        return res.status(400).json({ message: 'Return date must be the same as or after travel start date.' })
      }

      const travelRequest = await TravelRequest.create({
        ...req.body,
        employee: req.user.id,
      })

      res.status(201).json(travelRequest)

        // Fire-and-forget side effects
        ; (async () => {
          try {
            const io = req.app.get('io')
            const connectedUsers = req.app.get('connectedUsers')
            const employee = travelRequest.employee

            if (employee.manager) {
              const managerUser = await User.findById(employee.manager.id)
              if (managerUser && managerUser.isActive) {
                Notification.create({
                  recipient: managerUser.id,
                  title: `New Travel Request Submitted`,
                  message: `${employee.firstName} ${employee.lastName} submitted a travel request to ${travelRequest.destination}.`,
                  type: 'travel_submitted',
                  relatedId: travelRequest.id,
                  relatedModel: 'TravelRequest',
                }).then(notif => {
                  const socketId = connectedUsers[String(managerUser.id)]
                  if (socketId) io.to(socketId).emit('notification', notif)
                }).catch(() => { })
              }
            }

            const admins = await User.find({ role: 'Admin', isActive: true })
            if (admins.length > 0) {
              Notification.insertMany(admins.map(admin => ({
                recipient: admin.id,
                title: `Travel Request Submitted`,
                message: `${employee.firstName} ${employee.lastName} submitted a travel request to ${travelRequest.destination}.`,
                type: 'travel_submitted',
                relatedId: travelRequest.id,
                relatedModel: 'TravelRequest',
              }))).then(adminNotifs => {
                admins.forEach((admin, i) => {
                  const socketId = connectedUsers[String(admin.id)]
                  if (socketId) io.to(socketId).emit('notification', adminNotifs[i])
                })
              }).catch(() => { })
            }

            const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
            sendEmail({
              to: employee.email,
              subject: 'Travel Request Submitted',
              body: `<p>Dear <strong>${employee.firstName} ${employee.lastName}</strong>,</p><p>Your travel request to <strong>${travelRequest.destination}</strong> from <strong>${dayjs(travelRequest.startDate).format('DD-MM-YYYY')}</strong> to <strong>${dayjs(travelRequest.endDate).format('DD-MM-YYYY')}</strong> has been <span style='color:#22c55e; font-weight:bold;'>successfully submitted</span> and is pending approval.</p><p>Submitted on: <strong>${now}</strong></p>`
            }).catch(() => { })

            if (employee.manager) {
              const managerUser = await User.findById(employee.manager.id)
              if (managerUser && managerUser.isActive) {
                sendEmail({
                  to: managerUser.email,
                  subject: 'New Travel Request Submitted',
                  body: `<p>Dear <strong>${managerUser.firstName} ${managerUser.lastName}</strong>,</p><p>A new travel request has been submitted by <strong>${employee.firstName} ${employee.lastName}</strong> to <strong>${travelRequest.destination}</strong>.</p><ul><li><strong>Submitted on:</strong> <span style='color:#6366f1;'>${now}</span></li></ul>`
                }).catch(() => { })
              }
            }
          } catch (err) { /* side effect error */ }
        })()
    } catch (error) {
      res.status(500).json({ message: 'Server error' })
    }
  },
)

// Get travel requests
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

    const travelRequests = await TravelRequest.find(where, { limit: Number(limit), skip: (page - 1) * limit })
    const total = await TravelRequest.countDocuments(where)

    res.json({ travelRequests, totalPages: Math.ceil(total / limit), currentPage: page, total })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Update travel request status
router.patch('/:id/status', auth, authorize('Manager', 'Admin'), async (req, res) => {
  try {
    const { status, reviewComments } = req.body
    const travelRequest = await TravelRequest.findById(Number(req.params.id))
    if (!travelRequest) return res.status(404).json({ message: 'Travel request not found' })

    const employee = travelRequest.employee
    if (String(employee.id) === String(req.user.id)) {
      return res.status(403).json({ message: 'You cannot approve or reject your own travel request' })
    }

    const isFinal = travelRequest.adminStatus === 'Approved' || travelRequest.adminStatus === 'Rejected'
    if (isFinal) return res.status(400).json({ message: 'This request is finalized by admin. No further action allowed.' })

    const updates = {}

    if (req.user.role === 'Manager') {
      const empManagerId = employee.manager ? employee.manager.id : null
      if (!empManagerId || String(empManagerId) !== String(req.user.id)) {
        return res.status(403).json({ message: 'You are not authorized to approve/reject this request' })
      }
      updates.managerStatus = status
      updates.managerReviewedBy = req.user.id
      updates.managerReviewComments = reviewComments
      updates.managerReviewDate = new Date()
      if (!travelRequest.adminStatus || travelRequest.adminStatus === 'Pending') {
        updates.status = status
      }
    } else if (req.user.role === 'Admin') {
      updates.adminStatus = status
      updates.adminReviewedBy = req.user.id
      updates.adminReviewComments = reviewComments
      updates.adminReviewDate = new Date()
      updates.status = status
    }

    const updated = await TravelRequest.updateById(travelRequest.id, updates)

    const io = req.app.get('io')
    const connectedUsers = req.app.get('connectedUsers')

    const notif = await Notification.create({
      recipient: employee.id,
      title: `Travel Request ${status}`,
      message: `Your travel request to ${travelRequest.destination} has been ${status.toLowerCase()} by ${req.user.firstName} ${req.user.lastName}.` + (reviewComments ? `\nComment: ${reviewComments}` : ''),
      type: status === 'Approved' ? 'travel_approved' : 'travel_rejected',
      relatedId: travelRequest.id,
      relatedModel: 'TravelRequest',
    })
    const socketId = connectedUsers[String(employee.id)]
    if (socketId) io.to(socketId).emit('notification', notif)

    await AuditLog.create({
      user: req.user.id,
      action: `TravelRequest ${status}`,
      details: `Request ID: ${travelRequest.id}, Destination: ${travelRequest.destination}, Comment: ${reviewComments || ''}`,
    })

    if (employee.email) {
      sendEmail({
        to: employee.email,
        subject: `Travel Request ${status}`,
        body: `<p>Dear <strong>${employee.firstName} ${employee.lastName}</strong>,</p><p>Your travel request to <strong>${travelRequest.destination}</strong> has been ${status.toLowerCase()} by ${req.user.firstName} ${req.user.lastName}.</p>${reviewComments ? `<p><strong>Comment:</strong> ${reviewComments}</p>` : ''}`
      }).catch(err => console.error('Email failed:', err))
    }

    res.status(200).json(updated)
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Upload document
router.post('/:id/document', auth, upload.single('document'), async (req, res) => {
  try {
    const request = await TravelRequest.findById(Number(req.params.id))
    if (!request) return res.status(404).json({ message: 'Travel request not found' })
    if (String(request.employeeId) !== String(req.user.id) && !['Admin', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized' })
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    const updated = await TravelRequest.updateById(request.id, { documentUrl: req.file.path })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' })
  }
})

// Export travel requests as CSV
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

    let travelRequests = await TravelRequest.findForExport(where)

    if (req.query.search) {
      const search = req.query.search.toLowerCase()
      travelRequests = travelRequests.filter(r =>
        (r.destination && r.destination.toLowerCase().includes(search)) ||
        (r.purpose && r.purpose.toLowerCase().includes(search)) ||
        (r.employee && ((r.employee.firstName && r.employee.firstName.toLowerCase().includes(search)) ||
          (r.employee.lastName && r.employee.lastName.toLowerCase().includes(search))))
      )
    }

    if (travelRequests.length === 0) return res.status(400).json({ message: 'No data to export' })

    const fields = [
      { label: 'Destination', value: 'destination' },
      { label: 'Purpose', value: 'purpose' },
      { label: 'Start Date', value: row => row.startDate ? dayjs(row.startDate).format('DD/MM/YYYY') : '' },
      { label: 'End Date', value: row => row.endDate ? dayjs(row.endDate).format('DD/MM/YYYY') : '' },
      { label: 'Estimated Cost', value: 'estimatedCost' },
      { label: 'Priority', value: 'priority' },
      { label: 'Status', value: 'status' },
      { label: 'Submission Date', value: row => row.createdAt ? dayjs(row.createdAt).format('DD/MM/YYYY') : '' },
      { label: 'Employee', value: row => row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : '' },
      { label: 'Department', value: row => row.employee ? row.employee.department : '' },
    ]
    const parser = new Parser({ fields })
    const csv = parser.parse(travelRequests)
    res.header('Content-Type', 'text/csv')
    res.attachment('travel_requests.csv')
    return res.send(csv)
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router