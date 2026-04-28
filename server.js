const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ========== DATABASE SETUP ==========
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'bursar',
      full_name VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      class VARCHAR(50) DEFAULT 'P.6',
      term VARCHAR(20) DEFAULT 'term1',
      year INTEGER DEFAULT 2025,
      total_fees INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      parent_phone VARCHAR(20),
      parent_name VARCHAR(100),
      is_active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      method VARCHAR(50),
      reference VARCHAR(100),
      payment_date DATE DEFAULT CURRENT_DATE,
      recorded_by INTEGER REFERENCES admins(id),
      sms_sent BOOLEAN DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      number VARCHAR(50),
      account_name VARCHAR(100),
      instructions TEXT
    );
    CREATE TABLE IF NOT EXISTS terms (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      year INTEGER NOT NULL,
      start_date DATE,
      end_date DATE,
      is_current BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add missing columns for existing DBs
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'bursar'`);
  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS full_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS class VARCHAR(50) DEFAULT 'P.6'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS term VARCHAR(20) DEFAULT 'term1'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT 2025`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS total_fees INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(50)`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS recorded_by INTEGER`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS number VARCHAR(50)`);
  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS account_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS instructions TEXT`);

  // Create default term if none exists
  const term = await pool.query('SELECT * FROM terms WHERE is_current = true');
  if (term.rows.length === 0) {
    await pool.query('INSERT INTO terms (name, year, is_current) VALUES ($1, $2, true)', ['Term 1', 2025]);
  }

  // Create default admin accounts
  const admins = await pool.query('SELECT * FROM admins');
  if (admins.rows.length === 0) {
    const hash = await bcrypt.hash('bursar123', 10);
    await pool.query('INSERT INTO admins (username, password, role, full_name) VALUES ($1, $2, $3, $4)', ['bursar', hash, 'bursar', 'School Bursar']);
    await pool.query('INSERT INTO admins (username, password, role, full_name) VALUES ($1, $2, $3, $4)', ['headteacher', hash, 'headteacher', 'Head Teacher']);
  }
  console.log('✅ Database ready');
}
initDB();

const requireLogin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

const requireRole = (roles) => (req, res, next) => {
  if (req.session.adminRole && roles.includes(req.session.adminRole)) return next();
  res.send('Access denied. <a href="/admin">Back</a>');
};

// ========== SMS HELPER - FREE METHOD ==========
async function sendSMS(phone, message) {
  // FREE: Uses Africa's Talking Sandbox or logs to console
  // For production: sign up at africastalking.com for free 10 SMS
  console.log(`SMS to ${phone}: ${message}`);
  // Uncomment below when you have API key:
  // const response = await fetch('https://api.africastalking.com/version1/messaging', {
  // method: 'POST',
  // headers: {'apiKey': process.env.AT_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded'},
  // body: `username=${process.env.AT_USERNAME}&to=${phone}&message=${encodeURIComponent(message)}`
  // });
  return true;
}

