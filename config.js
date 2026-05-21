'use strict';

require('dotenv').config();

// === ENV VAR NORMALIZATION ===
// Map Render env var names to what the app expects
if (!process.env.GOOGLE_CLIENT_ID && process.env.ClientID) process.env.GOOGLE_CLIENT_ID = process.env.ClientID;
if (!process.env.GOOGLE_CLIENT_SECRET && process.env.Clientsecret) process.env.GOOGLE_CLIENT_SECRET = process.env.Clientsecret;
if (!process.env.SESSION_SECRET && process.env.SESION_SECRET) process.env.SESSION_SECRET = process.env.SESION_SECRET;
if (!process.env.SESSION_SECRET && process.env.SESSION_SECRE) process.env.SESSION_SECRET = process.env.SESSION_SECRE;

// Suppress experimental warnings via env var instead of monkey-patching
if (!process.env.NODE_NO_WARNINGS) process.env.NODE_NO_WARNINGS = '1';

// === GLOBAL TLS SAFETY NET ===
// Render/Heroku managed databases use self-signed certs internally.
// TLS verification is handled per-connection in the Pool config (ssl: { rejectUnauthorized: false }).
process.env.LOCALSTORAGE_FILE = process.env.LOCALSTORAGE_FILE || '/tmp/ssewasswa-localstorage.json';

const crypto = require('crypto');

// ============================================================
// CENTRALIZED PLATFORM CONFIGURATION
// ============================================================
const PLATFORM_CONFIG = {
  // Display
  appName: process.env.APP_NAME || 'Comfort Zone',
  baseUrl: process.env.BASE_URL || 'https://ssewasswa.onrender.com',
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'UGX',
  currencySymbol: process.env.CURRENCY_SYMBOL || 'UGX',
  countryName: process.env.COUNTRY_NAME || 'Uganda',
  phonePrefix: process.env.PHONE_PREFIX || '+256',

  // Session
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE) || 7 * 24 * 60 * 60 * 1000,

  // Security
  loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  lockoutDurationMs: parseInt(process.env.LOCKOUT_DURATION) || 30 * 60 * 1000,
  passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,

  // Rate Limits
  loginRateLimit: parseInt(process.env.LOGIN_RATE_LIMIT) || 50,
  loginRateWindow: 15 * 60 * 1000,
  registerRateLimit: parseInt(process.env.REGISTER_RATE_LIMIT) || 5,
  registerRateWindow: 60 * 60 * 1000,
  apiRateLimit: parseInt(process.env.API_RATE_LIMIT) || 100,
  apiRateWindow: 60 * 1000,

  // Pagination
  defaultPageSize: parseInt(process.env.DEFAULT_PAGE_SIZE) || 50,
  maxPageSize: parseInt(process.env.MAX_PAGE_SIZE) || 200,

  // Email
  emailFromName: process.env.EMAIL_FROM_NAME || 'Comfort Zone',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@comfortzone.co.ug',

  // Backup
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,

  // Webhook
  webhookMaxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES) || 5,
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS) || 15000,

  // Audit
  auditRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS) || 90,
};

// === CONSTANTS ===
const SESSION_MAX_AGE = PLATFORM_CONFIG.sessionMaxAge; // 7 days
const LOGIN_LOCKOUT_WINDOW = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = PLATFORM_CONFIG.loginMaxAttempts;
const DEFAULT_PAGE_SIZE = PLATFORM_CONFIG.defaultPageSize;
const MAX_PAGE_SIZE = PLATFORM_CONFIG.maxPageSize;
const REQUEST_TIMEOUT_MS = 30 * 1000; // 30 seconds
const SUBSCRIPTION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.SESSION_SECRET;

// === WEBSOCKET REAL-TIME NOTIFICATIONS ===
const wsClients = new Map(); // tenant_id -> Set<ws>

// Broadcast notification to all connected clients of a tenant
const wsBroadcast = (tenantId, data) => {
  const clients = wsClients.get(tenantId);
  if (!clients) return;
  const msg = JSON.stringify(data);
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
};

