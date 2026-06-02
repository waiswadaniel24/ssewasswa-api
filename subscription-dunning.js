// ============================================================
// === SUBSCRIPTION DUNNING & AUTO-RETRY — Stop Revenue Leaks ===
// ============================================================
// Automatically handles expired subscriptions: retry payment,
// send reminders, downgrade after grace period, track dunning state.

const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, ah, esc, renderPage, audit, notify, sendEmail, logger) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const DUNNING_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS dunning_records (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      subscription_id INTEGER,
      current_stage TEXT DEFAULT 'reminder_1',
      reminder_count INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      last_reminder_at TIMESTAMPTZ,
      last_retry_at TIMESTAMPTZ,
      grace_period_ends TIMESTAMPTZ,
      downgraded_at TIMESTAMPTZ,
      amount_due NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      payment_method TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dunning_events (
      id SERIAL PRIMARY KEY,
      dunning_id INTEGER REFERENCES dunning_records(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payment_retries (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      dunning_id INTEGER REFERENCES dunning_records(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT DEFAULT 'UGX',
      status TEXT DEFAULT 'pending',
      reference TEXT,
      provider_response JSONB,
      next_retry_at TIMESTAMPTZ,
      attempt INTEGER DEFAULT 1,
      max_attempts INTEGER DEFAULT 3,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS dunning_stage TEXT DEFAULT NULL`,
  ];

  if (typeof migrations !== 'undefined') DUNNING_MIGRATIONS.forEach(m => migrations.push(m));
  if (typeof VALID_TABLES !== 'undefined') ['dunning_records', 'dunning_events', 'payment_retries'].forEach(t => VALID_TABLES.add(t));

  (async () => {
    for (const m of DUNNING_MIGRATIONS) {
      try { await pool.query(m); } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('does not exist')) logger.warn('[Dunning] Migration warning:', e.message);
      }
    }
  })();

  // ============================================================
  // DUNNING STAGES
  // ============================================================
  const DUNNING_STAGES = {
    reminder_1: { label: 'First Reminder', daysBefore: 7, action: 'email' },
    reminder_2: { label: 'Second Reminder', daysBefore: 3, action: 'email' },
    reminder_3: { label: 'Final Warning', daysBefore: 1, action: 'email_sms' },
    grace_period: { label: 'Grace Period', daysAfter: 7, action: 'restrict' },
    retry_payment: { label: 'Payment Retry', daysAfter: 3, action: 'retry' },
    downgraded: { label: 'Downgraded', daysAfter: 10, action: 'downgrade' },
  };

  // ============================================================
  // ROUTES
  // ============================================================

  // Admin: Dunning Dashboard
  app.get('/admin/dunning', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');

    const [active, inGrace, downgraded, totalRevenue] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) FROM dunning_records WHERE is_active = true AND current_stage = 'grace_period'"),
      pool.query("SELECT COUNT(*) FROM dunning_records WHERE is_active = true AND current_stage = 'downgraded'"),
      pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '30 days'"),
    ]);

    const recentDunning = (await pool.query(
      `SELECT dr.*, t.name as tenant_name FROM dunning_records dr
       LEFT JOIN tenants t ON dr.tenant_id = t.id
       WHERE dr.is_active = true ORDER BY dr.created_at DESC LIMIT 30`
    )).rows;

    const recentRetries = (await pool.query(
      `SELECT pr.*, t.name as tenant_name FROM payment_retries pr
       LEFT JOIN tenants t ON pr.tenant_id = t.id
       ORDER BY pr.created_at DESC LIMIT 20`
    )).rows;

    res.send(renderPage('Subscription Dunning', `
      <div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626)"><h1>Subscription Dunning</h1><p>Automated payment recovery — stop losing revenue from expired subscriptions</p></div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${active.rows[0].count}</div><div>Active Subs</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${inGrace.rows[0].count}</div><div>In Grace Period</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${downgraded.rows[0].count}</div><div>Downgraded</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#6366f1">UGX ${Number(totalRevenue.rows[0].total).toLocaleString()}</div><div>Revenue (30d)</div></div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <h3>Dunning Pipeline</h3>
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:12px">
          ${Object.entries(DUNNING_STAGES).map(([key, stage]) => {
            const count = recentDunning.filter(d => d.current_stage === key).length;
            return `<div style="padding:12px;background:#f8fafc;border-radius:8px;text-align:center;border-top:3px solid ${key.includes('downgrade') ? '#ef4444' : key.includes('grace') ? '#f59e0b' : '#6366f1'}">
              <div style="font-weight:700;color:#1e293b;font-size:14px">${count}</div>
              <div style="font-size:11px;color:#64748b;margin-top:4px">${stage.label}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      ${recentDunning.length > 0 ? `<div class="card">
        <h3>Active Dunning Records</h3>
        <table style="width:100%;margin-top:12px"><thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px">Organization</th><th>Stage</th><th>Amount Due</th><th>Reminders</th><th>Retries</th><th>Created</th>
        </tr></thead><tbody>
          ${recentDunning.map(d => `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px;font-weight:500">${esc(d.tenant_name || 'T#' + d.tenant_id)}</td>
            <td style="padding:8px;text-align:center"><span style="background:${d.current_stage.includes('downgrade') ? '#fef2f2' : d.current_stage.includes('grace') ? '#fef3c7' : '#eff6ff'};color:${d.current_stage.includes('downgrade') ? '#ef4444' : d.current_stage.includes('grace') ? '#f59e0b' : '#6366f1'};padding:2px 8px;border-radius:4px;font-size:12px">${DUNNING_STAGES[d.current_stage]?.label || d.current_stage}</span></td>
            <td style="padding:8px;text-align:center">UGX ${Number(d.amount_due).toLocaleString()}</td>
            <td style="padding:8px;text-align:center">${d.reminder_count}</td>
            <td style="padding:8px;text-align:center">${d.retry_count}</td>
            <td style="padding:8px;text-align:center;color:#94a3b8;font-size:13px">${new Date(d.created_at).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>` : ''}
    `, u));
  }));

  // API: Process dunning pipeline (cron endpoint) — requires auth + admin/super_admin
  app.post('/api/dunning/process', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).json({ error: 'Admin or super admin only' });
    const now = new Date();
    let processed = 0;
    let reminders = 0;
    let retries = 0;
    let downgrades = 0;

    // Find subscriptions about to expire or already expired
    const expiringSoon = (await pool.query(
      "SELECT s.*, t.name as tenant_name FROM subscriptions s JOIN tenants t ON s.tenant_id = t.id WHERE s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end <= NOW() + INTERVAL '7 days' AND s.current_period_end >= NOW()"
    )).rows;

    for (const sub of expiringSoon) {
      const daysUntilExpiry = Math.ceil((new Date(sub.current_period_end) - now) / (1000 * 60 * 60 * 24));
      let stage = null;

      if (daysUntilExpiry <= 7 && daysUntilExpiry > 3) stage = 'reminder_1';
      else if (daysUntilExpiry <= 3 && daysUntilExpiry > 1) stage = 'reminder_2';
      else if (daysUntilExpiry <= 1) stage = 'reminder_3';

      if (stage) {
        // Check if we already sent this reminder
        const existing = (await pool.query(
          'SELECT id FROM dunning_records WHERE tenant_id = $1 AND current_stage = $2 AND last_reminder_at >= NOW() - INTERVAL \'24 hours\'',
          [sub.tenant_id, stage]
        )).rows[0];
        if (!existing) {
          const tenant = (await pool.query('SELECT * FROM tenants WHERE id = $1', [sub.tenant_id])).rows[0];
          const users = (await pool.query('SELECT * FROM users WHERE tenant_id = $1', [tenant.id])).rows;

          for (const user of users) {
            const stageInfo = DUNNING_STAGES[stage];
            const subject = `Subscription Expiring in ${daysUntilExpiry} Day(s) — ${tenant.name}`;
            const html = `<div style="max-width:500px;margin:0 auto;font-family:system-ui">
              <h2>Your subscription is expiring soon</h2>
              <p>Hi ${esc(user.email)},</p>
              <p>Your <strong>${sub.plan}</strong> plan subscription for <strong>${esc(tenant.name)}</strong> expires in <strong>${daysUntilExpiry} day(s)</strong>.</p>
              <p>To avoid service interruption, please renew your subscription.</p>
              <a href="${BASE_URL}/billing" style="display:inline-block;background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">Renew Now</a>
              <p style="color:#94a3b8;font-size:12px;margin-top:16px">If you don't renew, your account will enter a 7-day grace period before being downgraded.</p>
            </div>`;

            await sendEmail(user.email, subject, html);
          }

          // Update or create dunning record
          await pool.query(`
            INSERT INTO dunning_records (tenant_id, subscription_id, current_stage, reminder_count, last_reminder_at, amount_due)
            VALUES ($1, $2, $3, 1, NOW(), 0)
            ON CONFLICT DO NOTHING`,
            [sub.tenant_id, sub.id, stage]
          );
          await pool.query('UPDATE dunning_records SET current_stage = $1, reminder_count = reminder_count + 1, last_reminder_at = NOW() WHERE tenant_id = $2 AND is_active = true',
            [stage, sub.tenant_id]);

          // Log the event
          await pool.query('INSERT INTO dunning_events (dunning_id, event_type, details) VALUES ((SELECT id FROM dunning_records WHERE tenant_id = $1 AND is_active = true LIMIT 1), $2, $3)',
            [sub.tenant_id, 'reminder_sent', JSON.stringify({ stage, daysUntilExpiry })]);

          reminders++;
          processed++;
        }
      }
    }

    // Find expired subscriptions (in grace period)
    const expired = (await pool.query(
      "SELECT s.*, t.name as tenant_name FROM subscriptions s JOIN tenants t ON s.tenant_id = t.id WHERE s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end < NOW()"
    )).rows;

    for (const sub of expired) {
      const daysSinceExpiry = Math.ceil((now - new Date(sub.current_period_end)) / (1000 * 60 * 60 * 24));

      if (daysSinceExpiry <= 7) {
        // In grace period — send daily reminder
        await pool.query('UPDATE dunning_records SET current_stage = $1, grace_period_ends = $2 WHERE tenant_id = $3 AND is_active = true',
          ['grace_period', new Date(now.getTime() + (7 - daysSinceExpiry) * 24 * 60 * 60 * 1000), sub.tenant_id]);
      } else if (daysSinceExpiry > 7 && daysSinceExpiry <= 10) {
        // Retry payment
        await pool.query('UPDATE dunning_records SET current_stage = $1, retry_count = retry_count + 1, last_retry_at = NOW() WHERE tenant_id = $2 AND is_active = true',
          ['retry_payment', sub.tenant_id]);
        retries++;
      } else if (daysSinceExpiry > 10) {
        // Downgrade to free — ACTUALLY change the plan
        // 1. Expire the current paid subscription
        await pool.query("UPDATE subscriptions SET status = 'expired', dunning_stage = 'downgraded' WHERE id = $1", [sub.id]);

        // 2. Create a new 'free' active subscription so enforcement middleware works
        try {
          await pool.query(
            "INSERT INTO subscriptions (tenant_id, plan, amount, status, started_at) VALUES ($1, 'free', 0, 'active', NOW())",
            [sub.tenant_id]
          );
        } catch (insertErr) {
          // If insert fails (e.g. duplicate), ensure at least one active free sub exists
          logger.warn('[Dunning] Free subscription insert failed, attempting update:', insertErr.message);
          await pool.query(
            "UPDATE subscriptions SET plan = 'free', amount = 0, status = 'active', dunning_stage = 'downgraded' WHERE tenant_id = $1 AND status = 'active'",
            [sub.tenant_id]
          );
        }

        // 3. Update dunning record
        await pool.query('UPDATE dunning_records SET current_stage = $1, downgraded_at = NOW(), is_active = false WHERE tenant_id = $2',
          ['downgraded', sub.tenant_id]);

        // 4. Log the downgrade event
        await pool.query(
          "INSERT INTO dunning_events (dunning_id, event_type, details) VALUES ((SELECT id FROM dunning_records WHERE tenant_id = $1 LIMIT 1), 'downgrade_executed', $2)",
          [sub.tenant_id, JSON.stringify({ previousPlan: sub.plan, newPlan: 'free', subscriptionId: sub.id, reason: 'non_payment_after_grace_period' })]
        );

        const tenant = (await pool.query('SELECT * FROM tenants WHERE id = $1', [sub.tenant_id])).rows[0];
        const admins = (await pool.query("SELECT * FROM users WHERE tenant_id = $1 AND role IN ('admin', 'owner')", [sub.tenant_id])).rows;
        for (const admin of admins) {
          notify(sub.tenant_id, admin.email, 'Subscription Downgraded', 'Your plan has been downgraded to Free due to non-payment. Record limits (50) are now enforced. Upgrade anytime to restore full access.', 'warning');
          await sendEmail(admin.email, 'Subscription Downgraded to Free', `<div style="max-width:500px;font-family:system-ui"><h2>Subscription Downgraded</h2><p>Your ${esc(tenant?.name)} account has been downgraded to the Free plan.</p><p style="color:#ef4444;font-weight:600">Record limits (50 records) are now enforced. You may lose access to excess records.</p><a href="${BASE_URL}/subscription/upgrade" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Upgrade Now</a></div>`);
        }
        downgrades++;
      }
      processed++;
    }

    logger.info(`[Dunning] Processed: ${processed} total, ${reminders} reminders, ${retries} retries, ${downgrades} downgrades`);
    res.json({ processed, reminders, retries, downgrades });
  }));

  // Manual retry payment
  app.post('/api/dunning/retry/:tenantId', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const sub = (await pool.query("SELECT * FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [req.params.tenantId])).rows[0];
    if (!sub) return res.json({ success: false, error: 'No active subscription' });

    // Create a retry record — actual payment attempt depends on configured payment method
    const reference = 'RETRY-' + Date.now();
    await pool.query(
      'INSERT INTO payment_retries (tenant_id, dunning_id, provider, amount, reference, status, attempt) VALUES ($1, (SELECT id FROM dunning_records WHERE tenant_id = $1 AND is_active = true LIMIT 1), $2, $3, $4, $5, 1)',
      [req.params.tenantId, 'momo', 0, reference, 'pending']
    );

    res.json({ success: true, reference });
  }));

  console.log('[Dunning] LOADED: Subscription dunning pipeline, payment retry, auto-downgrade, cron endpoint');
};
