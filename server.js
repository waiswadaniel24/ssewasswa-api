const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Parser = require('rss-parser');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// CRITICAL FIX: Check if database URL exists immediately
if (!process.env.DATABASE_URL) {
  console.error('❌ FATAL ERROR: DATABASE_URL environment variable is missing!');
  console.error('Please add it in Render -> Environment -> Environment Variables.');
  process.exit(1); // Kill the process so Render knows it failed
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // FAIL FAST: Don't hang for 60 seconds if the DB is unreachable
  connectionTimeoutMillis: 5000, 
  idleTimeoutMillis: 30000,
  max: 5 
});

const parser = new Parser();

// Use built-in Express body parser (body-parser package is deprecated)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);

// Security: Escape HTML to prevent XSS attacks
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

// Middleware: Check if user is logged in
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  req.tenant = req.session.tenant;
  req.tenantId = req.session.tenant.id;
  next();
};

// Middleware: Fetch tenant from DB
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
    console.error('Tenant lookup failed:', err);
    return res.status(500).send('Server Error');
  }
}

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send('Forbidden');
  next();
};

async function sendSMS(phone, message) {
  if (SMS_CONFIG.apiKey === 'demo') {
    console.log(`[SMS DEMO] to ${phone}: ${message}`);
    return { success: true, demo: true };
  }
  try {
    const response = await axios.post('https://api.africastalking.com/version1/messaging',
      `username=${SMS_CONFIG.username}&to=${phone}&message=${encodeURIComponent(message)}&from=${SMS_CONFIG.senderId}`,
      { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { success: true, data: response.data };
  } catch (err) {
    console.error('SMS Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Setting up database tables...');

    await client.query(`CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid")
    )`);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);

    await client.query(`CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', 
      plan_expires DATE, ranking_score INTEGER DEFAULT 0, momo_number TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS parents (
      id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS parent_otps (
      id SERIAL PRIMARY KEY, phone TEXT NOT NULL, otp TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, 
      used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, 
      class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, parent_id INTEGER REFERENCES parents(id), 
      balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS fees (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, 
      year INTEGER, paid NUMERIC DEFAULT 0, description TEXT, payment_method TEXT, momo_ref TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS grades (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, 
      score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id), amount NUMERIC NOT NULL, phone TEXT NOT NULL, 
      reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, 
      site_name TEXT DEFAULT 'SSEWASSWA FOUNDATION UGANDA', primary_color TEXT DEFAULT '#1e40af', 
      contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', whatsapp_number TEXT DEFAULT '0789736737', 
      subscription_tier TEXT DEFAULT 'free', verified BOOLEAN DEFAULT false, school_motto TEXT, 
      about_text TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, 
      expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS revenue_log (
      id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, 
      tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      user_email TEXT NOT NULL, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW()
    )`);

    console.log('Seeding developer account if not exists...');
    const tenant = await client.query(`
      INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1, $2, $3, $4)
      ON CONFLICT (subdomain) DO NOTHING RETURNING id
    `, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737']);

    if (tenant.rows.length > 0) {
      const tenantId = tenant.rows[0].id;
      const hashedPass = await bcrypt.hash('admin123', 10);
      await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [tenantId, 'waiswadaniel24@gmail.com', hashedPass, 'super_admin']);
      await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [tenantId, 'enterprise', true, 'Excellence Through Education', 'SSEWASSWA FOUNDATION UGANDA empowers schools with digital tools.']);
    }

    await client.query('COMMIT');
    console.log('✅ Database setup complete.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}
// --- ROUTES ---

app.get('/login', (req, res) => {
  res.send(renderPage('Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>School Admin Login</h1><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required /><input name="password" placeholder="Password" type="password" required /><button type="submit" class="btn" style="width:100%">Login</button></form><p style="margin-top:1rem;text-align:center"><a href="/parent/login">Parent Login</a> | <a href="/create-site">Create School</a></p></div>'));
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
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

app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>Parent Login</h1><p>Enter your phone number to receive OTP</p><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XXXXXXXX" required /><button type="submit" class="btn" style="width:100%">Send OTP</button></form><p style="margin-top:1rem;text-align:center"><a href="/login">School Admin Login</a></p></div>'));
});

app.post('/parent/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1, $2, $3)', [phone, otp, expires]);
    await sendSMS(phone, `Your SSEWASSWA Parent Portal OTP is: ${otp}. Valid for 10 minutes.`);
    res.send(renderPage('Verify OTP', `<div class="card" style="max-width:400px;margin:60px auto"><h1>Enter OTP</h1><p>OTP sent to ${esc(phone)}</p><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="${esc(phone)}"><input name="otp" placeholder="6-digit OTP" required /><button type="submit" class="btn" style="width:100%">Verify</button></form></div>`));
  } catch (e) {
    res.status(500).send("Error sending OTP");
  }
});

