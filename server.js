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
  secret: process.env.SESSION_SECRET || 'change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

// MIDDLEWARE
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
    if (req.session.role === 'admin') return next();
    try {
      const result = await pool.query('SELECT * FROM staff_tasks WHERE username = $1 AND task_name = $2 AND active = true', [req.session.username, taskName]);
      if (result.rows.length > 0) return next();
      res.status(403).send(`Access denied: You need to be tasked for "${taskName}"`);
    } catch (err) {
      res.status(500).send('Task check failed');
    }
  };
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts.' });

// CONSTANTS
const ALL_CLASSES = ['Baby Class', 'Middle Class', 'Top Class', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const NURSERY_CLASSES = ['Baby Class', 'Middle Class', 'Top Class'];
const PRIMARY_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const DEPARTMENTS = ['Nursery', 'Primary', 'Administration', 'Support Staff'];

// IMPACT FUND SPLIT
const creditAdmin = async (amount, type, description, reference_id = null, school_id = 1) => {
  const platformFee = Math.ceil(amount * 0.015); // 1.5%
  const impactFund = Math.ceil(platformFee * 0.1); // 10% of fee to Impact Fund
  const netFee = platformFee - impactFund;
  await pool.query('INSERT INTO admin_transactions (type, amount, description, reference_id) VALUES ($1,$2,$3,$4)', [type, netFee, description, reference_id]);
  await pool.query('INSERT INTO impact_fund_transactions (amount, school_id, description) VALUES ($1,$2,$3)', [impactFund, school_id, `10% of fee from ${description}`]);
  await pool.query('UPDATE admin_wallet SET total_earned = total_earned + $1, balance = balance + $1 WHERE id = 1', [netFee]);
};

async function logAction(username, action, details = {}) {
  try {
    await pool.query('INSERT INTO audit_logs (username, action, details) VALUES ($1, $2, $3)', [username, action, JSON.stringify(details)]);
  } catch (err) { console.error('Audit log failed:', err); }
}

// DATABASE INIT
async function initDB() {
  try {
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'bursar';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_class TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(50) DEFAULT 'Academic';

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
        marks NUMERIC, term VARCHAR(20), year INTEGER, recorded_by VARCHAR(50),
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, subject_id, term, year)
      );
      CREATE TABLE IF NOT EXISTS staff (
        id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
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
      CREATE TABLE IF NOT EXISTS donors (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100),
        phone VARCHAR(50), organization VARCHAR(100), address TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS donations (
        id SERIAL PRIMARY KEY, donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, purpose VARCHAR(200), donation_date DATE DEFAULT CURRENT_DATE,
        method VARCHAR(50), reference VARCHAR(100), recorded_by VARCHAR(50)
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
  res.send(`<!DOCTYPE html><html><head><title>Staff Login</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:system-ui;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:white;padding:2rem;border-radius:8px;box-shadow:0 4px 6px rgba(0,0,0,.1);width:100%;max-width:400px}h1{text-align:center;color:#1f2937;margin-bottom:1.5rem}input{width:100%;padding:.75rem;margin-bottom:1rem;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box}button{width:100%;padding:.75rem;background:#2563eb;color:white;border:none;border-radius:4px;font-weight:600;cursor:pointer}button:hover{background:#1d4ed8}</style>
    </head><body><div class="box"><h1>Staff Login</h1>
      <form action="/login" method="POST">
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
      </form></div></body></html>`);
});

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).send('Invalid credentials');
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send('Invalid credentials');
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.full_name = user.full_name;
    req.session.assigned_class = user.assigned_class;
    req.session.save((err) => {
      if (err) return res.status(500).send('Session error');
      if (user.role === 'admin' && user.username === 'superadmin') return res.redirect('/admin/branding');
      res.redirect('/admin');
    });
    await logAction(username, 'LOGIN_SUCCESS', {});
  } catch (err) {
    res.status(500).send('Server error: ' + err.message);
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// DASHBOARD
app.get('/admin', requireLogin, async (req, res) => {
  const user = req.session;
  const totals = await pool.query(`SELECT COUNT(*) as total_students, SUM(total_fees) as total_fees, SUM(balance) as total_outstanding FROM students`);
  const donorTotals = await pool.query(`SELECT COUNT(*) as total_donors, SUM(amount) as total_donated FROM donations`);
  const staffTotals = await pool.query(`SELECT COUNT(*) as total_staff, SUM(monthly_salary) as total_payroll FROM staff WHERE active = true`);
  const impactFund = await pool.query(`SELECT SUM(amount) as total FROM impact_fund_transactions`);
  const t = totals.rows[0] || {}, d = donorTotals.rows[0] || {}, s = staffTotals.rows[0] || {}, i = impactFund.rows[0] || {};

  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 16px;text-decoration:none;border-radius:4px;display:inline-block;margin:4px 4px 0 0;font-size:14px}.portal{background:#9b59b6}.donor{background:#e67e22}.staff{background:#16a085}.asset{background:#8e44ad}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat{background:#ecf0f1;padding:12px;border-radius:4px;text-align:center}.section-title{margin:15px 0 10px 0;color:#34495e;border-bottom:2px solid #3498db;padding-bottom:5px}</style>
    </head><body>
      <div class="card"><h1>Admin Dashboard - Ssewasswa School ERP</h1><p>Logged in as: ${user.username} (${user.role})</p></div>
      <div class="card"><h3>School Overview</h3>
        <div class="stats">
          <div class="stat"><strong>Students</strong><br>${t.total_students || 0}</div>
          <div class="stat"><strong>Fees Expected</strong><br>UGX ${Number(t.total_fees || 0).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding</strong><br>UGX ${Number(t.total_outstanding || 0).toLocaleString()}</div>
          <div class="stat"><strong>Donations</strong><br>UGX ${Number(d.total_donated || 0).toLocaleString()}</div>
          <div class="stat"><strong>Staff</strong><br>${s.total_staff || 0}</div>
          <div class="stat"><strong>Monthly Payroll</strong><br>UGX ${Number(s.total_payroll || 0).toLocaleString()}</div>
          <div class="stat"><strong>Impact Fund</strong><br>UGX ${Number(i.total || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">📚 Academic Portals</h3>
        <a href="/admin/marksheets" class="btn portal">Marksheets</a>
        <a href="/admin/subjects" class="btn portal">Manage Subjects</a>
        <h3 class="section-title">💰 Financial Portals</h3>
        <a href="/admin/students" class="btn portal">Students & Fees</a>
        <a href="/admin/donors" class="btn donor">Donors Portal</a>
        <a href="/admin/staff/payroll" class="btn staff">Staff Payroll</a>
        <a href="/admin/assets" class="btn asset">School Assets</a>
        <h3 class="section-title">👥 Staff Management</h3>
        <a href="/admin/staff" class="btn staff">All Staff</a>
        <a href="/admin/tasks" class="btn portal">Assign Portal Tasks</a>
        <a href="/admin/users/add" class="btn">Create User</a>
        <h3 class="section-title">⚙️ System</h3>
        <a href="/admin/fields" class="btn portal">Custom Student Fields</a>
        ${user.username === 'superadmin'? '<a href="/admin/branding" class="btn" style="background:#e74c3c">Branding Console</a>' : ''}
      </div>
      <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    </body></html>`);
});

// BRANDING
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

// MODULE 1: STUDENTS + FEES
app.get('/admin/students', requireLogin, requireRole(['admin','bursar']), async (req, res) => {
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
    <div class="card"><h1>👨‍🎓 Students & Fees</h1>
      <a href="/admin" class="btn">← Dashboard</a>
      <a href="/admin/students/add" class="btn btn-green">+ Add Student</a>
    </div>
    <div class="card">
      <div class="filter">
        <form method="GET"><select name="class" onchange="this.form.submit()">
          <option value="">All Classes</option>
          ${ALL_CLASSES.map(c => `<option value="${c}" ${filterClass===c?'selected':''}>${c}</option>`).join('')}
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
        <td>
          <a href="/admin/students/pay/${s.id}" class="btn btn-green">Pay</a>
          <a href="/admin/students/edit/${s.id}" class="btn">Edit</a>
        </td>
      </tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/students/add', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const fields = await pool.query('SELECT * FROM student_field_definitions WHERE active = true ORDER BY field_name');
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add New Student</h2>
  <form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Full Name" required>
    <select name="class" required><option value="">Select Class</option>${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
    <select name="term" required><option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option></select>
    <input name="year" type="number" value="2026" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <input name="balance" type="number" placeholder="Current Balance UGX" required>
    <input name="parent_name" placeholder="Parent/Guardian Name">
    <input name="parent_phone" placeholder="Parent Phone">
    ${fields.rows.map(f => {
      if(f.field_type === 'select') {
        return `<select name="custom_${f.field_name}"><option value="">${f.field_name}</option>${JSON.parse(f.field_options || '[]').map(o => `<option value="${o}">${o}</option>`).join('')}</select>`;
      }
      return `<input name="custom_${f.field_name}" type="${f.field_type}" placeholder="${f.field_name}" ${f.required? 'required' : ''}>`;
    }).join('')}
    <button type="submit">Add Student</button>
  </form><a href="/admin/students">Back</a></div></body></html>`);
});

app.post('/admin/students/add', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { name, class: className, term, year, total_fees, balance, parent_name, parent_phone } = req.body;
  const custom_fields = {};
  for (const key in req.body) {
    if (key.startsWith('custom_')) custom_fields[key.replace('custom_', '')] = req.body[key];
  }
  await pool.query('INSERT INTO students (name, class, term, year, total_fees, balance, parent_name, parent_phone, custom_fields) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [name, className, term, year, total_fees, balance, parent_name, parent_phone, JSON.stringify(custom_fields)]);
  await logAction(req.session.username, 'STUDENT_ADDED', { name, className });
  res.redirect('/admin/students');
});

app.get('/admin/students/pay/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  if (student.rows.length === 0) return res.status(404).send('Student not found');
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Payment for ${s.name}</h2><p>Class: ${s.class} | Balance: UGX ${Number(s.balance).toLocaleString()}</p>
  <form method="POST" action="/admin/students/pay/${s.id}">
    <input name="amount" type="number" placeholder="Amount UGX" max="${s.balance}" required>
    <select name="method" required><option value="Cash">Cash</option><option value="Mobile Money">Mobile Money</option><option value="Bank">Bank</option></select>
    <input name="reference" placeholder="Reference/Receipt No">
    <button type="submit">Record Payment</button>
  </form><a href="/admin/students">Back</a></div></body></html>`);
});

app.post('/admin/students/pay/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { amount, method, reference } = req.body;
  const studentId = req.params.id;
  await pool.query('INSERT INTO payments (student_id, amount, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5)', [studentId, amount, method, reference, req.session.username]);
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, studentId]);
  await creditAdmin(amount, 'fee_payment', `Fee payment for student ID ${studentId}`, studentId);
  await logAction(req.session.username, 'PAYMENT_RECORDED', { studentId, amount });
  res.redirect('/admin/students');
});

app.get('/admin/students/edit/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  if (student.rows.length === 0) return res.status(404).send('Student not found');
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Edit Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Edit Student: ${s.name}</h2>
  <form method="POST" action="/admin/students/edit/${s.id}">
    <input name="name" value="${s.name}" required>
    <select name="class" required>${ALL_CLASSES.map(c => `<option value="${c}" ${s.class===c?'selected':''}>${c}</option>`).join('')}</select>
    <select name="term" required><option value="Term 1" ${s.term==='Term 1'?'selected':''}>Term 1</option><option value="Term 2" ${s.term==='Term 2'?'selected':''}>Term 2</option><option value="Term 3" ${s.term==='Term 3'?'selected':''}>Term 3</option></select>
    <input name="year" type="number" value="${s.year}" required>
    <input name="total_fees" type="number" value="${s.total_fees}" required>
    <input name="balance" type="number" value="${s.balance}" required>
    <input name="parent_name" value="${s.parent_name || ''}" placeholder="Parent Name">
    <input name="parent_phone" value="${s.parent_phone || ''}" placeholder="Parent Phone">
    <button type="submit">Update Student</button>
  </form><a href="/admin/students">Back</a></div></body></html>`);
});

app.post('/admin/students/edit/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { name, class: className, term, year, total_fees, balance, parent_name, parent_phone } = req.body;
  await pool.query('UPDATE students SET name=$1, class=$2, term=$3, year=$4, total_fees=$5, balance=$6, parent_name=$7, parent_phone=$8 WHERE id=$9',
    [name, className, term, year, total_fees, balance, parent_name, parent_phone, req.params.id]);
  await logAction(req.session.username, 'STUDENT_UPDATED', { id: req.params.id, name });
  res.redirect('/admin/students');
});

