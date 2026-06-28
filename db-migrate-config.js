/**
 * node-pg-migrate configuration — ssewasswa-api
 *
 * Used by `npm run migrate` (which runs `node-pg-migrate up`).
 * node-pg-migrate picks up this file automatically because it's named
 * `db-migrate-config.js` at the repo root (the default config file name).
 *
 * The DATABASE_URL env var is bound by Render's `fromDatabase` directive
 * in render.yaml — see that file for the source of the value.
 *
 * Migrations live in `./migrations/`. Each file is a CommonJS module that
 * exports `{ up: (pgm) => {...}, down: (pgm) => {...} }`.
 *
 * Migration state is tracked in the `pgmigrations` table inside the app DB.
 */

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  verbose: !!process.env.MIGRATE_VERBOSE,
};
