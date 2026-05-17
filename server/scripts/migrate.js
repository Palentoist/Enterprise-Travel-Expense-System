require('dotenv').config()
const { query } = require('../db')

async function migrate() {
  console.log('Running migrations...')

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id                        SERIAL PRIMARY KEY,
      email                     VARCHAR(100) UNIQUE NOT NULL,
      password                  VARCHAR NOT NULL,
      role                      VARCHAR(20) NOT NULL DEFAULT 'Employee',
      first_name                VARCHAR(100) NOT NULL,
      last_name                 VARCHAR(100) NOT NULL,
      department                VARCHAR(100) DEFAULT 'General',
      is_active                 BOOLEAN DEFAULT TRUE,
      profile_picture           VARCHAR,
      profile_picture_public_id VARCHAR,
      password_updated_at       TIMESTAMPTZ,
      is_permanent              BOOLEAN DEFAULT FALSE,
      manager_id                INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reset_password_token      VARCHAR,
      reset_password_expires    TIMESTAMPTZ,
      created_at                TIMESTAMPTZ DEFAULT NOW(),
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ users table')

  await query(`
    CREATE TABLE IF NOT EXISTS travel_requests (
      id                      SERIAL PRIMARY KEY,
      employee_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      destination             VARCHAR NOT NULL,
      purpose                 VARCHAR NOT NULL,
      start_date              DATE NOT NULL,
      end_date                DATE NOT NULL,
      estimated_cost          NUMERIC(12,2) NOT NULL,
      status                  VARCHAR(20) NOT NULL DEFAULT 'Pending',
      reviewed_by             INTEGER REFERENCES users(id),
      review_comments         VARCHAR,
      review_date             TIMESTAMPTZ,
      priority                VARCHAR(10) NOT NULL DEFAULT 'Medium',
      manager_status          VARCHAR(20) NOT NULL DEFAULT 'Pending',
      manager_reviewed_by     INTEGER REFERENCES users(id),
      manager_review_comments VARCHAR,
      manager_review_date     TIMESTAMPTZ,
      admin_status            VARCHAR(20) NOT NULL DEFAULT 'Pending',
      admin_reviewed_by       INTEGER REFERENCES users(id),
      admin_review_comments   VARCHAR,
      admin_review_date       TIMESTAMPTZ,
      document_url            VARCHAR,
      created_at              TIMESTAMPTZ DEFAULT NOW(),
      updated_at              TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ travel_requests table')

  await query(`
    CREATE TABLE IF NOT EXISTS expense_claims (
      id                      SERIAL PRIMARY KEY,
      employee_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      travel_request_id       INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
      amount                  NUMERIC(12,2) NOT NULL,
      description             VARCHAR NOT NULL,
      expense_date            DATE NOT NULL,
      category                VARCHAR(30) NOT NULL,
      status                  VARCHAR(20) NOT NULL DEFAULT 'Pending',
      reviewed_by             INTEGER REFERENCES users(id),
      review_comments         VARCHAR,
      review_date             TIMESTAMPTZ,
      receipt_url             VARCHAR,
      manager_status          VARCHAR(20) NOT NULL DEFAULT 'Pending',
      manager_reviewed_by     INTEGER REFERENCES users(id),
      manager_review_comments VARCHAR,
      manager_review_date     TIMESTAMPTZ,
      admin_status            VARCHAR(20) NOT NULL DEFAULT 'Pending',
      admin_reviewed_by       INTEGER REFERENCES users(id),
      admin_review_comments   VARCHAR,
      admin_review_date       TIMESTAMPTZ,
      created_at              TIMESTAMPTZ DEFAULT NOW(),
      updated_at              TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ expense_claims table')

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id            SERIAL PRIMARY KEY,
      recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         VARCHAR NOT NULL,
      message       VARCHAR NOT NULL,
      type          VARCHAR(50) NOT NULL,
      is_read       BOOLEAN DEFAULT FALSE,
      related_id    INTEGER,
      related_model VARCHAR(50),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ notifications table')

  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      action     VARCHAR NOT NULL,
      details    VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✓ audit_logs table')

  console.log('All migrations complete.')
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
