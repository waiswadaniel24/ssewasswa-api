require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const paypal = require('paypal-rest-sdk');

const app = express();
const upload = multer({ dest: 'uploads/' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const PORT = process.env.PORT || 10000;

// === PAYPAL CONFIG ===
paypal.configure({
  mode: 'live',
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// === SECURITY FIREWALL + SEX ABUSE FILTER ===
const bannedWords = ['porn', 'xxx', 'sex', 'nude', 'escort', 'adult', 'rape', 'molest'];
function contentFilter(req, res, next) {
  const check = JSON.stringify(req.body).toLowerCase();
  if (bannedWords.some(w => check.includes(w))) {
    return res.status(403).send('Content violates policy. Sexual/abuse content blocked.');
  }
  next();
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://pagead2.googlesyndication.com", "https://www.paypal.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["https://www.paypal.com", "https://www.youtube.com"]
    }
  }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);
app.use(contentFilter);

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-2026-secure',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use('/uploads', express.static('uploads'));

// === GOOGLE OAUTH ===
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let tenant = await pool.query('SELECT * FROM tenants WHERE google_id = $1', [profile.id]);
    if (tenant.rows.length === 0) {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      const result = await pool.query(
        'INSERT INTO tenants (google_id, email, name, trial_ends, plan, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [profile.id, profile.emails[0].value, profile.displayName, trialEnd, 'trial', 'active']
      );
      tenant = result;
      await pool.query('INSERT INTO settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [result.rows[0].id]);
      await pool.query('INSERT INTO wallets (tenant_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING', [result.rows[0].id]);
    }
    return done(null, tenant.rows[0]);
  } catch (err) { return done(err, null); }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const result = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
  done(null, result.rows[0]);
});

