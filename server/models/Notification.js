const { query } = require('../db')

const COLS = `
  id, recipient_id AS "recipientId", title, message, type,
  is_read AS "isRead", related_id AS "relatedId", related_model AS "relatedModel",
  created_at AS "createdAt", updated_at AS "updatedAt"
`

async function find(where = {}, { limit = 20, skip = 0 } = {}) {
  const conditions = [], vals = []
  if (where.recipient) { vals.push(where.recipient); conditions.push(`recipient_id = $${vals.length}`) }
  if (typeof where.isRead === 'boolean') { vals.push(where.isRead); conditions.push(`is_read = $${vals.length}`) }
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  vals.push(limit, skip)
  const res = await query(
    `SELECT ${COLS} FROM notifications ${w} ORDER BY created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  )
  return res.rows
}

async function countDocuments(where = {}) {
  const conditions = [], vals = []
  if (where.recipient) { vals.push(where.recipient); conditions.push(`recipient_id = $${vals.length}`) }
  if (typeof where.isRead === 'boolean') { vals.push(where.isRead); conditions.push(`is_read = $${vals.length}`) }
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(`SELECT COUNT(*) FROM notifications ${w}`, vals)
  return parseInt(res.rows[0].count, 10)
}

async function create(data) {
  const res = await query(
    `INSERT INTO notifications (recipient_id,title,message,type,is_read,related_id,related_model,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING ${COLS}`,
    [data.recipient, data.title, data.message, data.type, false, data.relatedId || null, data.relatedModel || null]
  )
  return res.rows[0]
}

async function insertMany(items) {
  const results = []
  for (const item of items) {
    results.push(await create(item))
  }
  return results
}

async function findOneAndUpdate(where, updates) {
  const conditions = [], vals = []
  if (where._id || where.id) { vals.push(where._id || where.id); conditions.push(`id = $${vals.length}`) }
  if (where.recipient) { vals.push(where.recipient); conditions.push(`recipient_id = $${vals.length}`) }
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const sets = [], setVals = [...vals]
  if (typeof updates.isRead === 'boolean') { setVals.push(updates.isRead); sets.push(`is_read = $${setVals.length}`) }
  setVals.push(new Date()); sets.push(`updated_at = $${setVals.length}`)

  const res = await query(
    `UPDATE notifications SET ${sets.join(', ')} ${w} RETURNING ${COLS}`,
    setVals
  )
  return res.rows[0] || null
}

async function updateMany(where, updates) {
  const conditions = [], vals = []
  if (where.recipient) { vals.push(where.recipient); conditions.push(`recipient_id = $${vals.length}`) }
  if (typeof where.isRead === 'boolean') { vals.push(where.isRead); conditions.push(`is_read = $${vals.length}`) }
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  if (typeof updates.isRead === 'boolean') { vals.push(updates.isRead) }
  vals.push(new Date())

  let i = conditions.length + 1
  const sets = []
  if (typeof updates.isRead === 'boolean') sets.push(`is_read = $${i++}`)
  sets.push(`updated_at = $${i}`)

  await query(`UPDATE notifications SET ${sets.join(', ')} ${w}`, vals)
}

module.exports = { find, countDocuments, create, insertMany, findOneAndUpdate, updateMany }
