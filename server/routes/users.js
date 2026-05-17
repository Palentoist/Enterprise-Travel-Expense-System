const express = require("express")
const { auth, authorize } = require("../middleware/auth")
const User = require("../models/User")
const AuditLog = require("../models/AuditLog")
const Notification = require("../models/Notification")
const sendEmail = require('../utils/sendEmail')
const dayjs = require('dayjs')
const upload = require('../utils/multer')
const cloudinary = require('../utils/cloudinary')

const router = express.Router()

// List all users (Admin only)
router.get('/', auth, authorize('Admin'), async (req, res) => {
  try {
    const { status, page = 0, limit = 20 } = req.query
    const where = {}
    if (status === 'pending') where.isActive = false
    else if (status === 'active') where.isActive = true

    const users = await User.find(where, { populate: true, limit: Number(limit), skip: Number(page) * Number(limit) })
    const total = await User.countDocuments(where)
    res.json({ users, total })
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Update user role, status, or manager (Admin only)
router.patch('/:id', auth, authorize('Admin'), async (req, res) => {
  try {
    const { role, isActive, manager } = req.body
    const user = await User.findById(Number(req.params.id))
    if (!user) return res.status(404).json({ message: 'User not found' })

    if (String(req.user.id) === String(user.id) && (role || typeof isActive === 'boolean' || manager !== undefined)) {
      return res.status(403).json({ message: 'You cannot change your own role, status, or manager.' })
    }
    if (user.isPermanent && (role || typeof isActive === 'boolean' || manager)) {
      return res.status(403).json({ message: 'Cannot modify permanent admin account' })
    }
    if (role === 'Admin' && (!req.user.isPermanent || String(req.user.id) === String(user.id))) {
      return res.status(403).json({ message: 'Only the super admin can assign or modify admin roles.' })
    }
    if (user.role === 'Admin' && !req.user.isPermanent) {
      return res.status(403).json({ message: 'Only the super admin can modify other admin roles.' })
    }

    const updates = {}
    let roleChanged = false
    const previousManagerId = user.managerId

    if (role && role !== user.role) {
      roleChanged = true
      updates.role = role
      if (role === 'Manager') updates.manager = null
    }
    if (typeof isActive === 'boolean') updates.isActive = isActive
    if (manager !== undefined) {
      updates.manager = manager || null
    }

    await User.updateById(user.id, updates)

    const updatedUser = await User.findById(user.id, { populate: true })
    res.json({ user: updatedUser })

    // Fire-and-forget
    AuditLog.create({
      user: req.user.id,
      action: 'User Update',
      details: `User ID: ${user.id}, New role: ${updatedUser.role}, Active: ${updatedUser.isActive}, Manager: ${updatedUser.managerId}`,
    }).catch(err => console.error('Audit log failed:', err))

    const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
    const managerChanged = manager !== undefined && String(previousManagerId) !== String(manager || null)

    if (managerChanged) {
      if (updatedUser.manager) {
        sendEmail({
          to: updatedUser.email, subject: 'Your assigned manager has changed',
          body: `<p>Dear <strong>${updatedUser.firstName} ${updatedUser.lastName}</strong>,</p><p>Your assigned manager has been updated.</p><ul><li><strong>New Manager:</strong> ${updatedUser.manager.firstName} ${updatedUser.manager.lastName} (${updatedUser.manager.email})</li><li><strong>Changed on:</strong> ${now}</li></ul>`
        }).catch(() => { })
        sendEmail({
          to: updatedUser.manager.email, subject: 'You have been assigned a new report',
          body: `<p>Dear <strong>${updatedUser.manager.firstName} ${updatedUser.manager.lastName}</strong>,</p><p>You have been assigned as the manager for <strong>${updatedUser.firstName} ${updatedUser.lastName}</strong>.</p>`
        }).catch(() => { })
      } else if (previousManagerId) {
        const prevMgr = await User.findById(previousManagerId)
        if (prevMgr) {
          sendEmail({
            to: updatedUser.email, subject: 'Your manager has been unassigned',
            body: `<p>Dear <strong>${updatedUser.firstName} ${updatedUser.lastName}</strong>,</p><p>You no longer have a manager assigned.</p>`
          }).catch(() => { })
          sendEmail({
            to: prevMgr.email, subject: 'A report has been unassigned from you',
            body: `<p>Dear <strong>${prevMgr.firstName} ${prevMgr.lastName}</strong>,</p><p>You are no longer the manager for <strong>${updatedUser.firstName} ${updatedUser.lastName}</strong>.</p>`
          }).catch(() => { })
        }
      }
    }
    if (roleChanged) {
      sendEmail({
        to: updatedUser.email, subject: 'Your role has been updated',
        body: `<p>Dear <strong>${updatedUser.firstName} ${updatedUser.lastName}</strong>,</p><p>Your role has been updated to <strong>${updatedUser.role}</strong> by the admin.</p>`
      }).catch(() => { })
    }
    if (typeof isActive === 'boolean') {
      sendEmail({
        to: updatedUser.email,
        subject: isActive ? '✅ Your Account Has Been Approved' : '⚠️ Your Account Has Been Deactivated',
        body: isActive
          ? `<p>Your account has been successfully approved. You can now log in.</p>`
          : `<p>Your account has been deactivated. Contact the admin for more details.</p>`
      }).catch(() => { })
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Get audit log (Admin only)
router.get('/audit-log', auth, authorize('Admin'), async (req, res) => {
  try {
    let { userId, action, startDate, endDate } = req.query
    userId = userId && userId.trim() !== '' ? userId : undefined
    action = action && action.trim() !== '' ? action : undefined
    startDate = startDate && startDate.trim() !== '' ? startDate : undefined
    endDate = endDate && endDate.trim() !== '' ? endDate : undefined

    const where = {}
    if (userId) where.user = Number(userId)
    if (action) where.action = action
    if (startDate) { const s = new Date(startDate); if (!isNaN(s)) where.createdAtGte = s }
    if (endDate) { const e = new Date(endDate); if (!isNaN(e)) { e.setHours(23, 59, 59, 999); where.createdAtLte = e } }

    const logs = await AuditLog.find(where)
    res.json({ logs })
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Remove profile picture
router.delete('/:id/profile-picture', auth, async (req, res) => {
  try {
    if (req.user.role !== 'Admin' && String(req.user.id) !== req.params.id) {
      return res.status(403).json({ message: 'Not authorized' })
    }
    const user = await User.findById(Number(req.params.id))
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (!user.profilePicture) return res.status(400).json({ message: 'No profile picture to remove' })
    if (user.profilePicturePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicturePublicId)
      } catch (err) {
        console.error('Failed to destroy Cloudinary image:', err.message)
      }
    }
    const updated = await User.updateById(user.id, { profilePicture: null, profilePicturePublicId: null })
    res.json({ user: updated })
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' })
  }
})

// Upload profile picture
router.post('/:id/profile-picture', auth, upload.single('profilePicture'), async (req, res) => {
  try {
    if (req.user.role !== 'Admin' && String(req.user.id) !== req.params.id) {
      return res.status(403).json({ message: 'Not authorized' })
    }
    const user = await User.findById(Number(req.params.id))
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (user.profilePicturePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicturePublicId)
      } catch (err) {
        console.error('Failed to destroy old Cloudinary image:', err.message)
      }
    }
    const updated = await User.updateById(user.id, {
      profilePicture: req.file.path,
      profilePicturePublicId: req.file.filename,
    })
    res.json({ profilePicture: updated.profilePicture, profilePicturePublicId: updated.profilePicturePublicId })
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' })
  }
})

// Create a new user (Admin only)
router.post('/', auth, authorize('Admin'), async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, department, manager, isActive } = req.body
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ message: 'All fields are required' })
    }
    if (!['Employee', 'Manager', 'Admin'].includes(role)) {
      return res.status(400).json({ message: 'Role must be Employee, Manager, or Admin' })
    }
    const existing = await User.findOne({ email })
    if (existing) return res.status(400).json({ message: 'Email already exists' })

    const user = await User.create({
      email, password, firstName, lastName, role,
      department: department || 'General',
      managerId: manager || null,
      isActive: isActive !== undefined ? isActive : true,
    })

    res.status(201).json({ user, message: 'User created successfully.' })

    const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
    sendEmail({
      to: user.email,
      subject: `🎉 Welcome to Travel & Expense Management – ${role} Access Granted`,
      body: `<h2>Welcome Aboard!</h2><p>Your account has been created:</p><ul><li><strong>Email:</strong> ${user.email}</li><li><strong>Password:</strong> ${password}</li><li><strong>Role:</strong> ${role}</li></ul><p>Please login and change your password after first use for security.</p><ul><li><strong>Created on:</strong> <span style='color:#6366f1;'>${now}</span></li></ul>`
    }).catch(err => console.error('Welcome email failed:', err))
  } catch (error) {
    console.error('User creation failed:', error)
    return res.status(500).json({ message: 'Server error', error: error.message })
  }
})

