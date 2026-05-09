require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');

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
app.use(express.static('public'));
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
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));

// === UTILS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const requireAuth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const requireNotBanned = (req, res, next) => req.session.user?.banned ? res.status(403).send('Account banned') : next();
const requireTenantAccess = (req, res, next) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return next();
  const requestedTid = parseInt(req.params.tenant_id || req.body.tenant_id || req.query.tenant_id);
  if (!requestedTid || u.tenant_id === requestedTid) return next();
  if (req.path.includes('/portal/') && req.path.includes(u.role)) return next();
  return res.status(403).send('Access denied to this tenant');
};
const requireSuperAdmin = (req, res, next) => req.session.user?.role === 'super_admin' ? next() : res.status(403).send('Super admin only');
const audit = (email, action, details) => pool.query('INSERT INTO audit_logs(user_email,action,details) VALUES($1,$2,$3)', [email, action, details]).catch(() => {});

// === MIGRATIONS ===
const migrations = [
  `CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, email TEXT, phone TEXT, subdomain TEXT UNIQUE, verified BOOLEAN DEFAULT false, approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, has_fundraising BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, description TEXT, address TEXT, logo_url TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'user', approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, dark_mode BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, admission_no TEXT, name TEXT NOT NULL, class TEXT, stream TEXT, guardian_name TEXT, guardian_phone TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount INTEGER NOT NULL, paid INTEGER DEFAULT 0, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER, date DATE NOT NULL, status TEXT, UNIQUE(student_id, date))`,
  `CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS marks (id SERIAL PRIMARY KEY, exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score INTEGER, grade TEXT)`,
  `CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, budget INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, status TEXT DEFAULT 'active', description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, event_date DATE, budget INTEGER DEFAULT 0, description TEXT, venue TEXT, created_at TIMESTAMP DEFAULT NOW())`,
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
  `CREATE TABLE IF NOT EXISTS entertainment_games (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, player_name TEXT, score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  // NEW TABLES FOR ENHANCED FEATURES
  `CREATE TABLE IF NOT EXISTS meeting_minutes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, meeting_date DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS notice_board (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, priority TEXT DEFAULT 'normal', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sermons (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, preacher TEXT, sermon_date DATE, scripture TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS prayer_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT, request TEXT NOT NULL, is_private BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS service_schedule (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service_name TEXT NOT NULL, day_of_week TEXT, start_time TEXT, end_time TEXT)`,
  `CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS budget_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT NOT NULL, planned INTEGER DEFAULT 0, actual INTEGER DEFAULT 0, month TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS goals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, target INTEGER DEFAULT 0, current INTEGER DEFAULT 0, deadline DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS personal_notes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, created_at TIMESTAMP DEFAULT NOW())`,
   // === SAFE COLUMN MIGRATIONS (handles tables from older schema versions) ===
  // tenants: all columns except id, name, type
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_fundraising BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wallet_balance INTEGER DEFAULT 0`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`,
   // users: add ALL columns that might be missing from old schema
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  // students
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_no TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS class TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS stream TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`,
  // fees
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS paid INTEGER DEFAULT 0`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS term TEXT`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS year INTEGER`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  // projects & events
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT`,
  // Drop old partial indexes — ON CONFLICT cannot use partial (WHERE clause) indexes!
  `DROP INDEX IF EXISTS tenants_subdomain_key`,
  `DROP INDEX IF EXISTS users_email_key`,
  // Recreate as regular unique indexes (PostgreSQL allows multiple NULLs, so partial WHERE is not needed)
  `CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key ON tenants(subdomain)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email)`,
  // add foreign key for users.tenant_id if not exists
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_fkey`,
  `ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`,
  // v9.0 new tables
  `CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, key_hash TEXT UNIQUE, name TEXT, scopes TEXT[], last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS webhook_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event TEXT, payload JSONB, status INTEGER, response TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`
];
(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Run each migration individually so one failure doesn't stop the rest
      for (const q of migrations) {
        try { await pool.query(q); } catch (e) { if (!e.message.includes('already exists')) console.warn('Migration warning:', e.message); }
      }
      const devEmail = 'waiswadaniel24@gmail.com';
      const devPass = 'Daniel@2025';
      const devHash = await bcrypt.hash(devPass, 10);
      const devTenant = await pool.query(`INSERT INTO tenants(name,type,email,verified,approved,subdomain) VALUES('Dev Master','individual',$1,true,true,'dev-master') ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [devEmail]);
          await pool.query(`INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`, [devTenant.rows[0].id, devEmail, devHash]);
      // Verify dev user was created correctly
      const check = await pool.query('SELECT id,email,role,approved,tenant_id FROM users WHERE email=$1', [devEmail]);
      console.log('DB Ready. Dev user:', check.rows[0]?.email, 'role:', check.rows[0]?.role, 'approved:', check.rows[0]?.approved, 'tenant_id:', check.rows[0]?.tenant_id);
      break;
    } catch (e) {
      console.error(`DB Init Error (attempt ${attempt}/3):`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      else console.error('DB Init failed after 3 attempts.');
    }
  }
})();
// === RENDER PAGE (with dark mode support) ===
const renderPage = (title, content, user) => {
  const dark = user?.dark_mode;
  return `<!DOCTYPE html>
<html${dark ? ' class="dark"' : ''}><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${dark ? '#0f172a' : '#f8fafc'};color:${dark ? '#e2e8f0' : '#1e293b'};line-height:1.6;transition:background 0.3s,color 0.3s}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:0.2s;font-size:14px}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:1200px;margin:20px auto;padding:0 20px}
.card{background:${dark ? '#1e293b' : 'white'};border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'};transition:background 0.3s}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:0.3s;font-size:14px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,0.4)}
.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}
.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
.btn-green{background:linear-gradient(135deg,#059669,#10b981)}
.btn-sm{padding:8px 16px;font-size:12px;border-radius:8px}
input,select,textarea{width:100%;padding:12px;margin:8px 0;border:2px solid ${dark ? '#475569' : '#e2e8f0'};border-radius:10px;font-size:16px;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#e2e8f0' : '#1e293b'};transition:border-color 0.2s}
input:focus,select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
table{width:100%;border-collapse:collapse;margin-top:15px}
th,td{padding:12px;text-align:left;border-bottom:1px solid ${dark ? '#334155' : '#e2e8f0'}}
th{background:${dark ? '#334155' : '#f1f5f9'};font-weight:700;color:${dark ? '#e2e8f0' : '#1e293b'}}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px;border-radius:20px;text-align:center;margin-bottom:30px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:20px 0}
.stat-card{background:${dark ? '#1e293b' : 'white'};padding:20px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.stat-num{font-size:32px;font-weight:800;color:#4f46e5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.tag{display:inline-block;padding:4px 12px;background:#e0e7ff;color:#3730a3;border-radius:20px;font-size:12px;font-weight:600}
.alert{padding:15px;border-radius:10px;margin:15px 0}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}
.search-bar{display:flex;gap:10px;margin-bottom:20px}.search-bar input{flex:1;margin:0}
.progress-bar{background:${dark ? '#475569' : '#e5e7eb'};height:20px;border-radius:10px;overflow:hidden}
.progress-fill{height:20px;border-radius:10px;transition:width 0.5s}
.muted{color:${dark ? '#94a3b8' : '#64748b'};font-size:13px}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
.tab-bar{display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.tab-bar a{flex:1;padding:12px;text-align:center;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#94a3b8' : '#64748b'};font-weight:600;text-decoration:none;transition:0.2s}
.tab-bar a:hover{background:${dark ? '#334155' : '#f1f5f9'};text-decoration:none}
.tab-bar a.active{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
@media(max-width:768px){.nav{flex-direction:column;gap:10px}.stats,.grid{grid-template-columns:1fr}.tab-bar{flex-direction:column}}
</style></head><body>
<nav class="nav">
  <div><a href="/" style="font-size:20px;font-weight:800">SSEWASSWA</a></div>
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    ${user ? `
      <span style="font-size:13px">Hi, ${esc(user.email.split('@')[0])}</span>
      <a href="/search">Search</a>
      <a href="/settings/profile">Settings</a>
      <a href="/dashboard">Dashboard</a>
      <a href="/toggle-dark" style="font-size:18px" title="Toggle Dark Mode">${dark ? '☀️' : '🌙'}</a>
      <a href="/logout">Logout</a>
    ` : `<a href="/login">Login</a><a href="/register">Register</a>`}
  </div>
</nav>
<div class="container">${content}</div>
</body></html>`;
};

