/**
 * Fundraising Ultimate 2 — Donor Intelligence Module
 * 15 Features: Donor Journey Mapping, Capacity Scoring, Major Gift Pipeline,
 * Prospect Research, Moves Management, Stewardship Plans, Donor Surveys,
 * Churn Predictor, Smart Recommendations, Communication Preferences,
 * Relationship Mapping, Next Best Action, Lifetime Value Calculator,
 * Re-engagement Campaigns, Annual Giving Predictor
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // 1. Donor Journey Mapping
    `CREATE TABLE IF NOT EXISTS donor_journeys (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'awareness' CHECK (stage IN ('awareness','consideration','first_gift','recurring','advocate','lapsed')),
      stage_entered_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 2. Donor Capacity Scoring)
    `CREATE TABLE IF NOT EXISTS donor_capacity_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT,
      capacity_score INTEGER DEFAULT 0,
      capacity_tier TEXT DEFAULT 'unknown' CHECK (capacity_tier IN ('unknown','low','moderate','high','major','transformational')),
      estimated_giving_range TEXT,
      last_calculated TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email)
    )`,

    // 3a. Major Gift Pipeline)
    `CREATE TABLE IF NOT EXISTS major_gift_pipeline (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      campaign_id INTEGER,
      ask_amount INTEGER DEFAULT 0,
      expected_amount INTEGER DEFAULT 0,
      probability NUMERIC(5,2) DEFAULT 0,
      stage TEXT DEFAULT 'identification' CHECK (stage IN ('identification','qualification','cultivation','solicitation','closing','stewardship','lost')),
      target_date DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 3b. Major Gift Activities)
    `CREATE TABLE IF NOT EXISTS major_gift_activities (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      pipeline_id INTEGER REFERENCES major_gift_pipeline(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      notes TEXT,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 4. Prospect Research)
    `CREATE TABLE IF NOT EXISTS prospect_research (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT,
      research_data_json JSONB DEFAULT '{}',
      wealth_indicators JSONB DEFAULT '[]',
      connections JSONB DEFAULT '[]',
      research_status TEXT DEFAULT 'pending' CHECK (research_status IN ('pending','in_progress','completed','needs_update')),
      researched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email)
    )`,

    // 5. Moves Management)
    `CREATE TABLE IF NOT EXISTS moves_management (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      current_stage TEXT DEFAULT 'prospect' CHECK (current_stage IN ('prospect','suspect','prospect_identified','cultivation','solicitation','stewardship','dormant')),
      next_step TEXT,
      assigned_to TEXT,
      target_date DATE,
      completed BOOLEAN DEFAULT false,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 6a. Stewardship Plans)
    `CREATE TABLE IF NOT EXISTS stewardship_plans (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      plan_type TEXT DEFAULT 'general' CHECK (plan_type IN ('general','major_donor','recurring','lapsed','new_donor','mid_level')),
      goals_json JSONB DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','on_hold','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 6b. Stewardship Actions)
    `CREATE TABLE IF NOT EXISTS stewardship_actions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES stewardship_plans(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      completed BOOLEAN DEFAULT false,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7a. Donor Surveys)
    `CREATE TABLE IF NOT EXISTS donor_surveys (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      questions_json JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      responses_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7b. Donor Survey Responses)
    `CREATE TABLE IF NOT EXISTS donor_survey_responses (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      survey_id INTEGER REFERENCES donor_surveys(id) ON DELETE CASCADE,
      respondent_email TEXT NOT NULL,
      responses_json JSONB DEFAULT '{}',
      completed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 8. Donor Churn Predictor)
    `CREATE TABLE IF NOT EXISTS donor_churn_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      churn_probability NUMERIC(5,2) DEFAULT 0,
      risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low','moderate','high','critical')),
      last_donation_days_ago INTEGER DEFAULT 0,
      suggested_action TEXT,
      calculated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email)
    )`,

    // 9. Smart Donor Recommendations)
    `CREATE TABLE IF NOT EXISTS donor_recommendations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      reason TEXT,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      action_taken TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 10. Donor Communication Preferences)
    `CREATE TABLE IF NOT EXISTS donor_comm_prefs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      email_opt_in BOOLEAN DEFAULT true,
      sms_opt_in BOOLEAN DEFAULT false,
      preferred_frequency TEXT DEFAULT 'monthly' CHECK (preferred_frequency IN ('never','weekly','biweekly','monthly','quarterly','yearly')),
      preferred_time TEXT DEFAULT 'morning' CHECK (preferred_time IN ('morning','afternoon','evening','any')),
      preferred_channels_json JSONB DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email)
    )`,

    // 11. Donor Relationship Mapping)
    `CREATE TABLE IF NOT EXISTS donor_relationships (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      related_donor_email TEXT NOT NULL,
      relationship_type TEXT DEFAULT 'colleague' CHECK (relationship_type IN ('family','spouse','colleague','friend','board_member','donor_advised','employer','foundation','other')),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 12. Next Best Action Engine)
    `CREATE TABLE IF NOT EXISTS donor_next_actions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('call','email','meeting','thank_you','ask','invite','survey','follow_up','renewal','upgrade','stewardship','other')),
      action_details TEXT,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      reason TEXT,
      completed BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 13. Donor Lifetime Value Calculator)
    `CREATE TABLE IF NOT EXISTS donor_ltv (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      total_donated INTEGER DEFAULT 0,
      donation_count INTEGER DEFAULT 0,
      avg_donation INTEGER DEFAULT 0,
      first_donation TIMESTAMPTZ,
      last_donation TIMESTAMPTZ,
      predicted_ltv INTEGER DEFAULT 0,
      calculated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email)
    )`,

    // 14a. Re-engagement Campaigns)
    `CREATE TABLE IF NOT EXISTS reengagement_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_criteria JSONB DEFAULT '{}',
      channels_json JSONB DEFAULT '[]',
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','cancelled')),
      total_targeted INTEGER DEFAULT 0,
      total_reengaged INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 14b. Re-engagement Logs)
    `CREATE TABLE IF NOT EXISTS reengagement_logs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES reengagement_campaigns(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      action_taken TEXT,
      result TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 15. Annual Giving Predictor)
    `CREATE TABLE IF NOT EXISTS annual_giving_forecasts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      predicted_total INTEGER DEFAULT 0,
      confidence_level NUMERIC(5,2) DEFAULT 0,
      based_on_years INTEGER DEFAULT 3,
      methodology TEXT DEFAULT 'linear_regression',
      calculated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, year)
    )`,

    // Indexes)
    `CREATE INDEX IF NOT EXISTS idx_donor_journeys_tenant ON donor_journeys(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_journeys_email ON donor_journeys(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_capacity_tenant ON donor_capacity_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_pipeline_tenant ON major_gift_pipeline(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_activities_pipeline ON major_gift_activities(pipeline_id)`,
    `CREATE INDEX IF NOT EXISTS idx_prospect_research_tenant ON prospect_research(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_moves_management_tenant ON moves_management(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stewardship_plans_tenant ON stewardship_plans(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stewardship_actions_plan ON stewardship_actions(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_surveys_tenant ON donor_surveys(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_survey_responses_survey ON donor_survey_responses(survey_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_churn_tenant ON donor_churn_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_recommendations_tenant ON donor_recommendations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_comm_prefs_tenant ON donor_comm_prefs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_relationships_tenant ON donor_relationships(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_next_actions_tenant ON donor_next_actions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_ltv_tenant ON donor_ltv(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reengagement_campaigns_tenant ON reengagement_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reengagement_logs_campaign ON reengagement_logs(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_annual_giving_forecasts_tenant ON annual_giving_forecasts(tenant_id)`,
  ];

  // Run migrations and seed data
  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate2] Migrations complete');

    // Seed: Donor satisfaction survey for each tenant
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        const existing = (await pool.query('SELECT id FROM donor_surveys WHERE tenant_id=$1 AND title=$2', [t.id, 'Donor Satisfaction Survey'])).rows[0];
        if (!existing) {
          await pool.query(`INSERT INTO donor_surveys (tenant_id, title, questions_json, is_active) VALUES ($1, $2, $3, true)`,
            [t.id, 'Donor Satisfaction Survey', JSON.stringify([
              { id: 1, text: 'How satisfied are you with our communication?', type: 'scale', min: 1, max: 5 },
              { id: 2, text: 'How likely are you to donate again?', type: 'scale', min: 1, max: 5 },
              { id: 3, text: 'What is your preferred way to give?', type: 'multiple_choice', options: ['Online', 'Mobile Money', 'Bank Transfer', 'Cash', 'Other'] },
              { id: 4, text: 'What causes matter most to you?', type: 'text' },
              { id: 5, text: 'Any suggestions for improvement?', type: 'text' }
            ])]);
        }
      }

      // Seed: Lapsed donor re-engagement campaign for each tenant
      for (const t of tenants) {
        const existingCamp = (await pool.query('SELECT id FROM reengagement_campaigns WHERE tenant_id=$1 AND name=$2', [t.id, 'Lapsed Donor Re-engagement'])).rows[0];
        if (!existingCamp) {
          await pool.query(`INSERT INTO reengagement_campaigns (tenant_id, name, target_criteria, channels_json, status) VALUES ($1, $2, $3, $4, 'draft')`,
            [t.id, 'Lapsed Donor Re-engagement',
              JSON.stringify({ min_days_inactive: 90, max_days_inactive: 730, min_past_donations: 1 }),
              JSON.stringify(['email', 'sms'])]);
        }
      }

      console.log('[FundraisingUltimate2] Seed data complete');
    } catch(e) { console.warn('[FundraisingUltimate2] Seed error:', e.message); }
  })();

  // =============================================
  // HELPER: Donor Journey Stages
  // =============================================
  const JOURNEY_STAGES = ['awareness', 'consideration', 'first_gift', 'recurring', 'advocate', 'lapsed'];

  // =============================================
  // 1. DONOR JOURNEY MAPPING
  // =============================================

  // GET /api/donor-journeys/stages — list available stages
  app.get('/api/donor-journeys/stages', requireAuth, ah(async (req, res) => {
    res.json({ stages: JOURNEY_STAGES });
  }));

  // GET /api/donor-journeys — list journeys (optional ?email= filter)
  app.get('/api/donor-journeys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { email, stage, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_journeys WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (email) { q += ' AND donor_email=$' + idx; params.push(esc(email)); idx++; }
    if (stage) { q += ' AND stage=$' + idx; params.push(esc(stage)); idx++; }
    q += ' ORDER BY stage_entered_at DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ journeys: result.rows });
  }));

  // POST /api/donor-journeys — create a journey entry
  app.post('/api/donor-journeys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, stage, notes } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    if (stage && !JOURNEY_STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage. Use: ' + JOURNEY_STAGES.join(', ') });
    const result = await pool.query(
      'INSERT INTO donor_journeys (tenant_id, donor_email, stage, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [t, esc(donor_email), stage || 'awareness', notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'donor_journey_created', 'Created journey entry for ' + donor_email + ' at stage ' + (stage || 'awareness'));
    res.json({ journey: result.rows[0] });
  }));

  // PUT /api/donor-journeys — update a journey entry
  app.put('/api/donor-journeys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, stage, notes } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donor_journeys WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Journey entry not found' });
    const newStage = stage || existing.stage;
    if (stage && !JOURNEY_STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
    const result = await pool.query(
      'UPDATE donor_journeys SET stage=$1, notes=$2, stage_entered_at=CASE WHEN $1 != $3 THEN NOW() ELSE stage_entered_at END WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [esc(newStage), notes !== undefined ? esc(notes) : existing.notes, existing.stage, id, t]
    );
    await audit(req.session.user.email, 'donor_journey_updated', 'Updated journey #' + id + ' to stage ' + newStage);
    res.json({ journey: result.rows[0] });
  }));

  // =============================================
  // 2. DONOR CAPACITY SCORING
  // =============================================

  // GET /api/donor-capacity — list capacity scores
  app.get('/api/donor-capacity', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { tier, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_capacity_scores WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (tier) { q += ' AND capacity_tier=$' + idx; params.push(esc(tier)); idx++; }
    q += ' ORDER BY capacity_score DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ scores: result.rows });
  }));

  // POST /api/donor-capacity — create or update a capacity score manually
  app.post('/api/donor-capacity', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, donor_name, capacity_score, capacity_tier, estimated_giving_range } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const validTiers = ['unknown', 'low', 'moderate', 'high', 'major', 'transformational'];
    if (capacity_tier && !validTiers.includes(capacity_tier)) return res.status(400).json({ error: 'Invalid tier' });
    const result = await pool.query(
      `INSERT INTO donor_capacity_scores (tenant_id, donor_email, donor_name, capacity_score, capacity_tier, estimated_giving_range, last_calculated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id, donor_email) DO UPDATE SET donor_name=COALESCE($3, donor_capacity_scores.donor_name), capacity_score=$4, capacity_tier=$5, estimated_giving_range=$6, last_calculated=NOW()
       RETURNING *`,
      [t, esc(donor_email), donor_name ? esc(donor_name) : null, capacity_score || 0, capacity_tier || 'unknown', estimated_giving_range ? esc(estimated_giving_range) : null]
    );
    await audit(req.session.user.email, 'donor_capacity_set', 'Set capacity for ' + donor_email + ' tier=' + (capacity_tier || 'unknown'));
    res.json({ score: result.rows[0] });
  }));

  // POST /api/donor-capacity/calculate — auto-calculate capacity scores from donation data
  app.post('/api/donor-capacity/calculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    // Gather donor stats from campaign_donations (best-effort across tenants since we only have tenant_id on campaigns)
    try {
      const donorStats = (await pool.query(`
        SELECT cd.donor_name, cd.donor_email,
          COALESCE(SUM(cd.amount), 0) as total_donated,
          COUNT(*) as donation_count,
          COALESCE(AVG(cd.amount), 0) as avg_donation,
          MAX(cd.donated_at) as last_donation
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
        GROUP BY cd.donor_email, cd.donor_name
      `, [t])).rows;

      let calculated = 0;
      for (const d of donorStats) {
        if (!d.donor_email) continue;
        const total = parseInt(d.total_donated) || 0;
        const count = parseInt(d.donation_count) || 0;
        const avg = parseInt(d.avg_donation) || 0;

        // Capacity score: weighted composite
        let score = Math.min(100, Math.round(
          (Math.log10(total + 1) * 15) +
          (count * 2) +
          (Math.log10(avg + 1) * 10)
        ));

        let tier = 'unknown';
        if (score >= 80) tier = 'transformational';
        else if (score >= 60) tier = 'major';
        else if (score >= 40) tier = 'high';
        else if (score >= 25) tier = 'moderate';
        else if (score >= 10) tier = 'low';

        let givingRange = '';
        if (tier === 'transformational') givingRange = 'UGX 50,000,000+';
        else if (tier === 'major') givingRange = 'UGX 10,000,000 - 50,000,000';
        else if (tier === 'high') givingRange = 'UGX 5,000,000 - 10,000,000';
        else if (tier === 'moderate') givingRange = 'UGX 1,000,000 - 5,000,000';
        else if (tier === 'low') givingRange = 'UGX 0 - 1,000,000';

        await pool.query(
          `INSERT INTO donor_capacity_scores (tenant_id, donor_email, donor_name, capacity_score, capacity_tier, estimated_giving_range, last_calculated)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (tenant_id, donor_email) DO UPDATE SET donor_name=COALESCE($3, donor_capacity_scores.donor_name), capacity_score=$4, capacity_tier=$5, estimated_giving_range=$6, last_calculated=NOW()`,
          [t, esc(d.donor_email), d.donor_name ? esc(d.donor_name) : null, score, tier, givingRange]
        );
        calculated++;
      }
      await audit(req.session.user.email, 'donor_capacity_calculated', 'Calculated capacity scores for ' + calculated + ' donors');
      res.json({ message: 'Calculated capacity for ' + calculated + ' donors', count: calculated });
    } catch(e) {
      // Fallback if campaign_donations table doesn't have expected columns
      res.json({ message: 'Calculation attempted', count: 0, note: 'Ensure donation data exists' });
    }
  }));

  // =============================================
  // 3. MAJOR GIFT PIPELINE
  // =============================================

  // GET /api/major-gift-pipeline — list pipeline entries
  app.get('/api/major-gift-pipeline', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { stage, donor_email } = req.query;
    let q = 'SELECT * FROM major_gift_pipeline WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (stage) { q += ' AND stage=$' + idx; params.push(esc(stage)); idx++; }
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ pipeline: result.rows });
  }));

  // POST /api/major-gift-pipeline — create pipeline entry
  app.post('/api/major-gift-pipeline', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, campaign_id, ask_amount, expected_amount, probability, stage, target_date } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const validStages = ['identification', 'qualification', 'cultivation', 'solicitation', 'closing', 'stewardship', 'lost'];
    if (stage && !validStages.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
    const result = await pool.query(
      'INSERT INTO major_gift_pipeline (tenant_id, donor_email, campaign_id, ask_amount, expected_amount, probability, stage, target_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [t, esc(donor_email), campaign_id || null, ask_amount || 0, expected_amount || 0, probability || 0, stage || 'identification', target_date || null]
    );
    await audit(req.session.user.email, 'major_gift_created', 'Created major gift pipeline entry for ' + donor_email);
    res.json({ entry: result.rows[0] });
  }));

  // PUT /api/major-gift-pipeline — update pipeline entry
  app.put('/api/major-gift-pipeline', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, donor_email, campaign_id, ask_amount, expected_amount, probability, stage, target_date } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Pipeline entry not found' });
    const result = await pool.query(
      'UPDATE major_gift_pipeline SET donor_email=$1, campaign_id=$2, ask_amount=$3, expected_amount=$4, probability=$5, stage=$6, target_date=$7 WHERE id=$8 AND tenant_id=$9 RETURNING *',
      [esc(donor_email || existing.donor_email), campaign_id !== undefined ? campaign_id : existing.campaign_id,
       ask_amount !== undefined ? ask_amount : existing.ask_amount,
       expected_amount !== undefined ? expected_amount : existing.expected_amount,
       probability !== undefined ? probability : existing.probability,
       stage || existing.stage, target_date !== undefined ? target_date : existing.target_date, id, t]
    );
    await audit(req.session.user.email, 'major_gift_updated', 'Updated major gift pipeline #' + id);
    res.json({ entry: result.rows[0] });
  }));

  // DELETE /api/major-gift-pipeline — delete pipeline entry
  app.delete('/api/major-gift-pipeline', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Pipeline entry not found' });
    await pool.query('DELETE FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'major_gift_deleted', 'Deleted major gift pipeline #' + id);
    res.json({ success: true });
  }));

  // POST /api/major-gift-pipeline/:id/activities — add activity to pipeline
  app.post('/api/major-gift-pipeline/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pipelineId = parseInt(req.params.id);
    const pipeline = (await pool.query('SELECT * FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [pipelineId, t])).rows[0];
    if (!pipeline) return res.status(404).json({ error: 'Pipeline entry not found' });
    const { activity_type, notes } = req.body;
    if (!activity_type) return res.status(400).json({ error: 'activity_type is required' });
    const result = await pool.query(
      'INSERT INTO major_gift_activities (tenant_id, pipeline_id, activity_type, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [t, pipelineId, esc(activity_type), notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'major_gift_activity_added', 'Added activity to pipeline #' + pipelineId);
    res.json({ activity: result.rows[0] });
  }));

  // GET /api/major-gift-pipeline/:id/activities — list activities for pipeline
  app.get('/api/major-gift-pipeline/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pipelineId = parseInt(req.params.id);
    const pipeline = (await pool.query('SELECT * FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [pipelineId, t])).rows[0];
    if (!pipeline) return res.status(404).json({ error: 'Pipeline entry not found' });
    const result = await pool.query('SELECT * FROM major_gift_activities WHERE pipeline_id=$1 AND tenant_id=$2 ORDER BY completed_at DESC', [pipelineId, t]);
    res.json({ activities: result.rows });
  }));

  // =============================================
  // 4. PROSPECT RESEARCH
  // =============================================

  // GET /api/prospect-research — list prospect research records
  app.get('/api/prospect-research', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { status, email } = req.query;
    let q = 'SELECT * FROM prospect_research WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (status) { q += ' AND research_status=$' + idx; params.push(esc(status)); idx++; }
    if (email) { q += ' AND donor_email=$' + idx; params.push(esc(email)); idx++; }
    q += ' ORDER BY researched_at DESC NULLS LAST';
    const result = await pool.query(q, params);
    res.json({ prospects: result.rows });
  }));

  // POST /api/prospect-research — create a prospect research record
  app.post('/api/prospect-research', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, donor_name, research_data_json, wealth_indicators, connections, research_status } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const result = await pool.query(
      `INSERT INTO prospect_research (tenant_id, donor_email, donor_name, research_data_json, wealth_indicators, connections, research_status, researched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (tenant_id, donor_email) DO UPDATE SET donor_name=COALESCE($3, prospect_research.donor_name), research_data_json=$4, wealth_indicators=$5, connections=$6, research_status=$7, researched_at=NOW()
       RETURNING *`,
      [t, esc(donor_email), donor_name ? esc(donor_name) : null,
       research_data_json ? JSON.stringify(research_data_json) : '{}',
       wealth_indicators ? JSON.stringify(wealth_indicators) : '[]',
       connections ? JSON.stringify(connections) : '[]',
       research_status || 'pending']
    );
    await audit(req.session.user.email, 'prospect_research_created', 'Created/updated prospect research for ' + donor_email);
    res.json({ prospect: result.rows[0] });
  }));

  // PUT /api/prospect-research — update a prospect research record
  app.put('/api/prospect-research', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, donor_name, research_data_json, wealth_indicators, connections, research_status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM prospect_research WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Prospect research not found' });
    const result = await pool.query(
      'UPDATE prospect_research SET donor_name=$1, research_data_json=$2, wealth_indicators=$3, connections=$4, research_status=$5, researched_at=NOW() WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [donor_name ? esc(donor_name) : existing.donor_name,
       research_data_json ? JSON.stringify(research_data_json) : existing.research_data_json,
       wealth_indicators ? JSON.stringify(wealth_indicators) : existing.wealth_indicators,
       connections ? JSON.stringify(connections) : existing.connections,
       research_status || existing.research_status, id, t]
    );
    await audit(req.session.user.email, 'prospect_research_updated', 'Updated prospect research #' + id);
    res.json({ prospect: result.rows[0] });
  }));

  // =============================================
  // 5. MOVES MANAGEMENT
  // =============================================

  // GET /api/moves-management — list moves
  app.get('/api/moves-management', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { current_stage, assigned_to, completed } = req.query;
    let q = 'SELECT * FROM moves_management WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (current_stage) { q += ' AND current_stage=$' + idx; params.push(esc(current_stage)); idx++; }
    if (assigned_to) { q += ' AND assigned_to=$' + idx; params.push(esc(assigned_to)); idx++; }
    if (completed !== undefined) { q += ' AND completed=$' + idx; params.push(completed === 'true'); idx++; }
    q += ' ORDER BY target_date ASC NULLS LAST, created_at DESC';
    const result = await pool.query(q, params);
    res.json({ moves: result.rows });
  }));

  // POST /api/moves-management — create a move
  app.post('/api/moves-management', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, current_stage, next_step, assigned_to, target_date, completed, notes } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const validStages = ['prospect', 'suspect', 'prospect_identified', 'cultivation', 'solicitation', 'stewardship', 'dormant'];
    if (current_stage && !validStages.includes(current_stage)) return res.status(400).json({ error: 'Invalid stage' });
    const result = await pool.query(
      'INSERT INTO moves_management (tenant_id, donor_email, current_stage, next_step, assigned_to, target_date, completed, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [t, esc(donor_email), current_stage || 'prospect', next_step ? esc(next_step) : null,
       assigned_to ? esc(assigned_to) : null, target_date || null, completed || false, notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'moves_management_created', 'Created move for ' + donor_email);
    res.json({ move: result.rows[0] });
  }));

  // PUT /api/moves-management — update a move
  app.put('/api/moves-management', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, current_stage, next_step, assigned_to, target_date, completed, notes } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM moves_management WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Move not found' });
    const result = await pool.query(
      'UPDATE moves_management SET current_stage=$1, next_step=$2, assigned_to=$3, target_date=$4, completed=$5, notes=$6 WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [current_stage || existing.current_stage, next_step !== undefined ? esc(next_step) : existing.next_step,
       assigned_to !== undefined ? esc(assigned_to) : existing.assigned_to,
       target_date !== undefined ? target_date : existing.target_date,
       completed !== undefined ? completed : existing.completed,
       notes !== undefined ? esc(notes) : existing.notes, id, t]
    );
    await audit(req.session.user.email, 'moves_management_updated', 'Updated move #' + id);
    res.json({ move: result.rows[0] });
  }));

  // POST /api/moves/:id/advance — advance a move to the next stage
  app.post('/api/moves/:id/advance', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const moveId = parseInt(req.params.id);
    const { next_step, notes } = req.body;
    const existing = (await pool.query('SELECT * FROM moves_management WHERE id=$1 AND tenant_id=$2', [moveId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Move not found' });

    const stageOrder = ['prospect', 'suspect', 'prospect_identified', 'cultivation', 'solicitation', 'stewardship', 'dormant'];
    const currentIdx = stageOrder.indexOf(existing.current_stage);
    if (currentIdx === -1 || currentIdx >= stageOrder.length - 1) {
      return res.status(400).json({ error: 'Cannot advance further. Already at final stage or dormant.' });
    }
    const nextStage = stageOrder[currentIdx + 1];
    const result = await pool.query(
      'UPDATE moves_management SET current_stage=$1, next_step=$2, notes=$3 WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [nextStage, next_step ? esc(next_step) : existing.next_step, notes ? esc(notes) : existing.notes, moveId, t]
    );
    await audit(req.session.user.email, 'moves_management_advanced', 'Advanced move #' + moveId + ' from ' + existing.current_stage + ' to ' + nextStage);
    // Notify assigned user
    if (existing.assigned_to) {
      notify(t, existing.assigned_to, 'Move Advanced', 'Donor ' + existing.donor_email + ' moved from ' + existing.current_stage + ' to ' + nextStage, 'fundraising');
    }
    res.json({ move: result.rows[0] });
  }));

  // =============================================
  // 6. STEWARDSHIP PLANS
  // =============================================

  // GET /api/stewardship-plans — list plans
  app.get('/api/stewardship-plans', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { status, donor_email } = req.query;
    let q = 'SELECT * FROM stewardship_plans WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ plans: result.rows });
  }));

  // POST /api/stewardship-plans — create plan
  app.post('/api/stewardship-plans', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, plan_type, goals_json, status } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const result = await pool.query(
      'INSERT INTO stewardship_plans (tenant_id, donor_email, plan_type, goals_json, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [t, esc(donor_email), plan_type || 'general', goals_json ? JSON.stringify(goals_json) : '[]', status || 'active']
    );
    await audit(req.session.user.email, 'stewardship_plan_created', 'Created stewardship plan for ' + donor_email);
    res.json({ plan: result.rows[0] });
  }));

  // PUT /api/stewardship-plans — update plan
  app.put('/api/stewardship-plans', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, plan_type, goals_json, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM stewardship_plans WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Plan not found' });
    const result = await pool.query(
      'UPDATE stewardship_plans SET plan_type=$1, goals_json=$2, status=$3 WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [plan_type || existing.plan_type, goals_json ? JSON.stringify(goals_json) : existing.goals_json, status || existing.status, id, t]
    );
    await audit(req.session.user.email, 'stewardship_plan_updated', 'Updated stewardship plan #' + id);
    res.json({ plan: result.rows[0] });
  }));

  // GET /api/stewardship-plans/:id/actions — list actions for a plan
  app.get('/api/stewardship-plans/:id/actions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const planId = parseInt(req.params.id);
    const plan = (await pool.query('SELECT * FROM stewardship_plans WHERE id=$1 AND tenant_id=$2', [planId, t])).rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const result = await pool.query('SELECT * FROM stewardship_actions WHERE plan_id=$1 AND tenant_id=$2 ORDER BY due_date ASC NULLS LAST, created_at DESC', [planId, t]);
    res.json({ actions: result.rows });
  }));

  // POST /api/stewardship-plans/:id/actions — add action to plan
  app.post('/api/stewardship-plans/:id/actions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const planId = parseInt(req.params.id);
    const plan = (await pool.query('SELECT * FROM stewardship_plans WHERE id=$1 AND tenant_id=$2', [planId, t])).rows[0];
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const { action_type, description, due_date } = req.body;
    if (!action_type) return res.status(400).json({ error: 'action_type is required' });
    const result = await pool.query(
      'INSERT INTO stewardship_actions (tenant_id, plan_id, action_type, description, due_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [t, planId, esc(action_type), description ? esc(description) : null, due_date || null]
    );
    await audit(req.session.user.email, 'stewardship_action_added', 'Added stewardship action to plan #' + planId);
    res.json({ action: result.rows[0] });
  }));

  // PUT /api/stewardship-actions/:id/complete — mark an action as completed
  app.put('/api/stewardship-actions/:id/complete', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const actionId = parseInt(req.params.id);
    const existing = (await pool.query('SELECT * FROM stewardship_actions WHERE id=$1 AND tenant_id=$2', [actionId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Action not found' });
    const result = await pool.query(
      'UPDATE stewardship_actions SET completed=true, completed_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *',
      [actionId, t]
    );
    await audit(req.session.user.email, 'stewardship_action_completed', 'Completed stewardship action #' + actionId);
    res.json({ action: result.rows[0] });
  }));

  // =============================================
  // 7. DONOR SURVEYS
  // =============================================

  // GET /api/donor-surveys — list surveys
  app.get('/api/donor-surveys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { is_active } = req.query;
    let q = 'SELECT * FROM donor_surveys WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (is_active !== undefined) { q += ' AND is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ surveys: result.rows });
  }));

  // POST /api/donor-surveys — create survey
  app.post('/api/donor-surveys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, questions_json, is_active } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const result = await pool.query(
      'INSERT INTO donor_surveys (tenant_id, title, questions_json, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [t, esc(title), questions_json ? JSON.stringify(questions_json) : '[]', is_active !== false]
    );
    await audit(req.session.user.email, 'donor_survey_created', 'Created survey: ' + title);
    res.json({ survey: result.rows[0] });
  }));

  // PUT /api/donor-surveys — update survey
  app.put('/api/donor-surveys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, title, questions_json, is_active } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Survey not found' });
    const result = await pool.query(
      'UPDATE donor_surveys SET title=$1, questions_json=$2, is_active=$3 WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [title ? esc(title) : existing.title, questions_json ? JSON.stringify(questions_json) : existing.questions_json,
       is_active !== undefined ? is_active : existing.is_active, id, t]
    );
    await audit(req.session.user.email, 'donor_survey_updated', 'Updated survey #' + id);
    res.json({ survey: result.rows[0] });
  }));

  // DELETE /api/donor-surveys — delete survey
  app.delete('/api/donor-surveys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Survey not found' });
    await pool.query('DELETE FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donor_survey_deleted', 'Deleted survey #' + id);
    res.json({ success: true });
  }));

  // POST /api/donor-surveys/:id/respond — submit a survey response
  app.post('/api/donor-surveys/:id/respond', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const surveyId = parseInt(req.params.id);
    const survey = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [surveyId, t])).rows[0];
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (!survey.is_active) return res.status(400).json({ error: 'Survey is not active' });
    const { respondent_email, responses_json } = req.body;
    if (!respondent_email) return res.status(400).json({ error: 'respondent_email is required' });
    if (!responses_json) return res.status(400).json({ error: 'responses_json is required' });
    const result = await pool.query(
      'INSERT INTO donor_survey_responses (tenant_id, survey_id, respondent_email, responses_json) VALUES ($1, $2, $3, $4) RETURNING *',
      [t, surveyId, esc(respondent_email), JSON.stringify(responses_json)]
    );
    // Increment responses_count
    await pool.query('UPDATE donor_surveys SET responses_count = responses_count + 1 WHERE id=$1 AND tenant_id=$2', [surveyId, t]);
    res.json({ response: result.rows[0] });
  }));

  // GET /api/donor-surveys/:id/results — get survey results/aggregation
  app.get('/api/donor-surveys/:id/results', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const surveyId = parseInt(req.params.id);
    const survey = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [surveyId, t])).rows[0];
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    const responses = (await pool.query('SELECT * FROM donor_survey_responses WHERE survey_id=$1 AND tenant_id=$2 ORDER BY completed_at DESC', [surveyId, t])).rows;

    // Aggregate results per question
    const questions = Array.isArray(survey.questions_json) ? survey.questions_json : [];
    const aggregated = {};
    for (const q of questions) {
      if (q.id) {
        const answers = responses.map(r => {
          const resp = typeof r.responses_json === 'string' ? JSON.parse(r.responses_json) : (r.responses_json || {});
          return resp[q.id];
        }).filter(a => a !== undefined && a !== null);

        if (q.type === 'scale') {
          const nums = answers.map(Number).filter(n => !isNaN(n));
          aggregated[q.id] = {
            question: q.text,
            type: q.type,
            count: nums.length,
            average: nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : 0,
            min: nums.length ? Math.min(...nums) : 0,
            max: nums.length ? Math.max(...nums) : 0,
          };
        } else if (q.type === 'multiple_choice') {
          const counts = {};
          answers.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
          aggregated[q.id] = { question: q.text, type: q.type, count: answers.length, distribution: counts };
        } else {
          aggregated[q.id] = { question: q.text, type: q.type, count: answers.length, responses: answers.slice(0, 50) };
        }
      }
    }

    res.json({ survey: { id: survey.id, title: survey.title, total_responses: responses.length }, aggregated, raw_responses: responses });
  }));

  // =============================================
  // 8. DONOR CHURN PREDICTOR
  // =============================================

  // GET /api/donor-churn — list churn scores
  app.get('/api/donor-churn', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { risk_level, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_churn_scores WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (risk_level) { q += ' AND risk_level=$' + idx; params.push(esc(risk_level)); idx++; }
    q += ' ORDER BY churn_probability DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ churn_scores: result.rows });
  }));

  // POST /api/donor-churn/calculate — calculate churn scores for all donors
  app.post('/api/donor-churn/calculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    try {
      const donorStats = (await pool.query(`
        SELECT cd.donor_email,
          COALESCE(SUM(cd.amount), 0) as total_donated,
          COUNT(*) as donation_count,
          MAX(cd.donated_at) as last_donation,
          MIN(cd.donated_at) as first_donation
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
        GROUP BY cd.donor_email
      `, [t])).rows;

      let calculated = 0;
      const now = Date.now();
      for (const d of donorStats) {
        if (!d.donor_email) continue;
        const lastDonation = d.last_donation ? new Date(d.last_donation) : null;
        const firstDonation = d.first_donation ? new Date(d.first_donation) : null;
        const daysSinceLast = lastDonation ? Math.floor((now - lastDonation.getTime()) / (1000 * 60 * 60 * 24)) : 999;
        const total = parseInt(d.total_donated) || 0;
        const count = parseInt(d.donation_count) || 0;

        // Churn probability model (simplified heuristic)
        let churnProb = 0;
        // Time since last donation (biggest factor)
        if (daysSinceLast > 365) churnProb += 60;
        else if (daysSinceLast > 180) churnProb += 40;
        else if (daysSinceLast > 90) churnProb += 20;
        else if (daysSinceLast > 60) churnProb += 10;
        // Single donation donors are more likely to churn
        if (count === 1) churnProb += 20;
        else if (count <= 3) churnProb += 10;
        // Low engagement
        if (total < 50000) churnProb += 10;
        // Decay: if donor has been giving a long time, slightly lower churn
        if (firstDonation) {
          const donorSinceDays = Math.floor((now - firstDonation.getTime()) / (1000 * 60 * 60 * 24));
          if (donorSinceDays > 730 && count > 3) churnProb -= 15;
        }
        churnProb = Math.max(0, Math.min(100, churnProb));

        let riskLevel = 'low';
        if (churnProb >= 70) riskLevel = 'critical';
        else if (churnProb >= 50) riskLevel = 'high';
        else if (churnProb >= 30) riskLevel = 'moderate';

        let suggestedAction = '';
        if (riskLevel === 'critical') suggestedAction = 'Immediate personal outreach — call or visit';
        else if (riskLevel === 'high') suggestedAction = 'Send personalized re-engagement email and impact report';
        else if (riskLevel === 'moderate') suggestedAction = 'Send stewardship update and invitation to upcoming event';
        else suggestedAction = 'Continue regular stewardship communications';

        await pool.query(
          `INSERT INTO donor_churn_scores (tenant_id, donor_email, churn_probability, risk_level, last_donation_days_ago, suggested_action, calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (tenant_id, donor_email) DO UPDATE SET churn_probability=$3, risk_level=$4, last_donation_days_ago=$5, suggested_action=$6, calculated_at=NOW()`,
          [t, esc(d.donor_email), churnProb, riskLevel, daysSinceLast, suggestedAction]
        );
        calculated++;
      }
      await audit(req.session.user.email, 'donor_churn_calculated', 'Calculated churn for ' + calculated + ' donors');
      res.json({ message: 'Calculated churn for ' + calculated + ' donors', count: calculated });
    } catch(e) {
      res.json({ message: 'Calculation attempted', count: 0, note: 'Ensure donation data exists' });
    }
  }));

  // =============================================
  // 9. SMART DONOR RECOMMENDATIONS
  // =============================================

  // GET /api/donor-recommendations — list recommendations
  app.get('/api/donor-recommendations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { priority, donor_email, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_recommendations WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (priority) { q += ' AND priority=$' + idx; params.push(esc(priority)); idx++; }
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    q += ' ORDER BY CASE priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END, created_at DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ recommendations: result.rows });
  }));

  // POST /api/donor-recommendations — create a recommendation
  app.post('/api/donor-recommendations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, recommended_action, reason, priority } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    if (!recommended_action) return res.status(400).json({ error: 'recommended_action is required' });
    const result = await pool.query(
      'INSERT INTO donor_recommendations (tenant_id, donor_email, recommended_action, reason, priority) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [t, esc(donor_email), esc(recommended_action), reason ? esc(reason) : null, priority || 'medium']
    );
    res.json({ recommendation: result.rows[0] });
  }));

  // POST /api/donor-recommendations/:id/act — mark that action was taken on a recommendation
  app.post('/api/donor-recommendations/:id/act', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const recId = parseInt(req.params.id);
    const { action_taken } = req.body;
    const existing = (await pool.query('SELECT * FROM donor_recommendations WHERE id=$1 AND tenant_id=$2', [recId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Recommendation not found' });
    const result = await pool.query(
      'UPDATE donor_recommendations SET action_taken=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [action_taken ? esc(action_taken) : 'acted upon', recId, t]
    );
    await audit(req.session.user.email, 'donor_recommendation_acted', 'Acted on recommendation #' + recId + ' for ' + existing.donor_email);
    res.json({ recommendation: result.rows[0] });
  }));

  // =============================================
  // 10. DONOR COMMUNICATION PREFERENCES
  // =============================================

  // GET /api/donor-comm-prefs/:email — get preferences for a donor
  app.get('/api/donor-comm-prefs/:email', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = req.params.email;
    let prefs = (await pool.query('SELECT * FROM donor_comm_prefs WHERE donor_email=$1 AND tenant_id=$2', [esc(email), t])).rows[0];
    if (!prefs) {
      // Return defaults
      prefs = {
        donor_email: email,
        email_opt_in: true,
        sms_opt_in: false,
        preferred_frequency: 'monthly',
        preferred_time: 'morning',
        preferred_channels_json: ['email'],
      };
    }
    res.json({ preferences: prefs });
  }));

  // PUT /api/donor-comm-prefs/:email — update preferences
  app.put('/api/donor-comm-prefs/:email', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = esc(req.params.email);
    const { email_opt_in, sms_opt_in, preferred_frequency, preferred_time, preferred_channels_json } = req.body;
    const validFreq = ['never', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
    const validTime = ['morning', 'afternoon', 'evening', 'any'];
    if (preferred_frequency && !validFreq.includes(preferred_frequency)) return res.status(400).json({ error: 'Invalid preferred_frequency' });
    if (preferred_time && !validTime.includes(preferred_time)) return res.status(400).json({ error: 'Invalid preferred_time' });

    const result = await pool.query(
      `INSERT INTO donor_comm_prefs (tenant_id, donor_email, email_opt_in, sms_opt_in, preferred_frequency, preferred_time, preferred_channels_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (tenant_id, donor_email) DO UPDATE SET email_opt_in=$3, sms_opt_in=$4, preferred_frequency=$5, preferred_time=$6, preferred_channels_json=$7, updated_at=NOW()
       RETURNING *`,
      [t, email, email_opt_in !== undefined ? email_opt_in : true, sms_opt_in !== undefined ? sms_opt_in : false,
       preferred_frequency || 'monthly', preferred_time || 'morning',
       preferred_channels_json ? JSON.stringify(preferred_channels_json) : '["email"]']
    );
    await audit(req.session.user.email, 'donor_comm_prefs_updated', 'Updated comm prefs for ' + email);
    res.json({ preferences: result.rows[0] });
  }));

  // =============================================
  // 11. DONOR RELATIONSHIP MAPPING
  // =============================================

  // GET /api/donor-relationships — list relationships
  app.get('/api/donor-relationships', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, relationship_type } = req.query;
    let q = 'SELECT * FROM donor_relationships WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND (donor_email=$' + idx + ' OR related_donor_email=$' + idx + ')'; params.push(esc(donor_email)); idx++; }
    if (relationship_type) { q += ' AND relationship_type=$' + idx; params.push(esc(relationship_type)); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ relationships: result.rows });
  }));

  // POST /api/donor-relationships — create a relationship
  app.post('/api/donor-relationships', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, related_donor_email, relationship_type, notes } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    if (!related_donor_email) return res.status(400).json({ error: 'related_donor_email is required' });
    if (donor_email === related_donor_email) return res.status(400).json({ error: 'Cannot relate donor to themselves' });
    const validTypes = ['family', 'spouse', 'colleague', 'friend', 'board_member', 'donor_advised', 'employer', 'foundation', 'other'];
    if (relationship_type && !validTypes.includes(relationship_type)) return res.status(400).json({ error: 'Invalid relationship_type' });
    const result = await pool.query(
      'INSERT INTO donor_relationships (tenant_id, donor_email, related_donor_email, relationship_type, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [t, esc(donor_email), esc(related_donor_email), relationship_type || 'colleague', notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'donor_relationship_created', 'Created relationship: ' + donor_email + ' - ' + related_donor_email);
    res.json({ relationship: result.rows[0] });
  }));

  // DELETE /api/donor-relationships — delete a relationship
  app.delete('/api/donor-relationships', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM donor_relationships WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Relationship not found' });
    await pool.query('DELETE FROM donor_relationships WHERE id=$1 AND tenant_id=$2', [id, t]);
    await audit(req.session.user.email, 'donor_relationship_deleted', 'Deleted relationship #' + id);
    res.json({ success: true });
  }));

  // =============================================
  // 12. NEXT BEST ACTION ENGINE
  // =============================================

  // GET /api/next-actions — list next actions
  app.get('/api/next-actions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, action_type, priority, completed, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_next_actions WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    if (action_type) { q += ' AND action_type=$' + idx; params.push(esc(action_type)); idx++; }
    if (priority) { q += ' AND priority=$' + idx; params.push(esc(priority)); idx++; }
    if (completed !== undefined) { q += ' AND completed=$' + idx; params.push(completed === 'true'); idx++; }
    q += ' ORDER BY CASE priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END, created_at DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json({ actions: result.rows });
  }));

  // POST /api/next-actions — create a next action
  app.post('/api/next-actions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, action_type, action_details, priority, reason } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    if (!action_type) return res.status(400).json({ error: 'action_type is required' });
    const validTypes = ['call', 'email', 'meeting', 'thank_you', 'ask', 'invite', 'survey', 'follow_up', 'renewal', 'upgrade', 'stewardship', 'other'];
    if (!validTypes.includes(action_type)) return res.status(400).json({ error: 'Invalid action_type. Use: ' + validTypes.join(', ') });
    const result = await pool.query(
      'INSERT INTO donor_next_actions (tenant_id, donor_email, action_type, action_details, priority, reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [t, esc(donor_email), esc(action_type), action_details ? esc(action_details) : null, priority || 'medium', reason ? esc(reason) : null]
    );
    res.json({ action: result.rows[0] });
  }));

  // POST /api/next-actions/:id/complete — mark action as completed
  app.post('/api/next-actions/:id/complete', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const actionId = parseInt(req.params.id);
    const existing = (await pool.query('SELECT * FROM donor_next_actions WHERE id=$1 AND tenant_id=$2', [actionId, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Action not found' });
    const result = await pool.query(
      'UPDATE donor_next_actions SET completed=true WHERE id=$1 AND tenant_id=$2 RETURNING *',
      [actionId, t]
    );
    await audit(req.session.user.email, 'next_action_completed', 'Completed next action #' + actionId + ' for ' + existing.donor_email);
    res.json({ action: result.rows[0] });
  }));

  // =============================================
  // 13. DONOR LIFETIME VALUE CALCULATOR
  // =============================================

  // GET /api/donor-ltv — list LTV records
  app.get('/api/donor-ltv', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, limit, offset } = req.query;
    let q = 'SELECT * FROM donor_ltv WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    q += ' ORDER BY predicted_ltv DESC';
    const lim = parseInt(limit) || 100;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    // Summary stats
    const summary = (await pool.query('SELECT COALESCE(SUM(total_donated),0) as total, COALESCE(SUM(predicted_ltv),0) as predicted_total, COUNT(*) as donor_count, COALESCE(AVG(predicted_ltv),0) as avg_ltv FROM donor_ltv WHERE tenant_id=$1', [t])).rows[0];
    res.json({ ltv_records: result.rows, summary });
  }));

  // POST /api/donor-ltv/calculate — calculate LTV for all donors
  app.post('/api/donor-ltv/calculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    try {
      const donorStats = (await pool.query(`
        SELECT cd.donor_email,
          COALESCE(SUM(cd.amount), 0) as total_donated,
          COUNT(*) as donation_count,
          COALESCE(AVG(cd.amount), 0) as avg_donation,
          MIN(cd.donated_at) as first_donation,
          MAX(cd.donated_at) as last_donation
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
        GROUP BY cd.donor_email
      `, [t])).rows;

      let calculated = 0;
      const now = Date.now();
      for (const d of donorStats) {
        if (!d.donor_email) continue;
        const total = parseInt(d.total_donated) || 0;
        const count = parseInt(d.donation_count) || 0;
        const avg = parseInt(d.avg_donation) || 0;
        const firstDonation = d.first_donation ? new Date(d.first_donation) : null;
        const lastDonation = d.last_donation ? new Date(d.last_donation) : null;

        // LTV prediction model
        let predictedLtv = total; // Base: what they've given so far
        if (firstDonation) {
          const donorSinceMonths = Math.max(1, Math.floor((now - firstDonation.getTime()) / (1000 * 60 * 60 * 24 * 30)));
          const avgMonthly = total / donorSinceMonths;
          // Predict next 36 months (3-year forward LTV)
          // Adjust by retention factors
          const daysSinceLast = lastDonation ? Math.floor((now - lastDonation.getTime()) / (1000 * 60 * 60 * 24)) : 999;
          let retentionFactor = 1.0;
          if (daysSinceLast > 365) retentionFactor = 0.3;
          else if (daysSinceLast > 180) retentionFactor = 0.5;
          else if (daysSinceLast > 90) retentionFactor = 0.7;
          else retentionFactor = 0.9;

          // Repeat donors get a boost
          if (count > 3) retentionFactor += 0.1;
          if (count > 10) retentionFactor += 0.1;
          retentionFactor = Math.min(retentionFactor, 1.0);

          predictedLtv = Math.round(total + (avgMonthly * 36 * retentionFactor));
        }

        await pool.query(
          `INSERT INTO donor_ltv (tenant_id, donor_email, total_donated, donation_count, avg_donation, first_donation, last_donation, predicted_ltv, calculated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (tenant_id, donor_email) DO UPDATE SET total_donated=$3, donation_count=$4, avg_donation=$5, first_donation=$6, last_donation=$7, predicted_ltv=$8, calculated_at=NOW()`,
          [t, esc(d.donor_email), total, count, avg, firstDonation, lastDonation, predictedLtv]
        );
        calculated++;
      }
      await audit(req.session.user.email, 'donor_ltv_calculated', 'Calculated LTV for ' + calculated + ' donors');
      res.json({ message: 'Calculated LTV for ' + calculated + ' donors', count: calculated });
    } catch(e) {
      res.json({ message: 'Calculation attempted', count: 0, note: 'Ensure donation data exists' });
    }
  }));

  // =============================================
  // 14. DONOR RE-ENGAGEMENT CAMPAIGNS
  // =============================================

  // GET /api/reengagement-campaigns — list campaigns
  app.get('/api/reengagement-campaigns', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { status } = req.query;
    let q = 'SELECT * FROM reengagement_campaigns WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ campaigns: result.rows });
  }));

  // POST /api/reengagement-campaigns — create campaign
  app.post('/api/reengagement-campaigns', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, target_criteria, channels_json, status } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO reengagement_campaigns (tenant_id, name, target_criteria, channels_json, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [t, esc(name), target_criteria ? JSON.stringify(target_criteria) : '{}', channels_json ? JSON.stringify(channels_json) : '[]', status || 'draft']
    );
    await audit(req.session.user.email, 'reengagement_campaign_created', 'Created re-engagement campaign: ' + name);
    res.json({ campaign: result.rows[0] });
  }));

  // PUT /api/reengagement-campaigns — update campaign
  app.put('/api/reengagement-campaigns', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { id, name, target_criteria, channels_json, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const existing = (await pool.query('SELECT * FROM reengagement_campaigns WHERE id=$1 AND tenant_id=$2', [id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    const result = await pool.query(
      'UPDATE reengagement_campaigns SET name=$1, target_criteria=$2, channels_json=$3, status=$4 WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : existing.name, target_criteria ? JSON.stringify(target_criteria) : existing.target_criteria,
       channels_json ? JSON.stringify(channels_json) : existing.channels_json, status || existing.status, id, t]
    );
    await audit(req.session.user.email, 'reengagement_campaign_updated', 'Updated re-engagement campaign #' + id);
    res.json({ campaign: result.rows[0] });
  }));

  // POST /api/reengagement-campaigns/:id/launch — launch a re-engagement campaign
  app.post('/api/reengagement-campaigns/:id/launch', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const campId = parseInt(req.params.id);
    const campaign = (await pool.query('SELECT * FROM reengagement_campaigns WHERE id=$1 AND tenant_id=$2', [campId, t])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'active') return res.status(400).json({ error: 'Campaign is already active' });

    // Parse target criteria
    const criteria = typeof campaign.target_criteria === 'string' ? JSON.parse(campaign.target_criteria) : (campaign.target_criteria || {});
    const channels = typeof campaign.channels_json === 'string' ? JSON.parse(campaign.channels_json) : (campaign.channels_json || []);

    // Find donors matching criteria
    let targetDonors = [];
    try {
      const minDays = parseInt(criteria.min_days_inactive) || 90;
      const maxDays = parseInt(criteria.max_days_inactive) || 730;
      const minPastDonations = parseInt(criteria.min_past_donations) || 1;

      targetDonors = (await pool.query(`
        SELECT cd.donor_email, cd.donor_name,
          COALESCE(SUM(cd.amount), 0) as total_donated,
          COUNT(*) as donation_count,
          MAX(cd.donated_at) as last_donation
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
        GROUP BY cd.donor_email, cd.donor_name
        HAVING MAX(cd.donated_at) < NOW() - INTERVAL '1 day' * $2
          AND MAX(cd.donated_at) > NOW() - INTERVAL '1 day' * $3
          AND COUNT(*) >= $4
      `, [t, minDays, maxDays, minPastDonations])).rows;
    } catch(e) {
      // Fallback: just get all donors
      targetDonors = [];
    }

    // Update campaign status and counts
    await pool.query(
      'UPDATE reengagement_campaigns SET status=$1, total_targeted=$2 WHERE id=$3 AND tenant_id=$4',
      ['active', targetDonors.length, campId, t]
    );

    // Create log entries and send communications
    let reengagedCount = 0;
    for (const donor of targetDonors) {
      // Log
      await pool.query(
        'INSERT INTO reengagement_logs (tenant_id, campaign_id, donor_email, action_taken, result) VALUES ($1, $2, $3, $4, $5)',
        [t, campId, esc(donor.donor_email), 'reengagement_message_sent', 'pending']
      );

      // Send via each channel
      if (channels.includes('email') && donor.donor_email && sendEmail) {
        try {
          await sendEmail(donor.donor_email, 'We Miss You! — ' + campaign.name,
            '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px">' +
            '<h2 style="color:#059669">We Miss Your Support!</h2>' +
            '<p>Dear ' + esc(donor.donor_name || 'Supporter') + ',</p>' +
            '<p>It has been a while since your last donation. Your past generosity has made a real difference, and we would love to have you back.</p>' +
            '<p>Please consider supporting us again. Every contribution counts!</p>' +
            '<a href="' + (process.env.BASE_URL || '') + '/discover" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">Browse Campaigns</a>' +
            '</div>'
          );
        } catch(e) { /* email send failure OK */ }
      }

      if (channels.includes('sms') && sendSMS) {
        try {
          // We don't have phone here but can try via donor profile
          const profile = (await pool.query('SELECT phone FROM donor_profiles WHERE user_email=$1 AND tenant_id=$2', [donor.donor_email, t])).rows[0];
          if (profile && profile.phone) {
            await sendSMS(profile.phone, 'We miss your support! Your past donations made a difference. Please consider giving again. - ' + campaign.name);
          }
        } catch(e) { /* SMS send failure OK */ }
      }

      // In-app notification
      notify(t, donor.donor_email, 'We Miss Your Support!', campaign.name + ': It has been a while since your last donation. We would love to have you back!', 'fundraising');
    }

    await audit(req.session.user.email, 'reengagement_campaign_launched', 'Launched re-engagement campaign #' + campId + ' targeting ' + targetDonors.length + ' donors');
    res.json({ message: 'Campaign launched', targeted: targetDonors.length, campaign_id: campId });
  }));

  // =============================================
  // 15. ANNUAL GIVING PREDICTOR
  // =============================================

  // GET /api/annual-giving-forecast — list forecasts
  app.get('/api/annual-giving-forecast', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { year } = req.query;
    let q = 'SELECT * FROM annual_giving_forecasts WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (year) { q += ' AND year=$' + idx; params.push(parseInt(year)); idx++; }
    q += ' ORDER BY year DESC';
    const result = await pool.query(q, params);
    res.json({ forecasts: result.rows });
  }));

  // POST /api/annual-giving-forecast — create/calculate forecast
  app.post('/api/annual-giving-forecast', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { year, based_on_years, methodology } = req.body;
    const targetYear = year || new Date().getFullYear() + 1;
    const lookbackYears = based_on_years || 3;
    const method = methodology || 'linear_regression';

    // Get historical annual totals
    const startYear = targetYear - lookbackYears;
    try {
      const yearlyTotals = (await pool.query(`
        SELECT EXTRACT(YEAR FROM cd.donated_at) as donation_year,
          COALESCE(SUM(cd.amount), 0) as total
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.refunded = false
          AND EXTRACT(YEAR FROM cd.donated_at) >= $2
          AND EXTRACT(YEAR FROM cd.donated_at) < $3
        GROUP BY EXTRACT(YEAR FROM cd.donated_at)
        ORDER BY donation_year ASC
      `, [t, startYear, targetYear])).rows;

      let predictedTotal = 0;
      let confidence = 0;

      if (yearlyTotals.length >= 2) {
        // Simple linear regression
        const n = yearlyTotals.length;
        const xs = yearlyTotals.map((_, i) => i + 1); // 1, 2, 3, ...
        const ys = yearlyTotals.map(r => parseInt(r.total) || 0);

        const sumX = xs.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
        const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        predictedTotal = Math.max(0, Math.round(slope * (n + 1) + intercept));

        // Confidence based on R-squared
        const meanY = sumY / n;
        const ssTot = ys.reduce((acc, y) => acc + Math.pow(y - meanY, 2), 0);
        const ssRes = ys.reduce((acc, y, i) => acc + Math.pow(y - (slope * xs[i] + intercept), 2), 0);
        const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
        confidence = Math.max(0, Math.min(100, Math.round(rSquared * 100)));
      } else if (yearlyTotals.length === 1) {
        // Only one year of data — use that as baseline with low confidence
        predictedTotal = parseInt(yearlyTotals[0].total) || 0;
        confidence = 30;
      } else {
        predictedTotal = 0;
        confidence = 0;
      }

      const result = await pool.query(
        `INSERT INTO annual_giving_forecasts (tenant_id, year, predicted_total, confidence_level, based_on_years, methodology, calculated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (tenant_id, year) DO UPDATE SET predicted_total=$3, confidence_level=$4, based_on_years=$5, methodology=$6, calculated_at=NOW()
         RETURNING *`,
        [t, targetYear, predictedTotal, confidence, lookbackYears, method]
      );

      await audit(req.session.user.email, 'annual_giving_forecast_calculated', 'Calculated forecast for year ' + targetYear + ': UGX ' + predictedTotal.toLocaleString());
      res.json({ forecast: result.rows[0], historical_data: yearlyTotals });
    } catch(e) {
      res.json({ message: 'Calculation attempted', note: 'Ensure donation data exists', error: e.message });
    }
  }));

  // =============================================
  // COMPOSITE: Donor Intelligence Dashboard API
  // =============================================
  app.get('/api/donor-intelligence/summary', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'email query parameter is required' });

    const safeEmail = esc(email);

    // Gather all intelligence for this donor
    const [journey, capacity, churn, ltv, prefs, recommendations, nextActions, moves, plans, relationships] = await Promise.all([
      pool.query('SELECT * FROM donor_journeys WHERE tenant_id=$1 AND donor_email=$2 ORDER BY stage_entered_at DESC LIMIT 1', [t, safeEmail]),
      pool.query('SELECT * FROM donor_capacity_scores WHERE tenant_id=$1 AND donor_email=$2', [t, safeEmail]),
      pool.query('SELECT * FROM donor_churn_scores WHERE tenant_id=$1 AND donor_email=$2', [t, safeEmail]),
      pool.query('SELECT * FROM donor_ltv WHERE tenant_id=$1 AND donor_email=$2', [t, safeEmail]),
      pool.query('SELECT * FROM donor_comm_prefs WHERE tenant_id=$1 AND donor_email=$2', [t, safeEmail]),
      pool.query('SELECT * FROM donor_recommendations WHERE tenant_id=$1 AND donor_email=$2 AND action_taken IS NULL ORDER BY created_at DESC LIMIT 5', [t, safeEmail]),
      pool.query('SELECT * FROM donor_next_actions WHERE tenant_id=$1 AND donor_email=$2 AND completed=false ORDER BY created_at DESC LIMIT 5', [t, safeEmail]),
      pool.query('SELECT * FROM moves_management WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 1', [t, safeEmail]),
      pool.query('SELECT * FROM stewardship_plans WHERE tenant_id=$1 AND donor_email=$2 AND status=$3 ORDER BY created_at DESC LIMIT 1', [t, safeEmail, 'active']),
      pool.query('SELECT * FROM donor_relationships WHERE tenant_id=$1 AND (donor_email=$2 OR related_donor_email=$2)', [t, safeEmail]),
    ]);

    res.json({
      email: email,
      journey: journey.rows[0] || null,
      capacity: capacity.rows[0] || null,
      churn: churn.rows[0] || null,
      ltv: ltv.rows[0] || null,
      communication_preferences: prefs.rows[0] || null,
      recommendations: recommendations.rows,
      next_actions: nextActions.rows,
      current_move: moves.rows[0] || null,
      active_stewardship_plan: plans.rows[0] || null,
      relationships: relationships.rows,
    });
  }));

  // =============================================
  // COMPOSITE: Generate Smart Recommendations (bulk)
  // =============================================
  app.post('/api/donor-intelligence/generate-recommendations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let generated = 0;

    try {
      // 1. Recommend thank you calls for recent donors
      const recentDonors = (await pool.query(`
        SELECT cd.donor_email, cd.donor_name, MAX(cd.donated_at) as last_donation, SUM(cd.amount) as total
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
          AND cd.donated_at > NOW() - INTERVAL '7 days'
        GROUP BY cd.donor_email, cd.donor_name
      `, [t])).rows;

      for (const d of recentDonors) {
        const total = parseInt(d.total) || 0;
        if (total >= 500000) {
          await pool.query(
            'INSERT INTO donor_recommendations (tenant_id, donor_email, recommended_action, reason, priority) VALUES ($1, $2, $3, $4, $5)',
            [t, esc(d.donor_email), 'Make a personal thank you call', 'Major donor gave UGX ' + total.toLocaleString() + ' recently', 'high']
          );
          generated++;
        }
      }

      // 2. Recommend upgrade asks for recurring donors with increasing donations
      const increasingDonors = (await pool.query(`
        SELECT cd.donor_email, COUNT(*) as count, AVG(cd.amount) as avg_amt, MAX(cd.amount) as max_amt
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
        GROUP BY cd.donor_email
        HAVING COUNT(*) >= 3
      `, [t])).rows;

      for (const d of increasingDonors) {
        if (parseInt(d.count) >= 5 && parseInt(d.max_amt) > parseInt(d.avg_amt) * 1.5) {
          // Check if we already have a pending upgrade recommendation
          const existing = (await pool.query(
            'SELECT id FROM donor_recommendations WHERE tenant_id=$1 AND donor_email=$2 AND recommended_action LIKE $3 AND action_taken IS NULL',
            [t, esc(d.donor_email), '%upgrade%']
          )).rows[0];
          if (!existing) {
            await pool.query(
              'INSERT INTO donor_recommendations (tenant_id, donor_email, recommended_action, reason, priority) VALUES ($1, $2, $3, $4, $5)',
              [t, esc(d.donor_email), 'Propose giving level upgrade', 'Donor has ' + d.count + ' donations with increasing amounts. Suggest upgrading to a higher giving tier.', 'medium']
            );
            generated++;
          }
        }
      }

      // 3. Recommend stewardship for lapsed donors
      const churnScores = (await pool.query(
        "SELECT * FROM donor_churn_scores WHERE tenant_id=$1 AND risk_level IN ('high', 'critical')", [t]
      )).rows;

      for (const c of churnScores) {
        const existing = (await pool.query(
          'SELECT id FROM donor_recommendations WHERE tenant_id=$1 AND donor_email=$2 AND recommended_action LIKE $3 AND action_taken IS NULL',
          [t, esc(c.donor_email), '%re-engagement%']
        )).rows[0];
        if (!existing) {
          await pool.query(
            'INSERT INTO donor_recommendations (tenant_id, donor_email, recommended_action, reason, priority) VALUES ($1, $2, $3, $4, $5)',
            [t, esc(c.donor_email), 'Initiate re-engagement outreach', 'Churn probability: ' + c.churn_probability + '%. ' + (c.suggested_action || ''), c.risk_level === 'critical' ? 'urgent' : 'high']
          );
          generated++;
        }
      }

      await audit(req.session.user.email, 'recommendations_generated', 'Generated ' + generated + ' smart recommendations');
      res.json({ message: 'Generated ' + generated + ' recommendations', count: generated });
    } catch(e) {
      res.json({ message: 'Generation attempted', count: generated, note: 'Ensure donor intelligence data has been calculated first' });
    }
  }));

  // =============================================
  // COMPOSITE: Generate Next Best Actions (bulk)
  // =============================================
  app.post('/api/donor-intelligence/generate-next-actions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let generated = 0;

    try {
      // 1. Thank you actions for recent donors
      const recentDonors = (await pool.query(`
        SELECT cd.donor_email, MAX(cd.donated_at) as last_donation, SUM(cd.amount) as total
        FROM campaign_donations cd
        JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
        WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL AND cd.refunded = false
          AND cd.donated_at > NOW() - INTERVAL '14 days'
        GROUP BY cd.donor_email
      `, [t])).rows;

      for (const d of recentDonors) {
        const existing = (await pool.query(
          'SELECT id FROM donor_next_actions WHERE tenant_id=$1 AND donor_email=$2 AND action_type=$3 AND completed=false',
          [t, esc(d.donor_email), 'thank_you']
        )).rows[0];
        if (!existing) {
          await pool.query(
            'INSERT INTO donor_next_actions (tenant_id, donor_email, action_type, action_details, priority, reason) VALUES ($1, $2, $3, $4, $5, $6)',
            [t, esc(d.donor_email), 'thank_you', 'Send thank you for recent donation of UGX ' + (parseInt(d.total) || 0).toLocaleString(), 'high', 'Recent donor should be thanked within 48 hours']
          );
          generated++;
        }
      }

      // 2. Follow-up on high capacity donors who haven't been contacted recently
      const highCapacity = (await pool.query(
        "SELECT * FROM donor_capacity_scores WHERE tenant_id=$1 AND capacity_tier IN ('major','transformational','high')", [t]
      )).rows;

      for (const hc of highCapacity) {
        const existing = (await pool.query(
          "SELECT id FROM donor_next_actions WHERE tenant_id=$1 AND donor_email=$2 AND action_type IN ('call','meeting','email') AND completed=false",
          [t, esc(hc.donor_email)]
        )).rows[0];
        if (!existing) {
          const actionType = hc.capacity_tier === 'transformational' ? 'meeting' : hc.capacity_tier === 'major' ? 'call' : 'email';
          await pool.query(
            'INSERT INTO donor_next_actions (tenant_id, donor_email, action_type, action_details, priority, reason) VALUES ($1, $2, $3, $4, $5, $6)',
            [t, esc(hc.donor_email), actionType, 'Reach out to ' + hc.capacity_tier + ' tier donor for relationship building', 'high', 'High capacity donor (' + hc.capacity_tier + ' tier, estimated: ' + (hc.estimated_giving_range || 'N/A') + ')']
          );
          generated++;
        }
      }

      // 3. Survey invites for donors without recent survey responses
      const activeSurveys = (await pool.query('SELECT id, title FROM donor_surveys WHERE tenant_id=$1 AND is_active=true', [t])).rows;
      if (activeSurveys.length > 0) {
        const surveyId = activeSurveys[0].id;
        const surveyedEmails = (await pool.query(
          'SELECT DISTINCT respondent_email FROM donor_survey_responses WHERE tenant_id=$1 AND survey_id=$2', [t, surveyId]
        )).rows.map(r => r.respondent_email);

        // Get donors who haven't responded
        const allDonors = (await pool.query(`
          SELECT DISTINCT cd.donor_email FROM campaign_donations cd
          JOIN fundraising_campaigns fc ON cd.campaign_id = fc.id
          WHERE fc.tenant_id = $1 AND cd.donor_email IS NOT NULL
        `, [t])).rows;

        for (const d of allDonors) {
          if (!surveyedEmails.includes(d.donor_email)) {
            const existing = (await pool.query(
              "SELECT id FROM donor_next_actions WHERE tenant_id=$1 AND donor_email=$2 AND action_type='survey' AND completed=false",
              [t, esc(d.donor_email)]
            )).rows[0];
            if (!existing) {
              await pool.query(
                'INSERT INTO donor_next_actions (tenant_id, donor_email, action_type, action_details, priority, reason) VALUES ($1, $2, $3, $4, $5, $6)',
                [t, esc(d.donor_email), 'survey', 'Invite to complete: ' + activeSurveys[0].title, 'low', 'Donor has not yet completed the active survey']
              );
              generated++;
            }
          }
        }
      }

      await audit(req.session.user.email, 'next_actions_generated', 'Generated ' + generated + ' next best actions');
      res.json({ message: 'Generated ' + generated + ' next actions', count: generated });
    } catch(e) {
      res.json({ message: 'Generation attempted', count: generated, note: 'Ensure donor intelligence data has been calculated first' });
    }
  }));

  console.log('[FundraisingUltimate2] 15 Donor Intelligence features loaded');
};