// ========== PUBLIC ROUTES ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html><html><head><title>Ssewasswa Primary</title>
    <style>
      body{font-family:Arial;text-align:center;padding-top:100px;background:#f4f6f9}
   .btn{background:#3498db;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;margin:10px;display:inline-block;font-size:18px}
   .btn-green{background:#27ae60}
    </style></head><body>
      <h1>Ssewasswa Primary School</h1>
      <h2>Fees Management System</h2>
      <a href="/admin/login" class="btn">Staff Login</a>
      <a href="/parent" class="btn btn-green">Parent Portal</a>
    </body></html>
  `);
});

app.get('/health', (req, res) => res.json({ status: 'API is running', timestamp: new Date() }));

// ========== AUTH ROUTES ==========
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}</style>
  </head><body><div class="card"><h2>Staff Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form>
  <p style="font-size:12px;color:#666;margin-top:20px">Default: bursar/bursar123 or headteacher/bursar123</p>
  </div></body></html>`);
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  if (result.rows.length && await bcrypt.compare(password, result.rows[0].password)) {
    req.session.adminId = result.rows[0].id;
    req.session.adminRole = result.rows[0].role;
    req.session.adminName = result.rows[0].full_name;
    res.redirect('/admin');
  } else {
    res.send('Invalid login. <a href="/admin/login">Try again</a>');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ========== ADMIN DASHBOARD ==========
app.get('/admin', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'Term 1', year: 2025 };

  const stats = await pool.query(`
    SELECT
      COUNT(*) as total_students,
      COALESCE(SUM(total_fees),0) as total_fees,
      COALESCE(SUM(balance),0) as total_balance,
      COUNT(CASE WHEN balance = 0 THEN 1 END) as fully_paid
    FROM students WHERE is_active = true AND term = $1 AND year = $2
  `, [term.name, term.year]);

  const payStats = await pool.query(`
    SELECT COUNT(*) as total_payments, COALESCE(SUM(p.amount),0) as total_collected
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE s.term = $1 AND s.year = $2
  `, [term.name, term.year]);

  const classData = await pool.query(`
    SELECT class, SUM(balance) as balance, SUM(total_fees - balance) as paid
    FROM students WHERE is_active = true AND term = $1 AND year = $2
    GROUP BY class ORDER BY class
  `, [term.name, term.year]);

  const recentPayments = await pool.query(`
    SELECT p.*, s.name, s.class FROM payments p
    JOIN students s ON p.student_id = s.id
    WHERE s.term = $1 AND s.year = $2
    ORDER BY p.id DESC LIMIT 5
  `, [term.name, term.year]);

  const allStudents = await pool.query('SELECT * FROM students WHERE is_active = true AND term = $1 AND year = $2 ORDER BY id DESC LIMIT 10', [term.name, term.year]);
  const paymentMethods = await pool.query('SELECT * FROM payment_methods');

  const s = stats.rows[0];
  const p = payStats.rows[0];

  res.send(`<!DOCTYPE html><html><head><title>Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body{font-family:Arial;margin:0;background:#f4f6f9;padding:20px}
.container{max-width:1400px;margin:auto}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px}
.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
.card h3{margin:0 0 10px 0;color:#666;font-size:14px;font-weight:normal}
.card.num{font-size:28px;font-weight:bold;color:#2c3e50}
.grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px 5px 0}
.btn-red{background:#e74c3c}.btn-purple{background:#9b59b6}.btn-green{background:#27ae60}.btn-orange{background:#e67e22}
    table{width:100%;background:white;border-collapse:collapse;margin-top:10px}
    th,td{padding:12px;text-align:left;border-bottom:1px solid #eee}
    th{background:#34495e;color:white;font-size:14px}
   .role{padding:4px 8px;background:#3498db;color:white;border-radius:4px;font-size:12px}
  </style></head><body><div class="container">
    <div class="header">
      <div>
        <h1>Ssewasswa Primary - ${req.session.adminName} <span class="role">${req.session.adminRole}</span></h1>
        <p style="color:#666">Current: ${term.name} ${term.year}</p>
      </div>
      <a href="/admin/logout" class="btn btn-red">Logout</a>
    </div>

    <div class="stats">
      <div class="card"><h3>Total Students</h3><div class="num">${s.total_students}</div></div>
      <div class="card"><h3>Fully Paid</h3><div class="num">${s.fully_paid}</div></div>
      <div class="card"><h3>Fees Expected</h3><div class="num">UGX ${Number(s.total_fees).toLocaleString()}</div></div>
      <div class="card"><h3>Collected</h3><div class="num">UGX ${Number(p.total_collected).toLocaleString()}</div></div>
      <div class="card"><h3>Outstanding</h3><div class="num">UGX ${Number(s.total_balance).toLocaleString()}</div></div>
    </div>

    <div>
      <a href="/admin/students/add" class="btn">Add Student</a>
      <a href="/admin/payments/add" class="btn">Record Payment</a>
      <a href="/admin/payments/bulk" class="btn btn-orange">Bulk Payment</a>
      <a href="/admin/students" class="btn">All Students</a>
      <a href="/admin/reports" class="btn btn-purple">Reports</a>
      <a href="/admin/receipts" class="btn btn-green">All Receipts</a>
      <a href="/admin/payments/methods" class="btn">Payment Methods</a>
      ${req.session.adminRole === 'headteacher'? '<a href="/admin/terms" class="btn" style="background:#16a085">Term Management</a><a href="/admin/users" class="btn" style="background:#34495e">Users</a>' : ''}
    </div>

    <div class="grid">
      <div class="card"><h3>Collection by Class</h3><canvas id="classChart"></canvas></div>
      <div class="card"><h3>Collection vs Outstanding</h3><canvas id="pieChart"></canvas></div>
    </div>

    <div class="grid" style="margin-top:20px">
      <div class="card">
        <h3>Recent Students</h3>
        <table><tr><th>Name</th><th>Class</th><th>Balance</th><th>Phone</th><th></th></tr>
        ${allStudents.rows.map(st => `
          <tr><td>${st.name}</td><td>${st.class}</td><td>UGX ${Number(st.balance).toLocaleString()}</td>
          <td>${st.parent_phone || '-'}</td><td><a href="/admin/students/${st.id}">View</a></td></tr>
        `).join('')}</table>
      </div>
      <div class="card">
        <h3>Recent Payments</h3>
        <table><tr><th>Student</th><th>Amount</th><th>Date</th></tr>
        ${recentPayments.rows.map(pm => `
          <tr><td>${pm.name}</td><td>UGX ${Number(pm.amount).toLocaleString()}</td>
          <td>${new Date(pm.payment_date).toLocaleDateString()}</td></tr>
        `).join('')}</table>
      </div>
    </div>

  </div><script>
    new Chart(document.getElementById('classChart'), {
      type: 'bar',
      data: {labels: ${JSON.stringify(classData.rows.map(c => c.class))}, datasets: [{label: 'Paid', data: ${JSON.stringify(classData.rows.map(c => c.paid))}, backgroundColor: '#27ae60'},{label: 'Balance', data: ${JSON.stringify(classData.rows.map(c => c.balance))}, backgroundColor: '#e74c3c'}]},
      options: {responsive: true, scales: {x: {stacked: true}, y: {stacked: true, beginAtZero: true}}}
    });
    new Chart(document.getElementById('pieChart'), {
      type: 'doughnut',
      data: {labels: ['Collected', 'Outstanding'], datasets: [{data: [${p.total_collected}, ${s.total_balance}], backgroundColor: ['#27ae60','#e74c3c']}]}
    });
  </script></body></html>`);
});

// ========== USER MANAGEMENT - HEADTEACHER ONLY ==========
app.get('/admin/users', requireLogin, requireRole(['headteacher']), async (req, res) => {
  const users = await pool.query('SELECT id, username, full_name, role FROM admins ORDER BY role, username');
  res.send(`<!DOCTYPE html><html><head><title>Users</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:10px;text-decoration:none;border-radius:4px}input,select{width:100%;padding:10px;margin:5px 0}</style>
  </head><body><h2>User Management</h2><a href="/admin" class="btn">Dashboard</a>
  <form method="POST" action="/admin/users/add" style="margin:20px 0;background:white;padding:20px;border-radius:8px">
    <h3>Add New User</h3>
    <input name="username" placeholder="Username" required>
    <input name="full_name" placeholder="Full Name" required>
    <input type="password" name="password" placeholder="Password" required>
    <select name="role" required><option value="bursar">Bursar</option><option value="secretary">Secretary</option><option value="headteacher">Head Teacher</option></select>
    <button type="submit" class="btn">Add User</button>
  </form>
  <table><tr><th>Username</th><th>Full Name</th><th>Role</th><th></th></tr>
  ${users.rows.map(u => `<tr><td>${u.username}</td><td>${u.full_name}</td><td>${u.role}</td><td>${u.id!== req.session.adminId? `<form method="POST" action="/admin/users/${u.id}/delete" style="display:inline"><button type="submit" onclick="return confirm('Delete user?')" style="background:#e74c3c;color:white;border:none;padding:5px 10px;border-radius:3px;cursor:pointer">Delete</button></form>` : 'Current'}</td></tr>`).join('')}
  </table></body></html>`);
});

app.post('/admin/users/add', requireLogin, requireRole(['headteacher']), async (req, res) => {
  const { username, full_name, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO admins (username, full_name, password, role) VALUES ($1,$2,$3,$4)', [username, full_name, hash, role]);
  res.redirect('/admin/users');
});

app.post('/admin/users/:id/delete', requireLogin, requireRole(['headteacher']), async (req, res) => {
  await pool.query('DELETE FROM admins WHERE id = $1 AND id!= $2', [req.params.id, req.session.adminId]);
  res.redirect('/admin/users');
});

// ========== TERM MANAGEMENT - HEADTEACHER ONLY ==========
app.get('/admin/terms', requireLogin, requireRole(['headteacher']), async (req, res) => {
  const terms = await pool.query('SELECT * FROM terms ORDER BY year DESC, id DESC');
  const current = terms.rows.find(t => t.is_current);
  res.send(`<!DOCTYPE html><html><head><title>Term Management</title>
  <style>body{font-family:Arial;max-width:1000px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:10px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input{width:100%;padding:10px;margin:5px 0}.current{background:#27ae60;color:white;padding:4px 8px;border-radius:4px}</style>
  </head><body><h2>Term Management</h2><a href="/admin" class="btn">Dashboard</a>
  <div style="background:white;padding:20px;margin:20px 0;border-radius:8px">
    <h3>Current Term: ${current? `${current.name} ${current.year}` : 'None'}</h3>
    <form method="POST" action="/admin/terms/rollover" onsubmit="return confirm('Start new term? This will archive current term and carry forward balances.')">
      <h3>Start New Term</h3>
      <input name="name" placeholder="Term Name e.g Term 2" required>
      <input name="year" type="number" placeholder="Year" value="${new Date().getFullYear()}" required>
      <button type="submit" class="btn" style="background:#e67e22">Start New Term</button>
    </form>
  </div>
  <table><tr><th>Term</th><th>Year</th><th>Start Date</th><th>Students</th><th>Status</th><th></th></tr>
  ${await Promise.all(terms.rows.map(async t => {
    const count = await pool.query('SELECT COUNT(*) FROM students WHERE term = $1 AND year = $2', [t.name, t.year]);
    return `<tr><td>${t.name}</td><td>${t.year}</td><td>${t.start_date? new Date(t.start_date).toLocaleDateString() : '-'}</td><td>${count.rows[0].count}</td><td>${t.is_current? '<span class="current">Current</span>' : ''}</td><td>${!t.is_current? `<form method="POST" action="/admin/terms/${t.id}/activate" style="display:inline"><button type="submit" class="btn">Set Current</button></form>` : ''}</td></tr>`;
  })).then(rows => rows.join(''))}
  </table></body></html>`);
});

app.post('/admin/terms/rollover', requireLogin, requireRole(['headteacher']), async (req, res) => {
  const { name, year } = req.body;
  await pool.query('UPDATE terms SET is_current = false');
  await pool.query('INSERT INTO terms (name, year, start_date, is_current) VALUES ($1, $2, CURRENT_DATE, true)', [name, year]);
  // Carry forward students with balances
  await pool.query(`
    INSERT INTO students (name, class, term, year, total_fees, balance, parent_phone, parent_name)
    SELECT name, class, $1, $2, balance, balance, parent_phone, parent_name
    FROM students WHERE balance > 0 AND is_active = true
  `, [name, year]);
  await pool.query('UPDATE students SET is_active = false WHERE term!= $1 OR year!= $2', [name, year]);
  res.redirect('/admin/terms');
});

app.post('/admin/terms/:id/activate', requireLogin, requireRole(['headteacher']), async (req, res) => {
  await pool.query('UPDATE terms SET is_current = false');
  await pool.query('UPDATE terms SET is_current = true WHERE id = $1', [req.params.id]);
  res.redirect('/admin/terms');
});

// ========== STUDENT ROUTES WITH PHONE ==========
app.get('/admin/students/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}</style>
  </head><body><h2>Add Student</h2><a href="/admin">Back to Dashboard</a><form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Name" required>
    <input name="class" placeholder="Class e.g P.6" required>
    <input name="term" placeholder="Term e.g term1" required>
    <input name="year" type="number" value="2025" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <input name="parent_name" placeholder="Parent/Guardian Name">
    <input name="parent_phone" placeholder="Parent Phone e.g 0772123456">
    <button type="submit">Save Student</button>
  </form></body></html>`);
});

app.post('/admin/students/add', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };
  const { name, class: cls, total_fees, parent_name, parent_phone } = req.body;
  await pool.query(
    'INSERT INTO students (name, class, term, year, total_fees, balance, parent_name, parent_phone) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)',
    [name, cls, term.name, term.year, total_fees, parent_name, parent_phone]
  );
  res.redirect('/admin');
});

app.get('/admin/students', requireLogin, async (req, res) => {
  const search = req.query.search || '';
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };

  let query = 'SELECT * FROM students WHERE is_active = true AND term = $1 AND year = $2';
  let params = [term.name, term.year];

  if (search) {
    query += ' AND (LOWER(name) LIKE $3 OR LOWER(class) LIKE $3 OR parent_phone LIKE $3)';
    params.push(`%${search.toLowerCase()}%`);
  }

  query += ' ORDER BY class, name';
  const students = await pool.query(query, params);

  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px;margin:5px}.search-box{display:flex;gap:10px;margin:20px 0}input[type="text"]{flex:1;padding:10px;border:1px solid #ddd;border-radius:4px}</style>
  </head><body><h2>All Students - ${term.name} ${term.year}</h2>
  <a href="/admin" class="btn">Dashboard</a>
  <a href="/admin/students/add" class="btn">Add Student</a>

  <form method="GET" action="/admin/students" class="search-box">
    <input type="text" name="search" placeholder="Search by name, class, or phone..." value="${search}">
    <button type="submit" class="btn">Search</button>
    ${search? '<a href="/admin/students" class="btn" style="background:#95a5a6">Clear</a>' : ''}
  </form>

  ${search? `<p>Found ${students.rows.length} results for "${search}"</p>` : ''}

  <table>
    <tr><th>Name</th><th>Class</th><th>Total Fees</th><th>Balance</th><th>Parent</th><th>Phone</th><th></th></tr>
    ${students.rows.map(s => `
      <tr><td>${s.name}</td><td>${s.class}</td>
      <td>UGX ${Number(s.total_fees).toLocaleString()}</td>
      <td>UGX ${Number(s.balance).toLocaleString()}</td>
      <td>${s.parent_name || '-'}</td>
      <td>${s.parent_phone || '-'}</td>
      <td><a href="/admin/students/${s.id}">View</a></td></tr>
    `).join('')}
  </table></body></html>`);
});

