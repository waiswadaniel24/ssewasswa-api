const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

let paypalEnabled = false;
let paypal = null;
let googleEnabled = false;

async function initPayPal() {
  const s = await getSettings(1);
  if (s.paypal_client_id && s.paypal_client_secret) {
    paypal = require('paypal-rest-sdk');
    paypal.configure({
      mode: 'live',
      client_id: s.paypal_client_id,
      client_secret: s.paypal_client_secret
    });
    paypalEnabled = true;
    console.log('✅ PayPal enabled');
  } else {
    console.log('⚠️ PayPal disabled - add keys in /admin/settings to enable');
  }
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (user.rows.length === 0) {
        const tenantName = profile.displayName + ' School';
        const sub = tenantName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
        await pool.query('INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3)', [tenantName, sub, 'free']);
        const t = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', [sub]);
        const hash = await bcrypt.hash(Math.random().toString(36), 10);
        await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [t.rows[0].id, email, hash, 'admin']);
        await pool.query('INSERT INTO settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [t.rows[0].id]);
        user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      }
      return done(null, user.rows[0]);
    } catch (err) {
      return done(err);
    }
  }));
  googleEnabled = true;
  console.log('✅ Google OAuth enabled');
} else {
  console.log('⚠️ Google OAuth disabled - add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET env vars to enable');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  done(null, user.rows[0]);
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      subdomain TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free',
      plan_expires DATE,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      name TEXT NOT NULL,
      class TEXT,
      dob DATE,
      guardian_name TEXT,
      guardian_phone TEXT,
      balance NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fees (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      student_id INTEGER REFERENCES students(id),
      amount NUMERIC NOT NULL,
      term TEXT,
      year INTEGER,
      paid NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      student_id INTEGER REFERENCES students(id),
      date DATE NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (tenant_id, student_id, date)
    );
    CREATE TABLE IF NOT EXISTS grades (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      student_id INTEGER REFERENCES students(id),
      subject TEXT NOT NULL,
      score NUMERIC,
      term TEXT,
      year INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS market_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      title TEXT NOT NULL,
      description TEXT,
      price NUMERIC NOT NULL,
      seller_email TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) UNIQUE,
      balance NUMERIC DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS surveys (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id),
      creator_email TEXT,
      title TEXT NOT NULL,
      questions JSONB,
      reward_per_user NUMERIC DEFAULT 0,
      total_budget NUMERIC DEFAULT 0,
      max_responses INTEGER DEFAULT 100,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS survey_responses (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER REFERENCES surveys(id),
      user_email TEXT,
      answers JSONB,
      reward_paid NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) UNIQUE,
      site_name TEXT DEFAULT 'SSE Wasswa ERP',
      hero_title TEXT DEFAULT 'School Management Made Simple',
      hero_subtitle TEXT DEFAULT 'Manage students, fees, attendance, marketplace & surveys in one place',
      whatsapp_number TEXT DEFAULT '+256789231081',
      momo_number TEXT DEFAULT '0705373465',
      momo_names TEXT DEFAULT 'WASSWA',
      paper_price NUMERIC DEFAULT 150,
      contact_email TEXT DEFAULT 'admin@ssewasswa.com',
      location TEXT DEFAULT 'Kampala, Uganda',
      primary_color TEXT DEFAULT '#3498db',
      allow_marketplace BOOLEAN DEFAULT true,
      allow_surveys BOOLEAN DEFAULT true,
      paypal_client_id TEXT,
      paypal_client_secret TEXT
    );
  `);

  await pool.query(`INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) ON CONFLICT (subdomain) DO NOTHING`, ['SSE Wasswa', 'main', 'enterprise']);
  const t = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', ['main']);
  const tenantId = t.rows[0].id;

  await pool.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, [tenantId, 'admin@ssewasswa.com', await bcrypt.hash('admin123', 10), 'super_admin']);
  await pool.query(`INSERT INTO wallets (tenant_id, balance) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 0]);
  await pool.query(`INSERT INTO settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

async function requireTenant(req, res, next) {
  const sub = req.headers.host.split('.')[0];
  if (sub === 'localhost' || sub === 'ssewasswa-api') {
    req.tenantId = 1;
    return next();
  }
  const t = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [sub]);
  if (t.rows.length === 0) return res.status(404).send('School not found');
  req.tenantId = t.rows[0].id;
  req.tenant = t.rows[0];
  next();
}

async function getSettings(tenantId) {
  const s = await pool.query('SELECT * FROM settings WHERE tenant_id = $1', [tenantId]);
  return s.rows[0] || {
    site_name: 'SSE Wasswa ERP',
    hero_title: 'School Management Made Simple',
    hero_subtitle: 'Manage students, fees, attendance, marketplace & surveys in one place',
    whatsapp_number: '+256789231081',
    momo_number: '0705373465',
    momo_names: 'WASSWA',
    paper_price: 150,
    contact_email: 'admin@ssewasswa.com',
    location: 'Kampala, Uganda',
    primary_color: '#3498db',
    allow_marketplace: true,
    allow_surveys: true,
    paypal_client_id: null,
    paypal_client_secret: null
  };
}

app.get('/health', (req, res) => res.send('OK'));

app.get('/', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}.hero{background:${s.primary_color};color:white;padding:80px 20px;text-align:center}.btn{background:white;color:${s.primary_color};padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;margin:10px}.container{max-width:1000px;margin:40px auto;padding:20px}.card{background:white;padding:30px;border-radius:8px;margin:20px 0;box-shadow:0 2px 8px rgba(0,0,0,0.1)}</style>
  </head><body>
  <div class="hero"><h1>${s.hero_title}</h1><p>${s.hero_subtitle}</p>
  <a href="/login" class="btn">Login</a><a href="/signup" class="btn">Start Free Trial</a></div>
  <div class="container">
  <div class="card"><h2>For Schools</h2><p>Manage students, fees, attendance, grades, reports. UGX 50,000/month after 30-day free trial.</p></div>
  <div class="card"><h2>Marketplace & Surveys</h2><p>Sell papers, uniforms. Run paid surveys. We take 10% admin fee.</p></div>
  <div class="card"><h2>Contact</h2><p>Email: ${s.contact_email}<br>WhatsApp: ${s.whatsapp_number}<br>MoMo: ${s.momo_number} (${s.momo_names})<br>Location: ${s.location}</p></div>
  </div></body></html>`);
});

