const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')? false : { rejectUnauthorized: false }
});

// === MIDDLEWARE ===
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-now',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// === HELPERS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const requireAuth = (req, res, next) => req.session.user? next() : res.redirect('/login');
const requireSuperAdmin = (req, res, next) => req.session.user?.email === 'waiswadaniel24@gmail.com'? next() : res.status(403).send('Access Denied');

// CRITICAL: Blocks cross-tenant data access
const requireTenantAccess = (req, res, next) => {
  const userTenant = req.session.user.tenant_id;
  const requestedTenant = req.params.tenant_id || req.body.tenant_id || req.query.tenant_id;
  if (requestedTenant && parseInt(requestedTenant)!== userTenant) {
    return res.status(403).send(renderPage('Access Denied', `
      <div class="alert alert-error"><b>Privacy Violation Blocked</b><br>You cannot access another organization's data.</div>
    `, req.session.user));
  }
  next();
};

const requireNotBanned = async (req, res, next) => {
  if (req.session.user?.banned) return res.status(403).send(renderPage('Banned', `<div class="alert alert-error"><b>Account Suspended</b><br>Reason: ${esc(req.session.user.ban_reason || 'Terms violation')}</div>`, null));
  const tenant = (await pool.query('SELECT banned,approved FROM tenants WHERE id=$1', [req.session.user?.tenant_id])).rows[0];
  if (tenant?.banned) return res.status(403).send(renderPage('Banned', `<div class="alert alert-error"><b>Organization Suspended</b></div>`, null));
  if (tenant &&!tenant.approved) return res.status(403).send(renderPage('Pending', `<div class="alert alert-info"><b>Account Pending Approval</b><br>Waiting for activation.</div>`, null));
  next();
};

const renderPage = (title, body, user) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
.container{max-width:1200px;margin:0 auto;padding:20px}.nav{background:#1e40af;color:white;padding:15px 20px;margin:-20px -20px 20px;display:flex;justify-content:space-between;align-items:center}
.nav a{color:white;text-decoration:none;margin-left:15px}.card{background:white;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.hero{padding:20px;border-radius:16px;margin-bottom:20px;color:white}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin-bottom:20px}
.stat-card{background:white;padding:20px;border-radius:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.stat-num{font-size:28px;font-weight:bold;color:#3b82f6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.btn{display:inline-block;background:#3b82f6;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;border:none;cursor:pointer;font-size:14px}
.btn-red{background:#dc2626}.btn-gold{background:#f59e0b}.btn:hover{opacity:0.9}input,select,textarea{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin:5px 0}
table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9}
.alert{padding:15px;border-radius:8px;margin-bottom:15px}.alert-error{background:#fee2e2;color:#991b1b}.alert-success{background:#d1fae5;color:#065f46}.alert-info{background:#dbeafe;color:#1e40af}
@media(max-width:768px){.grid{grid-template-columns:1fr}.nav{flex-direction:column;gap:10px}}
</style></head><body>
<div class="container">
${user? `<div class="nav"><div><b>${esc(user.tenant_name || 'Platform')}</b></div><div>
<a href="/dashboard">Dashboard</a>
${user.email === 'waiswadaniel24@gmail.com'? '<a href="/dev/master">Dev Control</a>' : ''}
<a href="/entertainment">Entertainment</a>
<a href="/directory">Directory</a>
<a href="/logout">Logout</a></div>` : ''}
${body}</div></body></html>`;

// === INIT DB WITH ALL TABLES ===
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT, subdomain TEXT UNIQUE,
      type TEXT DEFAULT 'school', portal_type TEXT DEFAULT 'school', approved BOOLEAN DEFAULT false,
      banned BOOLEAN DEFAULT false, free_access BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false,
      has_fundraising BOOLEAN DEFAULT false, has_entertainment BOOLEAN DEFAULT true, ban_reason TEXT,
      is_public BOOLEAN DEFAULT false, slug TEXT UNIQUE, public_description TEXT, public_phone TEXT,
      public_email TEXT, public_location TEXT, badge_url TEXT, cover_image_url TEXT,
      services JSONB DEFAULT '[]', gallery JSONB DEFAULT '[]', social_facebook TEXT, social_twitter TEXT,
      social_whatsapp TEXT, opening_hours TEXT, established_year INT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, tenant_id INT, email TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'student',
      banned BOOLEAN DEFAULT false, ban_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, class_name TEXT, admission_no TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, teacher_id INT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, code TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS marks (
      id SERIAL PRIMARY KEY, student_id INT, subject_id INT, score INT, term TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, student_name TEXT, amount INT, type TEXT, date_paid TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, role TEXT, email TEXT, phone TEXT, salary INT DEFAULT 0, nin TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payroll (
      id SERIAL PRIMARY KEY, tenant_id INT, staff_id INT, amount INT, month TEXT, status TEXT DEFAULT 'pending', paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, email TEXT, phone TEXT, role TEXT, joined_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, budget INT, spent INT DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, event_date TIMESTAMPTZ, location TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS org_finance (
      id SERIAL PRIMARY KEY, tenant_id INT, amount INT, type TEXT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, sku TEXT, quantity INT DEFAULT 0, cost_price INT, selling_price INT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY, tenant_id INT, customer_name TEXT, total INT, paid INT DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY, sale_id INT, inventory_id INT, quantity INT, price INT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY, tenant_id INT, invoice_no TEXT, customer_name TEXT, customer_contact TEXT, amount INT, status TEXT DEFAULT 'unpaid', due_date DATE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY, tenant_id INT, category TEXT, amount INT, description TEXT, expense_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, completed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS personal_budget (
      id SERIAL PRIMARY KEY, tenant_id INT, amount INT, category TEXT, type TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS social_posts (
      id SERIAL PRIMARY KEY, tenant_id INT, author_name TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
   `CREATE TABLE IF NOT EXISTS entertainment_videos (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS entertainment_music (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)`,
`CREATE TABLE IF NOT EXISTS entertainment_games (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  player_name TEXT,
  score INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)`,
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, target INT, raised INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS donations (
      id SERIAL PRIMARY KEY, tenant_id INT, amount INT, donor_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS developer_revenue (
      id SERIAL PRIMARY KEY, amount INT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS platform_wallet (
      id INT PRIMARY KEY DEFAULT 1, balance INT DEFAULT 0
    );
    INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default", sess JSON NOT NULL, expire TIMESTAMP(6) NOT NULL
    ) WITH (OIDS=FALSE);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
        ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid);
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);
  `);
})();

// === AUTH ROUTES ===
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => {
  res.send(renderPage('Login', `
    <div class="card" style="max-width:400px;margin:40px auto">
      <h2>Login</h2>
      <form method="POST" action="/login">
        <input name="email" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn" style="width:100%">Login</button>
      </form>
      <p style="margin-top:15px;text-align:center"><a href="/register">Create Account</a> | <a href="/directory">Public Directory</a></p>
    </div>
  `, null));
});

app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const user = (await pool.query('SELECT u.*,t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
  if (!user ||!await bcrypt.compare(password, user.password_hash)) {
    return res.send(renderPage('Login', `<div class="alert alert-error">Invalid credentials</div>`, null));
  }
  req.session.user = { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, tenant_name: user.tenant_name, banned: user.banned, ban_reason: user.ban_reason };
  res.redirect('/dashboard');
}));

