require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === SECURITY ===
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// === SESSION ===
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// === RATE LIMIT ===
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));

// === UTILS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const requireAuth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const requireNotBanned = (req, res, next) => req.session.user?.banned ? res.status(403).send('Account banned') : next();
// FIX #1: requireTenantAccess now allows access when no tenant_id is in the request,
// since all data queries already filter by req.session.user.tenant_id.
const requireTenantAccess = (req, res, next) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return next();
  const requestedTid = parseInt(req.params.tenant_id || req.body.tenant_id || req.query.tenant_id);
  if (!requestedTid || u.tenant_id === requestedTid) return next();
  if (req.path.includes('/portal/') && req.path.includes(u.role)) return next();
  return res.status(403).send('Access denied to this tenant');
};
const requireSuperAdmin = (req, res, next) => req.session.user?.role === 'super_admin' ? next() : res.status(403).send('Super admin only');

// === MIGRATIONS ===
const migrations = [
  `CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, email TEXT, phone TEXT, subdomain TEXT UNIQUE, verified BOOLEAN DEFAULT false, approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, has_fundraising BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'user', approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, admission_no TEXT, name TEXT NOT NULL, class TEXT, stream TEXT, guardian_name TEXT, guardian_phone TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount INTEGER NOT NULL, paid INTEGER DEFAULT 0, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  // FIX #2: Removed FK on student_id so attendance table can store both student and member IDs
  `CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER, date DATE NOT NULL, status TEXT, UNIQUE(student_id, date))`,
  `CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS marks (id SERIAL PRIMARY KEY, exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score INTEGER, grade TEXT)`,
  `CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, budget INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, event_date DATE, budget INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS org_finance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS inventory (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, sku TEXT, quantity INTEGER DEFAULT 0, cost_price INTEGER DEFAULT 0, selling_price INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, customer_name TEXT, total INTEGER NOT NULL, paid INTEGER DEFAULT 0, status TEXT DEFAULT 'paid', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sale_items (id SERIAL PRIMARY KEY, sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE, inventory_id INTEGER REFERENCES inventory(id), quantity INTEGER, price INTEGER)`,
  `CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, invoice_no TEXT UNIQUE, customer_name TEXT, customer_contact TEXT, amount INTEGER NOT NULL, due_date DATE, status TEXT DEFAULT 'unpaid', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT, amount INTEGER NOT NULL, description TEXT, expense_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_email TEXT, action TEXT NOT NULL, details TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, amount INTEGER NOT NULL, source TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`,
  `INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS entertainment_videos (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS entertainment_music (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, artist TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS entertainment_games (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, player_name TEXT, score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`
];

(async () => {
  try {
    for (const q of migrations) await pool.query(q);
    const devEmail = 'waiswadaniel24@gmail.com';
    const devPass = 'Daniel@2025';
    const devHash = await bcrypt.hash(devPass, 10);
    // FIX #3: Added subdomain 'dev-master' so ON CONFLICT (subdomain) actually triggers on restart
    const devTenant = await pool.query(`INSERT INTO tenants(name,type,email,verified,approved,subdomain) VALUES('Dev Master','individual',$1,true,true,'dev-master') ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [devEmail]);
    await pool.query(`INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,role='super_admin'`, [devTenant.rows[0].id, devEmail, devHash]);
    console.log('DB Ready. Dev login:', devEmail, devPass);
  } catch (e) { console.error('DB Init Error:', e); }
})();

// === RENDER PAGE ===
const renderPage = (title, content, user) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:0.2s}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:1200px;margin:20px auto;padding:0 20px}
.card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:1px solid #e2e8f0}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:0.3s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,0.4)}.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
input,select,textarea{width:100%;padding:12px;margin:8px 0;border:2px solid #e2e8f0;border-radius:10px;font-size:16px}
input:focus,select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
table{width:100%;border-collapse:collapse;margin-top:15px}th,td{padding:12px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9;font-weight:700}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px;border-radius:20px;text-align:center;margin-bottom:30px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:20px 0}
.stat-card{background:white;padding:20px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08)}
.stat-num{font-size:32px;font-weight:800;color:#4f46e5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.tag{display:inline-block;padding:4px 12px;background:#e0e7ff;color:#3730a3;border-radius:20px;font-size:12px;font-weight:600}
.alert{padding:15px;border-radius:10px;margin:15px 0}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}
@media(max-width:768px){.nav{flex-direction:column;gap:10px}.stats,.grid{grid-template-columns:1fr}}
</style></head><body>
<nav class="nav">
  <div><a href="/" style="font-size:20px;font-weight:800">SSEWASSWA</a></div>
  <div>${user ? `<span>Hi, ${esc(user.email.split('@')[0])}</span><a href="/dashboard">Dashboard</a><a href="/logout">Logout</a>` : `<a href="/login">Login</a><a href="/register">Register</a>`}</div>