// === REDIS CACHING LAYER ===
let redisCache = null;
try {
  const IORedis = require('ioredis');
  if (process.env.REDIS_URL) {
    redisCache = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 3, retryDelayOnFailover: 100 });
    redisCache.on('error', (err) => console.warn('[Redis Cache]', err.message));
    console.log('[Redis Cache] Connected for query caching');
  }
} catch (e) { console.warn('[Redis Cache] Not available:', e.message); }

const cacheGet = async (key) => {
  if (!redisCache) return null;
  try { const val = await redisCache.get(key); return val ? JSON.parse(val) : null; } catch { return null; }
};
const cacheSet = async (key, data, ttlSeconds) => {
  if (!redisCache) return;
  try { await redisCache.setex(key, ttlSeconds, JSON.stringify(data)); } catch {}
};
const cacheInvalidate = async (pattern) => {
  if (!redisCache) return;
  try { const keys = await redisCache.keys(pattern); if (keys.length) await redisCache.del(keys); } catch {}
};

// Phase 2: Enhanced Redis caching helpers for settings, feature flags, and common queries
const PLATFORM_SETTINGS_TTL = 300; // 5 minutes
const FEATURE_FLAGS_TTL = 600; // 10 minutes

const getCachedPlatformSettings = async () => {
  const cached = await cacheGet('platform:settings:all');
  if (cached) return cached;
  return null;
};

const setCachedPlatformSettings = async (settings) => {
  await cacheSet('platform:settings:all', settings, PLATFORM_SETTINGS_TTL);
};

const invalidatePlatformSettings = async () => {
  await cacheInvalidate('platform:settings:*');
};

const getCachedFeatureFlags = async (tenantId) => {
  const cached = await cacheGet(`tenant:${tenantId}:feature_flags`);
  if (cached) return cached;
  return null;
};

const setCachedFeatureFlags = async (tenantId, flags) => {
  await cacheSet(`tenant:${tenantId}:feature_flags`, flags, FEATURE_FLAGS_TTL);
};

const invalidateFeatureFlags = async (tenantId) => {
  await cacheInvalidate(`tenant:${tenantId}:feature_flags`);
};

// Local in-memory cache for frequently accessed data (fallback when Redis unavailable)
const localCache = new Map();
const localCacheTTLs = new Map();

const localCacheGet = (key) => {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { localCache.delete(key); localCacheTTLs.delete(key); return null; }
  return entry.value;
};

const localCacheSet = (key, value, ttlMs) => {
  localCache.set(key, { value, exp: Date.now() + ttlMs });
  localCacheTTLs.set(key, ttlMs);
  // Prevent unbounded growth
  if (localCache.size > 500) {
    const oldest = [...localCacheTTLs.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < 50; i++) localCache.delete(oldest[i]?.[0]);
    localCacheTTLs.clear();
  }
};

const localCacheInvalidate = (pattern) => {
  if (!pattern.includes('*')) { localCache.delete(pattern); return; }
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const key of localCache.keys()) { if (regex.test(key)) localCache.delete(key); }
};

// === SENTRY ERROR MONITORING ===
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.5,
      profilesSampleRate: 0.5,
      integrations: [Sentry.captureConsoleIntegration ? Sentry.captureConsoleIntegration({ levels: ['error', 'warn'] }) : undefined].filter(Boolean),
    });
    console.log('[Sentry] Error monitoring initialized with console capture');
  } catch (e) { console.warn('[Sentry] Failed to initialize:', e.message); }
}