app.get('/register', (req, res) => {
  res.send(renderPage('Register', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Create Account</h2>
      <form method="POST" action="/register">
        <input name="org_name" placeholder="Organization/School/Business Name" required>
        <select name="portal_type" required>
          <option value="">Select Account Type</option>
          <option value="school">School - Students, Exams, Fees</option>
          <option value="organization">NGO/Organization - Members, Projects</option>
          <option value="church">Church - Congregation, Tithes</option>
          <option value="business">Business - POS, Inventory, Invoices</option>
          <option value="individual">Individual - Personal Workspace</option>
        </select>
        <input name="email" type="email" placeholder="Admin Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn" style="width:100%">Register</button>
      </form>
    </div>
  `, null));
});

app.post('/register', ah(async (req, res) => {
  const { org_name, portal_type, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const slug = org_name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const tenant = (await pool.query('INSERT INTO tenants(name,email,password_hash,portal_type,slug,approved) VALUES($1,$2,$3,$4,$5,true) RETURNING id',
    [org_name, email, hash, portal_type, slug])).rows[0];
  await pool.query('INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,$4)', [tenant.id, email, hash, 'super_admin']);
  res.send(renderPage('Success', `<div class="alert alert-success">Account created. <a href="/login">Login now</a></div>`, null));
}));

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// === PUBLIC DIRECTORY ===
app.get('/directory', ah(async (req, res) => {
  const { q, type } = req.query;
  let query = `SELECT name,slug,portal_type,public_description,public_location FROM tenants WHERE is_public=true AND approved=true AND banned=false`;
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    query += ` AND (name ILIKE $${params.length} OR public_description ILIKE $${params.length})`;
  }
  if (type) {
    params.push(type);
    query += ` AND portal_type=$${params.length}`;
  }
  query += ` ORDER BY name LIMIT 50`;
  const tenants = (await pool.query(query, params)).rows;
  res.send(renderPage('Directory', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981);padding:20px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔍 Public Directory</h1><p>Find schools, organizations, businesses</p>
    </div>
    <div class="card">
      <form method="GET" action="/directory">
        <input name="q" placeholder="Search name..." value="${esc(q||'')}" style="width:60%">
        <select name="type">
          <option value="">All Types</option>
          <option value="school" ${type==='school'?'selected':''}>Schools</option>
          <option value="organization" ${type==='organization'?'selected':''}>Organizations</option>
          <option value="church" ${type==='church'?'selected':''}>Churches</option>
          <option value="business" ${type==='business'?'selected':''}>Businesses</option>
          <option value="individual" ${type==='individual'?'selected':''}>Individuals</option>
        </select>
        <button class="btn">Search</button>
      </form>
    </div>
    <div class="grid">
      ${tenants.map(t=>`
        <div class="card">
          <h3><a href="/s/${esc(t.slug)}">${esc(t.name)}</a></h3>
          <p style="color:#666;font-size:14px">${esc(t.portal_type)}</p>
          <p>${esc(t.public_description?.substring(0,100) || '')}</p>
          ${t.public_location? `<p style="font-size:12px">📍 ${esc(t.public_location)}</p>` : ''}
        </div>
      `).join('') || '<p>No results found</p>'}
    </div>
  `, req.session.user));
}));