app.get('/login', (req, res) => {
  const googleBtn = googleEnabled? '<p style="text-align:center;margin-top:20px"><a href="/auth/google">Login with Google</a></p>' : '';
  res.send(`<!DOCTYPE html><html><head><title>Login</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:30px;background:#f4f6f9}form{background:white;padding:30px;border-radius:8px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:4px}button{width:100%;padding:12px;background:#3498db;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><form method="POST" action="/login">
  <h2>School Login</h2>
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Login</button>
  ${googleBtn}
  <p style="text-align:center"><a href="/signup">Create School Account</a></p>
  </form></body></html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (user.rows.length === 0) return res.send('Invalid login');
  const valid = await bcrypt.compare(password, user.rows[0].password_hash);
  if (!valid) return res.send('Invalid login');
  req.session.user = user.rows[0];
  res.redirect('/app');
});

if (googleEnabled) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    req.session.user = req.user;
    res.redirect('/app');
  });
}

app.get('/signup', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Sign Up</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:400px;margin:100px auto;padding:30px;background:#f4f6f9}form{background:white;padding:30px;border-radius:8px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:4px}button{width:100%;padding:12px;background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer}</style>
  </head><body><form method="POST" action="/signup">
  <h2>Start 30-Day Free Trial</h2>
  <input name="school_name" placeholder="School Name" required>
  <input name="email" type="email" placeholder="Admin Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Create School</button>
  </form></body></html>`);
});

