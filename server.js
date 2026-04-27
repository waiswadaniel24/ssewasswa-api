const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const session = require('express-session')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: true,      // Required for HTTPS on Render
    sameSite: 'none',  // Required for fetch with credentials
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'teacher',
        can_view_finances INTEGER DEFAULT 0,
        can_verify_payments INTEGER DEFAULT 0,
        can_view_reports INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const hash = await bcrypt.hash('bursar123', 10);
    await client.query(
      `INSERT INTO users (username, password, role, can_view_finances, can_verify_payments, can_view_reports)
       VALUES ('bursar', $1, 'bursar', 1, 1, 1)
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    console.log('✅ Bursar user ready');
  } catch (err) {
    console.error('DB init error:', err.message);
  } finally {
    client.release();
  }
}
initDB();

app.get('/health', (req, res) => {
  res.json({ status: 'API is running' })
})

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = user;
      res.json({ success: true, role: user.role });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
})

app.get('/admin', (req, res) => {
  res.send(`
    <h1>Bursar Admin</h1>
    <div id="login-box">
      <form id="login">
        <input name="username" placeholder="Username" value="bursar">
        <input name="password" type="password" placeholder="Password" value="bursar123">
        <button>Login</button>
      </form>
    </div>

    <div id="dashboard" style="display:none">
      <h2>Welcome <span id="user"></span></h2>
      <button onclick="logout()">Logout</button>

      <h3>Add Student</h3>
      <form id="addStudent">
        <input name="name" placeholder="Student Name" required>
        <input name="class" placeholder="Class e.g P.6" required>
        <input name="balance" type="number" placeholder="Starting Balance" value="0">
        <button>Add Student</button>
      </form>

      <h3>Students List</h3>
      <div id="students"></div>
    </div>

    <script>
      async function check() {
        const res = await fetch('/api/admin/check', {credentials: 'include'});
        if(res.ok) {
          const data = await res.json();
          document.getElementById('login-box').style.display = 'none';
          document.getElementById('dashboard').style.display = 'block';
          document.getElementById('user').innerText = data.username;
          loadStudents();
        }
      }

      document.getElementById('login').onsubmit = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'include',
          body: JSON.stringify({
            username: form.get('username'),
            password: form.get('password')
          })
        });
        if(res.ok) check();
        else alert('Login failed');
      }

      document.getElementById('addStudent').onsubmit = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          credentials: 'include',
          body: JSON.stringify({
            name: form.get('name'),
            class: form.get('class'),
            balance: parseInt(form.get('balance'))
          })
        });
        if(res.ok) {
          e.target.reset();
          loadStudents();
        } else {
          alert('Failed to add student');
        }
      }

      async function loadStudents() {
        const res = await fetch('/api/students', {credentials: 'include'});
        const students = await res.json();
        document.getElementById('students').innerHTML = students.map(s =>
          \`<p><b>\${s.name}</b> - \${s.class} - Balance: UGX \${s.balance}</p>\`
        ).join('') || 'No students yet';
      }

      function logout() {
        document.cookie = 'connect.sid=; Max-Age=0; path=/';
        location.reload();
      }

      check();
    </script>
  `);
});
app.get('/parent', (req, res) => {
  res.send('<h1>Parent Portal - Coming Soon</h1>');
});

app.get('/', (req, res) => {
  res.send('<h1>Ssewasswa API</h1><a href="/admin">Admin Login</a> | <a href="/parent">Parent</a>');
});
// ===== STUDENTS + PAYMENTS =====
async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      balance INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id),
      amount INTEGER NOT NULL,
      method TEXT DEFAULT 'cash',
      paid_by TEXT,
      verified_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ Students + Payments tables ready');
}
initTables();

function requireBursar(req, res, next) {
  if (req.session.user && req.session.user.role === 'bursar') {
    next();
  } else {
    res.status(403).json({ error: 'Bursar access required' });
  }
}

app.post('/api/students', requireBursar, async (req, res) => {
  const { name, class: className, balance = 0 } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO students (name, class, balance) VALUES ($1, $2, $3) RETURNING *',
      [name, className, balance]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add student' });
  }
})

app.get('/api/students', requireBursar, async (req, res) => {
  const result = await pool.query('SELECT * FROM students ORDER BY name');
  res.json(result.rows);
})

app.post('/api/payments', requireBursar, async (req, res) => {
  const { student_id, amount, method = 'cash', paid_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query(
      `INSERT INTO payments (student_id, amount, method, paid_by, verified_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [student_id, amount, method, paid_by, req.session.user.id]
    );
    await client.query(
      'UPDATE students SET balance = balance - $1 WHERE id = $2',
      [amount, student_id]
    );
    await client.query('COMMIT');
    res.json(payment.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Payment failed' });
  } finally {
    client.release();
  }
})
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})