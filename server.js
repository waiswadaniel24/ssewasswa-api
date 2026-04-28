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

// Initialize DB
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL
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
  `);

  const admin = await pool.query('SELECT * FROM admins WHERE username = $1', ['bursar']);
  if (admin.rows.length === 0) {
    const hash = await bcrypt.hash('bursar123', 10);
    await pool.query('INSERT INTO admins (username, password) VALUES ($1, $2)', ['bursar', hash]);
  }
  console.log('✅ Database ready');
}
initDB();

const requireLogin = (req, res, next) => {
  if (req.session.adminId) return next();
  res.redirect('/admin/login');
};

// HEALTH
app.get('/health', (req, res) => res.json({ status: 'API is running' }));

// LOGIN
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px}input,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Bursar Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form></body></html>`);
});
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Login</title>
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}input,button{width:100%;padding:12px;margin:8px 0;box-sizing:border-box}button{background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer;font-size:16px}</style>
  </head><body><div class="card"><h2>Staff Login</h2>
  <form method="POST" action="/admin/login">
    <input name="username" placeholder="Username" required>
    <input type="password" name="password" placeholder="Password" required>
    <button type="submit">Login</button>
  </form>
  <p style="font-size:12px;color:#666;margin-top:20px">Default: admin/bursar123</p>
  </div></body></html>`);
});
app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  if (result.rows.length && await bcrypt.compare(password, result.rows[0].password)) {
    req.session.adminId = result.rows[0].id;
    res.redirect('/admin');
  } else {
    res.send('Invalid login. <a href="/admin/login">Try again</a>');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// DASHBOARD WITH CHARTS
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

// ADD STUDENT
app.get('/admin/students/add', requireLogin, (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Add Student</h2><form method="POST" action="/admin/students/add">
    <input name="name" placeholder="Student Name" required>
    <input name="class" placeholder="Class e.g P.6" required>
    <input name="term" placeholder="Term e.g term1" required>
    <input name="year" type="number" placeholder="Year e.g 2025" required>
    <input name="total_fees" type="number" placeholder="Total Fees UGX" required>
    <button type="submit">Save Student</button>
  </form><a href="/admin">Back</a></body></html>`);
});

app.post('/admin/students/add', requireLogin, async (req, res) => {
  const { name, class: cls, term, year, total_fees } = req.body;
  await pool.query(
    'INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1,$2,$3,$4,$5,$5)',
    [name, cls, term, year, total_fees]
  );
  res.redirect('/admin');
});

// ALL STUDENTS
app.get('/admin/students', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT * FROM students ORDER BY class, name');
  res.send(`<!DOCTYPE html><html><head><title>Students</title>
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}th{background:#34495e;color:white}</style>
  </head><body><h2>All Students</h2><a href="/admin">Dashboard</a><table>
    <tr><th>Name</th><th>Class</th><th>Term</th><th>Year</th><th>Total Fees</th><th>Balance</th><th></th></tr>
    ${students.rows.map(s => `
      <tr><td>${s.name}</td><td>${s.class}</td><td>${s.term}</td><td>${s.year}</td>
      <td>UGX ${Number(s.total_fees).toLocaleString()}</td>
      <td>UGX ${Number(s.balance).toLocaleString()}</td>
      <td><a href="/admin/students/${s.id}">View</a></td></tr>
    `).join('')}
  </table></body></html>`);
});

// VIEW STUDENT
app.get('/admin/students/:id', requireLogin, async (req, res) => {
  const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  const payments = await pool.query('SELECT * FROM payments WHERE student_id = $1 ORDER BY payment_date DESC', [req.params.id]);
  if (!student.rows.length) return res.send('Student not found');
  const s = student.rows[0];
  res.send(`<!DOCTYPE html><html><head><title>${s.name}</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}.btn{background:#3498db;color:white;padding:10px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd}</style>
  </head><body><a href="/admin/students">Back</a>
    <h2>${s.name} - ${s.class}</h2>
    <p><b>Term:</b> ${s.term} ${s.year} | <b>Total Fees:</b> UGX ${Number(s.total_fees).toLocaleString()} | <b>Balance:</b> UGX ${Number(s.balance).toLocaleString()}</p>
    <a href="/admin/students/${s.id}/statement" class="btn" target="_blank">Print Statement</a>
    <h3>Payment History</h3><table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
    ${payments.rows.map(p => `<tr><td>${new Date(p.payment_date).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method || '-'}</td><td>${p.reference || '-'}</td></tr>`).join('')}
    </table></body></html>`);
});

// PRINT STATEMENT
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

// RECORD PAYMENT
app.get('/admin/payments/add', requireLogin, async (req, res) => {
  const students = await pool.query('SELECT id, name, class, balance FROM students WHERE balance > 0 ORDER BY name');
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title>
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input,select,button{width:100%;padding:10px;margin:8px 0}</style>
  </head><body><h2>Record Payment</h2><form method="POST" action="/admin/payments/add">
    <select name="student_id" required><option value="">Select Student</option>
      ${students.rows.map(s => `<option value="${s.id}">${s.name} - ${s.class} - Bal: UGX ${Number(s.balance).toLocaleString()}</option>`).join('')}
    </select>
    <input name="amount" type="number" placeholder="Amount UGX" required>
    <input name="method" placeholder="Payment Method e.g MTN" required>
    <input name="reference" placeholder="Reference/TxID">
    <button type="submit">Save Payment</button>
  </form><a href="/admin">Back</a></body></html>`);
});

app.post('/admin/payments/add', requireLogin, async (req, res) => {
  const { student_id, amount, method, reference } = req.body;
  await pool.query('INSERT INTO payments (student_id, amount, method, reference) VALUES ($1,$2,$3,$4)', [student_id, amount, method, reference]);
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
  res.redirect('/admin');
});

// PAYMENT METHODS
app.get('/admin/payments/methods', requireLogin, async (req, res) => {
  const methods = await pool.query('SELECT * FROM payment_methods');
  res.send(`<!DOCTYPE html><html><head><title>Payment Methods</title>
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px}input,textarea,button{width:100%;padding:10px;margin:8px 0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #ddd}</style>
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

// PARENT PORTAL
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
app.get('/make-admin', async (req, res) => {
  const hash = await bcrypt.hash('bursar123', 10);
  await pool.query(`DELETE FROM admins WHERE username = 'admin'`);
  await pool.query(`INSERT INTO admins (username, password, role, full_name) VALUES ('admin', $1, 'admin', 'System Admin')`, [hash]);
  await pool.query(`INSERT INTO user_permissions (username, can_manage_users, can_manage_terms, can_view_reports, can_record_payments, can_manage_students) VALUES ('admin', true, true, true, true, true) ON CONFLICT (username) DO UPDATE SET can_manage_users = true, can_manage_terms = true`);
  res.send('Admin created. Username: admin | Password: bursar123. DELETE THIS ROUTE NOW!');
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));