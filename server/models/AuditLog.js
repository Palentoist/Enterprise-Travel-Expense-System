const { query } = require('../db')

async function create(data) {
  const res = await query(
    `INSERT INTO audit_logs (user_id, action, details, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id, user_id AS "userId", action, details, created_at AS "createdAt"`,
    [data.user, data.action, data.details || null]
  )
  return res.rows[0]
}

async function find(where = {}) {
  const conditions = [], vals = []
  if (where.user) { vals.push(where.user); conditions.push(`al.user_id = $${vals.length}`) }
  if (where.action) { vals.push(where.action); conditions.push(`al.action = $${vals.length}`) }
  if (where.createdAtGte) { vals.push(where.createdAtGte); conditions.push(`al.created_at >= $${vals.length}`) }
  if (where.createdAtLte) { vals.push(where.createdAtLte); conditions.push(`al.created_at <= $${vals.length}`) }

  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(
    `SELECT al.id, al.action, al.details, al.created_at AS "createdAt",
            u.id AS u_id, u.first_name AS u_first_name, u.last_name AS u_last_name,
            u.email AS u_email, u.role AS u_role
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${w}
     ORDER BY al.created_at DESC`,
    vals
  )
  return res.rows.map(row => {
    const r = { ...row }
    r.user = { id: r.u_id, firstName: r.u_first_name, lastName: r.u_last_name, email: r.u_email, role: r.u_role }
    for (const k of ['u_id','u_first_name','u_last_name','u_email','u_role']) delete r[k]
    return r
  })
}

module.exports = { create, find }