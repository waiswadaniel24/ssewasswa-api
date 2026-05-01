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

// 3. SESSION - SINGLE SOURCE OF TRUTH
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

// 4. MIDDLEWARE FUNCTIONS - ONLY ONE COPY EACH
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

let transporter = null, ADMIN_EMAIL = '';
async function loadEmailSettings() {
  try {
    const res = await pool.query(`SELECT key, value FROM settings WHERE key IN ('alert_email_user', 'alert_email_pass', 'admin_email')`);
    const settings = Object.fromEntries(res.rows.map(r => [r.key, r.value]));
    ADMIN_EMAIL = settings.admin_email || '';
    if (settings.alert_email_user && settings.alert_email_pass) {
      transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: settings.alert_email_user, pass: settings.alert_email_pass } });
      console.log('✅ Email alerts enabled');
    }
  } catch (err) { console.error('Failed to load email settings:', err); }
}

async function logAction(username, action, details = {}) {
  try {
    await pool.query('INSERT INTO audit_logs (username, action, details) VALUES ($1, $2, $3)', [username, action, JSON.stringify(details)]);
    const securityActions = ['LOGIN_FAIL', 'USER_CREATED', 'TASK_ASSIGNED', 'DONOR_ADDED', 'DONATION_RECORDED', 'SALARY_PAID', 'ASSET_ADDED', 'MARKS_UPLOADED'];
    if (securityActions.includes(action) && transporter && ADMIN_EMAIL) {
      transporter.sendMail({
        from: ADMIN_EMAIL, to: ADMIN_EMAIL,
        subject: `[Ssewasswa API] Alert: ${action}`,
        text: `User: ${username}\nAction: ${action}\nDetails: ${JSON.stringify(details, null, 2)}\nTime: ${new Date().toLocaleString()}`
      }).catch(err => console.error('Email alert failed:', err));
    }
  } catch (err) { console.error('Audit log failed:', err); }
}

