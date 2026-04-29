const rateLimit = require('express-rate-limit');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

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
    const securityActions = ['LOGIN_FAIL', 'USER_CREATED', 'TASK_ASSIGNED', 'DONOR_ADDED', 'DONATION_RECORDED'];
    if (securityActions.includes(action) && transporter && ADMIN_EMAIL) {
      transporter.sendMail({
        from: ADMIN_EMAIL, to: ADMIN_EMAIL,
        subject: `[Ssewasswa API] Alert: ${action}`,
        text: `User: ${username}\nAction: ${action}\nDetails: ${JSON.stringify(details, null, 2)}\nTime: ${new Date().toLocaleString()}`
      }).catch(err => console.error('Email alert failed:', err));
    }
  } catch (err) { console.error('Audit log failed:', err); }
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'bursar', full_name VARCHAR(100), assigned_class TEXT
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, class VARCHAR(50) NOT NULL,
      term VARCHAR(20) NOT NULL, year INTEGER NOT NULL, total_fees INTEGER NOT NULL, balance INTEGER NOT NULL
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

    -- SESSION TABLE - FIXED VERSION
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
  `);

  // Add primary key only if it doesn't exist - prevents crash on redeploy
  const pkCheck = await pool.query(`
    SELECT constraint_name 
    FROM information_schema.table_constraints 
    WHERE table_name = 'session' AND constraint_type = 'PRIMARY KEY'
  `);
  if (pkCheck.rows.length === 0) {
    await pool.query('ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid)');
    console.log('✅ Session primary key created');
  }

  await pool.query(`
    -- PORTALS & TASKS
    CREATE TABLE IF NOT EXISTS staff_tasks (
      id SERIAL PRIMARY KEY, username VARCHAR(50) REFERENCES admins(username) ON DELETE CASCADE,
      task_name VARCHAR(100) NOT NULL, assigned_by VARCHAR(50), assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS exam_results (
      id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      subject VARCHAR(100), marks INTEGER, term VARCHAR(20), year INTEGER,
      recorded_by VARCHAR(50), recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS online_classes (
      id SERIAL PRIMARY KEY, class VARCHAR(50), subject VARCHAR(100), topic VARCHAR(200),
      meeting_link TEXT, scheduled_at TIMESTAMP, created_by VARCHAR(50)
    );

    -- DONORS PORTAL TABLES
    CREATE TABLE IF NOT EXISTS donors (
      id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100),
      phone VARCHAR(50), organization VARCHAR(100), address TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY, donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL, purpose VARCHAR(200), donation_date DATE DEFAULT CURRENT_DATE,
      method VARCHAR(50), reference VARCHAR(100), recorded_by VARCHAR(50)
    );
    CREATE TABLE IF NOT EXISTS donor_students (
      id SERIAL PRIMARY KEY, donor_id INTEGER REFERENCES donors(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      amount_pledged INTEGER, sponsorship_type VARCHAR(50)
    );
  `);
  console.log('✅ Database ready');
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

// DASHBOARD WITH ALL PORTALS
app.get('/admin', requireLogin, async (req, res) => {
  const user = req.session.user;
  const tasks = await pool.query('SELECT task_name FROM staff_tasks WHERE username = $1 AND active = true', [user.username]);
  const userTasks = tasks.rows.map(t => t.task_name);

  if (user.role === 'admin') {
    const totals = await pool.query(`SELECT COUNT(*) as total_students, SUM(total_fees) as total_fees, SUM(balance) as total_outstanding FROM students`);
    const donorTotals = await pool.query(`SELECT COUNT(*) as total_donors, SUM(amount) as total_donated FROM donations`);
    const t = totals.rows[0], d = donorTotals.rows[0];

    return res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:1000px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px 10px 0 0}.portal{background:#9b59b6}.donor{background:#e67e22}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:15px}.stat{background:#ecf0f1;padding:15px;border-radius:4px}</style>
    </head><body>
      <div class="card"><h1>Admin Dashboard</h1><p>Logged in as: ${user.username} (${user.role})</p></div>
      <div class="card"><h3>School Overview</h3>
        <div class="stats">
          <div class="stat"><strong>Students:</strong><br>${t.total_students}</div>
          <div class="stat"><strong>Fees Expected:</strong><br>UGX ${Number(t.total_fees).toLocaleString()}</div>
          <div class="stat"><strong>Outstanding:</strong><br>UGX ${Number(t.total_outstanding).toLocaleString()}</div>
          <div class="stat"><strong>Donations:</strong><br>UGX ${Number(d.total_donated || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="card"><h3>All Portals</h3>
        <a href="/admin/financial" class="btn portal">💰 Financial Portal</a>
        <a href="/admin/academic" class="btn portal">📚 Academic Portal</a>
        <a href="/admin/donors" class="btn donor">🤝 Donors Portal</a>
        <a href="/admin/tasks" class="btn portal">📋 Assign Tasks</a>
      </div>
      <div class="card"><h3>Quick Access by Class</h3>
        <a href="/admin/class/P1" class="btn">P1</a><a href="/admin/class/P2" class="btn">P2</a>
        <a href="/admin/class/P3" class="btn">P3</a><a href="/admin/class/P4" class="btn">P4</a>
        <a href="/admin/class/P5" class="btn">P5</a><a href="/admin/class/P6" class="btn">P6</a>
        <a href="/admin/class/P7" class="btn">P7</a>
      </div>
      <div class="card"><a href="/admin/users/add" class="btn">Create User</a><a href="/admin/students" class="btn">All Students</a><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    </body></html>`);
  }

  let portalButtons = '';
  if (userTasks.includes('financial_portal')) portalButtons += '<a href="/admin/financial" class="btn portal">💰 Financial Portal</a>';
  if (userTasks.includes('academic_portal')) portalButtons += '<a href="/admin/academic" class="btn portal">📚 Academic Portal</a>';
  if (userTasks.includes('exams')) portalButtons += '<a href="/admin/exams" class="btn portal">📝 Exams Portal</a>';
  if (userTasks.includes('online_classes')) portalButtons += '<a href="/admin/online-classes" class="btn portal">💻 Online Classes</a>';
  if (userTasks.includes('donors_portal')) portalButtons += '<a href="/admin/donors" class="btn donor">🤝 Donors Portal</a>';

  res.send(`<!DOCTYPE html><html><head><title>Teacher Dashboard</title>
  <style>body{font-family:Arial;max-width:800px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);margin-bottom:20px}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px 10px 0 0}.portal{background:#9b59b6}.donor{background:#e67e22}</style>
  </head><body><div class="card"><h1>Welcome ${user.username}</h1><p>Role: ${user.role} | Assigned Class: ${user.assigned_class || 'None'}</p>
    ${user.assigned_class? `<a href="/admin/class/${user.assigned_class}" class="btn" style="font-size:18px">View ${user.assigned_class} Students</a>` : ''}
  </div>
  ${portalButtons? `<div class="card"><h3>Assigned Portals</h3>${portalButtons}</div>` : '<div class="card"><p>No special portals assigned. Contact admin if you need access.</p></div>'}
  <div class="card"><a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a></div></body></html>`);
});