// === PUBLIC PROFILE PAGE ===
app.get('/s/:slug', ah(async (req, res) => {
  const tenant = (await pool.query(`SELECT * FROM tenants WHERE slug=$1 AND is_public=true AND approved=true AND banned=false`, [req.params.slug])).rows[0];
  if (!tenant) return res.status(404).send('Not found');
  const services = JSON.parse(tenant.services || '[]');
  const gallery = JSON.parse(tenant.gallery || '[]');
  res.send(`
    <!DOCTYPE html><html><head>
      <title>${esc(tenant.name)} - ${esc(tenant.portal_type)}</title>
      <meta name="description" content="${esc(tenant.public_description || tenant.name)}">
      <meta name="robots" content="index,follow">
      <meta property="og:title" content="${esc(tenant.name)}">
      <meta property="og:description" content="${esc(tenant.public_description || '')}">
      ${tenant.badge_url? `<meta property="og:image" content="${esc(tenant.badge_url)}">` : ''}
      <style>
        *{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
      .cover{height:300px;background:${tenant.cover_image_url? `url(${esc(tenant.cover_image_url)})` : 'linear-gradient(135deg,#3b82f6,#1e40af)'};background-size:cover;background-position:center}
      .container{max-width:1000px;margin:-60px auto 40px;padding:0 20px}
      .profile{background:white;border-radius:16px;padding:30px;box-shadow:0 4px 6px rgba(0,0,0,0.1);margin-bottom:20px}
      .badge{width:120px;height:120px;border-radius:16px;border:4px solid white;object-fit:cover;margin-top:-80px;background:white}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-top:20px}
      .card{background:white;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
      .tag{display:inline-block;background:#e0e7ff;color:#3730a3;padding:4px 12px;border-radius:20px;font-size:14px;margin:4px}
      .gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
      .gallery img{width:100%;height:150px;object-fit:cover;border-radius:8px}
      .social a{display:inline-block;margin-right:15px;color:#3b82f6;text-decoration:none}
      .btn{display:inline-block;background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:10px}
      </style>
    </head><body>
      <div class="cover"></div>
      <div class="container">
        <div class="profile">
          ${tenant.badge_url? `<img src="${esc(tenant.badge_url)}" class="badge" alt="Logo">` : ''}
          <h1 style="font-size:32px;margin:15px 0 5px">${esc(tenant.name)}</h1>
          <p style="color:#64748b;text-transform:capitalize">${esc(tenant.portal_type)} ${tenant.established_year? `• Est. ${tenant.established_year}` : ''}</p>
          ${tenant.public_description? `<p style="margin-top:15px;font-size:16px">${esc(tenant.public_description)}</p>` : ''}
        </div>
        <div class="grid">
          <div class="card"><h3>📞 Contact</h3>
            ${tenant.public_location? `<p>📍 ${esc(tenant.public_location)}</p>` : ''}
            ${tenant.public_phone? `<p>📞 <a href="tel:${esc(tenant.public_phone)}">${esc(tenant.public_phone)}</a></p>` : ''}
            ${tenant.public_email? `<p>✉️ <a href="mailto:${esc(tenant.public_email)}">${esc(tenant.public_email)}</a></p>` : ''}
            ${tenant.opening_hours? `<p>⏰ ${esc(tenant.opening_hours)}</p>` : ''}
            ${tenant.social_whatsapp? `<a href="https://wa.me/${esc(tenant.social_whatsapp.replace(/[^0-9]/g,''))}" class="btn" style="background:#25d366">WhatsApp Us</a>` : ''}
          </div>
          ${services.length? `<div class="card"><h3>🎯 Services</h3>${services.map(s=>`<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}
          ${tenant.social_facebook || tenant.social_twitter? `<div class="card"><h3>🔗 Social Media</h3><div class="social">
            ${tenant.social_facebook? `<a href="https://${esc(tenant.social_facebook)}" target="_blank">Facebook</a>` : ''}
            ${tenant.social_twitter? `<a href="https://${esc(tenant.social_twitter)}" target="_blank">Twitter/X</a>` : ''}
          </div></div>` : ''}
        </div>
        ${gallery.length? `<div class="card" style="margin-top:20px"><h3>🖼️ Gallery</h3><div class="gallery">${gallery.map(url=>`<img src="${esc(url)}" alt="Gallery">`).join('')}</div></div>` : ''}
        <div class="card" style="margin-top:20px;text-align:center"><p style="font-size:14px;color:#64748b">Powered by our platform</p><a href="/" class="btn">Create Your Free Site</a></div>
      </div>
    </body></html>
  `);
}));

// === DASHBOARD ROUTER ===
app.get('/dashboard', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tenant = (await pool.query('SELECT portal_type FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows[0];
  res.redirect(`/portal/${tenant.portal_type}`);
}));

// === SCHOOL PORTAL ===
app.get('/portal/school', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, classes, marks, fees] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(DISTINCT class_name) FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM marks m JOIN students s ON m.student_id=s.id WHERE s.tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM payments WHERE tenant_id=$1', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('School Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
      <h1>🏫 School Portal</h1><p>Manage students, classes, exams, fees</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${students.rows[0].count}</div><div>Students</div></div>
      <div class="stat-card"><div class="stat-num">${classes.rows[0].count}</div><div>Classes</div></div>
      <div class="stat-card"><div class="stat-num">${marks.rows[0].count}</div><div>Marks Entered</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(fees.rows[0].coalesce).toLocaleString()}</div><div>Fees Collected</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>📝 Academics</h3>
        <a href="/academics/marks" class="btn">Record Marks</a>
        <a href="/academics/report-cards" class="btn" style="margin-top:8px">Print Report Cards</a>
        <a href="/academics/classes" class="btn" style="margin-top:8px">Manage Classes</a>
      </div>
      <div class="card"><h3>💰 Fees & Finance</h3>
        <a href="/finance/fees" class="btn">Record Fee Payment</a>
        <a href="/finance/balances" class="btn" style="margin-top:8px">Fee Balances</a>
        <a href="/finance/receipts" class="btn" style="margin-top:8px">Print Receipts</a>
      </div>
      <div class="card"><h3>👥 Staff & Payroll</h3>
        <a href="/hr/staff" class="btn">Staff Records</a>
        <a href="/hr/payroll" class="btn" style="margin-top:8px">Run Payroll</a>
        <a href="/hr/payslips" class="btn" style="margin-top:8px">Print Payslips</a>
      </div>
      <div class="card"><h3>🌐 Public</h3>
        <a href="/settings/public" class="btn">Edit Public Profile</a>
        ${tenant.has_fundraising? '<a href="/fundraising" class="btn btn-gold" style="margin-top:8px">💰 Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
    </div>
  `, req.session.user));
}));

// === BUSINESS PORTAL ===
app.get('/portal/business', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [staff, inventory, sales, expenses] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM staff WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*),COALESCE(SUM(quantity*selling_price),0) as stock_value FROM inventory WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*),COALESCE(SUM(total),0) as revenue FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC(\'month\', NOW())', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC(\'month\', NOW())', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  const profit = parseInt(sales.rows[0].revenue) - parseInt(expenses.rows[0].coalesce);
  res.send(renderPage('Business Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#0f766e,#14b8a6)">
      <h1>💼 Business Portal</h1><p>Sales, Inventory, Staff, Invoices, Profit/Loss</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${staff.rows[0].count}</div><div>Staff</div></div>
      <div class="stat-card"><div class="stat-num">${inventory.rows[0].count}</div><div>Products</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(inventory.rows[0].stock_value).toLocaleString()}</div><div>Stock Value</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(sales.rows[0].revenue).toLocaleString()}</div><div>Sales This Month</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit>=0?'#059669':'#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Profit This Month</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>🛒 Sales</h3>
        <a href="/business/pos" class="btn">Point of Sale</a>
        <a href="/business/sales" class="btn" style="margin-top:8px">Sales Records</a>
        <a href="/business/invoices" class="btn" style="margin-top:8px">Invoices</a>
      </div>
      <div class="card"><h3>📦 Inventory</h3>
        <a href="/business/inventory" class="btn">Stock Management</a>
        <a href="/business/inventory/add" class="btn" style="margin-top:8px">Add Product</a>
        <a href="/business/inventory/low" class="btn" style="margin-top:8px">Low Stock Alert</a>
      </div>
      <div class="card"><h3>👥 Staff & Payroll</h3>
        <a href="/hr/staff" class="btn">Staff Records</a>
        <a href="/hr/payroll" class="btn" style="margin-top:8px">Run Payroll</a>
        <a href="/hr/payslips" class="btn" style="margin-top:8px">Print Payslips</a>
      </div>
      <div class="card"><h3>📊 Finance</h3>
        <a href="/business/expenses" class="btn">Record Expense</a>
        <a href="/business/profit-loss" class="btn" style="margin-top:8px">Profit/Loss Report</a>
        <a href="/business/export" class="btn" style="margin-top:8px">Export to Excel</a>
      </div>
      <div class="card"><h3>🌐 Public</h3>
        <a href="/settings/public" class="btn">Edit Public Profile</a>
        ${tenant.has_fundraising? '<a href="/fundraising" class="btn btn-gold" style="margin-top:8px">💰 Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
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
      <h1>🏢 Organization Portal</h1><p>Manage members, projects, events, budget</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">${projects.rows[0].count}</div><div>Projects</div></div>
      <div class="stat-card"><div class="stat-num">${events.rows[0].count}</div><div>Events</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}</div><div>Budget</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>👥 Members</h3>
        <a href="/org/members" class="btn">Member Database</a>
        <a href="/org/register" class="btn" style="margin-top:8px">Register Member</a>
        <a href="/org/attendance" class="btn" style="margin-top:8px">Attendance</a>
      </div>
      <div class="card"><h3>📊 Projects</h3>
        <a href="/org/projects" class="btn">All Projects</a>
        <a href="/org/projects/new" class="btn" style="margin-top:8px">New Project</a>
        <a href="/org/projects/reports" class="btn" style="margin-top:8px">Project Reports</a>
      </div>
      <div class="card"><h3>💰 Finance & Payroll</h3>
        <a href="/org/finance" class="btn">Record Income/Expense</a>
        <a href="/hr/payroll" class="btn" style="margin-top:8px">Staff Payroll</a>
        <a href="/org/reports" class="btn" style="margin-top:8px">Financial Reports</a>
      </div>
      <div class="card"><h3>🌐 Public</h3>
        <a href="/settings/public" class="btn">Edit Public Profile</a>
        ${tenant.has_fundraising? '<a href="/fundraising" class="btn btn-gold" style="margin-top:8px">💰 Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
    </div>
  `, req.session.user));
}));
app.get('/org/members', requireAuth, requireNotBanned, ah(async (req, res) => {
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1 ORDER BY name', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Members', `<div class="card"><h3>Members</h3><table><tr><th>Name</th><th>Email</th><th>Role</th></tr>${members.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.role)}</td></tr>`).join('')}</table></div>`, req.session.user));
}));

app.get('/org/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Projects', `<div class="card"><h3>Projects</h3>${projects.map(p=>`<div class="card"><b>${esc(p.name)}</b><br>Budget: UGX ${parseInt(p.budget).toLocaleString()}<br>Status: ${esc(p.status)}</div>`).join('')||'<p>No projects</p>'}</div>`, req.session.user));
}));
// === ORG: MEMBERS ===
app.get('/org/members', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Members', `
    <div class="card"><h3>👥 Member Database</h3>
      <a href="/org/register" class="btn">+ Register New Member</a>
      <table style="margin-top:15px"><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th></tr>
      ${members.map(m=>`<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.role)}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="5">No members yet</td></tr>'}
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

// === ORG: ATTENDANCE ===
app.get('/org/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const today = new Date().toISOString().split('T')[0];
  res.send(renderPage('Attendance', `
    <div class="card"><h3>📋 Mark Attendance - ${today}</h3>
      <form method="POST" action="/org/attendance/save">
        <input type="hidden" name="date" value="${today}">
        <table><tr><th>Member</th><th>Present</th></tr>
        ${members.map(m=>`<tr><td>${esc(m.name)}</td><td><input type="checkbox" name="present_ids" value="${m.id}" checked></td></tr>`).join('')}
        </table>
        <button class="btn btn-gold" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/org/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { date, present_ids } = req.body;
  const present = Array.isArray(present_ids)? present_ids : [present_ids].filter(Boolean);
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id FROM members WHERE tenant_id=$1', [t])).rows;
  for (const m of members) {
    const status = present.includes(String(m.id))? 'present' : 'absent';
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4',
      [t, m.id, date, status]);
  }
  res.redirect('/org/attendance');
}));

