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
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}select,input,button{padding:8px;margin:4px}</style>
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
  const term = 'Term 1';

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

    const transaction_id = 'MOMO' + Date.now();
    await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type) VALUES ($1, $2, $3, $4, $5)',
      [transaction_id, amount, phone, 'pending', 'withdrawal']);
    await pool.query('UPDATE admin_wallet SET balance = balance - $1 WHERE id = 1', [amount]);
    await logAction(req.session.username, 'MOMO_WITHDRAW', { amount, phone, transaction_id });

    res.send(`Withdrawal initiated: UGX ${Number(amount).toLocaleString()} to ${phone}. Transaction ID: ${transaction_id}. <a href="/admin/momo">Back</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// PARENT PORTAL
app.get('/parent/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Parent Login</title><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.login-box{background:white;padding:40px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);width:100%;max-width:400px}h2{text-align:center;color:#1a73e8;margin-bottom:30px}input{width:100%;padding:12px;margin:8px 0;border:1px solid #ddd;border-radius:4px;box-sizing:border-box}button{width:100%;padding:12px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}button:hover{background:#1557b0}.error{color:#d93025;text-align:center;margin-top:10px}</style>
  </head><body><div class="login-box"><h2>Parent Portal Login</h2>
  <form method="POST" action="/parent/login">
    <input type="text" name="parent_phone" placeholder="Your Phone Number" required>
    <input type="text" name="student_name" placeholder="Student's Full Name" required>
    <button type="submit">Login</button>
  </form></div></body></html>`);
});

app.post('/parent/login', async (req, res) => {
  try {
    const { parent_phone, student_name } = req.body;
    const result = await pool.query('SELECT * FROM students WHERE parent_phone = $1 AND LOWER(name) = LOWER($2)', [parent_phone, student_name]);
    if (result.rows.length === 0) return res.status(401).send('Student not found. Check phone number and student name.');
    req.session.parentPhone = parent_phone;
    req.session.studentId = result.rows[0].id;
    res.redirect('/parent/dashboard');
  } catch (err) { res.status(500).send('Login error: ' + err.message); }
});

app.get('/parent/dashboard', async (req, res) => {
  if (!req.session.parentPhone) return res.redirect('/parent/login');
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.session.studentId]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.session.studentId]);
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Parent Dashboard</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f0f2f5}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#1a73e8;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd;text-align:left}th{background:#f8f9fa}</style>
  </head><body>
    <div class="card"><h1>Welcome, ${s.parent_name}</h1><p>Student: ${s.name} - ${s.class} (${s.school_type})</p><a href="/parent/logout" class="btn" style="background:#d93025">Logout</a></div>
    <div class="card"><h3>Fee Status</h3><p><strong>Total Fees:</strong> UGX ${Number(s.total_fees).toLocaleString()}</p><p><strong>Balance:</strong> UGX ${Number(s.balance).toLocaleString()}</p><p><strong>Status:</strong> ${s.balance > 0? 'Outstanding' : 'Cleared'}</p></div>
    <div class="card"><h3>Payment History</h3><a href="/parent/receipt/${s.id}" class="btn">Download Receipt</a><table style="margin-top:15px"><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>${payments.rows.map(p => `<tr><td>${p.payment_date}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.reference}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>Report Cards</h3><a href="/parent/report/${s.id}/Term 1" class="btn">Term 1</a> <a href="/parent/report/${s.id}/Term 2" class="btn">Term 2</a> <a href="/parent/report/${s.id}/Term 3" class="btn">Term 3</a></div>
  </body></html>`);
});

app.get('/parent/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/parent/login'));
});

