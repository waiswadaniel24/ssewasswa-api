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
  saveUninitialized: false
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
    <div id="app">
      <form id="login">
        <input name="username" placeholder="Username" value="bursar">
        <input name="password" type="password" placeholder="Password" value="bursar123">
        <button>Login</button>
      </form>
      <div id="dashboard" style="display:none">
        <h2>Welcome <span id="user"></span></h2>
        <button onclick="logout()">Logout</button>
        <h3>Students</h3>
        <div id="students"></div>
      </div>
    <script>
      async function check() {
        const res = await fetch('/api/admin/check', {credentials: 'include'});
        if(res.ok) {
          const data = await res.json();
          document.getElementById('login').style.display = 'none';
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
      
      async function loadStudents() {
        const res = await fetch('/api/students', {credentials: 'include'});
        const students = await res.json();
        document.getElementById('students').innerHTML = students.map(s => 
          \`<p>\${s.name} - \${s.class} - Balance: \${s.balance}</p>\`
        ).join('') || 'No students yet';
      }
      
      function logout() {
        document.cookie = 'connect.sid=; Max-Age=0';
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})