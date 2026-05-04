const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Parser = require('rss-parser');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
const parser = new Parser();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ssewasswa-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const FEATURES = {
  news: true
};

function renderPage(title, content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#f8fafc;color:#1e293b;margin:0;padding:24px}.card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;max-width:720px;margin:0 auto}.btn{background:#1e40af;color:white;border:none;border-radius:8px;padding:10px 16px;cursor:pointer}input{display:block;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;margin:8px 0 12px}</style></head><body>${content}</body></html>`;
}

function requireFeature(feature) {
  return (req, res, next) => {
    if (!FEATURES[feature]) return res.status(403).send('Feature not enabled');
    return next();
  };
}

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.tenant) req.tenant = req.session.tenant;
  return next();
};

async function requireTenant(req, res, next) {
  try {
    const host = req.headers.host || '';
    const sub = host.split('.')[0];
    const effectiveSub = sub === 'localhost' || host.includes('onrender') || sub === '127' ? 'main' : sub;
    const result = await pool.query('SELECT * FROM tenants WHERE subdomain = $1', [effectiveSub]);
    if (!result.rows[0]) return res.status(404).send('Tenant not found');
    req.tenant = result.rows[0];
    req.tenantId = result.rows[0].id;
    return next();
  } catch (err) {
    return res.status(500).send('Tenant lookup failed');
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.session.user?.role === 'super_admin') return next();
  return res.status(403).send('Forbidden');
}

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(403).send('Forbidden');
  return next();
};

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    try {
      await client.query('CREATE TABLE db_init_lock (locked BOOLEAN DEFAULT true)');
    } catch (err) {
      if (err.code === '42P07') {
        await client.query('DROP TABLE IF EXISTS db_init_lock CASCADE');
        await client.query('CREATE TABLE db_init_lock (locked BOOLEAN DEFAULT true)');
      } else {
        throw err;
      }
    }

    const dropOrder = [
      'db_init_lock',
      'order_items',
      'orders',
      'cart_items',
      'market_items',
      'wallets',
      'chat_messages',
      'news_cache',
      'feedback_messages',
      'feedback_threads',
      'comments',
      'grants',
      'donor_campaigns',
      'donations',
      'surveys',
      'grades',
      'attendance',
      'fees',
      'students',
      'password_resets',
      'users',
      'revenue_log',
      'settings',
      'courses',
      'tenants'
    ];

    for (const table of dropOrder) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }

    await client.query('CREATE TABLE db_init_lock (locked BOOLEAN DEFAULT true)');

    await client.query('CREATE TABLE tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, subdomain TEXT UNIQUE NOT NULL, plan TEXT DEFAULT \'free\', plan_expires DATE, ranking_score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT \'staff\', tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, class TEXT, dob DATE, guardian_name TEXT, guardian_phone TEXT, balance NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount NUMERIC NOT NULL, term TEXT, year INTEGER, paid NUMERIC DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, date DATE NOT NULL, status TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE grades (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score NUMERIC, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE market_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, seller_email TEXT, status TEXT DEFAULT \'active\', image_url TEXT, stock INTEGER DEFAULT 1, category TEXT DEFAULT \'general\', created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE cart_items (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, item_id INTEGER REFERENCES market_items(id) ON DELETE CASCADE, quantity INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, total_amount NUMERIC NOT NULL, status TEXT DEFAULT \'pending\', payment_method TEXT, momo_number TEXT, delivery_address TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, item_id INTEGER REFERENCES market_items(id) ON DELETE SET NULL, quantity INTEGER NOT NULL, price NUMERIC NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, balance NUMERIC DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, creator_email TEXT, title TEXT NOT NULL, questions JSONB, reward_per_user NUMERIC DEFAULT 0, total_budget NUMERIC DEFAULT 0, max_responses INTEGER DEFAULT 100, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, amount NUMERIC NOT NULL, message TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE donor_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, goal_amount NUMERIC NOT NULL, raised_amount NUMERIC DEFAULT 0, image_url TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE grants (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, amount NUMERIC, deadline DATE, requirements TEXT, active BOOLEAN DEFAULT true, source_url TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE comments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, user_name TEXT, comment_text TEXT NOT NULL, topic TEXT DEFAULT \'general\', parent_id INTEGER, status TEXT DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE feedback_threads (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, user_name TEXT, subject TEXT NOT NULL, status TEXT DEFAULT \'open\', created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE feedback_messages (id SERIAL PRIMARY KEY, thread_id INTEGER REFERENCES feedback_threads(id) ON DELETE CASCADE, sender_type TEXT NOT NULL, sender_email TEXT, message TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE news_cache (id SERIAL PRIMARY KEY, title TEXT, link TEXT UNIQUE, snippet TEXT, pub_date TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE chat_messages (id SERIAL PRIMARY KEY, room TEXT, user_name TEXT, message TEXT, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE courses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, video_url TEXT, category TEXT, level TEXT DEFAULT \'beginner\', created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, site_name TEXT DEFAULT \'SSEWASSWA FOUNDATION UGANDA\', primary_color TEXT DEFAULT \'#1e40af\', contact_email TEXT DEFAULT \'waiswadaniel24@gmail.com\', whatsapp_number TEXT DEFAULT \'0789736737\', subscription_tier TEXT DEFAULT \'free\', verified BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())');
    await client.query('CREATE TABLE revenue_log (id SERIAL PRIMARY KEY, type TEXT, gross_amount NUMERIC, commission NUMERIC, tenant_id INTEGER, description TEXT, created_at TIMESTAMP DEFAULT NOW())');

    await client.query('CREATE UNIQUE INDEX tenants_subdomain_unique ON tenants (subdomain)');
    await client.query('CREATE UNIQUE INDEX users_email_unique ON users (email)');
    await client.query('CREATE UNIQUE INDEX attendance_unique ON attendance (tenant_id, student_id, date)');
    await client.query('CREATE UNIQUE INDEX cart_user_item_unique ON cart_items (user_email, item_id)');
    await client.query('CREATE UNIQUE INDEX wallets_tenant_user_unique ON wallets (tenant_id, user_email)');
    await client.query('CREATE UNIQUE INDEX settings_tenant_unique ON settings (tenant_id)');
    await client.query('CREATE UNIQUE INDEX courses_tenant_title_unique ON courses (tenant_id, title)');

    console.log('Indexes created. Seeding DEVELOPER ONLY...');

    const tenant = await client.query(
      `INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      ['SSEWASSWA FOUNDATION UGANDA', 'main', 'enterprise']
    );
    const tenantId = tenant.rows[0].id;

    const hashedPass = await bcrypt.hash('admin123', 10);
    await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='super_admin'`,
      [tenantId, 'waiswadaniel24@gmail.com', hashedPass, 'super_admin']
    );

    await client.query(`INSERT INTO settings (tenant_id, subscription_tier, verified) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 'enterprise', true]);

    await client.query(`INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_email) DO NOTHING`, [tenantId, 'waiswadaniel24@gmail.com', 0]);

    await client.query(`INSERT INTO courses (tenant_id, title, description, video_url, category) VALUES ($1, 'Introduction to Computers', 'Learn computer basics', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'technology') ON CONFLICT DO NOTHING`, [tenantId]);

    await client.query(`INSERT INTO market_items (tenant_id, title, description, price, seller_email, status, image_url, stock, category) VALUES ($1, 'School Uniform Set', 'Complete uniform for primary students', 50000, 'waiswadaniel24@gmail.com', 'approved', 'https://via.placeholder.com/300x300?text=Uniform', 100, 'uniform') ON CONFLICT DO NOTHING`, [tenantId]);
    await client.query(`INSERT INTO market_items (tenant_id, title, description, price, seller_email, status, image_url, stock, category) VALUES ($1, 'Exercise Books Pack', '10 exercise books', 15000, 'waiswadaniel24@gmail.com', 'approved', 'https://via.placeholder.com/300x300?text=Books', 200, 'stationery') ON CONFLICT DO NOTHING`, [tenantId]);

    console.log('RESET COMPLETE: Only developer account exists. Password: admin123');

    await client.query('DROP TABLE IF EXISTS db_init_lock');
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
    }
    throw err;
  } finally {
    client.release();
  }
}

app.get('/login', (req, res) => {
  res.send('<h1>Login</h1><form method="POST" action="/login"><input name="email" placeholder="Email" /><input name="password" placeholder="Password" type="password" /><button type="submit">Login</button></form><p style="margin-top: 1rem;"><a href="/forgot-password">Forgot Password?</a></p>');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query('SELECT u.*, t.subdomain FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1', [email]);
    if (!user.rows[0]) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>', req));

    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(401).send(renderPage('Login', '<div class="card"><h1>Error</h1><p>Invalid credentials</p><a href="/login">Try Again</a></div>', req));

    req.session.user = user.rows[0];
    req.session.tenant = { id: user.rows[0].tenant_id, subdomain: user.rows[0].subdomain };
    res.redirect('/app');
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).send(renderPage('Error', '<div class="card"><h1>Server Error</h1></div>', req));
  }
});

app.get('/forgot-password', (req, res) => {
  const content = `<div class="card" style="max-width: 400px; margin: 2rem auto;"><h1>Reset Password</h1><form method="POST" action="/forgot-password"><input name="email" type="email" placeholder="Your Email" required><button class="btn" style="width: 100%;">Send Reset Link</button></form><p><a href="/login">Back to Login</a></p></div>`;
  res.send(renderPage('Forgot Password', content, req));
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (!user.rows[0]) {
    return res.send(renderPage('Reset', '<div class="card"><h1>Check Your Email</h1><p>If account exists, reset link was sent.</p></div>', req));
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 3600000);
  await pool.query('INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)', [email, token, expires]);
  const resetLink = `https://ssewasswa-api.onrender.com/reset-password/${token}`;
  console.log('PASSWORD RESET LINK:', resetLink);
  res.send(renderPage('Reset', '<div class="card"><h1>Reset Link Sent</h1><p>Check Render logs for your reset link. For demo: <a href="' + resetLink + '">' + resetLink + '</a></p></div>', req));
});

