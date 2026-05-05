const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
let dbReady = false;

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ WARNING: DATABASE_URL missing. Server starting anyway...');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dummy',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  query_timeout: 5000,
  statement_timeout: 5000
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);

// NOTE: Session is initialized INSIDE app.listen() at the bottom to prevent Render crashes!

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SMS_CONFIG = { apiKey: process.env.SMS_API_KEY || 'demo', username: process.env.SMS_USERNAME || 'sandbox', senderId: 'SSEWASSWA' };
const MOMO_CONFIG = { apiKey: process.env.MOMO_API_KEY || 'demo', baseUrl: 'https://sandbox.momodeveloper.mtn.com' };

function renderPage(title, content, user = null, isPublic = false) {
  const nav = user && !isPublic ? `<div style="background:#1e40af;color:white;padding:12px 24px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap"><div><strong>${esc(user.tenant_name || 'SSEWASSWA')}</strong></div><div style="display:flex;gap:12px;flex-wrap:wrap"><a href="/app" style="color:white;text-decoration:none">Dashboard</a><a href="/app/students" style="color:white;text-decoration:none">Students</a><a href="/app/fees" style="color:white;text-decoration:none">Fees</a><a href="/app/fees/defaulters" style="color:white;text-decoration:none">Defaulters</a><a href="/app/attendance" style="color:white;text-decoration:none">Attendance</a><a href="/app/attendance/stats" style="color:white;text-decoration:none">Analytics</a><a href="/app/grades" style="color:white;text-decoration:none">Grades</a><a href="/app/sms/bulk" style="color:white;text-decoration:none">SMS</a><a href="/app/settings" style="color:white;text-decoration:none">Settings</a><a href="/logout" style="color:white;text-decoration:none">Logout</a></div></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui;background:#f8fafc;color:#1e293b;margin:0;padding:24px}.card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;max-width:900px;margin:0 auto 16px}.btn{background:#1e40af;color:white;border:none;border-radius:8px;padding:10px 16px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px}.btn-green{background:#16a34a}.btn-red{background:#dc2626}.btn-orange{background:#ea580c}input,select,textarea{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin:8px 0 12px;box-sizing:border-box}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}.stat-card{background:white;padding:20px;border-radius:12px;border:1px solid #e2e8f0}.stat-num{font-size:32px;font-weight:bold;color:#1e40af}.badge{padding:4px 8px;border-radius:6px;font-size:12px;font-weight:600}.badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}@media print{.btn,nav{display:none}body{padding:0}}</style></head><body>${nav}${content}</body></html>`;
}

async function checkDb(req, res, next) {
  if (!dbReady) return res.status(503).send(`<div style="text-align:center;padding:50px;font-family:sans-serif"><h1>⏳ Waking up database...</h1><p>Please wait 10-20 seconds and <a href="${req.url}">refresh</a>.</p></div>`);
  next();
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  req.tenant = req.session.tenant;
  req.tenantId = req.session.tenant.id;
  next();
};

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden</h1></div>', { tenant_name: req.tenant?.name }));
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin', 'teacher'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden</h1></div>', { tenant_name: req.tenant?.name }));
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden - Admins Only</h1></div>', { tenant_name: req.tenant?.name }));
  next();
};

