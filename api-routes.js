/**
 * Comfort Platform - REST/JSON API v1 Module
 * Multi-tenant SaaS API for African institutions
 *
 * Mounts all /api/v1/* routes on the Express app.
 * Receives: app, pool, requireAuth, requireTenantAccess, validateTable, VALID_TABLES, audit, logger
 *
 * Auth: JWT tokens (Bearer) or X-API-Key header
 * Multi-tenancy: Every query filters by tenant_id from the authenticated user/token.
 */

'use strict';

const { migrateQuery } = require('./db');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_ACCESS_EXPIRY = 24 * 60 * 60;       // 24 hours in seconds
const JWT_REFRESH_EXPIRY = 7 * 24 * 60 * 60;   // 7 days in seconds
const RATE_LIMIT_WINDOW = 60 * 1000;            // 1 minute
const RATE_LIMIT_MAX = 100;                     // 100 requests per minute per token

// In-memory rate limit store: token/email -> { count, resetAt }
const _rateLimits = new Map();

// In-memory revoked token set: jti -> expiry timestamp (auto-cleanup)
const _revokedTokens = new Map();

// Clean up revoked tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of _revokedTokens) {
    if (exp <= now) _revokedTokens.delete(jti);
  }
  for (const [key, entry] of _rateLimits) {
    if (entry.resetAt <= now) _rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// ─── JWT IMPLEMENTATION (manual HMAC-SHA256) ────────────────────────────────

/**
 * Base64URL encode
 */
function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

/**
 * Create a JWT token
 * @param {Object} payload - Data to encode
 * @param {number} expiresIn - Seconds until expiry
 * @returns {string} JWT token
 */
function jwtSign(payload, expiresIn = JWT_ACCESS_EXPIRY) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomBytes(16).toString('hex');
  const body = { ...payload, iat: now, exp: now + expiresIn, jti };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const bodyB64 = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${headerB64}.${bodyB64}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('hex');

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verify a JWT token
 * @param {string} token - JWT token string
 * @returns {Object} { valid: boolean, payload?: Object, error?: string }
 */
function jwtVerify(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Invalid token format' };

    const [headerB64, bodyB64, sigB64] = parts;
    const signingInput = `${headerB64}.${bodyB64}`;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('hex');
    const actualSig = base64UrlDecode(sigB64).toString('hex');

    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(actualSig))) {
      return { valid: false, error: 'Invalid signature' };
    }

    const payload = JSON.parse(base64UrlDecode(bodyB64).toString());
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' };
    }

    // Check if token is revoked
    if (payload.jti && _revokedTokens.has(payload.jti)) {
      return { valid: false, error: 'Token revoked' };
    }

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: 'Token verification failed: ' + e.message };
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Sanitize a value for safe SQL string interpolation (prevents injection in ORDER BY, etc.)
 */
function sanitizeSortField(field) {
  if (!field || typeof field !== 'string') return 'id';
  const clean = field.replace(/[^a-zA-Z0-9_]/g, '');
  return clean || 'id';
}

/**
 * Validate sort direction
 */
function sanitizeSortDir(dir) {
  return dir === 'DESC' || dir === 'desc' ? 'DESC' : 'ASC';
}

/**
 * Validate UUID or integer ID
 */
function isValidId(id) {
  if (typeof id === 'number' && id > 0) return true;
  if (typeof id === 'string') {
    const n = parseInt(id, 10);
    return !isNaN(n) && n > 0;
  }
  return false;
}

/**
 * Validate pagination parameters
 */