// === UTILS ===
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const esc = s => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// === TOP-LEVEL i18n HELPER (uiT) ===
const _uiTDict = {
  'nav.dashboard': { lg: 'Olutimbe', sw: 'Dashibodi', fr: 'Tableau de bord' },
  'nav.notifications': { lg: 'Ebyogerwa', sw: 'Arifa', fr: 'Notifications' },
  'nav.modules': { lg: 'Amasomo', sw: 'Moduli', fr: 'Modules' },
  'nav.search': { lg: 'Noonya', sw: 'Tafuta', fr: 'Rechercher' },
  'nav.portal': { lg: 'Akabinja', sw: 'Lango', fr: 'Portail' },
  'nav.settings': { lg: 'Enteekateeka', sw: 'Mipangilio', fr: 'Parametres' },
  'nav.parent': { lg: 'Muziro', sw: 'Mzazi', fr: 'Parent' },
  'nav.worker': { lg: 'Mukazi', sw: 'Mfanyakazi', fr: 'Travailleur' },
  'nav.guide': { lg: 'Enyamba', sw: 'Mwongozo', fr: 'Guide' },
  'nav.logout': { lg: 'Woloka', sw: 'Toka', fr: 'Deconnexion' },
  'nav.login': { lg: 'Yingira', sw: 'Ingia', fr: 'Connexion' },
  'nav.register': { lg: 'Wandikira', sw: 'Jisajili', fr: 'Inscription' },
  'nav.pricing': { lg: 'Enteekateeka', sw: 'Bei', fr: 'Tarifs' },
  'nav.faq': { lg: 'Ebibuuzo', sw: 'Maswali', fr: 'FAQ' },
  'nav.blog': { lg: 'Obulamwa', sw: 'Blogu', fr: 'Blog' },
  'nav.library': { lg: 'Essomero', sw: 'Maktaba', fr: 'Bibliotheque' },
  'nav.mark_all_read': { lg: 'Soma Byonna', sw: 'Soma Zote', fr: 'Tout marquer lu' },
  'nav.view_all': { lg: 'Labye Byonna', sw: 'Tazama Zote', fr: 'Voir tout' },
  'nav.loading': { lg: 'Kutegereza...', sw: 'Inapakia...', fr: 'Chargement...' },
  'nav.error_loading': { lg: 'Kiremya', sw: 'Hitilafu', fr: 'Erreur' },
  'mod.hr': { lg: 'Abakazzi', sw: 'Rasilimali', fr: 'RH' },
  'mod.bookings': { lg: 'Okubooka', sw: 'Uhifadhi', fr: 'Reservations' },
  'mod.procurement': { lg: 'Okugaba', sw: 'Manunuzi', fr: 'Approvisionnement' },
  'mod.incidents': { lg: 'Ebintu', sw: 'Matukio', fr: 'Incidents' },
  'mod.fleet': { lg: 'Emotoka', sw: 'Magari', fr: 'Flotte' },
  'mod.tickets': { lg: 'Kaarata', sw: 'Tiketi', fr: 'Tickets' },
  'mod.kb': { lg: 'Ebisomo', sw: 'Ujuzi', fr: 'Base de connaissances' },
  'bottom.home': { lg: 'Awaka', sw: 'Nyumbani', fr: 'Accueil' },
  'bottom.search': { lg: 'Noonya', sw: 'Tafuta', fr: 'Rechercher' },
  'bottom.alerts': { lg: 'Amakuru', sw: 'Arifa', fr: 'Alertes' },
  'bottom.install': { lg: 'Tegeka', sw: 'Sakinisha', fr: 'Installer' },
  'bottom.me': { lg: 'Anze', sw: 'Mimi', fr: 'Moi' },
  'footer.tagline': { lg: "Amasomero, Amatali, Amakyaala n'Amakolero", sw: 'Shule, Vituo vya Afya, Makanisa na Biashara', fr: 'Ecoles, Cliniques, Eglises et Entreprises' },
};
const uiT = (key, lang) => { const e = _uiTDict[key]; return e ? (e[lang] || key) : key; };