app.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [token]);
  if (!reset.rows[0]) {
    return res.send(renderPage('Error', '<div class="card"><h1>Invalid Link</h1><p>Reset link expired or invalid.</p></div>', req));
  }
  const content = `<div class="card" style="max-width: 400px; margin: 2rem auto;"><h1>New Password</h1><form method="POST" action="/reset-password"><input type="hidden" name="token" value="${token}"><input name="password" type="password" placeholder="New Password" required><input name="confirm" type="password" placeholder="Confirm Password" required><button class="btn" style="width: 100%;">Reset Password</button></form></div>`;
  res.send(renderPage('Reset Password', content, req));
});

app.post('/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body;
  if (password!== confirm) {
    return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>Passwords do not match</p></div>', req));
  }
  const reset = await pool.query('SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false', [token]);
  if (!reset.rows[0]) {
    return res.send(renderPage('Error', '<div class="card"><h1>Invalid Link</h1></div>', req));
  }
  const hashedPass = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hashedPass, reset.rows[0].email]);
  await pool.query('UPDATE password_resets SET used = true WHERE token = $1', [token]);
  res.send(renderPage('Success', '<div class="card"><h1>Password Reset!</h1><p>You can now login with your new password.</p><a href="/login" class="btn">Login</a></div>', req));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'ssewasswa-api', version: '5.1' });
});

