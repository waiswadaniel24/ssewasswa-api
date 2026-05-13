require('dotenv').config();
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// === DATABASE CONNECTION ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === EMAIL TRANSPORTER (Gmail) ===
let _transporter = null;
const getTransporter = () => {
  if (_transporter) return _transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.warn('[Worker] GMAIL_USER and/or GMAIL_PASS not set. Emails will not be sent.');
    return null;
  }
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    pool: true,
    maxConnections: 5,
    rateLimit: true,
    rateDelta: 6000  // ~10 emails per minute for Gmail rate limiting
  });
  return _transporter;
};

// === ENSURE email_queue TABLE EXISTS ===
async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        html BOOLEAN DEFAULT false,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        sent_at TIMESTAMPTZ
      )
    `);
    // Add columns if they don't exist (for existing deployments)
    await pool.query(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`);
    console.log('[Worker] email_queue table ready');
  } catch (e) {
    console.error('[Worker] Failed to ensure email_queue table:', e.message);
  }
}

// === PROCESS PENDING EMAILS ===
async function processEmails() {
  const transporter = getTransporter();
  if (!transporter) return;

  let emails;
  try {
    // Get pending emails with fewer than 3 attempts, limit 5 per batch
    emails = await pool.query(
      "SELECT * FROM email_queue WHERE status = 'pending' AND attempts < 3 ORDER BY created_at ASC LIMIT 5"
    );
  } catch (e) {
    console.error('[Worker] Failed to query email_queue:', e.message);
    return;
  }

  if (emails.rows.length === 0) return;

  console.log(`[Email] Processing ${emails.rows.length} pending email(s)`);

  for (const email of emails.rows) {
    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: email.to_email,
        subject: email.subject,
        html: email.html ? email.body : undefined,
        text: email.html ? undefined : email.body
      });

      await pool.query(
        "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1",
        [email.id]
      );
      console.log(`[Email] ✓ Sent to ${email.to_email}: ${email.subject}`);
    } catch (e) {
      await pool.query(
        "UPDATE email_queue SET attempts = attempts + 1, error = $1, status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'pending' END WHERE id = $2",
        [e.message, email.id]
      );
      console.error(`[Email] ✗ Failed to ${email.to_email}: ${e.message}`);
    }
  }
}

// === CLEANUP OLD SENT EMAILS (keep 7 days) ===
async function cleanupOldEmails() {
  try {
    const result = await pool.query(
      "DELETE FROM email_queue WHERE status IN ('sent', 'failed') AND created_at < NOW() - INTERVAL '7 days'"
    );
    if (result.rowCount > 0) {
      console.log(`[Worker] Cleaned up ${result.rowCount} old email record(s)`);
    }
  } catch (e) {
    console.error('[Worker] Cleanup error:', e.message);
  }
}

// === GRACEFUL SHUTDOWN ===
process.on('SIGINT', async () => {
  console.log('\n[Worker] Shutting down...');
  await pool.end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('\n[Worker] Shutting down...');
  await pool.end();
  process.exit(0);
});

// === START WORKER ===
(async () => {
  await ensureTable();

  // Process immediately on start
  await processEmails();

  // Poll every 30 seconds
  setInterval(processEmails, 30000);

  // Cleanup old emails every hour
  setInterval(cleanupOldEmails, 3600000);

  console.log('[Worker] Email worker started (polling every 30s)');
})();
