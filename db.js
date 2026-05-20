/**
 * Shared Database Pool Configuration — ssewasswa-api
 *
 * Single source of truth for PostgreSQL connection pool settings.
 * All entry points (server.js, worker.js, migrate.js) MUST use this module
 * to prevent configuration drift and connection pool exhaustion.
 *
 * Key design decisions:
 * - max: 20 connections (Render free PostgreSQL allows ~97 total;
 *   20 leaves headroom for worker.js, migrate.js, and ad-hoc queries)
 * - connectionTimeoutMillis: 60000 (60s — startup migrations can be slow
 *   when 50+ modules compete for connections)
 * - idleTimeoutMillis: 30000 (release idle connections after 30s)
 * - SSL: always rejectUnauthorized:false (Render/Neon use self-signed certs)
 */

const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL, overrides = {}) {
  const config = {
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 60000,
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

module.exports = { createPool, Pool };