// MODULE 2: MARKSHEETS
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

app.get('/admin/marksheets/:className', requireLogin, requireRole(['admin', 'class_teacher']), async (req, res) => {
  try {
    const { className } = req.params;
    const { term = 'Term 1', year = 2026 } = req.query;
    const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND active = true ORDER BY name', [className]);
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
    const marks = await pool.query(`SELECT student_id, subject_id, marks FROM exam_results WHERE term = $1 AND year = $2 AND student_id IN (SELECT id FROM students WHERE class = $3)`, [term, year, className]);
    const marksMap = {};
    marks.rows.forEach(m => { marksMap[`${m.student_id}-${m.subject_id}`] = m.marks; });

    if (subjects.rows.length === 0) return res.send(`No subjects found for ${className}. <a href="/admin/subjects">Add subjects</a>`);
    if (students.rows.length === 0) return res.send(`No students found for ${className}. <a href="/admin/students/add">Add students</a>`);

    res.send(`<!DOCTYPE html><html><head><title>Marksheets - ${className}</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #ddd;text-align:center}th{background:#34495e;color:white}.student-name{text-align:left;font-weight:bold}input{width:60px;padding:4px;text-align:center}</style>
    </head><body>
      <div class="card"><h1>📝 Marksheets - ${className}</h1>
        <a href="/admin/marksheets" class="btn">← Back</a>
        <a href="/admin/marksheets/${className}/download-template?term=${term}&year=${year}" class="btn btn-green">📥 Download Excel Template</a>
      </div>
      <div class="card">
        <h3>Enter Marks - ${term} ${year}</h3>
        <form method="POST" action="/admin/marksheets/${className}/save-online">
          <input type="hidden" name="term" value="${term}">
          <input type="hidden" name="year" value="${year}">
          <table>
            <tr><th class="student-name">Student Name</th>${subjects.rows.map(s => `<th>${s.name}<br><small>/${s.max_marks}</small></th>`).join('')}</tr>
            ${students.rows.map            ${students.rows.map(st => `<tr>
              <td class="student-name">${st.name}</td>
              ${subjects.rows.map(sub => `<td><input type="number" name="marks_${st.id}_${sub.id}" value="${marksMap[`${st.id}-${sub.id}`] || ''}" min="0" max="${sub.max_marks}" step="0.5"></td>`).join('')}
            </tr>`).join('')}
          </table>
          <br><button type="submit" class="btn btn-green">Save All Marks</button>
        </form>
      </div>
      <div class="card">
        <h3>Upload Excel</h3>
        <form method="POST" action="/admin/marksheets/${className}/upload" enctype="multipart/form-data">
          <input type="hidden" name="term" value="${term}">
          <input type="hidden" name="year" value="${year}">
          <input type="file" name="excel" accept=".xlsx" required>
          <button type="submit" class="btn">Upload Marks</button>
        </form>
      </div>
    </body></html>`);
  } catch (err) { 
    console.error('Marksheets error:', err);
    res.status(500).send('Error: ' + err.message); 
  }
});

