/**
 * Fundraising Ultimate11 — Alternative Assets & Platform Operations
 * 8 Features: Vehicle Donations, Family Foundations, Mobile Experience/PWA,
 * Risk Assessment, Compliance Checker, Impact Reports, Collaboration Portal, Communication Hub
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS vehicle_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT, donor_phone TEXT, vehicle_make TEXT NOT NULL, vehicle_model TEXT NOT NULL, vehicle_year INTEGER, vin TEXT, color TEXT, mileage INTEGER, condition TEXT DEFAULT 'good', estimated_value NUMERIC DEFAULT 0, pickup_address TEXT, pickup_scheduled_date DATE, pickup_completed_date DATE, title_transferred BOOLEAN DEFAULT false, acknowledged BOOLEAN DEFAULT false, notes TEXT, status TEXT DEFAULT 'offered', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS vehicle_valuations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, vehicle_donation_id INTEGER REFERENCES vehicle_donations(id), valuation_date DATE NOT NULL, appraised_value NUMERIC DEFAULT 0, appraiser_name TEXT, condition_rating TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS vehicle_photos (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, vehicle_donation_id INTEGER REFERENCES vehicle_donations(id), photo_url TEXT NOT NULL, caption TEXT, uploaded_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_donations_tenant ON vehicle_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_valuations_tenant ON vehicle_valuations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vehicle_photos_tenant ON vehicle_photos(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS family_foundations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, foundation_name TEXT NOT NULL, contact_name TEXT, contact_email TEXT, contact_phone TEXT, mission_statement TEXT, total_assets NUMERIC DEFAULT 0, annual_grant_budget NUMERIC DEFAULT 0, grants_disbursed NUMERIC DEFAULT 0, grant_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS foundation_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, foundation_id INTEGER REFERENCES family_foundations(id) ON DELETE CASCADE, member_name TEXT NOT NULL, member_email TEXT, role TEXT DEFAULT 'member', joined_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS foundation_grants (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, foundation_id INTEGER REFERENCES family_foundations(id) ON DELETE CASCADE, grant_to TEXT NOT NULL, purpose TEXT, amount NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending', approved_by TEXT, approved_at TIMESTAMPTZ, granted_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS foundation_activity_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, foundation_id INTEGER REFERENCES family_foundations(id), action TEXT NOT NULL, performed_by TEXT, details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_family_foundations_tenant ON family_foundations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_foundation_members_tenant ON foundation_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_foundation_grants_tenant ON foundation_grants(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_foundation_activity_tenant ON foundation_activity_log(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS mobile_experience_config (id SERIAL PRIMARY KEY, tenant_id INTEGER UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, app_name TEXT DEFAULT 'FundraiseApp', primary_color TEXT DEFAULT '#10b981', accent_color TEXT DEFAULT '#059669', logo_url TEXT, home_screen_json TEXT DEFAULT '{}', enable_push BOOLEAN DEFAULT true, enable_sms BOOLEAN DEFAULT false, dark_mode_supported BOOLEAN DEFAULT true, offline_mode_enabled BOOLEAN DEFAULT true, splash_screen_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS push_notifications (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, target_segment TEXT DEFAULT 'all', deep_link TEXT, scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, recipient_count INTEGER DEFAULT 0, open_count INTEGER DEFAULT 0, click_count INTEGER DEFAULT 0, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS pwa_install_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_agent TEXT, device_type TEXT, installed_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_mobile_config_tenant ON mobile_experience_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_push_notifications_tenant ON push_notifications(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pwa_installs_tenant ON pwa_install_events(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS campaign_risk_assessments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, campaign_name TEXT NOT NULL, risk_level TEXT DEFAULT 'medium' CHECK(risk_level IN ('low','medium','high','critical')), risk_category TEXT DEFAULT 'general', description TEXT, probability INTEGER DEFAULT 5 CHECK(probability BETWEEN 1 AND 10), impact INTEGER DEFAULT 5 CHECK(impact BETWEEN 1 AND 10), risk_score INTEGER DEFAULT 25, assessed_by TEXT, assessed_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS risk_mitigation_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, assessment_id INTEGER REFERENCES campaign_risk_assessments(id) ON DELETE CASCADE, mitigation_strategy TEXT NOT NULL, responsible_person TEXT, deadline DATE, progress INTEGER DEFAULT 0 CHECK(progress BETWEEN 0 AND 100), status TEXT DEFAULT 'planned', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS risk_audit_trail (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, assessment_id INTEGER REFERENCES campaign_risk_assessments(id), action TEXT NOT NULL, old_value TEXT, new_value TEXT, performed_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_risk_assessments_tenant ON campaign_risk_assessments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_mitigation_tenant ON risk_mitigation_plans(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_risk_audit_tenant ON risk_audit_trail(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS compliance_requirements (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, requirement_name TEXT NOT NULL, category TEXT DEFAULT 'general', description TEXT, regulation_reference TEXT, is_mandatory BOOLEAN DEFAULT true, frequency TEXT DEFAULT 'annual', last_checked DATE, next_due DATE, penalty_text TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS fundraising_compliance_checks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, requirement_id INTEGER REFERENCES compliance_requirements(id), checked_by TEXT, check_date DATE DEFAULT CURRENT_DATE, status TEXT DEFAULT 'pending' CHECK(status IN ('compliant','non_compliant','pending','not_applicable')), notes TEXT, evidence_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_reqs_tenant ON compliance_requirements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_checks_tenant ON fundraising_compliance_checks(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS donation_impact_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, total_funds NUMERIC DEFAULT 0, beneficiaries_count INTEGER DEFAULT 0, period_start DATE, period_end DATE, is_published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, cover_image_url TEXT, view_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS impact_report_sections (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, report_id INTEGER REFERENCES donation_impact_reports(id) ON DELETE CASCADE, section_title TEXT NOT NULL, section_type TEXT DEFAULT 'text', content_html TEXT, image_url TEXT, data_json TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_impact_reports_tenant ON donation_impact_reports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_sections_tenant ON impact_report_sections(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS campaign_collaboration (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, campaign_name TEXT NOT NULL, description TEXT, invited_emails TEXT DEFAULT '[]', status TEXT DEFAULT 'active', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS collaboration_tasks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, collaboration_id INTEGER REFERENCES campaign_collaboration(id) ON DELETE CASCADE, task_name TEXT NOT NULL, assignee_email TEXT, description TEXT, due_date DATE, priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')), status TEXT DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done')), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS collaboration_comments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, task_id INTEGER REFERENCES collaboration_tasks(id) ON DELETE CASCADE, author_email TEXT, comment TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_collab_tenant ON campaign_collaboration(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_tasks_tenant ON collaboration_tasks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_comments_tenant ON collaboration_comments(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS communication_hub (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, channel_type TEXT DEFAULT 'email' CHECK(channel_type IN ('email','sms','push','whatsapp','direct_mail')), direction TEXT DEFAULT 'outbound' CHECK(direction IN ('inbound','outbound')), sender TEXT, recipient TEXT NOT NULL, subject TEXT, body TEXT, status TEXT DEFAULT 'draft', scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS communication_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, template_name TEXT NOT NULL, channel_type TEXT DEFAULT 'email', subject TEXT, body_template TEXT NOT NULL, variables_json TEXT DEFAULT '[]', is_active BOOLEAN DEFAULT true, usage_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS unified_messages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, hub_id INTEGER REFERENCES communication_hub(id), donor_email TEXT, donor_name TEXT, channel TEXT, message_text TEXT, is_read BOOLEAN DEFAULT false, thread_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_communication_hub_tenant ON communication_hub(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comm_templates_tenant ON communication_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_unified_messages_tenant ON unified_messages(tenant_id)`,
  ];

  (async () => {
    for (const q of migrations) { try { await pool.query(q); } catch(e){} }
    console.log('[FundraisingUltimate11] Migrations complete');
    // Seed per tenant
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        const seedCompliance = [
          { requirement_name: 'Charitable Solicitation Registration', category: 'registration', description: 'Register with state charity officials before soliciting donations', regulation_reference: 'State Charitable Solicitation Act', is_mandatory: true, frequency: 'annual', next_due: '2026-01-31', penalty_text: 'Fines up to $5,000 per violation' },
          { requirement_name: 'IRS Form 990 Filing', category: 'tax', description: 'File annual information return with the IRS', regulation_reference: 'IRC Section 6033', is_mandatory: true, frequency: 'annual', next_due: '2026-05-15', penalty_text: '$20 per day late, up to $10,000' },
          { requirement_name: 'Donor Privacy Policy', category: 'privacy', description: 'Maintain and publish donor privacy policy', regulation_reference: 'State Privacy Laws', is_mandatory: true, frequency: 'annual', next_due: '2026-01-01', penalty_text: 'Varies by jurisdiction' },
          { requirement_name: 'Financial Audit', category: 'audit', description: 'Conduct independent financial audit for organizations receiving over $750K', regulation_reference: 'OMB Uniform Guidance', is_mandatory: true, frequency: 'annual', next_due: '2026-06-30', penalty_text: 'Loss of federal funding eligibility' },
          { requirement_name: 'Gift Acknowledgment Letters', category: 'receipts', description: 'Send written acknowledgment for donations over $250', regulation_reference: 'IRC Section 170(f)(8)', is_mandatory: true, frequency: 'per_donation', next_due: '2026-01-31', penalty_text: 'Donor may lose tax deduction' }
        ];
        for (const c of seedCompliance) {
          await pool.query('INSERT INTO compliance_requirements (tenant_id,requirement_name,category,description,regulation_reference,is_mandatory,frequency,next_due,penalty_text) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE NOT EXISTS (SELECT 1 FROM compliance_requirements WHERE tenant_id=$1 AND requirement_name=$2)', [t.id, c.requirement_name, c.category, c.description, c.regulation_reference, c.is_mandatory, c.frequency, c.next_due, c.penalty_text]);
        }
        await pool.query('INSERT INTO mobile_experience_config (tenant_id,app_name,primary_color,accent_color,enable_push,enable_sms,dark_mode_supported,offline_mode_enabled) SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM mobile_experience_config WHERE tenant_id=$1)', [t.id, 'FundraiseApp', '#10b981', '#059669', true, false, true, true]);
        // Seed communication templates
        const seedTemplates = [
          { template_name: 'Donation Thank You', channel_type: 'email', subject: 'Thank you for your generous donation!', body_template: 'Dear {{donor_name}},\n\nThank you for your donation of {{amount}} to {{campaign_name}}. Your support makes a real difference.\n\nWith gratitude,\n{{organization_name}}', variables_json: '["donor_name","amount","campaign_name","organization_name"]' },
          { template_name: 'Campaign Launch', channel_type: 'email', subject: 'New Campaign: {{campaign_name}}', body_template: 'Dear {{donor_name}},\n\nWe are excited to announce our new campaign: {{campaign_name}}. Goal: {{goal_amount}}.\n\nLearn more: {{campaign_url}}', variables_json: '["donor_name","campaign_name","goal_amount","campaign_url"]' },
          { template_name: 'Event Reminder', channel_type: 'sms', subject: '', body_template: 'Hi {{donor_name}}, reminder: {{event_name}} is tomorrow at {{event_time}}. See you there!', variables_json: '["donor_name","event_name","event_time"]' }
        ];
        for (const tmpl of seedTemplates) {
          await pool.query('INSERT INTO communication_templates (tenant_id,template_name,channel_type,subject,body_template,variables_json) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE tenant_id=$1 AND template_name=$2)', [t.id, tmpl.template_name, tmpl.channel_type, tmpl.subject, tmpl.body_template, tmpl.variables_json]);
        }
      }
      console.log('[FundraisingUltimate11] Seed data complete');
    } catch(e) { console.warn('[FundraisingUltimate11] Seed error:', e.message); }
  })();

  // ================================================================
  // FEATURE 1: VEHICLE DONATIONS
  // ================================================================
  app.get('/api/vehicle-donations', requireAuth, ah(async (req, res) => {
    const { status, condition } = req.query;
    let q = 'SELECT * FROM vehicle_donations WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (condition) { q += ' AND condition=$' + idx; params.push(esc(condition)); idx++; }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/vehicle-donations/stats', requireAuth, ah(async (req, res) => {
    const total = await pool.query('SELECT COUNT(*) as count, SUM(estimated_value) as total_value FROM vehicle_donations WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const byStatus = await pool.query('SELECT status, COUNT(*) as count, SUM(estimated_value) as total_value FROM vehicle_donations WHERE tenant_id=$1 GROUP BY status', [req.session.user.tenant_id]);
    const pendingPickup = await pool.query("SELECT COUNT(*) as count FROM vehicle_donations WHERE tenant_id=$1 AND status='pickup_scheduled'", [req.session.user.tenant_id]);
    const unacknowledged = await pool.query("SELECT COUNT(*) as count FROM vehicle_donations WHERE tenant_id=$1 AND acknowledged=false", [req.session.user.tenant_id]);
    res.json({ total: total.rows[0], by_status: byStatus.rows, pending_pickup: parseInt(pendingPickup.rows[0]?.count||0), unacknowledged: parseInt(unacknowledged.rows[0]?.count||0) });
  }));
  app.get('/api/vehicle-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/vehicle-donations', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, vehicle_make, vehicle_model, vehicle_year, vin, color, mileage, condition, estimated_value, pickup_address, notes } = req.body;
    if (!donor_name || !vehicle_make || !vehicle_model) return res.status(400).json({ error: 'donor_name, vehicle_make, and vehicle_model required' });
    const r = await pool.query('INSERT INTO vehicle_donations (tenant_id,donor_name,donor_email,donor_phone,vehicle_make,vehicle_model,vehicle_year,vin,color,mileage,condition,estimated_value,pickup_address,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *', [req.session.user.tenant_id, esc(donor_name), esc(donor_email||''), esc(donor_phone||''), esc(vehicle_make), esc(vehicle_model), vehicle_year||null, esc(vin||''), esc(color||''), mileage||null, esc(condition||'good'), estimated_value||0, esc(pickup_address||''), esc(notes||'')]);
    await audit(req.session.user.email, 'create', 'vehicle_donations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/vehicle-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE vehicle_donations SET condition=COALESCE($1,condition), estimated_value=COALESCE($2,estimated_value), status=COALESCE($3,status), notes=COALESCE($4,notes) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.condition?esc(req.body.condition):null, req.body.estimated_value||null, req.body.status||null, req.body.notes?esc(req.body.notes):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    await audit(req.session.user.email, 'update', 'vehicle_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/vehicle-donations/:id', requireAuth, ah(async (req, res) => {
    const check = await pool.query('SELECT id FROM vehicle_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    await pool.query('DELETE FROM vehicle_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'vehicle_donations id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/vehicle-donations/:id/schedule-pickup', requireAuth, ah(async (req, res) => {
    const { pickup_date } = req.body;
    if (!pickup_date) return res.status(400).json({ error: 'pickup_date required' });
    const r = await pool.query('UPDATE vehicle_donations SET pickup_scheduled_date=$1, status=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *', [pickup_date, 'pickup_scheduled', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    await audit(req.session.user.email, 'update', 'vehicle_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/vehicle-donations/:id/complete-pickup', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE vehicle_donations SET pickup_completed_date=CURRENT_DATE, status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['picked_up', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    await audit(req.session.user.email, 'update', 'vehicle_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/vehicle-donations/:id/transfer-title', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE vehicle_donations SET title_transferred=true, status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['title_transferred', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    await audit(req.session.user.email, 'update', 'vehicle_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/vehicle-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE vehicle_donations SET acknowledged=true WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const v = r.rows[0];
    if (v.donor_email) {
      try { await sendEmail(v.donor_email, 'Vehicle Donation Acknowledged', `Dear ${v.donor_name},\n\nYour vehicle donation (${v.vehicle_year||''} ${v.vehicle_make} ${v.vehicle_model}) has been acknowledged. Thank you for your generosity!`); } catch(e) {}
    }
    await audit(req.session.user.email, 'update', 'vehicle_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  // Valuations
  app.get('/api/vehicle-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM vehicle_valuations WHERE tenant_id=$1 AND vehicle_donation_id=$2 ORDER BY valuation_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/vehicle-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const { valuation_date, appraised_value, appraiser_name, condition_rating, notes } = req.body;
    const vehicle = await pool.query('SELECT * FROM vehicle_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!vehicle.rows.length) return res.status(404).json({ error: 'Vehicle donation not found' });
    const r = await pool.query('INSERT INTO vehicle_valuations (tenant_id,vehicle_donation_id,valuation_date,appraised_value,appraiser_name,condition_rating,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, req.params.id, valuation_date||'NOW()', appraised_value||0, esc(appraiser_name||''), esc(condition_rating||''), esc(notes||'')]);
    await pool.query('UPDATE vehicle_donations SET estimated_value=$1 WHERE id=$2 AND tenant_id=$3', [appraised_value||0, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'create', 'vehicle_valuations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  // Photos
  app.get('/api/vehicle-donations/:id/photos', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM vehicle_photos WHERE tenant_id=$1 AND vehicle_donation_id=$2 ORDER BY uploaded_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/vehicle-donations/:id/photos', requireAuth, ah(async (req, res) => {
    const { photo_url, caption } = req.body;
    if (!photo_url) return res.status(400).json({ error: 'photo_url required' });
    const r = await pool.query('INSERT INTO vehicle_photos (tenant_id,vehicle_donation_id,photo_url,caption) VALUES ($1,$2,$3,$4) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(photo_url), esc(caption||'')]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/vehicle-donations/:vehicleId/photos/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM vehicle_photos WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    res.json({ ok: true });
  }));
  app.get('/vehicle-donations', requireAuth, ah(async (req, res) => {
    const vehicles = await pool.query('SELECT * FROM vehicle_donations WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Vehicle Donations', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Vehicle Donations</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${vehicles.rows.map(v => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${v.vehicle_year||''} ${esc(v.vehicle_make)} ${esc(v.vehicle_model)}</h3><p>Donor: ${esc(v.donor_name)} | Value: ${v.estimated_value} | ${v.status}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 2: FAMILY FOUNDATIONS
  // ================================================================
  app.get('/api/foundations', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT ff.*, (SELECT COUNT(*) FROM foundation_members WHERE foundation_id=ff.id) as member_count, (SELECT COUNT(*) FROM foundation_grants WHERE foundation_id=ff.id) as grant_count_total FROM family_foundations ff WHERE ff.tenant_id=$1 ORDER BY ff.created_at DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/foundations/stats', requireAuth, ah(async (req, res) => {
    const total = await pool.query('SELECT COUNT(*) as count, SUM(total_assets) as total_assets, SUM(annual_grant_budget) as total_budget, SUM(grants_disbursed) as total_disbursed FROM family_foundations WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const byStatus = await pool.query('SELECT status, COUNT(*) as count FROM family_foundations WHERE tenant_id=$1 GROUP BY status', [req.session.user.tenant_id]);
    res.json({ summary: total.rows[0], by_status: byStatus.rows });
  }));
  app.get('/api/foundations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM family_foundations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/foundations', requireAuth, ah(async (req, res) => {
    const { foundation_name, contact_name, contact_email, contact_phone, mission_statement, total_assets, annual_grant_budget } = req.body;
    if (!foundation_name) return res.status(400).json({ error: 'foundation_name required' });
    const r = await pool.query('INSERT INTO family_foundations (tenant_id,foundation_name,contact_name,contact_email,contact_phone,mission_statement,total_assets,annual_grant_budget) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, esc(foundation_name), esc(contact_name||''), esc(contact_email||''), esc(contact_phone||''), esc(mission_statement||''), total_assets||0, annual_grant_budget||0]);
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, r.rows[0].id, 'created', esc(req.session.user.email), 'Foundation created: ' + esc(foundation_name)]);
    await audit(req.session.user.email, 'create', 'family_foundations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/foundations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE family_foundations SET foundation_name=COALESCE($1,foundation_name), status=COALESCE($2,status), annual_grant_budget=COALESCE($3,annual_grant_budget), mission_statement=COALESCE($4,mission_statement) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.foundation_name?esc(req.body.foundation_name):null, req.body.status||null, req.body.annual_grant_budget||null, req.body.mission_statement?esc(req.body.mission_statement):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, req.params.id, 'updated', esc(req.session.user.email), 'Foundation details updated']);
    await audit(req.session.user.email, 'update', 'family_foundations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/foundations/:id', requireAuth, ah(async (req, res) => {
    const check = await pool.query('SELECT id FROM family_foundations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!check.rows.length) return res.status(404).json({ error: 'Foundation not found' });
    await pool.query('DELETE FROM family_foundations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'family_foundations id=' + req.params.id); res.json({ ok: true });
  }));
  // Members
  app.get('/api/foundations/:id/members', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM foundation_members WHERE tenant_id=$1 AND foundation_id=$2 ORDER BY joined_at', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/foundations/:id/members', requireAuth, ah(async (req, res) => {
    const { member_name, member_email, role } = req.body;
    if (!member_name) return res.status(400).json({ error: 'member_name required' });
    const r = await pool.query('INSERT INTO foundation_members (tenant_id,foundation_id,member_name,member_email,role) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(member_name), esc(member_email||''), esc(role||'member')]);
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, req.params.id, 'member_added', esc(req.session.user.email), 'Added member: ' + esc(member_name)]);
    await audit(req.session.user.email, 'create', 'foundation_members id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/foundations/:foundationId/members/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE foundation_members SET role=COALESCE($1,role) WHERE tenant_id=$2 AND id=$3 RETURNING *', [req.body.role?esc(req.body.role):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Member not found' });
    await audit(req.session.user.email, 'update', 'foundation_members id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/foundations/:foundationId/members/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM foundation_members WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'foundation_members id=' + req.params.id); res.json({ ok: true });
  }));
  // Grants
  app.get('/api/foundations/:id/grants', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM foundation_grants WHERE tenant_id=$1 AND foundation_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/foundations/:id/grants', requireAuth, ah(async (req, res) => {
    const { grant_to, purpose, amount, notes } = req.body;
    if (!grant_to || !amount) return res.status(400).json({ error: 'grant_to and amount required' });
    const r = await pool.query('INSERT INTO foundation_grants (tenant_id,foundation_id,grant_to,purpose,amount,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(grant_to), esc(purpose||''), amount, esc(notes||'')]);
    await pool.query('UPDATE family_foundations SET total_assets=total_assets-$1, grants_disbursed=grants_disbursed+$1, grant_count=grant_count+1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, req.params.id, 'grant_created', esc(req.session.user.email), 'Grant of ' + amount + ' to ' + esc(grant_to)]);
    await audit(req.session.user.email, 'create', 'foundation_grants id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.post('/api/foundations/:foundationId/grants/:id/approve', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE foundation_grants SET status=$1, approved_by=$2, approved_at=NOW() WHERE tenant_id=$3 AND id=$4 RETURNING *', ['approved', esc(req.session.user.email), req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Grant not found' });
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, r.rows[0].foundation_id, 'grant_approved', esc(req.session.user.email), 'Grant approved: ' + r.rows[0].amount]);
    await audit(req.session.user.email, 'update', 'foundation_grants id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/foundations/:foundationId/grants/:id/disburse', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE foundation_grants SET status=$1, granted_at=NOW() WHERE tenant_id=$2 AND id=$3 AND status=$4 RETURNING *', ['disbursed', req.session.user.tenant_id, req.params.id, 'approved']);
    if (!r.rows.length) return res.status(400).json({ error: 'Grant not found or not approved' });
    await pool.query('INSERT INTO foundation_activity_log (tenant_id,foundation_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, r.rows[0].foundation_id, 'grant_disbursed', esc(req.session.user.email), 'Grant disbursed: ' + r.rows[0].amount]);
    await audit(req.session.user.email, 'update', 'foundation_grants id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/foundations/:foundationId/grants/:id/reject', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE foundation_grants SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['rejected', req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'foundation_grants id=' + req.params.id); res.json(r.rows[0]);
  }));
  // Activity Log
  app.get('/api/foundations/:id/activity', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM foundation_activity_log WHERE tenant_id=$1 AND foundation_id=$2 ORDER BY created_at DESC LIMIT 50', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.get('/family-foundations', requireAuth, ah(async (req, res) => {
    const foundations = await pool.query('SELECT * FROM family_foundations WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Family Foundations', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Family Foundations</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${foundations.rows.map(f => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(f.foundation_name)}</h3><p>Assets: ${f.total_assets} | Grant Budget: ${f.annual_grant_budget} | Status: ${f.status}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 3: MOBILE EXPERIENCE / PWA
  // ================================================================
  app.get('/api/mobile-config', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM mobile_experience_config WHERE tenant_id=$1', [req.session.user.tenant_id]);
    if (!r.rows.length) {
      const created = await pool.query('INSERT INTO mobile_experience_config (tenant_id) VALUES ($1) RETURNING *', [req.session.user.tenant_id]);
      return res.json(created.rows[0]);
    }
    res.json(r.rows[0]);
  }));
  app.put('/api/mobile-config', requireAuth, ah(async (req, res) => {
    const { app_name, primary_color, accent_color, logo_url, enable_push, enable_sms, dark_mode_supported, offline_mode_enabled, home_screen_json, splash_screen_url } = req.body;
    const r = await pool.query('UPDATE mobile_experience_config SET app_name=COALESCE($1,app_name), primary_color=COALESCE($2,primary_color), accent_color=COALESCE($3,accent_color), logo_url=COALESCE($4,logo_url), enable_push=COALESCE($5,enable_push), enable_sms=COALESCE($6,enable_sms), dark_mode_supported=COALESCE($7,dark_mode_supported), offline_mode_enabled=COALESCE($8,offline_mode_enabled), home_screen_json=COALESCE($9,home_screen_json), splash_screen_url=COALESCE($10,splash_screen_url) WHERE tenant_id=$11 RETURNING *', [app_name?esc(app_name):null, primary_color||null, accent_color||null, logo_url?esc(logo_url):null, enable_push, enable_sms, dark_mode_supported, offline_mode_enabled, home_screen_json?JSON.stringify(home_screen_json):null, splash_screen_url?esc(splash_screen_url):null, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'mobile_experience_config id=' + r.rows[0]?.id); res.json(r.rows[0]);
  }));
  // Push Notifications
  app.get('/api/push-notifications', requireAuth, ah(async (req, res) => {
    const { status, target_segment } = req.query;
    let q = 'SELECT * FROM push_notifications WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (target_segment) { q += ' AND target_segment=$' + idx; params.push(esc(target_segment)); idx++; }
    q += ' ORDER BY created_at DESC LIMIT 50';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.post('/api/push-notifications', requireAuth, ah(async (req, res) => {
    const { title, body, target_segment, deep_link, scheduled_at } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    const r = await pool.query('INSERT INTO push_notifications (tenant_id,title,body,target_segment,deep_link,scheduled_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, esc(title), esc(body), esc(target_segment||'all'), esc(deep_link||''), scheduled_at||null]);
    await audit(req.session.user.email, 'create', 'push_notifications id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/push-notifications/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE push_notifications SET status=COALESCE($1,status), title=COALESCE($2,title), body=COALESCE($3,body) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.status||null, req.body.title?esc(req.body.title):null, req.body.body?esc(req.body.body):null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'push_notifications id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/push-notifications/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM push_notifications WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'push_notifications id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/mobile/broadcast', requireAuth, ah(async (req, res) => {
    const { title, body, target_segment } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    let donorCount;
    if (target_segment === 'major') {
      donorCount = await pool.query("SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1 AND amount > 1000000", [req.session.user.tenant_id]);
    } else if (target_segment === 'recurring') {
      donorCount = await pool.query("SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1 AND is_recurring=true", [req.session.user.tenant_id]);
    } else {
      donorCount = await pool.query('SELECT COUNT(*) as cnt FROM donors WHERE tenant_id=$1', [req.session.user.tenant_id]);
    }
    const r = await pool.query('INSERT INTO push_notifications (tenant_id,title,body,target_segment,sent_at,recipient_count,status) VALUES ($1,$2,$3,$4,NOW(),$5,$6) RETURNING *', [req.session.user.tenant_id, esc(title), esc(body), esc(target_segment||'all'), parseInt(donorCount.rows[0]?.cnt||0), 'sent']);
    await audit(req.session.user.email, 'create', 'push_notifications id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.get('/api/mobile/manifest', ah(async (req, res) => {
    const tid = req.session?.user?.tenant_id || 1;
    const config = await pool.query('SELECT * FROM mobile_experience_config WHERE tenant_id=$1', [tid]);
    const c = config.rows[0] || { app_name: 'FundraiseApp', primary_color: '#10b981', accent_color: '#059669', logo_url: null, dark_mode_supported: true };
    res.json({
      name: c.app_name,
      short_name: c.app_name.substring(0, 12),
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: c.primary_color,
      description: 'Mobile fundraising experience',
      icons: c.logo_url ? [{ src: c.logo_url, sizes: '192x192', type: 'image/png' }, { src: c.logo_url, sizes: '512x512', type: 'image/png' }] : [],
      categories: ['fundraising', 'nonprofit'],
      prefer_related_applications: false
    });
  }));
  app.post('/api/mobile/track-install', requireAuth, ah(async (req, res) => {
    const { user_agent, device_type } = req.body;
    await pool.query('INSERT INTO pwa_install_events (tenant_id,user_agent,device_type) VALUES ($1,$2,$3)', [req.session.user.tenant_id, esc(user_agent||''), esc(device_type||'unknown')]);
    res.json({ ok: true });
  }));
  app.get('/api/mobile/install-stats', requireAuth, ah(async (req, res) => {
    const total = await pool.query('SELECT COUNT(*) as count FROM pwa_install_events WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const byDevice = await pool.query('SELECT device_type, COUNT(*) as count FROM pwa_install_events WHERE tenant_id=$1 GROUP BY device_type', [req.session.user.tenant_id]);
    const recent = await pool.query('SELECT * FROM pwa_install_events WHERE tenant_id=$1 ORDER BY installed_at DESC LIMIT 10', [req.session.user.tenant_id]);
    res.json({ total_installs: parseInt(total.rows[0]?.count||0), by_device: byDevice.rows, recent_installs: recent.rows });
  }));
  app.get('/api/push-notifications/stats', requireAuth, ah(async (req, res) => {
    const stats = await pool.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status=$1 THEN 1 END) as sent, COUNT(CASE WHEN status=$2 THEN 1 END) as scheduled, SUM(recipient_count) as total_recipients, SUM(open_count) as total_opens FROM push_notifications WHERE tenant_id=$3', ['sent', 'scheduled', req.session.user.tenant_id]);
    res.json(stats.rows[0]);
  }));
  app.get('/mobile-experience', requireAuth, ah(async (req, res) => {
    const config = await pool.query('SELECT * FROM mobile_experience_config WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const installs = await pool.query('SELECT COUNT(*) as count FROM pwa_install_events WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Mobile Experience', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Mobile Experience / PWA</h1><div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">App Config</h3><p>Name: ${config.rows[0]?.app_name||'FundraiseApp'}</p><p>Push: ${config.rows[0]?.enable_push?'Enabled':'Disabled'}</p><p>Offline: ${config.rows[0]?.offline_mode_enabled?'Enabled':'Disabled'}</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">PWA Installs</h3><p>${installs.rows[0]?.count||0} installations</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Theme</h3><p>Primary: ${config.rows[0]?.primary_color||'#10b981'}</p><p>Dark Mode: ${config.rows[0]?.dark_mode_supported?'Supported':'Not Supported'}</p></div></div></div>`);
  }));

  // ================================================================
  // FEATURE 4: RISK ASSESSMENT
  // ================================================================
  app.get('/api/risk-assessments', requireAuth, ah(async (req, res) => {
    const { risk_level, risk_category } = req.query;
    let q = 'SELECT * FROM campaign_risk_assessments WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (risk_level) { q += ' AND risk_level=$' + idx; params.push(esc(risk_level)); idx++; }
    if (risk_category) { q += ' AND risk_category=$' + idx; params.push(esc(risk_category)); idx++; }
    q += ' ORDER BY risk_score DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/risk-assessments/health-check', requireAuth, ah(async (req, res) => {
    const summary = await pool.query('SELECT risk_level, COUNT(*) as count, AVG(risk_score) as avg_score FROM campaign_risk_assessments WHERE tenant_id=$1 GROUP BY risk_level ORDER BY risk_level', [req.session.user.tenant_id]);
    const critical = await pool.query("SELECT COUNT(*) as cnt FROM campaign_risk_assessments WHERE tenant_id=$1 AND risk_level IN ('critical','high')", [req.session.user.tenant_id]);
    const total = await pool.query('SELECT COUNT(*) as cnt FROM campaign_risk_assessments WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const mitigated = await pool.query("SELECT COUNT(DISTINCT assessment_id) as cnt FROM risk_mitigation_plans WHERE tenant_id=$1 AND status IN ('completed','done')", [req.session.user.tenant_id]);
    res.json({ risk_distribution: summary.rows, critical_high_count: parseInt(critical.rows[0]?.cnt||0), total_assessments: parseInt(total.rows[0]?.cnt||0), mitigated_count: parseInt(mitigated.rows[0]?.cnt||0), overall_health: parseInt(critical.rows[0]?.cnt||0) === 0 ? 'healthy' : 'at_risk' });
  }));
  app.get('/api/risk-assessments/matrix', requireAuth, ah(async (req, res) => {
    const matrix = [];
    for (let p = 1; p <= 10; p++) {
      for (let i = 1; i <= 10; i++) {
        const score = p * i;
        const level = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
        matrix.push({ probability: p, impact: i, score, level });
      }
    }
    const existing = await pool.query('SELECT probability, impact, campaign_name, risk_level, risk_score FROM campaign_risk_assessments WHERE tenant_id=$1', [req.session.user.tenant_id]);
    res.json({ matrix, assessments: existing.rows });
  }));
  app.get('/api/risk-assessments/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM campaign_risk_assessments WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Risk assessment not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/risk-assessments', requireAuth, ah(async (req, res) => {
    const { campaign_id, campaign_name, risk_level, risk_category, description, probability, impact, assessed_by } = req.body;
    if (!campaign_name) return res.status(400).json({ error: 'campaign_name required' });
    const prob = Math.min(10, Math.max(1, probability || 5));
    const imp = Math.min(10, Math.max(1, impact || 5));
    const score = prob * imp;
    const level = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
    const r = await pool.query('INSERT INTO campaign_risk_assessments (tenant_id,campaign_id,campaign_name,risk_level,risk_category,description,probability,impact,risk_score,assessed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [req.session.user.tenant_id, campaign_id||null, esc(campaign_name), esc(level), esc(risk_category||'general'), esc(description||''), prob, imp, score, esc(assessed_by||req.session.user.email)]);
    await pool.query('INSERT INTO risk_audit_trail (tenant_id,assessment_id,action,performed_by,details) VALUES ($1,$2,$3,$4,$5)', [req.session.user.tenant_id, r.rows[0].id, 'created', esc(req.session.user.email), 'Assessment created: score=' + score + ', level=' + level]);
    await audit(req.session.user.email, 'create', 'campaign_risk_assessments id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/risk-assessments/:id', requireAuth, ah(async (req, res) => {
    const existing = await pool.query('SELECT * FROM campaign_risk_assessments WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Risk assessment not found' });
    const { probability, impact, description, risk_category } = req.body;
    const prob = Math.min(10, Math.max(1, probability || existing.rows[0].probability));
    const imp = Math.min(10, Math.max(1, impact || existing.rows[0].impact));
    const score = prob * imp;
    const level = score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
    const r = await pool.query('UPDATE campaign_risk_assessments SET probability=$1, impact=$2, risk_score=$3, risk_level=$4, description=COALESCE($5,description), risk_category=COALESCE($6,risk_category), assessed_at=NOW() WHERE tenant_id=$7 AND id=$8 RETURNING *', [prob, imp, score, level, description?esc(description):null, risk_category?esc(risk_category):null, req.session.user.tenant_id, req.params.id]);
    await pool.query('INSERT INTO risk_audit_trail (tenant_id,assessment_id,action,performed_by,old_value,new_value) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, req.params.id, 'updated', esc(req.session.user.email), 'score=' + existing.rows[0].risk_score + ',level=' + existing.rows[0].risk_level, 'score=' + score + ',level=' + level]);
    await audit(req.session.user.email, 'update', 'campaign_risk_assessments id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/risk-assessments/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM campaign_risk_assessments WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'campaign_risk_assessments id=' + req.params.id); res.json({ ok: true });
  }));
  // Mitigation Plans
  app.get('/api/risk-assessments/:id/mitigation-plans', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM risk_mitigation_plans WHERE tenant_id=$1 AND assessment_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/risk-assessments/:id/mitigation-plans', requireAuth, ah(async (req, res) => {
    const { mitigation_strategy, responsible_person, deadline, status } = req.body;
    if (!mitigation_strategy) return res.status(400).json({ error: 'mitigation_strategy required' });
    const r = await pool.query('INSERT INTO risk_mitigation_plans (tenant_id,assessment_id,mitigation_strategy,responsible_person,deadline,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(mitigation_strategy), esc(responsible_person||''), deadline||null, status||'planned']);
    await audit(req.session.user.email, 'create', 'risk_mitigation_plans id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/risk-assessments/:assessmentId/mitigation-plans/:id', requireAuth, ah(async (req, res) => {
    const { status, progress, responsible_person, deadline } = req.body;
    const completedAt = status === 'completed' ? 'NOW()' : null;
    let q = 'UPDATE risk_mitigation_plans SET status=COALESCE($1,status), progress=COALESCE($2,progress), responsible_person=COALESCE($3,responsible_person), deadline=COALESCE($4,deadline)';
    const params = [status||null, progress||null, responsible_person?esc(responsible_person):null, deadline||null];
    let idx = 5;
    if (status === 'completed') { q += ', completed_at=NOW()'; }
    q += ' WHERE tenant_id=$' + idx + ' AND id=$' + (idx+1) + ' RETURNING *';
    params.push(req.session.user.tenant_id, req.params.id);
    const r = await pool.query(q, params);
    await audit(req.session.user.email, 'update', 'risk_mitigation_plans id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/risk-assessments/:assessmentId/mitigation-plans/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM risk_mitigation_plans WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'risk_mitigation_plans id=' + req.params.id); res.json({ ok: true });
  }));
  // Audit trail
  app.get('/api/risk-assessments/:id/audit-trail', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM risk_audit_trail WHERE tenant_id=$1 AND assessment_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.get('/risk-assessment', requireAuth, ah(async (req, res) => {
    const assessments = await pool.query('SELECT * FROM campaign_risk_assessments WHERE tenant_id=$1 ORDER BY risk_score DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Risk Assessment', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Risk Assessment</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${assessments.rows.map(a => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(a.campaign_name)}</h3><p>Risk: ${a.risk_level} | Score: ${a.risk_score} | P:${a.probability} x I:${a.impact}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 5: COMPLIANCE CHECKER
  // ================================================================
  app.get('/api/compliance-requirements', requireAuth, ah(async (req, res) => {
    const { category, is_mandatory } = req.query;
    let q = 'SELECT * FROM compliance_requirements WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (category) { q += ' AND category=$' + idx; params.push(esc(category)); idx++; }
    if (is_mandatory !== undefined) { q += ' AND is_mandatory=$' + idx; params.push(is_mandatory === 'true'); idx++; }
    q += ' ORDER BY next_due';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/compliance-check', requireAuth, ah(async (req, res) => {
    const reqs = await pool.query('SELECT cr.*, (SELECT status FROM fundraising_compliance_checks WHERE requirement_id=cr.id ORDER BY check_date DESC LIMIT 1) as latest_status FROM compliance_requirements cr WHERE cr.tenant_id=$1 ORDER BY cr.next_due', [req.session.user.tenant_id]);
    const compliant = reqs.rows.filter(r => r.latest_status === 'compliant').length;
    const nonCompliant = reqs.rows.filter(r => r.latest_status === 'non_compliant').length;
    const total = reqs.rows.length;
    const overdue = reqs.rows.filter(r => r.next_due && new Date(r.next_due) < new Date() && r.latest_status !== 'compliant').length;
    const upcoming = reqs.rows.filter(r => r.next_due && new Date(r.next_due) > new Date() && (new Date(r.next_due) - new Date()) < 30*24*60*60*1000 && r.latest_status !== 'compliant').length;
    res.json({ total_requirements: total, compliant, non_compliant: nonCompliant, pending: total - compliant - nonCompliant, overdue, upcoming, compliance_rate: total > 0 ? ((compliant / total) * 100).toFixed(1) : 0, requirements: reqs.rows });
  }));
  app.post('/api/compliance-requirements', requireAuth, ah(async (req, res) => {
    const { requirement_name, category, description, regulation_reference, is_mandatory, frequency, next_due, penalty_text } = req.body;
    if (!requirement_name) return res.status(400).json({ error: 'requirement_name required' });
    const r = await pool.query('INSERT INTO compliance_requirements (tenant_id,requirement_name,category,description,regulation_reference,is_mandatory,frequency,next_due,penalty_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.session.user.tenant_id, esc(requirement_name), esc(category||'general'), esc(description||''), esc(regulation_reference||''), is_mandatory!==undefined?is_mandatory:true, esc(frequency||'annual'), next_due||null, esc(penalty_text||'')]);
    await audit(req.session.user.email, 'create', 'compliance_requirements id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/compliance-requirements/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE compliance_requirements SET requirement_name=COALESCE($1,requirement_name), next_due=COALESCE($2,next_due), category=COALESCE($3,category), is_mandatory=COALESCE($4,is_mandatory), frequency=COALESCE($5,frequency), penalty_text=COALESCE($6,penalty_text) WHERE tenant_id=$7 AND id=$8 RETURNING *', [req.body.requirement_name?esc(req.body.requirement_name):null, req.body.next_due||null, req.body.category?esc(req.body.category):null, req.body.is_mandatory, req.body.frequency?esc(req.body.frequency):null, req.body.penalty_text?esc(req.body.penalty_text):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Requirement not found' });
    await audit(req.session.user.email, 'update', 'compliance_requirements id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/compliance-requirements/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM compliance_requirements WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'compliance_requirements id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/compliance-requirements/:id/complete', requireAuth, ah(async (req, res) => {
    const { status, notes, evidence_url } = req.body;
    const check = await pool.query('INSERT INTO fundraising_compliance_checks (tenant_id,requirement_id,checked_by,status,notes,evidence_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(req.session.user.email), esc(status||'compliant'), esc(notes||''), esc(evidence_url||'')]);
    await pool.query('UPDATE compliance_requirements SET last_checked=CURRENT_DATE WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'create', 'fundraising_compliance_checks id=' + check.rows[0].id); res.json(check.rows[0]);
  }));
  app.get('/api/compliance-requirements/:id/checks', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM fundraising_compliance_checks WHERE tenant_id=$1 AND requirement_id=$2 ORDER BY check_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.get('/api/compliance/overdue', requireAuth, ah(async (req, res) => {
    const r = await pool.query("SELECT cr.*, (SELECT status FROM fundraising_compliance_checks WHERE requirement_id=cr.id ORDER BY check_date DESC LIMIT 1) as latest_status FROM compliance_requirements cr WHERE cr.tenant_id=$1 AND cr.next_due < CURRENT_DATE AND (SELECT status FROM fundraising_compliance_checks WHERE requirement_id=cr.id ORDER BY check_date DESC LIMIT 1) != 'compliant' ORDER BY cr.next_due", [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/compliance/upcoming', requireAuth, ah(async (req, res) => {
    const r = await pool.query("SELECT cr.*, (SELECT status FROM fundraising_compliance_checks WHERE requirement_id=cr.id ORDER BY check_date DESC LIMIT 1) as latest_status FROM compliance_requirements cr WHERE cr.tenant_id=$1 AND cr.next_due BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' AND (SELECT status FROM fundraising_compliance_checks WHERE requirement_id=cr.id ORDER BY check_date DESC LIMIT 1) != 'compliant' ORDER BY cr.next_due", [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/compliance-checker', requireAuth, ah(async (req, res) => {
    const reqs = await pool.query('SELECT * FROM compliance_requirements WHERE tenant_id=$1 ORDER BY next_due', [req.session.user.tenant_id]);
    const overdue = await pool.query("SELECT COUNT(*) as cnt FROM compliance_requirements WHERE tenant_id=$1 AND next_due < CURRENT_DATE", [req.session.user.tenant_id]);
    renderPage(req, res, 'Compliance Checker', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Compliance Checker</h1><div class="mb-4 p-4 bg-white rounded-lg shadow"><p class="text-lg">Overdue: <span class="font-bold text-red-600">${overdue.rows[0]?.cnt||0}</span> | Total: ${reqs.rows.length}</p></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${reqs.rows.map(r => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(r.requirement_name)}</h3><p>${r.category} | Due: ${r.next_due||'N/A'} | ${r.is_mandatory?'Mandatory':'Optional'}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 6: IMPACT REPORTS
  // ================================================================
  app.get('/api/impact-reports', requireAuth, ah(async (req, res) => {
    const { is_published } = req.query;
    let q = 'SELECT * FROM donation_impact_reports WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (is_published !== undefined) { q += ' AND is_published=$2'; params.push(is_published === 'true'); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
    const sections = await pool.query('SELECT * FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2 ORDER BY sort_order', [req.session.user.tenant_id, req.params.id]);
    res.json({ ...r.rows[0], sections: sections.rows });
  }));
  app.post('/api/impact-reports', requireAuth, ah(async (req, res) => {
    const { title, description, total_funds, beneficiaries_count, period_start, period_end, cover_image_url } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query('INSERT INTO donation_impact_reports (tenant_id,title,description,total_funds,beneficiaries_count,period_start,period_end,cover_image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, esc(title), esc(description||''), total_funds||0, beneficiaries_count||0, period_start||null, period_end||null, esc(cover_image_url||'')]);
    await audit(req.session.user.email, 'create', 'donation_impact_reports id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donation_impact_reports SET title=COALESCE($1,title), description=COALESCE($2,description), total_funds=COALESCE($3,total_funds), beneficiaries_count=COALESCE($4,beneficiaries_count), is_published=COALESCE($5,is_published), cover_image_url=COALESCE($6,cover_image_url) WHERE tenant_id=$7 AND id=$8 RETURNING *', [req.body.title?esc(req.body.title):null, req.body.description?esc(req.body.description):null, req.body.total_funds||null, req.body.beneficiaries_count||null, req.body.is_published, req.body.cover_image_url?esc(req.body.cover_image_url):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
    await audit(req.session.user.email, 'update', 'donation_impact_reports id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/impact-reports/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'donation_impact_reports id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/impact-reports/:id/publish', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donation_impact_reports SET is_published=true, published_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
    await audit(req.session.user.email, 'update', 'donation_impact_reports id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/impact-reports/:id/unpublish', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donation_impact_reports SET is_published=false WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'donation_impact_reports id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/impact-reports/:id/duplicate', requireAuth, ah(async (req, res) => {
    const orig = await pool.query('SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!orig.rows.length) return res.status(404).json({ error: 'Report not found' });
    const o = orig.rows[0];
    const r = await pool.query('INSERT INTO donation_impact_reports (tenant_id,title,description,total_funds,beneficiaries_count,period_start,period_end,cover_image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, esc(o.title + ' (Copy)'), esc(o.description||''), o.total_funds, o.beneficiaries_count, o.period_start, o.period_end, esc(o.cover_image_url||'')]);
    const sections = await pool.query('SELECT * FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2 ORDER BY sort_order', [req.session.user.tenant_id, req.params.id]);
    for (const s of sections.rows) {
      await pool.query('INSERT INTO impact_report_sections (tenant_id,report_id,section_title,section_type,content_html,image_url,data_json,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [req.session.user.tenant_id, r.rows[0].id, esc(s.section_title), esc(s.section_type), esc(s.content_html||''), esc(s.image_url||''), s.data_json, s.sort_order]);
    }
    await audit(req.session.user.email, 'create', 'donation_impact_reports id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.post('/api/impact-reports/:id/send-to-donors', requireAuth, ah(async (req, res) => {
    const report = await pool.query('SELECT * FROM donation_impact_reports WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!report.rows.length) return res.status(404).json({ error: 'Report not found' });
    const donors = await pool.query('SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL LIMIT 500', [req.session.user.tenant_id]);
    let sent = 0;
    for (const d of donors.rows) {
      try {
        await sendEmail(d.donor_email, 'Impact Report: ' + report.rows[0].title, `Dear ${d.donor_name||'Donor'},\n\nWe are pleased to share our latest impact report: "${report.rows[0].title}".\n\nTotal funds deployed: ${report.rows[0].total_funds}\nBeneficiaries reached: ${report.rows[0].beneficiaries_count}\n\nThank you for making this possible.`);
        sent++;
      } catch(e) {}
    }
    await audit(req.session.user.email, 'update', 'donation_impact_reports id=' + req.params.id);
    res.json({ ok: true, sent_to: sent });
  }));
  app.get('/api/impact-reports/public/:id', ah(async (req, res) => {
    const report = await pool.query('SELECT * FROM donation_impact_reports WHERE id=$1 AND is_published=true AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    if (!report.rows.length) return res.status(404).json({ error: 'Report not found' });
    const sections = await pool.query('SELECT * FROM impact_report_sections WHERE report_id=$1 AND tenant_id=$2 ORDER BY sort_order', [req.params.id, req.session.user.tenant_id]);
    await pool.query('UPDATE donation_impact_reports SET view_count=view_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    res.json({ report: report.rows[0], sections: sections.rows });
  }));
  // Sections
  app.get('/api/impact-reports/:id/sections', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM impact_report_sections WHERE tenant_id=$1 AND report_id=$2 ORDER BY sort_order', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/impact-reports/:id/sections', requireAuth, ah(async (req, res) => {
    const { section_title, section_type, content_html, image_url, data_json, sort_order } = req.body;
    if (!section_title) return res.status(400).json({ error: 'section_title required' });
    const r = await pool.query('INSERT INTO impact_report_sections (tenant_id,report_id,section_title,section_type,content_html,image_url,data_json,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(section_title), esc(section_type||'text'), esc(content_html||''), esc(image_url||''), JSON.stringify(data_json||{}), sort_order||0]);
    await audit(req.session.user.email, 'create', 'impact_report_sections id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/impact-reports/:reportId/sections/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE impact_report_sections SET section_title=COALESCE($1,section_title), content_html=COALESCE($2,content_html), image_url=COALESCE($3,image_url), sort_order=COALESCE($4,sort_order) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.section_title?esc(req.body.section_title):null, req.body.content_html?esc(req.body.content_html):null, req.body.image_url?esc(req.body.image_url):null, req.body.sort_order||null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'impact_report_sections id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/impact-reports/:reportId/sections/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM impact_report_sections WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'impact_report_sections id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/impact-reports', requireAuth, ah(async (req, res) => {
    const reports = await pool.query('SELECT * FROM donation_impact_reports WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Impact Reports', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Impact Reports</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${reports.rows.map(r => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(r.title)}</h3><p>Funds: ${r.total_funds} | Beneficiaries: ${r.beneficiaries_count} | ${r.is_published?'Published':'Draft'} | Views: ${r.view_count}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 7: COLLABORATION PORTAL
  // ================================================================
  app.get('/api/collaborations', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT cc.*, (SELECT COUNT(*) FROM collaboration_tasks WHERE collaboration_id=cc.id) as task_count, (SELECT COUNT(*) FROM collaboration_tasks WHERE collaboration_id=cc.id AND status=$2) as completed_task_count FROM campaign_collaboration cc WHERE cc.tenant_id=$1';
    const params = [req.session.user.tenant_id, 'done'];
    let idx = 3;
    if (status) { q += ' AND cc.status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY cc.created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/collaborations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM campaign_collaboration WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Collaboration not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/collaborations', requireAuth, ah(async (req, res) => {
    const { campaign_id, campaign_name, description, invited_emails } = req.body;
    if (!campaign_name) return res.status(400).json({ error: 'campaign_name required' });
    const r = await pool.query('INSERT INTO campaign_collaboration (tenant_id,campaign_id,campaign_name,description,invited_emails,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, campaign_id||null, esc(campaign_name), esc(description||''), JSON.stringify(invited_emails||[]), esc(req.session.user.email)]);
    // Notify invited members
    if (Array.isArray(invited_emails)) {
      for (const email of invited_emails) {
        try { await notify(email, 'You have been invited to collaborate on: ' + campaign_name); } catch(e) {}
      }
    }
    await audit(req.session.user.email, 'create', 'campaign_collaboration id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/collaborations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE campaign_collaboration SET description=COALESCE($1,description), status=COALESCE($2,status), invited_emails=COALESCE($3,invited_emails) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.description?esc(req.body.description):null, req.body.status||null, req.body.invited_emails?JSON.stringify(req.body.invited_emails):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Collaboration not found' });
    await audit(req.session.user.email, 'update', 'campaign_collaboration id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/collaborations/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM campaign_collaboration WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'campaign_collaboration id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/collaborations/:id/accept', requireAuth, ah(async (req, res) => {
    const collab = await pool.query('SELECT * FROM campaign_collaboration WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!collab.rows.length) return res.status(404).json({ error: 'Collaboration not found' });
    res.json({ ok: true, message: 'Invitation accepted for ' + collab.rows[0].campaign_name });
  }));
  app.post('/api/collaborations/:id/invite', requireAuth, ah(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const collab = await pool.query('SELECT * FROM campaign_collaboration WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!collab.rows.length) return res.status(404).json({ error: 'Collaboration not found' });
    const existing = JSON.parse(collab.rows[0].invited_emails || '[]');
    if (!existing.includes(email)) {
      existing.push(email);
      await pool.query('UPDATE campaign_collaboration SET invited_emails=$1 WHERE id=$2 AND tenant_id=$3', [JSON.stringify(existing), req.params.id, req.session.user.tenant_id]);
    }
    try { await notify(email, 'You have been invited to collaborate on: ' + collab.rows[0].campaign_name); } catch(e) {}
    await audit(req.session.user.email, 'update', 'campaign_collaboration id=' + req.params.id); res.json({ ok: true, invited: email });
  }));
  // Tasks
  app.get('/api/collaborations/:id/tasks', requireAuth, ah(async (req, res) => {
    const { status, priority, assignee_email } = req.query;
    let q = 'SELECT * FROM collaboration_tasks WHERE tenant_id=$1 AND collaboration_id=$2';
    const params = [req.session.user.tenant_id, req.params.id];
    let idx = 3;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (priority) { q += ' AND priority=$' + idx; params.push(esc(priority)); idx++; }
    if (assignee_email) { q += ' AND assignee_email=$' + idx; params.push(esc(assignee_email)); idx++; }
    q += ' ORDER BY priority DESC, due_date';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.post('/api/collaborations/:id/tasks', requireAuth, ah(async (req, res) => {
    const { task_name, assignee_email, description, due_date, priority, status } = req.body;
    if (!task_name) return res.status(400).json({ error: 'task_name required' });
    const r = await pool.query('INSERT INTO collaboration_tasks (tenant_id,collaboration_id,task_name,assignee_email,description,due_date,priority,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(task_name), esc(assignee_email||''), esc(description||''), due_date||null, priority||'medium', status||'todo']);
    if (assignee_email) {
      try { await notify(assignee_email, 'New task assigned: ' + task_name); } catch(e) {}
    }
    await audit(req.session.user.email, 'create', 'collaboration_tasks id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/collaborations/:collaborationId/tasks/:id', requireAuth, ah(async (req, res) => {
    const { status, assignee_email, priority, due_date, description } = req.body;
    let q = 'UPDATE collaboration_tasks SET status=COALESCE($1,status), assignee_email=COALESCE($2,assignee_email), priority=COALESCE($3,priority), due_date=COALESCE($4,due_date), description=COALESCE($5,description)';
    const params = [status||null, assignee_email?esc(assignee_email):null, priority||null, due_date||null, description?esc(description):null];
    let idx = 6;
    if (status === 'done') { q += ', completed_at=NOW()'; }
    q += ' WHERE tenant_id=$' + idx + ' AND id=$' + (idx+1) + ' RETURNING *';
    params.push(req.session.user.tenant_id, req.params.id);
    const r = await pool.query(q, params);
    if (!r.rows.length) return res.status(404).json({ error: 'Task not found' });
    await audit(req.session.user.email, 'update', 'collaboration_tasks id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/collaborations/:collaborationId/tasks/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM collaboration_tasks WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'collaboration_tasks id=' + req.params.id); res.json({ ok: true });
  }));
  // Comments on tasks
  app.get('/api/collaboration-tasks/:taskId/comments', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM collaboration_comments WHERE tenant_id=$1 AND task_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.taskId]);
    res.json(r.rows);
  }));
  app.post('/api/collaboration-tasks/:taskId/comments', requireAuth, ah(async (req, res) => {
    const { comment } = req.body;
    if (!comment) return res.status(400).json({ error: 'comment required' });
    const r = await pool.query('INSERT INTO collaboration_comments (tenant_id,task_id,author_email,comment) VALUES ($1,$2,$3,$4) RETURNING *', [req.session.user.tenant_id, req.params.taskId, esc(req.session.user.email), esc(comment)]);
    res.json(r.rows[0]);
  }));
  // Task stats
  app.get('/api/collaborations/:id/task-stats', requireAuth, ah(async (req, res) => {
    const stats = await pool.query('SELECT status, COUNT(*) as count FROM collaboration_tasks WHERE tenant_id=$1 AND collaboration_id=$2 GROUP BY status', [req.session.user.tenant_id, req.params.id]);
    const overdue = await pool.query("SELECT COUNT(*) as cnt FROM collaboration_tasks WHERE tenant_id=$1 AND collaboration_id=$2 AND status != 'done' AND due_date < CURRENT_DATE", [req.session.user.tenant_id, req.params.id]);
    const byPriority = await pool.query('SELECT priority, COUNT(*) as count FROM collaboration_tasks WHERE tenant_id=$1 AND collaboration_id=$2 GROUP BY priority', [req.session.user.tenant_id, req.params.id]);
    res.json({ by_status: stats.rows, by_priority: byPriority.rows, overdue: parseInt(overdue.rows[0]?.cnt||0) });
  }));
  app.get('/collaboration-portal', requireAuth, ah(async (req, res) => {
    const collabs = await pool.query('SELECT * FROM campaign_collaboration WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Collaboration Portal', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Collaboration Portal</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${collabs.rows.map(c => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(c.campaign_name)}</h3><p>${c.status} | By: ${c.created_by||'N/A'}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 8: COMMUNICATION HUB
  // ================================================================
  app.get('/api/communication-hub', requireAuth, ah(async (req, res) => {
    const { channel_type, direction, status, limit } = req.query;
    let q = 'SELECT * FROM communication_hub WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (channel_type) { q += ' AND channel_type=$' + idx; params.push(esc(channel_type)); idx++; }
    if (direction) { q += ' AND direction=$' + idx; params.push(esc(direction)); idx++; }
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY created_at DESC LIMIT ' + (parseInt(limit)||100);
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/communication-hub/stats', requireAuth, ah(async (req, res) => {
    const byChannel = await pool.query('SELECT channel_type, COUNT(*) as count FROM communication_hub WHERE tenant_id=$1 GROUP BY channel_type', [req.session.user.tenant_id]);
    const byDirection = await pool.query('SELECT direction, COUNT(*) as count FROM communication_hub WHERE tenant_id=$1 GROUP BY direction', [req.session.user.tenant_id]);
    const byStatus = await pool.query('SELECT status, COUNT(*) as count FROM communication_hub WHERE tenant_id=$1 GROUP BY status', [req.session.user.tenant_id]);
    const recentCount = await pool.query("SELECT COUNT(*) as cnt FROM communication_hub WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '7 days'", [req.session.user.tenant_id]);
    res.json({ by_channel: byChannel.rows, by_direction: byDirection.rows, by_status: byStatus.rows, last_7_days: parseInt(recentCount.rows[0]?.cnt||0) });
  }));
  app.get('/api/communication-hub/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM communication_hub WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Message not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/communication-hub', requireAuth, ah(async (req, res) => {
    const { channel_type, direction, sender, recipient, subject, body, scheduled_at } = req.body;
    if (!recipient || !body) return res.status(400).json({ error: 'recipient and body required' });
    const statusVal = scheduled_at ? 'scheduled' : 'sent';
    const r = await pool.query('INSERT INTO communication_hub (tenant_id,channel_type,direction,sender,recipient,subject,body,status,scheduled_at,sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8=$10 THEN NULL ELSE NOW() END) RETURNING *', [req.session.user.tenant_id, esc(channel_type||'email'), esc(direction||'outbound'), esc(sender||req.session.user.email), esc(recipient), esc(subject||''), esc(body), statusVal, scheduled_at||null, 'scheduled']);
    // Send the message immediately if not scheduled
    if (!scheduled_at) {
      if (channel_type === 'email' || !channel_type) {
        try { await sendEmail(recipient, subject||'Message from Fundraising', body); } catch(e) {}
      } else if (channel_type === 'sms') {
        try { await sendSMS(recipient, body); } catch(e) {}
      }
    }
    await pool.query('INSERT INTO unified_messages (tenant_id,hub_id,donor_email,channel,message_text,thread_id) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, r.rows[0].id, esc(recipient), esc(channel_type||'email'), esc(body), 'thread-' + r.rows[0].id]);
    await audit(req.session.user.email, 'create', 'communication_hub id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/communication-hub/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE communication_hub SET status=COALESCE($1,status), read_at=CASE WHEN $2=true THEN NOW() ELSE read_at END WHERE tenant_id=$3 AND id=$4 RETURNING *', [req.body.status||null, req.body.is_read||false, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Message not found' });
    res.json(r.rows[0]);
  }));
  app.delete('/api/communication-hub/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM communication_hub WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'communication_hub id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/communication-hub/broadcast', requireAuth, ah(async (req, res) => {
    const { channel_type, subject, body, target_segment } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    let donors;
    if (target_segment === 'major') {
      donors = await pool.query("SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND amount > 1000000 AND status='completed'", [req.session.user.tenant_id]);
    } else if (target_segment === 'recurring') {
      donors = await pool.query("SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND is_recurring=true AND status='completed'", [req.session.user.tenant_id]);
    } else if (target_segment === 'lapsed') {
      donors = await pool.query("SELECT DISTINCT d1.donor_email, d1.donor_name FROM donations d1 WHERE tenant_id=$1 AND d1.donor_email NOT IN (SELECT donor_email FROM donations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '12 months')", [req.session.user.tenant_id]);
    } else {
      donors = await pool.query('SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL', [req.session.user.tenant_id]);
    }
    let sent = 0;
    for (const d of donors.rows) {
      if (!d.donor_email) continue;
      const r = await pool.query('INSERT INTO communication_hub (tenant_id,channel_type,direction,sender,recipient,subject,body,status,sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *', [req.session.user.tenant_id, esc(channel_type||'email'), 'outbound', esc(req.session.user.email), esc(d.donor_email), esc(subject||''), esc(body), 'sent']);
      await pool.query('INSERT INTO unified_messages (tenant_id,hub_id,donor_email,donor_name,channel,message_text,thread_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [req.session.user.tenant_id, r.rows[0].id, esc(d.donor_email), esc(d.donor_name||''), esc(channel_type||'email'), esc(body), 'thread-' + r.rows[0].id]);
      if (channel_type === 'sms') {
        try { await sendSMS(d.donor_email, body); } catch(e) {}
      } else {
        try { await sendEmail(d.donor_email, subject||'Message from Fundraising', body); } catch(e) {}
      }
      sent++;
    }
    await audit(req.session.user.email, 'create', 'communication_hub id=' + 0); res.json({ ok: true, sent });
  }));
  app.get('/api/communication-hub/donor-history', requireAuth, ah(async (req, res) => {
    const { donor_email } = req.query;
    if (!donor_email) return res.status(400).json({ error: 'donor_email query param required' });
    const hub = await pool.query('SELECT * FROM communication_hub WHERE tenant_id=$1 AND recipient=$2 ORDER BY created_at DESC LIMIT 50', [req.session.user.tenant_id, esc(donor_email)]);
    const unified = await pool.query('SELECT * FROM unified_messages WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 50', [req.session.user.tenant_id, esc(donor_email)]);
    res.json({ hub_messages: hub.rows, unified_messages: unified.rows });
  }));
  // Communication Templates
  app.get('/api/communication-templates', requireAuth, ah(async (req, res) => {
    const { channel_type } = req.query;
    let q = 'SELECT * FROM communication_templates WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (channel_type) { q += ' AND channel_type=$2'; params.push(esc(channel_type)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.post('/api/communication-templates', requireAuth, ah(async (req, res) => {
    const { template_name, channel_type, subject, body_template, variables_json } = req.body;
    if (!template_name || !body_template) return res.status(400).json({ error: 'template_name and body_template required' });
    const r = await pool.query('INSERT INTO communication_templates (tenant_id,template_name,channel_type,subject,body_template,variables_json) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, esc(template_name), esc(channel_type||'email'), esc(subject||''), esc(body_template), JSON.stringify(variables_json||[])]);
    await audit(req.session.user.email, 'create', 'communication_templates id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/communication-templates/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE communication_templates SET template_name=COALESCE($1,template_name), subject=COALESCE($2,subject), body_template=COALESCE($3,body_template), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.template_name?esc(req.body.template_name):null, req.body.subject?esc(req.body.subject):null, req.body.body_template?esc(req.body.body_template):null, req.body.is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await audit(req.session.user.email, 'update', 'communication_templates id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/communication-templates/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM communication_templates WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'communication_templates id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/communication-templates/:id/use', requireAuth, ah(async (req, res) => {
    const tmpl = await pool.query('SELECT * FROM communication_templates WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!tmpl.rows.length) return res.status(404).json({ error: 'Template not found' });
    await pool.query('UPDATE communication_templates SET usage_count=usage_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    const { recipient, variables } = req.body;
    if (!recipient) return res.status(400).json({ error: 'recipient required' });
    let body = tmpl.rows[0].body_template;
    let subject = tmpl.rows[0].subject || '';
    const vars = variables || {};
    for (const [key, val] of Object.entries(vars)) {
      body = body.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), val);
      subject = subject.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), val);
    }
    const r = await pool.query('INSERT INTO communication_hub (tenant_id,channel_type,direction,sender,recipient,subject,body,status,sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *', [req.session.user.tenant_id, esc(tmpl.rows[0].channel_type), 'outbound', esc(req.session.user.email), esc(recipient), esc(subject), esc(body), 'sent']);
    if (tmpl.rows[0].channel_type === 'sms') {
      try { await sendSMS(recipient, body); } catch(e) {}
    } else {
      try { await sendEmail(recipient, subject, body); } catch(e) {}
    }
    await audit(req.session.user.email, 'create', 'communication_hub id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  // Unified Messages
  app.get('/api/unified-messages', requireAuth, ah(async (req, res) => {
    const { donor_email, is_read, channel } = req.query;
    let q = 'SELECT * FROM unified_messages WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    if (is_read !== undefined) { q += ' AND is_read=$' + idx; params.push(is_read === 'true'); idx++; }
    if (channel) { q += ' AND channel=$' + idx; params.push(esc(channel)); idx++; }
    q += ' ORDER BY created_at DESC LIMIT 100';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.put('/api/unified-messages/:id/read', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE unified_messages SET is_read=true WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.put('/api/unified-messages/mark-all-read', requireAuth, ah(async (req, res) => {
    await pool.query('UPDATE unified_messages SET is_read=true WHERE tenant_id=$1 AND is_read=false', [req.session.user.tenant_id]);
    res.json({ ok: true });
  }));
  app.get('/api/unified-messages/unread-count', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT COUNT(*) as count FROM unified_messages WHERE tenant_id=$1 AND is_read=false', [req.session.user.tenant_id]);
    res.json({ unread: parseInt(r.rows[0]?.count||0) });
  }));
  app.get('/communication-hub', requireAuth, ah(async (req, res) => {
    const messages = await pool.query("SELECT * FROM communication_hub WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20", [req.session.user.tenant_id]);
    const unread = await pool.query("SELECT COUNT(*) as cnt FROM unified_messages WHERE tenant_id=$1 AND is_read=false", [req.session.user.tenant_id]);
    const templates = await pool.query("SELECT COUNT(*) as cnt FROM communication_templates WHERE tenant_id=$1 AND is_active=true", [req.session.user.tenant_id]);
    renderPage(req, res, 'Communication Hub', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Communication Hub</h1><div class="grid grid-cols-1 md:grid-cols-4 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Recent</h3><p>${messages.rows.length}</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Unread</h3><p>${unread.rows[0]?.cnt||0}</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Templates</h3><p>${templates.rows[0]?.cnt||0}</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Channels</h3><p>Email, SMS, Push, WhatsApp, Direct Mail</p></div></div></div>`);
  }));

  console.log('[FundraisingUltimate11] 8 features registered — Vehicle Donations, Family Foundations, Mobile/PWA, Risk Assessment, Compliance Checker, Impact Reports, Collaboration Portal, Communication Hub');
};
