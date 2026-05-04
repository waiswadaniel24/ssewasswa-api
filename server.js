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

// === FEATURE CONTROL - FREE VS COMING SOON ===
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
  // PAID FEATURES - SET TO COMING SOON
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
  // Developer always has access
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

async function logRevenue(type, amount, tenantId, description) {
  // Free tier = no commission taken
  await pool.query('INSERT INTO revenue_log (type, gross_amount, commission, tenant_id, description) VALUES ($1, $2, $3, $4, $5)',
    [type, amount, 0, tenantId, description]);
}

// === 100/50 RANKING SYSTEM ===
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
cron.schedule('0 2 * * *', updateRankings); // Daily 2am

// === DATABASE INIT ===
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

  // Seed main tenant - YOU GET EVERYTHING FREE
  await pool.query(`INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) ON CONFLICT (subdomain) DO NOTHING`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise']);
  const t = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', ['main']);
  const tenantId = t.rows[0].id;
  await pool.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET tenant_id = $1, password_hash = $3, role = $4`, [tenantId, 'waiswadaniel24@gmail.com', await bcrypt.hash('admin123', 10), 'super_admin']);
  await pool.query(`INSERT INTO wallets (tenant_id, balance) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 0]);
  await pool.query(`INSERT INTO settings (tenant_id, subscription_tier, verified) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 'enterprise', true]);

  // Seed free courses
  await pool.query(`INSERT INTO courses (tenant_id, title, description, video_url, category) VALUES (1, 'Introduction to Computers', 'Learn computer basics', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'technology'), (1, 'English for Beginners', 'Basic English lessons', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'language') ON CONFLICT DO NOTHING`);
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

async function requireTenant(req, res, next) {
  const sub = req.headers.host.split('.')[0];
  if (sub === 'localhost' || sub.includes('onrender') || sub === 'ssewasswa-api') {
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

// === HOMEPAGE - FREE FEATURES ONLY ===
app.get('/', async (req, res) => {
  const s = await getSettings(1);
  const topSchools = await pool.query(`SELECT t.name, t.subdomain, s.hero_subtitle, t.ranking_score FROM tenants t JOIN settings s ON t.id = s.tenant_id WHERE s.verified = true AND s.public_profile = true AND t.id!= 1 ORDER BY t.ranking_score DESC LIMIT 6`);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;color:#1e293b}nav{background:${s.primary_color};padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap}nav a{color:white;margin:0 8px;text-decoration:none;font-weight:500}.lang-switch{margin-left:auto}.lang-switch a{margin:0 4px;font-size:20px}.hero{background:linear-gradient(135deg,${s.primary_color} 0%,#1e3a8a 100%);color:white;padding:100px 20px;text-align:center}.hero h1{font-size:3rem;margin-bottom:1rem;font-weight:800}.btn{background:white;color:${s.primary_color};padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;margin:8px}.container{max-width:1200px;margin:60px auto;padding:0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}.card{background:white;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0.1);transition:transform 0.2s}.card:hover{transform:translateY(-4px)}.card h2{color:${s.primary_color};margin-bottom:12px}.badge{background:#10b981;color:white;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}.rank{background:#fbbf24;color:#92400e;padding:4px 12px;border-radius:20px;font-size:14px;font-weight:700}footer{background:#1e293b;color:#94a3b8;padding:60px 20px;margin-top:80px}.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:40px;max-width:1200px;margin:0 auto}.footer-grid h3{color:white;margin-bottom:16px}.footer-grid a{color:#94a3b8;text-decoration:none;display:block;margin:8px 0}</style>
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
  <div class="card"><h2>📚 Grades</h2><p>Enter scores, generate report cards</p></div>
  <div class="card"><h2>📰 News</h2><p>Global news from BBC, CNN, Monitor</p></div>
  <div class="card"><h2>📖 Learn</h2><p>Free video courses, certificates</p></div>
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

// === SCHOOL RANKING PAGE ===
app.get('/ranking', async (req, res) => {
  const s = await getSettings(1);
  const schools = await pool.query(`SELECT t.name, t.subdomain, s.hero_subtitle, s.location, t.ranking_score FROM tenants t JOIN settings s ON t.id = s.tenant_id WHERE s.verified = true AND s.public_profile = true AND t.id!= 1 ORDER BY t.ranking_score DESC LIMIT 50`);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>School Rankings - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}th,td{padding:16px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:${s.primary_color};color:white;font-weight:700}.rank{font-size:24px;font-weight:800;color:#fbbf24}.score{font-weight:700;color:${s.primary_color}}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/ranking">Rankings</a><a href="/create-site">Create Site</a></nav>
  <div class="container">
  <h1 style="color:${s.primary_color};margin-bottom:8px">🏆 100/50 School Ranking System</h1>
  <p style="color:#64748b;margin-bottom:32px">Ranked by: Students (2pts) + Fees Paid (3pts) + Attendance (1pt) + Engagement (1pt)</p>
  <table>
  <thead><tr><th>Rank</th><th>School Name</th><th>Location</th><th>Score</th><th>Action</th></tr></thead>
  <tbody>
  ${schools.rows.map((sch, i) => `<tr>
    <td><span class="rank">#${i+1}</span></td>
    <td><strong>${sch.name}</strong><br><small style="color:#64748b">${sch.hero_subtitle}</small></td>
    <td>${sch.location}</td>
    <td><span class="score">${sch.ranking_score}</span> pts</td>
    <td><a href="https://${sch.subdomain}.ssewasswa.com" style="color:${s.primary_color};font-weight:600">Visit →</a></td>
  </tr>`).join('')}
  </tbody>
  </table>
  </div></body></html>`);
});