app.post('/parent/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    const result = await pool.query('SELECT * FROM parent_otps WHERE phone = $1 AND otp = $2 AND expires_at > NOW() AND used = false ORDER BY created_at DESC LIMIT 1', [phone, otp]);
    if (!result.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid or Expired OTP</h1><a href="/parent/login">Try Again</a></div>'));
    
    await pool.query('UPDATE parent_otps SET used = true WHERE id = $1', [result.rows[0].id]);
    let parent = await pool.query('SELECT * FROM parents WHERE phone = $1', [phone]);
    
    if (!parent.rows[0]) {
      const tenant = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', ['main']);
      await pool.query('INSERT INTO parents (phone, verified, tenant_id) VALUES ($1, true, $2)', [phone, tenant.rows[0].id]);
      parent = await pool.query('SELECT * FROM parents WHERE phone = $1', [phone]);
    }
    req.session.parent = parent.rows[0];
    res.redirect('/parent/dashboard');
  } catch (e) {
    res.status(500).send("Verification failed");
  }
});

app.get('/parent/dashboard', async (req, res) => {
  try {
    if (!req.session.parent) return res.redirect('/parent/login');
    const students = await pool.query('SELECT * FROM students WHERE parent_id = $1 OR guardian_phone = $2', [req.session.parent.id, req.session.parent.phone]);
    const cards = students.rows.map(s => `<div class="card"><h3>${esc(s.name)}</h3><p><strong>Class:</strong> ${esc(s.class) || '-'}</p><p><strong>Balance:</strong> UGX ${s.balance}</p><a href="/parent/pay/${s.id}" class="btn btn-green">Pay Fees</a></div>`).join('');
    res.send(renderPage('Parent Dashboard', `<div class="card"><h1>My Children</h1></div>${cards || '<div class="card"><p>No students linked to your phone yet. Contact school admin.</p></div>'}<div class="card"><a href="/parent/logout" class="btn">Logout</a></div>`));
  } catch (e) {
    res.status(500).send("Error loading dashboard");
  }
});

app.get('/parent/pay/:student_id', async (req, res) => {
  try {
    if (!req.session.parent) return res.redirect('/parent/login');
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.student_id]);
    if (!student.rows[0]) return res.status(404).send('Student not found');
    res.send(renderPage('Pay Fees', `<div class="card" style="max-width:500px"><h1>Pay Fees for ${esc(student.rows[0].name)}</h1><p><strong>Current Balance:</strong> UGX ${student.rows[0].balance}</p><form method="POST" action="/parent/pay"><input type="hidden" name="student_id" value="${student.rows[0].id}"><input name="amount" type="number" placeholder="Amount to Pay" required><input name="phone" placeholder="MTN MoMo Number" value="${esc(req.session.parent.phone)}" required><button class="btn btn-green" style="width:100%">Pay with MTN MoMo</button></form></div>`));
  } catch (e) {
    res.status(500).send("Error loading payment page");
  }
});

app.post('/parent/pay', async (req, res) => {
  try {
    if (!req.session.parent) return res.redirect('/parent/login');
    const { student_id, amount, phone } = req.body;
    const reference = `FEE-${Date.now()}`;
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (!student.rows[0]) return res.status(404).send("Student not found");

    await pool.query('INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1, $2, $3, $4, $5)', [student.rows[0].tenant_id, student_id, amount, phone, reference]);
    
    if (MOMO_CONFIG.apiKey === 'demo') {
      const newBalance = student.rows[0].balance - amount;
      await pool.query('UPDATE students SET balance = $1 WHERE id = $2', [newBalance, student_id]);
      await pool.query('UPDATE payment_requests SET status = $1 WHERE reference = $2', ['success', reference]);
      await sendSMS(phone, `Payment of UGX ${amount} for ${student.rows[0].name} received. New Balance: UGX ${newBalance}. Thank you!`);
      return res.send(renderPage('Success', `<div class="card"><h1>Payment Successful!</h1><p>UGX ${amount} paid for ${esc(student.rows[0].name)}</p><a href="/parent/dashboard" class="btn">Back to Dashboard</a></div>`));
    }
    res.send(renderPage('Processing', `<div class="card"><h1>Payment Processing</h1><p>Check your phone for MTN MoMo prompt. Reference: ${esc(reference)}</p></div>`));
  } catch (e) {
    res.status(500).send("Payment processing failed");
  }
});

