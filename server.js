const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const Parser = require('rss-parser');
const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });
const parser = new Parser();
const server = http.createServer(app);
const io = new Server(server);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-free-launch-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(limiter);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

// === MULTI-LANGUAGE ===
const LANGUAGES = { en: { name: 'English', flag: '🇬🇧' }, lg: { name: 'Luganda', flag: '🇺🇬' }, sw: { name: 'Swahili', flag: '🇹🇿' }, fr: { name: 'Français', flag: '🇫🇷' } };
const TRANSLATIONS = {
  en: { welcome: 'Welcome', login: 'Login', signup: 'Sign Up', dashboard: 'Dashboard', news: 'News', learn: 'Learn', donate: 'Donate', chat: 'Chat', create_site: 'Create Your Site', students: 'Students', fees: 'Fees', attendance: 'Attendance', coming_soon: 'Coming Soon' },
  lg: { welcome: 'Tukusanyukidde', login: 'Yingira', signup: 'Wewandiise', dashboard: 'Olukiiko', news: 'Amawulire', learn: 'Yiga', donate: 'Waayo', chat: 'Boogerera', create_site: 'Kola Omukutu Gwo', students: 'Abayizi', fees: 'Ebisale', attendance: 'Okwetaba', coming_soon: 'Kijja Mangu' },
  sw: { welcome: 'Karibu', login: 'Ingia', signup: 'Jisajili', dashboard: 'Dashibodi', news: 'Habari', learn: 'Jifunze', donate: 'Changia', chat: 'Zungumza', create_site: 'Unda Tovuti Yako', students: 'Wanafunzi', fees: 'Ada', attendance: 'Mahudhurio', coming_soon: 'Inakuja Hivi Karibuni' },
  fr: { welcome: 'Bienvenue', login: 'Connexion', signup: "S'inscrire", dashboard: 'Tableau de bord', news: 'Actualités', learn: 'Apprendre', donate: 'Donner', chat: 'Discuter', create_site: 'Créer Votre Site', students: 'Étudiants', fees: 'Frais', attendance: 'Présence', coming_soon: 'Bientôt Disponible' }
};
const t = (key, lang = 'en') => TRANSLATIONS?.[key] || TRANSLATIONS.en[key] || key;

app.use((req, res, next) => {
  req.lang = req.query.lang || req.session.lang || 'en';
  if (!LANGUAGES[req.lang]) req.lang = 'en';
  req.session.lang = req.lang;
  res.locals.t = (key) => t(key, req.lang);
  res.locals.lang = req.lang;
  res.locals.languages = LANGUAGES;
  next();
});

// === FEATURE CONTROL ===
const FEATURES = {
  students: { name: 'Student Management', tier: 'free', status: 'enabled' },
  fees: { name: 'Fee Collection', tier: 'free', status: 'enabled' },
  attendance: { name: 'Attendance', tier: 'free', status: 'enabled' },
  grades: { name: 'Grades', tier: 'free', status: 'enabled' },
  news: { name: 'Global News', tier: 'free', status: 'enabled' },
  learn: { name: 'Learning Center', tier: 'free', status: 'enabled' },
  kids_portal: { name: 'Kids Zone', tier: 'free', status: 'enabled' },
  entertainment: { name: 'Entertainment Hub', tier: 'free', status: 'enabled' },
  chat: { name: 'Live Chat', tier: 'free', status: 'enabled' },
  comments: { name: 'Comments', tier: 'free', status: 'enabled' },
  feedback: { name: 'Feedback System', tier: 'free', status: 'enabled' },
  ranking: { name: '100/50 School Ranking', tier: 'free', status: 'enabled' },
  marketplace: { name: 'Marketplace E-commerce', tier: 'pro', status: 'coming_soon' },
  surveys: { name: 'Paid Surveys', tier: 'pro', status: 'coming_soon' },
  donations: { name: 'Donor Campaigns', tier: 'pro', status: 'coming_soon' },
  grants: { name: 'Grant Applications', tier: 'pro', status: 'coming_soon' },
  advertising: { name: 'Advertising Network', tier: 'pro', status: 'coming_soon' },
  whatsapp_bot: { name: 'WhatsApp Bot', tier: 'pro', status: 'coming_soon' },
  sms_alerts: { name: 'SMS Alerts', tier: 'pro', status: 'coming_soon' },
  custom_domain: { name: 'Custom Domain', tier: 'enterprise', status: 'coming_soon' },
  api_access: { name: 'API Access', tier: 'enterprise', status: 'coming_soon' }
};