// === NEWS PORTAL ===
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
  ${cached.rows.map(n => `<div class="news-card"><h3>${n.title}</h3><p>${n.snippet}</p><div class="date">${new Date(n.pub_date).toLocaleDate// === LEARNING CENTER ===
app.get('/learn', async (req, res) => {
  const s = await getSettings(1);
  const courses = await pool.query('SELECT * FROM courses WHERE tenant_id = 1 OR tenant_id IS NULL ORDER BY created_at DESC');
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Learning Center - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}.hero{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;padding:60px 20px;text-align:center;border-radius:16px;margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}.course{background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.course iframe{width:100%;height:200px;border:none}.course-info{padding:20px}.course h3{color:${s.primary_color};margin-bottom:8px}.badge{background:#10b981;color:white;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/learn">Learn</a><a href="/kids">Kids</a></nav>
  <div class="container">
  <div class="hero"><h1>📚 Free Learning Center</h1><p style="font-size:1.2rem">Courses, videos, certificates - 100% Free</p></div>
  <div class="grid">
  ${courses.rows.map(c => `<div class="course">
    <iframe src="${c.video_url}" allowfullscreen></iframe>
    <div class="course-info">
    <span class="badge">${c.level.toUpperCase()}</span>
    <h3>${c.title}</h3>
    <p style="color:#64748b;margin:12px 0">${c.description}</p>
    <p style="color:#94a3b8;font-size:14px">Category: ${c.category}</p>
    </div>
  </div>`).join('')}
  </div>
  </div></body></html>`);
});

// === KIDS ZONE ===
app.get('/kids', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Kids Zone - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);min-height:100vh}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}.hero{background:white;padding:40px;border-radius:20px;text-align:center;margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px}.game{background:white;padding:32px;border-radius:16px;text-align:center;cursor:pointer;transition:transform 0.2s}.game:hover{transform:scale(1.05)}.emoji{font-size:4rem;margin-bottom:16px}.game h2{color:${s.primary_color};margin-bottom:12px}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/kids">Kids Zone</a><a href="/learn">Learn</a></nav>
  <div class="container">
  <div class="hero"><h1 style="color:${s.primary_color};font-size:3rem">🎮 Kids Zone</h1><p style="font-size:1.2rem;color:#64748b">Safe, Fun, Educational Games - FREE</p></div>
  <div class="grid">
  <div class="game" onclick="location.href='/kids/math'"><div class="emoji">🔢</div><h2>Math Games</h2><p>Learn numbers & counting</p></div>
  <div class="game" onclick="location.href='/kids/spelling'"><div class="emoji">📝</div><h2>Spelling Bee</h2><p>Practice English words</p></div>
  <div class="game" onclick="location.href='/kids/colors'"><div class="emoji">🎨</div><h2>Color Match</h2><p>Learn colors & shapes</p></div>
  <div class="game" onclick="location.href='/kids/stories'"><div class="emoji">📚</div><h2>Stories</h2><p>Read & listen to stories</p></div>
  </div>
  <p style="text-align:center;color:white;margin-top:40px;font-weight:600">Ad-supported to keep it free for all children</p>
  </div></body></html>`);
});

// === ENTERTAINMENT HUB ===
app.get('/entertainment', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Entertainment - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#e2e8f0}nav{background:${s.primary_color};padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1400px;margin:40px auto;padding:0 24px}.hero{background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);padding:60px 20px;text-align:center;border-radius:16px;margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px}.card{background:#1e293b;padding:32px;border-radius:16px;text-align:center;transition:transform 0.3s;cursor:pointer;border:1px solid #334155}.card:hover{transform:translateY(-8px);border-color:#8b5cf6}.emoji{font-size:4rem;margin-bottom:16px}.card h2{color:#a78bfa;margin-bottom:12px}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/news">News</a><a href="/kids">Kids</a><a href="/entertainment">Entertainment</a></nav>
  <div class="container">
  <div class="hero"><h1 style="font-size:3rem">🎮 Entertainment Hub</h1><p style="font-size:1.2rem">Music, News, Kids, Chat - All Free</p></div>
  <div class="grid">
  <div class="card" onclick="location.href='/news'"><div class="emoji">📰</div><h2>News</h2><p>Global & local news</p></div>
  <div class="card" onclick="location.href='/kids'"><div class="emoji">🎨</div><h2>Kids Zone</h2><p>Safe games & learning</p></div>
  <div class="card" onclick="location.href='/chat'"><div class="emoji">💬</div><h2>Chat Rooms</h2><p>Meet & chat with others</p></div>
  <div class="card" onclick="location.href='/learn'"><div class="emoji">📚</div><h2>Education</h2><p>Free courses & videos</p></div>
  </div>
  </div></body></html>`);
});

// === COMMENTS SYSTEM ===
app.get('/comments', requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const comments = await pool.query(`SELECT * FROM comments WHERE tenant_id = $1 AND status = 'approved' AND parent_id IS NULL ORDER BY created_at DESC LIMIT 50`, [req.tenantId]);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Comments - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:900px;margin:40px auto;padding:0 24px}.comment-form{background:white;padding:24px;border-radius:12px;margin-bottom:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}input,textarea{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;margin:8px 0;font-size:16px}button{background:${s.primary_color};color:white;padding:12px 32px;border:none;border-radius:8px;font-weight:600;cursor:pointer}.comment{background:white;padding:20px;border-radius:12px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.comment-header{display:flex;justify-content:space-between;margin-bottom:12px}.comment-author{font-weight:700;color:${s.primary_color}}.comment-date{color:#94a3b8;font-size:14px}.comment-text{color:#1e293b;line-height:1.6}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/comments">Comments</a><a href="/feedback">Feedback</a></nav>
  <div class="container">
  <h1 style="color:${s.primary_color};margin-bottom:8px">Community Comments</h1>
  <p style="color:#64748b;margin-bottom:32px">Share your thoughts. Comments are moderated.</p>
  <div class="comment-form">
  <h3 style="margin-bottom:16px">Leave a Comment</h3>
  <form method="POST" action="/comments/post">
  <input name="name" placeholder="Your Name" required>
  <input name="email" type="email" placeholder="Your Email" required>
  <textarea name="comment" rows="4" placeholder="Your comment..." required></textarea>
  <button type="submit">Post Comment</button>
  </form>
  </div>
  <h2 style="margin:32px 0 16px">Recent Comments (${comments.rows.length})</h2>
  ${comments.rows.map(c => `<div class="comment">
    <div class="comment-header">
      <div class="comment-author">${c.user_name}</div>
      <div class="comment-date">${new Date(c.created_at).toLocaleDateString()}</div>
    </div>
    <div class="comment-text">${c.comment_text}</div>
  </div>`).join('') || '<p style="text-align:center;color:#94a3b8">No comments yet. Be the first!</p>'}
  </div></body></html>`);
});

app.post('/comments/post', requireTenant, async (req, res) => {
  const { name, email, comment } = req.body;
  await pool.query('INSERT INTO comments (tenant_id, user_email, user_name, comment_text, status) VALUES ($1, $2, $3, $4, $5)',
    [req.tenantId, email, name, comment, 'pending']);
  res.send(`<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#f0fdf4"><h1 style="color:#16a34a">Comment Submitted!</h1><p>Your comment is pending approval.</p><a href="/comments" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#1e40af;color:white;text-decoration:none;border-radius:6px">Back to Comments</a></body></html>`);
});

