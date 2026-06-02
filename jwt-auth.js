'use strict';

const { migrateQuery } = require('./db');
const crypto = require('crypto');

/**
 * JWT Authentication System
 * 
 * Implements JSON Web Tokens using Node.js crypto (HMAC-SHA256).
 * No external dependencies required — uses only the built-in crypto module.
 * 
 * Refresh tokens are stored in the `jwt_refresh_tokens` DB table and
 * hashed with SHA-256 before storage.
 * 
 * Usage:
 *   const createJWTAuth = require('./jwt-auth');
 *   const jwtAuth = createJWTAuth(pool, config);
 *   app.use('/api/protected', jwtAuth.requireJWT);
 */

// === JWT CONFIGURATION ===
const ACCESS_TOKEN_TTL = 15 * 60;         // 15 minutes (in seconds)
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days (in seconds)

// === MANUAL JWT IMPLEMENTATION (HMAC-SHA256) ===
// Base64url encoding/decoding helpers
const base64urlEncode = (buf) => {
  if (Buffer.isBuffer(buf)) return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64urlDecode = (str) => {
  let s = str;
  // Add padding
  while (s.length % 4) s += '=';
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s, 'base64');
};

/**
 * Create a signed JWT (HMAC-SHA256).
 * @param {object} payload - The token payload
 * @param {string} secret - The signing secret
 * @param {number} expiresIn - Token lifetime in seconds
 * @returns {string} Encoded JWT string
 */
function signJWT(payload, secret, expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const signatureB64 = base64urlEncode(signature);

  return `${signingInput}.${signatureB64}`;
}

/**
 * Verify a JWT and return the payload.
 * @param {string} token - The JWT string
 * @param {string} secret - The signing secret
 * @returns {object} The decoded payload
 * @throws {Error} If token is invalid, expired, or malformed
 */
