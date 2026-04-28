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
      role VARCHAR(20) DEFAULT 'bursar'
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      payment_date DATE DEFAULT CURRENT_DATE
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL
    );
  `);

  // Add missing columns to existing tables
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS class VARCHAR(50) DEFAULT 'P.6'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS term VARCHAR(20) DEFAULT 'term1'`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT 2025`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS total_fees INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0`);

  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS method VARCHAR(50)`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`);

  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS number VARCHAR(50)`);
  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS account_name VARCHAR(100)`);
  await pool.query(`ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS instructions TEXT`);

  await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'bursar'`);

  // Create default admin
  const admin = await pool.query('SELECT * FROM admins WHERE username = $1', ['bursar']);
  if (admin.rows.length === 0) {
    const hash = await bcrypt.hash('bursar123', 10);
    await pool.query('INSERT INTO admins (username, password, role) VALUES ($1, $2, $3)', ['bursar', hash, 'bursar']);
  }
  console.log('✅ Database ready');
}
initDB();

const requireLogin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

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
      <a href="/admin/login" class="btn">Bursar Login</a>
      <a href="/parent" class="btn btn-green">Parent Portal</a>
    </body></html>
  `);
});

app.get('/health', (req, res) => res.json({ status: 'API is running', timestamp: new Date() }));

// ========== AUTH ROUTES ==========
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}</style>
  </head><body><div class="card"><h2>Bursar Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form></div></body></html>`);
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  if (result.rows.length && await bcrypt.compare(password, result.rows[0].password)) {
    req.session.adminId = result.rows[0].id;
    req.session.adminRole = result.rows[0].role;
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
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total_students,
      COALESCE(SUM(total_fees),0) as total_fees,
      COALESCE(SUM(balance),0) as total_balance
    FROM students
  `);
  const payStats = await pool.query(`
    SELECT COUNT(*) as total_payments, COALESCE(SUM(amount),0) as total_collected FROM payments
  `);
  const classData = await pool.query(`
    SELECT class, SUM(balance) as balance, SUM(total_fees - balance) as paid
    FROM students GROUP BY class ORDER BY class
  `);
  const recentPayments = await pool.query(`
    SELECT p.*, s.name, s.class FROM payments p
    JOIN students s ON p.student_id = s.id
    ORDER BY p.id DESC LIMIT 5
  `);
  const allStudents = await pool.query('SELECT * FROM students ORDER BY id DESC LIMIT 10');
  const paymentMethods = await pool.query('SELECT * FROM payment_methods');

  const s = stats.rows[0];
  const p = payStats.rows[0];

  res.send(`<!DOCTYPE html><html><head><title>Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body{font-family:Arial;margin:0;background:#f4f6f9;padding:20px}
  .container{max-width:1400px;margin:auto}
  .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:20px}
  .card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  .card h3{margin:0 0 10px 0;color:#666;font-size:14px;font-weight:normal}
  .card.num{font-size:32px;font-weight:bold;color:#2c3e50}
  .grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}
  .btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px 5px 0}
  .btn-red{background:#e74c3c}
    table{width:100%;background:white;border-collapse:collapse;margin-top:10px}
    th,td{padding:12px;text-align:left;border-bottom:1px solid #eee}
    th{background:#34495e;color:white;font-size:14px}
  </style></head><body><div class="container">
    <div class="header">
      <h1>Ssewasswa Primary - Bursar Dashboard</h1>
      <a href="/admin/logout" class="btn btn-red">Logout</a>
    </div>

    <div class="stats">
      <div class="card"><h3>Total Students</h3><div class="num">${s.total_students}</div></div>
      <div class="card"><h3>Total Fees Expected</h3><div class="num">UGX ${Number(s.total_fees).toLocaleString()}</div></div>
      <div class="card"><h3>Total Collected</h3><div class="num">UGX ${Number(p.total_collected).toLocaleString()}</div></div>
      <div class="card"><h3>Outstanding Balance</h3><div class="num">UGX ${Number(s.total_balance).toLocaleString()}</div></div>
    </div>

    <div>
      <a href="/admin/students/add" class="btn">Add Student</a>
      <a href="/admin/payments/add" class="btn">Record Payment</a>
      <a href="/admin/payments/methods" class="btn">Payment Methods</a>
      <a href="/admin/students" class="btn">All Students</a>
      <a href="/admin/export/students" class="btn">Export Students CSV</a>
<a href="/admin/export/payments" class="btn">Export Payments CSV</a>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Fees Collection by Class</h3>
        <canvas id="classChart"></canvas>
      </div>
      <div class="card">
        <h3>Collection vs Outstanding</h3>
        <canvas id="pieChart"></canvas>
      </div>
    </div>

    <div class="grid" style="margin-top:20px">
      <div class="card">
        <h3>Recent Students</h3>
        <table><tr><th>Name</th><th>Class</th><th>Balance</th><th></th></tr>
        ${allStudents.rows.map(st => `
          <tr><td>${st.name}</td><td>${st.class}</td><td>UGX ${Number(st.balance).toLocaleString()}</td>
          <td><a href="/admin/students/${st.id}">View</a></td></tr>
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

    <div class="card" style="margin-top:20px">
      <h3>Payment Methods</h3>
      <table><tr><th>Type</th><th>Name</th><th>Number</th><th>Account</th></tr>
      ${paymentMethods.rows.map(pm => `
        <tr><td>${pm.type}</td><td>${pm.name}</td><td>${pm.number || '-'}</td><td>${pm.account_name || '-'}</td></tr>
      `).join('')}</table>
    </div>

  </div><script>
    new Chart(document.getElementById('classChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(classData.rows.map(c => c.class))},
        datasets: [
          {label: 'Paid', data: ${JSON.stringify(classData.rows.map(c => c.paid))}, backgroundColor: '#27ae60'},
          {label: 'Balance', data: ${JSON.stringify(classData.rows.map(c => c.balance))}, backgroundColor: '#e74c3c'}
        ]
      },
      options: {responsive: true, scales: {x: {stacked: true}, y: {stacked: true, beginAtZero: true}}}
    });
    new Chart(document.getElementById('pieChart'), {
      type: 'doughnut',
      data: {
        labels: ['Collected', 'Outstanding'],
        datasets: [{data: [${p.total_collected}, ${s.total_balance}], backgroundColor: ['#27ae60','#e74c3c']}]
      }
    });
  </script></body></html>`);
});

// ========== STUDENT ROUTES ==========
app.get('/admin/students/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}</style>
  </head><body><h2>Add Student</h2><a href="/admin">Back to Dashboard</a><form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Name" required>
    <input name="class" placeholder="Class e.g P.6" required>
    <input name="term" placeholder="Term e.g term1" required>
    <input name="year" type="number" value="2025" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <button type="submit">Save Student</button>
  </form></body></html>`);
});