// === FEEDBACK SYSTEM ===
app.get('/feedback', requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Feedback - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:800px;margin:40px auto;padding:0 24px}.form-card{background:white;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}input,textarea,select{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;margin:8px 0;font-size:16px}button{background:${s.primary_color};color:white;padding:14px 32px;border:none;border-radius:8px;font-weight:700;cursor:pointer;width:100%;margin-top:16px}label{display:block;margin-top:16px;font-weight:600}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/">Home</a><a href="/feedback">Feedback</a><a href="/comments">Comments</a></nav>
  <div class="container">
  <h1 style="color:${s.primary_color};margin-bottom:8px">Send Feedback to Developer</h1>
  <p style="color:#64748b;margin-bottom:32px">Ask questions, report bugs, or request features. Developer will reply via email.</p>
  <div class="form-card">
  <form method="POST" action="/feedback/submit">
  <label>Your Name</label><input name="name" required>
  <label>Your Email</label><input name="email" type="email" required>
  <label>Subject</label>
  <select name="subject" required>
    <option value="">Select Topic...</option>
    <option value="bug">Bug Report</option>
    <option value="feature">Feature Request</option>
    <option value="question">Question</option>
    <option value="billing">Billing Issue</option>
    <option value="other">Other</option>
  </select>
  <label>Message</label><textarea name="message" rows="6" required placeholder="Describe your issue or request..."></textarea>
  <button type="submit">Send to Developer</button>
  </form>
  </div>
  <p style="text-align:center;color:#64748b;margin-top:32px;font-size:14px">Developer typically replies within 24 hours to: ${s.developer_email}</p>
  </div></body></html>`);
});

app.post('/feedback/submit', requireTenant, async (req, res) => {
  const { name, email, subject, message } = req.body;
  const result = await pool.query('INSERT INTO feedback_threads (tenant_id, user_email, user_name, subject) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.tenantId, email, name, subject]);
  const threadId = result.rows[0].id;
  await pool.query('INSERT INTO feedback_messages (thread_id, sender_type, sender_email, message) VALUES ($1, $2, $3, $4)',
    [threadId, 'user', email, message]);
  res.send(`<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#f0fdf4"><h1 style="color:#16a34a">Feedback Sent!</h1><p>Your message has been sent to the developer.</p><p>You'll receive a reply at: <strong>${email}</strong></p><a href="/" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#1e40af;color:white;text-decoration:none;border-radius:6px">Back to Home</a></body></html>`);
});

// === LIVE CHAT ===
app.get('/chat', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const rooms = [
    { id: `school_${req.tenantId}`, name: `${req.tenant.name} School Chat` },
    { id: 'global_uganda', name: '🇺🇬 Uganda Global Chat' },
    { id: 'global_education', name: '📚 Education Discussion' },
    { id: 'global_music', name: '🎵 Music & Entertainment' }
  ];
  res.send(`<!DOCTYPE html><html><head><title>Live Chat - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f1f5f9;height:100vh;display:flex;flex-direction:column}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.chat-container{display:flex;flex:1;overflow:hidden}.sidebar{width:280px;background:white;border-right:1px solid #e2e8f0;overflow-y:auto}.sidebar h3{padding:16px;background:#f8fafc;border-bottom:1px solid #e2e8f0}.room{padding:16px;cursor:pointer;border-bottom:1px solid #f1f5f9}.room:hover{background:#f8fafc}.room.active{background:#eff6ff;border-left:3px solid ${s.primary_color}}.chat-main{flex:1;display:flex;flex-direction:column}.messages{flex:1;overflow-y:auto;padding:20px;background:#f8fafc}.message{background:white;padding:12px 16px;border-radius:12px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,0.05)}.message.user{font-weight:600;color:${s.primary_color};margin-bottom:4px}.message.time{font-size:12px;color:#94a3b8;float:right}.input-area{padding:16px;background:white;border-top:1px solid #e2e8f0;display:flex;gap:12px}input{flex:1;padding:12px;border:2px solid #e2e8f0;border-radius:8px}button{background:${s.primary_color};color:white;padding:12px 24px;border:none;border-radius:8px;font-weight:600;cursor:pointer}</style>
  <script src="/socket.io/socket.io.js"></script>
  </head><body>
  <nav><strong>${req.tenant.name}</strong> <a href="/app">Dashboard</a><a href="/chat">Chat</a><a href="/logout" style="float:right">Logout</a></nav>
  <div class="chat-container">
  <div class="sidebar">
  <h3>Chat Rooms</h3>
  ${rooms.map(r => `<div class="room" data-room="${r.id}">${r.name}</div>`).join('')}
  </div>
  <div class="chat-main">
  <div class="messages" id="messages"><p style="text-align:center;color:#94a3b8;margin-top:40px">Select a room to start chatting</p></div>
  <div class="input-area">
  <input id="messageInput" placeholder="Type a message..." disabled>
  <button id="sendBtn" disabled>Send</button>
  </div>
  <script>
    const socket = io();
    let currentRoom = null;
    const userName = '${req.session.user.email.split('@')[0]}';
    document.querySelectorAll('.room').forEach(room => {
      room.addEventListener('click', () => {
        document.querySelectorAll('.room').forEach(r => r.classList.remove('active'));
        room.classList.add('active');
        currentRoom = room.dataset.room;
        socket.emit('join_room', currentRoom);
        document.getElementById('messages').innerHTML = '<p style="text-align:center;color:#94a3b8">Joined ' + room.textContent + '</p>';
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendBtn').disabled = false;
        loadHistory(currentRoom);
      });
    });
    async function loadHistory(room) {
      const res = await fetch('/chat/history?room=' + room);
      const msgs = await res.json();
      const msgDiv = document.getElementById('messages');
      msgDiv.innerHTML = '';
      msgs.forEach(m => {
        msgDiv.innerHTML += '<div class="message"><div class="user">' + m.user_name + '<span class="time">' + new Date(m.created_at).toLocaleTimeString() + '</span></div>' + m.message + '</div>';
      });
      msgDiv.scrollTop = msgDiv.scrollHeight;
    }
    document.getElementById('sendBtn').onclick = () => {
      const msg = document.getElementById('messageInput').value;
      if (msg && currentRoom) {
        socket.emit('send_message', { room: currentRoom, message: msg, user_name: userName });
        document.getElementById('messageInput').value = '';
      }
    };
    document.getElementById('messageInput').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('sendBtn').click();
    });
    socket.on('new_message', (data) => {
      const msgDiv = document.getElementById('messages');
      msgDiv.innerHTML += '<div class="message"><div class="user">' + data.user_name + '<span class="time">' + data.time + '</span></div>' + data.message + '</div>';
      msgDiv.scrollTop = msgDiv.scrollHeight;
    });
  </script>
  </body></html>`);
});