async function sendSMS(phone, message) {
  if (SMS_CONFIG.apiKey === 'demo') { console.log(`[SMS DEMO] ${phone}: ${message}`); return { success: true }; }
  try {
    await axios.post('https://api.africastalking.com/version1/messaging', `username=${SMS_CONFIG.username}&to=${phone}&message=${encodeURIComponent(message)}&from=${SMS_CONFIG.senderId}`, { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return { success: true };
  } catch (e) { console.error('SMS Error:', e.message); return { success: false }; }
}

async function sendBulkSMS(tenantId, message) {
  const { rows } = await pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL AND guardian_phone != \'\'', [tenantId]);
  for (const r of rows) { await sendSMS(r.guardian_phone, message); await new Promise(res => setTimeout(res, 200)); }
}

// --- AUTH ---
app.get('/login', (req, res) => {
  res.send(renderPage('Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>School Login</h1><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required /><input name="password" placeholder="Password" type="password" required /><button type="submit" class="btn" style="width:100%">Login</button></form><p style="margin-top:1rem;text-align:center"><a href="/forgot-password">Forgot Password?</a><br><a href="/parent/login">Parent Login</a> | <a href="/create-site">Create School</a></p></div>'));
});

app.post('/login', checkDb, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT u.*, t.subdomain, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1', [email]);
    if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login" class="btn">Try Again</a></div>'));
    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain, name: user.rows[0].tenant_name };
    res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
  } catch (e) { res.status(500).send("DB Error"); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// --- FORGOT PASSWORD ---
app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Reset', '<div class="card" style="max-width:400px;margin:60px auto"><h1>Forgot Password</h1><form method="POST" action="/forgot-password"><input name="email" type="email" required><button class="btn" style="width:100%">Send Link</button></form></div>'));
});

app.post('/forgot-password', checkDb, async (req, res) => {
  try {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [req.body.email]);
    if (user.rows[0]) {
      const crypto = require('crypto');
      const token = crypto.randomBytes(20).toString('hex');
      await pool.query('INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')', [req.body.email, token]);
      console.log(`🔑 RESET LINK: https://${req.headers.host}/reset-password/${token}`);
    }
    res.send(renderPage('Sent', '<div class="card" style="max-width:400px;margin:60px auto;text-align:center"><h1>Check Render Logs</h1><p>If email exists, reset link was printed to logs.</p><a href="/login" class="btn">Login</a></div>'));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/reset-password/:token', checkDb, async (req, res) => {
  const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]);
  if (!reset.rows[0]) return res.send(renderPage('Expired', '<div class="card"><h1>Invalid Link</h1></div>'));
  res.send(renderPage('New Password', `<div class="card" style="max-width:400px;margin:60px auto"><form method="POST" action="/reset-password/${req.params.token}"><input name="password" type="password" placeholder="New Password" required><button class="btn btn-green" style="width:100%">Reset</button></form></div>`));
});

app.post('/reset-password/:token', checkDb, async (req, res) => {
  try {
    const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]);
    if (!reset.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid</h1></div>'));
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, reset.rows[0].email]);
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [reset.rows[0].id]);
    res.send(renderPage('Success', '<div class="card" style="max-width:400px;margin:60px auto;text-align:center"><h1>Password Reset!</h1><a href="/login" class="btn btn-green">Login</a></div>'));
  } catch (e) { res.status(500).send("Error"); }
});

// --- PARENT PORTAL ---
app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', '<div class="card" style="max-width:400px;margin:60px auto"><h1>Parent Login</h1><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XXXXXXXX" required /><button type="submit" class="btn" style="width:100%">Send OTP</button></form></div>'));
});

app.post('/parent/send-otp', checkDb, async (req, res) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')', [req.body.phone, otp]);
    await sendSMS(req.body.phone, `SSEWASSWA OTP: ${otp}`);
    res.send(renderPage('Verify', `<div class="card" style="max-width:400px;margin:60px auto"><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="${esc(req.body.phone)}"><input name="otp" placeholder="6-digit OTP" required /><button type="submit" class="btn" style="width:100%">Verify</button></form></div>`));
  } catch (e) { res.status(500).send("Error"); }
});

