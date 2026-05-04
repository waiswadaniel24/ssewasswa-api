const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const Parser = require('rss-parser');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'? { rejectUnauthorized: false } : false
});

const parser = new Parser();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-free-launch-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const FEATURES = {
  news: true, learn: true, kids: true, entertainment: true, ranking: true,
  comments: true, feedback: true, chat: true, donations: true, grants: true,
  whatsapp_bot: true, sms_alerts: true, api_access: true, surveys: true,
  advertising: true, marketplace: true, ecommerce: true, wallet: true,
  school_management: true, fees: true, attendance: true, grades: true
};

const LANGUAGES = { en: 'English', lg: 'Luganda', sw: 'Swahili', ar: 'Arabic' };

const TRANSLATIONS = {
  welcome: {
    en: 'Welcome to SSEWASSWA FOUNDATION UGANDA',
    lg: 'Tukwaniriza ku SSEWASSWA FOUNDATION UGANDA',
    sw: 'Karibu SSEWASSWA FOUNDATION UGANDA',
    ar: 'مرحبا بكم في مؤسسة سيسواسوا أوغندا'
  },
  login: { en: 'Login', lg: 'Yingira', sw: 'Ingia', ar: 'تسجيل الدخول' },
  logout: { en: 'Logout', lg: 'Fuluma', sw: 'Toka', ar: 'تسجيل خروج' },
  dashboard: { en: 'Dashboard', lg: 'Olubalaza', sw: 'Dashibodi', ar: 'لوحة القيادة' },
  students: { en: 'Students', lg: 'Abayizi', sw: 'Wanafunzi', ar: 'الطلاب' },
  fees: { en: 'Fees', lg: 'Ebisale', sw: 'Ada', ar: 'الرسوم' },
  attendance: { en: 'Attendance', lg: 'Okubeerawo', sw: 'Mahudhurio', ar: 'الحضور' },
  marketplace: { en: 'Marketplace', lg: 'Akatale', sw: 'Soko', ar: 'السوق' },
  buy_now: { en: 'Buy Now', lg: 'Gula Kati', sw: 'Nunua Sasa', ar: 'اشتري الآن' },
  add_to_cart: { en: 'Add to Cart', lg: 'Teeka mu kkaadi', sw: 'Ongeza kwenye Rukwama', ar: 'أضف إلى السلة' }
};

const t = (key, lang = 'en') => TRANSLATIONS[key]?.[lang] || TRANSLATIONS[key]?.en || key;

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role!== role && req.session.user.role!== 'super_admin') {
    return res.status(403).send('Forbidden: Insufficient permissions');
  }
  next();
};

const requireTenant = async (req, res, next) => {
  try {
    const host = req.headers.host || '';
    const subdomain = host.split('.')[0];
    const tenantQuery = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [subdomain === 'localhost' || host.includes('onrender')? 'main' : subdomain]);

    if (!tenantQuery.rows[0]) {
      const mainTenant = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', ['main']);
      if (!mainTenant.rows[0]) return res.status(404).send('School not found');
      req.tenant = mainTenant.rows[0];
    } else {
      req.tenant = tenantQuery.rows[0];
    }
    next();
  } catch (e) {
    console.error('Tenant middleware error:', e);
    res.status(500).send('Server error');
  }
};

const requireFeature = (feature) => (req, res, next) => {
  if (!FEATURES[feature]) return res.status(403).send(`Feature ${feature} is disabled`);
  next();
};