app.get('/chat/history', async (req, res) => {
  const { room } = req.query;
  const msgs = await pool.query('SELECT * FROM chat_messages WHERE room = $1 ORDER BY created_at DESC LIMIT 50', [room]);
  res.json(msgs.rows.reverse());
});

// === COMING SOON FEATURES ===
app.get('/marketplace', requireFeature('marketplace'), (req, res) => res.send('Marketplace'));
app.get('/donor-portal', requireFeature('donations'), (req, res) => res.send('Donor Portal'));
app.get('/grants', requireFeature('grants'), (req, res) => res.send('Grants Portal'));
app.get('/whatsapp', requireFeature('whatsapp_bot'), (req, res) => res.send('WhatsApp Bot'));

// === LOGIN ===
app.get('/login', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Login - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,${s.primary_color} 0%,#1e3a8a 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:white;padding:40px;border-radius:16px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3)}h1{text-align:center;color:${s.primary_color};margin-bottom:8px}.subtitle{text-align:center;color:#64748b;margin-bottom:32px}input{width:100%;padding:14px;border:2px solid #e2e8f0;border-radius:8px;margin:8px 0;font-size:16px}button{width:100%;padding:14px;background:${s.primary_color};color:white;border:none;border-radius:8px;font-weight:700;font-size:16px;cursor:pointer;margin-top:16px}.footer{text-align:center;margin-top:24px;color:#64748b}.footer a{color:${s.primary_color};text-decoration:none;font-weight:600}</style>
  </head><body>
  <div class="card">
  <h1>${s.site_name}</h1>
  <p class="subtitle">School Management Platform</p>
  <form method="POST" action="/login">
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Login</button>
  </form>
  <div class="footer">
  <p>Don't have account? <a href="/create-site">Create Site Free</a></p>
  <p style="margin-top:12px">WhatsApp: ${s.whatsapp_number}</p>
  </div>
  </div></body></html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const u = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (u.rows.length === 0) return res.send('Invalid credentials');
  const valid = await bcrypt.compare(password, u.rows[0].password_hash);
  if (!valid) return res.send('Invalid credentials');
  req.session.user = u.rows[0];
  res.redirect('/app');
});

// === CREATE SITE ===
app.get('/create-site', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Create Site - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc;padding:40px 20px}.container{max-width:800px;margin:0 auto}.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1)}h1{color:${s.primary_color};margin-bottom:8px}.subtitle{color:#64748b;margin-bottom:32px}input,select,textarea{width:100%;padding:14px;border:2px solid #e2e8f0;border-radius:8px;margin:8px 0;font-size:16px}button{width:100%;padding:16px;background:${s.primary_color};color:white;border:none;border-radius:8px;font-weight:700;font-size:18px;cursor:pointer;margin-top:24px}label{display:block;margin-top:16px;font-weight:600}.preview{background:#f1f5f9;padding:16px;border-radius:8px;margin-top:8px;font-family:monospace;color:${s.primary_color}}</style>
  </head><body>
  <div class="container">
  <div class="card">
  <h1>Create Your School Website - FREE</h1>
  <p class="subtitle">Setup in 60 seconds. No credit card required.</p>
  <form method="POST" action="/create-site">
  <label>Organization Name *</label><input name="org_name" placeholder="St. Mary's Primary School" required oninput="updateSubdomain(this.value)">
  <label>Subdomain *</label><input name="subdomain" id="subdomain" placeholder="st-marys" required>
  <div class="preview" id="preview">Your site: st-marys.ssewasswa.com</div>
  <label>About Your Organization</label><textarea name="about" rows="3" placeholder="We provide quality education..."></textarea>
  <label>Email *</label><input name="email" type="email" placeholder="admin@school.com" required>
  <label>WhatsApp Number</label><input name="whatsapp" placeholder="0700123456">
  <label>Location</label><input name="location" placeholder="Kampala, Uganda">
  <label>MoMo Number</label><input name="momo" placeholder="0700123456">
  <label>Brand Color</label><input name="color" type="color" value="#1e40af">
  <h3 style="margin:32px 0 16px">Admin Account</h3>
  <label>Your Name *</label><input name="admin_name" placeholder="John Doe" required>
  <label>Admin Email *</label><input name="admin_email" type="email" placeholder="john@school.com" required>
  <label>Password *</label><input name="admin_password" type="password" placeholder="Min 6 characters" required minlength="6">
  <button type="submit">Create My FREE Site Now →</button>
  </form>
  <p style="text-align:center;color:#64748b;margin-top:24px;font-size:14px">By creating, you agree to Terms. 30-day free trial, no credit card.</p>
  </div>
  </div>
  <script>
    function updateSubdomain(name) {
      const sub = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30);
      document.getElementById('subdomain').value = sub;
      document.getElementById('preview').textContent = 'Your site: ' + sub + '.ssewasswa.com';
    }
  </script>
  </body></html>`);
});

app.post('/create-site', async (req, res) => {
  const { org_name, subdomain, about, email, whatsapp, location, momo, color, admin_name, admin_email, admin_password } = req.body;
  try {
    const check = await pool.query('SELECT id FROM tenants WHERE subdomain = $1', [subdomain]);
    if (check.rows.length > 0) return res.send('Subdomain taken. Choose another.');

    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) RETURNING id', [org_name, subdomain, 'free']);
    const tenantId = tenant.rows[0].id;
    const hash = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [tenantId, admin_email, hash, 'admin']);
    await pool.query('INSERT INTO wallets (tenant_id, balance) VALUES ($1, $2)', [tenantId, 0]);
    await pool.query('INSERT INTO settings (tenant_id, site_name, hero_subtitle, contact_email, whatsapp_number, location, momo_number, primary_color, subscription_tier) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [tenantId, org_name, about, email, whatsapp, location, momo, color, 'free']);

    await logRevenue('new_site', 0, tenantId, `New site created: ${org_name}`);

    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:60px;background:#f0fdf4">
    <h1 style="color:#16a34a">🎉 Site Created Successfully!</h1>
    <p style="font-size:1.2rem;margin:20px 0">Your website is live at:</p>
    <a href="https://${subdomain}.ssewasswa.com" style="font-size:1.5rem;color:#1e40af;font-weight:700;text-decoration:none">${subdomain}.ssewasswa.com</a>
    <div style="background:white;padding:24px;border-radius:12px;margin:32px auto;max-width:500px;text-align:left">
    <h3>Login Details:</h3>
    <p><strong>URL:</strong> https://${subdomain}.ssewasswa.com/login</p>
    <p><strong>Email:</strong> ${admin_email}</p>
    <p><strong>Password:</strong> (the one you created)</p>
    </div>
    <a href="https://${subdomain}.ssewasswa.com/login" style="display:inline-block;margin-top:20px;padding:14px 32px;background:#1e40af;color:white;text-decoration:none;border-radius:8px;font-weight:600">Login to Your Dashboard →</a>
    <p style="margin-top:32px;color:#64748b">Need help? WhatsApp: 0789736737</p>
    </body></html>`);
  } catch (err) {
    res.send('Error: ' + err.message);
  }
});