// === INPUT VALIDATION ===
const validateEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validatePhone = (phone) => typeof phone === 'string' && /^(\+?\d{7,15})$/.test(phone.replace(/[\s\-()]/g, ''));
const validateUUID = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const validateAmount = (amount) => typeof amount === 'number' && amount > 0 && amount <= 100000000 && Number.isFinite(amount);
const validateName = (name) => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 200;
const sanitizeInput = (input) => typeof input === 'string' ? input.trim().replace(/[<>'"]/g, '') : input;

// === CSS SANITIZER: Remove dangerous CSS patterns ===
const sanitizeCSS = (css) => {
  if (!css) return '';
  return css
    .replace(/url\s*\(/gi, '/* url removed */(')
    .replace(/@import/gi, '/* @import removed */')
    .replace(/expression\s*\(/gi, '/* expression removed */(')
    .replace(/behavior\s*:/gi, '/* behavior removed */:')
    .replace(/-moz-binding\s*:/gi, '/* moz-binding removed */:')
    .replace(/javascript\s*:/gi, '/* javascript removed */:')
    .replace(/vbscript\s*:/gi, '/* vbscript removed */:');
};

// === HTML SANITIZER: Strip script tags and event handlers ===
const sanitizeHTML = (html) => {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-blocked=')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '');
};

// === INPUT VALIDATION (schema middleware factory) ===
const validate = (schema) => (req, res, next) => {
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const value = req.body[field] || req.params[field] || req.query[field];
    if (rules.required && (!value || value.toString().trim() === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    if (!value && !rules.required) continue;
    const str = String(value);
    if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
      errors.push(`${field} must be a valid email`);
    }
    if (rules.phone && !/^[\+]?[\d\s\-\(\)]{7,15}$/.test(str)) {
      errors.push(`${field} must be a valid phone number`);
    }
    if (rules.numeric && isNaN(Number(str))) {
      errors.push(`${field} must be a number`);
    }
    if (rules.integer && !Number.isInteger(Number(str))) {
      errors.push(`${field} must be an integer`);
    }
    if (rules.min !== undefined && Number(str) < rules.min) {
      errors.push(`${field} must be at least ${rules.min}`);
    }
    if (rules.max !== undefined && Number(str) > rules.max) {
      errors.push(`${field} must be at most ${rules.max}`);
    }
    if (rules.maxLength && str.length > rules.maxLength) {
      errors.push(`${field} must be at most ${rules.maxLength} characters`);
    }
    if (rules.minLength && str.length < rules.minLength) {
      errors.push(`${field} must be at least ${rules.minLength} characters`);
    }
    if (rules.alpha && !/^[a-zA-Z\s\-']+$/.test(str)) {
      errors.push(`${field} must contain only letters, spaces, hyphens, and apostrophes`);
    }
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  next();
};

// === SQL INJECTION PREVENTION: Table name allowlist ===
const VALID_TABLES = new Set([
  'students', 'users', 'tenants', 'fees', 'attendance', 'marks', 'exams', 'classes',
  'subjects', 'results', 'members', 'donations', 'events', 'campaigns', 'inventory',
  'invoices', 'payments', 'subscriptions', 'notifications', 'audit_logs', 'sms_logs',
  'email_queue', 'webhooks', 'webhook_logs', 'automation_rules', 'role_permissions',
  'feature_flags', 'feature_access_overrides', 'chart_of_accounts', 'journal_entries', 'student_accounts',
  'church_accounts', 'student_health', 'meal_attendance', 'parent_links',
  'church_attendance', 'choir_members', 'cell_group_members', 'channel_members',
  'custom_pages', 'document_templates', 'educational_resources', 'scraped_content',
  'public_posts', 'daily_adverts', 'external_links', 'subscription_plans',
  'push_subscriptions', 'ussd_sessions', 'translations', 'platform_settings',
  'platform_status', 'backup_queue', 'developer_revenue', 'momo_payments',
  'graduation_students', 'student_track_assignments', 'policy_acknowledgments',
  'plugin_registry', 'tenant_plugins', 'sms_opt_outs', 'session',
  'leave_requests', 'expense_claims', 'visitors', 'assets', 'feedback_entries', 'user_notes', 'announcements',
  'employee_directory', 'room_bookings', 'purchase_requisitions', 'incident_reports',
  'fleet_vehicles', 'support_tickets', 'knowledge_base',
  'sales', 'sale_items', 'expenses', 'staff', 'church_members', 'customers',
  'org_finance', 'timetable', 'grading_scales', 'fee_structures', 'sign_in_out',
  'fee_receipts', 'purchase_orders', 'tax_records', 'income_records',
  'projects', 'budget_items', 'goals', 'personal_notes', 'meeting_minutes',
  'notice_board', 'sermons', 'prayer_requests', 'service_schedule',
  'hr_employees', 'hr_payroll', 'hr_leave', 'hr_departments', 'hr_appraisals',
  'crm_leads', 'crm_pipeline', 'crm_activities', 'crm_contacts',
  'task_items', 'task_columns', 'task_assignees',
  'asset_register', 'asset_maintenance', 'asset_depreciation',
  'event_tickets', 'event_registrations', 'ticket_orders',
  'invoice_items', 'recurring_invoices', 'recurring_invoice_items',
  'student_id_cards', 'qr_payments', 'qr_payment_scans',
  'installment_plans', 'installment_payments',
  'whatsapp_receipt_log', 'whatsapp_templates',
  'ussd_sessions', 'ussd_menu_config',
  'email_campaigns_list', 'email_subscribers', 'email_tracking',
  'reorder_rules', 'reorder_alerts',
  'appraisals', 'appraisal_criteria', 'appraisal_scores',
  'health_visits', 'health_screenings',
  'tithes_records', 'giving_campaigns', 'analytics_snapshots', 'student_submissions',
  'resolution_votes', 'committees', 'committee_members', 'finance_categories', 'event_rsvps',
  'org_tasks', 'org_task_comments', 'org_notifications', 'board_resolutions',
  'org_attachments', 'meeting_action_items', 'org_health_scores',
  'org_meeting_minutes', 'org_surveys', 'org_survey_responses',
  'org_discussions', 'org_discussion_replies', 'org_email_templates',
  'org_broadcasts', 'org_data_backups', 'user_invitations', 'saved_filters'
]);

// === STRUCTURED LOGGING ===
const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ts: new Date().toISOString(), ...meta })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ts: new Date().toISOString(), ...meta })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ts: new Date().toISOString(), ...meta })),
  debug: (msg, meta = {}) => process.env.NODE_ENV === 'development' && console.log(JSON.stringify({ level: 'debug', msg, ts: new Date().toISOString(), ...meta }))
};

