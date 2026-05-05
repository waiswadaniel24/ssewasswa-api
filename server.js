const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const Parser = require('rss-parser');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('❌ FATAL: DATABASE_URL is missing in Environment Variables.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000, // Fail fast if DB is asleep
  idleTimeoutMillis: 30000,
  max: 5 
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MOMO_CONFIG = {
  subscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY || 'demo',
  apiUser: process.env.MOMO_API_USER || 'demo',
  apiKey: process.env.MOMO_API_KEY || 'demo',
  environment: process.env.MOMO_ENV || 'sandbox',
  baseUrl: 'https://sandbox.momodeveloper.mtn.com'
};

const SMS_CONFIG = {
  apiKey: process.env.SMS_API_KEY || 'demo',
  username: process.env.SMS_USERNAME || 'sandbox',
  senderId: 'SSEWASSWA'
};

function renderPage(title, content, user = null, isPublic = false) {
  const nav = user && !isPublic ? `
    <div style="background:#1e40af;color:white;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap">
      <div><strong>${esc(user.tenant_name || 'SSEWASSWA')}</strong></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a href="/app" style="color:white;text-decoration:none">Dashboard</a>
        <a href="/app/students" style="color:white;text-decoration:none">Students</a>
        <a href="/app/fees" style="color:white;text-decoration:none">Fees</a>
        <a href="/app/attendance" style="color:white;text-decoration:none">Attendance</a>
        <a href="/app/grades" style="color:white;text-decoration:none">Grades</a>
        <a href="/logout" style="color:white;text-decoration:none">Logout</a>
      </div>
    </div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
    body{font-family:system-ui;background:#f8fafc;color:#1e293b;margin:0;padding:24px}
    .card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;max-width:900px;margin:0 auto 16px}
    .btn{background:#1e40af;color:white;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px}
    .btn-green{background:#16a34a}.btn-red{background:#dc2626}.btn-orange{background:#ea580c}
    input,select,textarea{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin:8px 0 12px;box-sizing:border-box}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
    .stat-card{background:white;padding:20px;border-radius:12px;border:1px solid #e2e8f0}
    .stat-num{font-size:32px;font-weight:bold;color:#1e40af}
    .badge{padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600}
    .badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}
  </style></head><body>${nav}${content}</body></html>`;
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  req.tenant = req.session.tenant;
  req.tenantId = req.session.tenant.id;
  next();
};

async function requireTenant(req, res, next) {
  try {
    if (req.session && req.session.tenant) {
      req.tenant = req.session.tenant;
      req.tenantId = req.session.tenant.id;
      return next();
    }
    const host = req.headers.host || '';
    const sub = host.split('.')[0];
    const effectiveSub = (sub === 'localhost' || host.includes('onrender') || sub === '127') ? 'main' : sub;
    const result = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [effectiveSub]);
    if (!result.rows[0]) return res.status(404).send('School not found');
    req.tenant = result.rows[0];
    req.tenantId = result.rows[0].id;
    return next();
  } catch (err) {
    return res.status(500).send('Server Error');
  }
}

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send('Forbidden');
  next();
};

async function sendSMS(phone, message) {
  if (SMS_CONFIG.apiKey === 'demo') return { success: true, demo: true };
  try {
    await axios.post('https://api.africastalking.com/version1/messaging',
      `username=${SMS_CONFIG.username}&to=${phone}&message=${encodeURIComponent(message)}&from=${SMS_CONFIG.senderId}`,
      { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { success: true };
  } catch (err) {
    console.error('SMS Error:', err.message);
    return { success: false };
  }
}

// --- STEP 1: INSTANT DB SETUP (Only Session Table) ---
async function ensureSessionTable() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
    return true;
  } catch (e) {
    console.error('Session table creation failed:', e.message);
    return false;
  }
}