app.post('/parent/verify-otp', checkDb, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM parent_otps WHERE phone=$1 AND otp=$2 AND expires_at > NOW() AND used=false ORDER BY id DESC LIMIT 1', [req.body.phone, req.body.otp]);
    if (!result.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid OTP</h1></div>'));
    await pool.query('UPDATE parent_otps SET used=true WHERE id=$1', [result.rows[0].id]);
    let parent = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
    if (!parent.rows[0]) {
      const tenant = await pool.query('SELECT id FROM tenants WHERE subdomain=$1', ['main']);
      await pool.query('INSERT INTO parents (phone, verified, tenant_id) VALUES ($1, true, $2)', [req.body.phone, tenant.rows[0].id]);
      parent = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
    }
    req.session.parent = parent.rows[0];
    res.redirect('/parent/dashboard');
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/parent/dashboard', checkDb, async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const students = await pool.query('SELECT * FROM students WHERE parent_id=$1 OR guardian_phone=$2', [req.session.parent.id, req.session.parent.phone]);
  const cards = students.rows.map(s => `<div class="card"><h3>${esc(s.name)}</h3><p>Class: ${esc(s.class)||'-'}</p><p>Balance: UGX ${s.balance}</p><a href="/parent/pay/${s.id}" class="btn btn-green">Pay Fees</a> <a href="/app/students/report/${s.id}" class="btn" target="_blank">Report</a></div>`).join('');
  res.send(renderPage('Parent', `<div class="card"><h1>My Children</h1></div>${cards||'<div class="card"><p>No students linked.</p></div>'}`));
});

app.get('/parent/pay/:id', checkDb, async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Pay', `<div class="card" style="max-width:500px"><h1>Pay for ${esc(s.name)}</h1><p>Balance: UGX ${s.balance}</p><form method="POST" action="/parent/pay"><input type="hidden" name="student_id" value="${s.id}"><input name="amount" type="number" required><input name="phone" value="${esc(req.session.parent.phone)}" required><button class="btn btn-green" style="width:100%">Pay MoMo</button></form></div>`));
});

app.post('/parent/pay', checkDb, async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  try {
    const { student_id, amount, phone } = req.body;
    const ref = `FEE-${Date.now()}`;
    const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
    await pool.query('INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1,$2,$3,$4,$5)', [s.tenant_id, student_id, amount, phone, ref]);
    if (MOMO_CONFIG.apiKey === 'demo') {
      await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [amount, student_id]);
      await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]);
      return res.send(renderPage('Success', `<div class="card"><h1>Payment Successful!</h1><a href="/parent/dashboard" class="btn">Back</a></div>`));
    }
    res.send(renderPage('Processing', `<div class="card"><h1>Check phone for MoMo prompt.</h1></div>`));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/parent/logout', (req, res) => req.session.destroy(() => res.redirect('/parent/login')));

// --- SUPER ADMIN ---
app.get('/super-admin', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('Admin', `<div class="card"><h1>Super Admin</h1><p><a href="/super-admin/tenants" class="btn">Schools</a><a href="/super-admin/users" class="btn">Users</a><a href="/create-site" class="btn btn-green">Add School</a></p></div>`));
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants ORDER BY id');
  res.send(renderPage('Schools', `<div class="card"><table><thead><tr><th>Name</th><th>Sub</th><th>Plan</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.subdomain)}</td><td>${esc(r.plan)}</td></tr>`).join('')}</tbody></table></div>`));
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT u.email, u.role, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id');
  res.send(renderPage('Users', `<div class="card"><table><thead><tr><th>Email</th><th>Role</th><th>School</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.role)}</td><td>${esc(r.school)}</td></tr>`).join('')}</tbody></table></div>`));
});

// --- CREATE SITE ---
app.get('/create-site', (req, res) => {
  res.send(renderPage('Create', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Create School</h1><form method="POST" action="/create-site"><input name="name" placeholder="School Name" required><input name="subdomain" placeholder="subdomain" required><input name="admin_email" type="email" placeholder="Admin Email" required><input name="admin_password" type="password" placeholder="Admin Password" required><input name="momo_number" placeholder="MoMo Number"><button class="btn" style="width:100%">Create</button></form></div>'));
});

app.post('/create-site', checkDb, async (req, res) => {
  try {
    const { name, subdomain, admin_email, admin_password, momo_number } = req.body;
    if (!name || !subdomain || !admin_email || !admin_password) return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>All fields required</p></div>'));
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1,$2,$3,$4) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number]);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)', [tenant.rows[0].id, admin_email, await bcrypt.hash(admin_password, 10), 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    res.send(renderPage('Success', `<div class="card"><h1>Site Created!</h1><a href="/login" class="btn">Login</a></div>`));
  } catch (e) { res.send(renderPage('Error', `<div class="card"><h1>Error</h1><p>${e.code==='23505'?'Taken':e.message}</p></div>`)); }
});

