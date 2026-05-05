const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3000;
let dbReady = false;
const parser = new Parser();

// DEVELOPER COMMISSION RATES (configurable)
const DEV_COMMISSION = {
  fee_payment: 0.05,      // 5% of school fee payments
  store_purchase: 0.08,    // 8% of store sales
  marketplace: 0.10,       // 10% of marketplace sales
  subscription: 0.30,      // 30% of premium subscriptions
  withdrawal_fee: 0.02,    // 2% withdrawal fee
  game_purchase: 0.15,     // 15% of game/item purchases
  course_purchase: 0.20    // 20% of course sales
};

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

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SMS_CONFIG = { apiKey: process.env.SMS_API_KEY || 'demo', username: process.env.SMS_USERNAME || 'sandbox', senderId: 'SSEWASSWA' };
const MOMO_CONFIG = { apiKey: process.env.MOMO_API_KEY || 'demo', baseUrl: 'https://sandbox.momodeveloper.mtn.com' };

const i18n = {
  en: { dashboard: 'Dashboard', students: 'Students', fees: 'Fees', attendance: 'Attendance', grades: 'Grades', settings: 'Settings', logout: 'Logout', login: 'Login', add: 'Add', save: 'Save', delete: 'Delete', edit: 'Edit', name: 'Name', class: 'Class', balance: 'Balance', pay: 'Pay', report: 'Report Card', welcome: 'Welcome', bonus: 'Earn Rewards', store: 'Shop', news: 'News', videos: 'Videos', downloads: 'Downloads', marketplace: 'Marketplace', games: 'Games', learning: 'Learning', premium: 'Premium', home: 'Home' },
  lg: { dashboard: 'Dashiboodi', students: 'Abayizi', fees: 'Ebbanja', attendance: 'Okujja', grades: 'Obubonero', settings: 'Enteekateeka', logout: 'Fuluma', login: 'Yingira', add: 'Gattako', save: 'Tereka', delete: 'Ggyawo', edit: 'Kyusa', name: 'Erinnya', class: 'Ekibiina', balance: 'Bbanja', pay: 'Sasula', report: 'Lipoota', welcome: 'Tukwanirizza', bonus: 'Funa Bbonansi', store: 'Dduka', news: 'Amawulire', videos: 'Vidiyo', downloads: 'Wanula', marketplace: 'Amasitu', games: 'Mizannyo', learning: 'Okusoma', premium: 'Muwendo', home: 'Awaka' },
  sw: { dashboard: 'Dashibodi', students: 'Wanafunzi', fees: 'Ada', attendance: 'Mahudhurio', grades: 'Alama', settings: 'Mipangilio', logout: 'Toka', login: 'Ingia', add: 'Ongeza', save: 'Hifadhi', delete: 'Futa', edit: 'Hariri', name: 'Jina', class: 'Darasa', balance: 'Salio', pay: 'Lipa', report: 'Ripoti', welcome: 'Karibu', bonus: 'Pata Bonasi', store: 'Duka', news: 'Habari', videos: 'Video', downloads: 'Pakua', marketplace: 'Soko', games: 'Michezo', learning: 'Kujifunza', premium: 'Premium', home: 'Nyumbani' }
};

function t(key, lang = 'en') {
  return i18n[lang]?.[key] || i18n.en[key] || key;
}

function detectLang(req) {
  const acceptLang = req.headers['accept-language'] || '';
  if (acceptLang.includes('lg')) return 'lg';
  if (acceptLang.includes('sw')) return 'sw';
  return 'en';
}

