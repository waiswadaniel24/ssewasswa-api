// ============================================================
// === USAGE-BASED METERING — Charge for SMS, API, Storage ===
// ============================================================
// Tracks usage per tenant, enforces limits, generates overage
// charges, and provides a usage dashboard.

const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, ah, esc, renderPage, audit, notify, sendEmail, logger) {
  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const USAGE_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS usage_meters (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      metric_type TEXT NOT NULL,
      current_value INTEGER DEFAULT 0,
      limit_value INTEGER DEFAULT 0,
      period_start DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE)::date,
      period_end DATE DEFAULT (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::date,
      overage_count INTEGER DEFAULT 0,
      overage_charged NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, metric_type, period_start)
    )`,
    `CREATE TABLE IF NOT EXISTS usage_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      metric_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      description TEXT,
      reference_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS usage_overage_rates (
      id SERIAL PRIMARY KEY,
      metric_type TEXT UNIQUE NOT NULL,
      unit_name TEXT NOT NULL,
      free_limit INTEGER DEFAULT 0,
      basic_limit INTEGER DEFAULT 0,
      pro_limit INTEGER DEFAULT 0,
      enterprise_limit INTEGER DEFAULT 0,
      overage_rate_ugx NUMERIC DEFAULT 0,
      overage_rate_usd NUMERIC DEFAULT 0,
      description TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  if (typeof migrations !== 'undefined') USAGE_MIGRATIONS.forEach(m => migrations.push(m));
  if (typeof VALID_TABLES !== 'undefined') ['usage_meters', 'usage_events', 'usage_overage_rates'].forEach(t => VALID_TABLES.add(t));

  (async () => {
    for (const m of USAGE_MIGRATIONS) {
      try { await migrateQuery(pool, 'Usage', m); } catch (e) {
        if (!e.message.includes('already exists')) logger.warn('[Usage] Migration warning:', e.message);
      }
    }
    // Seed overage rates
    const rates = [
      { metric: 'sms_sent', unit: 'SMS', free: 10, basic: 100, pro: 1000, enterprise: 10000, rate_ugx: 50, rate_usd: 0.013, desc: 'SMS messages sent via Africa\'s Talking' },
      { metric: 'api_calls', unit: 'API Call', free: 500, basic: 5000, pro: 50000, enterprise: 500000, rate_ugx: 5, rate_usd: 0.001, desc: 'REST API requests (v1 endpoints)' },
      { metric: 'storage_mb', unit: 'MB', free: 50, basic: 500, pro: 5000, enterprise: 50000, rate_ugx: 100, rate_usd: 0.026, desc: 'File storage (documents, images, attachments)' },
      { metric: 'emails_sent', unit: 'Email', free: 50, basic: 500, pro: 5000, enterprise: 50000, rate_ugx: 20, rate_usd: 0.005, desc: 'Emails sent via digest, notifications, campaigns' },
      { metric: 'records', unit: 'Record', free: 50, basic: 500, pro: 50000, enterprise: 500000, rate_ugx: 10, rate_usd: 0.003, desc: 'Database records (students, members, etc.)' },
    ];
    for (const r of rates) {
      await migrateQuery(pool, 'Usage', `INSERT INTO usage_overage_rates (metric_type, unit_name, free_limit, basic_limit, pro_limit, enterprise_limit, overage_rate_ugx, overage_rate_usd, description)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [r.metric, r.unit, r.free, r.basic, r.pro, r.enterprise, r.rate_ugx, r.rate_usd, r.desc]);
    }
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  async function getPlan(tenantId) {
    const sub = (await pool.query("SELECT plan FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1", [tenantId])).rows[0];
    return sub?.plan || 'free';
  }

  async function trackUsage(tenantId, metricType, quantity = 1, description = '', referenceId = '') {
    const plan = await getPlan(tenantId);
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Record the event
    await pool.query('INSERT INTO usage_events (tenant_id, metric_type, quantity, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
      [tenantId, metricType, quantity, description, referenceId]);

    // Update the meter
    const meter = (await pool.query(
      'SELECT * FROM usage_meters WHERE tenant_id = $1 AND metric_type = $2 AND period_start = $3',
      [tenantId, metricType, periodStart.toISOString().split('T')[0]]
    )).rows[0];

    if (!meter) {
      // Get the limit for this plan
      const rate = (await pool.query('SELECT * FROM usage_overage_rates WHERE metric_type = $1', [metricType])).rows[0];
      const planLimit = rate ? (rate[plan + '_limit'] || rate.free_limit) : 0;

      await pool.query(
        'INSERT INTO usage_meters (tenant_id, metric_type, current_value, limit_value, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [tenantId, metricType, quantity, planLimit, periodStart.toISOString().split('T')[0], periodEnd.toISOString().split('T')[0]]
      );
    } else {
      await pool.query('UPDATE usage_meters SET current_value = current_value + $1 WHERE id = $2', [quantity, meter.id]);

      // Check for overage
      if (meter.current_value + quantity > meter.limit_value && meter.limit_value > 0) {
        const overage = (meter.current_value + quantity) - meter.limit_value;
        const rate = (await pool.query('SELECT * FROM usage_overage_rates WHERE metric_type = $1', [metricType])).rows[0];
        if (rate) {
          const chargeUGX = overage * Number(rate.overage_rate_ugx);
          await pool.query('UPDATE usage_meters SET overage_count = $1, overage_charged = $2 WHERE id = $3',
            [overage, chargeUGX, meter.id]);

          // Notify admin about overage
          if (overage === quantity || overage % 10 === 0) {
            notify(tenantId, null, 'Usage Limit Exceeded', `Your ${metricType} usage has exceeded the plan limit. Overage charges: UGX ${chargeUGX.toLocaleString()}`, 'warning');
          }
        }
      }
    }
  }

  // ============================================================
  // AUTH HELPER: Require session or valid API key
  // ============================================================
  async function requireAuthOrApiKey(req, res, next) {
    // 1. Check session-based auth
    if (req.session?.user) {
      return next();
    }
    // 2. Check API key header
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'Authentication required. Log in or provide a valid X-API-Key header.' });
    }
    try {
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const row = (await pool.query(
        'SELECT ak.*, t.id as tenant_id FROM api_keys ak JOIN tenants t ON ak.tenant_id = t.id WHERE ak.key_hash = $1 AND ak.revoked IS NOT true',
        [keyHash]
      )).rows[0];
      if (!row) {
        return res.status(401).json({ error: 'Invalid or revoked API key' });
      }
      // Attach API key info to request
      req.apiUser = { tenant_id: row.tenant_id, email: row.name || 'api_key', role: 'api_key' };
      req.apiKeyId = row.id;
      // Update last_used timestamp (fire-and-forget)
      pool.query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [row.id]).catch(() => {});
      next();
    } catch (e) {
      logger.warn('[Usage] API key auth error:', e.message);
      return res.status(401).json({ error: 'API key authentication failed' });
    }
  }

  // ============================================================
  // ROUTES
  // ============================================================

  // Usage Dashboard
  app.get('/usage', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const plan = await getPlan(u.tenant_id);
    const rates = (await pool.query('SELECT * FROM usage_overage_rates ORDER BY metric_type')).rows;

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const meters = (await pool.query(
      'SELECT um.*, uor.unit_name, uor.overage_rate_ugx FROM usage_meters um LEFT JOIN usage_overage_rates uor ON um.metric_type = uor.metric_type WHERE um.tenant_id = $1 AND um.period_start = $2',
      [u.tenant_id, periodStart]
    )).rows;

    const recentEvents = (await pool.query(
      'SELECT * FROM usage_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30',
      [u.tenant_id]
    )).rows;

    const totalOverage = meters.reduce((s, m) => s + Number(m.overage_charged || 0), 0);

    res.send(renderPage('Usage & Billing', `
      <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">
        <h1>Usage & Metering</h1>
        <p>Track your usage across SMS, API calls, storage, and emails — <span style="color:#f59e0b;font-weight:700">${plan.toUpperCase()}</span> plan</p>
      </div>

      ${totalOverage > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;padding:16px;border-radius:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
        <div><strong style="color:#ef4444">Overage Charges This Month:</strong> UGX ${Number(totalOverage).toLocaleString()}</div>
        <a href="/billing" class="btn" style="background:#ef4444;font-size:13px">Pay Now</a>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:24px">
        ${rates.map(r => {
          const meter = meters.find(m => m.metric_type === r.metric_type);
          const current = meter ? meter.current_value : 0;
          const limit = r[plan + '_limit'] || r.free_limit;
          const pct = limit > 0 ? Math.min(Math.round(current / limit * 100), 100) : 0;
          const overLimit = current > limit && limit > 0;
          const barColor = overLimit ? '#ef4444' : pct > 80 ? '#f59e0b' : '#10b981';
          return `<div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <h3 style="font-size:14px">${esc(r.unit_name)}</h3>
              <span style="background:${overLimit ? '#fef2f2' : '#f0fdf4'};color:${overLimit ? '#ef4444' : '#166534'};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${pct}%</span>
            </div>
            <div style="font-size:24px;font-weight:700;color:${barColor}">${Number(current).toLocaleString()}</div>
            <div style="font-size:12px;color:#94a3b8">of ${Number(limit).toLocaleString()} ${esc(r.unit_name.toLowerCase())}s</div>
            <div style="background:#f1f5f9;border-radius:8px;height:6px;margin-top:8px;overflow:hidden"><div style="height:100%;background:${barColor};border-radius:8px;width:${pct}%"></div></div>
            ${overLimit ? `<div style="margin-top:8px;font-size:12px;color:#ef4444">Overage: ${current - limit} extra · UGX ${Number(meter?.overage_charged || 0).toLocaleString()}</div>` : ''}
            <div style="margin-top:8px;font-size:11px;color:#94a3b8">${esc(r.description)}</div>
          </div>`;
        }).join('')}
      </div>

      ${recentEvents.length > 0 ? `<div class="card">
        <h3>Recent Usage Events</h3>
        <table style="width:100%;margin-top:12px"><thead><tr style="border-bottom:2px solid #e2e8f0">
          <th style="text-align:left;padding:8px">Metric</th><th>Quantity</th><th>Description</th><th>Date</th>
        </tr></thead><tbody>
          ${recentEvents.slice(0, 15).map(e => `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:8px"><span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:12px">${esc(e.metric_type)}</span></td>
            <td style="padding:8px;text-align:center">${e.quantity}</td>
            <td style="padding:8px;color:#64748b;font-size:13px">${esc(e.description || '—')}</td>
            <td style="padding:8px;color:#94a3b8;font-size:13px">${new Date(e.created_at).toLocaleString()}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>` : ''}
    `, u));
  }));

  // API: Record usage (called by other modules) — requires auth
  app.post('/api/usage/track', requireAuthOrApiKey, ah(async (req, res) => {
    // Resolve tenant_id from session or API key
    const tenant_id = req.body.tenant_id || req.session?.user?.tenant_id || req.apiUser?.tenant_id;
    const { metric_type, quantity, description, reference_id } = req.body;
    if (!tenant_id || !metric_type) return res.json({ success: false, error: 'Missing required fields (tenant_id, metric_type)' });

    // Session users can only track for their own tenant; API keys are already scoped
    if (req.session?.user && req.session.user.role !== 'super_admin' && req.session.user.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Cannot track usage for a different tenant' });
    }

    try {
      await trackUsage(tenant_id, metric_type, quantity || 1, description || '', reference_id || '');
      res.json({ success: true });
    } catch (e) {
      logger.warn('[Usage] Track error:', e.message);
      res.json({ success: false, error: e.message });
    }
  }));

  // API: Check if usage is within limit — requires auth
  app.get('/api/usage/check/:tenantId/:metricType', requireAuthOrApiKey, ah(async (req, res) => {
    const { tenantId, metricType } = req.params;

    // Session users can only check their own tenant; API keys are already scoped
    if (req.session?.user && req.session.user.role !== 'super_admin' && String(req.session.user.tenant_id) !== String(tenantId)) {
      return res.status(403).json({ error: 'Cannot check usage for a different tenant' });
    }

    const plan = await getPlan(tenantId);
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const meter = (await pool.query(
      'SELECT * FROM usage_meters WHERE tenant_id = $1 AND metric_type = $2 AND period_start = $3',
      [tenantId, metricType, periodStart]
    )).rows[0];
    const rate = (await pool.query('SELECT * FROM usage_overage_rates WHERE metric_type = $1', [metricType])).rows[0];
    const limit = rate ? (rate[plan + '_limit'] || rate.free_limit) : 0;
    const current = meter ? meter.current_value : 0;
    res.json({ within_limit: current < limit, current, limit, plan, overage: Math.max(0, current - limit) });
  }));

  // Expose trackUsage for other modules
  return { trackUsage };
};