app.get('/parent/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/parent/login'));
});

// --- Super Admin Routes ---

app.get('/super-admin', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('Super Admin', `<div class="card"><h1>Super Admin Dashboard</h1><p><a href="/super-admin/tenants" class="btn">All Schools</a><a href="/super-admin/users" class="btn">All Users</a><a href="/create-site" class="btn btn-green">Add School</a></p></div>`));
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, subdomain, plan, momo_number FROM tenants ORDER BY id');
    const table = rows.map(t => `<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.subdomain)}</td><td>${esc(t.plan)}</td><td>${esc(t.momo_number) || '-'}</td></tr>`).join('');
    res.send(renderPage('All Schools', `<div class="card"><h1>All Schools</h1><table><thead><tr><th>ID</th><th>Name</th><th>Subdomain</th><th>Plan</th><th>MoMo</th></tr></thead><tbody>${table}</tbody></table><p><a href="/super-admin" class="btn">Back</a></p></div>`));
  } catch (e) {
    res.status(500).send("Error fetching tenants");
  }
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT u.id, u.email, u.role, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id ORDER BY u.id');
    const table = rows.map(u => `<tr><td>${u.id}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(u.school)}</td></tr>`).join('');
    res.send(renderPage('All Users', `<div class="card"><h1>All Users</h1><table><thead><tr><th>ID</th><th>Email</th><th>Role</th><th>School</th></tr></thead><tbody>${table}</tbody></table><p><a href="/super-admin" class="btn">Back</a></p></div>`));
  } catch (e) {
    res.status(500).send("Error fetching users");
  }
});

// --- Site Creation ---

app.get('/create-site', (req, res) => {
  res.send(renderPage('Create Site', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Create Free School Site</h1><form method="POST" action="/create-site"><input name="name" placeholder="School Name" required><input name="subdomain" placeholder="Subdomain (no spaces)" required><input name="admin_email" type="email" placeholder="Admin Email" required><input name="admin_password" type="password" placeholder="Password" required><input name="momo_number" placeholder="MTN MoMo Number for Fees"><button class="btn" style="width:100%">Create School</button></form></div>'));
});

app.post('/create-site', async (req, res) => {
  try {
    const { name, subdomain, admin_email, admin_password, momo_number } = req.body;
    if (!name || !subdomain || !admin_email || !admin_password) {
      return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>All fields required</p><a href="/create-site">Try Again</a></div>'));
    }
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1, $2, $3, $4) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number]);
    const hashedPass = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [tenant.rows[0].id, admin_email, hashedPass, 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3)', [tenant.rows[0].id, admin_email, 0]);
    res.send(renderPage('Success', `<div class="card"><h1>Site Created!</h1><p><strong>School:</strong> ${esc(name)}</p><p><strong>Public Page:</strong> <a href="/school/${esc(subdomain)}">/${esc(subdomain)}</a></p><p><strong>Admin Login:</strong> ${esc(admin_email)}</p><a href="/login" class="btn">Login Now</a></div>`));
  } catch (e) {
    let msg = e.code === '23505' ? 'Subdomain or Email already taken' : e.message;
    res.send(renderPage('Error', `<div class="card"><h1>Error</h1><p>${esc(msg)}</p><a href="/create-site">Try Again</a></div>`));
  }
});

// --- Public School Page ---

