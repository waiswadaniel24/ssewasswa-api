const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Parser = require('rss-parser');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});
const parser = new Parser();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

function renderPage(title, content, user = null) {
  const nav = user? `
    <div style="background:#1e40af;color:white;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px">
      <div><strong>${user.tenant_name || 'SSEWASSWA'}</strong></div>
      <div>
        <a href="/app" style="color:white;margin:0 12px;text-decoration:none">Dashboard</a>
        <a href="/app/students" style="color:white;margin:0 12px;text-decoration:none">Students</a>
        <a href="/app/fees" style="color:white;margin:0 12px;text-decoration:none">Fees</a>
        <a href="/logout" style="color:white;margin:0 12px;text-decoration:none">Logout</a>
      </div>
    </div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
    body{font-family:system-ui;background:#f8fafc;color:#1e293b;margin:0;padding:24px}
   .card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;max-width:900px;margin:0 auto 16px}
   .btn{background:#1e40af;color:white;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px}
   .btn-green{background:#16a34a}.btn-red{background:#dc2626}
    input,select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin:8px 0 12px;box-sizing:border-box}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9}
   .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
   .stat-card{background:white;padding:20px;border-radius:12px;border:1px solid #e2e8f0}
   .stat-num{font-size:32px;font-weight:bold;color:#1e40af}
  </style></head><body>${nav}${content}</body></html>`;
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.tenant) req.tenant = req.session.tenant;
  return next();
};

async function requireTenant(req, res, next) {
  try {
    const host = req.headers.host || '';
    const sub = host.split('.')[0];
    const effectiveSub = sub === 'localhost' || host.includes('onrender') || sub === '127'? 'main' : sub;
    const result = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [effectiveSub]);
    if (!result.rows[0]) return res.status(404).send('Tenant not found');
    req.tenant = result.rows[0];
    req.tenantId = result.rows[0].id;
    return next();
  } catch (err) {
    return res.status(500).send('Tenant lookup failed');
  }
};

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role!== role) return res.status(403).send('Forbidden');
  return next();
};

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = ['chat_messages','news_cache','feedback_messages','feedback_threads','comments','grants','donor_campaigns','donations','surveys','grades','attendance','fees','students','password_resets','users','revenue_log','settings','courses','order_items','orders','cart_items','market_items','wallets','tenants','db_init_lock'];
    for (const table of tables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await client.query('CREATE TABLE tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT \'free\', plan_expires DATE, ranking_score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT \'staff\', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, description TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE market_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, seller_email TEXT, status TEXT DEFAULT \'active\', image_url TEXT, stock INTEGER DEFAULT 1, category TEXT DEFAULT \'general\', created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE cart_items (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, item_id INTEGER REFERENCES market_items(id) ON DELETE CASCADE, quantity INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, total_amount NUMERIC NOT NULL, status TEXT DEFAULT \'pending\', payment_method TEXT, momo_number TEXT, delivery_address TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, item_id INTEGER REFERENCES market_items(id) ON DELETE SET NULL, quantity INTEGER NOT NULL, price NUMERIC NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, site_name TEXT DEFAULT \'SSEWASSWA FOUNDATION UGANDA\', primary_color TEXT DEFAULT \'#1e40af\', contact_email TEXT DEFAULT \'waiswadaniel24@gmail.com\', whatsapp_number TEXT DEFAULT \'0789736737\', subscription_tier TEXT DEFAULT \'free\', verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())');

    console.log('Indexes created. Seeding DEVELOPER ONLY...');
    const tenant = await pool.query(`INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise']);
    const tenantId = tenant.rows[0].id;
    const hashedPass = await bcrypt.hash('admin123', 10);
    await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)`, [tenantId, 'waiswadaniel24@gmail.com', hashedPass, 'super_admin']);
    await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified) VALUES ($1, $2, $3)`, [tenantId, 'enterprise', true]);
    console.log('RESET COMPLETE: Only developer account exists. Password: admin123');
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

// === AUTH ===
app.get('/login', (req, res) => {
  res.send(renderPage('Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>Login</h1><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required /><input name="password" placeholder="Password" type="password" required /><button type="submit" class="btn" style="width:100%">Login</button></form></div>'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT u.*, t.subdomain, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1', [email]);
    if (!user.rows[0]) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>'));
    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>'));
    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain, name: user.rows[0].tenant_name };
    if (user.rows[0].role === 'super_admin') return res.redirect('/super-admin');
    res.redirect('/app');
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).send(renderPage('Error', '<div class="card"><h1>Server Error</h1></div>'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// === SUPER ADMIN ===
app.get('/super-admin', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('Super Admin', `<div class="card"><h1>Super Admin Dashboard</h1><p><a href="/super-admin/tenants" class="btn">All Schools</a><a href="/super-admin/users" class="btn">All Users</a><a href="/super-admin/revenue" class="btn">Revenue</a><a href="/create-site" class="btn btn-green">Add School</a></p></div>`));
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, subdomain, plan, ranking_score FROM tenants ORDER BY id');
  const table = rows.map(t => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.subdomain}</td><td>${t.plan}</td><td>${t.ranking_score||0}</td></tr>`).join('');
  res.send(renderPage('All Schools', `<div class="card"><h1>All Schools</h1><table><thead><tr><th>ID</th><th>Name</th><th>Subdomain</th><th>Plan</th><th>Score</th></tr></thead><tbody>${table}</tbody></table><p><a href="/super-admin" class="btn">Back</a></p></div>`));
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT u.id, u.email, u.role, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id ORDER BY u.id');
  const table = rows.map(u => `<tr><td>${u.id}</td><td>${u.email}</td><td>${u.role}</td><td>${u.school}</td></tr>`).join('');
  res.send(renderPage('All Users', `<div class="card"><h1>All Users</h1><table><thead><tr><th>ID</th><th>Email</th><th>Role</th><th>School</th></tr></thead><tbody>${table}</tbody></table><p><a href="/super-admin" class="btn">Back</a></p></div>`));
});

