const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err)
})

/**
 * Run a parameterized SQL query.
 * @param {string} text - SQL string with $1, $2... placeholders
 * @param {Array} params - parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => pool.query(text, params)

/**
 * Get a client from the pool (for transactions).
 */
const getClient = () => pool.connect()

module.exports = { query, getClient, pool }
