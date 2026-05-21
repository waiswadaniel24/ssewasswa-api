'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// connect-pg-simple for persistent sessions (optional — falls back to memory store)
let pgSession;
try { pgSession = require('connect-pg-simple')(session); } catch (e) { pgSession = null; console.warn('[Session] connect-pg-simple not available, using memory store'); }

/**
 * Setup all Express middleware for the application.
 * @param {import('express').Express} app - Express app instance
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {object} config - Configuration from config.js
 * @param {Function} config.renderPage - renderPage function from server.js (optional, for error pages)
 * @returns {object} { requireAuth, requireNotBanned, requireSuperAdmin, requireTenantAccess, checkTrialAccess, verifyCSRF, pgSessionStore, validatePasswordStrength }
 */
module.exports = function setupMiddleware(app, pool, config) {
  const {
    PLATFORM_CONFIG,
    SESSION_MAX_AGE,
    REQUEST_TIMEOUT_MS,
    CSRF_SECRET,
    generateCSRFToken,
    logger,
    errorResponse,
    esc,
  } = config;

  // Keep a reference to renderPage if provided (for error pages in timeout middleware)
  const renderPage = config.renderPage || null;

  // === SECURITY: Trust proxy ===
  app.set('trust proxy', 1);

  // === HTTPS ENFORCEMENT (production only) ===
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(301, 'https://' + req.headers.host + req.url);
      }
      next();
    });
  }

  // === COMPRESSION (gzip all responses) ===
  app.use(compression({ threshold: 1024, level: 6 }));

  // === HELMET (security headers) ===
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://res.cloudinary.com", "https://*.googleusercontent.com"],
        connectSrc: ["'self'", "ws:", "wss:", "https://api.flutterwave.com", "https://momodeveloper.mtn.com", "https://openapiuat.airtel.africa", "https://secure.3gdirectpay.com", process.env.BASE_URL || 'https://ssewasswa.onrender.com'],
        frameSrc: ["'self'", "https://checkout.flutterwave.com", "https://secure.3gdirectpay.com"],
        objectSrc: ["'none'"],
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    permissionsPolicy: {
      features: {
        geolocation: ["'none'"],
        camera: ["'none'"],
        microphone: ["'none'"],
        payment: ["'self'"],
        usb: ["'none'"],
        magnetometer: ["'none'"],
        gyroscope: ["'none'"],
        accelerometer: ["'none'"],
      }
    }
  }));

  // === BODY PARSER ===
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));

  // === COOKIE PARSER (needed for double-submit CSRF cookie pattern) ===
  app.use(cookieParser());

  // === SERVICE WORKER ROUTE — Must be BEFORE session & express.static ===
  app.get('/sw.js', (req, res) => {
    const swPath = path.resolve(__dirname, 'public', 'sw.js');
    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Service-Worker-Allowed', '/');
    if (fs.existsSync(swPath)) {
      res.sendFile(swPath);
    } else {
      res.send(`const CACHE_NAME='comfort-v9.0';self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/','/login','/offline'])).catch(()=>{}));self.skipWaiting()});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim()});self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{if(r.status===200){const rc=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,rc))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))))});`);
    }
  });

  // === MANIFEST.JSON — Must be BEFORE session middleware for reliable PWA install ===
  app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(JSON.stringify({
      name: "Comfort Zone - All-in-One Management Platform",
      short_name: "ComfortZone",
      description: "The Operating System for African Institutions. Manage schools, churches, clinics, businesses and organizations all in one place.",
      start_url: "/?source=pwa",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#059669",
      orientation: "any",
      dir: "ltr",
      lang: "en",
      categories: ["business", "education", "health", "finance", "productivity", "medical", "lifestyle"],
      prefer_related_applications: false,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-512-sized.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ],
      screenshots: [
        { src: "/og-image.png", sizes: "1200x630", type: "image/png", form_factor: "wide", label: "Comfort Zone Dashboard" }
      ],
      shortcuts: [
        { name: "Dashboard", short_name: "Dashboard", url: "/dashboard?source=pwa", icons: [{ src: "/icon-96.png", sizes: "96x96" }] },
        { name: "Students", short_name: "Students", url: "/school/students?source=pwa", icons: [{ src: "/icon-96.png", sizes: "96x96" }] },
        { name: "Messages", short_name: "Messages", url: "/notifications?source=pwa", icons: [{ src: "/icon-96.png", sizes: "96x96" }] },
        { name: "Settings", short_name: "Settings", url: "/settings?source=pwa", icons: [{ src: "/icon-96.png", sizes: "96x96" }] }
      ],
      share_target: {
        action: "/share",
        method: "POST",
        enctype: "multipart/form-data",
        params: { title: "title", text: "text", url: "url" }
      },
      display_override: ["standalone", "minimal-ui"],
      edge_side_panel: { preferred_width: 400 },
      launch_handler: { client_mode: "auto" }
    }));
  });

  // === UPLOADS DIRECTORY FOR TENANT BRANDING ASSETS ===
  const uploadsTenantDir = path.join(__dirname, 'uploads', 'tenant');
  try { fs.mkdirSync(uploadsTenantDir, { recursive: true }); } catch (e) { /* ignore */ }
  app.use('/uploads/tenant', express.static(uploadsTenantDir));

  // === DYNAMIC FAVICON PER TENANT ===
  // Must be BEFORE express.static('public') so it intercepts /favicon.ico first
  app.get('/favicon.ico', async (req, res, next) => {
    try {
      const branding = req.session?.tenantBranding;
      if (branding?.favicon_url) {
        if (branding.favicon_url.startsWith('/uploads/tenant/')) {
          const filePath = path.join(__dirname, branding.favicon_url);
          if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
          }
        }
        return res.redirect(301, branding.favicon_url);
      }
    } catch (e) { /* non-critical */ }
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // === CSRF PRODUCTION CHECKS ===
  if (process.env.NODE_ENV === 'production' && !CSRF_SECRET) {
    console.error('FATAL: CSRF_SECRET or SESSION_SECRET must be set in production');
    process.exit(1);
  }

  // === HEALTH CHECK (before session middleware — avoids DB connection on ping) ===
  app.get('/ping', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.status(200).send('pong');
  });
  app.head('/ping', (req, res) => {
    res.status(200).end();
  });

  // === SESSION (must come BEFORE CSRF so req.session is available) ===
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET must be set in production');
    process.exit(1);
  }

  // Session store — use PG session store for production (memory sessions break on multi-instance hosts like Render)
  let pgSessionStore;
  if (pgSession) {
    try {
      pgSessionStore = new pgSession({ pool, tableName: 'session', createTableIfMissing: true });
      console.log('[Session] Using PG session store for persistent sessions');
    } catch (e) { console.warn('[Session] PG store creation failed, using memory store:', e.message); }
  } else {
    console.log('[Session] PG store not available, using memory store');
  }

  // Add request timeout BEFORE session to prevent hung DB connections from blocking all requests
  app.use((req, res, next) => {
    req.setTimeout(10000, () => {
      if (!res.headersSent) {
        console.warn('[Timeout] Request timed out:', req.method, req.path);
        res.status(503).send('Service temporarily unavailable. Please try again.');
      }
    });
    next();
  });

  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret-local-only',
    resave: false,
    saveUninitialized: false,
    store: pgSessionStore || undefined,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE
    }
  }));

  // === SESSION ERROR RECOVERY ===
  app.use((req, res, next) => {
    if (!req.session) {
      req.session = {};
    }
    next();
  });

  // === CSRF COOKIE SETTER (sets CSRF-TOKEN cookie on every response if not present) ===
  app.use((req, res, next) => {
    if (!req.cookies || !req.cookies['CSRF-TOKEN']) {
      const newToken = generateCSRFToken();
      res.cookie('CSRF-TOKEN', newToken, {
        httpOnly: false,  // Must be readable by JavaScript for fetch headers
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/'
      });
      req.csrfToken = newToken;
    } else {
      req.csrfToken = req.cookies['CSRF-TOKEN'];
    }
    next();
  });

  // === CSRF VERIFICATION (Double-Submit Cookie Pattern) ===
  const CSRF_EXEMPT_PATHS = [
    '/api/webhook/', '/ipn/', '/pesapal/ipn', '/flutterwave/webhook',
    '/mtn-momo/callback', '/dpo/callback', '/api/public/', '/stripe/webhook',
    '/auth/google', '/auth/microsoft', '/auth/callback',
    '/invite/accept', '/invite/decline', '/invite/reject'
  ];
  const isCSRFExempt = (path) => CSRF_EXEMPT_PATHS.some(p => path.includes(p));

  const verifyCSRF = (req, res, next) => {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // Skip for exempt paths (webhooks, OAuth callbacks, public APIs)
    if (isCSRFExempt(req.path)) return next();

    // Skip for API routes that use header-based auth (Bearer tokens)
    if (req.path.startsWith('/api/') && req.headers['authorization']) return next();

    // Skip for webhook endpoints (external services)
    const webhookPaths = ['/webhook', '/stripe/webhook', '/flutterwave/webhook', '/mtn/callback', '/airtel/callback'];
    if (webhookPaths.some(p => req.path.startsWith(p))) return next();

    // Skip for JSON API calls that use session-based auth + rate limiting
    if (req.is('json') || req.is('application/json')) return next();

    const cookieToken = req.cookies && req.cookies['CSRF-TOKEN'];
    const bodyToken = req.body && (req.body._csrf || req.body.csrf);
    const headerToken = req.headers['x-csrf-token'];

    const submittedToken = bodyToken || headerToken;

    if (!cookieToken || !submittedToken) {
      console.warn('[CSRF] Missing token:', { cookie: !!cookieToken, submitted: !!submittedToken, path: req.path });
      return res.status(403).send('CSRF validation failed: Missing token. Please refresh the page and try again.');
    }

    // Constant-time comparison to prevent timing attacks
    if (cookieToken.length !== submittedToken.length) {
      console.warn('[CSRF] Token length mismatch for path:', req.path);
      return res.status(403).send('CSRF validation failed: Token mismatch. Please refresh the page and try again.');
    }
    try {
      if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(submittedToken))) {
        console.warn('[CSRF] Token mismatch for path:', req.path);
        return res.status(403).send('CSRF validation failed: Token mismatch. Please refresh the page and try again.');
      }
    } catch (e) {
      console.warn('[CSRF] Token comparison error:', e.message, 'path:', req.path);
      return res.status(403).send('CSRF validation failed. Please refresh the page and try again.');
    }

    next();
  };

  // Apply CSRF verification to all state-changing requests
  app.use(verifyCSRF);

  // === RATE LIMITING ===
  // Global rate limiter for all unauthenticated page requests
  const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: 'Too many requests, please slow down.' });
  app.use('/', (req, res, next) => {
    // Only rate-limit unauthenticated users on page routes
    if (!req.session?.user && req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/ping') && !req.path.startsWith('/health')) {
      return globalLimiter(req, res, next);
    }
    next();
  });
  app.use('/login', rateLimit({ windowMs: PLATFORM_CONFIG.loginRateWindow, max: PLATFORM_CONFIG.loginRateLimit, standardHeaders: true }));
  app.use('/register', rateLimit({ windowMs: PLATFORM_CONFIG.registerRateWindow, max: PLATFORM_CONFIG.registerRateLimit, standardHeaders: true }));
  app.use('/api/', rateLimit({ windowMs: PLATFORM_CONFIG.apiRateWindow, max: PLATFORM_CONFIG.apiRateLimit, standardHeaders: true }));
  app.use('/dev/', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true }));
  app.use('/billing', rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true }));
  app.use('/pay/', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true }));
  app.use('/momo/', rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true }));

  // Request timeout middleware
  app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (!res.headersSent) {
        if (renderPage) {
          res.status(504).send(renderPage('Timeout', '<div class="card"><div class="alert alert-error"><h2>Request Timeout</h2><p>The server took too long to respond. Please try again.</p></div></div>', req.session?.user || null));
        } else {
          res.status(504).send('Request Timeout: The server took too long to respond.');
        }
      }
    });
    next();
  });

  // === CORS ===
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  if (ALLOWED_ORIGINS.length > 0) {
    app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
  } else {
    app.use(cors({ origin: (process.env.FRONTEND_URL || 'https://ssewasswa.com').split(',').map(s => s.trim()), credentials: true }));
  }

  // === AUTH MIDDLEWARE ===
  const requireAuth = (req, res, next) => req.session.user ? next() : res.redirect('/login');
  const requireNotBanned = (req, res, next) => req.session.user?.banned ? res.status(403).send('Account banned') : next();

  // === TENANT BRANDING PRELOADER (Phase 2: White Labeling) ===
  const loadTenantBranding = async (req) => {
    if (!req.session?.user?.tenant_id) return;
    const now = Date.now();
    if (req.session._brandingLoadedAt && now - req.session._brandingLoadedAt < 5 * 60 * 1000) return;
    try {
      const tenant = (await pool.query(
        'SELECT custom_css, logo_url, favicon_url, primary_color, secondary_color, font_family FROM tenants WHERE id=$1',
        [req.session.user.tenant_id]
      )).rows[0];
      if (tenant) {
        const branding = {
          custom_css: tenant.custom_css || '',
          logo_url: tenant.logo_url || '',
          favicon_url: tenant.favicon_url || '',
          primary_color: tenant.primary_color || '',
          secondary_color: tenant.secondary_color || '',
          font_family: tenant.font_family || ''
        };
        req.session.tenantBranding = branding;
        req.session.user._branding = branding;
        req.session._brandingLoadedAt = now;
      }
    } catch (e) { /* non-critical: branding load failure should not block requests */ }
  };

  // Auto-load branding on every authenticated request (runs after requireAuth)
  app.use((req, res, next) => {
    if (req.session?.user) {
      loadTenantBranding(req).then(() => next()).catch(() => next());
    } else {
      next();
    }
  });

  const requireTenantAccess = (req, res, next) => {
    const u = req.session.user;
    if (u.role === 'super_admin') return next();
    const requestedTid = parseInt(req.params.tenant_id || req.body.tenant_id || req.query.tenant_id);
    if (!requestedTid || u.tenant_id === requestedTid) return next();
    if (req.path.includes('/portal/') && req.path.includes(u.role)) return next();
    return res.status(403).send('Access denied to this tenant');
  };

  const requireSuperAdmin = (req, res, next) => req.session.user?.role === 'super_admin' ? next() : res.status(403).send('Super admin only');

  // === SESSION-BASED TENANT IMPERSONATION (super_admin can access ANY tenant) ===
  app.use((req, res, next) => {
    if (req.session.user?.role === 'super_admin' && req.session._impersonate_tenant_id) {
      req.session.user.tenant_id = req.session._impersonate_tenant_id;
    }
    next();
  });

  // === TRIAL ENFORCEMENT MIDDLEWARE ===
  const checkTrialAccess = async (req, res, next) => {
    if (!req.session.user) return next();
    if (req.session.user.role === 'super_admin') return next();

    const billingRoutes = ['/billing', '/billing/', '/billing/invoices', '/billing/history', '/settings', '/settings/profile', '/settings/password', '/logout', '/api/subscription/status'];
    if (billingRoutes.some(r => req.path === r || req.path.startsWith(r + '/'))) return next();
    if (req.path.startsWith('/dev/')) return next();
    if (req.path.match(/\.(css|js|png|jpg|ico|svg|woff|woff2|ttf|map)$/)) return next();
    if (['/login', '/register', '/forgot-password', '/ping', '/health', '/sw.js', '/manifest.json'].includes(req.path)) return next();

    try {
      const result = await pool.query(
        `SELECT s.trial_start, s.trial_end, s.trial_expired, s.status, s.plan
         FROM subscriptions s
         WHERE s.tenant_id = $1 AND s.status = 'active'
         ORDER BY COALESCE(s.created_at, s.started_at) DESC LIMIT 1`,
        [req.session.user.tenant_id]
      );

      if (!result.rows.length) return next();

      const sub = result.rows[0];

      if (sub.plan && sub.plan !== 'free' && sub.plan !== 'Free') return next();

      if (sub.trial_end && new Date(sub.trial_end) > new Date()) {
        const daysLeft = Math.ceil((new Date(sub.trial_end) - new Date()) / (1000 * 60 * 60 * 24));
        if (req.session.user._trial_days !== daysLeft) {
          req.session.user._trial_days = daysLeft;
          req.session.user._trial_expired = false;
        }
        return next();
      }

      if (!sub.trial_expired) {
        pool.query(
          'UPDATE subscriptions SET trial_expired = true WHERE tenant_id = $1 AND trial_end < NOW() AND (trial_expired = false OR trial_expired IS NULL)',
          [req.session.user.tenant_id]
        ).catch(e => console.error('[TrialCheck] DB update error:', e.message));
      }

      try {
        const grantCheck = await pool.query(
          "SELECT value->>'free_access_until' as until FROM platform_settings WHERE key = 'tenant_grants' AND value->>'tenant_id' = $1",
          [req.session.user.tenant_id.toString()]
        );
        if (grantCheck.rows.length && grantCheck.rows[0].until && new Date(grantCheck.rows[0].until) > new Date()) {
          req.session.user._trial_days = null;
          req.session.user._trial_expired = false;
          return next();
        }
      } catch (grantErr) { /* platform_settings table may not exist */ }

      req.session.user._trial_expired = true;
      req.session.user._trial_days = 0;

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(402).json({ error: 'Free trial expired', redirect: '/billing' });
      }
      return res.redirect('/billing?trial_expired=1');
    } catch (err) {
      console.error('[TrialCheck] Error:', err.message);
      return next(); // Fail open — allow access on error
    }
  };

  // Apply trial enforcement globally
  app.use(checkTrialAccess);

  // === TENANT ID ENFORCEMENT ===
  const requireTenantId = (req, res, next) => {
    const tid = req.session.user?.tenant_id;
    if (!tid) return next();

    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const bodyTid = req.body?.tenant_id;
      if (bodyTid && parseInt(bodyTid) !== tid) {
        console.warn('[TENANT-ISOLATION] Cross-tenant attempt:', {
          session: tid, body: bodyTid, path: req.path, user: req.session.user?.email
        });
        return res.status(403).send('Access denied: tenant mismatch');
      }
    }
    next();
  };
  app.use(requireTenantId);

  // === WORKER AUTH MIDDLEWARE ===
  const requireWorkerAuth = (req, res, next) => {
    if (req.session.worker) return next();
    res.redirect('/worker/login');
  };

  // === PASSWORD STRENGTH VALIDATOR ===
  const validatePasswordStrength = (password) => {
    const errors = [];
    if (!password || password.length < 8) errors.push('Password must be at least 8 characters long');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain at least 1 uppercase letter (A-Z)');
    if (!/[a-z]/.test(password)) errors.push('Password must contain at least 1 lowercase letter (a-z)');
    if (!/[0-9]/.test(password)) errors.push('Password must contain at least 1 number (0-9)');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) errors.push('Password must contain at least 1 special character (!@#$%^&*...)');
    return errors;
  };

  return {
    requireAuth,
    requireNotBanned,
    requireSuperAdmin,
    requireTenantAccess,
    checkTrialAccess,
    verifyCSRF,
    pgSessionStore,
    validatePasswordStrength,
    requireWorkerAuth,
  };
};