// CONSTANTS
const ALL_CLASSES = ['Baby Class', 'Middle Class', 'Top Class', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const NURSERY_CLASSES = ['Baby Class', 'Middle Class', 'Top Class'];
const PRIMARY_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const DUTY_TYPES = ['Cook', 'Stores Manager', 'Games Master', 'Matron', 'Patron', 'Security', 'Cleaner', 'Librarian', 'Nurse', 'Driver'];
const DEPARTMENTS = ['Nursery', 'Primary', 'Administration', 'Support Staff'];

// DATABASE INIT
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'bursar', full_name VARCHAR(100), assigned_class TEXT,
        phone TEXT, email VARCHAR(100), department VARCHAR(50) DEFAULT 'Academic'
      );
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
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL COLLATE "default", sess JSON NOT NULL, expire TIMESTAMP(6) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
      CREATE TABLE IF NOT EXISTS staff_tasks (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES admins(username) ON DELETE CASCADE,
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
      CREATE TABLE IF NOT EXISTS online_classes (
        id SERIAL PRIMARY KEY, class VARCHAR(50), subject VARCHAR(100), topic VARCHAR(200),
        meeting_link TEXT, scheduled_at TIMESTAMP, created_by VARCHAR(50)
      );
      CREATE TABLE IF NOT EXISTS donors (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100),
        phone VARCHAR(50), organization VARCHAR(100), address TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS donations (
        id SERIAL PRIMARY KEY, donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, purpose VARCHAR(200), donation_date DATE DEFAULT CURRENT_DATE,
        method VARCHAR(50), reference VARCHAR(100), recorded_by VARCHAR(50)
      );
      CREATE TABLE IF NOT EXISTS staff (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES admins(username) ON DELETE CASCADE,
        full_name VARCHAR(100), position VARCHAR(100), department VARCHAR(100),
        phone TEXT, email VARCHAR(100), hire_date DATE,
        monthly_salary INTEGER, bank_account VARCHAR(100), emergency_contact TEXT, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS salary_payments (
        id SERIAL PRIMARY KEY, staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, month VARCHAR(20), year INTEGER,
        payment_date DATE DEFAULT CURRENT_DATE, method VARCHAR(50),
        reference VARCHAR(100), paid_by VARCHAR(50)
      );
      CREATE TABLE IF NOT EXISTS staff_assignments (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES admins(username) ON DELETE CASCADE,
        assignment_type VARCHAR(50), assignment_value VARCHAR(100), class_scope VARCHAR(50),
        department VARCHAR(50), start_date DATE DEFAULT CURRENT_DATE, end_date DATE, active BOOLEAN DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS school_assets (
        id SERIAL PRIMARY KEY, asset_name VARCHAR(200) NOT NULL, category VARCHAR(100),
        quantity INTEGER, unit_cost INTEGER, total_value INTEGER, location VARCHAR(100),
        condition VARCHAR(50), purchased_date DATE, supplier VARCHAR(100),
        managed_by VARCHAR(50), last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS student_field_definitions (
        id SERIAL PRIMARY KEY, field_name VARCHAR(100) UNIQUE NOT NULL,
        field_type VARCHAR(50), field_options JSONB, required BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true
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
      await pool.query('ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid)');
    }

    const subjCount = await pool.query('SELECT COUNT(*) FROM subjects');
    if (subjCount.rows[0].count == 0) {
      const nurserySubjects = ['Number Work', 'Language Development', 'Social Development', 'Health Habits', 'Creative Arts'];
      const primarySubjects = ['Mathematics', 'English', 'Science', 'Social Studies', 'R.E'];
      for (const cls of NURSERY_CLASSES) {
        for (const subj of nurserySubjects) {
          await pool.query('INSERT INTO subjects (name, class, department) VALUES ($1, $2, $3)', [subj, cls, 'Nursery']);
        }
      }
      for (const cls of PRIMARY_CLASSES) {
        for (const subj of primarySubjects) {
          await pool.query('INSERT INTO subjects (name, class, department) VALUES ($1, $2, $3)', [subj, cls, 'Primary']);
        }
      }
    }

    const adminCheck = await pool.query('SELECT * FROM admins WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query('INSERT INTO admins (username, password, role, full_name) VALUES ($1, $2, $3, $4)',
        ['admin', hash, 'admin', 'System Admin']);
      console.log('✅ Default admin created: admin/admin123');
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

// LOGIN - SINGLE VERSION USING ADMINS TABLE
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

    await logAction(username, 'LOGIN_SUCCESS', {});
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
    const donorTotals = await pool.query(`SELECT COUNT(*) as total_donors, SUM(amount) as total_donated FROM donations`);
    const staffTotals = await pool.query(`SELECT COUNT(*) as total_staff, SUM(monthly_salary) as total_payroll FROM staff WHERE active = true`);
    const assetTotals = await pool.query(`SELECT COUNT(*) as total_assets, SUM(total_value) as assets_value FROM school_assets`);
    const t = totals.rows[0], d = donorTotals.rows[0], s = staffTotals.rows[0], a = assetTotals.rows[0];

    return res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 16px;text-decoration:none;border-radius:4px;display:inline-block;margin:4px 4px 0 0;font-size:14px}.portal{background:#9b59b6}.donor{background:#e67e22}.staff{background:#16a085}.asset{background:#8e44ad}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat{background:#ecf0f1;padding:12px;border-radius:4px;text-align:center}.section-title{margin:15px 0 10px 0;color:#34495e;border-bottom:2px solid #3498db;padding-bottom:5px}</style>
    </head><body>
      <div class="card"><h1>Admin Dashboard - Ssewasswa School ERP</h1><p>Logged in as: ${user.username} (${user.role})</p></div>
      <div class="card"><h3>School Overview</h3>
        <div class="stats">
          <div class="stat"><strong>Students</strong><br>${t.total_students}</div>
          <div class="stat"><strong>Fees Expected</strong><br>UGX ${Number(t.total_fees || 0).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding</strong><br>UGX ${Number(t.total_outstanding || 0).toLocaleString()}</div>
          <div class="stat"><strong>Donations</strong><br>UGX ${Number(d.total_donated || 0).toLocaleString()}</div>
          <div class="stat"><strong>Staff</strong><br>${s.total_staff}</div>
          <div class="stat"><strong>Monthly Payroll</strong><br>UGX ${Number(s.total_payroll || 0).toLocaleString()}</div>
          <div class="stat"><strong>School Assets</strong><br>${a.total_assets}</div>
          <div class="stat"><strong>Assets Value</strong><br>UGX ${Number(a.assets_value || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">📚 Academic Portals</h3>
        <a href="/admin/academic" class="btn portal">Academic Portal</a>
        <a href="/admin/marksheets" class="btn portal">Marksheets</a>
        <a href="/admin/subjects" class="btn portal">Manage Subjects</a>
        <a href="/admin/online-classes" class="btn portal">Online Classes</a>
        <h3 class="section-title">💰 Financial Portals</h3>
        <a href="/admin/financial" class="btn portal">Financial Portal</a>
        <a href="/admin/donors" class="btn donor">Donors Portal</a>
        <a href="/admin/staff/payroll" class="btn staff">Staff Payroll</a>
        <a href="/admin/assets" class="btn asset">School Assets/Stores</a>
        <h3 class="section-title">👥 Staff Management</h3>
        <a href="/admin/staff" class="btn staff">All Staff</a>
        <a href="/admin/assignments" class="btn staff">Staff Assignments</a>
        <a href="/admin/tasks" class="btn portal">Assign Portal Tasks</a>
        <a href="/admin/users/add" class="btn">Create User</a>
        <h3 class="section-title">⚙️ System</h3>
        <a href="/admin/fields" class="btn portal">Custom Student Fields</a>
        <a href="/admin/students" class="btn">All Students</a>
        ${user.username === 'superadmin'? '<a href="/admin/branding" class="btn" style="background:#e74c3c">Branding Console</a>' : ''}
      </div>
      <div class="card"><h3 class="section-title">Quick Access by Class</h3>
        <strong>Nursery:</strong> ${NURSERY_CLASSES.map(c => `<a href="/admin/class/${c}" class="btn" style="background:#f39c12">${c}</a>`).join('')}<br><br>
        <strong>Primary:</strong> ${PRIMARY_CLASSES.map(c => `<a href="/admin/class/${c}" class="btn">${c}</a>`).join('')}
      </div>
      <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    </body></html>`);
  }

  let portalButtons = '';
  if (userTasks.includes('financial_portal')) portalButtons += '<a href="/admin/financial" class="btn portal">💰 Financial Portal</a>';
  if (userTasks.includes('academic_portal')) portalButtons += '<a href="/admin/academic" class="btn portal">📚 Academic Portal</a>';
  if (userTasks.includes('marksheets')) portalButtons += '<a href="/admin/marksheets" class="btn portal">📊 Marksheets</a>';
  if (userTasks.includes('donors_portal')) portalButtons += '<a href="/admin/donors" class="btn donor">🤝 Donors Portal</a>';
  if (userTasks.includes('staff_management')) portalButtons += '<a href="/admin/staff" class="btn staff">👥 Staff</a>';
  if (userTasks.includes('assets')) portalButtons += '<a href="/admin/assets" class="btn asset">📦 Assets</a>';

  res.send(`<!DOCTYPE html><html><head><title>Dashboard</title>
  <style>body{font-family:Arial;max-width:900px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:8px 8px 0 0}.portal{background:#9b59b6}.donor{background:#e67e22}.staff{background:#16a085}.asset{background:#8e44ad}</style>
  </head><body><div class="card"><h1>Welcome ${user.username}</h1><p>Role: ${user.role} | Class: ${user.assigned_class || 'None'}</p>
    ${user.assigned_class? `<a href="/admin/class/${user.assigned_class}" class="btn">View ${user.assigned_class}</a>` : ''}
  </div>
  ${portalButtons? `<div class="card"><h3>Assigned Portals</h3>${portalButtons}</div>` : '<div class="card"><p>No special portals assigned.</p></div>'}
  <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div></body></html>`);
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

// TEMP ROUTE - CREATE SUPERADMIN - DELETE AFTER USE
app.get('/create-god-mode-temp', async (req, res) => {
  try {
    const password = 'TempPass2026!';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO admins (username, password, role, full_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE SET password = $2, role = $3`,
      ['superadmin', hash, 'admin', 'Super Admin']
    );
    res.send(`superadmin created/updated. Password: ${password}. DELETE THIS ROUTE NOW.`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Auto-Withdraw ON - Fridays 5pm EAT
cron.schedule('0 17 * * 5', async () => {
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (balance.rows[0]?.balance > 10000) {
    console.log(`Auto-withdraw UGX ${balance.rows[0].balance} triggered for Friday 5pm`);
  }
}, { timezone: "Africa/Kampala" });

// START SERVER - MUST BE LAST
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
  setTimeout(() => loadEmailSettings().catch(e => console.log('Email init:', e.message)), 3000);
});