app.get('/news', requireFeature('news'), requireTenant, async (req, res) => {
  try {
    const feed = await parser.parseURL('https://feeds.bbci.co.uk/news/world/africa/rss.xml');
    const items = feed.items.slice(0, 10);
    if (items.length === 0) throw new Error('No news');
    const content = '<div class="card"><h1>Education News Africa</h1></div>' + items.map(item => '<div class="card"><h3>' + item.title + '</h3><p>' + (item.contentSnippet || '') + '</p><small>' + new Date(item.pubDate).toLocaleDateString() + '</small><br><a href="' + item.link + '" target="_blank" class="btn">Read More</a></div>').join('');
    res.send(renderPage('News', content, req));
  } catch (e) {
    console.error('News fetch error:', e.message);
    res.send(renderPage('News', '<div class="card"><h1>News Temporarily Unavailable</h1><p>We cannot fetch news right now. Please try again later.</p></div>', req));
  }
});

app.get('/create-site', (req, res) => {
  res.send(renderPage('Create Site', '<div class="card"><h1>Create Free School Site</h1><form method="POST" action="/create-site"><input name="name" placeholder="School Name" required><input name="subdomain" placeholder="Subdomain" required><input name="admin_email" type="email" placeholder="Admin Email" required><input name="admin_password" type="password" placeholder="Password" required><button class="btn">Create</button></form></div>', req));
});

