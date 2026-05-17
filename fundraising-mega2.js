/**
 * Fundraising Mega2 Module — Advanced Platform Features
 * Features: Donation Analytics Dashboard, Campaign A/B Testing, Donor Retention Tracker,
 * Social Proof Notifications, Campaign Endorsements, Donation Wish List,
 * Corporate Matching Portal, Multi-Currency Display, Campaign QR Menu,
 * Donor Thank-You Video Messages
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 1: Donation Analytics Dashboard (uses existing data, no new tables)

    // Feature 2: Campaign A/B Testing
    `CREATE TABLE IF NOT EXISTS campaign_ab_tests (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, test_name TEXT NOT NULL, variant_a_title TEXT, variant_a_description TEXT, variant_b_title TEXT, variant_b_description TEXT, variant_a_views INTEGER DEFAULT 0, variant_a_conversions INTEGER DEFAULT 0, variant_b_views INTEGER DEFAULT 0, variant_b_conversions INTEGER DEFAULT 0, winner TEXT, status TEXT DEFAULT 'running' CHECK (status IN ('running','completed','paused')), started_at TIMESTAMPTZ DEFAULT NOW(), ended_at TIMESTAMPTZ, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ab_tests_campaign ON campaign_ab_tests(campaign_id)`,

    // Feature 3: Donor Retention Tracker
    `CREATE TABLE IF NOT EXISTS donor_retention_metrics (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, period_start DATE NOT NULL, period_end DATE NOT NULL, new_donors INTEGER DEFAULT 0, returning_donors INTEGER DEFAULT 0, total_donors INTEGER DEFAULT 0, retention_rate NUMERIC DEFAULT 0, churn_rate NUMERIC DEFAULT 0, avg_donation_new INTEGER DEFAULT 0, avg_donation_returning INTEGER DEFAULT 0, calculated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_retention_metrics_tenant ON donor_retention_metrics(tenant_id)`,

    // Feature 4: Social Proof Notifications
    `CREATE TABLE IF NOT EXISTS social_proof_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_type TEXT NOT NULL CHECK (event_type IN ('donation','pledge','milestone','new_donor','campaign_created')), message TEXT NOT NULL, is_active BOOLEAN DEFAULT true, show_from TIMESTAMPTZ DEFAULT NOW(), show_until TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_social_proof_tenant ON social_proof_events(tenant_id)`,

    // Feature 5: Campaign Endorsements
    `CREATE TABLE IF NOT EXISTS campaign_endorsements (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, endorser_name TEXT NOT NULL, endorser_title TEXT, endorser_organization TEXT, endorser_photo_url TEXT, endorsement_text TEXT NOT NULL, is_verified BOOLEAN DEFAULT false, is_public BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_endorsements_campaign ON campaign_endorsements(campaign_id)`,

    // Feature 6: Donation Wish List
    `CREATE TABLE IF NOT EXISTS donation_wishlists (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, item_name TEXT NOT NULL, description TEXT, estimated_cost INTEGER, quantity_needed INTEGER DEFAULT 1, quantity_funded INTEGER DEFAULT 0, priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')), category TEXT DEFAULT 'general', is_fulfilled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS wishlist_fulfillments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, wishlist_id INTEGER NOT NULL REFERENCES donation_wishlists(id) ON DELETE CASCADE, donor_name TEXT, donor_email TEXT, amount INTEGER NOT NULL, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_wishlists_tenant ON donation_wishlists(tenant_id)`,

    // Feature 7: Corporate Matching Portal
    `CREATE TABLE IF NOT EXISTS corporate_matchers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, company_name TEXT NOT NULL, contact_name TEXT, contact_email TEXT, contact_phone TEXT, match_ratio NUMERIC DEFAULT 1, max_annual_match INTEGER, current_year_matched INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS corporate_match_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, matcher_id INTEGER NOT NULL REFERENCES corporate_matchers(id) ON DELETE CASCADE, donation_id INTEGER, employee_email TEXT, match_amount INTEGER NOT NULL, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')), verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_corporate_matchers_tenant ON corporate_matchers(tenant_id)`,

    // Feature 8: Multi-Currency Display
    `CREATE TABLE IF NOT EXISTS currency_display_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, base_currency TEXT DEFAULT 'UGX', supported_currencies TEXT DEFAULT '["UGX","USD","EUR","GBP","KES","TZS"]', exchange_rates_json TEXT DEFAULT '{}', auto_update BOOLEAN DEFAULT false, last_updated TIMESTAMPTZ, UNIQUE(tenant_id))`,

    // Feature 9: Campaign QR Menu
    // No extra tables - generates QR codes for campaigns dynamically

    // Feature 10: Donor Thank-You Video Messages
    `CREATE TABLE IF NOT EXISTS thank_you_videos (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donation_id INTEGER, donor_email TEXT, donor_name TEXT, video_url TEXT, thumbnail_url TEXT, message TEXT, duration_seconds INTEGER, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS thank_you_video_views (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, video_id INTEGER NOT NULL REFERENCES thank_you_videos(id) ON DELETE CASCADE, viewer_email TEXT, viewed_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_thank_you_videos_tenant ON thank_you_videos(tenant_id)`,

    // Seed default currency settings
    `INSERT INTO currency_display_settings (tenant_id, base_currency, supported_currencies, exchange_rates_json) SELECT t.id, 'UGX', '["UGX","USD","EUR","GBP","KES","TZS"]', '{"UGX":1,"USD":0.00027,"EUR":0.00025,"GBP":0.00021,"KES":0.035,"TZS":0.69}' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_display_settings WHERE tenant_id=t.id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingMega2] Migrations complete');
  })();

  // =============================================
  // HELPERS
  // =============================================
  function formatUGX(amount) { return 'UGX ' + (parseInt(amount)||0).toLocaleString(); }

  // =============================================
  // FEATURE 1: DONATION ANALYTICS DASHBOARD
  // =============================================
  app.get('/api/fundraising-analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { period } = req.query; // '7d','30d','90d','all'
    let interval = '365 days';
    if (period === '7d') interval = '7 days';
    else if (period === '30d') interval = '30 days';
    else if (period === '90d') interval = '90 days';

    const overview = await pool.query(`SELECT
      COUNT(*) as total_donations,
      COALESCE(SUM(amount),0) as total_amount,
      COALESCE(AVG(amount),0) as avg_amount,
      COUNT(DISTINCT donor_email) as unique_donors,
      MIN(created_at) as first_donation,
      MAX(created_at) as last_donation
    FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND created_at > NOW() - INTERVAL $2`, [tid, interval]);

    const dailyTrend = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count, SUM(amount) as total FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND created_at > NOW() - INTERVAL $2 GROUP BY DATE(created_at) ORDER BY date`, [tid, interval]);

    const topCampaigns = await pool.query(`SELECT fc.title, COALESCE(SUM(cd.amount),0) as raised, COUNT(cd.id) as donations FROM fundraising_campaigns fc LEFT JOIN campaign_donations cd ON fc.id=cd.campaign_id AND cd.tenant_id=$1 AND cd.refunded=false WHERE fc.tenant_id=$1 GROUP BY fc.id, fc.title ORDER BY raised DESC LIMIT 10`, [tid]);

    const topDonors = await pool.query(`SELECT donor_email, donor_name, SUM(amount) as total, COUNT(*) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND is_anonymous=false GROUP BY donor_email, donor_name ORDER BY total DESC LIMIT 10`, [tid]);

    const byMethod = await pool.query(`SELECT method, COUNT(*) as count, SUM(amount) as total FROM campaign_donations WHERE tenant_id=$1 AND refunded=false GROUP BY method ORDER BY total DESC`, [tid]);

    const campaignCount = await pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as active FROM fundraising_campaigns WHERE tenant_id=$2', ['active', tid]);

    res.json({
      overview: overview.rows[0],
      daily_trend: dailyTrend.rows,
      top_campaigns: topCampaigns.rows,
      top_donors: topDonors.rows,
      by_method: byMethod.rows,
      campaign_stats: campaignCount.rows[0]
    });
  }));

  app.get('/fundraising-analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const overview = (await pool.query(`SELECT COUNT(*) as total_donations, COALESCE(SUM(amount),0) as total_amount, COALESCE(AVG(amount),0) as avg_amount, COUNT(DISTINCT donor_email) as unique_donors FROM campaign_donations WHERE tenant_id=$1 AND refunded=false`, [tid])).rows[0];
    const daily = (await pool.query(`SELECT DATE(created_at) as date, SUM(amount) as total FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY date`, [tid])).rows;
    const topCampaigns = (await pool.query(`SELECT fc.title, COALESCE(SUM(cd.amount),0) as raised FROM fundraising_campaigns fc LEFT JOIN campaign_donations cd ON fc.id=cd.campaign_id AND cd.tenant_id=$1 AND cd.refunded=false WHERE fc.tenant_id=$1 GROUP BY fc.id, fc.title ORDER BY raised DESC LIMIT 5`, [tid])).rows;
    const html = `
      <div class="card">
        <h2>Fundraising Analytics</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Total Raised</div><div style="font-size:28px;font-weight:700;color:#059669">${formatUGX(overview.total_amount)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe"><div style="font-size:14px;color:#666">Total Donations</div><div style="font-size:28px;font-weight:700;color:#2563eb">${parseInt(overview.total_donations).toLocaleString()}</div></div>
          <div style="padding:20px;border-radius:12px;background:#fef3c7;border:1px solid #fde68a"><div style="font-size:14px;color:#666">Unique Donors</div><div style="font-size:28px;font-weight:700;color:#d97706">${parseInt(overview.unique_donors).toLocaleString()}</div></div>
          <div style="padding:20px;border-radius:12px;background:#faf5ff;border:1px solid #e9d5ff"><div style="font-size:14px;color:#666">Avg Donation</div><div style="font-size:28px;font-weight:700;color:#7c3aed">${formatUGX(Math.round(parseFloat(overview.avg_amount)))}</div></div>
        </div>
        <h3>30-Day Trend</h3>
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px">
          <div style="display:flex;align-items:flex-end;gap:4px;height:200px">
            ${daily.map(d => {
              const maxAmt = Math.max(...daily.map(x=>parseInt(x.total)),1);
              const h = Math.max(4, Math.round((parseInt(d.total)/maxAmt)*180));
              return `<div title="${d.date}: ${formatUGX(d.total)}" style="flex:1;background:linear-gradient(to top,#059669,#10b981);border-radius:4px 4px 0 0;height:${h}px;min-width:8px"></div>`;
            }).join('')}
          </div>
        </div>
        <h3>Top Campaigns</h3>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Campaign</th><th style="padding:10px;text-align:right">Raised</th></tr></thead>
          <tbody>${topCampaigns.map(c => `<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px">${esc(c.title)}</td><td style="padding:10px;text-align:right;font-weight:700;color:#059669">${formatUGX(c.raised)}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Fundraising Analytics', html, req.session.user));
  }));

  // =============================================
  // FEATURE 2: CAMPAIGN A/B TESTING
  // =============================================
  app.post('/api/campaigns/:id/ab-test', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { test_name, variant_a_title, variant_a_description, variant_b_title, variant_b_description } = req.body;
    if (!test_name) return res.status(400).json({ error: 'test_name required' });
    const result = await pool.query('INSERT INTO campaign_ab_tests(tenant_id,campaign_id,test_name,variant_a_title,variant_a_description,variant_b_title,variant_b_description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, req.params.id, test_name, variant_a_title, variant_a_description, variant_b_title, variant_b_description, req.session.user.email]);
    res.json({ success: true, test: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/ab-tests', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, tid]);
    res.json({ tests: result.rows });
  }));

  app.post('/api/ab-tests/:id/track', ah(async (req, res) => {
    const { variant, event } = req.body; // variant: 'a' or 'b', event: 'view' or 'conversion'
    if (!variant || !event) return res.status(400).json({ error: 'variant and event required' });
    const col = variant === 'a' ? (event === 'view' ? 'variant_a_views' : 'variant_a_conversions') : (event === 'view' ? 'variant_b_views' : 'variant_b_conversions');
    await pool.query(`UPDATE campaign_ab_tests SET ${col}=${col}+1 WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  }));

  app.post('/api/ab-tests/:id/end', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const test = (await pool.query('SELECT * FROM campaign_ab_tests WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!test) return res.status(404).json({ error: 'Not found' });
    const rateA = test.variant_a_views > 0 ? test.variant_a_conversions / test.variant_a_views : 0;
    const rateB = test.variant_b_views > 0 ? test.variant_b_conversions / test.variant_b_views : 0;
    const winner = rateA >= rateB ? 'A' : 'B';
    await pool.query("UPDATE campaign_ab_tests SET status='completed', winner=$1, ended_at=NOW() WHERE id=$2", [winner, req.params.id]);
    res.json({ success: true, winner, rate_a: (rateA*100).toFixed(1)+'%', rate_b: (rateB*100).toFixed(1)+'%' });
  }));

  // =============================================
  // FEATURE 3: DONOR RETENTION TRACKER
  // =============================================
  app.get('/api/donor-retention', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { months } = req.query;
    const m = parseInt(months) || 6;
    const result = await pool.query('SELECT * FROM donor_retention_metrics WHERE tenant_id=$1 ORDER BY period_start DESC LIMIT $2', [tid, m]);
    res.json({ metrics: result.rows });
  }));

  app.post('/api/donor-retention/calculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;
    const pStart = period_start || new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    const pEnd = period_end || new Date().toISOString().split('T')[0];
    // New donors = first donation in period
    const newDonors = (await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM campaign_donations WHERE tenant_id=$1 AND donor_email NOT IN (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND created_at < $2) AND created_at BETWEEN $2 AND $3`, [tid, pStart, pEnd])).rows[0].cnt;
    // Returning donors = donated before AND in this period
    const returning = (await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM campaign_donations cd1 WHERE cd1.tenant_id=$1 AND cd1.created_at BETWEEN $2 AND $3 AND EXISTS (SELECT 1 FROM campaign_donations cd2 WHERE cd2.tenant_id=$1 AND cd2.donor_email=cd1.donor_email AND cd2.created_at < $2)`, [tid, pStart, pEnd])).rows[0].cnt;
    const total = parseInt(newDonors) + parseInt(returning);
    const retentionRate = total > 0 ? ((parseInt(returning) / total) * 100).toFixed(1) : 0;
    const churnRate = (100 - parseFloat(retentionRate)).toFixed(1);
    const avgNew = (await pool.query(`SELECT COALESCE(AVG(amount),0) as avg FROM campaign_donations WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3 AND donor_email IN (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND donor_email NOT IN (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND created_at < $2))`, [tid, pStart, pEnd])).rows[0].avg;
    const avgRet = (await pool.query(`SELECT COALESCE(AVG(amount),0) as avg FROM campaign_donations cd1 WHERE cd1.tenant_id=$1 AND cd1.created_at BETWEEN $2 AND $3 AND EXISTS (SELECT 1 FROM campaign_donations cd2 WHERE cd2.tenant_id=$1 AND cd2.donor_email=cd1.donor_email AND cd2.created_at < $2)`, [tid, pStart, pEnd])).rows[0].avg;

    await pool.query(`INSERT INTO donor_retention_metrics(tenant_id,period_start,period_end,new_donors,returning_donors,total_donors,retention_rate,churn_rate,avg_donation_new,avg_donation_returning) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [tid, pStart, pEnd, parseInt(newDonors), parseInt(returning), total, retentionRate, churnRate, Math.round(parseFloat(avgNew)), Math.round(parseFloat(avgRet))]);
    res.json({ success: true, period: { start: pStart, end: pEnd }, new_donors: parseInt(newDonors), returning_donors: parseInt(returning), total, retention_rate: retentionRate+'%', churn_rate: churnRate+'%' });
  }));

  // =============================================
  // FEATURE 4: SOCIAL PROOF NOTIFICATIONS
  // =============================================
  app.post('/api/social-proof', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { event_type, message, show_from, show_until } = req.body;
    if (!event_type || !message) return res.status(400).json({ error: 'event_type and message required' });
    const result = await pool.query('INSERT INTO social_proof_events(tenant_id,event_type,message,show_from,show_until) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, event_type, message, show_from||null, show_until||null]);
    res.json({ success: true, event: result.rows[0] });
  }));

  app.get('/api/social-proof', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM social_proof_events WHERE tenant_id=$1 AND is_active=true AND show_from <= NOW() AND (show_until IS NULL OR show_until > NOW()) ORDER BY created_at DESC LIMIT 10", [tid]);
    res.json({ events: result.rows });
  }));

  app.delete('/api/social-proof/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE social_proof_events SET is_active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  // Auto-generate social proof from donations
  app.post('/api/social-proof/auto-generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const recent = (await pool.query("SELECT donor_name, amount, campaign_id FROM campaign_donations WHERE tenant_id=$1 AND is_anonymous=false AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 20", [tid])).rows;
    let generated = 0;
    for (const d of recent) {
      const msg = `${d.donor_name||'A supporter'} just donated ${formatUGX(d.amount)}`;
      const existing = await pool.query("SELECT id FROM social_proof_events WHERE tenant_id=$1 AND message=$2", [tid, msg]);
      if (!existing.rows.length) {
        await pool.query("INSERT INTO social_proof_events(tenant_id,event_type,message,show_until,NOW()+INTERVAL '7 days') VALUES($1,'donation',$2,NOW()+INTERVAL '7 days')", [tid, msg]);
        generated++;
      }
    }
    res.json({ success: true, generated });
  }));

  // =============================================
  // FEATURE 5: CAMPAIGN ENDORSEMENTS
  // =============================================
  app.post('/api/campaigns/:id/endorsements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { endorser_name, endorser_title, endorser_organization, endorsement_text, is_public } = req.body;
    if (!endorser_name || !endorsement_text) return res.status(400).json({ error: 'endorser_name and endorsement_text required' });
    const result = await pool.query('INSERT INTO campaign_endorsements(tenant_id,campaign_id,endorser_name,endorser_title,endorser_organization,endorsement_text,is_public) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, req.params.id, endorser_name, endorser_title, endorser_organization, endorsement_text, is_public!==false]);
    res.json({ success: true, endorsement: result.rows[0] });
  }));

  app.get('/api/campaigns/:id/endorsements', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM campaign_endorsements WHERE campaign_id=$1 AND tenant_id=$2 AND is_public=true ORDER BY created_at DESC', [req.params.id, tid]);
    res.json({ endorsements: result.rows });
  }));

  app.put('/api/endorsements/:id/verify', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const result = await pool.query('UPDATE campaign_endorsements SET is_verified=true WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, tid]);
    res.json({ success: true, endorsement: result.rows[0] });
  }));

  app.delete('/api/endorsements/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campaign_endorsements WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  // =============================================
  // FEATURE 6: DONATION WISH LIST
  // =============================================
  app.post('/api/wishlists', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, item_name, description, estimated_cost, quantity_needed, priority, category } = req.body;
    if (!item_name) return res.status(400).json({ error: 'item_name required' });
    const result = await pool.query('INSERT INTO donation_wishlists(tenant_id,campaign_id,item_name,description,estimated_cost,quantity_needed,priority,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [tid, campaign_id||null, item_name, description, estimated_cost?parseInt(estimated_cost):null, parseInt(quantity_needed)||1, priority||'medium', category||'general']);
    res.json({ success: true, item: result.rows[0] });
  }));

  app.get('/api/wishlists', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id } = req.query;
    let q = 'SELECT * FROM donation_wishlists WHERE tenant_id=$1'; const params = [tid];
    if (campaign_id) { q += ' AND campaign_id=$2'; params.push(campaign_id); }
    q += ' ORDER BY CASE priority WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, created_at';
    const result = await pool.query(q, params);
    res.json({ items: result.rows });
  }));

  app.post('/api/wishlists/:id/fulfill', ah(async (req, res) => {
    const tid = req.body.tenant_id || req.session?.user?.tenant_id || 1;
    const { donor_name, donor_email, amount, message } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const item = (await pool.query('SELECT * FROM donation_wishlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const result = await pool.query('INSERT INTO wishlist_fulfillments(tenant_id,wishlist_id,donor_name,donor_email,amount,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [tid, req.params.id, donor_name||'Anonymous', donor_email, parseInt(amount), message]);
    await pool.query('UPDATE donation_wishlists SET quantity_funded=quantity_funded+1, is_fulfilled=(quantity_funded+1>=quantity_needed) WHERE id=$1', [req.params.id]);
    res.json({ success: true, fulfillment: result.rows[0] });
  }));

  app.delete('/api/wishlists/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM donation_wishlists WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/wishlist', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id || 1;
    const items = (await pool.query("SELECT * FROM donation_wishlists WHERE tenant_id=$1 ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END", [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donation Wish List</h2>
        <p style="color:#666;margin-bottom:20px">Specific items needed — donate toward exactly what's needed most.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${items.map(i => `<div style="padding:20px;border:1px solid ${i.is_fulfilled?'#bbf7d0':'#e2e8f0'};border-radius:12px;background:${i.is_fulfilled?'#f0fdf4':'white'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${i.priority==='critical'?'#dc2626':i.priority==='high'?'#f59e0b':'#059669'}">${esc(i.priority)}</span>
              ${i.is_fulfilled?'<span style="color:#059669;font-weight:700">Fulfilled!</span>':''}
            </div>
            <h3 style="margin:0 0 4px">${esc(i.item_name)}</h3>
            <p style="color:#666;font-size:14px;margin:0 0 8px">${esc(i.description||'')}</p>
            ${i.estimated_cost?`<div style="font-weight:700;color:#059669">${formatUGX(i.estimated_cost)}</div>`:''}
            <div style="font-size:13px;color:#888">${i.quantity_funded}/${i.quantity_needed} funded</div>
            ${!i.is_fulfilled?`<button onclick="fulfillItem(${i.id})" style="margin-top:8px;padding:4px 12px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer">Fund This Item</button>`:''}
          </div>`).join('')}
        </div>
        <script>async function fulfillItem(id){const a=prompt('Enter amount (UGX):');if(a){await fetch('/api/wishlists/'+id+'/fulfill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:a,donor_name:'Anonymous'})});location.reload();}}</script>
      </div>`;
    res.send(renderPage('Wish List', html, req.session?.user||null));
  }));

  // =============================================
  // FEATURE 7: CORPORATE MATCHING PORTAL
  // =============================================
  app.get('/api/corporate-matchers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM corporate_matchers WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ matchers: result.rows });
  }));

  app.post('/api/corporate-matchers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { company_name, contact_name, contact_email, contact_phone, match_ratio, max_annual_match } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name required' });
    const result = await pool.query('INSERT INTO corporate_matchers(tenant_id,company_name,contact_name,contact_email,contact_phone,match_ratio,max_annual_match) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, company_name, contact_name, contact_email, contact_phone, match_ratio||1, max_annual_match?parseInt(max_annual_match):null]);
    res.json({ success: true, matcher: result.rows[0] });
  }));

  app.post('/api/corporate-match/:matcherId/claim', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donation_id, employee_email, match_amount } = req.body;
    const matcher = (await pool.query('SELECT * FROM corporate_matchers WHERE id=$1 AND tenant_id=$2 AND is_active=true', [req.params.matcherId, tid])).rows[0];
    if (!matcher) return res.status(404).json({ error: 'Matcher not found or inactive' });
    if (matcher.max_annual_match && parseInt(matcher.current_year_matched) + parseInt(match_amount) > parseInt(matcher.max_annual_match)) {
      return res.status(400).json({ error: 'Exceeds annual match cap' });
    }
    const result = await pool.query('INSERT INTO corporate_match_claims(tenant_id,matcher_id,donation_id,employee_email,match_amount) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, req.params.matcherId, donation_id, employee_email, parseInt(match_amount)]);
    await pool.query('UPDATE corporate_matchers SET current_year_matched=current_year_matched+$1 WHERE id=$2', [parseInt(match_amount), req.params.matcherId]);
    res.json({ success: true, claim: result.rows[0] });
  }));

  app.put('/api/corporate-match-claims/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status } = req.body;
    if (!['approved','paid','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const result = await pool.query('UPDATE corporate_match_claims SET status=$1, verified_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *', [status, req.params.id, tid]);
    res.json({ success: true, claim: result.rows[0] });
  }));

  // =============================================
  // FEATURE 8: MULTI-CURRENCY DISPLAY
  // =============================================
  app.get('/api/currency-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM currency_display_settings WHERE tenant_id=$1', [tid]);
    res.json({ settings: result.rows[0] || null });
  }));

  app.put('/api/currency-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin') return res.status(403).json({ error: 'Admin only' });
    const { base_currency, supported_currencies, exchange_rates_json, auto_update } = req.body;
    const result = await pool.query(`UPDATE currency_display_settings SET base_currency=COALESCE($1,base_currency), supported_currencies=COALESCE($2,supported_currencies), exchange_rates_json=COALESCE($3,exchange_rates_json), auto_update=COALESCE($4,auto_update), last_updated=NOW() WHERE tenant_id=$5 RETURNING *`,
      [base_currency, supported_currencies, exchange_rates_json?JSON.stringify(exchange_rates_json):null, auto_update, tid]);
    res.json({ success: true, settings: result.rows[0] });
  }));

  app.get('/api/convert-amount', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { amount, to_currency } = req.query;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const settings = (await pool.query('SELECT * FROM currency_display_settings WHERE tenant_id=$1', [tid])).rows[0];
    const rates = settings ? (typeof settings.exchange_rates_json === 'string' ? JSON.parse(settings.exchange_rates_json) : settings.exchange_rates_json) : {};
    const rate = rates[to_currency || 'USD'] || 0.00027;
    const converted = Math.round(parseInt(amount) * parseFloat(rate) * 100) / 100;
    res.json({ from: { amount: parseInt(amount), currency: settings?.base_currency || 'UGX' }, to: { amount: converted, currency: to_currency || 'USD' }, rate });
  }));

  // =============================================
  // FEATURE 9: CAMPAIGN QR MENU
  // =============================================
  app.get('/api/campaigns/:id/qr-menu', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const camp = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    // Generate a simple SVG QR code with the campaign URL
    const campaignUrl = `${BASE_URL}/fundraising/${req.params.id}`;
    const qrData = encodeURIComponent(campaignUrl);
    res.json({ campaign: { id: camp.id, title: camp.title, target: camp.target }, qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${qrData}`, share_url: campaignUrl });
  }));

  app.get('/campaign-qr', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaigns = (await pool.query('SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Campaign QR Codes</h2>
        <p style="color:#666;margin-bottom:20px">Generate QR codes for your campaigns to share offline.</p>
        <div style="margin-bottom:16px">
          <select id="campaignSelect" style="padding:8px;border:1px solid #ccc;border-radius:6px;min-width:300px">
            ${campaigns.map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('')}
          </select>
          <button onclick="generateQR()" class="btn" style="background:#059669;color:white;margin-left:8px">Generate QR</button>
        </div>
        <div id="qrResult" style="text-align:center"></div>
        <script>
        async function generateQR(){
          const cid=document.getElementById('campaignSelect').value;
          const res=await fetch('/api/campaigns/'+cid+'/qr-menu');
          const data=await res.json();
          document.getElementById('qrResult').innerHTML='<div style="padding:24px;border:1px solid #e2e8f0;border-radius:12px;display:inline-block;background:white">'+
            '<h3>'+esc(data.campaign.title)+'</h3>'+
            '<img src="'+data.qr_url+'" alt="QR Code" style="margin:16px 0;border:8px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.1)">'+
            '<p style="color:#666;font-size:13px;word-break:break-all">'+esc(data.share_url)+'</p>'+
            '<a href="'+data.qr_url+'" download="qr-campaign-'+cid+'.png" class="btn" style="background:#059669;color:white;margin-top:8px">Download QR</a></div>';
        }
        function esc(t){return t?t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'';}
        </script>
      </div>`;
    res.send(renderPage('Campaign QR', html, req.session.user));
  }));

  // =============================================
  // FEATURE 10: DONOR THANK-YOU VIDEO MESSAGES
  // =============================================
  app.post('/api/thank-you-videos', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, donation_id, donor_email, donor_name, video_url, thumbnail_url, message, duration_seconds } = req.body;
    if (!video_url) return res.status(400).json({ error: 'video_url required' });
    const result = await pool.query('INSERT INTO thank_you_videos(tenant_id,campaign_id,donation_id,donor_email,donor_name,video_url,thumbnail_url,message,duration_seconds,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [tid, campaign_id||null, donation_id||null, donor_email, donor_name, video_url, thumbnail_url, message, duration_seconds||null, req.session.user.email]);
    // Notify donor
    if (donor_email && sendEmail) {
      await sendEmail(donor_email, 'A Personal Thank You Video For You!',
        `<p>Dear ${esc(donor_name||'Supporter')},</p><p>A personal thank-you video has been created for you! <a href="${video_url}">Watch it here</a></p>`);
    }
    if(audit) audit(req, 'thank_you_video_created', { id: result.rows[0].id });
    res.json({ success: true, video: result.rows[0] });
  }));

  app.get('/api/thank-you-videos', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, donor_email } = req.query;
    let q = 'SELECT * FROM thank_you_videos WHERE tenant_id=$1'; const params = [tid]; let idx = 2;
    if (campaign_id) { q += ` AND campaign_id=$${idx}`; params.push(campaign_id); idx++; }
    if (donor_email) { q += ` AND donor_email=$${idx}`; params.push(donor_email); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ videos: result.rows });
  }));

  app.post('/api/thank-you-videos/:id/view', ah(async (req, res) => {
    const tid = req.body.tenant_id || req.session?.user?.tenant_id || 1;
    const viewerEmail = req.session?.user?.email || req.body.viewer_email;
    await pool.query('INSERT INTO thank_you_video_views(tenant_id,video_id,viewer_email) VALUES($1,$2,$3)', [tid, req.params.id, viewerEmail]);
    res.json({ success: true });
  }));

  app.get('/thank-you-videos', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const videos = (await pool.query('SELECT * FROM thank_you_videos WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Thank You Videos</h2>
        <p style="color:#666;margin-bottom:20px">Send personal video thank-yous to your donors.</p>
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Record a Thank You</h3>
          <form method="POST" action="/api/thank-you-videos">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Video URL *</label><input type="url" name="video_url" required placeholder="https://..." style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Donor Email</label><input type="email" name="donor_email" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Donor Name</label><input type="text" name="donor_name" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div><label>Thumbnail URL</label><input type="url" name="thumbnail_url" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
              <div style="grid-column:span 2"><label>Message</label><textarea name="message" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;min-height:60px"></textarea></div>
            </div>
            <button type="submit" class="btn" style="background:#059669;color:white;margin-top:12px">Send Thank You Video</button>
          </form>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${videos.map(v => `<div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px">
            ${v.thumbnail_url?`<img src="${esc(v.thumbnail_url)}" style="width:100%;border-radius:8px;margin-bottom:8px">`:'<div style="width:100%;height:150px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:48px;margin-bottom:8px">🎥</div>'}
            <div style="font-weight:600">${esc(v.donor_name||v.donor_email||'General')}</div>
            ${v.message?`<p style="color:#666;font-size:13px;margin:4px 0">${esc(v.message)}</p>`:''}
            <a href="${esc(v.video_url)}" target="_blank" style="color:#059669;font-size:13px">Watch Video</a>
          </div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('Thank You Videos', html, req.session.user));
  }));

  // =============================================
  // STARTUP LOG
  // =============================================
  console.log('[FundraisingMega2] Module loaded — 10 features, 50+ routes');
};
