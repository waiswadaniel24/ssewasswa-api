/**
 * Fundraising Ultimate2 Module — Advanced Donor Intelligence & Engagement Platform
 * Features: Donor Journey Mapping, Donor Capacity Scoring, Major Gift Pipeline,
 * Prospect Research Tracker, Moves Management, Stewardship Plans, Donor Surveys,
 * Donor Churn Predictor, Smart Donor Recommendations, Donor Communication Preferences,
 * Donor Relationship Mapping, Next Best Action Engine, Donor Lifetime Value Calculator,
 * Donor Re-engagement Campaigns, Annual Giving Predictor
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // Feature 1: Donor Journey Mapping
    `CREATE TABLE IF NOT EXISTS donor_journeys (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'prospect' CHECK (stage IN ('prospect','first-time','repeat','major','lapsed','reactivated')), stage_entered_at TIMESTAMPTZ DEFAULT NOW(), previous_stage TEXT, total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, notes TEXT, assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_journeys_tenant ON donor_journeys(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_journeys_email ON donor_journeys(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_journeys_stage ON donor_journeys(stage)`,

    // Feature 2: Donor Capacity Scoring
    `CREATE TABLE IF NOT EXISTS donor_capacity_scores (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, capacity_score INTEGER DEFAULT 0, estimated_wealth_range TEXT, giving_capacity INTEGER, score_factors_json TEXT DEFAULT '{}', last_updated TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_donor_capacity_tenant ON donor_capacity_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_capacity_email ON donor_capacity_scores(donor_email)`,

    // Feature 3: Major Gift Pipeline
    `CREATE TABLE IF NOT EXISTS major_gift_pipeline (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, estimated_amount INTEGER, ask_amount INTEGER, stage TEXT DEFAULT 'identification' CHECK (stage IN ('identification','qualification','cultivation','solicitation','negotiation','closed-won','closed-lost')), probability INTEGER DEFAULT 20, expected_close_date DATE, assigned_to TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS major_gift_activities (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, pipeline_id INTEGER NOT NULL REFERENCES major_gift_pipeline(id) ON DELETE CASCADE, activity_type TEXT, description TEXT, outcome TEXT, follow_up_date DATE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_pipeline_tenant ON major_gift_pipeline(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_pipeline_stage ON major_gift_pipeline(stage)`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_activities_tenant ON major_gift_activities(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_major_gift_activities_pipeline ON major_gift_activities(pipeline_id)`,

    // Feature 4: Prospect Research Tracker
    `CREATE TABLE IF NOT EXISTS prospect_research (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, research_status TEXT DEFAULT 'pending' CHECK (research_status IN ('pending','in-progress','completed','needs-review')), occupation TEXT, employer TEXT, interests TEXT, known_connections TEXT, wealth_indicators TEXT, research_notes TEXT, researched_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_prospect_research_tenant ON prospect_research(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_prospect_research_status ON prospect_research(research_status)`,

    // Feature 5: Moves Management
    `CREATE TABLE IF NOT EXISTS moves_management (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, current_step TEXT, target_step TEXT, step_order INTEGER DEFAULT 1, action_type TEXT, action_description TEXT, due_date DATE, completed_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in-progress','completed','skipped')), assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_moves_management_tenant ON moves_management(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_moves_management_email ON moves_management(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_moves_management_status ON moves_management(status)`,

    // Feature 6: Stewardship Plans
    `CREATE TABLE IF NOT EXISTS stewardship_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, plan_name TEXT NOT NULL, plan_type TEXT DEFAULT 'standard' CHECK (plan_type IN ('standard','major-donor','monthly','event','custom')), frequency TEXT DEFAULT 'monthly', actions_json TEXT DEFAULT '[]', status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')), start_date DATE, end_date DATE, assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS stewardship_actions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, plan_id INTEGER NOT NULL REFERENCES stewardship_plans(id) ON DELETE CASCADE, action_type TEXT, action_description TEXT, scheduled_date DATE, completed_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue','skipped')), notes TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_stewardship_plans_tenant ON stewardship_plans(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stewardship_actions_tenant ON stewardship_actions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stewardship_actions_plan ON stewardship_actions(plan_id)`,

    // Feature 7: Donor Surveys
    `CREATE TABLE IF NOT EXISTS donor_surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, questions_json TEXT DEFAULT '[]', is_active BOOLEAN DEFAULT true, response_count INTEGER DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_survey_responses (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, survey_id INTEGER NOT NULL REFERENCES donor_surveys(id) ON DELETE CASCADE, donor_email TEXT, responses_json TEXT DEFAULT '{}', submitted_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_surveys_tenant ON donor_surveys(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_tenant ON donor_survey_responses(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON donor_survey_responses(survey_id)`,

    // Feature 8: Donor Churn Predictor
    `CREATE TABLE IF NOT EXISTS donor_churn_scores (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, churn_risk TEXT DEFAULT 'low' CHECK (churn_risk IN ('low','medium','high','critical')), risk_factors_json TEXT DEFAULT '[]', last_donation_days_ago INTEGER, avg_gap_days INTEGER, predicted_next_donation DATE, flagged_at TIMESTAMPTZ DEFAULT NOW(), action_taken TEXT, UNIQUE(tenant_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_donor_churn_tenant ON donor_churn_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_churn_risk ON donor_churn_scores(churn_risk)`,

    // Feature 9: Smart Donor Recommendations
    `CREATE TABLE IF NOT EXISTS donor_recommendations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, recommended_campaign_id INTEGER, recommended_amount INTEGER, confidence_score NUMERIC DEFAULT 0, reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_recommendations_tenant ON donor_recommendations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_recommendations_email ON donor_recommendations(donor_email)`,

    // Feature 10: Donor Communication Preferences
    `CREATE TABLE IF NOT EXISTS donor_comm_prefs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, email_enabled BOOLEAN DEFAULT true, sms_enabled BOOLEAN DEFAULT true, whatsapp_enabled BOOLEAN DEFAULT false, phone_enabled BOOLEAN DEFAULT false, preferred_channel TEXT DEFAULT 'email', preferred_frequency TEXT DEFAULT 'monthly', do_not_contact BOOLEAN DEFAULT false, quiet_hours_start TEXT, quiet_hours_end TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_donor_comm_prefs_tenant ON donor_comm_prefs(tenant_id)`,

    // Feature 11: Donor Relationship Mapping
    `CREATE TABLE IF NOT EXISTS donor_relationships (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_a_email TEXT NOT NULL, donor_b_email TEXT NOT NULL, relationship_type TEXT, strength INTEGER DEFAULT 5, notes TEXT, discovered_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_relationships_tenant ON donor_relationships(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_relationships_a ON donor_relationships(donor_a_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_relationships_b ON donor_relationships(donor_b_email)`,

    // Feature 12: Next Best Action Engine
    `CREATE TABLE IF NOT EXISTS donor_next_actions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, suggested_action TEXT, action_type TEXT, priority INTEGER DEFAULT 5, reason TEXT, suggested_amount INTEGER, due_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','dismissed')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_next_actions_tenant ON donor_next_actions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_next_actions_email ON donor_next_actions(donor_email)`,

    // Feature 13: Donor Lifetime Value Calculator
    `CREATE TABLE IF NOT EXISTS donor_ltv (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, total_given INTEGER DEFAULT 0, avg_annual INTEGER DEFAULT 0, predicted_years INTEGER DEFAULT 5, predicted_ltv INTEGER DEFAULT 0, ltv_tier TEXT DEFAULT 'bronze', calculated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE INDEX IF NOT EXISTS idx_donor_ltv_tenant ON donor_ltv(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_ltv_tier ON donor_ltv(ltv_tier)`,

    // Feature 14: Donor Re-engagement Campaigns
    `CREATE TABLE IF NOT EXISTS reengagement_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, target_segment TEXT, trigger_days_inactive INTEGER DEFAULT 90, channels_json TEXT DEFAULT '["email"]', message_templates_json TEXT DEFAULT '{}', status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')), donors_targeted INTEGER DEFAULT 0, donors_reactivated INTEGER DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS reengagement_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL REFERENCES reengagement_campaigns(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, channel TEXT, sent_at TIMESTAMPTZ DEFAULT NOW(), responded BOOLEAN DEFAULT false, responded_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS idx_reengagement_campaigns_tenant ON reengagement_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reengagement_logs_tenant ON reengagement_logs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reengagement_logs_campaign ON reengagement_logs(campaign_id)`,

    // Feature 15: Annual Giving Predictor
    `CREATE TABLE IF NOT EXISTS annual_giving_forecasts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, year INTEGER NOT NULL, forecasted_total INTEGER, forecasted_donors INTEGER, forecasted_avg INTEGER, confidence_low INTEGER, confidence_high INTEGER, actual_total INTEGER, method TEXT DEFAULT 'linear', calculated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, year))`,
    `CREATE INDEX IF NOT EXISTS idx_annual_forecasts_tenant ON annual_giving_forecasts(tenant_id)`,

    // Seed data: Default donor journey stages for existing donors
    `INSERT INTO donor_journeys (tenant_id, donor_email, stage, total_donated, donation_count, stage_entered_at) SELECT cd.tenant_id, cd.donor_email, CASE WHEN cd.cnt = 1 THEN 'first-time' WHEN cd.cnt BETWEEN 2 AND 4 THEN 'repeat' WHEN cd.total >= 5000000 THEN 'major' ELSE 'repeat' END, cd.total, cd.cnt, NOW() FROM (SELECT tenant_id, donor_email, SUM(amount) as total, COUNT(*) as cnt FROM campaign_donations WHERE donor_email IS NOT NULL AND refunded = false GROUP BY tenant_id, donor_email) cd WHERE NOT EXISTS (SELECT 1 FROM donor_journeys dj WHERE dj.tenant_id = cd.tenant_id AND dj.donor_email = cd.donor_email)`,

    // Seed data: Default stewardship plan templates
    `INSERT INTO stewardship_plans (tenant_id, donor_email, plan_name, plan_type, frequency, actions_json, status, start_date) SELECT t.id, 'template@system', 'Major Donor Stewardship Template', 'major-donor', 'weekly', '[{"action":"Personal thank you call","timing":"within 24 hours"},{"action":"Impact report","timing":"monthly"},{"action":"Invitation to site visit","timing":"quarterly"},{"action":"Birthday/anniversary recognition","timing":"yearly"}]', 'active', CURRENT_DATE FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM stewardship_plans WHERE tenant_id = t.id AND plan_name = 'Major Donor Stewardship Template')`,

    // Seed data: Default re-engagement campaigns
    `INSERT INTO reengagement_campaigns (tenant_id, name, target_segment, trigger_days_inactive, channels_json, message_templates_json, status, created_by) SELECT t.id, '90-Day Lapsed Donor Win-Back', 'lapsed-donors', 90, '["email","sms"]', '{"email_subject":"We Miss You!","email_body":"Dear {name}, we noticed it has been a while since your last gift...","sms_body":"Hi {name}, we miss your support! Visit us at {link}"}', 'draft', 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM reengagement_campaigns WHERE tenant_id = t.id AND name = '90-Day Lapsed Donor Win-Back')`,

    // Seed data: Default survey
    `INSERT INTO donor_surveys (tenant_id, title, description, questions_json, is_active, created_by) SELECT t.id, 'Donor Satisfaction Survey', 'Help us improve your giving experience', '[{"id":"q1","text":"How satisfied are you with your donation experience?","type":"rating"},{"id":"q2","text":"What motivates you to give?","type":"text"},{"id":"q3","text":"How would you prefer to receive updates?","type":"choice","options":["Email","SMS","WhatsApp","Phone","None"]},{"id":"q4","text":"Would you recommend donating to a friend?","type":"yesno"},{"id":"q5","text":"Any suggestions for improvement?","type":"text"}]', true, 'system' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_surveys WHERE tenant_id = t.id AND title = 'Donor Satisfaction Survey')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate2] Migrations complete');
  })();

  // =============================================
  // HELPERS
  // =============================================
  function formatUGX(amount) { return 'UGX ' + (parseInt(amount)||0).toLocaleString(); }

  const NAV_LINKS = `
    <div style="margin-bottom:24px;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:8px">
      <a href="/donor-journey-map" style="padding:6px 12px;background:#059669;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Journey Map</a>
      <a href="/donor-capacity" style="padding:6px 12px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Capacity</a>
      <a href="/major-gift-pipeline" style="padding:6px 12px;background:#7c3aed;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Major Gifts</a>
      <a href="/prospect-research" style="padding:6px 12px;background:#dc2626;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Prospects</a>
      <a href="/moves-management" style="padding:6px 12px;background:#d97706;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Moves</a>
      <a href="/stewardship-plans" style="padding:6px 12px;background:#0891b2;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Stewardship</a>
      <a href="/donor-surveys" style="padding:6px 12px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Surveys</a>
      <a href="/donor-churn" style="padding:6px 12px;background:#e11d48;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Churn</a>
      <a href="/donor-recommendations" style="padding:6px 12px;background:#0d9488;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Recommendations</a>
      <a href="/donor-comm-prefs" style="padding:6px 12px;background:#6d28d9;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Comm Prefs</a>
      <a href="/donor-relationships" style="padding:6px 12px;background:#b45309;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Relationships</a>
      <a href="/donor-next-actions" style="padding:6px 12px;background:#be185d;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Next Actions</a>
      <a href="/donor-ltv" style="padding:6px 12px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">LTV</a>
      <a href="/reengagement-campaigns" style="padding:6px 12px;background:#c2410c;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Re-engagement</a>
      <a href="/annual-giving-forecast" style="padding:6px 12px;background:#15803d;color:#fff;border-radius:6px;text-decoration:none;font-size:13px">Annual Forecast</a>
    </div>`;

  // =============================================
  // FEATURE 1: DONOR JOURNEY MAPPING
  // =============================================

  // List donor journeys
  app.get('/api/donor-journeys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_journeys WHERE tenant_id=$1 ORDER BY stage_entered_at DESC', [tid]);
    res.json({ journeys: result.rows });
  }));

  // Create donor journey
  app.post('/api/donor-journeys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, stage, notes, assigned_to } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(
      'INSERT INTO donor_journeys(tenant_id,donor_email,stage,notes,assigned_to) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, donor_email, stage||'prospect', notes, assigned_to]
    );
    if(audit) await audit(req, 'donor_journey_created', 'donor_journeys', result.rows[0].id);
    res.json({ success: true, journey: result.rows[0] });
  }));

  // Update donor journey
  app.put('/api/donor-journeys/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { stage, notes, assigned_to, total_donated, donation_count } = req.body;
    const result = await pool.query(
      `UPDATE donor_journeys SET stage=COALESCE($1,stage), notes=COALESCE($2,notes), assigned_to=COALESCE($3,assigned_to), total_donated=COALESCE($4,total_donated), donation_count=COALESCE($5,donation_count) WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [stage, notes, assigned_to, total_donated?parseInt(total_donated):null, donation_count?parseInt(donation_count):null, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) await audit(req, 'donor_journey_updated', 'donor_journeys', req.params.id);
    res.json({ success: true, journey: result.rows[0] });
  }));

  // Get journeys by stage
  app.get('/api/donor-journeys/stage/:stage', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_journeys WHERE tenant_id=$1 AND stage=$2 ORDER BY stage_entered_at DESC', [tid, req.params.stage]);
    res.json({ journeys: result.rows });
  }));

  // Get journey timeline
  app.get('/api/donor-journeys/:id/timeline', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const journey = (await pool.query('SELECT * FROM donor_journeys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!journey) return res.status(404).json({ error: 'Not found' });
    const donations = (await pool.query('SELECT amount, created_at, donor_name FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2 ORDER BY created_at', [journey.donor_email, tid])).rows;
    res.json({ journey, donation_timeline: donations });
  }));

  // Advance donor stage
  app.post('/api/donor-journeys/:id/advance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { new_stage, notes } = req.body;
    if (!new_stage) return res.status(400).json({ error: 'new_stage required' });
    const current = (await pool.query('SELECT * FROM donor_journeys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!current) return res.status(404).json({ error: 'Not found' });
    const result = await pool.query(
      'UPDATE donor_journeys SET stage=$1, previous_stage=$2, stage_entered_at=NOW(), notes=COALESCE($3,notes) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [new_stage, current.stage, notes, req.params.id, tid]
    );
    if(audit) await audit(req, 'donor_journey_advanced', 'donor_journeys', req.params.id);
    if(notify) await notify(req.session.user.id, `Donor ${current.donor_email} advanced to ${new_stage}`);
    res.json({ success: true, journey: result.rows[0] });
  }));

  // Dashboard
  app.get('/donor-journey-map', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const journeys = (await pool.query('SELECT * FROM donor_journeys WHERE tenant_id=$1 ORDER BY stage_entered_at DESC', [tid])).rows;
    const stages = ['prospect','first-time','repeat','major','lapsed','reactivated'];
    const counts = {};
    stages.forEach(s => counts[s] = journeys.filter(j => j.stage === s).length);
    const html = `
      <div class="card">
        <h2>Donor Journey Map</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Track donor lifecycle stages and progression</p>
          <button onclick="document.getElementById('newJourneyForm').style.display='block'" class="btn" style="background:#059669;color:white">+ Add Donor Journey</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
          ${stages.map(s => `<div style="padding:16px;border-radius:12px;background:${s==='lapsed'?'#fef2f2':s==='major'?'#f0fdf4':s==='prospect'?'#eff6ff':'#fefce8'};border:1px solid #e2e8f0;text-align:center">
            <div style="font-size:12px;color:#666;text-transform:uppercase">${esc(s)}</div>
            <div style="font-size:32px;font-weight:700;color:${s==='lapsed'?'#dc2626':s==='major'?'#059669':'#2563eb'}">${counts[s]||0}</div>
          </div>`).join('')}
        </div>
        <div id="newJourneyForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Add Donor Journey</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Donor Email</label><input id="jEmail" type="email" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            <div><label>Stage</label><select id="jStage" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px">${stages.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
            <div><label>Assigned To</label><input id="jAssigned" type="text" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
          </div>
          <div style="margin-top:12px"><label>Notes</label><textarea id="jNotes" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px" rows="2"></textarea></div>
          <button onclick="createJourney()" class="btn" style="background:#059669;color:white;margin-top:12px">Create</button>
          <button onclick="document.getElementById('newJourneyForm').style.display='none'" class="btn" style="background:#999;color:white;margin-left:8px">Cancel</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:left">Stage</th><th style="padding:10px;text-align:right">Total Donated</th><th style="padding:10px;text-align:right">Donations</th><th style="padding:10px;text-align:left">Assigned To</th><th style="padding:10px;text-align:left">Since</th></tr></thead>
          <tbody>${journeys.map(j => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(j.donor_email)}</td>
            <td style="padding:10px"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${j.stage==='lapsed'?'#dc2626':j.stage==='major'?'#059669':j.stage==='reactivated'?'#7c3aed':'#2563eb'}">${esc(j.stage)}</span></td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(j.total_donated)}</td>
            <td style="padding:10px;text-align:right">${j.donation_count}</td>
            <td style="padding:10px">${esc(j.assigned_to||'-')}</td>
            <td style="padding:10px">${new Date(j.stage_entered_at).toLocaleDateString()}</td>
          </tr>`).join('')}</tbody>
        </table>
        <script>
        async function createJourney(){
          const r=await fetch('/api/donor-journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({donor_email:document.getElementById('jEmail').value,stage:document.getElementById('jStage').value,notes:document.getElementById('jNotes').value,assigned_to:document.getElementById('jAssigned').value})});
          if(r.ok)location.reload();else{const e=await r.json();alert(e.error);}
        }
        </script>
      </div>`;
    res.send(renderPage('Donor Journey Map', html, req.session.user));
  }));

  // =============================================
  // FEATURE 2: DONOR CAPACITY SCORING
  // =============================================

  app.get('/api/donor-capacity', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_capacity_scores WHERE tenant_id=$1 ORDER BY capacity_score DESC', [tid]);
    res.json({ scores: result.rows });
  }));

  app.post('/api/donor-capacity', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, capacity_score, estimated_wealth_range, giving_capacity, score_factors_json } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(
      `INSERT INTO donor_capacity_scores(tenant_id,donor_email,capacity_score,estimated_wealth_range,giving_capacity,score_factors_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,donor_email) DO UPDATE SET capacity_score=$3,estimated_wealth_range=$4,giving_capacity=$5,score_factors_json=$6,last_updated=NOW() RETURNING *`,
      [tid, donor_email, parseInt(capacity_score)||0, estimated_wealth_range, giving_capacity?parseInt(giving_capacity):null, score_factors_json?JSON.stringify(score_factors_json):'{}']
    );
    if(audit) await audit(req, 'donor_capacity_created', 'donor_capacity_scores', result.rows[0].id);
    res.json({ success: true, score: result.rows[0] });
  }));

  app.post('/api/donor-capacity/:id/recalculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rec = (await pool.query('SELECT * FROM donor_capacity_scores WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!rec) return res.status(404).json({ error: 'Not found' });
    // Recalculate based on donation history
    const stats = (await pool.query('SELECT COALESCE(SUM(amount),0) as total, COALESCE(MAX(amount),0) as max_donation, COUNT(*) as count, COALESCE(AVG(amount),0) as avg FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2 AND refunded=false', [rec.donor_email, tid])).rows[0];
    let score = 0;
    const total = parseInt(stats.total);
    if (total > 10000000) score = 95;
    else if (total > 5000000) score = 80;
    else if (total > 1000000) score = 65;
    else if (total > 500000) score = 50;
    else if (total > 100000) score = 35;
    else score = 15;
    const factors = { total_given: total, max_donation: parseInt(stats.max_donation), count: parseInt(stats.count), avg_donation: Math.round(parseFloat(stats.avg)) };
    const range = score >= 80 ? 'High Net Worth' : score >= 50 ? 'Upper Middle' : score >= 30 ? 'Middle' : 'Entry Level';
    const capacity = Math.round(total * 3);
    const result = await pool.query(
      'UPDATE donor_capacity_scores SET capacity_score=$1,estimated_wealth_range=$2,giving_capacity=$3,score_factors_json=$4,last_updated=NOW() WHERE id=$5 RETURNING *',
      [score, range, capacity, JSON.stringify(factors), req.params.id]
    );
    if(audit) await audit(req, 'donor_capacity_recalculated', 'donor_capacity_scores', req.params.id);
    res.json({ success: true, score: result.rows[0] });
  }));

  app.get('/api/donor-capacity/top-prospects', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_capacity_scores WHERE tenant_id=$1 ORDER BY capacity_score DESC LIMIT 20', [tid]);
    res.json({ prospects: result.rows });
  }));

  app.get('/donor-capacity', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const scores = (await pool.query('SELECT * FROM donor_capacity_scores WHERE tenant_id=$1 ORDER BY capacity_score DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donor Capacity Scoring</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Rate donor giving capacity and wealth indicators</p>
          <button onclick="document.getElementById('newCapacityForm').style.display='block'" class="btn" style="background:#2563eb;color:white">+ Add Score</button>
        </div>
        <div id="newCapacityForm" style="display:none;padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;background:#f9fafb">
          <h3>Add Capacity Score</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Donor Email</label><input id="cEmail" type="email" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            <div><label>Score (0-100)</label><input id="cScore" type="number" min="0" max="100" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"></div>
            <div><label>Wealth Range</label><select id="cRange" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px"><option>High Net Worth</option><option>Upper Middle</option><option>Middle</option><option>Entry Level</option></select></div>
          </div>
          <button onclick="createCapacity()" class="btn" style="background:#2563eb;color:white;margin-top:12px">Add Score</button>
          <button onclick="document.getElementById('newCapacityForm').style.display='none'" class="btn" style="background:#999;color:white;margin-left:8px">Cancel</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:center">Score</th><th style="padding:10px;text-align:left">Wealth Range</th><th style="padding:10px;text-align:right">Capacity (UGX)</th><th style="padding:10px;text-align:left">Last Updated</th><th style="padding:10px">Recalculate</th></tr></thead>
          <tbody>${scores.map(s => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(s.donor_email)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:50%;color:#fff;font-weight:700;text-align:center;background:${s.capacity_score>=70?'#059669':s.capacity_score>=40?'#d97706':'#dc2626'}">${s.capacity_score}</span></td>
            <td style="padding:10px">${esc(s.estimated_wealth_range||'-')}</td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(s.giving_capacity)}</td>
            <td style="padding:10px">${new Date(s.last_updated).toLocaleDateString()}</td>
            <td style="padding:10px;text-align:center"><button onclick="fetch('/api/donor-capacity/${s.id}/recalculate',{method:'POST'}).then(()=>location.reload())" style="padding:4px 10px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Recalc</button></td>
          </tr>`).join('')}</tbody>
        </table>
        <script>
        async function createCapacity(){
          const r=await fetch('/api/donor-capacity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({donor_email:document.getElementById('cEmail').value,capacity_score:document.getElementById('cScore').value,estimated_wealth_range:document.getElementById('cRange').value})});
          if(r.ok)location.reload();else{const e=await r.json();alert(e.error);}
        }
        </script>
      </div>`;
    res.send(renderPage('Donor Capacity', html, req.session.user));
  }));

  // =============================================
  // FEATURE 3: MAJOR GIFT PIPELINE
  // =============================================

  app.get('/api/major-gift-pipeline', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM major_gift_pipeline WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ pipeline: result.rows });
  }));

  app.post('/api/major-gift-pipeline', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, donor_name, estimated_amount, ask_amount, stage, probability, expected_close_date, assigned_to, notes } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(
      'INSERT INTO major_gift_pipeline(tenant_id,donor_email,donor_name,estimated_amount,ask_amount,stage,probability,expected_close_date,assigned_to,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [tid, donor_email, donor_name, estimated_amount?parseInt(estimated_amount):null, ask_amount?parseInt(ask_amount):null, stage||'identification', probability?parseInt(probability):20, expected_close_date, assigned_to, notes]
    );
    if(audit) await audit(req, 'major_gift_created', 'major_gift_pipeline', result.rows[0].id);
    res.json({ success: true, pipeline: result.rows[0] });
  }));

  app.put('/api/major-gift-pipeline/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_name, estimated_amount, ask_amount, stage, probability, expected_close_date, assigned_to, notes } = req.body;
    const result = await pool.query(
      `UPDATE major_gift_pipeline SET donor_name=COALESCE($1,donor_name), estimated_amount=COALESCE($2,estimated_amount), ask_amount=COALESCE($3,ask_amount), stage=COALESCE($4,stage), probability=COALESCE($5,probability), expected_close_date=COALESCE($6,expected_close_date), assigned_to=COALESCE($7,assigned_to), notes=COALESCE($8,notes), updated_at=NOW() WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [donor_name, estimated_amount?parseInt(estimated_amount):null, ask_amount?parseInt(ask_amount):null, stage, probability?parseInt(probability):null, expected_close_date, assigned_to, notes, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) await audit(req, 'major_gift_updated', 'major_gift_pipeline', req.params.id);
    res.json({ success: true, pipeline: result.rows[0] });
  }));

  app.delete('/api/major-gift-pipeline/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM major_gift_pipeline WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if(audit) await audit(req, 'major_gift_deleted', 'major_gift_pipeline', req.params.id);
    res.json({ success: true });
  }));

  app.get('/api/major-gift-pipeline/stage/:stage', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM major_gift_pipeline WHERE tenant_id=$1 AND stage=$2', [tid, req.params.stage]);
    res.json({ pipeline: result.rows });
  }));

  app.post('/api/major-gift-pipeline/:id/activity', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { activity_type, description, outcome, follow_up_date } = req.body;
    const result = await pool.query(
      'INSERT INTO major_gift_activities(tenant_id,pipeline_id,activity_type,description,outcome,follow_up_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, req.params.id, activity_type, description, outcome, follow_up_date, req.session.user.email]
    );
    res.json({ success: true, activity: result.rows[0] });
  }));

  app.get('/api/major-gift-pipeline/stats', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = (await pool.query(`SELECT stage, COUNT(*) as count, COALESCE(SUM(estimated_amount),0) as total_estimated, COALESCE(SUM(ask_amount),0) as total_ask FROM major_gift_pipeline WHERE tenant_id=$1 GROUP BY stage`, [tid])).rows;
    res.json({ stats });
  }));

  app.get('/major-gift-pipeline', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const pipeline = (await pool.query('SELECT * FROM major_gift_pipeline WHERE tenant_id=$1 ORDER BY stage, created_at DESC', [tid])).rows;
    const stages = ['identification','qualification','cultivation','solicitation','negotiation','closed-won','closed-lost'];
    const stageColors = {identification:'#6366f1',qualification:'#2563eb',cultivation:'#059669',solicitation:'#d97706',negotiation:'#7c3aed','closed-won':'#10b981','closed-lost':'#dc2626'};
    const totalPipeline = pipeline.reduce((s,p) => s + parseInt(p.estimated_amount||0), 0);
    const html = `
      <div class="card">
        <h2>Major Gift Pipeline</h2>
        ${NAV_LINKS}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Pipeline Value</div><div style="font-size:28px;font-weight:700;color:#059669">${formatUGX(totalPipeline)}</div></div>
          <div style="padding:20px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe"><div style="font-size:14px;color:#666">Active Prospects</div><div style="font-size:28px;font-weight:700;color:#2563eb">${pipeline.filter(p=>!p.stage.startsWith('closed')).length}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
          ${stages.map(st => {
            const items = pipeline.filter(p => p.stage === st);
            return `<div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f9fafb;border-top:4px solid ${stageColors[st]||'#666'}">
              <h4 style="margin:0 0 8px;color:${stageColors[st]||'#666'}">${esc(st)} (${items.length})</h4>
              ${items.map(i => `<div style="padding:10px;margin-bottom:8px;background:white;border-radius:8px;border:1px solid #e2e8f0">
                <div style="font-weight:600">${esc(i.donor_name||i.donor_email)}</div>
                <div style="font-size:13px;color:#666">Ask: ${formatUGX(i.ask_amount)} | ${i.probability}%</div>
              </div>`).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('Major Gift Pipeline', html, req.session.user));
  }));

  // =============================================
  // FEATURE 4: PROSPECT RESEARCH TRACKER
  // =============================================

  app.get('/api/prospect-research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM prospect_research WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ prospects: result.rows });
  }));

  app.post('/api/prospect-research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, donor_name, occupation, employer, interests, known_connections, wealth_indicators, research_notes } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(
      'INSERT INTO prospect_research(tenant_id,donor_email,donor_name,occupation,employer,interests,known_connections,wealth_indicators,research_notes,researched_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [tid, donor_email, donor_name, occupation, employer, interests, known_connections, wealth_indicators, research_notes, req.session.user.email]
    );
    if(audit) await audit(req, 'prospect_research_created', 'prospect_research', result.rows[0].id);
    res.json({ success: true, prospect: result.rows[0] });
  }));

  app.put('/api/prospect-research/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const fields = ['donor_name','occupation','employer','interests','known_connections','wealth_indicators','research_notes','research_status'];
    const sets = []; const vals = []; let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=$${idx}`); vals.push(req.body[f]); idx++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, tid);
    const result = await pool.query(`UPDATE prospect_research SET ${sets.join(',')} WHERE id=$${idx} AND tenant_id=$${idx+1} RETURNING *`, vals);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, prospect: result.rows[0] });
  }));

  app.delete('/api/prospect-research/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM prospect_research WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/api/prospect-research/priority-list', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT pr.*, COALESCE(SUM(cd.amount),0) as total_donated FROM prospect_research pr LEFT JOIN campaign_donations cd ON pr.donor_email=cd.donor_email AND cd.tenant_id=$1 WHERE pr.tenant_id=$1 GROUP BY pr.id ORDER BY pr.research_status='pending' DESC, total_donated DESC", [tid]);
    res.json({ prospects: result.rows });
  }));

  app.post('/api/prospect-research/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("UPDATE prospect_research SET research_status='completed' WHERE id=$1 AND tenant_id=$2 RETURNING *", [req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) await audit(req, 'prospect_research_completed', 'prospect_research', req.params.id);
    res.json({ success: true, prospect: result.rows[0] });
  }));

  app.get('/prospect-research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const prospects = (await pool.query('SELECT * FROM prospect_research WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Prospect Research Tracker</h2>
        ${NAV_LINKS}
        <p style="color:#666;margin-bottom:20px">Track research on potential donors</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Donor</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:left">Occupation</th><th style="padding:10px;text-align:left">Employer</th><th style="padding:10px;text-align:left">Interests</th><th style="padding:10px">Actions</th></tr></thead>
          <tbody>${prospects.map(p => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px"><div style="font-weight:600">${esc(p.donor_name||'')}</div><div style="font-size:12px;color:#666">${esc(p.donor_email)}</div></td>
            <td style="padding:10px"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${p.research_status==='completed'?'#059669':p.research_status==='in-progress'?'#d97706':'#6366f1'}">${esc(p.research_status)}</span></td>
            <td style="padding:10px">${esc(p.occupation||'-')}</td>
            <td style="padding:10px">${esc(p.employer||'-')}</td>
            <td style="padding:10px">${esc(p.interests||'-')}</td>
            <td style="padding:10px">${p.research_status!=='completed'?`<button onclick="fetch('/api/prospect-research/${p.id}/complete',{method:'POST'}).then(()=>location.reload())" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Complete</button>`:''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Prospect Research', html, req.session.user));
  }));

  // =============================================
  // FEATURE 5: MOVES MANAGEMENT
  // =============================================

  app.get('/api/moves-management', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM moves_management WHERE tenant_id=$1 ORDER BY step_order, due_date', [tid]);
    res.json({ moves: result.rows });
  }));

  app.post('/api/moves-management', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, donor_name, current_step, target_step, step_order, action_type, action_description, due_date, assigned_to } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const result = await pool.query(
      'INSERT INTO moves_management(tenant_id,donor_email,donor_name,current_step,target_step,step_order,action_type,action_description,due_date,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [tid, donor_email, donor_name, current_step, target_step, parseInt(step_order)||1, action_type, action_description, due_date, assigned_to]
    );
    if(audit) await audit(req, 'moves_created', 'moves_management', result.rows[0].id);
    res.json({ success: true, move: result.rows[0] });
  }));

  app.put('/api/moves-management/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { current_step, target_step, action_type, action_description, due_date, assigned_to, status } = req.body;
    const result = await pool.query(
      `UPDATE moves_management SET current_step=COALESCE($1,current_step), target_step=COALESCE($2,target_step), action_type=COALESCE($3,action_type), action_description=COALESCE($4,action_description), due_date=COALESCE($5,due_date), assigned_to=COALESCE($6,assigned_to), status=COALESCE($7,status) WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [current_step, target_step, action_type, action_description, due_date, assigned_to, status, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, move: result.rows[0] });
  }));

  app.delete('/api/moves-management/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM moves_management WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/api/moves-management/donor/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM moves_management WHERE tenant_id=$1 AND donor_email=$2 ORDER BY step_order', [tid, req.params.email]);
    res.json({ moves: result.rows });
  }));

  app.post('/api/moves-management/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("UPDATE moves_management SET status='completed', completed_date=CURRENT_DATE WHERE id=$1 AND tenant_id=$2 RETURNING *", [req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    if(audit) await audit(req, 'moves_completed', 'moves_management', req.params.id);
    res.json({ success: true, move: result.rows[0] });
  }));

  app.get('/api/moves-management/upcoming', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM moves_management WHERE tenant_id=$1 AND status IN ('pending','in-progress') AND due_date IS NOT NULL ORDER BY due_date ASC LIMIT 20", [tid]);
    res.json({ moves: result.rows });
  }));

  app.get('/moves-management', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const moves = (await pool.query("SELECT * FROM moves_management WHERE tenant_id=$1 ORDER BY donor_email, step_order", [tid])).rows;
    const html = `
      <div class="card">
        <h2>Moves Management</h2>
        ${NAV_LINKS}
        <p style="color:#666;margin-bottom:20px">Structured cultivation tracking for donor engagement</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Donor</th><th style="padding:10px;text-align:left">Step</th><th style="padding:10px;text-align:left">Action</th><th style="padding:10px;text-align:left">Due</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px">Actions</th></tr></thead>
          <tbody>${moves.map(m => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px"><div style="font-weight:600">${esc(m.donor_name||'')}</div><div style="font-size:12px;color:#666">${esc(m.donor_email)}</div></td>
            <td style="padding:10px">${esc(m.current_step||'')} → ${esc(m.target_step||'')}</td>
            <td style="padding:10px">${esc(m.action_description||m.action_type||'-')}</td>
            <td style="padding:10px">${m.due_date||'-'}</td>
            <td style="padding:10px"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${m.status==='completed'?'#059669':m.status==='in-progress'?'#d97706':m.status==='skipped'?'#999':'#2563eb'}">${esc(m.status)}</span></td>
            <td style="padding:10px">${m.status!=='completed'?`<button onclick="fetch('/api/moves-management/${m.id}/complete',{method:'POST'}).then(()=>location.reload())" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Complete</button>`:''}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Moves Management', html, req.session.user));
  }));

  // =============================================
  // FEATURE 6: STEWARDSHIP PLANS
  // =============================================

  app.get('/api/stewardship-plans', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM stewardship_plans WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ plans: result.rows });
  }));

  app.post('/api/stewardship-plans', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, plan_name, plan_type, frequency, actions_json, start_date, end_date, assigned_to } = req.body;
    if (!donor_email || !plan_name) return res.status(400).json({ error: 'donor_email and plan_name required' });
    const result = await pool.query(
      'INSERT INTO stewardship_plans(tenant_id,donor_email,plan_name,plan_type,frequency,actions_json,start_date,end_date,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [tid, donor_email, plan_name, plan_type||'standard', frequency||'monthly', actions_json?JSON.stringify(actions_json):'[]', start_date, end_date, assigned_to]
    );
    if(audit) await audit(req, 'stewardship_plan_created', 'stewardship_plans', result.rows[0].id);
    res.json({ success: true, plan: result.rows[0] });
  }));

  app.put('/api/stewardship-plans/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { plan_name, plan_type, frequency, status, assigned_to } = req.body;
    const result = await pool.query(
      `UPDATE stewardship_plans SET plan_name=COALESCE($1,plan_name), plan_type=COALESCE($2,plan_type), frequency=COALESCE($3,frequency), status=COALESCE($4,status), assigned_to=COALESCE($5,assigned_to) WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [plan_name, plan_type, frequency, status, assigned_to, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, plan: result.rows[0] });
  }));

  app.delete('/api/stewardship-plans/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM stewardship_plans WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.post('/api/stewardship-plans/:id/actions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { action_type, action_description, scheduled_date } = req.body;
    const result = await pool.query(
      'INSERT INTO stewardship_actions(tenant_id,plan_id,action_type,action_description,scheduled_date) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [tid, req.params.id, action_type, action_description, scheduled_date]
    );
    res.json({ success: true, action: result.rows[0] });
  }));

  app.put('/api/stewardship-actions/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("UPDATE stewardship_actions SET status='completed', completed_date=CURRENT_DATE WHERE id=$1 AND tenant_id=$2 RETURNING *", [req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  }));

  app.get('/api/stewardship-plans/:id/progress', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plan = (await pool.query('SELECT * FROM stewardship_plans WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!plan) return res.status(404).json({ error: 'Not found' });
    const actions = (await pool.query('SELECT * FROM stewardship_actions WHERE plan_id=$1 AND tenant_id=$2 ORDER BY scheduled_date', [req.params.id, tid])).rows;
    const completed = actions.filter(a => a.status === 'completed').length;
    res.json({ plan, actions, progress: { total: actions.length, completed, percentage: actions.length ? Math.round((completed/actions.length)*100) : 0 } });
  }));

  app.get('/stewardship-plans', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plans = (await pool.query('SELECT * FROM stewardship_plans WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Stewardship Plans</h2>
        ${NAV_LINKS}
        <p style="color:#666;margin-bottom:20px">Structured donor care programs</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px">
          ${plans.map(p => {
            return `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white;border-left:4px solid ${p.status==='active'?'#059669':p.status==='completed'?'#2563eb':'#999'}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h3 style="margin:0">${esc(p.plan_name)}</h3>
                <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${p.status==='active'?'#059669':p.status==='completed'?'#2563eb':'#999'}">${esc(p.status)}</span>
              </div>
              <div style="font-size:13px;color:#666">${esc(p.donor_email)} | ${esc(p.plan_type)} | ${esc(p.frequency)}</div>
              <div style="font-size:13px;color:#666;margin-top:4px">Assigned: ${esc(p.assigned_to||'Unassigned')}</div>
              <a href="/api/stewardship-plans/${p.id}/progress" style="display:inline-block;margin-top:8px;font-size:13px;color:#2563eb">View Progress</a>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    res.send(renderPage('Stewardship Plans', html, req.session.user));
  }));

  // =============================================
  // FEATURE 7: DONOR SURVEYS
  // =============================================

  app.get('/api/donor-surveys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_surveys WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ surveys: result.rows });
  }));

  app.post('/api/donor-surveys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, questions_json, is_active } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = await pool.query(
      'INSERT INTO donor_surveys(tenant_id,title,description,questions_json,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [tid, title, description, questions_json?JSON.stringify(questions_json):'[]', is_active!==false, req.session.user.email]
    );
    if(audit) await audit(req, 'donor_survey_created', 'donor_surveys', result.rows[0].id);
    res.json({ success: true, survey: result.rows[0] });
  }));

  app.put('/api/donor-surveys/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, questions_json, is_active } = req.body;
    const result = await pool.query(
      `UPDATE donor_surveys SET title=COALESCE($1,title), description=COALESCE($2,description), questions_json=COALESCE($3,questions_json), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [title, description, questions_json?JSON.stringify(questions_json):null, is_active, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, survey: result.rows[0] });
  }));

  app.delete('/api/donor-surveys/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.post('/api/donor-surveys/:id/respond', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, responses_json } = req.body;
    if (!responses_json) return res.status(400).json({ error: 'responses_json required' });
    const result = await pool.query(
      'INSERT INTO donor_survey_responses(tenant_id,survey_id,donor_email,responses_json) VALUES($1,$2,$3,$4) RETURNING *',
      [tid, req.params.id, donor_email||req.session.user.email, typeof responses_json==='string'?responses_json:JSON.stringify(responses_json)]
    );
    await pool.query('UPDATE donor_surveys SET response_count=response_count+1 WHERE id=$1', [req.params.id]);
    res.json({ success: true, response: result.rows[0] });
  }));

  app.get('/api/donor-surveys/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const survey = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!survey) return res.status(404).json({ error: 'Not found' });
    const responses = (await pool.query('SELECT * FROM donor_survey_responses WHERE survey_id=$1 AND tenant_id=$2 ORDER BY submitted_at DESC', [req.params.id, tid])).rows;
    res.json({ survey, responses });
  }));

  app.get('/api/donor-surveys/:id/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const survey = (await pool.query('SELECT * FROM donor_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!survey) return res.status(404).json({ error: 'Not found' });
    const responseCount = (await pool.query('SELECT COUNT(*) as cnt FROM donor_survey_responses WHERE survey_id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0].cnt;
    res.json({ survey_id: parseInt(req.params.id), title: survey.title, total_responses: parseInt(responseCount), is_active: survey.is_active });
  }));

  app.get('/donor-surveys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const surveys = (await pool.query('SELECT * FROM donor_surveys WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donor Surveys</h2>
        ${NAV_LINKS}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${surveys.map(s => `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h3 style="margin:0">${esc(s.title)}</h3>
              <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${s.is_active?'#059669':'#999'}">${s.is_active?'Active':'Inactive'}</span>
            </div>
            <p style="color:#666;font-size:14px;margin:0 0 8px">${esc(s.description||'No description')}</p>
            <div style="font-size:13px;color:#888">Responses: ${s.response_count} | Created: ${new Date(s.created_at).toLocaleDateString()}</div>
            <a href="/api/donor-surveys/${s.id}/results" style="display:inline-block;margin-top:8px;font-size:13px;color:#2563eb">View Results</a>
          </div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('Donor Surveys', html, req.session.user));
  }));

  // =============================================
  // FEATURE 8: DONOR CHURN PREDICTOR
  // =============================================

  app.get('/api/donor-churn', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_churn_scores WHERE tenant_id=$1 ORDER BY churn_risk DESC, flagged_at DESC', [tid]);
    res.json({ churn_scores: result.rows });
  }));

  app.post('/api/donor-churn/recalculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Get all donors with their donation patterns
    const donors = (await pool.query(`SELECT donor_email, MAX(created_at) as last_donation, COUNT(*) as count, AVG(amount) as avg_amount FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL GROUP BY donor_email HAVING COUNT(*) >= 1`, [tid])).rows;
    let recalculated = 0;
    for (const d of donors) {
      const lastDate = new Date(d.last_donation);
      const daysSince = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
      // Calculate average gap
      const donations = (await pool.query('SELECT created_at FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2 ORDER BY created_at', [d.donor_email, tid])).rows;
      let totalGap = 0; let gaps = 0;
      for (let i = 1; i < donations.length; i++) {
        const gap = (new Date(donations[i].created_at) - new Date(donations[i-1].created_at)) / 86400000;
        totalGap += gap; gaps++;
      }
      const avgGap = gaps > 0 ? Math.round(totalGap / gaps) : 0;
      const predictedNext = avgGap > 0 ? new Date(lastDate.getTime() + avgGap * 86400000).toISOString().split('T')[0] : null;
      let risk = 'low';
      const factors = [];
      if (daysSince > 180 && parseInt(d.count) > 1) { risk = 'critical'; factors.push('Inactive over 6 months'); }
      else if (daysSince > 120) { risk = 'high'; factors.push('Inactive over 4 months'); }
      else if (daysSince > 90 || (avgGap > 0 && daysSince > avgGap * 1.5)) { risk = 'medium'; factors.push('Approaching typical gap'); }
      if (parseInt(d.count) === 1 && daysSince > 60) { risk = 'high'; factors.push('One-time donor at risk'); }
      await pool.query(
        `INSERT INTO donor_churn_scores(tenant_id,donor_email,churn_risk,risk_factors_json,last_donation_days_ago,avg_gap_days,predicted_next_donation) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,donor_email) DO UPDATE SET churn_risk=$3,risk_factors_json=$4,last_donation_days_ago=$5,avg_gap_days=$6,predicted_next_donation=$7,flagged_at=NOW()`,
        [tid, d.donor_email, risk, JSON.stringify(factors), daysSince, avgGap, predictedNext]
      );
      recalculated++;
    }
    if(audit) await audit(req, 'donor_churn_recalculated', null, null);
    res.json({ success: true, recalculated });
  }));

  app.get('/api/donor-churn/high-risk', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM donor_churn_scores WHERE tenant_id=$1 AND churn_risk IN ('high','critical') ORDER BY churn_risk DESC, last_donation_days_ago DESC", [tid]);
    res.json({ at_risk: result.rows });
  }));

  app.post('/api/donor-churn/:id/action', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { action_taken } = req.body;
    if (!action_taken) return res.status(400).json({ error: 'action_taken required' });
    const result = await pool.query('UPDATE donor_churn_scores SET action_taken=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *', [action_taken, req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, churn: result.rows[0] });
  }));

  app.get('/donor-churn', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const churns = (await pool.query('SELECT * FROM donor_churn_scores WHERE tenant_id=$1 ORDER BY CASE churn_risk WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END', [tid])).rows;
    const riskColors = {critical:'#dc2626',high:'#f59e0b',medium:'#d97706',low:'#059669'};
    const html = `
      <div class="card">
        <h2>Donor Churn Predictor</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Auto-flagged at-risk donors</p>
          <button onclick="fetch('/api/donor-churn/recalculate',{method:'POST'}).then(()=>location.reload())" class="btn" style="background:#dc2626;color:white">Recalculate All</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:center">Risk</th><th style="padding:10px;text-align:right">Days Since Last</th><th style="padding:10px;text-align:right">Avg Gap (days)</th><th style="padding:10px;text-align:left">Factors</th><th style="padding:10px;text-align:left">Action Taken</th></tr></thead>
          <tbody>${churns.map(c => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(c.donor_email)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 12px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${riskColors[c.churn_risk]||'#999'}">${esc(c.churn_risk)}</span></td>
            <td style="padding:10px;text-align:right;font-weight:600">${c.last_donation_days_ago||0}</td>
            <td style="padding:10px;text-align:right">${c.avg_gap_days||0}</td>
            <td style="padding:10px;font-size:12px">${esc(Array.isArray(c.risk_factors_json)?c.risk_factors_json.join(', '):(c.risk_factors_json||''))}</td>
            <td style="padding:10px">${esc(c.action_taken||'None')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor Churn', html, req.session.user));
  }));

  // =============================================
  // FEATURE 9: SMART DONOR RECOMMENDATIONS
  // =============================================

  app.get('/api/donor-recommendations/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_recommendations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY confidence_score DESC', [tid, req.params.email]);
    res.json({ recommendations: result.rows });
  }));

  app.post('/api/donor-recommendations/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Get active campaigns
    const campaigns = (await pool.query("SELECT id, title, target FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active'", [tid])).rows;
    // Get donors with their history
    const donors = (await pool.query('SELECT donor_email, SUM(amount) as total, AVG(amount) as avg_amount, COUNT(*) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false GROUP BY donor_email', [tid])).rows;
    let generated = 0;
    for (const donor of donors) {
      const avgAmt = Math.round(parseFloat(donor.avg_amount));
      // Find campaigns donor hasn't donated to
      const donated = (await pool.query('SELECT DISTINCT campaign_id FROM campaign_donations WHERE donor_email=$1 AND tenant_id=$2', [donor.donor_email, tid])).rows.map(r => r.campaign_id);
      const available = campaigns.filter(c => !donated.includes(c.id));
      for (const camp of available.slice(0, 2)) {
        const confScore = Math.min(95, Math.round(30 + (parseInt(donor.count) * 5) + (avgAmt > 100000 ? 15 : 0)));
        const reason = `Based on ${donor.count} previous donations averaging ${formatUGX(avgAmt)}`;
        const recAmt = Math.round(avgAmt * (1 + Math.random() * 0.2));
        await pool.query(
          'INSERT INTO donor_recommendations(tenant_id,donor_email,recommended_campaign_id,recommended_amount,confidence_score,reason) VALUES($1,$2,$3,$4,$5,$6)',
          [tid, donor.donor_email, camp.id, recAmt, confScore, reason]
        );
        generated++;
      }
    }
    if(audit) await audit(req, 'recommendations_generated', null, null);
    res.json({ success: true, generated });
  }));

  app.post('/api/donor-recommendations/:id/act', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rec = (await pool.query('SELECT * FROM donor_recommendations WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!rec) return res.status(404).json({ error: 'Not found' });
    // Mark as acted upon by deleting the recommendation
    await pool.query('DELETE FROM donor_recommendations WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if(notify) await notify(req.session.user.id, `Acted on recommendation for ${rec.donor_email}`);
    res.json({ success: true });
  }));

  app.get('/donor-recommendations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const recs = (await pool.query('SELECT dr.*, fc.title as campaign_title FROM donor_recommendations dr LEFT JOIN fundraising_campaigns fc ON dr.recommended_campaign_id=fc.id WHERE dr.tenant_id=$1 ORDER BY dr.confidence_score DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Smart Donor Recommendations</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">AI-powered giving suggestions</p>
          <button onclick="fetch('/api/donor-recommendations/generate',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Generated '+d.generated+' recommendations');location.reload()})" class="btn" style="background:#0d9488;color:white">Generate Recommendations</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Donor</th><th style="padding:10px;text-align:left">Campaign</th><th style="padding:10px;text-align:right">Suggested Amount</th><th style="padding:10px;text-align:center">Confidence</th><th style="padding:10px;text-align:left">Reason</th></tr></thead>
          <tbody>${recs.map(r => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(r.donor_email)}</td>
            <td style="padding:10px">${esc(r.campaign_title||'#'+r.recommended_campaign_id)}</td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(r.recommended_amount)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${r.confidence_score>=70?'#059669':r.confidence_score>=40?'#d97706':'#dc2626'}">${Math.round(parseFloat(r.confidence_score))}%</span></td>
            <td style="padding:10px;font-size:13px">${esc(r.reason||'')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor Recommendations', html, req.session.user));
  }));

  // =============================================
  // FEATURE 10: DONOR COMMUNICATION PREFERENCES
  // =============================================

  app.get('/api/donor-comm-prefs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_comm_prefs WHERE tenant_id=$1 ORDER BY donor_email', [tid]);
    res.json({ prefs: result.rows });
  }));

  app.get('/api/donor-comm-prefs/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_comm_prefs WHERE tenant_id=$1 AND donor_email=$2', [tid, req.params.email]);
    if (!result.rows.length) return res.json({ pref: null });
    res.json({ pref: result.rows[0] });
  }));

  app.post('/api/donor-comm-prefs/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { email_enabled, sms_enabled, whatsapp_enabled, phone_enabled, preferred_channel, preferred_frequency, do_not_contact, quiet_hours_start, quiet_hours_end } = req.body;
    const result = await pool.query(
      `INSERT INTO donor_comm_prefs(tenant_id,donor_email,email_enabled,sms_enabled,whatsapp_enabled,phone_enabled,preferred_channel,preferred_frequency,do_not_contact,quiet_hours_start,quiet_hours_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,donor_email) DO UPDATE SET email_enabled=$3,sms_enabled=$4,whatsapp_enabled=$5,phone_enabled=$6,preferred_channel=$7,preferred_frequency=$8,do_not_contact=$9,quiet_hours_start=$10,quiet_hours_end=$11,updated_at=NOW() RETURNING *`,
      [tid, req.params.email, email_enabled!==false, sms_enabled!==false, whatsapp_enabled===true, phone_enabled===true, preferred_channel||'email', preferred_frequency||'monthly', do_not_contact===true, quiet_hours_start||null, quiet_hours_end||null]
    );
    res.json({ success: true, pref: result.rows[0] });
  }));

  app.put('/api/donor-comm-prefs/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const fields = ['email_enabled','sms_enabled','whatsapp_enabled','phone_enabled','preferred_channel','preferred_frequency','do_not_contact','quiet_hours_start','quiet_hours_end'];
    const sets = []; const vals = []; let idx = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f}=$${idx}`); vals.push(req.body[f]); idx++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(tid, req.params.email);
    const result = await pool.query(`UPDATE donor_comm_prefs SET ${sets.join(',')} WHERE tenant_id=$${idx} AND donor_email=$${idx+1} RETURNING *`, vals);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, pref: result.rows[0] });
  }));

  app.post('/api/donor-comm-prefs/bulk-update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_emails, preferred_channel, preferred_frequency, do_not_contact } = req.body;
    if (!donor_emails || !Array.isArray(donor_emails)) return res.status(400).json({ error: 'donor_emails array required' });
    let updated = 0;
    for (const email of donor_emails) {
      await pool.query(
        `INSERT INTO donor_comm_prefs(tenant_id,donor_email,preferred_channel,preferred_frequency,do_not_contact) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,donor_email) DO UPDATE SET preferred_channel=$3,preferred_frequency=$4,do_not_contact=$5,updated_at=NOW()`,
        [tid, email, preferred_channel||'email', preferred_frequency||'monthly', do_not_contact||false]
      );
      updated++;
    }
    res.json({ success: true, updated });
  }));

  app.get('/donor-comm-prefs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const prefs = (await pool.query('SELECT * FROM donor_comm_prefs WHERE tenant_id=$1 ORDER BY donor_email', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donor Communication Preferences</h2>
        ${NAV_LINKS}
        <p style="color:#666;margin-bottom:20px">Manage how and when to contact donors</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:center">Email</th><th style="padding:10px;text-align:center">SMS</th><th style="padding:10px;text-align:center">WhatsApp</th><th style="padding:10px;text-align:left">Channel</th><th style="padding:10px;text-align:left">Frequency</th><th style="padding:10px;text-align:center">DNC</th></tr></thead>
          <tbody>${prefs.map(p => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(p.donor_email)}</td>
            <td style="padding:10px;text-align:center;color:${p.email_enabled?'#059669':'#dc2626'}">${p.email_enabled?'Yes':'No'}</td>
            <td style="padding:10px;text-align:center;color:${p.sms_enabled?'#059669':'#dc2626'}">${p.sms_enabled?'Yes':'No'}</td>
            <td style="padding:10px;text-align:center;color:${p.whatsapp_enabled?'#059669':'#dc2626'}">${p.whatsapp_enabled?'Yes':'No'}</td>
            <td style="padding:10px">${esc(p.preferred_channel)}</td>
            <td style="padding:10px">${esc(p.preferred_frequency)}</td>
            <td style="padding:10px;text-align:center">${p.do_not_contact?'<span style="color:#dc2626;font-weight:700">DNC</span>':'-'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor Comm Prefs', html, req.session.user));
  }));

  // =============================================
  // FEATURE 11: DONOR RELATIONSHIP MAPPING
  // =============================================

  app.get('/api/donor-relationships', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_relationships WHERE tenant_id=$1 ORDER BY discovered_at DESC', [tid]);
    res.json({ relationships: result.rows });
  }));

  app.post('/api/donor-relationships', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_a_email, donor_b_email, relationship_type, strength, notes } = req.body;
    if (!donor_a_email || !donor_b_email) return res.status(400).json({ error: 'donor_a_email and donor_b_email required' });
    const result = await pool.query(
      'INSERT INTO donor_relationships(tenant_id,donor_a_email,donor_b_email,relationship_type,strength,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [tid, donor_a_email, donor_b_email, relationship_type||'colleague', parseInt(strength)||5, notes]
    );
    if(audit) await audit(req, 'donor_relationship_created', 'donor_relationships', result.rows[0].id);
    res.json({ success: true, relationship: result.rows[0] });
  }));

  app.put('/api/donor-relationships/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { relationship_type, strength, notes } = req.body;
    const result = await pool.query(
      `UPDATE donor_relationships SET relationship_type=COALESCE($1,relationship_type), strength=COALESCE($2,strength), notes=COALESCE($3,notes) WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [relationship_type, strength?parseInt(strength):null, notes, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, relationship: result.rows[0] });
  }));

  app.delete('/api/donor-relationships/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM donor_relationships WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.get('/api/donor-relationships/map/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = req.params.email;
    const direct = (await pool.query('SELECT * FROM donor_relationships WHERE tenant_id=$1 AND (donor_a_email=$2 OR donor_b_email=$2)', [tid, email])).rows;
    // Get secondary connections
    const connected = direct.map(r => r.donor_a_email === email ? r.donor_b_email : r.donor_a_email);
    let secondary = [];
    for (const ce of connected) {
      const sec = (await pool.query('SELECT * FROM donor_relationships WHERE tenant_id=$1 AND (donor_a_email=$2 OR donor_b_email=$2) AND donor_a_email!=$3 AND donor_b_email!=$3', [tid, ce, email])).rows;
      secondary = secondary.concat(sec);
    }
    res.json({ center: email, direct_relationships: direct, secondary_connections: secondary });
  }));

  app.get('/api/donor-relationships/network-stats', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const totalRels = (await pool.query('SELECT COUNT(*) as cnt FROM donor_relationships WHERE tenant_id=$1', [tid])).rows[0].cnt;
    const uniqueDonors = (await pool.query('SELECT COUNT(DISTINCT email) as cnt FROM (SELECT donor_a_email as email FROM donor_relationships WHERE tenant_id=$1 UNION SELECT donor_b_email FROM donor_relationships WHERE tenant_id=$1) sub', [tid])).rows[0].cnt;
    const byType = (await pool.query('SELECT relationship_type, COUNT(*) as cnt FROM donor_relationships WHERE tenant_id=$1 GROUP BY relationship_type', [tid])).rows;
    res.json({ total_relationships: parseInt(totalRels), unique_donors: parseInt(uniqueDonors), by_type: byType });
  }));

  app.get('/donor-relationships', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rels = (await pool.query('SELECT * FROM donor_relationships WHERE tenant_id=$1 ORDER BY discovered_at DESC', [tid])).rows;
    const stats = (await pool.query('SELECT COUNT(*) as cnt FROM donor_relationships WHERE tenant_id=$1', [tid])).rows[0];
    const html = `
      <div class="card">
        <h2>Donor Relationship Mapping</h2>
        ${NAV_LINKS}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="padding:20px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0"><div style="font-size:14px;color:#666">Total Relationships</div><div style="font-size:28px;font-weight:700;color:#059669">${stats.cnt}</div></div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Donor A</th><th style="padding:10px;text-align:left">Donor B</th><th style="padding:10px;text-align:left">Type</th><th style="padding:10px;text-align:center">Strength</th><th style="padding:10px;text-align:left">Notes</th></tr></thead>
          <tbody>${rels.map(r => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(r.donor_a_email)}</td>
            <td style="padding:10px">${esc(r.donor_b_email)}</td>
            <td style="padding:10px"><span style="padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:#6d28d9">${esc(r.relationship_type||'linked')}</span></td>
            <td style="padding:10px;text-align:center">${r.strength}/10</td>
            <td style="padding:10px;font-size:13px">${esc(r.notes||'')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor Relationships', html, req.session.user));
  }));

  // =============================================
  // FEATURE 12: NEXT BEST ACTION ENGINE
  // =============================================

  app.get('/api/donor-next-actions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM donor_next_actions WHERE tenant_id=$1 AND status='pending' ORDER BY priority DESC, due_date ASC", [tid]);
    res.json({ actions: result.rows });
  }));

  app.get('/api/donor-next-actions/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("SELECT * FROM donor_next_actions WHERE tenant_id=$1 AND donor_email=$2 ORDER BY priority DESC, created_at DESC", [tid, req.params.email]);
    res.json({ actions: result.rows });
  }));

  app.post('/api/donor-next-actions/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const donors = (await pool.query('SELECT donor_email, SUM(amount) as total, MAX(created_at) as last_donation, COUNT(*) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false GROUP BY donor_email', [tid])).rows;
    let generated = 0;
    for (const d of donors) {
      const daysSince = Math.floor((Date.now() - new Date(d.last_donation).getTime()) / 86400000);
      let action, actionType, priority, reason, suggestedAmount;
      if (daysSince > 180) {
        action = 'Send re-engagement email'; actionType = 'email'; priority = 9;
        reason = `Has not donated in ${daysSince} days`; suggestedAmount = Math.round(parseFloat(d.total) / parseInt(d.count) * 0.5);
      } else if (daysSince > 90) {
        action = 'Schedule thank-you call'; actionType = 'call'; priority = 7;
        reason = `Last donation ${daysSince} days ago - check in`; suggestedAmount = null;
      } else if (parseInt(d.count) === 1) {
        action = 'Invite to campaign update event'; actionType = 'event'; priority = 6;
        reason = 'First-time donor - cultivate relationship'; suggestedAmount = Math.round(parseFloat(d.total) * 1.2);
      } else if (parseInt(d.total) > 5000000) {
        action = 'Schedule major gift discussion'; actionType = 'meeting'; priority = 10;
        reason = `Major donor with total ${formatUGX(d.total)}`; suggestedAmount = Math.round(parseFloat(d.total) * 0.3);
      } else {
        action = 'Send impact report'; actionType = 'email'; priority = 4;
        reason = 'Regular engagement touchpoint'; suggestedAmount = Math.round(parseFloat(d.total) / parseInt(d.count));
      }
      const dueDate = new Date(Date.now() + (10 - priority) * 3 * 86400000).toISOString().split('T')[0];
      await pool.query(
        'INSERT INTO donor_next_actions(tenant_id,donor_email,suggested_action,action_type,priority,reason,suggested_amount,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [tid, d.donor_email, action, actionType, priority, reason, suggestedAmount, dueDate]
      );
      generated++;
    }
    if(audit) await audit(req, 'next_actions_generated', null, null);
    res.json({ success: true, generated });
  }));

  app.post('/api/donor-next-actions/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query("UPDATE donor_next_actions SET status='completed' WHERE id=$1 AND tenant_id=$2 RETURNING *", [req.params.id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  }));

  app.get('/donor-next-actions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const actions = (await pool.query("SELECT * FROM donor_next_actions WHERE tenant_id=$1 AND status='pending' ORDER BY priority DESC, due_date ASC", [tid])).rows;
    const html = `
      <div class="card">
        <h2>Next Best Action Engine</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Suggested optimal next step per donor</p>
          <button onclick="fetch('/api/donor-next-actions/generate',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Generated '+d.generated+' actions');location.reload()})" class="btn" style="background:#be185d;color:white">Generate Actions</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Donor</th><th style="padding:10px;text-align:left">Suggested Action</th><th style="padding:10px;text-align:center">Priority</th><th style="padding:10px;text-align:right">Suggested Amt</th><th style="padding:10px;text-align:left">Due</th><th style="padding:10px">Complete</th></tr></thead>
          <tbody>${actions.map(a => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(a.donor_email)}</td>
            <td style="padding:10px"><div style="font-weight:600">${esc(a.suggested_action)}</div><div style="font-size:12px;color:#666">${esc(a.reason||'')}</div></td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;color:#fff;font-weight:700;font-size:12px;text-align:center;background:${a.priority>=8?'#dc2626':a.priority>=5?'#d97706':'#059669'}">${a.priority}</span></td>
            <td style="padding:10px;text-align:right">${a.suggested_amount?formatUGX(a.suggested_amount):'-'}</td>
            <td style="padding:10px">${a.due_date||'-'}</td>
            <td style="padding:10px"><button onclick="fetch('/api/donor-next-actions/${a.id}/complete',{method:'POST'}).then(()=>location.reload())" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Done</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Next Best Actions', html, req.session.user));
  }));

  // =============================================
  // FEATURE 13: DONOR LIFETIME VALUE CALCULATOR
  // =============================================

  app.get('/api/donor-ltv', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_ltv WHERE tenant_id=$1 ORDER BY predicted_ltv DESC', [tid]);
    res.json({ ltvs: result.rows });
  }));

  app.get('/api/donor-ltv/:email', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_ltv WHERE tenant_id=$1 AND donor_email=$2', [tid, req.params.email]);
    if (!result.rows.length) return res.json({ ltv: null });
    res.json({ ltv: result.rows[0] });
  }));

  app.post('/api/donor-ltv/recalculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const donors = (await pool.query(`SELECT donor_email, SUM(amount) as total, MIN(created_at) as first_donation, MAX(created_at) as last_donation, COUNT(*) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL GROUP BY donor_email`, [tid])).rows;
    let recalculated = 0;
    for (const d of donors) {
      const total = parseInt(d.total) || 0;
      const firstDate = new Date(d.first_donation);
      const lastDate = new Date(d.last_donation);
      const yearsActive = Math.max(0.5, (lastDate - firstDate) / (365.25 * 86400000));
      const avgAnnual = Math.round(total / yearsActive);
      const predictedYears = Math.min(20, Math.round(Math.max(3, 10 - yearsActive * 0.3)));
      const predictedLtv = avgAnnual * predictedYears;
      let tier = 'bronze';
      if (predictedLtv >= 20000000) tier = 'diamond';
      else if (predictedLtv >= 10000000) tier = 'platinum';
      else if (predictedLtv >= 5000000) tier = 'gold';
      else if (predictedLtv >= 1000000) tier = 'silver';
      await pool.query(
        `INSERT INTO donor_ltv(tenant_id,donor_email,total_given,avg_annual,predicted_years,predicted_ltv,ltv_tier,calculated_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(tenant_id,donor_email) DO UPDATE SET total_given=$3,avg_annual=$4,predicted_years=$5,predicted_ltv=$6,ltv_tier=$7,calculated_at=NOW()`,
        [tid, d.donor_email, total, avgAnnual, predictedYears, predictedLtv, tier]
      );
      recalculated++;
    }
    if(audit) await audit(req, 'donor_ltv_recalculated', null, null);
    res.json({ success: true, recalculated });
  }));

  app.get('/api/donor-ltv/top', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_ltv WHERE tenant_id=$1 ORDER BY predicted_ltv DESC LIMIT 20', [tid]);
    res.json({ top_ltvs: result.rows });
  }));

  app.get('/api/donor-ltv/stats', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = (await pool.query(`SELECT ltv_tier, COUNT(*) as count, COALESCE(SUM(predicted_ltv),0) as total_ltv, COALESCE(AVG(predicted_ltv),0) as avg_ltv FROM donor_ltv WHERE tenant_id=$1 GROUP BY ltv_tier ORDER BY total_ltv DESC`, [tid])).rows;
    res.json({ stats });
  }));

  app.get('/donor-ltv', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const ltvs = (await pool.query('SELECT * FROM donor_ltv WHERE tenant_id=$1 ORDER BY predicted_ltv DESC', [tid])).rows;
    const tierColors = {diamond:'#B9F2FF',platinum:'#E5E4E2',gold:'#FFD700',silver:'#C0C0C0',bronze:'#CD7F32'};
    const html = `
      <div class="card">
        <h2>Donor Lifetime Value</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Predict total lifetime giving per donor</p>
          <button onclick="fetch('/api/donor-ltv/recalculate',{method:'POST'}).then(()=>location.reload())" class="btn" style="background:#1d4ed8;color:white">Recalculate All</button>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Email</th><th style="padding:10px;text-align:right">Total Given</th><th style="padding:10px;text-align:right">Avg Annual</th><th style="padding:10px;text-align:center">Predicted Years</th><th style="padding:10px;text-align:right">Predicted LTV</th><th style="padding:10px;text-align:center">Tier</th></tr></thead>
          <tbody>${ltvs.map(l => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px">${esc(l.donor_email)}</td>
            <td style="padding:10px;text-align:right;font-weight:600">${formatUGX(l.total_given)}</td>
            <td style="padding:10px;text-align:right">${formatUGX(l.avg_annual)}</td>
            <td style="padding:10px;text-align:center">${l.predicted_years}</td>
            <td style="padding:10px;text-align:right;font-weight:700;color:#1d4ed8">${formatUGX(l.predicted_ltv)}</td>
            <td style="padding:10px;text-align:center"><span style="display:inline-block;padding:2px 12px;border-radius:12px;font-size:12px;font-weight:600;color:#333;background:${tierColors[l.ltv_tier]||'#eee'}">${esc(l.ltv_tier)}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Donor LTV', html, req.session.user));
  }));

  // =============================================
  // FEATURE 14: DONOR RE-ENGAGEMENT CAMPAIGNS
  // =============================================

  app.get('/api/reengagement-campaigns', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM reengagement_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.json({ campaigns: result.rows });
  }));

  app.post('/api/reengagement-campaigns', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, target_segment, trigger_days_inactive, channels_json, message_templates_json } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await pool.query(
      'INSERT INTO reengagement_campaigns(tenant_id,name,target_segment,trigger_days_inactive,channels_json,message_templates_json,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [tid, name, target_segment, parseInt(trigger_days_inactive)||90, channels_json?JSON.stringify(channels_json):'["email"]', message_templates_json?JSON.stringify(message_templates_json):'{}', req.session.user.email]
    );
    if(audit) await audit(req, 'reengagement_campaign_created', 'reengagement_campaigns', result.rows[0].id);
    res.json({ success: true, campaign: result.rows[0] });
  }));

  app.put('/api/reengagement-campaigns/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, target_segment, trigger_days_inactive, channels_json, message_templates_json, status } = req.body;
    const result = await pool.query(
      `UPDATE reengagement_campaigns SET name=COALESCE($1,name), target_segment=COALESCE($2,target_segment), trigger_days_inactive=COALESCE($3,trigger_days_inactive), channels_json=COALESCE($4,channels_json), message_templates_json=COALESCE($5,message_templates_json), status=COALESCE($6,status) WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [name, target_segment, trigger_days_inactive?parseInt(trigger_days_inactive):null, channels_json?JSON.stringify(channels_json):null, message_templates_json?JSON.stringify(message_templates_json):null, status, req.params.id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, campaign: result.rows[0] });
  }));

  app.delete('/api/reengagement-campaigns/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM reengagement_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ success: true });
  }));

  app.post('/api/reengagement-campaigns/:id/launch', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaign = (await pool.query('SELECT * FROM reengagement_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    // Find inactive donors matching trigger
    const inactive = (await pool.query(`SELECT donor_email, MAX(created_at) as last_donation FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL GROUP BY donor_email HAVING MAX(created_at) < NOW() - INTERVAL '1 day' * $2`, [tid, campaign.trigger_days_inactive])).rows;
    let targeted = 0;
    await pool.query("UPDATE reengagement_campaigns SET status='active' WHERE id=$1", [req.params.id]);
    for (const d of inactive) {
      await pool.query(
        'INSERT INTO reengagement_logs(tenant_id,campaign_id,donor_email,channel) VALUES($1,$2,$3,$4)',
        [tid, req.params.id, d.donor_email, 'email']
      );
      // Send re-engagement email
      try {
        if (sendEmail) {
          await sendEmail(d.donor_email, `We Miss You! - ${campaign.name}`,
            `<p>Dear Supporter,</p><p>We noticed it's been a while since your last donation. We'd love to have you back!</p><p>${esc(campaign.name)}</p>`);
        }
      } catch(e) { console.warn('[Reengagement] Email error:', e.message); }
      targeted++;
    }
    await pool.query('UPDATE reengagement_campaigns SET donors_targeted=$1 WHERE id=$2', [targeted, req.params.id]);
    if(audit) await audit(req, 'reengagement_launched', 'reengagement_campaigns', req.params.id);
    res.json({ success: true, targeted });
  }));

  app.get('/api/reengagement-campaigns/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaign = (await pool.query('SELECT * FROM reengagement_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    const logs = (await pool.query('SELECT * FROM reengagement_logs WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY sent_at DESC', [req.params.id, tid])).rows;
    const responded = logs.filter(l => l.responded).length;
    res.json({ campaign, logs, stats: { targeted: logs.length, responded, rate: logs.length ? Math.round((responded/logs.length)*100) : 0 } });
  }));

  app.get('/reengagement-campaigns', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaigns = (await pool.query('SELECT * FROM reengagement_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Donor Re-engagement Campaigns</h2>
        ${NAV_LINKS}
        <p style="color:#666;margin-bottom:20px">Automated win-back campaigns for lapsed donors</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px">
          ${campaigns.map(c => `<div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;background:white">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h3 style="margin:0">${esc(c.name)}</h3>
              <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${c.status==='active'?'#059669':c.status==='completed'?'#2563eb':c.status==='paused'?'#d97706':'#999'}">${esc(c.status)}</span>
            </div>
            <div style="font-size:13px;color:#666">Target: ${esc(c.target_segment||'All lapsed')} | Trigger: ${c.trigger_days_inactive} days inactive</div>
            <div style="font-size:13px;color:#666;margin-top:4px">Targeted: ${c.donors_targeted} | Reactivated: ${c.donors_reactivated}</div>
            ${c.status==='draft'?`<button onclick="fetch('/api/reengagement-campaigns/${c.id}/launch',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Launched! Targeted '+d.targeted+' donors');location.reload()})" style="margin-top:8px;padding:4px 12px;background:#c2410c;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">Launch</button>`:''}
          </div>`).join('')}
        </div>
      </div>`;
    res.send(renderPage('Re-engagement Campaigns', html, req.session.user));
  }));

  // =============================================
  // FEATURE 15: ANNUAL GIVING PREDICTOR
  // =============================================

  app.get('/api/annual-giving-forecast', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM annual_giving_forecasts WHERE tenant_id=$1 ORDER BY year DESC', [tid]);
    res.json({ forecasts: result.rows });
  }));

  app.post('/api/annual-giving-forecast/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Get yearly donation totals
    const yearly = (await pool.query(`SELECT EXTRACT(YEAR FROM created_at) as year, SUM(amount) as total, COUNT(DISTINCT donor_email) as donors, COUNT(*) as donations FROM campaign_donations WHERE tenant_id=$1 AND refunded=false GROUP BY EXTRACT(YEAR FROM created_at) ORDER BY year`, [tid])).rows;
    if (!yearly.length) return res.json({ success: true, generated: 0 });

    // Calculate year-over-year growth
    let totalGrowthRate = 0.15; // default 15% growth
    if (yearly.length >= 2) {
      const recent = parseInt(yearly[yearly.length - 1].total);
      const prev = parseInt(yearly[yearly.length - 2].total);
      if (prev > 0) totalGrowthRate = (recent - prev) / prev;
    }

    const currentYear = new Date().getFullYear();
    let generated = 0;

    // Store historical years
    for (const y of yearly) {
      const yr = parseInt(y.year);
      const total = parseInt(y.total);
      const donors = parseInt(y.donors);
      const avg = donors > 0 ? Math.round(total / donors) : 0;
      const low = Math.round(total * 0.85);
      const high = Math.round(total * 1.15);
      await pool.query(
        `INSERT INTO annual_giving_forecasts(tenant_id,year,forecasted_total,forecasted_donors,forecasted_avg,confidence_low,confidence_high,actual_total,method,calculated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'actual',NOW()) ON CONFLICT(tenant_id,year) DO UPDATE SET actual_total=$8,calculated_at=NOW()`,
        [tid, yr, total, donors, avg, low, high, total]
      );
      generated++;
    }

    // Forecast next 3 years
    const lastActual = yearly[yearly.length - 1];
    let prevTotal = parseInt(lastActual.total);
    let prevDonors = parseInt(lastActual.donors);
    for (let i = 1; i <= 3; i++) {
      const yr = currentYear + i;
      const forecastTotal = Math.round(prevTotal * (1 + totalGrowthRate));
      const forecastDonors = Math.round(prevDonors * (1 + totalGrowthRate * 0.5));
      const forecastAvg = forecastDonors > 0 ? Math.round(forecastTotal / forecastDonors) : 0;
      const confidenceLow = Math.round(forecastTotal * 0.75);
      const confidenceHigh = Math.round(forecastTotal * 1.25);
      await pool.query(
        `INSERT INTO annual_giving_forecasts(tenant_id,year,forecasted_total,forecasted_donors,forecasted_avg,confidence_low,confidence_high,method,calculated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'linear',NOW()) ON CONFLICT(tenant_id,year) DO UPDATE SET forecasted_total=$3,forecasted_donors=$4,forecasted_avg=$5,confidence_low=$6,confidence_high=$7,method='linear',calculated_at=NOW()`,
        [tid, yr, forecastTotal, forecastDonors, forecastAvg, confidenceLow, confidenceHigh]
      );
      prevTotal = forecastTotal;
      prevDonors = forecastDonors;
      generated++;
    }

    if(audit) await audit(req, 'annual_forecast_generated', null, null);
    res.json({ success: true, generated });
  }));

  app.get('/api/annual-giving-forecast/years', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT year, forecasted_total, actual_total FROM annual_giving_forecasts WHERE tenant_id=$1 ORDER BY year', [tid]);
    res.json({ years: result.rows });
  }));

  app.get('/annual-giving-forecast', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const forecasts = (await pool.query('SELECT * FROM annual_giving_forecasts WHERE tenant_id=$1 ORDER BY year', [tid])).rows;
    const html = `
      <div class="card">
        <h2>Annual Giving Predictor</h2>
        ${NAV_LINKS}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <p style="color:#666">Forecast yearly donation totals</p>
          <button onclick="fetch('/api/annual-giving-forecast/generate',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Generated '+d.generated+' forecasts');location.reload()})" class="btn" style="background:#15803d;color:white">Generate Forecast</button>
        </div>
        ${forecasts.length?`
        <div style="padding:20px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px">
          <h3>Forecast Trend</h3>
          <div style="display:flex;align-items:flex-end;gap:8px;height:220px;margin-top:12px">
            ${forecasts.map(f => {
              const maxVal = Math.max(...forecasts.map(x => Math.max(parseInt(x.forecasted_total)||0, parseInt(x.actual_total)||0)), 1);
              const val = parseInt(f.actual_total) || parseInt(f.forecasted_total) || 0;
              const h = Math.max(4, Math.round((val / maxVal) * 190));
              const isActual = f.actual_total !== null;
              return `<div style="flex:1;text-align:center">
                <div style="font-size:11px;color:#666;margin-bottom:4px">${formatUGX(val)}</div>
                <div style="background:${isActual?'#059669':'#15803d'};border-radius:4px 4px 0 0;height:${h}px;opacity:${isActual?1:0.6}"></div>
                <div style="font-size:11px;color:#666;margin-top:4px">${f.year}</div>
              </div>`;
            }).join('')}
          </div>
        </div>`:''}
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Year</th><th style="padding:10px;text-align:right">Forecast</th><th style="padding:10px;text-align:right">Donors</th><th style="padding:10px;text-align:right">Avg</th><th style="padding:10px;text-align:right">Low</th><th style="padding:10px;text-align:right">High</th><th style="padding:10px;text-align:right">Actual</th><th style="padding:10px">Method</th></tr></thead>
          <tbody>${forecasts.map(f => `<tr style="border-bottom:1px solid #e2e8f0">
            <td style="padding:10px;font-weight:600">${f.year}</td>
            <td style="padding:10px;text-align:right;font-weight:600;color:#15803d">${formatUGX(f.forecasted_total)}</td>
            <td style="padding:10px;text-align:right">${f.forecasted_donors||'-'}</td>
            <td style="padding:10px;text-align:right">${formatUGX(f.forecasted_avg)}</td>
            <td style="padding:10px;text-align:right;color:#666">${formatUGX(f.confidence_low)}</td>
            <td style="padding:10px;text-align:right;color:#666">${formatUGX(f.confidence_high)}</td>
            <td style="padding:10px;text-align:right;font-weight:600;color:${f.actual_total?'#059669':'#999'}">${f.actual_total?formatUGX(f.actual_total):'-'}</td>
            <td style="padding:10px;text-align:center"><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:${f.method==='actual'?'#059669':'#15803d'}">${esc(f.method)}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
    res.send(renderPage('Annual Giving Forecast', html, req.session.user));
  }));

  console.log('[FundraisingUltimate2] Module loaded — 15 features registered');
};
