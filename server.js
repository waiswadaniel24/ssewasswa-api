require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const PORT = process.env.PORT || 10000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'ssewasswa-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 24 * 60 * 60 * 1000 } }));
app.use('/uploads', express.static('uploads'));

// === DB INIT ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE, password VARCHAR(255), role VARCHAR(20), full_name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, name VARCHAR(100), class VARCHAR(50), school_type VARCHAR(20), parent_phone VARCHAR(20), balance DECIMAL(10,2) DEFAULT 0, gender VARCHAR(10), dob DATE, admission_no VARCHAR(50), address TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, name VARCHAR(100), class VARCHAR(50), max_marks INT DEFAULT 100, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS exam_results (id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id), subject_id INT REFERENCES subjects(id), marks DECIMAL(5,2), term VARCHAR(20), year INT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id), amount DECIMAL(10,2), method VARCHAR(50), term VARCHAR(20), receipt_no VARCHAR(50), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, student_id INT REFERENCES students(id), date DATE, status VARCHAR(10), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS library_books (id SERIAL PRIMARY KEY, title VARCHAR(200), author VARCHAR(100), isbn VARCHAR(50), available BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS library_loans (id SERIAL PRIMARY KEY, book_id INT REFERENCES library_books(id), student_id INT REFERENCES students(id), borrowed_date DATE, returned_date DATE, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS donors (id SERIAL PRIMARY KEY, name VARCHAR(100), amount DECIMAL(10,2), purpose TEXT, date DATE, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS assets (id SERIAL PRIMARY KEY, name VARCHAR(100), value DECIMAL(10,2), location VARCHAR(100), condition VARCHAR(50), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, name VARCHAR(100), role VARCHAR(50), salary DECIMAL(10,2), phone VARCHAR(20), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS payroll (id SERIAL PRIMARY KEY, staff_id INT REFERENCES staff(id), amount DECIMAL(10,2), month VARCHAR(20), year INT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), task TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, username VARCHAR(50), action VARCHAR(100), details JSONB, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS admin_wallet (id INT PRIMARY KEY DEFAULT 1, balance DECIMAL(10,2) DEFAULT 0);
    CREATE TABLE IF NOT EXISTS momo_transactions (id SERIAL PRIMARY KEY, transaction_id VARCHAR(100), amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20), type VARCHAR(20), provider VARCHAR(20) DEFAULT 'MTN', created_at TIMESTAMP DEFAULT NOW());
    INSERT INTO admin_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS past_papers (id SERIAL PRIMARY KEY,class VARCHAR(20),subject VARCHAR(100),year INTEGER,type VARCHAR(50),price DECIMAL(10,2),file_url TEXT,active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    ALTER TABLE momo_transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'MTN';
    `);
    CREATE TABLE IF NOT EXISTS page_views (id SERIAL PRIMARY KEY,page VARCHAR(255),ip_address VARCHAR(45),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (id SERIAL PRIMARY KEY,email VARCHAR(255) UNIQUE,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  const adminExists = await pool.query('SELECT * FROM users WHERE role = $1', ['admin']);
  if (adminExists.rows.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query('INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)', ['admin', hash, 'admin', 'System Admin']);
  }

  const subjects = [
    ['Mathematics', 'P.1'], ['English', 'P.1'], ['Science', 'P.1'], ['Social Studies', 'P.1'],
    ['Mathematics', 'S.1'], ['English', 'S.1'], ['Physics', 'S.1'], ['Chemistry', 'S.1'], ['Biology', 'S.1'],
    ['Mathematics', 'University'], ['Computer Science', 'University'], ['Economics', 'University']
  ];
  for (let [name, cls] of subjects) {
    await pool.query('INSERT INTO subjects (name, class) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE name = $1 AND class = $2)', [name, cls]);
  }
}

// === MIDDLEWARE ===
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) return res.status(403).send('Access Denied');
    next();
  };
}

async function logAction(username, action, details) {
  await pool.query('INSERT INTO audit_logs (username, action, details) VALUES ($1, $2, $3)', [username, action, details]);
}

// === SMS HELPER ===
async function sendSMS(phone, message) {
  if (!process.env.AT_API_KEY) return;
  try {
    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { 'apiKey': process.env.AT_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({ username: process.env.AT_USERNAME || 'sandbox', to: phone, message })
    });
    return await response.json();
  } catch (e) { console.log('SMS Error:', e.message); }
}

// === AUTH ROUTES ===
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Staff Login</title><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#667eea"><script>if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');</script>
  <style>body{font-family:Arial;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.login{background:white;padding:40px;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,0.2)}input{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}button{width:100%;padding:12px;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer}</style>
  </head><body><div class="login"><h2>Staff Login</h2><form method="POST" action="/login"><input name="username" placeholder="Username" required><input name="password" type="password" placeholder="Password" required><button type="submit">Login</button></form></div></body></html>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (user.rows.length === 0) return res.send('Invalid credentials');
  const valid = await bcrypt.compare(password, user.rows[0].password);
  if (!valid) return res.send('Invalid credentials');
  req.session.userId = user.rows[0].id;
  req.session.username = user.rows[0].username;
  req.session.role = user.rows[0].role;
  await logAction(username, 'LOGIN', {});
  res.redirect('/admin');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// === PARENT PORTAL ===
app.get('/parent/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Parent Portal</title><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#667eea"><script>if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');</script>
  <style>body{font-family:Arial;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.login{background:white;padding:40px;border-radius:10px;box-shadow:0 10px 25px rgba(0,0,0,0.2)}input{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}button{width:100%;padding:12px;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer}</style>
  </head><body><div class="login"><h2>Parent Portal Login</h2><form method="POST" action="/parent/login"><input name="phone" placeholder="Parent Phone: 0772123456" required><input name="student_name" placeholder="Student Full Name" required><button type="submit">Login</button></form></div></body></html>`);
});

app.post('/parent/login', async (req, res) => {
  const { phone, student_name } = req.body;
  const student = await pool.query('SELECT * FROM students WHERE parent_phone = $1 AND name ILIKE $2', [phone, `%${student_name}%`]);
  if (student.rows.length === 0) return res.send('Student not found. Check phone and name.');
  req.session.parentPhone = phone;
  req.session.studentId = student.rows[0].id;
  res.redirect('/parent/dashboard');
});

app.get('/parent/dashboard', async (req, res) => {
  if (!req.session.parentPhone) return res.redirect('/parent/login');
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.session.studentId]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY created_at DESC', [req.session.studentId]);
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Parent Dashboard</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>Welcome, ${s.name}</h1><p>Class: ${s.class} | Balance: UGX ${Number(s.balance).toLocaleString()}</p><a href="/parent/logout" class="btn" style="background:#e74c3c">Logout</a></div>
    <div class="card"><h3>Download Report Cards</h3>
      <a href="/parent/report/${s.id}/Term 1" class="btn">Term 1 Report</a>
      <a href="/parent/report/${s.id}/Term 2" class="btn">Term 2 Report</a>
      <a href="/parent/report/${s.id}/Term 3" class="btn">Term 3 Report</a>
    </div>
    <div class="card"><h3>Payment History</h3><table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Term</th></tr>
      ${payments.rows.map(p => `<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.receipt_no}</td><td>${p.term}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/parent/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/parent/login');
});

app.get('/parent/report/:studentId/:term', async (req, res) => {
  if (!req.session.parentPhone || req.session.studentId!= req.params.studentId) return res.status(403).send('Access denied');
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.studentId]);
  const s = student.rows[0];
  const results = await pool.query(`SELECT er.marks, s.name as subject_name, s.max_marks FROM exam_results er JOIN subjects s ON er.subject_id = s.id WHERE er.student_id = $1 AND er.term = $2 ORDER BY s.name`, [req.params.studentId, req.params.term]);
  const position = await pool.query(`SELECT COUNT(*) + 1 as pos FROM (SELECT student_id, AVG(marks) as avg_marks FROM exam_results er JOIN subjects sub ON er.subject_id = sub.id WHERE er.term = $1 AND sub.class = $2 AND er.year = $3 GROUP BY student_id HAVING AVG(marks) > (SELECT AVG(marks) FROM exam_results er2 JOIN subjects sub2 ON er2.subject_id = sub2.id WHERE er2.student_id = $4 AND er2.term = $1)) as rankings`, [req.params.term, s.class, new Date().getFullYear(), req.params.studentId]);
  const totalStudents = await pool.query('SELECT COUNT(*) as total FROM students WHERE class = $1', [s.class]);
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Report_${s.name}_${req.params.term}.pdf`);
  doc.pipe(res);
  doc.fontSize(20).text('MUHAMMAD VOCATIONAL SCHOOL', { align: 'center' });
  doc.fontSize(14).text('STUDENT REPORT CARD', { align: 'center' }).moveDown();
  doc.fontSize(12).text(`Name: ${s.name}`).text(`Class: ${s.class} (${s.school_type})`).text(`Term: ${req.params.term} ${new Date().getFullYear()}`).text(`Position: ${position.rows[0].pos} out of ${totalStudents.rows[0].total}`).moveDown();
  doc.text('SUBJECT RESULTS:', { underline: true }).moveDown(0.5);
  let total = 0, count = 0;
  results.rows.forEach(r => {
    const percentage = (r.marks / r.max_marks * 100).toFixed(1);
    let grade = 'F9'; if (percentage >= 80) grade = 'D1'; else if (percentage >= 75) grade = 'D2'; else if (percentage >= 70) grade = 'C3'; else if (percentage >= 65) grade = 'C4'; else if (percentage >= 60) grade = 'C5'; else if (percentage >= 55) grade = 'C6'; else if (percentage >= 50) grade = 'P7'; else if (percentage >= 45) grade = 'P8';
    doc.text(`${r.subject_name}: ${r.marks}/${r.max_marks} (${percentage}%) - Grade: ${grade}`);
    total += Number(r.marks); count++;
  });
  if (count > 0) {
    const avg = (total/count).toFixed(2); doc.moveDown().fontSize(14).text(`Average: ${avg}%`, { underline: true });
    let division = 'U'; if (avg >= 75) division = 'Division 1'; else if (avg >= 65) division = 'Division 2'; else if (avg >= 50) division = 'Division 3'; else if (avg >= 30) division = 'Division 4';
    doc.text(`Division: ${division}`);
  }
  doc.moveDown(2).text('Class Teacher: _________________').text('Head Teacher: _________________').text('Date: ' + new Date().toLocaleDateString());
  doc.end();
});