</nav>
<div class="container">${content}</div>
</body></html>`;

// === AUTH ===
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.send(renderPage('SSEWASSWA Platform', `
    <div class="hero">
      <h1 style="font-size:48px;margin-bottom:15px">All-in-One Management</h1>
      <p style="font-size:20px;opacity:0.9;margin-bottom:30px">School • Organization • Church • Business • Individual</p>
      <a href="/register" class="btn btn-gold" style="font-size:18px;padding:15px 30px">Start Free</a>
    </div>
    <div class="grid">
      <div class="card"><h3>Schools</h3><p>Students, Fees, Exams, Reports</p></div>
      <div class="card"><h3>Organizations</h3><p>Members, Projects, Payroll</p></div>
      <div class="card"><h3>Churches</h3><p>Congregation, Tithes, Events</p></div>
      <div class="card"><h3>Business</h3><p>POS, Inventory, Invoices, P&L</p></div>
    </div>
  `, null));
});

app.get('/login', (req, res) => {
  res.send(renderPage('Login', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Welcome Back</h2>
      <form method="POST" action="/login">
        <input name="email" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn" style="width:100%">Login</button>
      </form>
      <p style="text-align:center;margin-top:15px">No account? <a href="/register">Register</a></p>
    </div>
  `, null));
});

app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
  if (!u || u.banned || !u.approved) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials or account not approved</div>', null));
  if (!(await bcrypt.compare(password, u.password))) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials</div>', null));
  req.session.user = u;
  res.redirect('/dashboard');
}));

app.get('/register', (req, res) => {
  res.send(renderPage('Register', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Create Account</h2>
      <form method="POST" action="/register">
        <input name="org_name" placeholder="Organization/School/Business Name" required>
        <select name="type" required>
          <option value="">Select Type</option>
          <option value="school">School</option>
          <option value="organization">Organization</option>
          <option value="church">Church</option>
          <option value="business">Business</option>
          <option value="individual">Individual</option>
        </select>
        <input name="email" type="email" placeholder="Your Email" required>
        <input name="phone" placeholder="Phone +256..." required>
        <input name="password" type="password" placeholder="Password (min 6)" minlength="6" required>
        <button class="btn" style="width:100%">Register</button>
      </form>
    </div>
  `, null));
});

app.post('/register', ah(async (req, res) => {
  const { org_name, type, email, phone, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const subdomain = org_name.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
  const tenant = await pool.query('INSERT INTO tenants(name,type,email,phone,subdomain,approved) VALUES($1,$2,$3,$4,$5,true) RETURNING id', [org_name, type, email, phone, subdomain]);
  await pool.query('INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,$4,true)', [tenant.rows[0].id, email, hash, type]);
  res.send(renderPage('Success', '<div class="card"><div class="alert alert-success">Account created! You can now login.</div><a href="/login" class="btn">Login</a></div>', null));
}));

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// === DASHBOARD ROUTER ===
app.get('/dashboard', requireAuth, (req, res) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return res.redirect('/dev/master');
  res.redirect(`/portal/${u.tenant_type}`);
});

// === SCHOOL PORTAL ===
app.get('/portal/school', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, fees, exams] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount-paid),0) FROM fees WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM exams WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('School Dashboard', `
    <div class="hero"><h1>School Portal</h1><p>Manage students, fees, exams, reports</p></div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${students.rows[0].count}</div><div>Students</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(fees.rows[0].coalesce).toLocaleString()}</div><div>Fees Due</div></div>
      <div class="stat-card"><div class="stat-num">${exams.rows[0].count}</div><div>Exams</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Students</h3><a href="/school/students" class="btn">Manage Students</a></div>
      <div class="card"><h3>Fees</h3><a href="/school/fees" class="btn">Fee Management</a></div>
      <div class="card"><h3>Exams</h3><a href="/school/exams" class="btn">Exam Results</a></div>
      <div class="card"><h3>Reports</h3><a href="/school/reports" class="btn">Generate Reports</a></div>
    </div>
  `, req.session.user));
}));

// === ORGANIZATION PORTAL ===
app.get('/portal/organization', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, projects, events, budget] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM projects WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM events WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM org_finance WHERE tenant_id=$1', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Organization Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#8b5cf6)">
      <h1>Organization Portal</h1><p>Manage members, projects, events, budget</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">${projects.rows[0].count}</div><div>Projects</div></div>
      <div class="stat-card"><div class="stat-num">${events.rows[0].count}</div><div>Events</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}</div><div>Budget</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Members</h3>
        <a href="/org/members" class="btn">Member Database</a>
        <a href="/org/register" class="btn" style="margin-top:8px">Register Member</a>
        <a href="/org/attendance" class="btn" style="margin-top:8px">Attendance</a>
      </div>
      <div class="card"><h3>Projects</h3>
        <a href="/org/projects" class="btn">All Projects</a>
        <a href="/org/projects/new" class="btn" style="margin-top:8px">New Project</a>
        <a href="/org/projects/reports" class="btn" style="margin-top:8px">Project Reports</a>
      </div>
      <div class="card"><h3>Finance & Payroll</h3>
        <a href="/org/finance" class="btn">Record Income/Expense</a>
        <a href="/hr/payroll" class="btn" style="margin-top:8px">Staff Payroll</a>
        <a href="/org/reports" class="btn" style="margin-top:8px">Financial Reports</a>
      </div>
      <div class="card"><h3>Public</h3>
        <a href="/settings/public" class="btn">Edit Public Profile</a>
        ${tenant.has_fundraising ? '<a href="/fundraising" class="btn btn-gold" style="margin-top:8px">Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
    </div>
  `, req.session.user));
}));

