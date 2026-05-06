/**
 * SSEWASSWA Network v6.0 (Final Merged)
 * Complete School/Org/Marketplace Platform
 */

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const cloudinary = require('cloudinary').v2);
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

// === CONFIGURATION & CONSTANTS ===
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const upload = multer({ storage: multer.memoryStorage() }); // Store in memory for Cloudinary streams

const DEVELOPER_PHONE = '0789736737';
const DEVELOPER_RATE = 0.05;
const PLATFORM_COMMISSION = 0.10; // Platform takes 10% of marketplace sales

const MOMO_CONFIG = {
  subscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY || '',
  apiUser: process.env.MOMO_API_USER || '',
  apiKey: process.env.MOMO_API_KEY || '',
  environment: process.env.MOMO_ENV || 'sandbox',
  baseUrl: process.env.MOMO_ENV === 'production' ? 'https://momodeveloper.mtn.com' : 'https://sandbox.momodeveloper.mtn.com',
  callbackUrl: process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'
};

const SMS_CONFIG = {
  apiKey: process.env.AT_API_KEY || '',
  username: process.env.AT_USERNAME || 'sandbox',
  senderId: process.env.AT_SENDER_ID || 'SSEWASSWA'
};

const PAYMENT_GATEWAYS = {
  mtn: { name: 'MTN MoMo', currencies: ['UGX'], enabled: true, logo: 'mtn.png' },
  airtel: { name: 'Airtel Money', currencies: ['UGX', 'KES', 'TZS'], enabled: true, logo: 'airtel.png' },
  flutterwave: { name: 'Flutterwave', currencies: ['UGX', 'KES', 'NGN', 'USD'], enabled: true, logo: 'fw.png' }
};

// --- CURRENCY & SUBSCRIPTION PLANS ---
const CURRENCIES = { UGX: { symbol: 'UGX', rate: 1 }, USD: { symbol: '$', rate: 3700 }, EUR: { symbol: '€', rate: 4000 }, GBP: { symbol: '£', rate: 4700 } };
const SUBSCRIPTION_PLANS = {
  school_free: { name: 'School Starter', price: 0, currency: 'UGX', features: ['100 students', 'Basic marksheets'], portals: ['academics', 'public'] },
  school_pro: { name: 'School Pro', price: 50000, currency: 's' }, features: ['Unlimited students', 'All portals', 'SMS alerts'], portals: ['academics', 'stores', 'admin', 'papers', 'funds', 'reports', 'finance', 'marketplace', 'programs', 'news', 'ads'] },
  org_basic: { name: 'Org Basic', price: 30000, currency: 's' }, features: ['50 members', 'Project tracking'], portals: ['dashboard', 'middleware', 'finance', 'projects', 'public'] },
  business: { name: 'Business', price: 20000, currency: 's' }, features: ['Unlimited products', '0% commission first month'], portals: ['seller', 'orders', 'products', 'wallet', 'ads'] },
  donor: { name: 'Donor Premium', price: 50000, currency: 's' }, features: ['Post grants', 'Review applications'], portals: ['dashboard', 'opportunities', 'history', 'impact'] }
};

// --- SECURITY: AES-256 Encryption ---
const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_SECRET || 'default32charsecretkey1234567890ab', 'salt', 32);
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}
function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let str = decipher.update(encrypted, 'hex', 'utf8');
  str += decipher.final('utf8');
  return str;
}

// === MIDDLEWARE ===
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error(e); res.status(500).json({ error: e.message }) });
const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); req.tenant = req.session.tenant; req.tenantId = req.session.tenant ? req.session.tenant.id : null; req.lang = req.query.lang || 'en'; next(); };
const requireRole = (...r) => (req, res, next) => { if (!req.session || !req.session.user || !r.includes(req.session.user.role)) return res.status(403).send('403'); next(); };
const requirePortal = (p) => (req, res, next) => { if (!req.session || !req.session.user.role.includes('admin') && !req.session.user.portals?.includes(p)) return res.status(403).send('403'); next(); };
const requireTenantType = (...t) => (req, res, next) => { if (!req.session || !t.includes(req.session.user?.tenant_type)) return res.status(403).send('403'); next(); };
const requireDeveloper = (req, res, next) => { if (req.session?.user?.email !== DEVELOPER_PHONE) return res.status(403).send('403'); next(); };