// === ADMIN DASHBOARD ===
app.get('/admin', requireLogin, async (req, res) => {
  const stats = await pool.query(`SELECT (SELECT COUNT(*) FROM students) as students, (SELECT COUNT(*) FROM users) as users, (SELECT COALESCE(SUM(balance),0) FROM students) as total_balance, (SELECT COUNT(*) FROM library_books) as books`);
  const s = stats.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px}.btn{background:#3498db;color:white;padding:15px;text-decoration:none;border-radius:4px;display:block;text-align:center;margin:5px 0}.btn:hover{background:#2980b9}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center}.stat h3{margin:0;font-size:32px;color:#2c3e50}.stat p{margin:5px 0 0;color:#7f8c8d}</style>
  </head><body>
    <div class="card"><h1>SSE Wasswa ERP - Admin Dashboard</h1><p>Welcome, ${req.session.username} (${req.session.role}) | <a href="/logout">Logout</a></p></div>
    <div class="grid">
      <div class="stat"><h3>${s.students}</h3><p>Total Students</p></div>
      <div class="stat"><h3>${s.users}</h3><p>Staff Users</p></div>
      <div class="stat"><h3>UGX ${Number(s.total_balance).toLocaleString()}</h3><p>Outstanding Fees</p></div>
      <div class="stat"><h3>${s.books}</h3><p>Library Books</p></div>
    </div>
    <div class="card"><h3>Academic</h3><div class="grid">
      <a href="/admin/marksheets" class="btn">📝 Marksheets</a>
      <a href="/admin/subjects" class="btn">📚 Subjects</a>
      <a href="/admin/attendance" class="btn">📅 Attendance</a>
    </div></div>
    <div class="card"><h3>Students & Finance</h3><div class="grid">
      <a href="/admin/students" class="btn">👨‍🎓 Students</a>
      <a href="/admin/students/bulk-upload" class="btn">📤 Bulk Upload</a>
      <a href="/admin/payments" class="btn">💰 Payments</a>
      <a href="/admin/donors" class="btn">🎁 Donors</a>
    </div></div>
    <div class="card"><h3>Operations</h3><div class="grid">
      <a href="/admin/library" class="btn">📖 Library</a>
      <a href="/admin/assets" class="btn">🏢 Assets</a>
      <a href="/admin/staff" class="btn">👥 Staff & Payroll</a>
      <a href="/admin/mobile-money" class="btn">📱 Mobile Money</a>
    </div></div>
    <div class="card"><h3>Admin</h3><div class="grid">
      <a href="/admin/users" class="btn">👤 User Management</a>
      <a href="/admin/tasks" class="btn">✅ Task Assignment</a>
      <a href="/admin/logs" class="btn">📋 Audit Logs</a>
    </div></div>
    <a href="/admin/marketing" class="card"><h3>📊 Marketing</h3><p>Ads, Analytics, Leads</p></a>
  </body></html>`);
});

// === MARKSHEETS ===
app.get('/admin/marksheets', requireLogin, async (req, res) => {
  const classes = await pool.query('SELECT DISTINCT class, school_type FROM students ORDER BY class');
  res.send(`<!DOCTYPE html><html><head><title>Marksheets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>📝 Marksheets</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Select Class</h3><table><tr><th>Class</th><th>Type</th><th>Action</th></tr>
      ${classes.rows.map(c => `<tr><td>${c.class}</td><td>${c.school_type}</td><td><a href="/admin/marksheets/${encodeURIComponent(c.class)}" class="btn">Enter Marks</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/admin/marksheets/:class', requireLogin, async (req, res) => {
  const cls = req.params.class;
  const students = await pool.query('SELECT * FROM students WHERE class = $1 ORDER BY name', [cls]);
  const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 ORDER BY name', [cls]);
  res.send(`<!DOCTYPE html><html><head><title>Marksheet - ${cls}</title>
  <style>body{font-family:Arial;max-width:1600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px;overflow-x:auto}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border:1px solid #ddd;text-align:center}th{background:#16a085;color:white}input{width:60px;padding:5px;text-align:center}</style>
  </head><body>
    <div class="card"><h1>Marksheet: ${cls}</h1><a href="/admin/marksheets" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/marksheets/save">
      <input type="hidden" name="class" value="${cls}">
      <label>Term: <select name="term" required><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
      <table><tr><th>Student</th>${subjects.rows.map(s => `<th>${s.name}<br>(${s.max_marks})</th>`).join('')}</tr>
        ${students.rows.map(st => `<tr><td style="text-align:left">${st.name}</td>${subjects.rows.map(sub => `<td><input name="marks_${st.id}_${sub.id}" type="number" step="0.5" max="${sub.max_marks}"></td>`).join('')}</tr>`).join('')}
      </table><br><button type="submit" class="btn" style="background:#27ae60">Save All Marks</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/marksheets/save', requireLogin, async (req, res) => {
  const { term, class: cls } = req.body;
  const year = new Date().getFullYear();
  for (let key in req.body) {
    if (key.startsWith('marks_') && req.body[key]) {
      const [, student_id, subject_id] = key.split('_');
      await pool.query('INSERT INTO exam_results (student_id, subject_id, marks, term, year) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [student_id, subject_id, req.body[key], term, year]);
    }
  }
  await logAction(req.session.username, 'MARKS_ENTRY', { class: cls, term });
  res.send(`Marks saved for ${cls} - ${term}. <a href="/admin/marksheets/${encodeURIComponent(cls)}">Back</a>`);
});

// === SUBJECTS ===
app.get('/admin/subjects', requireLogin, async (req, res) => {
  const subjects = await pool.query('SELECT * FROM subjects ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Subjects</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input,select{padding:8px;margin:5px}</style>
  </head><body>
    <div class="card"><h1>📚 Subjects</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Add Subject</h3><form method="POST" action="/admin/subjects/add">
      <input name="name" placeholder="Subject Name" required>
      <input name="class" placeholder="Class (e.g. P.1, S.1)" required>
      <input name="max_marks" type="number" value="100" required>
      <button type="submit" class="btn" style="background:#27ae60">Add Subject</button>
    </form></div>
    <div class="card"><table><tr><th>Name</th><th>Class</th><th>Max Marks</th></tr>
      ${subjects.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.max_marks}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/subjects/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, class: cls, max_marks } = req.body;
  await pool.query('INSERT INTO subjects (name, class, max_marks) VALUES ($1, $2, $3)', [name, cls, max_marks]);
  await logAction(req.session.username, 'SUBJECT_ADD', { name, class: cls });
  res.redirect('/admin/subjects');
});

// === STUDENTS ===
app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>👨‍🎓 Students</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/students/add" class="btn" style="background:#27ae60">+ Add Student</a> <a href="/admin/students/bulk-upload" class="btn" style="background:#e67e22">📤 Bulk Upload</a></div>
    <div class="card"><table><tr><th>Name</th><th>Class</th><th>Type</th><th>Parent Phone</th><th>Balance</th><th>Actions</th></tr>
      ${students.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.school_type}</td><td>${s.parent_phone || '-'}</td><td>UGX ${Number(s.balance).toLocaleString()}</td><td><a href="/admin/payments/add?student_id=${s.id}" class="btn">Record Payment</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/admin/students/add', requireLogin, async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>Add Student</h1><a href="/admin/students" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/students/add">
      <input name="name" placeholder="Full Name" required>
      <input name="class" placeholder="Class (e.g. P.1, S.2)" required>
      <select name="school_type" required><option value="">School Type</option><option>Nursery</option><option>Primary</option><option>Secondary</option><option>University</option></select>
      <input name="parent_phone" placeholder="Parent Phone: 0772123456">
      <input name="gender" placeholder="Gender">
      <input name="dob" type="date" placeholder="Date of Birth">
      <input name="admission_no" placeholder="Admission Number">
      <input name="address" placeholder="Address">
      <input name="balance" type="number" value="0" placeholder="Opening Balance">
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Add Student</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/students/add', requireLogin, async (req, res) => {
  const { name, class: cls, school_type, parent_phone, gender, dob, admission_no, address, balance } = req.body;
  await pool.query('INSERT INTO students (name, class, school_type, parent_phone, gender, dob, admission_no, address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [name, cls, school_type, parent_phone, gender, dob || null, admission_no, address, balance || 0]);
  await logAction(req.session.username, 'STUDENT_ADD', { name, class: cls });
  res.redirect('/admin/students');
});

app.get('/admin/students/bulk-upload', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Bulk Upload Students</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input{width:100%;padding:10px;margin:10px 0;box-sizing:border-box}</style>
  </head><body>
    <div class="card"><h1>📤 Bulk Upload Students</h1><a href="/admin/students" class="btn">← Back</a></div>
    <div class="card"><h3>Step 1: Download Template</h3><a href="/admin/students/template" class="btn" style="background:#27ae60">Download Excel Template</a></div>
    <div class="card"><h3>Step 2: Upload Filled Excel</h3><form method="POST" action="/admin/students/bulk-upload" enctype="multipart/form-data">
      <input type="file" name="file" accept=".xlsx,.xls" required>
      <button type="submit" class="btn">Upload & Import</button>
    </form><p><small>Required columns: name, class, school_type, parent_phone. Optional: gender, dob, admission_no, address, balance</small></p></div>
  </body></html>`);
});

app.get('/admin/students/template', requireLogin, (req, res) => {
  const ws = xlsx.utils.aoa_to_sheet([['name', 'class', 'school_type', 'parent_phone', 'gender', 'dob', 'admission_no', 'address', 'balance'], ['John Doe', 'P.1', 'Primary', '0772123456', 'Male', '2015-01-15', 'ADM001', 'Kampala', '0']]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Students');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=students_template.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.post('/admin/students/bulk-upload', requireLogin, upload.single('file'), async (req, res) => {
  try {
    const wb = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let count = 0;
    for (let row of data) {
      if (row.name && row.class && row.school_type) {
        await pool.query('INSERT INTO students (name, class, school_type, parent_phone, gender, dob, admission_no, address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [row.name, row.class, row.school_type, row.parent_phone || null, row.gender || null, row.dob || null, row.admission_no || null, row.address || null, row.balance || 0]);
        count++;
      }
    }
    await logAction(req.session.username, 'STUDENT_BULK_IMPORT', { count });
    res.send(`Successfully imported ${count} students. <a href="/admin/students">View Students</a>`);
  } catch (err) {
    res.status(500).send('Import error: ' + err.message);
  }
});

// === PAYMENTS ===
app.get('/admin/payments', requireLogin, async (req, res) => {
  const payments = await pool.query('SELECT p.*, s.name as student_name, s.class FROM payments p JOIN students s ON p.student_id = s.id ORDER BY p.created_at DESC LIMIT 200');
  res.send(`<!DOCTYPE html><html><head><title>Payments</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>💰 Payments</h1><a href="/admin" class="btn">← Dashboard</a> <a href="/admin/payments/add" class="btn" style="background:#27ae60">+ Record Payment</a></div>
    <div class="card"><table><tr><th>Date</th><th>Receipt</th><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>Term</th></tr>
      ${payments.rows.map(p => `<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>${p.receipt_no}</td><td>${p.student_name}</td><td>${p.class}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.term}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT id, name, class FROM students ORDER BY class, name');
  const selected = req.query.student_id || '';
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>Record Payment</h1><a href="/admin/payments" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/payments/add">
      <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}" ${s.id == selected? 'selected' : ''}>${s.name} - ${s.class}</option>`).join('')}</select>
      <input name="amount" type="number" step="0.01" placeholder="Amount (UGX)" required>
      <select name="method" required><option value="">Payment Method</option><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>Cheque</option></select>
      <select name="term" required><option value="">Term</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
      <input name="receipt_no" placeholder="Receipt Number (optional)">
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Save Payment</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/payments/add', requireLogin, async (req, res) => {
  const { student_id, amount, method, term, receipt_no } = req.body;
  const receipt = receipt_no || 'RCP' + Date.now();
  await pool.query('INSERT INTO payments (student_id, amount, method, term, receipt_no) VALUES ($1, $2, $3, $4, $5)', [student_id, amount, method, term, receipt]);
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);

  const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
  const s = student.rows[0];
  if (s.parent_phone) {
    await sendSMS(s.parent_phone, `Payment received: UGX ${Number(amount).toLocaleString()} for ${s.name}, ${term}. Receipt: ${receipt}. Balance: UGX ${Number(s.balance - amount).toLocaleString()}. Thank you.`);
  }

  const impact = amount * 0.01;
  await pool.query('UPDATE admin_wallet SET balance = balance + $1 WHERE id = 1', [impact]);
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)', ['IMPACT' + Date.now(), impact, s.parent_phone || 'N/A', 'completed', 'impact_fund', 'MTN']);

  if (s.parent_phone) {
    await sendSMS(s.parent_phone, `MTN MoMo Impact Fund: UGX ${impact.toFixed(0)} from your payment supports school projects. Thank you!`);
    if (process.env.ADMIN_PHONE) await sendSMS(process.env.ADMIN_PHONE, `Impact Fund Alert: UGX ${impact.toFixed(0)} received from ${s.name} payment. Total fund updated.`);
  }

  await logAction(req.session.username, 'PAYMENT_RECORD', { student_id, amount, receipt });
  res.redirect('/admin/payments');
});