// === BUSINESS PORTAL ===
app.get('/portal/business', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, inventory, invoices, expenses] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM inventory WHERE tenant_id=$1 AND quantity<5', [t]),
    pool.query("SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t])
  ]);
  const profit = parseInt(sales.rows[0].coalesce) - parseInt(expenses.rows[0].coalesce);
  res.send(renderPage('Business Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>Business Portal</h1><p>POS, Inventory, Invoices, Profit/Loss</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(sales.rows[0].coalesce).toLocaleString()}</div><div>Month Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit >= 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Net Profit</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${inventory.rows[0].count}</div><div>Low Stock</div></div>
      <div class="stat-card"><div class="stat-num">${invoices.rows[0].count}</div><div>Unpaid Invoices</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Point of Sale</h3><a href="/business/pos" class="btn">New Sale</a><a href="/business/sales" class="btn" style="margin-top:8px">Sales History</a></div>
      <div class="card"><h3>Inventory</h3><a href="/business/inventory" class="btn">Stock Management</a><a href="/business/inventory/add" class="btn" style="margin-top:8px">Add Product</a></div>
      <div class="card"><h3>Invoices</h3><a href="/business/invoices" class="btn">Create Invoice</a><a href="/business/invoices" class="btn" style="margin-top:8px">Unpaid List</a></div>
      <div class="card"><h3>Expenses</h3><a href="/business/expenses" class="btn">Record Expense</a><a href="/business/profit-loss" class="btn" style="margin-top:8px">Profit/Loss</a></div>
    </div>
  `, req.session.user));
}));

// === CHURCH PORTAL ===
app.get('/portal/church', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t])).rows[0];
  res.send(renderPage('Church Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c2d12,#ea580c)">
      <h1>Church Portal</h1><p>Congregation, Tithes, Events</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.count}</div><div>Members</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Quick Actions</h3>
        <a href="/org/members" class="btn">Congregation</a>
        <a href="/org/finance" class="btn" style="margin-top:8px">Tithes & Offerings</a>
        <a href="/org/events" class="btn" style="margin-top:8px">Events</a>
        <a href="/settings/public" class="btn" style="margin-top:8px">Edit Public Profile</a>
      </div>
    </div>
  `, req.session.user));
}));