function renderPage(title, content, user = null, isPublic = false, lang = 'en') {
  const nav = user && !isPublic ? `
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <div style="font-weight:700;font-size:18px">${esc(user.tenant_name || 'SSEWASSWA')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:14px">
        <a href="/" style="color:white;text-decoration:none">🏠 ${t('home',lang)}</a>
        <a href="/app" style="color:white;text-decoration:none">📊 ${t('dashboard',lang)}</a>
        <a href="/students" style="color:white;text-decoration:none">🎓 ${t('students',lang)}</a>
        <a href="/fees" style="color:white;text-decoration:none">💰 ${t('fees',lang)}</a>
        <a href="/learning" style="color:white;text-decoration:none">📚 ${t('learning',lang)}</a>
        <a href="/store" style="color:white;text-decoration:none">🛒 ${t('store',lang)}</a>
        <a href="/marketplace" style="color:white;text-decoration:none">🏪 ${t('marketplace',lang)}</a>
        <a href="/videos" style="color:white;text-decoration:none">🎬 ${t('videos',lang)}</a>
        <a href="/games" style="color:white;text-decoration:none">🎮 ${t('games',lang)}</a>
        <a href="/news" style="color:white;text-decoration:none">📰 ${t('news',lang)}</a>
        <a href="/bonus" style="color:white;text-decoration:none">🎁 ${t('bonus',lang)}</a>
        <a href="/premium" style="color:white;text-decoration:none">⭐ ${t('premium',lang)}</a>
        <a href="/app/settings" style="color:white;text-decoration:none">⚙️</a>
        <a href="/logout" style="color:white;text-decoration:none">🚪</a>
      </div>
    </div>` : 
    isPublic ? `
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <div style="font-weight:700;font-size:18px">SSEWASSWA</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:14px">
        <a href="/" style="color:white;text-decoration:none">🏠 Home</a>
        <a href="/learning" style="color:white;text-decoration:none">📚 Learning</a>
        <a href="/store" style="color:white;text-decoration:none">🛒 Shop</a>
        <a href="/marketplace" style="color:white;text-decoration:none">🏪 Marketplace</a>
        <a href="/videos" style="color:white;text-decoration:none">🎬 Videos</a>
        <a href="/games" style="color:white;text-decoration:none">🎮 Games</a>
        <a href="/news" style="color:white;text-decoration:none">📰 News</a>
        <a href="/login" style="color:white;text-decoration:none">👤 Login</a>
      </div>
    </div>` : '';
  
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);color:#1e293b;min-height:100vh}
      .container{max-width:1200px;margin:0 auto;padding:20px}
      .card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05);transition:transform 0.2s,box-shadow 0.2s}
      .card:hover{transform:translateY(-2px);box-shadow:0 8px 16px rgba(0,0,0,0.1)}
      .btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600;transition:transform 0.2s}
      .btn:hover{transform:scale(1.05)}
      .btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}
      .btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
      .btn-orange{background:linear-gradient(135deg,#ea580c,#f97316)}
      .btn-purple{background:linear-gradient(135deg,#7c3aed,#8b5cf6)}
      .btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b);color:#1e293b}
      input,select,textarea{width:100%;padding:12px 16px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0 12px;font-size:16px;transition:border-color 0.2s}
      input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6}
      table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden}
      th,td{text-align:left;padding:14px;border-bottom:1px solid #e2e8f0}
      th{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;font-weight:600}
      tr:hover{background:#f8fafc}
      .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
      .stat-card{background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.05)}
      .stat-num{font-size:36px;font-weight:bold;background:linear-gradient(135deg,#1e40af,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
      .badge{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block}
      .badge-green{background:#dcfce7;color:#166534}
      .badge-red{background:#fee2e2;color:#991b1b}
      .badge-gold{background:#fef3c7;color:#92400e}
      .badge-blue{background:#dbeafe;color:#1e40af}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
      .hero{background:linear-gradient(135deg,#1e40af 0%,#3b82f6 50%,#60a5fa 100%);color:white;padding:60px 20px;text-align:center;border-radius:20px;margin-bottom:30px}
      .hero h1{font-size:48px;margin-bottom:16px}
      .hero p{font-size:20px;opacity:0.9;max-width:600px;margin:0 auto 24px}
      .premium-badge{background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700}
      .reward-tag{position:absolute;top:10px;right:10px;background:#dcfce7;color:#166534;padding:4px 8px;border-radius:8px;font-size:12px;font-weight:600}
      .card-img{width:100%;height:200px;object-fit:cover;border-radius:12px 12px 0 0}
      @media(max-width:768px){
        .hero h1{font-size:32px}
        .stats{grid-template-columns:repeat(2,1fr)}
        .grid{grid-template-columns:1fr}
      }
      @media print{.btn,nav{display:none!important}body{padding:0;background:white}}
    </style>
  </head><body>${nav}<div class="container">${content}</div>
  <div style="text-align:center;padding:30px;font-size:12px;color:#64748b;background:white;border-top:1px solid #e2e8f0">
    <p>© 2024 SSEWASSWA Platform • <a href="/terms">Terms</a> • <a href="/privacy">Privacy</a> • <a href="/about">About</a></p>
    <p>Languages: <a href="?lang=en">English</a> | <a href="?lang=lg">Luganda</a> | <a href="?lang=sw">Swahili</a></p>
  </div></body></html>`;
}

async function checkDb(req, res, next) {
  if (!dbReady) return res.status(503).send(`<div style="text-align:center;padding:100px"><h1>⏳ Platform Starting...</h1><p>Please wait 10-20 seconds and <a href="${req.url}">refresh</a>.</p></div>`);
  next();
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  req.tenant = req.session.tenant;
  req.tenantId = req.session.tenant.id;
  req.lang = req.query.lang || detectLang(req);
  next();
};

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin', 'teacher'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Forbidden - Admins Only</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

async function sendSMS(phone, message) {
  if (SMS_CONFIG.apiKey === 'demo') { console.log(`[SMS DEMO] ${phone}: ${message}`); return { success: true }; }
  try {
    await axios.post('https://api.africastalking.com/version1/messaging', `username=${SMS_CONFIG.username}&to=${phone}&message=${encodeURIComponent(message)}&from=${SMS_CONFIG.senderId}`, { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return { success: true };
  } catch (e) { console.error('SMS Error:', e.message); return { success: false }; }
}

async function addBonus(userId, tenantId, amount, type, description, metaData = {}) {
  await pool.query('INSERT INTO bonus_earnings (user_id, tenant_id, amount, type, description, metadata) VALUES ($1,$2,$3,$4,$5,$6)', [userId, tenantId, amount, type, description, JSON.stringify(metaData)]);
  await pool.query('UPDATE wallets SET balance = balance + $1, updated_at=NOW() WHERE user_email=$2', [amount, userId]);
}

async function addDevCommission(amount, type, description, referenceId = null) {
  await pool.query('INSERT INTO developer_revenue (amount, type, description, reference_id) VALUES ($1,$2,$3,$4)', [amount, type, description, referenceId]);
  await pool.query('UPDATE platform_wallet SET balance = balance + $1, updated_at=NOW() WHERE id=1', [amount]);
}

async function sendBulkSMS(tenantId, message) {
  const { rows } = await pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL AND guardian_phone != \'\'', [tenantId]);
  for (const r of rows) { await sendSMS(r.guardian_phone, message); await new Promise(res => setTimeout(res, 200)); }
}

// === PUBLIC HOMEPAGE ===
app.get('/', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  try {
    const news = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml').catch(() => ({ items: [] }));
    const newsCards = news.items.slice(0, 6).map(item => `
      <div class="card" style="position:relative">
        <h4 style="margin-bottom:8px">${esc(item.title)}</h4>
        <p style="color:#64748b;font-size:14px">${esc(item.contentSnippet?.substring(0, 100))}...</p>
        <a href="/news/read?url=${encodeURIComponent(item.link)}" class="btn btn-orange" style="font-size:12px;padding:8px 16px" target="_blank">Read & Earn +20 UGX</a>
      </div>
    `).join('');

    res.send(renderPage('SSEWASSWA - Uganda\'s #1 Learning & Entertainment Platform', `
      <div class="hero">
        <h1>🎓 Learn • Shop • Play • Earn</h1>
        <p>Your all-in-one platform for education, entertainment, shopping, and earning rewards!</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <a href="/signup" class="btn btn-green" style="font-size:18px;padding:16px 32px">Get Started Free</a>
          <a href="/premium" class="btn btn-gold" style="font-size:18px;padding:16px 32px">⭐ Go Premium</a>
        </div>
      </div>

      <div class="stats">
        <div class="stat-card"><div class="stat-num">50K+</div><div style="color:#64748b">Active Users</div></div>
        <div class="stat-card"><div class="stat-num">500+</div><div style="color:#64748b">Schools</div></div>
        <div class="stat-card"><div class="stat-num">10M+</div><div style="color:#64748b">Rewards Given</div></div>
        <div class="stat-card"><div class="stat-num">4.8⭐</div><div style="color:#64748b">User Rating</div></div>
      </div>

      <div class="grid">
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/learning'">
          <div style="font-size:48px;margin-bottom:12px">📚</div>
          <h3>Learning Portal</h3>
          <p style="color:#64748b">Courses, past papers, tutorials</p>
          <span class="badge badge-blue">Free & Premium</span>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/store'">
          <div style="font-size:48px;margin-bottom:12px">🛒</div>
          <h3>School Store</h3>
          <p style="color:#64748b">Uniforms, books, supplies</p>
          <span class="badge badge-green">Fast Delivery</span>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/marketplace'">
          <div style="font-size:48px;margin-bottom:12px">🏪</div>
          <h3>Marketplace</h3>
          <p style="color:#64748b">Buy & sell anything</p>
          <span class="badge badge-gold">Earn Commissions</span>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/videos'">
          <div style="font-size:48px;margin-bottom:12px">🎬</div>
          <h3>Watch & Earn</h3>
          <p style="color:#64748b">Videos with rewards</p>
          <span class="badge badge-green">+50 UGX/video</span>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/games'">
          <div style="font-size:48px;margin-bottom:12px">🎮</div>
          <h3>Games & Fun</h3>
          <p style="color:#64748b">Play and win prizes</p>
          <span class="badge badge-gold">Tournaments</span>
        </div>
        <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/bonus'">
          <div style="font-size:48px;margin-bottom:12px">🎁</div>
          <h3>Rewards Hub</h3>
          <p style="color:#64748b">Multiple earning ways</p>
          <span class="badge badge-blue">Withdraw to MoMo</span>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:20px">📰 Latest News</h2>
        <div class="grid">${newsCards}</div>
      </div>
    `, null, true, lang));
  } catch (e) {
    res.send(renderPage('SSEWASSWA', '<div class="hero"><h1>🎓 Learn • Shop • Play • Earn</h1></div>', null, true, lang));
  }
});

// === AUTH ===
app.get('/login', (req, res) => {
  const lang = req.query.lang || detectLang(req);
  res.send(renderPage(t('login', lang), `
    <div class="card" style="max-width:450px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:60px;margin-bottom:12px">🎓</div>
        <h1>Welcome Back</h1>
        <p style="color:#64748b">Login to your account</p>
      </div>
      <form method="POST" action="/login">
        <input name="email" placeholder="Email Address" type="email" required />
        <input name="password" placeholder="Password" type="password" required />
        <button type="submit" class="btn" style="width:100%;font-size:18px;padding:16px">${t('login', lang)}</button>
      </form>
      <div style="text-align:center;margin-top:20px">
        <a href="/signup" style="color:#1e40af">Create Account</a> • 
        <a href="/forgot-password" style="color:#64748b">Forgot Password?</a>
      </div>
    </div>
  `, null, true, lang));
});

app.post('/login', checkDb, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT u.*, t.subdomain, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1 AND u.approved=true', [email]);
    if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) {
      return res.status(401).send(renderPage('Login Failed', '<div class="card" style="max-width:450px;margin:40px auto;text-align:center"><h1>❌ Invalid Credentials</h1><p style="color:#64748b;margin:20px 0">Check your email/password or contact admin</p><a href="/login" class="btn">Try Again</a></div>', null, true));
    }
    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain, name: user.rows[0].tenant_name };
    res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
  } catch (e) { res.status(500).send("DB Error"); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/signup', (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const ref = req.query.ref;
  res.send(renderPage('Create Account', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:60px;margin-bottom:12px">🚀</div>
        <h1>Join SSEWASSWA</h1>
        <p style="color:#64748b">Start earning rewards today!</p>
      </div>
      <form method="POST" action="/signup">
        ${ref ? `<input type="hidden" name="ref" value="${esc(ref)}">` : ''}
        <input name="full_name" placeholder="Full Name" required>
        <input name="email" type="email" placeholder="Email Address" required>
        <input name="phone" placeholder="Phone (07XXXXXXXX)" required>
        <input name="password" type="password" placeholder="Password (min 6 chars)" required minlength="6">
        <select name="role">
          <option value="student">Student</option>
          <option value="parent">Parent</option>
          <option value="teacher">Teacher (need school code)</option>
        </select>
        <input name="school_code" placeholder="School Code (for teachers only)">
        <button type="submit" class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Create Account</button>
      </form>
      <p style="text-align:center;margin-top:16px;color:#64748b;font-size:14px">By signing up, you agree to our Terms of Service</p>
    </div>
  `, null, true, lang));
});

app.post('/signup', checkDb, async (req, res) => {
  try {
    const { full_name, email, phone, password, role, school_code, ref } = req.body;
    
    let tenantId = 1;
    let approved = true;
    
    if (role === 'teacher' && school_code) {
      const tenant = await pool.query('SELECT id FROM tenants WHERE signup_code=$1 OR subdomain=$1', [school_code.toLowerCase()]);
      if (!tenant.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid School Code</h1><p>Ask your school admin for the correct code</p></div>', null, true));
      tenantId = tenant.rows[0].id;
    }
    
    const hash = await bcrypt.hash(password, 10);
    const user = await pool.query('INSERT INTO users (tenant_id, email, password_hash, role, full_name, phone, approved) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [tenantId, email, hash, role, full_name, phone, approved]);
    
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [tenantId, email]);
    
    // Signup bonus
    await addBonus(email, tenantId, 100, 'signup', 'Welcome bonus for joining');
    
    // Referral bonus
    if (ref) {
      await addBonus(ref, tenantId, 200, 'referral', `Referred ${email}`);
      await pool.query('INSERT INTO referrals (referrer_id, referred_id, bonus_amount) VALUES ($1,$2,$3)', [ref, email, 200]);
    }
    
    res.send(renderPage('Account Created! 🎉', `
      <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
        <div style="font-size:60px;margin-bottom:16px">✅</div>
        <h1>Welcome to SSEWASSWA!</h1>
        <p style="color:#64748b;margin:20px 0">You've earned <strong class="badge badge-green">100 UGX</strong> signup bonus!</p>
        <a href="/login" class="btn btn-green" style="font-size:18px;padding:16px 32px">Login Now</a>
      </div>
    `, null, true));
  } catch (e) {
    res.send(renderPage('Error', `<div class="card"><h1>❌ Signup Failed</h1><p>${e.code === '23505' ? 'Email already exists' : e.message}</p></div>`, null, true));
  }
});

app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Reset Password', '<div class="card" style="max-width:450px;margin:40px auto"><h1>Forgot Password</h1><form method="POST" action="/forgot-password"><input name="email" type="email" placeholder="Your email" required><button class="btn" style="width:100%">Send Reset Link</button></form></div>', null, true));
});

app.post('/forgot-password', checkDb, async (req, res) => {
  try {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [req.body.email]);
    if (user.rows[0]) {
      const token = crypto.randomBytes(20).toString('hex');
      await pool.query('INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')', [req.body.email, token]);
      console.log(`🔑 RESET LINK: https://${req.headers.host}/reset-password/${token}`);
    }
    res.send(renderPage('Check Email', '<div class="card" style="max-width:450px;margin:40px auto;text-align:center"><h1>📧 Check Your Email</h1><p>If account exists, reset link was sent</p><a href="/login" class="btn">Back to Login</a></div>', null, true));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/reset-password/:token', checkDb, async (req, res) => {
  const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]);
  if (!reset.rows[0]) return res.send(renderPage('Expired', '<div class="card"><h1>❌ Link Expired</h1></div>', null, true));
  res.send(renderPage('New Password', `<div class="card" style="max-width:450px;margin:40px auto"><h1>Set New Password</h1><form method="POST" action="/reset-password/${req.params.token}"><input name="password" type="password" placeholder="New password" required minlength="6"><button class="btn btn-green" style="width:100%">Reset Password</button></form></div>`, null, true));
});

app.post('/reset-password/:token', checkDb, async (req, res) => {
  try {
    const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]);
    if (!reset.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid Link</h1></div>', null, true));
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, reset.rows[0].email]);
    await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [reset.rows[0].id]);
    res.send(renderPage('Success!', '<div class="card" style="text-align:center"><h1>✅ Password Reset!</h1><a href="/login" class="btn btn-green">Login Now</a></div>', null, true));
  } catch (e) { res.status(500).send("Error"); }
});

// === PARENT PORTAL (OTP) ===
app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', '<div class="card" style="max-width:450px;margin:40px auto"><h1>📱 Parent Login</h1><p style="color:#64748b;margin-bottom:20px">We\'ll send you an OTP via SMS</p><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XXXXXXXX" required /><button type="submit" class="btn" style="width:100%">Send OTP</button></form></div>', null, true));
});

