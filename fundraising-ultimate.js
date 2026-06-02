/**
 * Fundraising Ultimate Module — 10 Advanced Fundraising Features
 * Features:
 *  1. Recurring Auto-Donations
 *  2. Impact Calculator
 *  3. Donor Loyalty Tiers
 *  4. Campaign Performance Grader
 *  5. Emergency/Urgent Mode
 *  6. Harambee Mode
 *  7. WhatsApp Donate Bot
 *  8. Mobile Money Auto-Detect
 *  9. Funeral/Burial Fund
 * 10. AI Campaign Story Writer
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // 1. Recurring Auto-Donations
    `CREATE TABLE IF NOT EXISTS recurring_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      donor_email TEXT,
      donor_phone TEXT,
      campaign_id INTEGER,
      amount INTEGER NOT NULL,
      frequency TEXT DEFAULT 'monthly' CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
      next_charge_date DATE NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','cancelled','completed','failed')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 2. Impact Calculator)
    `CREATE TABLE IF NOT EXISTS impact_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      amount_per_unit INTEGER NOT NULL,
      unit_label TEXT NOT NULL,
      icon TEXT DEFAULT '❤️',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS campaign_impact_goals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      impact_item_id INTEGER REFERENCES impact_items(id) ON DELETE CASCADE,
      target_units INTEGER NOT NULL DEFAULT 0,
      achieved_units INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3. Donor Loyalty Tiers)
    `CREATE TABLE IF NOT EXISTS donor_loyalty_tiers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      min_points INTEGER NOT NULL DEFAULT 0,
      max_points INTEGER,
      badge_color TEXT DEFAULT '#6b7280',
      benefits TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS donor_loyalty_ledger (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 4. Campaign Performance Grader)
    `CREATE TABLE IF NOT EXISTS campaign_grades (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      grade TEXT NOT NULL,
      score NUMERIC(5,2) NOT NULL DEFAULT 0,
      metrics_json JSONB DEFAULT '{}',
      graded_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 5. Emergency/Urgent Mode)
    `CREATE TABLE IF NOT EXISTS emergency_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      urgency_level TEXT DEFAULT 'high' CHECK (urgency_level IN ('low','medium','high','critical')),
      deadline TIMESTAMPTZ,
      goal_amount INTEGER NOT NULL DEFAULT 0,
      raised_amount INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      activated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 6. Harambee Mode)
    `CREATE TABLE IF NOT EXISTS harambee_pools (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      goal INTEGER NOT NULL DEFAULT 0,
      total_contributed INTEGER NOT NULL DEFAULT 0,
      contributor_count INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS harambee_contributions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      pool_id INTEGER REFERENCES harambee_pools(id) ON DELETE CASCADE,
      contributor_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS harambee_distributions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      pool_id INTEGER REFERENCES harambee_pools(id) ON DELETE CASCADE,
      recipient_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      purpose TEXT,
      distributed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7. WhatsApp Donate Bot)
    `CREATE TABLE IF NOT EXISTS whatsapp_donate_config (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      business_name TEXT,
      welcome_message TEXT DEFAULT 'Welcome! Reply with DONATE to start giving.',
      is_active BOOLEAN DEFAULT true,
      UNIQUE(tenant_id)
    )`,
    `CREATE TABLE IF NOT EXISTS whatsapp_donate_sessions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      phone_number TEXT NOT NULL,
      session_data_json JSONB DEFAULT '{}',
      current_step TEXT DEFAULT 'welcome',
      campaign_id INTEGER,
      amount INTEGER,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','expired','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 8. Mobile Money Auto-Detect)
    `CREATE TABLE IF NOT EXISTS mobile_money_providers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      country_code TEXT DEFAULT 'UG',
      ussd_code TEXT,
      prefix_patterns TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS donation_payment_attempts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER,
      phone_number TEXT NOT NULL,
      detected_provider TEXT,
      provider_id INTEGER REFERENCES mobile_money_providers(id),
      status TEXT DEFAULT 'initiated' CHECK (status IN ('initiated','pending','completed','failed','timed_out')),
      initiated_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`,

    // 9. Funeral/Burial Fund)
    `CREATE TABLE IF NOT EXISTS funeral_funds (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      monthly_contribution INTEGER NOT NULL DEFAULT 0,
      total_members INTEGER NOT NULL DEFAULT 0,
      total_balance INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS funeral_contributions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      fund_id INTEGER REFERENCES funeral_funds(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      contribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 10. AI Campaign Story Writer)
    `CREATE TABLE IF NOT EXISTS ai_campaign_stories (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      story_text TEXT NOT NULL,
      story_type TEXT DEFAULT 'appeal' CHECK (story_type IN ('appeal','update','thank_you','impact_report','social_media')),
      generated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Indexes)
    `CREATE INDEX IF NOT EXISTS idx_recurring_donations_tenant ON recurring_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_donations_status ON recurring_donations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_items_tenant ON impact_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_impact_goals_tenant ON campaign_impact_goals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_loyalty_tiers_tenant ON donor_loyalty_tiers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_loyalty_ledger_tenant ON donor_loyalty_ledger(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_loyalty_ledger_email ON donor_loyalty_ledger(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_grades_tenant ON campaign_grades(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_emergency_campaigns_tenant ON emergency_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_harambee_pools_tenant ON harambee_pools(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_harambee_contributions_pool ON harambee_contributions(pool_id)`,
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_donate_config_tenant ON whatsapp_donate_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_donate_sessions_tenant ON whatsapp_donate_sessions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mobile_money_providers_tenant ON mobile_money_providers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_payment_attempts_tenant ON donation_payment_attempts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_funeral_funds_tenant ON funeral_funds(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_funeral_contributions_fund ON funeral_contributions(fund_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_campaign_stories_tenant ON ai_campaign_stories(tenant_id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate] Migrations complete');

    // =============================================
    // SEED DATA — per tenant
    // =============================================

    // Seed impact items: 6 items (uniforms 30k, textbooks 50k, school fees 200k, medical 100k, water well 500k, meals 10k UGX)
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'School Uniforms', 'Provide a full school uniform for a child in need', 30000, 'uniforms', '👕'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='School Uniforms')`);
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'Textbooks', 'Supply textbooks for a student for the entire year', 50000, 'textbooks', '📚'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Textbooks')`);
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'School Fees', 'Cover one term of school fees for a student', 200000, 'students', '🎓'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='School Fees')`);
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'Medical Care', 'Fund essential medical treatment for a patient', 100000, 'patients', '🏥'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Medical Care')`);
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'Water Well', 'Build a clean water well for an entire community', 500000, 'wells', '💧'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Water Well')`);
    await pool.query(`INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon)
      SELECT t.id, 'Meals', 'Provide nutritious meals for children for a week', 10000, 'meals', '🍽️'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM impact_items WHERE tenant_id=t.id AND name='Meals')`);

    // Seed loyalty tiers: 5 tiers (Bronze 0-99, Silver 100-499, Gold 500-1999, Platinum 2000-9999, Diamond 10000+)
    await pool.query(`INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits)
      SELECT t.id, 'Bronze', 0, 99, '#cd7f32', 'Basic donor badge, email updates'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Bronze')`);
    await pool.query(`INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits)
      SELECT t.id, 'Silver', 100, 499, '#c0c0c0', 'Priority email updates, donor wall recognition'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Silver')`);
    await pool.query(`INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits)
      SELECT t.id, 'Gold', 500, 1999, '#ffd700', 'Monthly impact reports, early campaign access, exclusive updates'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Gold')`);
    await pool.query(`INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits)
      SELECT t.id, 'Platinum', 2000, 9999, '#e5e4e2', 'VIP event invitations, personal thank-you calls, dedicated support'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Platinum')`);
    await pool.query(`INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits)
      SELECT t.id, 'Diamond', 10000, NULL, '#b9f2ff', 'All Platinum benefits + annual impact dinner, naming opportunities, advisory board seat'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_loyalty_tiers WHERE tenant_id=t.id AND name='Diamond')`);

    // Seed mobile money providers: MTN Uganda (25677/78), Airtel Uganda (25670/75)
    await pool.query(`INSERT INTO mobile_money_providers (tenant_id, name, country_code, ussd_code, prefix_patterns, is_active)
      SELECT t.id, 'MTN Uganda', 'UG', '*165#', '25677,25678', true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM mobile_money_providers WHERE tenant_id=t.id AND name='MTN Uganda')`);
    await pool.query(`INSERT INTO mobile_money_providers (tenant_id, name, country_code, ussd_code, prefix_patterns, is_active)
      SELECT t.id, 'Airtel Uganda', 'UG', '*185#', '25670,25675', true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM mobile_money_providers WHERE tenant_id=t.id AND name='Airtel Uganda')`);

    console.log('[FundraisingUltimate] Seed data complete');
  })();

  // =============================================
  // HELPER: Award loyalty points
  // =============================================
  async function awardLoyaltyPoints(tenantId, donorEmail, points, action) {
    if (!donorEmail) return;
    try {
      await pool.query('INSERT INTO donor_loyalty_ledger (tenant_id, donor_email, points, action) VALUES ($1, $2, $3, $4)',
        [tenantId, donorEmail, points, action]);
    } catch(e) { console.warn('[LoyaltyPoints]', e.message); }
  }

  // =============================================
  // HELPER: Get donor current tier
  // =============================================
  async function getDonorTier(tenantId, donorEmail) {
    if (!donorEmail) return null;
    try {
      const result = await pool.query(
        'SELECT COALESCE(SUM(points),0) as total_points FROM donor_loyalty_ledger WHERE tenant_id=$1 AND donor_email=$2',
        [tenantId, donorEmail]
      );
      const totalPoints = parseInt(result.rows[0].total_points) || 0;
      const tier = await pool.query(
        'SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 AND min_points <= $2 AND (max_points IS NULL OR max_points >= $2) ORDER BY min_points DESC LIMIT 1',
        [tenantId, totalPoints]
      );
      return { total_points: totalPoints, tier: tier.rows[0] || null };
    } catch(e) { return { total_points: 0, tier: null }; }
  }

  // =============================================
  // HELPER: Detect mobile money provider from phone
  // =============================================
  async function detectProvider(tenantId, phoneNumber) {
    const cleaned = phoneNumber.replace(/[^0-9]/g, '');
    const providers = (await pool.query('SELECT * FROM mobile_money_providers WHERE tenant_id=$1 AND is_active=true', [tenantId])).rows;
    for (const p of providers) {
      const patterns = p.prefix_patterns.split(',').map(s => s.trim());
      for (const pat of patterns) {
        if (cleaned.startsWith(pat)) return p;
      }
    }
    return null;
  }

  // ================================================================
  // FEATURE 1: RECURRING AUTO-DONATIONS
  // ================================================================

  // GET /api/recurring-donations — List all recurring donations for tenant
  app.get('/api/recurring-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 ORDER BY rd.created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/recurring-donations — Create a new recurring donation
  app.post('/api/recurring-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_name, donor_email, donor_phone, campaign_id, amount, frequency } = req.body;
    if (!donor_name || !amount || !frequency) return res.status(400).json({ error: 'donor_name, amount, and frequency are required' });

    // Compute next_charge_date based on frequency
    const nextDate = new Date();
    if (frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (frequency === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else if (frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else if (frequency === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
    else if (frequency === 'yearly') nextDate.setFullYear(nextDate.getFullYear() + 1);

    const result = await pool.query(
      'INSERT INTO recurring_donations (tenant_id, donor_name, donor_email, donor_phone, campaign_id, amount, frequency, next_charge_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [t, esc(donor_name), donor_email ? esc(donor_email) : null, donor_phone ? esc(donor_phone) : null, campaign_id || null, parseInt(amount) || 0, frequency, nextDate, 'active']
    );

    // Award loyalty points for setting up recurring donation
    if (donor_email) await awardLoyaltyPoints(t, donor_email, 50, 'recurring_donation_setup');

    await audit(req.session.user.email, 'recurring_donation_created', 'Created recurring donation for ' + esc(donor_name) + ' amount UGX ' + amount);
    res.json(result.rows[0]);
  }));

  // PUT /api/recurring-donations/:id/pause — Pause a recurring donation
  app.put('/api/recurring-donations/:id/pause', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      "UPDATE recurring_donations SET status='paused' WHERE id=$1 AND tenant_id=$2 AND status='active' RETURNING *",
      [req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Active recurring donation not found' });
    await audit(req.session.user.email, 'recurring_donation_paused', 'Paused recurring donation #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // PUT /api/recurring-donations/:id/resume — Resume a paused recurring donation
  app.put('/api/recurring-donations/:id/resume', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    // Recalculate next_charge_date
    const existing = (await pool.query('SELECT * FROM recurring_donations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Recurring donation not found' });
    if (existing.status !== 'paused') return res.status(400).json({ error: 'Only paused donations can be resumed' });

    const nextDate = new Date();
    if (existing.frequency === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (existing.frequency === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else if (existing.frequency === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else if (existing.frequency === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
    else if (existing.frequency === 'yearly') nextDate.setFullYear(nextDate.getFullYear() + 1);

    const result = await pool.query(
      "UPDATE recurring_donations SET status='active', next_charge_date=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *",
      [nextDate, req.params.id, t]
    );
    await audit(req.session.user.email, 'recurring_donation_resumed', 'Resumed recurring donation #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // PUT /api/recurring-donations/:id/cancel — Cancel a recurring donation
  app.put('/api/recurring-donations/:id/cancel', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      "UPDATE recurring_donations SET status='cancelled' WHERE id=$1 AND tenant_id=$2 AND status IN ('active','paused') RETURNING *",
      [req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Active or paused recurring donation not found' });
    await audit(req.session.user.email, 'recurring_donation_cancelled', 'Cancelled recurring donation #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /recurring-donations — UI page for managing recurring donations
  app.get('/recurring-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const donations = (await pool.query(
      'SELECT rd.*, fc.title as campaign_title FROM recurring_donations rd LEFT JOIN fundraising_campaigns fc ON rd.campaign_id=fc.id WHERE rd.tenant_id=$1 ORDER BY rd.created_at DESC',
      [t]
    )).rows;
    const activeCount = donations.filter(d => d.status === 'active').length;
    const totalMonthly = donations.filter(d => d.status === 'active').reduce((s, d) => {
      if (d.frequency === 'weekly') return s + d.amount * 4;
      if (d.frequency === 'biweekly') return s + d.amount * 2;
      if (d.frequency === 'monthly') return s + d.amount;
      if (d.frequency === 'quarterly') return s + Math.round(d.amount / 3);
      if (d.frequency === 'yearly') return s + Math.round(d.amount / 12);
      return s + d.amount;
    }, 0);

    res.send(renderPage('Recurring Donations', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
        <h1>Recurring Auto-Donations</h1>
        <p>Manage automatic recurring donations from supporters</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${activeCount}</div><div>Active Subscriptions</div></div>
        <div class="stat-card"><div class="stat-num">UGX ${totalMonthly.toLocaleString()}</div><div>Est. Monthly</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${donations.length}</div><div>Total Subscriptions</div></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>All Recurring Donations</h2>
          <button class="btn btn-green" onclick="document.getElementById('addForm').style.display='block'">+ New Recurring Donation</button>
        </div>
        <div id="addForm" style="display:none;margin-bottom:20px;padding:20px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
          <h3>New Recurring Donation</h3>
          <form method="POST" action="/api/recurring-donations" id="recurringForm">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Donor Name *</label><input name="donor_name" required style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Donor Email</label><input name="donor_email" type="email" style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Donor Phone</label><input name="donor_phone" style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Campaign</label><input name="campaign_id" type="number" placeholder="Campaign ID (optional)" style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Amount (UGX) *</label><input name="amount" type="number" required style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Frequency *</label><select name="frequency" required style="width:100%;padding:8px;border-radius:6px;border:1px solid #e2e8f0"><option value="weekly">Weekly</option><option value="biweekly">Bi-Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div>
            </div>
            <button type="submit" class="btn btn-green" style="margin-top:12px">Create Recurring Donation</button>
            <button type="button" class="btn" style="margin-top:12px;margin-left:8px" onclick="document.getElementById('addForm').style.display='none'">Cancel</button>
          </form>
        </div>
        <script>
          function recurringAction(url, msg) {
            if (msg && !confirm(msg)) return;
            fetch(url, {method:'PUT'}).then(function(r){ return r.json(); }).then(function(){ location.reload(); });
          }
        </script>
        ${donations.length ? '<table><tr><th>Donor</th><th>Amount</th><th>Frequency</th><th>Campaign</th><th>Next Charge</th><th>Status</th><th>Actions</th></tr>' +
          donations.map(d => '<tr><td><strong>' + esc(d.donor_name) + '</strong>' + (d.donor_email ? '<br><span class="muted">' + esc(d.donor_email) + '</span>' : '') + '</td><td style="font-weight:700;color:#059669">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</td><td><span class="tag">' + esc(d.frequency) + '</span></td><td>' + esc(d.campaign_title || 'General') + '</td><td>' + (d.next_charge_date ? new Date(d.next_charge_date).toLocaleDateString() : '-') + '</td><td><span class="tag" style="background:' + (d.status==='active'?'#d1fae5;color:#065f46':d.status==='paused'?'#fef3c7;color:#92400e':'#fee2e2;color:#991b1b') + '">' + esc(d.status) + '</span></td><td>' + (d.status==='active'?'<a href="#" onclick="recurringAction(\'/api/recurring-donations/'+d.id+'/pause\');return false" class="btn btn-sm">Pause</a>':'') + (d.status==='paused'?'<a href="#" onclick="recurringAction(\'/api/recurring-donations/'+d.id+'/resume\');return false" class="btn btn-sm btn-green">Resume</a>':'') + (d.status!=='cancelled'?' <a href="#" onclick="recurringAction(\'/api/recurring-donations/'+d.id+'/cancel\',\'Cancel this recurring donation?\');return false" class="btn btn-sm btn-red">Cancel</a>':'') + '</td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No recurring donations yet.</p>'}
      </div>
    `, req.session.user));
  }));

  // ================================================================
  // FEATURE 2: IMPACT CALCULATOR
  // ================================================================

  // GET /api/impact-items — List impact items
  app.get('/api/impact-items', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM impact_items WHERE tenant_id=$1 ORDER BY amount_per_unit ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/impact-items — Create an impact item
  app.post('/api/impact-items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, amount_per_unit, unit_label, icon } = req.body;
    if (!name || !amount_per_unit || !unit_label) return res.status(400).json({ error: 'name, amount_per_unit, and unit_label are required' });
    const result = await pool.query(
      'INSERT INTO impact_items (tenant_id, name, description, amount_per_unit, unit_label, icon) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), description ? esc(description) : null, parseInt(amount_per_unit), esc(unit_label), icon || '❤️']
    );
    await audit(req.session.user.email, 'impact_item_created', 'Created impact item: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/impact-items/:id — Update an impact item
  app.put('/api/impact-items/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, amount_per_unit, unit_label, icon, is_active } = req.body;
    const result = await pool.query(
      'UPDATE impact_items SET name=COALESCE($1,name), description=COALESCE($2,description), amount_per_unit=COALESCE($3,amount_per_unit), unit_label=COALESCE($4,unit_label), icon=COALESCE($5,icon), is_active=COALESCE($6,is_active) WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, amount_per_unit ? parseInt(amount_per_unit) : null, unit_label ? esc(unit_label) : null, icon || null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Impact item not found' });
    await audit(req.session.user.email, 'impact_item_updated', 'Updated impact item #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/impact-items/:id — Delete an impact item
  app.delete('/api/impact-items/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM impact_items WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Impact item not found' });
    await audit(req.session.user.email, 'impact_item_deleted', 'Deleted impact item #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/campaigns/:id/impact-goals — Set impact goals for a campaign
  app.post('/api/campaigns/:id/impact-goals', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { goals } = req.body; // Array of { impact_item_id, target_units }
    if (!goals || !Array.isArray(goals)) return res.status(400).json({ error: 'goals array is required' });

    // Delete existing goals for this campaign
    await pool.query('DELETE FROM campaign_impact_goals WHERE tenant_id=$1 AND campaign_id=$2', [t, req.params.id]);

    const inserted = [];
    for (const g of goals) {
      if (g.impact_item_id && g.target_units) {
        const r = await pool.query(
          'INSERT INTO campaign_impact_goals (tenant_id, campaign_id, impact_item_id, target_units, achieved_units) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [t, req.params.id, g.impact_item_id, parseInt(g.target_units), parseInt(g.achieved_units) || 0]
        );
        inserted.push(r.rows[0]);
      }
    }
    await audit(req.session.user.email, 'impact_goals_set', 'Set impact goals for campaign #' + req.params.id);
    res.json(inserted);
  }));

  // GET /api/campaigns/:id/impact — Get impact data for a campaign
  app.get('/api/campaigns/:id/impact', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const goals = await pool.query(
      'SELECT cig.*, ii.name as item_name, ii.description as item_description, ii.amount_per_unit, ii.unit_label, ii.icon FROM campaign_impact_goals cig JOIN impact_items ii ON cig.impact_item_id=ii.id WHERE cig.tenant_id=$1 AND cig.campaign_id=$2',
      [t, req.params.id]
    );
    // Get total raised for campaign from donations
    let raised = 0;
    try {
      const r = await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND tenant_id=$2', [req.params.id, t]);
      raised = parseInt(r.rows[0].total) || 0;
    } catch(e) {}

    // Calculate impact achievements
    const impactResults = goals.rows.map(g => {
      const unitsFromDonations = g.amount_per_unit > 0 ? Math.floor(raised / g.amount_per_unit) : 0;
      const achievedUnits = Math.max(g.achieved_units, unitsFromDonations);
      const pct = g.target_units > 0 ? Math.min(100, Math.round((achievedUnits / g.target_units) * 100)) : 0;
      return { ...g, achieved_units: achievedUnits, progress_pct: pct };
    });

    res.json({ campaign_id: req.params.id, raised, impact_goals: impactResults });
  }));

  // GET /impact-calculator — UI page for impact calculator
  app.get('/impact-calculator', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const items = (await pool.query('SELECT * FROM impact_items WHERE tenant_id=$1 AND is_active=true ORDER BY amount_per_unit ASC', [t])).rows;

    res.send(renderPage('Impact Calculator', `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">
        <h1>Impact Calculator</h1>
        <p>See how far your donation goes — every amount creates real impact</p>
      </div>
      <div class="card">
        <h2>Enter an Amount</h2>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap">
          <input type="number" id="amountInput" placeholder="Enter amount in UGX" style="flex:1;min-width:200px;padding:12px;font-size:18px;border-radius:8px;border:1px solid #e2e8f0" oninput="calculateImpact()">
          <span style="font-size:18px;font-weight:600">UGX</span>
        </div>
        <div id="impactResults"></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h2>Impact Items</h2>
        <div class="grid">
          ${items.map(item => `
            <div class="card" style="text-align:center;padding:20px">
              <div style="font-size:40px">${item.icon}</div>
              <h4 style="margin:8px 0">${esc(item.name)}</h4>
              <p class="muted" style="font-size:13px">${esc(item.description || '')}</p>
              <div style="margin-top:8px;font-weight:700;color:#059669">UGX ${parseInt(item.amount_per_unit).toLocaleString()}</div>
              <span class="muted" style="font-size:12px">per ${esc(item.unit_label)}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <script>
        const impactItems = ${JSON.stringify(items)};
        function calculateImpact() {
          const amount = parseInt(document.getElementById('amountInput').value) || 0;
          const container = document.getElementById('impactResults');
          if (amount <= 0) { container.innerHTML = '<p class="muted" style="text-align:center;padding:20px">Enter an amount above to see your impact</p>'; return; }
          let html = '<div class="grid">';
          for (const item of impactItems) {
            const units = Math.floor(amount / item.amount_per_unit);
            if (units > 0) {
              html += '<div class="card" style="text-align:center;padding:20px;border:2px solid #059669"><div style="font-size:40px">' + item.icon + '</div><h4>' + item.name + '</h4><div style="font-size:28px;font-weight:800;color:#059669">' + units + '</div><span class="muted">' + item.unit_label + '</span></div>';
            }
          }
          html += '</div>';
          container.innerHTML = html;
        }
      </script>
    `, req.session.user));
  }));

  // ================================================================
  // FEATURE 3: DONOR LOYALTY TIERS
  // ================================================================

  // GET /api/loyalty-tiers — List loyalty tiers
  app.get('/api/loyalty-tiers', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 ORDER BY min_points ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/loyalty-tiers — Create a loyalty tier
  app.post('/api/loyalty-tiers', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, min_points, max_points, badge_color, benefits } = req.body;
    if (!name || min_points === undefined) return res.status(400).json({ error: 'name and min_points are required' });
    const result = await pool.query(
      'INSERT INTO donor_loyalty_tiers (tenant_id, name, min_points, max_points, badge_color, benefits) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), parseInt(min_points), max_points !== undefined && max_points !== null ? parseInt(max_points) : null, badge_color || '#6b7280', benefits ? esc(benefits) : null]
    );
    await audit(req.session.user.email, 'loyalty_tier_created', 'Created loyalty tier: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/loyalty-tiers/:id — Update a loyalty tier
  app.put('/api/loyalty-tiers/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, min_points, max_points, badge_color, benefits } = req.body;
    const result = await pool.query(
      'UPDATE donor_loyalty_tiers SET name=COALESCE($1,name), min_points=COALESCE($2,min_points), max_points=$3, badge_color=COALESCE($4,badge_color), benefits=COALESCE($5,benefits) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, min_points !== undefined ? parseInt(min_points) : null, max_points !== undefined ? (max_points !== null ? parseInt(max_points) : null) : undefined, badge_color || null, benefits ? esc(benefits) : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Loyalty tier not found' });
    await audit(req.session.user.email, 'loyalty_tier_updated', 'Updated loyalty tier #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/loyalty-tiers/:id — Delete a loyalty tier
  app.delete('/api/loyalty-tiers/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM donor_loyalty_tiers WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Loyalty tier not found' });
    await audit(req.session.user.email, 'loyalty_tier_deleted', 'Deleted loyalty tier #' + req.params.id);
    res.json({ success: true });
  }));

  // GET /api/loyalty/leaderboard — Get top donors by loyalty points
  app.get('/api/loyalty/leaderboard', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const limit = parseInt(req.query.limit) || 20;
    const result = await pool.query(
      'SELECT donor_email, SUM(points) as total_points, COUNT(*) as actions_count FROM donor_loyalty_ledger WHERE tenant_id=$1 GROUP BY donor_email ORDER BY total_points DESC LIMIT $2',
      [t, limit]
    );
    // Attach tier info to each donor
    const leaderboard = [];
    for (const row of result.rows) {
      const totalPoints = parseInt(row.total_points) || 0;
      const tierResult = await pool.query(
        'SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 AND min_points <= $2 AND (max_points IS NULL OR max_points >= $2) ORDER BY min_points DESC LIMIT 1',
        [t, totalPoints]
      );
      leaderboard.push({
        donor_email: row.donor_email,
        total_points: totalPoints,
        actions_count: parseInt(row.actions_count),
        tier: tierResult.rows[0] || null
      });
    }
    res.json(leaderboard);
  }));

  // GET /api/loyalty/my-status — Get current user's loyalty status
  app.get('/api/loyalty/my-status', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = req.session.user.email;
    const status = await getDonorTier(t, email);
    const recentActions = (await pool.query(
      'SELECT * FROM donor_loyalty_ledger WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 10',
      [t, email]
    )).rows;
    res.json({ ...status, recent_actions: recentActions });
  }));

  // GET /loyalty — UI page for loyalty program
  app.get('/loyalty', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const tiers = (await pool.query('SELECT * FROM donor_loyalty_tiers WHERE tenant_id=$1 ORDER BY min_points ASC', [t])).rows;
    const leaderboard = (await pool.query(
      'SELECT donor_email, SUM(points) as total_points, COUNT(*) as actions_count FROM donor_loyalty_ledger WHERE tenant_id=$1 GROUP BY donor_email ORDER BY total_points DESC LIMIT 20',
      [t]
    )).rows;
    const myStatus = await getDonorTier(t, req.session.user.email);

    res.send(renderPage('Donor Loyalty Program', `
      <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)">
        <h1>Donor Loyalty Program</h1>
        <p>Every donation earns points — climb the tiers and unlock rewards!</p>
      </div>
      ${myStatus && myStatus.tier ? '<div class="card" style="margin-bottom:20px;text-align:center"><h3>Your Current Status</h3><div style="display:inline-block;padding:16px 32px;border-radius:12px;background:' + esc(myStatus.tier.badge_color) + ';color:white;font-size:24px;font-weight:800;margin:12px 0">' + esc(myStatus.tier.name) + '</div><div style="font-size:18px">' + myStatus.total_points.toLocaleString() + ' points</div><p class="muted">' + esc(myStatus.tier.benefits || '') + '</p></div>' : ''}
      <div class="card">
        <h2>Loyalty Tiers</h2>
        <div class="grid">
          ${tiers.map(tier => `
            <div class="card" style="text-align:center;padding:20px;border-top:4px solid ${esc(tier.badge_color)}">
              <div style="width:60px;height:60px;border-radius:50%;background:${esc(tier.badge_color)};margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:16px">${esc(tier.name.charAt(0))}</div>
              <h3 style="margin:0">${esc(tier.name)}</h3>
              <div style="font-weight:700;margin:4px 0">${tier.min_points.toLocaleString()}${tier.max_points ? ' - ' + tier.max_points.toLocaleString() : '+'} pts</div>
              <p class="muted" style="font-size:13px">${esc(tier.benefits || 'Standard benefits')}</p>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card" style="margin-top:20px">
        <h2>Leaderboard</h2>
        ${leaderboard.length ? '<table><tr><th>#</th><th>Donor</th><th>Points</th><th>Actions</th></tr>' +
          leaderboard.map((d, i) => '<tr><td>' + (i+1) + '</td><td>' + esc(d.donor_email) + '</td><td style="font-weight:700;color:#f59e0b">' + (parseInt(d.total_points)||0).toLocaleString() + '</td><td>' + d.actions_count + '</td></tr>').join('') + '</table>' : '<p class="muted" style="text-align:center;padding:40px">No leaderboard entries yet.</p>'}
      </div>
    `, req.session.user));
  }));

  // ================================================================
  // FEATURE 4: CAMPAIGN PERFORMANCE GRADER
  // ================================================================

  // POST /api/campaigns/:id/grade — Grade a campaign
  app.post('/api/campaigns/:id/grade', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = req.params.id;

    // Fetch campaign data
    const campaign = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Fetch donation stats
    let totalRaised = 0, donorCount = 0;
    try {
      const stats = (await pool.query('SELECT COALESCE(SUM(amount),0) as total, COUNT(DISTINCT donor_name) as donors FROM campaign_donations WHERE campaign_id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
      totalRaised = parseInt(stats.total) || 0;
      donorCount = parseInt(stats.donors) || 0;
    } catch(e) {}

    // Fetch update count
    let updateCount = 0;
    try {
      const u = await pool.query('SELECT COUNT(*) as cnt FROM campaign_updates WHERE campaign_id=$1 AND tenant_id=$2', [campaignId, t]);
      updateCount = parseInt(u.rows[0].cnt) || 0;
    } catch(e) {}

    // Calculate days active
    const createdAt = campaign.created_at ? new Date(campaign.created_at) : new Date();
    const daysActive = Math.max(1, Math.ceil((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)));

    // Grade formula
    const goalPct = campaign.target > 0 ? Math.min(100, Math.round((totalRaised / parseInt(campaign.target)) * 100)) : 0;

    // Score components (0-25 each, total 100)
    const goalScore = Math.min(25, Math.round(goalPct / 4)); // 25% weight
    const donorScore = Math.min(25, Math.round(Math.min(donorCount, 50) / 2)); // 25% weight, cap at 50 donors
    const updateScore = Math.min(25, updateCount * 5); // 25% weight, 5 pts per update
    const momentumScore = Math.min(25, Math.round(daysActive > 0 ? Math.min(donorCount / daysActive * 10, 25) : 0)); // 25% weight

    const totalScore = goalScore + donorScore + updateScore + momentumScore;

    // Determine grade
    let grade;
    if (totalScore >= 90) grade = 'A+';
    else if (totalScore >= 80) grade = 'A';
    else if (totalScore >= 70) grade = 'B+';
    else if (totalScore >= 60) grade = 'B';
    else if (totalScore >= 50) grade = 'C+';
    else if (totalScore >= 40) grade = 'C';
    else if (totalScore >= 30) grade = 'D';
    else grade = 'F';

    const metricsJson = {
      goal_pct: goalPct,
      donor_count: donorCount,
      update_count: updateCount,
      days_active: daysActive,
      total_raised: totalRaised,
      target: parseInt(campaign.target) || 0,
      scores: { goal: goalScore, donors: donorScore, updates: updateScore, momentum: momentumScore }
    };

    // Insert or update grade
    const existing = (await pool.query('SELECT id FROM campaign_grades WHERE tenant_id=$1 AND campaign_id=$2', [t, campaignId])).rows[0];
    let result;
    if (existing) {
      result = await pool.query(
        'UPDATE campaign_grades SET grade=$1, score=$2, metrics_json=$3, graded_at=NOW() WHERE id=$4 AND tenant_id=$5 RETURNING *',
        [grade, totalScore, JSON.stringify(metricsJson), existing.id, t]
      );
    } else {
      result = await pool.query(
        'INSERT INTO campaign_grades (tenant_id, campaign_id, grade, score, metrics_json) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, campaignId, grade, totalScore, JSON.stringify(metricsJson)]
      );
    }

    await audit(req.session.user.email, 'campaign_graded', 'Graded campaign #' + campaignId + ' as ' + grade + ' (score: ' + totalScore + ')');
    res.json(result.rows[0]);
  }));

  // GET /api/campaigns/:id/grade — Get campaign grade
  app.get('/api/campaigns/:id/grade', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM campaign_grades WHERE tenant_id=$1 AND campaign_id=$2', [t, req.params.id]);
    if (!result.rows[0]) return res.json({ error: 'Not graded yet' });
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 5: EMERGENCY / URGENT MODE
  // ================================================================

  // POST /api/emergency-campaigns — Create an emergency campaign
  app.post('/api/emergency-campaigns', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, urgency_level, deadline, goal_amount } = req.body;
    if (!campaign_id || !goal_amount) return res.status(400).json({ error: 'campaign_id and goal_amount are required' });

    const result = await pool.query(
      'INSERT INTO emergency_campaigns (tenant_id, campaign_id, urgency_level, deadline, goal_amount, raised_amount, is_active) VALUES ($1,$2,$3,$4,$5,0,true) RETURNING *',
      [t, campaign_id, urgency_level || 'high', deadline ? new Date(deadline) : null, parseInt(goal_amount)]
    );

    // Notify all users in tenant
    try {
      const users = (await pool.query('SELECT email FROM users WHERE tenant_id=$1', [t])).rows;
      for (const u of users) {
        notify(t, u.email, 'Emergency Campaign Activated!', 'An urgent campaign has been activated. Immediate support needed!', 'fundraising');
      }
    } catch(e) {}

    await audit(req.session.user.email, 'emergency_campaign_created', 'Created emergency campaign for campaign #' + campaign_id);
    res.json(result.rows[0]);
  }));

  // GET /api/emergency-campaigns — List emergency campaigns
  app.get('/api/emergency-campaigns', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const activeOnly = req.query.active === 'true';
    const query = activeOnly
      ? 'SELECT ec.*, fc.title as campaign_title FROM emergency_campaigns ec LEFT JOIN fundraising_campaigns fc ON ec.campaign_id=fc.id WHERE ec.tenant_id=$1 AND ec.is_active=true ORDER BY ec.activated_at DESC'
      : 'SELECT ec.*, fc.title as campaign_title FROM emergency_campaigns ec LEFT JOIN fundraising_campaigns fc ON ec.campaign_id=fc.id WHERE ec.tenant_id=$1 ORDER BY ec.activated_at DESC';
    const result = await pool.query(query, [t]);
    res.json(result.rows);
  }));

  // PUT /api/emergency-campaigns/:id — Update an emergency campaign
  app.put('/api/emergency-campaigns/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { urgency_level, deadline, goal_amount, raised_amount } = req.body;
    const result = await pool.query(
      'UPDATE emergency_campaigns SET urgency_level=COALESCE($1,urgency_level), deadline=COALESCE($2,deadline), goal_amount=COALESCE($3,goal_amount), raised_amount=COALESCE($4,raised_amount) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [urgency_level || null, deadline ? new Date(deadline) : null, goal_amount ? parseInt(goal_amount) : null, raised_amount !== undefined ? parseInt(raised_amount) : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Emergency campaign not found' });
    await audit(req.session.user.email, 'emergency_campaign_updated', 'Updated emergency campaign #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/emergency-campaigns/:id/deactivate — Deactivate an emergency campaign
  app.post('/api/emergency-campaigns/:id/deactivate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'UPDATE emergency_campaigns SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING *',
      [req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Emergency campaign not found' });
    await audit(req.session.user.email, 'emergency_campaign_deactivated', 'Deactivated emergency campaign #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 6: HARAMBEE MODE
  // ================================================================

  // POST /api/harambee-pools — Create a harambee pool
  app.post('/api/harambee-pools', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, goal } = req.body;
    if (!name || !goal) return res.status(400).json({ error: 'name and goal are required' });
    const result = await pool.query(
      'INSERT INTO harambee_pools (tenant_id, name, description, goal) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), description ? esc(description) : null, parseInt(goal)]
    );
    await audit(req.session.user.email, 'harambee_pool_created', 'Created harambee pool: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // GET /api/harambee-pools — List harambee pools
  app.get('/api/harambee-pools', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM harambee_pools WHERE tenant_id=$1 ORDER BY created_at DESC', [t]);
    res.json(result.rows);
  }));

  // PUT /api/harambee-pools/:id — Update a harambee pool
  app.put('/api/harambee-pools/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, goal, is_active } = req.body;
    const result = await pool.query(
      'UPDATE harambee_pools SET name=COALESCE($1,name), description=COALESCE($2,description), goal=COALESCE($3,goal), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, goal ? parseInt(goal) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Harambee pool not found' });
    await audit(req.session.user.email, 'harambee_pool_updated', 'Updated harambee pool #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/harambee-pools/:id/contribute — Contribute to a harambee pool
  app.post('/api/harambee-pools/:id/contribute', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { contributor_name, amount, message } = req.body;
    if (!contributor_name || !amount) return res.status(400).json({ error: 'contributor_name and amount are required' });

    const pool_check = (await pool.query('SELECT * FROM harambee_pools WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!pool_check) return res.status(404).json({ error: 'Harambee pool not found' });
    if (!pool_check.is_active) return res.status(400).json({ error: 'This pool is no longer active' });

    const contribResult = await pool.query(
      'INSERT INTO harambee_contributions (tenant_id, pool_id, contributor_name, amount, message) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, req.params.id, esc(contributor_name), parseInt(amount), message ? esc(message) : null]
    );

    // Update pool totals
    await pool.query(
      'UPDATE harambee_pools SET total_contributed=total_contributed+$1, contributor_count=contributor_count+1 WHERE id=$2 AND tenant_id=$3',
      [parseInt(amount), req.params.id, t]
    );

    await audit(contributor_name, 'harambee_contribution', 'Contributed UGX ' + amount + ' to harambee pool #' + req.params.id);
    res.json(contribResult.rows[0]);
  }));

  // POST /api/harambee-pools/:id/distribute — Distribute from a harambee pool
  app.post('/api/harambee-pools/:id/distribute', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { recipient_name, amount, purpose } = req.body;
    if (!recipient_name || !amount) return res.status(400).json({ error: 'recipient_name and amount are required' });

    const pool_check = (await pool.query('SELECT * FROM harambee_pools WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!pool_check) return res.status(404).json({ error: 'Harambee pool not found' });

    if (parseInt(amount) > pool_check.total_contributed) return res.status(400).json({ error: 'Insufficient pool balance' });

    const distResult = await pool.query(
      'INSERT INTO harambee_distributions (tenant_id, pool_id, recipient_name, amount, purpose) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, req.params.id, esc(recipient_name), parseInt(amount), purpose ? esc(purpose) : null]
    );

    // Deduct from pool balance
    await pool.query(
      'UPDATE harambee_pools SET total_contributed=GREATEST(0, total_contributed-$1) WHERE id=$2 AND tenant_id=$3',
      [parseInt(amount), req.params.id, t]
    );

    await audit(req.session.user.email, 'harambee_distribution', 'Distributed UGX ' + amount + ' from harambee pool #' + req.params.id + ' to ' + esc(recipient_name));
    res.json(distResult.rows[0]);
  }));

  // GET /harambee — UI page for harambee
  app.get('/harambee', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pools = (await pool.query('SELECT * FROM harambee_pools WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;
    const contributions = (await pool.query(
      'SELECT hc.*, hp.name as pool_name FROM harambee_contributions hc JOIN harambee_pools hp ON hc.pool_id=hp.id WHERE hc.tenant_id=$1 ORDER BY hc.created_at DESC LIMIT 50',
      [t]
    )).rows;
    const distributions = (await pool.query(
      'SELECT hd.*, hp.name as pool_name FROM harambee_distributions hd JOIN harambee_pools hp ON hd.pool_id=hp.id WHERE hd.tenant_id=$1 ORDER BY hd.distributed_at DESC LIMIT 50',
      [t]
    )).rows;

    res.send(renderPage('Harambee', `
      <div class="hero" style="background:linear-gradient(135deg,#dc2626,#f59e0b)">
        <h1>Harambee — Pull Together</h1>
        <p>Community-driven collective fundraising — together we rise!</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${pools.length}</div><div>Pools</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${pools.reduce((s,p)=>s+(parseInt(p.total_contributed)||0),0).toLocaleString()}</div><div>Total Contributed</div></div>
        <div class="stat-card"><div class="stat-num">${contributions.length}</div><div>Contributions</div></div>
      </div>
      <div class="card">
        <h2>Harambee Pools</h2>
        ${pools.length ? '<div class="grid">' + pools.map(p => {
          const pct = p.goal > 0 ? Math.min(100, Math.round(parseInt(p.total_contributed) / parseInt(p.goal) * 100)) : 0;
          return '<div class="card" style="padding:20px;border-top:4px solid ' + (p.is_active ? '#059669' : '#6b7280') + '"><h3>' + esc(p.name) + '</h3><p class="muted" style="font-size:13px">' + esc(p.description || '') + '</p><div style="background:#e2e8f0;height:10px;border-radius:5px;margin:12px 0"><div style="background:#059669;height:10px;border-radius:5px;width:' + pct + '%"></div></div><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#059669;font-weight:700">UGX ' + (parseInt(p.total_contributed)||0).toLocaleString() + '</span><span class="muted">of UGX ' + (parseInt(p.goal)||0).toLocaleString() + '</span></div><div style="font-size:13px;margin-top:8px">' + p.contributor_count + ' contributors · <span class="tag" style="background:' + (p.is_active?'#d1fae5;color:#065f46':'#fee2e2;color:#991b1b') + '">' + (p.is_active?'Active':'Closed') + '</span></div></div>';
        }).join('') + '</div>' : '<p class="muted" style="text-align:center;padding:40px">No harambee pools yet.</p>'}
      </div>
      ${contributions.length > 0 ? '<div class="card" style="margin-top:20px"><h2>Recent Contributions</h2><table><tr><th>Pool</th><th>Contributor</th><th>Amount</th><th>Message</th><th>Date</th></tr>' + contributions.map(c => '<tr><td>' + esc(c.pool_name) + '</td><td>' + esc(c.contributor_name) + '</td><td style="font-weight:700;color:#059669">UGX ' + (parseInt(c.amount)||0).toLocaleString() + '</td><td class="muted">' + esc((c.message||'').substring(0,50)) + '</td><td>' + new Date(c.created_at).toLocaleDateString() + '</td></tr>').join('') + '</table></div>' : ''}
      ${distributions.length > 0 ? '<div class="card" style="margin-top:20px"><h2>Distributions</h2><table><tr><th>Pool</th><th>Recipient</th><th>Amount</th><th>Purpose</th><th>Date</th></tr>' + distributions.map(d => '<tr><td>' + esc(d.pool_name) + '</td><td>' + esc(d.recipient_name) + '</td><td style="font-weight:700;color:#dc2626">UGX ' + (parseInt(d.amount)||0).toLocaleString() + '</td><td class="muted">' + esc(d.purpose || '') + '</td><td>' + new Date(d.distributed_at).toLocaleDateString() + '</td></tr>').join('') + '</table></div>' : ''}
    `, req.session.user));
  }));

  // ================================================================
  // FEATURE 7: WHATSAPP DONATE BOT
  // ================================================================

  // GET /api/whatsapp-donate-config — Get WhatsApp donate configuration
  app.get('/api/whatsapp-donate-config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM whatsapp_donate_config WHERE tenant_id=$1', [t]);
    res.json(result.rows[0] || null);
  }));

  // POST /api/whatsapp-donate-config — Create WhatsApp donate configuration
  app.post('/api/whatsapp-donate-config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { phone_number, business_name, welcome_message, is_active } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

    // Check if config already exists for this tenant
    const existing = (await pool.query('SELECT id FROM whatsapp_donate_config WHERE tenant_id=$1', [t])).rows[0];
    let result;
    if (existing) {
      result = await pool.query(
        'UPDATE whatsapp_donate_config SET phone_number=$1, business_name=COALESCE($2,business_name), welcome_message=COALESCE($3,welcome_message), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 RETURNING *',
        [esc(phone_number), business_name ? esc(business_name) : null, welcome_message ? esc(welcome_message) : null, is_active !== undefined ? is_active : null, t]
      );
    } else {
      result = await pool.query(
        'INSERT INTO whatsapp_donate_config (tenant_id, phone_number, business_name, welcome_message, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, esc(phone_number), business_name ? esc(business_name) : null, welcome_message ? esc(welcome_message) : 'Welcome! Reply with DONATE to start giving.', is_active !== false]
      );
    }
    await audit(req.session.user.email, 'whatsapp_donate_config_updated', 'Updated WhatsApp donate configuration');
    res.json(result.rows[0]);
  }));

  // PUT /api/whatsapp-donate-config — Update WhatsApp donate configuration
  app.put('/api/whatsapp-donate-config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { phone_number, business_name, welcome_message, is_active } = req.body;
    const result = await pool.query(
      'UPDATE whatsapp_donate_config SET phone_number=COALESCE($1,phone_number), business_name=COALESCE($2,business_name), welcome_message=COALESCE($3,welcome_message), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 RETURNING *',
      [phone_number ? esc(phone_number) : null, business_name !== undefined ? esc(business_name) : null, welcome_message !== undefined ? esc(welcome_message) : null, is_active !== undefined ? is_active : null, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'No WhatsApp config found. Create one first with POST.' });
    await audit(req.session.user.email, 'whatsapp_donate_config_updated', 'Updated WhatsApp donate configuration');
    res.json(result.rows[0]);
  }));

  // POST /api/whatsapp-donate/webhook — Webhook for WhatsApp donate interactions
  // SECURITY: tenant_id is derived from the phone_number config lookup, NOT from req.body
  app.post('/api/whatsapp-donate/webhook', ah(async (req, res) => {
    const { phone_number, message } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

    // Derive tenant_id from the WhatsApp config that matches this phone_number
    // (instead of trusting tenant_id from req.body which allows cross-tenant access)
    const configLookup = (await pool.query(
      'SELECT * FROM whatsapp_donate_config WHERE phone_number LIKE $1 AND is_active=true LIMIT 1',
      ['%' + esc(phone_number.replace(/[^+0-9]/g, '')) + '%']
    )).rows[0];
    if (!configLookup) return res.status(404).json({ error: 'No WhatsApp donate configuration found for this phone number' });

    const t = configLookup.tenant_id;
    const config = configLookup;

    // Find or create session
    let session = (await pool.query(
      "SELECT * FROM whatsapp_donate_sessions WHERE phone_number=$1 AND tenant_id=$2 AND status='active' ORDER BY created_at DESC LIMIT 1",
      [esc(phone_number), t]
    )).rows[0];

    const msgUpper = (message || '').trim().toUpperCase();
    let reply = '';

    if (!session || msgUpper === 'DONATE' || msgUpper === 'START' || msgUpper === 'HI' || msgUpper === 'HELLO') {
      // Start new session
      if (session) {
        await pool.query("UPDATE whatsapp_donate_sessions SET status='expired' WHERE id=$1 AND tenant_id=$2", [session.id, t]);
      }

      // Get active campaigns
      let campaigns = [];
      try {
        campaigns = (await pool.query("SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active' LIMIT 5", [t])).rows;
      } catch(e) {}

      const campaignList = campaigns.map((c, i) => (i + 1) + '. ' + c.title).join('\n');

      const newSession = await pool.query(
        'INSERT INTO whatsapp_donate_sessions (tenant_id, phone_number, current_step, session_data_json, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, esc(phone_number), 'select_campaign', JSON.stringify({ campaigns: campaigns.map((c, i) => ({ id: c.id, title: c.title, index: i + 1 })) }), 'active']
      );
      session = newSession.rows[0];

      reply = esc(config.welcome_message) + '\n\n';
      if (campaignList) {
        reply += 'Available campaigns:\n' + campaignList + '\n\nReply with the campaign number to donate.';
      } else {
        reply += 'No active campaigns at the moment. Please check back later.';
      }
    } else if (session.current_step === 'select_campaign') {
      // User selected a campaign
      const sessionData = session.session_data_json || {};
      const campaigns = sessionData.campaigns || [];
      const selectedIdx = parseInt(msgUpper) - 1;
      const selectedCampaign = campaigns[selectedIdx];

      if (!selectedCampaign) {
        reply = 'Invalid selection. Please reply with a campaign number (1-' + campaigns.length + ').';
      } else {
        await pool.query(
          'UPDATE whatsapp_donate_sessions SET current_step=$1, campaign_id=$2, session_data_json=$3 WHERE id=$4 AND tenant_id=$5',
          ['enter_amount', selectedCampaign.id, JSON.stringify(sessionData), session.id, t]
        );
        reply = 'You selected: ' + esc(selectedCampaign.title) + '\n\nHow much would you like to donate? (Enter amount in UGX)';
      }
    } else if (session.current_step === 'enter_amount') {
      const amount = parseInt(msgUpper.replace(/[^0-9]/g, ''));
      if (!amount || amount <= 0) {
        reply = 'Please enter a valid amount in UGX (e.g., 50000).';
      } else {
        await pool.query(
          'UPDATE whatsapp_donate_sessions SET current_step=$1, amount=$2 WHERE id=$3 AND tenant_id=$4',
          ['confirm', amount, session.id, t]
        );
        reply = 'You want to donate UGX ' + amount.toLocaleString() + '.\n\nReply YES to confirm or NO to cancel.';
      }
    } else if (session.current_step === 'confirm') {
      if (msgUpper === 'YES' || msgUpper === 'Y') {
        // Process the donation
        if (session.campaign_id && session.amount) {
          try {
            await pool.query(
              'INSERT INTO campaign_donations (tenant_id, campaign_id, donor_name, donor_phone, amount, method, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [t, session.campaign_id, 'WhatsApp Donor', esc(phone_number), session.amount, 'mobile_money', 'Donated via WhatsApp Bot']
            );
            // Award loyalty points (1 point per 1000 UGX)
            const points = Math.floor(session.amount / 1000);
            await awardLoyaltyPoints(t, phone_number + '@whatsapp', points, 'whatsapp_donation_UGX_' + session.amount);
          } catch(e) { console.warn('[WhatsApp Donate]', e.message); }
        }
        await pool.query("UPDATE whatsapp_donate_sessions SET status='completed' WHERE id=$1 AND tenant_id=$2", [session.id, t]);
        reply = 'Thank you for your donation of UGX ' + (session.amount || 0).toLocaleString() + '! Your generosity makes a difference. 🙏\n\nReply DONATE to make another donation.';
      } else {
        await pool.query("UPDATE whatsapp_donate_sessions SET status='cancelled' WHERE id=$1 AND tenant_id=$2", [session.id, t]);
        reply = 'Donation cancelled. Reply DONATE to start again anytime.';
      }
    } else {
      reply = 'Reply DONATE to start a new donation.';
    }

    res.json({ reply, session_id: session?.id });
  }));

  // ================================================================
  // FEATURE 8: MOBILE MONEY AUTO-DETECT
  // ================================================================

  // GET /api/mobile-money-providers — List mobile money providers
  app.get('/api/mobile-money-providers', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM mobile_money_providers WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/donate/detect-provider — Detect provider from phone number
  app.post('/api/donate/detect-provider', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { phone_number } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });
    const provider = await detectProvider(t, phone_number);
    if (!provider) return res.json({ detected: false, provider: null });
    res.json({ detected: true, provider });
  }));

  // POST /api/donate/initiate-payment — Initiate a mobile money payment
  app.post('/api/donate/initiate-payment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { phone_number, donation_id, amount } = req.body;
    if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

    const provider = await detectProvider(t, phone_number);

    const result = await pool.query(
      'INSERT INTO donation_payment_attempts (tenant_id, donation_id, phone_number, detected_provider, provider_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, donation_id || null, esc(phone_number), provider ? provider.name : null, provider ? provider.id : null, 'initiated']
    );

    const paymentAttempt = result.rows[0];

    // Simulate payment initiation (in production, integrate with actual mobile money API)
    if (provider) {
      // Auto-detect was successful
      try {
        if (sendSMS) {
          await sendSMS(phone_number, 'You are about to pay UGX ' + (parseInt(amount)||0).toLocaleString() + ' via ' + provider.name + '. Dial ' + provider.ussd_code + ' to confirm. Reference: PAY-' + paymentAttempt.id);
        }
      } catch(e) {}

      // Award loyalty points for mobile money usage
      if (req.session.user && req.session.user.email) {
        await awardLoyaltyPoints(t, req.session.user.email, 5, 'mobile_money_payment_initiated');
      }

      res.json({
        success: true,
        payment_id: paymentAttempt.id,
        provider: provider.name,
        ussd_code: provider.ussd_code,
        message: 'Payment initiated via ' + provider.name + '. Dial ' + provider.ussd_code + ' to confirm.'
      });
    } else {
      res.json({
        success: false,
        payment_id: paymentAttempt.id,
        provider: null,
        message: 'Could not detect mobile money provider for this phone number. Please check the number and try again.'
      });
    }
  }));

  // ================================================================
  // FEATURE 9: FUNERAL / BURIAL FUND
  // ================================================================

  // POST /api/funeral-funds — Create a funeral fund
  app.post('/api/funeral-funds', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, monthly_contribution, total_members } = req.body;
    if (!name || !monthly_contribution) return res.status(400).json({ error: 'name and monthly_contribution are required' });
    const result = await pool.query(
      'INSERT INTO funeral_funds (tenant_id, name, description, monthly_contribution, total_members) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), description ? esc(description) : null, parseInt(monthly_contribution), parseInt(total_members) || 0]
    );
    await audit(req.session.user.email, 'funeral_fund_created', 'Created funeral fund: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // GET /api/funeral-funds — List funeral funds
  app.get('/api/funeral-funds', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM funeral_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [t]);
    res.json(result.rows);
  }));

  // PUT /api/funeral-funds/:id — Update a funeral fund
  app.put('/api/funeral-funds/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, monthly_contribution, total_members, total_balance, is_active } = req.body;
    const result = await pool.query(
      'UPDATE funeral_funds SET name=COALESCE($1,name), description=COALESCE($2,description), monthly_contribution=COALESCE($3,monthly_contribution), total_members=COALESCE($4,total_members), total_balance=COALESCE($5,total_balance), is_active=COALESCE($6,is_active) WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, monthly_contribution ? parseInt(monthly_contribution) : null, total_members !== undefined ? parseInt(total_members) : null, total_balance !== undefined ? parseInt(total_balance) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Funeral fund not found' });
    await audit(req.session.user.email, 'funeral_fund_updated', 'Updated funeral fund #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/funeral-funds/:id/contribute — Contribute to a funeral fund
  app.post('/api/funeral-funds/:id/contribute', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { member_name, amount, contribution_date } = req.body;
    if (!member_name || !amount) return res.status(400).json({ error: 'member_name and amount are required' });

    const fund = (await pool.query('SELECT * FROM funeral_funds WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!fund) return res.status(404).json({ error: 'Funeral fund not found' });
    if (!fund.is_active) return res.status(400).json({ error: 'This fund is no longer active' });

    const contribResult = await pool.query(
      'INSERT INTO funeral_contributions (tenant_id, fund_id, member_name, amount, contribution_date) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, req.params.id, esc(member_name), parseInt(amount), contribution_date || new Date().toISOString().split('T')[0]]
    );

    // Update fund balance
    await pool.query(
      'UPDATE funeral_funds SET total_balance=total_balance+$1 WHERE id=$2 AND tenant_id=$3',
      [parseInt(amount), req.params.id, t]
    );

    // Award loyalty points
    await awardLoyaltyPoints(t, member_name, Math.floor(parseInt(amount) / 1000), 'funeral_fund_contribution');

    await audit(member_name, 'funeral_fund_contribution', 'Contributed UGX ' + amount + ' to funeral fund #' + req.params.id);
    res.json(contribResult.rows[0]);
  }));

  // GET /funeral-funds — UI page for funeral funds
  app.get('/funeral-funds', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const funds = (await pool.query('SELECT * FROM funeral_funds WHERE tenant_id=$1 ORDER BY created_at DESC', [t])).rows;

    // Get contributions for each fund
    const fundData = [];
    for (const f of funds) {
      const contributions = (await pool.query(
        'SELECT * FROM funeral_contributions WHERE fund_id=$1 AND tenant_id=$2 ORDER BY contribution_date DESC LIMIT 50',
        [f.id, t]
      )).rows;
      fundData.push({ ...f, contributions });
    }

    const totalBalance = funds.reduce((s, f) => s + (parseInt(f.total_balance) || 0), 0);
    const totalMembers = funds.reduce((s, f) => s + (parseInt(f.total_members) || 0), 0);

    res.send(renderPage('Funeral / Burial Fund', `
      <div class="hero" style="background:linear-gradient(135deg,#1f2937,#374151)">
        <h1>Funeral & Burial Fund</h1>
        <p>Community support for families in their time of need</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${funds.length}</div><div>Active Funds</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalBalance.toLocaleString()}</div><div>Total Balance</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${totalMembers}</div><div>Total Members</div></div>
      </div>
      <div class="card">
        <h2>Funds</h2>
        ${funds.length ? '<div class="grid">' + fundData.map(f => {
          const monthlyTarget = parseInt(f.monthly_contribution) * parseInt(f.total_members);
          return '<div class="card" style="padding:20px;border-top:4px solid #374151"><h3>' + esc(f.name) + '</h3><p class="muted" style="font-size:13px">' + esc(f.description || '') + '</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><div style="background:#f8fafc;padding:8px;border-radius:6px;text-align:center"><div style="font-weight:700;color:#059669">UGX ' + (parseInt(f.total_balance)||0).toLocaleString() + '</div><div class="muted" style="font-size:12px">Balance</div></div><div style="background:#f8fafc;padding:8px;border-radius:6px;text-align:center"><div style="font-weight:700">UGX ' + (parseInt(f.monthly_contribution)||0).toLocaleString() + '</div><div class="muted" style="font-size:12px">Monthly Contribution</div></div></div><div style="font-size:13px;margin-top:8px">' + f.total_members + ' members · <span class="tag" style="background:' + (f.is_active?'#d1fae5;color:#065f46':'#fee2e2;color:#991b1b') + '">' + (f.is_active?'Active':'Closed') + '</span></div>' + (f.contributions.length > 0 ? '<div style="margin-top:12px"><strong style="font-size:13px">Recent Contributions:</strong>' + f.contributions.slice(0, 5).map(c => '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid #f1f5f9"><span>' + esc(c.member_name) + '</span><span style="color:#059669;font-weight:600">UGX ' + (parseInt(c.amount)||0).toLocaleString() + '</span></div>').join('') + '</div>' : '') + '</div>';
        }).join('') + '</div>' : '<p class="muted" style="text-align:center;padding:40px">No funeral funds yet.</p>'}
      </div>
    `, req.session.user));
  }));

  // ================================================================
  // FEATURE 10: AI CAMPAIGN STORY WRITER
  // ================================================================

  // POST /api/campaigns/:id/generate-story — Generate a campaign story
  app.post('/api/campaigns/:id/generate-story', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { story_type } = req.body;

    // Fetch campaign details
    const campaign = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Fetch donation stats
    let totalRaised = 0, donorCount = 0;
    try {
      const stats = (await pool.query('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as donors FROM campaign_donations WHERE campaign_id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
      totalRaised = parseInt(stats.total) || 0;
      donorCount = parseInt(stats.donors) || 0;
    } catch(e) {}

    const title = campaign.title || 'This Campaign';
    const description = campaign.description || campaign.body || '';
    const target = parseInt(campaign.target) || 0;
    const goalPct = target > 0 ? Math.round((totalRaised / target) * 100) : 0;
    const type = story_type || 'appeal';

    // Generate story based on campaign data and story type
    let storyText = '';

    if (type === 'appeal') {
      storyText = `📢 **${esc(title)}** — We Need Your Help!\n\n`;
      storyText += description ? `${esc(description.substring(0, 300))}\n\n` : '';
      storyText += `We are raising UGX ${target.toLocaleString()} to make this a reality.\n\n`;
      if (totalRaised > 0) {
        storyText += `Thanks to ${donorCount} generous supporters, we've already raised UGX ${totalRaised.toLocaleString()} (${goalPct}% of our goal).\n\n`;
      }
      storyText += `Every contribution counts. Here's how your donation can make an impact:\n`;
      storyText += `• UGX 10,000 — Provides meals for children for a week\n`;
      storyText += `• UGX 50,000 — Supplies textbooks for a student\n`;
      storyText += `• UGX 100,000 — Funds medical care for a patient\n`;
      storyText += `• UGX 200,000 — Covers school fees for one term\n`;
      storyText += `\nNo amount is too small. Together, we can change lives. 💚\n\nDonate now and be part of something meaningful!`;
    } else if (type === 'update') {
      storyText = `📈 **Progress Update: ${esc(title)}**\n\n`;
      storyText += `We're excited to share our progress with you!\n\n`;
      storyText += `📊 **By the Numbers:**\n`;
      storyText += `• Goal: UGX ${target.toLocaleString()}\n`;
      storyText += `• Raised so far: UGX ${totalRaised.toLocaleString()} (${goalPct}%)\n`;
      storyText += `• Generous donors: ${donorCount}\n\n`;
      if (goalPct >= 75) {
        storyText += `🔥 We're so close to our goal! Just UGX ${(target - totalRaised).toLocaleString()} more to go!\n\n`;
      } else if (goalPct >= 50) {
        storyText += `💪 We're halfway there! Your continued support will get us to the finish line.\n\n`;
      } else {
        storyText += `🌱 We're building momentum! Every donation brings us closer to our goal.\n\n`;
      }
      storyText += `Thank you to everyone who has contributed so far. Your generosity is making a real difference!\n\nShare this campaign with friends and family to help us reach our goal faster. 🙏`;
    } else if (type === 'thank_you') {
      storyText = `🙏 **Thank You! — ${esc(title)}**\n\n`;
      storyText += `Because of YOU, we've raised UGX ${totalRaised.toLocaleString()} from ${donorCount} incredible supporters!\n\n`;
      storyText += `Your generosity is more than just a number — it's changed lives, brought hope, and made a lasting impact.\n\n`;
      storyText += `💙 What your donations have made possible:\n`;
      storyText += `• Community members receiving vital support\n`;
      storyText += `• Real progress toward our shared mission\n`;
      storyText += `• Hope restored for families in need\n\n`;
      storyText += `We couldn't have done this without you. From the bottom of our hearts — THANK YOU!\n\n`;
      if (goalPct < 100) {
        storyText += `We're still raising funds to reach our goal of UGX ${target.toLocaleString()}. Every additional donation goes further! 💚`;
      } else {
        storyText += `🎉 We've reached our goal! Your support made this milestone possible!`;
      }
    } else if (type === 'impact_report') {
      storyText = `📋 **Impact Report: ${esc(title)}**\n\n`;
      storyText += `Here's a look at the impact your donations have created:\n\n`;
      storyText += `💰 **Financial Overview:**\n`;
      storyText += `• Total raised: UGX ${totalRaised.toLocaleString()}\n`;
      storyText += `• Campaign goal: UGX ${target.toLocaleString()}\n`;
      storyText += `• Progress: ${goalPct}%\n`;
      storyText += `• Total donors: ${donorCount}\n\n`;
      storyText += `🌍 **Impact Highlights:**\n`;
      storyText += `• Community members directly impacted by this campaign\n`;
      storyText += `• Sustainable programs initiated through your support\n`;
      storyText += `• Long-term benefits for families and children\n\n`;
      storyText += `📊 **Transparency Pledge:**\n`;
      storyText += `We are committed to full transparency. Every shilling donated goes directly toward the campaign's mission.\n\n`;
      storyText += `Thank you for trusting us with your generosity. Together, we're building a better future. 🌟`;
    } else if (type === 'social_media') {
      const hashtags = '#GiveHope #SupportUG #Fundraising #CommunityFirst #MakeADifference';
      storyText = `✨ Help us make a difference! ✨\n\n`;
      storyText += `We're raising UGX ${target.toLocaleString()} for "${esc(title)}".\n\n`;
      if (totalRaised > 0) {
        storyText += `We've raised UGX ${totalRaised.toLocaleString()} so far (${goalPct}%)! 🎉\n\n`;
      }
      storyText += `Every donation counts — even UGX 10,000 can change a life! 💚\n\n`;
      storyText += `👉 Donate now and share with your network!\n\n`;
      storyText += hashtags;
    }

    const result = await pool.query(
      'INSERT INTO ai_campaign_stories (tenant_id, campaign_id, story_text, story_type) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, req.params.id, storyText, type]
    );

    await audit(req.session.user.email, 'campaign_story_generated', 'Generated ' + type + ' story for campaign #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /api/campaigns/:id/stories — Get stories for a campaign
  app.get('/api/campaigns/:id/stories', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT * FROM ai_campaign_stories WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY generated_at DESC',
      [t, req.params.id]
    );
    res.json(result.rows);
  }));

};