// === RENDER FUNCTION (v6.0) ===
function renderPage(title, content, user, isPublic, lang) {
  user = user || null; isPublic = isPublic || false; lang = lang || 'en';
  let nav = '';
  if (user) {
    const schoolPortals = { academics: 'Academics', stores: 'Stores', admin: 'Admin', papers: 'Papers', funds: 'Donors', reports: 'Marksheets', finance: 'Finance', marketplace: 'Marketplace', public: 'Public Site', programs: 'Programs', news: 'News', ads: 'Adverts', entertainment: 'Entertainment' };
    const orgPortals = { dashboard: 'Dashboard', members: 'Members', finance: 'Finance', reports: 'Reports', projects: 'Projects', marketplace: 'Marketplace', public: 'Public Site', programs: 'Programs', news: '��<button onclick="document.querySelector('.mobile-menu').classList.toggle('open')">☰</button></div>'; // Mobile Toggle
    // --- NAVIGATION LOGIC ---
    const portals = user?.tenant_type === 'organisation' ? orgPortals : (user?.role === 'seller' ? { seller: 'Seller Dashboard', orders: 'Orders', products: 'Products', wallet: 'Wallet', ads: 'Advertise', analytics: 'Analytics' } : schoolPortals;

    // --- LINK GENERATION ---
    const getLink = (k, v) => {
      // Feature Gate Check: Only show if enabled
      if (k === 'ai_chatbot' && !req?.session?.tenant_features?.ai_chatbot) return ''; 
      if (k === 'ussd_gateway' && !req?.session?.tenant_features?.ussd_gateway) return ''; 
      return `<a href="/portal/${k}" class="${portal === k ? 'active' : ''}">${v}</a>`;
    };

    // --- ADMIN NAV (Super Admin Override) ---
    const adminLinks = `<a href="/super-admin" class="btn btn-red" style="margin-left:auto">=🔴 Developer Backdoor</a>`;

    // Construct Nav
    nav = `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:12px 0 0 24px 0"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div style="display:flex;align-items:center;gap:10px"><b>${esc(user.tenant_name)}</b> - ${esc(user.name)} ${user.verified ? '✅' : '⚠️'}</div></div><div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px">` + 
      (user.role === 'super_admin' ? adminLinks : '') + 
      Object.entries(portals).map(([k, v]) => getLink(k, v)).join('') + 
      `<a href="/cart" style="color:white;margin:0 10px">🛒</a>` + 
      `<a href="/notifications" style="color:white;margin:0 10px">🔔</a>` + 
      `<a href="/logout" style="color:white">Logout</a></div></div></div>`;
  }

  // --- PUBLIC NAV ---
  if (isPublic) {
    nav = `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:12px 20px;margin:0 0 24px 0"><div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:18px">SSEWASSWA Network</div><a href="/" style="color:white;text-decoration:none">=🏠</a><a href="/learning" style="color:white;text-decoration:none">=🎓</a><a href="/store" style="color:white;text-feature:right">=🛒</a><a href="/videos" style="color:white;text-decoration:none">=🎬</a><a href="/games" style="color:white;text-decoration:none">=�ī</a><a href="/news" style="color:white;text-decoration:none">=📰</a> <a href="/premium" style="const style="font-size:12px;color:#64748b">Learn • Shop • Earn</h1><p>News, events, success stories from our community</p><div class="grid"><div class="card"><h3>🎓 Learn</h3><p>Mathematics</h3><p>Science</p><div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/learning'"><div style="font-size:48px">=🏫 Find Schools</h3><div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/marketplace' style="text-align:center;cursor:pointer"><div class="card" style="text-align:center; cursor:pointer" onclick="location.href='/store'">=���</div></div></div>';
  }
  
  // --- HTML TEMPLATE ---
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#f0f9ff;color:#1e293b;min-height:100vh}.container{max-width:1200px;margin:0 auto;padding:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}.btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600}.btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-gold{background:linear-gradient(dimgray,linear-gradient(135deg,#d97706,#f59e0b)}input,select,textarea{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0;font-size:16px;min-height:44px}input:focus,select:focus,textarea:focus{outline:none;border-color:#3b82f6;outline-offset:2px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:transaction:linear-gradient(135deg,#1e40af,#3b82f6);color:white}tr:hover{background:#f8fafc}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}.stat-card{background:white;padding:20px;border-radius:16px;text-align:center}.stat-num{font-size:32px;font-weight:bold;color:#1e40af}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.badge{padding:6px 10px;border-radius:20px;font-size:11px;font-weight:600;display:inline-block}.badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}.badge-gold{background:#fef3c7;color:#92400e}.badge-blue{background:#dbeafe;color:#1e40af}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.hero{background:linear-gradient(fix(135deg,#1e40af,#3b82f6,#60a5fa);color:white;padding:60px 20px;text-align:center;border-radius:20px;margin-bottom:30px"><h1 style="font-size:48px;margin-bottom:16px">Learn - Shop - Play - Earn</h1><p>Schools • Organisations • Marketplace • Donors • Education</p><div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/signup" class="btn btn-green" style="font-size:18px;padding:16px 32px">Get Started</a><a href="/demo" class="btn btn-gold" style="font-size:18px;padding:16px 32px">=��P Demo</a></div></div></div><div class="stats"><div class="stat-card"><div class="stat-num">50K+</div><div>Active Schools</div></div><div class="stat-card"><div class="stat-num">500+</div><div>Organisations</div></div><div class="stat-card"><div class="stat-num">${Math.floor(Math.random()*1000)+1000}+</div><div>Products</div></div></div><div class="card" style="text-align:center;cursor:pointer"><div style="font-size:48px">=🎓</div><h3>Mathematics</h3><p>Science</p><div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/learning'"><div style="font-size:48px">=🏫 Find Schools</div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/marketplace'>=�Ŭ Marketplace</div></div><div class="card" style="text-align:center;cursor:pointer" onclick="location.href='/store'>=🛒 Store</div></div><div></div><div class="card" style="text-align:center;cursor:pointer" onclick="visibility:visible">=🎭 News</div></div><div class="card" style="text-align:center;cursor:pointer" height: 200px;overflow:hidden" style="transition:height 0.3s"><div style="margin-top:20px">Loading...</div></div></div><div class="card"><h3>Success Stories</h3><p>News, events, success stories from our community</p><div class="grid"><div class="card"><h4>📰 News Article 1</h4><p>Community update.</p></div><div><div class="card"><h4>🏫 Find Schools</h4><div><div class="card" style="display:flex;flex-direction:column;gap:12px">This is a placeholder for news items. Check console for RSS feed parsing logic if needed.</div></div><div class="card""><h3>Success Stories</h3><p>Community updates and community highlights.</div></div></div></div> <script>document.addEventListener('DOMContentLoaded',()=>{const elems=document.querySelectorAll('.lazy');const obs=new IntersectionObserver(e=>{e.forEach(i=>{if(i.isIntersecting){const img=i.target;img.src=i.dataset.src;img.classList.add('loaded');obs.unobserve(img)}});elems.forEach(i=>obs.observe(i))});</script></body></html>`;
}

// === ROUTES ===

// --- AUTHENTICATION ---
app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  // CRITICAL FIX: Load tenant features into session to control UI locking/unlocking
  const u = (await pool.query('SELECT u.*, t.features_enabled FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1 AND u.approved=true', [email])).rows[0];
  if (!u || !await bcrypt.compare(password, u.password_hash)) return res.status(401).send('Invalid credentials');
  
  req.session.user = u;
  req.session.tenant_features = u.features_enabled || {}; // Store features for middleware checks
  if (u.role === 'super_admin') return res.redirect('/super-admin');
  res.redirect(u.role === 'school_admin' || u.role === 'org_admin' ? '/portal/admin' : '/portal/academics');
}));

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

