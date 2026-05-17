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
            // Add to progress timeline
            await pool.query('INSERT INTO campaign_progress_timeline(tenant_id,campaign_id,event_type,title,description,icon,is_highlighted) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [tenant_id, campaign_id, 'milestone', mp+'% Milestone!', 'Campaign reached '+mp+'% of goal', '🎯', mp >= 75]);
            if (mp === 100) {
              await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE id=$1", [campaign_id]);
              await pool.query('INSERT INTO campaign_progress_timeline(tenant_id,campaign_id,event_type,title,description,icon,is_highlighted) VALUES($1,$2,$3,$4,$5,$6,$7)',
                [tenant_id, campaign_id, 'goal_reached', 'Goal Reached!', 'Campaign has reached 100% of its fundraising goal!', '🏆', true]);
            }
            break;
          }
        }
      }
    } catch(e) { console.warn('[Milestone Error]', e.message); }

    // 7. Add to live donation feed (social proof)
    try {
      const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
      const displayName = is_anonymous ? 'A generous supporter' : (donor_name || 'A supporter');
      const showUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Show for 7 days
      await pool.query('INSERT INTO live_donation_feed(tenant_id,campaign_id,donation_id,donor_display_name,amount,message,is_anonymous,show_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [tenant_id, campaign_id, donation_id, displayName, parseInt(amount)||0, message||'', is_anonymous||false, showUntil]);
    } catch(e) { console.warn('[Live Feed Error]', e.message); }

    // 8. Generate donation receipt
    try {
      if (donation_id && donor_email) {
        const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
        const receiptNum = 'RCP-' + new Date().getFullYear() + '-' + String(donation_id).padStart(6, '0');
        await pool.query('INSERT INTO donation_receipts(tenant_id,donation_id,receipt_number,donor_name,donor_email,campaign_title,amount,payment_method,donation_date,receipt_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (receipt_number) DO NOTHING',
          [tenant_id, donation_id, receiptNum, donor_name||'Anonymous', donor_email, campaign?.title||'', parseInt(amount)||0, method||'cash', new Date(), 'standard']);
        await pool.query('UPDATE campaign_donations SET receipt_number=$1 WHERE id=$2', [receiptNum, donation_id]);
      }
    } catch(e) { console.warn('[Receipt Error]', e.message); }

    // 9. Update donor profile
    try {
      if (donor_email) {
        const totalDonated = (await pool.query('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COUNT(DISTINCT campaign_id) as camps FROM campaign_donations WHERE donor_email=$1 AND refunded=false', [donor_email])).rows[0];
        const firstDonation = (await pool.query('SELECT MIN(donated_at) as first FROM campaign_donations WHERE donor_email=$1 AND refunded=false', [donor_email])).rows[0]?.first;
        await pool.query(`INSERT INTO donor_profiles(tenant_id,user_email,full_name,phone,total_donated,donation_count,campaigns_supported,first_donation_at,last_donation_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
          ON CONFLICT (tenant_id, user_email) DO UPDATE SET full_name=COALESCE(NULLIF($3,''),donor_profiles.full_name), total_donated=$5, donation_count=$6, campaigns_supported=$7, last_donation_at=NOW(), updated_at=NOW()`,
          [tenant_id, donor_email, donor_name||'', donor_phone||'', parseInt(totalDonated?.total||0), parseInt(totalDonated?.count||0), parseInt(totalDonated?.camps||0), firstDonation]);
      }
    } catch(e) { console.warn('[Donor Profile Error]', e.message); }

    // 10. Add to progress timeline
    try {
      const donationCount = (await pool.query('SELECT COUNT(*) as count FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [campaign_id])).rows[0]?.count || 0;
      const eventType = donationCount === 1 ? 'first_donation' : (parseInt(amount) >= 1000000 ? 'major_donation' : 'created');
      if (donationCount === 1 || parseInt(amount) >= 1000000) {
        const campaign = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [campaign_id])).rows[0];
        await pool.query('INSERT INTO campaign_progress_timeline(tenant_id,campaign_id,event_type,title,description,icon,is_highlighted) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [tenant_id, campaign_id, eventType,
            donationCount === 1 ? 'First Donation!' : 'Major Donation!',
            donationCount === 1
              ? (is_anonymous ? 'An anonymous supporter' : esc(donor_name||'A supporter'))+' made the first donation of UGX '+(parseInt(amount)||0).toLocaleString()
              : (is_anonymous ? 'A generous supporter' : esc(donor_name||'A supporter'))+' donated UGX '+(parseInt(amount)||0).toLocaleString(),
            donationCount === 1 ? '🎉' : '💎',
            parseInt(amount) >= 5000000
          ]);
      }
    } catch(e) { console.warn('[Timeline Error]', e.message); }
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
    )`,

    // Donor profiles - comprehensive donor management
    `CREATE TABLE IF NOT EXISTS donor_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT,
      full_name TEXT NOT NULL,
      phone TEXT,
      country TEXT DEFAULT 'Uganda',
      city TEXT,
      preferred_currency TEXT DEFAULT 'UGX',
      total_donated INTEGER DEFAULT 0,
      donation_count INTEGER DEFAULT 0,
      campaigns_supported INTEGER DEFAULT 0,
      first_donation_at TIMESTAMPTZ,
      last_donation_at TIMESTAMPTZ,
      is_recurring_donor BOOLEAN DEFAULT false,
      communication_prefs JSONB DEFAULT '{"email":true,"sms":false,"whatsapp":false}',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_email)
    )`,

    // Donation receipts - official receipts for donors
    `CREATE TABLE IF NOT EXISTS donation_receipts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id) ON DELETE CASCADE,
      receipt_number TEXT UNIQUE NOT NULL,
      donor_name TEXT,
      donor_email TEXT,
      campaign_title TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'UGX',
      payment_method TEXT,
      donation_date TIMESTAMPTZ,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      receipt_type TEXT DEFAULT 'standard' CHECK (receipt_type IN ('standard','tax_deductible','corporate','international')),
      is_email_sent BOOLEAN DEFAULT false,
      pdf_generated BOOLEAN DEFAULT false
    )`,

    // Campaign deadline reminders
    `CREATE TABLE IF NOT EXISTS campaign_deadline_reminders (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      reminder_type TEXT DEFAULT '7_days' CHECK (reminder_type IN ('7_days','3_days','1_day','deadline_day','overdue')),
      reminder_sent BOOLEAN DEFAULT false,
      sent_at TIMESTAMPTZ,
      recipients_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign goal breakdown - how funds will be used
    `CREATE TABLE IF NOT EXISTS campaign_goal_breakdown (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      description TEXT,
      amount INTEGER NOT NULL,
      percentage NUMERIC(5,2) DEFAULT 0,
      category TEXT DEFAULT 'general',
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Live donation feed - social proof
    `CREATE TABLE IF NOT EXISTS live_donation_feed (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id),
      donor_display_name TEXT,
      amount INTEGER,
      message TEXT,
      is_anonymous BOOLEAN DEFAULT false,
      is_featured BOOLEAN DEFAULT false,
      show_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign progress timeline - key events
    `CREATE TABLE IF NOT EXISTS campaign_progress_timeline (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('created','first_donation','milestone','major_donation','update_added','media_added','matching_added','deadline_extended','goal_reached','completed','payout')),
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      is_highlighted BOOLEAN DEFAULT false,
      event_date TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign email marketing - send emails to donors/followers
    `CREATE TABLE IF NOT EXISTS campaign_email_campaigns (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      sender_name TEXT,
      target_audience TEXT DEFAULT 'all_donors' CHECK (target_audience IN ('all_donors','recent_donors','followers','investors','all')),
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      recipients_count INTEGER DEFAULT 0,
      opens INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Multi-currency exchange rates
    `CREATE TABLE IF NOT EXISTS exchange_rates (
      id SERIAL PRIMARY KEY,
      from_currency TEXT NOT NULL DEFAULT 'UGX',
      to_currency TEXT NOT NULL DEFAULT 'USD',
      rate NUMERIC(12,6) NOT NULL,
      source TEXT DEFAULT 'manual',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(from_currency, to_currency)
    )`,

    // Campaign trust scores
    `CREATE TABLE IF NOT EXISTS campaign_trust_reviews (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      reviewer_email TEXT,
      reviewer_name TEXT,
      transparency_score INTEGER DEFAULT 5 CHECK (transparency_score BETWEEN 1 AND 5),
      communication_score INTEGER DEFAULT 5 CHECK (communication_score BETWEEN 1 AND 5),
      impact_score INTEGER DEFAULT 5 CHECK (impact_score BETWEEN 1 AND 5),
      overall_score NUMERIC(3,2) DEFAULT 5.00,
      review_text TEXT,
      is_verified BOOLEAN DEFAULT false,
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
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS goal_breakdown JSONB DEFAULT '[]'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS trust_score NUMERIC(3,2) DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS trust_review_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS deadline_reminder_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS deadline_3day_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS deadline_1day_sent BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS gallery_images TEXT[] DEFAULT '{}'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS video_urls TEXT[] DEFAULT '{}'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS estimated_beneficiaries INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS organization_description TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS original_amount INTEGER`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS original_currency TEXT`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(12,6)`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS receipt_number TEXT`,
    // Seed default exchange rates
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'USD', 0.000270, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'KES', 0.035, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'TZS', 0.63, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'EUR', 0.000248, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'GBP', 0.000214, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('USD', 'UGX', 3700, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
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
    `CREATE INDEX IF NOT EXISTS idx_donor_profiles_tenant ON donor_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_profiles_email ON donor_profiles(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_receipts_tenant ON donation_receipts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_receipts_donation ON donation_receipts(donation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_receipts_number ON donation_receipts(receipt_number)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_deadline_reminders_campaign ON campaign_deadline_reminders(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_goal_breakdown_campaign ON campaign_goal_breakdown(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_live_donation_feed_campaign ON live_donation_feed(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_progress_timeline_campaign ON campaign_progress_timeline(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_email_campaigns_campaign ON campaign_email_campaigns(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_trust_reviews_campaign ON campaign_trust_reviews(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(from_currency, to_currency)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_donations_receipt ON campaign_donations(receipt_number)`,
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

  // =============================================
  // FEATURE 11: MULTI-CURRENCY SUPPORT
  // =============================================

  // Get exchange rates
  app.get('/api/exchange-rates', ah(async (req, res) => {
    const rates = (await pool.query('SELECT * FROM exchange_rates ORDER BY from_currency, to_currency')).rows;
    res.json(rates);
  }));

  // Convert currency
  app.get('/api/convert-currency', ah(async (req, res) => {
    const { amount, from, to } = req.query;
    if (!amount || !from || !to) return res.status(400).json({ error: 'Missing parameters: amount, from, to' });
    const rate = (await pool.query('SELECT rate FROM exchange_rates WHERE from_currency=$1 AND to_currency=$2', [from, to])).rows[0];
    if (!rate) return res.status(404).json({ error: 'Exchange rate not found' });
    const converted = Math.round(parseFloat(amount) * parseFloat(rate.rate));
    res.json({ original: parseInt(amount), from_currency: from, to_currency: to, rate: parseFloat(rate.rate), converted });
  }));

  // Update exchange rate (admin)
  app.post('/api/exchange-rates/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { from_currency, to_currency, rate } = req.body;
    if (!from_currency || !to_currency || !rate) return res.status(400).json({ error: 'Missing parameters' });
    await pool.query('INSERT INTO exchange_rates(from_currency,to_currency,rate,source,updated_at) VALUES($1,$2,$3,$4,NOW()) ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, source=EXCLUDED.source, updated_at=NOW()',
      [from_currency, to_currency, rate, 'admin']);
    res.json({ success: true });
  }));

  // Donate in foreign currency (auto-converts to UGX)
  app.post('/api/campaigns/:id/donate-international', ah(async (req, res) => {
    const { donor_name, donor_email, donor_phone, amount, currency, method, message, donate_anonymously } = req.body;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Campaign not found' });

    let amountUGX = parseInt(amount) || 0;
    let exchangeRate = 1;
    const originalCurrency = currency || 'UGX';
    const originalAmount = parseInt(amount) || 0;

    if (originalCurrency !== 'UGX') {
      const rate = (await pool.query('SELECT rate FROM exchange_rates WHERE from_currency=$1 AND to_currency=$2', [originalCurrency, 'UGX'])).rows[0];
      if (rate) {
        exchangeRate = parseFloat(rate.rate);
        amountUGX = Math.round(originalAmount * exchangeRate);
      }
    }

    const displayName = donate_anonymously ? 'Anonymous' : (donor_name || 'Anonymous');
    const donationResult = await pool.query(
      'INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,donor_email,donor_phone,amount,method,message,is_anonymous,currency,original_amount,original_currency,exchange_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
      [c.tenant_id, c.id, displayName, donor_email||null, donor_phone||null, amountUGX, method||'international', message||'', donate_anonymously||false, 'UGX', originalAmount, originalCurrency, exchangeRate]
    );
    const donationId = donationResult.rows[0]?.id;

    // Platform fee
    const fee = Math.round(amountUGX * 0.05);
    if (fee > 0) {
      try {
        await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [fee]);
        await pool.query('INSERT INTO developer_revenue(amount,source) VALUES($1,$2)', [fee, 'International donation fee - Campaign #'+c.id]);
      } catch(e) {}
    }

    // Trigger post-donation effects
    try {
      await processDonationEffects({ tenant_id: c.tenant_id, campaign_id: c.id, donation_id: donationId, donor_name: displayName, donor_email: donor_email, donor_phone: donor_phone, amount: amountUGX, method, message, is_anonymous: donate_anonymously });
    } catch(e) {}

    res.json({ success: true, donation_id: donationId, amount_ugx: amountUGX, original_amount: originalAmount, original_currency: originalCurrency, exchange_rate: exchangeRate });
  }));

  // =============================================
  // FEATURE 12: DONATION RECEIPTS
  // =============================================

  // View/download receipt
  app.get('/donations/:id/receipt', ah(async (req, res) => {
    const donation = (await pool.query('SELECT d.*, fc.title as campaign_title, t.name as org_name FROM campaign_donations d JOIN fundraising_campaigns fc ON d.campaign_id=fc.id JOIN tenants t ON fc.tenant_id=t.id WHERE d.id=$1', [req.params.id])).rows[0];
    if (!donation) return res.status(404).send('Donation not found');

    // Get or create receipt
    let receipt = (await pool.query('SELECT * FROM donation_receipts WHERE donation_id=$1', [donation.id])).rows[0];
    if (!receipt) {
      const receiptNum = 'RCP-' + new Date().getFullYear() + '-' + String(donation.id).padStart(6, '0');
      await pool.query('INSERT INTO donation_receipts(tenant_id,donation_id,receipt_number,donor_name,donor_email,campaign_title,amount,payment_method,donation_date,receipt_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (receipt_number) DO NOTHING',
        [donation.tenant_id, donation.id, receiptNum, donation.donor_name, donation.donor_email, donation.campaign_title, donation.amount, donation.method, donation.donated_at, 'standard']);
      receipt = (await pool.query('SELECT * FROM donation_receipts WHERE donation_id=$1', [donation.id])).rows[0];
      await pool.query('UPDATE campaign_donations SET receipt_number=$1 WHERE id=$2', [receiptNum, donation.id]);
    }

    res.send(renderPage('Donation Receipt', `
      <div class="card" style="max-width:700px;margin:40px auto;border:2px solid #059669">
        <div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white">
          <h1 style="margin:0;font-size:28px">OFFICIAL DONATION RECEIPT</h1>
          <p style="margin:8px 0 0;opacity:0.9">Comfort Zone Fundraising Platform</p>
        </div>
        <div style="padding:30px">
          <div style="display:flex;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><strong>Receipt Number:</strong> ${esc(receipt?.receipt_number||'N/A')}</div>
            <div><strong>Date:</strong> ${receipt?.issued_at ? new Date(receipt.issued_at).toLocaleDateString() : new Date().toLocaleDateString()}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
            <div style="background:#f8fafc;padding:16px;border-radius:10px">
              <h4 style="margin:0 0 8px;color:#64748b;font-size:13px">DONOR INFORMATION</h4>
              <p style="margin:0;font-weight:700">${esc(donation.donor_name||'Anonymous')}</p>
              ${donation.donor_email ? '<p style="margin:4px 0;color:#64748b;font-size:13px">'+esc(donation.donor_email)+'</p>' : ''}
            </div>
            <div style="background:#f8fafc;padding:16px;border-radius:10px">
              <h4 style="margin:0 0 8px;color:#64748b;font-size:13px">ORGANIZATION</h4>
              <p style="margin:0;font-weight:700">${esc(donation.org_name||'')}</p>
              <p style="margin:4px 0;color:#64748b;font-size:13px">${esc(donation.campaign_title||'')}</p>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr style="background:#059669;color:white"><th style="padding:12px;text-align:left">Description</th><th style="padding:12px;text-align:right">Amount</th></tr>
            <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px">Donation to: ${esc(donation.campaign_title||'')}</td><td style="padding:12px;text-align:right;font-weight:700;color:#059669">UGX ${(parseInt(donation.amount)||0).toLocaleString()}</td></tr>
            ${donation.matching_contribution > 0 ? '<tr style="border-bottom:1px solid #e2e8f0;background:#fef3c7"><td style="padding:12px">Matching Contribution</td><td style="padding:12px;text-align:right;font-weight:700;color:#f59e0b">UGX '+parseInt(donation.matching_contribution).toLocaleString()+'</td></tr>' : ''}
            <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px">Payment Method</td><td style="padding:12px;text-align:right">${esc(donation.method||'N/A')}</td></tr>
            <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px">Date of Donation</td><td style="padding:12px;text-align:right">${donation.donated_at ? new Date(donation.donated_at).toLocaleDateString() : 'N/A'}</td></tr>
          </table>
          ${donation.original_currency && donation.original_currency !== 'UGX' ? '<div style="background:#f8fafc;padding:12px;border-radius:8px;margin:10px 0;font-size:13px;color:#64748b"><strong>International Donation:</strong> Original amount: '+(parseInt(donation.original_amount)||0).toLocaleString()+' '+esc(donation.original_currency)+' (Rate: 1 '+esc(donation.original_currency)+' = '+parseFloat(donation.exchange_rate||1).toLocaleString()+' UGX)</div>' : ''}
          <div style="text-align:center;margin-top:20px;padding-top:20px;border-top:2px solid #e2e8f0">
            <p style="color:#64748b;font-size:12px">This receipt is issued by Comfort Zone Fundraising Platform for your records.</p>
            <p style="color:#64748b;font-size:12px">For questions, contact support@comfortzone.co.ug</p>
          </div>
        </div>
        <div style="padding:16px;text-align:center;border-top:1px solid #e2e8f0">
          <button onclick="window.print()" style="padding:10px 24px;background:#059669;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer">Print Receipt</button>
          <a href="/my-donations" style="display:inline-block;padding:10px 24px;margin-left:8px;background:#4f46e5;color:white;border-radius:8px;text-decoration:none;font-weight:700">My Donations</a>
        </div>
      </div>
    `, req.session.user || null));
  }));

  // =============================================
  // FEATURE 13: CAMPAIGN GOAL BREAKDOWN
  // =============================================

  // View campaign goal breakdown
  app.get('/campaigns/:id/breakdown', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const items = (await pool.query('SELECT * FROM campaign_goal_breakdown WHERE campaign_id=$1 ORDER BY sort_order, id', [req.params.id])).rows;
    const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [req.params.id])).rows[0]?.total || 0;

    res.send(renderPage('How Funds Will Be Used: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)"><h1>How Funds Will Be Used</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>
      <div style="max-width:700px;margin:0 auto">
        <div class="card" style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div><h3 style="margin:0">Fund Allocation</h3><p class="muted" style="margin:4px 0 0">Transparency in how your donations are used</p></div>
            <div style="text-align:right"><div style="font-size:20px;font-weight:800;color:#059669">UGX ${parseInt(raised).toLocaleString()}</div><div style="font-size:13px;color:#64748b">raised of UGX ${(parseInt(c.target)||0).toLocaleString()}</div></div>
          </div>
          ${items.length > 0 ? items.map(item => {
            const pct = c.target > 0 ? Math.round(parseInt(item.amount)/parseInt(c.target)*100) : 0;
            return '<div style="margin-bottom:16px;padding:16px;background:#f8fafc;border-radius:12px;border-left:4px solid #4f46e5">'+
              '<div style="display:flex;justify-content:space-between;align-items:start">'+
              '<div><h4 style="margin:0 0 4px">'+(item.icon||'📦')+' '+esc(item.item_name)+'</h4>'+(item.description?'<p class="muted" style="margin:0;font-size:13px">'+esc(item.description)+'</p>':'')+'</div>'+
              '<div style="text-align:right"><div style="font-weight:800;color:#4f46e5">UGX '+(parseInt(item.amount)||0).toLocaleString()+'</div><div style="font-size:12px;color:#64748b">'+pct+'% of goal</div></div>'+
              '</div>'+
              '<div style="background:#e2e8f0;height:6px;border-radius:3px;margin-top:10px;overflow:hidden"><div style="background:#4f46e5;height:6px;border-radius:3px;width:'+pct+'%"></div></div>'+
            '</div>';
          }).join('') : '<div style="text-align:center;padding:40px"><p class="muted">No fund breakdown specified yet. The campaign organizer can add this to show donors exactly how their contributions will be used.</p></div>'}
        </div>
        ${req.session.user && req.session.user.tenant_id === c.tenant_id ? '<div class="card"><h3>Add Fund Item</h3><form method="POST" action="/campaigns/'+c.id+'/breakdown/save"><div style="display:grid;grid-template-columns:2fr 1fr;gap:12px"><input name="item_name" placeholder="Item Name (e.g. Building Materials)" required><input name="amount" type="number" placeholder="Amount (UGX)" required></div><textarea name="description" rows="2" placeholder="Description (optional)" style="width:100%;margin-top:10px"></textarea><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px"><input name="icon" placeholder="Icon emoji (e.g. 📦)"><input name="category" placeholder="Category (e.g. construction)"></div><button class="btn btn-green" style="width:100%;margin-top:16px">Add Item</button></form></div>' : ''}
        <div style="text-align:center;margin-top:20px"><a href="/discover/${c.id}" class="btn">Back to Campaign</a> <a href="/discover/${c.id}/donate" class="btn btn-green">Donate Now</a></div>
      </div>
    `, req.session.user || null));
  }));

  app.post('/campaigns/:id/breakdown/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { item_name, description, amount, icon, category } = req.body;
    const c = (await pool.query('SELECT id, target FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const pct = c.target > 0 ? Math.round(parseInt(amount||0)/parseInt(c.target)*100) : 0;
    await pool.query('INSERT INTO campaign_goal_breakdown(tenant_id,campaign_id,item_name,description,amount,percentage,icon,category) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, req.params.id, item_name, description||'', amount||0, pct, icon||'', category||'general']);
    res.redirect('/campaigns/'+req.params.id+'/breakdown');
  }));

  // =============================================
  // FEATURE 14: SOCIAL PROOF / LIVE DONATION FEED
  // =============================================

  // API: Get recent donations across platform (for social proof widget)
  app.get('/api/live-donations', ah(async (req, res) => {
    const { limit, campaign_id } = req.query;
    const l = Math.min(parseInt(limit)||10, 30);
    let query = `SELECT lf.*, fc.title as campaign_title, t.name as org_name FROM live_donation_feed lf JOIN fundraising_campaigns fc ON lf.campaign_id=fc.id JOIN tenants t ON fc.tenant_id=t.id WHERE lf.show_until > NOW()`;
    const params = [];
    if (campaign_id) { params.push(campaign_id); query += ` AND lf.campaign_id=$${params.length}`; }
    params.push(l);
    query += ` ORDER BY lf.created_at DESC LIMIT $${params.length}`;
    const donations = (await pool.query(query, params)).rows;
    res.json(donations.map(d => ({
      id: d.id,
      donor: d.is_anonymous ? 'A generous supporter' : esc(d.donor_display_name),
      amount: parseInt(d.amount||0),
      campaign: d.campaign_title,
      org: d.org_name,
      message: d.message,
      time_ago: getTimeAgo(d.created_at),
      campaign_id: d.campaign_id
    })));
  }));

  // Helper: Format time ago
  function getTimeAgo(date) {
    if (!date) return 'just now';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  // =============================================
  // FEATURE 15: CAMPAIGN TRUST SCORE & REVIEWS
  // =============================================

  app.get('/campaigns/:id/trust', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const [reviews, avgScore] = await Promise.all([
      pool.query('SELECT * FROM campaign_trust_reviews WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id]),
      pool.query('SELECT AVG(overall_score) as avg, COUNT(*) as count FROM campaign_trust_reviews WHERE campaign_id=$1', [req.params.id])
    ]);
    const score = parseFloat(avgScore.rows[0]?.avg || c.trust_score || 0).toFixed(1);
    const count = parseInt(avgScore.rows[0]?.count || c.trust_review_count || 0);

    res.send(renderPage('Trust Score: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#0891b2,#06b6d4)"><h1>Campaign Trust Score</h1><p>${esc(c.title)} by ${esc(c.org_name||'')}</p></div>
      <div style="max-width:700px;margin:0 auto">
        <div class="card" style="text-align:center;padding:30px">
          <div style="font-size:64px;font-weight:900;color:${score>=4?'#059669':score>=3?'#f59e0b':'#ef4444'}">${score}</div>
          <div style="font-size:18px;color:#64748b;margin-bottom:8px">${count} review${count!==1?'s':''}</div>
          <div style="color:#f59e0b;font-size:24px">${score>=4.5?'★★★★★':score>=3.5?'★★★★☆':score>=2.5?'★★★☆☆':'★★☆☆☆'}</div>
          <div style="display:flex;gap:20px;justify-content:center;margin-top:16px;font-size:14px;color:#64748b">
            <span>Transparency: ${score}/5</span>
            <span>Communication: ${score}/5</span>
            <span>Impact: ${score}/5</span>
          </div>
        </div>
        ${reviews.rows.length > 0 ? '<div class="card" style="margin-top:20px"><h3>Reviews</h3>'+reviews.rows.map(r=>'<div style="padding:16px;border-bottom:1px solid #f1f5f9"><div style="display:flex;justify-content:space-between"><strong>'+esc(r.reviewer_name||'Anonymous')+'</strong><span style="color:#f59e0b">'+'★'.repeat(Math.round(r.overall_score))+'</span></div>'+(r.review_text?'<p style="margin:8px 0;color:#475569">'+esc(r.review_text)+'</p>':'')+'<span class="muted" style="font-size:12px">'+(r.created_at?new Date(r.created_at).toLocaleDateString():'')+'</span></div>').join('')+'</div>' : ''}
        ${req.session.user ? '<div class="card" style="margin-top:20px"><h3>Write a Review</h3><form method="POST" action="/campaigns/'+c.id+'/trust/save"><input name="reviewer_name" value="'+esc(req.session.user.name||'')+'" placeholder="Your Name" required><textarea name="review_text" rows="3" placeholder="Share your experience with this campaign..." style="width:100%;margin:10px 0"></textarea><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:10px 0"><div><label style="font-weight:600;font-size:13px">Transparency</label><select name="transparency_score" style="width:100%"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3" selected>3 - Average</option><option value="2">2 - Below Average</option><option value="1">1 - Poor</option></select></div><div><label style="font-weight:600;font-size:13px">Communication</label><select name="communication_score" style="width:100%"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3" selected>3 - Average</option><option value="2">2 - Below Average</option><option value="1">1 - Poor</option></select></div><div><label style="font-weight:600;font-size:13px">Impact</label><select name="impact_score" style="width:100%"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3" selected>3 - Average</option><option value="2">2 - Below Average</option><option value="1">1 - Poor</option></select></div></div><button class="btn btn-green" style="width:100%">Submit Review</button></form></div>' : ''}
      </div>
    `, req.session.user || null));
  }));

  app.post('/campaigns/:id/trust/save', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { reviewer_name, review_text, transparency_score, communication_score, impact_score } = req.body;
    const overall = ((parseInt(transparency_score||5) + parseInt(communication_score||5) + parseInt(impact_score||5)) / 3).toFixed(2);
    await pool.query('INSERT INTO campaign_trust_reviews(tenant_id,campaign_id,reviewer_email,reviewer_name,transparency_score,communication_score,impact_score,overall_score,review_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, req.params.id, req.session.user.email, reviewer_name||req.session.user.name, transparency_score||5, communication_score||5, impact_score||5, overall, review_text||'']);
    // Update campaign average
    const avg = (await pool.query('SELECT AVG(overall_score) as avg, COUNT(*) as count FROM campaign_trust_reviews WHERE campaign_id=$1', [req.params.id])).rows[0];
    await pool.query('UPDATE fundraising_campaigns SET trust_score=$1, trust_review_count=$2 WHERE id=$3', [parseFloat(avg.avg||0).toFixed(2), parseInt(avg.count||0), req.params.id]);
    res.redirect('/campaigns/'+req.params.id+'/trust');
  }));

  // =============================================
  // FEATURE 16: CAMPAIGN PROGRESS TIMELINE
  // =============================================

  app.get('/campaigns/:id/timeline', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const events = (await pool.query('SELECT * FROM campaign_progress_timeline WHERE campaign_id=$1 ORDER BY event_date DESC, created_at DESC LIMIT 50', [req.params.id])).rows;
    const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [req.params.id])).rows[0]?.total || 0;

    res.send(renderPage('Timeline: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)"><h1>Campaign Timeline</h1><p>Follow the journey of ${esc(c.title)}</p></div>
      <div style="max-width:700px;margin:0 auto">
        <div style="background:#f8fafc;border-radius:16px;padding:20px;margin-bottom:20px;display:flex;gap:20px;justify-content:center;flex-wrap:wrap;text-align:center">
          <div><div style="font-size:24px;font-weight:800;color:#059669">UGX ${parseInt(raised).toLocaleString()}</div><div style="font-size:13px;color:#64748b">Raised</div></div>
          <div><div style="font-size:24px;font-weight:800;color:#4f46e5">${events.length}</div><div style="font-size:13px;color:#64748b">Events</div></div>
          <div><div style="font-size:24px;font-weight:800;color:#f59e0b">${c.target>0?Math.round(parseInt(raised)/parseInt(c.target)*100):0}%</div><div style="font-size:13px;color:#64748b">Funded</div></div>
        </div>
        ${events.length > 0 ? '<div style="position:relative;padding-left:40px">'+events.map((e,i) => {
          const iconMap = {created:'🚀',first_donation:'🎉',milestone:'🎯',major_donation:'💎',update_added:'📝',media_added:'📸',matching_added:'🔄',deadline_extended:'⏰',goal_reached:'🏆',completed:'✅',payout:'💰'};
          return '<div style="position:relative;padding-bottom:24px;'+(i<events.length-1?'border-left:3px solid #e2e8f0;':'')+'">'+
            '<div style="position:absolute;left:-40px;top:0;width:30px;height:30px;background:'+(e.is_highlighted?'#059669':'white')+';border:2px solid '+(e.is_highlighted?'#059669':'#e2e8f0')+';border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px">'+(iconMap[e.event_type]||'📌')+'</div>'+
            '<div style="background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);'+(e.is_highlighted?'border:2px solid #059669':'')+'">'+
            '<div style="display:flex;justify-content:space-between;align-items:start"><h4 style="margin:0">'+esc(e.title)+'</h4><span class="muted" style="font-size:12px">'+(e.event_date?new Date(e.event_date).toLocaleDateString():'')+'</span></div>'+
            (e.description?'<p style="margin:6px 0 0;color:#475569;font-size:14px">'+esc(e.description)+'</p>':'')+
            '</div></div>';
        }).join('')+'</div>' : '<div class="card" style="text-align:center;padding:40px"><p class="muted">Timeline events will appear as the campaign progresses.</p></div>'}
        <div style="text-align:center;margin-top:20px"><a href="/discover/${c.id}" class="btn">Back to Campaign</a></div>
      </div>
    `, req.session.user || null));
  }));

  // =============================================
  // FEATURE 17: CAMPAIGN EMAIL MARKETING
  // =============================================

  app.get('/campaigns/:id/emails', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const emails = (await pool.query('SELECT * FROM campaign_email_campaigns WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id])).rows;
    const [donorCount, followerCount] = await Promise.all([
      pool.query('SELECT COUNT(DISTINCT donor_email) as count FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL', [req.params.id]),
      pool.query('SELECT COUNT(*) as count FROM campaign_followers WHERE campaign_id=$1', [req.params.id])
    ]);

    res.send(renderPage('Email Campaign: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#ec4899)"><h1>Campaign Email Marketing</h1><p>Reach your donors and followers</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${parseInt(donorCount.rows[0]?.count||0)}</div><div>Donors with Email</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${parseInt(followerCount.rows[0]?.count||0)}</div><div>Followers</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${emails.filter(e=>e.status==='sent').length}</div><div>Emails Sent</div></div>
      </div>
      <a href="/campaigns/${c.id}/emails/new" class="btn btn-green" style="margin-bottom:20px">+ Compose Email</a>
      <div class="card">
        <h3>Email History (${emails.length})</h3>
        ${emails.length > 0 ? '<table><tr><th>Subject</th><th>Audience</th><th>Status</th><th>Recipients</th><th>Opens</th><th>Date</th></tr>'+
          emails.map(e=>'<tr><td><strong>'+esc(e.subject)+'</strong></td><td><span class="tag">'+esc(e.target_audience)+'</span></td><td><span class="tag" style="background:'+(e.status==='sent'?'#d1fae5;color:#065f46':e.status==='draft'?'#fef3c7;color:#92400e':'#fee2e2;color:#991b1b')+'">'+esc(e.status)+'</span></td><td>'+e.recipients_count+'</td><td>'+e.opens+'</td><td>'+(e.sent_at?new Date(e.sent_at).toLocaleDateString():'-')+'</td></tr>').join('')+'</table>' : '<p class="muted" style="text-align:center;padding:20px">No emails sent yet</p>'}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/emails/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');
    res.send(renderPage('Compose Email', `
      <div class="card" style="max-width:700px;margin:40px auto">
        <h2>Compose Campaign Email</h2>
        <p class="muted" style="margin-bottom:20px">Send an email update to your donors and followers for "${esc(c.title)}"</p>
        <form method="POST" action="/campaigns/${c.id}/emails/save">
          <input name="subject" placeholder="Email Subject Line" required style="width:100%">
          <input name="sender_name" placeholder="Sender Name (e.g. Campaign Team)" value="${esc(c.organizer||req.session.user.name||'')}" style="width:100%;margin-top:10px">
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Target Audience</label>
          <select name="target_audience" style="width:100%">
            <option value="all_donors">All Donors with Email</option>
            <option value="recent_donors">Recent Donors (last 30 days)</option>
            <option value="followers">Campaign Followers</option>
            <option value="investors">Investors</option>
            <option value="all">All (Donors + Followers + Investors)</option>
          </select>
          <label style="font-weight:600;display:block;margin-bottom:6px;margin-top:16px">Email Body *</label>
          <textarea name="body" rows="8" placeholder="Write your email content here. Share campaign updates, express gratitude, and encourage more support..." required style="width:100%"></textarea>
          <div style="margin-top:16px;display:flex;gap:12px">
            <button type="submit" name="action" value="draft" class="btn" style="flex:1">Save as Draft</button>
            <button type="submit" name="action" value="send" class="btn btn-green" style="flex:2">Send Now</button>
          </div>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/emails/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { subject, sender_name, target_audience, body, action } = req.body;
    const status = action === 'send' ? 'sent' : 'draft';

    if (status === 'sent') {
      // Collect recipient emails
      let recipients = [];
      if (target_audience === 'all_donors' || target_audience === 'all') {
        const donors = (await pool.query('SELECT DISTINCT donor_email, donor_name FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL AND donor_email != \'\'', [req.params.id])).rows;
        recipients.push(...donors.map(d => ({ email: d.donor_email, name: d.donor_name })));
      }
      if (target_audience === 'followers' || target_audience === 'all') {
        const followers = (await pool.query('SELECT cf.user_email FROM campaign_followers cf JOIN users u ON cf.user_email=u.email WHERE cf.campaign_id=$1', [req.params.id])).rows;
        for (const f of followers) {
          if (!recipients.find(r => r.email === f.user_email)) {
            recipients.push({ email: f.user_email, name: '' });
          }
        }
      }
      if (target_audience === 'recent_donors') {
        const recent = (await pool.query('SELECT DISTINCT donor_email, donor_name FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL AND donated_at > NOW() - INTERVAL \'30 days\'', [req.params.id])).rows;
        recipients = recent.map(d => ({ email: d.donor_email, name: d.donor_name }));
      }
      if (target_audience === 'investors') {
        const investors = (await pool.query('SELECT DISTINCT io.investor_email FROM investor_offers io WHERE io.campaign_id=$1', [req.params.id])).rows;
        recipients = investors.map(i => ({ email: i.investor_email, name: '' }));
      }

      // Send emails
      let sentCount = 0;
      for (const r of recipients) {
        try {
          await sendEmail(r.email, subject, `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:linear-gradient(135deg,#059669,#10b981);padding:20px;border-radius:12px 12px 0 0;color:white"><h2>${esc(subject)}</h2><p style="margin:0;opacity:0.9">${esc(sender_name||'Campaign Team')}</p></div><div style="padding:24px;background:white;border:1px solid #e2e8f0;border-top:none"><p style="color:#475569;line-height:1.8">${esc(body).replace(/\n/g,'<br>')}</p><a href="${BASE_URL}/discover/${req.params.id}" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">View Campaign</a></div><div style="text-align:center;padding:12px;color:#94a3b8;font-size:12px">Comfort Zone Fundraising</div></div>`);
          sentCount++;
        } catch(e) {}
      }

      await pool.query('INSERT INTO campaign_email_campaigns(tenant_id,campaign_id,subject,body,sender_name,target_audience,status,sent_at,recipients_count,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9)',
        [t, req.params.id, subject, body, sender_name||'', target_audience||'all_donors', 'sent', sentCount, req.session.user.email]);
    } else {
      await pool.query('INSERT INTO campaign_email_campaigns(tenant_id,campaign_id,subject,body,sender_name,target_audience,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [t, req.params.id, subject, body, sender_name||'', target_audience||'all_donors', 'draft', req.session.user.email]);
    }

    res.redirect('/campaigns/'+req.params.id+'/emails');
  }));

  // =============================================
  // FEATURE 18: PEER-TO-PEER FUNDRAISING
  // =============================================

  app.get('/campaigns/:id/peer', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    const peers = (await pool.query('SELECT * FROM peer_fundraisers WHERE campaign_id=$1 ORDER BY raised DESC, created_at DESC', [req.params.id])).rows;
    const totalPeerRaised = peers.reduce((a,p) => a + parseInt(p.raised||0), 0);

    res.send(renderPage('Peer Fundraising: '+c.title, `
      <div class="hero" style="background:linear-gradient(135deg,#ec4899,#f43f5e)"><h1>Peer-to-Peer Fundraising</h1><p>Create your own fundraising page for this campaign</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">${peers.length}</div><div>Peer Fundraisers</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">UGX ${totalPeerRaised.toLocaleString()}</div><div>Raised by Peers</div></div>
      </div>
      ${req.session.user ? '<a href="/campaigns/'+c.id+'/peer/new" class="btn btn-green" style="margin-bottom:20px">+ Create Your Fundraising Page</a>' : ''}
      <div class="card">
        ${peers.length > 0 ? '<div class="grid">'+peers.map(p => {
          const pct = p.goal > 0 ? Math.round(parseInt(p.raised||0)/parseInt(p.goal)*100) : 0;
          return '<div class="card" style="padding:20px;border-top:4px solid #ec4899"><h4 style="margin:0 0 4px">'+esc(p.name)+'</h4>'+(p.message?'<p class="muted" style="font-size:13px;margin:0 0 12px">'+esc(p.message)+'</p>':'')+'<div class="progress-bar" style="height:10px;margin:8px 0"><div class="progress-fill" style="width:'+pct+'%;background:#ec4899">'+pct+'%</div></div><div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#059669;font-weight:700">UGX '+(parseInt(p.raised)||0).toLocaleString()+'</span><span class="muted">of UGX '+(parseInt(p.goal)||0).toLocaleString()+'</span></div></div>';
        }).join('')+'</div>' : '<div style="text-align:center;padding:40px"><p class="muted">No peer fundraisers yet. Be the first to create your own fundraising page!</p>'+(req.session_user?'<a href="/campaigns/'+c.id+'/peer/new" class="btn btn-green" style="margin-top:16px">Start Fundraising</a>':'')+'</div>'}
      </div>
    `, req.session.user || null));
  }));

  app.get('/campaigns/:id/peer/new', requireAuth, ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    res.send(renderPage('Create Peer Fundraiser', `
      <div class="card" style="max-width:600px;margin:40px auto">
        <h2>Create Your Fundraising Page</h2>
        <p class="muted" style="margin-bottom:20px">Help "${esc(c.title)}" by creating your own peer fundraising page and sharing it with your network.</p>
        <form method="POST" action="/campaigns/${c.id}/peer/save">
          <input name="name" placeholder="Your Name (or Team Name)" required style="width:100%">
          <input name="email" type="email" placeholder="Your Email" value="${esc(req.session.user.email||'')}" style="width:100%;margin-top:10px">
          <input name="phone" placeholder="Your Phone" style="width:100%;margin-top:10px">
          <input name="goal" type="number" placeholder="Your Personal Goal (UGX)" style="width:100%;margin-top:10px">
          <textarea name="message" rows="3" placeholder="Why are you fundraising for this campaign? Tell your story..." style="width:100%;margin-top:10px"></textarea>
          <button class="btn btn-green" style="width:100%;margin-top:20px;padding:14px;font-size:16px">Create Fundraising Page</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/peer/save', requireAuth, ah(async (req, res) => {
    const { name, email, phone, goal, message } = req.body;
    const c = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Not found');
    await pool.query('INSERT INTO peer_fundraisers(tenant_id,campaign_id,name,email,phone,goal,message) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [c.tenant_id, req.params.id, name, email||'', phone||'', goal||0, message||'']);
    res.redirect('/campaigns/'+req.params.id+'/peer');
  }));

  // =============================================
  // FEATURE 19: CAMPAIGN DEADLINE REMINDERS
  // =============================================

  // Process deadline reminders (cron job endpoint)
  app.post('/api/campaign-deadline-reminders', requireAuth, ah(async (req, res) => {
    const role = req.session.user?.role || 'staff';
    if (role !== 'super_admin' && role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    let sent7 = 0, sent3 = 0, sent1 = 0, sentOverdue = 0;
    const today = new Date().toISOString().split('T')[0];

    // 7-day reminder
    const sevenDays = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
    const campaigns7 = (await pool.query(`SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.deadline=$1 AND fc.status='active' AND fc.deadline_reminder_sent=false`, [sevenDays])).rows;
    for (const c of campaigns7) {
      try {
        const followers = (await pool.query('SELECT user_email FROM campaign_followers WHERE campaign_id=$1', [c.id])).rows;
        const donors = (await pool.query('SELECT DISTINCT donor_email FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL', [c.id])).rows;
        const emails = [...new Set([...followers.map(f=>f.user_email), ...donors.map(d=>d.donor_email)])];
        for (const email of emails) {
          await sendEmail(email, 'One Week Left: '+c.title, `<p>Only 7 days left to support "${esc(c.title)}" by ${esc(c.org_name)}!</p><p><a href="${BASE_URL}/discover/${c.id}">View Campaign & Donate</a></p>`).catch(()=>{});
        }
        await pool.query('INSERT INTO campaign_deadline_reminders(tenant_id,campaign_id,reminder_type,reminder_sent,sent_at,recipients_count) VALUES($1,$2,$3,true,NOW(),$4)', [c.tenant_id, c.id, '7_days', emails.length]);
        await pool.query('UPDATE fundraising_campaigns SET deadline_reminder_sent=true WHERE id=$1', [c.id]);
        sent7++;
      } catch(e) {}
    }

    // 3-day reminder
    const threeDays = new Date(Date.now() + 3*24*60*60*1000).toISOString().split('T')[0];
    const campaigns3 = (await pool.query(`SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.deadline=$1 AND fc.status='active' AND fc.deadline_3day_sent=false`, [threeDays])).rows;
    for (const c of campaigns3) {
      try {
        const followers = (await pool.query('SELECT user_email FROM campaign_followers WHERE campaign_id=$1', [c.id])).rows;
        const donors = (await pool.query('SELECT DISTINCT donor_email FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL', [c.id])).rows;
        const emails = [...new Set([...followers.map(f=>f.user_email), ...donors.map(d=>d.donor_email)])];
        for (const email of emails) {
          await sendEmail(email, 'URGENT: 3 Days Left - '+c.title, `<p>Only 3 days remaining for "${esc(c.title)}"! Don't miss this chance to make a difference.</p><p><a href="${BASE_URL}/discover/${c.id}">Donate Now</a></p>`).catch(()=>{});
        }
        await pool.query('INSERT INTO campaign_deadline_reminders(tenant_id,campaign_id,reminder_type,reminder_sent,sent_at,recipients_count) VALUES($1,$2,$3,true,NOW(),$4)', [c.tenant_id, c.id, '3_days', emails.length]);
        await pool.query('UPDATE fundraising_campaigns SET deadline_3day_sent=true WHERE id=$1', [c.id]);
        sent3++;
      } catch(e) {}
    }

    // 1-day reminder
    const oneDay = new Date(Date.now() + 1*24*60*60*1000).toISOString().split('T')[0];
    const campaigns1 = (await pool.query(`SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.deadline=$1 AND fc.status='active' AND fc.deadline_1day_sent=false`, [oneDay])).rows;
    for (const c of campaigns1) {
      try {
        const followers = (await pool.query('SELECT user_email FROM campaign_followers WHERE campaign_id=$1', [c.id])).rows;
        const donors = (await pool.query('SELECT DISTINCT donor_email FROM campaign_donations WHERE campaign_id=$1 AND donor_email IS NOT NULL', [c.id])).rows;
        const emails = [...new Set([...followers.map(f=>f.user_email), ...donors.map(d=>d.donor_email)])];
        for (const email of emails) {
          await sendEmail(email, 'LAST DAY: '+c.title+' ends tomorrow!', `<p>This is the FINAL DAY to donate to "${esc(c.title)}"! The campaign ends tomorrow.</p><p><a href="${BASE_URL}/discover/${c.id}/donate">Donate Before It Ends!</a></p>`).catch(()=>{});
        }
        await pool.query('INSERT INTO campaign_deadline_reminders(tenant_id,campaign_id,reminder_type,reminder_sent,sent_at,recipients_count) VALUES($1,$2,$3,true,NOW(),$4)', [c.tenant_id, c.id, '1_day', emails.length]);
        await pool.query('UPDATE fundraising_campaigns SET deadline_1day_sent=true WHERE id=$1', [c.id]);
        sent1++;
      } catch(e) {}
    }

    // Mark overdue campaigns
    const overdue = (await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE deadline < $1 AND status='active' RETURNING id", [today])).rows;

    res.json({ sent_7day: sent7, sent_3day: sent3, sent_1day: sent1, overdue_marked: overdue.length });
  }));

  // =============================================
  // FEATURE 20: DONOR PROFILES MANAGEMENT
  // =============================================

  app.get('/admin/donors', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const donors = (await pool.query('SELECT dp.*, (SELECT COUNT(*) FROM donor_recognition WHERE donor_email=dp.user_email AND tenant_id=dp.tenant_id) as badge_count FROM donor_profiles dp WHERE dp.tenant_id=$1 ORDER BY dp.total_donated DESC, dp.last_donation_at DESC', [t])).rows;

    res.send(renderPage('Donor Management', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488)"><h1>Donor Management</h1><p>View and manage your donor profiles</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${donors.length}</div><div>Total Donors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">UGX ${donors.reduce((a,d)=>a+(d.total_donated||0),0).toLocaleString()}</div><div>Total Donated</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">${donors.filter(d=>d.is_recurring_donor).length}</div><div>Recurring Donors</div></div>
      </div>
      <div class="card">
        <table><tr><th>Donor</th><th>Country</th><th>Total Donated</th><th>Donations</th><th>Campaigns</th><th>Last Donation</th><th>Badges</th></tr>
        ${donors.map(d=>'<tr><td><strong>'+esc(d.full_name)+'</strong><br><span class="muted" style="font-size:12px">'+esc(d.user_email||'')+'</span></td><td>'+esc(d.country||'Uganda')+'</td><td style="font-weight:700;color:#059669">UGX '+(d.total_donated||0).toLocaleString()+'</td><td>'+d.donation_count+'</td><td>'+d.campaigns_supported+'</td><td>'+(d.last_donation_at?new Date(d.last_donation_at).toLocaleDateString():'-')+'</td><td>'+(d.badge_count>0?'<span class="tag" style="background:#fef3c7;color:#92400e">'+d.badge_count+' badge'+(d.badge_count>1?'s':'')+'</span>':'-')+'</td></tr>').join('')||'<tr><td colspan="7">No donor profiles yet</td></tr>'}
        </table>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // FEATURE 21: CAMPAIGN COUNTDOWN WIDGET API
  // =============================================

  app.get('/api/campaigns/:id/countdown', ah(async (req, res) => {
    const c = (await pool.query('SELECT title, deadline, status FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!c.deadline) return res.json({ has_deadline: false, title: c.title, status: c.status });
    const now = Date.now();
    const deadline = new Date(c.deadline).getTime();
    const diff = deadline - now;
    const days = Math.max(0, Math.floor(diff / (1000*60*60*24)));
    const hours = Math.max(0, Math.floor((diff % (1000*60*60*24)) / (1000*60*60)));
    const minutes = Math.max(0, Math.floor((diff % (1000*60*60)) / (1000*60)));
    res.json({
      has_deadline: true,
      title: c.title,
      status: c.status,
      deadline: c.deadline,
      is_expired: diff <= 0,
      days_remaining: days,
      hours_remaining: hours,
      minutes_remaining: minutes,
      urgency: days <= 1 ? 'critical' : days <= 3 ? 'urgent' : days <= 7 ? 'high' : 'normal'
    });
  }));

  // =============================================
  // FEATURE 22: JSON-LD STRUCTURED DATA FOR SEO
  // =============================================

  app.get('/api/campaigns/:id/jsonld', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "DonateAction",
      "name": c.title,
      "description": c.seo_description || (c.description||'').substring(0, 500),
      "image": c.image_url || `${BASE_URL}/og-default.png`,
      "url": `${BASE_URL}/discover/${c.id}`,
      "recipient": {
        "@type": "Organization",
        "name": c.org_name
      },
      "price": c.target,
      "priceCurrency": c.currency || 'UGX',
      "amount": {
        "@type": "MonetaryAmount",
        "currency": c.currency || 'UGX',
        "value": c.target
      },
      "totalDonated": parseInt(c.raised||0),
      "donorCount": parseInt(c.donor_count||0),
      "startTime": c.created_at,
      "endTime": c.deadline,
      "location": c.location ? { "@type": "Place", "name": c.location, "address": { "@type": "PostalAddress", "addressCountry": c.country || 'UG' } } : undefined,
      "category": c.category
    };
    // Remove undefined fields
    Object.keys(jsonld).forEach(key => jsonld[key] === undefined && delete jsonld[key]);
    res.set('Content-Type', 'application/ld+json');
    res.json(jsonld);
  }));

  // =============================================
  // FEATURE 23: CAMPAIGN GALLERY MANAGEMENT
  // =============================================

  app.post('/campaigns/:id/gallery/add', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { image_url, video_url } = req.body;
    const c = (await pool.query('SELECT gallery_images, video_urls FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Not found');

    if (image_url) {
      const images = c.gallery_images || [];
      images.push(image_url);
      await pool.query('UPDATE fundraising_campaigns SET gallery_images=$1, updated_at=NOW() WHERE id=$2', [images, req.params.id]);
    }
    if (video_url) {
      const videos = c.video_urls || [];
      videos.push(video_url);
      await pool.query('UPDATE fundraising_campaigns SET video_urls=$1, updated_at=NOW() WHERE id=$2', [videos, req.params.id]);
    }

    // Add to timeline
    await pool.query('INSERT INTO campaign_progress_timeline(tenant_id,campaign_id,event_type,title,description,icon) VALUES($1,$2,$3,$4,$5,$6)',
      [t, req.params.id, image_url ? 'media_added' : 'media_added', image_url ? 'New Photo Added' : 'New Video Added', image_url ? 'A new photo was added to the campaign gallery' : 'A new video was added to the campaign', image_url ? '📸' : '🎬']);

    res.redirect('/fundraising/'+req.params.id);
  }));

  // =============================================
  // FEATURE 24: ENHANCED DONOR WALL with BADGES on CAMPAIGN PAGE
  // =============================================

  app.get('/api/campaigns/:id/social-proof', ah(async (req, res) => {
    const { limit } = req.query;
    const l = Math.min(parseInt(limit)||5, 20);
    const c = (await pool.query('SELECT id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });

    const [recentDonations, liveFeed, trustScore, milestones, countdown, matchingSponsors] = await Promise.all([
      pool.query('SELECT donor_name, amount, donated_at, is_anonymous, method FROM campaign_donations WHERE campaign_id=$1 AND refunded=false ORDER BY donated_at DESC LIMIT $2', [req.params.id, l]),
      pool.query('SELECT donor_display_name, amount, message, is_anonymous, created_at FROM live_donation_feed WHERE campaign_id=$1 AND show_until > NOW() ORDER BY created_at DESC LIMIT $2', [req.params.id, l]),
      pool.query('SELECT trust_score, trust_review_count FROM fundraising_campaigns WHERE id=$1', [req.params.id]),
      pool.query('SELECT title, is_completed, reached_at FROM campaign_milestones WHERE campaign_id=$1 AND is_completed=true ORDER BY reached_at DESC LIMIT 5', [req.params.id]),
      pool.query('SELECT deadline, status FROM fundraising_campaigns WHERE id=$1', [req.params.id]),
      pool.query("SELECT sponsor_name, match_ratio, max_match_amount, matched_so_far FROM matching_donations WHERE campaign_id=$1 AND status='active'", [req.params.id])
    ]);

    res.json({
      recent_donations: recentDonations.rows,
      live_feed: liveFeed.rows,
      trust_score: parseFloat(trustScore.rows[0]?.trust_score || 0),
      trust_review_count: parseInt(trustScore.rows[0]?.trust_review_count || 0),
      completed_milestones: milestones.rows,
      matching_sponsors: matchingSponsors.rows,
      deadline: countdown.rows[0]?.deadline || null,
      status: countdown.rows[0]?.status || 'active'
    });
  }));

  // =============================================
  // FEATURE 25: COMPREHENSIVE FUNDRAISING API FOR FRONTEND APPS
  // =============================================

  // Get full campaign details with all enriched data
  app.get('/api/campaigns/:id/full', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, t.type as org_type, t.subdomain, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1 AND fc.is_public=true', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Not found' });

    const [donations, updates, milestones, matchingSponsors, comments, testimonials, impact, goalBreakdown, trustReviews, timeline, followers] = await Promise.all([
      pool.query('SELECT * FROM campaign_donations WHERE campaign_id=$1 AND refunded=false ORDER BY donated_at DESC LIMIT 20', [req.params.id]),
      pool.query("SELECT * FROM campaign_updates WHERE campaign_id=$1 AND is_public=true ORDER BY created_at DESC LIMIT 10", [req.params.id]),
      pool.query('SELECT * FROM campaign_milestones WHERE campaign_id=$1 ORDER BY target_amount', [req.params.id]),
      pool.query("SELECT * FROM matching_donations WHERE campaign_id=$1 AND status='active'", [req.params.id]),
      pool.query("SELECT * FROM campaign_comments WHERE campaign_id=$1 AND status='visible' ORDER BY created_at DESC LIMIT 20", [req.params.id]),
      pool.query("SELECT * FROM campaign_testimonials WHERE campaign_id=$1 AND is_approved=true ORDER BY created_at DESC LIMIT 10", [req.params.id]),
      pool.query('SELECT * FROM donor_impact WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id]),
      pool.query('SELECT * FROM campaign_goal_breakdown WHERE campaign_id=$1 ORDER BY sort_order, id', [req.params.id]),
      pool.query('SELECT * FROM campaign_trust_reviews WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 10', [req.params.id]),
      pool.query('SELECT * FROM campaign_progress_timeline WHERE campaign_id=$1 ORDER BY event_date DESC LIMIT 20', [req.params.id]),
      pool.query('SELECT COUNT(*) as count FROM campaign_followers WHERE campaign_id=$1', [req.params.id])
    ]);

    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;

    res.json({
      campaign: {
        id: c.id, title: c.title, description: c.description, category: c.category,
        target: parseInt(c.target||0), raised: parseInt(c.raised||0), donor_count: parseInt(c.donor_count||0),
        percentage: pct, deadline: c.deadline, status: c.status, urgency_level: c.urgency_level,
        featured: c.featured, image_url: c.image_url, video_url: c.video_url, location: c.location,
        country: c.country||'Uganda', currency: c.currency||'UGX', org_name: c.org_name, org_type: c.org_type,
        tags: c.tags||[], views_count: parseInt(c.views_count||0), trust_score: parseFloat(c.trust_score||0),
        trust_review_count: parseInt(c.trust_review_count||0), follower_count: parseInt(followers.rows[0]?.count||0),
        total_shares: parseInt(c.total_shares||0), total_comments: parseInt(c.total_comments||0),
        investment_tiers: typeof c.investment_tiers === 'string' ? JSON.parse(c.investment_tiers||'[]') : c.investment_tiers||[],
        gallery_images: c.gallery_images||[], video_urls: c.video_urls||[],
        goal_breakdown: typeof c.goal_breakdown === 'string' ? JSON.parse(c.goal_breakdown||'[]') : c.goal_breakdown||[],
        share_url: `${BASE_URL}/discover/${c.id}`,
        donate_url: `${BASE_URL}/discover/${c.id}/donate`,
        embed_url: `${BASE_URL}/embed/${c.id}`
      },
      recent_donations: donations.rows,
      updates: updates.rows,
      milestones: milestones.rows,
      matching_sponsors: matchingSponsors.rows,
      comments: comments.rows,
      testimonials: testimonials.rows,
      impact: impact.rows,
      goal_breakdown_items: goalBreakdown.rows,
      trust_reviews: trustReviews.rows,
      timeline: timeline.rows,
      seo: {
        og_title: c.seo_title || c.title,
        og_description: c.seo_description || (c.description||'').substring(0, 200),
        og_image: c.image_url,
        jsonld_url: `${BASE_URL}/api/campaigns/${c.id}/jsonld`
      }
    });
  }));

  // =============================================
  // FEATURE 26: FUNDRAISING ENHANCED DASHBOARD
  // =============================================

  app.get('/fundraising/enhanced-dashboard', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const [campaigns, donors, payouts, refunds, emails, reminders] = await Promise.all([
      pool.query("SELECT id, title, status, target, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id) as raised, featured, urgency_level FROM fundraising_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC", [t]),
      pool.query('SELECT COUNT(*) as count, SUM(total_donated) as total FROM donor_profiles WHERE tenant_id=$1', [t]),
      pool.query("SELECT COUNT(*) as count, SUM(amount) as total FROM payout_requests WHERE tenant_id=$1 AND status='pending'", [t]),
      pool.query("SELECT COUNT(*) as count FROM refund_requests WHERE tenant_id=$1 AND status='pending'", [t]),
      pool.query("SELECT COUNT(*) as count FROM campaign_email_campaigns WHERE tenant_id=$1 AND status='sent'", [t]),
      pool.query("SELECT COUNT(*) as count FROM campaign_deadline_reminders WHERE tenant_id=$1 AND reminder_sent=true AND sent_at > NOW() - INTERVAL '7 days'", [t])
    ]);

    const activeCampaigns = campaigns.rows.filter(c => c.status === 'active');
    const totalRaised = campaigns.rows.reduce((a,c) => a + parseInt(c.raised||0), 0);

    res.send(renderPage('Enhanced Fundraising Dashboard', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#0d9488,#0891b2)">
        <h1>Enhanced Fundraising Dashboard</h1>
        <p>Complete overview of your fundraising platform</p>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
          <a href="/fundraising" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Campaigns</a>
          <a href="/admin/donors" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Donors</a>
          <a href="/admin/payouts" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Payouts</a>
          <a href="/admin/refunds" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Refunds</a>
          <a href="/discover" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Discover</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${campaigns.rows.length}</div><div>Total Campaigns</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${activeCampaigns.length}</div><div>Active</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">UGX ${totalRaised.toLocaleString()}</div><div>Total Raised</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">${parseInt(donors.rows[0]?.count||0)}</div><div>Donors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${parseInt(payouts.rows[0]?.count||0)}</div><div>Pending Payouts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${parseInt(refunds.rows[0]?.count||0)}</div><div>Pending Refunds</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${parseInt(emails.rows[0]?.count||0)}</div><div>Emails Sent</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${parseInt(reminders.rows[0]?.count||0)}</div><div>Reminders This Week</div></div>
      </div>
      <div class="card">
        <h3>All Campaigns</h3>
        <table><tr><th>Campaign</th><th>Status</th><th>Raised</th><th>Goal</th><th>Progress</th><th>Quick Actions</th></tr>
        ${campaigns.rows.map(c => {
          const pct = c.target > 0 ? Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100) : 0;
          return '<tr><td><strong>'+esc(c.title)+'</strong>'+(c.featured?' <span style="background:#f59e0b;color:white;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700">Featured</span>':'')+'</td><td><span class="tag" style="background:'+(c.status==='active'?'#d1fae5;color:#065f46':c.status==='completed'?'#e0e7ff;color:#3730a3':'#fef3c7;color:#92400e')+'">'+esc(c.status)+'</span></td><td style="font-weight:700;color:#059669">UGX '+(parseInt(c.raised)||0).toLocaleString()+'</td><td>UGX '+(parseInt(c.target)||0).toLocaleString()+'</td><td><div class="progress-bar" style="height:10px;width:100px"><div class="progress-fill" style="width:'+pct+'%;background:'+(pct>=75?'#059669':pct>=40?'#f59e0b':'#4f46e5')+'">'+pct+'%</div></div></td><td><a href="/fundraising/'+c.id+'" class="btn btn-sm">View</a> <a href="/campaigns/'+c.id+'/matching" class="btn btn-sm" style="background:#f59e0b;color:white">Match</a> <a href="/campaigns/'+c.id+'/emails" class="btn btn-sm" style="background:#7c3aed;color:white">Email</a> <a href="/campaigns/'+c.id+'/breakdown" class="btn btn-sm" style="background:#4f46e5;color:white">Breakdown</a> <a href="/campaigns/'+c.id+'/peer" class="btn btn-sm" style="background:#ec4899;color:white">P2P</a></td></tr>';
        }).join('')||'<tr><td colspan="6">No campaigns yet</td></tr>'}
        </table>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:20px">
        <a href="/campaigns/new/peer" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #ec4899"><div style="font-size:32px;margin-bottom:8px">🤝</div><h4>Peer-to-Peer</h4><p class="muted" style="font-size:13px">Let supporters create their own pages</p></a>
        <a href="/api/exchange-rates" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #0891b2"><div style="font-size:32px;margin-bottom:8px">💱</div><h4>Multi-Currency</h4><p class="muted" style="font-size:13px">Accept donations in any currency</p></a>
        <a href="/sitemap.xml" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #059669"><div style="font-size:32px;margin-bottom:8px">🌍</div><h4>SEO & Visibility</h4><p class="muted" style="font-size:13px">Sitemap, JSON-LD, Open Graph</p></a>
        <a href="/api/trending-campaigns" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #f59e0b"><div style="font-size:32px;margin-bottom:8px">🔥</div><h4>Trending</h4><p class="muted" style="font-size:13px">Most popular campaigns globally</p></a>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // FEATURE 27: ADD TIMELINE EVENT FOR NEW CAMPAIGNS
  // =============================================
  // (Called from campaign creation - auto-records creation event)
  app.post('/api/campaigns/:id/timeline-event', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { event_type, title, description, icon, is_highlighted } = req.body;
    const t = req.session.user.tenant_id;
    try {
      await pool.query('INSERT INTO campaign_progress_timeline(tenant_id,campaign_id,event_type,title,description,icon,is_highlighted) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [t, req.params.id, event_type||'created', title||'Campaign Created', description||'', icon||'🚀', is_highlighted||false]);
      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  console.log('[Fundraising Enhancements] All routes registered successfully');
  console.log('[Fundraising V2] Multi-Currency, Deadline Reminders, Donation Receipts, Goal Breakdown, Social Proof, Trust Score, P2P Fundraising, Progress Timeline, Email Marketing, Countdown Widget, Donor Profiles, JSON-LD SEO, Gallery, Enhanced Dashboard');
};