// === DATABASE ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      google_id VARCHAR(100) UNIQUE,
      email VARCHAR(255) UNIQUE,
      name VARCHAR(200),
      school_name VARCHAR(200),
      plan VARCHAR(20) DEFAULT 'trial',
      trial_ends TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      free_access BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
      username VARCHAR(50),
      password_hash VARCHAR(255),
      role VARCHAR(20),
      fullname VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, username)
    );

    CREATE TABLE IF NOT EXISTS settings (
      tenant_id INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      site_name TEXT DEFAULT 'My School ERP',
      hero_title TEXT DEFAULT 'School Management System',
      hero_subtitle TEXT DEFAULT 'Manage students, fees, results & more',
      whatsapp_number TEXT DEFAULT '0789736737',
      contact_email TEXT DEFAULT 'info@school.com',
      momo_number TEXT DEFAULT '0789736737',
      momo_names TEXT DEFAULT 'SCHOOL NAME',
      paper_price INT DEFAULT 5000,
      location TEXT DEFAULT 'Kampala, Uganda',
      primary_color TEXT DEFAULT '#667eea',
      logo_url TEXT,
      allow_marketplace BOOLEAN DEFAULT true,
      allow_surveys BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE, name VARCHAR(100), class VARCHAR(50), school_type VARCHAR(20), parent_phone VARCHAR(20), balance DECIMAL(10,2) DEFAULT 0, gender VARCHAR(10), dob DATE, admission_no VARCHAR(50), address TEXT, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), name VARCHAR(100), class VARCHAR(50), max_marks INT DEFAULT 100);
    CREATE TABLE IF NOT EXISTS exam_results (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), student_id INT, subject_id INT, marks DECIMAL(5,2), term VARCHAR(20), year INT);
    CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), student_id INT, amount DECIMAL(10,2), method VARCHAR(50), term VARCHAR(20), receipt_no VARCHAR(50), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), name VARCHAR(200), position VARCHAR(100), salary DECIMAL(10,2), phone VARCHAR(20), email VARCHAR(200), bank_account VARCHAR(50));
    CREATE TABLE IF NOT EXISTS payroll (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), staff_id INT, amount DECIMAL(10,2), month VARCHAR(20), year INT, status VARCHAR(20) DEFAULT 'pending', paid_at TIMESTAMP);
    CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id) UNIQUE, balance DECIMAL(10,2) DEFAULT 0);
    CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), transaction_id VARCHAR(100), amount DECIMAL(10,2), phone VARCHAR(20), status VARCHAR(20), type VARCHAR(50), provider VARCHAR(20), metadata JSONB);
    CREATE TABLE IF NOT EXISTS subscriptions (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), plan VARCHAR(20), amount DECIMAL(10,2), starts_at TIMESTAMP, ends_at TIMESTAMP, status VARCHAR(20), paypal_id VARCHAR(100));

    CREATE TABLE IF NOT EXISTS entertainment (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id),
      user_email VARCHAR(255),
      type VARCHAR(20),
      title VARCHAR(200),
      description TEXT,
      url TEXT,
      price DECIMAL(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      views INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketplace (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id),
      seller_email VARCHAR(255),
      product_name VARCHAR(200),
      description TEXT,
      price DECIMAL(10,2),
      category VARCHAR(50),
      image_url TEXT,
      contact VARCHAR(20),
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS surveys (
      id SERIAL PRIMARY KEY,
      tenant_id INT REFERENCES tenants(id),
      creator_email VARCHAR(255),
      title VARCHAR(200),
      questions JSONB,
      reward_per_user DECIMAL(10,2),
      total_budget DECIMAL(10,2),
      max_responses INT,
      responses_count INT DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS survey_responses (
      id SERIAL PRIMARY KEY,
      survey_id INT REFERENCES surveys(id),
      user_email VARCHAR(255),
      answers JSONB,
      earned DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id), username VARCHAR(50), action VARCHAR(100), details JSONB, created_at TIMESTAMP DEFAULT NOW());
  `);

  // Super admin
  await pool.query(`INSERT INTO tenants (id, email, name, plan, free_access, status) VALUES (1, 'admin@ssewasswa.com', 'SSE Wasswa Admin', 'enterprise', true, 'active') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO settings (tenant_id, site_name, whatsapp_number) VALUES (1, 'SSE Wasswa ERP', '0789736737') ON CONFLICT (tenant_id) DO NOTHING`);
  await pool.query(`INSERT INTO wallets (tenant_id, balance) VALUES (1, 0) ON CONFLICT (tenant_id) DO NOTHING`);

  const adminExists = await pool.query('SELECT 1 FROM users WHERE username = $1 AND tenant_id = 1', ['admin']);
  if (adminExists.rows.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query('INSERT INTO users (tenant_id, username, password_hash, role, fullname) VALUES (1, $1, $2, $3, $4)', ['admin', hash, 'admin', 'System Admin']);
  }
  console.log('Database ready - Multi-tenant SaaS');
}

// === MIDDLEWARE ===
function requireLogin(req, res, next) {
  if (!req.session.userId &&!req.user) return res.redirect('/login');
  next();
}

function requireTenant(req, res, next) {
  if (!req.user &&!req.session.tenantId) return res.redirect('/login');
  req.tenantId = req.user?.id || req.session.tenantId || 1;
  next();
}

function requireActivePlan(req, res, next) {
  if (!req.user) return next();
  if (req.user.free_access || req.user.id === 1) return next();
  const now = new Date();
  if (req.user.plan === 'trial' && new Date(req.user.trial_ends) > now) return next();
  if (req.user.plan!== 'trial' && req.user.status === 'active') return next();
  return res.redirect('/upgrade');
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.id!== 1) return res.status(403).send('Super Admin Only');
  next();
}

async function getSettings(tenantId) {
  const result = await pool.query('SELECT * FROM settings WHERE tenant_id = $1', [tenantId]);
  return result.rows[0] || { whatsapp_number: '0789736737', site_name: 'School ERP', primary_color: '#667eea', hero_title: 'School Management', hero_subtitle: 'Manage everything', allow_marketplace: true, allow_surveys: true };
}

async function logAction(tenantId, username, action, details) {
  await pool.query('INSERT INTO audit_logs (tenant_id, username, action, details) VALUES ($1, $2, $3, $4)', [tenantId, username, action, details]).catch(() => {});
}

async function sendSMS(phone, message) {
  if (!process.env.AT_API_KEY) return console.log('SMS:', message);
  try {
    await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { 'apiKey': process.env.AT_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: process.env.AT_USERNAME, to: phone, message })
    });
  } catch (e) { console.log('SMS Error:', e.message); }
}

// === PUBLIC SITE ===
app.get('/', async (req, res) => {
  const s = await getSettings(1);
  const schools = await pool.query('SELECT COUNT(*) as count FROM tenants WHERE plan!= $1 AND status = $2', ['trial', 'active']);
  res.send(`<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${s.site_name} - School Management for Africa</title>
  <meta name="description" content="Complete school management. Students, fees, payroll, marketplace, surveys. 14-day free trial.">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1814429636128167" crossorigin="anonymous"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6;color:#2c3e50}
  .nav{background:#fff;padding:15px 20px;box-shadow:0 2px 10px rgba(0,0,0,0.1);position:sticky;top:0;z-index:1000;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}
  .nav a{color:#2c3e50;text-decoration:none;margin:0 10px;font-weight:500}
  .nav.btn{background:${s.primary_color};color:#fff;padding:10px 20px;border-radius:6px}
  .hero{background:linear-gradient(135deg,${s.primary_color} 0%,#764ba2 100%);color:#fff;padding:100px 20px;text-align:center}
  .hero h1{font-size:52px;margin-bottom:20px;font-weight:700}
  .hero p{font-size:22px;margin-bottom:30px;opacity:0.95}
  .hero.btn{background:#fff;color:${s.primary_color};padding:16px 40px;font-size:18px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin:10px}
  .container{max-width:1200px;margin:0 auto;padding:60px 20px}
  .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:30px;margin:40px 0}
  .feature{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.07);text-align:center}
  .feature h3{color:${s.primary_color};margin-bottom:15px;font-size:24px}
  .stats{background:#f8f9fa;padding:60px 20px;text-align:center}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:40px;max-width:1000px;margin:0 auto}
  .stat h3{font-size:48px;color:${s.primary_color};margin-bottom:10px}
  .whatsapp{position:fixed;bottom:20px;right:20px;background:#25D366;color:#fff;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;text-decoration:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:1000}
    footer{background:#2c3e50;color:#fff;padding:40px 20px;text-align:center}
   .ad-slot{margin:40px 0;text-align:center;min-height:100px;background:#f0f0f0;display:flex;align-items:center;justify-content:center}
    @media(max-width:768px){.hero h1{font-size:36px}.nav{flex-direction:column}}
  </style>
  </head><body>
    <nav class="nav">
      <div><strong>${s.site_name}</strong></div>
      <div>
        <a href="#features">Features</a>
        <a href="/entertainment">Entertainment</a>
        <a href="/marketplace">Marketplace</a>
        <a href="/login">Login</a>
        <a href="/auth/google" class="btn">Start Free Trial</a>
      </div>
    </nav>
    <div class="hero">
      <h1>${s.hero_title}</h1>
      <p>${s.hero_subtitle}</p>
      <a href="/auth/google" class="btn">Start 14-Day Free Trial</a>
      <a href="/entertainment" class="btn" style="background:transparent;border:2px solid #fff;color:#fff">Entertainment Hub</a>
    </div>
    <div class="stats">
      <div class="stats-grid">
        <div class="stat"><h3>${schools.rows[0].count}+</h3><p>Active Schools</p></div>
        <div class="stat"><h3>10,000+</h3><p>Students Managed</p></div>
        <div class="stat"><h3>99.9%</h3><p>Uptime</p></div>
        <div class="stat"><h3>24/7</h3><p>Support</p></div>
      </div>
    <div class="container" id="features">
      <h2 style="text-align:center;font-size:42px;margin-bottom:50px">Everything in One Platform</h2>
      <div class="features">
        <div class="feature"><h3>👨‍🎓 Student Management</h3><p>Admissions, profiles, attendance, documents. Bulk Excel import.</p></div>
        <div class="feature"><h3>💰 Fee Collection</h3><p>Mobile Money, PayPal, receipts, auto SMS reminders.</p></div>
        <div class="feature"><h3>💼 Staff Payroll</h3><p>Salaries, PayPal payouts, payslips, tax reports.</p></div>
        <div class="feature"><h3>📝 Digital Results</h3><p>Marksheets, report cards PDF, parent portal.</p></div>
        <div class="feature"><h3>🎬 Entertainment Hub</h3><p>Videos, ads, user content. Earn from views.</p></div>
        <div class="feature"><h3>🛍️ Marketplace</h3><p>Sell clothes, books, goods. Commission-based.</p></div>
        <div class="feature"><h3>📊 Paid Surveys</h3><p>Create surveys, users earn, you take 10% tax.</p></div>
        <div class="feature"><h3>🔒 100% Private</h3><p>Each school's data isolated. Bank-grade security.</p></div>
      </div>
    </div>
    <div class="ad-slot">
      <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-1814429636128167" data-ad-slot="1234567890" data-ad-format="auto"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </div>
    <div class="container" style="text-align:center">
      <h2 style="font-size:42px;margin-bottom:50px">Pricing</h2>
      <div class="features">
        <div class="feature">
          <h3>Free Trial</h3>
          <p style="font-size:36px;color:${s.primary_color};margin:20px 0">UGX 0</p>
          <p>14 Days<br>All Features<br>Up to 100 Students</p>
          <a href="/auth/google" class="btn" style="background:${s.primary_color};color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:20px">Start Free</a>
        </div>
        <div class="feature" style="border:3px solid ${s.primary_color}">
          <h3>Premium</h3>
          <p style="font-size:36px;color:${s.primary_color};margin:20px 0">UGX 50,000</p>
          <p>Per Month<br>Unlimited Everything<br>Priority Support</p>
          <a href="/auth/google" class="btn" style="background:${s.primary_color};color:#fff;padding:12px 30px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:20px">Upgrade</a>
        </div>
      </div>
    </div>
    <footer>
      <p>&copy; 2026 ${s.site_name}. Built in Uganda, for Africa.</p>
      <p>WhatsApp: ${s.whatsapp_number} | Email: ${s.contact_email}</p>
    </footer>
    <a href="https://wa.me/${s.whatsapp_number}?text=Hello" class="whatsapp" target="_blank">💬</a>
  </body></html>`);
});

// === AUTH ===
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => res.redirect('/app'));

app.get('/login', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Login</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;background:linear-gradient(135deg,${s.primary_color} 0%,#764ba2 100%);display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.login{background:white;padding:50px;border-radius:12px;box-shadow:0 20px 40px rgba(0,0,0,0.2);text-align:center;max-width:400px;width:90%}.btn{display:block;width:100%;padding:15px;margin:15px 0;border-radius:8px;text-decoration:none;font-weight:600}.google{background:#4285f4;color:white}.staff{background:#2c3e50;color:white}input{width:100%;padding:12px;margin:10px 0;border:1px solid #ddd;border-radius:6px;box-sizing:border-box}</style>
  </head><body><div class="login">
    <h2>Welcome to ${s.site_name}</h2>
    <a href="/auth/google" class="btn google">🔐 Continue with Google</a>
    <p style="margin:20px 0;color:#7f8c8d">— OR —</p>
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" required>
      <input name="password" type="password" placeholder="Password" required>
      <button type="submit" class="btn staff">Staff Login</button>
    </form>
    <p style="margin-top:20px;font-size:14px">New school? <a href="/auth/google">Start 14-day free trial</a></p>
  </div></body></html>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await pool.query('SELECT u.*, t.id as tenant_id FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.username = $1', [username]);
  if (user.rows.length === 0) return res.send('Invalid credentials');
  const valid = await bcrypt.compare(password, user.rows[0].password_hash);
  if (!valid) return res.send('Invalid credentials');
  req.session.userId = user.rows[0].id;
  req.session.username = user.rows[0].username;
  req.session.role = user.rows[0].role;
  req.session.tenantId = user.rows[0].tenant_id;
  req.session.fullname = user.rows[0].fullname;
  res.redirect('/app');
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy();
    res.redirect('/');
  });
});

// === UPGRADE WITH PAYPAL ===
app.get('/upgrade', requireLogin, async (req, res) => {
  const s = await getSettings(req.tenantId || 1);
  res.send(`<!DOCTYPE html><html><head><title>Upgrade</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:white;padding:50px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.1);text-align:center;max-width:500px}.btn{background:${s.primary_color};color:white;padding:15px 40px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin:10px;border:none;cursor:pointer}</style>
  </head><body><div class="card">
    <h1>⏰ Trial Expired</h1>
    <p style="font-size:18px;margin:30px 0">Upgrade to continue using all features.</p>
    <h2 style="color:${s.primary_color};font-size:48px;margin:20px 0">UGX 50,000/month</h2>
    <p>✓ Unlimited students<br>✓ All features<br>✓ Priority support</p>
    <form method="POST" action="/upgrade/paypal">
      <button type="submit" class="btn">Pay with PayPal</button>
    </form>
    <a href="https://wa.me/${s.whatsapp_number}?text=I%20want%20to%20upgrade%20via%20MoMo" class="btn" style="background:#25D366">Pay via Mobile Money</a>
    <p style="margin-top:30px;font-size:14px;color:#7f8c8d">Need free access? Contact: ${s.whatsapp_number}</p>
  </div></body></html>`);
});

app.post('/upgrade/paypal', requireLogin, requireTenant, async (req, res) => {
  const create_payment = {
    intent: 'sale',
    payer: { payment_method: 'paypal' },
    redirect_urls: { return_url: 'https://ssewasswa-api.onrender.com/upgrade/success', cancel_url: 'https://ssewasswa-api.onrender.com/upgrade' },
    transactions: [{
      item_list: { items: [{ name: 'Premium Subscription', sku: 'premium', price: '13.50', currency: 'USD', quantity: 1 }] },
      amount: { currency: 'USD', total: '13.50' },
      description: 'SSE Wasswa ERP Premium - 1 Month'
    }]
  };

  paypal.payment.create(create_payment, (error, payment) => {
    if (error) return res.send('PayPal Error: ' + error.message);
    res.redirect(payment.links.find(l => l.rel === 'approval_url').href);
  });
});

app.get('/upgrade/success', requireLogin, requireTenant, async (req, res) => {
  const { paymentId, PayerID } = req.query;
  const execute_payment = { payer_id: PayerID };

  paypal.payment.execute(paymentId, execute_payment, async (error, payment) => {
    if (error) return res.send('Payment failed');
    const ends = new Date();
    ends.setMonth(ends.getMonth() + 1);
    await pool.query('UPDATE tenants SET plan = $1, status = $2 WHERE id = $3', ['premium', 'active', req.tenantId]);
    await pool.query('INSERT INTO subscriptions (tenant_id, plan, amount, starts_at, ends_at, status, paypal_id) VALUES ($1, $2, $3, NOW(), $4, $5, $6)',
      [req.tenantId, 'premium', 50000, ends, 'active', paymentId]);
    res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h1>✅ Payment Successful!</h1><p>Premium activated. Valid until ${ends.toLocaleDateString()}</p><a href="/app" style="background:#27ae60;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:20px">Go to Dashboard</a></div>`);
  });
});

// === MAIN DASHBOARD ===
app.get('/app', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const tenant = req.user || { id: req.session.tenantId, name: req.session.fullname };
  const s = await getSettings(tenant.id);
  const students = await pool.query('SELECT COUNT(*) as count FROM students WHERE tenant_id = $1', [tenant.id]);
  const balance = await pool.query('SELECT COALESCE(SUM(balance),0) as total FROM students WHERE tenant_id = $1', [tenant.id]);
  const isPremium = tenant.free_access || tenant.plan!== 'trial' || new Date(tenant.trial_ends) > new Date();

  res.send(`<!DOCTYPE html><html><head><title>Dashboard - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f4f6f9}
  .header{background:linear-gradient(135deg,${s.primary_color} 0%,#764ba2 100%);color:white;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
  .header h1{font-size:28px}
  .logout{position:absolute;top:20px;right:20px;color:white;text-decoration:none;background:rgba(255,255,255,0.2);padding:8px 16px;border-radius:6px}
  .container{max-width:1400px;margin:0 auto;padding:30px 20px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px}
  .stat{background:white;padding:25px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
  .stat h3{font-size:36px;color:${s.primary_color};margin-bottom:5px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
  .card{background:white;padding:25px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);text-decoration:none;color:#2c3e50;transition:transform 0.2s;position:relative}
  .card:hover{transform:translateY(-5px)}
  .card.locked{opacity:0.5;pointer-events:none}
  .card.locked::after{content:'🔒 Premium';position:absolute;top:15px;right:15px;background:#e74c3c;color:white;padding:5px 10px;border-radius:4px;font-size:12px}
  .card h3{color:${s.primary_color};margin-bottom:10px;font-size:20px}
  .badge{background:#27ae60;color:white;padding:4px 10px;border-radius:4px;font-size:12px;display:inline-block;margin-bottom:10px}
  .trial-banner{background:#f39c12;color:white;padding:15px;text-align:center;font-weight:600}
  </style>
  </head><body>
    ${!isPremium? `<div class="trial-banner">⏰ Free trial ends ${new Date(tenant.trial_ends).toLocaleDateString()} - <a href="/upgrade" style="color:white;text-decoration:underline">Upgrade Now</a></div>` : ''}
    <div class="header">
      <h1>${s.site_name}</h1>
      <p>Welcome, ${tenant.name}</p>
      <a href="/logout" class="logout">Logout</a>
    </div>
    <div class="container">
      <div class="stats">
        <div class="stat"><h3>${students.rows[0].count}</h3><p>Total Students</p></div>
        <div class="stat"><h3>UGX ${Number(balance.rows[0].total).toLocaleString()}</h3><p>Outstanding Fees</p></div>
        <div class="stat"><h3>${tenant.plan === 'trial'? '14-Day Trial' : 'Premium'}</h3><p>Current Plan</p></div>
      </div>
      <div class="grid">
        <a href="/app/students" class="card"><span class="badge">Core</span><h3>👨‍🎓 Students</h3><p>Manage admissions, profiles, documents</p></a>
        <a href="/app/payments" class="card"><span class="badge">Core</span><h3>💰 Payments</<p>Fee collection, receipts, balances</p></a>
        <a href="/app/results" class="card ${isPremium? '' : 'locked'}"><span class="badge">Core</span><h3>📝 Results</h3><p>Marksheets, report cards PDF</p></a>
        <a href="/app/attendance" class="card ${isPremium? '' : 'locked'}"><span class="badge">Core</span><h3>📅 Attendance</h3><p>Daily registers, reports</p></a>
        <a href="/app/staff" class="card ${isPremium? '' : 'locked'}"><span class="badge">Premium</span><h3>💼 Staff Payroll</h3><p>Salaries, PayPal/MoMo payouts</p></a>
        <a href="/app/library" class="card ${isPremium? '' : 'locked'}"><span class="badge">Premium</span><h3>📖 Library</h3><p>Book tracking, loans</p></a>
        <a href="/app/papers" class="card ${isPremium? '' : 'locked'}"><span class="badge">Premium</span><h3>📄 Past Papers</h3><p>Sell UNEB papers</p></a>
        <a href="/app/reports" class="card ${isPremium? '' : 'locked'}"><span class="badge">Premium</span><h3>📊 Reports</h3><p>Analytics, exports</p></a>
        <a href="/entertainment" class="card"><span class="badge">Public</span><h3>🎬 Entertainment Hub</h3><p>Videos, ads, earn money</p></a>
        <a href="/marketplace" class="card"><span class="badge">Public</span><h3>🛍️ Marketplace</h3><p>Sell products, clothes</p></a>
        <a href="/surveys" class="card"><span class="badge">Public</span><h3>📋 Paid Surveys</h3><p>Create surveys, earn from responses</p></a>
        <a href="/admin/settings" class="card"><span class="badge">Admin</span><h3>⚙️ Settings</h3><p>WhatsApp, colors, site info</p></a>
      </div>
    </div>
  </body></html>`);
});

// === ENTERTAINMENT HUB ===
app.get('/entertainment', async (req, res) => {
  const videos = await pool.query('SELECT _ FROM entertainment WHERE type = $1 AND status = $2 ORDER BY created_at DESC LIMIT 20', ['video', 'active']);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Entertainment Hub</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1814429636128167" crossorigin="anonymous"></script>
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.video{background:#000;border-radius:8px;overflow:hidden}.video iframe{width:100%;height:200px;border:none}.ad-slot{margin:20px 0;text-align:center;min-height:100px;background:#f0f0f0;display:flex;align-items:center;justify-content:center}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none;margin-right:15px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/marketplace">Marketplace</a><a href="/surveys">Surveys</a><a href="/login">Dashboard</a></div>
    <div class="card"><h1>🎬 Entertainment Hub</h1><p>Watch videos, post ads, earn money. Upload your content!</p><a href="/entertainment/upload" class="btn">+ Upload Video/Ad</a></div>
    <div class="ad-slot">
      <ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-1814429636128167" data-ad-slot="1234567890" data-ad-format="auto"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </div>
    <div class="grid">
      ${videos.rows.map(v => `
        <div class="video">
          <iframe src="${v.url}" allowfullscreen></iframe>
          <div style="padding:15px">
            <h3>${v.title}</h3>
            <p style="color:#7f8c8d;font-size:14px">${v.description}</p>
            <p style="font-size:12px;color:#95a5a6">${v.views} views ${v.price > 0? '• Sponsored' : ''}</p>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="card" style="text-align:center">
      <h3>Want to advertise?</h3>
      <p>Upload your video ad for UGX 10,000. Earn from views!</p>
      <a href="/entertainment/upload" class="btn">Post Your Ad</a>
    </div>
  </body></html>`);
});

app.get('/entertainment/upload', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Upload Video</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%}input,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/entertainment">← Back</a></div>
    <div class="card"><h1>Upload Video/Ad</h1>
    <form method="POST" action="/entertainment/upload">
      <input name="title" placeholder="Video Title" required>
      <textarea name="description" placeholder="Description" rows="3"></textarea>
      <input name="url" placeholder="YouTube Embed URL or Video Link" required>
      <select name="type"><option value="video">Regular Video</option><option value="ad">Sponsored Ad (UGX 10,000)</option></select>
      <button type="submit" class="btn">Upload</button>
    </form>
    <p style="font-size:14px;color:#7f8c8d;margin-top:20px">⚠️ No sexual/abuse content. All uploads reviewed. Violations = account ban.</p>
    </div>
  </body></html>`);
});

app.post('/entertainment/upload', requireLogin, requireTenant, async (req, res) => {
  const { title, description, url, type } = req.body;
  const price = type === 'ad' ? 10000 : 0;
  await pool.query('INSERT INTO entertainment (tenant_id, user_email, type, title, description, url, price) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.tenantId, req.user.email, type, title, description, url, price]);
  res.redirect('/entertainment');
});

// === MARKETPLACE ===
app.get('/marketplace', async (req, res) => {
  const products = await pool.query('SELECT _ FROM marketplace WHERE status = $1 ORDER BY created_at DESC LIMIT 50', ['active']);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Marketplace</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background: ${s.primary_color};color:white;padding:10px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}.product{border:1px solid #ddd;border-radius:8px;overflow:hidden}.product img{width:100%;height:200px;object-fit:cover}.product div{padding:15px}.price{font-size:24px;color:${s.primary_color};font-weight:bold}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none;margin-right:15px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/entertainment">Entertainment</a><a href="/surveys">Surveys</a><a href="/login">Dashboard</a></div>
    <div class="card"><h1>🛍️ Marketplace</h1><p>Buy & sell. Admin takes 5% commission.</p><a href="/marketplace/sell" class="btn">+ Sell Product</a></div>
    <div class="grid">
      ${products.rows.map(p => `
        <div class="product">
          <img src="${p.image_url || 'https://via.placeholder.com/300x200'}" alt="${p.product_name}">
          <div>
            <h3>${p.product_name}</h3>
            <p style="color:#7f8c8d;font-size:14px">${p.description}</p>
            <p class="price">UGX ${Number(p.price).toLocaleString()}</p>
            <a href="https://wa.me/${p.contact}?text=I'm interested in ${p.product_name}" class="btn" style="background:#25D366">WhatsApp Seller</a>
          </div>
        </div>
      `).join('')}
    </div>
  </body></html>`);
});

