const rateLimit = require('express-rate-limit');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ dest: '/tmp/' });

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

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

// CLASS & DEPARTMENT STRUCTURE
const ALL_CLASSES = ['Baby Class', 'Middle Class', 'Top Class', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const NURSERY_CLASSES = ['Baby Class', 'Middle Class', 'Top Class'];
const PRIMARY_CLASSES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const DUTY_TYPES = ['Cook', 'Stores Manager', 'Games Master', 'Matron', 'Patron', 'Security', 'Cleaner', 'Librarian', 'Nurse', 'Driver'];
const DEPARTMENTS = ['Nursery', 'Primary', 'Administration', 'Support Staff'];

async function initDB() {
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
      department VARCHAR(20) DEFAULT 'Primary',
      custom_fields JSONB DEFAULT '{}'
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
      marks INTEGER, term VARCHAR(20), year INTEGER,
      recorded_by VARCHAR(50), recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
      assignment_type VARCHAR(50), -- 'class_teacher', 'subject_teacher', 'duty', 'department_head'
      assignment_value VARCHAR(100), -- 'P2', 'Mathematics', 'Cook', 'Stores'
      class_scope VARCHAR(50), department VARCHAR(50),
      start_date DATE DEFAULT CURRENT_DATE, end_date DATE, active BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS school_assets (
      id SERIAL PRIMARY KEY, asset_name VARCHAR(200) NOT NULL, category VARCHAR(100),
      quantity INTEGER, unit_cost INTEGER, total_value INTEGER,
      location VARCHAR(100), condition VARCHAR(50),
      purchased_date DATE, supplier VARCHAR(100),
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
  console.log('✅ Database ready with Nursery + Primary + Assets');
}

initDB();
loadEmailSettings();

app.get('/health', (req, res) => res.json({ status: 'API is running' }));

// LOGIN
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
    req.session.user = { id: user.id, username: user.username, role: user.role, assigned_class: user.assigned_class };
    await logAction(username, 'LOGIN_SUCCESS', {});
    res.redirect('/admin');
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); });