// === ORG: PROJECTS ===
app.get('/org/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Projects', `
    <div class="card"><h3>📊 All Projects</h3>
      <a href="/org/projects/new" class="btn">+ New Project</a>
      <div class="grid" style="margin-top:15px">
        ${projects.map(p=>`
          <div class="card">
            <h3>${esc(p.name)}</h3>
            <p>Budget: UGX ${parseInt(p.budget).toLocaleString()}</p>
            <p>Spent: UGX ${parseInt(p.spent).toLocaleString()}</p>
            <div style="background:#e5e7eb;height:20px;border-radius:10px"><div style="background:#8b5cf6;height:20px;border-radius:10px;width:${Math.min(100,(p.spent/p.budget)*100)}%"></div></div>
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

// === ORG: FINANCE ===
app.get('/org/finance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT * FROM org_finance WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const income = records.filter(r=>r.type==='income').reduce((a,b)=>a+parseInt(b.amount),0);
  const expense = records.filter(r=>r.type==='expense').reduce((a,b)=>a+parseInt(b.amount),0);
  res.send(renderPage('Org Finance', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${income.toLocaleString()}</div><div>Total Income</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${expense.toLocaleString()}</div><div>Total Expense</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${income-expense>=0?'#059669':'#dc2626'}">UGX ${(income-expense).toLocaleString()}</div><div>Balance</div></div>
    </div>
    <div class="card"><h3>💰 Record Transaction</h3>
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
      ${records.map(r=>`<tr><td><span style="color:${r.type==='income'?'#059669':'#dc2626'}">${r.type}</span></td><td>UGX ${parseInt(r.amount).toLocaleString()}</td><td>${esc(r.description)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/org/finance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, type, description]);
  res.redirect('/org/finance');
}));

// === ORG: REPORTS ===
app.get('/org/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Reports', `
    <div class="card"><h3>📑 Financial Reports</h3>
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
  const csv = [Object.keys(data[0]||{}).join(',')].concat(data.map(r=>Object.values(r).map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));
// === INDIVIDUAL PORTAL ===
app.get('/portal/individual', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [notes, tasks, budget, posts] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM notes WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM tasks WHERE tenant_id=$1 AND completed=false', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM personal_budget WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM social_posts WHERE tenant_id=$1', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Personal Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>👤 Individual Portal</h1><p>Your personal workspace, budget, and social hub</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${notes.rows[0].count}</div><div>Notes</div></div>
      <div class="stat-card"><div class="stat-num">${tasks.rows[0].count}</div><div>Tasks</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}</div><div>Budget</div></div>
      <div class="stat-card"><div class="stat-num">${posts.rows[0].count}</div><div>Posts</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Quick Actions</h3>
        <a href="/personal/notes" class="btn">My Notes</a>
        <a href="/personal/tasks" class="btn" style="margin-top:8px">Task Manager</a>
        <a href="/personal/budget" class="btn" style="margin-top:8px">Budget Tracker</a>
        <a href="/entertainment" class="btn" style="margin-top:8px">🎮 Entertainment</a>
        ${tenant.has_fundraising? '<a href="/fundraising" class="btn btn-gold" style="margin-top:8px">💰 Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
      <div class="card"><h3>🌐 Public</h3>
        <a href="/settings/public" class="btn">Edit Public Profile</a>
      </div>
    </div>
  `, req.session.user));
}));

// === CHURCH PORTAL ===
app.get('/portal/church', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t])).rows[0];
  res.send(renderPage('Church Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c2d12,#ea580c)">
      <h1>⛪ Church Portal</h1><p>Congregation, Tithes, Events</p>
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

// === PUBLIC PROFILE BUILDER ===
app.get('/settings/public', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows[0];
  const services = JSON.parse(tenant.services || '[]');
  const gallery = JSON.parse(tenant.gallery || '[]');
  res.send(renderPage('Public Profile Builder', `
    <div class="card" style="max-width:900px;margin:0 auto">
      <h1>🌐 Public Profile & Advertising</h1>
      <p>Control what the public sees. This page appears on Google.</p>
      <form method="POST" action="/settings/public/save" style="display:grid;gap:15px">
        <label><input type="checkbox" name="is_public" ${tenant.is_public?'checked':''}> <b>Make my page public & searchable</b></label>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div><label>Organization Name</label><input value="${esc(tenant.name)}" disabled></div>
          <div><label>URL Slug</label><input name="slug" placeholder="saint-marys-ss" value="${esc(tenant.slug||'')}" pattern="[a-z0-9-]+" required><small>yourdomain.com/s/${esc(tenant.slug||'your-name')}</small></div>
        </div>
        <label>About / Description</label><textarea name="public_description" rows="4" placeholder="We are a leading school in Kampala...">${esc(tenant.public_description||'')}</textarea>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div><label>Badge/Logo URL</label><input name="badge_url" placeholder="https://imgur.com/logo.png" value="${esc(tenant.badge_url||'')}"></div>
          <div><label>Cover Image URL</label><input name="cover_image_url" placeholder="https://imgur.com/cover.jpg" value="${esc(tenant.cover_image_url||'')}"></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div><label>📍 Location</label><input name="public_location" placeholder="Kampala, Uganda" value="${esc(tenant.public_location||'')}"></div>
          <div><label>📞 Public Phone</label><input name="public_phone" placeholder="+256 700 000000" value="${esc(tenant.public_phone||'')}"></div>
          <div><label>✉️ Public Email</label><input name="public_email" placeholder="info@school.com" value="${esc(tenant.public_email||'')}"></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div><label>⏰ Opening Hours</label><input name="opening_hours" placeholder="Mon-Fri 8am-5pm" value="${esc(tenant.opening_hours||'')}"></div>
          <div><label>📅 Established Year</label><input name="established_year" type="number" placeholder="1995" value="${esc(tenant.established_year||'')}"></div>
        </div>
        <label>🎯 Services / Features - One per line</label><textarea name="services" rows="4" placeholder="Quality Education&#10;Boarding Facilities&#10;Sports Programs&#10;Computer Lab">${services.join('\n')}</textarea>
        <label>🖼️ Gallery Image URLs - One per line</label><textarea name="gallery" rows="3" placeholder="https://imgur.com/pic1.jpg&#10;https://imgur.com/pic2.jpg">${gallery.join('\n')}</textarea>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <div><label>Facebook</label><input name="social_facebook" placeholder="facebook.com/yourpage" value="${esc(tenant.social_facebook||'')}"></div>
          <div><label>Twitter/X</label><input name="social_twitter" placeholder="twitter.com/yourpage" value="${esc(tenant.social_twitter||'')}"></div>
          <div><label>WhatsApp</label><input name="social_whatsapp" placeholder="+256700000000" value="${esc(tenant.social_whatsapp||'')}"></div>
        </div>
        <button class="btn btn-gold" style="padding:15px;font-size:16px">Save & Publish Public Profile</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/settings/public/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { is_public, slug, public_description, badge_url, cover_image_url, public_location, public_phone, public_email, opening_hours, established_year, services, gallery, social_facebook, social_twitter, social_whatsapp } = req.body;
  const servicesArr = JSON.stringify(services.split('\n').filter(s=>s.trim()));
  const galleryArr = JSON.stringify(gallery.split('\n').filter(s=>s.trim()));
  await pool.query(`UPDATE tenants SET is_public=$1, slug=$2, public_description=$3, badge_url=$4, cover_image_url=$5, public_location=$6, public_phone=$7, public_email=$8, opening_hours=$9, established_year=$10, services=$11, gallery=$12, social_facebook=$13, social_twitter=$14, social_whatsapp=$15 WHERE id=$16`,
    [is_public==='on', slug, public_description, badge_url, cover_image_url, public_location, public_phone, public_email, opening_hours, established_year||null, servicesArr, galleryArr, social_facebook, social_twitter, social_whatsapp, t]);
  res.redirect('/settings/public');
}));

// === ACADEMICS: MARKS ===
app.get('/academics/marks', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class_name FROM students WHERE tenant_id=$1 ORDER BY class_name,name', [t])).rows;
  const subjects = (await pool.query('SELECT id,name FROM subjects WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Record Marks', `
    <div class="card"><h3>📝 Record Marks</h3>
      <form method="POST" action="/academics/marks/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
          <select name="student_id" required><option value="">Select Student</option>${students.map(s=>`<option value="${s.id}">${esc(s.name)} - ${esc(s.class_name)}</option>`).join('')}</select>
          <select name="subject_id" required><option value="">Select Subject</option>${subjects.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          <input name="score" type="number" min="0" max="100" placeholder="Score" required>
          <input name="term" placeholder="Term 1" required>
        </div>
        <button class="btn" style="margin-top:10px">Save Mark</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/academics/marks/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { student_id, subject_id, score, term } = req.body;
  await pool.query('INSERT INTO marks(student_id,subject_id,score,term) VALUES($1,$2,$3,$4)', [student_id, subject_id, score, term]);
  res.redirect('/academics/marks');
}));

// === ACADEMICS: REPORT CARDS ===
app.get('/academics/report-cards', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class_name FROM students WHERE tenant_id=$1 ORDER BY class_name,name', [t])).rows;
  res.send(renderPage('Report Cards', `
    <div class="card"><h3>📄 Generate Report Cards</h3>
      <form method="POST" action="/academics/report-cards/generate" target="_blank">
        <select name="student_id" required><option value="">Select Student</option>${students.map(s=>`<option value="${s.id}">${esc(s.name)} - ${esc(s.class_name)}</option>`).join('')}</select>
        <input name="term" placeholder="Term 1" required>
        <button class="btn btn-gold">Generate DOCX</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/academics/report-cards/generate', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { student_id, term } = req.body;
  const student = (await pool.query('SELECT s.*,t.name as school_name FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1 AND s.tenant_id=$2', [student_id, req.session.user.tenant_id])).rows[0];
  if (!student) return res.status(404).send('Student not found');
  const marks = (await pool.query('SELECT sub.name,m.score FROM marks m JOIN subjects sub ON m.subject_id=sub.id WHERE m.student_id=$1 AND m.term=$2', [student_id, term])).rows;
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: student.school_name, bold: true, size: 32 })], alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: 'Student Report Card', bold: true, size: 24 })], alignment: 'center' }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Name: ${student.name}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Class: ${student.class_name}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Term: ${term}` })] }),
        new Paragraph({ text: '' }),
      ...marks.map(m => new Paragraph({ text: `${m.name}: ${m.score}` })),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Total: ${marks.reduce((a,b)=>a+parseInt(b.score),0)} / ${marks.length*100}` })] }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Report-${student.name}-${term}.docx`);
  res.send(buffer);
}));

// === FINANCE: FEES ===
app.get('/finance/fees', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const payments = (await pool.query('SELECT p.*,s.name as student_name FROM payments p LEFT JOIN students s ON p.student_id=s.id WHERE p.tenant_id=$1 ORDER BY p.date_paid DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Fee Payments', `
    <div class="card"><h3>💰 Record Payment</h3>
      <form method="POST" action="/finance/fees/save">
        <input name="student_name" placeholder="Student Name" required>
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="type" placeholder="School Fees" value="School Fees">
        <button class="btn">Record Payment</button>
      </form>
    </div>
    <div class="card"><h3>Recent Payments</h3>
      <table><tr><th>Student</th><th>Amount</th><th>Type</th><th>Date</th></tr>
      ${payments.map(p=>`<tr><td>${esc(p.student_name || 'N/A')}</td><td>UGX ${parseInt(p.amount).toLocaleString()}</td><td>${esc(p.type)}</td><td>${new Date(p.date_paid).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/finance/fees/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { student_name, amount, type } = req.body;
  await pool.query('INSERT INTO payments(tenant_id,student_name,amount,type) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, student_name, amount, type]);
  res.redirect('/finance/fees');
}));

// === HR: STAFF ===
app.get('/hr/staff', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staff = (await pool.query('SELECT * FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Staff Records', `
    <div class="card"><h3>👥 Add Staff</h3>
      <form method="POST" action="/hr/staff/save">
        <input name="name" placeholder="Full Name" required>
        <input name="role" placeholder="Teacher, Bursar, etc" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone">
        <input name="salary" type="number" placeholder="Monthly Salary UGX" required>
        <input name="nin" placeholder="National ID">
        <button class="btn">Add Staff</button>
      </form>
    </div>
    <div class="card"><h3>All Staff</h3>
      <table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Salary</th></tr>
      ${staff.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.role)}</td><td>${esc(s.email)}</td><td>${esc(s.phone)}</td><td>UGX ${parseInt(s.salary).toLocaleString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/hr/staff/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { name, role, email, phone, salary, nin } = req.body;
  await pool.query('INSERT INTO staff(tenant_id,name,role,email,phone,salary,nin) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.session.user.tenant_id, name, role, email, phone, salary, nin]);
  res.redirect('/hr/staff');
}));

