/**
 * Fundraising Ultimate8 Module — Advanced Campaign & Donor Tools
 * Features: Capital Campaigns, Tribute/Memorial Donations, Crowdfunding Perks/Rewards,
 * Campaign Thermometer/Widgets, Donor Self-Service Portal, Email Campaign Builder,
 * Direct Mail Integration, Donor Heatmaps/Geographic Analysis
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Capital Campaigns
    `CREATE TABLE IF NOT EXISTS capital_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, total_goal INTEGER NOT NULL DEFAULT 0, quiet_phase_goal INTEGER DEFAULT 0, quiet_phase_start DATE, public_phase_start DATE, end_date DATE, current_total INTEGER DEFAULT 0, status TEXT DEFAULT 'planning' CHECK (status IN ('planning','quiet','public','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS capital_phases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL REFERENCES capital_campaigns(id) ON DELETE CASCADE, phase_name TEXT NOT NULL, goal_amount INTEGER DEFAULT 0, start_date DATE, end_date DATE, status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','completed')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS capital_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL REFERENCES capital_campaigns(id) ON DELETE CASCADE, phase_id INTEGER REFERENCES capital_phases(id) ON DELETE SET NULL, donor_name TEXT NOT NULL, donor_email TEXT, amount_pledged INTEGER NOT NULL DEFAULT 0, amount_paid INTEGER DEFAULT 0, payment_schedule TEXT DEFAULT 'one_time' CHECK (payment_schedule IN ('one_time','monthly','quarterly','annually')), status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','defaulted','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_cap_campaigns_tenant ON capital_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cap_phases_campaign ON capital_phases(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cap_pledges_campaign ON capital_pledges(campaign_id)`,

    // Feature 2: Tribute / Memorial Donations
    `CREATE TABLE IF NOT EXISTS tribute_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT, tribute_type TEXT NOT NULL CHECK (tribute_type IN ('in_honor','in_memory')), honoree_name TEXT NOT NULL, honoree_email TEXT, family_contact_name TEXT, family_contact_email TEXT, family_notified BOOLEAN DEFAULT false, message TEXT, amount INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS memorial_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, honoree_name TEXT NOT NULL, honoree_photo TEXT, biography TEXT, birth_date DATE, passing_date DATE, page_url TEXT UNIQUE, total_raised INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_tribute_donations_tenant ON tribute_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memorial_pages_tenant ON memorial_pages(tenant_id)`,

    // Feature 3: Crowdfunding Perks / Rewards
    `CREATE TABLE IF NOT EXISTS crowdfunding_perks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, perk_name TEXT NOT NULL, description TEXT, min_amount INTEGER NOT NULL DEFAULT 0, quantity_available INTEGER DEFAULT 0, quantity_claimed INTEGER DEFAULT 0, estimated_delivery DATE, image_url TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS perk_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, perk_id INTEGER NOT NULL REFERENCES crowdfunding_perks(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT, donation_id INTEGER, shipping_address TEXT, claimed_at TIMESTAMPTZ DEFAULT NOW(), fulfilled BOOLEAN DEFAULT false, fulfilled_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS idx_crowd_perks_tenant ON crowdfunding_perks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_perk_claims_perk ON perk_claims(perk_id)`,

    // Feature 4: Campaign Thermometer / Widgets
    `CREATE TABLE IF NOT EXISTS campaign_thermometers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, widget_type TEXT DEFAULT 'thermometer' CHECK (widget_type IN ('thermometer','progress_bar','circle','badge')), style TEXT DEFAULT 'default', color_scheme TEXT DEFAULT '#059669', show_donor_count BOOLEAN DEFAULT true, show_percentage BOOLEAN DEFAULT true, embed_token TEXT UNIQUE, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS thermometer_views (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, thermometer_id INTEGER NOT NULL REFERENCES campaign_thermometers(id) ON DELETE CASCADE, viewer_ip TEXT, referrer TEXT, viewed_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_thermometer_tenant ON campaign_thermometers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_therm_views_therm ON thermometer_views(thermometer_id)`,

    // Feature 5: Donor Self-Service Portal
    `CREATE TABLE IF NOT EXISTS donor_portal_preferences (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, display_name TEXT, bio TEXT, preferred_communication TEXT DEFAULT 'email' CHECK (preferred_communication IN ('email','sms','both')), show_donations_publicly BOOLEAN DEFAULT false, email_receipts BOOLEAN DEFAULT true, sms_receipts BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE TABLE IF NOT EXISTS donor_portal_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, session_token TEXT NOT NULL UNIQUE, ip_address TEXT, user_agent TEXT, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_prefs_tenant ON donor_portal_preferences(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_sessions_token ON donor_portal_sessions(session_token)`,

    // Feature 6: Email Campaign Builder
    `CREATE TABLE IF NOT EXISTS email_templates_builder (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT, body_text TEXT, category TEXT DEFAULT 'general', thumbnail_url TEXT, is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS email_campaign_builder (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, template_id INTEGER REFERENCES email_templates_builder(id) ON DELETE SET NULL, name TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT, sender_name TEXT, sender_email TEXT, recipient_segment TEXT DEFAULT 'all', status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')), scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, recipient_count INTEGER DEFAULT 0, open_count INTEGER DEFAULT 0, click_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_email_tmpl_builder_tenant ON email_templates_builder(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_email_camp_builder_tenant ON email_campaign_builder(tenant_id)`,

    // Feature 7: Direct Mail Integration
    `CREATE TABLE IF NOT EXISTS direct_mail_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, template_content TEXT, recipient_segment TEXT DEFAULT 'all', mail_class TEXT DEFAULT 'standard' CHECK (mail_class IN ('standard','first_class','priority')), total_recipients INTEGER DEFAULT 0, estimated_cost INTEGER DEFAULT 0, status TEXT DEFAULT 'draft' CHECK (status IN ('draft','preview','approved','sending','sent','failed')), sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS direct_mail_recipients (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL REFERENCES direct_mail_campaigns(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT DEFAULT 'Uganda', status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','returned','failed')), sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_direct_mail_tenant ON direct_mail_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_direct_mail_recipients_camp ON direct_mail_recipients(campaign_id)`,

    // Feature 8: Donor Heatmaps / Geographic Analysis
    `CREATE TABLE IF NOT EXISTS donor_heatmap_data (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, latitude NUMERIC, longitude NUMERIC, city TEXT, region TEXT, country TEXT, total_donated INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, last_donation_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS regional_donation_stats (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, region TEXT NOT NULL, country TEXT NOT NULL, total_donated INTEGER DEFAULT 0, donor_count INTEGER DEFAULT 0, avg_donation INTEGER DEFAULT 0, top_category TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, region, country))`,
    `CREATE INDEX IF NOT EXISTS idx_heatmap_tenant ON donor_heatmap_data(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_regional_stats_tenant ON regional_donation_stats(tenant_id)`,

    // Seed default email templates
    `INSERT INTO email_templates_builder (tenant_id, name, subject, body_html, body_text, category, is_default) SELECT t.id, 'Welcome Donor', 'Thank You for Your Generosity', '<h2>Thank You!</h2><p>Dear {donor_name},</p><p>Your donation of {amount} makes a real difference.</p><p>With gratitude,<br>{organization}</p>', 'Thank You! Dear {donor_name}, Your donation of {amount} makes a real difference. With gratitude, {organization}', 'thank_you', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM email_templates_builder WHERE tenant_id=t.id AND name='Welcome Donor')`,
    `INSERT INTO email_templates_builder (tenant_id, name, subject, body_html, body_text, category, is_default) SELECT t.id, 'Campaign Update', 'Update: {campaign_name}', '<h2>Campaign Update</h2><p>Dear {donor_name},</p><p>{campaign_name} has raised {amount_raised} of our {goal} goal!</p><p>{update_text}</p>', 'Campaign Update: {campaign_name} has raised {amount_raised} of our {goal} goal! {update_text}', 'campaign', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM email_templates_builder WHERE tenant_id=t.id AND name='Campaign Update')`,
    `INSERT INTO email_templates_builder (tenant_id, name, subject, body_html, body_text, category, is_default) SELECT t.id, 'Donation Receipt', 'Your Donation Receipt', '<h2>Donation Receipt</h2><p>Dear {donor_name},</p><p>Receipt #{receipt_id}<br>Amount: {amount}<br>Date: {date}</p><p>Thank you for your support!</p>', 'Donation Receipt #{receipt_id} - Amount: {amount} - Date: {date}. Thank you!', 'receipt', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM email_templates_builder WHERE tenant_id=t.id AND name='Donation Receipt')`,
    `INSERT INTO email_templates_builder (tenant_id, name, subject, body_html, body_text, category, is_default) SELECT t.id, 'Pledge Reminder', 'Pledge Payment Reminder', '<h2>Pledge Reminder</h2><p>Dear {donor_name},</p><p>This is a friendly reminder about your pledge of {amount_pledged} to {campaign_name}.</p><p>Amount paid so far: {amount_paid}</p><p>Remaining: {amount_remaining}</p>', 'Pledge Reminder: Your pledge of {amount_pledged} to {campaign_name}. Paid: {amount_paid}. Remaining: {amount_remaining}', 'reminder', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM email_templates_builder WHERE tenant_id=t.id AND name='Pledge Reminder')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate8] Migrations complete — 8 features');
  })();

  // =============================================
  // FEATURE 1: CAPITAL CAMPAIGNS
  // =============================================
  app.get('/api/capital-campaigns', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM capital_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/capital-campaigns', requireAuth, ah(async (req, res) => {
    const { name, description, total_goal, quiet_phase_goal, quiet_phase_start, public_phase_start, end_date, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!total_goal || total_goal <= 0) return res.status(400).json({ error: 'Total goal must be greater than 0' });
    const r = await pool.query(
      `INSERT INTO capital_campaigns (tenant_id, name, description, total_goal, quiet_phase_goal, quiet_phase_start, public_phase_start, end_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(description||''), total_goal, quiet_phase_goal||0, quiet_phase_start||null, public_phase_start||null, end_date||null, status||'planning']
    );
    await audit(req, 'create', 'capital_campaigns', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/capital-campaigns/:id', requireAuth, ah(async (req, res) => {
    const { name, description, total_goal, quiet_phase_goal, quiet_phase_start, public_phase_start, end_date, status } = req.body;
    const r = await pool.query(
      `UPDATE capital_campaigns SET name=COALESCE($1,name), description=COALESCE($2,description), total_goal=COALESCE($3,total_goal), quiet_phase_goal=COALESCE($4,quiet_phase_goal), quiet_phase_start=COALESCE($5,quiet_phase_start), public_phase_start=COALESCE($6,public_phase_start), end_date=COALESCE($7,end_date), status=COALESCE($8,status) WHERE tenant_id=$9 AND id=$10 RETURNING *`,
      [name?esc(name):null, description?esc(description):null, total_goal, quiet_phase_goal, quiet_phase_start||null, public_phase_start||null, end_date||null, status||null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'capital_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Phases
  app.get('/api/capital-campaigns/:id/phases', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id FROM capital_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const r = await pool.query(`SELECT * FROM capital_phases WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY start_date`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/capital-campaigns/:id/phases', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id FROM capital_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const { phase_name, goal_amount, start_date, end_date, status } = req.body;
    if (!phase_name) return res.status(400).json({ error: 'Phase name is required' });
    const r = await pool.query(
      `INSERT INTO capital_phases (tenant_id, campaign_id, phase_name, goal_amount, start_date, end_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, esc(phase_name), goal_amount||0, start_date||null, end_date||null, status||'upcoming']
    );
    await audit(req, 'create', 'capital_phases', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/capital-campaigns/:id/phases/:phaseId', requireAuth, ah(async (req, res) => {
    const { phase_name, goal_amount, start_date, end_date, status } = req.body;
    const r = await pool.query(
      `UPDATE capital_phases SET phase_name=COALESCE($1,phase_name), goal_amount=COALESCE($2,goal_amount), start_date=COALESCE($3,start_date), end_date=COALESCE($4,end_date), status=COALESCE($5,status) WHERE tenant_id=$6 AND campaign_id=$7 AND id=$8 RETURNING *`,
      [phase_name?esc(phase_name):null, goal_amount, start_date||null, end_date||null, status||null, req.session.user.tenant_id, req.params.id, req.params.phaseId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Phase not found' });
    await audit(req, 'update', 'capital_phases', req.params.phaseId);
    res.json(r.rows[0]);
  }));

  // Pledges
  app.get('/api/capital-campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id FROM capital_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const r = await pool.query(`SELECT * FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/capital-campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id FROM capital_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const { phase_id, donor_name, donor_email, amount_pledged, payment_schedule, status } = req.body;
    if (!donor_name || !amount_pledged) return res.status(400).json({ error: 'donor_name and amount_pledged are required' });
    const r = await pool.query(
      `INSERT INTO capital_pledges (tenant_id, campaign_id, phase_id, donor_name, donor_email, amount_pledged, payment_schedule, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, phase_id||null, esc(donor_name), esc(donor_email||''), amount_pledged, payment_schedule||'one_time', status||'active']
    );
    // Update campaign current_total
    await pool.query(`UPDATE capital_campaigns SET current_total=current_total+$1 WHERE id=$2`, [amount_pledged, req.params.id]);
    await audit(req, 'create', 'capital_pledges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/capital-campaigns/:id/pledges/:pledgeId', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, amount_pledged, payment_schedule, status } = req.body;
    const existing = await pool.query(`SELECT amount_pledged FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3`, [req.session.user.tenant_id, req.params.id, req.params.pledgeId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Pledge not found' });
    const oldAmount = existing.rows[0].amount_pledged;
    const r = await pool.query(
      `UPDATE capital_pledges SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), amount_pledged=COALESCE($3,amount_pledged), payment_schedule=COALESCE($4,payment_schedule), status=COALESCE($5,status) WHERE tenant_id=$6 AND campaign_id=$7 AND id=$8 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, amount_pledged, payment_schedule||null, status||null, req.session.user.tenant_id, req.params.id, req.params.pledgeId]
    );
    if (amount_pledged && amount_pledged !== oldAmount) {
      const diff = amount_pledged - oldAmount;
      await pool.query(`UPDATE capital_campaigns SET current_total=current_total+$1 WHERE id=$2`, [diff, req.params.id]);
    }
    await audit(req, 'update', 'capital_pledges', req.params.pledgeId);
    res.json(r.rows[0]);
  }));

  app.post('/api/capital-campaigns/:id/pledges/:pledgeId/pay', requireAuth, ah(async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0' });
    const pledge = await pool.query(`SELECT * FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3`, [req.session.user.tenant_id, req.params.id, req.params.pledgeId]);
    if (!pledge.rows.length) return res.status(404).json({ error: 'Pledge not found' });
    const newPaid = pledge.rows[0].amount_paid + amount;
    const newStatus = newPaid >= pledge.rows[0].amount_pledged ? 'completed' : pledge.rows[0].status;
    const r = await pool.query(`UPDATE capital_pledges SET amount_paid=$1, status=$2 WHERE id=$3 RETURNING *`, [newPaid, newStatus, req.params.pledgeId]);
    await audit(req, 'payment', 'capital_pledges', req.params.pledgeId);
    res.json(r.rows[0]);
  }));

  app.get('/api/capital-campaigns/:id/progress', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM capital_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const phases = await pool.query(`SELECT * FROM capital_phases WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY start_date`, [req.session.user.tenant_id, req.params.id]);
    const pledgeStats = await pool.query(
      `SELECT COUNT(*) as total_pledges, SUM(amount_pledged) as total_pledged, SUM(amount_paid) as total_paid, COUNT(CASE WHEN status='completed' THEN 1 END) as completed_pledges, COUNT(CASE WHEN status='active' THEN 1 END) as active_pledges FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2`,
      [req.session.user.tenant_id, req.params.id]
    );
    const ps = pledgeStats.rows[0];
    res.json({
      campaign: c,
      phases: phases.rows,
      progress_percentage: c.total_goal > 0 ? Math.round((c.current_total / c.total_goal) * 100) : 0,
      pledge_stats: {
        total_pledges: parseInt(ps.total_pledges)||0,
        total_pledged: parseInt(ps.total_pledged)||0,
        total_paid: parseInt(ps.total_paid)||0,
        completed_pledges: parseInt(ps.completed_pledges)||0,
        active_pledges: parseInt(ps.active_pledges)||0,
      }
    });
  }));

  // =============================================
  // FEATURE 2: TRIBUTE / MEMORIAL DONATIONS
  // =============================================
  app.get('/api/tribute-donations', requireAuth, ah(async (req, res) => {
    const { tribute_type } = req.query;
    let q = `SELECT * FROM tribute_donations WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (tribute_type) { q += ` AND tribute_type=$2`; params.push(tribute_type); }
    q += ` ORDER BY created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/tribute-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, tribute_type, honoree_name, honoree_email, family_contact_name, family_contact_email, message, amount } = req.body;
    if (!donor_name || !tribute_type || !honoree_name || !amount) return res.status(400).json({ error: 'donor_name, tribute_type, honoree_name, and amount are required' });
    const r = await pool.query(
      `INSERT INTO tribute_donations (tenant_id, campaign_id, donor_name, donor_email, tribute_type, honoree_name, honoree_email, family_contact_name, family_contact_email, message, amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.session.user.tenant_id, campaign_id||null, esc(donor_name), esc(donor_email||''), tribute_type, esc(honoree_name), esc(honoree_email||''), esc(family_contact_name||''), esc(family_contact_email||''), esc(message||''), amount]
    );
    await audit(req, 'create', 'tribute_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/tribute-donations/:id', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, honoree_name, honoree_email, family_contact_name, family_contact_email, message, amount, family_notified } = req.body;
    const r = await pool.query(
      `UPDATE tribute_donations SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), honoree_name=COALESCE($3,honoree_name), honoree_email=COALESCE($4,honoree_email), family_contact_name=COALESCE($5,family_contact_name), family_contact_email=COALESCE($6,family_contact_email), message=COALESCE($7,message), amount=COALESCE($8,amount), family_notified=COALESCE($9,family_notified) WHERE tenant_id=$10 AND id=$11 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, honoree_name?esc(honoree_name):null, honoree_email?esc(honoree_email):null, family_contact_name?esc(family_contact_name):null, family_contact_email?esc(family_contact_email):null, message?esc(message):null, amount, family_notified, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Tribute donation not found' });
    await audit(req, 'update', 'tribute_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/tribute-donations/:id/notify-family', requireAuth, ah(async (req, res) => {
    const td = await pool.query(`SELECT * FROM tribute_donations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!td.rows.length) return res.status(404).json({ error: 'Tribute donation not found' });
    const d = td.rows[0];
    if (!d.family_contact_email) return res.status(400).json({ error: 'No family contact email on record' });
    try {
      await sendEmail(d.family_contact_email, `A donation has been made ${d.tribute_type === 'in_memory' ? 'in memory of' : 'in honor of'} ${d.honoree_name}`, `Dear ${d.family_contact_name || 'Family'},\n\n${d.donor_name} has made a donation of UGX ${d.amount.toLocaleString()} ${d.tribute_type === 'in_memory' ? 'in memory of' : 'in honor of'} ${d.honoree_name}.\n\n${d.message ? 'Message: ' + d.message : ''}\n\nWith gratitude`);
    } catch(e) { /* best effort */ }
    await pool.query(`UPDATE tribute_donations SET family_notified=true WHERE id=$1`, [req.params.id]);
    await audit(req, 'notify_family', 'tribute_donations', req.params.id);
    res.json({ ok: true, message: 'Family notification sent' });
  }));

  // Memorial Pages
  app.get('/api/memorial-pages', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM memorial_pages WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/memorial-pages', requireAuth, ah(async (req, res) => {
    const { honoree_name, honoree_photo, biography, birth_date, passing_date, page_url, is_active } = req.body;
    if (!honoree_name) return res.status(400).json({ error: 'Honoree name is required' });
    const url = page_url || 'memorial-' + Date.now() + '-' + Math.random().toString(36).substring(2,8);
    const r = await pool.query(
      `INSERT INTO memorial_pages (tenant_id, honoree_name, honoree_photo, biography, birth_date, passing_date, page_url, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, esc(honoree_name), esc(honoree_photo||''), esc(biography||''), birth_date||null, passing_date||null, esc(url), is_active!==false]
    );
    await audit(req, 'create', 'memorial_pages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/memorial-pages/:id', requireAuth, ah(async (req, res) => {
    const { honoree_name, honoree_photo, biography, birth_date, passing_date, is_active } = req.body;
    const r = await pool.query(
      `UPDATE memorial_pages SET honoree_name=COALESCE($1,honoree_name), honoree_photo=COALESCE($2,honoree_photo), biography=COALESCE($3,biography), birth_date=COALESCE($4,birth_date), passing_date=COALESCE($5,passing_date), is_active=COALESCE($6,is_active) WHERE tenant_id=$7 AND id=$8 RETURNING *`,
      [honoree_name?esc(honoree_name):null, honoree_photo?esc(honoree_photo):null, biography?esc(biography):null, birth_date||null, passing_date||null, is_active, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Memorial page not found' });
    await audit(req, 'update', 'memorial_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  app.get('/api/memorial-pages/:id/donations', requireAuth, ah(async (req, res) => {
    const mp = await pool.query(`SELECT honoree_name FROM memorial_pages WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!mp.rows.length) return res.status(404).json({ error: 'Memorial page not found' });
    const r = await pool.query(
      `SELECT * FROM tribute_donations WHERE tenant_id=$1 AND tribute_type='in_memory' AND honoree_name=$2 ORDER BY created_at DESC`,
      [req.session.user.tenant_id, mp.rows[0].honoree_name]
    );
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 3: CROWDFUNDING PERKS / REWARDS
  // =============================================
  app.get('/api/campaigns/:id/perks', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 AND campaign_id=$2 AND is_active=true ORDER BY min_amount`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/campaigns/:id/perks', requireAuth, ah(async (req, res) => {
    const { perk_name, description, min_amount, quantity_available, estimated_delivery, image_url } = req.body;
    if (!perk_name || min_amount === undefined) return res.status(400).json({ error: 'perk_name and min_amount are required' });
    const r = await pool.query(
      `INSERT INTO crowdfunding_perks (tenant_id, campaign_id, perk_name, description, min_amount, quantity_available, estimated_delivery, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, esc(perk_name), esc(description||''), min_amount, quantity_available||0, estimated_delivery||null, esc(image_url||'')]
    );
    await audit(req, 'create', 'crowdfunding_perks', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/campaigns/:id/perks/:perkId', requireAuth, ah(async (req, res) => {
    const { perk_name, description, min_amount, quantity_available, estimated_delivery, image_url, is_active } = req.body;
    const r = await pool.query(
      `UPDATE crowdfunding_perks SET perk_name=COALESCE($1,perk_name), description=COALESCE($2,description), min_amount=COALESCE($3,min_amount), quantity_available=COALESCE($4,quantity_available), estimated_delivery=COALESCE($5,estimated_delivery), image_url=COALESCE($6,image_url), is_active=COALESCE($7,is_active) WHERE tenant_id=$8 AND campaign_id=$9 AND id=$10 RETURNING *`,
      [perk_name?esc(perk_name):null, description?esc(description):null, min_amount, quantity_available, estimated_delivery||null, image_url?esc(image_url):null, is_active, req.session.user.tenant_id, req.params.id, req.params.perkId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Perk not found' });
    await audit(req, 'update', 'crowdfunding_perks', req.params.perkId);
    res.json(r.rows[0]);
  }));

  app.delete('/api/campaigns/:id/perks/:perkId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE crowdfunding_perks SET is_active=false WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3 RETURNING id`, [req.session.user.tenant_id, req.params.id, req.params.perkId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Perk not found' });
    await audit(req, 'delete', 'crowdfunding_perks', req.params.perkId);
    res.json({ ok: true });
  }));

  app.post('/api/perks/:id/claim', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donation_id, shipping_address } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name is required' });
    const perk = await pool.query(`SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [req.session.user.tenant_id, req.params.id]);
    if (!perk.rows.length) return res.status(404).json({ error: 'Perk not found or inactive' });
    const p = perk.rows[0];
    if (p.quantity_available > 0 && p.quantity_claimed >= p.quantity_available) return res.status(400).json({ error: 'Perk is sold out' });
    const r = await pool.query(
      `INSERT INTO perk_claims (tenant_id, perk_id, donor_name, donor_email, donation_id, shipping_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, esc(donor_name), esc(donor_email||''), donation_id||null, esc(shipping_address||'')]
    );
    await pool.query(`UPDATE crowdfunding_perks SET quantity_claimed=quantity_claimed+1 WHERE id=$1`, [req.params.id]);
    await audit(req, 'claim', 'perk_claims', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/perks/:id/claims', requireAuth, ah(async (req, res) => {
    const perk = await pool.query(`SELECT id FROM crowdfunding_perks WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!perk.rows.length) return res.status(404).json({ error: 'Perk not found' });
    const r = await pool.query(`SELECT * FROM perk_claims WHERE tenant_id=$1 AND perk_id=$2 ORDER BY claimed_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.put('/api/perk-claims/:id/fulfill', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE perk_claims SET fulfilled=true, fulfilled_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Perk claim not found' });
    await audit(req, 'fulfill', 'perk_claims', req.params.id);
    res.json(r.rows[0]);
  }));

  app.get('/api/campaigns/:id/perks/stats', requireAuth, ah(async (req, res) => {
    const perks = await pool.query(`SELECT id, perk_name, min_amount, quantity_available, quantity_claimed FROM crowdfunding_perks WHERE tenant_id=$1 AND campaign_id=$2`, [req.session.user.tenant_id, req.params.id]);
    const claims = await pool.query(
      `SELECT pc.perk_id, COUNT(*) as total_claims, COUNT(CASE WHEN pc.fulfilled THEN 1 END) as fulfilled, COUNT(CASE WHEN NOT pc.fulfilled THEN 1 END) as pending FROM perk_claims pc JOIN crowdfunding_perks cp ON pc.perk_id=cp.id WHERE cp.tenant_id=$1 AND cp.campaign_id=$2 GROUP BY pc.perk_id`,
      [req.session.user.tenant_id, req.params.id]
    );
    const claimMap = {};
    claims.rows.forEach(c => { claimMap[c.perk_id] = c; });
    const stats = perks.rows.map(p => ({
      ...p,
      total_claims: parseInt(claimMap[p.id]?.total_claims)||0,
      fulfilled: parseInt(claimMap[p.id]?.fulfilled)||0,
      pending: parseInt(claimMap[p.id]?.pending)||0,
      remaining: p.quantity_available > 0 ? p.quantity_available - p.quantity_claimed : null,
    }));
    res.json(stats);
  }));

  // =============================================
  // FEATURE 4: CAMPAIGN THERMOMETER / WIDGETS
  // =============================================
  app.get('/api/campaigns/:id/thermometer', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_thermometers WHERE tenant_id=$1 AND campaign_id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0] || null);
  }));

  app.post('/api/campaigns/:id/thermometer', requireAuth, ah(async (req, res) => {
    const { widget_type, style, color_scheme, show_donor_count, show_percentage } = req.body;
    const embed_token = 'thm_' + Date.now() + '_' + Math.random().toString(36).substring(2,10);
    const r = await pool.query(
      `INSERT INTO campaign_thermometers (tenant_id, campaign_id, widget_type, style, color_scheme, show_donor_count, show_percentage, embed_token) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, widget_type||'thermometer', esc(style||'default'), esc(color_scheme||'#059669'), show_donor_count!==false, show_percentage!==false, embed_token]
    );
    await audit(req, 'create', 'campaign_thermometers', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/campaigns/:id/thermometer', requireAuth, ah(async (req, res) => {
    const { widget_type, style, color_scheme, show_donor_count, show_percentage, is_active } = req.body;
    const r = await pool.query(
      `UPDATE campaign_thermometers SET widget_type=COALESCE($1,widget_type), style=COALESCE($2,style), color_scheme=COALESCE($3,color_scheme), show_donor_count=COALESCE($4,show_donor_count), show_percentage=COALESCE($5,show_percentage), is_active=COALESCE($6,is_active) WHERE tenant_id=$7 AND campaign_id=$8 RETURNING *`,
      [widget_type||null, style?esc(style):null, color_scheme?esc(color_scheme):null, show_donor_count, show_percentage, is_active, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Thermometer not found for this campaign' });
    await audit(req, 'update', 'campaign_thermometers', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Public embed endpoint — NO auth required
  app.get('/api/thermometer/:embedToken/embed', ah(async (req, res) => {
    const therm = await pool.query(`SELECT ct.*, cc.name as campaign_name, cc.total_goal, cc.current_total, cc.status as campaign_status FROM campaign_thermometers ct JOIN capital_campaigns cc ON ct.campaign_id=cc.id WHERE ct.embed_token=$1 AND ct.is_active=true`, [req.params.embedToken]);
    if (!therm.rows.length) return res.status(404).json({ error: 'Widget not found' });
    const t = therm.rows[0];
    const percentage = t.total_goal > 0 ? Math.round((t.current_total / t.total_goal) * 100) : 0;
    res.json({
      campaign_name: t.campaign_name,
      total_goal: t.total_goal,
      current_total: t.current_total,
      percentage,
      widget_type: t.widget_type,
      color_scheme: t.color_scheme,
      show_donor_count: t.show_donor_count,
      show_percentage: t.show_percentage,
      campaign_status: t.campaign_status,
    });
  }));

  app.post('/api/thermometer/:id/track-view', ah(async (req, res) => {
    const therm = await pool.query(`SELECT id, tenant_id FROM campaign_thermometers WHERE id=$1`, [req.params.id]);
    if (!therm.rows.length) return res.status(404).json({ error: 'Thermometer not found' });
    const ip = req.headers['x-forwarded-for'] || req.ip || '';
    const referrer = req.headers.referer || '';
    await pool.query(`INSERT INTO thermometer_views (tenant_id, thermometer_id, viewer_ip, referrer) VALUES ($1,$2,$3,$4)`, [therm.rows[0].tenant_id, req.params.id, esc(ip), esc(referrer)]);
    res.json({ ok: true });
  }));

  app.get('/api/thermometer/:id/stats', requireAuth, ah(async (req, res) => {
    const therm = await pool.query(`SELECT * FROM campaign_thermometers WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!therm.rows.length) return res.status(404).json({ error: 'Thermometer not found' });
    const totalViews = await pool.query(`SELECT COUNT(*) as total, DATE(viewed_at) as view_date FROM thermometer_views WHERE thermometer_id=$1 GROUP BY DATE(viewed_at) ORDER BY view_date DESC LIMIT 30`, [req.params.id]);
    const uniqueIps = await pool.query(`SELECT COUNT(DISTINCT viewer_ip) as unique_viewers FROM thermometer_views WHERE thermometer_id=$1`, [req.params.id]);
    const topReferrers = await pool.query(`SELECT referrer, COUNT(*) as count FROM thermometer_views WHERE thermometer_id=$1 AND referrer != '' GROUP BY referrer ORDER BY count DESC LIMIT 10`, [req.params.id]);
    res.json({
      thermometer: therm.rows[0],
      daily_views: totalViews.rows,
      unique_viewers: parseInt(uniqueIps.rows[0]?.unique_viewers)||0,
      top_referrers: topReferrers.rows,
    });
  }));

  // =============================================
  // FEATURE 5: DONOR SELF-SERVICE PORTAL
  // =============================================
  app.post('/api/donor-portal/session', ah(async (req, res) => {
    const { donor_email } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const session_token = 'dp_' + Date.now() + '_' + Math.random().toString(36).substring(2,15);
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const ip = req.headers['x-forwarded-for'] || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    const r = await pool.query(
      `INSERT INTO donor_portal_sessions (tenant_id, donor_email, session_token, ip_address, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.session.user.tenant_id, esc(donor_email), session_token, esc(ip), esc(ua), expires_at]
    );
    res.json({ session_token, expires_at });
  }));

  app.get('/api/donor-portal/profile', requireAuth, ah(async (req, res) => {
    const email = req.query.email || req.session.user.email;
    const prefs = await pool.query(`SELECT * FROM donor_portal_preferences WHERE tenant_id=$1 AND donor_email=$2`, [req.session.user.tenant_id, email]);
    if (!prefs.rows.length) {
      return res.json({ donor_email: email, display_name: '', bio: '', preferred_communication: 'email', show_donations_publicly: false, email_receipts: true, sms_receipts: false });
    }
    res.json(prefs.rows[0]);
  }));

  app.put('/api/donor-portal/profile', requireAuth, ah(async (req, res) => {
    const { donor_email, display_name, bio, preferred_communication, show_donations_publicly, email_receipts, sms_receipts } = req.body;
    const email = donor_email || req.session.user.email;
    if (!email) return res.status(400).json({ error: 'donor_email is required' });
    const r = await pool.query(
      `INSERT INTO donor_portal_preferences (tenant_id, donor_email, display_name, bio, preferred_communication, show_donations_publicly, email_receipts, sms_receipts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, donor_email) DO UPDATE SET display_name=$3, bio=$4, preferred_communication=$5, show_donations_publicly=$6, email_receipts=$7, sms_receipts=$8 RETURNING *`,
      [req.session.user.tenant_id, esc(email), esc(display_name||''), esc(bio||''), preferred_communication||'email', show_donations_publicly||false, email_receipts!==false, sms_receipts||false]
    );
    await audit(req, 'update', 'donor_portal_preferences', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/donor-portal/donations', requireAuth, ah(async (req, res) => {
    const email = req.query.email || req.session.user.email;
    const r = await pool.query(
      `SELECT * FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 50`,
      [req.session.user.tenant_id, email]
    );
    res.json(r.rows);
  }));

  app.get('/api/donor-portal/receipts', requireAuth, ah(async (req, res) => {
    const email = req.query.email || req.session.user.email;
    const r = await pool.query(
      `SELECT id, donor_email, donor_name, amount, created_at, campaign_id FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 50`,
      [req.session.user.tenant_id, email]
    );
    const receipts = r.rows.map(d => ({
      receipt_id: 'RCP-' + String(d.id).padStart(6, '0'),
      donor_name: d.donor_name,
      amount: d.amount,
      date: d.created_at,
      campaign_id: d.campaign_id,
    }));
    res.json(receipts);
  }));

  app.get('/api/donor-portal/pledges', requireAuth, ah(async (req, res) => {
    const email = req.query.email || req.session.user.email;
    const r = await pool.query(
      `SELECT cp.*, cc.name as campaign_name FROM capital_pledges cp JOIN capital_campaigns cc ON cp.campaign_id=cc.id WHERE cp.tenant_id=$1 AND cp.donor_email=$2 ORDER BY cp.created_at DESC`,
      [req.session.user.tenant_id, email]
    );
    res.json(r.rows);
  }));

  app.put('/api/donor-portal/preferences', requireAuth, ah(async (req, res) => {
    const { donor_email, preferred_communication, show_donations_publicly, email_receipts, sms_receipts } = req.body;
    const email = donor_email || req.session.user.email;
    if (!email) return res.status(400).json({ error: 'donor_email is required' });
    const r = await pool.query(
      `INSERT INTO donor_portal_preferences (tenant_id, donor_email, preferred_communication, show_donations_publicly, email_receipts, sms_receipts) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, donor_email) DO UPDATE SET preferred_communication=$3, show_donations_publicly=$4, email_receipts=$5, sms_receipts=$6 RETURNING *`,
      [req.session.user.tenant_id, esc(email), preferred_communication||'email', show_donations_publicly||false, email_receipts!==false, sms_receipts||false]
    );
    await audit(req, 'update', 'donor_portal_preferences', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // =============================================
  // FEATURE 6: EMAIL CAMPAIGN BUILDER
  // =============================================
  // Templates
  app.get('/api/email-builder/templates', requireAuth, ah(async (req, res) => {
    const { category } = req.query;
    let q = `SELECT * FROM email_templates_builder WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (category) { q += ` AND category=$2`; params.push(category); }
    q += ` ORDER BY created_at DESC`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/email-builder/templates', requireAuth, ah(async (req, res) => {
    const { name, subject, body_html, body_text, category, thumbnail_url, is_default } = req.body;
    if (!name || !subject) return res.status(400).json({ error: 'Template name and subject are required' });
    const r = await pool.query(
      `INSERT INTO email_templates_builder (tenant_id, name, subject, body_html, body_text, category, thumbnail_url, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(subject), esc(body_html||''), esc(body_text||''), esc(category||'general'), esc(thumbnail_url||''), is_default||false]
    );
    await audit(req, 'create', 'email_templates_builder', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/email-builder/templates/:id', requireAuth, ah(async (req, res) => {
    const { name, subject, body_html, body_text, category, thumbnail_url, is_default } = req.body;
    const r = await pool.query(
      `UPDATE email_templates_builder SET name=COALESCE($1,name), subject=COALESCE($2,subject), body_html=COALESCE($3,body_html), body_text=COALESCE($4,body_text), category=COALESCE($5,category), thumbnail_url=COALESCE($6,thumbnail_url), is_default=COALESCE($7,is_default) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [name?esc(name):null, subject?esc(subject):null, body_html?esc(body_html):null, body_text?esc(body_text):null, category?esc(category):null, thumbnail_url?esc(thumbnail_url):null, is_default, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await audit(req, 'update', 'email_templates_builder', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/email-builder/templates/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM email_templates_builder WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await audit(req, 'delete', 'email_templates_builder', req.params.id);
    res.json({ ok: true });
  }));

  // Campaigns
  app.get('/api/email-builder/campaigns', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM email_campaign_builder WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/email-builder/campaigns', requireAuth, ah(async (req, res) => {
    const { template_id, name, subject, body_html, sender_name, sender_email, recipient_segment } = req.body;
    if (!name || !subject) return res.status(400).json({ error: 'Campaign name and subject are required' });
    // Count recipients based on segment
    let recipientCount = 0;
    try {
      const seg = recipient_segment || 'all';
      let countQ;
      if (seg === 'all') {
        countQ = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
      } else if (seg === 'recurring') {
        countQ = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1 AND is_recurring=true`, [req.session.user.tenant_id]);
      } else {
        countQ = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
      }
      recipientCount = parseInt(countQ.rows[0]?.cnt) || 0;
    } catch(e) {}
    const r = await pool.query(
      `INSERT INTO email_campaign_builder (tenant_id, template_id, name, subject, body_html, sender_name, sender_email, recipient_segment, recipient_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.session.user.tenant_id, template_id||null, esc(name), esc(subject), esc(body_html||''), esc(sender_name||''), esc(sender_email||''), esc(recipient_segment||'all'), recipientCount]
    );
    await audit(req, 'create', 'email_campaign_builder', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/email-builder/campaigns/:id', requireAuth, ah(async (req, res) => {
    const { name, subject, body_html, sender_name, sender_email, recipient_segment, status } = req.body;
    const r = await pool.query(
      `UPDATE email_campaign_builder SET name=COALESCE($1,name), subject=COALESCE($2,subject), body_html=COALESCE($3,body_html), sender_name=COALESCE($4,sender_name), sender_email=COALESCE($5,sender_email), recipient_segment=COALESCE($6,recipient_segment), status=COALESCE($7,status) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [name?esc(name):null, subject?esc(subject):null, body_html?esc(body_html):null, sender_name?esc(sender_name):null, sender_email?esc(sender_email):null, recipient_segment?esc(recipient_segment):null, status||null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'email_campaign_builder', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/email-builder/campaigns/:id/preview', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM email_campaign_builder WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const donor = await pool.query(`SELECT donor_email, donor_name FROM donations WHERE tenant_id=$1 LIMIT 1`, [req.session.user.tenant_id]);
    const sampleDonor = donor.rows[0] || { donor_email: 'sample@example.com', donor_name: 'Sample Donor' };
    const previewHtml = (c.body_html || '')
      .replace(/{donor_name}/g, sampleDonor.donor_name)
      .replace(/{donor_email}/g, sampleDonor.donor_email)
      .replace(/{organization}/g, 'Our Organization')
      .replace(/{date}/g, new Date().toLocaleDateString());
    res.json({ subject: c.subject, preview_html: previewHtml, recipient_sample: sampleDonor });
  }));

  app.post('/api/email-builder/campaigns/:id/schedule', requireAuth, ah(async (req, res) => {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
    const r = await pool.query(
      `UPDATE email_campaign_builder SET status='scheduled', scheduled_at=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`,
      [scheduled_at, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'schedule', 'email_campaign_builder', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/email-builder/campaigns/:id/send', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM email_campaign_builder WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    if (c.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });
    // Get recipients
    let donors;
    const seg = c.recipient_segment || 'all';
    if (seg === 'all') {
      donors = await pool.query(`SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != ''`, [req.session.user.tenant_id]);
    } else if (seg === 'recurring') {
      donors = await pool.query(`SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND is_recurring=true AND donor_email IS NOT NULL`, [req.session.user.tenant_id]);
    } else {
      donors = await pool.query(`SELECT DISTINCT donor_email, donor_name FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL`, [req.session.user.tenant_id]);
    }
    let sentCount = 0;
    for (const d of donors.rows.slice(0, 100)) { // Batch limit
      try {
        const body = (c.body_html || c.subject || '')
          .replace(/{donor_name}/g, d.donor_name || 'Donor')
          .replace(/{donor_email}/g, d.donor_email)
          .replace(/{organization}/g, 'Our Organization');
        await sendEmail(d.donor_email, c.subject, body);
        sentCount++;
      } catch(e) { /* best effort */ }
    }
    await pool.query(
      `UPDATE email_campaign_builder SET status='sent', sent_at=NOW(), recipient_count=$1, open_count=0, click_count=0 WHERE id=$2`,
      [sentCount, req.params.id]
    );
    await audit(req, 'send', 'email_campaign_builder', req.params.id);
    res.json({ ok: true, sent: sentCount, total: donors.rows.length });
  }));

  app.get('/api/email-builder/campaigns/:id/stats', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id, name, status, recipient_count, open_count, click_count, sent_at, scheduled_at FROM email_campaign_builder WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    res.json({
      ...c,
      open_rate: c.recipient_count > 0 ? Math.round((c.open_count / c.recipient_count) * 100) : 0,
      click_rate: c.recipient_count > 0 ? Math.round((c.click_count / c.recipient_count) * 100) : 0,
    });
  }));

  // =============================================
  // FEATURE 7: DIRECT MAIL INTEGRATION
  // =============================================
  app.get('/api/direct-mail/campaigns', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/direct-mail/campaigns', requireAuth, ah(async (req, res) => {
    const { name, template_content, recipient_segment, mail_class } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    const r = await pool.query(
      `INSERT INTO direct_mail_campaigns (tenant_id, name, template_content, recipient_segment, mail_class) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(template_content||''), esc(recipient_segment||'all'), mail_class||'standard']
    );
    await audit(req, 'create', 'direct_mail_campaigns', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/direct-mail/campaigns/:id', requireAuth, ah(async (req, res) => {
    const { name, template_content, recipient_segment, mail_class, status } = req.body;
    const r = await pool.query(
      `UPDATE direct_mail_campaigns SET name=COALESCE($1,name), template_content=COALESCE($2,template_content), recipient_segment=COALESCE($3,recipient_segment), mail_class=COALESCE($4,mail_class), status=COALESCE($5,status) WHERE tenant_id=$6 AND id=$7 RETURNING *`,
      [name?esc(name):null, template_content?esc(template_content):null, recipient_segment?esc(recipient_segment):null, mail_class||null, status||null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Direct mail campaign not found' });
    await audit(req, 'update', 'direct_mail_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/direct-mail/campaigns/:id/recipients', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const { recipients } = req.body;
    if (!recipients || !Array.isArray(recipients) || !recipients.length) return res.status(400).json({ error: 'recipients array is required' });
    let added = 0;
    for (const r of recipients) {
      if (!r.donor_name) continue;
      await pool.query(
        `INSERT INTO direct_mail_recipients (tenant_id, campaign_id, donor_name, address_line1, address_line2, city, state, postal_code, country) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.session.user.tenant_id, req.params.id, esc(r.donor_name), esc(r.address_line1||''), esc(r.address_line2||''), esc(r.city||''), esc(r.state||''), esc(r.postal_code||''), esc(r.country||'Uganda')]
      );
      added++;
    }
    await pool.query(`UPDATE direct_mail_campaigns SET total_recipients=total_recipients+$1 WHERE id=$2`, [added, req.params.id]);
    await audit(req, 'add_recipients', 'direct_mail_campaigns', req.params.id);
    res.json({ ok: true, added });
  }));

  app.get('/api/direct-mail/campaigns/:id/recipients', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT id FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const r = await pool.query(`SELECT * FROM direct_mail_recipients WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/direct-mail/campaigns/:id/preview', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const recipients = await pool.query(`SELECT * FROM direct_mail_recipients WHERE tenant_id=$1 AND campaign_id=$2 LIMIT 5`, [req.session.user.tenant_id, req.params.id]);
    const costPerUnit = c.mail_class === 'priority' ? 5000 : c.mail_class === 'first_class' ? 3000 : 1500;
    const previewContent = (c.template_content || 'Dear {donor_name},\n\nThank you for your generous support.\n\nWith gratitude,')
      .replace(/{donor_name}/g, '[Donor Name]')
      .replace(/{organization}/g, 'Our Organization');
    res.json({
      campaign_name: c.name,
      mail_class: c.mail_class,
      total_recipients: c.total_recipients,
      estimated_cost: c.total_recipients * costPerUnit,
      cost_per_unit: costPerUnit,
      template_preview: previewContent,
      sample_recipients: recipients.rows,
    });
  }));

  app.post('/api/direct-mail/campaigns/:id/send', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    if (c.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });
    const costPerUnit = c.mail_class === 'priority' ? 5000 : c.mail_class === 'first_class' ? 3000 : 1500;
    const estimatedCost = c.total_recipients * costPerUnit;
    // Mark all recipients as sent
    await pool.query(`UPDATE direct_mail_recipients SET status='sent', sent_at=NOW() WHERE tenant_id=$1 AND campaign_id=$2 AND status='pending'`, [req.session.user.tenant_id, req.params.id]);
    await pool.query(
      `UPDATE direct_mail_campaigns SET status='sent', sent_at=NOW(), estimated_cost=$1 WHERE id=$2`,
      [estimatedCost, req.params.id]
    );
    await audit(req, 'send', 'direct_mail_campaigns', req.params.id);
    res.json({ ok: true, total_sent: c.total_recipients, estimated_cost: estimatedCost });
  }));

  app.get('/api/direct-mail/campaigns/:id/cost-estimate', requireAuth, ah(async (req, res) => {
    const camp = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const costPerUnit = c.mail_class === 'priority' ? 5000 : c.mail_class === 'first_class' ? 3000 : 1500;
    const total = c.total_recipients * costPerUnit;
    res.json({
      mail_class: c.mail_class,
      cost_per_unit: costPerUnit,
      total_recipients: c.total_recipients,
      total_estimated_cost: total,
      currency: 'UGX',
    });
  }));

  // =============================================
  // FEATURE 8: DONOR HEATMAPS / GEOGRAPHIC ANALYSIS
  // =============================================
  app.get('/api/donor-heatmap', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_heatmap_data WHERE tenant_id=$1 ORDER BY total_donated DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/donor-heatmap/refresh', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Aggregate from donations table if it exists
    try {
      const donors = await pool.query(
        `SELECT donor_email, donor_name, SUM(amount) as total_donated, COUNT(*) as donation_count, MAX(created_at) as last_donation FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND donor_email != '' GROUP BY donor_email, donor_name`,
        [tid]
      );
      // Clear existing heatmap data
      await pool.query(`DELETE FROM donor_heatmap_data WHERE tenant_id=$1`, [tid]);
      // Re-insert with geo data (approximate based on known regions or defaults)
      for (const d of donors.rows) {
        // Attempt to look up existing geo data from donor records
        const existing = await pool.query(`SELECT latitude, longitude, city, region, country FROM donor_heatmap_data WHERE tenant_id=$1 AND donor_email=$2`, [tid, d.donor_email]);
        const lat = existing.rows[0]?.latitude || (0.3476 + (Math.random() - 0.5) * 2); // Approximate Uganda region
        const lng = existing.rows[0]?.longitude || (32.5825 + (Math.random() - 0.5) * 2);
        const city = existing.rows[0]?.city || 'Kampala';
        const region = existing.rows[0]?.region || 'Central';
        const country = existing.rows[0]?.country || 'Uganda';
        await pool.query(
          `INSERT INTO donor_heatmap_data (tenant_id, donor_email, donor_name, latitude, longitude, city, region, country, total_donated, donation_count, last_donation_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [tid, esc(d.donor_email), esc(d.donor_name||''), lat, lng, esc(city), esc(region), esc(country), parseInt(d.total_donated)||0, parseInt(d.donation_count)||0, d.last_donation]
        );
      }
      // Refresh regional stats
      await pool.query(`DELETE FROM regional_donation_stats WHERE tenant_id=$1`, [tid]);
      const regions = await pool.query(
        `SELECT region, country, SUM(total_donated) as total_donated, COUNT(*) as donor_count, AVG(total_donated)::integer as avg_donation FROM donor_heatmap_data WHERE tenant_id=$1 GROUP BY region, country`,
        [tid]
      );
      for (const reg of regions.rows) {
        await pool.query(
          `INSERT INTO regional_donation_stats (tenant_id, region, country, total_donated, donor_count, avg_donation, top_category) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, esc(reg.region), esc(reg.country), parseInt(reg.total_donated)||0, parseInt(reg.donor_count)||0, parseInt(reg.avg_donation)||0, 'general']
        );
      }
      await audit(req, 'refresh', 'donor_heatmap_data', 0);
      res.json({ ok: true, donors_processed: donors.rows.length, regions_updated: regions.rows.length });
    } catch(e) {
      res.json({ ok: true, donors_processed: 0, regions_updated: 0, note: 'No donations data available yet' });
    }
  }));

  app.get('/api/donor-heatmap/regions', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/donor-heatmap/top-regions', requireAuth, ah(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const r = await pool.query(
      `SELECT region, country, total_donated, donor_count, avg_donation FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC LIMIT $2`,
      [req.session.user.tenant_id, limit]
    );
    res.json(r.rows);
  }));

  app.get('/api/donor-heatmap/country/:country', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT * FROM donor_heatmap_data WHERE tenant_id=$1 AND country=$2 ORDER BY total_donated DESC`,
      [req.session.user.tenant_id, req.params.country]
    );
    const stats = await pool.query(
      `SELECT SUM(total_donated) as total, COUNT(*) as donor_count, AVG(total_donated)::integer as avg_donation, MAX(total_donated) as max_donation FROM donor_heatmap_data WHERE tenant_id=$1 AND country=$2`,
      [req.session.user.tenant_id, req.params.country]
    );
    const regions = await pool.query(
      `SELECT region, SUM(total_donated) as total, COUNT(*) as donor_count FROM donor_heatmap_data WHERE tenant_id=$1 AND country=$2 GROUP BY region ORDER BY total DESC`,
      [req.session.user.tenant_id, req.params.country]
    );
    res.json({
      country: req.params.country,
      donors: r.rows,
      summary: stats.rows[0] || { total: 0, donor_count: 0, avg_donation: 0, max_donation: 0 },
      regions: regions.rows,
    });
  }));

  // =============================================
  // UI PAGES
  // =============================================
  const navLinks = `
    <nav class="flex flex-wrap gap-2 mb-6">
      <a href="/capital-campaigns" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">Capital Campaigns</a>
      <a href="/tribute" class="px-3 py-1 bg-rose-100 text-rose-800 rounded hover:bg-rose-200">Tribute/Memorial</a>
      <a href="/crowdfunding-perks" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Crowdfunding Perks</a>
      <a href="/thermometer" class="px-3 py-1 bg-sky-100 text-sky-800 rounded hover:bg-sky-200">Thermometer</a>
      <a href="/donor-portal" class="px-3 py-1 bg-violet-100 text-violet-800 rounded hover:bg-violet-200">Donor Portal</a>
      <a href="/email-builder" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Email Builder</a>
      <a href="/direct-mail" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">Direct Mail</a>
      <a href="/donor-heatmap" class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200">Heatmap</a>
    </nav>`;

  // Feature 1: Capital Campaigns Dashboard
  app.get('/capital-campaigns', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query(`SELECT * FROM capital_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(
      `SELECT COUNT(*) as total_campaigns, SUM(total_goal) as total_goals, SUM(current_total) as total_raised, COUNT(CASE WHEN status='active' THEN 1 END) as active FROM capital_campaigns WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    const s = stats.rows[0];
    renderPage(req, res, 'Capital Campaigns', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Capital Campaigns</h2>
          <button onclick="document.getElementById('newCampForm').classList.toggle('hidden')" class="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">New Campaign</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Campaigns</div><div class="text-2xl font-bold">${parseInt(s.total_campaigns)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Goals</div><div class="text-2xl font-bold">UGX ${((parseInt(s.total_goals)||0)/1000).toFixed(0)}K</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Raised</div><div class="text-2xl font-bold">UGX ${((parseInt(s.total_raised)||0)/1000).toFixed(0)}K</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Active</div><div class="text-2xl font-bold">${parseInt(s.active)||0}</div></div>
        </div>
        <div id="newCampForm" class="hidden bg-white p-4 rounded-lg shadow mb-6">
          <h3 class="font-semibold mb-3">Create New Campaign</h3>
          <form method="POST" action="/api/capital-campaigns" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input name="name" placeholder="Campaign Name" class="border p-2 rounded" required>
            <input name="total_goal" type="number" placeholder="Total Goal (UGX)" class="border p-2 rounded" required>
            <input name="quiet_phase_goal" type="number" placeholder="Quiet Phase Goal" class="border p-2 rounded">
            <input name="quiet_phase_start" type="date" class="border p-2 rounded">
            <input name="public_phase_start" type="date" class="border p-2 rounded">
            <input name="end_date" type="date" class="border p-2 rounded">
            <textarea name="description" placeholder="Description" class="border p-2 rounded md:col-span-2"></textarea>
            <button type="submit" class="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">Create Campaign</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Name</th><th class="p-3 text-left">Goal</th><th class="p-3 text-left">Raised</th><th class="p-3 text-left">Progress</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">End Date</th></tr></thead>
            <tbody>${campaigns.rows.map(c => {
              const pct = c.total_goal > 0 ? Math.round((c.current_total / c.total_goal) * 100) : 0;
              return `<tr class="border-t">
                <td class="p-3 font-medium">${c.name}</td>
                <td class="p-3">UGX ${(c.total_goal||0).toLocaleString()}</td>
                <td class="p-3">UGX ${(c.current_total||0).toLocaleString()}</td>
                <td class="p-3"><div class="w-full bg-gray-200 rounded-full h-2"><div class="bg-emerald-500 h-2 rounded-full" style="width:${Math.min(pct,100)}%"></div></div><span class="text-xs">${pct}%</span></td>
                <td class="p-3"><span class="px-2 py-1 rounded text-xs ${c.status==='active'?'bg-green-100 text-green-800':c.status==='completed'?'bg-blue-100 text-blue-800':'bg-gray-100 text-gray-800'}">${c.status}</span></td>
                <td class="p-3">${c.end_date||'-'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Feature 2: Tribute / Memorial Donations Dashboard
  app.get('/tribute', requireAuth, ah(async (req, res) => {
    const tributes = await pool.query(`SELECT * FROM tribute_donations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    const memorials = await pool.query(`SELECT * FROM memorial_pages WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const honorCount = await pool.query(`SELECT COUNT(*) as cnt FROM tribute_donations WHERE tenant_id=$1 AND tribute_type='in_honor'`, [req.session.user.tenant_id]);
    const memoryCount = await pool.query(`SELECT COUNT(*) as cnt FROM tribute_donations WHERE tenant_id=$1 AND tribute_type='in_memory'`, [req.session.user.tenant_id]);
    const totalAmount = await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM tribute_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Tribute & Memorial', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Tribute & Memorial Donations</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">In Honor</div><div class="text-2xl font-bold">${parseInt(honorCount.rows[0]?.cnt)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">In Memory</div><div class="text-2xl font-bold">${parseInt(memoryCount.rows[0]?.cnt)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Donated</div><div class="text-2xl font-bold">UGX ${((parseInt(totalAmount.rows[0]?.total)||0)/1000).toFixed(0)}K</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Memorial Pages</div><div class="text-2xl font-bold">${memorials.rows.length}</div></div>
        </div>
        <h3 class="text-lg font-semibold mb-3">Tribute Donations</h3>
        <div class="bg-white rounded-lg shadow overflow-x-auto mb-6">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Type</th><th class="p-3 text-left">Honoree</th><th class="p-3 text-left">Amount</th><th class="p-3 text-left">Family Notified</th><th class="p-3 text-left">Date</th></tr></thead>
            <tbody>${tributes.rows.map(t => `<tr class="border-t">
              <td class="p-3">${t.donor_name}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs ${t.tribute_type==='in_honor'?'bg-yellow-100 text-yellow-800':'bg-purple-100 text-purple-800'}">${t.tribute_type==='in_honor'?'In Honor':'In Memory'}</span></td>
              <td class="p-3">${t.honoree_name}</td>
              <td class="p-3">UGX ${(t.amount||0).toLocaleString()}</td>
              <td class="p-3">${t.family_notified?'<span class="text-green-600">Yes</span>':'<span class="text-gray-400">No</span>'}</td>
              <td class="p-3">${new Date(t.created_at).toLocaleDateString()}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <h3 class="text-lg font-semibold mb-3">Memorial Pages</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${memorials.rows.map(m => `<div class="bg-white p-4 rounded-lg shadow">
            <h4 class="font-semibold">${m.honoree_name}</h4>
            ${m.biography ? '<p class="text-sm text-gray-600 mt-1">'+m.biography.substring(0,100)+'...</p>' : ''}
            <div class="mt-2 text-sm text-gray-500">Raised: UGX ${(m.total_raised||0).toLocaleString()}</div>
            <div class="mt-1 text-xs">${m.is_active?'<span class="text-green-600">Active</span>':'<span class="text-gray-400">Inactive</span>'}</div>
          </div>`).join('')}
        </div>
      </div>`);
  }));

  // Feature 3: Crowdfunding Perks Dashboard
  app.get('/crowdfunding-perks', requireAuth, ah(async (req, res) => {
    const perks = await pool.query(`SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 ORDER BY min_amount`, [req.session.user.tenant_id]);
    const claimStats = await pool.query(
      `SELECT cp.id as perk_id, COUNT(pc.id) as total_claims, COUNT(CASE WHEN pc.fulfilled THEN 1 END) as fulfilled FROM crowdfunding_perks cp LEFT JOIN perk_claims pc ON pc.perk_id=cp.id WHERE cp.tenant_id=$1 GROUP BY cp.id`,
      [req.session.user.tenant_id]
    );
    const claimMap = {};
    claimStats.rows.forEach(c => { claimMap[c.perk_id] = c; });
    renderPage(req, res, 'Crowdfunding Perks', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Crowdfunding Perks & Rewards</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${perks.rows.map(p => {
            const claims = claimMap[p.id] || { total_claims: 0, fulfilled: 0 };
            const remaining = p.quantity_available > 0 ? p.quantity_available - p.quantity_claimed : null;
            return `<div class="bg-white p-4 rounded-lg shadow">
              <h3 class="font-semibold text-lg">${p.perk_name}</h3>
              <p class="text-sm text-gray-600 mt-1">${p.description||''}</p>
              <div class="mt-3 space-y-1 text-sm">
                <div>Min Amount: <strong>UGX ${(p.min_amount||0).toLocaleString()}</strong></div>
                <div>Claimed: <strong>${p.quantity_claimed}</strong> ${p.quantity_available > 0 ? 'of '+p.quantity_available : '(unlimited)'}</div>
                <div>Claims: <strong>${parseInt(claims.total_claims)||0}</strong> | Fulfilled: <strong>${parseInt(claims.fulfilled)||0}</strong></div>
                ${p.estimated_delivery ? '<div>Est. Delivery: '+new Date(p.estimated_delivery).toLocaleDateString()+'</div>' : ''}
              </div>
              <div class="mt-2"><span class="px-2 py-1 rounded text-xs ${p.is_active?'bg-green-100 text-green-800':'bg-gray-100 text-gray-800'}">${p.is_active?'Active':'Inactive'}</span></div>
            </div>`;
          }).join('')}
          ${perks.rows.length === 0 ? '<div class="col-span-3 text-center text-gray-500 py-8">No perks created yet. Add perks to your campaigns via the API.</div>' : ''}
        </div>
      </div>`);
  }));

  // Feature 4: Campaign Thermometer Dashboard
  app.get('/thermometer', requireAuth, ah(async (req, res) => {
    const thermometers = await pool.query(
      `SELECT ct.*, cc.name as campaign_name, cc.total_goal, cc.current_total FROM campaign_thermometers ct LEFT JOIN capital_campaigns cc ON ct.campaign_id=cc.id WHERE ct.tenant_id=$1 ORDER BY ct.created_at DESC`,
      [req.session.user.tenant_id]
    );
    const viewStats = await pool.query(
      `SELECT thermometer_id, COUNT(*) as views FROM thermometer_views WHERE tenant_id=$1 GROUP BY thermometer_id`,
      [req.session.user.tenant_id]
    );
    const viewMap = {};
    viewStats.rows.forEach(v => { viewMap[v.thermometer_id] = parseInt(v.views); });
    renderPage(req, res, 'Campaign Thermometers', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Campaign Thermometers & Widgets</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${thermometers.rows.map(t => {
            const pct = t.total_goal > 0 ? Math.round(((t.current_total||0) / t.total_goal) * 100) : 0;
            return `<div class="bg-white p-4 rounded-lg shadow">
              <h3 class="font-semibold">${t.campaign_name || 'Campaign #'+t.campaign_id}</h3>
              <div class="mt-3">
                <div class="flex justify-between text-sm mb-1"><span>Progress</span><span>${pct}%</span></div>
                <div class="w-full bg-gray-200 rounded-full h-4">
                  <div class="h-4 rounded-full" style="width:${Math.min(pct,100)}%;background-color:${t.color_scheme||'#059669'}"></div>
                </div>
                <div class="text-sm mt-1">UGX ${(t.current_total||0).toLocaleString()} of UGX ${(t.total_goal||0).toLocaleString()}</div>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>Type: ${t.widget_type}</div>
                <div>Views: ${viewMap[t.id]||0}</div>
                <div>Show %: ${t.show_percentage?'Yes':'No'}</div>
                <div>Show Donors: ${t.show_donor_count?'Yes':'No'}</div>
              </div>
              <div class="mt-3 text-xs text-gray-500">Embed: <code>${BASE_URL}/api/thermometer/${t.embed_token}/embed</code></div>
            </div>`;
          }).join('')}
          ${thermometers.rows.length === 0 ? '<div class="col-span-2 text-center text-gray-500 py-8">No thermometers created yet. Create one for your campaign via the API.</div>' : ''}
        </div>
      </div>`);
  }));

  // Feature 5: Donor Self-Service Portal Dashboard
  app.get('/donor-portal', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const prefs = await pool.query(`SELECT * FROM donor_portal_preferences WHERE tenant_id=$1 AND donor_email=$2`, [req.session.user.tenant_id, email]);
    const donations = await pool.query(`SELECT * FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT 10`, [req.session.user.tenant_id, email]);
    const pledges = await pool.query(`SELECT cp.*, cc.name as campaign_name FROM capital_pledges cp JOIN capital_campaigns cc ON cp.campaign_id=cc.id WHERE cp.tenant_id=$1 AND cp.donor_email=$2 ORDER BY cp.created_at DESC LIMIT 10`, [req.session.user.tenant_id, email]);
    const totalDonated = await pool.query(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM donations WHERE tenant_id=$1 AND donor_email=$2`, [req.session.user.tenant_id, email]);
    const p = prefs.rows[0] || {};
    const td = totalDonated.rows[0] || { total: 0, cnt: 0 };
    renderPage(req, res, 'Donor Portal', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">My Donor Portal</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Donated</div><div class="text-2xl font-bold">UGX ${((parseInt(td.total)||0)/1000).toFixed(0)}K</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Donations</div><div class="text-2xl font-bold">${parseInt(td.cnt)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Active Pledges</div><div class="text-2xl font-bold">${pledges.rows.length}</div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white p-4 rounded-lg shadow">
            <h3 class="font-semibold mb-3">My Profile</h3>
            <div class="space-y-2 text-sm">
              <div><strong>Display Name:</strong> ${p.display_name||'Not set'}</div>
              <div><strong>Email:</strong> ${email}</div>
              <div><strong>Communication:</strong> ${p.preferred_communication||'email'}</div>
              <div><strong>Public Donations:</strong> ${p.show_donations_publicly?'Yes':'No'}</div>
              <div><strong>Email Receipts:</strong> ${p.email_receipts!==false?'Yes':'No'}</div>
              <div><strong>SMS Receipts:</strong> ${p.sms_receipts?'Yes':'No'}</div>
            </div>
          </div>
          <div class="bg-white p-4 rounded-lg shadow">
            <h3 class="font-semibold mb-3">Recent Donations</h3>
            <div class="max-h-64 overflow-y-auto">
              <table class="w-full text-sm">
                <thead><tr><th class="text-left">Amount</th><th class="text-left">Date</th></tr></thead>
                <tbody>${donations.rows.map(d => `<tr class="border-t"><td class="py-1">UGX ${(d.amount||0).toLocaleString()}</td><td class="py-1">${new Date(d.created_at).toLocaleDateString()}</td></tr>`).join('')}
                ${donations.rows.length === 0 ? '<tr><td colspan="2" class="py-4 text-gray-500">No donations yet</td></tr>' : ''}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        ${pledges.rows.length > 0 ? `
        <div class="bg-white p-4 rounded-lg shadow mt-6">
          <h3 class="font-semibold mb-3">My Pledges</h3>
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Campaign</th><th class="p-3 text-left">Pledged</th><th class="p-3 text-left">Paid</th><th class="p-3 text-left">Status</th></tr></thead>
            <tbody>${pledges.rows.map(pl => `<tr class="border-t">
              <td class="p-3">${pl.campaign_name}</td>
              <td class="p-3">UGX ${(pl.amount_pledged||0).toLocaleString()}</td>
              <td class="p-3">UGX ${(pl.amount_paid||0).toLocaleString()}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs ${pl.status==='completed'?'bg-green-100 text-green-800':'bg-yellow-100 text-yellow-800'}">${pl.status}</span></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}
      </div>`);
  }));

  // Feature 6: Email Campaign Builder Dashboard
  app.get('/email-builder', requireAuth, ah(async (req, res) => {
    const templates = await pool.query(`SELECT * FROM email_templates_builder WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const campaigns = await pool.query(`SELECT * FROM email_campaign_builder WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    const stats = await pool.query(
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='sent' THEN 1 END) as sent, COUNT(CASE WHEN status='draft' THEN 1 END) as drafts, SUM(recipient_count) as total_recipients FROM email_campaign_builder WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    const s = stats.rows[0];
    renderPage(req, res, 'Email Campaign Builder', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Email Campaign Builder</h2>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Templates</div><div class="text-2xl font-bold">${templates.rows.length}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Campaigns</div><div class="text-2xl font-bold">${parseInt(s.total)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Sent</div><div class="text-2xl font-bold">${parseInt(s.sent)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Drafts</div><div class="text-2xl font-bold">${parseInt(s.drafts)||0}</div></div>
        </div>
        <h3 class="text-lg font-semibold mb-3">Email Templates</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          ${templates.rows.map(t => `<div class="bg-white p-4 rounded-lg shadow">
            <h4 class="font-semibold">${t.name}</h4>
            <p class="text-sm text-gray-500 mt-1">${t.subject}</p>
            <div class="mt-2 flex gap-2">
              <span class="px-2 py-1 rounded text-xs bg-gray-100">${t.category||'general'}</span>
              ${t.is_default?'<span class="px-2 py-1 rounded text-xs bg-emerald-100 text-emerald-800">Default</span>':''}
            </div>
          </div>`).join('')}
        </div>
        <h3 class="text-lg font-semibold mb-3">Email Campaigns</h3>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Name</th><th class="p-3 text-left">Subject</th><th class="p-3 text-left">Segment</th><th class="p-3 text-left">Recipients</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Sent At</th></tr></thead>
            <tbody>${campaigns.rows.map(c => `<tr class="border-t">
              <td class="p-3 font-medium">${c.name}</td>
              <td class="p-3">${c.subject}</td>
              <td class="p-3">${c.recipient_segment}</td>
              <td class="p-3">${c.recipient_count||0}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs ${c.status==='sent'?'bg-green-100 text-green-800':c.status==='scheduled'?'bg-blue-100 text-blue-800':c.status==='draft'?'bg-gray-100 text-gray-800':'bg-red-100 text-red-800'}">${c.status}</span></td>
              <td class="p-3">${c.sent_at?new Date(c.sent_at).toLocaleDateString():'-'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Feature 7: Direct Mail Dashboard
  app.get('/direct-mail', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query(`SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(
      `SELECT COUNT(*) as total, SUM(total_recipients) as total_recipients, SUM(estimated_cost) as total_cost FROM direct_mail_campaigns WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    const s = stats.rows[0];
    renderPage(req, res, 'Direct Mail', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Direct Mail Integration</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Campaigns</div><div class="text-2xl font-bold">${parseInt(s.total)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Recipients</div><div class="text-2xl font-bold">${parseInt(s.total_recipients)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Cost</div><div class="text-2xl font-bold">UGX ${((parseInt(s.total_cost)||0)/1000).toFixed(0)}K</div></div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Name</th><th class="p-3 text-left">Mail Class</th><th class="p-3 text-left">Recipients</th><th class="p-3 text-left">Est. Cost</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Segment</th></tr></thead>
            <tbody>${campaigns.rows.map(c => `<tr class="border-t">
              <td class="p-3 font-medium">${c.name}</td>
              <td class="p-3">${c.mail_class}</td>
              <td class="p-3">${c.total_recipients||0}</td>
              <td class="p-3">UGX ${(c.estimated_cost||0).toLocaleString()}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs ${c.status==='sent'?'bg-green-100 text-green-800':c.status==='draft'?'bg-gray-100 text-gray-800':'bg-blue-100 text-blue-800'}">${c.status}</span></td>
              <td class="p-3">${c.recipient_segment||'all'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Feature 8: Donor Heatmap Dashboard
  app.get('/donor-heatmap', requireAuth, ah(async (req, res) => {
    const heatmapData = await pool.query(`SELECT * FROM donor_heatmap_data WHERE tenant_id=$1 ORDER BY total_donated DESC LIMIT 50`, [req.session.user.tenant_id]);
    const regions = await pool.query(`SELECT * FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC`, [req.session.user.tenant_id]);
    const totalDonated = await pool.query(`SELECT COALESCE(SUM(total_donated),0) as total, COUNT(*) as donor_count FROM donor_heatmap_data WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const topCountries = await pool.query(
      `SELECT country, SUM(total_donated) as total, COUNT(*) as donors FROM donor_heatmap_data WHERE tenant_id=$1 GROUP BY country ORDER BY total DESC LIMIT 10`,
      [req.session.user.tenant_id]
    );
    const td = totalDonated.rows[0] || { total: 0, donor_count: 0 };
    renderPage(req, res, 'Donor Heatmap', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Donor Heatmap & Geographic Analysis</h2>
          <button onclick="fetch('/api/donor-heatmap/refresh',{method:'POST'}).then(()=>location.reload())" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Refresh Data</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Mapped Donors</div><div class="text-2xl font-bold">${parseInt(td.donor_count)||0}</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Total Donated</div><div class="text-2xl font-bold">UGX ${((parseInt(td.total)||0)/1000).toFixed(0)}K</div></div>
          <div class="bg-white p-4 rounded-lg shadow"><div class="text-sm text-gray-500">Regions</div><div class="text-2xl font-bold">${regions.rows.length}</div></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 class="text-lg font-semibold mb-3">Top Countries</h3>
            <div class="bg-white rounded-lg shadow p-4">
              ${topCountries.rows.map(c => `<div class="flex justify-between py-2 border-b"><span>${c.country}</span><span>UGX ${(parseInt(c.total)||0).toLocaleString()} (${c.donors} donors)</span></div>`).join('')}
              ${topCountries.rows.length === 0 ? '<div class="text-gray-500 text-center py-4">No geographic data yet. Click Refresh Data.</div>' : ''}
            </div>
          </div>
          <div>
            <h3 class="text-lg font-semibold mb-3">Regional Stats</h3>
            <div class="bg-white rounded-lg shadow overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50"><tr><th class="p-2 text-left">Region</th><th class="p-2 text-left">Country</th><th class="p-2 text-left">Donors</th><th class="p-2 text-left">Total</th><th class="p-2 text-left">Avg</th></tr></thead>
                <tbody>${regions.rows.map(r => `<tr class="border-t">
                  <td class="p-2">${r.region}</td>
                  <td class="p-2">${r.country}</td>
                  <td class="p-2">${r.donor_count}</td>
                  <td class="p-2">UGX ${(r.total_donated||0).toLocaleString()}</td>
                  <td class="p-2">UGX ${(r.avg_donation||0).toLocaleString()}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </div>
        <h3 class="text-lg font-semibold mb-3 mt-6">Donor Locations</h3>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">City</th><th class="p-3 text-left">Region</th><th class="p-3 text-left">Country</th><th class="p-3 text-left">Total Donated</th><th class="p-3 text-left">Donations</th></tr></thead>
            <tbody>${heatmapData.rows.map(d => `<tr class="border-t">
              <td class="p-3">${d.donor_name||d.donor_email}</td>
              <td class="p-3">${d.city||'-'}</td>
              <td class="p-3">${d.region||'-'}</td>
              <td class="p-3">${d.country||'-'}</td>
              <td class="p-3">UGX ${(d.total_donated||0).toLocaleString()}</td>
              <td class="p-3">${d.donation_count||0}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

};