// --- PUBLIC PAGE ---
app.get('/school/:sub', checkDb, async (req, res) => {
  const t = (await pool.query('SELECT t.*, s.school_motto, s.about_text FROM tenants t LEFT JOIN settings s ON t.id=s.tenant_id WHERE t.subdomain=$1', [req.params.sub])).rows[0];
  if (!t) return res.status(404).send('Not found');
  res.send(renderPage(t.name, `<div class="card" style="text-align:center;background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:60px 20px"><h1>${esc(t.name)}</h1><p>${esc(t.school_motto)}</p></div><div class="card"><p>${esc(t.about_text)}</p><br><a href="/parent/login" class="btn btn-green">Parent Portal</a></div>`, null, true));
});

// --- DASHBOARD ---
app.get('/app', requireAuth, checkDb, async (req, res) => {
  try {
    const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [req.tenantId]);
    const fees = await pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS total FROM fees WHERE tenant_id=$1', [req.tenantId]);
    const att = await pool.query('SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status=\'present\'', [req.tenantId]);
    res.send(renderPage('Dashboard', `<div class="stats"><div class="stat-card"><div>Students</div><div class="stat-num">${students.rows[0].c}</div></div><div class="stat-card"><div>Fees Collected</div><div class="stat-num">UGX ${fees.rows[0].total}</div></div><div class="stat-card"><div>Present Today</div><div class="stat-num">${att.rows[0].c}</div></div></div><div class="card"><h1>${esc(req.tenant.name)}</h1><br><a href="/app/students/add" class="btn btn-green">Add Student</a> <a href="/app/fees/add" class="btn">Record Fee</a> <a href="/app/attendance/mark" class="btn">Attendance</a> <a href="/app/grades/add" class="btn">Grades</a> <a href="/app/users/add" class="btn btn-orange">Add Teacher</a></div>`, { tenant_name: req.tenant.name }));
  } catch (e) { res.status(500).send("Error"); }
});