app.get('/admin/students/:id/edit', requireLogin, async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  if (!student.rows.length) return res.send('Student not found');
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>Edit Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}.btn{background:#3498db;color:white;text-decoration:none;padding:10px;display:inline-block;border-radius:4px}.btn-red{background:#e74c3c}</style>
  </head><body><h2>Edit Student</h2><a href="/admin/students/${s.id}" class="btn">Cancel</a>
  <form method="POST" action="/admin/students/${s.id}/edit">
    <input name="name" value="${s.name}" placeholder="Student Name" required>
    <input name="class" value="${s.class}" placeholder="Class e.g P.6" required>
    <input name="term" value="${s.term}" placeholder="Term" required>
    <input name="year" type="number" value="${s.year}" required>
    <input name="total_fees" type="number" value="${s.total_fees}" placeholder="Total Fees" required>
    <input name="parent_name" value="${s.parent_name || ''}" placeholder="Parent/Guardian Name">
    <input name="parent_phone" value="${s.parent_phone || ''}" placeholder="Parent Phone">
    <button type="submit">Update Student</button>
  </form>
  <form method="POST" action="/admin/students/${s.id}/delete" onsubmit="return confirm('Delete this student? All payments will be lost!')" style="margin-top:20px">
    <button type="submit" class="btn btn-red">Delete Student</button>
  </form></body></html>`);
});

app.post('/admin/students/:id/edit', requireLogin, async (req, res) => {
  const { name, class: cls, term, year, total_fees, parent_name, parent_phone } = req.body;
  await pool.query(
    'UPDATE students SET name=$1, class=$2, term=$3, year=$4, total_fees=$5, parent_name=$6, parent_phone=$7 WHERE id=$8',
    [name, cls, term, year, total_fees, parent_name, parent_phone, req.params.id]
  );
  await pool.query(`
    UPDATE students SET balance = total_fees - COALESCE((
      SELECT SUM(amount) FROM payments WHERE payments.student_id = students.id
    ), 0) WHERE id = $1
  `, [req.params.id]);
  res.redirect(`/admin/students/${req.params.id}`);
});

app.post('/admin/students/:id/delete', requireLogin, async (req, res) => {
  await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
  res.redirect('/admin/students');
});

app.get('/admin/students/:id', requireLogin, async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.params.id]);
  if (!student.rows.length) return res.send('Student not found');
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>${s.name}</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.btn{background:#3498db;color:white;padding:10px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd}</style>
  </head><body><a href="/admin/students">Back to Students</a>
    <h2>${s.name} - ${s.class}</h2>
  <p><b>Term:</b> ${s.term} ${s.year} | <b>Total Fees:</b> UGX ${Number(s.total_fees).toLocaleString()} | <b>Balance:</b> UGX ${Number(s.balance).toLocaleString()}</p>
  <p><b>Parent:</b> ${s.parent_name || '-'} | <b>Phone:</b> ${s.parent_phone || '-'}</p>
  <a href="/admin/students/${s.id}/edit" class="btn">Edit Student</a>
  <a href="/admin/students/${s.id}/statement" class="btn" target="_blank">Print Statement</a>
  <h3>Payment History</h3><table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>SMS</th><th></th></tr>
  ${payments.rows.map(p => `
    <tr>
      <td>${new Date(p.payment_date).toLocaleDateString()}</td>
      <td>UGX ${Number(p.amount).toLocaleString()}</td>
      <td>${p.method || '-'}</td>
      <td>${p.reference || '-'}</td>
      <td>${p.sms_sent? '✓ Sent' : '-'}</td>
      <td>
        <form method="POST" action="/admin/payments/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete this payment? Balance will be updated.')">
          <button type="submit" style="background:#e74c3c;color:white;border:none;padding:5px 10px;border-radius:3px;cursor:pointer">Delete</button>
        </form>
      </td>
    </tr>
  `).join('')}
  </table></body></html>`);
});