app.get('/parent/receipt/:studentId', async (req, res) => {
  if (!req.session.parentPhone || req.session.studentId!= req.params.studentId) return res.status(403).send('Access denied');
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.studentId]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.params.studentId]);
  const s = student.rows[0];
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Receipt_${s.name}.pdf`);
  doc.pipe(res);
  doc.fontSize(20).text('PAYMENT RECEIPT', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Student: ${s.name}`);
  doc.text(`Class: ${s.class} (${s.school_type})`);
  doc.text(`Parent: ${s.parent_name}`);
  doc.text(`Total Fees: UGX ${Number(s.total_fees).toLocaleString()}`);
  doc.text(`Balance: UGX ${Number(s.balance).toLocaleString()}`);
  doc.moveDown();
  doc.text('PAYMENT HISTORY:', { underline: true });
  payments.rows.forEach(p => {
    doc.text(`${p.payment_date} - UGX ${Number(p.amount).toLocaleString()} via ${p.method} (${p.reference})`);
  });
  doc.end();
});

app.get('/parent/report/:studentId/:term', async (req, res) => {
  if (!req.session.parentPhone || req.session.studentId!= req.params.studentId) return res.status(403).send('Access denied');
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.studentId]);
  const results = await pool.query(`SELECT er.marks, s.name as subject_name, s.max_marks
    FROM exam_results er
    JOIN subjects s ON er.subject_id = s.id
    WHERE er.student_id = $1 AND er.term = $2 ORDER BY s.name`, [req.params.studentId, req.params.term]);
  const s = student.rows[0];
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Report_${s.name}_${req.params.term}.pdf`);
  doc.pipe(res);
  doc.fontSize(20).text('STUDENT REPORT CARD', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Name: ${s.name}`);
  doc.text(`Class: ${s.class} (${s.school_type})`);
  doc.text(`Term: ${req.params.term} ${new Date().getFullYear()}`);
  doc.moveDown();
  doc.text('RESULTS:', { underline: true });
  let total = 0, count = 0;
  results.rows.forEach(r => {
    doc.text(`${r.subject_name}: ${r.marks}/${r.max_marks}`);
    total += Number(r.marks);
    count++;
  });
  if (count > 0) {
    doc.moveDown();
    doc.text(`Average: ${(total/count).toFixed(2)}%`);
  }
  doc.end();
});

// STUDENTS & FEES - Add your existing students routes here
app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body><div class="card"><h1>Students & Fees</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/students/bulk-upload" class="btn" style="background:#16a085">Bulk Import</a></div>
  <div class="card"><table><tr><th>Name</th><th>Class</th><th>Type</th><th>Total Fees</th><th>Balance</th><th>Parent</th><th>Phone</th></tr>
  ${students.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.school_type}</td><td>${Number(s.total_fees).toLocaleString()}</td><td>${Number(s.balance).toLocaleString()}</td><td>${s.parent_name}</td><td>${s.parent_phone}</td></tr>`).join('')}
  </table></div></body></html>`);
});