// === AUTH ===
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.send(renderPage('SSEWASSWA Platform', `
    <div class="hero">
      <h1 style="font-size:48px;margin-bottom:15px">All-in-One Management</h1>
      <p style="font-size:20px;opacity:0.9;margin-bottom:30px">School \u2022 Organization \u2022 Church \u2022 Business \u2022 Individual</p>
      <a href="/register" class="btn btn-gold" style="font-size:18px;padding:15px 30px">Start Free</a>
    </div>
    <div class="grid">
      <div class="card"><h3>Schools</h3><p>Students, Fees, Exams, Attendance, Report Cards</p></div>
      <div class="card"><h3>Organizations</h3><p>Members, Projects, Events, Meetings, Notices</p></div>
      <div class="card"><h3>Churches</h3><p>Congregation, Tithes, Sermons, Prayer Requests</p></div>
      <div class="card"><h3>Business</h3><p>POS, Inventory, Invoices, Customers, P&L</p></div>
      <div class="card"><h3>Individual</h3><p>Budgets, Goals, Notes, Personal Tracking</p></div>
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
   const u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
  if (!u || u.banned || !u.approved || !u.password) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials or account not approved</div>', null));
  if (!(await bcrypt.compare(password, u.password))) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials</div>', null));
  req.session.user = u;
  await audit(email, 'login', 'User logged in');
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
  await audit(email, 'register', `New ${type} account: ${org_name}`);
  res.send(renderPage('Success', '<div class="card"><div class="alert alert-success">Account created! You can now login.</div><a href="/login" class="btn">Login</a></div>', null));
}));

app.get('/logout', (req, res) => {
  if (req.session.user) audit(req.session.user.email, 'logout', 'User logged out').catch(() => {});
  req.session.destroy(() => res.redirect('/'));
});

// === DASHBOARD ROUTER ===
app.get('/dashboard', requireAuth, (req, res) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return res.redirect('/dev/master');
  res.redirect(`/portal/${u.tenant_type}`);
});

// === SCHOOL PORTAL ===
app.get('/portal/school', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, fees, exams, attendance] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount-paid),0) FROM fees WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM exams WHERE tenant_id=$1', [t]),
    pool.query("SELECT COUNT(DISTINCT student_id) FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status='present'", [t])
  ]);
  res.send(renderPage('School Dashboard', `
    <div class="hero"><h1>School Portal</h1><p>Manage students, fees, exams, attendance, reports</p></div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${students.rows[0].count}</div><div>Students</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(fees.rows[0].coalesce).toLocaleString()}</div><div>Fees Due</div></div>
      <div class="stat-card"><div class="stat-num">${exams.rows[0].count}</div><div>Exams</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">${attendance.rows[0].count}</div><div>Present Today</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Students</h3><a href="/school/students" class="btn">Manage Students</a><a href="/school/students/import" class="btn btn-green btn-sm" style="margin-top:8px">CSV Import</a></div>
      <div class="card"><h3>Fees</h3><a href="/school/fees" class="btn">Fee Management</a><a href="/school/fees/pay" class="btn btn-green btn-sm" style="margin-top:8px">Record Payment</a></div>
      <div class="card"><h3>Exams & Marks</h3><a href="/school/exams" class="btn">Exam Results</a><a href="/school/exams/new" class="btn btn-sm" style="margin-top:8px">New Exam</a></div>
      <div class="card"><h3>Attendance</h3><a href="/school/attendance" class="btn">Mark Attendance</a></div>
      <div class="card"><h3>Reports</h3><a href="/school/reports" class="btn">Generate Reports</a><a href="/school/report-cards" class="btn btn-gold btn-sm" style="margin-top:8px">Report Cards</a></div>
    </div>
  `, req.session.user));
}));

// === SCHOOL: STUDENTS CRUD ===
app.get('/school/students', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filter = req.query.class || '';
  const streamFilter = req.query.stream || '';
  let q = 'SELECT * FROM students WHERE tenant_id=$1';
  const params = [t];
  let pi = 2;
  if (filter) { q += ` AND class=$${pi++}`; params.push(filter); }
  if (streamFilter) { q += ` AND stream=$${pi++}`; params.push(streamFilter); }
  q += ' ORDER BY name';
  const students = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const streams = (await pool.query('SELECT DISTINCT stream FROM students WHERE tenant_id=$1 AND stream IS NOT NULL ORDER BY stream', [t])).rows;
  res.send(renderPage('Students', `
    <div class="card"><h3>Student Management</h3>
      <div style="display:flex;gap:10px;margin:15px 0;flex-wrap:wrap">
        <a href="/school/students/new" class="btn btn-sm">+ Add Student</a>
        <a href="/school/students/import" class="btn btn-green btn-sm">CSV Import</a>
      </div>
      <form method="GET" action="/school/students" style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <select name="class" style="width:auto;margin:0"><option value="">All Classes</option>
          ${classes.map(c => `<option ${filter === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('')}
        </select>
        <select name="stream" style="width:auto;margin:0"><option value="">All Streams</option>
          ${streams.map(s => `<option ${streamFilter === s.stream ? 'selected' : ''}>${esc(s.stream)}</option>`).join('')}
        </select>
        <button class="btn btn-sm">Filter</button>
      </form>
      <table><tr><th>Adm#</th><th>Name</th><th>Class</th><th>Stream</th><th>Guardian</th><th>Actions</th></tr>
      ${students.map(s => `<tr>
        <td>${esc(s.admission_no)}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.stream)}</td><td>${esc(s.guardian_name)}</td>
        <td><a href="/school/students/${s.id}/edit" class="btn btn-sm">Edit</a> <a href="/school/students/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete ${esc(s.name)}?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="6">No students yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/students/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Student', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add New Student</h3>
      <form method="POST" action="/school/students/save">
        <input name="admission_no" placeholder="Admission Number" required>
        <input name="name" placeholder="Full Name" required>
        <input name="class" placeholder="Class (e.g. S1, P7)">
        <input name="stream" placeholder="Stream (e.g. A, B)">
        <input name="guardian_name" placeholder="Guardian/Parent Name">
        <input name="guardian_phone" placeholder="Guardian Phone +256...">
        <button class="btn btn-green">Add Student</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/students/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { admission_no, name, class: cls, stream, guardian_name, guardian_phone } = req.body;
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, admission_no, name, cls, stream, guardian_name, guardian_phone]);
  await audit(req.session.user.email, 'add_student', `Added student: ${name}`);
  res.redirect('/school/students');
}));

app.get('/school/students/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit Student', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Student: ${esc(s.name)}</h3>
      <form method="POST" action="/school/students/${s.id}/update">
        <input name="admission_no" value="${esc(s.admission_no)}" required>
        <input name="name" value="${esc(s.name)}" required>
        <input name="class" value="${esc(s.class)}" placeholder="Class">
        <input name="stream" value="${esc(s.stream)}" placeholder="Stream">
        <input name="guardian_name" value="${esc(s.guardian_name)}" placeholder="Guardian Name">
        <input name="guardian_phone" value="${esc(s.guardian_phone)}" placeholder="Guardian Phone">
        <button class="btn">Update Student</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/students/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { admission_no, name, class: cls, stream, guardian_name, guardian_phone } = req.body;
  await pool.query('UPDATE students SET admission_no=$1,name=$2,class=$3,stream=$4,guardian_name=$5,guardian_phone=$6 WHERE id=$7 AND tenant_id=$8',
    [admission_no, name, cls, stream, guardian_name, guardian_phone, req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'edit_student', `Edited student: ${name}`);
  res.redirect('/school/students');
}));

app.get('/school/students/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'delete_student', `Deleted student ID: ${req.params.id}`);
  res.redirect('/school/students');
}));

// === SCHOOL: CSV IMPORT ===
app.get('/school/students/import', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Import Students CSV', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Bulk Import Students</h3>
      <p class="muted" style="margin-bottom:15px">CSV format: admission_no, name, class, stream, guardian_name, guardian_phone (first row = headers, skipped)</p>
      <form method="POST" action="/school/students/import/save">
        <textarea name="csv_data" rows="10" placeholder="admission_no,name,class,stream,guardian_name,guardian_phone&#10;S001,John Doe,S1,A,Jane Doe,+256700000001&#10;S002,Mary Smith,S1,B,Bob Smith,+256700000002" required></textarea>
        <button class="btn btn-green">Import Students</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/students/import/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const lines = req.body.csv_data.trim().split('\n');
  let imported = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length >= 2) {
      await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [t, cols[0], cols[1], cols[2] || '', cols[3] || '', cols[4] || '', cols[5] || '']);
      imported++;
    }
  }
  await audit(req.session.user.email, 'csv_import', `Imported ${imported} students`);
  res.send(renderPage('Import Complete', `<div class="card"><div class="alert alert-success">Successfully imported ${imported} students.</div><a href="/school/students" class="btn">View Students</a></div>`, req.session.user));
}));

// === SCHOOL: FEES ===
app.get('/school/fees', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC', [t])).rows;
  const totalDue = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
  const totalPaid = fees.reduce((a, f) => a + parseInt(f.paid), 0);
  res.send(renderPage('Fee Management', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalDue.toLocaleString()}</div><div>Total Due</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Total Paid</div></div>
    </div>
    <div class="card"><h3>Fee Records</h3>
      <div style="display:flex;gap:10px;margin:15px 0;flex-wrap:wrap">
        <a href="/school/fees/new" class="btn btn-sm">+ Add Fee</a>
        <a href="/school/fees/pay" class="btn btn-green btn-sm">Record Payment</a>
      </div>
      <table><tr><th>Adm#</th><th>Student</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Term</th><th>Year</th></tr>
      ${fees.map(f => `<tr>
        <td>${esc(f.admission_no)}</td><td>${esc(f.student_name)}</td>
        <td>UGX ${parseInt(f.amount).toLocaleString()}</td>
        <td style="color:#059669">UGX ${parseInt(f.paid).toLocaleString()}</td>
        <td style="color:${f.amount - f.paid > 0 ? '#dc2626' : '#059669'}">UGX ${(f.amount - f.paid).toLocaleString()}</td>
        <td>${esc(f.term)}</td><td>${f.year || ''}</td>
      </tr>`).join('') || '<tr><td colspan="7">No fees yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/fees/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Fee', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Assign Fee</h3>
      <form method="POST" action="/school/fees/save">
        <select name="student_id" required><option value="">Select Student</option>
          ${students.map(s => `<option value="${s.id}">${esc(s.admission_no)} - ${esc(s.name)}</option>`).join('')}
        </select>
        <input name="amount" type="number" placeholder="Total Fee Amount UGX" required>
        <input name="term" placeholder="Term (e.g. Term 1, Term 2)">
        <input name="year" type="number" placeholder="Year (e.g. 2025)">
        <button class="btn">Assign Fee</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/fees/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { student_id, amount, term, year } = req.body;
  await pool.query('INSERT INTO fees(tenant_id,student_id,amount,term,year) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, student_id, amount, term, year]);
  res.redirect('/school/fees');
}));

app.get('/school/fees/pay', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.id,f.amount,f.paid,f.term,f.year,s.name as student_name FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND f.amount>f.paid ORDER BY s.name', [t])).rows;
  res.send(renderPage('Record Payment', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Record Fee Payment</h3>
      <form method="POST" action="/school/fees/pay/save">
        <select name="fee_id" required><option value="">Select Student (with balance)</option>
          ${fees.map(f => `<option value="${f.id}">${esc(f.student_name)} - Balance UGX ${(f.amount - f.paid).toLocaleString()} (${f.term} ${f.year})</option>`).join('')}
        </select>
        <input name="amount" type="number" placeholder="Payment Amount UGX" required>
        <button class="btn btn-green">Record Payment</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/fees/pay/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  await pool.query('UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'fee_payment', `Payment UGX ${amount} on fee #${fee_id}`);
  res.redirect('/school/fees');
}));

// === SCHOOL: EXAMS & MARKS ===
app.get('/school/exams', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT * FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Exams', `
    <div class="card"><h3>Examinations</h3>
      <a href="/school/exams/new" class="btn btn-sm" style="margin-bottom:15px">+ New Exam</a>
      <div class="grid">
        ${exams.map(e => `
          <div class="card">
            <h3>${esc(e.name)}</h3>
            <p class="muted">${esc(e.term)} ${e.year || ''}</p>
            <a href="/school/exams/${e.id}/marks" class="btn btn-sm" style="margin-top:8px">Enter Marks</a>
            <a href="/school/exams/${e.id}/results" class="btn btn-green btn-sm" style="margin-top:8px">View Results</a>
          </div>
        `).join('') || '<p>No exams yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/school/exams/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Exam', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Examination</h3>
      <form method="POST" action="/school/exams/save">
        <input name="name" placeholder="Exam Name (e.g. Mid-Term)" required>
        <input name="term" placeholder="Term (e.g. Term 1)">
        <input name="year" type="number" placeholder="Year (e.g. 2025)">
        <button class="btn">Create Exam</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/exams/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, term, year } = req.body;
  await pool.query('INSERT INTO exams(tenant_id,name,term,year) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name, term, year]);
  res.redirect('/school/exams');
}));

app.get('/school/exams/:id/marks', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!exam) return res.status(404).send('Not found');
  const students = (await pool.query('SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage(`Enter Marks - ${exam.name}`, `
    <div class="card"><h3>Enter Marks: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})</h3>
      <form method="POST" action="/school/exams/${exam.id}/marks/save">
        <table><tr><th>Student</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
        ${students.map(s => `<tr>
          <td>${esc(s.name)} (${esc(s.admission_no)})</td>
          <td><input name="subject_${s.id}" placeholder="Subject" required></td>
          <td><input name="score_${s.id}" type="number" min="0" max="100" placeholder="0-100" required></td>
          <td><select name="grade_${s.id}"><option>D1</option><option>D2</option><option>C3</option><option>C4</option><option>C5</option><option>C6</option><option>P7</option><option>P8</option><option>F9</option></select></td>
        </tr>`).join('') || '<tr><td colspan="4">No students</td></tr>'}
        </table>
        <button class="btn btn-green" style="margin-top:15px">Save All Marks</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/exams/:id/marks/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id FROM students WHERE tenant_id=$1', [t])).rows;
  for (const s of students) {
    const subject = req.body[`subject_${s.id}`];
    const score = req.body[`score_${s.id}`];
    const grade = req.body[`grade_${s.id}`];
    if (subject && score !== undefined) {
      await pool.query('INSERT INTO marks(exam_id,student_id,subject,score,grade) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [req.params.id, s.id, subject, score, grade]);
    }
  }
  res.redirect(`/school/exams/${req.params.id}/results`);
}));