async function initDB() {
  console.log('Starting database initialization v5.1...');

  try {
    await pool.query(`CREATE TABLE db_init_lock (locked BOOLEAN DEFAULT true)`);
    console.log('Acquired DB init lock. Cleaning database...');
  } catch (e) {
    if (e.code === '42P07') {
      console.log('Lock exists from previous run. Forcing clean reset...');
      await pool.query('DROP TABLE IF EXISTS db_init_lock CASCADE');
      await pool.query(`CREATE TABLE db_init_lock (locked BOOLEAN DEFAULT true)`);
    } else {
      throw e;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tables = ['settings', 'courses', 'chat_messages', 'news_cache', 'feedback_messages', 'feedback_threads', 'comments', 'grants', 'donor_campaigns', 'donations', 'surveys', 'wallets', 'cart_items', 'order_items', 'orders', 'market_items', 'grades', 'attendance', 'fees', 'students', 'users', 'revenue_log', 'tenants'];

    for (const table of tables) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    console.log('Old tables dropped. Creating fresh schema...');

    await client.query(`CREATE TABLE tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT 'free', plan_expires DATE, ranking_score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT, role TEXT DEFAULT 'staff', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE market_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, seller_email TEXT, status TEXT DEFAULT 'pending', image_url TEXT, stock INTEGER DEFAULT 1, category TEXT DEFAULT 'general', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE cart_items (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, item_id INTEGER REFERENCES market_items(id) ON DELETE CASCADE, quantity INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_email, item_id))`);
    await client.query(`CREATE TABLE orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, total_amount NUMERIC NOT NULL, status TEXT DEFAULT 'pending', payment_method TEXT, momo_number TEXT, delivery_address TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, item_id INTEGER REFERENCES market_items(id), quantity INTEGER, price NUMERIC, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(tenant_id, user_email))`);
    await client.query(`CREATE TABLE surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, creator_email TEXT, title TEXT NOT NULL, questions JSONB, reward_per_user NUMERIC DEFAULT 0, total_budget NUMERIC DEFAULT 0, max_responses INTEGER DEFAULT 100, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, amount NUMERIC NOT NULL, message TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE donor_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, goal_amount NUMERIC NOT NULL, raised_amount NUMERIC DEFAULT 0, image_url TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE grants (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, amount NUMERIC, deadline DATE, requirements TEXT, active BOOLEAN DEFAULT true, source_url TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE comments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, user_name TEXT, comment_text TEXT NOT NULL, topic TEXT DEFAULT 'general', parent_id INTEGER, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE feedback_threads (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, user_name TEXT, subject TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE feedback_messages (id SERIAL PRIMARY KEY, thread_id INTEGER REFERENCES feedback_threads(id) ON DELETE CASCADE, sender_type TEXT NOT NULL, sender_email TEXT, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE news_cache (id SERIAL PRIMARY KEY, title TEXT, link TEXT UNIQUE, snippet TEXT, pub_date TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE chat_messages (id SERIAL PRIMARY KEY, room TEXT, user_name TEXT, message TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE courses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, video_url TEXT, category TEXT, level TEXT DEFAULT 'beginner', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, site_name TEXT DEFAULT 'SSEWASSWA FOUNDATION UGANDA', hero_title TEXT, hero_subtitle TEXT, whatsapp_number TEXT DEFAULT '0789736737', momo_number TEXT DEFAULT '0705373465', momo_names TEXT DEFAULT 'WASSWA', contact_email TEXT DEFAULT 'waiswadaniel24@gmail.com', location TEXT DEFAULT 'Kampala, Uganda', primary_color TEXT DEFAULT '#1e40af', org_type TEXT DEFAULT 'platform', verified BOOLEAN DEFAULT false, public_profile BOOLEAN DEFAULT true, subscription_tier TEXT DEFAULT 'free', developer_name TEXT DEFAULT 'SSEWASSWA Foundation', developer_bio TEXT DEFAULT 'Building digital infrastructure for African education', developer_whatsapp TEXT DEFAULT '0789736737', developer_email TEXT DEFAULT 'waiswadaniel24@gmail.com', feature_overrides JSONB DEFAULT '{}')`);

    console.log('Tables created. Adding indexes...');
    await client.query(`CREATE UNIQUE INDEX attendance_unique ON attendance (tenant_id, student_id, date)`);
    await client.query(`CREATE UNIQUE INDEX wallets_tenant_user_unique ON wallets (tenant_id, user_email)`);
    await client.query(`CREATE UNIQUE INDEX settings_tenant_unique ON settings (tenant_id)`);
    await client.query(`CREATE INDEX cart_user_idx ON cart_items (user_email)`);
    await client.query(`CREATE INDEX orders_user_idx ON orders (user_email)`);
    await client.query(`CREATE INDEX market_items_tenant_idx ON market_items (tenant_id, status)`);

    console.log('Indexes created. Seeding data...');
    const tenant = await client.query(`INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`, ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise']);
    const tenantId = tenant.rows[0].id;

    const hashedPass = await bcrypt.hash('admin123', 10);
    await client.query(`INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`, [tenantId, 'waiswadaniel24@gmail.com', hashedPass, 'super_admin']);
    await client.query(`INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_email) DO NOTHING`, [tenantId, 'waiswadaniel24@gmail.com', 0]);
    await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 'enterprise', true]);
    await client.query(`INSERT INTO courses (tenant_id, title, description, video_url, category) VALUES ($1, 'Introduction to Computers', 'Learn computer basics for African students', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'technology') ON CONFLICT DO NOTHING`, [tenantId]);
    await client.query(`INSERT INTO courses (tenant_id, title, description, video_url, category) VALUES ($1, 'English for Beginners', 'Basic English lessons', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'language') ON CONFLICT DO NOTHING`, [tenantId]);
    await client.query(`INSERT INTO market_items (tenant_id, title, description, price, seller_email, status, image_url, stock, category) VALUES ($1, 'School Uniform Set', 'Complete uniform for primary students - shirt, trousers, sweater', 50000, 'waiswadaniel24@gmail.com', 'approved', 'https://via.placeholder.com/300x300?text=Uniform', 100, 'uniform') ON CONFLICT DO NOTHING`, [tenantId]);
    await client.query(`INSERT INTO market_items (tenant_id, title, description, price, seller_email, status, image_url, stock, category) VALUES ($1, 'Exercise Books Pack', '10 exercise books - 96 pages each', 15000, 'waiswadaniel24@gmail.com', 'approved', 'https://via.placeholder.com/300x300?text=Books', 200, 'stationery') ON CONFLICT DO NOTHING`, [tenantId]);
    await client.query(`INSERT INTO market_items (tenant_id, title, description, price, seller_email, status, image_url, stock, category) VALUES ($1, 'School Bag', 'Durable backpack for students', 35000, 'waiswadaniel24@gmail.com', 'approved', 'https://via.placeholder.com/300x300?text=Bag', 50, 'accessories') ON CONFLICT DO NOTHING`, [tenantId]);

    await client.query('COMMIT');
    console.log('Database initialization v5.1 complete! ✅');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database init failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

const renderPage = (title, content, req) => {
  const lang = req.session?.lang || 'en';
  const user = req.session?.user;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - SSEWASSWA FOUNDATION</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; }
   .header { background: #1e40af; color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
   .header a { color: white; text-decoration: none; margin: 0 10px; }
   .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
   .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 1rem; }
   .btn { background: #1e40af; color: white; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
   .btn:hover { background: #1e3a8a; }
   .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; }
   .item-card img { width: 100%; height: 200px; object-fit: cover; border-radius: 4px; }
    input, select, textarea { width: 100%; padding: 0.5rem; margin: 0.5rem 0; border: 1px solid #ddd; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #ddd; }
   .lang-switch { display: flex; gap: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <div><strong>SSEWASSWA FOUNDATION UGANDA</strong></div>
    <nav>
      <a href="/">Home</a>
      <a href="/marketplace">Marketplace</a>
      <a href="/news">News</a>
      <a href="/learn">Learn</a>
      ${user? `<a href="/app">Dashboard</a><a href="/logout">${t('logout', lang)}</a>` : `<a href="/login">${t('login', lang)}</a>`}
      <span class="lang-switch">
        <a href="/set-lang/en">EN</a>
        <a href="/set-lang/lg">LG</a>
        <a href="/set-lang/sw">SW</a>
      </span>
    </nav>
  </div>
  <div class="container">${content}</div>
  <script src="/socket.io/socket.io.js"></script>
</body>
</html>`;
};

app.get('/', requireTenant, async (req, res) => {
  const lang = req.session.lang || 'en';
  const content = `<div class="card"><h1>${t('welcome', lang)}</h1><p>Empowering African Education Through Technology</p><br><a href="/marketplace" class="btn">Shop School Supplies</a><a href="/login" class="btn">School Login</a><a href="/create-site" class="btn">Create Free School Site</a></div><div class="grid"><div class="card"><h3>📚 E-Learning</h3><p>Access courses</p><a href="/learn">Explore</a></div><div class="card"><h3>📰 News</h3><p>Education news</p><a href="/news">Read</a></div><div class="card"><h3>💬 Community</h3><p>Join discussions</p><a href="/comments">Join</a></div><div class="card"><h3>🏆 Rankings</h3><p>Top schools</p><a href="/ranking">View</a></div></div>`;
  res.send(renderPage('Home', content, req));
});

app.get('/news', requireFeature('news'), async (req, res) => {
  try {
    const feed = await parser.parseURL('https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml');
    const items = feed.items.slice(0, 10);
    const content = `<div class="card"><h1>Education News</h1></div>${items.map(item => `<div class="card"><h3>${item.title}</h3><p>${item.contentSnippet}</p><small>${new Date(item.pubDate).toLocaleDateString()}</small><br><a href="${item.link}" target="_blank">Read More</a></div>`).join('')}`;
    res.send(renderPage('News', content, req));
  } catch (e) {
    res.send(renderPage('News', '<div class="card">News temporarily unavailable</div>', req));
  }
});

app.get('/learn', requireFeature('learn'), requireTenant, async (req, res) => {
  const courses = await pool.query('SELECT * FROM courses WHERE tenant_id = $1', [req.tenant.id]);
  const content = `<div class="card"><h1>E-Learning Courses</h1></div><div class="grid">${courses.rows.map(course => `<div class="card"><h3>${course.title}</h3><p>${course.description}</p><p><strong>Level:</strong> ${course.level} | <strong>Category:</strong> ${course.category}</p><a href="${course.video_url}" target="_blank" class="btn">Watch Course</a></div>`).join('')}</div>`;
  res.send(renderPage('Learn', content, req));
});

app.get('/kids', requireFeature('kids'), (req, res) => {
  res.send(renderPage('Kids', '<div class="card"><h1>Kids Zone</h1><p>Educational games and activities for children</p></div>', req));
});

app.get('/entertainment', requireFeature('entertainment'), (req, res) => {
  res.send(renderPage('Entertainment', '<div class="card"><h1>Entertainment Hub</h1><p>Stories, music, and videos for students</p></div>', req));
});

app.get('/ranking', requireFeature('ranking'), async (req, res) => {
  const schools = await pool.query('SELECT * FROM tenants WHERE public_profile = true ORDER BY ranking_score DESC LIMIT 20');
  const content = `<div class="card"><h1>School Rankings</h1></div><div class="card"><table><tr><th>Rank</th><th>School</th><th>Score</th></tr>${schools.rows.map((s, i) => `<tr><td>${i+1}</td><td>${s.name}</td><td>${s.ranking_score}</td></tr>`).join('')}</table></div>`;
  res.send(renderPage('Rankings', content, req));
});

app.get('/comments', requireFeature('comments'), async (req, res) => {
  const comments = await pool.query('SELECT * FROM comments WHERE status = $1 ORDER BY created_at DESC LIMIT 50', ['approved']);
  const content = `<div class="card"><h1>Community Forum</h1><form method="POST" action="/comments/post"><input name="user_name" placeholder="Your Name" required><textarea name="comment_text" placeholder="Share your thoughts..." required></textarea><input name="topic" placeholder="Topic (optional)" value="general"><button class="btn">Post Comment</button></form></div>${comments.rows.map(c => `<div class="card"><strong>${c.user_name}</strong> <small>${new Date(c.created_at).toLocaleString()}</small><p>${c.comment_text}</p><small>Topic: ${c.topic}</small></div>`).join('')}`;
  res.send(renderPage('Comments', content, req));
});

app.post('/comments/post', requireFeature('comments'), requireTenant, async (req, res) => {
  const { user_name, comment_text, topic } = req.body;
  await pool.query('INSERT INTO comments (tenant_id, user_name, comment_text, topic, status) VALUES ($1, $2, $3, $4, $5)', [req.tenant.id, user_name, comment_text, topic || 'general', 'approved']);
  res.redirect('/comments');
});

app.get('/feedback', requireFeature('feedback'), (req, res) => {
  const content = `<div class="card"><h1>Feedback & Support</h1><form method="POST" action="/feedback/submit"><input name="user_name" placeholder="Your Name" required><input name="user_email" type="email" placeholder="Your Email" required><input name="subject" placeholder="Subject" required><textarea name="message" placeholder="Your message..." required rows="5"></textarea><button class="btn">Send Feedback</button></form></div>`;
  res.send(renderPage('Feedback', content, req));
});

app.post('/feedback/submit', requireFeature('feedback'), requireTenant, async (req, res) => {
  const { user_email, user_name, subject, message } = req.body;
  const thread = await pool.query('INSERT INTO feedback_threads (tenant_id, user_email, user_name, subject) VALUES ($1, $2, $3, $4) RETURNING id', [req.tenant.id, user_email, user_name, subject]);
  await pool.query('INSERT INTO feedback_messages (thread_id, sender_type, sender_email, message) VALUES ($1, $2, $3, $4)', [thread.rows[0].id, 'user', user_email, message]);
  res.send(renderPage('Feedback', '<div class="card"><h1>Thank You!</h1><p>Your feedback has been submitted. We will respond soon.</p></div>', req));
});

app.get('/chat', requireFeature('chat'), (req, res) => {
  const content = `<div class="card"><h1>Live Chat Room</h1></div><div class="card"><div id="messages" style="height: 300px; overflow-y: auto; border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem;"></div><input id="username" placeholder="Your Name" style="width: 30%;"><input id="message" placeholder="Type message..." style="width: 50%;"><button onclick="sendMessage()" class="btn">Send</button></div><script>const socket = io(); const room = 'general'; socket.emit('join_room', room); socket.on('new_message', (data) => { document.getElementById('messages').innerHTML += '<p><strong>' + data.user_name + ':</strong> ' + data.message + ' <small>' + data.time + '</small></p>'; }); function sendMessage() { const user_name = document.getElementById('username').value || 'Anonymous'; const message = document.getElementById('message').value; if (message) { socket.emit('send_message', { room, user_name, message }); document.getElementById('message').value = ''; } }</script>`;
  res.send(renderPage('Chat', content, req));
});

app.get('/marketplace', requireFeature('marketplace'), requireTenant, async (req, res) => {
  const items = await pool.query('SELECT * FROM market_items WHERE status = $1 AND tenant_id = $2 ORDER BY created_at DESC', ['approved', req.tenant.id]);
  const content = `<div class="card"><h1>School Marketplace</h1><p>Buy uniforms, books, and school supplies</p></div><div class="grid">${items.rows.map(item => `<div class="card item-card"><img src="${item.image_url}" alt="${item.title}"><h3>${item.title}</h3><p>${item.description}</p><p><strong>UGX ${item.price.toLocaleString()}</strong></p><p>Stock: ${item.stock}</p><form method="POST" action="/marketplace/cart/add" style="display:inline;"><input type="hidden" name="item_id" value="${item.id}"><input type="number" name="quantity" value="1" min="1" max="${item.stock}" style="width:60px;"><button class="btn">${t('add_to_cart', req.session.lang)}</button></form></div>`).join('')}</div><div class="card"><a href="/marketplace/cart" class="btn">View Cart</a></div>`;
  res.send(renderPage('Marketplace', content, req));
});

app.post('/marketplace/cart/add', requireAuth, async (req, res) => {
  const { item_id, quantity } = req.body;
  await pool.query(`INSERT INTO cart_items (user_email, item_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (user_email, item_id) DO UPDATE SET quantity = cart_items.quantity + $3`, [req.session.user.email, item_id, quantity || 1]);
  res.redirect('/marketplace/cart');
});

app.get('/marketplace/cart', requireAuth, async (req, res) => {
  const cart = await pool.query(`SELECT c.id, c.quantity, m.title, m.price, m.image_url, m.id as item_id FROM cart_items c JOIN market_items m ON c.item_id = m.id WHERE c.user_email = $1`, [req.session.user.email]);
  const total = cart.rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const content = `<div class="card"><h1>Your Shopping Cart</h1></div>${cart.rows.length === 0? '<div class="card">Your cart is empty</div>' : `<div class="card"><table><tr><th>Item</th><th>Price</th><th>Quantity</th><th>Subtotal</th></tr>${cart.rows.map(item => `<tr><td>${item.title}</td><td>UGX ${item.price.toLocaleString()}</td><td>${item.quantity}</td><td>UGX ${(item.price * item.quantity).toLocaleString()}</td></tr>`).join('')}<tr><td colspan="3"><strong>Total</strong></td><td><strong>UGX ${total.toLocaleString()}</strong></td></tr></table><br><form method="POST" action="/marketplace/checkout"><select name="payment_method" required><option value="">Select Payment Method</option><option value="momo">Mobile Money</option><option value="cash">Cash on Delivery</option></select><input name="momo_number" placeholder="MTN/Airtel Number (if Mobile Money)"><input name="delivery_address" placeholder="Delivery Address" required><button class="btn">Checkout - UGX ${total.toLocaleString()}</button></form></div>`}<div class="card"><a href="/marketplace">Continue Shopping</a></div>`;
  res.send(renderPage('Cart', content, req));
});

app.post('/marketplace/checkout', requireAuth, requireTenant, async (req, res) => {
  const { payment_method, momo_number, delivery_address } = req.body;
  const cart = await pool.query('SELECT c.*, m.price FROM cart_items c JOIN market_items m ON c.item_id = m.id WHERE c.user_email = $1', [req.session.user.email]);

  if (cart.rows.length === 0) {
    return res.send(renderPage('Checkout', '<div class="card"><h1>Cart Empty</h1><p>Your cart is empty. <a href="/marketplace">Continue Shopping</a></p></div>', req));
  }

  const total = cart.rows.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query(`INSERT INTO orders (tenant_id, user_email, total_amount, payment_method, momo_number, delivery_address, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [req.tenant.id, req.session.user.email, total, payment_method, momo_number, delivery_address, payment_method === 'cash'? 'pending' : 'paid']);
    for (const item of cart.rows) {
      await client.query(`INSERT INTO order_items (order_id, item_id, quantity, price) VALUES ($1, $2, $3, $4)`, [order.rows[0].id, item.item_id, item.quantity, item.price]);
      await client.query('UPDATE market_items SET stock = stock - $1 WHERE id = $2', [item.quantity, item.item_id]);
    }
    await client.query('DELETE FROM cart_items WHERE user_email = $1', [req.session.user.email]);
    await client.query(`INSERT INTO revenue_log (type, gross_amount, commission, tenant_id, description) VALUES ($1, $2, $3, $4, $5)`, ['marketplace', total, total * 0.05, req.tenant.id, `Order #${order.rows[0].id}`]);
    await client.query('COMMIT');
    const content = `<div class="card"><h1>Order Successful! ✅</h1><p>Order ID: #${order.rows[0].id}</p><p>Total: UGX ${total.toLocaleString()}</p><p>Payment: ${payment_method === 'momo'? 'Mobile Money - ' + momo_number : 'Cash on Delivery'}</p><p>Delivery: ${delivery_address}</p><a href="/marketplace" class="btn">Continue Shopping</a><a href="/orders" class="btn">View Orders</a></div>`;
    res.send(renderPage('Order Success', content, req));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Checkout error:', e);
    res.status(500).send(renderPage('Error', '<div class="card"><h1>Checkout Failed</h1><p>Please try again.</p></div>', req));
  } finally {
    client.release();
  }
});

app.get('/orders', requireAuth, async (req, res) => {
  const orders = await pool.query('SELECT * FROM orders WHERE user_email = $1 ORDER BY created_at DESC', [req.session.user.email]);
  const content = `<div class="card"><h1>My Orders</h1></div>${orders.rows.length === 0? '<div class="card">No orders yet</div>' : orders.rows.map(order => `<div class="card"><h3>Order #${order.id}</h3><p>Total: UGX ${order.total_amount.toLocaleString()}</p><p>Status: ${order.status}</p><p>Payment: ${order.payment_method}</p><p>Date: ${new Date(order.created_at).toLocaleDateString()}</p></div>`).join('')}`;
  res.send(renderPage('Orders', content, req));
});

app.get('/donor-portal', requireTenant, requireFeature('donations'), async (req, res) => {
  const campaigns = await pool.query('SELECT * FROM donor_campaigns WHERE tenant_id = $1 AND active = true', [req.tenant.id]);
  const content = `<div class="card"><h1>Donor Portal</h1><p>Support education initiatives</p></div><div class="grid">${campaigns.rows.map(c => `<div class// === CONTINUED - DONOR PORTAL ===
          .map(c => `
        <div class="card">
          <h3>${c.title}</h3>
          <p>${c.description}</p>
          <p>Goal: UGX ${c.goal_amount.toLocaleString()} | Raised: UGX ${c.raised_amount.toLocaleString()}</p>
          <form method="POST" action="/donate">
            <input type="hidden" name="campaign_id" value="${c.id}">
            <input name="amount" type="number" placeholder="Amount" required>
            <input name="donor_name" placeholder="Your Name">
            <button class="btn">Donate Now</button>
          </form>
        </div>
      `).join('')}
    </div>
  `;
  res.send(renderPage('Donor Portal', content, req));
});

app.post('/donate', requireTenant, async (req, res) => {
  const { campaign_id, amount, donor_name, donor_email } = req.body;
  await pool.query('INSERT INTO donations (tenant_id, donor_name, donor_email, amount) VALUES ($1, $2, $3, $4)', [req.tenant.id, donor_name, donor_email, amount]);
  if (campaign_id) {
    await pool.query('UPDATE donor_campaigns SET raised_amount = raised_amount + $1 WHERE id = $2', [amount, campaign_id]);
  }
  res.send(renderPage('Thank You', '<div class="card"><h1>Thank You!</h1><p>Your donation makes a difference.</p></div>', req));
});

app.get('/grants', requireTenant, requireFeature('grants'), async (req, res) => {
  const grants = await pool.query('SELECT * FROM grants WHERE active = true ORDER BY deadline ASC');
  const content = `
    <div class="card"><h1>Available Grants</h1></div>
    ${grants.rows.map(g => `
      <div class="card">
        <h3>${g.title}</h3>
        <p>${g.description}</p>
        <p><strong>Amount:</strong> UGX ${g.amount?.toLocaleString() || 'Varies'}</p>
        <p><strong>Deadline:</strong> ${new Date(g.deadline).toLocaleDateString()}</p>
        <p><strong>Requirements:</strong> ${g.requirements}</p>
        <a href="${g.source_url}" target="_blank" class="btn">Apply</a>
      </div>
    `).join('')}
  `;
  res.send(renderPage('Grants', content, req));
});

app.get('/whatsapp', requireTenant, requireFeature('whatsapp_bot'), (req, res) => {
  const content = `<div class="card"><h1>WhatsApp Bot</h1><p>Connect with us on WhatsApp: ${req.tenant.whatsapp_number || '0789736737'}</p></div>`;
  res.send(renderPage('WhatsApp', content, req));
});

app.get('/sms', requireTenant, requireFeature('sms_alerts'), (req, res) => {
  const content = `<div class="card"><h1>SMS Alerts</h1><p>Configure SMS notifications for fees, attendance, and grades</p></div>`;
  res.send(renderPage('SMS', content, req));
});

app.get('/api', requireTenant, requireFeature('api_access'), (req, res) => {
  const content = `<div class="card"><h1>API Access</h1><p>Your API Key: <code>ssewasswa_${req.tenant.subdomain}_${req.tenant.id}</code></p><p>Docs: GET /api/students, GET /api/fees</p></div>`;
  res.send(renderPage('API', content, req));
});

app.get('/surveys', requireTenant, requireFeature('surveys'), async (req, res) => {
  const surveys = await pool.query('SELECT * FROM surveys WHERE tenant_id = $1 AND active = true', [req.tenant.id]);
  const content = `
    <div class="card"><h1>Surveys</h1></div>
    ${surveys.rows.map(s => `
      <div class="card">
        <h3>${s.title}</h3>
        <p>Reward: UGX ${s.reward_per_user} per response</p>
        <button class="btn">Take Survey</button>
      </div>
    `).join('')}
  `;
  res.send(renderPage('Surveys', content, req));
});

app.get('/advertising', requireTenant, requireFeature('advertising'), (req, res) => {
  const content = `<div class="card"><h1>Advertising</h1><p>Promote your school or business on our platform. Contact: waiswadaniel24@gmail.com</p></div>`;
  res.send(renderPage('Advertising', content, req));
});

app.get('/login', (req, res) => {
  const content = `
    <div class="card" style="max-width: 400px; margin: 2rem auto;">
      <h1>Login</h1>
      <form method="POST" action="/login">
        <input name="email" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn" style="width: 100%;">Login</button>
      </form>
      <p style="margin-top: 1rem;">Default: waiswadaniel24@gmail.com / admin123</p>
    </div>
  `;
  res.send(renderPage('Login', content, req));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!user.rows[0]) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>', req));

    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>', req));

    req.session.user = user.rows[0];
    res.redirect('/app');
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).send(renderPage('Error', '<div class="card"><h1>Server Error</h1></div>', req));
  }
});

app.get('/create-site', (req, res) => {
  const content = `
    <div class="card">
      <h1>Create Your Free School Website</h1>
      <form method="POST" action="/create-site">
        <input name="name" placeholder="School Name" required>
        <input name="subdomain" placeholder="Subdomain (e.g. mystschool)" required>
        <input name="admin_email" type="email" placeholder="Admin Email" required>
        <input name="admin_password" type="password" placeholder="Admin Password" required>
        <button class="btn">Create Site</button>
      </form>
    </div>
  `;
  res.send(renderPage('Create Site', content, req));
});

app.post('/create-site', async (req, res) => {
  const { name, subdomain, admin_email, admin_password } = req.body;
  try {
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) RETURNING id', [name, subdomain.toLowerCase(), 'free']);
    const hashedPass = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [tenant.rows[0].id, admin_email, hashedPass, 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3)', [tenant.rows[0].id, admin_email, 0]);
    res.send(renderPage('Success', `<div class="card"><h1>Site Created!</h1><p>Your school site: http://${subdomain}.ssewasswa.org</p><a href="/login" class="btn">Login Now</a></div>`, req));
  } catch (e) {
    res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>Subdomain already taken or invalid</p></div>', req));
  }
});

app.get('/app', requireAuth, (req, res) => {
  const content = `
    <div class="card"><h1>Dashboard - ${req.session.user.email}</h1><p>Role: ${req.session.user.role}</p></div>
    <div class="grid">
      <div class="card"><h3>👥 Students</h3><a href="/app/students" class="btn">Manage</a></div>
      <div class="card"><h3>💰 Fees</h3><a href="/app/fees" class="btn">Manage</a></div>
      <div class="card"><h3>📅 Attendance</h3><a href="/app/attendance" class="btn">Track</a></div>
      <div class="card"><h3>📊 Grades</h3><a href="/app/grades" class="btn">Enter</a></div>
      <div class="card"><h3>🛒 Marketplace</h3><a href="/marketplace" class="btn">Shop</a></div>
      <div class="card"><h3>📦 Orders</h3><a href="/orders" class="btn">View</a></div>
    </div>
  `;
  res.send(renderPage('Dashboard', content, req));
});

app.get('/app/students', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY name', [req.session.user.tenant_id]);
  const content = `
    <div class="card">
      <h1>Students</h1>
      <form method="POST" action="/app/students/add">
        <input name="name" placeholder="Student Name" required>
        <input name="class" placeholder="Class" required>
        <input name="dob" type="date" placeholder="Date of Birth">
        <input name="guardian_name" placeholder="Guardian Name">
        <input name="guardian_phone" placeholder="Guardian Phone">
        <button class="btn">Add Student</button>
      </form>
    </div>
    <div class="card">
      <table>
        <tr><th>Name</th><th>Class</th><th>Guardian</th><th>Balance</th></tr>
        ${students.rows.map(s => `<tr><td>${s.name}</td><td>${s.class}</td><td>${s.guardian_name || 'N/A'}</td><td>UGX ${s.balance}</td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(renderPage('Students', content, req));
});