// === CRYPTO: CSRF Token Generator ===
const generateCSRFToken = () => crypto.randomBytes(32).toString('hex');

// === TENANT-AWARE QUERY (Phase 1 Security Fix: Row Level Security) ===
// NOTE: This is a factory that takes pool as an argument.
// Usage: const tq = tenantQuery(pool); then await tq(req, 'SELECT ...', [params])
const tenantQuery = (pool) => async (reqOrTenantId, sql, params = []) => {
  const tenantId = typeof reqOrTenantId === 'object' ? reqOrTenantId?.session?.user?.tenant_id : reqOrTenantId;
  if (!tenantId) {
    // No tenant context (e.g., super_admin or public route) — fall back to regular query
    return pool.query(sql, params);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_tenant_id = $1', [String(tenantId)]);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

// === STANDARD ERROR RESPONSE ===
const errorResponse = (res, statusCode, message, user) => {
  if (!res.headersSent) {
    res.status(statusCode).json({ error: message, status: statusCode, timestamp: new Date().toISOString() });
  }
};

// === VALIDATE PAGINATION ===
const validatePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
};

module.exports = {
  PLATFORM_CONFIG,
  SESSION_MAX_AGE,
  LOGIN_LOCKOUT_WINDOW,
  LOGIN_MAX_ATTEMPTS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
  SUBSCRIPTION_DURATION,
  CSRF_SECRET,
  ah,              // async handler wrapper
  esc,             // HTML escape
  validateEmail,
  validatePhone,
  validateUUID,
  validateAmount,
  validateName,
  sanitizeInput,
  sanitizeCSS,
  sanitizeHTML,
  validate,        // schema validation middleware factory
  VALID_TABLES,
  uiT,             // i18n helper
  _uiTDict,        // i18n dictionary
  // Cache helpers
  cacheGet,
  cacheSet,
  cacheInvalidate,
  getCachedPlatformSettings,
  setCachedPlatformSettings,
  invalidatePlatformSettings,
  getCachedFeatureFlags,
  setCachedFeatureFlags,
  invalidateFeatureFlags,
  localCacheGet,
  localCacheSet,
  localCacheInvalidate,
  // Logging
  logger,
  // WebSocket
  wsBroadcast,
  wsClients,
  // Crypto
  generateCSRFToken,
  // Tenant query factory
  tenantQuery,
  // Utility extras
  errorResponse,
  validatePagination,
  Sentry,
};