app.get('/school/exams/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!exam) return res.status(404).send('Not found');
  const marks = (await pool.query('SELECT m.*,s.name as student_name,s.admission_no FROM marks m JOIN students s ON m.student_id=s.id JOIN exams e ON m.exam_id=e.id WHERE e.tenant_id=$1 AND m.exam_id=$2 ORDER BY s.name,m.subject', [t, exam.id])).rows;
  res.send(renderPage(`Results - ${exam.name}`, `
    <div class="card"><h3>Results: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})</h3>
      <a href="/school/exams/${exam.id}/marks" class="btn btn-sm" style="margin:10px 0">Enter More Marks</a>
      <table><tr><th>Adm#</th><th>Student</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
      ${marks.map(m => `<tr><td>${esc(m.admission_no)}</td><td>${esc(m.student_name)}</td><td>${esc(m.subject)}</td><td>${m.score}</td><td><span class="tag">${esc(m.grade)}</span></td></tr>`).join('') || '<tr><td colspan="5">No marks yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === SCHOOL: ATTENDANCE ===
app.get('/school/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filterClass = req.query.class || '';
  let q = 'SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1';
  const params = [t];
  if (filterClass) { q += ' AND class=$2'; params.push(filterClass); }
  q += ' ORDER BY name';
  const students = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const today = new Date().toISOString().split('T')[0];
  res.send(renderPage('Student Attendance', `
    <div class="card"><h3>Mark Attendance - ${today}</h3>
      <form method="GET" action="/school/attendance" style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <select name="class" style="width:auto;margin:0"><option value="">All Classes</option>
          ${classes.map(c => `<option ${filterClass === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('')}
        </select>
        <button class="btn btn-sm">Filter</button>
      </form>
      <form method="POST" action="/school/attendance/save">
        <input type="hidden" name="date" value="${today}">
        <table><tr><th>Adm#</th><th>Name</th><th>Class</th><th>Present</th></tr>
        ${students.map(s => `<tr><td>${esc(s.admission_no)}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td><input type="checkbox" name="present_ids" value="${s.id}" checked></td></tr>`).join('')}
        </table>
        <button class="btn btn-green" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { date, present_ids } = req.body;
  const present = Array.isArray(present_ids) ? present_ids : [present_ids].filter(Boolean);
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id FROM students WHERE tenant_id=$1', [t])).rows;
  for (const s of students) {
    const status = present.includes(String(s.id)) ? 'present' : 'absent';
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4',
      [t, s.id, date, status]);
  }
  res.redirect('/school/attendance');
}));

// === SCHOOL: REPORT CARDS (.docx) ===
app.get('/school/report-cards', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const exams = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Generate Report Cards', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Generate Report Card</h3>
      <form method="POST" action="/school/report-cards/generate">
        <select name="student_id" required><option value="">Select Student</option>
          ${students.map(s => `<option value="${s.id}">${esc(s.admission_no)} - ${esc(s.name)} (${esc(s.class)})</option>`).join('')}
        </select>
        <select name="exam_id" required><option value="">Select Exam</option>
          ${exams.map(e => `<option value="${e.id}">${esc(e.name)} - ${esc(e.term)} ${e.year || ''}</option>`).join('')}
        </select>
        <button class="btn btn-gold">Download Report Card</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/report-cards/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, exam_id } = req.body;
  const student = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [student_id, t])).rows[0];
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [exam_id, t])).rows[0];
  const marks = (await pool.query('SELECT subject,score,grade FROM marks WHERE exam_id=$1 AND student_id=$2', [exam_id, student_id])).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const totalScore = marks.reduce((a, m) => a + (parseInt(m.score) || 0), 0);
  const avgScore = marks.length > 0 ? Math.round(totalScore / marks.length) : 0;
  const fee = (await pool.query('SELECT amount,paid FROM fees WHERE student_id=$1 AND tenant_id=$2 LIMIT 1', [student_id, t])).rows[0];

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: tenant.name, bold: true, size: 32 })], alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: 'STUDENT REPORT CARD', bold: true, size: 24 })], alignment: 'center' }),
        new Paragraph({ text: `${exam.name} - ${exam.term} ${exam.year || ''}`, alignment: 'center' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Student Name: ${student.name}` }),
        new Paragraph({ text: `Admission No: ${student.admission_no}` }),
        new Paragraph({ text: `Class: ${student.class} ${student.stream || ''}` }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: 'SUBJECT RESULTS', bold: true, size: 20 })] }),
        new Paragraph({ text: '' }),
        ...marks.map(m => new Paragraph({ text: `${m.subject}: ${m.score}/100  -  Grade: ${m.grade}` })),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Total Score: ${totalScore}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Average Score: ${avgScore}`, bold: true })] }),
        new Paragraph({ text: '' }),
        ...(fee ? [
          new Paragraph({ children: [new TextRun({ text: 'FEE STATUS', bold: true, size: 20 })] }),
          new Paragraph({ text: `Total Fees: UGX ${parseInt(fee.amount).toLocaleString()}` }),
          new Paragraph({ text: `Paid: UGX ${parseInt(fee.paid).toLocaleString()}` }),
          new Paragraph({ text: `Balance: UGX ${(fee.amount - fee.paid).toLocaleString()}` }),
          new Paragraph({ text: '' }),
        ] : []),
        new Paragraph({ text: `Class Teacher Comment: ________________________` }),
        new Paragraph({ text: `Head Teacher Comment: ________________________` }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Date: ${new Date().toLocaleDateString()}` }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=ReportCard-${student.admission_no}.docx`);
  res.send(buffer);
}));

// === SCHOOL: GENERAL REPORTS ===
app.get('/school/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('School Reports', `
    <div class="card"><h3>Export Data</h3>
      <div class="grid">
        <a href="/school/reports/export?type=students" class="btn btn-sm">Students CSV</a>
        <a href="/school/reports/export?type=fees" class="btn btn-sm">Fees CSV</a>
        <a href="/school/reports/export?type=attendance" class="btn btn-sm">Attendance CSV</a>
      </div>
    </div>
  `, req.session.user));
}));

app.get('/school/reports/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type } = req.query;
  const t = req.session.user.tenant_id;
  let data, filename;
  if (type === 'students') {
    data = (await pool.query('SELECT admission_no,name,class,stream,guardian_name,guardian_phone FROM students WHERE tenant_id=$1', [t])).rows;
    filename = 'students.csv';
  } else if (type === 'fees') {
    data = (await pool.query('SELECT f.amount,f.paid,f.term,f.year,s.name as student FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1', [t])).rows;
    filename = 'fees.csv';
  } else {
    data = (await pool.query('SELECT a.date,a.status,s.name as student FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1', [t])).rows;
    filename = 'attendance.csv';
  }
  const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));

// ============================================================
// ============================================================
// PHASE 2: ORGANIZATION / CHURCH / BUSINESS ROUTES
// ============================================================

// === ORGANIZATION PORTAL (enhanced) ===
app.get('/portal/organization', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, projects, events, budget, notices, meetings] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM projects WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM events WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM org_finance WHERE tenant_id=$1 AND type=\'income\'', [t]),
    pool.query('SELECT COUNT(*) FROM notice_board WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM meeting_minutes WHERE tenant_id=$1', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Organization Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#8b5cf6)">
      <h1>Organization Portal</h1><p>Manage members, projects, events, meetings, notices</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">${projects.rows[0].count}</div><div>Projects</div></div>
      <div class="stat-card"><div class="stat-num">${events.rows[0].count}</div><div>Events</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}</div><div>Income</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Members</h3>
        <a href="/org/members" class="btn btn-sm">Member Database</a>
        <a href="/org/register" class="btn btn-sm" style="margin-top:8px">Register Member</a>
        <a href="/org/attendance" class="btn btn-sm" style="margin-top:8px">Attendance</a>
      </div>
      <div class="card"><h3>Projects</h3>
        <a href="/org/projects" class="btn btn-sm">All Projects</a>
        <a href="/org/projects/new" class="btn btn-sm" style="margin-top:8px">New Project</a>
      </div>
      <div class="card"><h3>Events</h3>
        <a href="/org/events" class="btn btn-sm">Events</a>
        <a href="/org/events/new" class="btn btn-sm" style="margin-top:8px">New Event</a>
      </div>
      <div class="card"><h3>Finance</h3>
        <a href="/org/finance" class="btn btn-sm">Income/Expense</a>
        <a href="/org/reports" class="btn btn-sm" style="margin-top:8px">Reports</a>
      </div>
      <div class="card"><h3>Meetings</h3>
        <a href="/org/meetings" class="btn btn-sm">Meeting Minutes</a>
        <span class="muted">${meetings.rows[0].count} recorded</span>
      </div>
      <div class="card"><h3>Notices</h3>
        <a href="/org/notices" class="btn btn-sm">Notice Board</a>
        <span class="muted">${notices.rows[0].count} posted</span>
      </div>
      <div class="card"><h3>Public</h3>
        <a href="/settings/profile" class="btn btn-sm">Edit Public Profile</a>
        ${tenant.has_fundraising ? '<a href="/fundraising" class="btn btn-gold btn-sm" style="margin-top:8px">Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn btn-sm" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
    </div>
  `, req.session.user));
}));

