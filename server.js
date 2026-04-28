const rateLimit = require('express-rate-limit');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware to protect admin routes
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/admin/login');
  }
  next();
}

function requirePermission(perm) {
  return async (req, res, next) => {
    if (req.session.user.role === 'admin') return next();
    const result = await pool.query('SELECT * FROM user_permissions WHERE username = $1', [req.session.user.username]);
    if (result.rows[0] && result.rows[0][perm] === true) return next();
    res.status(403).send('You do not have permission for this task');
  };
}

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Email alerts
let transporter = null;
let ADMIN_EMAIL = '';

async function loadEmailSettings() {
  try {
    const res = await pool.query(`SELECT key, value FROM settings WHERE key IN ('alert_email_user', 'alert_email_pass', 'admin_email')`);
    const settings = Object.fromEntries(res.rows.map(r => [r.key, r.value]));

    ADMIN_EMAIL = settings.admin_email || '';

    if (settings.alert_email_user && settings.alert_email_pass) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: settings.alert_email_user,
          pass: settings.alert_email_pass
        }
      });
      console.log('✅ Email alerts enabled');
    } else {
      transporter = null;
    }
  } catch (err) {
    console.error('Failed to load email settings:', err);
  }
}

// Audit log helper
async function logAction(username, action, details = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (username, action, details) VALUES ($1, $2, $3)',
      [username, action, JSON.stringify(details)]
    );

    const securityActions = ['LOGIN_FAIL', 'PASSWORD_CHANGE_SUCCESS', 'USER_CREATED', 'PERMISSION_CHANGED'];
    if (securityActions.includes(action) && transporter && ADMIN_EMAIL) {
      transporter.sendMail({
        from: ADMIN_EMAIL,
        to: ADMIN_EMAIL,
        subject: `[Ssewasswa API] Security Alert: ${action}`,
        text: `User: ${username}\nAction: ${action}\nDetails: ${JSON.stringify(details, null, 2)}\nTime: ${new Date().toLocaleString()}`
      }).catch(err => console.error('Email alert failed:', err));
    }
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

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
      username VARCHAR(50) PRIMARY KEY REFERENCES admins(username) ON DELETE CASCADE,
      can_manage_users BOOLEAN DEFAULT false,
      can_manage_terms BOOLEAN DEFAULT true,
      can_view_reports BOOLEAN DEFAULT true,
      can_record_payments BOOLEAN DEFAULT true,
      can_manage_students BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      class VARCHAR(50) NOT NULL,
      term VARCHAR(20) NOT NULL,
      year INTEGER NOT NULL,
      total_fees INTEGER NOT NULL,
      balance INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      payment_date DATE DEFAULT CURRENT_DATE,
      method VARCHAR(50),
      reference VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      number VARCHAR(50),
      account_name VARCHAR(100),
      instructions TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50),
      action VARCHAR(100),
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT
    );
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS assigned_class TEXT;
  `);
  console.log('✅ Database ready');
}

initDB();
loadEmailSettings();

// HEALTH
app.get('/health', (req, res) => res.json({ status: 'API is running' }));

// LOGIN
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}</style>
  </head><body><div class="card"><h2>Staff Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form>
  </div></body></html>`);
});

app.post('/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      await logAction(username, 'LOGIN_FAIL', { reason: 'User not found' });
      return res.status(401).send('Invalid credentials');
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await logAction(username, 'LOGIN_FAIL', { reason: 'Wrong password' });
      return res.status(401).send('Invalid credentials');
    }
    req.session.user = { id: user.id, username: user.username, role: user.role, assigned_class: user.assigned_class };
    await logAction(username, 'LOGIN_SUCCESS', {});
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// DASHBOARD
app.get('/admin', requireLogin, async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
  <style>body{font-family:Arial;max-width:800px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px 10px 0 0}</style>
  </head><body><div class="card">
    <h1>Admin Dashboard</h1>
    <p>Logged in as: ${req.session.user.username} (${req.session.user.role})</p>
    <a href="/admin/users/add" class="btn">Create User</a>
    <a href="/admin/students" class="btn">All Students</a>
    <a href="/admin/payments/add" class="btn">Record Payment</a>
    <a href="/admin/settings" class="btn">Settings</a>
    <a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a>
  </div></body></html>`);
});

// CLASS VIEW - ONLY ONE VERSION
app.get('/admin/class/:className', requireLogin, async (req, res) => {
  const className = req.params.className;
  const user = req.session.user;

  if (user.role === 'class_teacher' && user.assigned_class!== className) {
    return res.status(403).send('Access denied: You can only view your assigned class: ' + user.assigned_class);
  }

  try {
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
    res.send(`
      <h1>${className} Students</h1>
      <table border="1" cellpadding="10">
        <tr><th>Name</th><th>Balance</th></tr>
        ${students.rows.map(s => `<tr><td>${s.name}</td><td>UGX ${Number(s.balance).toLocaleString()}</td></tr>`).join('')}
      </table>
      <br><a href="/admin">Back to Dashboard</a>
    `);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// CREATE USER - GET
app.get('/admin/users/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:500px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Create New Staff</h2>
  <form method="POST" action="/admin/users/add">
    <label>Username:</label>
    <input name="username" required>
    <label>Password:</label>
    <input type="password" name="password" required>
    <label>Role:</label>
    <select name="role" required>
      <option value="admin">Admin - Full Access</option>
      <option value="bursar">Bursar - Fees Only</option>
      <option value="class_teacher">Class Teacher - Own Class Only</option>
    </select>
    <label>Assign to Class (for Class Teachers):</label>
    <select name="assigned_class">
      <option value="">None</option>
      <option value="P1">P1</option>
      <option value="P2">P2</option>
      <option value="P3">P3</option>
      <option value="P4">P4</option>
      <option value="P5">P5</option>
      <option value="P6">P6</option>
      <option value="P7">P7</option>
    </select>
    <button type="submit">Create User</button>
  </form><a href="/admin">Back</a></div></body></html>`);
});

// CREATE USER - POST
app.post('/admin/users/add', requireLogin, async (req, res) => {
  try {
    const { username, password, role, assigned_class } = req.body;
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO admins (username, password, role, assigned_class) VALUES ($1, $2, $3, $4)',
      [username, hash, role, assigned_class || null]
    );

    await logAction(req.session.user.username, 'USER_CREATED', { newUser: username, role, assigned_class });
    res.send(`User ${username} created. <a href="/admin">Dashboard</a>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));