// === INDIVIDUAL PORTAL ===
app.get('/portal/individual', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Personal Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
      <h1>Personal Portal</h1><p>Your budgets, goals, documents</p>
    </div>
    <div class="grid">
      <div class="card"><h3>Personal Finance</h3><a href="/individual/budget" class="btn">Budget Tracker</a></div>
      <div class="card"><h3>Goals</h3><a href="/individual/goals" class="btn">Set Goals</a></div>
      <div class="card"><h3>Documents</h3><a href="/individual/docs" class="btn">My Documents</a></div>
    </div>
  `, req.session.user));
});

// === ORG ROUTES ===
app.get('/org/members', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Members', `
    <div class="card"><h3>Member Database</h3>
      <a href="/org/register" class="btn">+ Register New Member</a>
      <table style="margin-top:15px"><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th></tr>
      ${members.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.role)}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="5">No members yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/org/register', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Register Member', `
    <div class="card"><h3>Register New Member</h3>
      <form method="POST" action="/org/register/save">
        <input name="name" placeholder="Full Name" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone +256...">
        <select name="role" required>
          <option value="">Select Role</option>
          <option>Member</option><option>Volunteer</option><option>Staff</option><option>Board</option>
        </select>
        <button class="btn btn-gold">Register Member</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/register/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, role } = req.body;
  await pool.query('INSERT INTO members(tenant_id,name,email,phone,role) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, email, phone, role]);
  res.redirect('/org/members');
}));

app.get('/org/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Projects', `
    <div class="card"><h3>All Projects</h3>
      <a href="/org/projects/new" class="btn">+ New Project</a>
      <div class="grid" style="margin-top:15px">
        ${projects.map(p => `
          <div class="card">
            <h3>${esc(p.name)}</h3>
            <p>Budget: UGX ${parseInt(p.budget).toLocaleString()}</p>
            <p>Spent: UGX ${parseInt(p.spent).toLocaleString()}</p>
            <div style="background:#e5e7eb;height:20px;border-radius:10px"><div style="background:#8b5cf6;height:20px;border-radius:10px;width:${p.budget > 0 ? Math.min(100, (p.spent / p.budget) * 100) : 0}%"></div></div>
            <p style="margin-top:8px">Status: <span class="tag">${esc(p.status)}</span></p>
          </div>
        `).join('') || '<p>No projects yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/projects/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Project', `
    <div class="card"><h3>Create Project</h3>
      <form method="POST" action="/org/projects/save">
        <input name="name" placeholder="Project Name" required>
        <input name="budget" type="number" placeholder="Budget UGX" required>
        <select name="status" required>
          <option>active</option><option>planning</option><option>completed</option>
        </select>
        <button class="btn">Create Project</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/projects/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, budget, status } = req.body;
  await pool.query('INSERT INTO projects(tenant_id,name,budget,status) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name, budget, status]);
  res.redirect('/org/projects');
}));

// === ORG FINANCE CONTINUED ===
app.get('/org/finance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT * FROM org_finance WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const income = records.filter(r => r.type === 'income').reduce((a, b) => a + parseInt(b.amount), 0);
  const expense = records.filter(r => r.type === 'expense').reduce((a, b) => a + parseInt(b.amount), 0);
  res.send(renderPage('Org Finance', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${income.toLocaleString()}</div><div>Total Income</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${expense.toLocaleString()}</div><div>Total Expense</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${income - expense >= 0 ? '#059669' : '#dc2626'}">UGX ${(income - expense).toLocaleString()}</div><div>Balance</div></div>
    </div>
    <div class="card"><h3>Record Transaction</h3>
      <form method="POST" action="/org/finance/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 2fr">
          <select name="type" required><option value="">Type</option><option value="income">Income</option><option value="expense">Expense</option></select>
          <input name="amount" type="number" placeholder="Amount UGX" required>
          <input name="description" placeholder="Description - Donation, Rent, etc" required>
        </div>
        <button class="btn">Save Record</button>
      </form>
    </div>
    <div class="card"><h3>Recent Transactions</h3>
      <table><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
      ${records.map(r => `<tr><td><span style="color:${r.type === 'income' ? '#059669' : '#dc2626'}">${r.type}</span></td><td>UGX ${parseInt(r.amount).toLocaleString()}</td><td>${esc(r.description)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/org/finance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, type, description]);
  res.redirect('/org/finance');
}));