app.post('/signup', async (req, res) => {
  const { school_name, email, password } = req.body;
  const sub = school_name.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  await pool.query('INSERT INTO tenants (name, subdomain, plan, plan_expires) VALUES ($1, $2, $3, $4)', [school_name, sub, 'free', expires]);
  const t = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', [sub]);
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [t.rows[0].id, email, hash, 'admin']);
  await pool.query('INSERT INTO wallets (tenant_id, balance) VALUES ($1, $2)', [t.rows[0].id, 0]);
  await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [t.rows[0].id]);
  res.send(`School created! Login at: https://${sub}.onrender.com/login`);
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/app', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const students = await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id = $1', [req.tenantId]);
  const fees = await pool.query('SELECT SUM(amount-paid) as due FROM fees WHERE tenant_id = $1', [req.tenantId]);
  res.send(`<!DOCTYPE html><html><head><title>Dashboard</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}nav{background:${s.primary_color};color:white;padding:15px}nav a{color:white;margin:0 15px;text-decoration:none}.container{max-width:1200px;margin:20px auto;padding:20px}.card{background:white;padding:20px;border-radius:8px;margin:10px;display:inline-block;min-width:200px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}.btn{background:${s.primary_color};color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}</style>
  </head><body>
  <nav><strong>${req.tenant.name}</strong>
  <a href="/app">Dashboard</a><a href="/students">Students</a><a href="/fees">Fees</a><a href="/attendance">Attendance</a><a href="/grades">Grades</a>
  <a href="/market">Market</a><a href="/surveys">Surveys</a><a href="/upgrade">Upgrade</a><a href="/admin/settings">Settings</a><a href="/logout">Logout</a>
  </nav>
  <div class="container">
  <h1>Dashboard</h1>
  <div class="card"><h3>Students</h3><p style="font-size:32px">${students.rows[0].count}</p></div>
  <div class="card"><h3>Fees Due</h3><p style="font-size:32px">UGX ${fees.rows[0].due || 0}</p></div>
  <div class="card"><h3>Plan</h3><p>${req.tenant.plan.toUpperCase()}</p><a href="/upgrade" class="btn">Upgrade</a></div>
  </div></body></html>`);
});

app.get('/students', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const students = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
  res.send(`<!DOCTYPE html><html><head><title>Students</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;margin:0;background:#f4f6f9}nav{background:${s.primary_color};color:white;padding:15px}nav a{color:white;margin:0 15px;text-decoration:none}.container{max-width:1200px;margin:20px auto;padding:20px}table{background:white;width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #ddd}th{background:#f8f9fa}.btn{background:${s.primary_color};color:white;padding:8px 16px;text-decoration:none;border-radius:4px}form{background:white;padding:20px;border-radius:8px;margin-bottom:20px}input{padding:8px;margin:5px;border:1px solid #ddd;border-radius:4px}</style>
  </head><body>
  <nav><strong>${req.tenant.name}</strong><a href="/app">Dashboard</a><a href="/students">Students</a><a href="/logout">Logout</a></nav>
  <div class="container">
  <h1>Students</h1>
  <form method="POST" action="/students/add">
  <input name="name" placeholder="Full Name" required>
  <input name="class" placeholder="Class" required>
  <input name="dob" type="date" placeholder="DOB">
  <input name="guardian_name" placeholder="Guardian Name">
  <input name="guardian_phone" placeholder="Guardian Phone">
  <button type="submit" class="btn">Add Student</button>
  </form>
  <table><tr><th>Name</th><th>Class</th><th>Guardian</th><th>Phone</th><th>Balance</th><th>Actions</th></tr>
  ${students.rows.map(st => `<tr><td>${st.name}</td><td>${st.class}</td><td>${st.guardian_name || ''}</td><td>${st.guardian_phone || ''}</td><td>UGX ${st.balance}</td><td><a href="/students/delete/${st.id}" onclick="return confirm('Delete?')">Delete</a></td></tr>`).join('')}
  </table></div></body></html>`);
});