// === HR: PAYROLL ===
app.get('/hr/payroll', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staff = (await pool.query('SELECT * FROM staff WHERE tenant_id=$1', [t])).rows;
  const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  res.send(renderPage('Run Payroll', `
    <div class="card"><h3>💵 Payroll for ${month}</h3>
      <form method="POST" action="/hr/payroll/run">
        <table><tr><th>Staff</th><th>Role</th><th>Salary</th><th>Pay</th></tr>
        ${staff.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.role)}</td><td>UGX ${parseInt(s.salary).toLocaleString()}</td><td><input type="checkbox" name="staff_ids" value="${s.id}" checked></td></tr>`).join('')}
        </table>
        <input type="hidden" name="month" value="${month}">
        <button class="btn btn-gold" style="margin-top:15px">Run Payroll for Selected</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/hr/payroll/run', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { staff_ids, month } = req.body;
  const ids = Array.isArray(staff_ids)? staff_ids : [staff_ids];
  for (const id of ids) {
    const staff = (await pool.query('SELECT salary FROM staff WHERE id=$1 AND tenant_id=$2', [id, req.session.user.tenant_id])).rows[0];
    if (staff) {
      await pool.query('INSERT INTO payroll(tenant_id,staff_id,amount,month,status,paid_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT DO NOTHING', [req.session.user.tenant_id, id, staff.salary, month, 'paid']);
    }
  }
  res.redirect('/hr/payroll');
}));