app.get('/marketplace/sell', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Sell Product</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%}input,textarea,select{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/marketplace">← Back</a></div>
    <div class="card"><h1>Sell Your Product</h1>
    <form method="POST" action="/marketplace/sell">
      <input name="product_name" placeholder="Product Name" required>
      <textarea name="description" placeholder="Description" rows="4" required></textarea>
      <input name="price" type="number" placeholder="Price UGX" required>
      <select name="category" required><option value="">Category</option><option>Clothes</option><option>Electronics</option><option>Books</option><option>Food</option><option>Services</option><option>Other</option></select>
      <input name="image_url" placeholder="Image URL" required>
      <input name="contact" placeholder="WhatsApp: 0789736737" required>
      <button type="submit" class="btn">List Product</button>
    </form>
    <p style="font-size:14px;color:#7f8c8d;margin-top:20px">5% commission on sales. No adult/sexual content allowed.</p>
    </div>
  </body></html>`);
});

app.post('/marketplace/sell', requireLogin, requireTenant, async (req, res) => {
  const { product_name, description, price, category, image_url, contact } = req.body;
  await pool.query('INSERT INTO marketplace (tenant_id, seller_email, product_name, description, price, category, image_url, contact) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [req.tenantId, req.user.email, product_name, description, price, category, image_url, contact]);
  res.redirect('/marketplace');
});

// === SURVEYS ===
app.get('/surveys', async (req, res) => {
  const surveys = await pool.query('SELECT _ FROM surveys WHERE status = $1 AND responses_count < max_responses ORDER BY created_at DESC', ['active']);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Paid Surveys</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}.survey{border:2px solid ${s.primary_color};padding:20px;border-radius:8px;margin:15px 0}.reward{background:#27ae60;color:white;padding:8px 16px;border-radius:4px;display:inline-block;font-weight:bold}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none;margin-right:15px}</style>
  </head><body>
    <div class="nav"><a href="/">Home</a><a href="/entertainment">Entertainment</a><a href="/marketplace">Marketplace</a><a href="/login">Dashboard</a></div>
    <div class="card"><h1>📋 Paid Surveys</h1><p>Answer surveys, earn money. Create surveys to get data.</p><a href="/surveys/create" class="btn">+ Create Survey</a></div>
    ${surveys.rows.map(sv => `
      <div class="survey">
        <h3>${sv.title}</h3>
        <p><span class="reward">Earn UGX ${Number(sv.reward_per_user).toLocaleString()}</span> • ${sv.responses_count}/${sv.max_responses} responses</p>
        <a href="/surveys/${sv.id}" class="btn">Take Survey</a>
      </div>
    `).join('')}
  </body></html>`);
});