app.get('/admin/students/:id/statement', requireLogin, async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date', [req.params.id]);
  const s = student.rows[0];
  const totalPaid = payments.rows.reduce((sum, p) => sum + Number(p.amount), 0);
  res.send(`<!DOCTYPE html><html><head><title>Statement</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}@media print{.no-print{display:none}}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border:1px solid #000;text-align:left}</style>
  </head><body><button class="no-print" onclick="window.print()">Print</button>
    <h2>Ssewasswa Primary School - Fees Statement</h2>
    <p><b>Student:</b> ${s.name} | <b>Class:</b> ${s.class} | <b>Term:</b> ${s.term} ${s.year}</p>
    <p><b>Parent:</b> ${s.parent_name || '-'} | <b>Phone:</b> ${s.parent_phone || '-'}</p>
    <p><b>Total Fees:</b> UGX ${Number(s.total_fees).toLocaleString()} | <b>Total Paid:</b> UGX ${totalPaid.toLocaleString()} | <b>Balance:</b> UGX ${Number(s.balance).toLocaleString()}</p>
    <table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
    ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method || '-'}</td><td>${p.reference || '-'}</td></tr>`).join('')}
    </table><p style="margin-top:40px">Generated: ${new Date().toLocaleString()}</p></body></html>`);
});

// ========== PAYMENT ROUTES WITH SMS ==========
app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };
  const students = await pool.query('SELECT id, name, class, balance, parent_phone FROM students WHERE balance > 0 AND is_active = true AND term = $1 AND year = $2 ORDER BY name', [term.name, term.year]);
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}</style>
  </head><body><h2>Record Payment</h2><a href="/admin">Back</a><form method="POST" action="/admin/payments/add">
    <select name="student_id" required><option value="">Select Student</option>
      ${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</option>`).join('')}
    </select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="method" placeholder="Payment Method e.g MTN" required>
    <input name="reference" placeholder="Reference/TxID">
    <label><input type="checkbox" name="send_sms" checked> Send SMS to Parent</label>
    <button type="submit">Save Payment</button>
  </form></body></html>`);
});

app.post('/admin/payments/add', requireLogin, async (req, res) => {
  const { student_id, amount, method, reference, send_sms } = req.body;
  const payment = await pool.query(
    'INSERT INTO payments (student_id, amount, method, reference, recorded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [student_id, amount, method, reference, req.session.adminId]
  );
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);

  // Send SMS if checkbox ticked and phone exists
  if (send_sms) {
    const student = await pool.query('SELECT name, parent_phone, balance FROM students WHERE id = $1', [student_id]);
    const s = student.rows[0];
    if (s.parent_phone) {
      await sendSMS(s.parent_phone, `Payment received for ${s.name}: UGX ${Number(amount).toLocaleString()}. Balance: UGX ${Number(s.balance).toLocaleString()}. Ssewasswa Primary`);
      await pool.query('UPDATE payments SET sms_sent = true WHERE id = $1', [payment.rows[0].id]);
    }
  }
  res.redirect(`/admin/payments/receipt/${payment.rows[0].id}`);
});

app.get('/admin/payments/receipt/:id', requireLogin, async (req, res) => {
  const result = await pool.query(`
    SELECT p.*, s.name, s.class, s.term, s.year, s.total_fees, s.balance, s.parent_phone
    FROM payments p
    JOIN students s ON p.student_id = s.id
    WHERE p.id = $1
  `, [req.params.id]);

  if (!result.rows.length) return res.send('Receipt not found');
  const r = result.rows[0];

  res.send(`<!DOCTYPE html><html><head><title>Receipt #${r.id}</title>
  <style>
    body{font-family:Arial;max-width:700px;margin:20px auto;padding:20px}
 .receipt{border:2px solid #000;padding:30px}
 .header{text-align:center;border-bottom:2px solid #000;padding-bottom:15px;margin-bottom:20px}
 .school{font-size:24px;font-weight:bold}
    table{width:100%;margin:20px 0}td{padding:8px}
 .amount{font-size:28px;font-weight:bold;color:#27ae60}
    @media print{.no-print{display:none}}
  </style>
  </head><body>
    <button class="no-print" onclick="window.print()" style="padding:10px 20px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;margin-bottom:20px">Print Receipt</button>
    <a href="/admin" class="no-print" style="padding:10px 20px;background:#95a5a6;color:white;text-decoration:none;border-radius:4px;margin-left:10px">Back to Dashboard</a>
    ${r.parent_phone &&!r.sms_sent? `<form method="POST" action="/admin/payments/${r.id}/sms" style="display:inline" class="no-print"><button type="submit" style="padding:10px 20px;background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer;margin-left:10px">Send SMS</button></form>` : ''}

    <div class="receipt">
      <div class="header">
        <div class="school">SSEWASSWA PRIMARY SCHOOL</div>
        <div>Fees Payment Receipt</div>
      </div>

      <table>
        <tr><td><b>Receipt No:</b></td><td>#${r.id}</td><td><b>Date:</b></td><td>${new Date(r.payment_date).toLocaleDateString()}</td></tr>
        <tr><td><b>Student Name:</b></td><td colspan="3">${r.name}</td></tr>
        <tr><td><b>Class:</b></td><td>${r.class}</td><td><b>Term:</b></td><td>${r.term} ${r.year}</td></tr>
        <tr><td><b>Amount Paid:</b></td><td colspan="3" class="amount">UGX ${Number(r.amount).toLocaleString()}</td></tr>
        <tr><td><b>Payment Method:</b></td><td>${r.method}</td><td><b>Reference:</b></td><td>${r.reference || '-'}</td></tr>
        <tr><td><b>Total Fees:</b></td><td>UGX ${Number(r.total_fees).toLocaleString()}</td><td><b>Balance:</b></td><td>UGX ${Number(r.balance).toLocaleString()}</td></tr>
        <tr><td><b>SMS Status:</b></td><td colspan="3">${r.sms_sent? 'Sent to ' + r.parent_phone : 'Not sent'}</td></tr>
      </table>

      <p style="margin-top:40px;text-align:center">Received with thanks</p>
      <p style="margin-top:60px">_____________________<br>Bursar Signature</p>
    </div>
  </body></html>`);
});

app.post('/admin/payments/:id/sms', requireLogin, async (req, res) => {
  const result = await pool.query(`
    SELECT p.amount, s.name, s.balance, s.parent_phone
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE p.id = $1
  `, [req.params.id]);
  const r = result.rows[0];
  if (r.parent_phone) {
    await sendSMS(r.parent_phone, `Payment received for ${r.name}: UGX ${Number(r.amount).toLocaleString()}. Balance: UGX ${Number(r.balance).toLocaleString()}. Ssewasswa Primary`);
    await pool.query('UPDATE payments SET sms_sent = true WHERE id = $1', [req.params.id]);
  }
  res.redirect(`/admin/payments/receipt/${req.params.id}`);
});

app.post('/admin/payments/:id/delete', requireLogin, async (req, res) => {
  const payment = await pool.query('SELECT student_id, amount FROM payments WHERE id = $1', [req.params.id]);
  if (payment.rows.length) {
    const { student_id, amount } = payment.rows[0];
    await pool.query('DELETE FROM payments WHERE id = $1', [req.params.id]);
    await pool.query('UPDATE students SET balance = balance + $1 WHERE id = $2', [amount, student_id]);
  }
  res.redirect('back');
});

// 2. ALL RECEIPTS LIST
app.get('/admin/receipts', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };
  const payments = await pool.query(`
    SELECT p.id, p.amount, p.payment_date, p.method, p.sms_sent, s.name, s.class
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE s.term = $1 AND s.year = $2
    ORDER BY p.id DESC LIMIT 100
  `, [term.name, term.year]);
  res.send(`<!DOCTYPE html><html><head><title>All Receipts</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}</style>
  </head><body><h2>All Payment Receipts - ${term.name} ${term.year}</h2><a href="/admin" class="btn">Dashboard</a>
  <table><tr><th>Receipt #</th><th>Date</th><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>SMS</th><th></th></tr>
  ${payments.rows.map(p => `
    <tr><td>#${p.id}</td><td>${new Date(p.payment_date).toLocaleDateString()}</td>
    <td>${p.name}</td><td>${p.class}</td><td>UGX ${Number(p.amount).toLocaleString()}</td>
    <td>${p.method || '-'}</td><td>${p.sms_sent? '✓' : '-'}</td><td><a href="/admin/payments/receipt/${p.id}" target="_blank">View/Print</a></td></tr>
  `).join('')}</table></body></html>`);
});

// 3. BULK PAYMENT
app.get('/admin/payments/bulk', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };
  const students = await pool.query('SELECT id, name, class, balance FROM students WHERE balance > 0 AND is_active = true AND term = $1 AND year = $2 ORDER BY class, name', [term.name, term.year]);
  res.send(`<!DOCTYPE html><html><head><title>Bulk Payment</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.student{padding:10px;border-bottom:1px solid #eee}input,button{padding:10px;margin:5px}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><h2>Bulk Payment Entry</h2><a href="/admin">Back</a>
  <form method="POST" action="/admin/payments/bulk">
    <input name="amount" type="number" placeholder="Amount for each student" required>
    <input name="method" placeholder="Payment Method" required>
    <input name="reference" placeholder="Reference (optional)">
    <label><input type="checkbox" name="send_sms" checked> Send SMS to Parents</label>
    <h3>Select Students:</h3>
    ${students.rows.map(s => `
      <div class="student">
        <label><input type="checkbox" name="student_ids" value="${s.id}"> ${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</label>
      </div>
    `).join('')}
    <button type="submit">Record Payments for Selected Students</button>
  </form></body></html>`);
});

app.post('/admin/payments/bulk', requireLogin, async (req, res) => {
  const { amount, method, reference, student_ids, send_sms } = req.body;
  const ids = Array.isArray(student_ids)? student_ids : [student_ids];
  for (const id of ids) {
    const payment = await pool.query('INSERT INTO payments (student_id, amount, method, reference, recorded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [id, amount, method, reference, req.session.adminId]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, id]);
    if (send_sms) {
      const student = await pool.query('SELECT name, parent_phone, balance FROM students WHERE id = $1', [id]);
      const s = student.rows[0];
      if (s.parent_phone) {
        await sendSMS(s.parent_phone, `Payment received for ${s.name}: UGX ${Number(amount).toLocaleString()}. Balance: UGX ${Number(s.balance).toLocaleString()}. Ssewasswa Primary`);
        await pool.query('UPDATE payments SET sms_sent = true WHERE id = $1', [payment.rows[0].id]);
      }
    }
  }
  res.redirect('/admin?msg=bulk_success');
});

// ========== FINANCIAL REPORTS ==========
app.get('/admin/reports', requireLogin, async (req, res) => {
  const { from, to, class: cls } = req.query;
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };

  let whereClause = 's.term = $1 AND s.year = $2';
  let params = [term.name, term.year];

  if (from) { params.push(from); whereClause += ` AND p.payment_date >= $${params.length}`; }
  if (to) { params.push(to); whereClause += ` AND p.payment_date <= $${params.length}`; }
  if (cls) { params.push(cls); whereClause += ` AND s.class = $${params.length}`; }

  const summary = await pool.query(`
    SELECT
      COUNT(*) as total_transactions,
      COALESCE(SUM(p.amount), 0) as total_collected,
      COUNT(DISTINCT p.student_id) as students_paid
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE ${whereClause}
  `, params);

  const byMethod = await pool.query(`
    SELECT p.method, COUNT(*) as count, COALESCE(SUM(p.amount), 0) as total
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE ${whereClause} AND p.method IS NOT NULL
    GROUP BY p.method ORDER BY total DESC
  `, params);

  const byClass = await pool.query(`
    SELECT s.class, COUNT(*) as count, COALESCE(SUM(p.amount), 0) as total
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE ${whereClause}
    GROUP BY s.class ORDER BY total DESC
  `, params);

  const payments = await pool.query(`
    SELECT p.*, s.name, s.class FROM payments p
    JOIN students s ON p.student_id = s.id
    WHERE ${whereClause}
    ORDER BY p.payment_date DESC, p.id DESC
  `, params);

  const classes = await pool.query('SELECT DISTINCT class FROM students WHERE term = $1 AND year = $2 ORDER BY class', [term.name, term.year]);

  res.send(`<!DOCTYPE html><html><head><title>Financial Reports</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}
   .card{background:white;padding:20px;border-radius:8px;margin-bottom:20px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
   .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:20px 0}
   .stat h3{margin:0;color:#666;font-size:14px}.stat.num{font-size:28px;font-weight:bold;color:#2c3e50}
   .filters{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}
   .filters input,.filters select{padding:10px;border:1px solid #ddd;border-radius:4px}
   .btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #eee;text-align:left}th{background:#34495e;color:white}
   .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  </style></head><body>
    <h2>Financial Reports - ${term.name} ${term.year}</h2>
    <a href="/admin" class="btn">Dashboard</a>

    <div class="card">
      <form method="GET" class="filters">
        <input type="date" name="from" value="${from || ''}" placeholder="From Date">
        <input type="date" name="to" value="${to || ''}" placeholder="To Date">
        <select name="class">
          <option value="">All Classes</option>
          ${classes.rows.map(c => `<option value="${c.class}" ${cls === c.class? 'selected' : ''}>${c.class}</option>`).join('')}
        </select>
        <button type="submit" class="btn">Filter</button>
        <a href="/admin/reports" class="btn" style="background:#95a5a6">Reset</a>
        <a href="/admin/export/payments?${new URLSearchParams({from, to, class: cls, term: term.name, year: term.year}).toString()}" class="btn" style="background:#27ae60">Export CSV</a>
      </form>
    </div>

    <div class="stats">
      <div class="card stat"><h3>Total Collected</h3><div class="num">UGX ${Number(summary.rows[0].total_collected).toLocaleString()}</div></div>
      <div class="card stat"><h3>Transactions</h3><div class="num">${summary.rows[0].total_transactions}</div></div>
      <div class="card stat"><h3>Students Paid</h3><div class="num">${summary.rows[0].students_paid}</div></div>
    </div>

    <div class="grid">
      <div class="card"><h3>By Payment Method</h3><canvas id="methodChart"></canvas>
        <table><tr><th>Method</th><th>Count</th><th>Total</th></tr>
        ${byMethod.rows.map(m => `<tr><td>${m.method || 'Cash'}</td><td>${m.count}</td><td>UGX ${Number(m.total).toLocaleString()}</td></tr>`).join('')}
        </table>
      </div>
      <div class="card"><h3>By Class</h3><canvas id="classChart"></canvas>
        <table><tr><th>Class</th><th>Count</th><th>Total</th></tr>
        ${byClass.rows.map(c => `<tr><td>${c.class}</td><td>${c.count}</td><td>UGX ${Number(c.total).toLocaleString()}</td></tr>`).join('')}
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Payment Details (${payments.rows.length} records)</h3>
      <table>
        <tr><th>Date</th><th>Receipt</th><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr>
        ${payments.rows.map(p => `
          <tr>
            <td>${new Date(p.payment_date).toLocaleDateString()}</td>
            <td>#${p.id}</td>
            <td>${p.name}</td>
            <td>${p.class}</td>
            <td>UGX ${Number(p.amount).toLocaleString()}</td>
            <td>${p.method || '-'}</td>
            <td>${p.reference || '-'}</td>
            <td><a href="/admin/payments/receipt/${p.id}" target="_blank">Receipt</a></td>
          </tr>
        `).join('')}
      </table>
    </div>

  <script>
    new Chart(document.getElementById('methodChart'), {
      type: 'pie',
      data: {labels: ${JSON.stringify(byMethod.rows.map(m => m.method || 'Cash'))}, datasets: [{data: ${JSON.stringify(byMethod.rows.map(m => m.total))}, backgroundColor: ['#3498db','#27ae60','#e74c3c','#f39c12','#9b59b6']}]}
    });
    new Chart(document.getElementById('classChart'), {
      type: 'bar',
      data: {labels: ${JSON.stringify(byClass.rows.map(c => c.class))}, datasets: [{label: 'Amount', data: ${JSON.stringify(byClass.rows.map(c => c.total))}, backgroundColor: '#3498db'}]}
    });
  </script></body></html>`);
});

app.get('/admin/payments/methods', requireLogin, async (req, res) => {
  const methods = await pool.query('SELECT * FROM payment_methods');
  res.send(`<!DOCTYPE html><html><head><title>Payment Methods</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}input,textarea,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd}</style>
  </head><body><h2>Payment Methods</h2><a href="/admin">Back</a>
  <form method="POST" action="/admin/payments/methods">
    <input name="type" placeholder="Type e.g MTN Mobile Money" required>
    <input name="name" placeholder="Display Name e.g School MTN" required>
    <input name="number" placeholder="Number/Account">
    <input name="account_name" placeholder="Account Name">
    <textarea name="instructions" placeholder="Payment Instructions"></textarea>
    <button type="submit">Add Method</button>
  </form>
  <table><tr><th>Type</th><th>Name</th><th>Number</th><th>Account</th></tr>
  ${methods.rows.map(m => `<tr><td>${m.type}</td><td>${m.name}</td><td>${m.number || '-'}</td><td>${m.account_name || '-'}</td></tr>`).join('')}
  </table></body></html>`);
});

app.post('/admin/payments/methods', requireLogin, async (req, res) => {
  const { type, name, number, account_name, instructions } = req.body;
  await pool.query('INSERT INTO payment_methods (type, name, number, account_name, instructions) VALUES ($1,$2,$3,$4,$5)', [type, name, number, account_name, instructions]);
  res.redirect('/admin/payments/methods');
});

// ========== PARENT PORTAL ==========
app.get('/parent', async (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Parent Portal</title>
  <style>body{font-family:Arial;max-width:600px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><div class="card"><h2>Parent Portal - Check Fees Balance</h2>
  <form method="POST" action="/parent/check">
    <input name="name" placeholder="Student Name" required>
    <input name="class" placeholder="Class e.g P.6" required>
    <button type="submit">Check Balance</button>
  </form></div></body></html>`);
});