// === HR: PAYSLIPS ===
app.get('/hr/payslips', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const payrolls = (await pool.query('SELECT p.*,s.name,s.role FROM payroll p JOIN staff s ON p.staff_id=s.id WHERE p.tenant_id=$1 AND p.status=$2 ORDER BY p.paid_at DESC LIMIT 50', [t, 'paid'])).rows;
  res.send(renderPage('Payslips', `
    <div class="card"><h3>📄 Generated Payslips</h3>
      <table><tr><th>Staff</th><th>Role</th><th>Month</th><th>Amount</th><th>Action</th></tr>
      ${payrolls.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.role)}</td><td>${esc(p.month)}</td><td>UGX ${parseInt(p.amount).toLocaleString()}</td><td><a href="/hr/payslips/${p.id}/download" class="btn" target="_blank">Download DOCX</a></td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/hr/payslips/:id/download', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const p = (await pool.query('SELECT p.*,s.name,s.role,t.name as school_name FROM payroll p JOIN staff s ON p.staff_id=s.id JOIN tenants t ON p.tenant_id=t.id WHERE p.id=$1 AND p.tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: p.school_name, bold: true, size: 28 })], alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: 'Payslip', bold: true, size: 24 })], alignment: 'center' }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Employee: ${p.name}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Role: ${p.role}` })] }),
        new Paragraph({ children: [new TextRun({ text: `Month: ${p.month}` })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Gross Salary: UGX ${parseInt(p.amount).toLocaleString()}`, bold: true })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Net Pay: UGX ${parseInt(p.amount).toLocaleString()}`, bold: true })] }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Date Paid: ${new Date(p.paid_at).toLocaleDateString()}` }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Payslip-${p.name}-${p.month}.docx`);
  res.send(buffer);
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
      <h1>🎮 Entertainment Hub</h1><p>Videos, Music, Games, Live TV</p>
    </div>
    <div class="grid">
      <div class="card"><h3>📺 Videos</h3>${videos.rows.map(v=>`<p><a href="${esc(v.url)}" target="_blank">${esc(v.title)}</a></p>`).join('') || '<p>No videos yet</p>'}</div>
      <div class="card"><h3>🎵 Music</h3>${music.rows.map(m=>`<p>${esc(m.title)} - ${esc(m.artist)}</p>`).join('') || '<p>No music yet</p>'}</div>
      <div class="card"><h3>🏆 Top Scores</h3>${games.rows.map(g=>`<p>${esc(g.player_name)}: ${g.score} - ${esc(g.name)}</p>`).join('') || '<p>No games yet</p>'}</div>
      <div class="card"><h3>📡 Live TV</h3><p>Coming soon: Stream live channels</p></div>
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
  const flashHtml = flash? `<div class="alert alert-${flash.type}">${esc(flash.msg)}</div>` : '';
  const chartLabels = chartData.rows.map(r => new Date(r.day).toLocaleDateString('en-GB', {month:'short',day:'numeric'})).join("','");
  const chartValues = chartData.rows.map(r => r.total).join(',');
  res.send(renderPage('Dev Master', `
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:20px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔴 DEVELOPER MASTER CONTROL</h1><p style="opacity:0.9">Full system control</p>
    </div>
    ${flashHtml}
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${tCount.rows[0].count}</div><div>Tenants</div></div>
      <div class="stat-card"><div class="stat-num">${uCount.rows[0].count}</div><div>Users</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(rev.rows[0].t).toLocaleString()}</div><div>30-Day Rev</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(wal.rows[0]?.b || 0).toLocaleString()}</div><div>Ready Withdraw</div></div>
    </div>
    <div class="card" style="margin-bottom:20px"><h3>📈 30-Day Revenue</h3><canvas id="revChart"></canvas></div>
    <div class="grid">
      <div class="card"><h3>💰 Revenue Controls</h3>
        <form method="POST" action="/dev/inject-revenue">
          <input name="amount" placeholder="Amount UGX" type="number" required>
          <input name="source" placeholder="Source: Grant, Ads, Sub" required>
          <button class="btn btn-gold">Inject Revenue</button>
        </form>
        <form method="POST" action="/dev/withdraw-all" style="margin-top:10px">
          <button class="btn btn-red">Withdraw All</button>
        </form>
      </div>
      <div class="card"><h3>🏢 Tenant Controls</h3>
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
      <div class="card"><h3>👤 User Controls</h3>
        <form method="POST" action="/dev/user-action">
          <select name="action" required><option value="">Select Action</option>
            <option value="ban_user">Ban User</option><option value="unban_user">Unban User</option>
            <option value="make_admin">Make Super Admin</option><option value="make_teacher">Make Teacher</option>
            <option value="delete_user">DELETE User</option>
          </select>
          <input name="user_id" placeholder="User ID" type="number" required>
          <button class="btn btn-red">Execute</button>
        </form>
      </div>
      <div class="card"><h3>⚡ Quick Actions</h3>
        <form method="POST" action="/dev/quick" style="display:grid;gap:8px">
          <button name="action" value="verify_all" class="btn">Verify All Tenants</button>
          <button name="action" value="approve_all_users" class="btn">Approve All Users</button>
          <button name="action" value="reset_platform" class="btn btn-red" onclick="return confirm('Reset ALL revenue?')">Reset Platform Wallet</button>
        </form>
      </div>
      <div class="card"><h3>🗄️ SQL Runner</h3>
        <form method="POST" action="/dev/sql">
          <textarea name="sql" placeholder="SELECT * FROM users LIMIT 5" rows="3" style="width:100%;margin-bottom:8px;font-family:monospace"></textarea>
          <button class="btn btn-red">Run SQL</button>
        </form>
          </div>
      <div class="card"><h3>💾 Backup / Export</h3>
        <a href="/dev/export/tenants" class="btn">Export Tenants CSV</a>
        <a href="/dev/export/users" class="btn" style="margin-top:8px">Export Users CSV</a>
        <a href="/dev/export/revenue" class="btn" style="margin-top:8px">Export Revenue CSV</a>
      </div>
      <div class="card"><h3>📋 Activity Logs</h3>
        <div style="max-height:300px;overflow:auto;font-size:12px">
          ${logs.rows.map(l=>`<div style="border-bottom:1px solid #eee;padding:4px 0">
            <b>${esc(l.action)}</b> by ${esc(l.user_email)}<br>
            <small>${new Date(l.created_at).toLocaleString()}</small><br>
            <code>${esc(l.details||'')}</code>
          </div>`).join('') || 'No logs yet'}
        </div>
      </div>
    </div>
    <div class="grid">
      <div class="card"><h3>All Tenants</h3>
        <table><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Verified</th><th>Status</th><th>Actions</th></tr>
        ${tenants.rows.map(t=>`<tr>
          <td>${t.id}</td>
          <td>${esc(t.name)}</td>
          <td>${esc(t.type)}</td>
          <td>UGX ${parseInt(t.wallet_balance).toLocaleString()}</td>
          <td>${t.verified?'✅':'❌'}</td>
          <td>${t.approved? (t.banned?'<span style="color:#dc2626">Banned</span>':'<span style="color:#059669">Active</span>') : '<span style="color:#d97706">Pending</span>'}</td>
          <td><a href="/dev/tenant/${t.id}">Manage</a></td>
        </tr>`).join('')}
        </table>
      </div>
      <div class="card"><h3>All Users</h3>
        <table><tr><th>ID</th><th>Email</th><th>Role</th><th>Approved</th></tr>
        ${users.rows.map(u=>`<tr><td>${u.id}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.approved?'✅':'❌'}</td></tr>`).join('')}
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
app.post('/dev/inject-revenue', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { amount, source } = req.body;
  const amt = parseInt(amount);
  if (!amt || amt <= 0 ||!source?.trim()) {
    req.session.flash = { type: 'error', msg: 'Valid amount and source required' };
    return res.redirect('/dev/master');
  }
  await pool.query('BEGIN');
  try {
    await pool.query('INSERT INTO developer_revenue(amount,description) VALUES($1,$2)', [amt, source.trim()]);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [amt]);
    await pool.query('COMMIT');
    req.session.flash = { type: 'success', msg: `Injected UGX ${amt.toLocaleString()} from ${esc(source)}` };
  } catch(e) {
    await pool.query('ROLLBACK');
    req.session.flash = { type: 'error', msg: 'Injection failed: ' + e.message };
  }
  res.redirect('/dev/master');
}));

app.post('/dev/withdraw-all', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  try {
    const w = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0];
    if (!w || w.balance <= 0) throw new Error('No balance to withdraw');
    await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
    await pool.query('INSERT INTO developer_revenue(amount,description) VALUES($1,$2)', [-w.balance, 'withdrawal']);
    req.session.flash = { type: 'success', msg: `Withdrew UGX ${w.balance.toLocaleString()}` };
  } catch(e) {
    req.session.flash = { type: 'error', msg: e.message };
  }
  res.redirect('/dev/master');
}));

app.post('/dev/execute', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { action, target_id, amount, reason } = req.body;
  let msg = '';
  try {
    switch(action) {
      case 'add_balance':
        if (!amount || amount <= 0) throw new Error('Invalid amount');
        const bal = await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2 RETURNING name,wallet_balance', [amount, target_id]);
        if (!bal.rowCount) throw new Error('Tenant not found');
        msg = `Added UGX ${parseInt(amount).toLocaleString()} to ${bal.rows[0].name}`;
        break;
      case 'verify_tenant':
        const v = await pool.query('UPDATE tenants SET verified=true WHERE id=$1 RETURNING name', [target_id]);
        if (!v.rowCount) throw new Error('Tenant not found');
        msg = `Verified: ${v.rows[0].name}`;
        break;
      case 'unverify_tenant':
        const uv = await pool.query('UPDATE tenants SET verified=false WHERE id=$1 RETURNING name', [target_id]);
        if (!uv.rowCount) throw new Error('Tenant not found');
        msg = `Unverified: ${uv.rows[0].name}`;
        break;
      case 'approve_tenant':
        const ap = await pool.query('UPDATE tenants SET approved=true WHERE id=$1 RETURNING name', [target_id]);
        if (!ap.rowCount) throw new Error('Tenant not found');
        msg = `Approved: ${ap.rows[0].name}`;
        break;
      case 'ban_tenant':
        const bt = await pool.query('UPDATE tenants SET banned=true,ban_reason=$2 WHERE id=$1 RETURNING name', [target_id, reason||'Terms violation']);
        if (!bt.rowCount) throw new Error('Tenant not found');
        msg = `Banned: ${bt.rows[0].name}`;
        break;
      case 'unban_tenant':
        const ubt = await pool.query('UPDATE tenants SET banned=false,ban_reason=NULL WHERE id=$1 RETURNING name', [target_id]);
        if (!ubt.rowCount) throw new Error('Tenant not found');
        msg = `Unbanned: ${ubt.rows[0].name}`;
        break;
      case 'grant_free_access':
        const gf = await pool.query('UPDATE tenants SET free_access=true WHERE id=$1 RETURNING name', [target_id]);
        if (!gf.rowCount) throw new Error('Tenant not found');
        msg = `Granted free access: ${gf.rows[0].name}`;
        break;
      case 'enable_fundraising':
        const ef = await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1 RETURNING name', [target_id]);
        if (!ef.rowCount) throw new Error('Tenant not found');
        msg = `Enabled fundraising: ${ef.rows[0].name}`;
        break;
      case 'delete_tenant':
        const d = await pool.query('DELETE FROM tenants WHERE id=$1 RETURNING name', [target_id]);
        if (!d.rowCount) throw new Error('Tenant not found');
        msg = `Deleted tenant: ${d.rows[0].name}`;
        break;
      default: throw new Error('Invalid action');
    }
    req.session.flash = { type: 'success', msg };
  } catch(e) {
    req.session.flash = { type: 'error', msg: e.message };
  }
  res.redirect('/dev/master');
}));

app.post('/dev/user-action', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { action, user_id } = req.body;
  let msg = '';
  try {
    switch(action) {
      case 'ban_user':
        const b = await pool.query('UPDATE users SET banned=true WHERE id=$1 RETURNING email', [user_id]);
        if (!b.rowCount) throw new Error('User not found');
        msg = `Banned: ${b.rows[0].email}`;
        break;
      case 'unban_user':
        const ub = await pool.query('UPDATE users SET banned=false WHERE id=$1 RETURNING email', [user_id]);
        if (!ub.rowCount) throw new Error('User not found');
        msg = `Unbanned: ${ub.rows[0].email}`;
        break;
      case 'make_admin':
        const ma = await pool.query('UPDATE users SET role=\'super_admin\' WHERE id=$1 RETURNING email', [user_id]);
        if (!ma.rowCount) throw new Error('User not found');
        msg = `Made admin: ${ma.rows[0].email}`;
        break;
      case 'make_teacher':
        const mt = await pool.query('UPDATE users SET role=\'teacher\' WHERE id=$1 RETURNING email', [user_id]);
        if (!mt.rowCount) throw new Error('User not found');
        msg = `Made teacher: ${mt.rows[0].email}`;
        break;
      case 'delete_user':
        const du = await pool.query('DELETE FROM users WHERE id=$1 RETURNING email', [user_id]);
        if (!du.rowCount) throw new Error('User not found');
        msg = `Deleted user: ${du.rows[0].email}`;
        break;
      default: throw new Error('Invalid action');
    }
    req.session.flash = { type: 'success', msg };
  } catch(e) {
    req.session.flash = { type: 'error', msg: e.message };
  }
  res.redirect('/dev/master');
}));

app.post('/dev/quick', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { action } = req.body;
  try {
    if (action === 'verify_all') {
      await pool.query('UPDATE tenants SET verified=true');
      req.session.flash = { type: 'success', msg: 'All tenants verified' };
    } else if (action === 'approve_all_users') {
      await pool.query('UPDATE users SET approved=true');
      req.session.flash = { type: 'success', msg: 'All users approved' };
    } else if (action === 'reset_platform') {
      await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
      req.session.flash = { type: 'success', msg: 'Platform wallet reset to 0' };
    }
  } catch(e) {
    req.session.flash = { type: 'error', msg: e.message };
  }
  res.redirect('/dev/master');
}));

app.post('/dev/sql', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql?.trim()) throw new Error('SQL required');
    if (/drop|truncate|alter table.*drop|delete from (users|tenants) where/i.test(sql)) throw new Error('Destructive SQL blocked');
    const result = await pool.query(sql);
    req.session.flash = { type: 'success', msg: `SQL OK: ${result.rowCount} rows. ${JSON.stringify(result.rows.slice(0,3))}` };
  } catch(e) {
    req.session.flash = { type: 'error', msg: 'SQL Error: ' + e.message };
  }
  res.redirect('/dev/master');
}));

app.get('/dev/export/:table', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { table } = req.params;
  const allowed = ['tenants', 'users', 'developer_revenue'];
  if (!allowed.includes(table)) return res.status(400).send('Invalid table');
  const data = (await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`)).rows;
  const csv = [Object.keys(data[0]||{}).join(',')].concat(data.map(r=>Object.values(r).map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(`${table}-${Date.now()}.csv`);
  res.send(csv);
}));