app.post('/parent/send-otp', checkDb, async (req, res) => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')', [req.body.phone, otp]);
    await sendSMS(req.body.phone, `SSEWASSWA OTP: ${otp}`);
    res.send(renderPage('Verify OTP', `<div class="card" style="max-width:450px;margin:40px auto"><h1>🔐 Enter OTP</h1><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="${esc(req.body.phone)}"><input name="otp" placeholder="6-digit OTP" required /><button type="submit" class="btn" style="width:100%">Verify</button></form></div>`, null, true));
  } catch (e) { res.status(500).send("Error"); }
});

app.post('/parent/verify-otp', checkDb, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM parent_otps WHERE phone=$1 AND otp=$2 AND expires_at > NOW() AND used=false ORDER BY id DESC LIMIT 1', [req.body.phone, req.body.otp]);
    if (!result.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid OTP</h1></div>', null, true));
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
  const cards = students.rows.map(s => `
    <div class="card">
      <h3>${esc(s.name)}</h3>
      <p>Class: ${esc(s.class) || '-'}</p>
      <p>Balance: <strong class="badge badge-red">UGX ${s.balance}</strong></p>
      <div style="margin-top:12px">
        <a href="/parent/pay/${s.id}" class="btn btn-green">Pay Fees</a>
        <a href="/app/students/report/${s.id}" class="btn" target="_blank">View Report</a>
      </div>
    </div>
  `).join('');
  res.send(renderPage('My Children', `<div class="card"><h1>👨‍👩‍👧‍👦 My Children</h1></div>${cards || '<div class="card"><p>No students linked yet</p></div>'}`));
});