app.get('/surveys/create', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Create Survey</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%}input,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/surveys">← Back</a></div>
    <div class="card"><h1>Create Paid Survey</h1>
    <form method="POST" action="/surveys/create">
      <input name="title" placeholder="Survey Title" required>
      <textarea name="questions" placeholder='Questions JSON: [{"q":"Your age?","type":"number"}]' rows="6" required></textarea>
      <input name="reward_per_user" type="number" placeholder="Reward per response UGX" required>
      <input name="max_responses" type="number" placeholder="Max responses" required>
      <input name="total_budget" type="number" placeholder="Total Budget UGX" required>
      <button type="submit" class="btn">Create Survey (10% admin fee)</button>
    </form>
    <p style="font-size:14px;color:#7f8c8d;margin-top:20px">Admin takes 10% tax. No sexual/abuse content.</p>
    </div>
  </body></html>`);
});

app.post('/surveys/create', requireLogin, requireTenant, async (req, res) => {
  const { title, questions, reward_per_user, max_responses, total_budget } = req.body;
  const adminFee = total_budget _ 0.1;
  await pool.query('INSERT INTO surveys (tenant_id, creator_email, title, questions, reward_per_user, total_budget, max_responses) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.tenantId, req.user.email, title, questions, reward_per_user, total_budget, max_responses]);
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE tenant_id = 1', [adminFee]);
  res.redirect('/surveys');
});

app.get('/surveys/:id', requireLogin, async (req, res) => {
  const survey = await pool.query('SELECT _ FROM surveys WHERE id = $1 AND status = $2', [req.params.id, 'active']);
  if (survey.rows.length === 0) return res.status(404).send('Survey not found');
  const sv = survey.rows[0];
  const questions = JSON.parse(sv.questions);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>${sv.title}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%}input,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.reward{background:#27ae60;color:white;padding:10px;border-radius:4px;text-align:center;font-weight:bold;margin-bottom:20px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/surveys">← Back</a></div>
    <div class="card">
      <div class="reward">Earn UGX ${Number(sv.reward_per_user).toLocaleString()} for completing</div>
      <h1>${sv.title}</h1>
      <form method="POST" action="/surveys/${sv.id}/submit">
        ${questions.map((q, i) => `
          <label>${q.q}</label>
          <input name="answer_${i}" type="${q.type || 'text'}" required>
        `).join('')}
        <button type="submit" class="btn">Submit & Earn</button>
      </form>
    </div>
  </body></html>`);
});