// DASHBOARD
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
          <div class="stat"><strong>Fees Expected</strong><br>UGX ${Number(t.total_fees).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding</strong><br>UGX ${Number(t.total_outstanding).toLocaleString()}</div>
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
    ${user.assigned_class? `<a href="/admin/class/${user.assigned_class}" class="btn">View ${user.assigned_class}</a> <a href="/admin/marksheets/${user.assigned_class}" class="btn" style="background:#27ae60">📊 Marksheet</a>` : ''}
  </div>
  ${portalButtons? `<div class="card"><h3>Assigned Portals</h3>${portalButtons}</div>` : '<div class="card"><p>No special portals assigned.</p></div>'}
  <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div></body></html>`);
});

// MARKSHEET WITH OFFLINE DOWNLOAD/UPLOAD
app.get('/admin/marksheets/:className', requireLogin, requireTask('marksheets'), async (req, res) => {
  const className = req.params.className;
  const { term = 'Term 1', year = 2026 } = req.query;
  const user = req.session.user;
  if (user.role === 'class_teacher' && user.assigned_class!== className) return res.status(403).send('Access denied');

  const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
  const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND active = true ORDER BY id', [className]);
  const marks = await pool.query(`SELECT student_id, subject_id, marks FROM exam_results WHERE term = $1 AND year = $2 AND student_id IN (SELECT id FROM students WHERE class = $3)`, [term, year, className]);
  const marksMap = {};
  marks.rows.forEach(m => { marksMap[`${m.student_id}-${m.subject_id}`] = m.marks; });
  const isNursery = NURSERY_CLASSES.includes(className);

  res.send(`<!DOCTYPE html><html><head><title>${className} Marksheet</title>
  <style>
    body{font-family:Arial;margin:20px;background:#f4f6f9}
 .header{background:white;padding:20px;border-radius:8px;margin-bottom:20px}
 .controls{background:white;padding:15px;border-radius:8px;margin-bottom:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
 .btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;font-size:14px}
 .btn-green{background:#27ae60}.btn-orange{background:#e67e22}
    table{background:white;border-collapse:collapse;width:100%;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
    th{background:#34495e;color:white;padding:10px;text-align:center;font-size:12px}
    td{padding:6px;border:1px solid #ddd;text-align:center}
 .name-col{text-align:left;font-weight:bold;position:sticky;left:0;background:#f8f9fa;min-width:140px}
    input.mark-input{width:45px;padding:3px;text-align:center;border:1px solid #ddd;border-radius:3px;font-size:13px}
 .total-col{background:#e8f5e8;font-weight:bold}.avg-col{background:#e3f2fd;font-weight:bold}.grade-col{background:#fff3e0;font-weight:bold}
    @media print{.no-print{display:none} body{background:white}}
  </style>
  </head><body>
    <div class="header no-print">
      <h1>${className} Marksheet - ${term} ${year} ${isNursery? '(Nursery)' : ''}</h1>
      <div class="controls">
        <form method="GET" style="display:flex;gap:10px;align-items:center">
          <select name="term" onchange="this.form.submit()">
            <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
            <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
            <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option>
          </select>
          <input type="number" name="year" value="${year}" onchange="this.form.submit()" style="width:70px">
        </form>
        <button onclick="saveAllMarks()" class="btn btn-green">💾 Save All</button>
        <a href="/admin/marksheets/${className}/download-template?term=${term}&year=${year}" class="btn btn-orange">📥 Download Excel Template (Offline)</a>
        <button onclick="document.getElementById('uploadForm').style.display='block'" class="btn" style="background:#9b59b6">📤 Upload Filled Excel</button>
        <button onclick="window.print()" class="btn">🖨️ Print</button>
        <a href="/admin/reports/${className}?term=${term}&year=${year}" class="btn" style="background:#16a085">📋 Reports</a>
      </div>
      <div id="uploadForm" style="display:none;background:#fff3e0;padding:15px;border-radius:8px;margin-top:10px">
        <h4>Upload Completed Marksheet Excel</h4>
        <form method="POST" action="/admin/marksheets/${className}/upload" enctype="multipart/form-data">
          <input type="hidden" name="term" value="${term}"><input type="hidden" name="year" value="${year}">
          <input type="file" name="marksfile" accept=".xlsx" required>
          <button type="submit" class="btn btn-green">Upload & Update Marks</button>
          <button type="button" onclick="this.parentElement.parentElement.style.display='none'" class="btn">Cancel</button>
        </form>
        <p style="font-size:12px;color:#666;margin-top:10px">Download template first, fill marks offline, then upload. System will match student names.</p>
      </div>
    </div>

    <form id="marksForm">
    <input type="hidden" name="term" value="${term}"><input type="hidden" name="year" value="${year}"><input type="hidden" name="class" value="${className}">
    <table>
      <thead><tr>
        <th class="name-col">Student</th>
        ${subjects.rows.map(s => `<th>${s.name}<br><small>/${s.max_marks}</small></th>`).join('')}
        <th class="total-col">Total</th><th class="avg-col">Avg</th><th class="grade-col">Grade</th>
      </tr></thead>
      <tbody>
        ${students.rows.map(stu => {
          let total = 0, count = 0;
          return `<tr>
            <td class="name-col">${stu.name}</td>
            ${subjects.rows.map(sub => {
              const mark = marksMap[`${stu.id}-${sub.id}`] || '';
              if (mark!== '') { total += Number(mark); count++; }
              return `<td><input type="number" class="mark-input" name="marks[${stu.id}][${sub.id}]" value="${mark}" min="0" max="${sub.max_marks}" onchange="calculateRow(this)"></td>`;
            }).join('')}
            <td class="total-col" id="total-${stu.id}">${total}</td>
            <td class="avg-col" id="avg-${stu.id}">${count? (total/count).toFixed(1) : '0'}</td>
            <td class="grade-col" id="grade-${stu.id}">${getGrade(count? total/count : 0, isNursery)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </form>

    <script>
      function getGrade(avg, isNursery) {
        if (isNursery) {
          if (avg >= 80) return 'E.E'; if (avg >= 60) return 'M.E'; if (avg >= 40) return 'A.E'; return 'B.E';
        }
        if (avg >= 80) return 'A'; if (avg >= 70) return 'B'; if (avg >= 60) return 'C'; if (avg >= 50) return 'D'; if (avg >= 40) return 'E'; return 'F';
      }
      function calculateRow(input) {
        const row = input.closest('tr');
        const inputs = row.querySelectorAll('.mark-input');
        let total = 0, count = 0;
        inputs.forEach(inp => { if (inp.value!== '') { total += Number(inp.value); count++; } });
        const studentId = row.querySelector('.mark-input').name.match(/marks\\[(\\d+)\\]/)[1];
        const avg = count? (total / count).toFixed(1) : 0;
        document.getElementById('total-' + studentId).textContent = total;
        document.getElementById('avg-' + studentId).textContent = avg;
        document.getElementById('grade-' + studentId).textContent = getGrade(avg, ${isNursery});
      }
      async function saveAllMarks() {
        const form = document.getElementById('marksForm');
        const formData = new FormData(form);
        const btn = event.target;
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
          const res = await fetch('/admin/marksheets/save', { method: 'POST', body: new URLSearchParams(formData) });
          const result = await res.json();
          alert(result.success? '✅ Saved!' : '❌ Error: ' + result.error);
        } catch (err) { alert('❌ Save failed: ' + err.message); }
        btn.textContent = '💾 Save All'; btn.disabled = false;
      }
    </script>
  </body></html>`);
});

// DOWNLOAD EXCEL TEMPLATE FOR OFFLINE FILLING
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

  // Headers: Student ID, Student Name, Subject1, Subject2,...
  const headers = ['student_id', 'student_name',...subjects.rows.map(s => `${s.name} (/${s.max_marks})`)];
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };

  // Data rows with student ID for matching on upload
  students.rows.forEach(stu => {
    const row = [stu.id, stu.name];
    subjects.rows.forEach(sub => {
      row.push(marksMap[`${stu.id}-${sub.id}`] || '');
    });
    sheet.addRow(row);
  });

  // Freeze header and name columns
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
  sheet.columns.forEach(col => { col.width = 15; });
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 25;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${className}_${term}_${year}_Marksheet_Template.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// UPLOAD FILLED EXCEL MARKSHEET
app.post('/admin/marksheets/:className/upload', requireLogin, requireTask('marksheets'), upload.single('marksfile'), async (req, res) => {
  try {
    const { className } = req.params;
    const { term, year } = req.body;
    if (!req.file) return res.status(400).send('No file uploaded');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];

    const headerRow = sheet.getRow(1).values.slice(1); // skip empty first element
    const subjectHeaders = headerRow.slice(2); // skip student_id, student_name

    const subjects = await pool.query('SELECT id, name FROM subjects WHERE class = $1 AND active = true ORDER BY id', [className]);
    const subjectMap = {};
    subjects.rows.forEach(s => { subjectMap[s.name] = s.id; });

    let updatedCount = 0;
    const recorded_by = req.session.user.username;

    for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
      const row = sheet.getRow(rowNum);
      const studentId = row.getCell(1).value;
      if (!studentId) continue;

      // Delete existing marks for this student/term/year
      await pool.query('DELETE FROM exam_results WHERE student_id = $1 AND term = $2 AND year = $3', [studentId, term, year]);

      // Insert new marks from each subject column
      for (let colIdx = 3; colIdx <= headerRow.length; colIdx++) {
        const mark = row.getCell(colIdx).value;
        if (mark!== null && mark!== '' &&!isNaN(mark)) {
          const subjectName = headerRow[colIdx - 1].split(' (')[0];
          const subjectId = subjectMap[subjectName];
          if (subjectId) {
            await pool.query('INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)',
              [studentId, subjectId, mark, term, year, recorded_by]);
            updatedCount++;
          }
        }
      }
    }

    await logAction(recorded_by, 'MARKS_UPLOADED', { class: className, term, year, marks_updated: updatedCount });
    res.send(`✅ Successfully uploaded and updated ${updatedCount} marks for ${className} ${term} ${year}. <a href            await pool.query('INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)',
              [studentId, subjectId, mark, term, year, recorded_by]);
            updatedCount++;
          }
        }
      }
    }

    await logAction(recorded_by, 'MARKS_UPLOADED', { class: className, term, year, marks_updated: updatedCount });
    res.send(`✅ Successfully uploaded and updated ${updatedCount} marks for ${className} ${term} ${year}. <a href="/admin/marksheets/${className}?term=${term}&year=${year}">Back to Marksheet</a>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload failed: ' + err.message);
  }
});

// SAVE MARKS FROM ONLINE SPREADSHEET
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
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// REPORT CARDS
app.get('/admin/reports/:className', requireLogin, requireTask('marksheets'), async (req, res) => {
  const { className } = req.params;
  const { term = 'Term 1', year = 2026 } = req.query;
  const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
  const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND active = true ORDER BY id', [className]);
  const isNursery = NURSERY_CLASSES.includes(className);

  let reportsHTML = '';
  for (const stu of students.rows) {
    const marks = await pool.query(`
      SELECT s.name, er.marks, s.max_marks FROM exam_results er
      JOIN subjects s ON er.subject_id = s.id
      WHERE er.student_id = $1 AND er.term = $2 AND er.year = $3
    `, [stu.id, term, year]);

    let total = 0, count = 0;
    const marksRows = marks.rows.map(m => {
      total += Number(m.marks);
      count++;
      const pct = ((m.marks / m.max_marks) * 100).toFixed(1);
      return `<tr><td>${m.name}</td><td>${m.marks}/${m.max_marks}</td><td>${pct}%</td></tr>`;
    }).join('');

    const avg = count? (total / count).toFixed(1) : 0;
    const grade = isNursery? (avg >= 80? 'E.E' : avg >= 60? 'M.E' : avg >= 40? 'A.E' : 'B.E') : (avg >= 80? 'A' : avg >= 70? 'B' : avg >= 60? 'C' : avg >= 50? 'D' : avg >= 40? 'E' : 'F');

    reportsHTML += `
    <div class="report-page" style="page-break-after:always;padding:40px;font-family:Arial">
      <div style="text-align:center;border-bottom:3px solid #34495e;padding-bottom:20px;margin-bottom:30px">
        <h1>SSEWASSWA PRIMARY SCHOOL</h1>
        <h2>STUDENT REPORT CARD - ${isNursery? 'NURSERY' : 'PRIMARY'} SECTION</h2>
        <h3>${term} ${year}</h3>
      </div>
      <table style="width:100%;margin-bottom:20px">
        <tr><td><strong>Name:</strong> ${stu.name}</td><td><strong>Class:</strong> ${stu.class}</td></tr>
        <tr><td><strong>Term:</strong> ${term}</td><td><strong>Year:</strong> ${year}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <tr style="background:#34495e;color:white"><th style="padding:10px;border:1px solid #ddd">Subject</th><th style="padding:10px;border:1px solid #ddd">Marks</th><th style="padding:10px;border:1px solid #ddd">Percentage</th></tr>
        ${marksRows}
      </table>
      <div style="background:#f4f6f9;padding:20px;border-radius:8px;margin:20px 0">
        <p><strong>Total Marks:</strong> ${total} / ${count * 100}</p>
        <p><strong>Average:</strong> ${avg}%</p>
        <p><strong>Grade:</strong> ${grade} ${isNursery? '<br><small>E.E=Exceeds Expectation, M.E=Meets Expectation, A.E=Approaching Expectation, B.E=Below Expectation</small>' : ''}</p>
        <p><strong>Position:</strong> ___ out of ${students.rows.length}</p>
      </div>
      <div style="margin-top:40px">
        <p><strong>Class Teacher's Comment:</strong> _____________________________________</p><br>
        <p><strong>Head Teacher's Comment:</strong> _____________________________________</p><br>
        <p><strong>Signature:</strong> _________________ <strong>Date:</strong> _________________</p>
      </div>
    </div>`;
  }

  res.send(`<!DOCTYPE html><html><head><title>Report Cards - ${className}</title>
  <style>@media print{.no-print{display:none}} body{margin:0}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;margin:10px}</style>
  </head><body>
    <div class="no-print" style="padding:20px;background:#f4f6f9">
      <h2>${className} Report Cards - ${term} ${year}</h2>
      <button onclick="window.print()" class="btn">🖨️ Print All Reports</button>
      <a href="/admin/marksheets/${className}" class="btn">← Back to Marksheet</a>
    </div>
    ${reportsHTML}
  </body></html>`);
});

// STAFF MANAGEMENT
app.get('/admin/staff', requireLogin, requireTask('staff_management'), async (req, res) => {
  const staff = await pool.query(`SELECT s.*, a.username, a.role FROM staff s LEFT JOIN admins a ON s.username = a.username ORDER BY s.department, s.full_name`);
  const assignments = await pool.query(`SELECT sa.*, s.full_name FROM staff_assignments sa JOIN staff s ON sa.staff_id = s.id WHERE sa.active = true ORDER BY s.full_name`);

  res.send(`<!DOCTYPE html><html><head><title>Staff Management</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.badge{background:#3498db;color:white;padding:3px 8px;border-radius:12px;font-size:11px;margin:2px;display:inline-block}</style>
  </head><body>
    <div class="card"><h1>👥 Staff Management</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/staff/add" class="btn btn-green">+ Add Staff</a> <a href="/admin/assignments" class="btn">📋 Assignments</a> <a href="/admin/staff/payroll" class="btn">💰 Payroll</a></div>
    <div class="card"><h3>All Staff Members</h3>
      <table><tr><th>Name</th><th>Position</th><th>Department</th><th>Salary</th><th>Contact</th><th>Assignments</th><th>Actions</th></tr>
      ${staff.rows.map(s => {
        const staffAssigns = assignments.rows.filter(a => a.staff_id === s.id);
        return `<tr>
          <td><strong>${s.full_name}</strong><br><small>${s.username}</small></td>
          <td>${s.position}</td>
          <td>${s.department}</td>
          <td>UGX ${Number(s.monthly_salary).toLocaleString()}</td>
          <td>${s.phone}<br>${s.email}</td>
          <td>${staffAssigns.map(a => `<span class="badge">${a.assignment_type}: ${a.assignment_value}</span>`).join('')}</td>
          <td><a href="/admin/staff/${s.id}" class="btn" style="padding:5px 10px;font-size:12px">View</a></td>
        </tr>`;
      }).join('')}
      </table>
    </div>
  </body></html>`);
});

// ADD STAFF - PROFESSIONAL FORM WITH ALL ASSIGNMENTS
app.get('/admin/staff/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const subjects = await pool.query('SELECT DISTINCT name FROM subjects WHERE active = true ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Add Staff</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}.section{border:1px solid #ddd;padding:15px;border-radius:8px;margin:15px 0}.checkbox-group{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.checkbox-group label{display:flex;align-items:center;gap:5px;font-size:14px}</style>
  </head><body><div class="card"><h2>Add New Staff Member</h2>
  <form method="POST" action="/admin/staff/add">
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
      <input name="position" placeholder="Position e.g Senior Teacher, Cook, Store Keeper" required>
      <input name="monthly_salary" type="number" placeholder="Monthly Salary UGX" required>
      <input name="bank_account" placeholder="Bank Account Number">
      <input name="hire_date" type="date" placeholder="Hire Date">
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

    <div class="section"><h3>Subject Teaching Assignment</h3>
      <p style="font-size:13px;color:#666">Select subjects this teacher handles:</p>
      <div class="checkbox-group">
        ${subjects.rows.map(s => `<label><input type="checkbox" name="subjects" value="${s.name}"> ${s.name}</label>`).join('')}
      </div>
      <select name="subject_class_scope">
        <option value="">All Classes</option>
        ${ALL_CLASSES.map(c => `<option value="${c}">${c} Only</option>`).join('')}
      </select>
    </div>

    <div class="section"><h3>Duty Assignment - Non-Teaching</h3>
      <p style="font-size:13px;color:#666">Select duties for support staff:</p>
      <div class="checkbox-group">
        ${DUTY_TYPES.map(d => `<label><input type="checkbox" name="duties" value="${d}"> ${d}</label>`).join('')}
      </div>
    </div>

    <button type="submit">Create Staff Member</button>
  </form><a href="/admin/staff">Back</a></div></body></html>`);
});

app.post('/admin/staff/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, phone, email, department, position, monthly_salary, bank_account, hire_date, role, assigned_class, subjects, subject_class_scope, duties } = req.body;
    const hash = await bcrypt.hash(password, 10);

    // Create admin account
    await pool.query('INSERT INTO admins (username, password, role, full_name, assigned_class, phone, email, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [username, hash, role, full_name, assigned_class || null, phone, email, department]);

    // Create staff record
    const staffRes = await pool.query('INSERT INTO staff (username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account]);

    const staffId = staffRes.rows[0].id;

    // Add class teacher assignment
    if (assigned_class) {
      await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
        [username, 'class_teacher', assigned_class, department]);
    }

    // Add subject assignments
    if (subjects) {
      const subjectArray = Array.isArray(subjects)? subjects : [subjects];
      for (const subj of subjectArray) {
        await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, class_scope, department) VALUES ($1, $2, $3, $4, $5)',
          [username, 'subject_teacher', subj, subject_class_scope || null, department]);
      }
    }

    // Add duty assignments
    if (duties) {
      const dutyArray = Array.isArray(duties)? duties : [duties];
      for (const duty of dutyArray) {
        await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
          [username, 'duty', duty, department]);
      }
    }

    await logAction(req.session.user.username, 'STAFF_CREATED', { username, full_name, position, department });
    res.send(`Staff ${full_name} created successfully. <a href="/admin/staff">View All Staff</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// STAFF ASSIGNMENTS MANAGEMENT
app.get('/admin/assignments', requireLogin, requireRole(['admin']), async (req, res) => {
  const assignments = await pool.query(`
    SELECT sa.*, s.full_name, s.position, s.department
    FROM staff_assignments sa
    JOIN staff s ON sa.username = s.username
    WHERE sa.active = true
    ORDER BY s.department, s.full_name, sa.assignment_type
  `);

  const grouped = {};
  assignments.rows.forEach(a => {
    if (!grouped[a.full_name]) grouped[a.full_name] = { position: a.position, department: a.department, items: [] };
    grouped[a.full_name].items.push(a);
  });

  res.send(`<!DOCTYPE html><html><head><title>Staff Assignments</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.staff-block{border:1px solid #ddd;padding:15px;margin:10px 0;border-radius:8px}.badge{background:#3498db;color:white;padding:4px 10px;border-radius:12px;font-size:12px;margin:3px;display:inline-block}.badge-class{background:#27ae60}.badge-subject{background:#e67e22}.badge-duty{background:#9b59b6}</style>
  </head><body>
    <div class="card"><h1>📋 Staff Assignments</h1><a href="/admin/staff" class="btn">← Staff List</a> <a href="/admin/assignments/add" class="btn" style="background:#27ae60">+ New Assignment</a></div>
    <div class="card">
      ${Object.keys(grouped).map(name => `
        <div class="staff-block">
          <h3>${name} - ${grouped[name].position} (${grouped[name].department})</h3>
          <div>
            ${grouped[name].items.map(a => {
              const badgeClass = a.assignment_type === 'class_teacher'? 'badge-class' : a.assignment_type === 'subject_teacher'? 'badge-subject' : 'badge-duty';
              return `<span class="badge ${badgeClass}">${a.assignment_type}: ${a.assignment_value} ${a.class_scope? '('+a.class_scope+')' : ''}</span>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  </body></html>`);
});

// SCHOOL ASSETS / STORES
app.get('/admin/assets', requireLogin, requireTask('assets'), async (req, res) => {
  const assets = await pool.query('SELECT * FROM school_assets ORDER BY category, asset_name');
  const categories = [...new Set(assets.rows.map(a => a.category))];

  res.send(`<!DOCTYPE html><html><head><title>School Assets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.category-header{background:#ecf0f1;font-weight:bold;padding:10px}</style>
  </head><body>
    <div class="card"><h1>📦 School Assets & Stores</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/assets/add" class="btn btn-green">+ Add Asset</a></div>
    <div class="card">
      ${categories.map(cat => `
        <div class="category-header">${cat}</div>
        <table style="margin-bottom:20px">
          <tr><th>Asset Name</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Location</th><th>Condition</th><th>Managed By</th></tr>
          ${assets.rows.filter(a => a.category === cat).map(a => `
            <tr>
              <td>${a.asset_name}</td>
              <td>${a.quantity}</td>
              <td>UGX ${Number(a.unit_cost).toLocaleString()}</td>
              <td>UGX ${Number(a.total_value).toLocaleString()}</td>
              <td>${a.location}</td>
              <td>${a.condition}</td>
              <td>${a.managed_by || '-'}</td>
            </tr>
          `).join('')}
        </table>
      `).join('')}
    </div>
  </body></html>`);
});

app.get('/admin/assets/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT username, full_name FROM staff WHERE active = true ORDER BY full_name');
  res.send(`<!DOCTYPE html><html><head><title>Add Asset</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add School Asset</h2>
  <form method="POST" action="/admin/assets/add">
    <input name="asset_name" placeholder="Asset Name e.g 50 Desks" required>
    <select name="category" required>
      <option value="">Select Category</option>
      <option value="Furniture">Furniture</option>
      <option value="Electronics">Electronics</option>
      <option value="Stationery">Stationery</option>
      <option value="Sports Equipment">Sports Equipment</option>
      <option value="Laboratory">Laboratory</option>
      <option value="Kitchen">Kitchen</option>
      <option value="Vehicles">Vehicles</option>
      <option value="Other">Other</option>
    </select>
    <input name="quantity" type="number" placeholder="Quantity" required>
    <input name="unit_cost" type="number" placeholder="Unit Cost UGX" required>
    <input name="location" placeholder="Location e.g Store Room, P2 Classroom">
    <select name="condition">
      <option value="Good">Good</option>
      <option value="Needs Repair">Needs Repair</option>
      <option value="Damaged">Damaged</option>
    </select>
    <input name="purchased_date" type="date" placeholder="Purchase Date">
    <input name="supplier" placeholder="Supplier Name">
    <select name="managed_by">
      <option value="">Select Staff In Charge</option>
      ${staff.rows.map(s => `<option value="${s.username}">${s.full_name}</option>`).join('')}
    </select>
    <button type="submit">Save Asset</button>
  </form><a href="/admin/assets">Back</a></div></body></html>`);
});

app.post('/admin/assets/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { asset_name, category, quantity, unit_cost, location, condition, purchased_date, supplier, managed_by } = req.body;
    const total_value = Number(quantity) * Number(unit_cost);
    await pool.query('INSERT INTO school_assets (asset_name, category, quantity, unit_cost, total_value, location, condition, purchased_date, supplier, managed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [asset_name, category, quantity, unit_cost, total_value, location, condition, purchased_date, supplier, managed_by]);
    await logAction(req.session.user.username, 'ASSET_ADDED', { asset_name, category, total_value });
    res.redirect('/admin/assets');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// SUBJECTS MANAGEMENT
app.get('/admin/subjects', requireLogin, requireRole(['admin']), async (req, res) => {
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY department, class, name');
  res.send(`<!DOCTYPE html><html><head><title>Manage Subjects</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>📚 Manage Subjects</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/subjects/add" class="btn btn-green">+ Add Subject</a></div>
    <div class="card">
      <table><tr><th>Subject</th><th>Class</th><th>Department</th><th>Max Marks</th><th>Status</th></tr>
      ${subjects.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.department}</td><td>${s.max_marks}</td><td>${s.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/subjects/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Subject</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add New Subject</h2>
  <form method="POST" action="/admin/subjects/add">
    <input name="name" placeholder="Subject Name e.g Computer Studies" required>
    <select name="class" required>
      <option value="">Select Class</option>
      ${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <select name="department" required>
      <option value="Primary">Primary</option>
      <option value="Nursery">Nursery</option>
    </select>
    <input name="max_marks" type="number" value="100" placeholder="Max Marks" required>
    <button type="submit">Add Subject</button>
  </form><a href="/admin/subjects">Back</a></div></body></html>`);
});

app.post('/admin/subjects/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { name, class: className, department, max_marks } = req.body;
    await pool.query('INSERT INTO subjects (name, class, department, max_marks) VALUES ($1, $2, $3, $4)', [name, className, department, max_marks]);
    res.redirect('/admin/subjects');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// DYNAMIC STUDENT FIELDS
app.get('/admin/fields', requireLogin, requireRole(['admin']), async (req, res) => {
  const fields = await pool.query('SELECT * FROM student_field_definitions ORDER BY field_name');
  res.send(`<!DOCTYPE html><html><head><title>Custom Student Fields</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>⚙️ Custom Student Fields</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/fields/add" class="btn btn-green">+ Add Field</a></div>
    <div class="card"><p>Admin can add custom fields to student records like 'Blood Group', 'Allergies', 'Bus Route', etc. These appear on student add/edit forms.</p>
      <table><tr><th>Field Name</th><th>Type</th><th>Required</th><th>Status</th></tr>
      ${fields.rows.map(f => `<tr><td>${f.field_name}</td><td>${f.field_type}</td><td>${f.required? 'Yes' : 'No'}</td><td>${f.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/fields/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Field</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button,textarea{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Custom Student Field</h2>
  <form method="POST" action="/admin/fields/add">
    <input name="field_name" placeholder="Field Name e.g Blood Group" required>
    <select name="field_type" required>
      <option value="text">Text</option>
      <option value="number">Number</option>
      <option value="date">Date</option>
      <option value="select">Dropdown Select</option>
    </select>
    <textarea name="field_options" placeholder="For Dropdown: Enter options separated by comma e.g A,B,AB,O"></textarea>
    <label><input type="checkbox" name="required" value="true"> Required Field</label>
    <button type="submit">Add Field</button>
  </form><a href="/admin/fields">Back</a></div></body></html>`);
});

app.post('/admin/fields/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { field_name, field_type, field_options, required } = req.body;
    const options = field_options? JSON.stringify(field_options.split(',').map(o => o.trim())) : null;
    await pool.query('INSERT INTO student_field_definitions (field_name, field_type, field_options, required) VALUES ($1, $2, $3, $4)',
      [field_name, field_type, options, required === 'true']);
    res.redirect('/admin/fields');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// STAFF PAYROLL
app.get('/admin/staff/payroll', requireLogin, requireTask('staff_management'), async (req, res) => {
  const { month = new Date().toLocaleString('default', { month: 'long' }), year = new Date().getFullYear() } = req.query;
  const staff = await pool.query('SELECT * FROM staff WHERE active = true ORDER BY full_name');
  const payments = await pool.query('SELECT staff_id FROM salary_payments WHERE month = $1 AND year = $2', [month, year]);
  const paidIds = payments.rows.map(p => p.staff_id);

  res.send(`<!DOCTYPE html><html><head><title>Staff Payroll</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}.paid{background:#d4edda}.unpaid{background:#f8d7da}</style>
  </head><body>
    <div class="card"><h1>💰 Staff Payroll - ${month} ${year}</h1><a href="/admin/staff" class="btn">← Staff List</a>
      <form method="GET" style="display:inline-block;margin-left:20px">
        <select name="month">${['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => `<option value="${m}" ${m===month?'selected':''}>${m}</option>`).join('')}</select>
        <input type="number" name="year" value="${year}" style="width:80px">
        <button type="submit" class="btn">Load</button>
      </form>
    </div>
    <div class="card">
      <table><tr><th>Staff Name</th><th>Position</th><th>Department</th><th>Salary</th><th>Status</th><th>Action</th></tr>
      ${staff.rows.map(s => `
        <tr class="${paidIds.includes(s.id)? 'paid' : 'unpaid'}">
          <td>${s.full_name}</td>
          <td>${s.position}</td>
          <td>${s.department}</td>
          <td>UGX ${Number          <td>UGX ${Number(s.monthly_salary).toLocaleString()}</td>
          <td>${paidIds.includes(s.id)? '✅ Paid' : '❌ Pending'}</td>
          <td>
            ${paidIds.includes(s.id)?
              '<span style="color:green">Paid</span>' :
              `<a href="/admin/staff/pay/${s.id}?month=${month}&year=${year}" class="btn btn-green" style="padding:5px 10px;font-size:12px">Pay Now</a>`
            }
          </td>
        </tr>
      `).join('')}
      </table>
    </div>
  </body></html>`);
});

// PAY STAFF SALARY
app.get('/admin/staff/pay/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { month, year } = req.query;
  const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
  if (staff.rows.length === 0) return res.status(404).send('Staff not found');
  const s = staff.rows[0];

  res.send(`<!DOCTYPE html><html><head><title>Pay Salary</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Pay Salary - ${s.full_name}</h2>
  <p><strong>Position:</strong> ${s.position}</p>
  <p><strong>Month:</strong> ${month} ${year}</p>
  <p><strong>Amount:</strong> UGX ${Number(s.monthly_salary).toLocaleString()}</p>
  <form method="POST" action="/admin/staff/pay/${id}">
    <input type="hidden" name="month" value="${month}">
    <input type="hidden" name="year" value="${year}">
    <input type="hidden" name="amount" value="${s.monthly_salary}">
    <select name="method" required>
      <option value="Bank Transfer">Bank Transfer</option>
      <option value="Cash">Cash</option>
      <option value="Mobile Money">Mobile Money</option>
      <option value="Cheque">Cheque</option>
    </select>
    <input name="reference" placeholder="Transaction Reference / Cheque No">
    <button type="submit">Confirm Payment</button>
  </form><a href="/admin/staff/payroll">Cancel</a></div></body></html>`);
});

app.post('/admin/staff/pay/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year, amount, method, reference } = req.body;
    await pool.query('INSERT INTO salary_payments (staff_id, amount, month, year, method, reference, paid_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, amount, month, year, method, reference, req.session.user.username]);
    await logAction(req.session.user.username, 'SALARY_PAID', { staff_id: id, amount, month, year });
    res.redirect(`/admin/staff/payroll?month=${month}&year=${year}`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// FINANCIAL PORTAL
app.get('/admin/financial', requireLogin, requireTask('financial_portal'), async (req, res) => {
  const classes = await pool.query(`SELECT class, COUNT(*) as count, SUM(total_fees) as fees, SUM(balance) as balance FROM students GROUP BY class ORDER BY class`);
  const assetValue = await pool.query('SELECT SUM(total_value) as total FROM school_assets');
  const payroll = await pool.query('SELECT SUM(monthly_salary) as total FROM staff WHERE active = true');

  res.send(`<!DOCTYPE html><html><head><title>Financial Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:20px 0}.stat{background:#ecf0f1;padding:15px;border-radius:4px;text-align:center}</style>
  </head><body><h1>💰 Financial Portal</h1><a href="/admin" class="btn">← Dashboard</a><br><br>
  <div class="stats">
    <div class="stat"><strong>Total Assets Value</strong><br>UGX ${Number(assetValue.rows[0].total || 0).toLocaleString()}</div>
    <div class="stat"><strong>Monthly Payroll</strong><br>UGX ${Number(payroll.rows[0].total || 0).toLocaleString()}</div>
    <div class="stat"><strong>Fees Outstanding</strong><br>UGX ${Number(classes.rows.reduce((sum,c) => sum + Number(c.balance), 0)).toLocaleString()}</div>
  </div>
  <table><tr><th>Class</th><th>Students</th><th>Total Fees</th><th>Outstanding</th><th>Collected</th><th>Actions</th></tr>
  ${classes.rows.map(c => `<tr><td>${c.class}</td><td>${c.count}</td><td>UGX ${Number(c.fees).toLocaleString()}</td><td>UGX ${Number(c.balance).toLocaleString()}</td><td>UGX ${(Number(c.fees)-Number(c.balance)).toLocaleString()}</td><td><a href="/admin/class/${c.class}/export" class="btn">Export Excel</a></td></tr>`).join('')}
  </table>
  <br><a href="/admin/assets" class="btn" style="background:#8e44ad">📦 View All Assets</a>
  <a href="/admin/staff/payroll" class="btn" style="background:#16a085">💰 Staff Payroll</a>
  </body></html>`);
});

// ACADEMIC PORTAL
app.get('/admin/academic', requireLogin, requireTask('academic_portal'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Academic Portal</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.btn{background:#9b59b6;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px}</style>
  </head><body><h1>📚 Academic Portal</h1><a href="/admin">← Dashboard</a><br><br>
  <a href="/admin/marksheets" class="btn">📊 Marksheets</a>
  <a href="/admin/subjects" class="btn">📝 Manage Subjects</a>
  <a href="/admin/online-classes" class="btn">💻 Online Classes</a>
  </body></html>`);
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

// EXAMS PORTAL
app.get('/admin/exams', requireLogin, requireTask('exams'), async (req, res) => {
  const results = await pool.query(`SELECT e.*, s.name, s.class, sub.name as subject_name FROM exam_results e JOIN students s ON e.student_id = s.id JOIN subjects sub ON e.subject_id = sub.id ORDER BY e.recorded_at DESC LIMIT 50`);
  res.send(`<!DOCTYPE html><html><head><title>Exams Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}.btn{background:#9b59b6;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>📝 Recent Exam Entries</h1><a href="/admin/academic" class="btn">← Academic</a> <a href="/admin/exams/add" class="btn">+ Record Single Mark</a> <a href="/admin/marksheets" class="btn">📊 Use Marksheet Instead</a><br><br>
  <table><tr><th>Student</th><th>Class</th><th>Subject</th><th>Marks</th><th>Term</th><th>Year</th><th>Recorded By</th></tr>
  ${results.rows.map(r => `<tr><td>${r.name}</td><td>${r.class}</td><td>${r.subject_name}</td><td>${r.marks}</td><td>${r.term}</td><td>${r.year}</td><td>${r.recorded_by}</td></tr>`).join('')}
  </table></body></html>`);
});

app.get('/admin/exams/add', requireLogin, requireTask('exams'), async (req, res) => {
  const students = await pool.query('SELECT id, name, class FROM students ORDER BY class, name');
  const subjects = await pool.query('SELECT id, name, class FROM subjects WHERE active = true ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Record Exam</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Record Single Exam Result</h2><form method="POST" action="/admin/exams/add">
    <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class}</option>`).join('')}</select>
    <select name="subject_id" required><option value="">Select Subject</option>${subjects.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class}</option>`).join('')}</select>
    <input name="marks" type="number" placeholder="Marks" required>
    <input name="term" placeholder="Term e.g Term 1" required>
    <input name="year" type="number" placeholder="Year" value="2026" required>
    <button type="submit">Save Result</button>
  </form><a href="/admin/exams">Back</a></body></html>`);
});

app.post('/admin/exams/add', requireLogin, requireTask('exams'), async (req, res) => {
  const { student_id, subject_id, marks, term, year } = req.body;
  await pool.query('INSERT INTO exam_results (student_id, subject_id, marks, term, year, recorded_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (student_id, subject_id, term, year) DO UPDATE SET marks = $3, recorded_by = $6',
    [student_id, subject_id, marks, term, year, req.session.user.username]);
  res.redirect('/admin/exams');
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

// DONORS PORTAL
app.get('/admin/donors', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const donors = await pool.query(`SELECT d.*, COUNT(ds.id) as sponsored_students, COALESCE(SUM(don.amount), 0) as total_donated
    FROM donors d
    LEFT JOIN donor_students ds ON d.id = ds.donor_id
    LEFT JOIN donations don ON d.id = don.donor_id
    GROUP BY d.id ORDER BY d.name`);
  res.send(`<!DOCTYPE html><html><head><title>Donors Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#e67e22;color:white}.btn{background:#e67e22;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>🤝 Donors Portal</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/donors/add" class="btn">+ Add Donor</a> <a href="/admin/donations/add" class="btn">+ Record Donation</a><br><br>
  <table><tr><th>Donor</th><th>Organization</th><th>Contact</th><th>Students Sponsored</th><th>Total Donated</th></tr>
  ${donors.rows.map(d => `<tr><td>${d.name}</td><td>${d.organization || '-'}</td><td>${d.phone || d.email || '-'}</td><td>${d.sponsored_students}</td><td>UGX ${Number(d.total_donated).toLocaleString()}</td></tr>`).join('')}
  </table></body></html>`);
});

app.get('/admin/donors/add', requireLogin, requireTask('donors_portal'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Donor</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,textarea,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Add Donor</h2><form method="POST" action="/admin/donors/add">
    <input name="name" placeholder="Donor Name" required>
    <input name="email" type="email" placeholder="Email">
    <input name="phone" placeholder="Phone">
    <input name="organization" placeholder="Organization">
    <textarea name="address" placeholder="Address"></textarea>
    <button type="submit">Save Donor</button>
  </form><a href="/admin/donors">Back</a></body></html>`);
});

app.post('/admin/donors/add', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const { name, email, phone, organization, address } = req.body;
  await pool.query('INSERT INTO donors (name, email, phone, organization, address) VALUES ($1, $2, $3, $4, $5)', [name, email, phone, organization, address]);
  await logAction(req.session.user.username, 'DONOR_ADDED', { name, organization });
  res.redirect('/admin/donors');
});

app.get('/admin/donations/add', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const donors = await pool.query('SELECT id, name, organization FROM donors ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Record Donation</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Record Donation</h2><form method="POST" action="/admin/donations/add">
    <select name="donor_id" required><option value="">Select Donor</option>${donors.rows.map(d => `<option value="${d.id}">${d.name} ${d.organization? `(${d.organization})` : ''}</option>`).join('')}</select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="purpose" placeholder="Purpose e.g School Fees, Construction" required>
    <input name="method" placeholder="Payment Method e.g Bank Transfer" required>
    <input name="reference" placeholder="Reference/TxID">
    <button type="submit">Save Donation</button>
  </form><a href="/admin/donors">Back</a></body></html>`);
});

app.post('/admin/donations/add', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const { donor_id, amount, purpose, method, reference } = req.body;
  await pool.query('INSERT INTO donations (donor_id, amount, purpose, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)', [donor_id, amount, purpose, method, reference, req.session.user.username]);
  await logAction(req.session.user.username, 'DONATION_RECORDED', { donor_id, amount, purpose });
  res.redirect('/admin/donors');
});

// CLASS VIEW
app.get('/admin/class/:className', requireLogin, async (req, res) => {
  const className = req.params.className;
  const user = req.session.user;
  if (user.role === 'class_teacher' && user.assigned_class!== className) return res.status(403).send('Access denied');
  try {
    const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [className]);
    const totalStudents = students.rows.length;
    const totalBalance = students.rows.reduce((sum, s) => sum + Number(s.balance), 0);
    const totalFees = students.rows.reduce((sum, s) => sum + Number(s.total_fees), 0);
    res.send(`<!DOCTYPE html><html><head><title>${className} - Class View</title>
    <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.header{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin:20px 0}.stat-card{background:#3498db;color:white;padding:20px;border-radius:8px}.stat-card h3{margin:0 0 10px 0;font-size:14px;opacity:0.9}.stat-card.num{font-size:28px;font-weight:bold}.controls{background:white;padding:15px;border-radius:8px;margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap}.controls input{flex:1;padding:10px;border:1px solid #ddd;border-radius:4px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}.btn-green{background:#27ae60}table{width:100%;background:white;border-collapse:collapse;border-radius:8px;overflow:hidden}th{background:#34495e;color:white;padding:12px;text-align:left}td{padding:12px;border-bottom:1px solid #eee}.balance-zero{color:#27ae60;font-weight:bold}.balance-owe{color:#e74c3c;font-weight:bold}@media print{.no-print{display:none}}</style>
    </head><body>
      <div class="header no-print"><h1>${className} - Class Management</h1><p>Teacher: ${user.username}</p>
        <a href="/admin" class="btn">← Dashboard</a>
        <button onclick="window.print()" class="btn btn-green">🖨️ Print</button>
        <a href="/admin/class/${className}/export" class="btn btn-green">📊 Export Excel</a>
        <a href="/admin/marksheets/${className}" class="btn" style="background:#9b59b6">📊 Marksheet</a>
      </div>
      <div class="stats"><div class="stat-card"><h3>Total Students</h3><div class="num">${totalStudents}</div></div><div class="stat-card" style="background:#e67e22"><h3>Total Fees</h3><div class="num">UGX ${totalFees.toLocaleString()}</div></div><div class="stat-card" style="background:#e74c3c"><h3>Outstanding</h3><div class="num">UGX ${totalBalance.toLocaleString()}</div></div><div class="stat-card" style="background:#27ae60"><h3>Collected</h3><div class="num">UGX ${(totalFees-totalBalance).toLocaleString()}</div></div></div>
      <div class="controls no-print"><input type="text" id="searchBox" placeholder="🔍 Search student name..." onkeyup="filterTable()"></div>
      <table id="studentsTable"><thead><tr><th>Name</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th><th class="no-print">Actions</th></tr></thead><tbody>
        ${students.rows.map(s => `<tr><td><strong>${s.name}</strong></td><td>${s.term}</td><td>${s.year}</td><td>UGX ${Number(s.total_fees).toLocaleString()}</td><td class="${s.balance == 0? 'balance-zero' : 'balance-owe'}">UGX ${Number(s.balance).toLocaleString()}</td><td class="no-print"><a href="/admin/payments/add?student_id=${s.id}" class="btn" style="padding:6px 12px;font-size:12px">+ Payment</a> <a href="/admin/students/${s.id}" class="btn" style="padding:6px 12px;font-size:12px;background:#95a5a6">View</a></td></tr>`).join('')}
      </tbody></table>
      <script>function filterTable(){const i=document.getElementById('searchBox'),f=i.value.toLowerCase(),t=document.getElementById('studentsTable'),r=t.getElementsByTagName('tr');for(let j=1;j<r.length;j++){const d=r[j].getElementsByTagName('td')[0];if(d){const v=d.textContent||d.innerText;r[j].style.display=v.toLowerCase().indexOf(f)>-1?'':'none';}}}</script>
    </body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// EXCEL EXPORT
app.get('/admin/class/:className/export', requireLogin, async (req, res) => {
  const className = req.params.className;
  const students = await pool.query('SELECT name, term, year, total_fees, balance FROM students WHERE class = $1 ORDER BY name', [className]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(className);
  sheet.columns = [
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Term', key: 'term', width: 15 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Total Fees', key: 'total_fees', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 }
  ];
  students.rows.forEach(s => sheet.addRow(s));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${className}_students.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// PAYMENTS
app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const preselectedId = req.query.student_id || '';
  const success = req.query.success;
  const students = await pool.query('SELECT id, name, class, balance FROM students WHERE balance > 0 ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}.success{background:#27ae60;color:white;padding:10px;border-radius:4px;margin-bottom:15px}</style>
  </head><body><h2>Record Payment</h2>
  ${success? '<div class="success">✅ Payment recorded successfully!</div>' : ''}
  <form method="POST" action="/admin/payments/add">
    <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}" ${s.id == preselectedId? 'selected' : ''}>${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</option>`).join('')}</select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="method" placeholder="Payment Method e.g MTN" required>
    <input name="reference" placeholder="Reference/TxID">
    <button type="submit">Save Payment</button>
  </form><a href="/admin">Back</a></body></html>`);
});

app.post('/admin/payments/add', requireLogin, async (req, res) => {
  try {
    const { student_id, amount, method, reference } = req.body;
    await pool.query('INSERT INTO payments (student_id, amount, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5)', [student_id, amount, method, reference, req.session.user.username]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
    await logAction(req.session.user.username, 'PAYMENT_RECORDED', { student_id, amount, method });
    res.redirect('/admin/payments/add?success=1');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// CREATE USER - PROFESSIONAL WITH ASSIGNMENTS
app.get('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const subjects = await pool.query('SELECT DISTINCT name FROM subjects WHERE active = true ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}.section{border:1px solid #ddd;padding:15px;border-radius:8px;margin:15px 0}.checkbox-group{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.checkbox-group label{display:flex;align-items:center;gap:5px;font-size:14px}</style>
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
      <input name="position" placeholder="Position e.g Senior Teacher, Cook, Store Keeper" required>
      <input name="monthly_salary" type="number" placeholder="Monthly Salary UGX" required>
      <input name="bank_account" placeholder="Bank Account Number">
      <input name="hire_date" type="date" placeholder="Hire Date">
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
    <div class="section"><h3>Subject Teaching Assignment</h3>
      <p style="font-size:13px;color:#666">Select subjects this teacher handles:</p>
      <div class="checkbox-group">
        ${subjects.rows.map(s => `<label><input type="checkbox" name="subjects" value="${s.name}"> ${s.name}</label>`).join('')}
      </div>
      <select name="subject_class_scope">
        <option value="">All Classes</option>
        ${ALL_CLASSES.map(c => `<option value="${c}">${c} Only</option>`).join('')}
      </select>
    </div>
    <div class="section"><h3>Duty Assignment - Non-Teaching</h3>
      <p style="font-size:13px;color:#666">Select duties for support staff:</p>
      <div class="checkbox-group">
        ${DUTY_TYPES.map(d => `<label><input type="checkbox" name="duties" value="${d}"> ${d}</label>`).join('')}
      </div>
    </div>
    <button type="submit">Create Staff Member</button>
  </form><a href="/admin/staff">Back</a></div></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, full_name, phone, email, department, position, monthly_salary, bank_account, hire_date, role, assigned_class, subjects, subject_class_scope, duties } = req.body;
    const hash = await bcrypt.hash(password, 10);

    await pool.query('INSERT INTO admins (username, password, role, full_name, assigned_class, phone, email, department) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [username, hash, role, full_name, assigned_class || null, phone, email, department]);

    const staffRes = await pool.query('INSERT INTO staff (username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [username, full_name, position, department, phone, email, hire_date, monthly_salary, bank_account]);

    if (assigned_class) {
      await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
        [username, 'class_teacher', assigned_class, department]);
    }

    if (subjects) {
      const subjectArray = Array.isArray(subjects)? subjects : [subjects];
      for (const subj of subjectArray) {
        await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, class_scope, department) VALUES      const subjectArray = Array.isArray(subjects)? subjects : [subjects];
      for (const subj of subjectArray) {
        await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, class_scope, department) VALUES ($1, $2, $3, $4, $5)',
          [username, 'subject_teacher', subj, subject_class_scope || null, department]);
      }
    }

    if (duties) {
      const dutyArray = Array.isArray(duties)? duties : [duties];
      for (const duty of dutyArray) {
        await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, department) VALUES ($1, $2, $3, $4)',
          [username, 'duty', duty, department]);
      }
    }

    await logAction(req.session.user.username, 'STAFF_CREATED', { username, full_name, position, department });
    res.send(`Staff ${full_name} created successfully. <a href="/admin/staff">View All Staff</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// STAFF ASSIGNMENTS MANAGEMENT
app.get('/admin/assignments', requireLogin, requireRole(['admin']), async (req, res) => {
  const assignments = await pool.query(`
    SELECT sa.*, s.full_name, s.position, s.department
    FROM staff_assignments sa
    JOIN staff s ON sa.username = s.username
    WHERE sa.active = true
    ORDER BY s.department, s.full_name, sa.assignment_type
  `);

  const grouped = {};
  assignments.rows.forEach(a => {
    if (!grouped[a.full_name]) grouped[a.full_name] = { position: a.position, department: a.department, items: [] };
    grouped[a.full_name].items.push(a);
  });

  res.send(`<!DOCTYPE html><html><head><title>Staff Assignments</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.staff-block{border:1px solid #ddd;padding:15px;margin:10px 0;border-radius:8px}.badge{background:#3498db;color:white;padding:4px 10px;border-radius:12px;font-size:12px;margin:3px;display:inline-block}.badge-class{background:#27ae60}.badge-subject{background:#e67e22}.badge-duty{background:#9b59b6}</style>
  </head><body>
    <div class="card"><h1>📋 Staff Assignments</h1><a href="/admin/staff" class="btn">← Staff List</a> <a href="/admin/assignments/add" class="btn" style="background:#27ae60">+ New Assignment</a></div>
    <div class="card">
      ${Object.keys(grouped).map(name => `
        <div class="staff-block">
          <h3>${name} - ${grouped[name].position} (${grouped[name].department})</h3>
          <div>
            ${grouped[name].items.map(a => {
              const badgeClass = a.assignment_type === 'class_teacher'? 'badge-class' : a.assignment_type === 'subject_teacher'? 'badge-subject' : 'badge-duty';
              return `<span class="badge ${badgeClass}">${a.assignment_type}: ${a.assignment_value} ${a.class_scope? '('+a.class_scope+')' : ''}</span>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  </body></html>`);
});

// ADD NEW ASSIGNMENT
app.get('/admin/assignments/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT username, full_name FROM staff WHERE active = true ORDER BY full_name');
  const subjects = await pool.query('SELECT DISTINCT name FROM subjects WHERE active = true ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Add Assignment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Staff Assignment</h2>
  <form method="POST" action="/admin/assignments/add">
    <select name="username" required>
      <option value="">Select Staff Member</option>
      ${staff.rows.map(s => `<option value="${s.username}">${s.full_name}</option>`).join('')}
    </select>
    <select name="assignment_type" id="assignType" required onchange="toggleFields()">
      <option value="">Select Assignment Type</option>
      <option value="class_teacher">Class Teacher</option>
      <option value="subject_teacher">Subject Teacher</option>
      <option value="duty">Non-Teaching Duty</option>
      <option value="department_head">Department Head</option>
    </select>
    <div id="classField" style="display:none">
      <select name="assignment_value_class">
        <option value="">Select Class</option>
        ${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="subjectField" style="display:none">
      <select name="assignment_value_subject">
        <option value="">Select Subject</option>
        ${subjects.rows.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
      </select>
      <select name="class_scope">
        <option value="">All Classes</option>
        ${ALL_CLASSES.map(c => `<option value="${c}">${c} Only</option>`).join('')}
      </select>
    </div>
    <div id="dutyField" style="display:none">
      <select name="assignment_value_duty">
        <option value="">Select Duty</option>
        ${DUTY_TYPES.map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
    </div>
    <select name="department" required>
      <option value="">Select Department</option>
      ${DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    </select>
    <button type="submit">Add Assignment</button>
  </form><a href="/admin/assignments">Back</a></div>
  <script>
    function toggleFields() {
      const type = document.getElementById('assignType').value;
      document.getElementById('classField').style.display = type === 'class_teacher'? 'block' : 'none';
      document.getElementById('subjectField').style.display = type === 'subject_teacher'? 'block' : 'none';
      document.getElementById('dutyField').style.display = type === 'duty'? 'block' : 'none';
    }
  </script>
  </body></html>`);
});

app.post('/admin/assignments/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, assignment_type, assignment_value_class, assignment_value_subject, assignment_value_duty, class_scope, department } = req.body;
    const assignment_value = assignment_value_class || assignment_value_subject || assignment_value_duty;
    await pool.query('INSERT INTO staff_assignments (username, assignment_type, assignment_value, class_scope, department) VALUES ($1, $2, $3, $4, $5)',
      [username, assignment_type, assignment_value, class_scope || null, department]);
    await logAction(req.session.user.username, 'ASSIGNMENT_ADDED', { username, assignment_type, assignment_value });
    res.redirect('/admin/assignments');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// SUBJECTS MANAGEMENT
app.get('/admin/subjects', requireLogin, requireRole(['admin']), async (req, res) => {
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY department, class, name');
  res.send(`<!DOCTYPE html><html><head><title>Manage Subjects</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>📚 Manage Subjects</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/subjects/add" class="btn btn-green">+ Add Subject</a></div>
    <div class="card">
      <table><tr><th>Subject</th><th>Class</th><th>Department</th><th>Max Marks</th><th>Status</th></tr>
      ${subjects.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.department}</td><td>${s.max_marks}</td><td>${s.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/subjects/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Subject</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add New Subject</h2>
  <form method="POST" action="/admin/subjects/add">
    <input name="name" placeholder="Subject Name e.g Computer Studies" required>
    <select name="class" required>
      <option value="">Select Class</option>
      ${ALL_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <select name="department" required>
      <option value="Primary">Primary</option>
      <option value="Nursery">Nursery</option>
    </select>
    <input name="max_marks" type="number" value="100" placeholder="Max Marks" required>
    <button type="submit">Add Subject</button>
  </form><a href="/admin/subjects">Back</a></div></body></html>`);
});

app.post('/admin/subjects/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { name, class: className, department, max_marks } = req.body;
    await pool.query('INSERT INTO subjects (name, class, department, max_marks) VALUES ($1, $2, $3, $4)', [name, className, department, max_marks]);
    res.redirect('/admin/subjects');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// DYNAMIC STUDENT FIELDS
app.get('/admin/fields', requireLogin, requireRole(['admin']), async (req, res) => {
  const fields = await pool.query('SELECT * FROM student_field_definitions ORDER BY field_name');
  res.send(`<!DOCTYPE html><html><head><title>Custom Student Fields</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.btn-green{background:#27ae60}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#34495e;color:white}</style>
  </head><body>
    <div class="card"><h1>⚙️ Custom Student Fields</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/fields/add" class="btn btn-green">+ Add Field</a></div>
    <div class="card"><p>Admin can add custom fields to student records like 'Blood Group', 'Allergies', 'Bus Route', etc. These appear on student add/edit forms.</p>
      <table><tr><th>Field Name</th><th>Type</th><th>Required</th><th>Status</th></tr>
      ${fields.rows.map(f => `<tr><td>${f.field_name}</td><td>${f.field_type}</td><td>${f.required? 'Yes' : 'No'}</td><td>${f.active? 'Active' : 'Inactive'}</td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
});

app.get('/admin/fields/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Field</title>
  <style>body{font-family:Arial;max-width:500px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button,textarea{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Add Custom Student Field</h2>
  <form method="POST" action="/admin/fields/add">
    <input name="field_name" placeholder="Field Name e.g Blood Group" required>
    <select name="field_type" required>
      <option value="text">Text</option>
      <option value="number">Number</option>
      <option value="date">Date</option>
      <option value="select">Dropdown Select</option>
    </select>
    <textarea name="field_options" placeholder="For Dropdown: Enter options separated by comma e.g A,B,AB,O"></textarea>
    <label><input type="checkbox" name="required" value="true"> Required Field</label>
    <button type="submit">Add Field</button>
  </form><a href="/admin/fields">Back</a></div></body></html>`);
});

app.post('/admin/fields/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { field_name, field_type, field_options, required } = req.body;
    const options = field_options? JSON.stringify(field_options.split(',').map(o => o.trim())) : null;
    await pool.query('INSERT INTO student_field_definitions (field_name, field_type, field_options, required) VALUES ($1, $2, $3, $4)',
      [field_name, field_type, options, required === 'true']);
    res.redirect('/admin/fields');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});