app.get('/school/:subdomain', async (req, res) => {
  try {
    const tenant = await pool.query('SELECT t.*, s.school_motto, s.about_text FROM tenants t LEFT JOIN settings s ON t.id = s.tenant_id WHERE t.subdomain = $1', [req.params.subdomain]);
    if (!tenant.rows[0]) return res.status(404).send('School not found');
    const t = tenant.rows[0];
    const students = await pool.query('SELECT COUNT(*) as count FROM students WHERE tenant_id = $1', [t.id]);
    const content = `
      <div class="card" style="text-align:center;background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:60px 20px">
        <h1 style="font-size:48px;margin:0">${esc(t.name)}</h1>
        <p style="font-size:20px;margin:16px 0">${esc(t.school_motto) || 'Excellence Through Education'}</p>
      </div>
      <div class="card">
        <h2>About Us</h2>
        <p>${esc(t.about_text) || 'Welcome to our school. We are committed to providing quality education.'}</p>
        <p><strong>Students:</strong> ${students.rows[0].count}</p>
        <p><strong>Contact:</strong> ${esc(t.momo_number) || 'Contact admin'}</p>
      </div>
      <div class="card"><a href="/parent/login" class="btn btn-green">Parent Portal</a><a href="/login" class="btn">Staff Login</a></div>`;
    res.send(renderPage(t.name, content, null, true));
  } catch (e) {
    res.status(500).send("Error loading school page");
  }
});

// --- App Dashboard & CRUD ---

app.get('/app', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id = $1', [req.tenantId]);
    const fees = await pool.query('SELECT COALESCE(SUM(paid), 0)::numeric AS total FROM fees WHERE tenant_id = $1', [req.tenantId]);
    const attendance = await pool.query('SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id = $1 AND date = CURRENT_DATE', [req.tenantId]);
    const content = `
      <div class="stats">
        <div class="stat-card"><div>Total Students</div><div class="stat-num">${students.rows[0].c}</div></div>
        <div class="stat-card"><div>Fees Collected</div><div class="stat-num">UGX ${fees.rows[0].total}</div></div>
        <div class="stat-card"><div>Present Today</div><div class="stat-num">${attendance.rows[0].c}</div></div>
      </div>
      <div class="card">
        <h1>${esc(req.tenant.name)} Dashboard</h1>
        <p><a href="/app/students/add" class="btn btn-green">Add Student</a>
           <a href="/app/fees/add" class="btn">Record Payment</a>
           <a href="/app/attendance/mark" class="btn">Mark Attendance</a>
           <a href="/app/grades/add" class="btn">Add Grades</a></p>
        <p><a href="/school/${esc(req.tenant.subdomain)}" class="btn" target="_blank">View Public Page</a></p>
      </div>`;
    res.send(renderPage('Dashboard', content, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading dashboard");
  }
});

app.get('/app/students', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
    const table = rows.map(s => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${esc(s.class) || '-'}</td><td>${esc(s.guardian_phone) || '-'}</td><td>UGX ${s.balance}</td><td><a href="/app/fees/add?student_id=${s.id}" class="btn">Pay</a></td></tr>`).join('');
    res.send(renderPage('Students', `<div class="card"><h1>Students</h1><a href="/app/students/add" class="btn btn-green">Add New Student</a><table style="margin-top:16px"><thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Guardian Phone</th><th>Balance</th><th>Action</th></tr></thead><tbody>${table || '<tr><td colspan="6">No students yet</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading students");
  }
});