app.post('/students/add', requireLogin, requireTenant, async (req, res) => {
  const { name, class: cls, dob, guardian_name, guardian_phone } = req.body;
  await pool.query('INSERT INTO students (tenant_id, name, class, dob, guardian_name, guardian_phone) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.tenantId, name, cls, dob || null, guardian_name, guardian_phone]);
  res.redirect('/students');
});

app.get('/students/delete/:id', requireLogin, requireTenant, async (req, res) => {
  await pool.query('DELETE FROM students WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  res.redirect('/students');
});

app.get('/upgrade', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const main = await getSettings(1);
  if (!paypalEnabled) {
    return res.send(`<!DOCTYPE html><html><head><title>Upgrade Pending</title><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:#f4f6f9}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.1)}.btn{background:${s.primary_color};color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:20px}</style>
    </head><body><div class="card">
      <h1>⏳ Online Payments Pending</h1>
      <p>PayPal integration is being configured by the admin.</p>
      <p><strong>To upgrade now:</strong> Send UGX 50,000 to MoMo ${main.momo_number} (${main.momo_names})</p>
      <p>Then WhatsApp receipt to <a href="https://wa.me/${main.whatsapp_number}">${main.whatsapp_number}</a></p>
      <p>Your account will be upgraded within 1 hour.</p>
      <a href="/app" class="btn">Back to Dashboard</a>
    </div></body></html>`);
  }
  res.send(`<!DOCTYPE html><html><head><title>Upgrade</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:#f4f6f9}.card{background:white;padding:40px;border-radius:12px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.1)}.btn{background:${s.primary_color};color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:20px}</style>
  </head><body><div class="card">
    <h1>Upgrade to Premium</h1><p>UGX 50,000/month = $13.50</p>
    <p>Unlimited students, reports, marketplace, surveys</p>
    <form action="/paypal/create" method="POST"><button type="submit" class="btn">Pay with PayPal</button></form>
    <p style="margin-top:30px">Or pay via MoMo: ${main.momo_number} (${main.momo_names})<br>WhatsApp receipt to ${main.whatsapp_number}</p>
  </div></body></html>`);
});

app.post('/paypal/create', requireLogin, requireTenant, async (req, res) => {
  if (!paypalEnabled) return res.status(503).send('PayPal not configured');
  const create_payment_json = {
    intent: "sale",
    payer: { payment_method: "paypal" },
    redirect_urls: {
      return_url: `https://${req.headers.host}/paypal/success`,
      cancel_url: `https://${req.headers.host}/paypal/cancel`
    },
    transactions: [{
      item_list: { items: [{ name: "SSE Wasswa ERP Premium", sku: "001", price: "13.50", currency: "USD", quantity: 1 }] },
      amount: { currency: "USD", total: "13.50" },
      description: "SSE Wasswa ERP Premium Subscription"
    }]
  };
  paypal.payment.create(create_payment_json, (error, payment) => {
    if (error) return res.send('PayPal error');
    payment.links.forEach(link => {
      if (link.rel === 'approval_url') res.redirect(link.href);
    });
  });
});

app.get('/paypal/success', requireLogin, requireTenant, async (req, res) => {
  if (!paypalEnabled) return res.status(503).send('PayPal not configured');
  const { PayerID, paymentId } = req.query;
  const execute_payment_json = {
    payer_id: PayerID,
    transactions: [{ amount: { currency: "USD", total: "13.50" } }]
  };
  paypal.payment.execute(paymentId, execute_payment_json, async (error, payment) => {
    if (error) return res.send('Payment failed');
    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);
    await pool.query('UPDATE tenants SET plan = $1, plan_expires = $2 WHERE id = $3', ['premium', expires, req.tenantId]);
    res.send('Payment successful! Your account is now Premium. <a href="/app">Go to Dashboard</a>');
  });
});

app.get('/paypal/cancel', (req, res) => res.send('Payment cancelled. <a href="/upgrade">Try again</a>'));

