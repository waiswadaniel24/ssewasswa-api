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

// === ENSURE fee_reminder_settings TABLE EXISTS ===
async function ensureFeeReminderSettingsTable() {
  try {
    await pool.query(`
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
    await pool.query(`ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS trigger_type TEXT`);
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
      WHERE br.auto_notify = true AND t.type = 'school' AND frs.auto_notify = true
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

// === ENSURE digest_schedule TABLE EXISTS ===
async function ensureDigestTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS digest_schedule (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER UNIQUE,
        frequency TEXT DEFAULT 'weekly',
        day_of_week INTEGER DEFAULT 1,
        hour INTEGER DEFAULT 8,
        last_sent TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[Worker] digest_schedule table ready');
  } catch (e) {
    console.error('[Worker] Failed to ensure digest_schedule table:', e.message);
  }
}

// === PROCESS EMAIL DIGESTS ===
async function processDigests() {
  try {
    // Find tenants with active digest schedules
    const schedules = (await pool.query(`
      SELECT ds.*, t.name as tenant_name, t.type as tenant_type
      FROM digest_schedule ds
      JOIN tenants t ON t.id = ds.tenant_id
      WHERE ds.is_active = true
    `)).rows;

    if (schedules.length === 0) return;

    const now = new Date();
    const currentDay = now.getUTCDay(); // 0=Sun, 1=Mon
    const currentHour = now.getUTCHours();

    for (const sched of schedules) {
      // Check if it's time to send based on frequency
      if (sched.last_sent) {
        const elapsed = now - new Date(sched.last_sent).getTime();
        const intervalMs = {
          'daily': 24 * 3600000,
          'weekly': 7 * 24 * 3600000,
          'monthly': 30 * 24 * 3600000
        };
        const required = intervalMs[sched.frequency] || intervalMs['weekly'];
        if (elapsed < required) continue;
      }

      // For weekly, check day of week; for daily, check hour
      if (sched.frequency === 'weekly' && sched.day_of_week !== null && sched.day_of_week !== currentDay) continue;
      if (sched.frequency === 'daily' && sched.hour !== null && Math.abs(sched.hour - currentHour) > 1) continue;

      console.log(`[Digest] Generating digest for tenant ${sched.tenant_name} (${sched.tenant_id}), frequency: ${sched.frequency}`);

      // Gather digest content
      const [newUsers, recentActivity, upcomingEvents, stats] = await Promise.all([
        pool.query(`SELECT email, name, created_at FROM users WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10`, [sched.tenant_id]),
        pool.query(`SELECT action, user_email, details, created_at FROM audit_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 15`, [sched.tenant_id]).catch(() => ({ rows: [] })),
        pool.query(`SELECT title, start_date FROM events WHERE tenant_id = $1 AND start_date >= CURRENT_DATE ORDER BY start_date ASC LIMIT 5`, [sched.tenant_id]).catch(() => ({ rows: [] })),
        pool.query(`
          SELECT
            (SELECT COUNT(*) FROM users WHERE tenant_id = $1) as total_users,
            (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days') as new_this_week,
            (SELECT COUNT(*) FROM students WHERE tenant_id = $1) as total_students
        `, [sched.tenant_id]).catch(() => ({ rows: [{ total_users: 0, new_this_week: 0, total_students: 0 }] }))
      ]).catch(() => [[], [], [], []]);

      const s = (stats.rows && stats.rows[0]) || { total_users: 0, new_this_week: 0, total_students: 0 };

      // Build digest HTML
      const baseUrl = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
      const digestHtml = `
        <div style="max-width:600px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#1e293b">
          <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;border-radius:12px 12px 0 0">
            <h1 style="color:white;margin:0;font-size:24px">Your Weekly Digest</h1>
            <p style="color:rgba(255,255,255,0.9);margin:8px 0 0">${esc(sched.tenant_name)} &mdash; ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
            <!-- Stats -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
              <div style="background:#f0f9ff;padding:16px;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#3b82f6">${s.total_users || 0}</div>
                <div style="font-size:12px;color:#64748b">Total Users</div>
              </div>
              <div style="background:#f0fdf4;padding:16px;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#10b981">${s.new_this_week || 0}</div>
                <div style="font-size:12px;color:#64748b">New This Week</div>
              </div>
              <div style="background:#fef3c7;padding:16px;border-radius:8px;text-align:center">
                <div style="font-size:28px;font-weight:700;color:#f59e0b">${s.total_students || 0}</div>
                <div style="font-size:12px;color:#64748b">${sched.tenant_type === 'school' ? 'Students' : 'Members'}</div>
              </div>
            </div>

            ${newUsers.rows && newUsers.rows.length > 0 ? `
            <!-- New Users -->
            <h2 style="font-size:18px;margin-bottom:12px;color:#1e293b">New Users This Week</h2>
            <div style="margin-bottom:24px">
              ${newUsers.rows.map(u => `
                <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
                  <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:white;font-weight:600;font-size:14px">${(u.name || u.email || '?')[0].toUpperCase()}</div>
                  <div style="margin-left:12px"><div style="font-weight:500">${esc(u.name || 'New User')}</div><div style="font-size:12px;color:#94a3b8">${esc(u.email || '')} &middot; ${new Date(u.created_at).toLocaleDateString()}</div></div>
                </div>
              `).join('')}
            </div>
            ` : ''}

            ${upcomingEvents.rows && upcomingEvents.rows.length > 0 ? `
            <!-- Upcoming Events -->
            <h2 style="font-size:18px;margin-bottom:12px;color:#1e293b">Upcoming Events</h2>
            <div style="margin-bottom:24px">
              ${upcomingEvents.rows.map(ev => `
                <div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
                  <div style="font-weight:500">${esc(ev.title)}</div>
                  <div style="font-size:13px;color:#6366f1;font-weight:500">${new Date(ev.start_date).toLocaleDateString()}</div>
                </div>
              `).join('')}
            </div>
            ` : ''}

            ${recentActivity.rows && recentActivity.rows.length > 0 ? `
            <!-- Recent Activity -->
            <h2 style="font-size:18px;margin-bottom:12px;color:#1e293b">Recent Activity</h2>
            <div style="margin-bottom:24px">
              ${recentActivity.rows.slice(0, 8).map(a => `
                <div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px">
                  <span style="color:#6366f1;font-weight:500">${esc(a.user_email || 'System')}</span>
                  <span style="color:#64748b"> ${esc(a.action || '')}</span>
                  <span style="color:#94a3b8;font-size:12px;margin-left:8px">${new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              `).join('')}
            </div>
            ` : ''}

            <!-- Footer -->
            <div style="text-align:center;padding-top:16px;border-top:1px solid #e2e8f0">
              <p style="font-size:13px;color:#64748b;margin-bottom:12px">Login to your dashboard for more details</p>
              <a href="${baseUrl}/login" style="display:inline-block;background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open Dashboard</a>
            </div>
          </div>
          <div style="text-align:center;padding:16px;font-size:12px;color:#94a3b8">
            <p>Comfort Zone &mdash; All-in-One Management Platform</p>
            <p><a href="${baseUrl}/api/unsubscribe?digest=1" style="color:#94a3b8">Unsubscribe from digests</a></p>
          </div>
        </div>
      `;

      // Find admin users to send digest to
      const admins = (await pool.query(`
        SELECT email FROM users WHERE tenant_id = $1 AND role IN ('admin', 'superadmin') LIMIT 5
      `, [sched.tenant_id])).rows;

      let sentCount = 0;
      for (const admin of admins) {
        try {
          await pool.query(
            `INSERT INTO email_queue(tenant_id, to_email, subject, body, html, status) VALUES($1, $2, $3, $4, true, 'pending')`,
            [sched.tenant_id, admin.email, `[Comfort Zone] Your ${sched.frequency} Digest — ${sched.tenant_name}`, digestHtml]
          );
          sentCount++;
        } catch (e) {
          console.error(`[Digest] Failed to queue digest for ${admin.email}:`, e.message);
        }
      }

      // Update last_sent
      await pool.query('UPDATE digest_schedule SET last_sent = NOW() WHERE tenant_id = $1', [sched.tenant_id]);
      console.log(`[Digest] Queued digest for ${sched.tenant_name}: ${sentCount} admin(s) notified`);
    }
  } catch (e) {
    console.error('[Digest] Error processing digests:', e.message);
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
  await ensureDigestTable();

  // Process immediately on start
  await processEmails();
  await processFeeReminders();
  await processDigests();

  // Poll every 30 seconds
  setInterval(processEmails, 30000);

  // Process fee reminders every hour
  setInterval(processFeeReminders, 3600000);

  // Process email digests every 6 hours (checks schedule before sending)
  setInterval(processDigests, 6 * 3600000);

  // Cleanup old emails every hour
  setInterval(cleanupOldEmails, 3600000);

  console.log('[Worker] Email worker started (polling every 30s, fee reminders every hour, digests every 6h)');
})();