// === ORG: MEMBERS (with edit/delete) ===
app.get('/org/members', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Members', `
    <div class="card"><h3>Member Database</h3>
      <a href="/org/register" class="btn btn-sm" style="margin-bottom:15px">+ Register New Member</a>
      <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
      ${members.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.role)}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td>
        <td><a href="/org/members/${m.id}/edit" class="btn btn-sm">Edit</a> <a href="/org/members/${m.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete ${esc(m.name)}?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="6">No members yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/org/register', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Register Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Register New Member</h3>
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
  await audit(req.session.user.email, 'add_member', `Added member: ${name}`);
  res.redirect('/org/members');
}));

app.get('/org/members/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT * FROM members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!m) return res.status(404).send('Not found');
  res.send(renderPage('Edit Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Member: ${esc(m.name)}</h3>
      <form method="POST" action="/org/members/${m.id}/update">
        <input name="name" value="${esc(m.name)}" required>
        <input name="email" type="email" value="${esc(m.email)}">
        <input name="phone" value="${esc(m.phone)}">
        <select name="role"><option ${m.role==='Member'?'selected':''}>Member</option><option ${m.role==='Volunteer'?'selected':''}>Volunteer</option><option ${m.role==='Staff'?'selected':''}>Staff</option><option ${m.role==='Board'?'selected':''}>Board</option></select>
        <button class="btn">Update Member</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/org/members/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, role } = req.body;
  await pool.query('UPDATE members SET name=$1,email=$2,phone=$3,role=$4 WHERE id=$5 AND tenant_id=$6', [name, email, phone, role, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/members');
}));

app.get('/org/members/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'delete_member', `Deleted member ID: ${req.params.id}`);
  res.redirect('/org/members');
}));

// === ORG: PROJECTS (with progress update) ===
app.get('/org/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Projects', `
    <div class="card"><h3>All Projects</h3>
      <a href="/org/projects/new" class="btn btn-sm">+ New Project</a>
      <div class="grid" style="margin-top:15px">
        ${projects.map(p => {
          const pct = p.budget > 0 ? Math.min(100, (p.spent / p.budget) * 100) : 0;
          return `
          <div class="card">
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
            <p>Budget: UGX ${parseInt(p.budget).toLocaleString()}</p>
            <p>Spent: UGX ${parseInt(p.spent).toLocaleString()}</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct > 90 ? '#dc2626' : pct > 60 ? '#f59e0b' : '#059669'}"></div></div>
            <p class="muted">${Math.round(pct)}% spent</p>
            <p>Status: <span class="tag">${esc(p.status)}</span></p>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <form method="POST" action="/org/projects/${p.id}/spend" style="display:inline"><input name="amount" type="number" placeholder="Add spent" style="width:120px;display:inline-block;padding:8px"><button class="btn btn-sm btn-green">Update</button></form>
              <form method="POST" action="/org/projects/${p.id}/status" style="display:inline"><select name="status" style="width:auto;display:inline-block;padding:8px"><option>active</option><option>planning</option><option>completed</option><option>on-hold</option></select><button class="btn btn-sm">Set</button></form>
            </div>
          </div>`;
        }).join('') || '<p>No projects yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/projects/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Project', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Project</h3>
      <form method="POST" action="/org/projects/save">
        <input name="name" placeholder="Project Name" required>
        <textarea name="description" placeholder="Project Description" rows="3"></textarea>
        <input name="budget" type="number" placeholder="Budget UGX" required>
        <select name="status" required><option>active</option><option>planning</option><option>completed</option></select>
        <button class="btn">Create Project</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/projects/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, description, budget, status } = req.body;
  await pool.query('INSERT INTO projects(tenant_id,name,description,budget,status) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, description, budget, status]);
  res.redirect('/org/projects');
}));

app.post('/org/projects/:id/spend', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { amount } = req.body;
  await pool.query('UPDATE projects SET spent=spent+$1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/projects');
}));

app.post('/org/projects/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE projects SET status=$1 WHERE id=$2 AND tenant_id=$3', [status, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/projects');
}));

// === ORG: EVENTS ===
app.get('/org/events', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const events = (await pool.query('SELECT * FROM events WHERE tenant_id=$1 ORDER BY event_date DESC', [t])).rows;
  res.send(renderPage('Events', `
    <div class="card"><h3>Events</h3>
      <a href="/org/events/new" class="btn btn-sm" style="margin-bottom:15px">+ New Event</a>
      <div class="grid">
        ${events.map(e => `
          <div class="card">
            <h3>${esc(e.name)}</h3>
            <p class="muted">${e.event_date ? new Date(e.event_date).toLocaleDateString() : 'TBD'} ${e.venue ? '@ ' + esc(e.venue) : ''}</p>
            ${e.description ? `<p>${esc(e.description)}</p>` : ''}
            <p>Budget: UGX ${parseInt(e.budget).toLocaleString()}</p>
          </div>
        `).join('') || '<p>No events yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/events/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Event', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Event</h3>
      <form method="POST" action="/org/events/save">
        <input name="name" placeholder="Event Name" required>
        <input name="event_date" type="date" required>
        <input name="venue" placeholder="Venue">
        <textarea name="description" placeholder="Event Description" rows="3"></textarea>
        <input name="budget" type="number" placeholder="Budget UGX">
        <button class="btn">Create Event</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/events/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, event_date, venue, description, budget } = req.body;
  await pool.query('INSERT INTO events(tenant_id,name,event_date,venue,description,budget) VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, name, event_date, venue, description, budget || 0]);
  res.redirect('/org/events');
}));

// === ORG: MEETING MINUTES ===
app.get('/org/meetings', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const meetings = (await pool.query('SELECT * FROM meeting_minutes WHERE tenant_id=$1 ORDER BY meeting_date DESC', [t])).rows;
  res.send(renderPage('Meeting Minutes', `
    <div class="card"><h3>Meeting Minutes</h3>
      <a href="/org/meetings/new" class="btn btn-sm" style="margin-bottom:15px">+ New Minutes</a>
      <table><tr><th>Title</th><th>Date</th><th>Actions</th></tr>
      ${meetings.map(m => `<tr><td>${esc(m.title)}</td><td>${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}</td>
        <td><a href="/org/meetings/${m.id}" class="btn btn-sm">View</a> <a href="/org/meetings/${m.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="3">No meetings yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/org/meetings/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Meeting Minutes', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Record Meeting Minutes</h3>
      <form method="POST" action="/org/meetings/save">
        <input name="title" placeholder="Meeting Title" required>
        <input name="meeting_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <textarea name="content" rows="12" placeholder="Meeting notes, decisions, action items..." required></textarea>
        <button class="btn">Save Minutes</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/meetings/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, meeting_date, content } = req.body;
  await pool.query('INSERT INTO meeting_minutes(tenant_id,title,meeting_date,content) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, title, meeting_date, content]);
  res.redirect('/org/meetings');
}));

app.get('/org/meetings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT * FROM meeting_minutes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!m) return res.status(404).send('Not found');
  res.send(renderPage(m.title, `
    <div class="card"><h3>${esc(m.title)}</h3>
      <p class="muted">${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}</p>
      <div style="margin-top:20px;white-space:pre-wrap">${esc(m.content)}</div>
      <a href="/org/meetings" class="btn btn-sm" style="margin-top:15px">Back to Minutes</a>
    </div>
  `, req.session.user));
}));

app.get('/org/meetings/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM meeting_minutes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/meetings');
}));

// === ORG: NOTICE BOARD ===
app.get('/org/notices', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const notices = (await pool.query('SELECT * FROM notice_board WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Notice Board', `
    <div class="card"><h3>Notice Board</h3>
      <a href="/org/notices/new" class="btn btn-sm" style="margin-bottom:15px">+ Post Notice</a>
      ${notices.map(n => `
        <div class="card" style="border-left:4px solid ${n.priority === 'urgent' ? '#dc2626' : n.priority === 'important' ? '#f59e0b' : '#4f46e5'}">
          <h3>${esc(n.title)} <span class="tag">${esc(n.priority)}</span></h3>
          <p style="margin-top:8px;white-space:pre-wrap">${esc(n.content)}</p>
          <p class="muted" style="margin-top:8px">${new Date(n.created_at).toLocaleString()}</p>
          <a href="/org/notices/${n.id}/delete" class="btn btn-red btn-sm" style="margin-top:8px" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No notices yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/org/notices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Post Notice', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Post New Notice</h3>
      <form method="POST" action="/org/notices/save">
        <input name="title" placeholder="Notice Title" required>
        <select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select>
        <textarea name="content" rows="8" placeholder="Notice content..." required></textarea>
        <button class="btn">Post Notice</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/notices/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, content, priority } = req.body;
  await pool.query('INSERT INTO notice_board(tenant_id,title,content,priority) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, title, content, priority]);
  res.redirect('/org/notices');
}));

app.get('/org/notices/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM notice_board WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/notices');
}));

// === ORG: FINANCE ===
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
          <input name="description" placeholder="Description" required>
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
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4', [t, m.id, date, status]);
  }
  res.redirect('/org/attendance');
}));

