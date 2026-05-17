const express = require('express')
const { query } = require('../db')
const { auth } = require('../middleware/auth')

const router = express.Router()

// Get dashboard statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const userId = req.user.id
    const isEmployee = req.user.role === 'Employee'

    // --- Travel request stats ---
    let travelStatsQuery, travelStatsParams
    if (isEmployee) {
      travelStatsQuery = `
        SELECT status AS "_id", COUNT(*) AS count, SUM(estimated_cost) AS "totalCost"
        FROM travel_requests
        WHERE employee_id = $1
        GROUP BY status`
      travelStatsParams = [userId]
    } else {
      travelStatsQuery = `
        SELECT status AS "_id", COUNT(*) AS count, SUM(estimated_cost) AS "totalCost"
        FROM travel_requests
        GROUP BY status`
      travelStatsParams = []
    }
    const travelStatsRes = await query(travelStatsQuery, travelStatsParams)
    const travelStats = travelStatsRes.rows.map(r => ({
      _id: r._id,
      count: parseInt(r.count, 10),
      totalCost: parseFloat(r.totalCost) || 0,
    }))

    // --- Expense claim stats ---
    let expenseStatsQuery, expenseStatsParams
    if (isEmployee) {
      expenseStatsQuery = `
        SELECT status AS "_id", COUNT(*) AS count, SUM(amount) AS "totalAmount"
        FROM expense_claims
        WHERE employee_id = $1
        GROUP BY status`
      expenseStatsParams = [userId]
    } else {
      expenseStatsQuery = `
        SELECT status AS "_id", COUNT(*) AS count, SUM(amount) AS "totalAmount"
        FROM expense_claims
        GROUP BY status`
      expenseStatsParams = []
    }
    const expenseStatsRes = await query(expenseStatsQuery, expenseStatsParams)
    const expenseStats = expenseStatsRes.rows.map(r => ({
      _id: r._id,
      count: parseInt(r.count, 10),
      totalAmount: parseFloat(r.totalAmount) || 0,
    }))

    // --- Monthly expense trends (last 12 months, approved only) ---
    let monthlyQuery, monthlyParams
    if (isEmployee) {
      monthlyQuery = `
        SELECT
          EXTRACT(YEAR FROM expense_date)::int AS year,
          EXTRACT(MONTH FROM expense_date)::int AS month,
          SUM(amount) AS "totalAmount",
          COUNT(*) AS count
        FROM expense_claims
        WHERE status = 'Approved' AND employee_id = $1
        GROUP BY year, month
        ORDER BY year DESC, month DESC
        LIMIT 12`
      monthlyParams = [userId]
    } else {
      monthlyQuery = `
        SELECT
          EXTRACT(YEAR FROM expense_date)::int AS year,
          EXTRACT(MONTH FROM expense_date)::int AS month,
          SUM(amount) AS "totalAmount",
          COUNT(*) AS count
        FROM expense_claims
        WHERE status = 'Approved'
        GROUP BY year, month
        ORDER BY year DESC, month DESC
        LIMIT 12`
      monthlyParams = []
    }
    const monthlyRes = await query(monthlyQuery, monthlyParams)
    const monthlyExpenses = monthlyRes.rows.map(r => ({
      _id: { year: r.year, month: r.month },
      totalAmount: parseFloat(r.totalAmount) || 0,
      count: parseInt(r.count, 10),
    }))

    // --- Recent travel requests ---
    let recentTravelQuery, recentTravelParams
    if (isEmployee) {
      recentTravelQuery = `
        SELECT tr.id, tr.destination, tr.status, tr.created_at AS "createdAt",
               u.first_name AS emp_first_name, u.last_name AS emp_last_name
        FROM travel_requests tr
        LEFT JOIN users u ON u.id = tr.employee_id
        WHERE tr.employee_id = $1
        ORDER BY tr.created_at DESC LIMIT 5`
      recentTravelParams = [userId]
    } else {
      recentTravelQuery = `
        SELECT tr.id, tr.destination, tr.status, tr.created_at AS "createdAt",
               u.first_name AS emp_first_name, u.last_name AS emp_last_name
        FROM travel_requests tr
        LEFT JOIN users u ON u.id = tr.employee_id
        ORDER BY tr.created_at DESC LIMIT 5`
      recentTravelParams = []
    }
    const recentTravelRes = await query(recentTravelQuery, recentTravelParams)
    const recentTravelRequests = recentTravelRes.rows.map(r => ({
      id: r.id, destination: r.destination, status: r.status, createdAt: r.createdAt,
      employee: { firstName: r.emp_first_name, lastName: r.emp_last_name },
    }))

    // --- Recent expense claims ---
    let recentExpenseQuery, recentExpenseParams
    if (isEmployee) {
      recentExpenseQuery = `
        SELECT ec.id, ec.amount, ec.status, ec.created_at AS "createdAt",
               u.first_name AS emp_first_name, u.last_name AS emp_last_name,
               tr.destination
        FROM expense_claims ec
        LEFT JOIN users u ON u.id = ec.employee_id
        LEFT JOIN travel_requests tr ON tr.id = ec.travel_request_id
        WHERE ec.employee_id = $1
        ORDER BY ec.created_at DESC LIMIT 5`
      recentExpenseParams = [userId]
    } else {
      recentExpenseQuery = `
        SELECT ec.id, ec.amount, ec.status, ec.created_at AS "createdAt",
               u.first_name AS emp_first_name, u.last_name AS emp_last_name,
               tr.destination
        FROM expense_claims ec
        LEFT JOIN users u ON u.id = ec.employee_id
        LEFT JOIN travel_requests tr ON tr.id = ec.travel_request_id
        ORDER BY ec.created_at DESC LIMIT 5`
      recentExpenseParams = []
    }
    const recentExpenseRes = await query(recentExpenseQuery, recentExpenseParams)
    const recentExpenseClaims = recentExpenseRes.rows.map(r => ({
      id: r.id, amount: r.amount, status: r.status, createdAt: r.createdAt,
      employee: { firstName: r.emp_first_name, lastName: r.emp_last_name },
      travelRequest: { destination: r.destination },
    }))

    res.json({ travelStats, expenseStats, monthlyExpenses, recentTravelRequests, recentExpenseClaims })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Server error' })
  }
})

module.exports = router