// === BUSINESS: POS ===
app.get('/business/pos', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const inventory = (await pool.query('SELECT id,name,sku,selling_price,quantity FROM inventory WHERE tenant_id=$1 AND quantity>0 ORDER BY name', [t])).rows;
  res.send(renderPage('Point of Sale', `
    <div class="card"><h3>🛒 New Sale</h3>
      <form method="POST" action="/business/pos/checkout">
        <input name="customer_name" placeholder="Customer Name" required>
        <input name="customer_contact" placeholder="Phone (optional)">
        <table id="saleTable"><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr>
        <tr>
          <td><select name="item_0_id" onchange="updatePrice(0)"><option value="">Select</option>
            ${inventory.map(i=>`<option value="${i.id}" data-price="${i.selling_price}">${esc(i.name)} - UGX ${parseInt(i.selling_price).toLocaleString()}</option>`).join('')}
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
      function updatePrice(i) {
        const sel = document.querySelector(\`[name="item_\${i}_id"]\`);
        const price = sel.options[sel.selectedIndex]?.dataset.price || 0;
        document.getElementById(\`price_\${i}\`).textContent = parseInt(price).toLocaleString();
        calcTotal();
      }
      function calcTotal() {
        let grand = 0;
        for(let i=0; i<rows; i++) {
          const price = parseInt(document.getElementById(\`price_\${i}\`).textContent.replace(/,/g,'')) || 0;
          const qty = parseInt(document.querySelector(\`[name="item_\${i}_qty"]\`).value) || 0;
          const total = price * qty;
          document.getElementById(\`total_\${i}\`).textContent = total.toLocaleString();
          grand += total;
        }
        document.getElementById('grandTotal').textContent = grand.toLocaleString();
      }
      function addRow() {
        const table = document.getElementById('saleTable');
        const newRow = table.insertRow();
        newRow.innerHTML = document.querySelector('#saleTable tr:nth-child(2)').innerHTML.replace(/_0/g, \`_\${rows}\`);
        rows++;
        document.getElementById('rowCount').value = rows;
      }
    </script>
  `, req.session.user));
}));

