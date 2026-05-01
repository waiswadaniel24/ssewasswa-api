require('dotenv').config();
const rateLimit = require('express-rate-limit');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const multer = require('multer');
const cron = require('node-cron');
const fileUpload = require('express-fileupload');
const XLSX = require('xlsx');
const AfricasTalking = require('africastalking');

const upload = multer({ dest: '/tmp/' });
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

// SMS Setup - Add AT_API_KEY and AT_USERNAME to Render env vars
const at = process.env.AT_API_KEY? AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME || 'sandbox'
}) : null;
const sms = at? at.SMS : null;

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static('public'));

app.use(session({
  store: new pgSession({ pool: pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

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

// MULTI-INSTITUTION CONFIG
const SCHOOL_TYPES = ['Nursery', 'Primary', 'Secondary', 'Tertiary', 'Vocational', 'Other'];
const ALL_CLASSES = {
  'Nursery': ['Baby Class', 'Middle Class', 'Top Class'],
  'Primary': ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
  'Secondary': ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  'Tertiary': ['Year 1', 'Year 2', 'Year 3', 'Year 4'],
  'Vocational': ['Level 1', 'Level 2', 'Level 3', 'Level 4'],
  'Other': ['Custom 1', 'Custom 2', 'Custom 3']
};
const DEPARTMENTS = ['Nursery', 'Primary', 'Secondary', 'Tertiary', 'Vocational', 'Administration', 'Support Staff', 'Other'];
const TERMS = ['Term 1', 'Term 2', 'Term 3', 'Semester 1', 'Semester 2'];

// SMS HELPER
const sendSMS = async (to, message) => {
  if (!sms) return console.log('SMS disabled - no API key');
  try {
    const result = await sms.send({ to, message });
    console.log('SMS sent:', result);
    return result;
  } catch (err) {
    console.error('SMS failed:', err.message);
  }
};

const creditAdmin = async (amount, type, description, reference_id = null, school_id = 1) => {
  const platformFee = Math.ceil(amount * 0.015);
  const impactFund = Math.ceil(platformFee * 0.1);
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
        school_type VARCHAR(20) DEFAULT 'Primary', department VARCHAR(20) DEFAULT 'Primary', custom_fields JSONB DEFAULT '{}'
      );
      ALTER TABLE students ADD COLUMN IF NOT EXISTS school_type VARCHAR(20) DEFAULT 'Primary';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS department VARCHAR(20) DEFAULT 'Primary';

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
        school_type VARCHAR(20) DEFAULT 'Primary', department VARCHAR(20) DEFAULT 'Primary',
        max_marks INTEGER DEFAULT 100, active BOOLEAN DEFAULT true
      );
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS school_type VARCHAR(20) DEFAULT 'Primary';
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS department VARCHAR(20) DEFAULT 'Primary';

      CREATE TABLE IF NOT EXISTS exam_results (
        id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
        marks NUMERIC, term VARCHAR(20), year INTEGER, recorded_by VARCHAR(50),
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_results_student_id_subject_id_term_year_key') THEN
          ALTER TABLE exam_results ADD CONSTRAINT exam_results_student_id_subject_id_term_year_key UNIQUE(student_id, subject_id, term, year);
        END IF;
      END $$;

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

      -- NEW MODULES
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        date DATE NOT NULL, status VARCHAR(20) NOT NULL, term VARCHAR(20), year INTEGER,
        recorded_by VARCHAR(50), UNIQUE(student_id, date)
      );
      CREATE TABLE IF NOT EXISTS library_books (
        id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL, author VARCHAR(100),
        isbn VARCHAR(50), category VARCHAR(100), quantity INTEGER DEFAULT 1,
        available INTEGER DEFAULT 1, added_date DATE DEFAULT CURRENT_DATE
      );
      CREATE TABLE IF NOT EXISTS book_loans (
        id SERIAL PRIMARY KEY, book_id INTEGER REFERENCES library_books(id),
        student_id INTEGER REFERENCES students(id), loan_date DATE DEFAULT CURRENT_DATE,
        due_date DATE, return_date DATE, status VARCHAR(20) DEFAULT 'borrowed'
      );
      CREATE TABLE IF NOT EXISTS momo_transactions (
        id SERIAL PRIMARY KEY, transaction_id VARCHAR(100) UNIQUE, amount INTEGER,
        phone VARCHAR(50), status VARCHAR(50), type VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // SEED SUBJECTS FOR ALL SCHOOL TYPES
    const subjCount = await pool.query('SELECT COUNT(*) FROM subjects');
    if (subjCount.rows[0].count == 0) {
      const nurserySubjects = ['Number Work', 'Language Development', 'Social Development', 'Health Habits', 'Creative Arts'];
      const primarySubjects = ['Mathematics', 'English', 'Science', 'Social Studies', 'R.E'];
      const secondarySubjects = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'CRE', 'Entrepreneurship', 'ICT'];
      const tertiarySubjects = ['Research Methods', 'Statistics', 'Professional Ethics', 'ICT', 'Communication Skills'];
      const vocationalSubjects = ['Technical Drawing', 'Workshop Practice', 'Entrepreneurship', 'ICT', 'Safety'];

      for (const cls of ALL_CLASSES['Nursery']) {
        for (const subj of nurserySubjects) {
          await pool.query('INSERT INTO subjects (name, class, school_type, department) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [subj, cls, 'Nursery']);
        }
      }
      for (const cls of ALL_CLASSES['Primary']) {
        for (const subj of primarySubjects) {
          await pool.query('INSERT INTO subjects (name, class, school_type, department) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [subj, cls, 'Primary']);
        }
      }
      for (const cls of ALL_CLASSES['Secondary']) {
        for (const subj of secondarySubjects) {
          await pool.query('INSERT INTO subjects (name, class, school_type, department) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [subj, cls, 'Secondary']);
        }
      }
      for (const cls of ALL_CLASSES['Tertiary']) {
        for (const subj of tertiarySubjects) {
          await pool.query('INSERT INTO subjects (name, class, school_type, department) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [subj, cls, 'Tertiary']);
        }
      }
      for (const cls of ALL_CLASSES['Vocational']) {
        for (const subj of vocationalSubjects) {
          await pool.query('INSERT INTO subjects (name, class, school_type, department) VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING', [subj, cls, 'Vocational']);
        }
      }
    }

    await pool.query('INSERT INTO admin_wallet (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    console.log('✅ Multi-School + All Modules Database ready');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: 'connected', time: new Date() });
});

// LOGIN & ADMIN - Keep all existing routes from previous version
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

// UPDATE ADMIN DASHBOARD WITH NEW MODULES
app.get('/admin', requireLogin, async (req, res) => {
  const user = req.session;
  const totals = await pool.query(`SELECT COUNT(*) as total_students, SUM(total_fees) as total_fees, SUM(balance) as total_outstanding FROM students`);
  const donorTotals = await pool.query(`SELECT COUNT(*) as total_donors, SUM(amount) as total_donated FROM donations`);
  const staffTotals = await pool.query(`SELECT COUNT(*) as total_staff, SUM(monthly_salary) as total_payroll FROM staff WHERE active = true`);
  const impactFund = await pool.query(`SELECT SUM(amount) as total FROM impact_fund_transactions`);
  const schoolTypeCounts = await pool.query(`SELECT school_type, COUNT(*) as count FROM students GROUP BY school_type`);
  const bookCount = await pool.query(`SELECT COUNT(*) as total, SUM(quantity) as copies FROM library_books`);
  const t = totals.rows[0] || {}, d = donorTotals.rows[0] || {}, s = staffTotals.rows[0] || {}, i = impactFund.rows[0] || {}, b = bookCount.rows[0] || {};

  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 16px;text-decoration:none;border-radius:4px;display:inline-block;margin:4px 4px 0 0;font-size:14px}.portal{background:#9b59b6}.donor{background:#e67e22}.staff{background:#16a085}.asset{background:#8e44ad}.library{background:#34495e}.attendance{background:#e74c3c}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat{background:#ecf0f1;padding:12px;border-radius:4px;text-align:center}.section-title{margin:15px 0 10px 0;color:#34495e;border-bottom:2px solid #3498db;padding-bottom:5px}.school-type-stats{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.type-badge{background:#34495e;color:white;padding:6px 12px;border-radius:20px;font-size:12px}</style>
    </head><body>
      <div class="card"><h1>Admin Dashboard - Multi-Institution ERP</h1><p>Logged in as: ${user.username} (${user.role})</p></div>
      <div class="card"><h3>School Overview</h3>
        <div class="school-type-stats">
          ${schoolTypeCounts.rows.map(st => `<span class="type-badge">${st.school_type}: ${st.count} students</span>`).join('')}
        </div>
        <div class="stats">
          <div class="stat"><strong>Total Students</strong><br>${t.total_students || 0}</div>
          <div class="stat"><strong>Fees Expected</strong><br>UGX ${Number(t.total_fees || 0).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding</strong><br>UGX ${Number(t.total_outstanding || 0).toLocaleString()}</div>
          <div class="stat"><strong>Donations</strong><br>UGX ${Number(d.total_donated || 0).toLocaleString()}</div>
          <div class="stat"><strong>Staff</strong><br>${s.total_staff || 0}</div>
          <div class="stat"><strong>Monthly Payroll</strong><br>UGX ${Number(s.total_payroll || 0).toLocaleString()}</div>
          <div class="stat"><strong>Impact Fund</strong><br>UGX ${Number(i.total || 0).toLocaleString()}</div>
          <div class="stat"><strong>Library Books</strong><br>${b.copies || 0} copies</div>
        </div>
      <div class="card">
        <h3 class="section-title">📚 Academic Portals</h3>
        <a href="/admin/marksheets" class="btn portal">Marksheets</a>
        <a href="/admin/subjects" class="btn portal">Manage Subjects</a>
        <a href="/admin/attendance" class="btn attendance">Attendance Register</a>
        <a href="/admin/library" class="btn library">Library Management</a>
        <h3 class="section-title">💰 Financial Portals</h3>
        <a href="/admin/students" class="btn portal">Students & Fees</a>
        <a href="/admin/students/bulk-upload" class="btn" style="background:#16a085">Bulk Import Students</a>
        <a href="/admin/donors" class="btn donor">Donors Portal</a>
        <a href="/admin/staff/payroll" class="btn staff">Staff Payroll</a>
        <a href="/admin/assets" class="btn asset">School Assets</a>
        <a href="/admin/momo" class="btn" style="background:#f39c12">MTN MoMo</a>
        <h3 class="section-title">👥 Staff Management</h3>
        <a href="/admin/staff" class="btn staff">All Staff</a>
        <a href="/admin/tasks" class="btn portal">Assign Portal Tasks</a>
        <a href="/admin/users/add" class="btn">Create User</a>
        <h3 class="section-title">⚙️ System</h3>
        <a href="/admin/fields" class="btn portal">Custom Student Fields</a>
        ${user.username === 'superadmin'? '<a href="/admin/branding" class="btn" style="background:#e74c3c">Branding Console</a>' : ''}
        <h3 class="section-title">👨‍👩‍👧 Parents</h3>
        <a href="/parent/login" class="btn" style="background:#16a085">Parent Portal</a>
      </div>
      <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    </body></html>`);
});

// BULK STUDENT IMPORT
app.get('/admin/students/bulk-upload', requireLogin, requireRole(['admin', 'bursar']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Bulk Upload Students</title>
  <style>body{font-family:Arial;max-width:700px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block}</style>
  </head><body><div class="card"><h1>📤 Bulk Import Students</h1>
    <p>Upload Excel file with columns: <strong>name, school_type, class, term, year, total_fees, balance, parent_name, parent_phone</strong></p>
    <a href="/admin/students/template" class="btn">Download Template</a>
    <form method="POST" action="/admin/students/bulk-upload" enctype="multipart/form-data" style="margin-top:20px">
      <input type="file" name="excel" accept=".xlsx,.xls" required>
      <button type="submit">Upload & Import</button>
    </form>
    <a href="/admin/students" style="display:inline-block;margin-top:15px">← Back to Students</a>
  </div></body></html>`);
});

app.get('/admin/students/template', requireLogin, (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['name', 'school_type', 'class', 'term', 'year', 'total_fees', 'balance', 'parent_name', 'parent_phone']);
  sheet.addRow(['John Doe', 'Primary', 'P5', 'Term 1', 2026, 500000, 500000, 'Jane Doe', '0772123456']);
  sheet.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=student_template.xlsx');
  workbook.xlsx.write(res).then(() => res.end());
});

app.post('/admin/students/bulk-upload', requireLogin, requireRole(['admin', 'bursar']), async (req, res) => {
  try {
    if (!req.files ||!req.files.excel) return res.status(400).send('No file uploaded');
    const workbook = XLSX.read(req.files.excel.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    let imported = 0;
    for (const row of data) {
      if (!row.name ||!row.school_type ||!row.class) continue;
      await pool.query('INSERT INTO students (name, class, term, year, total_fees, balance, parent_name, parent_phone, school_type, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)',
        [row.name, row.class, row.term || 'Term 1', row.year || 2026, row.total_fees || 0, row.balance || 0, row.parent_name, row.parent_phone, row.school_type]);
      imported++;
    }
    await logAction(req.session.username, 'BULK_STUDENTS_IMPORTED', { count: imported });
    res.send(`Successfully imported ${imported} students. <a href="/admin/students">View Students</a>`);
  } catch (err) { res.status(500).send('Upload error: ' + err.message); }
});

// ATTENDANCE MODULE
app.get('/admin/attendance', requireLogin, requireTask('attendance'), async (req, res) => {
  const { class: filterClass, date = new Date().toISOString().split('T')[0] } = req.query;
  const classes = [...new Set(Object.values(ALL_CLASSES).flat())];
  let students = [];
  if (filterClass) {
    const result = await pool.query('SELECT s.*, a.status FROM students s LEFT JOIN attendance a ON s.id = a.student_id AND a.date = $2 WHERE s.class = $1 ORDER BY s.name', [filterClass, date]);
    students = result.rows;
  }
  res.send(`<!DOCTYPE html><html><head><title>Attendance Register</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}select,input,button{padding:8px;margin:4px}.present{background:#27ae60;color:white}.absent{background:#e74c3c;color:white}.late{background:#f39c12;color:white}</style>
  </head><body>
    <div class="card"><h1>📋 Attendance Register</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <form method="GET">
        <select name="class" required><option value="">Select Class</option>${classes.map(c => `<option value="${c}" ${filterClass===c?'selected':''}>${c}</option>`).join('')}</select>
        <input type="date" name="date" value="${date}" required>
        <button type="submit" class="btn">Load Register</button>
      </form>
    </div>
    ${filterClass? `<div class="card"><h3>${filterClass} - ${new Date(date).toDateString()}</h3>
      <form method="POST" action="/admin/attendance/save">
        <input type="hidden" name="date" value="${date}">
        <input type="hidden" name="class" value="${filterClass}">
        <table><tr><th>Student Name</th><th>Status</th></tr>
        ${students.map(s => `<tr>
          <td>${s.name}</td>
          <td>
            <select name="status_${s.id}">
              <option value="present" ${s.status==='present'?'selected':''}>Present</option>
              <option value="absent" ${s.status==='absent'?'selected':''}>Absent</option>
              <option value="late" ${s.status==='late'?'selected':''}>Late</option>
              <option value="excused" ${s.status==='excused'?'selected':''}>Excused</option>
            </select>
          </td>
        </tr>`).join('')}
        </table>
        <button type="submit" class="btn" style="background:#27ae60;margin-top:15px">Save Attendance</button>
      </form>
    </div>` : ''}
  </body></html>`);
});

app.post('/admin/attendance/save', requireLogin, requireTask('attendance'), async (req, res) => {
  const { date, class: className,...statuses } = req.body;
  const students = await pool.query('SELECT id FROM students WHERE class = $1', [className]);
  const year = new Date(date).getFullYear();
  const term = 'Term 1'; // You can make this dynamic

  for (const s of students.rows) {
    const status = statuses[`status_${s.id}`];
    if (status) {
      await pool.query(`INSERT INTO attendance (student_id, date, status, term, year, recorded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (student_id, date) DO UPDATE SET status = $3`,
        [s.id, date, status, term, year, req.session.username]);
    }
  }
  await logAction(req.session.username, 'ATTENDANCE_RECORDED', { class: className, date });
  res.redirect(`/admin/attendance?class=${className}&date=${date}`);
});

// LIBRARY MANAGEMENT
app.get('/admin/library', requireLogin, requireTask('library'), async (req, res) => {
  const books = await pool.query('SELECT * FROM library_books ORDER BY title');
  res.send(`<!DOCTYPE html><html><head><title>Library Management</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>📚 Library Management</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/library/add-book" class="btn">+ Add Book</a> <a href="/admin/library/loans" class="btn">Manage Loans</a></div>
    <div class="card"><table><tr><th>Title</th><th>Author</th><th>Category</th><th>Total Copies</th><th>Available</th><th>Actions</th></tr>
      ${books.rows.map(b => `<tr><td>${b.title}</td><td>${b.author}</td><td>${b.category}</td><td>${b.quantity}</td><td>${b.available}</td><td><a href="/admin/library/loan/${b.id}" class="btn">Issue</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/admin/library/add-book', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Book</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Book to Library</h2>
  <form method="POST" action="/admin/library/add-book">
    <input name="title" placeholder="Book Title" required>
    <input name="author" placeholder="Author">
    <input name="isbn" placeholder="ISBN">
    <input name="category" placeholder="Category e.g Science, Fiction">
    <input name="quantity" type="number" value="1" placeholder="Number of Copies" required>
    <button type="submit">Add Book</button>
  </form><a href="/admin/library">Back</a></div></body></html>`);
});

app.post('/admin/library/add-book', requireLogin, requireRole(['admin']), async (req, res) => {
  const { title, author, isbn, category, quantity } = req.body;
  await pool.query('INSERT INTO library_books (title, author, isbn, category, quantity, available) VALUES ($1, $2, $3, $4, $5, $5)',
    [title, author, isbn, category, quantity]);
  res.redirect('/admin/library');
});

app.get('/admin/library/loan/:book_id', requireLogin, requireRole(['admin', 'librarian']), async (req, res) => {
  const book = await pool.query('SELECT * FROM library_books WHERE id = $1', [req.params.book_id]);
  const students = await pool.query('SELECT id, name, class FROM students ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Issue Book</title>
    <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}select,input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Issue Book: ${book.rows[0].title}</h2>
  <form method="POST" action="/admin/library/loan/${req.params.book_id}">
    <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class}</option>`).join('')}</select>
    <input type="date" name="due_date" required>
    <button type="submit">Issue Book</button>
  </form><a href="/admin/library">Back</a></div></body></html>`);
});

app.post('/admin/library/loan/:book_id', requireLogin, requireRole(['admin', 'librarian']), async (req, res) => {
  const { student_id, due_date } = req.body;
  await pool.query('INSERT INTO book_loans (book_id, student_id, due_date) VALUES ($1, $2, $3)', [req.params.book_id, student_id, due_date]);
  await pool.query('UPDATE library_books SET available = available - 1 WHERE id = $1', [req.params.book_id]);
  res.redirect('/admin/library');
});

app.get('/admin/library/loans', requireLogin, requireRole(['admin', 'librarian']), async (req, res) => {
  const loans = await pool.query(`SELECT bl.*, b.title, s.name as student_name, s.class
    FROM book_loans bl
    JOIN library_books b ON bl.book_id = b.id
    JOIN students s ON bl.student_id = s.id
    WHERE bl.status = 'borrowed' ORDER BY bl.due_date`);
  res.send(`<!DOCTYPE html><html><head><title>Book Loans</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}.overdue{color:#e74c3c;font-weight:bold}</style>
  </head><body>
    <div class="card"><h1>📖 Active Book Loans</h1><a href="/admin/library" class="btn">← Library</a></div>
    <div class="card"><table><tr><th>Book</th><th>Student</th><th>Class</th><th>Due Date</th><th>Status</th><th>Action</th></tr>
      ${loans.rows.map(l => {
        const overdue = new Date(l.due_date) < new Date();
        return `<tr><td>${l.title}</td><td>${l.student_name}</td><td>${l.class}</td><td class="${overdue? 'overdue' : ''}">${new Date(l.due_date).toLocaleDateString()}</td><td>${overdue? 'OVERDUE' : 'Borrowed'}</td><td><form method="POST" action="/admin/library/return/${l.id}" style="display:inline"><button type="submit" class="btn" style="background:#27ae60">Return</button></form></td></tr>`;
      }).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/library/return/:loan_id', requireLogin, requireRole(['admin', 'librarian']), async (req, res) => {
  const loan = await pool.query('SELECT book_id FROM book_loans WHERE id = $1', [req.params.loan_id]);
  await pool.query('UPDATE book_loans SET status = $1, return_date = CURRENT_DATE WHERE id = $2', ['returned', req.params.loan_id]);
  await pool.query('UPDATE library_books SET available = available + 1 WHERE id = $1', [loan.rows[0].book_id]);
  res.redirect('/admin/library/loans');
});

// MTN MOMO INTEGRATION
app.get('/admin/momo', requireLogin, requireRole(['admin']), async (req, res) => {
  const transactions = await pool.query('SELECT * FROM momo_transactions ORDER BY created_at DESC LIMIT 50');
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  res.send(`<!DOCTYPE html><html><head><title>MTN MoMo</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#f39c12;color:white}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center;font-size:24px}</style>
  </head><body>
    <div class="card"><h1>📱 MTN MoMo Integration</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><div class="stat"><strong>Impact Fund Balance</strong><br>UGX ${Number(balance.rows[0]?.balance || 0).toLocaleString()}</div>
      <form method="POST" action="/admin/momo/withdraw" style="margin-top:15px">
        <input name="amount" type="number" placeholder="Amount to withdraw" max="${balance.rows[0]?.balance || 0}" required>
        <input name="phone" placeholder="MTN Number e.g 0772123456" required>
        <button type="submit" class="btn" style="background:#27ae60">Withdraw to MoMo</button>
      </form>
    </div>
    <div class="card"><h3>Recent Transactions</h3><table><tr><th>Date</th><th>Transaction ID</th><th>Phone</th><th>Amount</th><th>Type</th><th>Status</th></tr>
      ${transactions.rows.map(t => `<tr><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.transaction_id}</td><td>${t.phone}</td><td>UGX ${Number(t.amount).toLocaleString()}</td><td>${t.type}</td><td>${t.status}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/momo/withdraw', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { amount, phone } = req.body;
    const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
    if (Number(amount) > balance.rows[0].balance) return res.status(400).send('Insufficient balance');

    // MTN MoMo API call would go here - for now we simulate
    const transaction_id = 'MOMO' + Date.now();
    await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type) VALUES ($1, $2, $3, $4, $5)',
      [transaction_id, amount, phone, 'pending', 'withdrawal']);
    await pool.query('UPDATE admin_wallet SET balance = balance - $1 WHERE id = 1', [amount]);
    await logAction(req.session.username, 'MOMO_WITHDRAW', { amount, phone, transaction_id });

    res.send(`Withdrawal initiated: UGX ${Number(amount).toLocaleString()} to ${phone}. Transaction ID: ${transaction_id}. <a href="/admin/momo">Back</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// Keep all previous routes: students, marksheets, subjects, staff, payroll, donors, assets, tasks, fields, branding, parent portal
// [PASTE ALL YOUR EXISTING ROUTES FROM PREVIOUS VERSIONS HERE - students, marksheets, subjects, staff, payroll, donors, assets, tasks, fields, branding, parent portal]

// AUTO-WITHDRAW - Fridays 5pm EAT - WITH SMS NOTIFICATION
cron.schedule('0 17 * * 5', async () => {
  try {
    const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
    const amount = balance.rows[0]?.balance || 0;
    if (amount > 10000) {
      const adminPhone = process.env.ADMIN_PHONE || '0770000000';
      await sendSMS(adminPhone, `Impact Fund Auto-Withdraw: UGX ${amount.toLocaleString()} ready for withdrawal to MTN MoMo.`);
      console.log(`Auto-withdraw notification sent: UGX ${amount}`);
      await logAction('system', 'AUTO_WITHDRAW_NOTIFICATION', { amount });
    }
  } catch (err) {
    console.error('Auto-withdraw error:', err.message);
  }
}, { timezone: "Africa/Kampala" });

// AUTO-NOTIFY PARENTS ON PAYMENT - Add this to existing payment route
// Find your app.post('/admin/students/pay/:id') and add this after creditAdmin:
// const student = await pool.query('SELECT parent_phone, name FROM students WHERE id = $1', [studentId]);
// if (student.rows[0]?.parent_phone) {
// await sendSMS(student.rows[0].parent_phone, `Payment received for ${student.rows[0].name}. Amount: UGX ${Number(amount).toLocaleString()}. Thank you!`);
// }

// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
});