app.post('/create-site', async (req, res) => {
  const { name, subdomain, admin_email, admin_password } = req.body;
  if (!name ||!subdomain ||!admin_email ||!admin_password) {
    return res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>All fields required</p><a href="/create-site">Try Again</a></div>', req));
  }
  try {
    const tenant = await pool.query('INSERT INTO tenants (name, subdomain, plan) VALUES ($1, $2, $3) RETURNING id', [name.trim(), subdomain.toLowerCase().trim(), 'free']);
    const hashedPass = await bcrypt.hash(admin_password, 10);
    await pool.query('INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [tenant.rows[0].id, admin_email, hashedPass, 'admin']);
    await pool.query('INSERT INTO settings (tenant_id) VALUES ($1)', [tenant.rows[0].id]);
    await pool.query('INSERT INTO wallets (tenant_id, user_email, balance) VALUES ($1, $2, $3)', [tenant.rows[0].id, admin_email, 0]);
    res.send(renderPage('Success', '<div class="card"><h1>Site Created!</h1><p>School: ' + name + '</p><p>URL: http://' + subdomain + '.localhost:3000</p><p>Login: ' + admin_email + '</p></div>', req));
  } catch (e) {
    let msg = e.code === '23505'? 'Subdomain already taken' : e.message;
    res.send(renderPage('Error', '<div class="card"><h1>Error</h1><p>' + msg + '</p><a href="/create-site">Try Again</a></div>', req));
  }
});

app.get('/marketplace', requireAuth, requireTenant, async (req, res) => {
  const result = await pool.query("SELECT * FROM market_items WHERE tenant_id = $1 AND status IN ('active', 'approved') ORDER BY created_at DESC", [req.tenantId]);
  res.json({ items: result.rows });
});

app.get('/marketplace/cart', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT c.*, m.title, m.price FROM cart_items c JOIN market_items m ON m.id = c.item_id WHERE c.user_email = $1 ORDER BY c.created_at DESC', [req.session.user.email]);
  res.json({ cart: result.rows });
});

app.post('/marketplace/cart', requireAuth, async (req, res) => {
  const { item_id, quantity } = req.body;
  await pool.query('INSERT INTO cart_items (user_email, item_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (user_email, item_id) DO UPDATE SET quantity = EXCLUDED.quantity', [req.session.user.email, item_id, quantity || 1]);
  res.json({ success: true });
});

app.post('/marketplace/checkout', requireAuth, requireTenant, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await client.query('SELECT c.item_id, c.quantity, m.price FROM cart_items c JOIN market_items m ON m.id = c.item_id WHERE c.user_email = $1 FOR UPDATE', [req.session.user.email]);
    if (cart.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const total = cart.rows.reduce((sum, row) => sum + Number(row.price) * Number(row.quantity), 0);
    const orderResult = await client.query('INSERT INTO orders (tenant_id, user_email, total_amount, status, payment_method, momo_number, delivery_address) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [req.tenantId, req.session.user.email, total, 'pending', req.body.payment_method || 'momo', req.body.momo_number || '', req.body.delivery_address || '']);
    const orderId = orderResult.rows[0].id;
    for (const row of cart.rows) {
      await client.query('INSERT INTO order_items (order_id, item_id, quantity, price) VALUES ($1, $2, $3, $4)', [orderId, row.item_id, row.quantity, row.price]);
    }
    await client.query('DELETE FROM cart_items WHERE user_email = $1', [req.session.user.email]);
    await client.query('COMMIT');
    return res.json({ success: true, order_id: orderId, total_amount: total });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Checkout failed' });
  } finally {
    client.release();
  }
});

app.get('/orders', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders WHERE user_email = $1 ORDER BY created_at DESC', [req.session.user.email]);
  res.json({ orders: result.rows });
});