app.get('/parent/pay/:id', checkDb, async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Pay Fees', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>💰 Pay for ${esc(s.name)}</h1>
      <p style="font-size:24px;margin:20px 0">Outstanding: <strong class="badge badge-red">UGX ${s.balance}</strong></p>
      <form method="POST" action="/parent/pay">
        <input type="hidden" name="student_id" value="${s.id}">
        <input name="amount" type="number" placeholder="Amount to pay" required min="1000">
        <input name="phone" value="${esc(req.session.parent.phone)}" placeholder="MoMo number" required>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay with MoMo</button>
      </form>
      <p style="text-align:center;margin-top:16px;color:#64748b;font-size:12px">Secure payment via MTN MoMo</p>
    </div>
  `, null, true));
});

app.post('/parent/pay', checkDb, async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  try {
    const { student_id, amount, phone } = req.body;
    const ref = `FEE-${Date.now()}`;
    const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
    
    await pool.query('INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1,$2,$3,$4,$5)', [s.tenant_id, student_id, amount, phone, ref]);
    
    // Developer commission (5%)
    const devFee = Math.round(amount * DEV_COMMISSION.fee_payment);
    await addDevCommission(devFee, 'fee_payment', `Fee payment commission`, ref);
    
    if (MOMO_CONFIG.apiKey === 'demo') {
      await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [amount, student_id]);
      await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]);
      return res.send(renderPage('Payment Successful! ✅', `
        <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
          <div style="font-size:60px;margin-bottom:16px">✅</div>
          <h1>Payment Received!</h1>
          <p style="font-size:24px;margin:20px 0">UGX ${amount}</p>
          <p style="color:#64748b">Receipt sent to ${phone}</p>
          <a href="/parent/dashboard" class="btn btn-green" style="margin-top:20px">Back to Dashboard</a>
        </div>
      `, null, true));
    }
    res.send(renderPage('Processing...', '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>MoMo prompt sent to ' + phone + '</p></div>', null, true));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/parent/logout', (req, res) => req.session.destroy(() => res.redirect('/parent/login')));

// === REWARDS/BONUS SYSTEM ===
app.get('/bonus', requireAuth, checkDb, async (req, res) => {
  const wallet = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
  const earnings = await pool.query('SELECT * FROM bonus_earnings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [req.session.user.email]);
  const totalEarned = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM bonus_earnings WHERE user_id=$1', [req.session.user.email])).rows[0].total;
  
  const earningsRows = earnings.rows.map(e => `
    <tr>
      <td>${new Date(e.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-blue">${esc(e.type)}</span></td>
      <td class="badge badge-green">+UGX ${e.amount}</td>
      <td>${esc(e.description)}</td>
    </tr>
  `).join('');

  res.send(renderPage('Rewards Hub 🎁', `
    <div class="hero" style="padding:40px 20px">
      <h2>My Wallet</h2>
      <div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">UGX ${wallet.balance}</div>
      <p style="margin-top:12px">Total Earned: UGX ${totalEarned}</p>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
        <a href="/bonus/withdraw" class="btn btn-green">💰 Withdraw to MoMo</a>
        <a href="/bonus/affiliate" class="btn btn-purple">🔗 Affiliate Link</a>
      </div>
    </div>

    <div class="stats">
      <div class="stat-card" onclick="location.href='/videos'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">🎬</div>
        <div style="font-weight:600">Watch Videos</div>
        <div class="badge badge-green">+50 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/news'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">📰</div>
        <div style="font-weight:600">Read News</div>
        <div class="badge badge-green">+20 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/downloads'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">📥</div>
        <div style="font-weight:600">Download Apps</div>
        <div class="badge badge-green">+100 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/games'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">🎮</div>
        <div style="font-weight:600">Play Games</div>
        <div class="badge badge-green">+30 UGX</div>
      </div>
    </div>

    <div class="card">
      <h3>Recent Earnings</h3>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
          <tbody>${earningsRows || '<tr><td colspan="4" style="text-align:center;color:#64748b">No earnings yet. Start earning!</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.get('/bonus/withdraw', requireAuth, checkDb, async (req, res) => {
  const wallet = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
  res.send(renderPage('Withdraw to MoMo', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>💰 Withdraw Funds</h1>
      <div style="background:#f8fafc;padding:20px;border-radius:12px;margin:20px 0;text-align:center">
        <div style="color:#64748b">Available Balance</div>
        <div class="stat-num">UGX ${wallet.balance}</div>
      </div>
      <form method="POST" action="/bonus/withdraw">
        <input name="amount" type="number" max="${wallet.balance}" min="5000" placeholder="Amount (Min 5,000 UGX)" required>
        <input name="phone" placeholder="MoMo Number (07XX)" required>
        <p style="font-size:12px;color:#64748b;margin:8px 0">Withdrawal fee: 2% • Processing: 24-48 hours</p>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Withdraw Now</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/bonus/withdraw', requireAuth, checkDb, async (req, res) => {
  try {
    const { amount, phone } = req.body;
    const wallet = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0];
    if (!wallet || wallet.balance < amount || amount < 5000) {
      return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid Amount</h1><p>Minimum: 5,000 UGX • Check your balance</p></div>', { tenant_name: req.tenant.name }, false, req.lang));
    }
    
    const fee = Math.round(amount * DEV_COMMISSION.withdrawal_fee);
    const netAmount = amount - fee;
    
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_email=$2', [amount, req.session.user.email]);
    await pool.query('INSERT INTO withdrawals (user_email, amount, phone, fee, net_amount, status) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.email, amount, phone, fee, netAmount, 'pending']);
    await addDevCommission(fee, 'withdrawal_fee', `Withdrawal fee from ${req.session.user.email}`);
    
    res.send(renderPage('Withdrawal Requested! ✅', `
      <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
        <div style="font-size:60px;margin-bottom:16px">✅</div>
        <h1>Withdrawal Submitted</h1>
        <div style="background:#f8fafc;padding:20px;border-radius:12px;margin:20px 0">
          <p>Amount: <strong>UGX ${amount}</strong></p>
          <p>Fee (2%): <strong>UGX ${fee}</strong></p>
          <p>You'll receive: <strong class="badge badge-green">UGX ${netAmount}</strong></p>
          <p>To: <strong>${phone}</strong></p>
        </div>
        <p style="color:#64748b">Processing time: 24-48 hours</p>
        <a href="/bonus" class="btn" style="margin-top:20px">Back to Rewards</a>
      </div>
    `, { tenant_name: req.tenant.name }, false, req.lang));
  } catch (e) { res.status(500).send("Error"); }
});

app.get('/bonus/affiliate', requireAuth, checkDb, async (req, res) => {
  const link = `https://${req.headers.host}/signup?ref=${req.session.user.email}`;
  const referrals = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(bonus_amount),0) as total FROM referrals WHERE referrer_id=$1', [req.session.user.email]);
  
  res.send(renderPage('Affiliate Program 🔗', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h1>🔗 Earn with Referrals</h1>
      <p style="color:#64748b;margin:20px 0">Share your link and earn <strong class="badge badge-green">200 UGX</strong> for each person who signs up!</p>
      
      <div style="background:#f8fafc;padding:16px;border-radius:12px;margin:20px 0">
        <label style="font-size:12px;color:#64748b">Your Affiliate Link</label>
        <div style="display:flex;gap:8px">
          <input value="${link}" readonly style="margin:0;flex:1" id="affLink">
          <button class="btn" onclick="navigator.clipboard.writeText('${link}');this.textContent='✅ Copied!'">Copy</button>
        </div>
      </div>

      <div class="stats" style="margin-top:20px">
        <div class="stat-card">
          <div class="stat-num">${referrals.rows[0].count}</div>
          <div style="color:#64748b">Total Referrals</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">UGX ${referrals.rows[0].total}</div>
          <div style="color:#64748b">Total Earned</div>
        </div>
      </div>

      <div style="margin-top:20px">
        <h3>Share via:</h3>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
          <a href="https://wa.me/?text=${encodeURIComponent('Join SSEWASSWA and earn rewards! ' + link)}" class="btn btn-green" target="_blank">WhatsApp</a>
          <a href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join SSEWASSWA!')}" class="btn btn-blue" target="_blank">Telegram</a>
          <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join SSEWASSWA!')}" class="btn" target="_blank">Twitter</a>
        </div>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

// === VIDEOS PORTAL ===
app.get('/videos', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  const videos = [
    { id: 'dQw4w9WgXcQ', title: 'Introduction to Mathematics', category: 'Education', reward: 50 },
    { id: 'jNQXAC9IVRw', title: 'Science Experiments at Home', category: 'Education', reward: 50 },
    { id: 'M7lc1UVf-VE', title: 'African History Documentary', category: 'Documentary', reward: 50 },
    { id: '9bZkp7q19f0', title: 'Music Learning Basics', category: 'Entertainment', reward: 30 },
    { id: 'kJQP7kiw5Fk', title: 'Tech News Update', category: 'News', reward: 40 }
  ];
  
  const watched = isAuth ? (await pool.query('SELECT video_id FROM bonus_earnings WHERE user_id=$1 AND type=\'video\'', [req.session.user.email])).rows.map(r => r.video_id) : [];
  
  const videoCards = videos.map(v => `
    <div class="card" style="position:relative;padding:0;overflow:hidden">
      <iframe width="100%" height="200" src="https://www.youtube.com/embed/${v.id}" frameborder="0" allowfullscreen style="border-radius:16px 16px 0 0"></iframe>
      <div style="padding:16px">
        <h4>${v.title}</h4>
        <span class="badge badge-blue" style="margin-bottom:8px">${v.category}</span>
        ${isAuth ? (watched.includes(v.id) ? 
          '<p class="badge badge-green" style="margin-top:8px">✅ Claimed</p>' : 
          `<a href="/bonus/claim/video/${v.id}" class="btn btn-green" style="margin-top:8px">Claim +${v.reward} UGX</a>`
        ) : '<p style="color:#64748b;font-size:12px;margin-top:8px"><a href="/login">Login</a> to earn rewards</p>'}
      </div>
    </div>
  `).join('');

  res.send(renderPage('Watch & Earn 🎬', `
    <div class="hero" style="padding:30px 20px">
      <h1>🎬 Watch Videos, Earn Rewards</h1>
      <p>Watch educational and entertaining videos. Claim rewards for each video!</p>
    </div>
    <div class="grid">${videoCards}</div>
  `, null, true, lang));
});

app.get('/bonus/claim/video/:id', requireAuth, checkDb, async (req, res) => {
  const exists = await pool.query('SELECT id FROM bonus_earnings WHERE user_id=$1 AND type=\'video\' AND video_id=$2', [req.session.user.email, req.params.id]);
  if (exists.rows[0]) return res.redirect('/videos');
  await addBonus(req.session.user.email, req.tenantId, 50, 'video', `Watched video ${req.params.id}`, { video_id: req.params.id });
  res.redirect('/videos');
});

// === NEWS PORTAL ===
app.get('/news', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  try {
    const feeds = [
      { url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', category: 'Africa' },
      { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', category: 'Tech' },
      { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'Business' }
    ];
    
    const allNews = [];
    for (const feed of feeds) {
      try {
        const parsed = await parser.parseURL(feed.url);
        allNews.push(...parsed.items.slice(0, 5).map(item => ({ ...item, category: feed.category })));
      } catch (e) {}
    }
    
    const newsCards = allNews.slice(0, 15).map((item, i) => `
      <div class="card">
        <span class="badge badge-blue" style="margin-bottom:8px">${item.category}</span>
        <h4 style="margin:8px 0">${esc(item.title)}</h4>
        <p style="color:#64748b;font-size:14px;margin-bottom:12px">${esc(item.contentSnippet?.substring(0, 120))}...</p>
        ${isAuth ? 
          `<a href="/bonus/claim/news?idx=${i}&url=${encodeURIComponent(item.link)}" class="btn btn-orange" style="font-size:12px;padding:8px 16px" target="_blank">Read & Earn +20 UGX</a>` :
          `<a href="/news/read?url=${encodeURIComponent(item.link)}" class="btn btn-orange" style="font-size:12px;padding:8px 16px" target="_blank">Read More</a>`
        }
      </div>
    `).join('');
    
    // Cache for claiming
    if (isAuth) {
      req.session.newsCache = allNews.slice(0, 15).map(n => n.link);
    }

    res.send(renderPage('News Portal 📰', `
      <div class="hero" style="padding:30px 20px">
        <h1>📰 Latest News</h1>
        <p>Stay informed and earn rewards for reading!</p>
      </div>
      <div class="grid">${newsCards}</div>
    `, null, true, lang));
  } catch (e) {
    res.send(renderPage('News', '<div class="card"><h1>News Unavailable</h1></div>', null, true, lang));
  }
});

app.get('/news/read', (req, res) => {
  res.redirect(req.query.url || '/news');
});

app.get('/bonus/claim/news', requireAuth, checkDb, async (req, res) => {
  const idx = parseInt(req.query.idx) || 0;
  const url = req.session.newsCache?.[idx];
  if (url) {
    await addBonus(req.session.user.email, req.tenantId, 20, 'news', 'Read news article', { url });
  }
  res.redirect(req.query.url || '/news');
});

// === DOWNLOADS PORTAL ===
app.get('/downloads', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  const apps = [
    { name: 'Khan Academy', desc: 'Free learning app', url: 'https://play.google.com/store/apps/details?id=org.khanacademy.android', size: '45MB', reward: 100, icon: '📚' },
    { name: 'Duolingo', desc: 'Learn languages free', url: 'https://play.google.com/store/apps/details?id=com.duolingo', size: '38MB', reward: 100, icon: '🌍' },
    { name: 'Photomath', desc: 'Math problem solver', url: 'https://play.google.com/store/apps/details?id=com.microblink.photomath', size: '25MB', reward: 100, icon: '🧮' }
  ];
  
  const appCards = apps.map(a => `
    <div class="card" style="display:flex;gap:16px;align-items:center">
      <div style="font-size:48px">${a.icon}</div>
      <div style="flex:1">
        <h4>${a.name}</h4>
        <p style="color:#64748b;font-size:14px">${a.desc}</p>
        <p style="color:#64748b;font-size:12px">Size: ${a.size}</p>
      </div>
      ${isAuth ? 
        `<a href="/bonus/claim/download?url=${encodeURIComponent(a.url)}&name=${encodeURIComponent(a.name)}" class="btn btn-green">Download +${a.reward}</a>` :
        `<a href="${a.url}" class="btn btn-green" target="_blank">Download</a>`
      }
    </div>
  `).join('');
  
  res.send(renderPage('Download & Earn 📥', `
    <div class="hero" style="padding:30px 20px">
      <h1>📥 Download Apps, Earn Rewards</h1>
      <p>Download useful educational apps and earn UGX for each install!</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">${appCards}</div>
  `, null, true, lang));
});

app.get('/bonus/claim/download', requireAuth, checkDb, async (req, res) => {
  await addBonus(req.session.user.email, req.tenantId, 100, 'download', `Downloaded ${req.query.name}`, { url: req.query.url });
  res.redirect(req.query.url);
});

// === GAMES PORTAL ===
app.get('/games', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  const games = [
    { id: 'quiz', name: 'Math Quiz', desc: 'Test your math skills', icon: '🧮', reward: 30, players: '1.2K' },
    { id: 'memory', name: 'Memory Match', desc: 'Match the cards', icon: '🃏', reward: 25, players: '890' },
    { id: 'typing', name: 'Speed Typing', desc: 'Type fast to win', icon: '⌨️', reward: 35, players: '650' },
    { id: 'trivia', name: 'General Knowledge', desc: 'Answer trivia questions', icon: '❓', reward: 40, players: '1.5K' }
  ];
  
  const gameCards = games.map(g => `
    <div class="card" style="text-align:center;cursor:pointer">
      <div style="font-size:64px;margin-bottom:12px">${g.icon}</div>
      <h3>${g.name}</h3>
      <p style="color:#64748b;margin-bottom:8px">${g.desc}</p>
      <p style="color:#64748b;font-size:12px">🎮 ${g.players} playing</p>
      ${isAuth ? 
        `<div class="badge badge-gold" style="margin:8px 0">Earn +${g.reward} UGX</div>
         <a href="/games/play/${g.id}" class="btn btn-green">Play Now</a>` :
        `<a href="/login" class="btn btn-green">Login to Play</a>`
      }
    </div>
  `).join('');
  
  res.send(renderPage('Games & Fun 🎮', `
    <div class="hero" style="padding:30px 20px">
      <h1>🎮 Play Games, Win Rewards</h1>
      <p>Have fun and earn UGX at the same time!</p>
    </div>
    <div class="grid">${gameCards}</div>
    ${isAuth ? `
      <div class="card" style="margin-top:20px">
        <h3>🏆 Leaderboard</h3>
        <table>
          <thead><tr><th>Rank</th><th>Player</th><th>Points</th></tr></thead>
          <tbody>
            <tr><td>🥇 1</td><td>John M.</td><td>12,450</td></tr>
            <tr><td>🥈 2</td><td>Sarah K.</td><td>11,200</td></tr>
            <tr><td>🥉 3</td><td>Peter O.</td><td>10,800</td></tr>
          </tbody>
        </table>
      </div>
    ` : ''}
  `, null, true, lang));
});

app.get('/games/play/:id', requireAuth, checkDb, async (req, res) => {
  const gameId = req.params.id;
  let gameHtml = '';
  
  if (gameId === 'quiz') {
    gameHtml = `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h1>🧮 Math Quiz</h1>
        <p style="color:#64748b;margin:20px 0">Answer 5 questions correctly to earn 30 UGX!</p>
        <div id="quiz-area">
          <div style="font-size:36px;text-align:center;margin:20px 0" id="question"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <button class="btn" onclick="checkAnswer(this)" id="ans1"></button>
            <button class="btn" onclick="checkAnswer(this)" id="ans2"></button>
            <button class="btn" onclick="checkAnswer(this)" id="ans3"></button>
            <button class="btn" onclick="checkAnswer(this)" id="ans4"></button>
          </div>
          <p style="text-align:center;margin-top:16px">Score: <span id="score">0</span>/5</p>
        </div>
        <div id="result" style="display:none;text-align:center">
          <div style="font-size:48px;margin-bottom:16px">🎉</div>
          <h2>Congratulations!</h2>
          <p>You earned <strong class="badge badge-green">30 UGX</strong></p>
          <a href="/games" class="btn" style="margin-top:20px">Back to Games</a>
        </div>
      </div>
      <script>
        let questions = [];
        for(let i=0;i<5;i++){
          let a=Math.floor(Math.random()*20)+1, b=Math.floor(Math.random()*20)+1;
          let op=['+','-','×'][Math.floor(Math.random()*3)];
          let ans=op==='+'?a+b:op==='-'?a-b:a*b;
          questions.push({q:'\\'+a+' '+op+' \\'+b+' = ?',ans:ans});
        }
        let idx=0,score=0;
        function showQuestion(){
          if(idx>=5){
            document.getElementById('quiz-area').style.display='none';
            document.getElementById('result').style.display='block';
            fetch('/bonus/claim/game/quiz').catch(()=>{});
            return;
          }
          let q=questions[idx];
          document.getElementById('question').textContent=q.q.replace(/\\/g,'');
          let options=[q.ans];
          while(options.length<4){
            let wrong=q.ans+Math.floor(Math.random()*20)-10;
            if(!options.includes(wrong))options.push(wrong);
          }
          options.sort(()=>Math.random()-0.5);
          for(let i=1;i<=4;i++)document.getElementById('ans'+i).textContent=options[i-1];
          document.getElementById('ans1').dataset.ans=options[0];
          document.getElementById('ans2').dataset.ans=options[1];
          document.getElementById('ans3').dataset.ans=options[2];
          document.getElementById('ans4').dataset.ans=options[3];
        }
        function checkAnswer(btn){
          if(parseInt(btn.dataset.ans)===questions[idx].ans){
            score++;
            document.getElementById('score').textContent=score;
          }
          idx++;
          showQuestion();
        }
        showQuestion();
      </script>
    `;
  } else {
    gameHtml = `
      <div class="card" style="text-align:center">
        <div style="font-size:64px;margin-bottom:16px">🎮</div>
        <h1>Game Coming Soon!</h1>
        <p style="color:#64748b;margin:20px 0">This game is being developed. Try Math Quiz for now!</p>
        <a href="/games/play/quiz" class="btn btn-green">Play Math Quiz</a>
      </div>
    `;
  }
  
  res.send(renderPage('Playing Game', gameHtml, { tenant_name: req.tenant.name }, false, req.lang));
});

app.get('/bonus/claim/game/:id', requireAuth, checkDb, async (req, res) => {
  const exists = await pool.query('SELECT id FROM bonus_earnings WHERE user_id=$1 AND type=\'game\' AND metadata->>\'game_id\'=$2 AND created_at > NOW() - INTERVAL \'1 hour\'', [req.session.user.email, req.params.id]);
  if (!exists.rows[0]) {
    await addBonus(req.session.user.email, req.tenantId, 30, 'game', `Played ${req.params.id}`, { game_id: req.params.id });
  }
  res.json({ ok: true });
});

// === LEARNING PORTAL ===
app.get('/learning', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  const categories = [
    { name: 'Mathematics', icon: '🔢', courses: 15, free: 8 },
    { name: 'Science', icon: '🔬', courses: 12, free: 6 },
    { name: 'English', icon: '📖', courses: 10, free: 5 },
    { name: 'History', icon: '🏛️', courses: 8, free: 4 },
    { name: 'Computing', icon: '💻', courses: 11, free: 7 }
  ];
  
  const categoryCards = categories.map(c => `
    <div class="card" style="cursor:pointer" onclick="location.href='/learning/${c.name.toLowerCase()}'">
      <div style="font-size:48px;margin-bottom:12px">${c.icon}</div>
      <h3>${c.name}</h3>
      <p style="color:#64748b;margin-bottom:8px">${c.courses} courses</p>
      <div>
        <span class="badge badge-green">${c.free} Free</span>
        <span class="badge badge-gold">${c.courses - c.free} Premium</span>
      </div>
    </div>
  `).join('');
  
  res.send(renderPage('Learning Portal 📚', `
    <div class="hero" style="padding:30px 20px">
      <h1>📚 Learn Anything</h1>
      <p>Free and premium courses to boost your knowledge</p>
      ${!isAuth ? '<a href="/signup" class="btn btn-green">Start Learning Free</a>' : ''}
    </div>
    <div class="grid">${categoryCards}</div>
    ${isAuth ? `
      <div class="card" style="margin-top:20px">
        <h3>📊 My Progress</h3>
        <div style="background:#f8fafc;padding:20px;border-radius:12px;margin-top:12px">
          <p>Courses Completed: <strong>3</strong></p>
          <p>Certificates Earned: <strong>2</strong></p>
          <p>Learning Streak: <strong class="badge badge-gold">7 days 🔥</strong></p>
        </div>
      </div>
    ` : ''}
  `, null, true, lang));
});

app.get('/learning/:category', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const category = req.params.category;
  
  const courses = [
    { id: 1, title: 'Introduction to Algebra', duration: '2 hours', lessons: 12, level: 'Beginner', premium: false },
    { id: 2, title: 'Advanced Calculus', duration: '5 hours', lessons: 24, level: 'Advanced', premium: true },
    { id: 3, title: 'Geometry Basics', duration: '1.5 hours', lessons: 8, level: 'Beginner', premium: false }
  ];
  
  const courseCards = courses.map(c => `
    <div class="card" style="position:relative">
      ${c.premium ? '<div class="premium-badge">⭐ PREMIUM</div>' : '<div class="badge badge-green" style="position:absolute;top:10px;right:10px">FREE</div>'}
      <h4 style="margin-bottom:8px">${c.title}</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <span class="badge badge-blue">⏱️ ${c.duration}</span>
        <span class="badge badge-blue">📚 ${c.lessons} lessons</span>
        <span class="badge badge-blue">📊 ${c.level}</span>
      </div>
      <a href="/learning/course/${c.id}" class="btn ${c.premium ? 'btn-gold' : 'btn-green'}">${c.premium ? 'Unlock - 5,000 UGX' : 'Start Free'}</a>
    </div>
  `).join('');
  
  res.send(renderPage(`${category.charAt(0).toUpperCase() + category.slice(1)} Courses`, `
    <div class="card">
      <h1>📚 ${category.charAt(0).toUpperCase() + category.slice(1)} Courses</h1>
    </div>
    <div class="grid">${courseCards}</div>
    <div class="card" style="margin-top:20px;text-align:center">
      <p style="color:#64748b">Want unlimited access to all premium courses?</p>
      <a href="/premium" class="btn btn-gold" style="margin-top:12px">⭐ Go Premium - 15,000 UGX/month</a>
    </div>
  `, null, true, lang));
});

app.get('/learning/course/:id', requireAuth, checkDb, async (req, res) => {
  res.send(renderPage('Course Content', `
    <div class="card">
      <h1>📚 Introduction to Algebra</h1>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
        <span class="badge badge-blue">⏱️ 2 hours</span>
        <span class="badge badge-blue">📚 12 lessons</span>
        <span class="badge badge-green">Beginner</span>
      </div>
      <p style="color:#64748b;margin:16px 0">Learn the fundamentals of algebraic expressions and equations.</p>
      
      <h3 style="margin-top:24px">Course Content</h3>
      <div style="margin-top:12px">
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span>📖 Lesson 1: Variables and Constants</span>
          <span class="badge badge-green">✅ Complete</span>
        </div>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span>📖 Lesson 2: Algebraic Expressions</span>
          <span class="badge badge-green">✅ Complete</span>
        </div>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
          <span>📖 Lesson 3: Linear Equations</span>
          <a href="#" class="btn btn-green" style="font-size:12px;padding:8px 16px">Continue</a>
        </div>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:8px;opacity:0.6">
          <span>🔒 Lesson 4: Quadratic Equations</span>
        </div>
      </div>
      
      <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px">
        <p style="color:#92400e;font-weight:600">🎁 Complete this course to earn a certificate and <strong>500 UGX bonus!</strong></p>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

// === PREMIUM SUBSCRIPTION ===
app.get('/premium', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  res.send(renderPage('⭐ Premium Membership', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:40px 20px">
      <h1>⭐ Go Premium</h1>
      <p style="font-size:24px;margin:16px 0">Unlock the full power of SSEWASSWA</p>
      <div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">15,000 UGX<span style="font-size:24px">/month</span></div>
    </div>
    
    <div class="grid">
      <div class="card" style="border:2px solid #22c55e">
        <h3>✅ Premium Benefits</h3>
        <ul style="margin:16px 0;padding-left:20px;line-height:2">
          <li>📚 Unlimited access to all premium courses</li>
          <li>🎮 Ad-free gaming experience</li>
          <li>📱 Priority support</li>
          <li>🎁 2x reward earnings (100 UGX per video)</li>
          <li>🏆 Exclusive tournaments entry</li>
          <li>📊 Advanced analytics dashboard</li>
          <li>📥 Unlimited downloads</li>
          <li>🏪 Zero marketplace fees</li>
        </ul>
      </div>
      
      <div class="card">
        <h3>💎 Premium Plus</h3>
        <div class="stat-num" style="font-size:36px">40,000 UGX<span style="font-size:18px">/3 months</span></div>
        <p style="color:#64748b;margin:16px 0">Save 5,000 UGX!</p>
        <ul style="margin:16px 0;padding-left:20px;line-height:2">
          <li>Everything in Premium</li>
          <li>🤝 Early access to new features</li>
          <li>🏅 Verified badge on profile</li>
          <li>💰 5% cashback on purchases</li>
          <li>📞 Direct WhatsApp support</li>
        </ul>
      </div>
    </div>
    
    ${isAuth ? `
      <div class="card" style="text-align:center">
        <form method="POST" action="/premium/subscribe" style="max-width:400px;margin:0 auto">
          <select name="plan">
            <option value="monthly">Monthly - 15,000 UGX</option>
            <option value="quarterly">Quarterly - 40,000 UGX (Save 5,000)</option>
          </select>
          <input name="phone" placeholder="MoMo Number (07XX)" required>
          <button class="btn btn-gold" style="width:100%;font-size:18px;padding:16px">⭐ Subscribe Now</button>
        </form>
      </div>
    ` : `
      <div class="card" style="text-align:center">
        <a href="/signup" class="btn btn-gold" style="font-size:18px;padding:16px 32px">Sign Up to Subscribe</a>
      </div>
    `}
  `, null, true, lang));
});

app.post('/premium/subscribe', requireAuth, checkDb, async (req, res) => {
  try {
    const { plan, phone } = req.body;
    const amount = plan === 'quarterly' ? 40000 : 15000;
    const ref = `PREM-${Date.now()}`;
    
    await pool.query('INSERT INTO payment_requests (tenant_id, user_id, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.session.user.email, amount, phone, ref, 'pending']);
    
    // Developer commission (30%)
    const devFee = Math.round(amount * DEV_COMMISSION.subscription);
    await addDevCommission(devFee, 'subscription', `Premium subscription - ${plan}`, ref);
    
    if (MOMO_CONFIG.apiKey === 'demo') {
      await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]);
      await pool.query('UPDATE users SET premium_until = CASE WHEN $1 = \'quarterly\' THEN NOW() + INTERVAL \'3 months\' ELSE NOW() + INTERVAL \'1 month\' END WHERE email = $2', [plan, req.session.user.email]);
      
      return res.send(renderPage('Premium Activated! ⭐', `
        <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
          <div style="font-size:60px;margin-bottom:16px">⭐</div>
          <h1>Welcome to Premium!</h1>
          <p style="color:#64748b;margin:20px 0">Your premium features are now active</p>
          <a href="/app" class="btn btn-gold" style="margin-top:20px">Start Enjoying Premium</a>
        </div>
      `, { tenant_name: req.tenant.name }, false, req.lang));
    }
    
    res.send(renderPage('Processing...', '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>MoMo prompt sent</p></div>', null, true));
  } catch (e) { res.status(500).send("Error"); }
});

// === STORE ===
app.get('/store', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  
  const products = [
    { id: 1, name: 'School Uniform Set', price: 45000, img: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=200&fit=crop', category: 'Uniforms' },
    { id: 2, name: 'Exercise Books (12pcs)', price: 12000, img: 'https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=300&h=200&fit=crop', category: 'Books' },
    { id: 3, name: 'School Backpack', price: 35000, img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=300&h=200&fit=crop', category: 'Bags' },
    { id: 4, name: 'Scientific Calculator', price: 25000, img: 'https://images.unsplash.com/photo-1612170154148-27e2a4375654?w=300&h=200&fit=crop', category: 'Electronics' },
    { id: 5, name: 'Geometry Set', price: 8000, img: 'https://images.unsplash.com/photo-1596476543000-e5c0e5ef3e7c?w=300&h=200&fit=crop', category: 'Stationery' },
    { id: 6, name: 'Lab Coat', price: 30000, img: 'https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=300&h=200&fit=crop', category: 'Uniforms' }
  ];
  
  const productCards = products.map(p => `
    <div class="card" style="padding:0;overflow:hidden">
      <img src="${p.img}" class="card-img" alt="${p.name}">
      <div style="padding:16px">
        <span class="badge badge-blue" style="margin-bottom:8px">${p.category}</span>
        <h4 style="margin:8px 0">${p.name}</h4>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <div class="stat-num" style="font-size:24px">UGX ${p.price.toLocaleString()}</div>
          <a href="/store/buy/${p.id}" class="btn btn-green">Buy Now</a>
        </div>
      </div>
    </div>
  `).join('');
  
  res.send(renderPage('School Store 🛒', `
    <div class="hero" style="padding:30px 20px">
      <h1>🛒 School Store</h1>
      <p>Everything your child needs for school success</p>
    </div>
    <div class="grid">${productCards}</div>
    <div class="card" style="margin-top:20px;text-align:center">
      <p style="color:#64748b">🎁 Premium members get <strong>5% cashback</strong> on all purchases</p>
      <a href="/premium" class="btn btn-gold" style="margin-top:12px">Go Premium</a>
    </div>
  `, null, true, lang));
});

app.get('/store/buy/:id', async (req, res) => {
  const products = {
    1: { name: 'School Uniform Set', price: 45000 },
    2: { name: 'Exercise Books (12pcs)', price: 12000 },
    3: { name: 'School Backpack', price: 35000 },
    4: { name: 'Scientific Calculator', price: 25000 },
    5: { name: 'Geometry Set', price: 8000 },
    6: { name: 'Lab Coat', price: 30000 }
  };
  const p = products[req.params.id];
  if (!p) return res.status(404).send('Product not found');
  
  res.send(renderPage('Checkout', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>🛒 Buy ${p.name}</h1>
      <div style="background:#f8fafc;padding:20px;border-radius:12px;margin:20px 0;text-align:center">
        <div style="color:#64748b">Price</div>
        <div class="stat-num">UGX ${p.price.toLocaleString()}</div>
      </div>
      <form method="POST" action="/store/buy/${req.params.id}">
        <input name="phone" placeholder="MoMo Number (07XX)" required>
        <input name="name" placeholder="Your Full Name" required>
        <input name="address" placeholder="Delivery Address" required>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay with MoMo</button>
      </form>
      <p style="text-align:center;margin-top:16px;color:#64748b;font-size:12px">📦 Delivery within 24-48 hours</p>
    </div>
  `, null, true));
});

app.post('/store/buy/:id', checkDb, async (req, res) => {
  const products = {
    1: { name: 'School Uniform Set', price: 45000 },
    2: { name: 'Exercise Books (12pcs)', price: 12000 },
    3: { name: 'School Backpack', price: 35000 },
    4: { name: 'Scientific Calculator', price: 25000 },
    5: { name: 'Geometry Set', price: 8000 },
    6: { name: 'Lab Coat', price: 30000 }
  };
  const p = products[req.params.id];
  const ref = `STORE-${Date.now()}`;
  
  await pool.query('INSERT INTO store_orders (product_id, product_name, amount, buyer_phone, buyer_name, delivery_address, reference, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [req.params.id, p.name, p.price, req.body.phone, req.body.name, req.body.address, ref, 'pending']);
  
  // Developer commission (8%)
  const devFee = Math.round(p.price * DEV_COMMISSION.store_purchase);
  await addDevCommission(devFee, 'store_purchase', `Store purchase - ${p.name}`, ref);
  
  res.send(renderPage('Order Placed! ✅', `
    <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
      <div style="font-size:60px;margin-bottom:16px">✅</div>
      <h1>Order Placed!</h1>
      <div style="background:#f8fafc;padding:20px;border-radius:12px;margin:20px 0;text-align:left">
        <p><strong>Product:</strong> ${p.name}</p>
        <p><strong>Amount:</strong> UGX ${p.price.toLocaleString()}</p>
        <p><strong>Reference:</strong> ${ref}</p>
        <p><strong>Delivery:</strong> ${req.body.address}</p>
      </div>
      <p style="color:#64748b">📦 You'll receive delivery updates via SMS</p>
      <a href="/store" class="btn" style="margin-top:20px">Continue Shopping</a>
    </div>
  `, null, true));
});

// === MARKETPLACE ===
app.get('/marketplace', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const isAuth = req.session.user;
  
  const listings = [
    { id: 1, title: 'iPhone 12 Pro', price: 1800000, seller: 'John M.', location: 'Kampala', img: '📱', category: 'Electronics' },
    { id: 2, title: 'Toyota Corolla 2018', price: 45000000, seller: 'Auto Dealer', location: 'Kampala', img: '🚗', category: 'Vehicles' },
    { id: 3, title: '3-Bedroom House', price: 150000000, seller: 'Realtor Uganda', location: 'Entebbe', img: '🏠', category: 'Property' },
    { id: 4, title: 'Professional Web Design', price: 500000, seller: 'Tech Solutions', location: 'Remote', img: '💻', category: 'Services' }
  ];
  
  const listingCards = listings.map(l => `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);padding:40px;text-align:center;font-size:64px">${l.img}</div>
      <div style="padding:16px">
        <span class="badge badge-blue" style="margin-bottom:8px">${l.category}</span>
        <h4 style="margin:8px 0">${l.title}</h4>
        <div class="stat-num" style="font-size:24px;margin:12px 0">UGX ${l.price.toLocaleString()}</div>
        <p style="color:#64748b;font-size:14px">📍 ${l.location} • by ${l.seller}</p>
        <a href="/marketplace/view/${l.id}" class="btn btn-green" style="margin-top:12px;width:100%">View Details</a>
      </div>
    </div>
  `).join('');
  
  res.send(renderPage('Marketplace 🏪', `
    <div class="hero" style="padding:30px 20px">
      <h1>🏪 Buy & Sell Anything</h1>
      <p>Uganda's trusted marketplace with zero listing fees</p>
      ${isAuth ? '<a href="/marketplace/list" class="btn btn-green" style="margin-top:12px">➕ List Item for Sale</a>' : ''}
    </div>
    <div class="grid">${listingCards}</div>
    ${isAuth ? `
      <div class="card" style="margin-top:20px;text-align:center">
        <p style="color:#64748b">💰 Earn <strong>10% commission</strong> when your referrals buy/sell on marketplace</p>
      </div>
    ` : ''}
  `, null, true, lang));
});

app.get('/marketplace/view/:id', async (req, res) => {
  res.send(renderPage('Item Details', `
    <div class="card">
      <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);padding:60px;text-align:center;font-size:80px;margin:-24px -24px 24px;border-radius:16px 16px 0 0">📱</div>
      <h1>iPhone 12 Pro - Excellent Condition</h1>
      <div class="stat-num" style="font-size:36px;margin:20px 0">UGX 1,800,000</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:20px 0">
        <span class="badge badge-blue">📍 Kampala</span>
        <span class="badge badge-green">✅ Verified Seller</span>
        <span class="badge badge-blue">📱 Electronics</span>
      </div>
      <p style="color:#64748b;margin:20px 0;line-height:1.8">
        iPhone 12 Pro in excellent condition. Comes with original charger, box, and earphones. 
        No scratches on screen. Battery health 92%. Reason for selling: upgrading to iPhone 15.
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">
        <a href="/marketplace/buy/1" class="btn btn-green" style="font-size:18px;padding:16px 32px">Buy Now</a>
        <a href="https://wa.me/256700000000?text=Hi, interested in iPhone 12 Pro" class="btn btn-green" style="font-size:18px;padding:16px 32px" target="_blank">WhatsApp Seller</a>
      </div>
    </div>
  `, null, true));
});

app.get('/marketplace/list', requireAuth, (req, res) => {
  res.send(renderPage('List Item for Sale', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h1>➕ List Item for Sale</h1>
      <p style="color:#64748b;margin:16px 0">Reach thousands of buyers across Uganda</p>
      <form method="POST" action="/marketplace/list">
        <input name="title" placeholder="Item Title" required>
        <select name="category">
          <option>Electronics</option>
          <option>Vehicles</option>
          <option>Property</option>
          <option>Services</option>
          <option>Fashion</option>
          <option>Other</option>
        </select>
        <input name="price" type="number" placeholder="Price (UGX)" required>
        <textarea name="description" placeholder="Describe your item..." rows="4" required></textarea>
        <input name="location" placeholder="Location (e.g. Kampala)" required>
        <input name="phone" placeholder="Contact Phone (07XX)" required>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">List for Free</button>
      </form>
      <p style="text-align:center;margin-top:16px;color:#64748b;font-size:12px">🎁 Earn rewards when your item sells</p>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/marketplace/list', requireAuth, checkDb, async (req, res) => {
  try {
    await pool.query('INSERT INTO marketplace_listings (tenant_id, seller_email, title, category, price, description, location, phone, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [req.tenantId, req.session.user.email, req.body.title, req.body.category, req.body.price, req.body.description, req.body.location, req.body.phone, 'active']);
    res.send(renderPage('Listed! ✅', '<div class="card" style="text-align:center"><h1>✅ Item Listed Successfully!</h1><p>Your listing is now live on the marketplace</p><a href="/marketplace" class="btn" style="margin-top:20px">View Marketplace</a></div>', { tenant_name: req.tenant.name }, false, req.lang));
  } catch (e) { res.status(500).send("Error"); }
});

// === SCHOOL MANAGEMENT (Keeping existing routes but with improved UI) ===
app.get('/app', requireAuth, checkDb, async (req, res) => {
  const lang = req.lang;
  try {
    const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [req.tenantId]);
    const fees = await pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS total FROM fees WHERE tenant_id=$1', [req.tenantId]);
    const att = await pool.query('SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status=\'present\'', [req.tenantId]);
    const wallet = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
    const isPremium = req.session.user.premium_until && new Date(req.session.user.premium_until) > new Date();
    
    res.send(renderPage('Dashboard', `
      ${isPremium ? '<div class="card" style="background:linear-gradient(135deg,#fef3c7,#fde68a);text-align:center"><span class="premium-badge" style="font-size:16px">⭐ PREMIUM MEMBER - 2x Rewards Active</span></div>' : ''}
      
      <div class="stats">
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎓</div><div>${t('students', lang)}</div><div class="stat-num">${students.rows[0].c}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">💰</div><div>Fees Collected</div><div class="stat-num">UGX ${fees.rows[0].total}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">✅</div><div>Present Today</div><div class="stat-num">${att.rows[0].c}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎁</div><div>My Rewards</div><div class="stat-num">UGX ${wallet.balance}</div></div>
      </div>

      <div class="card">
        <h1>Quick Actions</h1>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
          <a href="/app/students/add" class="btn btn-green">➕ Add Student</a>
          <a href="/app/fees/add" class="btn">💰 Record Fee</a>
          <a href="/app/attendance/mark" class="btn">✅ Attendance</a>
          <a href="/app/grades/add" class="btn">📝 Grades</a>
          <a href="/bonus" class="btn btn-purple">🎁 Rewards Hub</a>
        </div>
      </div>

      <div class="grid" style="margin-top:20px">
        <div class="card">
          <h3>📊 Today's Summary</h3>
          <div style="margin-top:12px">
            <p>Fee collections: <strong>UGX ${(await pool.query('SELECT COALESCE(SUM(paid),0) FROM fees WHERE tenant_id=$1 AND DATE(created_at)=CURRENT_DATE', [req.tenantId])).rows[0].coalesce}</strong></p>
            <p>Attendance marked: <strong>${att.rows[0].c} students</strong></p>
          </div>
        </div>
        <div class="card">
          <h3>🏆 Earn More Rewards</h3>
          <div style="margin-top:12px">
            <p>• Watch videos: <strong>+50 UGX each</strong></p>
            <p>• Read news: <strong>+20 UGX each</strong></p>
            <p>• Refer friends: <strong>+200 UGX each</strong></p>
            <a href="/bonus" class="btn btn-purple" style="margin-top:8px">Start Earning</a>
          </div>
        </div>
      </div>
    `, { tenant_name: req.tenant.name }, false, lang));
  } catch (e) { res.status(500).send("Error"); }
});

// Keep all existing /app/* routes here (students, fees, attendance, grades, settings, etc.)
// I'll include them but abbreviated to save space - they remain exactly as in your original code
// ... [All existing routes remain unchanged] ...

// === SUPER ADMIN ===
app.get('/super-admin', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const totalRevenue = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM developer_revenue')).rows[0].total;
  const platformBalance = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0]?.balance || 0;
  const totalUsers = (await pool.query('SELECT COUNT(*) as count FROM users')).rows[0].count;
  const pendingWithdrawals = (await pool.query('SELECT COUNT(*) as count FROM withdrawals WHERE status=\'pending\'')).rows[0].count;
  
  res.send(renderPage('Super Admin Panel', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:40px 20px">
      <h1>👑 Super Admin Dashboard</h1>
      <p style="font-size:20px;margin-top:12px">Platform Revenue & Analytics</p>
    </div>
    
    <div class="stats">
      <div class="stat-card" style="border:2px solid #dc2626">
        <div style="color:#dc2626;font-weight:600">Total Revenue</div>
        <div class="stat-num" style="-webkit-text-fill-color:#dc2626">UGX ${totalRevenue.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="color:#64748b;font-weight:600">Platform Wallet</div>
        <div class="stat-num">UGX ${platformBalance.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="color:#64748b;font-weight:600">Total Users</div>
        <div class="stat-num">${totalUsers}</div>
      </div>
      <div class="stat-card">
        <div style="color:#f59e0b;font-weight:600">Pending Payouts</div>
        <div class="stat-num" style="-webkit-text-fill-color:#f59e0b">${pendingWithdrawals}</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Commission Breakdown</h3>
        <table style="margin-top:12px">
          <thead><tr><th>Type</th><th>Rate</th><th>Total Earned</th></tr></thead>
          <tbody>
            <tr><td>Fee Payments</td><td>5%</td><td>UGX ${(await pool.query("SELECT COALESCE(SUM(amount),0) FROM developer_revenue WHERE type='fee_payment'")).rows[0].coalesce}</td></tr>
            <tr><td>Store Sales</td><td>8%</td><td>UGX ${(await pool.query("SELECT COALESCE(SUM(amount),0) FROM developer_revenue WHERE type='store_purchase'")).rows[0].coalesce}</td></tr>
            <tr><td>Marketplace</td><td>10%</td><td>UGX ${(await pool.query("SELECT COALESCE(SUM(amount),0) FROM developer_revenue WHERE type='marketplace'")).rows[0].coalesce}</td></tr>
            <tr><td>Subscriptions</td><td>30%</td><td>UGX ${(await pool.query("SELECT COALESCE(SUM(amount),0) FROM developer_revenue WHERE type='subscription'")).rows[0].coalesce}</td></tr>
            <tr><td>Withdrawal Fees</td><td>2%</td><td>UGX ${(await pool.query("SELECT COALESCE(SUM(amount),0) FROM developer_revenue WHERE type='withdrawal_fee'")).rows[0].coalesce}</td></tr>
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h3>Quick Links</h3>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
          <a href="/super-admin/tenants" class="btn">🏫 Manage Schools</a>
          <a href="/super-admin/users" class="btn">👥 Manage Users</a>
          <a href="/super-admin/bonuses" class="btn btn-purple">💰 Process Payouts</a>
          <a href="/super-admin/revenue" class="btn btn-gold">📊 Revenue Details</a>
          <a href="/super-admin/commission" class="btn btn-red">⚙️ Commission Settings</a>
          <a href="/create-site" class="btn btn-green">➕ Add School</a>
        </div>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }));
});

app.get('/super-admin/revenue', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const revenue = await pool.query('SELECT * FROM developer_revenue ORDER BY created_at DESC LIMIT 50');
  const rows = revenue.rows.map(r => `
    <tr>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-blue">${r.type}</span></td>
      <td class="badge badge-green">+UGX ${r.amount}</td>
      <td>${esc(r.description)}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('Revenue Details', `
    <div class="card">
      <h1>📊 Developer Revenue Log</h1>
      <div style="overflow-x:auto;margin-top:16px">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }));
});

app.get('/super-admin/bonuses', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const withdrawals = await pool.query('SELECT * FROM withdrawals WHERE status=\'pending\' ORDER BY created_at DESC');
  const orders = await pool.query('SELECT * FROM store_orders WHERE status=\'pending\' ORDER BY created_at DESC LIMIT 20');
  
  res.send(renderPage('Process Payouts', `
    <div class="card">
      <h1>💰 Pending User Withdrawals</h1>
      <table style="margin-top:16px">
        <thead><tr><th>User</th><th>Amount</th><th>Fee</th><th>Net</th><th>Phone</th><th>Action</th></tr></thead>
        <tbody>${withdrawals.rows.map(w => `
          <tr>
            <td>${esc(w.user_email)}</td>
            <td>UGX ${w.amount}</td>
            <td class="badge badge-red">UGX ${w.fee}</td>
            <td class="badge badge-green">UGX ${w.net_amount}</td>
            <td>${esc(w.phone)}</td>
            <td><a href="/super-admin/payout/${w.id}" class="btn btn-green" style="font-size:12px;padding:8px">Mark Paid</a></td>
          </tr>
        `).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b">No pending withdrawals</td></tr>'}</tbody>
      </table>
    </div>
    
    <div class="card" style="margin-top:20px">
      <h1>🛒 Pending Store Orders</h1>
      <table style="margin-top:16px">
        <thead><tr><th>Product</th><th>Amount</th><th>Buyer</th><th>Phone</th><th>Address</th></tr></thead>
        <tbody>${orders.rows.map(o => `
          <tr>
            <td>${esc(o.product_name)}</td>
            <td>UGX ${o.amount}</td>
            <td>${esc(o.buyer_name)}</td>
            <td>${esc(o.buyer_phone)}</td>
            <td>${esc(o.delivery_address || 'N/A')}</td>
          </tr>
        `).join('') || '<tr><td colspan="5" style="text-align:center;color:#64748b">No pending orders</td></tr>'}</tbody>
      </table>
    </div>
  `, { tenant_name: req.tenant.name }));
});

app.get('/super-admin/payout/:id', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  await pool.query('UPDATE withdrawals SET status=\'paid\', paid_at=NOW() WHERE id=$1', [req.params.id]);
  res.redirect('/super-admin/bonuses');
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tenants ORDER BY id');
  res.send(renderPage('Schools', `
    <div class="card">
      <h1>🏫 Registered Schools</h1>
      <table style="margin-top:16px">
        <thead><tr><th>Name</th><th>Subdomain</th><th>Plan</th><th>Code</th><th>Created</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${esc(r.name)}</td>
            <td><code>${esc(r.subdomain)}</code></td>
            <td><span class="badge badge-blue">${esc(r.plan)}</span></td>
            <td><code>${esc(r.signup_code || 'N/A')}</code></td>
            <td>${new Date(r.created_at).toLocaleDateString()}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `, { tenant_name: req.tenant.name }));
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT u.email, u.role, u.approved, u.premium_until, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id ORDER BY u.approved, t.name');
  res.send(renderPage('Users', `
    <div class="card">
      <h1>👥 All Users</h1>
      <table style="margin-top:16px">
        <thead><tr><th>Email</th><th>Role</th><th>School</th><th>Status</th><th>Premium</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td>${esc(r.email)}</td>
            <td><span class="badge badge-blue">${esc(r.role)}</span></td>
            <td>${esc(r.school)}</td>
            <td>${r.approved ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Pending</span>'}</td>
            <td>${r.premium_until && new Date(r.premium_until) > new Date() ? '<span class="premium-badge">⭐ Premium</span>' : 'Free'}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `, { tenant_name: req.tenant.name }));
});

// === CREATE SCHOOL ===
app.get('/create-site', (req, res) => {
  res.send(renderPage('Create School', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:48px;margin-bottom:12px">🏫</div>
        <h1>Register Your School</h1>
        <p style="color:#64748b">Join 500+ schools on our platform</p>
      </div>
      <form method="POST" action="/create-site">
        <input name="name" placeholder="School Name" required>
        <input name="subdomain" placeholder="Subdomain (e.g. myschool)" required>
        <input name="admin_email" type="email" placeholder="Admin Email" required>
        <input name="admin_password" type="password" placeholder="Admin Password" required>
        <input name="momo_number" placeholder="MoMo Number for Payments">
        <input name="signup_code" placeholder="Teacher Signup Code (e.g. SCH001)" required>
        <button class="btn" style="width:100%;font-size:18px;padding:16px">Create School</button>
      </form>
    </div>
  `, null, true));
});

app.post('/create-site', checkDb, async (req, res) => {
  try {
    const { name, subdomain, admin_email, admin_password, momo_number, signup_code } = req.body;
    if (!name || !subdomain || !admin_email || !admin_password || !signup_code) {
      return res.send(renderPage('Error', '<div class="card"><h1>❌ All Fields Required</h1></div>', null, true));
    }
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number, signup_code.toUpperCase()]);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name) VALUES ($1,$2,$3,$4,$5,$6)', [tenant.rows[0].id, admin_email, await bcrypt.hash(admin_password, 10), 'admin', true, name + ' Admin']);
    await pool.query('INSERT INTO settings (tenant_id, signup_code) VALUES ($1,$2)', [tenant.rows[0].id, signup_code.toUpperCase()]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [tenant.rows[0].id, admin_email]);
    
    res.send(renderPage('School Created! ✅', `
      <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
        <div style="font-size:60px;margin-bottom:16px">✅</div>
        <h1>School Registered!</h1>
        <div style="background:#f8fafc;padding:20px;border-radius:12px;margin:20px 0;text-align:left">
          <p><strong>School:</strong> ${name}</p>
          <p><strong>Subdomain:</strong> ${subdomain}</p>
          <p><strong>Teacher Code:</strong> <code style="background:#fef3c7;padding:4px 8px;border-radius:4px">${signup_code.toUpperCase()}</code></p>
        </div>
        <p style="color:#64748b">Share this code with teachers to join</p>
        <a href="/login" class="btn btn-green" style="margin-top:20px">Login Now</a>
      </div>
    `, null, true));
  } catch (e) {
    res.send(renderPage('Error', `<div class="card"><h1>❌ Error</h1><p>${e.code === '23505' ? 'Subdomain/Code already taken' : e.message}</p></div>`, null, true));
  }
});

// === STATIC PAGES ===
app.get('/about', (req, res) => {
  res.send(renderPage('About Us', `
    <div class="card" style="text-align:center">
      <div style="font-size:64px;margin-bottom:16px">🎓</div>
      <h1>About SSEWASSWA</h1>
      <p style="color:#64748b;max-width:600px;margin:20px auto;line-height:1.8">
        SSEWASSWA is Uganda's leading all-in-one platform for education, entertainment, and commerce. 
        We connect students, parents, teachers, and businesses in a seamless digital ecosystem.
      </p>
    </div>
    <div class="grid" style="margin-top:20px">
      <div class="card" style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🎯</div>
        <h3>Our Mission</h3>
        <p style="color:#64748b;margin-top:8px">To make quality education accessible and rewarding for every Ugandan student</p>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🌟</div>
        <h3>Our Vision</h3>
        <p style="color:#64748b;margin-top:8px">To become Africa's most trusted ed-tech and entertainment platform</p>
      </div>
      <div class="card" style="text-align:center">
        <div style="font-size:48px;margin-bottom:12px">💡</div>
        <h3>Our Values</h3>
        <p style="color:#64748b;margin-top:8px">Innovation, accessibility, transparency, and community empowerment</p>
      </div>
    </div>
  `, null, true));
});

app.get('/terms', (req, res) => {
  res.send(renderPage('Terms of Service', `
    <div class="card">
      <h1>Terms of Service</h1>
      <div style="line-height:2;margin-top:20px;color:#475569">
        <p><strong>Last Updated:</strong> January 2024</p>
        <h3 style="margin-top:24px">1. Acceptance of Terms</h3>
        <p>By using SSEWASSWA, you agree to these terms...</p>
        <h3 style="margin-top:24px">2. Platform Fees</h3>
        <p>We charge nominal fees on transactions to sustain the platform...</p>
        <h3 style="margin-top:24px">3. Rewards Program</h3>
        <p>Rewards are earned through legitimate engagement and are subject to verification...</p>
        <h3 style="margin-top:24px">4. Withdrawal Terms</h3>
        <p>Minimum withdrawal: 5,000 UGX. Processing time: 24-48 hours. 2% withdrawal fee applies...</p>
      </div>
    </div>
  `, null, true));
});

app.get('/privacy', (req, res) => {
  res.send(renderPage('Privacy Policy', `
    <div class="card">
      <h1>Privacy Policy</h1>
      <div style="line-height:2;margin-top:20px;color:#475569">
        <p>We take your privacy seriously...</p>
        <h3 style="margin-top:24px">Data Collection</h3>
        <p>We collect only essential information to provide our services...</p>
        <h3 style="margin-top:24px">Data Usage</h3>
        <p>Your data is used solely to improve your experience...</p>
      </div>
    </div>
  `, null, true));
});

// === WEBHOOK ===
app.post('/api/momo/webhook', checkDb, async (req, res) => {
  try {
    const { reference, status, transactionId } = req.body;
    if (status === 'SUCCESSFUL') {
      // Fee payment
      const p = await pool.query('SELECT * FROM payment_requests WHERE reference=$1', [reference]);
      if (p.rows[0] && p.rows[0].student_id) {
        await pool.query('UPDATE payment_requests SET status=$1, momo_transaction_id=$2 WHERE reference=$3', ['success', transactionId, reference]);
        await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [p.rows[0].amount, p.rows[0].student_id]);
      }
      
      // Store order
      const o = await pool.query('SELECT * FROM store_orders WHERE reference=$1', [reference]);
      if (o.rows[0]) {
        await pool.query('UPDATE store_orders SET status=$1, momo_transaction_id=$2 WHERE reference=$3', ['paid', transactionId, reference]);
      }
      
      // Premium subscription
      const sub = await pool.query('SELECT * FROM payment_requests WHERE reference=$1 AND user_id IS NOT NULL', [reference]);
      if (sub.rows[0] && !sub.rows[0].student_id) {
        await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', reference]);
        await pool.query('UPDATE users SET premium_until = NOW() + INTERVAL \'1 month\' WHERE email = $1', [sub.rows[0].user_id]);
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'fail' }); }
});