// Delete user (Admin only)
router.delete('/:id', auth, authorize('Admin'), async (req, res) => {
  try {
    const user = await User.findById(Number(req.params.id))
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (String(req.user.id) === String(user.id)) {
      return res.status(403).json({ message: 'You cannot delete your own account.' })
    }
    if (user.isPermanent) return res.status(403).json({ message: 'Cannot delete permanent admin account' })

    await User.deleteById(user.id)
    await AuditLog.create({ user: req.user.id, action: 'User Delete', details: `User ID: ${user.id}, Email: ${user.email}` })
    res.json({ message: 'User deleted successfully' })
  } catch (error) {
    res.status(500).json({ message: 'Server error' })
  }
})

// Approve user
router.patch('/:id/approve', auth, authorize('Admin'), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!userId || isNaN(userId)) return res.status(400).json({ message: 'Invalid user ID' })

    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.isActive) return res.status(400).json({ message: 'User is already active' })

    await User.updateById(user.id, { isActive: true })

    // Send approval email (non-blocking — don't let SMTP failure crash the route)
    const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
    sendEmail({
      to: user.email,
      subject: 'Your account has been approved',
      body: `<p>Dear <strong>${user.firstName} ${user.lastName}</strong>,</p><p>Congratulations! Your account has been <span style='color:#22c55e; font-weight:bold;'>approved</span>. You can now log in.</p><ul><li><strong>Email:</strong> ${user.email}</li><li><strong>Approved on:</strong> <span style='color:#6366f1;'>${now}</span></li></ul>`
    }).catch(err => console.error('Approval email failed:', err))

    // Send in-app notification to the approved user
    try {
      const notif = await Notification.create({
        recipient: user.id,
        title: 'Account Approved',
        message: 'Your account has been approved by the admin. You can now log in.',
        type: 'general',
        relatedId: user.id,
        relatedModel: 'User',
      })
      const io = req.app.get('io')
      const connectedUsers = req.app.get('connectedUsers')
      const socketId = connectedUsers[String(user.id)]
      if (socketId) io.to(socketId).emit('notification', notif)
    } catch (notifErr) {
      console.error('Approval notification failed:', notifErr)
    }

    res.json({ message: 'User approved and notified.' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Reject user
router.patch('/:id/reject', auth, authorize('Admin'), async (req, res) => {
  try {
    const userId = Number(req.params.id)
    if (!userId || isNaN(userId)) return res.status(400).json({ message: 'Invalid user ID' })

    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ message: 'User not found' })

    // Send rejection email (non-blocking — don't let SMTP failure crash the route)
    const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
    sendEmail({
      to: user.email,
      subject: 'Your account registration was rejected',
      body: `<p>Dear <strong>${user.firstName} ${user.lastName}</strong>,</p><p>We regret to inform you that your registration was <span style='color:#ef4444; font-weight:bold;'>not approved</span>.</p><ul><li><strong>Email:</strong> ${user.email}</li><li><strong>Rejected on:</strong> <span style='color:#6366f1;'>${now}</span></li></ul>`
    }).catch(err => console.error('Rejection email failed:', err))

    await User.deleteById(user.id)
    res.json({ message: 'User rejected and notified.' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router