app.post('/app/students/add', requireAuth, async (req, res) => {
  const { name, class: className, dob, guardian_name, guardian_phone } = req.body;
  await pool.query('INSERT INTO students (tenant_id, name, class, dob, guardian_name, guardian_phone) VALUES ($1, $2, $3, $4, $5, $6)', [req.session.user.tenant_id, name, className, dob || null, guardian_name, guardian_phone]);
  res.redirect('/app/students');
});

app.get('/app/fees', requireAuth, async (req, res) => {
  const fees = await pool.query(`SELECT f.*, s.name as student_name FROM fees f JOIN students s ON f.student_id = s.id WHERE f.tenant_id = $1 ORDER BY f.created_at DESC`, [req.session.user.tenant_id]);
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.session.user.tenant_id]);
  const content = `
    <div class="card">
      <h1>Fees Management</h1>
      <form method="POST" action="/app/fees/add">
        <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <input name="amount" type="number" placeholder="Amount" required>
        <input name="term" placeholder="Term (e.g. Term 1)" required>
        <input name="year" type="number" placeholder="Year" value="${new Date().getFullYear()}" required>
        <button class="btn">Add Fee</button>
      </form>
    </div>
    <div class="card">
      <table>
        <tr><th>Student</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Term</th><th>Action</th></tr>
        ${fees.rows.map(f => `<tr><td>${f.student_name}</td><td>UGX ${f.amount.toLocaleString()}</td><td>UGX ${f.paid.toLocaleString()}</td><td>UGX ${(f.amount - f.paid).toLocaleString()}</td><td>${f.term} ${f.year}</td><td><form method="POST" action="/app/fees/pay/${f.id}" style="display:inline;"><input type="number" name="amount" placeholder="Pay" style="width:80px;"><button class="btn">Pay</button></form></td></tr>`).join('')}
      </table>
    </div>
  `;
  res.send(renderPage('Fees', content, req));
});