app.post('/business/pos/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, payment_status, row_count } = req.body;
  let total = 0;
  const items = [];
  for (let i = 0; i < parseInt(row_count); i++) {
    const id = req.body[`item_${i}_id`];
    const qty = parseInt(req.body[`item_${i}_qty`]) || 0;
    if (id && qty > 0) {
      const product = (await pool.query('SELECT selling_price,name FROM inventory WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
      if (product) {
        items.push({ id, qty, price: product.selling_price, name: product.name });
        total += product.selling_price * qty;
        await pool.query('UPDATE inventory SET quantity=quantity-$1 WHERE id=$2', [qty, id]);
      }
    }
  }
  const sale = (await pool.query('INSERT INTO sales(tenant_id,customer_name,total,paid,status) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [t, customer_name, total, payment_status==='paid'?total:0, payment_status])).rows[0];
  for (let item of items) {
    await pool.query('INSERT INTO sale_items(sale_id,inventory_id,quantity,price) VALUES($1,$2,$3,$4)', [sale.id, item.qty, item.price]);
  }
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: `${req.session.user.tenant_name} - Receipt`, bold: true, size: 24 })] }),
        new Paragraph({ text: `Customer: ${customer_name}` }),
        new Paragraph({ text: `Date: ${new Date().toLocaleString()}` }),
        new Paragraph({ text: "" }),
      ...items.map(i => new Paragraph({ text: `${i.name} x${i.qty} - UGX ${(i.price*i.qty).toLocaleString()}` })),
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
app.get('/business/inventory', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Inventory', `
    <div class="card"><h3>📦 Stock Management</h3>
      <a href="/business/inventory/add" class="btn">+ Add Product</a>
      <table><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Value</th></tr>
      ${items.map(i=>`
        <tr ${i.quantity<5?'style="background:#fee2e2"':''}>
          <td>${esc(i.sku)}</td>
          <td>${esc(i.name)}</td>
          <td>${i.quantity}</td>
          <td>${parseInt(i.cost_price).toLocaleString()}</td>
          <td>${parseInt(i.selling_price).toLocaleString()}</td>
          <td>${(i.quantity*i.selling_price).toLocaleString()}</td>
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

app.post('/business/inventory/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, sku, quantity, cost_price, selling_price } = req.body;
  await pool.query('INSERT INTO inventory(tenant_id,name,sku,quantity,cost_price,selling_price) VALUES($1,$2,$3,$4,$5,$6)', [t, name, sku, quantity, cost_price, selling_price]);
  res.redirect('/business/inventory');
}));

// === BUSINESS: INVOICES ===
app.get('/business/invoices', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Invoices', `
    <div class="card"><h3>📄 Invoices</h3>
      <a href="/business/invoices/new" class="btn">+ New Invoice</a>
      <table><tr><th>No.</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Action</th></tr>
      ${invoices.map(i=>`
        <tr>
          <td>${esc(i.invoice_no)}</td>
          <td>${esc(i.customer_name)}</td>
          <td>UGX ${parseInt(i.amount).toLocaleString()}</td>
          <td>${new Date(i.due_date).toLocaleDateString()}</td>
          <td>${i.status==='paid'?'✅ Paid':'❌ Unpaid'}</td>
          <td><a href="/business/invoices/${i.id}/print" target="_blank">Print</a></td>
        </tr>
      `).join('')}
      </table>
    </div>
  `, req.session.user));
}));

// === ENTERTAINMENT ===
app.get('/entertainment', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Entertainment Hub', `
    <div class="hero" style="background:linear-gradient(135deg,#db2777,#ec4899)">
      <h1>🎮 Entertainment Hub</h1><p>Videos, Music, Games, Live TV</p>
    </div>
    <div class="grid">
      <div class="card"><h3>📺 Videos</h3><p>Watch curated content</p></div>
      <div class="card"><h3>🎵 Music</h3><p>Stream your favorites</p></div>
      <div class="card"><h3>🎯 Games</h3><p>Play & compete</p></div>
      <div class="card"><h3>📡 Live TV</h3><p>Coming soon</p></div>
    </div>
  `, req.session.user));
}));

// === FUNDRAISING ===
app.get('/fundraising', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  if (!tenant.has_fundraising) return res.redirect('/upgrade/fundraising');
  const campaigns = (await pool.query('SELECT * FROM campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Fundraising', `
    <div class="hero" style="background:linear-gradient(135deg,#ca8a04,#eab308)">
      <h1>💰 Fundraising</h1><p>Create campaigns, track donations</p>
    </div>
    <div class="card"><h3>Create Campaign</h3>
      <form method="POST" action="/fundraising/create">
        <input name="title" placeholder="Build New Library" required>
        <input name="target" type="number" placeholder="Target UGX" required>
        <button class="btn btn-gold">Launch Campaign</button>
      </form>
    </div>
    <div class="grid">
      ${campaigns.map(c=>`<div class="card"><h3>${esc(c.title)}</h3><p>Target: UGX ${parseInt(c.target).toLocaleString()}</p><p>Raised: UGX ${parseInt(c.raised).toLocaleString()}</p><div style="background:#e5e7eb;height:20px;border-radius:10px"><div style="background:#eab308;height:20px;border-radius:10px;width:${Math.min(100,(c.raised/c.target)*100)}%"></div></div>`).join('') || '<p>No campaigns yet</p>'}
    </div>
  `, req.session.user));
}));

app.post('/fundraising/create', requireAuth, ah(async (req, res) => {
  const { title, target } = req.body;
  await pool.query('INSERT INTO campaigns(tenant_id,title,target) VALUES($1,$2,$3)', [req.session.user.tenant_id, title, target]);
  res.redirect('/fundraising');
}));

// === UPGRADE ===
app.get('/upgrade/fundraising', requireAuth, (req, res) => {
  res.send(renderPage('Add Fundraising', `
    <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
      <h1>💰 Add Fundraising Module</h1>
      <p>Enable campaigns, donation tracking, and donor management for your organization.</p>
      <h2 style="color:#ca8a04;margin:20px 0">UGX 20,000/month</h2>
      <form method="POST" action="/upgrade/fundraising/activate">
        <button class="btn btn-gold" style="padding:15px 30px;font-size:18px">Activate Fundraising</button>
      </form>
      <p style="font-size:12px;color:#64748b;margin-top:15px">Cancel anytime. No setup fees.</p>
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
}));
// === 404 ===
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card"><h2>404</h2><p>Page not found</p></div>', req.session.user)));

// === START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Platform LIVE on ${PORT}`);
  console.log(`Dev Master: waiswadaniel24@gmail.com`);
});
