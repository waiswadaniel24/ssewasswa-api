import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const c = await pool.connect();
  try {
    console.log('Running v9.0 migrations...');
    
    // Add Redis session support
    await c.query(`CREATE TABLE IF NOT EXISTS "sessions" ("sid" varchar NOT NULL COLLATE "default", "sess" json NOT NULL, "expire" timestamp(6) NOT NULL) WITH (OIDS=FALSE);`);
    await c.query(`ALTER TABLE "sessions" ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;`);
    await c.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" ("expire");`);
    
    // v9.0: Add API keys table
    await c.query(`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY, tenant_id INT, key_hash TEXT UNIQUE, name TEXT, scopes TEXT[], last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`);
    
    // v9.0: Add webhook logs
    await c.query(`CREATE TABLE IF NOT EXISTS webhook_logs (id SERIAL PRIMARY KEY, tenant_id INT, event TEXT, payload JSONB, status INT, response TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    
    // v9.0: Add student photos
    await c.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await c.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`);
    
    // v9.0: Add tenant branding
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
    await c.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`);
    
    console.log('✅ Migrations complete');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    c.release();
    process.exit();
  }
}

migrate();