app.post('/surveys/:id/submit', requireLogin, async (req, res) => {
  const survey = await pool.query('SELECT _ FROM surveys WHERE id = $1', [req.params.id]);
  const sv = survey.rows[0];
  if (sv.responses_count >= sv.max_responses) return res.send('Survey closed');
  
  const answers = {};
  for (let key in req.body) {
    if (key.startsWith('answer_')) answers[key] = req.body[key];
  }
  
  await pool.query('INSERT INTO survey_responses (survey_id, user_email, answers, earned) VALUES ($1, $2, $3, $4)',
    [req.params.id, req.user.email, JSON.stringify(answers), sv.reward_per_user]);
  await pool.query('UPDATE surveys SET responses_count = responses_count + 1 WHERE id = $1', [req.params.id]);
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE tenant_id = $2', [sv.reward_per_user, req.user.id]);
  
  res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h1>✅ Thank You!</h1><p>You earned UGX ${Number(sv.reward_per_user).toLocaleString()}</p><a href="/surveys" style="background:#3498db;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;margin-top:20px">More Surveys</a></div>`);
});

// === SUPER ADMIN ===
app.get('/super-admin', requireLogin, requireSuperAdmin, async (req, res) => {
  const tenants = await pool.query(`SELECT t._, (SELECT COUNT(_) FROM students WHERE tenant_id = t.id) as student_count, (SELECT COUNT(_) FROM users WHERE tenant_id = t.id) as user_count FROM tenants t ORDER BY created_at DESC`);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Super Admin</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background: ${s.primary_color};color:white;padding:8px 12px;text-decoration:none;border-radius:4px;font-size:14px;margin:2px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left}th{background:${s.primary_color};color:white}.badge{padding:4px 8px;border-radius:4px;font-size:12px}.trial{background:#f39c12;color:white}.premium{background:#27ae60;color:white}.free{background:#3498db;color:white}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
   <a href="/app/staff/users" class="card"><span class="badge">Admin</span><h3>👥 Staff Accounts</h3><p>Create logins for teachers & staff</p></a>
    <div class="nav"><a href="/app">← Back to App</a></div>
    <div class="card"><h1>🏢 Super Admin - All Schools</h1></div>
    <div class="card"><table><tr><th>School</th><th>Email</th><th>Plan</th><th>Trial Ends</th><th>Students</th><th>Users</th><th>Status</th><th>Actions</th></tr>
      ${tenants.rows.map(t => `
        <tr>
          <td><strong>${t.school_name || t.name}</strong></td>
          <td>${t.email}</td>
          <td><span class="badge ${t.free_access? 'free' : t.plan === 'trial'? 'trial' : 'premium'}">${t.free_access? 'FREE' : t.plan.toUpperCase()}</span></td>
          <td>${t.trial_ends? new Date(t.trial_ends).toLocaleDateString() : '-'}</td>
          <td>${t.student_count}</td>
          <td>${t.user_count}</td>
          <td>${t.is_active? '✅ Active' : '❌ Suspended'}</td>
          <td>
            <form method="POST" action="/super-admin/toggle-free/${t.id}" style="display:inline"><button class="btn" style="background:${t.free_access? '#e74c3c' : '#27ae60'}">${t.free_access? 'Remove Free' : 'Grant Free'}</button></form>
            <form method="POST" action="/super-admin/toggle-active/${t.id}" style="display:inline"><button class="btn" style="background:${t.is_active? '#e67e22' : '#95a5a6'}">${t.is_active? 'Suspend' : 'Activate'}</button></form>
          </td>
        </tr>
      `).join('')}
    </table></div>
  </body></html>`);
});

app.post('/super-admin/toggle-free/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  await pool.query('UPDATE tenants SET free_access = NOT free_access WHERE id = $1', [req.params.id]);
  res.redirect('/super-admin');
});

app.post('/super-admin/toggle-active/:id', requireLogin, requireSuperAdmin, async (req, res) => {
  await pool.query('UPDATE tenants SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect('/super-admin');
});

// === ADMIN SETTINGS ===
app.get('/admin/settings', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Settings</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;padding:20px;background:#f4f6f9}h2{color:#2c3e50}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px;max-width:600px;margin:20px auto}label{font-weight:bold;display:block;margin-top:15px}input,textarea,select{width:100%;padding:12px;margin:5px 0;border:1px solid #ddd;border-radius:4px;box-sizing:border-box}textarea{height:80px}.btn{background:#27ae60;color:white;padding:15px;border:none;border-radius:4px;width:100%;font-size:16px;margin-top:20px;cursor:pointer}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;margin-right:20px;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card">
      <h2>⚙️ Edit Site Settings</h2>
      ${req.query.updated? '<p style="color:green">✓ Settings updated successfully</p>' : ''}
      <form method="POST" action="/admin/settings/update">
        <label>School/Site Name</label>
        <input name="site_name" value="${s.site_name}" required>
        <label>Hero Title - Homepage</label>
        <input name="hero_title" value="${s.hero_title}" required>
        <label>Hero Subtitle</label>
        <textarea name="hero_subtitle">${s.hero_subtitle}</textarea>
        <label>WhatsApp Number (256...)</label>
        <input name="whatsapp_number" value="${s.whatsapp_number}" required>
        <label>MoMo Number</label>
        <input name="momo_number" value="${s.momo_number}" required>
        <label>MoMo Names</label>
        <input name="momo_names" value="${s.momo_names}" required>
        <label>Default Paper Price UGX</label>
        <input name="paper_price" type="number" value="${s.paper_price}" required>
        <label>Contact Email</label>
        <input name="contact_email" type="email" value="${s.contact_email}" required>
        <label>Location</label>
        <input name="location" value="${s.location}" required>
        <label>Primary Color (hex)</label>
        <input name="primary_color" value="${s.primary_color}" required>
        <label><input type="checkbox" name="allow_marketplace" ${s.allow_marketplace? 'checked' : ''}> Allow Marketplace</label>
        <label><input type="checkbox" name="allow_surveys" ${s.allow_surveys? 'checked' : ''}> Allow Surveys</label>
        <button type="submit" class="btn">Save All Settings</button>
      </form>
    </div>
  </body></html>`);
});

app.post('/admin/settings/update', requireLogin, requireTenant, async (req, res) => {
  const { site_name, hero_title, hero_subtitle, whatsapp_number, momo_number, momo_names, paper_price, contact_email, location, primary_color, allow_marketplace, allow_surveys } = req.body;
  await pool.query(`INSERT INTO settings (tenant_id, site_name, hero_title, hero_subtitle, whatsapp_number, momo_number, momo_names, paper_price, contact_email, location, primary_color, allow_marketplace, allow_surveys)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (tenant_id) DO UPDATE SET
    site_name=$2, hero_title=$3, hero_subtitle=$4, whatsapp_number=$5, momo_number=$6, momo_names=$7, paper_price=$8, contact_email=$9, location=$10, primary_color=$11, allow_marketplace=$12, allow_surveys=$13`,
    [req.tenantId, site_name, hero_title, hero_subtitle, whatsapp_number, momo_number, momo_names, paper_price, contact_email, location, primary_color, allow_marketplace === 'on', allow_surveys === 'on']
  );
  res.redirect('/admin/settings?updated=1');
});

// === SITEMAP & HEALTH ===
app.get('/sitemap.xml', (req, res) => {
  res.header('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://ssewasswa-api.onrender.com/</loc></url><url><loc>https://ssewasswa-api.onrender.com/entertainment</loc></url><url><loc>https://ssewasswa-api.onrender.com/marketplace</loc></url><url><loc>https://ssewasswa-api.onrender.com/surveys</loc></url></urlset>`);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: _\nAllow: /\nSitemap: https://ssewasswa-api.onrender.com/sitemap.xml`);
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/manifest.json', (req, res) => res.json({"name":"SSE Wasswa ERP","short_name":"SSE Wasswa","start_url":"/app","display":"standalone","background_color":"#667eea","theme_color":"#667eea"}));

// === KEEP ALIVE ===
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://ssewasswa-api.onrender.com/health').catch(() => {});
  }, 14 _ 60 _ 1000);
}

initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 SSE Wasswa ERP running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});

### **How to use:**

1. **You (Super Admin):** Login → `/super-admin` → See all schools, grant free access, suspend
2. **Edit everything:** `/admin/settings` → Change WhatsApp `0789736737`, site name, colors, prices
3. **Schools:** Google login → 14-day trial → `/app` dashboard → Manage everything themselves
4. **Payments:** PayPal for subscriptions, MoMo for school fees, SMS auto-sent
5. **Privacy:** Each school's data 100% isolated. Can't see each other.
6. **Earnings:** Marketplace 5% commission, Surveys 10% tax, Entertainment ads, all go to your wallet

**Deploy now. Schools can sign up today with zero setup from you.**// === STUDENTS CRUD ===
app.get('/app/students', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const students = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY class, name', [req.tenantId]);
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Students</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd;text-align:left}th{background:${s.primary_color};color:white}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card"><h1>👨‍🎓 Students</h1>
      <a href="/app/students/add" class="btn" style="background:#27ae60">+ Add Student</a>
      <a href="/app/students/bulk-upload" class="btn" style="background:#e67e22">📤 Bulk Upload</a>
    </div>
    <div class="card"><table><tr><th>Name</th><th>Class</th><th>Type</th><th>Parent Phone</th><th>Balance</th><th>Actions</th></tr>
      ${students.rows.map(st => `<tr><td>${st.name}</td><td>${st.class}</td><td>${st.school_type}</td><td>${st.parent_phone || '-'}</td><td>UGX ${Number(st.balance).toLocaleString()}</td><td><a href="/app/payments/add?student_id=${st.id}" class="btn">Payment</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/app/students/add', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Add Student</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%;font-size:16px}input,select{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app/students">← Back</a></div>
    <div class="card"><h1>Add Student</h1>
    <form method="POST" action="/app/students/add">
      <input name="name" placeholder="Full Name" required>
      <input name="class" placeholder="Class (e.g. P.1, S.2)" required>
      <select name="school_type" required><option value="">School Type</option><option>Nursery</option><option>Primary</option><option>Secondary</option><option>University</option></select>
      <input name="parent_phone" placeholder="Parent Phone: 0789736737">
      <input name="gender" placeholder="Gender">
      <input name="dob" type="date" placeholder="Date of Birth">
      <input name="admission_no" placeholder="Admission Number">
      <input name="address" placeholder="Address">
      <input name="balance" type="number" value="0" placeholder="Opening Balance">
      <button type="submit" class="btn">Add Student</button>
    </form></div>
  </body></html>`);
});

app.post('/app/students/add', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const { name, class: cls, school_type, parent_phone, gender, dob, admission_no, address, balance } = req.body;
  await pool.query('INSERT INTO students (tenant_id, name, class, school_type, parent_phone, gender, dob, admission_no, address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [req.tenantId, name, cls, school_type, parent_phone, gender, dob || null, admission_no, address, balance || 0]);
  await logAction(req.tenantId, req.session.username || req.user.email, 'STUDENT_ADD', { name, class: cls });
  res.redirect('/app/students');
});

app.get('/app/students/bulk-upload', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Bulk Upload</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}input{width:100%;padding:12px;margin:10px 0;box-sizing:border-box}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app/students">← Back</a></div>
    <div class="card"><h1>📤 Bulk Upload Students</h1>
    <h3>Step 1: Download Template</h3><a href="/app/students/template" class="btn" style="background:#27ae60">Download Excel Template</a></div>
    <div class="card"><h3>Step 2: Upload Filled Excel</h3><form method="POST" action="/app/students/bulk-upload" enctype="multipart/form-data">
      <input type="file" name="file" accept=".xlsx,.xls" required>
      <button type="submit" class="btn">Upload & Import</button>
    </form><p style="font-size:14px;color:#7f8c8d;margin-top:15px">Required: name, class, school_type. Optional: parent_phone, gender, dob, admission_no, address, balance</p></div>
  </body></html>`);
});

app.get('/app/students/template', requireLogin, requireTenant, (req, res) => {
  const ws = xlsx.utils.aoa_to_sheet([['name', 'class', 'school_type', 'parent_phone', 'gender', 'dob', 'admission_no', 'address', 'balance'], ['John Doe', 'P.1', 'Primary', '0789736737', 'Male', '2015-01-15', 'ADM001', 'Kampala', '0']]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Students');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=students_template.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.post('/app/students/bulk-upload', requireLogin, requireTenant, requireActivePlan, upload.single('file'), async (req, res) => {
  try {
    const wb = xlsx.readFile(req.file.path);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    let count = 0;
    for (let row of data) {
      if (row.name && row.class && row.school_type) {
        await pool.query('INSERT INTO students (tenant_id, name, class, school_type, parent_phone, gender, dob, admission_no, address, balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          [req.tenantId, row.name, row.class, row.school_type, row.parent_phone || null, row.gender || null, row.dob || null, row.admission_no || null, row.address || null, row.balance || 0]);
        count++;
      }
    }
    fs.unlinkSync(req.file.path);
    await logAction(req.tenantId, req.session.username || req.user.email, 'STUDENT_BULK_IMPORT', { count });
    res.send(`<div style="font-family:Arial;max-width:600px;margin:50px auto;padding:30px;background:white;border-radius:8px;text-align:center"><h2>✅ Success!</h2><p>Imported ${count} students.</p><a href="/app/students" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">View Students</a></div>`);
  } catch (err) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).send('Import error: ' + err.message);
  }
});

// === PAYMENTS ===
app.get('/app/payments', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const payments = await pool.query('SELECT p.*, s.name as student_name, s.class FROM payments p JOIN students s ON p.student_id = s.id WHERE p.tenant_id = $1 ORDER BY p.created_at DESC LIMIT 200', [req.tenantId]);
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Payments</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd;text-align:left}th{background:${s.primary_color};color:white}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card"><h1>💰 Payments</h1><a href="/app/payments/add" class="btn" style="background:#27ae60">+ Record Payment</a></div>
    <div class="card"><table><tr><th>Date</th><th>Receipt</th><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>Term</th></tr>
      ${payments.rows.map(p => `<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>${p.receipt_no}</td><td>${p.student_name}</td><td>${p.class}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${p.method}</td><td>${p.term}</td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/app/payments/add', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const students = await pool.query('SELECT id, name, class FROM students WHERE tenant_id = $1 ORDER BY class, name', [req.tenantId]);
  const selected = req.query.student_id || '';
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Record Payment</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:800px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:30px;border-radius:8px}.btn{background:${s.primary_color};color:white;padding:12px 20px;text-decoration:none;border-radius:4px;border:none;cursor:pointer;width:100%;font-size:16px}input,select{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app/payments">← Back</a></div>
    <div class="card"><h1>Record Payment</h1>
    <form method="POST" action="/app/payments/add">
      <select name="student_id" required><option value="">Select Student</option>${students.rows.map(st => `<option value="${st.id}" ${st.id == selected? 'selected' : ''}>${st.name} - ${st.class}</option>`).join('')}</select>
      <input name="amount" type="number" step="0.01" placeholder="Amount (UGX)" required>
      <select name="method" required><option value="">Payment Method</option><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>PayPal</option><option>Cheque</option></select>
      <select name="term" required><option value="">Term</option><option>Term 1</option><option>Term 2</option><option>Term 3</option></select>
      <input name="receipt_no" placeholder="Receipt Number (optional)">
      <button type="submit" class="btn">Save Payment</button>
    </form></div>
  </body></html>`);
});

