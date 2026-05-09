require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running standalone migrations (server.js handles most)...');

    // Only migrations that server.js might NOT handle
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_email TEXT`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_css TEXT`);

    // Fix audit_logs column if needed
    try {
      await client.query(`ALTER TABLE audit_logs RENAME COLUMN user TO user_email`);
    } catch (e) { /* column already named correctly */ }

    console.log('Standalone migrations complete');
  } catch (e) {
    console.error('Migration failed:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