// === MOBILE MONEY ===
app.get('/admin/mobile-money', requireLogin, requireRole(['admin']), async (req, res) => {
  const transactions = await pool.query('SELECT * FROM momo_transactions ORDER BY created_at DESC LIMIT 100');
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  res.send(`<!DOCTYPE html><html><head><title>Mobile Money</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center;font-size:24px}select,input,button{padding:10px;margin:5px;width:100%;box-sizing:border-box}</style>
  </head><body>
    <div class="card"><h1>📱 Mobile Money - Impact Fund</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><div class="stat"><strong>Impact Fund Balance</strong><br>UGX ${Number(balance.rows[0]?.balance || 0).toLocaleString()}</div></div>
    <div class="card"><h3>Withdraw Funds</h3><form method="POST" action="/admin/mobile-money/withdraw">
      <select name="provider" required><option value="">Select Provider</option><option value="MTN">MTN MoMo</option><option value="AIRTEL">Airtel Money</option><option value="MPESA">M-Pesa</option></select>
      <input name="amount" type="number" placeholder="Amount" max="${balance.rows[0]?.balance || 0}" required>
      <input name="phone" placeholder="Phone: 0772123456" required>
      <button type="submit" class="btn" style="background:#27ae60">Withdraw</button>
    </form></div>
    <div class="card"><h3>Transactions</h3><table><tr><th>Date</th><th>ID</th><th>Provider</th><th>Phone</th><th>Amount</th><th>Type</th><th>Status</th></tr>
      ${transactions.rows.map(t => `<tr><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${t.transaction_id}</td><td>${t.provider || 'MTN'}</td><td>${t.phone}</td><td>${Number(t.amount).toLocaleString()}</td><td>${t.type}</td><td>${t.status}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/mobile-money/withdraw', requireLogin, requireRole(['admin']), async (req, res) => {
  const { amount, phone, provider } = req.body;
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (Number(amount) > balance.rows[0].balance) return res.status(400).send('Insufficient balance');
  const transaction_id = provider + Date.now();
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)', [transaction_id, amount, phone, 'pending', 'withdrawal', provider]);
  await pool.query('UPDATE admin_wallet SET balance = balance - $1 WHERE id = 1', [amount]);
  await logAction(req.session.username, `${provider}_WITHDRAW`, { amount, phone });
  res.send(`${provider} withdrawal initiated: UGX ${Number(amount).toLocaleString()} to ${phone}. <a href="/admin/mobile-money">Back</a>`);
});

// === ATTENDANCE ===
app.get('/admin/attendance', requireLogin, async (req, res) => {
  const classes = await pool.query('SELECT DISTINCT class FROM students ORDER BY class');
  res.send(`<!DOCTYPE html><html><head><title>Attendance</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>📅 Attendance Register</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Select Class & Date</h3><form method="GET" action="/admin/attendance/register">
      <select name="class" required><option value="">Select Class</option>${classes.rows.map(c => `<option>${c.class}</option>`).join('')}</select>
      <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
      <button type="submit" class="btn">Open Register</button>
    </form></div>
  </body></html>`);
});

