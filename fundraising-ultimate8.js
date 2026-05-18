/**
 * Fundraising Ultimate8 — Capital Campaigns & Donor Engagement
 * 8 Features: Capital Campaigns, Tribute/Memorial, Crowdfunding Perks,
 * Thermometer Widgets, Donor Portal, Email Builder, Direct Mail, Donor Heatmaps
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS capital_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, total_goal NUMERIC DEFAULT 0, quiet_phase_goal NUMERIC DEFAULT 0, public_phase_start DATE, end_date DATE, current_total NUMERIC DEFAULT 0, status TEXT DEFAULT 'planning', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS capital_phases (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES capital_campaigns(id) ON DELETE CASCADE, phase_name TEXT NOT NULL, goal_amount NUMERIC DEFAULT 0, start_date DATE, end_date DATE, status TEXT DEFAULT 'upcoming', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS capital_pledges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES capital_campaigns(id), phase_id INTEGER REFERENCES capital_phases(id), donor_name TEXT, donor_email TEXT, amount_pledged NUMERIC DEFAULT 0, amount_paid NUMERIC DEFAULT 0, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_capital_campaigns_tenant ON capital_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_capital_phases_tenant ON capital_phases(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_capital_pledges_tenant ON capital_pledges(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS tribute_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT, donor_email TEXT, tribute_type TEXT DEFAULT 'honor' CHECK(tribute_type IN ('honor','memory','celebration')), honoree_name TEXT, honoree_email TEXT, family_contact_name TEXT, family_contact_email TEXT, family_notified BOOLEAN DEFAULT false, message TEXT, amount NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS memorial_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, honoree_name TEXT NOT NULL, biography TEXT, page_url TEXT, total_raised NUMERIC DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_tribute_donations_tenant ON tribute_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_memorial_pages_tenant ON memorial_pages(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS crowdfunding_perks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, perk_name TEXT NOT NULL, description TEXT, min_amount NUMERIC DEFAULT 0, quantity_available INTEGER, quantity_claimed INTEGER DEFAULT 0, estimated_delivery DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS perk_claims (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, perk_id INTEGER REFERENCES crowdfunding_perks(id), donor_name TEXT, donor_email TEXT, shipping_address TEXT, fulfilled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_crowdfunding_perks_tenant ON crowdfunding_perks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_perk_claims_tenant ON perk_claims(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS campaign_thermometers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, widget_type TEXT DEFAULT 'thermometer', style TEXT DEFAULT 'classic', color_scheme TEXT DEFAULT '#10b981', show_donor_count BOOLEAN DEFAULT true, embed_token TEXT NOT NULL, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS thermometer_views (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, thermometer_id INTEGER REFERENCES campaign_thermometers(id), viewer_ip TEXT, referrer TEXT, viewed_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_thermometers_tenant ON campaign_thermometers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_thermometer_views_tenant ON thermometer_views(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS donor_portal_preferences (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, display_name TEXT, bio TEXT, preferred_communication TEXT DEFAULT 'email', show_donations_publicly BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_portal_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, session_token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_portal_prefs_tenant ON donor_portal_preferences(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_portal_sessions_tenant ON donor_portal_sessions(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS email_templates_builder (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, subject TEXT, body_html TEXT, category TEXT DEFAULT 'general', is_default BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS email_campaign_builder (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, template_id INTEGER REFERENCES email_templates_builder(id), name TEXT NOT NULL, subject TEXT, body_html TEXT, sender_name TEXT, sender_email TEXT, recipient_segment TEXT DEFAULT 'all', status TEXT DEFAULT 'draft', scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, recipient_count INTEGER DEFAULT 0, open_count INTEGER DEFAULT 0, click_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_email_templates_builder_tenant ON email_templates_builder(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_email_campaign_builder_tenant ON email_campaign_builder(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS direct_mail_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, template_content TEXT, recipient_segment TEXT DEFAULT 'all', mail_class TEXT DEFAULT 'standard', total_recipients INTEGER DEFAULT 0, estimated_cost NUMERIC DEFAULT 0, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS direct_mail_recipients (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER REFERENCES direct_mail_campaigns(id), donor_name TEXT, address_line1 TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_direct_mail_campaigns_tenant ON direct_mail_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_direct_mail_recipients_tenant ON direct_mail_recipients(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS donor_heatmap_data (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT, donor_name TEXT, latitude NUMERIC, longitude NUMERIC, city TEXT, region TEXT, country TEXT, total_donated NUMERIC DEFAULT 0, donation_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS regional_donation_stats (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, region TEXT, country TEXT, total_donated NUMERIC DEFAULT 0, donor_count INTEGER DEFAULT 0, avg_donation NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donor_heatmap_data_tenant ON donor_heatmap_data(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_regional_donation_stats_tenant ON regional_donation_stats(tenant_id)`,
  ];
  (async () => { for (const q of migrations) { try { await pool.query(q); } catch(e){} } console.log('[FundraisingUltimate8] Migrations complete'); })();

  // ================================================================
  // FEATURE 1: CAPITAL CAMPAIGNS
  // ================================================================
  app.get('/api/capital-campaigns', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM capital_campaigns WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (status) { q += ' AND status=$2'; params.push(esc(status)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/capital-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM capital_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/capital-campaigns', requireAuth, ah(async (req, res) => {
    const { name, description, total_goal, quiet_phase_goal, public_phase_start, end_date, status } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO capital_campaigns (tenant_id,name,description,total_goal,quiet_phase_goal,public_phase_start,end_date,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, esc(name), esc(description||''), total_goal||0, quiet_phase_goal||0, public_phase_start||null, end_date||null, status||'planning']);
    await audit(req.session.user.email, 'create', 'capital_campaigns id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/capital-campaigns/:id', requireAuth, ah(async (req, res) => {
    const { name, description, total_goal, quiet_phase_goal, public_phase_start, end_date, status } = req.body;
    const r = await pool.query('UPDATE capital_campaigns SET name=COALESCE($1,name), description=COALESCE($2,description), total_goal=COALESCE($3,total_goal), quiet_phase_goal=COALESCE($4,quiet_phase_goal), public_phase_start=COALESCE($5,public_phase_start), end_date=COALESCE($6,end_date), status=COALESCE($7,status) WHERE tenant_id=$8 AND id=$9 RETURNING *', [name?esc(name):null, description?esc(description):null, total_goal||null, quiet_phase_goal||null, public_phase_start||null, end_date||null, status||null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req.session.user.email, 'update', 'capital_campaigns id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/capital-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM capital_campaigns WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req.session.user.email, 'delete', 'capital_campaigns id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/capital-campaigns/:id/progress', requireAuth, ah(async (req, res) => {
    const camp = await pool.query('SELECT * FROM capital_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const c = camp.rows[0];
    const phases = await pool.query('SELECT * FROM capital_phases WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY start_date', [req.session.user.tenant_id, req.params.id]);
    const pledges = await pool.query('SELECT COALESCE(SUM(amount_pledged),0) as total_pledged, COALESCE(SUM(amount_paid),0) as total_paid, COUNT(*) as pledge_count, COUNT(CASE WHEN status=$3 THEN 1 END) as active_pledges FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2', [req.session.user.tenant_id, req.params.id, 'active']);
    const topDonors = await pool.query('SELECT donor_name, amount_pledged, amount_paid FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY amount_pledged DESC LIMIT 10', [req.session.user.tenant_id, req.params.id]);
    const progressPct = c.total_goal > 0 ? ((parseFloat(c.current_total) / parseFloat(c.total_goal)) * 100).toFixed(1) : 0;
    const quietPct = c.quiet_phase_goal > 0 ? ((parseFloat(c.current_total) / parseFloat(c.quiet_phase_goal)) * 100).toFixed(1) : 0;
    res.json({ campaign: c, phases: phases.rows, pledge_summary: pledges.rows[0], top_donors: topDonors.rows, progress_pct: progressPct, quiet_phase_pct: quietPct });
  }));
  // Capital Phases CRUD
  app.get('/api/capital-campaigns/:id/phases', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM capital_phases WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY start_date', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));
  app.post('/api/capital-campaigns/:id/phases', requireAuth, ah(async (req, res) => {
    const { phase_name, goal_amount, start_date, end_date, status } = req.body;
    if (!phase_name) return res.status(400).json({ error: 'phase_name required' });
    const r = await pool.query('INSERT INTO capital_phases (tenant_id,campaign_id,phase_name,goal_amount,start_date,end_date,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(phase_name), goal_amount||0, start_date||null, end_date||null, status||'upcoming']);
    await audit(req.session.user.email, 'create', 'capital_phases id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/capital-phases/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE capital_phases SET phase_name=COALESCE($1,phase_name), goal_amount=COALESCE($2,goal_amount), status=COALESCE($3,status) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.phase_name?esc(req.body.phase_name):null, req.body.goal_amount||null, req.body.status||null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Phase not found' });
    await audit(req.session.user.email, 'update', 'capital_phases id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/capital-phases/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM capital_phases WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'capital_phases id=' + req.params.id); res.json({ ok: true });
  }));
  // Capital Pledges CRUD
  app.get('/api/capital-campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM capital_pledges WHERE tenant_id=$1 AND campaign_id=$2';
    const params = [req.session.user.tenant_id, req.params.id];
    if (status) { q += ' AND status=$3'; params.push(esc(status)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.post('/api/capital-campaigns/:id/pledges', requireAuth, ah(async (req, res) => {
    const { phase_id, donor_name, donor_email, amount_pledged, amount_paid } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name required' });
    const r = await pool.query('INSERT INTO capital_pledges (tenant_id,campaign_id,phase_id,donor_name,donor_email,amount_pledged,amount_paid) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, req.params.id, phase_id||null, esc(donor_name), esc(donor_email||''), amount_pledged||0, amount_paid||0]);
    await pool.query('UPDATE capital_campaigns SET current_total=current_total+$1 WHERE id=$2 AND tenant_id=$3', [amount_paid||0, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'create', 'capital_pledges id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/capital-pledges/:id/pay', requireAuth, ah(async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount required' });
    const pledge = await pool.query('SELECT * FROM capital_pledges WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!pledge.rows.length) return res.status(404).json({ error: 'Pledge not found' });
    const r = await pool.query('UPDATE capital_pledges SET amount_paid=amount_paid+$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', [amount, req.session.user.tenant_id, req.params.id]);
    await pool.query('UPDATE capital_campaigns SET current_total=current_total+$1 WHERE id=$2 AND tenant_id=$3', [amount, pledge.rows[0].campaign_id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'capital_pledges id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/capital-pledges/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM capital_pledges WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'capital_pledges id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/capital-campaigns/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT COUNT(*) as total_campaigns, COALESCE(SUM(total_goal),0) as total_goals, COALESCE(SUM(current_total),0) as total_raised, COUNT(CASE WHEN status=$1 THEN 1 END) as active FROM capital_campaigns WHERE tenant_id=$2', ['active', req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));
  app.get('/capital-campaigns', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query('SELECT * FROM capital_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COALESCE(SUM(total_goal),0) as total_goals, COALESCE(SUM(current_total),0) as total_raised FROM capital_campaigns WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Capital Campaigns', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Capital Campaigns</h1><div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"><div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Goal</p><p class="text-2xl font-bold text-emerald-700">UGX ${stats.rows[0]?.total_goals||0}</p></div><div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Raised</p><p class="text-2xl font-bold text-emerald-700">UGX ${stats.rows[0]?.total_raised||0}</p></div><div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Campaigns</p><p class="text-2xl font-bold text-emerald-700">${campaigns.rows.length}</p></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${campaigns.rows.map(c => { const pct = c.total_goal > 0 ? ((parseFloat(c.current_total)/parseFloat(c.total_goal))*100).toFixed(1) : 0; return `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold text-lg">${esc(c.name)}</h3><p class="text-sm text-gray-500">Status: ${c.status} | Goal: UGX ${c.total_goal}</p><p class="text-sm text-gray-500">Raised: UGX ${c.current_total} (${pct}%)</p><div class="w-full bg-gray-200 rounded-full h-2 mt-2"><div class="bg-emerald-500 h-2 rounded-full" style="width:${Math.min(100,pct)}%"></div></div></div>`; }).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 2: TRIBUTE / MEMORIAL
  // ================================================================
  app.get('/api/tribute-donations', requireAuth, ah(async (req, res) => {
    const { tribute_type } = req.query;
    let q = 'SELECT * FROM tribute_donations WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (tribute_type) { q += ' AND tribute_type=$2'; params.push(esc(tribute_type)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/tribute-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM tribute_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/tribute-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, tribute_type, honoree_name, honoree_email, family_contact_name, family_contact_email, message, amount } = req.body;
    if (!honoree_name) return res.status(400).json({ error: 'honoree_name required' });
    const r = await pool.query('INSERT INTO tribute_donations (tenant_id,campaign_id,donor_name,donor_email,tribute_type,honoree_name,honoree_email,family_contact_name,family_contact_email,message,amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [req.session.user.tenant_id, campaign_id||null, esc(donor_name||''), esc(donor_email||''), tribute_type||'honor', esc(honoree_name), esc(honoree_email||''), esc(family_contact_name||''), esc(family_contact_email||''), esc(message||''), amount||0]);
    await audit(req.session.user.email, 'create', 'tribute_donations id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/tribute-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE tribute_donations SET message=COALESCE($1,message), amount=COALESCE($2,amount), tribute_type=COALESCE($3,tribute_type) WHERE tenant_id=$4 AND id=$5 RETURNING *', [req.body.message?esc(req.body.message):null, req.body.amount||null, req.body.tribute_type?esc(req.body.tribute_type):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    await audit(req.session.user.email, 'update', 'tribute_donations id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/tribute-donations/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM tribute_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'tribute_donations id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/tribute-donations/:id/notify-family', requireAuth, ah(async (req, res) => {
    const td = await pool.query('SELECT * FROM tribute_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!td.rows.length) return res.status(404).json({ error: 'Tribute donation not found' });
    const t = td.rows[0];
    if (!t.family_contact_email) return res.status(400).json({ error: 'No family contact email on file' });
    await pool.query('UPDATE tribute_donations SET family_notified=true WHERE id=$1 AND tenant_id=$2', [t.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'tribute_donations id=' + t.id);
    res.json({ ok: true, notified: t.family_contact_email, tribute_type: t.tribute_type, honoree: t.honoree_name });
  }));
  app.get('/api/tribute-donations/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT tribute_type, COUNT(*) as count, COALESCE(SUM(amount),0) as total_amount, COUNT(CASE WHEN family_notified THEN 1 END) as families_notified FROM tribute_donations WHERE tenant_id=$1 GROUP BY tribute_type', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  // Memorial Pages
  app.get('/api/memorial-pages', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM memorial_pages WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/memorial-pages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM memorial_pages WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Memorial page not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/memorial-pages', requireAuth, ah(async (req, res) => {
    const { honoree_name, biography, page_url, is_active } = req.body;
    if (!honoree_name) return res.status(400).json({ error: 'honoree_name required' });
    const r = await pool.query('INSERT INTO memorial_pages (tenant_id,honoree_name,biography,page_url,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.session.user.tenant_id, esc(honoree_name), esc(biography||''), esc(page_url||''), is_active!==undefined?is_active:true]);
    await audit(req.session.user.email, 'create', 'memorial_pages id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/memorial-pages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE memorial_pages SET honoree_name=COALESCE($1,honoree_name), biography=COALESCE($2,biography), page_url=COALESCE($3,page_url), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.honoree_name?esc(req.body.honoree_name):null, req.body.biography?esc(req.body.biography):null, req.body.page_url?esc(req.body.page_url):null, req.body.is_active, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'memorial_pages id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/memorial-pages/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM memorial_pages WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'memorial_pages id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/memorial-pages/:id/donate', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, amount, message } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount required' });
    const page = await pool.query('SELECT * FROM memorial_pages WHERE tenant_id=$1 AND id=$2 AND is_active=true', [req.session.user.tenant_id, req.params.id]);
    if (!page.rows.length) return res.status(404).json({ error: 'Memorial page not found or inactive' });
    await pool.query('UPDATE memorial_pages SET total_raised=total_raised+$1 WHERE id=$2 AND tenant_id=$3', [amount, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'memorial_pages id=' + req.params.id); res.json({ ok: true, amount, page: page.rows[0].honoree_name });
  }));
  app.get('/tribute-memorial', requireAuth, ah(async (req, res) => {
    const tributes = await pool.query('SELECT * FROM tribute_donations WHERE tenant_id=$1 LIMIT 20', [req.session.user.tenant_id]);
    const pages = await pool.query('SELECT * FROM memorial_pages WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const tributeStats = await pool.query('SELECT tribute_type, COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM tribute_donations WHERE tenant_id=$1 GROUP BY tribute_type', [req.session.user.tenant_id]);
    renderPage(req, res, 'Tribute & Memorial', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Tribute & Memorial</h1><div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">${tributeStats.rows.map(s => `<div class="bg-amber-50 rounded-lg p-4"><p class="text-sm text-gray-600 capitalize">${s.tribute_type}</p><p class="text-xl font-bold text-amber-700">${s.count} donations (UGX ${s.total})</p></div>`).join('')}</div><div class="grid grid-cols-1 md:grid-cols-2 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold mb-2">Recent Tributes (${tributes.rows.length})</h3>${tributes.rows.slice(0,5).map(t => `<p class="text-sm">${esc(t.donor_name)} → ${esc(t.honoree_name)} (${t.tribute_type})</p>`).join('')}</div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold mb-2">Memorial Pages (${pages.rows.length})</h3>${pages.rows.slice(0,5).map(p => `<p class="text-sm">${esc(p.honoree_name)} - UGX ${p.total_raised}</p>`).join('')}</div></div></div>`);
  }));

  // ================================================================
  // FEATURE 3: CROWDFUNDING PERKS
  // ================================================================
  app.get('/api/crowdfunding-perks', requireAuth, ah(async (req, res) => {
    const { campaign_id } = req.query;
    let q = 'SELECT * FROM crowdfunding_perks WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (campaign_id) { q += ' AND campaign_id=$2'; params.push(campaign_id); }
    q += ' ORDER BY min_amount';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/crowdfunding-perks/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Perk not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/crowdfunding-perks', requireAuth, ah(async (req, res) => {
    const { campaign_id, perk_name, description, min_amount, quantity_available, estimated_delivery } = req.body;
    if (!perk_name) return res.status(400).json({ error: 'perk_name required' });
    const r = await pool.query('INSERT INTO crowdfunding_perks (tenant_id,campaign_id,perk_name,description,min_amount,quantity_available,estimated_delivery) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, campaign_id||null, esc(perk_name), esc(description||''), min_amount||0, quantity_available||null, estimated_delivery||null]);
    await audit(req.session.user.email, 'create', 'crowdfunding_perks id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/crowdfunding-perks/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE crowdfunding_perks SET perk_name=COALESCE($1,perk_name), description=COALESCE($2,description), min_amount=COALESCE($3,min_amount), quantity_available=COALESCE($4,quantity_available), estimated_delivery=COALESCE($5,estimated_delivery) WHERE tenant_id=$6 AND id=$7 RETURNING *', [req.body.perk_name?esc(req.body.perk_name):null, req.body.description?esc(req.body.description):null, req.body.min_amount||null, req.body.quantity_available||null, req.body.estimated_delivery||null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'crowdfunding_perks id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/crowdfunding-perks/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM crowdfunding_perks WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'crowdfunding_perks id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/perks/:id/claim', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, shipping_address } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name required' });
    const perk = await pool.query('SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!perk.rows.length) return res.status(404).json({ error: 'Perk not found' });
    const p = perk.rows[0];
    if (p.quantity_available !== null && parseInt(p.quantity_claimed) >= parseInt(p.quantity_available)) return res.status(400).json({ error: 'Perk sold out' });
    const r = await pool.query('INSERT INTO perk_claims (tenant_id,perk_id,donor_name,donor_email,shipping_address) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.session.user.tenant_id, req.params.id, esc(donor_name), esc(donor_email||''), esc(shipping_address||'')]);
    await pool.query('UPDATE crowdfunding_perks SET quantity_claimed=quantity_claimed+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'create', 'perk_claims id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.get('/api/perk-claims', requireAuth, ah(async (req, res) => {
    const { fulfilled } = req.query;
    let q = 'SELECT pc.*, cp.perk_name, cp.min_amount FROM perk_claims pc JOIN crowdfunding_perks cp ON pc.perk_id=cp.id WHERE pc.tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (fulfilled !== undefined) { q += ' AND pc.fulfilled=$2'; params.push(fulfilled === 'true'); }
    q += ' ORDER BY pc.created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.put('/api/perk-claims/:id/fulfill', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE perk_claims SET fulfilled=true WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Claim not found' });
    await audit(req.session.user.email, 'update', 'perk_claims id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/api/perk-claims/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT COUNT(*) as total_claims, COUNT(CASE WHEN fulfilled THEN 1 END) as fulfilled, COUNT(CASE WHEN NOT fulfilled THEN 1 END) as pending FROM perk_claims WHERE tenant_id=$1', [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));
  app.get('/crowdfunding-perks', requireAuth, ah(async (req, res) => {
    const perks = await pool.query('SELECT * FROM crowdfunding_perks WHERE tenant_id=$1 ORDER BY min_amount', [req.session.user.tenant_id]);
    const claimStats = await pool.query('SELECT COUNT(*) as total_claims, COUNT(CASE WHEN fulfilled THEN 1 END) as fulfilled FROM perk_claims WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Crowdfunding Perks', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Crowdfunding Perks</h1><div class="grid grid-cols-2 gap-4 mb-6"><div class="bg-purple-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Claims</p><p class="text-2xl font-bold text-purple-700">${claimStats.rows[0]?.total_claims||0}</p></div><div class="bg-purple-50 rounded-lg p-4"><p class="text-sm text-gray-600">Fulfilled</p><p class="text-2xl font-bold text-purple-700">${claimStats.rows[0]?.fulfilled||0}</p></div></div><div class="grid grid-cols-1 md:grid-cols-3 gap-4">${perks.rows.map(p => { const avail = p.quantity_available ? `${p.quantity_available - p.quantity_claimed} left` : 'Unlimited'; return `<div class="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500"><h3 class="font-semibold">${esc(p.perk_name)}</h3><p class="text-sm text-gray-500">${esc(p.description||'')}</p><p class="text-sm mt-2">Min: UGX ${p.min_amount} | ${avail}</p></div>`; }).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 4: THERMOMETER WIDGETS
  // ================================================================
  app.get('/api/campaign-thermometers', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM campaign_thermometers WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/campaign-thermometers/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM campaign_thermometers WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Thermometer not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/campaign-thermometers', requireAuth, ah(async (req, res) => {
    const { campaign_id, widget_type, style, color_scheme, show_donor_count } = req.body;
    const token = 'thm-' + Math.random().toString(36).substring(2, 14) + Date.now().toString(36);
    const r = await pool.query('INSERT INTO campaign_thermometers (tenant_id,campaign_id,widget_type,style,color_scheme,show_donor_count,embed_token) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.session.user.tenant_id, campaign_id||null, widget_type||'thermometer', style||'classic', color_scheme||'#10b981', show_donor_count!==undefined?show_donor_count:true, token]);
    await audit(req.session.user.email, 'create', 'campaign_thermometers id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/campaign-thermometers/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE campaign_thermometers SET widget_type=COALESCE($1,widget_type), style=COALESCE($2,style), color_scheme=COALESCE($3,color_scheme), show_donor_count=COALESCE($4,show_donor_count), is_active=COALESCE($5,is_active) WHERE tenant_id=$6 AND id=$7 RETURNING *', [req.body.widget_type||null, req.body.style||null, req.body.color_scheme||null, req.body.show_donor_count, req.body.is_active, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'campaign_thermometers id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/campaign-thermometers/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM campaign_thermometers WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'campaign_thermometers id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/thermometer/:embedToken/embed', ah(async (req, res) => {
    const thm = await pool.query('SELECT ct.*, cc.name as campaign_name, cc.total_goal, cc.current_total FROM campaign_thermometers ct LEFT JOIN capital_campaigns cc ON ct.campaign_id=cc.id WHERE ct.embed_token=$1 AND ct.is_active=true', [req.params.embedToken]);
    if (!thm.rows.length) return res.status(404).json({ error: 'Thermometer not found' });
    const t = thm.rows[0];
    const pct = t.total_goal > 0 ? Math.min(100, (parseFloat(t.current_total) / parseFloat(t.total_goal)) * 100) : 0;
    const viewCount = await pool.query('SELECT COUNT(*) as cnt FROM thermometer_views WHERE thermometer_id=$1', [t.id]);
    res.json({ campaign_name: t.campaign_name, total_goal: t.total_goal, current_total: t.current_total, progress_pct: pct.toFixed(1), widget_type: t.widget_type, style: t.style, color_scheme: t.color_scheme, show_donor_count: t.show_donor_count, view_count: parseInt(viewCount.rows[0]?.cnt||0) });
  }));
  app.post('/api/thermometer/:id/track-view', ah(async (req, res) => {
    const { viewer_ip, referrer } = req.body;
    const thm = await pool.query('SELECT tenant_id, id FROM campaign_thermometers WHERE id=$1', [req.params.id]);
    if (!thm.rows.length) return res.status(404).json({ error: 'Thermometer not found' });
    await pool.query('INSERT INTO thermometer_views (tenant_id, thermometer_id, viewer_ip, referrer) VALUES ($1,$2,$3,$4)', [thm.rows[0].tenant_id, req.params.id, esc(viewer_ip||''), esc(referrer||'')]);
    res.json({ ok: true });
  }));
  app.get('/api/campaign-thermometers/:id/view-stats', requireAuth, ah(async (req, res) => {
    const total = await pool.query('SELECT COUNT(*) as total_views, COUNT(DISTINCT viewer_ip) as unique_viewers FROM thermometer_views WHERE tenant_id=$1 AND thermometer_id=$2', [req.session.user.tenant_id, req.params.id]);
    const byReferrer = await pool.query('SELECT referrer, COUNT(*) as views FROM thermometer_views WHERE tenant_id=$1 AND thermometer_id=$2 GROUP BY referrer ORDER BY views DESC LIMIT 10', [req.session.user.tenant_id, req.params.id]);
    res.json({ ...total.rows[0], by_referrer: byReferrer.rows });
  }));
  app.get('/thermometer-widgets', requireAuth, ah(async (req, res) => {
    const thermometers = await pool.query('SELECT ct.*, cc.name as campaign_name FROM campaign_thermometers ct LEFT JOIN capital_campaigns cc ON ct.campaign_id=cc.id WHERE ct.tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Thermometer Widgets', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Thermometer Widgets</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${thermometers.rows.map(t => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${t.widget_type} - ${t.style}</h3><p class="text-sm">Campaign: ${t.campaign_name||'N/A'}</p><p class="text-sm text-gray-500">Token: ${t.embed_token}</p><p class="text-sm text-gray-500">${t.is_active?'Active':'Inactive'} | Color: ${t.color_scheme}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 5: DONOR PORTAL
  // ================================================================
  app.get('/api/donor-portal/profile', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const r = await pool.query('SELECT * FROM donor_portal_preferences WHERE tenant_id=$1 AND donor_email=$2', [req.session.user.tenant_id, esc(email)]);
    if (!r.rows.length) {
      const created = await pool.query('INSERT INTO donor_portal_preferences (tenant_id,donor_email,display_name) VALUES ($1,$2,$3) RETURNING *', [req.session.user.tenant_id, esc(email), esc(req.session.user.name||email)]);
      return res.json(created.rows[0]);
    }
    res.json(r.rows[0]);
  }));
  app.put('/api/donor-portal/profile', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const { display_name, bio, preferred_communication, show_donations_publicly } = req.body;
    const r = await pool.query('UPDATE donor_portal_preferences SET display_name=COALESCE($1,display_name), bio=COALESCE($2,bio), preferred_communication=COALESCE($3,preferred_communication), show_donations_publicly=COALESCE($4,show_donations_publicly) WHERE tenant_id=$5 AND donor_email=$6 RETURNING *', [display_name?esc(display_name):null, bio?esc(bio):null, preferred_communication||null, show_donations_publicly!==undefined?show_donations_publicly:null, req.session.user.tenant_id, esc(email)]);
    await audit(req.session.user.email, 'update', 'donor_portal_preferences id=' + r.rows[0]?.id); res.json(r.rows[0]);
  }));
  app.get('/api/donor-portal/donations', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const { limit, offset } = req.query;
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    const r = await pool.query('SELECT * FROM donations WHERE tenant_id=$1 AND donor_email=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4', [req.session.user.tenant_id, esc(email), lim, off]);
    res.json(r.rows);
  }));
  app.get('/api/donor-portal/receipts', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const { year } = req.query;
    let q = "SELECT id, donor_email, amount, payment_method, created_at FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND status='completed'";
    const params = [req.session.user.tenant_id, esc(email)];
    if (year) { q += ' AND EXTRACT(YEAR FROM created_at)=$3'; params.push(parseInt(year)); }
    q += ' ORDER BY created_at DESC LIMIT 50';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/donor-portal/giving-summary', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const r = await pool.query("SELECT COUNT(*) as total_donations, COALESCE(SUM(amount),0) as total_given, MIN(created_at) as first_donation, MAX(created_at) as last_donation FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND status='completed'", [req.session.user.tenant_id, esc(email)]);
    const currentYear = await pool.query("SELECT COALESCE(SUM(amount),0) as year_total FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND status='completed' AND EXTRACT(YEAR FROM created_at)=EXTRACT(YEAR FROM NOW())", [req.session.user.tenant_id, esc(email)]);
    res.json({ ...r.rows[0], current_year_total: currentYear.rows[0]?.year_total||0 });
  }));
  app.post('/api/donor-portal/login', ah(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const token = 'dp-' + Math.random().toString(36).substring(2, 18);
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tid = req.session?.user?.tenant_id || 1;
    await pool.query('INSERT INTO donor_portal_sessions (tenant_id,donor_email,session_token,expires_at) VALUES ($1,$2,$3,$4)', [tid, esc(email), token, expires]);
    res.json({ session_token: token, expires_at: expires });
  }));
  app.get('/donor-portal', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const summary = await pool.query("SELECT COUNT(*) as total_donations, COALESCE(SUM(amount),0) as total_given FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND status='completed'", [req.session.user.tenant_id, esc(email)]);
    renderPage(req, res, 'Donor Portal', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Donor Portal</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Donations</p><p class="text-2xl font-bold text-emerald-700">${summary.rows[0]?.total_donations||0}</p></div><div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Given</p><p class="text-2xl font-bold text-emerald-700">UGX ${summary.rows[0]?.total_given||0}</p></div></div><div class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Profile</h3><p>Update your donor profile and preferences</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Donations</h3><p>View your donation history</p></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">Receipts</h3><p>Download tax receipts</p></div></div></div>`);
  }));

  // ================================================================
  // FEATURE 6: EMAIL BUILDER
  // ================================================================
  app.get('/api/email-templates-builder', requireAuth, ah(async (req, res) => {
    const { category } = req.query;
    let q = 'SELECT * FROM email_templates_builder WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (category) { q += ' AND category=$2'; params.push(esc(category)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/email-templates-builder/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM email_templates_builder WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/email-templates-builder', requireAuth, ah(async (req, res) => {
    const { name, subject, body_html, category, is_default } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO email_templates_builder (tenant_id,name,subject,body_html,category,is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, esc(name), esc(subject||''), esc(body_html||''), esc(category||'general'), is_default||false]);
    await audit(req.session.user.email, 'create', 'email_templates_builder id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/email-templates-builder/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE email_templates_builder SET name=COALESCE($1,name), subject=COALESCE($2,subject), body_html=COALESCE($3,body_html), category=COALESCE($4,category) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.name?esc(req.body.name):null, req.body.subject?esc(req.body.subject):null, req.body.body_html?esc(req.body.body_html):null, req.body.category?esc(req.body.category):null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'email_templates_builder id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/email-templates-builder/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM email_templates_builder WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'email_templates_builder id=' + req.params.id); res.json({ ok: true });
  }));
  // Email Campaigns
  app.get('/api/email-campaign-builder', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT ec.*, et.name as template_name FROM email_campaign_builder ec LEFT JOIN email_templates_builder et ON ec.template_id=et.id WHERE ec.tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (status) { q += ' AND ec.status=$2'; params.push(esc(status)); }
    q += ' ORDER BY ec.created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/email-campaign-builder/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM email_campaign_builder WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/email-campaign-builder', requireAuth, ah(async (req, res) => {
    const { template_id, name, subject, body_html, sender_name, sender_email, recipient_segment } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO email_campaign_builder (tenant_id,template_id,name,subject,body_html,sender_name,sender_email,recipient_segment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [req.session.user.tenant_id, template_id||null, esc(name), esc(subject||''), esc(body_html||''), esc(sender_name||''), esc(sender_email||''), esc(recipient_segment||'all')]);
    await audit(req.session.user.email, 'create', 'email_campaign_builder id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/email-campaign-builder/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE email_campaign_builder SET name=COALESCE($1,name), subject=COALESCE($2,subject), body_html=COALESCE($3,body_html), recipient_segment=COALESCE($4,recipient_segment) WHERE tenant_id=$5 AND id=$6 RETURNING *', [req.body.name?esc(req.body.name):null, req.body.subject?esc(req.body.subject):null, req.body.body_html?esc(req.body.body_html):null, req.body.recipient_segment?esc(req.body.recipient_segment):null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'email_campaign_builder id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/email-campaign-builder/:id/preview', requireAuth, ah(async (req, res) => {
    const ec = await pool.query('SELECT ec.*, et.name as template_name FROM email_campaign_builder ec LEFT JOIN email_templates_builder et ON ec.template_id=et.id WHERE ec.tenant_id=$1 AND ec.id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!ec.rows.length) return res.status(404).json({ error: 'Email campaign not found' });
    res.json({ preview: { subject: ec.rows[0].subject, body_html: ec.rows[0].body_html, sender: ec.rows[0].sender_name, template: ec.rows[0].template_name } });
  }));
  app.post('/api/email-campaign-builder/:id/schedule', requireAuth, ah(async (req, res) => {
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    const r = await pool.query('UPDATE email_campaign_builder SET status=$1, scheduled_at=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *', ['scheduled', scheduled_at, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'email_campaign_builder id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.post('/api/email-campaign-builder/:id/send', requireAuth, ah(async (req, res) => {
    const ec = await pool.query('SELECT * FROM email_campaign_builder WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!ec.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const count = await pool.query('SELECT COUNT(*) as cnt FROM donors WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const r = await pool.query('UPDATE email_campaign_builder SET status=$1, sent_at=NOW(), recipient_count=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *', ['sent', parseInt(count.rows[0]?.cnt||0), req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'email_campaign_builder id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/api/email-campaign-builder/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT status, COUNT(*) as count, COALESCE(SUM(recipient_count),0) as total_recipients, COALESCE(SUM(open_count),0) as total_opens, COALESCE(SUM(click_count),0) as total_clicks FROM email_campaign_builder WHERE tenant_id=$1 GROUP BY status', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/email-builder', requireAuth, ah(async (req, res) => {
    const templates = await pool.query('SELECT * FROM email_templates_builder WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const campaigns = await pool.query('SELECT * FROM email_campaign_builder WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Email Builder', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Email Builder</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"><div class="bg-sky-50 rounded-lg p-4"><h3 class="font-semibold">Templates (${templates.rows.length})</h3><p>Reusable email templates</p></div><div class="bg-sky-50 rounded-lg p-4"><h3 class="font-semibold">Campaigns (${campaigns.rows.length})</h3><p>Email campaign broadcasts</p></div></div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold mb-2">Recent Campaigns</h3>${campaigns.rows.slice(0,5).map(c => `<p class="text-sm">${esc(c.name)} - ${c.status} | Recipients: ${c.recipient_count} | Opens: ${c.open_count}</p>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 7: DIRECT MAIL
  // ================================================================
  app.get('/api/direct-mail-campaigns', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (status) { q += ' AND status=$2'; params.push(esc(status)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/direct-mail-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/direct-mail-campaigns', requireAuth, ah(async (req, res) => {
    const { name, template_content, recipient_segment, mail_class, estimated_cost } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query('INSERT INTO direct_mail_campaigns (tenant_id,name,template_content,recipient_segment,mail_class,estimated_cost) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.session.user.tenant_id, esc(name), esc(template_content||''), esc(recipient_segment||'all'), esc(mail_class||'standard'), estimated_cost||0]);
    await audit(req.session.user.email, 'create', 'direct_mail_campaigns id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/direct-mail-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE direct_mail_campaigns SET name=COALESCE($1,name), template_content=COALESCE($2,template_content), recipient_segment=COALESCE($3,recipient_segment), mail_class=COALESCE($4,mail_class), status=COALESCE($5,status) WHERE tenant_id=$6 AND id=$7 RETURNING *', [req.body.name?esc(req.body.name):null, req.body.template_content?esc(req.body.template_content):null, req.body.recipient_segment?esc(req.body.recipient_segment):null, req.body.mail_class?esc(req.body.mail_class):null, req.body.status||null, req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'update', 'direct_mail_campaigns id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.delete('/api/direct-mail-campaigns/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'direct_mail_campaigns id=' + req.params.id); res.json({ ok: true });
  }));
  app.get('/api/direct-mail-campaigns/:id/recipients', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM direct_mail_recipients WHERE tenant_id=$1 AND campaign_id=$2';
    const params = [req.session.user.tenant_id, req.params.id];
    if (status) { q += ' AND status=$3'; params.push(esc(status)); }
    q += ' ORDER BY donor_name';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.post('/api/direct-mail-campaigns/:id/recipients', requireAuth, ah(async (req, res) => {
    const { recipients } = req.body;
    if (!Array.isArray(recipients) || !recipients.length) return res.status(400).json({ error: 'recipients array required' });
    let added = 0;
    for (const r of recipients) {
      await pool.query('INSERT INTO direct_mail_recipients (tenant_id,campaign_id,donor_name,address_line1,city,state,postal_code,country) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [req.session.user.tenant_id, req.params.id, esc(r.donor_name||''), esc(r.address_line1||''), esc(r.city||''), esc(r.state||''), esc(r.postal_code||''), esc(r.country||'')]);
      added++;
    }
    await pool.query('UPDATE direct_mail_campaigns SET total_recipients=total_recipients+$1 WHERE id=$2 AND tenant_id=$3', [added, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'direct_mail_campaigns id=' + req.params.id); res.json({ ok: true, added });
  }));
  app.post('/api/direct-mail-campaigns/:id/send', requireAuth, ah(async (req, res) => {
    const camp = await pool.query('SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const r = await pool.query('UPDATE direct_mail_campaigns SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['sent', req.session.user.tenant_id, req.params.id]);
    await pool.query('UPDATE direct_mail_recipients SET status=$1 WHERE campaign_id=$2 AND tenant_id=$3', ['mailed', req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'update', 'direct_mail_campaigns id=' + req.params.id); res.json(r.rows[0]);
  }));
  app.get('/api/direct-mail-campaigns/:id/cost-estimate', requireAuth, ah(async (req, res) => {
    const camp = await pool.query('SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!camp.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const recips = await pool.query('SELECT COUNT(*) as cnt FROM direct_mail_recipients WHERE tenant_id=$1 AND campaign_id=$2', [req.session.user.tenant_id, req.params.id]);
    const count = parseInt(recips.rows[0]?.cnt||0);
    const costPerPiece = camp.rows[0].mail_class === 'priority' ? 5000 : camp.rows[0].mail_class === 'express' ? 3500 : 1500;
    const international = await pool.query("SELECT COUNT(*) as cnt FROM direct_mail_recipients WHERE tenant_id=$1 AND campaign_id=$2 AND country IS NOT NULL AND country != '' AND country != 'Uganda'", [req.session.user.tenant_id, req.params.id]);
    const intlCount = parseInt(international.rows[0]?.cnt||0);
    const domesticCount = count - intlCount;
    res.json({ total_recipients: count, domestic: domesticCount, international: intlCount, cost_per_domestic: costPerPiece, cost_per_international: costPerPiece * 2, estimated_domestic: domesticCount * costPerPiece, estimated_international: intlCount * costPerPiece * 2, estimated_total: (domesticCount * costPerPiece) + (intlCount * costPerPiece * 2), mail_class: camp.rows[0].mail_class });
  }));
  app.get('/direct-mail', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query('SELECT * FROM direct_mail_campaigns WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Direct Mail', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Direct Mail Campaigns</h1><div class="grid grid-cols-1 md:grid-cols-2 gap-4">${campaigns.rows.map(c => `<div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold">${esc(c.name)}</h3><p class="text-sm">Status: ${c.status} | Class: ${c.mail_class}</p><p class="text-sm">Recipients: ${c.total_recipients} | Est. Cost: UGX ${c.estimated_cost}</p></div>`).join('')}</div></div>`);
  }));

  // ================================================================
  // FEATURE 8: DONOR HEATMAPS
  // ================================================================
  app.get('/api/donor-heatmap', requireAuth, ah(async (req, res) => {
    const { country, region, limit } = req.query;
    let q = 'SELECT * FROM donor_heatmap_data WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (country) { q += ' AND country=$' + idx; params.push(esc(country)); idx++; }
    if (region) { q += ' AND region=$' + idx; params.push(esc(region)); idx++; }
    q += ' ORDER BY total_donated DESC LIMIT $' + idx;
    params.push(parseInt(limit) || 200);
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));
  app.get('/api/donor-heatmap/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM donor_heatmap_data WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  }));
  app.post('/api/donor-heatmap', requireAuth, ah(async (req, res) => {
    const { donor_email, donor_name, latitude, longitude, city, region, country, total_donated, donation_count } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name required' });
    const r = await pool.query('INSERT INTO donor_heatmap_data (tenant_id,donor_email,donor_name,latitude,longitude,city,region,country,total_donated,donation_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [req.session.user.tenant_id, esc(donor_email||''), esc(donor_name), latitude||0, longitude||0, esc(city||''), esc(region||''), esc(country||''), total_donated||0, donation_count||0]);
    await audit(req.session.user.email, 'create', 'donor_heatmap_data id=' + r.rows[0].id); res.json(r.rows[0]);
  }));
  app.put('/api/donor-heatmap/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donor_heatmap_data SET total_donated=COALESCE($1,total_donated), donation_count=COALESCE($2,donation_count), city=COALESCE($3,city), region=COALESCE($4,region), country=COALESCE($5,country) WHERE tenant_id=$6 AND id=$7 RETURNING *', [req.body.total_donated||null, req.body.donation_count||null, req.body.city?esc(req.body.city):null, req.body.region?esc(req.body.region):null, req.body.country?esc(req.body.country):null, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.delete('/api/donor-heatmap/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM donor_heatmap_data WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req.session.user.email, 'delete', 'donor_heatmap_data id=' + req.params.id); res.json({ ok: true });
  }));
  app.post('/api/donor-heatmap/refresh', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM regional_donation_stats WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const regions = await pool.query('SELECT region, country, SUM(total_donated) as total_donated, COUNT(*) as donor_count, AVG(total_donated) as avg_donation FROM donor_heatmap_data WHERE tenant_id=$1 GROUP BY region, country', [req.session.user.tenant_id]);
    for (const r of regions.rows) {
      await pool.query('INSERT INTO regional_donation_stats (tenant_id,region,country,total_donated,donor_count,avg_donation) VALUES ($1,$2,$3,$4,$5,$6)', [req.session.user.tenant_id, esc(r.region||''), esc(r.country||''), r.total_donated||0, r.donor_count||0, r.avg_donation||0]);
    }
    await audit(req.session.user.email, 'update', 'donor_heatmap_data id=' + 0); res.json({ ok: true, regions_refreshed: regions.rows.length });
  }));
  app.get('/api/donor-heatmap/regions', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/donor-heatmap/top-regions', requireAuth, ah(async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const r = await pool.query('SELECT region, country, total_donated, donor_count, avg_donation FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC LIMIT $2', [req.session.user.tenant_id, limit]);
    res.json(r.rows);
  }));
  app.get('/api/donor-heatmap/country-summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT country, SUM(total_donated) as total_donated, COUNT(*) as donor_count FROM donor_heatmap_data WHERE tenant_id=$1 GROUP BY country ORDER BY total_donated DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/donor-heatmap', requireAuth, ah(async (req, res) => {
    const data = await pool.query('SELECT * FROM donor_heatmap_data WHERE tenant_id=$1 LIMIT 50', [req.session.user.tenant_id]);
    const regions = await pool.query('SELECT * FROM regional_donation_stats WHERE tenant_id=$1 ORDER BY total_donated DESC LIMIT 10', [req.session.user.tenant_id]);
    const countrySummary = await pool.query('SELECT country, SUM(total_donated) as total, COUNT(*) as donors FROM donor_heatmap_data WHERE tenant_id=$1 GROUP BY country ORDER BY total DESC', [req.session.user.tenant_id]);
    renderPage(req, res, 'Donor Heatmap', `<div class="max-w-6xl mx-auto p-6"><h1 class="text-2xl font-bold mb-6">Donor Heatmap</h1><div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"><div class="bg-teal-50 rounded-lg p-4"><p class="text-sm text-gray-600">Donor Locations</p><p class="text-2xl font-bold text-teal-700">${data.rows.length}</p></div><div class="bg-teal-50 rounded-lg p-4"><p class="text-sm text-gray-600">Regions</p><p class="text-2xl font-bold text-teal-700">${regions.rows.length}</p></div><div class="bg-teal-50 rounded-lg p-4"><p class="text-sm text-gray-600">Countries</p><p class="text-2xl font-bold text-teal-700">${countrySummary.rows.length}</p></div></div><div class="grid grid-cols-1 md:grid-cols-2 gap-4"><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold mb-2">Top Regions</h3>${regions.rows.slice(0,5).map(r => `<p class="text-sm">${esc(r.region)}, ${esc(r.country)} - UGX ${r.total_donated} (${r.donor_count} donors)</p>`).join('')}</div><div class="bg-white rounded-lg shadow p-4"><h3 class="font-semibold mb-2">Countries</h3>${countrySummary.rows.slice(0,5).map(c => `<p class="text-sm">${esc(c.country)} - UGX ${c.total} (${c.donors} donors)</p>`).join('')}</div></div></div>`);
  }));

  console.log('[FundraisingUltimate8] features registered');
};