app.post('/app/fees/add', requireAuth, async (req, res) => {
  const { student_id, amount, term, year } = req.body;
  await pool.query('INSERT INTO fees (tenant_id, student_id, amount, term, year) VALUES ($1, $2, $3, $4, $5)', [req.session.user.tenant_id, student_id, amount, term, year]);
  res.redirect('/app/fees');
});

app.post('/app/fees/pay/:id', requireAuth, async (req, res) => {
  const { amount } = req.body;
  await pool.query('UPDATE fees SET paid = paid + $1 WHERE id = $2 AND tenant_id = $3', [amount, req.params.id, req.session.user.tenant_id]);
  res.redirect('/app/fees');
});

app.get('/app/attendance', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.session.user.tenant_id]);
  const today = new Date().toISOString().split('T')[0];
  const attendance = await pool.query(`SELECT a.*, s.name FROM attendance a JOIN students s ON a.student_id = s.id WHERE a.tenant_id = $1 AND a.date = $2`, [req.session.user.tenant_id, today]);
  const content = `
    <div class="card">
      <h1>Attendance - ${today}</h1>
      <form method="POST" action="/app/attendance/mark">
        <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <select name="status" required><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select>
        <button class="btn">Mark</button>
      </form>
    </div>
    <div class="card">
      <table><tr><th>Student</th><th>Status</th><th>Time</th></tr>${attendance.rows.map(a => `<tr><td>${a.name}</td><td>${a.status}</td><td>${new Date(a.created_at).toLocaleTimeString()}</td></tr>`).join('')}</table>
    </div>
  `;
  res.send(renderPage('Attendance', content, req));
});