app.get('/admin/attendance/register', requireLogin, async (req, res) => {
  const { class: cls, date } = req.query;
  const students = await pool.query('SELECT s.*, a.status FROM students s LEFT JOIN attendance a ON s.id = a.student_id AND a.date = $1 WHERE s.class = $2 ORDER BY s.name', [date, cls]);
  res.send(`<!DOCTYPE html><html><head><title>Attendance - ${cls}</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}select{padding:5px}</style>
  </head><body>
    <div class="card"><h1>Attendance: ${cls} - ${date}</h1><a href="/admin/attendance" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/attendance/save">
      <input type="hidden" name="date" value="${date}">
      <input type="hidden" name="class" value="${cls}">
      <table><tr><th>Student</th><th>Status</th></tr>
        ${students.rows.map(s => `<tr><td>${s.name}</td><td><select name="status_${s.id}"><option value="present" ${s.status === 'present'? 'selected' : ''}>Present</option><option value="absent" ${s.status === 'absent'? 'selected' : ''}>Absent</option><option value="late" ${s.status === 'late'? 'selected' : ''}>Late</option><option value="sick" ${s.status === 'sick'? 'selected' : ''}>Sick</option></select></td></tr>`).join('')}
      </table><br><button type="submit" class="btn" style="background:#27ae60">Save Attendance</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/attendance/save', requireLogin, async (req, res) => {
  const { date, class: cls } = req.body;
  for (let key in req.body) {
    if (key.startsWith('status_')) {
      const student_id = key.split('_')[1];
      await pool.query('INSERT INTO attendance (student_id, date, status) VALUES ($1, $2, $3) ON CONFLICT (student_id, date) DO UPDATE SET status = $3', [student_id, date, req.body[key]]);
    }
  }
  await logAction(req.session.username, 'ATTENDANCE_SAVE', { class: cls, date });
  res.send(`Attendance saved for ${cls} - ${date}. <a href="/admin/attendance">Back</a>`);
});

// === LIBRARY ===
app.get('/admin/library', requireLogin, async (req, res) => {
  const books = await pool.query('SELECT * FROM library_books ORDER BY title');
  const loans = await pool.query('SELECT ll.*, lb.title, s.name as student_name FROM library_loans ll JOIN library_books lb ON ll.book_id = lb.id JOIN students s ON ll.student_id = s.id WHERE ll.returned_date IS NULL');
  res.send(`<!DOCTYPE html><html><head><title>Library</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input{padding:8px;margin:5px}</style>
  </head><body>
    <div class="card"><h1>📖 Library Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Add Book</h3><form method="POST" action="/admin/library/add">
      <input name="title" placeholder="Book Title" required><input name="author" placeholder="Author"><input name="isbn" placeholder="ISBN">
      <button type="submit" class="btn" style="background:#27ae60">Add Book</button>
    </form></div>
    <div class="card"><h3>All Books</h3><table><tr><th>Title</th><th>Author</th><th>ISBN</th><th>Status</th><th>Action</th></tr>
      ${books.rows.map(b => `<tr><td>${b.title}</td><td>${b.author || '-'}</td><td>${b.isbn || '-'}</td><td>${b.available? 'Available' : 'On Loan'}</td><td>${b.available? `<a href="/admin/library/loan/${b.id}" class="btn">Loan Out</a>` : '-'}</td></tr>`).join('')}
    </table></div>
    <div class="card"><h3>Active Loans</h3><table><tr><th>Book</th><th>Student</th><th>Borrowed</th><th>Action</th></tr>
      ${loans.rows.map(l => `<tr><td>${l.title}</td><td>${l.student_name}</td><td>${new Date(l.borrowed_date).toLocaleDateString()}</td><td><a href="/admin/library/return/${l.id}" class="btn" style="background:#27ae60">Return</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/library/add', requireLogin, async (req, res) => {
  const { title, author, isbn } = req.body;
  await pool.query('INSERT INTO library_books (title, author, isbn) VALUES ($1, $2, $3)', [title, author, isbn]);
  res.redirect('/admin/library');
});

app.get('/admin/library/loan/:bookId', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT id, name, class FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Loan Book</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box}</style>
  </head><body>
    <div class="card"><h1>Loan Book</h1><a href="/admin/library" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/library/loan">
      <input type="hidden" name="book_id" value="${req.params.bookId}">
      <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class}</option>`).join('')}</select>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Confirm Loan</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/library/loan', requireLogin, async (req, res) => {
  const { book_id, student_id } = req.body;
  await pool.query('INSERT INTO library_loans (book_id, student_id, borrowed_date) VALUES ($1, $2, CURRENT_DATE)', [book_id, student_id]);
  await pool.query('UPDATE library_books SET available = false WHERE id = $1', [book_id]);
  res.redirect('/admin/library');
});

app.get('/admin/library/return/:loanId', requireLogin, async (req, res) => {
  const loan = await pool.query('SELECT book_id FROM library_loans WHERE id = $1', [req.params.loanId]);
  await pool.query('UPDATE library_loans SET returned_date = CURRENT_DATE WHERE id = $1', [req.params.loanId]);
  await pool.query('UPDATE library_books SET available = true WHERE id = $1', [loan.rows[0].book_id]);
  res.redirect('/admin/library');
});

// === DONORS, ASSETS, STAFF, USERS, TASKS, LOGS ===
// Add remaining modules here following same pattern...
// === DONORS ===
app.get('/admin/donors', requireLogin, requireRole(['admin']), async (req, res) => {
  const donors = await pool.query('SELECT * FROM donors ORDER BY date DESC');
  const total = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM donors');
  res.send(`<!DOCTYPE html><html><head><title>Donors</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center;font-size:24px}input,textarea{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>🎁 Donor Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><div class="stat"><strong>Total Donations</strong><br>UGX ${Number(total.rows[0].total).toLocaleString()}</div></div>
    <div class="card"><h3>Record Donation</h3><form method="POST" action="/admin/donors/add">
      <input name="name" placeholder="Donor Name" required>
      <input name="amount" type="number" step="0.01" placeholder="Amount (UGX)" required>
      <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
      <textarea name="purpose" placeholder="Purpose/Project" rows="3"></textarea>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Record Donation</button>
    </form></div>
    <div class="card"><h3>Donation History</h3><table><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Purpose</th></tr>
      ${donors.rows.map(d => `<tr><td>${new Date(d.date).toLocaleDateString()}</td><td>${d.name}</td><td>UGX ${Number(d.amount).toLocaleString()}</td><td>${d.purpose || '-'}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/donors/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, amount, date, purpose } = req.body;
  await pool.query('INSERT INTO donors (name, amount, date, purpose) VALUES ($1, $2, $3, $4)', [name, amount, date, purpose]);
  await pool.query('UPDATE admin_wallet SET balance = balance + $1 WHERE id = 1', [amount]);
  await logAction(req.session.username, 'DONOR_ADD', { name, amount });
  res.redirect('/admin/donors');
});

// === ASSETS ===
app.get('/admin/assets', requireLogin, requireRole(['admin']), async (req, res) => {
  const assets = await pool.query('SELECT * FROM assets ORDER BY name');
  const total = await pool.query('SELECT COALESCE(SUM(value), 0) as total FROM assets');
  res.send(`<!DOCTYPE html><html><head><title>Assets</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center;font-size:24px}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>🏢 Asset Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><div class="stat"><strong>Total Asset Value</strong><br>UGX ${Number(total.rows[0].total).toLocaleString()}</div></div>
    <div class="card"><h3>Register Asset</h3><form method="POST" action="/admin/assets/add">
      <input name="name" placeholder="Asset Name" required>
      <input name="value" type="number" step="0.01" placeholder="Value (UGX)" required>
      <input name="location" placeholder="Location" required>
      <select name="condition" required><option value="">Condition</option><option>Excellent</option><option>Good</option><option>Fair</option><option>Poor</option></select>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Register Asset</button>
    </form></div>
    <div class="card"><h3>Asset Inventory</h3><table><tr><th>Name</th><th>Value</th><th>Location</th><th>Condition</th><th>Date Added</th></tr>
      ${assets.rows.map(a => `<tr><td>${a.name}</td><td>UGX ${Number(a.value).toLocaleString()}</td><td>${a.location}</td><td>${a.condition}</td><td>${new Date(a.created_at).toLocaleDateString()}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/assets/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, value, location, condition } = req.body;
  await pool.query('INSERT INTO assets (name, value, location, condition) VALUES ($1, $2, $3, $4)', [name, value, location, condition]);
  await logAction(req.session.username, 'ASSET_ADD', { name, value });
  res.redirect('/admin/assets');
});

// === STAFF & PAYROLL ===
app.get('/admin/staff', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff ORDER BY name');
  const payroll = await pool.query('SELECT p.*, s.name as staff_name FROM payroll p JOIN staff s ON p.staff_id = s.id ORDER BY p.year DESC, p.month DESC LIMIT 50');
  res.send(`<!DOCTYPE html><html><head><title>Staff & Payroll</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>👥 Staff & Payroll</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Add Staff</h3><form method="POST" action="/admin/staff/add">
      <input name="name" placeholder="Full Name" required>
      <input name="role" placeholder="Role (e.g. Teacher, Bursar)" required>
      <input name="salary" type="number" step="0.01" placeholder="Monthly Salary (UGX)" required>
      <input name="phone" placeholder="Phone: 0772123456" required>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Add Staff</button>
    </form></div>
    <div class="card"><h3>Staff List</h3><table><tr><th>Name</th><th>Role</th><th>Salary</th><th>Phone</th><th>Action</th></tr>
      ${staff.rows.map(s => `<tr><td>${s.name}</td><td>${s.role}</td><td>UGX ${Number(s.salary).toLocaleString()}</td><td>${s.phone}</td><td><a href="/admin/payroll/pay/${s.id}" class="btn">Pay Salary</a></td></tr>`).join('')}
    </table></div>
    <div class="card"><h3>Recent Payroll</h3><table><tr><th>Date</th><th>Staff</th><th>Amount</th><th>Month</th></tr>
      ${payroll.rows.map(p => `<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>${p.staff_name}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.month} ${p.year}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/staff/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { name, role, salary, phone } = req.body;
  await pool.query('INSERT INTO staff (name, role, salary, phone) VALUES ($1, $2, $3, $4)', [name, role, salary, phone]);
  await logAction(req.session.username, 'STAFF_ADD', { name, role });
  res.redirect('/admin/staff');
});