// === ORG: ATTENDANCE ===
app.get('/org/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const today = new Date().toISOString().split('T')[0];
  res.send(renderPage('Attendance', `
    <div class="card"><h3>Mark Attendance - ${today}</h3>
      <form method="POST" action="/org/attendance/save">
        <input type="hidden" name="date" value="${today}">
        <table><tr><th>Member</th><th>Present</th></tr>
        ${members.map(m => `<tr><td>${esc(m.name)}</td><td><input type="checkbox" name="present_ids" value="${m.id}" checked></td></tr>`).join('')}
        </table>
        <button class="btn btn-gold" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/org/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { date, present_ids } = req.body;
  const present = Array.isArray(present_ids) ? present_ids : [present_ids].filter(Boolean);
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id FROM members WHERE tenant_id=$1', [t])).rows;
  for (const m of members) {
    const status = present.includes(String(m.id)) ? 'present' : 'absent';
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4',
      [t, m.id, date, status]);
  }
  res.redirect('/org/attendance');
}));

// === ORG: REPORTS ===
app.get('/org/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Reports', `
    <div class="card"><h3>Financial Reports</h3>
      <a href="/org/reports/export?type=finance" class="btn">Download Finance CSV</a>
      <a href="/org/reports/export?type=members" class="btn" style="margin-left:10px">Download Members CSV</a>
    </div>
  `, req.session.user));
}));

app.get('/org/reports/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type } = req.query;
  const t = req.session.user.tenant_id;
  let data, filename;
  if (type === 'finance') {
    data = (await pool.query('SELECT type,amount,description,created_at FROM org_finance WHERE tenant_id=$1', [t])).rows;
    filename = 'finance.csv';
  } else {
    data = (await pool.query('SELECT name,email,phone,role,joined_at FROM members WHERE tenant_id=$1', [t])).rows;
    filename = 'members.csv';
  }
  const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));
// === BUSINESS: POS ===
app.get('/business/pos', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const inventory = (await pool.query('SELECT id,name,sku,selling_price,quantity FROM inventory WHERE tenant_id=$1 AND quantity>0 ORDER BY name', [t])).rows;
  res.send(renderPage('Point of Sale', `
    <div class="card"><h3>New Sale</h3>
      <form method="POST" action="/business/pos/checkout">
        <input name="customer_name" placeholder="Customer Name" required>
        <input name="customer_contact" placeholder="Phone (optional)">
        <table id="saleTable"><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr>
        <tr>
          <td><select name="item_0_id" onchange="updatePrice(this)"><option value="">Select</option>
            ${inventory.map(i => `<option value="${i.id}" data-price="${i.selling_price}" data-qty="${i.quantity}">${esc(i.name)} - UGX ${parseInt(i.selling_price).toLocaleString()} (${i.quantity} left)</option>`).join('')}
          </select></td>
          <td id="price_0">0</td>
          <td><input type="number" name="item_0_qty" value="1" min="1" onchange="calcTotal()"></td>
          <td id="total_0">0</td>
        </tr>
        </table>
        <button type="button" onclick="addRow()" class="btn">+ Add Item</button>
        <h3 style="margin-top:20px">Grand Total: UGX <span id="grandTotal">0</span></h3>
        <input type="hidden" name="row_count" id="rowCount" value="1">
        <select name="payment_status" required><option value="paid">Paid</option><option value="credit">Credit</option></select>
        <button class="btn btn-gold" style="padding:15px;font-size:16px">Checkout & Print Receipt</button>
      </form>
    </div>
    <script>
      let rows = 1;
      // FIX #6: updatePrice now extracts the row index from the element's name attribute
      function updatePrice(sel) {
        const i = sel.name.split('_')[1];
        const price = sel.options[sel.selectedIndex]?.dataset.price || 0;
        document.getElementById('price_' + i).textContent = parseInt(price).toLocaleString();
        calcTotal();
      }
      function calcTotal() {
        let grand = 0;
        for(let i = 0; i < rows; i++) {
          const priceEl = document.getElementById('price_' + i);
          const qtyEl = document.querySelector('[name="item_' + i + '_qty"]');
          if (!priceEl || !qtyEl) continue;
          const price = parseInt(priceEl.textContent.replace(/,/g, '')) || 0;
          const qty = parseInt(qtyEl.value) || 0;
          const total = price * qty;
          document.getElementById('total_' + i).textContent = total.toLocaleString();
          grand += total;
        }
        document.getElementById('grandTotal').textContent = grand.toLocaleString();
      }
      function addRow() {
        const table = document.getElementById('saleTable');
        const newRow = table.insertRow();
        newRow.innerHTML = document.querySelector('#saleTable tr:nth-child(2)').innerHTML.replace(/_0/g, '_' + rows);
        rows++;
        document.getElementById('rowCount').value = rows;
      }
    </script>
  `, req.session.user));
}));

app.post('/business/pos/checkout', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, payment_status, row_count } = req.body;
  let total = 0;
  const items = [];
  for (let i = 0; i < parseInt(row_count); i++) {
    const id = req.body[`item_${i}_id`];
    const qty = parseInt(req.body[`item_${i}_qty`]) || 0;
    if (id && qty > 0) {
      const product = (await pool.query('SELECT selling_price,name,quantity FROM inventory WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
      if (product && product.quantity >= qty) {
        items.push({ id, qty, price: product.selling_price, name: product.name });
        total += product.selling_price * qty;
        await pool.query('UPDATE inventory SET quantity=quantity-$1 WHERE id=$2', [qty, id]);
      }
    }
  }
  const sale = (await pool.query('INSERT INTO sales(tenant_id,customer_name,total,paid,status) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [t, customer_name, total, payment_status === 'paid' ? total : 0, payment_status])).rows[0];
  for (let item of items) {
    await pool.query('INSERT INTO sale_items(sale_id,inventory_id,quantity,price) VALUES($1,$2,$3,$4)', [sale.id, item.id, item.qty, item.price]);
  }
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: `${req.session.user.tenant_name} - Receipt`, bold: true, size: 24 })] }),
        new Paragraph({ text: `Customer: ${customer_name}` }),
        new Paragraph({ text: `Date: ${new Date().toLocaleString()}` }),
        new Paragraph({ text: "" }),
        ...items.map(i => new Paragraph({ text: `${i.name} x${i.qty} - UGX ${(i.price * i.qty).toLocaleString()}` })),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: `TOTAL: UGX ${total.toLocaleString()}`, bold: true })] }),
        new Paragraph({ text: `Status: ${payment_status.toUpperCase()}` }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Receipt-${sale.id}.docx`);
  res.send(buffer);
}));

