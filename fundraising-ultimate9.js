/**
 * Fundraising Ultimate9 Module — Events, Galas, Wealth, Grants, Tax, Giving Days, Installments, Engagement
 * Features: Virtual/Hybrid Events, Fundraising Gala Management, Wealth Screening,
 * Grant Writing Assistant, Donor Tax Statement Generator, Giving Day Management,
 * Installment/Payment Plans, Donor Engagement Scoring
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Virtual / Hybrid Events
    `CREATE TABLE IF NOT EXISTS virtual_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_type TEXT DEFAULT 'virtual' CHECK (event_type IN ('virtual','hybrid','in_person')), start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, platform TEXT DEFAULT 'zoom' CHECK (platform IN ('zoom','google_meet','teams','youtube','custom')), meeting_url TEXT, stream_url TEXT, max_attendees INTEGER DEFAULT 0, registration_required BOOLEAN DEFAULT true, ticket_price NUMERIC DEFAULT 0, total_registered INTEGER DEFAULT 0, total_attended INTEGER DEFAULT 0, status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS virtual_event_attendees (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER NOT NULL REFERENCES virtual_events(id) ON DELETE CASCADE, attendee_name TEXT NOT NULL, attendee_email TEXT NOT NULL, attendee_phone TEXT, registration_date TIMESTAMPTZ DEFAULT NOW(), attended BOOLEAN DEFAULT false, attendance_duration_minutes INTEGER DEFAULT 0, feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5), feedback_text TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_virtual_events_tenant ON virtual_events(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_virtual_event_attendees_event ON virtual_event_attendees(event_id)`,

    // Feature 2: Fundraising Gala Management
    `CREATE TABLE IF NOT EXISTS fundraising_galas (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, date DATE, venue TEXT, address TEXT, capacity INTEGER DEFAULT 0, ticket_price NUMERIC DEFAULT 0, table_price NUMERIC DEFAULT 0, tables_available INTEGER DEFAULT 0, tables_sold INTEGER DEFAULT 0, total_raised NUMERIC DEFAULT 0, live_auction_total NUMERIC DEFAULT 0, silent_auction_total NUMERIC DEFAULT 0, paddle_raise_total NUMERIC DEFAULT 0, status TEXT DEFAULT 'planning' CHECK (status IN ('planning','upcoming','live','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gala_tables (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, gala_id INTEGER NOT NULL REFERENCES fundraising_galas(id) ON DELETE CASCADE, table_number TEXT NOT NULL, table_name TEXT, capacity INTEGER DEFAULT 10, sponsor_name TEXT, price NUMERIC DEFAULT 0, is_sold BOOLEAN DEFAULT false, sold_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gala_seats (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, table_id INTEGER NOT NULL REFERENCES gala_tables(id) ON DELETE CASCADE, seat_number TEXT NOT NULL, guest_name TEXT, guest_email TEXT, guest_phone TEXT, dietary_notes TEXT, is_confirmed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_galas_tenant ON fundraising_galas(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gala_tables_gala ON gala_tables(gala_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gala_seats_table ON gala_seats(table_id)`,

    // Feature 3: Wealth Screening
    `CREATE TABLE IF NOT EXISTS donor_wealth_indicators (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, estimated_net_worth NUMERIC DEFAULT 0, giving_capacity NUMERIC DEFAULT 0, real_estate_value NUMERIC DEFAULT 0, stock_holdings NUMERIC DEFAULT 0, income_estimate NUMERIC DEFAULT 0, philanthropy_score INTEGER DEFAULT 0, data_source TEXT DEFAULT 'manual', last_updated TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE TABLE IF NOT EXISTS wealth_screening_results (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, screening_date TIMESTAMPTZ DEFAULT NOW(), total_screened INTEGER DEFAULT 0, high_capacity_count INTEGER DEFAULT 0, mid_capacity_count INTEGER DEFAULT 0, avg_capacity NUMERIC DEFAULT 0, top_prospects_json TEXT DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_wealth_indicators_tenant ON donor_wealth_indicators(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_screening_results_tenant ON wealth_screening_results(tenant_id)`,

    // Feature 4: Grant Writing Assistant
    `CREATE TABLE IF NOT EXISTS grant_writing_templates (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, funder_name TEXT, category TEXT, sections_json TEXT DEFAULT '[]', word_limit INTEGER DEFAULT 5000, deadline_typical TEXT, tips TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS grant_proposals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, template_id INTEGER REFERENCES grant_writing_templates(id) ON DELETE SET NULL, title TEXT NOT NULL, funder_name TEXT, amount_requested NUMERIC DEFAULT 0, project_description TEXT, budget_json TEXT DEFAULT '{}', timeline_json TEXT DEFAULT '[]', status TEXT DEFAULT 'draft' CHECK (status IN ('draft','in_progress','review','submitted','approved','rejected','withdrawn')), deadline DATE, submitted_at TIMESTAMPTZ, outcome TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_grant_templates_tenant ON grant_writing_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grant_proposals_tenant ON grant_proposals(tenant_id)`,

    // Feature 5: Donor Tax Statement Generator
    `CREATE TABLE IF NOT EXISTS donor_tax_statements (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_name TEXT NOT NULL, donor_email TEXT NOT NULL, donor_address TEXT, tax_year INTEGER NOT NULL, total_donations NUMERIC DEFAULT 0, total_deductible NUMERIC DEFAULT 0, non_deductible NUMERIC DEFAULT 0, statement_number TEXT, generated_at TIMESTAMPTZ DEFAULT NOW(), sent_at TIMESTAMPTZ, pdf_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS tax_statement_batches (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, tax_year INTEGER NOT NULL, total_statements INTEGER DEFAULT 0, total_amount NUMERIC DEFAULT 0, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_tax_statements_tenant ON donor_tax_statements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tax_batches_tenant ON tax_statement_batches(tenant_id)`,

    // Feature 6: Giving Day Management
    `CREATE TABLE IF NOT EXISTS giving_days (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, date DATE, goal_amount NUMERIC DEFAULT 0, total_raised NUMERIC DEFAULT 0, donor_count INTEGER DEFAULT 0, gift_count INTEGER DEFAULT 0, matching_pool NUMERIC DEFAULT 0, status TEXT DEFAULT 'planning' CHECK (status IN ('planning','active','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS giving_day_challenges (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, giving_day_id INTEGER NOT NULL REFERENCES giving_days(id) ON DELETE CASCADE, challenge_type TEXT DEFAULT 'matching' CHECK (challenge_type IN ('matching','milestone','stretch','bonus')), description TEXT, threshold NUMERIC DEFAULT 0, bonus_amount NUMERIC DEFAULT 0, current_progress NUMERIC DEFAULT 0, is_achieved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS giving_day_leaderboards (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, giving_day_id INTEGER NOT NULL REFERENCES giving_days(id) ON DELETE CASCADE, donor_name TEXT, amount NUMERIC DEFAULT 0, rank INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_giving_days_tenant ON giving_days(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gd_challenges_day ON giving_day_challenges(giving_day_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gd_leaderboard_day ON giving_day_leaderboards(giving_day_id)`,

    // Feature 7: Installment / Payment Plans
    `CREATE TABLE IF NOT EXISTS installment_plans (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT NOT NULL, total_amount NUMERIC DEFAULT 0, down_payment NUMERIC DEFAULT 0, installment_amount NUMERIC DEFAULT 0, frequency TEXT DEFAULT 'monthly' CHECK (frequency IN ('weekly','biweekly','monthly','quarterly')), total_installments INTEGER DEFAULT 1, paid_installments INTEGER DEFAULT 0, next_payment_date DATE, status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled','defaulted')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS installment_payments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, plan_id INTEGER NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE, installment_number INTEGER NOT NULL, amount_due NUMERIC DEFAULT 0, amount_paid NUMERIC DEFAULT 0, due_date DATE, paid_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant ON installment_plans(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_installment_payments_plan ON installment_payments(plan_id)`,

    // Feature 8: Donor Engagement Scoring
    `CREATE TABLE IF NOT EXISTS donor_engagement_scores (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, engagement_score INTEGER DEFAULT 0, giving_score INTEGER DEFAULT 0, event_score INTEGER DEFAULT 0, volunteer_score INTEGER DEFAULT 0, advocacy_score INTEGER DEFAULT 0, communication_score INTEGER DEFAULT 0, last_calculated TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, donor_email))`,
    `CREATE TABLE IF NOT EXISTS engagement_activities (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, activity_type TEXT NOT NULL CHECK (activity_type IN ('donation','event_attendance','volunteer','advocacy','email_open','email_click','social_share','referral','survey','feedback')), description TEXT, points INTEGER DEFAULT 1, recorded_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_engagement_scores_tenant ON donor_engagement_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_engagement_activities_tenant ON engagement_activities(tenant_id)`,

    // Seed: Grant Writing Templates (Education, Community Development, Health)
    `INSERT INTO grant_writing_templates (tenant_id, name, funder_name, category, sections_json, word_limit, deadline_typical, tips, is_active) SELECT t.id, 'Education Grant Template', 'Department of Education', 'Education', '[{"section":"Executive Summary","description":"Overview of the project and its educational impact","word_limit":500},{"section":"Needs Assessment","description":"Documented educational needs in the target community","word_limit":800},{"section":"Project Description","description":"Detailed description of the educational program","word_limit":1500},{"section":"Goals and Objectives","description":"Measurable goals and SMART objectives","word_limit":600},{"section":"Methodology","description":"Implementation approach and timeline","word_limit":1000},{"section":"Budget","description":"Detailed budget with justification","word_limit":400},{"section":"Evaluation Plan","description":"How outcomes will be measured","word_limit":600},{"section":"Sustainability","description":"Long-term sustainability plan","word_limit":400}]', 5000, 'March 31 annually', 'Focus on measurable student outcomes and community impact. Include baseline data and evidence-based approaches.', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM grant_writing_templates WHERE tenant_id=t.id AND name='Education Grant Template')`,

    `INSERT INTO grant_writing_templates (tenant_id, name, funder_name, category, sections_json, word_limit, deadline_typical, tips, is_active) SELECT t.id, 'Community Development Grant Template', 'Community Development Foundation', 'Community Development', '[{"section":"Community Need","description":"Description of community challenges and opportunities","word_limit":800},{"section":"Project Overview","description":"Summary of the proposed community initiative","word_limit":600},{"section":"Target Population","description":"Demographics and characteristics of beneficiaries","word_limit":400},{"section":"Implementation Plan","description":"Step-by-step implementation approach","word_limit":1200},{"section":"Partnerships","description":"Key community partners and their roles","word_limit":500},{"section":"Budget Narrative","description":"Detailed budget justification","word_limit":500},{"section":"Outcomes and Metrics","description":"Expected outcomes and measurement approach","word_limit":600},{"section":"Capacity and Track Record","description":"Organization history and past successes","word_limit":400}]', 5000, 'June 30 and December 31', 'Emphasize community partnerships and resident engagement. Show matching funds and volunteer commitments.', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM grant_writing_templates WHERE tenant_id=t.id AND name='Community Development Grant Template')`,

    `INSERT INTO grant_writing_templates (tenant_id, name, funder_name, category, sections_json, word_limit, deadline_typical, tips, is_active) SELECT t.id, 'Health Grant Template', 'Health Innovation Fund', 'Health', '[{"section":"Health Problem Statement","description":"Description of the health issue being addressed","word_limit":600},{"section":"Literature Review","description":"Evidence base for the proposed intervention","word_limit":800},{"section":"Project Design","description":"Detailed description of the health program","word_limit":1500},{"section":"Target Population","description":"Health demographics and risk factors","word_limit":400},{"section":"Clinical or Program Model","description":"Evidence-based model being adapted","word_limit":800},{"section":"Data Collection","description":"Health metrics and data collection methods","word_limit":500},{"section":"Budget and Resources","description":"Financial plan and resource allocation","word_limit":500},{"section":"Dissemination Plan","description":"How findings will be shared","word_limit":400}]', 5500, 'Rolling basis', 'Use clinical evidence and public health data. Include IRB considerations if applicable. Highlight health equity.', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM grant_writing_templates WHERE tenant_id=t.id AND name='Health Grant Template')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate9] Migrations complete — 8 features');
  })();

  // =============================================
  // FEATURE 1: VIRTUAL / HYBRID EVENTS
  // =============================================
  app.get('/api/virtual-events', requireAuth, ah(async (req, res) => {
    const { status, event_type } = req.query;
    let q = `SELECT * FROM virtual_events WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ` AND status=$${idx++}`; params.push(status); }
    if (event_type) { q += ` AND event_type=$${idx++}`; params.push(event_type); }
    q += ` ORDER BY start_time DESC LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/virtual-events', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, description, event_type, start_time, end_time, platform, meeting_url, stream_url, max_attendees, registration_required, ticket_price } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(`INSERT INTO virtual_events (tenant_id, title, description, event_type, start_time, end_time, platform, meeting_url, stream_url, max_attendees, registration_required, ticket_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [tid, esc(title), esc(description||''), event_type||'virtual', start_time||null, end_time||null, platform||'zoom', esc(meeting_url||''), esc(stream_url||''), max_attendees||0, registration_required??true, ticket_price||0]);
    await audit(req, 'create', 'virtual_events', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/virtual-events/:id', requireAuth, ah(async (req, res) => {
    const { title, description, event_type, start_time, end_time, platform, meeting_url, stream_url, max_attendees, registration_required, ticket_price, status } = req.body;
    const r = await pool.query(`UPDATE virtual_events SET title=COALESCE($1,title), description=COALESCE($2,description), event_type=COALESCE($3,event_type), start_time=COALESCE($4,start_time), end_time=COALESCE($5,end_time), platform=COALESCE($6,platform), meeting_url=COALESCE($7,meeting_url), stream_url=COALESCE($8,stream_url), max_attendees=COALESCE($9,max_attendees), registration_required=COALESCE($10,registration_required), ticket_price=COALESCE($11,ticket_price), status=COALESCE($12,status) WHERE tenant_id=$13 AND id=$14 RETURNING *`, [title?esc(title):null, description?esc(description):null, event_type, start_time, end_time, platform, meeting_url?esc(meeting_url):null, stream_url?esc(stream_url):null, max_attendees, registration_required, ticket_price, status, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
    await audit(req, 'update', 'virtual_events', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/virtual-events/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`DELETE FROM virtual_events WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Event not found' });
    await audit(req, 'delete', 'virtual_events', req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/virtual-events/:id/register', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const eventId = req.params.id;
    const { attendee_name, attendee_email, attendee_phone } = req.body;
    if (!attendee_name || !attendee_email) return res.status(400).json({ error: 'attendee_name and attendee_email required' });
    const event = await pool.query(`SELECT * FROM virtual_events WHERE tenant_id=$1 AND id=$2`, [tid, eventId]);
    if (!event.rows.length) return res.status(404).json({ error: 'Event not found' });
    if (event.rows[0].max_attendees > 0 && event.rows[0].total_registered >= event.rows[0].max_attendees) return res.status(400).json({ error: 'Event is full' });
    try {
      const r = await pool.query(`INSERT INTO virtual_event_attendees (tenant_id, event_id, attendee_name, attendee_email, attendee_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, eventId, esc(attendee_name), esc(attendee_email), esc(attendee_phone||'')]);
      await pool.query(`UPDATE virtual_events SET total_registered=total_registered+1 WHERE id=$1`, [eventId]);
      await audit(req, 'register', 'virtual_events', eventId);
      res.json(r.rows[0]);
    } catch(e) { res.status(400).json({ error: 'Already registered for this event' }); }
  }));

  app.post('/api/virtual-events/:id/check-attendance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const eventId = req.params.id;
    const { attendee_email, duration_minutes } = req.body;
    if (!attendee_email) return res.status(400).json({ error: 'attendee_email required' });
    const r = await pool.query(`UPDATE virtual_event_attendees SET attended=true, attendance_duration_minutes=$1 WHERE tenant_id=$2 AND event_id=$3 AND attendee_email=$4 RETURNING *`, [duration_minutes||0, tid, eventId, esc(attendee_email)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Registration not found' });
    await pool.query(`UPDATE virtual_events SET total_attended=(SELECT COUNT(*) FROM virtual_event_attendees WHERE event_id=$1 AND attended=true) WHERE id=$1`, [eventId]);
    await audit(req, 'check_attendance', 'virtual_events', eventId);
    res.json(r.rows[0]);
  }));

  app.get('/api/virtual-events/:id/attendees', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM virtual_event_attendees WHERE tenant_id=$1 AND event_id=$2 ORDER BY registration_date DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/virtual-events/:id/feedback', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const eventId = req.params.id;
    const { attendee_email, feedback_rating, feedback_text } = req.body;
    if (!attendee_email) return res.status(400).json({ error: 'attendee_email required' });
    const r = await pool.query(`UPDATE virtual_event_attendees SET feedback_rating=$1, feedback_text=$2 WHERE tenant_id=$3 AND event_id=$4 AND attendee_email=$5 RETURNING *`, [feedback_rating||null, esc(feedback_text||''), tid, eventId, esc(attendee_email)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Registration not found' });
    res.json(r.rows[0]);
  }));

  app.get('/api/virtual-events/:id/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const eventId = req.params.id;
    const event = await pool.query(`SELECT * FROM virtual_events WHERE tenant_id=$1 AND id=$2`, [tid, eventId]);
    if (!event.rows.length) return res.status(404).json({ error: 'Event not found' });
    const attendees = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN attended THEN 1 END) as attended_count, AVG(attendance_duration_minutes) as avg_duration, AVG(feedback_rating) as avg_rating FROM virtual_event_attendees WHERE tenant_id=$1 AND event_id=$2`, [tid, eventId]);
    res.json({ event: event.rows[0], stats: attendees.rows[0] });
  }));

  // =============================================
  // FEATURE 2: FUNDRAISING GALA MANAGEMENT
  // =============================================
  app.get('/api/galas', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fundraising_galas WHERE tenant_id=$1 ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 50`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/galas', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, date, venue, address, capacity, ticket_price, table_price, tables_available } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO fundraising_galas (tenant_id, name, description, date, venue, address, capacity, ticket_price, table_price, tables_available) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [tid, esc(name), esc(description||''), date||null, esc(venue||''), esc(address||''), capacity||0, ticket_price||0, table_price||0, tables_available||0]);
    await audit(req, 'create', 'fundraising_galas', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/galas/:id', requireAuth, ah(async (req, res) => {
    const { name, description, date, venue, address, capacity, ticket_price, table_price, tables_available, status } = req.body;
    const r = await pool.query(`UPDATE fundraising_galas SET name=COALESCE($1,name), description=COALESCE($2,description), date=COALESCE($3,date), venue=COALESCE($4,venue), address=COALESCE($5,address), capacity=COALESCE($6,capacity), ticket_price=COALESCE($7,ticket_price), table_price=COALESCE($8,table_price), tables_available=COALESCE($9,tables_available), status=COALESCE($10,status) WHERE tenant_id=$11 AND id=$12 RETURNING *`, [name?esc(name):null, description?esc(description):null, date, venue?esc(venue):null, address?esc(address):null, capacity, ticket_price, table_price, tables_available, status, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gala not found' });
    await audit(req, 'update', 'fundraising_galas', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/galas/:id/tables', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT gt.*, (SELECT COUNT(*) FROM gala_seats WHERE table_id=gt.id) as seats_count, (SELECT COUNT(*) FROM gala_seats WHERE table_id=gt.id AND is_confirmed=true) as confirmed_count FROM gala_tables gt WHERE gt.tenant_id=$1 AND gt.gala_id=$2 ORDER BY gt.table_number`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/galas/:id/tables', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const galaId = req.params.id;
    const { table_number, table_name, capacity, sponsor_name, price, is_sold, sold_to } = req.body;
    if (!table_number) return res.status(400).json({ error: 'table_number required' });
    const r = await pool.query(`INSERT INTO gala_tables (tenant_id, gala_id, table_number, table_name, capacity, sponsor_name, price, is_sold, sold_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [tid, galaId, esc(table_number), esc(table_name||''), capacity||10, esc(sponsor_name||''), price||0, is_sold||false, esc(sold_to||'')]);
    if (is_sold) { await pool.query(`UPDATE fundraising_galas SET tables_sold=tables_sold+1 WHERE id=$1`, [galaId]); }
    await audit(req, 'create', 'gala_tables', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/galas/:id/tables/:tableId', requireAuth, ah(async (req, res) => {
    const { table_name, capacity, sponsor_name, price, is_sold, sold_to } = req.body;
    const r = await pool.query(`UPDATE gala_tables SET table_name=COALESCE($1,table_name), capacity=COALESCE($2,capacity), sponsor_name=COALESCE($3,sponsor_name), price=COALESCE($4,price), is_sold=COALESCE($5,is_sold), sold_to=COALESCE($6,sold_to) WHERE tenant_id=$7 AND id=$8 RETURNING *`, [table_name?esc(table_name):null, capacity, sponsor_name?esc(sponsor_name):null, price, is_sold, sold_to?esc(sold_to):null, req.session.user.tenant_id, req.params.tableId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Table not found' });
    await audit(req, 'update', 'gala_tables', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/galas/:id/tables/:tableId/seats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM gala_seats WHERE tenant_id=$1 AND table_id=$2 ORDER BY seat_number`, [req.session.user.tenant_id, req.params.tableId]);
    res.json(r.rows);
  }));

  app.post('/api/galas/:id/tables/:tableId/seats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { seat_number, guest_name, guest_email, guest_phone, dietary_notes, is_confirmed } = req.body;
    if (!seat_number) return res.status(400).json({ error: 'seat_number required' });
    const r = await pool.query(`INSERT INTO gala_seats (tenant_id, table_id, seat_number, guest_name, guest_email, guest_phone, dietary_notes, is_confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [tid, req.params.tableId, esc(seat_number), esc(guest_name||''), esc(guest_email||''), esc(guest_phone||''), esc(dietary_notes||''), is_confirmed||false]);
    await audit(req, 'create', 'gala_seats', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/galas/:id/seats/:seatId', requireAuth, ah(async (req, res) => {
    const { guest_name, guest_email, guest_phone, dietary_notes, is_confirmed } = req.body;
    const r = await pool.query(`UPDATE gala_seats SET guest_name=COALESCE($1,guest_name), guest_email=COALESCE($2,guest_email), guest_phone=COALESCE($3,guest_phone), dietary_notes=COALESCE($4,dietary_notes), is_confirmed=COALESCE($5,is_confirmed) WHERE tenant_id=$6 AND id=$7 RETURNING *`, [guest_name?esc(guest_name):null, guest_email?esc(guest_email):null, guest_phone?esc(guest_phone):null, dietary_notes?esc(dietary_notes):null, is_confirmed, req.session.user.tenant_id, req.params.seatId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Seat not found' });
    await audit(req, 'update', 'gala_seats', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/galas/:id/paddle-raise', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const galaId = req.params.id;
    const { donor_name, amount } = req.body;
    if (!donor_name || !amount) return res.status(400).json({ error: 'donor_name and amount required' });
    const gala = await pool.query(`SELECT * FROM fundraising_galas WHERE tenant_id=$1 AND id=$2`, [tid, galaId]);
    if (!gala.rows.length) return res.status(404).json({ error: 'Gala not found' });
    await pool.query(`UPDATE fundraising_galas SET paddle_raise_total=paddle_raise_total+$1, total_raised=total_raised+$1 WHERE id=$2`, [amount, galaId]);
    await audit(req, 'paddle_raise', 'fundraising_galas', galaId);
    const updated = await pool.query(`SELECT * FROM fundraising_galas WHERE id=$1`, [galaId]);
    res.json({ ok: true, donor: donor_name, amount, gala: updated.rows[0] });
  }));

  app.get('/api/galas/:id/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const galaId = req.params.id;
    const gala = await pool.query(`SELECT * FROM fundraising_galas WHERE tenant_id=$1 AND id=$2`, [tid, galaId]);
    if (!gala.rows.length) return res.status(404).json({ error: 'Gala not found' });
    const tables = await pool.query(`SELECT COUNT(*) as total_tables, COUNT(CASE WHEN is_sold THEN 1 END) as sold_tables, SUM(CASE WHEN is_sold THEN price ELSE 0 END) as table_revenue FROM gala_tables WHERE tenant_id=$1 AND gala_id=$2`, [tid, galaId]);
    const seats = await pool.query(`SELECT COUNT(*) as total_seats, COUNT(CASE WHEN is_confirmed THEN 1 END) as confirmed_seats FROM gala_seats gs JOIN gala_tables gt ON gs.table_id=gt.id WHERE gt.tenant_id=$1 AND gt.gala_id=$2`, [tid, galaId]);
    res.json({ gala: gala.rows[0], tables: tables.rows[0], seats: seats.rows[0] });
  }));

  // =============================================
  // FEATURE 3: WEALTH SCREENING
  // =============================================
  app.get('/api/wealth-screening/indicators', requireAuth, ah(async (req, res) => {
    const { min_capacity } = req.query;
    let q = `SELECT * FROM donor_wealth_indicators WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (min_capacity) { q += ` AND giving_capacity >= $2`; params.push(min_capacity); }
    q += ` ORDER BY giving_capacity DESC NULLS LAST LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.get('/api/wealth-screening/indicators/:email', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_wealth_indicators WHERE tenant_id=$1 AND donor_email=$2`, [req.session.user.tenant_id, esc(req.params.email)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Donor not found in wealth indicators' });
    res.json(r.rows[0]);
  }));

  app.post('/api/wealth-screening/run', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Aggregate existing indicators to produce screening results
    const stats = await pool.query(`SELECT COUNT(*) as total_screened, COUNT(CASE WHEN giving_capacity >= 50000000 THEN 1 END) as high_capacity_count, COUNT(CASE WHEN giving_capacity >= 10000000 AND giving_capacity < 50000000 THEN 1 END) as mid_capacity_count, AVG(giving_capacity) as avg_capacity FROM donor_wealth_indicators WHERE tenant_id=$1`, [tid]);
    const topProspects = await pool.query(`SELECT donor_email, donor_name, giving_capacity, philanthropy_score, estimated_net_worth FROM donor_wealth_indicators WHERE tenant_id=$1 ORDER BY giving_capacity DESC NULLS LAST LIMIT 10`, [tid]);
    const r = await pool.query(`INSERT INTO wealth_screening_results (tenant_id, total_screened, high_capacity_count, mid_capacity_count, avg_capacity, top_prospects_json) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, stats.rows[0].total_screened||0, stats.rows[0].high_capacity_count||0, stats.rows[0].mid_capacity_count||0, stats.rows[0].avg_capacity||0, JSON.stringify(topProspects.rows)]);
    await audit(req, 'run_screening', 'wealth_screening_results', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/wealth-screening/results', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM wealth_screening_results WHERE tenant_id=$1 ORDER BY screening_date DESC LIMIT 20`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/wealth-screening/top-prospects', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT donor_email, donor_name, giving_capacity, estimated_net_worth, philanthropy_score, income_estimate FROM donor_wealth_indicators WHERE tenant_id=$1 AND giving_capacity > 0 ORDER BY giving_capacity DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/wealth-screening/capacity-distribution', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT CASE WHEN giving_capacity < 1000000 THEN 'Under 1M' WHEN giving_capacity < 5000000 THEN '1M-5M' WHEN giving_capacity < 10000000 THEN '5M-10M' WHEN giving_capacity < 50000000 THEN '10M-50M' ELSE '50M+' END as capacity_range, COUNT(*) as count, AVG(giving_capacity) as avg_capacity FROM donor_wealth_indicators WHERE tenant_id=$1 GROUP BY capacity_range ORDER BY MIN(giving_capacity)`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 4: GRANT WRITING ASSISTANT
  // =============================================
  app.get('/api/grant-templates', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM grant_writing_templates WHERE tenant_id=$1 AND is_active=true ORDER BY category, name`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/grant-templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, funder_name, category, sections, word_limit, deadline_typical, tips } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO grant_writing_templates (tenant_id, name, funder_name, category, sections_json, word_limit, deadline_typical, tips) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [tid, esc(name), esc(funder_name||''), esc(category||''), JSON.stringify(sections||[]), word_limit||5000, esc(deadline_typical||''), esc(tips||'')]);
    await audit(req, 'create', 'grant_writing_templates', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/grant-templates/:id', requireAuth, ah(async (req, res) => {
    const { name, funder_name, category, sections, word_limit, deadline_typical, tips, is_active } = req.body;
    const r = await pool.query(`UPDATE grant_writing_templates SET name=COALESCE($1,name), funder_name=COALESCE($2,funder_name), category=COALESCE($3,category), sections_json=COALESCE($4,sections_json), word_limit=COALESCE($5,word_limit), deadline_typical=COALESCE($6,deadline_typical), tips=COALESCE($7,tips), is_active=COALESCE($8,is_active) WHERE tenant_id=$9 AND id=$10 RETURNING *`, [name?esc(name):null, funder_name?esc(funder_name):null, category?esc(category):null, sections?JSON.stringify(sections):null, word_limit, deadline_typical?esc(deadline_typical):null, tips?esc(tips):null, is_active, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await audit(req, 'update', 'grant_writing_templates', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/grant-templates/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE grant_writing_templates SET is_active=false WHERE tenant_id=$1 AND id=$2 RETURNING id`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Template not found' });
    await audit(req, 'delete', 'grant_writing_templates', req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/grant-proposals', requireAuth, ah(async (req, res) => {
    const { status, template_id } = req.query;
    let q = `SELECT gp.*, gwt.name as template_name FROM grant_proposals gp LEFT JOIN grant_writing_templates gwt ON gp.template_id=gwt.id WHERE gp.tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ` AND gp.status=$${idx++}`; params.push(status); }
    if (template_id) { q += ` AND gp.template_id=$${idx++}`; params.push(template_id); }
    q += ` ORDER BY gp.created_at DESC LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/grant-proposals', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { template_id, title, funder_name, amount_requested, project_description, budget, timeline, deadline } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(`INSERT INTO grant_proposals (tenant_id, template_id, title, funder_name, amount_requested, project_description, budget_json, timeline_json, deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [tid, template_id||null, esc(title), esc(funder_name||''), amount_requested||0, esc(project_description||''), JSON.stringify(budget||{}), JSON.stringify(timeline||[]), deadline||null]);
    await audit(req, 'create', 'grant_proposals', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/grant-proposals/:id', requireAuth, ah(async (req, res) => {
    const { title, funder_name, amount_requested, project_description, budget, timeline, status, deadline, outcome } = req.body;
    const r = await pool.query(`UPDATE grant_proposals SET title=COALESCE($1,title), funder_name=COALESCE($2,funder_name), amount_requested=COALESCE($3,amount_requested), project_description=COALESCE($4,project_description), budget_json=COALESCE($5,budget_json), timeline_json=COALESCE($6,timeline_json), status=COALESCE($7,status), deadline=COALESCE($8,deadline), outcome=COALESCE($9,outcome) WHERE tenant_id=$10 AND id=$11 RETURNING *`, [title?esc(title):null, funder_name?esc(funder_name):null, amount_requested, project_description?esc(project_description):null, budget?JSON.stringify(budget):null, timeline?JSON.stringify(timeline):null, status, deadline, outcome?esc(outcome):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Proposal not found' });
    await audit(req, 'update', 'grant_proposals', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/grant-proposals/:id/generate-section', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const proposalId = req.params.id;
    const { section_name, context } = req.body;
    if (!section_name) return res.status(400).json({ error: 'section_name required' });
    const proposal = await pool.query(`SELECT gp.*, gwt.sections_json, gwt.tips FROM grant_proposals gp LEFT JOIN grant_writing_templates gwt ON gp.template_id=gwt.id WHERE gp.tenant_id=$1 AND gp.id=$2`, [tid, proposalId]);
    if (!proposal.rows.length) return res.status(404).json({ error: 'Proposal not found' });
    const tips = proposal.rows[0].tips || '';
    const desc = proposal.rows[0].project_description || '';
    // Generate a structured section draft based on template and context
    const generated = {
      section: section_name,
      content: `[AI-Generated Draft for "${section_name}"]\n\nProject: ${desc.substring(0, 200)}${desc.length > 200 ? '...' : ''}\n\nTips: ${tips.substring(0, 300)}${tips.length > 300 ? '...' : ''}\n\nContext provided: ${context || 'None'}\n\nPlease review and customize this section based on your organization's specific needs and the funder's requirements.`,
      word_count: 0,
      generated_at: new Date().toISOString()
    };
    generated.word_count = generated.content.split(/\s+/).length;
    await audit(req, 'generate_section', 'grant_proposals', proposalId);
    res.json(generated);
  }));

  app.post('/api/grant-proposals/:id/submit', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE grant_proposals SET status='submitted', submitted_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status IN ('draft','in_progress','review') RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Proposal not found or cannot be submitted' });
    await audit(req, 'submit', 'grant_proposals', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/grant-proposals/:id/budget', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT id, title, amount_requested, budget_json FROM grant_proposals WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ proposal_id: r.rows[0].id, title: r.rows[0].title, amount_requested: r.rows[0].amount_requested, budget: JSON.parse(r.rows[0].budget_json || '{}') });
  }));

  // =============================================
  // FEATURE 5: DONOR TAX STATEMENT GENERATOR
  // =============================================
  app.get('/api/tax-statements', requireAuth, ah(async (req, res) => {
    const { tax_year, donor_email } = req.query;
    let q = `SELECT * FROM donor_tax_statements WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (tax_year) { q += ` AND tax_year=$${idx++}`; params.push(tax_year); }
    if (donor_email) { q += ` AND donor_email=$${idx++}`; params.push(esc(donor_email)); }
    q += ` ORDER BY tax_year DESC, donor_name LIMIT 100`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/tax-statements/generate/:donorEmail', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const donorEmail = esc(req.params.donorEmail);
    const { tax_year, donor_name, donor_address } = req.body;
    const year = tax_year || new Date().getFullYear() - 1;
    // Aggregate donations from the donations table if available
    const donationStats = await pool.query(`SELECT COALESCE(SUM(amount),0) as total_donations, COALESCE(SUM(CASE WHEN is_deductible IS NOT FALSE THEN amount ELSE 0 END),0) as total_deductible, COALESCE(SUM(CASE WHEN is_deductible IS FALSE THEN amount ELSE 0 END),0) as non_deductible FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND EXTRACT(YEAR FROM created_at)=$3`, [tid, donorEmail, year]).catch(() => ({ rows: [{ total_donations: 0, total_deductible: 0, non_deductible: 0 }] }));
    const totalDonations = donationStats.rows[0].total_donations || 0;
    const totalDeductible = donationStats.rows[0].total_deductible || totalDonations;
    const nonDeductible = donationStats.rows[0].non_deductible || 0;
    const stmtNum = `TXS-${year}-${Date.now().toString(36).toUpperCase()}`;
    const r = await pool.query(`INSERT INTO donor_tax_statements (tenant_id, donor_name, donor_email, donor_address, tax_year, total_donations, total_deductible, non_deductible, statement_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [tid, esc(donor_name||''), donorEmail, esc(donor_address||''), year, totalDonations, totalDeductible, nonDeductible, stmtNum]);
    await audit(req, 'generate', 'donor_tax_statements', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/tax-statements/generate-batch', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { tax_year } = req.body;
    const year = tax_year || new Date().getFullYear() - 1;
    // Create a batch record
    const batch = await pool.query(`INSERT INTO tax_statement_batches (tenant_id, tax_year, status, started_at) VALUES ($1,$2,'processing',NOW()) RETURNING *`, [tid, year]);
    // Get distinct donors
    const donors = await pool.query(`SELECT DISTINCT donor_email, COALESCE(donor_name, donor_email) as donor_name FROM donations WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`, [tid, year]).catch(() => ({ rows: [] }));
    let totalStatements = 0;
    let totalAmount = 0;
    for (const d of donors.rows) {
      const donationStats = await pool.query(`SELECT COALESCE(SUM(amount),0) as total_donations, COALESCE(SUM(CASE WHEN is_deductible IS NOT FALSE THEN amount ELSE 0 END),0) as total_deductible FROM donations WHERE tenant_id=$1 AND donor_email=$2 AND EXTRACT(YEAR FROM created_at)=$3`, [tid, d.donor_email, year]).catch(() => ({ rows: [{ total_donations: 0, total_deductible: 0 }] }));
      const total = donationStats.rows[0].total_donations || 0;
      const deductible = donationStats.rows[0].total_deductible || total;
      if (total > 0) {
        const stmtNum = `TXS-${year}-${Date.now().toString(36).toUpperCase()}-${totalStatements}`;
        await pool.query(`INSERT INTO donor_tax_statements (tenant_id, donor_name, donor_email, tax_year, total_donations, total_deductible, non_deductible, statement_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tid, esc(d.donor_name), esc(d.donor_email), year, total, deductible, total - deductible, stmtNum]);
        totalStatements++;
        totalAmount += parseFloat(total);
      }
    }
    await pool.query(`UPDATE tax_statement_batches SET total_statements=$1, total_amount=$2, status='completed', completed_at=NOW() WHERE id=$3`, [totalStatements, totalAmount, batch.rows[0].id]);
    await audit(req, 'generate_batch', 'tax_statement_batches', batch.rows[0].id);
    res.json({ batch_id: batch.rows[0].id, total_statements: totalStatements, total_amount: totalAmount, tax_year: year });
  }));

  app.get('/api/tax-statements/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_tax_statements WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Tax statement not found' });
    res.json(r.rows[0]);
  }));

  app.post('/api/tax-statements/:id/send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stmt = await pool.query(`SELECT * FROM donor_tax_statements WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!stmt.rows.length) return res.status(404).json({ error: 'Tax statement not found' });
    const s = stmt.rows[0];
    try {
      await sendEmail(s.donor_email, `Tax Statement - ${s.tax_year}`, `Dear ${s.donor_name},\n\nYour tax statement for ${s.tax_year} is ready.\nTotal Donations: UGX ${Number(s.total_donations).toLocaleString()}\nDeductible Amount: UGX ${Number(s.total_deductible).toLocaleString()}\nStatement Number: ${s.statement_number}\n\nThank you for your generous support!`);
    } catch(e) {}
    await pool.query(`UPDATE donor_tax_statements SET sent_at=NOW() WHERE id=$1`, [req.params.id]);
    await audit(req, 'send', 'donor_tax_statements', req.params.id);
    res.json({ ok: true, message: 'Tax statement sent via email' });
  }));

  app.get('/api/tax-statements/batch/:batchId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM tax_statement_batches WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.batchId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Batch not found' });
    const statements = await pool.query(`SELECT * FROM donor_tax_statements WHERE tenant_id=$1 AND tax_year=$2 ORDER BY donor_name`, [req.session.user.tenant_id, r.rows[0].tax_year]);
    res.json({ batch: r.rows[0], statements: statements.rows });
  }));

  app.get('/api/tax-statements/summary/:year', requireAuth, ah(async (req, res) => {
    const year = parseInt(req.params.year);
    const r = await pool.query(`SELECT COUNT(*) as total_statements, SUM(total_donations) as total_amount, SUM(total_deductible) as total_deductible, AVG(total_donations) as avg_donation FROM donor_tax_statements WHERE tenant_id=$1 AND tax_year=$2`, [req.session.user.tenant_id, year]);
    const byMonth = await pool.query(`SELECT EXTRACT(MONTH FROM generated_at) as month, COUNT(*) as count, SUM(total_donations) as amount FROM donor_tax_statements WHERE tenant_id=$1 AND tax_year=$2 GROUP BY month ORDER BY month`, [req.session.user.tenant_id, year]);
    res.json({ summary: r.rows[0], by_month: byMonth.rows, tax_year: year });
  }));

  // =============================================
  // FEATURE 6: GIVING DAY MANAGEMENT
  // =============================================
  app.get('/api/giving-days', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM giving_days WHERE tenant_id=$1 ORDER BY date DESC NULLS LAST, created_at DESC LIMIT 50`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/giving-days', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, date, goal_amount, matching_pool } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO giving_days (tenant_id, name, description, date, goal_amount, matching_pool) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(name), esc(description||''), date||null, goal_amount||0, matching_pool||0]);
    await audit(req, 'create', 'giving_days', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/giving-days/:id', requireAuth, ah(async (req, res) => {
    const { name, description, date, goal_amount, matching_pool, status } = req.body;
    const r = await pool.query(`UPDATE giving_days SET name=COALESCE($1,name), description=COALESCE($2,description), date=COALESCE($3,date), goal_amount=COALESCE($4,goal_amount), matching_pool=COALESCE($5,matching_pool), status=COALESCE($6,status) WHERE tenant_id=$7 AND id=$8 RETURNING *`, [name?esc(name):null, description?esc(description):null, date, goal_amount, matching_pool, status, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Giving day not found' });
    await audit(req, 'update', 'giving_days', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/giving-days/:id/challenges', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM giving_day_challenges WHERE tenant_id=$1 AND giving_day_id=$2 ORDER BY created_at`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/giving-days/:id/challenges', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { challenge_type, description, threshold, bonus_amount } = req.body;
    if (!challenge_type) return res.status(400).json({ error: 'challenge_type required' });
    const r = await pool.query(`INSERT INTO giving_day_challenges (tenant_id, giving_day_id, challenge_type, description, threshold, bonus_amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, req.params.id, challenge_type, esc(description||''), threshold||0, bonus_amount||0]);
    await audit(req, 'create', 'giving_day_challenges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/giving-days/:id/challenges/:challengeId', requireAuth, ah(async (req, res) => {
    const { description, threshold, bonus_amount, current_progress, is_achieved } = req.body;
    const r = await pool.query(`UPDATE giving_day_challenges SET description=COALESCE($1,description), threshold=COALESCE($2,threshold), bonus_amount=COALESCE($3,bonus_amount), current_progress=COALESCE($4,current_progress), is_achieved=COALESCE($5,is_achieved) WHERE tenant_id=$6 AND id=$7 RETURNING *`, [description?esc(description):null, threshold, bonus_amount, current_progress, is_achieved, req.session.user.tenant_id, req.params.challengeId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Challenge not found' });
    await audit(req, 'update', 'giving_day_challenges', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/giving-days/:id/donate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const gdId = req.params.id;
    const { donor_name, amount, is_anonymous } = req.body;
    if (!donor_name || !amount) return res.status(400).json({ error: 'donor_name and amount required' });
    const gd = await pool.query(`SELECT * FROM giving_days WHERE tenant_id=$1 AND id=$2`, [tid, gdId]);
    if (!gd.rows.length) return res.status(404).json({ error: 'Giving day not found' });
    if (gd.rows[0].status === 'cancelled') return res.status(400).json({ error: 'Giving day is cancelled' });
    await pool.query(`UPDATE giving_days SET total_raised=total_raised+$1, donor_count=donor_count+1, gift_count=gift_count+1 WHERE id=$2`, [amount, gdId]);
    // Check challenges
    const challenges = await pool.query(`SELECT * FROM giving_day_challenges WHERE tenant_id=$1 AND giving_day_id=$2 AND is_achieved=false`, [tid, gdId]);
    for (const ch of challenges.rows) {
      const newProgress = parseFloat(ch.current_progress) + parseFloat(amount);
      const achieved = newProgress >= parseFloat(ch.threshold);
      await pool.query(`UPDATE giving_day_challenges SET current_progress=$1, is_achieved=$2 WHERE id=$3`, [newProgress, achieved, ch.id]);
      if (achieved) {
        await pool.query(`UPDATE giving_days SET total_raised=total_raised+$1 WHERE id=$2`, [ch.bonus_amount, gdId]);
      }
    }
    // Update leaderboard
    const displayName = is_anonymous ? 'Anonymous' : donor_name;
    const existingEntry = await pool.query(`SELECT * FROM giving_day_leaderboards WHERE tenant_id=$1 AND giving_day_id=$2 AND donor_name=$3`, [tid, gdId, esc(displayName)]);
    if (existingEntry.rows.length) {
      await pool.query(`UPDATE giving_day_leaderboards SET amount=amount+$1 WHERE id=$2`, [amount, existingEntry.rows[0].id]);
    } else {
      await pool.query(`INSERT INTO giving_day_leaderboards (tenant_id, giving_day_id, donor_name, amount) VALUES ($1,$2,$3,$4)`, [tid, gdId, esc(displayName), amount]);
    }
    // Re-rank leaderboard
    await pool.query(`WITH ranked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY amount DESC) as rnk FROM giving_day_leaderboards WHERE tenant_id=$1 AND giving_day_id=$2) UPDATE giving_day_leaderboards SET rank=ranked.rnk FROM ranked WHERE giving_day_leaderboards.id=ranked.id`, [tid, gdId]);
    await audit(req, 'donate', 'giving_days', gdId);
    const updated = await pool.query(`SELECT * FROM giving_days WHERE id=$1`, [gdId]);
    res.json({ ok: true, giving_day: updated.rows[0] });
  }));

  app.get('/api/giving-days/:id/leaderboard', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM giving_day_leaderboards WHERE tenant_id=$1 AND giving_day_id=$2 ORDER BY rank NULLS LAST, amount DESC LIMIT 25`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.get('/api/giving-days/:id/live-stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const gdId = req.params.id;
    const gd = await pool.query(`SELECT * FROM giving_days WHERE tenant_id=$1 AND id=$2`, [tid, gdId]);
    if (!gd.rows.length) return res.status(404).json({ error: 'Giving day not found' });
    const challenges = await pool.query(`SELECT * FROM giving_day_challenges WHERE tenant_id=$1 AND giving_day_id=$2`, [tid, gdId]);
    const topDonors = await pool.query(`SELECT donor_name, amount FROM giving_day_leaderboards WHERE tenant_id=$1 AND giving_day_id=$2 ORDER BY amount DESC LIMIT 5`, [tid, gdId]);
    const progressPct = gd.rows[0].goal_amount > 0 ? Math.min(100, (parseFloat(gd.rows[0].total_raised) / parseFloat(gd.rows[0].goal_amount)) * 100) : 0;
    res.json({
      giving_day: gd.rows[0],
      progress_percentage: Math.round(progressPct * 100) / 100,
      challenges: challenges.rows,
      top_donors: topDonors.rows,
      live_at: new Date().toISOString()
    });
  }));

  // =============================================
  // FEATURE 7: INSTALLMENT / PAYMENT PLANS
  // =============================================
  app.get('/api/installment-plans', requireAuth, ah(async (req, res) => {
    const { status, donor_email } = req.query;
    let q = `SELECT * FROM installment_plans WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ` AND status=$${idx++}`; params.push(status); }
    if (donor_email) { q += ` AND donor_email=$${idx++}`; params.push(esc(donor_email)); }
    q += ` ORDER BY created_at DESC LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/installment-plans', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, donor_name, donor_email, total_amount, down_payment, installment_amount, frequency, total_installments } = req.body;
    if (!donor_name || !donor_email || !total_amount) return res.status(400).json({ error: 'donor_name, donor_email, and total_amount required' });
    const dp = down_payment || 0;
    const remaining = parseFloat(total_amount) - parseFloat(dp);
    const instAmt = installment_amount || (total_installments ? remaining / total_installments : remaining);
    const totalInst = total_installments || Math.ceil(remaining / instAmt);
    const freq = frequency || 'monthly';
    // Calculate first payment date
    const nextDate = new Date();
    if (freq === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (freq === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
    else if (freq === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else if (freq === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);

    const r = await pool.query(`INSERT INTO installment_plans (tenant_id, campaign_id, donor_name, donor_email, total_amount, down_payment, installment_amount, frequency, total_installments, paid_installments, next_payment_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active') RETURNING *`, [tid, campaign_id||null, esc(donor_name), esc(donor_email), total_amount, dp, instAmt, freq, totalInst, dp > 0 ? 1 : 0, nextDate.toISOString().split('T')[0]]);
    const plan = r.rows[0];
    // Generate installment payment schedule
    for (let i = 1; i <= totalInst; i++) {
      let dueDate = new Date(nextDate);
      if (freq === 'weekly') dueDate.setDate(dueDate.getDate() + (i - 1) * 7);
      else if (freq === 'biweekly') dueDate.setDate(dueDate.getDate() + (i - 1) * 14);
      else if (freq === 'monthly') dueDate.setMonth(dueDate.getMonth() + (i - 1));
      else if (freq === 'quarterly') dueDate.setMonth(dueDate.getMonth() + (i - 1) * 3);
      await pool.query(`INSERT INTO installment_payments (tenant_id, plan_id, installment_number, amount_due, due_date, status) VALUES ($1,$2,$3,$4,$5,'pending')`, [tid, plan.id, i, instAmt, dueDate.toISOString().split('T')[0]]);
    }
    await audit(req, 'create', 'installment_plans', plan.id);
    res.json(plan);
  }));

  app.put('/api/installment-plans/:id', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, total_amount, installment_amount, frequency, next_payment_date } = req.body;
    const r = await pool.query(`UPDATE installment_plans SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), total_amount=COALESCE($3,total_amount), installment_amount=COALESCE($4,installment_amount), frequency=COALESCE($5,frequency), next_payment_date=COALESCE($6,next_payment_date) WHERE tenant_id=$7 AND id=$8 RETURNING *`, [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, total_amount, installment_amount, frequency, next_payment_date, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Plan not found' });
    await audit(req, 'update', 'installment_plans', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/installment-plans/:id/payments', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM installment_payments WHERE tenant_id=$1 AND plan_id=$2 ORDER BY installment_number`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/installment-plans/:id/pay', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const planId = req.params.id;
    const { installment_number, amount_paid } = req.body;
    const plan = await pool.query(`SELECT * FROM installment_plans WHERE tenant_id=$1 AND id=$2`, [tid, planId]);
    if (!plan.rows.length) return res.status(404).json({ error: 'Plan not found' });
    if (plan.rows[0].status !== 'active') return res.status(400).json({ error: 'Plan is not active' });
    // Find the next pending installment
    let payQuery;
    if (installment_number) {
      payQuery = await pool.query(`SELECT * FROM installment_payments WHERE tenant_id=$1 AND plan_id=$2 AND installment_number=$3 AND status='pending'`, [tid, planId, installment_number]);
    } else {
      payQuery = await pool.query(`SELECT * FROM installment_payments WHERE tenant_id=$1 AND plan_id=$2 AND status='pending' ORDER BY installment_number LIMIT 1`, [tid, planId]);
    }
    if (!payQuery.rows.length) return res.status(400).json({ error: 'No pending installments found' });
    const payment = payQuery.rows[0];
    const paid = amount_paid || payment.amount_due;
    const r = await pool.query(`UPDATE installment_payments SET amount_paid=$1, paid_date=CURRENT_DATE, status='paid' WHERE id=$2 RETURNING *`, [paid, payment.id]);
    // Update plan
    const newPaidCount = plan.rows[0].paid_installments + 1;
    const isCompleted = newPaidCount >= plan.rows[0].total_installments;
    // Calculate next payment date
    const nextPayment = await pool.query(`SELECT * FROM installment_payments WHERE tenant_id=$1 AND plan_id=$2 AND status='pending' ORDER BY installment_number LIMIT 1`, [tid, planId]);
    await pool.query(`UPDATE installment_plans SET paid_installments=$1, next_payment_date=$2, status=$3 WHERE id=$4`, [newPaidCount, nextPayment.rows.length ? nextPayment.rows[0].due_date : null, isCompleted ? 'completed' : 'active', planId]);
    await audit(req, 'pay', 'installment_plans', planId);
    res.json({ payment: r.rows[0], plan_completed: isCompleted });
  }));

  app.post('/api/installment-plans/:id/pause', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE installment_plans SET status='paused' WHERE tenant_id=$1 AND id=$2 AND status='active' RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Plan not found or not active' });
    await audit(req, 'pause', 'installment_plans', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/installment-plans/:id/resume', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE installment_plans SET status='active' WHERE tenant_id=$1 AND id=$2 AND status='paused' RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Plan not found or not paused' });
    await audit(req, 'resume', 'installment_plans', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/installment-plans/:id/cancel', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE installment_plans SET status='cancelled' WHERE tenant_id=$1 AND id=$2 AND status IN ('active','paused') RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Plan not found or cannot be cancelled' });
    // Cancel pending installments
    await pool.query(`UPDATE installment_payments SET status='cancelled' WHERE plan_id=$1 AND status='pending'`, [req.params.id]);
    await audit(req, 'cancel', 'installment_plans', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/installment-plans/overdue', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Mark overdue installments
    await pool.query(`UPDATE installment_payments SET status='overdue' WHERE tenant_id=$1 AND status='pending' AND due_date < CURRENT_DATE`, [tid]);
    const r = await pool.query(`SELECT ip.*, ip2.donor_name, ip2.donor_email, ip2.total_amount, ip2.frequency FROM installment_payments ip JOIN installment_plans ip2 ON ip.plan_id=ip2.id WHERE ip.tenant_id=$1 AND ip.status='overdue' ORDER BY ip.due_date ASC LIMIT 50`, [tid]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 8: DONOR ENGAGEMENT SCORING
  // =============================================
  app.get('/api/engagement-scores', requireAuth, ah(async (req, res) => {
    const { min_score, sort_by } = req.query;
    let q = `SELECT * FROM donor_engagement_scores WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (min_score) { q += ` AND engagement_score >= $2`; params.push(min_score); }
    const sortCol = sort_by === 'giving_score' ? 'giving_score' : sort_by === 'event_score' ? 'event_score' : sort_by === 'volunteer_score' ? 'volunteer_score' : 'engagement_score';
    q += ` ORDER BY ${sortCol} DESC NULLS LAST LIMIT 50`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.get('/api/engagement-scores/:email', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_engagement_scores WHERE tenant_id=$1 AND donor_email=$2`, [req.session.user.tenant_id, esc(req.params.email)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Donor engagement score not found' });
    const activities = await pool.query(`SELECT * FROM engagement_activities WHERE tenant_id=$1 AND donor_email=$2 ORDER BY recorded_at DESC LIMIT 20`, [req.session.user.tenant_id, esc(req.params.email)]);
    res.json({ score: r.rows[0], recent_activities: activities.rows });
  }));

  app.post('/api/engagement-scores/calculate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Get all donors with activities
    const donors = await pool.query(`SELECT DISTINCT donor_email FROM engagement_activities WHERE tenant_id=$1`, [tid]);
    let calculated = 0;
    for (const d of donors.rows) {
      const scores = await pool.query(`SELECT COALESCE(SUM(CASE WHEN activity_type='donation' THEN points ELSE 0 END),0) as giving_score, COALESCE(SUM(CASE WHEN activity_type='event_attendance' THEN points ELSE 0 END),0) as event_score, COALESCE(SUM(CASE WHEN activity_type='volunteer' THEN points ELSE 0 END),0) as volunteer_score, COALESCE(SUM(CASE WHEN activity_type='advocacy' THEN points ELSE 0 END),0) as advocacy_score, COALESCE(SUM(CASE WHEN activity_type IN ('email_open','email_click','social_share') THEN points ELSE 0 END),0) as communication_score FROM engagement_activities WHERE tenant_id=$1 AND donor_email=$2`, [tid, d.donor_email]);
      const s = scores.rows[0];
      const totalScore = parseInt(s.giving_score) + parseInt(s.event_score) + parseInt(s.volunteer_score) + parseInt(s.advocacy_score) + parseInt(s.communication_score);
      const name = await pool.query(`SELECT donor_name FROM donor_engagement_scores WHERE tenant_id=$1 AND donor_email=$2`, [tid, d.donor_email]);
      await pool.query(`INSERT INTO donor_engagement_scores (tenant_id, donor_email, donor_name, engagement_score, giving_score, event_score, volunteer_score, advocacy_score, communication_score, last_calculated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (tenant_id, donor_email) DO UPDATE SET engagement_score=$4, giving_score=$5, event_score=$6, volunteer_score=$7, advocacy_score=$8, communication_score=$9, last_calculated=NOW()`, [tid, d.donor_email, name.rows.length ? name.rows[0].donor_name : d.donor_email.split('@')[0], totalScore, s.giving_score, s.event_score, s.volunteer_score, s.advocacy_score, s.communication_score]);
      calculated++;
    }
    await audit(req, 'calculate_all', 'donor_engagement_scores', 0);
    res.json({ ok: true, donors_calculated: calculated });
  }));

  app.post('/api/engagement-scores/calculate/:email', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const email = esc(req.params.email);
    const scores = await pool.query(`SELECT COALESCE(SUM(CASE WHEN activity_type='donation' THEN points ELSE 0 END),0) as giving_score, COALESCE(SUM(CASE WHEN activity_type='event_attendance' THEN points ELSE 0 END),0) as event_score, COALESCE(SUM(CASE WHEN activity_type='volunteer' THEN points ELSE 0 END),0) as volunteer_score, COALESCE(SUM(CASE WHEN activity_type='advocacy' THEN points ELSE 0 END),0) as advocacy_score, COALESCE(SUM(CASE WHEN activity_type IN ('email_open','email_click','social_share') THEN points ELSE 0 END),0) as communication_score FROM engagement_activities WHERE tenant_id=$1 AND donor_email=$2`, [tid, email]);
    const s = scores.rows[0];
    const totalScore = parseInt(s.giving_score) + parseInt(s.event_score) + parseInt(s.volunteer_score) + parseInt(s.advocacy_score) + parseInt(s.communication_score);
    const existing = await pool.query(`SELECT donor_name FROM donor_engagement_scores WHERE tenant_id=$1 AND donor_email=$2`, [tid, email]);
    const name = existing.rows.length ? existing.rows[0].donor_name : email.split('@')[0];
    const r = await pool.query(`INSERT INTO donor_engagement_scores (tenant_id, donor_email, donor_name, engagement_score, giving_score, event_score, volunteer_score, advocacy_score, communication_score, last_calculated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (tenant_id, donor_email) DO UPDATE SET donor_name=$3, engagement_score=$4, giving_score=$5, event_score=$6, volunteer_score=$7, advocacy_score=$8, communication_score=$9, last_calculated=NOW() RETURNING *`, [tid, email, name, totalScore, s.giving_score, s.event_score, s.volunteer_score, s.advocacy_score, s.communication_score]);
    await audit(req, 'calculate', 'donor_engagement_scores', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/engagement-activities', requireAuth, ah(async (req, res) => {
    const { donor_email, activity_type } = req.query;
    let q = `SELECT * FROM engagement_activities WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (donor_email) { q += ` AND donor_email=$${idx++}`; params.push(esc(donor_email)); }
    if (activity_type) { q += ` AND activity_type=$${idx++}`; params.push(activity_type); }
    q += ` ORDER BY recorded_at DESC LIMIT 100`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/engagement-activities', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_email, activity_type, description, points, recorded_at } = req.body;
    if (!donor_email || !activity_type) return res.status(400).json({ error: 'donor_email and activity_type required' });
    const pointMap = { donation: 10, event_attendance: 5, volunteer: 8, advocacy: 7, email_open: 1, email_click: 2, social_share: 3, referral: 6, survey: 4, feedback: 3 };
    const pts = points || pointMap[activity_type] || 1;
    const r = await pool.query(`INSERT INTO engagement_activities (tenant_id, donor_email, activity_type, description, points, recorded_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(donor_email), activity_type, esc(description||''), pts, recorded_at||null]);
    await audit(req, 'create', 'engagement_activities', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/engagement-scores/leaderboard', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT donor_email, donor_name, engagement_score, giving_score, event_score, volunteer_score, advocacy_score, communication_score, ROW_NUMBER() OVER (ORDER BY engagement_score DESC) as rank FROM donor_engagement_scores WHERE tenant_id=$1 ORDER BY engagement_score DESC LIMIT 25`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/engagement-scores/distribution', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT CASE WHEN engagement_score < 10 THEN '0-9 (Low)' WHEN engagement_score < 30 THEN '10-29 (Moderate)' WHEN engagement_score < 60 THEN '30-59 (Active)' WHEN engagement_score < 100 THEN '60-99 (High)' ELSE '100+ (Champion)' END as tier, COUNT(*) as count, AVG(engagement_score) as avg_score FROM donor_engagement_scores WHERE tenant_id=$1 GROUP BY tier ORDER BY MIN(engagement_score)`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // UI PAGES
  // =============================================
  const navLinks = `
    <nav class="flex flex-wrap gap-2 mb-6 p-4 bg-gray-50 rounded-lg">
      <a href="/virtual-events" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">Virtual Events</a>
      <a href="/galas" class="px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200">Galas</a>
      <a href="/wealth-screening" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Wealth</a>
      <a href="/grant-writing" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">Grants</a>
      <a href="/tax-statements" class="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Tax</a>
      <a href="/giving-days" class="px-3 py-1 bg-pink-100 text-pink-800 rounded hover:bg-pink-200">Giving Days</a>
      <a href="/installment-plans" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Plans</a>
      <a href="/engagement-scores" class="px-3 py-1 bg-cyan-100 text-cyan-800 rounded hover:bg-cyan-200">Engagement</a>
    </nav>`;

  // Virtual Events Dashboard
  app.get('/virtual-events', requireAuth, ah(async (req, res) => {
    const events = await pool.query(`SELECT * FROM virtual_events WHERE tenant_id=$1 ORDER BY start_time DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Virtual Events', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Virtual / Hybrid Events</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${events.rows.map(e => `
            <div class="bg-white p-4 rounded-lg shadow border-l-4 ${e.status==='live'?'border-red-500':e.status==='completed'?'border-gray-400':'border-emerald-500'}">
              <div class="flex justify-between items-start">
                <h3 class="font-semibold text-lg">${e.title}</h3>
                <span class="text-xs px-2 py-1 rounded ${e.status==='live'?'bg-red-100 text-red-800':e.status==='completed'?'bg-gray-100 text-gray-800':'bg-emerald-100 text-emerald-800'}">${e.status}</span>
              </div>
              <p class="text-sm text-gray-600 mt-1">${e.description ? e.description.substring(0,100) : ''}</p>
              <div class="mt-2 text-sm text-gray-500">
                <span class="mr-3">${e.event_type}</span>
                <span class="mr-3">${e.platform}</span>
                <span>${e.start_time ? new Date(e.start_time).toLocaleDateString() : 'TBD'}</span>
              </div>
              <div class="mt-2 text-sm">
                <span class="text-emerald-600 font-semibold">${e.total_registered} registered</span> |
                <span class="text-blue-600">${e.total_attended} attended</span>
              </div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Galas Dashboard
  app.get('/galas', requireAuth, ah(async (req, res) => {
    const galas = await pool.query(`SELECT * FROM fundraising_galas WHERE tenant_id=$1 ORDER BY date DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Fundraising Galas', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Fundraising Galas</h2>
        <div class="space-y-4">
          ${galas.rows.map(g => `
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-semibold text-lg">${g.name}</h3>
                  <p class="text-sm text-gray-600">${g.venue||''} ${g.date ? '| '+new Date(g.date).toLocaleDateString() : ''}</p>
                </div>
                <span class="text-xs px-2 py-1 rounded ${g.status==='live'?'bg-red-100 text-red-800':g.status==='completed'?'bg-gray-100 text-gray-800':'bg-purple-100 text-purple-800'}">${g.status}</span>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                <div><span class="text-gray-500">Total Raised:</span> <span class="font-semibold">UGX ${Number(g.total_raised).toLocaleString()}</span></div>
                <div><span class="text-gray-500">Tables:</span> <span class="font-semibold">${g.tables_sold}/${g.tables_available}</span></div>
                <div><span class="text-gray-500">Auction:</span> <span class="font-semibold">UGX ${Number(g.live_auction_total + g.silent_auction_total).toLocaleString()}</span></div>
                <div><span class="text-gray-500">Paddle:</span> <span class="font-semibold">UGX ${Number(g.paddle_raise_total).toLocaleString()}</span></div>
              </div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Wealth Screening Dashboard
  app.get('/wealth-screening', requireAuth, ah(async (req, res) => {
    const indicators = await pool.query(`SELECT * FROM donor_wealth_indicators WHERE tenant_id=$1 ORDER BY giving_capacity DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    const results = await pool.query(`SELECT * FROM wealth_screening_results WHERE tenant_id=$1 ORDER BY screening_date DESC LIMIT 5`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Wealth Screening', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Wealth Screening</h2>
        <div class="mb-6">
          <h3 class="font-semibold mb-2">Recent Screenings</h3>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr><th class="p-3 text-left">Date</th><th class="p-3 text-left">Screened</th><th class="p-3 text-left">High Capacity</th><th class="p-3 text-left">Mid Capacity</th><th class="p-3 text-left">Avg Capacity</th></tr></thead>
              <tbody>${results.rows.map(r => `<tr class="border-t"><td class="p-3">${new Date(r.screening_date).toLocaleDateString()}</td><td class="p-3">${r.total_screened}</td><td class="p-3">${r.high_capacity_count}</td><td class="p-3">${r.mid_capacity_count}</td><td class="p-3">UGX ${Number(r.avg_capacity).toLocaleString()}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 class="font-semibold mb-2">Top Prospects</h3>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Email</th><th class="p-3 text-left">Giving Capacity</th><th class="p-3 text-left">Net Worth</th><th class="p-3 text-left">Philanthropy Score</th></tr></thead>
              <tbody>${indicators.rows.map(d => `<tr class="border-t"><td class="p-3">${d.donor_name||'-'}</td><td class="p-3">${d.donor_email}</td><td class="p-3 font-semibold">UGX ${Number(d.giving_capacity).toLocaleString()}</td><td class="p-3">UGX ${Number(d.estimated_net_worth).toLocaleString()}</td><td class="p-3">${d.philanthropy_score}/100</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`);
  }));

  // Grant Writing Dashboard
  app.get('/grant-writing', requireAuth, ah(async (req, res) => {
    const templates = await pool.query(`SELECT * FROM grant_writing_templates WHERE tenant_id=$1 AND is_active=true ORDER BY category`, [req.session.user.tenant_id]);
    const proposals = await pool.query(`SELECT gp.*, gwt.name as template_name FROM grant_proposals gp LEFT JOIN grant_writing_templates gwt ON gp.template_id=gwt.id WHERE gp.tenant_id=$1 ORDER BY gp.created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Grant Writing', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Grant Writing Assistant</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 class="font-semibold mb-2">Templates</h3>
            <div class="space-y-3">
              ${templates.rows.map(t => `
                <div class="bg-white p-4 rounded-lg shadow">
                  <div class="flex justify-between"><span class="font-semibold">${t.name}</span><span class="text-xs px-2 py-1 rounded bg-teal-100 text-teal-800">${t.category||''}</span></div>
                  <p class="text-sm text-gray-600 mt-1">${t.funder_name||'No funder specified'}</p>
                  <p class="text-xs text-gray-500 mt-1">Word limit: ${t.word_limit} | Deadline: ${t.deadline_typical||'N/A'}</p>
                </div>`).join('')}
            </div>
          </div>
          <div>
            <h3 class="font-semibold mb-2">Proposals</h3>
            <div class="space-y-3">
              ${proposals.rows.map(p => `
                <div class="bg-white p-4 rounded-lg shadow">
                  <div class="flex justify-between items-start">
                    <span class="font-semibold">${p.title}</span>
                    <span class="text-xs px-2 py-1 rounded ${p.status==='approved'?'bg-green-100 text-green-800':p.status==='rejected'?'bg-red-100 text-red-800':p.status==='submitted'?'bg-blue-100 text-blue-800':'bg-gray-100 text-gray-800'}">${p.status}</span>
                  </div>
                  <p class="text-sm text-gray-600 mt-1">${p.funder_name||''} | UGX ${Number(p.amount_requested).toLocaleString()}</p>
                  ${p.template_name ? `<p class="text-xs text-gray-500 mt-1">Template: ${p.template_name}</p>` : ''}
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`);
  }));

  // Tax Statements Dashboard
  app.get('/tax-statements', requireAuth, ah(async (req, res) => {
    const year = new Date().getFullYear() - 1;
    const statements = await pool.query(`SELECT * FROM donor_tax_statements WHERE tenant_id=$1 AND tax_year=$2 ORDER BY donor_name LIMIT 30`, [req.session.user.tenant_id, year]);
    const summary = await pool.query(`SELECT COUNT(*) as total, SUM(total_donations) as total_amount, SUM(total_deductible) as total_deductible FROM donor_tax_statements WHERE tenant_id=$1 AND tax_year=$2`, [req.session.user.tenant_id, year]);
    const s = summary.rows[0];
    renderPage(req, res, 'Tax Statements', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Donor Tax Statements (${year})</h2>
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center">
            <p class="text-2xl font-bold">${s.total||0}</p>
            <p class="text-sm text-gray-500">Statements</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow text-center">
            <p class="text-2xl font-bold">UGX ${Number(s.total_amount||0).toLocaleString()}</p>
            <p class="text-sm text-gray-500">Total Donations</p>
          </div>
          <div class="bg-white p-4 rounded-lg shadow text-center">
            <p class="text-2xl font-bold">UGX ${Number(s.total_deductible||0).toLocaleString()}</p>
            <p class="text-sm text-gray-500">Total Deductible</p>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Email</th><th class="p-3 text-left">Total</th><th class="p-3 text-left">Deductible</th><th class="p-3 text-left">Statement #</th><th class="p-3 text-left">Sent</th></tr></thead>
            <tbody>${statements.rows.map(st => `<tr class="border-t"><td class="p-3">${st.donor_name}</td><td class="p-3">${st.donor_email}</td><td class="p-3">UGX ${Number(st.total_donations).toLocaleString()}</td><td class="p-3">UGX ${Number(st.total_deductible).toLocaleString()}</td><td class="p-3 text-xs">${st.statement_number||'-'}</td><td class="p-3">${st.sent_at?'Yes':'No'}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Giving Days Dashboard
  app.get('/giving-days', requireAuth, ah(async (req, res) => {
    const days = await pool.query(`SELECT * FROM giving_days WHERE tenant_id=$1 ORDER BY date DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Giving Days', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Giving Day Management</h2>
        <div class="space-y-4">
          ${days.rows.map(d => {
            const pct = d.goal_amount > 0 ? Math.min(100, (parseFloat(d.total_raised) / parseFloat(d.goal_amount)) * 100) : 0;
            return `
            <div class="bg-white p-4 rounded-lg shadow">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-semibold text-lg">${d.name}</h3>
                  <p class="text-sm text-gray-600">${d.date ? new Date(d.date).toLocaleDateString() : 'TBD'} | ${d.donor_count} donors | ${d.gift_count} gifts</p>
                </div>
                <span class="text-xs px-2 py-1 rounded ${d.status==='active'?'bg-green-100 text-green-800':d.status==='completed'?'bg-gray-100 text-gray-800':'bg-pink-100 text-pink-800'}">${d.status}</span>
              </div>
              <div class="mt-3">
                <div class="flex justify-between text-sm mb-1"><span>Progress</span><span>UGX ${Number(d.total_raised).toLocaleString()} / UGX ${Number(d.goal_amount).toLocaleString()}</span></div>
                <div class="w-full bg-gray-200 rounded-full h-2"><div class="bg-pink-600 h-2 rounded-full" style="width:${pct}%"></div></div>
              </div>
              ${d.matching_pool > 0 ? `<p class="text-sm mt-2 text-amber-600">Matching Pool: UGX ${Number(d.matching_pool).toLocaleString()}</p>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`);
  }));

  // Installment Plans Dashboard
  app.get('/installment-plans', requireAuth, ah(async (req, res) => {
    const plans = await pool.query(`SELECT * FROM installment_plans WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    const overdueCount = await pool.query(`SELECT COUNT(*) as cnt FROM installment_payments WHERE tenant_id=$1 AND status='overdue'`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Installment Plans', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Installment / Payment Plans</h2>
        ${parseInt(overdueCount.rows[0].cnt) > 0 ? `<div class="bg-red-50 border border-red-200 p-3 rounded mb-4 text-red-800">${overdueCount.rows[0].cnt} overdue payment(s) found</div>` : ''}
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Email</th><th class="p-3 text-left">Total</th><th class="p-3 text-left">Paid</th><th class="p-3 text-left">Frequency</th><th class="p-3 text-left">Progress</th><th class="p-3 text-left">Status</th></tr></thead>
            <tbody>${plans.rows.map(p => `<tr class="border-t"><td class="p-3">${p.donor_name}</td><td class="p-3">${p.donor_email}</td><td class="p-3">UGX ${Number(p.total_amount).toLocaleString()}</td><td class="p-3">${p.paid_installments}/${p.total_installments}</td><td class="p-3">${p.frequency}</td><td class="p-3"><div class="w-full bg-gray-200 rounded-full h-2"><div class="bg-orange-500 h-2 rounded-full" style="width:${p.total_installments > 0 ? (p.paid_installments/p.total_installments*100) : 0}%"></div></div></td><td class="p-3"><span class="text-xs px-2 py-1 rounded ${p.status==='active'?'bg-green-100 text-green-800':p.status==='paused'?'bg-yellow-100 text-yellow-800':p.status==='completed'?'bg-gray-100 text-gray-800':p.status==='cancelled'?'bg-red-100 text-red-800':'bg-orange-100 text-orange-800'}">${p.status}</span></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Engagement Scores Dashboard
  app.get('/engagement-scores', requireAuth, ah(async (req, res) => {
    const scores = await pool.query(`SELECT * FROM donor_engagement_scores WHERE tenant_id=$1 ORDER BY engagement_score DESC NULLS LAST LIMIT 20`, [req.session.user.tenant_id]);
    const dist = await pool.query(`SELECT CASE WHEN engagement_score < 10 THEN 'Low (0-9)' WHEN engagement_score < 30 THEN 'Moderate (10-29)' WHEN engagement_score < 60 THEN 'Active (30-59)' WHEN engagement_score < 100 THEN 'High (60-99)' ELSE 'Champion (100+)' END as tier, COUNT(*) as count FROM donor_engagement_scores WHERE tenant_id=$1 GROUP BY tier ORDER BY MIN(engagement_score)`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Engagement Scores', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Donor Engagement Scoring</h2>
        <div class="grid grid-cols-5 gap-2 mb-6">
          ${dist.rows.map(d => `<div class="bg-white p-3 rounded shadow text-center"><p class="text-lg font-bold">${d.count}</p><p class="text-xs text-gray-500">${d.tier}</p></div>`).join('')}
          ${dist.rows.length === 0 ? '<div class="col-span-5 text-center text-gray-500">No scores yet. Record activities and run calculation.</div>' : ''}
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Email</th><th class="p-3 text-left">Total</th><th class="p-3 text-left">Giving</th><th class="p-3 text-left">Events</th><th class="p-3 text-left">Volunteer</th><th class="p-3 text-left">Advocacy</th><th class="p-3 text-left">Comms</th></tr></thead>
            <tbody>${scores.rows.map(s => `<tr class="border-t"><td class="p-3 font-semibold">${s.donor_name||'-'}</td><td class="p-3">${s.donor_email}</td><td class="p-3 font-bold">${s.engagement_score}</td><td class="p-3">${s.giving_score}</td><td class="p-3">${s.event_score}</td><td class="p-3">${s.volunteer_score}</td><td class="p-3">${s.advocacy_score}</td><td class="p-3">${s.communication_score}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  console.log('[FundraisingUltimate9] Loaded — 8 features, 60+ routes');
};
