/**
 * Fundraising Ultimate10 — Digital Presence & Alternative Assets
 * 8 Features: Landing Page Builder, Payment Gateway Hub, Donor Renewal,
 * Gift Clubs, Video Integration, Stock/Securities, Real Estate, IRA Rollovers
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // ================================================================
  // INLINE MIGRATIONS
  // ================================================================
  const migrations = [
    // F1: Landing Page Builder
    `CREATE TABLE IF NOT EXISTS landing_pages (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      body_html TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      hero_image_url TEXT DEFAULT '',
      theme TEXT DEFAULT 'default',
      cta_text TEXT DEFAULT 'Donate Now',
      cta_url TEXT DEFAULT '',
      is_published BOOLEAN DEFAULT false,
      view_count INTEGER DEFAULT 0,
      conversion_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS landing_page_versions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES landing_pages(id) ON DELETE CASCADE,
      version_number INTEGER DEFAULT 1,
      body_html TEXT DEFAULT '',
      saved_by TEXT DEFAULT '',
      saved_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS landing_page_sections (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES landing_pages(id) ON DELETE CASCADE,
      section_type TEXT DEFAULT 'text',
      section_order INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      settings_json TEXT DEFAULT '{}',
      is_visible BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_landing_pages_tenant ON landing_pages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_landing_page_versions_tenant ON landing_page_versions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_landing_page_sections_tenant ON landing_page_sections(tenant_id)`,

    // F2: Payment Gateway Hub
    `CREATE TABLE IF NOT EXISTS payment_gateways (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      gateway_name TEXT NOT NULL,
      gateway_type TEXT DEFAULT 'manual',
      api_key TEXT DEFAULT '',
      api_secret TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      merchant_id TEXT DEFAULT '',
      sandbox_mode BOOLEAN DEFAULT true,
      fee_percentage NUMERIC DEFAULT 0,
      flat_fee NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      is_active BOOLEAN DEFAULT true,
      is_default BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gateway_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      gateway_id INTEGER REFERENCES payment_gateways(id),
      campaign_id INTEGER,
      external_tx_id TEXT DEFAULT '',
      donor_name TEXT DEFAULT '',
      donor_email TEXT DEFAULT '',
      amount NUMERIC DEFAULT 0,
      fee_amount NUMERIC DEFAULT 0,
      net_amount NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      payment_method TEXT DEFAULT 'card',
      status TEXT DEFAULT 'pending',
      metadata_json TEXT DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gateway_payouts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      gateway_id INTEGER REFERENCES payment_gateways(id),
      amount NUMERIC DEFAULT 0,
      fee_deducted NUMERIC DEFAULT 0,
      payout_method TEXT DEFAULT 'bank_transfer',
      reference TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_payment_gateways_tenant ON payment_gateways(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gateway_transactions_tenant ON gateway_transactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gateway_payouts_tenant ON gateway_payouts(tenant_id)`,

    // F3: Donor Renewal
    `CREATE TABLE IF NOT EXISTS donor_renewal_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      target_segment TEXT DEFAULT 'lapsed',
      start_date DATE,
      end_date DATE,
      goal_amount NUMERIC DEFAULT 0,
      raised_amount NUMERIC DEFAULT 0,
      renewal_count INTEGER DEFAULT 0,
      target_count INTEGER DEFAULT 0,
      email_template TEXT DEFAULT '',
      sms_template TEXT DEFAULT '',
      auto_remind BOOLEAN DEFAULT false,
      remind_interval_days INTEGER DEFAULT 14,
      status TEXT DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS renewal_reminders (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES donor_renewal_campaigns(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      donor_name TEXT DEFAULT '',
      donor_phone TEXT DEFAULT '',
      reminder_type TEXT DEFAULT 'email',
      message TEXT DEFAULT '',
      sent_at TIMESTAMPTZ,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      responded BOOLEAN DEFAULT false,
      response_amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS donor_renewal_segments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      segment_name TEXT NOT NULL,
      criteria_json TEXT DEFAULT '{}',
      donor_count INTEGER DEFAULT 0,
      avg_gift NUMERIC DEFAULT 0,
      last_calculated TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_donor_renewal_tenant ON donor_renewal_campaigns(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_renewal_reminders_tenant ON renewal_reminders(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_renewal_segments_tenant ON donor_renewal_segments(tenant_id)`,

    // F4: Gift Clubs
    `CREATE TABLE IF NOT EXISTS donor_gift_clubs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      club_name TEXT NOT NULL,
      min_amount NUMERIC DEFAULT 0,
      max_amount NUMERIC,
      description TEXT DEFAULT '',
      benefits TEXT DEFAULT '',
      color TEXT DEFAULT '#10b981',
      icon TEXT DEFAULT 'award',
      welcome_email_subject TEXT DEFAULT '',
      welcome_email_body TEXT DEFAULT '',
      annual_event TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gift_club_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      club_id INTEGER REFERENCES donor_gift_clubs(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      donor_email TEXT DEFAULT '',
      donor_phone TEXT DEFAULT '',
      total_donated NUMERIC DEFAULT 0,
      membership_start_date DATE DEFAULT CURRENT_DATE,
      last_gift_date DATE,
      last_gift_amount NUMERIC DEFAULT 0,
      welcome_sent BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      joined_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS gift_club_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      club_id INTEGER REFERENCES donor_gift_clubs(id),
      event_name TEXT NOT NULL,
      event_date DATE,
      venue TEXT DEFAULT '',
      description TEXT DEFAULT '',
      attendee_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_donor_gift_clubs_tenant ON donor_gift_clubs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gift_club_members_tenant ON gift_club_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_gift_club_events_tenant ON gift_club_events(tenant_id)`,

    // F5: Video Integration
    `CREATE TABLE IF NOT EXISTS campaign_videos (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      video_type TEXT DEFAULT 'youtube',
      thumbnail_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      duration_seconds INTEGER DEFAULT 0,
      is_live BOOLEAN DEFAULT false,
      is_featured BOOLEAN DEFAULT false,
      scheduled_at TIMESTAMPTZ,
      view_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      share_count INTEGER DEFAULT 0,
      transcript_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS video_engagement (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      video_id INTEGER REFERENCES campaign_videos(id) ON DELETE CASCADE,
      viewer_email TEXT DEFAULT '',
      viewer_ip TEXT DEFAULT '',
      watch_time_seconds INTEGER DEFAULT 0,
      completed BOOLEAN DEFAULT false,
      liked BOOLEAN DEFAULT false,
      shared BOOLEAN DEFAULT false,
      source TEXT DEFAULT 'direct',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS video_playlists (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      video_ids_json TEXT DEFAULT '[]',
      is_public BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_videos_tenant ON campaign_videos(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_video_engagement_tenant ON video_engagement(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_video_playlists_tenant ON video_playlists(tenant_id)`,

    // F6: Stock/Securities
    `CREATE TABLE IF NOT EXISTS stock_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      donor_email TEXT DEFAULT '',
      donor_phone TEXT DEFAULT '',
      company_name TEXT NOT NULL,
      ticker_symbol TEXT DEFAULT '',
      number_of_shares NUMERIC DEFAULT 0,
      share_price NUMERIC DEFAULT 0,
      total_value NUMERIC DEFAULT 0,
      brokerage_name TEXT DEFAULT '',
      brokerage_contact TEXT DEFAULT '',
      dtc_number TEXT DEFAULT '',
      transfer_date DATE,
      transfer_method TEXT DEFAULT 'dwtc',
      mean_price_on_date NUMERIC DEFAULT 0,
      acknowledged BOOLEAN DEFAULT false,
      acknowledgment_sent_at TIMESTAMPTZ,
      tax_letter_sent BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stock_valuations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      stock_donation_id INTEGER REFERENCES stock_donations(id),
      valuation_date DATE NOT NULL,
      share_price NUMERIC DEFAULT 0,
      total_value NUMERIC DEFAULT 0,
      high_price NUMERIC DEFAULT 0,
      low_price NUMERIC DEFAULT 0,
      appraiser TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS stock_transfer_docs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      stock_donation_id INTEGER REFERENCES stock_donations(id),
      doc_type TEXT DEFAULT 'transfer_form',
      doc_name TEXT DEFAULT '',
      doc_url TEXT DEFAULT '',
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_stock_donations_tenant ON stock_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_valuations_tenant ON stock_valuations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stock_transfer_docs_tenant ON stock_transfer_docs(tenant_id)`,

    // F7: Real Estate
    `CREATE TABLE IF NOT EXISTS real_estate_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      donor_email TEXT DEFAULT '',
      donor_phone TEXT DEFAULT '',
      property_name TEXT NOT NULL,
      property_address TEXT DEFAULT '',
      property_type TEXT DEFAULT 'residential',
      square_footage NUMERIC DEFAULT 0,
      lot_size NUMERIC DEFAULT 0,
      year_built INTEGER,
      appraised_value NUMERIC DEFAULT 0,
      appraised_by TEXT DEFAULT '',
      appraisal_date DATE,
      legal_description TEXT DEFAULT '',
      deed_number TEXT DEFAULT '',
      title_search_status TEXT DEFAULT 'pending',
      environmental_status TEXT DEFAULT 'pending',
      tax_lien_check TEXT DEFAULT 'pending',
      insurance_status TEXT DEFAULT 'pending',
      status TEXT DEFAULT 'pending',
      appraisal_status TEXT DEFAULT 'pending',
      legal_review_status TEXT DEFAULT 'pending',
      acceptance_date DATE,
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS real_estate_documents (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      property_id INTEGER REFERENCES real_estate_donations(id),
      doc_type TEXT DEFAULT 'deed',
      doc_name TEXT DEFAULT '',
      doc_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS real_estate_appraisals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      property_id INTEGER REFERENCES real_estate_donations(id),
      appraiser_name TEXT DEFAULT '',
      appraiser_license TEXT DEFAULT '',
      appraised_value NUMERIC DEFAULT 0,
      appraisal_date DATE,
      market_value NUMERIC DEFAULT 0,
      condition TEXT DEFAULT 'fair',
      methodology TEXT DEFAULT '',
      report_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_real_estate_donations_tenant ON real_estate_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_real_estate_documents_tenant ON real_estate_documents(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_real_estate_appraisals_tenant ON real_estate_appraisals(tenant_id)`,

    // F8: IRA Rollovers
    `CREATE TABLE IF NOT EXISTS ira_rollovers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      donor_email TEXT DEFAULT '',
      donor_phone TEXT DEFAULT '',
      donor_ssn_last4 TEXT DEFAULT '',
      ira_type TEXT DEFAULT 'traditional',
      custodian_name TEXT DEFAULT '',
      custodian_account TEXT DEFAULT '',
      custodian_phone TEXT DEFAULT '',
      distribution_amount NUMERIC DEFAULT 0,
      distribution_date DATE,
      transfer_method TEXT DEFAULT 'direct',
      is_qcd BOOLEAN DEFAULT false,
      qcd_age_verified BOOLEAN DEFAULT false,
      tax_form_sent BOOLEAN DEFAULT false,
      tax_form_sent_at TIMESTAMPTZ,
      acknowledgment_sent BOOLEAN DEFAULT false,
      acknowledged_at TIMESTAMPTZ,
      confirmed BOOLEAN DEFAULT false,
      confirmed_at TIMESTAMPTZ,
      confirmed_by TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ira_distributions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ira_rollover_id INTEGER REFERENCES ira_rollovers(id),
      distribution_amount NUMERIC DEFAULT 0,
      distribution_date DATE,
      check_number TEXT DEFAULT '',
      wire_reference TEXT DEFAULT '',
      received_date DATE,
      deposit_date DATE,
      deposit_account TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ira_tax_documents (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ira_rollover_id INTEGER REFERENCES ira_rollovers(id),
      doc_type TEXT DEFAULT 'acknowledgment',
      doc_name TEXT DEFAULT '',
      doc_url TEXT DEFAULT '',
      tax_year INTEGER,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ira_rollovers_tenant ON ira_rollovers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ira_distributions_tenant ON ira_distributions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ira_tax_documents_tenant ON ira_tax_documents(tenant_id)`,
  ];

  // Run migrations + seed per tenant
  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate10] Migrations complete');
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        // Seed: default manual payment gateway
        await pool.query(
          `INSERT INTO payment_gateways (tenant_id, gateway_name, gateway_type, is_active, is_default)
           SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS (SELECT 1 FROM payment_gateways WHERE tenant_id=$1 AND gateway_type=$3)`,
          [t.id, 'Manual/Offline', 'manual', true, true]
        );
        // Seed: 4 gift clubs per tenant
        const clubs = [
          { club_name: 'Bronze Circle', min_amount: 0, max_amount: 500000, description: 'Donors contributing up to UGX 500,000', benefits: 'Certificate of appreciation, Newsletter', color: '#cd7f32', icon: 'award', welcome_email_subject: 'Welcome to the Bronze Circle!', welcome_email_body: 'Thank you for joining our Bronze Circle. Your generosity makes a difference.' },
          { club_name: 'Silver Circle', min_amount: 500000, max_amount: 2000000, description: 'Donors contributing UGX 500K - 2M', benefits: 'Bronze benefits + Annual report, Event invitations', color: '#c0c0c0', icon: 'award', welcome_email_subject: 'Welcome to the Silver Circle!', welcome_email_body: 'We are delighted to welcome you to our Silver Circle. Enjoy exclusive event invitations and reports.' },
          { club_name: 'Gold Circle', min_amount: 2000000, max_amount: 10000000, description: 'Donors contributing UGX 2M - 10M', benefits: 'Silver benefits + Dedicated contact, VIP events', color: '#ffd700', icon: 'crown', welcome_email_subject: 'Welcome to the Gold Circle!', welcome_email_body: 'Congratulations on joining the Gold Circle. You now have a dedicated contact and VIP event access.' },
          { club_name: 'Platinum Circle', min_amount: 10000000, max_amount: null, description: 'Donors contributing over UGX 10M', benefits: 'Gold benefits + Board meeting access, Named opportunities', color: '#e5e4e2', icon: 'gem', welcome_email_subject: 'Welcome to the Platinum Circle!', welcome_email_body: 'As a Platinum Circle member, you are among our most valued supporters. Enjoy board access and naming opportunities.' }
        ];
        for (const c of clubs) {
          await pool.query(
            `INSERT INTO donor_gift_clubs (tenant_id,club_name,min_amount,max_amount,description,benefits,color,icon,welcome_email_subject,welcome_email_body)
             SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE NOT EXISTS (SELECT 1 FROM donor_gift_clubs WHERE tenant_id=$1 AND club_name=$2)`,
            [t.id, c.club_name, c.min_amount, c.max_amount, c.description, c.benefits, c.color, c.icon, c.welcome_email_subject, c.welcome_email_body]
          );
        }
        // Seed: default donor segments
        const segments = [
          { segment_name: 'Lapsed Donors', criteria_json: '{"last_gift":"12m+"}' },
          { segment_name: 'Active Donors', criteria_json: '{"last_gift":"6m"}' },
          { segment_name: 'Major Donors', criteria_json: '{"total_given":"10000000+"}' },
          { segment_name: 'First-Time Donors', criteria_json: '{"gift_count":1}' }
        ];
        for (const s of segments) {
          await pool.query(
            `INSERT INTO donor_renewal_segments (tenant_id, segment_name, criteria_json)
             SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM donor_renewal_segments WHERE tenant_id=$1 AND segment_name=$2)`,
            [t.id, s.segment_name, s.criteria_json]
          );
        }
      }
      console.log('[FundraisingUltimate10] Seed data complete');
    } catch(e) {
      console.warn('[FundraisingUltimate10] Seed error:', e.message);
    }
  })();

  // ================================================================
  // FEATURE 1: LANDING PAGE BUILDER
  // ================================================================

  // List all landing pages
  app.get('/api/landing-pages', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT id, tenant_id, title, slug, meta_description, hero_image_url, theme, cta_text, is_published, view_count, conversion_count, created_at, updated_at FROM landing_pages WHERE tenant_id=$1 ORDER BY created_at DESC',
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Get single landing page
  app.get('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM landing_pages WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    res.json(r.rows[0]);
  }));

  // Create landing page
  app.post('/api/landing-pages', requireAuth, ah(async (req, res) => {
    const { title, slug, body_html, meta_description, hero_image_url, theme, cta_text, cta_url } = req.body;
    if (!title || !slug) return res.status(400).json({ error: 'title and slug required' });
    const r = await pool.query(
      'INSERT INTO landing_pages (tenant_id,title,slug,body_html,meta_description,hero_image_url,theme,cta_text,cta_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.session.user.tenant_id, esc(title), esc(slug), esc(body_html||''), esc(meta_description||''), esc(hero_image_url||''), esc(theme||'default'), esc(cta_text||'Donate Now'), esc(cta_url||'')]
    );
    await pool.query(
      'INSERT INTO landing_page_versions (tenant_id,page_id,version_number,body_html,saved_by) VALUES ($1,$2,1,$3,$4)',
      [req.session.user.tenant_id, r.rows[0].id, esc(body_html||''), esc(req.session.user.name||'')]
    );
    await audit(req, 'create', 'landing_pages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update landing page
  app.put('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    const { title, body_html, meta_description, hero_image_url, theme, cta_text, cta_url } = req.body;
    const r = await pool.query(
      `UPDATE landing_pages SET title=COALESCE($1,title), body_html=COALESCE($2,body_html),
       meta_description=COALESCE($3,meta_description), hero_image_url=COALESCE($4,hero_image_url),
       theme=COALESCE($5,theme), cta_text=COALESCE($6,cta_text), cta_url=COALESCE($7,cta_url),
       updated_at=NOW() WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [title?esc(title):null, body_html?esc(body_html):null, meta_description?esc(meta_description):null,
       hero_image_url?esc(hero_image_url):null, theme?esc(theme):null, cta_text?esc(cta_text):null,
       cta_url?esc(cta_url):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    if (body_html) {
      const maxVer = await pool.query('SELECT MAX(version_number) as v FROM landing_page_versions WHERE page_id=$1', [req.params.id]);
      const nextVer = (maxVer.rows[0]?.v || 0) + 1;
      await pool.query(
        'INSERT INTO landing_page_versions (tenant_id,page_id,version_number,body_html,saved_by) VALUES ($1,$2,$3,$4,$5)',
        [req.session.user.tenant_id, req.params.id, nextVer, esc(body_html), esc(req.session.user.name||'')]
      );
    }
    await audit(req, 'update', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete landing page
  app.delete('/api/landing-pages/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM landing_pages WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    await audit(req, 'delete', 'landing_pages', req.params.id);
    res.json({ ok: true });
  }));

  // Publish landing page
  app.post('/api/landing-pages/:id/publish', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE landing_pages SET is_published=true, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    await audit(req, 'update', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Unpublish landing page
  app.post('/api/landing-pages/:id/unpublish', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE landing_pages SET is_published=false, updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    await audit(req, 'update', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Duplicate landing page
  app.post('/api/landing-pages/:id/duplicate', requireAuth, ah(async (req, res) => {
    const orig = await pool.query('SELECT * FROM landing_pages WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!orig.rows.length) return res.status(404).json({ error: 'Landing page not found' });
    const o = orig.rows[0];
    const r = await pool.query(
      'INSERT INTO landing_pages (tenant_id,title,slug,body_html,meta_description,hero_image_url,theme,cta_text,cta_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.session.user.tenant_id, esc(o.title + ' (Copy)'), esc(o.slug + '-copy-' + Date.now()), esc(o.body_html||''), esc(o.meta_description||''), esc(o.hero_image_url||''), esc(o.theme||'default'), esc(o.cta_text||'Donate Now'), esc(o.cta_url||'')]
    );
    await audit(req, 'create', 'landing_pages', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Track view (public, no auth)
  app.post('/api/landing-pages/:id/track-view', ah(async (req, res) => {
    await pool.query('UPDATE landing_pages SET view_count=view_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.body.tenant_id]);
    res.json({ ok: true });
  }));

  // Track conversion (public, no auth)
  app.post('/api/landing-pages/:id/track-conversion', ah(async (req, res) => {
    await pool.query('UPDATE landing_pages SET conversion_count=conversion_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.body.tenant_id]);
    res.json({ ok: true });
  }));

  // Get page by slug (public)
  app.get('/api/landing-pages/slug/:slug', ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM landing_pages WHERE slug=$1 AND is_published=true', [req.params.slug]);
    if (!r.rows.length) return res.status(404).json({ error: 'Page not found' });
    await pool.query('UPDATE landing_pages SET view_count=view_count+1 WHERE id=$1 AND tenant_id=$2', [r.rows[0].id, r.rows[0].tenant_id]);
    res.json(r.rows[0]);
  }));

  // Get page versions
  app.get('/api/landing-pages/:id/versions', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM landing_page_versions WHERE tenant_id=$1 AND page_id=$2 ORDER BY version_number DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Restore a version
  app.post('/api/landing-pages/:id/restore-version/:versionId', requireAuth, ah(async (req, res) => {
    const ver = await pool.query('SELECT * FROM landing_page_versions WHERE tenant_id=$1 AND page_id=$2 AND id=$3', [req.session.user.tenant_id, req.params.id, req.params.versionId]);
    if (!ver.rows.length) return res.status(404).json({ error: 'Version not found' });
    const maxVer = await pool.query('SELECT MAX(version_number) as v FROM landing_page_versions WHERE page_id=$1', [req.params.id]);
    const nextVer = (maxVer.rows[0]?.v || 0) + 1;
    await pool.query(
      'INSERT INTO landing_page_versions (tenant_id,page_id,version_number,body_html,saved_by) VALUES ($1,$2,$3,$4,$5)',
      [req.session.user.tenant_id, req.params.id, nextVer, ver.rows[0].body_html, esc(req.session.user.name||'')]
    );
    const r = await pool.query('UPDATE landing_pages SET body_html=$1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *', [ver.rows[0].body_html, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'landing_pages', req.params.id);
    res.json(r.rows[0]);
  }));

  // Section CRUD
  app.get('/api/landing-pages/:id/sections', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM landing_page_sections WHERE tenant_id=$1 AND page_id=$2 ORDER BY section_order', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/landing-pages/:id/sections', requireAuth, ah(async (req, res) => {
    const { section_type, section_order, title, content, image_url, settings_json, is_visible } = req.body;
    const r = await pool.query(
      'INSERT INTO landing_page_sections (tenant_id,page_id,section_type,section_order,title,content,image_url,settings_json,is_visible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(section_type||'text'), section_order||0, esc(title||''), esc(content||''), esc(image_url||''), JSON.stringify(settings_json||{}), is_visible!==undefined?is_visible:true]
    );
    await audit(req, 'create', 'landing_page_sections', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/landing-page-sections/:sectionId', requireAuth, ah(async (req, res) => {
    const { section_type, section_order, title, content, image_url, settings_json, is_visible } = req.body;
    const r = await pool.query(
      `UPDATE landing_page_sections SET section_type=COALESCE($1,section_type), section_order=COALESCE($2,section_order),
       title=COALESCE($3,title), content=COALESCE($4,content), image_url=COALESCE($5,image_url),
       settings_json=COALESCE($6,settings_json), is_visible=COALESCE($7,is_visible)
       WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [section_type?esc(section_type):null, section_order, title?esc(title):null, content?esc(content):null,
       image_url?esc(image_url):null, settings_json?JSON.stringify(settings_json):null, is_visible,
       req.session.user.tenant_id, req.params.sectionId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Section not found' });
    await audit(req, 'update', 'landing_page_sections', req.params.sectionId);
    res.json(r.rows[0]);
  }));

  app.delete('/api/landing-page-sections/:sectionId', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM landing_page_sections WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.sectionId]);
    await audit(req, 'delete', 'landing_page_sections', req.params.sectionId);
    res.json({ ok: true });
  }));

  // Landing page analytics
  app.get('/api/landing-pages/analytics/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT COUNT(*) as total_pages, COUNT(CASE WHEN is_published THEN 1 END) as published, COALESCE(SUM(view_count),0) as total_views, COALESCE(SUM(conversion_count),0) as total_conversions FROM landing_pages WHERE tenant_id=$1',
      [req.session.user.tenant_id]
    );
    res.json(r.rows[0]);
  }));

  // Page route
  app.get('/landing-pages', requireAuth, ah(async (req, res) => {
    const pages = await pool.query('SELECT * FROM landing_pages WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(view_count),0) as views, COALESCE(SUM(conversion_count),0) as conversions FROM landing_pages WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Landing Pages', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Landing Page Builder</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Pages</p><p class="text-2xl font-bold text-emerald-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Views</p><p class="text-2xl font-bold text-emerald-700">${stats.rows[0]?.views||0}</p></div>
        <div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Conversions</p><p class="text-2xl font-bold text-emerald-700">${stats.rows[0]?.conversions||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${pages.rows.map(p => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(p.title)}</h3>
        <p class="text-sm text-gray-500">/${esc(p.slug)} | Views: ${p.view_count} | Conversions: ${p.conversion_count} | ${p.is_published?'<span class="text-emerald-600">Published</span>':'<span class="text-gray-400">Draft</span>'}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 2: PAYMENT GATEWAY HUB
  // ================================================================

  // List gateways (never expose api_key/api_secret in list)
  app.get('/api/payment-gateways', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT id, tenant_id, gateway_name, gateway_type, webhook_url, merchant_id, sandbox_mode, fee_percentage, flat_fee, currency, is_active, is_default, created_at FROM payment_gateways WHERE tenant_id=$1 ORDER BY created_at',
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Get single gateway
  app.get('/api/payment-gateways/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT id, tenant_id, gateway_name, gateway_type, webhook_url, merchant_id, sandbox_mode, fee_percentage, flat_fee, currency, is_active, is_default, created_at FROM payment_gateways WHERE tenant_id=$1 AND id=$2',
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    res.json(r.rows[0]);
  }));

  // Create gateway
  app.post('/api/payment-gateways', requireAuth, ah(async (req, res) => {
    const { gateway_name, gateway_type, api_key, api_secret, webhook_url, merchant_id, sandbox_mode, fee_percentage, flat_fee, currency, is_active, is_default } = req.body;
    if (!gateway_name || !gateway_type) return res.status(400).json({ error: 'gateway_name and gateway_type required' });
    const r = await pool.query(
      `INSERT INTO payment_gateways (tenant_id,gateway_name,gateway_type,api_key,api_secret,webhook_url,merchant_id,sandbox_mode,fee_percentage,flat_fee,currency,is_active,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, tenant_id, gateway_name, gateway_type, webhook_url, merchant_id, sandbox_mode, fee_percentage, flat_fee, currency, is_active, is_default`,
      [req.session.user.tenant_id, esc(gateway_name), esc(gateway_type), esc(api_key||''), esc(api_secret||''), esc(webhook_url||''), esc(merchant_id||''), sandbox_mode!==undefined?sandbox_mode:true, fee_percentage||0, flat_fee||0, esc(currency||'UGX'), is_active!==undefined?is_active:true, is_default||false]
    );
    if (is_default) await pool.query('UPDATE payment_gateways SET is_default=false WHERE tenant_id=$1 AND id!=$2', [req.session.user.tenant_id, r.rows[0].id]);
    await audit(req, 'create', 'payment_gateways', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update gateway
  app.put('/api/payment-gateways/:id', requireAuth, ah(async (req, res) => {
    const { gateway_name, api_key, api_secret, webhook_url, merchant_id, sandbox_mode, fee_percentage, flat_fee, currency, is_active, is_default } = req.body;
    const r = await pool.query(
      `UPDATE payment_gateways SET gateway_name=COALESCE($1,gateway_name), api_key=COALESCE($2,api_key), api_secret=COALESCE($3,api_secret),
       webhook_url=COALESCE($4,webhook_url), merchant_id=COALESCE($5,merchant_id), sandbox_mode=COALESCE($6,sandbox_mode),
       fee_percentage=COALESCE($7,fee_percentage), flat_fee=COALESCE($8,flat_fee), currency=COALESCE($9,currency),
       is_active=COALESCE($10,is_active), is_default=COALESCE($11,is_default)
       WHERE tenant_id=$12 AND id=$13 RETURNING id, tenant_id, gateway_name, gateway_type, is_active, is_default`,
      [gateway_name?esc(gateway_name):null, api_key?esc(api_key):null, api_secret?esc(api_secret):null,
       webhook_url?esc(webhook_url):null, merchant_id?esc(merchant_id):null, sandbox_mode,
       fee_percentage, flat_fee, currency?esc(currency):null, is_active, is_default,
       req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    if (is_default) await pool.query('UPDATE payment_gateways SET is_default=false WHERE tenant_id=$1 AND id!=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'payment_gateways', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete gateway
  app.delete('/api/payment-gateways/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM payment_gateways WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    await audit(req, 'delete', 'payment_gateways', req.params.id);
    res.json({ ok: true });
  }));

  // Test gateway connection
  app.post('/api/payment-gateways/:id/test', requireAuth, ah(async (req, res) => {
    const gw = await pool.query('SELECT * FROM payment_gateways WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!gw.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    const g = gw.rows[0];
    // Simulated test — real integrations would ping the API
    const hasCredentials = g.api_key && g.api_secret;
    res.json({
      ok: hasCredentials,
      gateway: g.gateway_name,
      type: g.gateway_type,
      status: hasCredentials ? 'credentials_configured' : 'credentials_missing',
      sandbox: g.sandbox_mode,
      test_time: new Date().toISOString()
    });
  }));

  // Webhook (public, no auth)
  app.post('/api/payment-gateways/webhook/:gatewayId', ah(async (req, res) => {
    const gw = await pool.query('SELECT * FROM payment_gateways WHERE id=$1 AND is_active=true AND tenant_id=$2', [req.params.gatewayId, req.body.tenant_id]);
    if (!gw.rows.length) return res.status(404).json({ error: 'Gateway not found' });
    const { external_tx_id, donor_name, donor_email, amount, currency, status, payment_method, metadata, campaign_id } = req.body;
    const feePct = parseFloat(gw.rows[0].fee_percentage) || 0;
    const flatFee = parseFloat(gw.rows[0].flat_fee) || 0;
    const amt = parseFloat(amount) || 0;
    const feeAmt = (amt * feePct / 100) + flatFee;
    const r = await pool.query(
      `INSERT INTO gateway_transactions (tenant_id,gateway_id,campaign_id,external_tx_id,donor_name,donor_email,amount,fee_amount,net_amount,currency,payment_method,status,metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [gw.rows[0].tenant_id, req.params.gatewayId, campaign_id||null, esc(external_tx_id||''), esc(donor_name||''), esc(donor_email||''), amt, feeAmt, amt-feeAmt, esc(currency||gw.rows[0].currency||'UGX'), esc(payment_method||'card'), esc(status||'pending'), JSON.stringify(metadata||{})]
    );
    res.json({ ok: true, transaction_id: r.rows[0].id });
  }));

  // Gateway balance summary
  app.get('/api/payment-gateways/:id/balance', requireAuth, ah(async (req, res) => {
    const txs = await pool.query(
      `SELECT COUNT(*) as total_tx, COALESCE(SUM(amount),0) as total_amount,
       COUNT(CASE WHEN status='completed' THEN 1 END) as completed_tx,
       COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END),0) as completed_amount,
       COALESCE(SUM(fee_amount),0) as total_fees,
       COALESCE(SUM(net_amount),0) as net_amount
       FROM gateway_transactions WHERE tenant_id=$1 AND gateway_id=$2`,
      [req.session.user.tenant_id, req.params.id]
    );
    res.json(txs.rows[0]);
  }));

  // List transactions with filters
  app.get('/api/gateway-transactions', requireAuth, ah(async (req, res) => {
    const { gateway_id, campaign_id, status, payment_method } = req.query;
    let q = 'SELECT gt.*, pg.gateway_name FROM gateway_transactions gt JOIN payment_gateways pg ON gt.gateway_id=pg.id WHERE gt.tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (gateway_id) { q += ' AND gt.gateway_id=$' + idx; params.push(gateway_id); idx++; }
    if (campaign_id) { q += ' AND gt.campaign_id=$' + idx; params.push(campaign_id); idx++; }
    if (status) { q += ' AND gt.status=$' + idx; params.push(esc(status)); idx++; }
    if (payment_method) { q += ' AND gt.payment_method=$' + idx; params.push(esc(payment_method)); idx++; }
    q += ' ORDER BY gt.created_at DESC LIMIT 100';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Update transaction status
  app.put('/api/gateway-transactions/:id/status', requireAuth, ah(async (req, res) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });
    const r = await pool.query('UPDATE gateway_transactions SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', [esc(status), req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Transaction not found' });
    await audit(req, 'update', 'gateway_transactions', req.params.id);
    res.json(r.rows[0]);
  }));

  // Request payout
  app.post('/api/payment-gateways/:id/payout', requireAuth, ah(async (req, res) => {
    const { amount, payout_method, reference } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount required' });
    const r = await pool.query(
      'INSERT INTO gateway_payouts (tenant_id,gateway_id,amount,payout_method,reference,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.session.user.tenant_id, req.params.id, amount, esc(payout_method||'bank_transfer'), esc(reference||''), 'pending']
    );
    await audit(req, 'create', 'gateway_payouts', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // List payouts
  app.get('/api/payment-gateways/:id/payouts', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM gateway_payouts WHERE tenant_id=$1 AND gateway_id=$2 ORDER BY requested_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Page route
  app.get('/payment-gateways', requireAuth, ah(async (req, res) => {
    const gateways = await pool.query('SELECT * FROM payment_gateways WHERE tenant_id=$1', [req.session.user.tenant_id]);
    const txStats = await pool.query('SELECT COUNT(*) as total_tx, COALESCE(SUM(CASE WHEN status=$1 THEN amount ELSE 0 END),0) as completed_total FROM gateway_transactions WHERE tenant_id=$2', ['completed', req.session.user.tenant_id]);
    renderPage(req, res, 'Payment Gateways', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Payment Gateway Hub</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Processed</p><p class="text-2xl font-bold text-emerald-700">UGX ${txStats.rows[0]?.completed_total||0}</p></div>
        <div class="bg-emerald-50 rounded-lg p-4"><p class="text-sm text-gray-600">Transactions</p><p class="text-2xl font-bold text-emerald-700">${txStats.rows[0]?.total_tx||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${gateways.rows.map(g => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(g.gateway_name)}</h3>
        <p class="text-sm text-gray-500">Type: ${esc(g.gateway_type)} | ${g.is_active?'<span class="text-emerald-600">Active</span>':'<span class="text-red-500">Inactive</span>'} ${g.is_default?'| <span class="text-blue-600">Default</span>':''}</p>
        <p class="text-sm text-gray-500">Fee: ${g.fee_percentage}% + UGX ${g.flat_fee} | ${g.sandbox_mode?'Sandbox':'Live'}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 3: DONOR RENEWAL
  // ================================================================

  // List campaigns
  app.get('/api/renewal-campaigns', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (status) { q += ' AND status=$2'; params.push(esc(status)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single campaign
  app.get('/api/renewal-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(r.rows[0]);
  }));

  // Create campaign
  app.post('/api/renewal-campaigns', requireAuth, ah(async (req, res) => {
    const { name, description, target_segment, start_date, end_date, goal_amount, target_count, email_template, sms_template, auto_remind, remind_interval_days } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(
      `INSERT INTO donor_renewal_campaigns (tenant_id,name,description,target_segment,start_date,end_date,goal_amount,target_count,email_template,sms_template,auto_remind,remind_interval_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.session.user.tenant_id, esc(name), esc(description||''), esc(target_segment||'lapsed'), start_date||null, end_date||null, goal_amount||0, target_count||0, esc(email_template||''), esc(sms_template||''), auto_remind||false, remind_interval_days||14]
    );
    await audit(req, 'create', 'donor_renewal_campaigns', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update campaign
  app.put('/api/renewal-campaigns/:id', requireAuth, ah(async (req, res) => {
    const { name, description, target_segment, start_date, end_date, goal_amount, email_template, sms_template, auto_remind, remind_interval_days, status } = req.body;
    const r = await pool.query(
      `UPDATE donor_renewal_campaigns SET name=COALESCE($1,name), description=COALESCE($2,description), target_segment=COALESCE($3,target_segment),
       start_date=COALESCE($4,start_date), end_date=COALESCE($5,end_date), goal_amount=COALESCE($6,goal_amount),
       email_template=COALESCE($7,email_template), sms_template=COALESCE($8,sms_template),
       auto_remind=COALESCE($9,auto_remind), remind_interval_days=COALESCE($10,remind_interval_days),
       status=COALESCE($11,status) WHERE tenant_id=$12 AND id=$13 RETURNING *`,
      [name?esc(name):null, description?esc(description):null, target_segment?esc(target_segment):null, start_date||null, end_date||null, goal_amount,
       email_template?esc(email_template):null, sms_template?esc(sms_template):null, auto_remind, remind_interval_days, status||null,
       req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete campaign
  app.delete('/api/renewal-campaigns/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'delete', 'donor_renewal_campaigns', req.params.id);
    res.json({ ok: true });
  }));

  // Start campaign
  app.post('/api/renewal-campaigns/:id/start', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donor_renewal_campaigns SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['active', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Pause campaign
  app.post('/api/renewal-campaigns/:id/pause', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donor_renewal_campaigns SET status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['paused', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Complete campaign
  app.post('/api/renewal-campaigns/:id/complete', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE donor_renewal_campaigns SET status=$1, end_date=COALESCE(end_date,CURRENT_DATE) WHERE tenant_id=$2 AND id=$3 RETURNING *', ['completed', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json(r.rows[0]);
  }));

  // Send reminder
  app.post('/api/renewal-campaigns/:id/send-reminder', requireAuth, ah(async (req, res) => {
    const { donor_email, donor_name, donor_phone, reminder_type, message } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email required' });
    const r = await pool.query(
      'INSERT INTO renewal_reminders (tenant_id,campaign_id,donor_email,donor_name,donor_phone,reminder_type,message,sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(donor_email), esc(donor_name||''), esc(donor_phone||''), esc(reminder_type||'email'), esc(message||'')]
    );
    await pool.query('UPDATE renewal_reminders SET status=$1 WHERE id=$2 AND tenant_id=$3', ['sent', r.rows[0].id, req.session.user.tenant_id]);
    // Try sending via email or SMS
    if (reminder_type === 'email' && donor_email) {
      try { await sendEmail(donor_email, 'Renew Your Support', message || 'We miss your support! Please consider renewing your gift.'); } catch(e) {}
    } else if (reminder_type === 'sms' && donor_phone) {
      try { await sendSMS(donor_phone, message || 'We miss your support! Please consider renewing your gift.'); } catch(e) {}
    }
    await audit(req, 'create', 'renewal_reminders', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Bulk send reminders
  app.post('/api/renewal-campaigns/:id/bulk-remind', requireAuth, ah(async (req, res) => {
    const { reminder_type, message } = req.body;
    const campaign = await pool.query('SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!campaign.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    // Find lapsed donors from donations table
    const donors = await pool.query(
      `SELECT donor_email, donor_name, MAX(created_at) as last_gift FROM donations WHERE tenant_id=$1 AND donor_email IS NOT NULL GROUP BY donor_email, donor_name HAVING MAX(created_at) < NOW() - INTERVAL '6 months' LIMIT 100`,
      [req.session.user.tenant_id]
    );
    let sent = 0;
    for (const d of donors.rows) {
      const msg = message || `We miss your support! Your last gift was on ${d.last_gift?.toISOString?.()?.split('T')?.[0] || 'recently'}. Please consider renewing.`;
      await pool.query(
        'INSERT INTO renewal_reminders (tenant_id,campaign_id,donor_email,donor_name,reminder_type,message,sent_at,status) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)',
        [req.session.user.tenant_id, req.params.id, esc(d.donor_email), esc(d.donor_name||''), esc(reminder_type||'email'), esc(msg), 'sent']
      );
      if (reminder_type === 'email') {
        try { await sendEmail(d.donor_email, 'Renew Your Support', msg); } catch(e) {}
      }
      sent++;
    }
    await audit(req, 'update', 'donor_renewal_campaigns', req.params.id);
    res.json({ ok: true, sent });
  }));

  // Get reminders for a campaign
  app.get('/api/renewal-campaigns/:id/reminders', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM renewal_reminders WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Record response to reminder
  app.post('/api/renewal-reminders/:id/respond', requireAuth, ah(async (req, res) => {
    const { response_amount } = req.body;
    const r = await pool.query('UPDATE renewal_reminders SET responded=true, response_amount=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', [response_amount||0, req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Reminder not found' });
    // Update campaign counters
    if (r.rows[0].campaign_id) {
      await pool.query('UPDATE donor_renewal_campaigns SET renewal_count=renewal_count+1, raised_amount=raised_amount+$1 WHERE id=$2 AND tenant_id=$3', [response_amount||0, r.rows[0].campaign_id, req.session.user.tenant_id]);
    }
    await audit(req, 'update', 'renewal_reminders', req.params.id);
    res.json(r.rows[0]);
  }));

  // Campaign stats
  app.get('/api/renewal-campaigns/:id/stats', requireAuth, ah(async (req, res) => {
    const campaign = await pool.query('SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!campaign.rows.length) return res.status(404).json({ error: 'Campaign not found' });
    const reminders = await pool.query(
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='sent' THEN 1 END) as sent_count,
       COUNT(CASE WHEN responded THEN 1 END) as responded_count,
       COALESCE(SUM(response_amount),0) as total_response_amount,
       COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened_count
       FROM renewal_reminders WHERE tenant_id=$1 AND campaign_id=$2`,
      [req.session.user.tenant_id, req.params.id]
    );
    res.json({ campaign: campaign.rows[0], reminders: reminders.rows[0] });
  }));

  // Segments
  app.get('/api/donor-renewal-segments', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM donor_renewal_segments WHERE tenant_id=$1 ORDER BY segment_name', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Page route
  app.get('/donor-renewal', requireAuth, ah(async (req, res) => {
    const campaigns = await pool.query('SELECT * FROM donor_renewal_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(renewal_count),0) as total_renewals, COALESCE(SUM(raised_amount),0) as total_raised FROM donor_renewal_campaigns WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Donor Renewal', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Donor Renewal</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-amber-50 rounded-lg p-4"><p class="text-sm text-gray-600">Campaigns</p><p class="text-2xl font-bold text-amber-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-amber-50 rounded-lg p-4"><p class="text-sm text-gray-600">Renewals</p><p class="text-2xl font-bold text-amber-700">${stats.rows[0]?.total_renewals||0}</p></div>
        <div class="bg-amber-50 rounded-lg p-4"><p class="text-sm text-gray-600">Raised</p><p class="text-2xl font-bold text-amber-700">UGX ${stats.rows[0]?.total_raised||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${campaigns.rows.map(c => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(c.name)}</h3>
        <p class="text-sm text-gray-500">Target: ${esc(c.target_segment)} | Renewals: ${c.renewal_count}/${c.target_count||'?'} | UGX ${c.raised_amount} | ${c.status}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 4: GIFT CLUBS
  // ================================================================

  // List clubs with member counts
  app.get('/api/gift-clubs', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT gc.*, (SELECT COUNT(*) FROM gift_club_members WHERE club_id=gc.id AND is_active=true) as active_member_count FROM donor_gift_clubs gc WHERE gc.tenant_id=$1 ORDER BY min_amount',
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Get single club
  app.get('/api/gift-clubs/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gift club not found' });
    res.json(r.rows[0]);
  }));

  // Create club
  app.post('/api/gift-clubs', requireAuth, ah(async (req, res) => {
    const { club_name, min_amount, max_amount, description, benefits, color, icon, welcome_email_subject, welcome_email_body, annual_event } = req.body;
    if (!club_name) return res.status(400).json({ error: 'club_name required' });
    const r = await pool.query(
      `INSERT INTO donor_gift_clubs (tenant_id,club_name,min_amount,max_amount,description,benefits,color,icon,welcome_email_subject,welcome_email_body,annual_event)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.session.user.tenant_id, esc(club_name), min_amount||0, max_amount||null, esc(description||''), esc(benefits||''), esc(color||'#10b981'), esc(icon||'award'), esc(welcome_email_subject||''), esc(welcome_email_body||''), esc(annual_event||'')]
    );
    await audit(req, 'create', 'donor_gift_clubs', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update club
  app.put('/api/gift-clubs/:id', requireAuth, ah(async (req, res) => {
    const { club_name, min_amount, max_amount, description, benefits, color, icon, welcome_email_subject, welcome_email_body, annual_event, is_active } = req.body;
    const r = await pool.query(
      `UPDATE donor_gift_clubs SET club_name=COALESCE($1,club_name), min_amount=COALESCE($2,min_amount), max_amount=COALESCE($3,max_amount),
       description=COALESCE($4,description), benefits=COALESCE($5,benefits), color=COALESCE($6,color), icon=COALESCE($7,icon),
       welcome_email_subject=COALESCE($8,welcome_email_subject), welcome_email_body=COALESCE($9,welcome_email_body),
       annual_event=COALESCE($10,annual_event), is_active=COALESCE($11,is_active)
       WHERE tenant_id=$12 AND id=$13 RETURNING *`,
      [club_name?esc(club_name):null, min_amount, max_amount, description?esc(description):null, benefits?esc(benefits):null,
       color?esc(color):null, icon?esc(icon):null, welcome_email_subject?esc(welcome_email_subject):null, welcome_email_body?esc(welcome_email_body):null,
       annual_event?esc(annual_event):null, is_active, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Gift club not found' });
    await audit(req, 'update', 'donor_gift_clubs', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete club
  app.delete('/api/gift-clubs/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM donor_gift_clubs WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Gift club not found' });
    await audit(req, 'delete', 'donor_gift_clubs', req.params.id);
    res.json({ ok: true });
  }));

  // Auto-assign donors to clubs based on giving
  app.post('/api/gift-clubs/auto-assign', requireAuth, ah(async (req, res) => {
    const clubs = await pool.query('SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 AND is_active=true ORDER BY min_amount DESC', [req.session.user.tenant_id]);
    const donors = await pool.query(
      "SELECT donor_email, donor_name, SUM(amount) as total FROM donations WHERE tenant_id=$1 AND status='completed' GROUP BY donor_email, donor_name",
      [req.session.user.tenant_id]
    );
    let assigned = 0, promoted = 0;
    for (const d of donors.rows) {
      if (!d.donor_email) continue;
      const total = parseFloat(d.total || 0);
      for (const c of clubs.rows) {
        const minOk = total >= parseFloat(c.min_amount);
        const maxOk = !c.max_amount || total < parseFloat(c.max_amount);
        if (minOk && maxOk) {
          const existing = await pool.query('SELECT * FROM gift_club_members WHERE tenant_id=$1 AND donor_email=$2', [req.session.user.tenant_id, esc(d.donor_email)]);
          if (!existing.rows.length) {
            await pool.query(
              'INSERT INTO gift_club_members (tenant_id,club_id,donor_name,donor_email,total_donated,membership_start_date,last_gift_date,last_gift_amount) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,CURRENT_DATE,$6)',
              [req.session.user.tenant_id, c.id, esc(d.donor_name||''), esc(d.donor_email), total, total]
            );
            assigned++;
            // Send welcome email if configured
            if (c.welcome_email_subject && c.welcome_email_body) {
              try { await sendEmail(d.donor_email, c.welcome_email_subject, c.welcome_email_body); } catch(e) {}
            }
          } else if (existing.rows[0].club_id !== c.id) {
            // Promote to new tier
            await pool.query('UPDATE gift_club_members SET club_id=$1, total_donated=$2 WHERE id=$3 AND tenant_id=$4', [c.id, total, existing.rows[0].id, req.session.user.tenant_id]);
            promoted++;
          }
          break;
        }
      }
    }
    await audit(req, 'update', 'gift_club_members', 0);
    res.json({ ok: true, assigned, promoted });
  }));

  // My club (current user)
  app.get('/api/gift-clubs/my-club', requireAuth, ah(async (req, res) => {
    const email = req.session.user.email;
    const r = await pool.query(
      'SELECT gcm.*, gc.club_name, gc.benefits, gc.color, gc.icon FROM gift_club_members gcm JOIN donor_gift_clubs gc ON gcm.club_id=gc.id WHERE gcm.tenant_id=$1 AND gcm.donor_email=$2 AND gcm.is_active=true',
      [req.session.user.tenant_id, esc(email)]
    );
    res.json(r.rows);
  }));

  // Members of a club
  app.get('/api/gift-clubs/:id/members', requireAuth, ah(async (req, res) => {
    const { is_active } = req.query;
    let q = 'SELECT * FROM gift_club_members WHERE tenant_id=$1 AND club_id=$2';
    const params = [req.session.user.tenant_id, req.params.id];
    if (is_active !== undefined) { q += ' AND is_active=$3'; params.push(is_active === 'true'); }
    q += ' ORDER BY total_donated DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Add member manually
  app.post('/api/gift-clubs/:id/members', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, total_donated } = req.body;
    if (!donor_name || !donor_email) return res.status(400).json({ error: 'donor_name and donor_email required' });
    const r = await pool.query(
      'INSERT INTO gift_club_members (tenant_id,club_id,donor_name,donor_email,donor_phone,total_donated,membership_start_date) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(donor_name), esc(donor_email), esc(donor_phone||''), total_donated||0]
    );
    await audit(req, 'create', 'gift_club_members', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Remove member from club
  app.delete('/api/gift-clubs/:clubId/members/:memberId', requireAuth, ah(async (req, res) => {
    await pool.query('UPDATE gift_club_members SET is_active=false WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.memberId]);
    await audit(req, 'update', 'gift_club_members', req.params.memberId);
    res.json({ ok: true });
  }));

  // Send welcome to club member
  app.post('/api/gift-clubs/members/:memberId/send-welcome', requireAuth, ah(async (req, res) => {
    const member = await pool.query(
      'SELECT gcm.*, gc.welcome_email_subject, gc.welcome_email_body, gc.club_name FROM gift_club_members gcm JOIN donor_gift_clubs gc ON gcm.club_id=gc.id WHERE gcm.tenant_id=$1 AND gcm.id=$2',
      [req.session.user.tenant_id, req.params.memberId]
    );
    if (!member.rows.length) return res.status(404).json({ error: 'Member not found' });
    const m = member.rows[0];
    if (m.welcome_email_subject && m.welcome_email_body && m.donor_email) {
      try { await sendEmail(m.donor_email, m.welcome_email_subject, m.welcome_email_body.replace('{name}', m.donor_name).replace('{club}', m.club_name)); } catch(e) {}
    }
    await pool.query('UPDATE gift_club_members SET welcome_sent=true WHERE id=$1 AND tenant_id=$2', [m.id, req.session.user.tenant_id]);
    await audit(req, 'update', 'gift_club_members', m.id);
    res.json({ ok: true, sent: true });
  }));

  // Club events
  app.get('/api/gift-clubs/:id/events', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM gift_club_events WHERE tenant_id=$1 AND club_id=$2 ORDER BY event_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/gift-clubs/:id/events', requireAuth, ah(async (req, res) => {
    const { event_name, event_date, venue, description } = req.body;
    if (!event_name) return res.status(400).json({ error: 'event_name required' });
    const r = await pool.query(
      'INSERT INTO gift_club_events (tenant_id,club_id,event_name,event_date,venue,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(event_name), event_date||null, esc(venue||''), esc(description||'')]
    );
    await audit(req, 'create', 'gift_club_events', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Club stats
  app.get('/api/gift-clubs/stats/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'SELECT gc.club_name, gc.min_amount, gc.color, (SELECT COUNT(*) FROM gift_club_members WHERE club_id=gc.id AND is_active=true) as member_count, (SELECT COALESCE(SUM(total_donated),0) FROM gift_club_members WHERE club_id=gc.id AND is_active=true) as total_donated FROM donor_gift_clubs gc WHERE gc.tenant_id=$1 ORDER BY min_amount',
      [req.session.user.tenant_id]
    );
    res.json(r.rows);
  }));

  // Page route
  app.get('/gift-clubs', requireAuth, ah(async (req, res) => {
    const clubs = await pool.query('SELECT * FROM donor_gift_clubs WHERE tenant_id=$1 ORDER BY min_amount', [req.session.user.tenant_id]);
    const totalMembers = await pool.query('SELECT COUNT(*) as total FROM gift_club_members WHERE tenant_id=$1 AND is_active=true', [req.session.user.tenant_id]);
    renderPage(req, res, 'Gift Clubs', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Gift Clubs</h1>
      <div class="bg-amber-50 rounded-lg p-4 mb-6"><p class="text-sm text-gray-600">Total Active Members</p><p class="text-2xl font-bold text-amber-700">${totalMembers.rows[0]?.total||0}</p></div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">${clubs.rows.map(c => `<div class="bg-white rounded-lg shadow p-4 border-t-4" style="border-color:${c.color}">
        <h3 class="font-semibold">${esc(c.club_name)}</h3>
        <p class="text-sm">UGX ${c.min_amount}${c.max_amount?' - '+c.max_amount:'+'}</p>
        <p class="text-xs text-gray-500 mt-1">${esc(c.benefits||'')}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 5: VIDEO INTEGRATION
  // ================================================================

  // List videos
  app.get('/api/campaign-videos', requireAuth, ah(async (req, res) => {
    const { campaign_id, is_live, is_featured } = req.query;
    let q = 'SELECT * FROM campaign_videos WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (campaign_id) { q += ' AND campaign_id=$' + idx; params.push(campaign_id); idx++; }
    if (is_live !== undefined) { q += ' AND is_live=$' + idx; params.push(is_live === 'true'); idx++; }
    if (is_featured !== undefined) { q += ' AND is_featured=$' + idx; params.push(is_featured === 'true'); idx++; }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single video
  app.get('/api/campaign-videos/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM campaign_videos WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    res.json(r.rows[0]);
  }));

  // Create video
  app.post('/api/campaign-videos', requireAuth, ah(async (req, res) => {
    const { campaign_id, title, video_url, video_type, thumbnail_url, description, duration_seconds, is_featured, scheduled_at, transcript_url } = req.body;
    if (!title || !video_url) return res.status(400).json({ error: 'title and video_url required' });
    const r = await pool.query(
      `INSERT INTO campaign_videos (tenant_id,campaign_id,title,video_url,video_type,thumbnail_url,description,duration_seconds,is_featured,scheduled_at,transcript_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.session.user.tenant_id, campaign_id||null, esc(title), esc(video_url), esc(video_type||'youtube'), esc(thumbnail_url||''), esc(description||''), duration_seconds||0, is_featured||false, scheduled_at||null, esc(transcript_url||'')]
    );
    await audit(req, 'create', 'campaign_videos', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update video
  app.put('/api/campaign-videos/:id', requireAuth, ah(async (req, res) => {
    const { title, video_url, video_type, thumbnail_url, description, duration_seconds, is_live, is_featured, scheduled_at, transcript_url } = req.body;
    const r = await pool.query(
      `UPDATE campaign_videos SET title=COALESCE($1,title), video_url=COALESCE($2,video_url), video_type=COALESCE($3,video_type),
       thumbnail_url=COALESCE($4,thumbnail_url), description=COALESCE($5,description), duration_seconds=COALESCE($6,duration_seconds),
       is_live=COALESCE($7,is_live), is_featured=COALESCE($8,is_featured), scheduled_at=COALESCE($9,scheduled_at),
       transcript_url=COALESCE($10,transcript_url) WHERE tenant_id=$11 AND id=$12 RETURNING *`,
      [title?esc(title):null, video_url?esc(video_url):null, video_type?esc(video_type):null, thumbnail_url?esc(thumbnail_url):null,
       description?esc(description):null, duration_seconds, is_live, is_featured, scheduled_at||null, transcript_url?esc(transcript_url):null,
       req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'update', 'campaign_videos', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete video
  app.delete('/api/campaign-videos/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM campaign_videos WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'delete', 'campaign_videos', req.params.id);
    res.json({ ok: true });
  }));

  // Go live
  app.post('/api/campaign-videos/:id/go-live', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE campaign_videos SET is_live=true, scheduled_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'update', 'campaign_videos', req.params.id);
    res.json(r.rows[0]);
  }));

  // End live
  app.post('/api/campaign-videos/:id/end-live', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE campaign_videos SET is_live=false WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'update', 'campaign_videos', req.params.id);
    res.json(r.rows[0]);
  }));

  // Toggle featured
  app.post('/api/campaign-videos/:id/toggle-featured', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE campaign_videos SET is_featured=NOT is_featured WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Video not found' });
    await audit(req, 'update', 'campaign_videos', req.params.id);
    res.json(r.rows[0]);
  }));

  // Track engagement (public)
  app.post('/api/campaign-videos/:id/track', ah(async (req, res) => {
    const { viewer_email, viewer_ip, watch_time_seconds, completed, liked, shared, source } = req.body;
    const tenantId = req.session?.user?.tenant_id || 0;
    // Look up tenant from the video itself
    const vid = await pool.query('SELECT tenant_id FROM campaign_videos WHERE id=$1', [req.params.id]);
    const tid = vid.rows.length ? vid.rows[0].tenant_id : tenantId;
    await pool.query(
      'INSERT INTO video_engagement (tenant_id,video_id,viewer_email,viewer_ip,watch_time_seconds,completed,liked,shared,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [tid, req.params.id, esc(viewer_email||''), esc(viewer_ip||''), watch_time_seconds||0, completed||false, liked||false, shared||false, esc(source||'direct')]
    );
    await pool.query('UPDATE campaign_videos SET view_count=view_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (liked) await pool.query('UPDATE campaign_videos SET like_count=like_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (shared) await pool.query('UPDATE campaign_videos SET share_count=share_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  }));

  // Video engagement stats
  app.get('/api/campaign-videos/:id/engagement', requireAuth, ah(async (req, res) => {
    const stats = await pool.query(
      `SELECT COUNT(*) as total_views, COALESCE(SUM(watch_time_seconds),0) as total_watch_time,
       COUNT(CASE WHEN completed THEN 1 END) as completed_views,
       AVG(watch_time_seconds) as avg_watch_time,
       COUNT(CASE WHEN liked THEN 1 END) as total_likes,
       COUNT(CASE WHEN shared THEN 1 END) as total_shares
       FROM video_engagement WHERE tenant_id=$1 AND video_id=$2`,
      [req.session.user.tenant_id, req.params.id]
    );
    res.json(stats.rows[0]);
  }));

  // Playlists
  app.get('/api/video-playlists', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM video_playlists WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/video-playlists', requireAuth, ah(async (req, res) => {
    const { name, description, video_ids, is_public } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(
      'INSERT INTO video_playlists (tenant_id,name,description,video_ids_json,is_public) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.session.user.tenant_id, esc(name), esc(description||''), JSON.stringify(video_ids||[]), is_public!==undefined?is_public:true]
    );
    await audit(req, 'create', 'video_playlists', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/video-playlists/:id', requireAuth, ah(async (req, res) => {
    const { name, description, video_ids, is_public } = req.body;
    const r = await pool.query(
      `UPDATE video_playlists SET name=COALESCE($1,name), description=COALESCE($2,description), video_ids_json=COALESCE($3,video_ids_json), is_public=COALESCE($4,is_public) WHERE tenant_id=$5 AND id=$6 RETURNING *`,
      [name?esc(name):null, description?esc(description):null, video_ids?JSON.stringify(video_ids):null, is_public, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Playlist not found' });
    await audit(req, 'update', 'video_playlists', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/video-playlists/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM video_playlists WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'video_playlists', req.params.id);
    res.json({ ok: true });
  }));

  // Page route
  app.get('/campaign-videos', requireAuth, ah(async (req, res) => {
    const videos = await pool.query('SELECT * FROM campaign_videos WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(view_count),0) as total_views, COALESCE(SUM(like_count),0) as total_likes FROM campaign_videos WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Campaign Videos', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Video Integration</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-purple-50 rounded-lg p-4"><p class="text-sm text-gray-600">Videos</p><p class="text-2xl font-bold text-purple-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-purple-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Views</p><p class="text-2xl font-bold text-purple-700">${stats.rows[0]?.total_views||0}</p></div>
        <div class="bg-purple-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Likes</p><p class="text-2xl font-bold text-purple-700">${stats.rows[0]?.total_likes||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${videos.rows.map(v => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(v.title)}</h3>
        <p class="text-sm text-gray-500">Views: ${v.view_count} | Likes: ${v.like_count} | ${v.is_live?'<span class="text-red-600">Live</span>':'<span class="text-gray-400">Offline</span>'} ${v.is_featured?'| ⭐ Featured':''}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 6: STOCK / SECURITIES
  // ================================================================

  // List stock donations
  app.get('/api/stock-donations', requireAuth, ah(async (req, res) => {
    const { status } = req.query;
    let q = 'SELECT * FROM stock_donations WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    if (status) { q += ' AND status=$2'; params.push(esc(status)); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single
  app.get('/api/stock-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM stock_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    res.json(r.rows[0]);
  }));

  // Create stock donation
  app.post('/api/stock-donations', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, company_name, ticker_symbol, number_of_shares, share_price, brokerage_name, brokerage_contact, dtc_number, transfer_date, transfer_method, mean_price_on_date, notes } = req.body;
    if (!donor_name || !company_name) return res.status(400).json({ error: 'donor_name and company_name required' });
    const total_value = (number_of_shares || 0) * (share_price || 0);
    const r = await pool.query(
      `INSERT INTO stock_donations (tenant_id,donor_name,donor_email,donor_phone,company_name,ticker_symbol,number_of_shares,share_price,total_value,brokerage_name,brokerage_contact,dtc_number,transfer_date,transfer_method,mean_price_on_date,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.session.user.tenant_id, esc(donor_name), esc(donor_email||''), esc(donor_phone||''), esc(company_name), esc(ticker_symbol||''), number_of_shares||0, share_price||0, total_value, esc(brokerage_name||''), esc(brokerage_contact||''), esc(dtc_number||''), transfer_date||null, esc(transfer_method||'dwtc'), mean_price_on_date||0, esc(notes||'')]
    );
    await audit(req, 'create', 'stock_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update stock donation
  app.put('/api/stock-donations/:id', requireAuth, ah(async (req, res) => {
    const { number_of_shares, share_price, status, acknowledged, notes, transfer_date } = req.body;
    const total_value = (number_of_shares || 0) * (share_price || 0);
    const r = await pool.query(
      `UPDATE stock_donations SET number_of_shares=COALESCE($1,number_of_shares), share_price=COALESCE($2,share_price),
       total_value=CASE WHEN $1 IS NOT NULL OR $2 IS NOT NULL THEN $3 ELSE total_value END,
       status=COALESCE($4,status), acknowledged=COALESCE($5,acknowledged), notes=COALESCE($6,notes),
       transfer_date=COALESCE($7,transfer_date) WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [number_of_shares, share_price, total_value, status?esc(status):null, acknowledged, notes?esc(notes):null, transfer_date||null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    await audit(req, 'update', 'stock_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete stock donation
  app.delete('/api/stock-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM stock_donations WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    await audit(req, 'delete', 'stock_donations', req.params.id);
    res.json({ ok: true });
  }));

  // Acknowledge stock donation
  app.post('/api/stock-donations/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE stock_donations SET acknowledged=true, acknowledgment_sent_at=NOW(), status=$1 WHERE tenant_id=$2 AND id=$3 RETURNING *', ['acknowledged', req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    // Send acknowledgment email
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'Stock Donation Acknowledged', `Dear ${r.rows[0].donor_name}, your donation of ${r.rows[0].number_of_shares} shares of ${r.rows[0].company_name} has been acknowledged. Thank you for your generosity.`); } catch(e) {}
    }
    await audit(req, 'update', 'stock_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Send tax letter
  app.post('/api/stock-donations/:id/send-tax-letter', requireAuth, ah(async (req, res) => {
    const r = await pool.query('UPDATE stock_donations SET tax_letter_sent=true WHERE tenant_id=$1 AND id=$2 RETURNING *', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'Tax Letter for Stock Donation', `Dear ${r.rows[0].donor_name}, attached is your tax letter for the donation of ${r.rows[0].number_of_shares} shares of ${r.rows[0].company_name}. Valued at UGX ${r.rows[0].total_value}.`); } catch(e) {}
    }
    await audit(req, 'update', 'stock_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Valuations CRUD
  app.get('/api/stock-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM stock_valuations WHERE tenant_id=$1 AND stock_donation_id=$2 ORDER BY valuation_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/stock-donations/:id/valuations', requireAuth, ah(async (req, res) => {
    const { valuation_date, share_price, high_price, low_price, appraiser, notes } = req.body;
    const stock = await pool.query('SELECT number_of_shares FROM stock_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!stock.rows.length) return res.status(404).json({ error: 'Stock donation not found' });
    const shares = parseFloat(stock.rows[0].number_of_shares) || 0;
    const total = shares * (share_price || 0);
    const r = await pool.query(
      'INSERT INTO stock_valuations (tenant_id,stock_donation_id,valuation_date,share_price,total_value,high_price,low_price,appraiser,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [req.session.user.tenant_id, req.params.id, valuation_date||'NOW()', share_price||0, total, high_price||0, low_price||0, esc(appraiser||''), esc(notes||'')]
    );
    await audit(req, 'create', 'stock_valuations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Transfer documents
  app.get('/api/stock-donations/:id/documents', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM stock_transfer_docs WHERE tenant_id=$1 AND stock_donation_id=$2 ORDER BY uploaded_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/stock-donations/:id/documents', requireAuth, ah(async (req, res) => {
    const { doc_type, doc_name, doc_url } = req.body;
    if (!doc_name) return res.status(400).json({ error: 'doc_name required' });
    const r = await pool.query(
      'INSERT INTO stock_transfer_docs (tenant_id,stock_donation_id,doc_type,doc_name,doc_url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(doc_type||'transfer_form'), esc(doc_name), esc(doc_url||'')]
    );
    await audit(req, 'create', 'stock_transfer_docs', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Stock donation stats
  app.get('/api/stock-donations/stats/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT COUNT(*) as total_donations, COALESCE(SUM(total_value),0) as total_value,
       COUNT(CASE WHEN acknowledged THEN 1 END) as acknowledged_count,
       COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
       COUNT(DISTINCT company_name) as unique_companies
       FROM stock_donations WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows[0]);
  }));

  // Page route
  app.get('/stock-donations', requireAuth, ah(async (req, res) => {
    const stocks = await pool.query('SELECT * FROM stock_donations WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(total_value),0) as total_value FROM stock_donations WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Stock & Securities', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Stock & Securities</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-teal-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Donations</p><p class="text-2xl font-bold text-teal-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-teal-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Value</p><p class="text-2xl font-bold text-teal-700">UGX ${stats.rows[0]?.total_value||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${stocks.rows.map(s => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(s.company_name)}${s.ticker_symbol?' ('+esc(s.ticker_symbol)+')':''}</h3>
        <p class="text-sm text-gray-500">Donor: ${esc(s.donor_name)} | Shares: ${s.number_of_shares} | Value: UGX ${s.total_value} | ${s.status} ${s.acknowledged?'✓':''}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 7: REAL ESTATE
  // ================================================================

  // List real estate donations
  app.get('/api/real-estate-donations', requireAuth, ah(async (req, res) => {
    const { status, property_type } = req.query;
    let q = 'SELECT * FROM real_estate_donations WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (property_type) { q += ' AND property_type=$' + idx; params.push(esc(property_type)); idx++; }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single
  app.get('/api/real-estate-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM real_estate_donations WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    res.json(r.rows[0]);
  }));

  // Create real estate donation
  app.post('/api/real-estate-donations', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, property_name, property_address, property_type, square_footage, lot_size, year_built, appraised_value, legal_description, deed_number, notes } = req.body;
    if (!donor_name || !property_name) return res.status(400).json({ error: 'donor_name and property_name required' });
    const r = await pool.query(
      `INSERT INTO real_estate_donations (tenant_id,donor_name,donor_email,donor_phone,property_name,property_address,property_type,square_footage,lot_size,year_built,appraised_value,legal_description,deed_number,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.session.user.tenant_id, esc(donor_name), esc(donor_email||''), esc(donor_phone||''), esc(property_name), esc(property_address||''), esc(property_type||'residential'), square_footage||0, lot_size||0, year_built||null, appraised_value||0, esc(legal_description||''), esc(deed_number||''), esc(notes||'')]
    );
    await audit(req, 'create', 'real_estate_donations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update real estate donation
  app.put('/api/real-estate-donations/:id', requireAuth, ah(async (req, res) => {
    const { property_name, property_address, property_type, square_footage, appraised_value, status, notes } = req.body;
    const r = await pool.query(
      `UPDATE real_estate_donations SET property_name=COALESCE($1,property_name), property_address=COALESCE($2,property_address),
       property_type=COALESCE($3,property_type), square_footage=COALESCE($4,square_footage),
       appraised_value=COALESCE($5,appraised_value), status=COALESCE($6,status), notes=COALESCE($7,notes)
       WHERE tenant_id=$8 AND id=$9 RETURNING *`,
      [property_name?esc(property_name):null, property_address?esc(property_address):null, property_type?esc(property_type):null,
       square_footage, appraised_value, status?esc(status):null, notes?esc(notes):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete real estate donation
  app.delete('/api/real-estate-donations/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM real_estate_donations WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'delete', 'real_estate_donations', req.params.id);
    res.json({ ok: true });
  }));

  // Appraise property
  app.post('/api/real-estate-donations/:id/appraise', requireAuth, ah(async (req, res) => {
    const { appraised_value, appraised_by, appraisal_date } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET appraised_value=COALESCE($1,appraised_value), appraised_by=COALESCE($2,appraised_by), appraisal_date=COALESCE($3,appraisal_date), appraisal_status=$4 WHERE tenant_id=$5 AND id=$6 RETURNING *',
      [appraised_value||null, appraised_by?esc(appraised_by):null, appraisal_date||null, 'completed', req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Legal review
  app.post('/api/real-estate-donations/:id/legal-review', requireAuth, ah(async (req, res) => {
    const { status: reviewStatus, notes } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET legal_review_status=COALESCE($1,legal_review_status), notes=COALESCE($2,notes) WHERE tenant_id=$3 AND id=$4 RETURNING *',
      [reviewStatus?esc(reviewStatus):null, notes?esc(notes):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Title search
  app.post('/api/real-estate-donations/:id/title-search', requireAuth, ah(async (req, res) => {
    const { title_search_status } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET title_search_status=COALESCE($1,title_search_status) WHERE tenant_id=$2 AND id=$3 RETURNING *',
      [title_search_status?esc(title_search_status):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Environmental check
  app.post('/api/real-estate-donations/:id/environmental-check', requireAuth, ah(async (req, res) => {
    const { environmental_status } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET environmental_status=COALESCE($1,environmental_status) WHERE tenant_id=$2 AND id=$3 RETURNING *',
      [environmental_status?esc(environmental_status):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Tax lien check
  app.post('/api/real-estate-donations/:id/tax-lien-check', requireAuth, ah(async (req, res) => {
    const { tax_lien_check } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET tax_lien_check=COALESCE($1,tax_lien_check) WHERE tenant_id=$2 AND id=$3 RETURNING *',
      [tax_lien_check?esc(tax_lien_check):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Insurance status
  app.post('/api/real-estate-donations/:id/insurance', requireAuth, ah(async (req, res) => {
    const { insurance_status } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET insurance_status=COALESCE($1,insurance_status) WHERE tenant_id=$2 AND id=$3 RETURNING *',
      [insurance_status?esc(insurance_status):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Accept property
  app.post('/api/real-estate-donations/:id/accept', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'UPDATE real_estate_donations SET status=$1, acceptance_date=CURRENT_DATE WHERE tenant_id=$2 AND id=$3 RETURNING *',
      ['accepted', req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    // Notify donor
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'Property Donation Accepted', `Dear ${r.rows[0].donor_name}, your donation of "${r.rows[0].property_name}" has been accepted. Thank you for your generosity.`); } catch(e) {}
    }
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Reject property
  app.post('/api/real-estate-donations/:id/reject', requireAuth, ah(async (req, res) => {
    const { reason } = req.body;
    const r = await pool.query(
      'UPDATE real_estate_donations SET status=$1, notes=COALESCE($2,notes) WHERE tenant_id=$3 AND id=$4 RETURNING *',
      ['rejected', reason?esc(reason):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Property donation not found' });
    await audit(req, 'update', 'real_estate_donations', req.params.id);
    res.json(r.rows[0]);
  }));

  // Appraisals CRUD
  app.get('/api/real-estate-donations/:id/appraisals', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM real_estate_appraisals WHERE tenant_id=$1 AND property_id=$2 ORDER BY appraisal_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/real-estate-donations/:id/appraisals', requireAuth, ah(async (req, res) => {
    const { appraiser_name, appraiser_license, appraised_value, appraisal_date, market_value, condition, methodology, report_url, notes } = req.body;
    const r = await pool.query(
      `INSERT INTO real_estate_appraisals (tenant_id,property_id,appraiser_name,appraiser_license,appraised_value,appraisal_date,market_value,condition,methodology,report_url,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, esc(appraiser_name||''), esc(appraiser_license||''), appraised_value||0, appraisal_date||null, market_value||0, esc(condition||'fair'), esc(methodology||''), esc(report_url||''), esc(notes||'')]
    );
    // Update the main property with the latest appraised value
    await pool.query('UPDATE real_estate_donations SET appraised_value=$1, appraisal_status=$2 WHERE id=$3 AND tenant_id=$4', [appraised_value||0, 'completed', req.params.id, req.session.user.tenant_id]);
    await audit(req, 'create', 'real_estate_appraisals', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Documents
  app.get('/api/real-estate-donations/:id/documents', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM real_estate_documents WHERE tenant_id=$1 AND property_id=$2 ORDER BY uploaded_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/real-estate-donations/:id/documents', requireAuth, ah(async (req, res) => {
    const { doc_type, doc_name, doc_url, description } = req.body;
    if (!doc_name) return res.status(400).json({ error: 'doc_name required' });
    const r = await pool.query(
      'INSERT INTO real_estate_documents (tenant_id,property_id,doc_type,doc_name,doc_url,description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(doc_type||'deed'), esc(doc_name), esc(doc_url||''), esc(description||'')]
    );
    await audit(req, 'create', 'real_estate_documents', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Real estate stats
  app.get('/api/real-estate-donations/stats/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT COUNT(*) as total_properties, COALESCE(SUM(appraised_value),0) as total_value,
       COUNT(CASE WHEN status='accepted' THEN 1 END) as accepted_count,
       COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
       COUNT(CASE WHEN appraisal_status='completed' THEN 1 END) as appraised_count,
       COUNT(CASE WHEN legal_review_status='completed' THEN 1 END) as legal_completed_count
       FROM real_estate_donations WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows[0]);
  }));

  // Page route
  app.get('/real-estate-donations', requireAuth, ah(async (req, res) => {
    const properties = await pool.query('SELECT * FROM real_estate_donations WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(appraised_value),0) as total_value FROM real_estate_donations WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'Real Estate Donations', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">Real Estate Donations</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="bg-orange-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Properties</p><p class="text-2xl font-bold text-orange-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-orange-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Value</p><p class="text-2xl font-bold text-orange-700">UGX ${stats.rows[0]?.total_value||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${properties.rows.map(p => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(p.property_name)}</h3>
        <p class="text-sm text-gray-500">${esc(p.property_type)} | Value: UGX ${p.appraised_value}</p>
        <p class="text-sm text-gray-500">Appraisal: ${p.appraisal_status} | Legal: ${p.legal_review_status} | ${p.status}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  // ================================================================
  // FEATURE 8: IRA ROLLOVERS
  // ================================================================

  // List IRA rollovers
  app.get('/api/ira-rollovers', requireAuth, ah(async (req, res) => {
    const { status, ira_type, is_qcd } = req.query;
    let q = 'SELECT * FROM ira_rollovers WHERE tenant_id=$1';
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    if (ira_type) { q += ' AND ira_type=$' + idx; params.push(esc(ira_type)); idx++; }
    if (is_qcd !== undefined) { q += ' AND is_qcd=$' + idx; params.push(is_qcd === 'true'); idx++; }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  // Get single
  app.get('/api/ira-rollovers/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM ira_rollovers WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    res.json(r.rows[0]);
  }));

  // Create IRA rollover
  app.post('/api/ira-rollovers', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, donor_ssn_last4, ira_type, custodian_name, custodian_account, custodian_phone, distribution_amount, distribution_date, transfer_method, is_qcd, qcd_age_verified, notes } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name required' });
    const r = await pool.query(
      `INSERT INTO ira_rollovers (tenant_id,donor_name,donor_email,donor_phone,donor_ssn_last4,ira_type,custodian_name,custodian_account,custodian_phone,distribution_amount,distribution_date,transfer_method,is_qcd,qcd_age_verified,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.session.user.tenant_id, esc(donor_name), esc(donor_email||''), esc(donor_phone||''), esc(donor_ssn_last4||''), esc(ira_type||'traditional'), esc(custodian_name||''), esc(custodian_account||''), esc(custodian_phone||''), distribution_amount||0, distribution_date||null, esc(transfer_method||'direct'), is_qcd||false, qcd_age_verified||false, esc(notes||'')]
    );
    await audit(req, 'create', 'ira_rollovers', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // Update IRA rollover
  app.put('/api/ira-rollovers/:id', requireAuth, ah(async (req, res) => {
    const { donor_name, donor_email, ira_type, custodian_name, custodian_account, distribution_amount, distribution_date, transfer_method, is_qcd, qcd_age_verified, status, notes } = req.body;
    const r = await pool.query(
      `UPDATE ira_rollovers SET donor_name=COALESCE($1,donor_name), donor_email=COALESCE($2,donor_email),
       ira_type=COALESCE($3,ira_type), custodian_name=COALESCE($4,custodian_name), custodian_account=COALESCE($5,custodian_account),
       distribution_amount=COALESCE($6,distribution_amount), distribution_date=COALESCE($7,distribution_date),
       transfer_method=COALESCE($8,transfer_method), is_qcd=COALESCE($9,is_qcd), qcd_age_verified=COALESCE($10,qcd_age_verified),
       status=COALESCE($11,status), notes=COALESCE($12,notes) WHERE tenant_id=$13 AND id=$14 RETURNING *`,
      [donor_name?esc(donor_name):null, donor_email?esc(donor_email):null, ira_type?esc(ira_type):null, custodian_name?esc(custodian_name):null,
       custodian_account?esc(custodian_account):null, distribution_amount, distribution_date||null, transfer_method?esc(transfer_method):null,
       is_qcd, qcd_age_verified, status?esc(status):null, notes?esc(notes):null, req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Delete IRA rollover
  app.delete('/api/ira-rollovers/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query('DELETE FROM ira_rollovers WHERE tenant_id=$1 AND id=$2 RETURNING id', [req.session.user.tenant_id, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    await audit(req, 'delete', 'ira_rollovers', req.params.id);
    res.json({ ok: true });
  }));

  // Confirm IRA rollover
  app.post('/api/ira-rollovers/:id/confirm', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'UPDATE ira_rollovers SET confirmed=true, confirmed_at=NOW(), confirmed_by=$1, status=$2 WHERE tenant_id=$3 AND id=$4 RETURNING *',
      [esc(req.session.user.name||''), 'confirmed', req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    // Notify donor
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'IRA Rollover Confirmed', `Dear ${r.rows[0].donor_name}, your IRA rollover of UGX ${r.rows[0].distribution_amount} has been confirmed. Thank you for your generosity.`); } catch(e) {}
    }
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Send tax form
  app.post('/api/ira-rollovers/:id/send-tax-form', requireAuth, ah(async (req, res) => {
    const { tax_year } = req.body;
    const year = tax_year || new Date().getFullYear();
    const r = await pool.query(
      'UPDATE ira_rollovers SET tax_form_sent=true, tax_form_sent_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    // Create tax document record
    await pool.query(
      'INSERT INTO ira_tax_documents (tenant_id,ira_rollover_id,doc_type,doc_name,tax_year,sent_at) VALUES ($1,$2,$3,$4,$5,NOW())',
      [req.session.user.tenant_id, req.params.id, 'tax_receipt', esc('IRA Tax Receipt ' + year), year]
    );
    // Send email
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, `IRA Tax Receipt - ${year}`, `Dear ${r.rows[0].donor_name}, your IRA distribution tax receipt for ${year} is attached. Amount: UGX ${r.rows[0].distribution_amount}. ${r.rows[0].is_qcd?'This qualifies as a Qualified Charitable Distribution (QCD).':''}`); } catch(e) {}
    }
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Send acknowledgment
  app.post('/api/ira-rollovers/:id/acknowledge', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'UPDATE ira_rollovers SET acknowledgment_sent=true, acknowledged_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found' });
    if (r.rows[0].donor_email) {
      try { await sendEmail(r.rows[0].donor_email, 'IRA Rollover Acknowledgment', `Dear ${r.rows[0].donor_name}, we acknowledge receipt of your IRA rollover donation of UGX ${r.rows[0].distribution_amount}. Thank you!`); } catch(e) {}
    }
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Verify QCD age
  app.post('/api/ira-rollovers/:id/verify-qcd-age', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      'UPDATE ira_rollovers SET qcd_age_verified=true WHERE tenant_id=$1 AND id=$2 AND is_qcd=true RETURNING *',
      [req.session.user.tenant_id, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'IRA rollover not found or not a QCD' });
    await audit(req, 'update', 'ira_rollovers', req.params.id);
    res.json(r.rows[0]);
  }));

  // Distributions CRUD
  app.get('/api/ira-rollovers/:id/distributions', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM ira_distributions WHERE tenant_id=$1 AND ira_rollover_id=$2 ORDER BY distribution_date DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/ira-rollovers/:id/distributions', requireAuth, ah(async (req, res) => {
    const { distribution_amount, distribution_date, check_number, wire_reference, received_date, deposit_date, deposit_account, notes } = req.body;
    if (!distribution_amount || distribution_amount <= 0) return res.status(400).json({ error: 'positive distribution_amount required' });
    const r = await pool.query(
      `INSERT INTO ira_distributions (tenant_id,ira_rollover_id,distribution_amount,distribution_date,check_number,wire_reference,received_date,deposit_date,deposit_account,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.session.user.tenant_id, req.params.id, distribution_amount, distribution_date||null, esc(check_number||''), esc(wire_reference||''), received_date||null, deposit_date||null, esc(deposit_account||''), esc(notes||'')]
    );
    await audit(req, 'create', 'ira_distributions', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/ira-distributions/:distId', requireAuth, ah(async (req, res) => {
    const { distribution_amount, received_date, deposit_date, notes } = req.body;
    const r = await pool.query(
      `UPDATE ira_distributions SET distribution_amount=COALESCE($1,distribution_amount), received_date=COALESCE($2,received_date),
       deposit_date=COALESCE($3,deposit_date), notes=COALESCE($4,notes) WHERE tenant_id=$5 AND id=$6 RETURNING *`,
      [distribution_amount, received_date||null, deposit_date||null, notes?esc(notes):null, req.session.user.tenant_id, req.params.distId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Distribution not found' });
    await audit(req, 'update', 'ira_distributions', req.params.distId);
    res.json(r.rows[0]);
  }));

  app.delete('/api/ira-distributions/:distId', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM ira_distributions WHERE tenant_id=$1 AND id=$2', [req.session.user.tenant_id, req.params.distId]);
    await audit(req, 'delete', 'ira_distributions', req.params.distId);
    res.json({ ok: true });
  }));

  // Tax documents
  app.get('/api/ira-rollovers/:id/tax-documents', requireAuth, ah(async (req, res) => {
    const r = await pool.query('SELECT * FROM ira_tax_documents WHERE tenant_id=$1 AND ira_rollover_id=$2 ORDER BY created_at DESC', [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/ira-rollovers/:id/tax-documents', requireAuth, ah(async (req, res) => {
    const { doc_type, doc_name, doc_url, tax_year } = req.body;
    if (!doc_name) return res.status(400).json({ error: 'doc_name required' });
    const r = await pool.query(
      'INSERT INTO ira_tax_documents (tenant_id,ira_rollover_id,doc_type,doc_name,doc_url,tax_year) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.session.user.tenant_id, req.params.id, esc(doc_type||'acknowledgment'), esc(doc_name), esc(doc_url||''), tax_year||new Date().getFullYear()]
    );
    await audit(req, 'create', 'ira_tax_documents', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  // IRA stats
  app.get('/api/ira-rollovers/stats/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(
      `SELECT COUNT(*) as total_rollovers, COALESCE(SUM(distribution_amount),0) as total_amount,
       COUNT(CASE WHEN confirmed THEN 1 END) as confirmed_count,
       COUNT(CASE WHEN is_qcd THEN 1 END) as qcd_count,
       COUNT(CASE WHEN tax_form_sent THEN 1 END) as tax_forms_sent,
       COUNT(CASE WHEN status='pending' THEN 1 END) as pending_count,
       COUNT(DISTINCT ira_type) as ira_types
       FROM ira_rollovers WHERE tenant_id=$1`,
      [req.session.user.tenant_id]
    );
    res.json(r.rows[0]);
  }));

  // Page route
  app.get('/ira-rollovers', requireAuth, ah(async (req, res) => {
    const iras = await pool.query('SELECT * FROM ira_rollovers WHERE tenant_id=$1 ORDER BY created_at DESC', [req.session.user.tenant_id]);
    const stats = await pool.query('SELECT COUNT(*) as total, COALESCE(SUM(distribution_amount),0) as total_amount, COUNT(CASE WHEN is_qcd THEN 1 END) as qcd_total FROM ira_rollovers WHERE tenant_id=$1', [req.session.user.tenant_id]);
    renderPage(req, res, 'IRA Rollovers', `<div class="max-w-6xl mx-auto p-6">
      <h1 class="text-2xl font-bold mb-6">IRA Rollovers</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-indigo-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Rollovers</p><p class="text-2xl font-bold text-indigo-700">${stats.rows[0]?.total||0}</p></div>
        <div class="bg-indigo-50 rounded-lg p-4"><p class="text-sm text-gray-600">Total Amount</p><p class="text-2xl font-bold text-indigo-700">UGX ${stats.rows[0]?.total_amount||0}</p></div>
        <div class="bg-indigo-50 rounded-lg p-4"><p class="text-sm text-gray-600">QCDs</p><p class="text-2xl font-bold text-indigo-700">${stats.rows[0]?.qcd_total||0}</p></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${iras.rows.map(i => `<div class="bg-white rounded-lg shadow p-4">
        <h3 class="font-semibold">${esc(i.donor_name)}</h3>
        <p class="text-sm text-gray-500">${esc(i.ira_type)} | UGX ${i.distribution_amount} | ${esc(i.transfer_method)} | ${i.confirmed?'<span class="text-emerald-600">Confirmed</span>':'<span class="text-amber-600">Pending</span>'} ${i.is_qcd?'| QCD':''}</p>
      </div>`).join('')}</div>
    </div>`);
  }));

  console.log('[FundraisingUltimate10] 8 features registered — Landing Pages, Payment Gateways, Donor Renewal, Gift Clubs, Video Integration, Stock/Securities, Real Estate, IRA Rollovers');
};