// === DASHBOARD ===
app.get('/app', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const students = await pool.query('SELECT COUNT(*) as count FROM students WHERE tenant_id = $1', [req.tenantId]);
  const fees = await pool.query('SELECT SUM(amount - paid) as due FROM fees WHERE tenant_id = $1', [req.tenantId]);
  const today = new Date().toISOString().split('T')[0];
  const attendance = await pool.query('SELECT COUNT(*) as present FROM attendance WHERE tenant_id = $1 AND date = $2 AND status = $3', [req.tenantId, today, 'Present']);

  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>Dashboard - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1400px;margin:40px auto;padding:0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px;margin-bottom:40px}.stat-card{background:white;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.stat-value{font-size:36px;font-weight:800;color:${s.primary_color};margin:12px 0}.stat-label{color:#64748b;font-size:14px}.menu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.menu-item{background:white;padding:24px;border-radius:12px;text-align:center;text-decoration:none;color:#1e293b;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.menu-item:hover{transform:translateY(-4px)}.menu-icon{font-size:3rem;margin-bottom:12px}.coming-soon{opacity:0.5;cursor:not-allowed}.badge{background:#fbbf24;color:#92400e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><div><a href="/app">Dashboard</a><a href="/comments">Comments</a><a href="/feedback">Feedback</a><a href="/logout" style="float:right">Logout</a></div></nav>// === DASHBOARD CONTINUED ===
  <div class="container">
  <h1 style="color:${s.primary_color};margin-bottom:8px">Dashboard</h1>
  <p style="color:#64748b;margin-bottom:32px">Welcome back, ${req.session.user.email.split('@')[0]}!</p>

  <div class="grid">
  <div class="stat-card">
    <div class="stat-label">Total Students</div>
    <div class="stat-value">${students.rows[0].count}</div>
    <a href="/app/students" style="color:${s.primary_color};font-weight:600;text-decoration:none">Manage →</a>
  </div>
  <div class="stat-card">
    <div class="stat-label">Fees Due</div>
    <div class="stat-value" style="color:#dc2626">UGX ${parseFloat(fees.rows[0].due || 0).toLocaleString()}</div>
    <a href="/app/fees" style="color:${s.primary_color};font-weight:600;text-decoration:none">Collect →</a>
  </div>
  <div class="stat-card">
    <div class="stat-label">Present Today</div>
    <div class="stat-value" style="color:#10b981">${attendance.rows[0].present}</div>
    <a href="/app/attendance" style="color:${s.primary_color};font-weight:600;text-decoration:none">Mark →</a>
  </div>
  </div>

  <h2 style="margin:40px 0 24px">Quick Access</h2>
  <div class="menu-grid">
  <a href="/app/students" class="menu-item"><div class="menu-icon">👨‍🎓</div><h3>Students</h3><p>Add & manage students</p></a>
  <a href="/app/fees" class="menu-item"><div class="menu-icon">💰</div><h3>Fees</h3><p>Track payments</p></a>
  <a href="/app/attendance" class="menu-item"><div class="menu-icon">✅</div><h3>Attendance</h3><p>Daily records</p></a>
  <a href="/app/grades" class="menu-item"><div class="menu-icon">📊</div><h3>Grades</h3><p>Enter scores</p></a>
  <a href="/news" class="menu-item"><div class="menu-icon">📰</div><h3>News</h3><p>Global updates</p></a>
  <a href="/learn" class="menu-item"><div class="menu-icon">📚</div><h3>Learn</h3><p>Free courses</p></a>
  <a href="/chat" class="menu-item"><div class="menu-icon">💬</div><h3>Chat</h3><p>Live chat rooms</p></a>
  <a href="/comments" class="menu-item"><div class="menu-icon">💭</div><h3>Comments</h3><p>Community</p></a>
  <div class="menu-item coming-soon"><div class="menu-icon">🛒</div><h3>Marketplace</h3><p>Sell items</p><span class="badge">${res.locals.t('coming_soon')}</span></div>
  <div class="menu-item coming-soon"><div class="menu-icon">💝</div><h3>Donations</h3><p>Raise funds</p><span class="badge">${res.locals.t('coming_soon')}</span></div>
  <div class="menu-item coming-soon"><div class="menu-icon">🎯</div><h3>Grants</h3><p>Apply for funding</p><span class="badge">${res.locals.t('coming_soon')}</span></div>
  <div class="menu-item coming-soon"><div class="menu-icon">📱</div><h3>WhatsApp Bot</h3><p>Parent alerts</p><span class="badge">${res.locals.t('coming_soon')}</span></div>
  </div>
  </div></body></html>`);
});

// === STUDENTS MANAGEMENT ===
app.get('/app/students', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const students = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY name', [req.tenantId]);
  res.send(`<!DOCTYPE html><html><head><title>Students - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px}.btn{background:${s.primary_color};color:white;padding:12px 24px;border:none;border-radius:8px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}th,td{padding:16px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:${s.primary_color};color:white;font-weight:700}.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center}.modal-content{background:white;padding:32px;border-radius:12px;max-width:500px;width:90%}input{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;margin:8px 0}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/app">Dashboard</a><a href="/app/students">Students</a><a href="/logout" style="float:right">Logout</a></nav>
  <div class="container">
  <div class="header">
  <h1>Students (${students.rows.length})</h1>
  <button class="btn" onclick="document.getElementById('addModal').style.display='flex'">+ Add Student</button>
  </div>
  <table>
  <thead><tr><th>Name</th><th>Class</th><th>Guardian</th><th>Phone</th><th>Balance</th><th>Actions</th></tr></thead>
  <tbody>
  ${students.rows.map(st => `<tr>
    <td><strong>${st.name}</strong></td>
    <td>${st.class || '-'}</td>
    <td>${st.guardian_name || '-'}</td>
    <td>${st.guardian_phone || '-'}</td>
    <td style="color:${st.balance > 0? '#dc2626' : '#10b981'};font-weight:600">UGX ${parseFloat(st.balance).toLocaleString()}</td>
    <td><a href="/app/students/${st.id}" style="color:${s.primary_color}">View</a></td>
  </tr>`).join('')}
  </tbody>
  </table>
  </div>
  <div id="addModal" class="modal">
  <div class="modal-content">
  <h2 style="margin-bottom:20px">Add New Student</h2>
  <form method="POST" action="/app/students/add">
  <input name="name" placeholder="Student Name *" required>
  <input name="class" placeholder="Class (e.g. P.5)">
  <input name="dob" type="date" placeholder="Date of Birth">
  <input name="guardian_name" placeholder="Guardian Name">
  <input name="guardian_phone" placeholder="Guardian Phone">
  <button type="submit" class="btn" style="width:100%;margin-top:16px">Add Student</button>
  <button type="button" onclick="document.getElementById('addModal').style.display='none'" style="width:100%;margin-top:8px;background:#64748b" class="btn">Cancel</button>
  </form>
  </div>
  </div></body></html>`);
});

app.post('/app/students/add', requireLogin, requireTenant, async (req, res) => {
  const { name, class: cls, dob, guardian_name, guardian_phone } = req.body;
  await pool.query('INSERT INTO students (tenant_id, name, class, dob, guardian_name, guardian_phone) VALUES ($1, $2, $3, $4, $5, $6)',
    [req.tenantId, name, cls, dob || null, guardian_name, guardian_phone]);
  res.redirect('/app/students');
});

// === FEES MANAGEMENT ===
app.get('/app/fees', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const fees = await pool.query(`SELECT f.*, s.name as student_name FROM fees f JOIN students s ON f.student_id = s.id WHERE f.tenant_id = $1 ORDER BY f.created_at DESC`, [req.tenantId]);
  const totalDue = fees.rows.reduce((sum, f) => sum + (f.amount - f.paid), 0);
  res.send(`<!DOCTYPE html><html><head><title>Fees - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1200px;margin:40px auto;padding:0 24px}.summary{background:white;padding:24px;border-radius:12px;margin-bottom:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}.summary h2{color:#dc2626;font-size:2.5rem;margin:12px 0}table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}th,td{padding:16px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:${s.primary_color};color:white}.btn{background:${s.primary_color};color:white;padding:10px 20px;border:none;border-radius:6px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/app">Dashboard</a><a href="/app/fees">Fees</a><a href="/logout" style="float:right">Logout</a></nav>
  <div class="container">
  <h1>Fee Management</h1>
  <div class="summary">
  <div style="color:#64748b">Total Outstanding</div>
  <h2>UGX ${totalDue.toLocaleString()}</h2>
  <a href="/app/fees/add" class="btn">+ Record Payment</a>
  </div>
  <table>
  <thead><tr><th>Student</th><th>Term</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Action</th></tr></thead>
  <tbody>
  ${fees.rows.map(f => {
    const balance = f.amount - f.paid;
    return `<tr>
      <td><strong>${f.student_name}</strong></td>
      <td>${f.term} ${f.year}</td>
      <td>UGX ${parseFloat(f.amount).toLocaleString()}</td>
      <td style="color:#10b981">UGX ${parseFloat(f.paid).toLocaleString()}</td>
      <td style="color:${balance > 0? '#dc2626' : '#10b981'};font-weight:700">UGX ${balance.toLocaleString()}</td>
      <td>${balance > 0? `<a href="/app/fees/pay/${f.id}" class="btn" style="padding:8px 16px;font-size:14px">Pay</a>` : '<span style="color:#10b981">✓ Paid</span>'}</td>
    </tr>`;
  }).join('')}
  </tbody>
  </table>
  </div></body></html>`);
});

// === ATTENDANCE ===
app.get('/app/attendance', requireLogin, requireTenant, async (req, res) => {
  const s = await getSettings(req.tenantId);
  const today = new Date().toISOString().split('T')[0];
  const students = await pool.query('SELECT s.*, COALESCE(a.status, \'Absent\') as status FROM students s LEFT JOIN attendance a ON s.id = a.student_id AND a.date = $1 WHERE s.tenant_id = $2 ORDER BY s.name', [today, req.tenantId]);
  res.send(`<!DOCTYPE html><html><head><title>Attendance - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f8fafc}nav{background:${s.primary_color};color:white;padding:16px 24px}nav a{color:white;margin:0 12px;text-decoration:none}.container{max-width:1000px;margin:40px auto;padding:0 24px}.date-header{background:white;padding:24px;border-radius:12px;margin-bottom:24px;text-align:center}table{width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)}th,td{padding:16px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:${s.primary_color};color:white}.btn{padding:8px 16px;border:none;border-radius:6px;font-weight:600;cursor:pointer;margin:0 4px}.present{background:#10b981;color:white}.absent{background:#dc2626;color:white}.late{background:#f59e0b;color:white}</style>
  </head><body>
  <nav><strong>${s.site_name}</strong><a href="/app">Dashboard</a><a href="/app/attendance">Attendance</a><a href="/logout" style="float:right">Logout</a></nav>
  <div class="container">
  <div class="date-header">
  <h1>Attendance - ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h1>
  <p style="color:#64748b;margin-top:8px">Mark students present, absent, or late</p>
  </div>
  <table>
  <thead><tr><th>Student</th><th>Class</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody>
  ${students.rows.map(st => `<tr>
    <td><strong>${st.name}</strong></td>
    <td>${st.class || '-'}</td>
    <td><span style="padding:6px 12px;border-radius:20px;background:${st.status === 'Present'? '#10b981' : st.status === 'Late'? '#f59e0b' : '#dc2626'};color:white;font-weight:600">${st.status}</span></td>
    <td>
      <form method="POST" action="/app/attendance/mark" style="display:inline">
      <input type="hidden" name="student_id" value="${st.id}">
      <input type="hidden" name="status" value="Present">
      <button type="submit" class="btn present">Present</button>
      </form>
      <form method="POST" action="/app/attendance/mark" style="display:inline">
      <input type="hidden" name="student_id" value="${st.id}">
      <input type="hidden" name="status" value="Late">
      <button type="submit" class="btn late">Late</button>
      </form>
      <form method="POST" action="/app/attendance/mark" style="display:inline">
      <input type="hidden" name="student_id" value="${st.id}">
      <input type="hidden" name="status" value="Absent">
      <button type="submit" class="btn absent">Absent</button>
      </form>
    </td>
  </tr>`).join('')}
  </tbody>
  </table>
  </div></body></html>`);
});

app.post('/app/attendance/mark', requireLogin, requireTenant, async (req, res) => {
  const { student_id, status } = req.body;
  const today = new Date().toISOString().split('T')[0];
  await pool.query(`INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, student_id, date) DO UPDATE SET status = $4`,
    [req.tenantId, student_id, today, status]);
  res.redirect('/app/attendance');
});

// === SUPER ADMIN PANEL ===
app.get('/super-admin', requireLogin, requireSuperAdmin, async (req, res) => {
  const stats = await pool.query(`SELECT (SELECT COUNT(*) FROM tenants WHERE id!= 1) as sites, (SELECT COUNT(*) FROM users WHERE tenant_id!= 1) as users, (SELECT COUNT(*) FROM students) as students, (SELECT COALESCE(SUM(commission), 0) FROM revenue_log) as revenue`);
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Super Admin - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#e2e8f0}nav{background:#1e293b;padding:16px 24px;border-bottom:1px solid #334155}nav a{color:#e2e8f0;margin:0 12px;text-decoration:none}.container{max-width:1400px;margin:40px auto;padding:0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px;margin-bottom:40px}.stat-card{background:#1e293b;padding:24px;border-radius:12px;border:1px solid #334155}.stat-value{font-size:36px;font-weight:800;color:#3b82f6;margin:12px 0}.stat-label{color:#94a3b8;font-size:14px}.menu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.menu-card{background:#1e293b;padding:24px;border-radius:12px;border:1px solid #334155;text-decoration:none;color:#e2e8f0;transition:border-color 0.2s}.menu-card:hover{border-color:#3b82f6}.menu-icon{font-size:2.5rem;margin-bottom:12px}</style>
  </head><body>
  <nav><strong>${s.site_name} - Super Admin</strong><a href="/super-admin">Dashboard</a><a href="/logout" style="float:right">Logout</a></nav>
  <div class="container">
  <h1 style="margin-bottom:8px">Platform Control Panel</h1>
  <p style="color:#94a3b8;margin-bottom:32px">Welcome, Developer. You have unlimited access to all features.</p>
  <div class="grid">
  <div class="stat-card"><div class="stat-label">Total Sites</div><div class="stat-value">${stats.rows[0].sites}</div></div>
  <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value">${stats.rows[0].users}</div></div>
  <div class="stat-card"><div class="stat-label">Total Students</div><div class="stat-value">${stats.rows[0].students}</div></div>
  <div class="stat-card"><div class="stat-label">Platform Revenue</div><div class="stat-value">UGX ${parseFloat(stats.rows[0].revenue).toLocaleString()}</div></div>
  </div>
  <h2 style="margin:40px 0 24px">Admin Tools</h2>
  <div class="menu-grid">
  <a href="/super-admin/tenants" class="menu-card"><div class="menu-icon">🏫</div><h3>Manage Sites</h3><p>View, upgrade, suspend schools</p></a>
  <a href="/super-admin/users" class="menu-card"><div class="menu-icon">👥</div><h3>Manage Users</h3><p>Grant access, reset passwords</p></a>
  <a href="/super-admin/comments" class="menu-card"><div class="menu-icon">💭</div><h3>Moderate Comments</h3><p>Approve/reject user comments</p></a>
  <a href="/super-admin/feedback" class="menu-card"><div class="menu-icon">📧</div><h3>Feedback Inbox</h3><p>Reply to user questions</p></a>
  <a href="/super-admin/features" class="menu-card"><div class="menu-icon">⚙️</div><h3>Feature Control</h3><p>Enable/disable features, set Coming Soon</p></a>
  <a href="/super-admin/developer" class="menu-card"><div class="menu-icon">👨‍💻</div><h3>Developer Profile</h3><p>Edit your contact info</p></a>
  <a href="/super-admin/revenue" class="menu-card"><div class="menu-icon">💰</div><h3>Revenue Report</h3><p>View earnings breakdown</p></a>
  <a href="/super-admin/verify" class="menu-card"><div class="menu-icon">✅</div><h3>Verifications</h3><p>Approve school KYC</p></a>
  </div>
  </div></body></html>`);
});

