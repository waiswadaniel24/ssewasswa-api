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
app.set('trust proxy', 1) // BEFORE session
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
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
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bursar Admin</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; font-family: system-ui, sans-serif; }
        body { max-width: 600px; margin: 20px auto; padding: 20px; background: #f5f5f5; }
        h1 { color: #1a1a1a; }
        form, .card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        input, select { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ddd; border-radius: 4px; }
        button { width: 100%; padding: 12px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
        button:hover { background: #1d4ed8; }
        #students p { padding: 10px; border-bottom: 1px solid #eee; margin: 0; cursor: pointer; }
        #students p:hover { background: #f0f0f0; }
        .logout { background: #dc2626; margin-top: 20px; }
        .logout:hover { background: #b91c1c; }
        .success { color: #16a34a; font-weight: 600; }
      </style>
    </head>
    <body>
      <h1>Bursar Admin</h1>
      <div id="login-box">
        <form id="login">
          <input name="username" placeholder="Username" value="bursar" required>
          <input name="password" type="password" placeholder="Password" value="bursar123" required>
          <button>Login</button>
        </form>
      </div>

      <div id="dashboard" style="display:none">
        <h2>Welcome <span id="user"></span></h2>
        
        <form id="addStudent">
          <h3>Add Student</h3>
          <input name="name" placeholder="Student Name" required>
          <input name="class" placeholder="Class e.g P.6" required>
          <input name="balance" type="number" placeholder="Starting Balance" value="0">
          <button>Add Student</button>
        </form>
       <h3>Payment Methods</h3>
<form id="addMethod">
  <select name="type" required>
    <option value="">Select Type</option>
    <option value="mtn">MTN Mobile Money</option>
    <option value="airtel">Airtel Money</option>
    <option value="bank">Bank Transfer</option>
  </select>
  <input name="name" placeholder="Display Name e.g MTN Pay" required>
  <input name="account_number" placeholder="Number: 0772123456 or Bank Acc" required>
  <input name="account_name" placeholder="Account Name" required>
  <input name="instructions" placeholder="Use StudentName-Class as reference">
  <button>Add Method</button>
</form>
<div id="methodsList"></div>

<!-- prettier-ignore -->
<script>
async function loadMethods() {
  const res = await fetch('/api/payment-methods');
  const methods = await res.json();
  document.getElementById('methodsList').innerHTML = methods.map(m => `
    < p > <b>${m.name}</b> - ${ m.account_number }
  < button onclick = "deleteMethod(${m.id})" > Delete</button ></p >
  `).join('');
}
loadMethods();

document.getElementById('addMethod').onsubmit = async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  await fetch('/api/payment-methods', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(Object.fromEntries(form))
  });
  e.target.reset();
  loadMethods();
};

async function deleteMethod(id) {
  await fetch(`/ api / payment - methods / ${ id }`, {method: 'DELETE'});
  loadMethods();
}
</script>
        <div class="card">
          <h3>Record Payment</h3>
          <form id="addPayment">
            <select name="student_id" id="studentSelect" required>
              <option value="">Select Student</option>
            </select>
            <input name="amount" type="number" placeholder="Amount Paid" required>
            <input name="paid_by" placeholder="Paid By - e.g Parent Name" required>
            <select name="method">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank</option>
            </select>
            <button>Record Payment</button>
          </form>
          <div id="payMsg"></div>
        </div>

        <div class="card">
          <h3>Students List</h3>
          <div id="students"></div>
        </div>
        
        <button class="logout" onclick="logout()">Logout</button>
      </div>

      <script>
        async function check() {
          try {
            const res = await fetch('/api/admin/check', {credentials: 'include'});
            if(res.ok) {
              const data = await res.json();
              document.getElementById('login-box').style.display = 'none';
              document.getElementById('dashboard').style.display = 'block';
              document.getElementById('user').innerText = data.username;
              loadStudents();
            }
          } catch(e) { console.log('Not logged in'); }
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
          else alert('Invalid credentials');
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
          } else alert('Failed to add student');
        }

        document.getElementById('addPayment').onsubmit = async (e) => {
          e.preventDefault();
          const form = new FormData(e.target);
          const res = await fetch('/api/payments', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'include',
            body: JSON.stringify({
              student_id: parseInt(form.get('student_id')),
              amount: parseInt(form.get('amount')),
              paid_by: form.get('paid_by'),
              method: form.get('method')
            })
          });
          if(res.ok) {
            document.getElementById('payMsg').innerHTML = '<p class="success">Payment recorded!</p>';
            e.target.reset();
            loadStudents();
            setTimeout(() => document.getElementById('payMsg').innerHTML = '', 3000);
          } else alert('Payment failed');
        }

        async function loadStudents() {
          const res = await fetch('/api/students', {credentials: 'include'});
          const students = await res.json();
          document.getElementById('students').innerHTML = students.map(s =>
            \`<p><b>\${s.name}</b> - \${s.class} - Balance: UGX \${s.balance.toLocaleString()}</p>\`
          ).join('') || '<p>No students yet</p>';
          
          document.getElementById('studentSelect').innerHTML = 
            '<option value="">Select Student</option>' + 
            students.map(s => \`<option value="\${s.id}">\${s.name} - \${s.class} - UGX \${s.balance}</option>\`).join('');
        }

        function logout() {
          document.cookie = 'connect.sid=; Max-Age=0; path=/; domain=' + location.hostname;
          location.reload();
        }

        check();
      </script>
    </body>
    </html>
  `);
});
app.get('/parent', (req, res) => {
  res.send(`
    <h1>Parent Portal - Check Fees Balance</h1>
    <form id="search">
      <input name="name" placeholder="Student Name" required>
      <input name="class" placeholder="Class e.g P.6" required>
      <button>Check Balance</button>
    </form>
    <div id="result"></div>

    <script>
      document.getElementById('search').onsubmit = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = form.get('name');
        const className = form.get('class');
        const res = await fetch(\`/api/student-balance?name=\${name}&class=\${className}\`);
        const data = await res.json();
        if(res.ok) {
          document.getElementById('result').innerHTML = \`
            <h3>\${data.name} - \${data.class}</h3>
            <p><b>Balance: UGX \${data.balance}</b></p>
            <p>\${data.balance > 0? 'Please clear balance' : 'Account is clear'}</p>
          \`;
        } else {
          document.getElementById('result').innerHTML = '<p style="color:red">Student not found</p>';
        }
      }
    </script>
  `);
});

// Public API route for parents - no login needed
app.get('/api/student-balance', async (req, res) => {
  const { name, class: className } = req.query;
  try {
    const result = await pool.query(
      'SELECT name, class, balance FROM students WHERE LOWER(name) = LOWER($1) AND LOWER(class) = LOWER($2)',
      [name, className]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Student not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
})

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

app.post('/api/students', async (req, res) => {
  const { name, class: className, balance } = req.body;
  try {
    const exists = await pool.query(
      'SELECT id FROM students WHERE LOWER(name) = LOWER($1) AND LOWER(class) = LOWER($2)',
      [name, className]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Student already exists in that class' });
    }

    const result = await pool.query(
      'INSERT INTO students (name, class, balance) VALUES ($1, $2, $3) RETURNING *',
      [name, className, balance]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
// Check if bursar is logged in
app.get('/api/admin/check', (req, res) => {
  if (req.session.user && req.session.user.role === 'bursar') {
    res.json({ loggedIn: true, username: req.session.user.username });
  } else {
    res.status(401).json({ loggedIn: false });
  }
})
app.get('/api/admin/check', (req, res) => {
  if (req.session.user && req.session.user.role === 'bursar') {
    res.json({ loggedIn: true, username: req.session.user.username });
  } else {
    res.status(401).json({ loggedIn: false });
  }
})
// Record payment and update student balance
app.post('/api/payments', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'bursar') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { student_id, amount, paid_by, method } = req.body;

  try {
    // 1. Insert payment record
    await pool.query(
      `INSERT INTO payments (student_id, amount, paid_by, method, created_at) 
       VALUES ($1, $2, $3, $4, NOW())`,
      [student_id, amount, paid_by, method]
    );

    // 2. Reduce student balance
    await pool.query(
      `UPDATE students SET balance = balance - $1 WHERE id = $2`,
      [amount, student_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment failed' });
  }
})
// Get all payment methods
app.get('/api/payment-methods', async (req, res) => {
  const result = await pool.query('SELECT * FROM payment_methods WHERE active=true ORDER BY id');
  res.json(result.rows);
});

// Add payment method
app.post('/api/payment-methods', async (req, res) => {
  const { name, type, account_number, account_name, instructions } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO payment_methods (name, type, account_number, account_name, instructions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, type, account_number, account_name, instructions]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete method
app.delete('/api/payment-methods/:id', async (req, res) => {
  await pool.query('UPDATE payment_methods SET active=false WHERE id=$1', [req.params.id]);
  res.sendStatus(200);
});

// Universal payment webhook
app.post('/api/payment-webhook', async (req, res) => {
  try {
    const { amount, reference, status, provider } = req.body;

    if (status !== 'SUCCESSFUL' && status !== 'success') return res.sendStatus(200);

    const cleanRef = reference.toLowerCase().replace(/-/g, ' ').trim();
    const parts = cleanRef.split(' ');
    const className = parts.pop();
    const name = parts.join(' ');

    const student = await pool.query(
      'SELECT id, balance FROM students WHERE LOWER(name)=$1 AND LOWER(class)=$2',
      [name, className]
    );

    if (student.rows.length === 0) return res.sendStatus(200);

    const studentId = student.rows[0].id;
    const newBalance = student.rows[0].balance - parseInt(amount);
    const method = await pool.query('SELECT id FROM payment_methods WHERE type=$1 AND active=true LIMIT 1', [provider]);

    await pool.query(
      `INSERT INTO payments (student_id, amount, method_id, transaction_ref, auto_recorded)
       VALUES ($1, $2, $3, $4, true)`,
      [studentId, amount, method.rows[0]?.id, reference]
    );

    await pool.query('UPDATE students SET balance=$1 WHERE id=$2', [newBalance, studentId]);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})