// MARKSHEETS
app.get('/admin/marksheets', requireLogin, requireTask('marksheets'), async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Marksheets Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.primary{background:#3498db}.secondary{background:#9b59b6}.tertiary{background:#e67e22}.vocational{background:#16a085}.nursery{background:#e74c3c}</style>
  </head><body>
    <div class="card"><h1>📝 Marksheets Portal</h1><a href="/admin" class="btn">← Dashboard</a></div>
    ${Object.keys(ALL_CLASSES).map(type => `
      <div class="card"><h3>${type} Section</h3>
      ${ALL_CLASSES[type].map(c => `<a href="/admin/marksheets/${c}?type=${type}" class="btn ${type.toLowerCase()}">${c} Marksheet</a>`).join('')}
    </div>`).join('')}
  </body></html>`);
});

// Add all other routes: marksheets/:className, save-online, download-template, upload, subjects, staff, payroll, donors, assets, tasks, fields, branding
// [PASTE YOUR EXISTING ROUTES FOR THESE MODULES HERE - they weren't affected by the 503]

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
// MARKSHEETS - CLASS SPECIFIC
app.get('/admin/marksheets/:className', requireLogin, requireTask('marksheets'), async (req, res) => {
  const { className } = req.params;
  const { type: school_type } = req.query;
  const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
  const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND school_type = $2 AND active = true ORDER BY name', [className, school_type]);
  const term = 'Term 1';
  const year = new Date().getFullYear();

  const results = await pool.query(`SELECT er.*, s.name as subject_name
    FROM exam_results er
    JOIN subjects s ON er.subject_id = s.id
    WHERE er.term = $1 AND er.year = $2 AND s.class = $3`, [term, year, className]);

  const resultMap = {};
  results.rows.forEach(r => {
    resultMap[`${r.student_id}_${r.subject_id}`] = r.marks;
  });

  res.send(`<!DOCTYPE html><html><head><title>${className} Marksheet</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px;border:1px solid #ddd;text-align:center}th{background:#34495e;color:white}input[type=number]{width:60px;padding:4px;text-align:center}</style>
  </head><body>
    <div class="card"><h1>${className} (${school_type}) - ${term} ${year}</h1><a href="/admin/marksheets" class="btn">← Back</a> <a href="/admin/marksheets/download-template/${className}?type=${school_type}" class="btn" style="background:#16a085">Download Excel</a></div>
    <div class="card">
      <form method="POST" action="/admin/marksheets/save-online" id="marksheetForm">
        <input type="hidden" name="className" value="${className}">
        <input type="hidden" name="school_type" value="${school_type}">
        <input type="hidden" name="term" value="${term}">
        <input type="hidden" name="year" value="${year}">
        <table>
          <tr><th>Student Name</th>${subjects.rows.map(s => `<th>${s.name}<br>(${s.max_marks})</th>`).join('')}<th>Average</th></tr>
          ${students.rows.map(st => {
            let total = 0, count = 0;
            const cells = subjects.rows.map(subj => {
              const mark = resultMap[`${st.id}_${subj.id}`] || '';
              if (mark!== '') { total += Number(mark); count++; }
              return `<td><input type="number" name="mark_${st.id}_${subj.id}" value="${mark}" min="0" max="${subj.max_marks}" step="0.5"></td>`;
            }).join('');
            const avg = count > 0? (total/count).toFixed(1) : '';
            return `<tr><td style="text-align:left">${st.name}</td>${cells}<td><strong>${avg}</strong></td></tr>`;
          }).join('')}
        </table>
        <button type="submit" class="btn" style="background:#27ae60;margin-top:15px">Save All Marks</button>
      </form>
      <form method="POST" action="/admin/marksheets/upload" enctype="multipart/form-data" style="margin-top:20px">
        <input type="hidden" name="className" value="${className}">
        <input type="hidden" name="school_type" value="${school_type}">
        <input type="file" name="excel" accept=".xlsx" required>
        <button type="submit" class="btn">Upload Excel Marksheet</button>
      </form>
    </div>
  </body></html>`);
});

app.post('/admin/marksheets/save-online', requireLogin, requireTask('marksheets'), async (req, res) => {
  const { className, school_type, term, year,...marks } = req.body;
  const students = await pool.query('SELECT id FROM students WHERE class = $1', [className]);
  const subjects = await pool.query('SELECT id FROM subjects WHERE class = $1 AND school_type = $2', [className, school_type]);

  for (const student of students.rows) {
    for (const subject of subjects.rows) {
      const markKey = `mark_${student.id}_${subject.id}`;
      const markValue = marks[markKey];
      if (markValue!== '' && markValue!== undefined) {
        await pool.query(`INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (student_id, subject_id, term, year) DO UPDATE SET marks = $3`,
          [student.id, subject.id, markValue, term, year, req.session.username]);
      }
    }
  }
  await logAction(req.session.username, 'MARKS_SAVED_ONLINE', { class: className, term });
  res.redirect(`/admin/marksheets/${className}?type=${school_type}`);
});

app.get('/admin/marksheets/download-template/:className', requireLogin, requireTask('marksheets'), async (req, res) => {
  const { className } = req.params;
  const { type: school_type } = req.query;
  const students = await pool.query('SELECT name FROM students WHERE class = $1 ORDER BY name', [className]);
  const subjects = await pool.query('SELECT name, max_marks FROM subjects WHERE class = $1 AND school_type = $2 ORDER BY name', [className, school_type]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Marksheet');
  sheet.addRow(['Student Name',...subjects.rows.map(s => `${s.name} (${s.max_marks})`)]);
  students.rows.forEach(s => sheet.addRow([s.name,...subjects.rows.map(() => '')]));
  sheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${className}_Marksheet.xlsx`);
  workbook.xlsx.write(res).then(() => res.end());
});