// --- REGISTRATION (Self-Service, Email Verify, Plan Selection) ---
app.get('/register', ah(async (req, res) => {
  const type = req.query.type || 'school';
  const plans = Object.entries(SUBSCRIPTION_PLANS).filter(([k, v]) => k.startsWith(type));
  res.send(renderPage('Register', `<div class="card" style="max-width:800px;margin:40px auto"><h1>Create ${esc(type)}</h1><form method="POST" action="/register"><input type="hidden" name="type" value="${type}"><h3>1. Choose Plan</h3>${plans.map(([k, v]) => `<div class="plan" onclick="document.querySelector('[name="plan]').value='${k}';document.querySelectorAll('.plan').forEach(p => p.classList.remove('selected'));this.classList.add('selected')"><h4>${v.name} - ${v.price === 0 ? 'FREE' : CURRENCIES[v.currency].symbol + ' ' + v.price.toLocaleString() + '/month'}</h4><ul>${v.features.map(f => `<li>${f}</li>`).join('')}</ul></div>`).join('')}<input type="hidden" name="plan" required><h3>2. Basic Details</h3><input name="name" placeholder="Name" required><input name="subdomain" placeholder="Website: kings-primary" required><textarea name="description" placeholder="Description"></textarea><h3>3. Your Payment Details</h3><p style="color:#64748b">Where should your money go?</p><select name="gateway" required><option value="">Select Payment Method</option>${Object.entries(PAYMENT_GATEWAYS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select><input name="momo_number" placeholder="MTN/Airtel Number" required><input name="momo_name" placeholder="Name on Mobile Money" required><input name="bank_name" placeholder="Bank Name: Stanbic (Optional)"><input name="bank_account" placeholder="Bank Account Number (Optional)"></div><h3>4. Admin Account</h3><input name="admin_name" placeholder="Your Name" required><input name="admin_email" type="email" placeholder="Email" required><input name="admin_phone" placeholder="Your Phone: 078..." required><input name="admin_password" type="password" placeholder="Password" required><label><input type="checkbox" required> I agree to 5% platform fee + subscription terms</label><button class="btn">Create My Account - Free Setup</button></form></div></div>`, null, true));
}));

app.post('/register', ah(async (req, res) => {
  const { name, subdomain, type, description, gateway, momo_number, momo_name, bank_name, bank_account, admin_name, admin_email, admin_phone, admin_password, plan } = req.body;
  const tenant = (await pool.query('INSERT INTO tenants(name,subdomain,type,description,gateway,momo_number_encrypted,momo_name,bank_name,bank_account,wallet_balance,status,features_enabled)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id', [name, subdomain, type, description, gateway, encrypt(momo_number), momo_name, bank_name, bank_account, 0, 'active', '{"dashboard":true,"finance":true,"academics":true,"ai_chatbot":false,"ussd_gateway":false,"offline_sync":false}'::jsonb)); // Default features
  const planData = SUBSCRIPTION_PLANS[plan] || { portals: [] };
  
  const hash = await bcrypt.hash(admin_password, 10);
  const role = type === 'school' ? 'school_admin' : type === 'organisation' ? 'org_admin' : type === 'business' ? 'seller' : 'donor';
  await pool.query('INSERT INTO users(tenant_id,name,email,password_hash,role,portals,approved)VALUES($1,$2,$3,$4,$5,$6)', [tenant.id, admin_name, admin_email, hash, role, planData.portals]);
  await logAction(null, tenant.id, 'register', { type, plan }, req.ip);
  res.send(`<script>alert('Success! 14-day free trial started. Your site: /s/${subdomain}');window.location='/login'</script>`);
}));

// --- DEVELOPER BACKDOOR (Super Admin) ---
const requireDeveloper = (req, res, next) => { if (req.session?.user?.email !== DEVELOPER_PHONE) return res.status(403).send('Access Denied'); next(); };

app.get('/dev/master', requireAuth, requireDeveloper, ah(async (req, res) => {
  const stats = {
    tenants: (await pool.query('SELECT COUNT(*) as c FROM tenants')).rows[0].c,
    users: (await pool.query('SELECT COUNT(*) as c FROM users')).rows[0].c,
    revenue_30d: (await pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`)).rows[0].t,
    wallet: (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0]?.balance || 0,
    products: (await pool.query('SELECT COUNT(*) as c FROM products')).rows[0].c
  };

  const tenants = (await pool.query('SELECT id,name,subdomain,type,wallet_balance,subscription_plan,verified,features_enabled FROM tenants ORDER BY created_at DESC LIMIT 50')).rows;
  
  res.send(renderPage('Dev Master Control', `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);color:white;padding:40px 20px;border-radius:20px;text-align:center"><h1>🔴 DEVELOPER MASTER CONTROL</h1>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${stats.tenants}</div><div>Active Tenants</div></div>
      <div class="stat-card"><div class="stat-num">${stats.users}</div><div>Total Users</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${Math.round(stats.revenue_30d).toLocaleString()}</div><div>30 Day Rev</div></div>
      <div class="data-card"><div class="stat-num">UGX ${stats.wallet.toLocaleString()}</div><div>Ready Withdraw</div></div>
    </div>

    <div class="card"><h2>Manual Controls</h2>
      <form method="POST" action="/dev/execute">
        <select name="action" required>
          <option value="">Select Action</option>
          <option value="add_balance">Add Balance to Tenant</option>
          <option value="verify_tenant">Force Verify Tenant</option>
          <option value="ban_user">Ban User</option>
          <option value="delete_tenant">Delete Tenant</option>
          <option value="grant_admin">Grant Super Admin</option>
          <option value="withdraw_all">Withdraw All Revenue</option>
        </select>
        <input name="target_id" placeholder="Tenant/User ID" required>
        <input name="amount" type="number" placeholder="Amount if applicable">
        <button class="btn">Execute</button>
      </form>
    </div>

    <div class="card"><h2>All Tenants</h2>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Plan</th><th>Verified</th><th>Actions</th></tr>
        <tbody>
          ${tenants.map(t => `
            <tr><td>${t.id}</td>
            <td>${esc(t.name)}</td>
            <td>${esc(t.type)}</td>
            <td>${esc(t.subscription_plan)}</td>
            <td>UGX ${t.wallet_balance.toLocaleString()}</td>
            <td>${t.verified ? '✅' : '❌'}</td>
            <td><a href="/dev/edit-tenant/${t.id}" class="btn">Edit</a></td>
          </tr>`).join('') || '<tr><td colspan="8">No tenants yet</td></tr>'
        </tbody>
      </table>
    </div>
  `));
}));


// === DATABASE INITIALIZATION (MASTER) ===
async function initDB() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    
    // 1. BASE TABLES
    await c.query(`CREATE TABLE IF NOT EXISTS session (sid varchar NOT NULL, sess json NOT NULL, expire timestamp NOT NULL, PRIMARY KEY (sid))`);
    await c.query(`CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT, subdomain TEXT UNIQUE, type TEXT DEFAULT 'school', description TEXT, gateway TEXT DEFAULT 'mtn', momo_number_encrypted TEXT, momo_name TEXT, bank_name TEXT, bank_account TEXT, wallet_balance INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS features_enabled JSONB DEFAULT '{"dashboard":true,"finance":true,"academics":true,"ai_chatbot":false,"ussd_gateway":false,"offline_sync":false}'::jsonb`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS about_us TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_code TEXT`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE`);
    await c.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, role TEXT, portals TEXT[], classes TEXT[], full_name TEXT, phone TEXT, approved BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance INTEGER DEFAULT 0`);

    // 2. SCHOOL & MARKETPLACE TABLES
    await c.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, class TEXT, parent_phone TEXT, balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, subject TEXT, score NUMERIC, grade TEXT, term TEXT, teacher_id INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, amount NUMERIC, term TEXT, year INTEGER, payment_method TEXT, paid BOOLEAN DEFAULT false, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, date DATE, status TEXT DEFAULT 'present', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS marketplace_products (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, description TEXT, price NUMERIC, stock INT, category TEXT, image TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS marketplace_orders (id SERIAL PRIMARY KEY, user_id INT, ref TEXT, total INT, commission INT, address TEXT, phone TEXT, payment_method TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    
    // 3. V5.5 SYSTEM TABLES
    await c.query(`CREATE TABLE IF NOT EXISTS otp_codes (id SERIAL PRIMARY KEY, user_id INT, code TEXT, expires_at TIMESTAMPTZ DEFAULT NOW())` used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, frequency TEXT, next_charge TIMESTAMPTZ, last_charged TIMESTAMPTZ, status TEXT DEFAULT 'active')`);
    await c.query(`CREATE TABLE IF NOT EXISTS fund_opportunities (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, summary TEXT, description TEXT, amount INT, currency TEXT, deadline DATE, category TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fund_applications (id SERIAL PRIMARY KEY, opportunity_id INT, donor_id INT, amount INT, currency TEXT, proposal TEXT, docs_url TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS verification_docs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, doc_type TEXT, file_url TEXT, status TEXT DEFAULT 'pending', reviewed_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, action TEXT, details JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    
    // 4. V6.0 NEW TABLES
    await c.query(`CREATE TABLE IF NOT EXISTS employer_matches (id SERIAL PRIMARY KEY, tenant_id INT, company_name TEXT, match_ratio INT, max_annual NUMERIC, contact_email TEXT, requirements TEXT, verified BOOLEAN DEFAULT false, matched_ytd NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS social_takeovers (id SERIAL PRIMARY KEY, tenant_id INT, student_name TEXT, date DATE, platform TEXT, status TEXT DEFAULT 'scheduled', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS news_articles (id SERIAL PRIMARY KEY, tenant_id INT, author_id INT, title TEXT, summary TEXT, content TEXT, published BOOLEAN DEFAULT false, views INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS advertisements (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, image_url TEXT, daily_budget INT, target_audience TEXT, active BOOLEAN DEFAULT true, clicks INT DEFAULT 0, impressions INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS entertainment (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, category TEXT, description TEXT, file_url TEXT, views INT DEFAULT 0, created_at TIMESTAMPTZ POST DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS programs (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, duration TEXT, price NUMERIC DEFAULT 0, max_students INT, level TEXT, enrolled INT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS budgets (id SERIAL PRIMARY KEY, tenant_id INT, category TEXT, amount INT, spent INT DEFAULT 0, period TEXT, year INT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS email_verifications (id SERIAL PRIMARY KEY, user_id INT, token TEXT, expires_at TIMESTAMPTZ DEFAULT NOW(), used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, dev_amount INT, purpose TEXT, payer_name TEXT, payer_phone_encrypted TEXT, payer_email_encrypted TEXT, gateway TEXT, ref TEXT, status TEXT, receipt_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, type TEXT, student_id INT, description TEXT, reference_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`);
    await `INSERT INTO platform_wallet (id,balance) VALUES (1,0) ON CONFLICT DO NOTHING`);
    await c.query(`CREATE TABLE IF NOT EXISTS withdrawal_requests (id SERIAL PRIMARY KEY, tenant_id INT, user_email TEXT, amount INT, net_amount INT, phone TEXT, fee NUMERIC DEFAULT 0, net_amount INT, status TEXT, ref TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS referral_stats (id SERIAL PRIMARY KEY, referrer_email TEXT, referred_email TEXT, signup_date TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS parents (id SERIAL PRIMARY KEY, phone TEXT UNIQUE NOT NULL, tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE, verified BOOLEAN DEFAULT false, created_at TIMESTAM TO NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS parent_otps (id SERIAL PRIMARY KEY, phone TEXT, otp TEXT, expires_at TIMESTAMPTZ DEFAULT NOW(), used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS gallery_albums (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    
    // 5. PREMIUM LISTINGS & WALLET
    await c.query(`CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, frequency TEXT, next_charge TIMESTAMPTZ, last_charged TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'active')`);
    
    await c.query('COMMIT');
    console.log('DB v6.0 Ready - All Features + Dev Portal');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    c.release();
  }
}

// Start Server
initDB().then(() => app.listen(PORT, () => console.log(`SSEWASSWA v6.0 COMPLETE - All Features + Dev Portal LIVE on ${PORT}`)));

// === END OF SERVER.JS ===
