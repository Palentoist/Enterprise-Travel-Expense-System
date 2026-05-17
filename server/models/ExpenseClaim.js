const { query } = require('../db')

const EXPENSE_COLS = `
  ec.id, ec.employee_id AS "employeeId", ec.travel_request_id AS "travelRequestId",
  ec.amount, ec.description, ec.expense_date AS "expenseDate",
  ec.category, ec.status,
  ec.reviewed_by AS "reviewedBy", ec.review_comments AS "reviewComments",
  ec.review_date AS "reviewDate", ec.receipt_url AS "receiptUrl",
  ec.manager_status AS "managerStatus", ec.manager_reviewed_by AS "managerReviewedBy",
  ec.manager_review_comments AS "managerReviewComments", ec.manager_review_date AS "managerReviewDate",
  ec.admin_status AS "adminStatus", ec.admin_reviewed_by AS "adminReviewedBy",
  ec.admin_review_comments AS "adminReviewComments", ec.admin_review_date AS "adminReviewDate",
  ec.created_at AS "createdAt", ec.updated_at AS "updatedAt"
`
const JOIN_CLAUSE = `
  LEFT JOIN users emp ON emp.id = ec.employee_id
  LEFT JOIN users mgr ON mgr.id = emp.manager_id
  LEFT JOIN travel_requests tr ON tr.id = ec.travel_request_id
`
const JOIN_COLS = `,
  emp.id AS emp_id, emp.first_name AS emp_first_name, emp.last_name AS emp_last_name,
  emp.email AS emp_email, emp.department AS emp_department, emp.role AS emp_role,
  mgr.id AS mgr_id, mgr.first_name AS mgr_first_name, mgr.last_name AS mgr_last_name, mgr.email AS mgr_email,
  tr.destination AS tr_destination, tr.purpose AS tr_purpose
`

function _shape(row) {
  if (!row) return null
  const r = { ...row }
  r.employee = {
    id: r.emp_id, firstName: r.emp_first_name, lastName: r.emp_last_name,
    email: r.emp_email, department: r.emp_department, role: r.emp_role,
    manager: r.mgr_id ? { id: r.mgr_id, firstName: r.mgr_first_name, lastName: r.mgr_last_name, email: r.mgr_email } : null,
  }
  r.travelRequest = { id: r.travelRequestId, destination: r.tr_destination, purpose: r.tr_purpose }
  for (const k of ['emp_id','emp_first_name','emp_last_name','emp_email','emp_department','emp_role',
                    'mgr_id','mgr_first_name','mgr_last_name','mgr_email','tr_destination','tr_purpose']) delete r[k]
  return r
}

function _buildWhere(where) {
  const conditions = [], vals = []
  if (where.employee) { vals.push(where.employee); conditions.push(`ec.employee_id = $${vals.length}`) }
  if (where.status) { vals.push(where.status); conditions.push(`ec.status = $${vals.length}`) }
  if (where.travelRequest) { vals.push(where.travelRequest); conditions.push(`ec.travel_request_id = $${vals.length}`) }
  if (where.employeeIds) {
    if (where.employeeIds.length === 0) conditions.push(`1=0`)
    else { vals.push(where.employeeIds); conditions.push(`ec.employee_id = ANY($${vals.length})`) }
  }
  if (where.createdAtGte) { vals.push(where.createdAtGte); conditions.push(`ec.created_at >= $${vals.length}`) }
  if (where.createdAtLt) { vals.push(where.createdAtLt); conditions.push(`ec.created_at < $${vals.length}`) }
  return { conditions, vals }
}

async function findById(id) {
  const res = await query(`SELECT ${EXPENSE_COLS} ${JOIN_COLS} FROM expense_claims ec ${JOIN_CLAUSE} WHERE ec.id = $1`, [id])
  return _shape(res.rows[0])
}

async function find(where = {}, { limit = 10, skip = 0 } = {}) {
  const { conditions, vals } = _buildWhere(where)
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  vals.push(limit, skip)
  const res = await query(
    `SELECT ${EXPENSE_COLS} ${JOIN_COLS} FROM expense_claims ec ${JOIN_CLAUSE} ${w} ORDER BY ec.created_at DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  )
  return res.rows.map(_shape)
}

async function countDocuments(where = {}) {
  const { conditions, vals } = _buildWhere(where)
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(`SELECT COUNT(*) FROM expense_claims ec ${w}`, vals)
  return parseInt(res.rows[0].count, 10)
}

async function create(data) {
  const res = await query(
    `INSERT INTO expense_claims (employee_id,travel_request_id,amount,description,expense_date,category,status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW()) RETURNING id`,
    [data.employee, data.travelRequest, data.amount, data.description, data.expenseDate, data.category, data.status || 'Pending']
  )
  return findById(res.rows[0].id)
}

async function updateById(id, data) {
  const sets = [], vals = []
  const fieldMap = {
    status:'status', reviewedBy:'reviewed_by', reviewComments:'review_comments', reviewDate:'review_date', receiptUrl:'receipt_url',
    managerStatus:'manager_status', managerReviewedBy:'manager_reviewed_by', managerReviewComments:'manager_review_comments', managerReviewDate:'manager_review_date',
    adminStatus:'admin_status', adminReviewedBy:'admin_reviewed_by', adminReviewComments:'admin_review_comments', adminReviewDate:'admin_review_date',
  }
  for (const [key, col] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) { vals.push(data[key]); sets.push(`${col} = $${vals.length}`) }
  }
  if (sets.length === 0) return findById(id)
  vals.push(new Date()); sets.push(`updated_at = $${vals.length}`)
  vals.push(id)
  await query(`UPDATE expense_claims SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
  return findById(id)
}

async function findForExport(where = {}) {
  const { conditions, vals } = _buildWhere(where)
  const w = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await query(
    `SELECT ${EXPENSE_COLS} ${JOIN_COLS} FROM expense_claims ec ${JOIN_CLAUSE} ${w} ORDER BY ec.created_at DESC`, vals
  )
  return res.rows.map(_shape)
}

module.exports = { findById, find, countDocuments, create, updateById, findForExport }