// --- STEP 2: BACKGROUND DB SETUP (All App Tables) ---
async function initAppTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = [
      `CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', plan_expires DATE, ranking_score INTEGER DEFAULT 0, momo_number TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS parents (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS parent_otps (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, otp TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, parent_id INTEGER REFERENCES parents(id), balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, description TEXT, payment_method TEXT, momo_ref TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), amount NUMERIC NOT NULL, phone TEXT NOT NULL, reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, site_name TEXT DEFAULT 'SSEWASSWA FOUNDATION UGANDA', primary_color TEXT DEFAULT '#1e40af', contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', whatsapp_number TEXT DEFAULT '0789736737', subscription_tier TEXT DEFAULT 'free', verified BOOLEAN DEFAULT false, school_motto TEXT, about_text TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`
    ];

    for (const sql of tables) {
      await client.query(sql);
    }

    const tenant = await client.query(`INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1, $2, $3, $4) ON CONFLICT (subdomain) DO NOTHING RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737']);
    
    if (tenant.rows.length > 0) {
      const tid = tenant.rows[0].id;
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com', hash, 'super_admin']);
      await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [tid, 'enterprise', true, 'Excellence Through Education', 'SSEWASSWA empowers schools with digital tools.']);
    }

    await client.query('COMMIT');
    console.log('✅ Background database setup complete.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ Background DB error:', err.message);
  } finally {
    client.release();
  }
}

// --- ALL ROUTES ---

app.get('/login', (req, res) => {
  res.send(renderPage('Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>School Admin Login</h1><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required /><input name="password" placeholder="Password" type="password" required /><button type="submit" class="btn" style="width:100%">Login</button></form><p style="margin-top:1rem;text-align:center"><a href="/parent/login">Parent Login</a> | <a href="/create-site">Create School</a></p></div>'));
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT u.*, t.subdomain, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1', [email]);
    if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) {
      return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login" class="btn">Try Again</a></div>'));
    }
    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain, name: user.rows[0].tenant_name };
    res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
  } catch (e) {
    res.status(500).send("Login error");
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>Parent Login</h1><p>Enter your phone number to receive OTP</p><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XXXXXXXX" required /><button type="submit" class="btn" style="width:100%">Send OTP</button></form></div>'));
});

app.post('/parent/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')', [phone, otp]);
    await sendSMS(phone, `Your SSEWASSWA Parent Portal OTP is: ${otp}. Valid for 10 minutes.`);
    res.send(renderPage('Verify OTP', `<div class="card" style="max-width:400px;margin:60px auto"><h1>Enter OTP</h1><p>OTP sent to ${esc(phone)}</p><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="${esc(phone)}"><input name="otp" placeholder="6-digit OTP" required /><button type="submit" class="btn" style="width:100%">Verify</button></form></div>`));
  } catch (e) { res.status(500).send("Error sending OTP"); }
});

app.post('/parent/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const result = await pool.query('SELECT * FROM parent_otps WHERE phone = $1 AND otp = $2 AND expires_at > NOW() AND used = false ORDER BY created_at DESC LIMIT 1', [phone, otp]);
    if (!result.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid OTP</h1><a href="/parent/login">Try Again</a></div>'));
    await pool.query('UPDATE parent_otps SET used = true WHERE id = $1', [result.rows[0].id]);
    let parent = await pool.query('SELECT * FROM parents WHERE phone = $1', [phone]);
    if (!parent.rows[0]) {
      const tenant = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', ['main']);
      await pool.query('INSERT INTO parents (phone, verified, tenant_id) VALUES ($1, true, $2)', [phone, tenant.rows[0].id]);
      parent = await pool.query('SELECT * FROM parents WHERE phone = $1', [phone]);
    }
    req.session.parent = parent.rows[0];
    res.redirect('/parent/dashboard');
  } catch (e) { res.status(500).send("Verification failed"); }
});

app.get('/parent/dashboard', async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  try {
    const students = await pool.query('SELECT * FROM students WHERE parent_id = $1 OR guardian_phone = $2', [req.session.parent.id, req.session.parent.phone]);
    const cards = students.rows.map(s => `<div class="card"><h3>${esc(s.name)}</h3><p><strong>Class:</strong> ${esc(s.class)||'-'}</p><p><strong>Balance:</strong> UGX ${s.balance}</p><a href="/parent/pay/${s.id}" class="btn btn-green">Pay Fees</a></div>`).join('');
    res.send(renderPage('Parent Dashboard', `<div class="card"><h1>My Children</h1></div>${cards||'<div class="card"><p>No students linked yet.</p></div>'}<div class="card"><a href="/parent/logout" class="btn">Logout</a></div>`));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/parent/pay/:student_id', async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  try {
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.student_id]);
    if (!student.rows[0]) return res.status(404).send('Not found');
    res.send(renderPage('Pay Fees', `<div class="card" style="max-width:500px"><h1>Pay for ${esc(student.rows[0].name)}</h1><p><strong>Balance:</strong> UGX ${student.rows[0].balance}</p><form method="POST" action="/parent/pay"><input type="hidden" name="student_id" value="${student.rows[0].id}"><input name="amount" type="number" required><input name="phone" value="${esc(req.session.parent.phone)}" required><button class="btn btn-green" style="width:100%">Pay with MoMo</button></form></div>`));
  } catch (e) { res.status(500).send("Error"); }
});

app.post('/parent/pay', async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  try {
    const { student_id, amount, phone } = req.body;
    const ref = `FEE-${Date.now()}`;
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    await pool.query('INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1,$2,$3,$4,$5)', [student.rows[0].tenant_id, student_id, amount, phone, ref]);
    if (MOMO_CONFIG.apiKey === 'demo') {
      await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [amount, student_id]);
      await pool.query('UPDATE payment_requests SET status = $1 WHERE reference = $2', ['success', ref]);
      return res.send(renderPage('Success', `<div class="card"><h1>Payment Successful!</h1><a href="/parent/dashboard" class="btn">Back</a></div>`));
    }
    res.send(renderPage('Processing', `<div class="card"><h1>Check your phone for MoMo prompt.</h1></div>`));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/parent/logout', (req, res) => req.session.destroy(() => res.redirect('/parent/login')));

app.get('/super-admin', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('Super Admin', `<div class="card"><h1>Super Admin</h1><p><a href="/super-admin/tenants" class="btn">Schools</a><a href="/super-admin/users" class="btn">Users</a><a href="/create-site" class="btn btn-green">Add School</a></p></div>`));
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants ORDER BY id');
  const table = rows.map(t => `<tr><td>${esc(t.name)}</td><td>${esc(t.subdomain)}</td><td>${esc(t.plan)}</td></tr>`).join('');
  res.send(renderPage('Schools', `<div class="card"><table><thead><tr><th>Name</th><th>Sub</th><th>Plan</th></tr></thead><tbody>${table}</tbody></table></div>`));
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT u.email, u.role, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id');
  const table = rows.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.school)}</td></tr>`).join('');
  res.send(renderPage('Users', `<div class="card"><table><thead><tr><th>Email</th><th>Role</th><th>School</th></tr></thead><tbody>${table}</tbody></table></div>`));
});