// === BUSINESS: INVENTORY ===
app.get('/business/inventory', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Inventory', `
    <div class="card"><h3>Stock Management</h3>
      <a href="/business/inventory/add" class="btn">+ Add Product</a>
      <table style="margin-top:15px"><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Value</th></tr>
      ${items.map(i => `
        <tr ${i.quantity < 5 ? 'style="background:#fee2e2"' : ''}>
          <td>${esc(i.sku)}</td>
          <td>${esc(i.name)}</td>
          <td>${i.quantity}</td>
          <td>${parseInt(i.cost_price).toLocaleString()}</td>
          <td>${parseInt(i.selling_price).toLocaleString()}</td>
          <td>${(i.quantity * i.selling_price).toLocaleString()}</td>
        </tr>
      `).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/inventory/add', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Product', `
    <div class="card"><h3>Add Product to Inventory</h3>
      <form method="POST" action="/business/inventory/save">
        <input name="name" placeholder="Product Name" required>
        <input name="sku" placeholder="SKU/Code" required>
        <input name="quantity" type="number" placeholder="Quantity" required>
        <input name="cost_price" type="number" placeholder="Cost Price UGX" required>
        <input name="selling_price" type="number" placeholder="Selling Price UGX" required>
        <button class="btn">Add Product</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/inventory/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, sku, quantity, cost_price, selling_price } = req.body;
  await pool.query('INSERT INTO inventory(tenant_id,name,sku,quantity,cost_price,selling_price) VALUES($1,$2,$3,$4,$5,$6)', [t, name, sku, quantity, cost_price, selling_price]);
  res.redirect('/business/inventory');
}));

// === BUSINESS: INVOICES ===
app.get('/business/invoices', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Invoices', `
    <div class="card"><h3>Invoices</h3>
      <a href="/business/invoices/new" class="btn">+ New Invoice</a>
      <table style="margin-top:15px"><tr><th>No.</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Action</th></tr>
      ${invoices.map(i => `
        <tr>
          <td>${esc(i.invoice_no)}</td>
          <td>${esc(i.customer_name)}</td>
          <td>UGX ${parseInt(i.amount).toLocaleString()}</td>
          <td>${i.due_date ? new Date(i.due_date).toLocaleDateString() : 'N/A'}</td>
          <td>${i.status === 'paid' ? 'Paid' : 'Unpaid'}</td>
          <td><a href="/business/invoices/${i.id}/print" target="_blank">Print</a></td>
        </tr>
      `).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/invoices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Invoice', `
    <div class="card"><h3>Create Invoice</h3>
      <form method="POST" action="/business/invoices/save">
        <input name="customer_name" placeholder="Customer Name" required>
        <input name="customer_contact" placeholder="Phone/Email">
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="due_date" type="date" required>
        <textarea name="items" placeholder="Item 1 - UGX 10,000&#10;Item 2 - UGX 5,000" rows="4"></textarea>
        <button class="btn">Generate Invoice</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/invoices/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, amount, due_date, items } = req.body;
  const invoice_no = 'INV' + Date.now();
  await pool.query('INSERT INTO invoices(tenant_id,invoice_no,customer_name,customer_contact,amount,due_date,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [t, invoice_no, customer_name, customer_contact, amount, due_date, 'unpaid']);
  res.redirect('/business/invoices');
}));

app.get('/business/invoices/:id/print', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const i = (await pool.query('SELECT i.*,t.name as company_name FROM invoices i JOIN tenants t ON i.tenant_id=t.id WHERE i.id=$1 AND i.tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!i) return res.status(404).send('Not found');
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: i.company_name, bold: true, size: 28 })] }),
        new Paragraph({ children: [new TextRun({ text: `INVOICE #${i.invoice_no}`, bold: true, size: 24 })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Bill To: ${i.customer_name}` }),
        new Paragraph({ text: `Contact: ${i.customer_contact}` }),
        new Paragraph({ text: `Due Date: ${i.due_date ? new Date(i.due_date).toDateString() : 'N/A'}` }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Amount Due: UGX ${parseInt(i.amount).toLocaleString()}`, bold: true, size: 32 })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Status: ${i.status.toUpperCase()}` }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Invoice-${i.invoice_no}.docx`);
  res.send(buffer);
}));

