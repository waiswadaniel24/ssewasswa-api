const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const session = require('express-session')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.set('trust proxy', 1)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: true, sameSite: 'none', httpOnly: true, maxAge: 86400000 }
}))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// AUTO-CREATE ALL TABLES ON STARTUP
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'bursar',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, class)
    );
    CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      account_number TEXT,
      account_name TEXT,
      instructions TEXT,
      active BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id),
      amount INTEGER NOT NULL,
      method TEXT DEFAULT 'cash',
      method_id INT REFERENCES payment_methods(id),
      paid_by TEXT,
      transaction_ref TEXT,
      auto_recorded BOOLEAN DEFAULT false,
      verified_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const hash = await bcrypt.hash('bursar123', 10);
  await pool.query(`INSERT INTO users (username, password, role) VALUES ('bursar', $1, 'bursar') ON CONFLICT (username) DO NOTHING`, [hash]);
  console.log('✅ Database ready');
}
initDB();

function requireBursar(req, res, next) {
  if (req.session.user?.role === 'bursar') next();
  else res.status(403).json({ error: 'Login required' });
}

app.get('/health', (req, res) => res.json({ status: 'OK' }))

// AUTH
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (user.rows[0] && await bcrypt.compare(password, user.rows[0].password)) {
    req.session.user = user.rows[0];
    res.json({ success: true });
  } else res.status(401).json({ error: 'Invalid credentials' });
})

app.get('/api/admin/check', (req, res) => {
  if (req.session.user?.role === 'bursar') res.json({ loggedIn: true, username: req.session.user.username });
  else res.status(401).json({ loggedIn: false });
})

// STUDENTS
app.post('/api/students', requireBursar, async (req, res) => {
  const { name, class: c, balance = 0 } = req.body;
  try {
    const r = await pool.query('INSERT INTO students (name, class, balance) VALUES ($1, $2, $3) RETURNING *', [name, c, balance]);
    res.json(r.rows[0]);
  } catch (e) { res.status(400).json({ error: 'Student exists in that class' }); }
});

app.get('/api/students', requireBursar, async (req, res) => {
  const r = await pool.query('SELECT * FROM students ORDER BY name');
  res.json(r.rows);
})

// PAYMENTS - MANUAL
app.post('/api/payments', requireBursar, async (req, res) => {
  const { student_id, amount, method, paid_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO payments (student_id, amount, method, paid_by, verified_by) VALUES ($1, $2, $3, $4, $5)',
      [student_id, amount, method, paid_by, req.session.user.id]);
    await client.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Payment failed' });
  } finally { client.release(); }
})

// PAYMENT METHODS - EDITABLE BY ADMIN
app.get('/api/payment-methods', async (req, res) => {
  const r = await pool.query('SELECT * FROM payment_methods WHERE active=true ORDER BY id');
  res.json(r.rows);
});

app.post('/api/payment-methods', requireBursar, async (req, res) => {
  const { name, type, account_number, account_name, instructions } = req.body;
  const r = await pool.query(
    'INSERT INTO payment_methods (name, type, account_number, account_name, instructions) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, type, account_number, account_name, instructions]
  );
  res.json(r.rows[0]);
});

app.delete('/api/payment-methods/:id', requireBursar, async (req, res) => {
  await pool.query('UPDATE payment_methods SET active=false WHERE id=$1', [req.params.id]);
  res.sendStatus(200);
});

// AUTO-RECORD WEBHOOK - FOR MTN/AIRTEL API
app.post('/api/payment-webhook', async (req, res) => {
  try {
    const { amount, reference, status, provider } = req.body;
    if (status!== 'SUCCESSFUL' && status!== 'success') return res.sendStatus(200);
    const ref = reference.toLowerCase().replace(/-/g, ' ').trim();
    const parts = ref.split(' ');
    const className = parts.pop();
    const name = parts.join(' ');
    const student = await pool.query('SELECT id, balance FROM students WHERE LOWER(name)=$1 AND LOWER(class)=$2', [name, className]);
    if (!student.rows[0]) return res.sendStatus(200);
    const method = await pool.query('SELECT id FROM payment_methods WHERE type=$1 AND active=true LIMIT 1', [provider]);
    await pool.query('INSERT INTO payments (student_id, amount, method_id, transaction_ref, auto_recorded) VALUES ($1, $2, $3, $4, true)',
      [student.rows[0].id, amount, method.rows[0]?.id, reference]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student.rows[0].id]);
    res.sendStatus(200);
  } catch (e) { res.sendStatus(500); }
});

// PARENT PORTAL
app.get('/api/student-balance', async (req, res) => {
  const { name, class: c } = req.query;
  const r = await pool.query('SELECT name, class, balance FROM students WHERE LOWER(name) = LOWER($1) AND LOWER(class) = LOWER($2)', [name, c]);
  if (r.rows[0]) res.json(r.rows[0]);
  else res.status(404).json({ error: 'Student not found' });
})