// === FEATURE CONTROL PANEL ===
app.get('/super-admin/features', requireLogin, requireSuperAdmin, async (req, res) => {
  const s = await getSettings(1);
  const overrides = s.feature_overrides || {};
  res.send(`<!DOCTYPE html><html><head><title>Feature Control</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:40px}nav{background:#1e293b;padding:16px;margin:-40px -40px 40px}nav a{color:#e2e8f0;margin:0 12px;text-decoration:none}.container{max-width:1000px;margin:0 auto}.feature{background:#1e293b;padding:20px;border-radius:12px;margin-bottom:16px;border:1px solid #334155;display:flex;justify-content:space-between;align-items:center}.feature-info h3{margin-bottom:8px}.feature-info p{color:#94a3b8;font-size:14px}select{padding:10px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-weight:600}button{background:#3b82f6;color:white;padding:12px 32px;border:none;border-radius:8px;font-weight:700;cursor:pointer;margin-top:24px}</style>
  </head><body>
  <nav><a href="/super-admin">← Dashboard</a></nav>
  <div class="container">
  <h1>Feature Control Panel</h1>
  <p style="color:#94a3b8;margin-bottom:32px">Enable, disable, or set features to "Coming Soon". Changes apply instantly to all users.</p>
  <form method="POST" action="/super-admin/features/save">
  ${Object.entries(FEATURES).map(([key, f]) => `
    <div class="feature">
    <div class="feature-info">
      <h3>${f.name}</h3>
      <p>Tier: ${f.tier.toUpperCase()} | Current: ${overrides[key] || f.status}</p>
    </div>
    <select name="${key}">
      <option value="enabled" ${(overrides[key] || f.status) === 'enabled'? 'selected' : ''}>✅ Enabled</option>
      <option value="coming_soon" ${(overrides[key] || f.status) === 'coming_soon'? 'selected' : ''}>🚧 Coming Soon</option>
      <option value="disabled" ${(overrides[key] || f.status) === 'disabled'? 'selected' : ''}>❌ Disabled</option>
    </select>
    </div>
  `).join('')}
  <button type="submit">Save Feature Settings</button>
  </form>
  </div></body></html>`);
});