app.post('/parent/check', async (req, res) => {
  const { name, class: cls } = req.body;
  const student = await pool.query('SELECT * FROM students WHERE LOWER(name) = LOWER($1) AND LOWER(class) = LOWER($2) AND is_active = true LIMIT 1', [name, cls]);
  if (!student.rows.length) return res.send('Student not found. <a href="/parent">Try again</a>');
  const s = student.rows[0];
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [s.id]);
  res.send(`<!DOCTYPE html><html><head><title>Balance</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #eee;text-align:left}.balance{font-size:32px;color:#e74c3c;font-weight:bold}</style>
  </head><body><div class="card"><a href="/parent">New Search</a>
    <h2>Fees Balance</h2>
    <p><b>Name:</b> ${s.name} | <b>Class:</b> ${s.class} | <b>Term:</b> ${s.term} ${s.year}</p>
    <p><b>Total Fees:</b> UGX ${Number(s.total_fees).toLocaleString()}</p>
    <p class="balance">Outstanding Balance: UGX ${Number(s.balance).toLocaleString()}</p>
    <h3>Payment History</h3><table><tr><th>Date</th><th>Amount</th><th>Method</th></tr>
    ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method || '-'}</td></tr>`).join('')}
    </table></div></body></html>`);
});

// ========== EXPORT TO CSV ==========
app.get('/admin/export/students', requireLogin, async (req, res) => {
  const currentTerm = await pool.query('SELECT * FROM terms WHERE is_current = true LIMIT 1');
  const term = currentTerm.rows[0] || { name: 'term1', year: 2025 };
  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.class, s.term, s.year, s.total_fees, COALESCE(SUM(p.amount), 0) as paid, s.balance, s.parent_name, s.parent_phone
    FROM students s LEFT JOIN payments p ON s.id = p.student_id
    WHERE s.is_active = true AND s.term = $1 AND s.year = $2
    GROUP BY s.id ORDER BY s.class, s.name
  `, [term.name, term.year]);

  let csv = 'ID,Name,Class,Term,Year,Total Fees,Amount Paid,Balance,Parent Name,Parent Phone\n';
  rows.forEach(r => {
    csv += `${r.id},"${r.name}",${r.class},${r.term},${r.year},${r.total_fees},${r.paid},${r.balance},"${r.parent_name || ''}","${r.parent_phone || ''}"\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.attachment(`students_${term.name}_${term.year}.csv`);
  res.send(csv);
});

app.get('/admin/export/payments', requireLogin, async (req, res) => {
  const { from, to, class: cls, term, year } = req.query;
  let whereClause = '1=1';
  let params = [];

  if (term) { params.push(term); whereClause += ` AND s.term = $${params.length}`; }
  if (year) { params.push(year); whereClause += ` AND s.year = $${params.length}`; }
  if (from) { params.push(from); whereClause += ` AND p.payment_date >= $${params.length}`; }
  if (to) { params.push(to); whereClause += ` AND p.payment_date <= $${params.length}`; }
  if (cls) { params.push(cls); whereClause += ` AND s.class = $${params.length}`; }

  const { rows } = await pool.query(`
    SELECT p.id, s.name as student, s.class, p.amount, p.method, p.reference, p.payment_date, p.sms_sent
    FROM payments p JOIN students s ON p.student_id = s.id
    WHERE ${whereClause}
    ORDER BY p.payment_date DESC
  `, params);

  let csv = 'ID,Student,Class,Amount,Method,Reference,Date,SMS Sent\n';
  rows.forEach(r => {
    csv += `${r.id},"${r.student}",${r.class},${r.amount},"${r.method || ''}","${r.reference || ''}",${r.payment_date},${r.sms_sent? 'Yes' : 'No'}\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.attachment(`payments_${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csv);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