// FRONTEND
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Bursar Admin</title><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>*{box-sizing:border-box;font-family:system-ui}body{max-width:600px;margin:20px auto;padding:20px;background:#f5f5f5}
  form,.card{background:white;padding:20px;border-radius:8px;margin:20px 0;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  input,select{width:100%;padding:10px;margin:8px 0;border:1px solid #ddd;border-radius:4px}
  button{width:100%;padding:12px;background:#2563eb;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600}
 .delete{background:#dc2626;width:auto;padding:6px 12px;margin-left:10px}.logout{background:#dc2626;margin-top:20px}
  p{padding:10px;border-bottom:1px solid #eee;margin:0}.success{color:#16a34a;font-weight:600}</style></head><body>
  <h1>Bursar Admin</h1><div id="login-box"><form id="login"><input name="username" placeholder="Username" value="bursar" required>
  <input name="password" type="password" placeholder="Password" value="bursar123" required><button>Login</button></form></div>
  <div id="dashboard" style="display:none"><h2>Welcome <span id="user"></span></h2>
  <form id="addStudent"><h3>Add Student</h3><input name="name" placeholder="Student Name" required>
  <input name="class" placeholder="Class e.g P.6" required><input name="balance" type="number" placeholder="Starting Balance" value="0">
  <button>Add Student</button></form><h3>Payment Methods</h3><form id="addMethod"><select name="type" required>
  <option value="">Select Type</option><option value="mtn">MTN Mobile Money</option><option value="airtel">Airtel Money</option>
  <option value="bank">Bank Transfer</option></select><input name="name" placeholder="Display Name e.g MTN Pay" required>
  <input name="account_number" placeholder="Number: 0772123456" required><input name="account_name" placeholder="Account Name" required>
  <input name="instructions" placeholder="Use StudentName-Class as reference"><button>Add Method</button></form><div id="methodsList"></div>
  <div class="card"><h3>Record Payment</h3><form id="addPayment"><select name="student_id" id="studentSelect" required>
  <option value="">Select Student</option></select><input name="amount" type="number" placeholder="Amount Paid" required>
  <input name="paid_by" placeholder="Paid By" required><select name="method"><option value="cash">Cash</option>
  <option value="mobile_money">Mobile Money</option><option value="bank">Bank</option></select><button>Record Payment</button></form>
  <div id="payMsg"></div></div><div class="card"><h3>Students List</h3><div id="students"></div></div>
  <button class="logout" onclick="logout()">Logout</button></div><script>
  async function check(){try{const r=await fetch('/api/admin/check',{credentials:'include'});if(r.ok){const d=await r.json();
  document.getElementById('login-box').style.display='none';document.getElementById('dashboard').style.display='block';
  document.getElementById('user').innerText=d.username;loadStudents();loadMethods();}}catch(e){}}
  document.getElementById('login').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);
  const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
  body:JSON.stringify({username:f.get('username'),password:f.get('password')})});if(r.ok)check();else alert('Invalid credentials');}
  document.getElementById('addStudent').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);
  const r=await fetch('/api/students',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
  body:JSON.stringify({name:f.get('name'),class:f.get('class'),balance:parseInt(f.get('balance'))})});
  if(r.ok){e.target.reset();loadStudents();}else{const err=await r.json();alert(err.error);}}
  document.getElementById('addPayment').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);
  const r=await fetch('/api/payments',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
  body:JSON.stringify({student_id:parseInt(f.get('student_id')),amount:parseInt(f.get('amount')),paid_by:f.get('paid_by'),method:f.get('method')})});
  if(r.ok){document.getElementById('payMsg').innerHTML='<p class="success">Payment recorded!</p>';e.target.reset();loadStudents();
  setTimeout(()=>document.getElementById('payMsg').innerHTML='',3000);}else alert('Payment failed');}
  async function loadStudents(){const r=await fetch('/api/students',{credentials:'include'});const s=await r.json();
  document.getElementById('students').innerHTML=s.map(x=>\`<p><b>\${x.name}</b> - \${x.class} - Balance: UGX \${x.balance.toLocaleString()}</p>\`).join('')||'<p>No students</p>';
  document.getElementById('studentSelect').innerHTML='<option value="">Select Student</option>'+s.map(x=>\`<option value="\${x.id}">\${x.name} - \${x.class} - UGX \${x.balance}</option>\`).join('');}
  async function loadMethods(){const r=await fetch('/api/payment-methods');const m=await r.json();
  document.getElementById('methodsList').innerHTML=m.map(x=>\`<p><b>\${x.name}</b> - \${x.account_number}<button class="delete" onclick="deleteMethod(\${x.id})">Delete</button></p>\`).join('');}
  document.getElementById('addMethod').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);
  await fetch('/api/payment-methods',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(Object.fromEntries(f))});
  e.target.reset();loadMethods();};async function deleteMethod(id){await fetch(\`/api/payment-methods/\${id}\`,{method:'DELETE',credentials:'include'});loadMethods();}
  function logout(){document.cookie='connect.sid=; Max-Age=0; path=/';location.reload();}check();</script></body></html>`);
});

app.get('/parent', (req, res) => {
  res.send(`<h1>Parent Portal - Check Fees Balance</h1><form id="search"><input name="name" placeholder="Student Name" required>
  <input name="class" placeholder="Class e.g P.6" required><button>Check Balance</button></form><div id="result"></div>
  <script>document.getElementById('search').onsubmit=async(e)=>{e.preventDefault();const f=new FormData(e.target);
  const r=await fetch(\`/api/student-balance?name=\${f.get('name')}&class=\${f.get('class')}\`);const d=await r.json();
  if(r.ok){document.getElementById('result').innerHTML=\`<h3>\${d.name} - \${d.class}</h3><p><b>Balance: UGX \${d.balance}</b></p>
  <p>\${d.balance>0?'Please clear balance':'Account is clear'}</p>\`;}else{document.getElementById('result').innerHTML='<p style="color:red">Student not found</p>';}}</script>`);
});

app.get('/', (req, res) => res.send('<h1>Ssewasswa API</h1><a href="/admin">Admin Login</a> | <a href="/parent">Parent Portal</a>'));

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`))