app.post('/admin/marksheets/upload', requireLogin, requireTask('marksheets'), upload.single('excel'), async (req, res) => {
  try {
    const { className, school_type } = req.body;
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const headers = data[0];
    const subjects = await pool.query('SELECT id, name FROM subjects WHERE class = $1 AND school_type = $2', [className, school_type]);
    const subjectMap = {};
    subjects.rows.forEach(s => subjectMap[s.name] = s.id);

    const term = 'Term 1';
    const year = new Date().getFullYear();

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const studentName = row[0];
      if (!studentName) continue;

      const student = await pool.query('SELECT id FROM students WHERE name = $1 AND class = $2', [studentName, className]);
      if (student.rows.length === 0) continue;

      for (let j = 1; j < headers.length; j++) {
        const subjectName = headers[j].split(' (')[0];
        const subjectId = subjectMap[subjectName];
        const mark = row[j];
        if (subjectId && mark!== '' && mark!== undefined) {
          await pool.query(`INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (student_id, subject_id, term, year) DO UPDATE SET marks = $3`,
            [student.rows[0].id, subjectId, mark, term, year, req.session.username]);
        }
      }
    }
    await logAction(req.session.username, 'MARKS_UPLOADED', { class: className });
    res.redirect(`/admin/marksheets/${className}?type=${school_type}`);
  } catch (err) { res.status(500).send('Upload error: ' + err.message); }
});

