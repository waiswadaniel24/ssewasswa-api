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
const cron = require('node-cron'); // ← ADDED FOR AUTO-WITHDRAW
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const upload = multer({ dest: '/tmp/' });
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  store: new pgSession({ pool: pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// MIDDLEWARE
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/admin/login');
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied: Insufficient role');
    }
    next();
  };
}

function requireTask(taskName) {
  return async (req, res, next) => {
    const user = req.session.user;
    if (user.role === 'admin') return next();
    try {
      const result = await pool.query('SELECT * FROM staff_tasks WHERE username = $1 AND task_name = $2 AND active = true', [user.username, taskName]);
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
        phone VARCHAR(50), email VARCHAR(100), department VARCHAR(50) DEFAULT 'Academic'
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
        phone VARCHAR(50), email VARCHAR(100), hire_date DATE,
        monthly_salary INTEGER, bank_account VARCHAR(100), active BOOLEAN DEFAULT true
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

    console.log('✅ Database ready');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

// ROUTES - NO DUPLICATES

app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: 'connected', time: new Date() });
});

app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Staff Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form></div></body></html>`);
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
    req.session.user = { username: user.username, role: user.role, full_name: user.full_name, assigned_class: user.assigned_class };
    await logAction(username, 'LOGIN_SUCCESS', {});
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', requireLogin, async (req, res) => {
  const user = req.session.user;
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

// [ADD YOUR OTHER ROUTES HERE - MARKSHEETS, STAFF, ASSETS, ETC - BUT ONLY ONE COPY EACH]
// CLASS VIEW
app.get('/admin/class/:className', requireLogin, async (req, res) => {
  const className = req.params.className;
  const user = req.session.user;
  if (user.role === 'class_teacher' && user.assigned_class !== className) return res.status(403).send('Access denied');
  try {
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
    const totalStudents = students.rows.length;
    const totalBalance = students.rows.reduce((sum, s) => sum + Number(s.balance), 0);
    const totalFees = students.rows.reduce((sum, s) => sum + Number(s.total_fees), 0);
    res.send(`<!DOCTYPE html><html><head><title>${className} - Class View</title>
    <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.header{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin:20px 0}.stat-card{background:#3498db;color:white;padding:20px;border-radius:8px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;background:white;border-collapse:collapse;border-radius:8px;overflow:hidden}th{background:#34495e;color:white;padding:12px;text-align:left}td{padding:12px;border-bottom:1px solid #eee}.balance-zero{color:#27ae60;font-weight:bold}.balance-owe{color:#e74c3c;font-weight:bold}</style>
    </head><body>
      <div class="header"><h1>${className} - Class Management</h1><p>Teacher: ${user.username}</p>
        <a href="/admin" class="btn">← Dashboard</a>
        <a href="/admin/marksheets/${className}" class="btn" style="background:#9b59b6">📊 Marksheet</a>
      </div>
      <div class="stats"><div class="stat-card"><h3>Total Students</h3><div style="font-size:28px;font-weight:bold">${totalStudents}</div></div><div class="stat-card" style="background:#e67e22"><h3>Total Fees</h3><div style="font-size:28px;font-weight:bold">UGX ${totalFees.toLocaleString()}</div></div><div class="stat-card" style="background:#e74c3c"><h3>Outstanding</h3><div style="font-size:28px;font-weight:bold">UGX ${totalBalance.toLocaleString()}</div></div></div>
      <table><thead><tr><th>Name</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th></tr></thead><tbody>
        ${students.rows.map(s => `<tr><td><strong>${s.name}</strong></td><td>${s.term}</td><td>${s.year}</td><td>UGX ${Number(s.total_fees).toLocaleString()}</td><td class="${s.balance == 0? 'balance-zero' : 'balance-owe'}">UGX ${Number(s.balance).toLocaleString()}</td></tr>`).join('')}
      </tbody></table>
    </body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// DONORS PORTAL
app.get('/admin/donors', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const donors = await pool.query(`SELECT d.*, COALESCE(SUM(don.amount), 0) as total_donated
    FROM donors d LEFT JOIN donations don ON d.id = don.donor_id
    GROUP BY d.id ORDER BY d.name`);
  res.send(`<!DOCTYPE html><html><head><title>Donors Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#e67e22;color:white}.btn{background:#e67e22;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>🤝 Donors Portal</h1><a href="/admin" class="btn">← Dashboard</a><br><br>
  <table><tr><th>Donor</th><th>Organization</th><th>Contact</th><th>Total Donated</th></tr>
  ${donors.rows.map(d => `<tr><td>${d.name}</td><td>${d.organization || '-'}</td><td>${d.phone || d.email || '-'}</td><td>UGX ${Number(d.total_donated).toLocaleString()}</td></tr>`).join('')}
  </table></body></html>`);
});

