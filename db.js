/**
 * Shared Database Pool Configuration — ssewasswa-api
 *
 * Single source of truth for PostgreSQL connection pool settings.
 * All entry points (server.js, worker.js, migrate.js) MUST use this module
 * to prevent configuration drift and connection pool exhaustion.
 *
 * Key design decisions:
 * - max: 25 connections (Render free PostgreSQL allows ~97 total;
 *   25 leaves headroom for worker.js, migrate.js, and ad-hoc queries)
 * - connectionTimeoutMillis: 90000 (90s — startup migrations can be slow
 *   when 50+ modules compete for connections; retry logic helps)
 * - idleTimeoutMillis: 20000 (release idle connections after 20s to free pool)
 * - SSL: always rejectUnauthorized:false (Render/Neon use self-signed certs)
 * - Retry logic: auto-retry on connection timeout with exponential backoff
 */

const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL, overrides = {}) {
  // Strip sslmode from URL to prevent pg deprecation warning
  // ("sslmode=require is treated as alias for verify-full").
  // We set ssl config explicitly below, so the URL param is redundant.
  if (connectionString) {
    connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');
  }
  const config = {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 25,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 90000,
    allowExitOnIdle: false,
  };

  // Apply overrides (e.g., worker.js might want a smaller pool)
  Object.assign(config, overrides);

  const pool = new Pool(config);

  // Handle pool-level errors to prevent crashes
  pool.on('error', (err) => {
    console.error('[DB Pool] Unexpected error on idle client:', err.message);
  });

  return pool;
}

/**
 * Execute a query with automatic retry on connection timeout.
 * Use this for startup migrations where transient pool exhaustion is expected.
 *
 * @param {Pool} pool - The pg Pool instance
 * @param {string} sql - SQL query
 * @param {any[]} params - Query parameters
 * @param {object} opts - Options: { maxRetries: 3, baseDelay: 1000, module: 'unknown' }
 * @returns {Promise<QueryResult>}
 */
async function queryWithRetry(pool, sql, params = [], opts = {}) {
  const maxRetries = opts.maxRetries || 3;
  const baseDelay = opts.baseDelay || 1000;
  const moduleName = opts.module || 'unknown';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      const isTimeout = err.message && (
        err.message.includes('timeout exceeded') ||
        err.message.includes('connection refused') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('remaining connection slots are reserved') ||
        err.message.includes('too many clients') ||
        err.message.includes('cannot acquire a client')
      );

      if (!isTimeout || attempt > maxRetries) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`[DB Retry] ${moduleName} attempt ${attempt}/${maxRetries} failed (${err.message}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Run a migration (one or more SQL statements) with retry logic.
 * Designed for module startup migrations that may fail due to pool exhaustion.
 *
 * @param {Pool} pool - The pg Pool instance
 * @param {string} moduleName - Name for logging
 * @param {string} sql - Migration SQL (can contain multiple statements)
 * @param {object} opts - Options: { maxRetries: 3, baseDelay: 1500, useClient: false }
 * @returns {Promise<void>}
 */
async function runMigration(pool, moduleName, sql, opts = {}) {
  const maxRetries = opts.maxRetries || 3;
  const baseDelay = opts.baseDelay || 1500;
  const useClient = opts.useClient || false;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const client = useClient ? await pool.connect() : null;
    try {
      if (client) {
        await client.query(sql);
      } else {
        await pool.query(sql);
      }
      console.log(`[DB Migration] ✓ ${moduleName}`);
      return;
    } catch (err) {
      const isRetryable = err.message && (
        err.message.includes('timeout exceeded') ||
        err.message.includes('connection refused') ||
        err.message.includes('remaining connection slots') ||
        err.message.includes('too many clients') ||
        err.message.includes('cannot acquire a client') ||
        err.message.includes('ECONNREFUSED')
      );

      if (!isRetryable || attempt > maxRetries) {
        console.warn(`[DB Migration] ✗ ${moduleName}: ${err.message}`);
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 1000);
      console.warn(`[DB Migration] ⟳ ${moduleName} attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      if (client) client.release();
    }
  }
}

/**
 * Stagger module migrations to prevent pool exhaustion.
 * Instead of all modules running migrations simultaneously, this helper
 * adds a small random delay before each migration to spread the load.
 *
 * Usage in modules:
 *   const { staggerMigration } = require('./db');
 *   staggerMigration(() => {
 *     pool.query('CREATE TABLE IF NOT EXISTS ...').then(() => console.log('done'));
 *   });
 *
 * @param {Function} fn - The migration function to run
 * @param {number} maxDelay - Maximum random delay in ms (default: 5000)
 */
function staggerMigration(fn, maxDelay = 5000) {
  const delay = Math.floor(Math.random() * maxDelay);
  setTimeout(fn, delay);
}

module.exports = { createPool, Pool, queryWithRetry, runMigration, staggerMigration };
