const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const axios = require('axios');
const Parser = require('rss-parser');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
let dbReady = false;
const parser = new Parser();
const upload = multer({ storage: multer.memoryStorage() });

// DEVELOPER COMMISSION RATES
const DEV_COMMISSION = {
  fee_payment: 0.05, store_purchase: 0.08, marketplace: 0.10, 
  subscription: 0.30, withdrawal_fee: 0.02, game_purchase: 0.15, course_purchase: 0.20
};

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ WARNING: DATABASE_URL missing. Server starting anyway...');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dummy',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000, query_timeout: 5000, statement_timeout: 5000
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1);

// CRITICAL: Session initialized inside app.listen() at the bottom to prevent Render crashes!

const SMS_CONFIG = { apiKey: process.env.SMS_API_KEY || 'demo', username: process.env.SMS_USERNAME || 'sandbox', senderId: 'SSEWASSWA' };
const MOMO_CONFIG = { apiKey: process.env.MOMO_API_KEY || 'demo', baseUrl: 'https://sandbox.momodeveloper.mtn.com' };
const ADS_CONFIG = { pubId: process.env.ADSENSE_ID || 'ca-pub-demo' };
const WHATSAPP_CONFIG = { token: process.env.WHATSAPP_TOKEN || 'demo', phoneId: process.env.WHATSAPP_PHONE_ID || 'demo' };

const i18n = {
  en: { dashboard: 'Dashboard', students: 'Students', fees: 'Fees', attendance: 'Attendance', grades: 'Grades', settings: 'Settings', logout: 'Logout', login: 'Login', add: 'Add', save: 'Save', delete: 'Delete', edit: 'Edit', name: 'Name', class: 'Class', balance: 'Balance', pay: 'Pay', report: 'Report Card', welcome: 'Welcome', bonus: 'Earn Rewards', store: 'Shop', news: 'News', videos: 'Videos', downloads: 'Downloads', timetable: 'Timetable', exams: 'Exams', marketplace: 'Marketplace', learning: 'Learning', premium: 'Premium', home: 'Home', chatbot: 'AI Assistant' },
  lg: { dashboard: 'Dashiboodi', students: 'Abayizi', fees: 'Ebbanja', attendance: 'Okujja', grades: 'Obubonero', settings: 'Enteekateeka', logout: 'Fuluma', login: 'Yingira', add: 'Gattako', save: 'Tereka', delete: 'Ggyawo', edit: 'Kyusa', name: 'Erinnya', class: 'Ekibiina', balance: 'Bbanja', pay: 'Sasula', report: 'Lipoota', welcome: 'Tukwanirizza', bonus: 'Funa Bbonansi', store: 'Dduka', news: 'Amawulire', videos: 'Vidiyo', downloads: 'Wanula', timetable: 'Ggendaani', exams: 'Ebigezo', marketplace: 'Katale', learning: 'Okusoma', premium: 'Muwendo', home: 'Awaka', chatbot: 'Omuddukanya' },
  sw: { dashboard: 'Dashibodi', students: 'Wanafunzi', fees: 'Ada', attendance: 'Mahudhurio', grades: 'Alama', settings: 'Mipangilio', logout: 'Toka', login: 'Ingia', add: 'Ongeza', save: 'Hifadhi', delete: 'Futa', edit: 'Hariri', name: 'Jina', class: 'Darasa', balance: 'Salio', pay: 'Lipa', report: 'Ripoti', welcome: 'Karibu', bonus: 'Pata Bonasi', store: 'Duka', news: 'Habari', videos: 'Video', downloads: 'Pakua', timetable: 'Ratiba', exams: 'Mitihani', marketplace: 'Soko', learning: 'Kujifunza', premium: 'Premium', home: 'Nyumbani', chatbot: 'Msaidizi AI' }
};

function t(key, lang = 'en') { return i18n[lang]?.[key] || i18n.en[key] || key; }
function detectLang(req) {
  const acceptLang = req.headers['accept-language'] || '';
  if (acceptLang.includes('lg')) return 'lg';
  if (acceptLang.includes('sw')) return 'sw';
  return 'en';
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPage(title, content, user = null, isPublic = false, lang = 'en') {
  const adsense = ADS_CONFIG.pubId !== 'ca-pub-demo' ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CONFIG.pubId}" crossorigin="anonymous"></script>` : '';
  
  const nav = user && !isPublic ? `
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <div style="font-weight:700;font-size:18px">${esc(user.tenant_name || 'SSEWASSWA')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px">
        <a href="/" style="color:white;text-decoration:none">🏠 ${t('home',lang)}</a>
        <a href="/app" style="color:white;text-decoration:none">📊 ${t('dashboard',lang)}</a>
        <a href="/app/students" style="color:white;text-decoration:none">🎓 ${t('students',lang)}</a>
        <a href="/app/fees" style="color:white;text-decoration:none">💰 ${t('fees',lang)}</a>
        <a href="/app/attendance" style="color:white;text-decoration:none">✅ ${t('attendance',lang)}</a>
        <a href="/app/grades" style="color:white;text-decoration:none">📝 ${t('grades',lang)}</a>
        <a href="/app/timetable" style="color:white;text-decoration:none">📅 ${t('timetable',lang)}</a>
        <a href="/app/exams" style="color:white;text-decoration:none">📋 ${t('exams',lang)}</a>
        <a href="/learning" style="color:white;text-decoration:none">📚 ${t('learning',lang)}</a>
        <a href="/store" style="color:white;text-decoration:none">🛒 ${t('store',lang)}</a>
        <a href="/marketplace" style="color:white;text-decoration:none">🏪 ${t('marketplace',lang)}</a>
        <a href="/videos" style="color:white;text-decoration:none">🎬 ${t('videos',lang)}</a>
        <a href="/games" style="color:white;text-decoration:none">🎮 Games</a>
        <a href="/news" style="color:white;text-decoration:none">📰 ${t('news',lang)}</a>
        <a href="/bonus" style="color:white;text-decoration:none">🎁 ${t('bonus',lang)}</a>
        <a href="/premium" style="color:white;text-decoration:none">⭐ ${t('premium',lang)}</a>
        <a href="/app/chatbot" style="color:white;text-decoration:none">🤖 ${t('chatbot',lang)}</a>
        <a href="/app/settings" style="color:white;text-decoration:none">⚙️</a>
        <a href="/logout" style="color:white;text-decoration:none">🚪</a>
      </div>
    </div>` : 
  isPublic ? `
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:-24px -24px 24px;flex-wrap:wrap;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <div style="font-weight:700;font-size:18px">SSEWASSWA</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px">
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
  
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${adsense}
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%);color:#1e293b;min-height:100vh}
      .container{max-width:1200px;margin:0 auto;padding:20px}
      .card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05);transition:transform 0.2s}
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
      .badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}.badge-gold{background:#fef3c7;color:#92400e}.badge-blue{background:#dbeafe;color:#1e40af}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
      .hero{background:linear-gradient(135deg,#1e40af 0%,#3b82f6 50%,#60a5fa 100%);color:white;padding:60px 20px;text-align:center;border-radius:20px;margin-bottom:30px}
      .hero h1{font-size:48px;margin-bottom:16px}.hero p{font-size:20px;opacity:0.9;max-width:600px;margin:0 auto 24px}
      .premium-badge{background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700}
      .card-img{width:100%;height:200px;object-fit:cover;border-radius:12px 12px 0 0}
      .chat{height:400px;overflow-y:auto;border:1px solid #e2e8f0;padding:16px;border-radius:12px;margin-bottom:16px;background:#f8fafc}
      .msg{margin:10px 0;padding:12px;border-radius:12px;max-width:80%;box-shadow:0 2px 4px rgba(0,0,0,0.05)}
      .msg-user{background:#dbeafe;margin-left:auto;border-bottom-right-radius:2px}
      .msg-ai{background:white;margin-right:auto;border-bottom-left-radius:2px}
      @media(max-width:768px){.hero h1{font-size:32px}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
      @media print{.btn,nav{display:none!important}body{padding:0;background:white}}
    </style>
  </head><body>${nav}<div class="container">${content}</div>
  <div style="text-align:center;padding:30px;font-size:12px;color:#64748b;background:white;border-top:1px solid #e2e8f0">
    <p>© 2024 SSEWASSWA Platform • <a href="/terms">Terms</a> • <a href="/privacy">Privacy</a></p>
    <p>Languages: <a href="?lang=en">English</a> | <a href="?lang=lg">Luganda</a> | <a href="?lang=sw">Swahili</a></p>
  </div></body></html>`;
}

async function checkDb(req, res, next) {
  if (!dbReady) return res.status(503).send(`<div style="text-align:center;padding:100px"><h1>⏳ Platform Starting...</h1><p>Please wait and <a href="${req.url}">refresh</a>.</p></div>`);
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
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin', 'teacher'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || !['admin', 'super_admin'].includes(req.session.user.role)) return res.status(403).send(renderPage('Forbidden', '<div class="card"><h1>403 Admins Only</h1></div>', { tenant_name: req.tenant?.name }, false, req.lang));
  next();
};

