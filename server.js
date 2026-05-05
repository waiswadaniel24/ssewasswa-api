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

const app = express();
const PORT = process.env.PORT || 3000;
let dbReady = false;
const parser = new Parser();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const DEV_COMMISSION = { fee_payment: 0.05, store_purchase: 0.08, marketplace: 0.10, subscription: 0.30, withdrawal_fee: 0.02, live_class: 0.20 };
const SMS_CONFIG = { apiKey: process.env.SMS_API_KEY || 'demo', username: process.env.SMS_USERNAME || 'sandbox', senderId: 'SSEWASSWA' };
const MOMO_CONFIG = { apiKey: process.env.MOMO_API_KEY || 'demo' };
const WHATSAPP_CONFIG = { token: process.env.WHATSAPP_TOKEN || 'demo', phoneId: process.env.WHATSAPP_PHONE_ID || 'demo' };

// ============================================
// DATABASE CONFIGURATION - FIXED
// ============================================
if (!process.env.DATABASE_URL) {
  console.error('❌ FATAL: DATABASE_URL environment variable is NOT set!');
  console.error('Please add DATABASE_URL in Render > Environment');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false,
  connectionTimeoutMillis: 60000,  // 60 seconds
  query_timeout: 60000,
  statement_timeout: 60000,
  max: 5,
  idleTimeoutMillis: 30000,
  allowExitOnIdle: true
});

// Log pool errors
pool.on('error', (err) => {
  console.error('❌ Pool error:', err.message);
});

// Test pool connectivity
pool.on('connect', () => {
  console.log('✅ Pool: New client connected');
});

pool.on('remove', () => {
  console.log('🔄 Pool: Client removed');
});

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware - only initialize if DB is ready
let sessionMiddleware = null;
function setupSession() {
  sessionMiddleware = session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET || 'ssewasswa-' + crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production', 
      httpOnly: true, 
      maxAge: 86400000, 
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' 
    }
  });
  app.use(sessionMiddleware);
}

webpush.setVapidDetails(
  'mailto:waiswadaniel24@gmail.com',
  process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAK1sTsE0ip-4_QtQvxZBG0GZsFhJ8jmJ4MhQxKqYdJm5gA',
  process.env.VAPID_PRIVATE_KEY || 'SUbOaqB2BVzpHaHQW-rqd3N0_2m2Uy8a8gX5LqJ5oUY'
);