const TIERS = {
  free: { price: 0, features: ['students', 'fees', 'attendance', 'grades', 'news', 'learn', 'kids_portal', 'entertainment', 'chat', 'comments', 'feedback', 'ranking'] },
  pro: { price: 50000, features: Object.keys(FEATURES) },
  enterprise: { price: 150000, features: Object.keys(FEATURES) }
};

async function getSettings(tenantId = 1) {
  try {
    const s = await pool.query('SELECT * FROM settings WHERE tenant_id = $1', [tenantId]);
    return s.rows[0] || {
      site_name: 'SSEWASSWA FOUNDATION UGANDA',
      hero_title: 'Free All-In-One Platform for Schools & NGOs',
      hero_subtitle: 'Manage students, fees, attendance. Learn, play, connect - 100% Free to Start',
      whatsapp_number: '0789736737',
      momo_number: '0705373465',
      momo_names: 'WASSWA',
      contact_email: 'waiswadaniel24@gmail.com',
      location: 'Kampala, Uganda',
      primary_color: '#1e40af',
      org_type: 'platform',
      verified: true,
      public_profile: true,
      subscription_tier: 'free',
      developer_name: 'SSEWASSWA Foundation',
      developer_bio: 'Building digital infrastructure for African education',
      developer_whatsapp: '0789736737',
      developer_email: 'waiswadaniel24@gmail.com'
    };
  } catch {
    return { site_name: 'SSEWASSWA FOUNDATION UGANDA', hero_title: 'Free Platform', whatsapp_number: '0789736737', contact_email: 'waiswadaniel24@gmail.com', primary_color: '#1e40af', subscription_tier: 'free', developer_name: 'SSEWASSWA Foundation', developer_whatsapp: '0789736737', developer_email: 'waiswadaniel24@gmail.com' };
  }
}

async function hasFeature(tenantId, feature) {
  if (tenantId === 1) return true;
  const status = FEATURES[feature]?.status;
  if (status === 'coming_soon') return false;
  if (status === 'enabled') return true;
  const s = await pool.query('SELECT subscription_tier FROM settings WHERE tenant_id = $1', [tenantId]);
  const tier = s.rows[0]?.subscription_tier || 'free';
  return TIERS[tier].features.includes(feature);
}

function requireFeature(feature) {
  return async (req, res, next) => {
    const allowed = await hasFeature(req.tenantId, feature);
    const s = await getSettings(req.tenantId);
    if (!allowed) {
      const f = FEATURES[feature];
      if (f.status === 'coming_soon') {
        return res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#fef3c7">
        <h1 style="color:#92400e">🚧 ${res.locals.t('coming_soon')}</h1>
        <p style="font-size:1.2rem;margin:20px 0">${f.name} is launching soon!</p>
        <p>Want early access? Contact developer.</p>
        <a href="https://wa.me/256789736737" style="display:inline-block;margin-top:20px;padding:14px 32px;background:${s.primary_color};color:white;text-decoration:none;border-radius:8px;font-weight:600">WhatsApp Developer</a>
        </body></html>`);
      }
      return res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#fef2f2">
      <h1 style="color:#dc2626">🔒 Premium Feature</h1>
      <p style="font-size:1.2rem;margin:20px 0">${f.name} requires PRO plan</p>
      <a href="/upgrade" style="display:inline-block;margin-top:20px;padding:14px 32px;background:${s.primary_color};color:white;text-decoration:none;border-radius:8px;font-weight:600">Upgrade</a>
      </body></html>`);
    }
    next();
  };
}