app.get('/create-site', (req, res) => {
  res.send(renderPage('Create Site', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Create Free School Site</h1><form method="POST" action="/create-site"><input name="name" placeholder="School Name" required><input name="subdomain" placeholder="Subdomain" required><input name="admin_email" type="email" required><input name="admin_password" type="password" required><input name="momo_number" placeholder="MoMo Number"><button class="btn" style="width:100%">Create</button></form></div>'));
});

app.post('/create-site', async (req, res) => {
  try {
    const { name, subdomain, admin_email, admin_password, momo_number } = req.body;
    if (!name || !subdomain || !admin_email || !admin_password) return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>All fields required</p></div>'));
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1,$2,$3,$4) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number]);
    const hash = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)', [tenant.rows[0].id, admin_email, hash, 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    res.send(renderPage('Success', `<div class="card"><h1>Site Created!</h1><a href="/login" class="btn">Login Now</a></div>`));
  } catch (e) {
    res.send(renderPage('Error', `<div class="card"><h1>Error</h1><p>${e.code === '23505' ? 'Subdomain taken' : e.message}</p></div>`));
  }
});

app.get('/school/:subdomain', async (req, res) => {
  try {
    const tenant = await pool.query('SELECT t.*, s.school_motto, s.about_text FROM tenants t LEFT JOIN settings s ON t.id = s.tenant_id WHERE t.subdomain = $1', [req.params.subdomain]);
    if (!tenant.rows[0]) return res.status(404).send('Not found');
    const t = tenant.rows[0];
    res.send(renderPage(t.name, `<div class="card" style="text-align:center;background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:60px 20px"><h1>${esc(t.name)}</h1><p>${esc(t.school_motto)}</p></div><div class="card"><p>${esc(t.about_text)}</p><br><a href="/parent/login" class="btn btn-green">Parent Portal</a></div>`, null, true));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/app', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id = $1', [req.tenantId]);
    const fees = await pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS total FROM fees WHERE tenant_id = $1', [req.tenantId]);
    const att = await pool.query('SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id = $1 AND date = CURRENT_DATE', [req.tenantId]);
    res.send(renderPage('Dashboard', `<div class="stats"><div class="stat-card"><div>Students</div><div class="stat-num">${students.rows[0].c}</div></div><div class="stat-card"><div>Fees Collected</div><div class="stat-num">UGX ${fees.rows[0].total}</div></div><div class="stat-card"><div>Present Today</div><div class="stat-num">${att.rows[0].c}</div></div></div><div class="card"><h1>${esc(req.tenant.name)}</h1><br><a href="/app/students/add" class="btn btn-green">Add Student</a> <a href="/app/fees/add" class="btn">Record Payment</a> <a href="/app/attendance/mark" class="btn">Mark Attendance</a> <a href="/app/grades/add" class="btn">Add Grades</a></div>`, { tenant_name: req.tenant.name }));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/app/students', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY id DESC', [req.tenantId]);
  const table = rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.guardian_phone)}</td><td>UGX ${s.balance}</td><td><a href="/app/fees/add?student_id=${s.id}" class="btn">Pay</a></td></tr>`).join('');
  res.send(renderPage('Students', `<div class="card"><h1>Students</h1><a href="/app/students/add" class="btn btn-green">Add New</a><table style="margin-top:16px"><thead><tr><th>Name</th><th>Class</th><th>Guardian</th><th>Balance</th><th>Action</th></tr></thead><tbody>${table||'<tr><td colspan="5">No students</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/students/add', requireAuth, (req, res) => {
  res.send(renderPage('Add Student', `<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" required><input name="class"><input name="guardian_name"><input name="guardian_phone"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/students/add', requireAuth, async (req, res) => {
  try {
    const { name, class: c, guardian_name, guardian_phone } = req.body;
    await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, name, c, guardian_name, guardian_phone]);
    if (guardian_phone) await sendSMS(guardian_phone, `${name} registered at ${req.tenant.name}.`);
    res.redirect('/app/students');
  } catch (e) { res.status(500).send("Error adding student"); }
});

app.get('/app/fees', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT f.*, s.name as student_name FROM fees f JOIN students s ON f.student_id = s.id WHERE f.tenant_id = $1 ORDER BY f.id DESC LIMIT 50', [req.tenantId]);
  const table = rows.map(f => `<tr><td>${esc(f.student_name)}</td><td>${f.amount}</td><td>${f.paid}</td><td>${esc(f.term)}</td><td>${esc(f.payment_method)}</td></tr>`).join('');
  res.send(renderPage('Fees', `<div class="card"><h1>Fees</h1><a href="/app/fees/add" class="btn btn-green">Record Payment</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Due</th><th>Paid</th><th>Term</th><th>Method</th></tr></thead><tbody>${table||'<tr><td colspan="5">No records</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/fees/add', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.tenantId]);
  const opts = students.rows.map(s => `<option value="${s.id}" ${req.query.student_id==s.id?'selected':''}>${esc(s.name)}</option>`).join('');
  res.send(renderPage('Record Payment', `<div class="card" style="max-width:500px"><h1>Record Payment</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select Student</option>${opts}</select><input name="amount" type="number" required><input name="paid" type="number" required><input name="term"><input name="year" type="number" value="${new Date().getFullYear()}"><select name="payment_method"><option>Cash</option><option>MoMo</option><option>Bank</option></select><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/fees/add', requireAuth, async (req, res) => {
  try {
    const { student_id, amount, paid, term, year, payment_method } = req.body;
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    const newBal = student.rows[0].balance - paid;
    await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.tenantId, student_id, amount, paid, term, year, payment_method]);
    await pool.query('UPDATE students SET balance = $1 WHERE id = $2', [newBal, student_id]);
    if (student.rows[0].guardian_phone) await sendSMS(student.rows[0].guardian_phone, `Payment of UGX ${paid} received for ${student.rows[0].name}. Balance: UGX ${newBal}`);
    res.redirect('/app/fees');
  } catch (e) { res.status(500).send("Error recording fee"); }
});

app.get('/app/attendance', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT a.*, s.name FROM attendance a JOIN students s ON a.student_id = s.id WHERE a.tenant_id = $1 AND a.date = CURRENT_DATE', [req.tenantId]);
  const table = rows.map(a => `<tr><td>${esc(a.name)}</td><td><span class="badge ${a.status==='present'?'badge-green':'badge-red'}">${a.status}</span></td></tr>`).join('');
  res.send(renderPage('Attendance', `<div class="card"><h1>Today</h1><a href="/app/attendance/mark" class="btn btn-green">Mark</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${table||'<tr><td colspan="2">None marked</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/attendance/mark', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.tenantId]);
  const boxes = students.rows.map(s => `<label style="display:block;margin:8px 0"><input type="checkbox" name="present_${s.id}" checked> ${esc(s.name)}</label>`).join('');
  res.send(renderPage('Mark Attendance', `<div class="card" style="max-width:500px"><h1>Mark for Today</h1><form method="POST" action="/app/attendance/mark">${boxes}<button class="btn btn-green" style="width:100%;margin-top:16px">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/attendance/mark', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT id FROM students WHERE tenant_id = $1', [req.tenantId]);
    await pool.query('DELETE FROM attendance WHERE tenant_id = $1 AND date = CURRENT_DATE', [req.tenantId]);
    for (const s of students.rows) {
      await pool.query('INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1,$2,CURRENT_DATE,$3)', [req.tenantId, s.id, req.body[`present_${s.id}`] ? 'present' : 'absent']);
    }
    res.redirect('/app/attendance');
  } catch (e) { res.status(500).send("Error saving attendance"); }
});

app.get('/app/grades', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT g.*, s.name as student_name FROM grades g JOIN students s ON g.student_id = s.id WHERE g.tenant_id = $1 ORDER BY g.id DESC LIMIT 50', [req.tenantId]);
  const table = rows.map(g => `<tr><td>${esc(g.student_name)}</td><td>${esc(g.subject)}</td><td>${g.score}</td><td>${esc(g.term)}</td></tr>`).join('');
  res.send(renderPage('Grades', `<div class="card"><h1>Grades</h1><a href="/app/grades/add" class="btn btn-green">Add</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th></tr></thead><tbody>${table||'<tr><td colspan="4">No grades</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/grades/add', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.tenantId]);
  const opts = students.rows.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  res.send(renderPage('Add Grade', `<div class="card" style="max-width:500px"><h1>Add Grade</h1><form method="POST" action="/app/grades/add"><select name="student_id" required><option value="">Select</option>${opts}</select><input name="subject" required><input name="score" type="number" required><input name="term"><input name="year" type="number" value="${new Date().getFullYear()}"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/grades/add', requireAuth, async (req, res) => {
  try {
    const { student_id, subject, score, term, year } = req.body;
    await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, student_id, subject, score, term, year]);
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (student.rows[0]?.guardian_phone) await sendSMS(student.rows[0].guardian_phone, `${student.rows[0].name} scored ${score} in ${subject}.`);
    res.redirect('/app/grades');
  } catch (e) { res.status(500).send("Error saving grade"); }
});

app.post('/api/momo/webhook', async (req, res) => {
  try {
    const { reference, status, transactionId } = req.body;
    if (status === 'SUCCESSFUL') {
      const p = await pool.query('SELECT * FROM payment_requests WHERE reference = $1', [reference]);
      if (p.rows[0]) {
        await pool.query('UPDATE payment_requests SET status=$1, momo_transaction_id=$2 WHERE reference=$3', ['success', transactionId, reference]);
        await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [p.rows[0].amount, p.rows[0].student_id]);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Webhook failed' }); }
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.send('SSEWASSWA API is running.'));
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card" style="text-align:center"><h1>404</h1><p>Page not found.</p><a href="/login" class="btn">Login</a></div>', null, true)));


// --- THE MAGIC: START SERVER INSTANTLY ---
(async () => {
  // 1. Create ONLY the session table so logins work immediately
  await ensureSessionTable();

  // 2. Setup Sessions
  app.use(session({
    store: new pgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' }
  }));

  // 3. OPEN THE PORT IMMEDIATELY (Render detects this and says "Success!")
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
  });

  // 4. Create the rest of the database tables slowly in the background
  initAppTables();
  
})();
