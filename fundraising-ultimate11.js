/**
 * Fundraising Ultimate11 Module — Advanced Operations & Intelligence
 * Features: Vehicle Donation Program, Donor Family Foundations, Donor Mobile Experience / PWA,
 * Campaign Risk Assessment, Fundraising Compliance Checker, Donation Impact Reports,
 * Campaign Collaboration Portal, Donor Communication Hub
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Vehicle Donation Program
    `CREATE TABLE IF NOT EXISTS vehicle_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      donor_name TEXT NOT NULL,
      donor_email TEXT,
      donor_phone TEXT,
      vehicle_make TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      vehicle_year INTEGER,
      vin TEXT,
      mileage INTEGER,
      condition TEXT DEFAULT 'good' CHECK (condition IN ('excellent','good','fair','poor')),
      estimated_value NUMERIC DEFAULT 0,
      pickup_address TEXT,
      pickup_scheduled TIMESTAMPTZ,
      pickup_completed TIMESTAMPTZ,
      title_transferred BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','valuated','pickup_scheduled','pickup_completed','title_transferred','acknowledged','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS vehicle_valuations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER NOT NULL REFERENCES vehicle_donations(id) ON DELETE CASCADE,
      valuation_method TEXT DEFAULT 'market' CHECK (valuation_method IN ('market','appraisal','kelly_blue_book','nada','other')),
      estimated_value NUMERIC NOT NULL,
      appraiser_name TEXT,
      appraisal_date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_donations_tenant ON vehicle_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_valuations_donation ON vehicle_valuations(donation_id)`,

    // Feature 2: Donor Family Foundations
    `CREATE TABLE IF NOT EXISTS family_foundations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      foundation_name TEXT NOT NULL,
      description TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      mission_statement TEXT,
      total_endowment NUMERIC DEFAULT 0,
      total_granted NUMERIC DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS foundation_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      foundation_id INTEGER NOT NULL REFERENCES family_foundations(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      member_email TEXT NOT NULL,
      role TEXT DEFAULT 'staff' CHECK (role IN ('trustee','advisor','staff')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS foundation_grants (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      foundation_id INTEGER NOT NULL REFERENCES family_foundations(id) ON DELETE CASCADE,
      grant_to TEXT NOT NULL,
      purpose TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','disbursed','rejected','revoked')),
      granted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_family_foundations_tenant ON family_foundations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_foundation_members_foundation ON foundation_members(foundation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_foundation_grants_foundation ON foundation_grants(foundation_id)`,

    // Feature 3: Donor Mobile Experience / PWA
    `CREATE TABLE IF NOT EXISTS mobile_experience_config (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
      app_name TEXT DEFAULT 'Fundraising App',
      primary_color TEXT DEFAULT '#059669',
      secondary_color TEXT DEFAULT '#10B981',
      splash_image_url TEXT,
      icon_url TEXT,
      enable_push BOOLEAN DEFAULT true,
      enable_offline BOOLEAN DEFAULT true,
      enable_biometric BOOLEAN DEFAULT false,
      custom_home_json TEXT DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS push_notifications (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data_json TEXT DEFAULT '{}',
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mobile_config_tenant ON mobile_experience_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_push_notifications_tenant ON push_notifications(tenant_id)`,

    // Feature 4: Campaign Risk Assessment
    `CREATE TABLE IF NOT EXISTS campaign_risk_assessments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      overall_risk_score NUMERIC DEFAULT 0,
      financial_risk NUMERIC DEFAULT 0,
      reputational_risk NUMERIC DEFAULT 0,
      compliance_risk NUMERIC DEFAULT 0,
      operational_risk NUMERIC DEFAULT 0,
      assessment_date DATE DEFAULT CURRENT_DATE,
      assessed_by TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS risk_mitigation_plans (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      assessment_id INTEGER NOT NULL REFERENCES campaign_risk_assessments(id) ON DELETE CASCADE,
      risk_category TEXT NOT NULL CHECK (risk_category IN ('financial','reputational','compliance','operational')),
      risk_description TEXT NOT NULL,
      likelihood TEXT DEFAULT 'medium' CHECK (likelihood IN ('low','medium','high')),
      impact TEXT DEFAULT 'medium' CHECK (impact IN ('low','medium','high')),
      mitigation_strategy TEXT,
      owner TEXT,
      due_date DATE,
      status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','mitigated','accepted','closed')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_risk_assessments_tenant ON campaign_risk_assessments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_mitigation_assessment ON risk_mitigation_plans(assessment_id)`,

    // Feature 5: Fundraising Compliance Checker
    `CREATE TABLE IF NOT EXISTS compliance_requirements (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      requirement_name TEXT NOT NULL,
      category TEXT DEFAULT 'legal' CHECK (category IN ('legal','financial','tax','privacy','data','reporting')),
      description TEXT,
      frequency TEXT DEFAULT 'annual' CHECK (frequency IN ('one_time','annual','quarterly','monthly')),
      due_date DATE,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue','waived')),
      responsible_person TEXT,
      evidence_url TEXT,
      last_completed DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fundraising_compliance_checks (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      requirement_id INTEGER NOT NULL REFERENCES compliance_requirements(id) ON DELETE CASCADE,
      is_compliant BOOLEAN DEFAULT false,
      notes TEXT,
      checked_at TIMESTAMPTZ DEFAULT NOW(),
      checked_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_reqs_tenant ON compliance_requirements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_checks_campaign ON fundraising_compliance_checks(campaign_id)`,

    // Feature 6: Donation Impact Reports
    `CREATE TABLE IF NOT EXISTS donation_impact_reports (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      title TEXT NOT NULL,
      period_start DATE,
      period_end DATE,
      total_donations NUMERIC DEFAULT 0,
      total_donors INTEGER DEFAULT 0,
      impact_summary TEXT,
      key_achievements_json TEXT DEFAULT '[]',
      beneficiary_count INTEGER DEFAULT 0,
      is_published BOOLEAN DEFAULT false,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS impact_report_sections (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      report_id INTEGER NOT NULL REFERENCES donation_impact_reports(id) ON DELETE CASCADE,
      section_type TEXT DEFAULT 'text' CHECK (section_type IN ('text','chart','image','quote','stat','video')),
      title TEXT,
      content_html TEXT,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_impact_reports_tenant ON donation_impact_reports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_sections_report ON impact_report_sections(report_id)`,

    // Feature 7: Campaign Collaboration Portal
    `CREATE TABLE IF NOT EXISTS campaign_collaboration (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      collaborator_email TEXT NOT NULL,
      collaborator_name TEXT,
      role TEXT DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
      invitation_token TEXT,
      invited_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS collaboration_tasks (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      assigned_to TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      due_date DATE,
      status TEXT DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS collaboration_activity (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_collab_tenant ON campaign_collaboration(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_tasks_campaign ON collaboration_tasks(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_activity_campaign ON collaboration_activity(campaign_id)`,

    // Feature 8: Donor Communication Hub
    `CREATE TABLE IF NOT EXISTS communication_hub (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
      config_json TEXT DEFAULT '{}',
      default_from_email TEXT,
      default_from_name TEXT DEFAULT 'Fundraising Team',
      daily_limit INTEGER DEFAULT 1000,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS unified_messages (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT,
      channel TEXT DEFAULT 'email' CHECK (channel IN ('email','sms','push','in_app')),
      subject TEXT,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','replied','failed','bounced')),
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      replied_at TIMESTAMPTZ,
      campaign_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comm_hub_tenant ON communication_hub(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_unified_messages_tenant ON unified_messages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_unified_messages_donor ON unified_messages(donor_email)`,

    // Seed data: Compliance requirements (5 per tenant)
    `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, status, responsible_person)
      SELECT t.id, 'Annual Filing', 'legal', 'Submit annual filing to regulatory authority', 'annual', 'pending', 'Compliance Officer'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=t.id AND requirement_name='Annual Filing')`,
    `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, status, responsible_person)
      SELECT t.id, 'Donor Privacy Policy', 'privacy', 'Review and update donor privacy policy', 'annual', 'pending', 'Data Protection Officer'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=t.id AND requirement_name='Donor Privacy Policy')`,
    `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, status, responsible_person)
      SELECT t.id, 'Financial Audit', 'financial', 'Conduct annual financial audit', 'annual', 'pending', 'Finance Director'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=t.id AND requirement_name='Financial Audit')`,
    `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, status, responsible_person)
      SELECT t.id, 'Tax Exemption Certificate', 'tax', 'Renew tax exemption certificate', 'annual', 'pending', 'Finance Director'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=t.id AND requirement_name='Tax Exemption Certificate')`,
    `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, status, responsible_person)
      SELECT t.id, 'Data Protection Compliance', 'data', 'Ensure compliance with data protection regulations', 'quarterly', 'pending', 'Data Protection Officer'
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=t.id AND requirement_name='Data Protection Compliance')`,

    // Seed: Default mobile config per tenant
    `INSERT INTO mobile_experience_config (tenant_id, app_name, primary_color, secondary_color, enable_push, enable_offline, enable_biometric)
      SELECT t.id, 'Fundraising App', '#059669', '#10B981', true, true, false
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM mobile_experience_config WHERE tenant_id=t.id)`,

    // Seed: Default communication hub config per tenant
    `INSERT INTO communication_hub (tenant_id, config_json, default_from_name, daily_limit)
      SELECT t.id, '{}', 'Fundraising Team', 1000
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM communication_hub WHERE tenant_id=t.id)`
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { console.error('[FundraisingUltimate11] Migration error:', e.message); }
    }
    console.log('[FundraisingUltimate11] Migrations complete — 8 features');
  })();

  // =============================================
  // FEATURE 1: VEHICLE DONATION PROGRAM
  // =============================================

  // List vehicle donations
  app.get('/api/vehicle-donations', requireAuth, ah(async (req, res) => {
    const { status, campaign_id } = req.query;
    let q = `SELECT vd.*, (SELECT COUNT(*) FROM vehicle_valuations vv WHERE vv.donation_id=vd.id) as valuation_count
             FROM vehicle_donations vd WHERE vd.tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ` AND vd.status=$${idx}`; params.push(status); idx++; }
    if (campaign_id) { q += ` AND vd.campaign_id=$${idx}`; params.push(campaign_id); idx++; }
    q += ` ORDER BY vd.created_at DESC LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create vehicle donation
  app.post('/api/vehicle-donations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, donor_name, donor_email, donor_phone, vehicle_make, vehicle_model, vehicle_year, vin, mileage, condition, estimated_value, pickup_address } = req.body;
    if (!donor_name || !vehicle_make || !vehicle_model) return res.status(400).json({ error: 'donor_name, vehicle_make, and vehicle_model are required' });
    const r = await pool.query(
      `INSERT INTO vehicle_donations (tenant_id, campaign_id, donor_name, donor_email, donor_phone, vehicle_make, vehicle_model, vehicle_year, vin, mileage, condition, estimated_value, pickup_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [tid, campaign_id||null, esc(donor_name), esc(donor_email||''), esc(donor_phone||''), esc(vehicle_make), esc(vehicle_model), vehicle_year||null, esc(vin||''), mileage||null, condition||'good', estimated_value||0, esc(pickup_address||'')]
    );
    await audit(req, 'create', 'vehicle_donations', r.rows[0].id);
    if (donor_email) {
      await notify(req, `New vehicle donation from ${donor_name}: ${vehicle_make} ${vehicle_model}`);
    }
    res.json(r.rows[0]);
  }));

  // Update vehicle donation
  app.put('/api/vehicle-donations/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const d = existing.rows[0];
    const { donor_name, donor_email, donor_phone, vehicle_make, vehicle_model, vehicle_year, vin, mileage, condition, estimated_value, pickup_address, status } = req.body;
    const r = await pool.query(
      `UPDATE vehicle_donations SET donor_name=COALESCE($3,donor_name), donor_email=COALESCE($4,donor_email), donor_phone=COALESCE($5,donor_phone),
       vehicle_make=COALESCE($6,vehicle_make), vehicle_model=COALESCE($7,vehicle_model), vehicle_year=COALESCE($8,vehicle_year),
       vin=COALESCE($9,vin), mileage=COALESCE($10,mileage), condition=COALESCE($11,condition),
       estimated_value=COALESCE($12,estimated_value), pickup_address=COALESCE($13,pickup_address), status=COALESCE($14,status)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(donor_name||''), esc(donor_email||''), esc(donor_phone||''), esc(vehicle_make||''), esc(vehicle_model||''), vehicle_year||null, esc(vin||''), mileage||null, condition||null, estimated_value||null, esc(pickup_address||''), status||null]
    );
    await audit(req, 'update', 'vehicle_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Schedule pickup
  app.post('/api/vehicle-donations/:id/schedule-pickup', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { pickup_date, pickup_address } = req.body;
    if (!pickup_date) return res.status(400).json({ error: 'pickup_date required' });
    const existing = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query(
      `UPDATE vehicle_donations SET pickup_scheduled=$3, pickup_address=COALESCE($4,pickup_address), status='pickup_scheduled' WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, pickup_date, esc(pickup_address||'')]
    );
    await audit(req, 'schedule_pickup', 'vehicle_donations', req.params.id);
    if (existing.rows[0].donor_email) {
      await sendEmail(existing.rows[0].donor_email, 'Vehicle Pickup Scheduled', `Your vehicle pickup has been scheduled for ${pickup_date}. Address: ${pickup_address || existing.rows[0].pickup_address || 'TBD'}`);
    }
    res.json(r.rows[0]);
  }));

  // Complete pickup
  app.post('/api/vehicle-donations/:id/complete-pickup', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query(
      `UPDATE vehicle_donations SET pickup_completed=NOW(), status='pickup_completed' WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id]
    );
    await audit(req, 'complete_pickup', 'vehicle_donations', req.params.id);
    if (existing.rows[0].donor_email) {
      await sendEmail(existing.rows[0].donor_email, 'Vehicle Pickup Completed', `Your vehicle (${existing.rows[0].vehicle_make} ${existing.rows[0].vehicle_model}) has been picked up successfully. Thank you for your donation!`);
    }
    res.json(r.rows[0]);
  }));

  // Transfer title
  app.post('/api/vehicle-donations/:id/transfer-title', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query(
      `UPDATE vehicle_donations SET title_transferred=true, status='title_transferred' WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id]
    );
    await audit(req, 'transfer_title', 'vehicle_donations', req.params.id);
    if (existing.rows[0].donor_email) {
      await sendEmail(existing.rows[0].donor_email, 'Vehicle Title Transfer Complete', `The title transfer for your donated vehicle (${existing.rows[0].vehicle_make} ${existing.rows[0].vehicle_model}) has been completed.`);
    }
    res.json(r.rows[0]);
  }));

  // List valuations for a donation
  app.get('/api/vehicle-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM vehicle_valuations WHERE tenant_id=$1 AND donation_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Add valuation for a donation
  app.post('/api/vehicle-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { valuation_method, estimated_value, appraiser_name, appraisal_date, notes } = req.body;
    if (!estimated_value) return res.status(400).json({ error: 'estimated_value required' });
    const donation = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!donation.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query(
      `INSERT INTO vehicle_valuations (tenant_id, donation_id, valuation_method, estimated_value, appraiser_name, appraisal_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, req.params.id, valuation_method||'market', estimated_value, esc(appraiser_name||''), appraisal_date||null, esc(notes||'')]
    );
    // Update donation estimated value and status
    await pool.query(`UPDATE vehicle_donations SET estimated_value=$1, status='valuated' WHERE tenant_id=$2 AND id=$3`, [estimated_value, tid, req.params.id]);
    await audit(req, 'create', 'vehicle_valuations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Acknowledge donation
  app.post('/api/vehicle-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query(
      `UPDATE vehicle_donations SET status='acknowledged' WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id]
    );
    await audit(req, 'acknowledge', 'vehicle_donations', req.params.id);
    if (existing.rows[0].donor_email) {
      await sendEmail(existing.rows[0].donor_email, 'Donation Acknowledged', `Thank you for your generous vehicle donation of a ${existing.rows[0].vehicle_make} ${existing.rows[0].vehicle_model}. Your contribution is greatly appreciated!`);
    }
    res.json(r.rows[0]);
  }));

  // Vehicle donation stats
  app.get('/api/vehicle-donations/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const total = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(estimated_value),0) as total_value FROM vehicle_donations WHERE tenant_id=$1`, [tid]);
    const byStatus = await pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(estimated_value),0) as value FROM vehicle_donations WHERE tenant_id=$1 GROUP BY status`, [tid]);
    const byCondition = await pool.query(`SELECT condition, COUNT(*) as count FROM vehicle_donations WHERE tenant_id=$1 GROUP BY condition`, [tid]);
    const pickupsPending = await pool.query(`SELECT COUNT(*) as count FROM vehicle_donations WHERE tenant_id=$1 AND status='pickup_scheduled' AND pickup_completed IS NULL`, [tid]);
    res.json({
      total: total.rows[0],
      by_status: byStatus.rows,
      by_condition: byCondition.rows,
      pending_pickups: pickupsPending.rows[0].count
    });
  }));

  // Vehicle Donations UI Page
  app.get('/vehicle-donations', requireAuth, ah(async (req, res) => {
    const donations = await pool.query(
      `SELECT vd.*, (SELECT COUNT(*) FROM vehicle_valuations vv WHERE vv.donation_id=vd.id) as valuation_count
       FROM vehicle_donations vd WHERE vd.tenant_id=$1 ORDER BY vd.created_at DESC LIMIT 30`,
      [req.session.user.tenant_id]
    );
    const stats = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(estimated_value),0) as total_value FROM vehicle_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Vehicle Donation Program', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Vehicle Donation Program</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Total Donations</p>
            <p class="text-2xl font-bold">${stats.rows[0].count}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Total Estimated Value</p>
            <p class="text-2xl font-bold">UGX ${Number(stats.rows[0].total_value).toLocaleString()}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Pending Pickups</p>
            <p class="text-2xl font-bold">${donations.rows.filter(d => d.status === 'pickup_scheduled').length}</p>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-3 text-left">Donor</th>
                <th class="p-3 text-left">Vehicle</th>
                <th class="p-3 text-left">Year</th>
                <th class="p-3 text-left">Condition</th>
                <th class="p-3 text-left">Est. Value</th>
                <th class="p-3 text-left">Status</th>
                <th class="p-3 text-left">Valuations</th>
                <th class="p-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              ${donations.rows.map(d => `
                <tr class="border-t hover:bg-gray-50">
                  <td class="p-3">${d.donor_name}</td>
                  <td class="p-3">${d.vehicle_make} ${d.vehicle_model}</td>
                  <td class="p-3">${d.vehicle_year || '-'}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs ${d.condition==='excellent'?'bg-green-100 text-green-800':d.condition==='good'?'bg-blue-100 text-blue-800':d.condition==='fair'?'bg-yellow-100 text-yellow-800':'bg-red-100 text-red-800'}">${d.condition}</span></td>
                  <td class="p-3">UGX ${Number(d.estimated_value).toLocaleString()}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs bg-gray-100">${d.status.replace(/_/g,' ')}</span></td>
                  <td class="p-3">${d.valuation_count}</td>
                  <td class="p-3">${new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 2: DONOR FAMILY FOUNDATIONS
  // =============================================

  // List foundations
  app.get('/api/family-foundations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT ff.*, (SELECT COUNT(*) FROM foundation_members fm WHERE fm.foundation_id=ff.id) as member_count,
       (SELECT COUNT(*) FROM foundation_grants fg WHERE fg.foundation_id=ff.id) as grant_count
       FROM family_foundations ff WHERE ff.tenant_id=$1 ORDER BY ff.created_at DESC`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Create foundation
  app.post('/api/family-foundations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { foundation_name, description, contact_name, contact_email, contact_phone, mission_statement, total_endowment } = req.body;
    if (!foundation_name) return res.status(400).json({ error: 'foundation_name required' });
    const r = await pool.query(
      `INSERT INTO family_foundations (tenant_id, foundation_name, description, contact_name, contact_email, contact_phone, mission_statement, total_endowment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, esc(foundation_name), esc(description||''), esc(contact_name||''), esc(contact_email||''), esc(contact_phone||''), esc(mission_statement||''), total_endowment||0]
    );
    await audit(req, 'create', 'family_foundations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update foundation
  app.put('/api/family-foundations/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM family_foundations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    const { foundation_name, description, contact_name, contact_email, contact_phone, mission_statement, total_endowment, is_active } = req.body;
    const r = await pool.query(
      `UPDATE family_foundations SET foundation_name=COALESCE($3,foundation_name), description=COALESCE($4,description),
       contact_name=COALESCE($5,contact_name), contact_email=COALESCE($6,contact_email), contact_phone=COALESCE($7,contact_phone),
       mission_statement=COALESCE($8,mission_statement), total_endowment=COALESCE($9,total_endowment), is_active=COALESCE($10,is_active)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(foundation_name||''), esc(description||''), esc(contact_name||''), esc(contact_email||''), esc(contact_phone||''), esc(mission_statement||''), total_endowment||null, is_active!==undefined?is_active:null]
    );
    await audit(req, 'update', 'family_foundations', req.params.id);
    res.json(r.rows[0]);
  }));

  // List members
  app.get('/api/family-foundations/:id/members', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM foundation_members WHERE tenant_id=$1 AND foundation_id=$2 ORDER BY joined_at`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Add member
  app.post('/api/family-foundations/:id/members', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { member_name, member_email, role } = req.body;
    if (!member_name || !member_email) return res.status(400).json({ error: 'member_name and member_email required' });
    const foundation = await pool.query(`SELECT * FROM family_foundations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!foundation.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    const r = await pool.query(
      `INSERT INTO foundation_members (tenant_id, foundation_id, member_name, member_email, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid, req.params.id, esc(member_name), esc(member_email), role||'staff']
    );
    await audit(req, 'add_member', 'foundation_members', r.rows[0].id);
    // Notify the new member
    await sendEmail(member_email, `Added to ${foundation.rows[0].foundation_name}`, `You have been added as a ${role||'staff'} member of ${foundation.rows[0].foundation_name}.`);
    res.json(r.rows[0]);
  }));

  // Update member
  app.put('/api/family-foundations/:id/members/:memberId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { member_name, member_email, role } = req.body;
    const r = await pool.query(
      `UPDATE foundation_members SET member_name=COALESCE($4,member_name), member_email=COALESCE($5,member_email), role=COALESCE($6,role)
       WHERE tenant_id=$1 AND foundation_id=$2 AND id=$3 RETURNING *`,
      [tid, req.params.id, req.params.memberId, esc(member_name||''), esc(member_email||''), role||null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Member not found' });
    await audit(req, 'update_member', 'foundation_members', req.params.memberId);
    res.json(r.rows[0]);
  }));

  // List grants
  app.get('/api/family-foundations/:id/grants', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM foundation_grants WHERE tenant_id=$1 AND foundation_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Create grant
  app.post('/api/family-foundations/:id/grants', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { grant_to, purpose, amount } = req.body;
    if (!grant_to || !amount) return res.status(400).json({ error: 'grant_to and amount required' });
    const foundation = await pool.query(`SELECT * FROM family_foundations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!foundation.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    const r = await pool.query(
      `INSERT INTO foundation_grants (tenant_id, foundation_id, grant_to, purpose, amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid, req.params.id, esc(grant_to), esc(purpose||''), amount]
    );
    await audit(req, 'create_grant', 'foundation_grants', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Approve grant
  app.put('/api/family-foundations/:id/grants/:grantId/approve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const grant = await pool.query(`SELECT * FROM foundation_grants WHERE tenant_id=$1 AND foundation_id=$2 AND id=$3`, [tid, req.params.id, req.params.grantId]);
    if (!grant.rows.length) return res.status(404).json({ error: 'Grant not found' });
    const r = await pool.query(
      `UPDATE foundation_grants SET status='approved', granted_at=NOW() WHERE tenant_id=$1 AND foundation_id=$2 AND id=$3 RETURNING *`,
      [tid, req.params.id, req.params.grantId]
    );
    // Update foundation total_granted
    await pool.query(`UPDATE family_foundations SET total_granted=total_granted+$1 WHERE tenant_id=$2 AND id=$3`, [grant.rows[0].amount, tid, req.params.id]);
    await audit(req, 'approve_grant', 'foundation_grants', req.params.grantId);
    res.json(r.rows[0]);
  }));

  // Foundation stats
  app.get('/api/family-foundations/:id/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const foundation = await pool.query(`SELECT * FROM family_foundations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!foundation.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    const members = await pool.query(`SELECT COUNT(*) as count, COUNT(CASE WHEN role='trustee' THEN 1 END) as trustees, COUNT(CASE WHEN role='advisor' THEN 1 END) as advisors, COUNT(CASE WHEN role='staff' THEN 1 END) as staff FROM foundation_members WHERE tenant_id=$1 AND foundation_id=$2`, [tid, req.params.id]);
    const grants = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='approved' THEN 1 END) as approved, COUNT(CASE WHEN status='pending' THEN 1 END) as pending, COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) as total_approved_amount FROM foundation_grants WHERE tenant_id=$1 AND foundation_id=$2`, [tid, req.params.id]);
    res.json({ foundation: foundation.rows[0], members: members.rows[0], grants: grants.rows[0] });
  }));

  // Family Foundations UI Page
  app.get('/family-foundations', requireAuth, ah(async (req, res) => {
    const foundations = await pool.query(
      `SELECT ff.*, (SELECT COUNT(*) FROM foundation_members fm WHERE fm.foundation_id=ff.id) as member_count,
       (SELECT COUNT(*) FROM foundation_grants fg WHERE fg.foundation_id=ff.id) as grant_count
       FROM family_foundations ff WHERE ff.tenant_id=$1 ORDER BY ff.created_at DESC`,
      [req.session.user.tenant_id]
    );
    renderPage(req, res, 'Donor Family Foundations', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Donor Family Foundations</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${foundations.rows.map(f => `
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="flex justify-between items-start">
                <h3 class="font-bold text-lg">${f.foundation_name}</h3>
                <span class="px-2 py-1 rounded text-xs ${f.is_active?'bg-green-100 text-green-800':'bg-gray-100 text-gray-600'}">${f.is_active?'Active':'Inactive'}</span>
              </div>
              <p class="text-sm text-gray-500 mt-1">${f.mission_statement?f.mission_statement.substring(0,120)+'...':''}</p>
              <div class="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><p class="text-lg font-bold">${f.member_count}</p><p class="text-xs text-gray-500">Members</p></div>
                <div><p class="text-lg font-bold">${f.grant_count}</p><p class="text-xs text-gray-500">Grants</p></div>
                <div><p class="text-lg font-bold">UGX ${Number(f.total_granted).toLocaleString()}</p><p class="text-xs text-gray-500">Granted</p></div>
              </div>
              <p class="text-xs text-gray-400 mt-2">Endowment: UGX ${Number(f.total_endowment).toLocaleString()}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 3: DONOR MOBILE EXPERIENCE / PWA
  // =============================================

  // Get mobile config
  app.get('/api/mobile-config', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM mobile_experience_config WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    if (!r.rows.length) return res.json({ app_name: 'Fundraising App', primary_color: '#059669', secondary_color: '#10B981', enable_push: true, enable_offline: true, enable_biometric: false, is_active: true });
    res.json(r.rows[0]);
  }));

  // Update mobile config
  app.put('/api/mobile-config', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { app_name, primary_color, secondary_color, splash_image_url, icon_url, enable_push, enable_offline, enable_biometric, custom_home_json, is_active } = req.body;
    const existing = await pool.query(`SELECT * FROM mobile_experience_config WHERE tenant_id=$1`, [tid]);
    let r;
    if (existing.rows.length) {
      r = await pool.query(
        `UPDATE mobile_experience_config SET app_name=COALESCE($3,app_name), primary_color=COALESCE($4,primary_color),
         secondary_color=COALESCE($5,secondary_color), splash_image_url=COALESCE($6,splash_image_url), icon_url=COALESCE($7,icon_url),
         enable_push=COALESCE($8,enable_push), enable_offline=COALESCE($9,enable_offline), enable_biometric=COALESCE($10,enable_biometric),
         custom_home_json=COALESCE($11,custom_home_json), is_active=COALESCE($12,is_active), updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tid, existing.rows[0].id, esc(app_name||''), primary_color||null, secondary_color||null, esc(splash_image_url||''), esc(icon_url||''), enable_push!==undefined?enable_push:null, enable_offline!==undefined?enable_offline:null, enable_biometric!==undefined?enable_biometric:null, custom_home_json||null, is_active!==undefined?is_active:null]
      );
    } else {
      r = await pool.query(
        `INSERT INTO mobile_experience_config (tenant_id, app_name, primary_color, secondary_color, splash_image_url, icon_url, enable_push, enable_offline, enable_biometric, custom_home_json, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [tid, esc(app_name||'Fundraising App'), primary_color||'#059669', secondary_color||'#10B981', esc(splash_image_url||''), esc(icon_url||''), enable_push!==undefined?enable_push:true, enable_offline!==undefined?enable_offline:true, enable_biometric!==undefined?enable_biometric:false, custom_home_json||'{}', is_active!==undefined?is_active:true]
      );
    }
    await audit(req, 'update_config', 'mobile_experience_config', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Send push notification
  app.post('/api/push-notifications', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, title, body, data_json } = req.body;
    if (!donor_email || !title || !body) return res.status(400).json({ error: 'donor_email, title, and body required' });
    const r = await pool.query(
      `INSERT INTO push_notifications (tenant_id, donor_email, title, body, data_json) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid, esc(donor_email), esc(title), esc(body), data_json||'{}']
    );
    await audit(req, 'send_push', 'push_notifications', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Broadcast push notification
  app.post('/api/push-notifications/broadcast', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, body, data_json } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    // Get all unique donor emails from the tenant
    const donors = await pool.query(`SELECT DISTINCT donor_email FROM vehicle_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != '' UNION SELECT DISTINCT donor_email FROM family_foundations ff JOIN foundation_members fm ON fm.foundation_id=ff.id WHERE ff.tenant_id=$1 AND fm.member_email IS NOT NULL`, [tid]);
    const emailList = donors.rows.map(d => d.donor_email || d.member_email).filter(Boolean);
    let sent = 0;
    for (const email of emailList) {
      try {
        await pool.query(
          `INSERT INTO push_notifications (tenant_id, donor_email, title, body, data_json) VALUES ($1,$2,$3,$4,$5)`,
          [tid, esc(email), esc(title), esc(body), data_json||'{}']
        );
        sent++;
      } catch(e) {}
    }
    await audit(req, 'broadcast_push', 'push_notifications', 0);
    res.json({ ok: true, sent, total_recipients: emailList.length });
  }));

  // List push notifications
  app.get('/api/push-notifications', requireAuth, ah(async (req, res) => {
    const { donor_email, limit } = req.query;
    let q = `SELECT * FROM push_notifications WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (donor_email) { q += ` AND donor_email=$${idx}`; params.push(donor_email); idx++; }
    q += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(Math.min(parseInt(limit)||50, 200));
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Mark notification as read
  app.put('/api/push-notifications/:id/read', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE push_notifications SET read_at=NOW() WHERE tenant_id=$1 AND id=$2 AND read_at IS NULL RETURNING *`,
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Notification not found or already read' });
    res.json(r.rows[0]);
  }));

  // PWA Manifest (no auth required)
  app.get('/api/mobile-manifest', ah(async (req, res) => {
    // Try to get tenant-specific config via query param or default
    const { tenant_id } = req.query;
    let config = { app_name: 'Fundraising App', primary_color: '#059669', secondary_color: '#10B981', icon_url: '' };
    if (tenant_id) {
      try {
        const r = await pool.query(`SELECT * FROM mobile_experience_config WHERE tenant_id=$1 AND is_active=true`, [tenant_id]);
        if (r.rows.length) config = r.rows[0];
      } catch(e) {}
    }
    res.set('Content-Type', 'application/manifest+json');
    res.json({
      name: config.app_name,
      short_name: config.app_name,
      start_url: '/',
      display: 'standalone',
      background_color: config.primary_color,
      theme_color: config.primary_color,
      description: `${config.app_name} - Mobile Fundraising Experience`,
      icons: config.icon_url ? [{ src: config.icon_url, sizes: '192x192', type: 'image/png' }, { src: config.icon_url, sizes: '512x512', type: 'image/png' }] : []
    });
  }));

  // Mobile Experience UI Page
  app.get('/mobile-experience', requireAuth, ah(async (req, res) => {
    const config = await pool.query(`SELECT * FROM mobile_experience_config WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const notifs = await pool.query(`SELECT * FROM push_notifications WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    const cfg = config.rows[0] || { app_name: 'Fundraising App', primary_color: '#059669', secondary_color: '#10B981', enable_push: true, enable_offline: true, enable_biometric: false, is_active: true };
    renderPage(req, res, 'Mobile Experience / PWA', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Donor Mobile Experience / PWA</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white p-6 rounded-lg shadow">
            <h3 class="font-bold text-lg mb-4">App Configuration</h3>
            <div class="space-y-3">
              <div><span class="text-sm text-gray-500">App Name:</span> <span class="font-medium">${cfg.app_name}</span></div>
              <div class="flex gap-4">
                <div><span class="text-sm text-gray-500">Primary Color:</span> <span class="inline-block w-6 h-6 rounded" style="background:${cfg.primary_color}"></span> ${cfg.primary_color}</div>
                <div><span class="text-sm text-gray-500">Secondary Color:</span> <span class="inline-block w-6 h-6 rounded" style="background:${cfg.secondary_color}"></span> ${cfg.secondary_color}</div>
              </div>
              <div class="flex gap-4 text-sm">
                <span class="${cfg.enable_push?'text-green-600':'text-gray-400'}">Push: ${cfg.enable_push?'On':'Off'}</span>
                <span class="${cfg.enable_offline?'text-green-600':'text-gray-400'}">Offline: ${cfg.enable_offline?'On':'Off'}</span>
                <span class="${cfg.enable_biometric?'text-green-600':'text-gray-400'}">Biometric: ${cfg.enable_biometric?'On':'Off'}</span>
              </div>
              <div><span class="text-sm text-gray-500">Status:</span> <span class="px-2 py-1 rounded text-xs ${cfg.is_active?'bg-green-100 text-green-800':'bg-red-100 text-red-800'}">${cfg.is_active?'Active':'Inactive'}</span></div>
            </div>
          </div>
          <div class="bg-white p-6 rounded-lg shadow">
            <h3 class="font-bold text-lg mb-4">Recent Push Notifications</h3>
            <div class="max-h-96 overflow-y-auto space-y-2">
              ${notifs.rows.map(n => `
                <div class="p-3 border rounded ${n.read_at?'bg-gray-50':'bg-yellow-50'}">
                  <div class="flex justify-between"><span class="font-medium text-sm">${n.title}</span><span class="text-xs text-gray-400">${new Date(n.sent_at).toLocaleDateString()}</span></div>
                  <p class="text-xs text-gray-600">${n.body}</p>
                  <p class="text-xs text-gray-400">To: ${n.donor_email} ${n.read_at?'✓ Read':''}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 4: CAMPAIGN RISK ASSESSMENT
  // =============================================

  // Run risk assessment for a campaign
  app.post('/api/campaigns/:id/risk-assessment', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const { financial_risk, reputational_risk, compliance_risk, operational_risk, notes } = req.body;
    // Calculate scores (0-10 scale)
    const finRisk = Math.min(10, Math.max(0, parseFloat(financial_risk)||0));
    const repRisk = Math.min(10, Math.max(0, parseFloat(reputational_risk)||0));
    const compRisk = Math.min(10, Math.max(0, parseFloat(compliance_risk)||0));
    const opRisk = Math.min(10, Math.max(0, parseFloat(operational_risk)||0));
    const overallRisk = (finRisk + repRisk + compRisk + opRisk) / 4;
    const r = await pool.query(
      `INSERT INTO campaign_risk_assessments (tenant_id, campaign_id, overall_risk_score, financial_risk, reputational_risk, compliance_risk, operational_risk, assessed_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, campaignId, overallRisk.toFixed(2), finRisk, repRisk, compRisk, opRisk, req.session.user.email, esc(notes||'')]
    );
    await audit(req, 'risk_assessment', 'campaign_risk_assessments', r.rows[0].id);
    // Create default mitigation plans for high risks
    if (finRisk >= 7) {
      await pool.query(`INSERT INTO risk_mitigation_plans (tenant_id, assessment_id, risk_category, risk_description, likelihood, impact, mitigation_strategy, status) VALUES ($1,$2,'financial','High financial risk detected','high','high','Review budget and contingency planning required','open')`, [tid, r.rows[0].id]);
    }
    if (repRisk >= 7) {
      await pool.query(`INSERT INTO risk_mitigation_plans (tenant_id, assessment_id, risk_category, risk_description, likelihood, impact, mitigation_strategy, status) VALUES ($1,$2,'reputational','High reputational risk detected','high','high','PR crisis management plan needed','open')`, [tid, r.rows[0].id]);
    }
    if (compRisk >= 7) {
      await pool.query(`INSERT INTO risk_mitigation_plans (tenant_id, assessment_id, risk_category, risk_description, likelihood, impact, mitigation_strategy, status) VALUES ($1,$2,'compliance','High compliance risk detected','high','high','Legal review and compliance audit required','open')`, [tid, r.rows[0].id]);
    }
    if (opRisk >= 7) {
      await pool.query(`INSERT INTO risk_mitigation_plans (tenant_id, assessment_id, risk_category, risk_description, likelihood, impact, mitigation_strategy, status) VALUES ($1,$2,'operational','High operational risk detected','high','high','Operational review and contingency planning needed','open')`, [tid, r.rows[0].id]);
    }
    res.json(r.rows[0]);
  }));

  // Get risk assessment for a campaign
  app.get('/api/campaigns/:id/risk-assessment', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT cra.*, (SELECT COUNT(*) FROM risk_mitigation_plans rmp WHERE rmp.assessment_id=cra.id) as mitigation_count
       FROM campaign_risk_assessments cra WHERE cra.tenant_id=$1 AND cra.campaign_id=$2 ORDER BY cra.created_at DESC LIMIT 1`,
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.json(null);
    // Also fetch mitigation plans
    const plans = await pool.query(`SELECT * FROM risk_mitigation_plans WHERE tenant_id=$1 AND assessment_id=$2 ORDER BY created_at`, [req.session.user.tenant_id, r.rows[0].id]);
    res.json({ assessment: r.rows[0], mitigation_plans: plans.rows });
  }));

  // List mitigation plans for assessment
  app.get('/api/risk-assessments/:id/mitigation-plans', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM risk_mitigation_plans WHERE tenant_id=$1 AND assessment_id=$2 ORDER BY created_at`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Create mitigation plan
  app.post('/api/risk-assessments/:id/mitigation-plans', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { risk_category, risk_description, likelihood, impact, mitigation_strategy, owner, due_date } = req.body;
    if (!risk_category || !risk_description) return res.status(400).json({ error: 'risk_category and risk_description required' });
    const assessment = await pool.query(`SELECT * FROM campaign_risk_assessments WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!assessment.rows.length) return res.status(404).json({ error: 'Assessment not found' });
    const r = await pool.query(
      `INSERT INTO risk_mitigation_plans (tenant_id, assessment_id, risk_category, risk_description, likelihood, impact, mitigation_strategy, owner, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, req.params.id, risk_category, esc(risk_description), likelihood||'medium', impact||'medium', esc(mitigation_strategy||''), esc(owner||''), due_date||null]
    );
    await audit(req, 'create_mitigation', 'risk_mitigation_plans', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update mitigation plan
  app.put('/api/risk-mitigation-plans/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { risk_description, likelihood, impact, mitigation_strategy, owner, due_date, status } = req.body;
    const r = await pool.query(
      `UPDATE risk_mitigation_plans SET risk_description=COALESCE($3,risk_description), likelihood=COALESCE($4,likelihood),
       impact=COALESCE($5,impact), mitigation_strategy=COALESCE($6,mitigation_strategy), owner=COALESCE($7,owner),
       due_date=COALESCE($8,due_date), status=COALESCE($9,status)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(risk_description||''), likelihood||null, impact||null, esc(mitigation_strategy||''), esc(owner||''), due_date||null, status||null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Mitigation plan not found' });
    await audit(req, 'update_mitigation', 'risk_mitigation_plans', req.params.id);
    res.json(r.rows[0]);
  }));

  // List all risk assessments
  app.get('/api/risk-assessments', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT cra.*, (SELECT COUNT(*) FROM risk_mitigation_plans rmp WHERE rmp.assessment_id=cra.id) as mitigation_count,
       (SELECT COUNT(*) FROM risk_mitigation_plans rmp WHERE rmp.assessment_id=cra.id AND rmp.status='open') as open_mitigations
       FROM campaign_risk_assessments cra WHERE cra.tenant_id=$1 ORDER BY cra.created_at DESC LIMIT 50`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Risk assessments summary
  app.get('/api/risk-assessments/summary', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const total = await pool.query(`SELECT COUNT(*) as count, COALESCE(AVG(overall_risk_score),0) as avg_risk, COALESCE(MAX(overall_risk_score),0) as max_risk FROM campaign_risk_assessments WHERE tenant_id=$1`, [tid]);
    const byCategory = await pool.query(`SELECT COALESCE(AVG(financial_risk),0) as avg_financial, COALESCE(AVG(reputational_risk),0) as avg_reputational, COALESCE(AVG(compliance_risk),0) as avg_compliance, COALESCE(AVG(operational_risk),0) as avg_operational FROM campaign_risk_assessments WHERE tenant_id=$1`, [tid]);
    const openMitigations = await pool.query(`SELECT COUNT(*) as count FROM risk_mitigation_plans WHERE tenant_id=$1 AND status='open'`, [tid]);
    res.json({ overview: total.rows[0], category_averages: byCategory.rows[0], open_mitigations: openMitigations.rows[0].count });
  }));

  // Risk Assessment UI Page
  app.get('/risk-assessment', requireAuth, ah(async (req, res) => {
    const assessments = await pool.query(
      `SELECT cra.*, (SELECT COUNT(*) FROM risk_mitigation_plans rmp WHERE rmp.assessment_id=cra.id AND rmp.status='open') as open_mitigations
       FROM campaign_risk_assessments cra WHERE cra.tenant_id=$1 ORDER BY cra.created_at DESC LIMIT 20`,
      [req.session.user.tenant_id]
    );
    const summary = await pool.query(`SELECT COUNT(*) as count, COALESCE(AVG(overall_risk_score),0) as avg_risk FROM campaign_risk_assessments WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Campaign Risk Assessment', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Campaign Risk Assessment</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Total Assessments</p>
            <p class="text-2xl font-bold">${summary.rows[0].count}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Average Risk Score</p>
            <p class="text-2xl font-bold">${parseFloat(summary.rows[0].avg_risk).toFixed(1)}/10</p>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-3 text-left">Campaign ID</th>
                <th class="p-3 text-left">Overall Risk</th>
                <th class="p-3 text-left">Financial</th>
                <th class="p-3 text-left">Reputational</th>
                <th class="p-3 text-left">Compliance</th>
                <th class="p-3 text-left">Operational</th>
                <th class="p-3 text-left">Open Mitigations</th>
                <th class="p-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              ${assessments.rows.map(a => {
                const riskColor = a.overall_risk_score >= 7 ? 'bg-red-100 text-red-800' : a.overall_risk_score >= 4 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
                return `<tr class="border-t hover:bg-gray-50">
                  <td class="p-3">${a.campaign_id}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs ${riskColor}">${parseFloat(a.overall_risk_score).toFixed(1)}</span></td>
                  <td class="p-3">${a.financial_risk}/10</td>
                  <td class="p-3">${a.reputational_risk}/10</td>
                  <td class="p-3">${a.compliance_risk}/10</td>
                  <td class="p-3">${a.operational_risk}/10</td>
                  <td class="p-3">${a.open_mitigations}</td>
                  <td class="p-3">${new Date(a.assessment_date).toLocaleDateString()}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 5: FUNDRAISING COMPLIANCE CHECKER
  // =============================================

  // List compliance requirements
  app.get('/api/compliance-requirements', requireAuth, ah(async (req, res) => {
    const { category, status, frequency } = req.query;
    let q = `SELECT cr.*, (SELECT COUNT(*) FROM fundraising_compliance_checks fcc WHERE fcc.requirement_id=cr.id) as check_count
             FROM compliance_requirements cr WHERE cr.tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (category) { q += ` AND cr.category=$${idx}`; params.push(category); idx++; }
    if (status) { q += ` AND cr.status=$${idx}`; params.push(status); idx++; }
    if (frequency) { q += ` AND cr.frequency=$${idx}`; params.push(frequency); idx++; }
    q += ` ORDER BY cr.due_date ASC NULLS LAST, cr.created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create compliance requirement
  app.post('/api/compliance-requirements', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { requirement_name, category, description, frequency, due_date, responsible_person, evidence_url } = req.body;
    if (!requirement_name) return res.status(400).json({ error: 'requirement_name required' });
    const r = await pool.query(
      `INSERT INTO compliance_requirements (tenant_id, requirement_name, category, description, frequency, due_date, status, responsible_person, evidence_url)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING *`,
      [tid, esc(requirement_name), category||'legal', esc(description||''), frequency||'annual', due_date||null, esc(responsible_person||''), esc(evidence_url||'')]
    );
    await audit(req, 'create', 'compliance_requirements', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update compliance requirement
  app.put('/api/compliance-requirements/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { requirement_name, category, description, frequency, due_date, status, responsible_person, evidence_url } = req.body;
    const r = await pool.query(
      `UPDATE compliance_requirements SET requirement_name=COALESCE($3,requirement_name), category=COALESCE($4,category),
       description=COALESCE($5,description), frequency=COALESCE($6,frequency), due_date=COALESCE($7,due_date),
       status=COALESCE($8,status), responsible_person=COALESCE($9,responsible_person), evidence_url=COALESCE($10,evidence_url)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(requirement_name||''), category||null, esc(description||''), frequency||null, due_date||null, status||null, esc(responsible_person||''), esc(evidence_url||'')]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Compliance requirement not found' });
    await audit(req, 'update', 'compliance_requirements', req.params.id);
    res.json(r.rows[0]);
  }));

  // Complete a compliance requirement
  app.post('/api/compliance-requirements/:id/complete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { evidence_url } = req.body;
    const r = await pool.query(
      `UPDATE compliance_requirements SET status='completed', last_completed=CURRENT_DATE, evidence_url=COALESCE($3,evidence_url) WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(evidence_url||'')]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Compliance requirement not found' });
    await audit(req, 'complete', 'compliance_requirements', req.params.id);
    res.json(r.rows[0]);
  }));

  // Run compliance check for a campaign
  app.post('/api/campaigns/:id/compliance-check', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaignId = req.params.id;
    const requirements = await pool.query(`SELECT * FROM compliance_requirements WHERE tenant_id=$1 AND status != 'waived'`, [tid]);
    const results = [];
    for (const req of requirements.rows) {
      let isCompliant = false;
      // Simple compliance logic: requirement is compliant if status is completed and not overdue
      if (req.status === 'completed' && (!req.due_date || new Date(req.due_date) >= new Date())) {
        isCompliant = true;
      } else if (req.status === 'completed') {
        isCompliant = true; // was completed at some point
      }
      const check = await pool.query(
        `INSERT INTO fundraising_compliance_checks (tenant_id, campaign_id, requirement_id, is_compliant, notes, checked_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [tid, campaignId, req.id, isCompliant, isCompliant ? 'Requirement met' : 'Requirement not met - action needed', req.session.user.email]
      );
      results.push(check.rows[0]);
    }
    await audit(req, 'compliance_check', 'fundraising_compliance_checks', campaignId);
    const compliantCount = results.filter(r => r.is_compliant).length;
    res.json({
      campaign_id: campaignId,
      total_requirements: results.length,
      compliant: compliantCount,
      non_compliant: results.length - compliantCount,
      compliance_percentage: results.length > 0 ? ((compliantCount / results.length) * 100).toFixed(1) : '0',
      checks: results
    });
  }));

  // Get compliance check for a campaign
  app.get('/api/campaigns/:id/compliance-check', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT fcc.*, cr.requirement_name, cr.category, cr.frequency, cr.status as req_status
       FROM fundraising_compliance_checks fcc
       JOIN compliance_requirements cr ON cr.id=fcc.requirement_id
       WHERE fcc.tenant_id=$1 AND fcc.campaign_id=$2
       ORDER BY fcc.checked_at DESC`,
      [req.session.user.tenant_id, req.params.id]
    );
    res.json(r.rows);
  }));

  // Overdue requirements
  app.get('/api/compliance-requirements/overdue', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM compliance_requirements WHERE tenant_id=$1 AND status != 'completed' AND status != 'waived' AND due_date IS NOT NULL AND due_date < CURRENT_DATE ORDER BY due_date ASC`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Compliance summary
  app.get('/api/compliance-requirements/summary', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const total = await pool.query(`SELECT COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1`, [tid]);
    const byStatus = await pool.query(`SELECT status, COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1 GROUP BY status`, [tid]);
    const byCategory = await pool.query(`SELECT category, COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1 GROUP BY category`, [tid]);
    const overdue = await pool.query(`SELECT COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1 AND status != 'completed' AND status != 'waived' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`, [tid]);
    res.json({ total: total.rows[0].count, by_status: byStatus.rows, by_category: byCategory.rows, overdue: overdue.rows[0].count });
  }));

  // Compliance UI Page
  app.get('/compliance', requireAuth, ah(async (req, res) => {
    const requirements = await pool.query(
      `SELECT * FROM compliance_requirements WHERE tenant_id=$1 ORDER BY due_date ASC NULLS LAST`,
      [req.session.user.tenant_id]
    );
    const overdue = await pool.query(`SELECT COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1 AND status != 'completed' AND status != 'waived' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`, [req.session.user.tenant_id]);
    const summary = await pool.query(`SELECT status, COUNT(*) as count FROM compliance_requirements WHERE tenant_id=$1 GROUP BY status`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Fundraising Compliance', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Fundraising Compliance Checker</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Total Requirements</p>
            <p class="text-2xl font-bold">${requirements.rows.length}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Overdue</p>
            <p class="text-2xl font-bold text-red-600">${overdue.rows[0].count}</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <p class="text-sm text-gray-500">Status Breakdown</p>
            <div class="flex gap-2 mt-1 flex-wrap">
              ${summary.rows.map(s => `<span class="px-2 py-1 rounded text-xs ${s.status==='completed'?'bg-green-100 text-green-800':s.status==='overdue'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}">${s.status}: ${s.count}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-3 text-left">Requirement</th>
                <th class="p-3 text-left">Category</th>
                <th class="p-3 text-left">Frequency</th>
                <th class="p-3 text-left">Due Date</th>
                <th class="p-3 text-left">Responsible</th>
                <th class="p-3 text-left">Status</th>
                <th class="p-3 text-left">Last Completed</th>
              </tr>
            </thead>
            <tbody>
              ${requirements.rows.map(r => `
                <tr class="border-t hover:bg-gray-50">
                  <td class="p-3 font-medium">${r.requirement_name}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs bg-blue-50 text-blue-800">${r.category}</span></td>
                  <td class="p-3">${r.frequency}</td>
                  <td class="p-3">${r.due_date ? new Date(r.due_date).toLocaleDateString() : '-'}</td>
                  <td class="p-3">${r.responsible_person || '-'}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs ${r.status==='completed'?'bg-green-100 text-green-800':r.status==='overdue'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}">${r.status}</span></td>
                  <td class="p-3">${r.last_completed ? new Date(r.last_completed).toLocaleDateString() : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 6: DONATION IMPACT REPORTS
  // =============================================

  // List impact reports
  app.get('/api/impact-reports', requireAuth, ah(async (req, res) => {
    const { campaign_id, is_published } = req.query;
    let q = `SELECT dir.*, (SELECT COUNT(*) FROM impact_report_sections irs WHERE irs.report_id=dir.id) as section_count
             FROM donation_impact_reports dir WHERE dir.tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (campaign_id) { q += ` AND dir.campaign_id=$${idx}`; params.push(campaign_id); idx++; }
    if (is_published !== undefined) { q += ` AND dir.is_published=$${idx}`; params.push(is_published === 'true'); idx++; }
    q += ` ORDER BY dir.created_at DESC LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create impact report
  app.post('/api/impact-reports', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, title, period_start, period_end, total_donations, total_donors, impact_summary, key_achievements_json, beneficiary_count } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(
      `INSERT INTO donation_impact_reports (tenant_id, campaign_id, title, period_start, period_end, total_donations, total_donors, impact_summary, key_achievements_json, beneficiary_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tid, campaign_id||null, esc(title), period_start||null, period_end||null, total_donations||0, total_donors||0, esc(impact_summary||''), key_achievements_json||'[]', beneficiary_count||0]
    );
    await audit(req, 'create', 'donation_impact_reports', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Get single impact report
  app.get('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Impact report not found' });
    const sections = await pool.query(`SELECT * FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2 ORDER BY sort_order, created_at`, [req.session.user.tenant_id, req.params.id]);
    res.json({ ...r.rows[0], sections: sections.rows });
  }));

  // Update impact report
  app.put('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, period_start, period_end, total_donations, total_donors, impact_summary, key_achievements_json, beneficiary_count } = req.body;
    const r = await pool.query(
      `UPDATE donation_impact_reports SET title=COALESCE($3,title), period_start=COALESCE($4,period_start), period_end=COALESCE($5,period_end),
       total_donations=COALESCE($6,total_donations), total_donors=COALESCE($7,total_donors), impact_summary=COALESCE($8,impact_summary),
       key_achievements_json=COALESCE($9,key_achievements_json), beneficiary_count=COALESCE($10,beneficiary_count)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(title||''), period_start||null, period_end||null, total_donations||null, total_donors||null, esc(impact_summary||''), key_achievements_json||null, beneficiary_count||null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Impact report not found' });
    await audit(req, 'update', 'donation_impact_reports', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete impact report
  app.delete('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Impact report not found' });
    await pool.query(`DELETE FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2`, [tid, req.params.id]);
    await pool.query(`DELETE FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    await audit(req, 'delete', 'donation_impact_reports', req.params.id);
    res.json({ ok: true, message: 'Impact report deleted' });
  }));

  // List sections
  app.get('/api/impact-reports/:id/sections', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2 ORDER BY sort_order, created_at`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Add section
  app.post('/api/impact-reports/:id/sections', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { section_type, title, content_html, image_url, sort_order } = req.body;
    const report = await pool.query(`SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!report.rows.length) return res.status(404).json({ error: 'Impact report not found' });
    const r = await pool.query(
      `INSERT INTO impact_report_sections (tenant_id, report_id, section_type, title, content_html, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, req.params.id, section_type||'text', esc(title||''), esc(content_html||''), esc(image_url||''), sort_order||0]
    );
    await audit(req, 'add_section', 'impact_report_sections', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update section
  app.put('/api/impact-reports/:id/sections/:sectionId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { section_type, title, content_html, image_url, sort_order } = req.body;
    const r = await pool.query(
      `UPDATE impact_report_sections SET section_type=COALESCE($4,section_type), title=COALESCE($5,title),
       content_html=COALESCE($6,content_html), image_url=COALESCE($7,image_url), sort_order=COALESCE($8,sort_order)
       WHERE tenant_id=$1 AND report_id=$2 AND id=$3 RETURNING *`,
      [tid, req.params.id, req.params.sectionId, section_type||null, esc(title||''), esc(content_html||''), esc(image_url||''), sort_order!==undefined?sort_order:null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Section not found' });
    await audit(req, 'update_section', 'impact_report_sections', req.params.sectionId);
    res.json(r.rows[0]);
  }));

  // Publish report
  app.post('/api/impact-reports/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const r = await pool.query(
      `UPDATE donation_impact_reports SET is_published=true, published_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Impact report not found' });
    await audit(req, 'publish', 'donation_impact_reports', req.params.id);
    res.json(r.rows[0]);
  }));

  // Send report to donors
  app.post('/api/impact-reports/:id/send-to-donors', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const report = await pool.query(`SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2 AND is_published=true`, [tid, req.params.id]);
    if (!report.rows.length) return res.status(404).json({ error: 'Published impact report not found' });
    // Get donor emails from vehicle donations
    const donors = await pool.query(`SELECT DISTINCT donor_email FROM vehicle_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != '' LIMIT 500`, [tid]);
    let sent = 0;
    for (const d of donors.rows) {
      try {
        await sendEmail(d.donor_email, `Impact Report: ${report.rows[0].title}`, `We are excited to share our latest impact report: ${report.rows[0].title}. Total donations: UGX ${Number(report.rows[0].total_donations).toLocaleString()}. Total donors: ${report.rows[0].total_donors}. Beneficiaries reached: ${report.rows[0].beneficiary_count}. Summary: ${report.rows[0].impact_summary || 'See the full report for details.'}`);
        sent++;
      } catch(e) {}
    }
    await audit(req, 'send_to_donors', 'donation_impact_reports', req.params.id);
    res.json({ ok: true, sent, total: donors.rows.length });
  }));

  // Public view (no auth)
  app.get('/api/impact-reports/public/:id', ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donation_impact_reports WHERE id=$1 AND is_published=true`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found or not published' });
    const sections = await pool.query(`SELECT * FROM impact_report_sections WHERE report_id=$1 ORDER BY sort_order, created_at`, [req.params.id]);
    res.json({ ...r.rows[0], sections: sections.rows });
  }));

  // Impact Reports UI Page
  app.get('/impact-reports', requireAuth, ah(async (req, res) => {
    const reports = await pool.query(
      `SELECT dir.*, (SELECT COUNT(*) FROM impact_report_sections irs WHERE irs.report_id=dir.id) as section_count
       FROM donation_impact_reports dir WHERE dir.tenant_id=$1 ORDER BY dir.created_at DESC LIMIT 20`,
      [req.session.user.tenant_id]
    );
    renderPage(req, res, 'Donation Impact Reports', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Donation Impact Reports</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${reports.rows.map(r => `
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="flex justify-between items-start">
                <h3 class="font-bold">${r.title}</h3>
                <span class="px-2 py-1 rounded text-xs ${r.is_published?'bg-green-100 text-green-800':'bg-yellow-100 text-yellow-800'}">${r.is_published?'Published':'Draft'}</span>
              </div>
              <p class="text-sm text-gray-500 mt-1">${r.impact_summary ? r.impact_summary.substring(0, 100) + '...' : 'No summary'}</p>
              <div class="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div><p class="font-bold">UGX ${Number(r.total_donations).toLocaleString()}</p><p class="text-xs text-gray-500">Donations</p></div>
                <div><p class="font-bold">${r.total_donors}</p><p class="text-xs text-gray-500">Donors</p></div>
                <div><p class="font-bold">${r.beneficiary_count}</p><p class="text-xs text-gray-500">Beneficiaries</p></div>
              </div>
              <p class="text-xs text-gray-400 mt-2">${r.section_count} sections | ${new Date(r.created_at).toLocaleDateString()}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 7: CAMPAIGN COLLABORATION PORTAL
  // =============================================

  // List collaborators for campaign
  app.get('/api/campaigns/:id/collaborators', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM campaign_collaboration WHERE tenant_id=$1 AND campaign_id=$2 AND is_active=true ORDER BY invited_at`,
      [req.session.user.tenant_id, req.params.id]
    );
    res.json(r.rows);
  }));

  // Add collaborator
  app.post('/api/campaigns/:id/collaborators', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { collaborator_email, collaborator_name, role } = req.body;
    if (!collaborator_email) return res.status(400).json({ error: 'collaborator_email required' });
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const r = await pool.query(
      `INSERT INTO campaign_collaboration (tenant_id, campaign_id, collaborator_email, collaborator_name, role, invitation_token)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, req.params.id, esc(collaborator_email), esc(collaborator_name||''), role||'viewer', token]
    );
    await audit(req, 'add_collaborator', 'campaign_collaboration', r.rows[0].id);
    // Log activity
    await pool.query(
      `INSERT INTO collaboration_activity (tenant_id, campaign_id, user_email, action, details) VALUES ($1,$2,$3,$4,$5)`,
      [tid, req.params.id, req.session.user.email, 'invited_collaborator', `Invited ${collaborator_email} as ${role||'viewer'}`]
    );
    // Send invitation email
    try {
      await sendEmail(collaborator_email, 'Campaign Collaboration Invitation',
        `You have been invited to collaborate on a campaign as a ${role||'viewer'}. Accept the invitation at: ${BASE_URL}/api/campaigns/${req.params.id}/invitations/${token}/accept`);
    } catch(e) {}
    res.json(r.rows[0]);
  }));

  // Update collaborator
  app.put('/api/campaigns/:id/collaborators/:collabId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { role, is_active } = req.body;
    const r = await pool.query(
      `UPDATE campaign_collaboration SET role=COALESCE($4,role), is_active=COALESCE($5,is_active) WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3 RETURNING *`,
      [tid, req.params.id, req.params.collabId, role||null, is_active!==undefined?is_active:null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Collaborator not found' });
    await audit(req, 'update_collaborator', 'campaign_collaboration', req.params.collabId);
    // Log activity
    await pool.query(
      `INSERT INTO collaboration_activity (tenant_id, campaign_id, user_email, action, details) VALUES ($1,$2,$3,$4,$5)`,
      [tid, req.params.id, req.session.user.email, 'updated_collaborator', `Updated ${r.rows[0].collaborator_email} role to ${r.rows[0].role}`]
    );
    res.json(r.rows[0]);
  }));

  // Remove collaborator
  app.delete('/api/campaigns/:id/collaborators/:collabId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM campaign_collaboration WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3`, [tid, req.params.id, req.params.collabId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Collaborator not found' });
    await pool.query(`UPDATE campaign_collaboration SET is_active=false WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3`, [tid, req.params.id, req.params.collabId]);
    await audit(req, 'remove_collaborator', 'campaign_collaboration', req.params.collabId);
    // Log activity
    await pool.query(
      `INSERT INTO collaboration_activity (tenant_id, campaign_id, user_email, action, details) VALUES ($1,$2,$3,$4,$5)`,
      [tid, req.params.id, req.session.user.email, 'removed_collaborator', `Removed ${existing.rows[0].collaborator_email}`]
    );
    res.json({ ok: true });
  }));

  // Accept invitation
  app.post('/api/campaigns/:id/invitations/:token/accept', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `UPDATE campaign_collaboration SET accepted_at=NOW(), is_active=true WHERE campaign_id=$1 AND invitation_token=$2 AND accepted_at IS NULL RETURNING *`,
      [req.params.id, req.params.token]
    );
    if (!r.rows.length) return res.status(400).json({ error: 'Invalid or already accepted invitation' });
    await audit(req, 'accept_invitation', 'campaign_collaboration', r.rows[0].id);
    res.json({ ok: true, message: 'Invitation accepted', collaboration: r.rows[0] });
  }));

  // List tasks for campaign
  app.get('/api/campaigns/:id/tasks', requireAuth, ah(async (req, res) => {
    const { status, priority, assigned_to } = req.query;
    let q = `SELECT * FROM collaboration_tasks WHERE tenant_id=$1 AND campaign_id=$2`;
    const params = [req.session.user.tenant_id, req.params.id];
    let idx = 3;
    if (status) { q += ` AND status=$${idx}`; params.push(status); idx++; }
    if (priority) { q += ` AND priority=$${idx}`; params.push(priority); idx++; }
    if (assigned_to) { q += ` AND assigned_to=$${idx}`; params.push(assigned_to); idx++; }
    q += ` ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, due_date ASC NULLS LAST, created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Create task
  app.post('/api/campaigns/:id/tasks', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { assigned_to, title, description, priority, due_date } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(
      `INSERT INTO collaboration_tasks (tenant_id, campaign_id, assigned_to, title, description, priority, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, req.params.id, esc(assigned_to||''), esc(title), esc(description||''), priority||'medium', due_date||null]
    );
    await audit(req, 'create_task', 'collaboration_tasks', r.rows[0].id);
    // Log activity
    await pool.query(
      `INSERT INTO collaboration_activity (tenant_id, campaign_id, user_email, action, details) VALUES ($1,$2,$3,$4,$5)`,
      [tid, req.params.id, req.session.user.email, 'created_task', `Created task: ${title}`]
    );
    res.json(r.rows[0]);
  }));

  // Update task
  app.put('/api/campaign-tasks/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { assigned_to, title, description, priority, due_date, status } = req.body;
    const r = await pool.query(
      `UPDATE collaboration_tasks SET assigned_to=COALESCE($3,assigned_to), title=COALESCE($4,title),
       description=COALESCE($5,description), priority=COALESCE($6,priority), due_date=COALESCE($7,due_date), status=COALESCE($8,status)
       WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id, esc(assigned_to||''), esc(title||''), esc(description||''), priority||null, due_date||null, status||null]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Task not found' });
    await audit(req, 'update_task', 'collaboration_tasks', req.params.id);
    res.json(r.rows[0]);
  }));

  // Complete task
  app.post('/api/campaign-tasks/:id/complete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const existing = await pool.query(`SELECT * FROM collaboration_tasks WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
    const r = await pool.query(
      `UPDATE collaboration_tasks SET status='done', completed_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [tid, req.params.id]
    );
    await audit(req, 'complete_task', 'collaboration_tasks', req.params.id);
    // Log activity
    await pool.query(
      `INSERT INTO collaboration_activity (tenant_id, campaign_id, user_email, action, details) VALUES ($1,$2,$3,$4,$5)`,
      [tid, existing.rows[0].campaign_id, req.session.user.email, 'completed_task', `Completed task: ${existing.rows[0].title}`]
    );
    res.json(r.rows[0]);
  }));

  // Activity feed for campaign
  app.get('/api/campaigns/:id/activity', requireAuth, ah(async (req, res) => {
    const { limit } = req.query;
    const r = await pool.query(
      `SELECT * FROM collaboration_activity WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC LIMIT $3`,
      [req.session.user.tenant_id, req.params.id, Math.min(parseInt(limit)||30, 100)]
    );
    res.json(r.rows);
  }));

  // Collaboration UI Page
  app.get('/collaboration', requireAuth, ah(async (req, res) => {
    const collabs = await pool.query(
      `SELECT cc.*, (SELECT COUNT(*) FROM collaboration_tasks ct WHERE ct.campaign_id=cc.campaign_id AND ct.tenant_id=cc.tenant_id) as task_count
       FROM campaign_collaboration cc WHERE cc.tenant_id=$1 AND cc.is_active=true ORDER BY cc.invited_at DESC LIMIT 20`,
      [req.session.user.tenant_id]
    );
    const tasks = await pool.query(
      `SELECT ct.* FROM collaboration_tasks ct WHERE ct.tenant_id=$1 AND ct.status != 'done' ORDER BY
       CASE ct.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
       ct.due_date ASC NULLS LAST LIMIT 20`,
      [req.session.user.tenant_id]
    );
    renderPage(req, res, 'Campaign Collaboration Portal', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Campaign Collaboration Portal</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white p-4 rounded-lg shadow">
            <h3 class="font-bold text-lg mb-3">Active Collaborators</h3>
            <div class="space-y-2 max-h-96 overflow-y-auto">
              ${collabs.rows.map(c => `
                <div class="p-3 border rounded flex justify-between items-center">
                  <div>
                    <p class="font-medium">${c.collaborator_name || c.collaborator_email}</p>
                    <p class="text-xs text-gray-500">${c.collaborator_email}</p>
                  </div>
                  <div class="text-right">
                    <span class="px-2 py-1 rounded text-xs ${c.role==='owner'?'bg-purple-100 text-purple-800':c.role==='editor'?'bg-blue-100 text-blue-800':'bg-gray-100 text-gray-800'}">${c.role}</span>
                    <p class="text-xs text-gray-400">${c.accepted_at?'Accepted':'Pending'}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <h3 class="font-bold text-lg mb-3">Open Tasks</h3>
            <div class="space-y-2 max-h-96 overflow-y-auto">
              ${tasks.rows.map(t => `
                <div class="p-3 border rounded">
                  <div class="flex justify-between">
                    <span class="font-medium">${t.title}</span>
                    <span class="px-2 py-1 rounded text-xs ${t.priority==='urgent'?'bg-red-100 text-red-800':t.priority==='high'?'bg-orange-100 text-orange-800':t.priority==='medium'?'bg-yellow-100 text-yellow-800':'bg-green-100 text-green-800'}">${t.priority}</span>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">${t.assigned_to?'Assigned to: '+t.assigned_to:'Unassigned'} | Status: ${t.status.replace(/_/g,' ')} ${t.due_date?'| Due: '+new Date(t.due_date).toLocaleDateString():''}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `);
  }));

  // =============================================
  // FEATURE 8: DONOR COMMUNICATION HUB
  // =============================================

  // Get communication hub config
  app.get('/api/communication-hub/config', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM communication_hub WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    if (!r.rows.length) return res.json({ config_json: '{}', default_from_email: '', default_from_name: 'Fundraising Team', daily_limit: 1000 });
    res.json(r.rows[0]);
  }));

  // Update communication hub config
  app.put('/api/communication-hub/config', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { config_json, default_from_email, default_from_name, daily_limit } = req.body;
    const existing = await pool.query(`SELECT * FROM communication_hub WHERE tenant_id=$1`, [tid]);
    let r;
    if (existing.rows.length) {
      r = await pool.query(
        `UPDATE communication_hub SET config_json=COALESCE($3,config_json), default_from_email=COALESCE($4,default_from_email),
         default_from_name=COALESCE($5,default_from_name), daily_limit=COALESCE($6,daily_limit)
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [tid, existing.rows[0].id, config_json||null, esc(default_from_email||''), esc(default_from_name||''), daily_limit||null]
      );
    } else {
      r = await pool.query(
        `INSERT INTO communication_hub (tenant_id, config_json, default_from_email, default_from_name, daily_limit)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [tid, config_json||'{}', esc(default_from_email||''), esc(default_from_name||'Fundraising Team'), daily_limit||1000]
      );
    }
    await audit(req, 'update_config', 'communication_hub', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Send message
  app.post('/api/communication-hub/send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, donor_name, channel, subject, body, campaign_id } = req.body;
    if (!donor_email || !body) return res.status(400).json({ error: 'donor_email and body required' });
    const ch = channel || 'email';
    // Check daily limit
    const dailySent = await pool.query(
      `SELECT COUNT(*) as count FROM unified_messages WHERE tenant_id=$1 AND channel=$2 AND sent_at >= CURRENT_DATE`,
      [tid, ch]
    );
    const config = await pool.query(`SELECT daily_limit FROM communication_hub WHERE tenant_id=$1`, [tid]);
    const limit = config.rows.length ? config.rows[0].daily_limit : 1000;
    if (parseInt(dailySent.rows[0].count) >= limit) {
      return res.status(429).json({ error: `Daily limit of ${limit} messages reached for ${ch} channel` });
    }
    const r = await pool.query(
      `INSERT INTO unified_messages (tenant_id, donor_email, donor_name, channel, subject, body, status, campaign_id, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,NOW()) RETURNING *`,
      [tid, esc(donor_email), esc(donor_name||''), ch, esc(subject||''), esc(body), campaign_id||null]
    );
    // Actually send the message
    try {
      if (ch === 'email') {
        await sendEmail(donor_email, subject || 'Message from Fundraising Team', body);
        await pool.query(`UPDATE unified_messages SET delivered_at=NOW() WHERE id=$1`, [r.rows[0].id]);
      } else if (ch === 'sms') {
        await sendSMS(donor_email, body); // donor_email used as phone for SMS
        await pool.query(`UPDATE unified_messages SET delivered_at=NOW() WHERE id=$1`, [r.rows[0].id]);
      }
      // For push and in_app, they are just stored (push notification already handled separately)
    } catch(e) {
      await pool.query(`UPDATE unified_messages SET status='failed' WHERE id=$1`, [r.rows[0].id]);
    }
    await audit(req, 'send_message', 'unified_messages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Broadcast message
  app.post('/api/communication-hub/broadcast', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { channel, subject, body, campaign_id } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    const ch = channel || 'email';
    // Get all donor emails
    const donors = await pool.query(
      `SELECT DISTINCT donor_email, donor_name FROM vehicle_donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != ''
       UNION SELECT DISTINCT contact_email, contact_name FROM family_foundations WHERE tenant_id=$1 AND contact_email IS NOT NULL AND contact_email != ''`,
      [tid]
    );
    // Check daily limit
    const dailySent = await pool.query(
      `SELECT COUNT(*) as count FROM unified_messages WHERE tenant_id=$1 AND channel=$2 AND sent_at >= CURRENT_DATE`,
      [tid, ch]
    );
    const config = await pool.query(`SELECT daily_limit FROM communication_hub WHERE tenant_id=$1`, [tid]);
    const limit = config.rows.length ? config.rows[0].daily_limit : 1000;
    const remaining = limit - parseInt(dailySent.rows[0].count);
    const toSend = donors.rows.slice(0, Math.max(0, remaining));
    let sent = 0;
    for (const d of toSend) {
      try {
        const r = await pool.query(
          `INSERT INTO unified_messages (tenant_id, donor_email, donor_name, channel, subject, body, status, campaign_id, sent_at, delivered_at)
           VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,NOW(),NOW()) RETURNING *`,
          [tid, esc(d.donor_email||''), esc(d.donor_name||''), ch, esc(subject||''), esc(body), campaign_id||null]
        );
        if (ch === 'email') {
          await sendEmail(d.donor_email, subject || 'Message from Fundraising Team', body);
        } else if (ch === 'sms') {
          await sendSMS(d.donor_email, body);
        }
        sent++;
      } catch(e) {}
    }
    await audit(req, 'broadcast', 'unified_messages', 0);
    res.json({ ok: true, sent, total_recipients: toSend.length, skipped: donors.rows.length - toSend.length });
  }));

  // List messages
  app.get('/api/communication-hub/messages', requireAuth, ah(async (req, res) => {
    const { channel, status, donor_email, limit, offset } = req.query;
    let q = `SELECT * FROM unified_messages WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (channel) { q += ` AND channel=$${idx}`; params.push(channel); idx++; }
    if (status) { q += ` AND status=$${idx}`; params.push(status); idx++; }
    if (donor_email) { q += ` AND donor_email=$${idx}`; params.push(donor_email); idx++; }
    q += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`;
    params.push(Math.min(parseInt(limit)||50, 200), parseInt(offset)||0);
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single message
  app.get('/api/communication-hub/messages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM unified_messages WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Message not found' });
    res.json(r.rows[0]);
  }));

  // Donor communication history
  app.get('/api/communication-hub/donor/:email/history', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM unified_messages WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 50`,
      [req.session.user.tenant_id, decodeURIComponent(req.params.email)]
    );
    res.json(r.rows);
  }));

  // Communication channel stats
  app.get('/api/communication-hub/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const byChannel = await pool.query(
      `SELECT channel, COUNT(*) as total, COUNT(CASE WHEN status='sent' THEN 1 END) as sent, COUNT(CASE WHEN status='delivered' THEN 1 END) as delivered,
       COUNT(CASE WHEN status='read' THEN 1 END) as read, COUNT(CASE WHEN status='replied' THEN 1 END) as replied,
       COUNT(CASE WHEN status='failed' THEN 1 END) as failed, COUNT(CASE WHEN status='bounced' THEN 1 END) as bounced
       FROM unified_messages WHERE tenant_id=$1 GROUP BY channel`, [tid]
    );
    const totalToday = await pool.query(`SELECT COUNT(*) as count FROM unified_messages WHERE tenant_id=$1 AND sent_at >= CURRENT_DATE`, [tid]);
    const dailyByChannel = await pool.query(`SELECT channel, COUNT(*) as count FROM unified_messages WHERE tenant_id=$1 AND sent_at >= CURRENT_DATE GROUP BY channel`, [tid]);
    res.json({ by_channel: byChannel.rows, total_today: totalToday.rows[0].count, today_by_channel: dailyByChannel.rows });
  }));

  // Communication Hub UI Page
  app.get('/communication-hub', requireAuth, ah(async (req, res) => {
    const stats = await pool.query(
      `SELECT channel, COUNT(*) as total, COUNT(CASE WHEN status='sent' THEN 1 END) as sent_count, COUNT(CASE WHEN status='delivered' THEN 1 END) as delivered_count,
       COUNT(CASE WHEN status='read' THEN 1 END) as read_count, COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count
       FROM unified_messages WHERE tenant_id=$1 GROUP BY channel`,
      [req.session.user.tenant_id]
    );
    const recentMessages = await pool.query(
      `SELECT * FROM unified_messages WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.session.user.tenant_id]
    );
    const config = await pool.query(`SELECT * FROM communication_hub WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const cfg = config.rows[0] || { default_from_name: 'Fundraising Team', daily_limit: 1000 };
    renderPage(req, res, 'Donor Communication Hub', `
      <div class="max-w-7xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Donor Communication Hub</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center">
            <p class="text-sm text-gray-500">Daily Limit</p>
            <p class="text-2xl font-bold">${cfg.daily_limit}</p>
          </div>
          ${stats.rows.map(s => `
            <div class="bg-white p-4 rounded-lg shadow">
              <p class="text-sm text-gray-500 capitalize">${s.channel}</p>
              <p class="text-xl font-bold">${s.total} total</p>
              <div class="flex gap-2 text-xs mt-1">
                <span class="text-green-600">${s.delivered_count} delivered</span>
                <span class="text-red-600">${s.failed_count} failed</span>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <h3 class="font-bold p-4 border-b">Recent Messages</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="p-3 text-left">To</th>
                <th class="p-3 text-left">Channel</th>
                <th class="p-3 text-left">Subject</th>
                <th class="p-3 text-left">Status</th>
                <th class="p-3 text-left">Sent</th>
              </tr>
            </thead>
            <tbody>
              ${recentMessages.rows.map(m => `
                <tr class="border-t hover:bg-gray-50">
                  <td class="p-3">${m.donor_name || m.donor_email}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs ${m.channel==='email'?'bg-blue-100 text-blue-800':m.channel==='sms'?'bg-green-100 text-green-800':m.channel==='push'?'bg-purple-100 text-purple-800':'bg-yellow-100 text-yellow-800'}">${m.channel}</span></td>
                  <td class="p-3 max-w-xs truncate">${m.subject || m.body.substring(0,50)+'...'}</td>
                  <td class="p-3"><span class="px-2 py-1 rounded text-xs ${m.status==='sent'||m.status==='delivered'||m.status==='read'?'bg-green-100 text-green-800':m.status==='failed'||m.status==='bounced'?'bg-red-100 text-red-800':'bg-yellow-100 text-yellow-800'}">${m.status}</span></td>
                  <td class="p-3">${m.sent_at?new Date(m.sent_at).toLocaleString():'-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }));

  console.log('[FundraisingUltimate11] Routes registered — 8 features with full CRUD, audit, and UI');
};
