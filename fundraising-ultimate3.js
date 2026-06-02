/**
 * Fundraising Ultimate 3 — Campaign Optimization Module
 * 15 Features: Smart Campaign Scheduling, Campaign Co-Creation, Campaign Bundle Packs,
 * Campaign Health Monitor, Fundraising Calendar, Smart Goal Recommender,
 * Campaign Storyboard Builder, Donation Form Builder, Campaign Success Blueprint,
 * Smart Thank You Engine, Micro-Donation Round-Ups, Donation Day Scheduler,
 * Campaign Seasonality Adjuster, Smart Amount Suggestions, Campaign A/B Testing Engine
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // 1a. Smart Campaign Scheduling
    `CREATE TABLE IF NOT EXISTS campaign_schedules (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      scheduled_date DATE,
      optimal_time TEXT,
      timezone TEXT DEFAULT 'Africa/Kampala',
      status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 1b. Scheduling Insights)
    `CREATE TABLE IF NOT EXISTS scheduling_insights (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
      avg_donations INTEGER DEFAULT 0,
      conversion_rate NUMERIC(5,2) DEFAULT 0,
      UNIQUE(tenant_id, day_of_week, hour)
    )`,

    // 2a. Campaign Co-Creators)
    `CREATE TABLE IF NOT EXISTS campaign_co_creators (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      collaborator_email TEXT NOT NULL,
      role TEXT DEFAULT 'editor' CHECK (role IN ('viewer','editor','admin')),
      invited_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ
    )`,

    // 2b. Campaign Edit History)
    `CREATE TABLE IF NOT EXISTS campaign_edit_history (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      editor_email TEXT NOT NULL,
      field_changed TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      edited_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3a. Campaign Bundle Packs)
    `CREATE TABLE IF NOT EXISTS campaign_bundles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      total_goal INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3b. Campaign Bundle Items)
    `CREATE TABLE IF NOT EXISTS campaign_bundle_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      bundle_id INTEGER REFERENCES campaign_bundles(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      allocation_percentage NUMERIC(5,2) DEFAULT 100
    )`,

    // 4. Campaign Health Monitor)
    `CREATE TABLE IF NOT EXISTS campaign_health_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      health_score INTEGER DEFAULT 0 CHECK (health_score BETWEEN 0 AND 100),
      momentum_score INTEGER DEFAULT 0 CHECK (momentum_score BETWEEN 0 AND 100),
      engagement_score INTEGER DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
      recommendation TEXT,
      checked_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 5. Fundraising Calendar)
    `CREATE TABLE IF NOT EXISTS fundraising_calendar (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_type TEXT DEFAULT 'event' CHECK (event_type IN ('event','deadline','milestone','campaign_launch','meeting','other')),
      start_date DATE NOT NULL,
      end_date DATE,
      goal_amount INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 6. Smart Goal Recommender)
    `CREATE TABLE IF NOT EXISTS goal_recommendations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      recommended_goal INTEGER DEFAULT 0,
      confidence NUMERIC(5,2) DEFAULT 0,
      based_on TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7a. Campaign Storyboard Builder)
    `CREATE TABLE IF NOT EXISTS campaign_storyboards (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_published BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7b. Storyboard Sections)
    `CREATE TABLE IF NOT EXISTS storyboard_sections (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      storyboard_id INTEGER REFERENCES campaign_storyboards(id) ON DELETE CASCADE,
      section_type TEXT DEFAULT 'text' CHECK (section_type IN ('text','image','video','quote','stats','cta','divider')),
      title TEXT,
      content TEXT,
      sort_order INTEGER DEFAULT 0,
      image_url TEXT
    )`,

    // 8a. Donation Form Builder)
    `CREATE TABLE IF NOT EXISTS donation_forms (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      title TEXT NOT NULL,
      fields_json JSONB DEFAULT '[]',
      styling_json JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      submissions_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 8b. Donation Form Submissions)
    `CREATE TABLE IF NOT EXISTS donation_form_submissions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      form_id INTEGER REFERENCES donation_forms(id) ON DELETE CASCADE,
      donor_email TEXT,
      responses_json JSONB DEFAULT '{}',
      amount INTEGER DEFAULT 0,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 9. Campaign Success Blueprint)
    `CREATE TABLE IF NOT EXISTS campaign_blueprints (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      milestones_json JSONB DEFAULT '[]',
      timeline_json JSONB DEFAULT '[]',
      checklist_json JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 10a. Smart Thank You Templates)
    `CREATE TABLE IF NOT EXISTS thank_you_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT,
      body_template TEXT NOT NULL,
      channel TEXT DEFAULT 'email' CHECK (channel IN ('email','sms','both')),
      is_default BOOLEAN DEFAULT false
    )`,

    // 10b. Thank You Log)
    `CREATE TABLE IF NOT EXISTS thank_you_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      template_id INTEGER,
      donor_email TEXT NOT NULL,
      campaign_id INTEGER,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      opened BOOLEAN DEFAULT false
    )`,

    // 11a. Micro-Donation Round-Up Settings)
    `CREATE TABLE IF NOT EXISTS micro_roundup_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      enabled BOOLEAN DEFAULT false,
      default_roundup INTEGER DEFAULT 100,
      max_monthly INTEGER DEFAULT 10000
    )`,

    // 11b. Micro-Donation Round-Up Transactions)
    `CREATE TABLE IF NOT EXISTS micro_roundup_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      original_amount INTEGER DEFAULT 0,
      rounded_amount INTEGER DEFAULT 0,
      roundup_amount INTEGER DEFAULT 0,
      campaign_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 12. Donation Day Scheduler)
    `CREATE TABLE IF NOT EXISTS scheduled_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      campaign_id INTEGER,
      amount INTEGER DEFAULT 0,
      scheduled_date DATE NOT NULL,
      frequency TEXT DEFAULT 'once' CHECK (frequency IN ('once','weekly','biweekly','monthly','quarterly','yearly')),
      next_date DATE,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 13. Campaign Seasonality Adjuster)
    `CREATE TABLE IF NOT EXISTS seasonality_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      seasonality_factor NUMERIC(5,2) DEFAULT 1.00,
      avg_donation_trend TEXT,
      recommendation TEXT,
      year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
      UNIQUE(tenant_id, month, year)
    )`,

    // 14a. Smart Amount Suggestions)
    `CREATE TABLE IF NOT EXISTS amount_suggestions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      suggested_amounts_json JSONB DEFAULT '[]',
      based_on TEXT
    )`,

    // 14b. Amount Suggestion Settings)
    `CREATE TABLE IF NOT EXISTS amount_suggestion_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      strategy TEXT DEFAULT 'data_driven' CHECK (strategy IN ('data_driven','presets','custom','tiered')),
      presets_json JSONB DEFAULT '[]',
      custom_amounts_json JSONB DEFAULT '[]'
    )`,

    // 15. A/B Engine Enhanced Tracking (adds to existing campaign_ab_tests)
    `CREATE TABLE IF NOT EXISTS ab_engine_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      test_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('impression','click','donation','share','bounce')),
      donor_email TEXT,
      metadata_json JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Indexes)
    `CREATE INDEX IF NOT EXISTS idx_campaign_schedules_tenant ON campaign_schedules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduling_insights_tenant ON scheduling_insights(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_co_creators_tenant ON campaign_co_creators(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_edit_history_tenant ON campaign_edit_history(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_bundles_tenant ON campaign_bundles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_bundle_items_tenant ON campaign_bundle_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_health_scores_tenant ON campaign_health_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fundraising_calendar_tenant ON fundraising_calendar(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_goal_recommendations_tenant ON goal_recommendations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_storyboards_tenant ON campaign_storyboards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_storyboard_sections_tenant ON storyboard_sections(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_forms_tenant ON donation_forms(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_form_submissions_tenant ON donation_form_submissions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_blueprints_tenant ON campaign_blueprints(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_you_templates_tenant ON thank_you_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thank_you_log_tenant ON thank_you_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_micro_roundup_settings_tenant ON micro_roundup_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_micro_roundup_transactions_tenant ON micro_roundup_transactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scheduled_donations_tenant ON scheduled_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_seasonality_profiles_tenant ON seasonality_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amount_suggestions_tenant ON amount_suggestions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_amount_suggestion_settings_tenant ON amount_suggestion_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ab_engine_events_tenant ON ab_engine_events(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ab_engine_events_test ON ab_engine_events(test_id)`,
  ];

  // Run migrations and seed data
  (async () => {
    for (const q of migrations) {
      try { await migrateQuery(pool, 'FundraisingUltimate3', q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate3] Migrations complete');

    // Seed per tenant
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;

      // Feature 10: Seed 3 thank-you templates per tenant
      for (const t of tenants) {
        const existingTemplates = (await pool.query('SELECT id FROM thank_you_templates WHERE tenant_id=$1', [t.id])).rows;
        if (existingTemplates.length === 0) {
          await pool.query(
            `INSERT INTO thank_you_templates (tenant_id, name, subject, body_template, channel, is_default) VALUES
            ($1, 'Standard Thank You', 'Thank you for your donation!', 'Dear {donor_name}, thank you for your generous donation of {amount} to {campaign_title}. Your support means the world to us!', 'email', true),
            ($1, 'SMS Thank You', NULL, 'Thank you {donor_name} for donating {amount} to {campaign_title}! Your generosity makes a difference.', 'sms', false),
            ($1, 'Impact Thank You', 'Your donation made an impact!', 'Dear {donor_name}, your donation of {amount} to {campaign_title} has already started making an impact. Together we are changing lives. Stay tuned for updates on how your contribution is being used!', 'email', false)`,
            [t.id]
          );
        }
      }

      // Feature 13: Seed 12 months of seasonality profiles per tenant
      for (const t of tenants) {
        const existingProfiles = (await pool.query('SELECT id FROM seasonality_profiles WHERE tenant_id=$1', [t.id])).rows;
        if (existingProfiles.length === 0) {
          const currentYear = new Date().getFullYear();
          const monthData = [
            { month: 1, factor: 0.85, trend: 'declining', rec: 'Focus on recurring donors and year-start appeals' },
            { month: 2, factor: 0.80, trend: 'low', rec: 'Plan spring campaigns; engage lapsed donors' },
            { month: 3, factor: 0.90, trend: 'rising', rec: 'Launch spring fundraising events' },
            { month: 4, factor: 0.95, trend: 'moderate', rec: 'Capitalize on spring momentum' },
            { month: 5, factor: 1.00, trend: 'stable', rec: 'Maintain engagement with mid-year appeals' },
            { month: 6, factor: 1.05, trend: 'rising', rec: 'Mid-year campaigns perform well' },
            { month: 7, factor: 0.90, trend: 'declining', rec: 'Summer lull — focus on online campaigns' },
            { month: 8, factor: 0.85, trend: 'low', rec: 'Prepare for end-of-year campaigns' },
            { month: 9, factor: 1.10, trend: 'rising', rec: 'Back-to-school and fall campaigns' },
            { month: 10, factor: 1.15, trend: 'strong', rec: 'Peak season approaching — increase outreach' },
            { month: 11, factor: 1.40, trend: 'peak', rec: 'Giving season — maximize all channels' },
            { month: 12, factor: 1.50, trend: 'peak', rec: 'Year-end giving — highest donation month' },
          ];
          for (const md of monthData) {
            await pool.query(
              `INSERT INTO seasonality_profiles (tenant_id, month, seasonality_factor, avg_donation_trend, recommendation, year) VALUES ($1,$2,$3,$4,$5,$6)`,
              [t.id, md.month, md.factor, md.trend, md.rec, currentYear]
            );
          }
        }
      }

      // Feature 14: Seed amount suggestion settings per tenant
      for (const t of tenants) {
        const existingSettings = (await pool.query('SELECT id FROM amount_suggestion_settings WHERE tenant_id=$1', [t.id])).rows;
        if (existingSettings.length === 0) {
          await pool.query(
            `INSERT INTO amount_suggestion_settings (tenant_id, strategy, presets_json, custom_amounts_json) VALUES ($1, 'data_driven', $2, $3)`,
            [t.id,
              JSON.stringify([5000, 10000, 25000, 50000, 100000]),
              JSON.stringify([])
            ]
          );
        }
      }

      // Feature 11: Seed micro-roundup settings per tenant
      for (const t of tenants) {
        const existingSettings = (await pool.query('SELECT id FROM micro_roundup_settings WHERE tenant_id=$1', [t.id])).rows;
        if (existingSettings.length === 0) {
          await pool.query(
            `INSERT INTO micro_roundup_settings (tenant_id, enabled, default_roundup, max_monthly) VALUES ($1, false, 100, 10000)`,
            [t.id]
          );
        }
      }

      // Feature 1: Seed scheduling insights per tenant (best-effort from donation data)
      for (const t of tenants) {
        const existingInsights = (await pool.query('SELECT id FROM scheduling_insights WHERE tenant_id=$1', [t.id])).rows;
        if (existingInsights.length === 0) {
          // Seed with sensible defaults
          const defaultInsights = [
            { day: 1, hour: 9, avg: 5000, rate: 3.2 },
            { day: 1, hour: 12, avg: 8000, rate: 4.5 },
            { day: 2, hour: 10, avg: 6000, rate: 3.8 },
            { day: 3, hour: 11, avg: 7500, rate: 4.1 },
            { day: 4, hour: 9, avg: 5500, rate: 3.5 },
            { day: 5, hour: 14, avg: 9000, rate: 5.0 },
            { day: 6, hour: 10, avg: 12000, rate: 6.2 },
            { day: 0, hour: 11, avg: 15000, rate: 7.0 },
          ];
          for (const di of defaultInsights) {
            await pool.query(
              `INSERT INTO scheduling_insights (tenant_id, day_of_week, hour, avg_donations, conversion_rate) VALUES ($1,$2,$3,$4,$5)`,
              [t.id, di.day, di.hour, di.avg, di.rate]
            );
          }
        }
      }

      console.log('[FundraisingUltimate3] Seed data complete');
    } catch(e) { console.warn('[FundraisingUltimate3] Seed error:', e.message); }
  })();

  // =============================================
  // 1. SMART CAMPAIGN SCHEDULING
  // =============================================

  // GET /api/campaign-schedules — list campaign schedules
  app.get('/api/campaign-schedules', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { status, campaign_id } = req.query;
    let q = 'SELECT * FROM campaign_schedules WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (campaign_id) { q += ' AND campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    q += ' ORDER BY scheduled_date ASC';
    const result = await pool.query(q, params);
    res.json({ schedules: result.rows });
  }));

  // POST /api/campaign-schedules — create a schedule
  app.post('/api/campaign-schedules', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, scheduled_date, optimal_time, timezone, status } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    const result = await pool.query(
      'INSERT INTO campaign_schedules (tenant_id, campaign_id, scheduled_date, optimal_time, timezone, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, parseInt(campaign_id), scheduled_date || null, optimal_time ? esc(optimal_time) : null, timezone ? esc(timezone) : 'Africa/Kampala', status || 'scheduled']
    );
    await audit(req.session.user.email, 'campaign_schedule_created', 'Scheduled campaign #' + campaign_id);
    res.json({ schedule: result.rows[0] });
  }));

  // GET /api/scheduling-insights — get scheduling insights
  app.get('/api/scheduling-insights', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT * FROM scheduling_insights WHERE tenant_id=$1 ORDER BY day_of_week, hour',
      [t]
    );
    // Find best time slot
    let bestSlot = null;
    if (result.rows.length > 0) {
      bestSlot = result.rows.reduce((best, r) => parseFloat(r.conversion_rate) > parseFloat(best.conversion_rate) ? r : best, result.rows[0]);
    }
    res.json({ insights: result.rows, best_time_slot: bestSlot });
  }));

  // POST /api/scheduling-insights/calculate — recalculate insights from donation data
  app.post('/api/scheduling-insights/calculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    try {
      const stats = (await pool.query(`
        SELECT EXTRACT(DOW FROM cd.donated_at)::INT AS day_of_week,
               EXTRACT(HOUR FROM cd.donated_at)::INT AS hour,
               COALESCE(AVG(cd.amount),0)::INT AS avg_donations,
               (COUNT(DISTINCT cd.donor_email)::NUMERIC / NULLIF(COUNT(*)::NUMERIC, 0) * 100)::NUMERIC(5,2) AS conversion_rate
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donated_at >= NOW() - INTERVAL '6 months'
        GROUP BY day_of_week, hour
      `, [t])).rows;

      let upserted = 0;
      for (const s of stats) {
        await pool.query(
          `INSERT INTO scheduling_insights (tenant_id, day_of_week, hour, avg_donations, conversion_rate) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, day_of_week, hour) DO UPDATE SET avg_donations=$4, conversion_rate=$5`,
          [t, s.day_of_week, s.hour, parseInt(s.avg_donations) || 0, parseFloat(s.conversion_rate) || 0]
        );
        upserted++;
      }
      await audit(req.session.user.email, 'scheduling_insights_calculated', 'Calculated insights for ' + upserted + ' time slots');
      res.json({ message: 'Calculated ' + upserted + ' time slots', count: upserted });
    } catch(e) {
      res.json({ message: 'Calculation attempted', count: 0, note: 'Ensure donation data exists' });
    }
  }));

  // =============================================
  // 2. CAMPAIGN CO-CREATION
  // =============================================

  // POST /api/campaigns/:id/co-creators — invite a co-creator
  app.post('/api/campaigns/:id/co-creators', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { collaborator_email, role } = req.body;
    if (!collaborator_email) return res.status(400).json({ error: 'collaborator_email is required' });
    const validRoles = ['viewer', 'editor', 'admin'];
    if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role. Use: viewer, editor, admin' });
    const result = await pool.query(
      'INSERT INTO campaign_co_creators (tenant_id, campaign_id, collaborator_email, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, campaignId, esc(collaborator_email), role || 'editor']
    );
    // Notify the collaborator
    if (notify) {
      notify(t, collaborator_email, 'Co-Creator Invitation', 'You have been invited as a co-creator for campaign #' + campaignId, 'fundraising');
    }
    await audit(req.session.user.email, 'co_creator_invited', 'Invited ' + collaborator_email + ' as co-creator for campaign #' + campaignId);
    res.json({ co_creator: result.rows[0] });
  }));

  // GET /api/campaigns/:id/co-creators — list co-creators
  app.get('/api/campaigns/:id/co-creators', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM campaign_co_creators WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY invited_at DESC',
      [campaignId, t]
    );
    res.json({ co_creators: result.rows });
  }));

  // DELETE /api/campaigns/:id/co-creators — remove a co-creator
  app.delete('/api/campaigns/:id/co-creators', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { co_creator_id } = req.body;
    if (!co_creator_id) return res.status(400).json({ error: 'co_creator_id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_co_creators WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3', [co_creator_id, campaignId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Co-creator not found' });
    await pool.query('DELETE FROM campaign_co_creators WHERE id=$1 AND tenant_id=$2', [co_creator_id, t]);
    await audit(req.session.user.email, 'co_creator_removed', 'Removed co-creator ' + existing.collaborator_email + ' from campaign #' + campaignId);
    res.json({ success: true });
  }));

  // POST /api/campaigns/:id/co-creators/:cc_id/accept — accept invitation
  app.post('/api/campaigns/:id/co-creators/:cc_id/accept', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const ccId = parseInt(req.params.cc_id);
    const existing = (await pool.query('SELECT * FROM campaign_co_creators WHERE id=$1 AND campaign_id=$2 AND tenant_id=$3', [ccId, campaignId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Co-creator invitation not found' });
    const result = await pool.query(
      'UPDATE campaign_co_creators SET accepted_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *',
      [ccId, t]
    );
    await audit(req.session.user.email, 'co_creator_accepted', 'Accepted co-creator invitation for campaign #' + campaignId);
    res.json({ co_creator: result.rows[0] });
  }));

  // GET /api/campaigns/:id/edit-history — list edit history
  app.get('/api/campaigns/:id/edit-history', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM campaign_edit_history WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY edited_at DESC LIMIT 100',
      [campaignId, t]
    );
    res.json({ history: result.rows });
  }));

  // POST /api/campaigns/:id/edit-history — record an edit
  app.post('/api/campaigns/:id/edit-history', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { field_changed, old_value, new_value } = req.body;
    if (!field_changed) return res.status(400).json({ error: 'field_changed is required' });
    const result = await pool.query(
      'INSERT INTO campaign_edit_history (tenant_id, campaign_id, editor_email, field_changed, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, campaignId, esc(req.session.user.email), esc(field_changed), old_value ? esc(old_value) : null, new_value ? esc(new_value) : null]
    );
    await audit(req.session.user.email, 'campaign_edited', 'Edited field "' + field_changed + '" on campaign #' + campaignId);
    res.json({ edit: result.rows[0] });
  }));

  // =============================================
  // 3. CAMPAIGN BUNDLE PACKS
  // =============================================

  // GET /api/campaign-bundles — list bundles
  app.get('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { is_active } = req.query;
    let q = 'SELECT b.*, (SELECT COUNT(*) FROM campaign_bundle_items WHERE bundle_id=b.id AND tenant_id=$1) AS item_count FROM campaign_bundles b WHERE b.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (is_active !== undefined) { q += ' AND b.is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY b.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ bundles: result.rows });
  }));

  // POST /api/campaign-bundles — create bundle
  app.post('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, total_goal, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO campaign_bundles (tenant_id, name, description, total_goal, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), description ? esc(description) : null, total_goal || 0, is_active !== false]
    );
    await audit(req.session.user.email, 'campaign_bundle_created', 'Created bundle "' + name + '"');
    res.json({ bundle: result.rows[0] });
  }));

  // PUT /api/campaign-bundles — update bundle
  app.put('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, description, total_goal, is_active } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_bundles WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Bundle not found' });
    const result = await pool.query(
      'UPDATE campaign_bundles SET name=$1, description=$2, total_goal=$3, is_active=$4 WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : existing.name, description !== undefined ? esc(description) : existing.description,
       total_goal !== undefined ? total_goal : existing.total_goal, is_active !== undefined ? is_active : existing.is_active, id, t]
    );
    await audit(req.session.user.email, 'campaign_bundle_updated', 'Updated bundle #' + id);
    res.json({ bundle: result.rows[0] });
  }));

  // DELETE /api/campaign-bundles — delete bundle
  app.delete('/api/campaign-bundles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_bundles WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Bundle not found' });
    await pool.query('DELETE FROM campaign_bundle_items WHERE bundle_id=$1 AND tenant_id=$2', [id, t]);
    await pool.query('DELETE FROM campaign_bundles WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'campaign_bundle_deleted', 'Deleted bundle #' + id);
    res.json({ success: true });
  }));

  // POST /api/campaign-bundles/:id/add-campaign — add campaign to bundle
  app.post('/api/campaign-bundles/:id/add-campaign', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const bundleId = parseInt(req.params.id);
    const { campaign_id, allocation_percentage } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    const bundle = (await pool.query('SELECT * FROM campaign_bundles WHERE id=$1 AND tenant_id=$2', [bundleId, t])).rows[0];
    if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
    const result = await pool.query(
      'INSERT INTO campaign_bundle_items (tenant_id, bundle_id, campaign_id, allocation_percentage) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, bundleId, parseInt(campaign_id), allocation_percentage || 100]
    );
    await audit(req.session.user.email, 'bundle_campaign_added', 'Added campaign #' + campaign_id + ' to bundle #' + bundleId);
    res.json({ item: result.rows[0] });
  }));

  // DELETE /api/campaign-bundles/:id/remove-campaign — remove campaign from bundle
  app.delete('/api/campaign-bundles/:id/remove-campaign', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const bundleId = parseInt(req.params.id);
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    await pool.query('DELETE FROM campaign_bundle_items WHERE bundle_id=$1 AND campaign_id=$2 AND tenant_id=$3', [bundleId, parseInt(campaign_id), t]);
    await audit(req.session.user.email, 'bundle_campaign_removed', 'Removed campaign #' + campaign_id + ' from bundle #' + bundleId);
    res.json({ success: true });
  }));

  // GET /api/campaign-bundles/:id/items — get bundle items
  app.get('/api/campaign-bundles/:id/items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const bundleId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT bi.*, fc.title AS campaign_title FROM campaign_bundle_items bi LEFT JOIN fundraising_campaigns fc ON bi.campaign_id=fc.id WHERE bi.bundle_id=$1 AND bi.tenant_id=$2',
      [bundleId, t]
    );
    res.json({ items: result.rows });
  }));

  // =============================================
  // 4. CAMPAIGN HEALTH MONITOR
  // =============================================

  // GET /api/campaign-health — list health scores
  app.get('/api/campaign-health', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.query;
    let q = 'SELECT chs.*, fc.title AS campaign_title FROM campaign_health_scores chs LEFT JOIN fundraising_campaigns fc ON chs.campaign_id=fc.id WHERE chs.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (campaign_id) { q += ' AND chs.campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    q += ' ORDER BY chs.checked_at DESC';
    const result = await pool.query(q, params);
    res.json({ health_scores: result.rows });
  }));

  // POST /api/campaigns/:id/health-check — run health check for a campaign
  app.post('/api/campaigns/:id/health-check', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);

    // Get campaign data
    const campaign = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Calculate health metrics
    let healthScore = 50;
    let momentumScore = 50;
    let engagementScore = 50;
    let recommendation = '';

    try {
      // Donation stats
      const donationStats = (await pool.query(`
        SELECT COALESCE(COUNT(*),0) AS total_donations,
               COALESCE(SUM(amount),0) AS total_raised,
               COALESCE(AVG(amount),0) AS avg_donation,
               COUNT(CASE WHEN donated_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS last_week_donations,
               COUNT(CASE WHEN donated_at >= NOW() - INTERVAL '30 days' THEN 1 END) AS last_month_donations
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.id = $1 AND fc.tenant_id = $2 AND cd.refunded = false
      `, [campaignId, t])).rows[0];

      const totalRaised = parseInt(donationStats.total_raised) || 0;
      const target = parseInt(campaign.target) || 1;
      const progressPct = Math.min(100, Math.round((totalRaised / target) * 100));
      const totalDonations = parseInt(donationStats.total_donations) || 0;
      const lastWeekDonations = parseInt(donationStats.last_week_donations) || 0;
      const lastMonthDonations = parseInt(donationStats.last_month_donations) || 0;

      // Health score: based on progress toward goal
      healthScore = Math.min(100, Math.round(progressPct * 0.6 + (totalDonations > 0 ? Math.min(40, totalDonations * 2) : 0)));

      // Momentum score: recent donation velocity
      if (lastWeekDonations > 0) {
        momentumScore = Math.min(100, Math.round(50 + (lastWeekDonations * 10)));
      } else if (lastMonthDonations > 0) {
        momentumScore = Math.round(30 + (lastMonthDonations * 3));
      } else {
        momentumScore = 10;
      }

      // Engagement score: donor interaction level
      const avgDonation = parseInt(donationStats.avg_donation) || 0;
      engagementScore = Math.min(100, Math.round(
        (totalDonations > 0 ? 30 : 0) +
        (lastMonthDonations > 0 ? 30 : 0) +
        (avgDonation > 5000 ? 20 : avgDonation > 1000 ? 10 : 0) +
        (lastWeekDonations > 0 ? 20 : 0)
      ));

      // Generate recommendation
      if (healthScore < 30) recommendation = 'Campaign is underperforming. Consider refreshing the story, increasing outreach, or adjusting the goal.';
      else if (healthScore < 60) recommendation = 'Campaign needs a boost. Try social media promotion and email outreach to existing donors.';
      else if (momentumScore < 30) recommendation = 'Campaign has slowed down. Create urgency with deadline reminders and matching challenges.';
      else if (engagementScore < 40) recommendation = 'Engagement is low. Consider personal outreach to major donors and update the campaign story.';
      else recommendation = 'Campaign is performing well. Maintain current strategy and consider increasing the goal.';
    } catch(e) {
      recommendation = 'Insufficient data for full analysis. Continue collecting donations for better insights.';
    }

    const result = await pool.query(
      `INSERT INTO campaign_health_scores (tenant_id, campaign_id, health_score, momentum_score, engagement_score, recommendation, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [t, campaignId, healthScore, momentumScore, engagementScore, esc(recommendation)]
    );
    await audit(req.session.user.email, 'campaign_health_checked', 'Ran health check for campaign #' + campaignId + ' (score: ' + healthScore + ')');
    res.json({ health: result.rows[0] });
  }));

  // =============================================
  // 5. FUNDRAISING CALENDAR
  // =============================================

  // GET /api/fundraising-calendar — list calendar events
  app.get('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { event_type, start_date, end_date } = req.query;
    let q = 'SELECT * FROM fundraising_calendar WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (event_type) { q += ' AND event_type=$' + idx; params.push(esc(event_type)); idx++; }
    if (start_date) { q += ' AND start_date>=$' + idx; params.push(start_date); idx++; }
    if (end_date) { q += ' AND start_date<=$' + idx; params.push(end_date); idx++; }
    q += ' ORDER BY start_date ASC';
    const result = await pool.query(q, params);
    res.json({ events: result.rows });
  }));

  // POST /api/fundraising-calendar — create event
  app.post('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, event_type, start_date, end_date, goal_amount, notes } = req.body;
    if (!title || !start_date) return res.status(400).json({ error: 'title and start_date are required' });
    const result = await pool.query(
      'INSERT INTO fundraising_calendar (tenant_id, title, event_type, start_date, end_date, goal_amount, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, esc(title), event_type || 'event', start_date, end_date || null, goal_amount || 0, notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'calendar_event_created', 'Created calendar event "' + title + '"');
    res.json({ event: result.rows[0] });
  }));

  // PUT /api/fundraising-calendar — update event
  app.put('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, title, event_type, start_date, end_date, goal_amount, notes } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM fundraising_calendar WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      'UPDATE fundraising_calendar SET title=$1, event_type=$2, start_date=$3, end_date=$4, goal_amount=$5, notes=$6 WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [title ? esc(title) : existing.title, event_type || existing.event_type,
       start_date || existing.start_date, end_date !== undefined ? end_date : existing.end_date,
       goal_amount !== undefined ? goal_amount : existing.goal_amount,
       notes !== undefined ? esc(notes) : existing.notes, id, t]
    );
    await audit(req.session.user.email, 'calendar_event_updated', 'Updated calendar event #' + id);
    res.json({ event: result.rows[0] });
  }));

  // DELETE /api/fundraising-calendar — delete event
  app.delete('/api/fundraising-calendar', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM fundraising_calendar WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    await pool.query('DELETE FROM fundraising_calendar WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'calendar_event_deleted', 'Deleted calendar event #' + id);
    res.json({ success: true });
  }));

  // =============================================
  // 6. SMART GOAL RECOMMENDER
  // =============================================

  // GET /api/goal-recommendations — list recommendations
  app.get('/api/goal-recommendations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.query;
    let q = 'SELECT gr.*, fc.title AS campaign_title FROM goal_recommendations gr LEFT JOIN fundraising_campaigns fc ON gr.campaign_id=fc.id WHERE gr.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (campaign_id) { q += ' AND gr.campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    q += ' ORDER BY gr.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ recommendations: result.rows });
  }));

  // POST /api/goal-recommendations — generate a goal recommendation
  app.post('/api/goal-recommendations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });

    const campaign = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaign_id, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    let recommendedGoal = parseInt(campaign.target) || 0;
    let confidence = 50;
    let basedOn = 'current_target';

    try {
      // Analyze past campaign performance
      const pastStats = (await pool.query(`
        SELECT COALESCE(AVG(total_raised),0) AS avg_raised,
               COALESCE(AVG(target),0) AS avg_target,
               COUNT(*) AS campaign_count,
               COALESCE(AVG(donation_count),0) AS avg_donation_count
        FROM (
          SELECT fc.id, fc.target, COALESCE(SUM(cd.amount),0) AS total_raised, COUNT(cd.id) AS donation_count
          FROM fundraising_campaigns fc
          LEFT JOIN campaign_donations cd ON cd.campaign_id = fc.id
          WHERE fc.tenant_id = $1 AND cd.refunded = false
          GROUP BY fc.id, fc.target
        ) sub
      `, [t])).rows[0];

      const avgRaised = parseInt(pastStats.avg_raised) || 0;
      const avgTarget = parseInt(pastStats.avg_target) || 0;
      const campaignCount = parseInt(pastStats.campaign_count) || 0;

      if (campaignCount > 0) {
        const avgAchievementRate = avgTarget > 0 ? (avgRaised / avgTarget) : 0;
        recommendedGoal = Math.round(avgRaised * 1.15); // 15% growth target
        confidence = Math.min(95, Math.round(50 + (campaignCount * 5)));
        basedOn = 'historical_avg_' + campaignCount + '_campaigns';
      }

      // Factor in seasonality
      const currentMonth = new Date().getMonth() + 1;
      const seasonality = (await pool.query('SELECT seasonality_factor FROM seasonality_profiles WHERE tenant_id=$1 AND month=$2', [t, currentMonth])).rows[0];
      if (seasonality) {
        recommendedGoal = Math.round(recommendedGoal * parseFloat(seasonality.seasonality_factor));
        basedOn += '_seasonality_adjusted';
      }
    } catch(e) {
      // Fallback to current target
    }

    const result = await pool.query(
      'INSERT INTO goal_recommendations (tenant_id, campaign_id, recommended_goal, confidence, based_on) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, campaign_id, recommendedGoal, confidence, esc(basedOn)]
    );
    await audit(req.session.user.email, 'goal_recommendation_created', 'Recommended goal of ' + recommendedGoal + ' for campaign #' + campaign_id);
    res.json({ recommendation: result.rows[0] });
  }));

  // =============================================
  // 7. CAMPAIGN STORYBOARD BUILDER
  // =============================================

  // GET /api/storyboards — list storyboards
  app.get('/api/storyboards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, is_published } = req.query;
    let q = 'SELECT s.*, fc.title AS campaign_title FROM campaign_storyboards s LEFT JOIN fundraising_campaigns fc ON s.campaign_id=fc.id WHERE s.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (campaign_id) { q += ' AND s.campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    if (is_published !== undefined) { q += ' AND s.is_published=$' + idx; params.push(is_published === 'true'); idx++; }
    q += ' ORDER BY s.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ storyboards: result.rows });
  }));

  // POST /api/storyboards — create storyboard
  app.post('/api/storyboards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, title, is_published } = req.body;
    if (!campaign_id || !title) return res.status(400).json({ error: 'campaign_id and title are required' });
    const result = await pool.query(
      'INSERT INTO campaign_storyboards (tenant_id, campaign_id, title, is_published) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, parseInt(campaign_id), esc(title), is_published || false]
    );
    await audit(req.session.user.email, 'storyboard_created', 'Created storyboard "' + title + '" for campaign #' + campaign_id);
    res.json({ storyboard: result.rows[0] });
  }));

  // PUT /api/storyboards — update storyboard
  app.put('/api/storyboards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, title, is_published } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_storyboards WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Storyboard not found' });
    const result = await pool.query(
      'UPDATE campaign_storyboards SET title=$1, is_published=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *',
      [title ? esc(title) : existing.title, is_published !== undefined ? is_published : existing.is_published, id, t]
    );
    await audit(req.session.user.email, 'storyboard_updated', 'Updated storyboard #' + id);
    res.json({ storyboard: result.rows[0] });
  }));

  // DELETE /api/storyboards — delete storyboard
  app.delete('/api/storyboards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_storyboards WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Storyboard not found' });
    await pool.query('DELETE FROM storyboard_sections WHERE storyboard_id=$1 AND tenant_id=$2', [id, t]);
    await pool.query('DELETE FROM campaign_storyboards WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'storyboard_deleted', 'Deleted storyboard #' + id);
    res.json({ success: true });
  }));

  // GET /api/storyboards/:id/sections — list sections
  app.get('/api/storyboards/:id/sections', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const storyboardId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM storyboard_sections WHERE storyboard_id=$1 AND tenant_id=$2 ORDER BY sort_order ASC',
      [storyboardId, t]
    );
    res.json({ sections: result.rows });
  }));

  // POST /api/storyboards/:id/sections — add section
  app.post('/api/storyboards/:id/sections', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const storyboardId = parseInt(req.params.id);
    const storyboard = (await pool.query('SELECT * FROM campaign_storyboards WHERE id=$1 AND tenant_id=$2', [storyboardId, t])).rows[0];
    if (!storyboard) return res.status(404).json({ error: 'Storyboard not found' });
    const { section_type, title, content, sort_order, image_url } = req.body;
    const result = await pool.query(
      'INSERT INTO storyboard_sections (tenant_id, storyboard_id, section_type, title, content, sort_order, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, storyboardId, section_type || 'text', title ? esc(title) : null, content ? esc(content) : null, sort_order || 0, image_url ? esc(image_url) : null]
    );
    await audit(req.session.user.email, 'storyboard_section_added', 'Added section to storyboard #' + storyboardId);
    res.json({ section: result.rows[0] });
  }));

  // PUT /api/storyboards/:id/sections — update section
  app.put('/api/storyboards/:id/sections', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const storyboardId = parseInt(req.params.id);
    const { section_id, section_type, title, content, sort_order, image_url } = req.body;
    if (!section_id) return res.status(400).json({ error: 'section_id is required' });
    const existing = (await pool.query('SELECT * FROM storyboard_sections WHERE id=$1 AND storyboard_id=$2 AND tenant_id=$3', [section_id, storyboardId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Section not found' });
    const result = await pool.query(
      'UPDATE storyboard_sections SET section_type=$1, title=$2, content=$3, sort_order=$4, image_url=$5 WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [section_type || existing.section_type, title !== undefined ? esc(title) : existing.title,
       content !== undefined ? esc(content) : existing.content,
       sort_order !== undefined ? sort_order : existing.sort_order,
       image_url !== undefined ? esc(image_url) : existing.image_url, section_id, t]
    );
    await audit(req.session.user.email, 'storyboard_section_updated', 'Updated section #' + section_id + ' in storyboard #' + storyboardId);
    res.json({ section: result.rows[0] });
  }));

  // =============================================
  // 8. DONATION FORM BUILDER
  // =============================================

  // GET /api/donation-forms — list donation forms
  app.get('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, is_active } = req.query;
    let q = 'SELECT df.*, fc.title AS campaign_title FROM donation_forms df LEFT JOIN fundraising_campaigns fc ON df.campaign_id=fc.id WHERE df.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (campaign_id) { q += ' AND df.campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    if (is_active !== undefined) { q += ' AND df.is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY df.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ forms: result.rows });
  }));

  // POST /api/donation-forms — create donation form
  app.post('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, title, fields_json, styling_json, is_active } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const result = await pool.query(
      'INSERT INTO donation_forms (tenant_id, campaign_id, title, fields_json, styling_json, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, campaign_id ? parseInt(campaign_id) : null, esc(title),
       fields_json ? JSON.stringify(fields_json) : JSON.stringify([
         { id: 'name', label: 'Full Name', type: 'text', required: true },
         { id: 'email', label: 'Email', type: 'email', required: true },
         { id: 'amount', label: 'Donation Amount', type: 'number', required: true },
         { id: 'message', label: 'Message', type: 'textarea', required: false }
       ]),
       styling_json ? JSON.stringify(styling_json) : JSON.stringify({ theme: 'default', layout: 'single' }),
       is_active !== false]
    );
    await audit(req.session.user.email, 'donation_form_created', 'Created donation form "' + title + '"');
    res.json({ form: result.rows[0] });
  }));

  // PUT /api/donation-forms — update donation form
  app.put('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, campaign_id, title, fields_json, styling_json, is_active } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donation_forms WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Form not found' });
    const result = await pool.query(
      'UPDATE donation_forms SET campaign_id=$1, title=$2, fields_json=$3, styling_json=$4, is_active=$5 WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [campaign_id !== undefined ? (campaign_id ? parseInt(campaign_id) : null) : existing.campaign_id,
       title ? esc(title) : existing.title,
       fields_json ? JSON.stringify(fields_json) : existing.fields_json,
       styling_json ? JSON.stringify(styling_json) : existing.styling_json,
       is_active !== undefined ? is_active : existing.is_active, id, t]
    );
    await audit(req.session.user.email, 'donation_form_updated', 'Updated donation form #' + id);
    res.json({ form: result.rows[0] });
  }));

  // DELETE /api/donation-forms — delete donation form
  app.delete('/api/donation-forms', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donation_forms WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Form not found' });
    await pool.query('DELETE FROM donation_form_submissions WHERE form_id=$1 AND tenant_id=$2', [id, t]);
    await pool.query('DELETE FROM donation_forms WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donation_form_deleted', 'Deleted donation form #' + id);
    res.json({ success: true });
  }));

  // POST /api/donation-forms/:id/submit — submit a donation form
  app.post('/api/donation-forms/:id/submit', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const formId = parseInt(req.params.id);
    const form = (await pool.query('SELECT * FROM donation_forms WHERE id=$1 AND tenant_id=$2 AND is_active=true', [formId, t])).rows[0];
    if (!form) return res.status(404).json({ error: 'Form not found or inactive' });
    const { donor_email, responses, amount } = req.body;
    const result = await pool.query(
      'INSERT INTO donation_form_submissions (tenant_id, form_id, donor_email, responses_json, amount) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, formId, donor_email ? esc(donor_email) : null, responses ? JSON.stringify(responses) : '{}', parseInt(amount) || 0]
    );
    // Increment submissions count
    await pool.query('UPDATE donation_forms SET submissions_count = submissions_count + 1 WHERE id=$1 AND tenant_id=$2', [formId, t]);
    res.json({ submission: result.rows[0] });
  }));

  // GET /api/donation-forms/:id/submissions — get form submissions
  app.get('/api/donation-forms/:id/submissions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const formId = parseInt(req.params.id);
    const { limit, offset } = req.query;
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    const result = await pool.query(
      'SELECT * FROM donation_form_submissions WHERE form_id=$1 AND tenant_id=$2 ORDER BY submitted_at DESC LIMIT $3 OFFSET $4',
      [formId, t, lim, off]
    );
    const count = (await pool.query('SELECT COUNT(*) AS total FROM donation_form_submissions WHERE form_id=$1 AND tenant_id=$2', [formId, t])).rows[0];
    const totalAmount = (await pool.query('SELECT COALESCE(SUM(amount),0) AS total FROM donation_form_submissions WHERE form_id=$1 AND tenant_id=$2', [formId, t])).rows[0];
    res.json({ submissions: result.rows, total: parseInt(count.total), total_amount: parseInt(totalAmount.total) });
  }));

  // =============================================
  // 9. CAMPAIGN SUCCESS BLUEPRINT
  // =============================================

  // GET /api/campaign-blueprints — list blueprints
  app.get('/api/campaign-blueprints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { category } = req.query;
    let q = 'SELECT * FROM campaign_blueprints WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (category) { q += ' AND category=$' + idx; params.push(esc(category)); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ blueprints: result.rows });
  }));

  // POST /api/campaign-blueprints — create blueprint
  app.post('/api/campaign-blueprints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, category, milestones_json, timeline_json, checklist_json } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO campaign_blueprints (tenant_id, name, category, milestones_json, timeline_json, checklist_json) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), category ? esc(category) : 'general',
       milestones_json ? JSON.stringify(milestones_json) : JSON.stringify([
         { id: 1, name: 'Planning', description: 'Define goals and strategy', target_days: 7 },
         { id: 2, name: 'Launch', description: 'Go live with campaign', target_days: 14 },
         { id: 3, name: 'Mid-campaign Review', description: 'Assess progress and adjust', target_days: 30 },
         { id: 4, name: 'Final Push', description: 'Intensify outreach', target_days: 45 },
         { id: 5, name: 'Wrap-up', description: 'Thank donors and report results', target_days: 60 }
       ]),
       timeline_json ? JSON.stringify(timeline_json) : JSON.stringify([
         { week: 1, tasks: ['Set campaign goals', 'Identify target donors'] },
         { week: 2, tasks: ['Launch campaign', 'Send announcement emails'] },
         { week: 3, tasks: ['Social media push', 'Follow up with major donors'] }
       ]),
       checklist_json ? JSON.stringify(checklist_json) : JSON.stringify([
         { id: 1, task: 'Define campaign goal and timeline', done: false },
         { id: 2, task: 'Create campaign story and media', done: false },
         { id: 3, task: 'Set up donation page', done: false },
         { id: 4, task: 'Prepare email templates', done: false },
         { id: 5, task: 'Plan social media content', done: false },
         { id: 6, task: 'Brief team and volunteers', done: false },
         { id: 7, task: 'Test donation flow', done: false },
         { id: 8, task: 'Schedule launch communications', done: false }
       ])]
    );
    await audit(req.session.user.email, 'blueprint_created', 'Created blueprint "' + name + '"');
    res.json({ blueprint: result.rows[0] });
  }));

  // PUT /api/campaign-blueprints — update blueprint
  app.put('/api/campaign-blueprints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, category, milestones_json, timeline_json, checklist_json } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_blueprints WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Blueprint not found' });
    const result = await pool.query(
      'UPDATE campaign_blueprints SET name=$1, category=$2, milestones_json=$3, timeline_json=$4, checklist_json=$5 WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : existing.name, category ? esc(category) : existing.category,
       milestones_json ? JSON.stringify(milestones_json) : existing.milestones_json,
       timeline_json ? JSON.stringify(timeline_json) : existing.timeline_json,
       checklist_json ? JSON.stringify(checklist_json) : existing.checklist_json, id, t]
    );
    await audit(req.session.user.email, 'blueprint_updated', 'Updated blueprint #' + id);
    res.json({ blueprint: result.rows[0] });
  }));

  // DELETE /api/campaign-blueprints — delete blueprint
  app.delete('/api/campaign-blueprints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM campaign_blueprints WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Blueprint not found' });
    await pool.query('DELETE FROM campaign_blueprints WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'blueprint_deleted', 'Deleted blueprint #' + id);
    res.json({ success: true });
  }));

  // GET /api/campaign-blueprints/:id — get a single blueprint with full details
  app.get('/api/campaign-blueprints/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const blueprintId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM campaign_blueprints WHERE id=$1 AND tenant_id=$2', [blueprintId, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Blueprint not found' });
    res.json({ blueprint: result.rows[0] });
  }));

  // =============================================
  // 10. SMART THANK YOU ENGINE
  // =============================================

  // GET /api/thank-you-templates — list templates
  app.get('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { channel } = req.query;
    let q = 'SELECT * FROM thank_you_templates WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (channel) { q += ' AND channel=$' + idx; params.push(esc(channel)); idx++; }
    q += ' ORDER BY is_default DESC, name ASC';
    const result = await pool.query(q, params);
    res.json({ templates: result.rows });
  }));

  // POST /api/thank-you-templates — create template
  app.post('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, subject, body_template, channel, is_default } = req.body;
    if (!name || !body_template) return res.status(400).json({ error: 'name and body_template are required' });
    const result = await pool.query(
      'INSERT INTO thank_you_templates (tenant_id, name, subject, body_template, channel, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), subject ? esc(subject) : null, esc(body_template), channel || 'email', is_default || false]
    );
    await audit(req.session.user.email, 'thank_you_template_created', 'Created thank-you template "' + name + '"');
    res.json({ template: result.rows[0] });
  }));

  // PUT /api/thank-you-templates — update template
  app.put('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, subject, body_template, channel, is_default } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM thank_you_templates WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    const result = await pool.query(
      'UPDATE thank_you_templates SET name=$1, subject=$2, body_template=$3, channel=$4, is_default=$5 WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : existing.name, subject !== undefined ? esc(subject) : existing.subject,
       body_template ? esc(body_template) : existing.body_template,
       channel || existing.channel, is_default !== undefined ? is_default : existing.is_default, id, t]
    );
    await audit(req.session.user.email, 'thank_you_template_updated', 'Updated thank-you template #' + id);
    res.json({ template: result.rows[0] });
  }));

  // DELETE /api/thank-you-templates — delete template
  app.delete('/api/thank-you-templates', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM thank_you_templates WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    await pool.query('DELETE FROM thank_you_templates WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'thank_you_template_deleted', 'Deleted thank-you template #' + id);
    res.json({ success: true });
  }));

  // POST /api/thank-you/send — send a thank you message
  app.post('/api/thank-you/send', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { template_id, donor_email, campaign_id, donor_name, amount, campaign_title } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });

    // Get template
    let template;
    if (template_id) {
      template = (await pool.query('SELECT * FROM thank_you_templates WHERE id=$1 AND tenant_id=$2', [parseInt(template_id), t])).rows[0];
    }
    if (!template) {
      template = (await pool.query('SELECT * FROM thank_you_templates WHERE tenant_id=$1 AND is_default=true LIMIT 1', [t])).rows[0];
    }
    if (!template) {
      template = (await pool.query('SELECT * FROM thank_you_templates WHERE tenant_id=$1 LIMIT 1', [t])).rows[0];
    }

    let body = template ? template.body_template : 'Dear {donor_name}, thank you for your donation of {amount} to {campaign_title}!';
    let subject = template ? template.subject : 'Thank you for your donation!';

    // Replace placeholders
    body = body.replace(/\{donor_name\}/g, donor_name || 'Donor')
               .replace(/\{amount\}/g, (parseInt(amount) || 0).toLocaleString())
               .replace(/\{campaign_title\}/g, campaign_title || 'our campaign');
    subject = (subject || '').replace(/\{donor_name\}/g, donor_name || 'Donor')
               .replace(/\{amount\}/g, (parseInt(amount) || 0).toLocaleString())
               .replace(/\{campaign_title\}/g, campaign_title || 'our campaign');

    // Send via appropriate channel
    const channel = template ? template.channel : 'email';
    let sent = false;

    if ((channel === 'email' || channel === 'both') && sendEmail) {
      try {
        await sendEmail(donor_email, subject, '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">' + body.replace(/\n/g, '<br>') + '</div>');
        sent = true;
      } catch(e) { /* email send failed */ }
    }
    if ((channel === 'sms' || channel === 'both') && sendSMS) {
      try {
        await sendSMS(donor_email, body);
        sent = true;
      } catch(e) { /* sms send failed */ }
    }

    // Log the thank you
    const logResult = await pool.query(
      'INSERT INTO thank_you_log (tenant_id, template_id, donor_email, campaign_id, sent_at, opened) VALUES ($1,$2,$3,$4,NOW(),false) RETURNING *',
      [t, template ? template.id : null, esc(donor_email), campaign_id ? parseInt(campaign_id) : null]
    );

    await audit(req.session.user.email, 'thank_you_sent', 'Sent thank you to ' + donor_email + (campaign_id ? ' for campaign #' + campaign_id : ''));
    res.json({ sent, log: logResult.rows[0], channel, body_preview: body.substring(0, 200) });
  }));

  // GET /api/thank-you/log — list thank you log entries
  app.get('/api/thank-you/log', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, campaign_id, limit, offset } = req.query;
    let q = 'SELECT tyl.*, tyt.name AS template_name FROM thank_you_log tyl LEFT JOIN thank_you_templates tyt ON tyl.template_id=tyt.id WHERE tyl.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND tyl.donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    if (campaign_id) { q += ' AND tyl.campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    q += ' ORDER BY tyl.sent_at DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ log: result.rows });
  }));

  // POST /api/thank-you/log/:id/track-open — track thank you open
  app.post('/api/thank-you/log/:id/track-open', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const logId = parseInt(req.params.id);
    await pool.query('UPDATE thank_you_log SET opened=true WHERE id=$1 AND tenant_id=$2', [logId, t]);
    res.json({ success: true });
  }));

  // =============================================
  // 11. MICRO-DONATION ROUND-UPS
  // =============================================

  // GET /api/micro-roundup-settings — get roundup settings
  app.get('/api/micro-roundup-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM micro_roundup_settings WHERE tenant_id=$1', [t]);
    res.json({ settings: result.rows[0] || null });
  }));

  // PUT /api/micro-roundup-settings — update roundup settings
  app.put('/api/micro-roundup-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { enabled, default_roundup, max_monthly } = req.body;
    const result = await pool.query(
      `INSERT INTO micro_roundup_settings (tenant_id, enabled, default_roundup, max_monthly) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET enabled=$2, default_roundup=$3, max_monthly=$4
       RETURNING *`,
      [t, enabled !== undefined ? enabled : false, default_roundup || 100, max_monthly || 10000]
    );
    await audit(req.session.user.email, 'roundup_settings_updated', 'Updated micro-roundup settings');
    res.json({ settings: result.rows[0] });
  }));

  // POST /api/micro-roundup — process a round-up donation
  app.post('/api/micro-roundup', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, original_amount, campaign_id } = req.body;
    if (!donor_email || original_amount === undefined) return res.status(400).json({ error: 'donor_email and original_amount are required' });

    // Check settings
    const settings = (await pool.query('SELECT * FROM micro_roundup_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings || !settings.enabled) return res.status(400).json({ error: 'Round-up donations are not enabled' });

    const origAmount = parseInt(original_amount) || 0;
    const roundupAmount = settings.default_roundup;
    const roundedAmount = origAmount + roundupAmount;

    // Check monthly cap
    const monthlyTotal = (await pool.query(
      `SELECT COALESCE(SUM(roundup_amount),0) AS total FROM micro_roundup_transactions
       WHERE tenant_id=$1 AND donor_email=$2 AND created_at >= DATE_TRUNC('month', NOW())`,
      [t, esc(donor_email)]
    )).rows[0];
    if (parseInt(monthlyTotal.total) + roundupAmount > settings.max_monthly) {
      return res.status(400).json({ error: 'Monthly round-up cap exceeded', current_monthly: parseInt(monthlyTotal.total), cap: settings.max_monthly });
    }

    const result = await pool.query(
      'INSERT INTO micro_roundup_transactions (tenant_id, donor_email, original_amount, rounded_amount, roundup_amount, campaign_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(donor_email), origAmount, roundedAmount, roundupAmount, campaign_id ? parseInt(campaign_id) : null]
    );
    await audit(req.session.user.email, 'roundup_processed', 'Processed round-up of ' + roundupAmount + ' for ' + donor_email);
    res.json({ transaction: result.rows[0] });
  }));

  // GET /api/micro-roundup/summary — get round-up summary
  app.get('/api/micro-roundup/summary', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const summary = (await pool.query(`
      SELECT COALESCE(SUM(roundup_amount),0) AS total_roundup,
             COUNT(*) AS total_transactions,
             COUNT(DISTINCT donor_email) AS unique_donors,
             COALESCE(AVG(roundup_amount),0) AS avg_roundup
      FROM micro_roundup_transactions WHERE tenant_id=$1
    `, [t])).rows[0];
    const monthly = (await pool.query(`
      SELECT DATE_TRUNC('month', created_at) AS month,
             COALESCE(SUM(roundup_amount),0) AS total,
             COUNT(*) AS count
      FROM micro_roundup_transactions WHERE tenant_id=$1
      GROUP BY month ORDER BY month DESC LIMIT 12
    `, [t])).rows;
    res.json({ summary, monthly });
  }));

  // =============================================
  // 12. DONATION DAY SCHEDULER
  // =============================================

  // GET /api/scheduled-donations — list scheduled donations
  app.get('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, status, frequency } = req.query;
    let q = 'SELECT sd.*, fc.title AS campaign_title FROM scheduled_donations sd LEFT JOIN fundraising_campaigns fc ON sd.campaign_id=fc.id WHERE sd.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND sd.donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    if (status) { q += ' AND sd.status=$' + idx; params.push(esc(status)); idx++; }
    if (frequency) { q += ' AND sd.frequency=$' + idx; params.push(esc(frequency)); idx++; }
    q += ' ORDER BY sd.next_date ASC NULLS LAST, sd.created_at DESC';
    const result = await pool.query(q, params);
    res.json({ donations: result.rows });
  }));

  // POST /api/scheduled-donations — create scheduled donation
  app.post('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, campaign_id, amount, scheduled_date, frequency, status } = req.body;
    if (!donor_email || !scheduled_date) return res.status(400).json({ error: 'donor_email and scheduled_date are required' });
    const validFreq = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    if (frequency && !validFreq.includes(frequency)) return res.status(400).json({ error: 'Invalid frequency' });

    // Calculate next_date
    let nextDate = scheduled_date;
    if (frequency && frequency !== 'once') {
      nextDate = scheduled_date; // First occurrence is the scheduled_date
    }

    const result = await pool.query(
      'INSERT INTO scheduled_donations (tenant_id, donor_email, campaign_id, amount, scheduled_date, frequency, next_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, esc(donor_email), campaign_id ? parseInt(campaign_id) : null, amount || 0,
       scheduled_date, frequency || 'once', nextDate, status || 'active']
    );
    await audit(req.session.user.email, 'scheduled_donation_created', 'Scheduled donation for ' + donor_email + ' on ' + scheduled_date);
    res.json({ donation: result.rows[0] });
  }));

  // PUT /api/scheduled-donations — update scheduled donation
  app.put('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, donor_email, campaign_id, amount, scheduled_date, frequency, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM scheduled_donations WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Scheduled donation not found' });

    // Recalculate next_date if frequency or scheduled_date changes
    const newFreq = frequency || existing.frequency;
    const newDate = scheduled_date || existing.scheduled_date;
    let nextDate = existing.next_date;
    if (scheduled_date || (frequency && frequency !== existing.frequency)) {
      nextDate = newDate;
    }

    const result = await pool.query(
      'UPDATE scheduled_donations SET donor_email=$1, campaign_id=$2, amount=$3, scheduled_date=$4, frequency=$5, next_date=$6, status=$7 WHERE id=$8 AND tenant_id=$9 RETURNING *',
      [donor_email ? esc(donor_email) : existing.donor_email,
       campaign_id !== undefined ? (campaign_id ? parseInt(campaign_id) : null) : existing.campaign_id,
       amount !== undefined ? amount : existing.amount,
       scheduled_date || existing.scheduled_date,
       newFreq, nextDate,
       status || existing.status, id, t]
    );
    await audit(req.session.user.email, 'scheduled_donation_updated', 'Updated scheduled donation #' + id);
    res.json({ donation: result.rows[0] });
  }));

  // DELETE /api/scheduled-donations — delete scheduled donation
  app.delete('/api/scheduled-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM scheduled_donations WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Scheduled donation not found' });
    await pool.query('DELETE FROM scheduled_donations WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'scheduled_donation_deleted', 'Deleted scheduled donation #' + id);
    res.json({ success: true });
  }));

  // POST /api/scheduled-donations/process-due — process donations that are due
  app.post('/api/scheduled-donations/process-due', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const dueDonations = (await pool.query(
      'SELECT * FROM scheduled_donations WHERE tenant_id=$1 AND status=$2 AND next_date <= CURRENT_DATE',
      [t, 'active']
    )).rows;

    let processed = 0;
    for (const d of dueDonations) {
      // Record the donation
      if (d.campaign_id) {
        try {
          await pool.query(
            'INSERT INTO campaign_donations (campaign_id, donor_name, donor_email, amount, method, donated_at) VALUES ($1,$2,$3,$4,$5,NOW())',
            [d.campaign_id, d.donor_email, d.donor_email, d.amount, 'scheduled']
          );
        } catch(e) { /* campaign_donations may not have all columns */ }
      }

      // Calculate next date
      const freq = d.frequency;
      let nextDate = null;
      if (freq === 'once') {
        // Mark as completed
        await pool.query('UPDATE scheduled_donations SET status=$1 WHERE id=$2 AND tenant_id=$3', ['completed', d.id, t]);
      } else {
        const current = new Date(d.next_date || d.scheduled_date);
        switch (freq) {
          case 'weekly': current.setDate(current.getDate() + 7); break;
          case 'biweekly': current.setDate(current.getDate() + 14); break;
          case 'monthly': current.setMonth(current.getMonth() + 1); break;
          case 'quarterly': current.setMonth(current.getMonth() + 3); break;
          case 'yearly': current.setFullYear(current.getFullYear() + 1); break;
        }
        nextDate = current.toISOString().split('T')[0];
        await pool.query('UPDATE scheduled_donations SET next_date=$1 WHERE id=$2 AND tenant_id=$3', [nextDate, d.id, t]);
      }

      // Notify donor
      if (notify) {
        notify(t, d.donor_email, 'Scheduled Donation Processed', 'Your scheduled donation of ' + d.amount + ' has been processed.', 'fundraising');
      }
      processed++;
    }

    if (processed > 0) {
      await audit(req.session.user.email, 'scheduled_donations_processed', 'Processed ' + processed + ' scheduled donations');
    }
    res.json({ processed, total_due: dueDonations.length });
  }));

  // =============================================
  // 13. CAMPAIGN SEASONALITY ADJUSTER
  // =============================================

  // GET /api/seasonality — list seasonality profiles
  app.get('/api/seasonality', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { month, year } = req.query;
    let q = 'SELECT * FROM seasonality_profiles WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (month) { q += ' AND month=$' + idx; params.push(parseInt(month)); idx++; }
    if (year) { q += ' AND year=$' + idx; params.push(parseInt(year)); idx++; }
    q += ' ORDER BY month ASC';
    const result = await pool.query(q, params);

    // Current month factor
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const currentProfile = (await pool.query(
      'SELECT * FROM seasonality_profiles WHERE tenant_id=$1 AND month=$2 AND year=$3',
      [t, currentMonth, currentYear]
    )).rows[0];

    res.json({ profiles: result.rows, current_month_factor: currentProfile ? currentProfile.seasonality_factor : 1.0 });
  }));

  // POST /api/seasonality — create or update a seasonality profile
  app.post('/api/seasonality', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { month, seasonality_factor, avg_donation_trend, recommendation, year } = req.body;
    if (!month) return res.status(400).json({ error: 'month is required' });
    if (month < 1 || month > 12) return res.status(400).json({ error: 'month must be between 1 and 12' });
    const yr = year || new Date().getFullYear();

    const result = await pool.query(
      `INSERT INTO seasonality_profiles (tenant_id, month, seasonality_factor, avg_donation_trend, recommendation, year)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, month, year) DO UPDATE SET seasonality_factor=$3, avg_donation_trend=$4, recommendation=$5
       RETURNING *`,
      [t, parseInt(month), seasonality_factor || 1.0,
       avg_donation_trend ? esc(avg_donation_trend) : null,
       recommendation ? esc(recommendation) : null, yr]
    );
    await audit(req.session.user.email, 'seasonality_updated', 'Updated seasonality profile for month ' + month);
    res.json({ profile: result.rows[0] });
  }));

  // POST /api/seasonality/calculate — auto-calculate seasonality from donation data
  app.post('/api/seasonality/calculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    try {
      const monthlyStats = (await pool.query(`
        SELECT EXTRACT(MONTH FROM cd.donated_at)::INT AS month,
               COALESCE(AVG(cd.amount),0)::INT AS avg_amount,
               COALESCE(SUM(cd.amount),0) AS total_amount,
               COUNT(*) AS donation_count
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donated_at >= NOW() - INTERVAL '24 months'
        GROUP BY month ORDER BY month
      `, [t])).rows;

      if (monthlyStats.length === 0) {
        return res.json({ message: 'No donation data available for calculation', count: 0 });
      }

      const overallAvg = monthlyStats.reduce((s, m) => s + parseInt(m.avg_amount), 0) / monthlyStats.length;
      const currentYear = new Date().getFullYear();
      let updated = 0;

      for (const ms of monthlyStats) {
        const factor = overallAvg > 0 ? parseFloat((parseInt(ms.avg_amount) / overallAvg).toFixed(2)) : 1.0;
        let trend = 'stable';
        if (factor > 1.2) trend = 'peak';
        else if (factor > 1.0) trend = 'rising';
        else if (factor < 0.8) trend = 'low';
        else if (factor < 1.0) trend = 'declining';

        let rec = '';
        if (trend === 'peak') rec = 'High giving month — maximize campaign activity and outreach';
        else if (trend === 'rising') rec = 'Above average — good time for campaign launches';
        else if (trend === 'declining') rec = 'Below average — focus on donor retention and engagement';
        else if (trend === 'low') rec = 'Low giving month — plan ahead for peak seasons';

        await pool.query(
          `INSERT INTO seasonality_profiles (tenant_id, month, seasonality_factor, avg_donation_trend, recommendation, year)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, month, year) DO UPDATE SET seasonality_factor=$3, avg_donation_trend=$4, recommendation=$5`,
          [t, ms.month, factor, trend, rec, currentYear]
        );
        updated++;
      }

      await audit(req.session.user.email, 'seasonality_calculated', 'Calculated seasonality for ' + updated + ' months');
      res.json({ message: 'Calculated seasonality for ' + updated + ' months', count: updated });
    } catch(e) {
      res.json({ message: 'Calculation attempted', count: 0, note: 'Ensure donation data exists' });
    }
  }));

  // =============================================
  // 14. SMART AMOUNT SUGGESTIONS
  // =============================================

  // GET /api/amount-suggestions/settings — get settings
  app.get('/api/amount-suggestions/settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM amount_suggestion_settings WHERE tenant_id=$1', [t]);
    res.json({ settings: result.rows[0] || null });
  }));

  // PUT /api/amount-suggestions/settings — update settings
  app.put('/api/amount-suggestions/settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { strategy, presets_json, custom_amounts_json } = req.body;
    const validStrategies = ['data_driven', 'presets', 'custom', 'tiered'];
    if (strategy && !validStrategies.includes(strategy)) return res.status(400).json({ error: 'Invalid strategy' });

    const result = await pool.query(
      `INSERT INTO amount_suggestion_settings (tenant_id, strategy, presets_json, custom_amounts_json) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET strategy=$2, presets_json=$3, custom_amounts_json=$4
       RETURNING *`,
      [t, strategy || 'data_driven',
       presets_json ? JSON.stringify(presets_json) : JSON.stringify([5000, 10000, 25000, 50000, 100000]),
       custom_amounts_json ? JSON.stringify(custom_amounts_json) : JSON.stringify([])]
    );
    await audit(req.session.user.email, 'amount_suggestion_settings_updated', 'Updated amount suggestion settings to strategy: ' + (strategy || 'data_driven'));
    res.json({ settings: result.rows[0] });
  }));

  // GET /api/campaigns/:id/suggested-amounts — get suggested amounts for a campaign
  app.get('/api/campaigns/:id/suggested-amounts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { force_refresh } = req.query;

    // Check for cached suggestion
    if (force_refresh !== 'true') {
      const cached = (await pool.query('SELECT * FROM amount_suggestions WHERE campaign_id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
      if (cached) return res.json({ suggested_amounts: cached.suggested_amounts_json, based_on: cached.based_on });
    }

    // Get settings
    const settings = (await pool.query('SELECT * FROM amount_suggestion_settings WHERE tenant_id=$1', [t])).rows[0];
    const strategy = settings ? settings.strategy : 'data_driven';

    let suggestedAmounts = [];
    let basedOn = strategy;

    try {
      if (strategy === 'data_driven') {
        // Analyze donation distribution for this campaign
        const donationStats = (await pool.query(`
          SELECT COALESCE(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cd.amount), 5000) AS p25,
                 COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY cd.amount), 10000) AS p50,
                 COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cd.amount), 25000) AS p75,
                 COALESCE(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cd.amount), 50000) AS p90,
                 COALESCE(AVG(cd.amount), 10000)::INT AS avg,
                 COALESCE(MIN(cd.amount), 1000)::INT AS min_amt,
                 COALESCE(MAX(cd.amount), 100000)::INT AS max_amt
          FROM campaign_donations cd
          JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
          WHERE fc.id = $1 AND fc.tenant_id = $2
        `, [campaignId, t])).rows[0];

        const p25 = parseInt(donationStats.p25) || 5000;
        const p50 = parseInt(donationStats.p50) || 10000;
        const p75 = parseInt(donationStats.p75) || 25000;
        const p90 = parseInt(donationStats.p90) || 50000;

        suggestedAmounts = [
          { amount: Math.round(p25 / 1000) * 1000, label: 'Supporter' },
          { amount: Math.round(p50 / 1000) * 1000, label: 'Champion', highlighted: true },
          { amount: Math.round(p75 / 1000) * 1000, label: 'Leader' },
          { amount: Math.round(p90 / 1000) * 1000, label: 'Visionary' }
        ];
        basedOn = 'data_driven_campaign_percentiles';
      } else if (strategy === 'presets') {
        const presets = settings ? settings.presets_json : [5000, 10000, 25000, 50000, 100000];
        suggestedAmounts = presets.map((a, i) => ({
          amount: parseInt(a),
          label: i === 1 ? 'Popular' : (i === presets.length - 1 ? 'Maximum Impact' : 'Option ' + (i + 1)),
          highlighted: i === 1
        }));
        basedOn = 'preset_amounts';
      } else if (strategy === 'custom') {
        const customAmounts = settings ? settings.custom_amounts_json : [];
        if (customAmounts.length > 0) {
          suggestedAmounts = customAmounts.map((a, i) => ({
            amount: parseInt(a),
            label: 'Custom ' + (i + 1),
            highlighted: i === 0
          }));
        } else {
          suggestedAmounts = [
            { amount: 5000, label: 'Supporter' },
            { amount: 10000, label: 'Champion', highlighted: true },
            { amount: 25000, label: 'Leader' },
            { amount: 50000, label: 'Visionary' }
          ];
        }
        basedOn = 'custom_amounts';
      } else if (strategy === 'tiered') {
        // Tiered: small, medium, large, premium based on campaign target
        const campaign = (await pool.query('SELECT target FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [campaignId, t])).rows[0];
        const target = parseInt(campaign?.target) || 1000000;
        suggestedAmounts = [
          { amount: Math.round(target * 0.005 / 1000) * 1000 || 5000, label: 'Seed' },
          { amount: Math.round(target * 0.01 / 1000) * 1000 || 10000, label: 'Growth', highlighted: true },
          { amount: Math.round(target * 0.025 / 1000) * 1000 || 25000, label: 'Impact' },
          { amount: Math.round(target * 0.05 / 1000) * 1000 || 50000, label: 'Transformative' }
        ];
        basedOn = 'tiered_by_campaign_target';
      }
    } catch(e) {
      // Fallback to default
      suggestedAmounts = [
        { amount: 5000, label: 'Supporter' },
        { amount: 10000, label: 'Champion', highlighted: true },
        { amount: 25000, label: 'Leader' },
        { amount: 50000, label: 'Visionary' }
      ];
      basedOn = 'fallback_defaults';
    }

    // Factor in seasonality
    try {
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const seasonality = (await pool.query('SELECT seasonality_factor FROM seasonality_profiles WHERE tenant_id=$1 AND month=$2 AND year=$3', [t, currentMonth, currentYear])).rows[0];
      if (seasonality && parseFloat(seasonality.seasonality_factor) !== 1.0) {
        const factor = parseFloat(seasonality.seasonality_factor);
        suggestedAmounts = suggestedAmounts.map(s => ({
          ...s,
          amount: Math.round((s.amount * factor) / 1000) * 1000,
          seasonality_adjusted: true
        }));
        basedOn += '_seasonality_adjusted';
      }
    } catch(e) { /* no seasonality adjustment */ }

    // Cache the result
    await pool.query(
      `INSERT INTO amount_suggestions (tenant_id, campaign_id, suggested_amounts_json, based_on) VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [t, campaignId, JSON.stringify(suggestedAmounts), esc(basedOn)]
    );

    res.json({ suggested_amounts: suggestedAmounts, based_on: basedOn });
  }));

  // =============================================
  // 15. CAMPAIGN A/B TESTING ENGINE (Extended)
  // =============================================
  // Uses campaign_ab_tests table from mega2 but adds enhanced tracking via ab_engine_events

  // POST /api/ab-engine/create — create A/B test with enhanced tracking
  app.post('/api/ab-engine/create', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, variants } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id is required' });
    if (!variants || !Array.isArray(variants) || variants.length < 2) {
      return res.status(400).json({ error: 'At least 2 variants are required' });
    }

    // Verify campaign belongs to tenant
    const campaign = (await pool.query('SELECT id FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [parseInt(campaign_id), t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const createdVariants = [];
    for (const v of variants) {
      if (!v.variant_name) continue;
      const result = await pool.query(
        'INSERT INTO campaign_ab_tests (tenant_id, campaign_id, variant_name, variant_title, variant_story) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, parseInt(campaign_id), esc(v.variant_name), esc(v.variant_title || ''), esc(v.variant_story || '')]
      );
      createdVariants.push(result.rows[0]);
    }

    await audit(req.session.user.email, 'ab_engine_test_created', 'Created A/B test with ' + createdVariants.length + ' variants for campaign #' + campaign_id);
    res.json({ test: { campaign_id: parseInt(campaign_id), variants: createdVariants } });
  }));

  // GET /api/ab-engine/:id/performance — get enhanced performance metrics
  app.get('/api/ab-engine/:id/performance', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);

    // Get all variants for this campaign
    const variants = (await pool.query(
      'SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at',
      [campaignId, t]
    )).rows;

    if (variants.length === 0) return res.status(404).json({ error: 'No A/B tests found for this campaign' });

    // Get enhanced event tracking for each variant
    const enhancedVariants = [];
    for (const v of variants) {
      const events = (await pool.query(
        'SELECT event_type, COUNT(*) AS count FROM ab_engine_events WHERE test_id=$1 AND tenant_id=$2 GROUP BY event_type',
        [v.id, t]
      )).rows;

      const eventMap = {};
      for (const e of events) {
        eventMap[e.event_type] = parseInt(e.count);
      }

      enhancedVariants.push({
        ...v,
        enhanced_events: eventMap,
        impressions: eventMap.impression || 0,
        clicks: eventMap.click || 0,
        shares: eventMap.share || 0,
        bounces: eventMap.bounce || 0,
        click_through_rate: (eventMap.impression || 0) > 0
          ? parseFloat(((eventMap.click || 0) / (eventMap.impression || 1) * 100).toFixed(2))
          : 0,
        bounce_rate: (eventMap.impression || 0) > 0
          ? parseFloat(((eventMap.bounce || 0) / (eventMap.impression || 1) * 100).toFixed(2))
          : 0,
        share_rate: (eventMap.impression || 0) > 0
          ? parseFloat(((eventMap.share || 0) / (eventMap.impression || 1) * 100).toFixed(2))
          : 0
      });
    }

    // Determine current leader
    const leader = enhancedVariants.reduce((best, v) => {
      const bestScore = parseFloat(best.conversion_rate) + (best.click_through_rate || 0) * 0.5;
      const vScore = parseFloat(v.conversion_rate) + (v.click_through_rate || 0) * 0.5;
      return vScore > bestScore ? v : best;
    }, enhancedVariants[0]);

    // Statistical significance check (simplified)
    const totalViews = enhancedVariants.reduce((s, v) => s + (v.views || 0), 0);
    const isSignificant = totalViews >= 100;

    res.json({
      campaign_id: campaignId,
      variants: enhancedVariants,
      leader: { variant_name: leader.variant_name, conversion_rate: leader.conversion_rate },
      statistical_significance: isSignificant,
      recommendation: isSignificant
        ? 'Results are statistically significant. Consider selecting the leading variant.'
        : 'Need more data for statistical significance. Continue running the test.'
    });
  }));

  // POST /api/ab-engine/:id/select-winner — select the winning variant
  app.post('/api/ab-engine/:id/select-winner', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { variant_id, reason } = req.body;

    // Get all variants
    const allVariants = (await pool.query(
      'SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2',
      [campaignId, t]
    )).rows;

    if (allVariants.length === 0) return res.status(404).json({ error: 'No A/B tests found for this campaign' });

    let winner;
    if (variant_id) {
      winner = allVariants.find(v => v.id === parseInt(variant_id));
      if (!winner) return res.status(404).json({ error: 'Variant not found' });
    } else {
      // Auto-select best performing variant
      winner = allVariants.reduce((best, v) => parseFloat(v.conversion_rate) >= parseFloat(best.conversion_rate) ? v : best, allVariants[0]);
    }

    // Mark winner
    await pool.query(
      'UPDATE campaign_ab_tests SET is_winner = (id = $1) WHERE campaign_id=$2 AND tenant_id=$3',
      [winner.id, campaignId, t]
    );

    // Get updated variants
    const updated = (await pool.query(
      'SELECT * FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at',
      [campaignId, t]
    )).rows;

    await audit(req.session.user.email, 'ab_engine_winner_selected', 'Selected variant "' + winner.variant_name + '" as winner for campaign #' + campaignId + (reason ? '. Reason: ' + reason : ''));

    // Notify admins
    const admins = (await pool.query("SELECT email FROM users WHERE tenant_id=$1 AND role IN ('admin','super_admin')", [t])).rows;
    for (const a of admins) {
      notify(t, a.email, 'A/B Test Winner Selected', 'Variant "' + winner.variant_name + '" was selected as the winner for campaign #' + campaignId, 'fundraising');
    }

    res.json({ winner, all_variants: updated, reason: reason || null });
  }));

  // POST /api/ab-engine/track — track an enhanced A/B event
  app.post('/api/ab-engine/track', ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { test_id, event_type, donor_email, metadata } = req.body;
    if (!test_id || !event_type) return res.status(400).json({ error: 'test_id and event_type are required' });
    const validEvents = ['impression', 'click', 'donation', 'share', 'bounce'];
    if (!validEvents.includes(event_type)) return res.status(400).json({ error: 'Invalid event_type. Use: ' + validEvents.join(', ') });

    // Verify test exists
    const test = (await pool.query('SELECT * FROM campaign_ab_tests WHERE id=$1 AND tenant_id=$2', [parseInt(test_id), t])).rows[0];
    if (!test) return res.status(404).json({ error: 'A/B test variant not found' });

    // Record enhanced event
    await pool.query(
      'INSERT INTO ab_engine_events (tenant_id, test_id, event_type, donor_email, metadata_json) VALUES ($1,$2,$3,$4,$5)',
      [t, parseInt(test_id), esc(event_type), donor_email ? esc(donor_email) : null, metadata ? JSON.stringify(metadata) : '{}']
    );

    // Also update the legacy tracking on campaign_ab_tests
    if (event_type === 'impression') {
      await pool.query('UPDATE campaign_ab_tests SET views = views + 1 WHERE id=$1 AND tenant_id=$2', [parseInt(test_id), t]);
    } else if (event_type === 'donation') {
      const amount = metadata ? (parseInt(metadata.amount) || 0) : 0;
      await pool.query('UPDATE campaign_ab_tests SET donations = donations + 1, total_raised = total_raised + $1 WHERE id=$2 AND tenant_id=$3', [amount, parseInt(test_id), t]);
    }

    // Recalculate conversion rate
    await pool.query(
      'UPDATE campaign_ab_tests SET conversion_rate = CASE WHEN views > 0 THEN (donations::NUMERIC / views::NUMERIC) * 100 ELSE 0 END WHERE id=$1 AND tenant_id=$2',
      [parseInt(test_id), t]
    );

    res.json({ success: true, event_type, test_id: parseInt(test_id) });
  }));

  // GET /api/ab-engine/:id/events — get event timeline for a test
  app.get('/api/ab-engine/:id/events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campaignId = parseInt(req.params.id);
    const { event_type, limit, offset } = req.query;

    // Get all test IDs for this campaign
    const testIds = (await pool.query(
      'SELECT id, variant_name FROM campaign_ab_tests WHERE campaign_id=$1 AND tenant_id=$2',
      [campaignId, t]
    )).rows;

    if (testIds.length === 0) return res.status(404).json({ error: 'No A/B tests found' });

    const ids = testIds.map(t => t.id);
    const idMap = {};
    testIds.forEach(t => { idMap[t.id] = t.variant_name; });

    let q = 'SELECT * FROM ab_engine_events WHERE test_id = ANY($1) AND tenant_id=$2';
    const params = [ids, t];
    let idx = 3;
    if (event_type) { q += ' AND event_type=$' + idx; params.push(esc(event_type)); idx++; }
    q += ' ORDER BY created_at DESC';
    const lim = parseInt(limit) || 200;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);

    const result = await pool.query(q, params);
    const events = result.rows.map(e => ({ ...e, variant_name: idMap[e.test_id] || 'unknown' }));
    res.json({ events, total_variants: testIds.length });
  }));

  console.log('[FundraisingUltimate3] Module loaded — 15 Campaign Optimization features');
};
