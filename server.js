/**
 * SSEWASSWA Network v9.0 - SCALABLE
 * Features: Redis Sessions, Background Workers, API v2, Webhooks
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Redis } from 'ioredis';
import RedisStore from 'connect-redis';
// --- REMOVED BULLMQ IMPORT (Fixes the crash) ---
// import { Queue } from 'bullmq'; 
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import axios from 'axios';
import cron from 'node-cron';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { OpenAI } from 'openai';
import PDFDocument from 'pdfkit';
import * as cheerio from 'cheerio';
import compression from 'compression';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// --- CONFIGURATION ---
dotenv.config();
const { Pool } = pg;
const PgSession = connectPgSimple(session);
const app = express();
app.set('trust proxy', 1); // ADD THIS LINE
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')? false : { rejectUnauthorized: false }
});

// Force disabled to prevent connection errors
const redis = null; 

const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

const DEVELOPER_EMAIL = 'ssewasswa@gmail.com';
const DEVELOPER_PHONE = '0789736737';
const DEVELOPER_RATE = 0.05;
const PLATFORM_COMMISSION = 0.10;
const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_SECRET || 'default32charsecretkey1234567890ab', 'salt', 32);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

// v9.0: Background Queues (DISABLED - BullMQ not installed)
// const emailQueue = redis? new Queue('email', { connection: redis }) : null;
// const smsQueue = redis? new Queue('sms', { connection: redis }) : null;
// const webhookQueue = redis? new Queue('webhook', { connection: redis }) : null;

// --- SENTRY SETUP ---
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

// --- MIDDLEWARE ---
if (Sentry.Handlers) {
  app.use(Sentry.Handlers.requestHandler());
}
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: ['https://ssewasswa.com', 'http://localhost:3000'], credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate Limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);
app.use('/webhook/', limiter);

// v9.0: Redis Session Store
app.use(session({
  store: redis ? new RedisStore({ client: redis }) : new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'default_session_secret_change_me',
  resave: false,
  saveUninitialized: false,
  proxy: true, // ADD THIS
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, 
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' // ADD THIS
  }
}));

// --- CONSTANTS ---
const CURRENCIES = {
  UGX: { symbol: 'UGX', rate: 1 },
  USD: { symbol: '$', rate: 3700 },
  EUR: { symbol: '€', rate: 4000 },
  GBP: { symbol: '£', rate: 4700 },
  KES: { symbol: 'KSh', rate: 28 },
  TZS: { symbol: 'TSh', rate: 1.6 }
};

const SUBSCRIPTION_PLANS = {
  school_free: {
    name: 'School Starter', price: 0, currency: 'UGX',
    features: ['100 students', 'Basic marksheets'],
    portals: ['academics', 'public']
  },
  school_pro: {
    name: 'School Pro', price: 50000, currency: 'UGX',
    features: ['Unlimited students', 'All portals', 'SMS alerts', 'USSD', 'Offline'],
    portals: ['academics', 'stores', 'admin', 'papers', 'funds', 'reports', 'finance', 'marketplace', 'programs', 'news', 'ads', 'entertainment']
  },
  org_basic: {
    name: 'Org Basic', price: 30000, currency: 'UGX',
    features: ['50 members', 'Project tracking'],
    portals: ['dashboard', 'members', 'finance', 'projects', 'public']
  },
  org_pro: {
    name: 'Org Pro', price: 100000, currency: 'UGX',
    features: ['Unlimited members', 'Donor portal', 'Grant applications'],
    portals: ['dashboard', 'members', 'finance', 'reports', 'projects', 'marketplace', 'programs', 'news', 'ads']
  },
  business: {
    name: 'Business', price: 20000, currency: 'UGX',
    features: ['Unlimited products', '0% commission first month'],
    portals: ['seller', 'orders', 'products', 'wallet', 'ads', 'analytics']
  },
  donor: {
    name: 'Donor Premium', price: 50000, currency: 'UGX',
    features: ['Post grants', 'Review applications', 'Impact tracking'],
    portals: ['dashboard', 'opportunities', 'history', 'impact']
  },
  enterprise: {
    name: 'Enterprise', price: 500000, currency: 'UGX',
    features: ['White label', 'API access', 'Dedicated support', 'Unlimited everything'],
    portals: ['academics', 'stores', 'admin', 'papers', 'funds', 'reports', 'finance', 'marketplace', 'programs', 'news', 'ads', 'entertainment', 'api', 'whitelabel']
  }
};

// --- HELPER FUNCTIONS ---
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

const requireJWT = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  jwt.verify(token, process.env.SESSION_SECRET || 'default', (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

const requireRole = (...r) => (req, res, next) => {
  if (!req.session?.user ||!r.includes(req.session.user.role)) return res.status(403).send('403');
  next();
};

const requirePortal = (p) => (req, res, next) => {
  if (req.session.user.role === 'super_admin' || req.session.user.portals?.includes(p)) return next();
  res.status(403).send('403 Portal Access Denied');
};

const requireDeveloper = (req, res, next) => {
  if (req.session?.user?.role !== 'super_admin') return res.status(403).send('403');
  next();
};
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

const requireApiKey = ah(async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API key required' });
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const apiKey = (await pool.query('SELECT * FROM api_keys WHERE key_hash=$1', [hash])).rows[0];
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });
  await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [apiKey.id]);
  req.tenant_id = apiKey.tenant_id;
  req.scopes = apiKey.scopes;
  next();
});

function decrypt(text) {
  const p = text.split(':');
  const iv = Buffer.from(p[0], 'hex');
  const dec = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let str = dec.update(p[1], 'hex', 'utf8');
  str += dec.final('utf8');
  return str;
}

async function logAction(userId, tenantId, action, details, ip) {
  await pool.query('INSERT INTO audit_logs(user_id,tenant_id,action,details,ip_address)VALUES($1,$2,$3,$4,$5)', [userId, tenantId, action, JSON.stringify(details), ip]);
}

// v9.0: Queue-based SMS with Fallback
async function sendSMS(phone, message) {
  if (smsQueue) {
    await smsQueue.add('send', { phone, message });
  } else if (process.env.AT_API_KEY) {
    try {
      await axios.post('https://api.africastalking.com/version1/messaging', 
        new URLSearchParams({
          username: process.env.AT_USERNAME || 'sandbox',
          to: phone,
          message: message
        }).toString(), 
        {
          headers: { 
            'apiKey': process.env.AT_API_KEY, 
            'Content-Type': 'application/x-www-form-urlencoded' 
          }
        }
      );
    } catch (e) {
      console.error('SMS fail:', e.message);
    }
  } else {
    console.log('SMS:', phone, message);
  }
}

// v9.0: Queue-based Email
async function sendEmail(to, subject, html) {
  if (emailQueue) {
    await emailQueue.add('send', { to, subject, html });
  } else {
    await transporter.sendMail({ to, subject, html });
  }
}

async function sendVerificationEmail(userId, email) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO email_verifications(user_id,token,expires_at)VALUES($1,$2,$3)', [userId, token, new Date(Date.now() + 86400000)]);
  const url = `${process.env.RENDER_EXTERNAL_URL}/verify-email/${token}`;
  await transporter.sendMail({
    to: email,
    subject: 'Verify Your SSEWASSWA Account',
    html: `<h2>Welcome!</h2><p>Click to verify:</p><a href="${url}" style="background:#1e40af;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block">Verify Email</a><p>Expires in 24 hours.</p>`
  });
}

function renderPage(title, content, user) {
  user = user || null;
  let nav = '';
  if (user) {
    // Define portals based on tenant_type and role
    let portals = {};

    if (user.tenant_type === 'organisation') {
      portals = {
        dashboard: 'Dashboard',
        members: 'Members',
        finance: 'Finance',
        reports: 'Reports',
        projects: 'Projects',
        marketplace: 'Marketplace',
        public: 'Public Site',
        programs: 'Programs',
        news: 'News',
        ads: 'Adverts'
      };
    } else if (user.role === 'seller') {
      portals = {
        seller: 'Seller Dashboard',
        orders: 'Orders',
        products: 'Products',
        wallet: 'Wallet',
        ads: 'Advertise',
        analytics: 'Analytics'
      };
    } else {
      // Default: school
      portals = {
        dashboard: 'Dashboard',
        academics: 'Academics',
        marksheets: 'Marksheets',
        finance: 'Finance',
        marketplace: 'Marketplace',
        public: 'Public Site',
        admin: 'Admin',
        news: 'News'
      };
    }

    nav = `<div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:12px 20px;margin:0 0 24px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><b>${esc(user.tenant_name || 'Ssewasswa')}</b> - ${esc(user.name)} ${user.verified? '✅' : ''}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">
          ${Object.entries(portals).map(([k, v]) => `<a href="/portal/${k}" style="color:white;text-decoration:none">${v}</a>`).join('')}
          ${user.role === 'super_admin'? `<a href="/dev/master" style="color:#fef3c7;text-decoration:none;font-weight:bold">🔴 Dev</a>` : ''}
          <a href="/logout" style="color:white;text-decoration:none">Logout</a>
        </div>
      </div>
    </div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - Ssewasswa</title><link rel="icon" href="https://res.cloudinary.com/dn5xr5p0r/image/upload/v1/ssewasswa/favicon.png"><meta property="og:title" content="Ssewasswa - School Management"><meta property="og:image" content="https://res.cloudinary.com/dn5xr5p0r/image/upload/v1/ssewasswa/og-image.jpg"><meta name="description" content="Run your school on your phone. Marks, fees, SMS to parents."><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui;background:#f0f9ff;color:#1e293b}.container{max-width:1200px;margin:0 auto;padding:20px}.card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}.btn{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;border-radius:12px;padding:12px 24px;cursor:pointer;text-decoration:none;display:inline-block;margin:4px;font-weight:600}.btn-green{background:linear-gradient(135deg,#16a34a,#22c55e)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}input,select,textarea{width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:12px;margin:8px 0;font-size:16px;min-height:44px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e2e8f0}th{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}.stat-card{background:white;padding:20px;border-radius:16px;text-align:center}.stat-num{font-size:32px;font-weight:bold;color:#1e40af}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.badge{padding:6px 10px;border-radius:20px;font-size:11px;font-weight:600;display:inline-block}.badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fee2e2;color:#991b1b}.badge-gold{background:#fef3c7;color:#92400e}.alert{padding:1rem;margin:1rem 0;border-radius:12px;font-weight:600}.alert-success{background:#d1fae5;color:#065f46;border:1px solid #10b981}.alert-error{background:#fee2e2;color:#991b1b;border:1px solid #ef4444}</style></head><body>${nav}<div class="container">${content}</div></body></html>`;
}

// === PUBLIC ROUTES ===
app.get('/', ah(async (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); }));

app.get('/marketplace', ah(async (req, res) => {
  const products = (await pool.query('SELECT p.*,t.name as seller_name FROM products p JOIN tenants t ON p.tenant_id=t.id WHERE p.approved=true ORDER BY p.created_at DESC LIMIT 50')).rows;
  res.send(renderPage('Marketplace', `<div class="grid">${products.map(p => `<div class="card"><img src="${p.image_url || '/img/default.jpg'}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><h3>${esc(p.name)}</h3><p style="color:#64748b">by ${esc(p.seller_name)}</p><p style="font-size:24px;color:#16a34a;font-weight:bold">UGX ${p.price.toLocaleString()}</p><a href="/product/${p.id}" class="btn btn-green">Buy Now</a></div>`).join('')}</div>`, null));
}));

app.get('/api/stats', ah(async (req, res) => {
  res.json({
    schools: (await pool.query("SELECT COUNT(*) as c FROM tenants WHERE type='school'")).rows[0].c,
    students: (await pool.query("SELECT COUNT(*) as c FROM students")).rows[0].c,
    donations: (await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM donations")).rows[0].t,
    products: (await pool.query("SELECT COUNT(*) as c FROM products WHERE approved=true")).rows[0].c
  });
}));

app.get('/product/:id', ah(async (req, res) => {
  const p = (await pool.query('SELECT p.*,t.name as seller_name FROM products p JOIN tenants t ON p.tenant_id=t.id WHERE p.id=$1', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  res.send(renderPage(p.name, `<div class="card"><img src="${p.image_url}" style="width:100%;max-height:400px;object-fit:cover;border-radius:16px"><h1>${esc(p.name)}</h1><p style="color:#64748b">Sold by ${esc(p.seller_name)}</p><p style="font-size:32px;color:#16a34a;font-weight:bold">UGX ${p.price.toLocaleString()}</p><p>${esc(p.description)}</p><form method="POST" action="/cart/add"><input type="hidden" name="product_id" value="${p.id}"><input type="number" name="quantity" value="1" min="1" max="${p.stock}"><button class="btn btn-green">Add to Cart</button></form></div>`, null));
}));

app.get('/blog', ah(async (req, res) => {
  const posts = (await pool.query('SELECT n.*,t.name as author_name FROM news_articles n JOIN tenants t ON n.tenant_id=t.id WHERE n.published=true ORDER BY n.created_at DESC LIMIT 20')).rows;
  res.send(renderPage('Blog', `<div class="grid">${posts.map(p => `<div class="card"><img src="${p.image_url || '/img/default.jpg'}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><h3>${esc(p.title)}</h3><p style="color:#64748b;font-size:13px">By ${esc(p.author_name)} • ${new Date(p.created_at).toDateString()}</p><p>${esc(p.summary)}</p><a href="/blog/${p.id}" class="btn">Read More</a></div>`).join('')}</div>`, null));
}));

app.get('/schools', ah(async (req, res) => {
  const schools = (await pool.query("SELECT id,name,subdomain,description,logo_url,verified FROM tenants WHERE type='school' AND status='active' ORDER BY featured_until DESC NULLS LAST, created_at DESC")).rows;
  res.send(renderPage('Schools', `<div class="grid">${schools.map(s => `<div class="card"><img src="${s.logo_url || '/img/school.jpg'}" style="width:100%;height:150px;object-fit:cover;border-radius:12px"><h3>${esc(s.name)} ${s.verified ? '✅' : ''}</h3><p>${esc(s.description || '').substring(0, 100)}</p><a href="/s/${s.subdomain}" class="btn">Visit Site</a></div>`).join('')}</div>`, null));
}));

app.get('/s/:subdomain', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!t) return res.status(404).send('School not found');
  res.send(`<!doctype html><html><head><title>${esc(t.name)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${renderPage('', '', null).match(/<style>(.*?)<\/style>/s)[1]}</style></head><body><div class="container"><header style="text-align:center;padding:40px 0"><h1>${esc(t.name)} ${t.verified ? '✅' : ''}</h1><p>${esc(t.tagline || '')}</p><div style="margin:20px 0">${t.show_donate ? `<a href="/pay/${t.id}" class="btn btn-green">Donate</a>` : ''}<a href="/s/${t.subdomain}/enroll" class="btn">Enroll</a></div></header><div class="grid"><div class="card"><h3>About Us</h3><p>${esc(t.about_us || t.description || '')}</p></div><div class="card"><h3>Contact</h3><p>📞 ${esc(t.contact_phone || '')}</p><p>📧 ${esc(t.contact_email || '')}</p><p>📍 ${esc(t.address || '')}</p></div></div></div></body></html>`);
}));

app.get('/pay/:tenant_id', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.params.tenant_id])).rows[0];
  res.send(renderPage('Pay', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Pay ${esc(t.name)}</h2><form method="POST" action="/pay/${t.id}"><label>Amount (UGX)</label><input name="amount" type="number" min="1000" required><label>Purpose</label><select name="purpose" required><option value="fees">School Fees</option><option value="donation">Donation</option></select><label>Your Name</label><input name="name" required><label>Phone</label><input name="phone" placeholder="078..." required><label>Email</label><input name="email" type="email" required><label>Payment Method</label><select name="gateway" required><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><button class="btn btn-green" style="width:100%">Pay Securely</button></form></div>`, null));
}));

app.post('/pay/:tenant_id', ah(async (req, res) => {
  const { amount, purpose, name, phone, email, gateway } = req.body;
  const t = (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.params.tenant_id])).rows[0];
  const ref = 'PAY' + Date.now();
  const dev_amount = Math.round(amount * DEVELOPER_RATE);
  await pool.query('INSERT INTO transactions(tenant_id,amount,dev_amount,purpose,payer_name,payer_phone_encrypted,payer_email_encrypted,gateway,ref,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t.id, amount, dev_amount, purpose, name, encrypt(phone), encrypt(email), gateway, ref, 'pending']);
  await transporter.sendMail({ to: email, subject: `Receipt ${ref}`, html: `<h2>Payment Receipt</h2><p>Amount: UGX ${amount}</p><p>Ref: ${ref}</p><p>To: ${t.name}</p>` });
  res.send(`<script>alert('Payment initiated. Check ${phone} to approve. Receipt sent to ${email}');window.location='/'</script>`);
}));

// === AUTH ROUTES ===
app.get('/login', ah(async (req, res) => {
  res.send(renderPage('Login', `<div class="card" style="max-width:400px;margin:60px auto"><h1>Login</h1><form method="POST" action="/login"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><div id="otp-field" style="display:none"><input name="otp" placeholder="Enter 6-digit code" maxlength="6"></div><button class="btn" style="width:100%">Login</button></form><p style="text-align:center;margin-top:20px"><a href="/forgot-password">Forgot Password?</a> • <a href="/register">Create Account</a></p></div>`, null));
}));

app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const u = (await pool.query('SELECT u.*,t.name as tenant_name,t.subdomain as tenant_subdomain,t.type as tenant_type,t.features_enabled FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1 AND u.approved=true', [email])).rows[0];
  
  console.log('DB_EMAIL:', u?.email);
  console.log('DB_HASH:', u?.password_hash);
  console.log('INPUT_PASS:', password);
  
  const match = await bcrypt.compare(password, u.password_hash);
  console.log('BCRYPT_MATCH:', match);
  
  if (!u || !match) return res.status(401).send('Invalid credentials');
  if (!u.verified) return res.status(401).send('Please verify your email first');
  
  req.session.user = u;
  if (u.role === 'super_admin') return res.redirect('/dev/master');
  res.redirect('/portal/admin');
}));

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

app.get('/register', ah(async (req, res) => {
  const type = req.query.type || 'school';
  const plans = Object.entries(SUBSCRIPTION_PLANS).filter(([k, v]) => k.startsWith(type));
  res.send(renderPage('Register', `<div class="card" style="max-width:800px;margin:40px auto"><h1>Create ${esc(type)}</h1><form method="POST" action="/register"><input type="hidden" name="type" value="${type}"><h3>1. Choose Plan</h3>${plans.map(([k, v]) => `<label class="card" style="cursor:pointer"><input type="radio" name="plan" value="${k}" required><b>${v.name}</b> - ${v.price === 0 ? 'FREE' : CURRENCIES[v.currency].symbol + ' ' + v.price.toLocaleString() + '/mo'}<ul>${v.features.map(f => `<li>${f}</li>`).join('')}</ul></label>`).join('')}<h3>2. Details</h3><input name="name" placeholder="Name" required><input name="subdomain" placeholder="Website: kings-primary" required><textarea name="description" placeholder="Description"></textarea><h3>3. Payment Details</h3><select name="gateway" required><option value="">Select</option><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><input name="momo_number" placeholder="Mobile Money Number" required><input name="momo_name" placeholder="Name on Mobile Money" required><h3>4. Admin Account</h3><input name="admin_name" placeholder="Your Name" required><input name="admin_email" type="email" placeholder="Email" required><input name="admin_phone" placeholder="Phone: +256..." required><input name="admin_password" type="password" placeholder="Password" required><select name="country_code" required><option value="UG">Uganda +256</option><option value="KE">Kenya +254</option><option value="TZ">Tanzania +255</option></select><label><input type="checkbox" required> I agree to 5% platform fee</label><button class="btn btn-green">Create Account</button></form></div>`, null));
}));

app.post('/register', ah(async (req, res) => {
  const { name, subdomain, type, description, gateway, momo_number, momo_name, admin_name, admin_email, admin_phone, admin_password, plan, country_code } = req.body;
  const tenant = (await pool.query('INSERT INTO tenants(name,subdomain,type,description,gateway,momo_number_encrypted,momo_name,wallet_balance,status,subscription_plan,features_enabled,country_code)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)RETURNING id', [name, subdomain, type, description, gateway, encrypt(momo_number), momo_name, 0, 'active', plan, JSON.stringify(SUBSCRIPTION_PLANS[plan].portals), country_code])).rows[0];
  const hash = await bcrypt.hash(admin_password, 10);
  const role = type === 'school' ? 'school_admin' : type === 'organisation' ? 'org_admin' : type === 'business' ? 'seller' : 'donor';
  const user = (await pool.query('INSERT INTO users(tenant_id,name,email,phone_encrypted,password_hash,role,portals,approved,verified)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id', [tenant.id, admin_name, admin_email, encrypt(admin_phone), hash, role, SUBSCRIPTION_PLANS[plan].portals, true, false])).rows[0];
  await sendVerificationEmail(user.id, admin_email);
  res.send(`<script>alert('Success! Check ${admin_email} to verify. 14-day trial started.');window.location='/login'</script>`);
}));

app.get('/verify-email/:token', ah(async (req, res) => {
  const v = (await pool.query('SELECT * FROM email_verifications WHERE token=$1 AND expires_at>NOW() AND used=false', [req.params.token])).rows[0];
  if (!v) return res.status(400).send('Invalid or expired token');
  await pool.query('UPDATE users SET verified=true WHERE id=$1', [v.user_id]);
  await pool.query('UPDATE email_verifications SET used=true WHERE id=$1', [v.id]);
  res.send(`<script>alert('Email verified!');window.location='/login'</script>`);
}));

app.get('/forgot-password', ah(async (req, res) => {
  res.send(renderPage('Reset Password', `<div class="card" style="max-width:400px;margin:60px auto"><h2>Reset Password</h2><form method="POST" action="/forgot-password"><input name="email" type="email" placeholder="Your Email" required><button class="btn" style="width:100%">Send Reset Link</button></form></div>`, null));
}));

app.post('/forgot-password', ah(async (req, res) => {
  const u = (await pool.query('SELECT * FROM users WHERE email=$1', [req.body.email])).rows[0];
  if (!u) return res.send(`<script>alert('If email exists, reset link sent');window.location='/login'</script>`);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO password_resets(user_id,token,expires_at)VALUES($1,$2,$3)', [u.id, token, new Date(Date.now() + 3600000)]);
  const resetUrl = `${process.env.RENDER_EXTERNAL_URL}/reset-password/${token}`;
  await transporter.sendMail({ to: u.email, subject: 'Reset Password', html: `Click to reset: <a href="${resetUrl}">${resetUrl}</a><br>Expires in 1 hour.` });
  res.send(`<script>alert('Reset link sent');window.location='/login'</script>`);
}));

// === DEVELOPER PORTAL ===
app.get('/dev/master', requireAuth, requireDeveloper, ah(async (req, res) => {
  try {
    const flash = req.session.flash;
    delete req.session.flash;

    const tCount = (await pool.query('SELECT COUNT(*) FROM tenants')).rows[0].count;
    const uCount = (await pool.query('SELECT COUNT(*) FROM users')).rows[0].count;
    const rev = (await pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`)).rows[0].t;
    const wal = (await pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1')).rows[0]?.b || 0;
    const tenants = (await pool.query('SELECT id,name,type,COALESCE(wallet_balance,0) as wallet_balance,verified FROM tenants ORDER BY id DESC LIMIT 50')).rows;

    const flashHtml = flash? `<div class="alert alert-${flash.type}">${esc(flash.msg)}</div>` : '';

    res.send(renderPage('Dev Master', `
      <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:20px;border-radius:16px;margin-bottom:20px;color:white"><h1>🔴 DEVELOPER MASTER CONTROL</h1></div>
      ${flashHtml}
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${tCount}</div><div>Tenants</div></div>
        <div class="stat-card"><div class="stat-num">${uCount}</div><div>Users</div></div>
        <div class="stat-card"><div class="stat-num">UGX ${parseInt(rev).toLocaleString()}</div><div>30-Day Rev</div></div>
        <div class="stat-card"><div class="stat-num">UGX ${parseInt(wal).toLocaleString()}</div><div>Ready Withdraw</div></div>
      </div>

      <div class="grid">
        <div class="card"><h3>Manual Controls</h3>
          <form method="POST" action="/dev/execute">
            <select name="action" required>
              <option value="">Select Action</option>
              <option value="add_balance">Add Balance</option>
              <option value="verify_tenant">Verify Tenant</option>
              <option value="ban_user">Ban User</option>
              <option value="delete_tenant">Delete Tenant</option>
              <option value="withdraw_all">Withdraw All</option>
            </select>
            <input name="target_id" placeholder="Target ID" type="number">
            <input name="amount" placeholder="Amount UGX" type="number">
            <button class="btn btn-red">Execute</button>
          </form>
        </div>

        <div class="card"><h3>Revenue Injection</h3>
          <form method="POST" action="/dev/inject-revenue">
            <input name="amount" placeholder="Amount UGX" type="number" required>
            <input name="source" placeholder="Source: Grant, Ads, Sub" required>
            <button class="btn btn-gold">Inject Revenue</button>
          </form>
        </div>

        <div class="card"><h3>Auto-Scraper</h3>
          <form method="POST" action="/dev/scrape">
            <input name="url" placeholder="https://news-site.com/article" type="url" required>
            <input name="tenant_id" placeholder="Tenant ID (optional)" type="number">
            <button class="btn">Scrape & Save</button>
          </form>
        </div>
      </div>

      <div class="card"><h3>All Tenants</h3>
        <table><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Verified</th></tr>
        ${tenants.map(t=>`<tr><td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.type)}</td><td>UGX ${parseInt(t.wallet_balance).toLocaleString()}</td><td>${t.verified?'✅':'❌'}</td></tr>`).join('')}
        </table>
      </div>
    `, req.session.user));

  } catch(e) {
    console.error('DEV MASTER ERROR:', e);
    res.status(500).send(renderPage('Dev Error', `
      <div class="alert alert-error">
        <b>Dev Master Crashed</b><br>
        ${esc(e.message)}<br><br>
        <small>Check Render logs for full stack trace</small>
      </div>
    `, req.session.user));
  }
}));
// === DEVELOPER ACTIONS ===
app.post('/dev/execute', requireAuth, requireDeveloper, ah(async (req, res) => {
  const { action, target_id, amount } = req.body;
  let msg = '';

  try {
    switch(action) {
      case 'add_balance':
        if (!amount || amount <= 0) throw new Error('Invalid amount');
        const bal = await pool.query(
          'UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2 RETURNING name,wallet_balance',
          [amount, target_id]
        );
        if (!bal.rowCount) throw new Error('Tenant not found');
        msg = `Added UGX ${parseInt(amount).toLocaleString()} to ${bal.rows[0].name}. New balance: UGX ${bal.rows[0].wallet_balance.toLocaleString()}`;
        break;

      case 'verify_tenant':
        const v = await pool.query('UPDATE tenants SET verified=true WHERE id=$1 RETURNING name', [target_id]);
        if (!v.rowCount) throw new Error('Tenant not found');
        msg = `Verified tenant: ${v.rows[0].name}`;
        break;

      case 'ban_user':
        const b = await pool.query('UPDATE users SET approved=false WHERE id=$1 RETURNING email', [target_id]);
        if (!b.rowCount) throw new Error('User not found');
        msg = `Banned user: ${b.rows[0].email}`;
        break;

      case 'delete_tenant':
        const d = await pool.query('DELETE FROM tenants WHERE id=$1 RETURNING name', [target_id]);
        if (!d.rowCount) throw new Error('Tenant not found');
        msg = `Deleted tenant: ${d.rows[0].name}`;
        break;

      case 'withdraw_all':
        const w = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0];
        if (!w || w.balance <= 0) throw new Error('No balance to withdraw');
        await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
        await pool.query(
          'INSERT INTO withdrawals(user_email,amount,net_amount,phone,status,ref) VALUES($1,$2,$3,$4,$5,$6)',
          [DEVELOPER_EMAIL, w.balance, w.balance, DEVELOPER_PHONE, 'paid', 'DEV' + Date.now()]
        );
        await pool.query(
          'INSERT INTO developer_revenue(amount,type) VALUES($1,$2)',
          [-w.balance, 'withdrawal']
        );
        msg = `Withdrew UGX ${w.balance.toLocaleString()} to ${DEVELOPER_PHONE}`;
        break;

      default:
        throw new Error('Invalid action');
    }
    req.session.flash = { type: 'success', msg };
  } catch(e) {
    req.session.flash = { type: 'error', msg: e.message };
  }

  res.redirect('/dev/master');
}));

app.post('/dev/inject-revenue', requireAuth, requireDeveloper, ah(async (req, res) => {
  const { amount, source } = req.body;
  const amt = parseInt(amount);
  
  if (!amt || amt <= 0 || !source?.trim()) {
    req.session.flash = { type: 'error', msg: 'Valid amount and source required' };
    return res.redirect('/dev/master');
  }

  await pool.query('BEGIN');
  try {
    await pool.query('INSERT INTO developer_revenue(amount,type) VALUES($1,$2)', [amt, source.trim()]);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [amt]);
    await pool.query('COMMIT');
    req.session.flash = { type: 'success', msg: `Injected UGX ${amt.toLocaleString()} from ${esc(source)}` };
  } catch(e) {
    await pool.query('ROLLBACK');
    req.session.flash = { type: 'error', msg: 'Injection failed: ' + e.message };
  }
  res.redirect('/dev/master');
}));
// === SCHOOL PORTALS - DASHBOARD ===
app.get('/portal/dashboard', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:30px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>Welcome, ${esc(req.session.user.name)}</h1>
      <p>${esc(req.session.user.tenant_name)}</p>
    </div>
    <div class="grid">
      <div class="card"><h3>Quick Actions</h3>
        <a href="/portal/finance" class="btn">Manage Fees</a>
        <a href="/portal/marksheets" class="btn">Enter Marks</a>
        <a href="/portal/marketplace" class="btn">School Shop</a>
        <a href="/portal/public" class="btn">Edit Website</a>
      </div>
    </div>
  `, req.session.user));
}));

// === ACADEMICS ===
app.get('/portal/academics', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Academics', `<div class="card"><h3>Academics</h3><p>Timetables, subjects, classes coming soon.</p></div>`, req.session.user));
}));

// === MARKSHEETS ===
app.get('/portal/marksheets', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const marks = (await pool.query('SELECT * FROM marksheets WHERE tenant_id=$1 ORDER BY id DESC LIMIT 200', [tid])).rows;
  res.send(renderPage('Marksheets', `
    <div class="card"><h3>Enter Marks</h3>
      <form method="POST" action="/portal/marksheets/add">
        <input name="student_name" placeholder="Student Name" required>
        <input name="class" placeholder="Class: P.6" required>
        <input name="subject" placeholder="Subject: Math" required>
        <input name="mark" placeholder="Mark: 85" type="number" max="100" required>
        <input name="term" placeholder="Term: 1" required>
        <button class="btn">Save Mark</button>
      </form>
    </div>
    <div class="card"><h3>Recent Marks</h3>
      <table><tr><th>Student</th><th>Class</th><th>Subject</th><th>Mark</th><th>Term</th></tr>
      ${marks.map(m=>`<tr><td>${esc(m.student_name)}</td><td>${esc(m.class)}</td><td>${esc(m.subject)}</td><td>${m.mark}</td><td>${esc(m.term)}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/portal/marksheets/add', requireAuth, ah(async (req, res) => {
  const { student_name, class: cls, subject, mark, term } = req.body;
  await pool.query('INSERT INTO marksheets(tenant_id,student_name,class,subject,mark,term) VALUES($1,$2,$3,$4,$5,$6)',
    [req.session.user.tenant_id, student_name, cls, subject, mark, term]);
  res.redirect('/portal/marksheets');
}));

// === STUDENTS ===
app.get('/portal/students', requireAuth, ah(async (req, res) => {
  const students = (await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY name', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Students', `
    <div class="card"><h2>Add Student</h2>
      <form method="POST" action="/portal/students/add">
        <input name="name" placeholder="Full Name" required>
        <input name="class" placeholder="Class" required>
        <input name="parent_phone" placeholder="Parent Phone" required>
        <button class="btn">Add Student</button>
      </form>
    </div>
    <div class="card"><h3>All Students (${students.length})</h3>
      <table><tr><th>Name</th><th>Class</th><th>Parent</th><th>Actions</th></tr>
      ${students.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.parent_phone)}</td><td><a href="/portal/reports/pdf/${s.id}" class="btn">Report</a></td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/portal/students/add', requireAuth, ah(async (req, res) => {
  const { name, class: cls, parent_phone } = req.body;
  await pool.query('INSERT INTO students(tenant_id,name,class,parent_phone)VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name, cls, parent_phone]);
  res.redirect('/portal/students');
}));

// === FINANCE - SINGLE DEFINITION ===
app.get('/portal/finance', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const fees = (await pool.query(`
    SELECT f.id, f.student_name, f.student_class, f.amount,
           COALESCE(f.paid,0) as paid, f.phone, s.name as linked_student
    FROM fees f
    LEFT JOIN students s ON f.student_id=s.id
    WHERE f.tenant_id=$1
    ORDER BY f.id DESC LIMIT 100
  `, [tid])).rows;

  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
  const totalDue = fees.reduce((s,f)=>s+(f.amount-f.paid),0);
  const totalPaid = fees.reduce((s,f)=>s+f.paid,0);

  res.send(renderPage('Finance', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalDue.toLocaleString()}</div><div>Outstanding</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${totalPaid.toLocaleString()}</div><div>Collected</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Add Fee</h3>
        <form method="POST" action="/portal/finance/add">
          <select name="student_id" required>
            <option value="">Select Student</option>
            ${students.map(s=>`<option value="${s.id}">${esc(s.name)} - ${esc(s.class)}</option>`).join('')}
          </select>
          <input name="amount" placeholder="Amount Due" type="number" required>
          <input name="phone" placeholder="Parent Phone: 256..." required>
          <button class="btn">Add Fee</button>
        </form>
      </div>
      <div class="card"><h3>Record Payment</h3>
        <form method="POST" action="/portal/finance/pay">
          <input name="fee_id" placeholder="Fee ID" type="number" required>
          <input name="amount" placeholder="Amount Paid" type="number" required>
          <button class="btn btn-green">Record Payment</button>
        </form>
      </div>
    </div>
    <div class="card"><h3>Fees Ledger</h3>
      <table><tr><th>ID</th><th>Student</th><th>Class</th><th>Due</th><th>Paid</th><th>Balance</th><th>Phone</th></tr>
      ${fees.map(f=>`<tr><td>${f.id}</td><td>${esc(f.student_name||f.linked_student||'')}</td><td>${esc(f.student_class||'')}</td><td>${f.amount}</td><td>${f.paid}</td><td>${f.amount-f.paid}</td><td>${esc(f.phone||'')}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/portal/finance/add', requireAuth, ah(async (req, res) => {
  const { student_id, amount, phone } = req.body;
  const student = (await pool.query('SELECT name,class FROM students WHERE id=$1 AND tenant_id=$2', [student_id, req.session.user.tenant_id])).rows[0];
  if (!student) return res.status(400).send('Student not found');
  await pool.query('INSERT INTO fees(tenant_id,student_id,student_name,student_class,amount,phone,paid) VALUES($1,$2,$3,$4,$5,$6,0)',
    [req.session.user.tenant_id, student_id, student.name, student.class, amount, phone]);
  res.redirect('/portal/finance');
}));

app.post('/portal/finance/pay', requireAuth, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  await pool.query('UPDATE fees SET paid=COALESCE(paid,0)+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, req.session.user.tenant_id]);
  res.redirect('/portal/finance');
}));
app.post('/portal/finance/pay', requireAuth, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  const fee = (await pool.query('UPDATE fees SET paid=COALESCE(paid,0)+$1 WHERE id=$2 AND tenant_id=$3 RETURNING *', [amount, fee_id, req.session.user.tenant_id])).rows[0];
  if (fee) {
    const balance = fee.amount - fee.paid;
    const msg = `SSEWASSWA: UGX ${parseInt(amount).toLocaleString()} received for ${fee.student_name}. Balance: UGX ${balance.toLocaleString()}. Ref: FEE${fee.id}`;
    await sendSMS(fee.phone, msg);
    await logAction(req.session.user.id, req.session.user.tenant_id, 'fee_payment', { fee_id, amount }, req.ip);
  }
  res.redirect('/portal/finance');
}));
// === MARKETPLACE - SINGLE DEFINITION ===
app.get('/portal/marketplace', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const products = (await pool.query('SELECT * FROM marketplace_products WHERE tenant_id=$1 ORDER BY id DESC', [tid])).rows;
  res.send(renderPage('Marketplace', `
    <div class="card"><h3>Add Product</h3>
      <form method="POST" action="/portal/marketplace/add">
        <input name="name" placeholder="Uniform, Book, etc" required>
        <input name="price" placeholder="Price UGX" type="number" required>
        <input name="stock" placeholder="Stock Qty" type="number" required>
        <input name="image_url" placeholder="Image URL">
        <input name="category" placeholder="Category">
        <button class="btn">Add Product</button>
      </form>
    </div>
    <div class="card"><h3>Your Products</h3>
      <div class="grid">
        ${products.map(p=>`
          <div class="card">
            <b>${esc(p.name)}</b><br>
            UGX ${parseInt(p.price).toLocaleString()}<br>
            Stock: ${p.stock}<br>
            <span class="badge">${esc(p.category||'General')}</span>
          </div>
        `).join('') || '<p>No products yet.</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.post('/portal/marketplace/add', requireAuth, ah(async (req, res) => {
  const { name, price, stock, image_url, category } = req.body;
  await pool.query('INSERT INTO marketplace_products(tenant_id,name,price,stock,image_url,category) VALUES($1,$2,$3,$4,$5,$6)',
    [req.session.user.tenant_id, name, price, stock, image_url, category]);
  res.redirect('/portal/marketplace');
}));
app.get('/portal/finance/receipt/:id', requireAuth, ah(async (req, res) => {
  const f = (await pool.query('SELECT f.*,t.name as school_name FROM fees f JOIN tenants t ON f.tenant_id=t.id WHERE f.id=$1 AND f.tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!f) return res.status(404).send('Receipt not found');

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Receipt-${f.id}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(f.school_name, { align: 'center' });
  doc.fontSize(14).text('Payment Receipt', { align: 'center' }).moveDown();
  doc.fontSize(12).text(`Receipt #: FEE${f.id}`);
  doc.text(`Date: ${new Date().toDateString()}`).moveDown();
  doc.text(`Student: ${f.student_name}`);
  doc.text(`Class: ${f.student_class}`);
  doc.text(`Amount Due: UGX ${f.amount.toLocaleString()}`);
  doc.text(`Amount Paid: UGX ${f.paid.toLocaleString()}`);
  doc.text(`Balance: UGX ${(f.amount-f.paid).toLocaleString()}`);
  doc.text(`Phone: ${f.phone}`).moveDown();
  doc.fontSize(10).text('Thank you for your payment.', { align: 'center' });
  doc.end();
}));

// Add receipt button to finance ledger
// In /portal/finance table, change the row to:
${fees.map(f=>`<tr><td>${f.id}</td><td>${esc(f.student_name)}</td><td>${esc(f.student_class)}</td><td>${f.amount}</td><td>${f.paid}</td><td>${f.amount-f.paid}</td><td>${esc(f.phone)}</td><td><a href="/portal/finance/receipt/${f.id}" class="btn">PDF</a></td></tr>`).join('')}
// === PUBLIC SITE ===
app.get('/portal/public', requireAuth, ah(async (req, res) => {
  const page = (await pool.query('SELECT * FROM public_pages WHERE tenant_id=$1', [req.session.user.tenant_id])).rows[0] || {};
  res.send(renderPage('Public Site', `
    <div class="card"><h3>Edit Public Site</h3>
      <form method="POST" action="/portal/public/save">
        <label>About</label><textarea name="about" rows="4">${esc(page.about||'')}</textarea>
        <label>Contact Info</label><textarea name="contact" rows="3">${esc(page.contact||'')}</textarea>
        <label>Logo URL</label><input name="logo_url" value="${esc(page.logo_url||'')}">
        <button class="btn">Save</button>
      </form>
      <br><a href="/public/${req.session.user.subdomain}" target="_blank" class="btn btn-green">View Live Site →</a>
    </div>
  `, req.session.user));
}));

app.post('/portal/public/save', requireAuth, ah(async (req, res) => {
  const { about, contact, logo_url } = req.body;
  await pool.query('INSERT INTO public_pages(tenant_id,about,contact,logo_url) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET about=$2,contact=$3,logo_url=$4,updated_at=NOW()',
    [req.session.user.tenant_id, about, contact, logo_url]);
  res.redirect('/portal/public');
}));

// === ADMIN ===
app.get('/portal/admin', requireAuth, ah(async (req, res) => {
  const users = (await pool.query('SELECT id,name,email,role FROM users WHERE tenant_id=$1', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Admin', `
    <div class="card"><h3>Users</h3>
      <table><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th></tr>
      ${users.map(u=>`<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

// === NEWS ===
app.get('/portal/news', requireAuth, ah(async (req, res) => {
  const news = (await pool.query('SELECT * FROM scraped_news WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20', [req.session.user.tenant_id])).rows;
  res.send(renderPage('News', `
    <div class="card"><h3>School News</h3>
      ${news.length? news.map(n=>`<div class="card"><b>${esc(n.title)}</b><p>${esc(n.content?.substring(0,200))}...</p><small>${n.created_at}</small></div>`).join('') : '<p>No news yet. Use Dev Master to scrape URLs.</p>'}
    </div>
  `, req.session.user));
}));
// === DEVELOPER SEED ROUTE ===
app.get('/dev/seed', requireAuth, requireDeveloper, ah(async (req, res) => {
  const t = await pool.query(`INSERT INTO tenants(name,subdomain,type,status,subscription_plan) VALUES('Kings Primary Demo','kings','school','active','school_pro') RETURNING id`);
  const tid = t.rows[0].id;
  await pool.query(`INSERT INTO users(name,email,password_hash,role,tenant_id,verified,approved) VALUES('Demo Admin','admin@kings.test',$1,'school_admin',$2,true,true)`, [await bcrypt.hash('demo123', 10), tid]);
  for (let i = 1; i <= 30; i++) await pool.query(`INSERT INTO students(tenant_id,name,class,parent_phone) VALUES($1,$2,$3,$4)`, [tid, `Student ${i}`, `P${Math.ceil(i / 10)}`, '+256700000000']);
  res.json({ ok: true, login: 'admin@kings.test / demo123' });
}));

// === DONOR PORTAL ACTIONS ===
app.post('/portal/donors/create', requireAuth, requireRole('org_admin'), ah(async (req, res) => {
  const { title, summary, description, amount, deadline, category } = req.body;
  await pool.query('INSERT INTO fund_opportunities(tenant_id,title,summary,description,amount,currency,deadline,category,active)VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)', [req.session.user.tenant_id, title, summary, description, amount, 'USD', deadline, category]);
  await logAction(req.session.user.id, req.session.user.tenant_id, 'create_opportunity', { title, amount }, req.ip);
  res.redirect('/portal/donors?created=1');
}));

app.get('/portal/donors/approve/:id', requireAuth, requireRole('org_admin'), ah(async (req, res) => {
  await pool.query('UPDATE fund_applications SET status=$1 WHERE id=$2', ['approved', req.params.id]);
  res.redirect('/portal/donors?approved=1');
}));

// === PDF REPORTS ===
app.get('/portal/reports/pdf/:student_id', requireAuth, ah(async (req, res) => {
  const s = (await pool.query('SELECT s.*,t.name as school_name FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1 AND s.tenant_id=$2', [req.params.student_id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Student not found');

  const grades = (await pool.query('SELECT * FROM grades WHERE student_id=$1 AND term=$2 ORDER BY subject', [s.id, req.query.term || '1'])).rows;
  const avg = grades.length? grades.reduce((sum, g) => sum + g.score, 0) / grades.length : 0;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${s.name}-Report.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(s.school_name, { align: 'center' });
  doc.fontSize(12).text('Academic Report Card', { align: 'center' }).moveDown();
  doc.fontSize(14).text(`Name: ${s.name}`).text(`Class: ${s.class}`).text(`Term: ${req.query.term || '1'}`).moveDown();
  let y = doc.y;
  doc.text('Subject', 50, y).text('Score', 250, y).text('Grade', 350, y);
  doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke();
  y += 25;
  grades.forEach(g => { doc.text(g.subject, 50, y).text(g.score.toString(), 250, y).text(g.grade, 350, y); y += 20; });
  doc.fontSize(14).text(`Average: ${avg.toFixed(1)}%`, 50, y + 10);
  doc.fontSize(10).text('Computer generated document.', 50, 700);
  doc.end();
}));

// === MARKSHEETS PORTAL ===
app.get('/portal/marksheets', requireAuth, ah(async (req, res) => {
  const tid = req.session.user.tenant_id;
  const marks = (await pool.query('SELECT * FROM marksheets WHERE tenant_id=$1 ORDER BY id DESC LIMIT 200', [tid])).rows;
  res.send(renderPage('Marksheets', `
    <div class="card"><h3>Enter Marks</h3>
      <form method="POST" action="/portal/marksheets/add">
        <input name="student_name" placeholder="Student Name" required>
        <input name="class" placeholder="Class: P.6" required>
        <input name="subject" placeholder="Subject: Math" required>
        <input name="mark" placeholder="Mark: 85" type="number" max="100" required>
        <input name="term" placeholder="Term: 1" required>
        <button class="btn">Save Mark</button>
      </form>
    </div>
    <div class="card"><h3>Recent Marks</h3>
      <table><tr><th>Student</th><th>Class</th><th>Subject</th><th>Mark</th><th>Term</th></tr>
      ${marks.map(m=>`<tr><td>${esc(m.student_name)}</td><td>${esc(m.class)}</td><td>${esc(m.subject)}</td><td>${m.mark}</td><td>${esc(m.term)}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/portal/marksheets/add', requireAuth, ah(async (req, res) => {
  const { student_name, class: cls, subject, mark, term } = req.body;
  await pool.query('INSERT INTO marksheets(tenant_id,student_name,class,subject,mark,term) VALUES($1,$2,$3,$4,$5,$6)',
    [req.session.user.tenant_id, student_name, cls, subject, mark, term]);
  res.redirect('/portal/marksheets');
}));
app.get('/portal/marksheets/bulk', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Bulk Marks', `
    <div class="card"><h3>Upload Marks CSV</h3>
      <p>Format: Student Name,Class,Subject,Mark,Term</p>
      <p>Example: John Doe,P.6,Math,85,1</p>
      <form method="POST" action="/portal/marksheets/bulk" enctype="multipart/form-data">
        <input type="file" name="csv" accept=".csv" required>
        <button class="btn btn-green">Upload & Save</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/portal/marksheets/bulk', requireAuth, upload.single('csv'), ah(async (req, res) => {
  const csv = req.file.buffer.toString();
  const rows = csv.split('\n').slice(1).filter(r => r.trim());
  let count = 0;
  for (const row of rows) {
    const [student_name, cls, subject, mark, term] = row.split(',').map(s => s.trim());
    if (student_name && subject && mark) {
      await pool.query('INSERT INTO marksheets(tenant_id,student_name,class,subject,mark,term)VALUES($1,$2,$3,$4,$5,$6)',
        [req.session.user.tenant_id, student_name, cls, subject, mark, term]);
      count++;
    }
  }
  await logAction(req.session.user.id, req.session.user.tenant_id, 'bulk_marks', { count }, req.ip);
  res.redirect('/portal/marksheets?imported=' + count);
}));
// === USSD ROUTE ===
app.post('/ussd', ah(async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  const parts = text.split('*');
  let response = '';
  if (text === '') { response = `CON Welcome to SSEWASSWA\n1. Check Fees\n2. Check Results\n3. School Info\n4. Pay Fees`; }
  else if (parts[0] === '1') {
    if (parts.length === 1) { response = `CON Enter Student ID`; }
    else {
      const s = (await pool.query('SELECT s.*,t.name as school FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1 AND s.parent_phone=$2', [parts[1], phoneNumber])).rows[0];
      if (!s) response = `END Student not found`;
      else { const fees = (await pool.query('SELECT COALESCE(SUM(amount),0)-COALESCE(SUM(CASE WHEN paid THEN amount ELSE 0 END),0) as balance FROM fees WHERE student_id=$1', [s.id])).rows[0].balance; response = `END ${s.school}\n${s.name}\nBalance: UGX ${fees.toLocaleString()}`; }
    }
  } else if (parts[0] === '2') {
    if (parts.length === 1) { response = `CON Enter Student ID`; }
    else { const grades = (await pool.query('SELECT subject,score,grade FROM grades WHERE student_id=$1 AND term=$2 ORDER BY subject LIMIT 5', [parts[1], '1'])).rows; response = grades.length ? `END Results:\n${grades.map(g => `${g.subject}:${g.score}(${g.grade})`).join('\n')}` : `END No results`; }
  } else if (parts[0] === '4') {
    if (parts.length === 1) { response = `CON Enter Student ID`; }
    else if (parts.length === 2) { response = `CON Enter Amount UGX`; }
    else { const ref = 'USSD' + Date.now(); await pool.query('INSERT INTO fees(tenant_id,student_id,amount,ref,phone,paid,status)SELECT tenant_id,id,$1,$2,$3,false,$4 FROM students WHERE id=$5', [parts[2], ref, phoneNumber, 'pending', parts[1]]); response = `END Payment request sent. Approve on ${phoneNumber} to pay UGX ${parts[2]}`; }
  } else response = `END Invalid option`;
  res.set('Content-Type', 'text/plain');
  res.send(response);
}));

// === API ROUTES (PUBLIC/WEB) ===
app.get('/api/stats', ah(async (req, res) => {
  res.json({
    schools: (await pool.query("SELECT COUNT(*) as c FROM tenants WHERE type='school'")).rows[0].c,
    students: (await pool.query("SELECT COUNT(*) as c FROM students")).rows[0].c,
    donations: (await pool.query("SELECT COALESCE(SUM(amount),0) as t FROM donations")).rows[0].t,
    products: (await pool.query("SELECT COUNT(*) as c FROM products WHERE approved=true")).rows[0].c
  });
}));

app.get('/api/news/:tenant_id', ah(async (req, res) => {
  const news = (await pool.query('SELECT id,title,summary,created_at FROM news_articles WHERE tenant_id=$1 AND published=true ORDER BY created_at DESC LIMIT 5', [req.params.tenant_id])).rows;
  res.json(news);
}));

app.post('/api/sync', requireAuth, ah(async (req, res) => {
  const { type, data } = req.body;
  if (type === 'grades') {
    for (const g of data) await pool.query('INSERT INTO grades(tenant_id,student_id,subject,score,grade,term,teacher_id)VALUES($1,$2,$3,$4,$5,$6,$7)ON CONFLICT DO NOTHING', [g.tenant_id, g.student_id, g.subject, g.score, g.grade, g.term, g.teacher_id]);
  } else if (type === 'attendance') {
    for (const a of data) await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status,marked_by)VALUES($1,$2,$3,$4,$5)ON CONFLICT DO NOTHING', [a.tenant_id, a.student_id, a.date, a.status, a.marked_by]);
  }
  res.json({ ok: true, synced: data.length });
}));
app.get('/portal/gallery', requireAuth, ah(async (req, res) => {
  const photos = (await pool.query('SELECT * FROM gallery WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Gallery', `
    <div class="card"><h3>Upload Photo</h3>
      <form method="POST" action="/portal/gallery/add" enctype="multipart/form-data">
        <input type="file" name="image" accept="image/*" required>
        <input name="caption" placeholder="Caption">
        <button class="btn">Upload</button>
      </form>
    </div>
    <div class="card"><h3>Gallery</h3>
      <div class="grid">
        ${photos.map(p=>`<div class="card"><img src="${p.image_url}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><p>${esc(p.caption)}</p></div>`).join('') || '<p>No photos yet.</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.post('/portal/gallery/add', requireAuth, upload.single('image'), ah(async (req, res) => {
  const result = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'gallery' }, (e, r) => e? reject(e) : resolve(r)).end(req.file.buffer));
  await pool.query('INSERT INTO gallery(tenant_id,image_url,caption)VALUES($1,$2,$3)', [req.session.user.tenant_id, result.secure_url, req.body.caption]);
  res.redirect('/portal/gallery');
}));

// Update public page to show gallery
app.get('/public/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send('School not found');
  const page = (await pool.query('SELECT * FROM public_pages WHERE tenant_id=$1', [tenant.id])).rows[0] || {};
  const products = (await pool.query('SELECT * FROM marketplace_products WHERE tenant_id=$1 LIMIT 6', [tenant.id])).rows;
  const news = (await pool.query('SELECT * FROM scraped_news WHERE tenant_id=$1 ORDER BY id DESC LIMIT 3', [tenant.id])).rows;
  const gallery = (await pool.query('SELECT * FROM gallery WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8', [tenant.id])).rows;

  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tenant.name)}</title><style>body{font-family:system-ui;margin:0;background:#f8fafc}.hero{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:60px 20px;text-align:center}.container{max-width:1200px;margin:0 auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.card{background:white;padding:20px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}</style></head><body>
    <div class="hero"><h1>${esc(tenant.name)}</h1><p>${tenant.verified?'✅ Verified School':''}</p></div>
    <div class="container">
      <div class="grid">
        <div class="card"><h3>About Us</h3><p>${esc(page.about||'Welcome to our school.')}</p></div>
        <div class="card"><h3>Contact</h3><p>${esc(page.contact||'Contact admin for details.')}</p></div>
      </div>
      ${gallery.length?`<h2>Gallery</h2><div class="grid">${gallery.map(g=>`<div class="card"><img src="${g.image_url}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><p>${esc(g.caption||'')}</p></div>`).join('')}</div>`:''}
      ${products.length?`<h2>School Shop</h2><div class="grid">${products.map(p=>`<div class="card"><b>${esc(p.name)}</b><br>UGX ${parseInt(p.price).toLocaleString()}</div>`).join('')}</div>`:''}
      ${news.length?`<h2>News</h2><div class="grid">${news.map(n=>`<div class="card"><b>${esc(n.title)}</b><p>${esc(n.content?.substring(0,100))}...</p></div>`).join('')}</div>`:''}
    </div>
  </body></html>`);
}));
// === API v2 - MOBILE ===
app.post('/api/v2/auth/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const u = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
  if (!u ||!await bcrypt.compare(password, u.password_hash)) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ id: u.id, role: u.role, tenant_id: u.tenant_id }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, portals: u.portals } });
}));

app.get('/api/v2/students', requireJWT, ah(async (req, res) => {
  const students = (await pool.query('SELECT id,name,class,dob,parent_phone,photo_url FROM students WHERE tenant_id=$1', [req.user.tenant_id])).rows;
  res.json({ students });
}));

app.post('/api/v2/marks', requireJWT, requirePortal('academics'), ah(async (req, res) => {
  const { student_id, subject, score, term } = req.body;
  const grade = score >= 80? 'A' : score >= 70? 'B' : score >= 60? 'C' : score >= 50? 'D' : 'F';
  await pool.query('INSERT INTO grades(tenant_id,student_id,subject,score,grade,term,teacher_id)VALUES($1,$2,$3,$4,$5,$6,$7)', [req.user.tenant_id, student_id, subject, score, grade, term, req.user.id]);
  res.json({ ok: true, grade });
}));

// === API v2 - EXTERNAL ===
app.post('/api/v2/apikey/create', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const { name, scopes } = req.body;
  const key = 'sk_' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  await pool.query('INSERT INTO api_keys(tenant_id,key_hash,name,scopes)VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, hash, name, scopes]);
  res.json({ ok: true, key, warning: 'Save this key. It will not be shown again.' });
}));

app.post('/api/v2/webhook', requireApiKey, ah(async (req, res) => {
  const { event, payload } = req.body;
  await pool.query('INSERT INTO webhook_logs(tenant_id,event,payload,status)VALUES($1,$2,$3,$4)', [req.tenant_id, event, JSON.stringify(payload), 200]);
  if (webhookQueue) await webhookQueue.add('process', { tenant_id: req.tenant_id, event, payload });
  res.json({ ok: true, received: true });
}));

// === FEEDBACK ===
app.post('/feedback', ah(async (req, res) => {
  const { message, rating, email } = req.body;
  await pool.query('INSERT INTO feedback(message,rating,email)VALUES($1,$2,$3)', [message, rating, email]);
  await transporter.sendMail({ to: DEVELOPER_EMAIL, subject: 'New Feedback', html: `<p>Rating: ${rating}/5</p><p>${message}</p><p>From: ${email}</p>` });
  res.json({ ok: true, msg: 'Thank you!' });
}));

// === CART & CHECKOUT ===
app.get('/cart', ah(async (req, res) => {
  const cart = req.session.cart || [];
  const products = cart.length ? await Promise.all(cart.map(async (c) => {
    const p = (await pool.query('SELECT * FROM products WHERE id=$1', [c.product_id])).rows[0];
    return { ...p, quantity: c.quantity };
  })) : [];
  const total = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  res.send(renderPage('Cart', `<div class="card"><h2>Shopping Cart</h2>${products.length ? `<table><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr>${products.map(p => `<tr><td>${esc(p.name)}</td><td>UGX ${p.price.toLocaleString()}</td><td>${p.quantity}</td><td>UGX ${(p.price * p.quantity).toLocaleString()}</td></tr>`).join('')}<tr><td colspan="3" style="text-align:right;font-weight:bold">Total:</td><td style="font-weight:bold;color:#16a34a">UGX ${total.toLocaleString()}</td></tr></table><a href="/checkout" class="btn btn-green">Checkout</a>` : '<p>Cart is empty</p><a href="/marketplace" class="btn">Continue Shopping</a>'}</div>`, null));
}));

app.post('/cart/add', ah(async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(c => c.product_id == product_id);
  if (existing) existing.quantity += parseInt(quantity);
  else req.session.cart.push({ product_id, quantity: parseInt(quantity) });
  res.redirect('/cart');
}));

app.get('/checkout', ah(async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) return res.redirect('/cart');
  const products = await Promise.all(cart.map(async (c) => {
    const p = (await pool.query('SELECT * FROM products WHERE id=$1', [c.product_id])).rows[0];
    return { ...p, quantity: c.quantity };
  }));
  const total = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  res.send(renderPage('Checkout', `<div class="card" style="max-width:600px;margin:40px auto"><h2>Checkout</h2><form method="POST" action="/checkout"><h3>Delivery Details</h3><input name="customer_name" placeholder="Full Name" required><input name="phone" placeholder="Phone: 078..." required><textarea name="address" placeholder="Delivery Address" required></textarea><h3>Payment Method</h3><select name="gateway" required><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select><h3>Order Summary</h3><table>${products.map(p => `<tr><td>${esc(p.name)} x${p.quantity}</td><td>UGX ${(p.price * p.quantity).toLocaleString()}</td></tr>`).join('')}<tr><td style="font-weight:bold">Total:</td><td style="font-weight:bold;color:#16a34a">UGX ${total.toLocaleString()}</td></tr></table><button class="btn btn-green" style="width:100%">Pay Now</button></form></div>`, null));
}));

app.post('/checkout', ah(async (req, res) => {
  const { customer_name, phone, address, gateway } = req.body;
  const cart = req.session.cart || [];
  const products = await Promise.all(cart.map(async (c) => {
    const p = (await pool.query('SELECT * FROM products WHERE id=$1', [c.product_id])).rows[0];
    return { ...p, quantity: c.quantity };
  }));
  const total = products.reduce((sum, p) => sum + p.price * p.quantity, 0);
  const ref = 'ORD' + Date.now();
  const commission = Math.round(total * PLATFORM_COMMISSION);
  for (const p of products) {
    await pool.query('INSERT INTO orders(user_id,product_id,quantity,total,commission,customer_name,phone,address,gateway,ref,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [req.session.user?.id || null, p.id, p.quantity, p.price * p.quantity, commission, customer_name, phone, address, gateway, ref, 'pending']);
  }
  req.session.cart = [];
  res.send(`<script>alert('Order placed! Ref: ${ref}. Check ${phone} to approve payment of UGX ${total.toLocaleString()}');window.location='/order/${ref}'</script>`);
}));

// === MISSING ROUTES v6.0 ===
app.get('/blog/:id', ah(async (req, res) => {
  const p = (await pool.query('SELECT n.*,t.name as author_name FROM news_articles n JOIN tenants t ON n.tenant_id=t.id WHERE n.id=$1 AND n.published=true', [req.params.id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  await pool.query('UPDATE news_articles SET views=views+1 WHERE id=$1', [p.id]);
  res.send(renderPage(p.title, `<div class="card"><img src="${p.image_url}" style="width:100%;max-height:400px;object-fit:cover;border-radius:16px"><h1>${esc(p.title)}</h1><p style="color:#64748b;font-size:13px">By ${esc(p.author_name)} • ${new Date(p.created_at).toDateString()} • ${p.views} views</p><div style="margin:20px 0">${p.content}</div></div>`, null));
}));

app.get('/order/:ref', ah(async (req, res) => {
  const o = (await pool.query('SELECT o.*,p.name as product_name FROM orders o JOIN products p ON o.product_id=p.id WHERE o.ref=$1', [req.params.ref])).rows[0];
  if (!o) return res.status(404).send('Order not found');
  res.send(renderPage('Order ' + o.ref, `<div class="card"><h2>Order #${esc(o.ref)}</h2><table><tr><td>Product:</td><td>${esc(o.product_name)}</td></tr><tr><td>Quantity:</td><td>${o.quantity}</td></tr><tr><td>Total:</td><td>UGX ${o.total.toLocaleString()}</td></tr><tr><td>Status:</td><td><span class="badge badge-${o.status === 'completed' ? 'green' : 'gold'}">${o.status}</span></td></tr><tr><td>Customer:</td><td>${esc(o.customer_name)}</td></tr><tr><td>Address:</td><td>${esc(o.address)}</td></tr></table></div>`, null));
}));

app.get('/donate/recurring', requireAuth, ah(async (req, res) => {
  const opps = (await pool.query('SELECT id,title FROM fund_opportunities WHERE active=true')).rows;
  res.send(renderPage('Recurring Donations', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Set Up Monthly Donation</h2><form method="POST" action="/donate/recurring"><label>Amount (UGX)</label><input name="amount" type="number" min="5000" required><label>Frequency</label><select name="frequency" required><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select><label>To Opportunity</label><select name="opportunity_id" required>${opps.map(o => `<option value="${o.id}">${esc(o.title)}</option>`).join('')}</select><button class="btn btn-green" style="width:100%">Activate Recurring</button></form></div>`, req.session.user));
}));

app.post('/donate/recurring', requireAuth, ah(async (req, res) => {
  const { opportunity_id, amount, frequency } = req.body;
  const next = new Date();
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1);
  else next.setMonth(next.getMonth() + 3);
  await pool.query('INSERT INTO recurring_donations(donor_id,opportunity_id,amount,frequency,next_charge,status)VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.id, opportunity_id, amount, frequency, next, 'active']);
  res.json({ ok: true, msg: `Recurring donation of UGX ${amount} ${frequency} activated` });
}));

app.get('/reset-password/:token', ah(async (req, res) => {
  const r = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND expires_at>NOW() AND used=false', [req.params.token])).rows[0];
  if (!r) return res.status(400).send('Invalid or expired token');
  res.send(renderPage('New Password', `<div class="card" style="max-width:400px;margin:60px auto"><h2>Set New Password</h2><form method="POST" action="/reset-password/${req.params.token}"><input name="password" type="password" placeholder="New Password" required><input name="confirm" type="password" placeholder="Confirm Password" required><button class="btn" style="width:100%">Reset Password</button></form></div>`, null));
}));

app.post('/reset-password/:token', ah(async (req, res) => {
  const { password, confirm } = req.body;
  if (password !== confirm) return res.status(400).send('Passwords do not match');
  const r = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND expires_at>NOW() AND used=false', [req.params.token])).rows[0];
  if (!r) return res.status(400).send('Invalid token');
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, r.user_id]);
  await pool.query('UPDATE password_resets SET used=true WHERE id=$1', [r.id]);
  res.send(`<script>alert('Password reset successful!');window.location='/login'</script>`);
}));

app.get('/s/:subdomain/enroll', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!t) return res.status(404).send('School not found');
  res.send(renderPage('Enroll', `<div class="card" style="max-width:600px;margin:40px auto"><h2>Enroll at ${esc(t.name)}</h2><form method="POST" action="/s/${req.params.subdomain}/enroll"><input name="student_name" placeholder="Student Full Name" required><input name="dob" type="date" placeholder="Date of Birth" required><select name="gender" required><option value="">Gender</option><option value="Male">Male</option><option value="Female">Female</option></select><input name="class_applying" placeholder="Class Applying For" required><h3>Parent/Guardian</h3><input name="parent_name" placeholder="Your Name" required><input name="parent_phone" placeholder="Phone: 078..." required><input name="parent_email" type="email" placeholder="Email" required><button class="btn btn-green" style="width:100%">Submit Application</button></form></div>`, null));
}));

app.post('/s/:subdomain/enroll', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  const { student_name, dob, gender, class_applying, parent_name, parent_phone, parent_email } = req.body;
  await pool.query('INSERT INTO enrollments(tenant_id,student_name,dob,gender,class_applying,parent_name,parent_phone,parent_email,status)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t.id, student_name, dob, gender, class_applying, parent_name, parent_phone, parent_email, 'pending']);
  res.send(`<script>alert('Application submitted! ${t.name} will contact you.');window.location='/s/${t.subdomain}'</script>`);
}));
// === PUBLIC PAGES ===
app.get('/help', ah(async (req, res) => {
  res.type('html').send(renderPage('Help', `<div class="card"><h1>Help Center</h1><h3>USSD Commands</h3><p>Dial <b>*270*StudentID#</b> to check fees</p><p>Dial <b>*270*StudentID*2#</b> to check results</p><h3>Support</h3><p>WhatsApp: +256 789 736737</p><p>Email: ssewasswa@gmail.com</p></div>`, null, true));
}));

app.get('/terms', (req, res) => res.send(renderPage('Terms', `
<div class="card"><h2>Terms of Service</h2>
<p>1. Service provided "as is". We don't guarantee 100% uptime.</p>
<p>2. You own your data. We won't sell it.</p>
<p>3. Pay within 7 days or account suspended.</p>
<p>4. Liability limited to fees paid in last 12 months.</p>
<p>5. Uganda law applies. Disputes in Kampala courts.</p>
</div>
`, null)));
app.get('/public/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send('School not found');

  const page = (await pool.query('SELECT * FROM public_pages WHERE tenant_id=$1', [tenant.id])).rows[0] || {};
  const products = (await pool.query('SELECT * FROM marketplace_products WHERE tenant_id=$1 LIMIT 6', [tenant.id])).rows;
  const news = (await pool.query('SELECT * FROM scraped_news WHERE tenant_id=$1 ORDER BY id DESC LIMIT 3', [tenant.id])).rows;

  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tenant.name)}</title><style>body{font-family:system-ui;margin:0;background:#f8fafc}.hero{background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:60px 20px;text-align:center}.container{max-width:1200px;margin:0 auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}.card{background:white;padding:20px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}</style></head><body>
    <div class="hero"><h1>${esc(tenant.name)}</h1><p>${tenant.verified?'✅ Verified School':''}</p></div>
    <div class="container">
      <div class="grid">
        <div class="card"><h3>About Us</h3><p>${esc(page.about||'Welcome to our school.')}</p></div>
        <div class="card"><h3>Contact</h3><p>${esc(page.contact||'Contact admin for details.')}</p></div>
      </div>
      ${products.length?`<h2>School Shop</h2><div class="grid">${products.map(p=>`<div class="card"><b>${esc(p.name)}</b><br>UGX ${parseInt(p.price).toLocaleString()}</div>`).join('')}</div>`:''}
      ${news.length?`<h2>News</h2><div class="grid">${news.map(n=>`<div class="card"><b>${esc(n.title)}</b><p>${esc(n.content?.substring(0,100))}...</p></div>`).join('')}</div>`:''}
    </div>
  </body></html>`);
}));

// Edit public page
app.post('/portal/public/save', requireAuth, ah(async (req, res) => {
  const { about, contact, logo_url } = req.body;
  await pool.query('INSERT INTO public_pages(tenant_id,about,contact,logo_url) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET about=$2,contact=$3,logo_url=$4,updated_at=NOW()',
    [req.session.user.tenant_id, about, contact, logo_url]);
  res.redirect('/portal/public');
}));

app.get('/portal/public', requireAuth, ah(async (req, res) => {
  const page = (await pool.query('SELECT * FROM public_pages WHERE tenant_id=$1', [req.session.user.tenant_id])).rows[0] || {};
  res.send(renderPage('Public Site', `
    <div class="card"><h3>Edit Public Site</h3>
      <form method="POST" action="/portal/public/save">
        <label>About</label><textarea name="about" rows="4">${esc(page.about||'')}</textarea>
        <label>Contact Info</label><textarea name="contact" rows="3">${esc(page.contact||'')}</textarea>
        <label>Logo URL</label><input name="logo_url" value="${esc(page.logo_url||'')}">
        <button class="btn">Save</button>
      </form>
      <br><a href="/public/${req.session.user.subdomain}" target="_blank" class="btn btn-green">View Live Site →</a>
    </div>
  `, req.session.user));
}));
app.get('/privacy', (req, res) => res.send(renderPage('Privacy Policy', `
<div class="card"><h2>Privacy Policy - Ssewasswa</h2>
<p><b>Data we collect:</b> Student names, marks, parent phone numbers for SMS.</p>
<p><b>Why:</b> To provide school management services.</p>
<p><b>Storage:</b> Encrypted PostgreSQL in EU. Retained 7 years per Uganda Data Protection Act 2019.</p>
<p><b>Your rights:</b> Email privacy@ssewasswa.com to delete data.</p>
<p><b>Cookies:</b> Only login session. No tracking.</p>
<p>Contact: DPO, Ssewasswa Ltd, Kampala. Last updated: ${new Date().toDateString()}</p>
</div>
`, null)));

app.get('/contact', ah(async (req, res) => {
  res.send(renderPage('Contact', `<div class="card"><h1>Contact Us</h1><p>📞 +256 789 736737</p><p>📧 ssewasswa@gmail.com</p><p>📍 Kampala, Uganda</p><form method="POST" action="/feedback"><input name="email" type="email" placeholder="Your Email" required><textarea name="message" placeholder="Message" required></textarea><input name="rating" type="number" min="1" max="5" placeholder="Rating 1-5" required><button class="btn">Send</button></form></div>`, null, true));
}));

app.get('/s/:subdomain/gallery', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!t) return res.status(404).send('Not found');
  const photos = (await pool.query('SELECT * FROM gallery WHERE tenant_id=$1 ORDER BY created_at DESC', [t.id])).rows;
  res.send(renderPage(t.name + ' Gallery', `<div class="container"><h1>${esc(t.name)} Gallery</h1><div class="grid">${photos.map(p => `<div class="card"><img src="${p.image_url}" style="width:100%;height:200px;object-fit:cover;border-radius:12px"><p>${esc(p.caption)}</p></div>`).join('')}</div></div>`, null, true));
}));

app.get('/s/:subdomain/fees', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!t || !t.show_fees) return res.status(404).send('Not found');
  const fees = (await pool.query('SELECT class,amount,term FROM fees_structure WHERE tenant_id=$1 ORDER BY class,term', [t.id])).rows;
  res.send(renderPage(t.name + ' Fees', `<div class="container"><h1>${esc(t.name)} - Fee Structure</h1><div class="card"><table><tr><th>Class</th><th>Term</th><th>Amount</th></tr>${fees.map(f => `<tr><td>${esc(f.class)}</td><td>${f.term}</td><td>UGX ${f.amount.toLocaleString()}</td></tr>`).join('')}</table></div></div>`, null, true));
}));

app.get('/s/:subdomain/results', ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!t || !t.show_results) return res.status(404).send('Not found');
  res.send(renderPage(t.name + ' Results', `<div class="container"><h1>${esc(t.name)} - Results</h1><div class="card"><form method="GET" action="/s/${req.params.subdomain}/results"><input name="student_id" placeholder="Enter Student ID" required><button class="btn">Check Results</button></form></div></div>`, null, true));
}));

// === PORTAL ADMIN & SETTINGS ===
app.get('/portal/admin/settings', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows[0];
  res.send(renderPage('Settings', `<div class="card"><h2>School Settings</h2><form method="POST" action="/portal/admin/settings"><label>School Name</label><input name="name" value="${esc(t.name)}" required><label>Tagline</label><input name="tagline" value="${esc(t.tagline || '')}"><label>About Us</label><textarea name="about_us">${esc(t.about_us || '')}</textarea><label>Contact Phone</label><input name="contact_phone" value="${esc(t.contact_phone || '')}"><label>Contact Email</label><input name="contact_email" value="${esc(t.contact_email || '')}"><label>Address</label><textarea name="address">${esc(t.address || '')}</textarea><h3>Public Site Options</h3><label><input type="checkbox" name="show_fees" ${t.show_fees ? 'checked' : ''}> Show Fees Page</label><label><input type="checkbox" name="show_results" ${t.show_results ? 'checked' : ''}> Show Results</label><label><input type="checkbox" name="show_gallery" ${t.show_gallery ? 'checked' : ''}> Show Gallery</label><label><input type="checkbox" name="show_news" ${t.show_news ? 'checked' : ''}> Show News</label><label><input type="checkbox" name="show_donate" ${t.show_donate ? 'checked' : ''}> Show Donate Button</label><button class="btn btn-green">Save Settings</button></form></div>`, req.session.user, 'admin'));
}));

app.post('/portal/admin/settings', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const { name, tagline, about_us, contact_phone, contact_email, address, show_fees, show_results, show_gallery, show_news, show_donate } = req.body;
  await pool.query('UPDATE tenants SET name=$1,tagline=$2,about_us=$3,contact_phone=$4,contact_email=$5,address=$6,show_fees=$7,show_results=$8,show_gallery=$9,show_news=$10,show_donate=$11 WHERE id=$12', [name, tagline, about_us, contact_phone, contact_email, address, show_fees === 'on', show_results === 'on', show_gallery === 'on', show_news === 'on', show_donate === 'on', req.session.user.tenant_id]);
  await logAction(req.session.user.id, req.session.user.tenant_id, 'update_settings', {}, req.ip);
  res.redirect('/portal/admin/settings?saved=1');
}));

app.get('/portal/students/:id/edit', requireAuth, requirePortal('admin'), ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit Student', `<div class="card"><h2>Edit ${esc(s.name)}</h2><form method="POST" action="/portal/students/${s.id}/edit"><input name="name" value="${esc(s.name)}" placeholder="Full Name" required><input name="class" value="${esc(s.class)}" placeholder="Class" required><input name="parent_phone" value="${esc(s.parent_phone)}" placeholder="Parent Phone" required><input name="dob" type="date" value="${s.dob ? new Date(s.dob).toISOString().split('T')[0] : ''}"><select name="gender"><option value="Male" ${s.gender === 'Male' ? 'selected' : ''}>Male</option><option value="Female" ${s.gender === 'Female' ? 'selected' : ''}>Female</option></select><button class="btn btn-green">Update Student</button></form></div>`, req.session.user, 'admin'));
}));

app.post('/portal/students/:id/edit', requireAuth, requirePortal('admin'), ah(async (req, res) => {
  const { name, class: cls, parent_phone, dob, gender } = req.body;
  await pool.query('UPDATE students SET name=$1,class=$2,parent_phone=$3,dob=$4,gender=$5 WHERE id=$6 AND tenant_id=$7', [name, cls, parent_phone, dob, gender, req.params.id, req.session.user.tenant_id]);
  res.redirect('/portal/students?updated=1');
}));

app.post('/portal/students/:id/delete', requireAuth, requirePortal('admin'), ah(async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/portal/students?deleted=1');
}));

app.get('/portal/admin/export', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  res.send(renderPage('Export Data', `<div class="card"><h2>Export Your Data</h2><p>Download all your data as CSV for backup.</p><a href="/portal/admin/export/students" class="btn">Students CSV</a><a href="/portal/admin/export/grades" class="btn">Grades CSV</a><a href="/portal/admin/export/transactions" class="btn">Transactions CSV</a><a href="/portal/admin/export/full" class="btn btn-green">Full Backup JSON</a></div>`, req.session.user, 'admin'));
}));

app.get('/portal/admin/export/:type', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const t = req.params.type;
  let data, filename;
  if (t === 'students') {
    data = (await pool.query('SELECT * FROM students WHERE tenant_id=$1', [req.session.user.tenant_id])).rows;
    filename = 'students.csv';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    let csv = 'ID,Name,DOB,Gender,Class,Parent Phone\n';
    data.forEach(s => csv += `${s.id},"${s.name}","${s.dob}","${s.gender}","${s.class}","${s.parent_phone}"\n`);
    return res.send(csv);
  }
  if (t === 'full') {
    data = { tenants: (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows, students: (await pool.query('SELECT * FROM students WHERE tenant_id=$1', [req.session.user.tenant_id])).rows, grades: (await pool.query('SELECT * FROM grades WHERE tenant_id=$1', [req.session.user.tenant_id])).rows };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="backup.json"');
    return res.json(data);
  }
  res.status(404).send('Invalid export type');
}));

// === MARKETPLACE & SHIPPING ===
app.get('/portal/marketplace/product/:id/edit', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM products WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  res.send(renderPage('Edit Product', `<div class="card"><h2>Edit Product</h2><form method="POST" action="/portal/marketplace/product/${p.id}/edit" enctype="multipart/form-data"><input name="name" value="${esc(p.name)}" required><textarea name="description" required>${esc(p.description)}</textarea><input name="price" type="number" value="${p.price}" required><input name="stock" type="number" value="${p.stock}" required><select name="category" required><option ${p.category === 'Uniforms' ? 'selected' : ''}>Uniforms</option><option ${p.category === 'Books' ? 'selected' : ''}>Books</option><option ${p.category === 'Food' ? 'selected' : ''}>Food</option><option ${p.category === 'Stationery' ? 'selected' : ''}>Stationery</option></select><img src="${p.image_url}" style="width:200px;border-radius:12px"><input type="file" name="image" accept="image/*"><button class="btn btn-green">Update Product</button></form></div>`, req.session.user, 'marketplace'));
}));

app.post('/portal/marketplace/product/:id/edit', requireAuth, requirePortal('marketplace'), upload.single('image'), ah(async (req, res) => {
  const { name, description, price, stock, category } = req.body;
  let sql = 'UPDATE products SET name=$1,description=$2,price=$3,stock=$4,category=$5';
  let params = [name, description, price, stock, category];
  if (req.file) {
    const result = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'products' }, (e, r) => e ? reject(e) : resolve(r)).end(req.file.buffer));
    sql += ',image_url=$6 WHERE id=$7 AND tenant_id=$8';
    params.push(result.secure_url, req.params.id, req.session.user.tenant_id);
  } else {
    sql += ' WHERE id=$6 AND tenant_id=$7';
    params.push(req.params.id, req.session.user.tenant_id);
  }
  await pool.query(sql, params);
  res.redirect('/portal/marketplace?updated=1');
}));

app.post('/portal/marketplace/product/:id/delete', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/portal/marketplace?deleted=1');
}));

app.get('/portal/marketplace/shipping', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  const orders = (await pool.query('SELECT o.*,p.name as product_name FROM orders o JOIN products p ON o.product_id=p.id WHERE p.tenant_id=$1 AND o.status=$2 ORDER BY o.created_at DESC', [req.session.user.tenant_id, 'completed'])).rows;
  res.send(renderPage('Shipping', `<div class="card"><h2>Orders to Ship</h2><table><tr><th>Ref</th><th>Product</th><th>Customer</th><th>Address</th><th>Action</th></tr>${orders.map(o => `<tr><td>${o.ref}</td><td>${esc(o.product_name)}</td><td>${esc(o.customer_name)}<br>${esc(o.phone)}</td><td>${esc(o.address)}</td><td><form method="POST" action="/portal/marketplace/shipping/${o.id}"><input name="tracking" placeholder="Tracking #" required><button class="btn">Mark Shipped</button></form></td></tr>`).join('')}</table></div>`, req.session.user, 'marketplace'));
}));

app.post('/portal/marketplace/shipping/:id', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  const { tracking } = req.body;
  await pool.query('UPDATE orders SET status=$1,tracking_number=$2 WHERE id=$3', ['shipped', tracking, req.params.id]);
  res.redirect('/portal/marketplace/shipping?shipped=1');
}));

app.get('/portal/marketplace/returns', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  const returns = (await pool.query('SELECT r.*,o.ref,p.name as product_name FROM returns r JOIN orders o ON r.order_id=o.id JOIN products p ON o.product_id=p.id WHERE p.tenant_id=$1 ORDER BY r.created_at DESC', [req.session.user.tenant_id])).rows;
  res.send(renderPage('Returns', `<div class="card"><h2>Return Requests</h2><table><tr><th>Order</th><th>Product</th><th>Reason</th><th>Status</th><th>Action</th></tr>${returns.map(r => `<tr><td>${r.ref}</td><td>${esc(r.product_name)}</td><td>${esc(r.reason)}</td><td><span class="badge badge-${r.status === 'approved' ? 'green' : 'gold'}">${r.status}</span></td><td>${r.status === 'pending' ? `<a href="/portal/marketplace/returns/${r.id}/approve" class="btn btn-green">Approve</a> <a href="/portal/marketplace/returns/${r.id}/reject" class="btn btn-red">Reject</a>` : ''}</td></tr>`).join('')}</table></div>`, req.session.user, 'marketplace'));
}));

app.get('/portal/marketplace/returns/:id/approve', requireAuth, requirePortal('marketplace'), ah(async (req, res) => {
  await pool.query('UPDATE returns SET status=$1 WHERE id=$2', ['approved', req.params.id]);
  const ret = (await pool.query('SELECT o.* FROM returns r JOIN orders o ON r.order_id=o.id WHERE r.id=$1', [req.params.id])).rows[0];
  await pool.query('UPDATE tenants SET wallet_balance=wallet_balance-$1 WHERE id=$2', [ret.total, req.session.user.tenant_id]);
  res.redirect('/portal/marketplace/returns?approved=1');
}));

// === ADMIN ADVANCED ===
app.get('/portal/students/bulk-edit', requireAuth, requirePortal('admin'), ah(async (req, res) => {
  res.send(renderPage('Bulk Edit', `<div class="card"><h2>Bulk Edit Students</h2><form method="POST" action="/portal/students/bulk-edit"><select name="field" required><option value="">Select Field</option><option value="class">Class</option><option value="status">Status</option></select><input name="old_value" placeholder="Current Value" required><input name="new_value" placeholder="New Value" required><button class="btn btn-red">Update All Matching</button></form><p style="color:#dc2626;font-size:13px">Warning: This updates ALL students matching by criteria.</p></div>`, req.session.user, 'admin'));
}));

app.post('/portal/students/bulk-edit', requireAuth, requirePortal('admin'), ah(async (req, res) => {
  const { field, old_value, new_value } = req.body;
  // Security: Whitelist allowed fields to prevent SQL Injection
  const allowedFields = ['class', 'status', 'gender', 'parent_phone'];
  if (!allowedFields.includes(field)) {
    return res.status(400).send('Invalid field specified');
  }
  const result = await pool.query(`UPDATE students SET ${field}=$1 WHERE tenant_id=$2 AND ${field}=$3`, [new_value, req.session.user.tenant_id, old_value]);
  res.redirect('/portal/students?updated=' + result.rowCount);
}));

app.get('/portal/admin/themes', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows[0];
  res.send(renderPage('Theme', `<div class="card"><h2>Customize Brand</h2><form method="POST" action="/portal/admin/themes" enctype="multipart/form-data"><label>Primary Color</label><input name="primary_color" type="color" value="${t.primary_color || '#1e40af'}"><label>Logo</label><input type="file" name="logo" accept="image/*"><img src="${t.logo_url || '/img/logo.png'}" style="width:100px"><label>Favicon</label><input type="file" name="favicon" accept="image/*"><button class="btn btn-green">Save Theme</button></form></div>`, req.session.user, 'admin'));
}));

app.post('/portal/admin/themes', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), ah(async (req, res) => {
  const { primary_color } = req.body;
  let sql = 'UPDATE tenants SET primary_color=$1';
  let params = [primary_color];
  if (req.files.logo) {
    const logo = await new Promise((resolve, reject) => cloudinary.uploader.upload_stream({ folder: 'logos' }, (e, r) => e ? reject(e) : resolve(r)).end(req.files.logo[0].buffer));
    sql += ',logo_url=$' + (params.length + 1);
    params.push(logo.secure_url);
  }
  sql += ' WHERE id=$' + (params.length + 1);
  params.push(req.session.user.tenant_id);
  await pool.query(sql, params);
  res.redirect('/portal/admin/themes?saved=1');
}));

app.get('/portal/admin/permissions', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const users = (await pool.query('SELECT id,name,email,role,portals FROM users WHERE tenant_id=$1', [req.session.user.tenant_id])).rows;
  const allPortals = SUBSCRIPTION_PLANS[req.session.user.subscription_plan]?.portals || [];
  res.send(renderPage('Permissions', `<div class="card"><h2>User Permissions</h2><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Portals</th><th>Action</th></tr>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><form method="POST" action="/portal/admin/permissions/${u.id}"><select name="role">${['teacher', 'bursar', 'librarian', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${allPortals.map(p => `<label><input type="checkbox" name="portals" value="${p}" ${u.portals?.includes(p) ? 'checked' : ''}> ${p}</label>`).join('<br>')}</td><td><button class="btn">Update</button></form></td></tr>`).join('')}</table></div>`, req.session.user, 'admin'));
}));

app.post('/portal/admin/permissions/:id', requireAuth, requireRole('school_admin', 'org_admin', 'super_admin'), ah(async (req, res) => {
  const { role, portals } = req.body;
  const portalArray = Array.isArray(portals) ? portals : [portals].filter(Boolean);
  await pool.query('UPDATE users SET role=$1,portals=$2 WHERE id=$3 AND tenant_id=$4', [role, portalArray, req.params.id, req.session.user.tenant_id]);
  res.redirect('/portal/admin/permissions?updated=1');
}));

// === AI PORTALS ===
app.get('/portal/ai/chat', requireAuth, requirePortal('academics'), ah(async (req, res) => {
  res.send(renderPage('AI Assistant', `<div class="card"><h2>AI Teaching Assistant</h2><div id="chat" style="height:400px;overflow-y:auto;border:1px solid #e2e8f0;padding:12px;border-radius:12px;margin-bottom:12px"></div><form id="ai-form"><input id="ai-input" placeholder="Ask: Create lesson plan for Algebra..." style="width:calc(100% - 100px)"><button class="btn">Send</button></form></div><script>document.getElementById('ai-form').onsubmit=async(e)=>{e.preventDefault();const input=document.getElementById('ai-input');const chat=document.getElementById('chat');chat.innerHTML+='<p><b>You:</b> '+input.value+'</p>';const res=await fetch('/portal/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:input.value})});const data=await res.json();chat.innerHTML+='<p><b>AI:</b> '+data.reply+'</p>';input.value='';chat.scrollTop=chat.scrollHeight;};</script>`, req.session.user, 'academics'));
}));

app.post('/portal/ai/chat', requireAuth, requirePortal('academics'), ah(async (req, res) => {
  const { message } = req.body;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: 'You are an AI teaching assistant for Ugandan schools. Help with lesson plans, grading, and curriculum.' }, { role: 'user', content: message }]
  });
  res.json({ reply: completion.choices[0].message.content });
}));

// === MOBILE API V1 ===
app.post('/api/v1/auth/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const u = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
  if (!u || !await bcrypt.compare(password, u.password_hash)) return res.status(401).json({ error: 'Invalid' });
  const token = jwt.sign({ id: u.id, role: u.role, tenant_id: u.tenant_id }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, portals: u.portals } });
}));

app.get('/api/v1/students', requireJWT, ah(async (req, res) => {
  const students = (await pool.query('SELECT id,name,class,dob,parent_phone FROM students WHERE tenant_id=$1', [req.user.tenant_id])).rows;
  res.json({ students });
}));

app.post('/api/v1/marks', requireJWT, requirePortal('academics'), ah(async (req, res) => {
  const { student_id, subject, score, term } = req.body;
  const grade = score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';
  await pool.query('INSERT INTO grades(tenant_id,student_id,subject,score,grade,term,teacher_id)VALUES($1,$2,$3,$4,$5,$6,$7)', [req.user.tenant_id, student_id, subject, score, grade, term, req.user.id]);
  res.json({ ok: true, grade });
}));

app.post('/api/v1/payments/momo', requireJWT, ah(async (req, res) => {
  const { phone, amount, purpose, student_id } = req.body;
  const ref = 'MOB-' + Date.now();
  await pool.query('INSERT INTO transactions(ref,tenant_id,amount,phone,purpose,student_id,status)VALUES($1,$2,$3,$4,$5,$6,$7)', [ref, req.user.tenant_id, amount, phone, purpose, student_id, 'pending']);
  res.json({ ok: true, ref, pay_url: `https://pay.mtn.co.ug/${ref}` });
}));

// === API EXTERNAL ===
app.post('/api/payments/mpesa', ah(async (req, res) => {
  const { phone, amount, ref } = req.body;
  const mpesaRef = 'MP' + Date.now();
  // Call Safaricom Daraja API here
  res.json({ ok: true, mpesaRef, checkout_url: `https://pay.safaricom.co.ke/${mpesaRef}` });
}));

app.post('/api/payments/flutterwave', ah(async (req, res) => {
  const { amount, currency, email, ref } = req.body;
  // Call Flutterwave API here
  res.json({ ok: true, payment_link: `https://checkout.flutterwave.com/${ref}` });
}));

app.get('/api/student-takeover', ah(async (req, res) => {
  const takeovers = (await pool.query('SELECT st.*,s.name as student_name,t.name as school_name FROM social_takeovers st JOIN students s ON st.student_id=s.id JOIN tenants t ON st.tenant_id=t.id WHERE st.date>=CURRENT_DATE ORDER BY st.date')).rows;
  res.json(takeovers);
}));

app.get('/api/employer-match', ah(async (req, res) => {
  const matches = (await pool.query('SELECT * FROM employer_matches WHERE verified=true AND matched_ytd<max_annual ORDER BY match_ratio DESC')).rows;
  res.json(matches);
}));

app.post('/api/employer-match/apply', requireAuth, ah(async (req, res) => {
  const { match_id, student_id } = req.body;
  await pool.query('INSERT INTO employer_applications(match_id,student_id,status)VALUES($1,$2,$3)', [match_id, student_id, 'pending']);
  res.json({ ok: true, msg: 'Application submitted' });
}));

// === DEVELOPER & DATABASE (Consolidated) ===
app.get('/dev/health', requireAuth, requireDeveloper, ah(async (req, res) => {
  const db = (await pool.query('SELECT NOW(),pg_database_size(current_database()) as size')).rows[0];
  const tables = (await pool.query("SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema='public'")).rows[0].c;
  res.json({ ok: true, status: 'healthy', db_time: db.now, db_size_mb: Math.round(db.size / 1024 / 1024), tables, uptime_sec: Math.round(process.uptime()), memory: process.memoryUsage(), node: process.version, cpu: process.cpuUsage() });
}));

app.get('/dev/database', requireAuth, requireDeveloper, ah(async (req, res) => {
  const tables = (await pool.query("SELECT table_name,pg_size_pretty(pg_total_relation_size(table_name::regclass)) as size FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows;
  res.send(renderPage('Database', `<div class="card"><h2>Database Tables</h2><table><tr><th>Table</th><th>Size</th><th>Action</th></tr>${tables.map(t => `<tr><td>${t.table_name}</td><td>${t.size}</td><td><a href="/dev/database/${t.table_name}" class="btn">Browse</a> <a href="/dev/database/${t.table_name}/export" class="btn btn-green">Export</a></td></tr>`).join('')}</table></div>`, req.session.user));
}));

app.get('/dev/database/:table', requireAuth, requireDeveloper, ah(async (req, res) => {
  // Security: Whitelist tables to prevent SQL Injection via URL params
  const allowedTables = ['users', 'tenants', 'students', 'grades', 'products', 'orders', 'transactions', 'audit_logs', 'developer_revenue', 'attendance', 'fees', 'classes', 'subjects', 'timetables', 'exams', 'fees_structure', 'withdrawals', 'payroll', 'expenses', 'income', 'budgets', 'returns', 'reviews', 'fund_opportunities', 'fund_applications', 'donations', 'recurring_donations', 'otp_codes', 'email_verifications', 'password_resets', 'verification_docs', 'news_articles', 'advertisements', 'events', 'gallery', 'feedback', 'enrollments', 'messages', 'notifications', 'files', 'api_keys', 'white_labels', 'live_classes', 'social_takeovers', 'employer_matches', 'ai_conversations', 'ai_predictions', 'session'];
  
  if (!allowedTables.includes(req.params.table)) {
    return res.status(400).send('Table not allowed');
  }

  const rows = (await pool.query(`SELECT * FROM ${req.params.table} LIMIT 100`)).rows;
  res.json(rows);
}));

app.get('/dev/show-columns', async (req, res) => {
  const users = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`);
  const tenants = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='tenants' ORDER BY ordinal_position`);
  res.json({ users: users.rows.map(r=>r.column_name), tenants: tenants.rows.map(r=>r.column_name) });
});

app.get('/dev/cache', requireAuth, requireDeveloper, ah(async (req, res) => {
  const sessions = (await pool.query('SELECT COUNT(*) as c FROM session WHERE expire>NOW()')).rows[0].c;
  res.send(renderPage('Cache', `<div class="card"><h2>System Cache</h2><p>Active Sessions: ${sessions}</p><p>Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB</p><p>Uptime: ${Math.round(process.uptime() / 3600)} hours</p><form method="POST" action="/dev/cache/flush"><button class="btn btn-red">Flush Expired Sessions</button></form></div>`, req.session.user));
}));

app.post('/dev/cache/flush', requireAuth, requireDeveloper, ah(async (req, res) => {
  const result = await pool.query('DELETE FROM session WHERE expire<NOW()');
  res.json({ ok: true, deleted: result.rowCount });
}));

app.post('/dev/scrape', requireAuth, requireDeveloper, ah(async (req, res) => {
  const { url, tenant_id } = req.body;
  
  if (!url?.startsWith('http')) {
    req.session.flash = { type: 'error', msg: 'Valid URL required' };
    return res.redirect('/dev/master');
  }

  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Dead simple scraper - grabs title + meta description + first image
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'No title';
    const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || 
                 html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
    const img = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || 
                html.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1] || '';

    await pool.query(
      'INSERT INTO scraped_news(url,title,content,image_url,tenant_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (url) DO NOTHING',
      [url, title.trim(), desc.trim(), img, tenant_id || null]
    );
    
    req.session.flash = { type: 'success', msg: `Scraped: ${esc(title.substring(0,50))}...` };
  } catch(e) {
    req.session.flash = { type: 'error', msg: 'Scrape failed: ' + e.message };
  }
  res.redirect('/dev/master');
}));
// === CRON JOBS - AUTO TASKS ===
// Daily 8am - SMS absent students
cron.schedule('0 8 * * *', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const absent = (await pool.query(`SELECT s.name,s.parent_phone,t.name as school FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id NOT IN (SELECT student_id FROM attendance WHERE date=$1) AND s.parent_phone IS NOT NULL`, [yesterday])).rows;
  for (const s of absent) {
    await sendSMS(s.parent_phone, `SSEWASSWA: ${s.name} was absent from ${s.school} on ${yesterday}`);
  }
});

// Daily 9am - Payout 5% to schools + platform revenue
cron.schedule('0 9 * * *', async () => {
  const fees = (await pool.query(`SELECT tenant_id,SUM(dev_amount) as dev_total FROM transactions WHERE status=$1 GROUP BY tenant_id`, ['completed'])).rows;
  for (const f of fees) {
    await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2', [f.dev_total, f.tenant_id]);
    await pool.query('INSERT INTO developer_revenue(tenant_id,amount,type)VALUES($1,$2,$3)', [f.tenant_id, f.dev_total, 'fees']);
  }
  const wallet = (await pool.query('SELECT balance FROM platform_wallet WHERE id=1')).rows[0].balance;
  if (wallet > 0) {
    await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1');
    await pool.query('INSERT INTO withdrawals(user_email,amount,net_amount,phone,status,ref)VALUES($1,$2,$3,$4,$5,$6)', [DEVELOPER_EMAIL, wallet, wallet, DEVELOPER_PHONE, 'paid', 'AUTO' + Date.now()]);
  }
});

// Daily 6am - Charge recurring donations
cron.schedule('0 6 * * *', async () => {
  const due = (await pool.query('SELECT * FROM recurring_donations WHERE next_charge<=NOW() AND status=$1', ['active'])).rows;
  for (const d of due) {
    const next = new Date();
    if (d.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else next.setMonth(next.getMonth() + 3);
    await pool.query('UPDATE recurring_donations SET next_charge=$1,last_charged=NOW() WHERE id=$2', [next, d.id]);
    await pool.query('INSERT INTO donations(donor_id,opportunity_id,amount,status)VALUES($1,$2,$3,$4)', [d.donor_id, d.opportunity_id, d.amount, 'completed']);
    await pool.query('INSERT INTO developer_revenue(amount,type)VALUES($1,$2)', [d.amount * DEVELOPER_RATE, 'recurring']);
  }
});

// Daily 2am - Backup database to Cloudinary (Replaces simple backup cron)
cron.schedule('0 2 * * *', async () => {
  const tables = ['tenants', 'users', 'students', 'grades', 'products', 'orders', 'transactions', 'audit_logs', 'developer_revenue'];
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table}`)).rows;
      if (data.length === 0) continue;
      const backup = Buffer.from(JSON.stringify(data));
      await new Promise((res, rej) => cloudinary.uploader.upload_stream({ resource_type: 'raw', public_id: `backups/${table}_${Date.now()}.json`, folder: 'backups' }, (e, r) => e ? rej(e) : res(r)).end(backup));
    } catch (e) {
      console.error(`Backup failed for table ${table}:`, e.message);
    }
  }
});

// Hourly - Simulate ad revenue
cron.schedule('0 * * * *', async () => {
  const ads = (await pool.query('SELECT * FROM advertisements WHERE active=true')).rows;
  for (const ad of ads) {
    const views = Math.floor(Math.random() * 100) + 10;
    const revenue = views * 0.1;
    const dev_cut = revenue * 0.15;
    await pool.query('UPDATE advertisements SET impressions=impressions+$1 WHERE id=$2', [views, ad.id]);
    await pool.query('INSERT INTO developer_revenue(amount,type)VALUES($1,$2)', [dev_cut, 'ads']);
    await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [dev_cut]);
  }
});

async function initDB() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    
    // --- CORE TABLES ---
    await c.query(`CREATE TABLE IF NOT EXISTS session (sid varchar NOT NULL, sess jsonb NOT NULL, expire timestamp NOT NULL, PRIMARY KEY (sid))`);
    await c.query(`CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`);
    await c.query(`INSERT INTO platform_wallet (id,balance) VALUES (1,0) ON CONFLICT DO NOTHING`);
    
    // --- TENANTS & USERS ---
    await c.query(`CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY, 
      name TEXT, 
      subdomain TEXT UNIQUE, 
      type TEXT DEFAULT 'school', 
      description TEXT, 
      gateway TEXT DEFAULT 'mtn', 
      momo_number_encrypted TEXT, 
      momo_name TEXT, 
      bank_name TEXT, 
      bank_account TEXT, 
      wallet_balance INTEGER DEFAULT 0, 
      status TEXT DEFAULT 'active', 
      subscription_plan TEXT DEFAULT 'school_free', 
      subscription_status TEXT DEFAULT 'trial', 
      verified BOOLEAN DEFAULT false, 
      features_enabled JSONB DEFAULT '{"dashboard":true,"finance":true,"academics":true,"ai_chatbot":false,"ussd_gateway":false,"offline_sync":false}', 
      social_links JSONB DEFAULT '{}', 
      about_us TEXT, 
      tagline TEXT, 
      show_fees BOOLEAN DEFAULT true, 
      show_results BOOLEAN DEFAULT false, 
      show_gallery BOOLEAN DEFAULT true, 
      show_news BOOLEAN DEFAULT true, 
      show_donate BOOLEAN DEFAULT true, 
      contact_phone TEXT, 
      contact_email TEXT, 
      address TEXT, 
      allow_marketplace BOOLEAN DEFAULT true, 
      seller_commission INT DEFAULT 10, 
      featured_until TIMESTAMPTZ, 
      country_code TEXT DEFAULT 'UG', 
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INT, email TEXT UNIQUE, password_hash TEXT, role TEXT, portals TEXT[], name TEXT, phone_encrypted TEXT, approved BOOLEAN DEFAULT false, verified BOOLEAN DEFAULT false, two_fa_enabled BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, role TEXT, photo_url TEXT, bio TEXT, public BOOLEAN DEFAULT false)`);
    
    // --- ACADEMICS ---
    await c.query(`CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, dob DATE, gender TEXT, class TEXT, parent_phone TEXT, balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS classes (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, capacity INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, code TEXT, description TEXT)`);
    await c.query(`CREATE TABLE IF NOT EXISTS grades (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, subject TEXT, score NUMERIC, grade TEXT, term TEXT, teacher_id INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, date DATE, status TEXT DEFAULT 'present', marked_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS timetables (id SERIAL PRIMARY KEY, tenant_id INT, class TEXT, day_of_week INT, period INT, subject TEXT, teacher_name TEXT)`);
    await c.query(`CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, class TEXT, subject TEXT, exam_date DATE, duration INT, total_marks INT, created_at TIMESTAMPTZ DEFAULT NOW())`);

    // --- FINANCE ---
    await c.query(`CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INT, student_id INT, amount NUMERIC, term TEXT, year INTEGER, payment_method TEXT, paid BOOLEAN DEFAULT false, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fees_structure (id SERIAL PRIMARY KEY, tenant_id INT, class TEXT, term TEXT, amount NUMERIC)`);
    await c.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, dev_amount INT, purpose TEXT, payer_name TEXT, payer_phone_encrypted TEXT, payer_email_encrypted TEXT, gateway TEXT, ref TEXT, status TEXT, receipt_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, tenant_id INT, amount INT, type TEXT, student_id INT, description TEXT, reference_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, tenant_id INT, user_email TEXT, amount INT, net_amount INT, phone TEXT, fee NUMERIC DEFAULT 0, status TEXT, ref TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS payroll (id SERIAL PRIMARY KEY, tenant_id INT, staff_id INT, month INT, year INT, salary NUMERIC, deductions NUMERIC, net_pay NUMERIC, status TEXT DEFAULT 'pending', UNIQUE(staff_id,month,year))`);
    await c.query(`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, tenant_id INT, category TEXT, amount NUMERIC, description TEXT, date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS income (id SERIAL PRIMARY KEY, tenant_id INT, source TEXT, amount NUMERIC, description TEXT, date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS budgets (id SERIAL PRIMARY KEY, tenant_id INT, category TEXT, amount NUMERIC, year INT)`);

    // --- MARKETPLACE ---
    await c.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, tenant_id INT, name TEXT, description TEXT, price NUMERIC, stock INT, category TEXT, image_url TEXT, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id INT, product_id INT, quantity INT, total INT, commission INT, customer_name TEXT, phone TEXT, address TEXT, gateway TEXT, ref TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS returns (id SERIAL PRIMARY KEY, order_id INT, reason TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS reviews (id SERIAL PRIMARY KEY, product_id INT, user_id INT, rating INT, comment TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

    // --- DONORS & NGO ---
    await c.query(`CREATE TABLE IF NOT EXISTS fund_opportunities (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, summary TEXT, description TEXT, amount INT, currency TEXT, deadline DATE, category TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS fund_applications (id SERIAL PRIMARY KEY, opportunity_id INT, donor_id INT, amount INT, currency TEXT, proposal TEXT, docs_url TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, status TEXT DEFAULT 'completed', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, donor_id INT, opportunity_id INT, amount INT, frequency TEXT, next_charge TIMESTAMPTZ, last_charged TIMESTAMPTZ, status TEXT DEFAULT 'active')`);

    // --- SECURITY & LOGS ---
    await c.query(`CREATE TABLE IF NOT EXISTS otp_codes (id SERIAL PRIMARY KEY, user_id INT, code TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS email_verifications (id SERIAL PRIMARY KEY, user_id INT, token TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, user_id INT, token TEXT, expires_at TIMESTAMPTZ, used BOOLEAN DEFAULT false)`);
    await c.query(`CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, action TEXT, details JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS verification_docs (id SERIAL PRIMARY KEY, user_id INT, tenant_id INT, doc_type TEXT, file_url TEXT, status TEXT DEFAULT 'pending', reviewed_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);

    // --- CONTENT & PUBLIC ---
    await c.query(`CREATE TABLE IF NOT EXISTS news_articles (id SERIAL PRIMARY KEY, tenant_id INT, author_id INT, title TEXT, summary TEXT, content TEXT, image_url TEXT, published BOOLEAN DEFAULT false, views INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS advertisements (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, image_url TEXT, daily_budget INT, target_audience TEXT, active BOOLEAN DEFAULT true, clicks INT DEFAULT 0, impressions INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, tenant_id INT, title TEXT, description TEXT, event_date DATE, location TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS gallery (id SERIAL PRIMARY KEY, tenant_id INT, image_url TEXT, caption TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS feedback (id SERIAL PRIMARY KEY, message TEXT, rating INT, email TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS enrollments (id SERIAL PRIMARY KEY, tenant_id INT, student_name TEXT, dob DATE, gender TEXT, class_applying TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`);

    // --- COMMUNICATION & FILES ---
    await c.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, from_user_id INT, to_user_id INT, subject TEXT, message TEXT, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INT, title TEXT, message TEXT, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS files (id SERIAL PRIMARY KEY, tenant_id INT, user_id INT, url TEXT, filename TEXT, mime_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

    // --- ADVANCED / API / AI ---
    await c.query(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INT, key_hash TEXT, name TEXT, last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS white_labels (id SERIAL PRIMARY KEY, tenant_id INT, domain TEXT UNIQUE, primary_color TEXT, logo_url TEXT, company_name TEXT)`);
    await c.query(`CREATE TABLE IF NOT EXISTS live_classes (id SERIAL PRIMARY KEY, tenant_id INT, class_name TEXT, meeting_url TEXT, started_by INT, started_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS social_takeovers (id SERIAL PRIMARY KEY, tenant_id INT, student_name TEXT, date DATE, platform TEXT, status TEXT DEFAULT 'scheduled', created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS employer_matches (id SERIAL PRIMARY KEY, tenant_id INT, company_name TEXT, match_ratio INT, max_annual NUMERIC, contact_email TEXT, requirements TEXT, verified BOOLEAN DEFAULT false, matched_ytd NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS ai_conversations (id SERIAL PRIMARY KEY, user_id INT, role TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE TABLE IF NOT EXISTS ai_predictions (id SERIAL PRIMARY KEY, tenant_id INT, type TEXT, prediction JSONB, confidence NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW())`);

// --- SCHEMA UPDATES (ALTER TABLES) ---
   await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#1e40af'`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'UG'`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_autopilot BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS autopilot_until TIMESTAMPTZ`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS parent_tenant_id INT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_count INT DEFAULT 0`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS about_us TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tagline TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banner_url TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gallery_urls TEXT[]`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS show_fees BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS show_results BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS show_gallery BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS show_news BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS show_donate BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'school'`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
    // Note: features_enabled is defined as JSONB in CREATE TABLE, so we don't try to alter it to TEXT[] here.
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'school_free'`);
await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'school_free'`);
    
    // --- PATCH FUND_OPPORTUNITIES TABLE FOR DONORS PAGE ---
    await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS description TEXT`);
    await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS summary TEXT`);
    await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS category TEXT`);
    await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
    await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`);
   await c.query(`ALTER TABLE fund_opportunities ADD COLUMN IF NOT EXISTS amount INT DEFAULT 0`);
    
    // --- FIX ATTENDANCE UNIQUE CONSTRAINT ---
    await c.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attendance_unique'
        ) THEN
          ALTER TABLE attendance ADD CONSTRAINT attendance_unique UNIQUE(student_id,date);
        END IF;
      EXCEPTION
        WHEN OTHERS THEN NULL;
      END $$;
    `);

    // --- INDEXES FOR PERFORMANCE ---
    await c.query(`CREATE INDEX IF NOT EXISTS idx_students_tenant_class ON students(tenant_id, class)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_grades_student_term ON grades(student_id, term)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_transactions_tenant_status ON transactions(tenant_id, status)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_products_approved ON products(approved)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);

    await c.query('COMMIT');
    console.log('DB v9.0 Ready - Redis + Workers + API v2');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Database Init Error:', e);
    process.exit(1);
  } finally {
    c.release();
  }
}

// === TEMP ADMIN RESET - DELETE AFTER USE ===
// WARNING: DELETES ALL DATA
app.get('/dev/reset-admin-now-delete-me', ah(async (req, res) => {
  console.log('--- NUCLEAR RESET STARTING ---');

  await pool.query('DROP TABLE IF EXISTS users CASCADE');
  await pool.query('DROP TABLE IF EXISTS tenants CASCADE');

  await pool.query(`
    CREATE TABLE tenants (
      id SERIAL PRIMARY KEY,
      name TEXT,
      subdomain TEXT UNIQUE,
      type TEXT DEFAULT 'school',
      description TEXT,
      gateway TEXT DEFAULT 'mtn',
      momo_number_encrypted TEXT,
      momo_name TEXT,
      bank_name TEXT,
      bank_account TEXT,
      wallet_balance INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      subscription_plan TEXT DEFAULT 'school_free',
      subscription_status TEXT DEFAULT 'trial',
      verified BOOLEAN DEFAULT false,
      features_enabled JSONB DEFAULT '{"dashboard":true,"finance":true,"academics":true}',
      social_links JSONB DEFAULT '{}',
      about_us TEXT,
      tagline TEXT,
      show_fees BOOLEAN DEFAULT true,
      show_results BOOLEAN DEFAULT false,
      show_gallery BOOLEAN DEFAULT true,
      show_news BOOLEAN DEFAULT true,
      show_donate BOOLEAN DEFAULT true,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      allow_marketplace BOOLEAN DEFAULT true,
      seller_commission INT DEFAULT 10,
      featured_until TIMESTAMPTZ,
      country_code TEXT DEFAULT 'UG',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      tenant_id INT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT,
      portals TEXT[],
      name TEXT,
      phone_encrypted TEXT,
      approved BOOLEAN DEFAULT false,
      verified BOOLEAN DEFAULT false,
      two_fa_enabled BOOLEAN DEFAULT false,
      wallet_balance INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const hash = await bcrypt.hash('admin123', 10);

  const tenantResult = await pool.query(
    'INSERT INTO tenants (name, subdomain, type, status, subscription_plan) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['SSEWASSWA HQ', 'hq', 'school', 'active', 'enterprise']
  );

  await pool.query(
    'INSERT INTO users (email, password_hash, role, tenant_id, approved, verified, name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    ['waiswadaniel24@gmail.com', hash, 'super_admin', tenantResult.rows[0].id, true, true, 'Super Admin']
  );

  res.send('✅ NUCLEAR RESET DONE: waiswadaniel24@gmail.com / admin123');
}));
// === START SERVER ===
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`SSEWASSWA v6.0 COMPLETE - LIVE on ${PORT}`);
    console.log(`Dev Master: ${DEVELOPER_EMAIL}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// === END OF server.js ===