app.get('/admin/payroll/pay/:staffId', requireLogin, requireRole(['admin']), async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff WHERE id = $1', [req.params.staffId]);
  const s = staff.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Pay Salary</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>Pay Salary: ${s.name}</h1><a href="/admin/staff" class="btn">← Back</a></div>
    <div class="card"><form method="POST" action="/admin/payroll/pay">
      <input type="hidden" name="staff_id" value="${s.id}">
      <p>Role: ${s.role}</p>
      <p>Standard Salary: UGX ${Number(s.salary).toLocaleString()}</p>
      <input name="amount" type="number" step="0.01" value="${s.salary}" required>
      <select name="month" required><option value="">Select Month</option><option>January</option><option>February</option><option>March</option><option>April</option><option>May</option><option>June</option><option>July</option><option>August</option><option>September</option><option>October</option><option>November</option><option>December</option></select>
      <input name="year" type="number" value="${new Date().getFullYear()}" required>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Confirm Payment</button>
    </form></div>
  </body></html>`);
});

app.post('/admin/payroll/pay', requireLogin, requireRole(['admin']), async (req, res) => {
  const { staff_id, amount, month, year } = req.body;
  await pool.query('INSERT INTO payroll (staff_id, amount, month, year) VALUES ($1, $2, $3, $4)', [staff_id, amount, month, year]);
  const staff = await pool.query('SELECT name, phone FROM staff WHERE id = $1', [staff_id]);
  await sendSMS(staff.rows[0].phone, `Salary paid: UGX ${Number(amount).toLocaleString()} for ${month} ${year}. Thank you for your service.`);
  await logAction(req.session.username, 'PAYROLL_PAY', { staff_id, amount, month, year });
  res.redirect('/admin/staff');
});

// === USER MANAGEMENT ===
app.get('/admin/users', requireLogin, requireRole(['admin']), async (req, res) => {
  const users = await pool.query('SELECT id, username, role, full_name, created_at FROM users ORDER BY created_at DESC');
  res.send(`<!DOCTYPE html><html><head><title>User Management</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>👤 User Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><h3>Create User</h3><form method="POST" action="/admin/users/add">
      <input name="username" placeholder="Username" required>
      <input name="password" type="password" placeholder="Password" required>
      <input name="full_name" placeholder="Full Name" required>
      <select name="role" required><option value="">Select Role</option><option>admin</option><option>bursar</option><option>teacher</option><option>librarian</option></select>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Create User</button>
    </form></div>
    <div class="card"><h3>All Users</h3><table><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Created</th></tr>
      ${users.rows.map(u => `<tr><td>${u.username}</td><td>${u.full_name}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleDateString()}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { username, password, full_name, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (username, password, role, full_name) VALUES ($1, $2, $3, $4)', [username, hash, role, full_name]);
  await logAction(req.session.username, 'USER_CREATE', { username, role });
  res.redirect('/admin/users');
});

// === TASKS ===
app.get('/admin/tasks', requireLogin, async (req, res) => {
  const tasks = req.session.role === 'admin'
   ? await pool.query('SELECT t.*, u.username FROM tasks t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC')
    : await pool.query('SELECT t.*, u.username FROM tasks t JOIN users u ON t.user_id = u.id WHERE t.user_id = $1 ORDER BY t.created_at DESC', [req.session.userId]);
  const users = await pool.query('SELECT id, username, role FROM users WHERE role!= $1', ['admin']);
  res.send(`<!DOCTYPE html><html><head><title>Task Assignment</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input,select,textarea{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.badge{padding:5px 10px;border-radius:4px;color:white}.pending{background:#f39c12}.completed{background:#27ae60}</style>
  </head><body>
    <div class="card"><h1>✅ Task Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    ${req.session.role === 'admin'? `<div class="card"><h3>Assign Task</h3><form method="POST" action="/admin/tasks/assign">
      <select name="user_id" required><option value="">Select User</option>${users.rows.map(u => `<option value="${u.id}">${u.username} (${u.role})</option>`).join('')}</select>
      <textarea name="task" placeholder="Task description" rows="3" required></textarea>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Assign Task</button>
    </form></div>` : ''}
    <div class="card"><h3>Tasks</h3><table><tr><th>User</th><th>Task</th><th>Status</th><th>Date</th><th>Action</th></tr>
      ${tasks.rows.map(t => `<tr><td>${t.username}</td><td>${t.task}</td><td><span class="badge ${t.status}">${t.status}</span></td><td>${new Date(t.created_at).toLocaleDateString()}</td><td>${t.status === 'pending' && (t.user_id === req.session.userId || req.session.role === 'admin')? `<a href="/admin/tasks/complete/${t.id}" class="btn" style="background:#27ae60">Complete</a>` : '-'}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/tasks/assign', requireLogin, requireRole(['admin']), async (req, res) => {
  const { user_id, task } = req.body;
  await pool.query('INSERT INTO tasks (user_id, task) VALUES ($1, $2)', [user_id, task]);
  await logAction(req.session.username, 'TASK_ASSIGN', { user_id, task });
  res.redirect('/admin/tasks');
});

app.get('/admin/tasks/complete/:id', requireLogin, async (req, res) => {
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', req.params.id]);
  await logAction(req.session.username, 'TASK_COMPLETE', { task_id: req.params.id });
  res.redirect('/admin/tasks');
});

// === AUDIT LOGS ===
app.get('/admin/logs', requireLogin, requireRole(['admin']), async (req, res) => {
  const logs = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
  res.send(`<!DOCTYPE html><html><head><title>Audit Logs</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#16a085;color:white}pre{margin:0;font-size:12px}</style>
  </head><body>
    <div class="card"><h1>📋 Audit Logs</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><table><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>
      ${logs.rows.map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.username}</td><td>${l.action}</td><td><pre>${JSON.stringify(l.details, null, 2)}</pre></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});
// === PUBLIC WEBSITE ===
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>SSE Wasswa Foundation</title><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#667eea">
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.hero{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:80px 20px;text-align:center}.hero h1{font-size:48px;margin:0}.hero p{font-size:20px}.container{max-width:1200px;margin:40px auto;padding:0 20px}.card{background:white;padding:30px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.btn{background:#27ae60;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;display:inline-block;margin:10px;font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.nav{background:#2c3e50;padding:15px;text-align:center}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/about">About</a><a href="/parent/login">Parent Portal</a><a href="/login">Staff Login</a></div>
    <div class="hero"><h1>SSE Wasswa Foundation</h1><p>Empowering Education Through Technology & Community</p><a href="/donate" class="btn">Donate Now</a><a href="/parent/login" class="btn" style="background:#3498db">Parent Portal</a></div>
    <div class="container">
      <div class="grid">
        <div class="card"><h2>🎓 Our Schools</h2><p>Nursery, Primary, Secondary & University programs serving 500+ students across Kampala.</p></div>
        <div class="card"><h2>💚 Impact Fund</h2><p>1% of every fee payment goes to community projects. 100% transparent tracking.</p><a href="/donate" class="btn">Support Us</a></div>
        <div class="card"><h2>📱 Digital First</h2><p>Real-time results, mobile payments, SMS alerts. Parents stay connected 24/7.</p></div>
      </div>
    </div>
  </body></html>`);
});

app.get('/about', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>About Us</title>
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.container{max-width:900px;margin:40px auto;padding:0 20px}.card{background:white;padding:30px;border-radius:8px}.nav{background:#2c3e50;padding:15px;text-align:center}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}.btn{background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/about">About</a><a href="/parent/login">Parent Portal</a></div>
    <div class="container"><div class="card"><h1>About SSE Wasswa Foundation</h1><p>Founded to bridge the digital divide in Ugandan education.</p><h3>Our Mission</h3><p>Provide quality education with modern technology, transparent finance, and community impact.</p><h3>Impact Fund</h3><p>Every school fee contributes 1% to our Impact Fund, supporting local community projects. Track every shilling.</p><a href="/donate" class="btn">Support Our Mission</a></div></div>
  </body></html>`);
});

app.get('/donate', async (req, res) => {
  const fund = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  const recent = await pool.query('SELECT * FROM donors ORDER BY date DESC LIMIT 10');
  res.send(`<!DOCTYPE html><html><head><title>Donate</title>
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.container{max-width:900px;margin:40px auto;padding:0 20px}.card{background:white;padding:30px;border-radius:8px;margin-bottom:20px}.nav{background:#2c3e50;padding:15px;text-align:center}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}.stat{background:#27ae60;color:white;padding:30px;border-radius:8px;text-align:center;font-size:32px;margin-bottom:20px}input,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.btn{background:#27ae60;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;border:none;cursor:pointer;width:100%;font-size:18px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/about">About</a><a href="/parent/login">Parent Portal</a></div>
    <div class="container">
      <div class="stat"><strong>Impact Fund Total</strong><br>UGX ${Number(fund.rows[0]?.balance || 0).toLocaleString()}</div>
      <div class="card"><h1>💚 Donate to SSE Wasswa</h1><p>Your donation directly supports students, infrastructure, and community projects. 100% transparent.</p>
        <form method="POST" action="/donate/submit">
          <input name="name" placeholder="Your Name" required>
          <input name="amount" type="number" placeholder="Amount (UGX)" required>
          <textarea name="purpose" placeholder="Purpose (optional)" rows="3"></textarea>
          <input name="phone" placeholder="Phone for receipt: 0772123456" required>
          <button type="submit" class="btn">Donate via Mobile Money</button>
        </form>
        <p><small>After submitting, our team will contact you with payment instructions. For instant donation, visit our office.</small></p>
      </div>
      <div class="card"><h3>Recent Donors - Thank You!</h3><table><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Purpose</th></tr>
        ${recent.rows.map(d => `<tr><td>${new Date(d.date).toLocaleDateString()}</td><td>${d.name}</td><td>UGX ${Number(d.amount).toLocaleString()}</td><td>${d.purpose || 'General Fund'}</td></tr>`).join('')}
      </table></div>
    </div>
  </body></html>`);
});

app.post('/donate/submit', async (req, res) => {
  const { name, amount, purpose, phone } = req.body;
  await pool.query('INSERT INTO donors (name, amount, date, purpose) VALUES ($1, $2, CURRENT_DATE, $3)', [name, amount, purpose]);
  await pool.query('UPDATE admin_wallet SET balance = balance + $1 WHERE id = 1', [amount]);
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)', ['DONATION' + Date.now(), amount, phone, 'pending', 'donation', 'MANUAL']);
  await sendSMS(phone, `Thank you ${name}! Donation of UGX ${Number(amount).toLocaleString()} received. Our team will contact you. SSE Wasswa Foundation.`);
  if (process.env.ADMIN_PHONE) await sendSMS(process.env.ADMIN_PHONE, `New donation: UGX ${amount} from ${name}, Phone: ${phone}. Purpose: ${purpose || 'General'}`);
  res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h1>Thank You, ${name}!</h1><p>Your donation of UGX ${Number(amount).toLocaleString()} is recorded.</p><p>Our team will contact you at ${phone} with payment instructions.</p><a href="/" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back to Home</a></div>`);
});

// === MANUAL MOBILE MONEY SETTINGS ===
app.get('/admin/mobile-money/settings', requireLogin, requireRole(['admin']), async (req, res) => {
  const settings = await pool.query(`SELECT * FROM app_settings WHERE key LIKE 'momo_%'`);
  const s = {};
  settings.rows.forEach(row => s[row.key] = row.value);
  res.send(`<!DOCTYPE html><html><head><title>MoMo Settings</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}label{display:block;margin:15px 0;font-weight:bold}input[type="checkbox"]{width:20px;height:20px}select,input{width:100%;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="card"><h1>⚙️ Mobile Money Settings</h1><a href="/admin/mobile-money" class="btn">← Back to MoMo</a></div>
    <div class="card"><form method="POST" action="/admin/mobile-money/settings">
      <label><input type="checkbox" name="momo_mtn_enabled" ${s.momo_mtn_enabled === 'true'? 'checked' : ''}> Enable MTN MoMo</label>
      <label><input type="checkbox" name="momo_airtel_enabled" ${s.momo_airtel_enabled === 'true'? 'checked' : ''}> Enable Airtel Money</label>
      <label><input type="checkbox" name="momo_mpesa_enabled" ${s.momo_mpesa_enabled === 'true'? 'checked' : ''}> Enable M-Pesa</label>
      <label>Mode: <select name="momo_mode"><option value="manual" ${s.momo_mode === 'manual'? 'selected' : ''}>Manual - Admin confirms payments</option><option value="auto" ${s.momo_mode === 'auto'? 'selected' : ''}>Auto - Live API</option></select></label>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Save Settings</button>
    </form></div>
    <div class="card"><p><strong>Manual Mode:</strong> Withdrawals are logged as 'pending'. You process them manually via *165# or app, then mark complete in transactions.</p></div>
  </body></html>`);
});

app.post('/admin/mobile-money/withdraw', requireLogin, requireRole(['admin']), async (req, res) => {
  const { amount, phone, provider } = req.body;
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (Number(amount) > balance.rows[0].balance) return res.status(400).send('Insufficient balance');

  const settings = await pool.query(`SELECT value FROM app_settings WHERE key = 'momo_mode'`);
  const mode = settings.rows[0]?.value || 'manual';

  const transaction_id = provider + Date.now();
  const status = mode === 'manual'? 'pending_manual' : 'pending';
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)', [transaction_id, amount, phone, status, 'withdrawal', provider]);
  await pool.query('UPDATE admin_wallet SET balance = balance - $1 WHERE id = 1', [amount]);
  await logAction(req.session.username, `${provider}_WITHDRAW`, { amount, phone, mode });

  if (mode === 'manual') {
    res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px"><h2>Manual Withdrawal Logged</h2><p><strong>Provider:</strong> ${provider}</p><p><strong>Amount:</strong> UGX ${Number(amount).toLocaleString()}</p><p><strong>Phone:</strong> ${phone}</p><p><strong>ID:</strong> ${transaction_id}</p><p>Now process this manually via *165# or ${provider} app, then mark as complete in transactions.</p><a href="/admin/mobile-money" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back</a></div>`);
  } else {
    res.send(`${provider} API withdrawal initiated. <a href="/admin/mobile-money">Back</a>`);
  }
});
// Update withdrawal to check mode
app.post('/admin/mobile-money/withdraw', requireLogin, requireRole(['admin']), async (req, res) => {
  const { amount, phone, provider } = req.body;
  const balance = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  if (Number(amount) > balance.rows[0].balance) return res.status(400).send('Insufficient balance');

  const settings = await pool.query(`SELECT value FROM app_settings WHERE key = 'momo_mode'`);
  const mode = settings.rows[0]?.value || 'manual';

  const transaction_id = provider + Date.now();
  const status = mode === 'manual'? 'pending_manual' : 'pending';
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)', [transaction_id, amount, phone, status, 'withdrawal', provider]);
  await pool.query('UPDATE admin_wallet SET balance = balance - $1 WHERE id = 1', [amount]);
  await logAction(req.session.username, `${provider}_WITHDRAW`, { amount, phone, mode });

  if (mode === 'manual') {
    res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px"><h2>Manual Withdrawal Logged</h2><p><strong>Provider:</strong> ${provider}</p><p><strong>Amount:</strong> UGX ${Number(amount).toLocaleString()}</p><p><strong>Phone:</strong> ${phone}</p><p><strong>ID:</strong> ${transaction_id}</p><p>Now process this manually via *165# or ${provider} app, then mark as complete in transactions.</p><a href="/admin/mobile-money" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back</a></div>`);
  } else {
    res.send(`${provider} API withdrawal initiated. <a href="/admin/mobile-money">Back</a>`);
  }
});
// === PAST PAPERS SHOP ===
app.get('/papers', async (req, res) => {
  const papers = await pool.query('SELECT * FROM past_papers WHERE active = true ORDER BY class, subject, year DESC');
  res.send(`<!DOCTYPE html><html><head><title>Past Papers</title>
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.container{max-width:1200px;margin:40px auto;padding:0 20px}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.nav{background:#2c3e50;padding:15px;text-align:center}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}.btn{background:#27ae60;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.paper{border:1px solid #ddd;padding:15px;border-radius:4px}input{width:100%;padding:10px;margin:5px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/papers">Past Papers</a><a href="/about">About</a><a href="/parent/login">Parent Portal</a></div>
    <div class="container">
      <div class="card"><h1>📄 Past Papers Shop</h1><p>Download UNEB & Internal past papers. Instant PDF after payment.</p></div>
      <div class="grid">
        ${papers.rows.map(p => `<div class="paper"><h3>${p.subject} - ${p.class}</h3><p>Year: ${p.year} | ${p.type}</p><p><strong>UGX ${Number(p.price).toLocaleString()}</strong></p><form method="POST" action="/papers/buy/${p.id}"><input name="phone" placeholder="MTN/Airtel: 0772123456" required><button type="submit" class="btn">Buy & Download</button></form></div>`).join('')}
      </div>
    </div>
  </body></html>`);
});