// --- SETTINGS ---
app.get('/app/settings', requireAuth, requireAdmin, checkDb, async (req, res) => {
  const s = (await pool.query('SELECT * FROM settings WHERE tenant_id=$1', [req.tenantId])).rows[0];
  res.send(renderPage('Settings', `<div class="card" style="max-width:500px"><h1>School Settings</h1><form method="POST" action="/app/settings"><input name="school_motto" value="${esc(s.school_motto)}" placeholder="School Motto"><textarea name="about_text" rows="4" placeholder="About the school">${esc(s.about_text)}</textarea><input name="contact_email" value="${esc(s.contact_email)}" placeholder="Contact Email"><input name="whatsapp_number" value="${esc(s.whatsapp_number)}" placeholder="WhatsApp Number"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/settings', requireAuth, requireAdmin, checkDb, async (req, res) => {
  await pool.query('UPDATE settings SET school_motto=$1, about_text=$2, contact_email=$3, whatsapp_number=$4 WHERE tenant_id=$5', [req.body.school_motto, req.body.about_text, req.body.contact_email, req.body.whatsapp_number, req.tenantId]);
  res.redirect('/app/settings');
});

// --- STUDENTS ---
app.get('/app/students', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY id DESC', [req.tenantId]);
  const t = rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.guardian_phone)}</td><td>UGX ${s.balance}</td><td><a href="/app/students/report/${s.id}" class="btn">Report</a> <a href="/app/fees/add?student_id=${s.id}" class="btn">Pay</a> <a href="/app/students/edit/${s.id}" class="btn btn-orange">Edit</a> <a href="/app/students/delete/${s.id}" class="btn btn-red" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('');
  res.send(renderPage('Students', `<div class="card"><h1>Students</h1><a href="/app/students/add" class="btn btn-green">Add</a> <a href="/app/students/export" class="btn btn-orange">Download CSV</a><table style="margin-top:16px"><thead><tr><th>Name</th><th>Class</th><th>Phone</th><th>Balance</th><th>Action</th></tr></thead><tbody>${t||'<tr><td colspan="5">No students</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/students/export', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT name, class, guardian_name, guardian_phone, balance FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  let csv = 'Name,Class,Guardian,Phone,Balance\n';
  rows.forEach(s => { csv += `"${s.name}","${s.class||''}","${s.guardian_name||''}","${s.guardian_phone||''}",${s.balance}\n`; });
  res.header('Content-Type', 'text/csv').attachment('students.csv').send(csv);
});

app.get('/app/students/add', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Add', `<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" placeholder="Student Name" required><input name="class" placeholder="Class e.g. P.3"><input name="guardian_name" placeholder="Guardian Name"><input name="guardian_phone" placeholder="07XXXXXXXX"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/students/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  try {
    await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, req.body.name, req.body.class, req.body.guardian_name, req.body.guardian_phone]);
    if (req.body.guardian_phone) await sendSMS(req.body.guardian_phone, `${req.body.name} registered at ${req.tenant.name}.`);
    res.redirect('/app/students');
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/app/students/edit/:id', requireAuth, requireStaff, checkDb, async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit', `<div class="card" style="max-width:500px"><h1>Edit ${esc(s.name)}</h1><form method="POST" action="/app/students/edit/${s.id}"><input name="name" value="${esc(s.name)}" required><input name="class" value="${esc(s.class)}"><input name="guardian_name" value="${esc(s.guardian_name)}"><input name="guardian_phone" value="${esc(s.guardian_phone)}"><button class="btn btn-green" style="width:100%">Update</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/students/edit/:id', requireAuth, requireStaff, checkDb, async (req, res) => {
  await pool.query('UPDATE students SET name=$1, class=$2, guardian_name=$3, guardian_phone=$4 WHERE id=$5 AND tenant_id=$6', [req.body.name, req.body.class, req.body.guardian_name, req.body.guardian_phone, req.params.id, req.tenantId]);
  res.redirect('/app/students');
});

app.get('/app/students/delete/:id', requireAuth, requireAdmin, checkDb, async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
  res.redirect('/app/students');
});

// --- REPORT CARD ---
app.get('/app/students/report/:id', requireAuth, checkDb, async (req, res) => {
  try {
    const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0];
    if (!s) return res.status(404).send('Not found');
    const grades = await pool.query('SELECT * FROM grades WHERE student_id=$1 ORDER BY year DESC, term DESC', [req.params.id]);
    const fees = await pool.query('SELECT * FROM fees WHERE student_id=$1 ORDER BY year DESC', [req.params.id]);
    const att = await pool.query('SELECT COUNT(*) FILTER (WHERE status=\'present\') as present, COUNT(*) as total FROM attendance WHERE student_id=$1', [req.params.id]);
    const attPercent = att.rows[0].total > 0 ? Math.round((att.rows[0].present / att.rows[0].total) * 100) : 0;

    res.send(renderPage(`Report: ${s.name}`, `
      <div class="card" style="text-align:center"><h1>${esc(req.tenant.name)}</h1><h2>STUDENT REPORT CARD</h2><p><strong>Name:</strong> ${esc(s.name)} | <strong>Class:</strong> ${esc(s.class)} | <strong>Balance:</strong> UGX ${s.balance}</p><p><strong>Attendance:</strong> ${attPercent}% (${att.rows[0].present}/${att.rows[0].total} days)</p></div>
      <div class="card"><h3>Academic Performance</h3><table><thead><tr><th>Subject</th><th>Score</th><th>Term</th><th>Year</th></tr></thead><tbody>${grades.rows.map(g => `<tr><td>${esc(g.subject)}</td><td>${g.score}</td><td>${esc(g.term)}</td><td>${g.year}</td></tr>`).join('')||'<tr><td colspan="4">No grades</td></tr>'}</tbody></table></div>
      <div class="card"><h3>Fee Statement</h3><table><thead><tr><th>Term</th><th>Due</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${fees.rows.map(f => `<tr><td>${esc(f.term)} ${f.year}</td><td>${f.amount}</td><td>${f.paid}</td><td>${f.amount-f.paid}</td></tr>`).join('')||'<tr><td colspan="4">No fees</td></tr>'}</tbody></table></div>
      <div class="card" style="text-align:center"><button onclick="window.print()" class="btn btn-green">Print Report Card</button></div>
    `, { tenant_name: req.tenant.name }));
  } catch (e) { res.status(500).send("Error"); }
});

// --- FEES ---
app.get('/app/fees', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT f.*, s.name as sn FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.id DESC LIMIT 50', [req.tenantId]);
  res.send(renderPage('Fees', `<div class="card"><h1>Fees</h1><a href="/app/fees/add" class="btn btn-green">Record</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Due</th><th>Paid</th><th>Term</th><th>Method</th></tr></thead><tbody>${rows.map(f => `<tr><td>${esc(f.sn)}</td><td>${f.amount}</td><td>${f.paid}</td><td>${esc(f.term)}</td><td>${esc(f.payment_method)}</td></tr>`).join('')||'<tr><td colspan="5">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/fees/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]);
  res.send(renderPage('Pay', `<div class="card" style="max-width:500px"><h1>Record Payment</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}" ${req.query.student_id==s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select><input name="amount" type="number" placeholder="Amount Due" required><input name="paid" type="number" placeholder="Amount Paid" required><input name="term" placeholder="Term e.g. Term 1"><input name="year" type="number" value="${new Date().getFullYear()}"><select name="payment_method"><option>Cash</option><option>MoMo</option><option>Bank</option></select><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/fees/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  try {
    const { student_id, amount, paid, term, year, payment_method } = req.body;
    const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
    await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.tenantId, student_id, amount, paid, term, year, payment_method]);
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [paid, student_id]);
    if (s.guardian_phone) await sendSMS(s.guardian_phone, `Payment of UGX ${paid} received for ${s.name}. Balance: UGX ${s.balance - paid}`);
    res.redirect('/app/fees');
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/app/fees/defaulters', requireAuth, requireAdmin, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id=$1 AND balance > 0 ORDER BY balance DESC', [req.tenantId]);
  const total = rows.reduce((sum, s) => sum + parseFloat(s.balance), 0);
  res.send(renderPage('Defaulters', `<div class="card"><h1>Fee Defaulters</h1><p><strong>Total Outstanding:</strong> UGX ${total}</p><table style="margin-top:16px"><thead><tr><th>Name</th><th>Class</th><th>Guardian</th><th>Balance</th></tr></thead><tbody>${rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.guardian_phone)}</td><td class="badge-red">UGX ${s.balance}</td></tr>`).join('')||'<tr><td colspan="4">No defaulters! 🎉</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

// --- ATTENDANCE ---
app.get('/app/attendance', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT a.*, s.name FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date=CURRENT_DATE', [req.tenantId]);
  const t = rows.map(a => `<tr><td>${esc(a.name)}</td><td><span class="badge ${a.status==='present'?'badge-green':'badge-red'}">${a.status}</span></td></tr>`).join('');
  res.send(renderPage('Att', `<div class="card"><h1>Today</h1><a href="/app/attendance/mark" class="btn btn-green">Mark</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${t||'<tr><td colspan="2">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/attendance/mark', requireAuth, requireStaff, checkDb, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]);
  res.send(renderPage('Mark', `<div class="card" style="max-width:500px"><h1>Mark Attendance</h1><form method="POST" action="/app/attendance/mark">${students.rows.map(s => `<label style="display:block;margin:8px 0"><input type="checkbox" name="p_${s.id}" checked> ${esc(s.name)}</label>`).join('')}<button class="btn btn-green" style="width:100%;margin-top:16px">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/attendance/mark', requireAuth, requireStaff, checkDb, async (req, res) => {
  try {
    const students = await pool.query('SELECT id FROM students WHERE tenant_id=$1', [req.tenantId]);
    await pool.query('DELETE FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE', [req.tenantId]);
    for (const s of students.rows) {
      await pool.query('INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1,$2,CURRENT_DATE,$3)', [req.tenantId, s.id, req.body[`p_${s.id}`] ? 'present' : 'absent']);
    }
    res.redirect('/app/attendance');
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/app/attendance/stats', requireAuth, checkDb, async (req, res) => {
  const classStats = await pool.query(`SELECT s.class, COUNT(*) FILTER (WHERE a.status='present') as present, COUNT(*) as total FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY s.class ORDER BY s.class`, [req.tenantId]);
  const rows = classStats.rows.map(r => {
    const pct = r.total > 0 ? Math.round((r.present/r.total)*100) : 0;
    const color = pct>75?'#16a34a':pct>50?'#f59e0b':'#dc2626';
    return `<tr><td>${esc(r.class)||'Unassigned'}</td><td>${r.present}/${r.total}</td><td style="width:40%"><div style="background:#e2e8f0;border-radius:4px;overflow:hidden;height:24px"><div style="background:${color};width:${pct}%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:bold">${pct}%</div></div></td></tr>`;
  }).join('');
  res.send(renderPage('Analytics', `<div class="card"><h1>Attendance (30 Days)</h1><table style="margin-top:16px"><thead><tr><th>Class</th><th>Present/Total</th><th>Rate</th></tr></thead><tbody>${rows||'<tr><td colspan="3">No data</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

// --- GRADES ---
app.get('/app/grades', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT g.*, s.name as sn FROM grades g JOIN students s ON g.student_id=s.id WHERE g.tenant_id=$1 ORDER BY g.id DESC LIMIT 50', [req.tenantId]);
  res.send(renderPage('Grades', `<div class="card"><h1>Grades</h1><a href="/app/grades/add" class="btn btn-green">Add</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th></tr></thead><tbody>${rows.map(g => `<tr><td>${esc(g.sn)}</td><td>${esc(g.subject)}</td><td>${g.score}</td><td>${esc(g.term)}</td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }));
});

app.get('/app/grades/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]);
  res.send(renderPage('Add', `<div class="card" style="max-width:500px"><h1>Add Grade</h1><form method="POST" action="/app/grades/add"><select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><input name="subject" placeholder="Subject" required><input name="score" type="number" placeholder="Score" required><input name="term" placeholder="Term"><input name="year" type="number" value="${new Date().getFullYear()}"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/grades/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  try {
    await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.body.student_id, req.body.subject, req.body.score, req.body.term, req.body.year]);
    const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.body.student_id])).rows[0];
    if (s && s.guardian_phone) await sendSMS(s.guardian_phone, `${s.name} scored ${req.body.score} in ${req.body.subject}.`);
    res.redirect('/app/grades');
  } catch (e) { res.status(500).send("Error"); }
});

// --- BULK SMS ---
app.get('/app/sms/bulk', requireAuth, requireAdmin, checkDb, async (req, res) => {
  const count = (await pool.query('SELECT COUNT(DISTINCT guardian_phone) as c FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL', [req.tenantId])).rows[0].c;
  res.send(renderPage('SMS', `<div class="card" style="max-width:600px"><h1>Bulk SMS</h1><p>Will send to ${count} guardians</p><form method="POST" action="/app/sms/bulk"><textarea name="message" rows="5" placeholder="Type your message..." required></textarea><button class="btn btn-green" style="width:100%">Send to All</button></form></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/sms/bulk', requireAuth, requireAdmin, checkDb, async (req, res) => {
  await sendBulkSMS(req.tenantId, req.body.message);
  res.send(renderPage('Sent', `<div class="card"><h1>SMS Sent!</h1><a href="/app" class="btn">Dashboard</a></div>`, { tenant_name: req.tenant.name }));
});

// --- TEACHER ACCOUNTS ---
app.get('/app/users/add', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Add User', `<div class="card" style="max-width:500px"><h1>Add Teacher/Admin</h1><form method="POST" action="/app/users/add"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><select name="role"><option value="teacher">Teacher</option><option value="admin">Admin</option></select><button class="btn btn-green" style="width:100%">Create</button></form><p style="font-size:12px;color:#64748b">Teachers: attendance + grades only. Admins: full access.</p></div>`, { tenant_name: req.tenant.name }));
});

app.post('/app/users/add', requireAuth, requireAdmin, checkDb, async (req, res) => {
  try {
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4)', [req.tenantId, req.body.email, await bcrypt.hash(req.body.password, 10), req.body.role]);
    res.redirect('/app');
  } catch (e) { res.send(renderPage('Error', `<div class="card"><h1>Error</h1><p>${e.code==='23505'?'Email exists':e.message}</p></div>`, { tenant_name: req.tenant.name })); }
});

// --- WEBHOOK ---
app.post('/api/momo/webhook', checkDb, async (req, res) => {
  try {
    const { reference, status, transactionId } = req.body;
    if (status === 'SUCCESSFUL') {
      const p = await pool.query('SELECT * FROM payment_requests WHERE reference=$1', [reference]);
      if (p.rows[0]) {
        await pool.query('UPDATE payment_requests SET status=$1, momo_transaction_id=$2 WHERE reference=$3', ['success', transactionId, reference]);
        await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [p.rows[0].amount, p.rows[0].student_id]);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'fail' }); }
});

app.get('/health', (req, res) => res.json({ ok: true, db: dbReady }));
app.get('/', (req, res) => res.send('SSEWASSWA API is live.'));
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card" style="text-align:center"><h1>404</h1><a href="/login" class="btn">Login</a></div>', null, true)));

// --- SERVER START & BACKGROUND DB INIT ---
app.listen(PORT, () => {
  console.log(`🚀 SERVER LIVE ON PORT ${PORT}`);

  // CRITICAL: Session initialized here so pgSession doesn't block Render from opening the port
  app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-secret-change-in-prod',
    resave: false, saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 86400000,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
  }));

  if (process.env.DATABASE_URL) {
    console.log('⏳ Starting database setup in background...');
    initDB().catch(e => console.error('❌ BG DB init error:', e.message));
  }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))`);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
    await client.query(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', plan_expires DATE, ranking_score INTEGER DEFAULT 0, momo_number TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS parents (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS parent_otps (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, otp TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, parent_id INTEGER REFERENCES parents(id), balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, description TEXT, payment_method TEXT, momo_ref TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), amount NUMERIC NOT NULL, phone TEXT NOT NULL, reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, site_name TEXT DEFAULT 'SSEWASSWA', primary_color TEXT DEFAULT '#1e40af', contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', whatsapp_number TEXT DEFAULT '0789736737', subscription_tier TEXT DEFAULT 'free', verified BOOLEAN DEFAULT false, school_motto TEXT, about_text TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);

    const tenant = await client.query(`INSERT INTO tenants (name, subdomain, plan, momo_number) VALUES ($1,$2,$3,$4) ON CONFLICT (subdomain) DO NOTHING RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737']);
    if (tenant.rows.length > 0) {
      const tid = tenant.rows[0].id;
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com', hash, 'super_admin']);
      await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [tid, 'enterprise', true, 'Excellence', 'Digital tools for schools.']);
    }
    await client.query('COMMIT');
    dbReady = true;
    console.log('✅ Database ready!');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ DB Init Error:', err.message);
    dbReady = false;
  } finally {
    client.release();
  }
}