async function sendSMS(phone, message) {
  if (SMS_CONFIG.apiKey === 'demo') { console.log(`[SMS DEMO] ${phone}: ${message}`); return { success: true }; }
  try {
    await axios.post('https://api.africastalking.com/version1/messaging', `username=${SMS_CONFIG.username}&to=${phone}&message=${encodeURIComponent(message)}&from=${SMS_CONFIG.senderId}`, { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return { success: true };
  } catch (e) { console.error('SMS Error:', e.message); return { success: false }; }
}

async function sendWhatsApp(phone, message) {
  if (WHATSAPP_CONFIG.token === 'demo') { console.log(`[WA DEMO] ${phone}: ${message}`); return { success: true }; }
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${WHATSAPP_CONFIG.phoneId}/messages`, { messaging_product: 'whatsapp', to: phone, text: { body: message } }, { headers: { 'Authorization': `Bearer ${WHATSAPP_CONFIG.token}` } });
    return { success: true };
  } catch (e) { console.error('WA Error:', e.message); return { success: false }; }
}

async function sendBulkSMS(tenantId, message) {
  const { rows } = await pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL AND guardian_phone != \'\'', [tenantId]);
  for (const r of rows) { await sendSMS(r.guardian_phone, message); await new Promise(res => setTimeout(res, 200)); }
}

async function addBonus(userId, tenantId, amount, type, description, metaData = {}) {
  await pool.query('INSERT INTO bonus_earnings (user_id, tenant_id, amount, type, description, metadata) VALUES ($1,$2,$3,$4,$5,$6)', [userId, tenantId, amount, type, description, JSON.stringify(metaData)]);
  await pool.query('UPDATE wallets SET balance = balance + $1, updated_at=NOW() WHERE user_email=$2', [amount, userId]);
}

async function addDevCommission(amount, type, description, referenceId = null) {
  await pool.query('INSERT INTO developer_revenue (amount, type, description, reference_id) VALUES ($1,$2,$3,$4)', [amount, type, description, referenceId]);
  await pool.query('UPDATE platform_wallet SET balance = balance + $1, updated_at=NOW() WHERE id=1', [amount]);
}

// === HOMEPAGE ===
app.get('/', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  try {
    const news = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml').catch(() => ({ items: [] }));
    const newsCards = news.items.slice(0, 6).map(item => `<div class="card" style="position:relative"><h4 style="margin-bottom:8px">${esc(item.title)}</h4><p style="color:#64748b;font-size:14px">${esc(item.contentSnippet?.substring(0, 100))}...</p><a href="/bonus/claim/news?url=${encodeURIComponent(item.link)}" class="btn btn-orange" style="font-size:12px;padding:8px 16px" target="_blank">Read & Earn +20 UGX</a></div>`).join('');

    res.send(renderPage('SSEWASSWA Platform', `
      <div class="hero"><h1>🎓 Learn • Shop • Play • Earn</h1><p>Your all-in-one platform for education, entertainment, shopping, and earning rewards!</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/signup" class="btn btn-green" style="font-size:18px;padding:16px 32px">Get Started Free</a><a href="/premium" class="btn btn-gold" style="font-size:18px;padding:16px 32px">⭐ Go Premium</a></div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num">50K+</div><div style="color:#64748b">Active Users</div></div>
        <div class="stat-card"><div class="stat-num">500+</div><div style="color:#64748b">Schools</div></div>
        <div class="stat-card"><div class="stat-num">10M+</div><div style="color:#64748b">Rewards Given</div></div>
        <div class="stat-card"><div class="stat-num">4.8⭐</div><div style="color:#64748b">User Rating</div></div>
      </div>
      <div class="grid">
        ${['📚|Learning Portal|/learning|Free & Premium','🛒|School Store|/store|Fast Delivery','🏪|Marketplace|/marketplace|Earn Commissions','🎬|Watch & Earn|/videos|+50 UGX/video','🎮|Games & Fun|/games|Tournaments','🤖|AI Assistant|/app/chatbot|24/7 Help'].map(c => {const [i,n,l,d]=c.split('|');return `<div class="card" style="text-align:center;cursor:pointer" onclick="location.href='${l}'"><div style="font-size:48px;margin-bottom:12px">${i}</div><h3>${n}</h3><p style="color:#64748b">${d}</p></div>`;}).join('')}
      </div>
      <div class="card" style="margin-top:20px"><h2 style="margin-bottom:20px">📰 Latest News</h2><div class="grid">${newsCards}</div></div>
    `, null, true, lang));
  } catch (e) { res.send(renderPage('SSEWASSWA', '<div class="hero"><h1>🎓 Learn • Shop • Play • Earn</h1></div>', null, true, lang)); }
});

// === AUTH ===
app.get('/login', (req, res) => {
  const lang = req.query.lang || detectLang(req);
  res.send(renderPage(t('login', lang), `<div class="card" style="max-width:450px;margin:40px auto"><div style="text-align:center;margin-bottom:24px"><div style="font-size:60px;margin-bottom:12px">🎓</div><h1>Welcome Back</h1></div><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required /><input name="password" placeholder="Password" type="password" required /><button type="submit" class="btn" style="width:100%;font-size:18px;padding:16px">${t('login', lang)}</button></form><div style="text-align:center;margin-top:20px"><a href="/signup" style="color:#1e40af">Create Account</a> • <a href="/forgot-password" style="color:#64748b">Forgot Password?</a></div></div>`, null, true, lang));
});

app.post('/login', checkDb, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT u.*, t.subdomain, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1 AND u.approved=true', [email]);
    if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) return res.status(401).send(renderPage('Login Failed', '<div class="card" style="max-width:450px;margin:40px auto;text-align:center"><h1>❌ Invalid Credentials</h1><a href="/login" class="btn">Try Again</a></div>', null, true));
    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain, name: user.rows[0].tenant_name };
    res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
  } catch (e) { res.status(500).send("DB Error"); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/signup', (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const ref = req.query.ref;
  res.send(renderPage('Create Account', `<div class="card" style="max-width:500px;margin:40px auto"><div style="text-align:center;margin-bottom:24px"><h1>🚀 Join SSEWASSWA</h1></div><form method="POST" action="/signup">${ref ? `<input type="hidden" name="ref" value="${esc(ref)}">` : ''}<input name="full_name" placeholder="Full Name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone (07XX)" required><input name="password" type="password" placeholder="Password" required minlength="6"><select name="role"><option value="student">Student</option><option value="parent">Parent</option><option value="teacher">Teacher (need code)</option></select><input name="school_code" placeholder="School Code (teachers only)"><button type="submit" class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Create Account</button></form></div>`, null, true, lang));
});

app.post('/signup', checkDb, async (req, res) => {
  try {
    const { full_name, email, phone, password, role, school_code, ref } = req.body;
    let tenantId = 1;
    if (role === 'teacher' && school_code) {
      const tenant = await pool.query('SELECT id FROM tenants WHERE signup_code=$1 OR subdomain=$1', [school_code.toLowerCase()]);
      if (!tenant.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid School Code</h1></div>', null, true));
      tenantId = tenant.rows[0].id;
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role, full_name, phone, approved) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tenantId, email, hash, role, full_name, phone, true]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [tenantId, email]);
    await addBonus(email, tenantId, 100, 'signup', 'Welcome bonus');
    if (ref) { await addBonus(ref, tenantId, 200, 'referral', `Referred ${email}`); await pool.query('INSERT INTO referrals (referrer_id, referred_id, bonus_amount) VALUES ($1,$2,$3)', [ref, email, 200]); }
    res.send(renderPage('Success! 🎉', '<div class="card" style="text-align:center"><div style="font-size:60px;margin-bottom:16px">✅</div><h1>Welcome!</h1><p class="badge badge-green" style="font-size:18px;padding:10px">+100 UGX Bonus Added</p><a href="/login" class="btn btn-green" style="margin-top:20px">Login Now</a></div>', null, true));
  } catch (e) { res.send(renderPage('Error', `<div class="card"><h1>❌ ${e.code === '23505' ? 'Email exists' : 'Error'}</h1></div>`, null, true)); }
});

app.get('/forgot-password', (req, res) => res.send(renderPage('Reset', '<div class="card" style="max-width:450px;margin:40px auto"><h1>Forgot Password</h1><form method="POST" action="/forgot-password"><input name="email" type="email" required><button class="btn" style="width:100%">Send Link</button></form></div>', null, true)));
app.post('/forgot-password', checkDb, async (req, res) => {
  try { const user = await pool.query('SELECT id FROM users WHERE email = $1', [req.body.email]); if (user.rows[0]) { const token = crypto.randomBytes(20).toString('hex'); await pool.query('INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')', [req.body.email, token]); console.log(`🔑 RESET LINK: https://${req.headers.host}/reset-password/${token}`); } res.send(renderPage('Sent', '<div class="card" style="text-align:center"><h1>📧 Check Email</h1></div>', null, true)); } catch (e) { res.status(500).send("Error"); }
});
app.get('/reset-password/:token', checkDb, async (req, res) => { const r = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]); if (!r.rows[0]) return res.send(renderPage('Expired', '<div class="card"><h1>❌ Invalid</h1></div>', null, true)); res.send(renderPage('Reset', `<div class="card" style="max-width:450px;margin:40px auto"><form method="POST" action="/reset-password/${req.params.token}"><input name="password" type="password" required><button class="btn btn-green" style="width:100%">Reset</button></form></div>`, null, true)); });
app.post('/reset-password/:token', checkDb, async (req, res) => { try { const r = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [req.params.token]); if (!r.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid</h1></div>', null, true)); await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [await bcrypt.hash(req.body.password, 10), r.rows[0].email]); await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [r.rows[0].id]); res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>✅ Reset!</h1><a href="/login" class="btn">Login</a></div>', null, true)); } catch (e) { res.status(500).send("Error"); } });