app.post('/app/attendance/mark', requireAuth, async (req, res) => {
  const { student_id, status } = req.body;
  await pool.query(`INSERT INTO attendance (tenant_id, student_id, date, status) VALUES ($1, $2, CURRENT_DATE, $3) ON CONFLICT (tenant_id, student_id, date) DO UPDATE SET status = $3`, [req.session.user.tenant_id, student_id, status]);
  res.redirect('/app/attendance');
});

app.get('/app/grades', requireAuth, async (req, res) => {
  const students = await pool.query('SELECT id, name FROM students WHERE tenant_id = $1', [req.session.user.tenant_id]);
  const grades = await pool.query(`SELECT g.*, s.name FROM grades g JOIN students s ON g.student_id = s.id WHERE g.tenant_id = $1 ORDER BY g.created_at DESC LIMIT 50`, [req.session.user.tenant_id]);
  const content = `
    <div class="card">
      <h1>Grades</h1>
      <form method="POST" action="/app/grades/add">
        <select name="student_id" required><option value="">Select Student</option>${students.rows.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        <input name="subject" placeholder="Subject" required>
        <input name="score" type="number" placeholder="Score" min="0" max="100" required>
        <input name="term" placeholder="Term" required>
        <input name="year" type="number" value="${new Date().getFullYear()}" required>
        <button class="btn">Add Grade</button>
      </form>
    </div>
    <div class="card">
      <table><tr><th>Student</th><th>Subject</th><th>Score</th><th>Term</th><th>Year</th></tr>${grades.rows.map(g => `<tr><td>${g.name}</td><td>${g.subject}</td><td>${g.score}%</td><td>${g.term}</td><td>${g.year}</td></tr>`).join('')}</table>
    </div>
  `;
  res.send(renderPage('Grades', content, req));
});