// === ORG: REPORTS ===
app.get('/org/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Reports', `
    <div class="card"><h3>Export Data</h3>
      <div class="grid">
        <a href="/org/reports/export?type=finance" class="btn btn-sm">Finance CSV</a>
        <a href="/org/reports/export?type=members" class="btn btn-sm">Members CSV</a>
        <a href="/org/reports/export?type=attendance" class="btn btn-sm">Attendance CSV</a>
      </div>
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
  } else if (type === 'attendance') {
    data = (await pool.query('SELECT a.date,a.status,m.name as member FROM attendance a JOIN members m ON a.student_id=m.id WHERE a.tenant_id=$1', [t])).rows;
    filename = 'attendance.csv';
  } else {
    data = (await pool.query('SELECT name,email,phone,role,joined_at FROM members WHERE tenant_id=$1', [t])).rows;
    filename = 'members.csv';
  }
  const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));

// ============================================================
// CHURCH PORTAL (enhanced)
// ============================================================
app.get('/portal/church', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, tithes, sermons, prayers, schedules] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) FROM org_finance WHERE tenant_id=$1 AND type='income' AND description ILIKE '%tithe%'", [t]),
    pool.query('SELECT COUNT(*) FROM sermons WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM prayer_requests WHERE tenant_id=$1 AND is_private=false', [t]),
    pool.query('SELECT COUNT(*) FROM service_schedule WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('Church Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c2d12,#ea580c)">
      <h1>Church Portal</h1><p>Congregation, Tithes, Sermons, Prayer Requests</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(tithes.rows[0].coalesce).toLocaleString()}</div><div>Total Tithes</div></div>
      <div class="stat-card"><div class="stat-num">${sermons.rows[0].count}</div><div>Sermons</div></div>
      <div class="stat-card"><div class="stat-num">${prayers.rows[0].count}</div><div>Prayer Requests</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Congregation</h3>
        <a href="/org/members" class="btn btn-sm">Members</a>
        <a href="/org/register" class="btn btn-sm" style="margin-top:8px">Add Member</a>
      </div>
      <div class="card"><h3>Tithes & Offerings</h3>
        <a href="/church/tithes" class="btn btn-sm">Record Tithe/Offering</a>
        <a href="/org/finance" class="btn btn-sm" style="margin-top:8px">All Finance</a>
      </div>
      <div class="card"><h3>Sermons</h3>
        <a href="/church/sermons" class="btn btn-sm">Sermon Archive</a>
        <a href="/church/sermons/new" class="btn btn-sm" style="margin-top:8px">New Sermon</a>
      </div>
      <div class="card"><h3>Prayer Requests</h3>
        <a href="/church/prayers" class="btn btn-sm">View Requests</a>
        <a href="/church/prayers/new" class="btn btn-sm" style="margin-top:8px">New Request</a>
      </div>
      <div class="card"><h3>Services</h3>
        <a href="/church/schedule" class="btn btn-sm">Service Schedule</a>
      </div>
      <div class="card"><h3>Events</h3>
        <a href="/org/events" class="btn btn-sm">Events</a>
        <a href="/org/notices" class="btn btn-sm" style="margin-top:8px">Notices</a>
      </div>
    </div>
  `, req.session.user));
}));

// === CHURCH: TITHE/OFFERING TRACKER ===
app.get('/church/tithes', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tithes = (await pool.query("SELECT * FROM org_finance WHERE tenant_id=$1 AND (description ILIKE '%tithe%' OR description ILIKE '%offering%') ORDER BY created_at DESC", [t])).rows;
  const total = tithes.filter(r => r.type === 'income').reduce((a, b) => a + parseInt(b.amount), 0);
  res.send(renderPage('Tithes & Offerings', `
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${total.toLocaleString()}</div><div>Total Tithes & Offerings</div></div></div>
    <div class="card"><h3>Record Tithe/Offering</h3>
      <form method="POST" action="/church/tithes/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 2fr">
          <select name="type" required><option value="income">Income</option><option value="expense">Expense</option></select>
          <input name="amount" type="number" placeholder="Amount UGX" required>
          <input name="description" placeholder="Tithe/Offering - Member Name" required>
        </div>
        <button class="btn btn-gold">Save Record</button>
      </form>
    </div>
    <div class="card"><h3>Recent Tithes & Offerings</h3>
      <table><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
      ${tithes.map(r => `<tr><td style="color:${r.type === 'income' ? '#059669' : '#dc2626'}">${r.type}</td><td>UGX ${parseInt(r.amount).toLocaleString()}</td><td>${esc(r.description)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/church/tithes/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, type, description]);
  res.redirect('/church/tithes');
}));

// === CHURCH: SERMONS ===
app.get('/church/sermons', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sermons = (await pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY sermon_date DESC', [t])).rows;
  res.send(renderPage('Sermon Archive', `
    <div class="card"><h3>Sermon Archive</h3>
      <a href="/church/sermons/new" class="btn btn-sm" style="margin-bottom:15px">+ New Sermon</a>
      <table><tr><th>Title</th><th>Preacher</th><th>Date</th><th>Scripture</th><th>Actions</th></tr>
      ${sermons.map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.preacher)}</td><td>${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''}</td><td>${esc(s.scripture)}</td>
        <td><a href="/church/sermons/${s.id}" class="btn btn-sm">View</a> <a href="/church/sermons/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No sermons yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/church/sermons/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Sermon', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Record Sermon</h3>
      <form method="POST" action="/church/sermons/save">
        <input name="title" placeholder="Sermon Title" required>
        <input name="preacher" placeholder="Preacher Name" required>
        <input name="sermon_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <input name="scripture" placeholder="Scripture Reference (e.g. John 3:16)">
        <textarea name="notes" rows="8" placeholder="Sermon notes, key points..."></textarea>
        <button class="btn btn-gold">Save Sermon</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/sermons/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, preacher, sermon_date, scripture, notes } = req.body;
  await pool.query('INSERT INTO sermons(tenant_id,title,preacher,sermon_date,scripture,notes) VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, title, preacher, sermon_date, scripture, notes]);
  res.redirect('/church/sermons');
}));

app.get('/church/sermons/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM sermons WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage(s.title, `
    <div class="card"><h3>${esc(s.title)}</h3>
      <p class="muted">${esc(s.preacher)} | ${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''} | ${esc(s.scripture)}</p>
      <div style="margin-top:20px;white-space:pre-wrap">${esc(s.notes)}</div>
      <a href="/church/sermons" class="btn btn-sm" style="margin-top:15px">Back to Archive</a>
    </div>
  `, req.session.user));
}));

app.get('/church/sermons/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM sermons WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/sermons');
}));

// === CHURCH: PRAYER REQUESTS ===
app.get('/church/prayers', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const prayers = (await pool.query('SELECT * FROM prayer_requests WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Prayer Requests', `
    <div class="card"><h3>Prayer Requests</h3>
      <a href="/church/prayers/new" class="btn btn-sm" style="margin-bottom:15px">+ New Request</a>
      ${prayers.map(p => `
        <div class="card">
          <h4>${esc(p.name || 'Anonymous')} ${p.is_private ? '<span class="tag" style="background:#fee2e2;color:#991b1b">Private</span>' : ''}</h4>
          <p style="white-space:pre-wrap">${esc(p.request)}</p>
          <p class="muted">${new Date(p.created_at).toLocaleString()}</p>
          <a href="/church/prayers/${p.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No prayer requests yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/church/prayers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Prayer Request', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Submit Prayer Request</h3>
      <form method="POST" action="/church/prayers/save">
        <input name="name" placeholder="Your Name (or leave blank for anonymous)">
        <textarea name="request" rows="5" placeholder="Prayer request..." required></textarea>
        <label style="display:flex;align-items:center;gap:8px;margin:10px 0"><input type="checkbox" name="is_private" value="true" style="width:auto"> Keep this private (only admins see it)</label>
        <button class="btn">Submit Request</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/prayers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, request, is_private } = req.body;
  await pool.query('INSERT INTO prayer_requests(tenant_id,name,request,is_private) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name || 'Anonymous', request, is_private === 'true']);
  res.redirect('/church/prayers');
}));

app.get('/church/prayers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM prayer_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/prayers');
}));

// === CHURCH: SERVICE SCHEDULE ===
app.get('/church/schedule', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const schedules = (await pool.query('SELECT * FROM service_schedule WHERE tenant_id=$1 ORDER BY id', [t])).rows;
  res.send(renderPage('Service Schedule', `
    <div class="card"><h3>Service Schedule</h3>
      <a href="/church/schedule/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Service</a>
      <table><tr><th>Service</th><th>Day</th><th>Start</th><th>End</th><th>Action</th></tr>
      ${schedules.map(s => `<tr><td>${esc(s.service_name)}</td><td>${esc(s.day_of_week)}</td><td>${esc(s.start_time)}</td><td>${esc(s.end_time)}</td>
        <td><a href="/church/schedule/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No services scheduled</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/church/schedule/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Service', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Service to Schedule</h3>
      <form method="POST" action="/church/schedule/save">
        <input name="service_name" placeholder="Service Name (e.g. Sunday Worship)" required>
        <select name="day_of_week" required><option>Sunday</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
        <input name="start_time" type="time" required>
        <input name="end_time" type="time" required>
        <button class="btn">Add Service</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/schedule/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { service_name, day_of_week, start_time, end_time } = req.body;
  await pool.query('INSERT INTO service_schedule(tenant_id,service_name,day_of_week,start_time,end_time) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, service_name, day_of_week, start_time, end_time]);
  res.redirect('/church/schedule');
}));

app.get('/church/schedule/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM service_schedule WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/schedule');
}));

// ============================================================
// BUSINESS PORTAL (enhanced)
// ============================================================
app.get('/portal/business', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, inventory, invoices, expenses, customers] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM inventory WHERE tenant_id=$1 AND quantity<5', [t]),
    pool.query("SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM customers WHERE tenant_id=$1', [t])
  ]);
  const profit = parseInt(sales.rows[0].coalesce) - parseInt(expenses.rows[0].coalesce);
  res.send(renderPage('Business Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>Business Portal</h1><p>POS, Inventory, Invoices, Customers, Profit/Loss</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(sales.rows[0].coalesce).toLocaleString()}</div><div>Month Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit >= 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Net Profit</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${inventory.rows[0].count}</div><div>Low Stock</div></div>
      <div class="stat-card"><div class="stat-num">${invoices.rows[0].count}</div><div>Unpaid Invoices</div></div>
      <div class="stat-card"><div class="stat-num">${customers.rows[0].count}</div><div>Customers</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Point of Sale</h3><a href="/business/pos" class="btn btn-sm">New Sale</a><a href="/business/sales" class="btn btn-sm" style="margin-top:8px">Sales History</a></div>
      <div class="card"><h3>Inventory</h3><a href="/business/inventory" class="btn btn-sm">Stock Management</a><a href="/business/inventory/add" class="btn btn-sm" style="margin-top:8px">Add Product</a></div>
      <div class="card"><h3>Invoices</h3><a href="/business/invoices" class="btn btn-sm">Manage Invoices</a></div>
      <div class="card"><h3>Expenses</h3><a href="/business/expenses" class="btn btn-sm">Record Expense</a><a href="/business/profit-loss" class="btn btn-sm" style="margin-top:8px">Profit/Loss</a></div>
      <div class="card"><h3>Customers</h3><a href="/business/customers" class="btn btn-sm">Customer Directory</a></div>
      <div class="card"><h3>Reports</h3><a href="/business/monthly-report" class="btn btn-gold btn-sm">Monthly Report</a></div>
    </div>
  `, req.session.user));
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
        <button type="button" onclick="addRow()" class="btn btn-sm">+ Add Item</button>
        <h3 style="margin-top:20px">Grand Total: UGX <span id="grandTotal">0</span></h3>
        <input type="hidden" name="row_count" id="rowCount" value="1">
        <select name="payment_status" required><option value="paid">Paid</option><option value="credit">Credit</option></select>
        <button class="btn btn-gold" style="padding:15px;font-size:16px">Checkout & Print Receipt</button>
      </form>
    </div>
    <script>
      let rows = 1;
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
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: `${req.session.user.tenant_name} - Receipt`, bold: true, size: 24 })] }),
      new Paragraph({ text: `Customer: ${customer_name}` }),
      new Paragraph({ text: `Date: ${new Date().toLocaleString()}` }),
      new Paragraph({ text: "" }),
      ...items.map(i => new Paragraph({ text: `${i.name} x${i.qty} - UGX ${(i.price * i.qty).toLocaleString()}` })),
      new Paragraph({ text: "" }),
      new Paragraph({ children: [new TextRun({ text: `TOTAL: UGX ${total.toLocaleString()}`, bold: true })] }),
      new Paragraph({ text: `Status: ${payment_status.toUpperCase()}` }),
    ]}]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Receipt-${sale.id}.docx`);
  res.send(buffer);
}));

// === BUSINESS: SALES HISTORY ===
app.get('/business/sales', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sales = (await pool.query('SELECT * FROM sales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const totalSales = sales.reduce((a, s) => a + parseInt(s.total), 0);
  const totalPaid = sales.reduce((a, s) => a + parseInt(s.paid), 0);
  res.send(renderPage('Sales History', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalSales.toLocaleString()}</div><div>Total Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Total Collected</div></div>
    </div>
    <div class="card"><h3>Recent Sales</h3>
      <table><tr><th>ID</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th><th>Date</th></tr>
      ${sales.map(s => `<tr><td>#${s.id}</td><td>${esc(s.customer_name)}</td><td>UGX ${parseInt(s.total).toLocaleString()}</td><td>UGX ${parseInt(s.paid).toLocaleString()}</td><td><span class="tag">${esc(s.status)}</span></td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="6">No sales yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === BUSINESS: CUSTOMERS ===