// === BUSINESS: EXPENSES ===
app.get('/business/expenses', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const expenses = (await pool.query('SELECT * FROM expenses WHERE tenant_id=$1 ORDER BY expense_date DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Expenses', `
    <div class="card"><h3>Record Expense</h3>
      <form method="POST" action="/business/expenses/save">
        <select name="category" required><option value="">Category</option><option>Rent</option><option>Salaries</option><option>Utilities</option><option>Supplies</option><option>Marketing</option><option>Other</option></select>
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="description" placeholder="Description" required>
        <input name="expense_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <button class="btn btn-red">Record Expense</button>
      </form>
    </div>
    <div class="card"><h3>Recent Expenses</h3>
      <table><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr>
      ${expenses.map(e => `<tr><td>${new Date(e.expense_date).toLocaleDateString()}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>UGX ${parseInt(e.amount).toLocaleString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/business/expenses/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { category, amount, description, expense_date } = req.body;
  await pool.query('INSERT INTO expenses(tenant_id,category,amount,description,expense_date) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, category, amount, description, expense_date]);
  res.redirect('/business/expenses');
}));

// === BUSINESS: PROFIT/LOSS ===
app.get('/business/profit-loss', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, expenses] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t])
  ]);
  const revenue = parseInt(sales.rows[0].total);
  const cost = parseInt(expenses.rows[0].total);
  const profit = revenue - cost;
  res.send(renderPage('Profit & Loss', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>Profit & Loss - This Month</h1>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${revenue.toLocaleString()}</div><div>Revenue</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${cost.toLocaleString()}</div><div>Expenses</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit >= 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Net Profit</div></div>
    </div>
  `, req.session.user));
}));

// === ENTERTAINMENT ===
app.get('/entertainment', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [videos, music, games] = await Promise.all([
    pool.query('SELECT * FROM entertainment_videos WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_music WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_games WHERE tenant_id=$1 ORDER BY score DESC LIMIT 10', [t])
  ]);
  res.send(renderPage('Entertainment Hub', `
    <div class="hero" style="background:linear-gradient(135deg,#db2777,#ec4899)">
      <h1>Entertainment Hub</h1><p>Videos, Music, Games, Live TV</p>
    </div>
    <div class="grid">
      <div class="card"><h3>Videos</h3>${videos.rows.map(v => `<p><a href="${esc(v.url)}" target="_blank">${esc(v.title)}</a></p>`).join('') || '<p>No videos yet</p>'}</div>
      <div class="card"><h3>Music</h3>${music.rows.map(m => `<p>${esc(m.title)} - ${esc(m.artist)}</p>`).join('') || '<p>No music yet</p>'}</div>
      <div class="card"><h3>Top Scores</h3>${games.rows.map(g => `<p>${esc(g.player_name)}: ${g.score} - ${esc(g.name)}</p>`).join('') || '<p>No games yet</p>'}</div>
      <div class="card"><h3>Live TV</h3><p>Coming soon: Stream live channels</p></div>
    </div>
  `, req.session.user));
}));

// === DEV MASTER CONTROL ===
app.get('/dev/master', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const flash = req.session.flash; delete req.session.flash;
  const [tCount, uCount, rev, wal, tenants, users, logs, chartData] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenants'),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`),
    pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1'),
    pool.query('SELECT id,name,type,COALESCE(wallet_balance,0) as wallet_balance,verified,subdomain,approved,banned,ban_reason FROM tenants ORDER BY id DESC LIMIT 50'),
    pool.query('SELECT id,email,role,approved FROM users ORDER BY id DESC LIMIT 50'),
    pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 20'),
    pool.query(`SELECT DATE(created_at) as day, SUM(amount) as total FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day ASC`)
  ]);
  const flashHtml = flash ? `<div class="alert alert-${flash.type}">${esc(flash.msg)}</div>` : '';
  const chartLabels = chartData.rows.map(r => new Date(r.day).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })).join("','");
  const chartValues = chartData.rows.map(r => r.total).join(',');
  res.send(renderPage('Dev Master', `
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:20px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>DEVELOPER MASTER CONTROL</h1><p style="opacity:0.9">Full system control</p>
    </div>
    ${flashHtml}
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${tCount.rows[0].count}</div><div>Tenants</div></div>
      <div class="stat-card"><div class="stat-num">${uCount.rows[0].count}</div><div>Users</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(rev.rows[0].t).toLocaleString()}</div><div>30-Day Rev</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(wal.rows[0]?.b || 0).toLocaleString()}</div><div>Ready Withdraw</div></div>
    </div>
    <div class="card" style="margin-bottom:20px"><h3>30-Day Revenue</h3><canvas id="revChart"></canvas></div>
    <div class="grid">
      <div class="card"><h3>Revenue Controls</h3>
        <form method="POST" action="/dev/inject-revenue">
          <input name="amount" placeholder="Amount UGX" type="number" required>
          <input name="source" placeholder="Source: Grant, Ads, Sub" required>
          <button class="btn btn-gold">Inject Revenue</button>
        </form>
      </div>
      <div class="card"><h3>Tenant Controls</h3>
        <form method="POST" action="/dev/execute">
          <select name="action" required><option value="">Select Action</option>
            <option value="add_balance">Add Balance</option>
            <option value="verify_tenant">Verify Tenant</option>
            <option value="unverify_tenant">Unverify Tenant</option>
            <option value="approve_tenant">Approve Tenant</option>
            <option value="ban_tenant">Ban Tenant</option>
            <option value="unban_tenant">Unban Tenant</option>
            <option value="grant_free_access">Grant Free Access</option>
            <option value="enable_fundraising">Enable Fundraising</option>
            <option value="delete_tenant">DELETE Tenant</option>
          </select>
          <input name="target_id" placeholder="Tenant ID" type="number" required>
          <input name="amount" placeholder="Amount UGX (if needed)" type="number">
          <input name="reason" placeholder="Reason (for ban)" type="text">
          <button class="btn btn-red">Execute</button>
        </form>
      </div>
    </div>
    <div class="card"><h3>All Tenants</h3>
      <table><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Verified</th><th>Status</th></tr>
      ${tenants.rows.map(t => `<tr>
        <td>${t.id}</td>
        <td>${esc(t.name)}</td>
        <td>${esc(t.type)}</td>
        <td>UGX ${parseInt(t.wallet_balance).toLocaleString()}</td>
        <td>${t.verified ? 'Yes' : 'No'}</td>
        <td>${t.approved ? (t.banned ? '<span style="color:#dc2626">Banned</span>' : '<span style="color:#059669">Active</span>') : '<span style="color:#d97706">Pending</span>'}</td>
      </tr>`).join('')}
      </table>
    </div>
    <script>
      new Chart(document.getElementById('revChart'), {
        type: 'line',
        data: {
          labels: ['${chartLabels}'],
          datasets: [{ label: 'UGX Revenue', data: [${chartValues}], borderColor: '#dc2626', tension: 0.3 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    </script>
  `, req.session.user));
}));

