require('dotenv').config()
const User = require('../models/User')
const { pool } = require('../db')

const seedDatabase = async () => {
  try {
    console.log('Connected to PostgreSQL')

    // Clear tables in order (respect FK constraints)
    await pool.query('DELETE FROM audit_logs')
    await pool.query('DELETE FROM notifications')
    await pool.query('DELETE FROM expense_claims')
    await pool.query('DELETE FROM travel_requests')
    await pool.query('DELETE FROM users')
    // Reset sequences
    await pool.query('ALTER SEQUENCE users_id_seq RESTART WITH 1')
    await pool.query('ALTER SEQUENCE travel_requests_id_seq RESTART WITH 1')
    await pool.query('ALTER SEQUENCE expense_claims_id_seq RESTART WITH 1')
    await pool.query('ALTER SEQUENCE notifications_id_seq RESTART WITH 1')
    await pool.query('ALTER SEQUENCE audit_logs_id_seq RESTART WITH 1')
    console.log('Cleared existing data')

    const admin = await User.create({
      email: 'admin@example.com',
      password: 'admin123',
      firstName: 'Admin',
      lastName: '1',
      role: 'Admin',
      isActive: true,
      isPermanent: true,
    })
    console.log('Seeded: 1 Admin (id:', admin.id, ')')

    const manager = await User.create({
      email: 'manager@example.com',
      password: 'manager123',
      firstName: 'Manager',
      lastName: '1',
      role: 'Manager',
      isActive: true,
      department: 'Sales',
    })
    console.log('Seeded: 1 Manager (id:', manager.id, ')')

    const employee = await User.create({
      email: 'employee@example.com',
      password: 'employee123',
      firstName: 'Employee',
      lastName: '1',
      role: 'Employee',
      isActive: true,
      department: 'Sales',
      managerId: manager.id,
    })
    console.log('Seeded: 1 Employee (id:', employee.id, ', assigned to Manager)')

    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Error seeding database:', error)
    await pool.end()
    process.exit(1)
  }
}

async function seedAdmin() {
  try {
    const existing = await User.findOne({ email: 'admin2@example.com' })
    if (!existing) {
      const a = await User.create({
        email: 'admin2@example.com',
        password: 'adminpass',
        firstName: 'YourName',
        lastName: 'YourLastName',
        role: 'Admin',
        department: 'IT',
        isActive: true,
      })
      console.log('Admin user created: admin2@example.com / adminpass (id:', a.id, ')')
    } else {
      console.log('Admin user already exists.')
    }
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('Error creating admin:', error)
    await pool.end()
    process.exit(1)
  }
}

if (process.argv[2] === 'admin') {
  seedAdmin()
} else {
  seedDatabase()
}