app.post('/papers/buy/:id', async (req, res) => {
  const { phone } = req.body;
  const paper = await pool.query('SELECT * FROM past_papers WHERE id = $1', [req.params.id]);
  if (!paper.rows[0]) return res.status(404).send('Paper not found');
  const p = paper.rows[0];

  // Log sale as pending_manual
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)',
    ['PAPER' + Date.now(), p.price, phone, 'pending_manual', 'paper_sale', 'MANUAL']);

  await sendSMS(phone, `SSE Wasswa: To download ${p.subject} ${p.year}, pay UGX ${Number(p.price).toLocaleString()} to 077XXXXXXX. Send receipt to activate download.`);

  res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h2>Order Received</h2><p><strong>${p.subject} - ${p.class} ${p.year}</strong></p><p>Amount: UGX ${Number(p.price).toLocaleString()}</p><p>Pay to 077XXXXXXX and send receipt via WhatsApp to get download link.</p><p>We sent instructions to ${phone}</p><a href="/papers" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back to Papers</a></div>`);
});

// === ADMIN: MANAGE PAPERS ===
app.get('/admin/papers', requireLogin, requireRole(['admin']), async (req, res) => {
  const papers = await pool.query('SELECT * FROM past_papers ORDER BY created_at DESC');
  const sales = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM momo_transactions WHERE type = $1', ['paper_sale']);
  res.send(`<!DOCTYPE html><html><head><title>Manage Papers</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}input,select{width:100%;padding:10px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.stat{background:#ecf0f1;padding:20px;border-radius:4px;text-align:center;font-size:24px}</style>
  </head><body>
    <div class="card"><h1>📄 Past Papers Management</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="card"><div class="stat"><strong>Total Sales</strong><br>${sales.rows[0].count} papers | UGX ${Number(sales.rows[0].total).toLocaleString()}</div></div>
    <div class="card"><h3>Upload New Paper</h3><form method="POST" action="/admin/papers/add" enctype="multipart/form-data">
      <select name="class" required><option value="">Class</option><option>P.7</option><option>S.4</option><option>S.6</option></select>
      <input name="subject" placeholder="Subject: Mathematics" required>
      <input name="year" type="number" placeholder="Year: 2023" required>
      <select name="type" required><option value="">Type</option><option>UNEB</option><option>Mock</option><option>Internal</option></select>
      <input name="price" type="number" placeholder="Price UGX: 5000" required>
      <input name="file_url" placeholder="PDF URL or /uploads/paper.pdf" required>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Add Paper</button>
    </form></div>
    <div class="card"><h3>All Papers</h3><table><tr><th>Class</th><th>Subject</th><th>Year</th><th>Type</th><th>Price</th><th>Status</th><th>Action</th></tr>
      ${papers.rows.map(p => `<tr><td>${p.class}</td><td>${p.subject}</td><td>${p.year}</td><td>${p.type}</td><td>${Number(p.price).toLocaleString()}</td><td>${p.active? 'Active' : 'Hidden'}</td><td><a href="/admin/papers/toggle/${p.id}" class="btn">${p.active? 'Hide' : 'Show'}</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/admin/papers/add', requireLogin, requireRole(['admin']), async (req, res) => {
  const { class: cls, subject, year, type, price, file_url } = req.body;
  await pool.query('INSERT INTO past_papers (class, subject, year, type, price, file_url, active) VALUES ($1, $2, $3, $4, $5, $6, true)', [cls, subject, year, type, price, file_url]);
  await logAction(req.session.username, 'PAPER_ADD', { subject, year, price });
  res.redirect('/admin/papers');
});

app.get('/admin/papers/toggle/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  await pool.query('UPDATE past_papers SET active = NOT active WHERE id = $1', [req.params.id]);
  res.redirect('/admin/papers');
});

// === CERTIFICATE/TRANSCRIPT REQUESTS ===
app.get('/certificates', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Certificates</title>
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.container{max-width:700px;margin:40px auto;padding:0 20px}.card{background:white;padding:30px;border-radius:8px}.nav{background:#2c3e50;padding:15px;text-align:center}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}.btn{background:#27ae60;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;border:none;cursor:pointer;width:100%;font-size:18px}input,select,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/papers">Past Papers</a><a href="/certificates">Certificates</a><a href="/parent/login">Parent Portal</a></div>
    <div class="container"><div class="card"><h1>🎓 Request Certificate/Transcript</h1><p>Official transcripts, recommendation letters, certificates. UGX 20,000 per copy.</p>
      <form method="POST" action="/certificates/request">
        <input name="student_name" placeholder="Student Full Name" required>
        <input name="admission_no" placeholder="Admission Number" required>
        <select name="doc_type" required><option value="">Document Type</option><option>Academic Transcript</option><option>Certificate of Completion</option><option>Recommendation Letter</option><option>Transfer Letter</option></select>
        <input name="phone" placeholder="Phone: 0772123456" required>
        <textarea name="notes" placeholder="Special instructions" rows="3"></textarea>
        <button type="submit" class="btn">Request - UGX 20,000</button>
      </form>
    </div></div>
  </body></html>`);
});

app.post('/certificates/request', async (req, res) => {
  const { student_name, admission_no, doc_type, phone, notes } = req.body;
  const amount = 20000;
  await pool.query('INSERT INTO momo_transactions (transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6)',
    ['CERT' + Date.now(), amount, phone, 'pending_manual', 'certificate', 'MANUAL']);
  await sendSMS(phone, `SSE Wasswa: Certificate request for ${student_name} received. Pay UGX ${amount} to 077XXXXXXX. Processing starts after payment.`);
  if (process.env.ADMIN_PHONE) await sendSMS(process.env.ADMIN_PHONE, `New cert request: ${student_name}, ${doc_type}. Phone: ${phone}`);
  res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h2>Request Logged</h2><p>Pay UGX ${amount} to 077XXXXXXX</p><p>Send receipt to activate processing for ${student_name}</p><a href="/" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back Home</a></div>`);
});

// Update dashboard to show new modules
app.get('/admin', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#667eea">
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;padding:20px;max-width:1400px;margin:0 auto}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);text-decoration:none;color:#333;transition:transform 0.2s}.card:hover{transform:translateY(-5px)}.card h3{margin:0 0 10px;color:#667eea}.logout{position:absolute;top:20px;right:20px;color:white;text-decoration:none}</style>
  <script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}</script>
  </head><body>
    <div class="header"><h1>SSE Wasswa ERP</h1><p>Welcome, ${req.session.fullname}</p><a href="/logout" class="logout">Logout</a></div>
    <div class="grid">
      <a href="/admin/students" class="card"><h3>👥 Students</h3><p>Manage student records</p></a>
      <a href="/admin/payments" class="card"><h3>💰 Payments</h3><p>Fee collection & Impact Fund</p></a>
      <a href="/admin/mobile-money" class="card"><h3>📱 Mobile Money</h3><p>MTN/Airtel/M-Pesa</p></a>
      <a href="/admin/papers" class="card"><h3>📄 Past Papers</h3><p>Sell papers - NEW INCOME</p></a>
      <a href="/admin/attendance" class="card"><h3>📅 Attendance</h3><p>Daily registers</p></a>
      <a href="/admin/library" class="card"><h3>📖 Library</h3><p>Book management</p></a>
      <a href="/admin/donors" class="card"><h3>🎁 Donors</h3><p>Donation tracking</p></a>
      <a href="/admin/assets" class="card"><h3>🏢 Assets</h3><p>School property</p></a>
      <a href="/admin/staff" class="card"><h3>👥 Staff & Payroll</h3><p>HR & salaries</p></a>
      <a href="/admin/users" class="card"><h3>👤 Users</h3><p>System access</p></a>
      <a href="/admin/tasks" class="card"><h3>✅ Tasks</h3><p>Assignments</p></a>
      <a href="/admin/logs" class="card"><h3>📋 Audit Logs</h3><p>System activity</p></a>
    </div>
  </body></html>`);
});

