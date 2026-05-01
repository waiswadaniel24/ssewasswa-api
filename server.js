require('dotenv').config();
const rateLimit = require('express-rate-limit');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const multer = require('multer');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const upload = multer({ dest: '/tmp/' });
const app = express();
const PORT = process.env.PORT || 3000;

// 1. DATABASE POOL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

// 2. MIDDLEWARE
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// 3. SESSION
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

// 4. MIDDLEWARE FUNCTIONS
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session.role ||!roles.includes(req.session.role)) {
      return res.status(403).send('Access denied: Insufficient role');
    }
    next();
  };
}

function requireTask(taskName) {
  return async (req, res, next) => {
    const userRole = req.session.role;
    if (userRole === 'admin') return next();
    try {
      const result = await pool.query('SELECT * FROM staff_tasks WHERE username = $1 AND task_name = $2 AND active = true', [req.session.username, taskName]);
      if (result.rows.length > 0) return next();
      res.status(403).send(`Access denied: You need to be tasked for "${taskName}" by admin`);
    } catch (err) {
      console.error('Task check error:', err);
      res.status(500).send('Task check failed');
    }
  };
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts.' });

// CONSTANTS
const ALL_CLASSES = ['Baby Class', 'Middle Class', 'Top Class', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const NURSERY_CLASSES = ['Baby Class', 'Middle Class', 'Top Class'];
const PRIMARY_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

// DATABASE INIT - ADDS MISSING COLUMNS TO USERS TABLE
async function initDB() {
  try {
    // Add missing columns to existing users table
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'bursar';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_class TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(50) DEFAULT 'Academic';
    `).catch(e => console.log('Alter users:', e.message));

    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, class VARCHAR(50) NOT NULL,
        term VARCHAR(20) NOT NULL, year INTEGER NOT NULL, total_fees INTEGER NOT NULL, balance INTEGER NOT NULL,
        parent_name VARCHAR(100), parent_phone VARCHAR(50), parent_email VARCHAR(100),
        department VARCHAR(20) DEFAULT 'Primary', custom_fields JSONB DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, payment_date DATE DEFAULT CURRENT_DATE, method VARCHAR(50),
        reference VARCHAR(100), recorded_by VARCHAR(50)
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY, username VARCHAR(50), action VARCHAR(100), details TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (key VARCHAR(50) PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS staff_tasks (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        task_name VARCHAR(100) NOT NULL, assigned_by VARCHAR(50), assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, class VARCHAR(50) NOT NULL,
        department VARCHAR(20) DEFAULT 'Primary', max_marks INTEGER DEFAULT 100, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS exam_results (
        id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        marks INTEGER, term VARCHAR(20), year INTEGER, recorded_by VARCHAR(50),
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, subject_id, term, year)
      );
      CREATE TABLE IF NOT EXISTS staff (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        full_name VARCHAR(100), position VARCHAR(100), department VARCHAR(100),
        phone TEXT, email VARCHAR(100), hire_date DATE,
        monthly_salary INTEGER, bank_account VARCHAR(100), emergency_contact TEXT, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS staff_assignments (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
        assignment_type VARCHAR(50), assignment_value VARCHAR(100), class_scope VARCHAR(50),
        department VARCHAR(50), start_date DATE DEFAULT CURRENT_DATE, end_date DATE, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS school_assets (
        id SERIAL PRIMARY KEY, asset_name VARCHAR(200) NOT NULL, category VARCHAR(100),
        quantity INTEGER, unit_cost INTEGER, total_value INTEGER, location VARCHAR(100),
        condition VARCHAR(50), purchased_date DATE, supplier VARCHAR(100),
        managed_by VARCHAR(50), last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS branding_config (
        school_id INTEGER PRIMARY KEY DEFAULT 1, brand_name VARCHAR(100), primary_color VARCHAR(7) DEFAULT '#667eea'
      );
      CREATE TABLE IF NOT EXISTS admin_wallet (
        id INTEGER PRIMARY KEY DEFAULT 1, total_earned INTEGER DEFAULT 0, balance INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS admin_transactions (
        id SERIAL PRIMARY KEY, type VARCHAR(50), amount INTEGER, description TEXT, reference_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS impact_fund_transactions (
        id SERIAL PRIMARY KEY, amount INTEGER, school_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const pkCheck = await pool.query(`SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'session' AND constraint_type = 'PRIMARY KEY'`);
    if (pkCheck.rows.length === 0) {
      await pool.query('ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid)').catch(() => {});
    }

    await pool.query('INSERT INTO admin_wallet (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    console.log('✅ Database ready');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

// ROUTES
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: 'connected', time: new Date() });
});

app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Staff Login</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:system-ui;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{background:white;padding:2rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,.1);width:100%;max-width:400px}
      h1{text-align:center;color:#1f2937;margin-bottom:1.5rem}
      input{width:100%;padding:.75rem;margin-bottom:1rem;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box}
      button{width:100%;padding:.75rem;background:#2563eb;color:white;border:none;border-radius:4px;font-weight:600;cursor:pointer}
      button:hover{background:#1d4ed8}
    </style></head><body><div class="box"><h1>Staff Login</h1>
      <form action="/login" method="POST">
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
      </form></div></body></html>
  `);
});

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('Login attempt:', username);

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).send('Invalid credentials');
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).send('Invalid credentials');
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.full_name = user.full_name;
    req.session.assigned_class = user.assigned_class;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session error');
      }

      if (user.role === 'admin' && user.username === 'superadmin') {
        return res.redirect('/admin/branding');
      }
      res.redirect('/admin');
    });
  } catch (err) {
    console.error('LOGIN CRASH:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/admin', requireLogin, async (req, res) => {
  const user = req.session;
  const tasks = await pool.query('SELECT task_name FROM staff_tasks WHERE username = $1 AND active = true', [user.username]);
  const userTasks = tasks.rows.map(t => t.task_name);

  if (user.role === 'admin') {
    const totals = await pool.query(`SELECT COUNT(*) as total_students, SUM(total_fees) as total_fees, SUM(balance) as total_outstanding FROM students`);
    const t = totals.rows[0] || {};

    return res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 16px;text-decoration:none;border-radius:4px;display:inline-block;margin:4px 4px 0 0;font-size:14px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat{background:#ecf0f1;padding:12px;border-radius:4px;text-align:center}</style>
    </head><body>
      <div class="card"><h1>Admin Dashboard</h1><p>Logged in as: ${user.username} (${user.role})</p></div>
      <div class="card"><h3>School Overview</h3>
        <div class="stats">
          <div class="stat"><strong>Students</strong><br>${t.total_students || 0}</div>
          <div class="stat"><strong>Fees Expected</strong><br>UGX ${Number(t.total_fees || 0).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding</strong><br>UGX ${Number(t.total_outstanding || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="card">
        ${user.username === 'superadmin'? '<a href="/admin/branding" class="btn" style="background:#e74c3c">Branding Console</a>' : ''}
        <a href="/admin/students" class="btn">All Students</a>
        <a href="/admin/users/add" class="btn">Create User</a>
      </div>
      <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    </body></html>`);
  }

  res.send(`<h1>Welcome ${user.username}</h1><p>Role: ${user.role}</p><a href="/admin/logout">Logout</a>`);
});

// BRANDING CONSOLE - God Mode only
app.get('/admin/branding', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.username!== 'superadmin') return res.status(403).send('God Mode only');
  const config = await pool.query('SELECT * FROM branding_config WHERE school_id = 1');
  const brand = config.rows[0] || {};
  res.send(`<!DOCTYPE html><html><head><title>Branding Console</title>
  <style>body{font-family:Arial;max-width:600px;margin:50px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h1>Branding Console</h1><p>100/50 Upgrade Active</p>
    <form method="POST" action="/admin/branding">
      <label>Brand Name: <input name="brand_name" value="${brand.brand_name || 'Ssewasswa School'}"></label>
      <label>Primary Color: <input name="primary_color" type="color" value="${brand.primary_color || '#667eea'}"></label>
      <button>Save Brand</button>
    </form><a href="/admin">← Dashboard</a></div></body></html>`);
});

app.post('/admin/branding', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.username!== 'superadmin') return res.status(403).send('God Mode only');
  const { brand_name, primary_color } = req.body;
  await pool.query(`INSERT INTO branding_config (school_id, brand_name, primary_color) VALUES (1,$1,$2)
    ON CONFLICT (school_id) DO UPDATE SET brand_name=$1, primary_color=$2`, [brand_name, primary_color]);
  res.redirect('/admin/branding?success=1');
});

// CREATE USER
app.get('/admin/users/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Create New Staff Member</h2>
  <form method="POST" action="/admin/users/add">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <input name="full_name" placeholder="Full Name" required>
    <input name="phone" placeholder="Phone">
    <input type="email" name="email" placeholder="Email">
    <select name="role" required>
      <option value="class_teacher">Class Teacher</option>
      <option value="subject_teacher">Subject Teacher</option>
      <option value="bursar">Bursar</option>
      <option value="admin">Admin</option>
      <option value="support_staff">Support Staff</option>
    </select>
    <button type="submit">Create Staff Member</button>
  </form><a href="/admin">Back</a></div></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, phone, email, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role, full_name, phone, email) VALUES ($1, $2, $3, $4, $5, $6)',
      [username, hash, role, full_name, phone, email]);
    res.send(`Staff ${full_name} created. <a href="/admin">Dashboard</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// Auto-Withdraw ON - Fridays 5pm EAT
cron.schedule('0 17 * * 5', async () => {
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (balance.rows[0]?.balance > 10000) {
    console.log(`Auto-withdraw UGX ${balance.rows[0].balance} triggered for Friday 5pm`);
  }
}, { timezone: "Africa/Kampala" });
// TEMP - DELETE AFTER ONE USE
app.get('/set-pass-now', async (req, res) => {
  const hash = await bcrypt.hash('Ssewasswa2026!Secure', 10);
  await pool.query(`UPDATE users SET password = $1, role = 'admin' WHERE username = 'superadmin'`, );
  res.send('Password reset to: Ssewasswa2026!Secure. Role set to admin. DELETE THIS ROUTE NOW.');
});
// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
});
