const { query } = require('../db')

const TRAVEL_COLS = `
  tr.id, tr.employee_id AS "employeeId", tr.destination, tr.purpose,
  tr.start_date AS "startDate", tr.end_date AS "endDate",
  tr.estimated_cost AS "estimatedCost", tr.status, tr.priority,
  tr.reviewed_by AS "reviewedBy", tr.review_comments AS "reviewComments",
  tr.review_date AS "reviewDate",
  tr.manager_status AS "managerStatus",
  tr.manager_reviewed_by AS "managerReviewedBy",
  tr.manager_review_comments AS "managerReviewComments",
  tr.manager_review_date AS "managerReviewDate",
  tr.admin_status AS "adminStatus",
  tr.admin_reviewed_by AS "adminReviewedBy",
  tr.admin_review_comments AS "adminReviewComments",
  tr.admin_review_date AS "adminReviewDate",
  tr.document_url AS "documentUrl",
  tr.created_at AS "createdAt", tr.updated_at AS "updatedAt"
`

/** Shape a flat joined row into nested employee/manager objects */
function _shape(row) {
  if (!row) return null
  const r = { ...row }
  r.employee = {
    id: r.emp_id,
    firstName: r.emp_first_name,
    lastName: r.emp_last_name,
    email: r.emp_email,
    department: r.emp_department,
    role: r.emp_role,
    manager: r.mgr_id
      ? { id: r.mgr_id, firstName: r.mgr_first_name, lastName: r.mgr_last_name, email: r.mgr_email }
      : null,
  }
  // Clean up flat join columns
  for (const k of ['emp_id','emp_first_name','emp_last_name','emp_email','emp_department','emp_role',
                    'mgr_id','mgr_first_name','mgr_last_name','mgr_email']) delete r[k]
  return r
}

const JOIN_EMPLOYEE = `
  LEFT JOIN users emp ON emp.id = tr.employee_id
  LEFT JOIN users mgr ON mgr.id = emp.manager_id
`
const EMPLOYEE_COLS = `,
  emp.id AS emp_id, emp.first_name AS emp_first_name, emp.last_name AS emp_last_name,
  emp.email AS emp_email, emp.department AS emp_department, emp.role AS emp_role,
  mgr.id AS mgr_id, mgr.first_name AS mgr_first_name, mgr.last_name AS mgr_last_name,
  mgr.email AS mgr_email
`

async function findById(id) {
  const res = await query(
    `SELECT ${TRAVEL_COLS} ${EMPLOYEE_COLS} FROM travel_requests tr ${JOIN_EMPLOYEE} WHERE tr.id = $1`,
    [id]
  )
  return _shape(res.rows[0])
}

async function find(where = {}, { limit = 10, skip = 0 } = {}) {
  const { conditions, vals } = _buildWhere(where)
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  vals.push(limit, skip)

  const res = await query(
    `SELECT ${TRAVEL_COLS} ${EMPLOYEE_COLS}
     FROM travel_requests tr ${JOIN_EMPLOYEE}
     ${whereClause}
     ORDER BY tr.created_at DESC
     LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  )
  return res.rows.map(_shape)
}

async function countDocuments(where = {}) {
  const { conditions, vals } = _buildWhere(where)
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(
    `SELECT COUNT(*) FROM travel_requests tr ${whereClause}`,
    vals
  )
  return parseInt(res.rows[0].count, 10)
}

async function create(data) {
  const res = await query(
    `INSERT INTO travel_requests
      (employee_id, destination, purpose, start_date, end_date,
       estimated_cost, status, priority, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
     RETURNING id`,
    [
      data.employee,
      data.destination,
      data.purpose,
      data.startDate,
      data.endDate,
      data.estimatedCost,
      data.status || 'Pending',
      data.priority || 'Medium',
    ]
  )
  return findById(res.rows[0].id)
}

async function updateById(id, data) {
  const sets = []
  const vals = []

  const fieldMap = {
    status: 'status',
    reviewedBy: 'reviewed_by',
    reviewComments: 'review_comments',
    reviewDate: 'review_date',
    managerStatus: 'manager_status',
    managerReviewedBy: 'manager_reviewed_by',
    managerReviewComments: 'manager_review_comments',
    managerReviewDate: 'manager_review_date',
    adminStatus: 'admin_status',
    adminReviewedBy: 'admin_reviewed_by',
    adminReviewComments: 'admin_review_comments',
    adminReviewDate: 'admin_review_date',
    documentUrl: 'document_url',
  }

  for (const [key, col] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) {
      vals.push(data[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }

  if (sets.length === 0) return findById(id)

  vals.push(new Date())
  sets.push(`updated_at = $${vals.length}`)
  vals.push(id)

  await query(
    `UPDATE travel_requests SET ${sets.join(', ')} WHERE id = $${vals.length}`,
    vals
  )
  return findById(id)
}

async function findForExport(where = {}) {
  const { conditions, vals } = _buildWhere(where)
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(
    `SELECT ${TRAVEL_COLS} ${EMPLOYEE_COLS}
     FROM travel_requests tr ${JOIN_EMPLOYEE}
     ${whereClause}
     ORDER BY tr.created_at DESC`,
    vals
  )
  return res.rows.map(_shape)
}

// Build WHERE clauses from a filter object
function _buildWhere(where) {
  const conditions = []
  const vals = []

  if (where.employee) {
    vals.push(where.employee)
    conditions.push(`tr.employee_id = $${vals.length}`)
  }
  if (where.status) {
    vals.push(where.status)
    conditions.push(`tr.status = $${vals.length}`)
  }
  if (where.employeeIds) {
    // Array of IDs
    if (where.employeeIds.length === 0) {
      conditions.push(`1=0`)
    } else {
      vals.push(where.employeeIds)
      conditions.push(`tr.employee_id = ANY($${vals.length})`)
    }
  }
  if (where.createdAtGte) {
    vals.push(where.createdAtGte)
    conditions.push(`tr.created_at >= $${vals.length}`)
  }
  if (where.createdAtLt) {
    vals.push(where.createdAtLt)
    conditions.push(`tr.created_at < $${vals.length}`)
  }

  return { conditions, vals }
}

module.exports = { findById, find, countDocuments, create, updateById, findForExport }