app.post('/admin/students/add', requireLogin, async (req, res) => {
  const { name, class: cls, term, year, total_fees } = req.body;
  await pool.query(
    'INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1,$2,$3,$4,$5,$5)',
    [name, cls, term, year, total_fees]
  );
  res.redirect('/admin');
});

app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}th{background:#34495e;color:white}.btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}</style>
  </head><body><h2>All Students</h2><a href="/admin" class="btn">Dashboard</a> <a href="/admin/students/add" class="btn">Add Student</a><table>
    <tr><th>Name</th><th>Class</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th><th></th></tr>
    ${students.rows.map(s => `
      <tr><td>${s.name}</td><td>${s.class}</td><td>${s.term}</td><td>${s.year}</td>
      <td>UGX ${Number(s.total_fees).toLocaleString()}</td>
      <td>UGX ${Number(s.balance).toLocaleString()}</td>
      <td><a href="/admin/students/${s.id}">View</a></td></tr>
    `).join('')}
  </table></body></html>`);
});
// ========== EDIT STUDENT ==========
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
    <button type="submit">Update Student</button>
  </form>
  <form method="POST" action="/admin/students/${s.id}/delete" onsubmit="return confirm('Delete this student? All payments will be lost!')" style="margin-top:20px">
    <button type="submit" class="btn btn-red">Delete Student</button>
  </form></body></html>`);
});