app.get('/admin/settings', requireLogin, requireTenant, async (req, res) => {
  if (req.session.user.role!== 'admin' && req.session.user.role!== 'super_admin') return res.status(403).send('Forbidden');
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Settings</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}form{background:white;padding:30px;border-radius:8px}input,textarea{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:4px}button{background:#3498db;color:white;padding:12px 30px;border:none;border-radius:4px;cursor:pointer}label{display:block;margin-top:15px;font-weight:bold}h3{margin-top:30px;color:#2c3e50}</style>
  </head><body><form method="POST" action="/admin/settings">
  <h1>School Settings</h1>
  <label>Site Name</label><input name="site_name" value="${s.site_name}">
  <label>Hero Title</label><input name="hero_title" value="${s.hero_title}">
  <label>Hero Subtitle</label><input name="hero_subtitle" value="${s.hero_subtitle}">
  <label>WhatsApp Number</label><input name="whatsapp_number" value="${s.whatsapp_number}">
  <label>MoMo Number</label><input name="momo_number" value="${s.momo_number}">
  <label>MoMo Names</label><input name="momo_names" value="${s.momo_names}">
  <label>Paper Price (UGX)</label><input name="paper_price" type="number" value="${s.paper_price}">
  <label>Contact Email</label><input name="contact_email" value="${s.contact_email}">
  <label>Location</label><input name="location" value="${s.location}">
  <label>Primary Color</label><input name="primary_color" value="${s.primary_color}">
  <label><input type="checkbox" name="allow_marketplace" ${s.allow_marketplace? 'checked' : ''}> Enable Marketplace</label>
  <label><input type="checkbox" name="allow_surveys" ${s.allow_surveys? 'checked' : ''}> Enable Surveys</label>
  <h3>PayPal Integration</h3>
  <label>PayPal Client ID</label><input name="paypal_client_id" value="${s.paypal_client_id || ''}" placeholder="Paste from PayPal Developer Dashboard">
  <label>PayPal Client Secret</label><input name="paypal_client_secret" value="${s.paypal_client_secret || ''}" placeholder="Leave blank to disable PayPal">
  <p style="font-size:12px;color:#7f8c8d">Get keys: <a href="https://developer.paypal.com" target="_blank">developer.paypal.com</a> → Apps & Credentials</p>
  <button type="submit">Save Settings</button>
  </form></body></html>`);
});

app.post('/admin/settings', requireLogin, requireTenant, async (req, res) => {
  if (req.session.user.role!== 'admin' && req.session.user.role!== 'super_admin') return res.status(403).send('Forbidden');
  const { site_name, hero_title, hero_subtitle, whatsapp_number, momo_number, momo_names, paper_price, contact_email, location, primary_color, paypal_client_id, paypal_client_secret } = req.body;
  const allow_marketplace = req.body.allow_marketplace === 'on';
  const allow_surveys = req.body.allow_surveys === 'on';

  await pool.query(`INSERT INTO settings (tenant_id, site_name, hero_title, hero_subtitle, whatsapp_number, momo_names, paper_price, contact_email, location, primary_color, allow_marketplace, allow_surveys, paypal_client_id, paypal_client_secret)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (tenant_id) DO UPDATE SET
    site_name=$2, hero_title=$3, hero_subtitle=$4, whatsapp_number=$5, momo_number=$6, momo_names=$7, paper_price=$8, contact_email=$9, location=$10, primary_color=$11, allow_marketplace=$12, allow_surveys=$13, paypal_client_id=$14, paypal_client_secret=$15`,
    [req.tenantId, site_name, hero_title, hero_subtitle, whatsapp_number, momo_number, momo_names, paper_price, contact_email, location, primary_color, allow_marketplace, allow_surveys, paypal_client_id || null, paypal_client_secret || null]);

  await initPayPal();
  res.redirect('/admin/settings?saved=1');
});

if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://ssewasswa-api.onrender.com/health').catch(() => {});
  }, 14 * 60 * 1000);
}

initDB().then(() => {
  initPayPal();
  app.listen(PORT, () => console.log(`🚀 SSE Wasswa ERP running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
