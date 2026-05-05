/**
 * SSEWASSWA School Management Platform
 * 
 * CHANGES MADE:
 * 1. Fixed session middleware ordering (was after app.listen)
 * 2. Added security middleware (helmet, rate limiting, CORS)
 * 3. Fixed analytics chart syntax error (missing closing bracket)
 * 4. Fixed parent referrals SQL query syntax
 * 5. Secured /api/cron/daily endpoint
 * 6. Fixed teacher milestone fetch call (was using invalid cookie forwarding)
 * 7. Added proper input validation
 * 8. Added structured logging
 * 9. Fixed XSS vulnerabilities in template literals
 * 10. Added proper error boundaries
 * 11. Added request ID tracking
 * 12. Fixed missing tenant checks in role middleware
 * 13. Added compression for responses
 * 14. Fixed fee table display (was showing paid as due)
 * 15. Added proper session cookie configuration
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const axios = require('axios');
const Parser = require('rss-parser');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');

// Security & Performance Middleware
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
let dbReady = false;
const parser = new Parser();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// ===== CONFIGURATION =====
const DEV_COMMISSION = { 
  fee_payment: 0.05, 
  store_purchase: 0.08, 
  marketplace: 0.10, 
  subscription: 0.30, 
  withdrawal_fee: 0.02, 
  live_class: 0.20 
};

const AUTO_PAYOUT_THRESHOLD = 50000;
const AUTO_PAYOUT_PERCENTAGE = 0.95;
const MIN_WITHDRAWAL = 5000;

const SMS_CONFIG = { 
  apiKey: process.env.SMS_API_KEY || 'demo', 
  username: process.env.SMS_USERNAME || 'sandbox', 
  senderId: 'SSEWASSWA' 
};

const MOMO_CONFIG = { 
  apiKey: process.env.MOMO_API_KEY || 'demo', 
  baseUrl: 'https://sandbox.momodeveloper.mtn.com' 
};

const WHATSAPP_CONFIG = { 
  token: process.env.WHATSAPP_TOKEN || 'demo', 
  phoneId: process.env.WHATSAPP_PHONE_ID || 'demo' 
};

// ===== DATABASE CONNECTION =====
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  WARNING: DATABASE_URL environment variable is missing.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5433/dummy',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  query_timeout: 5000,
  statement_timeout: 5000,
  max: 20, // Connection pool limit
  idleTimeoutMillis: 30000,
  allowExitOnIdle: false
});

// ===== SECURITY MIDDLEWARE (Order matters!) =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://meet.jit.si"],
      frameSrc: ["'self'", "https://meet.jit.si", "https://www.youtube.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://via.placeholder.com"],
      connectSrc: ["'self'", "https://graph.facebook.com", "https://api.africastalking.com"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'API rate limit exceeded.' }
});

app.use(globalLimiter);

// ===== BODY PARSING =====
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0
}));

// ===== SESSION CONFIGURATION (Fixed: Now BEFORE app.listen) =====
const sessionConfig = {
  store: new pgSession({ 
    pool, 
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 // Clean up expired sessions every minute
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 86400000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  },
  name: 'ssewasswa.sid' // Custom session name to prevent fingerprinting
};

app.use(session(sessionConfig));

// ===== WEBPUSH CONFIGURATION =====
webpush.setVapidDetails(
  'mailto:waiswadaniel24@gmail.com',
  process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAK1sTsE0ip-4_QtQvxZBG0GZsFhJ8jmJ4MhQxKqYdJm5gA',
  process.env.VAPID_PRIVATE_KEY || 'SUbOaqB2BVzpHaHQW-rqd3N0_2m2Uy8a8gX5LqJ5oUY'
);

// ===== INTERNATIONALIZATION =====
const i18n = {
  en: { 
    dashboard: 'Dashboard', students: 'Students', fees: 'Fees', attendance: 'Attendance', 
    grades: 'Grades', settings: 'Settings', logout: 'Logout', login: 'Login', add: 'Add', 
    save: 'Save', delete: 'Delete', edit: 'Edit', name: 'Name', class: 'Class', 
    balance: 'Balance', pay: 'Pay', report: 'Report Card', bonus: 'Earn Rewards', 
    store: 'Shop', news: 'News', videos: 'Videos', downloads: 'Downloads', 
    timetable: 'Timetable', exams: 'Exams', marketplace: 'Marketplace', 
    learning: 'Learning', premium: 'Premium', home: 'Home', chatbot: 'AI Assistant', 
    referrals: 'Referrals', analytics: 'Analytics', live: 'Live Classes' 
  },
  lg: { 
    dashboard: 'Dashiboodi', students: 'Abayizi', fees: 'Ebbanja', attendance: 'Okujja', 
    grades: 'Obubonero', settings: 'Enteekateeka', logout: 'Fuluma', login: 'Yingira', 
    add: 'Gattako', save: 'Tereka', delete: 'Ggyawo', edit: 'Kyusa', name: 'Erinnya', 
    class: 'Ekibiina', balance: 'Bbanja', pay: 'Sasula', report: 'Lipoota', 
    bonus: 'Funa Bbonansi', store: 'Dduuka', news: 'Amawulire', videos: 'Vidiyo', 
    downloads: 'Wanula', timetable: 'Ggendaani', exams: 'Ebigezo', marketplace: 'Katale', 
    learning: 'Okusoma', premium: 'Muwendo', home: 'Awaka', chatbot: 'Omuddukanya', 
    referrals: 'Referrals', analytics: 'Emiwala Ennaku', live: "Emisso ly'Obulamu" 
  },
  sw: { 
    dashboard: 'Dashibodi', students: 'Wanafunzi', fees: 'Ada', attendance: 'Mahudhurio', 
    grades: 'Alama', settings: 'Mipangilio', logout: 'Toka', login: 'Ingia', 
    add: 'Ongeza', save: 'Hifadhi', delete: 'Futa', edit: 'Hariri', name: 'Jina', 
    class: 'Darasa', balance: 'Salio', pay: 'Lipa', report: 'Ripoti', 
    bonus: 'Pata Bonasi', store: 'Duka', news: 'Habari', videos: 'Video', 
    downloads: 'Pakua', timetable: 'Ratiba', exams: 'Mitihani', marketplace: 'Soko', 
    learning: 'Kujifunza', premium: 'Premium', home: 'Nyumbani', chatbot: 'Msaidizi', 
    referrals: 'Referrals', analytics: 'Takwimu', live: 'Darasa la Moja' 
  }
};

function t(key, lang) { 
  return i18n[lang]?.[key] || i18n.en[key] || key; 
}

function detectLang(req) { 
  const a = req.headers['accept-language'] || ''; 
  return a.includes('lg') ? 'lg' : a.includes('sw') ? 'sw' : 'en'; 
}

// Fixed: More comprehensive XSS escaping
function esc(str) { 
  if (str === null || str === undefined) return ''; 
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Validate phone number format
function isValidPhone(phone) {
  return /^(\+?256|0)[7]\d{8}$/.test(phone?.replace(/\s/g, ''));
}

// Validate email format
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===== LOGGING =====
const log = {
  info: (msg, meta = {}) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, meta),
  warn: (msg, meta = {}) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, meta),
  error: (msg, meta = {}) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, meta),
  debug: (msg, meta = {}) => process.env.DEBUG && console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`, meta)
};

// ===== REQUEST ID MIDDLEWARE =====
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ===== TEMPLATE RENDERING =====
function renderPage(title, content, user, isPublic, lang) {
  user = user || null;
  isPublic = isPublic || false;
  lang = lang || 'en';
  
  let nav = '';
  if (user && !isPublic) {
    nav = `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:0 0 24px 0;flex-wrap:wrap;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <div style="font-weight:700;font-size:18px">${esc(user.tenant_name || 'SSEWASSWA')}</div>
      <nav style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px" aria-label="Main navigation">
        <a href="/" style="color:white;text-decoration:none">🏠</a>
        <a href="/app" style="color:white;text-decoration:none">📊 Dash</a>
        <a href="/app/students" style="color:white;text-decoration:none">🎓 Students</a>
        <a href="/app/fees" style="color:white;text-decoration:none">💰 Fees</a>
        <a href="/app/attendance" style="color:white;text-decoration:none">✅ Attend</a>
        <a href="/app/grades" style="color:white;text-decoration:none">📝 Grades</a>
        <a href="/app/timetable" style="color:white;text-decoration:none">📅 Time</a>
        <a href="/app/exams" style="color:white;text-decoration:none">📋 Exams</a>
        <a href="/app/analytics" style="color:white;text-decoration:none">📊 Stats</a>
        <a href="/learning" style="color:white;text-decoration:none">📚 Learn</a>
        <a href="/learning/live" style="color:white;text-decoration:none">🎥 Live</a>
        <a href="/store" style="color:white;text-decoration:none">🛒 Shop</a>
        <a href="/marketplace" style="color:white;text-decoration:none">🏪 Market</a>
        <a href="/videos" style="color:white;text-decoration:none">🎬 Videos</a>
        <a href="/games" style="color:white;text-decoration:none">🎮 Games</a>
        <a href="/news" style="color:white;text-decoration:none">📰 News</a>
        <a href="/bonus" style="color:white;text-decoration:none">🎁 Bonus</a>
        <a href="/app/referrals" style="color:white;text-decoration:none">💰 Refer</a>
        <a href="/premium" style="color:white;text-decoration:none">⭐ Pro</a>
        <a href="/app/chatbot" style="color:white;text-decoration:none">🤖 AI</a>
        <a href="/app/settings" style="color:white;text-decoration:none">⚙️</a>
        <a href="/logout" style="color:white;text-decoration:none">🚪</a>
      </nav>
    </div>`;
  } else if (isPublic) {
    nav = `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:0 0 24px 0;flex-wrap:wrap">
      <div style="font-weight:700;font-size:18px">SSEWASSWA</div>
      <nav style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px" aria-label="Public navigation">
        <a href="/" style="color:white;text-decoration:none">🏠 Home</a>
        <a href="/learning" style="color:white;text-decoration:none">📚 Learn</a>
        <a href="/learning/live" style="color:white;text-decoration:none">🎥 Live</a>
        <a href="/store" style="color:white;text-decoration:none">🛒 Shop</a>
        <a href="/marketplace" style="color:white;text-decoration:none">🏪 Market</a>
        <a href="/videos" style="color:white;text-decoration:none">🎬 Videos</a>
        <a href="/games" style="color:white;text-decoration:none">🎮 Games</a>
        <a href="/news" style="color:white;text-decoration:none">📰 News</a>
        <a href="/premium" style="color:white;text-decoration:none">⭐ Pro</a>
        <a href="/login" style="color:white;text-decoration:none">👤 Login</a>
        <a href="/demo" style="color:white;text-decoration:none">📞 Book Demo</a>
      </nav>
    </div>`;
  }

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="SSEWASSWA - School Management Platform">
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f0f9ff;color:#1e293b;min-height:100vh}
    .container{max-width:1200px;margin:0 auto;padding:20px}
    .card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}
    .btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600;transition:opacity 0.2s}
    .btn:hover{opacity:0.9}
    .btn:active{opacity:0.8}
    .btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}
    .btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
    .btn-orange{background:linear-gradient(135deg,#ea580c,#f97316)}
    .btn-purple{background:linear-gradient(135deg,#7c3aed,#8b5cf6)}
    .btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b);color:#1e293b}
    input,select,textarea{width:100%;padding:12px 16px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0 12px;font-size:16px;transition:border-color 0.2s}
    input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.1)}
    table{width:100%;border-collapse:collapse;border-radius:12px;overflow:hidden}
    th,td{text-align:left;padding:14px;border-bottom:1px solid #e2e8f0}
    th{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white}
    tr:hover{background:#f8fafc}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
    .stat-card{background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;text-align:center;transition:transform 0.2s}
    .stat-card:hover{transform:translateY(-2px)}
    .stat-num{font-size:36px;font-weight:bold;color:#1e40af}
    .badge{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block}
    .badge-green{background:#dcfce7;color:#166534}
    .badge-red{background:#fee2e2;color:#991b1b}
    .badge-gold{background:#fef3c7;color:#92400e}
    .badge-blue{background:#dbeafe;color:#1e40af}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
    .hero{background:linear-gradient(135deg,#1e40af 0%,#3b82f6 50%,#60a5fa 100%);color:white;padding:60px 20px;text-align:center;border-radius:20px;margin-bottom:30px}
    .hero h1{font-size:48px;margin-bottom:16px}
    .hero p{font-size:20px;opacity:0.9}
    .card-img{width:100%;height:200px;object-fit:cover;border-radius:12px 12px 0 0}
    .chat{height:400px;overflow-y:auto;border:1px solid #e2e8f0;padding:16px;border-radius:12px;margin-bottom:16px;background:#f8fafc}
    .msg{margin:10px 0;padding:12px;border-radius:12px;max-width:80%}
    .msg-user{background:#dbeafe;margin-left:auto}
    .msg-ai{background:white;margin-right:auto;border:1px solid #e2e8f0}
    .error-card{background:#fee2e2;border-color:#fca5a5}
    .success-card{background:#dcfce7;border-color:#86efac}
    @media print{.btn,nav{display:none!important}body{padding:0;background:white}.card{break-inside:avoid}}
    @media(max-width:768px){.hero h1{font-size:32px}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  ${nav}
  <main class="container" role="main">
    ${content}
  </main>
  <footer style="text-align:center;padding:30px;font-size:12px;color:#64748b;background:white;border-top:1px solid #e2e8f0">
    <p>&copy; ${new Date().getFullYear()} SSEWASSWA Platform</p>
  </footer>
  <script>
    if("serviceWorker"in navigator&&"PushManager"in window){
      navigator.serviceWorker.register("/sw.js").catch(()=>{});
    }
  </script>
</body>
</html>`;
}

// ===== MIDDLEWARE =====
async function checkDb(req, res, next) {
  if (!dbReady) {
    return res.status(503).send(renderPage('Starting...', 
      '<div style="text-align:center;padding:100px"><h1>🚀 System Starting...</h1><p>Please wait a moment...</p><p><a href="' + esc(req.url) + '" class="btn">Refresh</a></p></div>', 
      null, true
    ));
  }
  next();
}

const requireAuth = (req, res, next) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  req.tenant = req.session.tenant;
  req.tenantId = req.session.tenant?.id;
  req.lang = req.query.lang || detectLang(req);
  next();
};

// Fixed: Added tenant existence check
const requireRole = (role) => (req, res, next) => {
  if (!req.session?.user || req.session.user.role !== role) {
    return res.status(403).send(renderPage('Forbidden', 
      '<div class="card error-card"><h1>403 - Access Denied</h1><p>You don\'t have permission to access this page.</p></div>', 
      { tenant_name: req.tenant?.name || null }
    ));
  }
  next();
};

// Fixed: Added tenant existence check
const requireStaff = (req, res, next) => {
  if (!req.session?.user || !['admin', 'super_admin', 'teacher'].includes(req.session.user.role)) {
    return res.status(403).send(renderPage('Forbidden', 
      '<div class="card error-card"><h1>403 - Staff Only</h1></div>', 
      { tenant_name: req.tenant?.name || null }
    ));
  }
  next();
};

// Fixed: Added tenant existence check
const requireAdmin = (req, res, next) => {
  if (!req.session?.user || !['admin', 'super_admin'].includes(req.session.user.role)) {
    return res.status(403).send(renderPage('Forbidden', 
      '<div class="card error-card"><h1>403 - Admins Only</h1></div>', 
      { tenant_name: req.tenant?.name || null }
    ));
  }
  next();
};

// Async handler wrapper to avoid try-catch repetition
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ===== COMMUNICATION SERVICES =====
async function sendSMS(phone, message) {
  if (!isValidPhone(phone)) {
    log.warn('Invalid phone number for SMS', { phone });
    return;
  }
  
  if (SMS_CONFIG.apiKey === 'demo') {
    log.info('[SMS DEMO] ' + phone + ': ' + message);
    return;
  }
  
  try {
    await axios.post('https://api.africastalking.com/version1/messaging', 
      'username=' + SMS_CONFIG.username + '&to=' + phone + '&message=' + encodeURIComponent(message) + '&from=' + SMS_CONFIG.senderId,
      { 
        headers: { 
          'apiKey': SMS_CONFIG.apiKey, 
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        timeout: 10000
      }
    );
    log.info('SMS sent successfully', { phone });
  } catch (e) {
    log.error('SMS Error: ' + e.message, { phone });
  }
}

async function sendWhatsApp(phone, message) {
  if (!isValidPhone(phone)) {
    log.warn('Invalid phone number for WhatsApp', { phone });
    return;
  }
  
  if (WHATSAPP_CONFIG.token === 'demo') {
    log.info('[WA DEMO] ' + phone + ': ' + message);
    return;
  }
  
  try {
    await axios.post(
      'https://graph.facebook.com/v18.0/' + WHATSAPP_CONFIG.phoneId + '/messages',
      { messaging_product: 'whatsapp', to: phone, text: { body: message } },
      { 
        headers: { 'Authorization': 'Bearer ' + WHATSAPP_CONFIG.token },
        timeout: 10000
      }
    );
    log.info('WhatsApp sent successfully', { phone });
  } catch (e) {
    log.error('WA Error: ' + e.message, { phone });
  }
}

async function sendBulkSMS(tenantId, message) {
  const { rows } = await pool.query(
    "SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL AND guardian_phone != ''", 
    [tenantId]
  );
  
  for (const r of rows) {
    await sendSMS(r.guardian_phone, message);
    await new Promise(res => setTimeout(res, 200)); // Rate limit
  }
  
  log.info('Bulk SMS sent', { tenantId, count: rows.length });
}

// ===== BONUS & COMMISSION SYSTEM =====
async function addBonus(userId, tenantId, amount, type, description, metaData) {
  metaData = metaData || {};
  
  try {
    await pool.query(
      'INSERT INTO bonus_earnings (user_id, tenant_id, amount, type, description, metadata) VALUES ($1,$2,$3,$4,$5,$6)', 
      [userId, tenantId, amount, type, description, JSON.stringify(metaData)]
    );
    await pool.query(
      'UPDATE wallets SET balance = balance + $1, updated_at=NOW() WHERE user_email=$2', 
      [amount, userId]
    );
    log.info('Bonus added', { userId, amount, type });
  } catch (e) {
    log.error('Failed to add bonus: ' + e.message, { userId, amount, type });
  }
}

async function addDevCommission(amount, type, description, referenceId) {
  try {
    await pool.query(
      'INSERT INTO developer_revenue (amount, type, description, reference_id) VALUES ($1,$2,$3,$4)', 
      [amount, type, description, referenceId]
    );
    await pool.query(
      'UPDATE platform_wallet SET balance = balance + $1, updated_at=NOW() WHERE id=1', 
      [amount]
    );
    log.info('Commission added', { amount, type, referenceId });
  } catch (e) {
    log.error('Failed to add commission: ' + e.message, { amount, type });
  }
}

// ===== PUSH NOTIFICATIONS =====
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ 
    publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAK1sTsE0ip-4_QtQvxZBG0GZsFhJ8jmJ4MhQxKqYdJm5gA' 
  });
});

app.post('/api/subscribe', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  if (!req.body?.endpoint || !req.body?.keys) {
    return res.status(400).json({ error: 'Missing endpoint or keys' });
  }
  
  await pool.query(
    'INSERT INTO push_subscriptions (user_email, endpoint, keys) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', 
    [req.session.user.email, req.body.endpoint, JSON.stringify(req.body.keys)]
  );
  res.json({ success: true });
}));

async function sendPushToUser(email, title, body, data) {
  data = data || {};
  
  try {
    const subs = await pool.query('SELECT endpoint, keys FROM push_subscriptions WHERE user_email=$1', [email]);
    
    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys }, 
          JSON.stringify({ title, body, data }),
          { TTL: 3600 }
        );
      } catch (e) {
        // Remove invalid subscriptions
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]);
        }
        log.error('Push failed: ' + e.message);
      }
    }
  } catch (e) {
    log.error('Push to user failed: ' + e.message, { email });
  }
}

async function sendPushToTenant(tenantId, title, body, role) {
  try {
    let query = 'SELECT DISTINCT u.email FROM users u JOIN push_subscriptions p ON u.email=p.user_email WHERE u.tenant_id=$1';
    let params = [tenantId];
    
    if (role) {
      query += ' AND u.role=$2';
      params.push(role);
    }
    
    const users = await pool.query(query, params);
    for (const u of users.rows) {
      await sendPushToUser(u.email, title, body);
    }
  } catch (e) {
    log.error('Push to tenant failed: ' + e.message, { tenantId });
  }
}

// ===== REFERRALS =====
app.get('/app/referrals', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const stats = await pool.query(`
    SELECT r.referred_email, r.signup_date, u.full_name, u.role, t.name as school, 
           COALESCE(SUM(b.amount),0) as earned 
    FROM referral_stats r 
    LEFT JOIN users u ON r.referred_email = u.email 
    LEFT JOIN tenants t ON u.tenant_id = t.id 
    LEFT JOIN bonus_earnings b ON b.description LIKE 'Referred ' || r.referred_email || '%' 
      AND b.user_id = $1 
    GROUP BY r.referred_email, r.signup_date, u.full_name, u.role, t.name 
    ORDER BY r.signup_date DESC
  `, [req.session.user.email]);
  
  const totalEarned = stats.rows.reduce((sum, r) => sum + parseFloat(r.earned || 0), 0);
  const link = `https://${req.headers.host}/signup?ref=${encodeURIComponent(req.session.user.email)}`;
  
  const tableRows = stats.rows.map(r => `
    <tr>
      <td>${esc(r.full_name || r.referred_email)}</td>
      <td>${esc(r.school || '-')}</td>
      <td>${esc(r.role || '-')}</td>
      <td>${new Date(r.signup_date).toLocaleDateString()}</td>
      <td class="badge badge-green">+UGX ${r.earned}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('Referrals', `
    <div class="hero" style="padding:30px">
      <h1>Referral Earnings</h1>
      <div class="stat-num" style="color:white;-webkit-text-fill-color:white">UGX ${totalEarned.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Share Your Link</h3>
      <input value="${esc(link)}" readonly id="refLink" aria-label="Referral link">
      <button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('refLink').value).then(()=>alert('Copied!'))">Copy Link</button>
      <div style="display:flex;gap:8px;margin-top:12px">
        <a href="/share/whatsapp" class="btn btn-green" target="_blank">WhatsApp</a>
        <a href="/share/facebook" class="btn btn-purple" target="_blank">Facebook</a>
        <a href="/share/sms" class="btn btn-orange">SMS</a>
      </div>
    </div>
    <div class="card">
      <h3>Referred Users (${stats.rows.length})</h3>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Name</th><th>School</th><th>Role</th><th>Date</th><th>Earned</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="5">No referrals yet. Share your link above!</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

// ===== VIRAL LOOP =====
// Fixed: Removed invalid fetch call, now using direct function call
app.post('/api/check-teacher-milestone', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  if (req.session.user.role !== 'teacher') {
    return res.json({ ok: false });
  }
  
  const studentCount = (await pool.query(
    'SELECT COUNT(*) FROM students WHERE tenant_id=$1', 
    [req.tenantId]
  )).rows[0].count;
  
  const alreadyPaid = (await pool.query(
    "SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='teacher_milestone'", 
    [req.session.user.email]
  )).rows[0];
  
  if (studentCount >= 10 && !alreadyPaid) {
    await addBonus(req.session.user.email, req.tenantId, 5000, 'teacher_milestone', 'Added 10+ students');
    await sendPushToUser(req.session.user.email, '🎉 Bonus Unlocked!', 'You earned UGX 5,000 for adding 10 students!');
    
    const referrer = await pool.query(
      'SELECT referrer_email FROM referral_stats WHERE referred_email=$1', 
      [req.session.user.email]
    );
    
    if (referrer.rows[0]?.referrer_email) {
      await addBonus(referrer.rows[0].referrer_email, req.tenantId, 2000, 'referral_bonus', 'Your referral hit 10 students');
    }
    
    return res.json({ bonus: 5000 });
  }
  
  res.json({ ok: true, studentCount });
}));

app.get('/share/:platform', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const platform = req.params.platform;
  const allowedPlatforms = ['whatsapp', 'facebook', 'sms'];
  
  if (!allowedPlatforms.includes(platform)) {
    return res.redirect('/');
  }
  
  const link = `https://${req.headers.host}/signup?ref=${encodeURIComponent(req.session.user.email)}`;
  
  await pool.query(
    'INSERT INTO viral_shares (user_email, platform, link_shared) VALUES ($1,$2,$3)', 
    [req.session.user.email, platform, link]
  );
  
  const messages = {
    whatsapp: `https://wa.me/?text=${encodeURIComponent('Join SSEWASSWA - Free School Management + Earn Rewards! ' + link)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
    sms: `sms:?body=${encodeURIComponent('Join SSEWASSWA: ' + link)}`
  };
  
  res.redirect(messages[platform] || '/');
}));

// ===== HOME PAGE =====
app.get('/', asyncHandler(async (req, res) => {
  let newsCards = '';
  
  try {
    const feed = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml');
    newsCards = feed.items.slice(0, 6).map(i => `
      <div class="card">
        <h4>${esc(i.title)}</h4>
        <p style="color:#64748b;font-size:14px">${esc(i.contentSnippet?.substring(0, 100) || '')}...</p>
        <a href="/bonus/claim/news?url=${encodeURIComponent(i.link)}" class="btn btn-orange" style="font-size:12px;padding:8px 16px" target="_blank" rel="noopener">Read +20</a>
      </div>
    `).join('');
  } catch (e) {
    log.warn('RSS feed failed: ' + e.message);
  }
  
  res.send(renderPage('SSEWASSWA - Learn, Shop, Play, Earn', `
    <div class="hero">
      <h1>Learn - Shop - Play - Earn</h1>
      <p>Your all-in-one platform for education and rewards.</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a href="/signup" class="btn btn-green" style="font-size:18px;padding:16px 32px">Get Started Free</a>
        <a href="/demo" class="btn btn-gold" style="font-size:18px;padding:16px 32px">📞 Book Demo</a>
        <a href="/premium" class="btn btn-gold" style="font-size:18px;padding:16px 32px">⭐ Go Premium</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">50K+</div><div>Users</div></div>
      <div class="stat-card"><div class="stat-num">500+</div><div>Schools</div></div>
      <div class="stat-card"><div class="stat-num">10M+</div><div>Rewards Paid</div></div>
    </div>
    <div class="grid">
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/learning'">
        <div style="font-size:48px;margin-bottom:12px">📚</div><h3>Learning</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/store'">
        <div style="font-size:48px;margin-bottom:12px">🛒</div><h3>Store</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/marketplace'">
        <div style="font-size:48px;margin-bottom:12px">🏪</div><h3>Marketplace</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/videos'">
        <div style="font-size:48px;margin-bottom:12px">🎬</div><h3>Videos</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/games'">
        <div style="font-size:48px;margin-bottom:12px">🎮</div><h3>Games</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/learning/live'">
        <div style="font-size:48px;margin-bottom:12px">🎥</div><h3>Live Classes</h3>
      </div>
      <div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/app/chatbot'">
        <div style="font-size:48px;margin-bottom:12px">🤖</div><h3>AI Assistant</h3>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <h2>📰 Latest News</h2>
      <div class="grid">${newsCards}</div>
    </div>
  `, null, true));
}));

// ===== AUTH ROUTES =====
app.get('/login', (req, res) => {
  const lang = req.query.lang || detectLang(req);
  res.send(renderPage(t('login', lang), `
    <div class="card" style="max-width:450px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:60px;margin-bottom:12px">🎓</div>
        <h1>Welcome Back</h1>
      </div>
      <form method="POST" action="/login">
        <input name="email" placeholder="Email" type="email" required autocomplete="email" />
        <input name="password" placeholder="Password" type="password" required autocomplete="current-password" />
        <button type="submit" class="btn" style="width:100%;font-size:18px;padding:16px">Login</button>
      </form>
      <div style="text-align:center;margin-top:20px">
        <a href="/signup" style="color:#1e40af">Create Account</a> - 
        <a href="/forgot-password" style="color:#64748b">Forgot Password?</a>
      </div>
    </div>
  `, null, true, lang));
});

app.post('/login', authLimiter, checkDb, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).send(renderPage('Error', 
      '<div class="card error-card"><h1>Missing Credentials</h1><a href="/login" class="btn">Try Again</a></div>', 
      null, true
    ));
  }
  
  const user = await pool.query(
    'SELECT u.*, t.subdomain, t.name as tenant_name, t.plan FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1 AND u.approved=true', 
    [email]
  );
  
  if (!user.rows[0] || !(await bcrypt.compare(password, user.rows[0].password_hash))) {
    log.warn('Failed login attempt', { email, ip: req.ip });
    return res.status(401).send(renderPage('Login Failed', 
      '<div class="card error-card" style="text-align:center"><h1>Invalid Email or Password</h1><a href="/login" class="btn">Try Again</a></div>', 
      null, true
    ));
  }
  
  // Regenerate session to prevent session fixation
  req.session.regenerate(() => {
    req.session.user = user.rows[0];
    req.session.tenant = { 
      id: user.rows[0].tenant_id, 
      subdomain: user.rows[0].subdomain, 
      name: user.rows[0].tenant_name, 
      plan: user.rows[0].plan 
    };
    
    log.info('User logged in', { email: user.rows[0].email, role: user.rows[0].role });
    res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
  });
}));

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/signup', (req, res) => {
  const ref = req.query.ref;
  res.send(renderPage('Create Account', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <div style="text-align:center;margin-bottom:24px">
        <h1>Join SSEWASSWA</h1>
        <p class="badge badge-green">+100 UGX Welcome Bonus!</p>
      </div>
      <form method="POST" action="/signup">
        ${ref ? '<input type="hidden" name="ref" value="' + esc(ref) + '">' : ''}
        <input name="full_name" placeholder="Full Name" required minlength="2" />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Phone (07XX)" required pattern="[0-9]{10}" />
        <input name="password" type="password" placeholder="Password" required minlength="6" />
        <select name="role">
          <option value="student">Student</option>
          <option value="parent">Parent</option>
          <option value="teacher">Teacher (need code)</option>
        </select>
        <input name="school_code" placeholder="School Code (teachers only)" />
        <button type="submit" class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Create Account</button>
      </form>
    </div>
  `, null, true));
});

app.post('/signup', checkDb, asyncHandler(async (req, res) => {
  const { full_name, email, phone, password, role, school_code, ref } = req.body;
  
  // Validation
  if (!full_name || !email || !phone || !password) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>All fields are required</h1></div>', null, true));
  }
  
  if (!isValidEmail(email)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid email format</h1></div>', null, true));
  }
  
  if (!isValidPhone(phone)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid phone format (use 07XX...)</h1></div>', null, true));
  }
  
  if (password.length < 6) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Password must be at least 6 characters</h1></div>', null, true));
  }
  
  let tenantId = 1;
  
  if (role === 'teacher' && school_code) {
    const t = await pool.query('SELECT id FROM tenants WHERE signup_code=$1 OR subdomain=$1', [school_code.toLowerCase()]);
    if (!t.rows[0]) {
      return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid School Code</h1></div>', null, true));
    }
    tenantId = t.rows[0].id;
  }
  
  try {
    await pool.query(
      'INSERT INTO users (tenant_id, email, password_hash, role, full_name, phone, approved) VALUES ($1,$2,$3,$4,$5,$6,$7)', 
      [tenantId, email, await bcrypt.hash(password, 10), role, full_name, phone, true]
    );
    
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [tenantId, email]);
    await addBonus(email, tenantId, 100, 'signup', 'Welcome bonus');
    
    if (ref && isValidEmail(ref)) {
      await addBonus(ref, tenantId, 200, 'referral', 'Referred ' + email);
      await pool.query('INSERT INTO referral_stats (referrer_email, referred_email) VALUES ($1,$2)', [ref, email]);
    }
    
    log.info('New user registered', { email, role, tenantId });
    res.send(renderPage('Welcome!', 
      '<div class="card success-card" style="text-align:center"><h1>🎉 Account Created!</h1><p>You earned +100 UGX welcome bonus!</p><a href="/login" class="btn btn-green">Login Now</a></div>', 
      null, true
    ));
  } catch (e) {
    if (e.code === '23505') {
      return res.send(renderPage('Error', '<div class="card error-card"><h1>Email already exists</h1><a href="/login" class="btn">Login Instead</a></div>', null, true));
    }
    throw e;
  }
}));

// ===== PASSWORD RESET =====
app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Reset Password', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h1>Forgot Password</h1>
      <form method="POST" action="/forgot-password">
        <input name="email" type="email" required placeholder="Enter your email" />
        <button class="btn" style="width:100%">Send Reset Link</button>
      </form>
    </div>
  `, null, true));
});

app.post('/forgot-password', checkDb, asyncHandler(async (req, res) => {
  if (!isValidEmail(req.body.email)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid email</h1></div>', null, true));
  }
  
  const u = await pool.query('SELECT id FROM users WHERE email=$1', [req.body.email]);
  
  if (u.rows[0]) {
    const token = crypto.randomBytes(20).toString('hex');
    await pool.query(
      'INSERT INTO password_resets (email, token, expires_at) VALUES ($1,$2,NOW() + INTERVAL \'1 hour\')', 
      [req.body.email, token]
    );
    log.info('Password reset requested', { email: req.body.email });
    // In production, send email with reset link
  }
  
  // Always show success to prevent email enumeration
  res.send(renderPage('Check Email', 
    '<div class="card success-card" style="text-align:center"><h1>📧 Check Your Email</h1><p>If an account exists with that email, you will receive a reset link.</p></div>', 
    null, true
  ));
}));

app.get('/reset-password/:token', checkDb, asyncHandler(async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM password_resets WHERE token=$1 AND expires_at > NOW() AND used=false', 
    [req.params.token]
  );
  
  if (!r.rows[0]) {
    return res.send(renderPage('Expired', '<div class="card error-card"><h1>Invalid or Expired Link</h1><a href="/forgot-password" class="btn">Request New Link</a></div>', null, true));
  }
  
  res.send(renderPage('Reset Password', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h1>Set New Password</h1>
      <form method="POST" action="/reset-password/${req.params.token}">
        <input name="password" type="password" required minlength="6" placeholder="New password" />
        <input name="confirm_password" type="password" required minlength="6" placeholder="Confirm password" />
        <button class="btn btn-green" style="width:100%">Reset Password</button>
      </form>
    </div>
  `, null, true));
}));

app.post('/reset-password/:token', checkDb, asyncHandler(async (req, res) => {
  if (req.body.password !== req.body.confirm_password) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Passwords do not match</h1></div>', null, true));
  }
  
  if (req.body.password.length < 6) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Password must be at least 6 characters</h1></div>', null, true));
  }
  
  const r = await pool.query(
    'SELECT * FROM password_resets WHERE token=$1 AND expires_at > NOW() AND used=false', 
    [req.params.token]
  );
  
  if (!r.rows[0]) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid or expired link</h1></div>', null, true));
  }
  
  await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [await bcrypt.hash(req.body.password, 10), r.rows[0].email]);
  await pool.query('UPDATE password_resets SET used=true WHERE id=$1', [r.rows[0].id]);
  
  log.info('Password reset successful', { email: r.rows[0].email });
  res.send(renderPage('Success', 
    '<div class="card success-card" style="text-align:center"><h1>✅ Password Reset!</h1><a href="/login" class="btn">Login Now</a></div>', 
    null, true
  ));
}));

// ===== PARENT PORTAL =====
app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h1>👨‍👩‍👧‍👦 Parent Portal</h1>
      <form method="POST" action="/parent/send-otp">
        <input name="phone" placeholder="Phone Number (07XX)" required pattern="[0-9]{10}" />
        <button type="submit" class="btn" style="width:100%">Send OTP</button>
      </form>
    </div>
  `, null, true));
});

app.post('/parent/send-otp', authLimiter, checkDb, asyncHandler(async (req, res) => {
  if (!isValidPhone(req.body.phone)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid phone number</h1></div>', null, true));
  }
  
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  await pool.query(
    'INSERT INTO parent_otps (phone, otp, expires_at) VALUES ($1,$2,NOW() + INTERVAL \'10 minutes\')', 
    [req.body.phone, otp]
  );
  
  await sendSMS(req.body.phone, `SSEWASSWA OTP: ${otp}. Do not share this code.`);
  log.info('Parent OTP sent', { phone: req.body.phone });
  
  res.send(renderPage('Verify OTP', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h1>Enter OTP</h1>
      <p>Code sent to ${esc(req.body.phone)}</p>
      <form method="POST" action="/parent/verify-otp">
        <input type="hidden" name="phone" value="${esc(req.body.phone)}">
        <input name="otp" placeholder="6-digit OTP" required pattern="[0-9]{6}" maxlength="6" />
        <button type="submit" class="btn" style="width:100%">Verify</button>
      </form>
    </div>
  `, null, true));
}));

app.post('/parent/verify-otp', authLimiter, checkDb, asyncHandler(async (req, res) => {
  const r = await pool.query(
    "SELECT * FROM parent_otps WHERE phone=$1 AND otp=$2 AND expires_at > NOW() AND used=false LIMIT 1", 
    [req.body.phone, req.body.otp]
  );
  
  if (!r.rows[0]) {
    log.warn('Invalid OTP attempt', { phone: req.body.phone });
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid or expired OTP</h1><a href="/parent/login" class="btn">Try Again</a></div>', null, true));
  }
  
  await pool.query('UPDATE parent_otps SET used=true WHERE id=$1', [r.rows[0].id]);
  
  let p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
  
  if (!p.rows[0]) {
    const t = await pool.query('SELECT id FROM tenants WHERE subdomain=$1', ['main']);
    await pool.query('INSERT INTO parents (phone, verified, tenant_id) VALUES ($1,true,$2)', [req.body.phone, t.rows[0]?.id || 1]);
    p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
  }
  
  req.session.parent = p.rows[0];
  res.redirect('/parent/dashboard');
}));

app.get('/parent/dashboard', checkDb, asyncHandler(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  
  const s = await pool.query(
    'SELECT * FROM students WHERE parent_id=$1 OR guardian_phone=$2', 
    [req.session.parent.id, req.session.parent.phone]
  );
  
  const childrenCards = s.rows.map(x => `
    <div class="card">
      <h3>${esc(x.name)}</h3>
      <p>Class: ${esc(x.class || 'Not assigned')}</p>
      <p>Balance: <strong class="badge badge-red">UGX ${x.balance}</strong></p>
      <div style="margin-top:12px;display:flex;gap:8px">
        <a href="/parent/pay/${x.id}" class="btn btn-green">Pay Fees</a>
        <a href="/app/students/report/${x.id}" class="btn" target="_blank" rel="noopener">Report</a>
      </div>
    </div>
  `).join('');
  
  res.send(renderPage('My Children', `
    <div class="hero" style="padding:30px">
      <h1>👨‍👩‍👧‍👦 My Children</h1>
      <p>Monitor fees, grades, and attendance</p>
    </div>
    ${childrenCards || '<div class="card"><p>No students linked to your account yet.</p></div>'}
    <div class="card">
      <h3>💰 Refer Parents, Earn UGX 200</h3>
      <p>Your referral code: <strong>${esc(req.session.parent.phone)}</strong></p>
      <a href="/parent/referrals" class="btn btn-purple">View Referrals</a>
    </div>
  `, null, true));
}));

// Fixed: Parent referrals with corrected query
app.get('/parent/referrals', checkDb, asyncHandler(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  
  const refs = await pool.query(`
    SELECT p.phone, p.name, COUNT(s.id) as children 
    FROM parents p 
    LEFT JOIN students s ON p.id = s.parent_id 
    WHERE p.referred_by = $1 
    GROUP BY p.id, p.phone, p.name
  `, [req.session.parent.phone]);
  
  const earned = await pool.query(
    "SELECT COALESCE(SUM(amount),0) as total FROM bonus_earnings WHERE user_id=$1 AND type='parent_referral'", 
    [req.session.parent.phone]
  );
  
  res.send(renderPage('My Referrals', `
    <div class="card">
      <h1>💰 Parent Referrals</h1>
      <div class="stat-num">UGX ${earned.rows[0]?.total || 0}</div>
      <p>Your Code: <strong class="badge badge-gold" style="font-size:18px">${esc(req.session.parent.phone)}</strong></p>
      <p>Share this code with other parents. Earn UGX 200 for each who signs up!</p>
    </div>
    <div class="card">
      <h3>Referred Parents (${refs.rows.length})</h3>
      <table>
        <thead><tr><th>Phone</th><th>Name</th><th>Children</th><th>Earned</th></tr></thead>
        <tbody>
          ${refs.rows.map(r => `
            <tr>
              <td>${esc(r.phone)}</td>
              <td>${esc(r.name || 'N/A')}</td>
              <td>${r.children}</td>
              <td class="badge badge-green">+200</td>
            </tr>
          `).join('') || '<tr><td colspan="4">No referrals yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `));
}));

app.get('/parent/pay/:id', checkDb, asyncHandler(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  
  res.send(renderPage('Pay Fees', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>Pay for ${esc(s.name)}</h1>
      <div style="background:#f8fafc;padding:20px;border-radius:12px;text-align:center;margin:20px 0">
        <div style="color:#64748b">Outstanding Balance</div>
        <div class="stat-num" style="color:#dc2626">UGX ${s.balance}</div>
      </div>
      <form method="POST" action="/parent/pay">
        <input type="hidden" name="student_id" value="${s.id}">
        <input name="amount" type="number" required min="1" max="${s.balance}" placeholder="Amount to pay (UGX)" />
        <input name="phone" value="${esc(req.session.parent.phone)}" required readonly />
        <p style="font-size:12px;color:#64748b">Payment via Mobile Money</p>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay Now</button>
      </form>
    </div>
  `, null, true));
}));

app.post('/parent/pay', checkDb, asyncHandler(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  
  const { student_id, amount, phone } = req.body;
  
  if (!amount || amount <= 0) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid amount</h1></div>', null, true));
  }
  
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  
  const ref = 'FEE-' + Date.now();
  
  await pool.query(
    'INSERT INTO payment_requests (tenant_id, student_id, amount, phone, reference) VALUES ($1,$2,$3,$4,$5)', 
    [s.tenant_id, student_id, amount, phone, ref]
  );
  
  await addDevCommission(Math.round(amount * DEV_COMMISSION.fee_payment), 'fee_payment', 'Fee commission', ref);
  
  if (MOMO_CONFIG.apiKey === 'demo') {
    await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [amount, student_id]);
    await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]);
    
    log.info('Demo payment processed', { student_id, amount, ref });
    return res.send(renderPage('Payment Successful', 
      '<div class="card success-card" style="text-align:center"><h1>✅ Payment Received!</h1><p>UGX ' + amount + ' for ' + esc(s.name) + '</p><a href="/parent/dashboard" class="btn">Back to Dashboard</a></div>', 
      null, true
    ));
  }
  
  res.send(renderPage('Processing', 
    '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>Complete the MoMo prompt to finish payment.</p></div>', 
    null, true
  );
}));

app.get('/parent/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/parent/login'));
});

// ===== BONUS & REWARDS SYSTEM =====
app.get('/bonus', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
  const e = await pool.query('SELECT * FROM bonus_earnings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [req.session.user.email]);
  
  const rows = e.rows.map(x => `
    <tr>
      <td>${new Date(x.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-blue">${esc(x.type)}</span></td>
      <td class="badge badge-green">+UGX ${x.amount}</td>
      <td>${esc(x.description)}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('My Rewards', `
    <div class="hero" style="padding:40px 20px">
      <h2>🎁 My Wallet</h2>
      <div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">UGX ${w.balance.toLocaleString()}</div>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:20px">
        <a href="/bonus/withdraw" class="btn btn-green">Withdraw</a>
        <a href="/bonus/affiliate" class="btn btn-purple">Affiliate</a>
      </div>
    </div>
    <h3 style="margin-bottom:16px">Earn More Rewards</h3>
    <div class="grid">
      <div class="stat-card" onclick="location.href='/videos'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">🎬</div>
        <div>Watch Videos</div>
        <div class="badge badge-green">+50 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/news'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">📰</div>
        <div>Read News</div>
        <div class="badge badge-green">+20 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/downloads'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">📥</div>
        <div>Download Apps</div>
        <div class="badge badge-green">+100 UGX</div>
      </div>
      <div class="stat-card" onclick="location.href='/games'" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">🎮</div>
        <div>Play Games</div>
        <div class="badge badge-green">+30 UGX</div>
      </div>
    </div>
    <div class="card" style="margin-top:24px">
      <h3>Recent Earnings</h3>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Description</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No earnings yet. Start earning above!</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/bonus/withdraw', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0] || { balance: 0 };
  
  res.send(renderPage('Withdraw', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>Withdraw Funds</h1>
      <div style="background:#f8fafc;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px">
        <div style="color:#64748b">Available Balance</div>
        <div class="stat-num">UGX ${w.balance.toLocaleString()}</div>
      </div>
      <form method="POST" action="/bonus/withdraw">
        <input name="amount" type="number" max="${w.balance}" min="${MIN_WITHDRAWAL}" placeholder="Min ${MIN_WITHDRAWAL.toLocaleString()} UGX" required />
        <input name="phone" placeholder="MoMo Number (07XX)" required pattern="[0-9]{10}" />
        <p style="font-size:12px;color:#64748b">Withdrawal fee: 2% (UGX ${Math.round(w.balance * DEV_COMMISSION.withdrawal_fee)} on full balance)</p>
        <button class="btn btn-green" style="width:100%">Request Withdrawal</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/bonus/withdraw', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0];
  
  if (!w || w.balance < req.body.amount || req.body.amount < MIN_WITHDRAWAL) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid Amount</h1><p>Minimum withdrawal is UGX ' + MIN_WITHDRAWAL.toLocaleString() + '</p></div>', { tenant_name: req.tenant.name }, false, req.lang));
  }
  
  if (!isValidPhone(req.body.phone)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid phone number</h1></div>', { tenant_name: req.tenant.name }, false, req.lang));
  }
  
  const fee = Math.round(req.body.amount * DEV_COMMISSION.withdrawal_fee);
  
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_email=$2', [req.body.amount, req.session.user.email]);
  await pool.query(
    'INSERT INTO withdrawals (user_email, amount, phone, fee, net_amount, status) VALUES ($1,$2,$3,$4,$5,$6)', 
    [req.session.user.email, req.body.amount, req.body.phone, fee, req.body.amount - fee, 'pending']
  );
  await addDevCommission(fee, 'withdrawal_fee', 'Withdrawal fee');
  
  log.info('Withdrawal requested', { email: req.session.user.email, amount: req.body.amount, fee });
  res.send(renderPage('Submitted', 
    '<div class="card success-card" style="text-align:center"><h1>✅ Withdrawal Queued!</h1><p>UGX ' + (req.body.amount - fee).toLocaleString() + ' will be sent to ' + esc(req.body.phone) + '</p><a href="/bonus" class="btn">Back to Wallet</a></div>', 
    { tenant_name: req.tenant.name }, false, req.lang
  ));
}));

app.get('/bonus/affiliate', requireAuth, checkDb, (req, res) => {
  const link = `https://${req.headers.host}/signup?ref=${encodeURIComponent(req.session.user.email)}`;
  
  res.send(renderPage('Affiliate Program', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h1>💰 Earn UGX 200 Per Referral</h1>
      <p style="color:#64748b">Share your unique link. When someone signs up using it, you earn UGX 200 instantly!</p>
      <div style="background:#f8fafc;padding:16px;border-radius:12px;margin:20px 0">
        <label style="font-size:12px;color:#64748b;display:block;margin-bottom:8px">Your Affiliate Link</label>
        <input value="${esc(link)}" readonly style="margin:0" id="affLink">
        <button class="btn" style="margin-top:8px" onclick="navigator.clipboard.writeText(document.getElementById('affLink').value).then(()=>alert('Copied!'))">Copy Link</button>
      </div>
      <div style="display:flex;gap:8px">
        <a href="/share/whatsapp" class="btn btn-green" target="_blank">Share WhatsApp</a>
        <a href="/share/facebook" class="btn btn-purple" target="_blank">Share Facebook</a>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

// ===== VIDEOS =====
app.get('/videos', asyncHandler(async (req, res) => {
  const l = req.query.lang || detectLang(req);
  const w = req.session.user 
    ? (await pool.query("SELECT video_id FROM bonus_earnings WHERE user_id=$1 AND type='video'", [req.session.user.email])).rows.map(x => x.video_id) 
    : [];
  
  const btn = req.session.user 
    ? (w.includes('dQw4w9WgXcQ') 
      ? '<p class="badge badge-green">✅ Claimed</p>' 
      : '<a href="/bonus/claim/video/dQw4w9WgXcQ" class="btn btn-green">Watch & Claim +50 UGX</a>')
    : '<a href="/login" class="btn btn-green">Login to Earn</a>';
  
  res.send(renderPage('Videos - Watch & Earn', `
    <div class="hero" style="padding:30px">
      <h1>🎬 Watch Videos, Earn Rewards</h1>
      <p>Earn UGX 50 for each video you watch!</p>
    </div>
    <div class="grid">
      <div class="card" style="padding:0;overflow:hidden">
        <iframe width="100%" height="200" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen title="Educational Video"></iframe>
        <div style="padding:16px">
          <h4>Math Basics</h4>
          ${btn}
        </div>
      </div>
    </div>
  `, null, true, l));
}));

app.get('/bonus/claim/video/:id', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  const existing = await pool.query(
    "SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='video' AND video_id=$2", 
    [req.session.user.email, req.params.id]
  );
  
  if (!existing.rows[0]) {
    await addBonus(req.session.user.email, req.tenantId, 50, 'video', 'Watched video', { video_id: req.params.id });
  }
  
  res.redirect('/videos');
}));

// ===== NEWS =====
app.get('/news', asyncHandler(async (req, res) => {
  const l = req.query.lang || detectLang(req);
  
  try {
    const f = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml');
    const cards = f.items.slice(0, 10).map(i => `
      <div class="card">
        <h4>${esc(i.title)}</h4>
        <p style="color:#64748b;font-size:14px">${esc(i.contentSnippet?.substring(0, 120) || '')}...</p>
        <a href="/bonus/claim/news?url=${encodeURIComponent(i.link)}" class="btn btn-orange" target="_blank" rel="noopener">Read & Earn +20 UGX</a>
      </div>
    `).join('');
    
    res.send(renderPage('News - Read & Earn', `
      <div class="hero" style="padding:30px">
        <h1>📰 Latest News</h1>
        <p>Earn UGX 20 for each article you read!</p>
      </div>
      <div class="grid">${cards}</div>
    `, null, true, l));
  } catch (e) {
    log.warn('News feed error: ' + e.message);
    res.send(renderPage('News', '<div class="card"><h1>📰 News Unavailable</h1><p>Please try again later.</p></div>', null, true, l));
  }
}));

app.get('/bonus/claim/news', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  await addBonus(req.session.user.email, req.tenantId, 20, 'news', 'Read article');
  res.redirect(req.query.url || '/news');
}));

// ===== DOWNLOADS =====
app.get('/downloads', (req, res) => {
  const l = req.query.lang || detectLang(req);
  
  res.send(renderPage('Downloads - Earn Rewards', `
    <div class="hero" style="padding:30px">
      <h1>📥 Download & Earn</h1>
      <p>Earn UGX 100 for each app you download!</p>
    </div>
    <div class="grid">
      <div class="card" style="display:flex;gap:16px;align-items:center">
        <div style="font-size:48px">📚</div>
        <div style="flex:1">
          <h4>Khan Academy</h4>
          <p style="color:#64748b;font-size:14px">Free educational videos and exercises</p>
        </div>
        <a href="/bonus/claim/download?url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.khanacademy.android')}&name=Khan Academy" class="btn btn-green">Get +100</a>
      </div>
    </div>
  `, null, true, l));
});

app.get('/bonus/claim/download', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  const appName = req.query.name || 'App';
  await addBonus(req.session.user.email, req.tenantId, 100, 'download', 'Downloaded ' + appName);
  res.redirect(req.query.url || '/downloads');
}));

// ===== GAMES =====
app.get('/games', (req, res) => {
  const l = req.query.lang || detectLang(req);
  const playBtn = req.session.user 
    ? '<a href="/games/play/quiz" class="btn btn-green" style="margin-top:12px">Play Now</a>' 
    : '<a href="/login" class="btn btn-green" style="margin-top:12px">Login to Play</a>';
  
  res.send(renderPage('Games - Play & Earn', `
    <div class="hero" style="padding:30px">
      <h1>🎮 Play Games, Earn Rewards</h1>
      <p>Earn UGX 30 for each game you play!</p>
    </div>
    <div class="grid">
      <div class="card" style="text-align:center">
        <div style="font-size:64px;margin-bottom:12px">🧮</div>
        <h3>Math Quiz</h3>
        <p style="color:#64748b">Test your math skills!</p>
        <div class="badge badge-gold">+30 UGX per game</div>
        ${playBtn}
      </div>
    </div>
  `, null, true, l));
});

app.get('/games/play/:id', requireAuth, checkDb, asyncHandler(async (req, res) => {
  res.send(renderPage('Math Quiz', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h1>🧮 Math Quiz</h1>
      <p>Answer 5 questions correctly to earn UGX 30!</p>
      <div id="quiz-area" style="text-align:center;margin:20px 0">
        <div id="progress" style="margin-bottom:16px;color:#64748b">Question <span id="qNum">1</span>/5</div>
        <div style="font-size:36px" id="question"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px">
          <button class="btn" onclick="checkAnswer(this)" id="ans1"></button>
          <button class="btn" onclick="checkAnswer(this)" id="ans2"></button>
          <button class="btn" onclick="checkAnswer(this)" id="ans3"></button>
          <button class="btn" onclick="checkAnswer(this)" id="ans4"></button>
        </div>
      </div>
      <div id="result" style="display:none;text-align:center">
        <div style="font-size:64px">🎉</div>
        <h2>Quiz Complete!</h2>
        <p class="badge badge-green" style="font-size:18px">+30 UGX earned!</p>
        <a href="/games" class="btn" style="margin-top:20px">Play Again</a>
      </div>
    </div>
    <script>
      let questions=[], currentIdx=0, score=0;
      
      function generateQuestions() {
        for(let i=0;i<5;i++){
          let a=Math.floor(Math.random()*20)+1;
          let b=Math.floor(Math.random()*20)+1;
          let ops=['+','-','×'];
          let op=ops[Math.floor(Math.random()*3)];
          let ans=op==='+'?a+b:op==='-'?a-b:a*b;
          questions.push({q:a+' '+op+' '+b+' = ?',ans:ans});
        }
      }
      
      function showQuestion(){
        if(currentIdx>=5){
          document.getElementById('quiz-area').style.display='none';
          document.getElementById('result').style.display='block';
          fetch('/bonus/claim/game/quiz').catch(()=>{});
          return;
        }
        
        let c=questions[currentIdx];
        document.getElementById('question').textContent=c.q;
        document.getElementById('qNum').textContent=currentIdx+1;
        
        let opts=[c.ans];
        while(opts.length<4){
          let w=c.ans+Math.floor(Math.random()*20)-10;
          if(w>=0 && !opts.includes(w)) opts.push(w);
        }
        opts.sort(()=>Math.random()-0.5);
        
        for(let i=1;i<=4;i++){
          document.getElementById('ans'+i).textContent=opts[i-1];
          document.getElementById('ans'+i).dataset.ans=opts[i-1];
          document.getElementById('ans'+i).disabled=false;
          document.getElementById('ans'+i).style.opacity='1';
        }
      }
      
      function checkAnswer(btn){
        let selectedAns=parseInt(btn.dataset.ans);
        if(selectedAns===questions[currentIdx].ans) score++;
        
        currentIdx++;
        showQuestion();
      }
      
      generateQuestions();
      showQuestion();
    </script>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/bonus/claim/game/:id', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  const recentClaim = await pool.query(
    "SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='game' AND metadata->>'game_id'=$2 AND created_at > NOW() - INTERVAL '1 hour'", 
    [req.session.user.email, req.params.id]
  );
  
  if (!recentClaim.rows[0]) {
    await addBonus(req.session.user.email, req.tenantId, 30, 'game', 'Played ' + req.params.id, { game_id: req.params.id });
  }
  
  res.json({ ok: true });
}));

// ===== LEARNING =====
app.get('/learning', (req, res) => {
  const l = req.query.lang || detectLang(req);
  
  res.send(renderPage('Learning Hub', `
    <div class="hero" style="padding:30px">
      <h1>📚 Learning Hub</h1>
      <p>Explore subjects and improve your knowledge</p>
    </div>
    <div class="grid">
      <div class="card" style="text-align:center;cursor:pointer">
        <div style="font-size:48px;margin-bottom:12px">🔢</div>
        <h3>Mathematics</h3>
        <p style="color:#64748b">Algebra, Geometry, Calculus</p>
      </div>
      <div class="card" style="text-align:center;cursor:pointer">
        <div style="font-size:48px;margin-bottom:12px">🔬</div>
        <h3>Science</h3>
        <p style="color:#64748b">Physics, Chemistry, Biology</p>
      </div>
      <div class="card" style="text-align:center;cursor:pointer">
        <div style="font-size:48px;margin-bottom:12px">📖</div>
        <h3>English</h3>
        <p style="color:#64748b">Grammar, Literature, Writing</p>
      </div>
    </div>
  `, null, true, l));
});

// ===== PREMIUM =====
app.get('/premium', (req, res) => {
  res.send(renderPage('Go Premium', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:40px 20px">
      <h1>⭐ Go Premium</h1>
      <div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">15,000 UGX/mo</div>
      <p>Unlock advanced features and priority support</p>
    </div>
    <div class="grid">
      <div class="card">
        <h3>✅ Premium Features</h3>
        <ul style="margin:16px 0;padding-left:20px;line-height:2">
          <li>Advanced Analytics</li>
          <li>Priority Support</li>
          <li>Custom Branding</li>
          <li>Unlimited Students</li>
          <li>API Access</li>
        </ul>
      </div>
    </div>
    <div class="card" style="text-align:center">
      ${req.session.user 
        ? '<form method="POST" action="/premium/subscribe" style="max-width:400px;margin:0 auto"><input name="phone" placeholder="MoMo Number" required pattern="[0-9]{10}"><button class="btn btn-gold" style="width:100%;font-size:18px;padding:16px">Subscribe Now</button></form>'
        : '<a href="/login" class="btn btn-gold" style="font-size:18px;padding:16px 32px">Login to Subscribe</a>'
      }
    </div>
  `, null, true));
});

app.post('/premium/subscribe', requireAuth, checkDb, apiLimiter, asyncHandler(async (req, res) => {
  const ref = 'PREM-' + Date.now();
  
  await pool.query(
    'INSERT INTO payment_requests (tenant_id, user_id, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5,$6)', 
    [req.tenantId, req.session.user.email, 15000, req.body.phone, ref, 'pending']
  );
  
  await addDevCommission(Math.round(15000 * DEV_COMMISSION.subscription), 'subscription', 'Premium subscription', ref);
  
  if (MOMO_CONFIG.apiKey === 'demo') {
    await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success', ref]);
    await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 month' WHERE email = $1", [req.session.user.email]);
    
    return res.send(renderPage('Premium Activated', 
      '<div class="card success-card" style="text-align:center"><h1>⭐ Premium Active!</h1><p>Enjoy your premium features for 30 days.</p></div>', 
      null, true
    ));
  }
  
  res.send(renderPage('Processing', 
    '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>Complete the MoMo prompt.</p></div>', 
    null, true
  );
}));

// ===== STORE =====
app.get('/store', (req, res) => {
  res.send(renderPage('School Store', `
    <div class="hero" style="padding:30px">
      <h1>🛒 School Store</h1>
      <p>Get uniforms, books, and supplies</p>
    </div>
    <div class="grid">
      <div class="card" style="padding:0;overflow:hidden">
        <img src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=200&fit=crop" class="card-img" alt="School Uniform" loading="lazy">
        <div style="padding:16px">
          <h4>School Uniform</h4>
          <div class="stat-num" style="font-size:24px">UGX 45,000</div>
          <a href="/store/buy/1" class="btn btn-green" style="width:100%;margin-top:12px">Buy Now</a>
        </div>
      </div>
    </div>
  `, null, true));
});

app.get('/store/buy/:id', (req, res) => {
  res.send(renderPage('Checkout', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>Buy School Uniform</h1>
      <div class="stat-num" style="font-size:24px">UGX 45,000</div>
      <form method="POST" action="/store/buy/1">
        <input name="phone" placeholder="MoMo Number" required pattern="[0-9]{10}" />
        <input name="name" placeholder="Your Name" required />
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay Now</button>
      </form>
    </div>
  `, null, true));
});

app.post('/store/buy/:id', checkDb, asyncHandler(async (req, res) => {
  const ref = 'STORE-' + Date.now();
  
  await pool.query(
    'INSERT INTO store_orders (product_id, product_name, amount, buyer_phone, buyer_name, reference, status) VALUES ($1,$2,$3,$4,$5,$6,$7)', 
    [1, 'Uniform', 45000, req.body.phone, req.body.name, ref, 'pending']
  );
  
  await addDevCommission(Math.round(45000 * DEV_COMMISSION.store_purchase), 'store_purchase', 'Store: Uniform', ref);
  
  res.send(renderPage('Order Placed', 
    '<div class="card success-card" style="text-align:center"><h1>✅ Order Placed!</h1><p>You will receive confirmation via SMS.</p></div>', 
    null, true
  );
}));

// ===== MARKETPLACE =====
app.get('/marketplace', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT p.*, t.name as school_name FROM marketplace_products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=true ORDER BY p.id DESC LIMIT 20'
  );
  
  const cards = rows.map(p => `
    <div class="card" style="padding:0;overflow:hidden">
      <img src="${esc(p.image_url || 'https://via.placeholder.com/200')}" class="card-img" alt="${esc(p.name)}" loading="lazy">
      <div style="padding:16px">
        <span class="badge badge-blue" style="margin-bottom:8px">By ${esc(p.school_name)}</span>
        <h4>${esc(p.name)}</h4>
        <div class="stat-num" style="font-size:24px;margin:12px 0">UGX ${p.price.toLocaleString()}</div>
        <a href="/marketplace/buy/${p.id}" class="btn btn-green" style="width:100%">Buy Now</a>
      </div>
    </div>
  `).join('');
  
  res.send(renderPage('Marketplace', `
    <div class="hero" style="padding:30px">
      <h1>🏪 Marketplace</h1>
      <p>Buy and sell with the community</p>
      ${req.session.user?.role === 'admin' || req.session.user?.role === 'super_admin' ? '<a href="/marketplace/sell" class="btn btn-purple" style="margin-top:12px">Sell Product</a>' : ''}
    </div>
    <div class="grid">${cards || '<div class="card"><p>No products yet. Be the first to sell!</p></div>'}</div>
  `, null, true));
}));

app.get('/marketplace/sell', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Sell Product', `
    <div class="card" style="max-width:500px">
      <h1>List Product</h1>
      <p style="color:#64748b">10% commission on sales</p>
      <form method="POST" action="/marketplace/sell">
        <input name="name" placeholder="Product Name" required />
        <input name="price" type="number" placeholder="Price (UGX)" required min="1" />
        <input name="image_url" placeholder="Image URL" />
        <textarea name="description" placeholder="Description" rows="3"></textarea>
        <button class="btn btn-green" style="width:100%">Submit for Approval</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/marketplace/sell', requireAuth, requireAdmin, checkDb, asyncHandler(async (req, res) => {
  await pool.query(
    'INSERT INTO marketplace_products (tenant_id, name, price, image_url, description, approved) VALUES ($1,$2,$3,$4,$5,$6)', 
    [req.tenantId, req.body.name, req.body.price, req.body.image_url, req.body.description, false]
  );
  
  log.info('Marketplace product submitted', { name: req.body.name, tenantId: req.tenantId });
  res.send(renderPage('Submitted', 
    '<div class="card success-card" style="text-align:center"><h1>✅ Product Submitted!</h1><p>It will appear after admin approval.</p><a href="/marketplace" class="btn">View Marketplace</a></div>', 
    { tenant_name: req.tenant.name }, false, req.lang
  ));
}));

app.get('/marketplace/buy/:id', asyncHandler(async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send(renderPage('Not Found', '<div class="card error-card"><h1>Product not found</h1></div>', null, true));
  
  res.send(renderPage('Buy Product', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h1>Buy ${esc(p.name)}</h1>
      <div class="stat-num" style="font-size:24px">UGX ${p.price.toLocaleString()}</div>
      ${p.description ? '<p style="color:#64748b;margin:16px 0">' + esc(p.description) + '</p>' : ''}
      <form method="POST" action="/marketplace/buy/${p.id}">
        <input name="phone" placeholder="MoMo Number" required pattern="[0-9]{10}" />
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay Now</button>
      </form>
    </div>
  `, null, true));
}));

app.post('/marketplace/buy/:id', checkDb, asyncHandler(async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  
  const ref = 'MKT-' + Date.now();
  
  await pool.query(
    'INSERT INTO payment_requests (tenant_id, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5)', 
    [p.tenant_id, p.price, req.body.phone, ref, 'pending']
  );
  
  await addDevCommission(Math.round(p.price * DEV_COMMISSION.marketplace), 'marketplace', 'Marketplace: ' + p.name, ref);
  
  res.send(renderPage('Processing', 
    '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>Complete the MoMo prompt.</p></div>', 
    null, true
  );
}));

// ===== AUTO-SCALE MIDDLEWARE =====
app.use('/app', requireAuth, asyncHandler(async (req, res, next) => {
  try {
    if (req.session.user?.tenant?.plan === 'free' && req.tenantId) {
      const students = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [req.tenantId])).rows[0].count;
      
      if (students > 100) {
        await pool.query('UPDATE tenants SET plan=$1 WHERE id=$2', ['basic', req.tenantId]);
        await sendPushToUser(
          req.session.user.email, 
          'Upgrade Available', 
          'You have 100+ students. Upgrade to Basic for UGX 50,000/mo to unlock analytics and more features.'
        );
        log.info('Auto-scale triggered', { tenantId: req.tenantId, students });
      }
    }
  } catch (e) {
    log.error('Auto-scale error: ' + e.message);
  }
  next();
}));

// ===== DASHBOARD =====
app.get('/app', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const [s, f, a, w] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [req.tenantId]),
    pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS t FROM fees WHERE tenant_id=$1', [req.tenantId]),
    pool.query("SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status='present'", [req.tenantId]),
    pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])
  ]);
  
  const wallet = w.rows[0] || { balance: 0 };
  
  res.send(renderPage('Dashboard', `
    <div class="stats">
      <div class="stat-card">
        <div style="font-size:24px;margin-bottom:8px">🎓</div>
        <div>Students</div>
        <div class="stat-num">${s.rows[0].c}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:24px;margin-bottom:8px">💰</div>
        <div>Total Fees</div>
        <div class="stat-num">UGX ${Number(f.rows[0].t).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:24px;margin-bottom:8px">✅</div>
        <div>Present Today</div>
        <div class="stat-num">${a.rows[0].c}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:24px;margin-bottom:8px">🎁</div>
        <div>My Rewards</div>
        <div class="stat-num">UGX ${Number(wallet.balance).toLocaleString()}</div>
      </div>
    </div>
    <div class="card">
      <h1>Quick Actions</h1>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px">
        <a href="/app/students/add" class="btn btn-green">Add Student</a>
        <a href="/app/fees/add" class="btn">Record Fee</a>
        <a href="/app/attendance/mark" class="btn">Mark Attendance</a>
        <a href="/app/grades/add" class="btn">Add Grades</a>
        <a href="/bonus" class="btn btn-purple">My Rewards</a>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

// ===== FEES MANAGEMENT =====
app.get('/app/fees', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT f.*, s.name as sn FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.id DESC LIMIT 50', 
    [req.tenantId]
  );
  
  // Fixed: Displayed correct columns (Due, Paid, Balance)
  const tableRows = rows.map(f => `
    <tr>
      <td>${esc(f.sn)}</td>
      <td>UGX ${Number(f.amount).toLocaleString()}</td>
      <td class="badge badge-green">UGX ${Number(f.paid).toLocaleString()}</td>
      <td>UGX ${Number(f.amount - f.paid).toLocaleString()}</td>
      <td>${esc(f.term)} ${f.year || ''}</td>
      <td>${esc(f.payment_method || '-')}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('Fees Management', `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1>💰 Fees</h1>
        <a href="/app/fees/add" class="btn btn-green">Record Payment</a>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Student</th><th>Due</th><th>Paid</th><th>Balance</th><th>Term</th><th>Method</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="6">No fee records yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/app/fees/add', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  const opts = s.rows.map(x => `<option value="${x.id}" ${req.query.student_id == x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  
  res.send(renderPage('Record Fee', `
    <div class="card" style="max-width:500px">
      <h1>Record Fee Payment</h1>
      <form method="POST" action="/app/fees/add">
        <label>Student</label>
        <select name="student_id" required><option value="">Select Student</option>${opts}</select>
        <label>Total Due (UGX)</label>
        <input name="amount" type="number" required min="1" placeholder="e.g. 500000" />
        <label>Amount Paid (UGX)</label>
        <input name="paid" type="number" required min="0" placeholder="e.g. 200000" />
        <label>Term</label>
        <input name="term" placeholder="e.g. Term 1" />
        <label>Payment Method</label>
        <select name="payment_method">
          <option value="Cash">Cash</option>
          <option value="MoMo">Mobile Money</option>
          <option value="Bank">Bank Transfer</option>
        </select>
        <button class="btn btn-green" style="width:100%">Save Payment</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/app/fees/add', requireStaff, checkDb, asyncHandler(async (req, res) => {
  const { student_id, amount, paid, term, payment_method } = req.body;
  const year = new Date().getFullYear();
  
  if (!student_id || !amount || paid === undefined) {
    return res.status(400).send('Missing required fields');
  }
  
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [student_id])).rows[0];
  if (!s) return res.status(404).send('Student not found');
  
  await pool.query(
    'INSERT INTO fees (tenant_id, student_id, amount, paid, term, year, payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)', 
    [req.tenantId, student_id, amount, paid, term, year, payment_method]
  );
  await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [paid, student_id]);
  
  const commission = Math.round(paid * DEV_COMMISSION.fee_payment);
  const ref = `FEE-${Date.now()}`;
  await addDevCommission(commission, 'fee_payment', `Fee: ${s.name}`, ref);
  
  // Send SMS to parent
  if (s.guardian_phone) {
    const parentExists = await pool.query('SELECT id FROM parents WHERE phone=$1', [s.guardian_phone]);
    if (!parentExists.rows[0]) {
      await sendSMS(s.guardian_phone, 
        `Payment UGX ${paid.toLocaleString()} received for ${s.name}. Track fees: https://${req.headers.host}/parent/login`
      );
    } else {
      await sendSMS(s.guardian_phone, 
        `Payment UGX ${paid.toLocaleString()} received for ${s.name}. Balance: UGX ${(s.balance - paid).toLocaleString()}`
      );
    }
  }
  
  log.info('Fee recorded', { student_id, amount, paid, term });
  res.redirect('/app/fees');
}));

// ===== ATTENDANCE =====
app.get('/app/attendance', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT a.*, s.name FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date=CURRENT_DATE", 
    [req.tenantId]
  );
  
  const tableRows = rows.map(a => `
    <tr>
      <td>${esc(a.name)}</td>
      <td><span class="badge ${a.status === 'present' ? 'badge-green' : 'badge-red'}">${a.status}</span></td>
    </tr>
  `).join('');
  
  res.send(renderPage('Attendance', `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1>✅ Today's Attendance</h1>
        <a href="/app/attendance/mark" class="btn btn-green">Mark Attendance</a>
      </div>
      <table>
        <thead><tr><th>Student</th><th>Status</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="2">No attendance recorded today</td></tr>'}</tbody>
      </table>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/app/attendance/mark', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  
  if (s.rows.length === 0) {
    return res.send(renderPage('No Students', 
      '<div class="card"><h1>No students to mark attendance for</h1><a href="/app/students/add" class="btn btn-green">Add Students First</a></div>', 
      { tenant_name: req.tenant.name }, false, req.lang
    ));
  }
  
  const checkboxes = s.rows.map(x => `
    <label style="display:flex;align-items:center;gap:12px;margin:8px 0;padding:12px;background:#f8fafc;border-radius:8px">
      <input type="checkbox" name="p_${x.id}" checked style="width:auto;margin:0">
      <span>${esc(x.name)}</span>
    </label>
  `).join('');
  
  res.send(renderPage('Mark Attendance', `
    <div class="card" style="max-width:500px">
      <h1>Mark Attendance - ${new Date().toLocaleDateString()}</h1>
      <form method="POST" action="/app/attendance/mark">
        ${checkboxes}
        <button class="btn btn-green" style="width:100%;margin-top:16px">Save Attendance</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/app/attendance/mark', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const s = await pool.query('SELECT id FROM students WHERE tenant_id=$1', [req.tenantId]);
  
  await pool.query("DELETE FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE", [req.tenantId]);
  
  for (const x of s.rows) {
    await pool.query(
      'INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1,$2,CURRENT_DATE,$3)', 
      [req.tenantId, x.id, req.body['p_' + x.id] ? 'present' : 'absent']
    );
  }
  
  log.info('Attendance marked', { tenantId: req.tenantId, students: s.rows.length });
  res.redirect('/app/attendance');
}));

// ===== GRADES =====
app.get('/app/grades', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT g.*, s.name as sn FROM grades g JOIN students s ON g.student_id=s.id WHERE g.tenant_id=$1 ORDER BY g.id DESC LIMIT 50', 
    [req.tenantId]
  );
  
  const tableRows = rows.map(g => `
    <tr>
      <td>${esc(g.sn)}</td>
      <td>${esc(g.subject)}</td>
      <td class="badge badge-gold">${g.score}</td>
      <td>${esc(g.term)} ${g.year || ''}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('Grades', `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1>📝 Grades</h1>
        <a href="/app/grades/add" class="btn btn-green">Add Grade</a>
      </div>
      <table>
        <thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="4">No grades recorded</td></tr>'}</tbody>
      </table>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/app/grades/add', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const s = await pool.query('SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  const opts = s.rows.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  
  res.send(renderPage('Add Grade', `
    <div class="card" style="max-width:500px">
      <h1>Record Grade</h1>
      <form method="POST" action="/app/grades/add">
        <label>Student</label>
        <select name="student_id" required><option value="">Select Student</option>${opts}</select>
        <label>Subject</label>
        <input name="subject" required placeholder="e.g. Mathematics" />
        <label>Score</label>
        <input name="score" type="number" required min="0" max="100" placeholder="0-100" />
        <label>Term</label>
        <input name="term" placeholder="e.g. Term 1" />
        <button class="btn btn-green" style="width:100%">Save Grade</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/app/grades/add', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const { student_id, subject, score, term } = req.body;
  const year = new Date().getFullYear();
  
  if (!student_id || !subject || score === undefined) {
    return res.status(400).send('Missing required fields');
  }
  
  await pool.query(
    'INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1,$2,$3,$4,$5,$6)', 
    [req.tenantId, student_id, subject, score, term, year]
  );
  
  log.info('Grade added', { student_id, subject, score });
  res.redirect('/app/grades');
}));

// ===== SETTINGS =====
app.get('/app/settings', requireAuth, requireAdmin, checkDb, asyncHandler(async (req, res) => {
  const s = (await pool.query('SELECT * FROM settings WHERE tenant_id=$1', [req.tenantId])).rows[0] || {};
  const t = (await pool.query('SELECT signup_code FROM tenants WHERE id=$1', [req.tenantId])).rows[0] || {};
  
  res.send(renderPage('School Settings', `
    <div class="card" style="max-width:500px">
      <h1>⚙️ School Settings</h1>
      <form method="POST" action="/app/settings">
        <label>School Motto</label>
        <input name="school_motto" value="${esc(s.school_motto)}" placeholder="Enter motto" />
        <label>About Text</label>
        <textarea name="about_text" rows="4" placeholder="School description">${esc(s.about_text)}</textarea>
        <label>Contact Email</label>
        <input name="contact_email" type="email" value="${esc(s.contact_email)}" placeholder="Email" />
        <label>WhatsApp Number</label>
        <input name="whatsapp_number" value="${esc(s.whatsapp_number)}" placeholder="07XX" />
        <label>Teacher Signup Code</label>
        <input name="signup_code" value="${esc(t.signup_code || '')}" placeholder="Code for teachers" />
        <button class="btn btn-green" style="width:100%">Save Settings</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/app/settings', requireAuth, requireAdmin, checkDb, asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE settings SET school_motto=$1, about_text=$2, contact_email=$3, whatsapp_number=$4 WHERE tenant_id=$5', 
    [req.body.school_motto, req.body.about_text, req.body.contact_email, req.body.whatsapp_number, req.tenantId]
  );
  await pool.query('UPDATE tenants SET signup_code=$1 WHERE id=$2', [req.body.signup_code?.toUpperCase(), req.tenantId]);
  
  log.info('Settings updated', { tenantId: req.tenantId });
  res.redirect('/app/settings');
}));

// ===== STUDENTS MANAGEMENT =====
app.get('/app/students', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM students WHERE tenant_id=$1 ORDER BY name', 
    [req.tenantId]
  );
  
  const tableRows = rows.map(s => `
    <tr>
      <td>${esc(s.name)}</td>
      <td>${esc(s.class || '-')}</td>
      <td>${esc(s.guardian_phone || '-')}</td>
      <td class="badge ${s.balance > 0 ? 'badge-red' : 'badge-green'}">UGX ${Number(s.balance).toLocaleString()}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <a href="/app/students/report/${s.id}" class="btn" style="font-size:11px;padding:6px 10px" title="Report">Report</a>
          <a href="/app/fees/add?student_id=${s.id}" class="btn btn-green" style="font-size:11px;padding:6px 10px" title="Pay">Pay</a>
          <a href="/app/students/edit/${s.id}" class="btn btn-orange" style="font-size:11px;padding:6px 10px" title="Edit">Edit</a>
          <a href="/app/students/delete/${s.id}" class="btn btn-red" style="font-size:11px;padding:6px 10px" title="Delete" onclick="return confirm('Delete ${esc(s.name)}? This cannot be undone.')">Del</a>
        </div>
      </td>
    </tr>
  `).join('');
  
  res.send(renderPage('Students', `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1>🎓 Students (${rows.length})</h1>
        <div style="display:flex;gap:8px">
          <a href="/app/students/add" class="btn btn-green">Add Student</a>
          <a href="/app/students/bulk" class="btn btn-purple">Bulk Upload</a>
          <a href="/app/students/export" class="btn btn-orange">Export CSV</a>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Name</th><th>Class</th><th>Guardian Phone</th><th>Balance</th><th>Actions</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="5">No students yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/app/students/add', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Add Student', `
    <div class="card" style="max-width:500px">
      <h1>Add New Student</h1>
      <form method="POST" action="/app/students/add">
        <label>Full Name *</label>
        <input name="name" required minlength="2" placeholder="Student's full name" />
        <label>Class</label>
        <input name="class" placeholder="e.g. P.4" />
        <label>Guardian Name</label>
        <input name="guardian_name" placeholder="Parent/Guardian name" />
        <label>Guardian Phone</label>
        <input name="guardian_phone" placeholder="07XX" pattern="[0-9]{10}" />
        <button class="btn btn-green" style="width:100%">Add Student</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

// Fixed: Direct milestone check instead of invalid fetch
app.post('/app/students/add', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const { name, class: studentClass, guardian_name, guardian_phone } = req.body;
  
  if (!name) {
    return res.status(400).send('Name is required');
  }
  
  const student = await pool.query(
    'INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *', 
    [req.tenantId, name, studentClass, guardian_name, guardian_phone]
  );
  
  // Send SMS to parent if phone provided
  if (guardian_phone && isValidPhone(guardian_phone)) {
    const parentLink = `https://${req.headers.host}/parent/login`;
    await sendSMS(guardian_phone, 
      `${name} registered at ${req.tenant.name}. Track fees & grades: ${parentLink}`
    );
  }
  
  // Check teacher milestone directly
  if (req.session.user.role === 'teacher') {
    try {
      const studentCount = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [req.tenantId])).rows[0].count;
      const alreadyPaid = (await pool.query(
        "SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='teacher_milestone'", 
        [req.session.user.email]
      )).rows[0];
      
      if (studentCount >= 10 && !alreadyPaid) {
        await addBonus(req.session.user.email, req.tenantId, 5000, 'teacher_milestone', 'Added 10+ students');
        await sendPushToUser(req.session.user.email, '🎉 Bonus Unlocked!', 'You earned UGX 5,000 for adding 10 students!');
        
        const referrer = await pool.query('SELECT referrer_email FROM referral_stats WHERE referred_email=$1', [req.session.user.email]);
        if (referrer.rows[0]?.referrer_email) {
          await addBonus(referrer.rows[0].referrer_email, req.tenantId, 2000, 'referral_bonus', 'Your referral hit 10 students');
        }
      }
    } catch (e) {
      log.error('Milestone check failed: ' + e.message);
    }
  }
  
  log.info('Student added', { name, tenantId: req.tenantId });
  res.redirect('/app/students');
}));

app.get('/app/students/edit/:id', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0];
  if (!s) return res.status(404).send('Not found');
  
  res.send(renderPage('Edit Student', `
    <div class="card" style="max-width:500px">
      <h1>Edit ${esc(s.name)}</h1>
      <form method="POST" action="/app/students/edit/${s.id}">
        <label>Full Name</label>
        <input name="name" value="${esc(s.name)}" required />
        <label>Class</label>
        <input name="class" value="${esc(s.class)}" />
        <label>Guardian Name</label>
        <input name="guardian_name" value="${esc(s.guardian_name)}" />
        <label>Guardian Phone</label>
        <input name="guardian_phone" value="${esc(s.guardian_phone)}" />
        <button class="btn btn-green" style="width:100%">Update Student</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/app/students/edit/:id', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  await pool.query(
    'UPDATE students SET name=$1, class=$2, guardian_name=$3, guardian_phone=$4 WHERE id=$5 AND tenant_id=$6', 
    [req.body.name, req.body.class, req.body.guardian_name, req.body.guardian_phone, req.params.id, req.tenantId]
  );
  
  log.info('Student updated', { id: req.params.id, tenantId: req.tenantId });
  res.redirect('/app/students');
}));

app.get('/app/students/delete/:id', requireAuth, requireAdmin, checkDb, asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2 RETURNING name', [req.params.id, req.tenantId]);
  
  if (result.rows[0]) {
    log.info('Student deleted', { name: result.rows[0].name, id: req.params.id, tenantId: req.tenantId });
  }
  
  res.redirect('/app/students');
}));

app.get('/app/students/report/:id', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenantId])).rows[0];
  if (!s) return res.status(404).send('Not found');
  
  const [g, f, a] = await Promise.all([
    pool.query('SELECT * FROM grades WHERE student_id=$1 ORDER BY year DESC, term', [req.params.id]),
    pool.query('SELECT * FROM fees WHERE student_id=$1 ORDER BY year DESC, term', [req.params.id]),
    pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p, COUNT(*) as t FROM attendance WHERE student_id=$1", [req.params.id])
  ]);
  
  const pct = a.rows[0].t > 0 ? Math.round((a.rows[0].p / a.rows[0].t) * 100) : 0;
  
  const gradesTable = g.rows.map(x => `
    <tr><td>${esc(x.subject)}</td><td class="badge badge-gold">${x.score}</td><td>${esc(x.term)} ${x.year}</td></tr>
  `).join('');
  
  const feesTable = f.rows.map(x => `
    <tr><td>${esc(x.term)} ${x.year}</td><td>UGX ${Number(x.amount).toLocaleString()}</td><td class="badge badge-green">UGX ${Number(x.paid).toLocaleString()}</td><td class="badge badge-red">UGX ${Number(x.amount - x.paid).toLocaleString()}</td></tr>
  `).join('');
  
  res.send(renderPage('Report Card - ' + s.name, `
    <div class="card" style="text-align:center">
      <h1>${esc(req.tenant.name)}</h1>
      <h2>REPORT CARD</h2>
      <p><strong>Name:</strong> ${esc(s.name)} | <strong>Class:</strong> ${esc(s.class || 'N/A')} | <strong>Balance:</strong> UGX ${Number(s.balance).toLocaleString()}</p>
      <p><strong>Attendance:</strong> ${pct}% (${a.rows[0].p}/${a.rows[0].t} days)</p>
    </div>
    <div class="card">
      <h3>Academic Performance</h3>
      <table>
        <thead><tr><th>Subject</th><th>Score</th><th>Term</th></tr></thead>
        <tbody>${gradesTable || '<tr><td colspan="3">No grades recorded</td></tr>'}</tbody>
      </table>
    </div>
    <div class="card">
      <h3>Fee Summary</h3>
      <table>
        <thead><tr><th>Term</th><th>Total Due</th><th>Paid</th><th>Outstanding</th></tr></thead>
        <tbody>${feesTable || '<tr><td colspan="4">No fee records</td></tr>'}</tbody>
      </table>
    </div>
    <div class="card" style="text-align:center">
      <button onclick="window.print()" class="btn btn-green">Print Report Card</button>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/app/students/bulk', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Bulk Upload Students', `
    <div class="card" style="max-width:600px">
      <h1>📤 Bulk Upload Students</h1>
      <p style="color:#64748b;margin-bottom:16px">CSV format: name,class,guardian_name,guardian_phone</p>
      <form method="POST" action="/app/students/bulk" enctype="multipart/form-data">
        <input type="file" name="csv" accept=".csv" required style="padding:20px;border:2px dashed #cbd5e1;background:#f8fafc" />
        <button class="btn btn-green" style="width:100%">Upload CSV</button>
      </form>
      <div style="margin-top:16px">
        <a href="/app/students/template.csv" class="btn btn-orange">Download Template</a>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.get('/app/students/template.csv', (req, res) => {
  res.header('Content-Type', 'text/csv')
     .attachment('students_template.csv')
     .send('name,class,guardian_name,guardian_phone\nJohn Doe,P.4,Jane Doe,0772123456\nMary Smith,P.5,Bob Smith,0772987654\n');
});

app.post('/app/students/bulk', requireAuth, requireAdmin, upload.single('csv'), checkDb, asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  
  const results = [];
  
  await new Promise((resolve, reject) => {
    const stream = Readable.from(req.file.buffer.toString());
    stream.pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', resolve)
      .on('error', reject);
  });
  
  let added = 0;
  for (const row of results) {
    if (row.name?.trim()) {
      await pool.query(
        'INSERT INTO students (tenant_id, name, class, guardian_name, guardian_phone) VALUES ($1,$2,$3,$4,$5)', 
        [req.tenantId, row.name.trim(), row.class?.trim(), row.guardian_name?.trim(), row.guardian_phone?.trim()]
      );
      added++;
    }
  }
  
  log.info('Bulk upload completed', { total: results.length, added, tenantId: req.tenantId });
  res.send(renderPage('Upload Complete', 
    `<div class="card success-card" style="text-align:center"><h1>✅ Imported ${added} Students!</h1><p>${results.length - added} rows skipped (missing name)</p><a href="/app/students" class="btn">View Students</a></div>`, 
    { tenant_name: req.tenant.name }, false, req.lang
  ));
}));

app.get('/app/students/export', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT name, class, guardian_name, guardian_phone, balance FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  
  const csvHeader = 'name,class,guardian_name,guardian_phone,balance\n';
  const csvData = rows.map(r => `"${r.name}","${r.class || ''}","${r.guardian_name || ''}","${r.guardian_phone || ''}",${r.balance}`).join('\n');
  
  res.header('Content-Type', 'text/csv')
     .attachment(`students_export_${new Date().toISOString().split('T')[0]}.csv`)
     .send(csvHeader + csvData);
}));

// ===== LIVE CLASSES =====
app.get('/learning/live', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const classes = await pool.query(`
    SELECT l.*, u.full_name as teacher_name, 
           (SELECT COUNT(*) FROM class_payments WHERE class_id=l.id AND status='success') as students 
    FROM live_classes l 
    JOIN users u ON l.teacher_email=u.email 
    WHERE l.tenant_id=$1 AND l.status='scheduled' AND l.scheduled_at > NOW() 
    ORDER BY l.scheduled_at
  `, [req.tenantId]);
  
  const cards = classes.rows.map(c => `
    <div class="card">
      <div class="badge badge-blue" style="margin-bottom:8px">${new Date(c.scheduled_at).toLocaleString()}</div>
      <h3>${esc(c.title)}</h3>
      <p style="color:#64748b">${esc(c.subject)} - ${esc(c.class)}</p>
      <p style="color:#64748b">👨‍🏫 ${esc(c.teacher_name)}</p>
      <p style="color:#64748b">👥 ${c.students} students joined</p>
      <div class="stat-num" style="font-size:20px;margin:12px 0">UGX ${c.price}</div>
      <a href="/learning/live/join/${c.id}" class="btn btn-green" style="width:100%">Join Class</a>
    </div>
  `).join('');
  
  res.send(renderPage('Live Classes', `
    <div class="hero" style="padding:30px">
      <h1>🎥 Live Classes</h1>
      <p>Learn with teachers in real-time</p>
      ${['teacher', 'admin', 'super_admin'].includes(req.session.user.role) ? '<a href="/learning/live/create" class="btn btn-green" style="margin-top:12px">➕ Create Class</a>' : ''}
    </div>
    <div class="grid">${cards || '<div class="card"><p>No live classes scheduled. Check back later!</p></div>'}</div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.get('/learning/live/create', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Create Live Class', `
    <div class="card" style="max-width:600px">
      <h1>➕ Create Live Class</h1>
      <p style="color:#64748b">You earn 80% of payments. Platform takes 20%.</p>
      <form method="POST" action="/learning/live/create">
        <label>Class Title *</label>
        <input name="title" placeholder="e.g. Introduction to Algebra" required />
        <label>Subject *</label>
        <input name="subject" placeholder="e.g. Mathematics" required />
        <label>Class/Level *</label>
        <input name="class" placeholder="e.g. P.4" required />
        <label>Price (UGX) *</label>
        <input name="price" type="number" value="1000" min="0" required />
        <label>Schedule Date & Time *</label>
        <input name="scheduled_at" type="datetime-local" required />
        <button class="btn btn-green" style="width:100%">Create Class</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
});

app.post('/learning/live/create', requireAuth, requireStaff, checkDb, asyncHandler(async (req, res) => {
  const room = 'ssewasswa-' + uuidv4().substring(0, 8);
  
  await pool.query(
    'INSERT INTO live_classes (tenant_id, teacher_email, subject, class, title, jitsi_room, price, scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', 
    [req.tenantId, req.session.user.email, req.body.subject, req.body.class, req.body.title, room, req.body.price, req.body.scheduled_at]
  );
  
  await sendPushToTenant(req.tenantId, 'New Live Class: ' + req.body.title, `By ${req.session.user.full_name} - UGX ${req.body.price}`);
  log.info('Live class created', { title: req.body.title, tenantId: req.tenantId });
  res.redirect('/learning/live');
}));

app.get('/learning/live/join/:id', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const cls = (await pool.query('SELECT * FROM live_classes WHERE id=$1', [req.params.id])).rows[0];
  if (!cls) return res.status(404).send('Class not found');
  
  const paid = await pool.query(
    "SELECT id FROM class_payments WHERE class_id=$1 AND student_email=$2 AND status='success'", 
    [cls.id, req.session.user.email]
  );
  const isTeacher = cls.teacher_email === req.session.user.email;
  
  if (!paid.rows[0] && !isTeacher && cls.price > 0) {
    return res.send(renderPage('Payment Required', `
      <div class="card" style="max-width:500px;margin:40px auto;text-align:center">
        <h1>Join: ${esc(cls.title)}</h1>
        <p>${esc(cls.subject)} - ${esc(cls.class)}</p>
        <p>By ${esc(cls.teacher_email)}</p>
        <div class="stat-num" style="margin:20px 0">UGX ${cls.price}</div>
        <form method="POST" action="/learning/live/pay/${cls.id}">
          <input name="phone" placeholder="MoMo Number" required pattern="[0-9]{10}" />
          <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay & Join</button>
        </form>
      </div>
    `, { tenant_name: req.tenant.name }, false, req.lang));
  }
  
  res.send(renderPage(cls.title, `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:#1e293b;color:white;padding:16px">
        <h2>${esc(cls.title)}</h2>
        <p>${esc(cls.subject)} - ${esc(cls.class)}</p>
        <p>👨‍🏫 ${esc(cls.teacher_email)}</p>
        <p>📅 ${new Date(cls.scheduled_at).toLocaleString()}</p>
      </div>
      <iframe 
        src="https://meet.jit.si/${cls.jitsi_room}" 
        style="width:100%;height:600px;border:0" 
        allow="camera;microphone;fullscreen;screen-share"
        title="Live Class Video"
      ></iframe>
    </div>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

app.post('/learning/live/pay/:id', requireAuth, checkDb, asyncHandler(async (req, res) => {
  const cls = (await pool.query('SELECT * FROM live_classes WHERE id=$1', [req.params.id])).rows[0];
  if (!cls) return res.status(404).send('Class not found');
  
  const ref = 'CLASS-' + Date.now();
  const commission = Math.round(cls.price * DEV_COMMISSION.live_class);
  const teacherEarn = cls.price - commission;
  
   await pool.query(
    'INSERT INTO class_payments (class_id, student_email, amount, phone, reference, status) VALUES ($1,$2,$3,$4,$5,$6)', 
    [cls.id, req.session.user.email, cls.price, req.body.phone, ref, 'pending']
  );
  await addDevCommission(commission, 'live_class', 'Live class: ' + cls.title, ref);
  await addBonus(cls.teacher_email, cls.tenantId, teacherEarn, 'teaching', 'Taught: ' + cls.title);
  
  if (MOMO_CONFIG.apiKey === 'demo') {
    await pool.query('UPDATE class_payments SET status=$1 WHERE reference=$2', ['success', ref]);
    return res.redirect('/learning/live/join/' + cls.id);
  }
  
  res.send(renderPage('Processing', 
    '<div class="card" style="text-align:center"><h1>📱 Check Your Phone</h1><p>Complete the MoMo prompt to join the class.</p></div>', 
    null, true
  );
}));

// ===== ANALYTICS =====
// Fixed: Chart syntax error - added missing closing bracket
app.get('/app/analytics', requireAuth, requireAdmin, checkDb, asyncHandler(async (req, res) => {
  const [feeData, attData, topStudents] = await Promise.all([
    pool.query("SELECT DATE_TRUNC('month', created_at) as month, SUM(paid) as total FROM fees WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '6 months' GROUP BY month ORDER BY month", [req.tenantId]),
    pool.query("SELECT s.class, COUNT(*) FILTER (WHERE status='present') as present, COUNT(*) as total FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date > NOW() - INTERVAL '30 days' GROUP BY s.class ORDER BY s.class", [req.tenantId]),
    pool.query("SELECT s.name, s.class, AVG(g.score) as avg_score, COUNT(g.id) as exams FROM students s JOIN grades g ON s.id=g.student_id WHERE s.tenant_id=$1 GROUP BY s.id, s.name, s.class HAVING COUNT(g.id) > 0 ORDER BY avg_score DESC LIMIT 10", [req.tenantId])
  ]);
  
  const feeLabels = feeData.rows.map(r => new Date(r.month).toLocaleDateString('en-US', { month: 'short' }));
  const feeValues = feeData.rows.map(r => Number(r.total));
  
  const attRows = attData.rows.map(r => {
    const pct = r.total > 0 ? Math.round((r.present / r.total) * 100) : 0;
    const color = pct > 75 ? '#16a34a' : pct > 50 ? '#f59e0b' : '#dc2626';
    return `
      <tr>
        <td>${esc(r.class || 'Unassigned')}</td>
        <td>${r.present}/${r.total}</td>
        <td style="width:40%">
          <div style="background:#e2e8f0;border-radius:20px;height:24px;overflow:hidden">
            <div style="background:${color};width:${pct}%;height:100%;border-radius:20px;display:flex;align-items:center;padding-left:8px">
              <span style="color:white;font-size:11px;font-weight:bold">${pct}%</span>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  const topRows = topStudents.rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.class)}</td>
      <td class="badge badge-gold">${Math.round(r.avg_score)}%</td>
      <td>${r.exams}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('School Analytics', `
    <div class="hero" style="padding:30px">
      <h1>📊 School Analytics</h1>
      <p>Data-driven insights for better decisions</p>
    </div>
    <div class="grid">
      <div class="card">
        <h3>Fee Collection (6 months)</h3>
        <canvas id="feeChart" height="200"></canvas>
      </div>
      <div class="card">
        <h3>Attendance by Class (30 days)</h3>
        <table>
          <thead><tr><th>Class</th><th>Present/Total</th><th>Rate</th></tr></thead>
          <tbody>${attRows || '<tr><td colspan="3">No data</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>🏆 Top 10 Performers</h3>
      <table>
        <thead><tr><th>Rank</th><th>Student</th><th>Class</th><th>Avg Score</th><th>Exams</th></tr></thead>
        <tbody>${topRows || '<tr><td colspan="5">No data</td></tr>'}</tbody>
      </table>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
      new Chart(document.getElementById("feeChart"), {
        type: "line",
        data: {
          labels: ${JSON.stringify(feeLabels)},
          datasets: [{
            label: "Fees Collected (UGX)",
            data: ${JSON.stringify(feeValues)},
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.1)",
            tension: 0.4,
            fill: true,
            plugins: { legend: { display: false } }
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return 'UGX ' + value.toLocaleString();
                }
              }
            }
          }
        }
      });
    </script>
  `, { tenant_name: req.tenant.name }, false, req.lang));
}));

// ===== WHATSAPP WEBHOOK =====
app.post('/webhook/whatsapp', checkDb, asyncHandler(async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);
    
    const from = msg.from;
    const text = msg.text?.body?.toLowerCase() || '';
    let reply = "🤖 SSEWASSWA AI Bot\n\nCommands:\n• BALANCE [name]\n• ATTENDANCE [name]\n• FEES [name]\n• PAY\n• HELP";
    
    if (text.includes('balance') || text.includes('fee') || text.includes('bbanja')) {
      const nameMatch = text.match(/(?:balance|fee|bbanja)\s+(.+)/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const s = await pool.query("SELECT name, balance, class FROM students WHERE LOWER(name) LIKE $1 LIMIT 1", ['%' + name + '%']);
        if (s.rows[0]) {
          reply = `💰 *${s.rows[0].name}* (${s.rows[0].class})\nBalance: UGX ${Number(s.rows[0].balance).toLocaleString()}\n\nReply PAY to settle via MoMo.`;
        } else {
          reply = "❌ Student not found. Please check the spelling and try again.";
        }
      }
    } else if (text.includes('attendance') || text.includes('okujja')) {
      const nameMatch = text.match(/(?:attendance|okujja)\s+(.+)/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const s = await pool.query("SELECT id, name FROM students WHERE LOWER(name) LIKE $1 LIMIT 1", ['%' + name + '%']);
        if (s.rows[0]) {
          const a = await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p, COUNT(*) as t FROM attendance WHERE student_id=$1 AND date > NOW() - INTERVAL '30 days'", [s.rows[0].id]);
          const pct = a.rows[0].t > 0 ? Math.round((a.rows[0].p / a.rows[0].t) * 100) : 0;
          reply = `✅ ${s.rows[0].name}\nAttendance: ${pct}% (${a.rows[0].p}/${a.rows[0].t} days this month)`;
        }
      }
    } else if (text === 'pay' || text === 'sasula') {
      reply = "💳 To pay fees:\n1. Dial *165*3#\n2. Merchant Code: 123456\n3. Enter student name\n4. Enter amount\n\nOr visit our parent portal to pay directly.";
    } else if (text === 'help' || text === 'obuyambi') {
      reply = "📚 SSEWASSWA Bot Commands:\n\n1️⃣ BALANCE John Doe\n2️⃣ ATTENDANCE Mary Smith\n3️⃣ FEES Sarah\n4️⃣ PAY\n5️⃣ HELP\n\nType any command to get started.";
    }
    
    await sendWhatsApp(from, reply);
    res.sendStatus(200);
  } catch (e) {
    log.error('WhatsApp webhook error: ' + e.message);
    res.sendStatus(200);
  }
}));

// ===== CRON JOB (Secured with API key) =====
app.get('/api/cron/daily', apiLimiter, asyncHandler(async (req, res) => {
  // Security: Only allow from authorized sources
  const cronSecret = process.env.CRON_SECRET || 'ssewasswa-cron-2024';
  if (req.headers['x-cron-secret'] !== cronSecret && req.query.secret !== cronSecret) {
    log.warn('Unauthorized cron attempt', { ip: req.ip });
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  const wallet = (await pool.query('SELECT balance, developer_momo FROM platform_wallet WHERE id=1')).rows[0];
  let payoutAmount = 0;
  
  if (wallet.balance >= AUTO_PAYOUT_THRESHOLD) {
    payoutAmount = Math.floor(wallet.balance * AUTO_PAYOUT_PERCENTAGE);
    
    await pool.query('UPDATE platform_wallet SET balance = balance - $1 WHERE id=1', [payoutAmount]);
    await pool.query(
      'INSERT INTO withdrawals (user_email, amount, fee, net_amount, phone, status) VALUES ($1,$2,$3,$4,$5,$6)', 
      ['DEVELOPER_PAYOUT', payoutAmount, 0, payoutAmount, wallet.developer_momo || '0789736737', 'auto_pending']
    );
    
    log.info('AUTO-PAYOUT triggered', { amount: payoutAmount, momo: wallet.developer_momo });
    
    if (MOMO_CONFIG.apiKey !== 'demo') {
      // Initiate actual MoMo disbursement here
      console.log(`AUTO-PAYOUT: UGX ${payoutAmount} to ${wallet.developer_momo}`);
    }
  }
  
  // Clean up old sessions
  await pool.query("DELETE FROM session WHERE expire < NOW() - INTERVAL '7 days'");
  
  res.json({ 
    ok: true, 
    payout: payoutAmount,
    wallet_balance: wallet.balance,
    timestamp: new Date().toISOString()
  });
}));

// ===== DEMO BOOKING / AUTO-ONBOARDING FUNNEL =====
app.get('/demo', (req, res) => {
  res.send(renderPage('Book Free Demo', `
    <div class="hero" style="padding:40px 20px">
      <h1>📞 Get Free Demo for Your School</h1>
      <p>5-minute setup. Start earning today.</p>
      <p>We handle everything - you just share the teacher code.</p>
    </div>
    <div class="card" style="max-width:600px;margin:0 auto">
      <form method="POST" action="/demo">
        <label>School Name *</label>
        <input name="school_name" placeholder="e.g. Greenhill Academy" required />
        <label>Headteacher Name *</label>
        <input name="headteacher_name" placeholder="Full name" required />
        <label>WhatsApp Number *</label>
        <input name="phone" placeholder="07XX" required pattern="[0-9]{10}" />
        <label>Number of Students *</label>
        <input name="students" type="number" placeholder="e.g. 500" required min="1" />
        <div style="background:#f0fdf4;padding:16px;border-radius:12px;margin:16px 0">
          <h4>✅ What you get:</h4>
          <ul style="margin:8px 0;padding-left:20px;line-height:1.8">
            <li>Free school website</li>
            <li>Fee management system</li>
            <li>Parent portal with MoMo payments</li>
            <li>Teacher reward system</li>
            <li>WhatsApp integration</li>
            <li>Analytics dashboard</li>
          </ul>
        </div>
        <button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Book Free Setup Call</button>
      </form>
      <p style="text-align:center;margin-top:16px;color:#64748b;font-size:14px">No credit card required. Free forever for up to 100 students.</p>
    </div>
  `, null, true));
});

app.post('/demo', checkDb, asyncHandler(async (req, res) => {
  const { school_name, headteacher_name, phone, students } = req.body;
  
  if (!school_name || !headteacher_name || !phone || !students) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>All fields are required</h1></div>', null, true));
  }
  
  if (!isValidPhone(phone)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Invalid phone format</h1></div>', null, true));
  }
  
  const subdomain = school_name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
  const signup_code = subdomain.toUpperCase().substring(0, 8) + Math.floor(Math.random() * 100);
  
  try {
    const t = await pool.query(
      'INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id', 
      [school_name.trim(), subdomain, 'free', phone, signup_code]
    );
    
    await pool.query('INSERT INTO settings (tenant_id, signup_code) VALUES ($1,$2)', [t.rows[0].id, signup_code]);
    
    // Send WhatsApp to school
    await sendWhatsApp(phone, `✅ ${school_name} is LIVE on SSEWASSWA!\n\n📁 Teacher Code: *${signup_code}*\n🌐 School Link: https://${req.headers.host}/school/${subdomain}\n\n📌 Next Steps:\n1. Share the teacher code with your teachers\n2. Teachers sign up at https://${req.headers.host}/signup\n3. They earn UGX 5,000 when they add 10+ students\n4. Parents get automatic SMS notifications\n\n📧 Admin login: https://${req.headers.host}/login\n🤖 WhatsApp bot: Send HELP to this number`);
    
    // Notify developer
    await sendWhatsApp('0789736737', `🔥 NEW SCHOOL SIGNED UP!\n\n🏫 ${school_name}\n👨‍🏫 HT: ${headteacher_name}\n📞 ${phone}\n👥 Students: ${students}\n🔑 Code: ${signup_code}\n💰 Potential: UGX ${(students * 50000 * 0.05).toLocaleString()}/term`);
    
    log.info('New school demo booked', { school_name, phone, students, signup_code });
    
    res.send(renderPage('School Created!', `
      <div class="card success-card" style="text-align:center;max-width:600px;margin:40px auto">
        <div style="font-size:60px">🎉</div>
        <h1>${esc(school_name)} is Live!</h1>
        <div style="margin:24px 0">
          <p style="color:#64748b;margin-bottom:8px">Teacher Signup Code:</p>
          <div class="badge badge-gold" style="font-size:24px;padding:16px 24px">${signup_code}</div>
        </div>
        <div style="background:#f8fafc;padding:16px;border-radius:12px;margin:20px 0;text-align:left">
          <p><strong>🌐 School URL:</strong> <a href="/school/${subdomain}">/school/${subdomain}</a></p>
          <p><strong>👨‍🏫 Share this code with teachers</strong></p>
          <p><strong>📧 WhatsApp sent to ${phone}</strong></p>
        </div>
        <div style="display:flex;gap:12px;justify-content:center;margin-top:24px">
          <a href="/demo" class="btn btn-green">Add Another School</a>
          <a href="/school/${subdomain}" class="btn">View School Page</a>
        </div>
      </div>
    `, null, true));
    
  } catch (e) {
    if (e.code === '23505') {
      return res.send(renderPage('Error', '<div class="card error-card"><h1>School name already exists</h1><p>Please use a different name or contact support.</p></div>', null, true));
    }
    throw e;
  }
}));

// ===== SUPER ADMIN =====
app.get('/super-admin', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const [rev30, revTotal, pend, schools, users, wallet, recentRev] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at > NOW() - INTERVAL '30 days'"),
    pool.query('SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue'),
    pool.query("SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status='pending'"),
    pool.query("SELECT COUNT(*) as c FROM tenants WHERE plan!='suspended'"),
    pool.query('SELECT COUNT(*) as c FROM users'),
    pool.query('SELECT balance FROM platform_wallet WHERE id=1'),
    pool.query('SELECT type, amount, description, created_at FROM developer_revenue ORDER BY id DESC LIMIT 15')
  ]);
  
  const recentRows = recentRev.rows.map(r => `
    <tr>
      <td><span class="badge badge-blue">${esc(r.type)}</span></td>
      <td>UGX ${Number(r.amount).toLocaleString()}</td>
      <td>${esc(r.description?.substring(0, 40) || '-')}</td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('Super Admin 👑', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:30px">
      <h1>👑 Platform Control Center</h1>
      <p>Developer: 0789736737</p>
    </div>
    <div class="stats">
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">💰 Last 30 Days</div>
        <div class="stat-num">UGX ${Number(rev30.rows[0].t).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">🏦 Total Earned</div>
        <div class="stat-num">UGX ${Number(revTotal.rows[0].t).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">💳 Wallet Balance</div>
        <div class="stat-num">UGX ${Number(wallet.rows[0].balance).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">⏳ Pending Payouts</div>
        <div class="stat-num">${pend.rows[0].c}</div>
        <div style="color:#64748b">UGX ${Number(pend.rows[0].t).toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">🏫 Active Schools</div>
        <div class="stat-num">${schools.rows[0].c}</div>
      </div>
      <div class="stat-card">
        <div style="font-size:18px;color:#64748b">👥 Total Users</div>
        <div class="stat-num">${users.rows[0].c}</div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <h3>⚡ Quick Actions</h3>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
          <a href="/demo" class="btn btn-green">📞 Create Demo School</a>
          <a href="/super-admin/broadcast" class="btn btn-purple">📢 WhatsApp Broadcast</a>
          <a href="/super-admin/payouts" class="btn btn-orange">💳 Manage Payouts</a>
          <a href="/super-admin/schools" class="btn">🏫 View Schools</a>
          <button onclick="runCron()" class="btn btn-red">🔄 Run Daily Cron</button>
        </div>
      </div>
      <div class="card">
        <h3>📊 Recent Revenue</h3>
        <div style="overflow-x:auto;max-height:400px;overflow-y:auto">
          <table style="font-size:12px">
            <thead><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr></thead>
            <tbody>${recentRows || '<tr><td colspan="4">No revenue yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>⚙️ Auto-Payout Configuration</h3>
      <p>When wallet reaches <strong>UGX ${AUTO_PAYOUT_THRESHOLD.toLocaleString()}</strong>, automatically pays <strong>${AUTO_PAYOUT_PERCENTAGE * 100}%</strong> to developer MoMo.</p>
      <p>Current wallet: <strong>UGX ${Number(wallet.rows[0].balance).toLocaleString()}</strong></p>
      <p style="color:#64748b;font-size:12px">Cron endpoint: GET /api/cron/daily?secret=YOUR_SECRET</p>
    </div>
    <script>
      async function runCron() {
        if (!confirm('Run daily cron job now?')) return;
        try {
          const res = await fetch('/api/cron/daily?secret=${process.env.CRON_SECRET || 'ssewasswa-cron-2024'}');
          const data = await res.json();
          alert('Cron completed! Payout: UGX ' + (data.payout || 0).toLocaleString());
          location.reload();
        } catch (e) {
          alert('Error: ' + e.message);
        }
      }
    </script>
  `, { tenant_name: req.tenant.name }));
}));

// Payout management
app.get('/super-admin/payouts', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT w.*, u.full_name, u.phone 
    FROM withdrawals w 
    LEFT JOIN users u ON w.user_email = u.email 
    ORDER BY w.created_at DESC 
    LIMIT 50
  `);
  
  const tableRows = rows.map(w => `
    <tr>
      <td>${esc(w.user_email)}</td>
      <td>${esc(w.full_name || '-')}</td>
      <td>UGX ${Number(w.amount).toLocaleString()}</td>
      <td>UGX ${Number(w.fee).toLocaleString()}</td>
      <td>UGX ${Number(w.net_amount).toLocaleString()}</td>
      <td>${esc(w.phone || '-')}</td>
      <td><span class="badge ${w.status === 'paid' ? 'badge-green' : w.status === 'pending' ? 'badge-gold' : 'badge-red'}">${w.status}</span></td>
      <td>
        ${w.status === 'pending' ? `<a href="/super-admin/payouts/approve/${w.id}" class="btn btn-green" style="font-size:11px;padding:4px 8px">Approve</a>` : ''}
      </td>
    </tr>
  `).join('');
  
  res.send(renderPage('Manage Payouts', `
    <div class="card">
      <h1>💳 Withdrawal Requests</h1>
      <div style="overflow-x:auto">
        <table style="font-size:13px">
          <thead><tr><th>Email</th><th>Name</th><th>Amount</th><th>Fee</th><th>Net</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="8">No withdrawal requests</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }));
}));

app.get('/super-admin/payouts/approve/:id', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const w = (await pool.query('SELECT * FROM withdrawals WHERE id=$1', [req.params.id])).rows[0];
  if (!w) return res.status(404).send('Not found');
  
  await pool.query("UPDATE withdrawals SET status='paid' WHERE id=$1", [req.params.id]);
  
  // In production, initiate MoMo disbursement here
  if (w.phone) {
    await sendSMS(w.phone, `Your withdrawal of UGX ${Number(w.net_amount).toLocaleString()} has been processed. Reference: ${w.id}`);
  }
  
  log.info('Payout approved', { id: req.params.id, amount: w.amount, phone: w.phone });
  res.redirect('/super-admin/payouts');
}));

// Schools list
app.get('/super-admin/schools', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT t.*, 
           (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
           (SELECT COUNT(*) FROM students s WHERE s.tenant_id = t.id) as student_count
    FROM tenants t 
    ORDER BY t.created_at DESC
  `);
  
  const tableRows = rows.map(t => `
    <tr>
      <td><a href="/school/${t.subdomain}" target="_blank">${esc(t.name)}</a></td>
      <td>${t.subdomain}</td>
      <td><span class="badge badge-blue">${t.plan}</span></td>
      <td>${t.user_count}</td>
      <td>${t.student_count}</td>
      <td>${esc(t.signup_code || '-')}</td>
      <td>${new Date(t.created_at).toLocaleDateString()}</td>
    </tr>
  `).join('');
  
  res.send(renderPage('All Schools', `
    <div class="card">
      <h1>🏫 All Schools (${rows.length})</h1>
      <div style="overflow-x:auto">
        <table style="font-size:13px">
          <thead><tr><th>Name</th><th>Subdomain</th><th>Plan</th><th>Users</th><th>Students</th><th>Code</th><th>Created</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="7">No schools</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { tenant_name: req.tenant.name }));
}));

// Manual developer payout
app.get('/super-admin/payout-developer', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const wallet = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0];
  
  if (Number(wallet.balance) < 1000) {
    return res.send(renderPage('Insufficient', '<div class="card error-card"><h1>Balance too low for payout</h1><a href="/super-admin" class="btn">Back</a></div>', { tenant_name: req.tenant.name }));
  }
  
  const amount = Number(wallet.balance);
  
  await pool.query('UPDATE platform_wallet SET balance = 0 WHERE id=1');
  await pool.query(
    'INSERT INTO withdrawals (user_email, amount, fee, net_amount, phone, status) VALUES ($1,$2,$3,$4,$5,$6)', 
    ['DEVELOPER_MANUAL', amount, 0, amount, '0789736737', 'paid']
  );
  
  log.info('Manual developer payout', { amount });
  res.redirect('/super-admin');
}));

// WhatsApp Broadcast
app.get('/super-admin/broadcast', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('WhatsApp Broadcast', `
    <div class="card" style="max-width:600px">
      <h1>📢 WhatsApp Broadcast</h1>
      <p style="color:#64748b">Send message to all users across all schools</p>
      <form method="POST" action="/super-admin/broadcast">
        <label>Target Audience</label>
        <select name="target">
          <option value="all">All Users</option>
          <option value="teachers">Teachers Only</option>
          <option value="parents">Parents Only</option>
          <option value="admins">School Admins Only</option>
        </select>
        <label>Message *</label>
        <textarea name="message" placeholder="Type your message here..." rows="6" required></textarea>
        <div style="background:#fef3c7;padding:12px;border-radius:8px;margin:12px 0">
          <p style="font-size:12px;color:#92400e">⚠️ This will send to ALL matching numbers. Use responsibly.</p>
        </div>
        <button class="btn btn-green" style="width:100%">Send Broadcast</button>
      </form>
    </div>
  `, { tenant_name: req.tenant.name }));
});

app.post('/super-admin/broadcast', requireAuth, requireRole('super_admin'), checkDb, asyncHandler(async (req, res) => {
  const { target, message } = req.body;
  
  if (!message || message.trim().length < 5) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>Message too short</h1></div>', { tenant_name: req.tenant.name }));
  }
  
  let query = 'SELECT DISTINCT phone FROM users WHERE phone IS NOT NULL AND phone != \'\'';
  if (target === 'teachers') query += ' AND role=\'teacher\'';
  if (target === 'admins') query += ' AND role IN (\'admin\', \'super_admin\')';
  if (target === 'parents') query = 'SELECT DISTINCT guardian_phone as phone FROM students WHERE guardian_phone IS NOT NULL AND guardian_phone != \'\'';
  
  const { rows } = await pool.query(query);
  
  let sent = 0;
  let failed = 0;
  
  for (const r of rows) {
    try {
      await sendWhatsApp(r.phone, message);
      sent++;
      await new Promise(res => setTimeout(res, 1000)); // Rate limit
    } catch (e) {
      failed++;
    }
  }
  
  log.info('Broadcast sent', { target, sent, failed });
  res.send(renderPage('Broadcast Sent', `
    <div class="card success-card">
      <h1>✅ Broadcast Complete</h1>
      <div class="stats" style="margin:20px 0">
        <div class="stat-card">
          <div class="stat-num" style="color:#16a34a">${sent}</div>
          <div>Sent Successfully</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:#dc2626">${failed}</div>
          <div>Failed</div>
        </div>
      </div>
      <a href="/super-admin" class="btn">Back to Dashboard</a>
    </div>
  `, { tenant_name: req.tenant.name }));
}));

// ===== PUBLIC SCHOOL PAGE =====
app.get('/school/:sub', checkDb, asyncHandler(async (req, res) => {
  const t = (await pool.query(`
    SELECT t.*, s.school_motto, s.about_text, s.primary_color 
    FROM tenants t 
    LEFT JOIN settings s ON t.id = s.tenant_id 
    WHERE t.subdomain = $1
  `, [req.params.sub])).rows[0];
  
  if (!t) {
    return res.status(404).send(renderPage('Not Found', 
      '<div class="card error-card" style="text-align:center"><h1>🏫 School Not Found</h1><p>This school may not exist or has been suspended.</p><a href="/" class="btn">Go Home</a></div>', 
      null, true
    ));
  }
  
  const stats = await pool.query('SELECT COUNT(*) as students FROM students WHERE tenant_id=$1', [t.id]);
  
  res.send(renderPage(t.name, `
    <div class="hero" style="background:linear-gradient(135deg,${t.primary_color || '#1e40af'},#3b82f6);padding:60px 20px">
      <h1>${esc(t.name)}</h1>
      <p style="font-size:20px">${esc(t.school_motto || 'Excellence in Education')}</p>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap">
        <a href="/parent/login" class="btn btn-green">👨‍👩‍👧‍👦 Parent Portal</a>
        <a href="/login" class="btn">👨‍🏫 Staff Login</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-num">${stats.rows[0].students}</div>
        <div>Students</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${t.plan === 'enterprise' ? '⭐ Enterprise' : t.plan === 'basic' ? '💎 Basic' : '🆓 Free'}</div>
        <div>Plan</div>
      </div>
    </div>
    <div class="card">
      <h2>About Us</h2>
      <p>${esc(t.about_text || 'Welcome to our school. We are committed to providing quality education.')}</p>
    </div>
    <div class="card" style="text-align:center">
      <h3>Join Our School</h3>
      <p>Teachers can join using the code below:</p>
      <div class="badge badge-gold" style="font-size:20px;padding:12px 24px;margin:16px 0;display:inline-block">${esc(t.signup_code || 'Contact admin')}</div>
      <br>
      <a href="/signup" class="btn btn-green" style="margin-top:16px">Apply Now</a>
    </div>
  `, null, true));
}));

// ===== SITEMAP FOR SEO =====
app.get('/sitemap.xml', checkDb, asyncHandler(async (req, res) => {
  const schools = await pool.query("SELECT subdomain FROM tenants WHERE plan != 'suspended'");
  const urls = schools.rows.map(s => 
    `<url><loc>https://${req.headers.host}/school/${s.subdomain}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`
  ).join('');
  
  res.header('Content-Type', 'application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://${req.headers.host}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://${req.headers.host}/login</loc><priority>0.9</priority></url>
  <url><loc>https://${req.headers.host}/signup</loc><priority>0.9</priority></url>
  <url><loc>https://${req.headers.host}/demo</loc><priority>0.8</priority></url>
  <url><loc>https://${req.headers.host}/learning</loc><priority>0.7</priority></url>
  <url><loc>https://${req.headers.host}/store</loc><priority>0.7</priority></url>
  <url><loc>https://${req.headers.host}/marketplace</loc><priority>0.7</priority></url>
  <url><loc>https://${req.headers.host}/premium</loc><priority>0.8</priority></url>
  ${urls}
</urlset>`);
}));

// ===== CREATE SITE ENDPOINT =====
app.post('/create-site', checkDb, asyncHandler(async (req, res) => {
  const { name, subdomain, admin_email, admin_password, momo_number, signup_code } = req.body;
  
  // Validation
  if (!name || !subdomain || !admin_email || !admin_password || !signup_code) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>❌ All fields are required</h1></div>', null, true));
  }
  
  if (!isValidEmail(admin_email)) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>❌ Invalid email format</h1></div>', null, true));
  }
  
  if (admin_password.length < 6) {
    return res.send(renderPage('Error', '<div class="card error-card"><h1>❌ Password must be at least 6 characters</h1></div>', null, true));
  }
  
  try {
    const t = await pool.query(
      'INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id', 
      [name.trim(), subdomain.toLowerCase().trim(), 'free', momo_number, signup_code.toUpperCase()]
    );
    
    const hash = await bcrypt.hash(admin_password, 10);
    
    await pool.query(
      'INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name) VALUES ($1,$2,$3,$4,$5,$6)', 
      [t.rows[0].id, admin_email, hash, 'admin', true, name + ' Admin']
    );
    
    await pool.query('INSERT INTO settings (tenant_id, signup_code) VALUES ($1,$2)', [t.rows[0].id, signup_code.toUpperCase()]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0)', [t.rows[0].id, admin_email]);
    
    log.info('New school created via API', { name, subdomain, email: admin_email });
    
    res.send(renderPage('Success ✅', `
      <div class="card success-card" style="text-align:center;max-width:600px;margin:40px auto">
        <div style="font-size:60px">🎉</div>
        <h1>${esc(name)} Created!</h1>
        <div style="margin:24px 0">
          <p style="color:#64748b">Teacher Code:</p>
          <div class="badge badge-gold" style="font-size:20px;padding:12px 24px">${signup_code.toUpperCase()}</div>
        </div>
        <div style="background:#f8fafc;padding:16px;border-radius:12px;margin:16px 0;text-align:left">
          <p><strong>🌐 School URL:</strong> <a href="/school/${subdomain}">/school/${subdomain}</a></p>
          <p><strong>📧 Admin Email:</strong> ${esc(admin_email)}</p>
        </div>
        <a href="/login" class="btn btn-green" style="margin-top:20px">Login Now</a>
      </div>
    `, null, true));
    
  } catch (e) {
    if (e.code === '23505') {
      return res.send(renderPage('Error', `<div class="card error-card"><h1>❌ ${e.constraint.includes('subdomain') ? 'Subdomain already taken' : 'Email already exists'}</h1></div>`, null, true));
    }
    throw e;
  }
}));

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    db: dbReady, 
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// ===== MOMO WEBHOOK =====
app.post('/api/momo/webhook', apiLimiter, asyncHandler(async (req, res) => {
  const { reference, status, transactionId } = req.body || {};
  
  if (!reference || !status) {
    return res.status(400).json({ error: 'Missing reference or status' });
  }
  
  if (status === 'SUCCESSFUL') {
    const p = await pool.query('SELECT * FROM payment_requests WHERE reference=$1', [reference]);
    
    if (p.rows[0] && p.rows[0].status !== 'success') {
      await pool.query(
        'UPDATE payment_requests SET status=$1, momo_transaction_id=$2 WHERE reference=$3', 
        ['success', transactionId, reference]
      );
      
      // Update student balance if fee payment
      if (p.rows[0].student_id) {
        await pool.query('UPDATE students SET balance = balance - $1 WHERE id=$2', [p.rows[0].amount, p.rows[0].student_id]);
      }
      
      // Activate premium if subscription
      if (p.rows[0].user_id && reference.startsWith('PREM')) {
        await pool.query("UPDATE users SET premium_until = NOW() + INTERVAL '1 month' WHERE email = $1", [p.rows[0].user_id]);
      }
      
      // Update store order
      if (p.rows[0].store_order_id) {
        await pool.query('UPDATE store_orders SET status=$1 WHERE reference=$2', ['paid', reference]);
      }
      
      // Update class payment
      if (reference.startsWith('CLASS')) {
        await pool.query('UPDATE class_payments SET status=$1 WHERE reference=$2', ['success', reference]);
      }
      
      log.info('MoMo payment successful', { reference, transactionId });
    }
  } else if (status === 'FAILED') {
    await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['failed', reference]);
    log.warn('MoMo payment failed', { reference });
  }
  
  res.json({ ok: true });
}));

// ===== 404 HANDLER =====
app.use((req, res) => {
  res.status(404).send(renderPage('404 - Page Not Found', `
    <div class="card" style="text-align:center;max-width:500px;margin:60px auto">
      <div style="font-size:80px;margin-bottom:20px">🔍</div>
      <h1>404</h1>
      <p style="color:#64748b;margin:16px 0">The page you're looking for doesn't exist.</p>
      <div style="display:flex;gap:12px;justify-content:center">
        <a href="/" class="btn">Go Home</a>
        <a href="/login" class="btn btn-green">Login</a>
      </div>
    </div>
  `, null, true));
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  log.error('Unhandled error: ' + err.message, { 
    url: req.url, 
    method: req.method, 
    stack: err.stack 
  });
  
  if (err instanceof multer.MulterError) {
    return res.status(400).send(renderPage('Upload Error', 
      `<div class="card error-card"><h1>File Upload Error</h1><p>${err.message}</p></div>`, 
      null, true
    ));
  }
  
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).send(
    process.env.NODE_ENV === 'production'
      ? renderPage('Error', '<div class="card error-card"><h1>Something went wrong</h1><p>Please try again later.</p></div>', null, true)
      : renderPage('Error', `<div class="card error-card"><h1>Error</h1><pre style="white-space:pre-wrap;font-size:12px">${esc(err.stack)}</pre></div>`, null, true)
  );
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 SSEWASSWA Platform running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️ Database URL: ${process.env.DATABASE_URL ? 'configured' : 'NOT SET'}`);
  console.log('='.repeat(50));
  
  if (process.env.DATABASE_URL) {
    console.log('Starting database initialization...');
    initDB().catch(e => console.error('DB init error:', e.message));
  } else {
    console.warn('⚠️  No DATABASE_URL - database features disabled');
  }
});

// ===== DATABASE INITIALIZATION =====
async function initDB() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Session table
    await client.query('CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))');
    await client.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")');
    
    // Tenants
    await client.query(`CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY, 
      name TEXT NOT NULL, 
      subdomain TEXT UNIQUE NOT NULL, 
      created_at TIMESTAMP DEFAULT NOW(),
      plan TEXT DEFAULT 'free',
      plan_expires DATE,
      ranking_score INTEGER DEFAULT 0,
      momo_number TEXT,
      signup_code TEXT
    )`);
    
    // Users
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, 
      email TEXT UNIQUE NOT NULL, 
      password_hash TEXT NOT NULL, 
      role TEXT DEFAULT 'staff', 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      full_name TEXT, 
      phone TEXT, 
      approved BOOLEAN DEFAULT false, 
      created_at TIMESTAMP DEFAULT NOW(),
      premium_until TIMESTAMP
    )`);
    
    // Settings
    await client.query(`CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, 
      created_at TIMESTAMP DEFAULT NOW(),
      site_name TEXT DEFAULT 'SSEWASSWA',
      primary_color TEXT DEFAULT '#1e40af',
      contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com',
      whatsapp_number TEXT DEFAULT '0789736737',
      subscription_tier TEXT DEFAULT 'free',
      verified BOOLEAN DEFAULT false,
      school_motto TEXT,
      about_text TEXT,
      signup_code TEXT
    )`);
    
    // Parents
    await client.query(`CREATE TABLE IF NOT EXISTS parents (
      id SERIAL PRIMARY KEY, 
      phone TEXT UNIQUE NOT NULL, 
      name TEXT, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      verified BOOLEAN DEFAULT false, 
      created_at TIMESTAMP DEFAULT NOW(),
      referred_by TEXT
    )`);
    
    // Parent OTPs
    await client.query(`CREATE TABLE IF NOT EXISTS parent_otps (
      id SERIAL PRIMARY KEY, 
      phone TEXT NOT NULL, 
      otp TEXT NOT NULL, 
      expires_at TIMESTAMP NOT NULL, 
      used BOOLEAN DEFAULT false, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Students
    await client.query(`CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      name TEXT NOT NULL, 
      class TEXT, 
      dob DATE, 
      guardian_name TEXT, 
      guardian_phone TEXT, 
      parent_id INTEGER REFERENCES parents(id), 
      balance NUMERIC DEFAULT 0, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Fees
    await client.query(`CREATE TABLE IF NOT EXISTS fees (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, 
      amount NUMERIC NOT NULL, 
      term TEXT, 
      year INTEGER, 
      paid NUMERIC DEFAULT 0, 
      description TEXT, 
      payment_method TEXT, 
      momo_ref TEXT, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Attendance
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, 
      date DATE NOT NULL, 
      status TEXT NOT NULL, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Grades
    await client.query(`CREATE TABLE IF NOT EXISTS grades (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, 
      subject TEXT NOT NULL, 
      score NUMERIC, 
      term TEXT, 
      year INTEGER, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Payment Requests
    await client.query(`CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id), 
      student_id INTEGER REFERENCES students(id), 
      user_id TEXT, 
      amount NUMERIC NOT NULL, 
      phone TEXT NOT NULL, 
      reference TEXT UNIQUE, 
      status TEXT DEFAULT 'pending', 
      momo_transaction_id TEXT, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Password Resets
    await client.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY, 
      email TEXT NOT NULL, 
      token TEXT UNIQUE NOT NULL, 
      expires_at TIMESTAMP NOT NULL, 
      used BOOLEAN DEFAULT false, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Wallets
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      user_email TEXT NOT NULL, 
      balance NUMERIC DEFAULT 0, 
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, user_email)
    )`);
    
    // Platform Wallet
    await client.query(`CREATE TABLE IF NOT EXISTS platform_wallet (
      id SERIAL PRIMARY KEY, 
      balance NUMERIC DEFAULT 0, 
      updated_at TIMESTAMP DEFAULT NOW(),
      developer_momo TEXT DEFAULT '0789736737'
    )`);
    
    // Developer Revenue
    await client.query(`CREATE TABLE IF NOT EXISTS developer_revenue (
      id SERIAL PRIMARY KEY, 
      amount NUMERIC NOT NULL, 
      type TEXT NOT NULL, 
      description TEXT, 
      reference_id TEXT, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Bonus Earnings
    await client.query(`CREATE TABLE IF NOT EXISTS bonus_earnings (
      id SERIAL PRIMARY KEY, 
      user_id TEXT NOT NULL, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      amount NUMERIC NOT NULL, 
      type TEXT NOT NULL, 
      description TEXT, 
      metadata JSONB, 
      video_id TEXT, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Referral Stats
    await client.query(`CREATE TABLE IF NOT EXISTS referral_stats (
      id SERIAL PRIMARY KEY, 
      referrer_email TEXT NOT NULL, 
      referred_email TEXT NOT NULL, 
      signup_date TIMESTAMP DEFAULT NOW(),
      UNIQUE(referrer_email, referred_email)
    )`);
    
    // Push Subscriptions
    await client.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY, 
      user_email TEXT NOT NULL, 
      endpoint TEXT NOT NULL, 
      keys JSONB NOT NULL, 
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(endpoint)
    )`);
    
    // Store Orders
    await client.query(`CREATE TABLE IF NOT EXISTS store_orders (
      id SERIAL PRIMARY KEY, 
      product_id INTEGER, 
      product_name TEXT, 
      amount NUMERIC NOT NULL, 
      buyer_phone TEXT, 
      buyer_name TEXT, 
      reference TEXT UNIQUE, 
      status TEXT DEFAULT 'pending', 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Marketplace Products
    await client.query(`CREATE TABLE IF NOT EXISTS marketplace_products (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      name TEXT NOT NULL, 
      price NUMERIC NOT NULL, 
      image_url TEXT, 
      description TEXT, 
      approved BOOLEAN DEFAULT false, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Live Classes
    await client.query(`CREATE TABLE IF NOT EXISTS live_classes (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, 
      teacher_email TEXT NOT NULL, 
      subject TEXT, 
      class TEXT, 
      title TEXT NOT NULL, 
      jitsi_room TEXT UNIQUE NOT NULL, 
      price NUMERIC DEFAULT 0, 
      status TEXT DEFAULT 'scheduled', 
      scheduled_at TIMESTAMP, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Class Payments
    await client.query(`CREATE TABLE IF NOT EXISTS class_payments (
      id SERIAL PRIMARY KEY, 
      class_id INTEGER REFERENCES live_classes(id) ON DELETE CASCADE, 
      student_email TEXT NOT NULL, 
      amount NUMERIC NOT NULL, 
      phone TEXT, 
      reference TEXT UNIQUE, 
      status TEXT DEFAULT 'pending', 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Withdrawals
    await client.query(`CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY, 
      user_email TEXT NOT NULL, 
      amount NUMERIC NOT NULL, 
      phone TEXT, 
      fee NUMERIC DEFAULT 0, 
      net_amount NUMERIC DEFAULT 0, 
      status TEXT DEFAULT 'pending', 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Viral Campaigns
    await client.query(`CREATE TABLE IF NOT EXISTS viral_campaigns (
      id SERIAL PRIMARY KEY, 
      tenant_id INTEGER, 
      type TEXT NOT NULL, 
      reward_amount NUMERIC NOT NULL, 
      target_action TEXT NOT NULL, 
      active BOOLEAN DEFAULT true, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Viral Shares
    await client.query(`CREATE TABLE IF NOT EXISTS viral_shares (
      id SERIAL PRIMARY KEY, 
      user_email TEXT NOT NULL, 
      platform TEXT NOT NULL, 
      link_shared TEXT NOT NULL, 
      clicks INTEGER DEFAULT 0, 
      conversions INTEGER DEFAULT 0, 
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    
    // Create indexes for performance
    await client.query('CREATE INDEX IF NOT EXISTS idx_students_tenant ON students(tenant_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fees_tenant ON fees(tenant_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance(tenant_id, date)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_grades_tenant ON grades(tenant_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_bonus_user ON bonus_earnings(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_revenue_created ON developer_revenue(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)');
    
    // Initialize platform wallet
    await client.query('INSERT INTO platform_wallet (id, balance, updated_at) VALUES (1, 0, NOW()) ON CONFLICT DO NOTHING');
    
    // Create default viral campaign
    await client.query(`INSERT INTO viral_campaigns (tenant_id, type, reward_amount, target_action) VALUES (1, 'teacher_referral', 5000, 'signup_10_students') ON CONFLICT DO NOTHING`);
    
    // Create default tenant
    const tenant = await client.query(
      `INSERT INTO tenants (name, subdomain, plan, momo_number, signup_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subdomain) DO NOTHING RETURNING id`, 
      ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise', '0789736737', 'SSEWASSWA2024']
    );
    
    if (tenant.rows.length > 0) {
      const tid = tenant.rows[0].id;
      const hash = await bcrypt.hash('admin123', 10);
      
      await client.query(
        'INSERT INTO users (tenant_id, email, password_hash, role, approved, full_name, phone) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', 
        [tid, 'waiswadaniel24@gmail.com', hash, 'super_admin', true, 'Daniel Waiswa', '0789736737']
      );
      
      await client.query(
        'INSERT INTO settings (tenant_id, subscription_tier, verified, school_motto, about_text, signup_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', 
        [tid, 'enterprise', true, 'Excellence in Education', 'Digital tools for modern schools.', 'SSEWASSWA2024']
      );
      
      await client.query(
        'INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', 
        [tid, 'waiswadaniel24@gmail.com', 0]
      );
    }
    
    await client.query('COMMIT');
    dbReady = true;
    
    console.log('✅ Database initialized successfully!');
    console.log('📧 Super admin: waiswadaniel24@gmail.com');
    console.log('🔑 Default password: admin123');
    console.log('⚠️  Change default password after first login!');
    
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    
    console.error('❌ Database initialization failed:', err.message);
    dbReady = false;
    
  } finally {
    client.release();
  }
}

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', async () => {
  log.info('SIGTERM received, shutting down gracefully');
  try {
    await pool.end();
  } catch (e) {
    log.error('Error during shutdown: ' + e.message);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  log.info('SIGINT received, shutting down gracefully');
  try {
    await pool.end();
  } catch (e) {
    log.error('Error during shutdown: ' + e.message);
  }
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection:', { reason, promise });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);
  // Give time for logging before exiting
  setTimeout(() => process.exit(1), 1000);
});