// ============================================
// HELPER FUNCTIONS
// ============================================
function esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function isValidPhone(p) { return /^(\+?256|0)[7]\d{8}$/.test((p || '').replace(/\s/g, '')); }
function ah(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

// Sleep helper for retries
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function renderPage(title, content, user, isPublic, lang) {
  user = user || null; isPublic = isPublic || false; lang = lang || 'en';
  let nav = '';
  if (user && !isPublic) {
    nav = '<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:0 0 24px 0;flex-wrap:wrap"><div style="font-weight:700;font-size:18px">' + esc(user.tenant_name || 'SSEWASSWA') + '</div><div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px"><a href="/" style="color:white;text-decoration:none">🏠</a><a href="/app" style="color:white;text-decoration:none">📊</a><a href="/app/students" style="color:white;text-decoration:none">🎓</a><a href="/app/fees" style="color:white;text-decoration:none">💰</a><a href="/app/attendance" style="color:white;text-decoration:none">✅</a><a href="/app/grades" style="color:white;text-decoration:none">📝</a><a href="/app/analytics" style="color:white;text-decoration:none">📈</a><a href="/learning" style="color:white;text-decoration:none">📚</a><a href="/learning/live" style="color:white;text-decoration:none">🎥</a><a href="/store" style="color:white;text-decoration:none">🛒</a><a href="/marketplace" style="color:white;text-decoration:none">🏪</a><a href="/videos" style="color:white;text-decoration:none">🎬</a><a href="/games" style="color:white;text-decoration:none">🎮</a><a href="/news" style="color:white;text-decoration:none">📰</a><a href="/bonus" style="color:white;text-decoration:none">🎁</a><a href="/app/referrals" style="color:white;text-decoration:none">💰</a><a href="/premium" style="color:white;text-decoration:none">⭐</a><a href="/app/settings" style="color:white;text-decoration:none">⚙️</a><a href="/logout" style="color:white;text-decoration:none">🚪</a></div></div>';
  } else if (isPublic) {
    nav = '<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin:0 0 24px 0;flex-wrap:wrap"><div style="font-weight:700;font-size:18px">SSEWASSWA</div><div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px"><a href="/" style="color:white;text-decoration:none">🏠</a><a href="/learning" style="color:white;text-decoration:none">📚</a><a href="/store" style="color:white;text-decoration:none">🛒</a><a href="/marketplace" style="color:white;text-decoration:none">🏪</a><a href="/videos" style="color:white;text-decoration:none">🎬</a><a href="/games" style="color:white;text-decoration:none">🎮</a><a href="/news" style="color:white;text-decoration:none">📰</a><a href="/premium" style="color:white;text-decoration:none">⭐</a><a href="/login" style="color:white;text-decoration:none">👤</a><a href="/demo" style="color:white;text-decoration:none">📞</a></div></div>';
  }
  return '<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#f0f9ff;color:#1e293b;min-height:100vh}.container{max-width:1200px;margin:0 auto;padding:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}.btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600}.btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-orange{background:linear-gradient(135deg,#ea580c,#f97316)}.btn-purple{background:linear-gradient(135deg,#7c3aed,#8b5cf6)}.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b);color:#1e293b}input,select,textarea{width:100%;padding:12px 16px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0 12px;font-size:16px}input:focus{outline:none;border-color:#3b82f6}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px;border-bottom:1px solid #e2e8f0}th{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white}tr:hover{background:#f8fafc}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}.stat-card{background:white;padding:24px;border-radius:16px;border:1px solid #e2e8f0;text-align:center}.stat-num{font-size:36px;font-weight:bold;color:#1e40af}.badge{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block}.badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}.badge-gold{background:#fef3c7;color:#92400e}.badge-blue{background:#dbeafe;color:#1e40af}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.hero{background:linear-gradient(135deg,#1e40af,#3b82f6,#60a5fa);color:white;padding:60px 20px;text-align:center;border-radius:20px;margin-bottom:30px}.hero h1{font-size:48px;margin-bottom:16px}.card-img{width:100%;height:200px;object-fit:cover;border-radius:12px 12px 0 0}@media print{.btn,nav{display:none!important}body{padding:0;background:white}}@media(max-width:768px){.hero h1{font-size:32px}.stats{grid-template-columns:repeat(2,1fr)}}</style></head><body>'+nav+'<main class="container">'+content+'</main><footer style="text-align:center;padding:30px;font-size:12px;color:#64748b;background:white;border-top:1px solid #e2e8f0"><p>&copy; '+new Date().getFullYear()+' SSEWASSWA Platform</p></footer></body></html>';
}

async function checkDb(req, res, next) { 
  if (!dbReady) return res.status(503).send('<div style="text-align:center;padding:100px"><h1>Starting...</h1><p><a href="'+req.url+'">Refresh</a></p></div>'); 
  next(); 
}

const requireAuth = (req, res, next) => { 
  if (!req.session || !req.session.user) return res.redirect('/login'); 
  req.tenant = req.session.tenant; 
  req.tenantId = req.session.tenant ? req.session.tenant.id : null; 
  req.lang = req.query.lang || 'en'; 
  next(); 
};

const requireRole = (role) => (req, res, next) => { 
  if (!req.session || !req.session.user || req.session.user.role !== role) return res.status(403).send('403'); 
  next(); 
};

const requireStaff = (req, res, next) => { 
  if (!req.session || !req.session.user || !['admin','super_admin','teacher'].includes(req.session.user.role)) return res.status(403).send('403'); 
  next(); 
};

const requireAdmin = (req, res, next) => { 
  if (!req.session || !req.session.user || !['admin','super_admin'].includes(req.session.user.role)) return res.status(403).send('403'); 
  next(); 
};

async function sendSMS(phone, msg) { 
  if (SMS_CONFIG.apiKey === 'demo') { console.log('[SMS]', phone, msg); return; } 
  try { 
    await axios.post('https://api.africastalking.com/version1/messaging', 'username='+SMS_CONFIG.username+'&to='+phone+'&message='+encodeURIComponent(msg)+'&from='+SMS_CONFIG.senderId, { headers: { 'apiKey': SMS_CONFIG.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' } }); 
  } catch(e) { console.error('SMS Error:', e.message); } 
}

async function sendWhatsApp(phone, msg) { 
  if (WHATSAPP_CONFIG.token === 'demo') { console.log('[WA]', phone, msg); return; } 
  try { 
    await axios.post('https://graph.facebook.com/v18.0/'+WHATSAPP_CONFIG.phoneId+'/messages', { messaging_product: 'whatsapp', to: phone, text: { body: msg } }, { headers: { 'Authorization': 'Bearer '+WHATSAPP_CONFIG.token } }); 
  } catch(e) { console.error('WA Error:', e.message); } 
}

async function addBonus(userId, tenantId, amount, type, desc, meta) { 
  meta = meta || {}; 
  try { 
    await pool.query('INSERT INTO bonus_earnings (user_id,tenant_id,amount,type,description,metadata) VALUES ($1,$2,$3,$4,$5,$6)', [userId,tenantId,amount,type,desc,JSON.stringify(meta)]); 
    await pool.query('UPDATE wallets SET balance=balance+$1,updated_at=NOW() WHERE user_email=$2', [amount,userId]); 
  } catch(e) { console.error('Bonus error:', e.message); } 
}

async function addDevCommission(amount, type, desc, ref) { 
  try { 
    await pool.query('INSERT INTO developer_revenue (amount,type,description,reference_id) VALUES ($1,$2,$3,$4)', [amount,type,desc,ref]); 
    await pool.query('UPDATE platform_wallet SET balance=balance+$1,updated_at=NOW() WHERE id=1', [amount]); 
  } catch(e) { console.error('Comm error:', e.message); } 
}

async function sendPushToUser(email, title, body) { 
  try { 
    const subs = await pool.query('SELECT endpoint,keys FROM push_subscriptions WHERE user_email=$1', [email]); 
    for (const sub of subs.rows) { 
      try { await webpush.sendNotification({endpoint:sub.endpoint,keys:sub.keys}, JSON.stringify({title,body})); } catch(e) {} 
    } 
  } catch(e) {} 
}

// ============================================
// ROUTES
// ============================================
app.get('/api/vapid-public-key', (req, res) => { 
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI0DLLuxazjqAK1sTsE0ip-4_QtQvxZBG0GZsFhJ8jmJ4MhQxKqYdJm5gA' }); 
});

app.post('/api/subscribe', requireAuth, checkDb, ah(async (req, res) => {
  if (!req.body || !req.body.endpoint) return res.status(400).json({error:'Missing'});
  await pool.query('INSERT INTO push_subscriptions (user_email,endpoint,keys) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.session.user.email, req.body.endpoint, JSON.stringify(req.body.keys)]);
  res.json({success:true});
}));

app.get('/app/referrals', requireAuth, checkDb, ah(async (req, res) => {
  const stats = await pool.query("SELECT r.referred_email,r.signup_date,u.full_name,u.role,t.name as school,COALESCE(SUM(b.amount),0) as earned FROM referral_stats r LEFT JOIN users u ON r.referred_email=u.email LEFT JOIN tenants t ON u.tenant_id=t.id LEFT JOIN bonus_earnings b ON b.description LIKE 'Referred '||r.referred_email||'%' AND b.user_id=$1 GROUP BY r.referred_email,r.signup_date,u.full_name,u.role,t.name ORDER BY r.signup_date DESC", [req.session.user.email]);
  const total = stats.rows.reduce((s,r) => s+parseFloat(r.earned||0), 0);
  const link = 'https://'+req.headers.host+'/signup?ref='+encodeURIComponent(req.session.user.email);
  const rows = stats.rows.map(r => '<tr><td>'+esc(r.full_name||r.referred_email)+'</td><td>'+esc(r.school||'-')+'</td><td>'+new Date(r.signup_date).toLocaleDateString()+'</td><td class="badge badge-green">+UGX '+r.earned+'</td></tr>').join('');
  res.send(renderPage('Referrals', '<div class="hero" style="padding:30px"><h1>Referrals</h1><div class="stat-num" style="color:white;-webkit-text-fill-color:white">UGX '+total.toLocaleString()+'</div></div><div class="card"><input value="'+esc(link)+'" readonly id="refLink"><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById(\'refLink\').value)">Copy</button></div><div class="card"><table><thead><tr><th>Name</th><th>School</th><th>Date</th><th>Earned</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4">None yet</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/api/check-teacher-milestone', requireAuth, checkDb, ah(async (req, res) => {
  if (req.session.user.role !== 'teacher') return res.json({ok:false});
  const cnt = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [req.tenantId])).rows[0].count;
  const paid = (await pool.query("SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='teacher_milestone'", [req.session.user.email])).rows[0];
  if (cnt >= 10 && !paid) {
    await addBonus(req.session.user.email, req.tenantId, 5000, 'teacher_milestone', 'Added 10+ students');
    await sendPushToUser(req.session.user.email, '🎉 Bonus!', 'UGX 5,000 earned!');
    const ref = (await pool.query('SELECT referrer_email FROM referral_stats WHERE referred_email=$1', [req.session.user.email])).rows[0];
    if (ref && ref.referrer_email) await addBonus(ref.referrer_email, req.tenantId, 2000, 'referral_bonus', 'Referral hit 10 students');
    return res.json({bonus:5000});
  }
  res.json({ok:true});
}));

app.get('/', ah(async (req, res) => {
  let news = '';
  try {
    const f = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml');
    news = f.items.slice(0,4).map(i => '<div class="card"><h4>'+esc(i.title)+'</h4><a href="/bonus/claim/news?url='+encodeURIComponent(i.link)+'" class="btn btn-orange" style="font-size:12px" target="_blank">Read +20</a></div>').join('');
  } catch(e) {}
  res.send(renderPage('SSEWASSWA', '<div class="hero"><h1>Learn - Shop - Play - Earn</h1><div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/signup" class="btn btn-green" style="font-size:18px;padding:16px 32px">Get Started</a><a href="/demo" class="btn btn-gold" style="font-size:18px;padding:16px 32px">📞 Book Demo</a></div></div><div class="stats"><div class="stat-card"><div class="stat-num">50K+</div><div>Users</div></div><div class="stat-card"><div class="stat-num">500+</div><div>Schools</div></div><div class="stat-card"><div class="stat-num">10M+</div><div>Rewards</div></div></div><div class="grid"><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/learning\'"><div style="font-size:48px">📚</div><h3>Learning</h3></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/store\'"><div style="font-size:48px">🛒</div><h3>Store</h3></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/marketplace\'"><div style="font-size:48px">🏪</div><h3>Marketplace</h3></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/videos\'"><div style="font-size:48px">🎬</div><h3>Videos</h3></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/games\'"><div style="font-size:48px">🎮</div><h3>Games</h3></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href=\'/learning/live\'"><div style="font-size:48px">🎥</div><h3>Live Classes</h3></div></div><div class="card"><h2>Latest News</h2><div class="grid">'+news+'</div></div>', null, true));
}));

app.get('/login', (req, res) => {
  res.send(renderPage('Login', '<div class="card" style="max-width:450px;margin:40px auto"><div style="text-align:center;margin-bottom:24px"><div style="font-size:60px">🎓</div><h1>Welcome Back</h1></div><form method="POST" action="/login"><input name="email" placeholder="Email" type="email" required><input name="password" placeholder="Password" type="password" required><button type="submit" class="btn" style="width:100%;font-size:18px;padding:16px">Login</button></form><div style="text-align:center;margin-top:20px"><a href="/signup" style="color:#1e40af">Create Account</a> - <a href="/forgot-password" style="color:#64748b">Forgot?</a></div></div>', null, true));
});

app.post('/login', checkDb, ah(async (req, res) => {
  const user = await pool.query('SELECT u.*,t.subdomain,t.name as tenant_name,t.plan FROM users u JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1 AND u.approved=true', [req.body.email]);
  if (!user.rows[0] || !(await bcrypt.compare(req.body.password, user.rows[0].password_hash))) {
    return res.status(401).send(renderPage('Failed', '<div class="card" style="text-align:center"><h1>Invalid Credentials</h1><a href="/login" class="btn">Try Again</a></div>', null, true));
  }
  req.session.user = user.rows[0];
  req.session.tenant = {id:user.rows[0].tenant_id,subdomain:user.rows[0].subdomain,name:user.rows[0].tenant_name,plan:user.rows[0].plan};
  res.redirect(user.rows[0].role === 'super_admin' ? '/super-admin' : '/app');
}));

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

app.get('/signup', (req, res) => {
  const ref = req.query.ref;
  res.send(renderPage('Signup', '<div class="card" style="max-width:500px;margin:40px auto"><div style="text-align:center;margin-bottom:24px"><h1>Join SSEWASSWA</h1><p class="badge badge-green">+100 UGX Bonus!</p></div><form method="POST" action="/signup">'+(ref?'<input type="hidden" name="ref" value="'+esc(ref)+'">':'')+'<input name="full_name" placeholder="Full Name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone (07XX)" required><input name="password" type="password" placeholder="Password" required minlength="6"><select name="role"><option value="student">Student</option><option value="parent">Parent</option><option value="teacher">Teacher (need code)</option></select><input name="school_code" placeholder="School Code (teachers only)"><button type="submit" class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Create Account</button></form></div>', null, true));
});

app.post('/signup', checkDb, ah(async (req, res) => {
  try {
    let tid = 1;
    if (req.body.role==='teacher' && req.body.school_code) {
      const t = await pool.query('SELECT id FROM tenants WHERE signup_code=$1 OR subdomain=$1', [req.body.school_code.toLowerCase()]);
      if (!t.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid School Code</h1></div>', null, true));
      tid = t.rows[0].id;
    }
    await pool.query('INSERT INTO users (tenant_id,email,password_hash,role,full_name,phone,approved) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tid,req.body.email,await bcrypt.hash(req.body.password,10),req.body.role,req.body.full_name,req.body.phone,true]);
    await pool.query('INSERT INTO wallets (tenant_id,user_email,balance) VALUES ($1,$2,0)', [tid,req.body.email]);
    await addBonus(req.body.email,tid,100,'signup','Welcome bonus');
    if (req.body.ref) {
      await addBonus(req.body.ref,tid,200,'referral','Referred '+req.body.email);
      await pool.query('INSERT INTO referral_stats (referrer_email,referred_email) VALUES ($1,$2)', [req.body.ref,req.body.email]);
    }
    res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>Welcome! +100 UGX</h1><a href="/login" class="btn btn-green">Login Now</a></div>', null, true));
  } catch(e) { res.send(renderPage('Error', '<div class="card"><h1>Email exists</h1></div>', null, true)); }
}));

app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Reset', '<div class="card" style="max-width:450px;margin:40px auto"><h1>Forgot Password</h1><form method="POST" action="/forgot-password"><input name="email" type="email" required><button class="btn" style="width:100%">Send Link</button></form></div>', null, true));
});

app.post('/forgot-password', checkDb, ah(async (req, res) => {
  const u = await pool.query('SELECT id FROM users WHERE email=$1', [req.body.email]);
  if (u.rows[0]) {
    const token = crypto.randomBytes(20).toString('hex');
    await pool.query('INSERT INTO password_resets (email,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'1 hour\')', [req.body.email,token]);
    console.log('RESET: https://'+req.headers.host+'/reset-password/'+token);
  }
  res.send(renderPage('Sent', '<div class="card" style="text-align:center"><h1>Check Email</h1></div>', null, true));
}));

app.get('/reset-password/:token', checkDb, ah(async (req, res) => {
  const r = await pool.query('SELECT * FROM password_resets WHERE token=$1 AND expires_at>NOW() AND used=false', [req.params.token]);
  if (!r.rows[0]) return res.send(renderPage('Expired', '<div class="card"><h1>Invalid Link</h1></div>', null, true));
  res.send(renderPage('Reset', '<div class="card" style="max-width:450px;margin:40px auto"><form method="POST" action="/reset-password/'+req.params.token+'"><input name="password" type="password" required><button class="btn btn-green" style="width:100%">Reset</button></form></div>', null, true));
}));

app.post('/reset-password/:token', checkDb, ah(async (req, res) => {
  const r = await pool.query('SELECT * FROM password_resets WHERE token=$1 AND expires_at>NOW() AND used=false', [req.params.token]);
  if (!r.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid</h1></div>', null, true));
  await pool.query('UPDATE users SET password_hash=$1 WHERE email=$2', [await bcrypt.hash(req.body.password,10),r.rows[0].email]);
  await pool.query('UPDATE password_resets SET used=true WHERE id=$1', [r.rows[0].id]);
  res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>Reset!</h1><a href="/login" class="btn">Login</a></div>', null, true));
}));

app.get('/parent/login', (req, res) => {
  res.send(renderPage('Parent Login', '<div class="card" style="max-width:450px;margin:40px auto"><h1>Parent Portal</h1><form method="POST" action="/parent/send-otp"><input name="phone" placeholder="07XX" required><button type="submit" class="btn" style="width:100%">Send OTP</button></form></div>', null, true));
});

app.post('/parent/send-otp', checkDb, ah(async (req, res) => {
  const otp = Math.floor(100000+Math.random()*900000).toString();
  await pool.query('INSERT INTO parent_otps (phone,otp,expires_at) VALUES ($1,$2,NOW()+INTERVAL \'10 minutes\')', [req.body.phone,otp]);
  await sendSMS(req.body.phone, 'SSEWASSWA OTP: '+otp);
  res.send(renderPage('Verify', '<div class="card" style="max-width:450px;margin:40px auto"><form method="POST" action="/parent/verify-otp"><input type="hidden" name="phone" value="'+esc(req.body.phone)+'"><input name="otp" placeholder="6-digit OTP" required><button type="submit" class="btn" style="width:100%">Verify</button></form></div>', null, true));
}));

app.post('/parent/verify-otp', checkDb, ah(async (req, res) => {
  const r = await pool.query("SELECT * FROM parent_otps WHERE phone=$1 AND otp=$2 AND expires_at>NOW() AND used=false LIMIT 1", [req.body.phone,req.body.otp]);
  if (!r.rows[0]) return res.send(renderPage('Error', '<div class="card"><h1>Invalid OTP</h1></div>', null, true));
  await pool.query('UPDATE parent_otps SET used=true WHERE id=$1', [r.rows[0].id]);
  let p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
  if (!p.rows[0]) {
    await pool.query('INSERT INTO parents (phone,verified,tenant_id) VALUES ($1,true,1)', [req.body.phone]);
    p = await pool.query('SELECT * FROM parents WHERE phone=$1', [req.body.phone]);
  }
  req.session.parent = p.rows[0];
  res.redirect('/parent/dashboard');
}));

app.get('/parent/dashboard', checkDb, ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const s = await pool.query('SELECT * FROM students WHERE parent_id=$1 OR guardian_phone=$2', [req.session.parent.id,req.session.parent.phone]);
  const c = s.rows.map(x => '<div class="card"><h3>'+esc(x.name)+'</h3><p>Class: '+esc(x.class||'N/A')+'</p><p>Balance: <strong class="badge badge-red">UGX '+x.balance+'</strong></p><div style="margin-top:12px"><a href="/parent/pay/'+x.id+'" class="btn btn-green">Pay</a><a href="/app/students/report/'+x.id+'" class="btn" target="_blank">Report</a></div></div>').join('');
  res.send(renderPage('My Children', '<div class="hero" style="padding:30px"><h1>My Children</h1></div>'+(c||'<div class="card"><p>No students linked</p></div>'), null, true));
}));

app.get('/parent/pay/:id', checkDb, ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Pay', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Pay for '+esc(s.name)+'</h1><p class="stat-num" style="font-size:24px">UGX '+s.balance+'</p><form method="POST" action="/parent/pay"><input type="hidden" name="student_id" value="'+s.id+'"><input name="amount" type="number" required><input name="phone" value="'+esc(req.session.parent.phone)+'" required><button class="btn btn-green" style="width:100%;font-size:18px;padding:16px">Pay MoMo</button></form></div>', null, true));
}));

app.post('/parent/pay', checkDb, ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const ref = 'FEE-'+Date.now();
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.body.student_id])).rows[0];
  await pool.query('INSERT INTO payment_requests (tenant_id,student_id,amount,phone,reference) VALUES ($1,$2,$3,$4,$5)', [s.tenant_id,req.body.student_id,req.body.amount,req.body.phone,ref]);
  await addDevCommission(Math.round(req.body.amount*DEV_COMMISSION.fee_payment),'fee_payment','Fee',ref);
  if (MOMO_CONFIG.apiKey==='demo') {
    await pool.query('UPDATE students SET balance=balance-$1 WHERE id=$2', [req.body.amount,req.body.student_id]);
    await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success',ref]);
    return res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>Payment Received!</h1><a href="/parent/dashboard" class="btn">Back</a></div>', null, true));
  }
  res.send(renderPage('Processing', '<div class="card" style="text-align:center"><h1>Check Phone</h1></div>', null, true));
}));