app.get('/super-admin/revenue', requireAuth, requireRole('super_admin'), async (req, res) => {
  const orders = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM orders');
  res.send(renderPage('Revenue', `<div class="card"><h1>Platform Revenue</h1><p><strong>Total Orders:</strong> ${orders.rows[0].count}</p><p><strong>Total Sales:</strong> UGX ${orders.rows[0].total}</p><p><a href="/super-admin" class="btn">Back</a></p></div>`));
});

// === CREATE SITE ===
app.get('/create-site', (req, res) => {
  res.send(renderPage('Create Site', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Create Free School Site</h1><form method="POST" action="/create-site"><input name="name" placeholder="School Name" required><input name="subdomain" placeholder="Subdomain (no spaces)" required><input name="admin_email" type="email" placeholder="Admin Email" required><input name="admin_password" type="password" placeholder="Password" required><button class="btn" style="width:100%">Create School</button></form></div>'));
});

app.post('/create-site', async (req, res) => {
  const { name, subdomain, admin_email, admin_password } = req.body;
  if (!name ||!subdomain ||!admin_email ||!admin_password) {
    return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>All fields required</p><a href="/create-site">Try Again</a></div>'));
  }
  try {
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free']);
    const hashedPass = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [tenant.rows[0].id, admin_email, hashedPass, 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3)', [tenant.rows[0].id, admin_email, 0]);
    res.send(renderPage('Success', `<div class="card"><h1>Site Created!</h1><p><strong>School:</strong> ${name}</p><p><strong>URL:</strong> http://${subdomain}.ssewasswa-api.onrender.com</p><p><strong>Admin Login:</strong> ${admin_email}</p><a href="/login" class="btn">Login Now</a></div>`));
  } catch (e) {
    let msg = e.code === '23505'? 'Subdomain already taken' : e.message;
    res.send(renderPage('Error', `<div class="card"><h1>Error</h1><p>${msg}</p><a href="/create-site">Try Again</a></div>`));
  }
});

// === SCHOOL ADMIN DASHBOARD ===
app.get('/app', requireAuth, requireTenant, async (req, res) => {
  const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id = $1', [req.tenantId]);
  const fees = await pool.query('SELECT COALESCE(SUM(paid), 0)::numeric AS total FROM fees WHERE tenant_id = $1', [req.tenantId]);
  const content = `
    <div class="stats">
      <div class="stat-card"><div>Total Students</div><div class="stat-num">${students.rows[0].c}</div></div>
      <div class="stat-card"><div>Fees Collected</div><div class="stat-num">UGX ${fees.rows[0].total}</div></div>
    </div>
    <div class="card">
      <h1>${req.tenant.name} Dashboard</h1>
      <p><a href="/app/students/add" class="btn btn-green">Add Student</a>
         <a href="/app/fees/add" class="btn">Record Payment</a>
         <a href="/app/students" class="btn">View Students</a>
         <a href="/app/fees" class="btn">View Fees</a></p>
    </div>`;
  res.send(renderPage('Dashboard', content, { tenant_name: req.tenant.name }));
});

// === STUDENTS ===
app.get('/app/students', requireAuth, requireTenant, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
  const table = rows.map(s => `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.class||'-'}</td><td>${s.guardian_phone||'-'}</td><td>UGX ${s.balance}</td></tr>`).join('');
  res.send(renderPage('Students', `<div class="card"><h1>Students</h1><a href="/app/students/add" class="btn btn-green">Add New Student</a><table style="margin-top:16px"><thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Guardian Phone</th><th>Balance</th></tr></thead><tbody>${table||'<tr><td colspan="5">No students yet</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/students/add', requireAuth, requireTenant, (req, res) => {
  res.send(renderPage('Add Student', `<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" placeholder="Full Name" required><input name="class" placeholder="Class (e.g. P.5)"><input name="guardian_name" placeholder="Guardian Name"><input name="guardian_phone" placeholder="Guardian Phone"><button class="btn btn-green" style="width:100%">Save Student</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/students/add', requireAuth, requireTenant, async (req, res) => {
  const { name, class: className, guardian_name, guardian_phone } = req.body;
  await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1, $2, $3, $4, $5)', [req.tenantId, name, className, guardian_name, guardian_phone]);
  res.redirect('/app/students');
});

// === FEES ===
app.get('/app/fees', requireAuth, requireTenant, async (req, res) => {
  const { rows } = await pool.query('SELECT f.*, s.name as student_name FROM fees f JOIN students s ON f.student_id = s.id WHERE f.tenant_id = $1 ORDER BY f.created_at DESC', [req.tenantId]);
  const table = rows.map(f => `<tr><td>${f.student_name}</td><td>UGX ${f.amount}</td><td>UGX ${f.paid}</td><td>${f.term||'-'}</td><td>${f.year||'-'}</td><td>${f.description||'-'}</td></tr>`).join('');
  res.send(renderPage('Fees', `<div class="card"><h1>Fee Records</h1><a href="/app/fees/add" class="btn btn-green">Record Payment</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Amount Due</th><th>Paid</th><th>Term</th><th>Year</th><th>Note</th></tr></thead><tbody>${table||'<tr><td colspan="6">No fee records yet</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/fees/add', requireAuth, requireTenant, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
  const options = students.rows.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  res.send(renderPage('Record Payment', `<div class="card" style="max-width:500px"><h1>Record Fee Payment</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select Student</option>${options}</select><input name="amount" type="number" placeholder="Amount Due" required><input name="paid" type="number" placeholder="Amount Paid" required><input name="term" placeholder="Term (e.g. Term 1)"><input name="year" type="number" placeholder="Year" value="2026"><input name="description" placeholder="Description (e.g. Tuition)"><button class="btn btn-green" style="width:100%">Save Payment</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/fees/add', requireAuth, requireTenant, async (req, res) => {
  const { student_id, amount, paid, term, year, description } = req.body;
  await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, description) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.tenantId, student_id, amount, paid, term, year, description]);
  res.redirect('/app/fees');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'ssewasswa-api', version: '6.0' });
});

app.get('/', (req, res) => {
  res.send('SSEWASSWA API is running.');
});

initDB().catch((err) => {
  console.error('Init failed:', err);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
