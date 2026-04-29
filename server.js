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
  const user = req.session.user;
  
  // Redirect class teachers to their class
  if (user.role === 'class_teacher') {
    return res.send(`
      <h1>Welcome ${user.username}</h1>
      <p>Your assigned class: ${user.assigned_class}</p>
      <a href="/admin/class/${user.assigned_class}" style="padding:15px 30px; background:#3498db; color:white; text-decoration:none; border-radius:5px; font-size:18px;">View ${user.assigned_class} Students</a>
      <br><br><a href="/admin/logout">Logout</a>
    `);
  }

  // Admin dashboard
  res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
  <style>body{font-family:Arial;max-width:800px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px 10px 0 0}</style>
  </head><body><div class="card">
    <h1>Admin Dashboard</h1>
    <p>Logged in as: ${user.username} (${user.role})</p>
    <h3>Quick Access by Class:</h3>
    <a href="/admin/class/P1" class="btn">P1</a>
    <a href="/admin/class/P2" class="btn">P2</a>
    <a href="/admin/class/P3" class="btn">P3</a>
    <a href="/admin/class/P4" class="btn">P4</a>
    <a href="/admin/class/P5" class="btn">P5</a>
    <a href="/admin/class/P6" class="btn">P6</a>
    <a href="/admin/class/P7" class="btn">P7</a>
    <br><br>
    <a href="/admin/users/add" class="btn">Create User</a>
    <a href="/admin/students" class="btn">All Students</a>
    <a href="/admin/payments/add" class="btn">Record Payment</a>
    <a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a>
  </div></body></html>`);
});

// CLASS VIEW - ONLY ONE VERSION
// CLASS VIEW - UPGRADED WITH ALL FEATURES
app.get('/admin/class/:className', requireLogin, async (req, res) => {
  const className = req.params.className;
  const user = req.session.user;

  if (user.role === 'class_teacher' && user.assigned_class!== className) {
    return res.status(403).send('Access denied: You can only view your assigned class: ' + user.assigned_class);
  }

  try {
    const students = await pool.query(
      'SELECT * FROM students WHERE class = $1 ORDER BY name',
      [className]
    );

    const totalStudents = students.rows.length;
    const totalBalance = students.rows.reduce((sum, s) => sum + Number(s.balance), 0);
    const totalFees = students.rows.reduce((sum, s) => sum + Number(s.total_fees), 0);

    res.send(`<!DOCTYPE html>
    <html><head><title>${className} - Class View</title>
    <style>
      body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}
     .header{background:white;padding:20px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
     .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin:20px 0}
     .stat-card{background:#3498db;color:white;padding:20px;border-radius:8px}
     .stat-card h3{margin:0 0 10px 0;font-size:14px;opacity:0.9}
     .stat-card.num{font-size:28px;font-weight:bold}
     .controls{background:white;padding:15px;border-radius:8px;margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap}
     .controls input{flex:1;padding:10px;border:1px solid #ddd;border-radius:4px;min-width:200px}
     .btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;font-size:14px}
     .btn-green{background:#27ae60}
     .btn-red{background:#e74c3c}
      table{width:100%;background:white;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
      th{background:#34495e;color:white;padding:12px;text-align:left}
      td{padding:12px;border-bottom:1px solid #eee}
      tr:hover{background:#f8f9fa}
     .balance-zero{color:#27ae60;font-weight:bold}
     .balance-owe{color:#e74c3c;font-weight:bold}
      @media print{
       .no-print{display:none}
        body{background:white}
       .header{box-shadow:none}
      }
    </style>
    </head><body>
      <div class="header no-print">
        <h1>${className} - Class Management</h1>
        <p>Teacher: ${user.username}</p>
        <a href="/admin" class="btn">← Back to Dashboard</a>
        <button onclick="window.print()" class="btn btn-green">🖨️ Print Class List</button>
      </div>

      <div class="stats">
        <div class="stat-card">
          <h3>Total Students</h3>
          <div class="num">${totalStudents}</div>
        </div>
        <div class="stat-card" style="background:#e67e22">
          <h3>Total Fees Expected</h3>
          <div class="num">UGX ${totalFees.toLocaleString()}</div>
        </div>
        <div class="stat-card" style="background:#e74c3c">
          <h3>Total Outstanding</h3>
          <div class="num">UGX ${totalBalance.toLocaleString()}</div>
        </div>
        <div class="stat-card" style="background:#27ae60">
          <h3>Total Collected</h3>
          <div class="num">UGX ${(totalFees - totalBalance).toLocaleString()}</div>
        </div>
      </div>

      <div class="controls no-print">
        <input type="text" id="searchBox" placeholder="🔍 Search student name..." onkeyup="filterTable()">
      </div>

      <table id="studentsTable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Term</th>
            <th>Year</th>
            <th>Total Fees</th>
            <th>Balance</th>
            <th class="no-print">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${students.rows.map(s => `
            <tr>
              <td><strong>${s.name}</strong></td>
              <td>${s.term}</td>
              <td>${s.year}</td>
              <td>UGX ${Number(s.total_fees).toLocaleString()}</td>
              <td class="${s.balance == 0? 'balance-zero' : 'balance-owe'}">
                UGX ${Number(s.balance).toLocaleString()}
              </td>
              <td class="no-print">
                <a href="/admin/payments/add?student_id=${s.id}" class="btn" style="padding:6px 12px;font-size:12px">+ Payment</a>
                <a href="/admin/students/${s.id}" class="btn" style="padding:6px 12px;font-size:12px;background:#95a5a6">View</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <script>
        function filterTable() {
          const input = document.getElementById('searchBox');
          const filter = input.value.toLowerCase();
          const table = document.getElementById('studentsTable');
          const tr = table.getElementsByTagName('tr');

          for (let i = 1; i < tr.length; i++) {
            const td = tr[i].getElementsByTagName('td')[0];
            if (td) {
              const txtValue = td.textContent || td.innerText;
              tr[i].style.display = txtValue.toLowerCase().indexOf(filter) > -1? '' : 'none';
            }
          }
        }
      </script>
    </body></html>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// PAYMENTS ADD - GET WITH PRE-SELECT
app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const preselectedId = req.query.student_id || '';
  const students = await pool.query('SELECT id, name, class, balance FROM students WHERE balance > 0 ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Record Payment</h2><form method="POST" action="/admin/payments/add">
    <select name="student_id" required>
      <option value="">Select Student</option>
      ${students.rows.map(s => `<option value="${s.id}" ${s.id == preselectedId? 'selected' : ''}>${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</option>`).join('')}
    </select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="method" placeholder="Payment Method e.g MTN" required>
    <input name="reference" placeholder="Reference/TxID">
    <button type="submit">Save Payment</button>
  </form><a href="/admin">Back</a></body></html>`);
});

// PAYMENT POST - SAVE PAYMENT
app.post('/admin/payments/add', requireLogin, async (req, res) => {
  try {
    const { student_id, amount, method, reference } = req.body;

    await pool.query(
      'INSERT INTO payments (student_id, amount, method, reference) VALUES ($1, $2, $3, $4)',
      [student_id, amount, method, reference]
    );

    await pool.query(
      'UPDATE students SET balance = balance - $1 WHERE id = $2',
      [amount, student_id]
    );

    await logAction(req.session.user.username, 'PAYMENT_RECORDED', { student_id, amount, method });
    res.redirect('/admin/payments/add?success=1');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// STUDENT DETAIL VIEW
app.get('/admin/students/:id', requireLogin, async (req, res) => {
  try {
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
    if (student.rows.length === 0) return res.status(404).send('Student not found');

    const s = student.rows[0];
    const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.params.id]);

    res.send(`<!DOCTYPE html><html><head><title>${s.name}</title>
    <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}</style>
    </head><body>
      <h1>${s.name} - ${s.class}</h1>
      <p><strong>Term:</strong> ${s.term} ${s.year}</p>
      <p><strong>Total Fees:</strong> UGX ${Number(s.total_fees).toLocaleString()}</p>
      <p><strong>Balance:</strong> UGX ${Number(s.balance).toLocaleString()}</p>
      <h3>Payment History</h3>
      <table>
        <tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
        ${payments.rows.map(p => `<tr><td>${p.payment_date}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.reference || '-'}</td></tr>`).join('')}
      </table>
      <br><a href="/admin/class/${s.class}">Back to ${s.class}</a>
    </body></html>`);
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

// Class Teacher Dashboard
app.get('/admin/my-class', requireLogin, async (req, res) => {
  const user = req.session.user;

  if (user.role!== 'class_teacher' ||!user.assigned_class) {
    return res.redirect('/admin');
  }

  res.redirect(`/admin/class/${user.assigned_class}`);
});
// ADD STUDENT - GET
app.get('/admin/students/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Add Student</h2><form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Name" required>
    <select name="class" required>
      <option value="">Select Class</option>
      <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
      <option value="P4">P4</option><option value="P5">P5</option><option value="P6">P6</option><option value="P7">P7</option>
    </select>
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
    await pool.query(
      'INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1, $2, $3, $4, $5, $5)',
      [name, className, term, year, total_fees]
    );
    await logAction(req.session.user.username, 'STUDENT_CREATED', { name, class: className });
    res.redirect('/admin/class/' + className);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ALL STUDENTS VIEW - missing route for your "All Students" button
app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>All Students</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}</style>
  </head><body><h1>All Students</h1>
  <a href="/admin/students/add" style="background:#27ae60;color:white;padding:10px 15px;text-decoration:none;border-radius:4px">+ Add Student</a>
  <br><br>
  <table><tr><th>Name</th><th>Class</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th></tr>
  ${students.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.term}</td><td>${s.year}</td><td>UGX ${Number(s.total_fees).toLocaleString()}</td><td>UGX ${Number(s.balance).toLocaleString()}</td></tr>`).join('')}
  </table><br><a href="/admin">Back to Dashboard</a></body></html>`);
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});