// FINANCIAL PORTAL
app.get('/admin/financial', requireLogin, requireTask('financial_portal'), async (req, res) => {
  const classes = await pool.query(`SELECT class, COUNT(*) as count, SUM(total_fees) as fees, SUM(balance) as balance FROM students GROUP BY class ORDER BY class`);
  res.send(`<!DOCTYPE html><html><head><title>Financial Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>💰 Financial Portal</h1><a href="/admin" class="btn">← Dashboard</a><br><br>
  <table><tr><th>Class</th><th>Students</th><th>Total Fees</th><th>Outstanding</th><th>Collected</th><th>Actions</th></tr>
  ${classes.rows.map(c => `<tr><td>${c.class}</td><td>${c.count}</td><td>UGX ${Number(c.fees).toLocaleString()}</td><td>UGX ${Number(c.balance).toLocaleString()}</td><td>UGX ${(Number(c.fees)-Number(c.balance)).toLocaleString()}</td><td><a href="/admin/class/${c.class}/export" class="btn">Export Excel</a></td></tr>`).join('')}
  </table></body></html>`);
});

// ACADEMIC PORTAL
app.get('/admin/academic', requireLogin, requireTask('academic_portal'), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Academic Portal</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.btn{background:#9b59b6;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px}</style>
  </head><body><h1>📚 Academic Portal</h1><a href="/admin">← Dashboard</a><br><br>
  <a href="/admin/exams" class="btn">📝 Manage Exams</a>
  <a href="/admin/online-classes" class="btn">💻 Online Classes</a>
  </body></html>`);
});

// EXAMS PORTAL
app.get('/admin/exams', requireLogin, requireTask('exams'), async (req, res) => {
  const results = await pool.query(`SELECT e.*, s.name, s.class FROM exam_results e JOIN students s ON e.student_id = s.id ORDER BY e.recorded_at DESC LIMIT 50`);
  res.send(`<!DOCTYPE html><html><head><title>Exams Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}.btn{background:#9b59b6;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>📝 Exams Portal</h1><a href="/admin/academic" class="btn">← Academic</a> <a href="/admin/exams/add" class="btn">+ Record Marks</a><br><br>
  <table><tr><th>Student</th><th>Class</th><th>Subject</th><th>Marks</th><th>Term</th><th>Year</th><th>Recorded By</th></tr>
  ${results.rows.map(r => `<tr><td>${r.name}</td><td>${r.class}</td><td>${r.subject}</td><td>${r.marks}</td><td>${r.term}</td><td>${r.year}</td><td>${r.recorded_by}</td></tr>`).join('')}
  </table></body></html>`);
});

app.get('/admin/exams/add', requireLogin, requireTask('exams'), async (req, res) => {
  const students = await pool.query('SELECT id, name, class FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Record Exam</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Record Exam Results</h2><form method="POST" action="/admin/exams/add">
    <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class}</option>`).join('')}</select>
    <input name="subject" placeholder="Subject e.g Mathematics" required>
    <input name="marks" type="number" placeholder="Marks" required>
    <input name="term" placeholder="Term e.g Term 1" required>
    <input name="year" type="number" placeholder="Year" value="2026" required>
    <button type="submit">Save Results</button>
  </form><a href="/admin/exams">Back</a></body></html>`);
});

app.post('/admin/exams/add', requireLogin, requireTask('exams'), async (req, res) => {
  const { student_id, subject, marks, term, year } = req.body;
  await pool.query('INSERT INTO exam_results (student_id, subject, marks, term, year, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)', [student_id, subject, marks, term, year, req.session.user.username]);
  res.redirect('/admin/exams');
});

// ONLINE CLASSES PORTAL
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
    <select name="class" required><option value="">Select Class</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option><option value="P5">P5</option><option value="P6">P6</option><option value="P7">P7</option></select>
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

// DONORS PORTAL - from our 20/10 layout
app.get('/admin/donors', requireLogin, requireTask('donors_portal'), async (req, res) => {
  const donors = await pool.query(`SELECT d.*, COUNT(ds.id) as sponsored_students, COALESCE(SUM(don.amount), 0) as total_donated
    FROM donors d
    LEFT JOIN donor_students ds ON d.id = ds.donor_id
    LEFT JOIN donations don ON d.id = don.donor_id
    GROUP BY d.id ORDER BY d.name`);
  res.send(`<!DOCTYPE html><html><head><title>Donors Portal</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd}th{background:#e67e22;color:white}.btn{background:#e67e22;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}</style>
  </head><body><h1>🤝 Donors Portal</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/donors/add" class="btn">+ Add Donor</a> <a href="/admin/donations/add" class="btn">+ Record Donation</a><br><br>
  <table><tr><th>Donor</th><th>Organization</th><th>Contact</th><th>Students Sponsored</th><th>Total Donated</th><th>Actions</th></tr>
  ${donors.rows.map(d => `<tr><td>${d.name}</td><td>${d.organization || '-'}</td><td>${d.phone || d.email || '-'}</td><td>${d.sponsored_students}</td><td>UGX ${Number(d.total_donated).toLocaleString()}</td><td><a href="/admin/donors/${d.id}" class="btn" style="padding:6px 12px;font-size:12px">View</a></td></tr>`).join('')}
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

// TASK ASSIGNMENT - ADMIN ONLY - MULTI-SELECT VERSION
app.get('/admin/tasks', requireLogin, requireRole(['admin']), async (req, res) => {
  const users = await pool.query("SELECT username, role, assigned_class FROM admins WHERE role!= 'admin'");
  const tasks = await pool.query('SELECT * FROM staff_tasks WHERE active = true ORDER BY username, task_name');

  // Group tasks by username for display
  const userTasks = {};
  tasks.rows.forEach(t => {
    if (!userTasks[t.username]) userTasks[t.username] = [];
    userTasks[t.username].push(t.task_name);
  });

  res.send(`<!DOCTYPE html><html><head><title>Assign Tasks</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}select,button{padding:8px;margin:5px}.task-list{display:flex;flex-wrap:wrap;gap:5px}.task-badge{background:#3498db;color:white;padding:4px 8px;border-radius:12px;font-size:12px}.checkbox-group{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:10px 0}.checkbox-group label{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid #ddd;border-radius:4px;cursor:pointer}.checkbox-group input{width:auto;margin:0}</style>
  </head><body><h1>📋 Assign Staff Tasks</h1><a href="/admin">← Dashboard</a><br><br>

  <div style="background:white;padding:20px;border-radius:8px;margin-bottom:20px">
    <h3>Assign Multiple Tasks</h3>
    <form method="POST" action="/admin/tasks/assign">
      <label><strong>Select Staff:</strong></label>
      <select name="username" required style="width:100%;padding:10px;margin:10px 0">
        <option value="">Select Staff</option>
        ${users.rows.map(u => `<option value="${u.username}">${u.username} - ${u.role} ${u.assigned_class || ''}</option>`).join('')}
      </select>

      <label><strong>Select Tasks to Assign:</strong></label>
      <div class="checkbox-group">
        <label><input type="checkbox" name="tasks" value="financial_portal"> 💰 Financial Portal</label>
        <label><input type="checkbox" name="tasks" value="academic_portal"> 📚 Academic Portal</label>
        <label><input type="checkbox" name="tasks" value="exams"> 📝 Exams Management</label>
        <label><input type="checkbox" name="tasks" value="online_classes"> 💻 Online Classes</label>
        <label><input type="checkbox" name="tasks" value="donors_portal"> 🤝 Donors Portal</label>
      </div>
      <button type="submit" style="background:#27ae60;color:white;padding:12px 20px;border:none;border-radius:4px;cursor:pointer;width:100%">Assign Selected Tasks</button>
    </form>
  </div>

  <h3>Current Active Tasks</h3>
  <table>
    <tr><th>Staff</th><th>Assigned Tasks</th><th>Actions</th></tr>
    ${Object.keys(userTasks).map(username => `
      <tr>
        <td><strong>${username}</strong></td>
        <td><div class="task-list">${userTasks[username].map(task => `<span class="task-badge">${task.replace('_', ' ')}</span>`).join('')}</div></td>
        <td><a href="/admin/tasks/revoke-all/${username}" style="color:#e74c3c">Revoke All</a></td>
      </tr>
    `).join('')}
    ${Object.keys(userTasks).length === 0? '<tr><td colspan="3">No tasks assigned yet</td></tr>' : ''}
  </table>
  </body></html>`);
});

app.post('/admin/tasks/assign', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, tasks } = req.body;
    // Handle both single checkbox and multiple checkboxes
    const taskArray = Array.isArray(tasks)? tasks : [tasks];

    // Insert all selected tasks
    for (const task_name of taskArray) {
      if (task_name) {
        // Check if already assigned to avoid duplicates
        const exists = await pool.query('SELECT id FROM staff_tasks WHERE username = $1 AND task_name = $2 AND active = true', [username, task_name]);
        if (exists.rows.length === 0) {
          await pool.query('INSERT INTO staff_tasks (username, task_name, assigned_by) VALUES ($1, $2, $3)', [username, task_name, req.session.user.username]);
          await logAction(req.session.user.username, 'TASK_ASSIGNED', { username, task_name });
        }
      }
    }
    res.redirect('/admin/tasks');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// REVOKE ALL TASKS FOR A USER
app.get('/admin/tasks/revoke-all/:username', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE staff_tasks SET active = false WHERE username = $1', [req.params.username]);
  await logAction(req.session.user.username, 'ALL_TASKS_REVOKED', { username: req.params.username });
  res.redirect('/admin/tasks');
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

// PAYMENTS ADD - GET
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

// PAYMENT POST
app.post('/admin/payments/add', requireLogin, async (req, res) => {
  try {
    const { student_id, amount, method, reference } = req.body;
    await pool.query('INSERT INTO payments (student_id, amount, method, reference, recorded_by) VALUES ($1, $2, $3, $4, $5)', [student_id, amount, method, reference, req.session.user.username]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
    await logAction(req.session.user.username, 'PAYMENT_RECORDED', { student_id, amount, method });
    res.redirect('/admin/payments/add?success=1');
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// STUDENT DETAIL WITH RECEIPT
app.get('/admin/students/:id', requireLogin, async (req, res) => {
  try {
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (student.rows.length === 0) return res.status(404).send('Student not found');
    const s = student.rows[0];
    const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.params.id]);
    res.send(`<!DOCTYPE html><html><head><title>${s.name}</title>
    <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}@media print{.no-print{display:none}}</style>
    </head><body><h1>${s.name} - ${s.class}</h1>
      <p><strong>Term:</strong> ${s.term} ${s.year}</p>
      <p><strong>Total Fees:</strong> UGX ${Number(s.total_fees).toLocaleString()}</p>
      <p><strong>Balance:</strong> UGX ${Number(s.balance).toLocaleString()}</p>
      <button onclick="window.print()" class="btn no-print">🖨️ Print Receipt</button>
      <h3>Payment History</h3>
      <table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded By</th></tr>
        ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.reference || '-'}</td><td>${p.recorded_by || '-'}</td></tr>`).join('')}
      </table><br><a href="/admin/class/${s.class}" class="no-print">Back to ${s.class}</a></body></html>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// ADD STUDENT - GET
app.get('/admin/students/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Add Student</h2><form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Name" required>
    <select name="class" required><option value="">Select Class</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option><option value="P5">P5</option><option value="P6">P6</option><option value="P7">P7</option></select>
    <input name="term" placeholder="Term e.g Term 1" required>
    <input name="year" type="number" placeholder="Year e.g 2026" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <button type="submit">Save Student</button>
  </form><a href="/admin">Back</a></body></html>`);
});

// ADD STUDENT - POST
app.post('/admin/students/add', requireLogin, async (req, res) => {
  try {
    const { name, class: className, term, year, total_fees } = req.body;
    await pool.query('INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1, $2, $3, $4, $5, $5)', [name, className, term, year, total_fees]);
    await logAction(req.session.user.username, 'STUDENT_CREATED', { name, class: className });
    res.redirect('/admin/class/' + className);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// ALL STUDENTS
app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>All Students</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}</style>
  </head><body><h1>All Students</h1>
  <a href="/admin/students/add" style="background:#27ae60;color:white;padding:10px 15px;text-decoration:none;border-radius:4px">+ Add Student</a><br><br>
  <table><tr><th>Name</th><th>Class</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th></tr>
  ${students.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.term}</td><td>${s.year}</td><td>UGX ${Number(s.total_fees).toLocaleString()}</td><td>UGX ${Number(s.balance).toLocaleString()}</td></tr>`).join('')}
  </table><br><a href="/admin">Back to Dashboard</a></body></html>`);
});

// CREATE USER - COMPLETE
app.get('/admin/users/add', requireLogin, requireRole(['admin']), (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Create User</title>
  <style>body{font-family:Arial;max-width:500px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}input,select,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Create New Staff</h2>
  <form method="POST" action="/admin/users/add">
    <label>Username:</label><input name="username" required>
    <label>Password:</label><input type="password" name="password" required>
    <label>Full Name:</label><input name="full_name">
    <label>Role:</label><select name="role" required>
      <option value="admin">Admin - Full Access</option>
      <option value="bursar">Bursar - Fees Only</option>
      <option value="class_teacher">Class Teacher - Own Class Only</option>
      <option value="academic">Academic Staff</option>
    </select>
    <label>Assign to Class (for Class Teachers):</label>
    <select name="assigned_class">
      <option value="">None</option><option value="P1">P1</option><option value="P2">P2</option>
      <option value="P3">P3</option><option value="P4">P4</option><option value="P5">P5</option>
      <option value="P6">P6</option><option value="P7">P7</option>
    </select>
    <button type="submit">Create User</button>
  </form><a href="/admin">Back</a></div></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, role, assigned_class, full_name } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admins (username, password, role, assigned_class, full_name) VALUES ($1, $2, $3, $4, $5)', [username, hash, role, assigned_class || null, full_name]);
    await logAction(req.session.user.username, 'USER_CREATED', { newUser: username, role, assigned_class });
    res.send(`User ${username} created. <a href="/admin">Dashboard</a>`);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});