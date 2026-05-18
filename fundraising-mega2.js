// ============================================================
// FUNDRAISING MEGA2 MODULE
// 10 Advanced Fundraising Features
// ============================================================
// 1. Donation Analytics Dashboard
// 2. Campaign A/B Testing
// 3. Donor Retention Tracker
// 4. Social Proof Notifications
// 5. Campaign Endorsements
// 6. Donation Wish List
// 7. Corporate Matching Portal
// 8. Multi-Currency Display
// 9. Campaign QR Menu
// 10. Donor Thank-You Videos
// ============================================================

module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 2: Campaign A/B Testing
    `CREATE TABLE IF NOT EXISTS campaign_ab_tests (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      variant_name TEXT NOT NULL,
      variant_title TEXT,
      variant_story TEXT,
      views INTEGER DEFAULT 0,
      donations INTEGER DEFAULT 0,
      total_raised INTEGER DEFAULT 0,
      conversion_rate NUMERIC(8,4) DEFAULT 0,
      is_winner BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 3: Donor Retention Tracker
    `CREATE TABLE IF NOT EXISTS donor_retention_metrics (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      new_donors INTEGER DEFAULT 0,
      returning_donors INTEGER DEFAULT 0,
      retention_rate NUMERIC(8,4) DEFAULT 0,
      avg_donation_new INTEGER DEFAULT 0,
      avg_donation_returning INTEGER DEFAULT 0,
      calculated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 4: Social Proof Notifications
    `CREATE TABLE IF NOT EXISTS social_proof_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      event_type TEXT NOT NULL DEFAULT 'donation',
      donor_name TEXT,
      amount INTEGER,
      message TEXT,
      is_active BOOLEAN DEFAULT true,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 5: Campaign Endorsements
    `CREATE TABLE IF NOT EXISTS campaign_endorsements_mega2 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      endorser_name TEXT NOT NULL,
      endorser_title TEXT,
      endorser_org TEXT,
      endorsement_text TEXT NOT NULL,
      is_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 6: Donation Wish List
    `CREATE TABLE IF NOT EXISTS donation_wishlists (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      item_name TEXT NOT NULL,
      item_description TEXT,
      estimated_cost INTEGER DEFAULT 0,
      quantity_needed INTEGER DEFAULT 1,
      quantity_fulfilled INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS wishlist_fulfillments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      wishlist_id INTEGER REFERENCES donation_wishlists(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      fulfilled_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 7: Corporate Matching Portal
    `CREATE TABLE IF NOT EXISTS corporate_matchers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      contact_email TEXT,
      match_ratio NUMERIC(5,2) DEFAULT 1.00,
      max_annual_match INTEGER DEFAULT 0,
      current_year_matched INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS corporate_match_claims (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      matcher_id INTEGER REFERENCES corporate_matchers(id) ON DELETE CASCADE,
      donor_email TEXT,
      donation_id INTEGER,
      original_amount INTEGER DEFAULT 0,
      matched_amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
      claimed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 8: Multi-Currency Display
    `CREATE TABLE IF NOT EXISTS currency_display_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      base_currency TEXT DEFAULT 'UGX',
      supported_currencies_json JSONB DEFAULT '[]',
      exchange_rates_json JSONB DEFAULT '{}',
      auto_update BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Feature 10: Donor Thank-You Videos
    `CREATE TABLE IF NOT EXISTS thank_you_videos (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      video_url TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS thank_you_video_views (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      video_id INTEGER REFERENCES thank_you_videos(id) ON DELETE CASCADE,
      viewer_email TEXT,
      viewed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_campaign_ab_tests_tenant ON campaign_ab_tests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_ab_tests_campaign ON campaign_ab_tests(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_retention_metrics_tenant ON donor_retention_metrics(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_social_proof_events_tenant ON social_proof_events(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_endorsements_mega2_tenant ON campaign_endorsements_mega2(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_wishlists_tenant ON donation_wishlists(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wishlist_fulfillments_tenant ON wishlist_fulfillments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_corporate_matchers_tenant ON corporate_matchers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_corporate_match_claims_tenant ON corporate_match_claims(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_currency_display_settings_tenant ON currency_display_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_you_videos_tenant ON thank_you_videos(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_you_video_views_tenant ON thank_you_video_views(tenant_id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingMega2] Migrations complete');

    // Seed multi-currency settings per tenant
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        const existing = (await pool.query('SELECT id FROM currency_display_settings WHERE tenant_id=$1', [t.id])).rows[0];
        if (!existing) {
          await pool.query(`INSERT INTO currency_display_settings (tenant_id, base_currency, supported_currencies_json, exchange_rates_json, auto_update, updated_at)
            VALUES ($1, 'UGX', $2, $3, false, NOW())`,
            [t.id,
              JSON.stringify(['UGX','USD','EUR','GBP','KES','TZS']),
              JSON.stringify({ UGX:1, USD:0.00027, EUR:0.00025, GBP:0.00021, KES:0.035, TZS:0.62 })
            ]);
        }
      }
      console.log('[FundraisingMega2] Currency seed complete');
    } catch(e) { console.warn('[FundraisingMega2] Currency seed error:', e.message); }
  })();

  // =============================================
  // FEATURE 1: DONATION ANALYTICS DASHBOARD
  // =============================================

  // API: Aggregated analytics
  app.get('/api/fundraising-analytics', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;

    // Donations over time (last 12 months)
    const donationsOverTime = (await pool.query(`
      SELECT DATE_TRUNC('month', donated_at) AS month, COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
      FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `, [t])).rows;

    // Top donors
    const topDonors = (await pool.query(`
      SELECT donor_name, COALESCE(SUM(amount),0) AS total_donated, COUNT(*) AS donation_count
      FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1
      GROUP BY donor_name ORDER BY total_donated DESC LIMIT 20
    `, [t])).rows;

    // Donations by method
    const byMethod = (await pool.query(`
      SELECT cd.method, COALESCE(SUM(cd.amount),0) AS total, COUNT(*) AS count
      FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1
      GROUP BY cd.method ORDER BY total DESC
    `, [t])).rows;

    // Donations by campaign
    const byCampaign = (await pool.query(`
      SELECT fc.id, fc.title, COALESCE(SUM(cd.amount),0) AS total_raised, COUNT(cd.id) AS donation_count, fc.target
      FROM fundraising_campaigns fc
      LEFT JOIN campaign_donations cd ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1
      GROUP BY fc.id, fc.title, fc.target ORDER BY total_raised DESC LIMIT 20
    `, [t])).rows;

    // Summary stats
    const summary = (await pool.query(`
      SELECT COALESCE(SUM(cd.amount),0) AS total_all,
             COUNT(cd.id) AS total_donations,
             COUNT(DISTINCT cd.donor_name) AS unique_donors,
             COALESCE(AVG(cd.amount),0) AS avg_donation,
             COALESCE(MAX(cd.amount),0) AS largest_donation
      FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1
    `, [t])).rows[0];

    res.json({ donationsOverTime, topDonors, byMethod, byCampaign, summary });
  }));

  // UI: Analytics Dashboard
  app.get('/fundraising-analytics', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;

    const donationsOverTime = (await pool.query(`
      SELECT DATE_TRUNC('month', donated_at) AS month, COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
      FROM campaign_donations cd JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `, [t])).rows;

    const topDonors = (await pool.query(`
      SELECT donor_name, COALESCE(SUM(amount),0) AS total_donated, COUNT(*) AS donation_count
      FROM campaign_donations cd JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 GROUP BY donor_name ORDER BY total_donated DESC LIMIT 15
    `, [t])).rows;

    const byMethod = (await pool.query(`
      SELECT cd.method, COALESCE(SUM(cd.amount),0) AS total, COUNT(*) AS count
      FROM campaign_donations cd JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 GROUP BY cd.method ORDER BY total DESC
    `, [t])).rows;

    const byCampaign = (await pool.query(`
      SELECT fc.id, fc.title, COALESCE(SUM(cd.amount),0) AS total_raised, COUNT(cd.id) AS donation_count, fc.target
      FROM fundraising_campaigns fc LEFT JOIN campaign_donations cd ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 GROUP BY fc.id, fc.title, fc.target ORDER BY total_raised DESC LIMIT 15
    `, [t])).rows;

    const summary = (await pool.query(`
      SELECT COALESCE(SUM(cd.amount),0) AS total_all, COUNT(cd.id) AS total_donations,
             COUNT(DISTINCT cd.donor_name) AS unique_donors, COALESCE(AVG(cd.amount),0) AS avg_donation,
             COALESCE(MAX(cd.amount),0) AS largest_donation
      FROM campaign_donations cd JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1
    `, [t])).rows[0];

    const maxMonthly = Math.max(...donationsOverTime.map(d => parseInt(d.total) || 0), 1);

    res.send(renderPage('Fundraising Analytics', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
        <h1>Fundraising Analytics</h1>
        <p>Data-driven insights for your campaigns</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${(parseInt(summary.total_all)||0).toLocaleString()}</div><div>Total Raised</div></div>
        <div class="stat-card"><div class="stat-num">${summary.total_donations || 0}</div><div>Total Donations</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${summary.unique_donors || 0}</div><div>Unique Donors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">UGX ${(parseInt(summary.avg_donation)||0).toLocaleString()}</div><div>Avg Donation</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">UGX ${(parseInt(summary.largest_donation)||0).toLocaleString()}</div><div>Largest Donation</div></div>
      </div>

      <div class="card" style="margin-top:20px">
        <h2>Donations Over Time (Last 12 Months)</h2>
        ${donationsOverTime.length ? `
          <div style="display:flex;align-items:flex-end;gap:8px;height:220px;padding:20px 0;border-bottom:2px solid #e2e8f0">
            ${donationsOverTime.map(d => {
              const pct = Math.max(2, Math.round((parseInt(d.total) / maxMonthly) * 180));
              const monthLabel = new Date(d.month).toLocaleDateString('en', {month:'short', year:'2-digit'});
              return `<div style="flex:1;text-align:center;position:relative">
                <div style="background:linear-gradient(180deg,#059669,#10b981);height:${pct}px;border-radius:6px 6px 0 0;min-width:20px;margin:0 auto;position:relative;cursor:pointer" title="UGX ${(parseInt(d.total)||0).toLocaleString()} (${d.count} donations)">
                  <span style="position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#059669;font-weight:700;white-space:nowrap">${(parseInt(d.total)/1000).toFixed(0)}k</span>
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:6px">${monthLabel}</div>
              </div>`;
            }).join('')}
          </div>
        ` : '<p class="muted" style="text-align:center;padding:40px">No donation data yet.</p>'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">
        <div class="card">
          <h2>Top Donors</h2>
          ${topDonors.length ? '<table><tr><th>#</th><th>Donor</th><th>Total</th><th>Donations</th></tr>' +
            topDonors.map((d, i) => '<tr><td>' + (i+1) + '</td><td><strong>' + esc(d.donor_name || 'Anonymous') + '</strong></td><td style="color:#059669;font-weight:700">UGX ' + (parseInt(d.total_donated)||0).toLocaleString() + '</td><td>' + d.donation_count + '</td></tr>').join('') + '</table>' :
            '<p class="muted" style="text-align:center;padding:40px">No donors yet.</p>'}
        </div>

        <div class="card">
          <h2>Donations by Method</h2>
          ${byMethod.length ? '<table><tr><th>Method</th><th>Total</th><th>Count</th></tr>' +
            byMethod.map(d => '<tr><td><span class="tag">' + esc(d.method || 'unknown') + '</span></td><td style="font-weight:700">UGX ' + (parseInt(d.total)||0).toLocaleString() + '</td><td>' + d.count + '</td></tr>').join('') + '</table>' :
            '<p class="muted" style="text-align:center;padding:40px">No data yet.</p>'}
        </div>
      </div>

      <div class="card" style="margin-top:20px">
        <h2>Donations by Campaign</h2>
        ${byCampaign.length ? '<table><tr><th>Campaign</th><th>Raised</th><th>Target</th><th>Progress</th><th>Donations</th></tr>' +
          byCampaign.map(d => {
            const pct = parseInt(d.target) > 0 ? Math.min(100, Math.round(parseInt(d.total_raised)/parseInt(d.target)*100)) : 0;
            return '<tr><td><strong>' + esc(d.title) + '</strong></td><td style="color:#059669;font-weight:700">UGX ' + (parseInt(d.total_raised)||0).toLocaleString() + '</td><td class="muted">UGX ' + (parseInt(d.target)||0).toLocaleString() + '</td><td><div style="background:#e2e8f0;border-radius:4px;height:10px;width:120px;display:inline-block;vertical-align:middle"><div style="background:#059669;height:10px;border-radius:4px;width:' + pct + '%"></div></div> <span style="font-size:12px;color:#64748b">' + pct + '%</span></td><td>' + d.donation_count + '</td></tr>';
          }).join('') + '</table>' :
          '<p class="muted" style="text-align:center;padding:40px">No campaigns yet.</p>'}
      </div>
    `, req.session.user));
  }));

  // =============================================
  // FEATURE 2: CAMPAIGN A/B TESTING
  // =============================================

  // API: Create A/B test variant
  app.post('/api/campaigns/:id/ab-tests', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { variant_name, variant_title, variant_story } = req.body;

    if (!variant_name) return res.status(400).json({ error: 'variant_name is required' });

    // Verify campaign belongs to tenant
    const campaign = (await pool.query('SELECT id FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const result = await pool.query(
      'INSERT INTO campaign_ab_tests (tenant_id, campaign_id, variant_name, variant_title, variant_story) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, campaignId, esc(variant_name), esc(variant_title || ''), esc(variant_story || '')]
    );
    await audit(req.session.user.email, 'ab_test_created', 'Created A/B test variant "' + variant_name + '" for campaign #' + campaignId);
    res.json(result.rows[0]);
  }));

  // API: Get A/B tests for campaign
  app.get('/api/campaigns/:id/ab-tests', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);

    const tests = (await pool.query(
      'SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at',
      [campaignId, t]
    )).rows;
    res.json(tests);
  }));

  // API: Track view/donation on A/B test variant
  app.post('/api/ab-tests/:id/track', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const testId = parseInt(req.params.id);
    const { event_type, amount } = req.body; // event_type: 'view' or 'donation'

    const test = (await pool.query('SELECT * FROM campaign_ab_tests WHERE id=$1 AND tenant_id=$2', [testId, t])).rows[0];
    if (!test) return res.status(404).json({ error: 'A/B test variant not found' });

    if (event_type === 'view') {
      await pool.query('UPDATE campaign_ab_tests SET views = views + 1 WHERE id=$1 AND tenant_id=$2', [testId, t]);
    } else if (event_type === 'donation') {
      const donationAmount = parseInt(amount) || 0;
      await pool.query('UPDATE campaign_ab_tests SET donations = donations + 1, total_raised = total_raised + $1 WHERE id=$2 AND tenant_id=$3', [donationAmount, testId, t]);
    }

    // Recalculate conversion rate
    await pool.query('UPDATE campaign_ab_tests SET conversion_rate = CASE WHEN views > 0 THEN (donations::NUMERIC / views::NUMERIC) * 100 ELSE 0 END WHERE id=$1 AND tenant_id=$2', [testId, t]);

    const updated = (await pool.query('SELECT * FROM campaign_ab_tests WHERE id=$1 AND tenant_id=$2', [testId, t])).rows[0];
    res.json(updated);
  }));

  // API: End A/B test - pick winner
  app.post('/api/ab-tests/:id/end', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const testId = parseInt(req.params.id);

    const test = (await pool.query('SELECT * FROM campaign_ab_tests WHERE id=$1 AND tenant_id=$2', [testId, t])).rows[0];
    if (!test) return res.status(404).json({ error: 'A/B test variant not found' });

    // Find best performing variant for same campaign
    const allVariants = (await pool.query('SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2', [test.campaign_id, t])).rows;
    const best = allVariants.reduce((a, b) => parseFloat(a.conversion_rate) >= parseFloat(b.conversion_rate) ? a : b);

    // Mark winner
    await pool.query('UPDATE campaign_ab_tests SET is_winner = (id = $1) WHERE campaign_id=$2 AND tenant_id=$3', [best.id, test.campaign_id, t]);

    await audit(req.session.user.email, 'ab_test_ended', 'Ended A/B test for campaign #' + test.campaign_id + '. Winner: variant "' + best.variant_name + '"');
    const updated = (await pool.query('SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2', [test.campaign_id, t])).rows;
    res.json({ winner: best, all_variants: updated });
  }));

  // =============================================
  // FEATURE 3: DONOR RETENTION TRACKER
  // =============================================

  // API: Get retention metrics
  app.get('/api/donor-retention', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { period_start, period_end } = req.query;

    let query = 'SELECT * FROM donor_retention_metrics WHERE tenant_id=$1';
    const params = [t];

    if (period_start && period_end) {
      query += ' AND period_start >= $2 AND period_end <= $3';
      params.push(period_start, period_end);
    }

    query += ' ORDER BY period_start DESC LIMIT 24';
    const metrics = (await pool.query(query, params)).rows;
    res.json(metrics);
  }));

  // API: Calculate retention for a period
  app.post('/api/donor-retention/calculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;

    if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end are required' });

    // Find donors who donated in the current period
    const currentDonors = (await pool.query(`
      SELECT DISTINCT cd.donor_name FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= $2 AND cd.donated_at <= $3 AND cd.donor_name IS NOT NULL
    `, [t, period_start, period_end])).rows.map(r => r.donor_name);

    // Find donors who also donated in any prior period
    const previousDonors = (await pool.query(`
      SELECT DISTINCT cd.donor_name FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at < $2 AND cd.donor_name IS NOT NULL
    `, [t, period_start])).rows.map(r => r.donor_name);

    const newDonors = currentDonors.filter(d => !previousDonors.includes(d));
    const returningDonors = currentDonors.filter(d => previousDonors.includes(d));
    const retentionRate = currentDonors.length > 0 ? ((returningDonors.length / currentDonors.length) * 100) : 0;

    // Average donation for new vs returning
    const newDonorAvg = newDonors.length > 0 ? (await pool.query(`
      SELECT COALESCE(AVG(cd.amount),0) AS avg FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= $2 AND cd.donated_at <= $3 AND cd.donor_name = ANY($4)
    `, [t, period_start, period_end, newDonors])).rows[0]?.avg || 0 : 0;

    const returningDonorAvg = returningDonors.length > 0 ? (await pool.query(`
      SELECT COALESCE(AVG(cd.amount),0) AS avg FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= $2 AND cd.donated_at <= $3 AND cd.donor_name = ANY($4)
    `, [t, period_start, period_end, returningDonors])).rows[0]?.avg || 0 : 0;

    // Upsert the metrics
    const result = await pool.query(`
      INSERT INTO donor_retention_metrics (tenant_id, period_start, period_end, new_donors, returning_donors, retention_rate, avg_donation_new, avg_donation_returning, calculated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [t, period_start, period_end, newDonors.length, returningDonors.length,
        parseFloat(retentionRate.toFixed(2)), Math.round(parseFloat(newDonorAvg)), Math.round(parseFloat(returningDonorAvg))]);

    if (!result.rows[0]) {
      // Try update if already exists
      await pool.query(`
        UPDATE donor_retention_metrics SET new_donors=$3, returning_donors=$4, retention_rate=$5, avg_donation_new=$6, avg_donation_returning=$7, calculated_at=NOW()
        WHERE tenant_id=$1 AND period_start=$8 AND period_end=$9
      `, [t, null, newDonors.length, returningDonors.length,
          parseFloat(retentionRate.toFixed(2)), Math.round(parseFloat(newDonorAvg)), Math.round(parseFloat(returningDonorAvg)),
          period_start, period_end]);
    }

    await audit(req.session.user.email, 'retention_calculated', 'Calculated donor retention for ' + period_start + ' to ' + period_end);
    res.json({
      period_start, period_end,
      total_donors: currentDonors.length,
      new_donors: newDonors.length,
      returning_donors: returningDonors.length,
      retention_rate: parseFloat(retentionRate.toFixed(2)),
      avg_donation_new: Math.round(parseFloat(newDonorAvg)),
      avg_donation_returning: Math.round(parseFloat(returningDonorAvg))
    });
  }));

  // =============================================
  // FEATURE 4: SOCIAL PROOF NOTIFICATIONS
  // =============================================

  // API: Create social proof event
  app.post('/api/social-proof', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, event_type, donor_name, amount, message, expires_at } = req.body;

    if (!event_type) return res.status(400).json({ error: 'event_type is required' });

    const result = await pool.query(
      'INSERT INTO social_proof_events (tenant_id, campaign_id, event_type, donor_name, amount, message, is_active, expires_at) VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING *',
      [t, campaign_id || null, esc(event_type), esc(donor_name || ''), parseInt(amount) || 0, esc(message || ''), expires_at || null]
    );

    await audit(req.session.user.email, 'social_proof_created', 'Created social proof event: ' + event_type);
    res.json(result.rows[0]);
  }));

  // API: Get active social proof events
  app.get('/api/social-proof', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, active_only } = req.query;

    let query = 'SELECT * FROM social_proof_events WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;

    if (campaign_id) {
      query += ' AND campaign_id=$' + idx;
      params.push(parseInt(campaign_id));
      idx++;
    }
    if (active_only === 'true' || active_only === '1') {
      query += ' AND is_active=true AND (expires_at IS NULL OR expires_at > NOW())';
    }
    query += ' ORDER BY created_at DESC LIMIT 50';

    const events = (await pool.query(query, params)).rows;
    res.json(events);
  }));

  // API: Delete social proof event
  app.delete('/api/social-proof/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM social_proof_events WHERE id=$1 AND tenant_id=$2 RETURNING id', [parseInt(req.params.id), t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    await audit(req.session.user.email, 'social_proof_deleted', 'Deleted social proof event #' + req.params.id);
    res.json({ success: true });
  }));

  // API: Auto-generate social proof from recent donations
  app.post('/api/social-proof/auto-generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const hoursBack = parseInt(req.body.hours_back) || 24;

    // Get recent donations
    const recentDonations = (await pool.query(`
      SELECT cd.*, fc.title as campaign_title FROM campaign_donations cd
      JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
      WHERE fc.tenant_id = $1 AND cd.donated_at >= NOW() - INTERVAL '1 hour' * $2
      ORDER BY cd.donated_at DESC LIMIT 20
    `, [t, hoursBack])).rows;

    let created = 0;
    for (const d of recentDonations) {
      // Check if already generated
      const exists = (await pool.query(
        'SELECT id FROM social_proof_events WHERE tenant_id=$1 AND campaign_id=$2 AND amount=$3 AND donor_name=$4 AND created_at >= NOW() - INTERVAL \'1 hour\' * $5',
        [t, d.campaign_id, d.amount, d.donor_name, hoursBack]
      )).rows[0];

      if (!exists) {
        const displayName = d.donor_name === 'Anonymous' ? 'A generous supporter' : d.donor_name;
        const expiresIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await pool.query(
          'INSERT INTO social_proof_events (tenant_id, campaign_id, event_type, donor_name, amount, message, is_active, expires_at) VALUES ($1,$2,$3,$4,$5,$6,true,$7)',
          [t, d.campaign_id, 'donation', esc(displayName), parseInt(d.amount) || 0,
           esc(displayName + ' donated to "' + (d.campaign_title || 'a campaign') + '"'), expiresIn]
        );
        created++;
      }
    }

    await audit(req.session.user.email, 'social_proof_auto_generated', 'Auto-generated ' + created + ' social proof events');
    res.json({ created, total_recent: recentDonations.length });
  }));

  // =============================================
  // FEATURE 5: CAMPAIGN ENDORSEMENTS
  // =============================================

  // API: Add endorsement
  app.post('/api/campaigns/:id/endorsements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { endorser_name, endorser_title, endorser_org, endorsement_text } = req.body;

    if (!endorser_name || !endorsement_text) return res.status(400).json({ error: 'endorser_name and endorsement_text are required' });

    // Verify campaign belongs to tenant
    const campaign = (await pool.query('SELECT id FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const result = await pool.query(
      'INSERT INTO campaign_endorsements_mega2 (tenant_id, campaign_id, endorser_name, endorser_title, endorser_org, endorsement_text) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, campaignId, esc(endorser_name), esc(endorser_title || ''), esc(endorser_org || ''), esc(endorsement_text)]
    );

    await audit(req.session.user.email, 'endorsement_added', 'Added endorsement from "' + endorser_name + '" to campaign #' + campaignId);

    // Notify campaign admins
    const admins = (await pool.query("SELECT email FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin')", [t])).rows;
    for (const a of admins) {
      notify(t, a.email, 'New Endorsement', endorser_name + ' endorsed campaign #' + campaignId + ': "' + endorsement_text.substring(0, 80) + '"', 'fundraising');
    }

    res.json(result.rows[0]);
  }));

  // API: Get endorsements for campaign
  app.get('/api/campaigns/:id/endorsements', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);

    const endorsements = (await pool.query(
      'SELECT * FROM campaign_endorsements_mega2 WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC',
      [campaignId, t]
    )).rows;
    res.json(endorsements);
  }));

  // API: Verify endorsement
  app.put('/api/endorsements/:id/verify', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endorsementId = parseInt(req.params.id);

    const endorsement = (await pool.query('SELECT * FROM campaign_endorsements_mega2 WHERE id=$1 AND tenant_id=$2', [endorsementId, t])).rows[0];
    if (!endorsement) return res.status(404).json({ error: 'Endorsement not found' });

    await pool.query('UPDATE campaign_endorsements_mega2 SET is_verified=true WHERE id=$1 AND tenant_id=$2', [endorsementId, t]);
    await audit(req.session.user.email, 'endorsement_verified', 'Verified endorsement #' + endorsementId + ' from "' + endorsement.endorser_name + '"');

    const updated = (await pool.query('SELECT * FROM campaign_endorsements_mega2 WHERE id=$1 AND tenant_id=$2', [endorsementId, t])).rows[0];
    res.json(updated);
  }));

  // API: Delete endorsement
  app.delete('/api/endorsements/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endorsementId = parseInt(req.params.id);

    const result = await pool.query('DELETE FROM campaign_endorsements_mega2 WHERE id=$1 AND tenant_id=$2 RETURNING id', [endorsementId, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Endorsement not found' });

    await audit(req.session.user.email, 'endorsement_deleted', 'Deleted endorsement #' + endorsementId);
    res.json({ success: true });
  }));

  // =============================================
  // FEATURE 6: DONATION WISH LIST
  // =============================================

  // API: Create wishlist item
  app.post('/api/wishlists', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, item_name, item_description, estimated_cost, quantity_needed, priority } = req.body;

    if (!item_name) return res.status(400).json({ error: 'item_name is required' });

    const result = await pool.query(
      'INSERT INTO donation_wishlists (tenant_id, campaign_id, item_name, item_description, estimated_cost, quantity_needed, priority) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, campaign_id || null, esc(item_name), esc(item_description || ''), parseInt(estimated_cost) || 0, parseInt(quantity_needed) || 1, esc(priority || 'medium')]
    );

    await audit(req.session.user.email, 'wishlist_created', 'Created wishlist item "' + item_name + '"');
    res.json(result.rows[0]);
  }));

  // API: Get wishlist items
  app.get('/api/wishlists', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.query;

    let query = 'SELECT w.*, (SELECT COALESCE(SUM(amount),0) FROM wishlist_fulfillments WHERE wishlist_id=w.id AND tenant_id=$1) AS total_fulfilled_amount, (SELECT COUNT(*) FROM wishlist_fulfillments WHERE wishlist_id=w.id AND tenant_id=$1) AS fulfillment_count FROM donation_wishlists w WHERE w.tenant_id=$1';
    const params = [t];

    if (campaign_id) {
      query += ' AND w.campaign_id=$2';
      params.push(parseInt(campaign_id));
    }
    query += ' ORDER BY CASE priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END, w.created_at DESC';

    const items = (await pool.query(query, params)).rows;
    res.json(items);
  }));

  // API: Fulfill wishlist item
  app.post('/api/wishlists/:id/fulfill', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const wishlistId = parseInt(req.params.id);
    const { donor_name, amount } = req.body;

    if (!donor_name) return res.status(400).json({ error: 'donor_name is required' });

    const item = (await pool.query('SELECT * FROM donation_wishlists WHERE id=$1 AND tenant_id=$2', [wishlistId, t])).rows[0];
    if (!item) return res.status(404).json({ error: 'Wishlist item not found' });

    const fulfillAmount = parseInt(amount) || item.estimated_cost;

    const result = await pool.query(
      'INSERT INTO wishlist_fulfillments (tenant_id, wishlist_id, donor_name, amount) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, wishlistId, esc(donor_name), fulfillAmount]
    );

    // Update quantity fulfilled
    const newFulfilled = item.quantity_fulfilled + 1;
    const isFullyFulfilled = newFulfilled >= item.quantity_needed;
    await pool.query('UPDATE donation_wishlists SET quantity_fulfilled=$1 WHERE id=$2 AND tenant_id=$3', [newFulfilled, wishlistId, t]);

    if (donor_name && sendEmail) {
      try {
        sendEmail(donor_name, 'Thank You for Fulfilling a Wish!', '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white"><h1>Thank You!</h1></div><div style="padding:30px;background:white;border:1px solid #e2e8f0;border-radius:0 0 12px 12px"><p>Thank you for fulfilling the wish: <strong>' + esc(item.item_name) + '</strong>.</p><p>Your generosity of <strong>UGX ' + fulfillAmount.toLocaleString() + '</strong> makes a real difference!</p></div></div>');
      } catch(e) {}
    }

    res.json({ fulfillment: result.rows[0], item_fully_fulfilled: isFullyFulfilled });
  }));

  // API: Delete wishlist item
  app.delete('/api/wishlists/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const wishlistId = parseInt(req.params.id);

    // Delete fulfillments first
    await pool.query('DELETE FROM wishlist_fulfillments WHERE wishlist_id=$1 AND tenant_id=$2', [wishlistId, t]);
    const result = await pool.query('DELETE FROM donation_wishlists WHERE id=$1 AND tenant_id=$2 RETURNING id', [wishlistId, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Wishlist item not found' });

    await audit(req.session.user.email, 'wishlist_deleted', 'Deleted wishlist item #' + wishlistId);
    res.json({ success: true });
  }));

  // UI: Wishlist Page
  app.get('/wishlist', ah(async (req, res) => {
    const t = req.session.user.tenant_id;

    const items = (await pool.query(`
      SELECT w.*, fc.title AS campaign_title,
        (SELECT COALESCE(SUM(amount),0) FROM wishlist_fulfillments WHERE wishlist_id=w.id AND tenant_id=$1) AS total_fulfilled_amount,
        (SELECT COUNT(*) FROM wishlist_fulfillments WHERE wishlist_id=w.id AND tenant_id=$1) AS fulfillment_count
      FROM donation_wishlists w
      LEFT JOIN fundraising_campaigns fc ON w.campaign_id = fc.id
      WHERE w.tenant_id=$1
      ORDER BY CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, w.created_at DESC
    `, [t])).rows;

    const urgentCount = items.filter(i => i.priority === 'urgent' || i.priority === 'high').length;
    const fulfilledCount = items.filter(i => parseInt(i.quantity_fulfilled) >= parseInt(i.quantity_needed)).length;
    const totalCost = items.reduce((s, i) => s + (parseInt(i.estimated_cost) || 0), 0);
    const totalFulfilled = items.reduce((s, i) => s + (parseInt(i.total_fulfilled_amount) || 0), 0);

    res.send(renderPage('Donation Wish List', `
      <div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa)">
        <h1>Donation Wish List</h1>
        <p>Help fulfill specific needs — every item makes a difference</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${items.length}</div><div>Items Needed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${urgentCount}</div><div>Urgent/High</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fulfilledCount}</div><div>Fulfilled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${totalCost.toLocaleString()}</div><div>Total Need</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">UGX ${totalFulfilled.toLocaleString()}</div><div>Total Fulfilled</div></div>
      </div>

      ${req.session.user ? '<div style="margin-bottom:20px"><button onclick="document.getElementById(\'addWishForm\').style.display=\'block\'" class="btn btn-green">+ Add Wish Item</button></div><div id="addWishForm" style="display:none" class="card"><h3>Add Wish List Item</h3><form method="POST" action="/wishlist/add"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-weight:600;display:block;margin-bottom:4px">Item Name *</label><input name="item_name" required style="width:100%"></div><div><label style="font-weight:600;display:block;margin-bottom:4px">Campaign</label><select name="campaign_id" style="width:100%"><option value="">General</option></select></div><div><label style="font-weight:600;display:block;margin-bottom:4px">Estimated Cost (UGX)</label><input name="estimated_cost" type="number" style="width:100%"></div><div><label style="font-weight:600;display:block;margin-bottom:4px">Quantity Needed</label><input name="quantity_needed" type="number" min="1" value="1" style="width:100%"></div><div><label style="font-weight:600;display:block;margin-bottom:4px">Priority</label><select name="priority" style="width:100%"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></div></div><div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="item_description" rows="2" style="width:100%"></textarea></div><div style="margin-top:12px;display:flex;gap:10px"><button type="submit" class="btn btn-green">Add Item</button><button type="button" onclick="document.getElementById(\'addWishForm\').style.display=\'none\'" class="btn btn-sm">Cancel</button></div></form></div>' : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:20px">
        ${items.length ? items.map(item => {
          const pct = item.quantity_needed > 0 ? Math.min(100, Math.round(parseInt(item.quantity_fulfilled) / parseInt(item.quantity_needed) * 100)) : 0;
          const isComplete = pct >= 100;
          const priorityColor = item.priority === 'urgent' ? '#ef4444' : item.priority === 'high' ? '#f59e0b' : item.priority === 'medium' ? '#3b82f6' : '#6b7280';
          return `<div class="card" style="border-left:4px solid ${priorityColor};${isComplete ? 'opacity:0.7' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <h3 style="margin:0">${esc(item.item_name)}</h3>
              <span class="tag" style="background:${priorityColor}20;color:${priorityColor}">${esc(item.priority)}</span>
            </div>
            ${item.item_description ? '<p class="muted" style="margin:4px 0;font-size:13px">' + esc(item.item_description) + '</p>' : ''}
            ${item.campaign_title ? '<p style="font-size:12px;color:#64748b">Campaign: ' + esc(item.campaign_title) + '</p>' : ''}
            <div style="margin-top:10px">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                <span>${item.quantity_fulfilled} / ${item.quantity_needed} fulfilled</span>
                <span style="font-weight:700;color:${isComplete ? '#059669' : '#64748b'}">${pct}%</span>
              </div>
              <div style="background:#e2e8f0;height:8px;border-radius:4px"><div style="background:${isComplete ? '#059669' : '#3b82f6'};height:8px;border-radius:4px;width:${pct}%"></div></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:13px">
              <span class="muted">Est. UGX ${(parseInt(item.estimated_cost)||0).toLocaleString()}</span>
              <span class="muted">Raised: UGX ${(parseInt(item.total_fulfilled_amount)||0).toLocaleString()}</span>
            </div>
            ${!isComplete ? '<button onclick="fulfillWish(' + item.id + ',\'' + esc(item.item_name).replace(/'/g, "\\'") + '\')" class="btn btn-green btn-sm" style="width:100%;margin-top:10px">Fulfill This Wish</button>' : '<div style="text-align:center;margin-top:10px;color:#059669;font-weight:700">✓ Fully Fulfilled!</div>'}
          </div>`;
        }).join('') : '<p class="muted" style="text-align:center;padding:40px;grid-column:1/-1">No wish list items yet.</p>'}
      </div>

      <div id="fulfillModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
        <div style="background:white;padding:30px;border-radius:12px;max-width:400px;width:90%">
          <h3>Fulfill: <span id="fulfillItemName"></span></h3>
          <form method="POST" action="/wishlist/fulfill">
            <input type="hidden" name="wishlist_id" id="fulfillWishlistId">
            <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Your Name *</label><input name="donor_name" required style="width:100%"></div>
            <div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Amount (UGX)</label><input name="amount" type="number" style="width:100%"></div>
            <div style="margin-top:16px;display:flex;gap:10px"><button type="submit" class="btn btn-green" style="flex:1">Fulfill</button><button type="button" onclick="document.getElementById('fulfillModal').style.display='none'" class="btn btn-sm" style="flex:1">Cancel</button></div>
          </form>
        </div>
      </div>

      <script>
        function fulfillWish(id, name) {
          document.getElementById('fulfillWishlistId').value = id;
          document.getElementById('fulfillItemName').textContent = name;
          document.getElementById('fulfillModal').style.display = 'flex';
        }
      </script>
    `, req.session.user));
  }));

  // UI: Add wish list item (form handler)
  app.post('/wishlist/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, item_name, item_description, estimated_cost, quantity_needed, priority } = req.body;

    if (!item_name) return res.redirect('/wishlist');

    await pool.query(
      'INSERT INTO donation_wishlists (tenant_id, campaign_id, item_name, item_description, estimated_cost, quantity_needed, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, campaign_id || null, esc(item_name), esc(item_description || ''), parseInt(estimated_cost) || 0, parseInt(quantity_needed) || 1, esc(priority || 'medium')]
    );
    await audit(req.session.user.email, 'wishlist_created', 'Created wishlist item "' + item_name + '"');
    res.redirect('/wishlist');
  }));

  // UI: Fulfill wish list item (form handler)
  app.post('/wishlist/fulfill', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { wishlist_id, donor_name, amount } = req.body;

    if (!wishlist_id || !donor_name) return res.redirect('/wishlist');

    const item = (await pool.query('SELECT * FROM donation_wishlists WHERE id=$1 AND tenant_id=$2', [parseInt(wishlist_id), t])).rows[0];
    if (!item) return res.redirect('/wishlist');

    const fulfillAmount = parseInt(amount) || item.estimated_cost;

    await pool.query(
      'INSERT INTO wishlist_fulfillments (tenant_id, wishlist_id, donor_name, amount) VALUES ($1,$2,$3,$4)',
      [t, parseInt(wishlist_id), esc(donor_name), fulfillAmount]
    );

    const newFulfilled = item.quantity_fulfilled + 1;
    await pool.query('UPDATE donation_wishlists SET quantity_fulfilled=$1 WHERE id=$2 AND tenant_id=$3', [newFulfilled, parseInt(wishlist_id), t]);

    res.redirect('/wishlist');
  }));

  // =============================================
  // FEATURE 7: CORPORATE MATCHING PORTAL
  // =============================================

  // API: Get corporate matchers
  app.get('/api/corporate-matchers', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const matchers = (await pool.query('SELECT * FROM corporate_matchers WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    res.json(matchers);
  }));

  // API: Create corporate matcher
  app.post('/api/corporate-matchers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { company_name, contact_email, match_ratio, max_annual_match, is_active } = req.body;

    if (!company_name) return res.status(400).json({ error: 'company_name is required' });

    const result = await pool.query(
      'INSERT INTO corporate_matchers (tenant_id, company_name, contact_email, match_ratio, max_annual_match, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(company_name), esc(contact_email || ''), parseFloat(match_ratio) || 1.0, parseInt(max_annual_match) || 0, is_active !== false]
    );

    await audit(req.session.user.email, 'corporate_matcher_created', 'Created corporate matcher "' + company_name + '"');
    res.json(result.rows[0]);
  }));

  // API: Submit a match claim
  app.post('/api/corporate-match/:matcherId/claim', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const matcherId = parseInt(req.params.matcherId);
    const { donor_email, donation_id, original_amount } = req.body;

    const matcher = (await pool.query('SELECT * FROM corporate_matchers WHERE id=$1 AND tenant_id=$2 AND is_active=true', [matcherId, t])).rows[0];
    if (!matcher) return res.status(404).json({ error: 'Corporate matcher not found or inactive' });

    const origAmount = parseInt(original_amount) || 0;
    const matchAmount = Math.min(Math.round(origAmount * parseFloat(matcher.match_ratio)), matcher.max_annual_match - matcher.current_year_matched);

    if (matchAmount <= 0) return res.status(400).json({ error: 'No matching funds remaining this year' });

    const result = await pool.query(
      'INSERT INTO corporate_match_claims (tenant_id, matcher_id, donor_email, donation_id, original_amount, matched_amount, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, matcherId, esc(donor_email || ''), donation_id || null, origAmount, matchAmount, 'pending']
    );

    // Update current year matched
    await pool.query('UPDATE corporate_matchers SET current_year_matched = current_year_matched + $1 WHERE id=$2 AND tenant_id=$3', [matchAmount, matcherId, t]);

    await audit(req.session.user.email, 'match_claim_submitted', 'Submitted match claim for ' + matcher.company_name + ': UGX ' + matchAmount);

    // Notify matcher contact
    if (matcher.contact_email) {
      try {
        notify(t, matcher.contact_email, 'New Match Claim', 'A new match claim of UGX ' + matchAmount.toLocaleString() + ' has been submitted by ' + (donor_email || 'a donor'), 'fundraising');
      } catch(e) {}
    }

    res.json(result.rows[0]);
  }));

  // API: Update match claim status
  app.put('/api/corporate-match-claims/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const claimId = parseInt(req.params.id);
    const { status } = req.body;

    if (!['pending','approved','rejected','paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be pending, approved, rejected, or paid' });
    }

    const claim = (await pool.query('SELECT * FROM corporate_match_claims WHERE id=$1 AND tenant_id=$2', [claimId, t])).rows[0];
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    // If rejecting, refund the matched amount
    if (status === 'rejected' && claim.status !== 'rejected') {
      await pool.query('UPDATE corporate_matchers SET current_year_matched = GREATEST(0, current_year_matched - $1) WHERE id=$2 AND tenant_id=$3', [claim.matched_amount, claim.matcher_id, t]);
    }

    await pool.query('UPDATE corporate_match_claims SET status=$1 WHERE id=$2 AND tenant_id=$3', [status, claimId, t]);
    await audit(req.session.user.email, 'match_claim_updated', 'Updated match claim #' + claimId + ' to status: ' + status);

    // Notify donor
    if (claim.donor_email) {
      notify(t, claim.donor_email, 'Match Claim ' + status.charAt(0).toUpperCase() + status.slice(1),
        'Your corporate match claim of UGX ' + (parseInt(claim.matched_amount)||0).toLocaleString() + ' has been ' + status, 'fundraising');
    }

    const updated = (await pool.query('SELECT * FROM corporate_match_claims WHERE id=$1 AND tenant_id=$2', [claimId, t])).rows[0];
    res.json(updated);
  }));

  // =============================================
  // FEATURE 8: MULTI-CURRENCY DISPLAY
  // =============================================

  // API: Get currency settings
  app.get('/api/currency-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const settings = (await pool.query('SELECT * FROM currency_display_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings) {
      // Create default settings
      const result = await pool.query(
        `INSERT INTO currency_display_settings (tenant_id, base_currency, supported_currencies_json, exchange_rates_json, auto_update, updated_at)
         VALUES ($1, 'UGX', $2, $3, false, NOW()) RETURNING *`,
        [t,
          JSON.stringify(['UGX','USD','EUR','GBP','KES','TZS']),
          JSON.stringify({ UGX:1, USD:0.00027, EUR:0.00025, GBP:0.00021, KES:0.035, TZS:0.62 })
        ]
      );
      return res.json(result.rows[0]);
    }
    res.json(settings);
  }));

  // API: Update currency settings
  app.put('/api/currency-settings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { base_currency, supported_currencies, exchange_rates, auto_update } = req.body;

    const ratesJson = exchange_rates ? (typeof exchange_rates === 'string' ? exchange_rates : JSON.stringify(exchange_rates)) : null;
    const currenciesJson = supported_currencies ? (typeof supported_currencies === 'string' ? supported_currencies : JSON.stringify(supported_currencies)) : null;

    const result = await pool.query(`
      INSERT INTO currency_display_settings (tenant_id, base_currency, supported_currencies_json, exchange_rates_json, auto_update, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        base_currency = COALESCE($2, currency_display_settings.base_currency),
        supported_currencies_json = COALESCE($3, currency_display_settings.supported_currencies_json),
        exchange_rates_json = COALESCE($4, currency_display_settings.exchange_rates_json),
        auto_update = COALESCE($5, currency_display_settings.auto_update),
        updated_at = NOW()
      RETURNING *
    `, [t, esc(base_currency || null), currenciesJson, ratesJson, auto_update !== undefined ? auto_update : null]);

    await audit(req.session.user.email, 'currency_settings_updated', 'Updated multi-currency display settings');
    res.json(result.rows[0]);
  }));

  // API: Convert amount between currencies
  app.get('/api/convert-amount', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { amount, from, to } = req.query;

    if (!amount || !from || !to) return res.status(400).json({ error: 'amount, from, and to are required' });

    const settings = (await pool.query('SELECT * FROM currency_display_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings) return res.status(404).json({ error: 'Currency settings not found' });

    const rates = typeof settings.exchange_rates_json === 'string' ? JSON.parse(settings.exchange_rates_json) : settings.exchange_rates_json;

    // Convert: amount in 'from' -> base currency -> 'to'
    const fromRate = parseFloat(rates[from]) || 1;
    const toRate = parseFloat(rates[to]) || 1;

    if (fromRate === 0) return res.status(400).json({ error: 'Invalid source currency rate' });

    const baseAmount = parseFloat(amount) / fromRate;
    const converted = baseAmount * toRate;

    res.json({
      original: { amount: parseFloat(amount), currency: from },
      converted: { amount: parseFloat(converted.toFixed(2)), currency: to },
      rate: parseFloat((toRate / fromRate).toFixed(6)),
      base_currency: settings.base_currency
    });
  }));

  // =============================================
  // FEATURE 9: CAMPAIGN QR MENU
  // =============================================

  // API: Get QR menu data for a campaign
  app.get('/api/campaigns/:id/qr-menu', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);

    const campaign = (await pool.query(`
      SELECT fc.*, t.name AS org_name,
        (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND tenant_id=fc.tenant_id) AS raised,
        (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id AND tenant_id=fc.tenant_id) AS donor_count
      FROM fundraising_campaigns fc
      JOIN tenants t ON fc.tenant_id = t.id
      WHERE fc.id = $1 AND fc.tenant_id = $2
    `, [campaignId, t])).rows[0];

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const donateUrl = BASE_URL + '/discover/' + campaign.id + '/donate';
    const shareUrl = BASE_URL + '/discover/' + campaign.id;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(donateUrl);
    const qrShareUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(shareUrl);

    const pct = parseInt(campaign.target) > 0 ? Math.min(100, Math.round(parseInt(campaign.raised || 0) / parseInt(campaign.target) * 100)) : 0;

    res.json({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        description: campaign.description,
        org_name: campaign.org_name,
        target: parseInt(campaign.target) || 0,
        raised: parseInt(campaign.raised) || 0,
        donor_count: parseInt(campaign.donor_count) || 0,
        progress_pct: pct,
        category: campaign.category,
        status: campaign.status
      },
      qr_codes: {
        donate: { url: donateUrl, qr_image: qrApiUrl },
        share: { url: shareUrl, qr_image: qrShareUrl }
      },
      share_links: {
        whatsapp: 'https://wa.me/?text=' + encodeURIComponent('Support "' + campaign.title + '" - ' + donateUrl),
        twitter: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent('Support "' + campaign.title + '"') + '&url=' + encodeURIComponent(shareUrl),
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl),
        email: 'mailto:?subject=' + encodeURIComponent('Support: ' + campaign.title) + '&body=' + encodeURIComponent('I thought you might want to support this: ' + donateUrl)
      }
    });
  }));

  // UI: Campaign QR Menu Page
  app.get('/campaign-qr', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;

    const campaigns = (await pool.query(`
      SELECT fc.id, fc.title, fc.target,
        (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND tenant_id=fc.tenant_id) AS raised
      FROM fundraising_campaigns fc
      WHERE fc.tenant_id = $1
      ORDER BY fc.created_at DESC LIMIT 50
    `, [t])).rows;

    res.send(renderPage('Campaign QR Menu', `
      <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#06b6d4)">
        <h1>Campaign QR Menu</h1>
        <p>Generate QR codes for your campaigns — print, share, scan to donate</p>
      </div>

      <div class="card">
        <h2>Select a Campaign</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
          <input id="campaignSearch" placeholder="Search campaigns..." style="flex:1;min-width:200px" oninput="filterCampaigns()">
        </div>
        ${campaigns.length ? '<div id="campaignList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">' +
          campaigns.map(c => {
            const pct = parseInt(c.target) > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target)*100)) : 0;
            const donateUrl = BASE_URL + '/discover/' + c.id + '/donate';
            const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(donateUrl);
            return `<div class="card campaign-card" style="text-align:center;padding:20px;cursor:pointer" onclick="showQR(${c.id},'${esc(c.title).replace(/'/g,"\\'")}','${qrUrl}','${donateUrl}')">
              <div style="background:white;padding:10px;border-radius:8px;display:inline-block;margin-bottom:10px;border:1px solid #e2e8f0">
                <img src="${qrUrl}" alt="QR" style="width:100px;height:100px" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23f1f5f9%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-size=%2212%22>QR</text></svg>'">
              </div>
              <h4 style="margin:8px 0 4px">${esc(c.title)}</h4>
              <div style="font-size:13px;color:#64748b">UGX ${(parseInt(c.raised)||0).toLocaleString()} / ${(parseInt(c.target)||0).toLocaleString()} (${pct}%)</div>
            </div>`;
          }).join('') + '</div>' :
          '<p class="muted" style="text-align:center;padding:40px">No campaigns yet. <a href="/fundraising" class="btn btn-sm">Create Campaign</a></p>'}
      </div>

      <div id="qrModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center">
        <div style="background:white;padding:30px;border-radius:16px;max-width:500px;width:90%;text-align:center">
          <h2 id="qrCampaignName"></h2>
          <div style="background:white;padding:20px;border-radius:12px;display:inline-block;margin:20px 0;border:2px solid #e2e8f0">
            <img id="qrModalImage" alt="QR Code" style="width:250px;height:250px">
          </div>
          <p class="muted" style="margin-bottom:16px;font-size:13px">Scan this QR code to go directly to the donation page</p>
          <div style="margin-bottom:16px">
            <code id="qrModalUrl" style="background:#f1f5f9;padding:8px 16px;border-radius:8px;font-size:12px;word-break:break-all;display:block"></code>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
            <a id="qrDownloadLink" download class="btn btn-green">Download QR Image</a>
            <button onclick="copyUrl()" class="btn btn-sm">Copy Link</button>
            <button onclick="document.getElementById('qrModal').style.display='none'" class="btn btn-sm">Close</button>
          </div>
          <div style="margin-top:20px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <a id="shareWhatsapp" target="_blank" class="btn btn-sm" style="background:#25d366;color:white">WhatsApp</a>
            <a id="shareTwitter" target="_blank" class="btn btn-sm" style="background:#1da1f2;color:white">Twitter</a>
            <a id="shareFacebook" target="_blank" class="btn btn-sm" style="background:#1877f2;color:white">Facebook</a>
          </div>
        </div>
      </div>

      <script>
        function showQR(id, name, qrUrl, donateUrl) {
          document.getElementById('qrCampaignName').textContent = name;
          document.getElementById('qrModalImage').src = qrUrl.replace('200x200','400x400');
          document.getElementById('qrModalUrl').textContent = donateUrl;
          document.getElementById('qrDownloadLink').href = qrUrl.replace('200x200','400x400');
          document.getElementById('shareWhatsapp').href = 'https://wa.me/?text=' + encodeURIComponent('Support "' + name + '" - ' + donateUrl);
          document.getElementById('shareTwitter').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent('Support "' + name + '"') + '&url=' + encodeURIComponent(donateUrl);
          document.getElementById('shareFacebook').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(donateUrl);
          document.getElementById('qrModal').style.display = 'flex';
        }
        function copyUrl() {
          var url = document.getElementById('qrModalUrl').textContent;
          navigator.clipboard.writeText(url).then(function(){ alert('Link copied!'); });
        }
        function filterCampaigns() {
          var search = document.getElementById('campaignSearch').value.toLowerCase();
          document.querySelectorAll('.campaign-card').forEach(function(card) {
            card.style.display = card.textContent.toLowerCase().includes(search) ? '' : 'none';
          });
        }
      </script>
    `, req.session.user));
  }));

  // =============================================
  // FEATURE 10: DONOR THANK-YOU VIDEOS
  // =============================================

  // API: Create thank-you video
  app.post('/api/thank-you-videos', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, video_url, title, thumbnail_url } = req.body;

    if (!video_url || !title) return res.status(400).json({ error: 'video_url and title are required' });

    const result = await pool.query(
      'INSERT INTO thank_you_videos (tenant_id, campaign_id, video_url, title, thumbnail_url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, campaign_id || null, esc(video_url), esc(title), esc(thumbnail_url || '')]
    );

    await audit(req.session.user.email, 'thank_you_video_created', 'Created thank-you video "' + title + '"');

    // Notify donors about the new thank-you video
    try {
      if (campaign_id) {
        const donors = (await pool.query(`
          SELECT DISTINCT ON (cd.donor_name) cd.donor_name, cd.donor_email FROM campaign_donations cd
          JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
          WHERE fc.tenant_id = $1 AND cd.campaign_id = $2 AND cd.donor_email IS NOT NULL
        `, [t, campaign_id])).rows;

        for (const d of donors) {
          if (d.donor_email) {
            notify(t, d.donor_email, 'A Thank You Video Just for You!', 'A new thank-you video "' + title + '" has been posted. Check it out!', 'fundraising');
            try {
              sendEmail(d.donor_email, 'A Thank You Video Just for You!', '<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white"><h1>Thank You!</h1></div><div style="padding:30px;background:white;border:1px solid #e2e8f0;border-radius:0 0 12px 12px"><p>Dear ' + esc(d.donor_name || 'Donor') + ',</p><p>We just posted a thank-you video: <strong>' + esc(title) + '</strong></p><a href="' + esc(video_url) + '" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">Watch Video</a></div></div>');
            } catch(e) {}
          }
        }
      }
    } catch(e) { console.warn('[ThankYouVideo Notify]', e.message); }

    res.json(result.rows[0]);
  }));

  // API: Get thank-you videos
  app.get('/api/thank-you-videos', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.query;

    let query = `SELECT tv.*, fc.title AS campaign_title,
      (SELECT COUNT(*) FROM thank_you_video_views WHERE video_id=tv.id AND tenant_id=$1) AS view_count
      FROM thank_you_videos tv
      LEFT JOIN fundraising_campaigns fc ON tv.campaign_id = fc.id
      WHERE tv.tenant_id=$1`;
    const params = [t];

    if (campaign_id) {
      query += ' AND tv.campaign_id=$2';
      params.push(parseInt(campaign_id));
    }
    query += ' ORDER BY tv.created_at DESC';

    const videos = (await pool.query(query, params)).rows;
    res.json(videos);
  }));

  // API: Track video view
  app.post('/api/thank-you-videos/:id/view', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const videoId = parseInt(req.params.id);
    const { viewer_email } = req.body;

    const video = (await pool.query('SELECT * FROM thank_you_videos WHERE id=$1 AND tenant_id=$2', [videoId, t])).rows[0];
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const result = await pool.query(
      'INSERT INTO thank_you_video_views (tenant_id, video_id, viewer_email) VALUES ($1,$2,$3) RETURNING *',
      [t, videoId, esc(viewer_email || '')]
    );

    res.json({ success: true, view: result.rows[0] });
  }));

  // UI: Thank-You Videos Page
  app.get('/thank-you-videos', ah(async (req, res) => {
    const t = req.session.user.tenant_id;

    const videos = (await pool.query(`
      SELECT tv.*, fc.title AS campaign_title,
        (SELECT COUNT(*) FROM thank_you_video_views WHERE video_id=tv.id AND tenant_id=$1) AS view_count
      FROM thank_you_videos tv
      LEFT JOIN fundraising_campaigns fc ON tv.campaign_id = fc.id
      WHERE tv.tenant_id=$1
      ORDER BY tv.created_at DESC
    `, [t])).rows;

    const totalViews = videos.reduce((s, v) => s + (parseInt(v.view_count) || 0), 0);

    res.send(renderPage('Thank You Videos', `
      <div class="hero" style="background:linear-gradient(135deg,#ec4899,#f43f5e)">
        <h1>Thank You Videos</h1>
        <p>Personalized gratitude from the campaigns you support</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">${videos.length}</div><div>Videos</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalViews}</div><div>Total Views</div></div>
      </div>

      ${req.session.user ? '<div style="margin-bottom:20px"><button onclick="document.getElementById(\'addVideoForm\').style.display=\'block\'" class="btn btn-green">+ Add Thank You Video</button></div><div id="addVideoForm" style="display:none" class="card"><h3>Add Thank You Video</h3><form method="POST" action="/thank-you-videos/add"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="font-weight:600;display:block;margin-bottom:4px">Title *</label><input name="title" required placeholder="Thank you from our team!" style="width:100%"></div><div><label style="font-weight:600;display:block;margin-bottom:4px">Campaign</label><select name="campaign_id" style="width:100%"><option value="">All Campaigns</option></select></div></div><div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Video URL *</label><input name="video_url" required placeholder="https://youtube.com/watch?v=..." style="width:100%"></div><div style="margin-top:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Thumbnail URL</label><input name="thumbnail_url" placeholder="https://img.youtube.com/vi/.../maxresdefault.jpg" style="width:100%"></div><div style="margin-top:16px;display:flex;gap:10px"><button type="submit" class="btn btn-green">Add Video</button><button type="button" onclick="document.getElementById(\'addVideoForm\').style.display=\'none\'" class="btn btn-sm">Cancel</button></div></form></div>' : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;margin-top:20px">
        ${videos.length ? videos.map(v => {
          const embedUrl = v.video_url.includes('youtube.com/watch') ?
            v.video_url.replace('watch?v=', 'embed/') :
            v.video_url.includes('youtu.be/') ?
            'https://www.youtube.com/embed/' + v.video_url.split('youtu.be/')[1] :
            null;
          const thumb = v.thumbnail_url || (v.video_url.includes('youtube.com/watch') ?
            'https://img.youtube.com/vi/' + v.video_url.split('v=')[1]?.split('&')[0] + '/hqdefault.jpg' :
            v.video_url.includes('youtu.be/') ?
            'https://img.youtube.com/vi/' + v.video_url.split('youtu.be/')[1]?.split('?')[0] + '/hqdefault.jpg' :
            '');

          return `<div class="card" style="overflow:hidden">
            <div style="position:relative;padding-top:56.25%;background:#0f172a">
              ${embedUrl ? '<iframe src="' + esc(embedUrl) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allowfullscreen loading="lazy"></iframe>' :
                thumb ? '<a href="' + esc(v.video_url) + '" target="_blank"><img src="' + esc(thumb) + '" alt="' + esc(v.title) + '" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<div style=position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;font-size:48px>&#9654;</div>\'"><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:48px;color:white;opacity:0.8">&#9654;</div></a>' :
                '<a href="' + esc(v.video_url) + '" target="_blank" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:white;font-size:48px;text-decoration:none">&#9654;</a>'}
            </div>
            <div style="padding:16px">
              <h3 style="margin:0 0 6px">${esc(v.title)}</h3>
              ${v.campaign_title ? '<p style="font-size:13px;color:#64748b;margin:0 0 6px">Campaign: ' + esc(v.campaign_title) + '</p>' : ''}
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                <span style="font-size:12px;color:#94a3b8">${new Date(v.created_at).toLocaleDateString()}</span>
                <span style="font-size:12px;color:#94a3b8">${parseInt(v.view_count) || 0} views</span>
              </div>
            </div>
          </div>`;
        }).join('') : '<p class="muted" style="text-align:center;padding:60px;grid-column:1/-1">No thank-you videos yet. Be the first to add one!</p>'}
      </div>
    `, req.session.user));
  }));

  // UI: Add thank-you video (form handler)
  app.post('/thank-you-videos/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, video_url, title, thumbnail_url } = req.body;

    if (!video_url || !title) return res.redirect('/thank-you-videos');

    await pool.query(
      'INSERT INTO thank_you_videos (tenant_id, campaign_id, video_url, title, thumbnail_url) VALUES ($1,$2,$3,$4,$5)',
      [t, campaign_id || null, esc(video_url), esc(title), esc(thumbnail_url || '')]
    );
    await audit(req.session.user.email, 'thank_you_video_created', 'Created thank-you video "' + title + '"');
    res.redirect('/thank-you-videos');
  }));

  console.log('[FundraisingMega2] All 10 features loaded');
};