app.post('/app/grades/add', requireAuth, async (req, res) => {
  const { student_id, subject, score, term, year } = req.body;
  await pool.query('INSERT INTO grades (tenant_id, student_id, subject, score, term, year) VALUES ($1, $2, $3, $4, $5, $6)', [req.session.user.tenant_id, student_id, subject, score, term, year]);
  res.redirect('/app/grades');
});

app.get('/super-admin', requireAuth, requireRole('super_admin'), (req, res) => {
  const content = `<div class="card"><h1>Super Admin Dashboard</h1></div><div class="grid"><div class="card"><h3>🏫 Tenants</h3><a href="/super-admin/tenants" class="btn">Manage</a></div><div class="card"><h3>👤 Users</h3><a href="/super-admin/users" class="btn">Manage</a></div><div class="card"><h3>💬 Comments</h3><a href="/super-admin/comments" class="btn">Moderate</a></div><div class="card"><h3>📧 Feedback</h3><a href="/super-admin/feedback" class="btn">View</a></div><div class="card"><h3>⚙️ Features</h3><a href="/super-admin/features" class="btn">Configure</a></div><div class="card"><h3>💰 Revenue</h3><a href="/super-admin/revenue" class="btn">Track</a></div></div>`;
  res.send(renderPage('Super Admin', content, req));
});

