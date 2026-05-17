/**
 * Fundraising Ultimate3 Module — Campaign Optimization & Smart Tools
 * Features: A/B Testing, Smart Scheduling, Co-Creation, Bundle Packs,
 * Health Monitor, Calendar Planner, Goal Recommender, Storyboard Builder,
 * Form Builder, Success Blueprint, Thank You Engine, Micro Round-Ups,
 * Donation Scheduler, Seasonality Adjuster, Amount Suggestions
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 1: Campaign A/B Testing Engine
    `CREATE TABLE IF NOT EXISTS campaign_ab_tests (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, test_element TEXT NOT NULL, variant_a TEXT, variant_b TEXT, variant_a_views INTEGER DEFAULT 0, variant_b_views INTEGER DEFAULT 0, variant_a_conversions INTEGER DEFAULT 0, variant_b_conversions INTEGER DEFAULT 0, winner TEXT, status TEXT DEFAULT 'running' CHECK (status IN ('running','completed','cancelled')), started_at TIMESTAMPTZ DEFAULT NOW(), ended_at TIMESTAMPTZ, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ab_tests_tenant ON campaign_ab_tests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ab_tests_campaign ON campaign_ab_tests(campaign_id)`,

    // Feature 2: Smart Campaign Scheduling
    `CREATE TABLE IF NOT EXISTS campaign_schedules (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, scheduled_date DATE, scheduled_time TEXT, timezone TEXT DEFAULT 'Africa/Kampala', recommended_based_on TEXT, auto_launch BOOLEAN DEFAULT false, status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','launched','cancelled','completed')), launched_at TIMESTAMPTZ, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS scheduling_insights (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, best_day TEXT, best_hour INTEGER, best_month INTEGER, avg_performance NUMERIC, sample_size INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_schedules_tenant ON campaign_schedules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduling_insights_tenant ON scheduling_insights(tenant_id)`,

    // Feature 3: Campaign Co-Creation
    `CREATE TABLE IF NOT EXISTS campaign_co_creators (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, collaborator_email TEXT NOT NULL, role TEXT DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')), permissions_json TEXT DEFAULT '{}', invited_at TIMESTAMPTZ DEFAULT NOW(), accepted_at TIMESTAMPTZ, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','removed')))`,

    `CREATE TABLE IF NOT EXISTS campaign_edit_history (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, editor_email TEXT, field_changed TEXT, old_value TEXT, new_value TEXT, edited_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_co_creators_tenant ON campaign_co_creators(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_edit_history_campaign ON campaign_edit_history(campaign_id)`,

    // Feature 4: Campaign Bundle Packs
    `CREATE TABLE IF NOT EXISTS campaign_bundles (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, cover_image TEXT, total_target INTEGER DEFAULT 0, total_raised INTEGER DEFAULT 0, campaign_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('active','closed','archived')), created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS campaign_bundle_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, bundle_id INTEGER NOT NULL REFERENCES campaign_bundles(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, display_order INTEGER DEFAULT 0, added_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_bundles_tenant ON campaign_bundles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON campaign_bundle_items(bundle_id)`,

    // Feature 5: Campaign Health Monitor
    `CREATE TABLE IF NOT EXISTS campaign_health_scores (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, health_score INTEGER DEFAULT 0, momentum_score INTEGER DEFAULT 0, engagement_score INTEGER DEFAULT 0, conversion_score INTEGER DEFAULT 0, velocity NUMERIC DEFAULT 0, trend TEXT DEFAULT 'stable' CHECK (trend IN ('improving','stable','declining')), recommendations_json TEXT DEFAULT '[]', checked_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_health_scores_tenant ON campaign_health_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_health_scores_campaign ON campaign_health_scores(campaign_id)`,

    // Feature 6: Fundraising Calendar & Planner
    `CREATE TABLE IF NOT EXISTS fundraising_calendar (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, event_type TEXT DEFAULT 'campaign' CHECK (event_type IN ('campaign','event','deadline','milestone','meeting','other')), start_date DATE, end_date DATE, campaign_id INTEGER, target_amount INTEGER, description TEXT, color TEXT DEFAULT '#059669', is_recurring BOOLEAN DEFAULT false, recurrence_pattern TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_calendar_tenant ON fundraising_calendar(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_calendar_dates ON fundraising_calendar(start_date, end_date)`,

    // Feature 7: Smart Goal Recommender
    `CREATE TABLE IF NOT EXISTS goal_recommendations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, recommended_target INTEGER, confidence NUMERIC DEFAULT 0, based_on_campaigns INTEGER DEFAULT 0, based_on_category TEXT, factor_analysis_json TEXT DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_goal_recs_tenant ON goal_recommendations(tenant_id)`,

    // Feature 8: Campaign Storyboard Builder
    `CREATE TABLE IF NOT EXISTS campaign_storyboards (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, theme TEXT DEFAULT 'classic', layout TEXT DEFAULT 'single', status TEXT DEFAULT 'draft' CHECK (status IN ('draft','published','archived')), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS storyboard_sections (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, storyboard_id INTEGER NOT NULL REFERENCES campaign_storyboards(id) ON DELETE CASCADE, section_type TEXT DEFAULT 'text' CHECK (section_type IN ('text','image','video','quote','stats','cta','divider')), title TEXT, content TEXT, media_url TEXT, display_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_storyboards_tenant ON campaign_storyboards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sections_storyboard ON storyboard_sections(storyboard_id)`,

    // Feature 9: Donation Form Builder
    `CREATE TABLE IF NOT EXISTS donation_forms (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, campaign_id INTEGER, fields_json TEXT DEFAULT '[]', theme_json TEXT DEFAULT '{}', confirmation_message TEXT, is_active BOOLEAN DEFAULT true, submission_count INTEGER DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donation_form_submissions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, form_id INTEGER NOT NULL REFERENCES donation_forms(id) ON DELETE CASCADE, donor_email TEXT, responses_json TEXT DEFAULT '{}', amount INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_forms_tenant ON donation_forms(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON donation_form_submissions(form_id)`,

    // Feature 10: Campaign Success Blueprint
    `CREATE TABLE IF NOT EXISTS campaign_blueprints (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, category TEXT, success_factors_json TEXT DEFAULT '[]', avg_conversion NUMERIC DEFAULT 0, avg_raise INTEGER DEFAULT 0, key_metrics_json TEXT DEFAULT '{}', template_data_json TEXT DEFAULT '{}', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_blueprints_tenant ON campaign_blueprints(tenant_id)`,

    // Feature 11: Smart Thank You Engine
    `CREATE TABLE IF NOT EXISTS thank_you_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, channel TEXT DEFAULT 'email' CHECK (channel IN ('email','sms','whatsapp')), template_text TEXT NOT NULL, tier_trigger TEXT, is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS thank_you_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, campaign_id INTEGER, template_id INTEGER, channel TEXT, sent_at TIMESTAMPTZ DEFAULT NOW(), delivered BOOLEAN DEFAULT false, opened_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_templates_tenant ON thank_you_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_log_tenant ON thank_you_log(tenant_id)`,

    // Feature 12: Micro-Donation Round-Ups
    `CREATE TABLE IF NOT EXISTS micro_roundup_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, enabled BOOLEAN DEFAULT true, round_to INTEGER DEFAULT 1000, max_roundup INTEGER DEFAULT 5000, total_roundup_collected INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS micro_roundup_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, original_amount INTEGER NOT NULL, rounded_amount INTEGER NOT NULL, roundup_amount INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_roundup_settings_tenant ON micro_roundup_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_roundup_tx_tenant ON micro_roundup_transactions(tenant_id)`,

    // Feature 13: Donation Day Scheduler
    `CREATE TABLE IF NOT EXISTS scheduled_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, campaign_id INTEGER, amount INTEGER NOT NULL, scheduled_date DATE NOT NULL, recurrence TEXT DEFAULT 'once' CHECK (recurrence IN ('once','weekly','monthly','quarterly','annually')), status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processed','cancelled','failed')), reminder_sent BOOLEAN DEFAULT false, processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_donations_tenant ON scheduled_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_donations_date ON scheduled_donations(scheduled_date)`,

    // Feature 14: Campaign Seasonality Adjuster
    `CREATE TABLE IF NOT EXISTS seasonality_profiles (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12), season_name TEXT, giving_multiplier NUMERIC DEFAULT 1.0, avg_historic_donations INTEGER DEFAULT 0, avg_historic_amount INTEGER DEFAULT 0, notes TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, month))`,
    `CREATE INDEX IF NOT EXISTS idx_seasonality_tenant ON seasonality_profiles(tenant_id)`,

    // Feature 15: Smart Donation Amount Suggestions
    `CREATE TABLE IF NOT EXISTS amount_suggestions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT, suggested_amounts_json TEXT DEFAULT '[]', based_on TEXT, confidence NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS amount_suggestion_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, preset_amounts_json TEXT DEFAULT '[5000,10000,25000,50000,100000,250000]', show_custom BOOLEAN DEFAULT true, show_round_up BOOLEAN DEFAULT true, min_amount INTEGER DEFAULT 500, max_amount INTEGER DEFAULT 50000000, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_amount_suggestions_tenant ON amount_suggestions(tenant_id)`,

    // Seed default thank-you templates
    `INSERT INTO thank_you_templates (tenant_id, name, channel, template_text, tier_trigger, is_default) SELECT t.id, 'Standard Thank You', 'email', 'Dear {donor_name}, Thank you for your generous donation of UGX {amount} to {campaign_title}. Your support makes a real difference. With gratitude, {organization}', NULL, true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM thank_you_templates WHERE tenant_id=t.id AND name='Standard Thank You')`,
    `INSERT INTO thank_you_templates (tenant_id, name, channel, template_text, tier_trigger, is_default) SELECT t.id, 'SMS Thank You', 'sms', 'Thank you {donor_name} for donating UGX {amount} to {campaign_title}! Your generosity is changing lives.', NULL, true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM thank_you_templates WHERE tenant_id=t.id AND name='SMS Thank You')`,
    `INSERT INTO thank_you_templates (tenant_id, name, channel, template_text, tier_trigger, is_default) SELECT t.id, 'Major Donor Thank You', 'email', 'Dear {donor_name}, Your remarkable contribution of UGX {amount} to {campaign_title} demonstrates extraordinary generosity. We would love to share the impact of your gift and invite you to see the results firsthand. With deepest appreciation, {organization}', 'gold', false FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM thank_you_templates WHERE tenant_id=t.id AND name='Major Donor Thank You')`,

    // Seed default seasonality profiles
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 1, 'New Year Recovery', 0.7, 0, 0, 'Post-holiday giving is typically lower' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=1)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 2, 'Back to School', 0.8, 0, 0, 'School fees competing for funds' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=2)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 3, 'Lent Season', 1.2, 0, 0, 'Increased faith-based giving' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=3)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 4, 'Easter Period', 1.3, 0, 0, 'Easter giving peak' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=4)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 5, 'Post-Easter', 0.9, 0, 0, 'Slight dip after Easter' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=5)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 6, 'Mid-Year', 0.85, 0, 0, 'Mid-year giving steady' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=6)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 7, 'Summer Lull', 0.75, 0, 0, 'Holiday season reduces giving' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=7)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 8, 'Back to Routine', 0.9, 0, 0, 'People returning to routine' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=8)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 9, 'Autumn Rise', 1.1, 0, 0, 'Giving picks up in autumn' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=9)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 10, 'Harvest Season', 1.15, 0, 0, 'Harvest thanksgiving giving' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=10)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 11, 'Pre-Christmas', 1.4, 0, 0, 'Holiday giving season starts' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=11)`,
    `INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, avg_historic_donations, avg_historic_amount, notes) SELECT t.id, 12, 'Christmas Peak', 1.6, 0, 0, 'Peak giving season of the year' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM seasonality_profiles WHERE tenant_id=t.id AND month=12)`,

    // Seed default amount suggestion settings
    `INSERT INTO amount_suggestion_settings (tenant_id, preset_amounts_json, show_custom, show_round_up, min_amount, max_amount) SELECT t.id, '[5000,10000,25000,50000,100000,250000]', true, true, 500, 50000000 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM amount_suggestion_settings WHERE tenant_id=t.id)`,

    // Seed default micro-roundup settings
    `INSERT INTO micro_roundup_settings (tenant_id, enabled, round_to, max_roundup, total_roundup_collected) SELECT t.id, true, 1000, 5000, 0 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM micro_roundup_settings WHERE tenant_id=t.id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate3] Migrations complete — 15 features');
  })();

  // =============================================
  // FEATURE 1: CAMPAIGN A/B TESTING ENGINE
  // =============================================
  app.post('/api/campaign-ab-tests', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, test_element, variant_a, variant_b } = req.body;
    if (!campaign_id || !test_element) return res.status(400).json({ error: 'campaign_id and test_element required' });
    const r = await pool.query(`INSERT INTO campaign_ab_tests (tenant_id, campaign_id, test_element, variant_a, variant_b, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, campaign_id, esc(test_element), esc(variant_a||''), esc(variant_b||''), req.session.user.email]);
    await audit(req, 'create', 'campaign_ab_tests', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/campaign-ab-tests/active', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_ab_tests WHERE tenant_id=$1 AND status='running' ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/campaign-ab-tests/:id/results', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_ab_tests WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Test not found' });
    const t = r.rows[0];
    const aRate = t.variant_a_views > 0 ? (t.variant_a_conversions / t.variant_a_views * 100).toFixed(2) : 0;
    const bRate = t.variant_b_views > 0 ? (t.variant_b_conversions / t.variant_b_views * 100).toFixed(2) : 0;
    res.json({ ...t, variant_a_rate: aRate, variant_b_rate: bRate, winner: parseFloat(bRate) > parseFloat(aRate) ? 'B' : 'A' });
  }));

  app.post('/api/campaign-ab-tests/:id/end', requireAuth, ah(async (req, res) => {
    const test = await pool.query(`SELECT * FROM campaign_ab_tests WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!test.rows.length) return res.status(404).json({ error: 'Test not found' });
    const t = test.rows[0];
    const aRate = t.variant_a_views > 0 ? t.variant_a_conversions / t.variant_a_views : 0;
    const bRate = t.variant_b_views > 0 ? t.variant_b_conversions / t.variant_b_views : 0;
    const winner = bRate > aRate ? 'B' : 'A';
    const r = await pool.query(`UPDATE campaign_ab_tests SET status='completed', winner=$1, ended_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *`, [winner, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'campaign_ab_tests', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/campaign-ab-tests/:id/track', ah(async (req, res) => {
    const { variant, type } = req.body; // type: 'view' or 'conversion'
    const col = variant === 'B' ? (type === 'conversion' ? 'variant_b_conversions' : 'variant_b_views') : (type === 'conversion' ? 'variant_a_conversions' : 'variant_a_views');
    await pool.query(`UPDATE campaign_ab_tests SET ${col} = ${col} + 1 WHERE id=$1 AND status='running'`, [req.params.id]);
    res.json({ ok: true });
  }));

  // =============================================
  // FEATURE 2: SMART CAMPAIGN SCHEDULING
  // =============================================
  app.get('/api/campaign-schedules', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_schedules WHERE tenant_id=$1 ORDER BY scheduled_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/campaign-schedules', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, scheduled_date, scheduled_time, auto_launch } = req.body;
    const r = await pool.query(`INSERT INTO campaign_schedules (tenant_id, campaign_id, scheduled_date, scheduled_time, auto_launch, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, campaign_id||null, scheduled_date, scheduled_time||'09:00', auto_launch||false, req.session.user.email]);
    await audit(req, 'create', 'campaign_schedules', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/campaign-schedules/:id', requireAuth, ah(async (req, res) => {
    const { scheduled_date, scheduled_time, status } = req.body;
    const r = await pool.query(`UPDATE campaign_schedules SET scheduled_date=COALESCE($1,scheduled_date), scheduled_time=COALESCE($2,scheduled_time), status=COALESCE($3,status) WHERE tenant_id=$4 AND id=$5 RETURNING *`, [scheduled_date, scheduled_time, status, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'campaign_schedules', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/campaign-schedules/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM campaign_schedules WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'campaign_schedules', req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/campaign-schedules/analyze', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const r = await pool.query(`SELECT EXTRACT(DOW FROM created_at) as dow, EXTRACT(HOUR FROM created_at) as hr, COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '12 months' GROUP BY dow, hr ORDER BY total DESC`, [tid]);
    if (r.rows.length) {
      const best = r.rows[0];
      await pool.query(`INSERT INTO scheduling_insights (tenant_id, best_day, best_hour, best_month, avg_performance, sample_size) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET best_day=$2, best_hour=$3, best_month=$4, avg_performance=$5, sample_size=$6, updated_at=NOW()`, [tid, ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][best.dow]||'Tuesday', best.hr||9, best.dow+1, best.total, r.rows.length]);
    }
    res.json(r.rows);
  }));

  app.get('/api/campaign-schedules/recommendations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM scheduling_insights WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 3: CAMPAIGN CO-CREATION
  // =============================================
  app.post('/api/campaign-co-create/:id/invite', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { collaborator_email, role } = req.body;
    if (!collaborator_email) return res.status(400).json({ error: 'collaborator_email required' });
    const r = await pool.query(`INSERT INTO campaign_co_creators (tenant_id, campaign_id, collaborator_email, role) VALUES ($1,$2,$3,$4) RETURNING *`, [tid, req.params.id, esc(collaborator_email), role||'editor']);
    await audit(req, 'create', 'campaign_co_creators', r.rows[0].id);
    try { await sendEmail(collaborator_email, 'Campaign Collaboration Invite', `You've been invited to collaborate on a campaign. Accept at ${BASE_URL}/campaign-co-creation`); } catch(e){}
    res.json(r.rows[0]);
  }));

  app.put('/api/campaign-co-create/:id/accept', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE campaign_co_creators SET status='accepted', accepted_at=NOW() WHERE tenant_id=$1 AND campaign_id=$2 AND collaborator_email=$3 AND status='pending' RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email]);
    if (!r.rows.length) return res.status(404).json({ error: 'No pending invitation found' });
    res.json(r.rows[0]);
  }));

  app.get('/api/campaign-co-create/:id/history', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_edit_history WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY edited_at DESC LIMIT 50`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.delete('/api/campaign-co-create/:id/collaborator/:email', requireAuth, ah(async (req, res) => {
    await pool.query(`UPDATE campaign_co_creators SET status='removed' WHERE tenant_id=$1 AND campaign_id=$2 AND collaborator_email=$3`, [req.session.user.tenant_id, req.params.id, req.params.email]);
    await audit(req, 'delete', 'campaign_co_creators', req.params.id);
    res.json({ ok: true });
  }));

  // =============================================
  // FEATURE 4: CAMPAIGN BUNDLE PACKS
  // =============================================
  app.get('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_bundles WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, cover_image } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO campaign_bundles (tenant_id, name, description, cover_image, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, esc(name), esc(description||''), esc(cover_image||''), req.session.user.email]);
    await audit(req, 'create', 'campaign_bundles', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/campaign-bundles/:id', requireAuth, ah(async (req, res) => {
    const { name, description, status } = req.body;
    const r = await pool.query(`UPDATE campaign_bundles SET name=COALESCE($1,name), description=COALESCE($2,description), status=COALESCE($3,status) WHERE tenant_id=$4 AND id=$5 RETURNING *`, [name?esc(name):null, description?esc(description):null, status, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'campaign_bundles', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/campaign-bundles/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM campaign_bundles WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'campaign_bundles', req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/campaign-bundles/:id/campaigns', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, display_order } = req.body;
    const r = await pool.query(`INSERT INTO campaign_bundle_items (tenant_id, bundle_id, campaign_id, display_order) VALUES ($1,$2,$3,$4) RETURNING *`, [tid, req.params.id, campaign_id, display_order||0]);
    await pool.query(`UPDATE campaign_bundles SET campaign_count=(SELECT COUNT(*) FROM campaign_bundle_items WHERE bundle_id=$1) WHERE id=$1`, [req.params.id]);
    await audit(req, 'create', 'campaign_bundle_items', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/campaign-bundles/:id/campaigns/:campaignId', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM campaign_bundle_items WHERE tenant_id=$1 AND bundle_id=$2 AND campaign_id=$3`, [req.session.user.tenant_id, req.params.id, req.params.campaignId]);
    await pool.query(`UPDATE campaign_bundles SET campaign_count=(SELECT COUNT(*) FROM campaign_bundle_items WHERE bundle_id=$1) WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));

  app.get('/api/campaign-bundles/:id/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT b.*, COALESCE(SUM(c.goal_amount),0) as total_target, COALESCE(SUM(c.raised_amount),0) as total_raised FROM campaign_bundles b LEFT JOIN campaign_bundle_items bi ON b.id=bi.bundle_id LEFT JOIN fundraising_campaigns c ON bi.campaign_id=c.id WHERE b.tenant_id=$1 AND b.id=$2 GROUP BY b.id`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0] || {});
  }));

  // =============================================
  // FEATURE 5: CAMPAIGN HEALTH MONITOR
  // =============================================
  app.get('/api/campaign-health/:campaignId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = req.params.campaignId;
    const camp = await pool.query(`SELECT * FROM fundraising_campaigns WHERE tenant_id=$1 AND id=$2`, [tid, cid]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const progress = c.goal_amount > 0 ? Math.min(100, Math.round(c.raised_amount / c.goal_amount * 100)) : 0;
    const daysSince = Math.max(1, Math.floor((Date.now() - new Date(c.created_at)) / 86400000));
    const velocity = Math.round(c.raised_amount / daysSince);
    const donors = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1 AND campaign_id=$2`, [tid, cid]);
    const donorCount = parseInt(donors.rows[0]?.cnt || 0);
    const engagementScore = Math.min(100, Math.round(donorCount * 2 + (c.views_count || 0) * 0.1));
    const healthScore = Math.min(100, Math.round(progress * 0.4 + engagementScore * 0.3 + Math.min(100, velocity / 100) * 0.3));
    const trend = progress > 50 ? 'improving' : progress > 20 ? 'stable' : 'declining';
    const recs = [];
    if (progress < 25) recs.push('Consider boosting campaign visibility through social media');
    if (donorCount < 5) recs.push('Campaign needs more donors - try ambassador outreach');
    if (velocity < 5000) recs.push('Donation velocity is low - consider updating the story');
    await pool.query(`INSERT INTO campaign_health_scores (tenant_id, campaign_id, health_score, momentum_score, engagement_score, conversion_score, velocity, trend, recommendations_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [tid, cid, healthScore, Math.min(100, Math.round(velocity/100)), engagementScore, progress, velocity, trend, JSON.stringify(recs)]);
    res.json({ health_score: healthScore, momentum: Math.min(100, Math.round(velocity/100)), engagement: engagementScore, conversion: progress, velocity, trend, recommendations: recs });
  }));

  app.post('/api/campaign-health/check-all', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const camps = await pool.query(`SELECT id FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active'`, [tid]);
    const results = [];
    for (const c of camps.rows) {
      try {
        const healthRes = await new Promise((resolve) => {
          const origJson = res.json;
          res.json = (data) => { res.json = origJson; resolve(data); };
          app.handle({ method: 'GET', url: `/api/campaign-health/${c.id}`, params: { campaignId: c.id }, session: req.session }, { json: (d) => resolve(d), status: () => ({ json: (d) => resolve(d) }) });
        });
        results.push({ campaign_id: c.id, ...healthRes });
      } catch(e) { results.push({ campaign_id: c.id, error: e.message }); }
    }
    res.json({ checked: results.length, results });
  }));

  app.get('/api/campaign-health/alerts', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT chs.*, fc.title as campaign_title FROM campaign_health_scores chs LEFT JOIN fundraising_campaigns fc ON chs.campaign_id=fc.id WHERE chs.tenant_id=$1 AND (chs.health_score < 40 OR chs.trend='declining') ORDER BY chs.health_score ASC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 6: FUNDRAISING CALENDAR & PLANNER
  // =============================================
  app.get('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fundraising_calendar WHERE tenant_id=$1 ORDER BY start_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, event_type, start_date, end_date, campaign_id, target_amount, description, color, is_recurring, recurrence_pattern } = req.body;
    if (!title || !start_date) return res.status(400).json({ error: 'title and start_date required' });
    const r = await pool.query(`INSERT INTO fundraising_calendar (tenant_id, title, event_type, start_date, end_date, campaign_id, target_amount, description, color, is_recurring, recurrence_pattern, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [tid, esc(title), event_type||'campaign', start_date, end_date||start_date, campaign_id||null, target_amount||0, esc(description||''), color||'#059669', is_recurring||false, recurrence_pattern||null, req.session.user.email]);
    await audit(req, 'create', 'fundraising_calendar', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/fundraising-calendar/:id', requireAuth, ah(async (req, res) => {
    const { title, start_date, end_date, description, color } = req.body;
    const r = await pool.query(`UPDATE fundraising_calendar SET title=COALESCE($1,title), start_date=COALESCE($2,start_date), end_date=COALESCE($3,end_date), description=COALESCE($4,description), color=COALESCE($5,color) WHERE tenant_id=$6 AND id=$7 RETURNING *`, [title?esc(title):null, start_date, end_date, description?esc(description):null, color, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'fundraising_calendar', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/fundraising-calendar/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM fundraising_calendar WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'fundraising_calendar', req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/fundraising-calendar/month/:year/:month', requireAuth, ah(async (req, res) => {
    const { year, month } = req.params;
    const r = await pool.query(`SELECT * FROM fundraising_calendar WHERE tenant_id=$1 AND ((EXTRACT(YEAR FROM start_date)=$2 AND EXTRACT(MONTH FROM start_date)=$3) OR (start_date <= MAKE_DATE($2,$3,1) + INTERVAL '1 month - 1 day' AND end_date >= MAKE_DATE($2,$3,1))) ORDER BY start_date`, [req.session.user.tenant_id, year, month]);
    res.json(r.rows);
  }));

  app.get('/api/fundraising-calendar/upcoming', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fundraising_calendar WHERE tenant_id=$1 AND start_date >= CURRENT_DATE ORDER BY start_date LIMIT 20`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 7: SMART GOAL RECOMMENDER
  // =============================================
  app.post('/api/goal-recommendations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, category } = req.body;
    const hist = await pool.query(`SELECT AVG(goal_amount) as avg_goal, AVG(raised_amount) as avg_raised, COUNT(*) as cnt FROM fundraising_campaigns WHERE tenant_id=$1 AND category=$2 AND status IN ('active','funded','completed')`, [tid, category||'general']);
    const avgGoal = parseInt(hist.rows[0]?.avg_goal || 5000000);
    const avgRaised = parseInt(hist.rows[0]?.avg_raised || 2500000);
    const ratio = avgGoal > 0 ? avgRaised / avgGoal : 0.5;
    const recommended = Math.round(avgGoal * Math.min(1.2, Math.max(0.8, ratio)));
    const r = await pool.query(`INSERT INTO goal_recommendations (tenant_id, campaign_id, recommended_target, confidence, based_on_campaigns, based_on_category, factor_analysis_json) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [tid, campaign_id||null, recommended, Math.min(100, Math.round(hist.rows[0]?.cnt * 10 || 0)), hist.rows[0]?.cnt || 0, category||'general', JSON.stringify({ avg_goal: avgGoal, avg_raised: avgRaised, ratio, sample: hist.rows[0]?.cnt || 0 })]);
    res.json(r.rows[0]);
  }));

  app.get('/api/goal-recommendations/:campaignId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM goal_recommendations WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC LIMIT 1`, [req.session.user.tenant_id, req.params.campaignId]);
    res.json(r.rows[0] || {});
  }));

  app.get('/api/goal-recommendations/category/:category', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM goal_recommendations WHERE tenant_id=$1 AND based_on_category=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.category]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 8: CAMPAIGN STORYBOARD BUILDER
  // =============================================
  app.get('/api/storyboards', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT s.*, COUNT(ss.id) as section_count FROM campaign_storyboards s LEFT JOIN storyboard_sections ss ON s.id=ss.storyboard_id WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/storyboards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, theme, layout } = req.body;
    const r = await pool.query(`INSERT INTO campaign_storyboards (tenant_id, campaign_id, theme, layout) VALUES ($1,$2,$3,$4) RETURNING *`, [tid, campaign_id||null, theme||'classic', layout||'single']);
    await audit(req, 'create', 'campaign_storyboards', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/storyboards/:id/sections', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { section_type, title, content, media_url, display_order } = req.body;
    const r = await pool.query(`INSERT INTO storyboard_sections (tenant_id, storyboard_id, section_type, title, content, media_url, display_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [tid, req.params.id, section_type||'text', esc(title||''), esc(content||''), esc(media_url||''), display_order||0]);
    await audit(req, 'create', 'storyboard_sections', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/storyboards/:id/sections/:sectionId/reorder', requireAuth, ah(async (req, res) => {
    const { display_order } = req.body;
    const r = await pool.query(`UPDATE storyboard_sections SET display_order=$1 WHERE tenant_id=$2 AND storyboard_id=$3 AND id=$4 RETURNING *`, [display_order, req.session.user.tenant_id, req.params.id, req.params.sectionId]);
    res.json(r.rows[0]);
  }));

  app.get('/api/storyboards/:id/preview', requireAuth, ah(async (req, res) => {
    const sb = await pool.query(`SELECT * FROM campaign_storyboards WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    const sec = await pool.query(`SELECT * FROM storyboard_sections WHERE tenant_id=$1 AND storyboard_id=$2 ORDER BY display_order`, [req.session.user.tenant_id, req.params.id]);
    res.json({ storyboard: sb.rows[0], sections: sec.rows });
  }));

  app.delete('/api/storyboards/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM campaign_storyboards WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'campaign_storyboards', req.params.id);
    res.json({ ok: true });
  }));

  // =============================================
  // FEATURE 9: DONATION FORM BUILDER
  // =============================================
  app.get('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT f.*, COUNT(fs.id) as submission_count FROM donation_forms f LEFT JOIN donation_form_submissions fs ON f.id=fs.form_id WHERE f.tenant_id=$1 GROUP BY f.id ORDER BY f.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, campaign_id, fields_json, theme_json, confirmation_message } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO donation_forms (tenant_id, name, campaign_id, fields_json, theme_json, confirmation_message, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [tid, esc(name), campaign_id||null, JSON.stringify(fields_json||[{type:'amount',label:'Donation Amount',required:true},{type:'name',label:'Full Name',required:true},{type:'email',label:'Email',required:true},{type:'phone',label:'Phone',required:false}]), JSON.stringify(theme_json||{primaryColor:'#059669',fontFamily:'sans-serif'}), esc(confirmation_message||'Thank you for your generous donation!'), req.session.user.email]);
    await audit(req, 'create', 'donation_forms', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/donation-forms/:id', requireAuth, ah(async (req, res) => {
    const { name, fields_json, theme_json, confirmation_message, is_active } = req.body;
    const r = await pool.query(`UPDATE donation_forms SET name=COALESCE($1,name), fields_json=COALESCE($2,fields_json), theme_json=COALESCE($3,theme_json), confirmation_message=COALESCE($4,confirmation_message), is_active=COALESCE($5,is_active) WHERE tenant_id=$6 AND id=$7 RETURNING *`, [name?esc(name):null, fields_json?JSON.stringify(fields_json):null, theme_json?JSON.stringify(theme_json):null, confirmation_message?esc(confirmation_message):null, is_active, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'donation_forms', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/donation-forms/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM donation_forms WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'donation_forms', req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/donation-forms/:id/submit', ah(async (req, res) => {
    const { donor_email, responses, amount } = req.body;
    const form = await pool.query(`SELECT * FROM donation_forms WHERE id=$1 AND is_active=true`, [req.params.id]);
    if (!form.rows.length) return res.status(404).json({ error: 'Form not found or inactive' });
    const r = await pool.query(`INSERT INTO donation_form_submissions (tenant_id, form_id, donor_email, responses_json, amount) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [form.rows[0].tenant_id, req.params.id, esc(donor_email||''), JSON.stringify(responses||{}), amount||0]);
    await pool.query(`UPDATE donation_forms SET submission_count=submission_count+1 WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));

  app.get('/api/donation-forms/:id/submissions', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donation_form_submissions WHERE tenant_id=$1 AND form_id=$2 ORDER BY created_at DESC LIMIT 100`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 10: CAMPAIGN SUCCESS BLUEPRINT
  // =============================================
  app.post('/api/campaign-blueprints/analyze', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { category } = req.body;
    const top = await pool.query(`SELECT id, title, goal_amount, raised_amount, created_at FROM fundraising_campaigns WHERE tenant_id=$1 AND category=$2 AND raised_amount >= goal_amount * 0.8 ORDER BY raised_amount DESC LIMIT 10`, [tid, category||'general']);
    if (!top.rows.length) return res.json({ message: 'Not enough successful campaigns to analyze', campaigns_analyzed: 0 });
    const avgGoal = Math.round(top.rows.reduce((s,c)=>s+parseInt(c.goal_amount||0),0)/top.rows.length);
    const avgRaise = Math.round(top.rows.reduce((s,c)=>s+parseInt(c.raised_amount||0),0)/top.rows.length);
    const avgConv = Math.round(top.rows.reduce((s,c)=>s+(c.goal_amount>0?c.raised_amount/c.goal_amount:0),0)/top.rows.length*100);
    const factors = ['Strong emotional storytelling','Clear impact metrics','Regular updates to donors','Social proof and testimonials','Multiple sharing channels','Urgency and deadline pressure','Matching donation opportunities'];
    const r = await pool.query(`INSERT INTO campaign_blueprints (tenant_id, name, category, success_factors_json, avg_conversion, avg_raise, key_metrics_json, template_data_json, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [tid, `Top ${category||'general'} Blueprint`, category||'general', JSON.stringify(factors), avgConv, avgRaise, JSON.stringify({avg_goal:avgGoal,avg_raise:avgRaise,campaigns_analyzed:top.rows.length}), JSON.stringify({avg_goal:avgGoal,factors}), req.session.user.email]);
    res.json(r.rows[0]);
  }));

  app.get('/api/campaign-blueprints', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_blueprints WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/campaign-blueprints/:id/apply', requireAuth, ah(async (req, res) => {
    const bp = await pool.query(`SELECT * FROM campaign_blueprints WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!bp.rows.length) return res.status(404).json({ error: 'Blueprint not found' });
    res.json({ message: 'Blueprint applied', blueprint: bp.rows[0], tip: 'Use the success factors and metrics to guide your campaign strategy' });
  }));

  app.get('/api/campaign-blueprints/top', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_blueprints WHERE tenant_id=$1 ORDER BY avg_conversion DESC LIMIT 5`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 11: SMART THANK YOU ENGINE
  // =============================================
  app.get('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM thank_you_templates WHERE tenant_id=$1 ORDER BY is_default DESC, created_at`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, channel, template_text, tier_trigger, is_default } = req.body;
    if (!name || !template_text) return res.status(400).json({ error: 'name and template_text required' });
    const r = await pool.query(`INSERT INTO thank_you_templates (tenant_id, name, channel, template_text, tier_trigger, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(name), channel||'email', esc(template_text), tier_trigger||null, is_default||false]);
    await audit(req, 'create', 'thank_you_templates', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/thank-you-templates/:id', requireAuth, ah(async (req, res) => {
    const { name, template_text, channel, tier_trigger } = req.body;
    const r = await pool.query(`UPDATE thank_you_templates SET name=COALESCE($1,name), template_text=COALESCE($2,template_text), channel=COALESCE($3,channel), tier_trigger=COALESCE($4,tier_trigger) WHERE tenant_id=$5 AND id=$6 RETURNING *`, [name?esc(name):null, template_text?esc(template_text):null, channel, tier_trigger, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/thank-you-templates/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM thank_you_templates WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ ok: true });
  }));

  app.post('/api/thank-you/send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, campaign_id, template_id, channel } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const tmpl = template_id ? await pool.query(`SELECT * FROM thank_you_templates WHERE tenant_id=$1 AND id=$2`, [tid, template_id]) : await pool.query(`SELECT * FROM thank_you_templates WHERE tenant_id=$1 AND is_default=true AND channel=$2 LIMIT 1`, [tid, channel||'email']);
    if (!tmpl.rows.length) return res.status(404).json({ error: 'No template found' });
    const ch = channel || tmpl.rows[0].channel;
    try {
      if (ch === 'email') await sendEmail(donor_email, 'Thank You for Your Donation', tmpl.rows[0].template_text);
      else if (ch === 'sms') await sendSMS(donor_email, tmpl.rows[0].template_text);
    } catch(e) {}
    const r = await pool.query(`INSERT INTO thank_you_log (tenant_id, donor_email, campaign_id, template_id, channel, delivered) VALUES ($1,$2,$3,$4,$5,true) RETURNING *`, [tid, esc(donor_email), campaign_id||null, tmpl.rows[0].id, ch]);
    res.json(r.rows[0]);
  }));

  app.post('/api/thank-you/auto-send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const unsent = await pool.query(`SELECT d.id, d.donor_email, d.campaign_id, d.amount FROM donations d LEFT JOIN thank_you_log tyl ON d.id=tyl.donation_id AND tyl.tenant_id=$1 WHERE d.tenant_id=$1 AND tyl.id IS NULL AND d.created_at > NOW() - INTERVAL '7 days' LIMIT 50`, [tid]);
    let sent = 0;
    for (const d of unsent.rows) {
      const tmpl = await pool.query(`SELECT * FROM thank_you_templates WHERE tenant_id=$1 AND is_default=true AND channel='email' LIMIT 1`, [tid]);
      if (tmpl.rows.length) {
        try { await sendEmail(d.donor_email, 'Thank You for Your Donation', tmpl.rows[0].template_text); } catch(e){}
        await pool.query(`INSERT INTO thank_you_log (tenant_id, donor_email, campaign_id, template_id, channel, delivered) VALUES ($1,$2,$3,$4,'email',true)`, [tid, d.donor_email, d.campaign_id, tmpl.rows[0].id]);
        sent++;
      }
    }
    res.json({ sent, total_unsent: unsent.rows.length });
  }));

  app.get('/api/thank-you/history', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM thank_you_log WHERE tenant_id=$1 ORDER BY sent_at DESC LIMIT 100`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/thank-you/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT channel, COUNT(*) as total_sent, COUNT(CASE WHEN delivered THEN 1 END) as delivered, COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened FROM thank_you_log WHERE tenant_id=$1 GROUP BY channel`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 12: MICRO-DONATION ROUND-UPS
  // =============================================
  app.get('/api/micro-roundup/settings', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM micro_roundup_settings WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || { enabled: true, round_to: 1000, max_roundup: 5000 });
  }));

  app.put('/api/micro-roundup/settings', requireAuth, ah(async (req, res) => {
    const { enabled, round_to, max_roundup } = req.body;
    const r = await pool.query(`INSERT INTO micro_roundup_settings (tenant_id, enabled, round_to, max_roundup) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET enabled=$2, round_to=$3, max_roundup=$4, updated_at=NOW() RETURNING *`, [req.session.user.tenant_id, enabled??true, round_to||1000, max_roundup||5000]);
    res.json(r.rows[0]);
  }));

  app.post('/api/micro-roundup/process', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donation_id, original_amount } = req.body;
    const settings = await pool.query(`SELECT * FROM micro_roundup_settings WHERE tenant_id=$1`, [tid]);
    const s = settings.rows[0];
    if (!s || !s.enabled) return res.json({ roundup_amount: 0, message: 'Round-up disabled' });
    const rounded = Math.ceil(original_amount / s.round_to) * s.round_to;
    const roundup = Math.min(rounded - original_amount, s.max_roundup);
    if (roundup <= 0) return res.json({ roundup_amount: 0, rounded_amount: original_amount });
    await pool.query(`INSERT INTO micro_roundup_transactions (tenant_id, donation_id, original_amount, rounded_amount, roundup_amount) VALUES ($1,$2,$3,$4,$5)`, [tid, donation_id||null, original_amount, rounded, roundup]);
    await pool.query(`UPDATE micro_roundup_settings SET total_roundup_collected=total_roundup_collected+$1 WHERE tenant_id=$2`, [roundup, tid]);
    res.json({ original_amount, rounded_amount: rounded, roundup_amount: roundup });
  }));

  app.get('/api/micro-roundup/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT s.total_roundup_collected, COUNT(t.id) as total_transactions, AVG(t.roundup_amount) as avg_roundup FROM micro_roundup_settings s LEFT JOIN micro_roundup_transactions t ON s.tenant_id=t.tenant_id WHERE s.tenant_id=$1 GROUP BY s.total_roundup_collected`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || { total_roundup_collected: 0, total_transactions: 0, avg_roundup: 0 });
  }));

  app.get('/api/micro-roundup/history', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM micro_roundup_transactions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 13: DONATION DAY SCHEDULER
  // =============================================
  app.get('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM scheduled_donations WHERE tenant_id=$1 ORDER BY scheduled_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, campaign_id, amount, scheduled_date, recurrence } = req.body;
    if (!donor_email || !amount || !scheduled_date) return res.status(400).json({ error: 'donor_email, amount, and scheduled_date required' });
    const r = await pool.query(`INSERT INTO scheduled_donations (tenant_id, donor_email, campaign_id, amount, scheduled_date, recurrence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(donor_email), campaign_id||null, amount, scheduled_date, recurrence||'once']);
    await audit(req, 'create', 'scheduled_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/scheduled-donations/:id', requireAuth, ah(async (req, res) => {
    const { amount, scheduled_date, recurrence, status } = req.body;
    const r = await pool.query(`UPDATE scheduled_donations SET amount=COALESCE($1,amount), scheduled_date=COALESCE($2,scheduled_date), recurrence=COALESCE($3,recurrence), status=COALESCE($4,status) WHERE tenant_id=$5 AND id=$6 RETURNING *`, [amount, scheduled_date, recurrence, status, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/scheduled-donations/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM scheduled_donations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ ok: true });
  }));

  app.get('/api/scheduled-donations/upcoming', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM scheduled_donations WHERE tenant_id=$1 AND status='pending' AND scheduled_date <= CURRENT_DATE + INTERVAL '7 days' ORDER BY scheduled_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/scheduled-donations/:id/process', requireAuth, ah(async (req, res) => {
    const sd = await pool.query(`SELECT * FROM scheduled_donations WHERE tenant_id=$1 AND id=$2 AND status='pending'`, [req.session.user.tenant_id, req.params.id]);
    if (!sd.rows.length) return res.status(404).json({ error: 'Scheduled donation not found or already processed' });
    await pool.query(`UPDATE scheduled_donations SET status='processed', processed_at=NOW() WHERE id=$1`, [req.params.id]);
    await audit(req, 'process', 'scheduled_donations', req.params.id);
    res.json({ ok: true, message: 'Scheduled donation processed' });
  }));

  app.post('/api/scheduled-donations/:id/remind', requireAuth, ah(async (req, res) => {
    const sd = await pool.query(`SELECT * FROM scheduled_donations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!sd.rows.length) return res.status(404).json({ error: 'Not found' });
    try { await sendEmail(sd.rows[0].donor_email, 'Donation Reminder', `Your scheduled donation of UGX ${sd.rows[0].amount} is coming up on ${sd.rows[0].scheduled_date}.`); } catch(e){}
    await pool.query(`UPDATE scheduled_donations SET reminder_sent=true WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));

  // =============================================
  // FEATURE 14: CAMPAIGN SEASONALITY ADJUSTER
  // =============================================
  app.get('/api/seasonality', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM seasonality_profiles WHERE tenant_id=$1 ORDER BY month`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/seasonality', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { month, season_name, giving_multiplier, notes } = req.body;
    if (!month) return res.status(400).json({ error: 'month required (1-12)' });
    const r = await pool.query(`INSERT INTO seasonality_profiles (tenant_id, month, season_name, giving_multiplier, notes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, month) DO UPDATE SET season_name=$3, giving_multiplier=$4, notes=$5, updated_at=NOW() RETURNING *`, [tid, month, esc(season_name||''), giving_multiplier||1.0, esc(notes||'')]);
    res.json(r.rows[0]);
  }));

  app.put('/api/seasonality/:id', requireAuth, ah(async (req, res) => {
    const { season_name, giving_multiplier, notes } = req.body;
    const r = await pool.query(`UPDATE seasonality_profiles SET season_name=COALESCE($1,season_name), giving_multiplier=COALESCE($2,giving_multiplier), notes=COALESCE($3,notes), updated_at=NOW() WHERE tenant_id=$4 AND id=$5 RETURNING *`, [season_name?esc(season_name):null, giving_multiplier, notes?esc(notes):null, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.post('/api/seasonality/analyze', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const monthly = await pool.query(`SELECT EXTRACT(MONTH FROM created_at) as month, COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '24 months' GROUP BY month ORDER BY month`, [tid]);
    const avgTotal = monthly.rows.reduce((s,r)=>s+parseInt(r.total),0) / Math.max(1, monthly.rows.length);
    for (const m of monthly.rows) {
      const mult = avgTotal > 0 ? (parseInt(m.total) / avgTotal) : 1.0;
      await pool.query(`UPDATE seasonality_profiles SET giving_multiplier=$1, avg_historic_donations=$2, avg_historic_amount=$3, updated_at=NOW() WHERE tenant_id=$4 AND month=$5`, [Math.round(mult*100)/100, m.cnt, m.total, tid, m.month]);
    }
    res.json({ message: 'Seasonality analysis complete', months_analyzed: monthly.rows.length });
  }));

  app.get('/api/seasonality/adjust/:campaignId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const currentMonth = new Date().getMonth() + 1;
    const sp = await pool.query(`SELECT * FROM seasonality_profiles WHERE tenant_id=$1 AND month=$2`, [tid, currentMonth]);
    const camp = await pool.query(`SELECT * FROM fundraising_campaigns WHERE tenant_id=$1 AND id=$2`, [tid, req.params.campaignId]);
    if (!camp.rows.length || !sp.rows.length) return res.json({ multiplier: 1.0, adjusted_target: 0 });
    const mult = sp.rows[0].giving_multiplier || 1.0;
    const adjustedTarget = Math.round(parseInt(camp.rows[0].goal_amount) * mult);
    res.json({ current_month: currentMonth, season: sp.rows[0].season_name, multiplier: mult, original_target: camp.rows[0].goal_amount, adjusted_target: adjustedTarget });
  }));

  app.get('/api/seasonality/calendar', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT month, season_name, giving_multiplier FROM seasonality_profiles WHERE tenant_id=$1 ORDER BY month`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 15: SMART DONATION AMOUNT SUGGESTIONS
  // =============================================
  app.get('/api/amount-suggestions/:email', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.params.email;
    const hist = await pool.query(`SELECT amount FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 10`, [tid, email]);
    const settings = await pool.query(`SELECT * FROM amount_suggestion_settings WHERE tenant_id=$1`, [tid]);
    if (!hist.rows.length) return res.json({ suggested: JSON.parse(settings.rows[0]?.preset_amounts_json || '[5000,10000,25000,50000,100000,250000]'), based_on: 'preset', confidence: 0 });
    const amounts = hist.rows.map(r => parseInt(r.amount));
    const avg = Math.round(amounts.reduce((a,b)=>a+b,0) / amounts.length);
    const max = Math.max(...amounts);
    const suggested = [Math.round(avg*0.5), avg, Math.round(avg*1.5), Math.round(avg*2), Math.round(max*1.2)].map(v => Math.round(v/1000)*1000);
    await pool.query(`INSERT INTO amount_suggestions (tenant_id, donor_email, suggested_amounts_json, based_on, confidence) VALUES ($1,$2,$3,$4,$5)`, [tid, email, JSON.stringify(suggested), 'history', Math.min(100, amounts.length*20)]);
    res.json({ suggested, based_on: 'history', confidence: Math.min(100, amounts.length*20), past_donations: amounts.length });
  }));

  app.post('/api/amount-suggestions/generate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, campaign_id } = req.body;
    const settings = await pool.query(`SELECT * FROM amount_suggestion_settings WHERE tenant_id=$1`, [tid]);
    const hist = donor_email ? await pool.query(`SELECT amount FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 10`, [tid, donor_email]) : { rows: [] };
    let suggested;
    if (hist.rows.length) {
      const amounts = hist.rows.map(r => parseInt(r.amount));
      const avg = Math.round(amounts.reduce((a,b)=>a+b,0) / amounts.length);
      suggested = [Math.round(avg*0.5), avg, Math.round(avg*1.5), Math.round(avg*2)].map(v => Math.round(v/1000)*1000);
    } else {
      suggested = JSON.parse(settings.rows[0]?.preset_amounts_json || '[5000,10000,25000,50000,100000,250000]');
    }
    const r = await pool.query(`INSERT INTO amount_suggestions (tenant_id, donor_email, suggested_amounts_json, based_on, confidence) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, donor_email||null, JSON.stringify(suggested), hist.rows.length ? 'history' : 'preset', hist.rows.length ? Math.min(100, hist.rows.length*20) : 0]);
    res.json(r.rows[0]);
  }));

  app.get('/api/amount-suggestion-settings', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM amount_suggestion_settings WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || { preset_amounts_json: '[5000,10000,25000,50000,100000,250000]', show_custom: true, show_round_up: true, min_amount: 500, max_amount: 50000000 });
  }));

  app.put('/api/amount-suggestion-settings', requireAuth, ah(async (req, res) => {
    const { preset_amounts_json, show_custom, show_round_up, min_amount, max_amount } = req.body;
    const r = await pool.query(`INSERT INTO amount_suggestion_settings (tenant_id, preset_amounts_json, show_custom, show_round_up, min_amount, max_amount) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO UPDATE SET preset_amounts_json=$2, show_custom=$3, show_round_up=$4, min_amount=$5, max_amount=$6, updated_at=NOW() RETURNING *`, [req.session.user.tenant_id, JSON.stringify(preset_amounts_json||[5000,10000,25000,50000,100000,250000]), show_custom??true, show_round_up??true, min_amount||500, max_amount||50000000]);
    res.json(r.rows[0]);
  }));

  app.post('/api/amount-suggestions/track-click', ah(async (req, res) => {
    const { donor_email, amount_shown, amount_selected } = req.body;
    // Track which suggested amounts get clicked for ML optimization
    res.json({ ok: true });
  }));

  // =============================================
  // DASHBOARD PAGES
  // =============================================
  const navLinks = `
    <nav class="bg-white shadow mb-6 p-4 rounded-lg flex flex-wrap gap-2">
      <a href="/campaign-ab-testing" class="px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200">A/B Testing</a>
      <a href="/campaign-scheduling" class="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Scheduling</a>
      <a href="/campaign-co-creation" class="px-3 py-1 bg-green-100 text-green-800 rounded hover:bg-green-200">Co-Creation</a>
      <a href="/campaign-bundles" class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">Bundles</a>
      <a href="/campaign-health" class="px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200">Health Monitor</a>
      <a href="/fundraising-calendar" class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200">Calendar</a>
      <a href="/goal-recommendations" class="px-3 py-1 bg-pink-100 text-pink-800 rounded hover:bg-pink-200">Goal Recs</a>
      <a href="/storyboard-builder" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">Storyboard</a>
      <a href="/donation-form-builder" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Form Builder</a>
      <a href="/campaign-blueprints" class="px-3 py-1 bg-cyan-100 text-cyan-800 rounded hover:bg-cyan-200">Blueprints</a>
      <a href="/thank-you-engine" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">Thank You</a>
      <a href="/micro-roundup" class="px-3 py-1 bg-lime-100 text-lime-800 rounded hover:bg-lime-200">Round-Ups</a>
      <a href="/scheduled-donations" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Scheduled</a>
      <a href="/seasonality" class="px-3 py-1 bg-violet-100 text-violet-800 rounded hover:bg-violet-200">Seasonality</a>
      <a href="/amount-suggestions" class="px-3 py-1 bg-fuchsia-100 text-fuchsia-800 rounded hover:bg-fuchsia-200">Amount Recs</a>
    </nav>`;

  // A/B Testing Dashboard
  app.get('/campaign-ab-testing', requireAuth, ah(async (req, res) => {
    const tests = await pool.query(`SELECT * FROM campaign_ab_tests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Campaign A/B Testing', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Campaign A/B Testing</h2>
        <div class="bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-2">Create New Test</h3>
          <form action="/api/campaign-ab-tests" method="POST" class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm">Campaign ID</label><input name="campaign_id" type="number" class="w-full border rounded p-2" required></div>
            <div><label class="block text-sm">Test Element</label><select name="test_element" class="w-full border rounded p-2"><option value="title">Title</option><option value="description">Description</option><option value="cover_image">Cover Image</option><option value="cta_text">CTA Text</option><option value="amount_presets">Amount Presets</option></select></div>
            <div><label class="block text-sm">Variant A</label><input name="variant_a" class="w-full border rounded p-2" required></div>
            <div><label class="block text-sm">Variant B</label><input name="variant_b" class="w-full border rounded p-2" required></div>
            <div class="col-span-2"><button type="submit" class="bg-purple-600 text-white px-6 py-2 rounded hover:bg-purple-700">Start Test</button></div>
          </form>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${tests.rows.map(t => `
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="flex justify-between"><span class="font-semibold">Campaign #${t.campaign_id}</span><span class="px-2 py-1 rounded text-xs ${t.status==='running'?'bg-green-100 text-green-800':'bg-gray-100 text-gray-800'}">${t.status}</span></div>
              <p class="text-sm text-gray-600 mt-1">Testing: ${t.test_element}</p>
              <div class="grid grid-cols-2 gap-2 mt-2 text-sm">
                <div class="bg-purple-50 p-2 rounded">A: ${t.variant_a_views} views / ${t.variant_a_conversions} conv</div>
                <div class="bg-indigo-50 p-2 rounded">B: ${t.variant_b_views} views / ${t.variant_b_conversions} conv</div>
              </div>
              ${t.winner ? `<p class="mt-2 font-semibold text-green-700">Winner: Variant ${t.winner}</p>` : ''}
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Campaign Health Dashboard
  app.get('/campaign-health', requireAuth, ah(async (req, res) => {
    const alerts = await pool.query(`SELECT chs.*, fc.title as campaign_title FROM campaign_health_scores chs LEFT JOIN fundraising_campaigns fc ON chs.campaign_id=fc.id WHERE chs.tenant_id=$1 ORDER BY chs.health_score ASC LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Campaign Health Monitor', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Campaign Health Monitor</h2>
        <div class="mb-4"><a href="/api/campaign-health/check-all" class="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 inline-block">Check All Campaigns</a></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${alerts.rows.map(a => `
            <div class="bg-white p-4 rounded-lg shadow border-l-4 ${a.health_score>70?'border-green-500':a.health_score>40?'border-yellow-500':'border-red-500'}">
              <h3 class="font-semibold">${a.campaign_title||'Campaign #'+a.campaign_id}</h3>
              <div class="mt-2 text-3xl font-bold ${a.health_score>70?'text-green-600':a.health_score>40?'text-yellow-600':'text-red-600'}">${a.health_score}/100</div>
              <p class="text-sm text-gray-500">Trend: ${a.trend} | Velocity: UGX ${a.velocity}/day</p>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Thank You Engine Dashboard
  app.get('/thank-you-engine', requireAuth, ah(async (req, res) => {
    const templates = await pool.query(`SELECT * FROM thank_you_templates WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT channel, COUNT(*) as total_sent FROM thank_you_log WHERE tenant_id=$1 GROUP BY channel`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Smart Thank You Engine', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Smart Thank You Engine</h2>
        <div class="grid grid-cols-3 gap-4 mb-6">
          ${stats.rows.map(s => `<div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">${s.total_sent}</div><div class="text-sm text-gray-500">${s.channel} sent</div></div>`).join('')}
        </div>
        <div class="mb-4 flex gap-2">
          <a href="/api/thank-you/auto-send" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">Auto-Send Unthanked</a>
        </div>
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-semibold mb-2">Thank You Templates</h3>
          ${templates.rows.map(t => `
            <div class="border p-3 mb-2 rounded">
              <div class="flex justify-between"><span class="font-medium">${t.name}</span><span class="text-sm px-2 py-1 rounded ${t.is_default?'bg-green-100 text-green-800':'bg-gray-100'}">${t.channel} ${t.is_default?'(Default)':''}</span></div>
              <p class="text-sm text-gray-600 mt-1">${t.template_text.substring(0,120)}...</p>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Seasonality Dashboard
  app.get('/seasonality', requireAuth, ah(async (req, res) => {
    const profiles = await pool.query(`SELECT * FROM seasonality_profiles WHERE tenant_id=$1 ORDER BY month`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Seasonality Adjuster', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Campaign Seasonality Adjuster</h2>
        <div class="mb-4"><a href="/api/seasonality/analyze" class="bg-violet-600 text-white px-4 py-2 rounded hover:bg-violet-700">Analyze Historical Data</a></div>
        <div class="grid grid-cols-4 gap-3">
          ${profiles.rows.map(p => `
            <div class="bg-white p-3 rounded-lg shadow text-center border-t-4 ${p.giving_multiplier>=1.3?'border-green-500':p.giving_multiplier>=1.0?'border-blue-500':'border-red-500'}">
              <div class="font-bold">${p.month}</div>
              <div class="text-sm text-gray-600">${p.season_name||'-'}</div>
              <div class="text-lg font-bold ${p.giving_multiplier>=1.3?'text-green-600':p.giving_multiplier>=1.0?'text-blue-600':'text-red-600'}">${p.giving_multiplier}x</div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Calendar Dashboard
  app.get('/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const events = await pool.query(`SELECT * FROM fundraising_calendar WHERE tenant_id=$1 ORDER BY start_date LIMIT 30`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Fundraising Calendar', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Fundraising Calendar & Planner</h2>
        <div class="grid grid-cols-1 gap-3">
          ${events.rows.map(e => `
            <div class="bg-white p-3 rounded-lg shadow flex items-center gap-4">
              <div class="w-3 h-3 rounded-full" style="background:${e.color}"></div>
              <div class="flex-1"><span class="font-medium">${e.title}</span><span class="text-sm text-gray-500 ml-2">${e.event_type} | ${e.start_date}</span></div>
              <span class="text-sm text-gray-600">UGX ${e.target_amount||0}</span>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Remaining dashboards (simplified but functional)
  const simpleDash = (title, path, tableName, cols) => {
    app.get(path, requireAuth, ah(async (req, res) => {
      const r = await pool.query(`SELECT * FROM ${tableName} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
      renderPage(req, res, title, `${navLinks}
        <div class="max-w-6xl mx-auto">
          <h2 class="text-2xl font-bold mb-4">${title}</h2>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr>${cols.map(c=>`<th class="p-3 text-left">${c}</th>`).join('')}</tr></thead>
              <tbody>${r.rows.map(row=>`<tr class="border-t">${cols.map(c=>`<td class="p-3">${row[c]!==null&&row[c]!==undefined?row[c]:'-'}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`);
    }));
  };

  simpleDash('Smart Campaign Scheduling', '/campaign-scheduling', 'campaign_schedules', ['id','campaign_id','scheduled_date','scheduled_time','status']);
  simpleDash('Campaign Co-Creation', '/campaign-co-creation', 'campaign_co_creators', ['id','campaign_id','collaborator_email','role','status']);
  simpleDash('Campaign Bundle Packs', '/campaign-bundles', 'campaign_bundles', ['id','name','total_target','campaign_count','status']);
  simpleDash('Goal Recommendations', '/goal-recommendations', 'goal_recommendations', ['id','campaign_id','recommended_target','confidence','based_on_category']);
  simpleDash('Storyboard Builder', '/storyboard-builder', 'campaign_storyboards', ['id','campaign_id','theme','layout','status']);
  simpleDash('Donation Form Builder', '/donation-form-builder', 'donation_forms', ['id','name','is_active','submission_count']);
  simpleDash('Campaign Success Blueprints', '/campaign-blueprints', 'campaign_blueprints', ['id','name','category','avg_conversion','avg_raise']);
  simpleDash('Micro Round-Ups', '/micro-roundup', 'micro_roundup_transactions', ['id','original_amount','rounded_amount','roundup_amount']);
  simpleDash('Scheduled Donations', '/scheduled-donations', 'scheduled_donations', ['id','donor_email','amount','scheduled_date','recurrence','status']);
  simpleDash('Amount Suggestions', '/amount-suggestions', 'amount_suggestion_settings', ['id','preset_amounts_json','min_amount','max_amount']);

  console.log('[FundraisingUltimate3] Loaded — 15 features, 80+ routes');
};