app.post('/admin/marksheets/:className/save-online', requireLogin, requireTask('marksheets'), async (req, res) => {
  try {
    const { className } = req.params;
    const { term, year, ...marks } = req.body;
    for (const key in marks) {
      if (key.startsWith('marks_') && marks[key]!== '') {
        const [, student_id, subject_id] = key.split('_');
        await pool.query(`INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (student_id, subject_id, term, year)
          DO UPDATE SET marks = $3, recorded_by = $6, recorded_at = CURRENT_TIMESTAMP`,
          [student_id, subject_id, marks[key], term, year, req.session.username]);
      }
    }
    await logAction(req.session.username, 'MARKS_ENTERED', { class: className, term, year });
    res.redirect(`/admin/marksheets/${className}?term=${term}&year=${year}`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

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

app.post('/admin/marksheets/:className/upload', requireLogin, requireTask('marksheets'), upload.single('excel'), async (req, res) => {
  try {
    const { term, year } = req.body;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];
    const headers = sheet.getRow(1).values;
    const subjectCols = headers.slice(3).map(h => {
      const match = h.match(/(.+)\s\/(\d+)/);
      return match ? { name: match[1].trim(), max: parseInt(match[2]) } : null;
    }).filter(Boolean);

    const subjects = await pool.query('SELECT id, name FROM subjects WHERE class = $1', [req.params.className]);
    const subjMap = Object.fromEntries(subjects.rows.map(s => [s.name, s.id]));

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i).values;
      const student_id = row[1];
      if (!student_id) continue;
      for (let j = 0; j < subjectCols.length; j++) {
        const mark = row[j + 3];
        const subject_id = subjMap[subjectCols[j].name];
        if (mark !== null && mark !== '' && subject_id) {
          await pool.query(`INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (student_id, subject_id, term, year)
            DO UPDATE SET marks = $3, recorded_by = $6`, [student_id, subject_id, mark, term, year, req.session.username]);
        }
      }
    }
    await logAction(req.session.username, 'MARKS_UPLOADED', { class: req.params.className, term, year });
    res.redirect(`/admin/marksheets/${req.params.className}?term=${term}&year=${year}`);
  } catch (err) { res.status(500).send('Upload error: ' + err.message); }
});

// MODULE 3: SUBJECTS
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

app.get('/admin/subjects/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Subject</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Subject</h2>
  <form method="POST" action="/admin/subjects/add">
    <input name="name" placeholder="Subject Name" required>
    <select name="class" required><option value="">Select Class</option>${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
    <select name="department" required><option value="Primary">Primary</option><option value="Nursery">Nursery</option></select>
    <input name="max_marks" type="number" value="100" required>
    <button type="submit">Add Subject</button>
  </form><a href="/admin/subjects">Back</a></div></body></html>`);
});

app.post('/admin/subjects/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, class: className, department, max_marks } = req.body;
  await pool.query('INSERT INTO subjects (name, class, department, max_marks) VALUES ($1, $2, $3, $4)', [name, className, department, max_marks]);
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
  await pool.query('UPDATE subjects SET name=$1, class=$2, department=$3, max_marks=$4 WHERE id=$5', [name, className, department, max_marks, req.params.id]);
  res.redirect('/admin/subjects');
});

app.post('/admin/subjects/delete/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE subjects SET active = false WHERE id = $1', [req.params.id]);
  res.redirect('/admin/subjects');
});

// MODULE 4: STAFF
app.get('/admin/staff', requireLogin, requireTask('staff_management'), async (req, res) => {
  const staff = await pool.query(`SELECT * FROM staff WHERE active = true ORDER BY department, full_name`);
  res.send(`<!DOCTYPE html><html><head><title>Staff Management</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>👥 Staff Management</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/staff/add" class="btn">+ Add Staff</a></div>
    <div class="card"><table><tr><th>Name</th><th>Position</th><th>Department</th><th>Salary</th><th>Contact</th></tr>
      ${staff.rows.map(s => `<tr><td><strong>${s.full_name}</strong><br><small>${s.username}</small></td><td>${s.position}</td><td>${s.department}</td><td>UGX ${Number(s.monthly_salary).toLocaleString()}</td><td>${s.phone}<br>${s.email}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/admin/staff/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Staff</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Staff Member</h2>
  <form method="POST" action="/admin/staff/add">
    <input name="username" placeholder="Username for login" required>
    <input type="password" name="password" placeholder="Password" required>
    <input name="full_name" placeholder="Full Name" required>
    <input name="position" placeholder="Position e.g Senior Teacher" required>
    <select name="department" required>${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
    <input name="phone" placeholder="Phone Number">
    <input type="email" name="email" placeholder="Email">
    <input name="monthly_salary" type="number" placeholder="Monthly Salary UGX" required>
    <input name="bank_account" placeholder="Bank Account Number">
    <input name="hire_date" type="date">
    <select name="role" required>
      <option value="class_teacher">Class Teacher</option>
      <option value="subject_teacher">Subject Teacher</option>
      <option value="bursar">Bursar</option>
      <option value="admin">Admin</option>
      <option value="support_staff">Support Staff</option>
    </select>
    <button type="submit">Create Staff Member</button>
  </form><a href="/admin/staff">Back</a></div></body></html>`);
});

app.post('/admin/staff/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, position, department, phone, email, monthly_salary, bank_account, hire_date, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role, full_name, department, phone, email) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [username, hash, role, full_name, department, phone, email]);
    await pool.query('INSERT INTO staff (username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account]);
    await logAction(req.session.username, 'STAFF_CREATED', { username, full_name });
    res.redirect('/admin/staff');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// MODULE 5: DONORS
app.get('/admin/donors', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const donors = await pool.query(`SELECT d.*, COALESCE(SUM(don.amount), 0) as total_donated
    FROM donors d LEFT JOIN donations don ON d.id = don.donor_id
    GROUP BY d.id ORDER BY d.name`);
  res.send(`<!DOCTYPE html><html><head><title>Donors Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#e67e22;color:white}.btn{background:#e67e22;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>🤝 Donors Portal</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/donors/add" class="btn">+ Add Donor</a><br><br>
  <table><tr><th>Donor</th><th>Organization</th><th>Contact</th><th>Total Donated</th><th>Actions</th></tr>
  ${donors.rows.map(d => `<tr><td>${d.name}</td><td>${d.organization || '-'}</td><td>${d.phone || d.email || '-'}</td><td>UGX ${Number(d.total_donated).toLocaleString()}</td><td><a href="/admin/donors/donate/${d.id}" class="btn">Record Donation</a></td></tr>`).join('')}
  </table></body></html>`);
});

app.get('/admin/donors/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Donor</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Donor</h2>
  <form method="POST" action="/admin/donors/add">
    <input name="name" placeholder="Donor Name" required>
    <input name="organization" placeholder="Organization">
    <input name="phone" placeholder="Phone">
    <input type="email" name="email" placeholder="Email">
    <input name="address" placeholder="Address">
    <button type="submit">Add Donor</button>
  </form><a href="/admin/donors">Back</a></div></body></html>`);
});

app.post('/admin/donors/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, organization, phone, email, address } = req.body;
  await pool.query('INSERT INTO donors (name, organization, phone, email, address) VALUES ($1, $2, $3, $4, $5)', [name, organization, phone, email, address]);
  res.redirect('/admin/donors');
});

app.get('/admin/donors/donate/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const donor = await pool.query('SELECT * FROM donors WHERE id = $1', [req.params.id]);
  const d = donor.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Record Donation</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Donation from ${d.name}</h2>
  <form method="POST" action="/admin/donors/donate/${d.id}">
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="purpose" placeholder="Purpose e.g Building Fund" required>
    <select name="method" required><option value="Cash">Cash</option><option value="Bank">Bank Transfer</option><option value="Mobile Money">Mobile Money</option></select>
    <input name="reference" placeholder="Reference/Receipt No">
    <button type="submit">Record Donation</button>
  </form><a href="/admin/donors">Back</a></div></body></html>`);
});

app.post('/admin/donors/donate/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { amount, purpose, method, reference } = req.body;
  await pool.query('INSERT INTO donations (donor_id, amount, purpose, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.params.id, amount, purpose, method, reference, req.session.username]);
  await logAction(req.session.username, 'DONATION_RECORDED', { donor_id: req.params.id, amount });
  res.redirect('/admin/donors');
});

// MODULE 6: ASSETS
app.get('/admin/assets', requireLogin, requireTask('assets'), async (req, res) => {
  const assets = await pool.query('SELECT * FROM school_assets ORDER BY category, asset_name');
  res.send(`<!DOCTYPE html><html><head><title>School Assets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>📦 School Assets & Stores</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/assets/add" class="btn">+ Add Asset</a></div>
    <div class="card"><table><tr><th>Asset Name</th><th>Category</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Location</th></tr>  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// CREATE USER - PROFESSIONAL FORM
app.get('/admin/users/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:900px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button,textarea{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}.section{border:1px solid #ddd;padding:15px;border-radius:8px;margin:15px 0}</style>
  </head><body><div class="card"><h2>Create New Staff Member</h2>
  <form method="POST" action="/admin/users/add">
    <div class="section"><h3>Basic Information</h3>
      <input name="username" placeholder="Username for login" required>
      <input type="password" name="password" placeholder="Password" required>
      <input name="full_name" placeholder="Full Name" required>
      <input name="phone" placeholder="Phone Number">
      <input type="email" name="email" placeholder="Email">
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
  </form><a href="/admin/staff">Back</a></div></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, phone, email, department, position, monthly_salary, bank_account, hire_date, role, assigned_class } = req.body;
    const hash = await bcrypt.hash(password, 10);

    await pool.query('INSERT INTO users (username, password, role, full_name, assigned_class, phone, email, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [username, hash, role, full_name, assigned_class || null, phone, email, department]);

    await pool.query('INSERT INTO staff (username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account]);

    await logAction(req.session.username, 'STAFF_CREATED', { username, full_name });
    res.send(`Staff ${full_name} created successfully. <a href="/admin/staff">View All Staff</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// STAFF PAYROLL
app.get('/admin/staff/payroll', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { month = new Date().toLocaleString('default', { month: 'long' }), year = new Date().getFullYear() } = req.query;
  const staff = await pool.query(`SELECT s.*, COALESCE(SUM(sp.amount), 0) as paid_this_month
    FROM staff s LEFT JOIN salary_payments sp ON s.id = sp.staff_id AND sp.month = $1 AND sp.year = $2
    WHERE s.active = true GROUP BY s.id ORDER BY s.department, s.full_name`, [month, year]);
  res.send(`<!DOCTYPE html><html><head><title>Staff Payroll</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}.paid{color:#27ae60;font-weight:bold}.unpaid{color:#e74c3c;font-weight:bold}</style>
  </head><body>
    <div class="card"><h1>💰 Staff Payroll - ${month} ${year}</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <form method="GET" style="margin-bottom:15px">
        <select name="month">${['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => `<option value="${m}" ${month===m?'selected':''}>${m}</option>`).join('')}</select>
        <input name="year" type="number" value="${year}" style="width:100px">
        <button type="submit" class="btn">Filter</button>
      </form>
      <table><tr><th>Name</th><th>Position</th><th>Department</th><th>Monthly Salary</th><th>Paid</th><th>Balance</th><th>Action</th></tr>
      ${staff.rows.map(s => {
        const balance = s.monthly_salary - s.paid_this_month;
        return `<tr>
          <td><strong>${s.full_name}</strong><br><small>${s.username}</small></td>
          <td>${s.position}</td>
          <td>${s.department}</td>
          <td>UGX ${Number(s.monthly_salary).toLocaleString()}</td>
          <td class="${s.paid_this_month >= s.monthly_salary? 'paid' : ''}">UGX ${Number(s.paid_this_month).toLocaleString()}</td>
          <td class="${balance > 0? 'unpaid' : 'paid'}">UGX ${Number(balance).toLocaleString()}</td>
          <td>${balance > 0? `<a href="/admin/staff/pay/${s.id}?month=${month}&year=${year}" class="btn">Pay Salary</a>` : 'Paid'}</td>
        </tr>`;
      }).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/staff/pay/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { month, year } = req.query;
  const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.id]);
  const s = staff.rows[0];
  const paid = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM salary_payments WHERE staff_id = $1 AND month = $2 AND year = $3', [s.id, month, year]);
  const balance = s.monthly_salary - paid.rows[0].total;
  res.send(`<!DOCTYPE html><html><head><title>Pay Salary</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Pay ${s.full_name}</h2><p>Month: ${month} ${year}<br>Salary: UGX ${Number(s.monthly_salary).toLocaleString()}<br>Already Paid: UGX ${Number(paid.rows[0].total).toLocaleString()}<br>Balance: UGX ${Number(balance).toLocaleString()}</p>
  <form method="POST" action="/admin/staff/pay/${s.id}">
    <input type="hidden" name="month" value="${month}">
    <input type="hidden" name="year" value="${year}">
    <input name="amount" type="number" value="${balance}" max="${balance}" required>
    <select name="method" required><option value="Cash">Cash</option><option value="Bank">Bank Transfer</option><option value="Mobile Money">Mobile Money</option></select>
    <input name="reference" placeholder="Reference/Receipt No">
    <button type="submit">Record Payment</button>
  </form><a href="/admin/staff/payroll?month=${month}&year=${year}">Back</a></div></body></html>`);
});

app.post('/admin/staff/pay/:id', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  const { amount, method, reference, month, year } = req.body;
  await pool.query('INSERT INTO salary_payments (staff_id, amount, month, year, method, reference, paid_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.params.id, amount, month, year, method, reference, req.session.username]);
  await logAction(req.session.username, 'SALARY_PAID', { staff_id: req.params.id, amount, month, year });
  res.redirect(`/admin/staff/payroll?month=${month}&year=${year}`);
});

// AUTO-WITHDRAW - Fridays 5pm EAT
cron.schedule('0 17 * * 5', async () => {
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (balance.rows[0]?.balance > 10000) {
    console.log(`Auto-withdraw UGX ${balance.rows[0].balance} triggered for Friday 5pm`);
    // Add your MTN MoMo API call here later
  }
}, { timezone: "Africa/Kampala" });

// START SERVER - MUST BE LAST
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
});
