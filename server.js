const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ========== MIDDLEWARE ==========
const requireLogin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.session.adminId) return res.redirect('/admin/login');
    if (!roles.includes(req.session.adminRole)) {
      return res.status(403).send('Access denied');
    }
    next();
  };
};

const requirePermission = (permission) => {
  return async (req, res, next) => {
    if (!req.session.adminId) return res.status(401).json({ error: 'Not logged in' });

    if (req.session.adminRole === 'admin') return next();

    const result = await pool.query(
      'SELECT * FROM user_permissions WHERE username = $1',
      [req.session.adminUsername]
    );

    if (result.rows.length === 0 ||!result.rows[0][permission]) {
      return res.status(403).send('You do not have permission for this task');
    }
    next();
  };
};

// ========== DATABASE SETUP ==========
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'bursar',
      full_name VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS user_permissions (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) REFERENCES admins(username) ON DELETE CASCADE,
      can_manage_users BOOLEAN DEFAULT false,
      can_manage_terms BOOLEAN DEFAULT false,
      can_view_reports BOOLEAN DEFAULT true,
      can_record_payments BOOLEAN DEFAULT true,
      can_manage_students BOOLEAN DEFAULT true,
      UNIQUE(username)
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      class VARCHAR(50) DEFAULT 'P.6',
      term VARCHAR(20) DEFAULT 'term1',
      year INTEGER DEFAULT 2025,
      total_fees INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      parent_phone VARCHAR(20),
      parent_name VARCHAR(100),
      is_active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      method VARCHAR(50),
      reference VARCHAR(100),
      payment_date DATE DEFAULT CURRENT_DATE,
      recorded_by INTEGER REFERENCES admins(id),
      sms_sent BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      number VARCHAR(50),
      account_name VARCHAR(100),
      instructions TEXT
    );
    CREATE TABLE IF NOT EXISTS terms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      year INTEGER NOT NULL,
      start_date DATE,
      end_date DATE,
      is_current BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add missing columns for existing DBs
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'bursar'`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS full_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS class VARCHAR(50) DEFAULT 'P.6'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS term VARCHAR(20) DEFAULT 'term1'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT 2025`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS total_fees INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(50)`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by INTEGER`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN DEFAULT false`);

  // Create default admin + permissions
  const admins = await pool.query('SELECT * FROM admins');
  if (admins.rows.length === 0) {
    const hash = await bcrypt.hash('bursar123', 10);
    await pool.query('INSERT INTO admins (username, password, role, full_name) VALUES ($1, $2, $3, $4)', ['admin', hash, 'admin', 'System Admin']);
    await pool.query('INSERT INTO user_permissions (username, can_manage_users, can_manage_terms) VALUES ($1, true, true)', ['admin']);
  }
  console.log('✅ Database ready');
}
initDB();

// ========== ROUTES ==========
// Keep ALL your existing routes here. Just add these 2 new ones:

// PERMISSIONS ROUTES - ADMIN ONLY
app.get('/admin/permissions', requireLogin, requireRole(['admin']), async (req, res) => {
  const users = await pool.query(`
    SELECT a.username, a.full_name, a.role, p.*
    FROM admins a
    LEFT JOIN user_permissions p ON a.username = p.username
    ORDER BY a.username
  `);
  res.render('permissions', { users: users.rows });
});

app.post('/admin/permissions', requireLogin, requireRole(['admin']), async (req, res) => {
  const { username, permissions } = req.body;
  await pool.query(`
    INSERT INTO user_permissions (username, can_manage_users, can_manage_terms, can_view_reports, can_record_payments, can_manage_students)
    VALUES ($6, $1, $2, $3, $4, $5)
    ON CONFLICT (username) DO UPDATE SET
      can_manage_users = $1,
      can_manage_terms = $2,
      can_view_reports = $3,
      can_record_payments = $4,
      can_manage_students = $5
  `, [
    permissions.can_manage_users || false,
    permissions.can_manage_terms || false,
    permissions.can_view_reports || false,
    permissions.can_record_payments || false,
    permissions.can_manage_students || false,
    username
  ]);
  res.json({ success: true });
});

// UPDATE YOUR LOGIN TO ADD adminUsername
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  if (result.rows.length && await bcrypt.compare(password, result.rows[0].password)) {
    req.session.adminId = result.rows[0].id;
    req.session.adminRole = result.rows[0].role;
    req.session.adminName = result.rows[0].full_name || result.rows[0].username;
    req.session.adminUsername = result.rows[0].username; // <-- THIS LINE IS CRITICAL
    res.redirect('/admin');
  } else {
    res.send('Invalid login. <a href="/admin/login">Try again</a>');
  }
});

// PASTE ALL YOUR OLD ROUTES BELOW THIS LINE - /admin, /admin/users, /admin/students, etc
// Just make sure to add requirePermission() to routes you want protected

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));