app.get('/business/customers', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const customers = (await pool.query('SELECT * FROM customers WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Customer Directory', `
    <div class="card"><h3>Customer Directory</h3>
      <a href="/business/customers/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Customer</a>
      <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Actions</th></tr>
      ${customers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td>
        <td><a href="/business/customers/${c.id}/edit" class="btn btn-sm">Edit</a> <a href="/business/customers/${c.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No customers yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/customers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Customer', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Customer</h3>
      <form method="POST" action="/business/customers/save">
        <input name="name" placeholder="Customer Name" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone +256...">
        <input name="address" placeholder="Address">
        <button class="btn btn-green">Add Customer</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/customers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address } = req.body;
  await pool.query('INSERT INTO customers(tenant_id,name,email,phone,address) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, email, phone, address]);
  res.redirect('/business/customers');
}));

app.get('/business/customers/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const c = (await pool.query('SELECT * FROM customers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!c) return res.status(404).send('Not found');
  res.send(renderPage('Edit Customer', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Customer: ${esc(c.name)}</h3>
      <form method="POST" action="/business/customers/${c.id}/update">
        <input name="name" value="${esc(c.name)}" required>
        <input name="email" type="email" value="${esc(c.email)}">
        <input name="phone" value="${esc(c.phone)}">
        <input name="address" value="${esc(c.address)}">
        <button class="btn">Update Customer</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/business/customers/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address } = req.body;
  await pool.query('UPDATE customers SET name=$1,email=$2,phone=$3,address=$4 WHERE id=$5 AND tenant_id=$6', [name, email, phone, address, req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/customers');
}));

app.get('/business/customers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM customers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/customers');
}));

// === BUSINESS: INVENTORY ===
app.get('/business/inventory', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Inventory', `
    <div class="card"><h3>Stock Management</h3>
      <a href="/business/inventory/add" class="btn btn-sm">+ Add Product</a>
      <table style="margin-top:15px"><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Value</th></tr>
      ${items.map(i => `
        <tr ${i.quantity < 5 ? 'style="background:#fee2e2"' : ''}>
          <td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td>${i.quantity}</td>
          <td>${parseInt(i.cost_price).toLocaleString()}</td><td>${parseInt(i.selling_price).toLocaleString()}</td>
          <td>${(i.quantity * i.selling_price).toLocaleString()}</td>
        </tr>
      `).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/inventory/add', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Product', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Product to Inventory</h3>
      <form method="POST" action="/business/inventory/save">
        <input name="name" placeholder="Product Name" required>
        <input name="sku" placeholder="SKU/Code" required>
        <input name="quantity" type="number" placeholder="Quantity" required>
        <input name="cost_price" type="number" placeholder="Cost Price UGX" required>
        <input name="selling_price" type="number" placeholder="Selling Price UGX" required>
        <button class="btn btn-green">Add Product</button>
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

// === BUSINESS: INVOICES (with mark as paid) ===
app.get('/business/invoices', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Invoices', `
    <div class="card"><h3>Invoices</h3>
      <a href="/business/invoices/new" class="btn btn-sm">+ New Invoice</a>
      <table style="margin-top:15px"><tr><th>No.</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th></tr>
      ${invoices.map(i => `<tr>
        <td>${esc(i.invoice_no)}</td><td>${esc(i.customer_name)}</td><td>UGX ${parseInt(i.amount).toLocaleString()}</td>
        <td>${i.due_date ? new Date(i.due_date).toLocaleDateString() : 'N/A'}</td>
        <td>${i.status === 'paid' ? '<span style="color:#059669;font-weight:600">Paid</span>' : '<span style="color:#dc2626;font-weight:600">Unpaid</span>'}</td>
        <td>
          ${i.status === 'unpaid' ? `<a href="/business/invoices/${i.id}/mark-paid" class="btn btn-green btn-sm" onclick="return confirm('Mark as paid?')">Pay</a>` : ''}
          <a href="/business/invoices/${i.id}/print" target="_blank" class="btn btn-sm">Print</a>
        </td>
      </tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/invoices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Invoice', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Invoice</h3>
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
  const { customer_name, customer_contact, amount, due_date } = req.body;
  const invoice_no = 'INV' + Date.now();
  await pool.query('INSERT INTO invoices(tenant_id,invoice_no,customer_name,customer_contact,amount,due_date,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [t, invoice_no, customer_name, customer_contact, amount, due_date, 'unpaid']);
  res.redirect('/business/invoices');
}));

app.get('/business/invoices/:id/mark-paid', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  await pool.query('UPDATE invoices SET status=\'paid\' WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'invoice_paid', `Invoice #${req.params.id} marked as paid`);
  res.redirect('/business/invoices');
}));

app.get('/business/invoices/:id/print', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const i = (await pool.query('SELECT i.*,t.name as company_name FROM invoices i JOIN tenants t ON i.tenant_id=t.id WHERE i.id=$1 AND i.tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!i) return res.status(404).send('Not found');
  const doc = new Document({
    sections: [{ children: [
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
    ]}]
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

// === BUSINESS: MONTHLY REPORT (.docx) ===
app.get('/business/monthly-report', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const [sales, expenses, invCount] = await Promise.all([
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(quantity * selling_price),0) as value FROM inventory WHERE tenant_id=$1', [t])
  ]);
  const s = sales.rows[0];
  const e = expenses.rows[0];
  const inv = invCount.rows[0];
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: tenant.name, bold: true, size: 32 })] }),
      new Paragraph({ children: [new TextRun({ text: `Monthly Business Report - ${monthName}`, bold: true, size: 24 })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'SALES SUMMARY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Total Sales: ${s.cnt}` }),
      new Paragraph({ text: `Revenue: UGX ${parseInt(s.total).toLocaleString()}` }),
      new Paragraph({ text: `Collected: UGX ${parseInt(s.paid).toLocaleString()}` }),
      new Paragraph({ text: `Outstanding: UGX ${(parseInt(s.total) - parseInt(s.paid)).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'EXPENSES SUMMARY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Total Expenses: ${e.cnt}` }),
      new Paragraph({ text: `Amount: UGX ${parseInt(e.total).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'PROFIT', bold: true, size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: `Net Profit: UGX ${(parseInt(s.total) - parseInt(e.total)).toLocaleString()}`, bold: true })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'INVENTORY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Products in Stock: ${inv.cnt}` }),
      new Paragraph({ text: `Stock Value: UGX ${parseInt(inv.value).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: `Generated: ${now.toLocaleString()}` }),
    ]}]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=MonthlyReport-${monthName.replace(/\s/g, '-')}.docx`);
  res.send(buffer);
}));

// ============================================================
// ============================================================
// PHASE 3: INDIVIDUAL / PLATFORM-WIDE / DEV / ETC
// ============================================================

// === INDIVIDUAL PORTAL (enhanced) ===
app.get('/portal/individual', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [goals, notes, budgetItems] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM goals WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM personal_notes WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(planned),0) as planned, COALESCE(SUM(actual),0) as actual FROM budget_items WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('Personal Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
      <h1>Personal Portal</h1><p>Your budgets, goals, notes, personal tracking</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${goals.rows[0].count}</div><div>Goals</div></div>
      <div class="stat-card"><div class="stat-num">${notes.rows[0].count}</div><div>Notes</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budgetItems.rows[0].planned).toLocaleString()}</div><div>Budget Planned</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budgetItems.rows[0].actual).toLocaleString()}</div><div>Budget Spent</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Budget Tracker</h3><a href="/individual/budget" class="btn btn-sm">Manage Budget</a></div>
      <div class="card"><h3>Goals</h3><a href="/individual/goals" class="btn btn-sm">Set Goals</a></div>
      <div class="card"><h3>Notes</h3><a href="/individual/notes" class="btn btn-sm">My Notes</a></div>
      <div class="card"><h3>Documents</h3><a href="/individual/docs" class="btn btn-sm">My Documents</a></div>
    </div>
  `, req.session.user));
}));

// === INDIVIDUAL: BUDGET TRACKER ===
app.get('/individual/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM budget_items WHERE tenant_id=$1 ORDER BY category', [t])).rows;
  const totalPlanned = items.reduce((a, b) => a + parseInt(b.planned), 0);
  const totalActual = items.reduce((a, b) => a + parseInt(b.actual), 0);
  res.send(renderPage('Budget Tracker', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalPlanned.toLocaleString()}</div><div>Total Planned</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalActual.toLocaleString()}</div><div>Total Spent</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalPlanned - totalActual >= 0 ? '#059669' : '#dc2626'}">UGX ${(totalPlanned - totalActual).toLocaleString()}</div><div>Remaining</div></div>
    </div>
    <div class="card"><h3>Add Budget Item</h3>
      <form method="POST" action="/individual/budget/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
          <input name="category" placeholder="Category (e.g. Food)" required>
          <input name="planned" type="number" placeholder="Planned UGX" required>
          <input name="actual" type="number" placeholder="Actual UGX" value="0">
          <input name="month" placeholder="Month (e.g. Jan 2025)">
        </div>
        <button class="btn btn-green">Add Item</button>
      </form>
    </div>
    <div class="card"><h3>Budget Items</h3>
      <table><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Difference</th><th>Month</th><th>Action</th></tr>
      ${items.map(i => {
        const diff = parseInt(i.planned) - parseInt(i.actual);
        return `<tr><td>${esc(i.category)}</td><td>UGX ${parseInt(i.planned).toLocaleString()}</td><td>UGX ${parseInt(i.actual).toLocaleString()}</td>
          <td style="color:${diff >= 0 ? '#059669' : '#dc2626'}">UGX ${diff.toLocaleString()}</td><td>${esc(i.month)}</td>
          <td><a href="/individual/budget/${i.id}/update" class="btn btn-sm">Update</a> <a href="/individual/budget/${i.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6">No budget items yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/individual/budget/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { category, planned, actual, month } = req.body;
  await pool.query('INSERT INTO budget_items(tenant_id,category,planned,actual,month) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, category, planned, actual || 0, month]);
  res.redirect('/individual/budget');
}));