async function updateRankings() {
  const schools = await pool.query(`
    SELECT t.id, t.name,
      (SELECT COUNT(*) FROM students WHERE tenant_id = t.id) * 2 as student_points,
      (SELECT COUNT(*) FROM fees WHERE tenant_id = t.id AND paid > 0) * 3 as fee_points,
      (SELECT COUNT(*) FROM attendance WHERE tenant_id = t.id AND date >= CURRENT_DATE - INTERVAL '30 days') as attendance_points,
      (SELECT COUNT(*) FROM comments WHERE tenant_id = t.id) * 1 as engagement_points
    FROM tenants t WHERE t.id!= 1
  `);
  for (const school of schools.rows) {
    const total = school.student_points + school.fee_points + school.attendance_points + school.engagement_points;
    await pool.query('UPDATE tenants SET ranking_score = $1 WHERE id = $2', [total, school.id]);
  }
}
cron.schedule('0 2 * * *', updateRankings);

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', plan_expires DATE, ranking_score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT, role TEXT DEFAULT 'staff', tenant_id INTEGER REFERENCES tenants(id), created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), student_id INTEGER, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), student_id INTEGER, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS attendance_unique ON attendance (tenant_id, student_id, date)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), student_id INTEGER, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS market_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), title TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, seller_email TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallets_tenant_unique ON wallets (tenant_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), creator_email TEXT, title TEXT NOT NULL, questions JSONB, reward_per_user NUMERIC DEFAULT 0, total_budget NUMERIC DEFAULT 0, max_responses INTEGER DEFAULT 100, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), donor_name TEXT, donor_email TEXT, amount NUMERIC NOT NULL, message TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS donor_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), title TEXT NOT NULL, description TEXT, goal_amount NUMERIC NOT NULL, raised_amount NUMERIC DEFAULT 0, image_url TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS grants (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, amount NUMERIC, deadline DATE, requirements TEXT, active BOOLEAN DEFAULT true, source_url TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS comments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), user_email TEXT, user_name TEXT, comment_text TEXT NOT NULL, topic TEXT DEFAULT 'general', parent_id INTEGER, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS feedback_threads (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), user_email TEXT NOT NULL, user_name TEXT, subject TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS feedback_messages (id SERIAL PRIMARY KEY, thread_id INTEGER REFERENCES feedback_threads(id), sender_type TEXT NOT NULL, sender_email TEXT, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS news_cache (id SERIAL PRIMARY KEY, title TEXT, link TEXT UNIQUE, snippet TEXT, pub_date TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (id SERIAL PRIMARY KEY, room TEXT, user_name TEXT, message TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), title TEXT NOT NULL, description TEXT, video_url TEXT, category TEXT, level TEXT DEFAULT 'beginner', created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), site_name TEXT DEFAULT 'SSEWASSWA FOUNDATION UGANDA', hero_title TEXT, hero_subtitle TEXT, whatsapp_number TEXT DEFAULT '0789736737', momo_number TEXT DEFAULT '0705373465', momo_names TEXT DEFAULT 'WASSWA', contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', location TEXT DEFAULT 'Kampala, Uganda', primary_color TEXT DEFAULT '#1e40af', org_type TEXT DEFAULT 'platform', verified BOOLEAN DEFAULT false, public_profile BOOLEAN DEFAULT true, subscription_tier TEXT DEFAULT 'free', developer_name TEXT DEFAULT 'SSEWASSWA Foundation', developer_bio TEXT DEFAULT 'Building digital infrastructure for African education', developer_whatsapp TEXT DEFAULT '0789736737', developer_email TEXT DEFAULT 'waiswadaniel24@gmail.com', feature_overrides JSONB DEFAULT '{}')`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS settings_tenant_unique ON settings (tenant_id)`);
  await pool.query(`INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) ON CONFLICT (subdomain) DO NOTHING`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise']);
  const t = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', ['main']);
  const tenantId = t.rows[0].id;
  await pool.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET tenant_id = $1, password_hash = $3, role = $4`, [tenantId, 'waiswadaniel24@gmail.com', await bcrypt.hash('admin123', 10), 'super_admin']);
  await pool.query(`INSERT INTO wallets (tenant_id, balance) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 0]);
  await pool.query(`INSERT INTO settings (tenant_id, subscription_tier, verified) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 'enterprise', true]);
  await pool.query(`INSERT INTO courses (tenant_id, title, description, video_url, category) VALUES (1, 'Introduction to Computers', 'Learn computer basics', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'technology'), (1, 'English for Beginners', 'Basic English lessons', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'language') ON CONFLICT DO NOTHING`);
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

async function requireTenant(req, res, next) {
  const sub = req.headers.host.split('.')[0];
  if (sub === 'localhost' || sub.includes('onrender') || sub === 'ssewasswa-api' || sub === '127.0.0.1') {
    req.tenantId = 1;
    const t = await pool.query('SELECT * FROM tenants WHERE id = 1');
    req.tenant = t.rows[0];
    return next();
  }
  const t = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [sub]);
  if (t.rows.length === 0) return res.status(404).send('Site not found');
  req.tenantId = t.rows[0].id;
  req.tenant = t.rows[0];
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.session.user?.role === 'super_admin') return next();
  res.status(403).send('Forbidden');
}

app.get('/health', (req, res) => res.send('OK'));

app.get('/', async (req, res) => {
  const s = await getSettings(1);
  const topSchools = await pool.query(`SELECT t.name, t.subdomain, s.hero_subtitle, t.ranking_score FROM tenants t JOIN settings s ON t.id = s.tenant_id WHERE s.verified = true AND s.public_profile = true AND t.id!= 1 ORDER BY t.ranking_score DESC LIMIT 6`);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}nav{background:${s.primary_color};padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}nav a{color:white;margin:0 8px;text-decoration:none;font-weight:500}.lang-switch{margin-left:auto}.lang-switch a{margin:0 4px;font-size:20px}.hero{background:linear-gradient(135deg,${s.primary_color} 0%,#1e3a8a 100%);color:white;padding:100px 20px;text-align:center}.hero h1{font-size:3rem;margin-bottom:1rem;font-weight:800}.btn{background:white;color:${s.primary_color};padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;margin:8px}.container{max-width:1200px;margin:60px auto;padding:0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}.card{background:white;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);transition:transform 0.2s}.card:hover{transform:translateY(-4px)}.card h2{color:${s.primary_color};margin-bottom:12px}.badge{background:#10b981;color:white;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}.rank{background:#fbbf24;color:#92400e;padding:4px 12px;border-radius:20px;font-size:14px;font-weight:700}footer{background:#1e293b;color:#94a3b8;padding:60px 20px;margin-top:80px}.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:40px;max-width:1200px;margin:0 auto}.footer-grid h3{color:white;margin-bottom:16px}.footer-grid a{color:#94a3b8;text-decoration:none;display:block;margin:8px 0}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><div>
  <a href="/">${res.locals.t('welcome')}</a>
  <a href="/news">${res.locals.t('news')}</a>
  <a href="/learn">${res.locals.t('learn')}</a>
  <a href="/entertainment">Entertainment</a>
  <a href="/ranking">Top Schools</a>
  <a href="/chat">${res.locals.t('chat')}</a>
  <a href="/create-site">${res.locals.t('create_site')}</a>
  <a href="/login">${res.locals.t('login')}</a>
  </div>
  <div class="lang-switch">${Object.entries(LANGUAGES).map(([code, l]) => `<a href="/set-lang/${code}">${l.flag}</a>`).join('')}</div>
  </nav>
  <div class="hero"><h1>${s.hero_title}</h1><p style="font-size:1.25rem;margin-bottom:2rem">${s.hero_subtitle}</p>
  <a href="/create-site" class="btn">${res.locals.t('create_site')} - FREE</a>
  <a href="/learn" class="btn">Start Learning Free</a>
  <a href="/login" class="btn">${res.locals.t('login')}</a></div>
  <div class="container">
  <h2 style="margin-bottom:24px">🏆 Top Ranked Schools <span class="badge">100/50 System</span></h2>
  <div class="grid">
  ${topSchools.rows.map((o, i) => `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h2>${o.name}</h2><span class="rank">#${i+1}</span></div><p style="color:#64748b;font-size:14px;margin:8px 0">Score: ${o.ranking_score} points</p><p style="margin:16px 0">${o.hero_subtitle}</p><a href="https://${o.subdomain}.ssewasswa.com" style="color:${s.primary_color};font-weight:600">Visit Site →</a></div>`).join('')}
  </div>
  <h2 style="margin:60px 0 24px">✅ Free Features Available Now</h2>
  <div class="grid">
  <div class="card"><h2>👨‍🎓 ${res.locals.t('students')}</h2><p>Manage unlimited students, classes, records</p></div>
  <div class="card"><h2>💰 ${res.locals.t('fees')}</h2><p>Track fees, payments, balances, reports</p></div>
  <div class="card"><h2>✅ ${res.locals.t('attendance')}</h2><p>Daily attendance, reports, parent alerts</p></div>
  <div class="card"><h2>📊 Grades</h2><p>Enter scores, generate report cards</p></div>
  <div class="card"><h2>📰 News</h2><p>Global news from BBC, CNN, Monitor</p></div>
  <div class="card"><h2>📚 Learn</h2><p>Free video courses, certificates</p></div>
  <div class="card"><h2>🎮 Kids Zone</h2><p>Safe games, learning, AdSense funded</p></div>
  <div class="card"><h2>💬 Chat</h2><p>Real-time chat rooms for schools</p></div>
  <div class="card"><h2>💭 Comments</h2><p>Community feedback system</p></div>
  </div>
  <h2 style="margin:60px 0 24px">🚧 Coming Soon - Premium Features</h2>
  <div class="grid">
  <div class="card" style="opacity:0.6"><h2>🛒 Marketplace</h2><p>Sell uniforms, books, supplies online</p><span class="badge" style="background:#fbbf24;color:#92400e">${res.locals.t('coming_soon')}</span></div>
  <div class="card" style="opacity:0.6"><h2>💝 Donations</h2><p>Raise funds from global donors</p><span class="badge" style="background:#fbbf24;color:#92400e">${res.locals.t('coming_soon')}</span></div>
  <div class="card" style="opacity:0.6"><h2>🎯 Grants</h2><p>Apply to USAID, Gates Foundation</p><span class="badge" style="background:#fbbf24;color:#92400e">${res.locals.t('coming_soon')}</span></div>
  <div class="card" style="opacity:0.6"><h2>📱 WhatsApp Bot</h2><p>Parents check fees via WhatsApp</p><span class="badge" style="background:#fbbf24;color:#92400e">${res.locals.t('coming_soon')}</span></div>
  </div>
  <footer><div class="footer-grid">
  <div><h3>${s.site_name}</h3><p>${s.developer_bio}</p><p style="margin-top:16px"><strong>Developer:</strong> ${s.developer_name}<br>WhatsApp: ${s.developer_whatsapp}<br>Email: ${s.developer_email}</p></div>
  <div><h3>Free Features</h3><a href="/create-site">Create Site</a><a href="/learn">Learning Center</a><a href="/news">News Portal</a><a href="/ranking">School Rankings</a><a href="/chat">Live Chat</a></div>
  <div><h3>Resources</h3><a href="/comments">Comments</a><a href="/feedback">Feedback</a><a href="/kids">Kids Zone</a><a href="/about-developer">About Developer</a></div>
  <div><h3>Legal</h3><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/refund">Refund Policy</a></div>
  </div>
  <p style="text-align:center;margin-top:40px;padding-top:20px;border-top:1px solid #334155">&copy; 2026 ${s.site_name}. All rights reserved. | Built by ${s.developer_name}</p></footer>
  </body></html>`);
});

// === NEWS PORTAL - FIXED ===
app.get('/news', async (req, res) => {
  const s = await getSettings(1);
  let newsItems = [];
  const feeds = ['http://feeds.bbci.co.uk/news/world/africa/rss.xml', 'http://rss.cnn.com/rss/edition_africa.rss', 'https://www.monitor.co.ug/uganda/rss'];
  try {
    for (const url of feeds) {
      const feed = await parser.parseURL(url);
      newsItems.push(...feed.items.slice(0, 5).map(item => ({ title: item.title, link: item.link, date: item.pubDate, snippet: item.contentSnippet?.substring(0, 200) + '...' })));
    }
  } catch (e) { }
  for (const item of newsItems.slice(0, 15)) {
    await pool.query('INSERT INTO news_cache (title, link, snippet, pub_date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [item.title, item.link, item.snippet, new Date(item.date)]);
  }
  const cached = await pool.query('SELECT * FROM news_cache ORDER BY pub_date DESC LIMIT 20');
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Global News - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:24px}.news-card{background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.news-card h3{color:${s.primary_color};margin-bottom:12px;font-size:1.1rem;line-height:1.4}.news-card p{color:#64748b;font-size:14px;line-height:1.6}.news-card a{color:${s.primary_color};text-decoration:none;font-weight:600;margin-top:12px;display:inline-block}.date{color:#94a3b8;font-size:12px;margin-top:8px}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/news">News</a><a href="/learn">Learn</a></nav>
  <div class="container">
  <h1>🌍 Global News Portal - FREE</h1>
  <p style="color:#64748b;margin-bottom:32px">Live updates from BBC, CNN, Daily Monitor</p>
  <div class="grid">
  ${cached.rows.map(n => `<div class="news-card"><h3>${n.title}</h3><p>${n.snippet}</p><div class="date">${new Date(n.pub_date).toLocaleDateString()}</div><a href="${n.link}" target="_blank">Read Full Story →</a></div>`).join('')}
  </div>
  </div></body></html>`);
});

// === CONTINUE WITH REST OF ROUTES... ===
// [Learning, Kids, Entertainment, Comments, Feedback, Chat, Login, Create-Site, Dashboard, Students, Fees, Attendance, Super-Admin, etc. - All included in previous messages]

initDB().then(() => {
  server.listen(PORT, () => console.log(`🚀 SSEWASSWA FOUNDATION v5.1 FREE LAUNCH running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
