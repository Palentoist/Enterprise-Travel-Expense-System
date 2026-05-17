const express = require('express')
const jwt = require('jsonwebtoken')
const { body, validationResult } = require('express-validator')
const User = require('../models/User')
const Notification = require('../models/Notification')
const { auth } = require('../middleware/auth')
const crypto = require('crypto')
const sendEmail = require('../utils/sendEmail')
const rateLimit = require('express-rate-limit')
const dayjs = require('dayjs')

const router = express.Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
})
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
})

// Register
router.post(
  '/register',
  registerLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

      const { email, password, firstName, lastName, department } = req.body

      const existingUser = await User.findOne({ email })
      if (existingUser) return res.status(400).json({ message: 'Email already exists' })

      const user = await User.create({
        email, password, firstName, lastName,
        department: department || 'General',
        role: 'Employee',
        isActive: false,
      })

      // Notify admins
      const now = dayjs().format('DD-MM-YYYY HH:mm:ss')
      const admins = await User.find({ role: 'Admin', isActive: true })
      if (admins.length > 0) {
        for (const admin of admins) {
          sendEmail({
            to: admin.email,
            subject: 'New User Registration Pending Approval',
            body: `
              <p style='font-size:1.1em;'>A new user has registered and is awaiting your approval:</p>
              <ul style='margin:16px 0 24px 24px; font-size:1em;'>
                <li><strong>Name:</strong> ${user.firstName} ${user.lastName}</li>
                <li><strong>Email:</strong> ${user.email}</li>
                <li><strong>Role:</strong> ${user.role}</li>
                <li><strong>Registered on:</strong> <span style='color:#6366f1;'>${now}</span></li>
              </ul>
              <p style='margin-top:16px;'>Please review and approve or reject this registration in the admin panel.</p>
            `
          }).catch(err => console.error('Email failed:', err))
        }

        let notifDocs = []
        try {
          notifDocs = await Notification.insertMany(admins.map(admin => ({
            recipient: admin.id,
            title: 'New User Registration',
            message: 'A new user has registered and is awaiting approval.',
            type: 'user_pending_approval',
            relatedId: user.id,
            relatedModel: 'User',
          })))
        } catch (err) {
          console.error('Notification insertMany failed:', err)
        }

        const io = req.app.get('io')
        const connectedUsers = req.app.get('connectedUsers')
        admins.forEach((admin, i) => {
          const socketId = connectedUsers[String(admin.id)]
          if (socketId && notifDocs[i]) io.to(socketId).emit('notification', notifDocs[i])
        })
      }

      // Welcome email
      sendEmail({
        to: user.email,
        subject: `🎉 Welcome to Travel & Expense Management – Employee Access Pending Approval`,
        body: `
          <h2>Welcome Aboard!</h2>
          <p>Your account has been created with the following credentials:</p>
          <ul>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>Password:</strong> ${password}</li>
            <li><strong>Role:</strong> Employee</li>
          </ul>
          <p>Your account is currently <span style='color:#f59e42; font-weight:bold;'>pending admin approval</span>.</p>
        `
      }).catch(err => console.error('Email failed:', err))

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
      res.status(201).json({
        token,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, department: user.department },
      })
    } catch (error) {
      console.error(error)
      res.status(500).json({ message: 'Server error' })
    }
  },
)

// Login
router.post(
  '/login',
  loginLimiter,
  [
    body('email').notEmpty().withMessage('Email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

      const { email, password } = req.body
      const user = await User.findOne({ email }, { includePassword: true })
      if (!user || !user.isActive) {
        return res.status(403).json({ message: user && !user.isActive ? 'Your account is pending admin approval.' : 'Invalid credentials' })
      }

      const isMatch = await User.comparePassword(password, user.password)
      if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' })

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
      res.json({
        token,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, department: user.department },
      })
    } catch (error) {
      console.error(error)
      res.status(500).json({ message: 'Server error' })
    }
  },
)

// Get current user
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id)
  res.json({
    user: {
      id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
      role: user.role, department: user.department, isActive: user.isActive,
      passwordUpdatedAt: user.passwordUpdatedAt, profilePicture: user.profilePicture,
      profilePicturePublicId: user.profilePicturePublicId,
    },
  })
})

// Change password
router.post('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { currentPassword, newPassword } = req.body
    const user = await User.findById(req.user.id, { includePassword: true })
    if (!user) return res.status(404).json({ message: 'User not found' })

    const isMatch = await User.comparePassword(currentPassword, user.password)
    if (!isMatch) return res.status(400).json({ message: 'Current password is incorrect' })

    await User.updateById(user.id, { password: newPassword })
    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Profile update
router.patch('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, department } = req.body
    const updates = {}
    if (firstName) updates.firstName = firstName
    if (lastName) updates.lastName = lastName
    if (department) updates.department = department

    const user = await User.updateById(req.user.id, updates)
    if (!user) return res.status(404).json({ message: 'User not found' })

    res.json({
      user: {
        id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
        role: user.role, department: user.department, passwordUpdatedAt: user.passwordUpdatedAt,
        profilePicture: user.profilePicture, profilePicturePublicId: user.profilePicturePublicId,
      },
      message: 'Profile updated successfully',
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ message: 'Email is required' })
  const user = await User.findOne({ email })
  if (!user) return res.status(400).json({ message: 'This email is not registered with us.' })

  const token = crypto.randomBytes(32).toString('hex')
  await User.updateById(user.id, {
    resetPasswordToken: token,
    resetPasswordExpires: new Date(Date.now() + 1000 * 60 * 60),
  })

  const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/reset-password/${token}`
  await sendEmail({
    to: user.email,
    subject: 'Password Reset Request',
    body: `Click the link below to reset your password:<br/><a href="${resetUrl}">${resetUrl}</a><br/><br/>If you did not request this, you can ignore this email.`
  }).catch(err => console.error('Email failed:', err))

  res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' })
})

// Reset Password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ message: 'Invalid request' })

  const { query } = require('../db')
  const res2 = await query(
    `SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
    [token]
  )
  if (!res2.rows[0]) return res.status(400).json({ message: 'Invalid or expired token' })

  await User.updateById(res2.rows[0].id, {
    password,
    resetPasswordToken: null,
    resetPasswordExpires: null,
  })
  res.status(200).json({ message: 'Password has been reset. You can now log in.' })
})

// Validate Reset Token
router.get('/validate-reset-token', async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).json({ message: 'Token is required' })
  const { query } = require('../db')
  const result = await query(
    `SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
    [token]
  )
  if (!result.rows[0]) return res.status(400).json({ message: 'Invalid or expired token' })
  res.status(200).json({ message: 'Token is valid' })
})

module.exports = router