app.post('/super-admin/features/save', requireLogin, requireSuperAdmin, async (req, res) => {
  await pool.query('UPDATE settings SET feature_overrides = $1 WHERE tenant_id = 1', [JSON.stringify(req.body)]);
  res.redirect('/super-admin/features?saved=1');
});

// === ABOUT DEVELOPER PAGE ===
app.get('/about-developer', async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html lang="${req.lang}"><head><title>About Developer - ${s.site_name}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,#1e40af 0%,#1e3a8a 100%);min-height:100vh;padding:40px 20px}.card{background:white;padding:60px;border-radius:20px;max-width:800px;margin:0 auto;box-shadow:0 20px 60px rgba(0,0,0,0.3)}h1{color:${s.primary_color};font-size:3rem;margin-bottom:16px}.bio{font-size:1.2rem;color:#64748b;line-height:1.8;margin:24px 0}.contact{background:#f8fafc;padding:24px;border-radius:12px;margin:32px 0}.contact-item{margin:12px 0;font-size:1.1rem}.contact-item strong{color:${s.primary_color}}.btn{display:inline-block;padding:16px 32px;background:${s.primary_color};color:white;text-decoration:none;border-radius:8px;font-weight:700;margin:8px}</style>
  </head><body>
  <div class="card">
  <h1>${s.developer_name}</h1>
  <p class="bio">${s.developer_bio}</p>
  <div class="contact">
  <h3 style="color:${s.primary_color};margin-bottom:16px">Contact Developer</h3>
  <div class="contact-item"><strong>WhatsApp:</strong> ${s.developer_whatsapp}</div>
  <div class="contact-item"><strong>Email:</strong> ${s.developer_email}</div>
  <div class="contact-item"><strong>Location:</strong> ${s.location}</div>
  </div>
  <a href="https://wa.me/${s.developer_whatsapp.replace(/[^0-9]/g, '')}" class="btn">💬 WhatsApp Me</a>
  <a href="mailto:${s.developer_email}" class="btn">📧 Email Me</a>
  <p style="margin-top:40px;text-align:center;color:#94a3b8;font-size:14px">Powering ${await pool.query('SELECT COUNT(*) FROM tenants').then(r => r.rows[0].count)} websites across Africa</p>
  </div></body></html>`);
});

// === DEVELOPER PROFILE EDITOR ===
app.get('/super-admin/developer', requireLogin, requireSuperAdmin, async (req, res) => {
  const s = await getSettings(1);
  res.send(`<!DOCTYPE html><html><head><title>Edit Developer Profile</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:40px}nav{background:#1e293b;padding:16px;margin:-40px -40px 40px}nav a{color:#e2e8f0;margin:0 12px;text-decoration:none}.container{max-width:800px;margin:0 auto}.card{background:#1e293b;padding:32px;border-radius:12px;border:1px solid #334155}input,textarea{width:100%;padding:12px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#e2e8f0;margin:8px 0;font-size:16px}button{background:#3b82f6;color:white;padding:14px 32px;border:none;border-radius:8px;font-weight:700;cursor:pointer;width:100%;margin-top:20px}label{display:block;margin-top:16px;font-weight:600}</style>
  </head><body>
  <nav><a href="/super-admin">← Back to Dashboard</a></nav>
  <div class="container">
  <h1>Edit Developer Profile</h1>
  <p style="color:#94a3b8;margin-bottom:32px">This information appears on /about-developer and all public footers</p>
  <div class="card">
  <form method="POST" action="/super-admin/developer/save">
  <label>Developer/Company Name</label><input name="developer_name" value="${s.developer_name}" required>
  <label>Bio / Description</label><textarea name="developer_bio" rows="4" required>${s.developer_bio}</textarea>
  <label>WhatsApp Number</label><input name="developer_whatsapp" value="${s.developer_whatsapp}" required>
  <label>Email Address</label><input name="developer_email" type="email" value="${s.developer_email}" required>
  <label>Location</label><input name="location" value="${s.location}">
  <button type="submit">Save Developer Profile</button>
  </form>
  </div>
  </div></body></html>`);
});

app.post('/super-admin/developer/save', requireLogin, requireSuperAdmin, async (req, res) => {
  const { developer_name, developer_bio, developer_whatsapp, developer_email, location } = req.body;
  await pool.query(`UPDATE settings SET developer_name = $1, developer_bio = $2, developer_whatsapp = $3, developer_email = $4, location = $5 WHERE tenant_id = 1`,
    [developer_name, developer_bio, developer_whatsapp, developer_email, location]);
  res.redirect('/super-admin/developer?saved=1');
});

// === SOCKET.IO CHAT ===
io.on('connection', (socket) => {
  socket.on('join_room', (room) => {
    socket.join(room);
    socket.to(room).emit('user_joined', { msg: 'A user joined' });
  });
  socket.on('send_message', async (data) => {
    const { room, message, user_name } = data;
    await pool.query('INSERT INTO chat_messages (room, user_name, message) VALUES ($1, $2, $3)', [room, user_name, message]);
    io.to(room).emit('new_message', { user_name, message, time: new Date().toLocaleTimeString() });
  });
});

// === AUTO UPDATE RANKINGS DAILY ===
cron.schedule('0 2 *', updateRankings);

// === START SERVER ===
initDB().then(() => {
  server.listen(PORT, () => console.log(`🚀 SSEWASSWA FOUNDATION v5.1 FREE LAUNCH running on port ${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