// MARKSHEETS LANDING
app.get('/admin/marksheets', requireLogin, requireTask('marksheets'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Marksheets</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.nursery{background:#f39c12}</style>
  </head><body>
    <div class="card"><h1>📊 Class Marksheets</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Nursery Section</h3>
      ${NURSERY_CLASSES.map(c => `<a href="/admin/marksheets/${c}" class="btn nursery">${c} Marksheet</a>`).join('')}
      <h3>Primary Section</h3>
      ${PRIMARY_CLASSES.map(c => `<a href="/admin/marksheets/${c}" class="btn">${c} Marksheet</a>`).join('')}
    </div>
  </body></html>`);
});

// STAFF MANAGEMENT
app.get('/admin/staff', requireLogin, requireTask('staff_management'), async (req, res) => {
  const staff = await pool.query(`SELECT * FROM staff WHERE active = true ORDER BY department, full_name`);
  res.send(`<!DOCTYPE html><html><head><title>Staff Management</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>👥 Staff Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><table><tr><th>Name</th><th>Position</th><th>Department</th><th>Salary</th><th>Contact</th></tr>
      ${staff.rows.map(s => `<tr><td><strong>${s.full_name}</strong><br><small>${s.username}</small></td><td>${s.position}</td><td>${s.department}</td><td>UGX ${Number(s.monthly_salary).toLocaleString()}</td><td>${s.phone}<br>${s.email}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

// ASSETS
app.get('/admin/assets', requireLogin, requireTask('assets'), async (req, res) => {
  const assets = await pool.query('SELECT * FROM school_assets ORDER BY category, asset_name');
  res.send(`<!DOCTYPE html><html><head><title>School Assets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>📦 School Assets & Stores</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><table><tr><th>Asset Name</th><th>Category</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Location</th></tr>
      ${assets.rows.map(a => `<tr><td>${a.asset_name}</td><td>${a.category}</td><td>${a.quantity}</td><td>UGX ${Number(a.unit_cost).toLocaleString()}</td><td>UGX ${Number(a.total_value).toLocaleString()}</td><td>${a.location}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

// FINANCIAL PORTAL
app.get('/admin/financial', requireLogin, requireTask('financial_portal'), async (req, res) => {
  const assetValue = await pool.query('SELECT SUM(total_value) as total FROM school_assets');
  const payroll = await pool.query('SELECT SUM(monthly_salary) as total FROM staff WHERE active = true');
  res.send(`<!DOCTYPE html><html><head><title>Financial Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:20px 0}.stat{background:#ecf0f1;padding:15px;border-radius:4px;text-align:center}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>💰 Financial Portal</h1><a href="/admin" class="btn">← Dashboard</a><br><br>
  <div class="stats">
    <div class="stat"><h3>Assets Value</h3><div style="font-size:24px">UGX ${Number(assetValue.rows[0].total || 0).toLocaleString()}</div></div>
    <div class="stat"><h3>Monthly Payroll</h3><div style="font-size:24px">UGX ${Number(payroll.rows[0].total || 0).toLocaleString()}</div></div>
  </div>
  </body></html>`);
});
// MARKSHEET WITH OFFLINE DOWNLOAD/UPLOAD
app.get('/admin/marksheets/:className', requireLogin, requireRole(['admin', 'class_teacher']), async (req, res) => {
  try {
    const { className } = req.params;
    const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND active = true ORDER BY name', [className]);
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);

    if (subjects.rows.length === 0) return res.send(`No subjects found for ${className}. <a href="/admin/subjects">Add subjects</a>`);
    if (students.rows.length === 0) return res.send(`No students found for ${className}. <a href="/admin/students/add">Add students</a>`);

    res.send(`<!DOCTYPE html><html><head><title>Marksheets - ${className}</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:center}th{background:#34495e;color:white}.student-name{text-align:left;font-weight:bold}input{width:60px;padding:4px;text-align:center}</style>
    </head><body>
      <div class="card"><h1>📝 Marksheets - ${className}</h1>
        <a href="/admin" class="btn">← Dashboard</a>
        <a href="/admin/marksheets/${className}/download-template" class="btn btn-green">📥 Download Excel Template</a>
      </div>
      <div class="card">
        <h3>Enter Marks Online - ${students.rows.length} students, ${subjects.rows.length} subjects</h3>
        <form method="POST" action="/admin/marksheets/${className}/save-online">
          <table>
            <tr><th class="student-name">Student Name</th>${subjects.rows.map(s => `<th>${s.name}<br><small>/${s.max_marks}</small></th>`).join('')}</tr>
            ${students.rows.map(st => `<tr>
              <td class="student-name">${st.name}</td>
              ${subjects.rows.map(sub => `<td><input type="number" name="marks_${st.id}_${sub.id}" min="0" max="${sub.max_marks}" step="0.5"></td>`).join('')}
            </tr>`).join('')}
          </table>
          <br><button type="submit" class="btn btn-green">Save All Marks</button>
        </form>
      </div>
    </body></html>`);
  } catch (err) {
    console.error('Marksheets error:', err);
    res.status(500).send('Error: ' + err.message + '<br><a href="/admin">Back</a>');
  }
});
// DOWNLOAD EXCEL TEMPLATE
app.get('/admin/marksheets/:className/download-template', requireLogin, requireTask('marksheets'), async (req, res) => {
  const { className } = req.params;
  const { term = 'Term 1', year = 2026 } = req.query;
  const students = await pool.query('SELECT id, name FROM students WHERE class = $1 ORDER BY name', [className]);
  const subjects = await pool.query('SELECT id, name, max_marks FROM subjects WHERE class = $1 AND active = true ORDER BY id', [className]);
  const marks = await pool.query(`SELECT student_id, subject_id, marks FROM exam_results WHERE term = $1 AND year = $2 AND student_id IN (SELECT id FROM students WHERE class = $3)`, [term, year, className]);
  const marksMap = {};
  marks.rows.forEach(m => { marksMap[`${m.student_id}-${m.subject_id}`] = m.marks; });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${className} ${term} ${year}`);
  const headers = ['student_id', 'student_name',...subjects.rows.map(s => `${s.name} (/${s.max_marks})`)];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  students.rows.forEach(stu => {
    const row = [stu.id, stu.name];
    subjects.rows.forEach(sub => {
      row.push(marksMap[`${stu.id}-${sub.id}`] || '');
    });
    sheet.addRow(row);
  });

  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  sheet.columns.forEach(col => { col.width = 15; });
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 25;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${className}_${term}_${year}_Marksheet.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// SAVE MARKS FROM WEB FORM
app.post('/admin/marksheets/save', requireLogin, requireTask('marksheets'), async (req, res) => {
  try {
    const { term, year, marks } = req.body;
    const recorded_by = req.session.user.username;
    const studentIds = Object.keys(marks || {});
    if (studentIds.length > 0) {
      await pool.query('DELETE FROM exam_results WHERE student_id = ANY($1) AND term = $2 AND year = $3', [studentIds, term, year]);
      for (const studentId of studentIds) {
        for (const subjectId in marks[studentId]) {
          const mark = marks[studentId][subjectId];
          if (mark!== '' && mark!== null) {
            await pool.query('INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)', [studentId, subjectId, mark, term, year, recorded_by]);
          }
        }
      }
    }
    await logAction(recorded_by, 'MARKS_SAVED', { term, year, students: studentIds.length });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// SUBJECTS MANAGEMENT
app.get('/admin/subjects', requireLogin, requireRole(['admin']), async (req, res) => {
  const { class: filterClass } = req.query;
  let query = 'SELECT * FROM subjects WHERE active = true';
  const params = [];
  if (filterClass) { query += ' AND class = $1'; params.push(filterClass); }
  query += ' ORDER BY class, name';

  const subjects = await pool.query(query, params);
  const grouped = {};
  subjects.rows.forEach(s => {
    if (!grouped[s.class]) grouped[s.class] = [];
    grouped[s.class].push(s);
  });

  res.send(`<!DOCTYPE html><html><head><title>Manage Subjects</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px;font-size:13px}.btn-green{background:#27ae60}.btn-red{background:#e74c3c}table{width:100%;border-collapse:collapse;margin-bottom:20px}th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}h3{background:#ecf0f1;padding:10px;margin:0}.filter{margin-bottom:15px}.actions{display:flex;gap:5px}</style>
  </head><body>
    <div class="card"><h1>📚 Manage Subjects</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/subjects/add" class="btn btn-green">+ Add Subject</a></div>
    <div class="card">
      <div class="filter">
        <form method="GET"><select name="class" onchange="this.form.submit()">
          <option value="">All Classes</option>
          ${ALL_CLASSES.map(c => `<option value="${c}" ${filterClass===c?'selected':''}>${c}</option>`).join('')}
        </select></form>
      </div>
      ${Object.keys(grouped).map(className => `
        <h3>${className}</h3>
        <table><tr><th>Subject</th><th>Department</th><th>Max Marks</th><th>Actions</th></tr>
        ${grouped[className].map(s => `<tr>
          <td>${s.name}</td><td>${s.department}</td><td>${s.max_marks}</td>
          <td class="actions">
            <a href="/admin/subjects/edit/${s.id}" class="btn">Edit</a>
            <form method="POST" action="/admin/subjects/delete/${s.id}" style="display:inline" onsubmit="return confirm('Delete ${s.name}?')">
              <button type="submit" class="btn btn-red">Delete</button>
            </form>
          </td>
        </tr>`).join('')}
        </table>
      `).join('')}
    </div>
  </body></html>`);
});

app.post('/admin/subjects/delete/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE subjects SET active = false WHERE id = $1', [req.params.id]);
  res.redirect('/admin/subjects');
});

app.get('/admin/subjects/edit/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  const subject = await pool.query('SELECT * FROM subjects WHERE id = $1', [req.params.id]);
  const s = subject.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Edit Subject</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Edit Subject</h2>
  <form method="POST" action="/admin/subjects/edit/${s.id}">
    <input name="name" value="${s.name}" required>
    <select name="class" required>${ALL_CLASSES.map(c => `<option value="${c}" ${s.class===c?'selected':''}>${c}</option>`).join('')}</select>
    <select name="department" required>
      <option value="Primary" ${s.department==='Primary'?'selected':''}>Primary</option>
      <option value="Nursery" ${s.department==='Nursery'?'selected':''}>Nursery</option>
    </select>
    <input name="max_marks" type="number" value="${s.max_marks}" required>
    <button type="submit">Update Subject</button>
  </form><a href="/admin/subjects">Back</a></div></body></html>`);
});

app.post('/admin/subjects/edit/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, class: className, department, max_marks } = req.body;
  await pool.query('UPDATE subjects SET name=$1, class=$2, department=$3, max_marks=$4 WHERE id=$5',
    [name, className, department, max_marks, req.params.id]);
  res.redirect('/admin/subjects');
});

// DYNAMIC STUDENT FIELDS
app.get('/admin/fields', requireLogin, requireRole(['admin']), async (req, res) => {
  const fields = await pool.query('SELECT * FROM student_field_definitions WHERE active = true ORDER BY field_name');
  res.send(`<!DOCTYPE html><html><head><title>Custom Student Fields</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px;font-size:13px;border:none;cursor:pointer}.btn-green{background:#27ae60}.btn-red{background:#e74c3c}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.actions{display:flex;gap:5px}</style>
  </head><body>
    <div class="card"><h1>⚙️ Custom Student Fields</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/fields/add" class="btn btn-green">+ Add Field</a></div>
    <div class="card">
      <table><tr><th>Field Name</th><th>Type</th><th>Required</th><th>Options</th><th>Actions</th></tr>
      ${fields.rows.map(f => `<tr>
        <td>${f.field_name}</td>
        <td>${f.field_type}</td>
        <td>${f.required? 'Yes' : 'No'}</td>
        <td>${f.field_options? JSON.parse(f.field_options).join(', ') : '-'}</td>
        <td class="actions">
          <a href="/admin/fields/edit/${f.id}" class="btn">Edit</a>
          <form method="POST" action="/admin/fields/delete/${f.id}" style="display:inline" onsubmit="return confirm('Delete this field?')">
            <button type="submit" class="btn btn-red">Delete</button>
          </form>
        </td>
      </tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.post('/admin/fields/delete/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE student_field_definitions SET active = false WHERE id = $1', [req.params.id]);
  res.redirect('/admin/fields');
});

app.get('/admin/fields/edit/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  const field = await pool.query('SELECT * FROM student_field_definitions WHERE id = $1', [req.params.id]);
  const f = field.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Edit Field</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button,textarea{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Edit Field: ${f.field_name}</h2>
  <form method="POST" action="/admin/fields/edit/${f.id}">
    <input name="field_name" value="${f.field_name}" required>
    <select name="field_type" required>
      <option value="text" ${f.field_type==='text'?'selected':''}>Text</option>
      <option value="number" ${f.field_type==='number'?'selected':''}>Number</option>
      <option value="date" ${f.field_type==='date'?'selected':''}>Date</option>
      <option value="select" ${f.field_type==='select'?'selected':''}>Dropdown</option>
    </select>
    <textarea name="field_options" placeholder="For Dropdown: comma separated">${f.field_options? JSON.parse(f.field_options).join(', ') : ''}</textarea>
    <label><input type="checkbox" name="required" value="true" ${f.required?'checked':''}> Required Field</label>
    <button type="submit">Update Field</button>
  </form><a href="/admin/fields">Back</a></div></body></html>`);
});

app.post('/admin/fields/edit/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  const { field_name, field_type, field_options, required } = req.body;
  const options = field_options? JSON.stringify(field_options.split(',').map(o => o.trim())) : null;
  await pool.query('UPDATE student_field_definitions SET field_name=$1, field_type=$2, field_options=$3, required=$4 WHERE id=$5',
    [field_name, field_type, options, required === 'true', req.params.id]);
  res.redirect('/admin/fields');
});
// TASKS
app.get('/admin/tasks', requireLogin, requireRole(['admin']), async (req, res) => {
  const tasks = await pool.query(`SELECT st.*, a.full_name FROM staff_tasks st JOIN admins a ON st.username = a.username WHERE st.active = true ORDER BY a.full_name`);
  const users = await pool.query('SELECT username, full_name FROM admins WHERE role!= \'admin\' ORDER BY full_name');
  res.send(`<!DOCTYPE html><html><head><title>Assign Tasks</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}input,select,button{padding:8px;margin:4px}</style>
  </head><body>
    <div class="card"><h1>Assign Portal Tasks</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Assign New Task</h3>
      <form method="POST" action="/admin/tasks/assign">
        <select name="username" required><option value="">Select Staff</option>${users.rows.map(u => `<option value="${u.username}">${u.full_name}</option>`).join('')}</select>
        <select name="task_name" required>
          <option value="">Select Task</option>
          <option value="financial_portal">Financial Portal</option>
          <option value="academic_portal">Academic Portal</option>
          <option value="marksheets">Marksheets</option>
          <option value="donors_portal">Donors Portal</option>
          <option value="staff_management">Staff Management</option>
          <option value="assets">Assets/Stores</option>
        </select>
        <button type="submit" class="btn-green">Assign</button>
      </form>
    </div>
    <div class="card"><h3>Current Assignments</h3>
      <table><tr><th>Staff</th><th>Task</th><th>Assigned By</th><th>Date</th></tr>
      ${tasks.rows.map(t => `<tr><td>${t.full_name}</td><td>${t.task_name}</td><td>${t.assigned_by}</td><td>${new Date(t.assigned_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.post('/admin/tasks/assign', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, task_name } = req.body;
    await pool.query('INSERT INTO staff_tasks (username, task_name, assigned_by) VALUES ($1, $2, $3)', [username, task_name, req.session.user.username]);
    await logAction(req.session.user.username, 'TASK_ASSIGNED', { username, task_name });
    res.redirect('/admin/tasks');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});
// CREATE USER - PROFESSIONAL FORM
app.get('/admin/users/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:900px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button,textarea{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}.section{border:1px solid #ddd;padding:15px;border-radius:8px;margin:15px 0}.phone-row{display:flex;gap:10px;margin:5px 0}.phone-row input{margin:0}.btn-small{padding:6px 12px;width:auto;font-size:13px}.btn-red{background:#e74c3c}</style>
  </head><body><div class="card"><h2>Create New Staff Member</h2>
  <form method="POST" action="/admin/users/add">
    <div class="section"><h3>Basic Information</h3>
      <input name="username" placeholder="Username for login" required>
      <input type="password" name="password" placeholder="Password" required>
      <input name="full_name" placeholder="Full Name" required>
      <div id="phoneContainer">
        <label>Phone Numbers:</label>
        <div class="phone-row"><input name="phone[]" placeholder="Phone Number" required><button type="button" class="btn-small" onclick="addPhone()">+ Add</button></div>
      </div>
      <input type="email" name="email" placeholder="Email">
      <div id="emergencyContainer">
        <label>Emergency Contacts:</label>
        <div class="phone-row"><input name="emergency_contact[]" placeholder="Emergency Contact"><button type="button" class="btn-small" onclick="addEmergency()">+ Add</button></div>
      </div>
    </div>
    <div class="section"><h3>Employment Details</h3>
      <select name="department" required>
        <option value="">Select Department</option>
        ${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
      <input name="position" placeholder="Position e.g Senior Teacher" required>
      <input name="monthly_salary" type="number" placeholder="Monthly Salary UGX" required>
      <input name="bank_account" placeholder="Bank Account Number">
      <input name="hire_date" type="date">
    </div>
    <div class="section"><h3>Role & Access</h3>
      <select name="role" required>
        <option value="class_teacher">Class Teacher</option>
        <option value="subject_teacher">Subject Teacher</option>
        <option value="bursar">Bursar</option>
        <option value="admin">Admin</option>
        <option value="support_staff">Support Staff</option>
      </select>
    </div>
    <div class="section"><h3>Class Teacher Assignment</h3>
      <select name="assigned_class">
        <option value="">None - Not a Class Teacher</option>
        ${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <button type="submit">Create Staff Member</button>
  </form><a href="/admin/staff">Back</a></div>
  <script>
    function addPhone() {
      const div = document.createElement('div');
      div.className = 'phone-row';
      div.innerHTML = '<input name="phone[]" placeholder="Phone Number"><button type="button" class="btn-small btn-red" onclick="this.parentElement.remove()">Remove</button>';
      document.getElementById('phoneContainer').appendChild(div);
    }
    function addEmergency() {
      const div = document.createElement('div');
      div.className = 'phone-row';
      div.innerHTML = '<input name="emergency_contact[]" placeholder="Emergency Contact"><button type="button" class="btn-small btn-red" onclick="this.parentElement.remove()">Remove</button>';
      document.getElementById('emergencyContainer').appendChild(div);
    }
  </script></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, phone, email, emergency_contact, department, position, monthly_salary, bank_account, hire_date, role, assigned_class } = req.body;
    const hash = await bcrypt.hash(password, 10);

    // Convert phone arrays - filter empty
    const phones = Array.isArray(phone)? phone.filter(p => p.trim()) : [phone].filter(p => p);
    const emergencyContacts = Array.isArray(emergency_contact)? emergency_contact.filter(p => p.trim()) : [emergency_contact].filter(p => p);

    await pool.query('INSERT INTO admins (username, password, role, full_name, assigned_class, phone, email, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [username, hash, role, full_name, assigned_class || null, phones, email, department]);

    await pool.query('INSERT INTO staff (username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account, emergency_contact) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [username, full_name, position, department, phones, email, hire_date, monthly_salary, bank_account, emergencyContacts]);

    if (assigned_class) {
      await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
        [username, 'class_teacher', assigned_class, department]);
    }

    await logAction(req.session.user.username, 'STAFF_CREATED', { username, full_name });
    res.send(`Staff ${full_name} created successfully. <a href="/admin/staff">View All Staff</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});
// ONLINE CLASSES
app.get('/admin/online-classes', requireLogin, requireTask('online_classes'), async (req, res) => {
  const classes = await pool.query('SELECT * FROM online_classes ORDER BY scheduled_at DESC');
  res.send(`<!DOCTYPE html><html><head><title>Online Classes</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}.btn{background:#9b59b6;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>💻 Online Classes</h1><a href="/admin/academic" class="btn">← Academic</a> <a href="/admin/online-classes/add" class="btn">+ Schedule Class</a><br><br>
  <table><tr><th>Class</th><th>Subject</th><th>Topic</th><th>Scheduled</th><th>Link</th></tr>
  ${classes.rows.map(c => `<tr><td>${c.class}</td><td>${c.subject}</td><td>${c.topic}</td><td>${new Date(c.scheduled_at).toLocaleString()}</td><td><a href="${c.meeting_link}" target="_blank">Join</a></td></tr>`).join('')}
  </table></body></html>`);
});

app.get('/admin/online-classes/add', requireLogin, requireTask('online_classes'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Schedule Class</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Schedule Online Class</h2><form method="POST" action="/admin/online-classes/add">
    <select name="class" required><option value="">Select Class</option>${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
    <input name="subject" placeholder="Subject" required>
    <input name="topic" placeholder="Topic" required>
    <input name="meeting_link" placeholder="Zoom/Google Meet Link" required>
    <input name="scheduled_at" type="datetime-local" required>
    <button type="submit">Schedule</button>
  </form><a href="/admin/online-classes">Back</a></body></html>`);
});

app.post('/admin/online-classes/add', requireLogin, requireTask('online_classes'), async (req, res) => {
  const { class: className, subject, topic, meeting_link, scheduled_at } = req.body;
  await pool.query('INSERT INTO online_classes (class, subject, topic, meeting_link, scheduled_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [className, subject, topic, meeting_link, scheduled_at, req.session.user.username]);
  res.redirect('/admin/online-classes');
});
// ACADEMIC PORTAL
app.get('/admin/academic', requireLogin, requireTask('academic_portal'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Academic Portal</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.btn{background:#9b59b6;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px}</style>
  </head><body><h1>📚 Academic Portal</h1><a href="/admin">← Dashboard</a><br><br>
  <a href="/admin/marksheets" class="btn">📊 Marksheets</a>
  <a href="/admin/subjects" class="btn">📝 Manage Subjects</a>
  </body></html>`);
});
// STAFF ASSIGNMENTS VIEW
app.get('/admin/assignments', requireLogin, requireRole(['admin']), async (req, res) => {
  const assignments = await pool.query(`
    SELECT sa.*, s.full_name, s.position 
    FROM staff_assignments sa 
    JOIN staff s ON sa.username = s.username 
    WHERE sa.active = true 
    ORDER BY sa.assignment_type, sa.assignment_value`);
  
  res.send(`<!DOCTYPE html><html><head><title>Staff Assignments</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}.btn-red{background:#e74c3c}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.actions{display:flex;gap:5px}</style>
  </head><body>
    <div class="card"><h1>📋 Staff Assignments</h1>
      <a href="/admin" class="btn">← Dashboard</a> 
      <a href="/admin/assignments/add" class="btn btn-green">+ New Assignment</a>
    </div>
    <div class="card">
      <table><tr><th>Staff Member</th><th>Position</th><th>Assignment Type</th><th>Assignment</th><th>Department</th><th>Actions</th></tr>
      ${assignments.rows.map(a => `<tr>
        <td><strong>${a.full_name}</strong><br><small>${a.username}</small></td>
        <td>${a.position}</td>
        <td>${a.assignment_type}</td>
        <td>${a.assignment_value}</td>
        <td>${a.department}</td>
        <td class="actions">
          <form method="POST" action="/admin/assignments/delete/${a.id}" style="display:inline" onsubmit="return confirm('Remove assignment?')">
            <button type="submit" class="btn btn-red">Remove</button>
          </form>
        </td>
      </tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/assignments/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT username, full_name, department FROM staff WHERE active = true ORDER BY full_name');
  res.send(`<!DOCTYPE html><html><head><title>Add Assignment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>New Staff Assignment</h2>
  <form method="POST" action="/admin/assignments/add">
    <select name="username" required>
      <option value="">Select Staff Member</option>
      ${staff.rows.map(s => `<option value="${s.username}">${s.full_name} - ${s.department}</option>`).join('')}
    </select>
    <select name="assignment_type" required>
      <option value="class_teacher">Class Teacher</option>
      <option value="subject_teacher">Subject Teacher</option>
      <option value="department_head">Department Head</option>
      <option value="duty">Duty Assignment</option>
    </select>
    <input name="assignment_value" placeholder="e.g P4, Mathematics, or Morning Duty" required>
    <select name="department" required>
      <option value="">Select Department</option>
      ${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    </select>
    <button type="submit">Add Assignment</button>
  </form><a href="/admin/assignments">Back</a></div></body></html>`);
});

app.post('/admin/assignments/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { username, assignment_type, assignment_value, department } = req.body;
  await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
    [username, assignment_type, assignment_value, department]);
  await logAction(req.session.user.username, 'ASSIGNMENT_CREATED', { username, assignment_type, assignment_value });
  res.redirect('/admin/assignments');
});

app.post('/admin/assignments/delete/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE staff_assignments SET active = false WHERE id = $1', [req.params.id]);
  res.redirect('/admin/assignments');
});

// STUDENTS MANAGEMENT
app.get('/admin/students', requireLogin, requireTask('students'), async (req, res) => {
  const { class: filterClass } = req.query;
  let query = 'SELECT * FROM students';
  const params = [];
  if (filterClass) { query += ' WHERE class = $1'; params.push(filterClass); }
  query += ' ORDER BY class, name';
  
  const students = await pool.query(query, params);
  const classes = await pool.query('SELECT DISTINCT class FROM students ORDER BY class');
  
  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px;font-size:13px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.filter{margin-bottom:15px}.balance-zero{color:#27ae60;font-weight:bold}.balance-owe{color:#e74c3c;font-weight:bold}</style>
  </head><body>
    <div class="card"><h1>👨‍🎓 Students Management</h1>
      <a href="/admin" class="btn">← Dashboard</a> 
      <a href="/admin/students/add" class="btn btn-green">+ Add Student</a>
    </div>
    <div class="card">
      <div class="filter">
        <form method="GET"><select name="class" onchange="this.form.submit()">
          <option value="">All Classes</option>
          ${classes.rows.map(c => `<option value="${c.class}" ${filterClass===c.class?'selected':''}>${c.class}</option>`).join('')}
        </select></form>
      </div>
      <table><tr><th>Name</th><th>Class</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th><th>Actions</th></tr>
      ${students.rows.map(s => `<tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.class}</td>
        <td>${s.term}</td>
        <td>${s.year}</td>
        <td>UGX ${Number(s.total_fees).toLocaleString()}</td>
        <td class="${s.balance == 0? 'balance-zero' : 'balance-owe'}">UGX ${Number(s.balance).toLocaleString()}</td>
        <td><a href="/admin/students/edit/${s.id}" class="btn">Edit</a></td>
      </tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/students/add', requireLogin, requireRole(['admin', 'bursar']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add New Student</h2>
  <form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Full Name" required>
    <select name="class" required>
      <option value="">Select Class</option>
      ${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <select name="term" required>
      <option value="Term 1">Term 1</option>
      <option value="Term 2">Term 2</option>
      <option value="Term 3">Term 3</option>
    </select>
    <input name="year" type="number" value="2026" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <input name="balance" type="number" placeholder="Current Balance UGX" required>
    <button type="submit">Add Student</button>
  </form><a href="/admin/students">Back</a></div></body></html>`);
});

app.post('/admin/students/add', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { name, class: className, term, year, total_fees, balance } = req.body;
  await pool.query('INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1, $2, $3, $4, $5, $6)',
    [name, className, term, year, total_fees, balance]);
  await logAction(req.session.user.username, 'STUDENT_ADDED', { name, className });
  res.redirect('/admin/students');
});
app.get('/admin/students/edit/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  try {
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (student.rows.length === 0) return res.status(404).send('Student not found');
    const s = student.rows[0];
    
    res.send(`<!DOCTYPE html><html><head><title>Edit Student</title>
    <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
    </head><body><div class="card"><h2>Edit Student: ${s.name}</h2>
    <form method="POST" action="/admin/students/edit/${s.id}">
      <input name="name" value="${s.name}" required>
      <select name="class" required>
        ${ALL_CLASSES.map(c => `<option value="${c}" ${s.class===c?'selected':''}>${c}</option>`).join('')}
      </select>
      <select name="term" required>
        <option value="Term 1" ${s.term==='Term 1'?'selected':''}>Term 1</option>
        <option value="Term 2" ${s.term==='Term 2'?'selected':''}>Term 2</option>
        <option value="Term 3" ${s.term==='Term 3'?'selected':''}>Term 3</option>
      </select>
      <input name="year" type="number" value="${s.year}" required>
      <input name="total_fees" type="number" value="${s.total_fees}" required>
      <input name="balance" type="number" value="${s.balance}" required>
      <button type="submit">Update Student</button>
    </form><a href="/admin/students">Back</a></div></body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.post('/admin/students/edit/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  try {
    const { name, class: className, term, year, total_fees, balance } = req.body;
    await pool.query('UPDATE students SET name=$1, class=$2, term=$3, year=$4, total_fees=$5, balance=$6 WHERE id=$7',
      [name, className, term, year, total_fees, balance, req.params.id]);
    await logAction(req.session.user.username, 'STUDENT_UPDATED', { id: req.params.id, name });
    res.redirect('/admin/students');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});
app.get('/admin/marksheets/:className', requireLogin, requireTask('marksheets'), async (req, res) => {
  try {
    const { className } = req.params;
    const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND active = true ORDER BY name', [className]);
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);

    res.send(`<!DOCTYPE html><html><head><title>Marksheets - ${className}</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:center}th{background:#34495e;color:white}.student-name{text-align:left;font-weight:bold}input{width:60px;padding:4px;text-align:center}</style>
    </head><body>
      <div class="card"><h1>📝 Marksheets - ${className}</h1>
        <a href="/admin" class="btn">← Dashboard</a>
        <a href="/admin/marksheets/${className}/download-template" class="btn btn-green">📥 Download Excel Template</a>
      </div>
      <div class="card">
        <form method="POST" action="/admin/marksheets/${className}/save" enctype="multipart/form-data">
          <p><strong>Option 1:</strong> Upload filled Excel: <input type="file" name="excel" accept=".xlsx"><button type="submit" class="btn">Upload Marks</button></p>
        </form>
      </div>
      <div class="card">
        <h3>Enter Marks Online</h3>
        <form method="POST" action="/admin/marksheets/${className}/save-online">
          <table>
            <tr><th class="student-name">Student Name</th>${subjects.rows.map(s => `<th>${s.name}<br><small>/${s.max_marks}</small></th>`).join('')}</tr>
            ${students.rows.map(st => `<tr>
              <td class="student-name">${st.name}</td>
              ${subjects.rows.map(sub => `<td><input type="number" name="marks_${st.id}_${sub.id}" min="0" max="${sub.max_marks}" step="0.5"></td>`).join('')}
            </tr>`).join('')}
          </table>
          <br><button type="submit" class="btn btn-green">Save All Marks</button>
        </form>
      </div>
    </body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.post('/admin/marksheets/:className/save-online', requireLogin, requireTask('marksheets'), async (req, res) => {
  try {
    const { className } = req.params;
    const marks = req.body;

    for (const key in marks) {
      if (key.startsWith('marks_') && marks[key]!== '') {
        const [, student_id, subject_id] = key.split('_');
        await pool.query(`INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by)
          VALUES ($1, $2, $3, 'Term 1', 2026, $4)
          ON CONFLICT (student_id, subject_id, term, year)
          DO UPDATE SET marks = $3, recorded_by = $4, recorded_at = CURRENT_TIMESTAMP`,
          [student_id, subject_id, marks[key], req.session.user.username]);
      }
    }
    await logAction(req.session.user.username, 'MARKS_ENTERED', { class: className });
    res.send(`Marks saved for ${className}. <a href="/admin/marksheets/${className}">Back</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});
// ==================== 100/50 UPGRADE FEATURES ====================

// Branding Console - God Mode only
app.get('/admin/branding', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.user.username!== 'superadmin') return res.status(403).send('God Mode only');
  const config = await pool.query('SELECT * FROM branding_config WHERE school_id = $1', [req.school.id]);
  const brand = config.rows[0] || {};
  res.send(`<!DOCTYPE html><h1>Branding Console</h1>
    <form method="POST" action="/admin/branding">
      <label>Brand Name: <input name="brand_name" value="${brand.brand_name || req.school.school_name}"></label><br>
      <label>Primary Color: <input name="primary_color" value="${brand.primary_color || '#667eea'}"></label><br>
      <button>Save Brand</button>
    </form>`);
});

app.post('/admin/branding', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.user.username!== 'superadmin') return res.status(403).send('God Mode only');
  const { brand_name, primary_color } = req.body;
  await pool.query(`INSERT INTO branding_config (school_id, brand_name, primary_color) VALUES ($1,$2,$3)
    ON CONFLICT (school_id) DO UPDATE SET brand_name=$2, primary_color=$3`,
    [req.school.id, brand_name, primary_color]);
  res.redirect('/admin/branding?success=1');
});

// Impact Fund Split - 1.5% on every payment
const creditAdmin = async (amount, type, description, reference_id = null, school_id = null) => {
  const platformFee = Math.ceil(amount * 0.015); // 1.5%
  const impactFund = Math.ceil(platformFee * 0.1); // 10% of fee to Impact Fund
  const netFee = platformFee - impactFund;

  await pool.query('INSERT INTO admin_transactions (type, amount, description, reference_id) VALUES ($1,$2,$3,$4)',
    [type, netFee, description, reference_id]);
  await pool.query('INSERT INTO impact_fund_transactions (amount, school_id, description) VALUES ($1,$2,$3)',
    [impactFund, school_id, `10% of fee from ${description}`]);
  await pool.query('UPDATE admin_wallet SET total_earned = total_earned + $1, balance = balance + $1 WHERE id = 1', [netFee]);
};

// Auto-Withdraw ON - Fridays 5pm EAT
cron.schedule('0 17 * * 5', async () => {
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (balance.rows[0]?.balance > 10000) {
    console.log(`Auto-withdraw UGX ${balance.rows[0].balance} triggered for Friday 5pm`);
    // Add your MTN MoMo API call here later
  }
}, { timezone: "Africa/Kampala" });

// Feature flags - already set by migration SQL
// ==================== END 100/50 ====================
// TEMP CREATE SUPERADMIN - DELETE AFTER USE
app.get('/create-superadmin-ssewasswa2026', async (req, res) => {
  try {
    const hash = await bcrypt.hash('Admin@2026', 10);
    await pool.query(`
      INSERT INTO users (username, password, role)
      VALUES ('superadmin', $1, 'admin')
      ON CONFLICT (username) DO UPDATE SET password = $1, role = 'admin'
    `, [hash]);
    res.send('<h1>✅ Superadmin Created</h1><p>Username: superadmin<br>Password: Admin@2026</p>');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});
// ==================== 100/50 UPGRADE FEATURES ====================
// ... all the branding + impact fund code we added ...
// ==================== END 100/50 ====================

// TEMP CHANGE PASSWORD - DELETE AFTER USE
app.get('/change-god-pass', async (req, res) => {
  const hash = await bcrypt.hash('YourNewStrongPass2026!', 10);
  await pool.query(`UPDATE users SET password = $1 WHERE username = 'superadmin'`, );
  res.send('Password changed. Delete this route.');
});
// Staff Login Page
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Staff Login - Ssewasswa Fees</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: system-ui; background: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .box { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
        h1 { text-align: center; color: #1f2937; margin-bottom: 1.5rem; }
        input { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box; }
        button { width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; }
        button:hover { background: #1d4ed8; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>Staff Login</h1>
        <form action="/login" method="POST">
          <input type="text" name="username" placeholder="Username" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});
// START SERVER - MUST BE LAST
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
  setTimeout(() => loadEmailSettings().catch(e => console.log('Email init:', e.message)), 3000);
});