app.get('/individual/budget/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const item = (await pool.query('SELECT * FROM budget_items WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!item) return res.status(404).send('Not found');
  res.send(renderPage('Update Budget', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Update: ${esc(item.category)}</h3>
      <form method="POST" action="/individual/budget/${item.id}/update-save">
        <input name="actual" type="number" value="${item.actual}" placeholder="Actual Spent UGX" required>
        <button class="btn btn-green">Update Actual</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/individual/budget/:id/update-save', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE budget_items SET actual=$1 WHERE id=$2 AND tenant_id=$3', [req.body.actual, req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/budget');
}));

app.get('/individual/budget/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM budget_items WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/budget');
}));

// === INDIVIDUAL: GOALS ===
app.get('/individual/goals', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const goals = (await pool.query('SELECT * FROM goals WHERE tenant_id=$1 ORDER BY deadline NULLS LAST', [t])).rows;
  res.send(renderPage('Goals', `
    <div class="card"><h3>My Goals</h3>
      <a href="/individual/goals/new" class="btn btn-sm" style="margin-bottom:15px">+ New Goal</a>
      <div class="grid">
        ${goals.map(g => {
          const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
          return `
          <div class="card">
            <h3>${esc(g.title)}</h3>
            <p>Target: UGX ${parseInt(g.target).toLocaleString()}</p>
            <p>Current: UGX ${parseInt(g.current).toLocaleString()}</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct >= 100 ? '#059669' : '#4f46e5'}"></div></div>
            <p class="muted">${Math.round(pct)}% complete</p>
            ${g.deadline ? `<p class="muted">Deadline: ${new Date(g.deadline).toLocaleDateString()}</p>` : ''}
            <form method="POST" action="/individual/goals/${g.id}/progress" style="margin-top:8px">
              <input name="amount" type="number" placeholder="Add progress UGX" style="display:inline-block;width:160px;padding:8px">
              <button class="btn btn-sm btn-green">Update</button>
            </form>
            <a href="/individual/goals/${g.id}/delete" class="btn btn-red btn-sm" style="margin-top:6px" onclick="return confirm('Delete?')">Delete</a>
          </div>`;
        }).join('') || '<p>No goals yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/individual/goals/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Goal', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Set a New Goal</h3>
      <form method="POST" action="/individual/goals/save">
        <input name="title" placeholder="Goal Title (e.g. Save for Car)" required>
        <input name="target" type="number" placeholder="Target Amount UGX" required>
        <input name="current" type="number" placeholder="Current Progress UGX" value="0">
        <input name="deadline" type="date" placeholder="Target Date">
        <button class="btn btn-green">Create Goal</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/individual/goals/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, target, current, deadline } = req.body;
  await pool.query('INSERT INTO goals(tenant_id,title,target,current,deadline) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, title, target, current || 0, deadline || null]);
  res.redirect('/individual/goals');
}));

app.post('/individual/goals/:id/progress', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE goals SET current=current+$1 WHERE id=$2 AND tenant_id=$3', [req.body.amount, req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/goals');
}));

app.get('/individual/goals/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM goals WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/goals');
}));

// === INDIVIDUAL: PERSONAL NOTES ===
app.get('/individual/notes', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const notes = (await pool.query('SELECT * FROM personal_notes WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('My Notes', `
    <div class="card"><h3>Personal Notes</h3>
      <a href="/individual/notes/new" class="btn btn-sm" style="margin-bottom:15px">+ New Note</a>
      ${notes.map(n => `
        <div class="card">
          <h3>${esc(n.title)}</h3>
          <p style="white-space:pre-wrap">${esc(n.content)}</p>
          <p class="muted" style="margin-top:8px">${new Date(n.created_at).toLocaleString()}</p>
          <a href="/individual/notes/${n.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No notes yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/individual/notes/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Note', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>New Note</h3>
      <form method="POST" action="/individual/notes/save">
        <input name="title" placeholder="Note Title" required>
        <textarea name="content" rows="10" placeholder="Write your note..." required></textarea>
        <button class="btn">Save Note</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/individual/notes/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO personal_notes(tenant_id,title,content) VALUES($1,$2,$3)', [req.session.user.tenant_id, title, content]);
  res.redirect('/individual/notes');
}));

app.get('/individual/notes/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM personal_notes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/notes');
}));

// === INDIVIDUAL: DOCS (placeholder) ===
app.get('/individual/docs', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('My Documents', `
    <div class="card"><h3>My Documents</h3>
      <p class="muted">Document storage coming soon. Use Notes for now to store text-based documents.</p>
      <a href="/individual/notes" class="btn btn-sm">Go to Notes</a>
    </div>
  `, req.session.user));
});

// ============================================================
// PLATFORM-WIDE FEATURES
// ============================================================

// === DARK MODE TOGGLE ===
app.get('/toggle-dark', requireAuth, ah(async (req, res) => {
  const current = req.session.user.dark_mode || false;
  await pool.query('UPDATE users SET dark_mode=$1 WHERE id=$2', [!current, req.session.user.id]);
  req.session.user.dark_mode = !current;
  res.redirect('back');
}));

// === CHANGE PASSWORD ===
app.get('/settings/password', requireAuth, (req, res) => {
  res.send(renderPage('Change Password', `
    <div class="card" style="max-width:500px;margin:40px auto"><h3>Change Password</h3>
      <form method="POST" action="/settings/password/save">
        <input name="current_password" type="password" placeholder="Current Password" required>
        <input name="new_password" type="password" placeholder="New Password (min 6)" minlength="6" required>
        <input name="confirm_password" type="password" placeholder="Confirm New Password" required>
        <button class="btn btn-red">Change Password</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/settings/password/save', requireAuth, ah(async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) return res.send(renderPage('Change Password', '<div class="card"><div class="alert alert-error">Passwords do not match</div><a href="/settings/password" class="btn btn-sm">Try Again</a></div>', req.session.user));
  const u = (await pool.query('SELECT password FROM users WHERE id=$1', [req.session.user.id])).rows[0];
  if (!(await bcrypt.compare(current_password, u.password))) return res.send(renderPage('Change Password', '<div class="card"><div class="alert alert-error">Current password is incorrect</div><a href="/settings/password" class="btn btn-sm">Try Again</a></div>', req.session.user));
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.session.user.id]);
  await audit(req.session.user.email, 'password_change', 'Password changed');
  res.send(renderPage('Success', '<div class="card"><div class="alert alert-success">Password changed successfully!</div><a href="/dashboard" class="btn">Back to Dashboard</a></div>', req.session.user));
}));

// === PROFILE SETTINGS ===
app.get('/settings/profile', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Profile Settings', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Organization Profile</h3>
      <form method="POST" action="/settings/profile/save">
        <input name="name" value="${esc(tenant.name)}" required>
        <input name="email" type="email" value="${esc(tenant.email)}">
        <input name="phone" value="${esc(tenant.phone)}">
        <input name="address" value="${esc(tenant.address || '')}" placeholder="Address">
        <textarea name="description" rows="4" placeholder="About your organization">${esc(tenant.description || '')}</textarea>
        <button class="btn">Save Profile</button>
      </form>
    </div>
    <div class="card" style="max-width:600px;margin:20px auto">
      <h3>Account Settings</h3>
      <a href="/settings/password" class="btn btn-red btn-sm">Change Password</a>
      <a href="/settings/backup" class="btn btn-sm" style="margin-top:8px">Export All Data</a>
    </div>
  `, req.session.user));
}));

app.post('/settings/profile/save', requireAuth, ah(async (req, res) => {
  const { name, email, phone, address, description } = req.body;
  await pool.query('UPDATE tenants SET name=$1,email=$2,phone=$3,address=$4,description=$5 WHERE id=$6',
    [name, email, phone, address, description, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'profile_update', 'Updated organization profile');
  res.redirect('/settings/profile');
}));

// === DATA BACKUP/EXPORT ===
app.get('/settings/backup', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const tables = ['students', 'fees', 'exams', 'marks', 'members', 'projects', 'events', 'org_finance', 'inventory', 'sales', 'invoices', 'expenses', 'attendance', 'meeting_minutes', 'notice_board', 'sermons', 'prayer_requests', 'customers', 'budget_items', 'goals', 'personal_notes'];
  let backup = `SSEWASSWA DATA BACKUP\nOrganization: ${tenant.name}\nDate: ${new Date().toISOString()}\n\n`;
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [t])).rows;
      if (data.length > 0) {
        backup += `=== ${table.toUpperCase()} (${data.length} records) ===\n`;
        backup += Object.keys(data[0]).join(',') + '\n';
        for (const row of data) {
          backup += Object.values(row).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',') + '\n';
        }
        backup += '\n';
      }
    } catch (e) { /* table might not exist for this tenant type */ }
  }
  res.header('Content-Type', 'text/csv');
  res.attachment(`backup-${tenant.name.replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`);
  res.send(backup);
}));

// === SEARCH ===
app.get('/search', requireAuth, (req, res) => {
  res.send(renderPage('Search', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Search Your Data</h3>
      <form method="GET" action="/search/results">
        <input name="q" placeholder="Search anything..." value="${esc(req.query.q || '')}" required autofocus>
        <button class="btn">Search</button>
      </form>
    </div>
  `, req.session.user));
});