app.get('/app/students/add', requireAuth, (req, res) => {
  res.send(renderPage('Add Student', `<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" placeholder="Full Name" required><input name="class" placeholder="Class (e.g. P.5)"><input name="guardian_name" placeholder="Guardian Name"><input name="guardian_phone" placeholder="Guardian Phone (07XX)"><button class="btn btn-green" style="width:100%">Save Student</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/students/add', requireAuth, async (req, res) => {
  try {
    const { name, class: className, guardian_name, guardian_phone } = req.body;
    await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1, $2, $3, $4, $5)', [req.tenantId, name, className, guardian_name, guardian_phone]);
    if (guardian_phone) {
      await sendSMS(guardian_phone, `Welcome to ${req.tenant.name}! ${name} has been registered. Use parent portal to track fees & grades.`);
    }
    res.redirect('/app/students');
  } catch (e) {
    res.status(500).send("Error adding student");
  }
});

app.get('/app/fees', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT f.*, s.name as student_name FROM fees f JOIN students s ON f.student_id = s.id WHERE f.tenant_id = $1 ORDER BY f.created_at DESC LIMIT 50', [req.tenantId]);
    const table = rows.map(f => `<tr><td>${esc(f.student_name)}</td><td>UGX ${f.amount}</td><td>UGX ${f.paid}</td><td>${esc(f.term) || '-'}</td><td>${esc(f.payment_method) || 'Cash'}</td></tr>`).join('');
    res.send(renderPage('Fees', `<div class="card"><h1>Fee Records</h1><a href="/app/fees/add" class="btn btn-green">Record Payment</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Amount Due</th><th>Paid</th><th>Term</th><th>Method</th></tr></thead><tbody>${table || '<tr><td colspan="5">No fee records yet</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading fees");
  }
});

app.get('/app/fees/add', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
    const options = students.rows.map(s => `<option value="${s.id}" ${req.query.student_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    res.send(renderPage('Record Payment', `<div class="card" style="max-width:500px"><h1>Record Fee Payment</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select Student</option>${options}</select><input name="amount" type="number" placeholder="Amount Due" required><input name="paid" type="number" placeholder="Amount Paid" required><input name="term" placeholder="Term (e.g. Term 1)"><input name="year" type="number" placeholder="Year" value="${new Date().getFullYear()}"><select name="payment_method"><option value="cash">Cash</option><option value="momo">MTN MoMo</option><option value="bank">Bank</option></select><input name="description" placeholder="Description"><button class="btn btn-green" style="width:100%">Save Payment</button></form></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading payment form");
  }
});

app.post('/app/fees/add', requireAuth, async (req, res) => {
  try {
    const { student_id, amount, paid, term, year, description, payment_method } = req.body;
    
    // Fetch student BEFORE updating to calculate proper math
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (!student.rows[0]) return res.status(404).send("Student not found");

    const oldBalance = student.rows[0].balance;
    const newBalance = oldBalance - paid;

    await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, description, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [req.tenantId, student_id, amount, paid, term, year, description, payment_method]);
    await pool.query('UPDATE students SET balance = $1 WHERE id = $2', [newBalance, student_id]);
    
    if (student.rows[0].guardian_phone) {
      await sendSMS(student.rows[0].guardian_phone, `Payment of UGX ${paid} received for ${student.rows[0].name} at ${req.tenant.name}. New Balance: UGX ${newBalance}`);
    }
    res.redirect('/app/fees');
  } catch (e) {
    res.status(500).send("Error recording payment");
  }
});

app.get('/app/attendance', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT a.*, s.name as student_name FROM attendance a JOIN students s ON a.student_id = s.id WHERE a.tenant_id = $1 AND a.date = CURRENT_DATE ORDER BY s.name', [req.tenantId]);
    const table = rows.map(a => `<tr><td>${esc(a.student_name)}</td><td><span class="badge ${a.status === 'present' ? 'badge-green' : 'badge-red'}">${esc(a.status)}</span></td><td>${a.date.toISOString().split('T')[0]}</td></tr>`).join('');
    res.send(renderPage('Attendance', `<div class="card"><h1>Today's Attendance</h1><a href="/app/attendance/mark" class="btn btn-green">Mark Attendance</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Status</th><th>Date</th></tr></thead><tbody>${table || '<tr><td colspan="3">No attendance marked today</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading attendance");
  }
});

app.get('/app/attendance/mark', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
    const checkboxes = students.rows.map(s => `<label style="display:block;margin:8px 0"><input type="checkbox" name="present_${s.id}" value="present" checked> ${esc(s.name)}</label>`).join('');
    res.send(renderPage('Mark Attendance', `<div class="card" style="max-width:500px"><h1>Mark Attendance for ${new Date().toLocaleDateString()}</h1><form method="POST" action="/app/attendance/mark"><input type="hidden" name="date" value="${new Date().toISOString().split('T')[0]}">${checkboxes}<button class="btn btn-green" style="width:100%;margin-top:16px">Save Attendance</button></form></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading attendance form");
  }
});