app.get('/super-admin/tenants', requireAuth, requireRole('super_admin'), async (req, res) => {
  const tenants = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC');
  const content = `<div class="card"><h1>All Tenants</h1></div><div class="card"><table><tr><th>ID</th><th>Name</th><th>Subdomain</th><th>Plan</th><th>Score</th><th>Action</th></tr>${tenants.rows.map(t => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.subdomain}</td><td>${t.plan}</td><td>${t.ranking_score}</td><td><form method="POST" action="/super-admin/verify" style="display:inline;"><input type="hidden" name="tenant_id" value="${t.id}"><button class="btn">Verify</button></form></td></tr>`).join('')}</table></div>`;
  res.send(renderPage('Tenants', content, req));
});

app.get('/super-admin/users', requireAuth, requireRole('super_admin'), async (req, res) => {
  const users = await pool.query('SELECT u.*, t.name as tenant_name FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id ORDER BY u.created_at DESC');
  const content = `<div class="card"><h1>All Users</h1></div><div class="card"><table><tr><th>ID</th><th>Email</th><th>Role</th><th>Tenant</th><th>Created</th></tr>${users.rows.map(u => `<tr><td>${u.id}</td><td>${u.email}</td><td>${u.role}</td><td>${u.tenant_name || 'N/A'}</td><td>${new Date(u.created_at).toLocaleDateString()}</td></tr>`).join('')}</table></div>`;
  res.send(renderPage('Users', content, req));
});

app.get('/super-admin/comments', requireAuth, requireRole('super_admin'), async (req, res) => {
  const comments = await pool.query('SELECT * FROM comments ORDER BY created_at DESC LIMIT 100');
  const content = `<div class="card"><h1>Moderate Comments</h1></div>${comments.rows.map(c => `<div class="card"><strong>${c.user_name}</strong> | Status: ${c.status}<p>${c.comment_text}</p><small>${new Date(c.created_at).toLocaleString()}</small></div>`).join('')}`;
  res.send(renderPage('Comments', content, req));
});

app.get('/super-admin/feedback', requireAuth, requireRole('super_admin'), async (req, res) => {
  const threads = await pool.query('SELECT * FROM feedback_threads ORDER BY created_at DESC');
  const content = `<div class="card"><h1>Feedback Threads</h1></div>${threads.rows.map(t => `<div class="card"><h3>${t.subject}</h3><p>From: ${t.user_name} (${t.user_email})</p><p>Status: ${t.status}</p><small>${new Date(t.created_at).toLocaleString()}</small></div>`).join('')}`;
  res.send(renderPage('Feedback', content, req));
});

app.get('/super-admin/features', requireAuth, requireRole('super_admin'), (req, res) => {
  const content = `<div class="card"><h1>Feature Flags</h1></div><div class="card"><pre>${JSON.stringify(FEATURES, null, 2)}</pre></div>`;
  res.send(renderPage('Features', content, req));
});

app.get('/super-admin/revenue', requireAuth, requireRole('super_admin'), async (req, res) => {
  const revenue = await pool.query('SELECT * FROM revenue_log ORDER BY created_at DESC LIMIT 100');
  const total = await pool.query('SELECT SUM(gross_amount) as total FROM revenue_log');
  const content = `<div class="card"><h1>Revenue Dashboard</h1><h2>Total: UGX ${total.rows[0].total?.toLocaleString() || 0}</h2></div><div class="card"><table><tr><th>Type</th><th>Gross</th><th>Commission</th><th>Description</th><th>Date</th></tr>${revenue.rows.map(r => `<tr><td>${r.type}</td><td>UGX ${r.gross_amount.toLocaleString()}</td><td>UGX ${r.commission.toLocaleString()}</td><td>${r.description}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}</table></div>`;
  res.send(renderPage('Revenue', content, req));
});

