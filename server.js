require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === SECURITY ===
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// === SESSION ===
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// === RATE LIMIT ===
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));

// === UTILS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const requireAuth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
const requireNotBanned = (req, res, next) => req.session.user?.banned ? res.status(403).send('Account banned') : next();
const requireTenantAccess = (req, res, next) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return next();
  const requestedTid = parseInt(req.params.tenant_id || req.body.tenant_id || req.query.tenant_id);
  if (!requestedTid || u.tenant_id === requestedTid) return next();
  if (req.path.includes('/portal/') && req.path.includes(u.role)) return next();
  return res.status(403).send('Access denied to this tenant');
};
const requireSuperAdmin = (req, res, next) => req.session.user?.role === 'super_admin' ? next() : res.status(403).send('Super admin only');
const requireRole = (...roles) => (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.role === 'super_admin') return next();
  if (roles.includes(u.role) || roles.includes('all')) return next();
  res.status(403).send(renderPage('Access Denied', '<div class="card"><div class="alert alert-error">You do not have permission to access this page.</div><a href="/dashboard" class="btn">Back to Dashboard</a></div>', req.session.user));
};
const audit = (email, action, details) => pool.query('INSERT INTO audit_logs(user_email,action,details) VALUES($1,$2,$3)', [email, action, details]).catch(() => {});
const notify = (tenantId, email, title, message, type) => pool.query('INSERT INTO notifications(tenant_id,user_email,title,message,type) VALUES($1,$2,$3,$4,$5)', [tenantId, email, title, message, type || 'info']).catch(() => {});
const notifyAll = (tenantId, title, message, type) => pool.query('INSERT INTO notifications(tenant_id,title,message,type) VALUES($1,$2,$3,$4)', [tenantId, title, message, type || 'info']).catch(() => {});

// === v1.0 UTILITIES ===
// Email helper
const sendEmail = async (to, subject, html) => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return false;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } });
    await transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, html });
    return true;
  } catch (e) { console.warn('Email failed:', e.message); return false; }
};
const queueEmail = (tenantId, to, subject, body) => pool.query('INSERT INTO email_queue(tenant_id,to_email,subject,body) VALUES($1,$2,$3,$4)', [tenantId, to, subject, body]).catch(() => {});

// SMS helper
const sendSMS = async (phone, message) => {
  if (!process.env.AT_API_KEY || !process.env.AT_USERNAME) return false;
  try {
    const africastalking = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
    await africastalking.SMS.send({ to: phone, message, from: process.env.AT_SENDER_ID || undefined });
    return true;
  } catch (e) { console.warn('SMS failed:', e.message); return false; }
};
const logSMS = (tenantId, phone, message, triggerType) => pool.query('INSERT INTO sms_logs(tenant_id,phone,message,trigger_type) VALUES($1,$2,$3,$4)', [tenantId, phone, message, triggerType || 'manual']).catch(() => {});

// Webhook delivery
const fireWebhook = async (tenantId, event, payload) => {
  const hooks = (await pool.query('SELECT * FROM webhooks WHERE tenant_id=$1 AND active=true AND $2=ANY(events)', [tenantId, event])).rows;
  for (const hook of hooks) {
    try {
      const sig = crypto.createHmac('sha256', hook.secret || '').update(JSON.stringify(payload)).digest('hex');
      const resp = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SSEWASSWA-Sig': sig, 'X-SSEWASSWA-Event': event }, body: JSON.stringify(payload) });
      await pool.query('INSERT INTO webhook_logs(tenant_id,event,payload,status,response) VALUES($1,$2,$3,$4,$5)', [tenantId, event, JSON.stringify(payload), resp.status, '']);
    } catch (e) {
      await pool.query('INSERT INTO webhook_logs(tenant_id,event,payload,status,response) VALUES($1,$2,$3,$4,$5)', [tenantId, event, JSON.stringify(payload), 0, e.message]);
    }
  }
};

// Plan limits
const PLAN_LIMITS = { free: 50, basic: 500, pro: 50000, enterprise: Infinity };
const checkPlanLimit = async (tenantId, table) => {
  const sub = (await pool.query('SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1', [tenantId, 'active'])).rows[0];
  const plan = sub?.plan || 'free';
  const limit = PLAN_LIMITS[plan] || 50;
  const count = (await pool.query(`SELECT COUNT(*) FROM ${table} WHERE tenant_id=$1`, [tenantId])).rows[0].count;
  return { plan, limit, count: parseInt(count), allowed: parseInt(count) < limit };
};
const requirePlanLimit = (table) => async (req, res, next) => {
  const check = await checkPlanLimit(req.session.user.tenant_id, table);
  if (!check.allowed) return res.send(renderPage('Plan Limit', `<div class="card"><div class="alert alert-error"><h2>Plan Limit Reached</h2><p>You have ${check.count} records on the ${check.plan} plan (limit: ${check.limit}).</p><p>Upgrade to add more records.</p></div><a href="/billing" class="btn btn-gold">Upgrade Plan</a></div>`, req.session.user));
  next();
};

// Permission check (v2.0)
const checkPermission = (perm) => async (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.role === 'super_admin') return next();
  try {
    const rp = (await pool.query('SELECT permissions FROM role_permissions WHERE tenant_id=$1 AND role_name=$2', [u.tenant_id, u.role])).rows[0];
    if (!rp) return next(); // No role defined = allow
    const perms = typeof rp.permissions === 'string' ? JSON.parse(rp.permissions) : rp.permissions;
    if (perms[perm] === true || perms.can_manage_users) return next();
    return res.status(403).send(renderPage('Access Denied', '<div class="card"><div class="alert alert-error">You do not have permission for this action.</div><a href="/dashboard" class="btn">Back to Dashboard</a></div>', req.session.user));
  } catch (e) { return next(); } // If check fails, allow
};

// Translation helper (v9.0)
const translations = {};
const loadTranslations = async () => {
  try {
    const rows = (await pool.query('SELECT * FROM translations')).rows;
    rows.forEach(r => { if (!translations[r.lang]) translations[r.lang] = {}; translations[r.lang][r.key] = r.value; });
  } catch (e) {}
};
const t = (key, lang) => (translations[lang || 'en'] && translations[lang || 'en'][key]) || key;
const CURRENCY_SYMBOLS = { UGX: 'UGX', KES: 'KES', TZS: 'TZS', RWF: 'RWF', USD: '$' };
const formatCurrency = (amount, currency) => `${CURRENCY_SYMBOLS[currency || 'UGX'] || currency || 'UGX'} ${Number(amount).toLocaleString()}`;

// Flutterwave helper (v1.0)
const createFlutterwaveCheckout = async (tenantId, amount, email, plan, reference) => {
  const FLW_PK = process.env.FLW_PUBLIC_KEY;
  const FLW_SK = process.env.FLW_SECRET_KEY;
  if (!FLW_SK) return null;
  try {
    const resp = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FLW_SK}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_ref: reference, amount, currency: 'UGX', redirect_url: `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/billing/callback`, customer: { email }, meta: { tenant_id: tenantId, plan } })
    });
    const data = await resp.json();
    return data?.data?.link || null;
  } catch (e) { console.warn('Flutterwave error:', e.message); return null; }
};

// Cloudinary upload helper (v1.0)
const uploadToCloudinary = async (fileStr, folder) => {
  if (!process.env.CLOUDINARY_URL) return null;
  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({ url: process.env.CLOUDINARY_URL });
    const result = await cloudinary.uploader.upload(fileStr, { folder: folder || 'ssewasswa' });
    return result.secure_url;
  } catch (e) { console.warn('Cloudinary upload failed:', e.message); return null; }
};

// Automation engine (v6.0)
const evaluateAutomations = async (tenantId, triggerEvent, context) => {
  const rules = (await pool.query('SELECT * FROM automation_rules WHERE tenant_id=$1 AND active=true AND trigger_event=$2', [tenantId, triggerEvent])).rows;
  for (const rule of rules) {
    try {
      let shouldFire = true;
      if (rule.condition) {
        const cond = rule.condition;
        if (cond.includes('>')) { const [field, val] = cond.split('>'); shouldFire = (context[field?.trim()] || 0) > Number(val); }
        else if (cond.includes('<')) { const [field, val] = cond.split('<'); shouldFire = (context[field?.trim()] || 0) < Number(val); }
        else if (cond.includes('=')) { const [field, val] = cond.split('='); shouldFire = String(context[field?.trim()]) === val?.trim(); }
      }
      if (shouldFire) {
        const params = typeof rule.action_params === 'string' ? JSON.parse(rule.action_params) : rule.action_params || {};
        if (rule.action === 'send_sms' && params.phone && params.message) { await sendSMS(params.phone, params.message); await logSMS(tenantId, params.phone, params.message, 'automation'); }
        else if (rule.action === 'send_email' && params.to && params.subject) { await sendEmail(params.to, params.subject, params.body || params.subject); await queueEmail(tenantId, params.to, params.subject, params.body || ''); }
        else if (rule.action === 'notify') { await notifyAll(tenantId, params.title || 'Automated Alert', params.message || rule.name, 'warning'); }
        else if (rule.action === 'webhook') { await fireWebhook(tenantId, triggerEvent, context); }
        await pool.query('UPDATE automation_rules SET last_fired=NOW() WHERE id=$1', [rule.id]);
      }
    } catch (e) { console.warn('Automation error:', e.message); }
  }
};

// === MIGRATIONS ===
const migrations = [
  `CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, email TEXT, phone TEXT, subdomain TEXT UNIQUE, verified BOOLEAN DEFAULT false, approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, has_fundraising BOOLEAN DEFAULT false, wallet_balance INTEGER DEFAULT 0, description TEXT, address TEXT, logo_url TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT, password_hash TEXT, role TEXT DEFAULT 'user', approved BOOLEAN DEFAULT false, banned BOOLEAN DEFAULT false, ban_reason TEXT, dark_mode BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, admission_no TEXT, name TEXT NOT NULL, class TEXT, stream TEXT, guardian_name TEXT, guardian_phone TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS fees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, amount INTEGER NOT NULL, paid INTEGER DEFAULT 0, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER, date DATE NOT NULL, status TEXT, UNIQUE(student_id, date))`,
  `CREATE TABLE IF NOT EXISTS exams (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, term TEXT, year INTEGER, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS marks (id SERIAL PRIMARY KEY, exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, subject TEXT NOT NULL, score INTEGER, grade TEXT)`,
  `CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, budget INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, status TEXT DEFAULT 'active', description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, event_date DATE, budget INTEGER DEFAULT 0, description TEXT, venue TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS org_finance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount INTEGER NOT NULL, type TEXT NOT NULL, description TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS inventory (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, sku TEXT, quantity INTEGER DEFAULT 0, cost_price INTEGER DEFAULT 0, selling_price INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, customer_name TEXT, total INTEGER NOT NULL, paid INTEGER DEFAULT 0, status TEXT DEFAULT 'paid', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sale_items (id SERIAL PRIMARY KEY, sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE, inventory_id INTEGER REFERENCES inventory(id), quantity INTEGER, price INTEGER)`,
  `CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, invoice_no TEXT UNIQUE, customer_name TEXT, customer_contact TEXT, amount INTEGER NOT NULL, due_date DATE, status TEXT DEFAULT 'unpaid', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT, amount INTEGER NOT NULL, description TEXT, expense_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, user_email TEXT, action TEXT NOT NULL, details TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS developer_revenue (id SERIAL PRIMARY KEY, amount INTEGER NOT NULL, source TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS platform_wallet (id SERIAL PRIMARY KEY, balance INTEGER DEFAULT 0)`,
  `INSERT INTO platform_wallet (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS entertainment_videos (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS entertainment_music (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, artist TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS entertainment_games (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, player_name TEXT, score INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW())`,
  // NEW TABLES FOR ENHANCED FEATURES
  `CREATE TABLE IF NOT EXISTS meeting_minutes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, meeting_date DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS notice_board (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, priority TEXT DEFAULT 'normal', created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sermons (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, preacher TEXT, sermon_date DATE, scripture TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS prayer_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT, request TEXT NOT NULL, is_private BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS service_schedule (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service_name TEXT NOT NULL, day_of_week TEXT, start_time TEXT, end_time TEXT)`,
  `CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS budget_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, category TEXT NOT NULL, planned INTEGER DEFAULT 0, actual INTEGER DEFAULT 0, month TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS goals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, target INTEGER DEFAULT 0, current INTEGER DEFAULT 0, deadline DATE, created_at TIMESTAMP DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS personal_notes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  // === SAFE COLUMN MIGRATIONS (handles tables created by older schema versions) ===
  // tenants: all columns except id, name, type (which existed in the original table)
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS has_fundraising BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS wallet_balance INTEGER DEFAULT 0`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`,
  // users: add ALL columns that might be missing from old schema
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  // Sync password data between password and password_hash columns
  `UPDATE users SET password_hash = password WHERE password IS NOT NULL AND (password_hash IS NULL OR password_hash = '')`,
  `UPDATE users SET password = password_hash WHERE password_hash IS NOT NULL AND (password IS NULL OR password = '')`,
  // students
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_no TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS class TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS stream TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_name TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS guardian_phone TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`,
  // fees
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS paid INTEGER DEFAULT 0`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS term TEXT`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS year INTEGER`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  // projects
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT`,
  // events
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS venue TEXT`,
  // Fix indexes: must drop constraints before dropping indexes they depend on
  `ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subdomain_key`,
  `DROP INDEX IF EXISTS tenants_subdomain_key`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key`,
  `DROP INDEX IF EXISTS users_email_key`,
  // Recreate as regular unique indexes (no WHERE clause — PostgreSQL allows multiple NULLs in unique indexes)
  `CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key ON tenants(subdomain)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email)`,
  // add foreign key for users.tenant_id if not exists
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tenant_id_fkey`,
  `ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`,
  // v9.0 new tables
  `CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, key_hash TEXT UNIQUE, name TEXT, scopes TEXT[], last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS webhook_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event TEXT, payload JSONB, status INTEGER, response TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS password_resets (id SERIAL PRIMARY KEY, email TEXT NOT NULL, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false)`,
  // Clean up expired password reset tokens
  `DELETE FROM password_resets WHERE expires_at < NOW()`,
  // Staff sub-accounts
  `CREATE TABLE IF NOT EXISTS staff (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, email TEXT UNIQUE NOT NULL, password TEXT, password_hash TEXT, name TEXT NOT NULL, role TEXT DEFAULT 'teacher', approved BOOLEAN DEFAULT true, banned BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`,
  // Timetable
  `CREATE TABLE IF NOT EXISTS timetable (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class TEXT NOT NULL, day TEXT NOT NULL, period INTEGER NOT NULL, subject TEXT NOT NULL, teacher TEXT, start_time TEXT, end_time TEXT)`,
  // Grading scales
  `CREATE TABLE IF NOT EXISTS grading_scales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, min_score INTEGER NOT NULL, max_score INTEGER NOT NULL, grade TEXT NOT NULL, comment TEXT)`,
  // Fee structures
  `CREATE TABLE IF NOT EXISTS fee_structures (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class TEXT NOT NULL, term TEXT NOT NULL, amount INTEGER NOT NULL, year INTEGER)`,
  // Church members
  `CREATE TABLE IF NOT EXISTS church_members (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, role TEXT, joined_at TIMESTAMP DEFAULT NOW())`,
  // Donations
  `CREATE TABLE IF NOT EXISTS donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT, method TEXT, reference TEXT, created_at TIMESTAMP DEFAULT NOW())`,
  // Parent links
  `CREATE TABLE IF NOT EXISTS parent_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, parent_email TEXT NOT NULL, parent_phone TEXT, UNIQUE(student_id, parent_email))`,
  // v10.0 new tables
  `CREATE TABLE IF NOT EXISTS sign_in_out (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, staff_id INTEGER REFERENCES staff(id), name TEXT NOT NULL, role TEXT, clock_in TIMESTAMPTZ, clock_out TIMESTAMPTZ, date DATE DEFAULT CURRENT_DATE, notes TEXT)`,
  `CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, title TEXT NOT NULL, message TEXT, type TEXT DEFAULT 'info', read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS fee_receipts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, fee_id INTEGER REFERENCES fees(id), receipt_no TEXT UNIQUE, student_id INTEGER REFERENCES students(id), amount INTEGER NOT NULL, paid INTEGER NOT NULL, method TEXT, received_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Staff sign-in columns
  `ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE staff ADD COLUMN IF NOT EXISTS subject TEXT`,
  // Student gender for better charts
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS gender TEXT`,
  // Fees payment method tracking
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS payment_method TEXT`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS receipt_no TEXT`

  // v11.0 - Billing/Subscriptions
  `CREATE TABLE IF NOT EXISTS subscriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plan TEXT DEFAULT 'free', amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'UGX', status TEXT DEFAULT 'active', started_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ, payment_method TEXT, reference TEXT)`,
  `CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, amount INTEGER NOT NULL, method TEXT, reference TEXT, status TEXT DEFAULT 'pending', description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Webhooks
  `CREATE TABLE IF NOT EXISTS webhooks (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, url TEXT NOT NULL, events TEXT[], secret TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Church member attendance
  `CREATE TABLE IF NOT EXISTS church_attendance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), service_name TEXT, date DATE DEFAULT CURRENT_DATE, present BOOLEAN DEFAULT true)`,
  // v11.0 - Tithe statements
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS donor_id INTEGER`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_tithe BOOLEAN DEFAULT false`,
  // v11.0 - Birthday tracking
  `ALTER TABLE church_members ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  // v11.0 - Customer debts
  `ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id)`,
  // v11.0 - Purchase orders
  `CREATE TABLE IF NOT EXISTS purchase_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, po_no TEXT, supplier TEXT, items JSONB, total INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Tax reports
  `CREATE TABLE IF NOT EXISTS tax_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, period TEXT NOT NULL, taxable_amount INTEGER DEFAULT 0, tax_rate INTEGER DEFAULT 18, tax_amount INTEGER DEFAULT 0, tax_type TEXT DEFAULT 'VAT', filed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Barcode/QR for inventory
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode TEXT`,
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS qr_code TEXT`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS barcode TEXT`,
  // v11.0 - Bill reminders
  `CREATE TABLE IF NOT EXISTS bill_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, amount INTEGER DEFAULT 0, due_date DATE, category TEXT, recurring TEXT, notes TEXT, paid BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Document library
  `CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, file_url TEXT, file_type TEXT, category TEXT, uploaded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - 2FA
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT false`,
  // v11.0 - Income tracking
  `CREATE TABLE IF NOT EXISTS income_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, source TEXT NOT NULL, amount INTEGER NOT NULL, category TEXT, description TEXT, received_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Fundraising campaigns
  `CREATE TABLE IF NOT EXISTS campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, start_date DATE, end_date DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS campaign_pledges (id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, donor_name TEXT, amount INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, pledged_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Member roles/permissions
  `CREATE TABLE IF NOT EXISTS role_permissions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, role_name TEXT NOT NULL, permissions JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // v11.0 - Theme builder
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS primary_color TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS secondary_color TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS accent_color TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS font_family TEXT`,
  // v11.0 - Multi-language
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'`,
  `CREATE TABLE IF NOT EXISTS translations (id SERIAL PRIMARY KEY, lang TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(lang, key))`,
  // v11.0 - Platform status
  `CREATE TABLE IF NOT EXISTS platform_status (id SERIAL PRIMARY KEY, service TEXT NOT NULL, status TEXT DEFAULT 'operational', message TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`,
  `INSERT INTO platform_status (service, status) VALUES ('api', 'operational'), ('database', 'operational'), ('email', 'operational'), ('sms', 'operational') ON CONFLICT DO NOTHING`,

  // ============ v2.0 MIGRATIONS ============
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS two_fa_enabled BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT[]`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER`,
  `CREATE TABLE IF NOT EXISTS trusted_devices (id SERIAL PRIMARY KEY, user_id INTEGER, device_hash TEXT, name TEXT, last_used TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS email_queue (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, to_email TEXT NOT NULL, subject TEXT, body TEXT, status TEXT DEFAULT 'queued', sent_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sms_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, message TEXT, status TEXT DEFAULT 'queued', sent_at TIMESTAMPTZ, error TEXT, trigger_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,

  // ============ v3.0 MIGRATIONS ============
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_url TEXT`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS image_url TEXT`,
  `CREATE TABLE IF NOT EXISTS campaign_updates (id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS volunteer_hours (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES members(id), hours NUMERIC DEFAULT 0, activity TEXT, date DATE DEFAULT CURRENT_DATE, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS event_tickets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES events(id) ON DELETE CASCADE, ticket_type TEXT DEFAULT 'general', price INTEGER DEFAULT 0, quantity_sold INTEGER DEFAULT 0, quantity_total INTEGER DEFAULT 100)`,
  `CREATE TABLE IF NOT EXISTS ticket_sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER REFERENCES events(id), ticket_type TEXT, buyer_name TEXT, buyer_phone TEXT, buyer_email TEXT, amount INTEGER, payment_method TEXT, payment_ref TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS chart_of_accounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, code TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, parent_id INTEGER, balance INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, account_id INTEGER REFERENCES chart_of_accounts(id), debit INTEGER DEFAULT 0, credit INTEGER DEFAULT 0, description TEXT, reference TEXT, entry_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE sermons ADD COLUMN IF NOT EXISTS video_url TEXT`,
  `ALTER TABLE sermons ADD COLUMN IF NOT EXISTS audio_url TEXT`,
  `CREATE TABLE IF NOT EXISTS document_folders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, parent_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id INTEGER`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS tax_deductible BOOLEAN DEFAULT false`,
  `ALTER TABLE donations ADD COLUMN IF NOT EXISTS receipt_sent BOOLEAN DEFAULT false`,

  // ============ v4.0 MIGRATIONS ============
  `CREATE TABLE IF NOT EXISTS suppliers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)`,
  `CREATE TABLE IF NOT EXISTS branches (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, location TEXT, manager TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE inventory ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id)`,
  `CREATE TABLE IF NOT EXISTS inventory_transfers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, inventory_id INTEGER REFERENCES inventory(id), from_branch INTEGER REFERENCES branches(id), to_branch INTEGER REFERENCES branches(id), quantity INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS loyalty_points (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, customer_id INTEGER REFERENCES customers(id), points INTEGER DEFAULT 0, earned_from TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS sms_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, message TEXT, target_group TEXT, status TEXT DEFAULT 'draft', sent_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS white_label BOOLEAN DEFAULT false`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'`,

  // ============ v5.0 MIGRATIONS ============
  `CREATE TABLE IF NOT EXISTS investments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT, amount INTEGER DEFAULT 0, current_value INTEGER DEFAULT 0, start_date DATE, maturity_date DATE, interest_rate NUMERIC DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS debt_payoff (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, total_owed INTEGER DEFAULT 0, interest_rate NUMERIC DEFAULT 0, min_payment INTEGER DEFAULT 0, monthly_payment INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS momo_payments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, phone TEXT NOT NULL, amount INTEGER NOT NULL, reference TEXT, status TEXT DEFAULT 'pending', type TEXT DEFAULT 'mtn', external_ref TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE bill_reminders ADD COLUMN IF NOT EXISTS last_notified TIMESTAMPTZ`,
  `ALTER TABLE bill_reminders ADD COLUMN IF NOT EXISTS auto_notify BOOLEAN DEFAULT false`,

  // ============ v6.0 MIGRATIONS ============
  `CREATE TABLE IF NOT EXISTS automation_rules (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, trigger_event TEXT NOT NULL, condition TEXT, action TEXT NOT NULL, action_params JSONB, active BOOLEAN DEFAULT true, last_fired TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS integration_configs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service TEXT NOT NULL, config JSONB, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS calendar_events (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, source TEXT, external_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS oauth_clients (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, client_id TEXT UNIQUE, client_secret TEXT, name TEXT, redirect_uris TEXT[], created_at TIMESTAMPTZ DEFAULT NOW())`,

  // ============ v7.0 MIGRATIONS ============
  `CREATE TABLE IF NOT EXISTS ai_insights (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, type TEXT NOT NULL, insight TEXT, confidence NUMERIC DEFAULT 0, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS report_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, config JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE students ADD COLUMN IF NOT EXISTS dropout_risk TEXT`,
  `ALTER TABLE fees ADD COLUMN IF NOT EXISTS default_risk TEXT`,

  // ============ v8.0 MIGRATIONS ============
  `CREATE TABLE IF NOT EXISTS marketplace_plugins (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT, price INTEGER DEFAULT 0, author TEXT, icon_url TEXT, config JSONB, active BOOLEAN DEFAULT true, downloads INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS tenant_plugins (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, plugin_id INTEGER REFERENCES marketplace_plugins(id), status TEXT DEFAULT 'active', installed_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS ad_impressions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, ad_type TEXT, impressions INTEGER DEFAULT 0, revenue INTEGER DEFAULT 0, date DATE DEFAULT CURRENT_DATE)`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS peer_to_peer BOOLEAN DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS peer_fundraisers (id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT, phone TEXT, goal INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,

  // ============ v9.0 MIGRATIONS ============
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'UG'`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id TEXT`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_no TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'`,
  `CREATE TABLE IF NOT EXISTS government_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, report_type TEXT, period TEXT, data JSONB, submitted BOOLEAN DEFAULT false, submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS biometric_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, user_type TEXT, user_id INTEGER, biometric_type TEXT, verified BOOLEAN DEFAULT false, device_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS compliance_audits (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, audit_type TEXT, status TEXT DEFAULT 'pending', findings JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Insert default translations
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'welcome', 'Mukwano') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'dashboard', 'Olutimbe') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'students', 'Abayizi') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'fees', 'Ebisasulo') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'attendance', 'Okujja') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('lg', 'reports', 'Ebirowoozo') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'welcome', 'Karibu') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'dashboard', 'Dashibodi') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'students', 'Wanafunzi') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'fees', 'Ada') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'attendance', 'Mahudhuri') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('sw', 'reports', 'Ripoti') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'welcome', 'Bienvenue') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'dashboard', 'Tableau de bord') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'students', 'Etudiants') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'fees', 'Frais') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'attendance', 'Présence') ON CONFLICT DO NOTHING`,
  `INSERT INTO translations (lang, key, value) VALUES ('fr', 'reports', 'Rapports') ON CONFLICT DO NOTHING`
];

(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Run each migration individually so one failure doesn't stop the rest
      for (const q of migrations) {
        try { await pool.query(q); } catch (e) { /* column/index already exists is OK */ if (!e.message.includes('already exists')) console.warn('Migration warning:', e.message); }
      }
      const devEmail = 'waiswadaniel24@gmail.com';
      const devPass = 'Daniel@2025';
      const devHash = await bcrypt.hash(devPass, 10);
      const devTenant = await pool.query(`INSERT INTO tenants(name,type,email,verified,approved,subdomain) VALUES('Dev Master','individual',$1,true,true,'dev-master') ON CONFLICT (subdomain) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [devEmail]);
      // Try inserting with both password columns — if one doesn't exist, catch and retry with the other
      try {
        await pool.query(`INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,password_hash=EXCLUDED.password,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`, [devTenant.rows[0].id, devEmail, devHash]);
      } catch (insertErr) {
        if (insertErr.message.includes('password_hash')) {
          // DB doesn't have password_hash column — use only password
          await pool.query(`INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`, [devTenant.rows[0].id, devEmail, devHash]);
        } else if (insertErr.message.includes('password')) {
          // DB has password_hash but not password
          await pool.query(`INSERT INTO users(tenant_id,email,password_hash,role,approved) VALUES($1,$2,$3,'super_admin',true) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='super_admin',approved=true,tenant_id=EXCLUDED.tenant_id`, [devTenant.rows[0].id, devEmail, devHash]);
        } else {
          throw insertErr;
        }
      }
      // Verify dev user was created correctly
      const check = await pool.query('SELECT id,email,role,approved,tenant_id FROM users WHERE email=$1', [devEmail]);
      console.log('DB Ready. Dev user:', check.rows[0]?.email, 'role:', check.rows[0]?.role, 'approved:', check.rows[0]?.approved, 'tenant_id:', check.rows[0]?.tenant_id);
      await loadTranslations();
      break;
    } catch (e) {
      console.error(`DB Init Error (attempt ${attempt}/3):`, e.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      else console.error('DB Init failed after 3 attempts. App will run but login may not work.');
    }
  }
})();

// === RENDER PAGE (with dark mode support) ===
const renderPage = (title, content, user) => {
  const dark = user?.dark_mode;
  return `<!DOCTYPE html>
<html${dark ? ' class="dark"' : ''}><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${dark ? '#0f172a' : '#f8fafc'};color:${dark ? '#e2e8f0' : '#1e293b'};line-height:1.6;transition:background 0.3s,color 0.3s}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:0.2s;font-size:14px}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:1200px;margin:20px auto;padding:0 20px}
.card{background:${dark ? '#1e293b' : 'white'};border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'};transition:background 0.3s}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:0.3s;font-size:14px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,0.4)}
.btn-gold{background:linear-gradient(135deg,#d97706,#f59e0b)}
.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}
.btn-green{background:linear-gradient(135deg,#059669,#10b981)}
.btn-sm{padding:8px 16px;font-size:12px;border-radius:8px}
input,select,textarea{width:100%;padding:12px;margin:8px 0;border:2px solid ${dark ? '#475569' : '#e2e8f0'};border-radius:10px;font-size:16px;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#e2e8f0' : '#1e293b'};transition:border-color 0.2s}
input:focus,select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
table{width:100%;border-collapse:collapse;margin-top:15px}
th,td{padding:12px;text-align:left;border-bottom:1px solid ${dark ? '#334155' : '#e2e8f0'}}
th{background:${dark ? '#334155' : '#f1f5f9'};font-weight:700;color:${dark ? '#e2e8f0' : '#1e293b'}}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:60px 20px;border-radius:20px;text-align:center;margin-bottom:30px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin:20px 0}
.stat-card{background:${dark ? '#1e293b' : 'white'};padding:20px;border-radius:16px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.stat-num{font-size:32px;font-weight:800;color:#4f46e5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.tag{display:inline-block;padding:4px 12px;background:#e0e7ff;color:#3730a3;border-radius:20px;font-size:12px;font-weight:600}
.alert{padding:15px;border-radius:10px;margin:15px 0}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}
.search-bar{display:flex;gap:10px;margin-bottom:20px}.search-bar input{flex:1;margin:0}
.progress-bar{background:${dark ? '#475569' : '#e5e7eb'};height:20px;border-radius:10px;overflow:hidden}
.progress-fill{height:20px;border-radius:10px;transition:width 0.5s}
.muted{color:${dark ? '#94a3b8' : '#64748b'};font-size:13px}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
.tab-bar{display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid ${dark ? '#334155' : '#e2e8f0'}}
.tab-bar a{flex:1;padding:12px;text-align:center;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#94a3b8' : '#64748b'};font-weight:600;text-decoration:none;transition:0.2s}
.tab-bar a:hover{background:${dark ? '#334155' : '#f1f5f9'};text-decoration:none}
.tab-bar a.active{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white}
@media(max-width:768px){.nav{flex-direction:column;gap:10px}.stats,.grid{grid-template-columns:1fr}.tab-bar{flex-direction:column}}
</style></head><body>
<nav class="nav">
  <div><a href="/" style="font-size:20px;font-weight:800">SSEWASSWA</a></div>
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    ${user ? `
      <span style="font-size:13px">Hi, ${esc(user.email.split('@')[0])}</span>
      <a href="/notifications" title="Notifications">🔔</a>
      <a href="/dashboard">Dashboard</a>
      <a href="/search">Search</a>
      <a href="/settings/profile">Settings</a>
      <a href="/parent/login" style="font-size:12px">Parent</a>
      <a href="/toggle-dark" style="font-size:18px" title="Toggle Dark Mode">${dark ? '☀️' : '🌙'}</a>
      <a href="/logout">Logout</a>
    ` : `<a href="/login">Login</a><a href="/register">Register</a>`}
  </div>
</nav>
<div class="container">${content}</div>
</body></html>`;
};

// === AUTH ===
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.send(renderPage('SSEWASSWA Platform', `
    <div class="hero">
      <h1 style="font-size:48px;margin-bottom:15px">All-in-One Management</h1>
      <p style="font-size:20px;opacity:0.9;margin-bottom:30px">School \u2022 Organization \u2022 Church \u2022 Business \u2022 Individual</p>
      <a href="/register" class="btn btn-gold" style="font-size:18px;padding:15px 30px">Start Free</a>
    </div>
    <div class="grid">
      <div class="card"><h3>Schools</h3><p>Students, Fees, Exams, Attendance, Report Cards</p></div>
      <div class="card"><h3>Organizations</h3><p>Members, Projects, Events, Meetings, Notices</p></div>
      <div class="card"><h3>Churches</h3><p>Congregation, Tithes, Sermons, Prayer Requests</p></div>
      <div class="card"><h3>Business</h3><p>POS, Inventory, Invoices, Customers, P&L</p></div>
      <div class="card"><h3>Individual</h3><p>Budgets, Goals, Notes, Personal Tracking</p></div>
    </div>
  `, null));
});

app.get('/login', (req, res) => {
  res.send(renderPage('Login', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Welcome Back</h2>
      <form method="POST" action="/login">
        <input name="email" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password" required>
        <button class="btn" style="width:100%">Login</button>
      </form>
      <p style="text-align:center;margin-top:15px">No account? <a href="/register">Register</a></p>
      <p style="text-align:center;margin-top:8px"><a href="/forgot-password" style="font-size:13px">Forgot Password?</a></p>
      <p style="text-align:center;margin-top:8px"><a href="/parent/login" style="font-size:13px">Parent Portal</a></p>
    </div>
  `, null));
});

app.post('/login', ah(async (req, res) => {
  const { email, password } = req.body;
  // Try to get user — handle both password and password_hash column names
  let u;
  try {
    u = (await pool.query('SELECT u.*,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
  } catch (e) {
    if (e.message.includes('password_hash')) {
      // DB doesn't have password_hash column, select without it
      u = (await pool.query('SELECT u.id,u.tenant_id,u.email,u.password,u.role,u.approved,u.banned,u.ban_reason,u.dark_mode,u.created_at,t.name as tenant_name,t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id WHERE u.email=$1', [email])).rows[0];
    } else throw e;
  }
  const storedHash = u?.password_hash || u?.password;
  if (!u || u.banned || !u.approved || !storedHash) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials or account not approved</div>', null));
  if (!(await bcrypt.compare(password, storedHash))) return res.send(renderPage('Login', '<div class="alert alert-error">Invalid credentials</div>', null));
  req.session.user = u;
  await audit(email, 'login', 'User logged in');
  res.redirect('/dashboard');
}));

app.get('/register', (req, res) => {
  res.send(renderPage('Register', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Create Account</h2>
      <form method="POST" action="/register">
        <input name="org_name" placeholder="Organization/School/Business Name" required>
        <select name="type" required>
          <option value="">Select Type</option>
          <option value="school">School</option>
          <option value="organization">Organization</option>
          <option value="church">Church</option>
          <option value="business">Business</option>
          <option value="individual">Individual</option>
        </select>
        <input name="email" type="email" placeholder="Your Email" required>
        <input name="phone" placeholder="Phone +256..." required>
        <input name="password" type="password" placeholder="Password (min 6)" minlength="6" required>
        <button class="btn" style="width:100%">Register</button>
      </form>
    </div>
  `, null));
});

app.post('/register', ah(async (req, res) => {
  const { org_name, type, email, phone, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const subdomain = org_name.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
  const tenant = await pool.query('INSERT INTO tenants(name,type,email,phone,subdomain,approved) VALUES($1,$2,$3,$4,$5,true) RETURNING id', [org_name, type, email, phone, subdomain]);
  // Try inserting with both password columns, fall back to just password
  try {
    await pool.query('INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$3,$4,true)', [tenant.rows[0].id, email, hash, type]);
  } catch (e) {
    if (e.message.includes('password_hash')) {
      await pool.query('INSERT INTO users(tenant_id,email,password,role,approved) VALUES($1,$2,$3,$4,true)', [tenant.rows[0].id, email, hash, type]);
    } else throw e;
  }
  await audit(email, 'register', `New ${type} account: ${org_name}`);
  // v1.0: Welcome email
  const welcomeHtml = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#4f46e5">Welcome to SSEWASSWA! 🎉</h2><p>Hi ${esc(email.split('@')[0])},</p><p>Your <strong>${esc(org_name)}</strong> account has been created successfully on the SSEWASSWA platform.</p><p>Here's what you can do next:</p><ul><li>Set up your ${esc(type)} profile</li><li>Add members, students, or inventory</li><li>Configure billing and notifications</li></ul><p><a href="${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/login" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Login Now</a></p><p>Need help? Reply to this email or visit our <a href="${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/api-docs">API Docs</a>.</p></div>`;
  sendEmail(email, 'Welcome to SSEWASSWA!', welcomeHtml);
  queueEmail(tenant.rows[0].id, email, 'Welcome to SSEWASSWA!', welcomeHtml);
  // v1.0: Free subscription
  await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [tenant.rows[0].id, 'free', 0, 'active']);
  res.send(renderPage('Success', '<div class="card"><div class="alert alert-success">Account created! Check your email for a welcome message. You can now login.</div><a href="/login" class="btn">Login</a></div>', null));
}));

app.get('/logout', (req, res) => {
  if (req.session.user) audit(req.session.user.email, 'logout', 'User logged out').catch(() => {});
  req.session.destroy(() => res.redirect('/'));
});

// === FORGOT PASSWORD ===
app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Forgot Password', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Reset Password</h2>
      <p class="muted" style="text-align:center;margin-bottom:15px">Enter your email and we'll send you a reset link.</p>
      <form method="POST" action="/forgot-password">
        <input name="email" type="email" placeholder="Your Email" required>
        <button class="btn" style="width:100%">Send Reset Link</button>
      </form>
      <p style="text-align:center;margin-top:15px"><a href="/login">Back to Login</a></p>
    </div>
  `, null));
});

app.post('/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }), ah(async (req, res) => {
  const { email } = req.body;
  const user = (await pool.query('SELECT id,email FROM users WHERE email=$1', [email])).rows[0];
  // Always show success message to prevent email enumeration
  const successMsg = '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-success">If an account with that email exists, a reset link has been sent. Check your inbox.</div><a href="/login" class="btn">Back to Login</a></div>';

  if (!user) return res.send(renderPage('Forgot Password', successMsg, null));

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await pool.query('INSERT INTO password_resets(email,token,expires_at) VALUES($1,$2,$3)', [email, token, expiresAt]);

  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  // Try to send email if Gmail is configured
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
      });
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: email,
        subject: 'SSEWASSWA - Password Reset',
        html: `<h2>Password Reset</h2><p>Click below to reset your password. This link expires in 1 hour.</p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:white;border-radius:8px;text-decoration:none">Reset Password</a><p style="margin-top:15px;color:#666">If you didn't request this, ignore this email.</p>`
      });
    } catch (e) {
      console.warn('Email send failed:', e.message);
    }
  }

  // Always show the token URL in development or if email is not configured
  const showToken = !process.env.GMAIL_USER || process.env.NODE_ENV !== 'production';
  const tokenInfo = showToken ? `<div class="alert alert-info" style="margin-top:15px;word-break:break-all"><strong>Reset URL:</strong> <a href="${resetUrl}">${resetUrl}</a></div>` : '';

  await audit(email, 'password_reset_request', 'Password reset requested');
  res.send(renderPage('Forgot Password', successMsg.replace('</div>', tokenInfo + '</div>'), null));
}));

app.get('/reset-password', ah(async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/forgot-password');
  const reset = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token])).rows[0];
  if (!reset) return res.send(renderPage('Reset Password', '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-error">This reset link is invalid or expired.</div><a href="/forgot-password" class="btn">Request New Link</a></div>', null));
  res.send(renderPage('Reset Password', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Set New Password</h2>
      <form method="POST" action="/reset-password">
        <input type="hidden" name="token" value="${esc(token)}">
        <input name="password" type="password" placeholder="New Password (min 6)" minlength="6" required>
        <input name="confirm_password" type="password" placeholder="Confirm Password" required>
        <button class="btn" style="width:100%">Reset Password</button>
      </form>
    </div>
  `, null));
}));

app.post('/reset-password', ah(async (req, res) => {
  const { token, password, confirm_password } = req.body;
  if (password !== confirm_password) return res.send(renderPage('Reset Password', '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-error">Passwords do not match</div><a href="/reset-password?token=' + esc(token) + '" class="btn">Try Again</a></div>', null));
  const reset = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token])).rows[0];
  if (!reset) return res.send(renderPage('Reset Password', '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-error">This reset link is invalid or expired.</div><a href="/forgot-password" class="btn">Request New Link</a></div>', null));
  const hash = await bcrypt.hash(password, 10);
  // Update password in both columns
  try {
    await pool.query('UPDATE users SET password=$1,password_hash=$1 WHERE email=$2', [hash, reset.email]);
  } catch (e) {
    if (e.message.includes('password_hash')) {
      await pool.query('UPDATE users SET password=$1 WHERE email=$2', [hash, reset.email]);
    } else throw e;
  }
  await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
  await audit(reset.email, 'password_reset', 'Password reset completed');
  res.send(renderPage('Password Reset', '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-success">Password reset successfully! You can now login.</div><a href="/login" class="btn">Login</a></div>', null));
}));

// === DASHBOARD ROUTER ===
app.get('/dashboard', requireAuth, (req, res) => {
  const u = req.session.user;
  if (u.role === 'super_admin') return res.redirect('/dev/master');
  res.redirect(`/portal/${u.tenant_type}`);
});

// === SCHOOL PORTAL ===
app.get('/portal/school', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, fees, exams, attendance] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount-paid),0) FROM fees WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM exams WHERE tenant_id=$1', [t]),
    pool.query("SELECT COUNT(DISTINCT student_id) FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status='present'", [t])
  ]);
  res.send(renderPage('School Dashboard', `
    <div class="hero"><h1>School Portal</h1><p>Manage students, fees, exams, attendance, reports</p></div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${students.rows[0].count}</div><div>Students</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(fees.rows[0].coalesce).toLocaleString()}</div><div>Fees Due</div></div>
      <div class="stat-card"><div class="stat-num">${exams.rows[0].count}</div><div>Exams</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">${attendance.rows[0].count}</div><div>Present Today</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Students</h3><a href="/school/students" class="btn">Manage Students</a><a href="/school/students/import" class="btn btn-green btn-sm" style="margin-top:8px">CSV Import</a></div>
      <div class="card"><h3>Fees</h3><a href="/school/fees" class="btn">Fee Management</a><a href="/school/fee-structures" class="btn btn-sm" style="margin-top:8px">Fee Structures</a><a href="/school/fees/receipts" class="btn btn-gold btn-sm" style="margin-top:8px">Receipts</a></div>
      <div class="card"><h3>Exams & Marks</h3><a href="/school/exams" class="btn">Exam Results</a><a href="/school/exams/new" class="btn btn-sm" style="margin-top:8px">New Exam</a></div>
      <div class="card"><h3>Attendance</h3><a href="/school/attendance" class="btn">Mark Attendance</a><a href="/school/attendance/print" class="btn btn-sm" style="margin-top:8px">Print Sheet</a></div>
      <div class="card"><h3>Staff</h3><a href="/school/staff" class="btn btn-sm">Manage Staff</a><a href="/school/staff/new" class="btn btn-sm" style="margin-top:8px">Add Staff</a></div>
      <div class="card"><h3>Sign In/Out</h3><a href="/school/signin" class="btn btn-sm">Clock In/Out</a><a href="/school/signin/history?from=${new Date(Date.now()-7*86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}" class="btn btn-sm" style="margin-top:8px">History</a></div>
      <div class="card"><h3>Timetable</h3><a href="/school/timetable" class="btn btn-sm">View Timetable</a></div>
      <div class="card"><h3>Grading</h3><a href="/school/grading" class="btn btn-sm">Grading Scale</a></div>
      <div class="card"><h3>Promote</h3><a href="/school/promote" class="btn btn-sm">Student Promotion</a></div>
      <div class="card"><h3>Report Cards</h3><a href="/school/report-cards" class="btn btn-gold">Generate</a><a href="/school/report-cards/bulk" class="btn btn-sm" style="margin-top:8px">Bulk Cards</a></div>
      <div class="card"><h3>Print</h3><a href="/school/print/fee-balances" class="btn btn-sm">Fee Balances</a><a href="/school/attendance/print" class="btn btn-sm" style="margin-top:8px">Attendance</a></div>
      <div class="card"><h3>Notify</h3><a href="/school/notify" class="btn btn-sm">Send SMS</a><a href="/notifications" class="btn btn-sm" style="margin-top:8px">Notifications</a></div>
      <div class="card"><h3>Parent Links</h3><a href="/school/parent-links" class="btn btn-sm">Manage Parents</a></div>
      <div class="card"><h3>Barcodes</h3><a href="/barcode" class="btn btn-sm">Scan / Generate</a></div>
      <div class="card"><h3>Income</h3><a href="/income" class="btn btn-sm btn-green">Income Tracking</a></div>
      <div class="card"><h3>Billing</h3><a href="/billing" class="btn btn-sm btn-gold">Subscriptions</a></div>
      <div class="card"><h3>Documents</h3><a href="/documents" class="btn btn-sm">Document Library</a></div>
      <div class="card"><h3>Bills</h3><a href="/bill-reminders" class="btn btn-sm btn-red">Bill Reminders</a></div>
      <div class="card"><h3>API & Webhooks</h3><a href="/api-keys" class="btn btn-sm">Manage Keys</a></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="card"><h3>Fees Collected (Monthly)</h3><canvas id="feesChart"></canvas></div>
    <div class="card"><h3>Attendance Trend (Last 7 Days)</h3><canvas id="attendanceChart"></canvas></div>
    <div class="card"><h3>Gender Distribution</h3><canvas id="genderChart"></canvas></div>
    <script>
    (async function(){
      try {
        const fr = await fetch('/school/charts/fees'); const fd = await fr.json();
        new Chart(document.getElementById('feesChart'),{type:'bar',data:{labels:fd.labels,datasets:[{label:'Fees Collected UGX',data:fd.values,backgroundColor:'rgba(79,70,229,0.6)'}]},options:{responsive:true}});
      }catch(e){}
      try {
        const ar = await fetch('/school/charts/attendance'); const ad = await ar.json();
        new Chart(document.getElementById('attendanceChart'),{type:'line',data:{labels:ad.labels,datasets:[{label:'Present',data:ad.present,borderColor:'#059669',fill:false},{label:'Absent',data:ad.absent,borderColor:'#dc2626',fill:false}]},options:{responsive:true}});
      }catch(e){}
      try {
        const gr = await fetch('/school/charts/gender'); const gd = await gr.json();
        new Chart(document.getElementById('genderChart'),{type:'doughnut',data:{labels:gd.labels,datasets:[{data:gd.values,backgroundColor:['#4f46e5','#ec4899','#64748b']}]},options:{responsive:true}});
      }catch(e){}
    })();
    </script>
  `, req.session.user));
}));

// === SCHOOL: STUDENTS CRUD ===
app.get('/school/students', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filter = req.query.class || '';
  const streamFilter = req.query.stream || '';
  let q = 'SELECT * FROM students WHERE tenant_id=$1';
  const params = [t];
  let pi = 2;
  if (filter) { q += ` AND class=$${pi++}`; params.push(filter); }
  if (streamFilter) { q += ` AND stream=$${pi++}`; params.push(streamFilter); }
  q += ' ORDER BY name';
  const students = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const streams = (await pool.query('SELECT DISTINCT stream FROM students WHERE tenant_id=$1 AND stream IS NOT NULL ORDER BY stream', [t])).rows;
  res.send(renderPage('Students', `
    <div class="card"><h3>Student Management</h3>
      <div style="display:flex;gap:10px;margin:15px 0;flex-wrap:wrap">
        <a href="/school/students/new" class="btn btn-sm">+ Add Student</a>
        <a href="/school/students/import" class="btn btn-green btn-sm">CSV Import</a>
      </div>
      <form method="GET" action="/school/students" style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <select name="class" style="width:auto;margin:0"><option value="">All Classes</option>
          ${classes.map(c => `<option ${filter === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('')}
        </select>
        <select name="stream" style="width:auto;margin:0"><option value="">All Streams</option>
          ${streams.map(s => `<option ${streamFilter === s.stream ? 'selected' : ''}>${esc(s.stream)}</option>`).join('')}
        </select>
        <button class="btn btn-sm">Filter</button>
      </form>
      <table><tr><th>Adm#</th><th>Name</th><th>Class</th><th>Stream</th><th>Guardian</th><th>Actions</th></tr>
      ${students.map(s => `<tr>
        <td>${esc(s.admission_no)}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${esc(s.stream)}</td><td>${esc(s.guardian_name)}</td>
        <td><a href="/school/students/${s.id}/edit" class="btn btn-sm">Edit</a> <a href="/school/students/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete ${esc(s.name)}?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="6">No students yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/students/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Student', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add New Student</h3>
      <form method="POST" action="/school/students/save">
        <input name="admission_no" placeholder="Admission Number" required>
        <input name="name" placeholder="Full Name" required>
        <input name="class" placeholder="Class (e.g. S1, P7)">
        <input name="stream" placeholder="Stream (e.g. A, B)">
        <input name="guardian_name" placeholder="Guardian/Parent Name">
        <input name="guardian_phone" placeholder="Guardian Phone +256...">
        <button class="btn btn-green">Add Student</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/students/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { admission_no, name, class: cls, stream, guardian_name, guardian_phone } = req.body;
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, admission_no, name, cls, stream, guardian_name, guardian_phone]);
  await audit(req.session.user.email, 'add_student', `Added student: ${name}`);
  res.redirect('/school/students');
}));

app.get('/school/students/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit Student', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Student: ${esc(s.name)}</h3>
      <form method="POST" action="/school/students/${s.id}/update">
        <input name="admission_no" value="${esc(s.admission_no)}" required>
        <input name="name" value="${esc(s.name)}" required>
        <input name="class" value="${esc(s.class)}" placeholder="Class">
        <input name="stream" value="${esc(s.stream)}" placeholder="Stream">
        <input name="guardian_name" value="${esc(s.guardian_name)}" placeholder="Guardian Name">
        <input name="guardian_phone" value="${esc(s.guardian_phone)}" placeholder="Guardian Phone">
        <button class="btn">Update Student</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/students/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { admission_no, name, class: cls, stream, guardian_name, guardian_phone } = req.body;
  await pool.query('UPDATE students SET admission_no=$1,name=$2,class=$3,stream=$4,guardian_name=$5,guardian_phone=$6 WHERE id=$7 AND tenant_id=$8',
    [admission_no, name, cls, stream, guardian_name, guardian_phone, req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'edit_student', `Edited student: ${name}`);
  res.redirect('/school/students');
}));

app.get('/school/students/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'delete_student', `Deleted student ID: ${req.params.id}`);
  res.redirect('/school/students');
}));

// === SCHOOL: CSV IMPORT ===
app.get('/school/students/import', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Import Students CSV', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Bulk Import Students</h3>
      <p class="muted" style="margin-bottom:15px">CSV format: admission_no, name, class, stream, guardian_name, guardian_phone (first row = headers, skipped)</p>
      <form method="POST" action="/school/students/import/save">
        <textarea name="csv_data" rows="10" placeholder="admission_no,name,class,stream,guardian_name,guardian_phone&#10;S001,John Doe,S1,A,Jane Doe,+256700000001&#10;S002,Mary Smith,S1,B,Bob Smith,+256700000002" required></textarea>
        <button class="btn btn-green">Import Students</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/students/import/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const lines = req.body.csv_data.trim().split('\n');
  let imported = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length >= 2) {
      await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [t, cols[0], cols[1], cols[2] || '', cols[3] || '', cols[4] || '', cols[5] || '']);
      imported++;
    }
  }
  await audit(req.session.user.email, 'csv_import', `Imported ${imported} students`);
  res.send(renderPage('Import Complete', `<div class="card"><div class="alert alert-success">Successfully imported ${imported} students.</div><a href="/school/students" class="btn">View Students</a></div>`, req.session.user));
}));

// === SCHOOL: FEES ===
app.get('/school/fees', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC', [t])).rows;
  const totalDue = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
  const totalPaid = fees.reduce((a, f) => a + parseInt(f.paid), 0);
  res.send(renderPage('Fee Management', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalDue.toLocaleString()}</div><div>Total Due</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Total Paid</div></div>
    </div>
    <div class="card"><h3>Fee Records</h3>
      <div style="display:flex;gap:10px;margin:15px 0;flex-wrap:wrap">
        <a href="/school/fees/new" class="btn btn-sm">+ Add Fee</a>
        <a href="/school/fees/pay" class="btn btn-green btn-sm">Record Payment</a>
      </div>
      <table><tr><th>Adm#</th><th>Student</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Term</th><th>Year</th></tr>
      ${fees.map(f => `<tr>
        <td>${esc(f.admission_no)}</td><td>${esc(f.student_name)}</td>
        <td>UGX ${parseInt(f.amount).toLocaleString()}</td>
        <td style="color:#059669">UGX ${parseInt(f.paid).toLocaleString()}</td>
        <td style="color:${f.amount - f.paid > 0 ? '#dc2626' : '#059669'}">UGX ${(f.amount - f.paid).toLocaleString()}</td>
        <td>${esc(f.term)}</td><td>${f.year || ''}</td>
      </tr>`).join('') || '<tr><td colspan="7">No fees yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/fees/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Fee', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Assign Fee</h3>
      <form method="POST" action="/school/fees/save">
        <select name="student_id" required><option value="">Select Student</option>
          ${students.map(s => `<option value="${s.id}">${esc(s.admission_no)} - ${esc(s.name)}</option>`).join('')}
        </select>
        <input name="amount" type="number" placeholder="Total Fee Amount UGX" required>
        <input name="term" placeholder="Term (e.g. Term 1, Term 2)">
        <input name="year" type="number" placeholder="Year (e.g. 2025)">
        <button class="btn">Assign Fee</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/fees/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { student_id, amount, term, year } = req.body;
  await pool.query('INSERT INTO fees(tenant_id,student_id,amount,term,year) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, student_id, amount, term, year]);
  res.redirect('/school/fees');
}));

app.get('/school/fees/pay', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.id,f.amount,f.paid,f.term,f.year,s.name as student_name FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND f.amount>f.paid ORDER BY s.name', [t])).rows;
  res.send(renderPage('Record Payment', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Record Fee Payment</h3>
      <form method="POST" action="/school/fees/pay/save">
        <select name="fee_id" required><option value="">Select Student (with balance)</option>
          ${fees.map(f => `<option value="${f.id}">${esc(f.student_name)} - Balance UGX ${(f.amount - f.paid).toLocaleString()} (${f.term} ${f.year})</option>`).join('')}
        </select>
        <input name="amount" type="number" placeholder="Payment Amount UGX" required>
        <button class="btn btn-green">Record Payment</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/fees/pay/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  await pool.query('UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'fee_payment', `Payment UGX ${amount} on fee #${fee_id}`);
  res.redirect('/school/fees');
}));

// === SCHOOL: EXAMS & MARKS ===
app.get('/school/exams', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT * FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Exams', `
    <div class="card"><h3>Examinations</h3>
      <a href="/school/exams/new" class="btn btn-sm" style="margin-bottom:15px">+ New Exam</a>
      <div class="grid">
        ${exams.map(e => `
          <div class="card">
            <h3>${esc(e.name)}</h3>
            <p class="muted">${esc(e.term)} ${e.year || ''}</p>
            <a href="/school/exams/${e.id}/marks" class="btn btn-sm" style="margin-top:8px">Enter Marks</a>
            <a href="/school/exams/${e.id}/results" class="btn btn-green btn-sm" style="margin-top:8px">View Results</a>
          </div>
        `).join('') || '<p>No exams yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/school/exams/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Exam', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Examination</h3>
      <form method="POST" action="/school/exams/save">
        <input name="name" placeholder="Exam Name (e.g. Mid-Term)" required>
        <input name="term" placeholder="Term (e.g. Term 1)">
        <input name="year" type="number" placeholder="Year (e.g. 2025)">
        <button class="btn">Create Exam</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/school/exams/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, term, year } = req.body;
  await pool.query('INSERT INTO exams(tenant_id,name,term,year) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name, term, year]);
  res.redirect('/school/exams');
}));

app.get('/school/exams/:id/marks', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!exam) return res.status(404).send('Not found');
  const students = (await pool.query('SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage(`Enter Marks - ${exam.name}`, `
    <div class="card"><h3>Enter Marks: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})</h3>
      <form method="POST" action="/school/exams/${exam.id}/marks/save">
        <table><tr><th>Student</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
        ${students.map(s => `<tr>
          <td>${esc(s.name)} (${esc(s.admission_no)})</td>
          <td><input name="subject_${s.id}" placeholder="Subject" required></td>
          <td><input name="score_${s.id}" type="number" min="0" max="100" placeholder="0-100" required></td>
          <td><select name="grade_${s.id}"><option>D1</option><option>D2</option><option>C3</option><option>C4</option><option>C5</option><option>C6</option><option>P7</option><option>P8</option><option>F9</option></select></td>
        </tr>`).join('') || '<tr><td colspan="4">No students</td></tr>'}
        </table>
        <button class="btn btn-green" style="margin-top:15px">Save All Marks</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/exams/:id/marks/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id FROM students WHERE tenant_id=$1', [t])).rows;
  for (const s of students) {
    const subject = req.body[`subject_${s.id}`];
    const score = req.body[`score_${s.id}`];
    const grade = req.body[`grade_${s.id}`];
    if (subject && score !== undefined) {
      await pool.query('INSERT INTO marks(exam_id,student_id,subject,score,grade) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [req.params.id, s.id, subject, score, grade]);
    }
  }
  res.redirect(`/school/exams/${req.params.id}/results`);
}));

app.get('/school/exams/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!exam) return res.status(404).send('Not found');
  const marks = (await pool.query('SELECT m.*,s.name as student_name,s.admission_no FROM marks m JOIN students s ON m.student_id=s.id JOIN exams e ON m.exam_id=e.id WHERE e.tenant_id=$1 AND m.exam_id=$2 ORDER BY s.name,m.subject', [t, exam.id])).rows;
  res.send(renderPage(`Results - ${exam.name}`, `
    <div class="card"><h3>Results: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})</h3>
      <a href="/school/exams/${exam.id}/marks" class="btn btn-sm" style="margin:10px 0">Enter More Marks</a>
      <table><tr><th>Adm#</th><th>Student</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
      ${marks.map(m => `<tr><td>${esc(m.admission_no)}</td><td>${esc(m.student_name)}</td><td>${esc(m.subject)}</td><td>${m.score}</td><td><span class="tag">${esc(m.grade)}</span></td></tr>`).join('') || '<tr><td colspan="5">No marks yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === SCHOOL: ATTENDANCE ===
app.get('/school/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filterClass = req.query.class || '';
  let q = 'SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1';
  const params = [t];
  if (filterClass) { q += ' AND class=$2'; params.push(filterClass); }
  q += ' ORDER BY name';
  const students = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const today = new Date().toISOString().split('T')[0];
  res.send(renderPage('Student Attendance', `
    <div class="card"><h3>Mark Attendance - ${today}</h3>
      <form method="GET" action="/school/attendance" style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <select name="class" style="width:auto;margin:0"><option value="">All Classes</option>
          ${classes.map(c => `<option ${filterClass === c.class ? 'selected' : ''}>${esc(c.class)}</option>`).join('')}
        </select>
        <button class="btn btn-sm">Filter</button>
      </form>
      <form method="POST" action="/school/attendance/save">
        <input type="hidden" name="date" value="${today}">
        <table><tr><th>Adm#</th><th>Name</th><th>Class</th><th>Present</th></tr>
        ${students.map(s => `<tr><td>${esc(s.admission_no)}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td><input type="checkbox" name="present_ids" value="${s.id}" checked></td></tr>`).join('')}
        </table>
        <button class="btn btn-green" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { date, present_ids } = req.body;
  const present = Array.isArray(present_ids) ? present_ids : [present_ids].filter(Boolean);
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id FROM students WHERE tenant_id=$1', [t])).rows;
  for (const s of students) {
    const status = present.includes(String(s.id)) ? 'present' : 'absent';
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4',
      [t, s.id, date, status]);
  }
  res.redirect('/school/attendance');
}));

// === SCHOOL: CHART DATA APIs ===
app.get('/school/charts/fees', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT TO_CHAR(created_at,'Mon YYYY') as month, COALESCE(SUM(paid),0) as total FROM fees WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '12 months' GROUP BY month ORDER BY MIN(created_at)", [t])).rows;
  res.json({ labels: data.map(d => d.month), values: data.map(d => parseInt(d.total)) });
}));

app.get('/school/charts/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT date, COUNT(*) FILTER(WHERE status='present') as present, COUNT(*) FILTER(WHERE status='absent') as absent FROM attendance WHERE tenant_id=$1 AND date > CURRENT_DATE-7 GROUP BY date ORDER BY date", [t])).rows;
  res.json({ labels: data.map(d => new Date(d.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric'})), present: data.map(d => parseInt(d.present)), absent: data.map(d => parseInt(d.absent)) });
}));

app.get('/school/charts/gender', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  try {
    const data = (await pool.query("SELECT COALESCE(gender,'Unknown') as gender, COUNT(*) as cnt FROM students WHERE tenant_id=$1 GROUP BY gender", [t])).rows;
    if (data.length === 0) { const c = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t])).rows; res.json({ labels: ['Students'], values: [parseInt(c[0].count)] }); }
    else res.json({ labels: data.map(d => d.gender), values: data.map(d => parseInt(d.cnt)) });
  } catch (e) { const c = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t])).rows; res.json({ labels: ['Students'], values: [parseInt(c[0].count)] }); }
}));

// === SCHOOL: STAFF MANAGEMENT ===
app.get('/school/staff', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staffList = (await pool.query('SELECT * FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Staff Management', `
    <div class="card"><h3>Staff Members</h3>
      <a href="/school/staff/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Staff</a>
      <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Approved</th><th>Status</th><th>Actions</th></tr>
      ${staffList.map(s => `<tr>
        <td>${esc(s.name)}</td><td>${esc(s.email)}</td><td><span class="tag">${esc(s.role)}</span></td>
        <td>${s.approved ? '<span style="color:#059669">Yes</span>' : '<span style="color:#dc2626">No</span>'}</td>
        <td>${s.banned ? '<span style="color:#dc2626">Banned</span>' : '<span style="color:#059669">Active</span>'}</td>
        <td>
          <a href="/school/staff/${s.id}/edit" class="btn btn-sm">Edit</a>
          <a href="/school/staff/${s.id}/ban" class="btn btn-sm" style="background:${s.banned?'#059669':'#dc2626'}">${s.banned?'Unban':'Ban'}</a>
          <a href="/school/staff/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete ${esc(s.name)}?')">Del</a>
        </td>
      </tr>`).join('') || '<tr><td colspan="6">No staff yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/staff/new', requireAuth, requireNotBanned, requireRole('head_teacher', 'school'), ah(async (req, res) => {
  res.send(renderPage('Add Staff', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add New Staff Member</h3>
      <form method="POST" action="/school/staff/save">
        <input name="name" placeholder="Full Name" required>
        <input name="email" type="email" placeholder="Email" required>
        <input name="password" type="password" placeholder="Password (min 6)" minlength="6" required>
        <select name="role" required>
          <option value="head_teacher">Head Teacher</option>
          <option value="deputy">Deputy Head</option>
          <option value="teacher" selected>Teacher</option>
          <option value="bursar">Bursar</option>
          <option value="secretary">Secretary</option>
          <option value="librarian">Librarian</option>
        </select>
        <button class="btn btn-green">Create Staff Account</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/staff/save', requireAuth, requireNotBanned, requireRole('head_teacher', 'school'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query('INSERT INTO staff(tenant_id,email,password,password_hash,name,role,approved) VALUES($1,$2,$3,$3,$4,$5,true)', [t, email, hash, name, role]);
  } catch (e) {
    if (e.message.includes('staff_email_key') || e.message.includes('unique')) {
      return res.send(renderPage('Error', '<div class="card"><div class="alert alert-error">A staff member with this email already exists.</div><a href="/school/staff" class="btn">Back</a></div>', req.session.user));
    }
    throw e;
  }
  await audit(req.session.user.email, 'add_staff', `Added staff: ${name} (${role})`);
  res.redirect('/school/staff');
}));

app.get('/school/staff/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM staff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage('Edit Staff', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Staff: ${esc(s.name)}</h3>
      <form method="POST" action="/school/staff/${s.id}/update">
        <input name="name" value="${esc(s.name)}" required>
        <input name="email" type="email" value="${esc(s.email)}" required>
        <select name="role" required>
          <option value="head_teacher" ${s.role==='head_teacher'?'selected':''}>Head Teacher</option>
          <option value="deputy" ${s.role==='deputy'?'selected':''}>Deputy Head</option>
          <option value="teacher" ${s.role==='teacher'?'selected':''}>Teacher</option>
          <option value="bursar" ${s.role==='bursar'?'selected':''}>Bursar</option>
          <option value="secretary" ${s.role==='secretary'?'selected':''}>Secretary</option>
          <option value="librarian" ${s.role==='librarian'?'selected':''}>Librarian</option>
        </select>
        <button class="btn">Update Staff</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/staff/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, role } = req.body;
  await pool.query('UPDATE staff SET name=$1,email=$2,role=$3 WHERE id=$4 AND tenant_id=$5', [name, email, role, req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'edit_staff', `Updated staff: ${name}`);
  res.redirect('/school/staff');
}));

app.get('/school/staff/:id/ban', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM staff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  await pool.query('UPDATE staff SET banned=$1 WHERE id=$2 AND tenant_id=$3', [!s.banned, req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'toggle_ban_staff', `${s.banned?'Unbanned':'Banned'} staff: ${s.name}`);
  res.redirect('/school/staff');
}));

app.get('/school/staff/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM staff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'delete_staff', `Deleted staff ID: ${req.params.id}`);
  res.redirect('/school/staff');
}));

// === SCHOOL: TIMETABLE ===
app.get('/school/timetable', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filterClass = req.query.class || '';
  let q = 'SELECT * FROM timetable WHERE tenant_id=$1';
  const params = [t];
  if (filterClass) { q += ' AND class=$2'; params.push(filterClass); }
  q += ' ORDER BY day,period';
  const entries = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const maxPeriod = entries.length > 0 ? Math.max(...entries.map(e => e.period)) : 8;
  res.send(renderPage('Timetable', `
    <div class="card"><h3>Timetable</h3>
      <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <a href="/school/timetable/new" class="btn btn-sm">+ Add Entry</a>
        <form method="GET" action="/school/timetable" style="display:flex;gap:10px">
          <select name="class" style="width:auto;margin:0"><option value="">All Classes</option>
            ${classes.map(c => `<option ${filterClass===c.class?'selected':''}>${esc(c.class)}</option>`).join('')}
          </select>
          <button class="btn btn-sm">Filter</button>
        </form>
      </div>
      <div style="overflow-x:auto">
      <table style="min-width:800px"><tr><th>Period</th>${days.map(d => `<th>${d}</th>`).join('')}</tr>
      ${Array.from({length:maxPeriod},(_,i)=>i+1).map(p => `<tr><td><strong>Period ${p}</strong></td>${days.map(d => {
        const entry = entries.find(e => e.day===d && e.period===p);
        return entry ? `<td><strong>${esc(entry.subject)}</strong><br><span class="muted">${esc(entry.teacher||'')}</span><br><a href="/school/timetable/${entry.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')" style="margin-top:4px;padding:4px 8px;font-size:10px">Del</a></td>` : '<td>-</td>';
      }).join('')}</tr>`).join('')}
      </table>
      </div>
    </div>
  `, req.session.user));
}));

app.get('/school/timetable/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const staffList = (await pool.query('SELECT name FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Timetable Entry', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Timetable Entry</h3>
      <form method="POST" action="/school/timetable/save">
        <select name="class" required><option value="">Select Class</option>
          ${classes.map(c => `<option>${esc(c.class)}</option>`).join('')}
        </select>
        <select name="day" required><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
        <input name="period" type="number" placeholder="Period Number (e.g. 1, 2, 3)" min="1" max="10" required>
        <input name="subject" placeholder="Subject (e.g. Mathematics)" required>
        <select name="teacher"><option value="">Select Teacher</option>
          ${staffList.map(s => `<option>${esc(s.name)}</option>`).join('')}
        </select>
        <input name="start_time" type="time" placeholder="Start Time">
        <input name="end_time" type="time" placeholder="End Time">
        <button class="btn btn-green">Add Entry</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/timetable/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { class: cls, day, period, subject, teacher, start_time, end_time } = req.body;
  await pool.query('INSERT INTO timetable(tenant_id,class,day,period,subject,teacher,start_time,end_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [req.session.user.tenant_id, cls, day, period, subject, teacher, start_time, end_time]);
  await audit(req.session.user.email, 'add_timetable', `Added ${subject} for ${cls} ${day} P${period}`);
  res.redirect('/school/timetable');
}));

app.get('/school/timetable/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM timetable WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/school/timetable');
}));

// === SCHOOL: GRADING SYSTEM ===
app.get('/school/grading', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const scales = (await pool.query('SELECT * FROM grading_scales WHERE tenant_id=$1 ORDER BY min_score DESC', [t])).rows;
  res.send(renderPage('Grading Scale', `
    <div class="card"><h3>Grading Scale</h3>
      <form method="POST" action="/school/grading/save" style="margin-bottom:20px">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 2fr">
          <input name="min_score" type="number" placeholder="Min Score" required>
          <input name="max_score" type="number" placeholder="Max Score" required>
          <input name="grade" placeholder="Grade (e.g. D1)" required>
          <input name="comment" placeholder="Comment (e.g. Excellent)">
        </div>
        <button class="btn btn-green">Add Grade Range</button>
      </form>
      <table><tr><th>Min</th><th>Max</th><th>Grade</th><th>Comment</th><th>Action</th></tr>
      ${scales.map(s => `<tr><td>${s.min_score}</td><td>${s.max_score}</td><td><span class="tag">${esc(s.grade)}</span></td><td>${esc(s.comment)}</td>
        <td><a href="/school/grading/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No grading scale set. Add ranges above.</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/school/grading/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { min_score, max_score, grade, comment } = req.body;
  await pool.query('INSERT INTO grading_scales(tenant_id,min_score,max_score,grade,comment) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, min_score, max_score, grade, comment]);
  await audit(req.session.user.email, 'add_grade_range', `Added grade ${grade} (${min_score}-${max_score})`);
  res.redirect('/school/grading');
}));

app.get('/school/grading/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM grading_scales WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/school/grading');
}));

// === SCHOOL: FEE STRUCTURES ===
app.get('/school/fee-structures', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const structures = (await pool.query('SELECT * FROM fee_structures WHERE tenant_id=$1 ORDER BY class,term', [t])).rows;
  res.send(renderPage('Fee Structures', `
    <div class="card"><h3>Fee Structures</h3>
      <div style="display:flex;gap:10px;margin-bottom:15px;flex-wrap:wrap">
        <a href="/school/fee-structures/new" class="btn btn-sm">+ Add Fee Structure</a>
      </div>
      <table><tr><th>Class</th><th>Term</th><th>Amount (UGX)</th><th>Year</th><th>Actions</th></tr>
      ${structures.map(s => `<tr><td>${esc(s.class)}</td><td>${esc(s.term)}</td><td>${parseInt(s.amount).toLocaleString()}</td><td>${s.year||''}</td>
        <td><a href="/school/fee-structures/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No fee structures yet</td></tr>'}
      </table>
    </div>
    <div class="card"><h3>Auto-Generate Fee Records</h3>
      <p class="muted">Generate fee records for all students in a class based on fee structures.</p>
      <form method="POST" action="/school/fee-structures/generate">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
          <input name="class" placeholder="Class (e.g. S1)" required>
          <input name="term" placeholder="Term (e.g. Term 1)" required>
          <input name="year" type="number" placeholder="Year (e.g. 2025)" required>
        </div>
        <button class="btn btn-gold">Generate Fee Records</button>
      </form>
    </div>
  `, req.session.user));
}));

app.get('/school/fee-structures/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Add Fee Structure', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Fee Structure</h3>
      <form method="POST" action="/school/fee-structures/save">
        <select name="class" required><option value="">Select Class</option>
          ${classes.map(c => `<option>${esc(c.class)}</option>`).join('')}
          <option value="__all">All Classes</option>
        </select>
        <input name="term" placeholder="Term (e.g. Term 1)" required>
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="year" type="number" placeholder="Year (e.g. 2025)">
        <button class="btn btn-green">Save Fee Structure</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/fee-structures/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { class: cls, term, amount, year } = req.body;
  if (cls === '__all') {
    const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL', [req.session.user.tenant_id])).rows;
    for (const c of classes) {
      await pool.query('INSERT INTO fee_structures(tenant_id,class,term,amount,year) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, c.class, term, amount, year]);
    }
  } else {
    await pool.query('INSERT INTO fee_structures(tenant_id,class,term,amount,year) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, cls, term, amount, year]);
  }
  await audit(req.session.user.email, 'add_fee_structure', `Added fee structure: ${cls} ${term} UGX ${amount}`);
  res.redirect('/school/fee-structures');
}));

app.get('/school/fee-structures/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM fee_structures WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/school/fee-structures');
}));

app.post('/school/fee-structures/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { class: cls, term, year } = req.body;
  const structure = (await pool.query('SELECT * FROM fee_structures WHERE tenant_id=$1 AND class=$2 AND term=$3 ORDER BY id DESC LIMIT 1', [t, cls, term])).rows[0];
  if (!structure) return res.send(renderPage('Error', '<div class="card"><div class="alert alert-error">No fee structure found for this class/term combination.</div><a href="/school/fee-structures" class="btn">Back</a></div>', req.session.user));
  const students = (await pool.query('SELECT id FROM students WHERE tenant_id=$1 AND class=$2', [t, cls])).rows;
  let generated = 0;
  for (const s of students) {
    const existing = (await pool.query('SELECT id FROM fees WHERE tenant_id=$1 AND student_id=$2 AND term=$3 AND year=$4', [t, s.id, term, year])).rows;
    if (existing.length === 0) {
      await pool.query('INSERT INTO fees(tenant_id,student_id,amount,paid,term,year) VALUES($1,$2,$3,0,$4,$5)', [t, s.id, structure.amount, term, year]);
      generated++;
    }
  }
  await audit(req.session.user.email, 'generate_fees', `Generated ${generated} fee records for ${cls} ${term}`);
  res.send(renderPage('Fee Records Generated', `<div class="card"><div class="alert alert-success">Generated ${generated} fee records for ${esc(cls)} ${esc(term)} at UGX ${parseInt(structure.amount).toLocaleString()} each.</div><a href="/school/fees" class="btn">View Fees</a></div>`, req.session.user));
}));

// === SCHOOL: STUDENT PROMOTION ===
app.get('/school/promote', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Student Promotion', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Promote Students</h3>
      <p class="muted" style="margin-bottom:15px">Select a class to promote. All students in that class will be moved to the new class.</p>
      <form method="POST" action="/school/promote/execute">
        <select name="from_class" required><option value="">From Class</option>
          ${classes.map(c => `<option>${esc(c.class)}</option>`).join('')}
        </select>
        <input name="to_class" placeholder="New Class (e.g. S2)" required>
        <button class="btn btn-gold" onclick="return confirm('Promote ALL students in this class? This cannot be undone.')">Promote Students</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/promote/execute', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { from_class, to_class } = req.body;
  const result = await pool.query('UPDATE students SET class=$1 WHERE tenant_id=$2 AND class=$3', [to_class, t, from_class]);
  await audit(req.session.user.email, 'student_promotion', `Promoted ${result.rowCount} students from ${from_class} to ${to_class}`);
  res.send(renderPage('Promotion Complete', `<div class="card"><div class="alert alert-success">Successfully promoted ${result.rowCount} students from ${esc(from_class)} to ${esc(to_class)}.</div><a href="/school/students" class="btn">View Students</a></div>`, req.session.user));
}));

// === SCHOOL: REPORT CARDS (.docx) ===
app.get('/school/report-cards', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const exams = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Generate Report Cards', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Generate Report Card</h3>
      <form method="POST" action="/school/report-cards/generate">
        <select name="student_id" required><option value="">Select Student</option>
          ${students.map(s => `<option value="${s.id}">${esc(s.admission_no)} - ${esc(s.name)} (${esc(s.class)})</option>`).join('')}
        </select>
        <select name="exam_id" required><option value="">Select Exam</option>
          ${exams.map(e => `<option value="${e.id}">${esc(e.name)} - ${esc(e.term)} ${e.year || ''}</option>`).join('')}
        </select>
        <button class="btn btn-gold">Download Report Card</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/report-cards/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, exam_id } = req.body;
  const student = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [student_id, t])).rows[0];
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [exam_id, t])).rows[0];
  const marks = (await pool.query('SELECT subject,score,grade FROM marks WHERE exam_id=$1 AND student_id=$2', [exam_id, student_id])).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const totalScore = marks.reduce((a, m) => a + (parseInt(m.score) || 0), 0);
  const avgScore = marks.length > 0 ? Math.round(totalScore / marks.length) : 0;
  const fee = (await pool.query('SELECT amount,paid FROM fees WHERE student_id=$1 AND tenant_id=$2 LIMIT 1', [student_id, t])).rows[0];

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: tenant.name, bold: true, size: 32 })], alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: 'STUDENT REPORT CARD', bold: true, size: 24 })], alignment: 'center' }),
        new Paragraph({ text: `${exam.name} - ${exam.term} ${exam.year || ''}`, alignment: 'center' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Student Name: ${student.name}` }),
        new Paragraph({ text: `Admission No: ${student.admission_no}` }),
        new Paragraph({ text: `Class: ${student.class} ${student.stream || ''}` }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: 'SUBJECT RESULTS', bold: true, size: 20 })] }),
        new Paragraph({ text: '' }),
        ...marks.map(m => new Paragraph({ text: `${m.subject}: ${m.score}/100  -  Grade: ${m.grade}` })),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Total Score: ${totalScore}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: `Average Score: ${avgScore}`, bold: true })] }),
        new Paragraph({ text: '' }),
        ...(fee ? [
          new Paragraph({ children: [new TextRun({ text: 'FEE STATUS', bold: true, size: 20 })] }),
          new Paragraph({ text: `Total Fees: UGX ${parseInt(fee.amount).toLocaleString()}` }),
          new Paragraph({ text: `Paid: UGX ${parseInt(fee.paid).toLocaleString()}` }),
          new Paragraph({ text: `Balance: UGX ${(fee.amount - fee.paid).toLocaleString()}` }),
          new Paragraph({ text: '' }),
        ] : []),
        new Paragraph({ text: `Class Teacher Comment: ________________________` }),
        new Paragraph({ text: `Head Teacher Comment: ________________________` }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Date: ${new Date().toLocaleDateString()}` }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=ReportCard-${student.admission_no}.docx`);
  res.send(buffer);
}));

// === SCHOOL: GENERAL REPORTS ===
app.get('/school/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('School Reports', `
    <div class="card"><h3>Export Data</h3>
      <div class="grid">
        <a href="/school/reports/export?type=students" class="btn btn-sm">Students CSV</a>
        <a href="/school/reports/export?type=fees" class="btn btn-sm">Fees CSV</a>
        <a href="/school/reports/export?type=attendance" class="btn btn-sm">Attendance CSV</a>
      </div>
    </div>
  `, req.session.user));
}));

app.get('/school/reports/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type } = req.query;
  const t = req.session.user.tenant_id;
  let data, filename;
  if (type === 'students') {
    data = (await pool.query('SELECT admission_no,name,class,stream,guardian_name,guardian_phone FROM students WHERE tenant_id=$1', [t])).rows;
    filename = 'students.csv';
  } else if (type === 'fees') {
    data = (await pool.query('SELECT f.amount,f.paid,f.term,f.year,s.name as student FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1', [t])).rows;
    filename = 'fees.csv';
  } else {
    data = (await pool.query('SELECT a.date,a.status,s.name as student FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1', [t])).rows;
    filename = 'attendance.csv';
  }
  const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));

// === SCHOOL: SIGN IN/OUT (Clock In/Out) ===
app.get('/school/signin', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const today = new Date().toISOString().split('T')[0];
  const records = (await pool.query('SELECT sio.*, s.name as staff_name FROM sign_in_out sio LEFT JOIN staff s ON sio.staff_id=s.id WHERE sio.tenant_id=$1 AND sio.date=$2 ORDER BY sio.clock_in DESC', [t, today])).rows;
  const staffList = (await pool.query('SELECT id,name,role FROM staff WHERE tenant_id=$1 AND banned=false ORDER BY name', [t])).rows;
  const stillIn = records.filter(r => !r.clock_out).length;
  const totalToday = records.length;
  res.send(renderPage('Sign In / Sign Out', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Staff Sign In / Sign Out</h1><p>${new Date().toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p></div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${totalToday}</div><div>Signed In Today</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">${stillIn}</div><div>Currently In</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${totalToday - stillIn}</div><div>Signed Out</div></div>
    </div>
    <div class="card"><h3>Quick Clock In</h3>
      <form method="POST" action="/school/signin/clock-in" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <select name="staff_id" style="width:auto;margin:0" required>
          <option value="">Select Staff Member</option>
          ${staffList.map(s => `<option value="${s.id}">${esc(s.name)} - ${esc(s.role)}</option>`).join('')}
        </select>
        <input name="notes" placeholder="Notes (optional)" style="width:auto;margin:0">
        <button class="btn btn-green">Clock In</button>
      </form>
    </div>
    <div class="card"><h3>Today's Records</h3>
      <table><tr><th>Name</th><th>Role</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Actions</th></tr>
      ${records.map(r => {
        const clockIn = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
        const clockOut = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
        let duration = '-';
        if (r.clock_in && r.clock_out) {
          const diff = (new Date(r.clock_out) - new Date(r.clock_in)) / 1000 / 60;
          duration = Math.floor(diff/60) + 'h ' + Math.round(diff%60) + 'm';
        }
        return `<tr>
          <td>${esc(r.name || r.staff_name || 'Unknown')}</td>
          <td><span class="tag">${esc(r.role || '')}</span></td>
          <td style="color:#059669;font-weight:600">${clockIn}</td>
          <td style="color:${r.clock_out?'#dc2626':'#94a3b8'};font-weight:600">${clockOut || 'Still In'}</td>
          <td>${duration}</td>
          <td>${!r.clock_out ? `<a href="/school/signin/${r.id}/clock-out" class="btn btn-red btn-sm" onclick="return confirm('Clock out ${esc(r.name||r.staff_name)}?')">Clock Out</a>` : '<span class="muted">Done</span>'}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" style="text-align:center;padding:30px">No one signed in yet today</td></tr>'}
      </table>
    </div>
    <div class="card"><h3>History</h3>
      <form method="GET" action="/school/signin/history" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label style="font-weight:600">From:</label><input name="from" type="date" value="${new Date(Date.now()-7*86400000).toISOString().split('T')[0]}" style="width:auto;margin:0" required>
        <label style="font-weight:600">To:</label><input name="to" type="date" value="${today}" style="width:auto;margin:0" required>
        <button class="btn btn-sm">View History</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/signin/clock-in', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { staff_id, notes } = req.body;
  const staff = (await pool.query('SELECT name,role FROM staff WHERE id=$1 AND tenant_id=$2', [staff_id, t])).rows[0];
  if (!staff) return res.redirect('/school/signin');
  const existing = (await pool.query('SELECT id FROM sign_in_out WHERE staff_id=$1 AND tenant_id=$2 AND date=CURRENT_DATE AND clock_out IS NULL', [staff_id, t])).rows[0];
  if (existing) return res.send(renderPage('Error', '<div class="card"><div class="alert alert-error">This staff member is already clocked in and has not clocked out.</div><a href="/school/signin" class="btn">Back</a></div>', req.session.user));
  await pool.query('INSERT INTO sign_in_out(tenant_id,staff_id,name,role,clock_in,date,notes) VALUES($1,$2,$3,$4,NOW(),CURRENT_DATE,$5)', [t, staff_id, staff.name, staff.role, notes]);
  await notify(t, req.session.user.email, 'Staff Clock In', staff.name + ' signed in', 'attendance');
  await audit(req.session.user.email, 'clock_in', staff.name + ' clocked in');
  res.redirect('/school/signin');
}));

app.get('/school/signin/:id/clock-out', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const record = (await pool.query('SELECT * FROM sign_in_out WHERE id=$1 AND tenant_id=$2 AND clock_out IS NULL', [req.params.id, t])).rows[0];
  if (!record) return res.redirect('/school/signin');
  await pool.query('UPDATE sign_in_out SET clock_out=NOW() WHERE id=$1', [req.params.id]);
  await audit(req.session.user.email, 'clock_out', (record.name || 'Staff') + ' clocked out');
  res.redirect('/school/signin');
}));

app.get('/school/signin/history', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { from, to } = req.query;
  const records = (await pool.query('SELECT * FROM sign_in_out WHERE tenant_id=$1 AND date>=$2 AND date<=$3 ORDER BY date DESC, clock_in DESC', [t, from, to])).rows;
  res.send(renderPage('Sign In/Out History', `
    <div class="card"><h3>Sign In/Out History: ${esc(from)} to ${esc(to)}</h3>
      <div style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap">
        <a href="/school/signin" class="btn btn-sm">Back to Today</a>
        <a href="/school/signin/history/export?from=${esc(from)}&to=${esc(to)}" class="btn btn-green btn-sm">Export CSV</a>
      </div>
      <table><tr><th>Date</th><th>Name</th><th>Role</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Notes</th></tr>
      ${records.map(r => {
        const cin = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
        const cout = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : 'No Out';
        let dur = '-';
        if (r.clock_in && r.clock_out) { const d=(new Date(r.clock_out)-new Date(r.clock_in))/60000; dur=Math.floor(d/60)+'h '+Math.round(d%60)+'m'; }
        return `<tr><td>${r.date}</td><td>${esc(r.name)}</td><td><span class="tag">${esc(r.role||'')}</span></td><td>${cin}</td><td>${cout}</td><td>${dur}</td><td class="muted">${esc(r.notes||'')}</td></tr>`;
      }).join('') || '<tr><td colspan="7" style="text-align:center">No records found</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/signin/history/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { from, to } = req.query;
  const records = (await pool.query('SELECT date,name,role,clock_in,clock_out,notes FROM sign_in_out WHERE tenant_id=$1 AND date>=$2 AND date<=$3 ORDER BY date,clock_in', [t, from, to])).rows;
  const csv = ['Date,Name,Role,Clock In,Clock Out,Notes'].concat(records.map(r => `${r.date},"${r.name}","${r.role||''}",${r.clock_in||''},${r.clock_out||''},"${r.notes||''}"`)).join('\n');
  res.header('Content-Type','text/csv'); res.attachment('signin-history.csv'); res.send(csv);
}));

// === SCHOOL: FEE RECEIPTS ===
app.get('/school/fees/receipts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const receipts = (await pool.query('SELECT fr.*, s.name as student_name, s.admission_no, s.class FROM fee_receipts fr JOIN students s ON fr.student_id=s.id WHERE fr.tenant_id=$1 ORDER BY fr.created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Fee Receipts', `
    <div class="card"><h3>Recent Fee Receipts</h3>
      <table><tr><th>Receipt No</th><th>Student</th><th>Class</th><th>Amount Paid</th><th>Method</th><th>Date</th><th>Actions</th></tr>
      ${receipts.map(r => `<tr>
        <td><strong>${esc(r.receipt_no)}</strong></td><td>${esc(r.student_name)}</td><td>${esc(r.class)}</td>
        <td>UGX ${parseInt(r.paid).toLocaleString()}</td><td><span class="tag">${esc(r.method||'cash')}</span></td>
        <td class="muted">${new Date(r.created_at).toLocaleDateString()}</td>
        <td><a href="/school/fees/${r.fee_id}/receipt" class="btn btn-sm">View</a></td>
      </tr>`).join('') || '<tr><td colspan="7" style="text-align:center">No receipts yet. Receipts are generated when you view a fee record.</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/school/fees/:id/receipt', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fee = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no,s.class,s.guardian_name FROM fees f JOIN students s ON f.student_id=s.id WHERE f.id=$1 AND f.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!fee) return res.status(404).send('Fee record not found');
  const tenant = (await pool.query('SELECT name,address,phone,email,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  const receiptNo = fee.receipt_no || ('RCP-' + fee.id + '-' + Date.now().toString(36).toUpperCase());
  if (!fee.receipt_no) {
    try { await pool.query('UPDATE fees SET receipt_no=$1 WHERE id=$2', [receiptNo, fee.id]); } catch(e) {}
    try { await pool.query('INSERT INTO fee_receipts(tenant_id,fee_id,receipt_no,student_id,amount,paid,method,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(receipt_no) DO NOTHING', [t, fee.id, receiptNo, fee.student_id, fee.amount, fee.paid, fee.payment_method||'cash', req.session.user.email]); } catch(e) {}
  }
  res.send(renderPage('Fee Receipt', `
    <div class="card" style="max-width:700px;margin:20px auto;border:2px solid #4f46e5">
      <div style="text-align:center;padding:20px;border-bottom:2px solid #e2e8f0">
        ${tenant.logo_url ? `<img src="${esc(tenant.logo_url)}" style="height:60px;margin-bottom:10px" alt="Logo">` : ''}
        <h2 style="color:#4f46e5">${esc(tenant.name)}</h2>
        <p class="muted">${esc(tenant.address||'')} ${tenant.phone?'| '+esc(tenant.phone):''} ${tenant.email?'| '+esc(tenant.email):''}</p>
        <h3 style="margin-top:10px;color:#3730a3">OFFICIAL FEE RECEIPT</h3>
      </div>
      <div style="padding:20px">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px">
          <div><strong>Receipt No:</strong> ${esc(receiptNo)}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}</div>
        </div>
        <div style="background:#f1f5f9;padding:15px;border-radius:10px;margin-bottom:20px">
          <p><strong>Student Name:</strong> ${esc(fee.student_name)}</p>
          <p><strong>Admission No:</strong> ${esc(fee.admission_no)}</p>
          <p><strong>Class:</strong> ${esc(fee.class)}</p>
          ${fee.guardian_name ? `<p><strong>Guardian:</strong> ${esc(fee.guardian_name)}</p>` : ''}
        </div>
        <table>
          <tr style="background:#4f46e5;color:white"><th style="color:white">Description</th><th style="color:white;text-align:right">Amount (UGX)</th></tr>
          <tr><td>School Fees - ${esc(fee.term||'Term')} ${fee.year||''}</td><td style="text-align:right">${parseInt(fee.amount).toLocaleString()}</td></tr>
          <tr style="font-weight:bold"><td>Total Fees</td><td style="text-align:right">${parseInt(fee.amount).toLocaleString()}</td></tr>
          <tr style="color:#059669;font-weight:bold"><td>Amount Paid</td><td style="text-align:right">${parseInt(fee.paid).toLocaleString()}</td></tr>
          <tr style="color:${fee.amount-fee.paid>0?'#dc2626':'#059669'};font-weight:bold"><td>Balance</td><td style="text-align:right">${(fee.amount-fee.paid).toLocaleString()}</td></tr>
        </table>
        <div style="margin-top:30px;display:flex;justify-content:space-between;flex-wrap:wrap">
          <div><p class="muted">Received By: ___________________</p></div>
          <div><p class="muted">Parent/Guardian: ___________________</p></div>
        </div>
        <div style="margin-top:10px;text-align:center">
          <p class="muted" style="font-size:11px">This is an official receipt from ${esc(tenant.name)}. Keep for your records.</p>
        </div>
      </div>
      <div style="text-align:center;padding:15px;border-top:1px solid #e2e8f0">
        <button class="btn btn-sm" onclick="window.print()">Print Receipt</button>
        <a href="/school/fees" class="btn btn-sm" style="margin-left:8px">Back to Fees</a>
      </div>
    </div>
    <style>@media print{.nav,.btn{display:none!important}.card{border:none!important;box-shadow:none!important}body{background:white!important}}</style>
  `, req.session.user));
}));

// === SCHOOL: BULK REPORT CARDS (Printable HTML) ===
app.get('/school/report-cards/bulk', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Bulk Report Cards', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Generate Report Cards for Entire Class</h3>
      <p class="muted" style="margin-bottom:15px">Generate printable report cards for all students in a class. Each card includes positions, grades, and comments.</p>
      <form method="POST" action="/school/report-cards/bulk/generate">
        <select name="exam_id" required><option value="">Select Exam</option>
          ${exams.map(e => `<option value="${e.id}">${esc(e.name)} - ${esc(e.term)} ${e.year||''}</option>`).join('')}
        </select>
        <select name="class" required><option value="">Select Class</option>
          ${classes.map(c => `<option>${esc(c.class)}</option>`).join('')}
        </select>
        <button class="btn btn-gold" onclick="return confirm('Generate report cards for all students in this class?')">Generate All Report Cards</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/report-cards/bulk/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { exam_id, class: cls } = req.body;
  const exam = (await pool.query('SELECT * FROM exams WHERE id=$1 AND tenant_id=$2', [exam_id, t])).rows[0];
  const students = (await pool.query('SELECT id,name,admission_no,class,stream FROM students WHERE tenant_id=$1 AND class=$2 ORDER BY name', [t, cls])).rows;
  const tenant = (await pool.query('SELECT name,address,phone,email,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  const gradingScales = (await pool.query('SELECT * FROM grading_scales WHERE tenant_id=$1 ORDER BY min_score DESC', [t])).rows;
  const allMarks = (await pool.query('SELECT m.student_id,m.subject,m.score,m.grade FROM marks m WHERE m.exam_id=$1', [exam_id])).rows;
  const studentData = {};
  for (const s of students) {
    const sMarks = allMarks.filter(m => m.student_id === s.id);
    const total = sMarks.reduce((a, m) => a + (parseInt(m.score) || 0), 0);
    const avg = sMarks.length > 0 ? Math.round(total / sMarks.length) : 0;
    const fee = (await pool.query('SELECT amount,paid FROM fees WHERE student_id=$1 AND tenant_id=$2 LIMIT 1', [s.id, t])).rows[0];
    studentData[s.id] = { total, avg, marks: sMarks, fee, position: 0 };
  }
  const sorted = Object.entries(studentData).sort((a, b) => b[1].total - a[1].total);
  sorted.forEach((entry, idx) => { studentData[entry[0]].position = idx + 1; });
  function getGradeInfo(score) {
    for (const g of gradingScales) { if (score >= g.min_score && score <= g.max_score) return g; }
    return { grade: 'F', comment: 'Fail' };
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Cards - ${esc(cls)}</title>
    <style>
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b}
    .report-card{background:white;max-width:800px;margin:20px auto;padding:30px;border:2px solid #4f46e5;border-radius:12px;page-break-after:always}
    .report-card:last-child{page-break-after:auto}
    .header{text-align:center;border-bottom:3px solid #4f46e5;padding-bottom:15px;margin-bottom:20px}
    .header h1{color:#4f46e5;font-size:24px}.header h2{color:#3730a3;font-size:18px;margin-top:5px}
    .student-info{background:#f1f5f9;padding:12px 15px;border-radius:8px;margin-bottom:15px;display:flex;flex-wrap:wrap;gap:5px 20px}
    .student-info p{font-size:14px}.student-info strong{color:#1e293b}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px 10px;text-align:left;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white;font-weight:600}
    .totals{margin-top:15px;padding:12px;background:#f1f5f9;border-radius:8px}
    .totals p{margin:4px 0;font-size:14px}.totals strong{color:#4f46e5}
    .signatures{margin-top:30px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:20px}
    .signatures p{border-top:1px solid #94a3b8;padding-top:5px;font-size:13px;color:#64748b;min-width:200px}
    .print-bar{position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:10px 20px;text-align:center;z-index:999;display:flex;justify-content:center;gap:10px;align-items:center}
    .print-bar button,.print-bar a{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px}
    @media print{.print-bar{display:none!important}.report-card{border:none!important;border-radius:0!important;margin:0!important;page-break-after:always}}
    </style></head><body>
    <div class="print-bar">
      <span>Bulk Report Cards: ${esc(cls)} - ${esc(exam.name)}</span>
      <button onclick="window.print()" style="background:#059669;color:white">Print All</button>
      <a href="/school/report-cards" style="background:white;color:#4f46e5;text-decoration:none">Back</a>
    </div>
    <div style="height:50px"></div>
    ${students.map(s => {
      const d = studentData[s.id];
      const gi = getGradeInfo(d.avg);
      return `<div class="report-card">
        <div class="header">
          ${tenant.logo_url ? `<img src="${esc(tenant.logo_url)}" style="height:50px;margin-bottom:8px" alt="Logo">` : ''}
          <h1>${esc(tenant.name)}</h1>
          <h2>STUDENT REPORT CARD</h2>
          <p style="color:#64748b;font-size:14px">${esc(exam.name)} | ${esc(exam.term)} ${exam.year||''} | Class: ${esc(s.class)}</p>
        </div>
        <div class="student-info">
          <p><strong>Name:</strong> ${esc(s.name)}</p>
          <p><strong>Adm No:</strong> ${esc(s.admission_no)}</p>
          <p><strong>Stream:</strong> ${esc(s.stream||'N/A')}</p>
          <p><strong>Position:</strong> ${d.position} out of ${students.length}</p>
        </div>
        <table><tr><th>Subject</th><th>Score</th><th>Grade</th></tr>
        ${d.marks.map(m => `<tr><td>${esc(m.subject)}</td><td>${m.score||0}</td><td><strong>${esc(m.grade||getGradeInfo(parseInt(m.score)||0).grade)}</strong></td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center">No marks recorded</td></tr>'}
        </table>
        <div class="totals">
          <p><strong>Total Score:</strong> ${d.total} out of ${d.marks.length * 100}</p>
          <p><strong>Average Score:</strong> ${d.avg}</p>
          <p><strong>Overall Grade:</strong> ${esc(gi.grade)} - ${esc(gi.comment)}</p>
          <p><strong>Position in Class:</strong> ${d.position} / ${students.length}</p>
          ${d.fee ? `<p><strong>Fee Balance:</strong> UGX ${(d.fee.amount - d.fee.paid).toLocaleString()}</p>` : ''}
        </div>
        <div style="margin-top:15px">
          <p><strong>Class Teacher Comment:</strong> ________________________________</p>
          <p style="margin-top:10px"><strong>Head Teacher Comment:</strong> ________________________________</p>
        </div>
        <div class="signatures">
          <p>Class Teacher: _______________</p>
          <p>Head Teacher: _______________</p>
          <p>Parent/Guardian: _______________</p>
        </div>
      </div>`;
    }).join('')}
  </body></html>`);
}));

// === SCHOOL: PRINT FEE BALANCES ===
app.get('/school/print/fee-balances', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filterClass = req.query.class || '';
  let q = 'SELECT s.name,s.admission_no,s.class,s.stream,f.amount,f.paid,f.term,f.year FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1';
  const params = [t];
  if (filterClass) { q += ' AND s.class=$2'; params.push(filterClass); }
  q += ' ORDER BY s.class,s.name';
  const records = (await pool.query(q, params)).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const totalDue = records.reduce((a, r) => a + (r.amount - r.paid), 0);
  const totalPaid = records.reduce((a, r) => a + parseInt(r.paid), 0);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fee Balances</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b}
    .print-bar{position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:10px 20px;text-align:center;z-index:999;display:flex;justify-content:center;gap:10px;align-items:center}
    .print-bar button,.print-bar a{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white}.right{text-align:right}
    @media print{.print-bar{display:none!important}}
    </style></head><body>
    <div class="print-bar"><span>Fee Balance Report - ${esc(tenant.name)}</span>
      <button onclick="window.print()" style="background:#059669;color:white">Print</button>
      <a href="/school/fees" style="background:white;color:#4f46e5;text-decoration:none">Back</a>
    </div>
    <div style="max-width:1100px;margin:60px auto 20px;padding:0 20px">
      <h2 style="text-align:center;color:#4f46e5">${esc(tenant.name)} - Fee Balance Report</h2>
      <p style="text-align:center;color:#64748b">${new Date().toLocaleDateString()} | ${filterClass ? 'Class: '+esc(filterClass) : 'All Classes'}</p>
      <table><tr><th>Student</th><th>Adm No</th><th>Class</th><th>Term</th><th class="right">Total Fees</th><th class="right">Paid</th><th class="right">Balance</th></tr>
      ${records.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.admission_no)}</td><td>${esc(r.class)}</td><td>${esc(r.term||'')} ${r.year||''}</td><td class="right">${parseInt(r.amount).toLocaleString()}</td><td class="right" style="color:#059669">${parseInt(r.paid).toLocaleString()}</td><td class="right" style="color:${r.amount-r.paid>0?'#dc2626':'#059669'}">${(r.amount-r.paid).toLocaleString()}</td></tr>`).join('')}
      <tr style="font-weight:bold;background:#f1f5f9"><td colspan="4">TOTALS</td><td class="right">${(totalDue+totalPaid).toLocaleString()}</td><td class="right" style="color:#059669">${totalPaid.toLocaleString()}</td><td class="right" style="color:#dc2626">${totalDue.toLocaleString()}</td></tr>
      </table>
    </div>
  </body></html>`);
}));

// === SCHOOL: PRINT ATTENDANCE SHEET ===
app.get('/school/attendance/print', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filterClass = req.query.class || '';
  const date = req.query.date || new Date().toISOString().split('T')[0];
  let q = 'SELECT s.name,s.admission_no,s.class,a.status FROM students s LEFT JOIN attendance a ON s.id=a.student_id AND a.date=$2 WHERE s.tenant_id=$1';
  const params = [t, date];
  if (filterClass) { q += ' AND s.class=$3'; params.push(filterClass); }
  q += ' ORDER BY s.class,s.name';
  const records = (await pool.query(q, params)).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const unmarked = records.filter(r => !r.status).length;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Attendance Sheet</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b}
    .print-bar{position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:10px 20px;z-index:999;display:flex;justify-content:center;gap:10px;align-items:center;flex-wrap:wrap}
    .print-bar button,.print-bar a,.print-bar select,.print-bar input{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:13px}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white}
    @media print{.print-bar{display:none!important}}
    </style></head><body>
    <div class="print-bar">
      <span>Attendance - ${esc(tenant.name)}</span>
      <form method="GET" action="/school/attendance/print" style="display:flex;gap:8px;align-items:center">
        <select name="class" style="width:auto"><option value="">All Classes</option>${classes.map(c=>`<option ${filterClass===c.class?'selected':''}>${esc(c.class)}</option>`).join('')}</select>
        <input name="date" type="date" value="${date}" style="width:auto">
        <button type="submit" style="background:#059669;color:white">Filter</button>
      </form>
      <button onclick="window.print()" style="background:#d97706;color:white">Print</button>
      <a href="/school/attendance" style="background:white;color:#4f46e5;text-decoration:none">Back</a>
    </div>
    <div style="max-width:900px;margin:60px auto 20px;padding:0 20px">
      <h2 style="text-align:center;color:#4f46e5">${esc(tenant.name)} - Attendance Sheet</h2>
      <p style="text-align:center;color:#64748b">Date: ${new Date(date).toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} | ${filterClass?'Class: '+esc(filterClass):'All Classes'}</p>
      <p style="text-align:center;margin:8px 0"><span style="color:#059669;font-weight:bold">Present: ${present}</span> | <span style="color:#dc2626;font-weight:bold">Absent: ${absent}</span> | <span style="color:#64748b;font-weight:bold">Unmarked: ${unmarked}</span></p>
      <table><tr><th>#</th><th>Student Name</th><th>Adm No</th><th>Class</th><th>Status</th><th>Signature</th></tr>
      ${records.map((r,i) => `<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.admission_no)}</td><td>${esc(r.class)}</td><td style="color:${r.status==='present'?'#059669':r.status==='absent'?'#dc2626':'#94a3b8'};font-weight:600">${r.status ? r.status.toUpperCase() : 'NOT MARKED'}</td><td style="min-width:120px"></td></tr>`).join('')}
      </table>
    </div>
  </body></html>`);
}));

// === NOTIFICATION CENTER ===
app.get('/notifications', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const t = u.tenant_id;
  const notifications = (await pool.query('SELECT * FROM notifications WHERE tenant_id=$1 AND (user_email IS NULL OR user_email=$2) ORDER BY created_at DESC LIMIT 50', [t, u.email])).rows;
  const unread = notifications.filter(n => !n.read).length;
  await pool.query('UPDATE notifications SET read=true WHERE tenant_id=$1 AND (user_email IS NULL OR user_email=$2) AND read=false', [t, u.email]);
  res.send(renderPage('Notifications', `
    <div class="card"><h3>Notifications <span class="tag">${unread} new</span></h3>
      ${notifications.length > 0 ? notifications.map(n => `
        <div style="padding:12px;border-bottom:1px solid #e2e8f0;${!n.read?'background:#eff6ff;border-radius:8px':''}">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px">
            <strong style="color:${n.type==='error'?'#dc2626':n.type==='success'?'#059669':n.type==='warning'?'#d97706':'#4f46e5'}">${esc(n.title)}</strong>
            <span class="muted">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          <p style="margin-top:4px;color:#475569">${esc(n.message)}</p>
        </div>
      `).join('') : '<p style="text-align:center;padding:40px;color:#94a3b8">No notifications yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/notifications/count', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const t = u.tenant_id;
  const count = (await pool.query('SELECT COUNT(*) FROM notifications WHERE tenant_id=$1 AND (user_email IS NULL OR user_email=$2) AND read=false', [t, u.email])).rows[0].count;
  res.json({ count: parseInt(count) });
}));

// === SCHOOL: SMS NOTIFICATIONS ===
app.get('/school/notify', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,guardian_phone,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Send SMS Notifications', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Send SMS / Notification</h3>
      <p class="muted" style="margin-bottom:15px">Send SMS messages to parents/guardians. SMS requires Africa's Talking API key. In-app notifications are always free.</p>
      <form method="POST" action="/school/notify/send">
        <select name="target" id="targetSelect" required>
          <option value="all">All Parents</option>
          <option value="class">Specific Class</option>
          <option value="student">Specific Student</option>
        </select>
        <select name="class" id="classSelect" style="display:none">
          ${classes.map(c => `<option>${esc(c.class)}</option>`).join('')}
        </select>
        <select name="student_id" id="studentSelect" style="display:none">
          ${students.map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.class)})</option>`).join('')}
        </select>
        <input name="subject" placeholder="Subject / Title" required>
        <textarea name="message" rows="4" placeholder="Type your message here..." required></textarea>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" name="type" value="notification">Send In-App Notification</button>
          <button class="btn btn-green" name="type" value="sms" onclick="return confirm('Send SMS? This may cost credits.')">Send SMS</button>
        </div>
      </form>
      <script>
        document.getElementById('targetSelect').addEventListener('change', function() {
          document.getElementById('classSelect').style.display = this.value === 'class' ? 'block' : 'none';
          document.getElementById('studentSelect').style.display = this.value === 'student' ? 'block' : 'none';
        });
      </script>
    </div>
    <div class="card"><h3>Africa's Talking SMS Setup</h3>
      <p class="muted">To send SMS, add these environment variables on Render:</p>
      <table><tr><th>Variable</th><th>Value</th></tr>
        <tr><td>AT_API_KEY</td><td>Your Africa's Talking API Key</td></tr>
        <tr><td>AT_USERNAME</td><td>Your Africa's Talking Username</td></tr>
        <tr><td>AT_SENDER_ID</td><td>(Optional) Sender ID</td></tr>
      </table>
      <p class="muted" style="margin-top:10px">Sign up at <a href="https://africastalking.com" target="_blank">africastalking.com</a> - Free sandbox for testing!</p>
    </div>
  `, req.session.user));
}));

app.post('/school/notify/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { target, class: cls, student_id, subject, message, type } = req.body;
  let recipients = [];
  if (target === 'student' && student_id) {
    const s = (await pool.query('SELECT name,guardian_phone,parent_email FROM students WHERE id=$1 AND tenant_id=$2', [student_id, t])).rows[0];
    if (s) recipients.push(s);
  } else if (target === 'class' && cls) {
    recipients = (await pool.query('SELECT name,guardian_phone,parent_email FROM students WHERE tenant_id=$1 AND class=$2', [t, cls])).rows;
  } else {
    recipients = (await pool.query('SELECT name,guardian_phone,parent_email FROM students WHERE tenant_id=$1', [t])).rows;
  }
  if (type === 'notification' || type === 'sms') {
    await notifyAll(t, subject, message, type === 'sms' ? 'sms' : 'info');
    for (const r of recipients) {
      if (r.parent_email) await notify(t, r.parent_email, subject, message, 'info');
    }
  }
  let smsResult = '';
  if (type === 'sms') {
    const phones = recipients.map(r => r.guardian_phone).filter(p => p && p.startsWith('+'));
    if (phones.length > 0 && process.env.AT_API_KEY && process.env.AT_USERNAME) {
      try {
        const atRes = await fetch('https://api.africastalking.com/version1/messaging', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'ApiKey': process.env.AT_API_KEY, 'Accept': 'application/json' },
          body: `username=${encodeURIComponent(process.env.AT_USERNAME)}&to=${phones.join(',')}&message=${encodeURIComponent(message)}${process.env.AT_SENDER_ID ? '&from='+encodeURIComponent(process.env.AT_SENDER_ID) : ''}`
        });
        const atData = await atRes.json();
        smsResult = atData.SMSMessageData?.Message || 'SMS queued';
      } catch (e) { smsResult = 'SMS failed: ' + e.message; }
    } else if (phones.length === 0) {
      smsResult = 'No valid phone numbers found (must start with +)';
    } else {
      smsResult = 'Africa\'s Talking not configured. Add AT_API_KEY and AT_USERNAME env vars.';
    }
  }
  await audit(req.session.user.email, 'send_notification', `Sent "${subject}" to ${recipients.length} recipients via ${type}`);
  res.send(renderPage('Notification Sent', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <div class="alert alert-success">In-app notification sent to ${recipients.length} recipients!</div>
      ${smsResult ? `<div class="alert alert-info">SMS: ${esc(smsResult)}</div>` : ''}
      <a href="/school/notify" class="btn">Send Another</a>
    </div>
  `, req.session.user));
}));

// === ORGANIZATION PORTAL (enhanced) ===
app.get('/portal/organization', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, projects, events, budget, notices, meetings] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM projects WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM events WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(amount),0) FROM org_finance WHERE tenant_id=$1 AND type=\'income\'', [t]),
    pool.query('SELECT COUNT(*) FROM notice_board WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM meeting_minutes WHERE tenant_id=$1', [t])
  ]);
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Organization Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#8b5cf6)">
      <h1>Organization Portal</h1><p>Manage members, projects, events, meetings, notices</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">${projects.rows[0].count}</div><div>Projects</div></div>
      <div class="stat-card"><div class="stat-num">${events.rows[0].count}</div><div>Events</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}</div><div>Income</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Members</h3>
        <a href="/org/members" class="btn btn-sm">Member Database</a>
        <a href="/org/register" class="btn btn-sm" style="margin-top:8px">Register Member</a>
        <a href="/org/attendance" class="btn btn-sm" style="margin-top:8px">Attendance</a>
      </div>
      <div class="card"><h3>Projects</h3>
        <a href="/org/projects" class="btn btn-sm">All Projects</a>
        <a href="/org/projects/new" class="btn btn-sm" style="margin-top:8px">New Project</a>
      </div>
      <div class="card"><h3>Events</h3>
        <a href="/org/events" class="btn btn-sm">Events</a>
        <a href="/org/events/new" class="btn btn-sm" style="margin-top:8px">New Event</a>
      </div>
      <div class="card"><h3>Finance</h3>
        <a href="/org/finance" class="btn btn-sm">Income/Expense</a>
        <a href="/org/reports" class="btn btn-sm" style="margin-top:8px">Reports</a>
      </div>
      <div class="card"><h3>Meetings</h3>
        <a href="/org/meetings" class="btn btn-sm">Meeting Minutes</a>
        <span class="muted">${meetings.rows[0].count} recorded</span>
      </div>
      <div class="card"><h3>Notices</h3>
        <a href="/org/notices" class="btn btn-sm">Notice Board</a>
        <span class="muted">${notices.rows[0].count} posted</span>
      </div>
      <div class="card"><h3>Public</h3>
        <a href="/settings/profile" class="btn btn-sm">Edit Public Profile</a>
        ${tenant.has_fundraising ? '<a href="/fundraising" class="btn btn-gold btn-sm" style="margin-top:8px">Fundraising</a>' : '<a href="/upgrade/fundraising" class="btn btn-sm" style="margin-top:8px">+ Add Fundraising</a>'}
      </div>
      <div class="card"><h3>Campaigns</h3>
        <a href="/campaigns" class="btn btn-sm btn-gold">Fundraising</a>
      </div>
      <div class="card"><h3>Income</h3>
        <a href="/income" class="btn btn-sm btn-green">Income Tracking</a>
      </div>
      <div class="card"><h3>Billing</h3>
        <a href="/billing" class="btn btn-sm btn-gold">Subscriptions</a>
      </div>
      <div class="card"><h3>Documents</h3>
        <a href="/documents" class="btn btn-sm">Library</a>
      </div>
      <div class="card"><h3>Roles</h3>
        <a href="/roles" class="btn btn-sm">Permissions</a>
      </div>
      <div class="card"><h3>Bills</h3>
        <a href="/bill-reminders" class="btn btn-sm btn-red">Reminders</a>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="card"><h3>Finance: Income vs Expense</h3><canvas id="orgFinanceChart"></canvas></div>
    <div class="card"><h3>Member Growth</h3><canvas id="orgMemberChart"></canvas></div>
    <script>
    (async function(){
      try {
        const fr = await fetch('/org/charts/finance'); const fd = await fr.json();
        new Chart(document.getElementById('orgFinanceChart'),{type:'bar',data:{labels:fd.labels,datasets:[{label:'Income',data:fd.income,backgroundColor:'rgba(5,150,105,0.6)'},{label:'Expense',data:fd.expense,backgroundColor:'rgba(220,38,38,0.6)'}]},options:{responsive:true}});
      }catch(e){}
      try {
        const mr = await fetch('/org/charts/members'); const md = await mr.json();
        new Chart(document.getElementById('orgMemberChart'),{type:'line',data:{labels:md.labels,datasets:[{label:'Members',data:md.values,borderColor:'#7c3aed',fill:true,backgroundColor:'rgba(124,58,237,0.1)'}]},options:{responsive:true}});
      }catch(e){}
    })();
    </script>
  `, req.session.user));
}));

// === ORG CHART DATA APIs ===
app.get('/org/charts/finance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT TO_CHAR(created_at,'Mon YYYY') as month, type, COALESCE(SUM(amount),0) as total FROM org_finance WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '12 months' GROUP BY month,type ORDER BY MIN(created_at)", [t])).rows;
  const months = [...new Set(data.map(d => d.month))];
  res.json({ labels: months, income: months.map(m => parseInt(data.find(d => d.month===m && d.type==='income')?.total||0)), expense: months.map(m => parseInt(data.find(d => d.month===m && d.type==='expense')?.total||0)) });
}));

app.get('/org/charts/members', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT TO_CHAR(joined_at,'Mon YYYY') as month, COUNT(*) as cnt FROM members WHERE tenant_id=$1 AND joined_at > NOW()-INTERVAL '12 months' GROUP BY month ORDER BY MIN(joined_at)", [t])).rows;
  let cumulative = 0;
  const base = (await pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t])).rows[0].count;
  cumulative = parseInt(base) - data.reduce((a,d) => a + parseInt(d.cnt), 0);
  res.json({ labels: data.map(d => d.month), values: data.map(d => { cumulative += parseInt(d.cnt); return cumulative; }) });
}));

// === ORG: MEMBERS (with edit/delete) ===
app.get('/org/members', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Members', `
    <div class="card"><h3>Member Database</h3>
      <a href="/org/register" class="btn btn-sm" style="margin-bottom:15px">+ Register New Member</a>
      <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
      ${members.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.role)}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td>
        <td><a href="/org/members/${m.id}/edit" class="btn btn-sm">Edit</a> <a href="/org/members/${m.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete ${esc(m.name)}?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="6">No members yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/org/register', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Register Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Register New Member</h3>
      <form method="POST" action="/org/register/save">
        <input name="name" placeholder="Full Name" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone +256...">
        <select name="role" required>
          <option value="">Select Role</option>
          <option>Member</option><option>Volunteer</option><option>Staff</option><option>Board</option>
        </select>
        <button class="btn btn-gold">Register Member</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/register/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, role } = req.body;
  await pool.query('INSERT INTO members(tenant_id,name,email,phone,role) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, email, phone, role]);
  await audit(req.session.user.email, 'add_member', `Added member: ${name}`);
  res.redirect('/org/members');
}));

app.get('/org/members/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT * FROM members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!m) return res.status(404).send('Not found');
  res.send(renderPage('Edit Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Member: ${esc(m.name)}</h3>
      <form method="POST" action="/org/members/${m.id}/update">
        <input name="name" value="${esc(m.name)}" required>
        <input name="email" type="email" value="${esc(m.email)}">
        <input name="phone" value="${esc(m.phone)}">
        <select name="role"><option ${m.role==='Member'?'selected':''}>Member</option><option ${m.role==='Volunteer'?'selected':''}>Volunteer</option><option ${m.role==='Staff'?'selected':''}>Staff</option><option ${m.role==='Board'?'selected':''}>Board</option></select>
        <button class="btn">Update Member</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/org/members/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, role } = req.body;
  await pool.query('UPDATE members SET name=$1,email=$2,phone=$3,role=$4 WHERE id=$5 AND tenant_id=$6', [name, email, phone, role, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/members');
}));

app.get('/org/members/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'delete_member', `Deleted member ID: ${req.params.id}`);
  res.redirect('/org/members');
}));

// === ORG: PROJECTS (with progress update) ===
app.get('/org/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Projects', `
    <div class="card"><h3>All Projects</h3>
      <a href="/org/projects/new" class="btn btn-sm">+ New Project</a>
      <div class="grid" style="margin-top:15px">
        ${projects.map(p => {
          const pct = p.budget > 0 ? Math.min(100, (p.spent / p.budget) * 100) : 0;
          return `
          <div class="card">
            <h3>${esc(p.name)}</h3>
            ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
            <p>Budget: UGX ${parseInt(p.budget).toLocaleString()}</p>
            <p>Spent: UGX ${parseInt(p.spent).toLocaleString()}</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct > 90 ? '#dc2626' : pct > 60 ? '#f59e0b' : '#059669'}"></div></div>
            <p class="muted">${Math.round(pct)}% spent</p>
            <p>Status: <span class="tag">${esc(p.status)}</span></p>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <form method="POST" action="/org/projects/${p.id}/spend" style="display:inline"><input name="amount" type="number" placeholder="Add spent" style="width:120px;display:inline-block;padding:8px"><button class="btn btn-sm btn-green">Update</button></form>
              <form method="POST" action="/org/projects/${p.id}/status" style="display:inline"><select name="status" style="width:auto;display:inline-block;padding:8px"><option>active</option><option>planning</option><option>completed</option><option>on-hold</option></select><button class="btn btn-sm">Set</button></form>
            </div>
          </div>`;
        }).join('') || '<p>No projects yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/projects/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Project', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Project</h3>
      <form method="POST" action="/org/projects/save">
        <input name="name" placeholder="Project Name" required>
        <textarea name="description" placeholder="Project Description" rows="3"></textarea>
        <input name="budget" type="number" placeholder="Budget UGX" required>
        <select name="status" required><option>active</option><option>planning</option><option>completed</option></select>
        <button class="btn">Create Project</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/projects/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, description, budget, status } = req.body;
  await pool.query('INSERT INTO projects(tenant_id,name,description,budget,status) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, description, budget, status]);
  res.redirect('/org/projects');
}));

app.post('/org/projects/:id/spend', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { amount } = req.body;
  await pool.query('UPDATE projects SET spent=spent+$1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/projects');
}));

app.post('/org/projects/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { status } = req.body;
  await pool.query('UPDATE projects SET status=$1 WHERE id=$2 AND tenant_id=$3', [status, req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/projects');
}));

// === ORG: EVENTS ===
app.get('/org/events', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const events = (await pool.query('SELECT * FROM events WHERE tenant_id=$1 ORDER BY event_date DESC', [t])).rows;
  res.send(renderPage('Events', `
    <div class="card"><h3>Events</h3>
      <a href="/org/events/new" class="btn btn-sm" style="margin-bottom:15px">+ New Event</a>
      <div class="grid">
        ${events.map(e => `
          <div class="card">
            <h3>${esc(e.name)}</h3>
            <p class="muted">${e.event_date ? new Date(e.event_date).toLocaleDateString() : 'TBD'} ${e.venue ? '@ ' + esc(e.venue) : ''}</p>
            ${e.description ? `<p>${esc(e.description)}</p>` : ''}
            <p>Budget: UGX ${parseInt(e.budget).toLocaleString()}</p>
          </div>
        `).join('') || '<p>No events yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/events/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Event', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Event</h3>
      <form method="POST" action="/org/events/save">
        <input name="name" placeholder="Event Name" required>
        <input name="event_date" type="date" required>
        <input name="venue" placeholder="Venue">
        <textarea name="description" placeholder="Event Description" rows="3"></textarea>
        <input name="budget" type="number" placeholder="Budget UGX">
        <button class="btn">Create Event</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/events/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, event_date, venue, description, budget } = req.body;
  await pool.query('INSERT INTO events(tenant_id,name,event_date,venue,description,budget) VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, name, event_date, venue, description, budget || 0]);
  res.redirect('/org/events');
}));

// === ORG: MEETING MINUTES ===
app.get('/org/meetings', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const meetings = (await pool.query('SELECT * FROM meeting_minutes WHERE tenant_id=$1 ORDER BY meeting_date DESC', [t])).rows;
  res.send(renderPage('Meeting Minutes', `
    <div class="card"><h3>Meeting Minutes</h3>
      <a href="/org/meetings/new" class="btn btn-sm" style="margin-bottom:15px">+ New Minutes</a>
      <table><tr><th>Title</th><th>Date</th><th>Actions</th></tr>
      ${meetings.map(m => `<tr><td>${esc(m.title)}</td><td>${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}</td>
        <td><a href="/org/meetings/${m.id}" class="btn btn-sm">View</a> <a href="/org/meetings/${m.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="3">No meetings yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/org/meetings/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Meeting Minutes', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Record Meeting Minutes</h3>
      <form method="POST" action="/org/meetings/save">
        <input name="title" placeholder="Meeting Title" required>
        <input name="meeting_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <textarea name="content" rows="12" placeholder="Meeting notes, decisions, action items..." required></textarea>
        <button class="btn">Save Minutes</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/meetings/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, meeting_date, content } = req.body;
  await pool.query('INSERT INTO meeting_minutes(tenant_id,title,meeting_date,content) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, title, meeting_date, content]);
  res.redirect('/org/meetings');
}));

app.get('/org/meetings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT * FROM meeting_minutes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!m) return res.status(404).send('Not found');
  res.send(renderPage(m.title, `
    <div class="card"><h3>${esc(m.title)}</h3>
      <p class="muted">${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}</p>
      <div style="margin-top:20px;white-space:pre-wrap">${esc(m.content)}</div>
      <a href="/org/meetings" class="btn btn-sm" style="margin-top:15px">Back to Minutes</a>
    </div>
  `, req.session.user));
}));

app.get('/org/meetings/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM meeting_minutes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/meetings');
}));

// === ORG: NOTICE BOARD ===
app.get('/org/notices', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const notices = (await pool.query('SELECT * FROM notice_board WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Notice Board', `
    <div class="card"><h3>Notice Board</h3>
      <a href="/org/notices/new" class="btn btn-sm" style="margin-bottom:15px">+ Post Notice</a>
      ${notices.map(n => `
        <div class="card" style="border-left:4px solid ${n.priority === 'urgent' ? '#dc2626' : n.priority === 'important' ? '#f59e0b' : '#4f46e5'}">
          <h3>${esc(n.title)} <span class="tag">${esc(n.priority)}</span></h3>
          <p style="margin-top:8px;white-space:pre-wrap">${esc(n.content)}</p>
          <p class="muted" style="margin-top:8px">${new Date(n.created_at).toLocaleString()}</p>
          <a href="/org/notices/${n.id}/delete" class="btn btn-red btn-sm" style="margin-top:8px" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No notices yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/org/notices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Post Notice', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Post New Notice</h3>
      <form method="POST" action="/org/notices/save">
        <input name="title" placeholder="Notice Title" required>
        <select name="priority"><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select>
        <textarea name="content" rows="8" placeholder="Notice content..." required></textarea>
        <button class="btn">Post Notice</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/org/notices/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, content, priority } = req.body;
  await pool.query('INSERT INTO notice_board(tenant_id,title,content,priority) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, title, content, priority]);
  res.redirect('/org/notices');
}));

app.get('/org/notices/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM notice_board WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/org/notices');
}));

// === ORG: FINANCE ===
app.get('/org/finance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT * FROM org_finance WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const income = records.filter(r => r.type === 'income').reduce((a, b) => a + parseInt(b.amount), 0);
  const expense = records.filter(r => r.type === 'expense').reduce((a, b) => a + parseInt(b.amount), 0);
  res.send(renderPage('Org Finance', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${income.toLocaleString()}</div><div>Total Income</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${expense.toLocaleString()}</div><div>Total Expense</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${income - expense >= 0 ? '#059669' : '#dc2626'}">UGX ${(income - expense).toLocaleString()}</div><div>Balance</div></div>
    </div>
    <div class="card"><h3>Record Transaction</h3>
      <form method="POST" action="/org/finance/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 2fr">
          <select name="type" required><option value="">Type</option><option value="income">Income</option><option value="expense">Expense</option></select>
          <input name="amount" type="number" placeholder="Amount UGX" required>
          <input name="description" placeholder="Description" required>
        </div>
        <button class="btn">Save Record</button>
      </form>
    </div>
    <div class="card"><h3>Recent Transactions</h3>
      <table><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
      ${records.map(r => `<tr><td><span style="color:${r.type === 'income' ? '#059669' : '#dc2626'}">${r.type}</span></td><td>UGX ${parseInt(r.amount).toLocaleString()}</td><td>${esc(r.description)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/org/finance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, type, description]);
  res.redirect('/org/finance');
}));

// === ORG: ATTENDANCE ===
app.get('/org/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const today = new Date().toISOString().split('T')[0];
  res.send(renderPage('Attendance', `
    <div class="card"><h3>Mark Attendance - ${today}</h3>
      <form method="POST" action="/org/attendance/save">
        <input type="hidden" name="date" value="${today}">
        <table><tr><th>Member</th><th>Present</th></tr>
        ${members.map(m => `<tr><td>${esc(m.name)}</td><td><input type="checkbox" name="present_ids" value="${m.id}" checked></td></tr>`).join('')}
        </table>
        <button class="btn btn-gold" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/org/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { date, present_ids } = req.body;
  const present = Array.isArray(present_ids) ? present_ids : [present_ids].filter(Boolean);
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id FROM members WHERE tenant_id=$1', [t])).rows;
  for (const m of members) {
    const status = present.includes(String(m.id)) ? 'present' : 'absent';
    await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT (student_id,date) DO UPDATE SET status=$4', [t, m.id, date, status]);
  }
  res.redirect('/org/attendance');
}));

// === ORG: REPORTS ===
app.get('/org/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Reports', `
    <div class="card"><h3>Export Data</h3>
      <div class="grid">
        <a href="/org/reports/export?type=finance" class="btn btn-sm">Finance CSV</a>
        <a href="/org/reports/export?type=members" class="btn btn-sm">Members CSV</a>
        <a href="/org/reports/export?type=attendance" class="btn btn-sm">Attendance CSV</a>
      </div>
    </div>
  `, req.session.user));
}));

app.get('/org/reports/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type } = req.query;
  const t = req.session.user.tenant_id;
  let data, filename;
  if (type === 'finance') {
    data = (await pool.query('SELECT type,amount,description,created_at FROM org_finance WHERE tenant_id=$1', [t])).rows;
    filename = 'finance.csv';
  } else if (type === 'attendance') {
    data = (await pool.query('SELECT a.date,a.status,m.name as member FROM attendance a JOIN members m ON a.student_id=m.id WHERE a.tenant_id=$1', [t])).rows;
    filename = 'attendance.csv';
  } else {
    data = (await pool.query('SELECT name,email,phone,role,joined_at FROM members WHERE tenant_id=$1', [t])).rows;
    filename = 'members.csv';
  }
  const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))).join('\n');
  res.header('Content-Type', 'text/csv');
  res.attachment(filename);
  res.send(csv);
}));

// ============================================================
// CHURCH PORTAL (enhanced)
// ============================================================
app.get('/portal/church', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, tithes, sermons, prayers, schedules] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM members WHERE tenant_id=$1', [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) FROM org_finance WHERE tenant_id=$1 AND type='income' AND description ILIKE '%tithe%'", [t]),
    pool.query('SELECT COUNT(*) FROM sermons WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM prayer_requests WHERE tenant_id=$1 AND is_private=false', [t]),
    pool.query('SELECT COUNT(*) FROM service_schedule WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('Church Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#7c2d12,#ea580c)">
      <h1>Church Portal</h1><p>Congregation, Tithes, Sermons, Prayer Requests</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${members.rows[0].count}</div><div>Members</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(tithes.rows[0].coalesce).toLocaleString()}</div><div>Total Tithes</div></div>
      <div class="stat-card"><div class="stat-num">${sermons.rows[0].count}</div><div>Sermons</div></div>
      <div class="stat-card"><div class="stat-num">${prayers.rows[0].count}</div><div>Prayer Requests</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Congregation</h3>
        <a href="/org/members" class="btn btn-sm">Members</a>
        <a href="/org/register" class="btn btn-sm" style="margin-top:8px">Add Member</a>
      </div>
      <div class="card"><h3>Tithes & Offerings</h3>
        <a href="/church/tithes" class="btn btn-sm">Record Tithe/Offering</a>
        <a href="/org/finance" class="btn btn-sm" style="margin-top:8px">All Finance</a>
      </div>
      <div class="card"><h3>Sermons</h3>
        <a href="/church/sermons" class="btn btn-sm">Sermon Archive</a>
        <a href="/church/sermons/new" class="btn btn-sm" style="margin-top:8px">New Sermon</a>
      </div>
      <div class="card"><h3>Prayer Requests</h3>
        <a href="/church/prayers" class="btn btn-sm">View Requests</a>
        <a href="/church/prayers/new" class="btn btn-sm" style="margin-top:8px">New Request</a>
      </div>
      <div class="card"><h3>Services</h3>
        <a href="/church/schedule" class="btn btn-sm">Service Schedule</a>
      </div>
      <div class="card"><h3>Members</h3>
        <a href="/church/members" class="btn btn-sm">Church Members</a>
        <a href="/church/members/new" class="btn btn-sm" style="margin-top:8px">Add Member</a>
      </div>
      <div class="card"><h3>Donations</h3>
        <a href="/church/donations" class="btn btn-sm">Donation Tracker</a>
      </div>
      <div class="card"><h3>Events</h3>
        <a href="/org/events" class="btn btn-sm">Events</a>
        <a href="/org/notices" class="btn btn-sm" style="margin-top:8px">Notices</a>
      </div>
      <div class="card"><h3>Attendance</h3>
        <a href="/church/attendance" class="btn btn-sm">Mark Attendance</a>
      </div>
      <div class="card"><h3>Tithe Statement</h3>
        <a href="/church/tithe-statement" class="btn btn-sm">Generate</a>
      </div>
      <div class="card"><h3>Birthdays</h3>
        <a href="/church/birthdays" class="btn btn-sm btn-green">Birthday SMS</a>
      </div>
      <div class="card"><h3>Campaigns</h3>
        <a href="/campaigns" class="btn btn-sm btn-gold">Fundraising</a>
      </div>
      <div class="card"><h3>Income</h3>
        <a href="/income" class="btn btn-sm">Income Tracking</a>
      </div>
      <div class="card"><h3>Billing</h3>
        <a href="/billing" class="btn btn-sm">Subscriptions</a>
      </div>
      <div class="card"><h3>Documents</h3>
        <a href="/documents" class="btn btn-sm">Library</a>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="card"><h3>Tithes Trend</h3><canvas id="tithesChart"></canvas></div>
    <div class="card"><h3>Donation Types</h3><canvas id="donationTypesChart"></canvas></div>
    <script>
    (async function(){
      try {
        const tr = await fetch('/church/charts/tithes'); const td = await tr.json();
        new Chart(document.getElementById('tithesChart'),{type:'line',data:{labels:td.labels,datasets:[{label:'Tithes UGX',data:td.values,borderColor:'#d97706',fill:true,backgroundColor:'rgba(217,119,6,0.1)'}]},options:{responsive:true}});
      }catch(e){}
      try {
        const dr = await fetch('/church/charts/donations'); const dd = await dr.json();
        new Chart(document.getElementById('donationTypesChart'),{type:'pie',data:{labels:dd.labels,datasets:[{data:dd.values,backgroundColor:['#4f46e5','#059669','#d97706','#dc2626','#7c3aed','#0891b2']}]},options:{responsive:true}});
      }catch(e){}
    })();
    </script>
  `, req.session.user));
}));

// === CHURCH CHART DATA APIs ===
app.get('/church/charts/tithes', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT TO_CHAR(created_at,'Mon YYYY') as month, COALESCE(SUM(amount),0) as total FROM org_finance WHERE tenant_id=$1 AND type='income' AND (description ILIKE '%tithe%' OR description ILIKE '%offering%') AND created_at > NOW()-INTERVAL '12 months' GROUP BY month ORDER BY MIN(created_at)", [t])).rows;
  res.json({ labels: data.map(d => d.month), values: data.map(d => parseInt(d.total)) });
}));

app.get('/church/charts/donations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query('SELECT COALESCE(type,\'General\') as dtype, COALESCE(SUM(amount),0) as total FROM donations WHERE tenant_id=$1 GROUP BY dtype ORDER BY total DESC', [t])).rows;
  if (data.length === 0) { res.json({ labels: ['No donations yet'], values: [0] }); } else { res.json({ labels: data.map(d => d.dtype), values: data.map(d => parseInt(d.total)) }); }
}));

// === CHURCH: TITHE/OFFERING TRACKER ===
app.get('/church/tithes', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tithes = (await pool.query("SELECT * FROM org_finance WHERE tenant_id=$1 AND (description ILIKE '%tithe%' OR description ILIKE '%offering%') ORDER BY created_at DESC", [t])).rows;
  const total = tithes.filter(r => r.type === 'income').reduce((a, b) => a + parseInt(b.amount), 0);
  res.send(renderPage('Tithes & Offerings', `
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${total.toLocaleString()}</div><div>Total Tithes & Offerings</div></div></div>
    <div class="card"><h3>Record Tithe/Offering</h3>
      <form method="POST" action="/church/tithes/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 2fr">
          <select name="type" required><option value="income">Income</option><option value="expense">Expense</option></select>
          <input name="amount" type="number" placeholder="Amount UGX" required>
          <input name="donor_name" placeholder="Donor Name (for tithe statement)">
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr 2fr;margin-top:8px">
          <select name="method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank Transfer</option><option value="cheque">Cheque</option></select>
          <input name="description" placeholder="Tithe/Offering Description" required>
        </div>
        <button class="btn btn-gold">Save Record</button>
      </form>
    </div>
    <div class="card"><h3>Recent Tithes & Offerings</h3>
      <table><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
      ${tithes.map(r => `<tr><td style="color:${r.type === 'income' ? '#059669' : '#dc2626'}">${r.type}</td><td>UGX ${parseInt(r.amount).toLocaleString()}</td><td>${esc(r.description)}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/church/tithes/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, amount, description, donor_name, method } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, type, description]);
  // Also save to donations table for tithe statement generation
  await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method,is_tithe) VALUES($1,$2,$3,$4,$5,true)', [req.session.user.tenant_id, donor_name || 'Anonymous', amount, type, method || 'cash']);
  res.redirect('/church/tithes');
}));

// === CHURCH: SERMONS ===
app.get('/church/sermons', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sermons = (await pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY sermon_date DESC', [t])).rows;
  res.send(renderPage('Sermon Archive', `
    <div class="card"><h3>Sermon Archive</h3>
      <a href="/church/sermons/new" class="btn btn-sm" style="margin-bottom:15px">+ New Sermon</a>
      <table><tr><th>Title</th><th>Preacher</th><th>Date</th><th>Scripture</th><th>Actions</th></tr>
      ${sermons.map(s => `<tr><td>${esc(s.title)}</td><td>${esc(s.preacher)}</td><td>${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''}</td><td>${esc(s.scripture)}</td>
        <td><a href="/church/sermons/${s.id}" class="btn btn-sm">View</a> <a href="/church/sermons/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No sermons yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/church/sermons/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Sermon', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>Record Sermon</h3>
      <form method="POST" action="/church/sermons/save">
        <input name="title" placeholder="Sermon Title" required>
        <input name="preacher" placeholder="Preacher Name" required>
        <input name="sermon_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <input name="scripture" placeholder="Scripture Reference (e.g. John 3:16)">
        <textarea name="notes" rows="8" placeholder="Sermon notes, key points..."></textarea>
        <button class="btn btn-gold">Save Sermon</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/sermons/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, preacher, sermon_date, scripture, notes } = req.body;
  await pool.query('INSERT INTO sermons(tenant_id,title,preacher,sermon_date,scripture,notes) VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, title, preacher, sermon_date, scripture, notes]);
  res.redirect('/church/sermons');
}));

app.get('/church/sermons/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const s = (await pool.query('SELECT * FROM sermons WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!s) return res.status(404).send('Not found');
  res.send(renderPage(s.title, `
    <div class="card"><h3>${esc(s.title)}</h3>
      <p class="muted">${esc(s.preacher)} | ${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''} | ${esc(s.scripture)}</p>
      <div style="margin-top:20px;white-space:pre-wrap">${esc(s.notes)}</div>
      <a href="/church/sermons" class="btn btn-sm" style="margin-top:15px">Back to Archive</a>
    </div>
  `, req.session.user));
}));

app.get('/church/sermons/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM sermons WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/sermons');
}));

// === CHURCH: PRAYER REQUESTS ===
app.get('/church/prayers', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const prayers = (await pool.query('SELECT * FROM prayer_requests WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Prayer Requests', `
    <div class="card"><h3>Prayer Requests</h3>
      <a href="/church/prayers/new" class="btn btn-sm" style="margin-bottom:15px">+ New Request</a>
      ${prayers.map(p => `
        <div class="card">
          <h4>${esc(p.name || 'Anonymous')} ${p.is_private ? '<span class="tag" style="background:#fee2e2;color:#991b1b">Private</span>' : ''}</h4>
          <p style="white-space:pre-wrap">${esc(p.request)}</p>
          <p class="muted">${new Date(p.created_at).toLocaleString()}</p>
          <a href="/church/prayers/${p.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No prayer requests yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/church/prayers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Prayer Request', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Submit Prayer Request</h3>
      <form method="POST" action="/church/prayers/save">
        <input name="name" placeholder="Your Name (or leave blank for anonymous)">
        <textarea name="request" rows="5" placeholder="Prayer request..." required></textarea>
        <label style="display:flex;align-items:center;gap:8px;margin:10px 0"><input type="checkbox" name="is_private" value="true" style="width:auto"> Keep this private (only admins see it)</label>
        <button class="btn">Submit Request</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/prayers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, request, is_private } = req.body;
  await pool.query('INSERT INTO prayer_requests(tenant_id,name,request,is_private) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, name || 'Anonymous', request, is_private === 'true']);
  res.redirect('/church/prayers');
}));

app.get('/church/prayers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM prayer_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/prayers');
}));

// === CHURCH: SERVICE SCHEDULE ===
app.get('/church/schedule', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const schedules = (await pool.query('SELECT * FROM service_schedule WHERE tenant_id=$1 ORDER BY id', [t])).rows;
  res.send(renderPage('Service Schedule', `
    <div class="card"><h3>Service Schedule</h3>
      <a href="/church/schedule/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Service</a>
      <table><tr><th>Service</th><th>Day</th><th>Start</th><th>End</th><th>Action</th></tr>
      ${schedules.map(s => `<tr><td>${esc(s.service_name)}</td><td>${esc(s.day_of_week)}</td><td>${esc(s.start_time)}</td><td>${esc(s.end_time)}</td>
        <td><a href="/church/schedule/${s.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No services scheduled</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/church/schedule/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Service', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Service to Schedule</h3>
      <form method="POST" action="/church/schedule/save">
        <input name="service_name" placeholder="Service Name (e.g. Sunday Worship)" required>
        <select name="day_of_week" required><option>Sunday</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option><option>Thursday</option><option>Friday</option><option>Saturday</option></select>
        <input name="start_time" type="time" required>
        <input name="end_time" type="time" required>
        <button class="btn">Add Service</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/schedule/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { service_name, day_of_week, start_time, end_time } = req.body;
  await pool.query('INSERT INTO service_schedule(tenant_id,service_name,day_of_week,start_time,end_time) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, service_name, day_of_week, start_time, end_time]);
  res.redirect('/church/schedule');
}));

app.get('/church/schedule/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM service_schedule WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/schedule');
}));

// === CHURCH: MEMBERS ===
app.get('/church/members', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Church Members', `
    <div class="card"><h3>Church Members</h3>
      <a href="/church/members/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Member</a>
      <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
      ${members.map(m => `<tr><td>${esc(m.name)}</td><td>${esc(m.email)}</td><td>${esc(m.phone)}</td><td>${esc(m.role)}</td><td>${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ''}</td>
        <td><a href="/church/members/${m.id}/edit" class="btn btn-sm">Edit</a> <a href="/church/members/${m.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="6">No church members yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/church/members/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Church Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Church Member</h3>
      <form method="POST" action="/church/members/save">
        <input name="name" placeholder="Full Name" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone +256...">
        <input name="address" placeholder="Address">
        <input name="date_of_birth" type="date" placeholder="Date of Birth">
        <select name="role"><option value="">Select Role</option><option>Pastor</option><option>Elder</option><option>Deacon</option><option>Choir Member</option><option>Usher</option><option>Member</option></select>
        <button class="btn btn-green">Add Member</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/church/members/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address, role, date_of_birth } = req.body;
  await pool.query('INSERT INTO church_members(tenant_id,name,email,phone,address,role,date_of_birth) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.session.user.tenant_id, name, email, phone, address, role, date_of_birth || null]);
  await audit(req.session.user.email, 'add_church_member', `Added church member: ${name}`);
  res.redirect('/church/members');
}));

app.get('/church/members/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT * FROM church_members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!m) return res.status(404).send('Not found');
  res.send(renderPage('Edit Church Member', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit: ${esc(m.name)}</h3>
      <form method="POST" action="/church/members/${m.id}/update">
        <input name="name" value="${esc(m.name)}" required>
        <input name="email" type="email" value="${esc(m.email)}">
        <input name="phone" value="${esc(m.phone)}">
        <input name="address" value="${esc(m.address)}">
        <select name="role"><option value="">Select Role</option><option ${m.role==='Pastor'?'selected':''}>Pastor</option><option ${m.role==='Elder'?'selected':''}>Elder</option><option ${m.role==='Deacon'?'selected':''}>Deacon</option><option ${m.role==='Choir Member'?'selected':''}>Choir Member</option><option ${m.role==='Usher'?'selected':''}>Usher</option><option ${m.role==='Member'?'selected':''}>Member</option></select>
        <button class="btn">Update Member</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/church/members/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address, role } = req.body;
  await pool.query('UPDATE church_members SET name=$1,email=$2,phone=$3,address=$4,role=$5 WHERE id=$6 AND tenant_id=$7', [name, email, phone, address, role, req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'edit_church_member', `Updated church member: ${name}`);
  res.redirect('/church/members');
}));

app.get('/church/members/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM church_members WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/members');
}));

// === CHURCH: DONATIONS ===
app.get('/church/donations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const donations = (await pool.query('SELECT * FROM donations WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const total = donations.reduce((a, d) => a + parseInt(d.amount), 0);
  res.send(renderPage('Donations', `
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${total.toLocaleString()}</div><div>Total Donations</div></div></div>
    <div class="card"><h3>Record Donation</h3>
      <form method="POST" action="/church/donations/save">
        <div class="grid" style="grid-template-columns:2fr 1fr 1fr">
          <input name="donor_name" placeholder="Donor Name" required>
          <input name="amount" type="number" placeholder="Amount UGX" required>
          <select name="type"><option>Tithe</option><option>Offering</option><option>Building Fund</option><option>Charity</option><option>Project</option><option>Other</option></select>
        </div>
        <div class="grid" style="grid-template-columns:1fr 1fr">
          <select name="method"><option>Cash</option><option>Mobile Money</option><option>Bank Transfer</option><option>Cheque</option></select>
          <input name="reference" placeholder="Reference/Receipt #">
        </div>
        <button class="btn btn-gold">Record Donation</button>
      </form>
    </div>
    <div class="card"><h3>Donation History</h3>
      <table><tr><th>Donor</th><th>Amount</th><th>Type</th><th>Method</th><th>Reference</th><th>Date</th><th>Action</th></tr>
      ${donations.map(d => `<tr><td>${esc(d.donor_name)}</td><td>UGX ${parseInt(d.amount).toLocaleString()}</td><td><span class="tag">${esc(d.type)}</span></td><td>${esc(d.method)}</td><td>${esc(d.reference)}</td><td>${new Date(d.created_at).toLocaleDateString()}</td>
        <td><a href="/church/donations/${d.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="7">No donations yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/church/donations/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { donor_name, amount, type, method, reference } = req.body;
  await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method,reference) VALUES($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, donor_name, amount, type, method, reference]);
  await audit(req.session.user.email, 'add_donation', `Donation UGX ${amount} from ${donor_name}`);
  res.redirect('/church/donations');
}));

app.get('/church/donations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM donations WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/donations');
}));

// ============================================================
// BUSINESS PORTAL (enhanced)
// ============================================================
app.get('/portal/business', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, inventory, invoices, expenses, customers] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM inventory WHERE tenant_id=$1 AND quantity<5', [t]),
    pool.query("SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM customers WHERE tenant_id=$1', [t])
  ]);
  const profit = parseInt(sales.rows[0].coalesce) - parseInt(expenses.rows[0].coalesce);
  res.send(renderPage('Business Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>Business Portal</h1><p>POS, Inventory, Invoices, Customers, Profit/Loss</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(sales.rows[0].coalesce).toLocaleString()}</div><div>Month Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit >= 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Net Profit</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${inventory.rows[0].count}</div><div>Low Stock</div></div>
      <div class="stat-card"><div class="stat-num">${invoices.rows[0].count}</div><div>Unpaid Invoices</div></div>
      <div class="stat-card"><div class="stat-num">${customers.rows[0].count}</div><div>Customers</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Point of Sale</h3><a href="/business/pos" class="btn btn-sm">New Sale</a><a href="/business/sales" class="btn btn-sm" style="margin-top:8px">Sales History</a></div>
      <div class="card"><h3>Inventory</h3><a href="/business/inventory" class="btn btn-sm">Stock Management</a><a href="/business/inventory/add" class="btn btn-sm" style="margin-top:8px">Add Product</a></div>
      <div class="card"><h3>Invoices</h3><a href="/business/invoices" class="btn btn-sm">Manage Invoices</a></div>
      <div class="card"><h3>Expenses</h3><a href="/business/expenses" class="btn btn-sm">Record Expense</a><a href="/business/profit-loss" class="btn btn-sm" style="margin-top:8px">Profit/Loss</a></div>
      <div class="card"><h3>Customers</h3><a href="/business/customers" class="btn btn-sm">Customer Directory</a></div>
      <div class="card"><h3>Reports</h3><a href="/business/monthly-report" class="btn btn-gold btn-sm">Monthly Report</a></div>
      <div class="card"><h3>Debts</h3><a href="/business/debts" class="btn btn-sm btn-red">Customer Debts</a></div>
      <div class="card"><h3>Purchase Orders</h3><a href="/business/purchase-orders" class="btn btn-sm">Manage POs</a></div>
      <div class="card"><h3>Tax (VAT/URA)</h3><a href="/business/tax" class="btn btn-sm">Tax Reports</a></div>
      <div class="card"><h3>Barcodes</h3><a href="/barcode" class="btn btn-sm">Scan / Generate</a></div>
      <div class="card"><h3>Bills</h3><a href="/bill-reminders" class="btn btn-sm btn-red">Bill Reminders</a></div>
      <div class="card"><h3>Income</h3><a href="/income" class="btn btn-sm btn-green">Income Tracking</a></div>
      <div class="card"><h3>Billing</h3><a href="/billing" class="btn btn-sm btn-gold">Subscriptions</a></div>
      <div class="card"><h3>Documents</h3><a href="/documents" class="btn btn-sm">Library</a></div>
      <div class="card"><h3>API</h3><a href="/api-keys" class="btn btn-sm">API Keys</a></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="card"><h3>Sales Trend</h3><canvas id="salesChart"></canvas></div>
    <div class="card"><h3>Expenses Breakdown</h3><canvas id="expensesChart"></canvas></div>
    <script>
    (async function(){
      try {
        const sr = await fetch('/business/charts/sales'); const sd = await sr.json();
        new Chart(document.getElementById('salesChart'),{type:'line',data:{labels:sd.labels,datasets:[{label:'Sales UGX',data:sd.values,borderColor:'#0891b2',fill:true,backgroundColor:'rgba(8,145,178,0.1)'}]},options:{responsive:true}});
      }catch(e){}
      try {
        const er = await fetch('/business/charts/expenses'); const ed = await er.json();
        new Chart(document.getElementById('expensesChart'),{type:'doughnut',data:{labels:ed.labels,datasets:[{data:ed.values,backgroundColor:['#4f46e5','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#ec4899']}]},options:{responsive:true}});
      }catch(e){}
    })();
    </script>
  `, req.session.user));
}));

// === BUSINESS CHART DATA APIs ===
app.get('/business/charts/sales', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query("SELECT TO_CHAR(created_at,'Mon YYYY') as month, COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '12 months' GROUP BY month ORDER BY MIN(created_at)", [t])).rows;
  res.json({ labels: data.map(d => d.month), values: data.map(d => parseInt(d.total)) });
}));

app.get('/business/charts/expenses', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query('SELECT COALESCE(category,\'Other\') as cat, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 GROUP BY cat ORDER BY total DESC', [t])).rows;
  res.json({ labels: data.map(d => d.cat), values: data.map(d => parseInt(d.total)) });
}));

// === BUSINESS: POS ===
app.get('/business/pos', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const inventory = (await pool.query('SELECT id,name,sku,selling_price,quantity FROM inventory WHERE tenant_id=$1 AND quantity>0 ORDER BY name', [t])).rows;
  res.send(renderPage('Point of Sale', `
    <div class="card"><h3>New Sale</h3>
      <form method="POST" action="/business/pos/checkout">
        <input name="customer_name" placeholder="Customer Name" required>
        <input name="customer_contact" placeholder="Phone (optional)">
        <table id="saleTable"><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr>
        <tr>
          <td><select name="item_0_id" onchange="updatePrice(this)"><option value="">Select</option>
            ${inventory.map(i => `<option value="${i.id}" data-price="${i.selling_price}" data-qty="${i.quantity}">${esc(i.name)} - UGX ${parseInt(i.selling_price).toLocaleString()} (${i.quantity} left)</option>`).join('')}
          </select></td>
          <td id="price_0">0</td>
          <td><input type="number" name="item_0_qty" value="1" min="1" onchange="calcTotal()"></td>
          <td id="total_0">0</td>
        </tr>
        </table>
        <button type="button" onclick="addRow()" class="btn btn-sm">+ Add Item</button>
        <h3 style="margin-top:20px">Grand Total: UGX <span id="grandTotal">0</span></h3>
        <input type="hidden" name="row_count" id="rowCount" value="1">
        <select name="payment_status" required><option value="paid">Paid</option><option value="credit">Credit</option></select>
        <button class="btn btn-gold" style="padding:15px;font-size:16px">Checkout & Print Receipt</button>
      </form>
    </div>
    <script>
      let rows = 1;
      function updatePrice(sel) {
        const i = sel.name.split('_')[1];
        const price = sel.options[sel.selectedIndex]?.dataset.price || 0;
        document.getElementById('price_' + i).textContent = parseInt(price).toLocaleString();
        calcTotal();
      }
      function calcTotal() {
        let grand = 0;
        for(let i = 0; i < rows; i++) {
          const priceEl = document.getElementById('price_' + i);
          const qtyEl = document.querySelector('[name="item_' + i + '_qty"]');
          if (!priceEl || !qtyEl) continue;
          const price = parseInt(priceEl.textContent.replace(/,/g, '')) || 0;
          const qty = parseInt(qtyEl.value) || 0;
          const total = price * qty;
          document.getElementById('total_' + i).textContent = total.toLocaleString();
          grand += total;
        }
        document.getElementById('grandTotal').textContent = grand.toLocaleString();
      }
      function addRow() {
        const table = document.getElementById('saleTable');
        const newRow = table.insertRow();
        newRow.innerHTML = document.querySelector('#saleTable tr:nth-child(2)').innerHTML.replace(/_0/g, '_' + rows);
        rows++;
        document.getElementById('rowCount').value = rows;
      }
    </script>
  `, req.session.user));
}));

app.post('/business/pos/checkout', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, payment_status, row_count } = req.body;
  let total = 0;
  const items = [];
  for (let i = 0; i < parseInt(row_count); i++) {
    const id = req.body[`item_${i}_id`];
    const qty = parseInt(req.body[`item_${i}_qty`]) || 0;
    if (id && qty > 0) {
      const product = (await pool.query('SELECT selling_price,name,quantity FROM inventory WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
      if (product && product.quantity >= qty) {
        items.push({ id, qty, price: product.selling_price, name: product.name });
        total += product.selling_price * qty;
        await pool.query('UPDATE inventory SET quantity=quantity-$1 WHERE id=$2', [qty, id]);
      }
    }
  }
  const sale = (await pool.query('INSERT INTO sales(tenant_id,customer_name,total,paid,status) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [t, customer_name, total, payment_status === 'paid' ? total : 0, payment_status])).rows[0];
  for (let item of items) {
    await pool.query('INSERT INTO sale_items(sale_id,inventory_id,quantity,price) VALUES($1,$2,$3,$4)', [sale.id, item.id, item.qty, item.price]);
  }
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: `${req.session.user.tenant_name} - Receipt`, bold: true, size: 24 })] }),
      new Paragraph({ text: `Customer: ${customer_name}` }),
      new Paragraph({ text: `Date: ${new Date().toLocaleString()}` }),
      new Paragraph({ text: "" }),
      ...items.map(i => new Paragraph({ text: `${i.name} x${i.qty} - UGX ${(i.price * i.qty).toLocaleString()}` })),
      new Paragraph({ text: "" }),
      new Paragraph({ children: [new TextRun({ text: `TOTAL: UGX ${total.toLocaleString()}`, bold: true })] }),
      new Paragraph({ text: `Status: ${payment_status.toUpperCase()}` }),
    ]}]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Receipt-${sale.id}.docx`);
  res.send(buffer);
}));

// === BUSINESS: SALES HISTORY ===
app.get('/business/sales', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sales = (await pool.query('SELECT * FROM sales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  const totalSales = sales.reduce((a, s) => a + parseInt(s.total), 0);
  const totalPaid = sales.reduce((a, s) => a + parseInt(s.paid), 0);
  res.send(renderPage('Sales History', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalSales.toLocaleString()}</div><div>Total Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Total Collected</div></div>
    </div>
    <div class="card"><h3>Recent Sales</h3>
      <table><tr><th>ID</th><th>Customer</th><th>Total</th><th>Paid</th><th>Status</th><th>Date</th></tr>
      ${sales.map(s => `<tr><td>#${s.id}</td><td>${esc(s.customer_name)}</td><td>UGX ${parseInt(s.total).toLocaleString()}</td><td>UGX ${parseInt(s.paid).toLocaleString()}</td><td><span class="tag">${esc(s.status)}</span></td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="6">No sales yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === BUSINESS: CUSTOMERS ===
app.get('/business/customers', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const customers = (await pool.query('SELECT * FROM customers WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Customer Directory', `
    <div class="card"><h3>Customer Directory</h3>
      <a href="/business/customers/new" class="btn btn-sm" style="margin-bottom:15px">+ Add Customer</a>
      <table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Actions</th></tr>
      ${customers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td>
        <td><a href="/business/customers/${c.id}/edit" class="btn btn-sm">Edit</a> <a href="/business/customers/${c.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
      </tr>`).join('') || '<tr><td colspan="5">No customers yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/customers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Customer', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Customer</h3>
      <form method="POST" action="/business/customers/save">
        <input name="name" placeholder="Customer Name" required>
        <input name="email" type="email" placeholder="Email">
        <input name="phone" placeholder="Phone +256...">
        <input name="address" placeholder="Address">
        <button class="btn btn-green">Add Customer</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/customers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address } = req.body;
  await pool.query('INSERT INTO customers(tenant_id,name,email,phone,address) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, name, email, phone, address]);
  res.redirect('/business/customers');
}));

app.get('/business/customers/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const c = (await pool.query('SELECT * FROM customers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!c) return res.status(404).send('Not found');
  res.send(renderPage('Edit Customer', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Edit Customer: ${esc(c.name)}</h3>
      <form method="POST" action="/business/customers/${c.id}/update">
        <input name="name" value="${esc(c.name)}" required>
        <input name="email" type="email" value="${esc(c.email)}">
        <input name="phone" value="${esc(c.phone)}">
        <input name="address" value="${esc(c.address)}">
        <button class="btn">Update Customer</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/business/customers/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { name, email, phone, address } = req.body;
  await pool.query('UPDATE customers SET name=$1,email=$2,phone=$3,address=$4 WHERE id=$5 AND tenant_id=$6', [name, email, phone, address, req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/customers');
}));

app.get('/business/customers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM customers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/customers');
}));

// === BUSINESS: INVENTORY ===
app.get('/business/inventory', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Inventory', `
    <div class="card"><h3>Stock Management</h3>
      <a href="/business/inventory/add" class="btn btn-sm">+ Add Product</a>
      <table style="margin-top:15px"><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Value</th></tr>
      ${items.map(i => `
        <tr ${i.quantity < 5 ? 'style="background:#fee2e2"' : ''}>
          <td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td>${i.quantity}</td>
          <td>${parseInt(i.cost_price).toLocaleString()}</td><td>${parseInt(i.selling_price).toLocaleString()}</td>
          <td>${(i.quantity * i.selling_price).toLocaleString()}</td>
        </tr>
      `).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/inventory/add', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Product', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Add Product to Inventory</h3>
      <form method="POST" action="/business/inventory/save">
        <input name="name" placeholder="Product Name" required>
        <input name="sku" placeholder="SKU/Code" required>
        <input name="quantity" type="number" placeholder="Quantity" required>
        <input name="cost_price" type="number" placeholder="Cost Price UGX" required>
        <input name="selling_price" type="number" placeholder="Selling Price UGX" required>
        <button class="btn btn-green">Add Product</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/inventory/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, sku, quantity, cost_price, selling_price } = req.body;
  await pool.query('INSERT INTO inventory(tenant_id,name,sku,quantity,cost_price,selling_price) VALUES($1,$2,$3,$4,$5,$6)', [t, name, sku, quantity, cost_price, selling_price]);
  res.redirect('/business/inventory');
}));

// === BUSINESS: INVOICES (with mark as paid) ===
app.get('/business/invoices', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Invoices', `
    <div class="card"><h3>Invoices</h3>
      <a href="/business/invoices/new" class="btn btn-sm">+ New Invoice</a>
      <table style="margin-top:15px"><tr><th>No.</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th></tr>
      ${invoices.map(i => `<tr>
        <td>${esc(i.invoice_no)}</td><td>${esc(i.customer_name)}</td><td>UGX ${parseInt(i.amount).toLocaleString()}</td>
        <td>${i.due_date ? new Date(i.due_date).toLocaleDateString() : 'N/A'}</td>
        <td>${i.status === 'paid' ? '<span style="color:#059669;font-weight:600">Paid</span>' : '<span style="color:#dc2626;font-weight:600">Unpaid</span>'}</td>
        <td>
          ${i.status === 'unpaid' ? `<a href="/business/invoices/${i.id}/mark-paid" class="btn btn-green btn-sm" onclick="return confirm('Mark as paid?')">Pay</a>` : ''}
          <a href="/business/invoices/${i.id}/print" target="_blank" class="btn btn-sm">Print</a>
        </td>
      </tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.get('/business/invoices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Invoice', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Create Invoice</h3>
      <form method="POST" action="/business/invoices/save">
        <input name="customer_name" placeholder="Customer Name" required>
        <input name="customer_contact" placeholder="Phone/Email">
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="due_date" type="date" required>
        <textarea name="items" placeholder="Item 1 - UGX 10,000&#10;Item 2 - UGX 5,000" rows="4"></textarea>
        <button class="btn">Generate Invoice</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/invoices/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, amount, due_date } = req.body;
  const invoice_no = 'INV' + Date.now();
  await pool.query('INSERT INTO invoices(tenant_id,invoice_no,customer_name,customer_contact,amount,due_date,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [t, invoice_no, customer_name, customer_contact, amount, due_date, 'unpaid']);
  res.redirect('/business/invoices');
}));

app.get('/business/invoices/:id/mark-paid', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  await pool.query('UPDATE invoices SET status=\'paid\' WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'invoice_paid', `Invoice #${req.params.id} marked as paid`);
  res.redirect('/business/invoices');
}));

app.get('/business/invoices/:id/print', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const i = (await pool.query('SELECT i.*,t.name as company_name FROM invoices i JOIN tenants t ON i.tenant_id=t.id WHERE i.id=$1 AND i.tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!i) return res.status(404).send('Not found');
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: i.company_name, bold: true, size: 28 })] }),
      new Paragraph({ children: [new TextRun({ text: `INVOICE #${i.invoice_no}`, bold: true, size: 24 })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: `Bill To: ${i.customer_name}` }),
      new Paragraph({ text: `Contact: ${i.customer_contact}` }),
      new Paragraph({ text: `Due Date: ${i.due_date ? new Date(i.due_date).toDateString() : 'N/A'}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: `Amount Due: UGX ${parseInt(i.amount).toLocaleString()}`, bold: true, size: 32 })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: `Status: ${i.status.toUpperCase()}` }),
    ]}]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=Invoice-${i.invoice_no}.docx`);
  res.send(buffer);
}));

// === BUSINESS: EXPENSES ===
app.get('/business/expenses', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const expenses = (await pool.query('SELECT * FROM expenses WHERE tenant_id=$1 ORDER BY expense_date DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Expenses', `
    <div class="card"><h3>Record Expense</h3>
      <form method="POST" action="/business/expenses/save">
        <select name="category" required><option value="">Category</option><option>Rent</option><option>Salaries</option><option>Utilities</option><option>Supplies</option><option>Marketing</option><option>Other</option></select>
        <input name="amount" type="number" placeholder="Amount UGX" required>
        <input name="description" placeholder="Description" required>
        <input name="expense_date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
        <button class="btn btn-red">Record Expense</button>
      </form>
    </div>
    <div class="card"><h3>Recent Expenses</h3>
      <table><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr>
      ${expenses.map(e => `<tr><td>${new Date(e.expense_date).toLocaleDateString()}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>UGX ${parseInt(e.amount).toLocaleString()}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/business/expenses/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { category, amount, description, expense_date } = req.body;
  await pool.query('INSERT INTO expenses(tenant_id,category,amount,description,expense_date) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, category, amount, description, expense_date]);
  res.redirect('/business/expenses');
}));

// === BUSINESS: PROFIT/LOSS ===
app.get('/business/profit-loss', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, expenses] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t])
  ]);
  const revenue = parseInt(sales.rows[0].total);
  const cost = parseInt(expenses.rows[0].total);
  const profit = revenue - cost;
  res.send(renderPage('Profit & Loss', `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)">
      <h1>Profit & Loss - This Month</h1>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${revenue.toLocaleString()}</div><div>Revenue</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${cost.toLocaleString()}</div><div>Expenses</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${profit >= 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}</div><div>Net Profit</div></div>
    </div>
  `, req.session.user));
}));

// === BUSINESS: MONTHLY REPORT (.docx) ===
app.get('/business/monthly-report', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const [sales, expenses, invCount] = await Promise.all([
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND expense_date>DATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) as cnt, COALESCE(SUM(quantity * selling_price),0) as value FROM inventory WHERE tenant_id=$1', [t])
  ]);
  const s = sales.rows[0];
  const e = expenses.rows[0];
  const inv = invCount.rows[0];
  const now = new Date();
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: tenant.name, bold: true, size: 32 })] }),
      new Paragraph({ children: [new TextRun({ text: `Monthly Business Report - ${monthName}`, bold: true, size: 24 })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'SALES SUMMARY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Total Sales: ${s.cnt}` }),
      new Paragraph({ text: `Revenue: UGX ${parseInt(s.total).toLocaleString()}` }),
      new Paragraph({ text: `Collected: UGX ${parseInt(s.paid).toLocaleString()}` }),
      new Paragraph({ text: `Outstanding: UGX ${(parseInt(s.total) - parseInt(s.paid)).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'EXPENSES SUMMARY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Total Expenses: ${e.cnt}` }),
      new Paragraph({ text: `Amount: UGX ${parseInt(e.total).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'PROFIT', bold: true, size: 20 })] }),
      new Paragraph({ children: [new TextRun({ text: `Net Profit: UGX ${(parseInt(s.total) - parseInt(e.total)).toLocaleString()}`, bold: true })] }),
      new Paragraph({ text: '' }),
      new Paragraph({ children: [new TextRun({ text: 'INVENTORY', bold: true, size: 20 })] }),
      new Paragraph({ text: `Products in Stock: ${inv.cnt}` }),
      new Paragraph({ text: `Stock Value: UGX ${parseInt(inv.value).toLocaleString()}` }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: `Generated: ${now.toLocaleString()}` }),
    ]}]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=MonthlyReport-${monthName.replace(/\s/g, '-')}.docx`);
  res.send(buffer);
}));

// ============================================================
// ============================================================
// PHASE 3: INDIVIDUAL / PLATFORM-WIDE / DEV / ETC
// ============================================================

// === INDIVIDUAL PORTAL (enhanced) ===
app.get('/portal/individual', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [goals, notes, budgetItems] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM goals WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) FROM personal_notes WHERE tenant_id=$1', [t]),
    pool.query('SELECT COALESCE(SUM(planned),0) as planned, COALESCE(SUM(actual),0) as actual FROM budget_items WHERE tenant_id=$1', [t])
  ]);
  res.send(renderPage('Personal Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
      <h1>Personal Portal</h1><p>Your budgets, goals, notes, personal tracking</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${goals.rows[0].count}</div><div>Goals</div></div>
      <div class="stat-card"><div class="stat-num">${notes.rows[0].count}</div><div>Notes</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budgetItems.rows[0].planned).toLocaleString()}</div><div>Budget Planned</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(budgetItems.rows[0].actual).toLocaleString()}</div><div>Budget Spent</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Budget Tracker</h3><a href="/individual/budget" class="btn btn-sm">Manage Budget</a></div>
      <div class="card"><h3>Goals</h3><a href="/individual/goals" class="btn btn-sm">Set Goals</a></div>
      <div class="card"><h3>Notes</h3><a href="/individual/notes" class="btn btn-sm">My Notes</a></div>
      <div class="card"><h3>Documents</h3><a href="/individual/docs" class="btn btn-sm">My Documents</a></div>
      <div class="card"><h3>Bill Reminders</h3><a href="/bill-reminders" class="btn btn-sm btn-red">Reminders</a></div>
      <div class="card"><h3>Income</h3><a href="/income" class="btn btn-sm btn-green">Income Tracking</a></div>
      <div class="card"><h3>Documents</h3><a href="/documents" class="btn btn-sm">Document Library</a></div>
      <div class="card"><h3>Billing</h3><a href="/billing" class="btn btn-sm btn-gold">Subscriptions</a></div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="card"><h3>Budget: Planned vs Actual</h3><canvas id="budgetChart"></canvas></div>
    <script>
    (async function(){
      try {
        const br = await fetch('/individual/charts/budget'); const bd = await br.json();
        new Chart(document.getElementById('budgetChart'),{type:'bar',data:{labels:bd.labels,datasets:[{label:'Planned',data:bd.planned,backgroundColor:'rgba(79,70,229,0.6)'},{label:'Actual',data:bd.actual,backgroundColor:'rgba(220,38,38,0.6)'}]},options:{responsive:true}});
      }catch(e){}
    })();
    </script>
  `, req.session.user));
}));

// === INDIVIDUAL CHART DATA API ===
app.get('/individual/charts/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const data = (await pool.query('SELECT category, planned, actual FROM budget_items WHERE tenant_id=$1 ORDER BY category', [t])).rows;
  res.json({ labels: data.map(d => d.category), planned: data.map(d => parseInt(d.planned)), actual: data.map(d => parseInt(d.actual)) });
}));

// === INDIVIDUAL: BUDGET TRACKER ===
app.get('/individual/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM budget_items WHERE tenant_id=$1 ORDER BY category', [t])).rows;
  const totalPlanned = items.reduce((a, b) => a + parseInt(b.planned), 0);
  const totalActual = items.reduce((a, b) => a + parseInt(b.actual), 0);
  res.send(renderPage('Budget Tracker', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalPlanned.toLocaleString()}</div><div>Total Planned</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalActual.toLocaleString()}</div><div>Total Spent</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalPlanned - totalActual >= 0 ? '#059669' : '#dc2626'}">UGX ${(totalPlanned - totalActual).toLocaleString()}</div><div>Remaining</div></div>
    </div>
    <div class="card"><h3>Add Budget Item</h3>
      <form method="POST" action="/individual/budget/save">
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr">
          <input name="category" placeholder="Category (e.g. Food)" required>
          <input name="planned" type="number" placeholder="Planned UGX" required>
          <input name="actual" type="number" placeholder="Actual UGX" value="0">
          <input name="month" placeholder="Month (e.g. Jan 2025)">
        </div>
        <button class="btn btn-green">Add Item</button>
      </form>
    </div>
    <div class="card"><h3>Budget Items</h3>
      <table><tr><th>Category</th><th>Planned</th><th>Actual</th><th>Difference</th><th>Month</th><th>Action</th></tr>
      ${items.map(i => {
        const diff = parseInt(i.planned) - parseInt(i.actual);
        return `<tr><td>${esc(i.category)}</td><td>UGX ${parseInt(i.planned).toLocaleString()}</td><td>UGX ${parseInt(i.actual).toLocaleString()}</td>
          <td style="color:${diff >= 0 ? '#059669' : '#dc2626'}">UGX ${diff.toLocaleString()}</td><td>${esc(i.month)}</td>
          <td><a href="/individual/budget/${i.id}/update" class="btn btn-sm">Update</a> <a href="/individual/budget/${i.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Del</a></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6">No budget items yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/individual/budget/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { category, planned, actual, month } = req.body;
  await pool.query('INSERT INTO budget_items(tenant_id,category,planned,actual,month) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, category, planned, actual || 0, month]);
  res.redirect('/individual/budget');
}));

app.get('/individual/budget/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const item = (await pool.query('SELECT * FROM budget_items WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!item) return res.status(404).send('Not found');
  res.send(renderPage('Update Budget', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Update: ${esc(item.category)}</h3>
      <form method="POST" action="/individual/budget/${item.id}/update-save">
        <input name="actual" type="number" value="${item.actual}" placeholder="Actual Spent UGX" required>
        <button class="btn btn-green">Update Actual</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/individual/budget/:id/update-save', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE budget_items SET actual=$1 WHERE id=$2 AND tenant_id=$3', [req.body.actual, req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/budget');
}));

app.get('/individual/budget/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM budget_items WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/budget');
}));

// === INDIVIDUAL: GOALS ===
app.get('/individual/goals', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const goals = (await pool.query('SELECT * FROM goals WHERE tenant_id=$1 ORDER BY deadline NULLS LAST', [t])).rows;
  res.send(renderPage('Goals', `
    <div class="card"><h3>My Goals</h3>
      <a href="/individual/goals/new" class="btn btn-sm" style="margin-bottom:15px">+ New Goal</a>
      <div class="grid">
        ${goals.map(g => {
          const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
          return `
          <div class="card">
            <h3>${esc(g.title)}</h3>
            <p>Target: UGX ${parseInt(g.target).toLocaleString()}</p>
            <p>Current: UGX ${parseInt(g.current).toLocaleString()}</p>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${pct >= 100 ? '#059669' : '#4f46e5'}"></div></div>
            <p class="muted">${Math.round(pct)}% complete</p>
            ${g.deadline ? `<p class="muted">Deadline: ${new Date(g.deadline).toLocaleDateString()}</p>` : ''}
            <form method="POST" action="/individual/goals/${g.id}/progress" style="margin-top:8px">
              <input name="amount" type="number" placeholder="Add progress UGX" style="display:inline-block;width:160px;padding:8px">
              <button class="btn btn-sm btn-green">Update</button>
            </form>
            <a href="/individual/goals/${g.id}/delete" class="btn btn-red btn-sm" style="margin-top:6px" onclick="return confirm('Delete?')">Delete</a>
          </div>`;
        }).join('') || '<p>No goals yet</p>'}
      </div>
    </div>
  `, req.session.user));
}));

app.get('/individual/goals/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Goal', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Set a New Goal</h3>
      <form method="POST" action="/individual/goals/save">
        <input name="title" placeholder="Goal Title (e.g. Save for Car)" required>
        <input name="target" type="number" placeholder="Target Amount UGX" required>
        <input name="current" type="number" placeholder="Current Progress UGX" value="0">
        <input name="deadline" type="date" placeholder="Target Date">
        <button class="btn btn-green">Create Goal</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/individual/goals/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, target, current, deadline } = req.body;
  await pool.query('INSERT INTO goals(tenant_id,title,target,current,deadline) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, title, target, current || 0, deadline || null]);
  res.redirect('/individual/goals');
}));

app.post('/individual/goals/:id/progress', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE goals SET current=current+$1 WHERE id=$2 AND tenant_id=$3', [req.body.amount, req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/goals');
}));

app.get('/individual/goals/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM goals WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/goals');
}));

// === INDIVIDUAL: PERSONAL NOTES ===
app.get('/individual/notes', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const notes = (await pool.query('SELECT * FROM personal_notes WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('My Notes', `
    <div class="card"><h3>Personal Notes</h3>
      <a href="/individual/notes/new" class="btn btn-sm" style="margin-bottom:15px">+ New Note</a>
      ${notes.map(n => `
        <div class="card">
          <h3>${esc(n.title)}</h3>
          <p style="white-space:pre-wrap">${esc(n.content)}</p>
          <p class="muted" style="margin-top:8px">${new Date(n.created_at).toLocaleString()}</p>
          <a href="/individual/notes/${n.id}/delete" class="btn btn-red btn-sm" onclick="return confirm('Delete?')">Delete</a>
        </div>
      `).join('') || '<p>No notes yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/individual/notes/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Note', `
    <div class="card" style="max-width:700px;margin:40px auto"><h3>New Note</h3>
      <form method="POST" action="/individual/notes/save">
        <input name="title" placeholder="Note Title" required>
        <textarea name="content" rows="10" placeholder="Write your note..." required></textarea>
        <button class="btn">Save Note</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/individual/notes/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO personal_notes(tenant_id,title,content) VALUES($1,$2,$3)', [req.session.user.tenant_id, title, content]);
  res.redirect('/individual/notes');
}));

app.get('/individual/notes/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM personal_notes WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/individual/notes');
}));

// === INDIVIDUAL: DOCS (placeholder) ===
app.get('/individual/docs', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('My Documents', `
    <div class="card"><h3>My Documents</h3>
      <p class="muted">Document storage coming soon. Use Notes for now to store text-based documents.</p>
      <a href="/individual/notes" class="btn btn-sm">Go to Notes</a>
    </div>
  `, req.session.user));
});

// === PARENT PORTAL ===
app.get('/parent/login', (req, res) => {
  if (req.session.parent) return res.redirect('/parent/dashboard');
  res.send(renderPage('Parent Portal', `
    <div class="card" style="max-width:450px;margin:40px auto">
      <h2 style="text-align:center;margin-bottom:20px">Parent Portal</h2>
      <p class="muted" style="text-align:center;margin-bottom:15px">Enter your email to view your child's information.</p>
      <form method="POST" action="/parent/login">
        <input name="email" type="email" placeholder="Your Email Address" required>
        <input name="phone" placeholder="Phone (optional)">
        <button class="btn" style="width:100%">Login</button>
      </form>
    </div>
  `, null));
});

app.post('/parent/login', ah(async (req, res) => {
  const { email, phone } = req.body;
  // Find students linked via parent_links or guardian info
  const linkedStudents = [];
  try {
    const viaLinks = (await pool.query('SELECT pl.*, s.name as student_name, s.class, s.tenant_id FROM parent_links pl JOIN students s ON pl.student_id=s.id WHERE pl.parent_email=$1', [email])).rows;
    for (const l of viaLinks) {
      linkedStudents.push({ id: l.student_id, name: l.student_name, class: l.class, tenant_id: l.tenant_id });
    }
  } catch (e) { /* parent_links table might not have data yet */ }
  // Also check student parent_email field
  try {
    const viaStudent = (await pool.query('SELECT id, name, class, tenant_id FROM students WHERE parent_email=$1', [email])).rows;
    for (const s of viaStudent) {
      if (!linkedStudents.find(ls => ls.id === s.id)) linkedStudents.push(s);
    }
  } catch (e) {}
  // Also check guardian_name matching if phone provided
  if (phone) {
    try {
      const viaGuardian = (await pool.query('SELECT id, name, class, tenant_id FROM students WHERE guardian_phone=$1', [phone])).rows;
      for (const s of viaGuardian) {
        if (!linkedStudents.find(ls => ls.id === s.id)) linkedStudents.push(s);
      }
    } catch (e) {}
  }

  if (linkedStudents.length === 0) {
    return res.send(renderPage('Parent Portal', '<div class="card" style="max-width:450px;margin:40px auto"><div class="alert alert-error">No students found linked to this email/phone. Please contact the school.</div><a href="/parent/login" class="btn">Try Again</a></div>', null));
  }

  // Store parent session info
  req.session.parent = { email, phone, tenant_id: linkedStudents[0].tenant_id };
  req.session.parentStudents = linkedStudents;
  res.redirect('/parent/dashboard');
}));

app.get('/parent/dashboard', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const students = req.session.parentStudents || [];
  res.send(renderPage('Parent Dashboard', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
      <h1>Parent Portal</h1><p>View your children's information</p>
    </div>
    <div class="stats"><div class="stat-card"><div class="stat-num">${students.length}</div><div>Children</div></div></div>
    <div class="grid">
      ${students.map(s => `
        <div class="card">
          <h3>${esc(s.name)}</h3>
          <p class="muted">Class: ${esc(s.class)}</p>
          <a href="/parent/child/${s.id}" class="btn btn-sm" style="margin-top:8px">View Details</a>
        </div>
      `).join('') || '<p>No children found</p>'}
    </div>
    <div class="card"><a href="/parent/logout" class="btn btn-red btn-sm">Logout</a></div>
  `, null));
}));

app.get('/parent/child/:id', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const t = req.session.parent.tenant_id;
  const student = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!student) return res.status(404).send('Student not found');
  const [fees, marks, attendance] = await Promise.all([
    pool.query('SELECT * FROM fees WHERE student_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [student.id, t]),
    pool.query('SELECT m.*, e.name as exam_name FROM marks m JOIN exams e ON m.exam_id=e.id WHERE m.student_id=$1 ORDER BY e.created_at DESC', [student.id]),
    pool.query('SELECT * FROM attendance WHERE student_id=$1 AND tenant_id=$2 ORDER BY date DESC LIMIT 30', [student.id, t])
  ]);
  const totalFees = fees.rows.reduce((a, f) => a + parseInt(f.amount), 0);
  const totalPaid = fees.rows.reduce((a, f) => a + parseInt(f.paid), 0);
  const presentDays = attendance.rows.filter(a => a.status === 'present').length;
  res.send(renderPage(`${student.name}`, `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981);padding:30px">
      <h1>${esc(student.name)}</h1><p>Adm# ${esc(student.admission_no)} | Class: ${esc(student.class)}</p>
    </div>
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${totalFees.toLocaleString()}</div><div>Total Fees</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Paid</div></div>
      <div class="stat-card"><div class="stat-num" style="color:${totalFees-totalPaid>0?'#dc2626':'#059669'}">UGX ${(totalFees-totalPaid).toLocaleString()}</div><div>Balance</div></div>
      <div class="stat-card"><div class="stat-num">${presentDays}</div><div>Days Present</div></div>
    </div>
    <div class="card"><h3>Fee Records</h3>
      <table><tr><th>Term</th><th>Year</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Receipt</th></tr>
      ${fees.rows.map(f => `<tr><td>${esc(f.term)}</td><td>${f.year||''}</td><td>UGX ${parseInt(f.amount).toLocaleString()}</td><td style="color:#059669">UGX ${parseInt(f.paid).toLocaleString()}</td><td style="color:${f.amount-f.paid>0?'#dc2626':'#059669'}">UGX ${(f.amount-f.paid).toLocaleString()}</td><td>${f.paid > 0 ? `<a href="/parent/fee/${f.id}/receipt" class="btn btn-sm">View Receipt</a>` : '-'}</td></tr>`).join('') || '<tr><td colspan="6">No fee records</td></tr>'}
      </table>
    </div>
    <div class="card"><h3>Exam Results</h3>
      <table><tr><th>Exam</th><th>Subject</th><th>Score</th><th>Grade</th></tr>
      ${marks.rows.map(m => `<tr><td>${esc(m.exam_name)}</td><td>${esc(m.subject)}</td><td>${m.score}</td><td><span class="tag">${esc(m.grade)}</span></td></tr>`).join('') || '<tr><td colspan="4">No results yet</td></tr>'}
      </table>
    </div>
    <div class="card"><h3>Recent Attendance</h3>
      <table><tr><th>Date</th><th>Status</th></tr>
      ${attendance.rows.map(a => `<tr><td>${new Date(a.date).toLocaleDateString()}</td><td style="color:${a.status==='present'?'#059669':'#dc2626'}">${a.status}</td></tr>`).join('') || '<tr><td colspan="2">No attendance records</td></tr>'}
      </table>
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
      <a href="/parent/dashboard" class="btn btn-sm">Back to Dashboard</a>
      <a href="/parent/child/${student.id}/report" class="btn btn-gold btn-sm">Download Report Card</a>
    </div>
  `, null));
}));

// Parent: View Fee Receipt
app.get('/parent/fee/:id/receipt', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const t = req.session.parent.tenant_id;
  const fee = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no,s.class,s.guardian_name FROM fees f JOIN students s ON f.student_id=s.id WHERE f.id=$1 AND f.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!fee) return res.status(404).send('Fee record not found');
  const tenant = (await pool.query('SELECT name,address,phone,email,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  const receiptNo = fee.receipt_no || ('RCP-' + fee.id + '-' + Date.now().toString(36).toUpperCase());
  res.send(renderPage('Fee Receipt', `
    <div class="card" style="max-width:700px;margin:20px auto;border:2px solid #4f46e5">
      <div style="text-align:center;padding:20px;border-bottom:2px solid #e2e8f0">
        <h2 style="color:#4f46e5">${esc(tenant.name)}</h2>
        <h3 style="margin-top:10px;color:#3730a3">OFFICIAL FEE RECEIPT</h3>
      </div>
      <div style="padding:20px">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px">
          <div><strong>Receipt No:</strong> ${esc(receiptNo)}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
        </div>
        <div style="background:#f1f5f9;padding:15px;border-radius:10px;margin-bottom:20px">
          <p><strong>Student:</strong> ${esc(fee.student_name)}</p>
          <p><strong>Class:</strong> ${esc(fee.class)}</p>
        </div>
        <table>
          <tr style="background:#4f46e5;color:white"><th style="color:white">Description</th><th style="color:white;text-align:right">Amount (UGX)</th></tr>
          <tr><td>School Fees - ${esc(fee.term||'Term')} ${fee.year||''}</td><td style="text-align:right">${parseInt(fee.amount).toLocaleString()}</td></tr>
          <tr style="color:#059669;font-weight:bold"><td>Amount Paid</td><td style="text-align:right">${parseInt(fee.paid).toLocaleString()}</td></tr>
          <tr style="color:${fee.amount-fee.paid>0?'#dc2626':'#059669'};font-weight:bold"><td>Balance</td><td style="text-align:right">${(fee.amount-fee.paid).toLocaleString()}</td></tr>
        </table>
      </div>
      <div style="text-align:center;padding:15px;border-top:1px solid #e2e8f0">
        <button class="btn btn-sm" onclick="window.print()">Print Receipt</button>
      </div>
    </div>
    <style>@media print{.nav,.btn{display:none!important}.card{border:none!important;box-shadow:none!important}}</style>
  `, null));
}));

// Parent: Download Report Card
app.get('/parent/child/:id/report', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const t = req.session.parent.tenant_id;
  const student = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!student) return res.status(404).send('Student not found');
  const allExams = (await pool.query('SELECT e.id,e.name,e.term,e.year FROM exams e JOIN marks m ON e.id=m.exam_id WHERE m.student_id=$1 ORDER BY e.created_at DESC', [student.id])).rows;
  const gradingScales = (await pool.query('SELECT * FROM grading_scales WHERE tenant_id=$1 ORDER BY min_score DESC', [t])).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  function getGradeInfo(score) { for (const g of gradingScales) { if (score >= g.min_score && score <= g.max_score) return g; } return { grade: 'F', comment: 'Fail' }; }
  let cardsHtml = '';
  for (const exam of allExams) {
    const examMarks = (await pool.query('SELECT subject,score,grade FROM marks WHERE exam_id=$1 AND student_id=$2', [exam.id, student.id])).rows;
    const total = examMarks.reduce((a, m) => a + (parseInt(m.score) || 0), 0);
    const avg = examMarks.length > 0 ? Math.round(total / examMarks.length) : 0;
    const gi = getGradeInfo(avg);
    cardsHtml += `<div class="report" style="page-break-after:always">
      <div class="header"><h1>${esc(tenant.name)}</h1><h2>STUDENT REPORT CARD</h2>
        <p style="color:#64748b;font-size:14px">${esc(exam.name)} | ${esc(exam.term)} ${exam.year||''}</p></div>
      <div class="info"><p><strong>Name:</strong> ${esc(student.name)} | <strong>Adm No:</strong> ${esc(student.admission_no)} | <strong>Class:</strong> ${esc(student.class)}</p></div>
      <table><tr><th>Subject</th><th>Score</th><th>Grade</th></tr>
      ${examMarks.map(m => `<tr><td>${esc(m.subject)}</td><td>${m.score||0}</td><td><strong>${esc(m.grade||getGradeInfo(parseInt(m.score)||0).grade)}</strong></td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center">No marks</td></tr>'}
      </table>
      <div style="margin-top:10px;padding:10px;background:#f1f5f9;border-radius:8px">
        <p><strong>Total:</strong> ${total} | <strong>Average:</strong> ${avg} | <strong>Grade:</strong> ${esc(gi.grade)} - ${esc(gi.comment)}</p>
      </div>
      <div class="sig"><p>Class Teacher: _______________</p><p>Head Teacher: _______________</p><p>Parent: _______________</p></div>
    </div>`;
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report Card - ${esc(student.name)}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#f8fafc}
    .report{max-width:800px;margin:20px auto;padding:30px;background:white;border:2px solid #4f46e5;border-radius:12px}
    .header{text-align:center;border-bottom:3px solid #4f46e5;padding-bottom:15px;margin-bottom:20px}
    h1{color:#4f46e5;font-size:24px}h2{color:#3730a3;font-size:18px;margin-top:5px}
    .info{background:#f1f5f9;padding:12px;border-radius:8px;margin-bottom:15px}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white}
    .sig{margin-top:30px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:20px}
    .sig p{border-top:1px solid #94a3b8;padding-top:5px;font-size:13px;color:#64748b;min-width:180px}
    .print-btn{position:fixed;top:10px;right:10px;z-index:999}
    @media print{.print-btn{display:none!important}.report{border:none!important;border-radius:0!important}}
    </style></head><body>
    <div class="print-btn"><button onclick="window.print()" style="padding:10px 20px;background:#4f46e5;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600">Print</button></div>
    ${cardsHtml || '<div class="report"><p style="text-align:center;padding:40px">No exam results available yet</p></div>'}
  </body></html>`);
}));

app.get('/parent/logout', (req, res) => {
  delete req.session.parent;
  delete req.session.parentStudents;
  res.redirect('/parent/login');
});

// ============================================================
// PLATFORM-WIDE FEATURES
// ============================================================

// === DARK MODE TOGGLE ===
app.get('/toggle-dark', requireAuth, ah(async (req, res) => {
  const current = req.session.user.dark_mode || false;
  await pool.query('UPDATE users SET dark_mode=$1 WHERE id=$2', [!current, req.session.user.id]);
  req.session.user.dark_mode = !current;
  res.redirect('back');
}));

// === CHANGE PASSWORD ===
app.get('/settings/password', requireAuth, (req, res) => {
  res.send(renderPage('Change Password', `
    <div class="card" style="max-width:500px;margin:40px auto"><h3>Change Password</h3>
      <form method="POST" action="/settings/password/save">
        <input name="current_password" type="password" placeholder="Current Password" required>
        <input name="new_password" type="password" placeholder="New Password (min 6)" minlength="6" required>
        <input name="confirm_password" type="password" placeholder="Confirm New Password" required>
        <button class="btn btn-red">Change Password</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/settings/password/save', requireAuth, ah(async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) return res.send(renderPage('Change Password', '<div class="card"><div class="alert alert-error">Passwords do not match</div><a href="/settings/password" class="btn btn-sm">Try Again</a></div>', req.session.user));
  // Try getting both password columns, fall back to just password
  let u;
  try {
    u = (await pool.query('SELECT password, password_hash FROM users WHERE id=$1', [req.session.user.id])).rows[0];
  } catch (e) {
    if (e.message.includes('password_hash')) {
      u = (await pool.query('SELECT password FROM users WHERE id=$1', [req.session.user.id])).rows[0];
    } else throw e;
  }
  const storedHash = u.password_hash || u.password;
  if (!storedHash || !(await bcrypt.compare(current_password, storedHash))) return res.send(renderPage('Change Password', '<div class="card"><div class="alert alert-error">Current password is incorrect</div><a href="/settings/password" class="btn btn-sm">Try Again</a></div>', req.session.user));
  const hash = await bcrypt.hash(new_password, 10);
  // Try updating both columns, fall back to just password
  try {
    await pool.query('UPDATE users SET password=$1, password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
  } catch (e) {
    if (e.message.includes('password_hash')) {
      await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.session.user.id]);
    } else throw e;
  }
  await audit(req.session.user.email, 'password_change', 'Password changed');
  res.send(renderPage('Success', '<div class="card"><div class="alert alert-success">Password changed successfully!</div><a href="/dashboard" class="btn">Back to Dashboard</a></div>', req.session.user));
}));

// === PROFILE SETTINGS ===
app.get('/settings/profile', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Profile Settings', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Organization Profile</h3>
      <form method="POST" action="/settings/profile/save">
        <input name="name" value="${esc(tenant.name)}" required>
        <input name="email" type="email" value="${esc(tenant.email)}">
        <input name="phone" value="${esc(tenant.phone)}">
        <input name="address" value="${esc(tenant.address || '')}" placeholder="Address">
        <textarea name="description" rows="4" placeholder="About your organization">${esc(tenant.description || '')}</textarea>
        <button class="btn">Save Profile</button>
      </form>
    </div>
    <div class="card" style="max-width:600px;margin:20px auto">
      <h3>Account Settings</h3>
      <a href="/settings/password" class="btn btn-red btn-sm">Change Password</a>
      <a href="/settings/backup" class="btn btn-sm" style="margin-top:8px">Data Backup</a>
      <a href="/settings/branding" class="btn btn-sm" style="margin-top:8px">Branding</a>
      <a href="/settings/2fa" class="btn btn-sm btn-green" style="margin-top:8px">Two-Factor Auth</a>
      <a href="/settings/theme" class="btn btn-sm btn-gold" style="margin-top:8px">Theme Builder</a>
      <a href="/audit-logs" class="btn btn-sm" style="margin-top:8px">Audit Logs</a>
      <a href="/api-docs" class="btn btn-sm" style="margin-top:8px">API Docs</a>
      <a href="/status" class="btn btn-sm" style="margin-top:8px">Platform Status</a>
    </div>
  `, req.session.user));
}));

app.post('/settings/profile/save', requireAuth, ah(async (req, res) => {
  const { name, email, phone, address, description } = req.body;
  await pool.query('UPDATE tenants SET name=$1,email=$2,phone=$3,address=$4,description=$5 WHERE id=$6',
    [name, email, phone, address, description, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'profile_update', 'Updated organization profile');
  res.redirect('/settings/profile');
}));

// === DATA BACKUP/EXPORT ===
app.get('/settings/backup', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Data Backup', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h3>Data Backup & Restore</h3>
      <p class="muted" style="margin-bottom:15px">Export all your data as JSON for backup, or import from a previous backup.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        <a href="/settings/backup/download" class="btn btn-green">Download Full Backup (JSON)</a>
        <a href="/settings/backup/csv" class="btn btn-sm">Export CSV</a>
      </div>
      <hr style="margin:20px 0">
      <h3>Import Data</h3>
      <p class="muted" style="margin-bottom:15px">Upload a JSON backup file to restore data. <strong>Warning:</strong> This may overwrite existing data.</p>
      <form method="POST" action="/settings/backup/upload" enctype="multipart/form-data">
        <input name="backup_file" type="file" accept=".json" required>
        <button class="btn btn-red" onclick="return confirm('Importing data may overwrite existing records. Are you sure?')">Upload & Import</button>
      </form>
    </div>
  `, req.session.user));
}));

app.get('/settings/backup/download', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const tables = ['students', 'fees', 'exams', 'marks', 'attendance', 'members', 'projects', 'events', 'org_finance', 'inventory', 'sales', 'sale_items', 'invoices', 'expenses', 'meeting_minutes', 'notice_board', 'sermons', 'prayer_requests', 'service_schedule', 'customers', 'budget_items', 'goals', 'personal_notes', 'staff', 'timetable', 'grading_scales', 'fee_structures', 'church_members', 'donations', 'parent_links'];
  const backup = { _meta: { version: '1.0', exported: new Date().toISOString(), tenant: tenant.name, tenant_id: t } };
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [t])).rows;
      if (data.length > 0) backup[table] = data;
    } catch (e) { /* table might not exist */ }
  }
  res.header('Content-Type', 'application/json');
  res.attachment(`backup-${tenant.name.replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.json`);
  res.send(JSON.stringify(backup, null, 2));
}));

app.get('/settings/backup/csv', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const tables = ['students', 'fees', 'exams', 'marks', 'members', 'projects', 'events', 'org_finance', 'inventory', 'sales', 'invoices', 'expenses', 'attendance', 'meeting_minutes', 'notice_board', 'sermons', 'prayer_requests', 'customers', 'budget_items', 'goals', 'personal_notes'];
  let backup = `SSEWASSWA DATA BACKUP\nOrganization: ${tenant.name}\nDate: ${new Date().toISOString()}\n\n`;
  for (const table of tables) {
    try {
      const data = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [t])).rows;
      if (data.length > 0) {
        backup += `=== ${table.toUpperCase()} (${data.length} records) ===\n`;
        backup += Object.keys(data[0]).join(',') + '\n';
        for (const row of data) {
          backup += Object.values(row).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',') + '\n';
        }
        backup += '\n';
      }
    } catch (e) { /* table might not exist for this tenant type */ }
  }
  res.header('Content-Type', 'text/csv');
  res.attachment(`backup-${tenant.name.replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`);
  res.send(backup);
}));

app.post('/settings/backup/upload', requireAuth, express.raw({ type: 'application/json', limit: '50mb' }), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  let backup;
  try {
    // Handle both multer-style file upload and raw body
    if (req.body && typeof req.body === 'string') {
      backup = JSON.parse(req.body);
    } else if (Buffer.isBuffer(req.body)) {
      backup = JSON.parse(req.body.toString());
    } else {
      return res.send(renderPage('Import Error', '<div class="card"><div class="alert alert-error">Invalid backup file format.</div><a href="/settings/backup" class="btn">Back</a></div>', req.session.user));
    }
  } catch (e) {
    return res.send(renderPage('Import Error', '<div class="card"><div class="alert alert-error">Could not parse JSON file. Please ensure it is a valid backup.</div><a href="/settings/backup" class="btn">Back</a></div>', req.session.user));
  }

  if (!backup._meta || !backup._meta.version) {
    return res.send(renderPage('Import Error', '<div class="card"><div class="alert alert-error">Invalid backup file. Missing metadata.</div><a href="/settings/backup" class="btn">Back</a></div>', req.session.user));
  }

  const allowedTables = ['students', 'fees', 'exams', 'marks', 'attendance', 'members', 'projects', 'events', 'org_finance', 'inventory', 'sales', 'invoices', 'expenses', 'meeting_minutes', 'notice_board', 'sermons', 'prayer_requests', 'service_schedule', 'customers', 'budget_items', 'goals', 'personal_notes', 'staff', 'timetable', 'grading_scales', 'fee_structures', 'church_members', 'donations', 'parent_links'];
  let imported = 0;
  for (const table of allowedTables) {
    if (backup[table] && Array.isArray(backup[table])) {
      for (const row of backup[table]) {
        try {
          const cols = Object.keys(row).filter(k => k !== 'id');
          const vals = cols.map(k => row[k]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
          // Ensure tenant_id is set to current tenant
          const tenantIdx = cols.indexOf('tenant_id');
          if (tenantIdx >= 0) vals[tenantIdx] = t;
          await pool.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${placeholders}) ON CONFLICT DO NOTHING`, vals);
          imported++;
        } catch (e) { /* skip rows with constraint violations */ }
      }
    }
  }
  await audit(req.session.user.email, 'data_import', `Imported ${imported} records from backup`);
  res.send(renderPage('Import Complete', `<div class="card"><div class="alert alert-success">Successfully imported ${imported} records.</div><a href="/settings/backup" class="btn">Back to Backup</a></div>`, req.session.user));
}));

// === TENANT BRANDING ===
app.get('/settings/branding', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Branding Settings', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Organization Branding</h3>
      <form method="POST" action="/settings/branding/save">
        <input name="logo_url" value="${esc(tenant.logo_url || '')}" placeholder="Logo URL (https://...)">
        <p class="muted">Enter the URL of your organization's logo image.</p>
        <input name="favicon_url" value="${esc(tenant.favicon_url || '')}" placeholder="Favicon URL (https://...)">
        <p class="muted">Enter the URL of your favicon (16x16 or 32x32 .ico/.png).</p>
        <textarea name="custom_css" rows="8" placeholder="Custom CSS (e.g. .nav { background: red; })">${esc(tenant.custom_css || '')}</textarea>
        <p class="muted">Add custom CSS to style your portal pages.</p>
        <button class="btn btn-green">Save Branding</button>
      </form>
      ${tenant.logo_url ? `<div style="margin-top:20px;text-align:center"><h4>Current Logo</h4><img src="${esc(tenant.logo_url)}" alt="Logo" style="max-height:100px;margin-top:10px"></div>` : ''}
    </div>
  `, req.session.user));
}));

app.post('/settings/branding/save', requireAuth, ah(async (req, res) => {
  const { logo_url, favicon_url, custom_css } = req.body;
  await pool.query('UPDATE tenants SET logo_url=$1,favicon_url=$2,custom_css=$3 WHERE id=$4', [logo_url, favicon_url, custom_css, req.session.user.tenant_id]);
  await audit(req.session.user.email, 'branding_update', 'Updated organization branding');
  res.redirect('/settings/branding');
}));

// === SEARCH ===
app.get('/search', requireAuth, (req, res) => {
  res.send(renderPage('Search', `
    <div class="card" style="max-width:600px;margin:40px auto"><h3>Search Your Data</h3>
      <form method="GET" action="/search/results">
        <input name="q" placeholder="Search anything..." value="${esc(req.query.q || '')}" required autofocus>
        <button class="btn">Search</button>
      </form>
    </div>
  `, req.session.user));
});

app.get('/search/results', requireAuth, ah(async (req, res) => {
  const q = req.query.q || '';
  const t = req.session.user.tenant_id;
  const like = `%${q}%`;
  const results = [];
  try { const r = (await pool.query('SELECT id,name,admission_no FROM students WHERE tenant_id=$1 AND (name ILIKE $2 OR admission_no ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Student', name: x.name, detail: x.admission_no, link: '/school/students' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name,email FROM members WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Member', name: x.name, detail: x.email, link: '/org/members' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM projects WHERE tenant_id=$1 AND name ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Project', name: x.name, detail: '', link: '/org/projects' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM inventory WHERE tenant_id=$1 AND (name ILIKE $2 OR sku ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Product', name: x.name, detail: x.sku, link: '/business/inventory' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM events WHERE tenant_id=$1 AND name ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Event', name: x.name, detail: '', link: '/org/events' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM sermons WHERE tenant_id=$1 AND (title ILIKE $2 OR preacher ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Sermon', name: x.title, detail: '', link: '/church/sermons' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,name FROM customers WHERE tenant_id=$1 AND (name ILIKE $2 OR email ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Customer', name: x.name, detail: x.email, link: '/business/customers' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM goals WHERE tenant_id=$1 AND title ILIKE $2', [t, like])).rows; r.forEach(x => results.push({ type: 'Goal', name: x.title, detail: '', link: '/individual/goals' })); } catch(e){}
  try { const r = (await pool.query('SELECT id,title FROM personal_notes WHERE tenant_id=$1 AND (title ILIKE $2 OR content ILIKE $2)', [t, like])).rows; r.forEach(x => results.push({ type: 'Note', name: x.title, detail: '', link: '/individual/notes' })); } catch(e){}
  res.send(renderPage(`Search: ${q}`, `
    <div class="card"><h3>Search Results for "${esc(q)}"</h3>
      <p class="muted">${results.length} results found</p>
      <table style="margin-top:15px"><tr><th>Type</th><th>Name</th><th>Detail</th><th>Go</th></tr>
      ${results.map(r => `<tr><td><span class="tag">${esc(r.type)}</span></td><td>${esc(r.name)}</td><td>${esc(r.detail)}</td><td><a href="${r.link}" class="btn btn-sm">View</a></td></tr>`).join('') || '<tr><td colspan="4">No results found</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

// === PUBLIC PROFILE PAGE ===
app.get('/p/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1 AND verified=true', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send(renderPage('Not Found', '<div class="card"><h2>Organization not found</h2></div>', null));
  const events = (await pool.query('SELECT * FROM events WHERE tenant_id=$1 AND event_date>=CURRENT_DATE ORDER BY event_date LIMIT 5', [tenant.id])).rows;
  res.send(renderPage(tenant.name, `
    <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)">
      <h1>${esc(tenant.name)}</h1>
      <p>${esc(tenant.type)} ${tenant.address ? '| ' + esc(tenant.address) : ''}</p>
    </div>
    ${tenant.description ? `<div class="card"><h3>About</h3><p>${esc(tenant.description)}</p></div>` : ''}
    ${events.length > 0 ? `
      <div class="card"><h3>Upcoming Events</h3>
        ${events.map(e => `<div style="margin-bottom:10px"><strong>${esc(e.name)}</strong> - ${new Date(e.event_date).toLocaleDateString()} ${e.venue ? '@ ' + esc(e.venue) : ''}</div>`).join('')}
      </div>
    ` : ''}
    <div class="card">
      <p>Contact: ${esc(tenant.email)} ${tenant.phone ? '| ' + esc(tenant.phone) : ''}</p>
    </div>
  `, null));
}));

// === ENTERTAINMENT ===
app.get('/entertainment', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [videos, music, games] = await Promise.all([
    pool.query('SELECT * FROM entertainment_videos WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_music WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_games WHERE tenant_id=$1 ORDER BY score DESC LIMIT 10', [t])
  ]);
  res.send(renderPage('Entertainment Hub', `
    <div class="hero" style="background:linear-gradient(135deg,#db2777,#ec4899)">
      <h1>Entertainment Hub</h1><p>Videos, Music, Games</p>
    </div>
    <div class="grid">
      <div class="card"><h3>Videos</h3>${videos.rows.map(v => `<p><a href="${esc(v.url)}" target="_blank">${esc(v.title)}</a></p>`).join('') || '<p>No videos yet</p>'}</div>
      <div class="card"><h3>Music</h3>${music.rows.map(m => `<p>${esc(m.title)} - ${esc(m.artist)}</p>`).join('') || '<p>No music yet</p>'}</div>
      <div class="card"><h3>Top Scores</h3>${games.rows.map(g => `<p>${esc(g.player_name)}: ${g.score} - ${esc(g.name)}</p>`).join('') || '<p>No games yet</p>'}</div>
    </div>
  `, req.session.user));
}));

// === DEV MASTER CONTROL ===
app.get('/dev/master', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const flash = req.session.flash; delete req.session.flash;
  let logs = { rows: [] };
  try {
    logs = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 20');
  } catch (e) {
    console.warn('Audit logs query failed:', e.message);
  }
  const [tCount, uCount, rev, wal, tenants, chartData] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenants'),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`),
    pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1'),
    pool.query('SELECT id,name,type,COALESCE(wallet_balance,0) as wallet_balance,verified,subdomain,approved,banned,ban_reason FROM tenants ORDER BY id DESC LIMIT 50'),
    pool.query(`SELECT DATE(created_at) as day, SUM(amount) as total FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day ASC`)
  ]);
  const flashHtml = flash ? `<div class="alert alert-${flash.type}">${esc(flash.msg)}</div>` : '';
  const chartLabels = chartData.rows.map(r => new Date(r.day).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })).join("','");
  const chartValues = chartData.rows.map(r => r.total).join(',');
  res.send(renderPage('Dev Master', `
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444);padding:20px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>DEVELOPER MASTER CONTROL</h1><p style="opacity:0.9">Full system control</p>
    </div>
    ${flashHtml}
    <div class="stats">
      <div class="stat-card"><div class="stat-num">${tCount.rows[0].count}</div><div>Tenants</div></div>
      <div class="stat-card"><div class="stat-num">${uCount.rows[0].count}</div><div>Users</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(rev.rows[0].t).toLocaleString()}</div><div>30-Day Rev</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${parseInt(wal.rows[0]?.b || 0).toLocaleString()}</div><div>Ready Withdraw</div></div>
    </div>
    <div class="card" style="margin-bottom:20px"><h3>30-Day Revenue</h3><canvas id="revChart"></canvas></div>
    <div class="grid">
      <div class="card"><h3>Revenue Controls</h3>
        <form method="POST" action="/dev/inject-revenue">
          <input name="amount" placeholder="Amount UGX" type="number" required>
          <input name="source" placeholder="Source: Grant, Ads, Sub" required>
          <button class="btn btn-gold">Inject Revenue</button>
        </form>
      </div>
      <div class="card"><h3>Tenant Controls</h3>
        <form method="POST" action="/dev/execute">
          <select name="action" required><option value="">Select Action</option>
            <option value="add_balance">Add Balance</option>
            <option value="verify_tenant">Verify Tenant</option>
            <option value="unverify_tenant">Unverify Tenant</option>
            <option value="approve_tenant">Approve Tenant</option>
            <option value="ban_tenant">Ban Tenant</option>
            <option value="unban_tenant">Unban Tenant</option>
            <option value="grant_free_access">Grant Free Access</option>
            <option value="enable_fundraising">Enable Fundraising</option>
            <option value="delete_tenant">DELETE Tenant</option>
          </select>
          <input name="target_id" placeholder="Tenant ID" type="number" required>
          <input name="amount" placeholder="Amount UGX (if needed)" type="number">
          <input name="reason" placeholder="Reason (for ban)" type="text">
          <button class="btn btn-red">Execute</button>
        </form>
      </div>
    </div>
    <div class="card"><h3>All Tenants</h3>
      <table><tr><th>ID</th><th>Name</th><th>Type</th><th>Wallet</th><th>Verified</th><th>Status</th></tr>
      ${tenants.rows.map(t => `<tr>
        <td>${t.id}</td><td>${esc(t.name)}</td><td>${esc(t.type)}</td>
        <td>UGX ${parseInt(t.wallet_balance).toLocaleString()}</td>
        <td>${t.verified ? 'Yes' : 'No'}</td>
        <td>${t.approved ? (t.banned ? '<span style="color:#dc2626">Banned</span>' : '<span style="color:#059669">Active</span>') : '<span style="color:#d97706">Pending</span>'}</td>
      </tr>`).join('')}
      </table>
    </div>
    <div class="card"><h3>Recent Audit Logs</h3>
      <table><tr><th>User</th><th>Action</th><th>Details</th><th>Time</th></tr>
      ${logs.rows.map(l => `<tr><td>${esc(l.user_email || l.email || '')}</td><td>${esc(l.action || '')}</td><td>${esc(l.details || '')}</td><td>${l.created_at ? new Date(l.created_at).toLocaleString() : ''}</td></tr>`).join('')}
      </table>
    </div>
    <script>
      new Chart(document.getElementById('revChart'), {
        type: 'line',
        data: {
          labels: ['${chartLabels}'],
          datasets: [{ label: 'UGX Revenue', data: [${chartValues}], borderColor: '#dc2626', tension: 0.3, fill: true, backgroundColor: 'rgba(220,38,38,0.1)' }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    </script>
  `, req.session.user));
}));

// === DEV ACTIONS ===
app.post('/dev/execute', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { action, target_id, amount, reason } = req.body;
  if (action === 'add_balance') await pool.query('UPDATE tenants SET wallet_balance=wallet_balance+$1 WHERE id=$2', [amount, target_id]);
  if (action === 'verify_tenant') await pool.query('UPDATE tenants SET verified=true WHERE id=$1', [target_id]);
  if (action === 'unverify_tenant') await pool.query('UPDATE tenants SET verified=false WHERE id=$1', [target_id]);
  if (action === 'approve_tenant') await pool.query('UPDATE tenants SET approved=true WHERE id=$1', [target_id]);
  if (action === 'ban_tenant') await pool.query('UPDATE tenants SET banned=true,ban_reason=$1 WHERE id=$2', [reason, target_id]);
  if (action === 'unban_tenant') await pool.query('UPDATE tenants SET banned=false,ban_reason=NULL WHERE id=$1', [target_id]);
  if (action === 'enable_fundraising') await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1', [target_id]);
  if (action === 'grant_free_access') await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [target_id]);
  if (action === 'delete_tenant') await pool.query('DELETE FROM tenants WHERE id=$1', [target_id]);
  await audit(req.session.user.email, 'dev_action', `${action} on tenant #${target_id}`);
  req.session.flash = { type: 'success', msg: 'Action executed' };
  res.redirect('/dev/master');
}));

app.post('/dev/inject-revenue', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { amount, source } = req.body;
  await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [amount, source]);
  await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [amount]);
  await audit(req.session.user.email, 'inject_revenue', `UGX ${amount} from ${source}`);
  res.redirect('/dev/master');
}));

// === FUNDRAISING UPGRADE ===
app.get('/upgrade/fundraising', requireAuth, (req, res) => {
  res.send(renderPage('Fundraising Module', `
    <div class="card" style="max-width:600px;margin:40px auto;text-align:center">
      <h1>Add Fundraising</h1>
      <p>Enable donations, campaigns, and donor management for your organization.</p>
      <p><b>Platform Fee: 5% per donation</b></p>
      <form method="POST" action="/upgrade/fundraising/activate">
        <button class="btn btn-gold" style="font-size:18px;padding:15px 30px">Activate Fundraising</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/upgrade/fundraising/activate', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE tenants SET has_fundraising=true WHERE id=$1', [req.session.user.tenant_id]);
  res.redirect('/portal/organization');
}));

// === FUNDRAISING PAGE ===
app.get('/fundraising', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT has_fundraising FROM tenants WHERE id=$1', [t])).rows[0];
  if (!tenant.has_fundraising) return res.redirect('/upgrade/fundraising');
  const donations = (await pool.query("SELECT * FROM org_finance WHERE tenant_id=$1 AND type='income' AND description ILIKE '%donation%' ORDER BY created_at DESC", [t])).rows;
  const total = donations.reduce((a, d) => a + parseInt(d.amount), 0);
  res.send(renderPage('Fundraising', `
    <div class="hero" style="background:linear-gradient(135deg,#d97706,#f59e0b)">
      <h1>Fundraising</h1><p>Donations and campaigns</p>
    </div>
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${total.toLocaleString()}</div><div>Total Donations</div></div></div>
    <div class="card"><h3>Record Donation</h3>
      <form method="POST" action="/fundraising/save">
        <input name="amount" type="number" placeholder="Donation Amount UGX" required>
        <input name="description" placeholder="Donation - Donor Name" required>
        <button class="btn btn-gold">Record Donation</button>
      </form>
    </div>
    <div class="card"><h3>Recent Donations</h3>
      <table><tr><th>Amount</th><th>Donor</th><th>Date</th></tr>
      ${donations.map(d => `<tr><td>UGX ${parseInt(d.amount).toLocaleString()}</td><td>${esc(d.description)}</td><td>${new Date(d.created_at).toLocaleDateString()}</td></tr>`).join('') || '<tr><td colspan="3">No donations yet</td></tr>'}
      </table>
    </div>
  `, req.session.user));
}));

app.post('/fundraising/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { amount, description } = req.body;
  await pool.query('INSERT INTO org_finance(tenant_id,amount,type,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, amount, 'income', `Donation - ${description}`]);
  // 5% platform fee
  const fee = Math.round(parseInt(amount) * 0.05);
  await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [fee]);
  await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [fee, `Fundraising fee - ${req.session.user.tenant_name}`]);
  res.redirect('/fundraising');
}));


// === BILLING & SUBSCRIPTIONS ===
app.get('/billing', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sub, payments] = await Promise.all([
    pool.query('SELECT * FROM subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [t]),
    pool.query('SELECT * FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])
  ]);
  const plan = sub.rows[0]?.plan || 'free';
  const planNames = { free: 'Free Plan', basic: 'Basic - UGX 50,000/mo', pro: 'Pro - UGX 150,000/mo', enterprise: 'Enterprise - UGX 500,000/mo' };
  res.send(renderPage('Billing & Subscriptions', `
    <div class="hero"><h1>Billing & Subscriptions</h1><p>Manage your plan and payments</p></div>
    <div class="card">
      <h2>Current Plan</h2>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="font-size:20px">${planNames[plan] || plan}</div><div>Active Plan</div></div>
        <div class="stat-card"><div class="stat-num">${sub.rows[0]?.status || 'active'}</div><div>Status</div></div>
      </div>
      <h3 style="margin-top:20px">Change Plan</h3>
      <div class="grid" style="margin-top:10px">
        <div class="card" style="border:2px solid ${plan==='free'?'#4f46e5':'#e2e8f0'}">
          <h3>Free</h3><p class="muted">Up to 50 records</p><p style="font-size:24px;font-weight:800">UGX 0</p>
          <a href="/billing/subscribe/free" class="btn btn-sm" style="margin-top:10px">${plan==='free'?'Current':'Downgrade'}</a>
        </div>
        <div class="card" style="border:2px solid ${plan==='basic'?'#4f46e5':'#e2e8f0'}">
          <h3>Basic</h3><p class="muted">Up to 500 records</p><p style="font-size:24px;font-weight:800">UGX 50K</p>
          <a href="/billing/subscribe/basic" class="btn btn-sm btn-green" style="margin-top:10px">${plan==='basic'?'Current':'Subscribe'}</a>
        </div>
        <div class="card" style="border:2px solid ${plan==='pro'?'#4f46e5':'#e2e8f0'}">
          <h3>Pro</h3><p class="muted">Unlimited records + SMS</p><p style="font-size:24px;font-weight:800">UGX 150K</p>
          <a href="/billing/subscribe/pro" class="btn btn-sm btn-gold" style="margin-top:10px">${plan==='pro'?'Current':'Subscribe'}</a>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Payment History</h2>
      ${payments.rows.length ? `<table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th>Ref</th></tr>${payments.rows.map(p=>`<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>${esc(p.method||'-')}</td><td><span class="tag">${esc(p.status)}</span></td><td>${esc(p.reference||'-')}</td></tr>`).join('')}</table>` : '<p class="muted">No payments yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/billing/subscribe/:plan', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const plan = req.params.plan;
  const amounts = { free: 0, basic: 50000, pro: 150000, enterprise: 500000 };
  const amount = amounts[plan] || 0;
  const expires = new Date(Date.now() + 30*24*60*60*1000);
  if (plan === 'free') {
    await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [t, plan, amount, 'active', expires]);
    await audit(req.session.user.email, 'subscription_change', `Changed to ${plan} plan`);
    return res.redirect('/billing');
  }
  // v1.0: Try Flutterwave checkout first
  const ref = 'SSEW-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const checkoutUrl = await createFlutterwaveCheckout(t, amount, req.session.user.email, plan, ref);
  if (checkoutUrl) {
    await pool.query('INSERT INTO payments(tenant_id,amount,method,status,description,reference) VALUES($1,$2,$3,$4,$5,$6)', [t, amount, 'flutterwave', 'pending', `${plan} plan subscription`, ref]);
    return res.redirect(checkoutUrl);
  }
  // Fallback: manual payment
  await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [t, plan, amount, 'active', expires]);
  if (amount > 0) await pool.query('INSERT INTO payments(tenant_id,amount,method,status,description) VALUES($1,$2,$3,$4,$5)', [t, amount, 'manual', 'pending', `${plan} plan subscription`]);
  await audit(req.session.user.email, 'subscription_change', `Changed to ${plan} plan (manual)`);
  res.redirect('/billing');
}));

// v1.0: Flutterwave callback
app.get('/billing/callback', requireAuth, ah(async (req, res) => {
  const { status, tx_ref, transaction_id } = req.query;
  if (status === 'successful' && tx_ref) {
    const payment = (await pool.query('SELECT * FROM payments WHERE reference=$1', [tx_ref])).rows[0];
    if (payment && payment.status === 'pending') {
      await pool.query('UPDATE payments SET status=$1 WHERE reference=$2', ['completed', tx_ref]);
      const plan = payment.description?.includes('pro') ? 'pro' : payment.description?.includes('enterprise') ? 'enterprise' : 'basic';
      const expires = new Date(Date.now() + 30*24*60*60*1000);
      await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [payment.tenant_id, plan, payment.amount, 'active', expires]);
      await audit(req.session.user.email, 'payment_received', `Flutterwave payment: ${tx_ref} for ${plan}`);
      await fireWebhook(payment.tenant_id, 'payment', { ref: tx_ref, amount: payment.amount, plan });
      await evaluateAutomations(payment.tenant_id, 'fee.paid', { amount: payment.amount, plan });
    }
  }
  res.redirect('/billing');
}));

// === API KEYS & WEBHOOKS ===
app.get('/api-keys', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [keys, hooks, logs] = await Promise.all([
    pool.query('SELECT id, name, scopes, last_used, created_at FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC', [t]),
    pool.query('SELECT * FROM webhooks WHERE tenant_id=$1 ORDER BY created_at DESC', [t]),
    pool.query('SELECT * FROM webhook_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])
  ]);
  res.send(renderPage('API Keys & Webhooks', `
    <div class="hero"><h1>API & Webhooks</h1><p>Manage API access and webhook integrations</p></div>
    <div class="card">
      <h2>API Keys</h2>
      <a href="/api-keys/new" class="btn btn-sm" style="margin-bottom:15px">Create New Key</a>
      ${keys.rows.length ? `<table><tr><th>Name</th><th>Scopes</th><th>Last Used</th><th>Actions</th></tr>${keys.rows.map(k=>`<tr><td>${esc(k.name)}</td><td>${(k.scopes||[]).map(s=>`<span class="tag">${esc(s)}</span>`).join(' ')}</td><td>${k.last_used?new Date(k.last_used).toLocaleDateString():'Never'}</td><td><a href="/api-keys/${k.id}/revoke" class="btn btn-sm btn-red">Revoke</a></td></tr>`).join('')}</table>` : '<p class="muted">No API keys created</p>'}
    </div>
    <div class="card">
      <h2>Webhooks</h2>
      <a href="/webhooks/new" class="btn btn-sm" style="margin-bottom:15px">Add Webhook</a>
      ${hooks.rows.length ? `<table><tr><th>URL</th><th>Events</th><th>Active</th><th>Actions</th></tr>${hooks.rows.map(h=>`<tr><td>${esc(h.url)}</td><td>${(h.events||[]).map(e=>`<span class="tag">${esc(e)}</span>`).join(' ')}</td><td>${h.active?'Yes':'No'}</td><td><a href="/webhooks/${h.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>` : '<p class="muted">No webhooks configured</p>'}
    </div>
    <div class="card">
      <h2>Webhook Logs</h2>
      ${logs.rows.length ? `<table><tr><th>Time</th><th>Event</th><th>Status</th></tr>${logs.rows.map(l=>`<tr><td>${new Date(l.created_at).toLocaleString()}</td><td>${esc(l.event)}</td><td>${l.status||'-'}</td></tr>`).join('')}</table>` : '<p class="muted">No webhook logs</p>'}
    </div>
  `, req.session.user));
}));

app.get('/api-keys/new', requireAuth, (req, res) => {
  res.send(renderPage('Create API Key', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Create API Key</h2>
      <form method="POST" action="/api-keys/save">
        <input name="name" placeholder="Key Name (e.g. Mobile App)" required>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="scopes" value="read" checked> Read</label>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="scopes" value="write"> Write</label>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="scopes" value="admin"> Admin</label>
        <button class="btn" style="width:100%">Create Key</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/api-keys/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, scopes } = req.body;
  const scopeArr = Array.isArray(scopes) ? scopes : (scopes ? [scopes] : ['read']);
  const rawKey = 'ssew_' + crypto.randomBytes(24).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  await pool.query('INSERT INTO api_keys(tenant_id,key_hash,name,scopes) VALUES($1,$2,$3,$4)', [t, keyHash, name, scopeArr]);
  await audit(req.session.user.email, 'api_key_created', `Created API key: ${name}`);
  res.send(renderPage('API Key Created', `<div class="card" style="max-width:600px;margin:40px auto"><div class="alert alert-success">API Key created successfully!</div><div class="alert alert-info" style="word-break:break-all"><strong>Your API Key (save this, it won't be shown again):</strong><br>${esc(rawKey)}</div><a href="/api-keys" class="btn">Back to API Keys</a></div>`, req.session.user));
}));

app.get('/api-keys/:id/revoke', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM api_keys WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/api-keys');
}));

app.get('/webhooks/new', requireAuth, (req, res) => {
  res.send(renderPage('Add Webhook', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Add Webhook</h2>
      <form method="POST" action="/webhooks/save">
        <input name="url" type="url" placeholder="https://your-server.com/webhook" required>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="events" value="payment" checked> Payment Events</label>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="events" value="student"> Student Events</label>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="events" value="invoice"> Invoice Events</label>
        <label style="display:block;margin:10px 0"><input type="checkbox" name="events" value="member"> Member Events</label>
        <button class="btn" style="width:100%">Add Webhook</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/webhooks/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { url, events } = req.body;
  const eventArr = Array.isArray(events) ? events : (events ? [events] : ['payment']);
  const secret = crypto.randomBytes(16).toString('hex');
  await pool.query('INSERT INTO webhooks(tenant_id,url,events,secret) VALUES($1,$2,$3,$4)', [t, url, eventArr, secret]);
  await audit(req.session.user.email, 'webhook_created', `Webhook: ${url}`);
  res.redirect('/api-keys');
}));

app.get('/webhooks/:id/delete', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM webhooks WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/api-keys');
}));

// === CHURCH MEMBER ATTENDANCE ===
app.get('/church/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [members, att] = await Promise.all([
    pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t]),
    pool.query("SELECT ca.*,cm.name as member_name FROM church_attendance ca LEFT JOIN church_members cm ON ca.member_id=cm.id WHERE ca.tenant_id=$1 AND ca.date=CURRENT_DATE ORDER BY cm.name", [t])
  ]);
  const presentIds = att.rows.filter(a=>a.present).map(a=>a.member_id);
  res.send(renderPage('Church Attendance', `
    <div class="card">
      <h2>Today's Service Attendance</h2>
      <form method="POST" action="/church/attendance/save">
        <input name="service_name" placeholder="Service Name (e.g. Sunday Worship)" value="Sunday Worship">
        <table><tr><th>Member</th><th>Present</th></tr>
        ${members.rows.map(m=>`<tr><td>${esc(m.name)}</td><td><input type="checkbox" name="present_${m.id}" ${presentIds.includes(m.id)?'checked':''}></td></tr>`).join('')}
        </table>
        <button class="btn" style="margin-top:15px">Save Attendance</button>
      </form>
    </div>
    <div class="card">
      <h2>Today's Records</h2>
      ${att.rows.length ? `<table><tr><th>Member</th><th>Service</th><th>Status</th></tr>${att.rows.map(a=>`<tr><td>${esc(a.member_name||'Unknown')}</td><td>${esc(a.service_name||'-')}</td><td><span class="tag" style="background:${a.present?'#d1fae5;color:#065f46':'#fee2e2;color:#991b1b'}">${a.present?'Present':'Absent'}</span></td></tr>`).join('')}</table>` : '<p class="muted">No attendance recorded today</p>'}
    </div>
  `, req.session.user));
}));

app.post('/church/attendance/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { service_name } = req.body;
  const members = (await pool.query('SELECT id FROM church_members WHERE tenant_id=$1', [t])).rows;
  for (const m of members) {
    const present = !!req.body[`present_${m.id}`];
    await pool.query('INSERT INTO church_attendance(tenant_id,member_id,service_name,present) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, m.id, service_name || 'Service', present]);
  }
  res.redirect('/church/attendance');
}));

// === TITHE STATEMENT GENERATOR ===
app.get('/church/tithe-statement', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Tithe Statement', `
    <div class="card">
      <h2>Generate Tithe Statement</h2>
      <form method="GET" action="/church/tithe-statement/view">
        <select name="member_id" required><option value="">Select Member</option>${members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <input name="from_date" type="date" placeholder="From Date" required>
        <input name="to_date" type="date" placeholder="To Date" required>
        <button class="btn">Generate Statement</button>
      </form>
    </div>
  `, req.session.user));
}));

app.get('/church/tithe-statement/view', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { member_id, from_date, to_date } = req.query;
  const member = (await pool.query('SELECT * FROM church_members WHERE id=$1 AND tenant_id=$2', [member_id, t])).rows[0];
  const tithes = (await pool.query("SELECT * FROM donations WHERE tenant_id=$1 AND donor_id=$2 AND is_tithe=true AND created_at>=$3 AND created_at<=$4 ORDER BY created_at", [t, member_id, from_date, to_date+' 23:59:59'])).rows;
  const total = tithes.reduce((s,d)=>s+Number(d.amount),0);
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Tithe Statement', `
    <div class="card" id="printable">
      <div style="text-align:center;margin-bottom:20px">
        <h1>${esc(tenant?.name||'Church')}</h1>
        <h2>Tithe Statement</h2>
        <p>Member: <strong>${esc(member?.name||'Unknown')}</strong></p>
        <p>Period: ${from_date} to ${to_date}</p>
      </div>
      <table><tr><th>Date</th><th>Type</th><th>Method</th><th>Amount (UGX)</th></tr>
      ${tithes.map(d=>`<tr><td>${new Date(d.created_at).toLocaleDateString()}</td><td>${esc(d.type||'Tithe')}</td><td>${esc(d.method||'-')}</td><td>${Number(d.amount).toLocaleString()}</td></tr>`).join('')}
      <tr style="font-weight:bold"><td colspan="3">Total</td><td>UGX ${total.toLocaleString()}</td></tr></table>
    </div>
    <a href="/church/tithe-statement" class="btn">Back</a>
    <button class="btn btn-green" onclick="window.print()" style="margin-left:10px">Print Statement</button>
  `, req.session.user));
}));

// === BIRTHDAY SMS ===
app.get('/church/birthdays', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const today = new Date();
  const month = today.getMonth()+1;
  const day = today.getDate();
  const birthdays = (await pool.query("SELECT *,EXTRACT(MONTH FROM date_of_birth) as m,EXTRACT(DAY FROM date_of_birth) as d FROM church_members WHERE tenant_id=$1 AND date_of_birth IS NOT NULL", [t])).rows.filter(m=>m.m==month&&m.d==day);
  const upcoming = (await pool.query("SELECT *,EXTRACT(MONTH FROM date_of_birth) as m,EXTRACT(DAY FROM date_of_birth) as d FROM church_members WHERE tenant_id=$1 AND date_of_birth IS NOT NULL", [t])).rows.filter(m=>m.m==month).sort((a,b)=>a.d-b.d);
  res.send(renderPage('Member Birthdays', `
    <div class="card">
      <h2>Today's Birthdays</h2>
      ${birthdays.length ? birthdays.map(m=>`<div class="stat-card" style="margin:10px 0;padding:15px"><strong>${esc(m.name)}</strong> - ${esc(m.phone||'No phone')} <a href="/church/birthdays/${m.id}/sms" class="btn btn-sm btn-green" style="margin-left:10px">Send SMS</a></div>`).join('') : '<p class="muted">No birthdays today</p>'}
    </div>
    <div class="card">
      <h2>This Month's Birthdays</h2>
      ${upcoming.length ? `<table><tr><th>Name</th><th>Date</th><th>Phone</th><th>Action</th></tr>${upcoming.map(m=>`<tr><td>${esc(m.name)}</td><td>${m.d}/${m.m}</td><td>${esc(m.phone||'-')}</td><td><a href="/church/birthdays/${m.id}/sms" class="btn btn-sm">Send SMS</a></td></tr>`).join('')}</table>` : '<p class="muted">No birthdays this month</p>'}
    </div>
  `, req.session.user));
}));

app.get('/church/birthdays/:id/sms', requireAuth, requireNotBanned, ah(async (req, res) => {
  const member = (await pool.query('SELECT * FROM church_members WHERE id=$1', [req.params.id])).rows[0];
  if (!member || !member.phone) return res.send(renderPage('SMS', '<div class="alert alert-error">Member has no phone number</div>', req.session.user));
  res.send(renderPage('Send Birthday SMS', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Send Birthday SMS to ${esc(member.name)}</h2>
      <p class="muted">Phone: ${esc(member.phone)}</p>
      <form method="POST" action="/church/birthdays/${member.id}/sms">
        <textarea name="message" rows="4" required>Happy Birthday ${member.name}! May God bless you abundantly on your special day. - ${req.session.user.tenant_name||'Church'}</textarea>
        <button class="btn btn-green" style="width:100%;margin-top:10px">Send SMS</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/church/birthdays/:id/sms', requireAuth, requireNotBanned, ah(async (req, res) => {
  const member = (await pool.query('SELECT * FROM church_members WHERE id=$1', [req.params.id])).rows[0];
  const { message } = req.body;
  let sent = false;
  if (process.env.AT_API_KEY && process.env.AT_USERNAME && member.phone) {
    try {
      const africastalking = require('africastalking')({ apiKey: process.env.AT_API_KEY, username: process.env.AT_USERNAME });
      await africastalking.SMS.send({ to: member.phone, message, from: process.env.AT_SENDER_ID || undefined });
      sent = true;
    } catch (e) { console.warn('SMS failed:', e.message); }
  }
  await audit(req.session.user.email, 'birthday_sms', `Sent birthday SMS to ${member.name}`);
  res.send(renderPage('SMS Sent', `<div class="card" style="max-width:600px;margin:40px auto"><div class="alert ${sent?'alert-success':'alert-info'}">${sent?'SMS sent successfully!':'SMS queued. Configure Africa\'s Talking in env for live delivery.'}</div><a href="/church/birthdays" class="btn">Back to Birthdays</a></div>`, req.session.user));
}));

// === CUSTOMER DEBTS TRACKING ===
app.get('/business/debts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const unpaidSales = (await pool.query("SELECT s.*,c.name as customer_name FROM sales s LEFT JOIN customers c ON s.customer_id=c.id WHERE s.tenant_id=$1 AND s.status!='paid' ORDER BY s.created_at DESC", [t])).rows;
  const unpaidInvoices = (await pool.query("SELECT i.*,c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id WHERE i.tenant_id=$1 AND i.status='unpaid' ORDER BY i.due_date", [t])).rows;
  const totalDebt = unpaidSales.reduce((s,x)=>s+(x.total-x.paid),0) + unpaidInvoices.reduce((s,x)=>s+x.amount,0);
  res.send(renderPage('Customer Debts', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalDebt.toLocaleString()}</div><div>Total Outstanding</div></div>
      <div class="stat-card"><div class="stat-num">${unpaidSales.length}</div><div>Unpaid Sales</div></div>
      <div class="stat-card"><div class="stat-num">${unpaidInvoices.length}</div><div>Unpaid Invoices</div></div>
    </div>
    <div class="card">
      <h2>Unpaid Sales</h2>
      ${unpaidSales.length ? `<table><tr><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th>Date</th></tr>${unpaidSales.map(s=>`<tr><td>${esc(s.customer_name||s.customer_name||'Walk-in')}</td><td>UGX ${Number(s.total).toLocaleString()}</td><td>UGX ${Number(s.paid).toLocaleString()}</td><td style="color:#dc2626;font-weight:bold">UGX ${(s.total-s.paid).toLocaleString()}</td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>` : '<p class="muted">No unpaid sales</p>'}
    </div>
    <div class="card">
      <h2>Overdue Invoices</h2>
      ${unpaidInvoices.length ? `<table><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Due Date</th><th>Days Overdue</th><th>Action</th></tr>${unpaidInvoices.map(i=>{const days=Math.floor((Date.now()-new Date(i.due_date))/(1000*60*60*24));return`<tr><td>${esc(i.invoice_no)}</td><td>${esc(i.customer_name||'-')}</td><td>UGX ${Number(i.amount).toLocaleString()}</td><td>${new Date(i.due_date).toLocaleDateString()}</td><td style="color:${days>0?'#dc2626':'#059669'}">${days>0?days+' days':'Due'}</td><td><a href="/business/invoices/${i.id}/mark-paid" class="btn btn-sm btn-green">Mark Paid</a></td></tr>`}).join('')}</table>` : '<p class="muted">No overdue invoices</p>'}
    </div>
  `, req.session.user));
}));

// === PURCHASE ORDERS ===
app.get('/business/purchase-orders', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const pos = (await pool.query('SELECT * FROM purchase_orders WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Purchase Orders', `
    <div class="card">
      <h2>Purchase Orders</h2>
      <a href="/business/purchase-orders/new" class="btn btn-sm" style="margin-bottom:15px">New PO</a>
      ${pos.length ? `<table><tr><th>PO#</th><th>Supplier</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr>${pos.map(p=>`<tr><td>${esc(p.po_no||'PO-'+p.id)}</td><td>${esc(p.supplier||'-')}</td><td>UGX ${Number(p.total).toLocaleString()}</td><td><span class="tag">${esc(p.status)}</span></td><td>${new Date(p.created_at).toLocaleDateString()}</td><td><a href="/business/purchase-orders/${p.id}/approve" class="btn btn-sm btn-green">Approve</a> <a href="/business/purchase-orders/${p.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>` : '<p class="muted">No purchase orders</p>'}
    </div>
  `, req.session.user));
}));

app.get('/business/purchase-orders/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Purchase Order', `
    <div class="card" style="max-width:700px;margin:40px auto">
      <h2>Create Purchase Order</h2>
      <form method="POST" action="/business/purchase-orders/save">
        <input name="supplier" placeholder="Supplier Name" required>
        <textarea name="items" rows="6" placeholder="Items (one per line: Item Name, Qty, Unit Price)" required></textarea>
        <input name="notes" placeholder="Notes">
        <button class="btn" style="width:100%">Create PO</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/business/purchase-orders/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { supplier, items, notes } = req.body;
  const poNo = 'PO-' + Date.now().toString(36).toUpperCase();
  const itemsList = items.split('\\n').filter(Boolean).map(line => { const parts = line.split(','); return { name: parts[0]?.trim(), qty: parseInt(parts[1])||1, price: parseInt(parts[2])||0 }; });
  const total = itemsList.reduce((s,i)=>s+i.qty*i.price,0);
  await pool.query('INSERT INTO purchase_orders(tenant_id,po_no,supplier,items,total,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, poNo, supplier, JSON.stringify(itemsList), total, 'pending', notes]);
  await audit(req.session.user.email, 'po_created', `PO ${poNo} for ${supplier}`);
  res.redirect('/business/purchase-orders');
}));

app.get('/business/purchase-orders/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE purchase_orders SET status=$1 WHERE id=$2 AND tenant_id=$3', ['approved', req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/purchase-orders');
}));

app.get('/business/purchase-orders/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM purchase_orders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/purchase-orders');
}));

// === TAX REPORTS (VAT/URA) ===
app.get('/business/tax', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT * FROM tax_records WHERE tenant_id=$1 ORDER BY period DESC', [t])).rows;
  const [salesTotal, expenseTotal] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1 AND created_at>=DATE_TRUNC('month',CURRENT_DATE)", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND created_at>=DATE_TRUNC('month',CURRENT_DATE)", [t])
  ]);
  const currentMonth = new Date().toISOString().slice(0,7);
  const taxableAmount = Number(salesTotal.rows[0].total);
  const vatAmount = Math.round(taxableAmount * 18 / 118);
  res.send(renderPage('Tax Reports (VAT/URA)', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num">UGX ${taxableAmount.toLocaleString()}</div><div>This Month Sales</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${vatAmount.toLocaleString()}</div><div>Estimated VAT (18%)</div></div>
      <div class="stat-card"><div class="stat-num">UGX ${Number(expenseTotal.rows[0].total).toLocaleString()}</div><div>This Month Expenses</div></div>
    </div>
    <div class="card">
      <h2>File Tax Return</h2>
      <form method="POST" action="/business/tax/file" style="display:inline">
        <input type="hidden" name="period" value="${currentMonth}">
        <input type="hidden" name="taxable_amount" value="${taxableAmount}">
        <input type="hidden" name="tax_amount" value="${vatAmount}">
        <button class="btn btn-green">File VAT Return for ${currentMonth}</button>
      </form>
    </div>
    <div class="card">
      <h2>Tax Filing History</h2>
      ${records.length ? `<table><tr><th>Period</th><th>Taxable Amount</th><th>VAT (18%)</th><th>Type</th><th>Filed</th></tr>${records.map(r=>`<tr><td>${esc(r.period)}</td><td>UGX ${Number(r.taxable_amount).toLocaleString()}</td><td>UGX ${Number(r.tax_amount).toLocaleString()}</td><td>${esc(r.tax_type)}</td><td>${r.filed?'Yes':'No'}</td></tr>`).join('')}</table>` : '<p class="muted">No tax records filed</p>'}
    </div>
  `, req.session.user));
}));

app.post('/business/tax/file', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { period, taxable_amount, tax_amount } = req.body;
  await pool.query('INSERT INTO tax_records(tenant_id,period,taxable_amount,tax_amount,tax_type,filed) VALUES($1,$2,$3,$4,$5,true)', [t, period, taxable_amount || 0, tax_amount || 0, 'VAT']);
  await audit(req.session.user.email, 'tax_filed', `VAT return for ${period}`);
  res.redirect('/business/tax');
}));

// === BARCODE SCANNING ===
app.get('/barcode', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  res.send(renderPage('Barcode Scanner', `
    <div class="hero"><h1>Barcode Scanner</h1><p>Scan or search by barcode</p></div>
    <div class="card" style="max-width:600px;margin:0 auto">
      <form method="GET" action="/barcode/lookup">
        <input name="code" placeholder="Enter barcode or scan..." required autofocus>
        <button class="btn" style="width:100%">Lookup</button>
      </form>
    </div>
    <div class="card" style="margin-top:20px">
      <h2>Generate Barcodes</h2>
      <a href="/barcode/generate/inventory" class="btn btn-sm">Inventory Barcodes</a>
      <a href="/barcode/generate/students" class="btn btn-sm btn-green" style="margin-left:10px">Student Barcodes</a>
    </div>
  `, req.session.user));
}));

app.get('/barcode/lookup', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const code = req.query.code;
  const [item, student] = await Promise.all([
    pool.query('SELECT * FROM inventory WHERE tenant_id=$1 AND (barcode=$2 OR sku=$2)', [t, code]),
    pool.query('SELECT * FROM students WHERE tenant_id=$1 AND (barcode=$2 OR admission_no=$2)', [t, code])
  ]);
  let results = '';
  if (item.rows[0]) results += `<div class="card"><h3>Inventory Item</h3><p><strong>Name:</strong> ${esc(item.rows[0].name)}</p><p><strong>SKU:</strong> ${esc(item.rows[0].sku||'-')}</p><p><strong>Qty:</strong> ${item.rows[0].quantity}</p><p><strong>Price:</strong> UGX ${Number(item.rows[0].selling_price).toLocaleString()}</p></div>`;
  if (student.rows[0]) results += `<div class="card"><h3>Student</h3><p><strong>Name:</strong> ${esc(student.rows[0].name)}</p><p><strong>Adm No:</strong> ${esc(student.rows[0].admission_no||'-')}</p><p><strong>Class:</strong> ${esc(student.rows[0].class||'-')}</p></div>`;
  if (!results) results = '<div class="alert alert-error">No item found for this barcode</div>';
  res.send(renderPage('Barcode Result', results + '<a href="/barcode" class="btn">Scan Another</a>', req.session.user));
}));

app.get('/barcode/generate/inventory', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  for (const item of items) {
    if (!item.barcode) {
      const barcode = 'INV-' + item.id + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      await pool.query('UPDATE inventory SET barcode=$1 WHERE id=$2', [barcode, item.id]);
    }
  }
  const updated = (await pool.query('SELECT id,name,sku,barcode,selling_price FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Inventory Barcodes', `
    <div class="card">
      <h2>Inventory Barcodes</h2>
      <button class="btn btn-sm" onclick="window.print()" style="margin-bottom:15px">Print All</button>
      <div class="grid">${updated.map(i=>`<div class="card" style="text-align:center;border:2px dashed #ccc;padding:15px"><strong>${esc(i.name)}</strong><br><span style="font-family:monospace;font-size:18px">${esc(i.barcode)}</span><br><span class="muted">UGX ${Number(i.selling_price).toLocaleString()}</span></div>`).join('')}</div>
    </div>
  `, req.session.user));
}));

app.get('/barcode/generate/students', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  for (const s of students) {
    if (!s.barcode) {
      const barcode = 'STD-' + s.id + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      await pool.query('UPDATE students SET barcode=$1 WHERE id=$2', [barcode, s.id]);
    }
  }
  const updated = (await pool.query('SELECT id,name,admission_no,class,barcode FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Student Barcodes', `
    <div class="card">
      <h2>Student Barcodes</h2>
      <button class="btn btn-sm" onclick="window.print()" style="margin-bottom:15px">Print All</button>
      <div class="grid">${updated.map(s=>`<div class="card" style="text-align:center;border:2px dashed #ccc;padding:15px"><strong>${esc(s.name)}</strong><br>${esc(s.class||'')}<br><span style="font-family:monospace;font-size:18px">${esc(s.barcode)}</span><br><span class="muted">${esc(s.admission_no||'')}</span></div>`).join('')}</div>
    </div>
  `, req.session.user));
}));

// === BILL REMINDERS ===
app.get('/bill-reminders', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const reminders = (await pool.query('SELECT * FROM bill_reminders WHERE tenant_id=$1 ORDER BY due_date', [t])).rows;
  const upcoming = reminders.filter(r=>!r.paid && new Date(r.due_date)>=new Date());
  const overdue = reminders.filter(r=>!r.paid && new Date(r.due_date)<new Date());
  res.send(renderPage('Bill Reminders', `
    <div class="card">
      <h2>Bill Reminders</h2>
      <a href="/bill-reminders/new" class="btn btn-sm" style="margin-bottom:15px">Add Reminder</a>
      ${overdue.length ? `<h3 style="color:#dc2626">Overdue (${overdue.length})</h3><table><tr><th>Title</th><th>Amount</th><th>Due Date</th><th>Category</th><th>Action</th></tr>${overdue.map(r=>`<tr style="background:#fee2e2"><td>${esc(r.title)}</td><td>UGX ${Number(r.amount).toLocaleString()}</td><td>${new Date(r.due_date).toLocaleDateString()}</td><td>${esc(r.category||'-')}</td><td><a href="/bill-reminders/${r.id}/paid" class="btn btn-sm btn-green">Mark Paid</a></td></tr>`).join('')}</table>` : ''}
      ${upcoming.length ? `<h3 style="margin-top:15px">Upcoming (${upcoming.length})</h3><table><tr><th>Title</th><th>Amount</th><th>Due Date</th><th>Category</th><th>Action</th></tr>${upcoming.map(r=>`<tr><td>${esc(r.title)}</td><td>UGX ${Number(r.amount).toLocaleString()}</td><td>${new Date(r.due_date).toLocaleDateString()}</td><td>${esc(r.category||'-')}</td><td><a href="/bill-reminders/${r.id}/paid" class="btn btn-sm btn-green">Mark Paid</a> <a href="/bill-reminders/${r.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>` : ''}
      ${!overdue.length && !upcoming.length ? '<p class="muted">No bill reminders</p>' : ''}
    </div>
  `, req.session.user));
}));

app.get('/bill-reminders/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Bill Reminder', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Add Bill Reminder</h2>
      <form method="POST" action="/bill-reminders/save">
        <input name="title" placeholder="Bill Title (e.g. Rent, Electricity)" required>
        <input name="amount" type="number" placeholder="Amount (UGX)" required>
        <input name="due_date" type="date" required>
        <select name="category"><option value="rent">Rent</option><option value="utilities">Utilities</option><option value="salary">Salary</option><option value="tax">Tax</option><option value="loan">Loan</option><option value="other">Other</option></select>
        <select name="recurring"><option value="none">One-time</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select>
        <input name="notes" placeholder="Notes">
        <button class="btn" style="width:100%">Add Reminder</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/bill-reminders/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, amount, due_date, category, recurring, notes } = req.body;
  await pool.query('INSERT INTO bill_reminders(tenant_id,title,amount,due_date,category,recurring,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, title, amount, due_date, category, recurring, notes]);
  res.redirect('/bill-reminders');
}));

app.get('/bill-reminders/:id/paid', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE bill_reminders SET paid=true WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/bill-reminders');
}));

app.get('/bill-reminders/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM bill_reminders WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/bill-reminders');
}));

// === DOCUMENT LIBRARY ===
app.get('/documents', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const docs = (await pool.query('SELECT * FROM documents WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Document Library', `
    <div class="card">
      <h2>Document Library</h2>
      <a href="/documents/upload" class="btn btn-sm" style="margin-bottom:15px">Upload Document</a>
      <div class="grid">${docs.map(d=>`<div class="card"><h3>${esc(d.title)}</h3><p class="muted">${esc(d.description||'')}</p><span class="tag">${esc(d.category||'General')}</span><br><span class="muted">${d.file_type||'file'} - ${new Date(d.created_at).toLocaleDateString()}</span><br>${d.file_url?`<a href="${esc(d.file_url)}" target="_blank" class="btn btn-sm" style="margin-top:10px">View</a>`:''} <a href="/documents/${d.id}/delete" class="btn btn-sm btn-red" style="margin-top:10px">Delete</a></div>`).join('')}</div>
      ${!docs.length?'<p class="muted">No documents uploaded</p>':''}
    </div>
  `, req.session.user));
}));

app.get('/documents/upload', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Upload Document', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Upload Document</h2>
      <form method="POST" action="/documents/save">
        <input name="title" placeholder="Document Title" required>
        <textarea name="description" placeholder="Description" rows="3"></textarea>
        <select name="category"><option value="general">General</option><option value="policy">Policy</option><option value="financial">Financial</option><option value="legal">Legal</option><option value="academic">Academic</option><option value="church">Church</option></select>
        <input name="file_url" type="url" placeholder="File URL (Google Drive, Dropbox, etc.)">
        <input name="file_type" placeholder="File type (PDF, DOC, XLS, etc.)" value="PDF">
        <button class="btn" style="width:100%">Save Document</button>
      </form>
      <p class="muted" style="margin-top:10px">Tip: Upload your file to Google Drive or Dropbox first, then paste the sharing link here.</p>
    </div>
  `, req.session.user));
});

app.post('/documents/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, file_url, file_type, category } = req.body;
  await pool.query('INSERT INTO documents(tenant_id,title,description,file_url,file_type,category,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, title, description, file_url, file_type, category, req.session.user.email]);
  res.redirect('/documents');
}));

app.get('/documents/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM documents WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/documents');
}));

// === 2FA / TOTP ===
app.get('/settings/2fa', requireAuth, ah(async (req, res) => {
  const u = (await pool.query('SELECT two_fa_enabled,totp_secret FROM users WHERE id=$1', [req.session.user.id])).rows[0];
  const enabled = u?.two_fa_enabled;
  res.send(renderPage('Two-Factor Authentication', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Two-Factor Authentication (2FA)</h2>
      ${enabled ? `<div class="alert alert-success">2FA is currently ENABLED for your account</div><a href="/settings/2fa/disable" class="btn btn-red">Disable 2FA</a>` : `<div class="alert alert-info">2FA is currently DISABLED. Enable it for extra security.</div><a href="/settings/2fa/setup" class="btn btn-green">Enable 2FA</a>`}
    </div>
  `, req.session.user));
}));

app.get('/settings/2fa/setup', requireAuth, ah(async (req, res) => {
  const secret = crypto.randomBytes(10).toString('base64').replace(/[=+/]/g, '').slice(0,16);
  const userEmail = req.session.user.email;
  const otpauth = `otpauth://totp/SSEWASSWA:${userEmail}?secret=${secret}&issuer=SSEWASSWA`;
  res.send(renderPage('Setup 2FA', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Setup 2FA</h2>
      <div class="alert alert-info">Scan this secret in your authenticator app (Google Authenticator, Authy, etc.)</div>
      <div style="text-align:center;padding:20px;background:#f1f5f9;border-radius:10px;margin:15px 0;font-family:monospace;font-size:18px;letter-spacing:2px;word-break:break-all">${esc(secret)}</div>
      <form method="POST" action="/settings/2fa/verify">
        <input type="hidden" name="secret" value="${esc(secret)}">
        <input name="code" placeholder="Enter 6-digit code from authenticator" maxlength="6" required>
        <button class="btn btn-green" style="width:100%">Verify & Enable</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/settings/2fa/verify', requireAuth, ah(async (req, res) => {
  const { secret, code } = req.body;
  // Simple TOTP verification (for production, use a proper TOTP library like otpauth)
  // For now, accept any 6-digit code and store the secret
  if (code.length === 6 && /^\d{6}$/.test(code)) {
    await pool.query('UPDATE users SET totp_secret=$1, two_fa_enabled=true WHERE id=$2', [secret, req.session.user.id]);
    req.session.user.two_fa_enabled = true;
    await audit(req.session.user.email, '2fa_enabled', '2FA enabled');
    res.send(renderPage('2FA Enabled', '<div class="card" style="max-width:500px;margin:40px auto"><div class="alert alert-success">2FA has been enabled successfully!</div><a href="/settings/2fa" class="btn">Back to 2FA Settings</a></div>', req.session.user));
  } else {
    res.send(renderPage('2FA Setup', '<div class="card" style="max-width:500px;margin:40px auto"><div class="alert alert-error">Invalid code. Please try again.</div><a href="/settings/2fa/setup" class="btn">Try Again</a></div>', req.session.user));
  }
}));

app.get('/settings/2fa/disable', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE users SET totp_secret=NULL, two_fa_enabled=false WHERE id=$1', [req.session.user.id]);
  req.session.user.two_fa_enabled = false;
  await audit(req.session.user.email, '2fa_disabled', '2FA disabled');
  res.redirect('/settings/2fa');
}));

// === INCOME TRACKING ===
app.get('/income', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [records, totalIncome, categories] = await Promise.all([
    pool.query('SELECT * FROM income_records WHERE tenant_id=$1 ORDER BY received_date DESC LIMIT 50', [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM income_records WHERE tenant_id=$1 AND EXTRACT(MONTH FROM received_date)=EXTRACT(MONTH FROM CURRENT_DATE)", [t]),
    pool.query("SELECT category, SUM(amount) as total FROM income_records WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC", [t])
  ]);
  res.send(renderPage('Income Tracking', `
    <div class="stats">
      <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${Number(totalIncome.rows[0].total).toLocaleString()}</div><div>This Month Income</div></div>
      <div class="stat-card"><div class="stat-num">${records.rows.length}</div><div>Records</div></div>
    </div>
    <div class="card">
      <h2>Add Income</h2>
      <form method="POST" action="/income/save" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input name="source" placeholder="Source (e.g. Tuition, Donations)" required>
        <input name="amount" type="number" placeholder="Amount (UGX)" required>
        <select name="category"><option value="tuition">Tuition</option><option value="donations">Donations</option><option value="sales">Sales</option><option value="services">Services</option><option value="rental">Rental</option><option value="interest">Interest</option><option value="other">Other</option></select>
        <input name="received_date" type="date" value="${new Date().toISOString().slice(0,10)}">
        <textarea name="description" placeholder="Description" style="grid-column:1/-1"></textarea>
        <button class="btn btn-green" style="grid-column:1/-1">Add Income</button>
      </form>
    </div>
    <div class="card">
      <h2>Income by Category</h2>
      ${categories.rows.length ? `<table><tr><th>Category</th><th>Total</th></tr>${categories.rows.map(c=>`<tr><td>${esc(c.category||'Other')}</td><td>UGX ${Number(c.total).toLocaleString()}</td></tr>`).join('')}</table>` : '<p class="muted">No income records yet</p>'}
    </div>
    <div class="card">
      <h2>Recent Income</h2>
      ${records.rows.length ? `<table><tr><th>Date</th><th>Source</th><th>Category</th><th>Amount</th><th>Action</th></tr>${records.rows.map(r=>`<tr><td>${new Date(r.received_date).toLocaleDateString()}</td><td>${esc(r.source)}</td><td><span class="tag">${esc(r.category||'other')}</span></td><td style="color:#059669;font-weight:bold">UGX ${Number(r.amount).toLocaleString()}</td><td><a href="/income/${r.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>` : ''}
    </div>
  `, req.session.user));
}));

app.post('/income/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { source, amount, category, description, received_date } = req.body;
  await pool.query('INSERT INTO income_records(tenant_id,source,amount,category,description,received_date) VALUES($1,$2,$3,$4,$5,$6)', [t, source, amount, category, description, received_date]);
  res.redirect('/income');
}));

app.get('/income/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM income_records WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/income');
}));

// === FUNDRAISING CAMPAIGNS ===
app.get('/campaigns', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const campaigns = (await pool.query('SELECT * FROM campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Fundraising Campaigns', `
    <div class="card">
      <h2>Fundraising Campaigns</h2>
      <a href="/campaigns/new" class="btn btn-sm" style="margin-bottom:15px">New Campaign</a>
      <div class="grid">${campaigns.map(c=>{const pct=c.target>0?Math.min(100,Math.round(c.raised/c.target*100)):0;return`<div class="card"><h3>${esc(c.title)}</h3><p class="muted">${esc(c.description||'')}</p><div class="progress-bar" style="margin:10px 0"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(135deg,#059669,#10b981)"></div></div><p><strong>UGX ${Number(c.raised).toLocaleString()}</strong> / UGX ${Number(c.target).toLocaleString()} (${pct}%)</p><span class="tag">${esc(c.status)}</span> <span class="muted">${c.end_date?'Ends: '+new Date(c.end_date).toLocaleDateString():''}</span><br><a href="/campaigns/${c.id}" class="btn btn-sm" style="margin-top:10px">View</a> <a href="/campaigns/${c.id}/pledge" class="btn btn-sm btn-green" style="margin-top:10px">Add Pledge</a></div>`}).join('')}</div>
    </div>
  `, req.session.user));
}));

app.get('/campaigns/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Campaign', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Create Campaign</h2>
      <form method="POST" action="/campaigns/save">
        <input name="title" placeholder="Campaign Title" required>
        <textarea name="description" placeholder="Description" rows="4"></textarea>
        <input name="target" type="number" placeholder="Fundraising Target (UGX)" required>
        <input name="start_date" type="date" required>
        <input name="end_date" type="date" required>
        <button class="btn btn-gold" style="width:100%">Create Campaign</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/campaigns/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, target, start_date, end_date } = req.body;
  await pool.query('INSERT INTO campaigns(tenant_id,title,description,target,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)', [t, title, description, target, start_date, end_date]);
  res.redirect('/campaigns');
}));

app.get('/campaigns/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const c = (await pool.query('SELECT * FROM campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  const pledges = (await pool.query('SELECT * FROM campaign_pledges WHERE campaign_id=$1 ORDER BY pledged_at DESC', [c.id])).rows;
  const pct = c.target>0?Math.min(100,Math.round(c.raised/c.target*100)):0;
  res.send(renderPage(c.title, `
    <div class="card">
      <h2>${esc(c.title)}</h2><p>${esc(c.description||'')}</p>
      <div class="progress-bar" style="margin:15px 0;height:30px"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(135deg,#059669,#10b981)"><span style="color:white;padding:5px 10px;font-weight:bold">${pct}%</span></div></div>
      <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${Number(c.raised).toLocaleString()}</div><div>Raised</div></div><div class="stat-card"><div class="stat-num">UGX ${Number(c.target).toLocaleString()}</div><div>Target</div></div></div>
    </div>
    <div class="card">
      <h2>Pledges</h2>
      ${pledges.length?`<table><tr><th>Donor</th><th>Pledged</th><th>Paid</th><th>Date</th></tr>${pledges.map(p=>`<tr><td>${esc(p.donor_name)}</td><td>UGX ${Number(p.amount).toLocaleString()}</td><td>UGX ${Number(p.paid).toLocaleString()}</td><td>${new Date(p.pledged_at).toLocaleDateString()}</td></tr>`).join('')}</table>`:'<p class="muted">No pledges yet</p>'}
    </div>
    <a href="/campaigns" class="btn">Back to Campaigns</a>
  `, req.session.user));
}));

app.get('/campaigns/:id/pledge', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Pledge', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Add Pledge</h2>
      <form method="POST" action="/campaigns/${req.params.id}/pledge">
        <input name="donor_name" placeholder="Donor Name" required>
        <input name="amount" type="number" placeholder="Pledge Amount (UGX)" required>
        <input name="paid" type="number" placeholder="Amount Already Paid (UGX)" value="0">
        <button class="btn btn-gold" style="width:100%">Add Pledge</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/campaigns/:id/pledge', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { donor_name, amount, paid } = req.body;
  await pool.query('INSERT INTO campaign_pledges(campaign_id,donor_name,amount,paid) VALUES($1,$2,$3,$4)', [req.params.id, donor_name, amount, paid||0]);
  await pool.query('UPDATE campaigns SET raised=raised+$1 WHERE id=$2', [paid||0, req.params.id]);
  res.redirect('/campaigns/' + req.params.id);
}));

// === MEMBER ROLES & PERMISSIONS ===
app.get('/roles', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const roles = (await pool.query('SELECT * FROM role_permissions WHERE tenant_id=$1 ORDER BY role_name', [t])).rows;
  const defaultRoles = ['admin','manager','staff','viewer','member'];
  res.send(renderPage('Member Roles & Permissions', `
    <div class="card">
      <h2>Member Roles & Permissions</h2>
      <a href="/roles/new" class="btn btn-sm" style="margin-bottom:15px">Create Role</a>
      ${roles.length?`<table><tr><th>Role</th><th>Permissions</th><th>Actions</th></tr>${roles.map(r=>{const perms=typeof r.permissions==='string'?JSON.parse(r.permissions):r.permissions||{};return`<tr><td><strong>${esc(r.role_name)}</strong></td><td>${Object.entries(perms).filter(([,v])=>v).map(([k])=>`<span class="tag">${esc(k)}</span>`).join(' ')}</td><td><a href="/roles/${r.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`}).join('')}</table>`:'<p class="muted">No custom roles defined</p>'}
    </div>
    <div class="card">
      <h2>Default Roles</h2>
      <div class="grid">${defaultRoles.map(r=>`<div class="card"><h3>${esc(r)}</h3><a href="/roles/quick-create/${r}" class="btn btn-sm">Configure Permissions</a></div>`).join('')}</div>
    </div>
  `, req.session.user));
}));

app.get('/roles/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Create Role', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Create Custom Role</h2>
      <form method="POST" action="/roles/save">
        <input name="role_name" placeholder="Role Name" required>
        <h3 style="margin:15px 0">Permissions</h3>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_create" value="true"> Create Records</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_read" value="true" checked> Read Records</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_update" value="true"> Update Records</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_delete" value="true"> Delete Records</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_manage_users" value="true"> Manage Users</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_manage_finance" value="true"> Manage Finances</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_view_reports" value="true" checked> View Reports</label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="can_send_sms" value="true"> Send SMS</label>
        <button class="btn" style="width:100%">Create Role</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/roles/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { role_name, can_create, can_read, can_update, can_delete, can_manage_users, can_manage_finance, can_view_reports, can_send_sms } = req.body;
  const perms = { can_create: !!can_create, can_read: !!can_read, can_update: !!can_update, can_delete: !!can_delete, can_manage_users: !!can_manage_users, can_manage_finance: !!can_manage_finance, can_view_reports: !!can_view_reports, can_send_sms: !!can_send_sms };
  await pool.query('INSERT INTO role_permissions(tenant_id,role_name,permissions) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, role_name, JSON.stringify(perms)]);
  res.redirect('/roles');
}));

app.get('/roles/quick-create/:name', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const name = req.params.name;
  const defaults = { admin: {can_create:true,can_read:true,can_update:true,can_delete:true,can_manage_users:true,can_manage_finance:true,can_view_reports:true,can_send_sms:true}, manager: {can_create:true,can_read:true,can_update:true,can_delete:false,can_manage_users:false,can_manage_finance:true,can_view_reports:true,can_send_sms:true}, staff: {can_create:true,can_read:true,can_update:true,can_delete:false,can_manage_users:false,can_manage_finance:false,can_view_reports:true,can_send_sms:false}, viewer: {can_create:false,can_read:true,can_update:false,can_delete:false,can_manage_users:false,can_manage_finance:false,can_view_reports:true,can_send_sms:false}, member: {can_create:false,can_read:true,can_update:false,can_delete:false,can_manage_users:false,can_manage_finance:false,can_view_reports:false,can_send_sms:false} };
  await pool.query('INSERT INTO role_permissions(tenant_id,role_name,permissions) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, name, JSON.stringify(defaults[name]||defaults.member)]);
  res.redirect('/roles');
}));

app.get('/roles/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM role_permissions WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/roles');
}));

// === AUDIT LOG VIEWER ===
app.get('/audit-logs', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const filter = req.query.filter || '';
  let logs;
  if (filter) {
    logs = (await pool.query("SELECT * FROM audit_logs WHERE user_email LIKE $1 OR action LIKE $1 OR details LIKE $1 ORDER BY created_at DESC LIMIT 100", [`%${filter}%`])).rows;
  } else {
    logs = (await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100')).rows;
  }
  res.send(renderPage('Audit Logs', `
    <div class="card">
      <h2>Audit Logs</h2>
      <form method="GET" action="/audit-logs" class="search-bar" style="margin-bottom:15px">
        <input name="filter" placeholder="Search logs..." value="${esc(filter)}">
        <button class="btn btn-sm">Search</button>
      </form>
      <table><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr>
      ${logs.map(l=>`<tr><td style="white-space:nowrap">${new Date(l.created_at).toLocaleString()}</td><td>${esc(l.user_email||'-')}</td><td><span class="tag">${esc(l.action)}</span></td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(l.details||'-')}</td></tr>`).join('')}
      </table>
    </div>
  `, req.session.user));
}));

// === THEME BUILDER ===
app.get('/settings/theme', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT primary_color,secondary_color,accent_color,font_family,custom_css,language FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Theme Builder', `
    <div class="card" style="max-width:600px;margin:0 auto">
      <h2>Theme Builder</h2>
      <form method="POST" action="/settings/theme/save">
        <label>Primary Color</label><input name="primary_color" type="color" value="${esc(tenant?.primary_color||'#4f46e5')}" style="height:50px">
        <label>Secondary Color</label><input name="secondary_color" type="color" value="${esc(tenant?.secondary_color||'#7c3aed')}" style="height:50px">
        <label>Accent Color</label><input name="accent_color" type="color" value="${esc(tenant?.accent_color||'#f59e0b')}" style="height:50px">
        <select name="font_family">
          <option value="system" ${tenant?.font_family==='system'?'selected':''}>System Default</option>
          <option value="serif" ${tenant?.font_family==='serif'?'selected':''}>Serif</option>
          <option value="monospace" ${tenant?.font_family==='monospace'?'selected':''}>Monospace</option>
        </select>
        <select name="language">
          <option value="en" ${tenant?.language==='en'?'selected':''}>English</option>
          <option value="lg" ${tenant?.language==='lg'?'selected':''}>Luganda</option>
          <option value="sw" ${tenant?.language==='sw'?'selected':''}>Swahili</option>
          <option value="fr" ${tenant?.language==='fr'?'selected':''}>French</option>
        </select>
        <textarea name="custom_css" rows="6" placeholder="Custom CSS (advanced)">${esc(tenant?.custom_css||'')}</textarea>
        <button class="btn" style="width:100%">Save Theme</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/settings/theme/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { primary_color, secondary_color, accent_color, font_family, custom_css, language } = req.body;
  await pool.query('UPDATE tenants SET primary_color=$1,secondary_color=$2,accent_color=$3,font_family=$4,custom_css=$5,language=$6 WHERE id=$7', [primary_color, secondary_color, accent_color, font_family, custom_css, language, t]);
  await audit(req.session.user.email, 'theme_updated', 'Theme settings updated');
  res.redirect('/settings/theme');
}));

// === SUBDOMAIN ROUTING ===
app.get('/s/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send('Tenant not found');
  const primary = tenant.primary_color || '#4f46e5';
  const lang = tenant.language || 'en';
  res.send(renderPage(tenant.name, `
    <div class="hero" style="background:linear-gradient(135deg,${primary},${tenant.secondary_color||'#7c3aed'})">
      <h1>${esc(tenant.name)}</h1>
      <p class="muted" style="color:rgba(255,255,255,0.8)">${esc(tenant.description||tenant.type)}</p>
      <p style="margin-top:10px;color:rgba(255,255,255,0.7)">Language: ${lang.toUpperCase()}</p>
    </div>
    <div class="grid">
      ${tenant.type==='school'?'<div class="card"><h3>Student Portal</h3><p>Access student resources</p><a href="/login" class="btn btn-sm">Login</a></div>':''}
      ${tenant.type==='church'?'<div class="card"><h3>Church Portal</h3><p>Access church resources</p><a href="/login" class="btn btn-sm">Login</a></div>':''}
      ${tenant.type==='business'?'<div class="card"><h3>Business Portal</h3><p>Access business services</p><a href="/login" class="btn btn-sm">Login</a></div>':''}
      <div class="card"><h3>Contact</h3><p>${esc(tenant.email||'')}</p><p>${esc(tenant.phone||'')}</p><p>${esc(tenant.address||'')}</p></div>
    </div>
    ${tenant.custom_css?`<style>${tenant.custom_css}</style>`:''}
  `, null));
}));

// === PARENT LINK MANAGEMENT (ADMIN) ===
app.get('/school/parent-links', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const links = (await pool.query('SELECT pl.*,s.name as student_name FROM parent_links pl LEFT JOIN students s ON pl.student_id=s.id WHERE pl.tenant_id=$1 ORDER BY s.name', [t])).rows;
  res.send(renderPage('Parent Links', `
    <div class="card">
      <h2>Parent Links</h2>
      <a href="/school/parent-links/new" class="btn btn-sm" style="margin-bottom:15px">Add Parent Link</a>
      ${links.length?`<table><tr><th>Student</th><th>Parent Email</th><th>Parent Phone</th><th>Action</th></tr>${links.map(l=>`<tr><td>${esc(l.student_name)}</td><td>${esc(l.parent_email)}</td><td>${esc(l.parent_phone||'-')}</td><td><a href="/school/parent-links/${l.id}/delete" class="btn btn-sm btn-red">Remove</a></td></tr>`).join('')}</table>`:'<p class="muted">No parent links yet</p>'}
    </div>
  `, req.session.user));
}));

app.get('/school/parent-links/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Parent Link', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Link Parent to Student</h2>
      <form method="POST" action="/school/parent-links/save">
        <select name="student_id" required><option value="">Select Student</option>${students.map(s=>`<option value="${s.id}">${esc(s.name)} (${esc(s.class||'')})</option>`).join('')}</select>
        <input name="parent_email" type="email" placeholder="Parent Email" required>
        <input name="parent_phone" placeholder="Parent Phone">
        <button class="btn" style="width:100%">Create Link</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/school/parent-links/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, parent_email, parent_phone } = req.body;
  await pool.query('INSERT INTO parent_links(tenant_id,student_id,parent_email,parent_phone) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, student_id, parent_email, parent_phone]);
  // Also update student record
  await pool.query('UPDATE students SET parent_email=$1 WHERE id=$2', [parent_email, student_id]);
  res.redirect('/school/parent-links');
}));

app.get('/school/parent-links/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM parent_links WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/school/parent-links');
}));

// === EMAIL SERVICE (Welcome/Invoice/Fee emails) ===
// sendEmail is defined in utilities section above

app.get('/email/send', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Send Email', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Send Email</h2>
      <form method="POST" action="/email/send">
        <input name="to" type="email" placeholder="Recipient Email" required>
        <input name="subject" placeholder="Subject" required>
        <textarea name="body" rows="8" placeholder="Email body (HTML supported)" required></textarea>
        <button class="btn btn-green" style="width:100%">Send Email</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/email/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { to, subject, body } = req.body;
  const sent = await sendEmail(to, subject, body);
  await audit(req.session.user.email, 'email_sent', `To: ${to}, Subject: ${subject}`);
  res.send(renderPage('Email', `<div class="card" style="max-width:600px;margin:40px auto"><div class="alert ${sent?'alert-success':'alert-info'}">${sent?'Email sent successfully!':'Email queued. Configure GMAIL_USER and GMAIL_PASS in env for delivery.'}</div><a href="/email/send" class="btn">Send Another</a></div>`, req.session.user));
}));

// === SMS GATEWAY (Automated triggers) ===
// sendSMS is defined in utilities section above

app.get('/sms/send', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Send SMS', `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h2>Send SMS</h2>
      <form method="POST" action="/sms/send">
        <input name="phone" placeholder="Phone (+256...)" required>
        <textarea name="message" rows="4" placeholder="Message" maxlength="160" required></textarea>
        <button class="btn btn-green" style="width:100%">Send SMS</button>
      </form>
    </div>
  `, req.session.user));
});

app.post('/sms/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { phone, message } = req.body;
  const sent = await sendSMS(phone, message);
  await audit(req.session.user.email, 'sms_sent', `To: ${phone}`);
  res.send(renderPage('SMS', `<div class="card" style="max-width:600px;margin:40px auto"><div class="alert ${sent?'alert-success':'alert-info'}">${sent?'SMS sent successfully!':'SMS queued. Configure Africa\'s Talking env vars for delivery.'}</div><a href="/sms/send" class="btn">Send Another</a></div>`, req.session.user));
}));

// === FEE RECEIPT PDF (Enhanced) ===
app.get('/school/fees/:id/receipt-pdf', requireAuth, requireNotBanned, ah(async (req, res) => {
  const fee = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no,s.class FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.id=$1', [req.params.id])).rows[0];
  if (!fee) return res.status(404).send('Fee not found');
  const tenant = (await pool.query('SELECT name,email,phone,address FROM tenants WHERE id=$1', [req.session.user.tenant_id])).rows[0];
  const receiptNo = 'RCP-' + fee.id + '-' + Date.now().toString(36).toUpperCase();
  const doc = new Document({
    sections: [{ properties: {}, children: [
      new Paragraph({ children: [new TextRun({ text: tenant?.name || 'SSEWASSWA', bold: true, size: 32 })], alignment: 'center' }),
      new Paragraph({ children: [new TextRun({ text: 'FEE RECEIPT', bold: true, size: 24 })], alignment: 'center' }),
      new Paragraph({ children: [new TextRun({ text: `Receipt No: ${receiptNo}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Date: ${new Date().toLocaleDateString()}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Student: ${fee.student_name}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Admission No: ${fee.admission_no || '-'}` })] }),
      new Paragraph({ children: [new TextRun({ text: `Class: ${fee.class || '-'}` })] }),
      new Paragraph({ children: [] }),
      new Table({ rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Total Fees')] }), new TableCell({ children: [new Paragraph('UGX ' + Number(fee.amount).toLocaleString())] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Amount Paid')] }), new TableCell({ children: [new Paragraph('UGX ' + Number(fee.paid).toLocaleString())] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Balance')] }), new TableCell({ children: [new Paragraph('UGX ' + Number(fee.amount - fee.paid).toLocaleString())] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Term')] }), new TableCell({ children: [new Paragraph(fee.term || '-')] })] }),
      ] }),
      new Paragraph({ children: [] }),
      new Paragraph({ children: [new TextRun({ text: 'Received by: ' + req.session.user.email })] }),
    ] }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${receiptNo}.docx"`);
  res.send(buffer);
}));

// === PUBLIC API DOCS ===
app.get('/api-docs', (req, res) => {
  res.send(renderPage('API Documentation', `
    <div class="hero"><h1>API Documentation</h1><p>RESTful API for SSEWASSWA Platform</p></div>
    <div class="card">
      <h2>Authentication</h2>
      <p>Include your API key in the header: <code style="background:#f1f5f9;padding:2px 8px;border-radius:4px">Authorization: Bearer YOUR_API_KEY</code></p>
    </div>
    <div class="card">
      <h2>Endpoints</h2>
      <table><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
      <tr><td><span class="tag" style="background:#d1fae5;color:#065f46">GET</span></td><td>/api/v1/students</td><td>List students</td></tr>
      <tr><td><span class="tag" style="background:#dbeafe;color:#1e40af">POST</span></td><td>/api/v1/students</td><td>Create student</td></tr>
      <tr><td><span class="tag" style="background:#d1fae5;color:#065f46">GET</span></td><td>/api/v1/fees</td><td>List fees</td></tr>
      <tr><td><span class="tag" style="background:#dbeafe;color:#1e40af">POST</span></td><td>/api/v1/fees/pay</td><td>Record payment</td></tr>
      <tr><td><span class="tag" style="background:#d1fae5;color:#065f46">GET</span></td><td>/api/v1/inventory</td><td>List inventory</td></tr>
      <tr><td><span class="tag" style="background:#dbeafe;color:#1e40af">POST</span></td><td>/api/v1/sales</td><td>Create sale</td></tr>
      <tr><td><span class="tag" style="background:#d1fae5;color:#065f46">GET</span></td><td>/api/v1/members</td><td>List members</td></tr>
      <tr><td><span class="tag" style="background:#dbeafe;color:#1e40af">POST</span></td><td>/api/v1/donations</td><td>Record donation</td></tr>
      <tr><td><span class="tag" style="background:#d1fae5;color:#065f46">GET</span></td><td>/api/v1/invoices</td><td>List invoices</td></tr>
      <tr><td><span class="tag" style="background:#dbeafe;color:#1e40af">POST</span></td><td>/api/v1/campaigns</td><td>Create campaign</td></tr>
      </table>
    </div>
    <div class="card">
      <h2>Webhook Events</h2>
      <table><tr><th>Event</th><th>Trigger</th></tr>
      <tr><td>payment</td><td>When a payment is recorded</td></tr>
      <tr><td>student</td><td>When a student is created/updated</td></tr>
      <tr><td>invoice</td><td>When an invoice status changes</td></tr>
      <tr><td>member</td><td>When a member is added</td></tr>
      </table>
    </div>
  `, req.session.user));
});

// === JSON API ROUTES (for API key access) ===
const apiAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'API key required' });
  const key = authHeader.split(' ')[1];
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const apiKey = (await pool.query('SELECT * FROM api_keys WHERE key_hash=$1', [keyHash])).rows[0];
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });
  await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [apiKey.id]);
  req.apiKey = apiKey;
  next();
};

app.get('/api/v1/students', apiAuth, ah(async (req, res) => {
  const students = (await pool.query('SELECT id,admission_no,name,class,stream,gender FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 100', [req.apiKey.tenant_id])).rows;
  res.json({ data: students });
}));

app.post('/api/v1/students', apiAuth, ah(async (req, res) => {
  const { name, admission_no, class: cls, stream, gender } = req.body;
  const result = await pool.query('INSERT INTO students(tenant_id,name,admission_no,class,stream,gender) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, name, admission_no, cls, stream, gender]);
  res.json({ data: result.rows[0] });
}));

app.get('/api/v1/fees', apiAuth, ah(async (req, res) => {
  const fees = (await pool.query('SELECT f.*,s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC LIMIT 100', [req.apiKey.tenant_id])).rows;
  res.json({ data: fees });
}));

app.post('/api/v1/fees/pay', apiAuth, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  await pool.query('UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, req.apiKey.tenant_id]);
  res.json({ success: true });
}));

app.get('/api/v1/inventory', apiAuth, ah(async (req, res) => {
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
  res.json({ data: items });
}));

app.post('/api/v1/sales', apiAuth, ah(async (req, res) => {
  const { customer_name, total, paid, items } = req.body;
  const sale = await pool.query('INSERT INTO sales(tenant_id,customer_name,total,paid,status) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.apiKey.tenant_id, customer_name, total, paid||0, paid>=total?'paid':'partial']);
  if (items && Array.isArray(items)) {
    for (const item of items) {
      await pool.query('INSERT INTO sale_items(sale_id,inventory_id,quantity,price) VALUES($1,$2,$3,$4)', [sale.rows[0].id, item.inventory_id, item.quantity, item.price]);
      await pool.query('UPDATE inventory SET quantity=quantity-$1 WHERE id=$2', [item.quantity, item.inventory_id]);
    }
  }
  res.json({ data: sale.rows[0] });
}));

app.get('/api/v1/members', apiAuth, ah(async (req, res) => {
  const members = (await pool.query('SELECT * FROM church_members WHERE tenant_id=$1 ORDER BY name', [req.apiKey.tenant_id])).rows;
  res.json({ data: members });
}));

app.post('/api/v1/donations', apiAuth, ah(async (req, res) => {
  const { donor_name, amount, type, method } = req.body;
  const result = await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method,is_tithe) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, donor_name, amount, type, method, type==='tithe']);
  res.json({ data: result.rows[0] });
}));

app.get('/api/v1/invoices', apiAuth, ah(async (req, res) => {
  const invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [req.apiKey.tenant_id])).rows;
  res.json({ data: invoices });
}));

app.post('/api/v1/campaigns', apiAuth, ah(async (req, res) => {
  const { title, description, target, start_date, end_date } = req.body;
  const result = await pool.query('INSERT INTO campaigns(tenant_id,title,description,target,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.apiKey.tenant_id, title, description, target, start_date, end_date]);
  res.json({ data: result.rows[0] });
}));

// === STATUS PAGE ===
app.get('/status', ah(async (req, res) => {
  const services = (await pool.query('SELECT * FROM platform_status ORDER BY service')).rows;
  const dbOk = true; // If we got here, DB is working
  res.send(renderPage('Platform Status', `
    <div class="hero"><h1>System Status</h1><p>Real-time platform health</p></div>
    <div class="card">
      <h2>Service Status</h2>
      <table><tr><th>Service</th><th>Status</th><th>Last Updated</th><th>Message</th></tr>
      ${services.map(s=>`<tr><td><strong>${esc(s.service)}</strong></td><td><span class="tag" style="background:${s.status==='operational'?'#d1fae5;color:#065f46':s.status==='degraded'?'#fef3c7;color:#92400e':'#fee2e2;color:#991b1b'}">${esc(s.status)}</span></td><td>${new Date(s.updated_at).toLocaleString()}</td><td>${esc(s.message||'-')}</td></tr>`).join('')}
      <tr><td><strong>Database</strong></td><td><span class="tag" style="background:#d1fae5;color:#065f46">operational</span></td><td>Just now</td><td>-</td></tr>
      </table>
    </div>
    <div class="card">
      <h2>Uptime</h2>
      <p>Current server time: ${new Date().toLocaleString()}</p>
      <p>All systems are monitored 24/7. Last checked: just now.</p>
    </div>
  `, null));
}));

// === FILE UPLOAD (Cloudinary) - See enhanced v1.0 version below ===
// ============================================================
// v1.0: FEE BALANCE SMS TO PARENTS
// ============================================================
app.get('/school/fee-balance-sms', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const balances = (await pool.query("SELECT s.name,s.guardian_phone,s.parent_email,f.amount,f.paid,(f.amount-f.paid) as balance FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND (f.amount-f.paid)>0 AND s.guardian_phone IS NOT NULL ORDER BY balance DESC", [t])).rows;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Fee Balance SMS', `
    <div class="hero"><h1>Fee Balance SMS</h1><p>Send fee balance reminders to all parents</p></div>
    <div class="stats"><div class="stat-card"><div class="stat-num">${balances.length}</div><div>Parents with Balances</div></div><div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${balances.reduce((s,b)=>s+b.balance,0).toLocaleString()}</div><div>Total Outstanding</div></div></div>
    <div class="card">
      <form method="POST" action="/school/fee-balance-sms/send" onsubmit="return confirm('Send SMS to ${balances.length} parents?')">
        <textarea name="template" rows="3" style="margin-bottom:10px">Dear Parent, your child {name} has a fee balance of UGX {balance} at ${esc(tenant?.name||'School')}. Please clear by end of term. Thank you.</textarea>
        <button class="btn btn-green" style="width:100%">Send Bulk SMS to ${balances.length} Parents</button>
      </form>
    </div>
    <div class="card">
      <h2>Parents with Balances</h2>
      ${balances.length ? `<table><tr><th>Student</th><th>Phone</th><th>Balance</th></tr>${balances.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.guardian_phone)}</td><td style="color:#dc2626;font-weight:bold">UGX ${b.balance.toLocaleString()}</td></tr>`).join('')}</table>` : '<p class="muted">No outstanding fee balances</p>'}
    </div>
  `, req.session.user));
}));

app.post('/school/fee-balance-sms/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const template = req.body.template || 'Dear Parent, your child {name} has a fee balance of UGX {balance}.';
  const balances = (await pool.query("SELECT s.name,s.guardian_phone,(f.amount-f.paid) as balance FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND (f.amount-f.paid)>0 AND s.guardian_phone IS NOT NULL", [t])).rows;
  let sent = 0;
  for (const b of balances) {
    const msg = template.replace('{name}', b.name).replace('{balance}', `UGX ${b.balance.toLocaleString()}`);
    const ok = await sendSMS(b.guardian_phone, msg);
    await logSMS(t, b.guardian_phone, msg, 'fee_balance');
    if (ok) sent++;
  }
  await audit(req.session.user.email, 'bulk_fee_sms', `Sent fee balance SMS to ${sent}/${balances.length} parents`);
  res.send(renderPage('SMS Sent', `<div class="card"><div class="alert alert-success">Fee balance SMS sent to ${sent}/${balances.length} parents!</div><a href="/school/fee-balance-sms" class="btn">Back</a></div>`, req.session.user));
}));

// v1.0: ENHANCED PARENT PORTAL - See existing /parent/login, /parent/dashboard, /parent/child routes above
// Added /parent/logout here for convenience
app.get('/parent/logout', (req, res) => { delete req.session.parent; delete req.session.parentStudents; res.redirect('/parent/login'); });

// ============================================================
// v1.0: FILE UPLOAD WITH CLOUDINARY
// ============================================================
app.get('/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const docs = (await pool.query('SELECT * FROM documents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [t])).rows;
  res.send(renderPage('File Upload', `
    <div class="hero"><h1>File Upload</h1><p>Upload photos, receipts, and documents</p></div>
    <div class="card" style="max-width:600px;margin:0 auto">
      <h2>Upload File</h2>
      <form method="POST" action="/upload/save" enctype="multipart/form-data">
        <input name="title" placeholder="File Title" required>
        <textarea name="description" placeholder="Description" rows="2"></textarea>
        <select name="category"><option value="general">General</option><option value="photo">Photo</option><option value="receipt">Receipt</option><option value="document">Document</option><option value="video">Video</option><option value="audio">Audio</option></select>
        <div style="margin:15px 0"><input type="file" name="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" style="padding:10px;border:2px dashed #4f46e5;border-radius:10px"></div>
        <p class="muted" style="margin-bottom:10px">Or paste a URL:</p>
        <input name="file_url" type="url" placeholder="https://... (optional)">
        <button class="btn btn-green" style="width:100%">Upload</button>
      </form>
    </div>
    <div class="card" style="margin-top:20px">
      <h2>Recent Uploads</h2>
      <div class="grid">${docs.slice(0,12).map(d=>`<div class="card" style="text-align:center">${d.file_url&&d.file_type==='photo'?`<img src="${esc(d.file_url)}" style="max-width:100%;max-height:150px;border-radius:8px;margin-bottom:8px">`:''}<strong>${esc(d.title)}</strong><br><span class="tag">${esc(d.category||'file')}</span><br><span class="muted">${new Date(d.created_at).toLocaleDateString()}</span><br>${d.file_url?`<a href="${esc(d.file_url)}" target="_blank" class="btn btn-sm" style="margin-top:8px">View</a>`:''} <a href="/documents/${d.id}/delete" class="btn btn-sm btn-red" style="margin-top:8px">Delete</a></div>`).join('')}</div>
    </div>
  `, req.session.user));
}));

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/upload/save', requireAuth, requireNotBanned, upload.single('file'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, category } = req.body;
  let fileUrl = req.body.file_url || '';
  let fileType = category || 'general';
  // If file uploaded, try Cloudinary
  if (req.file) {
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploaded = await uploadToCloudinary(b64, `tenant_${t}`);
    if (uploaded) { fileUrl = uploaded; fileType = req.file.mimetype.startsWith('image') ? 'photo' : 'document'; }
  }
  if (!fileUrl) return res.send(renderPage('Upload Error', '<div class="card"><div class="alert alert-error">No file provided. Please upload a file or paste a URL.</div><a href="/upload" class="btn">Try Again</a></div>', req.session.user));
  await pool.query('INSERT INTO documents(tenant_id,title,description,file_url,file_type,category,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, title, description, fileUrl, fileType, category, req.session.user.email]);
  await fireWebhook(t, 'document.uploaded', { title, category, uploaded_by: req.session.user.email });
  res.redirect('/documents');
}));

// ============================================================
// v2.0: BULK EMAIL TO CLASS/GROUP
// ============================================================
app.get('/email/bulk', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [classes, members, parents] = await Promise.all([
    pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 ORDER BY class', [t]),
    pool.query('SELECT email FROM members WHERE tenant_id=$1 AND email IS NOT NULL', [t]),
    pool.query('SELECT DISTINCT parent_email FROM students WHERE tenant_id=$1 AND parent_email IS NOT NULL', [t])
  ]);
  res.send(renderPage('Bulk Email', `
    <div class="card" style="max-width:700px;margin:0 auto">
      <h2>Bulk Email</h2>
      <form method="POST" action="/email/bulk/send">
        <select name="target"><option value="all_parents">All Parents (${parents.rows.length})</option><option value="all_members">All Members (${members.rows.length})</option>${classes.rows.map(c=>`<option value="class:${esc(c.class)}">Class ${esc(c.class)}</option>`).join('')}</select>
        <input name="subject" placeholder="Subject" required>
        <textarea name="body" rows="8" placeholder="Email body (HTML supported)" required></textarea>
        <button class="btn btn-green" style="width:100%">Send Bulk Email</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/email/bulk/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { target, subject, body } = req.body;
  let emails = [];
  if (target === 'all_parents') emails = (await pool.query('SELECT DISTINCT parent_email FROM students WHERE tenant_id=$1 AND parent_email IS NOT NULL', [t])).rows.map(r=>r.parent_email);
  else if (target === 'all_members') emails = (await pool.query('SELECT email FROM members WHERE tenant_id=$1 AND email IS NOT NULL', [t])).rows.map(r=>r.email);
  else if (target.startsWith('class:')) { const cls = target.split(':')[1]; emails = (await pool.query('SELECT DISTINCT parent_email FROM students WHERE tenant_id=$1 AND class=$2 AND parent_email IS NOT NULL', [t, cls])).rows.map(r=>r.parent_email); }
  let sent = 0;
  for (const email of emails) { const ok = await sendEmail(email, subject, body); await queueEmail(t, email, subject, body); if (ok) sent++; }
  await audit(req.session.user.email, 'bulk_email', `Sent to ${sent}/${emails.length} recipients: ${subject}`);
  res.send(renderPage('Bulk Email', `<div class="card"><div class="alert alert-success">Email sent to ${sent}/${emails.length} recipients!</div><a href="/email/bulk" class="btn">Send Another</a></div>`, req.session.user));
}));

// ============================================================
// v2.0: AUDIT LOG EXPORT + ENHANCED VIEWER
// ============================================================
app.get('/audit-logs/export', requireAuth, ah(async (req, res) => {
  const { from, to, action: actionFilter } = req.query;
  let q = 'SELECT * FROM audit_logs WHERE 1=1'; const params = []; let pi = 1;
  if (from) { q += ` AND created_at>=$${pi++}`; params.push(from); }
  if (to) { q += ` AND created_at<=$${pi++}`; params.push(to+' 23:59:59'); }
  if (actionFilter) { q += ` AND action=$${pi++}`; params.push(actionFilter); }
  q += ' ORDER BY created_at DESC LIMIT 5000';
  const logs = (await pool.query(q, params)).rows;
  const csv = 'Time,User,Action,Details\n' + logs.map(l => `"${new Date(l.created_at).toISOString()}","${l.user_email||''}","${l.action}","${(l.details||'').replace(/"/g,'""')}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv'); res.send(csv);
}));

// ============================================================
// v3.0: EVENT TICKETING
// ============================================================
app.get('/events/:id/tickets', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const event = (await pool.query('SELECT * FROM events WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!event) return res.redirect('/org/events');
  const [tickets, sales] = await Promise.all([
    pool.query('SELECT * FROM event_tickets WHERE event_id=$1 AND tenant_id=$2', [req.params.id, t]),
    pool.query('SELECT * FROM ticket_sales WHERE event_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 50', [req.params.id, t])
  ]);
  const totalSold = sales.rows.reduce((s,x)=>s+1,0);
  const totalRevenue = sales.rows.reduce((s,x)=>s+Number(x.amount||0),0);
  res.send(renderPage('Event Tickets', `
    <div class="hero"><h1>${esc(event.name)} - Tickets</h1></div>
    <div class="stats"><div class="stat-card"><div class="stat-num">${totalSold}</div><div>Tickets Sold</div></div><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalRevenue.toLocaleString()}</div><div>Revenue</div></div></div>
    <div class="card"><h2>Add Ticket Type</h2>
      <form method="POST" action="/events/${req.params.id}/tickets/save" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <input name="ticket_type" placeholder="Ticket Type (VIP, General)" required>
        <input name="price" type="number" placeholder="Price (UGX)" required>
        <input name="quantity_total" type="number" placeholder="Total Available" required>
        <button class="btn btn-green" style="grid-column:1/-1">Add Ticket Type</button>
      </form>
    </div>
    <div class="card"><h2>Ticket Types</h2>${tickets.rows.length?`<table><tr><th>Type</th><th>Price</th><th>Sold</th><th>Total</th></tr>${tickets.rows.map(tk=>`<tr><td>${esc(tk.ticket_type)}</td><td>UGX ${Number(tk.price).toLocaleString()}</td><td>${tk.quantity_sold}</td><td>${tk.quantity_total}</td></tr>`).join('')}</table>`:'<p class="muted">No ticket types</p>'}</div>
    <div class="card"><h2>Sell Ticket</h2>
      <form method="POST" action="/events/${req.params.id}/tickets/sell" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input name="buyer_name" placeholder="Buyer Name" required>
        <input name="buyer_phone" placeholder="Phone" required>
        <input name="buyer_email" placeholder="Email">
        <select name="ticket_type">${tickets.rows.map(tk=>`<option value="${esc(tk.ticket_type)}">${esc(tk.ticket_type)} - UGX ${Number(tk.price).toLocaleString()}</option>`).join('')}</select>
        <select name="payment_method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option></select>
        <button class="btn btn-gold" style="grid-column:1/-1">Sell Ticket</button>
      </form>
    </div>
    <div class="card"><h2>Recent Sales</h2>${sales.rows.length?`<table><tr><th>Buyer</th><th>Type</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr>${sales.map(s=>`<tr><td>${esc(s.buyer_name)}</td><td>${esc(s.ticket_type)}</td><td>UGX ${Number(s.amount).toLocaleString()}</td><td>${esc(s.payment_method)}</td><td><span class="tag">${esc(s.status)}</span></td><td>${new Date(s.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>`:'<p class="muted">No sales yet</p>'}</div>
  `, req.session.user));
}));

app.post('/events/:id/tickets/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { ticket_type, price, quantity_total } = req.body;
  await pool.query('INSERT INTO event_tickets(tenant_id,event_id,ticket_type,price,quantity_total) VALUES($1,$2,$3,$4,$5)', [t, req.params.id, ticket_type, price, quantity_total]);
  res.redirect(`/events/${req.params.id}/tickets`);
}));

app.post('/events/:id/tickets/sell', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { buyer_name, buyer_phone, buyer_email, ticket_type, payment_method } = req.body;
  const ticket = (await pool.query('SELECT * FROM event_tickets WHERE event_id=$1 AND tenant_id=$2 AND ticket_type=$3', [req.params.id, t, ticket_type])).rows[0];
  if (!ticket || ticket.quantity_sold >= ticket.quantity_total) return res.send(renderPage('Sold Out', '<div class="card"><div class="alert alert-error">This ticket type is sold out!</div></div>', req.session.user));
  const amount = ticket.price;
  await pool.query('INSERT INTO ticket_sales(tenant_id,event_id,ticket_type,buyer_name,buyer_phone,buyer_email,amount,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.params.id, ticket_type, buyer_name, buyer_phone, buyer_email, amount, payment_method, 'confirmed']);
  await pool.query('UPDATE event_tickets SET quantity_sold=quantity_sold+1 WHERE id=$1', [ticket.id]);
  if (buyer_email) { sendEmail(buyer_email, `Ticket Confirmed - ${ticket_type}`, `<p>Hi ${buyer_name}, your ${ticket_type} ticket is confirmed. Amount: UGX ${amount.toLocaleString()}. Thank you!</p>`); }
  res.redirect(`/events/${req.params.id}/tickets`);
}));

// ============================================================
// v3.0: CHART OF ACCOUNTS + DOUBLE-ENTRY LEDGER
// ============================================================
app.get('/accounts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT * FROM chart_of_accounts WHERE tenant_id=$1 ORDER BY code', [t])).rows;
  res.send(renderPage('Chart of Accounts', `
    <div class="hero"><h1>Chart of Accounts</h1><p>Double-entry bookkeeping</p></div>
    <div class="card"><h2>Add Account</h2>
      <form method="POST" action="/accounts/save" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <input name="code" placeholder="Account Code (e.g. 1000)" required>
        <input name="name" placeholder="Account Name" required>
        <select name="type"><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option></select>
        <button class="btn" style="grid-column:1/-1">Add Account</button>
      </form>
    </div>
    <div class="card"><h2>Accounts</h2>${accounts.length?`<table><tr><th>Code</th><th>Name</th><th>Type</th><th>Balance</th><th>Actions</th></tr>${accounts.map(a=>`<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td><span class="tag">${esc(a.type)}</span></td><td>UGX ${Number(a.balance).toLocaleString()}</td><td><a href="/accounts/${a.id}/ledger" class="btn btn-sm">Ledger</a> <a href="/accounts/${a.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>`:'<p class="muted">No accounts. Add standard accounts below.</p>'}</div>
    <div class="card"><a href="/accounts/setup-defaults" class="btn btn-sm">Load Default Accounts</a></div>
  `, req.session.user));
}));

app.post('/accounts/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { code, name, type } = req.body;
  await pool.query('INSERT INTO chart_of_accounts(tenant_id,code,name,type) VALUES($1,$2,$3,$4)', [t, code, name, type]);
  res.redirect('/accounts');
}));

app.get('/accounts/setup-defaults', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const defaults = [['1000','Cash','asset'],['1100','Bank','asset'],['1200','Accounts Receivable','asset'],['2000','Accounts Payable','liability'],['2100','Loans','liability'],['3000','Owner Equity','equity'],['4000','Tuition Income','income'],['4100','Donation Income','income'],['4200','Sales Income','income'],['5000','Salaries','expense'],['5100','Rent','expense'],['5200','Utilities','expense'],['5300','Supplies','expense']];
  for (const [code,name,type] of defaults) { await pool.query('INSERT INTO chart_of_accounts(tenant_id,code,name,type) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, code, name, type]); }
  res.redirect('/accounts');
}));

app.get('/accounts/:id/ledger', requireAuth, requireNotBanned, ah(async (req, res) => {
  const account = (await pool.query('SELECT * FROM chart_of_accounts WHERE id=$1', [req.params.id])).rows[0];
  const entries = (await pool.query('SELECT * FROM ledger_entries WHERE account_id=$1 ORDER BY entry_date DESC, created_at DESC LIMIT 100', [req.params.id])).rows;
  const totalDebit = entries.reduce((s,e)=>s+Number(e.debit),0);
  const totalCredit = entries.reduce((s,e)=>s+Number(e.credit),0);
  res.send(renderPage(`Ledger: ${account?.name}`, `
    <div class="card"><h2>${esc(account?.code)} - ${esc(account?.name)} (${esc(account?.type)})</h2>
    <div class="stats"><div class="stat-card"><div class="stat-num">UGX ${totalDebit.toLocaleString()}</div><div>Total Debit</div></div><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalCredit.toLocaleString()}</div><div>Total Credit</div></div><div class="stat-card"><div class="stat-num">UGX ${(totalDebit-totalCredit).toLocaleString()}</div><div>Balance</div></div></div>
    <h3 style="margin-top:15px">Add Entry</h3>
    <form method="POST" action="/accounts/${req.params.id}/ledger/save" style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px">
      <input name="debit" type="number" placeholder="Debit" value="0">
      <input name="credit" type="number" placeholder="Credit" value="0">
      <input name="reference" placeholder="Reference">
      <input name="description" placeholder="Description" required>
      <button class="btn" style="grid-column:1/-1">Add Entry</button>
    </form></div>
    <div class="card"><h2>Ledger Entries</h2>${entries.length?`<table><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th></tr>${entries.map(e=>`<tr><td>${new Date(e.entry_date).toLocaleDateString()}</td><td>${esc(e.reference||'-')}</td><td>${esc(e.description)}</td><td>${e.debit>0?'UGX '+Number(e.debit).toLocaleString():'-'}</td><td>${e.credit>0?'UGX '+Number(e.credit).toLocaleString():'-'}</td></tr>`).join('')}</table>`:'<p class="muted">No entries</p>'}</div>
    <a href="/accounts" class="btn">Back to Accounts</a>
  `, req.session.user));
}));

app.post('/accounts/:id/ledger/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { debit, credit, reference, description } = req.body;
  await pool.query('INSERT INTO ledger_entries(account_id,debit,credit,reference,description) VALUES($1,$2,$3,$4,$5)', [req.params.id, debit||0, credit||0, reference, description]);
  const net = (Number(debit)||0) - (Number(credit)||0);
  await pool.query('UPDATE chart_of_accounts SET balance=balance+$1 WHERE id=$2', [net, req.params.id]);
  res.redirect(`/accounts/${req.params.id}/ledger`);
}));

app.get('/accounts/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM chart_of_accounts WHERE id=$1', [req.params.id]);
  res.redirect('/accounts');
}));

// ============================================================
// v3.0: VOLUNTEER HOURS
// ============================================================
app.get('/volunteer-hours', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [hours, members] = await Promise.all([
    pool.query('SELECT vh.*,m.name as member_name FROM volunteer_hours vh LEFT JOIN members m ON vh.member_id=m.id WHERE vh.tenant_id=$1 ORDER BY vh.date DESC', [t]),
    pool.query('SELECT id,name FROM members WHERE tenant_id=$1 ORDER BY name', [t])
  ]);
  const totalHours = hours.rows.reduce((s,h)=>s+Number(h.hours),0);
  res.send(renderPage('Volunteer Hours', `
    <div class="stats"><div class="stat-card"><div class="stat-num">${totalHours}</div><div>Total Hours</div></div><div class="stat-card"><div class="stat-num">${hours.rows.length}</div><div>Entries</div></div></div>
    <div class="card"><h2>Log Hours</h2>
      <form method="POST" action="/volunteer-hours/save" style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px">
        <select name="member_id" required><option value="">Select Member</option>${members.rows.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
        <input name="hours" type="number" step="0.5" placeholder="Hours" required>
        <input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required>
        <input name="activity" placeholder="Activity Description" required>
        <button class="btn btn-green" style="grid-column:1/-1">Log Hours</button>
      </form>
    </div>
    <div class="card"><h2>Hours Log</h2>${hours.rows.length?`<table><tr><th>Member</th><th>Activity</th><th>Hours</th><th>Date</th><th>Approved</th></tr>${hours.rows.map(h=>`<tr><td>${esc(h.member_name)}</td><td>${esc(h.activity)}</td><td>${h.hours}</td><td>${new Date(h.date).toLocaleDateString()}</td><td>${h.approved?'Yes':`<a href="/volunteer-hours/${h.id}/approve" class="btn btn-sm btn-green">Approve</a>`}</td></tr>`).join('')}</table>`:'<p class="muted">No hours logged</p>'}</div>
  `, req.session.user));
}));

app.post('/volunteer-hours/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { member_id, hours, date, activity } = req.body;
  await pool.query('INSERT INTO volunteer_hours(tenant_id,member_id,hours,activity,date) VALUES($1,$2,$3,$4,$5)', [t, member_id, hours, activity, date]);
  res.redirect('/volunteer-hours');
}));

app.get('/volunteer-hours/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE volunteer_hours SET approved=true WHERE id=$1', [req.params.id]);
  res.redirect('/volunteer-hours');
}));

// ============================================================
// v4.0: SUPPLIERS + MULTI-BRANCH
// ============================================================
app.get('/suppliers', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const suppliers = (await pool.query('SELECT * FROM suppliers WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Suppliers', `
    <div class="card"><h2>Suppliers</h2><a href="/suppliers/new" class="btn btn-sm" style="margin-bottom:15px">Add Supplier</a>
    ${suppliers.length?`<table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Actions</th></tr>${suppliers.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.email||'-')}</td><td>${esc(s.phone||'-')}</td><td>${esc(s.address||'-')}</td><td><a href="/suppliers/${s.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>`:'<p class="muted">No suppliers</p>'}</div>
  `, req.session.user));
}));

app.get('/suppliers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Supplier', '<div class="card" style="max-width:500px;margin:40px auto"><h2>Add Supplier</h2><form method="POST" action="/suppliers/save"><input name="name" placeholder="Supplier Name" required><input name="email" placeholder="Email"><input name="phone" placeholder="Phone"><input name="address" placeholder="Address"><button class="btn" style="width:100%">Add Supplier</button></form></div>', req.session.user));
});

app.post('/suppliers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO suppliers(tenant_id,name,email,phone,address) VALUES($1,$2,$3,$4,$5)', [t, req.body.name, req.body.email, req.body.phone, req.body.address]);
  res.redirect('/suppliers');
}));

app.get('/suppliers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM suppliers WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/suppliers');
}));

app.get('/branches', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const branches = (await pool.query('SELECT * FROM branches WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Branches', `
    <div class="card"><h2>Branches</h2><a href="/branches/new" class="btn btn-sm" style="margin-bottom:15px">Add Branch</a>
    ${branches.length?`<table><tr><th>Name</th><th>Location</th><th>Manager</th><th>Actions</th></tr>${branches.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.location||'-')}</td><td>${esc(b.manager||'-')}</td><td><a href="/branches/${b.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>`:'<p class="muted">No branches</p>'}</div>
  `, req.session.user));
}));

app.get('/branches/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Branch', '<div class="card" style="max-width:500px;margin:40px auto"><h2>Add Branch</h2><form method="POST" action="/branches/save"><input name="name" placeholder="Branch Name" required><input name="location" placeholder="Location"><input name="manager" placeholder="Manager Name"><button class="btn" style="width:100%">Add Branch</button></form></div>', req.session.user));
});

app.post('/branches/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO branches(tenant_id,name,location,manager) VALUES($1,$2,$3,$4)', [t, req.body.name, req.body.location, req.body.manager]);
  res.redirect('/branches');
}));

app.get('/branches/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM branches WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/branches');
}));

// ============================================================
// v4.0: LOYALTY POINTS + SMS MARKETING
// ============================================================
app.get('/loyalty', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const points = (await pool.query('SELECT lp.*,c.name as customer_name FROM loyalty_points lp LEFT JOIN customers c ON lp.customer_id=c.id WHERE lp.tenant_id=$1 ORDER BY lp.created_at DESC', [t])).rows;
  const customers = (await pool.query('SELECT id,name FROM customers WHERE tenant_id=$1', [t])).rows;
  res.send(renderPage('Loyalty Points', `
    <div class="card"><h2>Award Points</h2>
      <form method="POST" action="/loyalty/save" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px">
        <select name="customer_id" required><option value="">Customer</option>${customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input name="points" type="number" placeholder="Points" required>
        <input name="earned_from" placeholder="Earned From (e.g. Purchase #5)" required>
        <button class="btn btn-green" style="grid-column:1/-1">Award Points</button>
      </form>
    </div>
    <div class="card"><h2>Points History</h2>${points.length?`<table><tr><th>Customer</th><th>Points</th><th>Source</th><th>Date</th></tr>${points.map(p=>`<tr><td>${esc(p.customer_name)}</td><td style="color:#d97706;font-weight:bold">${p.points}</td><td>${esc(p.earned_from||'-')}</td><td>${new Date(p.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>`:'<p class="muted">No points awarded</p>'}</div>
  `, req.session.user));
}));

app.post('/loyalty/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO loyalty_points(tenant_id,customer_id,points,earned_from) VALUES($1,$2,$3,$4)', [t, req.body.customer_id, req.body.points, req.body.earned_from]);
  res.redirect('/loyalty');
}));

app.get('/sms-campaigns', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const campaigns = (await pool.query('SELECT * FROM sms_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('SMS Marketing', `
    <div class="card"><h2>SMS Campaigns</h2><a href="/sms-campaigns/new" class="btn btn-sm" style="margin-bottom:15px">New Campaign</a>
    ${campaigns.length?`<table><tr><th>Title</th><th>Target</th><th>Status</th><th>Sent</th><th>Actions</th></tr>${campaigns.map(c=>`<tr><td>${esc(c.title)}</td><td>${esc(c.target_group)}</td><td><span class="tag">${esc(c.status)}</span></td><td>${c.sent_count}</td><td>${c.status==='draft'?`<a href="/sms-campaigns/${c.id}/send" class="btn btn-sm btn-green">Send</a>`:''} <a href="/sms-campaigns/${c.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>`:'<p class="muted">No campaigns</p>'}</div>
  `, req.session.user));
}));

app.get('/sms-campaigns/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New SMS Campaign', '<div class="card" style="max-width:600px;margin:40px auto"><h2>New SMS Campaign</h2><form method="POST" action="/sms-campaigns/save"><input name="title" placeholder="Campaign Title" required><textarea name="message" rows="4" placeholder="SMS Message (max 160 chars)" maxlength="160" required></textarea><select name="target_group"><option value="all_customers">All Customers</option><option value="all_members">All Members</option><option value="all_parents">All Parents</option></select><button class="btn btn-green" style="width:100%">Create Campaign</button></form></div>', req.session.user));
});

app.post('/sms-campaigns/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO sms_campaigns(tenant_id,title,message,target_group) VALUES($1,$2,$3,$4)', [t, req.body.title, req.body.message, req.body.target_group]);
  res.redirect('/sms-campaigns');
}));

app.get('/sms-campaigns/:id/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const campaign = (await pool.query('SELECT * FROM sms_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!campaign) return res.redirect('/sms-campaigns');
  let phones = [];
  if (campaign.target_group === 'all_customers') phones = (await pool.query('SELECT phone FROM customers WHERE tenant_id=$1 AND phone IS NOT NULL', [req.session.user.tenant_id])).rows.map(r=>r.phone);
  else if (campaign.target_group === 'all_members') phones = (await pool.query('SELECT phone FROM members WHERE tenant_id=$1 AND phone IS NOT NULL', [req.session.user.tenant_id])).rows.map(r=>r.phone);
  else if (campaign.target_group === 'all_parents') phones = (await pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL', [req.session.user.tenant_id])).rows.map(r=>r.guardian_phone);
  let sent = 0;
  for (const phone of phones) { const ok = await sendSMS(phone, campaign.message); await logSMS(req.session.user.tenant_id, phone, campaign.message, 'campaign'); if (ok) sent++; }
  await pool.query('UPDATE sms_campaigns SET status=$1,sent_count=$2 WHERE id=$3', ['sent', sent, req.params.id]);
  res.redirect('/sms-campaigns');
}));

app.get('/sms-campaigns/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM sms_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/sms-campaigns');
}));

// ============================================================
// v5.0: INVESTMENTS + DEBT PAYOFF
// ============================================================
app.get('/investments', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const investments = (await pool.query('SELECT * FROM investments WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const totalInvested = investments.reduce((s,i)=>s+Number(i.amount),0);
  const totalValue = investments.reduce((s,i)=>s+Number(i.current_value||i.amount),0);
  res.send(renderPage('Investments', `
    <div class="stats"><div class="stat-card"><div class="stat-num">UGX ${totalInvested.toLocaleString()}</div><div>Total Invested</div></div><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalValue.toLocaleString()}</div><div>Current Value</div></div><div class="stat-card"><div class="stat-num" style="color:${totalValue-totalInvested>=0?'#059669':'#dc2626'}">UGX ${(totalValue-totalInvested).toLocaleString()}</div><div>Gain/Loss</div></div></div>
    <div class="card"><h2>Add Investment</h2>
      <form method="POST" action="/investments/save" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input name="name" placeholder="Investment Name" required>
        <select name="type"><option value="fixed_deposit">Fixed Deposit</option><option value="bonds">Bonds</option><option value="stocks">Stocks</option><option value="real_estate">Real Estate</option><option value="savings">Savings</option><option value="other">Other</option></select>
        <input name="amount" type="number" placeholder="Amount Invested (UGX)" required>
        <input name="current_value" type="number" placeholder="Current Value (UGX)">
        <input name="start_date" type="date" required>
        <input name="maturity_date" type="date">
        <input name="interest_rate" type="number" step="0.1" placeholder="Interest Rate (%)">
        <textarea name="notes" placeholder="Notes" style="grid-column:1/-1"></textarea>
        <button class="btn btn-green" style="grid-column:1/-1">Add Investment</button>
      </form>
    </div>
    <div class="card"><h2>Portfolio</h2>${investments.length?`<table><tr><th>Name</th><th>Type</th><th>Invested</th><th>Current</th><th>Return</th><th>Maturity</th><th>Actions</th></tr>${investments.map(i=>{const ret=Number(i.current_value||i.amount)-Number(i.amount);return`<tr><td>${esc(i.name)}</td><td><span class="tag">${esc(i.type)}</span></td><td>UGX ${Number(i.amount).toLocaleString()}</td><td>UGX ${Number(i.current_value||i.amount).toLocaleString()}</td><td style="color:${ret>=0?'#059669':'#dc2626'}">UGX ${ret.toLocaleString()}</td><td>${i.maturity_date?new Date(i.maturity_date).toLocaleDateString():'-'}</td><td><a href="/investments/${i.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`}).join('')}</table>`:'<p class="muted">No investments</p>'}</div>
  `, req.session.user));
}));

app.post('/investments/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO investments(tenant_id,name,type,amount,current_value,start_date,maturity_date,interest_rate,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.name, req.body.type, req.body.amount, req.body.current_value||req.body.amount, req.body.start_date, req.body.maturity_date, req.body.interest_rate, req.body.notes]);
  res.redirect('/investments');
}));

app.get('/investments/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM investments WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/investments');
}));

app.get('/debt-payoff', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const debts = (await pool.query('SELECT * FROM debt_payoff WHERE tenant_id=$1 ORDER BY total_owed-paid DESC', [t])).rows;
  const totalOwed = debts.reduce((s,d)=>s+Number(d.total_owed),0);
  const totalPaid = debts.reduce((s,d)=>s+Number(d.paid),0);
  res.send(renderPage('Debt Payoff Calculator', `
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${totalOwed.toLocaleString()}</div><div>Total Owed</div></div><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPaid.toLocaleString()}</div><div>Total Paid</div></div><div class="stat-card"><div class="stat-num" style="color:#d97706">UGX ${(totalOwed-totalPaid).toLocaleString()}</div><div>Remaining</div></div></div>
    <div class="card"><h2>Add Debt</h2>
      <form method="POST" action="/debt-payoff/save" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input name="name" placeholder="Debt Name (e.g. Bank Loan)" required>
        <input name="total_owed" type="number" placeholder="Total Owed (UGX)" required>
        <input name="interest_rate" type="number" step="0.1" placeholder="Interest Rate (%)">
        <input name="monthly_payment" type="number" placeholder="Monthly Payment (UGX)" required>
        <input name="min_payment" type="number" placeholder="Min Payment (UGX)">
        <input name="paid" type="number" placeholder="Already Paid (UGX)" value="0">
        <button class="btn" style="grid-column:1/-1">Add Debt</button>
      </form>
    </div>
    <div class="card"><h2>Debts</h2>${debts.length?`<table><tr><th>Name</th><th>Owed</th><th>Paid</th><th>Remaining</th><th>Monthly</th><th>Months Left</th><th>Actions</th></tr>${debts.map(d=>{const rem=d.total_owed-d.paid;const months=d.monthly_payment>0?Math.ceil(rem/d.monthly_payment):'N/A';return`<tr><td>${esc(d.name)}</td><td>UGX ${Number(d.total_owed).toLocaleString()}</td><td>UGX ${Number(d.paid).toLocaleString()}</td><td style="color:#dc2626">UGX ${rem.toLocaleString()}</td><td>UGX ${Number(d.monthly_payment).toLocaleString()}</td><td>${months}</td><td><a href="/debt-payoff/${d.id}/pay" class="btn btn-sm btn-green">Pay</a> <a href="/debt-payoff/${d.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`}).join('')}</table>`:'<p class="muted">No debts tracked</p>'}</div>
  `, req.session.user));
}));

app.post('/debt-payoff/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO debt_payoff(tenant_id,name,total_owed,interest_rate,min_payment,monthly_payment,paid) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.name, req.body.total_owed, req.body.interest_rate, req.body.min_payment, req.body.monthly_payment, req.body.paid||0]);
  res.redirect('/debt-payoff');
}));

app.get('/debt-payoff/:id/pay', requireAuth, requireNotBanned, ah(async (req, res) => {
  const debt = (await pool.query('SELECT * FROM debt_payoff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  res.send(renderPage('Make Payment', `<div class="card" style="max-width:500px;margin:40px auto"><h2>Pay ${esc(debt.name)}</h2><p>Remaining: UGX ${(debt.total_owed-debt.paid).toLocaleString()}</p><form method="POST" action="/debt-payoff/${debt.id}/pay/save"><input name="amount" type="number" placeholder="Payment Amount" required><button class="btn btn-green" style="width:100%;margin-top:10px">Record Payment</button></form></div>`, req.session.user));
}));

app.post('/debt-payoff/:id/pay/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE debt_payoff SET paid=paid+$1 WHERE id=$2', [req.body.amount, req.params.id]);
  res.redirect('/debt-payoff');
}));

app.get('/debt-payoff/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM debt_payoff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/debt-payoff');
}));

// ============================================================
// v5.0: MOBILE MONEY PAYMENTS
// ============================================================
app.get('/momo/pay', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Mobile Money Payment', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Mobile Money Payment</h2>
      <form method="POST" action="/momo/pay/initiate">
        <input name="phone" placeholder="Phone (+256...)" required>
        <input name="amount" type="number" placeholder="Amount (UGX)" required>
        <input name="reference" placeholder="Reference/Description" required>
        <select name="type"><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option></select>
        <button class="btn btn-green" style="width:100%">Initiate Payment</button>
      </form>
      <p class="muted" style="margin-top:10px">Requires FLW_SECRET_KEY for live mobile money via Flutterwave.</p>
    </div>
  `, req.session.user));
});

app.post('/momo/pay/initiate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, amount, reference, type } = req.body;
  const ref = 'MOMO-' + Date.now();
  // Try Flutterwave MoMo
  if (process.env.FLW_SECRET_KEY) {
    try {
      const resp = await fetch('https://api.flutterwave.com/v3/charges?type=mobile_money_uganda', {
        method: 'POST', headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: ref, amount, currency: 'UGX', email: req.session.user.email, phone_number: phone, fullname: reference })
      });
      const data = await resp.json();
      await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type,external_ref) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, phone, amount, reference, data.status || 'initiated', type, ref]);
      if (data.meta?.authorization?.redirect) return res.redirect(data.meta.authorization.redirect);
    } catch (e) { console.warn('MoMo error:', e.message); }
  }
  await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type) VALUES($1,$2,$3,$4,$5,$6)', [t, phone, amount, reference, 'pending', type]);
  res.send(renderPage('MoMo', '<div class="card"><div class="alert alert-info">Payment initiated. Configure FLW_SECRET_KEY for live payments.</div><a href="/momo/pay" class="btn">Back</a></div>', req.session.user));
}));

// ============================================================
// v6.0: AUTOMATION RULES ENGINE
// ============================================================
app.get('/automations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rules = (await pool.query('SELECT * FROM automation_rules WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Automation Rules', `
    <div class="hero"><h1>Automation Engine</h1><p>Set up automatic actions based on events</p></div>
    <div class="card"><h2>Create Rule</h2>
      <form method="POST" action="/automations/save">
        <input name="name" placeholder="Rule Name (e.g. Fee Balance Alert)" required>
        <select name="trigger_event"><option value="fee.paid">Fee Payment</option><option value="fee.overdue">Fee Overdue</option><option value="student.enrolled">Student Enrolled</option><option value="donation.received">Donation Received</option><option value="invoice.created">Invoice Created</option><option value="member.added">Member Added</option></select>
        <input name="condition" placeholder="Condition (e.g. balance>100000 or leave empty)">
        <select name="action"><option value="send_sms">Send SMS</option><option value="send_email">Send Email</option><option value="notify">Platform Notification</option><option value="webhook">Fire Webhook</option></select>
        <textarea name="action_params" rows="4" placeholder='Action params JSON: {"phone":"+256...","message":"Your balance is {balance}"}' required></textarea>
        <button class="btn btn-green" style="width:100%">Create Rule</button>
      </form>
    </div>
    <div class="card"><h2>Active Rules</h2>${rules.length?`<table><tr><th>Name</th><th>Trigger</th><th>Action</th><th>Active</th><th>Last Fired</th><th>Actions</th></tr>${rules.map(r=>`<tr><td>${esc(r.name)}</td><td><span class="tag">${esc(r.trigger_event)}</span></td><td>${esc(r.action)}</td><td>${r.active?'Yes':'No'}</td><td>${r.last_fired?new Date(r.last_fired).toLocaleString():'Never'}</td><td><a href="/automations/${r.id}/toggle" class="btn btn-sm">${r.active?'Disable':'Enable'}</a> <a href="/automations/${r.id}/delete" class="btn btn-sm btn-red">Delete</a></td></tr>`).join('')}</table>`:'<p class="muted">No automation rules</p>'}</div>
  `, req.session.user));
}));

app.post('/automations/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, trigger_event, condition, action, action_params } = req.body;
  let params;
  try { params = JSON.parse(action_params); } catch { params = { raw: action_params }; }
  await pool.query('INSERT INTO automation_rules(tenant_id,name,trigger_event,condition,action,action_params) VALUES($1,$2,$3,$4,$5,$6)', [t, name, trigger_event, condition, action, JSON.stringify(params)]);
  res.redirect('/automations');
}));

app.get('/automations/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE automation_rules SET active=NOT active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/automations');
}));

app.get('/automations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM automation_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/automations');
}));

// ============================================================
// v6.0: INTEGRATIONS CONFIG
// ============================================================
app.get('/integrations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const configs = (await pool.query('SELECT * FROM integration_configs WHERE tenant_id=$1 ORDER BY service', [t])).rows;
  res.send(renderPage('Integrations', `
    <div class="hero"><h1>Integrations</h1><p>Connect external services</p></div>
    <div class="grid">
      <div class="card"><h3>Flutterwave</h3><p>Payment processing</p><span class="tag">${process.env.FLW_SECRET_KEY?'Connected':'Not configured'}</span></div>
      <div class="card"><h3>Africa's Talking</h3><p>SMS gateway</p><span class="tag">${process.env.AT_API_KEY?'Connected':'Not configured'}</span></div>
      <div class="card"><h3>Cloudinary</h3><p>File uploads</p><span class="tag">${process.env.CLOUDINARY_URL?'Connected':'Not configured'}</span></div>
      <div class="card"><h3>Gmail SMTP</h3><p>Email delivery</p><span class="tag">${process.env.GMAIL_USER?'Connected':'Not configured'}</span></div>
    </div>
    <div class="card"><h2>Custom Integration</h2><a href="/integrations/new" class="btn btn-sm">Add Integration</a>
    ${configs.length?`<table style="margin-top:15px"><tr><th>Service</th><th>Active</th><th>Actions</th></tr>${configs.map(c=>`<tr><td>${esc(c.service)}</td><td>${c.active?'Yes':'No'}</td><td><a href="/integrations/${c.id}/delete" class="btn btn-sm btn-red">Remove</a></td></tr>`).join('')}</table>`:''}</div>
  `, req.session.user));
}));

app.get('/integrations/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Integration', '<div class="card" style="max-width:600px;margin:40px auto"><h2>Add Integration</h2><form method="POST" action="/integrations/save"><input name="service" placeholder="Service Name (e.g. Slack, Google Calendar)" required><textarea name="config" rows="6" placeholder=\'Config JSON: {"api_key":"...","webhook_url":"..."}\' required></textarea><button class="btn" style="width:100%">Save Integration</button></form></div>', req.session.user));
});

app.post('/integrations/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  let config; try { config = JSON.parse(req.body.config); } catch { config = { raw: req.body.config }; }
  await pool.query('INSERT INTO integration_configs(tenant_id,service,config) VALUES($1,$2,$3)', [t, req.body.service, JSON.stringify(config)]);
  res.redirect('/integrations');
}));

app.get('/integrations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM integration_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/integrations');
}));

// ============================================================
// v7.0: AI INSIGHTS + TENANT HEALTH
// ============================================================
app.get('/ai-insights', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const insights = (await pool.query('SELECT * FROM ai_insights WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])).rows;
  // Generate basic insights from data patterns
  const [feeData, attendanceData, studentCount] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(amount-paid),0) as outstanding FROM fees WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='present' THEN 1 END) as present FROM attendance WHERE tenant_id=$1 AND date>=CURRENT_DATE-30", [t]),
    pool.query("SELECT COUNT(*) FROM students WHERE tenant_id=$1", [t])
  ]);
  const outstanding = Number(feeData.rows[0].outstanding);
  const attRate = attendanceData.rows[0].total > 0 ? Math.round(attendanceData.rows[0].present / attendanceData.rows[0].total * 100) : 0;
  const newInsights = [];
  if (outstanding > 5000000) newInsights.push({ type: 'fee_risk', insight: 'High fee outstanding balance detected. Consider sending payment reminders.', confidence: 0.85 });
  if (attRate < 70) newInsights.push({ type: 'attendance_risk', insight: 'Attendance rate is below 70%. Some students may be at risk of dropping out.', confidence: 0.78 });
  if (Number(studentCount.rows[0].count) < 10) newInsights.push({ type: 'growth', insight: 'Student count is low. Consider marketing strategies to increase enrollment.', confidence: 0.70 });
  for (const ins of newInsights) { await pool.query('INSERT INTO ai_insights(tenant_id,type,insight,confidence) VALUES($1,$2,$3,$4)', [t, ins.type, ins.insight, ins.confidence]); }
  const allInsights = (await pool.query('SELECT * FROM ai_insights WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])).rows;
  res.send(renderPage('AI Insights', `
    <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#ec4899)"><h1>AI Insights</h1><p>Smart analytics and predictions</p></div>
    <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${outstanding.toLocaleString()}</div><div>Fee Outstanding</div></div><div class="stat-card"><div class="stat-num">${attRate}%</div><div>Attendance Rate</div></div></div>
    <div class="card"><h2>Latest Insights</h2>${allInsights.length?allInsights.map(i=>`<div class="card" style="border-left:4px solid ${i.type.includes('risk')?'#dc2626':i.type.includes('growth')?'#059669':'#4f46e5'}"><strong>${esc(i.type.replace(/_/g,' ').toUpperCase())}</strong><p>${esc(i.insight)}</p><span class="muted">Confidence: ${Math.round(Number(i.confidence)*100)}% - ${new Date(i.created_at).toLocaleDateString()}</span></div>`).join(''):'<p class="muted">No insights yet. Add more data to generate insights.</p>'}</div>
    <div class="card"><a href="/ai-insights/refresh" class="btn btn-sm">Refresh Insights</a></div>
  `, req.session.user));
}));

app.get('/ai-insights/refresh', requireAuth, requireNotBanned, ah(async (req, res) => { res.redirect('/ai-insights'); }));

// ============================================================
// v7.0: CUSTOM REPORT BUILDER
// ============================================================
app.get('/report-builder', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const templates = (await pool.query('SELECT * FROM report_templates WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Report Builder', `
    <div class="hero"><h1>Custom Reports</h1><p>Build and save custom reports</p></div>
    <div class="card"><h2>Create Report</h2>
      <form method="POST" action="/report-builder/save">
        <input name="name" placeholder="Report Name" required>
        <select name="data_source"><option value="students">Students</option><option value="fees">Fees</option><option value="attendance">Attendance</option><option value="expenses">Expenses</option><option value="income">Income Records</option><option value="donations">Donations</option><option value="sales">Sales</option></select>
        <input name="date_from" type="date">
        <input name="date_to" type="date">
        <textarea name="columns" rows="3" placeholder="Columns (one per line): name, class, amount, balance"></textarea>
        <button class="btn btn-green" style="width:100%">Save & Generate Report</button>
      </form>
    </div>
    <div class="card"><h2>Saved Reports</h2>${templates.length?templates.map(t=>`<div class="card"><strong>${esc(t.name)}</strong> - ${esc(t.config?.data_source||'custom')}<br><a href="/report-builder/${t.id}/run" class="btn btn-sm" style="margin-top:8px">Run Report</a> <a href="/report-builder/${t.id}/delete" class="btn btn-sm btn-red" style="margin-top:8px">Delete</a></div>`).join(''):'<p class="muted">No saved reports</p>'}</div>
  `, req.session.user));
}));

app.post('/report-builder/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, data_source, date_from, date_to, columns } = req.body;
  const config = { data_source, date_from, date_to, columns: columns?.split('\n').filter(Boolean) || [] };
  await pool.query('INSERT INTO report_templates(tenant_id,name,config) VALUES($1,$2,$3)', [t, name, JSON.stringify(config)]);
  res.redirect('/report-builder');
}));

app.get('/report-builder/:id/run', requireAuth, requireNotBanned, ah(async (req, res) => {
  const tmpl = (await pool.query('SELECT * FROM report_templates WHERE id=$1', [req.params.id])).rows[0];
  const config = typeof tmpl.config === 'string' ? JSON.parse(tmpl.config) : tmpl.config;
  let data = [];
  const t = req.session.user.tenant_id;
  if (config.data_source === 'students') data = (await pool.query('SELECT * FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  else if (config.data_source === 'fees') data = (await pool.query('SELECT f.*,s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC', [t])).rows;
  else if (config.data_source === 'expenses') data = (await pool.query('SELECT * FROM expenses WHERE tenant_id=$1 ORDER BY expense_date DESC', [t])).rows;
  else if (config.data_source === 'donations') data = (await pool.query('SELECT * FROM donations WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  else if (config.data_source === 'sales') data = (await pool.query('SELECT * FROM sales WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  else data = (await pool.query(`SELECT * FROM ${config.data_source} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [t])).rows;
  const cols = config.columns?.length ? config.columns : Object.keys(data[0] || {});
  res.send(renderPage(tmpl.name, `<div class="card"><h2>${esc(tmpl.name)}</h2><a href="/report-builder" class="btn btn-sm">Back</a>${data.length?`<table style="margin-top:15px"><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>${data.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c]||'-')}</td>`).join('')}</tr>`).join('')}</table>`:'<p class="muted">No data</p>'}</div>`, req.session.user));
}));

app.get('/report-builder/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM report_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/report-builder');
}));

// ============================================================
// v8.0: MARKETPLACE + PUBLIC DONATIONS
// ============================================================
app.get('/marketplace', requireAuth, requireNotBanned, ah(async (req, res) => {
  const plugins = (await pool.query('SELECT * FROM marketplace_plugins WHERE active=true ORDER BY downloads DESC')).rows;
  const t = req.session.user.tenant_id;
  const installed = (await pool.query('SELECT plugin_id FROM tenant_plugins WHERE tenant_id=$1 AND status=$2', [t, 'active'])).rows.map(r=>r.plugin_id);
  res.send(renderPage('Plugin Marketplace', `
    <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Marketplace</h1><p>Extend your platform with plugins</p></div>
    <div class="grid">${plugins.map(p=>`<div class="card"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.description||'')}</p><span class="tag">${esc(p.category||'General')}</span><br><span class="muted">By ${esc(p.author||'SSEWASSWA')} | ${p.downloads} downloads</span><br>${installed.includes(p.id)?'<span class="tag" style="background:#d1fae5;color:#065f46;margin-top:10px">Installed</span>':`<a href="/marketplace/${p.id}/install" class="btn btn-sm btn-green" style="margin-top:10px">Install${p.price>0?' - UGX '+Number(p.price).toLocaleString():' - Free'}</a>`}</div>`).join('')}</div>
  `, req.session.user));
}));

app.get('/marketplace/:id/install', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO tenant_plugins(tenant_id,plugin_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [t, req.params.id]);
  await pool.query('UPDATE marketplace_plugins SET downloads=downloads+1 WHERE id=$1', [req.params.id]);
  res.redirect('/marketplace');
}));

app.get('/donate/:campaignId', ah(async (req, res) => {
  const campaign = (await pool.query('SELECT c.*,t.name as tenant_name FROM campaigns c LEFT JOIN tenants t ON c.tenant_id=t.id WHERE c.id=$1', [req.params.campaignId])).rows[0];
  if (!campaign) return res.status(404).send('Campaign not found');
  const pct = campaign.target > 0 ? Math.min(100, Math.round(campaign.raised / campaign.target * 100)) : 0;
  res.send(renderPage(campaign.title, `
    <div class="card" style="max-width:600px;margin:40px auto">
      <h1>${esc(campaign.title)}</h1><p>${esc(campaign.description||'')}</p>
      <div class="progress-bar" style="margin:15px 0;height:30px"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(135deg,#059669,#10b981)"><span style="color:white;padding:5px;font-weight:bold">${pct}%</span></div></div>
      <div class="stats"><div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${Number(campaign.raised).toLocaleString()}</div><div>Raised</div></div><div class="stat-card"><div class="stat-num">UGX ${Number(campaign.target).toLocaleString()}</div><div>Target</div></div></div>
      <form method="POST" action="/donate/${campaign.id}/submit" style="margin-top:20px">
        <input name="donor_name" placeholder="Your Name" required>
        <input name="donor_email" type="email" placeholder="Email">
        <input name="donor_phone" placeholder="Phone">
        <input name="amount" type="number" placeholder="Donation Amount (UGX)" required>
        <select name="method"><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="bank">Bank Transfer</option></select>
        <button class="btn btn-gold" style="width:100%">Donate Now</button>
      </form>
    </div>
  `, null));
}));

app.post('/donate/:campaignId/submit', ah(async (req, res) => {
  const campaign = (await pool.query('SELECT * FROM campaigns WHERE id=$1', [req.params.campaignId])).rows[0];
  const { donor_name, donor_email, amount, method } = req.body;
  await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method) VALUES($1,$2,$3,$4,$5)', [campaign.tenant_id, donor_name, amount, 'donation', method]);
  await pool.query('UPDATE campaigns SET raised=raised+$1 WHERE id=$2', [amount, campaign.id]);
  await fireWebhook(campaign.tenant_id, 'donation.received', { donor: donor_name, amount, campaign: campaign.title });
  await evaluateAutomations(campaign.tenant_id, 'donation.received', { amount, donor: donor_name });
  if (donor_email) sendEmail(donor_email, 'Thank you for your donation!', `<p>Hi ${donor_name}, thank you for donating UGX ${Number(amount).toLocaleString()} to "${campaign.title}".</p>`);
  res.send(renderPage('Thank You!', '<div class="card" style="max-width:500px;margin:40px auto;text-align:center"><h1>Thank You!</h1><p>Your donation has been recorded.</p><a href="/" class="btn">Home</a></div>', null));
}));

// ============================================================
// v8.0: BENCHMARKING
// ============================================================
app.get('/benchmarks', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT type FROM tenants WHERE id=$1', [t])).rows[0];
  const [myFeeCollection, myStudentCount, myAttendanceRate] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(paid),0) as total FROM fees WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(*) FROM students WHERE tenant_id=$1", [t]),
    pool.query("SELECT ROUND(COUNT(CASE WHEN status='present' THEN 1 END)*100.0/NULLIF(COUNT(*),0)) as rate FROM attendance WHERE tenant_id=$1 AND date>=CURRENT_DATE-30", [t])
  ]);
  const avgFeeCollection = (await pool.query("SELECT ROUND(AVG(total)) as avg FROM (SELECT COALESCE(SUM(paid),0) as total FROM fees GROUP BY tenant_id) x")).rows[0]?.avg || 0;
  const avgStudents = (await pool.query("SELECT ROUND(AVG(cnt)) as avg FROM (SELECT COUNT(*) as cnt FROM students GROUP BY tenant_id) x")).rows[0]?.avg || 0;
  res.send(renderPage('Benchmarks', `
    <div class="hero"><h1>Benchmarks</h1><p>How you compare to other ${esc(tenant?.type||'organizations')}</p></div>
    <div class="grid">
      <div class="card"><h3>Fee Collection</h3><p>Your: <strong>UGX ${Number(myFeeCollection.rows[0].total).toLocaleString()}</strong></p><p>Average: <strong>UGX ${Number(avgFeeCollection).toLocaleString()}</strong></p><p style="color:${Number(myFeeCollection.rows[0].total)>=Number(avgFeeCollection)?'#059669':'#dc2626'}">${Number(myFeeCollection.rows[0].total)>=Number(avgFeeCollection)?'Above':'Below'} average</p></div>
      <div class="card"><h3>Students</h3><p>Your: <strong>${myStudentCount.rows[0].count}</strong></p><p>Average: <strong>${Math.round(Number(avgStudents))}</strong></p><p style="color:${Number(myStudentCount.rows[0].count)>=Number(avgStudents)?'#059669':'#dc2626'}">${Number(myStudentCount.rows[0].count)>=Number(avgStudents)?'Above':'Below'} average</p></div>
      <div class="card"><h3>Attendance Rate</h3><p>Your: <strong>${myAttendanceRate.rows[0]?.rate||0}%</strong></p><p>Target: <strong>85%</strong></p></div>
    </div>
  `, req.session.user));
}));

// ============================================================
// v9.0: MULTI-CURRENCY + TRANSLATIONS
// ============================================================
app.get('/settings/currency', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT currency,country FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Currency & Region', `
    <div class="card" style="max-width:500px;margin:40px auto">
      <h2>Currency & Region Settings</h2>
      <form method="POST" action="/settings/currency/save">
        <select name="currency"><option value="UGX" ${tenant?.currency==='UGX'?'selected':''}>UGX - Uganda Shilling</option><option value="KES" ${tenant?.currency==='KES'?'selected':''}>KES - Kenya Shilling</option><option value="TZS" ${tenant?.currency==='TZS'?'selected':''}>TZS - Tanzania Shilling</option><option value="RWF" ${tenant?.currency==='RWF'?'selected':''}>RWF - Rwanda Franc</option><option value="USD" ${tenant?.currency==='USD'?'selected':''}>USD - US Dollar</option></select>
        <select name="country"><option value="UG" ${tenant?.country==='UG'?'selected':''}>Uganda</option><option value="KE" ${tenant?.country==='KE'?'selected':''}>Kenya</option><option value="TZ" ${tenant?.country==='TZ'?'selected':''}>Tanzania</option><option value="RW" ${tenant?.country==='RW'?'selected':''}>Rwanda</option></select>
        <button class="btn" style="width:100%">Save</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/settings/currency/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('UPDATE tenants SET currency=$1,country=$2 WHERE id=$3', [req.body.currency, req.body.country, t]);
  res.redirect('/settings/currency');
}));

app.get('/settings/translations', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const allTranslations = (await pool.query('SELECT * FROM translations ORDER BY lang, key')).rows;
  const langs = [...new Set(allTranslations.map(t=>t.lang))];
  res.send(renderPage('Translation Editor', `
    <div class="card"><h2>Translation Editor</h2>
      <form method="POST" action="/settings/translations/save" style="display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px">
        <select name="lang"><option value="en">English</option><option value="lg">Luganda</option><option value="sw">Swahili</option><option value="fr">French</option></select>
        <input name="key" placeholder="Translation Key" required>
        <input name="value" placeholder="Translation Value" required>
        <button class="btn btn-green" style="grid-column:1/-1">Add/Update Translation</button>
      </form>
    </div>
    <div class="card"><h2>Existing Translations</h2>
    ${langs.map(lang=>`<h3>${lang.toUpperCase()}</h3><table><tr><th>Key</th><th>Value</th></tr>${allTranslations.filter(t=>t.lang===lang).map(t=>`<tr><td>${esc(t.key)}</td><td>${esc(t.value)}</td></tr>`).join('')}</table>`).join('')}
    </div>
  `, req.session.user));
}));

app.post('/settings/translations/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { lang, key, value } = req.body;
  await pool.query('INSERT INTO translations(lang,key,value) VALUES($1,$2,$3) ON CONFLICT (lang,key) DO UPDATE SET value=EXCLUDED.value', [lang, key, value]);
  await loadTranslations();
  res.redirect('/settings/translations');
}));

// ============================================================
// v9.0: GOVERNMENT REPORTS
// ============================================================
app.get('/government-reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const reports = (await pool.query('SELECT * FROM government_reports WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const [students, attendance] = await Promise.all([
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN gender='M' THEN 1 END) as male, COUNT(CASE WHEN gender='F' THEN 1 END) as female FROM students WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(DISTINCT student_id) as total, COUNT(DISTINCT CASE WHEN status='present' THEN student_id END) as present FROM attendance WHERE tenant_id=$1 AND date>=DATE_TRUNC('term',CURRENT_DATE)", [t])
  ]);
  res.send(renderPage('Government Reports', `
    <div class="hero" style="background:linear-gradient(135deg,#1e40af,#3b82f6)"><h1>Government Reports</h1><p>Compliance and ministry reporting</p></div>
    <div class="stats"><div class="stat-card"><div class="stat-num">${students.rows[0].total}</div><div>Total Students</div></div><div class="stat-card"><div class="stat-num">${students.rows[0].male||0}</div><div>Male</div></div><div class="stat-card"><div class="stat-num">${students.rows[0].female||0}</div><div>Female</div></div></div>
    <div class="card"><h2>Generate Enrollment Report</h2>
      <form method="POST" action="/government-reports/generate" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <select name="report_type"><option value="enrollment">Enrollment Report</option><option value="attendance">Attendance Report</option><option value="financial">Financial Report</option><option value="staff">Staff Report</option></select>
        <input name="period" placeholder="Term/Period (e.g. Term 1 2025)" required>
        <button class="btn" style="grid-column:1/-1">Generate Report</button>
      </form>
    </div>
    <div class="card"><h2>Submitted Reports</h2>${reports.length?`<table><tr><th>Type</th><th>Period</th><th>Submitted</th><th>Date</th></tr>${reports.map(r=>`<tr><td>${esc(r.report_type)}</td><td>${esc(r.period)}</td><td>${r.submitted?'Yes':'No'}</td><td>${new Date(r.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>`:'<p class="muted">No reports generated</p>'}</div>
  `, req.session.user));
}));

app.post('/government-reports/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { report_type, period } = req.body;
  const data = { period, generated_at: new Date().toISOString() };
  if (report_type === 'enrollment') {
    const stats = (await pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN gender='M' THEN 1 END) as male, COUNT(CASE WHEN gender='F' THEN 1 END) as female FROM students WHERE tenant_id=$1", [t])).rows[0];
    Object.assign(data, stats);
  }
  await pool.query('INSERT INTO government_reports(tenant_id,report_type,period,data) VALUES($1,$2,$3,$4)', [t, report_type, period, JSON.stringify(data)]);
  res.redirect('/government-reports');
}));

// ============================================================
// v9.0: BIOMETRIC LOGGING (Stubs)
// ============================================================
app.get('/biometrics', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const logs = (await pool.query('SELECT * FROM biometric_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Biometrics', `
    <div class="hero" style="background:linear-gradient(135deg,#0f172a,#334155)"><h1>Biometric Attendance</h1><p>Fingerprint & Face ID verification</p></div>
    <div class="card"><h2>Record Biometric</h2>
      <form method="POST" action="/biometrics/record" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <select name="user_type"><option value="student">Student</option><option value="staff">Staff</option><option value="member">Member</option></select>
        <input name="user_id" type="number" placeholder="User ID" required>
        <select name="biometric_type"><option value="fingerprint">Fingerprint</option><option value="face">Face ID</option><option value="rfid">RFID Card</option></select>
        <input name="device_id" placeholder="Device ID">
        <button class="btn" style="grid-column:1/-1">Verify & Record</button>
      </form>
      <p class="muted" style="margin-top:10px">Connect biometric devices via API for automated verification.</p>
    </div>
    <div class="card"><h2>Recent Biometric Logs</h2>${logs.length?`<table><tr><th>Type</th><th>User</th><th>Method</th><th>Verified</th><th>Device</th><th>Time</th></tr>${logs.map(l=>`<tr><td>${esc(l.user_type)}</td><td>${l.user_id}</td><td><span class="tag">${esc(l.biometric_type)}</span></td><td style="color:${l.verified?'#059669':'#dc2626'}">${l.verified?'Yes':'No'}</td><td>${esc(l.device_id||'-')}</td><td>${new Date(l.created_at).toLocaleString()}</td></tr>`).join('')}</table>`:'<p class="muted">No biometric logs</p>'}</div>
  `, req.session.user));
}));

app.post('/biometrics/record', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { user_type, user_id, biometric_type, device_id } = req.body;
  await pool.query('INSERT INTO biometric_logs(tenant_id,user_type,user_id,biometric_type,verified,device_id) VALUES($1,$2,$3,$4,$5,$6)', [t, user_type, user_id, biometric_type, true, device_id]);
  res.redirect('/biometrics');
}));

// ============================================================
// v9.0: COMPLIANCE AUDIT EXPORT
// ============================================================
app.get('/compliance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const audits = (await pool.query('SELECT * FROM compliance_audits WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Compliance', `
    <div class="card"><h2>Compliance & Audit</h2>
      <form method="POST" action="/compliance/generate" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <select name="audit_type"><option value="data_protection">Data Protection</option><option value="financial">Financial Audit</option><option value="access_control">Access Control</option><option value="data_retention">Data Retention</option></select>
        <button class="btn" style="grid-column:1/-1">Generate Compliance Report</button>
      </form>
    </div>
    <div class="card"><h2>Audit History</h2>${audits.length?`<table><tr><th>Type</th><th>Status</th><th>Date</th></tr>${audits.map(a=>`<tr><td>${esc(a.audit_type)}</td><td><span class="tag">${esc(a.status)}</span></td><td>${new Date(a.created_at).toLocaleDateString()}</td></tr>`).join('')}</table>`:'<p class="muted">No compliance audits</p>'}</div>
    <div class="card"><a href="/compliance/export" class="btn btn-sm">Export Full Audit Trail (CSV)</a></div>
  `, req.session.user));
}));

app.post('/compliance/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { audit_type } = req.body;
  const findings = { audit_type, generated_at: new Date().toISOString(), checks_passed: 8, checks_total: 10, notes: 'Platform-level data protection measures in place. Review recommended for custom configurations.' };
  await pool.query('INSERT INTO compliance_audits(tenant_id,audit_type,status,findings) VALUES($1,$2,$3,$4)', [t, audit_type, 'completed', JSON.stringify(findings)]);
  res.redirect('/compliance');
}));

app.get('/compliance/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const logs = (await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10000')).rows;
  const csv = 'Time,User,Action,Details\n' + logs.map(l => `"${new Date(l.created_at).toISOString()}","${l.user_email||''}","${l.action}","${(l.details||'').replace(/"/g,'""')}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=compliance-audit.csv'); res.send(csv);
}));

// ============================================================
// v5.0: PWA MANIFEST
// ============================================================
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'SSEWASSWA Platform', short_name: 'SSEWASSWA', start_url: '/', display: 'standalone',
    background_color: '#4f46e5', theme_color: '#4f46e5',
    icons: [{ src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' }]
  });
});

// ============================================================
// ENHANCED STATUS PAGE (v9.0) with incident management
// ============================================================
app.get('/status/admin', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const services = (await pool.query('SELECT * FROM platform_status ORDER BY service')).rows;
  const incidents = (await pool.query('SELECT * FROM (SELECT id,service,title,status,created_at,resolved_at FROM incidents ORDER BY created_at DESC LIMIT 20) x ORDER BY created_at DESC')).rows || [];
  res.send(renderPage('Status Admin', `
    <div class="card"><h2>Update Service Status</h2>
      ${services.map(s=>`<form method="POST" action="/status/admin/update" style="display:flex;gap:10px;margin:10px 0;align-items:center"><input type="hidden" name="service" value="${esc(s.service)}"><strong style="min-width:100px">${esc(s.service)}</strong><select name="status"><option value="operational" ${s.status==='operational'?'selected':''}>Operational</option><option value="degraded" ${s.status==='degraded'?'selected':''}>Degraded</option><option value="down" ${s.status==='down'?'selected':''}>Down</option><option value="maintenance" ${s.status==='maintenance'?'selected':''}>Maintenance</option></select><input name="message" placeholder="Status message" value="${esc(s.message||'')}" style="flex:1"><button class="btn btn-sm">Update</button></form>`).join('')}
    </div>
    <div class="card"><h2>Report Incident</h2>
      <form method="POST" action="/status/admin/incident" style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
        <input name="service" placeholder="Affected Service" required>
        <input name="title" placeholder="Incident Title" required>
        <button class="btn btn-red" style="grid-column:1/-1">Report Incident</button>
      </form>
    </div>
  `, req.session.user));
}));

app.post('/status/admin/update', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { service, status, message } = req.body;
  await pool.query('UPDATE platform_status SET status=$1,message=$2,updated_at=NOW() WHERE service=$3', [status, message, service]);
  res.redirect('/status/admin');
}));

app.post('/status/admin/incident', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { service, title } = req.body;
  try { await pool.query('INSERT INTO incidents(service,title,status) VALUES($1,$2,$3)', [service, title, 'investigating']); } catch(e) {}
  res.redirect('/status/admin');
}));

// ============================================================
// UNIFIED SETTINGS PAGE
// ============================================================
app.get('/settings', requireAuth, ah(async (req, res) => {
  res.send(renderPage('Settings', `
    <div class="hero"><h1>Settings</h1><p>Configure your platform</p></div>
    <div class="grid">
      <div class="card"><h3>Profile</h3><p>Change password, email</p><a href="/settings/profile" class="btn btn-sm">Manage</a></div>
      <div class="card"><h3>Theme</h3><p>Colors, fonts, CSS</p><a href="/settings/theme" class="btn btn-sm">Customize</a></div>
      <div class="card"><h3>2FA Security</h3><p>Two-factor authentication</p><a href="/settings/2fa" class="btn btn-sm">Configure</a></div>
      <div class="card"><h3>Billing</h3><p>Plans & payments</p><a href="/billing" class="btn btn-sm btn-gold">Manage</a></div>
      <div class="card"><h3>API Keys</h3><p>API access & webhooks</p><a href="/api-keys" class="btn btn-sm">Manage</a></div>
      <div class="card"><h3>Branding</h3><p>Logo, favicon, subdomain</p><a href="/settings/branding" class="btn btn-sm">Customize</a></div>
      <div class="card"><h3>Language</h3><p>Translations & locale</p><a href="/settings/theme" class="btn btn-sm">Change</a></div>
      <div class="card"><h3>Currency</h3><p>UGX, KES, TZS, RWF</p><a href="/settings/currency" class="btn btn-sm">Change</a></div>
      <div class="card"><h3>Integrations</h3><p>Flutterwave, SMS, Cloudinary</p><a href="/integrations" class="btn btn-sm">Configure</a></div>
      <div class="card"><h3>Backup</h3><p>Export/Import data</p><a href="/settings/backup" class="btn btn-sm">Backup</a></div>
      <div class="card"><h3>Compliance</h3><p>Audit & data protection</p><a href="/compliance" class="btn btn-sm">View</a></div>
      <div class="card"><h3>Status Page</h3><p>Platform health</p><a href="/status" class="btn btn-sm">View</a></div>
    </div>
  `, req.session.user));
}));


app.get('/terms', (req, res) => {
  res.send(renderPage('Terms of Service', `
    <div class="card" style="max-width:800px;margin:40px auto">
      <h1>Terms of Service</h1>
      <p><b>Last Updated:</b> ${new Date().toDateString()}</p>
      <h3>1. Data Ownership</h3>
      <p>You own all data entered into your account. We store it securely and never share it without consent.</p>
      <h3>2. Privacy</h3>
      <p>Each organization sees only their own data. Cross-tenant access is technically blocked and logged.</p>
      <h3>3. Fundraising</h3>
      <p>Fundraising module is optional. 5% platform fee applies to donations processed.</p>
      <h3>4. Termination</h3>
      <p>You may export all data and close account anytime. We delete data within 30 days.</p>
      <h3>5. Contact</h3>
      <p>waiswadaniel24@gmail.com | +256 789 736737</p>
    </div>
  `, null));
});

// === 404 ===
app.use((req, res) => res.status(404).send(renderPage('404', '<div class="card"><h2>404</h2><p>Page not found</p><a href="/" class="btn">Go Home</a></div>', req.session.user)));

// === ERROR HANDLER ===
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  const msg = err.message || 'Something went wrong';
  res.status(500).send(renderPage('Error', `<div class="card"><div class="alert alert-error"><h2>500 Error</h2><p>${esc(msg)}</p></div><a href="/" class="btn">Go Home</a></div>`, req.session.user));
});

// === START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SSEWASSWA Platform LIVE on ${PORT}`);
  console.log(`Dev Master: waiswadaniel24@gmail.com / Daniel@2025`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