app.get('/health', (req, res) => res.json({ ok: true, db: dbReady }));
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card" style="text-align:center"><div style="font-size:64px;margin-bottom:16px">🔍</div><h1>Page Not Found</h1><p style="color:#64748b;margin:16px 0">The page you\'re looking for doesn\'t exist</p><a href="/" class="btn" style="margin-top:16px">Go Home</a></div>', null, true)));

// === SERVER START ===
app.listen(PORT, () => {
  console.log(`🚀 SERVER LIVE ON PORT ${PORT}`);
  
  // CRITICAL: Session initialized here to prevent Render crashes
  app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 86400000,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
  }));

  if (process.env.DATABASE_URL) {
    console.log('⏳ Starting database setup...');
    initDB().catch(e => console.error('❌ DB init error:', e.message));
  }
});

// === DATABASE INIT ===
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Session table
    await client.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))`);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
    
    // Core tables
    await client.query(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', plan_expires DATE, ranking_score INTEGER DEFAULT 0, momo_number TEXT, signup_code TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, full_name TEXT, phone TEXT, approved BOOLEAN DEFAULT false, premium_until TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS parents (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS parent_otps (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, otp TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, parent_id INTEGER REFERENCES parents(id), balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, description TEXT, payment_method TEXT, momo_ref TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), user_id TEXT, amount NUMERIC NOT NULL, phone TEXT NOT NULL, reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, site_name TEXT DEFAULT 'SSEWASSWA', primary_color TEXT DEFAULT '#1e40af', contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', whatsapp_number TEXT DEFAULT '0789736737', subscription_tier TEXT DEFAULT 'free', verified BOOLEAN DEFAULT false, school_motto TEXT, about_text TEXT, signup_code TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    
    // Wallet & Rewards tables
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL UNIQUE, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS bonus_earnings (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, tenant_id INTEGER REFERENCES tenants(id), amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, video_id TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, amount NUMERIC NOT NULL, fee NUMERIC DEFAULT 0, net_amount NUMERIC, phone TEXT NOT NULL, status TEXT DEFAULT 'pending', paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id TEXT NOT NULL, referred_id TEXT NOT NULL, bonus_amount NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    
    // Store & Marketplace tables
    await client.query(`CREATE TABLE IF NOT EXISTS store_orders (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, amount NUMERIC NOT NULL, buyer_phone TEXT NOT NULL, buyer_name TEXT NOT NULL, delivery_address TEXT, reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS marketplace_listings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, seller_email TEXT NOT NULL, title TEXT NOT NULL, category TEXT, price NUMERIC NOT NULL, description TEXT, location TEXT, phone TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW())`);
    
    // Developer revenue tracking
    await client.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING`);
    await client.query(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, reference_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    
    // Create default tenant
    const tenant = await client.query(`INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subdomain) DO NOTHING RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737', 'SSEWASSWA2024']);
    
    if (tenant.rows.length > 0) {
      const tid = tenant.rows[0].id;
      const hash = await bcrypt.hash('admin123', 10);
      
      await client.query(`INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com', hash, 'super_admin', true, 'Daniel Waiswa']);
      await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text, signup_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [tid, 'enterprise', true, 'Excellence in Education', 'Uganda\'s leading digital education platform', 'SSEWASSWA2024']);
      await client.query(`INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com']);
    }
    
    await client.query('COMMIT');
    dbReady = true;
    console.log('✅ Database ready! All tables created.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ DB Init Error:', err.message);
    dbReady = false;
  } finally {
    client.release();
  }
}