app.get('/search/results', requireAuth, ah(async (req, res) => {
  const q = req.query.q || '';
  const t = req.session.user.tenant_id;
  const like = `%${q}%`;
  const results = [];
  try { const r = (await pool.query('SELECT id,name,admission_no FROM students WHERE tenant_id=$1 AND (name ILIKE $2 OR admission_no ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Student', name: x.name, detail: x.admission_no, link: '/school/students' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name,email FROM members WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Member', name: x.name, detail: x.email, link: '/org/members' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM projects WHERE tenant_id=$1 AND name ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Project', name: x.name, detail: '', link: '/org/projects' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM inventory WHERE tenant_id=$1 AND (name ILIKE $2 OR sku ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Product', name: x.name, detail: x.sku, link: '/business/inventory' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM events WHERE tenant_id=$1 AND name ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Event', name: x.name, detail: '', link: '/org/events' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM sermons WHERE tenant_id=$1 AND (title ILIKE $2 OR preacher ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Sermon', name: x.title, detail: '', link: '/church/sermons' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM customers WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Customer', name: x.name, detail: x.email, link: '/business/customers' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM goals WHERE tenant_id=$1 AND title ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Goal', name: x.title, detail: '', link: '/individual/goals' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM personal_notes WHERE tenant_id=$1 AND (title ILIKE $2 OR content ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Note', name: x.title, detail: '', link: '/individual/notes' })); } catch(e){}
  res.send(renderPage(`Search: ${q}`, `
    <div class="card"><h3>Search Results for "${esc(q)}"</h3>
      <p class="muted">${results.length} results found</p>
      <table style="margin-top:15px"><tr><th>Type</th><th>Name</th><th>Detail</th><th>Go</th></tr>
      ${results.map(r => `<tr><td><span class="tag">${esc(r.type)}</span></td><td>${esc(r.name)}</td><td>${esc(r.detail)}</td><td><a href="${r.link}" class="btn btn-sm">View</a></td></tr>`).join('') || '<tr><td colspan="4">No results found</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === PUBLIC PROFILE PAGE ===
app.get('/p/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1 AND verified=true', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send(renderPage('Not Found', '<div class="card"><h2>Organization not found</h2></div>', null));
  const events = (await pool.query('SELECT * FROM events WHERE tenant_id=$1 AND event_date>=CURRENT_DATE ORDER BY event_date LIMIT 5', [tenant.id])).rows;
  res.send(renderPage(tenant.name, `
    <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)">
      <h1>${esc(tenant.name)}</h1>
      <p>${esc(tenant.type)} ${tenant.address ? '| ' + esc(tenant.address) : ''}</p>
    </div>
    ${tenant.description ? `<div class="card"><h3>About</h3><p>${esc(tenant.description)}</p></div>` : ''}
    ${events.length > 0 ? `
      <div class="card"><h3>Upcoming Events</h3>
        ${events.map(e => `<div style="margin-bottom:10px"><strong>${esc(e.name)}</strong> - ${new Date(e.event_date).toLocaleDateString()} ${e.venue ? '@ ' + esc(e.venue) : ''}</div>`).join('')}
      </div>
    ` : ''}
    <div class="card">
      <p>Contact: ${esc(tenant.email)} ${tenant.phone ? '| ' + esc(tenant.phone) : ''}</p>
    </div>
  `, null));
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
      <h1>Entertainment Hub</h1><p>Videos, Music, Games</p>
    </div>
    <div class="grid">
      <div class="card"><h3>Videos</h3>${videos.rows.map(v => `<p><a href="${esc(v.url)}" target="_blank">${esc(v.title)}</a></p>`).join('') || '<p>No videos yet</p>'}</div>
      <div class="card"><h3>Music</h3>${music.rows.map(m => `<p>${esc(m.title)} - ${esc(m.artist)}</p>`).join('') || '<p>No music yet</p>'}</div>
      <div class="card"><h3>Top Scores</h3>${games.rows.map(g => `<p>${esc(g.player_name)}: ${g.score} - ${esc(g.name)}</p>`).join('') || '<p>No games yet</p>'}</div>
    </div>
  `, req.session.user));
}));

// === DEV MASTER CONTROL ===
app.get('/dev/master', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const flash = req.session.flash; delete req.session.flash;
  const [tCount, uCount, rev, wal, tenants, logs, chartData] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenants'),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`),
    pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1'),
    pool.query('SELECT id,name,type,COALESCE(wallet_balance,0) as wallet_balance,verified,subdomain,approved,banned,ban_reason FROM tenants ORDER BY id DESC LIMIT 50'),
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
        <td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.type)}</td>
        <td>UGX ${parseInt(t.wallet_balance).toLocaleString()}</td>
        <td>${t.verified ? 'Yes' : 'No'}</td>
        <td>${t.approved ? (t.banned ? '<span style="color:#dc2626">Banned</span>' : '<span style="color:#059669">Active</span>') : '<span style="color:#d97706">Pending</span>'}</td>
      </tr>`).join('')}
      </table>
    </div>
    <div class="card"><h3>Recent Audit Logs</h3>
      <table><tr><th>User</th><th>Action</th><th>Details</th><th>Time</th></tr>
      ${logs.rows.map(l => `<tr><td>${esc(l.user_email)}</td><td>${esc(l.action)}</td><td>${esc(l.details)}</td><td>${new Date(l.created_at).toLocaleString()}</td></tr>`).join('')}
      </table>
    </div>
    <script>
      new Chart(document.getElementById('revChart'), {
        type: 'line',
        data: {
          labels: ['${chartLabels}'],
          datasets: [{ label: 'UGX Revenue', data: [${chartValues}], borderColor: '#dc2626', tension: 0.3, fill: true, backgroundColor: 'rgba(220,38,38,0.1)' }]
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
  if (action === 'unverify_tenant') await pool.query('UPDATE tenants SET verified=false WHERE id=$1', [target_id]);
  if (action === 'approve_tenant') await pool.query('UPDATE tenants SET approved=true WHERE id=$1', [target_id]);
  if (action === 'ban_tenant') await pool.query('UPDATE tenants SET banned=true,ban_reason=$1 WHERE id=$2', [reason, target_id]);
  if (action === 'unban_tenant') await pool.query('UPDATE tenants SET banned=false,ban_reason=NULL WHERE id=$1', [target_id]);
  if (action === 'enable_fundraising') await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1', [target_id]);
  if (action === 'grant_free_access') await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [target_id]);
  if (action === 'delete_tenant') await pool.query('DELETE FROM tenants WHERE id=$1', [target_id]);
  await audit(req.session.user.email, 'dev_action', `${action} on tenant #${target_id}`);
  req.session.flash = { type: 'success', msg: 'Action executed' };
  res.redirect('/dev/master');
}));

app.post('/dev/inject-revenue', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { amount, source } = req.body;
  await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [amount, source]);
  await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [amount]);
  await audit(req.session.user.email, 'inject_revenue', `UGX ${amount} from ${source}`);
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
  res.redirect('/portal/organization');
}));

// === FUNDRAISING PAGE ===
app.get('/fundraising', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  if (!tenant.has_fundraising) return res.redirect('/upgrade/fundraising');
  const donations = (await pool.query("SELECT * FROM org_finance WHERE tenant_id=$1 AND type='income' AND description ILIKE '%donation%' ORDER BY created_at DESC", [t])).rows;
  const total = donations.reduce((a, d) => a + parseInt(d.amount), 0);
  res.send(renderPage('Fundraising', `
    <div class="hero" style="background:linear-gradient(135deg,#d97706,#f59e0b)">
      <h1>Fundraising</h1><p>Donations and campaigns</p>
    </div>
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${total.toLocaleString()}</div><div>Total Donations</div></div></div>
    <div class="card"><h3>Record Donation</h3>
      <form method="POST" action="/fundraising/save">
        <input name="amount" type="number" placeholder="Donation Amount UGX" required>
        <input name="description" placeholder="Donation - Donor Name" required>
        <button class="btn btn-gold">Record Donation</button>
      </form>
    </div>
    <div class="card"><h3>Recent Donations</h3>
      <table><tr><th>Amount</th><th>Donor</th><th>Date</th></tr>
      ${donations.map(d => `<tr><td>UGX ${parseInt(d.amount).toLocaleString()}</td><td>${esc(d.description)}</td><td>${new Date(d.created_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="3">No donations yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/fundraising/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, 'income', `Donation - ${description}`]);
  // 5% platform fee
  const fee = Math.round(parseInt(amount) * 0.05);
  await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [fee]);
  await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [fee, `Fundraising fee - ${req.session.user.tenant_name}`]);
  res.redirect('/fundraising');
}));
app.get('/api/stats', ah(async (req, res) => {
  const [schools, students, donations] = await Promise.all([
    pool.query("SELECT COUNT(*) FROM tenants WHERE type='school'"),
    pool.query('SELECT COUNT(*) FROM students'),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM developer_revenue')
  ]);
  res.json({
    schools: parseInt(schools.rows[0].count),
    students: parseInt(students.rows[0].count),
    donations: parseInt(donations.rows[0].coalesce)
  });
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
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card"><h2>404</h2><p>Page not found</p><a href="/" class="btn">Go Home</a></div>', req.session.user)));

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