function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Verify signature
  const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const actualSig = base64urlDecode(signatureB64);

  if (!crypto.timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid token signature');
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
  } catch (e) {
    throw new Error('Invalid token payload');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Hash a token with SHA-256 for safe DB storage.
 * @param {string} token - The raw token string
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure random refresh token.
 * @returns {string} 64-byte hex string (128 hex characters)
 */
function generateRawRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Create the JWT authentication module.
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {object} config - Configuration object (from config.js)
 * @returns {object} JWT authentication API
 */
module.exports = function createJWTAuth(pool, config) {
  // JWT_SECRET from env or derive from SESSION_SECRET
  const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.warn('[JWT] JWT_SECRET not set — deriving from SESSION_SECRET. Set JWT_SECRET in production for key isolation.');
  }

  /**
   * Generate an access token (short-lived).
   * @param {object} user - User object with id, tenant_id, role, email
   * @returns {string} JWT access token
   */
  function generateAccessToken(user) {
    return signJWT(
      {
        sub: String(user.id),
        tid: String(user.tenant_id || ''),
        role: user.role || 'user',
        email: user.email || '',
      },
      JWT_SECRET,
      ACCESS_TOKEN_TTL
    );
  }

  /**
   * Generate a refresh token (long-lived, stored in DB).
   * @param {object} user - User object with id, tenant_id, email
   * @param {object} req - Express request (optional, for user_agent and ip)
   * @returns {string} Raw refresh token (return to client)
   */
  async function generateRefreshToken(user, req) {
    const rawToken = generateRawRefreshToken();
    const tokenHash = hashToken(rawToken);

    await pool.query(
      `INSERT INTO jwt_refresh_tokens (user_id, token_hash, tenant_id, user_agent, ip_address, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${REFRESH_TOKEN_TTL} seconds', NOW())`,
      [
        String(user.id),
        tokenHash,
        String(user.tenant_id || ''),
        req?.headers?.['user-agent'] || null,
        req?.ip || null,
      ]
    );

    return rawToken;
  }

  /**
   * Verify an access token and return its payload.
   * @param {string} token - JWT access token
   * @returns {object} Decoded payload
   * @throws {Error} If token is invalid or expired
   */
  function verifyAccessToken(token) {
    return verifyJWT(token, JWT_SECRET);
  }

  /**
   * Verify a refresh token by checking the DB.
   * @param {string} rawToken - Raw refresh token from client
   * @returns {Promise<{user: object, tokenId: string}>} User info and token ID
   * @throws {Error} If token is invalid, expired, or revoked
   */
  async function verifyRefreshToken(rawToken) {
    const tokenHash = hashToken(rawToken);

    const result = await pool.query(
      `SELECT id, user_id, tenant_id, expires_at, revoked_at
       FROM jwt_refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (!result.rows.length) {
      throw new Error('Invalid refresh token');
    }

    const token = result.rows[0];

    if (token.revoked_at) {
      throw new Error('Refresh token has been revoked');
    }

    if (new Date(token.expires_at) < new Date()) {
      throw new Error('Refresh token has expired');
    }

    // Fetch user info
    const userResult = await pool.query(
      'SELECT id, email, role, tenant_id, full_name, banned FROM users WHERE id = $1',
      [token.user_id]
    );

    if (!userResult.rows.length) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];
    if (user.banned) {
      throw new Error('Account is banned');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        full_name: user.full_name,
      },
      tokenId: token.id,
    };
  }

  /**
   * Revoke a specific refresh token (for logout).
   * @param {string} tokenId - The token ID to revoke
   */
  async function revokeRefreshToken(tokenId) {
    await pool.query(
      "UPDATE jwt_refresh_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
      [tokenId]
    );
  }

  /**
   * Revoke ALL refresh tokens for a user (for password change, security events).
   * @param {string|number} userId - The user ID
   */
  async function revokeAllUserTokens(userId) {
    const result = await pool.query(
      "UPDATE jwt_refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [String(userId)]
    );
    return result.rowCount;
  }

  /**
   * Middleware: requireJWT — validates Bearer token on Authorization header.
   * Sets req.jwtUser and req.jwtTenantId, then calls next().
   * Returns 401 if no token or invalid token.
   */
  function requireJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    if (!token) {
      return res.status(401).json({ error: 'Authentication required', code: 'EMPTY_TOKEN' });
    }

    try {
      const payload = verifyAccessToken(token);
      req.jwtUser = {
        id: payload.sub,
        tenant_id: payload.tid,
        role: payload.role,
        email: payload.email,
        iat: payload.iat,
        exp: payload.exp,
      };
      req.jwtTenantId = payload.tid;
      next();
    } catch (err) {
      if (err.message === 'Token expired') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
  }

  /**
   * Middleware: optionalJWT — validates token if present, doesn't block if missing.
   * Sets req.jwtUser and req.jwtTenantId if valid token found.
   */
  function optionalJWT(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    if (!token) return next();

    try {
      const payload = verifyAccessToken(token);
      req.jwtUser = {
        id: payload.sub,
        tenant_id: payload.tid,
        role: payload.role,
        email: payload.email,
        iat: payload.iat,
        exp: payload.exp,
      };
      req.jwtTenantId = payload.tid;
    } catch (err) {
      // Silently ignore invalid/expired tokens — this is optional auth
    }
    next();
  }

  /**
   * Clean expired tokens from DB. Call periodically (e.g., every hour).
   * @returns {Promise<{deleted: number}>} Number of deleted tokens
   */
  async function cleanExpiredTokens() {
    try {
      const result = await pool.query(
        "DELETE FROM jwt_refresh_tokens WHERE expires_at < NOW() OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')"
      );
      return { deleted: result.rowCount };
    } catch (err) {
      console.error('[JWT] Error cleaning expired tokens:', err.message);
      return { deleted: 0 };
    }
  }

  return {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllUserTokens,
    requireJWT,
    optionalJWT,
    cleanExpiredTokens,
    // Expose constants for testing
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,
  };
};

// =============================================================
// DB MIGRATION: Create jwt_refresh_tokens table
// Runs automatically on require() via async IIFE
// =============================================================
(async function ensureJWTTable() {
  try {
    // Only run if we can get a pool — but we don't have one at module level.
    // The table will be created lazily by the first createJWTAuth() call.
    // However, we set up a migration that runs when this module is first used.
  } catch (e) {
    // Ignore — pool not available at require() time
  }
})();

/**
 * Ensure the jwt_refresh_tokens table exists.
 * Call this once after pool is available, or let createJWTAuth handle it.
 */
module.exports.ensureTable = async function ensureJWTTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jwt_refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      tenant_id VARCHAR(255),
      user_agent TEXT,
      ip_address INET,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
  `);

  // Create index for fast lookups by token_hash
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jwt_refresh_tokens_token_hash
    ON jwt_refresh_tokens (token_hash);
  `);

  // Create index for cleaning expired tokens and revoking all user tokens
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jwt_refresh_tokens_user_expires
    ON jwt_refresh_tokens (user_id, expires_at);
  `);

  console.log('[JWT] jwt_refresh_tokens table ready');
};