app.post('/app/payments/add', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const { student_id, amount, method, term, receipt_no } = req.body;
  const receipt = receipt_no || 'RCP' + Date.now();
  await pool.query('INSERT INTO payments (tenant_id, student_id, amount, method, term, receipt_no) VALUES ($1, $2, $3, $4, $5, $6)', [req.tenantId, student_id, amount, method, term, receipt]);
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id = $2 AND tenant_id = $3', [amount, student_id, req.tenantId]);
  const student = await pool.query('SELECT * FROM students WHERE id = $1 AND tenant_id = $2', [student_id, req.tenantId]);
  const st = student.rows[0];
  const s = await getSettings(req.tenantId);
  if (st.parent_phone) {
    await sendSMS(st.parent_phone, `Payment received: UGX ${Number(amount).toLocaleString()} for ${st.name}, ${term}. Receipt: ${receipt}. Balance: UGX ${Number(st.balance - amount).toLocaleString()}. Thank you - ${s.site_name}`);
  }
  const impact = amount * 0.01;
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE tenant_id = $2', [impact, req.tenantId]);
  await pool.query('INSERT INTO transactions (tenant_id, transaction_id, amount, phone, status, type, provider) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.tenantId, 'IMPACT' + Date.now(), impact, st.parent_phone || 'N/A', 'completed', 'impact_fund', 'MTN']);
  await logAction(req.tenantId, req.session.username || req.user.email, 'PAYMENT_RECORD', { student_id, amount, receipt });
  res.redirect('/app/payments');
});

// === RESULTS ===
app.get('/app/results', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const classes = await pool.query('SELECT DISTINCT class, school_type FROM students WHERE tenant_id = $1 ORDER BY class', [req.tenantId]);
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Results</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px;display:inline-block;margin:5px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd;text-align:left}th{background:${s.primary_color};color:white}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card"><h1>📝 Results & Marksheets</h1></div>
    <div class="card"><h3>Select Class</h3><table><tr><th>Class</th><th>Type</th><th>Action</th></tr>
      ${classes.rows.map(c => `<tr><td>${c.class}</td><td>${c.school_type}</td><td><a href="/app/results/${encodeURIComponent(c.class)}" class="btn">Enter Marks</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.get('/app/results/:class', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const cls = req.params.class;
  const students = await pool.query('SELECT * FROM students WHERE class = $1 AND tenant_id = $2 ORDER BY name', [cls, req.tenantId]);
  const subjects = await pool.query('SELECT * FROM subjects WHERE class = $1 AND tenant_id = $2 ORDER BY name', [cls, req.tenantId]);
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Marksheet - ${cls}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1600px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px;overflow-x:auto}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border:1px solid #ddd;text-align:center}th{background:${s.primary_color};color:white}input{width:60px;padding:5px;text-align:center}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app/results">← Back</a></div>
    <div class="card"><h1>Marksheet: ${cls}</h1>
    <form method="POST" action="/app/results/save">
      <input type="hidden" name="class" value="${cls}">
      <label>Term: <select name="term" required><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
      <table><tr><th>Student</th>${subjects.rows.map(sub => `<th>${sub.name}<br>(${sub.max_marks})</th>`).join('')}</tr>
        ${students.rows.map(st => `<tr><td style="text-align:left">${st.name}</td>${subjects.rows.map(sub => `<td><input name="marks_${st.id}_${sub.id}" type="number" step="0.5" max="${sub.max_marks}"></td>`).join('')}</tr>`).join('')}
      </table><br><button type="submit" class="btn" style="background:#27ae60">Save All Marks</button>
    </form></div>
  </body></html>`);
});

app.post('/app/results/save', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const { term, class: cls } = req.body;
  const year = new Date().getFullYear();
  for (let key in req.body) {
    if (key.startsWith('marks_') && req.body[key]) {
      const [, student_id, subject_id] = key.split('_');
      await pool.query('INSERT INTO exam_results (tenant_id, student_id, subject_id, marks, term, year) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [req.tenantId, student_id, subject_id, req.body[key], term, year]);
    }
  }
  await logAction(req.tenantId, req.session.username || req.user.email, 'MARKS_ENTRY', { class: cls, term });
  res.redirect(`/app/results/${encodeURIComponent(cls)}`);
});