// === PARENT PORTAL ===
app.get('/parent/login', (req, res) => res.send(renderPage('Parent Login', '<div class="card" style="max-width:450px;margin:40px auto"><h1>📱 Parent Login</h1><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XX" required /><button type="submit" class="btn" style="width:100%">Send OTP</button></form></div>', null, true)));
app.post('/parent/send-otp', checkDb, async (req, res) => { try { const otp = Math.floor(100000 + Math.random() * 900000).toString(); await pool.query('INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')', [req.body.phone, otp]); await sendSMS(req.body.phone, `SSEWASSWA OTP: ${otp}`); res.send(renderPage('Verify', `<div class="card" style="max-width:450px;margin:40px auto"><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="${esc(req.body.phone)}"><input name="otp" placeholder="6-digit OTP" required /><button type="submit" class="btn" style="width:100%">Verify</button></form></div>`, null, true)); } catch (e) { res.status(500).send("Error"); } });
app.post('/parent/verify-otp', checkDb, async (req, res) => { try { const r = await pool.query('SELECT * FROM parent_otps WHERE phone=$1 AND otp=$2 AND expires_at > NOW() AND used=false ORDER BY id DESC LIMIT 1', [req.body.phone, req.body.otp]); if (!r.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid OTP</h1></div>', null, true)); await pool.query('UPDATE parent_otps SET used=true WHERE id=$1', [r.rows[0].id]); let p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]); if (!p.rows[0]) { const t = await pool.query('SELECT id FROM tenants WHERE subdomain=$1', ['main']); await pool.query('INSERT INTO parents (phone, verified, tenant_id) VALUES ($1, true, $2)', [req.body.phone, t.rows[0].id]); p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]); } req.session.parent = p.rows[0]; res.redirect('/parent/dashboard'); } catch (e) { res.status(500).send("Error"); } });
app.get('/parent/dashboard', checkDb, async (req, res) => { if (!req.session.parent) return res.redirect('/parent/login'); const s = await pool.query('SELECT * FROM students WHERE parent_id=$1 OR guardian_phone=$2', [req.session.parent.id, req.session.parent.phone]); const c = s.rows.map(x => `<div class="card"><h3>${esc(x.name)}</h3><p>Class: ${esc(x.class)||'-'}</p><p>Balance: <strong class="badge badge-red">UGX ${x.balance}</strong></p><div style="margin-top:12px"><a href="/parent/pay/${x.id}" class="btn btn-green">Pay Fees</a><a href="/app/students/report/${x.id}" class="btn" target="_blank">Report</a></div></div>`).join(''); res.send(renderPage('My Children', `<div class="card"><h1>👨‍👩‍👧‍👦 My Children</h1></div>${c || '<div class="card"><p>No students linked</p></div>'}`)); });
app.get('/parent/pay/:id', checkDb, async (req, res) => { if (!req.session.parent) return res.redirect('/parent/login'); const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0]; if (!s) return res.status(404).send('Not found'); res.send(renderPage('Pay', `<div class="card" style="max-width:500px;margin:40px auto"><h1>💰 Pay for ${esc(s.name)}</h1><p style="font-size:24px">Balance: <strong class="badge badge-red">UGX ${s.balance}</strong></p><form method="POST" action="/parent/pay"><input type="hidden" name="student_id" value="${s.id}"><input name="amount" type="number" required><input name="phone" value="${esc(req.session.parent.phone)}" required><button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay MoMo</button></form></div>`, null, true)); });
app.post('/parent/pay', checkDb, async (req, res) => { if (!req.session.parent) return res.redirect('/parent/login'); try { const { student_id, amount, phone } = req.body; const ref = `FEE-${Date.now()}`; const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0]; await pool.query('INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1,$2,$3,$4,$5)', [s.tenant_id, student_id, amount, phone, ref]); await addDevCommission(Math.round(amount * DEV_COMMISSION.fee_payment), 'fee_payment', `Fee commission`, ref); if (MOMO_CONFIG.apiKey === 'demo') { await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [amount, student_id]); await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]); return res.send(renderPage('Success ✅', '<div class="card" style="text-align:center"><h1>✅ Payment Received!</h1><a href="/parent/dashboard" class="btn">Back</a></div>', null, true)); } res.send(renderPage('Processing', '<div class="card" style="text-align:center"><h1>📱 Check Phone</h1></div>', null, true)); } catch (e) { res.status(500).send("Error"); } });
app.get('/parent/logout', (req, res) => req.session.destroy(() => res.redirect('/parent/login')));

// === REWARDS ===
app.get('/bonus', requireAuth, checkDb, async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
  const e = await pool.query('SELECT * FROM bonus_earnings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [req.session.user.email]);
  const rows = e.rows.map(x => `<tr><td>${new Date(x.created_at).toLocaleDateString()}</td><td><span class="badge badge-blue">${esc(x.type)}</span></td><td class="badge badge-green">+UGX ${x.amount}</td><td>${esc(x.description)}</td></tr>`).join('');
  res.send(renderPage('Rewards Hub 🎁', `
    <div class="hero" style="padding:40px 20px"><h2>My Wallet</h2><div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">UGX ${w.balance}</div><div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap"><a href="/bonus/withdraw" class="btn btn-green">💰 Withdraw</a><a href="/bonus/affiliate" class="btn btn-purple">🔗 Affiliate</a></div></div>
    <div class="grid">${[{i:'🎬',n:'Videos',r:'+50',l:'/videos'},{i:'📰',n:'News',r:'+20',l:'/news'},{i:'📥',n:'Downloads',r:'+100',l:'/downloads'},{i:'🎮',n:'Games',r:'+30',l:'/games'}].map(x=>`<div class="stat-card" onclick="location.href='${x.l}'" style="cursor:pointer"><div style="font-size:36px;margin-bottom:8px">${x.i}</div><div>${x.n}</div><div class="badge badge-green">${x.r} UGX</div></div>`).join('')}</div>
    <div class="card"><h3>Recent Earnings</h3><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Desc</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center">None yet</td></tr>'}</tbody></table></div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.get('/bonus/withdraw', requireAuth, checkDb, async (req, res) => { const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 }; res.send(renderPage('Withdraw', `<div class="card" style="max-width:500px;margin:40px auto"><h1>💰 Withdraw</h1><div style="background:#f8fafc;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px"><div style="color:#64748b">Available</div><div class="stat-num">UGX ${w.balance}</div></div><form method="POST" action="/bonus/withdraw"><input name="amount" type="number" max="${w.balance}" min="5000" placeholder="Min 5,000 UGX" required><input name="phone" placeholder="MoMo (07XX)" required><p style="font-size:12px;color:#64748b">Fee: 2%</p><button class="btn btn-green" style="width:100%">Withdraw</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/bonus/withdraw', requireAuth, checkDb, async (req, res) => { try { const { amount, phone } = req.body; const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0]; if (!w || w.balance < amount || amount < 5000) return res.send(renderPage('Error', '<div class="card"><h1>❌ Invalid Amount</h1></div>')); const fee = Math.round(amount * DEV_COMMISSION.withdrawal_fee); await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_email=$2', [amount, req.session.user.email]); await pool.query('INSERT INTO withdrawals (user_email, amount, phone, fee, net_amount, status) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.email, amount, phone, fee, amount - fee, 'pending']); await addDevCommission(fee, 'withdrawal_fee', 'Withdrawal fee'); res.send(renderPage('Submitted ✅', `<div class="card" style="text-align:center"><h1>✅ Withdrawal Queued</h1><p>Net: UGX ${amount - fee} to ${phone}</p><a href="/bonus" class="btn" style="margin-top:20px">Back</a></div>`, { tenant_name: req.tenant.name }, false, req.lang)); } catch (e) { res.status(500).send("Error"); } });
app.get('/bonus/affiliate', requireAuth, checkDb, async (req, res) => { const link = `https://${req.headers.host}/signup?ref=${req.session.user.email}`; res.send(renderPage('Affiliate 🔗', `<div class="card" style="max-width:600px;margin:40px auto"><h1>🔗 Earn 200 UGX Per Referral</h1><div style="background:#f8fafc;padding:16px;border-radius:12px;margin:20px 0"><input value="${link}" readonly style="margin:0" id="affLink"><button class="btn" onclick="navigator.clipboard.writeText('${link}');this.textContent='✅ Copied!'">Copy</button></div><div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap"><a href="https://wa.me/?text=${encodeURIComponent('Join SSEWASSWA and earn rewards! ' + link)}" class="btn btn-green" target="_blank">WhatsApp</a><a href="https://t.me/share/url?url=${encodeURIComponent(link)}" class="btn" target="_blank">Telegram</a></div></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });

// === VIDEOS & NEWS & DOWNLOADS ===
app.get('/videos', async (req, res) => { const l = req.query.lang || detectLang(req); const v = [{ id: 'dQw4w9WgXcQ', t: 'Math Basics', r: 50 }]; const w = req.session.user ? (await pool.query('SELECT video_id FROM bonus_earnings WHERE user_id=$1 AND type=\'video\'', [req.session.user.email])).rows.map(x => x.video_id) : []; res.send(renderPage('Videos 🎬', `<div class="hero" style="padding:30px"><h1>🎬 Watch & Earn</h1></div><div class="grid">${v.map(x=>`<div class="card" style="padding:0;overflow:hidden"><iframe width="100%" height="200" src="https://www.youtube.com/embed/${x.id}" frameborder="0" allowfullscreen></iframe><div style="padding:16px"><h4>${x.t}</h4>${req.session.user ? (w.includes(x.id)?'<p class="badge badge-green">✅ Claimed</p>':`<a href="/bonus/claim/video/${x.id}" class="btn btn-green">Claim +${x.r}</a>`):''}</div></div>`).join('')}</div>`, null, true, l)); });
app.get('/bonus/claim/video/:id', requireAuth, checkDb, async (req, res) => { if (!(await pool.query('SELECT id FROM bonus_earnings WHERE user_id=$1 AND type=\'video\' AND video_id=$2', [req.session.user.email, req.params.id])).rows[0]) await addBonus(req.session.user.email, req.tenantId, 50, 'video', 'Watched video', { video_id: req.params.id }); res.redirect('/videos'); });
app.get('/news', async (req, res) => { const l = req.query.lang || detectLang(req); try { const f = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml'); const c = f.items.slice(0, 10).map(i => `<div class="card"><h4>${esc(i.title)}</h4><p style="color:#64748b;font-size:14px">${esc(i.contentSnippet?.substring(0, 120))}...</p><a href="/bonus/claim/news?url=${encodeURIComponent(i.link)}" class="btn btn-orange" target="_blank">Read +20</a></div>`).join(''); res.send(renderPage('News 📰', `<div class="hero" style="padding:30px"><h1>📰 News</h1></div><div class="grid">${c}</div>`, null, true, l)); } catch(e) { res.send(renderPage('News', '<div class="card"><h1>Unavailable</h1></div>', null, true, l)); } });
app.get('/bonus/claim/news', requireAuth, checkDb, async (req, res) => { await addBonus(req.session.user.email, req.tenantId, 20, 'news', 'Read article'); res.redirect(req.query.url || '/news'); });
app.get('/downloads', async (req, res) => { const l = req.query.lang || detectLang(req); res.send(renderPage('Downloads 📥', `<div class="hero" style="padding:30px"><h1>📥 Download & Earn</h1></div><div class="grid">${[{n:'Khan Academy',u:'https://play.google.com/store/apps/details?id=org.khanacademy.android',r:100,i:'📚'}].map(a=>`<div class="card" style="display:flex;gap:16px;align-items:center"><div style="font-size:48px">${a.i}</div><div style="flex:1"><h4>${a.n}</h4></div><a href="/bonus/claim/download?url=${encodeURIComponent(a.u)}&name=${encodeURIComponent(a.n)}" class="btn btn-green">Get +${a.r}</a></div>`).join('')}</div>`, null, true, l)); });
app.get('/bonus/claim/download', requireAuth, checkDb, async (req, res) => { await addBonus(req.session.user.email, req.tenantId, 100, 'download', `Downloaded ${req.query.name}`); res.redirect(req.query.url); });

// === GAMES & LEARNING ===
app.get('/games', async (req, res) => { const l = req.query.lang || detectLang(req); res.send(renderPage('Games 🎮', `<div class="hero" style="padding:30px"><h1>🎮 Play & Earn</h1></div><div class="grid">${[{n:'Math Quiz',i:'🧮',r:'+30',id:'quiz'}].map(g=>`<div class="card" style="text-align:center"><div style="font-size:64px;margin-bottom:12px">${g.i}</div><h3>${g.n}</h3><div class="badge badge-gold">${g.r} UGX</div>${req.session.user?`<a href="/games/play/${g.id}" class="btn btn-green" style="margin-top:12px">Play</a>`:''}</div>`).join('')}</div>`, null, true, l); });
app.get('/games/play/:id', requireAuth, checkDb, async (req, res) => { res.send(renderPage('Playing', `<div class="card" style="max-width:600px;margin:40px auto"><h1>🧮 Math Quiz</h1><div id="quiz-area" style="text-align:center;margin:20px 0"><div style="font-size:36px" id="question"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px"><button class="btn" onclick="checkAnswer(this)" id="ans1"></button><button class="btn" onclick="checkAnswer(this)" id="ans2"></button><button class="btn" onclick="checkAnswer(this)" id="ans3"></button><button class="btn" onclick="checkAnswer(this)" id="ans4"></button></div></div><div id="result" style="display:none;text-align:center"><h2>🎉 Won!</h2><p class="badge badge-green" style="font-size:18px">+30 UGX</p><a href="/games" class="btn" style="margin-top:20px">Back</a></div></div><script>let q=[],idx=0;for(let i=0;i<5;i++){let a=Math.floor(Math.random()*20)+1,b=Math.floor(Math.random()*20)+1,o=['+','-','×'][Math.floor(Math.random()*3)],ans=o==='+'?a+b:o==='-'?a-b:a*b;q.push({q:a+' '+o+' '+b+' = ?',ans});}function showQ(){if(idx>=5){document.getElementById('quiz-area').style.display='none';document.getElementById('result').style.display='block';fetch('/bonus/claim/game/quiz').catch(()=>{});return;}let c=q[idx];document.getElementById('question').textContent=c.q;let opts=[c.ans];while(opts.length<4){let w=c.ans+Math.floor(Math.random()*20)-10;if(!opts.includes(w))opts.push(w);}opts.sort(()=>Math.random()-0.5);for(let i=1;i<=4;i++){document.getElementById('ans'+i).textContent=opts[i-1];document.getElementById('ans'+i).dataset.ans=opts[i-1];}}function checkAnswer(btn){idx++;showQ();}showQ();</script>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.get('/bonus/claim/game/:id', requireAuth, checkDb, async (req, res) => { if (!(await pool.query("SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='game' AND metadata->>'game_id'=$2 AND created_at > NOW() - INTERVAL '1 hour'", [req.session.user.email, req.params.id])).rows[0]) await addBonus(req.session.user.email, req.tenantId, 30, 'game', `Played ${req.params.id}`, { game_id: req.params.id }); res.json({ ok: true }); });
app.get('/learning', async (req, res) => { const l = req.query.lang || detectLang(req); res.send(renderPage('Learning 📚', `<div class="hero" style="padding:30px"><h1>📚 Learn Anything</h1></div><div class="grid">${['Mathematics|🔢','Science|🔬','English|📖'].map(c=>{const[n,i]=c.split('|');return `<div class="card" style="text-align:center;cursor:pointer"><div style="font-size:48px;margin-bottom:12px">${i}</div><h3>${n}</h3></div>`;}).join('')}</div>`, null, true, l); });
app.get('/premium', async (req, res) => { res.send(renderPage('⭐ Premium', `<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:40px 20px"><h1>⭐ Go Premium</h1><div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">15,000 UGX<span style="font-size:24px">/mo</span></div></div><div class="card" style="margin-top:20px;text-align:center">${req.session.user?`<form method="POST" action="/premium/subscribe" style="max-width:400px;margin:0 auto"><input name="phone" placeholder="MoMo" required><button class="btn btn-gold" style="width:100%;font-size:18px;padding:16px">Subscribe</button></form>`:'<a href="/login" class="btn btn-gold" style="font-size:18px;padding:16px 32px">Login to Subscribe</a>'}</div>`, null, true)); });
app.post('/premium/subscribe', requireAuth, checkDb, async (req, res) => { try { const { phone } = req.body; const ref = `PREM-${Date.now()}`; await pool.query('INSERT INTO payment_requests (tenant_id, user_id, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.session.user.email, 15000, phone, ref, 'pending']); await addDevCommission(Math.round(15000 * DEV_COMMISSION.subscription), 'subscription', 'Premium', ref); if (MOMO_CONFIG.apiKey === 'demo') { await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]); await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 month' WHERE email = $1", [req.session.user.email]); return res.send(renderPage('Activated ⭐', '<div class="card" style="text-align:center"><h1>⭐ Premium Active!</h1></div>', null, true)); } res.send(renderPage('Processing', '<div class="card" style="text-align:center"><h1>📱 Check Phone</h1></div>', null, true)); } catch (e) { res.status(500).send("Error"); } });

// === STORE ===
app.get('/store', async (req, res) => { const p = [{id:1,n:'Uniform',p:45000,i:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=200&fit=crop'}]; res.send(renderPage('Store 🛒', `<div class="hero" style="padding:30px"><h1>🛒 School Store</h1></div><div class="grid">${p.map(x=>`<div class="card" style="padding:0;overflow:hidden"><img src="${x.i}" class="card-img"><div style="padding:16px"><h4>${x.n}</h4><div class="stat-num" style="font-size:24px">UGX ${x.p.toLocaleString()}</div><a href="/store/buy/${x.id}" class="btn btn-green" style="margin-top:12px">Buy</a></div></div>`).join('')}</div>`, null, true)); });
app.get('/store/buy/:id', async (req, res) => { const p = {1:{n:'Uniform',p:45000}}[req.params.id]; if (!p) return res.status(404).send('Not found'); res.send(renderPage('Checkout', `<div class="card" style="max-width:500px;margin:40px auto"><h1>Buy ${p.n}</h1><p class="stat-num" style="font-size:24px">UGX ${p.p.toLocaleString()}</p><form method="POST" action="/store/buy/${req.params.id}"><input name="phone" placeholder="MoMo" required><input name="name" placeholder="Name" required><button class="btn btn-green" style="width:100%">Pay</button></form></div>`, null, true)); });
app.post('/store/buy/:id', checkDb, async (req, res) => { const p = {1:{n:'Uniform',p:45000}}[req.params.id]; const ref = `STORE-${Date.now()}`; await pool.query('INSERT INTO store_orders (product_id, product_name, amount, buyer_phone, buyer_name, reference, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.params.id, p.n, p.p, req.body.phone, req.body.name, ref, 'pending']); await addDevCommission(Math.round(p.p * DEV_COMMISSION.store_purchase), 'store_purchase', `Store: ${p.n}`, ref); res.send(renderPage('Success ✅', '<div class="card" style="text-align:center"><h1>✅ Order Placed!</h1></div>', null, true)); });

// === MARKETPLACE (DB DRIVEN) ===
app.get('/marketplace', async (req, res) => {
  const lang = req.query.lang || detectLang(req);
  const { rows } = await pool.query('SELECT p.*, t.name as school_name FROM marketplace_products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=true ORDER BY p.id DESC LIMIT 20');
  const cards = rows.map(p => `<div class="card" style="padding:0;overflow:hidden"><img src="${p.image_url||'https://via.placeholder.com/200'}" class="card-img"><div style="padding:16px"><span class="badge badge-blue" style="margin-bottom:8px">By ${esc(p.school_name)}</span><h4>${esc(p.name)}</h4><div class="stat-num" style="font-size:24px;margin:12px 0">UGX ${p.price}</div><a href="/marketplace/buy/${p.id}" class="btn btn-green" style="width:100%">Buy Now</a></div></div>`).join('');
  res.send(renderPage('Marketplace 🏪', `<div class="hero" style="padding:30px"><h1>🏪 Marketplace</h1><p>Buy from schools. 10% supports platform.</p>${req.session.user ? '<a href="/marketplace/sell" class="btn btn-purple" style="margin-top:12px">➕ Sell Product</a>' : ''}</div><div class="grid">${cards || '<div class="card"><p>No products yet</p></div>'}</div>`, null, true, lang));
});

app.get('/marketplace/sell', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Sell Product', `<div class="card" style="max-width:500px;margin:40px auto"><h1>➕ List Product</h1><p style="color:#64748b">10% commission on sales</p><form method="POST" action="/marketplace/sell"><input name="name" placeholder="Product Name" required><input name="price" type="number" placeholder="Price UGX" required><input name="image_url" placeholder="Image URL"><textarea name="description" placeholder="Description" rows="3"></textarea><button class="btn btn-green" style="width:100%">Submit for Approval</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/marketplace/sell', requireAuth, requireAdmin, checkDb, async (req, res) => {
  await pool.query('INSERT INTO marketplace_products (tenant_id, name, price, image_url, description, approved) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.body.name, req.body.price, req.body.image_url, req.body.description, false]);
  res.send(renderPage('Submitted ✅', '<div class="card" style="text-align:center"><h1>✅ Submitted!</h1><p>Admin will approve within 24hrs.</p><a href="/marketplace" class="btn" style="margin-top:20px">View Marketplace</a></div>', { tenant_name: req.tenant.name }, false, req.lang));
});

app.get('/marketplace/buy/:id', async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  res.send(renderPage('Buy Item', `<div class="card" style="max-width:500px;margin:40px auto"><h1>Buy ${esc(p.name)}</h1><p class="stat-num" style="font-size:24px">UGX ${p.price.toLocaleString()}</p><form method="POST" action="/marketplace/buy/${p.id}"><input name="phone" placeholder="MoMo" required><button class="btn btn-green" style="width:100%">Pay</button></form></div>`, null, true));
});

app.post('/marketplace/buy/:id', checkDb, async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  const ref = `MKT-${Date.now()}`;
  await pool.query('INSERT INTO payment_requests (tenant_id, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5)', [p.tenant_id, p.price, req.body.phone, ref, 'pending']);
  await addDevCommission(Math.round(p.price * DEV_COMMISSION.marketplace), 'marketplace', `Marketplace: ${p.name}`, ref);
  res.send(renderPage('Success ✅', '<div class="card" style="text-align:center"><h1>✅ Prompt Sent!</h1></div>', null, true));
});

// === DASHBOARD ===
app.get('/app', requireAuth, checkDb, async (req, res) => {
  try {
    const s = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [req.tenantId]);
    const f = await pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS t FROM fees WHERE tenant_id=$1', [req.tenantId]);
    const a = await pool.query('SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status=\'present\'', [req.tenantId]);
    const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
    res.send(renderPage('Dashboard', `
      <div class="stats">
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎓</div><div>Students</div><div class="stat-num">${s.rows[0].c}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">💰</div><div>Fees</div><div class="stat-num">UGX ${f.rows[0].t}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">✅</div><div>Present</div><div class="stat-num">${a.rows[0].c}</div></div>
        <div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎁</div><div>Rewards</div><div class="stat-num">UGX ${w.balance}</div></div>
      </div>
      <div class="card"><h1>Quick Actions</h1><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"><a href="/app/students/add" class="btn btn-green">➕ Student</a><a href="/app/fees/add" class="btn">💰 Fee</a><a href="/app/attendance/mark" class="btn">✅ Attend</a><a href="/app/grades/add" class="btn">📝 Grade</a><a href="/app/timetable/add" class="btn btn-orange">📅 Timetable</a><a href="/app/exams/add" class="btn btn-purple">📋 Exam</a><a href="/bonus" class="btn btn-purple">🎁 Rewards</a></div></div>
    `, { tenant_name: req.tenant.name }, false, req.lang));
  } catch (e) { res.status(500).send("Error"); }
});

// === STUDENTS ===
app.get('/app/students', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY id DESC', [req.tenantId]);
  const t = rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.guardian_phone)}</td><td>UGX ${s.balance}</td><td><a href="/app/students/report/${s.id}" class="btn" style="font-size:12px;padding:8px">Report</a> <a href="/app/students/edit/${s.id}" class="btn btn-orange" style="font-size:12px;padding:8px">Edit</a> <a href="/app/students/delete/${s.id}" class="btn btn-red" style="font-size:12px;padding:8px" onclick="return confirm('Del?')">Del</a></td></tr>`).join('');
  res.send(renderPage('Students', `<div class="card"><h1>Students</h1><div style="display:flex;gap:8px;margin-bottom:16px"><a href="/app/students/add" class="btn btn-green">Add</a><a href="/app/students/bulk" class="btn btn-purple">Bulk CSV</a><a href="/app/students/export" class="btn btn-orange">Export</a></div><table><thead><tr><th>Name</th><th>Class</th><th>Phone</th><th>Balance</th><th>Actions</th></tr></thead><tbody>${t || '<tr><td colspan="5">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.get('/app/students/add', requireAuth, requireStaff, (req, res) => res.send(renderPage('Add', `<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" required><input name="class"><input name="guardian_name"><input name="guardian_phone"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)));
app.post('/app/students/add', requireAuth, requireStaff, checkDb, async (req, res) => { try { await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, req.body.name, req.body.class, req.body.guardian_name, req.body.guardian_phone]); if (req.body.guardian_phone) await sendSMS(req.body.guardian_phone, `${req.body.name} registered.`); res.redirect('/app/students'); } catch (e) { res.status(500).send("Error"); } });
app.get('/app/students/edit/:id', requireAuth, requireStaff, checkDb, async (req, res) => { const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0]; if (!s) return res.status(404).send('Not found'); res.send(renderPage('Edit', `<div class="card" style="max-width:500px"><h1>Edit ${esc(s.name)}</h1><form method="POST" action="/app/students/edit/${s.id}"><input name="name" value="${esc(s.name)}" required><input name="class" value="${esc(s.class)}"><input name="guardian_name" value="${esc(s.guardian_name)}"><input name="guardian_phone" value="${esc(s.guardian_phone)}"><button class="btn btn-green" style="width:100%">Update</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/app/students/edit/:id', requireAuth, requireStaff, checkDb, async (req, res) => { await pool.query('UPDATE students SET name=$1, class=$2, guardian_name=$3, guardian_phone=$4 WHERE id=$5 AND tenant_id=$6', [req.body.name, req.body.class, req.body.guardian_name, req.body.guardian_phone, req.params.id, req.tenantId]); res.redirect('/app/students'); });
app.get('/app/students/delete/:id', requireAuth, requireAdmin, checkDb, async (req, res) => { await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]); res.redirect('/app/students'); });
app.get('/app/students/export', requireAuth, checkDb, async (req, res) => { const { rows } = await pool.query('SELECT name, class, guardian_name, guardian_phone, balance FROM students WHERE tenant_id=$1', [req.tenantId]); let csv = 'Name,Class,Guardian,Phone,Balance\n'; rows.forEach(s => { csv += `"${s.name}","${s.class||''}","${s.guardian_name||''}","${s.guardian_phone||''}",${s.balance}\n`; }); res.header('Content-Type', 'text/csv').attachment('students.csv').send(csv); });
app.get('/app/students/report/:id', requireAuth, checkDb, async (req, res) => { try { const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0]; if (!s) return res.status(404).send('Not found'); const g = await pool.query('SELECT * FROM grades WHERE student_id=$1 ORDER BY year DESC, term DESC', [req.params.id]); const f = await pool.query('SELECT * FROM fees WHERE student_id=$1 ORDER BY year DESC', [req.params.id]); const a = await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p, COUNT(*) as t FROM attendance WHERE student_id=$1", [req.params.id]); const pct = a.rows[0].t > 0 ? Math.round((a.rows[0].p / a.rows[0].t) * 100) : 0; res.send(renderPage(`Report: ${s.name}`, `<div class="card" style="text-align:center"><h1>${esc(req.tenant.name)}</h1><h2>REPORT CARD</h2><p><strong>Name:</strong> ${esc(s.name)} | <strong>Class:</strong> ${esc(s.class)} | <strong>Balance:</strong> UGX ${s.balance}</p><p><strong>Attendance:</strong> ${pct}%</p></div><div class="card"><h3>Academics</h3><table><thead><tr><th>Subject</th><th>Score</th><th>Term</th><th>Year</th></tr></thead><tbody>${g.rows.map(x=>`<tr><td>${esc(x.subject)}</td><td>${x.score}</td><td>${esc(x.term)}</td><td>${x.year}</td></tr>`).join('')||'<tr><td colspan="4">No grades</td></tr>'}</tbody></table></div><div class="card"><h3>Fees</h3><table><thead><tr><th>Term</th><th>Due</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${f.rows.map(x=>`<tr><td>${esc(x.term)} ${x.year}</td><td>${x.amount}</td><td>${x.paid}</td><td>${x.amount-x.paid}</td></tr>`).join('')}</tbody></table></div><div class="card" style="text-align:center"><button onclick="window.print()" class="btn btn-green">Print</button></div>`, { tenant_name: req.tenant.name }, false, req.lang)); } catch (e) { res.status(500).send("Error"); } });

// === BULK STUDENT UPLOAD ===
app.get('/app/students/bulk', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Bulk Upload', `<div class="card" style="max-width:600px"><h1>📂 Bulk Upload Students</h1><p style="color:#64748b;margin-bottom:16px">CSV format: name,class,guardian_name,guardian_phone</p><form method="POST" action="/app/students/bulk" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv" required style="padding:20px;border:2px dashed #cbd5e1;background:#f8fafc"><button class="btn btn-green" style="width:100%">Upload & Import</button></form><a href="/app/students/template.csv" class="btn btn-orange" style="margin-top:12px">Download Template</a></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.get('/app/students/template.csv', (req, res) => res.header('Content-Type', 'text/csv').attachment('students_template.csv').send('name,class,guardian_name,guardian_phone\nJohn Doe,P.4,Jane Doe,0772123456\n'));
app.post('/app/students/bulk', requireAuth, requireAdmin, upload.single('csv'), checkDb, async (req, res) => {
  try {
    const results = [];
    const stream = Readable.from(req.file.buffer.toString());
    stream.pipe(csv()).on('data', (data) => results.push(data)).on('end', async () => {
      for (const row of results) { if(row.name) await pool.query('INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, row.name, row.class, row.guardian_name, row.guardian_phone]); }
      res.send(renderPage('Uploaded ✅', `<div class="card" style="text-align:center"><h1>✅ Imported ${results.length} Students!</h1><a href="/app/students" class="btn" style="margin-top:20px">View Students</a></div>`, { tenant_name: req.tenant.name }, false, req.lang));
    });
  } catch (e) { res.status(500).send("Error"); }
});

// === FEES, ATTENDANCE, GRADES, SETTINGS ===
app.get('/app/fees', requireAuth, checkDb, async (req, res) => { const { rows } = await pool.query('SELECT f.*, s.name as sn FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.id DESC LIMIT 50', [req.tenantId]); res.send(renderPage('Fees', `<div class="card"><h1>Fees</h1><a href="/app/fees/add" class="btn btn-green">Record</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Due</th><th>Paid</th><th>Term</th><th>Method</th></tr></thead><tbody>${rows.map(f=>`<tr><td>${esc(f.sn)}</td><td>${f.amount}</td><td>${f.paid}</td><td>${esc(f.term)}</td><td>${esc(f.payment_method)}</td></tr>`).join('')||'<tr><td colspan="5">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.get('/app/fees/add', requireAuth, requireStaff, checkDb, async (req, res) => { const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]); res.send(renderPage('Record', `<div class="card" style="max-width:500px"><h1>Record Fee</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select</option>${s.rows.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input name="amount" type="number" required><input name="paid" type="number" required><input name="term"><input name="year" type="number" value="${new Date().getFullYear()}"><select name="payment_method"><option>Cash</option><option>MoMo</option><option>Bank</option></select><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/app/fees/add', requireAuth, requireStaff, checkDb, async (req, res) => { try { const { student_id, amount, paid, term, year, payment_method } = req.body; const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0]; await pool.query('INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.tenantId, student_id, amount, paid, term, year, payment_method]); await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [paid, student_id]); if (s.guardian_phone) await sendSMS(s.guardian_phone, `Payment of UGX ${paid} received for ${s.name}.`); res.redirect('/app/fees'); } catch (e) { res.status(500).send("Error"); } });
app.get('/app/attendance', requireAuth, checkDb, async (req, res) => { const { rows } = await pool.query('SELECT a.*, s.name FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date=CURRENT_DATE', [req.tenantId]); res.send(renderPage('Attendance', `<div class="card"><h1>Today</h1><a href="/app/attendance/mark" class="btn btn-green">Mark</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.name)}</td><td><span class="badge ${a.status==='present'?'badge-green':'badge-red'}">${a.status}</span></td></tr>`).join('')||'<tr><td colspan="2">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.get('/app/attendance/mark', requireAuth, requireStaff, checkDb, async (req, res) => { const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]); res.send(renderPage('Mark', `<div class="card" style="max-width:500px"><h1>Mark Attendance</h1><form method="POST" action="/app/attendance/mark">${s.rows.map(x=>`<label style="display:block;margin:8px 0"><input type="checkbox" name="p_${x.id}" checked> ${esc(x.name)}</label>`).join('')}<button class="btn btn-green" style="width:100%;margin-top:16px">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/app/attendance/mark', requireAuth, requireStaff, checkDb, async (req, res) => { try { const s = await pool.query('SELECT id FROM students WHERE tenant_id=$1', [req.tenantId]); await pool.query('DELETE FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE', [req.tenantId]); for (const x of s.rows) { await pool.query('INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1,$2,CURRENT_DATE,$3)', [req.tenantId, x.id, req.body[`p_${x.id}`] ? 'present' : 'absent']); } res.redirect('/app/attendance'); } catch (e) { res.status(500).send("Error"); } });
app.get('/app/grades', requireAuth, checkDb, async (req, res) => { const { rows } = await pool.query('SELECT g.*, s.name as sn FROM grades g JOIN students s ON g.student_id=s.id WHERE g.tenant_id=$1 ORDER BY g.id DESC LIMIT 50', [req.tenantId]); res.send(renderPage('Grades', `<div class="card"><h1>Grades</h1><a href="/app/grades/add" class="btn btn-green">Add</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th></tr></thead><tbody>${rows.map(g=>`<tr><td>${esc(g.sn)}</td><td>${esc(g.subject)}</td><td>${g.score}</td><td>${esc(g.term)}</td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.get('/app/grades/add', requireAuth, requireStaff, checkDb, async (req, res) => { const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1', [req.tenantId]); res.send(renderPage('Add Grade', `<div class="card" style="max-width:500px"><h1>Add Grade</h1><form method="POST" action="/app/grades/add"><select name="student_id" required><option value="">Select</option>${s.rows.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input name="subject" required><input name="score" type="number" required><input name="term"><input name="year" type="number" value="${new Date().getFullYear()}"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/app/grades/add', requireAuth, requireStaff, checkDb, async (req, res) => { try { await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.body.student_id, req.body.subject, req.body.score, req.body.term, req.body.year]); res.redirect('/app/grades'); } catch (e) { res.status(500).send("Error"); } });
app.get('/app/settings', requireAuth, requireAdmin, checkDb, async (req, res) => { const s = (await pool.query('SELECT * FROM settings WHERE tenant_id=$1', [req.tenantId])).rows[0]; const t = (await pool.query('SELECT signup_code FROM tenants WHERE id=$1', [req.tenantId])).rows[0]; res.send(renderPage('Settings', `<div class="card" style="max-width:500px"><h1>Settings</h1><form method="POST" action="/app/settings"><input name="school_motto" value="${esc(s.school_motto)}" placeholder="Motto"><textarea name="about_text" rows="4">${esc(s.about_text)}</textarea><input name="contact_email" value="${esc(s.contact_email)}"><input name="whatsapp_number" value="${esc(s.whatsapp_number)}"><input name="signup_code" value="${esc(t.signup_code||'')}" placeholder="Teacher Code"><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang)); });
app.post('/app/settings', requireAuth, requireAdmin, checkDb, async (req, res) => { await pool.query('UPDATE settings SET school_motto=$1, about_text=$2, contact_email=$3, whatsapp_number=$4 WHERE tenant_id=$5', [req.body.school_motto, req.body.about_text, req.body.contact_email, req.body.whatsapp_number, req.tenantId]); await pool.query('UPDATE tenants SET signup_code=$1 WHERE id=$2', [req.body.signup_code.toUpperCase(), req.tenantId]); res.redirect('/app/settings'); });

// === TIMETABLE ===
app.get('/app/timetable', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM timetable WHERE tenant_id=$1 ORDER BY day,period', [req.tenantId]);
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const table = days.map(day => {
    const dayRows = rows.filter(r => r.day === day);
    return `<tr><td><strong>${day}</strong></td>${[1,2,3,4,5,6,7,8].map(p => { const slot = dayRows.find(r => r.period === p); return `<td>${slot ? `${esc(slot.subject)}<br><small>${esc(slot.teacher)}</small>` : ''}</td>`; }).join('')}</tr>`;
  }).join('');
  res.send(renderPage('Timetable 📅', `<div class="card"><h1>School Timetable</h1><a href="/app/timetable/add" class="btn btn-green">Add Slot</a><table style="margin-top:16px;font-size:12px"><thead><tr><th>Day</th>${[1,2,3,4,5,6,7,8].map(p=>`<th>P${p}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.get('/app/timetable/add', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Add Slot', `<div class="card" style="max-width:500px"><h1>📅 Add Timetable Slot</h1><form method="POST" action="/app/timetable/add"><select name="day" required><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option></select><input name="period" type="number" min="1" max="8" placeholder="Period 1-8" required><input name="subject" placeholder="Subject" required><input name="class" placeholder="Class" required><input name="teacher" placeholder="Teacher" required><button class="btn btn-green" style="width:100%">Save</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.post('/app/timetable/add', requireAuth, requireStaff, checkDb, async (req, res) => { await pool.query('INSERT INTO timetable (tenant_id, day, period, subject, class, teacher) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId, req.body.day, req.body.period, req.body.subject, req.body.class, req.body.teacher]); res.redirect('/app/timetable'); });

// === EXAMS ===
app.get('/app/exams', requireAuth, checkDb, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM exams WHERE tenant_id=$1 ORDER BY date DESC', [req.tenantId]);
  res.send(renderPage('Exams 📋', `<div class="card"><h1>Exam Schedule</h1><a href="/app/exams/add" class="btn btn-green">Schedule Exam</a><table style="margin-top:16px"><thead><tr><th>Date</th><th>Subject</th><th>Class</th><th>Time</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${new Date(e.date).toLocaleDateString()}</td><td>${esc(e.subject)}</td><td>${esc(e.class)}</td><td>${esc(e.time)}</td></tr>`).join('')||'<tr><td colspan="4">No exams</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.get('/app/exams/add', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Schedule Exam', `<div class="card" style="max-width:500px"><h1>📋 Schedule Exam</h1><p style="color:#64748b;margin-bottom:16px">Sends SMS alert to all parents automatically!</p><form method="POST" action="/app/exams/add"><input name="date" type="date" required><input name="subject" placeholder="Subject" required><input name="class" placeholder="Class" required><input name="time" placeholder="Time e.g. 9:00 AM" required><button class="btn btn-green" style="width:100%">Save & Notify Parents</button></form></div>`, { tenant_name: req.tenant.name }, false, req.lang));
});
app.post('/app/exams/add', requireAuth, requireStaff, checkDb, async (req, res) => {
  await pool.query('INSERT INTO exams (tenant_id, date, subject, class, time) VALUES ($1,$2,$3,$4,$5)', [req.tenantId, req.body.date, req.body.subject, req.body.class, req.body.time]);
  await sendBulkSMS(req.tenantId, `Exam Alert: ${req.body.subject} for ${req.body.class} on ${req.body.date} at ${req.body.time}`);
  res.redirect('/app/exams');
});

// === AI CHATBOT ===
app.get('/app/chatbot', requireAuth, (req, res) => {
  res.send(renderPage('AI Assistant 🤖', `
    <div class="card" style="max-width:700px;margin:0 auto">
      <h1>🤖 School AI Assistant</h1>
      <p style="color:#64748b;margin-bottom:16px">Ask about balances, attendance, or fees (e.g. "What's John's balance?")</p>
      <div class="chat" id="chat"><div class="msg msg-ai">Hello! How can I help you today?</div></div>
      <form onsubmit="sendMsg(event)" style="display:flex;gap:12px"><input id="msg" placeholder="Type a question..." required style="margin:0;flex:1"><button class="btn" type="submit">Send</button></form>
    </div>
    <script>
      async function sendMsg(e){
        e.preventDefault();
        const m=document.getElementById('msg').value;
        document.getElementById('chat').innerHTML+=\`<div class="msg msg-user">\${m}</div>\`;
        document.getElementById('msg').value='';
        document.getElementById('chat').innerHTML+=\`<div class="msg msg-ai">Typing...</div>\`;
        const r=await fetch('/api/chatbot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})});
        const d=await r.json();
        document.getElementById('chat').lastChild.innerHTML=d.reply;
        document.getElementById('chat').scrollTop=document.getElementById('chat').scrollHeight;
      }
    </script>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/api/chatbot', requireAuth, checkDb, async (req, res) => {
  const msg = req.body.message.toLowerCase();
  let reply = "I can help with balances, attendance, and fees. Try: 'John Doe balance'";
  
  const balMatch = msg.match(/(\w+\s+\w+).*balance/);
  if (balMatch) {
    const name = balMatch[1];
    const s = await pool.query('SELECT name,balance FROM students WHERE LOWER(name) LIKE $1 AND tenant_id=$2 LIMIT 1', [`%${name}%`, req.tenantId]);
    reply = s.rows[0] ? `${s.rows[0].name} has a balance of <strong>UGX ${s.rows[0].balance}</strong>` : `No student found matching "${name}"`;
  }

  const attMatch = msg.match(/(\w+\s+\w+).*attendance/);
  if (attMatch) {
    const name = attMatch[1];
    const s = await pool.query('SELECT id,name FROM students WHERE LOWER(name) LIKE $1 AND tenant_id=$2 LIMIT 1', [`%${name}%`, req.tenantId]);
    if (s.rows[0]) {
      const a = await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p, COUNT(*) as t FROM attendance WHERE student_id=$1", [s.rows[0].id]);
      const pct = a.rows[0].t > 0 ? Math.round((a.rows[0].p / a.rows[0].t) * 100) : 0;
      reply = `${s.rows[0].name} attendance: <strong>${pct}%</strong> (${a.rows[0].p}/${a.rows[0].t} days)`;
    }
  }
  res.json({ reply });
});

// === WHATSAPP & USSD WEBHOOKS ===
app.post('/webhook/whatsapp', checkDb, async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    const from = msg.from;
    const text = msg.text?.body?.toLowerCase() || '';
    let reply = "Welcome to SSEWASSWA! Send:\n1. BALANCE [name]\n2. ATTENDANCE [name]";
    if (text.startsWith('balance')) { const n = text.replace('balance','').trim(); const s = await pool.query('SELECT name,balance FROM students WHERE LOWER(name) LIKE $1 LIMIT 1', [`%${n}%`]); reply = s.rows[0] ? `${s.rows[0].name}: UGX ${s.rows[0].balance}` : 'Student not found'; }
    if (text.startsWith('attendance')) { const n = text.replace('attendance','').trim(); const s = await pool.query('SELECT id,name FROM students WHERE LOWER(name) LIKE $1 LIMIT 1', [`%${n}%`]); if(s.rows[0]){const a=await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p, COUNT(*) as t FROM attendance WHERE student_id=$1",[s.rows[0].id]); reply=`${s.rows[0].name}: ${a.rows[0].p}/${a.rows[0].t} days`;} }
    await sendWhatsApp(from, reply);
    res.sendStatus(200);
  } catch (e) { res.sendStatus(200); }
});
app.get('/webhook/whatsapp', (req, res) => { if (req.query['hub.verify_token'] === 'ssewasswa_verify_token') res.send(req.query['hub.challenge']); else res.sendStatus(403); });

app.post('/ussd', checkDb, async (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  let response = '';
  if (text === '') response = `CON Welcome to SSEWASSWA\n1. Check Balance\n2. Pay Fees`;
  else if (text === '1') response = `CON Enter student name:`;
  else if (text.startsWith('1*')) { const n = text.split('*')[1]; const s = await pool.query('SELECT name,balance FROM students WHERE LOWER(name) LIKE $1 LIMIT 1', [`%${n.toLowerCase()}%`]); response = s.rows[0] ? `END ${s.rows[0].name}\nBalance: UGX ${s.rows[0].balance}` : 'END Student not found'; }
  else if (text === '2') response = `END Dial *165*3# and use merchant code 123456`;
  else response = `END Invalid option`;
  res.set('Content-Type', 'text/plain').send(response);
});

// === SUPER ADMIN ===
app.get('/super-admin', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => {
  const rev = (await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue')).rows[0].t;
  const pend = (await pool.query('SELECT COUNT(*) as c FROM withdrawals WHERE status=\'pending\'')).rows[0].c;
  res.send(renderPage('Super Admin', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:40px 20px"><h1>👑 Super Admin</h1><p>Platform Revenue: <strong>UGX ${rev.toLocaleString()}</strong></p></div>
    <div class="grid">
      <div class="card"><h3>Management</h3><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px"><a href="/super-admin/tenants" class="btn">🏫 Schools</a><a href="/super-admin/users" class="btn">👥 Users</a><a href="/super-admin/bonuses" class="btn btn-purple">💰 Payouts (${pend})</a><a href="/super-admin/marketplace" class="btn btn-orange">🏪 Marketplace Approvals</a><a href="/create-site" class="btn btn-green">➕ Add School</a></div></div>
      <div class="card"><h3>Commission Rates</h3><table style="margin-top:12px"><tbody><tr><td>Fees</td><td>5%</td></tr><tr><td>Store</td><td>8%</td></tr><tr><td>Marketplace</td><td>10%</td></tr><tr><td>Premium</td><td>30%</td></tr><tr><td>Withdrawals</td><td>2%</td></tr></tbody></table></div>
    </div>
  `, { tenant_name: req.tenant.name }));
});
app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { const { rows } = await pool.query('SELECT * FROM tenants ORDER BY id'); res.send(renderPage('Schools', `<div class="card"><table><thead><tr><th>Name</th><th>Sub</th><th>Plan</th><th>Code</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.subdomain)}</td><td>${esc(r.plan)}</td><td>${esc(r.signup_code)}</td></tr>`).join('')}</tbody></table></div>`, { tenant_name: req.tenant.name })); });
app.get('/super-admin/users', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { const { rows } = await pool.query('SELECT u.email, u.role, u.approved, t.name as school FROM users u JOIN tenants t ON u.tenant_id = t.id'); res.send(renderPage('Users', `<div class="card"><table><thead><tr><th>Email</th><th>Role</th><th>School</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.email)}</td><td>${esc(r.role)}</td><td>${esc(r.school)}</td><td>${r.approved?'<span class="badge badge-green">Active</span>':'<span class="badge badge-red">Pending</span>'}</td></tr>`).join('')}</tbody></table></div>`, { tenant_name: req.tenant.name })); });
app.get('/super-admin/bonuses', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { const w = await pool.query('SELECT * FROM withdrawals WHERE status=\'pending\' ORDER BY created_at DESC'); res.send(renderPage('Payouts', `<div class="card"><h1>Pending Withdrawals</h1><table style="margin-top:16px"><thead><tr><th>User</th><th>Amount</th><th>Fee</th><th>Net</th><th>Phone</th><th>Action</th></tr></thead><tbody>${w.rows.map(x=>`<tr><td>${esc(x.user_email)}</td><td>UGX ${x.amount}</td><td>UGX ${x.fee}</td><td>UGX ${x.net_amount}</td><td>${esc(x.phone)}</td><td><a href="/super-admin/payout/${x.id}" class="btn btn-green" style="font-size:12px;padding:8px">Pay</a></td></tr>`).join('')||'<tr><td colspan="6">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name })); });
app.get('/super-admin/payout/:id', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { await pool.query('UPDATE withdrawals SET status=\'paid\', paid_at=NOW() WHERE id=$1', [req.params.id]); res.redirect('/super-admin/bonuses'); });
app.get('/super-admin/marketplace', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { const { rows } = await pool.query('SELECT p.*, t.name as school FROM marketplace_products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=false ORDER BY p.id DESC'); res.send(renderPage('Mkt Approvals', `<div class="card"><h1>Pending Products</h1><table style="margin-top:16px"><thead><tr><th>Product</th><th>School</th><th>Price</th><th>Action</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.school)}</td><td>UGX ${x.price}</td><td><a href="/super-admin/mkt-approve/${x.id}" class="btn btn-green" style="font-size:12px;padding:8px">Approve</a></td></tr>`).join('')||'<tr><td colspan="4">None</td></tr>'}</tbody></table></div>`, { tenant_name: req.tenant.name })); });
app.get('/super-admin/mkt-approve/:id', requireAuth, requireRole('super_admin'), checkDb, async (req, res) => { await pool.query('UPDATE marketplace_products SET approved=true WHERE id=$1', [req.params.id]); res.redirect('/super-admin/marketplace'); });

app.get('/create-site', (req, res) => res.send(renderPage('Create School', `<div class="card" style="max-width:500px;margin:40px auto"><h1>🏫 Register School</h1><form method="POST" action="/create-site"><input name="name" required><input name="subdomain" required><input name="admin_email" type="email" required><input name="admin_password" type="password" required><input name="momo_number"><input name="signup_code" required><button class="btn" style="width:100%">Create</button></form></div>`, null, true)));
app.post('/create-site', checkDb, async (req, res) => { try { const { name, subdomain, admin_email, admin_password, momo_number, signup_code } = req.body; if (!name||!subdomain||!admin_email||!admin_password||!signup_code) return res.send(renderPage('Error', '<div class="card"><h1>❌ Fields missing</h1></div>', null, true)); const t = await pool.query('INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number, signup_code.toUpperCase()]); await pool.query('INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name) VALUES ($1,$2,$3,$4,$5,$6)', [t.rows[0].id, admin_email, await bcrypt.hash(admin_password, 10), 'admin', true, name+' Admin']); await pool.query('INSERT INTO settings (tenant_id, signup_code) VALUES ($1,$2)', [t.rows[0].id, signup_code.toUpperCase()]); await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [t.rows[0].id, admin_email]); res.send(renderPage('Success ✅', `<div class="card" style="text-align:center"><h1>✅ Created!</h1><p>Teacher Code: <strong>${signup_code.toUpperCase()}</strong></p><a href="/login" class="btn" style="margin-top:20px">Login</a></div>`, null, true)); } catch (e) { res.send(renderPage('Error', `<div class="card"><h1>❌ ${e.code === '23505' ? 'Taken' : 'Error'}</h1></div>`, null, true)); } });

app.post('/api/momo/webhook', checkDb, async (req, res) => {
  try { const { reference, status, transactionId } = req.body; if (status === 'SUCCESSFUL') { const p = await pool.query('SELECT * FROM payment_requests WHERE reference=$1', [reference]); if (p.rows[0]) { await pool.query('UPDATE payment_requests SET status=$1, momo_transaction_id=$2 WHERE reference=$3', ['success', transactionId, reference]); if (p.rows[0].student_id) await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [p.rows[0].amount, p.rows[0].student_id]); if (p.rows[0].user_id && reference.startsWith('PREM')) await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 month' WHERE email = $1", [p.rows[0].user_id]); } } res.json({ ok: true }); } catch (e) { res.status(500).json({ error: 'fail' }); }
});

app.get('/health', (req, res) => res.json({ ok: true, db: dbReady }));
app.get('/school/:sub', checkDb, async (req, res) => { const t = (await pool.query('SELECT t.*, s.school_motto, s.about_text FROM tenants t LEFT JOIN settings s ON t.id=s.tenant_id WHERE t.subdomain=$1', [req.params.sub])).rows[0]; if (!t) return res.status(404).send('Not found'); res.send(renderPage(t.name, `<div class="hero"><h1>${esc(t.name)}</h1><p>${esc(t.school_motto)}</p></div><div class="card"><p>${esc(t.about_text)}</p><a href="/parent/login" class="btn btn-green">Parents</a> <a href="/store" class="btn btn-orange">Store</a></div>`, null, true)); });
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card" style="text-align:center"><div style="font-size:64px;margin-bottom:16px">🔍</div><h1>404</h1><a href="/" class="btn" style="margin-top:20px">Go Home</a></div>', null, true)));

// === SERVER START ===
app.listen(PORT, () => {
  console.log(`🚀 SERVER LIVE ON PORT ${PORT}`);
  
  // CRITICAL: Session initialized here to prevent Render crashes
  app.use(session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-secret-change-in-prod',
    resave: false, saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 86400000, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' }
  }));

  if (process.env.DATABASE_URL) { console.log('⏳ Starting database setup...'); initDB().catch(e => console.error('❌ DB init error:', e.message)); }
});

// === DATABASE INIT ===
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))`);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
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
    
    // Wallets & Revenue
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL UNIQUE, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS bonus_earnings (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, tenant_id INTEGER REFERENCES tenants(id), amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, video_id TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, amount NUMERIC NOT NULL, fee NUMERIC DEFAULT 0, net_amount NUMERIC, phone TEXT NOT NULL, status TEXT DEFAULT 'pending', paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id TEXT NOT NULL, referred_id TEXT NOT NULL, bonus_amount NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT DO NOTHING`);
    await client.query(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, reference_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    
    // New Features Tables
    await client.query(`CREATE TABLE IF NOT EXISTS timetable (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, day TEXT NOT NULL, period INTEGER NOT NULL, subject TEXT NOT NULL, class TEXT NOT NULL, teacher TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, date DATE NOT NULL, subject TEXT NOT NULL, class TEXT NOT NULL, time TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS marketplace_products (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, price NUMERIC NOT NULL, image_url TEXT, description TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS store_orders (id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, amount NUMERIC NOT NULL, buyer_phone TEXT NOT NULL, buyer_name TEXT NOT NULL, reference TEXT UNIQUE, status TEXT DEFAULT 'pending', momo_transaction_id TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    const tenant = await client.query(`INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subdomain) DO NOTHING RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737', 'SSEWASSWA2024']);
    if (tenant.rows.length > 0) {
      const tid = tenant.rows[0].id;
      const hash = await bcrypt.hash('admin123', 10);
      await client.query(`INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com', hash, 'super_admin', true, 'Daniel Waiswa']);
      await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text, signup_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [tid, 'enterprise', true, 'Excellence in Education', 'Digital tools for modern Ugandan schools.', 'SSEWASSWA2024']);
      await client.query(`INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [tid, 'waiswadaniel24@gmail.com']);
    }
    await client.query('COMMIT');
    dbReady = true;
    console.log('✅ Database ready!');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ DB Init Error:', err.message);
    dbReady = false;
  } finally { client.release(); }
}
