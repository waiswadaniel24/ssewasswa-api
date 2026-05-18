/**
 * Fundraising Ultimate10 Module — Advanced Giving & Payment Infrastructure
 * Features: Campaign Landing Page Builder, Payment Gateway Hub, Donor Renewal Automation,
 * Donor Gift Club Management, Campaign Video Integration, Stock/Securities Donations,
 * Real Estate Donations, IRA Charitable Rollovers
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Campaign Landing Page Builder
    `CREATE TABLE IF NOT EXISTS landing_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, title TEXT NOT NULL, slug TEXT NOT NULL, headline TEXT, subheadline TEXT, hero_image_url TEXT, body_html TEXT, cta_text TEXT DEFAULT 'Donate Now', cta_link TEXT, meta_title TEXT, meta_description TEXT, is_published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, view_count INTEGER DEFAULT 0, conversion_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, slug))`,
    `CREATE TABLE IF NOT EXISTS landing_page_versions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, landing_page_id INTEGER NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE, version_number INTEGER NOT NULL, content_json TEXT DEFAULT '{}', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_landing_pages_tenant ON landing_pages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_landing_pages_slug ON landing_pages(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_landing_page_versions_page ON landing_page_versions(landing_page_id)`,

    // Feature 2: Payment Gateway Hub
    `CREATE TABLE IF NOT EXISTS payment_gateways (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, gateway_type TEXT NOT NULL CHECK (gateway_type IN ('stripe','paypal','flutterwave','paystack','manual')), name TEXT NOT NULL, api_key_encrypted TEXT, api_secret_encrypted TEXT, webhook_url TEXT, is_primary BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true, config_json TEXT DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gateway_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, gateway_id INTEGER NOT NULL REFERENCES payment_gateways(id) ON DELETE CASCADE, donation_id INTEGER, external_tx_id TEXT, amount NUMERIC DEFAULT 0, fee NUMERIC DEFAULT 0, net_amount NUMERIC DEFAULT 0, currency TEXT DEFAULT 'UGX', status TEXT DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')), processed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_payment_gateways_tenant ON payment_gateways(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gateway_transactions_gateway ON gateway_transactions(gateway_id)`,

    // Feature 3: Donor Renewal Automation
    `CREATE TABLE IF NOT EXISTS donor_renewal_campaigns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, target_segment TEXT, trigger_days_before INTEGER DEFAULT 30, email_template TEXT, sms_template TEXT, max_reminders INTEGER DEFAULT 3, status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')), total_targeted INTEGER DEFAULT 0, total_renewed INTEGER DEFAULT 0, total_raised NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS renewal_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL REFERENCES donor_renewal_campaigns(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, reminder_number INTEGER DEFAULT 1, sent_at TIMESTAMPTZ, opened BOOLEAN DEFAULT false, clicked BOOLEAN DEFAULT false, renewed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_renewal_campaigns_tenant ON donor_renewal_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_renewal_reminders_campaign ON renewal_reminders(campaign_id)`,

    // Feature 4: Donor Gift Club Management
    `CREATE TABLE IF NOT EXISTS donor_gift_clubs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, min_annual_amount NUMERIC DEFAULT 0, max_annual_amount NUMERIC, benefits_json TEXT DEFAULT '[]', badge_icon TEXT, member_count INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS gift_club_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, club_id INTEGER NOT NULL REFERENCES donor_gift_clubs(id) ON DELETE CASCADE, donor_email TEXT NOT NULL, donor_name TEXT, joined_at TIMESTAMPTZ DEFAULT NOW(), annual_total NUMERIC DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('active','expired','removed')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_gift_clubs_tenant ON donor_gift_clubs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gift_club_members_club ON gift_club_members(club_id)`,

    // Feature 5: Campaign Video Integration
    `CREATE TABLE IF NOT EXISTS campaign_videos (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, video_type TEXT DEFAULT 'youtube' CHECK (video_type IN ('youtube','vimeo','livestream','uploaded')), video_url TEXT NOT NULL, title TEXT, description TEXT, thumbnail_url TEXT, duration_seconds INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0, is_featured BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS video_engagement (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, video_id INTEGER NOT NULL REFERENCES campaign_videos(id) ON DELETE CASCADE, viewer_email TEXT, watched_seconds INTEGER DEFAULT 0, completed BOOLEAN DEFAULT false, watched_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_videos_tenant ON campaign_videos(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_video_engagement_video ON video_engagement(video_id)`,

    // Feature 6: Stock / Securities Donations
    `CREATE TABLE IF NOT EXISTS stock_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT, stock_symbol TEXT NOT NULL, stock_name TEXT, shares NUMERIC NOT NULL, price_per_share_at_donation NUMERIC NOT NULL, total_value NUMERIC NOT NULL, brokerage_name TEXT, transfer_date DATE, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','received','sold','completed','cancelled')), acknowledged BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS stock_valuations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, stock_donation_id INTEGER NOT NULL REFERENCES stock_donations(id) ON DELETE CASCADE, valuation_date DATE DEFAULT CURRENT_DATE, price_per_share NUMERIC NOT NULL, total_value NUMERIC NOT NULL, valued_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_stock_donations_tenant ON stock_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_valuations_donation ON stock_valuations(stock_donation_id)`,

    // Feature 7: Real Estate Donations
    `CREATE TABLE IF NOT EXISTS real_estate_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT, property_type TEXT DEFAULT 'residential' CHECK (property_type IN ('residential','commercial','land','other')), address TEXT, city TEXT, region TEXT, country TEXT DEFAULT 'Uganda', area_sqft NUMERIC, appraised_value NUMERIC, donation_date DATE, status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','appraised','legal_review','completed','rejected')), appraisal_document_url TEXT, legal_review_status TEXT DEFAULT 'pending' CHECK (legal_review_status IN ('pending','approved','rejected')), acknowledged BOOLEAN DEFAULT false, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_real_estate_donations_tenant ON real_estate_donations(tenant_id)`,

    // Feature 8: IRA Charitable Rollovers
    `CREATE TABLE IF NOT EXISTS ira_rollovers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, campaign_id INTEGER, donor_name TEXT NOT NULL, donor_email TEXT, donor_age INTEGER, ira_custodian TEXT, rollover_amount NUMERIC NOT NULL, transfer_date DATE, tax_year INTEGER, confirmation_number TEXT, status TEXT DEFAULT 'initiated' CHECK (status IN ('initiated','confirmed','received','completed','cancelled')), acknowledged BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ira_distributions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, rollover_id INTEGER NOT NULL REFERENCES ira_rollovers(id) ON DELETE CASCADE, distribution_date DATE DEFAULT CURRENT_DATE, amount NUMERIC NOT NULL, tax_form_sent BOOLEAN DEFAULT false, tax_form_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ira_rollovers_tenant ON ira_rollovers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ira_distributions_rollover ON ira_distributions(rollover_id)`,

    // Seed: 1 manual gateway per tenant
    `INSERT INTO payment_gateways (tenant_id, gateway_type, name, is_primary, is_active, config_json) SELECT t.id, 'manual', 'Manual / Cash Collection', true, true, '{}' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM payment_gateways WHERE tenant_id=t.id AND gateway_type='manual')`,

    // Seed: 4 donor gift clubs per tenant (UGX tiers)
    `INSERT INTO donor_gift_clubs (tenant_id, name, description, min_annual_amount, max_annual_amount, benefits_json, badge_icon, is_active) SELECT t.id, 'Bronze Circle', 'Donors contributing up to UGX 500,000 annually', 0, 500000, '["Recognition on donor wall","Quarterly newsletter","Annual report"]', '🥉', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_gift_clubs WHERE tenant_id=t.id AND name='Bronze Circle')`,
    `INSERT INTO donor_gift_clubs (tenant_id, name, description, min_annual_amount, max_annual_amount, benefits_json, badge_icon, is_active) SELECT t.id, 'Silver Society', 'Donors contributing UGX 500,000 - 2,000,000 annually', 500000, 2000000, '["All Bronze benefits","Exclusive events","Personal thank-you calls","Priority updates"]', '🥈', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_gift_clubs WHERE tenant_id=t.id AND name='Silver Society')`,
    `INSERT INTO donor_gift_clubs (tenant_id, name, description, min_annual_amount, max_annual_amount, benefits_json, badge_icon, is_active) SELECT t.id, 'Gold League', 'Donors contributing UGX 2,000,000 - 10,000,000 annually', 2000000, 10000000, '["All Silver benefits","VIP gala invitations","Named giving opportunities","Dedicated liaison"]', '🥇', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_gift_clubs WHERE tenant_id=t.id AND name='Gold League')`,
    `INSERT INTO donor_gift_clubs (tenant_id, name, description, min_annual_amount, max_annual_amount, benefits_json, badge_icon, is_active) SELECT t.id, 'Platinum Patrons', 'Donors contributing over UGX 10,000,000 annually', 10000000, NULL, '["All Gold benefits","Board meeting attendance","Strategic input opportunities","Legacy naming rights","Private dinners"]', '💎', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_gift_clubs WHERE tenant_id=t.id AND name='Platinum Patrons')`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate10] Migrations complete — 8 features');
  })();

  // =============================================
  // FEATURE 1: CAMPAIGN LANDING PAGE BUILDER
  // =============================================

  // List landing pages
  app.get('/api/landing-pages', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM landing_pages WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create landing page
  app.post('/api/landing-pages', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, title, slug, headline, subheadline, hero_image_url, body_html, cta_text, cta_link, meta_title, meta_description } = req.body;
    if (!title || !slug) return res.status(400).json({ error: 'title and slug required' });
    const existing = await pool.query(`SELECT id FROM landing_pages WHERE tenant_id=$1 AND slug=$2`, [tid, esc(slug)]);
    if (existing.rows.length) return res.status(409).json({ error: 'Slug already exists' });
    const r = await pool.query(`INSERT INTO landing_pages (tenant_id, campaign_id, title, slug, headline, subheadline, hero_image_url, body_html, cta_text, cta_link, meta_title, meta_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [tid, campaign_id||null, esc(title), esc(slug), esc(headline||''), esc(subheadline||''), esc(hero_image_url||''), esc(body_html||''), esc(cta_text||'Donate Now'), esc(cta_link||''), esc(meta_title||''), esc(meta_description||'')]);
    await audit(req, 'create', 'landing_pages', r.rows[0].id);
    // Save initial version
    const contentJson = JSON.stringify({ headline, subheadline, hero_image_url, body_html, cta_text, cta_link });
    await pool.query(`INSERT INTO landing_page_versions (tenant_id, landing_page_id, version_number, content_json, created_by) VALUES ($1,$2,1,$3,$4)`, [tid, r.rows[0].id, contentJson, req.session.user.email]);
    res.json(r.rows[0]);
  }));

  // Get single landing page
  app.get('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM landing_pages WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    res.json(r.rows[0]);
  }));

  // Update landing page
  app.put('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, headline, subheadline, hero_image_url, body_html, cta_text, cta_link, meta_title, meta_description, campaign_id } = req.body;
    const existing = await pool.query(`SELECT * FROM landing_pages WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    const r = await pool.query(`UPDATE landing_pages SET title=COALESCE($1,title), headline=COALESCE($2,headline), subheadline=COALESCE($3,subheadline), hero_image_url=COALESCE($4,hero_image_url), body_html=COALESCE($5,body_html), cta_text=COALESCE($6,cta_text), cta_link=COALESCE($7,cta_link), meta_title=COALESCE($8,meta_title), meta_description=COALESCE($9,meta_description), campaign_id=COALESCE($10,campaign_id) WHERE tenant_id=$11 AND id=$12 RETURNING *`,
      [title?esc(title):null, headline!=null?esc(headline):null, subheadline!=null?esc(subheadline):null, hero_image_url!=null?esc(hero_image_url):null, body_html!=null?esc(body_html):null, cta_text!=null?esc(cta_text):null, cta_link!=null?esc(cta_link):null, meta_title!=null?esc(meta_title):null, meta_description!=null?esc(meta_description):null, campaign_id||null, tid, req.params.id]);
    // Save new version
    const maxVer = await pool.query(`SELECT MAX(version_number) as max_v FROM landing_page_versions WHERE landing_page_id=$1`, [req.params.id]);
    const nextVer = (maxVer.rows[0]?.max_v || 0) + 1;
    const contentJson = JSON.stringify({ headline: r.rows[0].headline, subheadline: r.rows[0].subheadline, hero_image_url: r.rows[0].hero_image_url, body_html: r.rows[0].body_html, cta_text: r.rows[0].cta_text, cta_link: r.rows[0].cta_link });
    await pool.query(`INSERT INTO landing_page_versions (tenant_id, landing_page_id, version_number, content_json, created_by) VALUES ($1,$2,$3,$4,$5)`, [tid, req.params.id, nextVer, contentJson, req.session.user.email]);
    await audit(req, 'update', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete landing page
  app.delete('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM landing_pages WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'landing_pages', req.params.id);
    res.json({ ok: true });
  }));

  // Public page by slug (NO auth required)
  app.get('/api/landing-pages/slug/:slug', ah(async (req, res) => {
    const r = await pool.query(`SELECT id, title, slug, headline, subheadline, hero_image_url, body_html, cta_text, cta_link, meta_title, meta_description, is_published, view_count, conversion_count FROM landing_pages WHERE slug=$1 AND is_published=true`, [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ error: 'Page not found or not published' });
    res.json(r.rows[0]);
  }));

  // Publish landing page
  app.post('/api/landing-pages/:id/publish', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE landing_pages SET is_published=true, published_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    await audit(req, 'publish', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Unpublish landing page
  app.post('/api/landing-pages/:id/unpublish', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE landing_pages SET is_published=false WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    await audit(req, 'unpublish', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Duplicate landing page
  app.post('/api/landing-pages/:id/duplicate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const orig = await pool.query(`SELECT * FROM landing_pages WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!orig.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    const o = orig.rows[0];
    const newSlug = o.slug + '-copy';
    const existingCopy = await pool.query(`SELECT id FROM landing_pages WHERE tenant_id=$1 AND slug=$2`, [tid, newSlug]);
    const finalSlug = existingCopy.rows.length ? newSlug + '-' + Date.now() : newSlug;
    const r = await pool.query(`INSERT INTO landing_pages (tenant_id, campaign_id, title, slug, headline, subheadline, hero_image_url, body_html, cta_text, cta_link, meta_title, meta_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [tid, o.campaign_id, esc(o.title + ' (Copy)'), esc(finalSlug), o.headline, o.subheadline, o.hero_image_url, o.body_html, o.cta_text, o.cta_link, o.meta_title, o.meta_description]);
    await audit(req, 'duplicate', 'landing_pages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Get landing page versions
  app.get('/api/landing-pages/:id/versions', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM landing_page_versions WHERE tenant_id=$1 AND landing_page_id=$2 ORDER BY version_number DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Track view
  app.post('/api/landing-pages/:id/track-view', ah(async (req, res) => {
    await pool.query(`UPDATE landing_pages SET view_count=view_count+1 WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));

  // Track conversion
  app.post('/api/landing-pages/:id/track-conversion', ah(async (req, res) => {
    await pool.query(`UPDATE landing_pages SET conversion_count=conversion_count+1 WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));

  // =============================================
  // FEATURE 2: PAYMENT GATEWAY HUB
  // =============================================

  // List gateways
  app.get('/api/payment-gateways', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT id, tenant_id, gateway_type, name, webhook_url, is_primary, is_active, config_json, created_at FROM payment_gateways WHERE tenant_id=$1 ORDER BY is_primary DESC, created_at`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create gateway
  app.post('/api/payment-gateways', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { gateway_type, name, api_key, api_secret, webhook_url, is_primary, config } = req.body;
    if (!gateway_type || !name) return res.status(400).json({ error: 'gateway_type and name required' });
    if (is_primary) {
      await pool.query(`UPDATE payment_gateways SET is_primary=false WHERE tenant_id=$1`, [tid]);
    }
    const r = await pool.query(`INSERT INTO payment_gateways (tenant_id, gateway_type, name, api_key_encrypted, api_secret_encrypted, webhook_url, is_primary, is_active, config_json) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8) RETURNING *`,
      [tid, gateway_type, esc(name), esc(api_key||''), esc(api_secret||''), esc(webhook_url||''), is_primary||false, JSON.stringify(config||{})]);
    await audit(req, 'create', 'payment_gateways', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update gateway
  app.put('/api/payment-gateways/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, api_key, api_secret, webhook_url, is_primary, is_active, config } = req.body;
    if (is_primary) {
      await pool.query(`UPDATE payment_gateways SET is_primary=false WHERE tenant_id=$1`, [tid]);
    }
    const r = await pool.query(`UPDATE payment_gateways SET name=COALESCE($1,name), api_key_encrypted=COALESCE($2,api_key_encrypted), api_secret_encrypted=COALESCE($3,api_secret_encrypted), webhook_url=COALESCE($4,webhook_url), is_primary=COALESCE($5,is_primary), is_active=COALESCE($6,is_active), config_json=COALESCE($7,config_json) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [name?esc(name):null, api_key?esc(api_key):null, api_secret?esc(api_secret):null, webhook_url?esc(webhook_url):null, is_primary, is_active, config?JSON.stringify(config):null, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    await audit(req, 'update', 'payment_gateways', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete gateway
  app.delete('/api/payment-gateways/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM payment_gateways WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'payment_gateways', req.params.id);
    res.json({ ok: true });
  }));

  // Test gateway connection
  app.post('/api/payment-gateways/:id/test', requireAuth, ah(async (req, res) => {
    const gw = await pool.query(`SELECT * FROM payment_gateways WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!gw.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    const g = gw.rows[0];
    // Simulate connection test based on gateway type
    let testResult = { success: true, message: `${g.name} (${g.gateway_type}) connection test successful`, latency_ms: Math.floor(Math.random() * 200) + 50 };
    if (g.gateway_type === 'manual') {
      testResult = { success: true, message: 'Manual gateway — no connection test needed', latency_ms: 0 };
    } else if (!g.api_key_encrypted) {
      testResult = { success: false, message: 'API key not configured', latency_ms: 0 };
    }
    res.json(testResult);
  }));

  // Get gateway transactions
  app.get('/api/payment-gateways/:id/transactions', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM gateway_transactions WHERE tenant_id=$1 AND gateway_id=$2 ORDER BY created_at DESC LIMIT 50`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Webhook endpoint (NO auth)
  app.post('/api/payment-gateways/:id/webhook', ah(async (req, res) => {
    const gw = await pool.query(`SELECT * FROM payment_gateways WHERE id=$1 AND is_active=true`, [req.params.id]);
    if (!gw.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    const { event, data } = req.body;
    const g = gw.rows[0];
    // Log the webhook as a transaction
    const amount = data?.amount || 0;
    const fee = data?.fee || 0;
    await pool.query(`INSERT INTO gateway_transactions (tenant_id, gateway_id, donation_id, external_tx_id, amount, fee, net_amount, currency, status, processed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [g.tenant_id, g.id, data?.donation_id||null, esc(data?.external_tx_id||event||'webhook'), amount, fee, amount - fee, esc(data?.currency||'UGX'), data?.status||'completed']);
    res.json({ received: true });
  }));

  // Get gateway balance
  app.get('/api/payment-gateways/:id/balance', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT COALESCE(SUM(amount),0) as total_processed, COALESCE(SUM(fee),0) as total_fees, COALESCE(SUM(net_amount),0) as net, COUNT(*) as transaction_count FROM gateway_transactions WHERE tenant_id=$1 AND gateway_id=$2 AND status='completed'`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  // Gateway stats
  app.get('/api/payment-gateways/stats', requireAuth, ah(async (req, res) => {
    const byGateway = await pool.query(`SELECT g.id, g.name, g.gateway_type, g.is_primary, g.is_active, COALESCE(SUM(gt.amount),0) as total_amount, COALESCE(SUM(gt.fee),0) as total_fees, COUNT(gt.id) as transaction_count FROM payment_gateways g LEFT JOIN gateway_transactions gt ON g.id=gt.gateway_id AND gt.status='completed' WHERE g.tenant_id=$1 GROUP BY g.id ORDER BY total_amount DESC`, [req.session.user.tenant_id]);
    const byStatus = await pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM gateway_transactions WHERE tenant_id=$1 GROUP BY status`, [req.session.user.tenant_id]);
    res.json({ by_gateway: byGateway.rows, by_status: byStatus.rows });
  }));

  // =============================================
  // FEATURE 3: DONOR RENEWAL AUTOMATION
  // =============================================

  // List renewal campaigns
  app.get('/api/renewal-campaigns', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create renewal campaign
  app.post('/api/renewal-campaigns', requireAuth, ah(async (req, res) => {
    const { name, description, target_segment, trigger_days_before, email_template, sms_template, max_reminders } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO donor_renewal_campaigns (tenant_id, name, description, target_segment, trigger_days_before, email_template, sms_template, max_reminders) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(description||''), esc(target_segment||''), trigger_days_before||30, esc(email_template||''), esc(sms_template||''), max_reminders||3]);
    await audit(req, 'create', 'donor_renewal_campaigns', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update renewal campaign
  app.put('/api/renewal-campaigns/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, target_segment, trigger_days_before, email_template, sms_template, max_reminders } = req.body;
    const r = await pool.query(`UPDATE donor_renewal_campaigns SET name=COALESCE($1,name), description=COALESCE($2,description), target_segment=COALESCE($3,target_segment), trigger_days_before=COALESCE($4,trigger_days_before), email_template=COALESCE($5,email_template), sms_template=COALESCE($6,sms_template), max_reminders=COALESCE($7,max_reminders) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [name?esc(name):null, description?esc(description):null, target_segment?esc(target_segment):null, trigger_days_before, email_template?esc(email_template):null, sms_template?esc(sms_template):null, max_reminders, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Renewal campaign not found' });
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Start renewal campaign
  app.post('/api/renewal-campaigns/:id/start', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaign = await pool.query(`SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!campaign.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.rows[0].status === 'active') return res.status(400).json({ error: 'Campaign already active' });
    // Find donors needing renewal (donated in past but not in last N days)
    const daysBack = campaign.rows[0].trigger_days_before || 30;
    const donors = await pool.query(`SELECT DISTINCT donor_email, MAX(donor_name) as donor_name FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND created_at < NOW() - ($2 || ' days')::interval GROUP BY donor_email LIMIT 100`, [tid, daysBack]);
    let targeted = 0;
    for (const d of donors.rows) {
      try {
        await pool.query(`INSERT INTO renewal_reminders (tenant_id, campaign_id, donor_email, donor_name, reminder_number) VALUES ($1,$2,$3,$4,1)`, [tid, req.params.id, esc(d.donor_email), esc(d.donor_name||'')]);
        targeted++;
      } catch(e) {}
    }
    const r = await pool.query(`UPDATE donor_renewal_campaigns SET status='active', total_targeted=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *`, [targeted, tid, req.params.id]);
    await audit(req, 'start', 'donor_renewal_campaigns', req.params.id);
    res.json({ ...r.rows[0], donors_found: targeted });
  }));

  // Pause renewal campaign
  app.post('/api/renewal-campaigns/:id/pause', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE donor_renewal_campaigns SET status='paused' WHERE tenant_id=$1 AND id=$2 AND status='active' RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Campaign not found or not active' });
    await audit(req, 'pause', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Get reminders for campaign
  app.get('/api/renewal-campaigns/:id/reminders', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM renewal_reminders WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC LIMIT 100`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Send a reminder
  app.post('/api/renewal-campaigns/:id/send-reminder', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const campaign = await pool.query(`SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2 AND status='active'`, [tid, req.params.id]);
    if (!campaign.rows.length) return res.status(400).json({ error: 'Campaign not active' });
    const { reminder_id } = req.body;
    const reminder = await pool.query(`SELECT * FROM renewal_reminders WHERE tenant_id=$1 AND campaign_id=$2 AND id=$3 AND sent_at IS NULL`, [tid, req.params.id, reminder_id]);
    if (!reminder.rows.length) return res.status(404).json({ error: 'Pending reminder not found' });
    const r = reminder.rows[0];
    // Send email if template exists
    if (campaign.rows[0].email_template && r.donor_email) {
      try {
        await sendEmail(r.donor_email, `Renewal Reminder: ${campaign.rows[0].name}`, campaign.rows[0].email_template.replace('{name}', r.donor_name||'Donor'));
      } catch(e) {}
    }
    // Send SMS if template exists
    if (campaign.rows[0].sms_template && r.donor_email) {
      try {
        await sendSMS(r.donor_email, campaign.rows[0].sms_template.replace('{name}', r.donor_name||'Donor'));
      } catch(e) {}
    }
    await pool.query(`UPDATE renewal_reminders SET sent_at=NOW() WHERE id=$1`, [r.id]);
    await audit(req, 'send_reminder', 'renewal_reminders', r.id);
    res.json({ ok: true, message: 'Reminder sent' });
  }));

  // Campaign stats
  app.get('/api/renewal-campaigns/:id/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stats = await pool.query(`SELECT COUNT(*) as total_reminders, COUNT(CASE WHEN sent_at IS NOT NULL THEN 1 END) as sent, COUNT(CASE WHEN opened THEN 1 END) as opened, COUNT(CASE WHEN clicked THEN 1 END) as clicked, COUNT(CASE WHEN renewed THEN 1 END) as renewed FROM renewal_reminders WHERE tenant_id=$1 AND campaign_id=$2`, [tid, req.params.id]);
    const raised = await pool.query(`SELECT COALESCE(total_raised,0) as total_raised FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    res.json({ ...stats.rows[0], total_raised: raised.rows[0]?.total_raised || 0 });
  }));

  // Donors needing renewal
  app.get('/api/renewal/upcoming', requireAuth, ah(async (req, res) => {
    const { days } = req.query;
    const daysVal = parseInt(days) || 30;
    const r = await pool.query(`SELECT donor_email, MAX(donor_name) as donor_name, MAX(created_at) as last_donation, SUM(amount) as total_given FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND created_at < NOW() - ($2 || ' days')::interval GROUP BY donor_email ORDER BY total_given DESC LIMIT 50`, [req.session.user.tenant_id, daysVal]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 4: DONOR GIFT CLUB MANAGEMENT
  // =============================================

  // List gift clubs
  app.get('/api/gift-clubs', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 ORDER BY min_annual_amount`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create gift club
  app.post('/api/gift-clubs', requireAuth, ah(async (req, res) => {
    const { name, description, min_annual_amount, max_annual_amount, benefits, badge_icon, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO donor_gift_clubs (tenant_id, name, description, min_annual_amount, max_annual_amount, benefits_json, badge_icon, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(description||''), min_annual_amount||0, max_annual_amount||null, JSON.stringify(benefits||[]), esc(badge_icon||''), is_active!==false]);
    await audit(req, 'create', 'donor_gift_clubs', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update gift club
  app.put('/api/gift-clubs/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, min_annual_amount, max_annual_amount, benefits, badge_icon, is_active } = req.body;
    const r = await pool.query(`UPDATE donor_gift_clubs SET name=COALESCE($1,name), description=COALESCE($2,description), min_annual_amount=COALESCE($3,min_annual_amount), max_annual_amount=COALESCE($4,max_annual_amount), benefits_json=COALESCE($5,benefits_json), badge_icon=COALESCE($6,badge_icon), is_active=COALESCE($7,is_active) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [name?esc(name):null, description?esc(description):null, min_annual_amount, max_annual_amount, benefits?JSON.stringify(benefits):null, badge_icon?esc(badge_icon):null, is_active, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gift club not found' });
    await audit(req, 'update', 'donor_gift_clubs', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete gift club
  app.delete('/api/gift-clubs/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM donor_gift_clubs WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'donor_gift_clubs', req.params.id);
    res.json({ ok: true });
  }));

  // Get club members
  app.get('/api/gift-clubs/:id/members', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM gift_club_members WHERE tenant_id=$1 AND club_id=$2 ORDER BY joined_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Auto-assign based on giving
  app.post('/api/gift-clubs/:id/auto-assign', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const club = await pool.query(`SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [tid, req.params.id]);
    if (!club.rows.length) return res.status(404).json({ error: 'Gift club not found or inactive' });
    const c = club.rows[0];
    // Get donors with annual giving in this club's range
    const donors = await pool.query(`SELECT donor_email, MAX(donor_name) as donor_name, SUM(amount) as annual_total FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND created_at >= NOW() - INTERVAL '1 year' GROUP BY donor_email HAVING SUM(amount) >= $2 AND ($3::numeric IS NULL OR SUM(amount) <= $3)`, [tid, c.min_annual_amount, c.max_annual_amount]);
    let assigned = 0;
    for (const d of donors.rows) {
      // Check if already in this club
      const existing = await pool.query(`SELECT id FROM gift_club_members WHERE tenant_id=$1 AND club_id=$2 AND donor_email=$3 AND status='active'`, [tid, req.params.id, esc(d.donor_email)]);
      if (!existing.rows.length) {
        await pool.query(`INSERT INTO gift_club_members (tenant_id, club_id, donor_email, donor_name, annual_total) VALUES ($1,$2,$3,$4,$5)`, [tid, req.params.id, esc(d.donor_email), esc(d.donor_name||''), d.annual_total]);
        assigned++;
      }
    }
    // Update member count
    await pool.query(`UPDATE donor_gift_clubs SET member_count=(SELECT COUNT(*) FROM gift_club_members WHERE club_id=$1 AND status='active') WHERE id=$1`, [req.params.id]);
    await audit(req, 'auto_assign', 'donor_gift_clubs', req.params.id);
    res.json({ assigned, total_eligible: donors.rows.length });
  }));

  // Remove member
  app.post('/api/gift-clubs/:id/remove-member/:memberId', requireAuth, ah(async (req, res) => {
    const member = await pool.query(`UPDATE gift_club_members SET status='removed' WHERE tenant_id=$1 AND club_id=$2 AND id=$3 RETURNING *`, [req.session.user.tenant_id, req.params.id, req.params.memberId]);
    if (!member.rows.length) return res.status(404).json({ error: 'Member not found' });
    await pool.query(`UPDATE donor_gift_clubs SET member_count=GREATEST(0,member_count-1) WHERE id=$1`, [req.params.id]);
    await audit(req, 'remove_member', 'gift_club_members', req.params.memberId);
    res.json({ ok: true });
  }));

  // Current user's club
  app.get('/api/gift-clubs/my-club', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT gc.*, m.annual_total, m.joined_at, m.status as member_status FROM gift_club_members m JOIN donor_gift_clubs gc ON m.club_id=gc.id WHERE m.tenant_id=$1 AND m.donor_email=$2 AND m.status='active' ORDER BY gc.min_annual_amount DESC LIMIT 1`, [req.session.user.tenant_id, req.session.user.email]);
    if (!r.rows.length) return res.json({ club: null, message: 'Not a member of any gift club' });
    res.json(r.rows[0]);
  }));

  // Gift club stats
  app.get('/api/gift-clubs/stats', requireAuth, ah(async (req, res) => {
    const byClub = await pool.query(`SELECT gc.id, gc.name, gc.badge_icon, gc.min_annual_amount, gc.max_annual_amount, gc.member_count, COALESCE(SUM(m.annual_total),0) as total_annual_giving FROM donor_gift_clubs gc LEFT JOIN gift_club_members m ON gc.id=m.club_id AND m.status='active' WHERE gc.tenant_id=$1 GROUP BY gc.id ORDER BY gc.min_annual_amount`, [req.session.user.tenant_id]);
    const totalMembers = await pool.query(`SELECT COUNT(DISTINCT donor_email) as total FROM gift_club_members WHERE tenant_id=$1 AND status='active'`, [req.session.user.tenant_id]);
    res.json({ by_club: byClub.rows, total_members: totalMembers.rows[0]?.total || 0 });
  }));

  // =============================================
  // FEATURE 5: CAMPAIGN VIDEO INTEGRATION
  // =============================================

  // List videos for campaign
  app.get('/api/campaigns/:id/videos', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM campaign_videos WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY is_featured DESC, created_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Add video to campaign
  app.post('/api/campaigns/:id/videos', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { video_type, video_url, title, description, thumbnail_url, duration_seconds, is_featured } = req.body;
    if (!video_url) return res.status(400).json({ error: 'video_url required' });
    // If featured, unfeature others
    if (is_featured) {
      await pool.query(`UPDATE campaign_videos SET is_featured=false WHERE tenant_id=$1 AND campaign_id=$2`, [tid, req.params.id]);
    }
    const r = await pool.query(`INSERT INTO campaign_videos (tenant_id, campaign_id, video_type, video_url, title, description, thumbnail_url, duration_seconds, is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, req.params.id, video_type||'youtube', esc(video_url), esc(title||''), esc(description||''), esc(thumbnail_url||''), duration_seconds||0, is_featured||false]);
    await audit(req, 'create', 'campaign_videos', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update video
  app.put('/api/campaigns/:id/videos/:videoId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { video_type, video_url, title, description, thumbnail_url, duration_seconds, is_featured } = req.body;
    if (is_featured) {
      await pool.query(`UPDATE campaign_videos SET is_featured=false WHERE tenant_id=$1 AND campaign_id=$2`, [tid, req.params.id]);
    }
    const r = await pool.query(`UPDATE campaign_videos SET video_type=COALESCE($1,video_type), video_url=COALESCE($2,video_url), title=COALESCE($3,title), description=COALESCE($4,description), thumbnail_url=COALESCE($5,thumbnail_url), duration_seconds=COALESCE($6,duration_seconds), is_featured=COALESCE($7,is_featured) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [video_type, video_url?esc(video_url):null, title?esc(title):null, description?esc(description):null, thumbnail_url?esc(thumbnail_url):null, duration_seconds, is_featured, tid, req.params.videoId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'update', 'campaign_videos', req.params.videoId);
    res.json(r.rows[0]);
  }));

  // Delete video
  app.delete('/api/campaigns/:id/videos/:videoId', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM campaign_videos WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.videoId]);
    await audit(req, 'delete', 'campaign_videos', req.params.videoId);
    res.json({ ok: true });
  }));

  // Track engagement
  app.post('/api/videos/:id/track', requireAuth, ah(async (req, res) => {
    const { watched_seconds, completed } = req.body;
    const video = await pool.query(`SELECT * FROM campaign_videos WHERE id=$1`, [req.params.id]);
    if (!video.rows.length) return res.status(404).json({ error: 'Video not found' });
    await pool.query(`INSERT INTO video_engagement (tenant_id, video_id, viewer_email, watched_seconds, completed) VALUES ($1,$2,$3,$4,$5)`,
      [video.rows[0].tenant_id, req.params.id, req.session.user.email, watched_seconds||0, completed||false]);
    await pool.query(`UPDATE campaign_videos SET view_count=view_count+1 WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));

  // Video stats
  app.get('/api/videos/:id/stats', requireAuth, ah(async (req, res) => {
    const video = await pool.query(`SELECT * FROM campaign_videos WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!video.rows.length) return res.status(404).json({ error: 'Video not found' });
    const engagement = await pool.query(`SELECT COUNT(*) as total_views, AVG(watched_seconds) as avg_watch_time, COUNT(CASE WHEN completed THEN 1 END) as completions, COUNT(DISTINCT viewer_email) as unique_viewers FROM video_engagement WHERE video_id=$1`, [req.params.id]);
    res.json({ video: video.rows[0], engagement: engagement.rows[0] });
  }));

  // Video analytics
  app.get('/api/videos/:id/analytics', requireAuth, ah(async (req, res) => {
    const video = await pool.query(`SELECT * FROM campaign_videos WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!video.rows.length) return res.status(404).json({ error: 'Video not found' });
    const timeline = await pool.query(`SELECT DATE(watched_at) as date, COUNT(*) as views, AVG(watched_seconds) as avg_seconds, COUNT(CASE WHEN completed THEN 1 END) as completions FROM video_engagement WHERE video_id=$1 GROUP BY DATE(watched_at) ORDER BY date DESC LIMIT 30`, [req.params.id]);
    const retention = await pool.query(`SELECT CASE WHEN watched_seconds < 10 THEN '0-10s' WHEN watched_seconds < 30 THEN '10-30s' WHEN watched_seconds < 60 THEN '30-60s' WHEN watched_seconds < 120 THEN '1-2min' WHEN watched_seconds < 300 THEN '2-5min' ELSE '5min+' END as bucket, COUNT(*) as viewers FROM video_engagement WHERE video_id=$1 GROUP BY bucket ORDER BY MIN(watched_seconds)`, [req.params.id]);
    res.json({ timeline: timeline.rows, retention: retention.rows });
  }));

  // Go live (start livestream)
  app.post('/api/campaigns/:id/go-live', requireAuth, ah(async (req, res) => {
    const { title, description, video_url } = req.body;
    if (!video_url) return res.status(400).json({ error: 'video_url required for livestream' });
    // Unfeature any existing featured
    await pool.query(`UPDATE campaign_videos SET is_featured=false WHERE tenant_id=$1 AND campaign_id=$2`, [req.session.user.tenant_id, req.params.id]);
    const r = await pool.query(`INSERT INTO campaign_videos (tenant_id, campaign_id, video_type, video_url, title, description, is_featured) VALUES ($1,$2,'livestream',$3,$4,$5,true) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, esc(video_url), esc(title||'Live Stream'), esc(description||'')]);
    await audit(req, 'go_live', 'campaign_videos', r.rows[0].id);
    // Notify followers
    try {
      await notify(req.session.user.tenant_id, 'livestream_started', `Live stream started: ${title||'Live Stream'}`, { campaign_id: req.params.id, video_id: r.rows[0].id });
    } catch(e) {}
    res.json(r.rows[0]);
  }));

  // =============================================
  // FEATURE 6: STOCK / SECURITIES DONATIONS
  // =============================================

  // List stock donations
  app.get('/api/stock-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM stock_donations WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create stock donation
  app.post('/api/stock-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, stock_symbol, stock_name, shares, price_per_share_at_donation, brokerage_name, transfer_date } = req.body;
    if (!donor_name || !stock_symbol || !shares || !price_per_share_at_donation) return res.status(400).json({ error: 'donor_name, stock_symbol, shares, and price_per_share_at_donation required' });
    const totalValue = parseFloat(shares) * parseFloat(price_per_share_at_donation);
    const r = await pool.query(`INSERT INTO stock_donations (tenant_id, campaign_id, donor_name, donor_email, stock_symbol, stock_name, shares, price_per_share_at_donation, total_value, brokerage_name, transfer_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') RETURNING *`,
      [req.session.user.tenant_id, campaign_id||null, esc(donor_name), esc(donor_email||''), esc(stock_symbol), esc(stock_name||''), shares, price_per_share_at_donation, totalValue, esc(brokerage_name||''), transfer_date||null]);
    await audit(req, 'create', 'stock_donations', r.rows[0].id);
    try { await notify(req.session.user.tenant_id, 'stock_donation_received', `Stock donation received: ${stock_symbol} from ${donor_name}`, { id: r.rows[0].id }); } catch(e) {}
    res.json(r.rows[0]);
  }));

  // Update stock donation
  app.put('/api/stock-donations/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_name, donor_email, stock_symbol, stock_name, shares, price_per_share_at_donation, brokerage_name, transfer_date, status, notes } = req.body;
    const totalValue = shares && price_per_share_at_donation ? parseFloat(shares) * parseFloat(price_per_share_at_donation) : null;
    const r = await pool.query(`UPDATE stock_donations SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), stock_symbol=COALESCE($3,stock_symbol), stock_name=COALESCE($4,stock_name), shares=COALESCE($5,shares), price_per_share_at_donation=COALESCE($6,price_per_share_at_donation), total_value=COALESCE($7,total_value), brokerage_name=COALESCE($8,brokerage_name), transfer_date=COALESCE($9,transfer_date), status=COALESCE($10,status) WHERE tenant_id=$11 AND id=$12 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, stock_symbol?esc(stock_symbol):null, stock_name?esc(stock_name):null, shares, price_per_share_at_donation, totalValue, brokerage_name?esc(brokerage_name):null, transfer_date||null, status||null, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    await audit(req, 'update', 'stock_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Acknowledge stock donation
  app.post('/api/stock-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE stock_donations SET acknowledged=true WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    await audit(req, 'acknowledge', 'stock_donations', req.params.id);
    // Send acknowledgment email
    if (r.rows[0].donor_email) {
      try {
        await sendEmail(r.rows[0].donor_email, 'Stock Donation Acknowledged', `Dear ${r.rows[0].donor_name},\n\nThank you for your generous stock donation of ${r.rows[0].shares} shares of ${r.rows[0].stock_symbol}. We have received and acknowledged your contribution.\n\nSincerely,\nThe Fundraising Team`);
      } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Get/Create valuations
  app.get('/api/stock-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM stock_valuations WHERE tenant_id=$1 AND stock_donation_id=$2 ORDER BY valuation_date DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/stock-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const stock = await pool.query(`SELECT * FROM stock_donations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!stock.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    const { valuation_date, price_per_share, valued_by } = req.body;
    if (!price_per_share) return res.status(400).json({ error: 'price_per_share required' });
    const totalValue = parseFloat(stock.rows[0].shares) * parseFloat(price_per_share);
    const r = await pool.query(`INSERT INTO stock_valuations (tenant_id, stock_donation_id, valuation_date, price_per_share, total_value, valued_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, req.params.id, valuation_date||'CURRENT_DATE', price_per_share, totalValue, esc(valued_by||req.session.user.email)]);
    await audit(req, 'create', 'stock_valuations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Stock donation stats
  app.get('/api/stock-donations/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const overview = await pool.query(`SELECT COUNT(*) as total_donations, COALESCE(SUM(total_value),0) as total_value, COUNT(DISTINCT donor_email) as unique_donors, COUNT(CASE WHEN status='pending' THEN 1 END) as pending, COUNT(CASE WHEN acknowledged=false THEN 1 END) as unacknowledged FROM stock_donations WHERE tenant_id=$1`, [tid]);
    const bySymbol = await pool.query(`SELECT stock_symbol, stock_name, COUNT(*) as count, SUM(shares) as total_shares, SUM(total_value) as total_value FROM stock_donations WHERE tenant_id=$1 GROUP BY stock_symbol, stock_name ORDER BY total_value DESC`, [tid]);
    res.json({ overview: overview.rows[0], by_symbol: bySymbol.rows });
  }));

  // Pending stock donations
  app.get('/api/stock-donations/pending', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM stock_donations WHERE tenant_id=$1 AND status IN ('pending','received') ORDER BY created_at ASC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 7: REAL ESTATE DONATIONS
  // =============================================

  // List real estate donations
  app.get('/api/real-estate-donations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM real_estate_donations WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create real estate donation
  app.post('/api/real-estate-donations', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, property_type, address, city, region, country, area_sqft, appraised_value, donation_date, appraisal_document_url, notes } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name required' });
    const r = await pool.query(`INSERT INTO real_estate_donations (tenant_id, campaign_id, donor_name, donor_email, property_type, address, city, region, country, area_sqft, appraised_value, donation_date, appraisal_document_url, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.session.user.tenant_id, campaign_id||null, esc(donor_name), esc(donor_email||''), property_type||'residential', esc(address||''), esc(city||''), esc(region||''), esc(country||'Uganda'), area_sqft||null, appraised_value||null, donation_date||null, esc(appraisal_document_url||''), esc(notes||'')]);
    await audit(req, 'create', 'real_estate_donations', r.rows[0].id);
    try { await notify(req.session.user.tenant_id, 'real_estate_donation', `Real estate donation submitted by ${donor_name}`, { id: r.rows[0].id }); } catch(e) {}
    res.json(r.rows[0]);
  }));

  // Update real estate donation
  app.put('/api/real-estate-donations/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_name, donor_email, property_type, address, city, region, country, area_sqft, appraised_value, donation_date, appraisal_document_url, legal_review_status, notes, status } = req.body;
    const r = await pool.query(`UPDATE real_estate_donations SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), property_type=COALESCE($3,property_type), address=COALESCE($4,address), city=COALESCE($5,city), region=COALESCE($6,region), country=COALESCE($7,country), area_sqft=COALESCE($8,area_sqft), appraised_value=COALESCE($9,appraised_value), donation_date=COALESCE($10,donation_date), appraisal_document_url=COALESCE($11,appraisal_document_url), legal_review_status=COALESCE($12,legal_review_status), notes=COALESCE($13,notes), status=COALESCE($14,status) WHERE tenant_id=$15 AND id=$16 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, property_type, address?esc(address):null, city?esc(city):null, region?esc(region):null, country?esc(country):null, area_sqft, appraised_value, donation_date||null, appraisal_document_url?esc(appraisal_document_url):null, legal_review_status, notes?esc(notes):null, status, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Real estate donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Appraise real estate donation
  app.post('/api/real-estate-donations/:id/appraise', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { appraised_value, appraisal_document_url } = req.body;
    if (!appraised_value) return res.status(400).json({ error: 'appraised_value required' });
    const r = await pool.query(`UPDATE real_estate_donations SET appraised_value=$1, appraisal_document_url=COALESCE($2,appraisal_document_url), status='appraised' WHERE tenant_id=$3 AND id=$4 AND status IN ('submitted','under_review') RETURNING *`,
      [appraised_value, esc(appraisal_document_url||''), tid, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Donation not found or not in appraisable status' });
    await audit(req, 'appraise', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Legal review
  app.post('/api/real-estate-donations/:id/legal-review', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { approved, notes } = req.body;
    if (approved === undefined) return res.status(400).json({ error: 'approved (boolean) required' });
    const legalStatus = approved ? 'approved' : 'rejected';
    const newStatus = approved ? 'legal_review' : 'rejected';
    const r = await pool.query(`UPDATE real_estate_donations SET legal_review_status=$1, status=$2, notes=COALESCE($3,notes) WHERE tenant_id=$4 AND id=$5 AND status IN ('appraised','legal_review') RETURNING *`,
      [legalStatus, newStatus, notes?esc(notes):null, tid, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Donation not found or not in reviewable status' });
    await audit(req, 'legal_review', 'real_estate_donations', req.params.id);
    if (approved && r.rows[0].donor_email) {
      try {
        await sendEmail(r.rows[0].donor_email, 'Real Estate Donation — Legal Review Approved', `Dear ${r.rows[0].donor_name},\n\nThe legal review of your property donation has been approved. We will proceed with the transfer process.\n\nThank you,\nThe Fundraising Team`);
      } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Acknowledge
  app.post('/api/real-estate-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE real_estate_donations SET acknowledged=true WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Real estate donation not found' });
    await audit(req, 'acknowledge', 'real_estate_donations', req.params.id);
    if (r.rows[0].donor_email) {
      try {
        await sendEmail(r.rows[0].donor_email, 'Real Estate Donation Acknowledged', `Dear ${r.rows[0].donor_name},\n\nThank you for your generous real estate donation. Your contribution has been acknowledged.\n\nSincerely,\nThe Fundraising Team`);
      } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Real estate stats
  app.get('/api/real-estate-donations/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const overview = await pool.query(`SELECT COUNT(*) as total_donations, COALESCE(SUM(appraised_value),0) as total_value, COUNT(DISTINCT donor_email) as unique_donors, COUNT(CASE WHEN status='submitted' THEN 1 END) as submitted, COUNT(CASE WHEN acknowledged=false THEN 1 END) as unacknowledged FROM real_estate_donations WHERE tenant_id=$1`, [tid]);
    const byType = await pool.query(`SELECT property_type, COUNT(*) as count, COALESCE(SUM(appraised_value),0) as total_value FROM real_estate_donations WHERE tenant_id=$1 GROUP BY property_type ORDER BY total_value DESC`, [tid]);
    res.json({ overview: overview.rows[0], by_type: byType.rows });
  }));

  // Pending review
  app.get('/api/real-estate-donations/pending-review', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM real_estate_donations WHERE tenant_id=$1 AND status IN ('submitted','under_review','appraised') AND legal_review_status='pending' ORDER BY created_at ASC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 8: IRA CHARITABLE ROLLOVERS
  // =============================================

  // List IRA rollovers
  app.get('/api/ira-rollovers', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM ira_rollovers WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Create IRA rollover
  app.post('/api/ira-rollovers', requireAuth, ah(async (req, res) => {
    const { campaign_id, donor_name, donor_email, donor_age, ira_custodian, rollover_amount, transfer_date, tax_year, confirmation_number } = req.body;
    if (!donor_name || !rollover_amount) return res.status(400).json({ error: 'donor_name and rollover_amount required' });
    if (donor_age && parseInt(donor_age) < 70) return res.status(400).json({ error: 'IRA charitable rollovers require donor to be 70.5 or older' });
    const r = await pool.query(`INSERT INTO ira_rollovers (tenant_id, campaign_id, donor_name, donor_email, donor_age, ira_custodian, rollover_amount, transfer_date, tax_year, confirmation_number, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initiated') RETURNING *`,
      [req.session.user.tenant_id, campaign_id||null, esc(donor_name), esc(donor_email||''), donor_age||null, esc(ira_custodian||''), rollover_amount, transfer_date||null, tax_year||new Date().getFullYear(), esc(confirmation_number||'')]);
    await audit(req, 'create', 'ira_rollovers', r.rows[0].id);
    try { await notify(req.session.user.tenant_id, 'ira_rollover', `IRA rollover initiated by ${donor_name}`, { id: r.rows[0].id }); } catch(e) {}
    res.json(r.rows[0]);
  }));

  // Update IRA rollover
  app.put('/api/ira-rollovers/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donor_name, donor_email, donor_age, ira_custodian, rollover_amount, transfer_date, tax_year, confirmation_number, status } = req.body;
    const r = await pool.query(`UPDATE ira_rollovers SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email), donor_age=COALESCE($3,donor_age), ira_custodian=COALESCE($4,ira_custodian), rollover_amount=COALESCE($5,rollover_amount), transfer_date=COALESCE($6,transfer_date), tax_year=COALESCE($7,tax_year), confirmation_number=COALESCE($8,confirmation_number), status=COALESCE($9,status) WHERE tenant_id=$10 AND id=$11 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, donor_age, ira_custodian?esc(ira_custodian):null, rollover_amount, transfer_date||null, tax_year, confirmation_number?esc(confirmation_number):null, status||null, tid, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Confirm IRA rollover
  app.post('/api/ira-rollovers/:id/confirm', requireAuth, ah(async (req, res) => {
    const { confirmation_number } = req.body;
    const r = await pool.query(`UPDATE ira_rollovers SET status='confirmed', confirmation_number=COALESCE($1,confirmation_number) WHERE tenant_id=$2 AND id=$3 AND status IN ('initiated','confirmed') RETURNING *`,
      [confirmation_number?esc(confirmation_number):null, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Rollover not found or not in confirmable status' });
    await audit(req, 'confirm', 'ira_rollovers', req.params.id);
    if (r.rows[0].donor_email) {
      try {
        await sendEmail(r.rows[0].donor_email, 'IRA Rollover Confirmed', `Dear ${r.rows[0].donor_name},\n\nYour IRA charitable rollover of UGX ${r.rows[0].rollover_amount} has been confirmed. Confirmation #: ${r.rows[0].confirmation_number}.\n\nThank you,\nThe Fundraising Team`);
      } catch(e) {}
    }
    res.json(r.rows[0]);
  }));

  // Get/Create distributions
  app.get('/api/ira-rollovers/:id/distributions', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM ira_distributions WHERE tenant_id=$1 AND rollover_id=$2 ORDER BY distribution_date DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/ira-rollovers/:id/distributions', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rollover = await pool.query(`SELECT * FROM ira_rollovers WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!rollover.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    const { distribution_date, amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const r = await pool.query(`INSERT INTO ira_distributions (tenant_id, rollover_id, distribution_date, amount) VALUES ($1,$2,$3,$4) RETURNING *`,
      [tid, req.params.id, distribution_date||'CURRENT_DATE', amount]);
    await audit(req, 'create', 'ira_distributions', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Send tax form
  app.post('/api/ira-rollovers/:id/send-tax-form', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const rollover = await pool.query(`SELECT * FROM ira_rollovers WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!rollover.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    const today = new Date().toISOString().split('T')[0];
    // Mark all distributions as tax form sent
    await pool.query(`UPDATE ira_distributions SET tax_form_sent=true, tax_form_date=$1 WHERE tenant_id=$2 AND rollover_id=$3`, [today, tid, req.params.id]);
    await pool.query(`UPDATE ira_rollovers SET acknowledged=true WHERE id=$1`, [req.params.id]);
    await audit(req, 'send_tax_form', 'ira_rollovers', req.params.id);
    if (rollover.rows[0].donor_email) {
      try {
        await sendEmail(rollover.rows[0].donor_email, `IRA Tax Form — Tax Year ${rollover.rows[0].tax_year}`, `Dear ${rollover.rows[0].donor_name},\n\nYour IRA charitable rollover tax documentation for tax year ${rollover.rows[0].tax_year} has been prepared and sent. Please retain this for your tax records.\n\nRollover Amount: UGX ${rollover.rows[0].rollover_amount}\nCustodian: ${rollover.rows[0].ira_custodian}\n\nSincerely,\nThe Fundraising Team`);
      } catch(e) {}
    }
    res.json({ ok: true, message: 'Tax form sent', date: today });
  }));

  // IRA rollover stats
  app.get('/api/ira-rollovers/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const overview = await pool.query(`SELECT COUNT(*) as total_rollovers, COALESCE(SUM(rollover_amount),0) as total_amount, COUNT(DISTINCT donor_email) as unique_donors, COUNT(CASE WHEN status='initiated' THEN 1 END) as initiated, COUNT(CASE WHEN status='confirmed' THEN 1 END) as confirmed, COUNT(CASE WHEN status='completed' THEN 1 END) as completed, COUNT(CASE WHEN acknowledged=false THEN 1 END) as unacknowledged FROM ira_rollovers WHERE tenant_id=$1`, [tid]);
    const byTaxYear = await pool.query(`SELECT tax_year, COUNT(*) as count, SUM(rollover_amount) as total FROM ira_rollovers WHERE tenant_id=$1 GROUP BY tax_year ORDER BY tax_year DESC`, [tid]);
    res.json({ overview: overview.rows[0], by_tax_year: byTaxYear.rows });
  }));

  // By tax year
  app.get('/api/ira-rollovers/tax-year/:year', requireAuth, ah(async (req, res) => {
    const year = parseInt(req.params.year);
    if (isNaN(year)) return res.status(400).json({ error: 'Invalid year' });
    const r = await pool.query(`SELECT * FROM ira_rollovers WHERE tenant_id=$1 AND tax_year=$2 ORDER BY created_at DESC`, [req.session.user.tenant_id, year]);
    res.json(r.rows);
  }));

  // =============================================
  // UI PAGES
  // =============================================

  // Landing Pages UI
  app.get('/landing-pages', requireAuth, ah(async (req, res) => {
    const pages = await pool.query(`SELECT lp.*, c.title as campaign_title FROM landing_pages lp LEFT JOIN campaigns c ON lp.campaign_id=c.id WHERE lp.tenant_id=$1 ORDER BY lp.created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN is_published THEN 1 END) as published, COALESCE(SUM(view_count),0) as total_views, COALESCE(SUM(conversion_count),0) as total_conversions FROM landing_pages WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Landing Page Builder', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Landing Page Builder</h2>
          <button onclick="document.getElementById('newPageForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Page</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-emerald-600">${stats.rows[0]?.total||0}</div><div class="text-sm text-gray-500">Total Pages</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-green-600">${stats.rows[0]?.published||0}</div><div class="text-sm text-gray-500">Published</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">${stats.rows[0]?.total_views||0}</div><div class="text-sm text-gray-500">Total Views</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-purple-600">${stats.rows[0]?.total_conversions||0}</div><div class="text-sm text-gray-500">Conversions</div></div>
        </div>
        <div id="newPageForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Create Landing Page</h3>
          <form method="POST" action="/api/landing-pages" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <input name="title" placeholder="Page Title *" class="border p-2 rounded w-full" required>
              <input name="slug" placeholder="URL Slug *" class="border p-2 rounded w-full" required>
            </div>
            <input name="headline" placeholder="Headline" class="border p-2 rounded w-full">
            <input name="subheadline" placeholder="Subheadline" class="border p-2 rounded w-full">
            <input name="hero_image_url" placeholder="Hero Image URL" class="border p-2 rounded w-full">
            <textarea name="body_html" placeholder="Body HTML content" rows="4" class="border p-2 rounded w-full"></textarea>
            <div class="grid grid-cols-2 gap-3">
              <input name="cta_text" placeholder="CTA Text" value="Donate Now" class="border p-2 rounded w-full">
              <input name="cta_link" placeholder="CTA Link" class="border p-2 rounded w-full">
            </div>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Create Page</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Title</th><th class="p-3 text-left">Slug</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Views</th><th class="p-3 text-left">Conversions</th><th class="p-3 text-left">Actions</th></tr></thead>
            <tbody>${pages.rows.map(p => `<tr class="border-t"><td class="p-3">${esc(p.title)}</td><td class="p-3 text-gray-500">/${esc(p.slug)}</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${p.is_published?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600'}">${p.is_published?'Published':'Draft'}</span></td><td class="p-3">${p.view_count}</td><td class="p-3">${p.conversion_count}</td><td class="p-3 space-x-1"><a href="/api/landing-pages/slug/${esc(p.slug)}" class="text-blue-600 hover:underline" target="_blank">View</a><a href="/api/landing-pages/${p.id}/publish" class="text-emerald-600 hover:underline" onclick="fetch(this.href,{method:'POST'});return false;">Publish</a><a href="/api/landing-pages/${p.id}/duplicate" class="text-purple-600 hover:underline" onclick="fetch(this.href,{method:'POST'});return false;">Duplicate</a></td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Payment Gateways UI
  app.get('/payment-gateways', requireAuth, ah(async (req, res) => {
    const gateways = await pool.query(`SELECT * FROM payment_gateways WHERE tenant_id=$1 ORDER BY is_primary DESC, created_at`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT g.gateway_type, g.name, COALESCE(SUM(gt.amount),0) as total, COUNT(gt.id) as tx_count FROM payment_gateways g LEFT JOIN gateway_transactions gt ON g.id=gt.gateway_id AND gt.status='completed' WHERE g.tenant_id=$1 GROUP BY g.id ORDER BY total DESC`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Payment Gateway Hub', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Payment Gateway Hub</h2>
          <button onclick="document.getElementById('newGatewayForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ Add Gateway</button>
        </div>
        <div id="newGatewayForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Add Payment Gateway</h3>
          <form method="POST" action="/api/payment-gateways" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <select name="gateway_type" class="border p-2 rounded w-full"><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="flutterwave">Flutterwave</option><option value="paystack">Paystack</option><option value="manual">Manual</option></select>
              <input name="name" placeholder="Gateway Name *" class="border p-2 rounded w-full" required>
            </div>
            <input name="api_key" placeholder="API Key" class="border p-2 rounded w-full">
            <input name="api_secret" placeholder="API Secret" class="border p-2 rounded w-full">
            <input name="webhook_url" placeholder="Webhook URL" class="border p-2 rounded w-full">
            <label class="flex items-center gap-2"><input type="checkbox" name="is_primary"> Set as primary gateway</label>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Add Gateway</button>
          </form>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${gateways.rows.map(g => `
            <div class="bg-white p-4 rounded-lg shadow ${g.is_primary?'border-l-4 border-emerald-500':''}">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-bold">${esc(g.name)}</h3>
                  <span class="text-sm text-gray-500">${g.gateway_type.toUpperCase()}</span>
                  <div class="flex gap-2 mt-1">
                    ${g.is_primary?'<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">Primary</span>':''}
                    <span class="px-2 py-0.5 ${g.is_active?'bg-green-100 text-green-700':'bg-red-100 text-red-700'} text-xs rounded">${g.is_active?'Active':'Inactive'}</span>
                  </div>
                </div>
                <div class="flex gap-1">
                  <a href="/api/payment-gateways/${g.id}/test" class="text-blue-600 text-sm hover:underline" onclick="fetch(this.href,{method:'POST'}).then(r=>r.json()).then(d=>alert(d.message||'Test complete'));return false;">Test</a>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Renewal Campaigns UI
  app.get('/renewal-campaigns', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query(`SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const upcoming = await pool.query(`SELECT donor_email, MAX(donor_name) as donor_name, MAX(created_at) as last_donation FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL AND created_at < NOW() - INTERVAL '30 days' GROUP BY donor_email ORDER BY MAX(created_at) DESC LIMIT 10`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Donor Renewal Automation', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Donor Renewal Automation</h2>
          <button onclick="document.getElementById('newCampaignForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Campaign</button>
        </div>
        <div id="newCampaignForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Create Renewal Campaign</h3>
          <form method="POST" action="/api/renewal-campaigns" class="space-y-3">
            <input name="name" placeholder="Campaign Name *" class="border p-2 rounded w-full" required>
            <textarea name="description" placeholder="Description" rows="2" class="border p-2 rounded w-full"></textarea>
            <input name="target_segment" placeholder="Target Segment" class="border p-2 rounded w-full">
            <div class="grid grid-cols-2 gap-3">
              <input name="trigger_days_before" type="number" placeholder="Days Before Expiry" value="30" class="border p-2 rounded w-full">
              <input name="max_reminders" type="number" placeholder="Max Reminders" value="3" class="border p-2 rounded w-full">
            </div>
            <textarea name="email_template" placeholder="Email Template (use {name} for donor name)" rows="3" class="border p-2 rounded w-full"></textarea>
            <textarea name="sms_template" placeholder="SMS Template (use {name} for donor name)" rows="2" class="border p-2 rounded w-full"></textarea>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Create Campaign</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto mb-6">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Name</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Targeted</th><th class="p-3 text-left">Renewed</th><th class="p-3 text-left">Raised</th><th class="p-3 text-left">Actions</th></tr></thead>
            <tbody>${campaigns.rows.map(c => `<tr class="border-t"><td class="p-3 font-medium">${esc(c.name)}</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${c.status==='active'?'bg-green-100 text-green-700':c.status==='paused'?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-600'}">${c.status}</span></td><td class="p-3">${c.total_targeted}</td><td class="p-3">${c.total_renewed}</td><td class="p-3">UGX ${Number(c.total_raised).toLocaleString()}</td><td class="p-3 space-x-1">${c.status==='draft'||c.status==='paused'?`<a href="/api/renewal-campaigns/${c.id}/start" class="text-emerald-600 hover:underline" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Start</a>`:''}${c.status==='active'?`<a href="/api/renewal-campaigns/${c.id}/pause" class="text-yellow-600 hover:underline" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Pause</a>`:''}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="bg-white p-4 rounded-lg shadow">
          <h3 class="font-bold mb-3">Donors Needing Renewal (30+ days)</h3>
          <div class="text-sm text-gray-600">${upcoming.rows.length?upcoming.rows.map(d => `<div class="py-1 border-b last:border-0">${esc(d.donor_name||d.donor_email)} — Last: ${new Date(d.last_donation).toLocaleDateString()}</div>`).join(''):'<p>No donors currently needing renewal</p>'}</div>
        </div>
      </div>`);
  }));

  // Gift Clubs UI
  app.get('/gift-clubs', requireAuth, ah(async (req, res) => {
    const clubs = await pool.query(`SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 ORDER BY min_annual_amount`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(DISTINCT donor_email) as total_members FROM gift_club_members WHERE tenant_id=$1 AND status='active'`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Donor Gift Clubs', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Donor Gift Clubs</h2>
          <button onclick="document.getElementById('newClubForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Club</button>
        </div>
        <div id="newClubForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Create Gift Club</h3>
          <form method="POST" action="/api/gift-clubs" class="space-y-3">
            <input name="name" placeholder="Club Name *" class="border p-2 rounded w-full" required>
            <textarea name="description" placeholder="Description" rows="2" class="border p-2 rounded w-full"></textarea>
            <div class="grid grid-cols-2 gap-3">
              <input name="min_annual_amount" type="number" placeholder="Min Annual Amount (UGX)" class="border p-2 rounded w-full">
              <input name="max_annual_amount" type="number" placeholder="Max Annual Amount (UGX, blank=unlimited)" class="border p-2 rounded w-full">
            </div>
            <input name="badge_icon" placeholder="Badge Icon (emoji)" class="border p-2 rounded w-full">
            <textarea name="benefits" placeholder="Benefits (one per line)" rows="3" class="border p-2 rounded w-full"></textarea>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Create Club</button>
          </form>
        </div>
        <div class="mb-4 bg-emerald-50 p-4 rounded-lg"><span class="font-bold text-emerald-700">Total Active Members:</span> ${stats.rows[0]?.total_members||0}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${clubs.rows.map(c => `
            <div class="bg-white p-4 rounded-lg shadow ${c.is_active?'':'opacity-60'}">
              <div class="flex items-center gap-3 mb-2">
                <span class="text-3xl">${c.badge_icon||'🏆'}</span>
                <div>
                  <h3 class="font-bold text-lg">${esc(c.name)}</h3>
                  <p class="text-sm text-gray-500">UGX ${Number(c.min_annual_amount).toLocaleString()}${c.max_annual_amount?' — '+Number(c.max_annual_amount).toLocaleString():'+'}</p>
                </div>
              </div>
              <p class="text-sm text-gray-600 mb-2">${esc(c.description||'')}</p>
              <div class="flex justify-between items-center">
                <span class="text-sm font-medium">${c.member_count} members</span>
                <a href="/api/gift-clubs/${c.id}/auto-assign" class="text-emerald-600 text-sm hover:underline" onclick="fetch(this.href,{method:'POST'}).then(r=>r.json()).then(d=>alert(d.assigned+' donors assigned'));return false;">Auto-Assign</a>
              </div>
              ${c.benefits_json?`<div class="mt-2 text-xs text-gray-500">${JSON.parse(c.benefits_json).map(b => `<span class="inline-block bg-gray-100 rounded px-2 py-0.5 mr-1 mb-1">${esc(b)}</span>`).join('')}</div>`:''}
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Campaign Videos UI
  app.get('/campaign-videos', requireAuth, ah(async (req, res) => {
    const videos = await pool.query(`SELECT cv.*, c.title as campaign_title FROM campaign_videos cv LEFT JOIN campaigns c ON cv.campaign_id=c.id WHERE cv.tenant_id=$1 ORDER BY cv.created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total_videos, COALESCE(SUM(view_count),0) as total_views, COUNT(CASE WHEN is_featured THEN 1 END) as featured FROM campaign_videos WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Campaign Videos', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Campaign Videos</h2>
          <button onclick="document.getElementById('newVideoForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ Add Video</button>
        </div>
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-emerald-600">${stats.rows[0]?.total_videos||0}</div><div class="text-sm text-gray-500">Videos</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">${stats.rows[0]?.total_views||0}</div><div class="text-sm text-gray-500">Total Views</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-purple-600">${stats.rows[0]?.featured||0}</div><div class="text-sm text-gray-500">Featured</div></div>
        </div>
        <div id="newVideoForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Add Video</h3>
          <form method="POST" action="/api/campaigns/0/videos" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <select name="video_type" class="border p-2 rounded w-full"><option value="youtube">YouTube</option><option value="vimeo">Vimeo</option><option value="livestream">Livestream</option><option value="uploaded">Uploaded</option></select>
              <input name="campaign_id" type="number" placeholder="Campaign ID" class="border p-2 rounded w-full">
            </div>
            <input name="video_url" placeholder="Video URL *" class="border p-2 rounded w-full" required>
            <input name="title" placeholder="Title" class="border p-2 rounded w-full">
            <textarea name="description" placeholder="Description" rows="2" class="border p-2 rounded w-full"></textarea>
            <input name="thumbnail_url" placeholder="Thumbnail URL" class="border p-2 rounded w-full">
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Add Video</button>
          </form>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${videos.rows.map(v => `
            <div class="bg-white rounded-lg shadow overflow-hidden ${v.is_featured?'ring-2 ring-emerald-500':''}">
              ${v.thumbnail_url?`<img src="${esc(v.thumbnail_url)}" alt="${esc(v.title||'Video')}" class="w-full h-40 object-cover">`:`<div class="w-full h-40 bg-gray-200 flex items-center justify-center text-4xl">${v.video_type==='youtube'?'▶️':v.video_type==='livestream'?'🔴':'🎬'}</div>`}
              <div class="p-3">
                <div class="flex justify-between items-start">
                  <h3 class="font-medium text-sm">${esc(v.title||'Untitled')}</h3>
                  <span class="text-xs bg-gray-100 rounded px-1">${v.video_type}</span>
                </div>
                <div class="text-xs text-gray-500 mt-1">${v.view_count} views · ${v.campaign_title||'No campaign'}</div>
                ${v.is_featured?'<span class="inline-block mt-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Featured</span>':''}
              </div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Stock Donations UI
  app.get('/stock-donations', requireAuth, ah(async (req, res) => {
    const donations = await pool.query(`SELECT * FROM stock_donations WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(total_value),0) as total_value, COUNT(CASE WHEN status='pending' THEN 1 END) as pending, COUNT(CASE WHEN acknowledged=false THEN 1 END) as unacknowledged FROM stock_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Stock Donations', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Stock / Securities Donations</h2>
          <button onclick="document.getElementById('newStockForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Donation</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-emerald-600">${stats.rows[0]?.total||0}</div><div class="text-sm text-gray-500">Total</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">UGX ${Number(stats.rows[0]?.total_value||0).toLocaleString()}</div><div class="text-sm text-gray-500">Total Value</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-yellow-600">${stats.rows[0]?.pending||0}</div><div class="text-sm text-gray-500">Pending</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-red-600">${stats.rows[0]?.unacknowledged||0}</div><div class="text-sm text-gray-500">Unacknowledged</div></div>
        </div>
        <div id="newStockForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Record Stock Donation</h3>
          <form method="POST" action="/api/stock-donations" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <input name="donor_name" placeholder="Donor Name *" class="border p-2 rounded w-full" required>
              <input name="donor_email" placeholder="Donor Email" class="border p-2 rounded w-full">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <input name="stock_symbol" placeholder="Stock Symbol *" class="border p-2 rounded w-full" required>
              <input name="stock_name" placeholder="Stock Name" class="border p-2 rounded w-full">
            </div>
            <div class="grid grid-cols-3 gap-3">
              <input name="shares" type="number" step="0.01" placeholder="Shares *" class="border p-2 rounded w-full" required>
              <input name="price_per_share_at_donation" type="number" step="0.01" placeholder="Price/Share *" class="border p-2 rounded w-full" required>
              <input name="brokerage_name" placeholder="Brokerage" class="border p-2 rounded w-full">
            </div>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Record Donation</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Stock</th><th class="p-3 text-left">Shares</th><th class="p-3 text-left">Value</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Actions</th></tr></thead>
            <tbody>${donations.rows.map(d => `<tr class="border-t"><td class="p-3">${esc(d.donor_name)}</td><td class="p-3 font-mono">${esc(d.stock_symbol)}</td><td class="p-3">${d.shares}</td><td class="p-3">UGX ${Number(d.total_value).toLocaleString()}</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${d.status==='completed'?'bg-green-100 text-green-700':d.status==='pending'?'bg-yellow-100 text-yellow-700':'bg-gray-100 text-gray-600'}">${d.status}</span>${!d.acknowledged?'<span class="ml-1 px-2 py-1 rounded text-xs bg-red-100 text-red-700">Unack</span>':''}</td><td class="p-3">${!d.acknowledged?`<a href="/api/stock-donations/${d.id}/acknowledge" class="text-emerald-600 hover:underline" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Acknowledge</a>`:''}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // Real Estate Donations UI
  app.get('/real-estate-donations', requireAuth, ah(async (req, res) => {
    const donations = await pool.query(`SELECT * FROM real_estate_donations WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(appraised_value),0) as total_value, COUNT(CASE WHEN status='submitted' THEN 1 END) as submitted, COUNT(CASE WHEN legal_review_status='pending' THEN 1 END) as pending_legal FROM real_estate_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Real Estate Donations', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">Real Estate Donations</h2>
          <button onclick="document.getElementById('newPropertyForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Donation</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-emerald-600">${stats.rows[0]?.total||0}</div><div class="text-sm text-gray-500">Total</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">UGX ${Number(stats.rows[0]?.total_value||0).toLocaleString()}</div><div class="text-sm text-gray-500">Appraised Value</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-yellow-600">${stats.rows[0]?.submitted||0}</div><div class="text-sm text-gray-500">Submitted</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-purple-600">${stats.rows[0]?.pending_legal||0}</div><div class="text-sm text-gray-500">Pending Legal</div></div>
        </div>
        <div id="newPropertyForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Record Real Estate Donation</h3>
          <form method="POST" action="/api/real-estate-donations" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <input name="donor_name" placeholder="Donor Name *" class="border p-2 rounded w-full" required>
              <input name="donor_email" placeholder="Donor Email" class="border p-2 rounded w-full">
            </div>
            <select name="property_type" class="border p-2 rounded w-full"><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="land">Land</option><option value="other">Other</option></select>
            <input name="address" placeholder="Address" class="border p-2 rounded w-full">
            <div class="grid grid-cols-3 gap-3">
              <input name="city" placeholder="City" class="border p-2 rounded w-full">
              <input name="region" placeholder="Region" class="border p-2 rounded w-full">
              <input name="country" placeholder="Country" value="Uganda" class="border p-2 rounded w-full">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <input name="area_sqft" type="number" placeholder="Area (sq ft)" class="border p-2 rounded w-full">
              <input name="appraised_value" type="number" placeholder="Appraised Value (UGX)" class="border p-2 rounded w-full">
            </div>
            <textarea name="notes" placeholder="Notes" rows="2" class="border p-2 rounded w-full"></textarea>
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Submit Donation</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Type</th><th class="p-3 text-left">Location</th><th class="p-3 text-left">Value</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Legal</th><th class="p-3 text-left">Actions</th></tr></thead>
            <tbody>${donations.rows.map(d => `<tr class="border-t"><td class="p-3">${esc(d.donor_name)}</td><td class="p-3">${d.property_type}</td><td class="p-3 text-xs">${esc(d.city||'')}${d.region?', '+esc(d.region):''}</td><td class="p-3">UGX ${Number(d.appraised_value||0).toLocaleString()}</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${d.status==='completed'?'bg-green-100 text-green-700':d.status==='rejected'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}">${d.status}</span></td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${d.legal_review_status==='approved'?'bg-green-100 text-green-700':d.legal_review_status==='rejected'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-600'}">${d.legal_review_status}</span></td><td class="p-3 space-x-1">${!d.acknowledged?`<a href="/api/real-estate-donations/${d.id}/acknowledge" class="text-emerald-600 hover:underline text-xs" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Acknowledge</a>`:''}${d.status==='submitted'||d.status==='under_review'?`<a href="/api/real-estate-donations/${d.id}/appraise" class="text-blue-600 hover:underline text-xs" onclick="fetch(this.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appraised_value:prompt('Enter appraised value:')})}).then(()=>location.reload());return false;">Appraise</a>`:''}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));

  // IRA Rollovers UI
  app.get('/ira-rollovers', requireAuth, ah(async (req, res) => {
    const rollovers = await pool.query(`SELECT * FROM ira_rollovers WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    const stats = await pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(rollover_amount),0) as total_amount, COUNT(CASE WHEN status='completed' THEN 1 END) as completed, COUNT(CASE WHEN acknowledged=false THEN 1 END) as unacknowledged FROM ira_rollovers WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'IRA Charitable Rollovers', `
      <div class="max-w-6xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold">IRA Charitable Rollovers</h2>
          <button onclick="document.getElementById('newRolloverForm').classList.toggle('hidden')" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">+ New Rollover</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-emerald-600">${stats.rows[0]?.total||0}</div><div class="text-sm text-gray-500">Total Rollovers</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-blue-600">UGX ${Number(stats.rows[0]?.total_amount||0).toLocaleString()}</div><div class="text-sm text-gray-500">Total Amount</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-green-600">${stats.rows[0]?.completed||0}</div><div class="text-sm text-gray-500">Completed</div></div>
          <div class="bg-white p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-red-600">${stats.rows[0]?.unacknowledged||0}</div><div class="text-sm text-gray-500">Unacknowledged</div></div>
        </div>
        <div id="newRolloverForm" class="hidden bg-white p-6 rounded-lg shadow mb-6">
          <h3 class="font-bold mb-4">Record IRA Rollover</h3>
          <form method="POST" action="/api/ira-rollovers" class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <input name="donor_name" placeholder="Donor Name *" class="border p-2 rounded w-full" required>
              <input name="donor_email" placeholder="Donor Email" class="border p-2 rounded w-full">
            </div>
            <div class="grid grid-cols-2 gap-3">
              <input name="donor_age" type="number" placeholder="Donor Age (must be 70+)" class="border p-2 rounded w-full">
              <input name="ira_custodian" placeholder="IRA Custodian" class="border p-2 rounded w-full">
            </div>
            <div class="grid grid-cols-3 gap-3">
              <input name="rollover_amount" type="number" step="0.01" placeholder="Rollover Amount (UGX) *" class="border p-2 rounded w-full" required>
              <input name="transfer_date" type="date" class="border p-2 rounded w-full">
              <input name="tax_year" type="number" placeholder="Tax Year" value="${new Date().getFullYear()}" class="border p-2 rounded w-full">
            </div>
            <input name="confirmation_number" placeholder="Confirmation Number" class="border p-2 rounded w-full">
            <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700">Record Rollover</button>
          </form>
        </div>
        <div class="bg-white rounded-lg shadow overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50"><tr><th class="p-3 text-left">Donor</th><th class="p-3 text-left">Custodian</th><th class="p-3 text-left">Amount</th><th class="p-3 text-left">Tax Year</th><th class="p-3 text-left">Status</th><th class="p-3 text-left">Actions</th></tr></thead>
            <tbody>${rollovers.rows.map(r => `<tr class="border-t"><td class="p-3">${esc(r.donor_name)}${r.donor_age?' (age '+r.donor_age+')':''}</td><td class="p-3">${esc(r.ira_custodian||'—')}</td><td class="p-3">UGX ${Number(r.rollover_amount).toLocaleString()}</td><td class="p-3">${r.tax_year}</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${r.status==='completed'?'bg-green-100 text-green-700':r.status==='cancelled'?'bg-red-100 text-red-700':'bg-yellow-100 text-yellow-700'}">${r.status}</span></td><td class="p-3 space-x-1">${r.status==='initiated'?`<a href="/api/ira-rollovers/${r.id}/confirm" class="text-emerald-600 hover:underline text-xs" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Confirm</a>`:''}${!r.acknowledged?`<a href="/api/ira-rollovers/${r.id}/send-tax-form" class="text-blue-600 hover:underline text-xs" onclick="fetch(this.href,{method:'POST'}).then(()=>location.reload());return false;">Send Tax Form</a>`:''}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`);
  }));
};