app.post('/admin/students/:id/edit', requireLogin, async (req, res) => {
  const { name, class: cls, term, year, total_fees } = req.body;
  await pool.query(
    'UPDATE students SET name=$1, class=$2, term=$3, year=$4, total_fees=$5 WHERE id=$6',
    [name, cls, term, year, total_fees, req.params.id]
  );
  // Recalculate balance after fee change
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
// ========== EDIT STUDENT ==========
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
    <button type="submit">Update Student</button>
  </form>
  <form method="POST" action="/admin/students/${s.id}/delete" onsubmit="return confirm('Delete this student? All payments will be lost!')" style="margin-top:20px">
    <button type="submit" class="btn btn-red">Delete Student</button>
  </form></body></html>`);
});

app.post('/admin/students/:id/edit', requireLogin, async (req, res) => {
  const { name, class: cls, term, year, total_fees } = req.body;
  await pool.query(
    'UPDATE students SET name=$1, class=$2, term=$3, year=$4, total_fees=$5 WHERE id=$6',
    [name, cls, term, year, total_fees, req.params.id]
  );
  // Recalculate balance after fee change
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
<a href="/admin/students/${s.id}/edit" class="btn">Edit Student</a>
    <a href="/admin/students/${s.id}/statement" class="btn" target="_blank">Print Statement</a>
    <h3>Payment History</h3><table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
    ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method || '-'}</td><td>${p.reference || '-'}</td></tr>`).join('')}
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
    <p><b>Total Fees:</b> UGX ${Number(s.total_fees).toLocaleString()} | <b>Total Paid:</b> UGX ${totalPaid.toLocaleString()} | <b>Balance:</b> UGX ${Number(s.balance).toLocaleString()}</p>
    <table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
    ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method || '-'}</td><td>${p.reference || '-'}</td></tr>`).join('')}
    </table><p style="margin-top:40px">Generated: ${new Date().toLocaleString()}</p></body></html>`);
});

// ========== PAYMENT ROUTES ==========
app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT id, name, class, balance FROM students WHERE balance > 0 ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0;box-sizing:border-box}</style>
  </head><body><h2>Record Payment</h2><a href="/admin">Back</a><form method="POST" action="/admin/payments/add">
    <select name="student_id" required><option value="">Select Student</option>
      ${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</option>`).join('')}
    </select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="method" placeholder="Payment Method e.g MTN" required>
    <input name="reference" placeholder="Reference/TxID">
    <button type="submit">Save Payment</button>
  </form></body></html>`);
});

app.post('/admin/payments/add', requireLogin, async (req, res) => {
  const { student_id, amount, method, reference } = req.body;
  await pool.query('INSERT INTO payments (student_id, amount, method, reference) VALUES ($1,$2,$3,$4)', [student_id, amount, method, reference]);
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
  res.redirect('/admin');
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
  const student = await pool.query('SELECT * FROM students WHERE LOWER(name) = LOWER($1) AND LOWER(class) = LOWER($2) LIMIT 1', [name, cls]);
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
  const { rows } = await pool.query(`
    SELECT 
      s.id, s.name, s.class, s.term, s.year, s.total_fees,
      COALESCE(SUM(p.amount), 0) as paid,
      s.balance
    FROM students s 
    LEFT JOIN payments p ON s.id = p.student_id 
    GROUP BY s.id 
    ORDER BY s.class, s.name
  `);
  
  let csv = 'ID,Name,Class,Term,Year,Total Fees,Amount Paid,Balance\n';
  rows.forEach(r => {
    csv += `${r.id},"${r.name}",${r.class},${r.term},${r.year},${r.total_fees},${r.paid},${r.balance}\n`;
  });
  
  res.header('Content-Type', 'text/csv');
  res.attachment(`students_${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csv);
});

app.get('/admin/export/payments', requireLogin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.id, s.name as student, p.amount, p.method, p.reference, p.payment_date 
    FROM payments p 
    JOIN students s ON p.student_id = s.id 
    ORDER BY p.payment_date DESC
  `);
  
  let csv = 'ID,Student,Amount,Method,Reference,Date\n';
  rows.forEach(r => {
    csv += `${r.id},"${r.student}",${r.amount},"${r.method || ''}","${r.reference || ''}",${r.payment_date}\n`;
  });
  
  res.header('Content-Type', 'text/csv');
  res.attachment(`payments_${new Date().toISOString().slice(0,10)}.csv`);
  res.send(csv);
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
