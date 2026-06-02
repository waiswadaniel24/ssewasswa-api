require('dotenv').config();
const { createPool } = require('./db');
const nodemailer = require('nodemailer');

// === DATABASE CONNECTION ===
const pool = createPool(undefined, { max: 5 }); // Worker uses smaller pool (5 connections)

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
    await migrateQuery(pool, 'Worker', `
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
    await migrateQuery(pool, 'Worker', `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html BOOLEAN DEFAULT false`);
    await migrateQuery(pool, 'Worker', `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`);
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

// === ENSURE fee_reminder_settings TABLE EXISTS ===
async function ensureFeeReminderSettingsTable() {
  try {
    await migrateQuery(pool, 'Worker', `
      CREATE TABLE IF NOT EXISTS fee_reminder_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER UNIQUE,
        auto_notify BOOLEAN DEFAULT false,
        frequency TEXT DEFAULT 'weekly',
        days_before INTEGER DEFAULT 7,
        enabled_channels TEXT[] DEFAULT '{sms,email}',
        last_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Ensure sms_logs has trigger_type column
    await migrateQuery(pool, 'Worker', `ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS trigger_type TEXT`);
    console.log('[Worker] fee_reminder_settings table ready');
  } catch (e) {
    console.error('[Worker] Failed to ensure fee_reminder_settings table:', e.message);
  }
}

// === PROCESS AUTOMATED FEE REMINDERS ===
async function processFeeReminders() {
  try {
    // Find tenants with auto_notify enabled on bill_reminders
    const tenants = (await pool.query(`
      SELECT DISTINCT t.id, t.name, t.type, frs.frequency, frs.days_before, frs.enabled_channels, frs.last_run
      FROM tenants t
      JOIN bill_reminders br ON br.tenant_id = t.id
      JOIN fee_reminder_settings frs ON frs.tenant_id = t.id
      WHERE br.auto_notify = true AND t.type = 'school' AND frs.auto_notify = true)
    `)).rows;

    if (tenants.length === 0) return;

    console.log(`[FeeReminder] Found ${tenants.length} tenant(s) with auto fee reminders enabled`);

    for (const tenant of tenants) {
      // Check if enough time has passed since last run based on frequency
      if (tenant.last_run) {
        const elapsed = Date.now() - new Date(tenant.last_run).getTime();
        const intervalMs = {
          'daily': 24 * 3600000,
          'weekly': 7 * 24 * 3600000,
          'monthly': 30 * 24 * 3600000
        };
        const required = intervalMs[tenant.frequency] || intervalMs['weekly'];
        if (elapsed < required) {
          console.log(`[FeeReminder] Skipping tenant ${tenant.name} (${tenant.id}): last run too recent for ${tenant.frequency} frequency`);
          continue;
        }
      }

      // Find fees with outstanding balances
      const fees = (await pool.query(`
        SELECT f.*, s.name as student_name, s.admission_no, s.guardian_phone, s.parent_email
        FROM fees f
        JOIN students s ON f.student_id = s.id
        WHERE f.tenant_id = $1 AND (f.amount - f.paid) > 0
        ORDER BY f.amount - f.paid DESC
        LIMIT 50
      `, [tenant.id])).rows;

      if (fees.length === 0) continue;

      let smsCount = 0;
      let emailCount = 0;
      const channels = tenant.enabled_channels || ['sms', 'email'];

      for (const fee of fees) {
        const balance = parseInt(fee.amount) - parseInt(fee.paid);
        const balanceStr = balance.toLocaleString();
        const smsMessage = `Fee reminder: ${fee.student_name} has an outstanding balance of UGX ${balanceStr}. Please clear the balance. - Comfort`;
        const emailSubject = `Fee Balance Reminder - ${fee.student_name}`;
        const emailBody = `<p>Dear Parent/Guardian,</p><p>This is a reminder that <strong>${fee.student_name}</strong> (Adm#: ${fee.admission_no || 'N/A'}) has an outstanding fee balance of <strong>UGX ${balanceStr}</strong>.</p><p>Please clear the balance at your earliest convenience.</p><p>Thank you,<br>Comfort School Management</p>`;

        // Queue SMS
        if (channels.includes('sms') && fee.guardian_phone) {
          try {
            await pool.query(
              `INSERT INTO sms_logs(tenant_id, phone, message, status, trigger_type) VALUES($1, $2, $3, 'queued', 'fee_reminder_auto')`,
              [tenant.id, fee.guardian_phone, smsMessage]
            );
            smsCount++;
          } catch (e) {
            console.error(`[FeeReminder] Failed to queue SMS for ${fee.student_name}:`, e.message);
          }
        }

        // Queue Email
        if (channels.includes('email') && fee.parent_email) {
          try {
            await pool.query(
              `INSERT INTO email_queue(tenant_id, to_email, subject, body, html, status) VALUES($1, $2, $3, $4, true, 'pending')`,
              [tenant.id, fee.parent_email, emailSubject, emailBody]
            );
            emailCount++;
          } catch (e) {
            console.error(`[FeeReminder] Failed to queue email for ${fee.student_name}:`, e.message);
          }
        }
      }

      // Update last_run timestamp
      await pool.query(
        `UPDATE fee_reminder_settings SET last_run = NOW(), updated_at = NOW() WHERE tenant_id = $1`,
        [tenant.id]
      );

      console.log(`[FeeReminder] Tenant ${tenant.name} (${tenant.id}): queued ${smsCount} SMS + ${emailCount} email reminders for ${fees.length} outstanding fees`);
    }
  } catch (e) {
    console.error('[FeeReminder] Error processing fee reminders:', e.message);
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
  await ensureFeeReminderSettingsTable();

  // Process immediately on start
  await processEmails();
  await processFeeReminders();

  // Poll every 30 seconds
  setInterval(processEmails, 30000);

  // Process fee reminders every hour
  setInterval(processFeeReminders, 3600000);

  // Cleanup old emails every hour
  setInterval(cleanupOldEmails, 3600000);

  console.log('[Worker] Email worker started (polling every 30s, fee reminders every hour)');
})();
