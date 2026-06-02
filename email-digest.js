// ============================================================
// === EMAIL DIGEST SYSTEM — Weekly/Monthly Summary Emails ===
// ============================================================
// Sends digest emails with key metrics: attendance, fees collected,
// donations, new members, tasks due, etc. Keeps users engaged.

const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, ah, esc, renderPage, audit, notify, sendEmail, logger) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const DIGEST_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS email_digest_prefs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      frequency TEXT DEFAULT 'weekly',
      day_of_week INTEGER DEFAULT 1,
      include_attendance BOOLEAN DEFAULT true,
      include_fees BOOLEAN DEFAULT true,
      include_donations BOOLEAN DEFAULT true,
      include_tasks BOOLEAN DEFAULT true,
      include_members BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS email_digest_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      digest_type TEXT NOT NULL,
      subject TEXT,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      opened BOOLEAN DEFAULT false,
      clicked BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS email_digest_queue (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      digest_type TEXT DEFAULT 'weekly',
      status TEXT DEFAULT 'pending',
      scheduled_for TIMESTAMPTZ,
      attempts INTEGER DEFAULT 0,
      last_attempt TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  if (typeof migrations !== 'undefined') DIGEST_MIGRATIONS.forEach(m => migrations.push(m));
  if (typeof VALID_TABLES !== 'undefined') ['email_digest_prefs', 'email_digest_log', 'email_digest_queue'].forEach(t => VALID_TABLES.add(t));

  // Auto-run migrations
  (async () => {
    for (const m of DIGEST_MIGRATIONS) {
      try { await pool.query(m); } catch (e) {
        if (!e.message.includes('already exists')) logger.warn('[Digest] Migration warning:', e.message);
      }
    }
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  async function generateDigestData(tenantId, period = 'weekly') {
    const interval = period === 'monthly' ? "INTERVAL '30 days'" : "INTERVAL '7 days'";
    const results = {};

    try {
      // Attendance stats
      results.attendance = (await pool.query(
        `SELECT COUNT(*) as total_records, COUNT(*) FILTER (WHERE status = 'present') as present,
         COUNT(*) FILTER (WHERE status = 'absent') as absent
         FROM attendance WHERE tenant_id = $1 AND date >= NOW() - ${interval}`,
        [tenantId]
      )).rows[0];

      // Fees collected
      results.fees = (await pool.query(
        `SELECT COALESCE(SUM(paid), 0) as total_collected, COUNT(*) as payments_count
         FROM fees WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}`,
        [tenantId]
      )).rows[0];

      // Donations
      results.donations = (await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total_donations, COUNT(*) as donation_count
         FROM donations WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}`,
        [tenantId]
      )).rows[0];

      // New members
      results.members = (await pool.query(
        `SELECT COUNT(*) as new_members FROM members WHERE tenant_id = $1 AND created_at >= NOW() - ${interval}`,
        [tenantId]
      )).rows[0];

      // Tasks due
      results.tasks = (await pool.query(
        `SELECT COUNT(*) as total_tasks, COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
         COUNT(*) FILTER (WHERE status != 'completed' AND due_date < NOW()) as overdue_tasks
         FROM org_tasks WHERE tenant_id = $1`,
        [tenantId]
      )).rows[0];

      // Events upcoming
      results.events = (await pool.query(
        `SELECT COUNT(*) as upcoming FROM events WHERE tenant_id = $1 AND start_date >= NOW()`,
        [tenantId]
      )).rows[0];
    } catch (e) {
      logger.warn('[Digest] Data gen error:', e.message);
    }

    return results;
  }

  function formatDigestEmail(data, tenantName, period) {
    const periodLabel = period === 'monthly' ? 'Monthly' : 'Weekly';
    const att = data.attendance || {};
    const fees = data.fees || {};
    const dons = data.donations || {};
    const mems = data.members || {};
    const tasks = data.tasks || {};
    const events = data.events || {};

    const present = parseInt(att.present || 0);
    const total = parseInt(att.total_records || 1);
    const attRate = total > 0 ? Math.round(present / total * 100) : 0;

    return `
    <div style="max-width:600px;margin:0 auto;font-family:system-ui,sans-serif;color:#1e293b">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;border-radius:16px 16px 0 0;text-align:center">
        <h1 style="color:white;font-size:24px;margin:0">${periodLabel} Digest</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">${esc(tenantName)} — ${new Date().toLocaleDateString()}</p>
      </div>
      <div style="background:white;padding:24px;border:1px solid #e2e8f0">

        ${parseInt(att.total_records || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#6366f1;font-size:16px">📊 Attendance</h3>
          <p style="font-size:14px">${attRate}% attendance rate (${present}/${total} records)</p>
          <div style="background:#f1f5f9;border-radius:8px;height:8px;margin-top:8px"><div style="background:#6366f1;height:100%;border-radius:8px;width:${attRate}%"></div></div>
        </div>` : ''}

        ${parseInt(fees.total_collected || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#10b981;font-size:16px">💰 Fees Collected</h3>
          <p style="font-size:24px;font-weight:700;color:#10b981">UGX ${Number(fees.total_collected).toLocaleString()}</p>
          <p style="font-size:13px;color:#64748b">${fees.payments_count || 0} payment(s) this period</p>
        </div>` : ''}

        ${parseInt(dons.total_donations || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#f59e0b;font-size:16px">❤️ Donations</h3>
          <p style="font-size:24px;font-weight:700;color:#f59e0b">UGX ${Number(dons.total_donations).toLocaleString()}</p>
          <p style="font-size:13px;color:#64748b">${dons.donation_count || 0} donation(s) this period</p>
        </div>` : ''}

        ${parseInt(mems.new_members || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#8b5cf6;font-size:16px">👥 New Members</h3>
          <p style="font-size:20px;font-weight:700">${mems.new_members} new member(s) joined</p>
        </div>` : ''}

        ${parseInt(tasks.total_tasks || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#ef4444;font-size:16px">📋 Tasks</h3>
          <p style="font-size:14px">${tasks.completed_tasks || 0}/${tasks.total_tasks || 0} completed · <span style="color:#ef4444">${tasks.overdue_tasks || 0} overdue</span></p>
        </div>` : ''}

        ${parseInt(events.upcoming || 0) > 0 ? `
        <div style="margin-bottom:20px">
          <h3 style="color:#3b82f6;font-size:16px">📅 Upcoming Events</h3>
          <p style="font-size:14px">${events.upcoming} upcoming event(s)</p>
        </div>` : ''}

        <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0">
          <a href="${BASE_URL}/dashboard" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Go to Dashboard</a>
        </div>
      </div>
      <div style="background:#f8fafc;padding:16px;border-radius:0 0 16px 16px;text-align:center;font-size:12px;color:#94a3b8">
        <p>You're receiving this because you enabled ${periodLabel} digest emails.</p>
        <a href="${BASE_URL}/settings/digest" style="color:#6366f1">Manage digest preferences</a>
      </div>
    </div>`;
  }

  // ============================================================
  // ROUTES
  // ============================================================

  // Digest Preferences Page
  app.get('/settings/digest', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    let prefs = (await pool.query('SELECT * FROM email_digest_prefs WHERE tenant_id = $1 AND user_email = $2', [u.tenant_id, u.email])).rows[0];

    res.send(renderPage('Email Digest Settings', `
      <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Email Digest</h1><p>Stay updated with a weekly or monthly summary of your organization's activity</p></div>
      <div style="max-width:600px;margin:0 auto">
        <div class="card">
          <form method="POST" action="/settings/digest">
            <div style="display:grid;gap:16px">
              <div>
                <label style="font-weight:600;display:block;margin-bottom:4px">Frequency</label>
                <select name="frequency" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">
                  <option value="weekly" ${prefs?.frequency === 'weekly' ? 'selected' : ''}>Weekly (Every Monday)</option>
                  <option value="biweekly" ${prefs?.frequency === 'biweekly' ? 'selected' : ''}>Every 2 Weeks</option>
                  <option value="monthly" ${prefs?.frequency === 'monthly' ? 'selected' : ''}>Monthly (1st of each month)</option>
                  <option value="daily" ${prefs?.frequency === 'daily' ? 'selected' : ''}>Daily</option>
                </select>
              </div>
              <div>
                <label style="font-weight:600;display:block;margin-bottom:8px">Include in digest:</label>
                <div style="display:grid;gap:8px">
                  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="include_attendance" value="1" ${!prefs || prefs.include_attendance ? 'checked' : ''}> Attendance summary</label>
                  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="include_fees" value="1" ${!prefs || prefs.include_fees ? 'checked' : ''}> Fees & payments</label>
                  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="include_donations" value="1" ${!prefs || prefs.include_donations ? 'checked' : ''}> Donations</label>
                  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="include_tasks" value="1" ${!prefs || prefs.include_tasks ? 'checked' : ''}> Tasks & deadlines</label>
                  <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="include_members" value="1" ${!prefs || prefs.include_members ? 'checked' : ''}> New members</label>
                </div>
              </div>
              <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_active" value="1" ${!prefs || prefs.is_active ? 'checked' : ''}> Enable email digest</label>
              <button type="submit" class="btn" style="background:#6366f1;padding:12px">Save Preferences</button>
            </div>
          </form>
        </div>
      </div>
    `, u));
  }));

  // Save digest preferences
  app.post('/settings/digest', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const { frequency, include_attendance, include_fees, include_donations, include_tasks, include_members, is_active } = req.body;

    await pool.query(`
      INSERT INTO email_digest_prefs (tenant_id, user_email, frequency, include_attendance, include_fees, include_donations, include_tasks, include_members, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (tenant_id, user_email) DO UPDATE SET
        frequency = $3, include_attendance = $4, include_fees = $5, include_donations = $6,
        include_tasks = $7, include_members = $8, is_active = $9`,
      [u.tenant_id, u.email, frequency || 'weekly',
       include_attendance === '1', include_fees === '1', include_donations === '1',
       include_tasks === '1', include_members === '1', is_active === '1']
    );
    audit(u.email, 'digest_prefs_updated', `Frequency: ${frequency}`);
    res.redirect('/settings/digest');
  }));

  // Preview digest email
  app.get('/digest/preview', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const tenant = (await pool.query('SELECT name FROM tenants WHERE id = $1', [u.tenant_id])).rows[0];
    const data = await generateDigestData(u.tenant_id, 'weekly');
    const html = formatDigestEmail(data, tenant?.name || 'Your Organization', 'weekly');
    res.send(html);
  }));

  // API: Send digest now (manual trigger)
  app.post('/api/digest/send', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const prefs = (await pool.query('SELECT * FROM email_digest_prefs WHERE tenant_id = $1 AND user_email = $2 AND is_active = true', [u.tenant_id, u.email])).rows[0];
    if (!prefs) return res.json({ success: false, error: 'Digest not enabled' });

    const tenant = (await pool.query('SELECT name FROM tenants WHERE id = $1', [u.tenant_id])).rows[0];
    const data = await generateDigestData(u.tenant_id, prefs.frequency);
    const html = formatDigestEmail(data, tenant?.name || 'Your Organization', prefs.frequency);
    const periodLabel = prefs.frequency === 'monthly' ? 'Monthly' : 'Weekly';

    const sent = await sendEmail(u.email, `${periodLabel} Digest — ${tenant?.name || 'Comfort Zone'}`, html);

    if (sent) {
      await pool.query('INSERT INTO email_digest_log (tenant_id, user_email, digest_type, subject) VALUES ($1, $2, $3, $4)',
        [u.tenant_id, u.email, prefs.frequency, `${periodLabel} Digest`]);
    }

    res.json({ success: sent });
  }));

  // Cron: Process digest queue (called by worker)
  app.post('/api/digest/process-queue', ah(async (req, res) => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
    const dayOfMonth = now.getDate();

    // Get all users who should receive a digest today
    const weeklies = dayOfWeek === 1 ? (await pool.query("SELECT * FROM email_digest_prefs WHERE is_active = true AND frequency = 'weekly'")).rows : [];
    const monthlies = dayOfMonth === 1 ? (await pool.query("SELECT * FROM email_digest_prefs WHERE is_active = true AND frequency = 'monthly'")).rows : [];
    const dailies = (await pool.query("SELECT * FROM email_digest_prefs WHERE is_active = true AND frequency = 'daily'")).rows;
    const biweeklies = dayOfWeek === 1 && now.getDate() <= 7 ? (await pool.query("SELECT * FROM email_digest_prefs WHERE is_active = true AND frequency = 'biweekly'")).rows : [];

    const allRecipients = [...weeklies, ...monthlies, ...dailies, ...biweeklies];
    let sent = 0;

    for (const pref of allRecipients) {
      try {
        // Check if we already sent one recently
        const recent = (await pool.query(
          "SELECT id FROM email_digest_log WHERE user_email = $1 AND digest_type = $2 AND sent_at >= NOW() - INTERVAL '12 hours'",
          [pref.user_email, pref.frequency]
        )).rows[0];
        if (recent) continue;

        const tenant = (await pool.query('SELECT name FROM tenants WHERE id = $1', [pref.tenant_id])).rows[0];
        const data = await generateDigestData(pref.tenant_id, pref.frequency);
        const html = formatDigestEmail(data, tenant?.name || 'Your Organization', pref.frequency);
        const periodLabel = pref.frequency === 'monthly' ? 'Monthly' : pref.frequency === 'daily' ? 'Daily' : 'Weekly';

        const didSend = await sendEmail(pref.user_email, `${periodLabel} Digest — ${tenant?.name || 'Comfort Zone'}`, html);
        if (didSend) {
          await pool.query('INSERT INTO email_digest_log (tenant_id, user_email, digest_type, subject) VALUES ($1, $2, $3, $4)',
            [pref.tenant_id, pref.user_email, pref.frequency, `${periodLabel} Digest`]);
          sent++;
        }
      } catch (e) {
        logger.warn('[Digest] Send error:', e.message);
      }
    }

    logger.info(`[Digest] Processed queue: ${sent}/${allRecipients.length} sent`);
    res.json({ processed: allRecipients.length, sent });
  }));

  console.log('[Digest] LOADED: Email digest preferences, preview, queue processing, cron endpoint');
};