app.post('/super-admin/verify', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { tenant_id } = req.body;
  await pool.query('UPDATE settings SET verified = true WHERE tenant_id = $1', [tenant_id]);
  res.redirect('/super-admin/tenants');
});

app.get('/about-developer', (req, res) => {
  const content = `<div class="card"><h1>About Developer</h1><p><strong>SSEWASSWA Foundation</strong></p><p>Building digital infrastructure for African education</p><p>WhatsApp: 0789736737</p><p>Email: waiswadaniel24@gmail.com</p><p>Location: Kampala, Uganda</p></div>`;
  res.send(renderPage('About', content, req));
});

app.get('/terms', (req, res) => res.send(renderPage('Terms', '<div class="card"><h1>Terms of Service</h1><p>Standard terms apply.</p></div>', req)));
app.get('/privacy', (req, res) => res.send(renderPage('Privacy', '<div class="card"><h1>Privacy Policy</h1><p>We protect your data.</p></div>', req)));
app.get('/refund', (req, res) => res.send(renderPage('Refund', '<div class="card"><h1>Refund Policy</h1><p>30-day refund available.</p></div>', req)));

app.get('/set-lang/:lang', (req, res) => {
  req.session.lang = req.params.lang;
  res.redirect('back');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '5.1', time: new Date() }));

io.on('connection', (socket) => {
  socket.on('join_room', (room) => {
    socket.join(room);
    socket.to(room).emit('user_joined', { msg: 'A user joined the chat' });
  });

  socket.on('send_message', async (data) => {
    const { room, message, user_name } = data;
    try {
      await pool.query('INSERT INTO chat_messages (room, user_name, message) VALUES ($1, $2, $3)', [room, user_name, message]);
      io.to(room).emit('new_message', {
        user_name,
        message,
        time: new Date().toLocaleTimeString()
      });
    } catch (e) {
      console.error('Chat message error:', e);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 SSEWASSWA FOUNDATION v5.1 E-COMMERCE running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database: Connected`);
  });
}).catch(err => {
  console.error('Fatal: Database init failed:', err);
  process.exit(1);
});