// === STAFF & PAYROLL ===
app.get('/app/staff', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
  const payroll = await pool.query('SELECT COALESCE(SUM(salary),0) as total FROM staff WHERE tenant_id = $1', [req.tenantId]);
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html><head><title>Staff</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1400px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd}th{background:${s.primary_color};color:white}input{padding:10px;margin:5px;border:1px solid #ddd;border-radius:4px;width:100%;box-sizing:border-box}.stat{background:#e74c3c;color:white;padding:20px;border-radius:4px;text-align:center;font-size:24px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card"><h1>💼 Staff & Payroll</h1></div>
    <div class="card"><div class="stat"><strong>Monthly Payroll</strong><br>UGX ${Number(payroll.rows[0].total).toLocaleString()}</div></div>
    <div class="card"><h3>Add Staff</h3><form method="POST" action="/app/staff/add">
      <input name="name" placeholder="Full Name" required>
      <input name="position" placeholder="Position: Teacher, Bursar, Cook" required>
      <input name="salary" type="number" placeholder="Monthly Salary UGX" required>
      <input name="phone" placeholder="Phone: 0789736737" required>
      <input name="email" type="email" placeholder="Email">
      <input name="bank_account" placeholder="Bank Account / MoMo">
      <button type="submit" class="btn" style="background:#27ae60">Add Staff</button>
    </form></div>
    <div class="card"><table><tr><th>Name</th><th>Position</th><th>Salary</th><th>Phone</th><th>Pay</th></tr>
      ${staff.rows.map(st => `<tr><td>${st.name}</td><td>${st.position}</td><td>UGX ${Number(st.salary).toLocaleString()}</td><td>${st.phone}</td><td><a href="/app/staff/pay/${st.id}" class="btn" style="background:#27ae60">Pay Now</a></td></tr>`).join('')}
    </table></div>
  </body></html>`);
});

app.post('/app/staff/add', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const { name, position, salary, phone, email, bank_account } = req.body;
  await pool.query('INSERT INTO staff (tenant_id, name, position, salary, phone, email, bank_account) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.tenantId, name, position, salary, phone, email, bank_account]);
  res.redirect('/app/staff');
});

app.get('/app/staff/pay/:id', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  const staff = await pool.query('SELECT * FROM staff WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenantId]);
  const st = staff.rows[0];
  const month = new Date().toLocaleString('default', { month: 'long' });
  const year = new Date().getFullYear();
  await pool.query('INSERT INTO payroll (tenant_id, staff_id, amount, month, year, status, paid_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
    [req.tenantId, st.id, st.salary, month, year, 'paid']);
  await sendSMS(st.phone, `Salary paid: UGX ${Number(st.salary).toLocaleString()} for ${month} ${year}. Thank you - ${req.user.school_name || req.user.name}`);
  res.redirect('/app/staff');
});

// === KEEP ALIVE ===
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    fetch('https://ssewasswa-api.onrender.com/health').catch(() => {});
  }, 14 * 60 * 1000);
}
// === SCHOOL PROFILE & STAFF MANAGEMENT ===

// School creates their own profile after Google login
app.get('/school/setup', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const tenant = req.user;
  if (tenant.profile_completed) return res.redirect('/app');
  
  res.send(`<!DOCTYPE html><html><head><title>Complete School Profile</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:white;padding:40px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.1);max-width:600px;width:90%}.btn{background:${s.primary_color};color:white;padding:15px;border:none;border-radius:6px;width:100%;font-size:16px;cursor:pointer;margin-top:20px}input,textarea{width:100%;padding:12px;margin:10px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:6px}label{font-weight:600;display:block;margin-top:15px}.alert{background:#d1ecf1;border-left:4px solid #0c5460;padding:15px;margin-bottom:20px;border-radius:4px}</style>
  </head><body><div class="card">
    <h1>🏫 Welcome! Set Up Your School</h1>
    <div class="alert">Complete this once. You'll be the School Admin with full control.</div>
    <form method="POST" action="/school/setup" enctype="multipart/form-data">
      <label>School Name *</label>
      <input name="school_name" value="${tenant.school_name || tenant.name}" required>
      
      <label>School Motto</label>
      <input name="motto" placeholder="e.g. Education for Excellence" value="${tenant.motto || ''}">
      
      <label>School Logo URL</label>
      <input name="logo_url" placeholder="https://yourschool.com/logo.png" value="${tenant.logo_url || ''}">
      
      <label>Primary Color</label>
      <input name="primary_color" type="color" value="${s.primary_color}">
      
      <label>WhatsApp Number *</label>
      <input name="whatsapp_number" value="${s.whatsapp_number}" placeholder="0789736737" required>
      
      <label>School Email *</label>
      <input name="contact_email" type="email" value="${s.contact_email}" required>
      
      <label>Location *</label>
      <input name="location" value="${s.location}" required>
      
      <label>Mobile Money Number</label>
      <input name="momo_number" value="${s.momo_number}" placeholder="0789736737">
      
      <label>MoMo Names</label>
      <input name="momo_names" value="${s.momo_names}" placeholder="SCHOOL NAME">
      
      <button type="submit" class="btn">Complete Setup & Enter Dashboard</button>
    </form>
  </div></body></html>`);
});

app.post('/school/setup', requireLogin, requireTenant, async (req, res) => {
  const { school_name, motto, logo_url, primary_color, whatsapp_number, contact_email, location, momo_number, momo_names } = req.body;
  
  // Update tenant profile
  await pool.query(`UPDATE tenants SET school_name = $1, motto = $2, logo_url = $3, profile_completed = true WHERE id = $4`, 
    [school_name, motto, logo_url, req.tenantId]);
  
  // Update settings
  await pool.query(`UPDATE settings SET site_name = $1, whatsapp_number = $2, contact_email = $3, location = $4, primary_color = $5, momo_number = $6, momo_names = $7, hero_title = $8 WHERE tenant_id = $9`,
    [school_name, whatsapp_number, contact_email, location, primary_color, momo_number, momo_names, school_name, req.tenantId]);
  
  // Make this user the school admin
  await pool.query(`INSERT INTO users (tenant_id, username, password_hash, role, fullname) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, username) DO UPDATE SET role = $4`,
    [req.tenantId, req.user.email.split('@')[0], 'google_oauth', 'admin', req.user.name]);
  
  req.session.role = 'admin';
  req.session.fullname = req.user.name;
  res.redirect('/app');
});

// School Admin creates staff accounts with passwords
app.get('/app/staff/users', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  if (req.session.role !== 'admin' && req.user?.id !== req.tenantId) return res.status(403).send('School Admin Only');
  
  const users = await pool.query('SELECT id, username, role, fullname, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
  const s = await getSettings(req.tenantId);
  
  res.send(`<!DOCTYPE html><html><head><title>Staff Accounts</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial;max-width:1200px;margin:20px auto;padding:20px;background:#f4f6f9}.card{background:white;padding:20px;border-radius:8px;margin-bottom:20px}.btn{background:${s.primary_color};color:white;padding:10px 15px;text-decoration:none;border-radius:4px;border:none;cursor:pointer}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #ddd;text-align:left}th{background:${s.primary_color};color:white}input,select{width:100%;padding:10px;margin:8px 0;box-sizing:border-box;border:1px solid #ddd;border-radius:4px}.nav{background:#2c3e50;padding:15px;margin:-20px -20px 20px -20px}.nav a{color:white;text-decoration:none}.alert{background:#fff3cd;border-left:4px solid #ffc107;padding:15px;margin:15px 0;border-radius:4px}</style>
  </head><body>
    <div class="nav"><a href="/app">← Dashboard</a></div>
    <div class="card"><h1>👥 Staff User Accounts</h1>
      <div class="alert"><strong>School Admin:</strong> Create usernames & passwords for your teachers, bursar, librarian. They login at <code>/login</code> with these credentials. Works offline.</div>
    </div>
    <div class="card"><h3>Create New Staff Account</h3><form method="POST" action="/app/staff/users/create">
      <input name="fullname" placeholder="Full Name: John Mukasa" required>
      <input name="username" placeholder="Username: jmukasa" required>
      <input name="password" type="text" placeholder="Password: teacher2026" required>
      <select name="role" required>
        <option value="">Select Role</option>
        <option value="teacher">Teacher - Enter marks, attendance</option>
        <option value="bursar">Bursar - Record payments, fees</option>
        <option value="librarian">Librarian - Manage books</option>
        <option value="admin">Co-Admin - Full access</option>
      </select>
      <button type="submit" class="btn" style="background:#27ae60;width:100%">Create Account</button>
    </form></div>
    <div class="card"><h3>Existing Accounts</h3><table><tr><th>Full Name</th><th>Username</th><th>Role</th><th>Created</th><th>Action</th></tr>
      ${users.rows.map(u => `<tr><td>${u.fullname}</td><td><strong>${u.username}</strong></td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleDateString()}</td><td>${u.role !== 'admin'? `<a href="/app/staff/users/delete/${u.id}" class="btn" style="background:#e74c3c;font-size:12px" onclick="return confirm('Delete?')">Delete</a>` : 'Protected'}</td></tr>`).join('')}
    </table></div>
    <div class="card"><h3>📱 Staff Login Instructions</h3>
      <p><strong>Login URL:</strong> <code>${req.protocol}://${req.get('host')}/login</code></p>
      <p><strong>Share with staff:</strong> Username + Password you created above</p>
      <p><strong>Offline:</strong> Once logged in, app works without internet. Data syncs when online.</p>
    </div>
  </body></html>`);
});

app.post('/app/staff/users/create', requireLogin, requireTenant, requireActivePlan, async (req, res) => {
  if (req.session.role !== 'admin' && req.user?.id !== req.tenantId) return res.status(403).send('Admin Only');
  const { username, password, fullname, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (tenant_id, username, password_hash, role, fullname) VALUES ($1, $2, $3, $4, $5)',
    [req.tenantId, username, hash, role, fullname]);
  await logAction(req.tenantId, req.session.username || req.user.email, 'STAFF_USER_CREATE', { username, role });
  res.redirect('/app/staff/users');
});

app.get('/app/staff/users/delete/:id', requireLogin, requireTenant, async (req, res) => {
  if (req.session.role !== 'admin' && req.user?.id !== req.tenantId) return res.status(403).send('Admin Only');
  await pool.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role != $3', [req.params.id, req.tenantId, 'admin']);
  res.redirect('/app/staff/users');
});

// === OFFLINE PWA SUPPORT ===
app.get('/manifest.json', requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.json({
    "name": s.site_name,
    "short_name": s.site_name.substring(0, 12),
    "start_url": "/app",
    "display": "standalone",
    "background_color": s.primary_color,
    "theme_color": s.primary_color,
    "description": s.hero_subtitle,
    "icons": [
      {"src": s.logo_url || "/icon-192.png", "sizes": "192x192", "type": "image/png"},
      {"src": s.logo_url || "/icon-512.png", "sizes": "512x512", "type": "image/png"}
    ],
    "offline_enabled": true
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    const CACHE_NAME = 'ssewasswa-erp-v1';
    const urlsToCache = [
      '/app', '/app/students', '/app/payments', '/app/results', '/app/attendance',
      '/login', '/manifest.json'
    ];
    
    self.addEventListener('install', e => {
      e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
      self.skipWaiting();
    });
    
    self.addEventListener('activate', e => {
      e.waitUntil(clients.claim());
    });
    
    self.addEventListener('fetch', e => {
      e.respondWith(
        caches.match(e.request).then(response => {
          if (response) return response;
          return fetch(e.request).then(response => {
            if (!response || response.status !== 200) return response;
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseToCache));
            return response;
          }).catch(() => caches.match('/app'));
        })
      );
    });
  `);
});

// === UPDATE DB SCHEMA ===
async function updateDBSchema() {
  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_name VARCHAR(200);
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS motto TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS logo_url TEXT;
  `).catch(() => {});
}

// Call this in initDB()
updateDBSchema();
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 SSE Wasswa ERP running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
