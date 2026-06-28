require('dotenv').config();
const { createPool, migrateQuery } = require('./db');
const nodemailer = require('nodemailer');
// === Automated daily DB backups (Gap 4) ===
// node-cron drives the 2 AM UTC daily backup schedule. The backup module
// shells out to `pg_dump`/`pg_restore` (PostgreSQL client binaries) —
// see src/lib/backup.js for the constraint that Render web services do
// NOT ship these by default; either run worker.js on a host with
// postgresql-client installed, or deploy a Render Background Worker with
// a custom Docker image that includes the client tools.
const cron = require('node-cron');
const backup = require('./src/lib/backup');

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

// === DAILY DATABASE BACKUP (Gap 4) ===
// Runs at 2 AM UTC every day. The flow is:
//   1. runBackup()     — pg_dump → gzip → tmp file → INSERT row in backups table
//   2. uploadBackup()  — upload tmp file to Cloudinary (or local-only fallback)
//   3. UPDATE row      — set url, provider, status='uploaded'
//   4. (on 1st of month) — flag the row as is_monthly_snapshot=true so the
//      prune step below doesn't delete it (long-term point-in-time recovery)
//   5. pruneOldBackups() — delete backups older than BACKUP_RETENTION_DAYS,
//      skipping monthly snapshots
//
// All errors are caught and logged — a backup failure must NOT crash the
// worker (the email queue + fee reminders still need to run). An alert
// should be wired in here later (e.g. Sentry captureException, or an email
// to the platform admin) so silent backup failures don't go unnoticed.
async function runDailyBackup() {
  console.log('[Cron] Daily backup starting at', new Date().toISOString());
  try {
    const { backupId, localPath, sizeBytes } = await backup.runBackup(pool);
    const { url, provider } = await backup.uploadBackup(localPath, backupId);
    await pool.query(
      'UPDATE backups SET url = $1, provider = $2, status = $3 WHERE backup_id = $4',
      [url, provider, provider === 'local' ? 'local' : 'uploaded', backupId]
    );

    // On the 1st of each month, flag this backup as a monthly snapshot.
    // Monthly snapshots are exempt from the retention-prune below — we keep
    // ~12 of them at any time (one per month) for long-term recovery.
    if (new Date().getDate() === 1) {
      await pool.query(
        'UPDATE backups SET is_monthly_snapshot = true WHERE backup_id = $1',
        [backupId]
      );
      console.log(`[Cron] Backup ${backupId} flagged as monthly snapshot`);
    }

    console.log(`[Cron] Daily backup complete: ${backupId} (${sizeBytes} bytes, ${provider})`);

    // Prune old backups AFTER the new one is safely uploaded. If the prune
    // fails we still have today's backup; if it succeeds we've cleaned up
    // the dailies that are older than BACKUP_RETENTION_DAYS.
    await backup.pruneOldBackups(pool);
  } catch (e) {
    console.error('[Cron] Daily backup failed:', e.message);
    // TODO: wire an alert (Sentry / email) here so silent backup failures
    // are surfaced. Without an alert, a missing pg_dump binary or a
    // Cloudinary outage would manifest only as missing rows in the
    // backups table — easy to miss until a restore is needed.
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

  // Ensure the backups table exists before the first cron tick fires —
  // runBackup() has its own fallback (ensureBackupsTable) but doing it here
  // means the table is ready by the time the cron callback runs.
  try {
    await backup.ensureBackupsTable(pool);
    console.log('[Worker] backups table ready');
  } catch (e) {
    console.error('[Worker] Failed to ensure backups table:', e.message);
    // Non-fatal: runBackup will retry table creation on first invocation.
  }

  // Process immediately on start
  await processEmails();
  await processFeeReminders();

  // Poll every 30 seconds
  setInterval(processEmails, 30000);

  // Process fee reminders every hour
  setInterval(processFeeReminders, 3600000);

  // Cleanup old emails every hour
  setInterval(cleanupOldEmails, 3600000);

  // === Daily backup schedule (Gap 4) ===
  // 0 2 * * * = 02:00 UTC every day. 2 AM is a low-traffic window for the
  // platform's target market (East African schools — local time 5 AM EAT).
  // The cron expression is validated by node-cron at schedule time and will
  // throw if malformed (caught by the surrounding try at module load — but
  // a malformed literal like this one will throw synchronously at require
  // time, so we wrap it defensively).
  try {
    cron.schedule('0 2 * * *', runDailyBackup, {
      timezone: 'UTC',
    });
    console.log('[Worker] Daily backup cron scheduled for 02:00 UTC');
  } catch (e) {
    console.error('[Worker] Failed to schedule daily backup cron:', e.message);
  }

  console.log('[Worker] Email worker started (polling every 30s, fee reminders every hour)');
})();