// SUBJECTS MANAGEMENT
app.get('/admin/subjects', requireLogin, requireRole(['admin']), async (req, res) => {
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY school_type, class, name');
  res.send(`<!DOCTYPE html><html><head><title>Manage Subjects</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}input{padding:6px;margin:2px}</style>
  </head><body>
    <div class="card"><h1>Manage Subjects</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Add New Subject</h3>
      <form method="POST" action="/admin/subjects/add">
        <input name="name" placeholder="Subject Name" required>
        <select name="school_type" required>${SCHOOL_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
        <select name="class" required>${[...new Set(Object.values(ALL_CLASSES).flat())].map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        <input name="max_marks" type="number" value="100" placeholder="Max Marks" required>
        <button type="submit" class="btn" style="background:#27ae60">Add Subject</button>
      </form>
    </div>
    <div class="card"><table><tr><th>Subject</th><th>Class</th><th>School Type</th><th>Max Marks</th><th>Status</th></tr>
      ${subjects.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.school_type}</td><td>${s.max_marks}</td><td>${s.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/subjects/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, school_type, class: className, max_marks } = req.body;
  await pool.query('INSERT INTO subjects (name, class, school_type, department, max_marks) VALUES ($1, $2, $3, $3, $4)',
    [name, className, school_type, max_marks]);
  res.redirect('/admin/subjects');
});

// STAFF MANAGEMENT
app.get('/admin/staff', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff ORDER BY department, full_name');
  res.send(`<!DOCTYPE html><html><head><title>Staff Management</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>All Staff</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/users/add" class="btn" style="background:#27ae60">Add Staff User</a></div>
    <div class="card"><table><tr><th>Name</th><th>Username</th><th>Position</th><th>Department</th><th>Phone</th><th>Email</th><th>Salary</th></tr>
      ${staff.rows.map(s => `<tr><td>${s.full_name}</td><td>${s.username}</td><td>${s.position}</td><td>${s.department}</td><td>${s.phone}</td><td>${s.email}</td><td>${Number(s.monthly_salary).toLocaleString()}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

// STAFF PAYROLL
app.get('/admin/staff/payroll', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff WHERE active = true ORDER BY department, full_name');
  const month = new Date().toLocaleString('default', { month: 'long' });
  const year = new Date().getFullYear();
  res.send(`<!DOCTYPE html><html><head><title>Staff Payroll</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>Staff Payroll - ${month} ${year}</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><table><tr><th>Staff</th><th>Position</th><th>Salary</th><th>Action</th></tr>
      ${staff.rows.map(s => `<tr><td>${s.full_name}</td><td>${s.position}</td><td>UGX ${Number(s.monthly_salary).toLocaleString()}</td><td><form method="POST" action="/admin/staff/pay/${s.id}" style="display:inline"><input type="hidden" name="month" value="${month}"><input type="hidden" name="year" value="${year}"><button type="submit" class="btn" style="background:#27ae60">Pay Salary</button></form></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/staff/pay/:staffId', requireLogin, requireRole(['admin']), async (req, res) => {
  const { month, year } = req.body;
  const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.staffId]);
  const s = staff.rows[0];
  await pool.query('INSERT INTO salary_payments (staff_id, amount, month, year, paid_by) VALUES ($1, $2, $3, $4, $5)',
    [s.id, s.monthly_salary, month, year, req.session.username]);
  await creditAdmin(s.monthly_salary, 'salary', `Salary paid to ${s.full_name}`);
  await logAction(req.session.username, 'SALARY_PAID', { staff: s.full_name, amount: s.monthly_salary });
  res.redirect('/admin/staff/payroll');
});

// DONORS PORTAL
app.get('/admin/donors', requireLogin, requireRole(['admin']), async (req, res) => {
  const donors = await pool.query('SELECT d.*, COALESCE(SUM(dn.amount),0) as total_donated FROM donors d LEFT JOIN donations dn ON d.id = dn.donor_id GROUP BY d.id ORDER BY total_donated DESC');
  res.send(`<!DOCTYPE html><html><head><title>Donors Portal</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}input{padding:6px;margin:2px}</style>
  </head><body>
    <div class="card"><h1>Donors Portal</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Record New Donation</h3>
      <form method="POST" action="/admin/donors/donate">
        <input name="donor_name" placeholder="Donor Name" required>
        <input name="donor_email" placeholder="Email">
        <input name="donor_phone" placeholder="Phone">
        <input name="amount" type="number" placeholder="Amount" required>
        <input name="purpose" placeholder="Purpose e.g Library, Scholarships">
        <button type="submit" class="btn" style="background:#27ae60">Record Donation</button>
      </form>
    </div>
    <div class="card"><table><tr><th>Donor</th><th>Organization</th><th>Email</th><th>Phone</th><th>Total Donated</th></tr>
      ${donors.rows.map(d => `<tr><td>${d.name}</td><td>${d.organization || '-'}</td><td>${d.email || '-'}</td><td>${d.phone || '-'}</td><td>UGX ${Number(d.total_donated).toLocaleString()}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/donors/donate', requireLogin, requireRole(['admin']), async (req, res) => {
  const { donor_name, donor_email, donor_phone, amount, purpose } = req.body;
  let donor = await pool.query('SELECT id FROM donors WHERE name = $1', [donor_name]);
  let donorId;
  if (donor.rows.length === 0) {
    const result = await pool.query('INSERT INTO donors (name, email, phone) VALUES ($1, $2, $3) RETURNING id', [donor_name, donor_email, donor_phone]);
    donorId = result.rows[0].id;
  } else {
    donorId = donor.rows[0].id;
  }
  await pool.query('INSERT INTO donations (donor_id, amount, purpose, recorded_by) VALUES ($1, $2, $3, $4)',
    [donorId, amount, purpose, req.session.username]);
  await creditAdmin(amount, 'donation', `Donation from ${donor_name}`);
  res.redirect('/admin/donors');
});

// ASSETS MANAGEMENT
app.get('/admin/assets', requireLogin, requireRole(['admin']), async (req, res) => {
  const assets = await pool.query('SELECT * FROM school_assets ORDER BY category, asset_name');
  const total = await pool.query('SELECT SUM(total_value) as total FROM school_assets');
  res.send(`<!DOCTYPE html><html><head><title>School Assets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}input,select{padding:6px;margin:2px}</style>
  </head><body>
    <div class="card"><h1>School Assets</h1><p><strong>Total Value: UGX ${Number(total.rows[0]?.total || 0).toLocaleString()}</strong></p><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Add Asset</h3>
      <form method="POST" action="/admin/assets/add">
        <input name="asset_name" placeholder="Asset Name" required>
        <select name="category"><option>Buildings</option><option>Vehicles</option><option>Furniture</option><option>Equipment</option><option>Books</option><option>Other</option></select>
        <input name="quantity" type="number" value="1" placeholder="Quantity">
        <input name="unit_cost" type="number" placeholder="Unit Cost" required>
        <input name="location" placeholder="Location">
        <button type="submit" class="btn" style="background:#27ae60">Add Asset</button>
      </form>
    </div>
    <div class="card"><table><tr><th>Asset</th><th>Category</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Location</th><th>Condition</th></tr>
      ${assets.rows.map(a => `<tr><td>${a.asset_name}</td><td>${a.category}</td><td>${a.quantity}</td><td>${Number(a.unit_cost).toLocaleString()}</td><td>${Number(a.total_value).toLocaleString()}</td><td>${a.location}</td><td>${a.condition}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/assets/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { asset_name, category, quantity, unit_cost, location } = req.body;
  const total_value = Number(quantity) * Number(unit_cost);
  await pool.query('INSERT INTO school_assets (asset_name, category, quantity, unit_cost, total_value, location, condition, managed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [asset_name, category, quantity, unit_cost, total_value, location, 'Good', req.session.username]);
  res.redirect('/admin/assets');
});

// TASKS MANAGEMENT
app.get('/admin/tasks', requireLogin, requireRole(['admin']), async (req, res) => {
  const users = await pool.query('SELECT username, full_name, role FROM users WHERE role!= \'admin\' ORDER BY role, username');
  const tasks = await pool.query('SELECT * FROM staff_tasks WHERE active = true ORDER BY username');
  res.send(`<!DOCTYPE html><html><head><title>Assign Portal Tasks</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}select{padding:6px;margin:2px}</style>
  </head><body>
    <div class="card"><h1>Assign Portal Tasks</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Assign New Task</h3>
      <form method="POST" action="/admin/tasks/assign">
        <select name="username" required><option value="">Select Staff</option>${users.rows.map(u => `<option value="${u.username}">${u.full_name} (${u.role})</option>`).join('')}</select>
        <select name="task_name" required><option value="marksheets">Marksheets</option><option value="attendance">Attendance</option><option value="library">Library</option><option value="fees">Fees Collection</option></select>
        <button type="submit" class="btn" style="background:#27ae60">Assign Task</button>
      </form>
    </div>
    <div class="card"><h3>Active Tasks</h3><table><tr><th>Staff</th><th>Task</th><th>Assigned By</th><th>Action</th></tr>
      ${tasks.rows.map(t => `<tr><td>${t.username}</td><td>${t.task_name}</td><td>${t.assigned_by}</td><td><form method="POST" action="/admin/tasks/remove/${t.id}" style="display:inline"><button type="submit" class="btn" style="background:#e74c3c">Remove</button></form></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/tasks/assign', requireLogin, requireRole(['admin']), async (req, res) => {
  const { username, task_name } = req.body;
  await pool.query('INSERT INTO staff_tasks (username, task_name, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [username, task_name, req.session.username]);
  res.redirect('/admin/tasks');
});

app.post('/admin/tasks/remove/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE staff_tasks SET active = false WHERE id = $1', [req.params.id]);
  res.redirect('/admin/tasks');
});

// CUSTOM FIELDS
app.get('/admin/fields', requireLogin, requireRole(['admin']), async (req, res) => {
  const fields = await pool.query('SELECT * FROM student_field_definitions ORDER BY field_name');
  res.send(`<!DOCTYPE html><html><head><title>Custom Student Fields</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd}th{background:#34495e;color:white}input,select{padding:6px;margin:2px}</style>
  </head><body>
    <div class="card"><h1>Custom Student Fields</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card">
      <h3>Add Custom Field</h3>
      <form method="POST" action="/admin/fields/add">
        <input name="field_name" placeholder="Field Name e.g Blood Group" required>
        <select name="field_type"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option></select>
        <input name="field_options" placeholder="Options (comma-separated for dropdown)">
        <label><input type="checkbox" name="required"> Required</label>
        <button type="submit" class="btn" style="background:#27ae60">Add Field</button>
      </form>
    </div>
    <div class="card"><table><tr><th>Field Name</th><th>Type</th><th>Options</th><th>Required</th><th>Status</th></tr>
      ${fields.rows.map(f => `<tr><td>${f.field_name}</td><td>${f.field_type}</td><td>${f.field_options? JSON.parse(f.field_options).join(', ') : '-'}</td><td>${f.required? 'Yes' : 'No'}</td><td>${f.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/fields/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { field_name, field_type, field_options, required } = req.body;
  const options = field_options? JSON.stringify(field_options.split(',').map(o => o.trim())) : null;
  await pool.query('INSERT INTO student_field_definitions (field_name, field_type, field_options, required) VALUES ($1, $2, $3, $4)',
    [field_name, field_type, options, required === 'on']);
  res.redirect('/admin/fields');
});

// BRANDING CONSOLE
app.get('/admin/branding', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.username!== 'superadmin') return res.status(403).send('Superadmin only');
  const config = await pool.query('SELECT * FROM branding_config WHERE school_id = 1');
  const c = config.rows[0] || {};
  res.send(`<!DOCTYPE html><html><head><title>Branding Console</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#e74c3c;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h1>🎨 Branding Console</h1>
  <form method="POST" action="/admin/branding/save">
    <input name="brand_name" value="${c.brand_name || ''}" placeholder="School Brand Name">
    <input name="primary_color" type="color" value="${c.primary_color || '#667eea'}">
    <button type="submit">Save Branding</button>
  </form><a href="/admin">← Back to Dashboard</a></div></body></html>`);
});

app.post('/admin/branding/save', requireLogin, requireRole(['admin']), async (req, res) => {
  if (req.session.username!== 'superadmin') return res.status(403).send('Superadmin only');
  const { brand_name, primary_color } = req.body;
  await pool.query('INSERT INTO branding_config (school_id, brand_name, primary_color) VALUES (1, $1, $2) ON CONFLICT (school_id) DO UPDATE SET brand_name = $1, primary_color = $2',
    [brand_name, primary_color]);
  res.redirect('/admin/branding');
});

// ADD USER
app.get('/admin/users/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add User</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Create Staff User</h2>
  <form method="POST" action="/admin/users/add">
    <input name="username" placeholder="Username" required>
    <input name="password" type="password" placeholder="Password" required>
    <input name="full_name" placeholder="Full Name" required>
    <select name="role" required><option value="bursar">Bursar</option><option value="teacher">Teacher</option><option value="librarian">Librarian</option><option value="accountant">Accountant</option></select>
    <select name="department">${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}</select>
    <input name="assigned_class" placeholder="Assigned Class (for teachers)">
    <input name="phone" placeholder="Phone">
    <input name="email" placeholder="Email">
    <button type="submit">Create User</button>
  </form><a href="/admin">Back</a></div></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { username, password, full_name, role, department, assigned_class, phone, email } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (username, password, full_name, role, department, assigned_class, phone, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [username, hash, full_name, role, department, assigned_class, phone, email]);
  res.redirect('/admin/staff');
});

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
// Keep Render awake - pings self every 14 mins
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://ssewasswa-api.onrender.com/health').catch(() => {});
  }, 14 * 60 * 1000);
}
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
});