function getPagination(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Build a paginated response
 */
function paginatedResponse(data, total, page, limit) {
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
}

/**
 * Success response helper
 */
function success(res, data, statusCode = 200) {
  res.status(statusCode).json({ success: true, data });
}

/**
 * Error response helper
 */
function fail(res, message, statusCode = 400) {
  res.status(statusCode).json({ success: false, error: message });
}

/**
 * Async handler wrapper (catches errors and passes to next)
 */
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Hash an API key using SHA-256
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ─── MAIN MODULE ─────────────────────────────────────────────────────────────

module.exports = (app, pool, requireAuth, requireTenantAccess, validateTable, VALID_TABLES, audit, logger) => {

  // ─── STARTUP MIGRATION: Create api_tokens table ──────────────────────────

  async function migrateApiTokensTable() {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS api_tokens (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        user_email TEXT NOT NULL,
        access_token_jti TEXT,
        refresh_token_jti TEXT,
        device_info TEXT,
        ip_address TEXT,
        revoked BOOLEAN DEFAULT false,
        revoked_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_api_tokens_tenant ON api_tokens(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_api_tokens_jti ON api_tokens(access_token_jti)`,
      `CREATE INDEX IF NOT EXISTS idx_api_tokens_refresh ON api_tokens(refresh_token_jti)`,
    ];
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { logger.warn('API token migration warning: ' + e.message); }
    }
    logger.info('[API v1] api_tokens table ready');
  }

  migrateApiTokensTable().catch(e => logger.error('[API v1] Migration failed: ' + e.message));

  // ─── CORS HEADERS (API-specific) ─────────────────────────────────────────

  app.use('/api/v1/', (req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '*').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Request-ID');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Max-Age', '86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-API-Version', 'v1');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // ─── RATE LIMITER MIDDLEWARE ─────────────────────────────────────────────

  function apiRateLimit(req, res, next) {
    const identifier = req.apiUser ? req.apiUser.email : (req.headers['x-api-key'] || req.ip);
    const now = Date.now();
    let entry = _rateLimits.get(identifier);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
      _rateLimits.set(identifier, entry);
    }

    entry.count++;

    res.set('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.set('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - entry.count));
    res.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > RATE_LIMIT_MAX) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Try again later.',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000)
      });
    }

    next();
  }

  // ─── JWT AUTH MIDDLEWARE ─────────────────────────────────────────────────

  /**
   * Authenticate via JWT Bearer token or X-API-Key header.
   * Sets req.apiUser = { email, tenant_id, role } on success.
   */
  function authenticateApi(req, res, next) {
    // Strategy 1: Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const result = jwtVerify(token);
      if (!result.valid) {
        return res.status(401).json({ success: false, error: result.error });
      }
      req.apiUser = {
        email: result.payload.email,
        tenant_id: result.payload.tenant_id,
        role: result.payload.role,
        jti: result.payload.jti,
      };
      req.tokenType = 'jwt';
      return next();
    }

    // Strategy 2: X-API-Key header
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      return authenticateApiKey(apiKey, req, res, next);
    }

    return res.status(401).json({ success: false, error: 'Authentication required. Provide Bearer token or X-API-Key header.' });
  }

  /**
   * Authenticate via API key (X-API-Key header)
   */
  async function authenticateApiKey(apiKey, req, res, next) {
    try {
      const keyHash = hashApiKey(apiKey);
      const row = (await pool.query(
        'SELECT ak.*, t.id as tenant_id FROM api_keys ak JOIN tenants t ON ak.tenant_id = t.id WHERE ak.key_hash = $1 AND ak.revoked IS NOT true',
        [keyHash]
      )).rows[0];

      if (!row) {
        return res.status(401).json({ success: false, error: 'Invalid API key' });
      }

      // Update last_used timestamp
      pool.query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [row.id]).catch(() => {});

      req.apiUser = {
        email: row.name || 'api-key-user',
        tenant_id: row.tenant_id,
        role: 'api',
      };
      req.tokenType = 'api_key';
      req.apiKeyId = row.id;
      next();
    } catch (e) {
      logger.error('[API] API key auth error: ' + e.message);
      return res.status(500).json({ success: false, error: 'Authentication error' });
    }
  }

  // Apply auth + rate limiting to all /api/v1/ routes (except auth/login)
  app.use('/api/v1/', (req, res, next) => {
    // Skip auth for login endpoint
    if (req.path === '/auth/login' || req.path === '/auth/refresh') {
      return apiRateLimit(req, res, next);
    }
    return authenticateApi(req, res, (err) => {
      if (err) return res.status(500).json({ success: false, error: 'Auth error' });
      return apiRateLimit(req, res, next);
    });
  });

  // ─── 1. JWT AUTH SYSTEM ─────────────────────────────────────────────────

  /**
   * POST /api/v1/auth/login
   * Email + password → JWT access token + refresh token
   */
  app.post('/api/v1/auth/login', ah(async (req, res) => {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string') return fail(res, 'Email is required');
    if (!password || typeof password !== 'string') return fail(res, 'Password is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'Invalid email format');

    // Fetch user with password hash
    let user;
    try {
      user = (await pool.query(
        'SELECT u.id, u.tenant_id, u.email, u.password_hash, u.password, u.role, u.approved, u.banned, u.ban_reason, t.banned as tenant_banned FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1',
        [email.toLowerCase().trim()]
      )).rows[0];
    } catch (e) {
      return fail(res, 'Database error', 500);
    }

    const storedHash = user?.password_hash || user?.password;

    if (!user || !storedHash) {
      return fail(res, 'Invalid credentials', 401);
    }
    if (user.banned) return fail(res, 'Account is banned: ' + (user.ban_reason || 'Contact support'), 403);
    if (!user.approved) return fail(res, 'Account pending approval', 403);
    if (user.tenant_banned) return fail(res, 'Organization account is suspended', 403);

    const valid = await bcrypt.compare(password, storedHash);
    if (!valid) {
      await audit(email, 'api_login_failed', `Failed API login from IP: ${req.ip}`);
      return fail(res, 'Invalid credentials', 401);
    }

    // Generate tokens
    const accessToken = jwtSign(
      { email: user.email, tenant_id: user.tenant_id, role: user.role },
      JWT_ACCESS_EXPIRY
    );
    const refreshToken = jwtSign(
      { email: user.email, tenant_id: user.tenant_id, role: user.role, type: 'refresh' },
      JWT_REFRESH_EXPIRY
    );

    // Extract JTI for tracking
    const accessPayload = jwtVerify(accessToken);
    const refreshPayload = jwtVerify(refreshToken);

    // Store token session in DB
    try {
      await pool.query(
        `INSERT INTO api_tokens (tenant_id, user_email, access_token_jti, refresh_token_jti, device_info, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')`,
        [
          user.tenant_id,
          user.email,
          accessPayload.payload.jti,
          refreshPayload.payload.jti,
          req.headers['user-agent'] || 'unknown',
          req.ip
        ]
      );
    } catch (e) {
      logger.warn('[API] Could not store token session: ' + e.message);
    }

    await audit(user.email, 'api_login', 'User logged in via API', { ip: req.ip, userAgent: req.headers['user-agent'] });

    logger.info('[API] Login: ' + user.email + ' tenant=' + user.tenant_id);

    success(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: JWT_ACCESS_EXPIRY,
      user: { email: user.email, tenant_id: user.tenant_id, role: user.role }
    }, 200);
  }));

  /**
   * POST /api/v1/auth/refresh
   * Refresh token → new access token
   */
  app.post('/api/v1/auth/refresh', ah(async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token || typeof refresh_token !== 'string') {
      return fail(res, 'Refresh token is required');
    }

    const result = jwtVerify(refresh_token);
    if (!result.valid) return fail(res, result.error, 401);
    if (result.payload.type !== 'refresh') return fail(res, 'Not a refresh token', 401);

    // Check if refresh token session exists and is not revoked
    try {
      const session = (await pool.query(
        'SELECT * FROM api_tokens WHERE refresh_token_jti = $1 AND revoked = false',
        [result.payload.jti]
      )).rows[0];

      if (!session) return fail(res, 'Refresh token invalid or revoked', 401);
    } catch (e) {
      logger.warn('[API] Token session check error: ' + e.message);
    }

    const { email, tenant_id, role } = result.payload;
    const newAccessToken = jwtSign({ email, tenant_id, role }, JWT_ACCESS_EXPIRY);
    const newAccessPayload = jwtVerify(newAccessToken);

    // Update the session with new access token JTI
    try {
      await pool.query(
        'UPDATE api_tokens SET access_token_jti = $1 WHERE refresh_token_jti = $2',
        [newAccessPayload.payload.jti, result.payload.jti]
      );
    } catch (e) {
      // Non-critical
    }

    await audit(email, 'api_token_refresh', 'Access token refreshed via API');

    success(res, {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: JWT_ACCESS_EXPIRY,
      user: { email, tenant_id, role }
    });
  }));

  /**
   * POST /api/v1/auth/logout
   * Invalidate the current token
   */
  app.post('/api/v1/auth/logout', ah(async (req, res) => {
    if (!req.apiUser) return fail(res, 'Not authenticated', 401);

    const authHeader = req.headers.authorization;
    let tokenJti = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (result.valid && result.payload.jti) {
        tokenJti = result.payload.jti;
        // Add to in-memory revocation cache
        _revokedTokens.set(result.payload.jti, Date.now() + JWT_ACCESS_EXPIRY * 1000);
      }
    }

    // Mark token session as revoked in DB
    if (tokenJti) {
      try {
        await pool.query(
          'UPDATE api_tokens SET revoked = true, revoked_at = NOW() WHERE access_token_jti = $1',
          [tokenJti]
        );
      } catch (e) {
        // Non-critical
      }
    }

    await audit(req.apiUser.email, 'api_logout', 'User logged out via API');

    success(res, { message: 'Logged out successfully' });
  }));

  /**
   * GET /api/v1/auth/me
   * Get current user profile from JWT
   */
  app.get('/api/v1/auth/me', ah(async (req, res) => {
    if (!req.apiUser) return fail(res, 'Not authenticated', 401);

    try {
      const user = (await pool.query(
        'SELECT u.id, u.email, u.role, u.tenant_id, u.approved, u.banned, u.dark_mode, u.created_at, t.name as tenant_name, t.type as tenant_type FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id WHERE u.email = $1 AND u.tenant_id = $2',
        [req.apiUser.email, req.apiUser.tenant_id]
      )).rows[0];

      if (!user) return fail(res, 'User not found', 404);

      // Don't expose password hash
      const { password_hash, password, ...profile } = user;
      success(res, profile);
    } catch (e) {
      logger.error('[API] /auth/me error: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  // ─── 2. STUDENTS API ────────────────────────────────────────────────────

  /**
   * GET /api/v1/students
   * List students with pagination, search, class filter
   */
  app.get('/api/v1/students', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['s.tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    // Search by name or admission number
    if (req.query.search) {
      conditions.push(`(s.name ILIKE $${paramIdx} OR s.admission_no ILIKE $${paramIdx})`);
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }

    // Filter by class
    if (req.query.class) {
      conditions.push(`s.class = $${paramIdx}`);
      params.push(req.query.class);
      paramIdx++;
    }

    // Filter by stream
    if (req.query.stream) {
      conditions.push(`s.stream = $${paramIdx}`);
      params.push(req.query.stream);
      paramIdx++;
    }

    const where = conditions.join(' AND ');
    const sortField = sanitizeSortField(req.query.sort_by);
    const sortDir = sanitizeSortDir(req.query.sort_dir);

    try {
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM students s WHERE ${where}`, params);
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT s.* FROM students s WHERE ${where} ORDER BY ${sortField} ${sortDir} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /students: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/students
   * Create a new student
   */
  app.post('/api/v1/students', ah(async (req, res) => {
    const { name, admission_no, class: className, stream, guardian_name, guardian_phone, photo_url, parent_email } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) return fail(res, 'Student name is required');

    try {
      const result = await pool.query(
        `INSERT INTO students (tenant_id, name, admission_no, class, stream, guardian_name, guardian_phone, photo_url, parent_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.apiUser.tenant_id, name.trim(), admission_no || null, className || null, stream || null,
          guardian_name || null, guardian_phone || null, photo_url || null, parent_email || null]
      );

      await audit(req.apiUser.email, 'api_student_create', `Created student: ${name} (ID: ${result.rows[0].id})`);
      success(res, result.rows[0], 201);
    } catch (e) {
      if (e.message.includes('admission_no') && e.message.includes('unique')) {
        return fail(res, 'Admission number already exists for this tenant');
      }
      logger.error('[API] POST /students: ' + e.message);
      fail(res, 'Failed to create student');
    }
  }));

  /**
   * GET /api/v1/students/:id
   * Get a single student by ID
   */
  app.get('/api/v1/students/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid student ID');

    try {
      const result = await pool.query(
        'SELECT * FROM students WHERE id = $1 AND tenant_id = $2',
        [id, req.apiUser.tenant_id]
      );

      if (result.rows.length === 0) return fail(res, 'Student not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      logger.error('[API] GET /students/:id: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/students/:id
   * Update a student
   */
  app.put('/api/v1/students/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid student ID');

    const allowed = ['name', 'admission_no', 'class', 'stream', 'guardian_name', 'guardian_phone', 'photo_url', 'parent_email'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        params.push(req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) return fail(res, 'No fields to update');

    params.push(id, req.apiUser.tenant_id);

    try {
      const result = await pool.query(
        `UPDATE students SET ${updates.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
        params
      );

      if (result.rows.length === 0) return fail(res, 'Student not found', 404);

      await audit(req.apiUser.email, 'api_student_update', `Updated student ID: ${id}`, req.body);
      success(res, result.rows[0]);
    } catch (e) {
      if (e.message.includes('unique')) return fail(res, 'Admission number already exists');
      logger.error('[API] PUT /students/:id: ' + e.message);
      fail(res, 'Failed to update student');
    }
  }));

  /**
   * DELETE /api/v1/students/:id
   * Soft delete a student
   */
  app.delete('/api/v1/students/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid student ID');

    try {
      const exists = await pool.query(
        'SELECT id, name FROM students WHERE id = $1 AND tenant_id = $2',
        [id, req.apiUser.tenant_id]
      );
      if (exists.rows.length === 0) return fail(res, 'Student not found', 404);

      // Check if there's a deleted_at column (soft delete feature flag)
      try {
        await pool.query(
          'UPDATE students SET deleted_at = NOW() WHERE id = $1 AND tenant_id = $2',
          [id, req.apiUser.tenant_id]
        );
        await audit(req.apiUser.email, 'api_student_delete', `Soft deleted student: ${exists.rows[0].name} (ID: ${id})`);
        success(res, { message: 'Student soft deleted', id });
      } catch (softErr) {
        // Soft delete column doesn't exist; do hard delete
        await pool.query(
          'DELETE FROM students WHERE id = $1 AND tenant_id = $2',
          [id, req.apiUser.tenant_id]
        );
        await audit(req.apiUser.email, 'api_student_delete', `Deleted student: ${exists.rows[0].name} (ID: ${id})`);
        success(res, { message: 'Student deleted', id });
      }
    } catch (e) {
      logger.error('[API] DELETE /students/:id: ' + e.message);
      fail(res, 'Failed to delete student', 500);
    }
  }));

  // ─── 3. FEES API ────────────────────────────────────────────────────────

  /**
   * GET /api/v1/fees
   * List fees with filters
   */
  app.get('/api/v1/fees', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['f.tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    if (req.query.student_id) {
      if (!isValidId(req.query.student_id)) return fail(res, 'Invalid student_id');
      conditions.push(`f.student_id = $${paramIdx}`);
      params.push(parseInt(req.query.student_id));
      paramIdx++;
    }

    if (req.query.term) {
      conditions.push(`f.term = $${paramIdx}`);
      params.push(req.query.term);
      paramIdx++;
    }

    if (req.query.year) {
      conditions.push(`f.year = $${paramIdx}`);
      params.push(parseInt(req.query.year));
      paramIdx++;
    }

    if (req.query.status) {
      const status = req.query.status.toLowerCase();
      if (status === 'paid') conditions.push('f.paid >= f.amount');
      else if (status === 'partial') conditions.push('f.paid > 0 AND f.paid < f.amount');
      else if (status === 'unpaid') conditions.push('f.paid = 0 OR f.paid IS NULL');
    }

    const where = conditions.join(' AND ');

    try {
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM fees f WHERE ${where}`, params);
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT f.*, s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id = s.id
         WHERE ${where} ORDER BY f.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /fees: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/fees
   * Create a fee record
   */
  app.post('/api/v1/fees', ah(async (req, res) => {
    const { student_id, amount, term, year } = req.body;

    if (!isValidId(student_id)) return fail(res, 'Valid student_id is required');
    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'Valid positive amount is required');

    try {
      // Verify student belongs to same tenant
      const student = await pool.query(
        'SELECT id, name FROM students WHERE id = $1 AND tenant_id = $2',
        [parseInt(student_id), req.apiUser.tenant_id]
      );
      if (student.rows.length === 0) return fail(res, 'Student not found', 404);

      const result = await pool.query(
        `INSERT INTO fees (tenant_id, student_id, amount, paid, term, year) VALUES ($1, $2, $3, 0, $4, $5) RETURNING *`,
        [req.apiUser.tenant_id, parseInt(student_id), Math.round(amount), term || null, year || null]
      );

      await audit(req.apiUser.email, 'api_fee_create', `Created fee for student ${student.rows[0].name}: ${amount}`);
      success(res, result.rows[0], 201);
    } catch (e) {
      logger.error('[API] POST /fees: ' + e.message);
      fail(res, 'Failed to create fee record');
    }
  }));

  /**
   * GET /api/v1/fees/:id
   */
  app.get('/api/v1/fees/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid fee ID');

    try {
      const result = await pool.query(
        'SELECT f.*, s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id = s.id WHERE f.id = $1 AND f.tenant_id = $2',
        [id, req.apiUser.tenant_id]
      );
      if (result.rows.length === 0) return fail(res, 'Fee record not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/fees/:id
   */
  app.put('/api/v1/fees/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid fee ID');

    const allowed = ['amount', 'term', 'year'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        params.push(field === 'amount' ? Math.round(req.body[field]) : req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) return fail(res, 'No fields to update');

    params.push(id, req.apiUser.tenant_id);

    try {
      const result = await pool.query(
        `UPDATE fees SET ${updates.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
        params
      );
      if (result.rows.length === 0) return fail(res, 'Fee record not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      fail(res, 'Failed to update fee record');
    }
  }));

  /**
   * POST /api/v1/fees/:id/pay
   * Record a payment against a fee
   */
  app.post('/api/v1/fees/:id/pay', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid fee ID');

    const { amount, method, reference } = req.body;
    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'Valid positive payment amount is required');

    try {
      const fee = await pool.query(
        'SELECT f.*, s.name as student_name FROM fees f LEFT JOIN students s ON f.student_id = s.id WHERE f.id = $1 AND f.tenant_id = $2',
        [id, req.apiUser.tenant_id]
      );
      if (fee.rows.length === 0) return fail(res, 'Fee record not found', 404);

      const feeData = fee.rows[0];
      const currentPaid = feeData.paid || 0;
      const newPaid = Math.min(currentPaid + Math.round(amount), feeData.amount);

      if (currentPaid + Math.round(amount) > feeData.amount) {
        logger.warn('[API] Overpayment attempt on fee ID ' + id);
      }

      await pool.query(
        'UPDATE fees SET paid = $1 WHERE id = $2',
        [newPaid, id]
      );

      // Record payment in fee_receipts if that table exists
      try {
        await pool.query(
          `INSERT INTO fee_receipts (tenant_id, fee_id, student_id, amount, paid, method, received_by, receipt_no)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.apiUser.tenant_id, id, feeData.student_id, Math.round(amount), newPaid, method || 'cash',
           req.apiUser.email, 'RCP-' + Date.now()]
        );
      } catch (receiptErr) {
        // fee_receipts table might not exist; non-critical
        logger.debug('[API] fee_receipts insert skipped: ' + receiptErr.message);
      }

      const balance = feeData.amount - newPaid;
      await audit(req.apiUser.email, 'api_fee_payment', `Payment of ${amount} on fee ID ${id} for ${feeData.student_name}`, { method, reference });

      success(res, {
        fee_id: id,
        student_name: feeData.student_name,
        amount_paid: newPaid,
        total_amount: feeData.amount,
        balance: Math.max(0, balance),
        status: balance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid'),
        this_payment: Math.round(amount),
        method: method || 'cash'
      });
    } catch (e) {
      logger.error('[API] POST /fees/:id/pay: ' + e.message);
      fail(res, 'Failed to record payment');
    }
  }));

  /**
   * GET /api/v1/fees/balance/:student_id
   * Get total fee balance for a student
   */
  app.get('/api/v1/fees/balance/:student_id', ah(async (req, res) => {
    const studentId = parseInt(req.params.student_id);
    if (!isValidId(studentId)) return fail(res, 'Invalid student ID');

    try {
      // Verify student belongs to tenant
      const student = await pool.query(
        'SELECT id, name FROM students WHERE id = $1 AND tenant_id = $2',
        [studentId, req.apiUser.tenant_id]
      );
      if (student.rows.length === 0) return fail(res, 'Student not found', 404);

      const fees = await pool.query(
        `SELECT id, amount, paid, term, year, created_at FROM fees WHERE student_id = $1 AND tenant_id = $2 ORDER BY year DESC, term DESC`,
        [studentId, req.apiUser.tenant_id]
      );

      let totalOwed = 0;
      let totalPaid = 0;
      const breakdown = fees.rows.map(f => {
        const balance = f.amount - (f.paid || 0);
        totalOwed += f.amount;
        totalPaid += (f.paid || 0);
        return {
          fee_id: f.id,
          amount: f.amount,
          paid: f.paid || 0,
          balance,
          term: f.term,
          year: f.year,
          status: balance <= 0 ? 'paid' : ((f.paid || 0) > 0 ? 'partial' : 'unpaid')
        };
      });

      success(res, {
        student_id: studentId,
        student_name: student.rows[0].name,
        total_owed: totalOwed,
        total_paid: totalPaid,
        outstanding_balance: totalOwed - totalPaid,
        fees: breakdown
      });
    } catch (e) {
      logger.error('[API] GET /fees/balance/:student_id: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  // ─── 4. ATTENDANCE API ──────────────────────────────────────────────────

  /**
   * GET /api/v1/attendance
   * List attendance with date range and class filters
   */
  app.get('/api/v1/attendance', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['a.tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    if (req.query.date_from) {
      conditions.push(`a.date >= $${paramIdx}`);
      params.push(req.query.date_from);
      paramIdx++;
    }

    if (req.query.date_to) {
      conditions.push(`a.date <= $${paramIdx}`);
      params.push(req.query.date_to);
      paramIdx++;
    }

    if (req.query.class) {
      conditions.push(`s.class = $${paramIdx}`);
      params.push(req.query.class);
      paramIdx++;
    }

    if (req.query.status) {
      conditions.push(`a.status = $${paramIdx}`);
      params.push(req.query.status);
      paramIdx++;
    }

    if (req.query.student_id) {
      if (!isValidId(req.query.student_id)) return fail(res, 'Invalid student_id');
      conditions.push(`a.student_id = $${paramIdx}`);
      params.push(parseInt(req.query.student_id));
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM attendance a LEFT JOIN students s ON a.student_id = s.id WHERE ${where}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT a.*, s.name as student_name, s.class FROM attendance a LEFT JOIN students s ON a.student_id = s.id
         WHERE ${where} ORDER BY a.date DESC, s.name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /attendance: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/attendance
   * Record attendance (bulk) - accepts array of { student_id, date, status }
   */
  app.post('/api/v1/attendance', ah(async (req, res) => {
    const records = req.body;

    if (!Array.isArray(records) || records.length === 0) return fail(res, 'Request body must be a non-empty array of attendance records');
    if (records.length > 500) return fail(res, 'Maximum 500 records per request');

    const validStatuses = ['present', 'absent', 'late', 'excused'];
    const errors = [];
    const created = [];
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!isValidId(r.student_id)) { errors.push(`Record ${i}: invalid student_id`); continue; }
      if (!r.date && !req.body.date) { errors.push(`Record ${i}: date is required`); continue; }
      if (r.status && !validStatuses.includes(r.status)) { errors.push(`Record ${i}: invalid status. Use: ${validStatuses.join(', ')}`); continue; }
    }

    if (errors.length > 0 && created.length === 0) return fail(res, 'Validation errors', 400);

    try {
      for (const r of records) {
        const studentId = parseInt(r.student_id);
        const date = r.date || req.body.date || today;
        const status = r.status || 'present';

        try {
          const result = await pool.query(
            `INSERT INTO attendance (tenant_id, student_id, date, status)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status
             RETURNING *`,
            [req.apiUser.tenant_id, studentId, date, status]
          );
          created.push(result.rows[0]);
        } catch (insertErr) {
          errors.push(`Student ${r.student_id}: ${insertErr.message}`);
        }
      }

      await audit(req.apiUser.email, 'api_attendance_bulk', `Recorded ${created.length} attendance records`);

      success(res, {
        created: created.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        records: created
      });
    } catch (e) {
      logger.error('[API] POST /attendance: ' + e.message);
      fail(res, 'Failed to record attendance', 500);
    }
  }));

  /**
   * GET /api/v1/attendance/today
   * Today's attendance summary
   */
  app.get('/api/v1/attendance/today', ah(async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const tid = req.apiUser.tenant_id;

    try {
      const summary = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present') as present,
           COUNT(*) FILTER (WHERE status = 'absent') as absent,
           COUNT(*) FILTER (WHERE status = 'late') as late,
           COUNT(*) FILTER (WHERE status = 'excused') as excused,
           COUNT(*) as total
         FROM attendance WHERE tenant_id = $1 AND date = $2`,
        [tid, today]
      );

      const records = await pool.query(
        `SELECT a.*, s.name as student_name, s.class, s.stream
         FROM attendance a LEFT JOIN students s ON a.student_id = s.id
         WHERE a.tenant_id = $1 AND a.date = $2
         ORDER BY s.class, s.name`,
        [tid, today]
      );

      success(res, {
        date: today,
        summary: summary.rows[0],
        records: records.rows
      });
    } catch (e) {
      logger.error('[API] GET /attendance/today: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * GET /api/v1/attendance/student/:id
   * Attendance history for a specific student
   */
  app.get('/api/v1/attendance/student/:id', ah(async (req, res) => {
    const studentId = parseInt(req.params.id);
    if (!isValidId(studentId)) return fail(res, 'Invalid student ID');

    const { page, limit, offset } = getPagination(req.query);

    try {
      const student = await pool.query(
        'SELECT id, name FROM students WHERE id = $1 AND tenant_id = $2',
        [studentId, req.apiUser.tenant_id]
      );
      if (student.rows.length === 0) return fail(res, 'Student not found', 404);

      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM attendance WHERE student_id = $1 AND tenant_id = $2',
        [studentId, req.apiUser.tenant_id]
      );
      const total = parseInt(countResult.rows[0].total);

      const records = await pool.query(
        'SELECT * FROM attendance WHERE student_id = $1 AND tenant_id = $2 ORDER BY date DESC LIMIT $3 OFFSET $4',
        [studentId, req.apiUser.tenant_id, limit, offset]
      );

      const stats = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'present') as present,
           COUNT(*) FILTER (WHERE status = 'absent') as absent,
           COUNT(*) FILTER (WHERE status = 'late') as late,
           COUNT(*) FILTER (WHERE status = 'excused') as excused,
           COUNT(*) as total_days
         FROM attendance WHERE student_id = $1 AND tenant_id = $2`,
        [studentId, req.apiUser.tenant_id]
      );

      res.json(paginatedResponse({
        student: student.rows[0],
        statistics: stats.rows[0],
        attendance: records.rows
      }, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /attendance/student/:id: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  // ─── 5. MARKS API ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/marks
   * List marks with exam, subject, class filters
   */
  app.get('/api/v1/marks', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['e.tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    if (req.query.exam_id) {
      if (!isValidId(req.query.exam_id)) return fail(res, 'Invalid exam_id');
      conditions.push(`m.exam_id = $${paramIdx}`);
      params.push(parseInt(req.query.exam_id));
      paramIdx++;
    }

    if (req.query.student_id) {
      if (!isValidId(req.query.student_id)) return fail(res, 'Invalid student_id');
      conditions.push(`m.student_id = $${paramIdx}`);
      params.push(parseInt(req.query.student_id));
      paramIdx++;
    }

    if (req.query.subject) {
      conditions.push(`m.subject ILIKE $${paramIdx}`);
      params.push(req.query.subject);
      paramIdx++;
    }

    if (req.query.class) {
      conditions.push(`s.class = $${paramIdx}`);
      params.push(req.query.class);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM marks m JOIN exams e ON m.exam_id = e.id LEFT JOIN students s ON m.student_id = s.id WHERE ${where}`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT m.*, e.name as exam_name, e.term, e.year, s.name as student_name, s.class
         FROM marks m
         JOIN exams e ON m.exam_id = e.id
         LEFT JOIN students s ON m.student_id = s.id
         WHERE ${where} ORDER BY e.year DESC, e.term DESC, s.name ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /marks: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/marks
   * Create or upsert marks
   */
  app.post('/api/v1/marks', ah(async (req, res) => {
    const records = req.body;

    // Support single record or array
    const items = Array.isArray(records) ? records : [records];
    if (items.length === 0) return fail(res, 'No marks data provided');
    if (items.length > 500) return fail(res, 'Maximum 500 records per request');

    const errors = [];
    const created = [];

    try {
      for (let i = 0; i < items.length; i++) {
        const r = items[i];
        if (!isValidId(r.exam_id)) { errors.push(`Record ${i}: invalid exam_id`); continue; }
        if (!isValidId(r.student_id)) { errors.push(`Record ${i}: invalid student_id`); continue; }
        if (!r.subject || typeof r.subject !== 'string') { errors.push(`Record ${i}: subject is required`); continue; }

        // Verify exam belongs to tenant
        const exam = await pool.query('SELECT id FROM exams WHERE id = $1 AND tenant_id = $2', [parseInt(r.exam_id), req.apiUser.tenant_id]);
        if (exam.rows.length === 0) { errors.push(`Record ${i}: exam not found or access denied`); continue; }

        try {
          const result = await pool.query(
            `INSERT INTO marks (exam_id, student_id, subject, score, grade)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (exam_id, student_id, subject) DO UPDATE SET score = EXCLUDED.score, grade = EXCLUDED.grade
             RETURNING *`,
            [parseInt(r.exam_id), parseInt(r.student_id), r.subject.trim(),
             r.score !== undefined ? parseInt(r.score) : null,
             r.grade || null]
          );
          created.push(result.rows[0]);
        } catch (insertErr) {
          errors.push(`Record ${i}: ${insertErr.message}`);
        }
      }

      await audit(req.apiUser.email, 'api_marks_upsert', `Created/updated ${created.length} mark records`);

      success(res, {
        created: created.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        records: created
      });
    } catch (e) {
      logger.error('[API] POST /marks: ' + e.message);
      fail(res, 'Failed to save marks', 500);
    }
  }));

  /**
   * GET /api/v1/marks/student/:id
   * Student report card data
   */
  app.get('/api/v1/marks/student/:id', ah(async (req, res) => {
    const studentId = parseInt(req.params.id);
    if (!isValidId(studentId)) return fail(res, 'Invalid student ID');

    const examId = req.query.exam_id ? parseInt(req.query.exam_id) : null;

    try {
      const student = await pool.query(
        'SELECT s.*, t.name as tenant_name FROM students s JOIN tenants t ON s.tenant_id = t.id WHERE s.id = $1 AND s.tenant_id = $2',
        [studentId, req.apiUser.tenant_id]
      );
      if (student.rows.length === 0) return fail(res, 'Student not found', 404);

      let markConditions = 'm.student_id = $1 AND e.tenant_id = $2';
      const markParams = [studentId, req.apiUser.tenant_id];
      let paramIdx = 3;

      if (examId) {
        markConditions += ` AND m.exam_id = $${paramIdx}`;
        markParams.push(examId);
        paramIdx++;
      }

      const marks = await pool.query(
        `SELECT m.*, e.name as exam_name, e.term, e.year
         FROM marks m JOIN exams e ON m.exam_id = e.id
         WHERE ${markConditions} ORDER BY e.year DESC, e.term DESC, m.subject ASC`,
        markParams
      );

      // Aggregate by exam
      const reportCards = {};
      for (const mark of marks.rows) {
        const key = `${mark.exam_name}-${mark.year}-${mark.term}`;
        if (!reportCards[key]) {
          reportCards[key] = { exam_name: mark.exam_name, term: mark.term, year: mark.year, subjects: [], total_score: 0, subjects_count: 0 };
        }
        reportCards[key].subjects.push({ subject: mark.subject, score: mark.score, grade: mark.grade });
        reportCards[key].total_score += (mark.score || 0);
        reportCards[key].subjects_count++;
      }

      // Calculate averages
      for (const card of Object.values(reportCards)) {
        card.average = card.subjects_count > 0 ? Math.round(card.total_score / card.subjects_count) : 0;
      }

      success(res, {
        student: student.rows[0],
        report_cards: Object.values(reportCards),
        all_marks: marks.rows
      });
    } catch (e) {
      logger.error('[API] GET /marks/student/:id: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  // ─── 6. MEMBERS API (Church) ────────────────────────────────────────────

  /**
   * GET /api/v1/members
   */
  app.get('/api/v1/members', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    if (req.query.search) {
      conditions.push(`(name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR phone ILIKE $${paramIdx})`);
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }

    if (req.query.role) {
      conditions.push(`role = $${paramIdx}`);
      params.push(req.query.role);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    try {
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM members WHERE ${where}`, params);
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT * FROM members WHERE ${where} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /members: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/members
   */
  app.post('/api/v1/members', ah(async (req, res) => {
    const { name, email, phone, role } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) return fail(res, 'Member name is required');

    try {
      const result = await pool.query(
        `INSERT INTO members (tenant_id, name, email, phone, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.apiUser.tenant_id, name.trim(), email || null, phone || null, role || null]
      );

      await audit(req.apiUser.email, 'api_member_create', `Created member: ${name} (ID: ${result.rows[0].id})`);
      success(res, result.rows[0], 201);
    } catch (e) {
      logger.error('[API] POST /members: ' + e.message);
      fail(res, 'Failed to create member');
    }
  }));

  /**
   * GET /api/v1/members/:id
   */
  app.get('/api/v1/members/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid member ID');

    try {
      const result = await pool.query(
        'SELECT * FROM members WHERE id = $1 AND tenant_id = $2', [id, req.apiUser.tenant_id]
      );
      if (result.rows.length === 0) return fail(res, 'Member not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/members/:id
   */
  app.put('/api/v1/members/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid member ID');

    const allowed = ['name', 'email', 'phone', 'role'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        params.push(req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) return fail(res, 'No fields to update');
    params.push(id, req.apiUser.tenant_id);

    try {
      const result = await pool.query(
        `UPDATE members SET ${updates.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
        params
      );
      if (result.rows.length === 0) return fail(res, 'Member not found', 404);

      await audit(req.apiUser.email, 'api_member_update', `Updated member ID: ${id}`);
      success(res, result.rows[0]);
    } catch (e) {
      fail(res, 'Failed to update member');
    }
  }));

  // ─── 7. INVENTORY API (Business) ────────────────────────────────────────

  /**
   * GET /api/v1/inventory
   */
  app.get('/api/v1/inventory', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const conditions = ['tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;

    if (req.query.search) {
      conditions.push(`(name ILIKE $${paramIdx} OR sku ILIKE $${paramIdx})`);
      params.push(`%${req.query.search}%`);
      paramIdx++;
    }

    if (req.query.low_stock === 'true' || req.query.low_stock === '1') {
      conditions.push('quantity <= 10');
    }

    const where = conditions.join(' AND ');

    try {
      const countResult = await pool.query(`SELECT COUNT(*) as total FROM inventory WHERE ${where}`, params);
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT * FROM inventory WHERE ${where} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /inventory: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/inventory
   */
  app.post('/api/v1/inventory', ah(async (req, res) => {
    const { name, sku, quantity, cost_price, selling_price, category, description, reorder_level, supplier } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) return fail(res, 'Item name is required');

    try {
      const cols = ['tenant_id', 'name'];
      const vals = [req.apiUser.tenant_id, name.trim()];
      let paramIdx = 3;

      if (sku !== undefined) { cols.push('sku'); vals.push(sku); paramIdx++; }
      if (quantity !== undefined) { cols.push('quantity'); vals.push(parseInt(quantity) || 0); paramIdx++; }
      if (cost_price !== undefined) { cols.push('cost_price'); vals.push(Math.round(cost_price)); paramIdx++; }
      if (selling_price !== undefined) { cols.push('selling_price'); vals.push(Math.round(selling_price)); paramIdx++; }

      // Try optional columns that may not exist
      const optionalCols = { category, description, reorder_level, supplier };
      for (const [col, val] of Object.entries(optionalCols)) {
        if (val !== undefined) {
          try {
            cols.push(col);
            vals.push(col === 'reorder_level' ? parseInt(val) || 0 : val);
            paramIdx++;
          } catch (colErr) { /* column doesn't exist, skip */ }
        }
      }

      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      const result = await pool.query(
        `INSERT INTO inventory (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        vals
      );

      await audit(req.apiUser.email, 'api_inventory_create', `Added inventory item: ${name}`);
      success(res, result.rows[0], 201);
    } catch (e) {
      if (e.message.includes('unique') && e.message.includes('sku')) return fail(res, 'SKU already exists');
      logger.error('[API] POST /inventory: ' + e.message);
      fail(res, 'Failed to create inventory item');
    }
  }));

  /**
   * PUT /api/v1/inventory/:id
   */
  app.put('/api/v1/inventory/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid inventory ID');

    const allowed = ['name', 'sku', 'quantity', 'cost_price', 'selling_price', 'category', 'description', 'reorder_level', 'supplier'];
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx}`);
        params.push(field === 'quantity' || field === 'cost_price' || field === 'selling_price' || field === 'reorder_level'
          ? Math.round(req.body[field])
          : req.body[field]);
        paramIdx++;
      }
    }

    if (updates.length === 0) return fail(res, 'No fields to update');
    params.push(id, req.apiUser.tenant_id);

    try {
      const result = await pool.query(
        `UPDATE inventory SET ${updates.join(', ')} WHERE id = $${paramIdx} AND tenant_id = $${paramIdx + 1} RETURNING *`,
        params
      );
      if (result.rows.length === 0) return fail(res, 'Inventory item not found', 404);

      await audit(req.apiUser.email, 'api_inventory_update', `Updated inventory ID: ${id}`);
      success(res, result.rows[0]);
    } catch (e) {
      if (e.message.includes('unique') && e.message.includes('sku')) return fail(res, 'SKU already exists');
      fail(res, 'Failed to update inventory item');
    }
  }));

  /**
   * POST /api/v1/inventory/:id/adjust
   * Stock adjustment (add or remove stock)
   */
  app.post('/api/v1/inventory/:id/adjust', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid inventory ID');

    const { quantity, reason } = req.body;
    if (typeof quantity !== 'number' || quantity === 0) return fail(res, 'Quantity adjustment must be a non-zero number');

    try {
      const item = await pool.query(
        'SELECT * FROM inventory WHERE id = $1 AND tenant_id = $2', [id, req.apiUser.tenant_id]
      );
      if (item.rows.length === 0) return fail(res, 'Inventory item not found', 404);

      const currentQty = item.rows[0].quantity || 0;
      const newQty = currentQty + quantity;

      if (newQty < 0) return fail(res, 'Insufficient stock. Current quantity: ' + currentQty);

      const result = await pool.query(
        'UPDATE inventory SET quantity = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
        [newQty, id, req.apiUser.tenant_id]
      );

      await audit(req.apiUser.email, 'api_inventory_adjust', `Adjusted inventory ID ${id} (${item.rows[0].name}): ${quantity > 0 ? '+' : ''}${quantity}. Reason: ${reason || 'manual'}`);

      success(res, {
        ...result.rows[0],
        adjustment: quantity,
        previous_quantity: currentQty,
        reason: reason || 'manual adjustment'
      });
    } catch (e) {
      logger.error('[API] POST /inventory/:id/adjust: ' + e.message);
      fail(res, 'Failed to adjust stock');
    }
  }));

  // ─── 8. NOTIFICATIONS API ───────────────────────────────────────────────

  /**
   * GET /api/v1/notifications
   * List user's notifications (paginated)
   */
  app.get('/api/v1/notifications', ah(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;
    const email = req.apiUser.email;

    try {
      // Show notifications for this user specifically, plus tenant-wide ones
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM notifications
         WHERE tenant_id = $1 AND (user_email = $2 OR user_email IS NULL)`,
        [tid, email]
      );
      const total = parseInt(countResult.rows[0].total);

      const dataResult = await pool.query(
        `SELECT * FROM notifications
         WHERE tenant_id = $1 AND (user_email = $2 OR user_email IS NULL)
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [tid, email, limit, offset]
      );

      // Get unread count
      const unreadResult = await pool.query(
        `SELECT COUNT(*) as unread FROM notifications
         WHERE tenant_id = $1 AND (user_email = $2 OR user_email IS NULL) AND read = false`,
        [tid, email]
      );

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /notifications: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/notifications/:id/read
   * Mark a notification as read
   */
  app.put('/api/v1/notifications/:id/read', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid notification ID');

    try {
      const result = await pool.query(
        `UPDATE notifications SET read = true WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, req.apiUser.tenant_id]
      );
      if (result.rows.length === 0) return fail(res, 'Notification not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/notifications/read-all
   * Mark all notifications as read
   */
  app.put('/api/v1/notifications/read-all', ah(async (req, res) => {
    const tid = req.apiUser.tenant_id;
    const email = req.apiUser.email;

    try {
      const result = await pool.query(
        `UPDATE notifications SET read = true
         WHERE tenant_id = $1 AND (user_email = $2 OR user_email IS NULL) AND read = false`,
        [tid, email]
      );

      success(res, { marked_read: result.rowCount });
    } catch (e) {
      logger.error('[API] PUT /notifications/read-all: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  // ─── 9. GENERIC CRUD API ────────────────────────────────────────────────

  /**
   * GET /api/v1/data/:table
   * List records from any valid table (paginated)
   */
  app.get('/api/v1/data/:table', ah(async (req, res) => {
    const table = req.params.table;
    try {
      validateTable(table);
    } catch (e) {
      return fail(res, 'Invalid table name', 400);
    }

    const { page, limit, offset } = getPagination(req.query);
    const tid = req.apiUser.tenant_id;

    // Search filter
    let searchCondition = '';
    let searchParam = null;
    if (req.query.search) {
      searchCondition = ` AND (name ILIKE $2 OR email ILIKE $2 OR title ILIKE $2 OR description ILIKE $2)`;
      searchParam = `%${req.query.search}%`;
    }

    const sortField = sanitizeSortField(req.query.sort_by);
    const sortDir = sanitizeSortDir(req.query.sort_dir);

    try {
      // Check table has tenant_id column
      const hasTenantCol = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'tenant_id' LIMIT 1`,
        [table]
      );

      const tenantFilter = hasTenantCol.rows.length > 0 ? ' WHERE tenant_id = $1' + searchCondition : searchCondition ? ' WHERE 1=1' + searchCondition : '';

      const queryParams = hasTenantCol.rows.length > 0
        ? (searchParam ? [tid, searchParam] : [tid])
        : (searchParam ? [searchParam] : []);

      let paramIdx = queryParams.length + 1;

      const countQuery = `SELECT COUNT(*) as total FROM ${table}${tenantFilter.replace(/ LIMIT.*/, '')}`;
      const countResult = await pool.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      const dataQuery = `SELECT * FROM ${table}${tenantFilter} ORDER BY ${sortField} ${sortDir} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      queryParams.push(limit, offset);

      const dataResult = await pool.query(dataQuery, queryParams);

      res.json(paginatedResponse(dataResult.rows, total, page, limit));
    } catch (e) {
      logger.error('[API] GET /data/' + table + ': ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * POST /api/v1/data/:table
   * Create a record in any valid table
   */
  app.post('/api/v1/data/:table', ah(async (req, res) => {
    const table = req.params.table;
    try {
      validateTable(table);
    } catch (e) {
      return fail(res, 'Invalid table name', 400);
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return fail(res, 'Request body must be a non-empty object');
    }

    // Auto-inject tenant_id
    body.tenant_id = req.apiUser.tenant_id;

    const fields = Object.keys(body);
    const values = Object.values(body);
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');

    try {
      const result = await pool.query(
        `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );

      await audit(req.apiUser.email, 'api_data_create', `Created record in ${table} (ID: ${result.rows[0].id})`);
      success(res, result.rows[0], 201);
    } catch (e) {
      if (e.message.includes('unique')) return fail(res, 'Record with these values already exists');
      if (e.message.includes('column') && e.message.includes('does not exist')) {
        return fail(res, 'Invalid column in request body');
      }
      logger.error('[API] POST /data/' + table + ': ' + e.message);
      fail(res, 'Failed to create record');
    }
  }));

  /**
   * GET /api/v1/data/:table/:id
   * Read a single record from any valid table
   */
  app.get('/api/v1/data/:table/:id', ah(async (req, res) => {
    const table = req.params.table;
    try {
      validateTable(table);
    } catch (e) {
      return fail(res, 'Invalid table name', 400);
    }

    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid record ID');
    const tid = req.apiUser.tenant_id;

    try {
      // Check for tenant_id column
      const hasTenantCol = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id' LIMIT 1`,
        [table]
      );

      const query = hasTenantCol.rows.length > 0
        ? `SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`
        : `SELECT * FROM ${table} WHERE id = $1`;
      const params = hasTenantCol.rows.length > 0 ? [id, tid] : [id];

      const result = await pool.query(query, params);
      if (result.rows.length === 0) return fail(res, 'Record not found', 404);
      success(res, result.rows[0]);
    } catch (e) {
      logger.error('[API] GET /data/' + table + '/:id: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * PUT /api/v1/data/:table/:id
   * Update a record in any valid table
   */
  app.put('/api/v1/data/:table/:id', ah(async (req, res) => {
    const table = req.params.table;
    try {
      validateTable(table);
    } catch (e) {
      return fail(res, 'Invalid table name', 400);
    }

    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid record ID');

    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return fail(res, 'Request body must be a non-empty object');
    }

    // Prevent changing tenant_id
    delete body.tenant_id;
    delete body.id;

    const fields = Object.keys(body);
    const values = Object.values(body);
    const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const tid = req.apiUser.tenant_id;

    try {
      // Check for tenant_id column
      const hasTenantCol = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id' LIMIT 1`,
        [table]
      );

      const tenantFilter = hasTenantCol.rows.length > 0 ? ` AND tenant_id = $${fields.length + 2}` : '';
      const params = hasTenantCol.rows.length > 0 ? [...values, id, tid] : [...values, id];

      const query = `UPDATE ${table} SET ${setClause} WHERE id = $${fields.length + 1}${tenantFilter} RETURNING *`;

      const result = await pool.query(query, params);
      if (result.rows.length === 0) return fail(res, 'Record not found', 404);

      await audit(req.apiUser.email, 'api_data_update', `Updated record in ${table} (ID: ${id})`, body);
      success(res, result.rows[0]);
    } catch (e) {
      if (e.message.includes('column') && e.message.includes('does not exist')) {
        return fail(res, 'Invalid column in request body');
      }
      logger.error('[API] PUT /data/' + table + '/:id: ' + e.message);
      fail(res, 'Failed to update record');
    }
  }));

  // ─── 10. API KEY MANAGEMENT ─────────────────────────────────────────────

  /**
   * POST /api/v1/keys
   * Generate a new API key for the tenant
   */
  app.post('/api/v1/keys', ah(async (req, res) => {
    const { name, scopes } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return fail(res, 'Key name is required');

    // Generate API key: prefix for identification
    const rawKey = `cpk_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const scopesArray = Array.isArray(scopes) ? scopes : ['read', 'write'];

    try {
      const result = await pool.query(
        `INSERT INTO api_keys (tenant_id, key_hash, name, scopes) VALUES ($1, $2, $3, $4) RETURNING id, name, scopes, created_at`,
        [req.apiUser.tenant_id, keyHash, name.trim(), scopesArray]
      );

      await audit(req.apiUser.email, 'api_key_create', `Created API key: ${name}`);

      // Return the raw key only once
      success(res, {
        id: result.rows[0].id,
        name: result.rows[0].name,
        scopes: result.rows[0].scopes,
        key: rawKey,
        created_at: result.rows[0].created_at,
        warning: 'Store this key securely. It will not be shown again.'
      }, 201);
    } catch (e) {
      logger.error('[API] POST /keys: ' + e.message);
      fail(res, 'Failed to generate API key');
    }
  }));

  /**
   * GET /api/v1/keys
   * List tenant's API keys (never returns raw keys)
   */
  app.get('/api/v1/keys', ah(async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, scopes, last_used, created_at FROM api_keys
         WHERE tenant_id = $1 AND revoked IS NOT true
         ORDER BY created_at DESC`,
        [req.apiUser.tenant_id]
      );

      success(res, result.rows);
    } catch (e) {
      logger.error('[API] GET /keys: ' + e.message);
      fail(res, 'Database error', 500);
    }
  }));

  /**
   * DELETE /api/v1/keys/:id
   * Revoke an API key
   */
  app.delete('/api/v1/keys/:id', ah(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid key ID');

    try {
      const result = await pool.query(
        `UPDATE api_keys SET revoked = true WHERE id = $1 AND tenant_id = $2 RETURNING id, name`,
        [id, req.apiUser.tenant_id]
      );

      if (result.rows.length === 0) return fail(res, 'API key not found', 404);

      await audit(req.apiUser.email, 'api_key_revoke', `Revoked API key: ${result.rows[0].name} (ID: ${id})`);

      success(res, { message: 'API key revoked', id: result.rows[0].id, name: result.rows[0].name });
    } catch (e) {
      logger.error('[API] DELETE /keys/:id: ' + e.message);
      fail(res, 'Failed to revoke API key');
    }
  }));

  // ─── GLOBAL ERROR HANDLER FOR API ROUTES ────────────────────────────────

  app.use('/api/v1/', (err, req, res, next) => {
    logger.error('[API] Unhandled error: ' + (err.message || err));
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : (err.message || 'Unknown error')
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DEV PORTAL: API KEY MANAGEMENT — /dev/api-keys
  // ═══════════════════════════════════════════════════════════════════════

  async function migrateDevTables() {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        key_hash TEXT NOT NULL,
        key_prefix VARCHAR(8) NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used TIMESTAMPTZ,
        revoked BOOLEAN DEFAULT false,
        revoked_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true
      )`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)`,
      `CREATE TABLE IF NOT EXISTS webhooks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}'::text[],
        secret TEXT NOT NULL,
        name TEXT,
        is_active BOOLEAN DEFAULT true,
        last_triggered TIMESTAMPTZ,
        total_deliveries INTEGER DEFAULT 0,
        total_failures INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)`,
    ];
    for (const sql of migrations) {
      try { await pool.query(sql); } catch (e) { logger.warn('Dev table migration warning: ' + e.message); }
    }
    logger.info('[API v1] Dev portal tables (api_keys, webhooks) ready');
  }
  migrateDevTables().catch(e => logger.error('[API v1] Dev migration failed: ' + e.message));

  // ── Enhanced Rate Limiting: 100/min per API key, 1000/min per IP ──
  const IP_RATE_LIMIT_MAX = 1000;
  const IP_RATE_LIMIT_WINDOW = 60 * 1000;
  const _ipRateLimits = new Map();

  // Clean up IP rate limits periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _ipRateLimits) {
      if (entry.resetAt <= now) _ipRateLimits.delete(key);
    }
  }, 5 * 60 * 1000);

  function enhancedRateLimit(req, res, next) {
    const now = Date.now();

    // API key rate limit: 100/min
    if (req.tokenType === 'api_key' && req.apiKeyId) {
      let entry = _rateLimits.get('apikey:' + req.apiKeyId);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
        _rateLimits.set('apikey:' + req.apiKeyId, entry);
      }
      entry.count++;
      if (entry.count > RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        res.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
        res.set('X-RateLimit-Remaining', '0');
        return res.status(429).json({ success: false, error: 'API key rate limit exceeded. Try again later.', retryAfter });
      }
      res.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
      res.set('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - entry.count)));
    }

    // IP rate limit: 1000/min
    let ipEntry = _ipRateLimits.get(req.ip);
    if (!ipEntry || ipEntry.resetAt <= now) {
      ipEntry = { count: 0, resetAt: now + IP_RATE_LIMIT_WINDOW };
      _ipRateLimits.set(req.ip, ipEntry);
    }
    ipEntry.count++;
    if (ipEntry.count > IP_RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((ipEntry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ success: false, error: 'IP rate limit exceeded. Try again later.', retryAfter });
    }

    next();
  }

  // Apply enhanced rate limiting to all API v1 routes
  app.use('/api/v1/', enhancedRateLimit);

  // ── GET /dev/api-keys — List API keys (masked) ──
  app.get('/dev/api-keys', ah(async (req, res) => {
    // Auth via JWT or API key with elevated access
    const authHeader = req.headers.authorization;
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
    } else if (req.headers['x-api-key']) {
      const keyHash = hashApiKey(req.headers['x-api-key']);
      const row = (await pool.query('SELECT tenant_id FROM api_keys WHERE key_hash = $1 AND revoked IS NOT true AND is_active = true', [keyHash])).rows[0];
      if (!row) return fail(res, 'Invalid API key', 401);
      tenantId = row.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const keys = (await pool.query(
      `SELECT id, key_prefix, name, created_at, last_used, revoked, revoked_at, expires_at, is_active
       FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId])).rows;
    const masked = keys.map(k => ({
      ...k,
      masked_key: k.key_prefix + '••••••••••••••••••••',
    }));
    success(res, masked);
  }));

  // ── POST /dev/api-keys — Generate new API key ──
  app.post('/dev/api-keys', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null, email = 'api-key-user';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
      email = result.payload.email;
    } else if (req.headers['x-api-key']) {
      const keyHash = hashApiKey(req.headers['x-api-key']);
      const row = (await pool.query('SELECT tenant_id FROM api_keys WHERE key_hash = $1 AND revoked IS NOT true AND is_active = true', [keyHash])).rows[0];
      if (!row) return fail(res, 'Invalid API key', 401);
      tenantId = row.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const { name, expires_in_days } = req.body;
    if (!name || !name.trim()) return fail(res, 'Key name is required');

    // Generate a cryptographically secure API key
    const rawKey = 'cz_' + crypto.randomBytes(32).toString('hex');
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const expiresAt = expires_in_days ? new Date(Date.now() + parseInt(expires_in_days) * 86400000).toISOString() : null;

    try {
      const r = await pool.query(
        `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, key_prefix, name, created_at, expires_at, is_active`,
        [tenantId, keyHash, keyPrefix, name.trim(), expiresAt]);

      await audit(email, 'api_key_created', `Created API key: ${name.trim()}`);

      // Show full key ONLY ONCE
      success(res, {
        id: r.rows[0].id,
        key: rawKey,           // Full key — shown only this once!
        key_prefix: keyPrefix,
        name: name.trim(),
        created_at: r.rows[0].created_at,
        expires_at: r.rows[0].expires_at,
        is_active: r.rows[0].is_active,
        warning: 'Save this API key now. It cannot be shown again.',
      }, 201);
    } catch (e) {
      logger.error('[API] POST /dev/api-keys: ' + e.message);
      fail(res, 'Failed to create API key');
    }
  }));

  // ── DELETE /dev/api-keys/:id — Revoke an API key ──
  app.delete('/dev/api-keys/:id', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    try {
      const id = parseInt(req.params.id);
      if (!isValidId(id)) return fail(res, 'Invalid key ID');

      const result = await pool.query(
        `UPDATE api_keys SET revoked = true, revoked_at = NOW(), is_active = false WHERE id = $1 AND tenant_id = $2 RETURNING id, name`,
        [id, tenantId]
      );

      if (result.rows.length === 0) return fail(res, 'API key not found', 404);
      success(res, { message: 'API key revoked', id: result.rows[0].id, name: result.rows[0].name });
    } catch (e) {
      logger.error('[API] DELETE /dev/api-keys/:id: ' + e.message);
      fail(res, 'Failed to revoke API key');
    }
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // DEV PORTAL: WEBHOOK CONFIGURATION — /dev/webhooks
  // ═══════════════════════════════════════════════════════════════════════
  const VALID_WEBHOOK_EVENTS = [
    'payment.received', 'payment.failed', 'student.enrolled', 'student.withdrawn',
    'order.created', 'order.shipped', 'order.delivered', 'fee.paid', 'fee.overdue',
    'user.created', 'user.deleted', 'invoice.generated', 'attendance.recorded',
  ];

  // ── GET /dev/webhooks — List webhooks ──
  app.get('/dev/webhooks', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
    } else if (req.headers['x-api-key']) {
      const keyHash = hashApiKey(req.headers['x-api-key']);
      const row = (await pool.query('SELECT tenant_id FROM api_keys WHERE key_hash = $1 AND revoked IS NOT true AND is_active = true', [keyHash])).rows[0];
      if (!row) return fail(res, 'Invalid API key', 401);
      tenantId = row.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const webhooks = (await pool.query(
      `SELECT id, name, url, events, is_active, last_triggered, total_deliveries, total_failures, created_at, updated_at
       FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId])).rows;
    success(res, webhooks);
  }));

  // ── POST /dev/webhooks — Create webhook ──
  app.post('/dev/webhooks', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null, email = 'api-key-user';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
      email = result.payload.email;
    } else if (req.headers['x-api-key']) {
      const keyHash = hashApiKey(req.headers['x-api-key']);
      const row = (await pool.query('SELECT tenant_id FROM api_keys WHERE key_hash = $1 AND revoked IS NOT true AND is_active = true', [keyHash])).rows[0];
      if (!row) return fail(res, 'Invalid API key', 401);
      tenantId = row.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const { url, events, name } = req.body;
    if (!url || !url.trim()) return fail(res, 'Webhook URL is required');
    try { new URL(url); } catch { return fail(res, 'Invalid URL format'); }
    if (!Array.isArray(events) || events.length === 0) return fail(res, 'At least one event is required');
    const invalidEvents = events.filter(e => !VALID_WEBHOOK_EVENTS.includes(e));
    if (invalidEvents.length > 0) return fail(res, `Invalid events: ${invalidEvents.join(', ')}. Valid: ${VALID_WEBHOOK_EVENTS.join(', ')}`);

    const secret = crypto.randomBytes(24).toString('hex');

    try {
      const r = await pool.query(
        `INSERT INTO webhooks (tenant_id, url, events, secret, name) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, url, events, created_at`,
        [tenantId, url.trim(), events, secret, (name || '').trim() || 'Untitled Webhook']);

      await audit(email, 'webhook_created', `Created webhook: ${r.rows[0].name} for events: ${events.join(', ')}`);

      success(res, {
        id: r.rows[0].id,
        name: r.rows[0].name,
        url: r.rows[0].url,
        events: r.rows[0].events,
        secret,  // Show secret only on creation
        created_at: r.rows[0].created_at,
        warning: 'Save this signing secret. It cannot be shown again.',
      }, 201);
    } catch (e) {
      logger.error('[API] POST /dev/webhooks: ' + e.message);
      fail(res, 'Failed to create webhook');
    }
  }));

  // ── POST /dev/webhooks/:id/test — Test webhook delivery ──
  app.post('/dev/webhooks/:id/test', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid webhook ID');

    const webhook = (await pool.query(
      'SELECT * FROM webhooks WHERE id = $1 AND tenant_id = $2', [id, tenantId]
    )).rows[0];
    if (!webhook) return fail(res, 'Webhook not found', 404);

    // Send test event using http/https
    const crypto2 = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ event: 'test.ping', timestamp, data: { message: 'Webhook test from Comfort Platform', webhook_id: webhook.id } });
    const signature = crypto2.createHmac('sha256', webhook.secret).update(timestamp + '.' + payload).digest('hex');

    let deliveryResult = 'sent';
    try {
      const http = require('https');
      const url = new URL(webhook.url);
      const mod = url.protocol === 'https:' ? http : require('http');
      await new Promise((resolve, reject) => {
        const req2 = mod.request({
          hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': `t=${timestamp},s1=${signature}`, 'X-Webhook-ID': String(webhook.id), 'X-Webhook-Event': 'test.ping', 'User-Agent': 'Comfort-Platform-Webhooks/1.0' },
          timeout: 10000,
        }, (resp) => { let data = ''; resp.on('data', c => data += c); resp.on('end', () => resolve({ status: resp.statusCode, body: data })); });
        req2.on('error', reject);
        req2.write(payload);
        req2.end();
      });
      await pool.query('UPDATE webhooks SET last_triggered = NOW(), total_deliveries = total_deliveries + 1 WHERE id = $1', [id]);
    } catch (e) {
      deliveryResult = 'failed';
      await pool.query('UPDATE webhooks SET total_failures = total_failures + 1 WHERE id = $1', [id]).catch(() => {});
    }

    success(res, { webhook_id: id, event: 'test.ping', status: deliveryResult, timestamp });
  }));

  // ── DELETE /dev/webhooks/:id — Delete webhook ──
  app.delete('/dev/webhooks/:id', ah(async (req, res) => {
    const authHeader = req.headers.authorization;
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const result = jwtVerify(authHeader.slice(7));
      if (!result.valid) return fail(res, 'Invalid token', 401);
      tenantId = result.payload.tenant_id;
    } else {
      return fail(res, 'Authentication required', 401);
    }

    const id = parseInt(req.params.id);
    if (!isValidId(id)) return fail(res, 'Invalid webhook ID');
    const r = await pool.query('DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2 RETURNING id, name', [id, tenantId]);
    if (!r.rows.length) return fail(res, 'Webhook not found', 404);
    success(res, { message: 'Webhook deleted', id: r.rows[0].id, name: r.rows[0].name });
  }));

  logger.info('[API v1] Comfort Platform REST API initialized');
};