app.get('/app', requireAuth, requireTenant, async (req, res) => {
  const students = await pool.query('SELECT COUNT(*)::int AS c FROM students WHERE tenant_id = $1', [req.tenantId]);
  const fees = await pool.query('SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM fees WHERE tenant_id = $1', [req.tenantId]);
  res.json({ tenant: req.tenant.name, stats: { students: students.rows[0].c, total_fees: fees.rows[0].total } });
});

app.get('/app/students', requireAuth, requireTenant, async (req, res) => {
  const result = await pool.query('SELECT * FROM students WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
  res.json({ students: result.rows });
});

app.get('/app/fees', requireAuth, requireTenant, async (req, res) => {
  const result = await pool.query('SELECT * FROM fees WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
  res.json({ fees: result.rows });
});

app.get('/app/attendance', requireAuth, requireTenant, async (req, res) => {
  const result = await pool.query('SELECT * FROM attendance WHERE tenant_id = $1 ORDER BY date DESC, created_at DESC', [req.tenantId]);
  res.json({ attendance: result.rows });
});

app.get('/app/grades', requireAuth, requireTenant, async (req, res) => {
  const result = await pool.query('SELECT * FROM grades WHERE tenant_id = $1 ORDER BY created_at DESC', [req.tenantId]);
  res.json({ grades: result.rows });
});

app.get('/super-admin', requireAuth, requireSuperAdmin, async (req, res) => {
  const tenants = await pool.query('SELECT id, name, subdomain, plan, ranking_score, created_at FROM tenants ORDER BY created_at DESC');
  const tenantRows = tenants.rows.map((t) => `<tr><td>${t.id}</td><td>${t.name}</td><td>${t.subdomain}</td><td>${t.plan}</td><td>${t.ranking_score}</td></tr>`).join('');
  const content = `
  <div class="card"><h1>Super Admin</h1></div>
  <div class="card"><table width="100%"><thead><tr><th>ID</th><th>Name</th><th>Subdomain</th><th>Plan</th><th>Score</th></tr></thead><tbody>${tenantRows || '<tr><td colspan="5">No tenants</td></tr>'}</tbody></table></div>
  <div class="card"><h3>⚠️ Nuclear Reset</h3><form method="POST" action="/super-admin/nuclear-reset" onsubmit="return confirm('This deletes ALL data. Continue?')"><input name="confirm" placeholder="Type: DELETE EVERYTHING" required><button class="btn" style="background:#dc2626;">WIPE ALL DATA</button></form></div>`;
  res.send(renderPage('Super Admin', content, req));
});

app.post('/super-admin/nuclear-reset', requireAuth, requireRole('super_admin'), async (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'DELETE EVERYTHING') {
    return res.send(renderPage('Error', '<div class="card"><h1>Confirmation Required</h1><p>Type DELETE EVERYTHING to confirm</p></div>', req));
  }
  try {
    await pool.query(`TRUNCATE TABLE surveys, grades, attendance, fees, students, cart_items, order_items, orders, market_items, wallets, donations, donor_campaigns, grants, comments, feedback_threads, feedback_messages, chat_messages, news_cache, courses, settings, revenue_log, password_resets, users, tenants RESTART IDENTITY CASCADE`);
    await initDB();
    res.send(renderPage('Reset', '<div class="card"><h1>Platform Reset Complete</h1><p>Only developer account remains. Password: admin123</p><a href="/login" class="btn">Login</a></div>', req));
  } catch (e) {
    res.send(renderPage('Error', '<div class="card"><h1>Reset Failed</h1><p>' + e.message + '</p></div>', req));
  }
});

app.get('/', (req, res) => {
  res.send('SSEWASSWA API is running.');
});

io.on('connection', (socket) => {
  socket.on('join_room', (room) => {
    socket.join(room);
    socket.to(room).emit('user_joined', { msg: 'A user joined' });
  });

  socket.on('send_message', async (data) => {
    try {
      const { room, message, user_name } = data;
      await pool.query('INSERT INTO chat_messages (room, user_name, message) VALUES ($1, $2, $3)', [room, user_name, message]);
      io.to(room).emit('new_message', { user_name, message, time: new Date().toLocaleTimeString() });
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });
});

initDB().catch((err) => {
  console.error('Init failed:', err);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
