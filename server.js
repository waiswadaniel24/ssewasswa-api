const rateLimit = require('express-rate-limit');
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
app.use(express.static('public')); // add this line
// Rate limiting: stop brute force on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/admin/login', loginLimiter);

// Audit log table - run once in psql
// CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, username VARCHAR(255), action TEXT, details JSONB, created_at TIMESTAMP DEFAULT NOW());

// Audit log helper
async function logAction(username, action, details = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (username, action, details) VALUES ($1, $2, $3)',
      [username, action, details]
    );
  } catch (e) { console.error('Audit log failed:', e); }
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

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
  `);
  console.log('✅ Database ready');
}
initDB();

// MIDDLEWARE - MOVED UP BEFORE ROUTES
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/admin/login');
}

function requirePermission(perm) {
  return async (req, res, next) => {
    if (req.session.user.role === 'admin') return next();
    const result = await pool.query('SELECT * FROM user_permissions WHERE username = $1', [req.session.user.username]);
    if (result.rows[0] && result.rows[0][perm] === true) return next();
    res.status(403).send('You do not have permission for this task');
  };
}

// HEALTH
app.get('/health', (req, res) => res.json({ status: 'API is running' }));

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
    req.session.user = {
      id: result.rows[0].id,
      username: result.rows[0].username,
      role: result.rows[0].role || 'bursar'
    };
    res.redirect('/admin');
  } else {
    res.send('Invalid login. <a href="/admin/login">Try again</a>');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// DASHBOARD WITH CHARTS
app.get('/admin', requireAuth, async (req, res) => {
  const role = req.session.user.role;

  if (role === 'admin') {
    return res.send(`<!DOCTYPE html><html><head><title>Admin Dashboard</title>
    <style>body{font-family:Arial;max-width:800px;margin:50px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}.btn{background:#3498db;color:white;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:10px 10px 0 0}</style>
    </head><body><div class="card">
      <h1>Admin Dashboard</h1>
      <p>Logged in as: ${req.session.user.username}</p>
      <a href="/admin/permissions" class="btn">Manage User Permissions</a>
      <a href="/admin/students" class="btn">Manage Students</a>
      <a href="/admin/payments/add" class="btn">Record Payment</a>
      <a href="/admin/logout" class="btn" style="background:#e74c3c">Logout</a>
    </div></body></html>`);
  }

  if (role === 'bursar') {
    const stats = await pool.query(`SELECT COUNT(*) as total_students, COALESCE(SUM(total_fees),0) as total_fees, COALESCE(SUM(balance),0) as total_balance FROM students`);
    const payStats = await pool.query(`SELECT COUNT(*) as total_payments, COALESCE(SUM(amount),0) as total_collected FROM payments`);
    const s = stats.rows[0];
    const p = payStats.rows[0];

    return res.send(`<!DOCTYPE html><html><head><title>Dashboard</title>
    <style>body{font-family:Arial;margin:0;background:#f4f6f9;padding:20px}.container{max-width:1400px;margin:auto}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:20px}.card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}.card h3{margin:0 0 10px 0;color:#666;font-size:14px;font-weight:normal}.num{font-size:32px;font-weight:bold;color:#2c3e50}.btn{background:#3498db;color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px 5px 0}.btn-red{background:#e74c3c}</style></head><body><div class="container">
      <div class="header"><h1>Ssewasswa Primary - Bursar Dashboard</h1><a href="/admin/logout" class="btn btn-red">Logout</a></div>
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
    </div></body></html>`);
  }

  res.send('Access denied. Unknown role.');
});

// PERMISSIONS MANAGEMENT ROUTE - FIXED
app.get('/admin/permissions', requireAuth, requirePermission('can_manage_users'), async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT a.username, a.role,
             COALESCE(p.can_manage_users, false) as can_manage_users,
             COALESCE(p.can_manage_terms, true) as can_manage_terms,
             COALESCE(p.can_view_reports, true) as can_view_reports,
             COALESCE(p.can_record_payments, true) as can_record_payments,
             COALESCE(p.can_manage_students, true) as can_manage_students
      FROM admins a
      LEFT JOIN user_permissions p ON a.username = p.username
      WHERE a.role NOT IN ('admin')
      ORDER BY a.role, a.username
    `);

    res.send(`<!DOCTYPE html><html><head><title>User Permissions</title>
    <style>
      body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}
     .card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
      table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:12px;text-align:left;border-bottom:1px solid #eee}
      th{background:#34495e;color:white}
      input[type=checkbox]{transform:scale(1.3);cursor:pointer}
     .btn{background:#3498db;color:white;padding:8px 12px;text-decoration:none;border-radius:4px}
    </style>
    <script>
      async function updatePerm(username, permission, checked) {
        const res = await fetch('/admin/permissions/update', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({username, permission, value: checked})
        });
        if(!res.ok) alert('Failed to update');
      }
    </script>
    </head><body><div class="card">
      <a href="/admin" class="btn">Back to Dashboard</a>
      <h2>Manage User Permissions</h2>
      <table>
        <tr><th>Username</th><th>Role</th><th>Manage Users</th><th>Terms</th><th>Reports</th><th>Payments</th><th>Students</th></tr>
        ${users.rows.map(u => `
          <tr>
            <td>${u.username}</td>
            <td>${u.role}</td>
            <td><input type="checkbox" ${u.can_manage_users? 'checked' : ''} onchange="updatePerm('${u.username}','can_manage_users',this.checked)"></td>
            <td><input type="checkbox" ${u.can_manage_terms? 'checked' : ''} onchange="updatePerm('${u.username}','can_manage_terms',this.checked)"></td>
            <td><input type="checkbox" ${u.can_view_reports? 'checked' : ''} onchange="updatePerm('${u.username}','can_view_reports',this.checked)"></td>
            <td><input type="checkbox" ${u.can_record_payments? 'checked' : ''} onchange="updatePerm('${u.username}','can_record_payments',this.checked)"></td>
            <td><input type="checkbox" ${u.can_manage_students? 'checked' : ''} onchange="updatePerm('${u.username}','can_manage_students',this.checked)"></td>
          </tr>
        `).join('')}
      </table>
      ${users.rows.length === 0? '<p>No other users yet. Create a bursar account first.</p>' : ''}
    </div></body></html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/admin/permissions/update', requireAuth, requirePermission('can_manage_users'), async (req, res) => {
  const { username, permission, value } = req.body;
  await pool.query(`
    INSERT INTO user_permissions (username, ${permission})
    VALUES ($1, $2)
    ON CONFLICT (username) DO UPDATE SET ${permission} = $2
  `, [username, value === true || value === 'true']);
  res.json({ success: true });
});

// OTHER ROUTES...
app.get('/admin/students/add', requireAuth, (req, res) => {
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

app.post('/admin/students/add', requireAuth, async (req, res) => {
  const { name, class: cls, term, year, total_fees } = req.body;
  await pool.query(
    'INSERT INTO students (name, class, term, year, total_fees, balance) VALUES ($1,$2,$3,$4,$5,$5)',
    [name, cls, term, year, total_fees]
  );
  res.redirect('/admin');
});

app.get('/admin/students', requireAuth, async (req, res) => {
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

app.get('/admin/students/:id', requireAuth, async (req, res) => {
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

app.get('/admin/students/:id/statement', requireAuth, async (req, res) => {
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

app.get('/admin/payments/add', requireAuth, async (req, res) => {
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

app.post('/admin/payments/add', requireAuth, async (req, res) => {
  try {
    const { student_id, amount, method, reference } = req.body;
    await pool.query('INSERT INTO payments (student_id, amount, method, reference) VALUES ($1,$2,$3,$4)', [student_id, amount, method, reference]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
    
    await logAction(req.session.user.username, 'RECORD_PAYMENT', { student_id, amount, method, reference });
    
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

app.get('/admin/payments/methods', requireAuth, async (req, res) => {
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

app.post('/admin/payments/methods', requireAuth, async (req, res) => {
  const { type, name, number, account_name, instructions } = req.body;
  await pool.query('INSERT INTO payment_methods (type, name, number, account_name, instructions) VALUES ($1,$2,$3,$4,$5)', [type, name, number, account_name, instructions]);
  res.redirect('/admin/payments/methods');
});

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
app.post('/admin/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await pool.query('SELECT password FROM admins WHERE username = $1', [req.session.user.username]);
    const match = await bcrypt.compare(oldPassword, user.rows[0].password);
    if (!match) return res.status(400).send('Old password incorrect');

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admins SET password = $1 WHERE username = $2', );
    await logAction(req.session.user.username, 'PASSWORD_CHANGE', { ip: req.ip });
    res.send('Password changed');
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));