// === DEV ACTIONS ===
app.post('/dev/execute', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { action, target_id, amount, reason } = req.body;
  if (action === 'add_balance') await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2', [amount, target_id]);
  if (action === 'verify_tenant') await pool.query('UPDATE tenants SET verified=true WHERE id=$1', [target_id]);
  // FIX #4: Added missing action handlers
  if (action === 'unverify_tenant') await pool.query('UPDATE tenants SET verified=false WHERE id=$1', [target_id]);
  if (action === 'approve_tenant') await pool.query('UPDATE tenants SET approved=true WHERE id=$1', [target_id]);
  if (action === 'ban_tenant') await pool.query('UPDATE tenants SET banned=true,ban_reason=$1 WHERE id=$2', [reason, target_id]);
  if (action === 'unban_tenant') await pool.query('UPDATE tenants SET banned=false,ban_reason=NULL WHERE id=$1', [target_id]);
  if (action === 'enable_fundraising') await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1', [target_id]);
  if (action === 'grant_free_access') await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [target_id]);
  if (action === 'delete_tenant') await pool.query('DELETE FROM tenants WHERE id=$1', [target_id]);
  req.session.flash = { type: 'success', msg: 'Action executed' };
  res.redirect('/dev/master');
}));

app.post('/dev/inject-revenue', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { amount, source } = req.body;
  await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [amount, source]);
  await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [amount]);
  res.redirect('/dev/master');
}));
// === FUNDRAISING UPGRADE ===
app.get('/upgrade/fundraising', requireAuth, (req, res) => {
  res.send(renderPage('Fundraising Module', `
    <div class="card" style="max-width:600px;margin:40px auto;text-align:center">
      <h1>Add Fundraising</h1>
      <p>Enable donations, campaigns, and donor management for your organization.</p>
      <p><b>Platform Fee: 5% per donation</b></p>
      <form method="POST" action="/upgrade/fundraising/activate">
        <button class="btn btn-gold" style="font-size:18px;padding:15px 30px">Activate Fundraising</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/upgrade/fundraising/activate', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1', [req.session.user.tenant_id]);
  res.redirect('/fundraising');
}));

// === TERMS ===
app.get('/terms', (req, res) => {
  res.send(renderPage('Terms of Service', `
    <div class="card" style="max-width:800px;margin:40px auto">
      <h1>Terms of Service</h1>
      <p><b>Last Updated:</b> ${new Date().toDateString()}</p>
      <h3>1. Data Ownership</h3>
      <p>You own all data entered into your account. We store it securely and never share it without consent.</p>
      <h3>2. Privacy</h3>
      <p>Each organization sees only their own data. Cross-tenant access is technically blocked and logged.</p>
      <h3>3. Fundraising</h3>
      <p>Fundraising module is optional. 5% platform fee applies to donations processed.</p>
      <h3>4. Termination</h3>
      <p>You may export all data and close account anytime. We delete data within 30 days.</p>
      <h3>5. Contact</h3>
      <p>waiswadaniel24@gmail.com | +256 789 736737</p>
    </div>
  `, null));
});

// === 404 ===
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card"><h2>404</h2><p>Page not found</p></div>', req.session.user)));

// === ERROR HANDLER ===
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  const msg = process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message;
  res.status(500).send(renderPage('Error', `<div class="card"><div class="alert alert-error"><h2>500 Error</h2><p>${esc(msg)}</p></div><a href="/" class="btn">Go Home</a></div>`, req.session.user));
});

// === START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SSEWASSWA Platform LIVE on ${PORT}`);
  console.log(`Dev Master: waiswadaniel24@gmail.com / Daniel@2025`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