app.get('/parent/logout', (req, res) => { req.session.destroy(() => res.redirect('/parent/login')); });

app.get('/bonus', requireAuth, checkDb, ah(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0]||{balance:0};
  const e = await pool.query('SELECT * FROM bonus_earnings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15', [req.session.user.email]);
  const rows = e.rows.map(x => '<tr><td>'+new Date(x.created_at).toLocaleDateString()+'</td><td><span class="badge badge-blue">'+esc(x.type)+'</span></td><td class="badge badge-green">+UGX '+x.amount+'</td></tr>').join('');
  res.send(renderPage('Rewards', '<div class="hero" style="padding:40px 20px"><h2>My Wallet</h2><div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">UGX '+w.balance+'</div><div style="display:flex;gap:12px;justify-content:center;margin-top:20px"><a href="/bonus/withdraw" class="btn btn-green">Withdraw</a><a href="/bonus/affiliate" class="btn btn-purple">Affiliate</a></div></div><div class="grid"><div class="stat-card" onclick="location.href=\'/videos\'" style="cursor:pointer"><div style="font-size:36px">🎬</div><div>Videos +50</div></div><div class="stat-card" onclick="location.href=\'/news\'" style="cursor:pointer"><div style="font-size:36px">📰</div><div>News +20</div></div><div class="stat-card" onclick="location.href=\'/downloads\'" style="cursor:pointer"><div style="font-size:36px">📥</div><div>Downloads +100</div></div><div class="stat-card" onclick="location.href=\'/games\'" style="cursor:pointer"><div style="font-size:36px">🎮</div><div>Games +30</div></div></div><div class="card"><h3>Recent</h3><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th></tr></thead><tbody>'+(rows||'<tr><td colspan="3">None yet</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/bonus/withdraw', requireAuth, checkDb, ah(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0]||{balance:0};
  res.send(renderPage('Withdraw', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Withdraw</h1><div style="background:#f8fafc;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px"><div style="color:#64748b">Available</div><div class="stat-num">UGX '+w.balance+'</div></div><form method="POST" action="/bonus/withdraw"><input name="amount" type="number" max="'+w.balance+'" min="5000" placeholder="Min 5,000" required><input name="phone" placeholder="MoMo (07XX)" required><p style="font-size:12px;color:#64748b">Fee: 2%</p><button class="btn btn-green" style="width:100%">Withdraw</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/bonus/withdraw', requireAuth, checkDb, ah(async (req, res) => {
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0];
  if (!w||w.balance<req.body.amount||req.body.amount<5000) return res.send(renderPage('Error', '<div class="card"><h1>Invalid Amount</h1></div>'));
  const fee = Math.round(req.body.amount*DEV_COMMISSION.withdrawal_fee);
  await pool.query('UPDATE wallets SET balance=balance-$1 WHERE user_email=$2', [req.body.amount,req.session.user.email]);
  await pool.query('INSERT INTO withdrawals (user_email,amount,phone,fee,net_amount,status) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.email,req.body.amount,req.body.phone,fee,req.body.amount-fee,'pending']);
  await addDevCommission(fee,'withdrawal_fee','Fee');
  res.send(renderPage('Submitted', '<div class="card" style="text-align:center"><h1>Queued!</h1><a href="/bonus" class="btn">Back</a></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/bonus/affiliate', requireAuth, checkDb, (req, res) => {
  const link = 'https://'+req.headers.host+'/signup?ref='+encodeURIComponent(req.session.user.email);
  res.send(renderPage('Affiliate', '<div class="card" style="max-width:600px;margin:40px auto"><h1>Earn 200 UGX Per Referral</h1><div style="background:#f8fafc;padding:16px;border-radius:12px;margin:20px 0"><input value="'+esc(link)+'" readonly style="margin:0" id="affLink"><button class="btn" style="margin-top:8px" onclick="navigator.clipboard.writeText(document.getElementById(\'affLink\').value)">Copy</button></div></div>', {tenant_name:req.tenant.name}, false, req.lang));
});

app.get('/videos', (req, res) => {
  res.send(renderPage('Videos', '<div class="hero" style="padding:30px"><h1>Watch & Earn</h1></div><div class="grid"><div class="card" style="padding:0;overflow:hidden"><iframe width="100%" height="200" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe><div style="padding:16px"><h4>Math Basics</h4><a href="/bonus/claim/video/dQw4w9WgXcQ" class="btn btn-green">Claim +50</a></div></div></div>', null, true));
});

app.get('/bonus/claim/video/:id', requireAuth, checkDb, ah(async (req, res) => {
  if (!(await pool.query("SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='video' AND video_id=$2", [req.session.user.email,req.params.id])).rows[0]) await addBonus(req.session.user.email,req.tenantId,50,'video','Watched video',{video_id:req.params.id});
  res.redirect('/videos');
}));

app.get('/news', ah(async (req, res) => {
  try {
    const f = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml');
    const c = f.items.slice(0,8).map(i => '<div class="card"><h4>'+esc(i.title)+'</h4><a href="/bonus/claim/news?url='+encodeURIComponent(i.link)+'" class="btn btn-orange" target="_blank">Read +20</a></div>').join('');
    res.send(renderPage('News', '<div class="hero" style="padding:30px"><h1>News</h1></div><div class="grid">'+c+'</div>', null, true));
  } catch(e) { res.send(renderPage('News', '<div class="card"><h1>Unavailable</h1></div>', null, true)); }
}));

app.get('/bonus/claim/news', requireAuth, checkDb, ah(async (req, res) => {
  await addBonus(req.session.user.email,req.tenantId,20,'news','Read article');
  res.redirect(req.query.url||'/news');
}));

app.get('/downloads', (req, res) => {
  res.send(renderPage('Downloads', '<div class="hero" style="padding:30px"><h1>Downloads</h1></div><div class="grid"><div class="card" style="display:flex;gap:16px;align-items:center"><div style="font-size:48px">📚</div><div style="flex:1"><h4>Khan Academy</h4></div><a href="/bonus/claim/download?url='+encodeURIComponent('https://play.google.com/store/apps/details?id=org.khanacademy.android')+'&name=Khan" class="btn btn-green">+100</a></div></div>', null, true));
});

app.get('/bonus/claim/download', requireAuth, checkDb, ah(async (req, res) => {
  await addBonus(req.session.user.email,req.tenantId,100,'download','Downloaded '+(req.query.name||'App'));
  res.redirect(req.query.url||'/downloads');
}));

app.get('/games', (req, res) => {
  res.send(renderPage('Games', '<div class="hero" style="padding:30px"><h1>Games</h1></div><div class="grid"><div class="card" style="text-align:center"><div style="font-size:64px">🧮</div><h3>Math Quiz</h3><div class="badge badge-gold">+30 UGX</div>'+(req.session.user?'<a href="/games/play/quiz" class="btn btn-green" style="margin-top:12px">Play</a>':'')+'</div></div>', null, true));
});

app.get('/games/play/:id', requireAuth, checkDb, (req, res) => {
  res.send(renderPage('Quiz', '<div class="card" style="max-width:600px;margin:40px auto"><h1>Math Quiz</h1><div id="qa" style="text-align:center;margin:20px 0"><div style="font-size:36px" id="q"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px"><button class="btn" onclick="ck(this)" id="a1"></button><button class="btn" onclick="ck(this)" id="a2"></button><button class="btn" onclick="ck(this)" id="a3"></button><button class="btn" onclick="ck(this)" id="a4"></button></div></div><div id="r" style="display:none;text-align:center"><h2>Done!</h2><p class="badge badge-green" style="font-size:18px">+30 UGX</p><a href="/games" class="btn" style="margin-top:20px">Back</a></div></div><script>let qs=[],i=0;for(let j=0;j<5;j++){let a=Math.floor(Math.random()*20)+1,b=Math.floor(Math.random()*20)+1,o=["+","-","×"][Math.floor(Math.random()*3)],ans=o==="+"?a+b:o==="-"?a-b:a*b;qs.push({q:a+" "+o+" "+b+" = ?",ans});}function sq(){if(i>=5){document.getElementById("qa").style.display="none";document.getElementById("r").style.display="block";fetch("/bonus/claim/game/quiz").catch(()=>{});return;}let c=qs[i];document.getElementById("q").textContent=c.q;let opts=[c.ans];while(opts.length<4){let w=c.ans+Math.floor(Math.random()*20)-10;if(!opts.includes(w))opts.push(w);}opts.sort(()=>Math.random()-0.5);for(let j=1;j<=4;j++){document.getElementById("a"+j).textContent=opts[j-1];document.getElementById("a"+j).dataset.a=opts[j-1];}}function ck(b){i++;sq();}sq();</script>', {tenant_name:req.tenant.name}, false, req.lang));
});

app.get('/bonus/claim/game/:id', requireAuth, checkDb, ah(async (req, res) => {
  if (!(await pool.query("SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='game' AND metadata->>'game_id'=$2 AND created_at>NOW()-INTERVAL '1 hour'", [req.session.user.email,req.params.id])).rows[0]) await addBonus(req.session.user.email,req.tenantId,30,'game','Played '+req.params.id,{game_id:req.params.id});
  res.json({ok:true});
}));

app.get('/learning', (req, res) => {
  res.send(renderPage('Learning', '<div class="hero" style="padding:30px"><h1>Learn Anything</h1></div><div class="grid"><div class="card" style="text-align:center"><div style="font-size:48px">🔢</div><h3>Mathematics</h3></div><div class="card" style="text-align:center"><div style="font-size:48px">🔬</div><h3>Science</h3></div><div class="card" style="text-align:center"><div style="font-size:48px">📖</div><h3>English</h3></div></div>', null, true));
});

app.get('/premium', (req, res) => {
  res.send(renderPage('Premium', '<div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:40px 20px"><h1>Go Premium</h1><div class="stat-num" style="font-size:48px;color:white;-webkit-text-fill-color:white">15,000 UGX/mo</div></div><div class="card" style="text-align:center;margin-top:20px">'+(req.session.user?'<form method="POST" action="/premium/subscribe" style="max-width:400px;margin:0 auto"><input name="phone" placeholder="MoMo" required><button class="btn btn-gold" style="width:100%;font-size:18px;padding:16px">Subscribe</button></form>':'<a href="/login" class="btn btn-gold" style="font-size:18px;padding:16px 32px">Login</a>')+'</div>', null, true));
});

app.post('/premium/subscribe', requireAuth, checkDb, ah(async (req, res) => {
  const ref = 'PREM-'+Date.now();
  await pool.query('INSERT INTO payment_requests (tenant_id,user_id,amount,phone,reference,status) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId,req.session.user.email,15000,req.body.phone,ref,'pending']);
  await addDevCommission(Math.round(15000*DEV_COMMISSION.subscription),'subscription','Premium',ref);
  if (MOMO_CONFIG.apiKey==='demo') {
    await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2', ['success',ref]);
    await pool.query("UPDATE users SET premium_until=NOW()+INTERVAL '1 month' WHERE email=$1", [req.session.user.email]);
    return res.send(renderPage('Active', '<div class="card" style="text-align:center"><h1>Premium Active!</h1></div>', null, true));
  }
  res.send(renderPage('Processing', '<div class="card" style="text-align:center"><h1>Check Phone</h1></div>', null, true));
}));

app.get('/store', (req, res) => {
  res.send(renderPage('Store', '<div class="hero" style="padding:30px"><h1>School Store</h1></div><div class="grid"><div class="card" style="padding:0;overflow:hidden"><img src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=200&fit=crop" class="card-img"><div style="padding:16px"><h4>Uniform</h4><div class="stat-num" style="font-size:24px">UGX 45,000</div><a href="/store/buy/1" class="btn btn-green" style="width:100%;margin-top:12px">Buy</a></div></div></div>', null, true));
});

app.get('/store/buy/:id', (req, res) => {
  res.send(renderPage('Buy', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Buy Uniform</h1><p class="stat-num" style="font-size:24px">UGX 45,000</p><form method="POST" action="/store/buy/1"><input name="phone" placeholder="MoMo" required><input name="name" placeholder="Name" required><button class="btn btn-green" style="width:100%">Pay</button></form></div>', null, true));
});

app.post('/store/buy/:id', checkDb, ah(async (req, res) => {
  const ref = 'STORE-'+Date.now();
  await pool.query('INSERT INTO store_orders (product_id,product_name,amount,buyer_phone,buyer_name,reference,status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [1,'Uniform',45000,req.body.phone,req.body.name,ref,'pending']);
  await addDevCommission(Math.round(45000*DEV_COMMISSION.store_purchase),'store_purchase','Store',ref);
  res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>Order Placed!</h1></div>', null, true));
}));

app.get('/marketplace', ah(async (req, res) => {
  const {rows} = await pool.query('SELECT p.*,t.name as school_name FROM marketplace_products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=true ORDER BY p.id DESC LIMIT 20');
  const c = rows.map(p => '<div class="card" style="padding:0;overflow:hidden"><img src="'+esc(p.image_url||'https://via.placeholder.com/200')+'" class="card-img"><div style="padding:16px"><span class="badge badge-blue">By '+esc(p.school_name)+'</span><h4>'+esc(p.name)+'</h4><div class="stat-num" style="font-size:24px;margin:12px 0">UGX '+p.price+'</div><a href="/marketplace/buy/'+p.id+'" class="btn btn-green" style="width:100%">Buy</a></div></div>').join('');
  res.send(renderPage('Marketplace', '<div class="hero" style="padding:30px"><h1>Marketplace</h1>'+(req.session.user&&(req.session.user.role==='admin'||req.session.user.role==='super_admin')?'<a href="/marketplace/sell" class="btn btn-purple" style="margin-top:12px">Sell</a>':'')+'</div><div class="grid">'+(c||'<div class="card"><p>No products</p></div>')+'</div>', null, true));
}));

app.get('/marketplace/sell', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Sell', '<div class="card" style="max-width:500px"><h1>List Product</h1><p style="color:#64748b">10% commission</p><form method="POST" action="/marketplace/sell"><input name="name" placeholder="Name" required><input name="price" type="number" placeholder="Price UGX" required><input name="image_url" placeholder="Image URL"><textarea name="description" placeholder="Description" rows="3"></textarea><button class="btn btn-green" style="width:100%">Submit</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
});

app.post('/marketplace/sell', requireAuth, requireAdmin, checkDb, ah(async (req, res) => {
  await pool.query('INSERT INTO marketplace_products (tenant_id,name,price,image_url,description,approved) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId,req.body.name,req.body.price,req.body.image_url,req.body.description,false]);
  res.send(renderPage('Submitted', '<div class="card" style="text-align:center"><h1>Submitted!</h1><a href="/marketplace" class="btn">View</a></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/marketplace/buy/:id', ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  res.send(renderPage('Buy', '<div class="card" style="max-width:500px;margin:40px auto"><h1>Buy '+esc(p.name)+'</h1><p class="stat-num" style="font-size:24px">UGX '+p.price+'</p><form method="POST" action="/marketplace/buy/'+p.id+'"><input name="phone" placeholder="MoMo" required><button class="btn btn-green" style="width:100%">Pay</button></form></div>', null, true));
}));

app.post('/marketplace/buy/:id', checkDb, ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM marketplace_products WHERE id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  const ref = 'MKT-'+Date.now();
  await pool.query('INSERT INTO payment_requests (tenant_id,amount,phone,reference,status) VALUES ($1,$2,$3,$4,$5)', [p.tenant_id,p.price,req.body.phone,ref,'pending']);
  await addDevCommission(Math.round(p.price*DEV_COMMISSION.marketplace),'marketplace','Market: '+p.name,ref);
  res.send(renderPage('Success', '<div class="card" style="text-align:center"><h1>Prompt Sent!</h1></div>', null, true));
}));

app.get('/app', requireAuth, checkDb, ah(async (req, res) => {
  const s = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id=$1', [req.tenantId]);
  const f = await pool.query('SELECT COALESCE(SUM(paid),0)::numeric AS t FROM fees WHERE tenant_id=$1', [req.tenantId]);
  const a = await pool.query("SELECT COUNT(*)::int AS c FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status='present'", [req.tenantId]);
  const w = (await pool.query('SELECT balance FROM wallets WHERE user_email=$1', [req.session.user.email])).rows[0]||{balance:0};
  res.send(renderPage('Dashboard', '<div class="stats"><div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎓</div><div>Students</div><div class="stat-num">'+s.rows[0].c+'</div></div><div class="stat-card"><div style="font-size:24px;margin-bottom:8px">💰</div><div>Fees</div><div class="stat-num">UGX '+f.rows[0].t+'</div></div><div class="stat-card"><div style="font-size:24px;margin-bottom:8px">✅</div><div>Present</div><div class="stat-num">'+a.rows[0].c+'</div></div><div class="stat-card"><div style="font-size:24px;margin-bottom:8px">🎁</div><div>Rewards</div><div class="stat-num">UGX '+w.balance+'</div></div></div><div class="card"><h1>Quick Actions</h1><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"><a href="/app/students/add" class="btn btn-green">Add Student</a><a href="/app/fees/add" class="btn">Record Fee</a><a href="/app/attendance/mark" class="btn">Attendance</a><a href="/app/grades/add" class="btn">Grades</a><a href="/bonus" class="btn btn-purple">Rewards</a></div></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/fees', requireAuth, checkDb, ah(async (req, res) => {
  const {rows} = await pool.query('SELECT f.*,s.name as sn FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.id DESC LIMIT 50', [req.tenantId]);
  const t = rows.map(f => '<tr><td>'+esc(f.sn)+'</td><td>UGX '+f.amount+'</td><td>UGX '+f.paid+'</td><td>UGX '+(f.amount-f.paid)+'</td><td>'+esc(f.term||'-')+'</td><td>'+esc(f.payment_method||'-')+'</td></tr>').join('');
  res.send(renderPage('Fees', '<div class="card"><h1>Fees</h1><a href="/app/fees/add" class="btn btn-green">Record</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Due</th><th>Paid</th><th>Balance</th><th>Term</th><th>Method</th></tr></thead><tbody>'+(t||'<tr><td colspan="6">None</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/fees/add', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const s = await pool.query('SELECT id,name FROM students WHERE tenant_id=$1', [req.tenantId]);
  const opts = s.rows.map(x => '<option value="'+x.id+'"'+(req.query.student_id==x.id?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  res.send(renderPage('Record Fee', '<div class="card" style="max-width:500px"><h1>Record Fee</h1><form method="POST" action="/app/fees/add"><select name="student_id" required><option value="">Select</option>'+opts+'</select><input name="amount" type="number" required><input name="paid" type="number" required><input name="term"><select name="payment_method"><option>Cash</option><option>MoMo</option><option>Bank</option></select><button class="btn btn-green" style="width:100%">Save</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/fees/add', requireStaff, checkDb, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.body.student_id])).rows[0];
  await pool.query('INSERT INTO fees (tenant_id,student_id,amount,paid,term,year,payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.tenantId,req.body.student_id,req.body.amount,req.body.paid,req.body.term,new Date().getFullYear(),req.body.payment_method]);
  await pool.query('UPDATE students SET balance=balance-$1 WHERE id=$2', [req.body.paid,req.body.student_id]);
  await addDevCommission(Math.round(req.body.paid*DEV_COMMISSION.fee_payment),'fee_payment','Fee: '+s.name,'FEE-'+Date.now());
  if (s.guardian_phone) await sendSMS(s.guardian_phone, 'Payment UGX '+req.body.paid+' received for '+s.name);
  res.redirect('/app/fees');
}));

app.get('/app/attendance', requireAuth, checkDb, ah(async (req, res) => {
  const {rows} = await pool.query("SELECT a.*,s.name FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date=CURRENT_DATE", [req.tenantId]);
  const t = rows.map(a => '<tr><td>'+esc(a.name)+'</td><td><span class="badge '+(a.status==='present'?'badge-green':'badge-red')+'">'+a.status+'</span></td></tr>').join('');
  res.send(renderPage('Attendance', '<div class="card"><h1>Today</h1><a href="/app/attendance/mark" class="btn btn-green">Mark</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>'+(t||'<tr><td colspan="2">None</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/attendance/mark', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const s = await pool.query('SELECT id,name FROM students WHERE tenant_id=$1', [req.tenantId]);
  const cbs = s.rows.map(x => '<label style="display:block;margin:8px 0"><input type="checkbox" name="p_'+x.id+'" checked> '+esc(x.name)+'</label>').join('');
  res.send(renderPage('Mark', '<div class="card" style="max-width:500px"><h1>Mark Attendance</h1><form method="POST" action="/app/attendance/mark">'+cbs+'<button class="btn btn-green" style="width:100%;margin-top:16px">Save</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/attendance/mark', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const s = await pool.query('SELECT id FROM students WHERE tenant_id=$1', [req.tenantId]);
  await pool.query("DELETE FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE", [req.tenantId]);
  for (const x of s.rows) await pool.query('INSERT INTO attendance (tenant_id,student_id,date,status) VALUES ($1,$2,CURRENT_DATE,$3)', [req.tenantId,x.id,req.body['p_'+x.id]?'present':'absent']);
  res.redirect('/app/attendance');
}));

app.get('/app/grades', requireAuth, checkDb, ah(async (req, res) => {
  const {rows} = await pool.query('SELECT g.*,s.name as sn FROM grades g JOIN students s ON g.student_id=s.id WHERE g.tenant_id=$1 ORDER BY g.id DESC LIMIT 50', [req.tenantId]);
  const t = rows.map(g => '<tr><td>'+esc(g.sn)+'</td><td>'+esc(g.subject)+'</td><td>'+g.score+'</td><td>'+esc(g.term||'-')+'</td></tr>').join('');
  res.send(renderPage('Grades', '<div class="card"><h1>Grades</h1><a href="/app/grades/add" class="btn btn-green">Add</a><table style="margin-top:16px"><thead><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th></tr></thead><tbody>'+(t||'<tr><td colspan="4">None</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/grades/add', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const s = await pool.query('SELECT id,name FROM students WHERE tenant_id=$1', [req.tenantId]);
  const opts = s.rows.map(x => '<option value="'+x.id+'">'+esc(x.name)+'</option>').join('');
  res.send(renderPage('Add Grade', '<div class="card" style="max-width:500px"><h1>Add Grade</h1><form method="POST" action="/app/grades/add"><select name="student_id" required><option value="">Select</option>'+opts+'</select><input name="subject" required><input name="score" type="number" required><input name="term"><button class="btn btn-green" style="width:100%">Save</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/grades/add', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  await pool.query('INSERT INTO grades (tenant_id,student_id,subject,score,term,year) VALUES ($1,$2,$3,$4,$5,$6)', [req.tenantId,req.body.student_id,req.body.subject,req.body.score,req.body.term,new Date().getFullYear()]);
  res.redirect('/app/grades');
}));

app.get('/app/settings', requireAuth, requireAdmin, checkDb, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM settings WHERE tenant_id=$1', [req.tenantId])).rows[0]||{};
  const t = (await pool.query('SELECT signup_code FROM tenants WHERE id=$1', [req.tenantId])).rows[0]||{};
  res.send(renderPage('Settings', '<div class="card" style="max-width:500px"><h1>Settings</h1><form method="POST" action="/app/settings"><input name="school_motto" value="'+esc(s.school_motto)+'" placeholder="Motto"><textarea name="about_text" rows="4">'+esc(s.about_text)+'</textarea><input name="contact_email" value="'+esc(s.contact_email)+'"><input name="whatsapp_number" value="'+esc(s.whatsapp_number)+'"><input name="signup_code" value="'+esc(t.signup_code||'')+'" placeholder="Teacher Code"><button class="btn btn-green" style="width:100%">Save</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/settings', requireAuth, requireAdmin, checkDb, ah(async (req, res) => {
  await pool.query('UPDATE settings SET school_motto=$1,about_text=$2,contact_email=$3,whatsapp_number=$4 WHERE tenant_id=$5', [req.body.school_motto,req.body.about_text,req.body.contact_email,req.body.whatsapp_number,req.tenantId]);
  await pool.query('UPDATE tenants SET signup_code=$1 WHERE id=$2', [req.body.signup_code?req.body.signup_code.toUpperCase():null,req.tenantId]);
  res.redirect('/app/settings');
}));

app.get('/app/students', requireAuth, checkDb, ah(async (req, res) => {
  const {rows} = await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY id DESC', [req.tenantId]);
  const t = rows.map(s => '<tr><td>'+esc(s.name)+'</td><td>'+esc(s.class||'-')+'</td><td>'+esc(s.guardian_phone||'-')+'</td><td>UGX '+s.balance+'</td><td><a href="/app/students/report/'+s.id+'" class="btn" style="font-size:12px;padding:8px">Report</a> <a href="/app/fees/add?student_id='+s.id+'" class="btn" style="font-size:12px;padding:8px">Pay</a> <a href="/app/students/edit/'+s.id+'" class="btn btn-orange" style="font-size:12px;padding:8px">Edit</a> <a href="/app/students/delete/'+s.id+'" class="btn btn-red" style="font-size:12px;padding:8px" onclick="return confirm(\'Delete?\')">Del</a></td></tr>').join('');
  res.send(renderPage('Students', '<div class="card"><h1>Students</h1><div style="display:flex;gap:8px;margin-bottom:16px"><a href="/app/students/add" class="btn btn-green">Add</a><a href="/app/students/bulk" class="btn btn-purple">Bulk</a><a href="/app/students/export" class="btn btn-orange">Export</a></div><table style="margin-top:16px"><thead><tr><th>Name</th><th>Class</th><th>Phone</th><th>Balance</th><th>Action</th></tr></thead><tbody>'+(t||'<tr><td colspan="5">None</td></tr>')+'</tbody></table></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/students/add', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Add', '<div class="card" style="max-width:500px"><h1>Add Student</h1><form method="POST" action="/app/students/add"><input name="name" required><input name="class"><input name="guardian_name"><input name="guardian_phone"><button class="btn btn-green" style="width:100%">Save</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/students/add', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  await pool.query('INSERT INTO students (tenant_id,name,class,guardian_name,guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId,req.body.name,req.body.class,req.body.guardian_name,req.body.guardian_phone]);
  if (req.body.guardian_phone) await sendSMS(req.body.guardian_phone, req.body.name+' registered. Track: https://'+req.headers.host+'/parent/login');
  if (req.session.user.role==='teacher') {
    try { const cnt = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [req.tenantId])).rows[0].count; const paid = (await pool.query("SELECT id FROM bonus_earnings WHERE user_id=$1 AND type='teacher_milestone'", [req.session.user.email])).rows[0]; if (cnt>=10&&!paid) await addBonus(req.session.user.email,req.tenantId,5000,'teacher_milestone','Added 10+ students'); } catch(e){}
  }
  res.redirect('/app/students');
}));

app.get('/app/students/edit/:id', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id,req.tenantId])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit', '<div class="card" style="max-width:500px"><h1>Edit '+esc(s.name)+'</h1><form method="POST" action="/app/students/edit/'+s.id+'"><input name="name" value="'+esc(s.name)+'" required><input name="class" value="'+esc(s.class)+'"><input name="guardian_name" value="'+esc(s.guardian_name)+'"><input name="guardian_phone" value="'+esc(s.guardian_phone)+'"><button class="btn btn-green" style="width:100%">Update</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/app/students/edit/:id', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  await pool.query('UPDATE students SET name=$1,class=$2,guardian_name=$3,guardian_phone=$4 WHERE id=$5 AND tenant_id=$6', [req.body.name,req.body.class,req.body.guardian_name,req.body.guardian_phone,req.params.id,req.tenantId]);
  res.redirect('/app/students');
}));

app.get('/app/students/delete/:id', requireAuth, requireAdmin, checkDb, ah(async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id,req.tenantId]);
  res.redirect('/app/students');
}));

app.get('/app/students/report/:id', requireAuth, checkDb, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id,req.tenantId])).rows[0];
  if (!s) return res.status(404).send('Not found');
  const g = await pool.query('SELECT * FROM grades WHERE student_id=$1 ORDER BY year DESC', [req.params.id]);
  const f = await pool.query('SELECT * FROM fees WHERE student_id=$1 ORDER BY year DESC', [req.params.id]);
  const a = await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p,COUNT(*) as t FROM attendance WHERE student_id=$1", [req.params.id]);
  const pct = a.rows[0].t>0?Math.round((a.rows[0].p/a.rows[0].t)*100):0;
  res.send(renderPage('Report', '<div class="card" style="text-align:center"><h1>'+esc(req.tenant.name)+'</h1><h2>REPORT CARD</h2><p><strong>Name:</strong> '+esc(s.name)+' | <strong>Class:</strong> '+esc(s.class||'N/A')+' | <strong>Balance:</strong> UGX '+s.balance+'</p><p><strong>Attendance:</strong> '+pct+'% ('+a.rows[0].p+'/'+a.rows[0].t+')</p></div><div class="card"><h3>Academics</h3><table><thead><tr><th>Subject</th><th>Score</th><th>Term</th><th>Year</th></tr></thead><tbody>'+(g.rows.map(x => '<tr><td>'+esc(x.subject)+'</td><td>'+x.score+'</td><td>'+esc(x.term||'-')+'</td><td>'+(x.year||'-')+'</td></tr>').join('')||'<tr><td colspan="4">No grades</td></tr>')+'</tbody></table></div><div class="card"><h3>Fees</h3><table><thead><tr><th>Term</th><th>Due</th><th>Paid</th><th>Balance</th></tr></thead><tbody>'+(f.rows.map(x => '<tr><td>'+esc(x.term||'-')+' '+(x.year||'')+'</td><td>'+x.amount+'</td><td>'+x.paid+'</td><td>'+(x.amount-x.paid)+'</td></tr>').join('')||'<tr><td colspan="4">No fees</td></tr>')+'</tbody></table></div><div class="card" style="text-align:center"><button onclick="window.print()" class="btn btn-green">Print</button></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/students/bulk', requireAuth, requireAdmin, (req, res) => {
  res.send(renderPage('Bulk', '<div class="card" style="max-width:600px"><h1>Bulk Upload</h1><p style="color:#64748b;margin-bottom:16px">CSV: name,class,guardian_name,guardian_phone</p><form method="POST" action="/app/students/bulk" enctype="multipart/form-data"><input type="file" name="csv" accept=".csv" required style="padding:20px;border:2px dashed #cbd5e1;background:#f8fafc"><button class="btn btn-green" style="width:100%">Upload</button></form><a href="/app/students/template.csv" class="btn btn-orange">Template</a></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/students/template.csv', (req, res) => {
  res.header('Content-Type','text/csv').attachment('template.csv').send('name,class,guardian_name,guardian_phone\nJohn,P.4,Jane,0772123456\n');
});

app.post('/app/students/bulk', requireAuth, requireAdmin, upload.single('csv'), checkDb, ah(async (req, res) => {
  const results = [];
  await new Promise((resolve,reject) => { Readable.from(req.file.buffer.toString()).pipe(csv()).on('data',d=>results.push(d)).on('end',resolve).on('error',reject); });
  let added = 0;
  for (const row of results) { if (row.name) { await pool.query('INSERT INTO students (tenant_id,name,class,guardian_name,guardian_phone) VALUES ($1,$2,$3,$4,$5)', [req.tenantId,row.name,row.class,row.guardian_name,row.guardian_phone]); added++; } }
  res.send(renderPage('Done', '<div class="card" style="text-align:center"><h1>Imported '+added+'!</h1><a href="/app/students" class="btn">View</a></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/app/students/export', requireAuth, checkDb, ah(async (req, res) => {
  const {rows} = await pool.query('SELECT name,class,guardian_name,guardian_phone,balance FROM students WHERE tenant_id=$1 ORDER BY name', [req.tenantId]);
  res.header('Content-Type','text/csv').attachment('students.csv').send('name,class,guardian_name,guardian_phone,balance\n'+rows.map(r=>'"'+r.name+'","'+(r.class||'')+'","'+(r.guardian_name||'')+'","'+(r.guardian_phone||'')+'",'+r.balance).join('\n'));
}));

app.get('/learning/live', requireAuth, checkDb, ah(async (req, res) => {
  const c = await pool.query("SELECT l.*,u.full_name as teacher_name,(SELECT COUNT(*) FROM class_payments WHERE class_id=l.id AND status='success') as students FROM live_classes l JOIN users u ON l.teacher_email=u.email WHERE l.tenant_id=$1 AND l.status='scheduled' AND l.scheduled_at>NOW() ORDER BY l.scheduled_at", [req.tenantId]);
  res.send(renderPage('Live Classes', '<div class="hero" style="padding:30px"><h1>Live Classes</h1>'+(['teacher','admin','super_admin'].includes(req.session.user.role)?'<a href="/learning/live/create" class="btn btn-green" style="margin-top:12px">Create</a>':'')+'</div><div class="grid">'+(c.rows.map(cl => '<div class="card"><div class="badge badge-blue" style="margin-bottom:8px">'+new Date(cl.scheduled_at).toLocaleDateString()+'</div><h3>'+esc(cl.title)+'</h3><p>'+esc(cl.subject)+' - '+esc(cl.class)+'</p><p>👨‍🏫 '+esc(cl.teacher_name)+' | 👥 '+cl.students+'</p><div class="stat-num" style="font-size:20px;margin:12px 0">UGX '+cl.price+'</div><a href="/learning/live/join/'+cl.id+'" class="btn btn-green" style="width:100%">Join</a></div>').join('')||'<div class="card"><p>No classes</p></div>')+'</div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.get('/learning/live/create', requireAuth, requireStaff, (req, res) => {
  res.send(renderPage('Create Class', '<div class="card" style="max-width:600px"><h1>Create Live Class</h1><p style="color:#64748b">You earn 80%</p><form method="POST" action="/learning/live/create"><input name="title" placeholder="Title" required><input name="subject" placeholder="Subject" required><input name="class" placeholder="Class" required><input name="price" type="number" value="1000" min="500" required><input name="scheduled_at" type="datetime-local" required><button class="btn btn-green" style="width:100%">Create</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
});

app.post('/learning/live/create', requireAuth, requireStaff, checkDb, ah(async (req, res) => {
  const room = 'ssewasswa-'+uuidv4().substring(0,8);
  await pool.query('INSERT INTO live_classes (tenant_id,teacher_email,subject,class,title,jitsi_room,price,scheduled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [req.tenantId,req.session.user.email,req.body.subject,req.body.class,req.body.title,room,req.body.price,req.body.scheduled_at]);
  res.redirect('/learning/live');
}));

app.get('/learning/live/join/:id', requireAuth, checkDb, ah(async (req, res) => {
  const cl = (await pool.query('SELECT * FROM live_classes WHERE id=$1', [req.params.id])).rows[0];
  if (!cl) return res.status(404).send('Not found');
  const paid = await pool.query("SELECT id FROM class_payments WHERE class_id=$1 AND student_email=$2 AND status='success'", [cl.id,req.session.user.email]);
  if (!paid.rows[0]&&cl.teacher_email!==req.session.user.email&&cl.price>0) {
    return res.send(renderPage('Pay', '<div class="card" style="max-width:500px;margin:40px auto;text-align:center"><h1>'+esc(cl.title)+'</h1><div class="stat-num" style="margin:20px 0">UGX '+cl.price+'</div><form method="POST" action="/learning/live/pay/'+cl.id+'"><input name="phone" placeholder="MoMo" required><button class="btn btn-green" style="width:100%">Pay & Join</button></form></div>', {tenant_name:req.tenant.name}, false, req.lang));
  }
  res.send(renderPage(cl.title, '<div class="card" style="padding:0;overflow:hidden"><div style="background:#1e293b;color:white;padding:16px"><h2>'+esc(cl.title)+'</h2></div><iframe src="https://meet.jit.si/'+cl.jitsi_room+'" style="width:100%;height:600px;border:0" allow="camera;microphone;fullscreen"></iframe></div>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/learning/live/pay/:id', requireAuth, checkDb, ah(async (req, res) => {
  const cl = (await pool.query('SELECT * FROM live_classes WHERE id=$1', [req.params.id])).rows[0];
  if (!cl) return res.status(404).send('Not found');
  const ref = 'CLASS-'+Date.now();
  const comm = Math.round(cl.price*DEV_COMMISSION.live_class);
  await pool.query('INSERT INTO class_payments (class_id,student_email,amount,phone,reference,status) VALUES ($1,$2,$3,$4,$5,$6)', [cl.id,req.session.user.email,cl.price,req.body.phone,ref,'pending']);
  await addDevCommission(comm,'live_class','Live: '+cl.title,ref);
  await addBonus(cl.teacher_email,cl.tenantId,cl.price-comm,'teaching','Taught: '+cl.title);
  if (MOMO_CONFIG.apiKey==='demo') {
    await pool.query('UPDATE class_payments SET status=$1 WHERE reference=$2', ['success',ref]);
    return res.redirect('/learning/live/join/'+cl.id);
  }
  res.send(renderPage('Processing', '<div class="card" style="text-align:center"><h1>Check Phone</h1></div>', null, true));
}));

app.get('/app/analytics', requireAuth, requireAdmin, checkDb, ah(async (req, res) => {
  const fd = await pool.query("SELECT DATE_TRUNC('month',created_at) as month,SUM(paid) as total FROM fees WHERE tenant_id=$1 AND created_at>NOW()-INTERVAL '6 months' GROUP BY month ORDER BY month", [req.tenantId]);
  const ad = await pool.query("SELECT s.class,COUNT(*) FILTER (WHERE status='present') as present,COUNT(*) as total FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 AND a.date>NOW()-INTERVAL '30 days' GROUP BY s.class", [req.tenantId]);
  const top = await pool.query("SELECT s.name,s.class,AVG(g.score) as avg FROM students s JOIN grades g ON s.id=g.student_id WHERE s.tenant_id=$1 GROUP BY s.id,s.name,s.class HAVING COUNT(g.id)>0 ORDER BY avg DESC LIMIT 10", [req.tenantId]);
  const ar = ad.rows.map(r=>{const p=r.total>0?Math.round((r.present/r.total)*100):0;return '<tr><td>'+esc(r.class||'N/A')+'</td><td>'+r.present+'/'+r.total+'</td><td style="width:40%"><div style="background:#e2e8f0;border-radius:20px;height:24px"><div style="background:'+(p>75?'#16a34a':p>50?'#f59e0b':'#dc2626')+';width:'+p+'%;height:100%;border-radius:20px"></div></div></td></tr>';}).join('');
  res.send(renderPage('Analytics', '<div class="hero" style="padding:30px"><h1>Analytics</h1></div><div class="grid"><div class="card"><h3>Fees (6mo)</h3><canvas id="fc"></canvas></div><div class="card"><h3>Attendance</h3><table><thead><tr><th>Class</th><th>Rate</th></tr></thead><tbody>'+ar+'</tbody></table></div></div><div class="card"><h3>Top Students</h3><table><thead><tr><th>#</th><th>Name</th><th>Class</th><th>Avg</th></tr></thead><tbody>'+top.rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.class)+'</td><td class="badge badge-gold">'+Math.round(r.avg)+'</td></tr>').join('')+'</tbody></table></div><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><script>new Chart(document.getElementById("fc"),{type:"line",data:{labels:'+JSON.stringify(fd.rows.map(r=>new Date(r.month).toLocaleDateString('en-US',{month:'short'})))+',datasets:[{label:"UGX",data:'+JSON.stringify(fd.rows.map(r=>r.total))+',borderColor:"#3b82f6",tension:0.4}]})</script>', {tenant_name:req.tenant.name}, false, req.lang));
}));

app.post('/webhook/whatsapp', checkDb, ah(async (req, res) => {
  const msg = req.body&&req.body.entry&&req.body.entry[0]&&req.body.entry[0].changes&&req.body.entry[0].changes[0]&&req.body.entry[0].changes[0].value&&req.body.entry[0].changes[0].value.messages&&req.body.entry[0].changes[0].value.messages[0];
  if (!msg) return res.sendStatus(200);
  const from = msg.from;
  const text = msg.text?msg.text.body.toLowerCase():'';
  let reply = "SSEWASSWA Bot\nBALANCE [name]\nATTENDANCE [name]\nHELP";
  if (text.includes('balance')){const m=text.match(/balance\s+(.+)/);if(m){const s=await pool.query("SELECT name,balance FROM students WHERE LOWER(name) LIKE $1 LIMIT 1",['%'+m[1].trim()+'%']);if(s.rows[0])reply="💰 "+s.rows[0].name+"\nBalance: UGX "+s.rows[0].balance;else reply="❌ Not found";}}
  else if(text.includes('attendance')){const m=text.match(/attendance\s+(.+)/);if(m){const s=await pool.query("SELECT id,name FROM students WHERE LOWER(name) LIKE $1 LIMIT 1",['%'+m[1].trim()+'%']);if(s.rows[0]){const a=await pool.query("SELECT COUNT(*) FILTER (WHERE status='present') as p,COUNT(*) as t FROM attendance WHERE student_id=$1 AND date>NOW()-INTERVAL '30 days'",[s.rows[0].id]);reply="✅ "+s.rows[0].name+"\n"+Math.round((a.rows[0].p/a.rows[0].t)*100)+"%";}}}
  else if(text==='help')reply="Commands:\nBALANCE John\nATTENDANCE Mary\nHELP";
  await sendWhatsApp(from,reply);
  res.sendStatus(200);
}));

app.get('/api/cron/daily', ah(async (req, res) => {
  const secret = process.env.CRON_SECRET||'ssewasswa-cron-2024';
  if(req.headers['x-cron-secret']!==secret&&req.query.secret!==secret) return res.status(403).json({error:'Unauthorized'});
  const w = (await pool.query('SELECT balance,developer_momo FROM platform_wallet WHERE id=1')).rows[0];
  let payout = 0;
  if(w.balance>=50000){
    payout=Math.floor(w.balance*0.95);
    await pool.query('UPDATE platform_wallet SET balance=balance-$1 WHERE id=1',[payout]);
    await pool.query('INSERT INTO withdrawals (user_email,amount,fee,net_amount,phone,status) VALUES ($1,$2,$3,$4,$5,$6)',['DEV_PAYOUT',payout,0,payout,w.developer_momo||'0789736737','auto_pending']);
  }
  await pool.query("DELETE FROM session WHERE expire<NOW()-INTERVAL '7 days'");
  res.json({ok:true,payout,balance:w.balance});
}));

app.get('/demo', (req, res) => {
  res.send(renderPage('Book Demo', '<div class="hero" style="padding:40px 20px"><h1>📞 Free Demo</h1><p>5 min setup.</p></div><div class="card" style="max-width:600px;margin:0 auto"><form method="POST" action="/demo"><input name="school_name" placeholder="School Name" required><input name="headteacher_name" placeholder="Headteacher" required><input name="phone" placeholder="WhatsApp 07XX" required><input name="students" type="number" placeholder="Students" required><button class="btn btn-green" style="width:100%;font-size:18px">Book Demo</button></form></div>', null, true));
});

app.post('/demo', checkDb, ah(async (req, res) => {
  const sub = req.body.school_name.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0,15);
  const code = sub.toUpperCase().substring(0,8)+Math.floor(Math.random()*100);
  try {
    const t = await pool.query('INSERT INTO tenants (name,subdomain,plan,momo_number,signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.body.school_name.trim(),sub,'free',req.body.phone,code]);
    await pool.query('INSERT INTO settings (tenant_id,signup_code) VALUES ($1,$2)', [t.rows[0].id,code]);
    await sendWhatsApp(req.body.phone, '✅ '+req.body.school_name+' is LIVE!\nTeacher Code: *'+code+'*\nLink: https://'+req.headers.host+'/school/'+sub);
    await sendWhatsApp('0789736737', '🔥 NEW: '+req.body.school_name+'\nStudents: '+req.body.students+'\nCode: '+code);
    res.send(renderPage('Success', '<div class="card" style="text-align:center"><div style="font-size:60px">🎉</div><h1>'+esc(req.body.school_name)+' is Live!</h1><p>Code: <strong class="badge badge-gold" style="font-size:24px">'+code+'</strong></p><a href="/demo" class="btn btn-green" style="margin-top:20px">Add Another</a></div>', null, true));
  } catch(e) { if(e.code==='23505') return res.send(renderPage('Error', '<div class="card"><h1>Name taken</h1></div>', null, true)); throw e; }
}));

app.get('/super-admin', requireAuth, requireRole('super_admin'), checkDb, ah(async (req, res) => {
  const r30=(await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'")).rows[0].t;
  const rt=(await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue')).rows[0].t;
  const p=(await pool.query("SELECT COUNT(*) as c,COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status='pending'")).rows[0];
  const sc=(await pool.query('SELECT COUNT(*) as c FROM tenants')).rows[0].c;
  const u=(await pool.query('SELECT COUNT(*) as c FROM users')).rows[0].c;
  const w=(await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0].balance;
  res.send(renderPage('Super Admin', '<div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:30px"><h1>👑 Platform Control</h1></div><div class="stats"><div class="stat-card"><div class="stat-num">UGX '+r30.toLocaleString()+'</div><div>30 Days</div></div><div class="stat-card"><div class="stat-num">UGX '+rt.toLocaleString()+'</div><div>Total</div></div><div class="stat-card"><div class="stat-num">UGX '+w.toLocaleString()+'</div><div>Wallet</div></div><div class="stat-card"><div class="stat-num">'+p.c+'</div><div>Pending ('+Number(p.t).toLocaleString()+')</div></div><div class="stat-card"><div class="stat-num">'+sc+'</div><div>Schools</div></div><div class="stat-card"><div class="stat-num">'+u+'</div><div>Users</div></div></div><div class="grid"><div class="card"><h3>Actions</h3><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px"><a href="/demo" class="btn btn-green">Create School</a><a href="/super-admin/broadcast" class="btn btn-purple">Broadcast</a><a href="/super-admin/payout-developer" class="btn btn-red">Payout</a></div></div><div class="card"><h3>Auto-Payout</h3><p>Wallet ≥ UGX 50,000 → Auto-pays 95% daily</p><p>Cron: GET /api/cron/daily?secret=ssewasswa-cron-2024</p></div></div>', {tenant_name:req.tenant.name}));
}));

app.get('/super-admin/payout-developer', requireAuth, requireRole('super_admin'), checkDb, ah(async (req, res) => {
  const w=(await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0].balance;
  if(w<1000) return res.redirect('/super-admin');
  await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
  await pool.query('INSERT INTO withdrawals (user_email,amount,fee,net_amount,phone,status) VALUES ($1,$2,$3,$4,$5,$6)',['DEV_MANUAL',w,0,w,'0789736737','paid']);
  res.redirect('/super-admin');
}));

app.get('/super-admin/broadcast', requireAuth, requireRole('super_admin'), (req, res) => {
  res.send(renderPage('Broadcast', '<div class="card" style="max-width:600px"><h1>📢 Broadcast</h1><form method="POST" action="/super-admin/broadcast"><select name="target"><option value="all">All</option><option value="teachers">Teachers</option><option value="admins">Admins</option></select><textarea name="message" placeholder="Message" rows="4" required></textarea><button class="btn btn-green" style="width:100%">Send</button></form></div>', {tenant_name:req.tenant.name}));
});

app.post('/super-admin/broadcast', requireAuth, requireRole('super_admin'), checkDb, ah(async (req, res) => {
  let q='SELECT DISTINCT phone FROM users WHERE phone IS NOT NULL AND phone!=\'\'';
  if(req.body.target==='teachers')q+=' AND role=\'teacher\'';
  if(req.body.target==='admins')q+=' AND role IN (\'admin\',\'super_admin\')';
  const {rows}=await pool.query(q);
  let sent=0;
  for(const r of rows){await sendWhatsApp(r.phone,req.body.message);await new Promise(res=>setTimeout(res,1000));sent++;}
  res.send(renderPage('Sent', '<div class="card"><h1>✅ Sent to '+sent+'</h1><a href="/super-admin" class="btn">Back</a></div>', {tenant_name:req.tenant.name}));
}));

app.get('/school/:sub', checkDb, ah(async (req, res) => {
  const t=(await pool.query('SELECT t.*,s.school_motto,s.about_text FROM tenants t LEFT JOIN settings s ON t.id=s.tenant_id WHERE t.subdomain=$1',[req.params.sub])).rows[0];
  if(!t) return res.status(404).send('Not found');
  const st=await pool.query('SELECT COUNT(*) as students FROM students WHERE tenant_id=$1',[t.id]);
  res.send(renderPage(t.name, '<div class="hero" style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:60px 20px"><h1>'+esc(t.name)+'</h1><p style="font-size:20px">'+esc(t.school_motto||'Excellence')+'</p><div style="display:flex;gap:12px;justify-content:center;margin-top:20px"><a href="/parent/login" class="btn btn-green">Parent Portal</a><a href="/login" class="btn">Staff Login</a></div></div><div class="stats"><div class="stat-card"><div class="stat-num">'+st.rows[0].students+'</div><div>Students</div></div></div><div class="card"><h2>About</h2><p>'+esc(t.about_text||'Welcome.')+'</p></div><div class="card" style="text-align:center"><h3>Join Us</h3><p>Code: <strong class="badge badge-gold">'+esc(t.signup_code||'Contact admin')+'</strong></p><a href="/signup" class="btn btn-green">Apply</a></div>', null, true));
}));

app.get('/sitemap.xml', checkDb, ah(async (req, res) => {
  const s=await pool.query("SELECT subdomain FROM tenants WHERE plan!='suspended'");
  res.header('Content-Type','application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://'+req.headers.host+'/</loc></url>'+s.rows.map(x=>'<url><loc>https://'+req.headers.host+'/school/'+x.subdomain+'</loc></url>').join('')+'</urlset>');
}));

app.get('/debug-login', checkDb, ah(async (req, res) => {
  const email = 'waiswadaniel24@gmail.com';
  let output = '<div class="card" style="max-width:600px;margin:40px auto"><h1>Login Diagnostics</h1>';
  try {
    const result = await pool.query('SELECT 1 as ok');
    output += '<p class="badge badge-green">Database connected ✅</p>';
  } catch(e) {
    output += '<p class="badge badge-red">Database error: ' + esc(e.message) + '</p>';
  }
  try {
    const user = await pool.query('SELECT email, password_hash, role, approved FROM users WHERE email=$1', [email]);
    output += '<p>User exists: ' + (user.rows.length > 0 ? 'YES ✅' : 'NO ❌') + '</p>';
    if (user.rows.length > 0) {
      output += '<p>Role: ' + user.rows[0].role + '</p>';
      output += '<p>Approved: ' + user.rows[0].approved + '</p>';
      const match = await bcrypt.compare('admin123', user.rows[0].password_hash);
      output += '<p>Password "admin123" matches: ' + (match ? 'YES ✅' : 'NO ❌') + '</p>';
    }
  } catch(e) {
    output += '<p class="badge badge-red">Error: ' + esc(e.message) + '</p>';
  }
  res.send(renderPage('Debug', output, null, true));
}));

app.post('/create-site', checkDb, ah(async (req, res) => {
  try {
    const t=await pool.query('INSERT INTO tenants (name,subdomain,plan,momo_number,signup_code) VALUES ($1,$2,$3,$4,$5) RETURNING id',[req.body.name.trim(),req.body.subdomain.toLowerCase().trim(),'free',req.body.momo_number,req.body.signup_code.toUpperCase()]);
    await pool.query('INSERT INTO users (tenant_id,email,password_hash,role,approved,full_name) VALUES ($1,$2,$3,$4,$5,$6)',[t.rows[0].id,req.body.admin_email,await bcrypt.hash(req.body.admin_password,10),'admin',true,req.body.name+' Admin']);
    await pool.query('INSERT INTO settings (tenant_id,signup_code) VALUES ($1,$2)',[t.rows[0].id,req.body.signup_code.toUpperCase()]);
    await pool.query('INSERT INTO wallets (tenant_id,user_email,balance) VALUES ($1,$2,0)',[t.rows[0].id,req.body.admin_email]);
    res.send(renderPage('Success','<div class="card" style="text-align:center"><h1>✅ Created!</h1><p>Code: '+esc(req.body.signup_code.toUpperCase())+'</p><a href="/login" class="btn">Login</a></div>',null,true));
  } catch(e) { if(e.code==='23505') return res.send(renderPage('Error','<div class="card"><h1>Taken</h1></div>',null,true)); throw e; }
}));

app.get('/health', (req, res) => { res.json({ok:true,db:dbReady,timestamp:new Date().toISOString()}); });

app.post('/api/momo/webhook', ah(async (req, res) => {
  const {reference,status}=req.body||{};
  if(!reference||!status) return res.status(400).json({error:'Missing'});
  if(status==='SUCCESSFUL'){
    const p=await pool.query('SELECT * FROM payment_requests WHERE reference=$1',[reference]);
    if(p.rows[0]&&p.rows[0].status!=='success'){
      await pool.query('UPDATE payment_requests SET status=$1 WHERE reference=$2',['success',reference]);
      if(p.rows[0].student_id) await pool.query('UPDATE students SET balance=balance-$1 WHERE id=$2',[p.rows[0].amount,p.rows[0].student_id]);
      if(p.rows[0].user_id&&reference.startsWith('PREM')) await pool.query("UPDATE users SET premium_until=NOW()+INTERVAL '1 month' WHERE email=$1",[p.rows[0].user_id]);
      if(reference.startsWith('CLASS')) await pool.query('UPDATE class_payments SET status=$1 WHERE reference=$2',['success',reference]);
    }
  }
  res.json({ok:true});
}));

app.use((req, res) => { res.status(404).send(renderPage('404', '<div class="card" style="text-align:center"><div style="font-size:64px;margin-bottom:16px">🔍</div><h1>404 Not Found</h1><a href="/" class="btn">Go Home</a></div>', null, true)); });
app.use((err, req, res, next) => { console.error('Error:', err.message); res.status(500).send(renderPage('Error', '<div class="card"><h1>Error</h1><p>Please try again.</p></div>', null, true)); });

// ============================================
// DATABASE INITIALIZATION - FULLY FIXED
// ============================================
async function initDB() {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 5000; // 5 seconds between retries
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let client = null;
    
    try {
      console.log(`🔄 Connecting to database (attempt ${attempt}/${MAX_RETRIES})...`);
      
      // Check if DATABASE_URL exists
      if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is not set!');
        return false;
      }
      
      // Mask the URL for logging (hide password)
      const maskedUrl = process.env.DATABASE_URL.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
      console.log('📡 URL:', maskedUrl);
      
      // Try to connect
      client = await pool.connect();
      
      if (!client) {
        throw new Error('pool.connect() returned null');
      }
      
      console.log('✅ Connected! Creating tables...');
      
      // Start transaction
      await client.query('BEGIN');
      
      // Create all tables
      await client.query('CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid"))');
      await client.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")');
      await client.query('CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT \'free\'');
      await client.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS momo_number TEXT');
      await client.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_code TEXT');
      await client.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT \'staff\', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, full_name TEXT, phone TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP');
      await client.query('CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS site_name TEXT DEFAULT \'SSEWASSWA\'');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT \'#1e40af\'');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT \'waiswadaniel24@gmail.com\'');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS whatsapp_number TEXT DEFAULT \'0789736737\'');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT \'free\'');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS school_motto TEXT');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS about_text TEXT');
      await client.query('ALTER TABLE settings ADD COLUMN IF NOT EXISTS signup_code TEXT');
      await client.query('CREATE TABLE IF NOT EXISTS parents (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('ALTER TABLE parents ADD COLUMN IF NOT EXISTS referred_by TEXT');
      await client.query('CREATE TABLE IF NOT EXISTS parent_otps (id SERIAL PRIMARY KEY, phone TEXT NOT NULL, otp TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, guardian_name TEXT, guardian_phone TEXT, parent_id INTEGER REFERENCES parents(id), balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, payment_method TEXT, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS payment_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), student_id INTEGER REFERENCES students(id), user_id TEXT, amount NUMERIC NOT NULL, phone TEXT NOT NULL, reference TEXT UNIQUE, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL UNIQUE, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())');
      await client.query('ALTER TABLE platform_wallet ADD COLUMN IF NOT EXISTS developer_momo TEXT DEFAULT \'0789736737\'');
      await client.query('CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, reference_id TEXT, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS bonus_earnings (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, type TEXT NOT NULL, description TEXT, metadata JSONB, video_id TEXT, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS referral_stats (id SERIAL PRIMARY KEY, referrer_email TEXT NOT NULL, referred_email TEXT NOT NULL, signup_date TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, endpoint TEXT NOT NULL, keys JSONB NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS store_orders (id SERIAL PRIMARY KEY, product_id INTEGER, product_name TEXT, amount NUMERIC NOT NULL, buyer_phone TEXT, buyer_name TEXT, reference TEXT UNIQUE, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS marketplace_products (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, price NUMERIC NOT NULL, image_url TEXT, description TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS live_classes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, teacher_email TEXT NOT NULL, subject TEXT, class TEXT, title TEXT NOT NULL, jitsi_room TEXT UNIQUE NOT NULL, price NUMERIC DEFAULT 0, status TEXT DEFAULT \'scheduled\', scheduled_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS class_payments (id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES live_classes(id) ON DELETE CASCADE, student_email TEXT NOT NULL, amount NUMERIC NOT NULL, phone TEXT, reference TEXT UNIQUE, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, amount NUMERIC NOT NULL, phone TEXT, fee NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS viral_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER, type TEXT NOT NULL, reward_amount NUMERIC NOT NULL, target_action TEXT NOT NULL, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())');
      await client.query('CREATE TABLE IF NOT EXISTS viral_shares (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, platform TEXT NOT NULL, link_shared TEXT NOT NULL, clicks INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
      
      // Insert default platform wallet
      await client.query('INSERT INTO platform_wallet (id,balance) VALUES (1,0) ON CONFLICT DO NOTHING');
      
      // Create default tenant
      const tenant = await client.query('INSERT INTO tenants (name,subdomain,plan,momo_number,signup_code) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subdomain) DO NOTHING RETURNING id', ['SSEWASSWA FOUNDATION UGANDA','main','enterprise','0789736737','SSEWASSWA2024']);
      
      if (tenant.rows.length > 0) {
        const tid = tenant.rows[0].id;
        const hash = await bcrypt.hash('admin123', 10);
        await client.query('INSERT INTO users (tenant_id,email,password_hash,role,approved,full_name,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [tid,'waiswadaniel24@gmail.com',hash,'super_admin',true,'Daniel Waiswa','0789736737']);
        await client.query('INSERT INTO settings (tenant_id,subscription_tier,verified,school_motto,about_text,signup_code) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [tid,'enterprise',true,'Excellence in Education','Digital tools for schools.','SSEWASSWA2024']);
        await client.query('INSERT INTO wallets (tenant_id,user_email,balance) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [tid,'waiswadaniel24@gmail.com',0]);
        console.log('✅ Default tenant created');
      }
      
      // Commit transaction
      await client.query('COMMIT');
      
      console.log('✅ All tables created successfully!');
      return true;
      
    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);
      
      // Rollback if we started a transaction
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch(rollbackErr) {
          console.error('Rollback error:', rollbackErr.message);
        }
      }
      
      // If this is the last attempt, give up
      if (attempt === MAX_RETRIES) {
        console.error('❌ All database connection attempts failed');
        console.error('💡 Make sure DATABASE_URL is set correctly in Render Environment');
        return false;
      }
      
      // Wait before retrying
      console.log(`⏳ Waiting ${RETRY_DELAY_MS/1000} seconds before retry...`);
      await sleep(RETRY_DELAY_MS);
      
    } finally {
      // Always release the client if we got one
      if (client) {
        try {
          client.release();
        } catch(e) {
          // Ignore release errors
        }
      }
    }
  }
  
  return false;
}

// ============================================
// START SERVER - FIXED
// ============================================
async function start() {
  console.log('='.repeat(50));
  console.log('Starting SSEWASSWA Platform...');
  console.log('='.repeat(50));
  console.log('Node version:', process.version);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('PORT:', PORT);
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  
  if (process.env.DATABASE_URL) {
    console.log('\n📋 Initializing database...');
    dbReady = await initDB();
    
    if (dbReady) {
      console.log('\n✅ Database ready!');
      // Setup session middleware after DB is ready
      setupSession();
      console.log('✅ Session middleware configured');
    } else {
      console.error('\n❌ Database initialization failed!');
      console.error('💡 Please check:');
      console.error('   1. DATABASE_URL is set in Render > Environment');
      console.error('   2. Database is provisioned and accessible');
      console.error('   3. SSL settings are correct');
      process.exit(1);
    }
  } else {
    console.warn('\n⚠️  WARNING: DATABASE_URL not set - running without database');
    setupSession(); // Still setup session (will use memory store fallback)
  }
  
  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 SERVER LIVE ON PORT ' + PORT);
    console.log('📊 Database: ' + (dbReady ? '✅ READY' : '❌ NOT READY'));
    console.log('='.repeat(50) + '\n');
  });
}

// Handle graceful shutdown
process.on('SIGTERM', async () => { 
  console.log('\n🛑 SIGTERM received, shutting down...'); 
  try { await pool.end(); } catch(e) {} 
  process.exit(0); 
});

process.on('SIGINT', async () => { 
  console.log('\n🛑 SIGINT received, shutting down...'); 
  try { await pool.end(); } catch(e) {} 
  process.exit(0); 
});

process.on('unhandledRejection', (reason, promise) => { 
  console.error('❌ Unhandled Rejection:', reason); 
});

// Start the application
start().catch(err => { 
  console.error('❌ Startup failed:', err); 
  process.exit(1); 
});
