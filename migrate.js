const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const c = await pool.connect();
  try {
    console.log('Running v9.0 migrations...');
    const migrations = [
      `CREATE TABLE IF NOT EXISTS "sessions" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL) WITH (OIDS=FALSE)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "sessions_pkey" ON "sessions" ("sid")`,
      `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire")`,
      `CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, key_hash TEXT UNIQUE, name TEXT, scopes TEXT[], last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS webhook_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, event TEXT, payload JSONB, status INTEGER, response TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`
    ];
    for (const q of migrations) {
      try { await c.query(q); } catch (e) { console.warn('Skip:', e.message); }
    }
    console.log('Migrations complete');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    c.release();
    process.exit();
  }
}

migrate();