// Update public nav to include papers
// Find all instances of <div class="nav"> and add <a href="/papers">Past Papers</a><a href="/certificates">Certificates</a>
// === GOOGLE ADSENSE + MARKETING SUITE ===

// 1. PUBLIC SITE WITH ADSENSE + ANALYTICS
app.get('/', async (req, res) => {
  const fund = await pool.query('SELECT balance FROM admin_wallet WHERE id = 1');
  const donors = await pool.query('SELECT COUNT(*) as count FROM donors');
  const papers = await pool.query('SELECT COUNT(*) as count FROM past_papers WHERE active = true');

  // Log page view for analytics
  await pool.query('INSERT INTO page_views (page, ip_address) VALUES ($1, $2)', ['/', req.ip]).catch(() => {});

  res.send(`<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SSE Wasswa Foundation - Quality Education Kampala</title>
  <meta name="description" content="SSE Wasswa Foundation: Nursery to University education in Kampala. Digital results, mobile payments, Impact Fund community projects. Enroll today.">
  <meta name="keywords" content="schools kampala, nursery kampala, secondary school uganda, past papers uganda, UNEB papers">
  <link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#667eea">

  <!-- Google AdSense - Replace ca-pub-XXXXX with your ID -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>

  <!-- Google Analytics - Replace G-XXXXX -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XXXXXXXXXX');</script>

  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.hero{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:80px 20px;text-align:center}.hero h1{font-size:48px;margin:0}.hero p{font-size:20px}.container{max-width:1200px;margin:40px auto;padding:0 20px}.card{background:white;padding:30px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.btn{background:#27ae60;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;display:inline-block;margin:10px;font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.nav{background:#2c3e50;padding:15px;text-align:center;position:sticky;top:0;z-index:100}.nav a{color:white;margin:0 15px;text-decoration:none;font-weight:bold}.stats{display:flex;justify-content:space-around;text-align:center;background:#ecf0f1;padding:30px;border-radius:8px;margin:20px 0}.stats div h3{font-size:36px;margin:0;color:#667eea}.ad-container{margin:20px 0;text-align:center}.whatsapp{position:fixed;bottom:20px;right:20px;background:#25D366;color:white;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;text-decoration:none;box-shadow:0 4px 8px rgba(0,0,0,0.3);z-index:1000}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/donate">Donate</a><a href="/papers">Past Papers</a><a href="/certificates">Certificates</a><a href="/about">About</a><a href="/parent/login">Parent Portal</a><a href="/login">Staff</a></div>

    <div class="hero"><h1>SSE Wasswa Foundation</h1><p>Empowering Education Through Technology & Community</p><a href="/donate" class="btn">Donate Now</a><a href="/parent/login" class="btn" style="background:#3498db">Parent Portal</a></div>

    <div class="container">
      <div class="stats">
        <div><h3>500+</h3><p>Students</p></div>
        <div><h3>UGX ${Number(fund.rows[0]?.balance || 0).toLocaleString()}</h3><p>Impact Fund</p></div>
        <div><h3>${donors.rows[0].count}+</h3><p>Donors</p></div>
        <div><h3>${papers.rows[0].count}+</h3><p>Past Papers</p></div>
      </div>

      <!-- AdSense Banner Ad -->
      <div class="ad-container">
        <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="1234567890" data-ad-format="auto" data-full-width-responsive="true"></ins>
        <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
      </div>

      <div class="grid">
        <div class="card"><h2>🎓 Our Schools</h2><p>Nursery, Primary, Secondary & University programs. Modern facilities, digital learning, experienced teachers.</p><a href="/about" class="btn">Learn More</a></div>
        <div class="card"><h2>💚 Impact Fund</h2><p>1% of every fee payment goes to community projects. Boreholes, scholarships, health camps. 100% transparent.</p><a href="/donate" class="btn">Support Us</a></div>
        <div class="card"><h2>📄 Past Papers Shop</h2><p>UNEB & Mock papers P.7, S.4, S.6. Instant download after payment. Revise smart.</p><a href="/papers" class="btn">Browse Papers</a></div>
      </div>

      <!-- AdSense In-Article Ad -->
      <div class="ad-container">
        <ins class="adsbygoogle" style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="0987654321"></ins>
        <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
      </div>

      <div class="card"><h2>📧 Join Our Newsletter</h2><p>Get exam tips, scholarship alerts, school updates.</p>
        <form method="POST" action="/newsletter/subscribe" style="display:flex;gap:10px">
          <input name="email" type="email" placeholder="your@email.com" required style="flex:1;padding:12px;border:1px solid #ddd;border-radius:4px">
          <button type="submit" class="btn" style="margin:0">Subscribe</button>
        </form>
      </div>
    </div>

    <!-- WhatsApp Float Button -->
    <a href="https://wa.me/25677XXXXXXX?text=Hello%20SSE%20Wasswa" class="whatsapp" target="_blank">💬</a>
  </body></html>`);
});

