// src/routes/misc-api.js
//
// Miscellaneous /api/* routes extracted from server.js as part of the
// Conservative route-extraction refactor — Track 1, Task t1.
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`, etc.
// that the rest of server.js uses — no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/api', require('./src/routes/misc-api')(sharedCtx));
//
// Contains:
//   GET  /api/subscription/status
//   GET  /api/features
//   POST /api/recurring-donations/process
//   GET  /api/rate-limits

module.exports = function createMiscApiRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, requireNotBanned, ah, renderPage, esc } = ctx;

  // API: Get subscription/trial status (skipped by trial middleware)
  // GET /api/subscription/status
  router.get('/subscription/status', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    try {
      const result = await pool.query(
        `SELECT s.plan, s.status, s.trial_start, s.trial_end, s.trial_expired
         FROM subscriptions s
         WHERE s.tenant_id = $1
         ORDER BY COALESCE(s.created_at, s.started_at) DESC LIMIT 1`,
        [t]
      );
      if (!result.rows.length) return res.json({ plan: 'free', status: 'none', trial_expired: false });
      const sub = result.rows[0];
      const trialDaysLeft = sub.trial_end && !sub.trial_expired
        ? Math.max(0, Math.ceil((new Date(sub.trial_end) - new Date()) / (1000 * 60 * 60 * 24)))
        : 0;
      res.json({
        plan: sub.plan,
        status: sub.status,
        trial_start: sub.trial_start,
        trial_end: sub.trial_end,
        trial_expired: sub.trial_expired || false,
        trial_days_remaining: trialDaysLeft
      });
    } catch (e) {
      res.json({ plan: 'free', status: 'error', trial_expired: false, error: e.message });
    }
  }));

  // FEATURE STATUS API (for frontend to check)
  // GET /api/features
  router.get('/features', ah(async (req, res) => {
    const features = (await pool.query('SELECT feature_key, is_active, name, description, version, category FROM feature_flags')).rows;
    const featureMap = {};
    features.forEach(f => { featureMap[f.feature_key] = { active: f.is_active, name: f.name, description: f.description, version: f.version, category: f.category }; });
    res.json(featureMap);
  }));

  // POST /api/recurring-donations/process — process due recurring donations
  router.post('/recurring-donations/process', requireAuth, ah(async (req, res) => {
    // SECURITY: Require admin role to process recurring donations
    const role = req.session.user?.role || 'staff';
    if (role !== 'super_admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    // Process due recurring donations - called by cron/scheduler
    const due = (await pool.query("SELECT * FROM recurring_donations WHERE next_date <= CURRENT_DATE AND status = 'active'")).rows;
    let processed = 0, errors = 0;
    for (const d of due) {
      try {
        // Record the donation
        await pool.query('INSERT INTO campaign_donations(campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5)', [d.campaign_id||null, d.donor_name, d.amount, d.payment_method||'cash', 'Recurring donation']);
        // Calculate next date
        let nextDate = new Date(d.next_date);
        switch(d.schedule) {
          case 'weekly': nextDate.setDate(nextDate.getDate()+7); break;
          case 'monthly': nextDate.setMonth(nextDate.getMonth()+1); break;
          case 'quarterly': nextDate.setMonth(nextDate.getMonth()+3); break;
          case 'yearly': nextDate.setFullYear(nextDate.getFullYear()+1); break;
          default: nextDate.setMonth(nextDate.getMonth()+1);
        }
        await pool.query('UPDATE recurring_donations SET last_processed=CURRENT_DATE, next_date=$1, total_donated=total_donated+$2, donation_count=donation_count+1 WHERE id=$3', [nextDate.toISOString().split('T')[0], d.amount, d.id]);
        processed++;
      } catch(e) { errors++; }
    }
    res.json({ processed, errors, total_due: due.length });
  }));

  // API rate limit settings per key — UI page route
  // GET /api/rate-limits
  router.get('/rate-limits', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const keys = (await pool.query('SELECT id, name, key_prefix, last_used, is_active, created_at FROM api_keys WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    res.send(renderPage('API Rate Limits', `
    <div class="hero" style="background:linear-gradient(135deg,#ef4444,#dc2626)"><h1>API Rate Limiting</h1><p>Monitor and manage API key rate limits</p></div>
    <div class="card"><h2>Default Rate Limits by Plan</h2>
      <table><tr><th>Plan</th><th>Requests/Minute</th></tr>
        <tr><td>Free</td><td>60</td></tr><tr><td>Basic</td><td>200</td></tr><tr><td>Pro</td><td>500</td></tr><tr><td>Enterprise</td><td>2,000</td></tr></table>
      <p class="muted">Rate limit headers are included in every API response: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset</p>
    </div>
    <div class="card"><h2>Your API Keys</h2>
      <table><tr><th>Name</th><th>Prefix</th><th>Active</th><th>Last Used</th><th>Created</th></tr>
        ${keys.map(k => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.key_prefix||'...')}</code></td><td>${k.is_active!==false?'<span class="tag" style="background:#d1fae5;color:#065f46">Active</span>':'<span class="tag" style="background:#fee2e2;color:#991b1b">Revoked</span>'}</td><td>${k.last_used?new Date(k.last_used).toLocaleString():'Never'}</td><td>${new Date(k.created_at).toLocaleDateString()}</td></tr>`).join('')}
        </table>
    </div>
    <div class="card"><h2>Rate Limit Response (429)</h2>
      <pre style="background:#1e1e1e;color:#d4d4d4;padding:15px;border-radius:8px;overflow-x:auto"><code>{
  "error": "Rate limit exceeded",
  "limit": 500,
  "remaining": 0,
  "reset_at": "2026-05-20T12:00:00.000Z"
}</code></pre>
    </div>
    <div class="card"><a href="/api-keys" class="btn" style="width:100%">Manage API Keys</a></div>
  `, req.session.user));
  }));

  return router;
};
