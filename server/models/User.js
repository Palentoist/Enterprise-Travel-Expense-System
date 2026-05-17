const { query } = require('../db')
const bcrypt = require('bcryptjs')

// Columns to select when password should be excluded
const PUBLIC_COLS = `
  id, email, role, first_name AS "firstName", last_name AS "lastName",
  department, is_active AS "isActive", profile_picture AS "profilePicture",
  profile_picture_public_id AS "profilePicturePublicId",
  password_updated_at AS "passwordUpdatedAt", is_permanent AS "isPermanent",
  manager_id AS "managerId", reset_password_token AS "resetPasswordToken",
  reset_password_expires AS "resetPasswordExpires",
  created_at AS "createdAt", updated_at AS "updatedAt"
`

// Columns including password (for auth checks)
const ALL_COLS = `${PUBLIC_COLS}, password`

/**
 * Attach a populated manager object to a user row (if manager_id present).
 */
async function _populateManager(user) {
  if (!user) return user
  if (user.managerId) {
    const res = await query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", email, role FROM users WHERE id = $1`,
      [user.managerId]
    )
    user.manager = res.rows[0] || null
  } else {
    user.manager = null
  }
  return user
}

async function findById(id, { includePassword = false, populate = false } = {}) {
  const cols = includePassword ? ALL_COLS : PUBLIC_COLS
  const res = await query(`SELECT ${cols} FROM users WHERE id = $1`, [id])
  const user = res.rows[0] || null
  if (populate && user) return _populateManager(user)
  return user
}

async function findOne(where, { includePassword = false } = {}) {
  const cols = includePassword ? ALL_COLS : PUBLIC_COLS
  const keys = Object.keys(where)
  const vals = Object.values(where)
  const conditions = keys.map((k, i) => {
    // Map JS camelCase keys to SQL snake_case columns
    const col = _col(k)
    return `${col} = $${i + 1}`
  })
  const sql = `SELECT ${cols} FROM users WHERE ${conditions.join(' AND ')} LIMIT 1`
  const res = await query(sql, vals)
  return res.rows[0] || null
}

async function find(where = {}, { populate = false, limit, skip } = {}) {
  let sql = `SELECT ${PUBLIC_COLS} FROM users`
  const vals = []
  const conditions = []

  if (typeof where.isActive === 'boolean') {
    vals.push(where.isActive)
    conditions.push(`is_active = $${vals.length}`)
  }
  if (where.role) {
    vals.push(where.role)
    conditions.push(`role = $${vals.length}`)
  }
  if (where.managerId !== undefined) {
    vals.push(where.managerId)
    conditions.push(`manager_id = $${vals.length}`)
  }

  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`
  sql += ` ORDER BY created_at DESC`
  if (limit !== undefined) {
    vals.push(limit)
    sql += ` LIMIT $${vals.length}`
  }
  if (skip !== undefined) {
    vals.push(skip)
    sql += ` OFFSET $${vals.length}`
  }

  const res = await query(sql, vals)
  if (populate) {
    return Promise.all(res.rows.map(_populateManager))
  }
  return res.rows
}

async function countDocuments(where = {}) {
  let sql = `SELECT COUNT(*) FROM users`
  const vals = []
  const conditions = []

  if (typeof where.isActive === 'boolean') {
    vals.push(where.isActive)
    conditions.push(`is_active = $${vals.length}`)
  }
  if (where.role) {
    vals.push(where.role)
    conditions.push(`role = $${vals.length}`)
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`

  const res = await query(sql, vals)
  return parseInt(res.rows[0].count, 10)
}

async function create(data) {
  const salt = await bcrypt.genSalt(12)
  const hashedPassword = await bcrypt.hash(data.password, salt)
  const now = new Date()
  const res = await query(
    `INSERT INTO users
      (email, password, role, first_name, last_name, department,
       is_active, is_permanent, manager_id, created_at, updated_at, password_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)
     RETURNING ${PUBLIC_COLS}`,
    [
      data.email,
      hashedPassword,
      data.role || 'Employee',
      data.firstName,
      data.lastName,
      data.department || 'General',
      data.isActive !== undefined ? data.isActive : true,
      data.isPermanent || false,
      data.managerId || data.manager || null,
      now,
    ]
  )
  return res.rows[0]
}

async function updateById(id, data) {
  const sets = []
  const vals = []

  const fieldMap = {
    firstName: 'first_name',
    lastName: 'last_name',
    email: 'email',
    role: 'role',
    department: 'department',
    isActive: 'is_active',
    isPermanent: 'is_permanent',
    managerId: 'manager_id',
    manager: 'manager_id',
    profilePicture: 'profile_picture',
    profilePicturePublicId: 'profile_picture_public_id',
    passwordUpdatedAt: 'password_updated_at',
    resetPasswordToken: 'reset_password_token',
    resetPasswordExpires: 'reset_password_expires',
  }

  // Handle password separately — must be hashed
  if (data.password !== undefined) {
    const salt = await bcrypt.genSalt(12)
    vals.push(await bcrypt.hash(data.password, salt))
    sets.push(`password = $${vals.length}`)
    vals.push(new Date())
    sets.push(`password_updated_at = $${vals.length}`)
  }

  for (const [key, col] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) {
      vals.push(data[key] === '' ? null : data[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }

  // Handle explicit null for manager (unassign)
  if (data.manager === null || data.managerId === null) {
    // Overwrite any already-pushed managerId value
    if (!sets.some(s => s.startsWith('manager_id'))) {
      vals.push(null)
      sets.push(`manager_id = $${vals.length}`)
    }
  }

  if (sets.length === 0) {
    return findById(id)
  }

  vals.push(new Date())
  sets.push(`updated_at = $${vals.length}`)
  vals.push(id)

  const res = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING ${PUBLIC_COLS}`,
    vals
  )
  return res.rows[0] || null
}

async function deleteById(id) {
  await query(`DELETE FROM users WHERE id = $1`, [id])
}

async function comparePassword(candidatePassword, hashedPassword) {
  return bcrypt.compare(candidatePassword, hashedPassword)
}

// Internal helper: camelCase key → SQL column name
function _col(key) {
  const map = {
    email: 'email',
    role: 'role',
    isActive: 'is_active',
    isPermanent: 'is_permanent',
    resetPasswordToken: 'reset_password_token',
    resetPasswordExpires: 'reset_password_expires',
    managerId: 'manager_id',
  }
  return map[key] || key
}

module.exports = {
  findById,
  findOne,
  find,
  countDocuments,
  create,
  updateById,
  deleteById,
  comparePassword,
  PUBLIC_COLS,
}
