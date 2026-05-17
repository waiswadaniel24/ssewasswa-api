// ============================================================
// FUNDRAISING ENHANCEMENTS MODULE
// Professional & Global-Ready Features for Fundraising Platform
// ============================================================
// Features implemented:
// 1. Social Sharing + Open Graph API
// 2. Donor Dashboard (/my-donations)
// 3. Campaign Payouts / Withdrawals
// 4. Donor Wall / Recognition
// 5. QR Codes for Campaigns
// 6. Refund Handling
// 7. Campaign Embed Widget
// 8. Matching Donations
// 9. Campaign Comments / Encouragement
// 10. Donation Thank You SMS/Email
// BONUS: Global Visibility, SEO, Sitemap, Trending, Campaign Following,
//        Milestones, Testimonials, Impact Tracking, Category API
// ============================================================

module.exports = function(app, pool, ah, requireAuth, requireNotBanned, requireFundraisingSubscription, renderPage, esc, notify, notifyAll, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // REUSABLE: Post-Donation Processing
  // (Called directly from donate-save routes)
  // =============================================
  async function processDonationEffects({ tenant_id, campaign_id, donation_id, donor_name, donor_email, donor_phone, amount, method, message, is_anonymous }) {
    // 1. Process matching donations
    try {
      const activeMatches = (await pool.query("SELECT * FROM matching_donations WHERE campaign_id=$1 AND status='active' AND matched_so_far < max_match_amount", [campaign_id])).rows;
      for (const match of activeMatches) {
        const matchAmount = Math.min(Math.round(parseInt(amount) * parseFloat(match.match_ratio)), parseInt(match.max_match_amount) - parseInt(match.matched_so_far));
        if (matchAmount > 0) {
          await pool.query('UPDATE matching_donations SET matched_so_far=matched_so_far+$1 WHERE id=$2', [matchAmount, match.id]);
          if (donation_id) {
            await pool.query('UPDATE campaign_donations SET matching_contribution=$1 WHERE id=$2', [matchAmount, donation_id]);
          }
          // Record as separate matching donation
          await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,amount,method,message,matching_contribution) VALUES($1,$2,$3,$4,$5,$6,0)',
            [tenant_id, campaign_id, match.sponsor_name+' (Matched)', matchAmount, method||'matched', '1:'+Math.round(parseFloat(match.match_ratio))+' match from '+match.sponsor_name]);
          break; // Apply first active match
        }
      }
    } catch(e) { console.warn('[Matching Donation Error]', e.message); }

    // 2. Update donor badges
    try {
      if (donor_email) {
        const totalDonated = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE donor_email=$1 AND refunded=false', [donor_email])).rows[0]?.total || 0;
        const badge = calculateBadge(parseInt(totalDonated));
        if (badge) {
          await pool.query(`INSERT INTO donor_recognition(tenant_id,donor_email,donor_name,badge_type,total_donated,campaigns_supported) VALUES($1,$2,$3,$4,$5,(SELECT COUNT(DISTINCT campaign_id) FROM campaign_donations WHERE donor_email=$2))
            ON CONFLICT (tenant_id, donor_email, badge_type) DO UPDATE SET total_donated=$5, awarded_at=NOW()`,
            [tenant_id, donor_email, donor_name||'Anonymous', badge, parseInt(totalDonated)]);
        }
      }
    } catch(e) { console.warn('[Badge Error]', e.message); }

    // 3. Send Thank You Email
    try {
      if (donor_email) {
        const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
        await sendEmail(donor_email, 'Thank You for Your Generous Donation!', `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white"><h1>Thank You!</h1></div>
            <div style="padding:30px;background:white;border:1px solid #e2e8f0">
              <p>Dear ${esc(donor_name||'Supporter')},</p>
              <p>Thank you for donating <strong style="color:#059669">UGX ${(parseInt(amount)||0).toLocaleString()}</strong> to <strong>"${esc(campaign?.title||'our campaign')}"</strong>.</p>
              <p>Your generosity is making a real difference. You can track your impact anytime.</p>
              <a href="${BASE_URL}/my-donations" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">View My Donations</a>
            </div>
          </div>
        `);
      }
      if (donation_id) {
        await pool.query('UPDATE campaign_donations SET thank_you_sent=true, donor_email=COALESCE(donor_email,$1), donor_phone=COALESCE(donor_phone,$2), is_anonymous=COALESCE(is_anonymous,$3) WHERE id=$4', [donor_email||null, donor_phone||null, is_anonymous||false, donation_id]);
      }
    } catch(e) { console.warn('[Thank You Email Error]', e.message); }

    // 4. Send Thank You SMS
    try {
      if (donor_phone) {
        const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
        await sendSMS(donor_phone, 'Thank you for donating UGX '+(parseInt(amount)||0).toLocaleString()+' to "'+(campaign?.title||'our campaign')+'". Your generosity makes a difference! - Comfort Zone');
      }
    } catch(e) { console.warn('[Thank You SMS Error]', e.message); }

    // 5. Notify campaign followers
    try {
      const followers = (await pool.query('SELECT user_email FROM campaign_followers WHERE campaign_id=$1 AND notify_on_update=true', [campaign_id])).rows;
      const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
      for (const f of followers) {
        notify(tenant_id, f.user_email, 'New Donation on '+campaign.title, 'A donation of UGX '+(parseInt(amount)||0).toLocaleString()+' was just made to "'+campaign.title+'"', 'fundraising');
      }
    } catch(e) {}

    // 6. Check milestones
    try {
      const campaign = (await pool.query('SELECT title, target FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
      const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [campaign_id])).rows[0]?.total || 0;
      const pct = campaign.target > 0 ? Math.round(parseInt(raised)/parseInt(campaign.target)*100) : 0;
      const milestonePcts = [25, 50, 75, 100];
      for (const mp of milestonePcts) {
        if (pct >= mp) {
          const existing = (await pool.query('SELECT id FROM campaign_milestones WHERE campaign_id=$1 AND title LIKE $2 AND is_completed=true', [campaign_id, mp+'% Milestone%'])).rows[0];
          if (!existing) {
            await pool.query('INSERT INTO campaign_milestones(tenant_id,campaign_id,title,description,target_amount,is_completed,reached_at,celebration_sent) VALUES($1,$2,$3,$4,$5,true,NOW(),true)',
              [tenant_id, campaign_id, mp+'% Milestone Reached!', 'Campaign has reached '+mp+'% of its fundraising goal.', Math.round(parseInt(campaign.target)*mp/100)]);
            notifyAll(tenant_id, 'Milestone: '+mp+'%!', '"'+campaign.title+'" has reached '+mp+'% of its goal!', 'fundraising');
            if (mp === 100) {
              await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE id=$1", [campaign_id]);
            }
            break;
          }
        }
      }
    } catch(e) { console.warn('[Milestone Error]', e.message); }
  }

  // Export the function for use in server.js donate-save routes
  module.exports.processDonationEffects = processDonationEffects;

  // =============================================
  // DATABASE MIGRATIONS - New Tables
  // =============================================
  const fundraisingMigrations = [
    // Payout requests - organizations request withdrawal of raised funds
    `CREATE TABLE IF NOT EXISTS payout_requests (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer','mobile_money','cheque','cash','eft')),
      account_details JSONB DEFAULT '{}',
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','completed','rejected','cancelled')),
      admin_notes TEXT,
      processed_by TEXT,
      processed_at TIMESTAMPTZ,
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Matching donations - sponsors pledge to match donations
    `CREATE TABLE IF NOT EXISTS matching_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      sponsor_name TEXT NOT NULL,
      sponsor_email TEXT,
      sponsor_logo TEXT,
      match_ratio NUMERIC(5,2) DEFAULT 1.00,
      max_match_amount INTEGER NOT NULL,
      matched_so_far INTEGER DEFAULT 0,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','expired','cancelled')),
      message TEXT,
      is_public BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign comments / encouragement
    `CREATE TABLE IF NOT EXISTS campaign_comments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      user_email TEXT,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_anonymous BOOLEAN DEFAULT false,
      parent_id INTEGER REFERENCES campaign_comments(id) ON DELETE CASCADE,
      likes INTEGER DEFAULT 0,
      is_pinned BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'visible' CHECK (status IN ('visible','hidden','flagged')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor recognition / badges
    `CREATE TABLE IF NOT EXISTS donor_recognition (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT,
      donor_name TEXT NOT NULL,
      badge_type TEXT NOT NULL CHECK (badge_type IN ('bronze','silver','gold','platinum','diamond','founder','champion','hero','legend','ambassador')),
      total_donated INTEGER DEFAULT 0,
      campaigns_supported INTEGER DEFAULT 0,
      display_on_wall BOOLEAN DEFAULT true,
      custom_message TEXT,
      awarded_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email, badge_type)
    )`,

    // Campaign shares tracking
    `CREATE TABLE IF NOT EXISTS campaign_shares (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      shared_by TEXT,
      platform TEXT CHECK (platform IN ('whatsapp','twitter','facebook','linkedin','email','link_copy','telegram','other')),
      ip_address TEXT,
      click_count INTEGER DEFAULT 0,
      donation_count INTEGER DEFAULT 0,
      donation_total INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Refund requests
    `CREATE TABLE IF NOT EXISTS refund_requests (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      refund_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','processing','completed','rejected')),
      admin_notes TEXT,
      processed_by TEXT,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign followers - users who want updates
    `CREATE TABLE IF NOT EXISTS campaign_followers (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      notify_on_update BOOLEAN DEFAULT true,
      notify_on_milestone BOOLEAN DEFAULT true,
      notify_on_comment BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(campaign_id, user_email)
    )`,

    // Campaign testimonials
    `CREATE TABLE IF NOT EXISTS campaign_testimonials (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      author_title TEXT,
      author_photo TEXT,
      content TEXT NOT NULL,
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      is_featured BOOLEAN DEFAULT false,
      is_approved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign milestones
    `CREATE TABLE IF NOT EXISTS campaign_milestones (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      target_amount INTEGER,
      target_date DATE,
      reached_at TIMESTAMPTZ,
      is_completed BOOLEAN DEFAULT false,
      celebration_sent BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign stories - for SEO and global visibility
    `CREATE TABLE IF NOT EXISTS campaign_stories (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      headline TEXT NOT NULL,
      body TEXT NOT NULL,
      image_url TEXT,
      video_url TEXT,
      slug TEXT UNIQUE,
      meta_description TEXT,
      meta_keywords TEXT[] DEFAULT '{}',
      is_published BOOLEAN DEFAULT false,
      published_at TIMESTAMPTZ,
      views_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor impact tracking
    `CREATE TABLE IF NOT EXISTS donor_impact (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      impact_description TEXT,
      impact_value TEXT,
      impact_unit TEXT DEFAULT 'people',
      verified BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  ];

  // ALTER TABLE additions for existing tables
  const fundraisingAlterMigrations = [
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS donor_email TEXT`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS donor_email TEXT`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS donor_phone TEXT`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT false`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS receipt_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS thank_you_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT false`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS matching_contribution INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS story TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS slug TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS seo_title TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS seo_description TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS seo_keywords TEXT[] DEFAULT '{}'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS total_shares INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS total_comments INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS total_followers INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS total_testimonials INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS matching_active BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS allow_comments BOOLEAN DEFAULT true`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS allow_testimonials BOOLEAN DEFAULT true`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Uganda'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS impact_summary TEXT`,
    `ALTER TABLE investor_offers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE matching_donations ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_comments ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE donor_recognition ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_testimonials ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_milestones ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_stories ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE donor_impact ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    // Backfill tenant_id
    `UPDATE investor_offers io SET tenant_id = (SELECT tenant_id FROM fundraising_campaigns WHERE id = io.campaign_id) WHERE io.tenant_id IS NULL`,
    `UPDATE investment_transactions it SET tenant_id = (SELECT tenant_id FROM fundraising_campaigns WHERE id = it.campaign_id) WHERE it.tenant_id IS NULL`,
    // Indexes for performance
    `CREATE INDEX IF NOT EXISTS idx_payout_requests_tenant ON payout_requests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payout_requests_campaign ON payout_requests(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matching_donations_campaign ON matching_donations(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_matching_donations_tenant ON matching_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_comments_campaign ON campaign_comments(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_comments_tenant ON campaign_comments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_recognition_tenant ON donor_recognition(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_shares_campaign ON campaign_shares(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_refund_requests_tenant ON refund_requests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_followers_campaign ON campaign_followers(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_testimonials_tenant ON campaign_testimonials(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_milestones_campaign ON campaign_milestones(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_stories_tenant ON campaign_stories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_impact_tenant ON donor_impact(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fundraising_campaigns_slug ON fundraising_campaigns(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_fundraising_campaigns_country ON fundraising_campaigns(country)`,
    `CREATE INDEX IF NOT EXISTS idx_fundraising_campaigns_category ON fundraising_campaigns(category)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_donations_email ON campaign_donations(donor_email)`,
  ];

  // Run migrations
  async function runFundraisingMigrations() {
    for (const sql of fundraisingMigrations) {
      try {
        await pool.query(sql);
      } catch(e) {
        console.warn('[Fundraising Migration]', e.message);
      }
    }
    for (const sql of fundraisingAlterMigrations) {
      try {
        await pool.query(sql);
      } catch(e) {
        console.warn('[Fundraising Alter Migration]', e.message);
      }
    }
    console.log('[Fundraising] All migrations completed');
  }
  runFundraisingMigrations().catch(e => console.error('[Fundraising Migration Error]', e.message));

  // =============================================
  // HELPER: Generate slug from title
  // =============================================
  function generateSlug(title) {
    return title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 80);
  }

  // =============================================
  // HELPER: Calculate donor badge
  // =============================================
  function calculateBadge(totalDonated) {
    if (totalDonated >= 50000000) return 'legend';
    if (totalDonated >= 20000000) return 'ambassador';
    if (totalDonated >= 10000000) return 'hero';
    if (totalDonated >= 5000000) return 'champion';
    if (totalDonated >= 2000000) return 'founder';
    if (totalDonated >= 1000000) return 'diamond';
    if (totalDonated >= 500000) return 'platinum';
    if (totalDonated >= 200000) return 'gold';
    if (totalDonated >= 100000) return 'silver';
    if (totalDonated >= 50000) return 'bronze';
    return null;
  }

  // =============================================
  // FEATURE 1: Social Sharing API + Open Graph
  // =============================================

  // Track a share event
  app.post('/api/campaigns/:id/share', ah(async (req, res) => {
    const { platform } = req.body;
    const campaign = (await pool.query('SELECT id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    await pool.query('INSERT INTO campaign_shares(campaign_id, shared_by, platform, ip_address) VALUES($1,$2,$3,$4)',
      [req.params.id, req.session?.user?.email || null, platform || 'other', req.ip || null]);
    await pool.query('UPDATE fundraising_campaigns SET total_shares=COALESCE(total_shares,0)+1 WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  }));

  // Track share link click (for analytics)
  app.get('/s/:shareId', ah(async (req, res) => {
    try {
      await pool.query('UPDATE campaign_shares SET click_count=click_count+1 WHERE id=$1', [req.params.shareId]);
    } catch(e) {}
    res.redirect('/discover');
  }));

  // Open Graph / SEO meta data API for campaigns
  app.get('/api/campaigns/:id/og', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    const pct = c.target > 0 ? Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100) : 0;
    res.json({
      og: {
        title: c.seo_title || c.title,
        description: c.seo_description || (c.description||'').substring(0, 200),
        image: c.image_url || `${BASE_URL}/og-default.png`,
        url: `${BASE_URL}/discover/${c.id}`,
        type: 'cause',
        site_name: 'Comfort Zone Fundraising',
        locale: 'en_UG'
      },
      twitter: {
        card: 'summary_large_image',
        title: c.seo_title || c.title,
        description: c.seo_description || (c.description||'').substring(0, 200),
        image: c.image_url || `${BASE_URL}/og-default.png`
      },
      campaign: {
        id: c.id,
        title: c.title,
        raised: parseInt(c.raised||0),
        target: parseInt(c.target||0),
        percentage: pct,
        donors: parseInt(c.donor_count||0),
        category: c.category,
        urgency: c.urgency_level,
        org_name: c.org_name,
        country: c.country || 'Uganda',
        share_url: `${BASE_URL}/discover/${c.id}`
      }
    });
  }));

  // =============================================
  // FEATURE 2: DONOR DASHBOARD (/my-donations)
  // =============================================
  app.get('/my-donations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const email = req.session.user.email;
    const t = req.session.user.tenant_id;
    const [donations, pledges, following, badges, impact] = await Promise.all([
      pool.query('SELECT d.*, fc.title as campaign_title, fc.category, fc.image_url, fc.status as campaign_status, t.name as org_name FROM campaign_donations d JOIN fundraising_campaigns fc ON d.campaign_id=fc.id JOIN tenants t ON fc.tenant_id=t.id WHERE (d.donor_email=$1 OR d.donor_name=(SELECT name FROM users WHERE email=$1)) ORDER BY d.donated_at DESC', [email]),
      pool.query('SELECT cp.*, fc.title as campaign_title FROM campaign_pledges cp JOIN fundraising_campaigns fc ON cp.campaign_id=fc.id WHERE cp.tenant_id=$1 AND (cp.donor_name=(SELECT name FROM users WHERE email=$2)) ORDER BY cp.pledged_at DESC', [t, email]),
      pool.query('SELECT cf.*, fc.title as campaign_title, fc.category, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, fc.target FROM campaign_followers cf JOIN fundraising_campaigns fc ON cf.campaign_id=fc.id WHERE cf.user_email=$1 ORDER BY cf.created_at DESC', [email]),
      pool.query('SELECT * FROM donor_recognition WHERE donor_email=$1 AND tenant_id=$2 ORDER BY awarded_at DESC', [email, t]),
      pool.query('SELECT di.*, fc.title as campaign_title FROM donor_impact di JOIN fundraising_campaigns fc ON di.campaign_id=fc.id WHERE di.donor_email=$1 AND di.tenant_id=$2 ORDER BY di.created_at DESC', [email, t])
    ]);

    const totalDonated = donations.rows.reduce((a, d) => a + parseInt(d.amount||0), 0);
    const totalPledged = pledges.rows.reduce((a, p) => a + parseInt(p.amount||0) - parseInt(p.paid||0), 0);
    const campaignsSupported = new Set(donations.rows.map(d => d.campaign_id)).size;
    const currentBadge = calculateBadge(totalDonated);
    const badgeColors = { bronze:'#cd7f32', silver:'#c0c0c0', gold:'#ffd700', platinum:'#e5e4e2', diamond:'#b9f2ff', founder:'#4f46e5', champion:'#059669', hero:'#f59e0b', legend:'#dc2626', ambassador:'#7c3aed' };

    res.send(renderPage('My Donations Dashboard', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488,#0891b2)">
        <h1>My Giving Dashboard</h1>
        <p>Track your donations, impact, and supported campaigns</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalDonated.toLocaleString()}</div><div>Total Donated</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${campaignsSupported}</div><div>Campaigns Supported</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${donations.rows.length}</div><div>Total Donations</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">UGX ${totalPledged.toLocaleString()}</div><div>Outstanding Pledges</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${following.rows.length}</div><div>Campaigns Following</div></div>
      </div>

      ${currentBadge ? '<div class="card" style="text-align:center;padding:30px;background:linear-gradient(135deg,'+badgeColors[currentBadge]+'20,'+badgeColors[currentBadge]+'10);border:2px solid '+badgeColors[currentBadge]+'"><div style="font-size:48px;margin-bottom:10px">'+{bronze:'🥉',silver:'🥈',gold:'🥇',platinum:'💎',diamond:'💠',founder:'🏆',champion:'🎯',hero:'⚡',legend:'👑',ambassador:'🌟'}[currentBadge]+'</div><h2 style="color:'+badgeColors[currentBadge]+'">'+currentBadge.charAt(0).toUpperCase()+currentBadge.slice(1)+' Donor</h2><p class="muted">You have donated over UGX '+totalDonated.toLocaleString()+' across '+campaignsSupported+' campaigns</p></div>' : ''}

      ${badges.rows.length > 0 ? '<div class="card"><h3>Your Badges</h3><div style="display:flex;gap:12px;flex-wrap:wrap">'+badges.rows.map(b=>'<div style="background:'+badgeColors[b.badge_type]+'15;border:1px solid '+badgeColors[b.badge_type]+'30;border-radius:12px;padding:12px;text-align:center;min-width:100px"><div style="font-size:24px">'+{bronze:'🥉',silver:'🥈',gold:'🥇',platinum:'💎',diamond:'💠',founder:'🏆',champion:'🎯',hero:'⚡',legend:'👑',ambassador:'🌟'}[b.badge_type]+'</div><div style="font-size:12px;font-weight:700;color:'+badgeColors[b.badge_type]+'">'+esc(b.badge_type.toUpperCase())+'</div></div>').join('')+'</div></div>' : ''}

      ${impact.rows.length > 0 ? '<div class="card"><h3>Your Impact</h3><div class="grid">'+impact.rows.map(i=>'<div class="card" style="padding:16px;border-left:4px solid #059669"><h4 style="margin:0 0 6px">'+esc(i.campaign_title)+'</h4><p style="color:#059669;font-weight:700;font-size:18px">'+esc(i.impact_value||'')+' '+esc(i.impact_unit||'people')+'</p><p class="muted">'+esc(i.impact_description||'')+'</p>'+(i.verified?'<span class="tag" style="background:#d1fae5;color:#065f46">Verified Impact</span>':'')+'</div>').join('')+'</div></div>' : ''}

      <div class="card" style="margin-top:20px">
        <h3>Donation History (${donations.rows.length})</h3>
        ${donations.rows.length > 0 ? '<table><tr><th>Campaign</th><th>Organization</th><th>Amount</th><th>Method</th><th>Date</th><th>Status</th></tr>'+
          donations.rows.map(d=>'<tr><td><strong>'+esc(d.campaign_title)+'</strong><br><span class="muted" style="font-size:12px">'+esc(d.category||'')+'</span></td><td class="muted">'+esc(d.org_name||'')+'</td><td style="font-weight:700;color:#059669">UGX '+(parseInt(d.amount)||0).toLocaleString()+(d.matching_contribution>0?'<br><span style="font-size:11px;color:#f59e0b">+UGX '+parseInt(d.matching_contribution).toLocaleString()+' matched</span>':'')+'</td><td><span class="tag">'+esc(d.method)+'</span></td><td>'+(d.donated_at?new Date(d.donated_at).toLocaleDateString():'')+'</td><td>'+(d.refunded?'<span class="tag" style="background:#fee2e2;color:#991b1b">Refunded</span>':'<span class="tag" style="background:#d1fae5;color:#065f46">Confirmed</span>')+'</td></tr>').join('')+'</table>' : '<p class="muted" style="text-align:center;padding:40px">You haven\'t made any donations yet. <a href="/discover" class="btn btn-green">Discover Campaigns</a></p>'}
      </div>

      ${following.rows.length > 0 ? '<div class="card" style="margin-top:20px"><h3>Campaigns You Follow</h3><div class="grid">'+following.rows.map(f=>{const p=f.target>0?Math.round(parseInt(f.raised||0)/parseInt(f.target||1)*100):0;return '<div class="card" style="padding:16px;border-left:4px solid #4f46e5"><h4 style="margin:0">'+esc(f.campaign_title)+'</h4><span class="muted" style="font-size:12px">'+esc(f.category||'')+'</span><div class="progress-bar" style="height:8px;margin:8px 0"><div class="progress-fill" style="width:'+p+'%;background:#059669">'+p+'%</div></div><div style="font-size:13px;color:#059669;font-weight:700">UGX '+(parseInt(f.raised)||0).toLocaleString()+' / UGX '+(parseInt(f.target)||0).toLocaleString()+'</div><div style="margin-top:8px"><a href="/discover/'+f.campaign_id+'" class="btn btn-sm">View</a> <a href="/campaigns/'+f.campaign_id+'/unfollow" class="btn btn-sm btn-red">Unfollow</a></div></div>';}).join('')+'</div></div>' : ''}
    `, req.session.user));
  }));

  // =============================================
  // FEATURE 3: CAMPAIGN PAYOUTS / WITHDRAWALS
  // =============================================
  app.get('/admin/payouts', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const [payouts, campaigns] = await Promise.all([
      pool.query('SELECT pr.*, fc.title as campaign_title, fc.raised as campaign_raised FROM payout_requests pr JOIN fundraising_campaigns fc ON pr.campaign_id=fc.id WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC', [t]),
      pool.query("SELECT c.id, c.title, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id) as raised, (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE campaign_id=c.id AND status IN ('completed','processing')) as paid_out FROM fundraising_campaigns c WHERE c.tenant_id=$1 AND c.status IN ('active','completed')", [t])
    ]);
    res.send(renderPage('Campaign Payouts', `
      <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)"><h1>Campaign Payouts</h1><p>Request and manage fund withdrawals</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${campaigns.rows.reduce((a,c)=>a+(parseInt(c.raised)||0),0).toLocaleString()}</div><div>Total Raised</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">UGX ${campaigns.rows.reduce((a,c)=>a+(parseInt(c.paid_out)||0),0).toLocaleString()}</div><div>Paid Out</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${payouts.rows.filter(p=>p.status==='pending').length}</div><div>Pending Requests</div></div>
        <div class="stat-card"><div class="stat-num">${payouts.rows.filter(p=>p.status==='completed').length}</div><div>Completed</div></div>
      </div>
      <a href="/admin/payouts/new" class="btn btn-green" style="margin-bottom:20px">+ Request Payout</a>
      <div class="card">
        <h3>Available Campaign Balances</h3>
        <table><tr><th>Campaign</th><th>Raised</th><th>Paid Out</th><th>Available</th><th>Action</th></tr>
        ${campaigns.rows.map(c=>{const avail=parseInt(c.raised||0)-parseInt(c.paid_out||0);return '<tr><td>'+esc(c.title)+'</td><td style="color:#059669;font-weight:700">UGX '+(parseInt(c.raised)||0).toLocaleString()+'</td><td style="color:#f59e0b">UGX '+(parseInt(c.paid_out)||0).toLocaleString()+'</td><td style="font-weight:700;color:'+(avail>0?'#059669':'#94a3b8')+'">UGX '+avail.toLocaleString()+'</td><td>'+(avail>0?'<a href="/admin/payouts/new?campaign_id='+c.id+'" class="btn btn-sm btn-green">Request</a>':'<span class="muted">N/A</span>')+'</td></tr>';}).join('')||'<tr><td colspan="5">No campaigns</td></tr>'}
        </table>
      </div>
      <div class="card" style="margin-top:20px">
        <h3>Payout History (${payouts.rows.length})</h3>
        ${payouts.rows.length > 0 ? '<table><tr><th>Campaign</th><th>Amount</th><th>Method</th><th>Status</th><th>Requested</th><th>Processed</th><th>Actions</th></tr>'+
          payouts.rows.map(p=>'<tr><td>'+esc(p.campaign_title)+'</td><td style="font-weight:700">UGX '+(parseInt(p.amount)||0).toLocaleString()+'</td><td><span class="tag">'+esc(p.method)+'</span></td><td><span class="tag" style="background:'+(p.status==='completed'?'#d1fae5;color:#065f46':p.status==='pending'?'#fef3c7;color:#92400e':p.status==='approved'?'#dbeafe;color:#1e40af':'#fee2e2;color:#991b1b')+'">'+esc(p.status)+'</span></td><td>'+(p.created_at?new Date(p.created_at).toLocaleDateString():'')+'</td><td>'+(p.processed_at?new Date(p.processed_at).toLocaleDateString():'-')+'</td><td>'+((p.status==='pending'||p.status==='approved')?'<a href="/admin/payouts/'+p.id+'/cancel" class="btn btn-sm btn-red" onclick="return confirm(\'Cancel this request?\')">Cancel</a>':'')+' '+(p.status==='pending'?'<a href="/admin/payouts/'+p.id+'/approve" class="btn btn-sm btn-green">Approve</a>':'')+' '+(p.status==='approved'?'<a href="/admin/payouts/'+p.id+'/complete" class="btn btn-sm btn-green">Mark Complete</a>':'')+'</td></tr>').join('')+'</table>' : '<p class="muted" style="text-align:center;padding:20px">No payout requests yet</p>'}
      </div>
    `, req.session.user));
  }));

  app.get('/admin/payouts/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id } = req.query;
    const campaigns = (await pool.query("SELECT c.id, c.title, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=c.id) as raised, (SELECT COALESCE(SUM(amount),0) FROM payout_requests WHERE campaign_id=c.id AND status IN ('completed','processing','approved')) as paid_out FROM fundraising_campaigns c WHERE c.tenant_id=$1 AND c.status IN ('active','completed')", [t])).rows;
    res.send(renderPage('Request Payout', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h2>Request Fund Payout</h2>
        <p class="muted" style="margin-bottom:20px">Withdraw raised funds from a campaign to your account</p>
        <form method="POST" action="/admin/payouts/save">
          <label style="font-weight:600;display:block;margin-bottom:6px">Campaign *</label>
          <select name="campaign_id" required style="width:100%">
            <option value="">Select campaign...</option>
            ${campaigns.map(c=>'<option value="'+c.id+'" '+(campaign_id==c.id?'selected':'')+'>'+esc(c.title)+' (Available: UGX '+(parseInt(c.raised||0)-parseInt(c.paid_out||0)).toLocaleString()+')</option>').join('')}
          </select>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Amount (UGX) *</label>
          <input name="amount" type="number" placeholder="Enter amount" required style="width:100%">
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Payout Method *</label>
          <select name="method" style="width:100%">
            <option value="bank_transfer">Bank Transfer / EFT</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash Pickup</option>
          </select>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Account / Phone Details</label>
          <textarea name="account_details" rows="3" placeholder="Bank: Stanbic, Account: 903000XXXX, Name: Org Name&#10;OR Phone: 256700000000 (for Mobile Money)" style="width:100%"></textarea>
          <button class="btn btn-green" style="width:100%;margin-top:20px;padding:14px;font-size:16px">Submit Payout Request</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/admin/payouts/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { campaign_id, amount, method, account_details } = req.body;
    await pool.query('INSERT INTO payout_requests(tenant_id,campaign_id,requested_by,amount,method,account_details) VALUES($1,$2,$3,$4,$5,$6)',
      [t, campaign_id, req.session.user.email, amount||0, method||'bank_transfer', { details: account_details||'' }]);
    // Notify admins
    notifyAll(t, 'Payout Request', 'A payout request of UGX '+(parseInt(amount)||0).toLocaleString()+' has been submitted for campaign #'+campaign_id, 'fundraising');
    res.redirect('/admin/payouts');
  }));

  app.get('/admin/payouts/:id/approve', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='approved', processed_by=$1 WHERE id=$2", [req.session.user.email, req.params.id]);
    res.redirect('/admin/payouts');
  }));

  app.get('/admin/payouts/:id/complete', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='completed', processed_by=$1, processed_at=NOW() WHERE id=$2", [req.session.user.email, req.params.id]);
    res.redirect('/admin/payouts');
  }));

  app.get('/admin/payouts/:id/cancel', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='cancelled', processed_by=$1, processed_at=NOW() WHERE id=$2", [req.session.user.email, req.params.id]);
    res.redirect('/admin/payouts');
  }));

  // =============================================
  // FEATURE 4: DONOR WALL / RECOGNITION
  // =============================================
  app.get('/campaigns/:id/donors', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const [donations, badges, topDonors] = await Promise.all([
      pool.query('SELECT donor_name, SUM(amount) as total, COUNT(*) as count, MAX(donated_at) as last_donation FROM campaign_donations WHERE campaign_id=$1 AND is_anonymous=false AND refunded=false GROUP BY donor_name ORDER BY total DESC LIMIT 100', [req.params.id]),
      pool.query('SELECT * FROM donor_recognition WHERE campaign_id=$1 AND display_on_wall=true ORDER BY total_donated DESC', [req.params.id]),
      pool.query("SELECT donor_name, SUM(amount) as total FROM campaign_donations WHERE campaign_id=$1 AND is_anonymous=false AND refunded=false GROUP BY donor_name ORDER BY total DESC LIMIT 3", [req.params.id])
    ]);
    const badgeIcons = {bronze:'🥉',silver:'🥈',gold:'🥇',platinum:'💎',diamond:'💠',founder:'🏆',champion:'🎯',hero:'⚡',legend:'👑',ambassador:'🌟'};
    const badgeColors = {bronze:'#cd7f32',silver:'#c0c0c0',gold:'#ffd700',platinum:'#e5e4e2',diamond:'#b9f2ff',founder:'#4f46e5',champion:'#059669',hero:'#f59e0b',legend:'#dc2626',ambassador:'#7c3aed'};
    res.send(renderPage('Donor Wall: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488)"><h1>Donor Wall</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>

      ${topDonors.rows.length > 0 ? '<div style="display:flex;gap:20px;justify-content:center;margin:30px 0;flex-wrap:wrap">'+
        topDonors.rows.map((d,i)=>'<div style="text-align:center;background:white;border-radius:16px;padding:24px;min-width:150px;box-shadow:0 4px 20px rgba(0,0,0,0.1);'+(i===0?'transform:scale(1.1);border:2px solid #ffd700':'')+'"><div style="font-size:40px;margin-bottom:8px">'+(i===0?'🥇':i===1?'🥈':'🥉')+'</div><h4 style="margin:0">'+esc(d.donor_name)+'</h4><p style="color:#059669;font-weight:700;font-size:18px;margin:4px 0">UGX '+(parseInt(d.total)||0).toLocaleString()+'</p></div>').join('')+
        '</div>' : ''}

      ${badges.rows.length > 0 ? '<div class="card"><h3>Recognized Donors</h3><div class="grid">'+badges.rows.map(b=>'<div class="card" style="padding:16px;text-align:center;border-top:4px solid '+badgeColors[b.badge_type]+'"><div style="font-size:32px">'+(badgeIcons[b.badge_type]||'🏅')+'</div><h4 style="margin:8px 0 4px">'+esc(b.donor_name)+'</h4><span class="tag" style="background:'+badgeColors[b.badge_type]+'20;color:'+badgeColors[b.badge_type]+'">'+esc(b.badge_type.toUpperCase())+'</span>'+(b.custom_message?'<p class="muted" style="margin-top:8px;font-size:13px">'+esc(b.custom_message)+'</p>':'')+'</div>').join('')+'</div></div>' : ''}

      <div class="card" style="margin-top:20px">
        <h3>All Donors (${donations.rows.length})</h3>
        ${donations.rows.length > 0 ? '<table><tr><th>Donor</th><th>Total Donated</th><th>Donations</th><th>Last Donation</th></tr>'+
          donations.rows.map(d=>'<tr><td><strong>'+esc(d.donor_name)+'</strong></td><td style="color:#059669;font-weight:700">UGX '+(parseInt(d.total)||0).toLocaleString()+'</td><td>'+d.count+'</td><td>'+(d.last_donation?new Date(d.last_donation).toLocaleDateString():'')+'</td></tr>').join('')+'</table>' : '<p class="muted" style="text-align:center;padding:40px">No public donors yet. Be the first to donate!</p>'}
        <div style="text-align:center;margin-top:20px"><a href="/discover/${req.params.id}/donate" class="btn btn-green">Donate Now</a></div>
      </div>
    `, req.session.user || null));
  }));

  // =============================================
  // FEATURE 5: QR CODES FOR CAMPAIGNS
  // =============================================
  app.get('/campaigns/:id/qr', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const campaignUrl = encodeURIComponent(BASE_URL+'/discover/'+c.id);
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${campaignUrl}&format=png&color=059669&bgcolor=ffffff`;
    res.send(renderPage('QR Code: '+c.title, `
      <div class="card" style="max-width:600px;margin:40px auto;text-align:center">
        <h2>Campaign QR Code</h2>
        <p class="muted">${esc(c.title)}</p>
        <div style="background:white;padding:30px;border-radius:16px;display:inline-block;margin:20px 0;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
          <img src="${qrApiUrl}" alt="QR Code for ${esc(c.title)}" style="width:300px;height:300px" onerror="this.src='https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${campaignUrl}'">
        </div>
        <p style="font-size:14px;color:#475569;margin-bottom:20px">Scan this QR code to go directly to the campaign donation page. Share it on posters, flyers, and printed materials.</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <a href="${qrApiUrl}" download="qr-campaign-${c.id}.png" class="btn btn-green">Download QR Code</a>
          <a href="/discover/${c.id}" class="btn">View Campaign</a>
          <a href="/campaigns/${c.id}/embed" class="btn">Get Embed Code</a>
        </div>
        <div style="margin-top:30px;text-align:left;background:#f8fafc;border-radius:12px;padding:20px">
          <h4 style="margin:0 0 12px">Ways to use your QR code:</h4>
          <ul style="margin:0;padding-left:20px;color:#475569;line-height:2">
            <li>Print on event posters and banners</li>
            <li>Add to church/school bulletins and newsletters</li>
            <li>Display on presentation slides during meetings</li>
            <li>Include on business cards and letterheads</li>
            <li>Place on donation boxes and collection tins</li>
            <li>Share on WhatsApp status and social media stories</li>
          </ul>
        </div>
      </div>
    `, req.session.user || null));
  }));

  // =============================================
  // FEATURE 6: REFUND HANDLING
  // =============================================
  app.get('/admin/refunds', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const [refunds, refundableDonations] = await Promise.all([
      pool.query('SELECT rr.*, fc.title as campaign_title, d.donor_name, d.amount as donation_amount, d.method as payment_method FROM refund_requests rr JOIN fundraising_campaigns fc ON rr.campaign_id=fc.id JOIN campaign_donations d ON rr.donation_id=d.id WHERE rr.tenant_id=$1 ORDER BY rr.created_at DESC', [t]),
      pool.query("SELECT d.*, fc.title as campaign_title FROM campaign_donations d JOIN fundraising_campaigns fc ON d.campaign_id=fc.id WHERE fc.tenant_id=$1 AND d.refunded=false ORDER BY d.donated_at DESC LIMIT 100", [t])
    ]);
    res.send(renderPage('Refund Management', `
      <div class="hero" style="background:linear-gradient(135deg,#dc2626,#ef4444)"><h1>Refund Management</h1><p>Process and track donation refunds</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${refunds.rows.filter(r=>r.status==='pending').length}</div><div>Pending</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${refunds.rows.filter(r=>r.status==='completed').length}</div><div>Completed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">UGX ${refunds.rows.filter(r=>r.status==='completed').reduce((a,r)=>a+(parseInt(r.refund_amount)||0),0).toLocaleString()}</div><div>Total Refunded</div></div>
      </div>
      <a href="/admin/refunds/new" class="btn btn-red" style="margin-bottom:20px">+ New Refund Request</a>
      <div class="card">
        <h3>Refund Requests (${refunds.rows.length})</h3>
        ${refunds.rows.length > 0 ? '<table><tr><th>Donation</th><th>Campaign</th><th>Donor</th><th>Refund Amount</th><th>Reason</th><th>Status</th><th>Date</th><th>Actions</th></tr>'+
          refunds.rows.map(r=>'<tr><td>UGX '+(parseInt(r.donation_amount)||0).toLocaleString()+' <span class="muted">('+esc(r.payment_method)+')</span></td><td>'+esc(r.campaign_title)+'</td><td>'+esc(r.donor_name)+'</td><td style="font-weight:700;color:#dc2626">UGX '+(parseInt(r.refund_amount)||0).toLocaleString()+'</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">'+esc((r.reason||'').substring(0,50))+'</td><td><span class="tag" style="background:'+(r.status==='completed'?'#d1fae5;color:#065f46':r.status==='pending'?'#fef3c7;color:#92400e':r.status==='approved'?'#dbeafe;color:#1e40af':'#fee2e2;color:#991b1b')+'">'+esc(r.status)+'</span></td><td>'+(r.created_at?new Date(r.created_at).toLocaleDateString():'')+'</td><td>'+(r.status==='pending'?'<a href="/admin/refunds/'+r.id+'/approve" class="btn btn-sm btn-green">Approve</a> <a href="/admin/refunds/'+r.id+'/reject" class="btn btn-sm btn-red">Reject</a>':'')+' '+(r.status==='approved'?'<a href="/admin/refunds/'+r.id+'/complete" class="btn btn-sm btn-green">Complete</a>':'')+'</td></tr>').join('')+'</table>' : '<p class="muted" style="text-align:center;padding:20px">No refund requests</p>'}
      </div>
    `, req.session.user));
  }));

  app.get('/admin/refunds/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const donations = (await pool.query("SELECT d.id, d.donor_name, d.amount, d.method, d.donated_at, fc.title as campaign_title, fc.id as campaign_id FROM campaign_donations d JOIN fundraising_campaigns fc ON d.campaign_id=fc.id WHERE fc.tenant_id=$1 AND d.refunded=false ORDER BY d.donated_at DESC LIMIT 200", [t])).rows;
    res.send(renderPage('New Refund Request', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h2>Request Refund</h2>
        <p class="muted" style="margin-bottom:20px">Process a refund for a donation</p>
        <form method="POST" action="/admin/refunds/save">
          <label style="font-weight:600;display:block;margin-bottom:6px">Donation *</label>
          <select name="donation_id" required style="width:100%">
            <option value="">Select donation...</option>
            ${donations.map(d=>'<option value="'+d.id+'" data-campaign="'+d.campaign_id+'">'+esc(d.donor_name)+' - UGX '+(parseInt(d.amount)||0).toLocaleString()+' ('+esc(d.campaign_title)+') on '+(d.donated_at?new Date(d.donated_at).toLocaleDateString():'')+'</option>').join('')}
          </select>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Refund Reason *</label>
          <select name="reason_type" style="width:100%">
            <option value="donor_request">Donor Request</option>
            <option value="duplicate">Duplicate Payment</option>
            <option value="fraud">Fraudulent Transaction</option>
            <option value="error">Administrative Error</option>
            <option value="campaign_cancelled">Campaign Cancelled</option>
            <option value="other">Other</option>
          </select>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Additional Details</label>
          <textarea name="reason" rows="3" placeholder="Explain the reason for this refund..." style="width:100%"></textarea>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Refund Amount (UGX) *</label>
          <input name="refund_amount" type="number" placeholder="Full or partial refund amount" required style="width:100%">
          <button class="btn btn-red" style="width:100%;margin-top:20px;padding:14px;font-size:16px">Submit Refund Request</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/admin/refunds/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donation_id, reason, refund_amount } = req.body;
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1', [donation_id])).rows[0];
    if (!donation) return res.status(404).send('Donation not found');
    await pool.query('INSERT INTO refund_requests(tenant_id,donation_id,campaign_id,requested_by,reason,refund_amount) VALUES($1,$2,$3,$4,$5,$6)',
      [t, donation_id, donation.campaign_id, req.session.user.email, reason||'', refund_amount||0]);
    res.redirect('/admin/refunds');
  }));

  app.get('/admin/refunds/:id/approve', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE refund_requests SET status='approved', processed_by=$1 WHERE id=$2", [req.session.user.email, req.params.id]);
    res.redirect('/admin/refunds');
  }));

  app.get('/admin/refunds/:id/reject', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE refund_requests SET status='rejected', processed_by=$1, processed_at=NOW() WHERE id=$2", [req.session.user.email, req.params.id]);
    res.redirect('/admin/refunds');
  }));

  app.get('/admin/refunds/:id/complete', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const refund = (await pool.query('SELECT * FROM refund_requests WHERE id=$1', [req.params.id])).rows[0];
    if (!refund) return res.status(404).send('Not found');
    // Mark refund completed and mark donation as refunded
    await pool.query("UPDATE refund_requests SET status='completed', processed_by=$1, processed_at=NOW() WHERE id=$2", [req.session.user.email, req.params.id]);
    await pool.query('UPDATE campaign_donations SET refunded=true WHERE id=$1', [refund.donation_id]);
    // Notify donor if email available
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1', [refund.donation_id])).rows[0];
    if (donation && donation.donor_email) {
      sendEmail(donation.donor_email, 'Refund Processed', '<p>Hi '+esc(donation.donor_name)+', your refund of UGX '+(parseInt(refund.refund_amount)||0).toLocaleString()+' has been processed. It may take 3-5 business days to reflect.</p>').catch(()=>{});
    }
    res.redirect('/admin/refunds');
  }));

  // =============================================
  // FEATURE 7: CAMPAIGN EMBED WIDGET
  // =============================================
  app.get('/campaigns/:id/embed', requireAuth, requireNotBanned, ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;
    const embedUrl = BASE_URL+'/embed/'+c.id;

    res.send(renderPage('Embed Campaign: '+c.title, `
      <div class="card" style="max-width:800px;margin:40px auto">
        <h2>Embed Campaign Widget</h2>
        <p class="muted" style="margin-bottom:20px">Add this campaign to your website, blog, or external page</p>

        <h3 style="margin-top:20px">Option 1: iframe Embed</h3>
        <div style="background:#1e293b;border-radius:10px;padding:16px;margin:10px 0">
          <code style="color:#10b981;font-size:13px;word-break:break-all">&lt;iframe src="${embedUrl}" width="400" height="520" frameborder="0" style="border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)"&gt;&lt;/iframe&gt;</code>
        </div>

        <h3 style="margin-top:24px">Option 2: JavaScript Widget</h3>
        <div style="background:#1e293b;border-radius:10px;padding:16px;margin:10px 0">
          <code style="color:#10b981;font-size:13px;word-break:break-all">&lt;script src="${BASE_URL}/js/embed.js" data-campaign="${c.id}" data-width="400" data-height="520"&gt;&lt;/script&gt;</code>
        </div>

        <h3 style="margin-top:24px">Option 3: Direct Link Button</h3>
        <div style="background:#1e293b;border-radius:10px;padding:16px;margin:10px 0">
          <code style="color:#10b981;font-size:13px;word-break:break-all">&lt;a href="${BASE_URL}/discover/${c.id}" style="display:inline-block;padding:14px 28px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px"&gt;Donate to ${esc(c.title)}&lt;/a&gt;</code>
        </div>

        <h3 style="margin-top:24px">Live Preview</h3>
        <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:20px;margin:10px 0">
          <iframe src="${embedUrl}" width="400" height="520" frameborder="0" style="border-radius:12px;max-width:100%"></iframe>
        </div>

        <div style="margin-top:20px;display:flex;gap:8px">
          <a href="/discover/${c.id}" class="btn">View Full Campaign</a>
          <a href="/campaigns/${c.id}/qr" class="btn">Get QR Code</a>
        </div>
      </div>
    `, req.session.user));
  }));

  // Embeddable campaign widget (no auth required)
  app.get('/embed/:id', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:20px}.widget{max-width:400px;margin:0 auto;background:white;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden}.img{height:180px;overflow:hidden}.img img{width:100%;height:100%;object-fit:cover}.body{padding:20px}.title{font-size:18px;font-weight:800;color:#1e293b;margin-bottom:6px}.org{font-size:13px;color:#64748b;margin-bottom:12px}.bar{background:#e2e8f0;height:12px;border-radius:6px;overflow:hidden;margin:10px 0}.fill{background:linear-gradient(90deg,#059669,#10b981);height:12px;border-radius:6px;transition:width 0.5s}.stats{display:flex;justify-content:space-between;margin:12px 0;font-size:14px}.amount{font-weight:800;color:#059669;font-size:20px}.goal{color:#94a3b8;font-size:13px}.donors{color:#64748b;font-size:13px}.btn{display:block;text-align:center;padding:14px;background:#059669;color:white;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px;margin-top:16px}.btn:hover{background:#047857}.tag{display:inline-block;background:#05966920;color:#059669;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:8px}</style></head><body><div class="widget">${c.image_url?'<div class="img"><img src="'+esc(c.image_url)+'" onerror="this.parentElement.style.display=\'none\'"></div>':''}<div class="body"><span class="tag">${esc(c.category)}</span><div class="title">${esc(c.title)}</div><div class="org">by ${esc(c.org_name)}</div><div class="bar"><div class="fill" style="width:${pct}%"></div></div><div class="stats"><div><div class="amount">UGX ${(parseInt(c.raised)||0).toLocaleString()}</div><div class="goal">of UGX ${(parseInt(c.target)||0).toLocaleString()}</div></div><div style="text-align:right"><div style="font-weight:700;color:#4f46e5">${pct}%</div><div class="donors">${parseInt(c.donor_count)||0} donors</div></div></div><a href="${BASE_URL}/discover/${c.id}/donate" class="btn" target="_blank">Donate Now</a></div></div></body></html>`);
  }));

  // =============================================
  // FEATURE 8: MATCHING DONATIONS
  // =============================================
  app.get('/campaigns/:id/matching', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const matchings = (await pool.query('SELECT * FROM matching_donations WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, t])).rows;
    res.send(renderPage('Matching Donations: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><h1>Matching Donations</h1><p>Set up sponsors to match every donation</p></div>
      <a href="/campaigns/${req.params.id}/matching/new" class="btn btn-green" style="margin-bottom:20px">+ Add Matching Sponsor</a>
      <div class="card">
        <h3>Active Matching Sponsors (${matchings.filter(m=>m.status==='active').length})</h3>
        ${matchings.length > 0 ? '<table><tr><th>Sponsor</th><th>Match Ratio</th><th>Max Match</th><th>Matched So Far</th><th>Remaining</th><th>Status</th><th>Actions</th></tr>'+
          matchings.map(m=>{const remaining=parseInt(m.max_match_amount||0)-parseInt(m.matched_so_far||0);return '<tr><td><strong>'+esc(m.sponsor_name)+'</strong>'+(m.sponsor_logo?'<br><img src="'+esc(m.sponsor_logo)+'" style="height:24px;margin-top:4px">':'')+'</td><td>'+parseFloat(m.match_ratio).toFixed(2)+'x</td><td style="font-weight:700">UGX '+(parseInt(m.max_match_amount)||0).toLocaleString()+'</td><td style="color:#f59e0b;font-weight:700">UGX '+(parseInt(m.matched_so_far)||0).toLocaleString()+'</td><td style="color:'+(remaining>0?'#059669':'#94a3b8')+';font-weight:700">UGX '+remaining.toLocaleString()+'</td><td><span class="tag" style="background:'+(m.status==='active'?'#d1fae5;color:#065f46':m.status==='completed'?'#dbeafe;color:#1e40af':'#fee2e2;color:#991b1b')+'">'+esc(m.status)+'</span></td><td>'+(m.status==='active'?'<a href="/campaigns/'+req.params.id+'/matching/'+m.id+'/pause" class="btn btn-sm">Pause</a>':'')+(m.status==='paused'?'<a href="/campaigns/'+req.params.id+'/matching/'+m.id+'/resume" class="btn btn-sm btn-green">Resume</a>':'')+'</td></tr>';}).join('')+'</table>' : '<p class="muted" style="text-align:center;padding:20px">No matching sponsors yet. Add a sponsor to double the impact of every donation!</p>'}
      </div>
      <div class="card" style="margin-top:20px">
        <h3>How Matching Works</h3>
        <div style="line-height:2;color:#475569">
          <p><strong>1:1 Match:</strong> For every UGX 10,000 donated, the sponsor adds another UGX 10,000 - doubling the impact.</p>
          <p><strong>2:1 Match:</strong> For every UGX 10,000 donated, the sponsor adds UGX 20,000 - tripling the impact.</p>
          <p><strong>Example:</strong> A sponsor pledges to match 1:1 up to UGX 5,000,000. If donors give UGX 3,000,000, the sponsor adds UGX 3,000,000 more - total UGX 6,000,000!</p>
        </div>
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/matching/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    res.send(renderPage('Add Matching Sponsor', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h2>Add Matching Sponsor</h2>
        <p class="muted" style="margin-bottom:20px">Set up a sponsor who will match donations to "${esc(c.title)}"</p>
        <form method="POST" action="/campaigns/${req.params.id}/matching/save">
          <label style="font-weight:600;display:block;margin-bottom:6px">Sponsor Name *</label>
          <input name="sponsor_name" placeholder="e.g. ABC Corporation" required style="width:100%">
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Sponsor Email</label>
          <input name="sponsor_email" type="email" placeholder="contact@abc.co.ug" style="width:100%">
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Sponsor Logo URL</label>
          <input name="sponsor_logo" placeholder="https://..." style="width:100%">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Match Ratio *</label><select name="match_ratio" style="width:100%"><option value="1.00">1:1 (Double)</option><option value="2.00">2:1 (Triple)</option><option value="0.50">0.5:1 (1.5x)</option><option value="3.00">3:1 (Quadruple)</option></select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Max Match Amount (UGX) *</label><input name="max_match_amount" type="number" placeholder="5000000" required style="width:100%"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Start Date</label><input name="start_date" type="date" style="width:100%"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:6px">End Date</label><input name="end_date" type="date" style="width:100%"></div>
          </div>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Public Message</label>
          <textarea name="message" rows="2" placeholder="e.g. ABC Corp will match your donation dollar for dollar!" style="width:100%"></textarea>
          <label style="display:flex;align-items:center;gap:8px;margin-top:16px;cursor:pointer"><input type="checkbox" name="is_public" value="true" checked> Show sponsor publicly on campaign page</label>
          <button class="btn btn-green" style="width:100%;margin-top:20px;padding:14px;font-size:16px">Create Matching Sponsor</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/matching/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { sponsor_name, sponsor_email, sponsor_logo, match_ratio, max_match_amount, start_date, end_date, message, is_public } = req.body;
    await pool.query('INSERT INTO matching_donations(tenant_id,campaign_id,sponsor_name,sponsor_email,sponsor_logo,match_ratio,max_match_amount,start_date,end_date,message,is_public) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [t, req.params.id, sponsor_name, sponsor_email||'', sponsor_logo||'', match_ratio||1, max_match_amount||0, start_date||null, end_date||null, message||'', is_public==='true']);
    await pool.query('UPDATE fundraising_campaigns SET matching_active=true WHERE id=$1', [req.params.id]);
    res.redirect('/campaigns/'+req.params.id+'/matching');
  }));

  app.get('/campaigns/:campaignId/matching/:id/pause', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE matching_donations SET status='paused' WHERE id=$1", [req.params.id]);
    res.redirect('/campaigns/'+req.params.campaignId+'/matching');
  }));

  app.get('/campaigns/:campaignId/matching/:id/resume', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE matching_donations SET status='active' WHERE id=$1", [req.params.id]);
    res.redirect('/campaigns/'+req.params.campaignId+'/matching');
  }));

  // =============================================
  // FEATURE 9: CAMPAIGN COMMENTS / ENCOURAGEMENT
  // =============================================
  app.get('/campaigns/:id/comments', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const comments = (await pool.query("SELECT * FROM campaign_comments WHERE campaign_id=$1 AND status='visible' ORDER BY is_pinned DESC, created_at DESC LIMIT 100", [req.params.id])).rows;
    res.send(renderPage('Comments: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488)"><h1>Campaign Encouragement Wall</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>
      <div style="max-width:700px;margin:0 auto">
        ${req.session.user ? '<div class="card" style="margin-bottom:20px"><h3>Leave a Message of Support</h3><form method="POST" action="/campaigns/'+req.params.id+'/comments/save"><input name="author_name" value="'+esc(req.session.user.name||'')+'" placeholder="Your Name" required><textarea name="content" rows="3" placeholder="Share a word of encouragement, prayer, or support..." required style="width:100%;margin:10px 0"></textarea><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="is_anonymous"> Post anonymously</label><button class="btn btn-green btn-sm" type="submit">Post Comment</button></div></form></div>' : '<div class="card" style="text-align:center;padding:30px"><p class="muted"><a href="/register">Sign up</a> or <a href="/login">log in</a> to leave a message of support</p></div>'}
        ${comments.length > 0 ? comments.map(cm=>'<div class="card" style="margin-bottom:12px;padding:16px;border-left:4px solid '+(cm.is_pinned?'#f59e0b':'#059669')+'">'+
          (cm.is_pinned?'<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">Pinned</span>':'')+
          '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><strong>'+esc(cm.is_anonymous?'Supporter':cm.author_name)+'</strong><span class="muted" style="font-size:12px">'+(cm.created_at?new Date(cm.created_at).toLocaleDateString():'')+'</span></div>'+
          '<p style="color:#475569;line-height:1.6">'+esc(cm.content)+'</p>'+
          '<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button onclick="fetch(\'/comments/'+cm.id+'/like\',{method:\'POST\'}).then(()=>location.reload())" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:13px">&#10084; '+cm.likes+'</button></div>'+
        '</div>').join('') : '<div class="card" style="text-align:center;padding:40px"><p class="muted">No messages yet. Be the first to show your support!</p></div>'}
      </div>
      <div style="text-align:center;margin-top:20px"><a href="/discover/${req.params.id}" class="btn">Back to Campaign</a> <a href="/discover/${req.params.id}/donate" class="btn btn-green">Donate</a></div>
    `, req.session.user || null));
  }));

  app.post('/campaigns/:id/comments/save', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { author_name, content, is_anonymous } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_comments(tenant_id,campaign_id,user_email,author_name,content,is_anonymous) VALUES($1,$2,$3,$4,$5,$6)',
      [t, req.params.id, req.session.user.email, author_name||req.session.user.name, content, is_anonymous==='on']);
    await pool.query('UPDATE fundraising_campaigns SET total_comments=COALESCE(total_comments,0)+1 WHERE id=$1', [req.params.id]);
    // Notify campaign followers
    try {
      const followers = (await pool.query('SELECT user_email FROM campaign_followers WHERE campaign_id=$1 AND notify_on_comment=true', [req.params.id])).rows;
      const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      for (const f of followers) {
        notify(t, f.user_email, 'New Comment on '+campaign.title, author_name+' commented on "'+campaign.title+'"', 'fundraising');
      }
    } catch(e) {}
    res.redirect('/campaigns/'+req.params.id+'/comments');
  }));

  app.post('/comments/:id/like', requireAuth, ah(async (req, res) => {
    await pool.query('UPDATE campaign_comments SET likes=likes+1 WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  }));

  // =============================================
  // FEATURE 10: DONATION THANK YOU SMS/EMAIL
  // (Auto-triggered on donation - see enhanced donate-save routes below)
  // =============================================

  // Manual resend thank you
  app.post('/donations/:id/thank-you', requireAuth, requireNotBanned, ah(async (req, res) => {
    const donation = (await pool.query('SELECT d.*, fc.title as campaign_title, fc.tenant_id FROM campaign_donations d JOIN fundraising_campaigns fc ON d.campaign_id=fc.id WHERE d.id=$1', [req.params.id])).rows[0];
    if (!donation) return res.status(404).json({ error: 'Not found' });
    // Send email
    if (donation.donor_email) {
      await sendEmail(donation.donor_email, 'Thank You for Your Generous Donation!', `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white">
            <h1>Thank You!</h1>
          </div>
          <div style="padding:30px;background:white;border:1px solid #e2e8f0">
            <p>Dear ${esc(donation.donor_name||'Supporter')},</p>
            <p>Thank you for your generous donation of <strong style="color:#059669">UGX ${(parseInt(donation.amount)||0).toLocaleString()}</strong> to <strong>"${esc(donation.campaign_title)}"</strong>.</p>
            <p>Your contribution is making a real difference. Here is a summary of your donation:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600">Campaign</td><td style="padding:10px;border:1px solid #e2e8f0">${esc(donation.campaign_title)}</td></tr>
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600">Amount</td><td style="padding:10px;border:1px solid #e2e8f0;color:#059669;font-weight:700">UGX ${(parseInt(donation.amount)||0).toLocaleString()}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600">Method</td><td style="padding:10px;border:1px solid #e2e8f0">${esc(donation.method||'N/A')}</td></tr>
              <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600">Date</td><td style="padding:10px;border:1px solid #e2e8f0">${donation.donated_at?new Date(donation.donated_at).toLocaleDateString():'Today'}</td></tr>
              ${donation.message?'<tr style="background:#f8fafc"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:600">Your Message</td><td style="padding:10px;border:1px solid #e2e8f0">'+esc(donation.message)+'</td></tr>':''}
            </table>
            <p>You can track your donation and the campaign progress at any time.</p>
            <a href="${BASE_URL}/my-donations" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">View My Donations</a>
          </div>
          <div style="text-align:center;padding:16px;color:#94a3b8;font-size:12px">Comfort Zone Fundraising - Empowering Communities</div>
        </div>
      `).catch(()=>{});
    }
    // Send SMS
    if (donation.donor_phone) {
      await sendSMS(donation.donor_phone, 'Thank you for donating UGX '+(parseInt(donation.amount)||0).toLocaleString()+' to "'+donation.campaign_title+'". Your generosity is making a difference! - Comfort Zone').catch(()=>{});
    }
    await pool.query('UPDATE campaign_donations SET thank_you_sent=true WHERE id=$1', [req.params.id]);
    res.json({ success: true, sent: true });
  }));

  // =============================================
  // ENHANCED DONATE-SAVE with Matching + Thank You + Badges
  // (The processDonationEffects function is defined above and exported.
  // server.js donate-save routes call it directly after loading the module.)

  // =============================================
  // BONUS: CAMPAIGN FOLLOWING
  // =============================================
  app.get('/campaigns/:id/follow', requireAuth, ah(async (req, res) => {
    try {
      await pool.query('INSERT INTO campaign_followers(campaign_id,user_email) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.session.user.email]);
      await pool.query('UPDATE fundraising_campaigns SET total_followers=COALESCE(total_followers,0)+1 WHERE id=$1', [req.params.id]);
    } catch(e) {}
    res.redirect('back');
  }));

  app.get('/campaigns/:id/unfollow', requireAuth, ah(async (req, res) => {
    try {
      await pool.query('DELETE FROM campaign_followers WHERE campaign_id=$1 AND user_email=$2', [req.params.id, req.session.user.email]);
      await pool.query('UPDATE fundraising_campaigns SET total_followers=GREATEST(COALESCE(total_followers,0)-1,0) WHERE id=$1', [req.params.id]);
    } catch(e) {}
    res.redirect('back');
  }));

  // =============================================
  // BONUS: CAMPAIGN TESTIMONIALS
  // =============================================
  app.get('/campaigns/:id/testimonials', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const testimonials = (await pool.query("SELECT * FROM campaign_testimonials WHERE campaign_id=$1 AND is_approved=true ORDER BY is_featured DESC, created_at DESC", [req.params.id])).rows;
    res.send(renderPage('Testimonials: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#ec4899)"><h1>Campaign Testimonials</h1><p>${esc(c.title)}</p></div>
      <div style="max-width:700px;margin:0 auto">
        ${testimonials.length > 0 ? testimonials.map(t=>'<div class="card" style="margin-bottom:16px;padding:20px;border-left:4px solid '+(t.is_featured?'#f59e0b':'#7c3aed')+'">'+
          (t.rating?'<div style="color:#f59e0b;margin-bottom:8px">'+'★'.repeat(t.rating)+'☆'.repeat(5-t.rating)+'</div>':'')+
          '<p style="font-style:italic;color:#475569;line-height:1.6;margin-bottom:12px">"'+esc(t.content)+'"</p>'+
          '<div style="display:flex;align-items:center;gap:10px">'+
          (t.author_photo?'<img src="'+esc(t.author_photo)+'" style="width:40px;height:40px;border-radius:50%;object-fit:cover">':'<div style="width:40px;height:40px;border-radius:50%;background:#7c3aed;color:white;display:flex;align-items:center;justify-content:center;font-weight:700">'+(t.author_name?esc(t.author_name.charAt(0).toUpperCase()):'?')+'</div>')+
          '<div><strong>'+esc(t.author_name)+'</strong>'+(t.author_title?'<br><span class="muted" style="font-size:12px">'+esc(t.author_title)+'</span>':'')+'</div>'+
          (t.is_featured?'<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin-left:auto">Featured</span>':'')+
          '</div></div>').join('') : '<div class="card" style="text-align:center;padding:40px"><p class="muted">No testimonials yet.</p></div>'}
        ${req.session.user ? '<div class="card" style="margin-top:20px"><h3>Share Your Testimonial</h3><form method="POST" action="/campaigns/'+req.params.id+'/testimonials/save"><input name="author_name" value="'+esc(req.session.user.name||'')+'" placeholder="Your Name" required style="width:100%"><input name="author_title" placeholder="Your Title (e.g. Beneficiary, Volunteer)" style="width:100%;margin-top:10px"><textarea name="content" rows="3" placeholder="Share your experience with this campaign..." required style="width:100%;margin:10px 0"></textarea><label style="font-weight:600;display:block;margin-bottom:6px">Rating</label><select name="rating" style="width:100%"><option value="5">5 Stars - Excellent</option><option value="4">4 Stars - Very Good</option><option value="3">3 Stars - Good</option><option value="2">2 Stars - Fair</option><option value="1">1 Star - Poor</option></select><button class="btn btn-green" style="width:100%;margin-top:16px">Submit Testimonial</button></form></div>' : ''}
      </div>
    `, req.session.user || null));
  }));

  app.post('/campaigns/:id/testimonials/save', requireAuth, ah(async (req, res) => {
    const { author_name, author_title, content, rating } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_testimonials(tenant_id,campaign_id,author_name,author_title,content,rating) VALUES($1,$2,$3,$4,$5,$6)',
      [t, req.params.id, author_name, author_title||'', content, rating||5]);
    await pool.query('UPDATE fundraising_campaigns SET total_testimonials=COALESCE(total_testimonials,0)+1 WHERE id=$1', [req.params.id]);
    res.redirect('/campaigns/'+req.params.id+'/testimonials');
  }));

  // =============================================
  // BONUS: GLOBAL VISIBILITY - SEO, SITEMAP, TRENDING
  // =============================================

  // XML Sitemap for search engines
  app.get('/sitemap.xml', ah(async (req, res) => {
    const campaigns = (await pool.query("SELECT fc.id, fc.updated_at, fc.created_at, fc.slug FROM fundraising_campaigns fc WHERE fc.is_public=true AND fc.status='active' ORDER BY fc.created_at DESC LIMIT 1000")).rows;
    const pages = (await pool.query("SELECT slug, updated_at FROM public_pages WHERE is_published=true")).rows;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>'+BASE_URL+'</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n';
    xml += '  <url><loc>'+BASE_URL+'/discover</loc><changefreq>daily</changefreq><priority>0.9</priority></url>\n';
    xml += '  <url><loc>'+BASE_URL+'/register</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n';
    xml += '  <url><loc>'+BASE_URL+'/login</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n';
    xml += '  <url><loc>'+BASE_URL+'/investor/register</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n';
    for (const c of campaigns) {
      const lastmod = c.updated_at || c.created_at || new Date().toISOString();
      xml += '  <url><loc>'+BASE_URL+'/discover/'+c.id+'</loc><lastmod>'+new Date(lastmod).toISOString().split('T')[0]+'</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n';
    }
    for (const p of pages) {
      if (p.slug) xml += '  <url><loc>'+BASE_URL+'/page/'+p.slug+'</loc><lastmod>'+new Date(p.updated_at||Date.now()).toISOString().split('T')[0]+'</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n';
    }
    xml += '</urlset>';
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }));

  // robots.txt for search engine crawlers
  app.get('/robots.txt', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`User-agent: *
Allow: /
Allow: /discover
Allow: /sitemap.xml
Disallow: /admin/
Disallow: /fundraising/
Disallow: /dashboard
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml
`);
  });

  // Trending campaigns API (for global visibility)
  app.get('/api/trending-campaigns', ah(async (req, res) => {
    const { limit, category, country } = req.query;
    const l = Math.min(parseInt(limit)||10, 50);
    let where = "WHERE fc.is_public=true AND fc.status='active'";
    const params = [];
    if (category) { params.push(category); where += ` AND fc.category=$${params.length}`; }
    if (country) { params.push(country); where += ` AND fc.country=$${params.length}`; }
    const campaigns = (await pool.query(`SELECT fc.id, fc.title, fc.category, fc.country, fc.urgency_level, fc.featured, fc.image_url, fc.location, fc.created_at, t.name as org_name, t.type as org_type,
      (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised,
      fc.target,
      (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count,
      COALESCE(fc.views_count,0) as views,
      COALESCE(fc.total_shares,0) as shares,
      COALESCE(fc.total_comments,0) as comments
      FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id ${where}
      ORDER BY (COALESCE(fc.views_count,0)*1 + (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id)*10 + COALESCE(fc.total_shares,0)*5 + COALESCE(fc.total_comments,0)*3) DESC, fc.featured DESC
      LIMIT $${params.length+1}`, [...params, l])).rows;
    res.json(campaigns.map(c => ({
      id: c.id, title: c.title, category: c.category, country: c.country, urgency: c.urgency_level,
      featured: c.featured, image: c.image_url, location: c.location, org_name: c.org_name, org_type: c.org_type,
      raised: parseInt(c.raised||0), target: parseInt(c.target||0), donors: parseInt(c.donor_count||0),
      views: parseInt(c.views||0), shares: parseInt(c.shares||0), comments: parseInt(c.comments||0),
      url: `${BASE_URL}/discover/${c.id}`
    })));
  }));

  // Campaign categories API (for navigation and SEO)
  app.get('/api/campaign-categories', ah(async (req, res) => {
    const categories = (await pool.query("SELECT category, COUNT(*) as count, SUM((SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id)) as total_raised FROM fundraising_campaigns WHERE is_public=true AND status='active' GROUP BY category ORDER BY count DESC")).rows;
    res.json(categories.map(c => ({
      slug: c.category, name: c.category.charAt(0).toUpperCase()+c.category.slice(1).replace(/_/g,' '),
      count: parseInt(c.count), total_raised: parseInt(c.total_raised||0)
    })));
  }));

  // Global statistics API (for homepage and SEO)
  app.get('/api/global-stats', ah(async (req, res) => {
    const stats = (await pool.query(`SELECT
      (SELECT COUNT(*) FROM fundraising_campaigns WHERE is_public=true AND status='active') as active_campaigns,
      (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE refunded=false) as total_raised,
      (SELECT COUNT(*) FROM campaign_donations WHERE refunded=false) as total_donations,
      (SELECT COUNT(DISTINCT tenant_id) FROM fundraising_campaigns WHERE is_public=true) as organizations,
      (SELECT COUNT(DISTINCT donor_name) FROM campaign_donations WHERE refunded=false) as unique_donors,
      (SELECT COUNT(DISTINCT country) FROM fundraising_campaigns WHERE country IS NOT NULL) as countries
    `)).rows[0];
    res.json({
      active_campaigns: parseInt(stats.active_campaigns||0),
      total_raised: parseInt(stats.total_raised||0),
      total_donations: parseInt(stats.total_donations||0),
      organizations: parseInt(stats.organizations||0),
      unique_donors: parseInt(stats.unique_donors||0),
      countries: parseInt(stats.countries||0)
    });
  }));

  // Campaign Stories for SEO
  app.get('/campaigns/:id/story', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const stories = (await pool.query("SELECT * FROM campaign_stories WHERE campaign_id=$1 AND is_published=true ORDER BY published_at DESC", [req.params.id])).rows;
    res.send(renderPage('Stories: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)"><h1>Campaign Stories</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>
      <div style="max-width:700px;margin:0 auto">
        ${stories.length > 0 ? stories.map(s=>'<div class="card" style="margin-bottom:20px;padding:24px">'+
          (s.image_url?'<img src="'+esc(s.image_url)+'" style="width:100%;border-radius:12px;margin-bottom:16px;max-height:300px;object-fit:cover">':'')+
          '<h2 style="margin:0 0 8px">'+esc(s.headline)+'</h2>'+
          '<div style="color:#475569;line-height:1.8;white-space:pre-wrap">'+esc(s.body)+'</div>'+
          (s.video_url?'<div style="margin-top:16px"><a href="'+esc(s.video_url)+'" class="btn" target="_blank">Watch Video</a></div>':'')+
        '</div>').join('') : '<div class="card" style="text-align:center;padding:40px"><p class="muted">No stories published yet for this campaign.</p></div>'}
      </div>
      <div style="text-align:center;margin-top:20px"><a href="/discover/${req.params.id}" class="btn">Back to Campaign</a></div>
    `, req.session.user || null));
  }));

  // Save campaign story (admin)
  app.post('/campaigns/:id/story/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { headline, body, image_url, video_url, meta_description, is_published } = req.body;
    const slug = generateSlug(headline);
    await pool.query('INSERT INTO campaign_stories(tenant_id,campaign_id,headline,body,image_url,video_url,slug,meta_description,is_published,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [t, req.params.id, headline, body, image_url||'', video_url||'', slug, meta_description||'', is_published==='true', is_published==='true'?new Date():null]);
    res.redirect('/campaigns/'+req.params.id+'/story');
  }));

  // =============================================
  // BONUS: CAMPAIGN MILESTONES (view)
  // =============================================
  app.get('/campaigns/:id/milestones', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const milestones = (await pool.query('SELECT * FROM campaign_milestones WHERE campaign_id=$1 ORDER BY target_amount ASC', [req.params.id])).rows;
    const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [req.params.id])).rows[0]?.total || 0;
    res.send(renderPage('Milestones: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)"><h1>Campaign Milestones</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${parseInt(raised).toLocaleString()}</div><div>Raised So Far</div></div>
        <div class="stat-card"><div class="stat-num">${milestones.filter(m=>m.is_completed).length}/${milestones.length}</div><div>Milestones Reached</div></div>
      </div>
      <div style="max-width:700px;margin:0 auto">
        ${milestones.length > 0 ? milestones.map(m=>'<div class="card" style="margin-bottom:16px;padding:20px;border-left:4px solid '+(m.is_completed?'#059669':'#e2e8f0')+'">'+
          '<div style="display:flex;justify-content:space-between;align-items:start"><h3 style="margin:0">'+esc(m.title)+'</h3>'+(m.is_completed?'<span class="tag" style="background:#d1fae5;color:#065f46">Completed</span>':'<span class="tag">In Progress</span>')+'</div>'+
          (m.description?'<p class="muted" style="margin:8px 0">'+esc(m.description)+'</p>':'')+
          (m.target_amount?'<div style="font-size:14px;margin-top:8px">Target: <strong>UGX '+parseInt(m.target_amount).toLocaleString()+'</strong>'+(m.reached_at?' - Reached on '+new Date(m.reached_at).toLocaleDateString():'')+'</div>':'')+
          (m.target_date?'<div style="font-size:13px;color:#94a3b8;margin-top:4px">Target Date: '+new Date(m.target_date).toLocaleDateString()+'</div>':'')+
        '</div>').join('') : '<div class="card" style="text-align:center;padding:40px"><p class="muted">No milestones defined yet.</p></div>'}
      </div>
      ${req.session.user ? '<div style="text-align:center;margin-top:20px"><a href="/campaigns/'+req.params.id+'/milestones/new" class="btn btn-green">Add Milestone</a></div>' : ''}
    `, req.session.user || null));
  }));

  app.get('/campaigns/:id/milestones/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Add Milestone', `
      <div class="card" style="max-width:600px;margin:40px auto"><h2>Add Campaign Milestone</h2>
        <form method="POST" action="/campaigns/${req.params.id}/milestones/save">
          <input name="title" placeholder="Milestone Title (e.g. 50% Goal Reached)" required style="width:100%">
          <textarea name="description" rows="2" placeholder="Describe what this milestone represents..." style="width:100%;margin-top:10px"></textarea>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px">
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Target Amount (UGX)</label><input name="target_amount" type="number" placeholder="2500000" style="width:100%"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:6px">Target Date</label><input name="target_date" type="date" style="width:100%"></div>
          </div>
          <button class="btn btn-green" style="width:100%;margin-top:20px;padding:14px">Create Milestone</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/milestones/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, description, target_amount, target_date } = req.body;
    await pool.query('INSERT INTO campaign_milestones(tenant_id,campaign_id,title,description,target_amount,target_date) VALUES($1,$2,$3,$4,$5,$6)',
      [t, req.params.id, title, description||'', target_amount||null, target_date||null]);
    res.redirect('/campaigns/'+req.params.id+'/milestones');
  }));

  // =============================================
  // BONUS: DONOR IMPACT TRACKING
  // =============================================
  app.get('/campaigns/:id/impact', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const impacts = (await pool.query('SELECT * FROM donor_impact WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id])).rows;
    res.send(renderPage('Impact: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488)"><h1>Campaign Impact</h1><p>See the real-world difference your donations make</p></div>
      <div style="max-width:700px;margin:0 auto">
        ${impacts.length > 0 ? '<div class="grid">'+impacts.map(i=>'<div class="card" style="padding:20px;text-align:center;border-top:4px solid #059669">'+
          '<div style="font-size:36px;font-weight:900;color:#059669">'+esc(i.impact_value||'0')+'</div>'+
          '<div style="font-size:14px;color:#64748b;margin-bottom:8px">'+esc(i.impact_unit||'people helped')+'</div>'+
          '<p style="color:#475569;font-size:14px">'+esc(i.impact_description||'')+'</p>'+
          (i.verified?'<span class="tag" style="background:#d1fae5;color:#065f46;margin-top:8px">Verified</span>':'')+
        '</div>').join('')+'</div>' : '<div class="card" style="text-align:center;padding:40px"><p class="muted">Impact data will be updated as the campaign progresses.</p></div>'}
      </div>
    `, req.session.user || null));
  }));

  // =============================================
  // BONUS: ENHANCED DISCOVER - More Global Features
  // =============================================

  // Featured campaigns widget (for embedding)
  app.get('/api/featured-campaigns', ah(async (req, res) => {
    const { limit } = req.query;
    const l = Math.min(parseInt(limit)||6, 20);
    const campaigns = (await pool.query(`SELECT fc.id, fc.title, fc.category, fc.country, fc.image_url, fc.urgency_level, fc.location, t.name as org_name,
      (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, fc.target
      FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id
      WHERE fc.is_public=true AND fc.status='active' AND fc.featured=true
      ORDER BY fc.created_at DESC LIMIT $1`, [l])).rows;
    res.json(campaigns);
  }));

  // Campaign search API (global)
  app.get('/api/search-campaigns', ah(async (req, res) => {
    const { q, category, country, sort, limit } = req.query;
    const l = Math.min(parseInt(limit)||20, 50);
    let where = "WHERE fc.is_public=true AND fc.status='active'";
    const params = [];
    if (q) { params.push('%'+q+'%'); where += ` AND (fc.title ILIKE $${params.length} OR fc.description ILIKE $${params.length} OR fc.location ILIKE $${params.length})`; }
    if (category) { params.push(category); where += ` AND fc.category=$${params.length}`; }
    if (country) { params.push(country); where += ` AND fc.country=$${params.length}`; }
    let orderBy = 'ORDER BY fc.featured DESC, fc.created_at DESC';
    if (sort === 'most_raised') orderBy = 'ORDER BY raised DESC';
    if (sort === 'urgent') orderBy = "ORDER BY CASE fc.urgency_level WHEN 'critical' THEN 5 WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 END DESC";
    const campaigns = (await pool.query(`SELECT fc.id, fc.title, fc.category, fc.country, fc.image_url, fc.urgency_level, fc.featured, fc.location, t.name as org_name,
      (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, fc.target,
      (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count
      FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id ${where} ${orderBy} LIMIT $${params.length+1}`, [...params, l])).rows;
    res.json(campaigns);
  }));

  console.log('[Fundraising Enhancements] All routes registered successfully');
};