// 2. NEWSLETTER LEAD CAPTURE
app.post('/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  await pool.query('INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
  await logAction('PUBLIC', 'NEWSLETTER_SUBSCRIBE', { email });
  res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h2>Subscribed!</h2><p>Check ${email} for confirmation.</p><a href="/" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Back Home</a></div>`);
});

// 3. SEO SITEMAP + ROBOTS
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://ssewasswa-api.onrender.com/</loc><priority>1.0</priority></url>
    <url><loc>https://ssewasswa-api.onrender.com/donate</loc><priority>0.8</priority></url>
    <url><loc>https://ssewasswa-api.onrender.com/papers</loc><priority>0.9</priority></url>
    <url><loc>https://ssewasswa-api.onrender.com/certificates</loc><priority>0.7</priority></url>
    <url><loc>https://ssewasswa-api.onrender.com/about</loc><priority>0.6</priority></url>
  </urlset>`);
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: https://ssewasswa-api.onrender.com/sitemap.xml`);
});

// 4. ADMIN: MARKETING DASHBOARD
app.get('/admin/marketing', requireLogin, requireRole(['admin']), async (req, res) => {
  const views = await pool.query(`SELECT page, COUNT(*) as count FROM page_views WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY page ORDER BY count DESC`);
  const subscribers = await pool.query('SELECT COUNT(*) as count FROM newsletter_subscribers');
  const papers_sales = await pool.query(`SELECT COUNT(*) as count, SUM(amount) as total FROM momo_transactions WHERE type = 'paper_sale' AND created_at > NOW() - INTERVAL '30 days'`);
  const certs = await pool.query(`SELECT COUNT(*) as count, SUM(amount) as total FROM momo_transactions WHERE type = 'certificate' AND created_at > NOW() - INTERVAL '30 days'`);

  res.send(`<!DOCTYPE html><html><head><title>Marketing Dashboard</title>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}.stat{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:30px;border-radius:8px;text-align:center}.stat h3{font-size:42px;margin:0}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:#16a085;color:white}</style>
  </head><body>
    <div class="card"><h1>📊 Marketing Dashboard - 30 Days</h1><a href="/admin" class="btn">← Dashboard</a></div>
    <div class="grid">
      <div class="stat"><h3>${views.rows.reduce((a,b) => a + Number(b.count), 0)}</h3><p>Total Page Views</p></div>
      <div class="stat"><h3>${subscribers.rows[0].count}</h3><p>Newsletter Subscribers</p></div>
      <div class="stat"><h3>UGX ${Number(papers_sales.rows[0].total || 0).toLocaleString()}</h3><p>Paper Sales (${papers_sales.rows[0].count})</p></div>
      <div class="stat"><h3>UGX ${Number(certs.rows[0].total || 0).toLocaleString()}</h3><p>Certificates (${certs.rows[0].count})</p></div>
    </div>
    <div class="card"><h3>Top Pages</h3><table><tr><th>Page</th><th>Views</th></tr>
      ${views.rows.map(v => `<tr><td>${v.page}</td><td>${v.count}</td></tr>`).join('')}
    </table></div>
    <div class="card"><h3>Revenue Streams Setup</h3>
      <p><strong>1. AdSense:</strong> Replace ca-pub-XXXX in server.js with your AdSense ID</p>
      <p><strong>2. Analytics:</strong> Replace G-XXXXX with your GA4 ID</p>
      <p><strong>3. WhatsApp:</strong> Update number in float button: wa.me/25677XXXXXXX</p>
      <p><strong>4. Past Papers:</strong> <a href="/admin/papers">Upload papers now</a></p>
      <p><strong>5. Newsletter:</strong> Export emails: SELECT email FROM newsletter_subscribers</p>
    </div>
  </body></html>`);
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
});

app.get('/manifest.json', (req, res) => {
  res.json({"name":"SSE Wasswa ERP","short_name":"SSE Wasswa","start_url":"/","display":"standalone","background_color":"#667eea","theme_color":"#667eea","icons":[{"src":"/icon-192.png","sizes":"192x192","type":"image/png"}]});
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`self.addEventListener('install', e => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(clients.claim())); self.addEventListener('fetch', e => e.respondWith(fetch(e.request).catch(() => caches.match(e.request))));`);
});

// Keep Render awake
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://ssewasswa-api.onrender.com/health').catch(() => {});
  }, 14 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setTimeout(() => initDB().catch(e => console.log('DB init:', e.message)), 2000);
});