app.post('/app/attendance/mark', requireAuth, async (req, res) => {
  try {
    const { date } = req.body;
    const students = await pool.query('SELECT id FROM students WHERE tenant_id = $1', [req.tenantId]);
    await pool.query('DELETE FROM attendance WHERE tenant_id = $1 AND date = $2', [req.tenantId, date]);
    for (const s of students.rows) {
      const status = req.body[`present_${s.id}`] ? 'present' : 'absent';
      await pool.query('INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1, $2, $3, $4)', [req.tenantId, s.id, date, status]);
    }
    res.redirect('/app/attendance');
  } catch (e) {
    res.status(500).send("Error saving attendance");
  }
});

app.get('/app/grades', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT g.*, s.name as student_name FROM grades g JOIN students s ON g.student_id = s.id WHERE g.tenant_id = $1 ORDER BY g.created_at DESC LIMIT 50', [req.tenantId]);
    const table = rows.map(g => `<tr><td>${esc(g.student_name)}</td><td>${esc(g.subject)}</td><td>${g.score}</td><td>${esc(g.term) || '-'}</td><td>${g.year || '-'}</td></tr>`).join('');
    res.send(renderPage('Grades', `<div class="card"><h1>Grades</h1><a href="/app/grades/add" class="btn btn-green">Add Grades</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th><th>Year</th></tr></thead><tbody>${table || '<tr><td colspan="5">No grades yet</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading grades");
  }
});

app.get('/app/grades/add', requireAuth, async (req, res) => {
  try {
    const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
    const options = students.rows.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    res.send(renderPage('Add Grade', `<div class="card" style="max-width:500px"><h1>Add Grade</h1><form method="POST" action="/app/grades/add"><select name="student_id" required><option value="">Select Student</option>${options}</select><input name="subject" placeholder="Subject (e.g. Mathematics)" required><input name="score" type="number" placeholder="Score" required><input name="term" placeholder="Term (e.g. Term 1)"><input name="year" type="number" placeholder="Year" value="${new Date().getFullYear()}"><button class="btn btn-green" style="width:100%">Save Grade</button></form></div>`, { tenant_name: req.tenant.name }));
  } catch (e) {
    res.status(500).send("Error loading grade form");
  }
});

app.post('/app/grades/add', requireAuth, async (req, res) => {
  try {
    const { student_id, subject, score, term, year } = req.body;
    await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1, $2, $3, $4, $5, $6)', [req.tenantId, student_id, subject, score, term, year]);
    const student = await pool.query('SELECT * FROM students WHERE id = $1', [student_id]);
    if (student.rows[0] && student.rows[0].guardian_phone) {
      await sendSMS(student.rows[0].guardian_phone, `${student.rows[0].name} scored ${score} in ${subject} at ${req.tenant.name}. Check parent portal for details.`);
    }
    res.redirect('/app/grades');
  } catch (e) {
    res.status(500).send("Error saving grade");
  }
});

// --- Webhooks & Utilities ---

app.post('/api/momo/webhook', async (req, res) => {
  try {
    const { reference, status, transactionId } = req.body;
    if (status === 'SUCCESSFUL') {
      const payment = await pool.query('SELECT * FROM payment_requests WHERE reference = $1', [reference]);
      if (payment.rows[0]) {
        await pool.query('UPDATE payment_requests SET status = $1, momo_transaction_id = $2 WHERE reference = $3', ['success', transactionId, reference]);
        await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, payment_method, momo_ref) VALUES ($1, $2, $3, $3, $4, $5)', [payment.rows[0].tenant_id, payment.rows[0].student_id, payment.rows[0].amount, 'momo', reference]);
        await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2', [payment.rows[0].amount, payment.rows[0].student_id]);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Webhook failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'ssewasswa-api', version: '8.1-fixed' });
});

app.get('/', (req, res) => {
  res.send('SSEWASSWA API is running.');
});

// Catch-all 404 Handler
app.use((req, res) => {
  res.status(404).send(renderPage('404 Not Found', '<div class="card" style="text-align:center"><h1>404</h1><p>The page you are looking for does not exist.</p><a href="/login" class="btn">Go to Login</a></div>', null, true));
});

// --- Initialize & Start ---
initDB().then(() => {
  console.log('Database ready - configuring session...');
  app.use(session({
    store: new pgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-secret-key-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if using HTTPS in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    }
  }));

  app.listen(PORT, () => {
    console.log(`✅ Server listening securely on port ${PORT}`);
  });

}).catch((err) => {
  console.error('❌ FATAL: Database init failed:', err.message);
  process.exit(1);
});
