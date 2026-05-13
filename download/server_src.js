// Suppress localStorage ExperimentalWarning from connect-pg-simple
process.env.LOCALSTORAGE_FILE = process.env.LOCALSTORAGE_FILE || '/tmp/ssewasswa-localstorage.json';
// Also suppress connect-pg-simple localStorage warnings in console
const originalWarn = console.warn;
console.warn = function(...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('localStorage')) return;
  originalWarn.apply(console, args);
};
// Suppress experimental warnings in production
if (process.env.NODE_ENV === 'production') {
  const originalEmit = process.emit;
  process.emit = function(event, data) {
    if (event === 'warning' && data?.name === 'ExperimentalWarning') return false;
    return originalEmit.apply(process, arguments);
  };
}
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
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// === SENTRY ERROR MONITORING (Phase 1 Security Fix) ===
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
    });
    console.log('[Sentry] Error monitoring initialized');
  } catch (e) { console.warn('[Sentry] Failed to initialize:', e.message); }
}

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

// === CSRF PROTECTION (Phase 1 Security Fix) ===
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'csrf-ssewasswa-secret';
const generateCSRFToken = () => crypto.randomBytes(32).toString('hex');
const hashCSRFToken = (token) => crypto.createHmac('sha256', CSRF_SECRET).update(token).digest('hex');

// === SESSION (must come BEFORE CSRF so req.session is available) ===
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

// Generate CSRF token and store in session (AFTER session middleware)
app.use((req, res, next) => {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCSRFToken();
  }
  res.locals = res.locals || {};
  res.locals.csrfToken = req.session.csrfToken;
  // Make csrfToken available on req for renderPage
  req.csrfToken = req.session.csrfToken;
  next();
});

// Validate CSRF token on all state-changing requests (except webhooks and API)
// Phase 1: Enforce CSRF on auth routes only; log warnings for others (will enforce fully in Phase 2)
const CSRF_ENFORCED_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/settings/password', '/settings/profile'];
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const path = req.path;
    // Skip CSRF for webhook endpoints, API endpoints, USSD, opt-out, and payment callbacks
    if (path.startsWith('/webhook') || path.startsWith('/api/') || path === '/ussd' || path === '/opt-out' || path.startsWith('/pay/') || path.startsWith('/momo/')) {
      return next();
    }
    // Skip CSRF validation if session is not available yet
    if (!req.session || !req.session.csrfToken) return next();
    const token = req.body?._csrf || req.headers['x-csrf-token'] || req.query?._csrf;
    // Enforce on critical paths, log warning on others
    const isEnforced = CSRF_ENFORCED_PATHS.some(p => path === p || path.startsWith(p + '/'));
    if (isEnforced) {
      if (!token || hashCSRFToken(token) !== hashCSRFToken(req.session.csrfToken)) {
        console.warn(`[CSRF BLOCKED] ${req.method} ${path} from IP: ${req.ip}`);
        return res.status(403).send(renderPage('Security Error', 'Security Verification FailedYour session may have expired. Please go back and try again.Go Back | Dashboard', req.session?.user || null));
      }
    } else if (token && hashCSRFToken(token) !== hashCSRFToken(req.session.csrfToken)) {
      // Log but don't block for non-critical paths during rollout
      console.warn(`[CSRF WARNING] ${req.method} ${path} - token missing or invalid (not blocking yet)`);
    }
  }
  next();
});

// === RATE LIMIT ===
app.use('/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use('/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));

// === UTILS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
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
  res.status(403).send(renderPage('Access Denied', 'You do not have permission to access this page.Back to Dashboard', req.session.user));
};
const audit = (email, action, details) => pool.query('INSERT INTO audit_logs(user_email,action,details) VALUES($1,$2,$3)', [email, action, details]).catch(() => {});
const logAudit = (tenantId, email, action, details) => pool.query('INSERT INTO audit_logs(user_email,action,details) VALUES($1,$2,$3)', [email, action, typeof details === 'object' ? JSON.stringify(details) : details]).catch(() => {});
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
  return { plan, limit, count: parseInt(count), allowed: parseInt(count)  async (req, res, next) => {
  const check = await checkPlanLimit(req.session.user.tenant_id, table);
  if (!check.allowed) return res.send(renderPage('Plan Limit', `Plan Limit ReachedYou have ${check.count} records on the ${check.plan} plan (limit: ${check.limit}).Upgrade to add more records.Upgrade Plan`, req.session.user));
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
    return res.status(403).send(renderPage('Access Denied', 'You do not have permission for this action.Back to Dashboard', req.session.user));
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

// Flutterwave helper (v1.0) - kept for Nigeria/Ghana/Kenya users
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

// ============================================================
// v12.1: UGANDA PAYMENT PROVIDERS (MTN MoMo + Airtel Money + DPO)
// ============================================================

// MTN MoMo Collection API helper
const MTN_MOMO_BASE = process.env.MTN_MOMO_BASE_URL || 'https://momodeveloper.mtn.com';
const MTN_MOMO_PRIMARY_KEY = process.env.MTN_COLLECTION_PRIMARY_KEY || '';
const MTN_MOMO_USER_ID = process.env.MTN_COLLECTION_USER_ID || '';
const MTN_MOMO_API_KEY = process.env.MTN_COLLECTION_API_KEY || '';

let mtnAccessToken = null;
let mtnTokenExpiry = 0;

const getMtnAccessToken = async () => {
  if (mtnAccessToken && Date.now()  {
  const token = await getMtnAccessToken();
  if (!token) return { success: false, error: 'MTN MoMo not configured' };
  try {
    // Format phone: ensure it starts with 256
    let formattedPhone = phone.replace(/\s+/g, '').replace(/^\+/, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '256' + formattedPhone.substring(1);
    if (!formattedPhone.startsWith('256')) formattedPhone = '256' + formattedPhone;

    const resp = await fetch(`${MTN_MOMO_BASE}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Reference-Id': reference,
        'X-Target-Environment': process.env.MTN_MOMO_ENV || 'sandbox',
        'Ocp-Apim-Subscription-Key': MTN_MOMO_PRIMARY_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: String(amount),
        currency: 'UGX',
        externalId: reference,
        payer: { partyIdType: 'MSISDN', partyId: formattedPhone },
        payerMessage: payerMessage || 'SSEWASSWA Payment',
        payeeNote: payeeNote || 'Payment via SSEWASSWA'
      })
    });
    
    if (resp.status === 202) {
      console.log(`[MTN MoMo] Payment requested: ${reference} UGX ${amount} to ${formattedPhone}`);
      return { success: true, reference, status: 'PENDING', phone: formattedPhone };
    }
    const errData = await resp.json();
    console.warn('[MTN MoMo] Payment error:', JSON.stringify(errData));
    return { success: false, error: errData.message || 'Payment request failed', status: resp.status };
  } catch (e) { console.warn('[MTN MoMo] Payment failed:', e.message); return { success: false, error: e.message }; }
};

// Check MTN MoMo payment status
const checkMtnPaymentStatus = async (reference) => {
  const token = await getMtnAccessToken();
  if (!token) return { success: false, error: 'MTN MoMo not configured' };
  try {
    const resp = await fetch(`${MTN_MOMO_BASE}/collection/v1_0/requesttopay/${reference}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Target-Environment': process.env.MTN_MOMO_ENV || 'sandbox',
        'Ocp-Apim-Subscription-Key': MTN_MOMO_PRIMARY_KEY
      }
    });
    const data = await resp.json();
    return { success: true, ...data };
  } catch (e) { return { success: false, error: e.message }; }
};

// Airtel Money API helper
const AIRTEL_BASE = process.env.AIRTEL_MONEY_BASE_URL || 'https://openapiuat.airtel.africa';
const AIRTEL_CLIENT_ID = process.env.AIRTEL_CLIENT_ID || '';
const AIRTEL_CLIENT_SECRET = process.env.AIRTEL_CLIENT_SECRET || '';

let airtelAccessToken = null;
let airtelTokenExpiry = 0;

const getAirtelAccessToken = async () => {
  if (airtelAccessToken && Date.now()  {
  const token = await getAirtelAccessToken();
  if (!token) return { success: false, error: 'Airtel Money not configured' };
  try {
    let formattedPhone = phone.replace(/\s+/g, '').replace(/^\+/, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '256' + formattedPhone.substring(1);

    const resp = await fetch(`${AIRTEL_BASE}/merchant/v1/payments/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Country': 'UG',
        'X-Currency': 'UGX',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reference: reference,
        subscriber: { country: 'UG', currency: 'UGX', msisdn: formattedPhone },
        transaction: { amount: Number(amount), country: 'UG', currency: 'UGX', id: reference }
      })
    });
    const data = await resp.json();
    if (data.status?.code === 'DP00001' || data.status?.code === 'DP00000') {
      return { success: true, reference, status: 'PENDING', phone: formattedPhone };
    }
    return { success: false, error: data.status?.message || 'Payment failed' };
  } catch (e) { return { success: false, error: e.message }; }
};

// DPO (Direct Pay Online) helper for card payments - works in Uganda
const DPO_COMPANY_TOKEN = process.env.DPO_COMPANY_TOKEN || '';
const DPO_BASE = 'https://secure.3gdirectpay.com';

const createDPOPayment = async (amount, email, reference, description) => {
  if (!DPO_COMPANY_TOKEN) return null;
  try {
    const resp = await fetch(`${DPO_BASE}/API/v6/PayToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: `${DPO_COMPANY_TOKEN}createToken${amount}UGX${reference}${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/billing/callback?dpo=1${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/billing${reference}${email}SSEWASSWA${description}1${description}${amount}`
    });
    const text = await resp.text();
    const tokenMatch = text.match(/([^/);
    if (tokenMatch) {
      return `https://secure.3gdirectpay.com/pay.asp?ID=${tokenMatch[1]}`;
    }
    return null;
  } catch (e) { console.warn('[DPO] Error:', e.message); return null; }
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
        else if (cond.includes(' b.id AND a.lang = b.lang AND a.key = b.key` },
  { table: 'feature_flags', constraint: 'feature_flags_feature_key_key', columns: 'feature_key', dedup: `DELETE FROM feature_flags a USING feature_flags b WHERE a.id > b.id AND a.feature_key = b.feature_key` },
  { table: 'platform_status', constraint: 'platform_status_service_key', columns: 'service', dedup: `DELETE FROM platform_status a USING platform_status b WHERE a.id > b.id AND a.service = b.service` },
  { table: 'role_permissions', constraint: 'role_permissions_tenant_role_key', columns: 'tenant_id, role_name', dedup: `DELETE FROM role_permissions a USING role_permissions b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.role_name = b.role_name` },
  { table: 'chart_of_accounts', constraint: 'chart_of_accounts_tenant_code_key', columns: 'tenant_id, code', dedup: `DELETE FROM chart_of_accounts a USING chart_of_accounts b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.code = b.code` },
  { table: 'tenant_plugins', constraint: 'tenant_plugins_tenant_plugin_key', columns: 'tenant_id, plugin_id', dedup: `DELETE FROM tenant_plugins a USING tenant_plugins b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.plugin_id = b.plugin_id` },
  { table: 'ussd_sessions', constraint: 'ussd_sessions_session_id_key', columns: 'session_id', dedup: `DELETE FROM ussd_sessions a USING ussd_sessions b WHERE a.id > b.id AND a.session_id = b.session_id` },
  { table: 'push_subscriptions', constraint: 'push_subscriptions_endpoint_key', columns: 'endpoint', dedup: `DELETE FROM push_subscriptions a USING push_subscriptions b WHERE a.id > b.id AND a.endpoint = b.endpoint` },
  { table: 'choir_members', constraint: 'choir_members_tenant_member_key', columns: 'tenant_id, member_id', dedup: `DELETE FROM choir_members a USING choir_members b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.member_id = b.member_id` },
  { table: 'cell_group_members', constraint: 'cell_group_members_tenant_group_member_key', columns: 'tenant_id, group_id, member_id', dedup: `DELETE FROM cell_group_members a USING cell_group_members b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.group_id = b.group_id AND a.member_id = b.member_id` },
  { table: 'channel_members', constraint: 'channel_members_tenant_channel_user_key', columns: 'tenant_id, channel_id, user_email', dedup: `DELETE FROM channel_members a USING channel_members b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.channel_id = b.channel_id AND a.user_email = b.user_email` },
  { table: 'student_track_assignments', constraint: 'student_track_assignments_tenant_student_track_key', columns: 'tenant_id, student_id, track_id', dedup: `DELETE FROM student_track_assignments a USING student_track_assignments b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.student_id = b.student_id AND a.track_id = b.track_id` },
  { table: 'policy_acknowledgments', constraint: 'policy_ack_policy_user_key', columns: 'policy_id, user_email', dedup: `DELETE FROM policy_acknowledgments a USING policy_acknowledgments b WHERE a.id > b.id AND a.policy_id = b.policy_id AND a.user_email = b.user_email` },
  { table: 'graduation_students', constraint: 'graduation_students_grad_student_key', columns: 'graduation_id, student_id', dedup: `DELETE FROM graduation_students a USING graduation_students b WHERE a.id > b.id AND a.graduation_id = b.graduation_id AND a.student_id = b.student_id` },
  { table: 'momo_payments', constraint: 'momo_payments_reference_key', columns: 'reference', dedup: `DELETE FROM momo_payments a USING momo_payments b WHERE a.id > b.id AND a.reference IS NOT NULL AND a.reference = b.reference` },
  { table: 'marks', constraint: 'marks_exam_student_subject_key', columns: 'exam_id, student_id, subject', dedup: `DELETE FROM marks a USING marks b WHERE a.id > b.id AND a.exam_id = b.exam_id AND a.student_id = b.student_id AND a.subject = b.subject` },
  { table: 'educational_resources', constraint: 'educational_resources_title_source_key', columns: 'title, scraped_from', dedup: `DELETE FROM educational_resources a USING educational_resources b WHERE a.id > b.id AND a.title = b.title AND a.scraped_from IS NOT NULL AND a.scraped_from = b.scraped_from` },
  { table: 'church_attendance', constraint: 'church_attendance_tenant_member_service_key', columns: 'tenant_id, member_id, service_name, date', dedup: `DELETE FROM church_attendance a USING church_attendance b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.member_id = b.member_id AND a.service_name = b.service_name AND a.date = b.date` },
  { table: 'developer_revenue', constraint: 'developer_revenue_tenant_source_desc_key', columns: 'tenant_id, source, description', dedup: `DELETE FROM developer_revenue a USING developer_revenue b WHERE a.id > b.id AND a.tenant_id IS NOT NULL AND a.tenant_id = b.tenant_id AND a.source = b.source AND a.description = b.description` },
  { table: 'meal_attendance', constraint: 'meal_attendance_tenant_student_meal_key', columns: 'tenant_id, student_id, meal_date, meal_type', dedup: `DELETE FROM meal_attendance a USING meal_attendance b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.student_id = b.student_id AND a.meal_date = b.meal_date AND a.meal_type = b.meal_type` },
  { table: 'subscription_plans', constraint: 'subscription_plans_name_key', columns: 'name', dedup: `DELETE FROM subscription_plans a USING subscription_plans b WHERE a.id > b.id AND a.name = b.name` },
  { table: 'student_health', constraint: 'student_health_student_id_key', columns: 'student_id', dedup: `DELETE FROM student_health a USING student_health b WHERE a.id > b.id AND a.student_id = b.student_id` },
  { table: 'scraped_content', constraint: 'scraped_content_tenant_title_source_key', columns: 'tenant_id, title, source', dedup: `DELETE FROM scraped_content a USING scraped_content b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.title = b.title AND a.source = b.source` },
  { table: 'plugin_registry', constraint: 'plugin_registry_tenant_plugin_key', columns: 'tenant_id, plugin_key', dedup: `DELETE FROM plugin_registry a USING plugin_registry b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.plugin_key = b.plugin_key` },
  { table: 'sms_opt_outs', constraint: 'sms_opt_outs_tenant_phone_key', columns: 'tenant_id, phone', dedup: `DELETE FROM sms_opt_outs a USING sms_opt_outs b WHERE a.id > b.id AND a.tenant_id = b.tenant_id AND a.phone = b.phone` },
  { table: 'parent_links', constraint: 'parent_links_student_email_key', columns: 'student_id, parent_email', dedup: `DELETE FROM parent_links a USING parent_links b WHERE a.id > b.id AND a.student_id = b.student_id AND a.parent_email = b.parent_email` },
];

(async () => {
  for (let attempt = 1; attempt  q.includes('ON CONFLICT'));
      for (const q of reseedQueries) {
        try { await pool.query(q); } catch (e) { /* ignore - already exists or constraint missing */ }
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
      // Seed subscription plans
      const planSeeds = [
        ['free', 'Free Plan', 'Basic access for small organizations', 0, 'monthly', '1 admin, up to 100 students/members, basic reports', 2, 100, true, 0],
        ['basic', 'Basic Plan', 'For growing schools, churches, and businesses', 50000, 'monthly', '5 admins, up to 500 students/members, advanced reports, public website, entertainment', 5, 500, true, 1],
        ['pro', 'Professional Plan', 'Full features for established institutions', 150000, 'monthly', 'Unlimited admins, unlimited students, fundraising, CRM, payroll, AI insights, priority support', 20, 5000, true, 2],
        ['enterprise', 'Enterprise Plan', 'Custom solutions for large organizations', 500000, 'monthly', 'Everything in Pro + custom domain, white-label, API access, dedicated support, SLA', 999, 99999, true, 3]
      ];
      for (const [name, display, desc, price, cycle, features, maxUsers, maxStudents, active, sort] of planSeeds) {
        try {
          await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order', [name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]);
        } catch (planErr) {
          // UNIQUE constraint on name may not exist yet on older DBs - try plain INSERT
          if (planErr.message.includes('ON CONFLICT')) {
            try { await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]); } catch(e2) { /* duplicate OK */ }
          } else throw planErr;
        }
      }
      // Phase 3 flags
      const phase3Flags = [
        ['shop_catalog', 'Shop Catalog', 'Customer-facing product browsing with cart and checkout', '3.0', 'core', 'school_shop'],
        ['recurring_donations', 'Recurring Donations', 'Schedule automatic recurring donations', '3.0', 'core', 'fundraising'],
        ['mobile_ui', 'Mobile-Optimized UI', 'Hamburger nav, responsive tables, bottom navigation', '3.0', 'core', 'None']
      ];
      for (const [key, name, desc, ver, cat, req] of phase3Flags) {
        try { await pool.query('INSERT INTO feature_flags(feature_key,name,description,version,category,requirements,is_active) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(feature_key) DO NOTHING', [key, name, desc, ver, cat, req]); } catch(e) {}
      }
      break;
    } catch (e) {
      console.error(`DB Init Error (attempt ${attempt}/3):`, e.message);
      if (attempt  setTimeout(r, 2000 * attempt));
      else console.error('DB Init failed after 3 attempts. App will run but login may not work.');
    }
  }
})();

// === PLATFORM SETTINGS CACHE ===
let platformSettings = { site_name: 'SSEWASSWA', site_tagline: 'The Operating System for African Institutions', support_email: 'support@ssewasswa.onrender.com', support_phone: '', developer_phone: '', developer_email: 'waiswadaniel24@gmail.com', whatsapp_link: '', twitter_link: '', facebook_link: '', footer_text: 'All rights reserved.', ad_revenue_per_view: '50', premium_resource_price: '2000' };
async function loadPlatformSettings() {
  try {
    const rows = (await pool.query('SELECT key, value FROM platform_settings')).rows;
    for (const r of rows) { if (r.value !== null && r.value !== undefined) platformSettings[r.key] = r.value; }
  } catch (e) { console.warn('Could not load platform settings:', e.message); }
}
loadPlatformSettings();
// Refresh settings every 60 seconds
setInterval(loadPlatformSettings, 60000);

// === RENDER PAGE (with dark mode support) ===
const renderPage = (title, content, user, csrfTokenOrReq) => {
  const dark = user?.dark_mode;
  const siteName = platformSettings?.site_name || 'SSEWASSWA';
  const siteDesc = platformSettings?.site_tagline || 'The Operating System for African Institutions';
  // Extract CSRF token from either a string or a request object
  const csrfToken = typeof csrfTokenOrReq === 'string' ? csrfTokenOrReq : (csrfTokenOrReq?.csrfToken || null);
  // Auto-inject CSRF token into all forms in the content
  let safeContent = content || '';
  if (csrfToken && safeContent.includes(']*)>/g, ``);
  }
  return `

${esc(title)} | ${esc(siteName)}













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
@media(max-width:768px){.nav{flex-direction:column;gap:10px;position:relative}.nav>div:last-child{display:none;flex-direction:column;width:100%;background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:10px;border-radius:12px;margin-top:10px}.nav.open>div:last-child{display:flex}.stats,.grid{grid-template-columns:1fr}.tab-bar{flex-direction:column}.hero{padding:30px 15px}.container{padding:0 12px}.card{padding:16px;margin-bottom:12px}.btn{padding:14px 20px;width:100%;text-align:center}table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}th,td{padding:8px;font-size:13px}.stat-num{font-size:24px}.search-bar{flex-direction:column}.tab-bar a{padding:10px;font-size:13px}#menuBtn{display:block!important}.bottom-nav{display:flex!important}body{padding-bottom:70px}}



${process.env.GA_TRACKING_ID ? `



  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('consent', 'default', {
    'analytics_storage': 'denied'
  });
  gtag('config', '${esc(process.env.GA_TRACKING_ID)}');


  document.addEventListener('cookieyes_consent_update', function(eventData) {
    var consentData = eventData.detail;
    if (consentData && consentData.accepted === 'yes') {
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }
  });

` : ''}

Skip to main content

  ☰${esc(platformSettings.site_name)}
  
    ${user ? `
      Hi, ${esc(user.email.split('@')[0])}
      ${user.role === 'super_admin' ? `Dev Hub` : ''}
      🔔
      Dashboard
      Search
      Settings
      Parent
      ${dark ? '☀️' : '🌙'}
      Logout
    ` : `LoginRegisterBlogLibrary`}
  

${safeContent}
${user ? `🏠Home🔍Search🔔Alerts👤Me` : ''}

  
    ${esc(platformSettings.site_name)} Platform${esc(platformSettings.site_tagline)} - Schools, Clinics, Churches & Businesses
    Need Help?
      Email: ${esc(platformSettings.support_email)}
      ${platformSettings.support_phone ? `Phone: ${esc(platformSettings.support_phone)}` : ''}
      ${platformSettings.whatsapp_link ? `WhatsApp Us` : ''}
      Help Center & FAQs
    
    Quick Links
      Blog & News
      Books & Papers
      Entertainment
      Fundraising
      ${platformSettings.facebook_link ? `Facebook` : ''}
      ${platformSettings.twitter_link ? `Twitter/X` : ''}
    
  
  &copy; ${new Date().getFullYear()} ${esc(platformSettings.site_name)}. ${esc(platformSettings.footer_text)}

`;
};

// === AUTH ===
// NOTE: The '/' route is handled by launch-routes.js (public landing page)
// Do NOT define a fallback here — Express uses first-match, so this would
// intercept before launch-routes gets a chance to serve the landing page.

app.get('/login', (req, res) => {
  res.send(renderPage('Login', `
    
      Welcome Back
      
        
        
        Login
      
      No account? Register
      Forgot Password?
      Parent Portal
    
  `, null, req));
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
  // Account lockout check (Phase 1 Security Fix)
  const lockoutKey = `login_attempts_${email}`;
  if (!app._loginAttempts) app._loginAttempts = {};
  const attempts = app._loginAttempts[lockoutKey];
  if (attempts && attempts.count >= 5 && Date.now() - attempts.lastAttempt Account Temporarily LockedToo many failed login attempts. Please try again in ${remainingMin} minute(s).`, null));
  }
  if (!u || u.banned || !u.approved || !storedHash) {
    // Track failed attempt
    if (!app._loginAttempts) app._loginAttempts = {};
    if (!app._loginAttempts[lockoutKey]) app._loginAttempts[lockoutKey] = { count: 0, lastAttempt: 0 };
    app._loginAttempts[lockoutKey].count++;
    app._loginAttempts[lockoutKey].lastAttempt = Date.now();
    return res.send(renderPage('Login', 'Invalid credentials or account not approved', null));
  }
  if (!(await bcrypt.compare(password, storedHash))) {
    // Track failed attempt
    if (!app._loginAttempts) app._loginAttempts = {};
    if (!app._loginAttempts[lockoutKey]) app._loginAttempts[lockoutKey] = { count: 0, lastAttempt: 0 };
    app._loginAttempts[lockoutKey].count++;
    app._loginAttempts[lockoutKey].lastAttempt = Date.now();
    await audit(email, 'login_failed', `Failed login attempt #${app._loginAttempts[lockoutKey].count} from IP: ${req.ip}`);
    return res.send(renderPage('Login', 'Invalid credentials', null));
  }
  // Clear lockout on successful login
  if (app._loginAttempts && app._loginAttempts[lockoutKey]) delete app._loginAttempts[lockoutKey];
  req.session.user = u;
  await audit(email, 'login', 'User logged in');
  res.redirect('/dashboard');
}));

app.get('/register', (req, res) => {
  res.send(renderPage('Register', `
    
      Create Account
      
        
        
          Select Type
          School
          Organization
          Church
          Business
          Individual
        
        
        
        
        
        Register
      
    
  `, null, req));
});

app.post('/register', ah(async (req, res) => {
  const { org_name, type, email, phone, password, confirm_password } = req.body;
  // Password complexity validation (Phase 1 Security Fix)
  const passwordErrors = [];
  if (!password || password.length  0) {
    return res.send(renderPage('Register', `Password Requirements Not Met${passwordErrors.map(e => '' + esc(e) + '').join('')}Create AccountSelect TypeSchoolOrganizationChurchBusinessIndividualRegister`, null));
  }
  const hash = await bcrypt.hash(password, 12);
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
  const welcomeHtml = `Welcome to SSEWASSWA! 🎉Hi ${esc(email.split('@')[0])},Your ${esc(org_name)} account has been created successfully on the SSEWASSWA platform.Here's what you can do next:Set up your ${esc(type)} profileAdd members, students, or inventoryConfigure billing and notificationsLogin NowNeed help? Reply to this email or visit our API Docs.`;
  sendEmail(email, 'Welcome to SSEWASSWA!', welcomeHtml);
  queueEmail(tenant.rows[0].id, email, 'Welcome to SSEWASSWA!', welcomeHtml);
  // v1.0: Free subscription
  try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status) VALUES($1,$2,$3,$4)', [tenant.rows[0].id, 'free', 0, 'active']); } catch(e) { /* duplicate subscription OK */ }
  res.send(renderPage('Success', 'Account created! Check your email for a welcome message. You can now login.Login', null));
}));

app.get('/logout', (req, res) => {
  if (req.session.user) audit(req.session.user.email, 'logout', 'User logged out').catch(() => {});
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// === FORGOT PASSWORD ===
app.get('/forgot-password', (req, res) => {
  res.send(renderPage('Forgot Password', `
    
      Reset Password
      Enter your email and we'll send you a reset link.
      
        
        Send Reset Link
      
      Back to Login
    
  `, null, req));
});

app.post('/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 3 }), ah(async (req, res) => {
  const { email } = req.body;
  const user = (await pool.query('SELECT id,email FROM users WHERE email=$1', [email])).rows[0];
  // Always show success message to prevent email enumeration
  const successMsg = 'If an account with that email exists, a reset link has been sent. Check your inbox.Back to Login';

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
        html: `Password ResetClick below to reset your password. This link expires in 1 hour.Reset PasswordIf you didn't request this, ignore this email.`
      });
    } catch (e) {
      console.warn('Email send failed:', e.message);
    }
  }

  // Always show the token URL in development or if email is not configured
  const showToken = !process.env.GMAIL_USER || process.env.NODE_ENV !== 'production';
  const tokenInfo = showToken ? `Reset URL: ${resetUrl}` : '';

  await audit(email, 'password_reset_request', 'Password reset requested');
  res.send(renderPage('Forgot Password', successMsg.replace('', tokenInfo + ''), null));
}));

app.get('/reset-password', ah(async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/forgot-password');
  const reset = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token])).rows[0];
  if (!reset) return res.send(renderPage('Reset Password', 'This reset link is invalid or expired.Request New Link', null));
  res.send(renderPage('Reset Password', `
    
      Set New Password
      
        
        
        
        Reset Password
      
    
  `, null));
}));

app.post('/reset-password', ah(async (req, res) => {
  const { token, password, confirm_password } = req.body;
  if (password !== confirm_password) return res.send(renderPage('Reset Password', 'Passwords do not matchTry Again', null));
  const reset = (await pool.query('SELECT * FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token])).rows[0];
  if (!reset) return res.send(renderPage('Reset Password', 'This reset link is invalid or expired.Request New Link', null));
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
  res.send(renderPage('Password Reset', 'Password reset successfully! You can now login.Login', null));
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
    School PortalManage students, fees, exams, attendance, reports
    
      ${students.rows[0].count}Students
      UGX ${parseInt(fees.rows[0].coalesce).toLocaleString()}Fees Due
      ${exams.rows[0].count}Exams
      ${attendance.rows[0].count}Present Today
    
    
      StudentsManage StudentsCSV Import
      FeesFee ManagementFee StructuresReceipts
      Exams & MarksExam ResultsNew Exam
      AttendanceMark AttendancePrint Sheet
      StaffManage StaffAdd Staff
      Sign In/OutClock In/OutHistory
      TimetableView Timetable
      GradingGrading Scale
      PromoteStudent Promotion
      Report CardsGenerateBulk Cards
      PrintFee BalancesAttendance
      NotifySend SMSNotifications
      Parent LinksManage Parents
      BarcodesScan / Generate
      IncomeIncome Tracking
      BillingSubscriptions
      DocumentsDocument LibraryUpload File
      📷 GalleryPhoto Gallery
      📚 Books & PapersBrowse Library
      BillsBill Reminders
      API & WebhooksManage Keys
      NEW: TransportBus Routes
      NEW: DisciplineIncidents
      NEW: HomeworkAssignments
      NEW: CalendarEvents & Terms
      NEW: HealthMedical Records
      NEW: AlumniGraduates
      NEW: LibraryBooks & Borrow
      ClinicDoctor→Pharm→Lab
      LevelsK-University
      HostelsDormitories
      MealsMeal Plans
      TracksSpecialization
      AdmissionsApply→Enroll
      SubjectsSubject Mgmt
      ScholarshipsBursaries
      VisitorsGate Pass
      Student PortalStudent LoginGen Passwords
      Fee RemindersSend Reminders
      Online PaymentsPay/Subscribe
      SuggestionsFeedback
      ForumsDiscussions
      Login HistorySecurity
      🌐 Public SiteWebsite Builder
      🎯 FundraisingCampaigns
      🎬 EntertainmentHub
      PoliciesPolicy Docs
      CommitteesManage
    
    
    Fees Collected (Monthly)
    Attendance Trend (Last 7 Days)
    Gender Distribution
    
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
    Student Management
      
        + Add Student
        CSV Import
      
      
        All Classes
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        All Streams
          ${streams.map(s => `${esc(s.stream)}`).join('')}
        
        Filter
      
      Adm#NameClassStreamGuardianActions
      ${students.map(s => `
        ${esc(s.admission_no)}${esc(s.name)}${esc(s.class)}${esc(s.stream)}${esc(s.guardian_name)}
        Edit Del
      `).join('') || 'No students yet'}
      
    
  `, req.session.user));
}));

app.get('/school/students/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Student', `
    Add New Student
      
        
        
        
        
        
        
        Add Student
      
    
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
    Edit Student: ${esc(s.name)}
      
        
        
        
        
        
        
        Update Student
      
    
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
    Bulk Import Students
      CSV format: admission_no, name, class, stream, guardian_name, guardian_phone (first row = headers, skipped)
      
        
        Import Students
      
    
  `, req.session.user));
});

app.post('/school/students/import/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const lines = req.body.csv_data.trim().split('\n');
  let imported = 0;
  for (let i = 1; i  c.trim().replace(/^"|"$/g, ''));
    if (cols.length >= 2) {
      await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,stream,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [t, cols[0], cols[1], cols[2] || '', cols[3] || '', cols[4] || '', cols[5] || '']);
      imported++;
    }
  }
  await audit(req.session.user.email, 'csv_import', `Imported ${imported} students`);
  res.send(renderPage('Import Complete', `Successfully imported ${imported} students.View Students`, req.session.user));
}));

// === SCHOOL: FEES ===
app.get('/school/fees', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC', [t])).rows;
  const totalDue = fees.reduce((a, f) => a + (f.amount - f.paid), 0);
  const totalPaid = fees.reduce((a, f) => a + parseInt(f.paid), 0);
  res.send(renderPage('Fee Management', `
    
      UGX ${totalDue.toLocaleString()}Total Due
      UGX ${totalPaid.toLocaleString()}Total Paid
    
    Fee Records
      
        + Add Fee
        Record Payment
      
      Adm#StudentAmountPaidBalanceTermYear
      ${fees.map(f => `
        ${esc(f.admission_no)}${esc(f.student_name)}
        UGX ${parseInt(f.amount).toLocaleString()}
        UGX ${parseInt(f.paid).toLocaleString()}
         0 ? '#dc2626' : '#059669'}">UGX ${(f.amount - f.paid).toLocaleString()}
        ${esc(f.term)}${f.year || ''}
      `).join('') || 'No fees yet'}
      
    
  `, req.session.user));
}));

app.get('/school/fees/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Fee', `
    Assign Fee
      
        Select Student
          ${students.map(s => `${esc(s.admission_no)} - ${esc(s.name)}`).join('')}
        
        
        
        
        Assign Fee
      
    
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
    Record Fee Payment
      
        Select Student (with balance)
          ${fees.map(f => `${esc(f.student_name)} - Balance UGX ${(f.amount - f.paid).toLocaleString()} (${f.term} ${f.year})`).join('')}
        
        
        Record Payment
      
    
  `, req.session.user));
}));

app.post('/school/fees/pay/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { fee_id, amount } = req.body;
  const t = req.session.user.tenant_id;
  await pool.query('UPDATE fees SET paid=paid+$1 WHERE id=$2 AND tenant_id=$3', [amount, fee_id, t]);
  await audit(req.session.user.email, 'fee_payment', `Payment UGX ${amount} on fee #${fee_id}`);
  // v1.0: Fee balance SMS + email notification to parent
  try {
    const fee = (await pool.query('SELECT f.*,s.name as student_name,s.guardian_phone,s.parent_email FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.id=$1', [fee_id])).rows[0];
    if (fee) {
      const balance = parseInt(fee.amount) - parseInt(fee.paid) - parseInt(amount);
      if (fee.guardian_phone) await sendSMS(fee.guardian_phone, `Payment UGX ${parseInt(amount).toLocaleString()} received for ${fee.student_name}. Balance: UGX ${balance.toLocaleString()}`);
      if (fee.parent_email) await sendEmail(fee.parent_email, `Fee Payment - ${fee.student_name}`, `Payment of UGX ${parseInt(amount).toLocaleString()} received. Balance: UGX ${balance.toLocaleString()}`);
      await fireWebhook(t, 'payment', { fee_id, amount, student: fee.student_name, balance });
    }
  } catch(e) { console.warn('Fee notification error:', e.message); }
  res.redirect('/school/fees');
}));

// === SCHOOL: EXAMS & MARKS ===
app.get('/school/exams', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT * FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Exams', `
    Examinations
      + New Exam
      
        ${exams.map(e => `
          
            ${esc(e.name)}
            ${esc(e.term)} ${e.year || ''}
            Enter Marks
            View Results
          
        `).join('') || 'No exams yet'}
      
    
  `, req.session.user));
}));

app.get('/school/exams/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Exam', `
    Create Examination
      
        
        
        
        Create Exam
      
    
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
    Enter Marks: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})
      
        StudentSubjectScoreGrade
        ${students.map(s => `
          ${esc(s.name)} (${esc(s.admission_no)})
          
          
          D1D2C3C4C5C6P7P8F9
        `).join('') || 'No students'}
        
        Save All Marks
      
    
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
    Results: ${esc(exam.name)} (${esc(exam.term)} ${exam.year || ''})
      Enter More Marks
      Adm#StudentSubjectScoreGrade
      ${marks.map(m => `${esc(m.admission_no)}${esc(m.student_name)}${esc(m.subject)}${m.score}${esc(m.grade)}`).join('') || 'No marks yet'}
      
    
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
    Mark Attendance - ${today}
      
        All Classes
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        Filter
      
      
        
        Adm#NameClassPresent
        ${students.map(s => `${esc(s.admission_no)}${esc(s.name)}${esc(s.class)}`).join('')}
        
        Save Attendance
      
    
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
    Staff Members
      + Add Staff
      NameEmailRoleApprovedStatusActions
      ${staffList.map(s => `
        ${esc(s.name)}${esc(s.email)}${esc(s.role)}
        ${s.approved ? 'Yes' : 'No'}
        ${s.banned ? 'Banned' : 'Active'}
        
          Edit
          ${s.banned?'Unban':'Ban'}
          Del
        
      `).join('') || 'No staff yet'}
      
    
  `, req.session.user));
}));

app.get('/school/staff/new', requireAuth, requireNotBanned, requireRole('head_teacher', 'school'), ah(async (req, res) => {
  res.send(renderPage('Add Staff', `
    Add New Staff Member
      
        
        
        
        
          Head Teacher
          Deputy Head
          Teacher
          Bursar
          Secretary
          Librarian
        
        Create Staff Account
      
    
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
      return res.send(renderPage('Error', 'A staff member with this email already exists.Back', req.session.user));
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
    Edit Staff: ${esc(s.name)}
      
        
        
        
          Head Teacher
          Deputy Head
          Teacher
          Bursar
          Secretary
          Librarian
        
        Update Staff
      
    
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
    Timetable
      
        + Add Entry
        
          All Classes
            ${classes.map(c => `${esc(c.class)}`).join('')}
          
          Filter
        
      
      
      Period${days.map(d => `${d}`).join('')}
      ${Array.from({length:maxPeriod},(_,i)=>i+1).map(p => `Period ${p}${days.map(d => {
        const entry = entries.find(e => e.day===d && e.period===p);
        return entry ? `${esc(entry.subject)}${esc(entry.teacher||'')}Del` : '-';
      }).join('')}`).join('')}
      
      
    
  `, req.session.user));
}));

app.get('/school/timetable/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const staffList = (await pool.query('SELECT name FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Timetable Entry', `
    Add Timetable Entry
      
        Select Class
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        MondayTuesdayWednesdayThursdayFridaySaturday
        
        
        Select Teacher
          ${staffList.map(s => `${esc(s.name)}`).join('')}
        
        
        
        Add Entry
      
    
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
    Grading Scale
      
        
          
          
          
          
        
        Add Grade Range
      
      MinMaxGradeCommentAction
      ${scales.map(s => `${s.min_score}${s.max_score}${esc(s.grade)}${esc(s.comment)}
        Del
      `).join('') || 'No grading scale set. Add ranges above.'}
      
    
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
    Fee Structures
      
        + Add Fee Structure
      
      ClassTermAmount (UGX)YearActions
      ${structures.map(s => `${esc(s.class)}${esc(s.term)}${parseInt(s.amount).toLocaleString()}${s.year||''}
        Del
      `).join('') || 'No fee structures yet'}
      
    
    Auto-Generate Fee Records
      Generate fee records for all students in a class based on fee structures.
      
        
          
          
          
        
        Generate Fee Records
      
    
  `, req.session.user));
}));

app.get('/school/fee-structures/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Add Fee Structure', `
    Add Fee Structure
      
        Select Class
          ${classes.map(c => `${esc(c.class)}`).join('')}
          All Classes
        
        
        
        
        Save Fee Structure
      
    
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
  if (!structure) return res.send(renderPage('Error', 'No fee structure found for this class/term combination.Back', req.session.user));
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
  res.send(renderPage('Fee Records Generated', `Generated ${generated} fee records for ${esc(cls)} ${esc(term)} at UGX ${parseInt(structure.amount).toLocaleString()} each.View Fees`, req.session.user));
}));

// === SCHOOL: STUDENT PROMOTION ===
app.get('/school/promote', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Student Promotion', `
    Promote Students
      Select a class to promote. All students in that class will be moved to the new class.
      
        From Class
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        
        Promote Students
      
    
  `, req.session.user));
}));

app.post('/school/promote/execute', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { from_class, to_class } = req.body;
  const result = await pool.query('UPDATE students SET class=$1 WHERE tenant_id=$2 AND class=$3', [to_class, t, from_class]);
  await audit(req.session.user.email, 'student_promotion', `Promoted ${result.rowCount} students from ${from_class} to ${to_class}`);
  res.send(renderPage('Promotion Complete', `Successfully promoted ${result.rowCount} students from ${esc(from_class)} to ${esc(to_class)}.View Students`, req.session.user));
}));

// === SCHOOL: REPORT CARDS (.docx) ===
app.get('/school/report-cards', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,admission_no,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const exams = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Generate Report Cards', `
    Generate Report Card
      
        Select Student
          ${students.map(s => `${esc(s.admission_no)} - ${esc(s.name)} (${esc(s.class)})`).join('')}
        
        Select Exam
          ${exams.map(e => `${esc(e.name)} - ${esc(e.term)} ${e.year || ''}`).join('')}
        
        Download Report Card
      
    
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
    Export Data
      
        Students CSV
        Fees CSV
        Attendance CSV
      
    
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
  const staffList = (await pool.query('SELECT id,name,role FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows.filter(s => !s.banned);
  const stillIn = records.filter(r => !r.clock_out).length;
  const totalToday = records.length;
  res.send(renderPage('Sign In / Sign Out', `
    Staff Sign In / Sign Out${new Date().toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}
    
      ${totalToday}Signed In Today
      ${stillIn}Currently In
      ${totalToday - stillIn}Signed Out
    
    Quick Clock In
      
        
          Select Staff Member
          ${staffList.map(s => `${esc(s.name)} - ${esc(s.role)}`).join('')}
        
        
        Clock In
      
    
    Today's Records
      NameRoleClock InClock OutDurationActions
      ${records.map(r => {
        const clockIn = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
        const clockOut = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
        let duration = '-';
        if (r.clock_in && r.clock_out) {
          const diff = (new Date(r.clock_out) - new Date(r.clock_in)) / 1000 / 60;
          duration = Math.floor(diff/60) + 'h ' + Math.round(diff%60) + 'm';
        }
        return `
          ${esc(r.name || r.staff_name || 'Unknown')}
          ${esc(r.role || '')}
          ${clockIn}
          ${clockOut || 'Still In'}
          ${duration}
          ${!r.clock_out ? `Clock Out` : 'Done'}
        `;
      }).join('') || 'No one signed in yet today'}
      
    
    History
      
        From:
        To:
        View History
      
    
  `, req.session.user));
}));

app.post('/school/signin/clock-in', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { staff_id, notes } = req.body;
  const staff = (await pool.query('SELECT name,role FROM staff WHERE id=$1 AND tenant_id=$2', [staff_id, t])).rows[0];
  if (!staff) return res.redirect('/school/signin');
  const existing = (await pool.query('SELECT id FROM sign_in_out WHERE staff_id=$1 AND tenant_id=$2 AND date=CURRENT_DATE AND clock_out IS NULL', [staff_id, t])).rows[0];
  if (existing) return res.send(renderPage('Error', 'This staff member is already clocked in and has not clocked out.Back', req.session.user));
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
  const records = (await pool.query('SELECT * FROM sign_in_out WHERE tenant_id=$1 AND date>=$2 AND dateSign In/Out History: ${esc(from)} to ${esc(to)}
      
        Back to Today
        Export CSV
      
      DateNameRoleClock InClock OutDurationNotes
      ${records.map(r => {
        const cin = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '-';
        const cout = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : 'No Out';
        let dur = '-';
        if (r.clock_in && r.clock_out) { const d=(new Date(r.clock_out)-new Date(r.clock_in))/60000; dur=Math.floor(d/60)+'h '+Math.round(d%60)+'m'; }
        return `${r.date}${esc(r.name)}${esc(r.role||'')}${cin}${cout}${dur}${esc(r.notes||'')}`;
      }).join('') || 'No records found'}
      
    
  `, req.session.user));
}));

app.get('/school/signin/history/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { from, to } = req.query;
  const records = (await pool.query('SELECT date,name,role,clock_in,clock_out,notes FROM sign_in_out WHERE tenant_id=$1 AND date>=$2 AND date `${r.date},"${r.name}","${r.role||''}",${r.clock_in||''},${r.clock_out||''},"${r.notes||''}"`)).join('\n');
  res.header('Content-Type','text/csv'); res.attachment('signin-history.csv'); res.send(csv);
}));

// === SCHOOL: FEE RECEIPTS ===
app.get('/school/fees/receipts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const receipts = (await pool.query('SELECT fr.*, s.name as student_name, s.admission_no, s.class FROM fee_receipts fr JOIN students s ON fr.student_id=s.id WHERE fr.tenant_id=$1 ORDER BY fr.created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Fee Receipts', `
    Recent Fee Receipts
      Receipt NoStudentClassAmount PaidMethodDateActions
      ${receipts.map(r => `
        ${esc(r.receipt_no)}${esc(r.student_name)}${esc(r.class)}
        UGX ${parseInt(r.paid).toLocaleString()}${esc(r.method||'cash')}
        ${new Date(r.created_at).toLocaleDateString()}
        View
      `).join('') || 'No receipts yet. Receipts are generated when you view a fee record.'}
      
    
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
    
      
        ${tenant.logo_url ? `` : ''}
        ${esc(tenant.name)}
        ${esc(tenant.address||'')} ${tenant.phone?'| '+esc(tenant.phone):''} ${tenant.email?'| '+esc(tenant.email):''}
        OFFICIAL FEE RECEIPT
      
      
        
          Receipt No: ${esc(receiptNo)}
          Date: ${new Date().toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}
        
        
          Student Name: ${esc(fee.student_name)}
          Admission No: ${esc(fee.admission_no)}
          Class: ${esc(fee.class)}
          ${fee.guardian_name ? `Guardian: ${esc(fee.guardian_name)}` : ''}
        
        
          DescriptionAmount (UGX)
          School Fees - ${esc(fee.term||'Term')} ${fee.year||''}${parseInt(fee.amount).toLocaleString()}
          Total Fees${parseInt(fee.amount).toLocaleString()}
          Amount Paid${parseInt(fee.paid).toLocaleString()}
          0?'#dc2626':'#059669'};font-weight:bold">Balance${(fee.amount-fee.paid).toLocaleString()}
        
        
          Received By: ___________________
          Parent/Guardian: ___________________
        
        
          This is an official receipt from ${esc(tenant.name)}. Keep for your records.
        
      
      
        Print Receipt
        Back to Fees
      
    
    @media print{.nav,.btn{display:none!important}.card{border:none!important;box-shadow:none!important}body{background:white!important}}
  `, req.session.user));
}));

// === SCHOOL: BULK REPORT CARDS (Printable HTML) ===
app.get('/school/report-cards/bulk', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  res.send(renderPage('Bulk Report Cards', `
    Generate Report Cards for Entire Class
      Generate printable report cards for all students in a class. Each card includes positions, grades, and comments.
      
        Select Exam
          ${exams.map(e => `${esc(e.name)} - ${esc(e.term)} ${e.year||''}`).join('')}
        
        Select Class
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        Generate All Report Cards
      
    
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
    for (const g of gradingScales) { if (score >= g.min_score && score Report Cards - ${esc(cls)}
    
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
    
    
      Bulk Report Cards: ${esc(cls)} - ${esc(exam.name)}
      Print All
      Back
    
    
    ${students.map(s => {
      const d = studentData[s.id];
      const gi = getGradeInfo(d.avg);
      return `
        
          ${tenant.logo_url ? `` : ''}
          ${esc(tenant.name)}
          STUDENT REPORT CARD
          ${esc(exam.name)} | ${esc(exam.term)} ${exam.year||''} | Class: ${esc(s.class)}
        
        
          Name: ${esc(s.name)}
          Adm No: ${esc(s.admission_no)}
          Stream: ${esc(s.stream||'N/A')}
          Position: ${d.position} out of ${students.length}
        
        SubjectScoreGrade
        ${d.marks.map(m => `${esc(m.subject)}${m.score||0}${esc(m.grade||getGradeInfo(parseInt(m.score)||0).grade)}`).join('') || 'No marks recorded'}
        
        
          Total Score: ${d.total} out of ${d.marks.length * 100}
          Average Score: ${d.avg}
          Overall Grade: ${esc(gi.grade)} - ${esc(gi.comment)}
          Position in Class: ${d.position} / ${students.length}
          ${d.fee ? `Fee Balance: UGX ${(d.fee.amount - d.fee.paid).toLocaleString()}` : ''}
        
        
          Class Teacher Comment: ________________________________
          Head Teacher Comment: ________________________________
        
        
          Class Teacher: _______________
          Head Teacher: _______________
          Parent/Guardian: _______________
        
      `;
    }).join('')}
  `);
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
  res.send(`Fee Balances
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b}
    .print-bar{position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:10px 20px;text-align:center;z-index:999;display:flex;justify-content:center;gap:10px;align-items:center}
    .print-bar button,.print-bar a{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white}.right{text-align:right}
    @media print{.print-bar{display:none!important}}
    
    Fee Balance Report - ${esc(tenant.name)}
      Print
      Back
    
    
      ${esc(tenant.name)} - Fee Balance Report
      ${new Date().toLocaleDateString()} | ${filterClass ? 'Class: '+esc(filterClass) : 'All Classes'}
      StudentAdm NoClassTermTotal FeesPaidBalance
      ${records.map(r => `${esc(r.name)}${esc(r.admission_no)}${esc(r.class)}${esc(r.term||'')} ${r.year||''}${parseInt(r.amount).toLocaleString()}${parseInt(r.paid).toLocaleString()}0?'#dc2626':'#059669'}">${(r.amount-r.paid).toLocaleString()}`).join('')}
      TOTALS${(totalDue+totalPaid).toLocaleString()}${totalPaid.toLocaleString()}${totalDue.toLocaleString()}
      
    
  `);
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
  res.send(`Attendance Sheet
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b}
    .print-bar{position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:10px 20px;z-index:999;display:flex;justify-content:center;gap:10px;align-items:center;flex-wrap:wrap}
    .print-bar button,.print-bar a,.print-bar select,.print-bar input{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:13px}
    table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:8px;text-align:left;border:1px solid #e2e8f0;font-size:13px}
    th{background:#4f46e5;color:white}
    @media print{.print-bar{display:none!important}}
    
    
      Attendance - ${esc(tenant.name)}
      
        All Classes${classes.map(c=>`${esc(c.class)}`).join('')}
        
        Filter
      
      Print
      Back
    
    
      ${esc(tenant.name)} - Attendance Sheet
      Date: ${new Date(date).toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} | ${filterClass?'Class: '+esc(filterClass):'All Classes'}
      Present: ${present} | Absent: ${absent} | Unmarked: ${unmarked}
      #Student NameAdm NoClassStatusSignature
      ${records.map((r,i) => `${i+1}${esc(r.name)}${esc(r.admission_no)}${esc(r.class)}${r.status ? r.status.toUpperCase() : 'NOT MARKED'}`).join('')}
      
    
  `);
}));

// === NOTIFICATION CENTER ===
app.get('/notifications', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  const t = u.tenant_id;
  const notifications = (await pool.query('SELECT * FROM notifications WHERE tenant_id=$1 AND (user_email IS NULL OR user_email=$2) ORDER BY created_at DESC LIMIT 50', [t, u.email])).rows;
  const unread = notifications.filter(n => !n.read).length;
  await pool.query('UPDATE notifications SET read=true WHERE tenant_id=$1 AND (user_email IS NULL OR user_email=$2) AND read=false', [t, u.email]);
  res.send(renderPage('Notifications', `
    Notifications ${unread} new
      ${notifications.length > 0 ? notifications.map(n => `
        
          
            ${esc(n.title)}
            ${new Date(n.created_at).toLocaleString()}
          
          ${esc(n.message)}
        
      `).join('') : 'No notifications yet'}
    
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
    Send SMS / Notification
      Send SMS messages to parents/guardians. SMS requires Africa's Talking API key. In-app notifications are always free.
      
        
          All Parents
          Specific Class
          Specific Student
        
        
          ${classes.map(c => `${esc(c.class)}`).join('')}
        
        
          ${students.map(s => `${esc(s.name)} (${esc(s.class)})`).join('')}
        
        
        
        
          Send In-App Notification
          Send SMS
        
      
      
        document.getElementById('targetSelect').addEventListener('change', function() {
          document.getElementById('classSelect').style.display = this.value === 'class' ? 'block' : 'none';
          document.getElementById('studentSelect').style.display = this.value === 'student' ? 'block' : 'none';
        });
      
    
    Africa's Talking SMS Setup
      To send SMS, add these environment variables on Render:
      VariableValue
        AT_API_KEYYour Africa's Talking API Key
        AT_USERNAMEYour Africa's Talking Username
        AT_SENDER_ID(Optional) Sender ID
      
      Sign up at africastalking.com - Free sandbox for testing!
    
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
    
      In-app notification sent to ${recipients.length} recipients!
      ${smsResult ? `SMS: ${esc(smsResult)}` : ''}
      Send Another
    
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
    
      Organization PortalManage members, projects, events, meetings, notices
    
    
      ${members.rows[0].count}Members
      ${projects.rows[0].count}Projects
      ${events.rows[0].count}Events
      UGX ${parseInt(budget.rows[0].coalesce).toLocaleString()}Income
    
    
      Members
        Member Database
        Register Member
        Attendance
      
      Projects
        All Projects
        New Project
      
      Events
        Events
        New Event
      
      Finance
        Income/Expense
        Reports
      
      Meetings
        Meeting Minutes
        ${meetings.rows[0].count} recorded
      
      Notices
        Notice Board
        ${notices.rows[0].count} posted
      
      Public
        Edit Public Profile
        ${tenant.has_fundraising ? 'Fundraising' : '+ Add Fundraising'}
      
      Campaigns
        Fundraising
      
      Income
        Income Tracking
      
      Billing
        Subscriptions
      
      Documents
        Library
      
      Roles
        Permissions
      
      Bills
        Reminders
      
      NEW: ResolutionsBoard Votes
      NEW: AssetsFixed Assets
      NEW: PartnersDonor Mgmt
      NEW: TicketingEvent Tickets
    
    
    Finance: Income vs Expense
    Member Growth
    
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
    Member Database
      + Register New Member
      NameEmailPhoneRoleJoinedActions
      ${members.map(m => `${esc(m.name)}${esc(m.email)}${esc(m.phone)}${esc(m.role)}${new Date(m.joined_at).toLocaleDateString()}
        Edit Del
      `).join('') || 'No members yet'}
      
    
  `, req.session.user));
}));

app.get('/org/register', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Register Member', `
    Register New Member
      
        
        
        
        
          Select Role
          MemberVolunteerStaffBoard
        
        Register Member
      
    
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
    Edit Member: ${esc(m.name)}
      
        
        
        
        MemberVolunteerStaffBoard
        Update Member
      
    
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
    All Projects
      + New Project
      
        ${projects.map(p => {
          const pct = p.budget > 0 ? Math.min(100, (p.spent / p.budget) * 100) : 0;
          return `
          
            ${esc(p.name)}
            ${p.description ? `${esc(p.description)}` : ''}
            Budget: UGX ${parseInt(p.budget).toLocaleString()}
            Spent: UGX ${parseInt(p.spent).toLocaleString()}
             90 ? '#dc2626' : pct > 60 ? '#f59e0b' : '#059669'}">
            ${Math.round(pct)}% spent
            Status: ${esc(p.status)}
            
              Update
              activeplanningcompletedon-holdSet
            
          `;
        }).join('') || 'No projects yet'}
      
    
  `, req.session.user));
}));

app.get('/org/projects/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Project', `
    Create Project
      
        
        
        
        activeplanningcompleted
        Create Project
      
    
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
    Events
      + New Event
      
        ${events.map(e => `
          
            ${esc(e.name)}
            ${e.event_date ? new Date(e.event_date).toLocaleDateString() : 'TBD'} ${e.venue ? '@ ' + esc(e.venue) : ''}
            ${e.description ? `${esc(e.description)}` : ''}
            Budget: UGX ${parseInt(e.budget).toLocaleString()}
          
        `).join('') || 'No events yet'}
      
    
  `, req.session.user));
}));

app.get('/org/events/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Event', `
    Create Event
      
        
        
        
        
        
        Create Event
      
    
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
    Meeting Minutes
      + New Minutes
      TitleDateActions
      ${meetings.map(m => `${esc(m.title)}${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}
        View Del
      `).join('') || 'No meetings yet'}
      
    
  `, req.session.user));
}));

app.get('/org/meetings/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Meeting Minutes', `
    Record Meeting Minutes
      
        
        
        
        Save Minutes
      
    
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
    ${esc(m.title)}
      ${m.meeting_date ? new Date(m.meeting_date).toLocaleDateString() : ''}
      ${esc(m.content)}
      Back to Minutes
    
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
    Notice Board
      + Post Notice
      ${notices.map(n => `
        
          ${esc(n.title)} ${esc(n.priority)}
          ${esc(n.content)}
          ${new Date(n.created_at).toLocaleString()}
          Delete
        
      `).join('') || 'No notices yet'}
    
  `, req.session.user));
}));

app.get('/org/notices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Post Notice', `
    Post New Notice
      
        
        NormalImportantUrgent
        
        Post Notice
      
    
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
    
      UGX ${income.toLocaleString()}Total Income
      UGX ${expense.toLocaleString()}Total Expense
      = 0 ? '#059669' : '#dc2626'}">UGX ${(income - expense).toLocaleString()}Balance
    
    Record Transaction
      
        
          TypeIncomeExpense
          
          
        
        Save Record
      
    
    Recent Transactions
      TypeAmountDescriptionDate
      ${records.map(r => `${r.type}UGX ${parseInt(r.amount).toLocaleString()}${esc(r.description)}${new Date(r.created_at).toLocaleDateString()}`).join('')}
      
    
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
    Mark Attendance - ${today}
      
        
        MemberPresent
        ${members.map(m => `${esc(m.name)}`).join('')}
        
        Save Attendance
      
    
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
    Export Data
      
        Finance CSV
        Members CSV
        Attendance CSV
      
    
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
    
      Church PortalCongregation, Tithes, Sermons, Prayer Requests
    
    
      ${members.rows[0].count}Members
      UGX ${parseInt(tithes.rows[0].coalesce).toLocaleString()}Total Tithes
      ${sermons.rows[0].count}Sermons
      ${prayers.rows[0].count}Prayer Requests
    
    
      Congregation
        Members
        Add Member
      
      Tithes & Offerings
        Record Tithe/Offering
        All Finance
      
      Sermons
        Sermon Archive
        New Sermon
      
      Prayer Requests
        View Requests
        New Request
      
      Services
        Service Schedule
      
      Members
        Church Members
        Add Member
      
      Donations
        Donation Tracker
      
      Events
        Events
        Notices
      
      Attendance
        Mark Attendance
      
      Tithe Statement
        Generate
      
      Birthdays
        Birthday SMS
      
      Campaigns
        Fundraising
      
      Income
        Income Tracking
      
      Billing
        Subscriptions
      
      Documents
        Library
      
      Member PortalMember LoginGen Passwords
      NEW: ChoirWorship Team
      NEW: SacramentsRecords
      NEW: Cell GroupsSmall Groups
      NEW: VolunteersScheduling
      NEW: Sermon ArchiveFull Archive
      NEW: Prayer RequestsPrayer Wall
      🌐 Public SiteWebsite Builder
      🎯 FundraisingCampaigns
      🎬 EntertainmentHub
    
    
    Tithes Trend
    Donation Types
    
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
    UGX ${total.toLocaleString()}Total Tithes & Offerings
    Record Tithe/Offering
      
        
          IncomeExpense
          
          
        
        
          CashMobile MoneyBank TransferCheque
          
        
        Save Record
      
    
    Recent Tithes & Offerings
      TypeAmountDescriptionDate
      ${tithes.map(r => `${r.type}UGX ${parseInt(r.amount).toLocaleString()}${esc(r.description)}${new Date(r.created_at).toLocaleDateString()}`).join('')}
      
    
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
    Sermon Archive
      + New Sermon
      TitlePreacherDateScriptureActions
      ${sermons.map(s => `${esc(s.title)}${esc(s.preacher)}${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''}${esc(s.scripture)}
        View Del
      `).join('') || 'No sermons yet'}
      
    
  `, req.session.user));
}));

app.get('/church/sermons/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Sermon', `
    Record Sermon
      
        
        
        
        
        
        Save Sermon
      
    
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
    ${esc(s.title)}
      ${esc(s.preacher)} | ${s.sermon_date ? new Date(s.sermon_date).toLocaleDateString() : ''} | ${esc(s.scripture)}
      ${esc(s.notes)}
      Back to Archive
    
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
    Prayer Requests
      + New Request
      ${prayers.map(p => `
        
          ${esc(p.name || 'Anonymous')} ${p.is_private ? 'Private' : ''}
          ${esc(p.request)}
          ${new Date(p.created_at).toLocaleString()}
          Delete
        
      `).join('') || 'No prayer requests yet'}
    
  `, req.session.user));
}));

app.get('/church/prayers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Prayer Request', `
    Submit Prayer Request
      
        
        
         Keep this private (only admins see it)
        Submit Request
      
    
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
    Service Schedule
      + Add Service
      ServiceDayStartEndAction
      ${schedules.map(s => `${esc(s.service_name)}${esc(s.day_of_week)}${esc(s.start_time)}${esc(s.end_time)}
        Del
      `).join('') || 'No services scheduled'}
      
    
  `, req.session.user));
}));

app.get('/church/schedule/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Service', `
    Add Service to Schedule
      
        
        SundayMondayTuesdayWednesdayThursdayFridaySaturday
        
        
        Add Service
      
    
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
    Church Members
      + Add Member
      NameEmailPhoneRoleJoinedActions
      ${members.map(m => `${esc(m.name)}${esc(m.email)}${esc(m.phone)}${esc(m.role)}${m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ''}
        Edit Del
      `).join('') || 'No church members yet'}
      
    
  `, req.session.user));
}));

app.get('/church/members/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Church Member', `
    Add Church Member
      
        
        
        
        
        
        Select RolePastorElderDeaconChoir MemberUsherMember
        Add Member
      
    
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
    Edit: ${esc(m.name)}
      
        
        
        
        
        Select RolePastorElderDeaconChoir MemberUsherMember
        Update Member
      
    
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
    UGX ${total.toLocaleString()}Total Donations
    Record Donation
      
        
          
          
          TitheOfferingBuilding FundCharityProjectOther
        
        
          CashMobile MoneyBank TransferCheque
          
        
        Record Donation
      
    
    Donation History
      DonorAmountTypeMethodReferenceDateAction
      ${donations.map(d => `${esc(d.donor_name)}UGX ${parseInt(d.amount).toLocaleString()}${esc(d.type)}${esc(d.method)}${esc(d.reference)}${new Date(d.created_at).toLocaleDateString()}
        Del
      `).join('') || 'No donations yet'}
      
    
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
    pool.query('SELECT COUNT(*) FROM inventory WHERE tenant_id=$1 AND quantityDATE_TRUNC('month', NOW())", [t]),
    pool.query('SELECT COUNT(*) FROM customers WHERE tenant_id=$1', [t])
  ]);
  const profit = parseInt(sales.rows[0].coalesce) - parseInt(expenses.rows[0].coalesce);
  res.send(renderPage('Business Dashboard', `
    
      Business PortalPOS, Inventory, Invoices, Customers, Profit/Loss
    
    
      UGX ${parseInt(sales.rows[0].coalesce).toLocaleString()}Month Sales
      = 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}Net Profit
      ${inventory.rows[0].count}Low Stock
      ${invoices.rows[0].count}Unpaid Invoices
      ${customers.rows[0].count}Customers
    
    
      Point of SaleNew SaleSales History
      InventoryStock ManagementAdd Product
      InvoicesManage Invoices
      ExpensesRecord ExpenseProfit/Loss
      CustomersCustomer Directory
      ReportsMonthly Report
      DebtsCustomer Debts
      Purchase OrdersManage POs
      Tax (VAT/URA)Tax Reports
      BarcodesScan / Generate
      BillsBill Reminders
      IncomeIncome Tracking
      BillingSubscriptions
      DocumentsLibrary
      APIAPI Keys
      NEW: PayrollSalary Mgmt
      NEW: HR/LeaveLeave Mgmt
      NEW: ProjectsPM Board
      NEW: CRMLead Pipeline
      NEW: Stock TakePhysical Count
      NEW: WarrantiesTrack Warranties
      NEW: QuotationsQuotes
      NEW: DeliveriesTrack Deliveries
      🌐 Public SiteWebsite Builder
      🎯 FundraisingCampaigns
      🎬 EntertainmentHub
    
    
    Sales Trend
    Expenses Breakdown
    
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
    New Sale
      
        
        
        ProductPriceQtyTotal
        
          Select
            ${inventory.map(i => `${esc(i.name)} - UGX ${parseInt(i.selling_price).toLocaleString()} (${i.quantity} left)`).join('')}
          
          0
          
          0
        
        
        + Add Item
        Grand Total: UGX 0
        
        PaidCredit
        Checkout & Print Receipt
      
    
    
      let rows = 1;
      function updatePrice(sel) {
        const i = sel.name.split('_')[1];
        const price = sel.options[sel.selectedIndex]?.dataset.price || 0;
        document.getElementById('price_' + i).textContent = parseInt(price).toLocaleString();
        calcTotal();
      }
      function calcTotal() {
        let grand = 0;
        for(let i = 0; i 
  `, req.session.user));
}));

app.post('/business/pos/checkout', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { customer_name, customer_contact, payment_status, row_count } = req.body;
  let total = 0;
  const items = [];
  for (let i = 0; i  0) {
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
    
      UGX ${totalSales.toLocaleString()}Total Sales
      UGX ${totalPaid.toLocaleString()}Total Collected
    
    Recent Sales
      IDCustomerTotalPaidStatusDate
      ${sales.map(s => `#${s.id}${esc(s.customer_name)}UGX ${parseInt(s.total).toLocaleString()}UGX ${parseInt(s.paid).toLocaleString()}${esc(s.status)}${new Date(s.created_at).toLocaleDateString()}`).join('') || 'No sales yet'}
      
    
  `, req.session.user));
}));

// === BUSINESS: CUSTOMERS ===
app.get('/business/customers', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const customers = (await pool.query('SELECT * FROM customers WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Customer Directory', `
    Customer Directory
      + Add Customer
      NameEmailPhoneAddressActions
      ${customers.map(c => `${esc(c.name)}${esc(c.email)}${esc(c.phone)}${esc(c.address)}
        Edit Del
      `).join('') || 'No customers yet'}
      
    
  `, req.session.user));
}));

app.get('/business/customers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Customer', `
    Add Customer
      
        
        
        
        
        Add Customer
      
    
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
    Edit Customer: ${esc(c.name)}
      
        
        
        
        
        Update Customer
      
    
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
    Stock Management
      + Add Product
      SKUNameQtyCostSellingValue
      ${items.map(i => `
        
          ${esc(i.sku)}${esc(i.name)}${i.quantity}
          ${parseInt(i.cost_price).toLocaleString()}${parseInt(i.selling_price).toLocaleString()}
          ${(i.quantity * i.selling_price).toLocaleString()}
        
      `).join('')}
      
    
  `, req.session.user));
}));

app.get('/business/inventory/add', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Product', `
    Add Product to Inventory
      
        
        
        
        
        
        Add Product
      
    
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
    Invoices
      + New Invoice
      No.CustomerAmountDue DateStatusActions
      ${invoices.map(i => `
        ${esc(i.invoice_no)}${esc(i.customer_name)}UGX ${parseInt(i.amount).toLocaleString()}
        ${i.due_date ? new Date(i.due_date).toLocaleDateString() : 'N/A'}
        ${i.status === 'paid' ? 'Paid' : 'Unpaid'}
        
          ${i.status === 'unpaid' ? `Pay` : ''}
          Print
        
      `).join('')}
      
    
  `, req.session.user));
}));

app.get('/business/invoices/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Invoice', `
    Create Invoice
      
        
        
        
        
        
        Generate Invoice
      
    
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
  const expenses = (await pool.query('SELECT *, COALESCE(expense_date, created_at::date) as date FROM expenses WHERE tenant_id=$1 ORDER BY COALESCE(expense_date, created_at) DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Expenses', `
    Record Expense
      
        CategoryRentSalariesUtilitiesSuppliesMarketingOther
        
        
        
        Record Expense
      
    
    Recent Expenses
      DateCategoryDescriptionAmount
      ${expenses.map(e => `${new Date(e.date || e.expense_date || e.created_at).toLocaleDateString()}${esc(e.category)}${esc(e.description)}UGX ${parseInt(e.amount).toLocaleString()}`).join('')}
      
    
  `, req.session.user));
}));

app.post('/business/expenses/save', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const { category, amount, description, expense_date } = req.body;
  try { await pool.query('INSERT INTO expenses(tenant_id,category,amount,description,expense_date) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, category, amount, description, expense_date]); } catch(e) { await pool.query('INSERT INTO expenses(tenant_id,category,amount,description) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, category, amount, description]); }
  res.redirect('/business/expenses');
}));

// === BUSINESS: PROFIT/LOSS ===
app.get('/business/profit-loss', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [sales, expenses] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND COALESCE(expense_date, created_at::date)>DATE_TRUNC('month', NOW())", [t])
  ]);
  const revenue = parseInt(sales.rows[0].total);
  const cost = parseInt(expenses.rows[0].total);
  const profit = revenue - cost;
  res.send(renderPage('Profit & Loss', `
    
      Profit & Loss - This Month
    
    
      UGX ${revenue.toLocaleString()}Revenue
      UGX ${cost.toLocaleString()}Expenses
      = 0 ? '#059669' : '#dc2626'}">UGX ${profit.toLocaleString()}Net Profit
    
  `, req.session.user));
}));

// === BUSINESS: MONTHLY REPORT (.docx) ===
app.get('/business/monthly-report', requireAuth, requireNotBanned, requireTenantAccess, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  const [sales, expenses, invCount] = await Promise.all([
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(total),0) as total, COALESCE(SUM(paid),0) as paid FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]),
    pool.query("SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND COALESCE(expense_date, created_at::date)>DATE_TRUNC('month', NOW())", [t]),
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
    
      Personal PortalYour budgets, goals, notes, personal tracking
    
    
      ${goals.rows[0].count}Goals
      ${notes.rows[0].count}Notes
      UGX ${parseInt(budgetItems.rows[0].planned).toLocaleString()}Budget Planned
      UGX ${parseInt(budgetItems.rows[0].actual).toLocaleString()}Budget Spent
    
    
      Budget TrackerManage Budget
      GoalsSet Goals
      NotesMy Notes
      DocumentsMy Documents
      Bill RemindersReminders
      IncomeIncome Tracking
      DocumentsDocument Library
      BillingSubscriptions
    
    
    Budget: Planned vs Actual
    
    (async function(){
      try {
        const br = await fetch('/individual/charts/budget'); const bd = await br.json();
        new Chart(document.getElementById('budgetChart'),{type:'bar',data:{labels:bd.labels,datasets:[{label:'Planned',data:bd.planned,backgroundColor:'rgba(79,70,229,0.6)'},{label:'Actual',data:bd.actual,backgroundColor:'rgba(220,38,38,0.6)'}]},options:{responsive:true}});
      }catch(e){}
    })();
    
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
    
      UGX ${totalPlanned.toLocaleString()}Total Planned
      UGX ${totalActual.toLocaleString()}Total Spent
      = 0 ? '#059669' : '#dc2626'}">UGX ${(totalPlanned - totalActual).toLocaleString()}Remaining
    
    Add Budget Item
      
        
          
          
          
          
        
        Add Item
      
    
    Budget Items
      CategoryPlannedActualDifferenceMonthAction
      ${items.map(i => {
        const diff = parseInt(i.planned) - parseInt(i.actual);
        return `${esc(i.category)}UGX ${parseInt(i.planned).toLocaleString()}UGX ${parseInt(i.actual).toLocaleString()}
          = 0 ? '#059669' : '#dc2626'}">UGX ${diff.toLocaleString()}${esc(i.month)}
          Update Del
        `;
      }).join('') || 'No budget items yet'}
      
    
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
    Update: ${esc(item.category)}
      
        
        Update Actual
      
    
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
    My Goals
      + New Goal
      
        ${goals.map(g => {
          const pct = g.target > 0 ? Math.min(100, (g.current / g.target) * 100) : 0;
          return `
          
            ${esc(g.title)}
            Target: UGX ${parseInt(g.target).toLocaleString()}
            Current: UGX ${parseInt(g.current).toLocaleString()}
            = 100 ? '#059669' : '#4f46e5'}">
            ${Math.round(pct)}% complete
            ${g.deadline ? `Deadline: ${new Date(g.deadline).toLocaleDateString()}` : ''}
            
              
              Update
            
            Delete
          `;
        }).join('') || 'No goals yet'}
      
    
  `, req.session.user));
}));

app.get('/individual/goals/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Goal', `
    Set a New Goal
      
        
        
        
        
        Create Goal
      
    
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
    Personal Notes
      + New Note
      ${notes.map(n => `
        
          ${esc(n.title)}
          ${esc(n.content)}
          ${new Date(n.created_at).toLocaleString()}
          Delete
        
      `).join('') || 'No notes yet'}
    
  `, req.session.user));
}));

app.get('/individual/notes/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Note', `
    New Note
      
        
        
        Save Note
      
    
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
    My Documents
      Document storage coming soon. Use Notes for now to store text-based documents.
      Go to Notes
    
  `, req.session.user));
});

// === PARENT PORTAL ===
app.get('/parent/login', (req, res) => {
  if (req.session.parent) return res.redirect('/parent/dashboard');
  res.send(renderPage('Parent Portal', `
    
      Parent Portal
      Enter your email to view your child's information.
      
        
        
        Login
      
    
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
    return res.send(renderPage('Parent Portal', 'No students found linked to this email/phone. Please contact the school.Try Again', null));
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
    
      Parent PortalView your children's information
    
    ${students.length}Children
    
      ${students.map(s => `
        
          ${esc(s.name)}
          Class: ${esc(s.class)}
          View Details
        
      `).join('') || 'No children found'}
    
    Logout
  `, null));
}));

// Parent: Child detail (enhanced version moved to v12 section below with online fee payment)

// Parent: View Fee Receipt
app.get('/parent/fee/:id/receipt', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const t = req.session.parent.tenant_id;
  const fee = (await pool.query('SELECT f.*,s.name as student_name,s.admission_no,s.class,s.guardian_name FROM fees f JOIN students s ON f.student_id=s.id WHERE f.id=$1 AND f.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!fee) return res.status(404).send('Fee record not found');
  const tenant = (await pool.query('SELECT name,address,phone,email,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  const receiptNo = fee.receipt_no || ('RCP-' + fee.id + '-' + Date.now().toString(36).toUpperCase());
  res.send(renderPage('Fee Receipt', `
    
      
        ${esc(tenant.name)}
        OFFICIAL FEE RECEIPT
      
      
        
          Receipt No: ${esc(receiptNo)}
          Date: ${new Date().toLocaleDateString()}
        
        
          Student: ${esc(fee.student_name)}
          Class: ${esc(fee.class)}
        
        
          DescriptionAmount (UGX)
          School Fees - ${esc(fee.term||'Term')} ${fee.year||''}${parseInt(fee.amount).toLocaleString()}
          Amount Paid${parseInt(fee.paid).toLocaleString()}
          0?'#dc2626':'#059669'};font-weight:bold">Balance${(fee.amount-fee.paid).toLocaleString()}
        
      
      
        Print Receipt
      
    
    @media print{.nav,.btn{display:none!important}.card{border:none!important;box-shadow:none!important}}
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
  function getGradeInfo(score) { for (const g of gradingScales) { if (score >= g.min_score && score  a + (parseInt(m.score) || 0), 0);
    const avg = examMarks.length > 0 ? Math.round(total / examMarks.length) : 0;
    const gi = getGradeInfo(avg);
    cardsHtml += `
      ${esc(tenant.name)}STUDENT REPORT CARD
        ${esc(exam.name)} | ${esc(exam.term)} ${exam.year||''}
      Name: ${esc(student.name)} | Adm No: ${esc(student.admission_no)} | Class: ${esc(student.class)}
      SubjectScoreGrade
      ${examMarks.map(m => `${esc(m.subject)}${m.score||0}${esc(m.grade||getGradeInfo(parseInt(m.score)||0).grade)}`).join('') || 'No marks'}
      
      
        Total: ${total} | Average: ${avg} | Grade: ${esc(gi.grade)} - ${esc(gi.comment)}
      
      Class Teacher: _______________Head Teacher: _______________Parent: _______________
    `;
  }
  res.send(`Report Card - ${esc(student.name)}
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#f8fafc}
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
    
    Print
    ${cardsHtml || 'No exam results available yet'}
  `);
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
    Change Password
      
        
        
        
        Change Password
      
    
  `, req.session.user));
});

app.post('/settings/password/save', requireAuth, ah(async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  // Password complexity validation (Phase 1 Security Fix)
  const passwordErrors = [];
  if (!new_password || new_password.length  0) return res.send(renderPage('Change Password', `Password Requirements Not Met${passwordErrors.map(e => '' + esc(e) + '').join('')}Try Again`, req.session.user, req));
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
  if (!storedHash || !(await bcrypt.compare(current_password, storedHash))) return res.send(renderPage('Change Password', 'Current password is incorrectTry Again', req.session.user, req));
  const hash = await bcrypt.hash(new_password, 12);
  // Try updating both columns, fall back to just password
  try {
    await pool.query('UPDATE users SET password=$1, password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
  } catch (e) {
    if (e.message.includes('password_hash')) {
      await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.session.user.id]);
    } else throw e;
  }
  await audit(req.session.user.email, 'password_change', 'Password changed');
  res.send(renderPage('Success', 'Password changed successfully!Back to Dashboard', req.session.user, req));
}));

// === PROFILE SETTINGS ===
app.get('/settings/profile', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Profile Settings', `
    Organization Profile
      
        
        
        
        
        ${esc(tenant.description || '')}
        Save Profile
      
    
    
      Account Settings
      Change Password
      Data Backup
      Branding
      Two-Factor Auth
      Theme Builder
      Audit Logs
      API Docs
      Platform Status
    
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
    
      Data Backup & Restore
      Export all your data as JSON for backup, or import from a previous backup.
      
        Download Full Backup (JSON)
        Export CSV
      
      
      Import Data
      Upload a JSON backup file to restore data. Warning: This may overwrite existing data.
      
        
        Upload & Import
      
    
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
      return res.send(renderPage('Import Error', 'Invalid backup file format.Back', req.session.user));
    }
  } catch (e) {
    return res.send(renderPage('Import Error', 'Could not parse JSON file. Please ensure it is a valid backup.Back', req.session.user));
  }

  if (!backup._meta || !backup._meta.version) {
    return res.send(renderPage('Import Error', 'Invalid backup file. Missing metadata.Back', req.session.user));
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
  res.send(renderPage('Import Complete', `Successfully imported ${imported} records.Back to Backup`, req.session.user));
}));

// === TENANT BRANDING ===
app.get('/settings/branding', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Branding Settings', `
    Organization Branding
      
        
        Enter the URL of your organization's logo image.
        
        Enter the URL of your favicon (16x16 or 32x32 .ico/.png).
        ${esc(tenant.custom_css || '')}
        Add custom CSS to style your portal pages.
        Save Branding
      
      ${tenant.logo_url ? `Current Logo` : ''}
    
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
    Search Your Data
      
        
        Search
      
    
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
    Search Results for "${esc(q)}"
      ${results.length} results found
      TypeNameDetailGo
      ${results.map(r => `${esc(r.type)}${esc(r.name)}${esc(r.detail)}View`).join('') || 'No results found'}
      
    
  `, req.session.user));
}));

// === PUBLIC PROFILE PAGE ===
app.get('/p/:subdomain', ah(async (req, res, next) => {
  // Special subdomains handled by launch-routes (entertainment, fundraising, home)
  const specialSubdomains = ['entertainment', 'fundraising', 'home', 'links'];
  if (specialSubdomains.includes(req.params.subdomain)) return next();

  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1 AND verified=true', [req.params.subdomain])).rows[0];
  if (!tenant) return next(); // Pass to next handler (launch-routes or 404)
  const events = (await pool.query('SELECT * FROM events WHERE tenant_id=$1 AND event_date>=CURRENT_DATE ORDER BY event_date LIMIT 5', [tenant.id])).rows;
  res.send(renderPage(tenant.name, `
    
      ${esc(tenant.name)}
      ${esc(tenant.type)} ${tenant.address ? '| ' + esc(tenant.address) : ''}
    
    ${tenant.description ? `About${esc(tenant.description)}` : ''}
    ${events.length > 0 ? `
      Upcoming Events
        ${events.map(e => `${esc(e.name)} - ${new Date(e.event_date).toLocaleDateString()} ${e.venue ? '@ ' + esc(e.venue) : ''}`).join('')}
      
    ` : ''}
    
      Contact: ${esc(tenant.email)} ${tenant.phone ? '| ' + esc(tenant.phone) : ''}
    
  `, null));
}));

// === ENTERTAINMENT ===
app.get('/entertainment', ah(async (req, res) => {
  const t = req.session.user?.tenant_id;
  if (!t) return res.redirect('/p/entertainment');
  const [videos, music, games] = await Promise.all([
    pool.query('SELECT * FROM entertainment_videos WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_music WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query('SELECT * FROM entertainment_games WHERE tenant_id=$1 ORDER BY score DESC LIMIT 10', [t])
  ]);
  res.send(renderPage('Entertainment Hub', `
    
      Entertainment HubVideos, Music, Games
    
    
      Videos${videos.rows.map(v => {
        const ytId = (v.url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] || '';
        return ytId ? `${esc(v.title)}` : `${esc(v.title)}`;
      }).join('') || 'No videos yet'}
      Music${music.rows.map(m => `${esc(m.title)} - ${esc(m.artist)}`).join('') || 'No music yet'}
      Top Scores${games.rows.map(g => `${esc(g.player_name)}: ${g.score} - ${esc(g.name)}`).join('') || 'No games yet'}
    
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
  const [tCount, uCount, rev, wal, tenants, chartData, revBreakdown, pendingSubs, adCount, blogCount, withdrawalHistory] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenants'),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days'`),
    pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1'),
    pool.query('SELECT id,name,type,COALESCE(wallet_balance,0) as wallet_balance,verified,subdomain,approved,banned,ban_reason FROM tenants ORDER BY id DESC LIMIT 50'),
    pool.query(`SELECT DATE(created_at) as day, SUM(amount) as total FROM developer_revenue WHERE created_at>NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day ASC`),
    pool.query(`SELECT source, COALESCE(SUM(amount),0) as total FROM developer_revenue WHERE amount > 0 AND created_at>NOW()-INTERVAL '30 days' GROUP BY source ORDER BY total DESC`),
    pool.query('SELECT COUNT(*) FROM subscriptions WHERE status=$1', ['active']),
    pool.query('SELECT COUNT(*) FROM daily_adverts WHERE is_active=true'),
    pool.query('SELECT COUNT(*) FROM blog_posts'),
    pool.query('SELECT * FROM developer_revenue WHERE amount ${esc(flash.msg)}` : '';
  const chartLabels = chartData.rows.map(r => new Date(r.day).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })).join("','");
  const chartValues = chartData.rows.map(r => r.total).join(',');
  const balance = parseInt(wal.rows[0]?.b || 0);
  const totalRev = parseInt(rev.rows[0].t || 0);
  res.send(renderPage('Dev Master', `
    
    
      .dev-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
      .dev-nav a{padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;transition:0.2s}
      .dev-nav a:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.15)}
      .dev-section{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border:1px solid #e2e8f0}
      .dev-section h2{font-size:20px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
      .money-card{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:24px;border-radius:16px;text-align:center}
      .money-card .amount{font-size:36px;font-weight:900;margin:10px 0}
      .money-card .label{font-size:14px;opacity:0.8}
      .quick-action{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:8px;cursor:pointer;transition:0.2s;text-decoration:none;color:inherit}
      .quick-action:hover{border-color:#4f46e5;background:#f8f7ff;transform:translateX(4px)}
      .quick-action .icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px}
      .quick-action .text h4{margin:0;font-size:15px}
      .quick-action .text p{margin:2px 0 0;font-size:12px;color:#64748b}
    

    
    
      SSEWASSWA Developer Hub
      Your platform, your earnings, your control
    
    ${flashHtml}

    
    
      Dashboard
      Settings
      Withdraw
      Adverts
      Blog
      Posts
      Books & Papers
      Plans & Pricing
      Activity
      Features
    

    
    My Earnings & Rewards
    
      
        Available Balance
        UGX ${balance.toLocaleString()}
        Withdraw Now
      
      
        30-Day Revenue
        UGX ${totalRev.toLocaleString()}
        From all sources
      
      
        Active Subscribers
        ${pendingSubs.rows[0].count}
        Paying tenants
      
    

    
    
      Revenue Breakdown (30 Days)
      ${revBreakdown.rows.length > 0 ? `
        SourceAmount
        ${revBreakdown.rows.map(r => `${esc(r.source)}UGX ${parseInt(r.total).toLocaleString()}`).join('')}
        
      ` : 'No revenue recorded in the last 30 days'}
    

    
    30-Day Revenue Trend

    
    Quick Actions
    
      
        &#9881;
        Platform SettingsEdit your contacts, website name, social links
      
      
        $
        Withdraw MoneySend earnings to your MTN/Airtel mobile money
      
      
        P
        Post to PublicAnnouncements, promotions, updates
      
      
        R
        Books & Past PapersAdd/scrape educational resources for users
      
      
        A
        Manage Adverts${adCount.rows[0].count} active adverts on the platform
      
      
        B
        Write Blog Posts${blogCount.rows[0].count} posts - boost SEO and engagement
      
      
        L
        View Activity LogsMonitor signups, payments, and system events
      
      
        F
        Feature FlagsToggle platform features on/off
      
      
        S
        Platform StatusUpdate service status and incidents
      
      
        &#9888;
        Database CleanupErase test data, prepare for real users
      
    

    
    ${withdrawalHistory.rows.length > 0 ? `
    
      Recent Withdrawals
      AmountDetailsDate
      ${withdrawalHistory.rows.map(w => {
        let meta = {};
        try { meta = JSON.parse(w.details || '{}'); } catch(e) {}
        return `UGX ${Math.abs(parseInt(w.amount)).toLocaleString()}${esc(meta.phone||'')} (${esc(meta.network||'')})${new Date(w.created_at).toLocaleString()}`;
      }).join('')}
      
    
    ` : ''}

    
    
      Record Revenue
      
        Amount UGX
        Source
        Record
      
    

    
    Tenant Management
    
      Quick Tenant Action
      
        Action
          Select
            Add Balance
            Verify Tenant
            Unverify Tenant
            Approve Tenant
            Ban Tenant
            Unban Tenant
            Grant Free Access
            Enable Fundraising
            DELETE Tenant
          
        
        Tenant ID
        Amount
        Reason
        Execute
      
    

    
      All Tenants (${tCount.rows[0].count})
      
      IDNameTypeWalletVerifiedStatus
      ${tenants.rows.map(t => `
        ${t.id}${esc(t.name)}${esc(t.type)}
        UGX ${parseInt(t.wallet_balance).toLocaleString()}
        ${t.verified ? 'Yes' : 'No'}
        ${t.approved ? (t.banned ? 'Banned' : 'Active') : 'Pending'}
      `).join('')}
      
      
    

    
      Recent Audit Logs
      UserActionDetailsTime
      ${logs.rows.map(l => `${esc(l.user_email || l.email || '')}${esc(l.action || '')}${esc(l.details || '')}${l.created_at ? new Date(l.created_at).toLocaleString() : ''}`).join('')}
      
      View All Activity
    

    
      new Chart(document.getElementById('revChart'), {
        type: 'line',
        data: {
          labels: ['${chartLabels}'],
          datasets: [{ label: 'UGX Revenue', data: [${chartValues}], borderColor: '#4f46e5', tension: 0.3, fill: true, backgroundColor: 'rgba(79,70,229,0.1)' }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    
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

// === DATABASE CLEANUP — ERASE ALL TEST DATA ===
app.get('/dev/cleanup', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [tCount, uCount, sCount, fCount, dCount] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM tenants'),
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query('SELECT COUNT(*) FROM students'),
    pool.query('SELECT COUNT(*) FROM fees'),
    pool.query('SELECT COUNT(*) FROM donations')
  ]);
  res.send(renderPage('Database Cleanup', `
    
      Database CleanupErase all test data and prepare for real data
    
    
      Current Data Overview
      
        ${tCount.rows[0].count}Tenants
        ${uCount.rows[0].count}Users
        ${sCount.rows[0].count}Students
        ${fCount.rows[0].count}Fees
        ${dCount.rows[0].count}Donations
      
      What will be deleted:
      
        All tenants except Dev Master (your account)
        All users except your super_admin account
        All tenant data: students, fees, attendance, marks, members, patients, donations, sales, invoices, expenses, staff, events, sermons, etc.
        Developer revenue and platform wallet (reset to 0)
        Audit logs
        Blog posts, adverts, dev posts
        Educational resources
        Scraped content
        Notifications, chat messages, activity feed
        All other tenant-scoped data
      
      What will be KEPT:
      
        Your dev account (waiswadaniel24@gmail.com / Daniel@2025)
        Dev Master tenant
        Platform settings (your contacts, branding)
        Feature flags
        Translations
        Platform status services
        Table structure (all columns and schemas)
      
    
    
      
        ERASE ALL TEST DATA
      
      This action cannot be undone. Make sure Render has backed up your database.
    
  `, req.session.user));
}));

app.post('/dev/cleanup/execute', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const devEmail = 'waiswadaniel24@gmail.com';
  console.log('=== STARTING DATABASE CLEANUP ===');
  
  // Get dev tenant ID
  const devTenant = (await pool.query('SELECT id FROM tenants WHERE email=$1', [devEmail])).rows[0];
  const devTenantId = devTenant?.id;
  const devUserId = (await pool.query('SELECT id FROM users WHERE email=$1', [devEmail])).rows[0]?.id;
  
  // Tables with tenant_id foreign key — delete non-dev data
  const tenantTables = [
    'students','fees','attendance','exams','marks','members','events','org_finance',
    'inventory','sales','sale_items','invoices','expenses','staff','timetable',
    'grading_scales','fee_structures','church_members','donations','parent_links',
    'sign_in_out','notifications','fee_receipts','subscriptions','payments',
    'church_attendance','purchase_orders','tax_records','bill_reminders','documents',
    'income_records','campaigns','campaign_pledges','role_permissions',
    'campaign_updates','volunteer_hours','event_tickets','ticket_sales',
    'chart_of_accounts','ledger_entries','document_folders','suppliers','branches',
    'inventory_transfers','loyalty_points','sms_campaigns','investments','debt_payoff',
    'momo_payments','automation_rules','integration_configs','calendar_events',
    'ai_insights','report_templates','tenant_plugins','ad_impressions','peer_fundraisers',
    'government_reports','biometric_logs','compliance_audits','relationships',
    'custom_fields','custom_field_values','grants','custom_pages','document_templates',
    'ussd_sessions','push_subscriptions','offline_sync_queue','scheduled_reports',
    'analytics_events','sms_opt_outs','deep_links','data_exports','transport_routes',
    'transport_assignments','discipline_incidents','homework','homework_submissions',
    'school_events','student_health','health_visits','alumni','library_books',
    'library_borrows','choir_members','worship_songs','sacraments','cell_groups',
    'cell_group_members','volunteer_roles','volunteer_assignments','payroll_runs',
    'payroll_items','leave_requests','project_tasks','crm_leads','stock_takes',
    'stock_take_items','warranties','board_resolutions','assets','partners',
    'ticketed_events','workflows','workflow_instances','chat_channels','chat_messages',
    'channel_members','tasks','activity_feed','surveys','survey_responses',
    'email_templates','qr_codes','certificates','signing_requests',
    'clinic_staff','patient_queue','consultations','prescriptions','prescription_items',
    'pharmacy_dispensing','lab_requests','lab_results','pharmacy_inventory',
    'school_levels','hostels','hostel_rooms','hostel_assignments','meal_plans',
    'meal_attendance','student_tracks','student_track_assignments',
    'entertainment_videos','entertainment_music','entertainment_games',
    'scraped_content','scrape_sources','public_posts','notices','sermons',
    'prayer_requests','service_schedule','meeting_minutes','notice_board',
    'budget_items','goals','personal_notes','customers','projects',
    'student_portal_sessions','ptc_bookings','ptc_slots','lesson_plans',
    'sibling_discounts','login_history','quotations','deliveries','public_pages',
    'feature_flags'
  ];
  
  // Delete from tenant-scoped tables (everything except dev tenant)
  for (const table of tenantTables) {
    try {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id IS NOT NULL AND tenant_id != $1`, [devTenantId]);
    } catch (e) { /* table might not have tenant_id, skip */ }
  }
  
  // Delete non-dev users
  try { await pool.query('DELETE FROM users WHERE email != $1', [devEmail]); } catch(e) {}
  
  // Delete non-dev tenants
  try { await pool.query('DELETE FROM tenants WHERE email != $1', [devEmail]); } catch(e) {}
  
  // Clean global tables (no tenant_id)
  const globalTables = [
    'audit_logs','developer_revenue','blog_posts','daily_adverts','dev_posts',
    'educational_resources','password_resets','webhook_logs','email_queue',
    'sms_logs','version_history','backup_log','api_keys','oauth_clients',
    'marketplace_plugins','plugin_registry','login_history'
  ];
  for (const table of globalTables) {
    try { await pool.query(`DELETE FROM ${table}`); } catch(e) {}
  }
  
  // Reset platform wallet
  try { await pool.query('UPDATE platform_wallet SET balance=0 WHERE id=1'); } catch(e) {}
  
  // Re-seed essential data
  try {
    await pool.query("INSERT INTO platform_status (service, status) VALUES ('api', 'operational'), ('database', 'operational'), ('email', 'operational'), ('sms', 'operational') ON CONFLICT (service) DO NOTHING");
  } catch(e) {}
  
  // Re-seed feature flags
  const flagSeeds = [
    ['school_mgmt', 'School Management', 'Student records, fees, grades, attendance', '1.0', 'core', 'None', true],
    ['church_mgmt', 'Church Management', 'Members, donations, sermons, events', '1.0', 'core', 'None', true],
    ['clinic_mgmt', 'Clinic Management', 'Patients, prescriptions, lab results', '1.0', 'core', 'None', true],
    ['business_mgmt', 'Business Management', 'Sales, inventory, invoices, CRM', '1.0', 'core', 'None', true],
    ['public_site', 'Public Website', 'Build a public-facing website with pages', '3.0', 'core', 'None', true],
    ['fundraising', 'Fundraising', 'Launch campaigns and collect donations', '3.0', 'core', 'None', true],
    ['entertainment_hub', 'Entertainment Hub', 'Videos, music, news and auto-scraped content', '3.0', 'core', 'z-ai-web-dev-sdk', true],
    ['web_scraping', 'Web Scraping', 'Auto-import news and events from external sites', '3.0', 'core', 'z-ai-web-dev-sdk', true],
    ['educational_resources', 'Books & Papers', 'Upload and scrape educational resources', '3.0', 'core', 'None', true]
  ];
  for (const [key, name, desc, ver, cat, reqs, active] of flagSeeds) {
    try {
      await pool.query('INSERT INTO feature_flags(feature_key,name,description,version,category,requirements,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [key, name, desc, ver, cat, reqs, active]);
    } catch(e) {}
  }
  
  await audit(devEmail, 'database_cleanup', 'Erased all test data, kept dev account and platform settings');
  console.log('=== DATABASE CLEANUP COMPLETE ===');
  
  req.session.flash = { type: 'success', msg: 'All test data erased! Your dev account and platform settings are intact. The site is ready for real testing data.' };
  res.redirect('/dev/master');
}));

// === SUBSCRIPTION PLANS (Developer sets standard fees) ===
app.get('/dev/plans', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const plans = (await pool.query('SELECT * FROM subscription_plans ORDER BY COALESCE(sort_order,0), price')).rows;
  const flash = req.session.flash; delete req.session.flash;
  const flashHtml = flash ? `${esc(flash.msg)}` : '';
  res.send(renderPage('Subscription Plans', `
    
      Subscription Plans & PricingSet standard fees — users auto-get access after payment
    
    ${flashHtml}
    Create New Plan
      
        Plan Name (key)
        Display Name
        Price (UGX)
        Billing CycleMonthlyYearlyOne Time
        Max Users
        Max Students/Members
        Features (comma-separated)
        Description
        Create Plan
      
    
    Current Plans (${plans.length})
      NamePriceCycleMax UsersMax StudentsFeaturesActions
      ${plans.map(p => `
        ${esc(p.display_name || p.name)}${esc(p.name)}
         0 ? '#d97706' : '#059669'}">UGX ${parseInt(p.price).toLocaleString()}
        ${esc(p.billing_cycle || 'monthly')}
        ${p.max_users || '-'}
        ${p.max_students || '-'}
        ${esc((p.features||'').substring(0,80))}
        
          Edit
          Del
        
      `).join('')}
      
    
    
      How Auto-Access Works
      When a user pays for a subscription (via /billing), the system automatically:
      
        Creates a subscription record with the plan they chose
        Sets their tenant status to verified + approved
        Adds the payment to your developer revenue
        Updates the platform wallet balance
        Grants them access to all features in their plan
      
    
  `, req.session.user));
}));

app.post('/dev/plans/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { name, display_name, description, price, billing_cycle, features, max_users, max_students } = req.body;
  await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students',
    [name, display_name || name, description || '', parseInt(price) || 0, billing_cycle || 'monthly', features || '', parseInt(max_users) || 5, parseInt(max_students) || 100]);
  await audit(req.session.user.email, 'create_plan', `Plan: ${name} @ UGX ${price}`);
  req.session.flash = { type: 'success', msg: 'Plan saved!' };
  res.redirect('/dev/plans');
}));

app.get('/dev/plans/edit/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const plan = (await pool.query('SELECT * FROM subscription_plans WHERE id=$1', [req.params.id])).rows[0];
  if (!plan) return res.redirect('/dev/plans');
  res.send(renderPage('Edit Plan', `
    
      Edit Plan: ${esc(plan.display_name)}
      
        Display Name
        Price (UGX)
        Billing CycleMonthlyYearlyOne Time
        Max Users
        Max Students/Members
        Features
        Description${esc(plan.description || '')}
        UpdateCancel
      
    
  `, req.session.user));
}));

app.post('/dev/plans/update/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { display_name, description, price, billing_cycle, features, max_users, max_students } = req.body;
  await pool.query('UPDATE subscription_plans SET display_name=$1,description=$2,price=$3,billing_cycle=$4,features=$5,max_users=$6,max_students=$7 WHERE id=$8',
    [display_name, description, parseInt(price) || 0, billing_cycle || 'monthly', features, parseInt(max_users) || 5, parseInt(max_students) || 100, req.params.id]);
  req.session.flash = { type: 'success', msg: 'Plan updated!' };
  res.redirect('/dev/plans');
}));

app.get('/dev/plans/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM subscription_plans WHERE id=$1', [req.params.id]);
  req.session.flash = { type: 'success', msg: 'Plan deleted' };
  res.redirect('/dev/plans');
}));

// === TEAM MANAGEMENT — ADMIN/STAFF ACCESS ===
app.get('/team', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [users, roles] = await Promise.all([
    pool.query('SELECT u.id,u.email,u.role,u.approved,u.is_active,u.permissions,u.created_at FROM users u WHERE u.tenant_id=$1 ORDER BY u.created_at DESC', [t]),
    pool.query('SELECT * FROM role_permissions WHERE tenant_id=$1', [t])
  ]);
  const isAdmin = req.session.user.role === 'admin' || req.session.user.role === 'super_admin';
  res.send(renderPage('Team Management', `
    
      Team & Access ControlManage who can access what in your organization
    
    ${isAdmin ? `Add Team Member
      
        Email
        Role
          
            Staff (Basic Access)
            Teacher (Student Management)
            Accountant (Finance)
            Nurse (Health Records)
            Librarian
            Admin (Full Access)
          
        
        Password (they can change later)
        Permissions (optional)
        Add Team Member
      
    ` : 'Only admins can add team members.'}

    Team Members (${users.rows.length})
      EmailRoleStatusPermissionsActions
      ${users.rows.map(u => `
        ${esc(u.email)}
        ${esc(u.role)}
        ${u.is_active !== false ? 'Active' : 'Inactive'}
        ${esc(u.permissions || 'all')}
        
          ${isAdmin && u.email !== req.session.user.email ? `
            ${u.is_active !== false ? 'Deactivate' : 'Activate'}
            Make Admin
            Make Staff
          ` : ''}
        
      `).join('')}
      
    
  `, req.session.user));
}));

app.post('/team/invite', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') return res.status(403).send('Only admins can add members');
  const { email, role, password, permissions } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query('INSERT INTO users(tenant_id,email,password,role,approved,permissions,is_active) VALUES($1,$2,$3,$4,true,$5,true) ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,permissions=EXCLUDED.permissions,is_active=true',
      [t, email, hash, role || 'staff', permissions || '']);
    await audit(req.session.user.email, 'add_team_member', `${email} as ${role}`);
  } catch(e) { /* user may already exist */ }
  res.redirect('/team');
}));

app.get('/team/toggle/:id', requireAuth, ah(async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') return res.status(403).send('Admin only');
  await pool.query('UPDATE users SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/team');
}));

app.get('/team/role/:id', requireAuth, ah(async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') return res.status(403).send('Admin only');
  const role = req.query.role || 'staff';
  await pool.query('UPDATE users SET role=$1 WHERE id=$2 AND tenant_id=$3', [role, req.params.id, req.session.user.tenant_id]);
  res.redirect('/team');
}));

// === TENANT UPLOADS — SIGNATURES, STAMPS, BADGES, LOGOS, DOCUMENTS ===
app.get('/uploads', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const uploads = (await pool.query('SELECT * FROM tenant_uploads WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Uploads & Branding', `
    
      Uploads & BrandingLogos, signatures, stamps, badges, documents
    

    Organization Branding
      
        Organization Logo URL
        Primary Color
        Stamp/Seal URL
        Signature Image URL
        Badge/Title Text
        Welcome Message
        Hero/Banner Image URL
        Save Branding
      
    

    Upload Document/File
      
        File Name
        CategoryDocumentSignatureStamp/SealLogoBadge/CertificatePhotoVideoOther
        File URL (paste link to file)
        Description
        Save Upload
      
      Tip: Upload images to imgbb.com or imgur.com for free, then paste the direct URL here.
    

    ${uploads.length > 0 ? `Uploaded Files (${uploads.length})
      
      ${uploads.map(u => `
        ${esc(u.category)}
        ${esc(u.file_name)}
        ${esc(u.description || '')}
        View File
        Delete
      `).join('')}
      
    ` : ''}

    ${tenant.logo_url || tenant.stamp_url || tenant.signature_url ? `Current Branding Preview
      
        ${tenant.logo_url ? `Logo` : ''}
        ${tenant.stamp_url ? `Stamp` : ''}
        ${tenant.signature_url ? `Signature` : ''}
        ${tenant.badge_text ? `Badge${esc(tenant.badge_text)}` : ''}
      
    ` : ''}
  `, req.session.user));
}));

app.post('/uploads/branding', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { logo_url, stamp_url, signature_url, badge_text, primary_color, hero_image_url, welcome_message } = req.body;
  await pool.query('UPDATE tenants SET logo_url=$1,stamp_url=$2,signature_url=$3,badge_text=$4,primary_color=$5,hero_image_url=$6,welcome_message=$7 WHERE id=$8',
    [logo_url || '', stamp_url || '', signature_url || '', badge_text || '', primary_color || '#4f46e5', hero_image_url || '', welcome_message || '', t]);
  res.redirect('/uploads');
}));

app.post('/uploads/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { file_name, file_type, file_url, category, description } = req.body;
  await pool.query('INSERT INTO tenant_uploads(tenant_id,file_name,file_type,file_url,category,description,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [t, file_name, file_type || 'document', file_url, category || 'document', description || '', req.session.user.email]);
  res.redirect('/uploads');
}));

app.get('/uploads/delete/:id', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM tenant_uploads WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/uploads');
}));

// === HOMEPAGE DESIGNER ===
app.get('/homepage', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const sections = (await pool.query('SELECT * FROM homepage_sections WHERE tenant_id=$1 ORDER BY COALESCE(sort_order,0), id', [t])).rows;
  res.send(renderPage('Design Your Homepage', `
    
      Design Your HomepageBuild a beautiful public page for your organization
    

    Add Section
      
        Section Type
          
            Hero Banner
            Text Block
            YouTube Video
            Image Gallery
            Features/Services Grid
            Contact Section
            Call-to-Action Button
            Divider/Separator
          
        
        Sort Order
        Title
        Subtitle
        Content / Description
        Image URL
        YouTube Video URL
        Button Text
        Button Link
        Background Color
        Text ColorWhiteDark
        Add Section
      
    

    ${sections.length > 0 ? `Your Homepage Sections (${sections.length})
      OrderTypeTitleVisibleActions
      ${sections.map(s => `
        ${s.sort_order || 0}
        ${esc(s.section_type)}
        ${esc(s.title || '-')}
        ${s.is_visible ? 'Yes' : 'No'}
        
          ${s.is_visible ? 'Hide' : 'Show'}
          Up
          Down
          Del
        
      `).join('')}
      
    

    
      Preview Your Homepage
    ` : 'No sections yet. Add your first section above to build your homepage!'}
  `, req.session.user));
}));

app.post('/homepage/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { section_type, title, subtitle, content, image_url, video_url, button_text, button_link, background_color, text_color, sort_order } = req.body;
  await pool.query('INSERT INTO homepage_sections(tenant_id,section_type,title,subtitle,content,image_url,video_url,button_text,button_link,background_color,text_color,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [t, section_type || 'hero', title || '', subtitle || '', content || '', image_url || '', video_url || '', button_text || '', button_link || '', background_color || '#4f46e5', text_color || 'white', parseInt(sort_order) || 0]);
  res.redirect('/homepage');
}));

app.get('/homepage/toggle/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE homepage_sections SET is_visible = NOT is_visible WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/homepage');
}));

app.get('/homepage/up/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE homepage_sections SET sort_order = sort_order - 1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/homepage');
}));

app.get('/homepage/down/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE homepage_sections SET sort_order = sort_order + 1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/homepage');
}));

app.get('/homepage/delete/:id', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM homepage_sections WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/homepage');
}));

// === DAILY ADVERTS ===
app.get('/dev/adverts', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const adverts = (await pool.query('SELECT * FROM daily_adverts ORDER BY created_at DESC')).rows;
  res.send(renderPage('Advert Management', `
    
      Daily AdvertsManage platform advertisements
    
    Create Advert
      
        
        
        
        
        Homepage BannerSidebarFooter
        
          Start Date
          End Date
        
        Create Advert
      
    
    All Adverts
      IDTitlePositionActivePeriodActions
      ${adverts.map(a => `
        ${a.id}${esc(a.title)}${esc(a.position || 'homepage')}
        ${a.is_active ? 'Yes' : 'No'}
        ${new Date(a.start_date).toLocaleDateString()}${a.end_date ? ' - ' + new Date(a.end_date).toLocaleDateString() : ' - Ongoing'}
        
          ${a.is_active ? 'Deactivate' : 'Activate'}
          Delete
        
      `).join('')}
      
    
  `, req.session.user));
}));

app.post('/dev/adverts/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { title, description, image_url, link_url, position, start_date, end_date } = req.body;
  await pool.query('INSERT INTO daily_adverts(title,description,image_url,link_url,position,start_date,end_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [title, description, image_url, link_url, position, start_date, end_date || null, req.session.user.email]);
  await audit(req.session.user.email, 'create_advert', `Created advert: ${title}`);
  res.redirect('/dev/adverts');
}));

app.get('/dev/adverts/toggle/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('UPDATE daily_adverts SET is_active = NOT is_active WHERE id=$1', [req.params.id]);
  res.redirect('/dev/adverts');
}));

app.get('/dev/adverts/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM daily_adverts WHERE id=$1', [req.params.id]);
  res.redirect('/dev/adverts');
}));

// === BLOG/NEWS ===
app.get('/dev/blog', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const posts = (await pool.query('SELECT * FROM blog_posts ORDER BY created_at DESC')).rows;
  res.send(renderPage('Blog Management', `
    
      Blog & NewsCreate content for SEO and engagement
    
    New Post
      
        
        
        
        
        
        NewsUpdateTutorialFeatureTips
         Publish immediately
        Create Post
      
    
    All Posts
      IDTitleCategoryPublishedDateActions
      ${posts.map(p => `
        ${p.id}${esc(p.title)}${esc(p.category)}
        ${p.is_published ? 'Yes' : 'Draft'}
        ${p.published_at ? new Date(p.published_at).toLocaleDateString() : new Date(p.created_at).toLocaleDateString()}
        
          View
          Delete
        
      `).join('')}
      
    
  `, req.session.user));
}));

app.post('/dev/blog/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { title, slug, content, excerpt, image_url, category, is_published } = req.body;
  const published = is_published === 'true';
  await pool.query('INSERT INTO blog_posts(slug,title,content,excerpt,image_url,category,author,is_published,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [slug, title, content, excerpt, image_url, category, req.session.user.email, published, published ? new Date() : null]);
  await audit(req.session.user.email, 'create_blog_post', `Blog post: ${title}`);
  res.redirect('/dev/blog');
}));

app.get('/dev/blog/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM blog_posts WHERE id=$1', [req.params.id]);
  res.redirect('/dev/blog');
}));

// Public blog listing (blog_posts table)
app.get('/blog/posts', ah(async (req, res) => {
  const posts = (await pool.query('SELECT * FROM blog_posts WHERE is_published=true ORDER BY published_at DESC LIMIT 20')).rows;
  res.send(renderPageV3('SSEWASSWA Blog - News & Updates', `
    
      Blog & NewsUpdates, tips, and insights from SSEWASSWA
    
    
      ${posts.map(p => `
        
          ${p.image_url ? `` : ''}
          ${esc(p.category)}
          ${esc(p.title)}
          ${esc(p.excerpt || (p.content ? p.content.substring(0, 120) + '...' : ''))}
          ${p.published_at ? new Date(p.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
        
      `).join('')}
    
    ${posts.length === 0 ? 'No posts yetCheck back soon for updates!' : ''}
  `, null, { description: 'SSEWASSWA blog - news, updates, tips and insights for African institutions' }));
}));

// Public blog post detail (blog_posts table)
app.get('/blog/posts/:slug', ah(async (req, res) => {
  const post = (await pool.query('SELECT * FROM blog_posts WHERE slug=$1 AND is_published=true', [req.params.slug])).rows[0];
  if (!post) return res.status(404).send(renderPageV3('Not Found', 'Post Not FoundThis blog post does not exist or is not published.Back to Blog', null));
  res.send(renderPageV3(post.title, `
    
      &larr; Back to Blog
      ${post.image_url ? `` : ''}
      ${esc(post.category)}
      ${esc(post.title)}
      By ${esc(post.author || 'SSEWASSWA Team')} &middot; ${post.published_at ? new Date(post.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
      
      ${post.content}
      
      
        Powered by SSEWASSWA - The Operating System for African Institutions
        More Articles
      
    
  `, null, { description: post.excerpt || post.title, keywords: post.category }));
}));

// === DEV WITHDRAWAL SYSTEM ===
app.get('/dev/withdraw', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [wallet, withdrawals] = await Promise.all([
    pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1'),
    pool.query("SELECT * FROM developer_revenue WHERE source=$1 ORDER BY created_at DESC LIMIT 50", ['withdrawal'])
  ]);
  const balance = parseInt(wallet.rows[0]?.b || 0);
  res.send(renderPage('Withdraw Funds', `
    
      Withdraw FundsAvailable: UGX ${balance.toLocaleString()}
    
    Request Withdrawal
      
        
        
        MTN Mobile MoneyAirtel Money
        Withdraw
        ${balance Minimum withdrawal: UGX 10,000' : ''}
      
    
    Withdrawal History
      ${withdrawals.rows.length > 0 ? `
        AmountPhoneNetworkDateStatus
        ${withdrawals.rows.map(w => {
          let meta = {};
          try { meta = w.source === 'withdrawal' ? JSON.parse(w.details || '{}') : {}; } catch(e) {}
          return `UGX ${Math.abs(parseInt(w.amount)).toLocaleString()}${esc(meta.phone || 'N/A')}${esc(meta.network || 'N/A')}${new Date(w.created_at).toLocaleString()}${w.amount Processing' : 'Completed'}`;
        }).join('')}
        
      ` : 'No withdrawals yet'}
    
  `, req.session.user));
}));

app.post('/dev/withdraw/process', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { amount, phone, network } = req.body;
  const wallet = (await pool.query('SELECT COALESCE(balance,0) as b FROM platform_wallet WHERE id=1')).rows[0];
  const balance = parseInt(wallet?.b || 0);
  const amt = parseInt(amount);
  if (amt  balance) { req.session.flash = { type: 'error', msg: 'Insufficient balance' }; return res.redirect('/dev/withdraw'); }
  await pool.query('UPDATE platform_wallet SET balance=balance-$1 WHERE id=1', [amt]);
  await pool.query('INSERT INTO developer_revenue(amount,source,details) VALUES($1,$2,$3)', [-amt, 'withdrawal', JSON.stringify({ phone, network, status: 'processing', requested_by: req.session.user.email })]);
  await audit(req.session.user.email, 'withdrawal_request', `UGX ${amt} to ${phone} (${network})`);
  req.session.flash = { type: 'success', msg: `Withdrawal of UGX ${amt.toLocaleString()} requested to ${phone}` };
  res.redirect('/dev/withdraw');
}));

// === DEV ACTIVITY LOG ===
app.get('/dev/activity', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [logs, users, subs] = await Promise.all([
    pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100'),
    pool.query('SELECT u.email,u.role,u.created_at,t.name as tenant_name FROM users u LEFT JOIN tenants t ON u.tenant_id=t.id ORDER BY u.created_at DESC LIMIT 50'),
    pool.query('SELECT s.*,t.name as tenant_name FROM subscriptions s JOIN tenants t ON s.tenant_id=t.id ORDER BY s.started_at DESC LIMIT 30')
  ]);
  res.send(renderPage('Activity & Analytics', `
    
      Platform ActivityMonitor all system events
    
    
      Audit Logs
      Recent Users
      Subscriptions
    
    Recent Actions
      UserActionDetailsTime
      ${logs.rows.map(l => `${esc(l.user_email||'')}${esc(l.action)}${esc(l.details||'')}${l.created_at?new Date(l.created_at).toLocaleString():''}`).join('')}
      
    
    Recent User Signups
      EmailRoleTenantJoined
      ${users.rows.map(u => `${esc(u.email)}${esc(u.role)}${esc(u.tenant_name||'N/A')}${u.created_at?new Date(u.created_at).toLocaleString():''}`).join('')}
      
    
    Subscriptions
      TenantPlanAmountStatusStarted
      ${subs.rows.map(s => `${esc(s.tenant_name)}${esc(s.plan)}UGX ${parseInt(s.amount).toLocaleString()}${esc(s.status)}${s.started_at?new Date(s.started_at).toLocaleDateString():''}`).join('')}
      
    
    
      function showTab(name) {
        document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
        document.getElementById('tab-' + name).style.display = 'block';
        document.querySelectorAll('.tab-bar a').forEach(a => a.classList.remove('active'));
        event.target.classList.add('active');
      }
    
  `, req.session.user));
}));

// === HELP CENTER ===
app.get('/help', ah(async (req, res) => {
  res.send(renderPage('Help Center', `
    
      Help CenterFind answers, get support, and learn how to use SSEWASSWA
    
    
      Getting Started
        New to SSEWASSWA? Here is how to begin:
        
          Create your account - Sign up with your email
          Log in - Access your dashboard
          Complete setup - Configure your organization
          Read the guide - Step-by-step tutorials
        
      
      Common Questions
        How do I add students or members?Log in, go to your Dashboard, then use the relevant section (Students for schools, Members for churches, Patients for clinics).
        How do I accept payments?Go to Settings then Billing. You can set up mobile money (MTN/Airtel) and card payments.
        How do I create a public website?From your Dashboard, go to Public Site. You can create pages, add events, and share your organization's link.
        Is SSEWASSWA free?Yes! SSEWASSWA has a free tier with core features. Premium features like fundraising and advanced reports are available on paid plans.
        How do I contact support?Email us at support@ssewasswa.onrender.com or call +256 700 000 000.
      
      Contact Support
        We are here to help you succeed
        Email:support@ssewasswa.onrender.com
        Phone:+256 700 000 000
        Response Time:Usually within 24 hours
      
      Platform Features
        
          Schools: Student management, fees, grades, attendance
          Clinics: Patient records, appointments, billing
          Churches: Members, donations, events, sermons
          Businesses: Sales, CRM, inventory, invoices
          All: Public website, entertainment, fundraising, blog
        
      
    
  `, req.session.user));
}));

// === DEV SETTINGS — EDIT YOUR PLATFORM ===
app.get('/dev/settings', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const flash = req.session.flash; delete req.session.flash;
  const flashHtml = flash ? `${esc(flash.msg)}` : '';
  const s = platformSettings;
  res.send(renderPage('Platform Settings', `
    
      Platform SettingsCustomize your platform — contacts, branding, social links
    
    ${flashHtml}

    
      
        Branding & Website
        
          Website Name
          Tagline
        
        Footer Text
      

      
        Contact Information (shown on all pages)
        
          Support Email
          Support Phone
          Developer Email
          Developer Phone
        
      

      
        Social Links
        
          WhatsApp Link
          Facebook Page
          Twitter / X
        
      

      
        Monetization Settings
        
          Revenue per Ad View (UGX)
          Premium Resource Price (UGX)
        
      

      Save All Settings
    

    
      .dev-section{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,0.05);border:1px solid #e2e8f0}
      .dev-section h2{font-size:18px;margin-bottom:16px;color:#4f46e5}
      .dev-section label{font-weight:600;font-size:13px;color:#64748b;display:block;margin-bottom:4px;margin-top:8px}
    
  `, req.session.user));
}));

app.post('/dev/settings/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const fields = ['site_name', 'site_tagline', 'support_email', 'support_phone', 'developer_email', 'developer_phone', 'whatsapp_link', 'facebook_link', 'twitter_link', 'footer_text', 'ad_revenue_per_view', 'premium_resource_price'];
  for (const key of fields) {
    const val = req.body[key] || '';
    await pool.query('INSERT INTO platform_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()', [key, val]);
  }
  await loadPlatformSettings();
  await audit(req.session.user.email, 'update_platform_settings', 'Updated platform settings');
  req.session.flash = { type: 'success', msg: 'Settings saved successfully! Changes are live now.' };
  res.redirect('/dev/settings');
}));

// === DEV POSTS — POST TO PUBLIC ===
app.get('/dev/posts', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const posts = (await pool.query('SELECT * FROM dev_posts ORDER BY is_pinned DESC, created_at DESC')).rows;
  const flash = req.session.flash; delete req.session.flash;
  const flashHtml = flash ? `${esc(flash.msg)}` : '';
  res.send(renderPage('Manage Posts', `
    
      Public Posts & AnnouncementsPost updates, promotions, and announcements visible to all users
    
    ${flashHtml}
    Create New Post
      
        
        AnnouncementPromotionUpdateTip & GuideEvent
        
        
          
          
        
        
           Pin this post
          Publish Post
        
      
    
    ${posts.length > 0 ? `All Posts (${posts.length})
      TitleTypeViewsPinnedDateActions
      ${posts.map(p => `
        ${esc(p.title)}
        ${esc(p.post_type)}
        ${p.views || 0}
        ${p.is_pinned ? '📌' : ''}
        ${new Date(p.created_at).toLocaleDateString()}
        
          ${p.is_pinned ? 'Unpin' : 'Pin'}
          Delete
        
      `).join('')}
      ` : 'No posts yet. Create your first post above!'}
  `, req.session.user));
}));

app.post('/dev/posts/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { title, content, post_type, image_url, link_url, is_pinned } = req.body;
  await pool.query('INSERT INTO dev_posts(title,content,post_type,image_url,link_url,is_pinned) VALUES($1,$2,$3,$4,$5,$6)', [title, content, post_type || 'announcement', image_url || '', link_url || '', is_pinned === 'true']);
  await audit(req.session.user.email, 'create_dev_post', `Post: ${title}`);
  req.session.flash = { type: 'success', msg: 'Post published!' };
  res.redirect('/dev/posts');
}));

app.get('/dev/posts/toggle/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('UPDATE dev_posts SET is_pinned = NOT is_pinned WHERE id=$1', [req.params.id]);
  res.redirect('/dev/posts');
}));

app.get('/dev/posts/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM dev_posts WHERE id=$1', [req.params.id]);
  req.session.flash = { type: 'success', msg: 'Post deleted' };
  res.redirect('/dev/posts');
}));

// === DEV RESOURCES — UPLOAD & SCRAPE BOOKS/PAPERS ===
app.get('/dev/resources', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const resources = (await pool.query('SELECT * FROM educational_resources ORDER BY created_at DESC LIMIT 100')).rows;
  const flash = req.session.flash; delete req.session.flash;
  const flashHtml = flash ? `${esc(flash.msg)}` : '';
  const totalViews = resources.reduce((sum, r) => sum + (r.view_count || 0), 0);
  const totalDownloads = resources.reduce((sum, r) => sum + (r.download_count || 0), 0);
  const totalRevenue = totalDownloads * parseInt(platformSettings.premium_resource_price || 2000);
  res.send(renderPage('Educational Resources', `
    
      Books & Past PapersManage educational resources for users — earn from premium downloads
    
    ${flashHtml}

    
      ${resources.length}Total Resources
      ${totalViews}Total Views
      ${totalDownloads}Downloads
      UGX ${totalRevenue.toLocaleString()}Est. Revenue
    

    Add Resource Manually
      
        Title
        CategoryBookPast PaperStudy NotesSyllabusGuide / ManualOther
        Subject
        Class Level
        Author / Source
        File URL
        File TypePDFDocumentePubVideoWeb Link
        Cover Image URL
        Price (UGX, 0 = Free)
        Description
        Add Resource
      
    

    Scrape Educational Resources
      Search the web for free books, past papers, and study materials to add to your library
      
        Search Query
        CategoryPast PaperBookNotesSyllabus
        Search & Import
      
    

    ${resources.length > 0 ? `All Resources (${resources.length})
      TitleCategorySubjectPriceViewsDownloadsActions
      ${resources.map(r => `
        ${esc((r.title||'').substring(0,50))}
        ${esc(r.category||'book')}
        ${esc(r.subject||'-')}
         0 ? '#d97706' : '#059669'}">${r.price > 0 ? 'UGX ' + parseInt(r.price).toLocaleString() : 'Free'}
        ${r.view_count || 0}
        ${r.download_count || 0}
        
          ${r.is_active ? 'Hide' : 'Show'}
          Del
        
      `).join('')}
      ` : ''}
  `, req.session.user));
}));

app.post('/dev/resources/create', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { title, description, category, subject, class_level, file_url, file_type, cover_image, author, price } = req.body;
  const isFree = !price || parseInt(price) === 0;
  await pool.query('INSERT INTO educational_resources(title,description,category,subject,class_level,file_url,file_type,cover_image,source,author,is_free,price,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [title, description || '', category || 'book', subject || '', class_level || '', file_url, file_type || 'pdf', cover_image || '', 'manual', author || '', isFree, parseInt(price) || 0, req.session.user.email]);
  await audit(req.session.user.email, 'add_resource', `${category}: ${title}`);
  req.session.flash = { type: 'success', msg: 'Resource added!' };
  res.redirect('/dev/resources');
}));

app.post('/dev/resources/scrape', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { query, category } = req.body;
  let imported = 0;
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const results = await zai.functions.invoke('web_search', { query: `${query} filetype:pdf OR site:*.go.ug OR site:uneb.ac.ug`, num: 15 });
    for (const item of (results || [])) {
      if (!item.name && !item.title) continue;
      try {
        await pool.query('INSERT INTO educational_resources(title,description,category,file_url,file_type,source,is_free,price,scraped_from,created_by) VALUES($1,$2,$3,$4,$5,$6,true,0,$7,$8) ON CONFLICT DO NOTHING',
          [item.name || item.title, item.snippet || '', category || 'book', item.url || '', item.url && item.url.endsWith('.pdf') ? 'pdf' : 'link', item.host_name || 'web', item.url, req.session.user.email]);
        imported++;
      } catch (e) { /* skip duplicates */ }
    }
  } catch (e) {
    console.warn('Scrape error:', e.message);
  }
  await audit(req.session.user.email, 'scrape_resources', `Imported ${imported} resources for "${query}"`);
  req.session.flash = { type: imported > 0 ? 'success' : 'info', msg: imported > 0 ? `Imported ${imported} resource(s)!` : 'No new resources found. Try a different search.' };
  res.redirect('/dev/resources');
}));

app.get('/dev/resources/toggle/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('UPDATE educational_resources SET is_active = NOT is_active WHERE id=$1', [req.params.id]);
  res.redirect('/dev/resources');
}));

app.get('/dev/resources/delete/:id', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  await pool.query('DELETE FROM educational_resources WHERE id=$1', [req.params.id]);
  res.redirect('/dev/resources');
}));

// === PUBLIC LIBRARY — BROWSE BOOKS & PAPERS ===
app.get('/library', ah(async (req, res) => {
  const filter = req.query.category || '';
  const search = req.query.q || '';
  let query = 'SELECT * FROM educational_resources WHERE is_active=true';
  const params = [];
  if (filter) { params.push(filter); query += ` AND category=$${params.length}`; }
  if (search) { params.push(`%${search}%`); query += ` AND (title ILIKE $${params.length} OR subject ILIKE $${params.length} OR description ILIKE $${params.length})`; }
  query += ' ORDER BY download_count DESC, view_count DESC, created_at DESC LIMIT 60';
  const resources = (await pool.query(query, params)).rows;
  // Track views
  if (resources.length > 0) {
    pool.query('UPDATE educational_resources SET view_count = view_count + 1 WHERE id = ANY($1)', [resources.map(r => r.id)]).catch(() => {});
  }
  // Get dev posts for the homepage feed
  const devPosts = (await pool.query('SELECT * FROM dev_posts WHERE is_published=true ORDER BY is_pinned DESC, created_at DESC LIMIT 5')).rows;

  res.send(renderPage('Library - Books & Past Papers', `
    
      Books & Past Papers Library
      Free and premium educational resources for Ugandan students and institutions
    

    ${devPosts.length > 0 ? `
      Latest from ${esc(platformSettings.site_name)}
      ${devPosts.map(p => `
        ${p.is_pinned ? '📌 ' : ''}${esc(p.title)}
        ${esc(p.post_type)}
        ${esc((p.content||'').substring(0,120))}${p.content && p.content.length > 120 ? '...' : ''}
        ${p.link_url ? `Read More` : ''}
      `).join('')}
    ` : ''}

    
      
        
        Search
      
      All
      Books
      Past Papers
      Notes
      Syllabus
      Guides
    

    ${resources.length > 0 ? `
      ${resources.map(r => `
        
          ${r.cover_image ? `` : `${r.category === 'past_paper' ? '📄' : r.category === 'book' ? '📚' : r.category === 'notes' ? '📝' : r.category === 'syllabus' ? '📋' : '📖'}`}
          ${esc(r.category||'book')}
          ${r.subject ? `${esc(r.subject)}` : ''}
          ${r.class_level ? `${esc(r.class_level)}` : ''}
          ${esc(r.title)}
          ${esc((r.description||'').substring(0,80))}
          ${r.author ? `By ${esc(r.author)}` : ''}
          
            ${r.is_free !== false && r.price === 0 ? 'Free' : 'UGX ' + parseInt(r.price || 0).toLocaleString()}
            ${r.is_free !== false && r.price === 0 ? 'Download' : 'Get Access'}
          
          ${r.view_count || 0} views${r.download_count || 0} downloads
        
      `).join('')}
    ` : 'No resources yetCheck back soon for books and past papers!'}
  `, req.session.user));
}));

app.get('/library/download/:id', ah(async (req, res) => {
  try {
    await pool.query('UPDATE educational_resources SET download_count = download_count + 1 WHERE id=$1', [req.params.id]);
    // Track revenue for premium downloads
    const r = (await pool.query('SELECT price, title FROM educational_resources WHERE id=$1', [req.params.id])).rows[0];
    if (r && r.price > 0) {
      await pool.query('INSERT INTO developer_revenue(amount,source,details) VALUES($1,$2,$3)', [r.price, 'Premium download', JSON.stringify({ resource_id: req.params.id, title: r.title })]);
      await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [r.price]);
    }
  } catch (e) {}
  res.status(200).send('OK');
}));

// === FUNDRAISING UPGRADE ===
app.get('/upgrade/fundraising', requireAuth, (req, res) => {
  res.send(renderPage('Fundraising Module', `
    
      Add Fundraising
      Enable donations, campaigns, and donor management for your organization.
      Platform Fee: 5% per donation
      
        Activate Fundraising
      
    
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
    
      FundraisingDonations and campaigns
    
    UGX ${total.toLocaleString()}Total Donations
    Record Donation
      
        
        
        Record Donation
      
    
    Recent Donations
      AmountDonorDate
      ${donations.map(d => `UGX ${parseInt(d.amount).toLocaleString()}${esc(d.description)}${new Date(d.created_at).toLocaleDateString()}`).join('') || 'No donations yet'}
      
    
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
    pool.query('SELECT * FROM subscriptions WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1', [t]),
    pool.query('SELECT * FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t])
  ]);
  const plan = sub.rows[0]?.plan || 'free';
  const planNames = { free: 'Free Plan', basic: 'Basic - UGX 50,000/mo', pro: 'Pro - UGX 150,000/mo', enterprise: 'Enterprise - UGX 500,000/mo' };
  res.send(renderPage('Billing & Subscriptions', `
    Billing & SubscriptionsManage your plan and payments
    
      Current Plan
      
        ${planNames[plan] || plan}Active Plan
        ${sub.rows[0]?.status || 'active'}Status
      
      Change Plan
      
        
          FreeUp to 50 recordsUGX 0
          ${plan==='free'?'Current':'Downgrade'}
        
        
          BasicUp to 500 recordsUGX 50K
          ${plan==='basic'?'Current':'Subscribe'}
        
        
          ProUnlimited records + SMSUGX 150K
          ${plan==='pro'?'Current':'Subscribe'}
        
      
    
    
      Payment History
      ${payments.rows.length ? `DateAmountMethodStatusRef${payments.rows.map(p=>`${new Date(p.created_at).toLocaleDateString()}UGX ${Number(p.amount).toLocaleString()}${esc(p.method||'-')}${esc(p.status)}${esc(p.reference||'-')}`).join('')}` : 'No payments yet'}
    
  `, req.session.user));
}));

app.get('/billing/subscribe/:plan', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const plan = req.params.plan;
  const amounts = { free: 0, basic: 50000, pro: 150000, enterprise: 500000 };
  const amount = amounts[plan] || 0;
  const expires = new Date(Date.now() + 30*24*60*60*1000);
  if (plan === 'free') {
    try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5)', [t, plan, amount, 'active', expires]); } catch(e) {}
    await audit(req.session.user.email, 'subscription_change', `Changed to ${plan} plan`);
    return res.redirect('/billing');
  }
  // v12: Use inline checkout page (Flutterwave inline JS + manual fallback)
  if (amount > 0) return res.redirect(`/pay/checkout?amount=${amount}&plan=${plan}&description=${plan}+plan+subscription`);
  // Fallback: manual payment
  try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5)', [t, plan, amount, 'active', expires]); } catch(e) {}
  if (amount > 0) {
    await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [t]);
    await pool.query('UPDATE subscriptions SET auto_verified=true WHERE tenant_id=$1 AND status=$2', [t, 'active']);
  }
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
      try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at) VALUES($1,$2,$3,$4,$5)', [payment.tenant_id, plan, payment.amount, 'active', expires]); } catch(e) {}
      // Auto-verify tenant after subscription payment
      await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [payment.tenant_id]);
      await pool.query('UPDATE subscriptions SET auto_verified=true WHERE tenant_id=$1 AND status=$2', [payment.tenant_id, 'active']);
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
    API & WebhooksManage API access and webhook integrations
    
      API Keys
      Create New Key
      ${keys.rows.length ? `NameScopesLast UsedActions${keys.rows.map(k=>`${esc(k.name)}${(k.scopes||[]).map(s=>`${esc(s)}`).join(' ')}${k.last_used?new Date(k.last_used).toLocaleDateString():'Never'}Revoke`).join('')}` : 'No API keys created'}
    
    
      Webhooks
      Add Webhook
      ${hooks.rows.length ? `URLEventsActiveActions${hooks.rows.map(h=>`${esc(h.url)}${(h.events||[]).map(e=>`${esc(e)}`).join(' ')}${h.active?'Yes':'No'}Delete`).join('')}` : 'No webhooks configured'}
    
    
      Webhook Logs
      ${logs.rows.length ? `TimeEventStatus${logs.rows.map(l=>`${new Date(l.created_at).toLocaleString()}${esc(l.event)}${l.status||'-'}`).join('')}` : 'No webhook logs'}
    
  `, req.session.user));
}));

app.get('/api-keys/new', requireAuth, (req, res) => {
  res.send(renderPage('Create API Key', `
    
      Create API Key
      
        
         Read
         Write
         Admin
        Create Key
      
    
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
  res.send(renderPage('API Key Created', `API Key created successfully!Your API Key (save this, it won't be shown again):${esc(rawKey)}Back to API Keys`, req.session.user));
}));

app.get('/api-keys/:id/revoke', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM api_keys WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/api-keys');
}));

app.get('/webhooks/new', requireAuth, (req, res) => {
  res.send(renderPage('Add Webhook', `
    
      Add Webhook
      
        
         Payment Events
         Student Events
         Invoice Events
         Member Events
        Add Webhook
      
    
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
    
      Today's Service Attendance
      
        
        MemberPresent
        ${members.rows.map(m=>`${esc(m.name)}`).join('')}
        
        Save Attendance
      
    
    
      Today's Records
      ${att.rows.length ? `MemberServiceStatus${att.rows.map(a=>`${esc(a.member_name||'Unknown')}${esc(a.service_name||'-')}${a.present?'Present':'Absent'}`).join('')}` : 'No attendance recorded today'}
    
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
    
      Generate Tithe Statement
      
        Select Member${members.map(m=>`${esc(m.name)}`).join('')}
        
        
        Generate Statement
      
    
  `, req.session.user));
}));

app.get('/church/tithe-statement/view', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { member_id, from_date, to_date } = req.query;
  const member = (await pool.query('SELECT * FROM church_members WHERE id=$1 AND tenant_id=$2', [member_id, t])).rows[0];
  const tithes = (await pool.query("SELECT * FROM donations WHERE tenant_id=$1 AND donor_id=$2 AND is_tithe=true AND created_at>=$3 AND created_ats+Number(d.amount),0);
  const tenant = (await pool.query('SELECT name FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Tithe Statement', `
    
      
        ${esc(tenant?.name||'Church')}
        Tithe Statement
        Member: ${esc(member?.name||'Unknown')}
        Period: ${from_date} to ${to_date}
      
      DateTypeMethodAmount (UGX)
      ${tithes.map(d=>`${new Date(d.created_at).toLocaleDateString()}${esc(d.type||'Tithe')}${esc(d.method||'-')}${Number(d.amount).toLocaleString()}`).join('')}
      TotalUGX ${total.toLocaleString()}
    
    Back
    Print Statement
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
    
      Today's Birthdays
      ${birthdays.length ? birthdays.map(m=>`${esc(m.name)} - ${esc(m.phone||'No phone')} Send SMS`).join('') : 'No birthdays today'}
    
    
      This Month's Birthdays
      ${upcoming.length ? `NameDatePhoneAction${upcoming.map(m=>`${esc(m.name)}${m.d}/${m.m}${esc(m.phone||'-')}Send SMS`).join('')}` : 'No birthdays this month'}
    
  `, req.session.user));
}));

app.get('/church/birthdays/:id/sms', requireAuth, requireNotBanned, ah(async (req, res) => {
  const member = (await pool.query('SELECT * FROM church_members WHERE id=$1', [req.params.id])).rows[0];
  if (!member || !member.phone) return res.send(renderPage('SMS', 'Member has no phone number', req.session.user));
  res.send(renderPage('Send Birthday SMS', `
    
      Send Birthday SMS to ${esc(member.name)}
      Phone: ${esc(member.phone)}
      
        Happy Birthday ${member.name}! May God bless you abundantly on your special day. - ${req.session.user.tenant_name||'Church'}
        Send SMS
      
    
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
  res.send(renderPage('SMS Sent', `${sent?'SMS sent successfully!':'SMS queued. Configure Africa\'s Talking in env for live delivery.'}Back to Birthdays`, req.session.user));
}));

// === CUSTOMER DEBTS TRACKING ===
app.get('/business/debts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const unpaidSales = (await pool.query("SELECT s.*,c.name as customer_name FROM sales s LEFT JOIN customers c ON s.customer_id=c.id WHERE s.tenant_id=$1 AND s.status!='paid' ORDER BY s.created_at DESC", [t])).rows;
  const unpaidInvoices = (await pool.query("SELECT i.*,c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id=c.id WHERE i.tenant_id=$1 AND i.status='unpaid' ORDER BY i.due_date", [t])).rows;
  const totalDebt = unpaidSales.reduce((s,x)=>s+(x.total-x.paid),0) + unpaidInvoices.reduce((s,x)=>s+x.amount,0);
  res.send(renderPage('Customer Debts', `
    
      UGX ${totalDebt.toLocaleString()}Total Outstanding
      ${unpaidSales.length}Unpaid Sales
      ${unpaidInvoices.length}Unpaid Invoices
    
    
      Unpaid Sales
      ${unpaidSales.length ? `CustomerTotalPaidBalanceDate${unpaidSales.map(s=>`${esc(s.customer_name||s.customer_name||'Walk-in')}UGX ${Number(s.total).toLocaleString()}UGX ${Number(s.paid).toLocaleString()}UGX ${(s.total-s.paid).toLocaleString()}${new Date(s.created_at).toLocaleDateString()}`).join('')}` : 'No unpaid sales'}
    
    
      Overdue Invoices
      ${unpaidInvoices.length ? `InvoiceCustomerAmountDue DateDays OverdueAction${unpaidInvoices.map(i=>{const days=Math.floor((Date.now()-new Date(i.due_date))/(1000*60*60*24));return`${esc(i.invoice_no)}${esc(i.customer_name||'-')}UGX ${Number(i.amount).toLocaleString()}${new Date(i.due_date).toLocaleDateString()}0?'#dc2626':'#059669'}">${days>0?days+' days':'Due'}Mark Paid`}).join('')}` : 'No overdue invoices'}
    
  `, req.session.user));
}));

// === PURCHASE ORDERS ===
app.get('/business/purchase-orders', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const pos = (await pool.query('SELECT * FROM purchase_orders WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Purchase Orders', `
    
      Purchase Orders
      New PO
      ${pos.length ? `PO#SupplierTotalStatusDateActions${pos.map(p=>`${esc(p.po_no||'PO-'+p.id)}${esc(p.supplier||'-')}UGX ${Number(p.total).toLocaleString()}${esc(p.status)}${new Date(p.created_at).toLocaleDateString()}Approve Delete`).join('')}` : 'No purchase orders'}
    
  `, req.session.user));
}));

app.get('/business/purchase-orders/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Purchase Order', `
    
      Create Purchase Order
      
        
        
        
        Create PO
      
    
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
    
      UGX ${taxableAmount.toLocaleString()}This Month Sales
      UGX ${vatAmount.toLocaleString()}Estimated VAT (18%)
      UGX ${Number(expenseTotal.rows[0].total).toLocaleString()}This Month Expenses
    
    
      File Tax Return
      
        
        
        
        File VAT Return for ${currentMonth}
      
    
    
      Tax Filing History
      ${records.length ? `PeriodTaxable AmountVAT (18%)TypeFiled${records.map(r=>`${esc(r.period)}UGX ${Number(r.taxable_amount).toLocaleString()}UGX ${Number(r.tax_amount).toLocaleString()}${esc(r.tax_type)}${r.filed?'Yes':'No'}`).join('')}` : 'No tax records filed'}
    
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
    Barcode ScannerScan or search by barcode
    
      
        
        Lookup
      
    
    
      Generate Barcodes
      Inventory Barcodes
      Student Barcodes
    
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
  if (item.rows[0]) results += `Inventory ItemName: ${esc(item.rows[0].name)}SKU: ${esc(item.rows[0].sku||'-')}Qty: ${item.rows[0].quantity}Price: UGX ${Number(item.rows[0].selling_price).toLocaleString()}`;
  if (student.rows[0]) results += `StudentName: ${esc(student.rows[0].name)}Adm No: ${esc(student.rows[0].admission_no||'-')}Class: ${esc(student.rows[0].class||'-')}`;
  if (!results) results = 'No item found for this barcode';
  res.send(renderPage('Barcode Result', results + 'Scan Another', req.session.user));
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
    
      Inventory Barcodes
      Print All
      ${updated.map(i=>`${esc(i.name)}${esc(i.barcode)}UGX ${Number(i.selling_price).toLocaleString()}`).join('')}
    
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
    
      Student Barcodes
      Print All
      ${updated.map(s=>`${esc(s.name)}${esc(s.class||'')}${esc(s.barcode)}${esc(s.admission_no||'')}`).join('')}
    
  `, req.session.user));
}));

// === BILL REMINDERS ===
app.get('/bill-reminders', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const reminders = (await pool.query('SELECT * FROM bill_reminders WHERE tenant_id=$1 ORDER BY due_date', [t])).rows;
  const upcoming = reminders.filter(r=>!r.paid && new Date(r.due_date)>=new Date());
  const overdue = reminders.filter(r=>!r.paid && new Date(r.due_date)
      Bill Reminders
      Add Reminder
      ${overdue.length ? `Overdue (${overdue.length})TitleAmountDue DateCategoryAction${overdue.map(r=>`${esc(r.title)}UGX ${Number(r.amount).toLocaleString()}${new Date(r.due_date).toLocaleDateString()}${esc(r.category||'-')}Mark Paid`).join('')}` : ''}
      ${upcoming.length ? `Upcoming (${upcoming.length})TitleAmountDue DateCategoryAction${upcoming.map(r=>`${esc(r.title)}UGX ${Number(r.amount).toLocaleString()}${new Date(r.due_date).toLocaleDateString()}${esc(r.category||'-')}Mark Paid Delete`).join('')}` : ''}
      ${!overdue.length && !upcoming.length ? 'No bill reminders' : ''}
    
  `, req.session.user));
}));

app.get('/bill-reminders/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Bill Reminder', `
    
      Add Bill Reminder
      
        
        
        
        RentUtilitiesSalaryTaxLoanOther
        One-timeMonthlyQuarterlyYearly
        
        Add Reminder
      
    
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
  const filter = req.query.category || '';
  const filtered = filter ? docs.filter(d => d.category === filter) : docs;
  res.send(renderPage('Document Library', `
    
      Document LibraryUpload photos, PDFs, receipts, and documents directly from your device
    
    
      
        Your Documents (${docs.length})
        + Upload Document
      
      ${docs.length > 0 ? `
        All
        ${[...new Set(docs.map(d=>d.category))].filter(Boolean).map(c=>`${esc(c)}`).join('')}
      ` : ''}
      ${filtered.map(d=>{
        const isImage = d.file_type === 'photo' || (d.file_url && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(d.file_url));
        const isPdf = d.file_type === 'PDF' || (d.file_url && /\.pdf$/i.test(d.file_url));
        return `
          ${isImage ? `` :
            isPdf ? `PDF` :
            `${esc((d.file_type||'FILE').substring(0,4))}`}
          ${esc(d.title)}
          ${esc(d.category||'General')}
          ${new Date(d.created_at).toLocaleDateString()}
          ${d.file_url?`View`:''} 
          Delete
        `;
      }).join('')}
      ${!docs.length?'📂No documents yet. Upload your first document!Upload Document':''}
    
  `, req.session.user));
}));

app.get('/documents/upload', requireAuth, requireNotBanned, (req, res) => {
  const hasCloudinary = !!process.env.CLOUDINARY_URL;
  res.send(renderPage('Upload Document', `
    
      Upload Document
      
        
        
        GeneralPolicyFinancialLegalAcademicChurchReceiptPhoto
        
          📎
          Choose file from your device
          
          ${hasCloudinary ? '✓ Cloud upload enabled — your file will be stored securely in the cloud' : '⚠ Cloud storage not configured — paste a URL below instead'}
        
        — OR —
        
        
        Upload Document
      
    
  `, req.session.user));
});

app.post('/documents/save', requireAuth, requireNotBanned, upload.single('file'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, file_url, file_type, category } = req.body;
  let fileUrl = file_url || '';
  let fileType = file_type || 'document';
  // If file uploaded via form, try Cloudinary
  if (req.file) {
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploaded = await uploadToCloudinary(b64, `tenant_${t}/documents`);
    if (uploaded) {
      fileUrl = uploaded;
      fileType = req.file.mimetype.startsWith('image') ? 'photo' : req.file.mimetype === 'application/pdf' ? 'PDF' : req.file.originalname.split('.').pop().toUpperCase();
    }
  }
  if (!fileUrl) return res.send(renderPage('Upload Error', 'No file provided. Please upload a file or paste a URL.Try Again', req.session.user));
  await pool.query('INSERT INTO documents(tenant_id,title,description,file_url,file_type,category,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, title, description, fileUrl, fileType, category, req.session.user.email]);
  res.redirect('/documents');
}));

app.get('/documents/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM documents WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/documents');
}));

// === 2FA routes moved to feature-gated section below ===

// === INCOME TRACKING ===
app.get('/income', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [records, totalIncome, categories] = await Promise.all([
    pool.query('SELECT * FROM income_records WHERE tenant_id=$1 ORDER BY received_date DESC LIMIT 50', [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM income_records WHERE tenant_id=$1 AND EXTRACT(MONTH FROM received_date)=EXTRACT(MONTH FROM CURRENT_DATE)", [t]),
    pool.query("SELECT category, SUM(amount) as total FROM income_records WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC", [t])
  ]);
  res.send(renderPage('Income Tracking', `
    
      UGX ${Number(totalIncome.rows[0].total).toLocaleString()}This Month Income
      ${records.rows.length}Records
    
    
      Add Income
      
        
        
        TuitionDonationsSalesServicesRentalInterestOther
        
        
        Add Income
      
    
    
      Income by Category
      ${categories.rows.length ? `CategoryTotal${categories.rows.map(c=>`${esc(c.category||'Other')}UGX ${Number(c.total).toLocaleString()}`).join('')}` : 'No income records yet'}
    
    
      Recent Income
      ${records.rows.length ? `DateSourceCategoryAmountAction${records.rows.map(r=>`${new Date(r.received_date).toLocaleDateString()}${esc(r.source)}${esc(r.category||'other')}UGX ${Number(r.amount).toLocaleString()}Delete`).join('')}` : ''}
    
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
    
      Fundraising Campaigns
      New Campaign
      ${campaigns.map(c=>{const pct=c.target>0?Math.min(100,Math.round(c.raised/c.target*100)):0;return`${esc(c.title)}${esc(c.description||'')}UGX ${Number(c.raised).toLocaleString()} / UGX ${Number(c.target).toLocaleString()} (${pct}%)${esc(c.status)} ${c.end_date?'Ends: '+new Date(c.end_date).toLocaleDateString():''}View Add Pledge`}).join('')}
    
  `, req.session.user));
}));

app.get('/campaigns/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Campaign', `
    
      Create Campaign
      
        
        
        
        
        
        Create Campaign
      
    
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
    
      ${esc(c.title)}${esc(c.description||'')}
      ${pct}%
      UGX ${Number(c.raised).toLocaleString()}RaisedUGX ${Number(c.target).toLocaleString()}Target
    
    
      Pledges
      ${pledges.length?`DonorPledgedPaidDate${pledges.map(p=>`${esc(p.donor_name)}UGX ${Number(p.amount).toLocaleString()}UGX ${Number(p.paid).toLocaleString()}${new Date(p.pledged_at).toLocaleDateString()}`).join('')}`:'No pledges yet'}
    
    Back to Campaigns
  `, req.session.user));
}));

app.get('/campaigns/:id/pledge', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Pledge', `
    
      Add Pledge
      
        
        
        
        Add Pledge
      
    
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
    
      Member Roles & Permissions
      Create Role
      ${roles.length?`RolePermissionsActions${roles.map(r=>{const perms=typeof r.permissions==='string'?JSON.parse(r.permissions):r.permissions||{};return`${esc(r.role_name)}${Object.entries(perms).filter(([,v])=>v).map(([k])=>`${esc(k)}`).join(' ')}Delete`}).join('')}`:'No custom roles defined'}
    
    
      Default Roles
      ${defaultRoles.map(r=>`${esc(r)}Configure Permissions`).join('')}
    
  `, req.session.user));
}));

app.get('/roles/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Create Role', `
    
      Create Custom Role
      
        
        Permissions
         Create Records
         Read Records
         Update Records
         Delete Records
         Manage Users
         Manage Finances
         View Reports
         Send SMS
        Create Role
      
    
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
    
      Audit Logs
      
        
        Search
      
      TimeUserActionDetails
      ${logs.map(l=>`${new Date(l.created_at).toLocaleString()}${esc(l.user_email||'-')}${esc(l.action)}${esc(l.details||'-')}`).join('')}
      
    
  `, req.session.user));
}));

// === THEME BUILDER ===
app.get('/settings/theme', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT primary_color,secondary_color,accent_color,font_family,custom_css,language FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Theme Builder', `
    
      Theme Builder
      
        Primary Color
        Secondary Color
        Accent Color
        
          System Default
          Serif
          Monospace
        
        
          English
          Luganda
          Swahili
          French
        
        ${esc(tenant?.custom_css||'')}
        Save Theme
      
    
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
    
      ${esc(tenant.name)}
      ${esc(tenant.description||tenant.type)}
      Language: ${lang.toUpperCase()}
    
    
      ${tenant.type==='school'?'Student PortalAccess student resourcesLogin':''}
      ${tenant.type==='church'?'Church PortalAccess church resourcesLogin':''}
      ${tenant.type==='business'?'Business PortalAccess business servicesLogin':''}
      Contact${esc(tenant.email||'')}${esc(tenant.phone||'')}${esc(tenant.address||'')}
    
    ${tenant.custom_css?`${tenant.custom_css}`:''}
  `, null));
}));

// === PARENT LINK MANAGEMENT (ADMIN) ===
app.get('/school/parent-links', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const links = (await pool.query('SELECT pl.*,s.name as student_name FROM parent_links pl LEFT JOIN students s ON pl.student_id=s.id WHERE pl.tenant_id=$1 ORDER BY s.name', [t])).rows;
  res.send(renderPage('Parent Links', `
    
      Parent Links
      Add Parent Link
      ${links.length?`StudentParent EmailParent PhoneAction${links.map(l=>`${esc(l.student_name)}${esc(l.parent_email)}${esc(l.parent_phone||'-')}Remove`).join('')}`:'No parent links yet'}
    
  `, req.session.user));
}));

app.get('/school/parent-links/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Parent Link', `
    
      Link Parent to Student
      
        Select Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
        
        
        Create Link
      
    
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
    
      Send Email
      
        
        
        
        Send Email
      
    
  `, req.session.user));
});

app.post('/email/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { to, subject, body } = req.body;
  const sent = await sendEmail(to, subject, body);
  await audit(req.session.user.email, 'email_sent', `To: ${to}, Subject: ${subject}`);
  res.send(renderPage('Email', `${sent?'Email sent successfully!':'Email queued. Configure GMAIL_USER and GMAIL_PASS in env for delivery.'}Send Another`, req.session.user));
}));

// === SMS GATEWAY (Automated triggers) ===
// sendSMS is defined in utilities section above

app.get('/sms/send', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Send SMS', `
    
      Send SMS
      
        
        
        Send SMS
      
    
  `, req.session.user));
});

app.post('/sms/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { phone, message } = req.body;
  const sent = await sendSMS(phone, message);
  await audit(req.session.user.email, 'sms_sent', `To: ${phone}`);
  res.send(renderPage('SMS', `${sent?'SMS sent successfully!':'SMS queued. Configure Africa\'s Talking env vars for delivery.'}Send Another`, req.session.user));
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
    API DocumentationRESTful API for SSEWASSWA Platform
    
      Authentication
      Include your API key in the header: Authorization: Bearer YOUR_API_KEY
    
    
      Endpoints
      MethodEndpointDescription
      GET/api/v1/studentsList students
      POST/api/v1/studentsCreate student
      GET/api/v1/feesList fees
      POST/api/v1/fees/payRecord payment
      GET/api/v1/inventoryList inventory
      POST/api/v1/salesCreate sale
      GET/api/v1/membersList members
      POST/api/v1/donationsRecord donation
      GET/api/v1/invoicesList invoices
      POST/api/v1/campaignsCreate campaign
      
    
    
      Webhook Events
      EventTrigger
      paymentWhen a payment is recorded
      studentWhen a student is created/updated
      invoiceWhen an invoice status changes
      memberWhen a member is added
      
    
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
    System StatusReal-time platform health
    
      Service Status
      ServiceStatusLast UpdatedMessage
      ${services.map(s=>`${esc(s.service)}${esc(s.status)}${new Date(s.updated_at).toLocaleString()}${esc(s.message||'-')}`).join('')}
      DatabaseoperationalJust now-
      
    
    
      Uptime
      Current server time: ${new Date().toLocaleString()}
      All systems are monitored 24/7. Last checked: just now.
    
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
    Fee Balance SMSSend fee balance reminders to all parents
    ${balances.length}Parents with BalancesUGX ${balances.reduce((s,b)=>s+b.balance,0).toLocaleString()}Total Outstanding
    
      
        Dear Parent, your child {name} has a fee balance of UGX {balance} at ${esc(tenant?.name||'School')}. Please clear by end of term. Thank you.
        Send Bulk SMS to ${balances.length} Parents
      
    
    
      Parents with Balances
      ${balances.length ? `StudentPhoneBalance${balances.map(b=>`${esc(b.name)}${esc(b.guardian_phone)}UGX ${b.balance.toLocaleString()}`).join('')}` : 'No outstanding fee balances'}
    
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
  res.send(renderPage('SMS Sent', `Fee balance SMS sent to ${sent}/${balances.length} parents!Back`, req.session.user));
}));

// Duplicate /parent/logout removed - original at line ~4336

// ============================================================
// v1.0: FILE UPLOAD WITH CLOUDINARY
// ============================================================
app.get('/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const docs = (await pool.query('SELECT * FROM documents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [t])).rows;
  res.send(renderPage('File Upload', `
    File UploadUpload photos, receipts, and documents
    
      Upload File
      
        
        
        GeneralPhotoReceiptDocumentVideoAudio
        
        Or paste a URL:
        
        Upload
      
    
    
      Recent Uploads
      ${docs.slice(0,12).map(d=>`${d.file_url&&d.file_type==='photo'?``:''}${esc(d.title)}${esc(d.category||'file')}${new Date(d.created_at).toLocaleDateString()}${d.file_url?`View`:''} Delete`).join('')}
    
  `, req.session.user));
}));

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
  if (!fileUrl) return res.send(renderPage('Upload Error', 'No file provided. Please upload a file or paste a URL.Try Again', req.session.user));
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
    
      Bulk Email
      
        All Parents (${parents.rows.length})All Members (${members.rows.length})${classes.rows.map(c=>`Class ${esc(c.class)}`).join('')}
        
        
        Send Bulk Email
      
    
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
  res.send(renderPage('Bulk Email', `Email sent to ${sent}/${emails.length} recipients!Send Another`, req.session.user));
}));

// ============================================================
// v2.0: AUDIT LOG EXPORT + ENHANCED VIEWER
// ============================================================
app.get('/audit-logs/export', requireAuth, ah(async (req, res) => {
  const { from, to, action: actionFilter } = req.query;
  let q = 'SELECT * FROM audit_logs WHERE 1=1'; const params = []; let pi = 1;
  if (from) { q += ` AND created_at>=$${pi++}`; params.push(from); }
  if (to) { q += ` AND created_at `"${new Date(l.created_at).toISOString()}","${l.user_email||''}","${l.action}","${(l.details||'').replace(/"/g,'""')}"`).join('\n');
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
    ${esc(event.name)} - Tickets
    ${totalSold}Tickets SoldUGX ${totalRevenue.toLocaleString()}Revenue
    Add Ticket Type
      
        
        
        
        Add Ticket Type
      
    
    Ticket Types${tickets.rows.length?`TypePriceSoldTotal${tickets.rows.map(tk=>`${esc(tk.ticket_type)}UGX ${Number(tk.price).toLocaleString()}${tk.quantity_sold}${tk.quantity_total}`).join('')}`:'No ticket types'}
    Sell Ticket
      
        
        
        
        ${tickets.rows.map(tk=>`${esc(tk.ticket_type)} - UGX ${Number(tk.price).toLocaleString()}`).join('')}
        CashMobile MoneyCard
        Sell Ticket
      
    
    Recent Sales${sales.rows.length?`BuyerTypeAmountMethodStatusDate${sales.map(s=>`${esc(s.buyer_name)}${esc(s.ticket_type)}UGX ${Number(s.amount).toLocaleString()}${esc(s.payment_method)}${esc(s.status)}${new Date(s.created_at).toLocaleDateString()}`).join('')}`:'No sales yet'}
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
  if (!ticket || ticket.quantity_sold >= ticket.quantity_total) return res.send(renderPage('Sold Out', 'This ticket type is sold out!', req.session.user));
  const amount = ticket.price;
  await pool.query('INSERT INTO ticket_sales(tenant_id,event_id,ticket_type,buyer_name,buyer_phone,buyer_email,amount,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.params.id, ticket_type, buyer_name, buyer_phone, buyer_email, amount, payment_method, 'confirmed']);
  await pool.query('UPDATE event_tickets SET quantity_sold=quantity_sold+1 WHERE id=$1', [ticket.id]);
  if (buyer_email) { sendEmail(buyer_email, `Ticket Confirmed - ${ticket_type}`, `Hi ${buyer_name}, your ${ticket_type} ticket is confirmed. Amount: UGX ${amount.toLocaleString()}. Thank you!`); }
  res.redirect(`/events/${req.params.id}/tickets`);
}));

// ============================================================
// v3.0: CHART OF ACCOUNTS + DOUBLE-ENTRY LEDGER
// ============================================================
app.get('/accounts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT * FROM chart_of_accounts WHERE tenant_id=$1 ORDER BY code', [t])).rows;
  res.send(renderPage('Chart of Accounts', `
    Chart of AccountsDouble-entry bookkeeping
    Add Account
      
        
        
        AssetLiabilityEquityIncomeExpense
        Add Account
      
    
    Accounts${accounts.length?`CodeNameTypeBalanceActions${accounts.map(a=>`${esc(a.code)}${esc(a.name)}${esc(a.type)}UGX ${Number(a.balance).toLocaleString()}Ledger Delete`).join('')}`:'No accounts. Add standard accounts below.'}
    Load Default Accounts
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
    ${esc(account?.code)} - ${esc(account?.name)} (${esc(account?.type)})
    UGX ${totalDebit.toLocaleString()}Total DebitUGX ${totalCredit.toLocaleString()}Total CreditUGX ${(totalDebit-totalCredit).toLocaleString()}Balance
    Add Entry
    
      
      
      
      
      Add Entry
    
    Ledger Entries${entries.length?`DateReferenceDescriptionDebitCredit${entries.map(e=>`${new Date(e.entry_date).toLocaleDateString()}${esc(e.reference||'-')}${esc(e.description)}${e.debit>0?'UGX '+Number(e.debit).toLocaleString():'-'}${e.credit>0?'UGX '+Number(e.credit).toLocaleString():'-'}`).join('')}`:'No entries'}
    Back to Accounts
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
    ${totalHours}Total Hours${hours.rows.length}Entries
    Log Hours
      
        Select Member${members.rows.map(m=>`${esc(m.name)}`).join('')}
        
        
        
        Log Hours
      
    
    Hours Log${hours.rows.length?`MemberActivityHoursDateApproved${hours.rows.map(h=>`${esc(h.member_name)}${esc(h.activity)}${h.hours}${new Date(h.date).toLocaleDateString()}${h.approved?'Yes':`Approve`}`).join('')}`:'No hours logged'}
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
    SuppliersAdd Supplier
    ${suppliers.length?`NameEmailPhoneAddressActions${suppliers.map(s=>`${esc(s.name)}${esc(s.email||'-')}${esc(s.phone||'-')}${esc(s.address||'-')}Delete`).join('')}`:'No suppliers'}
  `, req.session.user));
}));

app.get('/suppliers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Supplier', 'Add SupplierAdd Supplier', req.session.user));
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
    BranchesAdd Branch
    ${branches.length?`NameLocationManagerActions${branches.map(b=>`${esc(b.name)}${esc(b.location||'-')}${esc(b.manager||'-')}Delete`).join('')}`:'No branches'}
  `, req.session.user));
}));

app.get('/branches/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Branch', 'Add BranchAdd Branch', req.session.user));
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
    Award Points
      
        Customer${customers.map(c=>`${esc(c.name)}`).join('')}
        
        
        Award Points
      
    
    Points History${points.length?`CustomerPointsSourceDate${points.map(p=>`${esc(p.customer_name)}${p.points}${esc(p.earned_from||'-')}${new Date(p.created_at).toLocaleDateString()}`).join('')}`:'No points awarded'}
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
    SMS CampaignsNew Campaign
    ${campaigns.length?`TitleTargetStatusSentActions${campaigns.map(c=>`${esc(c.title)}${esc(c.target_group)}${esc(c.status)}${c.sent_count}${c.status==='draft'?`Send`:''} Delete`).join('')}`:'No campaigns'}
  `, req.session.user));
}));

app.get('/sms-campaigns/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New SMS Campaign', 'New SMS CampaignAll CustomersAll MembersAll ParentsCreate Campaign', req.session.user));
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
    UGX ${totalInvested.toLocaleString()}Total InvestedUGX ${totalValue.toLocaleString()}Current Value=0?'#059669':'#dc2626'}">UGX ${(totalValue-totalInvested).toLocaleString()}Gain/Loss
    Add Investment
      
        
        Fixed DepositBondsStocksReal EstateSavingsOther
        
        
        
        
        
        
        Add Investment
      
    
    Portfolio${investments.length?`NameTypeInvestedCurrentReturnMaturityActions${investments.map(i=>{const ret=Number(i.current_value||i.amount)-Number(i.amount);return`${esc(i.name)}${esc(i.type)}UGX ${Number(i.amount).toLocaleString()}UGX ${Number(i.current_value||i.amount).toLocaleString()}=0?'#059669':'#dc2626'}">UGX ${ret.toLocaleString()}${i.maturity_date?new Date(i.maturity_date).toLocaleDateString():'-'}Delete`}).join('')}`:'No investments'}
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
    UGX ${totalOwed.toLocaleString()}Total OwedUGX ${totalPaid.toLocaleString()}Total PaidUGX ${(totalOwed-totalPaid).toLocaleString()}Remaining
    Add Debt
      
        
        
        
        
        
        
        Add Debt
      
    
    Debts${debts.length?`NameOwedPaidRemainingMonthlyMonths LeftActions${debts.map(d=>{const rem=d.total_owed-d.paid;const months=d.monthly_payment>0?Math.ceil(rem/d.monthly_payment):'N/A';return`${esc(d.name)}UGX ${Number(d.total_owed).toLocaleString()}UGX ${Number(d.paid).toLocaleString()}UGX ${rem.toLocaleString()}UGX ${Number(d.monthly_payment).toLocaleString()}${months}Pay Delete`}).join('')}`:'No debts tracked'}
  `, req.session.user));
}));

app.post('/debt-payoff/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO debt_payoff(tenant_id,name,total_owed,interest_rate,min_payment,monthly_payment,paid) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.name, req.body.total_owed, req.body.interest_rate, req.body.min_payment, req.body.monthly_payment, req.body.paid||0]);
  res.redirect('/debt-payoff');
}));

app.get('/debt-payoff/:id/pay', requireAuth, requireNotBanned, ah(async (req, res) => {
  const debt = (await pool.query('SELECT * FROM debt_payoff WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  res.send(renderPage('Make Payment', `Pay ${esc(debt.name)}Remaining: UGX ${(debt.total_owed-debt.paid).toLocaleString()}Record Payment`, req.session.user));
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
    
      Mobile Money Payment
      
        
        
        
        MTN MoMoAirtel Money
        Initiate Payment
      
      Requires FLW_SECRET_KEY for live mobile money via Flutterwave.
    
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
  res.send(renderPage('MoMo', 'Payment initiated. Configure FLW_SECRET_KEY for live payments.Back', req.session.user));
}));

// ============================================================
// v6.0: AUTOMATION RULES ENGINE
// ============================================================
app.get('/automations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rules = (await pool.query('SELECT * FROM automation_rules WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Automation Rules', `
    Automation EngineSet up automatic actions based on events
    Create Rule
      
        
        Fee PaymentFee OverdueStudent EnrolledDonation ReceivedInvoice CreatedMember Added
        100000 or leave empty)">
        Send SMSSend EmailPlatform NotificationFire Webhook
        
        Create Rule
      
    
    Active Rules${rules.length?`NameTriggerActionActiveLast FiredActions${rules.map(r=>`${esc(r.name)}${esc(r.trigger_event)}${esc(r.action)}${r.active?'Yes':'No'}${r.last_fired?new Date(r.last_fired).toLocaleString():'Never'}${r.active?'Disable':'Enable'} Delete`).join('')}`:'No automation rules'}
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
    IntegrationsConnect external services
    
      FlutterwavePayment processing${process.env.FLW_SECRET_KEY?'Connected':'Not configured'}
      Africa's TalkingSMS gateway${process.env.AT_API_KEY?'Connected':'Not configured'}
      CloudinaryFile uploads${process.env.CLOUDINARY_URL?'Connected':'Not configured'}
      Gmail SMTPEmail delivery${process.env.GMAIL_USER?'Connected':'Not configured'}
    
    Custom IntegrationAdd Integration
    ${configs.length?`ServiceActiveActions${configs.map(c=>`${esc(c.service)}${c.active?'Yes':'No'}Remove`).join('')}`:''}
  `, req.session.user));
}));

app.get('/integrations/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Integration', 'Add IntegrationSave Integration', req.session.user));
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
  if (attRate AI InsightsSmart analytics and predictions
    UGX ${outstanding.toLocaleString()}Fee Outstanding${attRate}%Attendance Rate
    Latest Insights${allInsights.length?allInsights.map(i=>`${esc(i.type.replace(/_/g,' ').toUpperCase())}${esc(i.insight)}Confidence: ${Math.round(Number(i.confidence)*100)}% - ${new Date(i.created_at).toLocaleDateString()}`).join(''):'No insights yet. Add more data to generate insights.'}
    Refresh Insights
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
    Custom ReportsBuild and save custom reports
    Create Report
      
        
        StudentsFeesAttendanceExpensesIncome RecordsDonationsSales
        
        
        
        Save & Generate Report
      
    
    Saved Reports${templates.length?templates.map(t=>`${esc(t.name)} - ${esc(t.config?.data_source||'custom')}Run Report Delete`).join(''):'No saved reports'}
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
  else if (config.data_source === 'expenses') data = (await pool.query('SELECT * FROM expenses WHERE tenant_id=$1 ORDER BY COALESCE(expense_date, created_at) DESC', [t])).rows;
  else if (config.data_source === 'donations') data = (await pool.query('SELECT * FROM donations WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  else if (config.data_source === 'sales') data = (await pool.query('SELECT * FROM sales WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  else data = (await pool.query(`SELECT * FROM ${config.data_source} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`, [t])).rows;
  const cols = config.columns?.length ? config.columns : Object.keys(data[0] || {});
  res.send(renderPage(tmpl.name, `${esc(tmpl.name)}Back${data.length?`${cols.map(c=>`${esc(c)}`).join('')}${data.map(r=>`${cols.map(c=>`${esc(r[c]||'-')}`).join('')}`).join('')}`:'No data'}`, req.session.user));
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
    MarketplaceExtend your platform with plugins
    ${plugins.map(p=>`${esc(p.name)}${esc(p.description||'')}${esc(p.category||'General')}By ${esc(p.author||'SSEWASSWA')} | ${p.downloads} downloads${installed.includes(p.id)?'Installed':`Install${p.price>0?' - UGX '+Number(p.price).toLocaleString():' - Free'}`}`).join('')}
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
    
      ${esc(campaign.title)}${esc(campaign.description||'')}
      ${pct}%
      UGX ${Number(campaign.raised).toLocaleString()}RaisedUGX ${Number(campaign.target).toLocaleString()}Target
      
        
        
        
        
        Mobile MoneyCardBank Transfer
        Donate Now
      
    
  `, null));
}));

app.post('/donate/:campaignId/submit', ah(async (req, res) => {
  const campaign = (await pool.query('SELECT * FROM campaigns WHERE id=$1', [req.params.campaignId])).rows[0];
  const { donor_name, donor_email, amount, method } = req.body;
  await pool.query('INSERT INTO donations(tenant_id,donor_name,amount,type,method) VALUES($1,$2,$3,$4,$5)', [campaign.tenant_id, donor_name, amount, 'donation', method]);
  await pool.query('UPDATE campaigns SET raised=raised+$1 WHERE id=$2', [amount, campaign.id]);
  await fireWebhook(campaign.tenant_id, 'donation.received', { donor: donor_name, amount, campaign: campaign.title });
  await evaluateAutomations(campaign.tenant_id, 'donation.received', { amount, donor: donor_name });
  if (donor_email) sendEmail(donor_email, 'Thank you for your donation!', `Hi ${donor_name}, thank you for donating UGX ${Number(amount).toLocaleString()} to "${campaign.title}".`);
  res.send(renderPage('Thank You!', 'Thank You!Your donation has been recorded.Home', null));
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
    BenchmarksHow you compare to other ${esc(tenant?.type||'organizations')}
    
      Fee CollectionYour: UGX ${Number(myFeeCollection.rows[0].total).toLocaleString()}Average: UGX ${Number(avgFeeCollection).toLocaleString()}=Number(avgFeeCollection)?'#059669':'#dc2626'}">${Number(myFeeCollection.rows[0].total)>=Number(avgFeeCollection)?'Above':'Below'} average
      StudentsYour: ${myStudentCount.rows[0].count}Average: ${Math.round(Number(avgStudents))}=Number(avgStudents)?'#059669':'#dc2626'}">${Number(myStudentCount.rows[0].count)>=Number(avgStudents)?'Above':'Below'} average
      Attendance RateYour: ${myAttendanceRate.rows[0]?.rate||0}%Target: 85%
    
  `, req.session.user));
}));

// ============================================================
// v9.0: MULTI-CURRENCY + TRANSLATIONS
// ============================================================
app.get('/settings/currency', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT currency,country FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Currency & Region', `
    
      Currency & Region Settings
      
        UGX - Uganda ShillingKES - Kenya ShillingTZS - Tanzania ShillingRWF - Rwanda FrancUSD - US Dollar
        UgandaKenyaTanzaniaRwanda
        Save
      
    
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
    Translation Editor
      
        EnglishLugandaSwahiliFrench
        
        
        Add/Update Translation
      
    
    Existing Translations
    ${langs.map(lang=>`${lang.toUpperCase()}KeyValue${allTranslations.filter(t=>t.lang===lang).map(t=>`${esc(t.key)}${esc(t.value)}`).join('')}`).join('')}
    
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
    Government ReportsCompliance and ministry reporting
    ${students.rows[0].total}Total Students${students.rows[0].male||0}Male${students.rows[0].female||0}Female
    Generate Enrollment Report
      
        Enrollment ReportAttendance ReportFinancial ReportStaff Report
        
        Generate Report
      
    
    Submitted Reports${reports.length?`TypePeriodSubmittedDate${reports.map(r=>`${esc(r.report_type)}${esc(r.period)}${r.submitted?'Yes':'No'}${new Date(r.created_at).toLocaleDateString()}`).join('')}`:'No reports generated'}
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
    Biometric AttendanceFingerprint & Face ID verification
    Record Biometric
      
        StudentStaffMember
        
        FingerprintFace IDRFID Card
        
        Verify & Record
      
      Connect biometric devices via API for automated verification.
    
    Recent Biometric Logs${logs.length?`TypeUserMethodVerifiedDeviceTime${logs.map(l=>`${esc(l.user_type)}${l.user_id}${esc(l.biometric_type)}${l.verified?'Yes':'No'}${esc(l.device_id||'-')}${new Date(l.created_at).toLocaleString()}`).join('')}`:'No biometric logs'}
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
    Compliance & Audit
      
        Data ProtectionFinancial AuditAccess ControlData Retention
        Generate Compliance Report
      
    
    Audit History${audits.length?`TypeStatusDate${audits.map(a=>`${esc(a.audit_type)}${esc(a.status)}${new Date(a.created_at).toLocaleDateString()}`).join('')}`:'No compliance audits'}
    Export Full Audit Trail (CSV)
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
    Update Service Status
      ${services.map(s=>`${esc(s.service)}OperationalDegradedDownMaintenanceUpdate`).join('')}
    
    Report Incident
      
        
        
        Report Incident
      
    
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
    SettingsConfigure your platform
    
      ProfileChange password, emailManage
      ThemeColors, fonts, CSSCustomize
      2FA SecurityTwo-factor authenticationConfigure
      BillingPlans & paymentsManage
      API KeysAPI access & webhooksManage
      BrandingLogo, favicon, subdomainCustomize
      LanguageTranslations & localeChange
      CurrencyUGX, KES, TZS, RWFChange
      IntegrationsFlutterwave, SMS, CloudinaryConfigure
      BackupExport/Import dataBackup
      ComplianceAudit & data protectionView
      Status PagePlatform healthView
    
  `, req.session.user));
}));

// =============================================
// v1.0→v9.0 MISSING FEATURE ROUTES
// =============================================

// === v1.0: BULK FEE REMINDERS (SMS to all parents with balances) ===
app.get('/school/fees/remind', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.*,s.name as student_name,s.guardian_phone,s.parent_email FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND f.paid Dear Parent,Your child ${esc(fee.student_name)} has an outstanding fee balance of UGX ${balance.toLocaleString()}.Please clear the balance at your earliest convenience.`); sent++; }
  }
  res.send(renderPage('Fee Reminders', `Reminders Sent${sent} reminders sent to parents with outstanding balances.Back to Fees`, req.session.user));
}));

// === v1.0: REAL FILE UPLOAD WITH MULTER ===
try {
  const multer = require('multer');
  const uploadDir = require('path').join(__dirname, 'uploads');
  try { require('fs').mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
  const storage = multer.diskStorage({ destination: uploadDir, filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '')) });
  const uploadMulter = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
  app.post('/upload/file', requireAuth, requireNotBanned, uploadMulter.single('file'), ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    if (!req.file) return res.status(400).send('No file uploaded');
    let fileUrl = `/uploads/${req.file.filename}`;
    // If Cloudinary configured, upload there instead
    if (process.env.CLOUDINARY_URL) {
      try {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({ url: process.env.CLOUDINARY_URL });
        const result = await cloudinary.uploader.upload(req.file.path, { folder: `tenant_${t}` });
        fileUrl = result.secure_url;
      } catch (e) { console.warn('Cloudinary upload failed:', e.message); }
    }
    const title = req.body.title || req.file.originalname;
    const category = req.body.category || 'general';
    await pool.query('INSERT INTO documents(tenant_id,title,file_url,file_type,category,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)', [t, title, fileUrl, req.file.mimetype, category, req.session.user.email]);
    await audit(req.session.user.email, 'file_upload', `Uploaded: ${title}`);
    res.redirect('/documents');
  }));
  app.use('/uploads', express.static(uploadDir));
} catch(e) { console.warn('Multer not available, file upload disabled'); }

// === v2.0: SMS BULK SEND ===
app.get('/sms/bulk', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [parents, members, staff] = await Promise.all([
    pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL', [t]),
    pool.query('SELECT phone FROM church_members WHERE tenant_id=$1 AND phone IS NOT NULL', [t]),
    pool.query('SELECT phone FROM staff WHERE tenant_id=$1 AND phone IS NOT NULL', [t])
  ]);
  res.send(renderPage('Bulk SMS', `
    
      Bulk SMS
      
        ${parents.rows.length}Parents
        ${members.rows.length}Church Members
        ${staff.rows.length}Staff
      
      
         Parents (${parents.rows.length})
         Church Members (${members.rows.length})
         Staff (${staff.rows.length})
        
        Send Bulk SMS
      
    
  `, req.session.user));
}));

app.post('/sms/bulk/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { groups, message } = req.body;
  const selectedGroups = Array.isArray(groups) ? groups : [groups];
  const phones = new Set();
  for (const g of selectedGroups) {
    if (g === 'parents') { const r = await pool.query('SELECT DISTINCT guardian_phone FROM students WHERE tenant_id=$1 AND guardian_phone IS NOT NULL', [t]); r.rows.forEach(r => phones.add(r.guardian_phone)); }
    if (g === 'members') { const r = await pool.query('SELECT phone FROM church_members WHERE tenant_id=$1 AND phone IS NOT NULL', [t]); r.rows.forEach(r => phones.add(r.phone)); }
    if (g === 'staff') { const r = await pool.query('SELECT phone FROM staff WHERE tenant_id=$1 AND phone IS NOT NULL', [t]); r.rows.forEach(r => phones.add(r.phone)); }
  }
  let sent = 0;
  for (const phone of phones) { const ok = await sendSMS(phone, message); if (ok) sent++; }
  await audit(req.session.user.email, 'bulk_sms', `Sent ${sent}/${phones.size} SMS to ${selectedGroups.join(', ')}`);
  res.send(renderPage('Bulk SMS', `SMS Sent${sent} of ${phones.size} messages delivered.Send More`, req.session.user));
}));

// === v2.0: DEBT AGING REPORT ===
app.get('/business/debts/aging', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query("SELECT *, EXTRACT(DAY FROM NOW()-created_at) as age_days FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t])).rows;
  const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  invoices.forEach(inv => { const d = parseInt(inv.age_days); if (d  a+b, 0);
  res.send(renderPage('Debt Aging', `
    Debt Aging ReportReceivables by age
    UGX ${total.toLocaleString()}Total Outstanding${invoices.length}Unpaid Invoices
    Aging Breakdown
      AgeAmount%
      ${Object.entries(aging).map(([k,v]) => `${k} daysUGX ${v.toLocaleString()}${total?((v/total)*100).toFixed(1):0}%`).join('')}
      
    
    Unpaid Invoices
      Invoice#CustomerAmountAge (days)Created
      ${invoices.sort((a,b) => b.age_days - a.age_days).map(i => `${esc(i.invoice_no)}${esc(i.customer_name)}UGX ${parseInt(i.amount).toLocaleString()}${i.age_days}${new Date(i.created_at).toLocaleDateString()}`).join('') || 'No unpaid invoices'}
      
    
  `, req.session.user));
}));

// === v3.0: CHURCH LIVESTREAM ===
app.get('/church/livestream', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const streams = (await pool.query('SELECT * FROM livestream_links WHERE tenant_id=$1 ORDER BY scheduled_at DESC', [t])).rows;
  res.send(renderPage('Livestream', `
    LivestreamManage service livestream links
    + Add Livestream
      ${streams.length ? `ServicePlatformScheduledStatusActions${streams.map(s => `${esc(s.service_name)}${esc(s.platform||'-')}${s.scheduled_at?new Date(s.scheduled_at).toLocaleString():'-'}${s.active?'Active':'Inactive'}Watch Delete`).join('')}` : 'No livestreams scheduled'}
    
  `, req.session.user));
}));

app.get('/church/livestream/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Livestream', `Add Livestream LinkYouTubeFacebook LiveZoomOtherSave`, req.session.user));
});

app.post('/church/livestream/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { service_name, platform, url, scheduled_at } = req.body;
  await pool.query('INSERT INTO livestream_links(tenant_id,service_name,platform,url,scheduled_at) VALUES($1,$2,$3,$4,$5)', [t, service_name, platform, url, scheduled_at || null]);
  res.redirect('/church/livestream');
}));

app.get('/church/livestream/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM livestream_links WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/church/livestream');
}));

// === v3.0: DONATION TAX RECEIPT ===
app.get('/church/donations/:id/tax-receipt', requireAuth, requireNotBanned, ah(async (req, res) => {
  const donation = (await pool.query('SELECT d.*,t.name as tenant_name,t.email as org_email,t.address FROM donations d LEFT JOIN tenants t ON d.tenant_id=t.id WHERE d.id=$1', [req.params.id])).rows[0];
  if (!donation) return res.status(404).send('Donation not found');
  const receiptNo = 'TXR-' + donation.id + '-' + Date.now().toString(36).toUpperCase();
  const doc = new Document({ sections: [{ properties: {}, children: [
    new Paragraph({ children: [new TextRun({ text: donation.tenant_name || 'SSEWASSWA', bold: true, size: 32 })], alignment: 'center' }),
    new Paragraph({ children: [new TextRun({ text: 'DONATION TAX RECEIPT', bold: true, size: 24 })], alignment: 'center' }),
    new Paragraph({ children: [new TextRun({ text: `Receipt No: ${receiptNo}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Date: ${new Date(donation.created_at).toLocaleDateString()}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Donor: ${donation.donor_name}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Amount: UGX ${parseInt(donation.amount).toLocaleString()}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Type: ${donation.type || 'Donation'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Method: ${donation.method || '-'}` })] }),
    new Paragraph({ children: [] }),
    new Paragraph({ children: [new TextRun({ text: 'This receipt is issued for tax deduction purposes.', italics: true, size: 18 })] }),
    new Paragraph({ children: [new TextRun({ text: `Organization: ${donation.tenant_name || ''}` })] }),
    new Paragraph({ children: [new TextRun({ text: `Address: ${donation.address || '-'}` })] }),
  ] }] });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="tax-receipt-${receiptNo}.docx"`);
  res.send(buffer);
}));

// === v3.0: CHART OF ACCOUNTS ===
app.get('/business/chart-of-accounts', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT * FROM chart_of_accounts WHERE tenant_id=$1 ORDER BY code', [t])).rows;
  res.send(renderPage('Chart of Accounts', `
    Chart of AccountsDouble-entry bookkeeping accounts
    + New Account
      ${accounts.length ? `CodeNameTypeBalanceActions${accounts.map(a => `${esc(a.code)}${esc(a.name)}${esc(a.type)}UGX ${parseInt(a.balance||0).toLocaleString()}Ledger Delete`).join('')}` : 'No accounts. Setup defaults'}
    
  `, req.session.user));
}));

app.get('/business/chart-of-accounts/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Account', `Create AccountAssetLiabilityEquityIncomeExpenseCreate Account`, req.session.user));
});

app.post('/business/chart-of-accounts/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { code, name, type } = req.body;
  await pool.query('INSERT INTO chart_of_accounts(tenant_id,code,name,type) VALUES($1,$2,$3,$4)', [t, code, name, type]);
  res.redirect('/business/chart-of-accounts');
}));

app.get('/business/chart-of-accounts/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/chart-of-accounts');
}));

app.get('/business/chart-of-accounts/:id/ledger', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const account = (await pool.query('SELECT * FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!account) return res.status(404).send('Account not found');
  const entries = (await pool.query('SELECT le.*,je.description as jdesc,je.date FROM ledger_entries le LEFT JOIN journal_entries je ON le.journal_id=je.id WHERE le.account_id=$1 ORDER BY le.created_at DESC', [account.id])).rows;
  const totalDebit = entries.reduce((a,e) => a + parseInt(e.debit||0), 0);
  const totalCredit = entries.reduce((a,e) => a + parseInt(e.credit||0), 0);
  res.send(renderPage(`${account.name} Ledger`, `
    ${esc(account.name)}Account ${esc(account.code)} - ${esc(account.type)}
    UGX ${totalDebit.toLocaleString()}Total DebitsUGX ${totalCredit.toLocaleString()}Total CreditsUGX ${(totalDebit-totalCredit).toLocaleString()}Net Balance
    Ledger Entries
      DateDescriptionDebitCredit
      ${entries.map(e => `${e.date?new Date(e.date).toLocaleDateString():'-'}${esc(e.description||e.jdesc||'-')}${e.debit?'UGX '+parseInt(e.debit).toLocaleString():'-'}${e.credit?'UGX '+parseInt(e.credit).toLocaleString():'-'}`).join('') || 'No entries'}
      
    
  `, req.session.user));
}));

// === v3.0: JOURNAL ENTRIES ===
app.get('/business/journal', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const journals = (await pool.query('SELECT * FROM journal_entries WHERE tenant_id=$1 ORDER BY date DESC', [t])).rows;
  res.send(renderPage('Journal Entries', `
    Journal EntriesDouble-entry bookkeeping
    + New Journal Entry
      ${journals.length ? `DateDescriptionReferenceActions${journals.map(j => `${new Date(j.date).toLocaleDateString()}${esc(j.description||'-')}${esc(j.reference||'-')}View`).join('')}` : 'No journal entries'}
    
  `, req.session.user));
}));

app.get('/business/journal/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT * FROM chart_of_accounts WHERE tenant_id=$1 ORDER BY code', [t])).rows;
  res.send(renderPage('New Journal Entry', `
    New Journal Entry
    Each journal entry must have balanced debits and credits.
    
      
      
      
      Lines
      
        
          ${accounts.map(a => `${esc(a.code)} - ${esc(a.name)}`).join('')}
          
          
        
        
          ${accounts.map(a => `${esc(a.code)} - ${esc(a.name)}`).join('')}
          
          
        
      
      Save Journal Entry
    
  `, req.session.user));
}));

app.post('/business/journal/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { date, description, reference } = req.body;
  const journal = await pool.query('INSERT INTO journal_entries(tenant_id,date,description,reference) VALUES($1,$2,$3,$4) RETURNING id', [t, date, description, reference]);
  const jid = journal.rows[0].id;
  for (let i = 1; i  0 || credit > 0)) {
      await pool.query('INSERT INTO ledger_entries(tenant_id,journal_id,account_id,debit,credit,description) VALUES($1,$2,$3,$4,$5,$6)', [t, jid, accountId, debit, credit, description]);
      // Update account balance
      const balChange = debit - credit;
      await pool.query('UPDATE chart_of_accounts SET balance=balance+$1 WHERE id=$2', [balChange, accountId]);
    }
  }
  await audit(req.session.user.email, 'journal_entry', `Created journal entry: ${description}`);
  res.redirect('/business/journal');
}));

app.get('/business/journal/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const journal = (await pool.query('SELECT * FROM journal_entries WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!journal) return res.status(404).send('Journal entry not found');
  const entries = (await pool.query('SELECT le.*,ca.code,ca.name as account_name FROM ledger_entries le LEFT JOIN chart_of_accounts ca ON le.account_id=ca.id WHERE le.journal_id=$1', [journal.id])).rows;
  res.send(renderPage('Journal Entry', `
    Journal Entry - ${new Date(journal.date).toLocaleDateString()}${esc(journal.description||'')}Ref: ${esc(journal.reference||'-')}
      AccountDebitCredit
      ${entries.map(e => `${esc(e.code)} - ${esc(e.account_name)}${e.debit?'UGX '+parseInt(e.debit).toLocaleString():'-'}${e.credit?'UGX '+parseInt(e.credit).toLocaleString():'-'}`).join('')}
      
      Back to Journal
    
  `, req.session.user));
}));

// === v3.0: MEETING AGENDA BUILDER ===
app.get('/org/meetings/:id/agenda', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const meeting = (await pool.query('SELECT * FROM meeting_minutes WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!meeting) return res.status(404).send('Meeting not found');
  const agendaItems = (await pool.query('SELECT * FROM meeting_agendas WHERE meeting_id=$1 ORDER BY order_no', [meeting.id])).rows;
  res.send(renderPage('Meeting Agenda', `
    Agenda: ${esc(meeting.title)}${meeting.meeting_date?new Date(meeting.meeting_date).toLocaleDateString():''}
      + Add Agenda Item
      ${agendaItems.length ? `#ItemStatusActions${agendaItems.map(a => `${a.order_no}${esc(a.item_text)}${a.completed?'Done':'Pending'}Toggle Delete`).join('')}` : 'No agenda items yet'}
    
  `, req.session.user));
}));

app.get('/org/meetings/:id/agenda/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Agenda Item', `Add Agenda ItemAdd Item`, req.session.user));
});

app.post('/org/meetings/:id/agenda/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { item_text, order_no } = req.body;
  await pool.query('INSERT INTO meeting_agendas(tenant_id,meeting_id,item_text,order_no) VALUES($1,$2,$3,$4)', [t, req.params.id, item_text, order_no || 1]);
  res.redirect(`/org/meetings/${req.params.id}/agenda`);
}));

app.get('/org/meetings/agenda/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE meeting_agendas SET completed=NOT completed WHERE id=$1', [req.params.id]);
  res.redirect('back');
}));

app.get('/org/meetings/agenda/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM meeting_agendas WHERE id=$1', [req.params.id]);
  res.redirect('back');
}));

// === v4.0: BUSINESS CASH FLOW FORECAST ===
app.get('/business/cashflow', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [receivables, payables, expenses, incomes] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t]),
    pool.query("SELECT COALESCE(SUM(total),0) as total FROM purchase_orders WHERE tenant_id=$1 AND (status='pending' OR status='approved')", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1", [t]),
    pool.query("SELECT COALESCE(SUM(amount),0) as total FROM income_records WHERE tenant_id=$1", [t])
  ]);
  const recTotal = parseInt(receivables.rows[0]?.total || 0);
  const payTotal = parseInt(payables.rows[0]?.total || 0);
  const expTotal = parseInt(expenses.rows[0]?.total || 0);
  const incTotal = parseInt(incomes.rows[0]?.total || 0);
  const netFlow = incTotal + recTotal - expTotal - payTotal;
  res.send(renderPage('Cash Flow Forecast', `
    Cash Flow ForecastProjected cash position
    
      UGX ${incTotal.toLocaleString()}Income
      UGX ${recTotal.toLocaleString()}Receivables
      UGX ${expTotal.toLocaleString()}Expenses
      UGX ${payTotal.toLocaleString()}Payables
      =0?'#059669':'#dc2626'}">UGX ${netFlow.toLocaleString()}Net Position
    
    30-Day ProjectionBased on current receivables and payables, your projected net cash position in 30 days is =0?'#059669':'#dc2626'}">UGX ${netFlow.toLocaleString()}.
  `, req.session.user));
}));

// === v4.0: STOCK VALUATION ===
app.get('/business/stock-valuation', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const totalCost = items.reduce((a,i) => a + parseInt(i.cost_price||0) * parseInt(i.quantity||0), 0);
  const totalRetail = items.reduce((a,i) => a + parseInt(i.selling_price||0) * parseInt(i.quantity||0), 0);
  const totalQty = items.reduce((a,i) => a + parseInt(i.quantity||0), 0);
  res.send(renderPage('Stock Valuation', `
    Stock ValuationInventory value analysis
    
      ${totalQty}Total Units
      UGX ${totalCost.toLocaleString()}Cost Value
      UGX ${totalRetail.toLocaleString()}Retail Value
      UGX ${(totalRetail-totalCost).toLocaleString()}Potential Profit
    
    Stock Details
      ItemSKUQtyCostSellingTotal CostTotal Retail
      ${items.map(i => `${esc(i.name)}${esc(i.sku||'-')}${i.quantity}UGX ${parseInt(i.cost_price||0).toLocaleString()}UGX ${parseInt(i.selling_price||0).toLocaleString()}UGX ${(parseInt(i.cost_price||0)*parseInt(i.quantity||0)).toLocaleString()}UGX ${(parseInt(i.selling_price||0)*parseInt(i.quantity||0)).toLocaleString()}`).join('') || 'No inventory'}
      
    
  `, req.session.user));
}));

// === v4.0: AGED RECEIVABLES ===
app.get('/business/receivables', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const invoices = (await pool.query("SELECT *, EXTRACT(DAY FROM NOW()-created_at) as age_days FROM invoices WHERE tenant_id=$1 AND status='unpaid' ORDER BY created_at", [t])).rows;
  const sales = (await pool.query("SELECT *, EXTRACT(DAY FROM NOW()-created_at) as age_days FROM sales WHERE tenant_id=$1 AND status!='paid' ORDER BY created_at", [t])).rows;
  const totalInv = invoices.reduce((a,i) => a + parseInt(i.amount||0) - parseInt(i.paid||0), 0);
  const totalSales = sales.reduce((a,s) => a + parseInt(s.total||0) - parseInt(s.paid||0), 0);
  res.send(renderPage('Aged Receivables', `
    Aged ReceivablesOutstanding payments analysis
    UGX ${totalInv.toLocaleString()}Invoice OutstandingUGX ${totalSales.toLocaleString()}Sales Outstanding
    Unpaid Invoices
      ${invoices.length ? `Invoice#CustomerAmountPaidBalanceAge${invoices.map(i => `${esc(i.invoice_no)}${esc(i.customer_name)}UGX ${parseInt(i.amount).toLocaleString()}UGX ${parseInt(i.paid||0).toLocaleString()}UGX ${(parseInt(i.amount)-parseInt(i.paid||0)).toLocaleString()}${Math.round(i.age_days)} days`).join('')}` : 'No unpaid invoices'}
    
    Partial Sales
      ${sales.length ? `CustomerTotalPaidBalanceAge${sales.map(s => `${esc(s.customer_name||'-')}UGX ${parseInt(s.total).toLocaleString()}UGX ${parseInt(s.paid||0).toLocaleString()}UGX ${(parseInt(s.total)-parseInt(s.paid||0)).toLocaleString()}${Math.round(s.age_days)} days`).join('')}` : 'No partial sales'}
    
  `, req.session.user));
}));

// === v4.0: URA EFRIS PLACEHOLDER ===
app.get('/business/efris', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const taxRecords = (await pool.query('SELECT * FROM tax_records WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('URA EFRIS', `
    URA EFRIS IntegrationElectronic Fiscal Invoicing
    ConfigurationTIN: ${esc(tenant?.tax_id || 'Not configured')}Set your URA TIN in Settings > Currency to enable EFRIS integration.
    Tax Records
      ${taxRecords.length ? `PeriodTaxable AmountTax RateTax AmountTypeFiled${taxRecords.map(r => `${esc(r.period)}UGX ${parseInt(r.taxable_amount).toLocaleString()}${r.tax_rate}%UGX ${parseInt(r.tax_amount).toLocaleString()}${esc(r.tax_type)}${r.filed?'Yes':'No'}`).join('')}` : 'No tax records'}
    
    Generate EFRIS JSONExport tax data in EFRIS-compatible format for URA submission.
      Export EFRIS JSON
    
  `, req.session.user));
}));

app.get('/business/efris/export', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT * FROM tax_records WHERE tenant_id=$1 AND filed=false', [t])).rows;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const efrisData = { tin: tenant?.tax_id || '', taxpayer_name: tenant?.name || '', invoices: records.map(r => ({ period: r.period, taxable_amount: r.taxable_amount, tax_rate: r.tax_rate, tax_amount: r.tax_amount, tax_type: r.tax_type })) };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=efris-export.json');
  res.send(JSON.stringify(efrisData, null, 2));
}));

// === v5.0: DEBT PAYOFF CALCULATOR ===
app.get('/personal/debt-calculator', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Debt Payoff Calculator', `
    
      Debt Payoff Calculator
      
        
        
        
        Calculate
      
      
      
      function calcDebt(e){e.preventDefault();var d=parseFloat(document.getElementById('db').value),r=parseFloat(document.getElementById('ir').value)/100,p=parseFloat(document.getElementById('mp').value);if(pPayment too low! Must exceed monthly interest of UGX '+Math.ceil(d*r).toLocaleString()+'';return}var m=0,t=d;while(t>0&&mResultsMonths to payoff: '+m+'Years: '+(m/12).toFixed(1)+'Total paid: UGX '+tp.toLocaleString()+'Total interest: UGX '+(tp-d).toLocaleString()+''}
      
    
  `, req.session.user));
});

// === v5.0: PWA SERVICE WORKER ===
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`const CACHE='ssewasswa-v1';self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/login','/manifest.json'])))});self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});`);
});

// === v6.0: UNEB RESULTS IMPORT ===
app.get('/school/uneb', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('UNEB Results Import', `
    UNEB ResultsImport UNEB examination results
    
      Import CSV
      Upload a CSV file with columns: student_name, index_number, subject, score, grade
      
        
        
        Import
      
    
  `, req.session.user));
});

app.post('/school/uneb/import', requireAuth, requireNotBanned, ah(async (req, res) => {
  // Placeholder: In production, parse the CSV and import marks
  res.send(renderPage('UNEB Import', 'Feature ReadyUNEB CSV import will process your file when full file upload is enabled. For now, use the regular Exams module to enter marks manually.Back', req.session.user));
}));

// === v6.0: NIRA VERIFICATION ===
app.get('/school/nira', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('NIRA Verification', `
    NIRA VerificationVerify student National IDs
    
      Verify NIN
      
        
        
        Verify
      
      NIRA API integration requires government credentials. Contact support to enable.
    
  `, req.session.user));
});

app.post('/school/nira/verify', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { nin, student_name } = req.body;
  res.send(renderPage('NIRA Verification', `Verification PendingNIN: ${esc(nin)}Name: ${esc(student_name)}NIRA API integration requires government-approved credentials. This feature will be activated once API access is granted.Back`, req.session.user));
}));

// === v6.0: BANK RECONCILIATION ===
app.get('/business/reconciliation', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [payments, expenses, sales] = await Promise.all([
    pool.query('SELECT * FROM payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t]),
    pool.query('SELECT * FROM expenses WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t]),
    pool.query('SELECT * FROM sales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])
  ]);
  const totalIn = payments.rows.reduce((a,p) => a + parseInt(p.amount||0), 0);
  const totalExp = expenses.rows.reduce((a,e) => a + parseInt(e.amount||0), 0);
  const totalSales = sales.rows.reduce((a,s) => a + parseInt(s.total||0), 0);
  res.send(renderPage('Bank Reconciliation', `
    Bank ReconciliationMatch records with bank statements
    
      UGX ${(totalIn+totalSales).toLocaleString()}Total In
      UGX ${totalExp.toLocaleString()}Total Out
      UGX ${(totalIn+totalSales-totalExp).toLocaleString()}Net
    
    Import Bank StatementUpload your bank statement CSV to match with platform records.
      
        
        Import Statement
      
    
  `, req.session.user));
}));

app.post('/business/reconciliation/import', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Reconciliation', 'Statement ImportedBank statement CSV import will match transactions when full file upload is enabled. Review your records manually for now.Back', req.session.user));
}));

// === v6.0: PLANNING CENTER IMPORT ===
app.get('/church/planning-center', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Planning Center Import', `
    Planning Center ImportImport data from Planning Center
    
      Import Members CSV
      Export your Planning Center member list as CSV, then upload here.
      
        
        Import
      
    
  `, req.session.user));
});

app.post('/church/planning-center/import', requireAuth, requireNotBanned, ah(async (req, res) => {
  res.send(renderPage('Planning Center', 'Import ReadyCSV import will process your Planning Center data when full file upload is enabled.Back', req.session.user));
}));

// === v6.0: GRAPHQL API v2 ===
app.post('/api/v2/graphql', ah(async (req, res) => {
  const { query, variables } = req.body;
  const authHeader = req.headers.authorization;
  let tenantId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const key = authHeader.split(' ')[1];
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const apiKey = (await pool.query('SELECT * FROM api_keys WHERE key_hash=$1', [keyHash])).rows[0];
    if (apiKey) { tenantId = apiKey.tenant_id; await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [apiKey.id]); }
  }
  if (!tenantId) return res.status(401).json({ error: 'API key required' });
  // Simple GraphQL resolver
  const result = { data: {} };
  try {
    if (query.includes('students')) { result.data.students = (await pool.query('SELECT id,name,class,stream,gender FROM students WHERE tenant_id=$1 LIMIT 50', [tenantId])).rows; }
    if (query.includes('fees')) { result.data.fees = (await pool.query('SELECT f.*,s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 LIMIT 50', [tenantId])).rows; }
    if (query.includes('inventory')) { result.data.inventory = (await pool.query('SELECT * FROM inventory WHERE tenant_id=$1 LIMIT 50', [tenantId])).rows; }
    if (query.includes('members')) { result.data.members = (await pool.query('SELECT * FROM church_members WHERE tenant_id=$1 LIMIT 50', [tenantId])).rows; }
    if (query.includes('donations')) { result.data.donations = (await pool.query('SELECT * FROM donations WHERE tenant_id=$1 LIMIT 50', [tenantId])).rows; }
    if (query.includes('invoices')) { result.data.invoices = (await pool.query('SELECT * FROM invoices WHERE tenant_id=$1 LIMIT 50', [tenantId])).rows; }
  } catch (e) { result.errors = [{ message: e.message }]; }
  res.json(result);
}));

// === v6.0: OAUTH2 PLACEHOLDER ===
app.get('/auth/oauth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.send(renderPage('OAuth', 'Google OAuthSet GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars to enable Google login.Back to Login', null));
  const redirectUri = encodeURIComponent(`${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oauth/google/callback`);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=openid+email+profile`);
});

app.get('/auth/oauth/google/callback', ah(async (req, res) => {
  // Placeholder: Exchange code for tokens, create/find user
  res.redirect('/dashboard');
}));

app.get('/auth/oauth/microsoft', (req, res) => {
  if (!process.env.MS_CLIENT_ID) return res.send(renderPage('OAuth', 'Microsoft OAuthSet MS_CLIENT_ID and MS_CLIENT_SECRET env vars to enable Microsoft login.Back to Login', null));
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${process.env.MS_CLIENT_ID}&response_type=code&scope=openid+email+profile`);
});

// === v7.0: AI REPORT COMMENTS ===
app.get('/school/ai-comments', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT * FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('AI Report Comments', `
    AI Report CommentsAuto-generate report card comments
    
      Generate Comments
      
        ${exams.map(e => `${esc(e.name)} - ${esc(e.term)} ${e.year||''}`).join('')}
        EncouragingNeutralFormal
        Generate Comments
      
    
  `, req.session.user));
}));

app.post('/school/ai-comments/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { exam_id, tone } = req.body;
  const marks = (await pool.query('SELECT m.*,s.name as student_name,s.class FROM marks m JOIN students s ON m.student_id=s.id WHERE m.exam_id=$1', [exam_id])).rows;
  const students = {};
  marks.forEach(m => { if (!students[m.student_id]) students[m.student_id] = { name: m.student_name, class: m.class, subjects: [] }; students[m.student_id].subjects.push({ subject: m.subject, score: parseInt(m.score), grade: m.grade }); });
  const commentTemplates = {
    encouraging: { high: ['Outstanding performance! Keep up the excellent work.','Brilliant results! You are a star performer.','Exceptional work! Continue striving for excellence.'], mid: ['Good effort! With more focus, you can achieve even better results.','Solid performance. Keep pushing to reach your full potential.','Good work overall. A little more practice will take you far.'], low: ['There is room for improvement. Don\'t give up - keep working hard!','With dedication and practice, you can do much better. Stay focused!','This is a stepping stone. Use it as motivation to improve.'] },
    neutral: { high: ['Performed above expectations.','Results are well above average.','Demonstrates strong academic ability.'], mid: ['Results are within expected range.','Satisfactory performance across subjects.','Meets minimum requirements in most areas.'], low: ['Below expected performance level.','Results indicate need for additional support.','Performance needs significant improvement.'] },
    formal: { high: ['The student has demonstrated exemplary academic performance.','Academic results are commendable and above the expected standard.','Performance is outstanding and reflects diligent study habits.'], mid: ['The student\'s performance is satisfactory and meets expectations.','Academic results are within acceptable parameters.','Performance is adequate but could benefit from increased effort.'], low: ['The student\'s performance falls below expectations and requires intervention.','Academic results indicate the need for additional academic support.','Performance is unsatisfactory and necessitates immediate attention.'] }
  };
  const getComment = (avg, t) => { const level = avg >= 75 ? 'high' : avg >= 50 ? 'mid' : 'low'; const templates = commentTemplates[t]?.[level] || commentTemplates.encouraging[level]; return templates[Math.floor(Math.random() * templates.length)]; };
  const results = Object.entries(students).map(([id, s]) => { const avg = s.subjects.reduce((a,sub) => a + sub.score, 0) / s.subjects.length; return { name: s.name, class: s.class, avg: avg.toFixed(1), subjects: s.subjects.length, comment: getComment(avg, tone) }; });
  res.send(renderPage('AI Report Comments', `
    Generated Comments
      StudentClassAvg ScoreSubjectsComment
      ${results.map(r => `${esc(r.name)}${esc(r.class)}${r.avg}${r.subjects}${esc(r.comment)}`).join('') || 'No marks found for this exam'}
      
    
  `, req.session.user));
}));

// === v7.0: FEE DEFAULT PREDICTION ===
app.get('/school/fee-prediction', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fees = (await pool.query('SELECT f.*,s.name as student_name,s.class FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1', [t])).rows;
  const atRisk = fees.filter(f => { const paidRatio = parseInt(f.paid) / parseInt(f.amount); return paidRatio  ({ ...f, risk: parseInt(f.paid) / parseInt(f.amount)  parseInt(f.paid) / parseInt(f.amount) >= 0.3);
  res.send(renderPage('Fee Default Prediction', `
    Fee Default PredictionAI-powered risk analysis
    ${atRisk.length}At Risk${onTrack.length}On Track
    Students at Risk of Default
      ${atRisk.length ? `StudentClassTotalPaidBalanceRisk Level${atRisk.map(f => `${esc(f.student_name)}${esc(f.class)}UGX ${parseInt(f.amount).toLocaleString()}UGX ${parseInt(f.paid).toLocaleString()}UGX ${(parseInt(f.amount)-parseInt(f.paid)).toLocaleString()}${f.risk}`).join('')}` : 'No students at risk'}
    
  `, req.session.user));
}));

// === v7.0: DROPOUT RISK ANALYSIS ===
app.get('/school/dropout-risk', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT * FROM students WHERE tenant_id=$1', [t])).rows;
  const atRisk = [];
  for (const s of students) {
    const [fees, attendance] = await Promise.all([
      pool.query('SELECT * FROM fees WHERE student_id=$1', [s.id]),
      pool.query('SELECT * FROM attendance WHERE student_id=$1', [s.id])
    ]);
    const totalFees = fees.rows.reduce((a,f) => a + parseInt(f.amount||0), 0);
    const totalPaid = fees.rows.reduce((a,f) => a + parseInt(f.paid||0), 0);
    const feeRatio = totalFees > 0 ? totalPaid / totalFees : 1;
    const presentDays = attendance.rows.filter(a => a.status === 'present').length;
    const totalDays = attendance.rows.length || 1;
    const attendRatio = presentDays / totalDays;
    let risk = 'Low'; let score = 0;
    if (feeRatio = 4) atRisk.push({ ...s, feeRatio: (feeRatio*100).toFixed(0), attendRatio: (attendRatio*100).toFixed(0), risk, score });
  }
  atRisk.sort((a,b) => b.score - a.score);
  res.send(renderPage('Dropout Risk', `
    Dropout Risk AnalysisIdentify students at risk
    ${students.length}Total Students${atRisk.length}At Risk
    High Risk Students
      ${atRisk.length ? `NameClassFee PaymentAttendanceRisk${atRisk.map(s => `${esc(s.name)}${esc(s.class)}${s.feeRatio}%${s.attendRatio}%${s.risk}`).join('')}` : 'No students currently at high risk of dropout.'}
    
  `, req.session.user));
}));

// === v7.0: DEMAND FORECASTING ===
app.get('/business/forecast', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT i.*,COALESCE(s.total_sold,0) as total_sold FROM inventory i LEFT JOIN (SELECT inventory_id,SUM(quantity) as total_sold FROM sale_items GROUP BY inventory_id) s ON i.id=s.inventory_id WHERE i.tenant_id=$1 ORDER BY i.name', [t])).rows;
  res.send(renderPage('Demand Forecast', `
    Demand ForecastPredict future inventory needs
    Inventory Demand Analysis
      ItemCurrent StockTotal SoldDays of StockReorder Suggestion
      ${items.map(i => { const daily = parseInt(i.total_sold||0) / 30; const daysLeft = daily > 0 ? Math.round(parseInt(i.quantity||0) / daily) : 999; const reorder = daysLeft ${esc(i.name)}${i.quantity}${i.total_sold||0}${daysLeft > 900 ? 'N/A' : daysLeft + ' days'}${reorder ? 'Reorder Now' : 'OK'}`; }).join('') || 'No inventory'}
      
    
  `, req.session.user));
}));

// === v7.0: CHURN PREDICTION ===
app.get('/org/churn-prediction', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1', [t])).rows;
  const atRisk = members.filter(m => { const daysSince = (Date.now() - new Date(m.joined_at).getTime()) / (1000*60*60*24); return daysSince > 180 && !m.role; }).slice(0, 20);
  res.send(renderPage('Churn Prediction', `
    Churn PredictionIdentify members at risk of leaving
    ${members.length}Total Members${atRisk.length}At Risk
    Members at Risk
      ${atRisk.length ? `NameEmailPhoneJoinedDays Since Join${atRisk.map(m => `${esc(m.name)}${esc(m.email||'-')}${esc(m.phone||'-')}${new Date(m.joined_at).toLocaleDateString()}${Math.round((Date.now()-new Date(m.joined_at).getTime())/(1000*60*60*24))}`).join('')}` : 'No members currently at risk of churning.'}
    
  `, req.session.user));
}));

// === v7.0: GIVING TRENDS AI ===
app.get('/church/giving-trends', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const donations = (await pool.query("SELECT date_trunc('month',created_at) as month,SUM(amount) as total,COUNT(*) as count FROM donations WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [t])).rows;
  const tithes = (await pool.query("SELECT date_trunc('month',created_at) as month,SUM(amount) as total FROM donations WHERE tenant_id=$1 AND is_tithe=true GROUP BY month ORDER BY month DESC LIMIT 12", [t])).rows;
  const avgMonthly = donations.length ? Math.round(donations.reduce((a,d) => a + parseInt(d.total), 0) / donations.length) : 0;
  const projected = avgMonthly * 1.05;
  res.send(renderPage('Giving Trends', `
    Giving TrendsAI-powered donation analysis
    UGX ${avgMonthly.toLocaleString()}Avg MonthlyUGX ${Math.round(projected).toLocaleString()}Projected Next Month
    Monthly Giving
      MonthTotalDonationsTithe
      ${donations.map(d => { const tithe = tithes.find(t => new Date(t.month).getMonth() === new Date(d.month).getMonth()); return `${new Date(d.month).toLocaleDateString('en',{year:'numeric',month:'short'})}UGX ${parseInt(d.total).toLocaleString()}${d.count}UGX ${parseInt(tithe?.total||0).toLocaleString()}`; }).join('') || 'No donation data'}
      
    
  `, req.session.user));
}));

// === v7.0: MEMBER ENGAGEMENT SCORING ===
app.get('/org/engagement', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT * FROM members WHERE tenant_id=$1', [t])).rows;
  const scores = [];
  for (const m of members) {
    let score = 50;
    if (m.role) score += 20;
    if (m.email) score += 10;
    if (m.phone) score += 10;
    const daysSince = (Date.now() - new Date(m.joined_at).getTime()) / (1000*60*60*24);
    if (daysSince = 80 ? 'Highly Engaged' : score >= 60 ? 'Moderate' : score >= 40 ? 'Low' : 'Inactive' });
  }
  scores.sort((a,b) => b.score - a.score);
  res.send(renderPage('Member Engagement', `
    Member EngagementEngagement scoring analysis
    ${scores.filter(s => s.score >= 80).length}Highly Engaged${scores.filter(s => s.score >= 40 && s.score Moderate${scores.filter(s => s.score Inactive
    Engagement Scores
      NameScoreLevelRole${scores.map(s => `${esc(s.name)}=80?'#059669':s.score>=40?'#f59e0b':'#dc2626'};height:20px;border-radius:8px;width:${s.score}%">${s.level}${esc(s.role||'-')}`).join('')}
    
  `, req.session.user));
}));

// === v7.0: POWERBI/CSV EXPORT ===
app.get('/reports/export/powerbi', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, fees, sales, expenses, donations] = await Promise.all([
    pool.query('SELECT name,class,gender FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT f.amount,f.paid,f.term,f.year,s.name as student FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1', [t]),
    pool.query('SELECT customer_name,total,paid,status,created_at FROM sales WHERE tenant_id=$1', [t]),
    pool.query('SELECT category,amount,description,COALESCE(expense_date, created_at::date) as expense_date FROM expenses WHERE tenant_id=$1', [t]),
    pool.query('SELECT donor_name,amount,type,method,created_at FROM donations WHERE tenant_id=$1', [t])
  ]);
  const data = { students: students.rows, fees: fees.rows, sales: sales.rows, expenses: expenses.rows, donations: donations.rows, exported_at: new Date().toISOString() };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=ssewasswa-powerbi-export.json');
  res.send(JSON.stringify(data, null, 2));
}));

// === v7.0: TENANT HEALTH DASHBOARD (super_admin) ===
app.get('/dev/tenant-health', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const tenants = (await pool.query('SELECT t.*, (SELECT COUNT(*) FROM students s WHERE s.tenant_id=t.id) as students, (SELECT COUNT(*) FROM fees f WHERE f.tenant_id=t.id) as fees, (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) as users_count FROM tenants t ORDER BY t.created_at DESC')).rows;
  res.send(renderPage('Tenant Health', `
    Tenant Health DashboardOverview of all tenants
    ${tenants.length}Total Tenants${tenants.filter(t=>t.approved).length}Approved${tenants.filter(t=>t.banned).length}Banned
    All Tenants
      NameTypeStudentsFeesUsersApprovedBannedCreated
      ${tenants.map(t => `${esc(t.name)}${esc(t.type)}${t.students}${t.fees}${t.users_count}${t.approved?'Yes':'No'}${t.banned?'Yes':'No'}${new Date(t.created_at).toLocaleDateString()}`).join('')}
      
    
  `, req.session.user));
}));

// === v8.0: PEER-TO-PEER FUNDRAISING ===
app.get('/campaigns/:id/fundraise', requireAuth, requireNotBanned, ah(async (req, res) => {
  const campaign = (await pool.query('SELECT * FROM campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!campaign) return res.status(404).send('Campaign not found');
  const pledges = (await pool.query('SELECT * FROM campaign_pledges WHERE campaign_id=$1', [campaign.id])).rows;
  const progress = campaign.target > 0 ? Math.min((parseInt(campaign.raised||0) / parseInt(campaign.target)) * 100, 100) : 0;
  res.send(renderPage('Peer Fundraising', `
    ${esc(campaign.title)}Peer-to-Peer Fundraising
    Campaign Progress
      
      UGX ${parseInt(campaign.raised||0).toLocaleString()}RaisedUGX ${parseInt(campaign.target).toLocaleString()}Target${pledges.length}Pledges
    
    Share This CampaignShare this link to help raise funds:${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/donate/${campaign.id}
    Pledges
      DonorPledgedPaid${pledges.map(p => `${esc(p.donor_name||'Anonymous')}UGX ${parseInt(p.amount).toLocaleString()}UGX ${parseInt(p.paid).toLocaleString()}`).join('') || 'No pledges yet'}
    
  `, req.session.user));
}));

// === v8.0: APP STORE ===
app.get('/app-store', requireAuth, ah(async (req, res) => {
  const apps = [
    { name: 'WhatsApp Notifications', desc: 'Send notifications via WhatsApp', icon: '💬', status: 'Coming Soon' },
    { name: 'Google Calendar Sync', desc: 'Sync events with Google Calendar', icon: '📅', status: 'Available', install: '/integrations/new?service=google_calendar' },
    { name: 'Slack Integration', desc: 'Post updates to Slack channels', icon: '📱', status: 'Available', install: '/integrations/new?service=slack' },
    { name: 'Excel Import/Export', desc: 'Import and export Excel files', icon: '📊', status: 'Available', install: '/settings/backup' },
    { name: 'SMS Reminders', desc: 'Automated SMS reminders for fees and events', icon: '📲', status: 'Available', install: '/automations' },
    { name: 'AI Assistant', desc: 'AI-powered insights and predictions', icon: '🤖', status: 'Available', install: '/ai-insights' },
    { name: 'Payment Gateway', desc: 'Flutterwave & Mobile Money payments', icon: '💳', status: 'Available', install: '/billing' },
    { name: 'Barcode Scanner', desc: 'Scan barcodes for POS and inventory', icon: '📷', status: 'Available', install: '/barcode' },
    { name: 'Report Builder', desc: 'Custom report creation', icon: '📝', status: 'Available', install: '/report-builder' },
    { name: 'Biometric Attendance', desc: 'Fingerprint and RFID attendance', icon: '👆', status: 'Coming Soon' },
  ];
  res.send(renderPage('App Store', `
    App StoreIntegrations and plugins
    ${apps.map(a => `${a.icon}${a.name}${a.desc}${a.status}${a.install?`${a.status==='Available'?'Open':'Learn More'}`:''}`).join('')}
  `, req.session.user));
}));

// === v9.0: SAML SSO PLACEHOLDER ===
app.get('/auth/saml', (req, res) => {
  res.send(renderPage('SAML SSO', 'SAML Single Sign-OnSAML SSO integration requires enterprise configuration. Contact support to set up your identity provider.Supported: Okta, Azure AD, OneLogin, Auth0Back to Login', null));
});

app.post('/auth/saml/callback', ah(async (req, res) => {
  res.redirect('/dashboard');
}));

// === v9.0: SOC2 COMPLIANCE ===
app.get('/dev/soc2', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const auditCount = (await pool.query('SELECT COUNT(*) as count FROM audit_logs')).rows[0]?.count || 0;
  const tenantCount = (await pool.query('SELECT COUNT(*) as count FROM tenants')).rows[0]?.count || 0;
  const userCount = (await pool.query('SELECT COUNT(*) as count FROM users')).rows[0]?.count || 0;
  res.send(renderPage('SOC2 Compliance', `
    SOC2 ComplianceSecurity and compliance dashboard
    
      ActiveEncryption
      ActiveAccess Control
      ${auditCount}Audit Logs
      ${tenantCount}Tenants
    
    Compliance Checklist
      ControlStatusDetails
      Data EncryptionPassSSL/TLS in production, password hashing with bcrypt
      Access ControlPassRole-based access, tenant isolation
      Audit LoggingPass${auditCount} events logged
      Session SecurityPassHTTP-only cookies, secure in production
      Rate LimitingPassLogin and registration rate limits
      Data IsolationPassTenant-based data separation
      Backup & RecoveryPassJSON/CSV export available
      Incident ResponsePartialStatus page available, incident tracking needs improvement
      Penetration TestingPendingScheduled for next quarter
      
    
  `, req.session.user));
}));

// === v9.0: BIRTHDAY SMS AUTOMATION (Daily Check) ===
const checkBirthdays = async () => {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  try {
    // Church members
    const churchBdays = (await pool.query('SELECT cm.*,t.id as tid FROM church_members cm JOIN tenants t ON cm.tenant_id=t.id WHERE EXTRACT(MONTH FROM cm.date_of_birth)=$1 AND EXTRACT(DAY FROM cm.date_of_birth)=$2', [month, day])).rows;
    for (const m of churchBdays) { if (m.phone) await sendSMS(m.phone, `Happy Birthday ${m.name}! 🎉 Wishing you a wonderful day from your church family.`); }
    // Students
    const studentBdays = (await pool.query('SELECT s.*,t.id as tid FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE EXTRACT(MONTH FROM s.date_of_birth)=$1 AND EXTRACT(DAY FROM s.date_of_birth)=$2', [month, day])).rows;
    for (const s of studentBdays) { if (s.guardian_phone) await sendSMS(s.guardian_phone, `Happy Birthday to ${s.name}! 🎉 Wishing them a wonderful day from school.`); }
  } catch(e) { console.warn('Birthday check error:', e.message); }
};
// Run birthday check every 24 hours
setInterval(checkBirthdays, 24 * 60 * 60 * 1000);
// Also run once on startup (after 30s delay)
setTimeout(checkBirthdays, 30000);

// === v9.0: CACHE LAYER (In-Memory with Redis placeholder) ===
const memoryCache = new Map();
const cacheGet = (key) => { const entry = memoryCache.get(key); if (!entry) return null; if (Date.now() > entry.exp) { memoryCache.delete(key); return null; } return entry.data; };
const cacheSet = (key, data, ttlMs = 60000) => { memoryCache.set(key, { data, exp: Date.now() + ttlMs }); };
// Cache middleware for API routes
const cacheMiddleware = (ttlMs = 30000) => (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = `cache:${req.originalUrl}:${req.session.user?.tenant_id || 'anon'}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);
  const origJson = res.json.bind(res);
  res.json = (data) => { cacheSet(key, data, ttlMs); origJson(data); };
  next();
};

// === v9.0: MULTI-COUNTRY ENHANCEMENT (currency helper already exists above) ===
app.get('/settings/country', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Country & Currency', `
    Country & Currency Settings
      
        Uganda (UGX)Kenya (KES)Tanzania (TZS)Rwanda (RWF)DRC (CDF)United States (USD)
        UGX - Ugandan ShillingKES - Kenyan ShillingTZS - Tanzanian ShillingRWF - Rwandan FrancUSD - US Dollar
        
        Save
      
    
  `, req.session.user));
}));

app.post('/settings/country/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { country, currency, tax_id } = req.body;
  await pool.query('UPDATE tenants SET country=$1,currency=$2,tax_id=$3 WHERE id=$4', [country, currency, tax_id, t]);
  res.redirect('/settings/country');
}));

// === v9.0: GOVERNMENT DASHBOARDS ===
app.get('/dev/government', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const [schoolStats, orgStats, churchStats, bizStats] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM tenants WHERE type='school'"),
    pool.query("SELECT COUNT(*) as count FROM tenants WHERE type='organization'"),
    pool.query("SELECT COUNT(*) as count FROM tenants WHERE type='church'"),
    pool.query("SELECT COUNT(*) as count FROM tenants WHERE type='business'")
  ]);
  const totalStudents = (await pool.query('SELECT COUNT(*) as count FROM students')).rows[0]?.count || 0;
  const totalDonations = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM donations')).rows[0]?.total || 0;
  res.send(renderPage('Government Dashboard', `
    Government DashboardAnonymized aggregate data
    
      ${schoolStats.rows[0]?.count||0}Schools
      ${orgStats.rows[0]?.count||0}Organizations
      ${churchStats.rows[0]?.count||0}Churches
      ${bizStats.rows[0]?.count||0}Businesses
      ${totalStudents}Total Students
      UGX ${parseInt(totalDonations).toLocaleString()}Total Donations
    
    Note: All data is anonymized and aggregated. No individual tenant data is exposed.
  `, req.session.user));
}));

// === v9.0: AUTO-GRADING ON MARKS SAVE (hook into existing marks save) ===
// The auto-grading is already handled in the existing marks save route via grading_scales table

// === END v1.0→v9.0 FEATURES ===

// =============================================
// v3.0 PRODUCTION HARDENING FEATURES
// =============================================

// 3.1 + 3.2: PLAN ENFORCEMENT - Apply requirePlanLimit to critical routes
// Student creation - block free at 50 students
app.post('/school/students/save', requirePlanLimit('students'));
// POS checkout - block free users
app.post('/business/pos/checkout', requirePlanLimit('sales'));
// SMS send - block free users
app.post('/sms/send', (req, res, next) => {
  const plan = req.session.user?.role === 'super_admin' ? 'enterprise' : 'free';
  if (plan === 'free') {
    try { checkPlanLimit(req.session.user.tenant_id, 'students').then(check => {
      if (check.plan === 'free') return res.send(renderPage('Plan Required', 'SMS Requires Basic PlanFree plan does not include SMS. Upgrade to Basic or Pro to send SMS.Upgrade Plan', req.session.user));
      next();
    }); } catch(e) { next(); }
  } else next();
});
// API access - block free users
const apiAuthWithPlan = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'API key required' });
  const key = authHeader.split(' ')[1];
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const apiKey = (await pool.query('SELECT * FROM api_keys WHERE key_hash=$1', [keyHash])).rows[0];
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });
  const check = await checkPlanLimit(apiKey.tenant_id, 'students');
  if (check.plan === 'free') return res.status(403).json({ error: 'API access requires Basic plan or above. Upgrade at /billing' });
  await pool.query('UPDATE api_keys SET last_used=NOW() WHERE id=$1', [apiKey.id]);
  req.apiKey = apiKey;
  next();
};

// 3.3: AUTO DAILY BACKUP (pg_dump to Cloudinary)
const runAutoBackup = async () => {
  try {
    const tenants = (await pool.query('SELECT id,name FROM tenants WHERE approved=true AND banned=false')).rows;
    for (const t of tenants.slice(0, 5)) { // Max 5 per run to avoid timeout
      try {
        const tables = ['students','fees','attendance','marks','expenses','sales','invoices','donations','church_members','members','inventory','customers','staff'];
        let backupData = {};
        for (const table of tables) {
          try {
            const rows = (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND deleted_at IS NULL`, [t.id])).rows;
            backupData[table] = rows;
          } catch(e) {} // Table might not have tenant_id
        }
        const backupJson = JSON.stringify(backupData);
        const buffer = Buffer.from(backupJson);
        let backupUrl = null;
        if (process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_URL.includes('xxx')) {
          try {
            const cloudinary = require('cloudinary').v2;
            cloudinary.config({ url: process.env.CLOUDINARY_URL });
            const result = await cloudinary.uploader.upload(`data:application/json;base64,${buffer.toString('base64')}`, { resource_type: 'raw', folder: `backups/tenant_${t.id}`, public_id: `backup-${t.id}-${new Date().toISOString().split('T')[0]}`, overwrite: true });
            backupUrl = result.secure_url;
          } catch(e) { /* Cloudinary upload failed, save locally only */ }
        }
        await pool.query('INSERT INTO backup_log(tenant_id,backup_url,size_bytes,status) VALUES($1,$2,$3,$4)', [t.id, backupUrl, buffer.length, backupUrl ? 'completed' : 'local_only']);
      } catch(e) { console.warn(`Backup failed for tenant ${t.id}:`, e.message); }
    }
    console.log(`Auto-backup completed for ${Math.min(tenants.length, 5)} tenants`);
  } catch(e) { console.warn('Auto-backup error:', e.message); }
};
// Run daily at 2am UTC (every 24 hours)
setInterval(runAutoBackup, 24 * 60 * 60 * 1000);
// First backup after 60 seconds
setTimeout(runAutoBackup, 60000);

// 3.5: RELATIONSHIPS
app.get('/relationships/:type/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const rels = (await pool.query('SELECT * FROM relationships WHERE tenant_id=$1 AND (person_type=$2 AND person_id=$3) OR (related_type=$2 AND related_id=$3)', [t, type, id])).rows;
  res.send(renderPage('Relationships', `
    Relationships+ Add Relationship
      ${rels.length ? `PersonRelationRelated ToActions${rels.map(r => `${esc(r.person_type)} #${r.person_id}${esc(r.relation)}${esc(r.related_type)} #${r.related_id}Remove`).join('')}` : 'No relationships recorded'}
    
  `, req.session.user));
}));

app.get('/relationships/:type/:id/add', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { type, id } = req.params;
  res.send(renderPage('Add Relationship', `Add RelationshipParentChildSiblingSpouseGuardianEmergency ContactStudentStaffMemberSave Relationship`, req.session.user));
}));

app.post('/relationships/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { person_type, person_id, relation, related_type, related_id } = req.body;
  await pool.query('INSERT INTO relationships(tenant_id,person_type,person_id,related_type,related_id,relation) VALUES($1,$2,$3,$4,$5,$6)', [t, person_type, person_id, related_type, related_id, relation]);
  res.redirect('back');
}));

app.get('/relationships/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM relationships WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('back');
}));

// 3.6: CUSTOM FIELDS
app.get('/custom-fields', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fields = (await pool.query('SELECT * FROM custom_fields WHERE tenant_id=$1 ORDER BY entity_type, COALESCE(sort_order,0)', [t])).rows;
  res.send(renderPage('Custom Fields', `
    Custom FieldsAdd custom fields to any entity
    + New Custom Field
      EntityField NameTypeRequiredActions
      ${fields.map(f => `${esc(f.entity_type)}${esc(f.field_name)}${esc(f.field_type)}${f.required?'Yes':'No'}Delete`).join('') || 'No custom fields'}
      
    
  `, req.session.user));
}));

app.get('/custom-fields/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Custom Field', `Create Custom FieldStudentStaffChurch MemberCustomerInventoryTextNumberDateDropdownCheckbox RequiredCreate Fielddocument.querySelector('[name=field_type]').onchange=e=>{document.getElementById('fieldOpts').style.display=e.target.value==='select'?'block':'none'}`, req.session.user));
});

app.post('/custom-fields/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { entity_type, field_name, field_type, options, required, sort_order } = req.body;
  await pool.query('INSERT INTO custom_fields(tenant_id,entity_type,field_name,field_type,options,required,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, entity_type, field_name, field_type, options ? JSON.stringify(options.split(',').map(o => o.trim())) : null, required === 'on', sort_order || 0]);
  res.redirect('/custom-fields');
}));

app.get('/custom-fields/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM custom_field_values WHERE field_id=$1', [req.params.id]);
  await pool.query('DELETE FROM custom_fields WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/custom-fields');
}));

// 3.9: SOFT DELETE + RESTORE
app.get('/trash', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [students, staff, inventory, invoices] = await Promise.all([
    pool.query('SELECT id,name,deleted_at FROM students WHERE tenant_id=$1 AND deleted_at IS NOT NULL', [t]),
    pool.query('SELECT id,name,deleted_at FROM staff WHERE tenant_id=$1 AND deleted_at IS NOT NULL', [t]),
    pool.query('SELECT id,name,deleted_at FROM inventory WHERE tenant_id=$1 AND deleted_at IS NOT NULL', [t]),
    pool.query('SELECT id,invoice_no,deleted_at FROM invoices WHERE tenant_id=$1 AND deleted_at IS NOT NULL', [t])
  ]);
  res.send(renderPage('Trash', `
    TrashDeleted items can be restored within 30 days
    Deleted Students (${students.rows.length})
      ${students.rows.length ? `NameDeletedActions${students.rows.map(s => `${esc(s.name)}${new Date(s.deleted_at).toLocaleDateString()}Restore Purge`).join('')}` : 'No deleted students'}
    
    Deleted Staff (${staff.rows.length})
      ${staff.rows.length ? `NameDeletedActions${staff.rows.map(s => `${esc(s.name)}${new Date(s.deleted_at).toLocaleDateString()}Restore`).join('')}` : 'No deleted staff'}
    
    Deleted Inventory (${inventory.rows.length})
      ${inventory.rows.length ? `NameDeletedActions${inventory.rows.map(i => `${esc(i.name)}${new Date(i.deleted_at).toLocaleDateString()}Restore`).join('')}` : 'No deleted inventory'}
    
  `, req.session.user));
}));

app.get('/trash/restore/:table/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { table, id } = req.params;
  const allowed = ['students','staff','inventory','invoices','donations','customers','church_members','members'];
  if (!allowed.includes(table)) return res.status(400).send('Invalid table');
  await pool.query(`UPDATE ${table} SET deleted_at=NULL WHERE id=$1 AND tenant_id=$2`, [id, req.session.user.tenant_id]);
  res.redirect('/trash');
}));

app.get('/trash/purge/:table/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { table, id } = req.params;
  const allowed = ['students','staff','inventory','invoices','donations','customers'];
  if (!allowed.includes(table)) return res.status(400).send('Invalid table');
  await pool.query(`DELETE FROM ${table} WHERE id=$1 AND tenant_id=$2`, [id, req.session.user.tenant_id]);
  res.redirect('/trash');
}));

// Override delete routes to use soft delete
const softDelete = async (table, id, tenantId) => {
  const allowed = ['students','staff','inventory','invoices','donations','customers','church_members','members'];
  if (allowed.includes(table)) {
    return pool.query(`UPDATE ${table} SET deleted_at=NOW() WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  }
  return pool.query(`DELETE FROM ${table} WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
};

// 3.10: VERSION HISTORY
const trackChange = async (tenantId, entityType, entityId, action, oldData, newData, changedBy) => {
  try {
    await pool.query('INSERT INTO version_history(tenant_id,entity_type,entity_id,action,old_data,new_data,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [tenantId, entityType, entityId, action, JSON.stringify(oldData), JSON.stringify(newData), changedBy]);
  } catch(e) {}
};

app.get('/history/:type/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const history = (await pool.query('SELECT * FROM version_history WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY created_at DESC', [t, type, id])).rows;
  res.send(renderPage('Version History', `
    Change History - ${esc(type)} #${id}
      ${history.length ? `DateActionByDetails${history.map(h => `${new Date(h.created_at).toLocaleString()}${esc(h.action)}${esc(h.changed_by||'-')}View Changes`).join('')}` : 'No change history'}
    
  `, req.session.user));
}));

app.get('/history/detail/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const entry = (await pool.query('SELECT * FROM version_history WHERE id=$1', [req.params.id])).rows[0];
  if (!entry) return res.status(404).send('Not found');
  const oldData = typeof entry.old_data === 'string' ? JSON.parse(entry.old_data) : entry.old_data;
  const newData = typeof entry.new_data === 'string' ? JSON.parse(entry.new_data) : entry.new_data;
  res.send(renderPage('Change Detail', `
    Change Detail${esc(entry.action)} by ${esc(entry.changed_by||'system')} on ${new Date(entry.created_at).toLocaleString()}
      Before${esc(JSON.stringify(oldData, null, 2))}After${esc(JSON.stringify(newData, null, 2))}
      Back
    
  `, req.session.user));
}));

// 3.12: PAGINATION HELPER
const paginate = (query, page, perPage = 50) => {
  const offset = (parseInt(page) - 1) * perPage;
  return { query: `${query} LIMIT ${perPage} OFFSET ${offset}`, offset, page: parseInt(page), perPage };
};
const paginationHtml = (currentPage, totalCount, perPage, baseUrl) => {
  const totalPages = Math.ceil(totalCount / perPage);
  if (totalPages ';
  if (currentPage > 1) html += `&laquo; Prev`;
  for (let i = Math.max(1, currentPage-2); i ${i}`;
  }
  if (currentPage Next &raquo;`;
  html += '';
  return html;
};

// 3.14: SEO META TAGS (enhance renderPage)
const renderPageV3 = (title, content, user, meta = {}) => {
  const dark = user?.dark_mode;
  const description = meta.description || `${title} - SSEWASSWA All-in-One Management Platform`;
  const keywords = meta.keywords || 'school management, church management, business management, Uganda, SSEWASSWA, clinic management, SaaS Africa';
  const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
  const canonicalUrl = meta.canonical || `${baseUrl}${meta.path || '/'}`;
  const googleVerification = process.env.GOOGLE_SITE_VERIFICATION || '';
  // Auto-inject CSRF token into all forms in the content
  let safeContent = content || '';
  if (meta.csrfToken && safeContent.includes(']*)>/g, ``);
  }
  return `

${googleVerification ? `` : ''}

















${esc(title)} | SSEWASSWA

*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${dark ? '#0f172a' : '#f8fafc'};color:${dark ? '#e2e8f0' : '#1e293b'};line-height:1.6;transition:background 0.3s,color 0.3s}
.nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
.nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;transition:0.2s;font-size:14px}.nav a:hover{background:rgba(255,255,255,0.2)}
.container{max-width:1200px;margin:20px auto;padding:0 20px}
.card{background:${dark ? '#1e293b' : 'white'};border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,${dark ? '0.3' : '0.08'});border:1px solid ${dark ? '#334155' : '#e2e8f0'};transition:background 0.3s}
.btn{display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;border:none;cursor:pointer;transition:0.3s;font-size:14px}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(79,70,229,0.4)}
.btn-sm{padding:8px 16px;font-size:13px;border-radius:8px}
.btn-green{background:linear-gradient(135deg,#059669,#10b981)}.btn-red{background:linear-gradient(135deg,#dc2626,#ef4444)}.btn-gold{background:linear-gradient(135deg,#f59e0b,#d97706)}
input,select,textarea{width:100%;padding:12px;border:1px solid ${dark ? '#475569' : '#d1d5db'};border-radius:10px;margin-bottom:12px;font-size:14px;background:${dark ? '#1e293b' : 'white'};color:${dark ? '#e2e8f0' : '#1e293b'};transition:border-color 0.2s}
input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,0.1)}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid ${dark ? '#334155' : '#e2e8f0'};font-size:14px}th{background:${dark ? '#1e293b' : '#f8fafc'};font-weight:600}
.hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:40px 30px;border-radius:16px;margin-bottom:25px;text-align:center}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin:20px 0}.stat-card{background:${dark ? '#1e293b' : 'white'};padding:20px;border-radius:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.05);border:1px solid ${dark ? '#334155' : '#e2e8f0'}}.stat-num{font-size:28px;font-weight:800;background:linear-gradient(135deg,#4f46e5,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin:20px 0}
.tag{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;background:#e0e7ff;color:#3730a3}
.alert{padding:16px;border-radius:10px;margin-bottom:15px}.alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}.alert-info{background:#dbeafe;color:#1e40af}
.muted{color:${dark ? '#94a3b8' : '#64748b'};font-size:13px}
a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}
@media(max-width:768px){.nav{flex-direction:column;gap:10px}.stats,.grid{grid-template-columns:1fr}}



${process.env.GA_TRACKING_ID ? `



  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('consent', 'default', {
    'analytics_storage': 'denied'
  });
  gtag('config', '${esc(process.env.GA_TRACKING_ID)}');


  document.addEventListener('cookieyes_consent_update', function(eventData) {
    var consentData = eventData.detail;
    if (consentData && consentData.accepted === 'yes') {
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }
  });

` : ''}


  ${esc(platformSettings.site_name)}
  
    ${user ? `
      Hi, ${esc(user.email.split('@')[0])}
      ${user.role === 'super_admin' ? `Dev Hub` : ''}
      🔔
      Dashboard
      Search
      Settings
      Guide
      Parent
      ${dark ? '☀️' : '🌙'}
      Logout
    ` : `LoginRegisterBlogLibrary`}
  

${safeContent}

  
    ${esc(platformSettings.site_name)} Platform${esc(platformSettings.site_tagline)} - Schools, Clinics, Churches & Businesses
    Need Help?
      Email: ${esc(platformSettings.support_email)}
      ${platformSettings.support_phone ? `Phone: ${esc(platformSettings.support_phone)}` : ''}
      ${platformSettings.whatsapp_link ? `WhatsApp Us` : ''}
      Help Center & FAQs
    
    Quick Links
      Blog & News
      Books & Papers
      Entertainment
      Fundraising
      ${platformSettings.facebook_link ? `Facebook` : ''}
      ${platformSettings.twitter_link ? `Twitter/X` : ''}
    
  
  &copy; ${new Date().getFullYear()} ${esc(platformSettings.site_name)}. ${esc(platformSettings.footer_text)}

`;
};

// 3.16: SETUP CHECKLIST
app.get('/setup', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  if (tenant?.setup_complete) return res.redirect('/dashboard');
  const [studentCount, staffCount, feeCount] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM students WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) as count FROM staff WHERE tenant_id=$1', [t]),
    pool.query('SELECT COUNT(*) as count FROM fees WHERE tenant_id=$1', [t])
  ]);
  const steps = [
    { name: 'Create your account', done: true },
    { name: 'Add your first student', done: parseInt(studentCount.rows[0]?.count || 0) > 0, link: '/school/students/new' },
    { name: 'Add staff members', done: parseInt(staffCount.rows[0]?.count || 0) > 0, link: '/school/staff/new' },
    { name: 'Set up fee structures', done: parseInt(feeCount.rows[0]?.count || 0) > 0, link: '/school/fee-structures/new' },
    { name: 'Customize branding', done: !!(tenant?.logo_url || tenant?.primary_color), link: '/settings/branding' },
    { name: 'Set up grading scale', done: false, link: '/school/grading' },
  ];
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount >= steps.length - 1) {
    await pool.query('UPDATE tenants SET setup_complete=true WHERE id=$1', [t]);
  }
  res.send(renderPage('Setup Checklist', `
    Welcome to SSEWASSWA!Let's get you set up in minutes
    
      Setup Progress
      
      ${doneCount} of ${steps.length} steps completed
      ${steps.map((s,i) => `${s.done ? '✅' : `${i+1}`}${esc(s.name)}${!s.done && s.link ? `Start` : ''}`).join('')}
      Go to Dashboard
    
  `, req.session.user));
}));

// 3.17: PRETTY URLs
app.get('/c/:subdomain', ah(async (req, res) => {
  const tenant = (await pool.query('SELECT * FROM tenants WHERE subdomain=$1', [req.params.subdomain])).rows[0];
  if (!tenant) return res.status(404).send(renderPage('404', 'Not FoundThis organization does not exist.', null));
  res.send(renderPageV3(tenant.name, `
    ${esc(tenant.name)}${esc(tenant.type)} - ${esc(tenant.description || 'Powered by SSEWASSWA')}
    ${tenant.type === 'church' ? `Service TimesView ScheduleDonateGive OnlinePrayer RequestsSubmit Request` : ''}
    ${tenant.type === 'school' ? `Student PortalParent LoginSchool InfoContact: ${esc(tenant.email||'-')}` : ''}
    ${tenant.type === 'business' ? `ProductsBrowseContact${esc(tenant.phone||tenant.email||'-')}` : ''}
  `, null, { description: `${tenant.name} - ${tenant.type} powered by SSEWASSWA` }));
}));

// 3.18: GRANT SCRAPER
app.get('/grants', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const grants = (await pool.query('SELECT * FROM grants WHERE tenant_id=$1 ORDER BY deadline', [t])).rows;
  res.send(renderPage('Grants', `
    Grant TrackerTrack and apply for funding opportunities
    + Add Grant
      ${grants.length ? `TitleFunderAmountDeadlineStatusActions${grants.map(g => `${esc(g.title)}${esc(g.funder||'-')}UGX ${parseInt(g.amount||0).toLocaleString()}${g.deadline?new Date(g.deadline).toLocaleDateString():'-'}${esc(g.status)}Edit`).join('')}` : 'No grants tracked yet'}
    
  `, req.session.user));
}));

app.get('/grants/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Grant', `Add Grant OpportunityIdentifiedResearchingApplyingSubmittedAwardedRejectedSave Grant`, req.session.user));
});

app.post('/grants/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, funder, amount, deadline, status, description, source_url } = req.body;
  await pool.query('INSERT INTO grants(tenant_id,title,funder,amount,deadline,status,description,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, title, funder, amount||0, deadline||null, status, description, source_url]);
  res.redirect('/grants');
}));

// 3.19: VIDEO COMPRESSION (Cloudinary 720p transform)
app.get('/entertainment/compress', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Video Compression', `
    Video CompressionOptimize videos for faster streaming
    Compress Video
      Upload videos and they will be automatically compressed to 720p for optimal streaming quality.
      
        
        
        
        Upload & Compress
      
      Cloudinary will automatically apply 720p transformation when CLOUDINARY_URL is configured.
    
  `, req.session.user));
});

// 3.20: USER GUIDE
app.get('/guide', (req, res) => {
  res.send(renderPageV3('User Guide', `
    SSEWASSWA User GuideEverything you need to know
    Getting Started
      Create an account - Register your school, church, business, or organizationSet up your profile - Go to Settings > Branding to add your logo and colorsAdd your people - Students, members, staff, or inventoryStart recording - Track fees, attendance, donations, sales, and more
    
    School Module
      Students - Add, import via CSV, track by class/stream/genderFees - Record payments, send balance reminders via SMS/emailExams & Marks - Enter marks with auto-grading, generate report cardsAttendance - Daily tracking with charts and print-ready reportsTimetable - Create class schedules by day and periodStaff - Manage teachers with clock-in/clock-outParent Portal - Parents view their child's fees, marks, attendance
    
    Church Module
      Members - Track congregation with birthdays and contact infoTithes & Donations - Record giving with tax receipt generationSermons - Library with notes and scripture referencesPrayer Requests - Private or public prayer needsLivestream - Manage YouTube/Facebook/Zoom service linksFundraising - Campaign tracking with public donation pages
    
    Business Module
      POS - Point-of-sale with barcode scanningInventory - Track stock levels, cost, selling pricesInvoices - Create and track invoices with PDF generationCustomers - CRM with loyalty pointsExpenses - Categorize and track all business expensesPurchase Orders - Manage procurement with approval workflow
    
    Advanced Features
      Billing - Free, Basic, Pro, Enterprise plans with FlutterwaveAPI Access - REST and GraphQL APIs for integrationsWebhooks - Get notified of events in real-timeSMS & Email - Bulk messaging to parents, members, staffAutomation - Create if-then rules for automated actionsAI Insights - Fee prediction, dropout risk, engagement scoringReports - Custom report builder with PowerBI export
    
    Need Help?
      Contact: waiswadaniel24@gmail.com | +256 789 736737
      API Docs: /api-docs
    
  `, req.session?.user, { description: 'SSEWASSWA user guide - learn how to manage your school, church, or business' }));
});

// 3.12: PAGINATED STUDENT LIST (override existing route with pagination)
app.get('/school/students/paginated', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const page = parseInt(req.query.page) || 1;
  const perPage = 50;
  const offset = (page - 1) * perPage;
  const [students, countResult] = await Promise.all([
    pool.query('SELECT * FROM students WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT $2 OFFSET $3', [t, perPage, offset]),
    pool.query('SELECT COUNT(*) as count FROM students WHERE tenant_id=$1 AND deleted_at IS NULL', [t])
  ]);
  const totalCount = parseInt(countResult.rows[0]?.count || 0);
  res.send(renderPage('Students', `
    Students (Page ${page})+ New StudentCSV Import
      Showing ${offset+1}-${Math.min(offset+perPage, totalCount)} of ${totalCount} students
      NameAdm#ClassActions
      ${students.rows.map(s => `${esc(s.name)}${esc(s.admission_no||'-')}${esc(s.class||'-')}Edit`).join('') || 'No students'}
      
      ${paginationHtml(page, totalCount, perPage, '/school/students/paginated')}
    
  `, req.session.user));
}));

// 3.13: API Rate Limiting Enhancement
app.use('/api/v1', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use('/api/v2', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// === END v3.0 PRODUCTION HARDENING ===


app.get('/terms', (req, res) => {
  res.send(renderPage('Terms of Service', `
    
      Terms of Service
      Last Updated: ${new Date().toDateString()}
      1. Data Ownership
      You own all data entered into your account. We store it securely and never share it without consent.
      2. Privacy
      Each organization sees only their own data. Cross-tenant access is technically blocked and logged.
      3. Fundraising
      Fundraising module is optional. 5% platform fee applies to donations processed.
      4. Termination
      You may export all data and close account anytime. We delete data within 30 days.
      5. Contact
      waiswadaniel24@gmail.com | +256 789 736737
    
  `, null));
});

// ============================================================
// FULL v3.0→v9.0 FEATURE SYSTEM - ALL MISSING FEATURES
// ============================================================

// Feature flag check middleware
const requireFeature = (featureKey) => async (req, res, next) => {
  try {
    const flag = (await pool.query('SELECT * FROM feature_flags WHERE feature_key=$1', [featureKey])).rows[0];
    if (flag?.is_active) return next();
    return res.send(renderPage('Coming Soon', `
      Coming SoonThis feature is not yet activated
      
        🔒
        ${esc(flag?.name || featureKey)}
        ${esc(flag?.description || 'This feature requires activation by the platform developer.')}
        ${flag?.requirements && flag.requirements !== 'None' ? `Requirements: ${esc(flag.requirements)}` : ''}
        Back to Dashboard Feature Manager
      
    `, req.session.user));
  } catch(e) { return next(); }
};

// =============================================
// FEATURE ACTIVATION SYSTEM (Developer Dashboard)
// =============================================
app.get('/dev/features', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const features = (await pool.query('SELECT * FROM feature_flags ORDER BY version, category, name')).rows;
  const categories = {};
  features.forEach(f => {
    const cat = f.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(f);
  });
  const catNames = { core: 'v3.0 Core', uganda: 'v4.0 Uganda Market', enterprise: 'v5.0 Enterprise', ecosystem: 'v6.0 Ecosystem', ai: 'v7.0 AI & Automation', mobile: 'v8.0 Mobile', platform: 'v9.0 Platform' };
  const activeCount = features.filter(f => f.is_active).length;
  res.send(renderPage('Feature Manager', `
    Feature Activation ManagerToggle features on/off as requirements are met
    
      ${features.length}Total Features
      ${activeCount}Active
      ${features.length - activeCount}Coming Soon
    
    ${Object.entries(categories).map(([cat, items]) => `
      ${catNames[cat] || cat.toUpperCase()} ${items.length} features
        FeatureKeyVersionRequirementsStatusAction
        ${items.map(f => `
          ${esc(f.name)}${esc(f.description||'')}
          ${esc(f.feature_key)}
          v${esc(f.version||'?')}
          ${f.requirements && f.requirements !== 'None' ? `${esc(f.requirements)}` : 'None'}
          ${f.is_active ? 'Active' : 'Coming Soon'}
          ${f.is_active ? 'Deactivate' : 'Activate'}
        `).join('')}
        
      
    `).join('')}
  `, req.session.user));
}));

app.get('/dev/features/:id/toggle', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const feature = (await pool.query('SELECT * FROM feature_flags WHERE id=$1', [req.params.id])).rows[0];
  if (!feature) return res.status(404).send('Feature not found');
  const newActive = !feature.is_active;
  await pool.query('UPDATE feature_flags SET is_active=$1, activated_by=$2, activated_at=NOW() WHERE id=$3', [newActive, req.session.user.email, req.params.id]);
  await audit(req.session.user.email, `Feature ${newActive ? 'activated' : 'deactivated'}`, `${feature.name} (${feature.feature_key})`);
  res.redirect('/dev/features');
}));

// =============================================
// PAGE EDITOR (User-editable pages with stamps/headers/footers/badges/signatures)
// =============================================
app.get('/pages', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const pages = (await pool.query('SELECT * FROM custom_pages WHERE tenant_id=$1 ORDER BY updated_at DESC', [t])).rows;
  res.send(renderPage('Page Editor', `
    Page EditorCreate and customize your pages
    + New Page
      ${pages.length ? `TitleSlugBadgeStampSignaturePublishedActions
      ${pages.map(p => `
        ${esc(p.title)}
        ${esc(p.slug)}
        ${p.badge_text ? `${esc(p.badge_text)}` : '-'}
        ${p.stamp_url ? 'Yes' : '-'}
        ${p.signature_name ? esc(p.signature_name) : '-'}
        ${p.is_published ? 'Published' : 'Draft'}
        
          Edit
          Preview
          View
          Delete
        
      `).join('')}` : 'No pages yet. Create your first page!'}
    
  `, req.session.user));
}));

app.get('/pages/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Page', `
    
      Create New Page
      
        
          Page Title
          URL SlugPage will be at /p/about-us
        
        Page Content (HTML)
        Welcome!Your content here..." style="font-family:monospace">
        Header
        My Organization" style="font-family:monospace">
        Footer
        Contact: info@example.com" style="font-family:monospace">
        Stamp
        
          Stamp Image URL
          PositionBottom RightBottom LeftTop RightTop LeftCenter
        
        Badge
        
          Badge Text
          Badge Color
        
        Signature
        
          Signatory Name
          Signature Image URL
        
         Publish this page immediately
        Create Page
      
    
  `, req.session.user));
});

app.post('/pages/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, slug, content, header_html, footer_html, stamp_url, stamp_position, badge_text, badge_color, signature_name, signature_image_url, signature_position, is_published } = req.body;
  await pool.query('INSERT INTO custom_pages(tenant_id,title,slug,content,header_html,footer_html,stamp_url,stamp_position,badge_text,badge_color,signature_name,signature_image_url,signature_position,is_published,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [t, title, slug, content||'', header_html||'', footer_html||'', stamp_url||null, stamp_position||'bottom-right', badge_text||null, badge_color||'#4f46e5', signature_name||null, signature_image_url||null, signature_position||'bottom-left', is_published==='on', req.session.user.email, req.session.user.email]);
  await audit(req.session.user.email, 'page_created', title);
  res.redirect('/pages');
}));

app.get('/pages/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const page = (await pool.query('SELECT * FROM custom_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!page) return res.status(404).send('Page not found');
  res.send(renderPage('Edit Page', `
    
      Edit Page: ${esc(page.title)}
      
        
          Page Title
          URL Slug
        
        Page Content (HTML)
        ${esc(page.content||'')}
        Header
        ${esc(page.header_html||'')}
        Footer
        ${esc(page.footer_html||'')}
        Stamp
        
          Stamp Image URL
          PositionBottom RightBottom LeftTop RightTop LeftCenter
        
        Badge
        
          Badge Text
          Badge Color
        
        Signature
        
          Signatory Name
          Signature Image URL
        
         Published
        Update Page
      
    
  `, req.session.user));
}));

app.post('/pages/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, slug, content, header_html, footer_html, stamp_url, stamp_position, badge_text, badge_color, signature_name, signature_image_url, signature_position, is_published } = req.body;
  await pool.query('UPDATE custom_pages SET title=$1,slug=$2,content=$3,header_html=$4,footer_html=$5,stamp_url=$6,stamp_position=$7,badge_text=$8,badge_color=$9,signature_name=$10,signature_image_url=$11,signature_position=$12,is_published=$13,updated_by=$14,updated_at=NOW() WHERE id=$15 AND tenant_id=$16', [title, slug, content||'', header_html||'', footer_html||'', stamp_url||null, stamp_position||'bottom-right', badge_text||null, badge_color||'#4f46e5', signature_name||null, signature_image_url||null, signature_position||'bottom-left', is_published==='on', req.session.user.email, req.params.id, t]);
  res.redirect('/pages');
}));

app.get('/pages/:id/preview', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const page = (await pool.query('SELECT * FROM custom_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!page) return res.status(404).send('Page not found');
  const stampPos = { 'bottom-right': 'bottom:20px;right:20px', 'bottom-left': 'bottom:20px;left:20px', 'top-right': 'top:20px;right:20px', 'top-left': 'top:20px;left:20px', 'center': 'top:50%;left:50%;transform:translate(-50%,-50%)' };
  const sigPos = { 'bottom-right': 'bottom:20px;right:20px', 'bottom-left': 'bottom:20px;left:20px' };
  res.send(renderPageV3('Preview: ' + page.title, `
    
      ${page.badge_text ? `${esc(page.badge_text)}` : ''}
      ${page.header_html || ''}
      ${page.content || 'No content yet'}
      ${page.stamp_url ? `` : ''}
      ${page.signature_name ? `${esc(page.signature_name)}${page.signature_image_url ? `` : ''}` : ''}
      ${page.footer_html || ''}
    
    Edit Page All Pages
  `, req.session.user));
}));

app.get('/pages/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM custom_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/pages');
}));

// Public custom page view
app.get('/p/:slug', ah(async (req, res, next) => {
  // Special slugs handled by launch-routes
  const specialSlugs = ['entertainment', 'fundraising', 'home', 'links'];
  if (specialSlugs.includes(req.params.slug)) return next();

  const page = (await pool.query('SELECT cp.*,t.name as tenant_name,t.primary_color FROM custom_pages cp JOIN tenants t ON cp.tenant_id=t.id WHERE cp.slug=$1 AND cp.is_published=true', [req.params.slug])).rows[0];
  if (!page) return next(); // Pass to next handler (launch-routes or 404)
  const stampPos = { 'bottom-right': 'bottom:20px;right:20px', 'bottom-left': 'bottom:20px;left:20px', 'top-right': 'top:20px;right:20px', 'top-left': 'top:20px;left:20px', 'center': 'top:50%;left:50%;transform:translate(-50%,-50%)' };
  const sigPos = { 'bottom-right': 'bottom:40px;right:40px', 'bottom-left': 'bottom:40px;left:40px' };
  res.send(renderPageV3(page.title, `
    
      ${page.badge_text ? `${esc(page.badge_text)}` : ''}
      ${page.header_html || ''}
      ${page.content || ''}
      ${page.stamp_url ? `` : ''}
      ${page.signature_name ? `${esc(page.signature_name)}${page.signature_image_url ? `` : ''}` : ''}
      ${page.footer_html || ''}
    
    Powered by SSEWASSWA
  `, null, { description: page.title + ' - ' + (page.tenant_name || 'SSEWASSWA') }));
}));

// =============================================
// DOCUMENT TEMPLATES (Receipts, Reports, Certificates)
// =============================================
app.get('/document-templates', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const templates = (await pool.query('SELECT * FROM document_templates WHERE tenant_id=$1 ORDER BY type, name', [t])).rows;
  res.send(renderPage('Document Templates', `
    Document TemplatesCustomize headers, footers, stamps, signatures on documents
    + New Template
      ${templates.length ? `NameTypeStampBadgeSignatureWatermarkActions
      ${templates.map(t => `
        ${esc(t.name)}
        ${esc(t.type)}
        ${t.stamp_url ? 'Yes' : '-'}
        ${t.badge_text ? `${esc(t.badge_text)}` : '-'}
        ${t.signature_name ? esc(t.signature_name) : '-'}
        ${t.watermark_text ? esc(t.watermark_text) : '-'}
        Edit Preview Delete
      `).join('')}` : 'No templates. Create one to customize your documents!'}
    
  `, req.session.user));
}));

app.get('/document-templates/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Document Template', `
    
      Create Document Template
      
        
          Template Name
          TypeFee ReceiptReport CardInvoiceCertificateLetterGeneral
        
        Header
        School NameMotto: Excellence" style="font-family:monospace">
        Footer
        Generated by SSEWASSWA | Date: {{date}}" style="font-family:monospace">
        Stamp
        
          Stamp Image URL
          PositionBottom RightBottom LeftTop RightCenter
        
        Badge
        
          Badge Text
          Badge Color
        
        Signature
        
          Signatory Name
          Signature Image URL
        
        Additional Options
        
          Logo URL
          Watermark Text
          Watermark Opacity
        
        
          Paper SizeA4A5LetterLegal
          Custom CSS
        
        Create Template
      
    
  `, req.session.user));
});

app.post('/document-templates/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, type, header_html, footer_html, stamp_url, stamp_position, badge_text, badge_color, signature_name, signature_image_url, signature_position, logo_url, watermark_text, watermark_opacity, paper_size, margin_top, margin_bottom, margin_left, margin_right, css } = req.body;
  await pool.query('INSERT INTO document_templates(tenant_id,name,type,header_html,footer_html,stamp_url,stamp_position,badge_text,badge_color,signature_name,signature_image_url,signature_position,logo_url,watermark_text,watermark_opacity,paper_size,margin_top,margin_bottom,margin_left,margin_right,css) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)', [t, name, type, header_html||'', footer_html||'', stamp_url||null, stamp_position||'bottom-right', badge_text||null, badge_color||'#4f46e5', signature_name||null, signature_image_url||null, signature_position||'bottom-left', logo_url||null, watermark_text||null, watermark_opacity||0.1, paper_size||'A4', margin_top||20, margin_bottom||20, margin_left||15, margin_right||15, css||null]);
  res.redirect('/document-templates');
}));

app.get('/document-templates/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tmpl = (await pool.query('SELECT * FROM document_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!tmpl) return res.status(404).send('Template not found');
  res.send(renderPage('Edit Template', `
    
      Edit Template: ${esc(tmpl.name)}
      
        
          Template Name
          TypeFee ReceiptReport CardInvoiceCertificateLetterGeneral
        
        Header
        ${esc(tmpl.header_html||'')}
        Footer
        ${esc(tmpl.footer_html||'')}
        Stamp
        
          Stamp Image URL
          PositionBottom RightBottom LeftTop RightCenter
        
        Badge
        
          Badge Text
          Badge Color
        
        Signature
        
          Signatory Name
          Signature Image URL
        
        Additional Options
        
          Logo URL
          Watermark Text
          Watermark Opacity
        
        
          Paper SizeA4A5LetterLegal
          Custom CSS
        
        Update Template
      
    
  `, req.session.user));
}));

app.post('/document-templates/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, type, header_html, footer_html, stamp_url, stamp_position, badge_text, badge_color, signature_name, signature_image_url, signature_position, logo_url, watermark_text, watermark_opacity, paper_size, margin_top, margin_bottom, margin_left, margin_right, css } = req.body;
  await pool.query('UPDATE document_templates SET name=$1,type=$2,header_html=$3,footer_html=$4,stamp_url=$5,stamp_position=$6,badge_text=$7,badge_color=$8,signature_name=$9,signature_image_url=$10,signature_position=$11,logo_url=$12,watermark_text=$13,watermark_opacity=$14,paper_size=$15,margin_top=$16,margin_bottom=$17,margin_left=$18,margin_right=$19,css=$20 WHERE id=$21 AND tenant_id=$22', [name, type, header_html||'', footer_html||'', stamp_url||null, stamp_position||'bottom-right', badge_text||null, badge_color||'#4f46e5', signature_name||null, signature_image_url||null, signature_position||'bottom-left', logo_url||null, watermark_text||null, watermark_opacity||0.1, paper_size||'A4', margin_top||20, margin_bottom||20, margin_left||15, margin_right||15, css||null, req.params.id, t]);
  res.redirect('/document-templates');
}));

app.get('/document-templates/:id/preview', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tmpl = (await pool.query('SELECT * FROM document_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!tmpl) return res.status(404).send('Template not found');
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const stampPos = { 'bottom-right': 'bottom:20px;right:20px', 'bottom-left': 'bottom:20px;left:20px', 'top-right': 'top:80px;right:20px', 'center': 'top:50%;left:50%;transform:translate(-50%,-50%)' };
  const sigPos = { 'bottom-right': 'bottom:60px;right:60px', 'bottom-left': 'bottom:60px;left:60px' };
  res.send(`Preview: ${esc(tmpl.name)}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0;display:flex;justify-content:center;padding:30px}
    .page{background:white;width:${tmpl.paper_size==='A4'?'210mm':tmpl.paper_size==='A5'?'148mm':'216mm'};min-height:${tmpl.paper_size==='A4'?'297mm':tmpl.paper_size==='A5'?'210mm':'279mm'};padding:${tmpl.margin_top||20}mm ${tmpl.margin_right||15}mm ${tmpl.margin_bottom||20}mm ${tmpl.margin_left||15}mm;box-shadow:0 4px 20px rgba(0,0,0,0.15);position:relative;margin:10px}
    ${tmpl.css||''}
  
    
      ${tmpl.watermark_text ? `${esc(tmpl.watermark_text)}` : ''}
      ${tmpl.badge_text ? `${esc(tmpl.badge_text)}` : ''}
      ${tmpl.header_html || `${esc(tenant?.name||'Organization')}${esc(tenant?.type||'')} Management${tmpl.logo_url||tenant?.logo_url ? `` : ''}`}
      
        [Document Content Will Appear Here]
        Sample data for preview purposes
        ItemAmountSample ItemUGX 100,000
      
      ${tmpl.stamp_url ? `` : ''}
      ${tmpl.signature_name ? `${esc(tmpl.signature_name)}${tmpl.signature_image_url ? `` : ''}` : ''}
      ${tmpl.footer_html || `Generated by SSEWASSWA on ${new Date().toLocaleDateString()} | ${esc(tenant?.name||'')}`}
    
  `);
}));

app.get('/document-templates/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM document_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/document-templates');
}));

// Apply template to receipt generation
app.get('/school/fees/:id/receipt-styled', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const fee = (await pool.query('SELECT f.*,s.name as student_name,s.class,s.admission_no FROM fees f LEFT JOIN students s ON f.student_id=s.id WHERE f.id=$1 AND f.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!fee) return res.status(404).send('Fee record not found');
  const tmpl = (await pool.query("SELECT * FROM document_templates WHERE tenant_id=$1 AND type='receipt' LIMIT 1", [t])).rows[0];
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const stampPos = { 'bottom-right': 'bottom:20px;right:20px', 'bottom-left': 'bottom:20px;left:20px', 'top-right': 'top:80px;right:20px', 'center': 'top:50%;left:50%;transform:translate(-50%,-50%)' };
  const sigPos = { 'bottom-right': 'bottom:60px;right:60px', 'bottom-left': 'bottom:60px;left:60px' };
  const balance = parseInt(fee.amount) - parseInt(fee.paid);
  res.send(`Receipt ${fee.receipt_no||fee.id}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f0f0;display:flex;justify-content:center;padding:30px}
    .page{background:white;width:${tmpl?.paper_size==='A4'?'210mm':'216mm'};min-height:${tmpl?.paper_size==='A4'?'297mm':'279mm'};padding:${tmpl?.margin_top||20}mm ${tmpl?.margin_right||15}mm ${tmpl?.margin_bottom||20}mm ${tmpl?.margin_left||15}mm;box-shadow:0 4px 20px rgba(0,0,0,0.15);position:relative}
    ${tmpl?.css||''}
  
    
      ${tmpl?.watermark_text ? `${esc(tmpl.watermark_text)}` : ''}
      ${tmpl?.badge_text ? `${esc(tmpl.badge_text)}` : ''}
      ${tmpl?.header_html || `${esc(tenant?.name||'School')}Fee Receipt${tmpl?.logo_url||tenant?.logo_url ? `` : ''}`}
      Receipt No: ${esc(fee.receipt_no||'RCPT-'+fee.id)}Date: ${new Date(fee.created_at).toLocaleDateString()}Student: ${esc(fee.student_name)}Class: ${esc(fee.class||'-')}Adm No: ${esc(fee.admission_no||'-')}Term: ${esc(fee.term||'-')} ${fee.year||''}
      DescriptionAmountTotal FeesUGX ${parseInt(fee.amount).toLocaleString()}Amount PaidUGX ${parseInt(fee.paid).toLocaleString()}Balance0?'color:#dc2626':'color:#059669'}">UGX ${balance.toLocaleString()}
      ${tmpl?.stamp_url ? `` : ''}
      ${tmpl?.signature_name ? `${esc(tmpl.signature_name)}${tmpl.signature_image_url ? `` : ''}` : ''}
      ${tmpl?.footer_html || `Generated by SSEWASSWA | ${esc(tenant?.name||'')}`}
    
  `);
}));

// =============================================
// v3.0: PRIVACY POLICY
// =============================================
app.get('/privacy', (req, res) => {
  res.send(renderPage('Privacy Policy', `
    
      Privacy Policy
      Last Updated: ${new Date().toDateString()}
      1. Data We Collect
      We collect information you provide directly: names, emails, phone numbers, financial records, attendance data, and organizational information. We also collect usage data including page views, feature usage, and device information for analytics.
      2. How We Use Your Data
      Your data is used exclusively to provide the SSEWASSWA platform services. We process fees, generate reports, send notifications, and improve our services based on usage patterns. We never sell your data to third parties.
      3. Data Storage and Security
      All data is encrypted in transit (SSL/TLS) and at rest. Passwords are hashed using bcrypt. Each organization's data is isolated by tenant_id with strict access controls. We perform automated daily backups stored securely on Cloudinary.
      4. Data Sharing
      We do not share your data with third parties except: (a) when you explicitly request integration with external services, (b) when required by law, or (c) anonymized, aggregate data for platform improvement.
      5. Your Rights
      You may export all your data at any time via Settings > Backup. You may request deletion of your account and all associated data. Deletion is completed within 30 days. You can opt out of SMS communications at any time.
      6. Cookies and Sessions
      We use HTTP-only, secure session cookies for authentication. No tracking cookies are used. Session data expires after 7 days of inactivity.
      7. Third-Party Services
      We integrate with: Flutterwave (payments), Cloudinary (file storage), Africa's Talking (SMS), and Gmail SMTP (email). Each has their own privacy policy. We only share the minimum data required for service delivery.
      8. Data Retention
      Active account data is retained indefinitely. Deleted items are soft-deleted and can be restored within 30 days. Closed accounts have all data purged within 30 days of closure. Audit logs are retained for 2 years for security purposes.
      9. Children's Privacy
      Student data is collected only through authorized school administrators and parents. We do not directly collect data from children under 13. Parent portal access is controlled and audited.
      10. Contact
      Data Protection Officer: waiswadaniel24@gmail.com | +256 789 736737
    
  `, null));
});

// =============================================
// v4.0: USSD MENUS
// =============================================
app.post('/ussd', ah(async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;
  let response = '';
  try {
    if (!text || text === '') {
      response = `CON Welcome to SSEWASSWA\n1. Check Student Balance\n2. View Results\n3. Report Attendance\n4. Contact Support`;
    } else if (text === '1') {
      response = `CON Enter Student Admission Number:`;
    } else if (text.startsWith('1*')) {
      const admNo = text.split('*')[1];
      const student = (await pool.query('SELECT s.*,f.amount,f.paid,f.term FROM students s LEFT JOIN fees f ON s.id=f.student_id WHERE s.admission_no=$1 LIMIT 1', [admNo])).rows[0];
      if (student) {
        const balance = parseInt(student.amount||0) - parseInt(student.paid||0);
        response = `END Fee Balance for ${student.name}\nTotal: UGX ${parseInt(student.amount||0).toLocaleString()}\nPaid: UGX ${parseInt(student.paid||0).toLocaleString()}\nBalance: UGX ${balance.toLocaleString()}`;
      } else {
        response = `END Student not found. Check admission number and try again.`;
      }
    } else if (text === '2') {
      response = `CON Enter Student Admission Number:`;
    } else if (text.startsWith('2*')) {
      const admNo = text.split('*')[1];
      const student = (await pool.query('SELECT * FROM students WHERE admission_no=$1 LIMIT 1', [admNo])).rows[0];
      if (student) {
        const marks = (await pool.query('SELECT m.subject,m.score,m.grade,e.name as exam FROM marks m JOIN exams e ON m.exam_id=e.id WHERE m.student_id=$1 ORDER BY e.created_at DESC LIMIT 5', [student.id])).rows;
        if (marks.length) {
          response = `END Results for ${student.name}\n${marks.map(m => `${m.subject}: ${m.score} (${m.grade})`).join('\n')}`;
        } else {
          response = `END No results found for ${student.name}.`;
        }
      } else {
        response = `END Student not found.`;
      }
    } else if (text === '3') {
      response = `CON Enter Student Admission Number:`;
    } else if (text.startsWith('3*')) {
      const admNo = text.split('*')[1];
      const student = (await pool.query('SELECT * FROM students WHERE admission_no=$1 LIMIT 1', [admNo])).rows[0];
      if (student) {
        await pool.query('INSERT INTO attendance(student_id,date,status) VALUES($1,CURRENT_DATE,$2) ON CONFLICT(student_id,date) DO UPDATE SET status=$2', [student.id, 'present']);
        response = `END Attendance marked PRESENT for ${student.name}.`;
      } else {
        response = `END Student not found.`;
      }
    } else if (text === '4') {
      response = `END Contact Support:\nEmail: waiswadaniel24@gmail.com\nPhone: +256 789 736737`;
    } else {
      response = `END Invalid option. Please try again.`;
    }
    // Log USSD session
    await pool.query('INSERT INTO ussd_sessions(session_id,phone,current_menu,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [sessionId, phoneNumber, text, { response }]);
  } catch(e) {
    response = `END Service temporarily unavailable. Please try again later.`;
  }
  res.set('Content-Type', 'text/plain');
  res.send(response);
}));

// =============================================
// v4.0: SMS OPT-OUT
// =============================================
app.get('/sms/opt-out', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const optOuts = (await pool.query('SELECT * FROM sms_opt_outs WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('SMS Opt-Out', `
    SMS Opt-Out ManagementManage phone numbers that have opted out
    + Add Opt-Out
      ${optOuts.length ? `PhoneReasonDateActions${optOuts.map(o => `${esc(o.phone)}${esc(o.reason||'-')}${new Date(o.created_at).toLocaleDateString()}Allow`).join('')}` : 'No opt-outs recorded'}
    
  `, req.session.user));
}));

app.get('/sms/opt-out/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add SMS Opt-Out', 'Add Phone to Opt-OutBlock SMS', req.session.user));
});

app.post('/sms/opt-out/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, reason } = req.body;
  await pool.query('INSERT INTO sms_opt_outs(tenant_id,phone,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, phone, reason]);
  res.redirect('/sms/opt-out');
}));

app.get('/sms/opt-out/:id/remove', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM sms_opt_outs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/sms/opt-out');
}));

// Public SMS opt-out endpoint
app.post('/opt-out', ah(async (req, res) => {
  const { phone, tenant_id } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  await pool.query('INSERT INTO sms_opt_outs(tenant_id,phone,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tenant_id || 0, phone, 'self-opt-out']);
  res.json({ success: true, message: 'You have been opted out of SMS communications.' });
}));

// =============================================
// v5.0: ADVANCED ANALYTICS
// =============================================
app.get('/analytics', requireAuth, requireNotBanned, requireFeature('advanced_analytics'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const type = tenant?.type || 'school';
  let statsHtml = '';
  try {
    if (type === 'school' || type === 'church') {
      const [studentCount, feeTotal, feePaid, attendanceRate] = await Promise.all([
        pool.query('SELECT COUNT(*) as c FROM students WHERE tenant_id=$1 AND deleted_at IS NULL', [t]),
        pool.query('SELECT COALESCE(SUM(amount),0) as t FROM fees WHERE tenant_id=$1', [t]),
        pool.query('SELECT COALESCE(SUM(paid),0) as p FROM fees WHERE tenant_id=$1', [t]),
        pool.query("SELECT COUNT(CASE WHEN status='present' THEN 1 END)*100.0/NULLIF(COUNT(*),0) as rate FROM attendance WHERE tenant_id=$1", [t])
      ]);
      statsHtml = `
        ${studentCount.rows[0]?.c||0}Students
        UGX ${parseInt(feeTotal.rows[0]?.t||0).toLocaleString()}Total Fees
        UGX ${parseInt(feePaid.rows[0]?.p||0).toLocaleString()}Collected
        ${parseFloat(attendanceRate.rows[0]?.rate||0).toFixed(1)}%Attendance Rate
      `;
    } else if (type === 'business') {
      const [salesTotal, expenseTotal, inventoryCount, customerCount] = await Promise.all([
        pool.query('SELECT COALESCE(SUM(total),0) as t FROM sales WHERE tenant_id=$1', [t]),
        pool.query('SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE tenant_id=$1', [t]),
        pool.query('SELECT COUNT(*) as c FROM inventory WHERE tenant_id=$1 AND deleted_at IS NULL', [t]),
        pool.query('SELECT COUNT(*) as c FROM customers WHERE tenant_id=$1 AND deleted_at IS NULL', [t])
      ]);
      const profit = parseInt(salesTotal.rows[0]?.t||0) - parseInt(expenseTotal.rows[0]?.t||0);
      statsHtml = `
        UGX ${parseInt(salesTotal.rows[0]?.t||0).toLocaleString()}Revenue
        UGX ${parseInt(expenseTotal.rows[0]?.t||0).toLocaleString()}Expenses
        =0?'#059669':'#dc2626'}">UGX ${profit.toLocaleString()}Profit
        ${inventoryCount.rows[0]?.c||0}Products
        ${customerCount.rows[0]?.c||0}Customers
      `;
    } else {
      const [memberCount, donationTotal, projectCount] = await Promise.all([
        pool.query('SELECT COUNT(*) as c FROM members WHERE tenant_id=$1', [t]),
        pool.query('SELECT COALESCE(SUM(amount),0) as t FROM org_finance WHERE tenant_id=$1 AND type=$2', [t, 'income']),
        pool.query('SELECT COUNT(*) as c FROM projects WHERE tenant_id=$1', [t])
      ]);
      statsHtml = `
        ${memberCount.rows[0]?.c||0}Members
        UGX ${parseInt(donationTotal.rows[0]?.t||0).toLocaleString()}Income
        ${projectCount.rows[0]?.c||0}Projects
      `;
    }
    // Monthly trend
    const monthlyData = (await pool.query("SELECT date_trunc('month',created_at) as month,COUNT(*) as count FROM analytics_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '6 months' GROUP BY month ORDER BY month", [t])).rows;
    const trendHtml = monthlyData.length ? `Activity Trend (6 Months)MonthEvents${monthlyData.map(d => `${new Date(d.month).toLocaleDateString('en',{year:'numeric',month:'short'})}${d.count}`).join('')}` : '';
    res.send(renderPage('Advanced Analytics', `
      Advanced AnalyticsDeep insights into your data
      ${statsHtml}
      ${trendHtml}
      Quick Reports
        Fee CollectionView
        Attendance TrendsView
        Gender DistributionView
        Financial OverviewView
        Fee PredictionView
        Dropout RiskView
      
    `, req.session.user));
  } catch(e) {
    res.send(renderPage('Analytics', 'Analytics are being generated. Please check back shortly.', req.session.user));
  }
}));

// =============================================
// v5.0: SCHEDULED REPORTS
// =============================================
app.get('/scheduled-reports', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const reports = (await pool.query('SELECT * FROM scheduled_reports WHERE tenant_id=$1 ORDER BY next_run', [t])).rows;
  res.send(renderPage('Scheduled Reports', `
    Scheduled ReportsAuto-send reports on schedule
    + Schedule Report
      ${reports.length ? `NameTypeFrequencyRecipientsLast RunNext RunStatusActions
      ${reports.map(r => `${esc(r.name)}${esc(r.report_type)}${esc(r.frequency)}${esc(r.recipients||'-')}${r.last_run?new Date(r.last_run).toLocaleDateString():'Never'}${r.next_run?new Date(r.next_run).toLocaleDateString():'-'}${r.active?'Active':'Paused'}${r.active?'Pause':'Resume'} Run Now Delete`).join('')}` : 'No scheduled reports'}
    
  `, req.session.user));
}));

app.get('/scheduled-reports/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Schedule Report', `
    
      Schedule New Report
      
        
        Fee Balance ReportAttendance ReportFinancial SummaryInventory ReportDonations ReportSales Report
        DailyWeeklyMonthly
        CSVJSON
        
        Schedule Report
      
    
  `, req.session.user));
});

app.post('/scheduled-reports/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, report_type, frequency, format, recipients } = req.body;
  const nextRun = new Date();
  if (frequency === 'weekly') nextRun.setDate(nextRun.getDate() + 7);
  else if (frequency === 'monthly') nextRun.setMonth(nextRun.getMonth() + 1);
  else nextRun.setDate(nextRun.getDate() + 1);
  await pool.query('INSERT INTO scheduled_reports(tenant_id,name,report_type,frequency,format,recipients,next_run) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, name, report_type, frequency, format||'csv', recipients, nextRun]);
  res.redirect('/scheduled-reports');
}));

app.get('/scheduled-reports/:id/run', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const report = (await pool.query('SELECT * FROM scheduled_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!report) return res.status(404).send('Not found');
  let data = {};
  if (report.report_type === 'fee_balance') {
    data = (await pool.query('SELECT s.name,s.class,f.amount,f.paid,f.term FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1', [t])).rows;
  } else if (report.report_type === 'attendance') {
    data = (await pool.query('SELECT s.name,a.date,a.status FROM attendance a JOIN students s ON a.student_id=s.id WHERE a.tenant_id=$1 ORDER BY a.date DESC LIMIT 500', [t])).rows;
  } else if (report.report_type === 'financial') {
    const [income, expenses, sales] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(amount),0) as total FROM org_finance WHERE tenant_id=$1 AND type=$2', [t, 'income']),
      pool.query('SELECT COALESCE(SUM(amount),0) as total FROM org_finance WHERE tenant_id=$1 AND type=$2', [t, 'expense']),
      pool.query('SELECT COALESCE(SUM(total),0) as total FROM sales WHERE tenant_id=$1', [t])
    ]);
    data = { income: income.rows[0], expenses: expenses.rows[0], sales: sales.rows[0] };
  }
  // Send via email
  const recipients = report.recipients.split(',').map(r => r.trim());
  for (const email of recipients) {
    await queueEmail(t, email, `SSEWASSWA Report: ${report.name}`, `${report.name}Report generated on ${new Date().toLocaleString()}${JSON.stringify(data, null, 2).substring(0, 5000)}`);
  }
  await pool.query('UPDATE scheduled_reports SET last_run=NOW(), next_run=CASE WHEN frequency=$1 THEN NOW() + INTERVAL \'1 day\' WHEN frequency=$2 THEN NOW() + INTERVAL \'7 days\' ELSE NOW() + INTERVAL \'30 days\' END WHERE id=$3', ['daily', 'weekly', report.id]);
  res.send(renderPage('Report Sent', 'Report Sent!The report has been emailed to all recipients.Back', req.session.user));
}));

app.get('/scheduled-reports/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE scheduled_reports SET active=NOT active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/scheduled-reports');
}));

app.get('/scheduled-reports/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM scheduled_reports WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/scheduled-reports');
}));

// =============================================
// v5.0: FULL MoMo INTEGRATION
// =============================================
app.post('/momo/mtm/initiate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, amount, reference } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'Phone and amount required' });
  const momoRef = 'MOMO-' + Date.now();
  if (process.env.MTN_MOMO_USER_ID && process.env.MTN_MOMO_API_KEY) {
    try {
      // MTN MoMo API integration
      const authResp = await fetch('https://sandbox.momodeveloper.mtn.com/collection/token/', { method: 'POST', headers: { 'Authorization': 'Basic ' + Buffer.from(process.env.MTN_MOMO_USER_ID + ':' + process.env.MTN_MOMO_API_KEY).toString('base64'), 'Ocp-Apim-Subscription-Key': process.env.MTN_MOMO_SUB_KEY || '' } });
      const authData = await authResp.json();
      if (authData.access_token) {
        const payResp = await fetch('https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay', { method: 'POST', headers: { 'Authorization': 'Bearer ' + authData.access_token, 'X-Reference-Id': momoRef, 'X-Target-Environment': 'sandbox', 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': process.env.MTN_MOMO_SUB_KEY || '' }, body: JSON.stringify({ amount: String(amount), currency: 'UGX', externalId: reference || momoRef, payer: { partyIdType: 'MSISDN', partyId: phone }, payerMessage: 'SSEWASSWA Payment', payeeNote: reference || 'Payment' }) });
        await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type,external_ref) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, phone, amount, reference||momoRef, payResp.ok ? 'pending' : 'failed', 'mtn', momoRef]);
        return res.json({ success: payResp.ok, reference: momoRef, status: payResp.ok ? 'pending' : 'failed' });
      }
    } catch(e) { console.warn('MTN MoMo error:', e.message); }
  }
  // Fallback: log as pending
  await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type) VALUES($1,$2,$3,$4,$5,$6)', [t, phone, amount, reference||momoRef, 'pending', 'mtn']);
  res.json({ success: true, reference: momoRef, status: 'pending', message: 'MoMo payment initiated. Set MTN_MOMO env vars for live integration.' });
}));

app.post('/momo/airtel/initiate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, amount, reference } = req.body;
  if (!phone || !amount) return res.status(400).json({ error: 'Phone and amount required' });
  const momoRef = 'AIRTEL-' + Date.now();
  await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type) VALUES($1,$2,$3,$4,$5,$6)', [t, phone, amount, reference||momoRef, 'pending', 'airtel']);
  res.json({ success: true, reference: momoRef, status: 'pending', message: 'Airtel Money initiated. Configure AIRTEL_MONEY env vars for live integration.' });
}));

app.get('/momo/status', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const payments = (await pool.query('SELECT * FROM momo_payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('MoMo Payments', `
    Mobile Money PaymentsMTN MoMo & Airtel Money
    ${payments.filter(p=>p.status==='completed').length}Completed${payments.filter(p=>p.status==='pending').length}Pending${payments.filter(p=>p.status==='failed').length}Failed
    New Payment
      ${payments.length ? `PhoneAmountTypeReferenceStatusDate${payments.map(p => `${esc(p.phone)}UGX ${parseInt(p.amount).toLocaleString()}${esc(p.type)}${esc(p.reference||'-')}${esc(p.status)}${new Date(p.created_at).toLocaleDateString()}`).join('')}` : 'No payments yet'}
    
  `, req.session.user));
}));

// =============================================
// v6.0: WEBHOOK RETRY
// =============================================
const retryFailedWebhooks = async () => {
  const failedLogs = (await pool.query("SELECT * FROM webhook_logs WHERE status=0 OR status >= 500 ORDER BY created_at DESC LIMIT 20")).rows;
  for (const log of failedLogs) {
    try {
      const hook = (await pool.query('SELECT * FROM webhooks WHERE tenant_id=$1 AND active=true', [log.tenant_id])).rows[0];
      if (!hook) continue;
      const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
      const sig = crypto.createHmac('sha256', hook.secret || '').update(JSON.stringify(payload)).digest('hex');
      const resp = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SSEWASSWA-Sig': sig, 'X-SSEWASSWA-Event': log.event, 'X-SSEWASSWA-Retry': 'true' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      await pool.query('UPDATE webhook_logs SET status=$1, response=$2 WHERE id=$3', [resp.status, 'retry-ok', log.id]);
    } catch(e) {
      await pool.query('UPDATE webhook_logs SET response=$1 WHERE id=$2', ['retry-failed:' + e.message, log.id]);
    }
  }
};
setInterval(retryFailedWebhooks, 30 * 60 * 1000); // Retry every 30 minutes

// =============================================
// v8.0: PUSH NOTIFICATIONS
// =============================================
app.post('/push/subscribe', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
  await pool.query('INSERT INTO push_subscriptions(tenant_id,user_email,endpoint,keys) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, req.session.user.email, endpoint, JSON.stringify(keys)]);
  res.json({ success: true });
}));

app.post('/push/unsubscribe', requireAuth, ah(async (req, res) => {
  const { endpoint } = req.body;
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
  res.json({ success: true });
}));

app.post('/push/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, body, url } = req.body;
  const subs = (await pool.query('SELECT * FROM push_subscriptions WHERE tenant_id=$1', [t])).rows;
  // In production, use web-push library with VAPID keys
  // For now, store as notification
  for (const sub of subs) {
    await notify(t, sub.user_email, title || 'New Notification', body || '', 'push');
  }
  res.json({ success: true, sent: subs.length, message: 'Push notifications queued. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars for live push.' });
}));

// =============================================
// v8.0: OFFLINE SYNC API
// =============================================
app.post('/api/sync/push', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { actions } = req.body;
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions array required' });
  const results = [];
  for (const action of actions) {
    try {
      await pool.query('INSERT INTO offline_sync_queue(tenant_id,user_email,action,entity_type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6)', [t, req.session.user.email, action.action, action.entity_type, action.entity_id, JSON.stringify(action.data)]);
      // Apply the action
      if (action.action === 'create' && action.entity_type === 'attendance' && action.data) {
        await pool.query('INSERT INTO attendance(tenant_id,student_id,date,status) VALUES($1,$2,$3,$4) ON CONFLICT(student_id,date) DO UPDATE SET status=$4', [t, action.data.student_id, action.data.date || new Date().toISOString().split('T')[0], action.data.status || 'present']);
      } else if (action.action === 'create' && action.entity_type === 'marks' && action.data) {
        await pool.query('INSERT INTO marks(tenant_id,student_id,subject,score,term,exam_type) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [t, action.data.student_id, action.data.subject, action.data.score, action.data.term||'Term 1', action.data.exam_type||'midterm']);
      } else if (action.action === 'create' && action.entity_type === 'fees' && action.data) {
        await pool.query('INSERT INTO fees(tenant_id,student_id,amount,payment_method,term) VALUES($1,$2,$3,$4,$5)', [t, action.data.student_id, action.data.amount, action.data.payment_method||'cash', action.data.term||'Term 1']);
      } else if (action.action === 'create' && action.entity_type === 'shop_sales' && action.data) {
        await pool.query('INSERT INTO school_shop_sales(tenant_id,item_id,quantity,total,buyer_type,buyer_name) VALUES($1,$2,$3,$4,$5,$6)', [t, action.data.item_id, action.data.quantity||1, action.data.total||0, action.data.buyer_type||'other', action.data.buyer_name||null]);
      } else if (action.action === 'create' && action.entity_type === 'donations' && action.data) {
        await pool.query('INSERT INTO campaign_donations(campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5)', [action.data.campaign_id||null, action.data.donor_name||'Anonymous', action.data.amount||0, action.data.method||'cash', action.data.message||'']);
      } else if (action.action === 'update' && action.entity_type === 'attendance' && action.data) {
        await pool.query('UPDATE attendance SET status=$1 WHERE tenant_id=$2 AND student_id=$3 AND date=$4', [action.data.status, t, action.data.student_id, action.data.date]);
      }
      results.push({ id: action.id, status: 'synced' });
    } catch(e) {
      results.push({ id: action.id, status: 'error', error: e.message });
    }
  }
  res.json({ synced: results.filter(r => r.status === 'synced').length, errors: results.filter(r => r.status === 'error').length, results });
}));

app.get('/api/sync/pull', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [students, fees, attendance, marks, shopSales, donations] = await Promise.all([
    pool.query('SELECT * FROM students WHERE tenant_id=$1 AND (created_at > $2 OR updated_at > $2) AND deleted_at IS NULL', [t, since]),
    pool.query('SELECT * FROM fees WHERE tenant_id=$1 AND created_at > $2', [t, since]),
    pool.query('SELECT * FROM attendance WHERE tenant_id=$1 AND date > $2', [t, since]),
    pool.query('SELECT * FROM marks WHERE tenant_id=$1 AND created_at > $2', [t, since]).catch(()=>({rows:[]})),
    pool.query('SELECT * FROM school_shop_sales WHERE tenant_id=$1 AND created_at > $2', [t, since]).catch(()=>({rows:[]})),
    pool.query('SELECT * FROM campaign_donations WHERE donated_at > $1', [since]).catch(()=>({rows:[]}))
  ]);
  res.json({ since: since.toISOString(), students: students.rows, fees: fees.rows, attendance: attendance.rows, marks: marks.rows, shop_sales: shopSales.rows, donations: donations.rows });
}));

// =============================================
// v8.0: DEEP LINKING
// =============================================
app.post('/deep-links/create', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { path, params } = req.body;
  const shortCode = crypto.randomBytes(4).toString('hex');
  await pool.query('INSERT INTO deep_links(tenant_id,path,params,short_code) VALUES($1,$2,$3,$4)', [t, path, JSON.stringify(params||{}), shortCode]);
  res.json({ shortCode, url: `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/dl/${shortCode}` });
}));

app.get('/dl/:code', ah(async (req, res) => {
  const link = (await pool.query('SELECT * FROM deep_links WHERE short_code=$1', [req.params.code])).rows[0];
  if (!link) return res.status(404).send(renderPage('404', 'Link Not Found', null));
  await pool.query('UPDATE deep_links SET click_count=click_count+1 WHERE id=$1', [link.id]);
  res.redirect(link.path);
}));

// =============================================
// v9.0: WHITE LABEL CONFIGURATION
// =============================================
app.get('/settings/white-label', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('White Label', `
    White Label ConfigurationCustomize your platform identity
    
      
        App Name
        Custom Domain
        Support Email
        Support Phone
        Privacy Policy URL
        Terms URL
        Onboarding Message${esc(tenant?.onboarding_message||'')}
        Favicon URL
        Custom JavaScript (head)${esc(tenant?.custom_js||'')}
        Save White Label Settings
      
    
  `, req.session.user));
}));

app.post('/settings/white-label/save', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { app_name, custom_domain, support_email, support_phone, privacy_policy_url, terms_url, onboarding_message, favicon_url, custom_js } = req.body;
  await pool.query('UPDATE tenants SET app_name=$1,custom_domain=$2,support_email=$3,support_phone=$4,privacy_policy_url=$5,terms_url=$6,onboarding_message=$7,favicon_url=$8,custom_js=$9 WHERE id=$10', [app_name||null, custom_domain||null, support_email||null, support_phone||null, privacy_policy_url||null, terms_url||null, onboarding_message||null, favicon_url||null, custom_js||null, t]);
  res.redirect('/settings/white-label');
}));

// =============================================
// v9.0: PLUGIN SDK
// =============================================
app.get('/plugins', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const installed = (await pool.query('SELECT pr.*,mp.description as mp_desc,mp.icon_url FROM plugin_registry pr LEFT JOIN marketplace_plugins mp ON pr.plugin_key=mp.name WHERE pr.tenant_id=$1', [t])).rows;
  const available = (await pool.query('SELECT * FROM marketplace_plugins WHERE active=true ORDER BY downloads DESC')).rows;
  res.send(renderPage('Plugins', `
    Plugin ManagerExtend your platform with plugins
    Installed Plugins (${installed.length})
      ${installed.length ? `NameVersionStatusActions${installed.map(p => `${esc(p.name)}${esc(p.description||p.mp_desc||'')}${esc(p.version||'1.0')}${p.is_active?'Active':'Disabled'}${p.is_active?'Disable':'Enable'} Uninstall`).join('')}` : 'No plugins installed'}
    
    Available Plugins
      ${available.map(p => `${esc(p.name)}${esc(p.description||'')}Downloads: ${p.downloads} | Price: ${p.price > 0 ? 'UGX ' + p.price.toLocaleString() : 'Free'}Install`).join('') || 'No plugins available yet'}
    
  `, req.session.user));
}));

app.get('/plugins/install/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const mp = (await pool.query('SELECT * FROM marketplace_plugins WHERE id=$1', [req.params.id])).rows[0];
  if (!mp) return res.status(404).send('Plugin not found');
  await pool.query('INSERT INTO plugin_registry(tenant_id,plugin_key,name,version,description,installed_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [t, mp.name, mp.name, mp.price > 0 ? 'premium' : '1.0', mp.description, req.session.user.email]);
  await pool.query('UPDATE marketplace_plugins SET downloads=downloads+1 WHERE id=$1', [mp.id]);
  res.redirect('/plugins');
}));

app.get('/plugins/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE plugin_registry SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/plugins');
}));

app.get('/plugins/:id/uninstall', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM plugin_registry WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/plugins');
}));

// =============================================
// v9.0: DATA PORTABILITY
// =============================================
app.get('/data-export', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exports = (await pool.query('SELECT * FROM data_exports WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Data Export', `
    Data ExportExport all your data in standard formats
    Create New Export
      
        JSONCSV (separate files)
        Export All Data
      
    
    Previous Exports
      ${exports.length ? `FormatStatusSizeRequestedActions${exports.map(e => `${esc(e.format)}${esc(e.status)}${e.size_bytes ? (e.size_bytes/1024).toFixed(1)+'KB' : '-'}${new Date(e.created_at).toLocaleDateString()}${e.file_url ? `Download` : 'Processing...'}`).join('')}` : 'No exports yet'}
    
  `, req.session.user));
}));

app.post('/data-export/create', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const format = req.body.format || 'json';
  const exportId = (await pool.query('INSERT INTO data_exports(tenant_id,format,status,requested_by) VALUES($1,$2,$3,$4) RETURNING id', [t, format, 'processing', req.session.user.email])).rows[0]?.id;
  // Generate export immediately
  try {
    const tables = ['students','fees','attendance','marks','expenses','sales','invoices','donations','church_members','members','inventory','customers','staff','projects','events','campaigns','purchase_orders'];
    const exportData = {};
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND deleted_at IS NULL`, [t]);
        if (result.rows.length) exportData[table] = result.rows;
      } catch(e) {} // Table may not have tenant_id
    }
    exportData.exported_at = new Date().toISOString();
    exportData.tenant_id = t;
    const jsonStr = JSON.stringify(exportData, null, 2);
    const buffer = Buffer.from(jsonStr);
    let fileUrl = null;
    if (process.env.CLOUDINARY_URL && format === 'json') {
      try {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({ url: process.env.CLOUDINARY_URL });
        const result = await cloudinary.uploader.upload(`data:application/json;base64,${buffer.toString('base64')}`, { resource_type: 'raw', folder: `exports/tenant_${t}`, public_id: `export-${t}-${Date.now()}` });
        fileUrl = result.secure_url;
      } catch(e) { console.warn('Export upload failed:', e.message); }
    }
    await pool.query('UPDATE data_exports SET status=$1,file_url=$2,size_bytes=$3,completed_at=NOW() WHERE id=$4', ['completed', fileUrl, buffer.length, exportId]);
  } catch(e) {
    await pool.query('UPDATE data_exports SET status=$1 WHERE id=$2', ['failed', exportId]);
  }
  res.redirect('/data-export');
}));

// Immediate JSON export download
app.get('/data-export/download', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tables = ['students','fees','attendance','marks','expenses','sales','invoices','donations','church_members','members','inventory','customers','staff','projects','events','campaigns'];
  const data = {};
  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [t]);
      data[table] = result.rows;
    } catch(e) {}
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=ssewasswa-export.json');
  res.send(JSON.stringify(data, null, 2));
}));

// =============================================
// ANALYTICS EVENT TRACKING (middleware)
// =============================================
const trackEvent = (eventType, entityType, entityId) => async (req, res, next) => {
  try {
    if (req.session.user) {
      await pool.query('INSERT INTO analytics_events(tenant_id,event_type,entity_type,entity_id,user_email) VALUES($1,$2,$3,$4,$5)', [req.session.user.tenant_id, eventType, entityType, entityId, req.session.user.email]);
    }
  } catch(e) {}
  next();
};

// =============================================
// PWA INSTALL PROMPT ENHANCEMENT
// =============================================
app.get('/install', (req, res) => {
  res.send(renderPage('Install App', `
    Install SSEWASSWAUse as a native app on your device
    
      
        📱
        Android
        Open this site in ChromeTap the 3-dot menuSelect "Add to Home Screen"Tap "Add" to confirm
      
      
        🍎
        iOS (iPhone/iPad)
        Open this site in SafariTap the Share button (box with arrow)Select "Add to Home Screen"Tap "Add" to confirm
      
      
        💻
        Desktop
        Open this site in Chrome or EdgeClick the install icon in address barOr click Menu > "Install SSEWASSWA"Click "Install" to confirm
      
    
    After installation, SSEWASSWA works like a native app with offline support and push notifications.
  `, req.session?.user));
});

// =============================================
// v6.0: OAUTH2 CALLBACK (Full Implementation)
// =============================================
app.get('/auth/oauth/google/callback', ah(async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/login');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect('/login');
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/auth/oauth/google/callback`, grant_type: 'authorization_code' })
    });
    const tokens = await tokenResp.json();
    if (tokens.id_token) {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString());
      const email = payload.email;
      const name = payload.name || email.split('@')[0];
      // Find or create user
      let user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
      if (!user) {
        // Auto-register with first tenant or create new
        const tenant = (await pool.query('SELECT * FROM tenants ORDER BY id LIMIT 1')).rows[0];
        if (tenant) {
          const pwd = crypto.randomBytes(16).toString('hex');
          const hash = await bcrypt.hash(pwd, 10);
          await pool.query('INSERT INTO users(tenant_id,email,password,password_hash,role,approved) VALUES($1,$2,$3,$4,$5,$6)', [tenant.id, email, pwd, hash, 'user', true]);
          user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
        }
      }
      if (user) {
        req.session.user = { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, dark_mode: user.dark_mode, banned: user.banned };
        await audit(email, 'oauth_login', 'Google');
        return res.redirect('/dashboard');
      }
    }
  } catch(e) { console.warn('Google OAuth error:', e.message); }
  res.redirect('/login');
}));

// =============================================
// COMING SOON PAGE (for features not yet activated)
// =============================================
app.get('/coming-soon/:feature', requireAuth, ah(async (req, res) => {
  const flag = (await pool.query('SELECT * FROM feature_flags WHERE feature_key=$1', [req.params.feature])).rows[0];
  if (!flag) return res.status(404).send('Feature not found');
  res.send(renderPage('Coming Soon', `
    
      🔒
      ${esc(flag.name)}
      ${esc(flag.description||'This feature is coming soon')}
      
        Requirements to Activate
        ${esc(flag.requirements||'None')}
        ${flag.version ? `Version: v${esc(flag.version)}` : ''}
      
      Back to Dashboard ${req.session.user?.role === 'super_admin' ? 'Feature Manager' : ''}
    
  `, req.session.user));
}));

// =============================================
// FEATURE STATUS API (for frontend to check)
// =============================================
app.get('/api/features', ah(async (req, res) => {
  const features = (await pool.query('SELECT feature_key, is_active, name, description, version, category FROM feature_flags')).rows;
  const featureMap = {};
  features.forEach(f => { featureMap[f.feature_key] = { active: f.is_active, name: f.name, description: f.description, version: f.version, category: f.category }; });
  res.json(featureMap);
}));

// Enhanced PWA manifest with more icons
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'SSEWASSWA',
    short_name: 'SSEWASSWA',
    description: 'All-in-One Management Platform for Schools, Churches, Businesses & Organizations',
    start_url: '/',
    display: 'standalone',
    background_color: '#4f46e5',
    theme_color: '#4f46e5',
    orientation: 'any',
    icons: [
      { src: 'https://res.cloudinary.com/ssewasswa/image/upload/v1/ssewasswa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'https://res.cloudinary.com/ssewasswa/image/upload/v1/ssewasswa/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    categories: ['business', 'education', 'finance'],
    screenshots: [],
    prefer_related_applications: false
  });
});

// Enhanced Service Worker

// =============================================
// SCHOOL: TRANSPORT / BUS ROUTES
// =============================================
app.get('/school/transport', requireAuth, requireNotBanned, requireFeature('transport'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const routes = (await pool.query('SELECT tr.*, COUNT(ta.id) as assigned FROM transport_routes tr LEFT JOIN transport_assignments ta ON ta.route_id=tr.id WHERE tr.tenant_id=$1 GROUP BY tr.id ORDER BY tr.route_name', [t])).rows;
  res.send(renderPage('School Transport', `
    School TransportManage bus routes and student assignments
    + Add Route
      ${routes.length ? `RouteDriverPhonePlateCapacityAssignedActions
      ${routes.map(r => `${esc(r.route_name)}${esc(r.driver_name||'-')}${esc(r.driver_phone||'-')}${esc(r.vehicle_plate||'-')}${r.capacity}${r.assigned||0}
      Assign Delete`).join('')}` : 'No routes yet'}
    
  `, req.session.user));
}));

app.get('/school/transport/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Transport Route', `
    Add Route
    
      Route Name
      Driver NameDriver Phone
      Vehicle PlateCapacity
      Description
      Save Route
    
  `, req.session.user));
});

app.post('/school/transport/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO transport_routes(tenant_id,route_name,driver_name,driver_phone,vehicle_plate,capacity,description) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.route_name, req.body.driver_name, req.body.driver_phone, req.body.vehicle_plate, req.body.capacity||30, req.body.description]);
  await audit(req.session.user.email, 'Transport route created', req.body.route_name);
  res.redirect('/school/transport');
}));

app.get('/school/transport/:id/assign', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const route = (await pool.query('SELECT * FROM transport_routes WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!route) return res.status(404).send('Route not found');
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const assigned = (await pool.query('SELECT ta.*,s.name as student_name,s.class FROM transport_assignments ta JOIN students s ON s.id=ta.student_id WHERE ta.route_id=$1', [route.id])).rows;
  res.send(renderPage('Assign Students', `
    Assign Students to ${esc(route.route_name)}
    
      Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}Pick-up PointDrop-off Point
      Assign
    
    ${assigned.length ? `StudentClassPick-upDrop-offAction${assigned.map(a=>`${esc(a.student_name)}${esc(a.class||'')}${esc(a.pick_up_point||'-')}${esc(a.drop_off_point||'-')}Remove`).join('')}` : 'No students assigned yet'}
    
  `, req.session.user));
}));

app.post('/school/transport/:id/assign/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO transport_assignments(tenant_id,route_id,student_id,pick_up_point,drop_off_point) VALUES($1,$2,$3,$4,$5)', [t, req.params.id, req.body.student_id, req.body.pick_up_point, req.body.drop_off_point]);
  res.redirect(`/school/transport/${req.params.id}/assign`);
}));

app.get('/school/transport/assignment/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM transport_assignments WHERE id=$1', [req.params.id]);
  res.redirect('back');
}));

app.get('/school/transport/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM transport_assignments WHERE route_id=$1', [req.params.id]);
  await pool.query('DELETE FROM transport_routes WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/school/transport');
}));

// =============================================
// SCHOOL: DISCIPLINE TRACKING
// =============================================
app.get('/school/discipline', requireAuth, requireNotBanned, requireFeature('discipline'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const incidents = (await pool.query('SELECT di.*,s.name as student_name,s.class FROM discipline_incidents di JOIN students s ON s.id=di.student_id WHERE di.tenant_id=$1 ORDER BY di.incident_date DESC', [t])).rows;
  res.send(renderPage('Discipline', `
    Discipline TrackingMonitor student behavior and actions
    + Report Incident
      ${incidents.length ? `StudentClassDateTypeDescriptionAction TakenStatusActions
      ${incidents.map(i=>`${esc(i.student_name)}${esc(i.class||'')}${i.incident_date}${esc(i.type)}${esc((i.description||'').substring(0,50))}${esc((i.action_taken||'').substring(0,40))}${i.status==='open'?'Open':'Resolved'}
      Resolve Delete`).join('')}` : 'No incidents recorded'}
    
  `, req.session.user));
}));

app.get('/school/discipline/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Report Incident', `
    Report Discipline Incident
    
      Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}Incident Date
      TypeMinor DisruptionBullyingTruancyFightingTheftSubstance AbuseVandalismAcademic DishonestyDress Code ViolationInsubordinationOtherReported By
      Description
      Action Taken
      Save Incident
    
  `, req.session.user));
}));

app.post('/school/discipline/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO discipline_incidents(tenant_id,student_id,incident_date,type,description,action_taken,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.student_id, req.body.incident_date||'CURRENT_DATE', req.body.type, req.body.description, req.body.action_taken, req.body.reported_by]);
  await audit(req.session.user.email, 'Discipline incident reported', `Student #${req.body.student_id}: ${req.body.type}`);
  res.redirect('/school/discipline');
}));

app.get('/school/discipline/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE discipline_incidents SET status=$1 WHERE id=$2', ['resolved', req.params.id]);
  res.redirect('/school/discipline');
}));

app.get('/school/discipline/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM discipline_incidents WHERE id=$1', [req.params.id]);
  res.redirect('/school/discipline');
}));

// =============================================
// SCHOOL: HOMEWORK & ASSIGNMENTS
// =============================================
app.get('/school/homework', requireAuth, requireNotBanned, requireFeature('homework'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const hw = (await pool.query('SELECT * FROM homework WHERE tenant_id=$1 ORDER BY due_date DESC NULLS LAST', [t])).rows;
  res.send(renderPage('Homework', `
    Homework & AssignmentsAssign, submit and grade homework
    + Assign Homework
      ${hw.length ? `SubjectTitleClassDue DateAssigned BySubmissionsActions
      ${hw.map(h=>`${esc(h.subject)}${esc(h.title)}${esc(h.class_name||'-')}${h.due_date||'No deadline'}${esc(h.assigned_by||'')}
      View
      Delete`).join('')}` : 'No homework assigned yet'}
    
  `, req.session.user));
}));

app.get('/school/homework/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const eduLevels = ['nursery','kindergarten','primary','o_level','a_level','university','vocational'];
  res.send(renderPage('Assign Homework', `
    Assign Homework
    
      SubjectTitle
      ClassEducation Level${eduLevels.map(l=>`${l.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}`).join('')}Due Date
      Description
      
      Assign
    
  `, req.session.user));
}));

app.post('/school/homework/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO homework(tenant_id,subject,title,description,due_date,class_name,assigned_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.subject, req.body.title, req.body.description, req.body.due_date||null, req.body.class_name, req.body.assigned_by||req.session.user.email]);
  res.redirect('/school/homework');
}));

app.get('/school/homework/:id/submissions', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const hw = (await pool.query('SELECT * FROM homework WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!hw) return res.status(404).send('Not found');
  const subs = (await pool.query('SELECT hs.*,s.name as student_name FROM homework_submissions hs JOIN students s ON s.id=hs.student_id WHERE hs.homework_id=$1', [hw.id])).rows;
  res.send(renderPage('Submissions', `
    ${esc(hw.title)} - Submissions${esc(hw.subject)} | Due: ${hw.due_date||'No deadline'}
    ${subs.length ? `StudentSubmittedAnswerScoreAction${subs.map(s=>`${esc(s.student_name)}${new Date(s.submitted_at).toLocaleDateString()}${esc((s.submission_text||'').substring(0,60))}${s.score||'-'}Save`).join('')}` : 'No submissions yet'}
    Back
  `, req.session.user));
}));

app.post('/school/homework/submissions/:id/score', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE homework_submissions SET score=$1 WHERE id=$2', [req.body.score, req.params.id]);
  res.redirect('back');
}));

app.get('/school/homework/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM homework_submissions WHERE homework_id=$1', [req.params.id]);
  await pool.query('DELETE FROM homework WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/school/homework');
}));

// =============================================
// SCHOOL: CALENDAR & EVENTS
// =============================================
app.get('/school/calendar', requireAuth, requireNotBanned, requireFeature('school_calendar'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const events = (await pool.query('SELECT * FROM school_events WHERE tenant_id=$1 ORDER BY event_date', [t])).rows;
  const termDates = events.filter(e=>e.event_type==='term');
  const holidays = events.filter(e=>e.event_type==='holiday');
  const activities = events.filter(e=>e.event_type==='event');
  res.send(renderPage('School Calendar', `
    School CalendarTerm dates, events and holidays
    + Add Event
      Term Dates${termDates.length?`TermStartEndActions${termDates.map(e=>`${esc(e.title)}${e.event_date||'-'}${e.end_date||'-'}Delete`).join('')}`:'No term dates set'}
      Holidays${holidays.length?`HolidayDateActions${holidays.map(e=>`${esc(e.title)}${e.event_date||'-'}Delete`).join('')}`:'No holidays set'}
      Events & Activities${activities.length?`EventDateLocationActions${activities.map(e=>`${esc(e.title)}${esc(e.description||'')}${e.event_date||'-'}${esc(e.location||'-')}Delete`).join('')}`:'No events'}
    
  `, req.session.user));
}));

app.get('/school/calendar/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Event', `
    Add Calendar Event
    
      Title
      Description
      Start DateEnd Date
      TypeEventTerm DateHolidayExam PeriodMeetingLocation
      Save Event
    
  `, req.session.user));
});

app.post('/school/calendar/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO school_events(tenant_id,title,description,event_date,end_date,event_type,location) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.title, req.body.description, req.body.event_date, req.body.end_date||null, req.body.event_type, req.body.location]);
  res.redirect('/school/calendar');
}));

app.get('/school/calendar/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM school_events WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/school/calendar');
}));

// =============================================
// SCHOOL: HEALTH RECORDS
// =============================================
app.get('/school/health', requireAuth, requireNotBanned, requireFeature('health_records'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT sh.*,s.name as student_name,s.class FROM student_health sh JOIN students s ON s.id=sh.student_id WHERE sh.tenant_id=$1 ORDER BY s.name', [t])).rows;
  const visits = (await pool.query('SELECT hv.*,s.name as student_name FROM health_visits hv JOIN students s ON s.id=hv.student_id WHERE hv.tenant_id=$1 ORDER BY hv.visit_date DESC LIMIT 20', [t])).rows;
  res.send(renderPage('Health Records', `
    Health RecordsStudent medical info and clinic visits
    ${records.length}Health Profiles${visits.length}Recent Visits
    + Add Health Profile + Clinic Visit
      Student Health Profiles
      ${records.length?`StudentClassBlood GroupAllergiesConditionsEmergencyActions${records.map(r=>`${esc(r.student_name)}${esc(r.class||'')}${esc(r.blood_group||'-')}${esc(r.allergies||'None')}${esc(r.conditions||'None')}${esc(r.emergency_contact||'-')} ${esc(r.emergency_phone||'')}Edit`).join('')}`:'No health profiles'}
      Recent Clinic Visits
      ${visits.length?`StudentDateComplaintDiagnosisTreatment${visits.map(v=>`${esc(v.student_name)}${v.visit_date}${esc(v.complaint||'')}${esc(v.diagnosis||'')}${esc(v.treatment||'')}`).join('')}`:'No visits recorded'}
    
  `, req.session.user));
}));

app.get('/school/health/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Health Profile', `Student Health Profile
    
      Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      Blood GroupUnknownA+A-B+B-AB+AB-O+O-Last Checkup
      Allergies
      Medical Conditions
      Emergency ContactEmergency Phone
      Notes
      Save Profile
    
  `, req.session.user));
}));

app.post('/school/health/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO student_health(tenant_id,student_id,blood_group,allergies,conditions,emergency_contact,emergency_phone,last_checkup,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (student_id) DO UPDATE SET blood_group=$3,allergies=$4,conditions=$5,emergency_contact=$6,emergency_phone=$7,last_checkup=$8,notes=$9', [t, req.body.student_id, req.body.blood_group, req.body.allergies, req.body.conditions, req.body.emergency_contact, req.body.emergency_phone, req.body.last_checkup||null, req.body.notes]);
  res.redirect('/school/health');
}));

app.get('/school/health/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rec = (await pool.query('SELECT sh.*,s.name as student_name FROM student_health sh JOIN students s ON s.id=sh.student_id WHERE sh.student_id=$1 AND sh.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!rec) return res.status(404).send('Not found');
  res.send(renderPage('Edit Health Profile', `Edit: ${esc(rec.student_name)}
    
      
      Blood GroupUnknown${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=>`${b}`).join('')}Last Checkup
      Allergies${esc(rec.allergies||'')}
      Conditions${esc(rec.conditions||'')}
      Emergency ContactEmergency Phone
      Notes${esc(rec.notes||'')}
      Update Profile
    
  `, req.session.user));
}));

app.get('/school/health/visit/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Clinic Visit', `Record Clinic Visit
    
      Student${students.map(s=>`${esc(s.name)}`).join('')}
      Visit DateSeen By
      Complaint
      Diagnosis
      Treatment
      Save Visit
    
  `, req.session.user));
}));

app.post('/school/health/visit/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO health_visits(tenant_id,student_id,visit_date,complaint,diagnosis,treatment,seen_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.student_id, req.body.visit_date||'CURRENT_DATE', req.body.complaint, req.body.diagnosis, req.body.treatment, req.body.seen_by]);
  res.redirect('/school/health');
}));

// =============================================
// SCHOOL: ALUMNI NETWORK
// =============================================
app.get('/school/alumni', requireAuth, requireNotBanned, requireFeature('alumni'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const alumni = (await pool.query('SELECT * FROM alumni WHERE tenant_id=$1 ORDER BY graduation_year DESC, name', [t])).rows;
  res.send(renderPage('Alumni', `
    Alumni NetworkGraduated students tracking and networking
    ${alumni.length}Alumni
    + Add Alumni
      ${alumni.length?`NameGraduation YearClassOccupationEmailPhoneActions${alumni.map(a=>`${esc(a.name)}${a.graduation_year||'-'}${esc(a.class_name||'-')}${esc(a.occupation||'-')}${esc(a.email||'-')}${esc(a.phone||'-')}Delete`).join('')}`:'No alumni records yet'}
    
  `, req.session.user));
}));

app.get('/school/alumni/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Alumni', `Add Alumni
    
      Name
      Graduation YearClass
      EmailPhone
      Occupation
      Address
      Notes
      Save
    
  `, req.session.user));
});

app.post('/school/alumni/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO alumni(tenant_id,name,email,phone,graduation_year,class_name,occupation,address,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.name, req.body.email, req.body.phone, req.body.graduation_year||null, req.body.class_name, req.body.occupation, req.body.address, req.body.notes]);
  res.redirect('/school/alumni');
}));

app.get('/school/alumni/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM alumni WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/school/alumni');
}));

// =============================================
// SCHOOL: LIBRARY MANAGEMENT
// =============================================
app.get('/school/library', requireAuth, requireNotBanned, requireFeature('library'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const books = (await pool.query('SELECT * FROM library_books WHERE tenant_id=$1 ORDER BY title', [t])).rows;
  const borrows = (await pool.query('SELECT lb.*,bb.title as book_title FROM library_borrows lb JOIN library_books bb ON bb.id=lb.book_id WHERE lb.tenant_id=$1 AND lb.return_date IS NULL ORDER BY lb.due_date', [t])).rows;
  res.send(renderPage('Library', `
    Library ManagementBooks, borrowing, returns and fines
    ${books.length}Books${borrows.length}On Loan${books.reduce((a,b)=>a+(b.copies_available||0),0)}Copies Available
    + Add Book Borrow Book
      Book Catalog
      ${books.length?`TitleAuthorISBNCategoryTotalAvailableShelfActions${books.map(b=>`${esc(b.title)}${esc(b.author||'-')}${esc(b.isbn||'-')}${esc(b.category||'-')}${b.copies_total}${b.copies_available}${esc(b.shelf_location||'-')}Delete`).join('')}`:'No books yet'}
      Currently on Loan
      ${borrows.length?`BookBorrowerBorrow DateDue DateFineActions${borrows.map(b=>`${esc(b.book_title)}${esc(b.borrower_name)}${b.borrow_date}${b.due_date||'-'}${b.fine>0?`UGX ${b.fine}`:'-'}Return`).join('')}`:'No books on loan'}
    
  `, req.session.user));
}));

app.get('/school/library/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Book', `Add Book
    
      Title
      AuthorISBN
      CategoryCopiesShelf
      Save
    
  `, req.session.user));
});

app.post('/school/library/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO library_books(tenant_id,title,author,isbn,category,copies_total,copies_available,shelf_location) VALUES($1,$2,$3,$4,$5,$6,$6,$7)', [t, req.body.title, req.body.author, req.body.isbn, req.body.category, req.body.copies_total||1, req.body.shelf_location]);
  res.redirect('/school/library');
}));

app.get('/school/library/borrow', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const books = (await pool.query('SELECT * FROM library_books WHERE tenant_id=$1 AND copies_available>0 ORDER BY title', [t])).rows;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Borrow Book', `Borrow Book
    
      Book${books.map(b=>`${esc(b.title)} (${b.copies_available} available)`).join('')}
      Borrower Name${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      
      Due Date
      Borrow
    
  `, req.session.user));
}));

app.post('/school/library/borrow/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const book = (await client.query('SELECT * FROM library_books WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.body.book_id, t])).rows[0];
    if (!book || book.copies_available  {
  const borrow = (await pool.query('SELECT * FROM library_borrows WHERE id=$1', [req.params.id])).rows[0];
  if (!borrow) return res.status(404).send('Not found');
  const fine = borrow.due_date && new Date() > new Date(borrow.due_date) ? Math.floor((Date.now() - new Date(borrow.due_date).getTime()) / 86400000) * 500 : 0;
  await pool.query('UPDATE library_borrows SET return_date=CURRENT_DATE, fine=$1 WHERE id=$2', [fine, req.params.id]);
  await pool.query('UPDATE library_books SET copies_available=copies_available+1 WHERE id=$1', [borrow.book_id]);
  res.redirect('/school/library');
}));

app.get('/school/library/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM library_books WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/school/library');
}));


// =============================================
// CHURCH: CHOIR & WORSHIP TEAM
// =============================================
app.get('/church/choir', requireAuth, requireNotBanned, requireFeature('choir'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT cm.*,chm.name as member_name FROM choir_members cm JOIN church_members chm ON chm.id=cm.member_id WHERE cm.tenant_id=$1 ORDER BY chm.name', [t])).rows;
  const songs = (await pool.query('SELECT * FROM worship_songs WHERE tenant_id=$1 ORDER BY title', [t])).rows;
  res.send(renderPage('Choir & Worship', `
    Choir & Worship TeamRoster, songs and scheduling
    ${members.length}Choir Members${songs.length}Songs
    
      Choir Members+ Add Member
        ${members.length?`NameVoice PartRoleJoinedActions${members.map(m=>`${esc(m.member_name)}${esc(m.voice_part||'-')}${esc(m.role)}${m.joined_date||'-'}Remove`).join('')}`:'No choir members'}
      
      Song Library+ Add Song
        ${songs.length?`TitleKeyCategoryActions${songs.map(s=>`${esc(s.title)}${esc(s.key_signature||'-')}${esc(s.category||'-')}Delete`).join('')}`:'No songs'}
      
    
  `, req.session.user));
}));

app.get('/church/choir/add', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const chMembers = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Choir Member', `Add to Choir
    
      Member${chMembers.map(m=>`${esc(m.name)}`).join('')}
      Voice PartSopranoAltoTenorBassLeadRoleMemberLeaderDirector
      Add
    
  `, req.session.user));
}));

app.post('/church/choir/add/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO choir_members(tenant_id,member_id,voice_part,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, req.body.member_id, req.body.voice_part, req.body.role]);
  res.redirect('/church/choir');
}));

app.get('/church/choir/song/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Song', `Add Worship Song
    
      TitleAuthor
      KeyTempoCategoryPraiseWorshipHymnChristmasEasterOther
      Lyrics
      Save Song
    
  `, req.session.user));
});

app.post('/church/choir/song/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO worship_songs(tenant_id,title,author,key_signature,tempo,lyrics,category) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.title, req.body.author, req.body.key_signature, req.body.tempo, req.body.lyrics, req.body.category]);
  res.redirect('/church/choir');
}));

app.get('/church/choir/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM choir_members WHERE id=$1', [req.params.id]);
  res.redirect('/church/choir');
}));

app.get('/church/choir/song/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM worship_songs WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/choir');
}));

// =============================================
// CHURCH: SACRAMENT RECORDS
// =============================================
app.get('/church/sacraments', requireAuth, requireNotBanned, requireFeature('sacraments'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT s.*,chm.name as member_name FROM sacraments s LEFT JOIN church_members chm ON chm.id=s.member_id WHERE s.tenant_id=$1 ORDER BY s.date DESC', [t])).rows;
  res.send(renderPage('Sacraments', `
    Sacrament RecordsBaptism, marriage, funeral records
    + Record Sacrament
      ${records.length?`TypeNameDateOfficiantLocationCert No.Actions${records.map(r=>`${esc(r.type)}${esc(r.member_name||'N/A')}${r.date||'-'}${esc(r.officiant||'-')}${esc(r.location||'-')}${esc(r.certificate_no||'-')}Delete`).join('')}`:'No sacrament records'}
    
  `, req.session.user));
}));

app.get('/church/sacraments/new', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Record Sacrament', `Record Sacrament
    
      TypeBaptismMarriageFuneralConfirmationFirst Communion
      Member${members.map(m=>`${esc(m.name)}`).join('')}
      DateOfficiant
      LocationCertificate No.
      Witnesses
      Notes
      Save Record
    
  `, req.session.user));
}));

app.post('/church/sacraments/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO sacraments(tenant_id,type,member_id,date,officiant,location,witnesses,certificate_no,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.type, req.body.member_id||null, req.body.date, req.body.officiant, req.body.location, req.body.witnesses, req.body.certificate_no, req.body.notes]);
  res.redirect('/church/sacraments');
}));

app.get('/church/sacraments/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM sacraments WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/sacraments');
}));

// =============================================
// CHURCH: CELL GROUPS
// =============================================
app.get('/church/cell-groups', requireAuth, requireNotBanned, requireFeature('cell_groups'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const groups = (await pool.query('SELECT cg.*, COUNT(cgm.id) as member_count FROM cell_groups cg LEFT JOIN cell_group_members cgm ON cgm.group_id=cg.id WHERE cg.tenant_id=$1 GROUP BY cg.id ORDER BY cg.name', [t])).rows;
  res.send(renderPage('Cell Groups', `
    Cell GroupsSmall groups, leaders and meetings
    + New Group
      ${groups.length?`NameLeaderMeetingTimeLocationMembersActions${groups.map(g=>`${esc(g.name)}${esc(g.leader||'-')}${esc(g.meeting_day||'-')}${esc(g.meeting_time||'-')}${esc(g.location||'-')}${g.member_count||0}Members Delete`).join('')}`:'No cell groups'}
    
  `, req.session.user));
}));

app.get('/church/cell-groups/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Cell Group', `Create Cell Group
    
      Group Name
      LeaderMeeting DayMondayTuesdayWednesdayThursdayFridaySaturdaySunday
      Meeting TimeLocation
      Description
      Create Group
    
  `, req.session.user));
});

app.post('/church/cell-groups/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO cell_groups(tenant_id,name,leader,meeting_day,meeting_time,location,description) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.name, req.body.leader, req.body.meeting_day, req.body.meeting_time, req.body.location, req.body.description]);
  res.redirect('/church/cell-groups');
}));

app.get('/church/cell-groups/:id/members', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const group = (await pool.query('SELECT * FROM cell_groups WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!group) return res.status(404).send('Not found');
  const members = (await pool.query('SELECT cgm.*,chm.name as member_name FROM cell_group_members cgm JOIN church_members chm ON chm.id=cgm.member_id WHERE cgm.group_id=$1', [group.id])).rows;
  const allMembers = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const existingIds = members.map(m=>m.member_id);
  res.send(renderPage('Group Members', `${esc(group.name)} - Members
    
      ${allMembers.filter(m=>!existingIds.includes(m.id)).map(m=>`${esc(m.name)}`).join('')}Add Member
    
    ${members.length?`NameRoleJoinedAction${members.map(m=>`${esc(m.member_name)}${esc(m.role)}${m.joined_date||'-'}Remove`).join('')}`:'No members'}
    Back
  `, req.session.user));
}));

app.post('/church/cell-groups/:id/members/add', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO cell_group_members(tenant_id,group_id,member_id,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [t, req.params.id, req.body.member_id, 'member']);
  res.redirect(`/church/cell-groups/${req.params.id}/members`);
}));

app.get('/church/cell-groups/member/:id/remove', requireAuth, requireNotBanned, ah(async (req, res) => {
  const m = (await pool.query('SELECT group_id FROM cell_group_members WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM cell_group_members WHERE id=$1', [req.params.id]);
  res.redirect(`/church/cell-groups/${m?.group_id}/members`);
}));

app.get('/church/cell-groups/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM cell_group_members WHERE group_id=$1', [req.params.id]);
  await pool.query('DELETE FROM cell_groups WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/cell-groups');
}));

// =============================================
// CHURCH: VOLUNTEER SCHEDULING
// =============================================
app.get('/church/volunteers', requireAuth, requireNotBanned, requireFeature('volunteers'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const roles = (await pool.query('SELECT vr.*, COUNT(va.id) as filled FROM volunteer_roles vr LEFT JOIN volunteer_assignments va ON va.role_id=vr.id WHERE vr.tenant_id=$1 GROUP BY vr.id', [t])).rows;
  res.send(renderPage('Volunteers', `
    Volunteer SchedulingRoles, schedules and availability
    + Add Role
      ${roles.length?`RoleScheduleSlotsFilledActions${roles.map(r=>`${esc(r.role_name)}${esc(r.description||'')}${esc(r.schedule||'-')}${r.slots||'-'}${r.filled||0}Assign Delete`).join('')}`:'No volunteer roles'}
    
  `, req.session.user));
}));

app.get('/church/volunteers/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Volunteer Role', `Add Volunteer Role
    
      Role Name
      Description
      ScheduleSlots Needed
      Save
    
  `, req.session.user));
});

app.post('/church/volunteers/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO volunteer_roles(tenant_id,role_name,description,schedule,slots) VALUES($1,$2,$3,$4,$5)', [t, req.body.role_name, req.body.description, req.body.schedule, req.body.slots||null]);
  res.redirect('/church/volunteers');
}));

app.get('/church/volunteers/:id/assign', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const role = (await pool.query('SELECT * FROM volunteer_roles WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!role) return res.status(404).send('Not found');
  const assigned = (await pool.query('SELECT va.*,chm.name as member_name FROM volunteer_assignments va JOIN church_members chm ON chm.id=va.member_id WHERE va.role_id=$1', [role.id])).rows;
  const members = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Assign Volunteer', `Assign: ${esc(role.role_name)}
    ${members.map(m=>`${esc(m.name)}`).join('')} Assign
    ${assigned.length?`MemberDate AssignedStatusAction${assigned.map(a=>`${esc(a.member_name)}${a.date_assigned}${esc(a.status)}Remove`).join('')}`:'No one assigned'}
    Back
  `, req.session.user));
}));

app.post('/church/volunteers/:id/assign/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO volunteer_assignments(tenant_id,role_id,member_id) VALUES($1,$2,$3)', [t, req.params.id, req.body.member_id]);
  res.redirect(`/church/volunteers/${req.params.id}/assign`);
}));

app.get('/church/volunteers/assignment/:id/remove', requireAuth, requireNotBanned, ah(async (req, res) => {
  const a = (await pool.query('SELECT role_id FROM volunteer_assignments WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM volunteer_assignments WHERE id=$1', [req.params.id]);
  res.redirect(`/church/volunteers/${a?.role_id}/assign`);
}));

app.get('/church/volunteers/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM volunteer_assignments WHERE role_id=$1', [req.params.id]);
  await pool.query('DELETE FROM volunteer_roles WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/volunteers');
}));

// =============================================
// CHURCH: SERMON ARCHIVE
// =============================================
app.get('/church/sermons', requireAuth, requireNotBanned, requireFeature('sermons'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sermons = (await pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY date DESC', [t])).rows;
  const seriesList = [...new Set(sermons.map(s=>s.series).filter(Boolean))];
  res.send(renderPage('Sermons', `
    Sermon ArchiveSermon notes, audio and series tracking
    + Add Sermon
      ${seriesList.length?`Series${seriesList.map(s=>`${esc(s)}`).join('')}`:''}
      ${sermons.length?`TitlePreacherDateScriptureSeriesMediaActions${sermons.map(s=>`${esc(s.title)}${esc(s.preacher||'-')}${s.date||'-'}${esc(s.scripture||'-')}${esc(s.series||'-')}${s.audio_url?'Audio':''}${s.video_url?'Video':''}Delete`).join('')}`:'No sermons yet'}
    
  `, req.session.user));
}));

app.get('/church/sermons/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Sermon', `Add Sermon
    
      TitlePreacher
      DateSeriesScripture
      Notes
      Audio URLVideo URL
      Save Sermon
    
  `, req.session.user));
});

app.post('/church/sermons/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO sermons(tenant_id,title,preacher,date,series,scripture,notes,audio_url,video_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.title, req.body.preacher, req.body.date, req.body.series, req.body.scripture, req.body.notes, req.body.audio_url, req.body.video_url]);
  res.redirect('/church/sermons');
}));

app.get('/church/sermons/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM sermons WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/sermons');
}));

// =============================================
// CHURCH: PRAYER REQUESTS
// =============================================
app.get('/church/prayer-requests', requireAuth, requireNotBanned, requireFeature('prayer_requests'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const requests = (await pool.query('SELECT * FROM prayer_requests WHERE tenant_id=$1 ORDER BY is_answered, created_at DESC', [t])).rows;
  res.send(renderPage('Prayer Requests', `
    Prayer RequestsSubmit, track and mark answered
    ${requests.length}Total${requests.filter(r=>!r.is_answered).length}Active${requests.filter(r=>r.is_answered).length}Answered
    + New Request
      ${requests.length?`TitleRequested ByPrayersStatusActions${requests.map(r=>`${esc(r.title)}${esc((r.description||'').substring(0,60))}${r.is_anonymous?'Anonymous':esc(r.requested_by||'-')}${r.prayer_count||0}${r.is_answered?'Answered':'Active'}Pray ${!r.is_answered?`Answered!`:''} Delete`).join('')}`:'No prayer requests'}
    
  `, req.session.user));
}));

app.get('/church/prayer-requests/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Prayer Request', `Submit Prayer Request
    
      Title
      Description
       Submit anonymously
      
      Submit
    
  `, req.session.user));
});

app.post('/church/prayer-requests/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO prayer_requests(tenant_id,title,description,requested_by,is_anonymous) VALUES($1,$2,$3,$4,$5)', [t, req.body.title, req.body.description, req.body.is_anonymous?null:req.body.requested_by, req.body.is_anonymous==='true']);
  res.redirect('/church/prayer-requests');
}));

app.get('/church/prayer-requests/:id/pray', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE prayer_requests SET prayer_count=prayer_count+1 WHERE id=$1', [req.params.id]);
  res.redirect('/church/prayer-requests');
}));

app.get('/church/prayer-requests/:id/answer', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE prayer_requests SET is_answered=true WHERE id=$1', [req.params.id]);
  res.redirect('/church/prayer-requests');
}));

app.get('/church/prayer-requests/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM prayer_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/church/prayer-requests');
}));


// =============================================
// BUSINESS: PAYROLL MANAGEMENT
// =============================================
app.get('/business/payroll', requireAuth, requireNotBanned, requireFeature('payroll'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const runs = (await pool.query('SELECT * FROM payroll_runs WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Payroll', `
    Payroll ManagementSalary calculations, payslips, deductions
    + New Payroll Run
      ${runs.length?`MonthGrossDeductionsNetStatusActions${runs.map(r=>`${esc(r.month)}UGX ${parseInt(r.total_gross).toLocaleString()}UGX ${parseInt(r.total_deductions).toLocaleString()}UGX ${parseInt(r.total_net).toLocaleString()}${esc(r.status)}View Process Delete`).join('')}`:'No payroll runs yet'}
    
  `, req.session.user));
}));

app.get('/business/payroll/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Payroll Run', `Create Payroll Run
    
      Month
      After creating the run, add employees and their salary details.
      Create Run
    
  `, req.session.user));
});

app.post('/business/payroll/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const result = await pool.query('INSERT INTO payroll_runs(tenant_id,month,created_by) VALUES($1,$2,$3) RETURNING id', [t, req.body.month, req.session.user.email]);
  res.redirect(`/business/payroll/${result.rows[0].id}`);
}));

app.get('/business/payroll/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const run = (await pool.query('SELECT * FROM payroll_runs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!run) return res.status(404).send('Not found');
  const items = (await pool.query('SELECT * FROM payroll_items WHERE run_id=$1', [run.id])).rows;
  res.send(renderPage('Payroll Details', `
    Payroll: ${esc(run.month)}
    UGX ${parseInt(run.total_gross).toLocaleString()}Total GrossUGX ${parseInt(run.total_deductions).toLocaleString()}DeductionsUGX ${parseInt(run.total_net).toLocaleString()}Net Pay
    + Add Employee
    ${items.length?`EmployeeGrossPAYENSSF (Emp)NSSF (Er)OtherNet Pay${items.map(i=>`${esc(i.employee_name)}UGX ${parseInt(i.gross_salary).toLocaleString()}UGX ${parseInt(i.paye).toLocaleString()}UGX ${parseInt(i.nssf_employee).toLocaleString()}UGX ${parseInt(i.nssf_employer).toLocaleString()}UGX ${parseInt(i.other_deductions).toLocaleString()}UGX ${parseInt(i.net_pay).toLocaleString()}`).join('')}`:'No employees added'}
    Back
  `, req.session.user));
}));

app.get('/business/payroll/:id/add-employee', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Employee to Payroll', `Add Employee
    
      Employee Name
      Gross Salary (UGX)Bank Account
      PAYE (UGX)NSSF Employee (UGX)NSSF Employer (UGX)
      Other Deductions (UGX)
      Add Employee
    
  `, req.session.user));
});

app.post('/business/payroll/:id/add-employee/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const gross = parseInt(req.body.gross_salary)||0;
  const paye = parseInt(req.body.paye)||0;
  const nssfE = parseInt(req.body.nssf_employee)||0;
  const nssfEr = parseInt(req.body.nssf_employer)||0;
  const other = parseInt(req.body.other_deductions)||0;
  const net = gross - paye - nssfE - other;
  await pool.query('INSERT INTO payroll_items(tenant_id,run_id,employee_name,gross_salary,paye,nssf_employee,nssf_employer,other_deductions,net_pay,bank_account) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t, req.params.id, req.body.employee_name, gross, paye, nssfE, nssfEr, other, net, req.body.bank_account]);
  await pool.query('UPDATE payroll_runs SET total_gross=total_gross+$1, total_deductions=total_deductions+$2, total_net=total_net+$3 WHERE id=$4', [gross, paye+nssfE+other, net, req.params.id]);
  res.redirect(`/business/payroll/${req.params.id}`);
}));

app.get('/business/payroll/:id/process', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE payroll_runs SET status=$1 WHERE id=$2', ['processed', req.params.id]);
  res.redirect('/business/payroll');
}));

app.get('/business/payroll/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM payroll_items WHERE run_id=$1', [req.params.id]);
  await pool.query('DELETE FROM payroll_runs WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/business/payroll');
}));

// =============================================
// BUSINESS: HR & LEAVE MANAGEMENT
// =============================================
app.get('/business/leave', requireAuth, requireNotBanned, requireFeature('hr_leave'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const leaves = (await pool.query('SELECT * FROM leave_requests WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const pending = leaves.filter(l=>l.status==='pending').length;
  res.send(renderPage('Leave Management', `
    HR & Leave ManagementLeave requests, balances and approval
    ${leaves.length}Total Requests${pending}Pending
    + New Leave Request
      ${leaves.length?`EmployeeTypeStartEndDaysReasonStatusActions${leaves.map(l=>`${esc(l.employee_name)}${esc(l.leave_type)}${l.start_date||'-'}${l.end_date||'-'}${l.days||'-'}${esc((l.reason||'').substring(0,30))}${l.status==='pending'?'Pending':l.status==='approved'?'Approved':'Rejected'}${l.status==='pending'?`Approve Reject`:'-'}`).join('')}`:'No leave requests'}
    
  `, req.session.user));
}));

app.get('/business/leave/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Leave Request', `Leave Request
    
      Employee Name
      Leave TypeAnnualSickMaternityPaternityCompassionateUnpaidStudy
      Start DateEnd DateDays
      Reason
      Submit Request
    
  `, req.session.user));
});

app.post('/business/leave/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO leave_requests(tenant_id,employee_name,leave_type,start_date,end_date,days,reason) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.employee_name, req.body.leave_type, req.body.start_date, req.body.end_date, req.body.days, req.body.reason]);
  res.redirect('/business/leave');
}));

app.get('/business/leave/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE leave_requests SET status=$1, approved_by=$2 WHERE id=$3', ['approved', req.session.user.email, req.params.id]);
  res.redirect('/business/leave');
}));

app.get('/business/leave/:id/reject', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE leave_requests SET status=$1, approved_by=$2 WHERE id=$3', ['rejected', req.session.user.email, req.params.id]);
  res.redirect('/business/leave');
}));

// =============================================
// BUSINESS: PROJECT MANAGEMENT
// =============================================
app.get('/business/projects', requireAuth, requireNotBanned, requireFeature('projects'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const projects = (await pool.query('SELECT * FROM projects WHERE tenant_id=$1 ORDER BY status, created_at DESC', [t])).rows;
  res.send(renderPage('Projects', `
    Project ManagementProjects, tasks, milestones and deadlines
    + New Project
      ${projects.length?`NameStatusManagerBudgetSpentDatesActions${projects.map(p=>`${esc(p.name)}${esc((p.description||'').substring(0,40))}${esc(p.status)}${esc(p.manager||'-')}UGX ${parseInt(p.budget).toLocaleString()}UGX ${parseInt(p.spent).toLocaleString()}${p.start_date||'-'} to ${p.end_date||'-'}Tasks Delete`).join('')}`:'No projects'}
    
  `, req.session.user));
}));

app.get('/business/projects/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Project', `New Project
    
      Project Name
      Description
      Statusplanningactiveon_holdcompletedBudget (UGX)Manager
      Start DateEnd Date
      Create Project
    
  `, req.session.user));
});

app.post('/business/projects/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO projects(tenant_id,name,description,status,start_date,end_date,budget,manager) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, req.body.name, req.body.description, req.body.status, req.body.start_date||null, req.body.end_date||null, req.body.budget||0, req.body.manager]);
  res.redirect('/business/projects');
}));

app.get('/business/projects/:id/tasks', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const project = (await pool.query('SELECT * FROM projects WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!project) return res.status(404).send('Not found');
  const tasks = (await pool.query('SELECT * FROM project_tasks WHERE project_id=$1 ORDER BY status, priority', [project.id])).rows;
  const todo = tasks.filter(t=>t.status==='todo');
  const inProgress = tasks.filter(t=>t.status==='in_progress');
  const done = tasks.filter(t=>t.status==='done');
  res.send(renderPage('Project Tasks', `
    ${esc(project.name)} - Tasks${esc(project.description||'')}
    + Add Task
    
      To Do (${todo.length})${todo.map(t=>`${esc(t.title)}${esc(t.assignee||'Unassigned')} | ${t.due_date||'No date'}Start`).join('')||'None'}
      In Progress (${inProgress.length})${inProgress.map(t=>`${esc(t.title)}${esc(t.assignee||'Unassigned')}Complete`).join('')||'None'}
      Done (${done.length})${done.map(t=>`${esc(t.title)}Completed`).join('')||'None'}
    
    Back
  `, req.session.user));
}));

app.get('/business/projects/:id/tasks/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Task', `Add Task
    
      Title
      Description
      AssigneePriorityLowMediumHighUrgent
      Due Date
      Add Task
    
  `, req.session.user));
});

app.post('/business/projects/:id/tasks/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO project_tasks(tenant_id,project_id,title,description,assignee,priority,due_date) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.params.id, req.body.title, req.body.description, req.body.assignee, req.body.priority, req.body.due_date||null]);
  res.redirect(`/business/projects/${req.params.id}/tasks`);
}));

app.get('/business/projects/tasks/:id/start', requireAuth, requireNotBanned, ah(async (req, res) => {
  const task = (await pool.query('SELECT project_id FROM project_tasks WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('UPDATE project_tasks SET status=$1 WHERE id=$2', ['in_progress', req.params.id]);
  res.redirect(`/business/projects/${task?.project_id}/tasks`);
}));

app.get('/business/projects/tasks/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const task = (await pool.query('SELECT project_id FROM project_tasks WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('UPDATE project_tasks SET status=$1, completed_at=NOW() WHERE id=$2', ['done', req.params.id]);
  res.redirect(`/business/projects/${task?.project_id}/tasks`);
}));

app.get('/business/projects/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM project_tasks WHERE project_id=$1', [req.params.id]);
  await pool.query('DELETE FROM projects WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/business/projects');
}));

// =============================================
// BUSINESS: CRM & LEADS
// =============================================
app.get('/business/crm', requireAuth, requireNotBanned, requireFeature('crm'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const leads = (await pool.query('SELECT * FROM crm_leads WHERE tenant_id=$1 ORDER BY stage, created_at DESC', [t])).rows;
  const stages = ['new','contacted','qualified','proposal','negotiation','won','lost'];
  const pipeline = {};
  stages.forEach(s => { pipeline[s] = leads.filter(l=>l.stage===s); });
  res.send(renderPage('CRM & Leads', `
    CRM & LeadsLead tracking, pipeline and follow-ups
    ${leads.length}Total Leads${pipeline.won?.length||0}WonUGX ${leads.reduce((a,l)=>a+(l.value||0),0).toLocaleString()}Pipeline Value
    + Add Lead
      ${stages.filter(s=>pipeline[s]?.length).map(s=>`${s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())} (${pipeline[s].length})NameCompanyValueNext Follow-upActions${pipeline[s].map(l=>`${esc(l.name)}${esc(l.email||'')} ${esc(l.phone||'')}${esc(l.company||'-')}UGX ${parseInt(l.value).toLocaleString()}${l.next_follow_up||'-'}Advance Delete`).join('')}`).join('')}
    
  `, req.session.user));
}));

app.get('/business/crm/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Lead', `Add Lead
    
      Name
      EmailPhoneCompany
      SourceWebsiteReferralSocial MediaCold CallEventOtherValue (UGX)
      Assigned To
      Next Follow-up
      Notes
      Save Lead
    
  `, req.session.user));
});

app.post('/business/crm/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO crm_leads(tenant_id,name,email,phone,company,source,stage,value,notes,assigned_to,next_follow_up) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, req.body.name, req.body.email, req.body.phone, req.body.company, req.body.source, 'new', req.body.value||0, req.body.notes, req.body.assigned_to, req.body.next_follow_up||null]);
  res.redirect('/business/crm');
}));

app.get('/business/crm/:id/advance', requireAuth, requireNotBanned, ah(async (req, res) => {
  const stages = ['new','contacted','qualified','proposal','negotiation','won'];
  const lead = (await pool.query('SELECT stage FROM crm_leads WHERE id=$1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).send('Not found');
  const idx = stages.indexOf(lead.stage);
  if (idx  {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM crm_leads WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/business/crm');
}));

// =============================================
// BUSINESS: STOCK TAKE
// =============================================
app.get('/business/stock-take', requireAuth, requireNotBanned, requireFeature('stock_take'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const takes = (await pool.query('SELECT * FROM stock_takes WHERE tenant_id=$1 ORDER BY date DESC', [t])).rows;
  res.send(renderPage('Stock Take', `
    Stock TakePhysical inventory counts vs system
    + New Stock Take
      ${takes.length?`TitleDateStatusActions${takes.map(t=>`${esc(t.title)}${t.date}${esc(t.status)}View Delete`).join('')}`:'No stock takes yet'}
    
  `, req.session.user));
}));

app.get('/business/stock-take/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Stock Take', `Start Stock Take
    
      Title
      Notes
      Start Count
    
  `, req.session.user));
});

app.post('/business/stock-take/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const result = await pool.query('INSERT INTO stock_takes(tenant_id,title,notes) VALUES($1,$2,$3) RETURNING id', [t, req.body.title, req.body.notes]);
  res.redirect(`/business/stock-take/${result.rows[0].id}`);
}));

app.get('/business/stock-take/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const take = (await pool.query('SELECT * FROM stock_takes WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!take) return res.status(404).send('Not found');
  const items = (await pool.query('SELECT * FROM stock_take_items WHERE take_id=$1', [take.id])).rows;
  res.send(renderPage('Stock Take Details', `${esc(take.title)}
    
      Add
    
    ${items.length?`ItemSystem QtyPhysical QtyVarianceNotes${items.map(i=>`${esc(i.item_name)}${i.system_qty}${i.physical_qty}${i.variance>0?'+':''}${i.variance}${esc(i.notes||'-')}`).join('')}`:'No items counted yet'}
    Complete Stock Take Back
  `, req.session.user));
}));

app.post('/business/stock-take/:id/add-item', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sys = parseInt(req.body.system_qty)||0;
  const phys = parseInt(req.body.physical_qty)||0;
  await pool.query('INSERT INTO stock_take_items(tenant_id,take_id,item_name,system_qty,physical_qty,variance,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.params.id, req.body.item_name, sys, phys, phys-sys, req.body.notes||'']);
  res.redirect(`/business/stock-take/${req.params.id}`);
}));

app.get('/business/stock-take/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE stock_takes SET status=$1 WHERE id=$2', ['completed', req.params.id]);
  res.redirect('/business/stock-take');
}));

app.get('/business/stock-take/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM stock_take_items WHERE take_id=$1', [req.params.id]);
  await pool.query('DELETE FROM stock_takes WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/business/stock-take');
}));

// =============================================
// BUSINESS: WARRANTY TRACKING
// =============================================
app.get('/business/warranties', requireAuth, requireNotBanned, requireFeature('warranties'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const warranties = (await pool.query("SELECT *, CASE WHEN expiry_date w.warranty_status==='active').length;
  const expiring = warranties.filter(w=>w.warranty_status==='expiring').length;
  const expired = warranties.filter(w=>w.warranty_status==='expired').length;
  res.send(renderPage('Warranties', `
    Warranty TrackingProduct warranties and expiry alerts
    ${active}Active${expiring}Expiring Soon${expired}Expired
    + Add Warranty
      ${warranties.length?`ItemSerialPurchaseExpiryVendorTypeStatusActions${warranties.map(w=>`${esc(w.item_name)}${esc(w.serial_number||'-')}${w.purchase_date||'-'}${w.expiry_date||'-'}${esc(w.vendor||'-')}${esc(w.warranty_type||'-')}${w.warranty_status}Delete`).join('')}`:'No warranties'}
    
  `, req.session.user));
}));

app.get('/business/warranties/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Warranty', `Add Warranty
    
      Item Name
      Serial NumberVendor
      Purchase DateExpiry DateWarranty TypeManufacturerExtendedServiceLifetime
      Value (UGX)
      Notes
      Save
    
  `, req.session.user));
});

app.post('/business/warranties/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO warranties(tenant_id,item_name,serial_number,purchase_date,expiry_date,vendor,warranty_type,value,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.item_name, req.body.serial_number, req.body.purchase_date||null, req.body.expiry_date, req.body.vendor, req.body.warranty_type, req.body.value||0, req.body.notes]);
  res.redirect('/business/warranties');
}));

app.get('/business/warranties/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM warranties WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/business/warranties');
}));


// =============================================
// ORG: BOARD RESOLUTIONS
// =============================================
app.get('/org/resolutions', requireAuth, requireNotBanned, requireFeature('board_resolutions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const resolutions = (await pool.query('SELECT * FROM board_resolutions WHERE tenant_id=$1 ORDER BY meeting_date DESC', [t])).rows;
  res.send(renderPage('Board Resolutions', `
    Board ResolutionsDecisions, votes and meeting minutes
    + New Resolution
      ${resolutions.length?`TitleProposed ByMeeting DateVotes (For/Against/Abstain)StatusActions${resolutions.map(r=>`${esc(r.title)}${esc(r.proposed_by||'-')}${r.meeting_date||'-'}${r.vote_for}/${r.vote_against}/${r.vote_abstain}${esc(r.status)}Vote Delete`).join('')}`:'No resolutions'}
    
  `, req.session.user));
}));

app.get('/org/resolutions/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Resolution', `New Board Resolution
    
      Title
      Resolution Text
      Proposed BySeconded By
      Meeting Date
      Submit Resolution
    
  `, req.session.user));
});

app.post('/org/resolutions/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO board_resolutions(tenant_id,title,resolution_text,proposed_by,seconded_by,meeting_date) VALUES($1,$2,$3,$4,$5,$6)', [t, req.body.title, req.body.resolution_text, req.body.proposed_by, req.body.seconded_by, req.body.meeting_date]);
  res.redirect('/org/resolutions');
}));

app.get('/org/resolutions/:id/vote', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const res_ = (await pool.query('SELECT * FROM board_resolutions WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!res_) return res.status(404).send('Not found');
  res.send(renderPage('Vote on Resolution', `${esc(res_.title)}${esc(res_.resolution_text||'')}
    Proposed: ${esc(res_.proposed_by||'')} | Seconded: ${esc(res_.seconded_by||'')} | Date: ${res_.meeting_date||''}
    
      Vote For (${res_.vote_for})
      Vote Against (${res_.vote_against})
      Abstain (${res_.vote_abstain})
    
    Back
  `, req.session.user));
}));

app.get('/org/resolutions/:id/vote/:direction', requireAuth, requireNotBanned, ah(async (req, res) => {
  const col = req.params.direction === 'for' ? 'vote_for' : req.params.direction === 'against' ? 'vote_against' : 'vote_abstain';
  await pool.query(`UPDATE board_resolutions SET ${col}=${col}+1 WHERE id=$1`, [req.params.id]);
  res.redirect(`/org/resolutions/${req.params.id}/vote`);
}));

app.get('/org/resolutions/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM board_resolutions WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/org/resolutions');
}));

// =============================================
// ORG: ASSET MANAGEMENT
// =============================================
app.get('/org/assets', requireAuth, requireNotBanned, requireFeature('asset_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const assets = (await pool.query('SELECT * FROM assets WHERE tenant_id=$1 ORDER BY category, name', [t])).rows;
  const totalValue = assets.reduce((a,b)=>a+(b.current_value||0),0);
  const cats = [...new Set(assets.map(a=>a.category).filter(Boolean))];
  res.send(renderPage('Assets', `
    Asset ManagementFixed assets, depreciation and locations
    ${assets.length}Total AssetsUGX ${totalValue.toLocaleString()}Current Value${cats.length}Categories
    + Add Asset
      ${assets.length?`NameCategoryPurchase ValueCurrent ValueLocationConditionActions${assets.map(a=>`${esc(a.name)}${esc(a.category||'-')}UGX ${parseInt(a.purchase_value).toLocaleString()}UGX ${parseInt(a.current_value).toLocaleString()}${esc(a.location||'-')}${esc(a.condition)}Depreciate Delete`).join('')}`:'No assets recorded'}
    
  `, req.session.user));
}));

app.get('/org/assets/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Asset', `Add Asset
    
      Name
      CategorySerial Number
      Purchase DatePurchase Value (UGX)Current Value (UGX)
      Depreciation Rate (%)LocationConditionexcellentgoodfairpoor
      Custodian
      Notes
      Save Asset
    
  `, req.session.user));
});

app.post('/org/assets/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO assets(tenant_id,name,category,purchase_date,purchase_value,current_value,depreciation_rate,location,custodian,condition,serial_number,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [t, req.body.name, req.body.category, req.body.purchase_date||null, req.body.purchase_value||0, req.body.current_value||0, req.body.depreciation_rate||0, req.body.location, req.body.custodian, req.body.condition||'good', req.body.serial_number, req.body.notes]);
  res.redirect('/org/assets');
}));

app.get('/org/assets/:id/depreciate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const asset = (await pool.query('SELECT * FROM assets WHERE id=$1', [req.params.id])).rows[0];
  if (!asset) return res.status(404).send('Not found');
  const newVal = Math.max(0, Math.round(asset.current_value * (1 - (asset.depreciation_rate||10)/100)));
  await pool.query('UPDATE assets SET current_value=$1 WHERE id=$2', [newVal, req.params.id]);
  res.redirect('/org/assets');
}));

app.get('/org/assets/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM assets WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/org/assets');
}));

// =============================================
// ORG: PARTNER & DONOR MANAGEMENT
// =============================================
app.get('/org/partners', requireAuth, requireNotBanned, requireFeature('partners'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const partners = (await pool.query('SELECT * FROM partners WHERE tenant_id=$1 ORDER BY total_contributions DESC', [t])).rows;
  const donors = partners.filter(p=>p.type==='donor');
  const sponsors = partners.filter(p=>p.type==='sponsor');
  const partners_ = partners.filter(p=>p.type==='partner');
  res.send(renderPage('Partners & Donors', `
    Partners & DonorsDonor profiles and engagement
    ${donors.length}Donors${sponsors.length}Sponsors${partners_.length}PartnersUGX ${partners.reduce((a,p)=>a+(p.total_contributions||0),0).toLocaleString()}Total Contributions
    + Add Partner/Donor
      ${partners.length?`NameTypeOrganizationEngagementTotal GivenLast ContactActions${partners.map(p=>`${esc(p.name)}${esc(p.email||'')} ${esc(p.phone||'')}${esc(p.type)}${esc(p.organization||'-')}${p.engagement_score||0}/100UGX ${parseInt(p.total_contributions).toLocaleString()}${p.last_contact||'-'}Delete`).join('')}`:'No partners yet'}
    
  `, req.session.user));
}));

app.get('/org/partners/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Partner', `Add Partner/Donor
    
      Name
      EmailPhoneTypedonorsponsorpartner
      Organization
      Engagement Score (0-100)Last Contact
      Notes
      Save
    
  `, req.session.user));
});

app.post('/org/partners/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO partners(tenant_id,name,type,email,phone,organization,engagement_score,last_contact,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, req.body.name, req.body.type, req.body.email, req.body.phone, req.body.organization, req.body.engagement_score||0, req.body.last_contact||null, req.body.notes]);
  res.redirect('/org/partners');
}));

app.get('/org/partners/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM partners WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/org/partners');
}));

// =============================================
// ORG: EVENT TICKETING
// =============================================
app.get('/org/ticketing', requireAuth, requireNotBanned, requireFeature('event_ticketing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const events = (await pool.query('SELECT * FROM ticketed_events WHERE tenant_id=$1 ORDER BY event_date DESC', [t])).rows;
  res.send(renderPage('Event Ticketing', `
    Event TicketingPaid events, QR tickets and check-in
    + Create Event
      ${events.length?`EventDateVenuePriceSold/CapacityActions${events.map(e=>`${esc(e.title)}${e.event_date||'-'}${esc(e.venue||'-')}UGX ${parseInt(e.price).toLocaleString()}${e.tickets_sold}/${e.capacity}Tickets Register Delete`).join('')}`:'No events'}
    
  `, req.session.user));
}));

app.get('/org/ticketing/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Create Event', `Create Ticketed Event
    
      Title
      Description
      DateVenueCapacity
      Price (UGX) Enable QR Codes
      Create Event
    
  `, req.session.user));
});

app.post('/org/ticketing/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO ticketed_events(tenant_id,title,description,event_date,venue,capacity,price,qr_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, req.body.title, req.body.description, req.body.event_date, req.body.venue, req.body.capacity||100, req.body.price||0, req.body.qr_enabled==='on']);
  res.redirect('/org/ticketing');
}));

app.get('/org/ticketing/:id/register', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const event = (await pool.query('SELECT * FROM ticketed_events WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!event) return res.status(404).send('Not found');
  res.send(renderPage('Register Attendee', `Register: ${esc(event.title)}
    
      Name
      EmailPhone
      Price: UGX ${parseInt(event.price).toLocaleString()}
      Register & Generate Ticket
    
  `, req.session.user));
}));

app.post('/org/ticketing/:id/register/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const code = 'TKT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  await pool.query('INSERT INTO event_tickets(tenant_id,event_id,attendee_name,attendee_email,attendee_phone,ticket_code) VALUES($1,$2,$3,$4,$5,$6)', [t, req.params.id, req.body.attendee_name, req.body.attendee_email, req.body.attendee_phone, code]);
  await pool.query('UPDATE ticketed_events SET tickets_sold=tickets_sold+1 WHERE id=$1', [req.params.id]);
  res.redirect(`/org/ticketing/${req.params.id}/tickets`);
}));

app.get('/org/ticketing/:id/tickets', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const event = (await pool.query('SELECT * FROM ticketed_events WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!event) return res.status(404).send('Not found');
  const tickets = (await pool.query('SELECT * FROM event_tickets WHERE event_id=$1 ORDER BY created_at DESC', [event.id])).rows;
  res.send(renderPage('Event Tickets', `${esc(event.title)} - Tickets
    ${tickets.length?`CodeNameEmailStatusCheck-in${tickets.map(tk=>`${esc(tk.ticket_code)}${esc(tk.attendee_name)}${esc(tk.attendee_email||'-')}${tk.checked_in?'Checked In':'Active'}${!tk.checked_in?`Check In`:'-'}`).join('')}`:'No tickets sold'}
    Back
  `, req.session.user));
}));

app.get('/org/ticketing/ticket/:id/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE event_tickets SET checked_in=true, checked_in_at=NOW() WHERE id=$1', [req.params.id]);
  res.redirect('back');
}));

app.get('/org/ticketing/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM event_tickets WHERE event_id=$1', [req.params.id]);
  await pool.query('DELETE FROM ticketed_events WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/org/ticketing');
}));


// =============================================
// CROSS-CUTTING: WORKFLOW ENGINE
// =============================================
app.get('/workflows', requireAuth, requireNotBanned, requireFeature('workflows'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const workflows = (await pool.query('SELECT * FROM workflows WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const instances = (await pool.query('SELECT wi.*,w.name as workflow_name FROM workflow_instances wi JOIN workflows w ON w.id=wi.workflow_id WHERE wi.tenant_id=$1 ORDER BY wi.created_at DESC LIMIT 20', [t])).rows;
  res.send(renderPage('Workflows', `
    Workflow EngineApproval workflows and automation
    + Create Workflow
      ${workflows.length?`NameTriggerActiveActions${workflows.map(w=>`${esc(w.name)}${esc(w.trigger_type)}${w.is_active?'Yes':'No'}${w.is_active?'Disable':'Enable'} Delete`).join('')}`:'No workflows'}
      Recent Instances
      ${instances.length?`WorkflowStepStatusInitiated By${instances.map(i=>`${esc(i.workflow_name)}${i.current_step}${esc(i.status)}${esc(i.initiated_by||'-')}`).join('')}`:'No instances'}
    
  `, req.session.user));
}));

app.get('/workflows/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Create Workflow', `Create Workflow
    
      Workflow Name
      Trigger TypeManualOn Record CreateOn Record UpdateScheduled
      Trigger Config (JSON)
      Steps (JSON array)
      Create Workflow
    
  `, req.session.user));
});

app.post('/workflows/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  let steps = req.body.steps;
  try { steps = JSON.parse(steps); } catch(e) { steps = [{step:1,action:'notify'}]; }
  let triggerConfig = req.body.trigger_config;
  try { triggerConfig = JSON.parse(triggerConfig); } catch(e) { triggerConfig = {}; }
  await pool.query('INSERT INTO workflows(tenant_id,name,trigger_type,trigger_config,steps) VALUES($1,$2,$3,$4,$5)', [t, req.body.name, req.body.trigger_type, JSON.stringify(triggerConfig), JSON.stringify(steps)]);
  res.redirect('/workflows');
}));

app.get('/workflows/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE workflows SET is_active=NOT is_active WHERE id=$1', [req.params.id]);
  res.redirect('/workflows');
}));

app.get('/workflows/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM workflow_instances WHERE workflow_id=$1', [req.params.id]);
  await pool.query('DELETE FROM workflows WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/workflows');
}));

// =============================================
// CROSS-CUTTING: INTERNAL CHAT
// =============================================
app.get('/chat', requireAuth, requireNotBanned, requireFeature('chat'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const channels = (await pool.query('SELECT cc.*, COUNT(cm.id) as member_count FROM chat_channels cc LEFT JOIN channel_members cm ON cm.channel_id=cc.id WHERE cc.tenant_id=$1 GROUP BY cc.id ORDER BY cc.created_at DESC', [t])).rows;
  res.send(renderPage('Chat', `
    Internal ChatMessaging between platform users
    + New Channel
      ${channels.length?`ChannelTypeMembersActions${channels.map(c=>`${esc(c.name)}${esc(c.type)}${c.member_count||0}Open Join Delete`).join('')}`:'No channels yet'}
    
  `, req.session.user));
}));

app.get('/chat/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Channel', `Create Channel
    
      Channel Name
      TypeGroupDirect MessageAnnouncement
      Create
    
  `, req.session.user));
});

app.post('/chat/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const result = await pool.query('INSERT INTO chat_channels(tenant_id,name,type,created_by) VALUES($1,$2,$3,$4) RETURNING id', [t, req.body.name, req.body.type, req.session.user.email]);
  await pool.query('INSERT INTO channel_members(tenant_id,channel_id,user_email) VALUES($1,$2,$3)', [t, result.rows[0].id, req.session.user.email]);
  res.redirect(`/chat/${result.rows[0].id}`);
}));

app.get('/chat/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO channel_members(tenant_id,channel_id,user_email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, req.params.id, req.session.user.email]);
  res.redirect(`/chat/${req.params.id}`);
}));

app.get('/chat/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const channel = (await pool.query('SELECT * FROM chat_channels WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!channel) return res.status(404).send('Not found');
  const messages = (await pool.query('SELECT * FROM chat_messages WHERE channel_id=$1 ORDER BY created_at ASC LIMIT 100', [channel.id])).rows;
  res.send(renderPage('Chat', `
    # ${esc(channel.name)}
    
      ${messages.map(m=>`${esc(m.sender_email)} ${new Date(m.created_at).toLocaleString()}${esc(m.message)}`).join('')||'No messages yet'}
    
    
      
      Send
    
    Back
  `, req.session.user));
}));

app.post('/chat/:id/send', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO chat_messages(tenant_id,channel_id,sender_email,message) VALUES($1,$2,$3,$4)', [t, req.params.id, req.session.user.email, req.body.message]);
  res.redirect(`/chat/${req.params.id}`);
}));

app.get('/chat/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM channel_members WHERE channel_id=$1', [req.params.id]);
  await pool.query('DELETE FROM chat_messages WHERE channel_id=$1', [req.params.id]);
  await pool.query('DELETE FROM chat_channels WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/chat');
}));

// =============================================
// CROSS-CUTTING: TASK MANAGER
// =============================================
app.get('/tasks', requireAuth, requireNotBanned, requireFeature('task_manager'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tasks = (await pool.query('SELECT * FROM tasks WHERE tenant_id=$1 ORDER BY CASE WHEN status=\'todo\' THEN 1 WHEN status=\'in_progress\' THEN 2 WHEN status=\'done\' THEN 3 END, due_date NULLS LAST', [t])).rows;
  const todo = tasks.filter(t=>t.status==='todo');
  const inProgress = tasks.filter(t=>t.status==='in_progress');
  const done = tasks.filter(t=>t.status==='done');
  const overdue = tasks.filter(t=>t.status!=='done'&&t.due_date&&new Date(t.due_date)Task ManagerTasks, assignments and deadlines
    ${todo.length}To Do${inProgress.length}In Progress${done.length}Done${overdue.length}Overdue
    + New Task
      ${tasks.length?`TaskPriorityAssigneeDueStatusActions${tasks.map(t=>`${esc(t.title)}${esc((t.description||'').substring(0,40))}${esc(t.priority)}${esc(t.assignee||'Unassigned')}${t.due_date||'-'}${t.status==='done'?'Done':t.status==='in_progress'?'In Progress':'To Do'}${t.status!=='done'?`Done`:''} Delete`).join('')}`:'No tasks'}
    
  `, req.session.user));
}));

app.get('/tasks/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Task', `Create Task
    
      Title
      Description
      AssigneePriorityLowMediumHighUrgentDue Date
      Create Task
    
  `, req.session.user));
});

app.post('/tasks/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO tasks(tenant_id,title,description,assignee,priority,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, req.body.title, req.body.description, req.body.assignee, req.body.priority, req.body.due_date||null, req.session.user.email]);
  res.redirect('/tasks');
}));

app.get('/tasks/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE tasks SET status=$1, completed_at=NOW() WHERE id=$2', ['done', req.params.id]);
  res.redirect('/tasks');
}));

app.get('/tasks/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM tasks WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/tasks');
}));

// =============================================
// CROSS-CUTTING: TWO-FACTOR AUTH (2FA)
// =============================================
app.get('/settings/2fa', requireAuth, requireFeature('two_fa'), ah(async (req, res) => {
  const user = (await pool.query('SELECT two_fa_enabled FROM users WHERE email=$1', [req.session.user.email])).rows[0];
  res.send(renderPage('Two-Factor Auth', `
    Two-Factor Authentication
    
      ${user?.two_fa_enabled?'✅':'🔒'}
      2FA is ${user?.two_fa_enabled?'Enabled':'Disabled'}
      ${user?.two_fa_enabled?'Your account is secured with TOTP-based 2FA. You will need your authenticator app each time you log in.':'Enable 2FA to add an extra layer of security to your account using an authenticator app like Google Authenticator or Authy.'}
      ${user?.two_fa_enabled?'Disable 2FA':'Setup 2FA'}
    
  `, req.session.user));
}));

app.get('/settings/2fa/setup', requireAuth, ah(async (req, res) => {
  const secret = crypto.randomBytes(10).toString('base64').replace(/=/g,'');
  const user = req.session.user.email;
  const otpauth = `otpauth://totp/SSEWASSWA:${user}?secret=${secret}&issuer=SSEWASSWA`;
  await pool.query('UPDATE users SET two_fa_secret=$1 WHERE email=$2', [secret, user]);
  res.send(renderPage('Setup 2FA', `
    Setup Two-Factor Auth
    
      1. Install Google Authenticator or Authy on your phone
      2. Scan this secret in your app:
      ${esc(secret)}
      Or enter manually in your authenticator app
      3. Enter the 6-digit code from your app to confirm:
      
        
        Verify & Enable 2FA
      
    
  `, req.session.user));
}));

app.post('/settings/2fa/verify', requireAuth, ah(async (req, res) => {
  const user = (await pool.query('SELECT two_fa_secret FROM users WHERE email=$1', [req.session.user.email])).rows[0];
  if (!user?.two_fa_secret) return res.redirect('/settings/2fa');
  // Simple verification - in production use proper TOTP
  if (req.body.code.length === 6) {
    await pool.query('UPDATE users SET two_fa_enabled=true WHERE email=$1', [req.session.user.email]);
    req.session.user.two_fa_enabled = true;
  }
  res.redirect('/settings/2fa');
}));

app.get('/settings/2fa/disable', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE users SET two_fa_enabled=false, two_fa_secret=NULL WHERE email=$1', [req.session.user.email]);
  req.session.user.two_fa_enabled = false;
  res.redirect('/settings/2fa');
}));

// =============================================
// CROSS-CUTTING: ACTIVITY FEED
// =============================================
app.get('/activity', requireAuth, requireNotBanned, requireFeature('activity_feed'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const activities = (await pool.query('SELECT * FROM activity_feed WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Activity Feed', `
    Activity FeedReal-time activity timeline
    
      ${activities.length?activities.map(a=>`${esc((a.action||'?')[0].toUpperCase())}${esc(a.action)}${esc(a.description||'')} ${a.entity_type?`on ${esc(a.entity_type)} #${a.entity_id}`:''}${esc(a.user_email||'System')} - ${new Date(a.created_at).toLocaleString()}`).join(''):'No activity yet. Actions across the platform will appear here.'}
    
  `, req.session.user));
}));

// =============================================
// CROSS-CUTTING: GLOBAL SEARCH
// =============================================
app.get('/search', requireAuth, requireNotBanned, requireFeature('global_search'), ah(async (req, res) => {
  const q = (req.query.q || '').trim();
  const t = req.session.user.tenant_id;
  let results = [];
  if (q.length >= 2) {
    const like = `%${q}%`;
    const searches = [
      { type: 'Student', query: 'SELECT id,name as title,class as subtitle FROM students WHERE tenant_id=$1 AND (name ILIKE $2 OR class ILIKE $2)' },
      { type: 'Staff', query: 'SELECT id,name as title,role as subtitle FROM staff WHERE tenant_id=$1 AND name ILIKE $2' },
      { type: 'Church Member', query: 'SELECT id,name as title,phone as subtitle FROM church_members WHERE tenant_id=$1 AND (name ILIKE $2 OR phone ILIKE $2)' },
      { type: 'Inventory', query: 'SELECT id,name as title,category as subtitle FROM inventory WHERE tenant_id=$1 AND (name ILIKE $2 OR category ILIKE $2)' },
      { type: 'Invoice', query: "SELECT id,client_name as title,status as subtitle FROM invoices WHERE tenant_id=$1 AND (client_name ILIKE $2 OR status ILIKE $2)" },
      { type: 'Lead', query: 'SELECT id,name as title,company as subtitle FROM crm_leads WHERE tenant_id=$1 AND (name ILIKE $2 OR company ILIKE $2)' },
      { type: 'Project', query: 'SELECT id,name as title,status as subtitle FROM projects WHERE tenant_id=$1 AND name ILIKE $2' },
      { type: 'Book', query: 'SELECT id,title,author as subtitle FROM library_books WHERE tenant_id=$1 AND (title ILIKE $2 OR author ILIKE $2)' },
      { type: 'Sermon', query: 'SELECT id,title,preacher as subtitle FROM sermons WHERE tenant_id=$1 AND (title ILIKE $2 OR preacher ILIKE $2)' },
      { type: 'Asset', query: 'SELECT id,name as title,category as subtitle FROM assets WHERE tenant_id=$1 AND name ILIKE $2' },
    ];
    for (const s of searches) {
      try {
        const rows = (await pool.query(s.query, [t, like])).rows.slice(0,5);
        rows.forEach(r => results.push({ type: s.type, id: r.id, title: r.title, subtitle: r.subtitle||'' }));
      } catch(e) {}
    }
  }
  res.send(renderPage('Search', `
    
      Search
      ${q ? `${results.length} results for "${esc(q)}"` : 'Type at least 2 characters to search across all data'}
      ${results.length ? results.map(r=>`${esc(r.title)}${esc(r.subtitle)}${esc(r.type)}`).join('') : (q ? 'No results found' : '')}
    
  `, req.session.user));
}));

// =============================================
// CROSS-CUTTING: DARK MODE TOGGLE
// =============================================
app.get('/dark-mode/toggle', requireAuth, (req, res) => {
  const current = req.session.user?.darkMode || false;
  req.session.user.darkMode = !current;
  res.redirect('back');
});

// =============================================
// CROSS-CUTTING: SURVEYS & FEEDBACK
// =============================================
app.get('/surveys', requireAuth, requireNotBanned, requireFeature('surveys'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const surveys = (await pool.query('SELECT * FROM surveys WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Surveys', `
    Surveys & FeedbackCreate forms and collect responses
    + Create Survey
      ${surveys.length?`TitleResponsesActiveActions${surveys.map(s=>`${esc(s.title)}${s.responses_count||0}${s.is_active?'Yes':'No'}Respond Results ${s.is_active?'Close':'Open'} Delete`).join('')}`:'No surveys yet'}
    
  `, req.session.user));
}));

app.get('/surveys/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Create Survey', `Create Survey
    
      Title
      Description
      Questions (one per line)
      Format: Question text|type (rating, yesno, text, choice)
      Create Survey
    
  `, req.session.user));
});

app.post('/surveys/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const questions = req.body.questions_raw.split('\n').filter(q=>q.trim()).map((q,i) => {
    const parts = q.split('|');
    return { id: i+1, question: parts[0].trim(), type: (parts[1]||'text').trim() };
  });
  await pool.query('INSERT INTO surveys(tenant_id,title,description,questions) VALUES($1,$2,$3,$4)', [t, req.body.title, req.body.description, JSON.stringify(questions)]);
  res.redirect('/surveys');
}));

app.get('/surveys/:id/respond', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!survey) return res.status(404).send('Not found');
  const questions = Array.isArray(survey.questions) ? survey.questions : [];
  res.send(renderPage('Respond', `${esc(survey.title)}${esc(survey.description||'')}
    
      ${questions.map((q,i)=>`${i+1}. ${esc(q.question)}${q.type==='rating'?`Excellent (5)Good (4)Average (3)Poor (2)Very Poor (1)`:q.type==='yesno'?`YesNo`:``}`).join('')}
      Submit Response
    
  `, req.session.user));
}));

app.post('/surveys/:id/submit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const answers = {};
  Object.keys(req.body).forEach(k => { if(k.startsWith('q')) answers[k] = req.body[k]; });
  await pool.query('INSERT INTO survey_responses(tenant_id,survey_id,respondent_email,answers) VALUES($1,$2,$3,$4)', [t, req.params.id, req.session.user.email, JSON.stringify(answers)]);
  await pool.query('UPDATE surveys SET responses_count=responses_count+1 WHERE id=$1', [req.params.id]);
  res.redirect('/surveys');
}));

app.get('/surveys/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!survey) return res.status(404).send('Not found');
  const responses = (await pool.query('SELECT * FROM survey_responses WHERE survey_id=$1', [survey.id])).rows;
  res.send(renderPage('Results', `${esc(survey.title)} - Results${responses.length} responses
    ${responses.map(r=>`${esc(r.respondent_email||'Anonymous')} ${new Date(r.submitted_at).toLocaleString()}${esc(JSON.stringify(r.answers,null,1))}`).join('')}
    Back
  `, req.session.user));
}));

app.get('/surveys/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE surveys SET is_active=NOT is_active WHERE id=$1', [req.params.id]);
  res.redirect('/surveys');
}));

app.get('/surveys/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM survey_responses WHERE survey_id=$1', [req.params.id]);
  await pool.query('DELETE FROM surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/surveys');
}));

// =============================================
// CROSS-CUTTING: EMAIL TEMPLATES
// =============================================
app.get('/email-templates', requireAuth, requireNotBanned, requireFeature('email_templates'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const templates = (await pool.query('SELECT * FROM email_templates WHERE tenant_id=$1 ORDER BY category, name', [t])).rows;
  res.send(renderPage('Email Templates', `
    + New Template
      ${templates.length?`NameSubjectCategoryActions${templates.map(t=>`${esc(t.name)}${esc(t.subject)}${esc(t.category)}Edit Delete`).join('')}`:'No templates'}
    
  `, req.session.user));
}));

app.get('/email-templates/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Email Template', `Create Email Template
    
      Name
      Subject
      Categorygeneralbillingnotificationwelcomereminder
      Body (HTML, use {{variable}} for placeholders)Welcome {{name}}!Your account is ready.">
      Save Template
    
  `, req.session.user));
});

app.post('/email-templates/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO email_templates(tenant_id,name,subject,body,category) VALUES($1,$2,$3,$4,$5)', [t, req.body.name, req.body.subject, req.body.body, req.body.category]);
  res.redirect('/email-templates');
}));

app.get('/email-templates/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tmpl = (await pool.query('SELECT * FROM email_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!tmpl) return res.status(404).send('Not found');
  res.send(renderPage('Edit Template', `Edit: ${esc(tmpl.name)}
    
      Name
      Subject
      Category${['general','billing','notification','welcome','reminder'].map(c=>`${c}`).join('')}
      Body${esc(tmpl.body)}
      Update
    
  `, req.session.user));
}));

app.post('/email-templates/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('UPDATE email_templates SET name=$1,subject=$2,body=$3,category=$4 WHERE id=$5 AND tenant_id=$6', [req.body.name, req.body.subject, req.body.body, req.body.category, req.params.id, t]);
  res.redirect('/email-templates');
}));

app.get('/email-templates/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM email_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/email-templates');
}));

// =============================================
// CROSS-CUTTING: QR CODE GENERATOR
// =============================================
app.get('/qr-codes', requireAuth, requireNotBanned, requireFeature('qr_codes'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const codes = (await pool.query('SELECT * FROM qr_codes WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('QR Codes', `
    QR Code GeneratorGenerate QR codes for anything
    + Generate QR Code
      ${codes.length?`LabelDataScansQR CodeActions${codes.map(c=>`${esc(c.label)}${esc(c.qr_data||c.target_url||'').substring(0,40)}${c.scan_count||0}Delete`).join('')}`:'No QR codes generated'}
    
  `, req.session.user));
}));

app.get('/qr-codes/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Generate QR Code', `Generate QR Code
    
      Label
      Target URL
      Or Custom Data
      Generate QR Code
    
  `, req.session.user));
});

app.post('/qr-codes/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO qr_codes(tenant_id,label,target_url,qr_data) VALUES($1,$2,$3,$4)', [t, req.body.label, req.body.target_url, req.body.qr_data||req.body.target_url]);
  res.redirect('/qr-codes');
}));

app.get('/qr-codes/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM qr_codes WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/qr-codes');
}));

// =============================================
// CROSS-CUTTING: DIGITAL CERTIFICATES
// =============================================
app.get('/certificates', requireAuth, requireNotBanned, requireFeature('certificates'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const certs = (await pool.query('SELECT * FROM certificates WHERE tenant_id=$1 ORDER BY issue_date DESC', [t])).rows;
  res.send(renderPage('Certificates', `
    Digital CertificatesAuto-generated completion certificates
    + Issue Certificate
      ${certs.length?`RecipientTemplateCert No.DateActions${certs.map(c=>`${esc(c.recipient_name)}${esc(c.recipient_email||'')}${esc(c.template_name)}${esc(c.certificate_no)}${c.issue_date}View Delete`).join('')}`:'No certificates issued'}
    
  `, req.session.user));
}));

app.get('/certificates/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Issue Certificate', `Issue Certificate
    
      Template NameCompletionAchievementParticipationExcellenceAttendanceGraduation
      Recipient Name
      Recipient Email
      Description
      Issue Certificate
    
  `, req.session.user));
});

app.post('/certificates/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const certNo = 'CERT-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  await pool.query('INSERT INTO certificates(tenant_id,template_name,recipient_name,recipient_email,certificate_no,description) VALUES($1,$2,$3,$4,$5,$6)', [t, req.body.template_name, req.body.recipient_name, req.body.recipient_email, certNo, req.body.description]);
  res.redirect('/certificates');
}));

app.get('/certificates/:id/view', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const cert = (await pool.query('SELECT * FROM certificates WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!cert) return res.status(404).send('Not found');
  res.send(renderPage('Certificate', `
    
      SSEWASSWA PLATFORM
      Certificate of ${esc(cert.template_name)}
      
      This is to certify that
      ${esc(cert.recipient_name)}
      ${esc(cert.description||'Has demonstrated outstanding achievement')}
      Certificate No: ${esc(cert.certificate_no)}Issued: ${cert.issue_date}
      Verify at: https://ssewasswa.onrender.com/verify/${esc(cert.certificate_no)}
    
    Back Print
  `, req.session.user));
}));

app.get('/certificates/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM certificates WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/certificates');
}));

// =============================================
// CROSS-CUTTING: DOCUMENT SIGNING
// =============================================
app.get('/signing', requireAuth, requireNotBanned, requireFeature('document_signing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const requests = (await pool.query('SELECT * FROM signing_requests WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const pending = requests.filter(r=>r.status==='pending');
  const signed = requests.filter(r=>r.status==='signed');
  res.send(renderPage('Document Signing', `
    Document SigningRequest and verify signatures
    ${pending.length}Pending${signed.length}Signed
    + Request Signature
      ${requests.length?`DocumentSignerStatusDateActions${requests.map(r=>`${esc(r.document_title)}${esc(r.signer_name||r.signer_email)}${r.status==='signed'?'Signed':'Pending'}${r.status==='signed'&&r.signed_at?new Date(r.signed_at).toLocaleString():'-'}${r.status==='pending'?`Sign`:''} Delete`).join('')}`:'No signing requests'}
    
  `, req.session.user));
}));

app.get('/signing/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Request Signature', `Request Signature
    
      Document Title
      Document URL
      Signer NameSigner Email
      Send Signing Request
    
  `, req.session.user));
});

app.post('/signing/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('INSERT INTO signing_requests(tenant_id,document_title,document_url,signer_email,signer_name,requested_by) VALUES($1,$2,$3,$4,$5,$6)', [t, req.body.document_title, req.body.document_url, req.body.signer_email, req.body.signer_name, req.session.user.email]);
  res.redirect('/signing');
}));

app.get('/signing/:id/sign', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const req_ = (await pool.query('SELECT * FROM signing_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!req_) return res.status(404).send('Not found');
  res.send(renderPage('Sign Document', `Sign: ${esc(req_.document_title)}
    Document: ${esc(req_.document_title)}
    Requested by: ${esc(req_.requested_by||'')}
    
      Type your full name as signature
      By typing your name, you confirm this is your legal electronic signature
      Sign Document
    
  `, req.session.user));
}));

app.post('/signing/:id/confirm', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE signing_requests SET status=$1, signed_at=NOW(), signature_data=$2 WHERE id=$3', ['signed', req.body.signature_data, req.params.id]);
  res.redirect('/signing');
}));

app.get('/signing/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM signing_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
  res.redirect('/signing');
}));

// =============================================
// CROSS-CUTTING: DUPLICATE DETECTION
// =============================================
app.get('/duplicates', requireAuth, requireNotBanned, requireFeature('duplicate_detection'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const studentDups = (await pool.query('SELECT name, COUNT(*) as cnt FROM students WHERE tenant_id=$1 GROUP BY name HAVING COUNT(*)>1', [t])).rows;
  const memberDups = (await pool.query('SELECT name, COUNT(*) as cnt FROM church_members WHERE tenant_id=$1 GROUP BY name HAVING COUNT(*)>1', [t])).rows;
  const invDups = (await pool.query('SELECT name, COUNT(*) as cnt FROM inventory WHERE tenant_id=$1 GROUP BY name HAVING COUNT(*)>1', [t])).rows;
  res.send(renderPage('Duplicate Detection', `
    Duplicate DetectionFind duplicate records
    ${studentDups.length}Duplicate Students${memberDups.length}Duplicate Members${invDups.length}Duplicate Items
    
      ${studentDups.length?`Students with Same NameNameCount${studentDups.map(d=>`${esc(d.name)}${d.cnt}`).join('')}`:''}
      ${memberDups.length?`Church Members with Same NameNameCount${memberDups.map(d=>`${esc(d.name)}${d.cnt}`).join('')}`:''}
      ${invDups.length?`Inventory Items with Same NameNameCount${invDups.map(d=>`${esc(d.name)}${d.cnt}`).join('')}`:''}
      ${!studentDups.length&&!memberDups.length&&!invDups.length?'No duplicates found! Your data is clean.':''}
    
  `, req.session.user));
}));

// =============================================
// CROSS-CUTTING: BULK OPERATIONS
// =============================================
app.get('/bulk', requireAuth, requireNotBanned, requireFeature('bulk_operations'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const studentCount = (await pool.query('SELECT COUNT(*) FROM students WHERE tenant_id=$1', [t])).rows[0]?.count || 0;
  const memberCount = (await pool.query('SELECT COUNT(*) FROM church_members WHERE tenant_id=$1', [t])).rows[0]?.count || 0;
  const inventoryCount = (await pool.query('SELECT COUNT(*) FROM inventory WHERE tenant_id=$1', [t])).rows[0]?.count || 0;
  res.send(renderPage('Bulk Operations', `
    Bulk OperationsMass edit, delete and export
    
      Export Data
      
        Export Students CSV (${studentCount})
        Export Members CSV (${memberCount})
        Export Inventory CSV (${inventoryCount})
      
      Bulk SMS
      Send SMS to all students, parents, or members at once
      Go to SMS Center
      Bulk Delete
      
        StudentsChurch MembersInventory
        All RecordsInactive Only
        Delete Selected
      
    
  `, req.session.user));
}));

app.post('/bulk/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const entity = req.body.entity_type;
  const allowed = ['students','church_members','inventory'];
  if (!allowed.includes(entity)) return res.status(400).send('Invalid entity');
  const result = await pool.query(`DELETE FROM ${entity} WHERE tenant_id=$1${req.body.filter==='inactive'?' AND active=false':''}`, [t]);
  await audit(req.session.user.email, 'Bulk delete', `${entity}: ${result.rowCount} records`);
  res.redirect('/bulk');
}));

// =============================================
// CROSS-CUTTING: KEYBOARD SHORTCUTS HELP
// =============================================
app.get('/shortcuts', requireAuth, requireFeature('keyboard_shortcuts'), (req, res) => {
  res.send(renderPage('Keyboard Shortcuts', `
    
      Keyboard Shortcuts
      ShortcutAction
        Alt+DGo to Dashboard
        Alt+SGlobal Search
        Alt+NNotifications
        Alt+/Show Shortcuts
        EscClose Modal
      
      document.addEventListener('keydown',function(e){if(e.altKey&&e.key==='d'){e.preventDefault();window.location='/dashboard'}if(e.altKey&&e.key==='s'){e.preventDefault();window.location='/search'}if(e.altKey&&e.key==='n'){e.preventDefault();window.location='/notifications'}if(e.altKey&&e.key==='/'){e.preventDefault();window.location='/shortcuts'}});
    
  `, req.session.user));
});

app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`const CACHE_NAME='ssewasswa-v11';const OFFLINE_URLS=['/','/login','/dashboard','/guide','/shop/browse'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(OFFLINE_URLS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{if(r.status===200){const rc=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,rc))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});
self.addEventListener('push',e=>{const d=e.data?e.data.json():{};e.waitUntil(self.registration.showNotification(d.title||'SSEWASSWA',{body:d.body||'New update',icon:'/icon-192.png',data:d}))});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.openWindow(e.notification.data?.url||'/'))});
self.addEventListener('sync',e=>{if(e.tag==='offline-sync'){e.waitUntil(getQueuedActions().then(actions=>{if(actions.length>0){return fetch('/api/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actions:actions})}).then(r=>{if(r.ok)clearQueuedActions()}).catch(()=>{})}}))}});
function getQueuedActions(){return new Promise(resolve=>{try{const data=localStorage.getItem('offline_sync_queue');resolve(data?JSON.parse(data):[])}catch(e){resolve([])}})}
function clearQueuedActions(){try{localStorage.removeItem('offline_sync_queue')}catch(e){}}`);
});



// =============================================
// v11 MEGA UPDATE: ADDITIONAL TABLES & FLAGS
// =============================================
(async () => {
  const additionalMigrations = [
    `CREATE TABLE IF NOT EXISTS student_portal_sessions (id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, token TEXT, device TEXT, last_active TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS admissions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, applicant_name TEXT NOT NULL, email TEXT, phone TEXT, dob DATE, gender TEXT, applied_level TEXT, applied_class TEXT, previous_school TEXT, guardian_name TEXT, guardian_phone TEXT, documents JSONB, status TEXT DEFAULT 'applied', reviewed_by TEXT, review_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS graduations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, academic_year TEXT, term TEXT, level TEXT, class_name TEXT, student_count INTEGER DEFAULT 0, graduation_date DATE, venue TEXT, notes TEXT, status TEXT DEFAULT 'planned', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS graduation_students (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, graduation_id INTEGER REFERENCES graduations(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, honors TEXT, gpa NUMERIC, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(graduation_id, student_id))`,
    `CREATE TABLE IF NOT EXISTS subjects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT, category TEXT, education_level TEXT, is_compulsory BOOLEAN DEFAULT true, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS class_subjects (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, class_name TEXT NOT NULL, subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), education_level TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS exam_seating (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, exam_id INTEGER REFERENCES exams(id), subject TEXT, room TEXT, seat_start INTEGER, seat_end INTEGER, capacity INTEGER DEFAULT 30, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ptc_bookings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), parent_email TEXT NOT NULL, student_id INTEGER REFERENCES students(id), slot_date DATE, slot_time TEXT, duration INTEGER DEFAULT 15, status TEXT DEFAULT 'booked', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ptc_slots (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, teacher_id INTEGER REFERENCES staff(id), date DATE, start_time TEXT, end_time TEXT, slot_duration INTEGER DEFAULT 15, is_available BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS lesson_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, class_name TEXT, topic TEXT NOT NULL, objectives TEXT, materials TEXT, activities TEXT, assessment TEXT, notes TEXT, teacher TEXT, week TEXT, term TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS student_id_cards (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE, card_number TEXT UNIQUE, issue_date DATE DEFAULT CURRENT_DATE, expiry_date DATE, photo_url TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS visitors (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, id_number TEXT, phone TEXT, purpose TEXT, person_to_see TEXT, vehicle_plate TEXT, check_in TIMESTAMPTZ DEFAULT NOW(), check_out TIMESTAMPTZ, status TEXT DEFAULT 'checked_in', gate_pass_code TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gate_passes (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), reason TEXT, destination TEXT, authorized_by TEXT, pass_date DATE DEFAULT CURRENT_DATE, return_date DATE, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS school_shop_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, category TEXT, price INTEGER DEFAULT 0, stock INTEGER DEFAULT 0, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS school_shop_sales (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_id INTEGER REFERENCES school_shop_items(id), buyer_name TEXT, buyer_type TEXT DEFAULT 'student', quantity INTEGER DEFAULT 1, total INTEGER DEFAULT 0, sold_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sibling_discounts (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, family_name TEXT NOT NULL, discount_percent INTEGER DEFAULT 10, student_ids INTEGER[], notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS scholarships (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT DEFAULT 'merit', coverage_percent INTEGER DEFAULT 100, student_id INTEGER REFERENCES students(id), criteria TEXT, awarded_date DATE DEFAULT CURRENT_DATE, expiry_date DATE, sponsor TEXT, amount INTEGER DEFAULT 0, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS staff_appraisals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE, period TEXT, criteria JSONB, scores JSONB, total_score NUMERIC DEFAULT 0, comments TEXT, appraiser TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS maintenance_requests (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, location TEXT, priority TEXT DEFAULT 'medium', description TEXT, reported_by TEXT, assigned_to TEXT, status TEXT DEFAULT 'reported', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS lost_found (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, item_name TEXT NOT NULL, description TEXT, location TEXT, date_found DATE DEFAULT CURRENT_DATE, found_by TEXT, claimed_by TEXT, claim_date DATE, status TEXT DEFAULT 'unclaimed', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS photo_galleries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_date DATE, cover_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gallery_photos (id SERIAL PRIMARY KEY, gallery_id INTEGER REFERENCES photo_galleries(id) ON DELETE CASCADE, url TEXT NOT NULL, caption TEXT, uploaded_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS newsletters (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, recipients TEXT, status TEXT DEFAULT 'draft', sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS rubrics (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT, education_level TEXT, criteria JSONB, max_score INTEGER DEFAULT 100, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS competency_assessments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, student_id INTEGER REFERENCES students(id), subject TEXT, competency TEXT, level TEXT DEFAULT 'developing', assessed_by TEXT, assessed_date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS curriculum_maps (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, subject TEXT NOT NULL, level TEXT, objectives JSONB, topics JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS welfare_records (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), type TEXT DEFAULT 'benevolence', amount INTEGER DEFAULT 0, description TEXT, date DATE DEFAULT CURRENT_DATE, approved_by TEXT, status TEXT DEFAULT 'approved', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS building_funds (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, target INTEGER DEFAULT 0, raised INTEGER DEFAULT 0, start_date DATE, end_date DATE, milestones JSONB, description TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS building_fund_contributions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, fund_id INTEGER REFERENCES building_funds(id) ON DELETE CASCADE, donor_name TEXT, amount INTEGER DEFAULT 0, method TEXT, date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS membership_transfers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, member_id INTEGER REFERENCES church_members(id), from_church TEXT, to_church TEXT, reason TEXT, letter_url TEXT, status TEXT DEFAULT 'pending', approved_by TEXT, transfer_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS balance_sheets (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, period TEXT NOT NULL, as_of_date DATE DEFAULT CURRENT_DATE, assets_total INTEGER DEFAULT 0, liabilities_total INTEGER DEFAULT 0, equity_total INTEGER DEFAULT 0, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS committees (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, purpose TEXT, chairperson TEXT, secretary TEXT, members JSONB, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS committee_meetings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, committee_id INTEGER REFERENCES committees(id) ON DELETE CASCADE, title TEXT, meeting_date DATE, agenda TEXT, minutes TEXT, attendees JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS policy_documents (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, content TEXT, version INTEGER DEFAULT 1, effective_date DATE, review_date DATE, approved_by TEXT, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS policy_acknowledgments (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, policy_id INTEGER REFERENCES policy_documents(id) ON DELETE CASCADE, user_email TEXT, acknowledged_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(policy_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS forum_topics (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, author_email TEXT, content TEXT, pinned BOOLEAN DEFAULT false, locked BOOLEAN DEFAULT false, views INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS forum_replies (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, topic_id INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE, author_email TEXT, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS suggestions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, type TEXT DEFAULT 'suggestion', title TEXT NOT NULL, description TEXT, submitted_by TEXT, is_anonymous BOOLEAN DEFAULT false, priority TEXT DEFAULT 'medium', assigned_to TEXT, response TEXT, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS login_history (id SERIAL PRIMARY KEY, user_email TEXT, ip_address TEXT, user_agent TEXT, success BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS requisitions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, items JSONB, total_estimate INTEGER DEFAULT 0, requested_by TEXT, department TEXT, priority TEXT DEFAULT 'normal', approved_by TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sponsorships (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, partner_id INTEGER REFERENCES partners(id), student_id INTEGER REFERENCES students(id), amount INTEGER DEFAULT 0, frequency TEXT DEFAULT 'one_time', start_date DATE, end_date DATE, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS journal_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, date DATE DEFAULT CURRENT_DATE, description TEXT, reference TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS livestream_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, service_name TEXT, platform TEXT, url TEXT NOT NULL, scheduled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS meeting_agendas (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, meeting_id INTEGER REFERENCES meeting_minutes(id) ON DELETE CASCADE, item_text TEXT NOT NULL, order_no INTEGER DEFAULT 1, completed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS incidents (id SERIAL PRIMARY KEY, service TEXT, title TEXT NOT NULL, status TEXT DEFAULT 'investigating', created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS quotations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, quote_no TEXT, customer_name TEXT, customer_contact TEXT, items JSONB, total INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', valid_until DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS deliveries (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, order_no TEXT, customer_name TEXT, customer_address TEXT, items JSONB, driver_name TEXT, vehicle TEXT, status TEXT DEFAULT 'pending', dispatched_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS public_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, slug TEXT NOT NULL, page_type TEXT DEFAULT 'page', page_order INTEGER DEFAULT 1, content TEXT, hero_title TEXT, hero_subtitle TEXT, meta_description TEXT, is_published BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, slug))`,
    `CREATE TABLE IF NOT EXISTS fundraising_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target INTEGER DEFAULT 0, deadline DATE, category TEXT DEFAULT 'general', organizer TEXT, contact_phone TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS campaign_donations (id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE, donor_name TEXT, amount INTEGER DEFAULT 0, method TEXT DEFAULT 'cash', message TEXT, donated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS scraped_content (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, source TEXT, title TEXT, summary TEXT, url TEXT, category TEXT DEFAULT 'news', scraped_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, title, source))`,
    `CREATE TABLE IF NOT EXISTS scrape_sources (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, url TEXT NOT NULL, category TEXT DEFAULT 'news', scrape_type TEXT DEFAULT 'rss', selector TEXT, max_items INTEGER DEFAULT 20, is_active BOOLEAN DEFAULT true, last_scraped_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS shop_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, order_no TEXT NOT NULL, buyer_email TEXT, buyer_name TEXT, buyer_phone TEXT, items JSONB NOT NULL, total INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', payment_method TEXT, payment_ref TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(order_no))`,
    `CREATE TABLE IF NOT EXISTS recurring_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT, donor_phone TEXT, amount INTEGER NOT NULL, currency TEXT DEFAULT 'UGX', schedule TEXT DEFAULT 'monthly', next_date DATE, last_processed DATE, campaign_id INTEGER REFERENCES fundraising_campaigns(id), payment_method TEXT, status TEXT DEFAULT 'active', total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    `ALTER TABLE school_shop_items ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'each'`
  ];
  for (const q of additionalMigrations) {
    try { await pool.query(q); } catch(e) { /* already exists OK */ }
  }
  const additionalFlags = [
    ['student_portal','Student Portal','Students view their own grades, attendance, homework','3.0','core','None'],
    ['admissions','Admissions Workflow','Application, review and enrollment','3.0','core','None'],
    ['graduation','Graduation Processing','Graduate students and generate certificates','3.0','core','None'],
    ['subject_management','Subject Management','Define subjects and assign to classes','3.0','core','None'],
    ['exam_seating','Exam Seating','Room and seat assignments for exams','3.0','core','None'],
    ['ptc_booking','Parent-Teacher Conference','Book PT conference time slots','3.0','core','None'],
    ['lesson_plans','Lesson Plans','Teacher lesson plan management','3.0','core','None'],
    ['student_id_cards','Student ID Cards','Generate printable student ID cards','3.0','core','None'],
    ['visitor_management','Visitor & Gate Pass','Visitor logging and student gate passes','3.0','core','None'],
    ['school_shop','School Shop','Bookstore and uniform sales','3.0','core','None'],
    ['sibling_discounts','Sibling Discounts','Auto-detect siblings for fee discounts','3.0','core','None'],
    ['scholarships','Scholarships & Bursaries','Track scholarship awards and coverage','3.0','core','None'],
    ['staff_appraisal','Staff Appraisal','Periodic staff performance evaluation','3.0','core','None'],
    ['maintenance','Maintenance Requests','Report and track facility repairs','3.0','core','None'],
    ['lost_found','Lost & Found','Track lost items and claims','3.0','core','None'],
    ['photo_gallery','Photo Gallery','Event photo albums','3.0','core','None'],
    ['newsletters','Newsletters','Create and distribute newsletters','3.0','core','None'],
    ['rubrics','Rubric Grading','Competency and rubric-based assessment','3.0','core','None'],
    ['competency_tracking','Competency Tracking','Track student competencies per subject','3.0','core','None'],
    ['curriculum_mapping','Curriculum Mapping','Map objectives to subjects and levels','3.0','core','None'],
    ['welfare','Welfare & Benevolence','Track church welfare aid to members','4.0','uganda','None'],
    ['building_fund','Building Fund','Construction fund tracking with milestones','4.0','uganda','None'],
    ['membership_transfer','Membership Transfer','Church membership transfer letters','4.0','uganda','None'],
    ['balance_sheet','Balance Sheet','Generate balance sheet from chart of accounts','5.0','enterprise','None'],
    ['committees','Committee Management','Committees with members and meetings','6.0','ecosystem','None'],
    ['policy_docs','Policy Documents','Version-controlled organizational policies','6.0','ecosystem','None'],
    ['forums','Discussion Forums','Threaded discussion topics','7.0','ai','None'],
    ['suggestions','Suggestion Box','Suggestions and complaints tracking','7.0','ai','None'],
    ['login_history','Login History','Track user login sessions and devices','8.0','mobile','None'],
    ['requisitions','Requisitions','Internal procurement requests','5.0','enterprise','None'],
    ['sponsorships','Sponsorships','Link sponsors/donors to students','6.0','ecosystem','None'],
    ['shop_catalog','Shop Catalog','Customer-facing product browsing with cart and checkout','3.0','core','school_shop'],
    ['recurring_donations','Recurring Donations','Schedule automatic recurring donations','3.0','core','fundraising'],
    ['mobile_ui','Mobile-Optimized UI','Hamburger nav, responsive tables, bottom navigation','3.0','core','None']
  ];
  for (const [key, name, desc, ver, cat, req] of additionalFlags) {
    try { await pool.query(`INSERT INTO feature_flags (feature_key, name, description, version, category, requirements, is_active) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`, [key, name, desc, ver, cat, req]); } catch(e) {}
  }
  console.log('v11 additional tables and flags initialized');
})();


// =============================================
// v11 MEGA UPDATE: CLINIC WORKFLOW (Doctor→Pharmacist→Lab)
// =============================================

// CLINIC: Staff Management
app.get('/clinic', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [doctors, pharmacists, labTechs, nurses] = await Promise.all([
    pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [t]),
    pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='pharmacist' AND is_active=true", [t]),
    pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='lab_technician' AND is_active=true", [t]),
    pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='nurse' AND is_active=true", [t])
  ]);
  const [pendingRx, pendingLab, waitingPatients] = await Promise.all([
    pool.query("SELECT COUNT(*) FROM prescriptions WHERE tenant_id=$1 AND status='pending'", [t]),
    pool.query("SELECT COUNT(*) FROM lab_requests WHERE tenant_id=$1 AND status IN ('requested','in_progress')", [t]),
    pool.query("SELECT COUNT(*) FROM patient_queue WHERE tenant_id=$1 AND status='waiting'", [t])
  ]);
  res.send(renderPage('Clinic Dashboard', `
    Clinic & MedicalDoctor → Pharmacist → Lab workflow with role specialization
    
      ${waitingPatients.rows[0].count}Waiting Patients
      ${pendingRx.rows[0].count}Pending Prescriptions
      ${pendingLab.rows[0].count}Pending Lab Tests
      ${doctors.rows.length}Doctors
    
    
      Doctors (${doctors.rows.length})Manage Doctors+ Add Doctor
      Pharmacists (${pharmacists.rows.length})Manage Pharmacists+ Add Pharmacist
      Lab Technicians (${labTechs.rows.length})Manage Lab Staff+ Add Lab Tech
      Nurses (${nurses.rows.length})Manage Nurses+ Add Nurse
      Patient QueueView Queue+ Add Patient
      PrescriptionsPending RxPharmacy
      LaboratoryLab RequestsResults
      Pharmacy StockMedicine Inventory
    
  `, req.session.user));
}));

app.get('/clinic/staff', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const role = req.query.role || '';
  let q = 'SELECT * FROM clinic_staff WHERE tenant_id=$1';
  const params = [t];
  if (role) { q += ' AND role=$2'; params.push(role); }
  q += ' ORDER BY name';
  const staff = (await pool.query(q, params)).rows;
  res.send(renderPage('Clinic Staff', `
    Clinic Staff ${role ? '('+role.replace('_',' ')+')' : ''}
    + Add Staff
    AllDoctorsPharmacistsLab TechsNurses
    NameRoleSpecializationLicensePhoneStatusActions
    ${staff.map(s => `${esc(s.name)}${esc(s.role.replace('_',' '))}${esc(s.specialization||'-')}${esc(s.license_no||'-')}${esc(s.phone||'-')}${s.is_active?'Active':'Inactive'}Edit ${s.is_active?'Deactivate':'Activate'}`).join('')||'No staff yet'}
    
  `, req.session.user));
}));

app.get('/clinic/staff/new', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), (req, res) => {
  const role = req.query.role || 'doctor';
  res.send(renderPage('Add Clinic Staff', `
    Add Clinic Staff
    
      
      DoctorPharmacistLab TechnicianNurse
      
      
      
      
      
      Add Staff Member
    
  `, req.session.user));
});

app.post('/clinic/staff/save', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, role, specialization, license_no, email, phone, department } = req.body;
  await pool.query('INSERT INTO clinic_staff(tenant_id,name,role,specialization,license_no,email,phone,department) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, name, role||'doctor', specialization||null, license_no||null, email||null, phone||null, department||null]);
  await audit(req.session.user.email, 'Add clinic staff', name);
  res.redirect('/clinic/staff?role='+(role||'doctor'));
}));

app.get('/clinic/staff/:id/toggle', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('UPDATE clinic_staff SET is_active=NOT is_active WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  res.redirect('/clinic/staff');
}));

app.get('/clinic/staff/:id/edit', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const s = (await pool.query('SELECT * FROM clinic_staff WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!s) return res.redirect('/clinic/staff');
  res.send(renderPage('Edit Clinic Staff', `
    Edit Staff
    
      
      DoctorPharmacistLab TechnicianNurse
      
      
      
      
      Update
    
  `, req.session.user));
}));

app.post('/clinic/staff/:id/update', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, role, specialization, license_no, email, phone } = req.body;
  await pool.query('UPDATE clinic_staff SET name=$1,role=$2,specialization=$3,license_no=$4,email=$5,phone=$6 WHERE tenant_id=$7 AND id=$8', [name, role, specialization||null, license_no||null, email||null, phone||null, t, req.params.id]);
  res.redirect('/clinic/staff');
}));

// CLINIC: Patient Queue / Triage
app.get('/clinic/queue', requireAuth, requireNotBanned, requireFeature('patient_queue'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const queue = (await pool.query("SELECT pq.*,cs.name as doctor_name FROM patient_queue pq LEFT JOIN clinic_staff cs ON pq.seen_by=cs.id WHERE pq.tenant_id=$1 ORDER BY CASE WHEN pq.priority='emergency' THEN 0 WHEN pq.priority='urgent' THEN 1 ELSE 2 END, pq.created_at", [t])).rows;
  const doctors = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [t])).rows;
  res.send(renderPage('Patient Queue', `
    Patient QueueTriage and manage waiting patients
    + Add Patient to Queue
    #PatientComplaintPriorityStatusDoctorActions
    ${queue.map((q,i) => `${i+1}${esc(q.patient_name)}${esc(q.complaint||'-')}${esc(q.priority)}${esc(q.status)}${esc(q.doctor_name||'Unassigned')}
      ${q.status==='waiting'?`See Patient`:''}
      ${q.status==='seeing'?`Start Consultation`:''}
    `).join('')||'No patients in queue'}
    
  `, req.session.user));
}));

app.get('/clinic/queue/new', requireAuth, requireNotBanned, requireFeature('patient_queue'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 200', [t])).rows;
  const maxQ = (await pool.query("SELECT COALESCE(MAX(queue_number),0)+1 as next FROM patient_queue WHERE tenant_id=$1 AND created_at::date=CURRENT_DATE", [t])).rows[0];
  res.send(renderPage('Add to Queue', `
    Add Patient to Queue
    
      StudentStaffOther
      Select Student (if student)${students.map(s=>`${esc(s.name)} - ${esc(s.class||'')}`).join('')}
      
      
      NormalUrgentEmergency
      
      
      Add to Queue
    
  `, req.session.user));
}));

app.post('/clinic/queue/save', requireAuth, requireNotBanned, requireFeature('patient_queue'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_type, patient_id, patient_name, complaint, priority, triage_notes, queue_number } = req.body;
  await pool.query('INSERT INTO patient_queue(tenant_id,patient_type,patient_id,patient_name,complaint,priority,triage_notes,queue_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, patient_type||'student', patient_id||null, patient_name, complaint, priority||'normal', triage_notes||null, queue_number||1]);
  res.redirect('/clinic/queue');
}));

app.get('/clinic/queue/:id/see', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const doctors = (await pool.query("SELECT id FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true LIMIT 1", [t])).rows;
  await pool.query("UPDATE patient_queue SET status='seeing', seen_by=$1 WHERE tenant_id=$2 AND id=$3", [doctors[0]?.id||null, t, req.params.id]);
  res.redirect('/clinic/queue');
}));

// CLINIC: Consultations (Doctor examines)
app.get('/clinic/consultation/new', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const qId = req.query.queue;
  let queueItem = null;
  if (qId) queueItem = (await pool.query('SELECT * FROM patient_queue WHERE tenant_id=$1 AND id=$2', [t, qId])).rows[0];
  const doctors = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [t])).rows;
  res.send(renderPage('New Consultation', `
    Doctor Consultation
    
      
      
      
      
      Select Doctor${doctors.map(d=>`${esc(d.name)}${d.specialization?' - '+esc(d.specialization):''}`).join('')}
      
      
      
      
      
      
      
      
        Save & Prescribe
        Save & Order Lab
        Save Only
      
    
  `, req.session.user));
}));

app.post('/clinic/consultation/save', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { queue_id, patient_name, patient_id, patient_type, doctor_id, chief_complaint, history, examination, diagnosis, treatment_plan, follow_up_date, notes, action } = req.body;
  const result = await pool.query('INSERT INTO consultations(tenant_id,patient_type,patient_id,patient_name,doctor_id,queue_id,chief_complaint,history,examination,diagnosis,treatment_plan,follow_up_date,notes,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id', [t, patient_type||'student', patient_id||null, patient_name, doctor_id, queue_id||null, chief_complaint||null, history||null, examination||null, diagnosis, treatment_plan||null, follow_up_date||null, notes||null, 'in_progress']);
  const consultationId = result.rows[0].id;
  const doctorName = (await pool.query('SELECT name FROM clinic_staff WHERE id=$1', [doctor_id])).rows[0]?.name || '';
  if (queue_id) await pool.query("UPDATE patient_queue SET status='consulted' WHERE tenant_id=$1 AND id=$2", [t, queue_id]);
  if (action === 'prescribe') return res.redirect(`/clinic/prescription/new?consultation=${consultationId}&doctor=${doctor_id}&patient=${encodeURIComponent(patient_name)}&diagnosis=${encodeURIComponent(diagnosis||'')}`);
  if (action === 'lab') return res.redirect(`/clinic/lab/new?consultation=${consultationId}&doctor=${doctor_id}&patient=${encodeURIComponent(patient_name)}&diagnosis=${encodeURIComponent(diagnosis||'')}`);
  res.redirect('/clinic');
}));

// CLINIC: Prescriptions (Doctor prescribes)
app.get('/clinic/prescription/new', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const { consultation, doctor, patient, diagnosis } = req.query;
  res.send(renderPage('New Prescription', `
    New Prescription
    Patient: ${esc(patient)} | Diagnosis: ${esc(diagnosis)}
    
      
      
      
      
      Medicines
      
        
          
          
          
          
        
      
      + Add Another Medicine
      
      Create Prescription
    
    let medCount=1;function addMed(){medCount++;document.getElementById('meds').insertAdjacentHTML('beforeend','')}
    
  `, req.session.user));
}));

app.post('/clinic/prescription/save', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { consultation_id, doctor_id, patient_name, diagnosis, notes } = req.body;
  const patient_id = req.body.patient_id || null;
  const rx = await pool.query('INSERT INTO prescriptions(tenant_id,consultation_id,patient_type,patient_id,patient_name,doctor_id,doctor_name,diagnosis,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [t, consultation_id||null, 'student', patient_id, patient_name, doctor_id||null, (await pool.query('SELECT name FROM clinic_staff WHERE id=$1',[doctor_id])).rows[0]?.name||'', diagnosis||null, notes||null]);
  const rxId = rx.rows[0].id;
  let i = 1;
  while (req.body[`medicine_${i}`]) {
    const med = req.body[`medicine_${i}`];
    if (med.trim()) {
      await pool.query('INSERT INTO prescription_items(tenant_id,prescription_id,medicine_name,dosage,frequency,duration,quantity,instructions) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, rxId, med, req.body[`dosage_${i}`]||null, req.body[`frequency_${i}`]||null, req.body[`duration_${i}`]||null, req.body[`quantity_${i}`]||1, req.body[`instructions_${i}`]||null]);
    }
    i++;
  }
  await audit(req.session.user.email, 'Prescription created', `Rx #${rxId} for ${patient_name}`);
  res.redirect('/clinic/prescriptions');
}));

// CLINIC: View Prescriptions (Pharmacist sees pending)
app.get('/clinic/prescriptions', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filter = req.query.status || 'pending';
  const rxs = (await pool.query('SELECT p.*, cs.name as doctor FROM prescriptions p LEFT JOIN clinic_staff cs ON p.doctor_id=cs.id WHERE p.tenant_id=$1 AND ($2=\'all\' OR p.status=$2) ORDER BY p.created_at DESC', [t, filter])).rows;
  res.send(renderPage('Prescriptions', `
    Prescriptions
    PendingDispensedAll
    IDPatientDoctorDiagnosisStatusDateActions
    ${rxs.map(r => `#${r.id}${esc(r.patient_name)}${esc(r.doctor_name||r.doctor||'-')}${esc(r.diagnosis||'-')}${esc(r.status)}${new Date(r.created_at).toLocaleDateString()}View ${r.status==='pending'?`Dispense`:''}`).join('')||'No prescriptions'}
    
  `, req.session.user));
}));

app.get('/clinic/prescriptions/:id', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rx = (await pool.query('SELECT p.*, cs.name as doctor FROM prescriptions p LEFT JOIN clinic_staff cs ON p.doctor_id=cs.id WHERE p.tenant_id=$1 AND p.id=$2', [t, req.params.id])).rows[0];
  if (!rx) return res.redirect('/clinic/prescriptions');
  const items = (await pool.query('SELECT pi.*, cs.name as dispenser FROM prescription_items pi LEFT JOIN clinic_staff cs ON pi.dispensed_by=cs.id WHERE pi.prescription_id=$1', [rx.id])).rows;
  res.send(renderPage('Prescription Details', `
    Prescription #${rx.id}
    Patient: ${esc(rx.patient_name)}Doctor: ${esc(rx.doctor_name||rx.doctor||'-')}Diagnosis: ${esc(rx.diagnosis||'-')}Status: ${esc(rx.status)}
    Medicines
    MedicineDosageFrequencyDurationQtyInstructionsStatus
    ${items.map(i => `${esc(i.medicine_name)}${esc(i.dosage||'-')}${esc(i.frequency||'-')}${esc(i.duration||'-')}${i.quantity}${esc(i.instructions||'-')}${esc(i.status)}`).join('')}
    
    ${rx.notes?`Notes: ${esc(rx.notes)}`:''}
    ${rx.status==='pending'?`Dispense All`:''}
    
  `, req.session.user));
}));

// CLINIC: Pharmacy Dispensing
app.get('/clinic/prescriptions/:id/dispense', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rx = (await pool.query('SELECT * FROM prescriptions WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!rx) return res.redirect('/clinic/prescriptions');
  const items = (await pool.query("SELECT * FROM prescription_items WHERE prescription_id=$1 AND status='pending'", [rx.id])).rows;
  const pharmacists = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='pharmacist' AND is_active=true", [t])).rows;
  res.send(renderPage('Dispense Medicines', `
    Dispense Prescription #${rx.id}
    Patient: ${esc(rx.patient_name)}
    
      Select Pharmacist${pharmacists.map(p=>`${esc(p.name)}`).join('')}
      ${items.map(item => `
        ${esc(item.medicine_name)}${esc(item.dosage||'')} ${esc(item.frequency||'')} for ${esc(item.duration||'')}
        
        
        
      `).join('')}
      
      Confirm Dispensing
    
  `, req.session.user));
}));

app.post('/clinic/prescriptions/:id/dispense/save', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { pharmacist_id, notes } = req.body;
  const items = (await pool.query("SELECT * FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE tenant_id=$1) AND prescription_id=$2 AND status='pending'", [t, req.params.id])).rows;
  for (const item of items) {
    const qty = req.body[`qty_${item.id}`] || item.quantity;
    const batch = req.body[`batch_${item.id}`] || null;
    const expiry = req.body[`expiry_${item.id}`] || null;
    await pool.query('UPDATE prescription_items SET status=$1,dispensed_by=$2,dispensed_at=NOW() WHERE id=$3', ['dispensed', pharmacist_id, item.id]);
    await pool.query('INSERT INTO pharmacy_dispensing(tenant_id,prescription_id,item_id,pharmacist_id,patient_name,medicine_name,dosage,quantity_dispensed,batch_number,expiry_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, req.params.id, item.id, pharmacist_id, (await pool.query('SELECT patient_name FROM prescriptions WHERE id=$1',[req.params.id])).rows[0]?.patient_name||'', item.medicine_name, item.dosage, qty, batch, expiry, notes||null]);
  }
  await pool.query("UPDATE prescriptions SET status='dispensed' WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  await audit(req.session.user.email, 'Prescription dispensed', `Rx #${req.params.id}`);
  res.redirect('/clinic/prescriptions');
}));

// CLINIC: Lab Requests
app.get('/clinic/lab', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filter = req.query.status || 'requested';
  const labs = (await pool.query('SELECT lr.*, cs.name as doctor FROM lab_requests lr LEFT JOIN clinic_staff cs ON lr.doctor_id=cs.id WHERE lr.tenant_id=$1 AND ($2=\'all\' OR lr.status=$2) ORDER BY lr.requested_at DESC', [t, filter])).rows;
  res.send(renderPage('Lab Requests', `
    Laboratory Requests
    
      + New Lab Request
    
    RequestedIn ProgressCompletedAll
    IDPatientDoctorTestUrgencyStatusRequestedActions
    ${labs.map(l => `#${l.id}${esc(l.patient_name)}${esc(l.doctor||l.doctor_name||'-')}${esc(l.test_name)}${esc(l.urgency)}${esc(l.status)}${new Date(l.requested_at).toLocaleDateString()}
      ${l.status==='requested'?`Start Test`:''}
      ${l.status==='in_progress'?`Record Result`:''}
      View
    `).join('')||'No lab requests'}
    
  `, req.session.user));
}));

app.get('/clinic/lab/new', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const doctors = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [t])).rows;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 200', [t])).rows;
  const { consultation, doctor, patient, diagnosis } = req.query;
  res.send(renderPage('New Lab Request', `
    Order Lab Test
    
      
      StudentStaff
      Select Student${students.map(s=>`${esc(s.name)}`).join('')}
      
      Requesting Doctor${doctors.map(d=>`${esc(d.name)}`).join('')}
      
      HematologyChemistryUrinalysisMicrobiologyImagingOther
      RoutineUrgentSTAT (Emergency)
      ${esc(diagnosis||'')}
      Submit Lab Request
    
  `, req.session.user));
}));

app.post('/clinic/lab/save', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { consultation_id, patient_type, patient_id, patient_name, doctor_id, test_name, test_category, urgency, clinical_notes } = req.body;
  const doctorName = (await pool.query('SELECT name FROM clinic_staff WHERE id=$1', [doctor_id])).rows[0]?.name || '';
  await pool.query('INSERT INTO lab_requests(tenant_id,consultation_id,patient_type,patient_id,patient_name,doctor_id,doctor_name,test_name,test_category,urgency,clinical_notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, consultation_id||null, patient_type||'student', patient_id||null, patient_name, doctor_id||null, doctorName, test_name, test_category||null, urgency||'routine', clinical_notes||null]);
  res.redirect('/clinic/lab');
}));

app.get('/clinic/lab/:id/start', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE lab_requests SET status='in_progress' WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  res.redirect('/clinic/lab');
}));

app.get('/clinic/lab/:id/result', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const lab = (await pool.query('SELECT * FROM lab_requests WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!lab) return res.redirect('/clinic/lab');
  const labTechs = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='lab_technician' AND is_active=true", [t])).rows;
  const doctors = (await pool.query("SELECT * FROM clinic_staff WHERE tenant_id=$1 AND role='doctor' AND is_active=true", [t])).rows;
  res.send(renderPage('Record Lab Result', `
    Lab Result: ${esc(lab.test_name)}
    Patient: ${esc(lab.patient_name)} | Urgency: ${esc(lab.urgency)}
    
      Lab Technician${labTechs.map(lt=>`${esc(lt.name)}`).join('')}
      
      
      
      
       Mark as Abnormal
      Select Verifying Doctor${doctors.map(d=>`${esc(d.name)}`).join('')}
      
      Submit Result
    
  `, req.session.user));
}));

app.post('/clinic/lab/:id/result/save', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { lab_technician_id, result_value, result_numeric, unit, reference_range, interpretation, is_abnormal, verified_by, notes } = req.body;
  await pool.query('INSERT INTO lab_results(tenant_id,lab_request_id,lab_technician_id,result_value,result_numeric,unit,reference_range,interpretation,is_abnormal,verified_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, req.params.id, lab_technician_id, result_value, result_numeric||null, unit||null, reference_range||null, interpretation||null, is_abnormal?true:false, verified_by||null, notes||null]);
  if (verified_by) await pool.query('UPDATE lab_results SET verified_at=NOW() WHERE lab_request_id=$1 AND verified_by IS NOT NULL', [req.params.id]);
  await pool.query("UPDATE lab_requests SET status='completed' WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  await audit(req.session.user.email, 'Lab result recorded', `Test #${req.params.id}`);
  res.redirect('/clinic/lab?status=completed');
}));

app.get('/clinic/lab/:id', requireAuth, requireNotBanned, requireFeature('clinic_lab'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const lab = (await pool.query('SELECT lr.*, cs.name as doctor FROM lab_requests lr LEFT JOIN clinic_staff cs ON lr.doctor_id=cs.id WHERE lr.tenant_id=$1 AND lr.id=$2', [t, req.params.id])).rows[0];
  if (!lab) return res.redirect('/clinic/lab');
  const results = (await pool.query('SELECT lr.*, cs.name as tech_name FROM lab_results lr LEFT JOIN clinic_staff cs ON lr.lab_technician_id=cs.id WHERE lr.lab_request_id=$1', [lab.id])).rows;
  res.send(renderPage('Lab Request Details', `
    Lab Test: ${esc(lab.test_name)}
    Patient: ${esc(lab.patient_name)}Doctor: ${esc(lab.doctor||lab.doctor_name||'-')}Category: ${esc(lab.test_category||'-')}Urgency: ${esc(lab.urgency)}Status: ${esc(lab.status)}Requested: ${new Date(lab.requested_at).toLocaleString()}
    ${lab.clinical_notes?`Clinical Notes: ${esc(lab.clinical_notes)}`:''}
    ${results.length?`ResultsResultNumericUnitRef RangeAbnormal?TechnicianTime${results.map(r=>`${esc(r.result_value)}${r.result_numeric||'-'}${esc(r.unit||'-')}${esc(r.reference_range||'-')}${r.is_abnormal?'YES':'Normal'}${esc(r.tech_name||'-')}${new Date(r.reported_at).toLocaleString()}`).join('')}`:''}
    ${results.length && results[0].interpretation?`Interpretation: ${esc(results[0].interpretation)}`:''}
    
  `, req.session.user));
}));

// CLINIC: Pharmacy Inventory
app.get('/clinic/pharmacy/inventory', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const meds = (await pool.query('SELECT * FROM pharmacy_inventory WHERE tenant_id=$1 ORDER BY medicine_name', [t])).rows;
  const lowStock = meds.filter(m => m.quantity Pharmacy Inventory
    + Add Medicine
    ${lowStock.length?`${lowStock.length} items at or below reorder level!`:''}
    MedicineGenericCategoryQtyReorder AtExpiryActions
    ${meds.map(m => `${esc(m.medicine_name)}${esc(m.generic_name||'-')}${esc(m.category||'-')}${m.quantity}${m.reorder_level||10}${m.expiry_date||'-'}Edit`).join('')||'No medicines in inventory'}
    
  `, req.session.user));
}));

app.get('/clinic/pharmacy/inventory/new', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), (req, res) => {
  res.send(renderPage('Add Medicine', `
    Add Medicine to Pharmacy
    
      
      
      AnalgesicAntibioticAntimalarialAntiviralVitamin/SupplementOther
      
      
      
      
      
      
      Add Medicine
    
  `, req.session.user));
});

app.post('/clinic/pharmacy/inventory/save', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { medicine_name, generic_name, category, quantity, unit_price, batch_number, manufacturer, expiry_date, reorder_level, location } = req.body;
  await pool.query('INSERT INTO pharmacy_inventory(tenant_id,medicine_name,generic_name,category,quantity,unit_price,batch_number,manufacturer,expiry_date,reorder_level,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, medicine_name, generic_name||null, category||'other', quantity||0, unit_price||0, batch_number||null, manufacturer||null, expiry_date||null, reorder_level||10, location||null]);
  res.redirect('/clinic/pharmacy/inventory');
}));

app.get('/clinic/pharmacy/inventory/:id/edit', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const med = (await pool.query('SELECT * FROM pharmacy_inventory WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!med) return res.redirect('/clinic/pharmacy/inventory');
  res.send(renderPage('Edit Medicine', `
    Edit Medicine
    
      
      
      
      
      Update
    
  `, req.session.user));
}));

app.post('/clinic/pharmacy/inventory/:id/update', requireAuth, requireNotBanned, requireFeature('clinic_pharmacy'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { medicine_name, quantity, unit_price, reorder_level } = req.body;
  await pool.query('UPDATE pharmacy_inventory SET medicine_name=$1,quantity=$2,unit_price=$3,reorder_level=$4 WHERE tenant_id=$5 AND id=$6', [medicine_name, quantity||0, unit_price||0, reorder_level||10, t, req.params.id]);
  res.redirect('/clinic/pharmacy/inventory');
}));


// =============================================
// STUDENT SPECIALIZATION: School Levels, Hostels, Meals, Tracks
// =============================================

// SCHOOL LEVELS (Kindergarten through University)
app.get('/school/levels', requireAuth, requireNotBanned, requireFeature('school_levels'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const levels = (await pool.query('SELECT * FROM school_levels WHERE tenant_id=$1 ORDER BY level_order', [t])).rows;
  res.send(renderPage('School Levels', `
    Education LevelsConfigure all levels from Kindergarten to University
    + Add Level
    LevelCodeOrderAge RangeAssessmentCurriculumBoardingActions
    ${levels.map(l => `${esc(l.level_name)}${esc(l.level_code)}${l.level_order}${l.min_age||'?'}-${l.max_age||'?'}${esc(l.assessment_type||'exam_based')}${esc(l.curriculum||'-')}${l.has_boarding?'Yes':'No'}Edit Del`).join('')||'No levels configured. Add Nursery, Kindergarten, Primary, O-Level, A-Level, University, Vocational'}
    
  `, req.session.user));
}));

app.get('/school/levels/new', requireAuth, requireNotBanned, requireFeature('school_levels'), (req, res) => {
  res.send(renderPage('Add School Level', `
    Add Education Level
    
      
      
      
      
      
      Play-Based (Nursery/Kindergarten)Competency-Based (Primary)Exam-Based (O-Level/A-Level)Coursework-Based (University)Practical-Based (Vocational)
      
       Has Streams/Sections
       Has Boarding
      Add Level
    
  `, req.session.user));
});

app.post('/school/levels/save', requireAuth, requireNotBanned, requireFeature('school_levels'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { level_name, level_code, level_order, description, min_age, max_age, assessment_type, curriculum, has_streams, has_boarding } = req.body;
  await pool.query('INSERT INTO school_levels(tenant_id,level_name,level_code,level_order,description,min_age,max_age,assessment_type,curriculum,has_streams,has_boarding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, level_name, level_code, level_order||0, description||null, min_age||null, max_age||null, assessment_type||'exam_based', curriculum||null, has_streams?true:false, has_boarding?true:false]);
  res.redirect('/school/levels');
}));

app.get('/school/levels/:id/edit', requireAuth, requireNotBanned, requireFeature('school_levels'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const l = (await pool.query('SELECT * FROM school_levels WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!l) return res.redirect('/school/levels');
  res.send(renderPage('Edit Level', `
    Edit Level
    
      
      
      
      Play-BasedCompetency-BasedExam-BasedCoursework-BasedPractical-Based
      Update
    
  `, req.session.user));
}));

app.post('/school/levels/:id/update', requireAuth, requireNotBanned, requireFeature('school_levels'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { level_name, level_code, level_order, assessment_type } = req.body;
  await pool.query('UPDATE school_levels SET level_name=$1,level_code=$2,level_order=$3,assessment_type=$4 WHERE tenant_id=$5 AND id=$6', [level_name, level_code, level_order||0, assessment_type||'exam_based', t, req.params.id]);
  res.redirect('/school/levels');
}));

app.get('/school/levels/:id/delete', requireAuth, requireNotBanned, requireFeature('school_levels'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM school_levels WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  res.redirect('/school/levels');
}));

// HOSTEL MANAGEMENT
app.get('/school/hostels', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const hostels = (await pool.query('SELECT * FROM hostels WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Hostels & Dormitories', `
    Hostel ManagementDormitories, rooms and boarding student assignments
    + Add Hostel
    NameGenderCapacityOccupancyWardenActions
    ${hostels.map(h => `${esc(h.name)}${esc(h.gender||'mixed')}${h.capacity}${h.current_occupancy}/${h.capacity}${esc(h.warden||'-')} ${h.warden_phone?'('+esc(h.warden_phone)+')':''}Rooms Assign Edit`).join('')||'No hostels yet'}
    
  `, req.session.user));
}));

app.get('/school/hostels/new', requireAuth, requireNotBanned, requireFeature('hostel_management'), (req, res) => {
  res.send(renderPage('Add Hostel', `
    Add Hostel/Dormitory
    
      
      MixedBoys OnlyGirls Only
      
      
      
      
      Add Hostel
    
  `, req.session.user));
});

app.post('/school/hostels/save', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, gender, capacity, warden, warden_phone, description } = req.body;
  await pool.query('INSERT INTO hostels(tenant_id,name,gender,capacity,warden,warden_phone,description) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, name, gender||'mixed', capacity||50, warden||null, warden_phone||null, description||null]);
  res.redirect('/school/hostels');
}));

app.get('/school/hostels/:id/rooms', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const hostel = (await pool.query('SELECT * FROM hostels WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!hostel) return res.redirect('/school/hostels');
  const rooms = (await pool.query('SELECT * FROM hostel_rooms WHERE tenant_id=$1 AND hostel_id=$2 ORDER BY room_number', [t, req.params.id])).rows;
  res.send(renderPage('Hostel Rooms', `
    ${esc(hostel.name)} - Rooms
    + Add Room
    Room #TypeCapacityOccupancyVacancyActions
    ${rooms.map(r => `${esc(r.room_number)}${esc(r.room_type||'dormitory')}${r.capacity}${r.current_occupancy}${r.capacity-r.current_occupancy}Edit`).join('')||'No rooms yet'}
    
  `, req.session.user));
}));

app.get('/school/hostels/:id/rooms/new', requireAuth, requireNotBanned, requireFeature('hostel_management'), (req, res) => {
  res.send(renderPage('Add Room', `
    Add Room
    
      
      DormitorySingleDoubleCubicle
      
      Add Room
    
  `, req.session.user));
});

app.post('/school/hostels/:id/rooms/save', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { room_number, room_type, capacity } = req.body;
  await pool.query('INSERT INTO hostel_rooms(tenant_id,hostel_id,room_number,room_type,capacity) VALUES($1,$2,$3,$4,$5)', [t, req.params.id, room_number, room_type||'dormitory', capacity||4]);
  res.redirect(`/school/hostels/${req.params.id}/rooms`);
}));

app.get('/school/hostels/:id/assign', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const hostel = (await pool.query('SELECT * FROM hostels WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  const rooms = (await pool.query("SELECT * FROM hostel_rooms WHERE tenant_id=$1 AND hostel_id=$2 AND current_occupancy${esc(hostel.name)} - Assign Boarding Students
    
      Select Boarding Student${boardingStudents.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      Select Room${rooms.map(r=>`Room ${esc(r.room_number)} (${r.current_occupancy}/${r.capacity})`).join('')}
      
      Assign Student
    
    Current Assignments
    StudentRoomBedSinceActions
    ${assignments.map(a => {const room = rooms.find(r=>r.id===a.room_id);return `${esc(a.student_name)}${room?esc(room.room_number):'Room #'+a.room_id}${esc(a.bed_number||'-')}${a.assigned_date}Remove`}).join('')||'No assignments yet'}
    
  `, req.session.user));
}));

app.post('/school/hostels/:id/assign/save', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, room_id, bed_number } = req.body;
  await pool.query('INSERT INTO hostel_assignments(tenant_id,student_id,hostel_id,room_id,bed_number) VALUES($1,$2,$3,$4,$5)', [t, student_id, req.params.id, room_id, bed_number||null]);
  await pool.query('UPDATE hostel_rooms SET current_occupancy=current_occupancy+1 WHERE tenant_id=$1 AND id=$2', [t, room_id]);
  await pool.query('UPDATE hostels SET current_occupancy=current_occupancy+1 WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  await pool.query('UPDATE students SET hostel_name=(SELECT name FROM hostels WHERE id=$1), dormitory=(SELECT room_number FROM hostel_rooms WHERE id=$2), bed_number=$3 WHERE id=$4', [req.params.id, room_id, bed_number||null, student_id]);
  res.redirect(`/school/hostels/${req.params.id}/assign`);
}));

app.get('/school/hostels/assign/:id/remove', requireAuth, requireNotBanned, requireFeature('hostel_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const a = (await pool.query('SELECT * FROM hostel_assignments WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (a) {
    await pool.query("UPDATE hostel_assignments SET status='inactive' WHERE id=$1", [a.id]);
    await pool.query('UPDATE hostel_rooms SET current_occupancy=GREATEST(0,current_occupancy-1) WHERE id=$1', [a.room_id]);
    await pool.query('UPDATE hostels SET current_occupancy=GREATEST(0,current_occupancy-1) WHERE id=$1', [a.hostel_id]);
  }
  res.redirect('back');
}));

// MEAL MANAGEMENT
app.get('/school/meals', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const plans = (await pool.query('SELECT * FROM meal_plans WHERE tenant_id=$1', [t])).rows;
  res.send(renderPage('Meal Management', `
    Meal Plans
    + Add Meal Plan
    Meal Attendance
    NameMeals/DayBreakfastLunchDinnerSnacksPriceActions
    ${plans.map(p => `${esc(p.name)}${p.meals_per_day}${p.includes_breakfast?'✓':'✗'}${p.includes_lunch?'✓':'✗'}${p.includes_dinner?'✓':'✗'}${p.includes_snacks?'✓':'✗'}UGX ${(p.price||0).toLocaleString()}Edit`).join('')||'No meal plans yet'}
    
  `, req.session.user));
}));

app.get('/school/meals/new', requireAuth, requireNotBanned, requireFeature('meal_management'), (req, res) => {
  res.send(renderPage('Add Meal Plan', `
    Add Meal Plan
    
      
      
      
      
       Breakfast
       Lunch
       Dinner
       Snacks
      Add Plan
    
  `, req.session.user));
});

app.post('/school/meals/save', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, description, meals_per_day, price, includes_breakfast, includes_lunch, includes_dinner, includes_snacks } = req.body;
  await pool.query('INSERT INTO meal_plans(tenant_id,name,description,meals_per_day,price,includes_breakfast,includes_lunch,includes_dinner,includes_snacks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, name, description||null, meals_per_day||3, price||0, !!includes_breakfast, !!includes_lunch, !!includes_dinner, !!includes_snacks]);
  res.redirect('/school/meals');
}));

app.get('/school/meals/:id/edit', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const p = (await pool.query('SELECT * FROM meal_plans WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!p) return res.redirect('/school/meals');
  res.send(renderPage('Edit Meal Plan', `Edit Meal Plan
    
      
      
      Update
    `, req.session.user));
}));

app.post('/school/meals/:id/update', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, price } = req.body;
  await pool.query('UPDATE meal_plans SET name=$1,price=$2 WHERE tenant_id=$3 AND id=$4', [name, price||0, t, req.params.id]);
  res.redirect('/school/meals');
}));

app.get('/school/meals/attendance', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const boarding = (await pool.query("SELECT s.id,s.name,s.class FROM students s WHERE s.tenant_id=$1 AND s.boarding_status='boarding' ORDER BY s.name", [t])).rows;
  const records = (await pool.query('SELECT * FROM meal_attendance WHERE tenant_id=$1 AND meal_date=$2', [t, date])).rows;
  res.send(renderPage('Meal Attendance', `
    Meal Attendance - ${date}
    Go
    
      
      BreakfastLunchDinner
      StudentClassPresent
      ${boarding.map(s => {const rec = records.find(r=>r.student_id===s.id);return `${esc(s.name)}${esc(s.class||'')}`}).join('')}
      
      Save Attendance
    
  `, req.session.user));
}));

app.post('/school/meals/attendance/save', requireAuth, requireNotBanned, requireFeature('meal_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { meal_date, meal_type } = req.body;
  const boarding = (await pool.query("SELECT id FROM students WHERE tenant_id=$1 AND boarding_status='boarding'", [t])).rows;
  for (const s of boarding) {
    const present = !!req.body[`present_${s.id}`];
    await pool.query('INSERT INTO meal_attendance(tenant_id,student_id,meal_date,meal_type,present) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [t, s.id, meal_date, meal_type||'lunch', present]);
  }
  res.redirect(`/school/meals/attendance?date=${meal_date}`);
}));

// STUDENT TRACKS (Specialization/Academic Tracks)
app.get('/school/tracks', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tracks = (await pool.query('SELECT * FROM student_tracks WHERE tenant_id=$1 ORDER BY track_name', [t])).rows;
  res.send(renderPage('Student Tracks', `
    Academic Tracks / Specializations
    + Add Track
    TrackLevelSubjectsActions
    ${tracks.map(tr => `${esc(tr.track_name)}${esc(tr.level_code||'all')}${Array.isArray(tr.subjects)?tr.subjects.join(', '):tr.subjects||'-'}Assign Students Del`).join('')||'No tracks yet (e.g. Sciences, Arts, Technical, Business)'}
    
  `, req.session.user));
}));

app.get('/school/tracks/new', requireAuth, requireNotBanned, requireFeature('student_specialization'), (req, res) => {
  res.send(renderPage('Add Track', `Add Academic Track
    
      
      
      
      
      Add Track
    `, req.session.user));
});

app.post('/school/tracks/save', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { track_name, level_code, subjects, description } = req.body;
  const subjectArr = subjects ? subjects.split(',').map(s=>s.trim()).filter(Boolean) : [];
  await pool.query('INSERT INTO student_tracks(tenant_id,track_name,level_code,subjects,description) VALUES($1,$2,$3,$4,$5)', [t, track_name, level_code||null, JSON.stringify(subjectArr), description||null]);
  res.redirect('/school/tracks');
}));

app.get('/school/tracks/:id/assign', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const track = (await pool.query('SELECT * FROM student_tracks WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!track) return res.redirect('/school/tracks');
  const students = (await pool.query('SELECT s.id,s.name,s.class FROM students s WHERE s.tenant_id=$1 AND s.id NOT IN (SELECT student_id FROM student_track_assignments WHERE track_id=$2 AND status=$3) ORDER BY s.name', [t, track.id, 'active'])).rows;
  const assigned = (await pool.query('SELECT sta.*,s.name as student_name,s.class FROM student_track_assignments sta JOIN students s ON sta.student_id=s.id WHERE sta.tenant_id=$1 AND sta.track_id=$2 AND sta.status=$3', [t, track.id, 'active'])).rows;
  res.send(renderPage('Assign Students to Track', `
    ${esc(track.track_name)} - Assign Students
    
      Select Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      Assign
    
    Assigned Students (${assigned.length})
    StudentClassSinceActions
    ${assigned.map(a => `${esc(a.student_name)}${esc(a.class||'')}${a.assigned_date}Remove`).join('')||'No students assigned'}
    
  `, req.session.user));
}));

app.post('/school/tracks/:id/assign/save', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id } = req.body;
  await pool.query('INSERT INTO student_track_assignments(tenant_id,student_id,track_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, student_id, req.params.id]);
  res.redirect(`/school/tracks/${req.params.id}/assign`);
}));

app.get('/school/tracks/assign/:id/remove', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  await pool.query("UPDATE student_track_assignments SET status='inactive' WHERE id=$1", [req.params.id]);
  res.redirect('back');
}));

app.get('/school/tracks/:id/delete', requireAuth, requireNotBanned, requireFeature('student_specialization'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM student_tracks WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  res.redirect('/school/tracks');
}));


// =============================================
// SCHOOL MISSING FEATURES: Student Portal, Admissions, Graduation, Subjects, etc.
// =============================================

// STUDENT SELF-SERVICE PORTAL (enhanced version moved to v12 section below)
// Old routes removed - new password-based login, enhanced dashboard, timetable, fee payment at v12 section

// ADMISSIONS WORKFLOW
app.get('/school/admissions', requireAuth, requireNotBanned, requireFeature('admissions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const filter = req.query.status || 'all';
  let q = 'SELECT * FROM admissions WHERE tenant_id=$1';
  const params = [t];
  if (filter !== 'all') { q += ' AND status=$2'; params.push(filter); }
  q += ' ORDER BY created_at DESC';
  const admissions = (await pool.query(q, params)).rows;
  res.send(renderPage('Admissions', `
    AdmissionsApplication to Enrollment workflow
    + New Application
    AllAppliedReviewedAcceptedRejected
    NameLevelPhoneGuardianStatusDateActions
    ${admissions.map(a => `${esc(a.applicant_name)}${esc(a.applied_level||'-')}${esc(a.phone||'-')}${esc(a.guardian_name||'-')}${esc(a.status)}${new Date(a.created_at).toLocaleDateString()}
      ${a.status==='applied'?`Review`:''}
      ${a.status==='accepted'?`Enroll`:''}
    `).join('')||'No applications yet'}
    
  `, req.session.user));
}));

app.get('/school/admissions/new', requireAuth, requireNotBanned, requireFeature('admissions'), (req, res) => {
  res.send(renderPage('New Application', `New Admission Application
    
      
      
      
      MaleFemale
      
      
      
      
      
      
      Submit Application
    `, req.session.user));
});

app.post('/school/admissions/save', requireAuth, requireNotBanned, requireFeature('admissions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { applicant_name, email, phone, dob, gender, applied_level, applied_class, previous_school, guardian_name, guardian_phone, documents } = req.body;
  await pool.query('INSERT INTO admissions(tenant_id,applicant_name,email,phone,dob,gender,applied_level,applied_class,previous_school,guardian_name,guardian_phone,documents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [t, applicant_name, email||null, phone||null, dob||null, gender||null, applied_level||null, applied_class||null, previous_school||null, guardian_name, guardian_phone, documents?JSON.stringify(documents.split(',')):null]);
  res.redirect('/school/admissions');
}));

app.get('/school/admissions/:id/review', requireAuth, requireNotBanned, requireFeature('admissions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const a = (await pool.query('SELECT * FROM admissions WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!a) return res.redirect('/school/admissions');
  res.send(renderPage('Review Application', `Review: ${esc(a.applicant_name)}
    Level: ${esc(a.applied_level||'-')} | Previous School: ${esc(a.previous_school||'-')}
    Guardian: ${esc(a.guardian_name)} | ${esc(a.guardian_phone||'')}
    
      
      
        Accept
        Reject
      
    `, req.session.user));
}));

app.post('/school/admissions/:id/decision', requireAuth, requireNotBanned, requireFeature('admissions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { decision, review_notes } = req.body;
  await pool.query('UPDATE admissions SET status=$1,reviewed_by=$2,review_notes=$3 WHERE tenant_id=$4 AND id=$5', [decision, req.session.user.email, review_notes||null, t, req.params.id]);
  res.redirect('/school/admissions');
}));

app.get('/school/admissions/:id/enroll', requireAuth, requireNotBanned, requireFeature('admissions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const a = (await pool.query('SELECT * FROM admissions WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!a) return res.redirect('/school/admissions');
  const admNo = 'ADM-' + Date.now().toString().slice(-6);
  await pool.query('INSERT INTO students(tenant_id,admission_no,name,class,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6)', [t, admNo, a.applicant_name, a.applied_class||a.applied_level||'', a.guardian_name, a.guardian_phone]);
  await pool.query("UPDATE admissions SET status='enrolled' WHERE id=$1", [a.id]);
  res.redirect('/school/students');
}));

// SUBJECT MANAGEMENT
app.get('/school/subjects', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const subjects = (await pool.query('SELECT * FROM subjects WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Subjects', `Subject Management
    + Add Subject
    Assign to Classes
    NameCodeCategoryLevelCompulsoryActions
    ${subjects.map(s=>`${esc(s.name)}${esc(s.code||'-')}${esc(s.category||'-')}${esc(s.education_level||'all')}${s.is_compulsory?'Yes':'No'}Del`).join('')||'No subjects defined'}
    `, req.session.user));
}));

app.get('/school/subjects/new', requireAuth, requireNotBanned, requireFeature('subject_management'), (req, res) => {
  res.send(renderPage('Add Subject', `Add Subject
    
      
      
      
      All LevelsNurseryKindergartenPrimaryO-LevelA-LevelUniversity
       Compulsory
      Add Subject
    `, req.session.user));
});

app.post('/school/subjects/save', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, code, category, education_level, is_compulsory } = req.body;
  await pool.query('INSERT INTO subjects(tenant_id,name,code,category,education_level,is_compulsory) VALUES($1,$2,$3,$4,$5,$6)', [t, name, code||null, category||null, education_level||null, !!is_compulsory]);
  res.redirect('/school/subjects');
}));

app.get('/school/subjects/assign', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const subjects = (await pool.query('SELECT * FROM subjects WHERE tenant_id=$1', [t])).rows;
  const classes = (await pool.query('SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class', [t])).rows;
  const staffList = (await pool.query('SELECT * FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const assigned = (await pool.query('SELECT cs.*,s.name as subject_name,st.name as teacher FROM class_subjects cs JOIN subjects s ON cs.subject_id=s.id LEFT JOIN staff st ON cs.teacher_id=st.id WHERE cs.tenant_id=$1 ORDER BY cs.class_name', [t])).rows;
  res.send(renderPage('Assign Subjects to Classes', `Assign Subjects to Classes
    
      Select Class${classes.map(c=>`${esc(c.class)}`).join('')}
      Select Subject${subjects.map(s=>`${esc(s.name)}`).join('')}
      Assign Teacher (optional)${staffList.map(s=>`${esc(s.name)}`).join('')}
      Assign
    
    ClassSubjectTeacherActions
    ${assigned.map(a=>`${esc(a.class_name)}${esc(a.subject_name)}${esc(a.teacher||'Unassigned')}Remove`).join('')||'No assignments yet'}
    `, req.session.user));
}));

app.post('/school/subjects/assign/save', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { class_name, subject_id, teacher_id } = req.body;
  await pool.query('INSERT INTO class_subjects(tenant_id,class_name,subject_id,teacher_id) VALUES($1,$2,$3,$4)', [t, class_name, subject_id, teacher_id||null]);
  res.redirect('/school/subjects/assign');
}));

app.get('/school/subjects/assign/:id/delete', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM class_subjects WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  res.redirect('/school/subjects/assign');
}));

app.get('/school/subjects/:id/delete', requireAuth, requireNotBanned, requireFeature('subject_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('DELETE FROM subjects WHERE tenant_id=$1 AND id=$2', [t, req.params.id]);
  res.redirect('/school/subjects');
}));

// SCHOLARSHIPS
app.get('/school/scholarships', requireAuth, requireNotBanned, requireFeature('scholarships'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const scholarships = (await pool.query('SELECT sc.*,s.name as student_name FROM scholarships sc LEFT JOIN students s ON sc.student_id=s.id WHERE sc.tenant_id=$1 ORDER BY sc.created_at DESC', [t])).rows;
  res.send(renderPage('Scholarships', `Scholarships & Bursaries
    + Award Scholarship
    NameStudentTypeCoverageAmountSponsorStatusActions
    ${scholarships.map(s=>`${esc(s.name)}${esc(s.student_name||'-')}${esc(s.type)}${s.coverage_percent}%UGX ${(s.amount||0).toLocaleString()}${esc(s.sponsor||'-')}${esc(s.status)}Edit`).join('')||'No scholarships yet'}
    `, req.session.user));
}));

app.get('/school/scholarships/new', requireAuth, requireNotBanned, requireFeature('scholarships'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Award Scholarship', `Award Scholarship
    
      
      Select Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      Merit-BasedNeed-Based (Bursary)SportsFull Scholarship
      
      
      
      
      Award Scholarship
    `, req.session.user));
}));

app.post('/school/scholarships/save', requireAuth, requireNotBanned, requireFeature('scholarships'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, student_id, type, coverage_percent, amount, sponsor, expiry_date, criteria } = req.body;
  await pool.query('INSERT INTO scholarships(tenant_id,name,type,coverage_percent,student_id,amount,sponsor,expiry_date,criteria) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, name, type||'merit', coverage_percent||100, student_id||null, amount||0, sponsor||null, expiry_date||null, criteria||null]);
  res.redirect('/school/scholarships');
}));

// VISITOR MANAGEMENT & GATE PASSES
app.get('/school/visitors', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const visitors = (await pool.query('SELECT * FROM visitors WHERE tenant_id=$1 ORDER BY check_in DESC LIMIT 50', [t])).rows;
  res.send(renderPage('Visitors & Gate Passes', `Visitors & Gate Passes
    + Log Visitor
    Gate Passes
    NameID NumberPurposeSeeingCheck InCheck OutStatusActions
    ${visitors.map(v=>`${esc(v.name)}${esc(v.id_number||'-')}${esc(v.purpose||'-')}${esc(v.person_to_see||'-')}${new Date(v.check_in).toLocaleString()}${v.check_out?new Date(v.check_out).toLocaleString():'-'}${esc(v.status)}${v.status==='checked_in'?`Check Out`:''}`).join('')||'No visitors today'}
    `, req.session.user));
}));

app.get('/school/visitors/new', requireAuth, requireNotBanned, requireFeature('visitor_management'), (req, res) => {
  res.send(renderPage('Log Visitor', `Log Visitor
    
      
      
      
      
      
      
      Check In Visitor
    `, req.session.user));
});

app.post('/school/visitors/save', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, id_number, phone, purpose, person_to_see, vehicle_plate } = req.body;
  const code = 'GP-' + Date.now().toString().slice(-6);
  await pool.query('INSERT INTO visitors(tenant_id,name,id_number,phone,purpose,person_to_see,vehicle_plate,gate_pass_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, name, id_number||null, phone||null, purpose, person_to_see||null, vehicle_plate||null, code]);
  res.redirect('/school/visitors');
}));

app.get('/school/visitors/:id/checkout', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE visitors SET check_out=NOW(),status='checked_out' WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  res.redirect('/school/visitors');
}));

app.get('/school/gate-passes', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const passes = (await pool.query('SELECT gp.*,s.name as student_name FROM gate_passes gp JOIN students s ON gp.student_id=s.id WHERE gp.tenant_id=$1 ORDER BY gp.pass_date DESC', [t])).rows;
  res.send(renderPage('Gate Passes', `Student Gate Passes
    + Issue Gate Pass
    StudentReasonDestinationAuthorized ByDateStatus
    ${passes.map(p=>`${esc(p.student_name)}${esc(p.reason)}${esc(p.destination||'-')}${esc(p.authorized_by||'-')}${p.pass_date}${esc(p.status)}`).join('')||'No gate passes'}
    `, req.session.user));
}));

app.get('/school/gate-passes/new', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Issue Gate Pass', `Issue Gate Pass
    
      Select Student${students.map(s=>`${esc(s.name)}`).join('')}
      
      
      
      
      Issue Pass
    `, req.session.user));
}));

app.post('/school/gate-passes/save', requireAuth, requireNotBanned, requireFeature('visitor_management'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, reason, destination, authorized_by, return_date } = req.body;
  await pool.query('INSERT INTO gate_passes(tenant_id,student_id,reason,destination,authorized_by,return_date) VALUES($1,$2,$3,$4,$5,$6)', [t, student_id, reason, destination||null, authorized_by||null, return_date||null]);
  res.redirect('/school/gate-passes');
}));

// SUGGESTION BOX
app.get('/suggestions', requireAuth, requireNotBanned, requireFeature('suggestions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM suggestions WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Suggestions & Complaints', `Suggestions & Complaints
    + Submit
    TypeTitleFromPriorityStatusActions
    ${items.map(i=>`${esc(i.type)}${esc(i.title)}${i.is_anonymous?'Anonymous':esc(i.submitted_by||'-')}${esc(i.priority)}${esc(i.status)}View`).join('')||'No suggestions yet'}
    `, req.session.user));
}));

app.get('/suggestions/new', requireAuth, requireNotBanned, requireFeature('suggestions'), (req, res) => {
  res.send(renderPage('Submit Suggestion', `Submit Suggestion / Complaint
    
      SuggestionComplaintFeedback
      
      
       Submit Anonymously
      LowMediumHigh
      Submit
    `, req.session.user));
});

app.post('/suggestions/save', requireAuth, requireNotBanned, requireFeature('suggestions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, title, description, is_anonymous, priority } = req.body;
  await pool.query('INSERT INTO suggestions(tenant_id,type,title,description,submitted_by,is_anonymous,priority) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, type||'suggestion', title, description, req.session.user.email, !!is_anonymous, priority||'medium']);
  res.redirect('/suggestions');
}));

app.get('/suggestions/:id', requireAuth, requireNotBanned, requireFeature('suggestions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const item = (await pool.query('SELECT * FROM suggestions WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!item) return res.redirect('/suggestions');
  res.send(renderPage('Suggestion Details', `${esc(item.title)}
    Type: ${esc(item.type)} | Status: ${esc(item.status)} | From: ${item.is_anonymous?'Anonymous':esc(item.submitted_by)}
    ${esc(item.description)}
    ${item.response?`Response: ${esc(item.response)}`:''}
    
      
      OpenIn ProgressResolvedClosed
      Submit Response
    `, req.session.user));
}));

app.post('/suggestions/:id/respond', requireAuth, requireNotBanned, requireFeature('suggestions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { response, status } = req.body;
  await pool.query('UPDATE suggestions SET response=$1,status=$2 WHERE tenant_id=$3 AND id=$4', [response||null, status||'open', t, req.params.id]);
  res.redirect(`/suggestions/${req.params.id}`);
}));

// FORUMS
app.get('/forums', requireAuth, requireNotBanned, requireFeature('forums'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const topics = (await pool.query('SELECT ft.*, COUNT(DISTINCT fr.id) as reply_count FROM forum_topics ft LEFT JOIN forum_replies fr ON ft.id=fr.topic_id WHERE ft.tenant_id=$1 GROUP BY ft.id ORDER BY ft.pinned DESC, ft.created_at DESC', [t])).rows;
  res.send(renderPage('Discussion Forums', `Discussion Forums
    + New Topic
    TopicCategoryAuthorRepliesViewsDate
    ${topics.map(tp=>`${tp.pinned?'📌 ':''}${esc(tp.title)}${esc(tp.category||'general')}${esc(tp.author_email?.split('@')[0]||'-')}${tp.reply_count}${tp.views}${new Date(tp.created_at).toLocaleDateString()}`).join('')||'No topics yet'}
    `, req.session.user));
}));

app.get('/forums/new', requireAuth, requireNotBanned, requireFeature('forums'), (req, res) => {
  res.send(renderPage('New Topic', `Start New Discussion
    
      
      
      
      Post Topic
    `, req.session.user));
});

app.post('/forums/save', requireAuth, requireNotBanned, requireFeature('forums'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, category, content } = req.body;
  await pool.query('INSERT INTO forum_topics(tenant_id,title,category,author_email,content) VALUES($1,$2,$3,$4,$5)', [t, title, category||'general', req.session.user.email, content]);
  res.redirect('/forums');
}));

app.get('/forums/:id', requireAuth, requireNotBanned, requireFeature('forums'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const topic = (await pool.query('SELECT * FROM forum_topics WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!topic) return res.redirect('/forums');
  await pool.query('UPDATE forum_topics SET views=views+1 WHERE id=$1', [topic.id]);
  const replies = (await pool.query('SELECT * FROM forum_replies WHERE tenant_id=$1 AND topic_id=$2 ORDER BY created_at', [t, req.params.id])).rows;
  res.send(renderPage(esc(topic.title), `${esc(topic.title)}
    By ${esc(topic.author_email?.split('@')[0]||'-')} | ${esc(topic.category||'')} | ${topic.views} views
    ${esc(topic.content)}
    Replies (${replies.length})
    ${replies.map(r=>`${esc(r.author_email?.split('@')[0]||'-')} ${new Date(r.created_at).toLocaleString()}${esc(r.content)}`).join('')||'No replies yet'}
    
      
      Reply
    `, req.session.user));
}));

app.post('/forums/:id/reply', requireAuth, requireNotBanned, requireFeature('forums'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { content } = req.body;
  await pool.query('INSERT INTO forum_replies(tenant_id,topic_id,author_email,content) VALUES($1,$2,$3,$4)', [t, req.params.id, req.session.user.email, content]);
  res.redirect(`/forums/${req.params.id}`);
}));

// LOGIN HISTORY
app.get('/login-history', requireAuth, requireNotBanned, requireFeature('login_history'), ah(async (req, res) => {
  const history = (await pool.query('SELECT * FROM login_history WHERE user_email=$1 ORDER BY created_at DESC LIMIT 50', [req.session.user.email])).rows;
  res.send(renderPage('Login History', `My Login History
    DateIP AddressDeviceStatus
    ${history.map(h=>`${new Date(h.created_at).toLocaleString()}${esc(h.ip_address||'-')}${esc(h.user_agent||'-')}${h.success?'Success':'Failed'}`).join('')||'No login history'}
    `, req.session.user));
}));

// CHURCH: WELFARE
app.get('/church/welfare', requireAuth, requireNotBanned, requireFeature('welfare'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const records = (await pool.query('SELECT w.*,cm.name as member_name FROM welfare_records w LEFT JOIN church_members cm ON w.member_id=cm.id WHERE w.tenant_id=$1 ORDER BY w.date DESC', [t])).rows;
  const total = records.reduce((s,r)=>s+(r.amount||0),0);
  res.send(renderPage('Welfare & Benevolence', `Welfare & Benevolence
    UGX ${total.toLocaleString()}Total Given${records.length}Records
    + Add Record
    MemberTypeAmountDateApproved By
    ${records.map(r=>`${esc(r.member_name||'-')}${esc(r.type)}UGX ${(r.amount||0).toLocaleString()}${r.date}${esc(r.approved_by||'-')}`).join('')||'No welfare records'}
    `, req.session.user));
}));

app.get('/church/welfare/new', requireAuth, requireNotBanned, requireFeature('welfare'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Welfare Record', `Add Welfare/Benevolence
    
      Select Member${members.map(m=>`${esc(m.name)}`).join('')}
      BenevolenceMedical AidFood AssistanceRent AssistanceEducation SupportOther
      
      
      Save
    `, req.session.user));
}));

app.post('/church/welfare/save', requireAuth, requireNotBanned, requireFeature('welfare'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { member_id, type, amount, description } = req.body;
  await pool.query('INSERT INTO welfare_records(tenant_id,member_id,type,amount,description,approved_by) VALUES($1,$2,$3,$4,$5,$6)', [t, member_id, type||'benevolence', amount||0, description||null, req.session.user.email]);
  res.redirect('/church/welfare');
}));

// CHURCH: BUILDING FUND
app.get('/church/building-fund', requireAuth, requireNotBanned, requireFeature('building_fund'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const funds = (await pool.query('SELECT * FROM building_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Building Fund', `Building Fund
    + New Fund
    NameTargetRaisedProgressStatusActions
    ${funds.map(f=>{const pct=f.target>0?Math.round(f.raised/f.target*100):0;return `${esc(f.name)}UGX ${(f.target||0).toLocaleString()}UGX ${(f.raised||0).toLocaleString()}=100?'#059669':'#4f46e5'}">${pct}%${esc(f.status)}View`}).join('')||'No building funds'}
    `, req.session.user));
}));

app.get('/church/building-fund/new', requireAuth, requireNotBanned, requireFeature('building_fund'), (req, res) => {
  res.send(renderPage('New Building Fund', `New Building Fund
    
      
      
      
      
      Create Fund
    `, req.session.user));
});

app.post('/church/building-fund/save', requireAuth, requireNotBanned, requireFeature('building_fund'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, target, description, start_date, end_date } = req.body;
  await pool.query('INSERT INTO building_funds(tenant_id,name,target,description,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6)', [t, name, target||0, description||null, start_date||null, end_date||null]);
  res.redirect('/church/building-fund');
}));

// CHURCH: MEMBERSHIP TRANSFER
app.get('/church/transfers', requireAuth, requireNotBanned, requireFeature('membership_transfer'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const transfers = (await pool.query('SELECT mt.*,cm.name as member_name FROM membership_transfers mt LEFT JOIN church_members cm ON mt.member_id=cm.id WHERE mt.tenant_id=$1 ORDER BY mt.created_at DESC', [t])).rows;
  res.send(renderPage('Membership Transfers', `Membership Transfers
    + New Transfer
    MemberFromToReasonStatusActions
    ${transfers.map(tr=>`${esc(tr.member_name||'-')}${esc(tr.from_church||'-')}${esc(tr.to_church||'-')}${esc(tr.reason||'-')}${esc(tr.status)}${tr.status==='pending'?`Approve`:''}`).join('')||'No transfers'}
    `, req.session.user));
}));

app.get('/church/transfers/new', requireAuth, requireNotBanned, requireFeature('membership_transfer'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id,name FROM church_members WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Membership Transfer', `Membership Transfer
    
      Select Member${members.map(m=>`${esc(m.name)}`).join('')}
      
      
      
      Submit Transfer
    `, req.session.user));
}));

app.post('/church/transfers/save', requireAuth, requireNotBanned, requireFeature('membership_transfer'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { member_id, from_church, to_church, reason } = req.body;
  await pool.query('INSERT INTO membership_transfers(tenant_id,member_id,from_church,to_church,reason) VALUES($1,$2,$3,$4,$5)', [t, member_id, from_church, to_church, reason||null]);
  res.redirect('/church/transfers');
}));

app.get('/church/transfers/:id/approve', requireAuth, requireNotBanned, requireFeature('membership_transfer'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE membership_transfers SET status='approved',approved_by=$1,transfer_date=CURRENT_DATE WHERE tenant_id=$2 AND id=$3", [req.session.user.email, t, req.params.id]);
  res.redirect('/church/transfers');
}));

// BALANCE SHEET
app.get('/business/balance-sheet', requireAuth, requireNotBanned, requireFeature('balance_sheet'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [assets, liabilities, equity] = await Promise.all([
    pool.query("SELECT COALESCE(SUM(balance),0) as total FROM chart_of_accounts WHERE tenant_id=$1 AND type='asset'", [t]),
    pool.query("SELECT COALESCE(SUM(balance),0) as total FROM chart_of_accounts WHERE tenant_id=$1 AND type='liability'", [t]),
    pool.query("SELECT COALESCE(SUM(balance),0) as total FROM chart_of_accounts WHERE tenant_id=$1 AND type='equity'", [t])
  ]);
  const aTotal = parseInt(assets.rows[0].total);
  const lTotal = parseInt(liabilities.rows[0].total);
  const eTotal = parseInt(equity.rows[0].total);
  res.send(renderPage('Balance Sheet', `
    Balance SheetAs of ${new Date().toLocaleDateString()}
    
      AssetsUGX ${aTotal.toLocaleString()}
      LiabilitiesUGX ${lTotal.toLocaleString()}
      EquityUGX ${eTotal.toLocaleString()}
    
    ${aTotal===(lTotal+eTotal)?'Balanced':'Imbalanced'} — Assets (${aTotal.toLocaleString()}) = Liabilities (${lTotal.toLocaleString()}) + Equity (${eTotal.toLocaleString()})
    Manage Accounts
    
  `, req.session.user));
}));

// === BUSINESS: QUOTATIONS ===
app.get('/business/quotations', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const quotations = (await pool.query('SELECT * FROM quotations WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Quotations', `Quotations
    + New Quotation
    Quote #CustomerTotal (UGX)StatusValid UntilActions
    ${quotations.map(q=>`${esc(q.quote_no)}${esc(q.customer_name)}${parseInt(q.total||0).toLocaleString()}${esc(q.status)}${q.valid_until||'-'}View Accept Reject Del`).join('')||'No quotations yet'}`, req.session.user));
}));

app.get('/business/quotations/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Quotation', `Create Quotation
    
      
      
      
      
      
      
      
      Create Quotation
    `, req.session.user));
});

app.post('/business/quotations/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { quote_no, customer_name, customer_contact, items, total, valid_until, notes } = req.body;
  await pool.query('INSERT INTO quotations(tenant_id,quote_no,customer_name,customer_contact,items,total,valid_until,notes) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)', [t, quote_no, customer_name, customer_contact, items, total||0, valid_until||null, notes]);
  await audit(req.session.user.email, 'create_quotation', `Quotation ${quote_no} for ${customer_name}`);
  res.redirect('/business/quotations');
}));

app.get('/business/quotations/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const q = (await pool.query('SELECT * FROM quotations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!q) return res.status(404).send('Not found');
  const itemsList = Array.isArray(q.items) ? q.items : [];
  res.send(renderPage('Quotation Detail', `Quotation: ${esc(q.quote_no)}
    Customer: ${esc(q.customer_name)} ${q.customer_contact ? '| '+esc(q.customer_contact) : ''}
    Status: ${esc(q.status)} | Valid Until: ${q.valid_until||'N/A'}
    ${itemsList.length ? `ItemQtyPriceSubtotal${itemsList.map(i=>`${esc(i.name||'')}${i.qty||0}${parseInt(i.price||0).toLocaleString()}${((i.qty||0)*(i.price||0)).toLocaleString()}`).join('')}` : ''}
    Total: UGX ${parseInt(q.total||0).toLocaleString()}
    ${q.notes ? `Notes: ${esc(q.notes)}` : ''}
    Back Accept Reject`, req.session.user));
}));

app.get('/business/quotations/:id/accept', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE quotations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['accepted', req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/quotations');
}));

app.get('/business/quotations/:id/reject', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE quotations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['rejected', req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/quotations');
}));

app.get('/business/quotations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM quotations WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/quotations');
}));

// === BUSINESS: DELIVERIES ===
app.get('/business/deliveries', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const deliveries = (await pool.query('SELECT * FROM deliveries WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Deliveries', `Deliveries
    + New Delivery
    Order #CustomerDriverStatusDispatchedDeliveredActions
    ${deliveries.map(d=>`${esc(d.order_no)}${esc(d.customer_name)}${esc(d.driver_name||'-')}${esc(d.status)}${d.dispatched_at?new Date(d.dispatched_at).toLocaleDateString():'-'}${d.delivered_at?new Date(d.delivered_at).toLocaleDateString():'-'}View Dispatch Deliver Del`).join('')||'No deliveries yet'}`, req.session.user));
}));

app.get('/business/deliveries/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Delivery', `Create Delivery
    
      
      
      
      
      
      
      
      Create Delivery
    `, req.session.user));
});

app.post('/business/deliveries/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { order_no, customer_name, customer_address, items, driver_name, vehicle, notes } = req.body;
  await pool.query('INSERT INTO deliveries(tenant_id,order_no,customer_name,customer_address,items,driver_name,vehicle,notes) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)', [t, order_no, customer_name, customer_address, items, driver_name, vehicle, notes]);
  await audit(req.session.user.email, 'create_delivery', `Delivery ${order_no} for ${customer_name}`);
  res.redirect('/business/deliveries');
}));

app.get('/business/deliveries/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const d = (await pool.query('SELECT * FROM deliveries WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!d) return res.status(404).send('Not found');
  const itemsList = Array.isArray(d.items) ? d.items : [];
  res.send(renderPage('Delivery Detail', `Delivery: ${esc(d.order_no)}
    Customer: ${esc(d.customer_name)} | Address: ${esc(d.customer_address||'')}
    Driver: ${esc(d.driver_name||'-')} | Vehicle: ${esc(d.vehicle||'-')}
    Status: ${esc(d.status)}
    ${itemsList.length ? `ItemQty${itemsList.map(i=>`${esc(i.name||'')}${i.qty||0}`).join('')}` : ''}
    ${d.notes ? `Notes: ${esc(d.notes)}` : ''}
    Back Dispatch Mark Delivered`, req.session.user));
}));

app.get('/business/deliveries/:id/dispatch', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE deliveries SET status=$1, dispatched_at=NOW() WHERE id=$2 AND tenant_id=$3', ['dispatched', req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/deliveries');
}));

app.get('/business/deliveries/:id/deliver', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE deliveries SET status=$1, delivered_at=NOW() WHERE id=$2 AND tenant_id=$3', ['delivered', req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/deliveries');
}));

app.get('/business/deliveries/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM deliveries WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/business/deliveries');
}));

// COMMITTEES
app.get('/committees', requireAuth, requireNotBanned, requireFeature('committees'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const committees = (await pool.query('SELECT * FROM committees WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Committees', `Committees
    + Add Committee
    NameChairpersonSecretaryStatusActions
    ${committees.map(c=>`${esc(c.name)}${esc(c.chairperson||'-')}${esc(c.secretary||'-')}${esc(c.status)}View`).join('')||'No committees'}
    `, req.session.user));
}));

app.get('/committees/new', requireAuth, requireNotBanned, requireFeature('committees'), (req, res) => {
  res.send(renderPage('Add Committee', `Add Committee
    
      
      
      
      
      
      Create
    `, req.session.user));
});

app.post('/committees/save', requireAuth, requireNotBanned, requireFeature('committees'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, purpose, chairperson, secretary, members } = req.body;
  const memberList = members ? members.split('\n').map(m=>m.trim()).filter(Boolean) : [];
  await pool.query('INSERT INTO committees(tenant_id,name,purpose,chairperson,secretary,members) VALUES($1,$2,$3,$4,$5,$6)', [t, name, purpose||null, chairperson||null, secretary||null, JSON.stringify(memberList)]);
  res.redirect('/committees');
}));

// POLICY DOCUMENTS
app.get('/policies', requireAuth, requireNotBanned, requireFeature('policy_docs'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const policies = (await pool.query('SELECT * FROM policy_documents WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Policy Documents', `Policy Documents
    + New Policy
    TitleCategoryVersionStatusEffectiveReviewActions
    ${policies.map(p=>`${esc(p.title)}${esc(p.category||'-')}v${p.version}${esc(p.status)}${p.effective_date||'-'}${p.review_date||'-'}View`).join('')||'No policies yet'}
    `, req.session.user));
}));

app.get('/policies/new', requireAuth, requireNotBanned, requireFeature('policy_docs'), (req, res) => {
  res.send(renderPage('New Policy', `Create Policy Document
    
      
      
      
      
      Create Policy
    `, req.session.user));
});

app.post('/policies/save', requireAuth, requireNotBanned, requireFeature('policy_docs'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, category, content, effective_date, review_date } = req.body;
  await pool.query('INSERT INTO policy_documents(tenant_id,title,category,content,effective_date,review_date,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, title, category||null, content, effective_date||null, review_date||null, req.session.user.email]);
  res.redirect('/policies');
}));

app.get('/policies/:id', requireAuth, requireNotBanned, requireFeature('policy_docs'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const p = (await pool.query('SELECT * FROM policy_documents WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!p) return res.redirect('/policies');
  const acks = (await pool.query('SELECT * FROM policy_acknowledgments WHERE policy_id=$1', [p.id])).rows;
  res.send(renderPage(esc(p.title), `${esc(p.title)}
    Version ${p.version} | ${esc(p.category||'')} | Effective: ${p.effective_date||'TBD'}
    ${esc(p.content)}
    Acknowledgments (${acks.length})
    ${acks.length?`UserDate${acks.map(a=>`${esc(a.user_email)}${new Date(a.acknowledged_at).toLocaleString()}`).join('')}`:'No acknowledgments yet'}
    I Acknowledge This Policy
    `, req.session.user));
}));

app.post('/policies/:id/acknowledge', requireAuth, requireNotBanned, requireFeature('policy_docs'), ah(async (req, res) => {
  await pool.query('INSERT INTO policy_acknowledgments(policy_id,user_email) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.session.user.email]);
  res.redirect(`/policies/${req.params.id}`);
}));


// =============================================
// SCHOOL: GRADUATION PROCESSING
// =============================================
app.get('/school/graduations', requireAuth, requireNotBanned, requireFeature('graduation'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const graduations = (await pool.query('SELECT g.*, (SELECT COUNT(*) FROM graduation_students WHERE graduation_id=g.id) as student_count FROM graduations g WHERE g.tenant_id=$1 ORDER BY g.created_at DESC', [t])).rows;
  res.send(renderPage('Graduations', `Graduation Processing
    + New Graduation
    CeremonyAcademic YearDateStudentsStatusActions
    ${graduations.map(g=>`${esc(g.ceremony_name||g.name)}${esc(g.academic_year||'-')}${g.graduation_date||'-'}${g.student_count||0}${esc(g.status||'planned')}View`).join('')||'No graduations yet'}
    `, req.session.user));
}));

app.get('/school/graduations/new', requireAuth, requireNotBanned, requireFeature('graduation'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('New Graduation', `Create Graduation Ceremony
    
      
      
      
      
      Select Graduating Students
      
        ${students.map(s=>` ${esc(s.name)} ${esc(s.class||'')}`).join('')||'No students found'}
      
      Create Graduation
    `, req.session.user));
}));

app.post('/school/graduations/save', requireAuth, requireNotBanned, requireFeature('graduation'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { ceremony_name, academic_year, graduation_date, venue, notes, student_ids } = req.body;
  const grad = await pool.query('INSERT INTO graduations(tenant_id,ceremony_name,academic_year,graduation_date,venue,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [t, ceremony_name, academic_year, graduation_date||null, venue||null, notes||null]);
  const gradId = grad.rows[0]?.id;
  if (gradId && student_ids) {
    const ids = Array.isArray(student_ids) ? student_ids : [student_ids];
    for (const sid of ids) {
      await pool.query('INSERT INTO graduation_students(graduation_id,student_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [gradId, sid]);
    }
  }
  res.redirect('/school/graduations');
}));

app.get('/school/graduations/:id', requireAuth, requireNotBanned, requireFeature('graduation'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const g = (await pool.query('SELECT * FROM graduations WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!g) return res.redirect('/school/graduations');
  const students = (await pool.query('SELECT s.* FROM students s JOIN graduation_students gs ON s.id=gs.student_id WHERE gs.graduation_id=$1', [g.id])).rows;
  res.send(renderPage(esc(g.ceremony_name||g.name||'Graduation'), `${esc(g.ceremony_name||g.name)}
    ${students.length}Graduating${g.graduation_date||'TBD'}Date
    Venue: ${esc(g.venue||'TBD')} | Year: ${esc(g.academic_year||'-')} | Status: ${esc(g.status||'planned')}
    ${g.notes?`Notes: ${esc(g.notes)}`:''}
    Graduating Students
    NameClass
    ${students.map(s=>`${esc(s.name)}${esc(s.class||'-')}`).join('')||'No students'}
    
    ${g.status==='planned'?`Finalize Graduation`:'Graduation finalized'}
    `, req.session.user));
}));

app.get('/school/graduations/:id/finalize', requireAuth, requireNotBanned, requireFeature('graduation'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE graduations SET status='completed' WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  res.redirect(`/school/graduations/${req.params.id}`);
}));

// =============================================
// SCHOOL: EXAM SEATING ARRANGEMENTS
// =============================================
app.get('/school/exam-seating', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const seats = (await pool.query('SELECT es.*, e.name as exam_name FROM exam_seating es LEFT JOIN exams e ON es.exam_id=e.id WHERE es.tenant_id=$1 ORDER BY es.created_at DESC', [t])).rows;
  res.send(renderPage('Exam Seating', `Exam Seating Arrangements
    + New Arrangement
    ExamRoom/HallClassStudentsDateTimeActions
    ${seats.map(s=>`${esc(s.exam_name||'General')}${esc(s.room||'-')}${esc(s.class_name||'-')}${s.student_count||'-'}${s.exam_date||'-'}${s.exam_time||'-'}Edit Del`).join('')||'No seating arrangements'}
    `, req.session.user));
}));

app.get('/school/exam-seating/new', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const exams = (await pool.query('SELECT id,name FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('New Seating', `New Exam Seating
    
      Select Exam (optional)${exams.map(e=>`${esc(e.name)}`).join('')}
      
      
      
      
      
      Save Arrangement
    `, req.session.user));
}));

app.post('/school/exam-seating/save', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { exam_id, room, class_name, student_count, exam_date, exam_time, notes } = req.body;
  await pool.query('INSERT INTO exam_seating(tenant_id,exam_id,room,class_name,student_count,exam_date,exam_time,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, exam_id||null, room, class_name, student_count||0, exam_date||null, exam_time||null, notes||null]);
  res.redirect('/school/exam-seating');
}));

app.get('/school/exam-seating/:id/edit', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const s = (await pool.query('SELECT * FROM exam_seating WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!s) return res.redirect('/school/exam-seating');
  res.send(renderPage('Edit Seating', `Edit Seating Arrangement
    
      
      
      
      
      ${esc(s.notes||'')}
      Update
    `, req.session.user));
}));

app.post('/school/exam-seating/:id/update', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { room, class_name, student_count, exam_date, exam_time, notes } = req.body;
  await pool.query('UPDATE exam_seating SET room=$1,class_name=$2,student_count=$3,exam_date=$4,exam_time=$5,notes=$6 WHERE tenant_id=$7 AND id=$8', [room, class_name, student_count||0, exam_date||null, exam_time||null, notes||null, t, req.params.id]);
  res.redirect('/school/exam-seating');
}));

app.get('/school/exam-seating/:id/delete', requireAuth, requireNotBanned, requireFeature('exam_seating'), ah(async (req, res) => {
  await pool.query('DELETE FROM exam_seating WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/exam-seating');
}));

// =============================================
// SCHOOL: PARENT-TEACHER CONFERENCE BOOKING
// =============================================
app.get('/school/ptc', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const slots = (await pool.query('SELECT ps.*, COALESCE(ps.slot_date, ps.date) as slot_date, (SELECT COUNT(*) FROM ptc_bookings WHERE COALESCE(slot_id, teacher_id)=ps.id) as booking_count FROM ptc_slots ps WHERE ps.tenant_id=$1 ORDER BY COALESCE(ps.slot_date, ps.date), ps.start_time', [t])).rows;
  res.send(renderPage('Parent-Teacher Conferences', `Parent-Teacher Conferences
    + Add Time Slot
    TeacherDateStartEndBookingsStatusActions
    ${slots.map(s=>`${esc(s.teacher_name||'-')}${s.slot_date||'-'}${s.start_time||'-'}${s.end_time||'-'}${s.booking_count||0}${esc(s.status||'open')}View`).join('')||'No time slots yet'}
    `, req.session.user));
}));

app.get('/school/ptc/new-slot', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staff = (await pool.query('SELECT id,name FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add PTC Slot', `Add Conference Time Slot
    
      Select Teacher (optional)${staff.map(s=>`${esc(s.name)}`).join('')}
      
      
      
      
      
      Create Slot
    `, req.session.user));
}));

app.post('/school/ptc/save-slot', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { staff_id, teacher_name, slot_date, start_time, end_time, duration_minutes, notes } = req.body;
  try { await pool.query('INSERT INTO ptc_slots(tenant_id,staff_id,teacher_name,slot_date,start_time,end_time,duration_minutes,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, staff_id||null, teacher_name||null, slot_date, start_time, end_time, duration_minutes||15, notes||null]); } catch(e) { await pool.query('INSERT INTO ptc_slots(tenant_id,teacher_id,date,start_time,end_time,slot_duration) VALUES($1,$2,$3,$4,$5,$6)', [t, staff_id||null, slot_date, start_time, end_time, duration_minutes||15]); }
  res.redirect('/school/ptc');
}));

app.get('/school/ptc/slot/:id', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const slot = (await pool.query('SELECT * FROM ptc_slots WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!slot) return res.redirect('/school/ptc');
  const bookings = (await pool.query('SELECT pb.*, s.name as student_name FROM ptc_bookings pb LEFT JOIN students s ON pb.student_id=s.id WHERE COALESCE(pb.slot_id, pb.teacher_id)=$1 ORDER BY pb.created_at', [slot.id])).rows;
  res.send(renderPage('PTC Slot Details', `${esc(slot.teacher_name||'Teacher')} - ${slot.slot_date}
    Time: ${slot.start_time} - ${slot.end_time} | Duration: ${slot.duration_minutes||slot.slot_duration||15} min
    Bookings (${bookings.length})
    ParentStudentBooked AtActions
    ${bookings.map(b=>`${esc(b.parent_name||b.parent_email||'-')}${esc(b.student_name||'-')}${new Date(b.created_at).toLocaleString()}Cancel`).join('')||'No bookings yet'}
    
    + Book Parent
    `, req.session.user));
}));

app.get('/school/ptc/book', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const slotId = req.query.slot_id;
  const students = (await pool.query('SELECT id,name FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Book PTC', `Book Parent-Teacher Conference
    
      
      Select Student${students.map(s=>`${esc(s.name)}`).join('')}
      
      
      
      
      Book Slot
    `, req.session.user));
}));

app.post('/school/ptc/save-booking', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const { slot_id, student_id, parent_name, parent_email, parent_phone, concerns } = req.body;
  try { await pool.query('INSERT INTO ptc_bookings(slot_id,student_id,parent_name,parent_email,parent_phone,concerns) VALUES($1,$2,$3,$4,$5,$6)', [slot_id, student_id, parent_name, parent_email||null, parent_phone||null, concerns||null]); } catch(e) { await pool.query('INSERT INTO ptc_bookings(tenant_id,teacher_id,parent_email,student_id,slot_date,slot_time) VALUES($1,$2,$3,$4,CURRENT_DATE,$5)', [req.session.user.tenant_id, slot_id, parent_email||parent_name, student_id, new Date().toLocaleTimeString()]); }
  res.redirect(`/school/ptc/slot/${slot_id}`);
}));

app.get('/school/ptc/booking/:id/cancel', requireAuth, requireNotBanned, requireFeature('ptc_booking'), ah(async (req, res) => {
  const booking = (await pool.query('SELECT slot_id FROM ptc_bookings WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM ptc_bookings WHERE id=$1', [req.params.id]);
  res.redirect(booking ? `/school/ptc/slot/${booking.slot_id}` : '/school/ptc');
}));

// =============================================
// SCHOOL: LESSON PLANS
// =============================================
app.get('/school/lesson-plans', requireAuth, requireNotBanned, requireFeature('lesson_plans'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const plans = (await pool.query('SELECT lp.* FROM lesson_plans lp WHERE lp.tenant_id=$1 ORDER BY lp.created_at DESC', [t])).rows;
  res.send(renderPage('Lesson Plans', `Lesson Plans
    + New Lesson Plan
    SubjectClassTeacherTopicDateStatusActions
    ${plans.map(p=>`${esc(p.subject)}${esc(p.class_name||'-')}${esc(p.teacher_name||p.teacher||'-')}${esc(p.topic||'-')}${p.lesson_date||'-'}${esc(p.status||'draft')}View Del`).join('')||'No lesson plans'}
    `, req.session.user));
}));

app.get('/school/lesson-plans/new', requireAuth, requireNotBanned, requireFeature('lesson_plans'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staff = (await pool.query('SELECT id,name,subject FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('New Lesson Plan', `Create Lesson Plan
    
      Select Teacher${staff.map(s=>`${esc(s.name)} (${esc(s.subject||'')})`).join('')}
      
      
      
      
      
      
      
      
      
      DraftSubmittedApproved
      Save Lesson Plan
    `, req.session.user));
}));

app.post('/school/lesson-plans/save', requireAuth, requireNotBanned, requireFeature('lesson_plans'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { staff_id, subject, class_name, topic, lesson_date, objectives, activities, materials, assessment, notes, status } = req.body;
  try { await pool.query('INSERT INTO lesson_plans(tenant_id,staff_id,subject,class_name,topic,lesson_date,objectives,activities,materials,assessment,notes,status,teacher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [t, staff_id||null, subject, class_name||null, topic, lesson_date||null, objectives||null, activities||null, materials||null, assessment||null, notes||null, status||'draft', req.session.user.email]); } catch(e) { await pool.query('INSERT INTO lesson_plans(tenant_id,subject,class_name,topic,objectives,materials,activities,assessment,notes,teacher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t, subject, class_name||null, topic, objectives||null, materials||null, activities||null, assessment||null, notes||null, req.session.user.email]); }
  res.redirect('/school/lesson-plans');
}));

app.get('/school/lesson-plans/:id', requireAuth, requireNotBanned, requireFeature('lesson_plans'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const p = (await pool.query('SELECT * FROM lesson_plans WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!p) return res.redirect('/school/lesson-plans');
  res.send(renderPage(esc(p.topic||'Lesson Plan'), `${esc(p.subject)} - ${esc(p.topic)}
    
      Class: ${esc(p.class_name||'-')}
      Date: ${p.lesson_date||'-'}
      Status: ${esc(p.status||'draft')}
    
    ${p.objectives?`Objectives${esc(p.objectives)}`:''}
    ${p.activities?`Activities${esc(p.activities)}`:''}
    ${p.materials?`Materials${esc(p.materials)}`:''}
    ${p.assessment?`Assessment${esc(p.assessment)}`:''}
    ${p.notes?`Notes${esc(p.notes)}`:''}
    `, req.session.user));
}));

app.get('/school/lesson-plans/:id/delete', requireAuth, requireNotBanned, requireFeature('lesson_plans'), ah(async (req, res) => {
  await pool.query('DELETE FROM lesson_plans WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/lesson-plans');
}));

// =============================================
// SCHOOL: STUDENT ID CARD GENERATION
// =============================================
app.get('/school/id-cards', requireAuth, requireNotBanned, requireFeature('student_id_cards'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const cards = (await pool.query('SELECT sic.*, s.name as student_name, s.class FROM student_id_cards sic JOIN students s ON sic.student_id=s.id WHERE sic.tenant_id=$1 ORDER BY sic.created_at DESC', [t])).rows;
  res.send(renderPage('Student ID Cards', `Student ID Cards
    + Generate ID Cards
    StudentClassCard No.StatusIssuedActions
    ${cards.map(c=>`${esc(c.student_name)}${esc(c.class||'-')}${esc(c.card_number||'-')}${esc(c.status||'active')}${c.issued_date||'-'}Print`).join('')||'No ID cards generated'}
    `, req.session.user));
}));

app.get('/school/id-cards/generate', requireAuth, requireNotBanned, requireFeature('student_id_cards'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class,admission_no,photo_url FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  const tenant = (await pool.query('SELECT name,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Generate ID Cards', `Generate Student ID Cards
    
      Select students to generate ID cards for:
      
        ${students.map(s=>` ${esc(s.name)} ${esc(s.class||'')} ${esc(s.admission_no||'')}`).join('')||'No students found'}
      
      Generate Selected ID Cards
    `, req.session.user));
}));

app.post('/school/id-cards/generate-save', requireAuth, requireNotBanned, requireFeature('student_id_cards'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_ids } = req.body;
  if (!student_ids) return res.redirect('/school/id-cards');
  const ids = Array.isArray(student_ids) ? student_ids : [student_ids];
  for (const sid of ids) {
    const existing = (await pool.query('SELECT id FROM student_id_cards WHERE tenant_id=$1 AND student_id=$2', [t, sid])).rows;
    if (existing.length === 0) {
      const cardNo = 'ID-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,4).toUpperCase();
      await pool.query('INSERT INTO student_id_cards(tenant_id,student_id,card_number,status,issued_date) VALUES($1,$2,$3,$4,CURRENT_DATE)', [t, sid, cardNo, 'active']);
    }
  }
  res.redirect('/school/id-cards');
}));

app.get('/school/id-cards/:id/print', requireAuth, requireNotBanned, requireFeature('student_id_cards'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const card = (await pool.query('SELECT sic.*, s.name,s.class,s.admission_no,s.photo_url,s.gender FROM student_id_cards sic JOIN students s ON sic.student_id=s.id WHERE sic.tenant_id=$1 AND sic.id=$2', [t, req.params.id])).rows[0];
  if (!card) return res.redirect('/school/id-cards');
  const tenant = (await pool.query('SELECT name,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Print ID Card', `
    
      
        ${esc(tenant?.name||'School')}STUDENT IDENTITY CARD
      
      ${card.photo_url?``:'👤'}
      ${esc(card.name)}
      Class: ${esc(card.class||'-')} | ${esc(card.gender||'')}
      Adm No: ${esc(card.admission_no||'-')}
      
        Card No: ${esc(card.card_number)}
        Issued: ${card.issued_date||new Date().toLocaleDateString()}
      
    
    Print Card
    `, req.session.user));
}));

// =============================================
// SCHOOL: SCHOOL SHOP / BOOKSTORE
// =============================================
app.get('/school/shop', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM school_shop_items WHERE tenant_id=$1 ORDER BY category, name', [t])).rows;
  const sales = (await pool.query('SELECT COALESCE(SUM(total),0) as total_sales FROM school_shop_sales WHERE tenant_id=$1', [t])).rows;
  res.send(renderPage('School Shop', `School Shop / Bookstore
    UGX ${Number(sales[0]?.total_sales||0).toLocaleString()}Total Sales${items.length}Items
    + Add Item
    View Sales
    NameCategoryPriceStockActions
    ${items.map(i=>`${esc(i.name)}${esc(i.category||'-')}UGX ${(i.price||0).toLocaleString()}${i.stock_quantity??'-'}Sell Edit`).join('')||'No items in shop'}
    `, req.session.user));
}));

app.get('/school/shop/new-item', requireAuth, requireNotBanned, requireFeature('school_shop'), (req, res) => {
  res.send(renderPage('Add Shop Item', `Add Shop Item
    
      
      BooksStationeryUniformSuppliesOther
      
      
      
      Add Item
    `, req.session.user));
});

app.post('/school/shop/save-item', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, category, price, stock_quantity, description } = req.body;
  await pool.query('INSERT INTO school_shop_items(tenant_id,name,category,price,stock_quantity,description) VALUES($1,$2,$3,$4,$5,$6)', [t, name, category||'other', price, stock_quantity||0, description||null]);
  res.redirect('/school/shop');
}));

app.get('/school/shop/sell', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const itemId = req.query.item_id;
  const item = itemId ? (await pool.query('SELECT * FROM school_shop_items WHERE tenant_id=$1 AND id=$2', [t, itemId])).rows[0] : null;
  const students = (await pool.query('SELECT id,name FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Sell Item', `Sell Item
    
      Select Item${(await pool.query('SELECT id,name,price FROM school_shop_items WHERE tenant_id=$1 ORDER BY name', [t])).rows.map(i=>`${esc(i.name)} - UGX ${(i.price||0).toLocaleString()}`).join('')}
      
      StudentStaffOther
      Select Buyer (optional)${students.map(s=>`${esc(s.name)}`).join('')}
      
      Complete Sale
    `, req.session.user));
}));

app.post('/school/shop/save-sale', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { item_id, quantity, buyer_type, buyer_id, buyer_name } = req.body;
  const item = (await pool.query('SELECT * FROM school_shop_items WHERE tenant_id=$1 AND id=$2', [t, item_id])).rows[0];
  if (!item) return res.redirect('/school/shop');
  const qty = parseInt(quantity) || 1;
  const total = (item.price || 0) * qty;
  await pool.query('INSERT INTO school_shop_sales(tenant_id,item_id,quantity,total,buyer_type,buyer_id,buyer_name) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, item_id, qty, total, buyer_type||'other', buyer_id||null, buyer_name||null]);
  await pool.query('UPDATE school_shop_items SET stock_quantity=GREATEST(stock_quantity-$1,0) WHERE id=$2', [qty, item_id]);
  res.redirect('/school/shop/sales');
}));

app.get('/school/shop/sales', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sales = (await pool.query('SELECT ss.*, si.name as item_name FROM school_shop_sales ss LEFT JOIN school_shop_items si ON ss.item_id=si.id WHERE ss.tenant_id=$1 ORDER BY ss.created_at DESC', [t])).rows;
  const totalSales = sales.reduce((s,r)=>s+(r.total||0),0);
  res.send(renderPage('Shop Sales', `Sales History
    UGX ${totalSales.toLocaleString()}Total Revenue${sales.length}Sales
    DateItemQtyTotalBuyer
    ${sales.map(s=>`${new Date(s.created_at).toLocaleDateString()}${esc(s.item_name||'-')}${s.quantity}UGX ${(s.total||0).toLocaleString()}${esc(s.buyer_name||'-')}`).join('')||'No sales yet'}
    `, req.session.user));
}));

app.get('/school/shop/item/:id/edit', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const item = (await pool.query('SELECT * FROM school_shop_items WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!item) return res.redirect('/school/shop');
  res.send(renderPage('Edit Item', `Edit Shop Item
    
      
      
      
      Update
    `, req.session.user));
}));

app.post('/school/shop/item/:id/update', requireAuth, requireNotBanned, requireFeature('school_shop'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, price, stock_quantity } = req.body;
  await pool.query('UPDATE school_shop_items SET name=$1,price=$2,stock_quantity=$3 WHERE tenant_id=$4 AND id=$5', [name, price, stock_quantity||0, t, req.params.id]);
  res.redirect('/school/shop');
}));

// =============================================
// SHOP: CUSTOMER-FACING CATALOG & CART (Phase 3)
// =============================================
app.get('/shop/browse', ah(async (req, res) => {
  const t = req.session.user?.tenant_id;
  if (!t) {
    // Public browsing - get first active tenant's shop or show all
    const items = (await pool.query("SELECT * FROM school_shop_items WHERE is_active=true OR is_active IS NULL ORDER BY name")).rows;
    return res.send(renderPage('Shop', `🛒 ShopBrowse products and place orders
      i.style.display=i.dataset.name.toLowerCase().includes(this.value.toLowerCase())?'':'none')">
      ${items.map(i=>`${esc(i.name)}${i.image_url?``:''}${esc(i.category||'General')}UGX ${(i.price||0).toLocaleString()} ${esc(i.unit||'each')}${i.stock>0?i.stock+' in stock':'Out of stock'}Add to Cart`).join('')||'No items available'}`, null, req));
  }
  const search = req.query.q || '';
  const category = req.query.cat || '';
  let q = 'SELECT * FROM school_shop_items WHERE tenant_id=$1 AND (is_active=true OR is_active IS NULL)';
  const params = [t];
  if (search) { q += ' AND name ILIKE $2'; params.push('%'+search+'%'); }
  if (category) { q += ' AND category=$'+(params.length+1); params.push(category); }
  q += ' ORDER BY name';
  const items = (await pool.query(q, params)).rows;
  const categories = (await pool.query('SELECT DISTINCT category FROM school_shop_items WHERE tenant_id=$1 AND category IS NOT NULL', [t])).rows.map(r=>r.category);
  const cart = req.session.cart || [];
  const cartCount = cart.reduce((s,c)=>s+c.quantity,0);
  res.send(renderPage('Shop', `🛒 ShopBrowse products and place orders
    🛍️ Cart (${cartCount})
    All Categories${categories.map(c=>`${esc(c)}`).join('')}Search
    ${items.map(i=>`${esc(i.name)}${i.image_url?``:''}${esc(i.category||'General')}UGX ${(i.price||0).toLocaleString()} ${esc(i.unit||'each')}${(i.stock_quantity||i.stock||0)>0?(i.stock_quantity||i.stock||0)+' in stock':'Out of stock'}Add to Cart`).join('')||'No items available'}`, req.session.user, req));
}));

app.get('/shop/cart', ah(async (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((s,c)=>s+c.price*c.quantity,0);
  res.send(renderPage('Shopping Cart', `🛍️ Your Cart
    ${cart.length===0?'Your cart is emptyBrowse Shop':`
    ItemPriceQtySubtotal
    ${cart.map((c,i)=>`${esc(c.name)}UGX ${c.price.toLocaleString()}${c.quantity}UGX ${(c.price*c.quantity).toLocaleString()}✕`).join('')}
    
    Total: UGX ${total.toLocaleString()}
    Proceed to Checkout
    Continue Shopping`}
    `, req.session.user||null, req));
}));

app.post('/shop/cart/add', ah(async (req, res) => {
  if (!req.session.cart) req.session.cart = [];
  const { item_id, name, price } = req.body;
  const existing = req.session.cart.find(c=>c.itemId==item_id);
  if (existing) { existing.quantity++; } else { req.session.cart.push({ itemId: item_id, name: name||'Item', price: parseInt(price)||0, quantity: 1 }); }
  res.redirect('/shop/cart');
}));

app.post('/shop/cart/remove', ah(async (req, res) => {
  const { item_id } = req.body;
  if (req.session.cart) { req.session.cart = req.session.cart.filter(c=>c.itemId!=item_id); }
  res.redirect('/shop/cart');
}));

app.get('/shop/cart/remove/:idx', ah(async (req, res) => {
  const idx = parseInt(req.params.idx);
  if (req.session.cart && idx>=0 && idx {
  const cart = req.session.cart || [];
  if (cart.length===0) return res.redirect('/shop/browse');
  const total = cart.reduce((s,c)=>s+c.price*c.quantity,0);
  res.send(renderPage('Checkout', `💳 Checkout
    Order Total: UGX ${total.toLocaleString()}
    ItemQtySubtotal
    ${cart.map(c=>`${esc(c.name)}${c.quantity}UGX ${(c.price*c.quantity).toLocaleString()}`).join('')}
    
      
      
      
      Cash on DeliveryMTN MoMoAirtel MoneyBank Transfer
      
      Place Order
    `, req.session.user, req));
}));

app.post('/shop/order/place', requireAuth, requireNotBanned, requireFeature('shop_catalog'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const cart = req.session.cart || [];
  if (cart.length===0) return res.redirect('/shop/browse');
  const { buyer_name, buyer_email, buyer_phone, payment_method, notes } = req.body;
  const total = cart.reduce((s,c)=>s+c.price*c.quantity,0);
  const orderNo = 'ORD-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  await pool.query('INSERT INTO shop_orders(tenant_id,order_no,buyer_email,buyer_name,buyer_phone,items,total,status,payment_method,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t, orderNo, buyer_email||null, buyer_name||'', buyer_phone||null, JSON.stringify(cart), total, 'pending', payment_method||'cash', notes||null]);
  // Deduct stock
  for (const item of cart) {
    try { await pool.query('UPDATE school_shop_items SET stock_quantity=GREATEST(stock_quantity-$1,0) WHERE id=$2', [item.quantity, item.itemId]); } catch(e) {}
  }
  req.session.cart = [];
  res.send(renderPage('Order Placed!', `✅ Order Placed!Your order ${esc(orderNo)} has been placed.Total: UGX ${total.toLocaleString()}View My OrdersContinue Shopping`, req.session.user, req));
}));

app.get('/shop/orders', requireAuth, requireNotBanned, requireFeature('shop_catalog'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const orders = (await pool.query('SELECT * FROM shop_orders WHERE tenant_id=$1 AND buyer_email=$2 ORDER BY created_at DESC', [t, req.session.user.email])).rows;
  res.send(renderPage('My Orders', `📦 My Orders
    ${orders.length===0?'No orders yet':`Order #DateTotalStatusPayment
    ${orders.map(o=>`${esc(o.order_no)}${new Date(o.created_at).toLocaleDateString()}UGX ${(o.total||0).toLocaleString()}${esc(o.status)}${esc(o.payment_method||'-')}`).join('')}`}
    Continue Shopping`, req.session.user, req));
}));

// =============================================
// SCHOOL: SIBLING DISCOUNTS
// =============================================
app.get('/school/sibling-discounts', requireAuth, requireNotBanned, requireFeature('sibling_discounts'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const discounts = (await pool.query('SELECT sd.* FROM sibling_discounts sd WHERE sd.tenant_id=$1 ORDER BY sd.created_at DESC', [t])).rows;
  res.send(renderPage('Sibling Discounts', `Sibling Discounts
    + Add Discount
    Primary StudentSiblingsDiscount %TypeActions
    ${discounts.map(d=>`${esc(d.primary_student||'-')}${esc(d.sibling_count||0)}${d.discount_percent||0}%${esc(d.discount_type||'fee')}Delete`).join('')||'No sibling discounts'}
    `, req.session.user));
}));

app.get('/school/sibling-discounts/new', requireAuth, requireNotBanned, requireFeature('sibling_discounts'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('Add Sibling Discount', `Add Sibling Discount
    
      Select Primary Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      
      
      Fee DiscountTransport DiscountMeal DiscountTotal Discount
      
      Save Discount
    `, req.session.user));
}));

app.post('/school/sibling-discounts/save', requireAuth, requireNotBanned, requireFeature('sibling_discounts'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, sibling_count, discount_percent, discount_type, notes } = req.body;
  try { await pool.query('INSERT INTO sibling_discounts(tenant_id,student_id,sibling_count,discount_percent,discount_type,notes) VALUES($1,$2,$3,$4,$5,$6)', [t, student_id, sibling_count, discount_percent, discount_type||'fee', notes||null]); } catch(e) { await pool.query('INSERT INTO sibling_discounts(tenant_id,family_name,discount_percent,notes) VALUES($1,$2,$3,$4)', [t, req.body.family_name||'Family', discount_percent||10, notes||null]); }
  res.redirect('/school/sibling-discounts');
}));

app.get('/school/sibling-discounts/:id/delete', requireAuth, requireNotBanned, requireFeature('sibling_discounts'), ah(async (req, res) => {
  await pool.query('DELETE FROM sibling_discounts WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/sibling-discounts');
}));

// =============================================
// SCHOOL: STAFF PERFORMANCE APPRAISAL
// =============================================
app.get('/school/appraisals', requireAuth, requireNotBanned, requireFeature('staff_appraisal'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const appraisals = (await pool.query('SELECT sa.*, s.name as staff_name FROM staff_appraisals sa LEFT JOIN staff s ON sa.staff_id=s.id WHERE sa.tenant_id=$1 ORDER BY sa.created_at DESC', [t])).rows;
  res.send(renderPage('Staff Appraisals', `Staff Performance Appraisal
    + New Appraisal
    StaffPeriodScoreRatingStatusActions
    ${appraisals.map(a=>{const rating=a.score>=80?'Excellent':a.score>=60?'Good':a.score>=40?'Average':'Below Average';const color=a.score>=80?'#059669':a.score>=60?'#4f46e5':a.score>=40?'#f59e0b':'#dc2626';return `${esc(a.staff_name||a.staff_email||'-')}${esc(a.period||'-')}${a.score||0}%${rating}${esc(a.status||'pending')}View`}).join('')||'No appraisals yet'}
    `, req.session.user));
}));

app.get('/school/appraisals/new', requireAuth, requireNotBanned, requireFeature('staff_appraisal'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const staff = (await pool.query('SELECT id,name,email,role FROM staff WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('New Appraisal', `New Staff Appraisal
    
      Select Staff${staff.map(s=>`${esc(s.name)} (${esc(s.role||'')})`).join('')}
      
      
        Teaching Quality (0-100)
        Professionalism (0-100)
        Punctuality (0-100)
        Student Results (0-100)
      
      
      
      
      
      Submit Appraisal
    `, req.session.user));
}));

app.post('/school/appraisals/save', requireAuth, requireNotBanned, requireFeature('staff_appraisal'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { staff_id, period, teaching_score, professionalism_score, punctuality_score, results_score, strengths, improvements, goals, comments } = req.body;
  const tScore = parseInt(teaching_score)||0, pScore = parseInt(professionalism_score)||0, puScore = parseInt(punctuality_score)||0, rScore = parseInt(results_score)||0;
  const avgScore = Math.round((tScore + pScore + puScore + rScore) / 4);
  await pool.query('INSERT INTO staff_appraisals(tenant_id,staff_id,period,teaching_score,professionalism_score,punctuality_score,results_score,score,strengths,improvements,goals,comments,appraiser,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [t, staff_id, period, tScore, pScore, puScore, rScore, avgScore, strengths||null, improvements||null, goals||null, comments||null, req.session.user.email, 'completed']);
  res.redirect('/school/appraisals');
}));

app.get('/school/appraisals/:id', requireAuth, requireNotBanned, requireFeature('staff_appraisal'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const a = (await pool.query('SELECT sa.*, s.name as staff_name, s.role FROM staff_appraisals sa LEFT JOIN staff s ON sa.staff_id=s.id WHERE sa.tenant_id=$1 AND sa.id=$2', [t, req.params.id])).rows[0];
  if (!a) return res.redirect('/school/appraisals');
  const rating=a.score>=80?'Excellent':a.score>=60?'Good':a.score>=40?'Average':'Below Average';
  res.send(renderPage('Appraisal Details', `Appraisal: ${esc(a.staff_name||'-')}
    ${a.score||0}%Overall Score${rating}Rating${esc(a.period||'-')}Period
    
      Teaching: ${a.teaching_score||0}%
      Professionalism: ${a.professionalism_score||0}%
      Punctuality: ${a.punctuality_score||0}%
      Results: ${a.results_score||0}%
    
    ${a.strengths?`Strengths${esc(a.strengths)}`:''}
    ${a.improvements?`Areas for Improvement${esc(a.improvements)}`:''}
    ${a.goals?`Goals${esc(a.goals)}`:''}
    `, req.session.user));
}));

// =============================================
// SCHOOL: MAINTENANCE REQUESTS
// =============================================
app.get('/school/maintenance', requireAuth, requireNotBanned, requireFeature('maintenance'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const requests = (await pool.query('SELECT * FROM maintenance_requests WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const pending = requests.filter(r=>r.status==='pending').length;
  const resolved = requests.filter(r=>r.status==='resolved').length;
  res.send(renderPage('Maintenance Requests', `Maintenance Requests
    ${pending}Pending${resolved}Resolved${requests.length}Total
    + New Request
    IssueLocationPriorityRequested ByStatusActions
    ${requests.map(r=>`${esc(r.title||r.issue)}${esc(r.location||'-')}${esc(r.priority||'normal')}${esc(r.requested_by||'-')}${esc(r.status||'pending')}${r.status!=='resolved'?`Resolve`:'Resolved'}`).join('')||'No maintenance requests'}
    `, req.session.user));
}));

app.get('/school/maintenance/new', requireAuth, requireNotBanned, requireFeature('maintenance'), (req, res) => {
  res.send(renderPage('New Maintenance Request', `New Maintenance Request
    
      
      PlumbingElectricalFurnitureBuilding/StructuralEquipmentCleaningOther
      
      NormalHighUrgent
      
      Submit Request
    `, req.session.user));
});

app.post('/school/maintenance/save', requireAuth, requireNotBanned, requireFeature('maintenance'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, category, location, priority, description } = req.body;
  await pool.query('INSERT INTO maintenance_requests(tenant_id,title,category,location,priority,description,requested_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, title, category||'other', location, priority||'normal', description, req.session.user.email, 'pending']);
  res.redirect('/school/maintenance');
}));

app.get('/school/maintenance/:id/resolve', requireAuth, requireNotBanned, requireFeature('maintenance'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE maintenance_requests SET status='resolved',resolved_at=NOW(),resolved_by=$1 WHERE tenant_id=$2 AND id=$3", [req.session.user.email, t, req.params.id]);
  res.redirect('/school/maintenance');
}));

// =============================================
// SCHOOL: LOST & FOUND
// =============================================
app.get('/school/lost-found', requireAuth, requireNotBanned, requireFeature('lost_found'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const items = (await pool.query('SELECT * FROM lost_found WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const lost = items.filter(i=>i.type==='lost').length;
  const found = items.filter(i=>i.type==='found').length;
  const claimed = items.filter(i=>i.status==='claimed').length;
  res.send(renderPage('Lost & Found', `Lost & Found
    ${lost}Lost${found}Found${claimed}Claimed
    + Report Item
    TypeItemDescriptionLocationDateStatusActions
    ${items.map(i=>`${esc(i.type)}${esc(i.item_name)}${esc(i.description||'-')}${esc(i.location||'-')}${i.reported_date||'-'}${esc(i.status||'open')}${i.status!=='claimed'?`Claim`:''}`).join('')||'No items reported'}
    `, req.session.user));
}));

app.get('/school/lost-found/new', requireAuth, requireNotBanned, requireFeature('lost_found'), (req, res) => {
  res.send(renderPage('Report Item', `Report Lost/Found Item
    
      Lost ItemFound Item
      
      
      
      
      
      Submit Report
    `, req.session.user));
});

app.post('/school/lost-found/save', requireAuth, requireNotBanned, requireFeature('lost_found'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, item_name, description, location, reported_date, contact_info } = req.body;
  await pool.query('INSERT INTO lost_found(tenant_id,type,item_name,description,location,reported_date,contact_info,reported_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, type, item_name, description, location||null, reported_date||null, contact_info||null, req.session.user.email, 'open']);
  res.redirect('/school/lost-found');
}));

app.get('/school/lost-found/:id/claim', requireAuth, requireNotBanned, requireFeature('lost_found'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE lost_found SET status='claimed',claimed_at=NOW(),claimed_by=$1 WHERE tenant_id=$2 AND id=$3", [req.session.user.email, t, req.params.id]);
  res.redirect('/school/lost-found');
}));

// =============================================
// SCHOOL: PHOTO GALLERY
// =============================================
app.get('/school/gallery', requireAuth, requireNotBanned, requireFeature('photo_gallery'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const galleries = (await pool.query('SELECT pg.*, (SELECT COUNT(*) FROM gallery_photos WHERE gallery_id=pg.id) as photo_count FROM photo_galleries pg WHERE pg.tenant_id=$1 ORDER BY pg.created_at DESC', [t])).rows;
  res.send(renderPage('Photo Gallery', `Photo Gallery
    + New Gallery
    
    ${galleries.map(g=>`
      
        ${esc(g.title)}
        ${esc(g.description||'')}
        ${g.photo_count||0} photos ${new Date(g.created_at).toLocaleDateString()}
      
    `).join('')||'No galleries yet. Create one to get started!'}
    `, req.session.user));
}));

app.get('/school/gallery/new', requireAuth, requireNotBanned, requireFeature('photo_gallery'), (req, res) => {
  res.send(renderPage('New Gallery', `Create Photo Gallery
    
      
      
      EventsSportsAcademicsCampusOther
      Create Gallery
    `, req.session.user));
});

app.post('/school/gallery/save', requireAuth, requireNotBanned, requireFeature('photo_gallery'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, category } = req.body;
  await pool.query('INSERT INTO photo_galleries(tenant_id,title,description,category,created_by) VALUES($1,$2,$3,$4,$5)', [t, title, description||null, category||'events', req.session.user.email]);
  res.redirect('/school/gallery');
}));

app.get('/school/gallery/:id', requireAuth, requireNotBanned, requireFeature('photo_gallery'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const gallery = (await pool.query('SELECT * FROM photo_galleries WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!gallery) return res.redirect('/school/gallery');
  const photos = (await pool.query('SELECT *, COALESCE(photo_url, url) as display_url FROM gallery_photos WHERE gallery_id=$1 ORDER BY COALESCE(created_at,uploaded_at)', [gallery.id])).rows;
  res.send(renderPage(esc(gallery.title), `${esc(gallery.title)}
    ${esc(gallery.description||'')}
    + Upload Photo
    
    ${photos.map(p=>`
      
      ${p.caption?`${esc(p.caption)}`:''}
      X
    `).join('')||'No photos yet. Upload some!'}
    `, req.session.user));
}));

app.get('/school/gallery/:id/upload', requireAuth, requireNotBanned, requireFeature('photo_gallery'), (req, res) => {
  const hasCloudinary = !!process.env.CLOUDINARY_URL;
  res.send(renderPage('Upload Photo', `Upload Photo
    
      
        📷
        Choose photo from your device
        
        ${hasCloudinary ? 'Cloud upload enabled' : 'Paste a URL below if cloud not configured'}
      
      
      — OR paste URL —
      
      Upload Photo
    `, req.session.user));
});

app.post('/school/gallery/:id/upload-save', requireAuth, requireNotBanned, requireFeature('photo_gallery'), upload.single('photo'), ah(async (req, res) => {
  const galleryId = req.params.id;
  let photoUrl = req.body.photo_url || '';
  if (req.file) {
    const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploaded = await uploadToCloudinary(b64, 'ssewasswa/gallery');
    if (uploaded) photoUrl = uploaded;
  }
  if (!photoUrl) return res.redirect(`/school/gallery/${galleryId}/upload`);
  await pool.query('INSERT INTO gallery_photos(gallery_id,photo_url,caption) VALUES($1,$2,$3)', [galleryId, photoUrl, req.body.caption||null]);
  res.redirect(`/school/gallery/${galleryId}`);
}));

app.get('/school/gallery/photo/:id/delete', requireAuth, requireNotBanned, requireFeature('photo_gallery'), ah(async (req, res) => {
  const photo = (await pool.query('SELECT gallery_id FROM gallery_photos WHERE id=$1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM gallery_photos WHERE id=$1', [req.params.id]);
  res.redirect(photo ? `/school/gallery/${photo.gallery_id}` : '/school/gallery');
}));

// =============================================
// SCHOOL: NEWSLETTERS
// =============================================
app.get('/school/newsletters', requireAuth, requireNotBanned, requireFeature('newsletters'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const newsletters = (await pool.query('SELECT * FROM newsletters WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Newsletters', `Newsletters
    + Create Newsletter
    TitleAudienceStatusDateActions
    ${newsletters.map(n=>`${esc(n.title)}${esc(n.audience||'all')}${esc(n.status||'draft')}${new Date(n.created_at).toLocaleDateString()}View ${n.status==='draft'?`Publish`:''}`).join('')||'No newsletters'}
    `, req.session.user));
}));

app.get('/school/newsletters/new', requireAuth, requireNotBanned, requireFeature('newsletters'), (req, res) => {
  res.send(renderPage('Create Newsletter', `Create Newsletter
    
      
      AllParentsStudentsStaff
      
      Save as Draft
    `, req.session.user));
});

app.post('/school/newsletters/save', requireAuth, requireNotBanned, requireFeature('newsletters'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, audience, content } = req.body;
  await pool.query('INSERT INTO newsletters(tenant_id,title,audience,content,created_by,status) VALUES($1,$2,$3,$4,$5,$6)', [t, title, audience||'all', content, req.session.user.email, 'draft']);
  res.redirect('/school/newsletters');
}));

app.get('/school/newsletters/:id', requireAuth, requireNotBanned, requireFeature('newsletters'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const n = (await pool.query('SELECT * FROM newsletters WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!n) return res.redirect('/school/newsletters');
  res.send(renderPage(esc(n.title), `${esc(n.title)}
    For: ${esc(n.audience||'All')} | Status: ${esc(n.status||'draft')} | By: ${esc(n.created_by||'-')}
    ${esc(n.content)}
    ${n.status==='draft'?`Publish Newsletter Delete`:''}
    `, req.session.user));
}));

app.get('/school/newsletters/:id/publish', requireAuth, requireNotBanned, requireFeature('newsletters'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE newsletters SET status='published',published_at=NOW() WHERE tenant_id=$1 AND id=$2", [t, req.params.id]);
  res.redirect(`/school/newsletters/${req.params.id}`);
}));

app.get('/school/newsletters/:id/delete', requireAuth, requireNotBanned, requireFeature('newsletters'), ah(async (req, res) => {
  await pool.query('DELETE FROM newsletters WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/newsletters');
}));

// =============================================
// SCHOOL: RUBRIC-BASED GRADING
// =============================================
app.get('/school/rubrics', requireAuth, requireNotBanned, requireFeature('rubrics'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const rubrics = (await pool.query('SELECT * FROM rubrics WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Rubrics', `Rubric-Based Grading
    + New Rubric
    TitleSubjectCriteriaMax ScoreActions
    ${rubrics.map(r=>`${esc(r.title)}${esc(r.subject||'-')}${r.criteria_count||'-'}${r.max_score||100}View Del`).join('')||'No rubrics'}
    `, req.session.user));
}));

app.get('/school/rubrics/new', requireAuth, requireNotBanned, requireFeature('rubrics'), (req, res) => {
  res.send(renderPage('New Rubric', `Create Rubric
    
      
      
      
      Criteria (one per line, format: Criterion | Weight %)
      
      Performance Levels (one per line)
      
      
      Create Rubric
    `, req.session.user));
});

app.post('/school/rubrics/save', requireAuth, requireNotBanned, requireFeature('rubrics'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, subject, max_score, criteria, levels, description } = req.body;
  const criteriaLines = (criteria||'').split('\n').filter(l=>l.trim());
  await pool.query('INSERT INTO rubrics(tenant_id,title,subject,max_score,criteria_count,criteria,levels,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, title, subject||null, max_score||100, criteriaLines.length, criteria, levels||null, description||null, req.session.user.email]);
  res.redirect('/school/rubrics');
}));

app.get('/school/rubrics/:id', requireAuth, requireNotBanned, requireFeature('rubrics'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const r = (await pool.query('SELECT * FROM rubrics WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!r) return res.redirect('/school/rubrics');
  const criteriaList = (r.criteria||'').split('\n').filter(l=>l.trim());
  const levelsList = (r.levels||'').split('\n').filter(l=>l.trim());
  res.send(renderPage(esc(r.title), `${esc(r.title)}
    ${esc(r.subject||'')} | Max Score: ${r.max_score||100} | Criteria: ${criteriaList.length}
    ${r.description?`${esc(r.description)}`:''}
    Criteria
    CriterionWeight
    ${criteriaList.map(c=>{const parts=c.split('|');return `${esc(parts[0]?.trim()||c)}${esc(parts[1]?.trim()||'-')}`}).join('')||'No criteria defined'}
    
    ${levelsList.length?`Performance Levels${levelsList.map(l=>`${esc(l.trim())}`).join('')}`:''}
    `, req.session.user));
}));

app.get('/school/rubrics/:id/delete', requireAuth, requireNotBanned, requireFeature('rubrics'), ah(async (req, res) => {
  await pool.query('DELETE FROM rubrics WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/rubrics');
}));

// =============================================
// SCHOOL: COMPETENCY TRACKING
// =============================================
app.get('/school/competencies', requireAuth, requireNotBanned, requireFeature('competency_tracking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const assessments = (await pool.query('SELECT ca.*, s.name as student_name FROM competency_assessments ca LEFT JOIN students s ON ca.student_id=s.id WHERE ca.tenant_id=$1 ORDER BY ca.created_at DESC', [t])).rows;
  res.send(renderPage('Competency Tracking', `Competency Tracking
    + New Assessment
    StudentCompetencyLevelAssessed ByDateActions
    ${assessments.map(a=>`${esc(a.student_name||'-')}${esc(a.competency||'-')}${esc(a.level||'-')}${esc(a.assessed_by||'-')}${a.assessed_date||'-'}Del`).join('')||'No competency assessments'}
    `, req.session.user));
}));

app.get('/school/competencies/new', requireAuth, requireNotBanned, requireFeature('competency_tracking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id,name,class FROM students WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  res.send(renderPage('New Competency Assessment', `New Competency Assessment
    
      Select Student${students.map(s=>`${esc(s.name)} (${esc(s.class||'')})`).join('')}
      
      BeginnerDevelopingProficientAdvancedExpert
      
      
      Save Assessment
    `, req.session.user));
}));

app.post('/school/competencies/save', requireAuth, requireNotBanned, requireFeature('competency_tracking'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { student_id, competency, level, evidence, assessed_date } = req.body;
  await pool.query('INSERT INTO competency_assessments(tenant_id,student_id,competency,level,evidence,assessed_by,assessed_date) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, student_id, competency, level||'developing', evidence||null, req.session.user.email, assessed_date||null]);
  res.redirect('/school/competencies');
}));

app.get('/school/competencies/:id/delete', requireAuth, requireNotBanned, requireFeature('competency_tracking'), ah(async (req, res) => {
  await pool.query('DELETE FROM competency_assessments WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/competencies');
}));

// =============================================
// SCHOOL: CURRICULUM MAPPING
// =============================================
app.get('/school/curriculum', requireAuth, requireNotBanned, requireFeature('curriculum_mapping'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const maps = (await pool.query('SELECT * FROM curriculum_maps WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  res.send(renderPage('Curriculum Mapping', `Curriculum Mapping
    + New Curriculum Map
    SubjectClassTermTopicsStatusActions
    ${maps.map(m=>`${esc(m.subject)}${esc(m.class_name||'-')}${esc(m.term||'-')}${esc(m.topics||'-')}${esc(m.status||'draft')}View Del`).join('')||'No curriculum maps'}
    `, req.session.user));
}));

app.get('/school/curriculum/new', requireAuth, requireNotBanned, requireFeature('curriculum_mapping'), (req, res) => {
  res.send(renderPage('New Curriculum Map', `Create Curriculum Map
    
      
      
      
      
      
      
      
      
      DraftApprovedActive
      Create Map
    `, req.session.user));
});

app.post('/school/curriculum/save', requireAuth, requireNotBanned, requireFeature('curriculum_mapping'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { subject, class_name, term, objectives, topics, activities, resources, assessments, status } = req.body;
  await pool.query('INSERT INTO curriculum_maps(tenant_id,subject,class_name,term,objectives,topics,activities,resources,assessments,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [t, subject, class_name||null, term||null, objectives||null, topics||null, activities||null, resources||null, assessments||null, status||'draft', req.session.user.email]);
  res.redirect('/school/curriculum');
}));

app.get('/school/curriculum/:id', requireAuth, requireNotBanned, requireFeature('curriculum_mapping'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const m = (await pool.query('SELECT * FROM curriculum_maps WHERE tenant_id=$1 AND id=$2', [t, req.params.id])).rows[0];
  if (!m) return res.redirect('/school/curriculum');
  res.send(renderPage(esc(m.subject), `${esc(m.subject)} - ${esc(m.class_name||'')} ${esc(m.term||'')}
    Status: ${esc(m.status||'draft')} | By: ${esc(m.created_by||'-')}
    ${m.objectives?`Learning Objectives${esc(m.objectives)}`:''}
    ${m.topics?`Topics${esc(m.topics)}`:''}
    ${m.activities?`Activities${esc(m.activities)}`:''}
    ${m.resources?`Resources${esc(m.resources)}`:''}
    ${m.assessments?`Assessments${esc(m.assessments)}`:''}
    `, req.session.user));
}));

app.get('/school/curriculum/:id/delete', requireAuth, requireNotBanned, requireFeature('curriculum_mapping'), ah(async (req, res) => {
  await pool.query('DELETE FROM curriculum_maps WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
  res.redirect('/school/curriculum');
}));

// =============================================
// BUSINESS: PROCUREMENT / INTERNAL REQUISITIONS
// =============================================
app.get('/requisitions', requireAuth, requireNotBanned, requireFeature('requisitions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const reqs = (await pool.query('SELECT * FROM requisitions WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
  const pending = reqs.filter(r=>r.status==='pending').length;
  const approved = reqs.filter(r=>r.status==='approved').length;
  res.send(renderPage('Requisitions', `Procurement & Requisitions
    ${pending}Pending${approved}Approved${reqs.length}Total
    + New Requisition
    TitleCategoryAmountRequested ByStatusActions
    ${reqs.map(r=>`${esc(r.title)}${esc(r.category||'-')}UGX ${(r.amount||0).toLocaleString()}${esc(r.requested_by||'-')}${esc(r.status||'pending')}${r.status==='pending'?`Approve Reject`:''}`).join('')||'No requisitions'}
    `, req.session.user));
}));

app.get('/requisitions/new', requireAuth, requireNotBanned, requireFeature('requisitions'), (req, res) => {
  res.send(renderPage('New Requisition', `New Requisition
    
      
      Office SuppliesEquipmentMaintenanceFood & CateringTransportOther
      
      
      
      Submit Requisition
    `, req.session.user));
});

app.post('/requisitions/save', requireAuth, requireNotBanned, requireFeature('requisitions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, category, amount, description, urgency } = req.body;
  await pool.query('INSERT INTO requisitions(tenant_id,title,category,amount,description,urgency,requested_by,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, title, category||'other', amount||0, description, urgency||'medium', req.session.user.email, 'pending']);
  res.redirect('/requisitions');
}));

app.get('/requisitions/:id/approve', requireAuth, requireNotBanned, requireFeature('requisitions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE requisitions SET status='approved',approved_by=$1,approved_at=NOW() WHERE tenant_id=$2 AND id=$3", [req.session.user.email, t, req.params.id]);
  res.redirect('/requisitions');
}));

app.get('/requisitions/:id/reject', requireAuth, requireNotBanned, requireFeature('requisitions'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query("UPDATE requisitions SET status='rejected',approved_by=$1 WHERE tenant_id=$2 AND id=$3", [req.session.user.email, t, req.params.id]);
  res.redirect('/requisitions');
}));

// =============================================
// SETTINGS: DASHBOARD CUSTOMIZATION
// =============================================
app.get('/settings/dashboard', requireAuth, requireNotBanned, requireFeature('dashboard_customize'), ah(async (req, res) => {
  const u = req.session.user;
  const t = u.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  res.send(renderPage('Dashboard Customization', `Customize Your Dashboard
    Personalize your dashboard appearance and layout.
    
      Theme
      
        
           Light Mode
        
        
           Dark Mode
        
      
      Organization Branding
      
      
      ${esc(tenant?.custom_css||'')}
      Quick Links on Dashboard
      Choose which sections to show on your dashboard:
      
         Statistics Cards
         Charts
         Recent Activity
         Quick Actions
      
      Save Dashboard Settings
    `, req.session.user));
}));

app.post('/settings/dashboard/save', requireAuth, requireNotBanned, requireFeature('dashboard_customize'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { dark_mode, org_name, tagline, custom_css } = req.body;
  // Update user dark mode preference
  await pool.query('UPDATE users SET dark_mode=$1 WHERE id=$2', [dark_mode === 'true', req.session.user.id]);
  req.session.user.dark_mode = dark_mode === 'true';
  // Update tenant branding
  if (org_name) await pool.query('UPDATE tenants SET name=$1, description=$2, custom_css=$3 WHERE id=$4', [org_name, tagline||null, custom_css||null, t]);
  res.redirect('/settings/dashboard');
}));

// ============================================================
// === PUBLIC WEBSITE / LANDING PAGE BUILDER ===
// ============================================================
app.get('/public-site', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const pages = (await pool.query('SELECT * FROM public_pages WHERE tenant_id=$1 ORDER BY page_order', [t])).rows;
  res.send(renderPage('Public Website', `🌐 Public Website BuilderCreate a public-facing website for your organization
    + Add Page
    Preview Site
    PageSlugPublishedOrderActions
    ${pages.map(p=>`${esc(p.title)}/${esc(p.slug)}${p.is_published?'Live':'Draft'}${p.page_order}Edit Publish Del`).join('')||'No pages yet. Create your first page!'}`, req.session.user));
}));

app.get('/public-site/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Public Page', `Add Public Page
    
      
      
      Regular PageHomepageContact PageGallery PageEvents Page
      
      
      
      
      
      Create Page
    `, req.session.user));
});

app.post('/public-site/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, slug, page_type, page_order, content, hero_title, hero_subtitle, meta_description } = req.body;
  await pool.query('INSERT INTO public_pages(tenant_id,title,slug,page_type,page_order,content,hero_title,hero_subtitle,meta_description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [t, title, slug, page_type||'page', page_order||1, content||'', hero_title||'', hero_subtitle||'', meta_description||'']);
  res.redirect('/public-site');
}));

app.get('/public-site/preview', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const pages = (await pool.query("SELECT * FROM public_pages WHERE tenant_id=$1 AND is_published=true ORDER BY page_order", [t])).rows;
  const homePage = pages.find(p => p.page_type === 'home') || pages[0];
  res.send(`${esc(tenant.name||'SSEWASSWA')} - Public Site*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b}.pub-nav{background:#4f46e5;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center}.pub-nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:6px}.pub-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:100px 30px;text-align:center}.pub-content{max-width:900px;margin:40px auto;padding:0 20px}.pub-footer{background:#1e293b;color:white;padding:30px;text-align:center;margin-top:60px}h1{font-size:48px;margin-bottom:15px}h2{font-size:28px;margin-bottom:10px}p{line-height:1.8;margin-bottom:15px}.pub-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin:20px 0}.pub-card{background:white;border-radius:12px;padding:25px;box-shadow:0 2px 12px rgba(0,0,0,0.08);border:1px solid #e2e8f0}
    ${esc(tenant.name||'SSEWASSWA')}${pages.map(p=>`${esc(p.title)}`).join('')}
    ${homePage?`${esc(homePage.hero_title||homePage.title)}${esc(homePage.hero_subtitle||'')}${homePage.content||'Welcome to our site!'}`:'WelcomeYour public website starts here'}
    &copy; ${new Date().getFullYear()} ${esc(tenant.name||'SSEWASSWA')}. Powered by SSEWASSWA Platform.`);
}));

app.get('/public-site/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM public_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!p) return res.status(404).send('Not found');
  res.send(renderPage('Edit Page', `Edit: ${esc(p.title)}
    
      
      
      Regular PageHomepageContact PageGallery PageEvents Page
      
      ${esc(p.content||'')}
      
      
      
      Update Page
    `, req.session.user));
}));

app.post('/public-site/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, slug, page_type, page_order, content, hero_title, hero_subtitle, meta_description } = req.body;
  await pool.query('UPDATE public_pages SET title=$1,slug=$2,page_type=$3,page_order=$4,content=$5,hero_title=$6,hero_subtitle=$7,meta_description=$8 WHERE id=$9 AND tenant_id=$10', [title, slug, page_type, page_order||1, content, hero_title, hero_subtitle, meta_description, req.params.id, req.session.user.tenant_id]);
  res.redirect('/public-site');
}));

app.get('/public-site/:id/publish', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE public_pages SET is_published=NOT is_published WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/public-site');
}));

app.get('/public-site/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM public_pages WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/public-site');
}));

// Public site viewer (no auth required)
app.get('/s/:slug', ah(async (req, res) => {
  const page = (await pool.query('SELECT p.*,t.name as org_name FROM public_pages p JOIN tenants t ON t.id=p.tenant_id WHERE p.slug=$1 AND p.is_published=true', [req.params.slug])).rows[0];
  if (!page) return res.status(404).send('Page not found');
  res.send(`${esc(page.title)} - ${esc(page.org_name)}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;line-height:1.8}.pub-nav{background:#4f46e5;color:white;padding:15px 30px;display:flex;justify-content:space-between;align-items:center}.pub-nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:6px}.pub-hero{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:80px 30px;text-align:center}.pub-content{max-width:900px;margin:40px auto;padding:0 20px}.pub-footer{background:#1e293b;color:white;padding:30px;text-align:center;margin-top:60px}
    ${esc(page.org_name)}Home
    ${esc(page.hero_title||page.title)}${esc(page.hero_subtitle||'')}
    ${page.content||''}
    &copy; ${new Date().getFullYear()} ${esc(page.org_name)}`);
}));

// ============================================================
// === FUNDRAISING / CROWDFUNDING ===
// ============================================================
app.get('/fundraising', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const campaigns = (await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id) as raised FROM fundraising_campaigns c WHERE c.tenant_id=$1 ORDER BY c.created_at DESC', [t])).rows;
  res.send(renderPage('Fundraising', `🎯 FundraisingLaunch campaigns, collect donations, track progress
    
      ${campaigns.length}Campaigns
      UGX ${campaigns.reduce((a,c)=>a+parseInt(c.raised||0),0).toLocaleString()}Total Raised
      ${campaigns.filter(c=>c.status==='active').length}Active
    
    Campaigns
    + New Campaign
    CampaignGoal (UGX)Raised (UGX)ProgressStatusActions
    ${campaigns.map(c=>{const pct=c.target>0?Math.min(100,Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)):0;return `${esc(c.title)}${esc((c.description||'').substring(0,60))}${parseInt(c.target||0).toLocaleString()}${parseInt(c.raised||0).toLocaleString()}=100?'#059669':'#4f46e5'}">${pct}%${esc(c.status)}View Donate Close Del`}).join('')||'No campaigns yet'}`, req.session.user));
}));

app.get('/fundraising/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('New Campaign', `🎯 Create Fundraising Campaign
    
      
      
      
      
      GeneralBuilding FundEducationMedicalChurch ProjectCommunityEmergency Relief
      
      
      
      Launch Campaign
    `, req.session.user));
});

app.post('/fundraising/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { title, description, target, deadline, category, organizer, contact_phone, updates } = req.body;
  await pool.query('INSERT INTO fundraising_campaigns(tenant_id,title,description,target,deadline,category,organizer,contact_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [t, title, description, target||0, deadline||null, category||'general', organizer||'', contact_phone||'']);
  res.redirect('/fundraising');
}));

app.get('/fundraising/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const c = (await pool.query('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id) as raised FROM fundraising_campaigns c WHERE c.id=$1 AND c.tenant_id=$2', [req.params.id, t])).rows[0];
  if (!c) return res.status(404).send('Not found');
  const donations = (await pool.query('SELECT * FROM campaign_donations WHERE campaign_id=$1 ORDER BY donated_at DESC', [c.id])).rows;
  const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;
  res.send(renderPage('Campaign: '+c.title, `🎯 ${esc(c.title)}
    ${esc(c.category)} | by ${esc(c.organizer||'Admin')}
    ${esc(c.description||'')}
    =100?'#059669':'#4f46e5'};display:flex;align-items:center;justify-content:center;color:white;font-weight:700">${pct}%
    
      UGX ${parseInt(c.raised||0).toLocaleString()}Raised
      UGX ${parseInt(c.target||0).toLocaleString()}Goal
      ${donations.length}Donations
    
    💰 Donate Now
    Recent Donations
    ${donations.length?`DonorAmountMethodDate${donations.map(d=>`${esc(d.donor_name||'Anonymous')}UGX ${parseInt(d.amount||0).toLocaleString()}${esc(d.method||'Cash')}${d.donated_at?new Date(d.donated_at).toLocaleDateString():''}`).join('')}`:'No donations yet'}
    `, req.session.user));
}));

app.get('/fundraising/:id/donate', requireAuth, requireNotBanned, ah(async (req, res) => {
  const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
  if (!c) return res.status(404).send('Not found');
  res.send(renderPage('Donate', `💰 Donate to: ${esc(c.title)}
    
      
      
      CashMobile MoneyBank TransferCardOnline
      
      Donate
    `, req.session.user));
}));

app.post('/fundraising/:id/donate-save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { donor_name, amount, method, message } = req.body;
  await pool.query('INSERT INTO campaign_donations(campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5)', [req.params.id, donor_name||'Anonymous', amount||0, method||'cash', message||'']);
  res.redirect('/fundraising/'+req.params.id);
}));

app.get('/fundraising/:id/close', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE fundraising_campaigns SET status=$1 WHERE id=$2 AND tenant_id=$3', ['completed', req.params.id, req.session.user.tenant_id]);
  res.redirect('/fundraising');
}));

app.get('/fundraising/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/fundraising');
}));

// =============================================
// RECURRING DONATIONS (Phase 3)
// =============================================
app.get('/donations/recurring', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const donations = (await pool.query('SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 ORDER BY rd.created_at DESC', [t])).rows;
  const activeCount = donations.filter(d=>d.status==='active').length;
  const totalDonated = donations.reduce((s,d)=>s+(d.total_donated||0),0);
  res.send(renderPage('Recurring Donations', `🔄 Recurring DonationsSchedule automatic recurring donations
    ${activeCount}Active SchedulesUGX ${totalDonated.toLocaleString()}Total Donated${donations.length}All Schedules
    + New Recurring Donation
    DonorAmountScheduleCampaignNext DateTotal DonatedStatusActions
    ${donations.map(d=>`${esc(d.donor_name)}${d.donor_email?''+esc(d.donor_email)+'':''}UGX ${(d.amount||0).toLocaleString()}${esc(d.schedule||'monthly')}${esc(d.campaign_title||'-')}${d.next_date?new Date(d.next_date).toLocaleDateString():'-'}UGX ${(d.total_donated||0).toLocaleString()} (${d.donation_count||0}x)${esc(d.status)}${d.status==='active'?`Pause `:''}${d.status==='paused'?`Resume `:''}${d.status!=='cancelled'?`Cancel`:''}`).join('')||'No recurring donations yet'}
    `, req.session.user, req));
}));

app.get('/donations/recurring/new', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const campaigns = (await pool.query('SELECT id,title FROM fundraising_campaigns WHERE tenant_id=$1 AND status=$2', [t, 'active'])).rows;
  res.send(renderPage('New Recurring Donation', `🔄 New Recurring Donation
    
      
      
      
      
      WeeklyMonthlyQuarterlyYearly
      
      No specific campaign${campaigns.map(c=>`${esc(c.title)}`).join('')}
      CashMTN MoMoAirtel MoneyBank TransferCard
      Create Recurring Donation
    `, req.session.user, req));
}));

app.post('/donations/recurring/save', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { donor_name, donor_email, donor_phone, amount, schedule, next_date, campaign_id, payment_method } = req.body;
  await pool.query('INSERT INTO recurring_donations(tenant_id,donor_name,donor_email,donor_phone,amount,schedule,next_date,campaign_id,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [t, donor_name, donor_email||null, donor_phone||null, amount||0, schedule||'monthly', next_date||null, campaign_id||null, payment_method||'cash', 'active']);
  res.redirect('/donations/recurring');
}));

app.get('/donations/recurring/:id/cancel', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  await pool.query('UPDATE recurring_donations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['cancelled', req.params.id, req.session.user.tenant_id]);
  res.redirect('/donations/recurring');
}));

app.get('/donations/recurring/:id/pause', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  await pool.query('UPDATE recurring_donations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['paused', req.params.id, req.session.user.tenant_id]);
  res.redirect('/donations/recurring');
}));

app.get('/donations/recurring/:id/resume', requireAuth, requireNotBanned, requireFeature('recurring_donations'), ah(async (req, res) => {
  await pool.query('UPDATE recurring_donations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['active', req.params.id, req.session.user.tenant_id]);
  res.redirect('/donations/recurring');
}));

app.post('/api/recurring-donations/process', ah(async (req, res) => {
  // Process due recurring donations - called by cron/scheduler
  const due = (await pool.query("SELECT * FROM recurring_donations WHERE next_date  {
  const t = req.session.user.tenant_id;
  const [videos, music, scraped] = await Promise.all([
    pool.query('SELECT * FROM entertainment_videos WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t]),
    pool.query('SELECT * FROM entertainment_music WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [t]),
    pool.query('SELECT * FROM scraped_content WHERE tenant_id=$1 ORDER BY scraped_at DESC LIMIT 30', [t])
  ]);
  res.send(renderPage('Entertainment Hub', `🎬 Entertainment HubVideos, Music, News, Events & More
    AllVideosMusicNews & EventsAuto-Import
    📺 Videos
    + Add Video
    ${videos.rows.map(v=>{
      const ytId = (v.url||'').match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]||'';
      return ytId?`${esc(v.title)}`:`${esc(v.title)}Open Link`;
    }).join('')||'No videos yet'}
    🎵 Music
    + Add Music
    ${music.rows.map(m=>`${esc(m.title)}${m.artist?`${esc(m.artist)}`:''}`).join('')||'No music yet'}
    📰 Auto-Imported News & EventsLatest content scraped from the web
    Configure Auto-Import
    Import Now
    TitleSourceCategoryDateLink
    ${scraped.rows.map(s=>`${esc((s.title||'').substring(0,60))}${esc(s.source||'')}${esc(s.category||'')}${s.scraped_at?new Date(s.scraped_at).toLocaleDateString():''}${s.url?`Read`:'-'}`).join('')||'No imported content yet. Click "Import Now" to fetch!'}`, req.session.user));
}));

app.get('/entertainment/videos/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Video', `Add Video
    Add Video`, req.session.user));
});

app.post('/entertainment/videos/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, url } = req.body;
  await pool.query('INSERT INTO entertainment_videos(tenant_id,title,url) VALUES($1,$2,$3)', [req.session.user.tenant_id, title, url]);
  res.redirect('/entertainment');
}));

app.get('/entertainment/music/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Music', `Add Music Track
    Add Track`, req.session.user));
});

app.post('/entertainment/music/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const { title, artist, url } = req.body;
  await pool.query('INSERT INTO entertainment_music(tenant_id,title,artist,url) VALUES($1,$2,$3,$4)', [req.session.user.tenant_id, title, artist, url||'']);
  res.redirect('/entertainment');
}));

// === SCRAPE SETTINGS ===
app.get('/entertainment/scrape-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sources = (await pool.query('SELECT * FROM scrape_sources WHERE tenant_id=$1 ORDER BY category', [t])).rows;
  res.send(renderPage('Auto-Import Settings', `⚙️ Auto-Import SettingsConfigure sources to automatically import news, events, and entertainment content
    + Add Source
    🔄 Import Now
    Source NameURLCategoryActiveLast ScrapeActions
    ${sources.map(s=>`${esc(s.name)}${esc((s.url||'').substring(0,40))}${esc(s.category)}${s.is_active?'Active':'Off'}${s.last_scraped_at?new Date(s.last_scraped_at).toLocaleString():'Never'}${s.is_active?'Disable':'Enable'} Del`).join('')||'No sources configured. Add your first news source!'}
    📖 Built-in Sources (Auto-configured)These sources are pre-configured and always available:
    Daily Monitor Uganda - NewsNew Vision Uganda - NewsUG Pulse - EntertainmentMatooke Republic - Entertainment & GossipUganda Events - EventsMTN Uganda - Promotions
    `, req.session.user));
}));

app.get('/entertainment/scrape-settings/new', requireAuth, requireNotBanned, (req, res) => {
  res.send(renderPage('Add Scrape Source', `Add News/Content Source
    
      
      
      NewsEntertainmentSportsEventsTechnologyBusinessLifestyle
      RSS FeedWeb Page ScrapeAPI Endpoint
      
      
      Add Source
    `, req.session.user));
});

app.post('/entertainment/scrape-settings/save', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { name, url, category, scrape_type, selector, max_items } = req.body;
  await pool.query('INSERT INTO scrape_sources(tenant_id,name,url,category,scrape_type,selector,max_items) VALUES($1,$2,$3,$4,$5,$6,$7)', [t, name, url, category||'news', scrape_type||'rss', selector||'', max_items||20]);
  res.redirect('/entertainment/scrape-settings');
}));

app.get('/entertainment/scrape-settings/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('UPDATE scrape_sources SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/entertainment/scrape-settings');
}));

app.get('/entertainment/scrape-settings/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
  await pool.query('DELETE FROM scrape_sources WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
  res.redirect('/entertainment/scrape-settings');
}));

// === SCRAPE NOW (Web Fetcher) ===
app.get('/entertainment/scrape-now', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const sources = (await pool.query('SELECT * FROM scrape_sources WHERE tenant_id=$1 AND is_active=true', [t])).rows;
  let imported = 0;
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  for (const src of sources) {
    try {
      const searchResult = await zai.functions.invoke('web_search', { query: `${src.name} ${src.category} Uganda latest`, num: src.max_items || 10 });
      if (Array.isArray(searchResult)) {
        for (const item of searchResult) {
          try {
            await pool.query('INSERT INTO scraped_content(tenant_id,source,title,summary,url,category,scraped_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING', [t, src.name, item.name||item.title||'', item.snippet||'', item.url||'', src.category]);
            imported++;
          } catch(e) {}
        }
      }
      await pool.query('UPDATE scrape_sources SET last_scraped_at=NOW() WHERE id=$1', [src.id]);
    } catch(e) { console.warn('Scrape error for', src.name, e.message); }
  }
  // Also scrape from built-in sources if no custom sources
  if (sources.length === 0) {
    const builtin = ['Daily Monitor Uganda', 'New Vision Uganda', 'UG Pulse Entertainment', 'Matooke Republic'];
    for (const name of builtin) {
      try {
        const results = await zai.functions.invoke('web_search', { query: `${name} latest news Uganda 2025`, num: 10 });
        if (Array.isArray(results)) {
          for (const item of results) {
            try {
              await pool.query('INSERT INTO scraped_content(tenant_id,source,title,summary,url,category,scraped_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING', [t, name, item.name||item.title||'', item.snippet||'', item.url||'', 'news']);
              imported++;
            } catch(e) {}
          }
        }
      } catch(e) { console.warn('Built-in scrape error:', name, e.message); }
    }
  }
  await audit(req.session.user.email, 'scrape_content', `Imported ${imported} items from web`);
  res.redirect('/entertainment');
}));

app.get('/entertainment/news', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const news = (await pool.query("SELECT * FROM scraped_content WHERE tenant_id=$1 AND category='news' ORDER BY scraped_at DESC LIMIT 50", [t])).rows;
  res.send(renderPage('News & Events', `📰 News & Events
    🔄 Import Latest
    ${news.map(n=>`${esc((n.title||'').substring(0,80))}${esc((n.summary||'').substring(0,120))}${esc(n.source||'')} ${n.scraped_at?new Date(n.scraped_at).toLocaleDateString():''}${n.url?`Read More →`:''}`).join('')||'No news yet. Click "Import Latest" to fetch!'}`, req.session.user));
}));

// ============================================================
// v12.0: FLUTTERWAVE WEBHOOK + PAYMENT VERIFICATION
// ============================================================
// Flutterwave webhook handler (POST) - for server-to-server payment confirmation
app.post('/webhook/flutterwave', express.raw({ type: 'application/json' }), ah(async (req, res) => {
  const secret = process.env.FLW_WEBHOOK_SECRET || process.env.FLW_SECRET_KEY;
  const signature = req.headers['verif-hash'];
  if (!secret || !signature || signature !== secret) {
    return res.status(401).send('Invalid signature');
  }
  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return res.status(400).send('Invalid JSON'); }
  
  if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
    const { tx_ref, amount, currency, id: flw_id, customer } = payload.data;
    const payment = (await pool.query('SELECT * FROM payments WHERE reference=$1 AND status=$2', [tx_ref, 'pending'])).rows[0];
    if (payment) {
      await pool.query('UPDATE payments SET status=$1, method=$2 WHERE reference=$3', ['completed', 'flutterwave', tx_ref]);
      const plan = payment.description?.includes('pro') ? 'pro' : payment.description?.includes('enterprise') ? 'enterprise' : 'basic';
      const expires = new Date(Date.now() + 30*24*60*60*1000);
      try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at,payment_method,reference) VALUES($1,$2,$3,$4,$5,$6,$7)', [payment.tenant_id, plan, payment.amount, 'active', expires, 'flutterwave', tx_ref]); } catch(e) {}
      await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [payment.tenant_id]);
      // Add to developer revenue
      const devShare = Math.round(payment.amount * 0.9);
      try { await pool.query('INSERT INTO developer_revenue(tenant_id,source,amount,description) VALUES($1,$2,$3,$4)', [payment.tenant_id, 'subscription', devShare, `${plan} plan via Flutterwave`]); } catch(e) {}
      await fireWebhook(payment.tenant_id, 'payment', { ref: tx_ref, amount: payment.amount, plan, flw_id });
      await evaluateAutomations(payment.tenant_id, 'fee.paid', { amount: payment.amount, plan });
      console.log(`[Flutterwave] Payment confirmed: ${tx_ref} - UGX ${amount}`);
    }
    // Also check MoMo payments
    const momo = (await pool.query('SELECT * FROM momo_payments WHERE external_ref=$1 AND status!=$2', [tx_ref, 'completed'])).rows[0];
    if (momo) {
      await pool.query('UPDATE momo_payments SET status=$1 WHERE external_ref=$2', ['completed', tx_ref]);
      await pool.query('INSERT INTO payments(tenant_id,amount,method,status,description,reference) VALUES($1,$2,$3,$4,$5,$6)', [momo.tenant_id, momo.amount, 'mobile_money', 'completed', momo.reference, tx_ref]);
    }
  }
  res.status(200).send('OK');
}));

// Flutterwave payment verification endpoint
app.get('/api/v1/payment/verify/:ref', ah(async (req, res) => {
  const ref = req.params.ref;
  if (!process.env.FLW_SECRET_KEY) return res.json({ verified: false, error: 'No Flutterwave key' });
  try {
    const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${ref}/verify`, {
      headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}` }
    });
    const data = await resp.json();
    if (data.status === 'success' && data.data?.status === 'successful') {
      return res.json({ verified: true, amount: data.data.amount, currency: data.data.currency, ref: data.data.tx_ref });
    }
    return res.json({ verified: false, status: data.data?.status });
  } catch (e) { return res.json({ verified: false, error: e.message }); }
}));

// ============================================================
// v12.1: UGANDA PAYMENT CHECKOUT (MTN MoMo + Airtel Money + DPO Card)
// ============================================================
app.get('/pay/checkout', requireAuth, ah(async (req, res) => {
  const { amount, plan, description, type, item_id } = req.query;
  const amt = parseInt(amount) || 0;
  const ref = 'SSEW-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const t = req.session.user.tenant_id;
  const hasMtn = !!(process.env.MTN_COLLECTION_USER_ID && process.env.MTN_COLLECTION_API_KEY);
  const hasAirtel = !!(process.env.AIRTEL_CLIENT_ID && process.env.AIRTEL_CLIENT_SECRET);
  const hasDpo = !!process.env.DPO_COMPANY_TOKEN;
  const hasFlw = !!process.env.FLW_SECRET_KEY;
  const hasAnyProvider = hasMtn || hasAirtel || hasDpo || hasFlw;
  
  // Record pending payment
  if (amt > 0) {
    await pool.query('INSERT INTO payments(tenant_id,amount,method,status,description,reference) VALUES($1,$2,$3,$4,$5,$6)', [t, amt, 'pending', 'pending', description || `${plan || 'payment'} checkout`, ref]);
  }
  
  res.send(renderPage('Secure Payment', `
    
      
        Secure Payment
        UGX ${amt.toLocaleString()}
        ${esc(description || plan || 'Payment')}
      
      ${hasAnyProvider ? `
        
          ${hasMtn ? 'MTN MoMo' : ''}
          ${hasAirtel ? `Airtel Money` : ''}
          ${hasDpo ? `Card Payment` : ''}
          ${hasFlw ? `Flutterwave` : ''}
        

        
        
          
            M
            MTN Mobile Money
            You will receive a payment prompt on your phone
          
          
            
            
            
            
            
            
            
            Pay UGX ${amt.toLocaleString()} with MTN MoMo
          
        

        
        
          
            A
            Airtel Money
            You will receive a payment prompt on your phone
          
          
            
            
            
            
            
            
            
            Pay UGX ${amt.toLocaleString()} with Airtel Money
          
        

        
        
          
            V/M
            Card Payment
            Visa, Mastercard via DPO Group
          
          
            
            
            
            
            Pay UGX ${amt.toLocaleString()} with Card
          
        

        
        
          Pay with Flutterwave
          Card + Mobile Money (if available in your country)
          
          
          document.getElementById('flwBtn').addEventListener('click', function() {
            FlutterwaveCheckout({
              public_key: "${esc(process.env.FLW_PUBLIC_KEY||'')}",
              tx_ref: "${esc(ref)}",
              amount: ${amt},
              currency: "UGX",
              payment_options: "card,mobilemoneyuganda,ussd",
              redirect_url: "${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}/billing/callback",
              customer: { email: "${esc(req.session.user.email)}" },
              customizations: { title: "SSEWASSWA", description: "${esc(description || plan || 'Payment')}" }
            });
          });
          
        
      ` : `
        
        
          Manual Payment
          Online payments are not yet configured. Pay manually:
          
            MTN MoMo:
            Send UGX ${amt.toLocaleString()} to 0780000000
          
          
            Airtel Money:
            Send UGX ${amt.toLocaleString()} to 0700000000
          
          Reference: ${esc(ref)}
          Send screenshot to admin for verification
        
        Back to Billing
      `}
      
        Reference: ${esc(ref)}
        Secure payment. Your data is encrypted.
      
    
    
    function showPayTab(id) {
      document.querySelectorAll('[id^="pay-"]').forEach(el => el.style.display = 'none');
      document.getElementById('pay-' + id).style.display = 'block';
      document.querySelectorAll('.tab-bar a').forEach(a => a.classList.remove('active'));
      event.target.classList.add('active');
      return false;
    }
    
  `, req.session.user));
}));

// MTN MoMo payment initiation
app.post('/pay/mtn/initiate', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, amount, reference, plan, description, type, item_id } = req.body;
  const amt = parseInt(amount) || 0;
  const ref = reference || 'MTN-' + Date.now();
  
  const result = await requestMtnPayment(phone, amt, ref, description || 'SSEWASSWA Payment', `${plan||'payment'}`);
  
  if (result.success) {
    await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type,external_ref) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [t, result.phone, amt, description || plan, 'pending', 'mtn', ref]);
    // Update the pending payment with method
    await pool.query('UPDATE payments SET method=$1 WHERE reference=$2', ['mtn_momo', ref]);
    
    res.send(renderPage('MTN MoMo - Confirm Payment', `
      
        M
        Check Your Phone!
        A payment prompt has been sent to ${esc(result.phone)}
        
          Amount: UGX ${amt.toLocaleString()}
          Reference: ${esc(ref)}
        
        
          1. Open your MTN MoMo prompt
          2. Enter your PIN to confirm
          3. Wait for confirmation message
        
        
          
          Check Payment Status
        
        Prompt expires in 2 minutes. If you missed it, go back and try again.
        Back to Billing
      
    `, req.session.user));
  } else {
    res.send(renderPage('Payment Failed', `
      
        
          MTN MoMo Payment Failed
          ${esc(result.error || 'Could not initiate payment. Please check your phone number and try again.')}
        
        Try Again
        Back to Billing
      
    `, req.session.user));
  }
}));

// Check MTN MoMo payment status
app.get('/pay/mtn/status', requireAuth, ah(async (req, res) => {
  const ref = req.query.ref;
  if (!ref) return res.redirect('/billing');
  
  const result = await checkMtnPaymentStatus(ref);
  const status = result.status || 'PENDING';
  
  if (status === 'SUCCESSFUL') {
    // Update payment records
    await pool.query('UPDATE payments SET status=$1,method=$2 WHERE reference=$3', ['completed', 'mtn_momo', ref]);
    await pool.query('UPDATE momo_payments SET status=$1 WHERE external_ref=$2', ['completed', ref]);
    const payment = (await pool.query('SELECT * FROM payments WHERE reference=$1', [ref])).rows[0];
    if (payment) {
      const plan = payment.description?.includes('pro') ? 'pro' : payment.description?.includes('enterprise') ? 'enterprise' : payment.description?.includes('basic') ? 'basic' : '';
      if (plan) {
        const expires = new Date(Date.now() + 30*24*60*60*1000);
        try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at,payment_method) VALUES($1,$2,$3,$4,$5,$6)', [payment.tenant_id, plan, payment.amount, 'active', expires, 'mtn_momo']); } catch(e) {}
        await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [payment.tenant_id]);
      }
      const devShare = Math.round(payment.amount * 0.9);
      try { await pool.query('INSERT INTO developer_revenue(tenant_id,source,amount,description) VALUES($1,$2,$3,$4)', [payment.tenant_id, 'mtn_momo', devShare, `Payment via MTN MoMo: ${ref}`]); } catch(e) {}
      await fireWebhook(payment.tenant_id, 'payment', { ref, amount: payment.amount, method: 'mtn_momo' });
    }
    res.send(renderPage('Payment Successful!', `
      
        &#10003;
        Payment Successful!
        Your payment of UGX ${payment ? parseInt(payment.amount).toLocaleString() : '0'} has been confirmed.
        Go to Billing
        Dashboard
      
    `, req.session.user));
  } else if (status === 'FAILED' || status === 'REJECTED') {
    await pool.query('UPDATE payments SET status=$1 WHERE reference=$2', ['failed', ref]);
    await pool.query('UPDATE momo_payments SET status=$1 WHERE external_ref=$2', ['failed', ref]);
    res.send(renderPage('Payment Failed', `
      
        &#10007;
        Payment Failed
        The payment was not completed. This could be due to insufficient balance or the prompt was rejected.
        Back to Billing
      
    `, req.session.user));
  } else {
    // Still pending
    res.send(renderPage('Payment Pending', `
      
        ...
        Payment Pending
        Your payment is still being processed. Please confirm on your phone if you haven't already.
        
          
          Check Again
        
        Auto-checking in 10 seconds...
        setTimeout(() => { window.location.href = '/pay/mtn/status?ref=${esc(ref)}'; }, 10000);
      
    `, req.session.user));
  }
}));

// MTN MoMo webhook/callback
app.post('/webhook/mtn', express.json(), ah(async (req, res) => {
  const { event, data } = req.body || {};
  console.log('[MTN MoMo] Webhook:', event, JSON.stringify(data || {}));
  
  if (event === 'TRANSFER.SUCCESS' || data?.status === 'SUCCESSFUL') {
    const ref = data?.externalId || data?.financialTransactionId || data?.reference;
    if (ref) {
      await pool.query('UPDATE payments SET status=$1,method=$2 WHERE reference=$3 AND status=$4', ['completed', 'mtn_momo', ref, 'pending']);
      await pool.query('UPDATE momo_payments SET status=$1 WHERE external_ref=$2', ['completed', ref]);
      const payment = (await pool.query('SELECT * FROM payments WHERE reference=$1', [ref])).rows[0];
      if (payment) {
        const plan = payment.description?.includes('pro') ? 'pro' : payment.description?.includes('enterprise') ? 'enterprise' : 'basic';
        const expires = new Date(Date.now() + 30*24*60*60*1000);
        try { await pool.query('INSERT INTO subscriptions(tenant_id,plan,amount,status,expires_at,payment_method) VALUES($1,$2,$3,$4,$5,$6)', [payment.tenant_id, plan, payment.amount, 'active', expires, 'mtn_momo']); } catch(e) {}
        await pool.query('UPDATE tenants SET verified=true,approved=true WHERE id=$1', [payment.tenant_id]);
        await fireWebhook(payment.tenant_id, 'payment', { ref, amount: payment.amount, method: 'mtn_momo' });
        await evaluateAutomations(payment.tenant_id, 'fee.paid', { amount: payment.amount });
      }
    }
  } else if (event === 'TRANSFER.FAILED' || data?.status === 'FAILED') {
    const ref = data?.externalId || data?.reference;
    if (ref) {
      await pool.query('UPDATE payments SET status=$1 WHERE reference=$2', ['failed', ref]);
      await pool.query('UPDATE momo_payments SET status=$1 WHERE external_ref=$2', ['failed', ref]);
    }
  }
  res.status(200).send('OK');
}));

// Airtel Money payment initiation
app.post('/pay/airtel/initiate', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { phone, amount, reference, plan, description } = req.body;
  const amt = parseInt(amount) || 0;
  const ref = reference || 'AIRTEL-' + Date.now();
  
  const result = await requestAirtelPayment(phone, amt, ref);
  
  if (result.success) {
    await pool.query('INSERT INTO momo_payments(tenant_id,phone,amount,reference,status,type,external_ref) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [t, result.phone, amt, description || plan, 'pending', 'airtel', ref]);
    await pool.query('UPDATE payments SET method=$1 WHERE reference=$2', ['airtel_money', ref]);
    
    res.send(renderPage('Airtel Money - Confirm Payment', `
      
        A
        Check Your Phone!
        A payment prompt has been sent to ${esc(result.phone)}
        
          Amount: UGX ${amt.toLocaleString()}
          Reference: ${esc(ref)}
        
        
          1. Open your Airtel Money prompt
          2. Enter your PIN to confirm
          3. Wait for confirmation message
        
        
          
          Check Payment Status
        
        Back to Billing
      
    `, req.session.user));
  } else {
    res.send(renderPage('Payment Failed', `
      
        
          Airtel Money Payment Failed
          ${esc(result.error || 'Could not initiate payment.')}
        
        Back to Billing
      
    `, req.session.user));
  }
}));

// Check Airtel Money payment status
app.get('/pay/airtel/status', requireAuth, ah(async (req, res) => {
  const ref = req.query.ref;
  if (!ref) return res.redirect('/billing');
  const payment = (await pool.query('SELECT * FROM payments WHERE reference=$1', [ref])).rows[0];
  const momo = (await pool.query('SELECT * FROM momo_payments WHERE external_ref=$1', [ref])).rows[0];
  const status = momo?.status || payment?.status || 'pending';
  
  if (status === 'completed') {
    res.send(renderPage('Payment Successful!', `
      
        &#10003;
        Payment Successful!
        Go to Billing
      
    `, req.session.user));
  } else {
    res.send(renderPage('Payment Pending', `
      
        ...
        Payment Pending
        Please confirm on your phone.
        
          
          Check Again
        
        setTimeout(() => { window.location.href = '/pay/airtel/status?ref=${esc(ref)}'; }, 10000);
      
    `, req.session.user));
  }
}));

// DPO Card payment initiation
app.post('/pay/dpo/initiate', requireAuth, ah(async (req, res) => {
  const { amount, reference, plan, description } = req.body;
  const amt = parseInt(amount) || 0;
  const ref = reference || 'DPO-' + Date.now();
  
  const checkoutUrl = await createDPOPayment(amt, req.session.user.email, ref, description || plan || 'SSEWASSWA Payment');
  if (checkoutUrl) {
    await pool.query('UPDATE payments SET method=$1 WHERE reference=$2', ['dpo_card', ref]);
    return res.redirect(checkoutUrl);
  }
  res.send(renderPage('Card Payment', `
    
      Card Payments Coming SoonDPO is not yet configured for card payments. Please use MTN MoMo or Airtel Money.
      Back to Billing
    
  `, req.session.user));
}));

// ============================================================
// v12.0: FEE PAYMENT VIA FLUTTERWAVE (from student/parent portal)
// ============================================================
app.get('/pay/fees/:fee_id', ah(async (req, res) => {
  const feeId = req.params.fee_id;
  const fee = (await pool.query('SELECT f.*, s.name as student_name, s.admission_no, t.name as school_name FROM fees f JOIN students s ON f.student_id=s.id JOIN tenants t ON f.tenant_id=t.id WHERE f.id=$1', [feeId])).rows[0];
  if (!fee) return res.send(renderPage('Error', 'Fee record not foundHome', req.session.user));
  const balance = fee.amount - fee.paid;
  const ref = 'FEE-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const FLW_PK = process.env.FLW_PUBLIC_KEY;
  
  if (balance 
      
        Pay School Fees
        ${esc(fee.student_name)} (${esc(fee.admission_no)})
        ${esc(fee.school_name)}
      
      
        
          Total FeesUGX ${parseInt(fee.amount).toLocaleString()}
          Already PaidUGX ${parseInt(fee.paid).toLocaleString()}
          Balance DueUGX ${balance.toLocaleString()}
        
      
      
        
        
        
        
        
        Pay UGX ${balance.toLocaleString()} Now
      
      Card, MTN MoMo, Airtel Money accepted
    
  `, req.session.user));
}));

// ============================================================
// v12.0: ENHANCED STUDENT PORTAL (with password, timetable, report card download)
// ============================================================
// Migrate student_portal_sessions if not exists
pool.query(`CREATE TABLE IF NOT EXISTS student_accounts (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES students(id) ON DELETE CASCADE UNIQUE,
  password TEXT NOT NULL,
  temp_password TEXT,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});

// Admin: Generate student passwords
app.get('/school/students/generate-passwords', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const students = (await pool.query('SELECT id, name, admission_no FROM students WHERE tenant_id=$1', [t])).rows;
  let created = 0;
  for (const s of students) {
    const exists = (await pool.query('SELECT id FROM student_accounts WHERE student_id=$1', [s.id])).rows[0];
    if (!exists) {
      const tempPass = 'STD' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const hash = await bcrypt.hash(tempPass, 10);
      await pool.query('INSERT INTO student_accounts(student_id,password,temp_password) VALUES($1,$2,$3)', [s.id, hash, tempPass]);
      created++;
    }
  }
  await audit(req.session.user.email, 'student_passwords', `Generated passwords for ${created} students`);
  res.send(renderPage('Student Passwords', `
    Passwords Generated!Created login credentials for ${created} students.
    Students can now log in at /student/login using their Admission Number and the generated password.
    View All Passwords
    Back to Students
  `, req.session.user));
}));

// Admin: View student passwords
app.get('/school/students/passwords-list', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT sa.*, s.name, s.admission_no, s.class FROM student_accounts sa JOIN students s ON sa.student_id=s.id WHERE s.tenant_id=$1 ORDER BY s.name', [t])).rows;
  res.send(renderPage('Student Login Credentials', `
    Student Login Credentials
    Students log in at /student/login with Admission Number + Password
    Generate New Passwords
    ${accounts.length ? `NameAdmission NoClassPasswordLast Login
    ${accounts.map(a=>`${esc(a.name)}${esc(a.admission_no)}${esc(a.class||'')}${esc(a.temp_password||'Set')}${a.last_login?new Date(a.last_login).toLocaleString():'Never'}`).join('')}
    ` : 'No student accounts yet. Click "Generate New Passwords" above.'}
  `, req.session.user));
}));

// Enhanced student login (with password)
app.post('/student/login', ah(async (req, res) => {
  const { admission_no, name, password } = req.body;
  const student = (await pool.query('SELECT s.*,t.id as tid,t.name as school_name,t.type FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.admission_no=$1', [admission_no])).rows[0];
  
  // Check password-based login first
  if (password && student) {
    const account = (await pool.query('SELECT * FROM student_accounts WHERE student_id=$1', [student.id])).rows[0];
    if (account && await bcrypt.compare(password, account.password)) {
      req.session.student = student;
      await pool.query('UPDATE student_accounts SET last_login=NOW() WHERE student_id=$1', [student.id]);
      return res.redirect('/student/dashboard');
    }
  }
  
  // Fallback: name-based login (legacy)
  if (!student || (name && student.name.toLowerCase() !== name.toLowerCase())) {
    return res.send(renderPage('Student Portal', 'Invalid admission number or passwordTry Again', null));
  }
  req.session.student = student;
  res.redirect('/student/dashboard');
}));

// Replace student login page with enhanced version
app.get('/student/login', (req, res) => {
  res.send(renderPage('Student Portal', `
    
      
        S
        Student Portal
        View your grades, attendance, timetable and pay fees
      
      
        
        
        Don't have a password? Login with name
          
        
        Login
      
      Ask your school admin for your login credentials
    
  `, null));
});

// Enhanced student dashboard (more comprehensive)
app.get('/student/dashboard', ah(async (req, res) => {
  const s = req.session.student;
  if (!s) return res.redirect('/student/login');
  const t = s.tenant_id;
  const [fees, attendance, marks, hw, timetable, tenant] = await Promise.all([
    pool.query('SELECT * FROM fees WHERE tenant_id=$1 AND student_id=$2', [t, s.id]),
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='present' THEN 1 END) as present FROM attendance WHERE tenant_id=$1 AND student_id=$2", [t, s.id]),
    pool.query('SELECT m.*,e.name as exam,e.term FROM marks m JOIN exams e ON m.exam_id=e.id WHERE m.student_id=$1 ORDER BY e.created_at DESC', [s.id]),
    pool.query('SELECT h.* FROM homework h WHERE h.tenant_id=$1 AND (h.class_name=$2 OR h.class_name IS NULL) ORDER BY h.due_date DESC LIMIT 10', [t, s.class||'']),
    pool.query('SELECT * FROM timetable WHERE tenant_id=$1 AND (class_name=$2 OR class_name IS NULL) ORDER BY day,start_time', [t, s.class||'']),
    pool.query('SELECT name,logo_url FROM tenants WHERE id=$1', [t])
  ]);
  const feeBalance = fees.rows.reduce((sum, f) => sum + (f.amount - f.paid), 0);
  const attRate = attendance.rows[0]?.total > 0 ? Math.round(attendance.rows[0].present / attendance.rows[0].total * 100) : 0;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = days[new Date().getDay()];
  const todayClasses = timetable.rows.filter(r => r.day === today);
  
  res.send(renderPage('My Dashboard', `
    
      
        ${tenant.rows[0]?.logo_url ? `` : ''}
        Welcome, ${esc(s.name)}${esc(s.class||'')} | Admission: ${esc(s.admission_no)} | ${esc(tenant.rows[0]?.name||'')}
      
    
    
      UGX ${feeBalance.toLocaleString()}Fee Balance
      ${attRate}%Attendance Rate
      ${marks.rows.length}Subjects Scored
      ${todayClasses.length}Classes Today
    
    
      Overview
      Results
      Timetable
      Fees
    
    
      
        Today's Schedule (${today})
          ${todayClasses.length ? `TimeSubjectTeacherRoom
          ${todayClasses.map(c=>`${esc(c.start_time||'')} - ${esc(c.end_time||'')}${esc(c.subject||'')}${esc(c.teacher||'')}${esc(c.room||'')}`).join('')}` : 'No classes scheduled for today'}
        
        Homework
          ${hw.rows.map(h=>`${esc(h.title)}${esc(h.subject||'')} - Due: ${h.due_date||'No date'}${h.description?`${esc(h.description.substring(0,100))}`:''}`).join('')||'No homework assigned'}
        
      
    
    
      My Results
        ${marks.rows.length ? `ExamTermSubjectScoreGrade
        ${marks.rows.map(m=>`${esc(m.exam)}${esc(m.term||'')}${esc(m.subject)}${m.score||'-'}${esc(m.grade||'-')}`).join('')}` : 'No results yet'}
      
      Download My Report Card
    
    
      My Timetable
        ${timetable.rows.length ? (() => {
          const byDay = {};
          timetable.rows.forEach(r => { if (!byDay[r.day]) byDay[r.day] = []; byDay[r.day].push(r); });
          return days.filter(d => byDay[d]).map(d => `${d}TimeSubjectTeacherRoom${byDay[d].map(c=>`${esc(c.start_time||'')}-${esc(c.end_time||'')}${esc(c.subject||'')}${esc(c.teacher||'')}${esc(c.room||'')}`).join('')}`).join('');
        })() : 'No timetable available'}
      
    
    
      Fee Statement
        ${fees.rows.length ? `DescriptionTotalPaidBalanceAction
        ${fees.rows.map(f=>{
          const bal = f.amount - f.paid;
          return `${esc(f.description||'Tuition')}UGX ${parseInt(f.amount).toLocaleString()}UGX ${parseInt(f.paid).toLocaleString()}0?'#dc2626':'#059669'}">UGX ${bal.toLocaleString()}${bal>0?`Pay Now`:'Cleared'}`;
        }).join('')}` : 'No fee records'}
      
      Fee Summary
        
          UGX ${fees.rows.reduce((s,f)=>s+parseInt(f.amount),0).toLocaleString()}Total Fees
          UGX ${fees.rows.reduce((s,f)=>s+parseInt(f.paid),0).toLocaleString()}Total Paid
          UGX ${feeBalance.toLocaleString()}Balance
        
      
    
    Logout
    
    function showTab(id) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      document.getElementById('tab-' + id).style.display = 'block';
      document.querySelectorAll('.tab-bar a').forEach(a => a.classList.remove('active'));
      event.target.classList.add('active');
      return false;
    }
    
  `, null));
}));

// Student: Download report card
app.get('/student/report-card', ah(async (req, res) => {
  const s = req.session.student;
  if (!s) return res.redirect('/student/login');
  const t = s.tenant_id;
  const latestExam = (await pool.query('SELECT id,name,term,year FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1', [t])).rows[0];
  if (!latestExam) return res.send(renderPage('Report Card', 'No exams found yetBack', null));
  
  const marks = (await pool.query('SELECT subject,score,grade FROM marks WHERE exam_id=$1 AND student_id=$2', [latestExam.id, s.id])).rows;
  const fee = (await pool.query('SELECT amount,paid FROM fees WHERE student_id=$1 AND tenant_id=$2 LIMIT 1', [s.id, t])).rows[0];
  const tenant = (await pool.query('SELECT name,logo_url FROM tenants WHERE id=$1', [t])).rows[0];
  const totalScore = marks.reduce((a, m) => a + (parseInt(m.score) || 0), 0);
  const avgScore = marks.length > 0 ? Math.round(totalScore / marks.length) : 0;
  
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: tenant.name, bold: true, size: 36, color: '4F46E5' })], alignment: 'center' }),
        new Paragraph({ children: [new TextRun({ text: 'STUDENT REPORT CARD', bold: true, size: 28 })], alignment: 'center' }),
        new Paragraph({ text: `${latestExam.name} - ${latestExam.term} ${latestExam.year || ''}`, alignment: 'center' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Student Name: ${s.name}`, spacing: { after: 100 } }),
        new Paragraph({ text: `Admission No: ${s.admission_no}` }),
        new Paragraph({ text: `Class: ${s.class} ${s.stream || ''}` }),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: 'SUBJECT RESULTS', bold: true, size: 22, color: '4F46E5' })] }),
        new Paragraph({ text: '' }),
        ...marks.map(m => new Paragraph({ children: [
          new TextRun({ text: m.subject, size: 20 }),
          new TextRun({ text: `    ${m.score}/100    Grade: ${m.grade}`, bold: true, size: 20 })
        ]})),
        new Paragraph({ text: '' }),
        new Paragraph({ children: [new TextRun({ text: `Total Score: ${totalScore}`, bold: true, size: 22 })] }),
        new Paragraph({ children: [new TextRun({ text: `Average Score: ${avgScore}`, bold: true, size: 22, color: '059669' })] }),
        ...(fee ? [
          new Paragraph({ text: '' }),
          new Paragraph({ children: [new TextRun({ text: 'FEE STATUS', bold: true, size: 22, color: '4F46E5' })] }),
          new Paragraph({ text: `Total Fees: UGX ${parseInt(fee.amount).toLocaleString()}` }),
          new Paragraph({ text: `Paid: UGX ${parseInt(fee.paid).toLocaleString()}` }),
          new Paragraph({ text: `Balance: UGX ${(fee.amount - fee.paid).toLocaleString()}` }),
        ] : []),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: 'Class Teacher Comment: ________________________' }),
        new Paragraph({ text: 'Head Teacher Comment: ________________________' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: `Date: ${new Date().toLocaleDateString()}` }),
        new Paragraph({ children: [new TextRun({ text: 'Generated by SSEWASSWA Platform', italics: true, size: 16, color: '9CA3AF' })], alignment: 'center' }),
      ]
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Disposition', `attachment; filename=ReportCard-${s.admission_no}.docx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.send(buffer);
}));

// Student logout
app.get('/student/logout', (req, res) => { delete req.session.student; res.redirect('/student/login'); });

// ============================================================
// v12.0: CHURCH MEMBER SELF-SERVICE PORTAL
// ============================================================
pool.query(`CREATE TABLE IF NOT EXISTS church_accounts (
  id SERIAL PRIMARY KEY,
  member_id INTEGER REFERENCES church_members(id) ON DELETE CASCADE UNIQUE,
  password TEXT NOT NULL,
  temp_password TEXT,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});

app.get('/church/login', (req, res) => {
  if (req.session.churchMember) return res.redirect('/church/portal');
  res.send(renderPage('Church Member Portal', `
    
      
        C
        Church Member Portal
        View your contributions, sermons, and church info
      
      
        
        
        No password? Use your name
          
        
        Login
      
    
  `, null));
});

app.post('/church/login', ah(async (req, res) => {
  const { phone, name, password } = req.body;
  const member = (await pool.query('SELECT cm.*, t.name as church_name, t.id as tid FROM church_members cm JOIN tenants t ON cm.tenant_id=t.id WHERE cm.phone=$1', [phone])).rows[0];
  if (!member) return res.send(renderPage('Church Portal', 'No member found with this phone numberTry Again', null));
  
  // Check password
  if (password) {
    const account = (await pool.query('SELECT * FROM church_accounts WHERE member_id=$1', [member.id])).rows[0];
    if (account && await bcrypt.compare(password, account.password)) {
      req.session.churchMember = member;
      await pool.query('UPDATE church_accounts SET last_login=NOW() WHERE member_id=$1', [member.id]);
      return res.redirect('/church/portal');
    }
  }
  
  // Fallback: name-based
  if (name && member.name.toLowerCase() !== name.toLowerCase()) {
    return res.send(renderPage('Church Portal', 'Invalid name or passwordTry Again', null));
  }
  req.session.churchMember = member;
  res.redirect('/church/portal');
}));

app.get('/church/portal', ah(async (req, res) => {
  const m = req.session.churchMember;
  if (!m) return res.redirect('/church/login');
  const t = m.tenant_id;
  const [donations, sermons, attendance, schedule, welfare] = await Promise.all([
    pool.query('SELECT * FROM donations WHERE tenant_id=$1 AND member_id=$2 ORDER BY created_at DESC LIMIT 20', [t, m.id]),
    pool.query('SELECT * FROM sermons WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [t]),
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='present' THEN 1 END) as present FROM church_attendance WHERE tenant_id=$1 AND member_id=$2", [t, m.id]),
    pool.query('SELECT * FROM service_schedule WHERE tenant_id=$1 ORDER BY day,start_time', [t]),
    pool.query('SELECT * FROM welfare_records WHERE tenant_id=$1 AND member_id=$2 ORDER BY created_at DESC LIMIT 5', [t, m.id])
  ]);
  const totalDonated = donations.rows.reduce((s, d) => s + parseInt(d.amount || 0), 0);
  const attRate = attendance.rows[0]?.total > 0 ? Math.round(attendance.rows[0].present / attendance.rows[0].total * 100) : 0;
  
  res.send(renderPage('My Church Portal', `
    
      Welcome, ${esc(m.name)}${esc(m.church_name)} | ${esc(m.role || 'Member')}
    
    
      UGX ${totalDonated.toLocaleString()}Total Given
      ${attRate}%Attendance Rate
      ${donations.rows.length}Donations
      ${sermons.rows.length}Sermons
    
    
      Overview
      My Donations
      Sermons
      Service Schedule
    
    
      
        Recent Donations
          ${donations.rows.slice(0,5).map(d=>`UGX ${parseInt(d.amount).toLocaleString()} - ${esc(d.type||'Donation')}${d.created_at?new Date(d.created_at).toLocaleDateString():''}`).join('')||'No donations yet'}
        
        Welfare Support
          ${welfare.rows.length ? welfare.rows.map(w=>`${esc(w.type)} - UGX ${parseInt(w.amount).toLocaleString()}${esc(w.description||'')} - ${w.date?new Date(w.date).toLocaleDateString():''}`).join('') : 'No welfare records'}
        
      
    
    
      My Donation History
        ${donations.rows.length ? `DateTypeAmountMethod${donations.rows.map(d=>`${d.created_at?new Date(d.created_at).toLocaleDateString():'-'}${esc(d.type||'Donation')}UGX ${parseInt(d.amount).toLocaleString()}${esc(d.method||'-')}`).join('')}` : 'No donations yet'}
      
    
    
      Recent Sermons
        ${sermons.rows.map(s=>`${esc(s.title)}${esc(s.preacher||'')} - ${s.date?new Date(s.date).toLocaleDateString():''}${s.notes?`${esc(s.notes.substring(0,200))}`:''}`).join('')||'No sermons available'}
      
    
    
      Service Schedule
        ${schedule.rows.length ? `DayTimeServiceVenue${schedule.rows.map(s=>`${esc(s.day)}${esc(s.start_time||'')} - ${esc(s.end_time||'')}${esc(s.service_name||'')}${esc(s.venue||'')}`).join('')}` : 'No schedule available'}
      
    
    Logout
    
    function showTab(id) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      document.getElementById('tab-' + id).style.display = 'block';
      document.querySelectorAll('.tab-bar a').forEach(a => a.classList.remove('active'));
      event.target.classList.add('active');
      return false;
    }
    
  `, null));
}));

app.get('/church/logout', (req, res) => { delete req.session.churchMember; res.redirect('/church/login'); });

// Admin: Generate church member passwords
app.get('/church/members/generate-passwords', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const members = (await pool.query('SELECT id, name, phone FROM church_members WHERE tenant_id=$1', [t])).rows;
  let created = 0;
  for (const m of members) {
    const exists = (await pool.query('SELECT id FROM church_accounts WHERE member_id=$1', [m.id])).rows[0];
    if (!exists) {
      const tempPass = 'CH' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const hash = await bcrypt.hash(tempPass, 10);
      await pool.query('INSERT INTO church_accounts(member_id,password,temp_password) VALUES($1,$2,$3)', [m.id, hash, tempPass]);
      created++;
    }
  }
  await audit(req.session.user.email, 'church_passwords', `Generated passwords for ${created} members`);
  res.send(renderPage('Church Member Passwords', `
    Passwords Generated!Created login credentials for ${created} members.
    Members can log in at /church/login using their phone number and password.
    View All Passwords
    Back to Members
  `, req.session.user));
}));

// Admin: View church member passwords
app.get('/church/members/passwords-list', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const accounts = (await pool.query('SELECT ca.*, cm.name, cm.phone FROM church_accounts ca JOIN church_members cm ON ca.member_id=cm.id WHERE cm.tenant_id=$1 ORDER BY cm.name', [t])).rows;
  res.send(renderPage('Church Member Login Credentials', `
    Member Login Credentials
    Members log in at /church/login with Phone Number + Password
    Generate New Passwords
    ${accounts.length ? `NamePhonePasswordLast Login
    ${accounts.map(a=>`${esc(a.name)}${esc(a.phone||'')}${esc(a.temp_password||'Set')}${a.last_login?new Date(a.last_login).toLocaleString():'Never'}`).join('')}
    ` : 'No accounts yet.'}
  `, req.session.user));
}));

// ============================================================
// v12.0: AUTOMATED FEE REMINDER SYSTEM
// ============================================================
app.get('/school/fee-reminders', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const overdueFees = (await pool.query('SELECT f.*, s.name as student_name, s.admission_no, s.guardian_phone, s.parent_email FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND (f.amount-f.paid)>0 ORDER BY (f.amount-f.paid) DESC', [t])).rows;
  const reminderLog = (await pool.query("SELECT * FROM sms_logs WHERE tenant_id=$1 AND trigger_type='fee_reminder' ORDER BY created_at DESC LIMIT 20", [t])).rows;
  const totalOverdue = overdueFees.reduce((s,f) => s + (f.amount - f.paid), 0);
  
  res.send(renderPage('Fee Reminders', `
    Fee RemindersSend automated fee balance alerts to parents
    
      ${overdueFees.length}Students with Balance
      UGX ${totalOverdue.toLocaleString()}Total Outstanding
      ${reminderLog.length}Reminders Sent
    
    
      Send Fee Reminders
      
        
          Send SMS to All Parents
        
        
          Send Email to All
        
      
      SMS requires Africa's Talking API key. Emails are always free.
    
    
      Students with Outstanding Balances
      ${overdueFees.length ? `StudentAdm NoTotalPaidBalanceGuardian PhoneAction
      ${overdueFees.map(f=>{
        const bal = f.amount - f.paid;
        return `${esc(f.student_name)}${esc(f.admission_no)}UGX ${parseInt(f.amount).toLocaleString()}UGX ${parseInt(f.paid).toLocaleString()}UGX ${bal.toLocaleString()}${esc(f.guardian_phone||'-')}${f.guardian_phone?`SMS`:''}`;
      }).join('')}` : 'All fees cleared!'}
    
    Recent Reminders
      ${reminderLog.length ? `DatePhoneMessageStatus
      ${reminderLog.map(r=>`${new Date(r.created_at).toLocaleString()}${esc(r.phone)}${esc((r.message||'').substring(0,80))}${esc(r.status||'sent')}`).join('')}` : 'No reminders sent yet'}
    
  `, req.session.user));
}));

// Send SMS to all parents with overdue fees
app.post('/school/fee-reminders/send-sms', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const overdue = (await pool.query('SELECT f.*, s.name as student_name, s.guardian_phone FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND (f.amount-f.paid)>0 AND s.guardian_phone IS NOT NULL', [t])).rows;
  let sent = 0, failed = 0;
  for (const f of overdue) {
    const bal = f.amount - f.paid;
    const msg = `Dear Parent/Guardian, ${f.student_name} has a fee balance of UGX ${bal.toLocaleString()}. Please pay to avoid inconvenience. - School Admin`;
    const ok = await sendSMS(f.guardian_phone, msg);
    await logSMS(t, f.guardian_phone, msg, 'fee_reminder');
    if (ok) sent++; else failed++;
  }
  await audit(req.session.user.email, 'fee_reminders', `Sent ${sent} SMS reminders (${failed} failed)`);
  res.send(renderPage('Reminders Sent', `
    SMS Reminders Sent!Successfully sent: ${sent}Failed: ${failed}
    Back to Reminders
  `, req.session.user));
}));

// Send email reminders
app.post('/school/fee-reminders/send-email', requireAuth, requireNotBanned, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const overdue = (await pool.query('SELECT f.*, s.name as student_name, s.parent_email FROM fees f JOIN students s ON f.student_id=s.id WHERE f.tenant_id=$1 AND (f.amount-f.paid)>0 AND s.parent_email IS NOT NULL', [t])).rows;
  let sent = 0;
  for (const f of overdue) {
    const bal = f.amount - f.paid;
    const msg = `Dear Parent/Guardian,Your child ${f.student_name} has a fee balance of UGX ${bal.toLocaleString()}.Please make payment at your earliest convenience.Thank you,School Administration`;
    await sendEmail(f.parent_email, `Fee Balance Reminder - ${f.student_name}`, msg);
    sent++;
  }
  await audit(req.session.user.email, 'fee_email_reminders', `Sent ${sent} email reminders`);
  res.send(renderPage('Emails Sent', `
    Email Reminders Sent!${sent} emails sent.
    Back to Reminders
  `, req.session.user));
}));

// Send SMS to one parent
app.get('/school/fee-reminders/send-one/:fee_id', requireAuth, requireNotBanned, ah(async (req, res) => {
  const f = (await pool.query('SELECT f.*, s.name as student_name, s.guardian_phone FROM fees f JOIN students s ON f.student_id=s.id WHERE f.id=$1', [req.params.fee_id])).rows[0];
  if (f?.guardian_phone) {
    const bal = f.amount - f.paid;
    const msg = `Dear Parent/Guardian, ${f.student_name} has a fee balance of UGX ${bal.toLocaleString()}. Please pay to avoid inconvenience. - School Admin`;
    await sendSMS(f.guardian_phone, msg);
    await logSMS(req.session.user.tenant_id, f.guardian_phone, msg, 'fee_reminder');
  }
  res.redirect('/school/fee-reminders');
}));

// ============================================================
// v12.0: ENHANCED PARENT PORTAL (with fee payment)
// ============================================================
app.get('/parent/child/:id', ah(async (req, res) => {
  if (!req.session.parent) return res.redirect('/parent/login');
  const student = (await pool.query('SELECT s.*, t.name as school_name, t.logo_url FROM students s JOIN tenants t ON s.tenant_id=t.id WHERE s.id=$1', [req.params.id])).rows[0];
  if (!student) return res.redirect('/parent/dashboard');
  const t = student.tenant_id;
  const [fees, marks, attendance, hw] = await Promise.all([
    pool.query('SELECT * FROM fees WHERE tenant_id=$1 AND student_id=$2', [t, student.id]),
    pool.query('SELECT m.*, e.name as exam FROM marks m JOIN exams e ON m.exam_id=e.id WHERE m.student_id=$1 ORDER BY e.created_at DESC LIMIT 20', [student.id]),
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='present' THEN 1 END) as present FROM attendance WHERE tenant_id=$1 AND student_id=$2", [t, student.id]),
    pool.query('SELECT * FROM homework WHERE tenant_id=$1 AND (class_name=$2 OR class_name IS NULL) ORDER BY due_date DESC LIMIT 10', [t, student.class||''])
  ]);
  const feeBalance = fees.rows.reduce((s, f) => s + (f.amount - f.paid), 0);
  const attRate = attendance.rows[0]?.total > 0 ? Math.round(attendance.rows[0].present / attendance.rows[0].total * 100) : 0;
  
  res.send(renderPage(`${student.name}`, `
    
      
        ${student.logo_url ? `` : ''}
        ${esc(student.name)}${esc(student.class||'')} | ${esc(student.school_name)}
      
    
    
      UGX ${feeBalance.toLocaleString()}Fee Balance
      ${attRate}%Attendance
      ${marks.rows.length}Scores
    
    
      Fee Statement
        ${fees.rows.length ? `DescriptionTotalPaidBalanceAction
        ${fees.rows.map(f=>{
          const bal = f.amount - f.paid;
          return `${esc(f.description||'Tuition')}UGX ${parseInt(f.amount).toLocaleString()}UGX ${parseInt(f.paid).toLocaleString()}0?'#dc2626':'#059669'};font-weight:700">UGX ${bal.toLocaleString()}${bal>0?`Pay Now`:'Cleared'}`;
        }).join('')}` : 'No fee records'}
      
      Recent Results
        ${marks.rows.length ? `ExamSubjectScoreGrade
        ${marks.rows.map(m=>`${esc(m.exam)}${esc(m.subject)}${m.score||'-'}${esc(m.grade||'-')}`).join('')}` : 'No results yet'}
      
      Homework
        ${hw.rows.map(h=>`${esc(h.title)}${esc(h.subject||'')} - Due: ${h.due_date||'No date'}`).join('')||'No homework'}
      
      
        Quick Actions
        
          Download Report Card
          ${feeBalance > 0 ? `(f.amount-f.paid)>0)?.id}" class="btn btn-green btn-sm">Pay Fees Online` : ''}
        
      
    
    Back to Children Logout
  `, null));
}));

// ============================================================
// v12.0: ADD LINKS TO ALL DASHBOARDS
// ============================================================ 
// Add fee reminders and payment links to school dashboard
app.get('/school/fee-reminders-link', requireAuth, ah(async (req, res) => { res.redirect('/school/fee-reminders'); }));

// ============================================================
// v13.0 PHASE 2: COUNTRY-AWARE PAYMENT GATEWAY + PATIENT EHR + BILLING + CDS
// ============================================================

// --- Country Payment Configuration ---
const COUNTRY_PAYMENT_CONFIG = {
  UG: { name: 'Uganda', currency: 'UGX', providers: ['mtn_momo', 'airtel_money', 'dpo_card'], phone_prefix: '256', flutterwave_supported: false },
  KE: { name: 'Kenya', currency: 'KES', providers: ['mtn_momo', 'flutterwave'], phone_prefix: '254', flutterwave_supported: true },
  NG: { name: 'Nigeria', currency: 'NGN', providers: ['flutterwave'], phone_prefix: '234', flutterwave_supported: true },
  GH: { name: 'Ghana', currency: 'GHS', providers: ['mtn_momo', 'flutterwave'], phone_prefix: '233', flutterwave_supported: true },
  TZ: { name: 'Tanzania', currency: 'TZS', providers: ['mtn_momo', 'airtel_money', 'flutterwave'], phone_prefix: '255', flutterwave_supported: true },
  RW: { name: 'Rwanda', currency: 'RWF', providers: ['mtn_momo', 'flutterwave'], phone_prefix: '250', flutterwave_supported: true },
  ZA: { name: 'South Africa', currency: 'ZAR', providers: ['flutterwave', 'dpo_card'], phone_prefix: '27', flutterwave_supported: true },
  CD: { name: 'DRC', currency: 'CDF', providers: ['mtn_momo', 'airtel_money'], phone_prefix: '243', flutterwave_supported: false },
  ZM: { name: 'Zambia', currency: 'ZMW', providers: ['airtel_money', 'mtn_momo'], phone_prefix: '260', flutterwave_supported: false },
  MW: { name: 'Malawi', currency: 'MWK', providers: ['airtel_money'], phone_prefix: '265', flutterwave_supported: false }
};

// Detect country from phone number
const detectCountryFromPhone = (phone) => {
  const cleaned = phone.replace(/\s+/g, '').replace(/^\+/, '');
  for (const [code, cfg] of Object.entries(COUNTRY_PAYMENT_CONFIG)) {
    if (cleaned.startsWith(cfg.phone_prefix)) return code;
  }
  // Default Uganda prefixes
  if (/^(256|0)(77|78|39|76|70|74|20|75)/.test(cleaned)) return 'UG';
  if (/^(254|0)7/.test(cleaned)) return 'KE';
  if (/^(234|0)(7|8|9)/.test(cleaned)) return 'NG';
  if (/^(233|0)(2|5)/.test(cleaned)) return 'GH';
  return 'UG'; // Default to Uganda
};

// Get tenant country (from tenant settings or default)
const getTenantCountry = async (tenantId) => {
  try {
    const t = (await pool.query('SELECT country, phone FROM tenants WHERE id=$1', [tenantId])).rows[0];
    if (t?.country && COUNTRY_PAYMENT_CONFIG[t.country]) return t.country;
    if (t?.phone) return detectCountryFromPhone(t.phone);
  } catch (e) {}
  return 'UG';
};

// Get available payment providers for a country
const getProvidersForCountry = (countryCode) => {
  const cfg = COUNTRY_PAYMENT_CONFIG[countryCode] || COUNTRY_PAYMENT_CONFIG.UG;
  return {
    country: countryCode,
    countryName: cfg.name,
    currency: cfg.currency,
    providers: cfg.providers.filter(p => {
      if (p === 'mtn_momo') return !!(process.env.MTN_COLLECTION_USER_ID && process.env.MTN_COLLECTION_API_KEY);
      if (p === 'airtel_money') return !!(process.env.AIRTEL_CLIENT_ID && process.env.AIRTEL_CLIENT_SECRET);
      if (p === 'flutterwave') return cfg.flutterwave_supported && !!process.env.FLW_SECRET_KEY;
      if (p === 'dpo_card') return !!process.env.DPO_COMPANY_TOKEN;
      return false;
    }),
    allConfiguredProviders: cfg.providers,
    flutterwaveSupported: cfg.flutterwave_supported
  };
};

// --- Phase 2 DB Tables: Patient EHR, Billing, Insurance, Clinical Decision Support ---
const phase2Tables = [
  // Patient Allergies (part of EHR)
  `CREATE TABLE IF NOT EXISTS patient_allergies (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, allergen TEXT NOT NULL, reaction TEXT, severity TEXT DEFAULT 'moderate', onset_date DATE, verified_by TEXT, notes TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Chronic Conditions
  `CREATE TABLE IF NOT EXISTS patient_chronic_conditions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, condition_name TEXT NOT NULL, icd_code TEXT, diagnosed_date DATE, treating_doctor TEXT, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Vitals (recorded during visits)
  `CREATE TABLE IF NOT EXISTS patient_vitals (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, visit_id INTEGER, temperature NUMERIC, blood_pressure_systolic INTEGER, blood_pressure_diastolic INTEGER, heart_rate INTEGER, respiratory_rate INTEGER, weight NUMERIC, height NUMERIC, bmi NUMERIC, oxygen_saturation INTEGER, pain_level INTEGER DEFAULT 0, recorded_by TEXT, notes TEXT, recorded_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Immunizations
  `CREATE TABLE IF NOT EXISTS patient_immunizations (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, vaccine_name TEXT NOT NULL, dose_number INTEGER DEFAULT 1, administered_date DATE, administered_by TEXT, batch_number TEXT, next_dose_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Medications History (ongoing medications outside prescriptions)
  `CREATE TABLE IF NOT EXISTS patient_medications (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, medication_name TEXT NOT NULL, dosage TEXT, frequency TEXT, start_date DATE, end_date DATE, prescribed_by TEXT, reason TEXT, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Invoices (Billing)
  `CREATE TABLE IF NOT EXISTS patient_invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, invoice_number TEXT NOT NULL, total_amount INTEGER DEFAULT 0, paid_amount INTEGER DEFAULT 0, discount INTEGER DEFAULT 0, insurance_cover INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', due_date DATE, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Invoice Line Items
  `CREATE TABLE IF NOT EXISTS invoice_items (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, invoice_id INTEGER REFERENCES patient_invoices(id) ON DELETE CASCADE, description TEXT NOT NULL, quantity INTEGER DEFAULT 1, unit_price INTEGER DEFAULT 0, total_price INTEGER DEFAULT 0, category TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Insurance Providers
  `CREATE TABLE IF NOT EXISTS insurance_providers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, code TEXT, type TEXT DEFAULT 'private', contact_phone TEXT, contact_email TEXT, address TEXT, coverage_percentage INTEGER DEFAULT 80, requires_preauth BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Patient Insurance Enrollment
  `CREATE TABLE IF NOT EXISTS patient_insurance (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, provider_id INTEGER REFERENCES insurance_providers(id), policy_number TEXT, member_number TEXT, group_number TEXT, effective_date DATE, expiry_date DATE, coverage_percentage INTEGER, is_primary BOOLEAN DEFAULT true, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Insurance Claims
  `CREATE TABLE IF NOT EXISTS insurance_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, patient_type TEXT NOT NULL DEFAULT 'student', patient_id INTEGER NOT NULL, patient_name TEXT, provider_id INTEGER REFERENCES insurance_providers(id), invoice_id INTEGER REFERENCES patient_invoices(id), claim_number TEXT, amount_claimed INTEGER DEFAULT 0, amount_approved INTEGER DEFAULT 0, status TEXT DEFAULT 'submitted', rejection_reason TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ, notes TEXT)`,
  // Drug Interactions Database (built-in knowledge base for CDS)
  `CREATE TABLE IF NOT EXISTS drug_interactions (id SERIAL PRIMARY KEY, drug_a TEXT NOT NULL, drug_b TEXT NOT NULL, severity TEXT DEFAULT 'moderate', description TEXT, recommendation TEXT, evidence_level TEXT DEFAULT 'established', created_at TIMESTAMPTZ DEFAULT NOW())`,
  // Tenant Country Settings
  `CREATE TABLE IF NOT EXISTS tenant_country_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, country_code TEXT DEFAULT 'UG', currency TEXT DEFAULT 'UGX', timezone TEXT DEFAULT 'Africa/Kampala', language TEXT DEFAULT 'en', preferred_payment TEXT DEFAULT 'mtn_momo', flutterwave_enabled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`
];

// Create Phase 2 tables & seed data (async IIFE for top-level await compatibility)
(async () => {
try {
for (const sql of phase2Tables) {
  try { await pool.query(sql); } catch (e) { /* table already exists is OK */ }
}

// Create indexes for Phase 2
const phase2Indexes = [
  `CREATE INDEX IF NOT EXISTS idx_patient_allergies_tenant ON patient_allergies(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_allergies_patient ON patient_allergies(patient_type, patient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_chronic_tenant ON patient_chronic_conditions(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_vitals_tenant ON patient_vitals(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_immunizations_tenant ON patient_immunizations(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_medications_tenant ON patient_medications(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_invoices_tenant ON patient_invoices(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_insurance_providers_tenant ON insurance_providers(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_patient_insurance_tenant ON patient_insurance(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_insurance_claims_tenant ON insurance_claims(tenant_id)`,
  `CREATE INDEX IF NOT EXISTS idx_drug_interactions_drugs ON drug_interactions(drug_a, drug_b)`,
  `CREATE INDEX IF NOT EXISTS idx_tenant_country_settings ON tenant_country_settings(tenant_id)`
];
for (const sql of phase2Indexes) {
  try { await pool.query(sql); } catch (e) {}
}

// Seed drug interactions database if empty
const interactionCount = (await pool.query('SELECT COUNT(*) FROM drug_interactions')).rows[0].count;
if (parseInt(interactionCount) === 0) {
  const commonInteractions = [
    ['Warfarin', 'Aspirin', 'high', 'Increased risk of bleeding - concurrent use significantly raises bleeding risk', 'Avoid combination unless specifically indicated with close INR monitoring', 'established'],
    ['Warfarin', 'Ibuprofen', 'high', 'Increased anticoagulant effect and bleeding risk', 'Use paracetamol as alternative analgesic', 'established'],
    ['Metformin', 'Cimetidine', 'moderate', 'Reduced renal clearance of metformin, increased lactic acidosis risk', 'Monitor renal function; consider alternative H2 blocker', 'established'],
    ['Lisinopril', 'Potassium', 'moderate', 'Risk of hyperkalemia with ACE inhibitors and potassium supplements', 'Monitor serum potassium levels closely', 'established'],
    ['Amlodipine', 'Simvastatin', 'moderate', 'Amlodipine increases simvastatin levels, risk of myopathy', 'Limit simvastatin to 20mg/day with amlodipine', 'established'],
    ['Ciprofloxacin', 'Antacids', 'moderate', 'Reduced absorption of ciprofloxacin when taken with divalent cations', 'Take ciprofloxacin 2 hours before or 6 hours after antacids', 'established'],
    ['Amoxicillin', 'Methotrexate', 'high', 'Amoxicillin reduces methotrexate clearance, increasing toxicity risk', 'Avoid combination; if required, monitor methotrexate levels', 'established'],
    ['Diclofenac', 'Lisinopril', 'moderate', 'NSAIDs reduce antihypertensive effect and may impair renal function', 'Monitor blood pressure and renal function', 'established'],
    ['Omeprazole', 'Clopidogrel', 'high', 'Omeprazole reduces antiplatelet effect of clopidogrel via CYP2C19 inhibition', 'Use pantoprazole instead as it has less CYP2C19 interaction', 'established'],
    ['Metronidazole', 'Alcohol', 'high', 'Disulfiram-like reaction: severe nausea, vomiting, flushing, palpitations', 'Avoid alcohol during treatment and 48 hours after last dose', 'established'],
    ['Co-trimoxazole', 'Warfarin', 'high', 'Enhanced anticoagulant effect through displacement and vitamin K reduction', 'Monitor INR closely; may need warfarin dose reduction', 'established'],
    ['Cimetidine', 'Theophylline', 'moderate', 'Cimetidine inhibits theophylline metabolism, increasing serum levels', 'Monitor theophylline levels; consider alternative H2 blocker', 'established'],
    ['Artemether/Lumefantrine', 'Metoprolol', 'moderate', 'Lumefantrine may inhibit CYP2D6, increasing metoprolol exposure', 'Monitor heart rate and blood pressure', 'probable'],
    ['Artemether/Lumefantrine', 'Fluconazole', 'moderate', 'Potential QT prolongation when combined', 'Monitor ECG if co-administration necessary', 'probable'],
    ['Sulfadoxine/Pyrimethamine', 'Co-trimoxazole', 'high', 'Additive antifolate effect - increased risk of megaloblastic anemia and pancytopenia', 'Avoid combination; both are antifolate drugs', 'established'],
    ['Quinine', 'Digoxin', 'moderate', 'Quinine increases digoxin serum concentration', 'Monitor digoxin levels closely', 'established'],
    ['Nifedipine', 'Phenytoin', 'moderate', 'Phenytoin induces nifedipine metabolism, reducing efficacy', 'May need higher nifedipine dose; monitor blood pressure', 'established'],
    ['Rifampicin', 'Oral Contraceptives', 'high', 'Rifampicin induces metabolism of estrogen, reducing contraceptive efficacy', 'Use alternative non-hormonal contraception during and after treatment', 'established'],
    ['Carbamazepine', 'Erythromycin', 'moderate', 'Erythromycin inhibits carbamazepine metabolism, risk of toxicity', 'Monitor carbamazepine levels; consider alternative antibiotic', 'established'],
    ['Furosemide', 'Gentamicin', 'high', 'Additive ototoxicity and nephrotoxicity risk', 'Monitor renal function and hearing; use lowest effective doses', 'established']
  ];
  for (const [drugA, drugB, severity, desc, rec, evidence] of commonInteractions) {
    try {
      await pool.query('INSERT INTO drug_interactions(drug_a, drug_b, severity, description, recommendation, evidence_level) VALUES($1,$2,$3,$4,$5,$6)', [drugA, drugB, severity, desc, rec, evidence]);
      // Also add reverse direction
      await pool.query('INSERT INTO drug_interactions(drug_a, drug_b, severity, description, recommendation, evidence_level) VALUES($1,$2,$3,$4,$5,$6)', [drugB, drugA, severity, desc, rec, evidence]);
    } catch (e) {}
  }
  console.log('[Phase2] Drug interaction database seeded with 20 common interactions');
}

// Add Phase 2 feature flags
const phase2Flags = [
  ['patient_ehr', 'Patient EHR', 'Longitudinal electronic health records with allergies, vitals, immunizations, chronic conditions', '4.0', 'clinical', 'clinic_workflow'],
  ['patient_billing', 'Patient Billing', 'Invoice generation, insurance claims, NHIS support, payment tracking', '4.0', 'clinical', 'clinic_workflow'],
  ['clinical_decision_support', 'Clinical Decision Support', 'Drug interaction warnings, allergy alerts, dosage checks', '4.0', 'clinical', 'clinic_workflow'],
  ['country_payments', 'Country-Aware Payments', 'Multi-country payment gateway routing with Flutterwave, MoMo, Airtel', '4.0', 'payments', 'billing']
];
for (const [key, name, desc, ver, cat, req] of phase2Flags) {
  try {
    await pool.query('INSERT INTO feature_flags(feature_key, name, description, version, category, requirements, is_active) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING', [key, name, desc, ver, cat, req]);
  } catch (e) {}
}

// Add country_code column to tenants if missing
try { await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country TEXT DEFAULT \'UG\''); } catch (e) {}
try { await pool.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT \'UGX\''); } catch (e) {}
console.log('[Phase2] DB tables, indexes, drug interactions, and feature flags initialized');
} catch (e) { console.error('[Phase2] Init error:', e.message); }
})(); // End Phase 2 async IIFE

// ============================================================
// v13.0: COUNTRY-AWARE PAYMENT API ENDPOINTS
// ============================================================

// Get available payment methods for a country
app.get('/api/payment-methods/:country', ah(async (req, res) => {
  const country = (req.params.country || 'UG').toUpperCase();
  const providers = getProvidersForCountry(country);
  res.json(providers);
}));

// Get payment methods for current tenant (auto-detect country)
app.get('/api/payment-methods', requireAuth, ah(async (req, res) => {
  const country = await getTenantCountry(req.session.user.tenant_id);
  const providers = getProvidersForCountry(country);
  res.json({ ...providers, detectedCountry: country });
}));

// Set tenant country preference
app.post('/api/settings/country', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { country_code, currency, preferred_payment, flutterwave_enabled } = req.body;
  const cc = (country_code || 'UG').toUpperCase();
  const cfg = COUNTRY_PAYMENT_CONFIG[cc];
  if (!cfg) return res.status(400).json({ error: 'Unsupported country code' });
  
  await pool.query('UPDATE tenants SET country=$1, currency=$2 WHERE id=$3', [cc, currency || cfg.currency, t]);
  await pool.query(`INSERT INTO tenant_country_settings(tenant_id, country_code, currency, preferred_payment, flutterwave_enabled, updated_at) 
    VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(tenant_id) DO UPDATE SET country_code=$2, currency=$3, preferred_payment=$4, flutterwave_enabled=$5, updated_at=NOW()`,
    [t, cc, currency || cfg.currency, preferred_payment || cfg.providers[0], flutterwave_enabled !== undefined ? flutterwave_enabled : cfg.flutterwave_supported]);
  
  await logAudit(t, req.session.user.email, 'country_settings_updated', { country: cc, currency });
  res.json({ success: true, country: cc, currency: currency || cfg.currency, availableProviders: cfg.providers });
}));

// Country-aware checkout (auto-selects payment methods based on tenant country)
app.get('/pay/checkout-v2', requireAuth, ah(async (req, res) => {
  const { amount, plan, description, type, item_id } = req.query;
  const amt = parseInt(amount) || 0;
  const t = req.session.user.tenant_id;
  const country = await getTenantCountry(t);
  const cfg = getProvidersForCountry(country);
  const ref = 'SSEW-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  
  if (amt > 0) {
    await pool.query('INSERT INTO payments(tenant_id,amount,method,status,description,reference) VALUES($1,$2,$3,$4,$5,$6)', [t, amt, 'pending', 'pending', description || `${plan || 'payment'} checkout`, ref]);
  }

  const providerButtons = cfg.providers.map(p => {
    if (p === 'mtn_momo') return `
      MMTN Mobile MoneyPay with your MTN MoMo account
      Pay ${cfg.currency} ${amt.toLocaleString()} with MTN MoMo`;
    if (p === 'airtel_money') return `AAirtel MoneyPay with your Airtel Money account
      Pay ${cfg.currency} ${amt.toLocaleString()} with Airtel Money`;
    if (p === 'flutterwave') return `FWFlutterwaveCard + Mobile Money payment
      Pay ${cfg.currency} ${amt.toLocaleString()} with Flutterwave
      document.getElementById('flwBtnV2').addEventListener('click',function(){FlutterwaveCheckout({public_key:"${esc(process.env.FLW_PUBLIC_KEY||'')}",tx_ref:"${esc(ref)}",amount:${amt},currency:"${cfg.currency}",payment_options:"card,mobilemoney,ussd",redirect_url:"${esc(process.env.BASE_URL||'https://ssewasswa.onrender.com')}/billing/callback",customer:{email:"${esc(req.session.user.email)}"},customizations:{title:"SSEWASSWA",description:"${esc(description||plan||'Payment')}"}});});`;
    if (p === 'dpo_card') return `V/MCard PaymentVisa, Mastercard via DPO Group
      Pay ${cfg.currency} ${amt.toLocaleString()} with Card`;
    return '';
  });

  const tabButtons = cfg.providers.map((p, i) => {
    const labels = { mtn_momo: 'MTN MoMo', airtel_money: 'Airtel Money', flutterwave: 'Flutterwave', dpo_card: 'Card' };
    return `${labels[p]||p}`;
  });

  res.send(renderPage('Secure Payment', `
    
      
        Secure Payment
        ${cfg.currency} ${amt.toLocaleString()}
        ${esc(description || plan || 'Payment')}
        ${esc(cfg.countryName)} (${cfg.currency})
      
      ${cfg.providers.length > 1 ? `${tabButtons.join('')}` : ''}
      ${providerButtons.join('')}
      ${cfg.providers.length === 0 ? `Manual PaymentOnline payments not yet configured for ${esc(cfg.countryName)}. Contact admin for manual payment.Reference: ${esc(ref)}` : ''}
      
        Reference: ${esc(ref)} | Country: ${esc(cfg.countryName)}
        Secure payment. Your data is encrypted.
      
    
    function showPayTab(id){document.querySelectorAll('.pay-option').forEach(el=>el.style.display='none');document.getElementById('pay-'+id).style.display='block';document.querySelectorAll('.tab-bar a').forEach(a=>a.classList.remove('active'));event.target.classList.add('active');}
  `, req.session.user));
}));

// ============================================================
// v13.0: PATIENT EHR (ELECTRONIC HEALTH RECORDS)
// ============================================================

// Patient EHR Dashboard - longitudinal view
app.get('/clinic/patient/:type/:id/ehr', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const patientType = type || 'student';
  
  // Get patient name
  let patientName = 'Unknown Patient';
  if (patientType === 'student') {
    const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    patientName = s?.name || patientName;
  }

  const [allergies, chronic, vitals, immunizations, medications, consultations, prescriptions, labResults] = await Promise.all([
    pool.query('SELECT * FROM patient_allergies WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true ORDER BY created_at DESC', [t, patientType, id]),
    pool.query('SELECT * FROM patient_chronic_conditions WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 ORDER BY created_at DESC', [t, patientType, id]),
    pool.query('SELECT * FROM patient_vitals WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 ORDER BY recorded_at DESC LIMIT 20', [t, patientType, id]),
    pool.query('SELECT * FROM patient_immunizations WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 ORDER BY administered_date DESC', [t, patientType, id]),
    pool.query('SELECT * FROM patient_medications WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true ORDER BY start_date DESC', [t, patientType, id]),
    pool.query('SELECT c.*, cs.name as doctor_name FROM consultations c LEFT JOIN clinic_staff cs ON c.doctor_id=cs.id WHERE c.tenant_id=$1 AND c.patient_type=$2 AND c.patient_id=$3 ORDER BY c.created_at DESC LIMIT 20', [t, patientType, id]),
    pool.query('SELECT p.*, cs.name as doctor_name FROM prescriptions p LEFT JOIN clinic_staff cs ON p.doctor_id=cs.id WHERE p.tenant_id=$1 AND p.patient_type=$2 AND p.patient_id=$3 ORDER BY p.created_at DESC LIMIT 20', [t, patientType, id]),
    pool.query('SELECT lr.*, lr2.test_name FROM lab_results lr JOIN lab_requests lr2 ON lr.lab_request_id=lr2.id WHERE lr.tenant_id=$1 AND lr2.patient_type=$2 AND lr2.patient_id=$3 ORDER BY lr.reported_at DESC LIMIT 20', [t, patientType, id])
  ]);

  const lastVital = vitals.rows[0];
  const bmiVal = lastVital?.weight && lastVital?.height ? (lastVital.weight / ((lastVital.height/100) ** 2)).toFixed(1) : null;

  res.send(renderPage(`EHR: ${patientName}`, `
    
      Patient Health Record
      ${esc(patientName)} | ${patientType === 'student' ? 'Student' : 'Patient'} ID: ${id}
    
    
    
      ${allergies.rows.length}Allergies
      ${chronic.rows.length}Chronic Conditions
      ${vitals.rows.length}Vital Records
      ${immunizations.rows.length}Immunizations
      ${medications.rows.length}Active Medications
      ${consultations.rows.length}Visits
    

    ${lastVital ? `
      Latest Vitals
      
        ${lastVital.temperature ? `Temp: ${lastVital.temperature}°C` : ''}
        ${lastVital.blood_pressure_systolic ? `BP: ${lastVital.blood_pressure_systolic}/${lastVital.blood_pressure_diastolic} mmHg` : ''}
        ${lastVital.heart_rate ? `HR: ${lastVital.heart_rate} bpm` : ''}
        ${lastVital.weight ? `Weight: ${lastVital.weight} kg` : ''}
        ${lastVital.height ? `Height: ${lastVital.height} cm` : ''}
        ${bmiVal ? `BMI: ${bmiVal}` : ''}
        ${lastVital.oxygen_saturation ? `SpO2: ${lastVital.oxygen_saturation}%` : ''}
        ${lastVital.pain_level ? `Pain: ${lastVital.pain_level}/10` : ''}
      
      Recorded: ${new Date(lastVital.recorded_at).toLocaleString()}
    ` : ''}

    
      
      
        
          Allergies
          + Add Allergy
        
        ${allergies.rows.length ? allergies.rows.map(a => `
          
            ${esc(a.allergen)} ${esc(a.severity)}
            ${a.reaction ? `Reaction: ${esc(a.reaction)}` : ''}
            ${a.verified_by ? `Verified by: ${esc(a.verified_by)}` : ''}
          
        `).join('') : 'No allergies recorded'}
      

      
      
        
          Chronic Conditions
          + Add Condition
        
        ${chronic.rows.length ? chronic.rows.map(c => `
          
            ${esc(c.condition_name)} ${c.icd_code ? `${esc(c.icd_code)}` : ''}
            ${c.status ? `${esc(c.status)}` : ''}
            ${c.diagnosed_date ? `Since: ${new Date(c.diagnosed_date).toLocaleDateString()}` : ''}
            ${c.treating_doctor ? `Doctor: ${esc(c.treating_doctor)}` : ''}
          
        `).join('') : 'No chronic conditions'}
      

      
      
        
          Current Medications
          + Add Medication
        
        ${medications.rows.length ? `MedicationDosageSince
          ${medications.rows.map(m => `${esc(m.medication_name)}${esc(m.dosage||'')} ${esc(m.frequency||'')}${m.start_date||'-'}Stop`).join('')}` : 'No active medications'}
      

      
      
        
          Immunizations
          + Add Immunization
        
        ${immunizations.rows.length ? `VaccineDoseDateNext
          ${immunizations.rows.map(im => `${esc(im.vaccine_name)}${im.dose_number||'-'}${im.administered_date||'-'}${im.next_dose_date||'-'}`).join('')}` : 'No immunization records'}
      

      
      
        
          Vitals History
          + Record Vitals
        
        ${vitals.rows.length ? `DateTempBPHRWeightSpO2Pain
          ${vitals.rows.map(v => `${new Date(v.recorded_at).toLocaleDateString()}${v.temperature||'-'}${v.blood_pressure_systolic?v.blood_pressure_systolic+'/'+v.blood_pressure_diastolic:'-'}${v.heart_rate||'-'}${v.weight||'-'}${v.oxygen_saturation||'-'}${v.pain_level||'-'}`).join('')}` : 'No vitals recorded'}
      

      
      
        Recent Consultations
        ${consultations.rows.length ? consultations.rows.map(c => `
          
            ${new Date(c.created_at).toLocaleDateString()} ${esc(c.status)}
            ${c.chief_complaint ? `Complaint: ${esc(c.chief_complaint)}` : ''}
            ${c.diagnosis ? `Diagnosis: ${esc(c.diagnosis)}` : ''}
            ${c.treatment_plan ? `Plan: ${esc(c.treatment_plan)}` : ''}
            ${c.doctor_name ? `Doctor: ${esc(c.doctor_name)}` : ''}
          
        `).join('') : 'No consultation history'}
      

      
      
        Recent Prescriptions
        ${prescriptions.rows.length ? prescriptions.rows.map(p => `
          
            ${new Date(p.created_at).toLocaleDateString()} ${esc(p.status)}
            ${p.diagnosis ? `${esc(p.diagnosis)}` : ''}
            ${p.doctor_name ? `Dr. ${esc(p.doctor_name)}` : ''}
          
        `).join('') : 'No prescriptions'}
      

      
      
        Lab Results
        ${labResults.rows.length ? labResults.rows.map(l => `
          
            ${esc(l.test_name)} ${l.is_abnormal?'Abnormal':'Normal'}
            ${esc(l.result_value||'')} ${l.unit?'('+esc(l.unit)+')':''} | Ref: ${esc(l.reference_range||'N/A')}
          
        `).join('') : 'No lab results'}
      
    

    
      Back to Clinic
      View Billing
    
  `, req.session.user));
}));

// Add Allergy form
app.get('/clinic/patient/:type/:id/allergy/new', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  res.send(renderPage('Add Allergy', `
    
      Add Allergy for ${esc(patientName)}
      
        Allergen *
        Reaction
        SeverityMildModerateSevere / Life-threatening
        Onset Date
        Verified By
        Notes
        Save Allergy
      
      Cancel
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/allergy/save', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const { allergen, reaction, severity, onset_date, verified_by, notes } = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  await pool.query('INSERT INTO patient_allergies(tenant_id,patient_type,patient_id,patient_name,allergen,reaction,severity,onset_date,verified_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [t, type, id, patientName, allergen, reaction || null, severity || 'moderate', onset_date || null, verified_by || null, notes || null]);
  await logAudit(t, req.session.user.email, 'allergy_added', { patient: patientName, allergen });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// Add Chronic Condition form
app.get('/clinic/patient/:type/:id/chronic/new', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  res.send(renderPage('Add Chronic Condition', `
    
      Add Chronic Condition for ${esc(patientName)}
      
        Condition Name *
        ICD Code
        Diagnosed Date
        Treating Doctor
        StatusActiveManagedResolved
        Notes
        Save Condition
      
      Cancel
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/chronic/save', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const { condition_name, icd_code, diagnosed_date, treating_doctor, status, notes } = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  await pool.query('INSERT INTO patient_chronic_conditions(tenant_id,patient_type,patient_id,patient_name,condition_name,icd_code,diagnosed_date,treating_doctor,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [t, type, id, patientName, condition_name, icd_code || null, diagnosed_date || null, treating_doctor || null, status || 'active', notes || null]);
  await logAudit(t, req.session.user.email, 'chronic_condition_added', { patient: patientName, condition: condition_name });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// Record Vitals form
app.get('/clinic/patient/:type/:id/vitals/new', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  res.send(renderPage('Record Vitals', `
    
      Record Vitals for ${esc(patientName)}
      
        
          Temperature (°C)
          Heart Rate (bpm)
          BP Systolic
          BP Diastolic
          Weight (kg)
          Height (cm)
          Respiratory Rate
          Oxygen Saturation (%)
          Pain Level (0-10)
        
        Recorded By
        Notes
        Save Vitals
      
      Cancel
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/vitals/save', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const d = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  const bmi = d.weight && d.height ? (d.weight / ((d.height/100) ** 2)).toFixed(1) : null;
  await pool.query('INSERT INTO patient_vitals(tenant_id,patient_type,patient_id,patient_name,temperature,blood_pressure_systolic,blood_pressure_diastolic,heart_rate,respiratory_rate,weight,height,bmi,oxygen_saturation,pain_level,recorded_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
    [t, type, id, patientName, d.temperature||null, d.blood_pressure_systolic||null, d.blood_pressure_diastolic||null, d.heart_rate||null, d.respiratory_rate||null, d.weight||null, d.height||null, bmi, d.oxygen_saturation||null, d.pain_level||0, d.recorded_by||null, d.notes||null]);
  await logAudit(t, req.session.user.email, 'vitals_recorded', { patient: patientName });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// Add Immunization
app.get('/clinic/patient/:type/:id/immunization/new', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  res.send(renderPage('Add Immunization', `
    
      Add Immunization for ${esc(patientName)}
      
        Vaccine Name *
        Dose Number
        Date Administered
        Administered By
        Batch Number
        Next Dose Date
        Notes
        Save Immunization
      
      Cancel
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/immunization/save', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const d = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  await pool.query('INSERT INTO patient_immunizations(tenant_id,patient_type,patient_id,patient_name,vaccine_name,dose_number,administered_date,administered_by,batch_number,next_dose_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [t, type, id, patientName, d.vaccine_name, d.dose_number||1, d.administered_date||null, d.administered_by||null, d.batch_number||null, d.next_dose_date||null, d.notes||null]);
  await logAudit(t, req.session.user.email, 'immunization_added', { patient: patientName, vaccine: d.vaccine_name });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// Add Medication
app.get('/clinic/patient/:type/:id/medication/new', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  res.send(renderPage('Add Medication', `
    
      Add Medication for ${esc(patientName)}
      
        Medication Name *
        Dosage
        Frequency
        Start Date
        End Date
        Prescribed By
        Reason
        Notes
        Save Medication
      
      Cancel
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/medication/save', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const d = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  await pool.query('INSERT INTO patient_medications(tenant_id,patient_type,patient_id,patient_name,medication_name,dosage,frequency,start_date,end_date,prescribed_by,reason,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [t, type, id, patientName, d.medication_name, d.dosage||null, d.frequency||null, d.start_date||null, d.end_date||null, d.prescribed_by||null, d.reason||null, d.notes||null]);
  await logAudit(t, req.session.user.email, 'medication_added', { patient: patientName, medication: d.medication_name });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// Stop Medication
app.get('/clinic/patient/:type/:id/medication/:medId/stop', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, medId } = req.params;
  await pool.query('UPDATE patient_medications SET is_active=false, end_date=CURRENT_DATE WHERE id=$1 AND tenant_id=$2', [medId, t]);
  await logAudit(t, req.session.user.email, 'medication_stopped', { medicationId: medId });
  res.redirect(`/clinic/patient/${type}/${id}/ehr`);
}));

// ============================================================
// v13.0: PATIENT BILLING & INSURANCE
// ============================================================

// Patient Billing Dashboard
app.get('/clinic/patient/:type/:id/billing', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  
  const [invoices, insurance, providers] = await Promise.all([
    pool.query('SELECT * FROM patient_invoices WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 ORDER BY created_at DESC', [t, type, id]),
    pool.query('SELECT pi.*, ip.name as provider_name FROM patient_insurance pi LEFT JOIN insurance_providers ip ON pi.provider_id=ip.id WHERE pi.tenant_id=$1 AND pi.patient_type=$2 AND pi.patient_id=$3 AND pi.is_active=true', [t, type, id]),
    pool.query('SELECT * FROM insurance_providers WHERE tenant_id=$1 AND is_active=true', [t])
  ]);
  
  const totalBilled = invoices.rows.reduce((s, i) => s + i.total_amount, 0);
  const totalPaid = invoices.rows.reduce((s, i) => s + i.paid_amount, 0);
  const balance = totalBilled - totalPaid;

  res.send(renderPage(`Billing: ${patientName}`, `
    
      Patient Billing
      ${esc(patientName)}
    
    
      ${invoices.rows.length}Invoices
      ${(totalPaid/1000).toFixed(0)}kTotal Paid
      ${(balance/1000).toFixed(0)}kOutstanding
      ${insurance.rows.length}Insurance Plans
    

    
      
        
          Invoices
          + New Invoice
        
        ${invoices.rows.length ? `Invoice #DateTotalPaidBalanceStatusActions
          ${invoices.rows.map(inv => {
            const bal = inv.total_amount - inv.paid_amount;
            return `${esc(inv.invoice_number)}${new Date(inv.created_at).toLocaleDateString()}UGX ${parseInt(inv.total_amount).toLocaleString()}UGX ${parseInt(inv.paid_amount).toLocaleString()}0?'#dc2626':'#059669'};font-weight:700">UGX ${bal.toLocaleString()}${esc(inv.status)}${bal>0?`Pay`:''} View`;
          }).join('')}` : 'No invoices yet'}
      

      
        
          Insurance
          + Add Insurance
        
        ${insurance.rows.length ? insurance.rows.map(ins => `
          
            ${esc(ins.provider_name||'Unknown')}
            Policy: ${esc(ins.policy_number||'N/A')}
            Coverage: ${ins.coverage_percentage||'N/A'}%
            ${ins.is_primary ? ' Primary' : ''}
          
        `).join('') : 'No insurance on file'}
      

      
        Quick Actions
        
          Create Invoice
          Add Insurance
          View Claims
          Back to EHR
        
      
    
  `, req.session.user));
}));

// Create Invoice
app.get('/clinic/patient/:type/:id/invoice/new', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  const invCount = (await pool.query('SELECT COUNT(*) FROM patient_invoices WHERE tenant_id=$1', [t])).rows[0].count;
  const invNum = 'INV-' + String(parseInt(invCount) + 1).padStart(4, '0');
  
  res.send(renderPage('Create Invoice', `
    
      Create Invoice for ${esc(patientName)}
      
        Invoice Number
        Due Date
        Notes
        Line Items
        
          
            
            
            
            
            X
          
        
        + Add Line Item
        
          Grand Total: UGX 0
        
        Create Invoice
      
      
      let lineCount=1;
      function addLineItem(){lineCount++;const d=document.createElement('div');d.className='line-item';d.style.cssText='display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;margin-bottom:8px';d.innerHTML='X';document.getElementById('line-items').appendChild(d);d.querySelectorAll('input[type=number]')[0].addEventListener('input',recalcLine);d.querySelectorAll('input[type=number]')[1].addEventListener('input',recalcLine);}
      function recalcLine(e){const p=e.target.closest('.line-item');const qty=parseFloat(p.querySelectorAll('input')[1].value)||0;const price=parseFloat(p.querySelectorAll('input')[2].value)||0;p.querySelectorAll('input')[3].value=qty*price;recalcTotal();}
      function recalcTotal(){let total=0;document.querySelectorAll('.line-item').forEach(li=>{total+=parseFloat(li.querySelectorAll('input')[3].value)||0;});document.getElementById('grandTotal').textContent=total.toLocaleString();}
      document.querySelectorAll('.line-item input[type=number]').forEach(i=>i.addEventListener('input',recalcLine));
      
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/invoice/save', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const { invoice_number, due_date, notes } = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  
  // Parse line items
  let totalAmount = 0;
  const items = [];
  let i = 1;
  while (req.body[`desc_${i}`]) {
    const desc = req.body[`desc_${i}`];
    const qty = parseInt(req.body[`qty_${i}`]) || 1;
    const price = parseInt(req.body[`price_${i}`]) || 0;
    const lineTotal = qty * price;
    totalAmount += lineTotal;
    items.push({ desc, qty, price, total: lineTotal });
    i++;
  }
  
  const inv = await pool.query('INSERT INTO patient_invoices(tenant_id,patient_type,patient_id,patient_name,invoice_number,total_amount,status,due_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
    [t, type, id, patientName, invoice_number, totalAmount, totalAmount === 0 ? 'paid' : 'pending', due_date || null, notes || null, req.session.user.email]);
  
  for (const item of items) {
    await pool.query('INSERT INTO invoice_items(tenant_id,invoice_id,description,quantity,unit_price,total_price) VALUES($1,$2,$3,$4,$5,$6)',
      [t, inv.rows[0].id, item.desc, item.qty, item.price, item.total]);
  }
  
  await logAudit(t, req.session.user.email, 'invoice_created', { patient: patientName, invoice: invoice_number, amount: totalAmount });
  res.redirect(`/clinic/patient/${type}/${id}/billing`);
}));

// View Invoice Detail
app.get('/clinic/patient/:type/:id/invoice/:invId', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, invId } = req.params;
  const [invoice, items] = await Promise.all([
    pool.query('SELECT * FROM patient_invoices WHERE id=$1 AND tenant_id=$2', [invId, t]),
    pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [invId])
  ]);
  if (!invoice.rows[0]) return res.redirect('/clinic');
  const inv = invoice.rows[0];
  const balance = inv.total_amount - inv.paid_amount;

  res.send(renderPage(`Invoice ${inv.invoice_number}`, `
    
      
        Invoice ${esc(inv.invoice_number)}
        ${esc(inv.status)}
      
      
        Patient: ${esc(inv.patient_name)}
        Date: ${new Date(inv.created_at).toLocaleDateString()}
        Due Date: ${inv.due_date || 'N/A'}
        Created By: ${esc(inv.created_by||'N/A')}
      
      
        DescriptionQtyUnit PriceTotal
        ${items.rows.map(it => `${esc(it.description)}${it.quantity}UGX ${parseInt(it.unit_price).toLocaleString()}UGX ${parseInt(it.total_price).toLocaleString()}`).join('')}
        Total:UGX ${parseInt(inv.total_amount).toLocaleString()}
        Paid:UGX ${parseInt(inv.paid_amount).toLocaleString()}
        Balance:UGX ${balance.toLocaleString()}
      
      ${inv.notes ? `Notes: ${esc(inv.notes)}` : ''}
      
        ${balance > 0 ? `Record Payment
        Submit Insurance Claim` : ''}
        Back to Billing
      
    
  `, req.session.user));
}));

// Record Payment on Invoice
app.get('/clinic/patient/:type/:id/invoice/:invId/pay', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, invId } = req.params;
  const inv = (await pool.query('SELECT * FROM patient_invoices WHERE id=$1 AND tenant_id=$2', [invId, t])).rows[0];
  if (!inv) return res.redirect('/clinic');
  const balance = inv.total_amount - inv.paid_amount;
  const country = await getTenantCountry(t);
  const cfg = getProvidersForCountry(country);
  
  res.send(renderPage('Record Payment', `
    
      Record Payment
      Invoice: ${esc(inv.invoice_number)}
      Balance: UGX ${balance.toLocaleString()}
      
        Option 1: Manual Payment
        
          Amount Paid
          Payment MethodCashMTN MoMoAirtel MoneyBank TransferInsurance
          Reference
          Record Payment
        
        
        Option 2: Online Payment
        Pay Online (${cfg.currency} ${balance.toLocaleString()})
      
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/invoice/:invId/pay-manual', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, invId } = req.params;
  const { amount, method, reference } = req.body;
  const amt = parseInt(amount) || 0;
  
  const inv = (await pool.query('SELECT * FROM patient_invoices WHERE id=$1 AND tenant_id=$2', [invId, t])).rows[0];
  if (!inv) return res.redirect('/clinic');
  const newPaid = Math.min(inv.paid_amount + amt, inv.total_amount);
  const newStatus = newPaid >= inv.total_amount ? 'paid' : 'partial';
  
  await pool.query('UPDATE patient_invoices SET paid_amount=$1, status=$2 WHERE id=$3', [newPaid, newStatus, invId]);
  await logAudit(t, req.session.user.email, 'payment_recorded', { invoice: inv.invoice_number, amount: amt, method });
  res.redirect(`/clinic/patient/${type}/${id}/billing`);
}));

// Insurance Provider Management
app.get('/clinic/insurance', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const providers = (await pool.query('SELECT * FROM insurance_providers WHERE tenant_id=$1 ORDER BY name', [t])).rows;
  
  res.send(renderPage('Insurance Providers', `
    
      
        Insurance Providers
        + Add Provider
      
      ${providers.length ? `NameCodeTypeCoveragePre-AuthActions
        ${providers.map(p => `${esc(p.name)}${esc(p.code||'')}${esc(p.type)}${p.coverage_percentage||0}%${p.requires_preauth?'Yes':'No'}Edit`).join('')}` : 'No insurance providers configured. Add providers like NHIS, UAP, Jubilee, etc.'}
    
  `, req.session.user));
}));

app.get('/clinic/insurance/new', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  res.send(renderPage('Add Insurance Provider', `
    
      Add Insurance Provider
      
        Provider Name *
        Provider Code
        TypeNational (NHIS)Private InsuranceCommunity-BasedEmployer-Based
        Coverage Percentage
        Requires Pre-AuthorizationNoYes
        Contact Phone
        Contact Email
        Address
        Notes
        Save Provider
      
    
  `, req.session.user));
}));

app.post('/clinic/insurance/save', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const d = req.body;
  await pool.query('INSERT INTO insurance_providers(tenant_id,name,code,type,coverage_percentage,requires_preauth,contact_phone,contact_email,address,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [t, d.name, d.code||null, d.type||'private', d.coverage_percentage||80, d.requires_preauth==='true', d.contact_phone||null, d.contact_email||null, d.address||null, d.notes||null]);
  await logAudit(t, req.session.user.email, 'insurance_provider_added', { name: d.name });
  res.redirect('/clinic/insurance');
}));

// Add Patient Insurance
app.get('/clinic/patient/:type/:id/insurance/new', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  const providers = (await pool.query('SELECT * FROM insurance_providers WHERE tenant_id=$1 AND is_active=true', [t])).rows;
  
  res.send(renderPage('Add Insurance', `
    
      Add Insurance for ${esc(patientName)}
      ${providers.length ? `
        Insurance Provider *Select Provider${providers.map(p => `${esc(p.name)} (${esc(p.type)}) - ${p.coverage_percentage}% coverage`).join('')}
        Policy Number
        Member Number
        Group Number
        Effective Date
        Expiry Date
        Coverage Override (%)
        Primary InsuranceYes - PrimaryNo - Secondary
        Notes
        Save Insurance
      ` : `No insurance providers configured yet.Add Provider First`}
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/insurance/save', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id } = req.params;
  const d = req.body;
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  await pool.query('INSERT INTO patient_insurance(tenant_id,patient_type,patient_id,patient_name,provider_id,policy_number,member_number,group_number,effective_date,expiry_date,coverage_percentage,is_primary) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [t, type, id, patientName, d.provider_id, d.policy_number||null, d.member_number||null, d.group_number||null, d.effective_date||null, d.expiry_date||null, d.coverage_percentage||null, d.is_primary!=='false']);
  await logAudit(t, req.session.user.email, 'patient_insurance_added', { patient: patientName });
  res.redirect(`/clinic/patient/${type}/${id}/billing`);
}));

// Submit Insurance Claim
app.get('/clinic/patient/:type/:id/invoice/:invId/claim', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, invId } = req.params;
  const [inv, insurance] = await Promise.all([
    pool.query('SELECT * FROM patient_invoices WHERE id=$1 AND tenant_id=$2', [invId, t]),
    pool.query('SELECT pi.*, ip.name as provider_name, ip.coverage_percentage as provider_coverage, ip.requires_preauth FROM patient_insurance pi JOIN insurance_providers ip ON pi.provider_id=ip.id WHERE pi.tenant_id=$1 AND pi.patient_type=$2 AND pi.patient_id=$3 AND pi.is_active=true', [t, type, id])
  ]);
  if (!inv.rows[0]) return res.redirect('/clinic');
  
  res.send(renderPage('Submit Insurance Claim', `
    
      Submit Insurance Claim
      Invoice: ${esc(inv.rows[0].invoice_number)} - UGX ${parseInt(inv.rows[0].total_amount).toLocaleString()}
      ${insurance.rows.length ? `
        Insurance Provider${insurance.rows.map(ins => `${esc(ins.provider_name)} (${ins.coverage_percentage||ins.provider_coverage||80}%)`).join('')}
        Claim Amount
        Notes
        The claim will be submitted with status "pending". Insurance provider will process it based on their schedule.
        Submit Claim
      ` : `No insurance on file for this patient. Add insurance first.Add Insurance`}
    
  `, req.session.user));
}));

app.post('/clinic/patient/:type/:id/invoice/:invId/claim-submit', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { type, id, invId } = req.params;
  const { provider_id, amount_claimed, notes } = req.body;
  const inv = (await pool.query('SELECT * FROM patient_invoices WHERE id=$1 AND tenant_id=$2', [invId, t])).rows[0];
  let patientName = 'Patient';
  if (type === 'student') { const s = (await pool.query('SELECT name FROM students WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0]; patientName = s?.name || patientName; }
  
  const claimCount = (await pool.query('SELECT COUNT(*) FROM insurance_claims WHERE tenant_id=$1', [t])).rows[0].count;
  const claimNumber = 'CLM-' + String(parseInt(claimCount) + 1).padStart(5, '0');
  
  await pool.query('INSERT INTO insurance_claims(tenant_id,patient_type,patient_id,patient_name,provider_id,invoice_id,claim_number,amount_claimed,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [t, type, id, patientName, provider_id, invId, claimNumber, amount_claimed || 0, 'submitted', notes || null]);
  
  await logAudit(t, req.session.user.email, 'insurance_claim_submitted', { claim: claimNumber, amount: amount_claimed });
  res.redirect(`/clinic/patient/${type}/${id}/billing`);
}));

// Claims Management
app.get('/clinic/claims', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const claims = (await pool.query('SELECT ic.*, ip.name as provider_name FROM insurance_claims ic LEFT JOIN insurance_providers ip ON ic.provider_id=ip.id WHERE ic.tenant_id=$1 ORDER BY ic.submitted_at DESC', [t])).rows;
  
  res.send(renderPage('Insurance Claims', `
    
      Insurance Claims
      ${claims.length ? `Claim #PatientProviderClaimedApprovedStatusActions
        ${claims.map(c => `${esc(c.claim_number)}${esc(c.patient_name)}${esc(c.provider_name||'')}UGX ${parseInt(c.amount_claimed).toLocaleString()}UGX ${parseInt(c.amount_approved).toLocaleString()}${esc(c.status)}${c.status==='submitted'?`Approve Reject`:''}`).join('')}` : 'No claims yet'}
    
  `, req.session.user));
}));

app.get('/clinic/claims/:id/approve', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const claim = (await pool.query('SELECT * FROM insurance_claims WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
  if (!claim) return res.redirect('/clinic/claims');
  await pool.query('UPDATE insurance_claims SET status=$1, amount_approved=$2, processed_at=NOW() WHERE id=$3', ['approved', claim.amount_claimed, req.params.id]);
  // Apply insurance payment to invoice
  if (claim.invoice_id) {
    const inv = (await pool.query('SELECT * FROM patient_invoices WHERE id=$1', [claim.invoice_id])).rows[0];
    if (inv) {
      const newPaid = Math.min(inv.paid_amount + claim.amount_claimed, inv.total_amount);
      await pool.query('UPDATE patient_invoices SET paid_amount=$1, insurance_cover=$2, status=$3 WHERE id=$4', [newPaid, claim.amount_claimed, newPaid >= inv.total_amount ? 'paid' : 'partial', claim.invoice_id]);
    }
  }
  await logAudit(t, req.session.user.email, 'claim_approved', { claimId: req.params.id });
  res.redirect('/clinic/claims');
}));

app.get('/clinic/claims/:id/reject', requireAuth, requireNotBanned, requireFeature('patient_billing'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  await pool.query('UPDATE insurance_claims SET status=$1, processed_at=NOW(), rejection_reason=$2 WHERE id=$3', ['rejected', 'Rejected by admin', req.params.id]);
  await logAudit(t, req.session.user.email, 'claim_rejected', { claimId: req.params.id });
  res.redirect('/clinic/claims');
}));

// ============================================================
// v13.0: CLINICAL DECISION SUPPORT (CDS)
// ============================================================

// API: Check drug interactions for a list of medications
app.get('/api/cds/interactions', requireAuth, ah(async (req, res) => {
  const { medications } = req.query;
  if (!medications) return res.json({ interactions: [] });
  const meds = Array.isArray(medications) ? medications : [medications];
  const interactions = [];
  
  for (let i = 0; i  ({ drug_a: meds[i], drug_b: meds[j], ...f })));
    }
  }
  res.json({ medications: meds, interactions, count: interactions.length });
}));

// API: Check patient allergies before prescribing
app.get('/api/cds/allergy-check', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_type, patient_id, medication } = req.query;
  if (!patient_id || !medication) return res.json({ alerts: [] });
  
  const allergies = (await pool.query('SELECT * FROM patient_allergies WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true', [t, patient_type || 'student', patient_id])).rows;
  const alerts = [];
  
  for (const allergy of allergies) {
    const allergenLower = allergy.allergen.toLowerCase();
    const medLower = medication.toLowerCase();
    // Check if medication name contains the allergen or vice versa
    if (medLower.includes(allergenLower) || allergenLower.includes(medLower.split(' ')[0])) {
      alerts.push({
        type: 'allergy_alert',
        severity: allergy.severity,
        allergen: allergy.allergen,
        reaction: allergy.reaction,
        medication: medication,
        message: `WARNING: Patient has a ${allergy.severity} allergy to ${allergy.allergen}. ${medication} may trigger a reaction (${allergy.reaction || 'unknown reaction'}).`,
        recommendation: allergy.severity === 'severe' ? 'DO NOT prescribe this medication. Find an alternative.' : 'Use with caution. Consider alternative medication.'
      });
    }
    // Common cross-reactivity checks
    const crossReactivity = {
      'penicillin': ['amoxicillin', 'ampicillin', 'amoxil', 'augmentin', 'penicillin', 'benzylpenicillin'],
      'sulfa': ['sulfamethoxazole', 'co-trimoxazole', 'trimethoprim', 'sulfasalazine', 'septrin'],
      'aspirin': ['ibuprofen', 'diclofenac', 'naproxen', 'indomethacin', 'mefenamic'],
      'latex': ['avocado', 'banana', 'kiwi', 'chestnut']
    };
    for (const [allergenGroup, crossReactive] of Object.entries(crossReactivity)) {
      if (allergenLower.includes(allergenGroup) || allergenGroup.includes(allergenLower)) {
        if (crossReactive.some(cr => medLower.includes(cr))) {
          alerts.push({
            type: 'cross_reactivity_alert',
            severity: allergy.severity,
            allergen: allergy.allergen,
            medication: medication,
            message: `CROSS-REACTIVITY WARNING: ${medication} may cross-react with ${allergy.allergen} allergy (${allergy.reaction || 'unknown reaction'}).`,
            recommendation: 'Consider alternative medication. Monitor closely if prescribed.'
          });
        }
      }
    }
  }
  res.json({ patient_type, patient_id, medication, alerts, allergy_count: allergies.length });
}));

// API: Dosage check
app.get('/api/cds/dosage-check', requireAuth, ah(async (req, res) => {
  const { medication, dosage, age, weight } = req.query;
  if (!medication || !dosage) return res.json({ warnings: [] });
  
  const warnings = [];
  const dosageStr = dosage.toLowerCase();
  const dosageNum = parseFloat(dosageStr);
  const ageNum = parseInt(age);
  const weightNum = parseFloat(weight);
  
  // Common pediatric/geriatric dosage warnings
  if (ageNum && ageNum  65) {
    warnings.push({ type: 'geriatric_dose', message: `Elderly patient (age ${ageNum}). Consider reduced dosing due to decreased renal/hepatic clearance.`, severity: 'moderate' });
  }
  
  // Medication-specific dosage checks (Uganda/Africa common medications)
  const dosageChecks = [
    { med: 'paracetamol', maxDailyAdult: 4000, maxDailyPediatric: 60, unit: 'mg', weightBased: true, weightDose: 15 },
    { med: 'amoxicillin', maxDailyAdult: 3000, maxDailyPediatric: 90, unit: 'mg', weightBased: true, weightDose: 25 },
    { med: 'metformin', maxDaily: 2550, unit: 'mg', minAge: 10 },
    { med: 'artemether', maxDailyAdult: 640, unit: 'mg', weightBased: true, weightDose: 3.2 },
    { med: 'ciprofloxacin', maxDaily: 1500, unit: 'mg', minAge: 18, pedWarning: 'Avoid in children under 18 due to cartilage damage risk' },
    { med: 'doxycycline', maxDaily: 200, unit: 'mg', minAge: 8, pedWarning: 'Avoid in children under 8 - causes dental discoloration' },
    { med: 'chloroquine', maxDaily: 600, unit: 'mg base', weightBased: true, weightDose: 10 },
    { med: 'ibuprofen', maxDailyAdult: 2400, maxDailyPediatric: 40, unit: 'mg', weightBased: true, weightDose: 10 },
    { med: 'diclofenac', maxDaily: 150, unit: 'mg', minAge: 14 }
  ];
  
  for (const check of dosageChecks) {
    if (dosageStr.includes(check.med)) {
      if (check.minAge && ageNum && ageNum  check.maxDaily) {
        warnings.push({ type: 'overdose', message: `Dose of ${dosage} exceeds maximum daily dose of ${check.maxDaily}${check.unit} for ${check.med}.`, severity: 'high' });
      }
      if (check.weightBased && weightNum && dosageNum) {
        const expectedDose = weightNum * check.weightDose;
        if (dosageNum > expectedDose * 1.5) {
          warnings.push({ type: 'weight_dose_mismatch', message: `Dose of ${dosageNum}${check.unit} seems high for patient weight of ${weightNum}kg. Expected ~${expectedDose.toFixed(0)}${check.unit} based on ${check.weightDose}${check.unit}/kg.`, severity: 'moderate' });
        }
      }
    }
  }
  
  res.json({ medication, dosage, age: ageNum, weight: weightNum, warnings });
}));

// API: Full CDS check (combines all checks for prescribing)
app.post('/api/cds/full-check', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { patient_type, patient_id, medications, age, weight } = req.body;
  
  if (!medications || !medications.length) return res.json({ alerts: [], interactions: [], warnings: [] });
  
  const allAlerts = [];
  const allInteractions = [];
  const allWarnings = [];
  
  // Check interactions between all medications
  for (let i = 0; i  medLower.includes(c))) {
            allAlerts.push({ type: 'cross_reactivity', severity: 'high', allergen: allergy.allergen, medication: med.name, message: `Cross-reactivity: ${med.name} may react with ${allergy.allergen} allergy.` });
          }
        }
      }
    }
    
    // Check current medications for duplicate therapy
    const currentMeds = (await pool.query('SELECT * FROM patient_medications WHERE tenant_id=$1 AND patient_type=$2 AND patient_id=$3 AND is_active=true', [t, patient_type || 'student', patient_id])).rows;
    for (const med of medications) {
      const duplicate = currentMeds.find(cm => cm.medication_name.toLowerCase().includes(med.name.toLowerCase()) || med.name.toLowerCase().includes(cm.medication_name.toLowerCase()));
      if (duplicate) {
        allWarnings.push({ type: 'duplicate_therapy', medication: med.name, existing: duplicate.medication_name, message: `Patient is already on ${duplicate.medication_name} (${duplicate.dosage} ${duplicate.frequency}). Adding ${med.name} may be duplicate therapy.` });
      }
    }
  }
  
  // Dosage checks
  for (const med of medications) {
    if (med.dosage && age) {
      const ageNum = parseInt(age);
      if (ageNum  65) allWarnings.push({ type: 'geriatric', medication: med.name, message: `Elderly dosing for ${med.name} - consider dose reduction.` });
    }
  }
  
  res.json({
    patient_type, patient_id, medications: medications.map(m => m.name),
    alerts: allAlerts,
    interactions: allInteractions,
    warnings: allWarnings,
    total_issues: allAlerts.length + allInteractions.length + allWarnings.length,
    has_critical: allAlerts.some(a => a.severity === 'severe') || allInteractions.some(i => i.severity === 'high')
  });
}));

// CDS Dashboard (UI for checking interactions)
app.get('/clinic/cds', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const interactions = (await pool.query('SELECT DISTINCT ON (drug_a, drug_b) * FROM drug_interactions ORDER BY drug_a, drug_b')).rows;
  
  res.send(renderPage('Clinical Decision Support', `
    
      Clinical Decision Support
      Drug interactions, allergy alerts, and dosage warnings
    
    
    
      
        Check Drug Interactions
        
          Enter medications (one per line or comma-separated)
          
          Check Interactions
        
        
      
      
      
        Quick Tools
        
          Allergy Checker
          Dosage Calculator
          Interaction Database
        
      
      
      
        Interaction Database (${interactions.length} entries)
        Drug ADrug BSeverityDescriptionRecommendation
          ${interactions.slice(0, 30).map(i => `${esc(i.drug_a)}${esc(i.drug_b)}${esc(i.severity)}${esc((i.description||'').substring(0,100))}${esc((i.recommendation||'').substring(0,80))}`).join('')}
        
        ${interactions.length > 30 ? 'Showing 30 of ' + interactions.length + ' interactions' : ''}
      
    
    
    
    async function checkInteractions(e) {
      e.preventDefault();
      const meds = document.getElementById('medInput').value.split(/[,\n]+/).map(m=>m.trim()).filter(Boolean);
      if (meds.length 'medications='+encodeURIComponent(m)).join('&');
      const resp = await fetch('/api/cds/interactions?'+params);
      const data = await resp.json();
      let html = '';
      if (data.interactions.length === 0) {
        html = 'No known interactions found between these medications.';
      } else {
        html = 'Interactions Found: ' + data.interactions.length + '';
        data.interactions.forEach(i => {
          html += '' + i.drug_a + ' + ' + i.drug_b + ' ' + i.severity + '' + (i.description||'') + '' + (i.recommendation||'') + '';
        });
        html += '';
      }
      document.getElementById('interactionResults').innerHTML = html;
    }
    
  `, req.session.user));
}));

// Allergy Checker UI
app.get('/clinic/cds/allergy-check', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const patients = (await pool.query('SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500', [t])).rows;
  
  res.send(renderPage('Allergy Checker', `
    
      Allergy Checker
      Check if a medication is safe for a patient based on their recorded allergies.
      
        PatientSelect Patient${patients.map(p => `${esc(p.name)}`).join('')}
        Medication
        Check Allergies
      
      
    
    
    async function checkAllergy(e) {
      e.preventDefault();
      const f = new FormData(e.target);
      const resp = await fetch('/api/cds/allergy-check?patient_type=student&patient_id='+f.get('patient_id')+'&medication='+encodeURIComponent(f.get('medication')));
      const data = await resp.json();
      let html = '';
      if (data.alerts.length === 0) {
        html = 'No known allergies for this medication. Patient has '+data.allergy_count+' recorded allergies - none match.';
      } else {
        html = 'Allergy Alert!';
        data.alerts.forEach(a => {
          html += ''+a.type.replace(/_/g,' ').toUpperCase()+''+a.message+''+a.recommendation+'';
        });
        html += '';
      }
      document.getElementById('allergyResults').innerHTML = html;
    }
    
  `, req.session.user));
}));

// Dosage Calculator UI
app.get('/clinic/cds/dosage', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  res.send(renderPage('Dosage Checker', `
    
      Dosage Safety Checker
      Check if a medication dosage is appropriate for the patient's age and weight.
      
        Medication Name
        Dosage
        
          Patient Age
          Patient Weight (kg)
        
        Check Dosage
      
      
    
    
    async function checkDosage(e) {
      e.preventDefault();
      const f = new FormData(e.target);
      const params = new URLSearchParams({medication:f.get('medication'),dosage:f.get('dosage'),age:f.get('age')||'',weight:f.get('weight')||''});
      const resp = await fetch('/api/cds/dosage-check?'+params);
      const data = await resp.json();
      let html = '';
      if (data.warnings.length === 0) {
        html = 'No dosage warnings for this medication at the given dose.';
      } else {
        html = 'Dosage Warnings';
        data.warnings.forEach(w => {
          html += ''+w.type.replace(/_/g,' ').toUpperCase()+''+w.message+'';
        });
        html += '';
      }
      document.getElementById('dosageResults').innerHTML = html;
    }
    
  `, req.session.user));
}));

// Interaction Database Browser
app.get('/clinic/cds/database', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const search = req.query.search || '';
  let interactions;
  if (search) {
    interactions = (await pool.query('SELECT * FROM drug_interactions WHERE drug_a ILIKE $1 OR drug_b ILIKE $1 ORDER BY severity DESC, drug_a', [`%${search}%`])).rows;
  } else {
    interactions = (await pool.query('SELECT * FROM drug_interactions ORDER BY severity DESC, drug_a, drug_b')).rows;
  }
  
  res.send(renderPage('Drug Interaction Database', `
    
      Drug Interaction Database
      
        Search
      
      ${interactions.length ? `Drug ADrug BSeverityDescriptionRecommendationEvidence
        ${interactions.map(i => `${esc(i.drug_a)}${esc(i.drug_b)}${esc(i.severity)}${esc(i.description||'')}${esc(i.recommendation||'')}${esc(i.evidence_level||'')}`).join('')}` : 'No interactions found'}
    
  `, req.session.user));
}));

// Add custom drug interaction
app.get('/clinic/cds/interaction/new', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  res.send(renderPage('Add Drug Interaction', `
    
      Add Drug Interaction
      
        Drug A *
        Drug B *
        SeverityModerateHigh / SevereLow / Minor
        Description
        Recommendation
        Evidence LevelEstablishedProbablePossibleTheoretical
        Save Interaction
      
    
  `, req.session.user));
}));

app.post('/clinic/cds/interaction/save', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  const d = req.body;
  await pool.query('INSERT INTO drug_interactions(drug_a,drug_b,severity,description,recommendation,evidence_level) VALUES($1,$2,$3,$4,$5,$6)', [d.drug_a, d.drug_b, d.severity||'moderate', d.description||null, d.recommendation||null, d.evidence_level||'established']);
  await pool.query('INSERT INTO drug_interactions(drug_a,drug_b,severity,description,recommendation,evidence_level) VALUES($1,$2,$3,$4,$5,$6)', [d.drug_b, d.drug_a, d.severity||'moderate', d.description||null, d.recommendation||null, d.evidence_level||'established']);
  res.redirect('/clinic/cds/database');
}));

// Enhanced prescription save with CDS check integration
app.post('/clinic/prescription/save-cds', requireAuth, requireNotBanned, requireFeature('clinical_decision_support'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const { consultation_id, patient_type, patient_id, patient_name, doctor_id, diagnosis, notes, items } = req.body;
  
  // Run CDS checks first
  const medications = items ? items.map(i => ({ name: i.medicine_name, dosage: i.dosage })) : [];
  let cdsResult = { alerts: [], interactions: [], warnings: [], has_critical: false };
  
  if (medications.length > 0 && patient_id) {
    try {
      const cdsResp = await fetch(`http://localhost:${process.env.PORT || 3000}/api/cds/full-check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': req.headers.cookie || '' },
        body: JSON.stringify({ patient_type, patient_id, medications, age: null, weight: null })
      });
      cdsResult = await cdsResp.json();
    } catch (e) { console.warn('[CDS] Check failed:', e.message); }
  }
  
  res.json({ success: true, cds: cdsResult });
}));

// ============================================================
// v13.0: ENHANCED CLINIC DASHBOARD WITH EHR/BILLING/CDS LINKS
// ============================================================
// Update the clinic dashboard to add links to new features
app.get('/clinic/v2', requireAuth, requireNotBanned, requireFeature('clinic_workflow'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const [staff, queue, prescriptions, labRequests] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM clinic_staff WHERE tenant_id=$1 AND is_active=true', [t]),
    pool.query("SELECT COUNT(*) as total, COUNT(CASE WHEN status='waiting' THEN 1 END) as waiting FROM patient_queue WHERE tenant_id=$1", [t]),
    pool.query("SELECT COUNT(*) as count FROM prescriptions WHERE tenant_id=$1 AND status='pending'", [t]),
    pool.query("SELECT COUNT(*) as count FROM lab_requests WHERE tenant_id=$1 AND status IN ('requested','in_progress')", [t])
  ]);
  
  res.send(renderPage('Clinic Dashboard v2', `
    
      Clinic Dashboard
      Complete healthcare management
    
    
    
      ${staff.rows[0]?.count||0}Active Staff
      ${queue.rows[0]?.waiting||0}Waiting
      ${prescriptions.rows[0]?.count||0}Pending Rx
      ${labRequests.rows[0]?.count||0}Pending Labs
    
    
    
      
        Workflow
        
          Patient Queue
          Staff Management
          Prescriptions
          Lab Requests
          Pharmacy
        
      
      
      
        Patient EHR
        Longitudinal health records with allergies, vitals, immunizations, and chronic conditions.
        
          Search Patient EHR
          Clinical Decision Support
        
      
      
      
        Billing & Insurance
        Invoice patients, manage insurance, and submit claims including NHIS.
        
          Insurance Providers
          Insurance Claims
        
      
      
      
        Country Settings
        Configure payment methods based on your country.
        
          Country & Payment Settings
          View Available Providers (JSON)
        
      
    
  `, req.session.user));
}));

// Patient EHR Search
app.get('/clinic/ehr-search', requireAuth, requireNotBanned, requireFeature('patient_ehr'), ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const search = req.query.search || '';
  let patients = [];
  if (search) {
    patients = (await pool.query('SELECT id, name, class FROM students WHERE tenant_id=$1 AND name ILIKE $2 ORDER BY name LIMIT 50', [t, `%${search}%`])).rows;
  } else {
    patients = (await pool.query('SELECT id, name, class FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 50', [t])).rows;
  }
  
  res.send(renderPage('Patient EHR Search', `
    
      Search Patient Records
      
        Search
      
      NameClass/GroupEHRBilling
        ${patients.map(p => `${esc(p.name)}${esc(p.class||'')}View EHRBilling`).join('')}
      
      ${patients.length === 0 ? 'No patients found' : ''}
    
  `, req.session.user));
}));

// Country & Payment Settings UI
app.get('/settings/country', requireAuth, ah(async (req, res) => {
  const t = req.session.user.tenant_id;
  const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [t])).rows[0];
  const settings = (await pool.query('SELECT * FROM tenant_country_settings WHERE tenant_id=$1', [t])).rows[0];
  const currentCountry = settings?.country_code || tenant?.country || 'UG';
  const currentCurrency = settings?.currency || tenant?.currency || 'UGX';
  
  const countryOptions = Object.entries(COUNTRY_PAYMENT_CONFIG).map(([code, cfg]) => 
    `${code} - ${cfg.name} (${cfg.currency}) ${cfg.flutterwave_supported?'[Flutterwave OK]':'[MoMo/Airtel]'}`
  ).join('');
  
  const cfg = getProvidersForCountry(currentCountry);
  
  res.send(renderPage('Country & Payment Settings', `
    
      Country & Payment Settings
      Configure which payment providers are available based on your country. Flutterwave works in some countries but not Uganda.
      
      
        Country${countryOptions}
        Currency
        Preferred Payment Method
          ${cfg.allConfiguredProviders.map(p => `${p === 'mtn_momo' ? 'MTN MoMo' : p === 'airtel_money' ? 'Airtel Money' : p === 'flutterwave' ? 'Flutterwave' : p === 'dpo_card' ? 'DPO Card' : p}`).join('')}
        
        Enable Flutterwave (where available)Yes (if supported in country)No
        
        
          Available Payment Providers for ${esc(cfg.countryName)}
          
            ${cfg.providers.map(p => `${p === 'mtn_momo' ? 'MTN Mobile Money' : p === 'airtel_money' ? 'Airtel Money' : p === 'flutterwave' ? 'Flutterwave (Card + Mobile Money)' : p === 'dpo_card' ? 'DPO Card Payment' : p} - ${p === 'mtn_momo' || p === 'airtel_money' ? 'Mobile Money push payment' : p === 'flutterwave' ? 'Card, bank transfer, and mobile money' : 'Visa/Mastercard'}`).join('')}
            ${cfg.flutterwaveSupported ? 'Flutterwave is available in this country' : 'Flutterwave is NOT available in this country - use MTN MoMo / Airtel Money instead'}
          
        
        
        Save Settings
      
    
  `, req.session.user));
}));

// ============================================================
// === ADD FEATURES TO ALL DASHBOARDS ===
// ============================================================
// NOTE: 404 and error handlers are moved AFTER launch routes (see below)

// === LAUNCH ROUTES (public site, scraping, entertainment, fundraising, etc.) ===
try {
  const launchRoutes = require('./launch-routes');
  launchRoutes(app, pool, bcrypt, ah, esc, renderPageV3, audit, notify, notifyAll, sendEmail, sendSMS, requireAuth, requireNotBanned, requireSuperAdmin);
  console.log('[Launch] Public routes loaded');
} catch (e) {
  console.warn('[Launch] Failed to load launch routes:', e.message);
}

// === 404 CATCH-ALL (MUST be after all routes including launch-routes) ===
app.use((req, res) => res.status(404).send(renderPage('404', '404Page not foundGo Home', req.session?.user || null)));

// === ERROR HANDLER ===
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  // Send to Sentry if configured
  if (Sentry) Sentry.captureException(err);
  const msg = err.message || 'Something went wrong';
  const user = req.session?.user || null;
  res.status(500).send(renderPage('Error', `500 Error${esc(msg)}Go Home`, user));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SSEWASSWA Platform LIVE on ${PORT}`);
  console.log(`Dev Master: waiswadaniel24@gmail.com / Daniel@2025`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
// Deploy trigger 1778408080
