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

const { migrateQuery } = require('./db');
module.exports = function(app, pool, ah, requireAuth, requireNotBanned, requireFundraisingSubscription, renderPage, esc, notify, notifyAll, sendEmail, sendSMS, audit) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  // =============================================
  // REUSABLE: Post-Donation Processing
  // (Called directly from donate-save routes)
  // =============================================
  async function processDonationEffects({ tenant_id, campaign_id, donation_id, donor_name, donor_email, donor_phone, amount, method, message, is_anonymous }) {
    // 1. Process matching donations
    try {
      const activeMatches = (await pool.query("SELECT * FROM matching_donations WHERE campaign_id=$1 AND tenant_id=$2 AND status='active' AND matched_so_far < max_match_amount", [campaign_id, tenant_id])).rows;
      for (const match of activeMatches) {
        const matchAmount = Math.min(Math.round(parseInt(amount) * parseFloat(match.match_ratio)), parseInt(match.max_match_amount) - parseInt(match.matched_so_far));
        if (matchAmount > 0) {
          const matchResult = await pool.query('UPDATE matching_donations SET matched_so_far=matched_so_far+$1 WHERE id=$2 AND tenant_id=$3 AND matched_so_far+$1 <= max_match_amount RETURNING *', [matchAmount, match.id, tenant_id]);
          if (donation_id) {
            await pool.query('UPDATE campaign_donations SET matching_contribution=$1 WHERE id=$2 AND tenant_id=$3', [matchAmount, donation_id, tenant_id]);
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
        const totalDonated = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE donor_email=$1 AND refunded=false AND tenant_id=$2', [donor_email, tenant_id])).rows[0]?.total || 0;
        const badge = calculateBadge(parseInt(totalDonated));
        if (badge) {
          await pool.query(`INSERT INTO donor_recognition(tenant_id,donor_email,donor_name,badge_type,total_donated,campaigns_supported) VALUES($1,$2,$3,$4,$5,(SELECT COUNT(DISTINCT campaign_id) FROM campaign_donations WHERE donor_email=$2 AND tenant_id=$1))
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
        await pool.query('UPDATE campaign_donations SET thank_you_sent=true, donor_email=COALESCE(donor_email,$1), donor_phone=COALESCE(donor_phone,$2), is_anonymous=COALESCE(is_anonymous,$3) WHERE id=$4 AND tenant_id=$5', [donor_email||null, donor_phone||null, is_anonymous||false, donation_id, tenant_id]);
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
      const raised = (await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE campaign_id=$1 AND refunded=false AND tenant_id=$2', [campaign_id, tenant_id])).rows[0]?.total || 0;
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
              await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE id=$1 AND tenant_id=$2", [campaign_id, tenant_id]);
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
        await pool.query('UPDATE campaign_donations SET receipt_number=$1 WHERE id=$2 AND tenant_id=$3', [receiptNum, donation_id, tenant_id]);
      }
    } catch(e) { console.warn('[Receipt Error]', e.message); }

    // 9. Update donor profile
    try {
      if (donor_email) {
        const totalDonated = (await pool.query('SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count, COUNT(DISTINCT campaign_id) as camps FROM campaign_donations WHERE donor_email=$1 AND refunded=false AND tenant_id=$2', [donor_email, tenant_id])).rows[0];
        const firstDonation = (await pool.query('SELECT MIN(donated_at) as first FROM campaign_donations WHERE donor_email=$1 AND refunded=false AND tenant_id=$2', [donor_email, tenant_id])).rows[0]?.first;
        await pool.query(`INSERT INTO donor_profiles(tenant_id,user_email,full_name,phone,total_donated,donation_count,campaigns_supported,first_donation_at,last_donation_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
          ON CONFLICT (tenant_id, user_email) DO UPDATE SET full_name=COALESCE(NULLIF($3,''),donor_profiles.full_name), total_donated=$5, donation_count=$6, campaigns_supported=$7, last_donation_at=NOW(), updated_at=NOW()`,
          [tenant_id, donor_email, donor_name||'', donor_phone||'', parseInt(totalDonated?.total||0), parseInt(totalDonated?.count||0), parseInt(totalDonated?.camps||0), firstDonation]);
      }
    } catch(e) { console.warn('[Donor Profile Error]', e.message); }

    // 10. Add to progress timeline
    try {
      const donationCount = (await pool.query('SELECT COUNT(*) as count FROM campaign_donations WHERE campaign_id=$1 AND refunded=false AND tenant_id=$2', [campaign_id, tenant_id])).rows[0]?.count || 0;
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

    // Matching donations - sponsors pledge to match donations)
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

    // Campaign comments / encouragement)
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

    // Donor recognition / badges)
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

    // Campaign shares tracking)
    `CREATE TABLE IF NOT EXISTS campaign_shares (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      shared_by TEXT,
      platform TEXT CHECK (platform IN ('whatsapp','twitter','facebook','linkedin','email','link_copy','telegram','other')),
      ip_address TEXT,
      click_count INTEGER DEFAULT 0,
      donation_count INTEGER DEFAULT 0,
      donation_total INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Refund requests)
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

    // Campaign followers - users who want updates)
    `CREATE TABLE IF NOT EXISTS campaign_followers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      notify_on_update BOOLEAN DEFAULT true,
      notify_on_milestone BOOLEAN DEFAULT true,
      notify_on_comment BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(campaign_id, user_email)
    )`,

    // Peer fundraisers - individual fundraising pages for campaigns)
    `CREATE TABLE IF NOT EXISTS peer_fundraisers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      goal INTEGER DEFAULT 0,
      raised INTEGER DEFAULT 0,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign testimonials)
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

    // Campaign milestones)
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

    // Campaign stories - for SEO and global visibility)
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

    // Donor impact tracking)
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

    // Donor profiles - comprehensive donor management)
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

    // Donation receipts - official receipts for donors)
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

    // Campaign deadline reminders)
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

    // Campaign goal breakdown - how funds will be used)
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

    // Live donation feed - social proof)
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

    // Campaign progress timeline - key events)
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

    // Campaign email marketing - send emails to donors/followers)
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

    // Multi-currency exchange rates)
    `CREATE TABLE IF NOT EXISTS exchange_rates (
      id SERIAL PRIMARY KEY,
      from_currency TEXT NOT NULL DEFAULT 'UGX',
      to_currency TEXT NOT NULL DEFAULT 'USD',
      rate NUMERIC(12,6) NOT NULL,
      source TEXT DEFAULT 'manual',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(from_currency, to_currency)
    )`,

    // Campaign trust scores)
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
    )`,

    // =============================================
    // NEW V3 TABLES - Additional Success Features
    // =============================================

    // Campaign verification - admin-verified campaigns get trust badges)
    `CREATE TABLE IF NOT EXISTS campaign_verifications (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      verification_type TEXT DEFAULT 'standard' CHECK (verification_type IN ('standard','enhanced','premium','government','ngo_registered')),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','under_review','approved','rejected','expired','revoked')),
      submitted_by TEXT NOT NULL,
      documents JSONB DEFAULT '[]',
      notes TEXT,
      admin_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      verified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      badge_level TEXT DEFAULT 'none' CHECK (badge_level IN ('none','verified','trusted','premium','gold')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donation rewards/tiers - donors get rewards at different giving levels)
    `CREATE TABLE IF NOT EXISTS campaign_reward_tiers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      min_amount INTEGER NOT NULL,
      max_amount INTEGER,
      reward_type TEXT DEFAULT 'digital' CHECK (reward_type IN ('digital','physical','experience','recognition','custom')),
      reward_details JSONB DEFAULT '{}',
      image_url TEXT,
      estimated_delivery DATE,
      quantity_available INTEGER,
      quantity_claimed INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Reward claims - when donors claim a reward)
    `CREATE TABLE IF NOT EXISTS reward_claims (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      reward_tier_id INTEGER REFERENCES campaign_reward_tiers(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id),
      donor_email TEXT,
      donor_name TEXT NOT NULL,
      donor_phone TEXT,
      shipping_address TEXT,
      claim_status TEXT DEFAULT 'pending' CHECK (claim_status IN ('pending','confirmed','shipped','delivered','cancelled')),
      tracking_number TEXT,
      notes TEXT,
      claimed_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign wishlists - specific items needed, not just money)
    `CREATE TABLE IF NOT EXISTS campaign_wishlists (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      description TEXT,
      quantity_needed INTEGER NOT NULL DEFAULT 1,
      quantity_fulfilled INTEGER DEFAULT 0,
      estimated_cost INTEGER DEFAULT 0,
      category TEXT DEFAULT 'supplies' CHECK (category IN ('supplies','equipment','food','clothing','medical','technology','building_materials','services','other')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      image_url TEXT,
      link TEXT,
      is_fulfilled BOOLEAN DEFAULT false,
      fulfilled_by TEXT,
      fulfilled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Wishlist pledges - people pledge to provide specific items)
    `CREATE TABLE IF NOT EXISTS wishlist_pledges (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      wishlist_id INTEGER REFERENCES campaign_wishlists(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      pledger_name TEXT NOT NULL,
      pledger_email TEXT,
      pledger_phone TEXT,
      quantity_pledged INTEGER NOT NULL DEFAULT 1,
      message TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivered','cancelled')),
      pledged_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Volunteer sign-ups - people can volunteer time for campaigns)
    `CREATE TABLE IF NOT EXISTS campaign_volunteers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      volunteer_name TEXT NOT NULL,
      volunteer_email TEXT NOT NULL,
      volunteer_phone TEXT,
      skills TEXT[] DEFAULT '{}',
      availability TEXT DEFAULT 'flexible' CHECK (availability IN ('flexible','weekdays','weekends','mornings','evenings','full_time')),
      hours_pledged INTEGER DEFAULT 0,
      hours_completed INTEGER DEFAULT 0,
      role TEXT,
      motivation TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','active','completed','declined')),
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      certificate_issued BOOLEAN DEFAULT false,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign endorsements - notable people endorse campaigns)
    `CREATE TABLE IF NOT EXISTS campaign_endorsements (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      endorser_name TEXT NOT NULL,
      endorser_title TEXT,
      endorser_organization TEXT,
      endorser_photo TEXT,
      endorser_email TEXT,
      endorsement_text TEXT NOT NULL,
      is_public BOOLEAN DEFAULT true,
      is_featured BOOLEAN DEFAULT false,
      is_verified BOOLEAN DEFAULT false,
      verified_by TEXT,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor streaks - gamification for consecutive giving)
    `CREATE TABLE IF NOT EXISTS donor_streaks (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_donation_date DATE,
      streak_type TEXT DEFAULT 'monthly' CHECK (streak_type IN ('daily','weekly','monthly')),
      total_streak_donations INTEGER DEFAULT 0,
      streak_start_date DATE,
      rewards_claimed INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, donor_email, streak_type)
    )`,

    // Campaign collaboration - multiple orgs can co-own a campaign)
    `CREATE TABLE IF NOT EXISTS campaign_collaborators (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      collaborator_tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'viewer' CHECK (role IN ('owner','co_owner','editor','viewer','fundraiser')),
      contribution_percentage INTEGER DEFAULT 0,
      invited_by TEXT,
      invited_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
      notes TEXT,
      UNIQUE(campaign_id, collaborator_tenant_id)
    )`,

    // Donation tips - optional platform support tips on donations)
    `CREATE TABLE IF NOT EXISTS donation_tips (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      donor_name TEXT,
      donor_email TEXT,
      tip_amount INTEGER NOT NULL DEFAULT 0,
      tip_percentage NUMERIC(5,2) DEFAULT 0,
      base_donation INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor retention analytics - track repeat vs one-time donors)
    `CREATE TABLE IF NOT EXISTS donor_retention_analytics (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_donors INTEGER DEFAULT 0,
      new_donors INTEGER DEFAULT 0,
      repeat_donors INTEGER DEFAULT 0,
      retained_donors INTEGER DEFAULT 0,
      churned_donors INTEGER DEFAULT 0,
      reactivated_donors INTEGER DEFAULT 0,
      retention_rate NUMERIC(5,2) DEFAULT 0,
      avg_donation_new INTEGER DEFAULT 0,
      avg_donation_repeat INTEGER DEFAULT 0,
      ltv_estimate INTEGER DEFAULT 0,
      calculated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, period_start, period_end)
    )`,

    // Campaign success scores - smart scoring for optimization)
    `CREATE TABLE IF NOT EXISTS campaign_success_scores (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      overall_score NUMERIC(5,2) DEFAULT 0,
      story_quality_score NUMERIC(5,2) DEFAULT 0,
      media_quality_score NUMERIC(5,2) DEFAULT 0,
      engagement_score NUMERIC(5,2) DEFAULT 0,
      momentum_score NUMERIC(5,2) DEFAULT 0,
      trust_score NUMERIC(5,2) DEFAULT 0,
      social_proof_score NUMERIC(5,2) DEFAULT 0,
      urgency_score NUMERIC(5,2) DEFAULT 0,
      transparency_score NUMERIC(5,2) DEFAULT 0,
      recommendations JSONB DEFAULT '[]',
      last_calculated TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, campaign_id)
    )`,

    // Campaign updates notifications - when campaigns post updates)
    `CREATE TABLE IF NOT EXISTS campaign_update_notifications (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      update_id INTEGER REFERENCES campaign_updates(id),
      notification_type TEXT DEFAULT 'update' CHECK (notification_type IN ('update','milestone','urgent','thank_you','media')),
      recipients_count INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      sent_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign FAQ - frequently asked questions per campaign)
    `CREATE TABLE IF NOT EXISTS campaign_faqs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_featured BOOLEAN DEFAULT false,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign events - fundraising events linked to campaigns)
    `CREATE TABLE IF NOT EXISTS campaign_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      event_type TEXT DEFAULT 'fundraiser' CHECK (event_type IN ('fundraiser','gala','auction','walkathon','webinar','concert','volunteer_day','other')),
      event_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ,
      location TEXT,
      virtual_link TEXT,
      capacity INTEGER,
      registered_count INTEGER DEFAULT 0,
      ticket_price INTEGER DEFAULT 0,
      image_url TEXT,
      is_public BOOLEAN DEFAULT true,
      status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','ongoing','completed','cancelled')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Event registrations)
    `CREATE TABLE IF NOT EXISTS campaign_event_registrations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES campaign_events(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      attendee_name TEXT NOT NULL,
      attendee_email TEXT NOT NULL,
      attendee_phone TEXT,
      num_tickets INTEGER DEFAULT 1,
      amount_paid INTEGER DEFAULT 0,
      registration_status TEXT DEFAULT 'registered' CHECK (registration_status IN ('registered','confirmed','cancelled','attended','no_show')),
      ticket_code TEXT,
      registered_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // =============================================
    // V4 TABLES - Additional Success Features
    // =============================================

    // Donation gift cards)
    `CREATE TABLE IF NOT EXISTS donation_gift_cards (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      card_code TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      purchaser_name TEXT,
      purchaser_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      message TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','redeemed','expired','cancelled')),
      redeemed_by TEXT,
      redeemed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign challenges/competitions)
    `CREATE TABLE IF NOT EXISTS campaign_challenges (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      challenge_type TEXT DEFAULT 'most_raised' CHECK (challenge_type IN ('most_raised','most_donors','fastest_goal','highest_percentage','most_shared','community_impact')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      prize_description TEXT,
      max_participants INTEGER DEFAULT 20,
      participant_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','completed','cancelled')),
      is_public BOOLEAN DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Challenge participants)
    `CREATE TABLE IF NOT EXISTS challenge_participants (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      challenge_id INTEGER REFERENCES campaign_challenges(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(challenge_id, campaign_id)
    )`,

    // Campaign ambassadors)
    `CREATE TABLE IF NOT EXISTS campaign_ambassadors (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      ambassador_name TEXT NOT NULL,
      ambassador_email TEXT NOT NULL,
      ambassador_photo TEXT,
      motivation TEXT,
      promotion_plan TEXT,
      social_reach INTEGER DEFAULT 0,
      referrals_count INTEGER DEFAULT 0,
      total_donated INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
      status TEXT DEFAULT 'active' CHECK (status IN ('pending','active','suspended','retired')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(campaign_id, ambassador_email)
    )`,

    // Campaign merchandise)
    `CREATE TABLE IF NOT EXISTS campaign_merchandise (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      image_url TEXT,
      quantity_available INTEGER,
      quantity_sold INTEGER DEFAULT 0,
      is_donation BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Community board posts)
    `CREATE TABLE IF NOT EXISTS campaign_community_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      author_email TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      post_type TEXT DEFAULT 'discussion' CHECK (post_type IN ('discussion','question','idea','celebration','update')),
      likes INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      is_pinned BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'visible' CHECK (status IN ('visible','hidden','flagged')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor segments for targeted communications)
    `CREATE TABLE IF NOT EXISTS donor_segments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      segment_name TEXT NOT NULL,
      segment_type TEXT DEFAULT 'custom' CHECK (segment_type IN ('top_donors','new_donors','recurring','lapsed','custom','high_value','at_risk')),
      criteria JSONB DEFAULT '{}',
      donor_count INTEGER DEFAULT 0,
      last_calculated TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign translations for multi-language)
    `CREATE TABLE IF NOT EXISTS campaign_translations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      language TEXT NOT NULL DEFAULT 'en',
      title TEXT,
      description TEXT,
      story TEXT,
      impact_summary TEXT,
      translated_by TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(campaign_id, language)
    )`,

    // =============================================
    // V5 TABLES - Ultimate Professional Features
    // =============================================

    // Donor referral program - refer friends, earn rewards)
    `CREATE TABLE IF NOT EXISTS donor_referrals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      referrer_email TEXT NOT NULL,
      referrer_name TEXT,
      referral_code TEXT UNIQUE NOT NULL,
      referred_email TEXT,
      referred_name TEXT,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','signed_up','donated','rewarded','expired')),
      reward_type TEXT DEFAULT 'credit' CHECK (reward_type IN ('credit','badge','merchandise','none')),
      reward_amount INTEGER DEFAULT 0,
      donated_amount INTEGER DEFAULT 0,
      rewarded_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign auctions - bid on items to support campaigns)
    `CREATE TABLE IF NOT EXISTS campaign_auctions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      starting_bid INTEGER NOT NULL DEFAULT 0,
      current_bid INTEGER DEFAULT 0,
      current_bidder TEXT,
      current_bidder_email TEXT,
      reserve_price INTEGER,
      buy_now_price INTEGER,
      bid_increment INTEGER DEFAULT 10000,
      total_bids INTEGER DEFAULT 0,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','ending_soon','ended','cancelled')),
      winner_name TEXT,
      winner_email TEXT,
      winning_bid INTEGER,
      is_featured BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Auction bids)
    `CREATE TABLE IF NOT EXISTS auction_bids (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      auction_id INTEGER REFERENCES campaign_auctions(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      bidder_name TEXT NOT NULL,
      bidder_email TEXT NOT NULL,
      bid_amount INTEGER NOT NULL,
      is_winning BOOLEAN DEFAULT false,
      is_auto_bid BOOLEAN DEFAULT false,
      max_auto_bid INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Pledge management - donors pledge to give later)
    `CREATE TABLE IF NOT EXISTS campaign_pledges (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      pledgor_name TEXT NOT NULL,
      pledgor_email TEXT NOT NULL,
      pledgor_phone TEXT,
      pledged_amount INTEGER NOT NULL,
      fulfilled_amount INTEGER DEFAULT 0,
      pledge_date DATE NOT NULL,
      expected_fulfillment_date DATE,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','fulfilled','overdue','cancelled')),
      reminder_count INTEGER DEFAULT 0,
      last_reminder_at TIMESTAMPTZ,
      notes TEXT,
      fulfilled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Social media scheduled posts)
    `CREATE TABLE IF NOT EXISTS campaign_social_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK (platform IN ('twitter','facebook','linkedin','instagram','whatsapp','telegram','tiktok')),
      content TEXT NOT NULL,
      image_url TEXT,
      link_url TEXT,
      hashtags TEXT[] DEFAULT '{}',
      scheduled_at TIMESTAMPTZ NOT NULL,
      posted_at TIMESTAMPTZ,
      status TEXT DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','posting','posted','failed')),
      post_url TEXT,
      likes INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      donations_from_post INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor tribute / memorial donations)
    `CREATE TABLE IF NOT EXISTS donor_tributes (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      donation_id INTEGER REFERENCES campaign_donations(id),
      tribute_type TEXT DEFAULT 'in_honor' CHECK (tribute_type IN ('in_honor','in_memory','in_celebration','in_support')),
      honoree_name TEXT NOT NULL,
      honoree_email TEXT,
      honoree_relationship TEXT,
      tribute_message TEXT,
      notify_honoree BOOLEAN DEFAULT true,
      notify_sent BOOLEAN DEFAULT false,
      donor_name TEXT NOT NULL,
      donor_email TEXT NOT NULL,
      is_public BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Campaign story templates - pre-built templates for campaigns)
    `CREATE TABLE IF NOT EXISTS campaign_story_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      template_name TEXT NOT NULL,
      category TEXT DEFAULT 'general' CHECK (category IN ('general','medical','education','disaster','community','religious','environment','animals','sports','arts')),
      title_template TEXT NOT NULL,
      story_template TEXT NOT NULL,
      impact_template TEXT,
      goal_suggestion INTEGER,
      image_suggestions TEXT[] DEFAULT '{}',
      tips TEXT[] DEFAULT '{}',
      is_featured BOOLEAN DEFAULT false,
      usage_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donation goal thermometer API data)
    `CREATE TABLE IF NOT EXISTS campaign_thermometers (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE UNIQUE,
      current_amount INTEGER DEFAULT 0,
      target_amount INTEGER NOT NULL,
      percentage NUMERIC(5,2) DEFAULT 0,
      donor_count INTEGER DEFAULT 0,
      days_remaining INTEGER,
      daily_average INTEGER DEFAULT 0,
      projected_total INTEGER DEFAULT 0,
      milestones JSONB DEFAULT '[25,50,75,100]',
      milestone_reached JSONB DEFAULT '[]',
      embed_config JSONB DEFAULT '{"show_thermometer":true,"show_donor_count":true,"show_days_left":true,"show_projected":true,"theme":"green"}',
      last_updated TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Donor CRM export queue)
    `CREATE TABLE IF NOT EXISTS donor_crm_exports (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      export_type TEXT DEFAULT 'csv' CHECK (export_type IN ('csv','excel','pdf','json')),
      export_scope TEXT DEFAULT 'all_donors' CHECK (export_scope IN ('all_donors','top_donors','new_donors','recurring','lapsed','segment','campaign')),
      segment_id INTEGER,
      campaign_id INTEGER REFERENCES fundraising_campaigns(id) ON DELETE CASCADE,
      date_from DATE,
      date_to DATE,
      filters JSONB DEFAULT '{}',
      record_count INTEGER DEFAULT 0,
      file_path TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','expired')),
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ
    )`,

    // Campaign comparison - compare campaigns side by side)
    `CREATE TABLE IF NOT EXISTS campaign_comparisons (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      campaign_ids INTEGER[] NOT NULL,
      comparison_type TEXT DEFAULT 'performance' CHECK (comparison_type IN ('performance','financial','engagement','growth','custom')),
      metrics TEXT[] DEFAULT '{"raised","donors","shares","growth_rate"}',
      is_public BOOLEAN DEFAULT false,
      created_by TEXT,
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
    // Seed default exchange rates)
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'USD', 0.000270, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'KES', 0.035, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'TZS', 0.63, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'EUR', 0.000248, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('UGX', 'GBP', 0.000214, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `INSERT INTO exchange_rates (from_currency, to_currency, rate, source) VALUES ('USD', 'UGX', 3700, 'manual') ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
    `ALTER TABLE investor_offers ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_shares ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`,
    `ALTER TABLE campaign_followers ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE`,
    `ALTER TABLE payout_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE matching_donations ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_comments ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE donor_recognition ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_testimonials ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_milestones ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE campaign_stories ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE donor_impact ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    // V3: New columns for fundraising_campaigns
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS verification_badge TEXT DEFAULT 'none'`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_rewards BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_wishlist BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_volunteers BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS volunteer_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS endorsement_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_faq BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_events BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS event_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS tip_total INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS success_score NUMERIC(5,2) DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS wishlist_items_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS reward_tiers_count INTEGER DEFAULT 0`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS tip_amount INTEGER DEFAULT 0`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS reward_tier_id INTEGER`,
    `ALTER TABLE campaign_donations ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN DEFAULT false`,
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
    // V3 Indexes for new tables
    `CREATE INDEX IF NOT EXISTS idx_campaign_verifications_tenant ON campaign_verifications(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_verifications_campaign ON campaign_verifications(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_reward_tiers_tenant ON campaign_reward_tiers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_reward_tiers_campaign ON campaign_reward_tiers(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reward_claims_tenant ON reward_claims(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reward_claims_reward ON reward_claims(reward_tier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_wishlists_tenant ON campaign_wishlists(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_wishlists_campaign ON campaign_wishlists(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wishlist_pledges_tenant ON wishlist_pledges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wishlist_pledges_wishlist ON wishlist_pledges(wishlist_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_volunteers_tenant ON campaign_volunteers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_volunteers_campaign ON campaign_volunteers(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_endorsements_tenant ON campaign_endorsements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_endorsements_campaign ON campaign_endorsements(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_streaks_tenant ON donor_streaks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_streaks_email ON donor_streaks(donor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_collaborators_tenant ON campaign_collaborators(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_collaborators_campaign ON campaign_collaborators(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_tips_tenant ON donation_tips(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_tips_donation ON donation_tips(donation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_retention_analytics_tenant ON donor_retention_analytics(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_success_scores_tenant ON campaign_success_scores(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_success_scores_campaign ON campaign_success_scores(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_faqs_tenant ON campaign_faqs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_faqs_campaign ON campaign_faqs(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_events_tenant ON campaign_events(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign ON campaign_events(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_event_registrations_tenant ON campaign_event_registrations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_event_registrations_event ON campaign_event_registrations(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_update_notifications_tenant ON campaign_update_notifications(tenant_id)`,
    // V4 Indexes
    `CREATE INDEX IF NOT EXISTS idx_donation_gift_cards_tenant ON donation_gift_cards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_gift_cards_code ON donation_gift_cards(card_code)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_gift_cards_email ON donation_gift_cards(purchaser_email)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_challenges_tenant ON campaign_challenges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_challenges_status ON campaign_challenges(status)`,
    `CREATE INDEX IF NOT EXISTS idx_challenge_participants_tenant ON challenge_participants(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge ON challenge_participants(challenge_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_ambassadors_tenant ON campaign_ambassadors(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_ambassadors_campaign ON campaign_ambassadors(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_merchandise_tenant ON campaign_merchandise(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_merchandise_campaign ON campaign_merchandise(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_community_posts_tenant ON campaign_community_posts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_community_posts_campaign ON campaign_community_posts(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_segments_tenant ON donor_segments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_translations_tenant ON campaign_translations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_translations_campaign ON campaign_translations(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_translations_language ON campaign_translations(language)`,
    // V4: Add gift_card_balance to donor_profiles
    `ALTER TABLE donor_profiles ADD COLUMN IF NOT EXISTS gift_card_balance INTEGER DEFAULT 0`,
    // V5: Add new columns for V5 features
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_auctions BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS auction_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_pledges BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS pledge_total INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS has_tributes BOOLEAN DEFAULT false`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS tribute_count INTEGER DEFAULT 0`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS referral_code TEXT`,
    `ALTER TABLE fundraising_campaigns ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0`,
    `ALTER TABLE donor_profiles ADD COLUMN IF NOT EXISTS referral_code TEXT`,
    `ALTER TABLE donor_profiles ADD COLUMN IF NOT EXISTS referral_count INTEGER DEFAULT 0`,
    `ALTER TABLE donor_profiles ADD COLUMN IF NOT EXISTS referral_earnings INTEGER DEFAULT 0`,
    // V5 Indexes
    `CREATE INDEX IF NOT EXISTS idx_donor_referrals_tenant ON donor_referrals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_referrals_code ON donor_referrals(referral_code)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_referrals_referrer ON donor_referrals(referrer_email)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_referrals_campaign ON donor_referrals(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_auctions_tenant ON campaign_auctions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_auctions_campaign ON campaign_auctions(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_auctions_status ON campaign_auctions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_tenant ON auction_bids(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_auction ON auction_bids(auction_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auction_bids_email ON auction_bids(bidder_email)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_tenant ON campaign_pledges(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_campaign ON campaign_pledges(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_email ON campaign_pledges(pledgor_email)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_pledges_status ON campaign_pledges(status)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_social_posts_tenant ON campaign_social_posts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_social_posts_campaign ON campaign_social_posts(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_social_posts_status ON campaign_social_posts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_tributes_tenant ON donor_tributes(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_tributes_campaign ON donor_tributes(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_story_templates_tenant ON campaign_story_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_story_templates_category ON campaign_story_templates(category)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_thermometers_tenant ON campaign_thermometers(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_thermometers_campaign ON campaign_thermometers(campaign_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_exports_tenant ON donor_crm_exports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_crm_exports_status ON donor_crm_exports(status)`,
    `CREATE INDEX IF NOT EXISTS idx_campaign_comparisons_tenant ON campaign_comparisons(tenant_id)`,
    // Seed some default story templates (using tenant_id from existing tenants to avoid FK violations)
    `INSERT INTO campaign_story_templates (tenant_id, template_name, category, title_template, story_template, impact_template, goal_suggestion, tips, is_featured) SELECT id, 'Medical Emergency', 'medical', 'Help [Name] Fight [Condition]', 'Our beloved [Name] has been diagnosed with [condition] and needs urgent medical treatment. The cost of treatment is [amount] which the family cannot afford alone. With your help, we can give [Name] a fighting chance at recovery and a better quality of life.', 'Your donation will directly fund medical treatments, hospital bills, and medication for [Name]. Every contribution brings them closer to recovery.', 5000000, ARRAY['Include a photo of the patient','Share the diagnosis details','Provide hospital contact for verification','Update donors on treatment progress'], true FROM tenants WHERE NOT EXISTS (SELECT 1 FROM campaign_story_templates WHERE template_name='Medical Emergency' AND tenant_id=tenants.id) LIMIT 1`,
    `INSERT INTO campaign_story_templates (tenant_id, template_name, category, title_template, story_template, impact_template, goal_suggestion, tips, is_featured) SELECT id, 'School Building Project', 'education', 'Build a Better Future: [School Name] Needs Your Help', '[School Name] serves [number] students in [location] but lacks adequate facilities. Our current [building/classroom] is [condition] and we need to [action]. With your support, we can create a safe and inspiring learning environment for these children.', 'Your donation will provide bricks, cement, roofing, and labor to build a new [facility]. Each [amount] provides enough materials for one section.', 20000000, ARRAY['Include photos of current conditions','Share student enrollment numbers','Provide construction budget breakdown','Show architectural plans if available'], true FROM tenants WHERE NOT EXISTS (SELECT 1 FROM campaign_story_templates WHERE template_name='School Building Project' AND tenant_id=tenants.id) LIMIT 1`,
    `INSERT INTO campaign_story_templates (tenant_id, template_name, category, title_template, story_template, impact_template, goal_suggestion, tips, is_featured) SELECT id, 'Disaster Relief', 'disaster', 'Emergency Relief for [Location] [Disaster Type] Victims', 'A devastating [disaster type] has struck [location], leaving [number] families homeless and in desperate need. Homes, schools, and livelihoods have been destroyed. We are raising funds to provide immediate relief including food, shelter, clean water, and medical supplies.', '100% of donations go directly to relief efforts. UGX [amount] provides a family with a week of food and clean water. UGX [amount] provides temporary shelter for one family.', 10000000, ARRAY['Include recent photos/videos of the disaster','Provide verification from local authorities','Share specific items needed','Update donors on relief distribution'], true FROM tenants WHERE NOT EXISTS (SELECT 1 FROM campaign_story_templates WHERE template_name='Disaster Relief' AND tenant_id=tenants.id) LIMIT 1`,
    `INSERT INTO campaign_story_templates (tenant_id, template_name, category, title_template, story_template, impact_template, goal_suggestion, tips, is_featured) SELECT id, 'Community Development', 'community', 'Transform [Community Name]: [Project Goal]', 'The community of [community name] in [location] faces [challenge]. For years, residents have struggled with [specific problem]. This campaign aims to [solution] which will directly benefit [number] people and create lasting change for generations to come.', 'Your donation helps build [infrastructure/service] that serves [number] people. UGX [amount] provides [specific impact]. This is a sustainable project that will keep giving back.', 15000000, ARRAY['Include community photos and testimonials','Share data on community needs','Provide project timeline','List partnering organizations'], true FROM tenants WHERE NOT EXISTS (SELECT 1 FROM campaign_story_templates WHERE template_name='Community Development' AND tenant_id=tenants.id) LIMIT 1`,
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
    const campaign = (await pool.query('SELECT id, tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    await pool.query('INSERT INTO campaign_shares(campaign_id, shared_by, platform, ip_address) VALUES($1,$2,$3,$4)',
      [req.params.id, req.session?.user?.email || null, platform || 'other', req.ip || null]);
    await pool.query('UPDATE fundraising_campaigns SET total_shares=COALESCE(total_shares,0)+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, campaign.tenant_id]);
    res.json({ success: true });
  }));

  // Track share link click (for analytics)
  app.get('/s/:shareId', ah(async (req, res) => {
    try {
      const share = (await pool.query('SELECT tenant_id FROM campaign_shares WHERE id=$1', [req.params.shareId])).rows[0];
      if (share) await pool.query('UPDATE campaign_shares SET click_count=click_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.shareId, share.tenant_id]);
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

  app.post('/admin/payouts/:id/approve', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='approved', processed_by=$1 WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'payout_approve', 'payout_requests id='+req.params.id);
    res.redirect('/admin/payouts');
  }));

  app.post('/admin/payouts/:id/complete', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='completed', processed_by=$1, processed_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'payout_complete', 'payout_requests id='+req.params.id);
    res.redirect('/admin/payouts');
  }));

  app.post('/admin/payouts/:id/cancel', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE payout_requests SET status='cancelled', processed_by=$1, processed_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'payout_cancel', 'payout_requests id='+req.params.id);
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
      pool.query('SELECT * FROM donor_recognition WHERE campaign_id=$1 AND tenant_id=$2 AND display_on_wall=true ORDER BY total_donated DESC', [req.params.id, c.tenant_id]),
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
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1 AND tenant_id=$2', [donation_id, t])).rows[0];
    if (!donation) return res.status(404).send('Donation not found');
    await pool.query('INSERT INTO refund_requests(tenant_id,donation_id,campaign_id,requested_by,reason,refund_amount) VALUES($1,$2,$3,$4,$5,$6)',
      [t, donation_id, donation.campaign_id, req.session.user.email, reason||'', refund_amount||0]);
    res.redirect('/admin/refunds');
  }));

  app.post('/admin/refunds/:id/approve', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE refund_requests SET status='approved', processed_by=$1 WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'refund_approve', 'refund_requests id='+req.params.id);
    res.redirect('/admin/refunds');
  }));

  app.post('/admin/refunds/:id/reject', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE refund_requests SET status='rejected', processed_by=$1, processed_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'refund_reject', 'refund_requests id='+req.params.id);
    res.redirect('/admin/refunds');
  }));

  app.post('/admin/refunds/:id/complete', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const refund = (await pool.query('SELECT * FROM refund_requests WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (!refund) return res.status(404).send('Not found');
    // Mark refund completed and mark donation as refunded
    await pool.query("UPDATE refund_requests SET status='completed', processed_by=$1, processed_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await pool.query('UPDATE campaign_donations SET refunded=true WHERE id=$1 AND tenant_id=$2', [refund.donation_id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'refund_complete', 'refund_requests id='+req.params.id+' donation_id='+refund.donation_id);
    // Notify donor if email available
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1 AND tenant_id=$2', [refund.donation_id, req.session.user.tenant_id])).rows[0];
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
    await pool.query('UPDATE fundraising_campaigns SET matching_active=true WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/matching');
  }));

  app.post('/campaigns/:campaignId/matching/:id/pause', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE matching_donations SET status='paused' WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'matching_pause', 'matching_donations id='+req.params.id);
    res.redirect('/campaigns/'+req.params.campaignId+'/matching');
  }));

  app.post('/campaigns/:campaignId/matching/:id/resume', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    await pool.query("UPDATE matching_donations SET status='active' WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'matching_resume', 'matching_donations id='+req.params.id);
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
    const result = await pool.query('SELECT id FROM campaign_comments WHERE tenant_id=$1 AND campaign_id=$2 AND user_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, req.session.user.email]);
    if (result.rows[0]) await audit(req.session.user.email, 'comment_created', 'campaign_comments id=' + result.rows[0].id);
    await pool.query('UPDATE fundraising_campaigns SET total_comments=COALESCE(total_comments,0)+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
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
    await pool.query('UPDATE campaign_comments SET likes=likes+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'comment_liked', 'campaign_comments id=' + req.params.id);
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
    await pool.query('UPDATE campaign_donations SET thank_you_sent=true WHERE id=$1 AND tenant_id=$2', [req.params.id, donation.tenant_id]);
    await audit(req.session.user.email, 'thank_you_sent', 'campaign_donations id=' + req.params.id);
    res.json({ success: true, sent: true });
  }));

  // =============================================
  // ENHANCED DONATE-SAVE with Matching + Thank You + Badges
  // (The processDonationEffects function is defined above and exported.
  // server.js donate-save routes call it directly after loading the module.)

  // =============================================
  // BONUS: CAMPAIGN FOLLOWING
  // =============================================
  app.post('/campaigns/:id/follow', requireAuth, ah(async (req, res) => {
    try {
      const t = req.session.user.tenant_id;
      await pool.query('INSERT INTO campaign_followers(tenant_id,campaign_id,user_email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [t, req.params.id, req.session.user.email]);
      const result = await pool.query('SELECT id FROM campaign_followers WHERE tenant_id=$1 AND campaign_id=$2 AND user_email=$3', [t, req.params.id, req.session.user.email]);
      await pool.query('UPDATE fundraising_campaigns SET total_followers=COALESCE(total_followers,0)+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
      if (result.rows[0]) await audit(req.session.user.email, 'campaign_followed', 'campaign_followers id=' + result.rows[0].id);
      await audit(req.session.user.email, 'campaign_follow', 'campaign_followers campaign_id='+req.params.id);
    } catch(e) {}
    res.redirect('back');
  }));

  app.post('/campaigns/:id/unfollow', requireAuth, ah(async (req, res) => {
    try {
      const t = req.session.user.tenant_id;
      await pool.query('DELETE FROM campaign_followers WHERE campaign_id=$1 AND user_email=$2 AND tenant_id=$3', [req.params.id, req.session.user.email, t]);
      await pool.query('UPDATE fundraising_campaigns SET total_followers=GREATEST(COALESCE(total_followers,0)-1,0) WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
      await audit(req.session.user.email, 'campaign_unfollowed', 'campaign_followers id=' + req.params.id);
      await audit(req.session.user.email, 'campaign_unfollow', 'campaign_followers campaign_id='+req.params.id);
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
    const result = await pool.query('SELECT id FROM campaign_testimonials WHERE tenant_id=$1 AND campaign_id=$2 AND author_name=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, author_name]);
    if (result.rows[0]) await audit(req.session.user.email, 'testimonial_created', 'campaign_testimonials id=' + result.rows[0].id);
    await pool.query('UPDATE fundraising_campaigns SET total_testimonials=COALESCE(total_testimonials,0)+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
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
      await pool.query('UPDATE campaign_donations SET receipt_number=$1 WHERE id=$2 AND tenant_id=$3', [receiptNum, donation.id, donation.tenant_id]);
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
    await pool.query('UPDATE fundraising_campaigns SET trust_score=$1, trust_review_count=$2 WHERE id=$3 AND tenant_id=$4', [parseFloat(avg.avg||0).toFixed(2), parseInt(avg.count||0), req.params.id, t]);
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
        }).join('')+'</div>' : '<div style="text-align:center;padding:40px"><p class="muted">No peer fundraisers yet. Be the first to create your own fundraising page!</p>'+(req.session.user?'<a href="/campaigns/'+c.id+'/peer/new" class="btn btn-green" style="margin-top:16px">Start Fundraising</a>':'')+'</div>'}
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
    const t = req.session.user.tenant_id;

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
        await pool.query('UPDATE fundraising_campaigns SET deadline_reminder_sent=true WHERE id=$1 AND tenant_id=$2', [c.id, c.tenant_id]);
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
        await pool.query('UPDATE fundraising_campaigns SET deadline_3day_sent=true WHERE id=$1 AND tenant_id=$2', [c.id, c.tenant_id]);
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
        await pool.query('UPDATE fundraising_campaigns SET deadline_1day_sent=true WHERE id=$1 AND tenant_id=$2', [c.id, c.tenant_id]);
        sent1++;
      } catch(e) {}
    }

    // Mark overdue campaigns
    const overdue = (await pool.query("UPDATE fundraising_campaigns SET status='completed' WHERE deadline < $1 AND status='active' AND tenant_id=$2 RETURNING id", [today, t])).rows;

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
      await pool.query('UPDATE fundraising_campaigns SET gallery_images=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [images, req.params.id, t]);
    }
    if (video_url) {
      const videos = c.video_urls || [];
      videos.push(video_url);
      await pool.query('UPDATE fundraising_campaigns SET video_urls=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [videos, req.params.id, t]);
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
  console.log('[Fundraising V3] Verification Badges, Rewards/Tiers, Wishlists, Volunteers, Endorsements, Donor Streaks, Collaboration, Tipping, Retention Analytics, Success Score, Events, FAQ + All V2 Features');

  // =============================================
  // V3 FEATURE 1: CAMPAIGN VERIFICATION BADGE
  // =============================================

  // Submit verification request
  app.get('/campaigns/:id/verify', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const existing = (await pool.query('SELECT * FROM campaign_verifications WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 1', [req.params.id])).rows[0];
    res.send(renderPage('Verify Campaign', `
      <div style="max-width:700px;margin:0 auto;padding:20px">
        <div style="background:linear-gradient(135deg,#059669,#10b981);padding:30px;border-radius:16px;color:white;text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">&#9989;</div>
          <h1>Campaign Verification</h1>
          <p>Get a verified badge to build trust and attract more donors</p>
        </div>
        ${existing ? '<div class="card" style="margin-bottom:20px;border-left:4px solid '+(existing.status==='approved'?'#059669':existing.status==='pending'?'#f59e0b':'#ef4444')+'"><h4>Current Status: <span style="color:'+(existing.status==='approved'?'#059669':existing.status==='pending'?'#f59e0b':'#ef4444')+'">'+esc(existing.status.toUpperCase())+'</span></h4>'+(existing.badge_level!=='none'?'<p>Badge Level: <strong>'+esc(existing.badge_level)+'</strong></p>':'')+(existing.admin_notes?'<p>Admin Notes: '+esc(existing.admin_notes)+'</p>':'')+'</div>' : ''}
        <div class="card">
          <h3>Why Get Verified?</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:16px 0">
            <div style="text-align:center;padding:16px;background:#f0fdf4;border-radius:12px"><div style="font-size:32px">&#128176;</div><strong>More Donations</strong><br><span style="font-size:13px;color:#64748b">Verified campaigns raise 3x more</span></div>
            <div style="text-align:center;padding:16px;background:#eff6ff;border-radius:12px"><div style="font-size:32px">&#127760;</div><strong>Global Visibility</strong><br><span style="font-size:13px;color:#64748b">Featured in discovery results</span></div>
            <div style="text-align:center;padding:16px;background:#fef3c7;border-radius:12px"><div style="font-size:32px">&#11088;</div><strong>Trust Badge</strong><br><span style="font-size:13px;color:#64748b">Donors trust verified campaigns</span></div>
          </div>
        </div>
        <form method="POST" action="/campaigns/${req.params.id}/verify-save" class="card">
          <h3>Submit Verification</h3>
          <label>Verification Type</label>
          <select name="verification_type">
            <option value="standard">Standard Verification</option>
            <option value="enhanced">Enhanced (with documents)</option>
            <option value="premium">Premium (full audit)</option>
            <option value="government">Government Registered</option>
            <option value="ngo_registered">NGO Registered</option>
          </select>
          <label>Supporting Documents (describe what you can provide)</label>
          <textarea name="notes" rows="4" placeholder="E.g., Registration certificate, bank statements, ID copies, project proposal, etc."></textarea>
          <label>Organization Contact Person</label>
          <input name="contact_person" placeholder="Full name" required>
          <label>Contact Phone</label>
          <input name="contact_phone" placeholder="+256 xxx xxx xxx">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Submit Verification Request</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/verify-save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { verification_type, notes, contact_person, contact_phone } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_verifications(tenant_id,campaign_id,verification_type,submitted_by,notes) VALUES($1,$2,$3,$4,$5)',
      [t, req.params.id, verification_type||'standard', req.session.user.email, notes||'']);
    await pool.query('UPDATE fundraising_campaigns SET is_verified=true WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/verify');
  }));

  // Admin approve verification
  app.post('/admin/verifications/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { badge_level } = req.query;
    await pool.query('UPDATE campaign_verifications SET status=$1,badge_level=$2,reviewed_by=$3,reviewed_at=NOW(),verified_at=NOW() WHERE id=$4 AND tenant_id=$5',
      ['approved', badge_level||'verified', req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'verification_approve', 'campaign_verifications id='+req.params.id);
    const v = (await pool.query('SELECT campaign_id FROM campaign_verifications WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (v) await pool.query('UPDATE fundraising_campaigns SET is_verified=true,verification_badge=$1 WHERE id=$2 AND tenant_id=$3', [badge_level||'verified', v.campaign_id, req.session.user.tenant_id]);
    res.redirect('/admin/verifications');
  }));

  // Admin list verifications
  app.get('/admin/verifications', requireAuth, requireNotBanned, ah(async (req, res) => {
    const verifications = (await pool.query('SELECT cv.*, fc.title as campaign_title FROM campaign_verifications cv JOIN fundraising_campaigns fc ON cv.campaign_id=fc.id WHERE cv.tenant_id=$1 ORDER BY cv.created_at DESC', [req.session.user.tenant_id])).rows;
    res.send(renderPage('Campaign Verifications', `
      <div class="card"><h3>Campaign Verifications</h3>
      <table><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Badge</th><th>Submitted</th><th>Actions</th></tr>
      ${verifications.map(v => '<tr><td>'+esc(v.campaign_title)+'</td><td>'+esc(v.verification_type)+'</td><td><span class="tag" style="background:'+(v.status==='approved'?'#d1fae5;color:#065f46':v.status==='pending'?'#fef3c7;color:#92400e':'#fee2e2;color:#991b1b')+'">'+esc(v.status)+'</span></td><td>'+esc(v.badge_level)+'</td><td>'+new Date(v.created_at).toLocaleDateString()+'</td><td>'+(v.status==='pending'?'<a href="/admin/verifications/'+v.id+'/approve?badge_level=verified" class="btn btn-sm btn-green">Approve</a> <a href="/admin/verifications/'+v.id+'/approve?badge_level=trusted" class="btn btn-sm" style="background:#4f46e5;color:white">Trusted</a> <a href="/admin/verifications/'+v.id+'/approve?badge_level=gold" class="btn btn-sm" style="background:#f59e0b;color:white">Gold</a>':'Approved')+'</td></tr>').join('')||'<tr><td colspan="6">No verifications yet</td></tr>'}
      </table></div>
    `, req.session.user));
  }));

  // API: Get verification status for a campaign
  app.get('/api/campaigns/:id/verification', ah(async (req, res) => {
    const v = (await pool.query('SELECT status, badge_level, verified_at FROM campaign_verifications WHERE campaign_id=$1 AND status=$2 ORDER BY verified_at DESC LIMIT 1', [req.params.id, 'approved'])).rows[0];
    res.json(v || { status: 'none', badge_level: 'none' });
  }));

  // =============================================
  // V3 FEATURE 2: DONATION REWARDS / TIERS
  // =============================================

  // View reward tiers for a campaign
  app.get('/campaigns/:id/rewards', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const rewards = (await pool.query('SELECT * FROM campaign_reward_tiers WHERE campaign_id=$1 AND is_active=true ORDER BY min_amount ASC', [req.params.id])).rows;
    res.send(renderPage('Rewards - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Rewards for "${esc(c.title)}"</h1>
          <p style="color:#64748b">Donate and receive exclusive rewards!</p>
        </div>
        ${rewards.length > 0 ? '<div style="display:grid;gap:20px">' + rewards.map(r => {
          const pct = r.quantity_available ? Math.round(parseInt(r.quantity_claimed||0)/parseInt(r.quantity_available)*100) : 0;
          return '<div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border:2px solid '+(r.min_amount>=1000000?'#f59e0b':r.min_amount>=500000?'#7c3aed':r.min_amount>=100000?'#059669':'#4f46e5')+'"><div style="display:flex;justify-content:space-between;align-items:start"><div><h3 style="font-size:20px;font-weight:700">'+esc(r.title)+'</h3><p style="color:#64748b;margin:8px 0">'+esc(r.description||'')+'</p></div><div style="text-align:right"><div style="font-size:24px;font-weight:800;color:#059669">UGX '+parseInt(r.min_amount).toLocaleString()+'</div>'+(r.max_amount?'<div style="font-size:13px;color:#64748b">to UGX '+parseInt(r.max_amount).toLocaleString()+'</div>':'')+'</div></div><div style="display:flex;gap:8px;margin-top:12px"><span class="tag" style="background:#e0e7ff;color:#3730a3">'+esc(r.reward_type)+'</span>'+(r.quantity_available?'<span class="tag" style="background:#fef3c7;color:#92400e">'+parseInt(r.quantity_claimed||0)+'/'+parseInt(r.quantity_available)+' claimed</span>':'<span class="tag" style="background:#d1fae5;color:#065f46">Unlimited</span>')+(r.estimated_delivery?'<span class="tag" style="background:#f0fdf4;color:#065f46">Delivery: '+new Date(r.estimated_delivery).toLocaleDateString()+'</span>':'')+'</div>'+(c.status==='active'?'<a href="/discover/'+c.id+'/donate" style="display:block;margin-top:12px;text-align:center;padding:10px;background:#059669;color:white;border-radius:10px;font-weight:700;text-decoration:none">Donate to Get This Reward</a>':'')+'</div>';
        }).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#127873;</div><h3>No Rewards Available Yet</h3><p style="color:#64748b">The campaign organizer has not set up rewards yet.</p></div>'}
        ${req.session.user && c.tenant_id === req.session.user.tenant_id ? '<a href="/campaigns/'+c.id+'/rewards/manage" class="btn" style="margin-top:20px;background:#4f46e5;color:white">Manage Rewards</a>' : ''}
      </div>
    `, req.session.user));
  }));

  // Manage reward tiers
  app.get('/campaigns/:id/rewards/manage', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const rewards = (await pool.query('SELECT * FROM campaign_reward_tiers WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY sort_order, min_amount', [req.params.id, req.session.user.tenant_id])).rows;
    res.send(renderPage('Manage Rewards', `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Manage Reward Tiers</h2>
          <a href="/campaigns/${req.params.id}/rewards/new" class="btn btn-green">Add Reward Tier</a>
        </div>
        <div class="card">
          <table><tr><th>Title</th><th>Min Amount</th><th>Type</th><th>Claimed</th><th>Status</th><th>Actions</th></tr>
          ${rewards.map(r => '<tr><td><strong>'+esc(r.title)+'</strong></td><td>UGX '+parseInt(r.min_amount).toLocaleString()+'</td><td>'+esc(r.reward_type)+'</td><td>'+parseInt(r.quantity_claimed||0)+(r.quantity_available?'/'+parseInt(r.quantity_available):'')+'</td><td><span class="tag" style="background:'+(r.is_active?'#d1fae5;color:#065f46':'#fee2e2;color:#991b1b')+'">'+(r.is_active?'Active':'Inactive')+'</span></td><td><a href="/campaigns/'+req.params.id+'/rewards/'+r.id+'/claims" class="btn btn-sm">Claims</a></td></tr>').join('')||'<tr><td colspan="6">No reward tiers yet. Add one to incentivize donors!</td></tr>'}
          </table>
        </div>
      </div>
    `, req.session.user));
  }));

  // New reward tier form
  app.get('/campaigns/:id/rewards/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Add Reward Tier', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/rewards/save" class="card">
          <h2>Add Reward Tier</h2>
          <label>Reward Title</label><input name="title" placeholder="e.g., Bronze Supporter" required>
          <label>Description</label><textarea name="description" rows="3" placeholder="What the donor receives"></textarea>
          <label>Minimum Amount (UGX)</label><input name="min_amount" type="number" placeholder="100000" required>
          <label>Maximum Amount (UGX, optional)</label><input name="max_amount" type="number" placeholder="Leave blank for no max">
          <label>Reward Type</label>
          <select name="reward_type"><option value="digital">Digital (e.g., certificate, shout-out)</option><option value="physical">Physical (e.g., t-shirt, mug)</option><option value="experience">Experience (e.g., dinner, tour)</option><option value="recognition">Recognition (e.g., named on wall)</option><option value="custom">Custom</option></select>
          <label>Quantity Available (leave blank for unlimited)</label><input name="quantity_available" type="number" placeholder="100">
          <label>Estimated Delivery Date</label><input name="estimated_delivery" type="date">
          <label>Sort Order</label><input name="sort_order" type="number" value="0">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Create Reward Tier</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/rewards/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { title, description, min_amount, max_amount, reward_type, quantity_available, estimated_delivery, sort_order } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_reward_tiers(tenant_id,campaign_id,title,description,min_amount,max_amount,reward_type,quantity_available,estimated_delivery,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [t, req.params.id, title, description||'', min_amount, max_amount||null, reward_type||'digital', quantity_available||null, estimated_delivery||null, sort_order||0]);
    await pool.query('UPDATE fundraising_campaigns SET has_rewards=true, reward_tiers_count=(SELECT COUNT(*) FROM campaign_reward_tiers WHERE campaign_id=$1 AND is_active=true) WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/rewards/manage');
  }));

  // View reward claims
  app.get('/campaigns/:campaignId/rewards/:rewardId/claims', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const claims = (await pool.query('SELECT rc.*, crt.title as reward_title FROM reward_claims rc JOIN campaign_reward_tiers crt ON rc.reward_tier_id=crt.id WHERE rc.reward_tier_id=$1 AND rc.tenant_id=$2 ORDER BY rc.claimed_at DESC', [req.params.rewardId, req.session.user.tenant_id])).rows;
    res.send(renderPage('Reward Claims', `
      <div class="card"><h3>Reward Claims</h3>
      <table><tr><th>Donor</th><th>Status</th><th>Claimed</th><th>Actions</th></tr>
      ${claims.map(cl => '<tr><td>'+esc(cl.donor_name)+'<br><span style="font-size:12px;color:#64748b">'+esc(cl.donor_email||'')+'</span></td><td><span class="tag" style="background:'+({pending:'#fef3c7;color:#92400e',confirmed:'#e0e7ff;color:#3730a3',shipped:'#f0fdf4;color:#065f46',delivered:'#d1fae5;color:#065f46',cancelled:'#fee2e2;color:#991b1b'}[cl.claim_status]||'#f1f5f9')+'">'+esc(cl.claim_status)+'</span></td><td>'+new Date(cl.claimed_at).toLocaleDateString()+'</td><td>'+(cl.claim_status==='pending'?'<a href="/campaigns/rewards/claims/'+cl.id+'/confirm" class="btn btn-sm btn-green">Confirm</a>':'')+(cl.claim_status==='confirmed'?'<a href="/campaigns/rewards/claims/'+cl.id+'/ship" class="btn btn-sm" style="background:#4f46e5;color:white">Mark Shipped</a>':'')+(cl.claim_status==='shipped'?'<a href="/campaigns/rewards/claims/'+cl.id+'/deliver" class="btn btn-sm btn-green">Mark Delivered</a>':'')+'</td></tr>').join('')||'<tr><td colspan="4">No claims yet</td></tr>'}
      </table></div>
    `, req.session.user));
  }));

  app.post('/campaigns/rewards/claims/:id/confirm', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE reward_claims SET claim_status='confirmed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'reward_confirm', 'reward_claims id='+req.params.id);
    res.redirect('back');
  }));
  app.post('/campaigns/rewards/claims/:id/ship', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE reward_claims SET claim_status='shipped', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'reward_ship', 'reward_claims id='+req.params.id);
    res.redirect('back');
  }));
  app.post('/campaigns/rewards/claims/:id/deliver', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE reward_claims SET claim_status='delivered', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'reward_deliver', 'reward_claims id='+req.params.id);
    res.redirect('back');
  }));

  // =============================================
  // V3 FEATURE 3: CAMPAIGN WISHLISTS
  // =============================================

  app.get('/campaigns/:id/wishlist', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const items = (await pool.query('SELECT * FROM campaign_wishlists WHERE campaign_id=$1 ORDER BY priority DESC, created_at', [req.params.id])).rows;
    const priorityColors = { low:'#94a3b8', medium:'#0891b2', high:'#f59e0b', urgent:'#ef4444' };
    res.send(renderPage('Wishlist - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Campaign Wishlist</h1>
          <p style="color:#64748b">Help by providing specific items needed for "${esc(c.title)}"</p>
        </div>
        ${items.length > 0 ? '<div style="display:grid;gap:16px">' + items.map(i => {
          const fulfilledPct = i.quantity_needed > 0 ? Math.round(parseInt(i.quantity_fulfilled||0)/parseInt(i.quantity_needed)*100) : 0;
          return '<div style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-left:4px solid '+(priorityColors[i.priority]||'#94a3b8')+'"><div style="display:flex;justify-content:space-between;align-items:start"><div><h3 style="font-weight:700">'+esc(i.item_name)+'</h3>'+(i.description?'<p style="color:#64748b;font-size:14px;margin:4px 0">'+esc(i.description)+'</p>':'')+'</div><div style="text-align:right"><span class="tag" style="background:'+priorityColors[i.priority]+'20;color:'+priorityColors[i.priority]+'">'+esc(i.priority)+'</span><div style="margin-top:8px;font-size:20px;font-weight:800;color:#059669">'+parseInt(i.quantity_fulfilled||0)+'/'+parseInt(i.quantity_needed)+'</div></div></div><div style="background:#e2e8f0;height:8px;border-radius:4px;margin:12px 0"><div style="background:linear-gradient(90deg,#059669,#10b981);height:8px;border-radius:4px;width:'+fulfilledPct+'%"></div></div>'+(i.estimated_cost?'<div style="font-size:13px;color:#64748b">Est. cost: UGX '+parseInt(i.estimated_cost).toLocaleString()+' each</div>':'')+(i.is_fulfilled?'<div style="margin-top:8px;padding:8px;background:#d1fae5;color:#065f46;border-radius:8px;text-align:center;font-weight:700">Fully Fulfilled!</div>':(req.session.user?'<a href="/campaigns/'+c.id+'/wishlist/'+i.id+'/pledge" style="display:block;margin-top:8px;text-align:center;padding:8px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700">Pledge to Provide</a>':''))+'</div>';
        }).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#128221;</div><h3>No Wishlist Items</h3><p style="color:#64748b">The organizer has not added specific items needed yet.</p></div>'}
        ${req.session.user && c.tenant_id === req.session.user.tenant_id ? '<a href="/campaigns/'+c.id+'/wishlist/manage" class="btn" style="margin-top:20px;background:#4f46e5;color:white">Manage Wishlist</a>' : ''}
      </div>
    `, req.session.user));
  }));

  // Pledge to provide a wishlist item
  app.get('/campaigns/:campaignId/wishlist/:itemId/pledge', requireAuth, ah(async (req, res) => {
    const item = (await pool.query('SELECT * FROM campaign_wishlists WHERE id=$1 AND tenant_id=$2', [req.params.itemId, req.session.user.tenant_id])).rows[0];
    if (!item) return res.status(404).send('Item not found');
    res.send(renderPage('Pledge Item', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.campaignId}/wishlist/${req.params.itemId}/pledge-save" class="card">
          <h2>Pledge: ${esc(item.item_name)}</h2>
          <p style="color:#64748b">${parseInt(item.quantity_fulfilled||0)} of ${parseInt(item.quantity_needed)} needed</p>
          <label>Your Name</label><input name="pledger_name" value="${esc(req.session.user?.name||'')}" required>
          <label>Email</label><input name="pledger_email" value="${esc(req.session.user?.email||'')}" required>
          <label>Phone</label><input name="pledger_phone" placeholder="+256 xxx xxx xxx">
          <label>Quantity You Will Provide</label><input name="quantity_pledged" type="number" min="1" max="${parseInt(item.quantity_needed)-parseInt(item.quantity_fulfilled||0)}" value="1" required>
          <label>Message (optional)</label><textarea name="message" rows="2" placeholder="Any details about your pledge"></textarea>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Pledge to Provide</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:campaignId/wishlist/:itemId/pledge-save', requireAuth, ah(async (req, res) => {
    const { pledger_name, pledger_email, pledger_phone, quantity_pledged, message } = req.body;
    const t = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.campaignId])).rows[0]?.tenant_id;
    await pool.query('INSERT INTO wishlist_pledges(tenant_id,wishlist_id,campaign_id,pledger_name,pledger_email,pledger_phone,quantity_pledged,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, req.params.itemId, req.params.campaignId, pledger_name, pledger_email, pledger_phone, quantity_pledged, message||'']);
    const result = await pool.query('SELECT id FROM wishlist_pledges WHERE tenant_id=$1 AND wishlist_id=$2 AND pledger_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.itemId, pledger_email]);
    if (result.rows[0]) await audit(req.session.user.email, 'wishlist_pledge_created', 'campaign_wishlist_pledges id=' + result.rows[0].id);
    await pool.query('UPDATE campaign_wishlists SET quantity_fulfilled=quantity_fulfilled+$1 WHERE id=$2 AND tenant_id=$3', [quantity_pledged, req.params.itemId, t]);
    await pool.query('UPDATE campaign_wishlists SET is_fulfilled=true WHERE id=$1 AND quantity_fulfilled>=quantity_needed AND tenant_id=$2', [req.params.itemId, t]);
    res.redirect('/campaigns/'+req.params.campaignId+'/wishlist');
  }));

  // Manage wishlist (organizer view)
  app.get('/campaigns/:id/wishlist/manage', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const items = (await pool.query('SELECT cw.*, (SELECT COUNT(*) FROM wishlist_pledges WHERE wishlist_id=cw.id) as pledge_count FROM campaign_wishlists cw WHERE cw.campaign_id=$1 AND cw.tenant_id=$2 ORDER BY priority DESC', [req.params.id, req.session.user.tenant_id])).rows;
    res.send(renderPage('Manage Wishlist', `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Manage Wishlist</h2>
          <a href="/campaigns/${req.params.id}/wishlist/new" class="btn btn-green">Add Item</a>
        </div>
        <div class="card">
          <table><tr><th>Item</th><th>Needed</th><th>Fulfilled</th><th>Priority</th><th>Pledges</th><th>Status</th></tr>
          ${items.map(i => '<tr><td><strong>'+esc(i.item_name)+'</strong></td><td>'+parseInt(i.quantity_needed)+'</td><td>'+parseInt(i.quantity_fulfilled||0)+'</td><td>'+esc(i.priority)+'</td><td>'+parseInt(i.pledge_count||0)+'</td><td>'+(i.is_fulfilled?'<span style="color:#059669;font-weight:700">Fulfilled</span>':'In Progress')+'</td></tr>').join('')||'<tr><td colspan="6">No items yet</td></tr>'}
          </table>
        </div>
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/wishlist/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Add Wishlist Item', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/wishlist/save" class="card">
          <h2>Add Item to Wishlist</h2>
          <label>Item Name</label><input name="item_name" placeholder="e.g., Textbooks, Medical Supplies" required>
          <label>Description</label><textarea name="description" rows="2" placeholder="Details about the item"></textarea>
          <label>Quantity Needed</label><input name="quantity_needed" type="number" value="1" required>
          <label>Estimated Cost per Unit (UGX)</label><input name="estimated_cost" type="number" placeholder="50000">
          <label>Category</label>
          <select name="category"><option value="supplies">Supplies</option><option value="equipment">Equipment</option><option value="food">Food</option><option value="clothing">Clothing</option><option value="medical">Medical</option><option value="technology">Technology</option><option value="building_materials">Building Materials</option><option value="services">Services</option><option value="other">Other</option></select>
          <label>Priority</label>
          <select name="priority"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select>
          <label>Image URL (optional)</label><input name="image_url" placeholder="https://...">
          <label>Purchase Link (optional)</label><input name="link" placeholder="https://...">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Add Item</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/wishlist/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { item_name, description, quantity_needed, estimated_cost, category, priority, image_url, link } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_wishlists(tenant_id,campaign_id,item_name,description,quantity_needed,estimated_cost,category,priority,image_url,link) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [t, req.params.id, item_name, description||'', quantity_needed, estimated_cost||0, category||'supplies', priority||'medium', image_url||null, link||null]);
    await pool.query('UPDATE fundraising_campaigns SET has_wishlist=true, wishlist_items_count=(SELECT COUNT(*) FROM campaign_wishlists WHERE campaign_id=$1) WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/wishlist/manage');
  }));

  // =============================================
  // V3 FEATURE 4: VOLUNTEER SIGN-UPS
  // =============================================

  app.get('/campaigns/:id/volunteers', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const volunteers = (await pool.query("SELECT * FROM campaign_volunteers WHERE campaign_id=$1 AND status IN ('approved','active') ORDER BY created_at DESC", [req.params.id])).rows;
    const pending = req.session.user ? (await pool.query("SELECT id FROM campaign_volunteers WHERE campaign_id=$1 AND volunteer_email=$2 AND status='pending'", [req.params.id, req.session.user.email])).rows : [];
    res.send(renderPage('Volunteers - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Volunteer for "${esc(c.title)}"</h1>
          <p style="color:#64748b">Your time and skills can make a real difference!</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#4f46e5">${volunteers.length}</div><div style="color:#64748b">Active Volunteers</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#059669">${volunteers.reduce((a,v) => a+parseInt(v.hours_pledged||0), 0)}</div><div style="color:#64748b">Hours Pledged</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#f59e0b">${volunteers.reduce((a,v) => a+parseInt(v.hours_completed||0), 0)}</div><div style="color:#64748b">Hours Completed</div></div>
        </div>
        ${req.session.user && !pending.length ? '<a href="/campaigns/'+c.id+'/volunteers/sign-up" style="display:block;margin-bottom:24px;padding:16px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-align:center;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Sign Up to Volunteer</a>' : ''}
        ${volunteers.length > 0 ? '<div class="card"><h3>Our Volunteers</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">' + volunteers.map(v => '<div style="padding:12px;background:#f8fafc;border-radius:10px;text-align:center"><div style="font-weight:700">'+esc(v.volunteer_name)+'</div>'+(v.role?'<div style="font-size:13px;color:#64748b">'+esc(v.role)+'</div>':'')+'<div style="font-size:12px;color:#059669">'+parseInt(v.hours_pledged||0)+'h pledged</div></div>').join('') + '</div></div>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/volunteers/sign-up', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Volunteer Sign Up', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/volunteers/save" class="card">
          <h2>Volunteer Sign Up</h2>
          <label>Full Name</label><input name="volunteer_name" value="${esc(req.session.user?.name||'')}" required>
          <label>Email</label><input name="volunteer_email" value="${esc(req.session.user?.email||'')}" required>
          <label>Phone</label><input name="volunteer_phone" placeholder="+256 xxx xxx xxx">
          <label>Skills (comma-separated)</label><input name="skills" placeholder="e.g., teaching, construction, medical, IT">
          <label>Availability</label>
          <select name="availability"><option value="flexible">Flexible</option><option value="weekdays">Weekdays Only</option><option value="weekends">Weekends Only</option><option value="mornings">Mornings</option><option value="evenings">Evenings</option><option value="full_time">Full Time</option></select>
          <label>Hours You Can Pledge</label><input name="hours_pledged" type="number" placeholder="10" value="10">
          <label>Preferred Role (optional)</label><input name="role" placeholder="e.g., Teacher, Coordinator, Driver">
          <label>Why do you want to volunteer?</label><textarea name="motivation" rows="3" placeholder="Tell us about your motivation"></textarea>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Sign Up to Volunteer</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/volunteers/save', requireAuth, ah(async (req, res) => {
    const { volunteer_name, volunteer_email, volunteer_phone, skills, availability, hours_pledged, role, motivation } = req.body;
    const t = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0]?.tenant_id;
    await pool.query('INSERT INTO campaign_volunteers(tenant_id,campaign_id,volunteer_name,volunteer_email,volunteer_phone,skills,availability,hours_pledged,role,motivation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [t, req.params.id, volunteer_name, volunteer_email, volunteer_phone||null, skills ? skills.split(',').map(s=>s.trim()) : [], availability||'flexible', hours_pledged||0, role||null, motivation||'']);
    const result = await pool.query('SELECT id FROM campaign_volunteers WHERE tenant_id=$1 AND campaign_id=$2 AND volunteer_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, volunteer_email]);
    if (result.rows[0]) await audit(req.session.user.email, 'volunteer_signed_up', 'campaign_volunteers id=' + result.rows[0].id);
    await pool.query('UPDATE fundraising_campaigns SET has_volunteers=true, volunteer_count=(SELECT COUNT(*) FROM campaign_volunteers WHERE campaign_id=$1 AND status IN ($2,$3)) WHERE id=$1 AND tenant_id=$4', [req.params.id, 'approved', 'active', t]);
    res.redirect('/campaigns/'+req.params.id+'/volunteers');
  }));

  // Admin manage volunteers
  app.get('/campaigns/:id/volunteers/manage', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const volunteers = (await pool.query('SELECT * FROM campaign_volunteers WHERE campaign_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, req.session.user.tenant_id])).rows;
    res.send(renderPage('Manage Volunteers', `
      <div class="card"><h3>Manage Volunteers</h3>
      <table><tr><th>Name</th><th>Skills</th><th>Hours</th><th>Status</th><th>Actions</th></tr>
      ${volunteers.map(v => '<tr><td>'+esc(v.volunteer_name)+'<br><span style="font-size:12px;color:#64748b">'+esc(v.volunteer_email)+'</span></td><td>'+(v.skills||[]).map(s=>'<span class="tag" style="background:#e0e7ff;color:#3730a3">'+esc(s)+'</span>').join(' ')+'</td><td>'+parseInt(v.hours_pledged||0)+'h / '+parseInt(v.hours_completed||0)+'h</td><td><span class="tag" style="background:'+({pending:'#fef3c7;color:#92400e',approved:'#d1fae5;color:#065f46',active:'#e0e7ff;color:#3730a3',completed:'#f0fdf4;color:#065f46',declined:'#fee2e2;color:#991b1b'}[v.status]||'#f1f5f9')+'">'+esc(v.status)+'</span></td><td>'+(v.status==='pending'?'<a href="/campaigns/volunteers/'+v.id+'/approve" class="btn btn-sm btn-green">Approve</a> <a href="/campaigns/volunteers/'+v.id+'/decline" class="btn btn-sm" style="background:#ef4444;color:white">Decline</a>':'')+(v.status==='approved'?'<a href="/campaigns/volunteers/'+v.id+'/activate" class="btn btn-sm" style="background:#4f46e5;color:white">Activate</a>':'')+'</td></tr>').join('')||'<tr><td colspan="5">No volunteers yet</td></tr>'}
      </table></div>
    `, req.session.user));
  }));

  app.post('/campaigns/volunteers/:id/approve', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE campaign_volunteers SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'volunteer_approve', 'campaign_volunteers id='+req.params.id);
    res.redirect('back');
  }));
  app.post('/campaigns/volunteers/:id/decline', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE campaign_volunteers SET status='declined' WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'volunteer_decline', 'campaign_volunteers id='+req.params.id);
    res.redirect('back');
  }));
  app.post('/campaigns/volunteers/:id/activate', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE campaign_volunteers SET status='active', started_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.session.user.tenant_id]);
    await audit(req.session.user.email, 'volunteer_activate', 'campaign_volunteers id='+req.params.id);
    res.redirect('back');
  }));

  // =============================================
  // V3 FEATURE 5: CAMPAIGN ENDORSEMENTS
  // =============================================

  app.get('/campaigns/:id/endorsements', ah(async (req, res) => {
    const endorsements = (await pool.query('SELECT * FROM campaign_endorsements WHERE campaign_id=$1 AND is_public=true ORDER BY is_featured DESC, created_at DESC', [req.params.id])).rows;
    res.send(renderPage('Endorsements', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <h2 style="text-align:center;margin-bottom:24px">Endorsements</h2>
        ${endorsements.length > 0 ? endorsements.map(e => '<div style="background:white;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06)'+(e.is_featured?';border:2px solid #f59e0b':'')+'"><div style="display:flex;gap:16px;align-items:start">'+(e.endorser_photo?'<img src="'+esc(e.endorser_photo)+'" style="width:60px;height:60px;border-radius:50%;object-fit:cover">':'<div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:white;font-size:24px;font-weight:700">'+esc((e.endorser_name||'A')[0])+'</div>')+'<div><div style="font-weight:700;font-size:16px">'+esc(e.endorser_name)+'</div>'+(e.endorser_title?'<div style="font-size:13px;color:#64748b">'+esc(e.endorser_title)+(e.endorser_organization?' at '+esc(e.endorser_organization):'')+'</div>':'')+'<p style="margin-top:8px;color:#475569;font-style:italic">"'+esc(e.endorsement_text)+'"</p></div></div>'+(e.is_verified?'<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">Verified</span>':'')+'</div>').join('') : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#11088;</div><h3>No Endorsements Yet</h3><p style="color:#64748b">Be the first to endorse this campaign!</p></div>'}
        ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/endorsements/new" style="display:block;margin-top:20px;padding:16px;background:#4f46e5;color:white;text-align:center;border-radius:12px;text-decoration:none;font-weight:700">Write an Endorsement</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/endorsements/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Write Endorsement', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/endorsements/save" class="card">
          <h2>Write an Endorsement</h2>
          <p style="color:#64748b">Share why you support this campaign</p>
          <label>Your Name</label><input name="endorser_name" value="${esc(req.session.user?.name||'')}" required>
          <label>Your Title (optional)</label><input name="endorser_title" placeholder="e.g., CEO, Pastor, Teacher">
          <label>Organization (optional)</label><input name="endorser_organization" placeholder="e.g., ABC Foundation">
          <label>Endorsement</label><textarea name="endorsement_text" rows="4" placeholder="Why do you endorse this campaign? What impact will it have?" required></textarea>
          <label>Photo URL (optional)</label><input name="endorser_photo" placeholder="https://...">
          <label>Email (for verification)</label><input name="endorser_email" value="${esc(req.session.user?.email||'')}">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Submit Endorsement</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/endorsements/save', requireAuth, ah(async (req, res) => {
    const { endorser_name, endorser_title, endorser_organization, endorser_photo, endorser_email, endorsement_text } = req.body;
    const t = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0]?.tenant_id;
    await pool.query('INSERT INTO campaign_endorsements(tenant_id,campaign_id,endorser_name,endorser_title,endorser_organization,endorser_photo,endorser_email,endorsement_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, req.params.id, endorser_name, endorser_title||null, endorser_organization||null, endorser_photo||null, endorser_email||null, endorsement_text]);
    const result = await pool.query('SELECT id FROM campaign_endorsements WHERE tenant_id=$1 AND campaign_id=$2 AND endorser_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, endorser_email||null]);
    if (result.rows[0]) await audit(req.session.user.email, 'endorsement_created', 'campaign_endorsements id=' + result.rows[0].id);
    await pool.query('UPDATE fundraising_campaigns SET endorsement_count=(SELECT COUNT(*) FROM campaign_endorsements WHERE campaign_id=$1 AND is_public=true) WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/endorsements');
  }));

  // =============================================
  // V3 FEATURE 6: DONOR STREAKS & GAMIFICATION
  // =============================================

  // Update donor streak after donation (called from processDonationEffects)
  async function updateDonorStreak(tenant_id, donor_email, donation_date) {
    if (!donor_email) return;
    const today = donation_date ? new Date(donation_date) : new Date();
    const monthKey = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0');
    try {
      const existing = (await pool.query('SELECT * FROM donor_streaks WHERE tenant_id=$1 AND donor_email=$2 AND streak_type=$3', [tenant_id, donor_email, 'monthly'])).rows[0];
      if (existing) {
        const lastDate = existing.last_donation_date ? new Date(existing.last_donation_date) : null;
        const lastMonth = lastDate ? lastDate.getFullYear() + '-' + String(lastDate.getMonth()+1).padStart(2,'0') : null;
        if (lastMonth === monthKey) {
          // Same month, just update total
          await pool.query('UPDATE donor_streaks SET total_streak_donations=total_streak_donations+1, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [existing.id, tenant_id]);
        } else {
          // Check if consecutive month
          const isConsecutive = lastDate && (today.getFullYear() === lastDate.getFullYear() && today.getMonth() === lastDate.getMonth() + 1 || today.getFullYear() === lastDate.getFullYear() + 1 && today.getMonth() === 0 && lastDate.getMonth() === 11);
          if (isConsecutive) {
            const newStreak = existing.current_streak + 1;
            await pool.query('UPDATE donor_streaks SET current_streak=$1, longest_streak=GREATEST(longest_streak,$1), last_donation_date=$2, total_streak_donations=total_streak_donations+1, updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
              [newStreak, today, existing.id, tenant_id]);
          } else {
            // Streak broken, restart
            await pool.query('UPDATE donor_streaks SET current_streak=1, last_donation_date=$1, streak_start_date=$1, total_streak_donations=total_streak_donations+1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
              [today, existing.id, tenant_id]);
          }
        }
      } else {
        await pool.query('INSERT INTO donor_streaks(tenant_id,donor_email,current_streak,longest_streak,last_donation_date,streak_type,total_streak_donations,streak_start_date) VALUES($1,$2,1,1,$3,$4,1,$3)',
          [tenant_id, donor_email, today, 'monthly']);
      }
    } catch(e) { console.warn('[Streak Error]', e.message); }
  }

  // API: Get donor streak info
  app.get('/api/donor-streak', requireAuth, ah(async (req, res) => {
    const streak = (await pool.query('SELECT * FROM donor_streaks WHERE tenant_id=$1 AND donor_email=$2', [req.session.user.tenant_id, req.session.user.email])).rows[0];
    res.json(streak || { current_streak: 0, longest_streak: 0 });
  }));

  // Public donor leaderboard
  app.get('/donor-leaderboard', ah(async (req, res) => {
    const { period } = req.query;
    let dateFilter = '';
    if (period === 'month') dateFilter = " AND donated_at >= NOW() - INTERVAL '30 days'";
    else if (period === 'week') dateFilter = " AND donated_at >= NOW() - INTERVAL '7 days'";
    const topDonors = (await pool.query('SELECT donor_name, donor_email, COUNT(*) as donation_count, SUM(amount) as total_donated, COUNT(DISTINCT campaign_id) as campaigns FROM campaign_donations WHERE is_anonymous=false AND refunded=false' + dateFilter + ' GROUP BY donor_name, donor_email ORDER BY total_donated DESC LIMIT 50')).rows;
    res.send(renderPage('Donor Leaderboard', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Donor Leaderboard</h1>
          <p style="color:#64748b">Our most generous supporters</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
            <a href="/donor-leaderboard" class="btn btn-sm" style="${!period?'background:#4f46e5;color:white':''}">All Time</a>
            <a href="/donor-leaderboard?period=month" class="btn btn-sm" style="${period==='month'?'background:#4f46e5;color:white':''}">This Month</a>
            <a href="/donor-leaderboard?period=week" class="btn btn-sm" style="${period==='week'?'background:#4f46e5;color:white':''}">This Week</a>
          </div>
        </div>
        <div class="card">
          <table><tr><th>Rank</th><th>Donor</th><th>Total Donated</th><th>Donations</th><th>Campaigns</th></tr>
          ${topDonors.map((d, i) => '<tr'+(i<3?' style="background:'+['#fef3c7','#f1f5f9','#fef2f2'][i]+'"':'')+'><td style="font-weight:800;font-size:18px">'+(i<3?['&#129351;','&#129352;','&#129353;'][i]:(i+1))+'</td><td><strong>'+esc(d.donor_name)+'</strong></td><td style="font-weight:700;color:#059669">UGX '+parseInt(d.total_donated).toLocaleString()+'</td><td>'+parseInt(d.donation_count)+'</td><td>'+parseInt(d.campaigns)+'</td></tr>').join('')||'<tr><td colspan="5">No donations yet</td></tr>'}
          </table>
        </div>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V3 FEATURE 7: CAMPAIGN COLLABORATION
  // =============================================

  app.get('/campaigns/:id/collaborate', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const collaborators = (await pool.query('SELECT cc.*, t.name as org_name FROM campaign_collaborators cc JOIN tenants t ON cc.collaborator_tenant_id=t.id WHERE cc.campaign_id=$1', [req.params.id])).rows;
    res.send(renderPage('Campaign Collaboration', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2>Campaign Collaborators</h2>
          <a href="/campaigns/${req.params.id}/collaborate/invite" class="btn btn-green">Invite Organization</a>
        </div>
        <div class="card">
          <table><tr><th>Organization</th><th>Role</th><th>Contribution</th><th>Status</th><th>Actions</th></tr>
          ${collaborators.map(c => '<tr><td>'+esc(c.org_name)+'</td><td>'+esc(c.role)+'</td><td>'+parseInt(c.contribution_percentage||0)+'%</td><td><span class="tag" style="background:'+({pending:'#fef3c7;color:#92400e',accepted:'#d1fae5;color:#065f46',declined:'#fee2e2;color:#991b1b',revoked:'#f1f5f9;color:#64748b'}[c.status]||'#f1f5f9')+'">'+esc(c.status)+'</span></td><td>'+(c.status==='pending'?'<a href="/campaigns/collaborate/'+c.id+'/revoke" class="btn btn-sm" style="background:#ef4444;color:white">Revoke</a>':'')+'</td></tr>').join('')||'<tr><td colspan="5">No collaborators yet. Invite other organizations to co-manage this campaign!</td></tr>'}
          </table>
        </div>
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/collaborate/invite', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const orgs = (await pool.query("SELECT id, name, type FROM tenants WHERE id!=$1 AND approved=true AND banned=false ORDER BY name", [req.session.user.tenant_id])).rows;
    res.send(renderPage('Invite Collaborator', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/collaborate/invite-save" class="card">
          <h2>Invite Collaborator</h2>
          <label>Select Organization</label>
          <select name="collaborator_tenant_id" required>
            <option value="">Choose an organization...</option>
            ${orgs.map(o => '<option value="'+o.id+'">'+esc(o.name)+' ('+esc(o.type)+')</option>').join('')}
          </select>
          <label>Role</label>
          <select name="role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="fundraiser">Fundraiser</option><option value="co_owner">Co-Owner</option></select>
          <label>Contribution Percentage</label><input name="contribution_percentage" type="number" min="0" max="100" value="50">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Send Invitation</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/collaborate/invite-save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { collaborator_tenant_id, role, contribution_percentage } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_collaborators(tenant_id,campaign_id,collaborator_tenant_id,role,contribution_percentage,invited_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (campaign_id, collaborator_tenant_id) DO NOTHING',
      [t, req.params.id, collaborator_tenant_id, role||'viewer', contribution_percentage||0, req.session.user.email]);
    res.redirect('/campaigns/'+req.params.id+'/collaborate');
  }));

  // =============================================
  // V3 FEATURE 8: DONATION TIPPING
  // =============================================

  // API: Process tip with donation
  app.post('/api/donations/:id/tip', requireAuth, ah(async (req, res) => {
    const { tip_amount, tip_percentage } = req.body;
    const donation = (await pool.query('SELECT * FROM campaign_donations WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id])).rows[0];
    if (!donation) return res.status(404).json({ error: 'Donation not found' });
    const tipAmt = parseInt(tip_amount) || Math.round(parseInt(donation.amount) * parseFloat(tip_percentage||0) / 100);
    if (tipAmt <= 0) return res.json({ success: true, tip: 0 });
    await pool.query('INSERT INTO donation_tips(tenant_id,donation_id,campaign_id,donor_name,donor_email,tip_amount,tip_percentage,base_donation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [donation.tenant_id, donation.id, donation.campaign_id, donation.donor_name, donation.donor_email, tipAmt, tip_percentage||0, donation.amount]);
    await pool.query('UPDATE campaign_donations SET tip_amount=$1 WHERE id=$2 AND tenant_id=$3', [tipAmt, donation.id, donation.tenant_id]);
    await audit(req.session.user.email, 'donation_tip', 'donation_tips donation_id='+donation.id+' tip='+tipAmt);
    // Tip goes to platform wallet
    await pool.query('UPDATE platform_wallet SET balance=balance+$1 WHERE id=1', [tipAmt]);
    await pool.query('UPDATE fundraising_campaigns SET tip_total=COALESCE(tip_total,0)+$1 WHERE id=$2 AND tenant_id=$3', [tipAmt, donation.campaign_id, donation.tenant_id]);
    await audit(req.session.user.email, 'tip_given', 'campaign_donations id=' + req.params.id);
    res.json({ success: true, tip: tipAmt });
  }));

  // =============================================
  // V3 FEATURE 9: DONOR RETENTION ANALYTICS
  // =============================================

  app.get('/admin/donor-retention', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    // Calculate retention for current month
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Get analytics
    const [analytics, recentRetention] = await Promise.all([
      pool.query('SELECT * FROM donor_retention_analytics WHERE tenant_id=$1 ORDER BY period_start DESC LIMIT 12', [t]),
      pool.query(`
        WITH this_month AS (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donated_at >= $2),
        last_month AS (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donated_at >= $3 AND donated_at < $2)
        SELECT
          (SELECT COUNT(*) FROM this_month) as current_donors,
          (SELECT COUNT(*) FROM this_month WHERE donor_email NOT IN (SELECT donor_email FROM last_month)) as new_donors,
          (SELECT COUNT(*) FROM this_month tm WHERE EXISTS (SELECT 1 FROM last_month lm WHERE lm.donor_email = tm.donor_email)) as repeat_donors
      `, [t, periodStart, new Date(now.getFullYear(), now.getMonth() - 1, 1)])
    ]);
    const r = recentRetention.rows[0] || {};
    const retentionRate = r.current_donors > 0 && r.repeat_donors > 0 ? Math.round(parseInt(r.repeat_donors)/parseInt(r.current_donors)*100) : 0;

    res.send(renderPage('Donor Retention Analytics', `
      <div style="max-width:1000px;margin:0 auto;padding:20px">
        <h1 style="margin-bottom:24px">Donor Retention Analytics</h1>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#4f46e5">${parseInt(r.current_donors||0)}</div><div style="color:#64748b">Current Month Donors</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#059669">${parseInt(r.new_donors||0)}</div><div style="color:#64748b">New Donors</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#f59e0b">${parseInt(r.repeat_donors||0)}</div><div style="color:#64748b">Repeat Donors</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:${retentionRate>=50?'#059669':retentionRate>=30?'#f59e0b':'#ef4444'}">${retentionRate}%</div><div style="color:#64748b">Retention Rate</div></div>
        </div>
        <div class="card">
          <h3>Historical Retention Data</h3>
          <table><tr><th>Period</th><th>Total</th><th>New</th><th>Repeat</th><th>Retained</th><th>Churned</th><th>Rate</th></tr>
          ${analytics.rows.map(a => '<tr><td>'+new Date(a.period_start).toLocaleDateString()+' - '+new Date(a.period_end).toLocaleDateString()+'</td><td>'+parseInt(a.total_donors||0)+'</td><td>'+parseInt(a.new_donors||0)+'</td><td>'+parseInt(a.repeat_donors||0)+'</td><td>'+parseInt(a.retained_donors||0)+'</td><td>'+parseInt(a.churned_donors||0)+'</td><td style="font-weight:700;color:'+(parseFloat(a.retention_rate)>=50?'#059669':parseFloat(a.retention_rate)>=30?'#f59e0b':'#ef4444')+'">'+parseFloat(a.retention_rate).toFixed(1)+'%</td></tr>').join('')||'<tr><td colspan="7">No historical data yet. Data is calculated monthly.</td></tr>'}
          </table>
        </div>
        <div class="card" style="margin-top:20px">
          <h3>Tips to Improve Retention</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px">
            <div style="padding:16px;background:#f0fdf4;border-radius:10px"><strong style="color:#059669">Send Thank You Messages</strong><p style="font-size:13px;color:#64748b">Donors who receive thank yous are 40% more likely to give again</p></div>
            <div style="padding:16px;background:#eff6ff;border-radius:10px"><strong style="color:#4f46e5">Share Impact Updates</strong><p style="font-size:13px;color:#64748b">Show donors exactly how their money was used</p></div>
            <div style="padding:16px;background:#fef3c7;border-radius:10px"><strong style="color:#92400e">Set Up Recurring Donations</strong><p style="font-size:13px;color:#64748b">Monthly givers have 4x higher lifetime value</p></div>
          </div>
        </div>
      </div>
    `, req.session.user));
  }));

  // API: Calculate and save retention analytics
  app.post('/api/calculate-retention', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;
    const ps = period_start ? new Date(period_start) : new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const pe = period_end ? new Date(period_end) : new Date(new Date().getFullYear(), new Date().getMonth(), 0);
    try {
      const total = (await pool.query('SELECT COUNT(DISTINCT donor_email) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL AND donated_at >= $2 AND donated_at <= $3', [t, ps, pe])).rows[0]?.count || 0;
      const prevStart = new Date(ps); prevStart.setMonth(prevStart.getMonth() - 1);
      const prevDonors = (await pool.query('SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL AND donated_at >= $2 AND donated_at < $3', [t, prevStart, ps])).rows.map(r => r.donor_email);
      const newDonors = (await pool.query('SELECT COUNT(DISTINCT cd.donor_email) as count FROM campaign_donations cd WHERE cd.tenant_id=$1 AND cd.refunded=false AND cd.donor_email IS NOT NULL AND cd.donated_at >= $2 AND cd.donated_at <= $3 AND cd.donor_email NOT IN (SELECT DISTINCT donor_email FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email IS NOT NULL AND donated_at < $2)', [t, ps, pe])).rows[0]?.count || 0;
      const repeatDonors = parseInt(total) - parseInt(newDonors);
      const retained = prevDonors.length > 0 ? (await pool.query('SELECT COUNT(DISTINCT donor_email) as count FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donor_email = ANY($2) AND donated_at >= $3 AND donated_at <= $4', [t, prevDonors, ps, pe])).rows[0]?.count || 0 : 0;
      const churned = prevDonors.length - parseInt(retained);
      const rate = prevDonors.length > 0 ? Math.round(parseInt(retained)/prevDonors.length*100) : 0;
      await pool.query(`INSERT INTO donor_retention_analytics(tenant_id,period_start,period_end,total_donors,new_donors,repeat_donors,retained_donors,retention_rate)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, period_start, period_end) DO UPDATE SET total_donors=$4,new_donors=$5,repeat_donors=$6,retained_donors=$7,retention_rate=$8,calculated_at=NOW()`,
        [t, ps, pe, total, newDonors, repeatDonors, retained, rate]);
      res.json({ success: true, total, newDonors, repeatDonors, retained, churned, rate });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // =============================================
  // V3 FEATURE 10: CAMPAIGN SUCCESS SCORE
  // =============================================

  app.get('/campaigns/:id/success-score', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT * FROM fundraising_campaigns WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const score = (await pool.query('SELECT * FROM campaign_success_scores WHERE campaign_id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    res.send(renderPage('Campaign Success Score', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Campaign Success Score</h1>
          <h2 style="color:#64748b;font-size:18px">${esc(c.title)}</h2>
        </div>
        ${score ? `
        <div style="background:linear-gradient(135deg,${parseFloat(score.overall_score)>=70?'#059669,#10b981':parseFloat(score.overall_score)>=40?'#f59e0b,#fbbf24':'#ef4444,#f87171'});padding:30px;border-radius:16px;color:white;text-align:center;margin-bottom:24px">
          <div style="font-size:64px;font-weight:900">${parseFloat(score.overall_score).toFixed(0)}</div>
          <div style="font-size:18px;opacity:0.9">out of 100</div>
          <div style="font-size:16px;margin-top:8px">${parseFloat(score.overall_score)>=70?'Excellent - This campaign is well-positioned for success!':parseFloat(score.overall_score)>=40?'Good - Some improvements could boost performance':'Needs Work - Key areas need attention'}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-bottom:24px">
          ${[['Story Quality',score.story_quality_score,'How compelling your campaign story is'],['Media Quality',score.media_quality_score,'Images and videos effectiveness'],['Engagement',score.engagement_score,'Donor engagement and interaction'],['Momentum',score.momentum_score,'Growth rate and donation velocity'],['Trust',score.trust_score,'Verification, transparency, reviews'],['Social Proof',score.social_proof_score,'Donor count, shares, comments'],['Urgency',score.urgency_score,'Deadline and urgency level'],['Transparency',score.transparency_score,'Goal breakdown, updates, receipts']].map(([name,val,desc]) => '<div style="background:white;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="display:flex;justify-content:space-between"><strong>'+name+'</strong><span style="font-weight:800;color:'+(parseFloat(val)>=70?'#059669':parseFloat(val)>=40?'#f59e0b':'#ef4444')+'">'+parseFloat(val).toFixed(0)+'/100</span></div><div style="background:#e2e8f0;height:8px;border-radius:4px;margin:8px 0"><div style="background:'+(parseFloat(val)>=70?'#059669':parseFloat(val)>=40?'#f59e0b':'#ef4444')+';height:8px;border-radius:4px;width:'+parseFloat(val)+'%"></div></div><div style="font-size:12px;color:#64748b">'+desc+'</div></div>').join('')}
        </div>
        ${score.recommendations && score.recommendations.length > 0 ? '<div class="card"><h3>Recommendations</h3>' + (typeof score.recommendations === 'string' ? JSON.parse(score.recommendations) : score.recommendations).map(r => '<div style="padding:12px;border-left:3px solid #4f46e5;margin-bottom:8px;background:#f8fafc;border-radius:0 8px 8px 0"><strong>'+esc(r.title||'Tip')+'</strong><p style="font-size:14px;color:#64748b;margin:4px 0 0 0">'+esc(r.description||r)+'</p></div>').join('') + '</div>' : ''}
        ` : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#127919;</div><h3>No Score Calculated Yet</h3><p style="color:#64748b;margin-bottom:16px">Calculate your campaign success score to get personalized recommendations.</p><a href="/api/campaigns/'+req.params.id+'/calculate-score" class="btn btn-green">Calculate Score</a></div>'}
        <div style="margin-top:20px"><a href="/api/campaigns/${req.params.id}/calculate-score" class="btn" style="background:#4f46e5;color:white">Recalculate Score</a></div>
      </div>
    `, req.session.user));
  }));

  // API: Calculate campaign success score
  app.get('/api/campaigns/:id/calculate-score', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as donor_count FROM fundraising_campaigns fc WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Campaign not found' });

    const recommendations = [];
    // Story quality
    const descLen = (c.description||'').length;
    const storyQuality = Math.min(100, Math.round((descLen / 500) * 60 + (c.story ? 20 : 0) + (c.impact_summary ? 20 : 0)));
    if (storyQuality < 70) recommendations.push({ title: 'Improve Your Story', description: 'Add more details to your campaign description. Aim for 500+ words with emotional stories and specific impact details.' });

    // Media quality
    const mediaQuality = Math.min(100, (c.image_url ? 40 : 0) + (c.video_url ? 30 : 0) + ((c.gallery_images||[]).length > 0 ? 20 : 0) + ((c.video_urls||[]).length > 0 ? 10 : 0));
    if (mediaQuality < 70) recommendations.push({ title: 'Add More Media', description: 'Campaigns with images and videos raise 2x more. Add a compelling cover image and a video telling your story.' });

    // Engagement
    const donorCount = parseInt(c.donor_count||0);
    const engagementScore = Math.min(100, Math.round((donorCount / 50) * 30 + parseInt(c.total_comments||0) * 5 + parseInt(c.total_shares||0) * 3 + parseInt(c.total_followers||0) * 2));
    if (engagementScore < 70) recommendations.push({ title: 'Boost Engagement', description: 'Share your campaign on social media, encourage comments, and ask supporters to follow for updates.' });

    // Momentum
    const pct = c.target > 0 ? parseInt(c.raised||0)/parseInt(c.target) : 0;
    const momentumScore = Math.min(100, Math.round(pct * 60 + (pct > 0.1 ? 20 : 0) + (pct > 0.25 ? 20 : 0)));
    if (momentumScore < 50) recommendations.push({ title: 'Build Momentum', description: 'Early donations are crucial. Ask your closest network to donate first to build social proof.' });

    // Trust
    const trustScore = Math.min(100, (c.is_verified ? 40 : 0) + (c.verification_badge !== 'none' ? 20 : 0) + (parseFloat(c.trust_score||0) > 0 ? 20 : 0) + (parseInt(c.endorsement_count||0) > 0 ? 20 : 0));
    if (trustScore < 70) recommendations.push({ title: 'Build Trust', description: 'Get verified, add endorsements from notable people, and share transparent updates regularly.' });

    // Social proof
    const socialProofScore = Math.min(100, (donorCount > 0 ? 30 : 0) + (parseInt(c.total_testimonials||0) > 0 ? 25 : 0) + (parseInt(c.total_shares||0) > 0 ? 25 : 0) + (c.matching_active ? 20 : 0));
    if (socialProofScore < 70) recommendations.push({ title: 'Increase Social Proof', description: 'Add testimonials from beneficiaries, enable donation matching, and encourage social sharing.' });

    // Urgency
    const daysLeft = c.deadline ? Math.max(0, Math.ceil((new Date(c.deadline) - new Date()) / (1000*60*60*24))) : 999;
    const urgencyScore = Math.min(100, (c.urgency_level === 'urgent' || c.urgency_level === 'critical' ? 40 : c.urgency_level === 'high' ? 30 : 10) + (daysLeft <= 7 ? 30 : daysLeft <= 30 ? 20 : 0) + (c.deadline ? 30 : 0));
    if (urgencyScore < 50) recommendations.push({ title: 'Create Urgency', description: 'Set a deadline, use urgency levels, and communicate time-sensitivity to donors.' });

    // Transparency
    const transparencyScore = Math.min(100, ((c.goal_breakdown||[]).length > 0 ? 30 : 0) + (c.has_faq ? 20 : 0) + (c.organization_description ? 20 : 0) + (parseInt(c.total_shares||0) > 2 ? 15 : 0) + (c.estimated_beneficiaries > 0 ? 15 : 0));
    if (transparencyScore < 70) recommendations.push({ title: 'Be More Transparent', description: 'Add a goal breakdown showing how funds will be used, FAQ section, and beneficiary estimates.' });

    const overall = Math.round((storyQuality + mediaQuality + engagementScore + momentumScore + trustScore + socialProofScore + urgencyScore + transparencyScore) / 8);

    const tenant_id = c.tenant_id;
    await pool.query(`INSERT INTO campaign_success_scores(tenant_id,campaign_id,overall_score,story_quality_score,media_quality_score,engagement_score,momentum_score,trust_score,social_proof_score,urgency_score,transparency_score,recommendations,last_calculated)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (tenant_id, campaign_id) DO UPDATE SET overall_score=$3,story_quality_score=$4,media_quality_score=$5,engagement_score=$6,momentum_score=$7,trust_score=$8,social_proof_score=$9,urgency_score=$10,transparency_score=$11,recommendations=$12,last_calculated=NOW()`,
      [tenant_id, c.id, overall, storyQuality, mediaQuality, engagementScore, momentumScore, trustScore, socialProofScore, urgencyScore, transparencyScore, JSON.stringify(recommendations)]);
    await pool.query('UPDATE fundraising_campaigns SET success_score=$1 WHERE id=$2 AND tenant_id=$3', [overall, c.id, tenant_id]);

    // Redirect back if from browser, or return JSON
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      res.redirect('/campaigns/'+c.id+'/success-score');
    } else {
      res.json({ success: true, overall, scores: { storyQuality, mediaQuality, engagementScore, momentumScore, trustScore, socialProofScore, urgencyScore, transparencyScore }, recommendations });
    }
  }));

  // =============================================
  // V3 FEATURE 11: CAMPAIGN FAQ
  // =============================================

  app.get('/campaigns/:id/faq', ah(async (req, res) => {
    const faqs = (await pool.query('SELECT * FROM campaign_faqs WHERE campaign_id=$1 ORDER BY sort_order, created_at', [req.params.id])).rows;
    res.send(renderPage('FAQ', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <h1 style="text-align:center;margin-bottom:24px">Frequently Asked Questions</h1>
        ${faqs.length > 0 ? faqs.map(f => '<div style="background:white;border-radius:12px;padding:20px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04)"><h3 style="color:#1e293b">'+esc(f.question)+'</h3><p style="color:#475569;line-height:1.6;margin-top:8px">'+esc(f.answer)+'</p></div>').join('') : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#10067;</div><h3>No FAQ Yet</h3><p style="color:#64748b">Questions and answers will be added by the organizer.</p></div>'}
        ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/faq/new" style="display:block;margin-top:20px;text-align:center;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700">Add a Question</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/faq/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Add FAQ', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/faq/save" class="card">
          <h2>Add FAQ</h2>
          <label>Question</label><input name="question" placeholder="What would donors want to know?" required>
          <label>Answer</label><textarea name="answer" rows="4" placeholder="Provide a clear, helpful answer" required></textarea>
          <label>Sort Order</label><input name="sort_order" type="number" value="0">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Add FAQ</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/faq/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { question, answer, sort_order } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_faqs(tenant_id,campaign_id,question,answer,sort_order,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [t, req.params.id, question, answer, sort_order||0, req.session.user.email]);
    await pool.query('UPDATE fundraising_campaigns SET has_faq=true WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/campaigns/'+req.params.id+'/faq');
  }));

  // =============================================
  // V3 FEATURE 12: CAMPAIGN EVENTS
  // =============================================

  app.get('/campaigns/:id/events', ah(async (req, res) => {
    const events = (await pool.query('SELECT * FROM campaign_events WHERE campaign_id=$1 AND is_public=true ORDER BY event_date ASC', [req.params.id])).rows;
    const eventTypeIcons = { fundraiser:'&#127881;', gala:'&#128142;', auction:'&#127942;', walkathon:'&#128694;', webinar:'&#128187;', concert:'&#127925;', volunteer_day:'&#9997;', other:'&#128197;' };
    res.send(renderPage('Campaign Events', `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="text-align:center;margin-bottom:24px">Campaign Events</h1>
        ${events.length > 0 ? '<div style="display:grid;gap:16px">' + events.map(e => {
          const isPast = new Date(e.event_date) < new Date();
          return '<div style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:flex;gap:20px;align-items:start;opacity:'+(isPast?'0.7':'1')+'"><div style="text-align:center;min-width:80px"><div style="font-size:32px">'+(eventTypeIcons[e.event_type]||'&#128197;')+'</div><div style="font-weight:800;color:#4f46e5">'+new Date(e.event_date).toLocaleDateString('en',{month:'short',day:'numeric'})+'</div><div style="font-size:12px;color:#64748b">'+new Date(e.event_date).toLocaleDateString('en',{year:'numeric'})+'</div></div><div style="flex:1"><h3 style="font-weight:700">'+esc(e.title)+'</h3>'+(e.description?'<p style="color:#64748b;font-size:14px;margin:4px 0">'+esc(e.description)+'</p>':'')+'<div style="display:flex;gap:8px;margin-top:8px;font-size:13px">'+(e.location?'<span style="color:#64748b">&#128205; '+esc(e.location)+'</span>':'')+(e.virtual_link?'<a href="'+esc(e.virtual_link)+'" style="color:#4f46e5">&#127760; Join Online</a>':'')+(e.ticket_price>0?'<span style="color:#059669;font-weight:700">UGX '+parseInt(e.ticket_price).toLocaleString()+'</span>':'<span style="color:#059669;font-weight:700">Free</span>')+(e.capacity?'<span style="color:#64748b">'+parseInt(e.registered_count||0)+'/'+parseInt(e.capacity)+' registered</span>':'')+'</div>'+(e.status==='upcoming'&&req.session.user?'<a href="/campaigns/'+e.campaign_id+'/events/'+e.id+'/register" style="display:inline-block;margin-top:8px;padding:8px 16px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Register</a>':'')+'</div></div>';
        }).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#128197;</div><h3>No Events Scheduled</h3><p style="color:#64748b">Events will be posted by the campaign organizer.</p></div>'}
        ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/events/new" style="display:block;margin-top:20px;text-align:center;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700">Create Event</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/events/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Create Event', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/events/save" class="card">
          <h2>Create Event</h2>
          <label>Event Title</label><input name="title" placeholder="e.g., Charity Gala 2025" required>
          <label>Description</label><textarea name="description" rows="3" placeholder="Event details"></textarea>
          <label>Event Type</label>
          <select name="event_type"><option value="fundraiser">Fundraiser</option><option value="gala">Gala</option><option value="auction">Auction</option><option value="walkathon">Walkathon</option><option value="webinar">Webinar</option><option value="concert">Concert</option><option value="volunteer_day">Volunteer Day</option><option value="other">Other</option></select>
          <label>Event Date & Time</label><input name="event_date" type="datetime-local" required>
          <label>End Date (optional)</label><input name="end_date" type="datetime-local">
          <label>Location</label><input name="location" placeholder="Physical venue address">
          <label>Virtual Link (optional)</label><input name="virtual_link" placeholder="https://zoom.us/...">
          <label>Capacity (leave blank for unlimited)</label><input name="capacity" type="number" placeholder="200">
          <label>Ticket Price (UGX, 0 for free)</label><input name="ticket_price" type="number" value="0">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Create Event</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/events/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { title, description, event_type, event_date, end_date, location, virtual_link, capacity, ticket_price, image_url } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_events(tenant_id,campaign_id,title,description,event_type,event_date,end_date,location,virtual_link,capacity,ticket_price,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [t, req.params.id, title, description||'', event_type||'fundraiser', event_date, end_date||null, location||null, virtual_link||null, capacity||null, ticket_price||0, image_url||null]);
    await pool.query('UPDATE fundraising_campaigns SET has_events=true, event_count=(SELECT COUNT(*) FROM campaign_events WHERE campaign_id=$1 AND status=$2) WHERE id=$1 AND tenant_id=$3', [req.params.id, 'upcoming', t]);
    res.redirect('/campaigns/'+req.params.id+'/events');
  }));

  // Register for event
  app.get('/campaigns/:campaignId/events/:eventId/register', requireAuth, ah(async (req, res) => {
    const event = (await pool.query('SELECT * FROM campaign_events WHERE id=$1 AND tenant_id=$2', [req.params.eventId, req.session.user.tenant_id])).rows[0];
    if (!event) return res.status(404).send('Event not found');
    res.send(renderPage('Register for Event', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.campaignId}/events/${req.params.eventId}/register-save" class="card">
          <h2>Register: ${esc(event.title)}</h2>
          ${event.ticket_price > 0 ? '<p style="color:#059669;font-weight:700;font-size:18px">Ticket Price: UGX '+parseInt(event.ticket_price).toLocaleString()+'</p>' : '<p style="color:#059669;font-weight:700">Free Event</p>'}
          <label>Your Name</label><input name="attendee_name" value="${esc(req.session.user?.name||'')}" required>
          <label>Email</label><input name="attendee_email" value="${esc(req.session.user?.email||'')}" required>
          <label>Phone</label><input name="attendee_phone" placeholder="+256 xxx xxx xxx">
          <label>Number of Tickets</label><input name="num_tickets" type="number" min="1" max="10" value="1">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">${event.ticket_price > 0 ? 'Register & Pay' : 'Register'}</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:campaignId/events/:eventId/register-save', requireAuth, ah(async (req, res) => {
    const { attendee_name, attendee_email, attendee_phone, num_tickets } = req.body;
    const event = (await pool.query('SELECT * FROM campaign_events WHERE id=$1 AND tenant_id=$2', [req.params.eventId, req.session.user.tenant_id])).rows[0];
    if (!event) return res.status(404).send('Event not found');
    const t = event.tenant_id;
    const ticketCode = 'TKT-' + Date.now().toString(36).toUpperCase();
    const amountPaid = parseInt(num_tickets||1) * parseInt(event.ticket_price||0);
    await pool.query('INSERT INTO campaign_event_registrations(tenant_id,event_id,campaign_id,attendee_name,attendee_email,attendee_phone,num_tickets,amount_paid,ticket_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, req.params.eventId, req.params.campaignId, attendee_name, attendee_email, attendee_phone||null, num_tickets||1, amountPaid, ticketCode]);
    const result = await pool.query('SELECT id FROM campaign_event_registrations WHERE tenant_id=$1 AND event_id=$2 AND attendee_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.eventId, attendee_email]);
    if (result.rows[0]) await audit(req.session.user.email, 'event_registered', 'campaign_event_registrations id=' + result.rows[0].id);
    await pool.query('UPDATE campaign_events SET registered_count=registered_count+$1 WHERE id=$2 AND tenant_id=$3', [num_tickets||1, req.params.eventId, t]);
    // If paid event, create donation
    if (amountPaid > 0) {
      await pool.query('INSERT INTO campaign_donations(tenant_id,campaign_id,donor_name,amount,method,message) VALUES($1,$2,$3,$4,$5,$6)',
        [t, req.params.campaignId, attendee_name, amountPaid, 'event_ticket', 'Event ticket: '+event.title+' x'+(num_tickets||1)]);
    }
    res.send(renderPage('Registration Confirmed', `
      <div style="max-width:500px;margin:0 auto;padding:20px;text-align:center">
        <div style="background:linear-gradient(135deg,#059669,#10b981);padding:40px;border-radius:16px;color:white;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">&#9989;</div>
          <h1>Registration Confirmed!</h1>
          <p>You are registered for "${esc(event.title)}"</p>
          <div style="background:rgba(255,255,255,0.2);padding:16px;border-radius:12px;margin-top:16px">
            <div style="font-size:13px;opacity:0.8">Ticket Code</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:2px">${esc(ticketCode)}</div>
            <div style="font-size:13px;opacity:0.8;margin-top:4px">${parseInt(num_tickets||1)} ticket(s) | ${new Date(event.event_date).toLocaleString()}</div>
          </div>
        </div>
        ${event.virtual_link ? '<a href="'+esc(event.virtual_link)+'" style="display:block;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700;text-align:center">Join Virtual Event</a>' : ''}
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V3: ENHANCED DONATE PAGE WITH TIPS & REWARDS
  // =============================================

  // API: Get reward tiers for donation page
  app.get('/api/campaigns/:id/rewards', ah(async (req, res) => {
    const rewards = (await pool.query('SELECT id, title, description, min_amount, max_amount, reward_type, quantity_available, quantity_claimed FROM campaign_reward_tiers WHERE campaign_id=$1 AND is_active=true ORDER BY min_amount ASC', [req.params.id])).rows;
    res.json(rewards);
  }));

  // API: Global fundraising stats for homepage
  app.get('/api/global-fundraising-stats', ah(async (req, res) => {
    const stats = await Promise.all([
      pool.query("SELECT COALESCE(SUM(amount),0) as total FROM campaign_donations WHERE refunded=false"),
      pool.query("SELECT COUNT(DISTINCT campaign_id) as count FROM campaign_donations"),
      pool.query("SELECT COUNT(*) as count FROM fundraising_campaigns WHERE is_public=true AND status='active'"),
      pool.query("SELECT COUNT(DISTINCT donor_email) as count FROM campaign_donations WHERE donor_email IS NOT NULL AND refunded=false")
    ]);
    res.json({
      total_donated: parseInt(stats[0].rows[0]?.total||0),
      total_campaigns_funded: parseInt(stats[1].rows[0]?.count||0),
      active_campaigns: parseInt(stats[2].rows[0]?.count||0),
      total_donors: parseInt(stats[3].rows[0]?.count||0)
    });
  }));

  // Update processDonationEffects to include V3 features (streaks)
  const originalProcessDonation = processDonationEffects;
  // We'll update streaks directly in the donate-save flow

  console.log('[Fundraising V4] Donation Gift Cards, Challenges, Ambassadors, Impact Reports, Smart Suggestions, Merchandise, Community Board, Donor Segmentation, Health Monitor, Multi-Language + All V3 Features');

  // =============================================
  // V4 FEATURE 1: DONATION GIFT CARDS
  // =============================================

  app.get('/gift-cards', ah(async (req, res) => {
    const giftCards = req.session.user ? (await pool.query('SELECT * FROM donation_gift_cards WHERE purchaser_email=$1 ORDER BY created_at DESC LIMIT 20', [req.session.user.email])).rows : [];
    res.send(renderPage('Donation Gift Cards', `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:40px;border-radius:20px;color:white;text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">&#127873;</div>
          <h1 style="font-size:32px;font-weight:900;margin:0 0 8px 0">Donation Gift Cards</h1>
          <p style="font-size:18px;opacity:0.9">Give the gift of giving! Let someone special choose a cause they care about.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:16px;padding:24px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #f59e0b;cursor:pointer" onclick="document.getElementById('amount25').checked=true">
            <div style="font-size:36px;font-weight:900;color:#f59e0b">UGX 25,000</div>
            <p style="color:#64748b">Starter Gift</p>
          </div>
          <div style="background:white;border-radius:16px;padding:24px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #059669;cursor:pointer" onclick="document.getElementById('amount50').checked=true">
            <div style="font-size:36px;font-weight:900;color:#059669">UGX 50,000</div>
            <p style="color:#64748b">Popular Gift</p>
          </div>
          <div style="background:white;border-radius:16px;padding:24px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #4f46e5;cursor:pointer" onclick="document.getElementById('amount100').checked=true">
            <div style="font-size:36px;font-weight:900;color:#4f46e5">UGX 100,000</div>
            <p style="color:#64748b">Premium Gift</p>
          </div>
          <div style="background:white;border-radius:16px;padding:24px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);border:2px solid #7c3aed;cursor:pointer">
            <div style="font-size:36px;font-weight:900;color:#7c3aed">Custom</div>
            <p style="color:#64748b">Any Amount</p>
          </div>
        </div>
        ${req.session.user ? '<div class="card"><h3>Purchase a Gift Card</h3><form method="POST" action="/gift-cards/purchase"><label>Amount (UGX)</label><input name="amount" type="number" placeholder="50000" required><label>Recipient Name</label><input name="recipient_name" placeholder="Jane Doe" required><label>Recipient Email</label><input name="recipient_email" type="email" placeholder="jane@example.com" required><label>Personal Message</label><textarea name="message" rows="3" placeholder="Happy Birthday! Choose a cause close to your heart."></textarea><label>Your Name</label><input name="purchaser_name" value="'+esc(req.session.user?.name||'')+'"><button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Purchase Gift Card</button></form></div>' : '<div style="text-align:center;padding:20px"><a href="/register" class="btn btn-green" style="padding:14px 32px;font-size:16px">Sign Up to Purchase Gift Cards</a></div>'}
        ${giftCards.length > 0 ? '<div class="card" style="margin-top:20px"><h3>Your Gift Cards</h3><table><tr><th>Code</th><th>Amount</th><th>Recipient</th><th>Status</th></tr>'+giftCards.map(gc => '<tr><td style="font-family:monospace;font-weight:700">'+esc(gc.card_code)+'</td><td>UGX '+parseInt(gc.amount).toLocaleString()+'</td><td>'+esc(gc.recipient_name)+'</td><td><span class="tag" style="background:'+(gc.status==='active'?'#d1fae5;color:#065f46':gc.status==='redeemed'?'#e0e7ff;color:#3730a3':'#f1f5f9;color:#64748b')+'">'+esc(gc.status)+'</span></td></tr>').join('')+'</table></div>' : ''}
      </div>
    `, req.session.user));
  }));

  app.post('/gift-cards/purchase', requireAuth, ah(async (req, res) => {
    const { amount, recipient_name, recipient_email, message, purchaser_name } = req.body;
    const cardCode = 'GFT-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase();
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO donation_gift_cards(tenant_id,card_code,amount,purchaser_name,purchaser_email,recipient_name,recipient_email,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, cardCode, amount, purchaser_name||req.session.user.name, req.session.user.email, recipient_name, recipient_email, message||'']);
    const result = await pool.query('SELECT id FROM donation_gift_cards WHERE tenant_id=$1 AND card_code=$2', [t, cardCode]);
    if (result.rows[0]) await audit(req.session.user.email, 'gift_card_purchased', 'gift_cards id=' + result.rows[0].id);
    // Send email to recipient
    try {
      const purchaserN = purchaser_name || req.session.user.name || 'Someone';
      await sendEmail(recipient_email, 'You Received a Donation Gift Card!', `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white"><h1>You Got a Gift Card!</h1></div>
          <div style="padding:30px;background:white;border:1px solid #e2e8f0">
            <p>${esc(purchaserN)} sent you a donation gift card worth <strong style="color:#f59e0b;font-size:24px">UGX ${parseInt(amount).toLocaleString()}</strong>!</p>
            ${message ? '<p style="font-style:italic;color:#64748b">"${esc(message)}"</p>' : ''}
            <p>Use this code to donate to any campaign: <strong style="font-family:monospace;font-size:20px;background:#fef3c7;padding:4px 12px;border-radius:6px">${esc(cardCode)}</strong></p>
            <a href="${BASE_URL}/discover" style="display:inline-block;padding:12px 24px;background:#059669;color:white;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Browse Campaigns</a>
          </div>
        </div>
      `);
    } catch(e) { console.warn('[Gift Card Email Error]', e.message); }
    res.send(renderPage('Gift Card Purchased!', `
      <div style="max-width:500px;margin:0 auto;padding:20px;text-align:center">
        <div style="background:linear-gradient(135deg,#f59e0b,#f97316);padding:40px;border-radius:16px;color:white;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">&#127873;</div>
          <h1>Gift Card Sent!</h1>
          <p>Your gift card of UGX ${parseInt(amount).toLocaleString()} has been sent to ${esc(recipient_name)}</p>
          <div style="background:rgba(255,255,255,0.2);padding:16px;border-radius:12px;margin-top:16px">
            <div style="font-size:13px;opacity:0.8">Gift Card Code</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:2px">${esc(cardCode)}</div>
          </div>
        </div>
        <a href="/gift-cards" class="btn btn-green">Buy Another Gift Card</a>
      </div>
    `, req.session.user));
  }));

  // Redeem gift card
  app.get('/gift-cards/redeem', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Redeem Gift Card', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/gift-cards/redeem-save" class="card">
          <h2>Redeem Your Gift Card</h2>
          <p style="color:#64748b">Enter your gift card code to add funds to your donor balance</p>
          <label>Gift Card Code</label><input name="card_code" placeholder="GFT-XXXXXX" style="font-family:monospace;font-size:18px;text-align:center" required>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Redeem</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/gift-cards/redeem-save', requireAuth, ah(async (req, res) => {
    const { card_code } = req.body;
    const gc = (await pool.query("SELECT * FROM donation_gift_cards WHERE card_code=$1 AND status='active'", [card_code])).rows[0];
    if (!gc) return res.send(renderPage('Invalid Gift Card', '<div style="text-align:center;padding:40px"><h2 style="color:#ef4444">Invalid or Already Used</h2><p>This gift card code is not valid or has already been redeemed.</p><a href="/gift-cards/redeem" class="btn">Try Again</a></div>', req.session.user));
    await pool.query("UPDATE donation_gift_cards SET status='redeemed', redeemed_by=$1, redeemed_at=NOW() WHERE id=$2 AND tenant_id=$3", [req.session.user.email, gc.id, gc.tenant_id]);
    await audit(req.session.user.email, 'gift_card_redeemed', 'gift_card_redemptions id=' + gc.id);
    // Add to user's donor balance or create a credit
    await pool.query(`INSERT INTO donor_profiles(tenant_id,user_email,full_name,gift_card_balance) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id, user_email) DO UPDATE SET gift_card_balance=COALESCE(gift_card_balance,0)+$4`,
      [gc.tenant_id, req.session.user.email, req.session.user.name||'', gc.amount]);
    res.send(renderPage('Gift Card Redeemed!', `
      <div style="text-align:center;padding:40px">
        <div style="font-size:48px;margin-bottom:16px">&#9989;</div>
        <h1 style="color:#059669">Gift Card Redeemed!</h1>
        <p style="font-size:20px">UGX ${parseInt(gc.amount).toLocaleString()} has been added to your donor balance</p>
        <a href="/discover" class="btn btn-green" style="margin-top:16px">Browse Campaigns to Donate</a>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V4 FEATURE 2: CAMPAIGN CHALLENGES/COMPETITIONS
  // =============================================

  app.get('/challenges', ah(async (req, res) => {
    const challenges = (await pool.query("SELECT cc.*, t.name as org_name FROM campaign_challenges cc JOIN tenants t ON cc.tenant_id=t.id WHERE cc.is_public=true ORDER BY cc.created_at DESC LIMIT 20")).rows;
    res.send(renderPage('Fundraising Challenges', `
      <div style="max-width:1000px;margin:0 auto;padding:20px">
        <div style="background:linear-gradient(135deg,#7c3aed,#ec4899);padding:40px;border-radius:20px;color:white;text-align:center;margin-bottom:24px">
          <div style="font-size:48px;margin-bottom:12px">&#127942;</div>
          <h1 style="font-size:32px;font-weight:900;margin:0 0 8px 0">Fundraising Challenges</h1>
          <p style="font-size:18px;opacity:0.9">Compete with other organizations. Rise up the leaderboard!</p>
        </div>
        ${challenges.length > 0 ? '<div style="display:grid;gap:20px">' + challenges.map(ch => {
          const daysLeft = ch.end_date ? Math.max(0, Math.ceil((new Date(ch.end_date) - new Date()) / (1000*60*60*24))) : 999;
          return '<div style="background:white;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08)"><div style="display:flex;justify-content:space-between;align-items:start"><div><h3 style="font-size:22px;font-weight:800">'+esc(ch.title)+'</h3><p style="color:#64748b;margin:4px 0">'+esc(ch.description||'')+'</p></div><div style="text-align:right"><span class="tag" style="background:'+({active:'#d1fae5;color:#065f46',completed:'#e0e7ff;color:#3730a3',upcoming:'#fef3c7;color:#92400e'}[ch.status]||'#f1f5f9')+'">'+esc(ch.status)+'</span>'+(daysLeft<999?'<div style="font-size:20px;font-weight:800;color:'+(daysLeft<=3?'#ef4444':daysLeft<=7?'#f59e0b':'#4f46e5')+';margin-top:8px">'+daysLeft+' days left</div>':'')+'</div></div><div style="display:flex;gap:8px;margin-top:12px"><span class="tag" style="background:#e0e7ff;color:#3730a3">'+esc(ch.challenge_type)+'</span>'+(ch.prize_description?'<span class="tag" style="background:#fef3c7;color:#92400e">Prize: '+esc(ch.prize_description)+'</span>':'')+'</div><a href="/challenges/'+ch.id+'" style="display:block;margin-top:12px;text-align:center;padding:10px;background:#7c3aed;color:white;border-radius:10px;text-decoration:none;font-weight:700">View Challenge & Join</a></div>';
        }).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#127942;</div><h3>No Active Challenges</h3><p style="color:#64748b">Check back soon for exciting fundraising competitions!</p></div>'}
        ${req.session.user ? '<a href="/challenges/create" style="display:block;margin-top:20px;text-align:center;padding:16px;background:#7c3aed;color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Create a Challenge</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/challenges/create', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Create Challenge', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <form method="POST" action="/challenges/save" class="card">
          <h2>Create a Fundraising Challenge</h2>
          <label>Challenge Title</label><input name="title" placeholder="e.g., Schools Education Challenge 2025" required>
          <label>Description</label><textarea name="description" rows="3" placeholder="What is this challenge about?"></textarea>
          <label>Challenge Type</label>
          <select name="challenge_type"><option value="most_raised">Most Money Raised</option><option value="most_donors">Most Donors</option><option value="fastest_goal">Fastest to Reach Goal</option><option value="highest_percentage">Highest Percentage Funded</option><option value="most_shared">Most Shared on Social Media</option><option value="community_impact">Community Impact</option></select>
          <label>Start Date</label><input name="start_date" type="date" required>
          <label>End Date</label><input name="end_date" type="date" required>
          <label>Prize Description</label><input name="prize_description" placeholder="e.g., Featured spot, UGX 500k bonus, Trophy">
          <label>Max Participants</label><input name="max_participants" type="number" placeholder="10" value="20">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Create Challenge</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/challenges/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { title, description, challenge_type, start_date, end_date, prize_description, max_participants } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_challenges(tenant_id,title,description,challenge_type,start_date,end_date,prize_description,max_participants,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, title, description||'', challenge_type||'most_raised', start_date, end_date, prize_description||null, max_participants||20, req.session.user.email]);
    res.redirect('/challenges');
  }));

  app.get('/challenges/:id', ah(async (req, res) => {
    const ch = (await pool.query('SELECT cc.*, t.name as org_name FROM campaign_challenges cc JOIN tenants t ON cc.tenant_id=t.id WHERE cc.id=$1', [req.params.id])).rows[0];
    if (!ch) return res.status(404).send('Challenge not found');
    const participants = (await pool.query('SELECT cp.*, fc.title as campaign_title, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=cp.campaign_id AND refunded=false) as raised FROM challenge_participants cp JOIN fundraising_campaigns fc ON cp.campaign_id=fc.id WHERE cp.challenge_id=$1 ORDER BY raised DESC', [req.params.id])).rows;
    res.send(renderPage(ch.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">${esc(ch.title)}</h1>
        <p style="color:#64748b;margin-bottom:20px">${esc(ch.description||'')}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-weight:800;color:#7c3aed">${esc(ch.challenge_type.replace(/_/g,' '))}</div><div style="font-size:13px;color:#64748b">Challenge Type</div></div>
          <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-weight:800;color:#059669">${participants.length}</div><div style="font-size:13px;color:#64748b">Participants</div></div>
          <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-weight:800;color:#f59e0b">${ch.prize_description ? esc(ch.prize_description) : 'Bragging Rights'}</div><div style="font-size:13px;color:#64748b">Prize</div></div>
        </div>
        <div class="card"><h3>Leaderboard</h3><table><tr><th>Rank</th><th>Campaign</th><th>Raised</th></tr>
        ${participants.map((p, i) => '<tr'+(i<3?' style="background:'+['#fef3c7','#f1f5f9','#fef2f2'][i]+'"':'')+'><td style="font-weight:800;font-size:18px">'+(i<3?['&#129351;','&#129352;','&#129353;'][i]:(i+1))+'</td><td>'+esc(p.campaign_title)+'</td><td style="font-weight:700;color:#059669">UGX '+parseInt(p.raised||0).toLocaleString()+'</td></tr>').join('')||'<tr><td colspan="3">No participants yet</td></tr>'}
        </table></div>
        ${req.session.user && ch.status === 'active' ? '<a href="/challenges/'+ch.id+'/join" style="display:block;margin-top:20px;text-align:center;padding:16px;background:#7c3aed;color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Join This Challenge</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/challenges/:id/join', requireAuth, ah(async (req, res) => {
    const campaigns = (await pool.query("SELECT id, title FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id])).rows;
    res.send(renderPage('Join Challenge', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/challenges/${req.params.id}/join-save" class="card">
          <h2>Join Challenge</h2>
          <label>Select Your Campaign</label>
          <select name="campaign_id" required><option value="">Choose campaign...</option>${campaigns.map(c => '<option value="'+c.id+'">'+esc(c.title)+'</option>').join('')}</select>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Join Challenge</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/challenges/:id/join-save', requireAuth, ah(async (req, res) => {
    const { campaign_id } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO challenge_participants(tenant_id,challenge_id,campaign_id) VALUES($1,$2,$3) ON CONFLICT (challenge_id, campaign_id) DO NOTHING',
      [t, req.params.id, campaign_id]);
    const result = await pool.query('SELECT id FROM challenge_participants WHERE tenant_id=$1 AND challenge_id=$2 AND campaign_id=$3', [t, req.params.id, campaign_id]);
    if (result.rows[0]) await audit(req.session.user.email, 'challenge_joined', 'campaign_challenge_participants id=' + result.rows[0].id);
    await pool.query('UPDATE campaign_challenges SET participant_count=(SELECT COUNT(*) FROM challenge_participants WHERE challenge_id=$1) WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    res.redirect('/challenges/'+req.params.id);
  }));

  // =============================================
  // V4 FEATURE 3: CAMPAIGN AMBASSADORS
  // =============================================

  app.get('/campaigns/:id/ambassadors', ah(async (req, res) => {
    const ambassadors = (await pool.query('SELECT * FROM campaign_ambassadors WHERE campaign_id=$1 AND status=$2 ORDER BY tier DESC, created_at DESC', [req.params.id, 'active'])).rows;
    const isAmbassador = req.session.user ? (await pool.query('SELECT id FROM campaign_ambassadors WHERE campaign_id=$1 AND ambassador_email=$2', [req.params.id, req.session.user.email])).rows[0] : null;
    res.send(renderPage('Campaign Ambassadors', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Campaign Ambassadors</h1>
          <p style="color:#64748b">Passionate supporters who spread the word</p>
        </div>
        ${ambassadors.length > 0 ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">' + ambassadors.map(a => '<div style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);text-align:center;border-top:4px solid '+(a.tier==='gold'?'#f59e0b':a.tier==='silver'?'#94a3b8':'#cd7f32')+'"><div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,'+(a.tier==='gold'?'#f59e0b,#fbbf24':a.tier==='silver'?'#94a3b8,#cbd5e1':'#cd7f32,#f59e0b')+');margin:0 auto 12px;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;font-weight:700">'+esc((a.ambassador_name||'A')[0])+'</div><div style="font-weight:700">'+esc(a.ambassador_name)+'</div><span class="tag" style="background:'+(a.tier==='gold'?'#fef3c7;color:#92400e':a.tier==='silver'?'#f1f5f9;color:#475569':'#fef3c7;color:#92400e')+'">'+esc(a.tier||'bronze')+' ambassador</span><div style="margin-top:8px;font-size:13px;color:#64748b">'+parseInt(a.referrals_count||0)+' referrals | UGX '+parseInt(a.total_donated||0).toLocaleString()+' raised</div></div>').join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#127775;</div><h3>No Ambassadors Yet</h3><p style="color:#64748b">Be the first ambassador for this campaign!</p></div>'}
        ${req.session.user && !isAmbassador ? '<a href="/campaigns/'+req.params.id+'/ambassadors/apply" style="display:block;margin-top:20px;text-align:center;padding:16px;background:#f59e0b;color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Become an Ambassador</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/ambassadors/apply', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Become an Ambassador', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/ambassadors/save" class="card">
          <h2>Become a Campaign Ambassador</h2>
          <p style="color:#64748b">As an ambassador, you commit to sharing and promoting this campaign</p>
          <label>Your Name</label><input name="ambassador_name" value="${esc(req.session.user?.name||'')}" required>
          <label>Why do you want to be an ambassador?</label><textarea name="motivation" rows="3" placeholder="Tell us why you're passionate about this cause"></textarea>
          <label>How will you promote this campaign?</label><textarea name="promotion_plan" rows="3" placeholder="Social media, community events, workplace, etc."></textarea>
          <label>Social media following (approx)</label><input name="social_reach" type="number" placeholder="1000" value="0">
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Apply as Ambassador</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/ambassadors/save', requireAuth, ah(async (req, res) => {
    const { ambassador_name, motivation, promotion_plan, social_reach } = req.body;
    const t = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0]?.tenant_id;
    await pool.query('INSERT INTO campaign_ambassadors(tenant_id,campaign_id,ambassador_name,ambassador_email,motivation,promotion_plan,social_reach) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [t, req.params.id, ambassador_name, req.session.user.email, motivation||'', promotion_plan||'', social_reach||0]);
    const result = await pool.query('SELECT id FROM campaign_ambassadors WHERE tenant_id=$1 AND campaign_id=$2 AND ambassador_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, req.session.user.email]);
    if (result.rows[0]) await audit(req.session.user.email, 'ambassador_created', 'campaign_ambassadors id=' + result.rows[0].id);
    res.redirect('/campaigns/'+req.params.id+'/ambassadors');
  }));

  // =============================================
  // V4 FEATURE 4: IMPACT REPORTS
  // =============================================

  app.get('/campaigns/:id/impact-report', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as donor_count FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const [impacts, milestones, breakdown, updates, testimonials] = await Promise.all([
      pool.query('SELECT * FROM donor_impact WHERE campaign_id=$1 AND verified=true ORDER BY created_at DESC', [req.params.id]),
      pool.query('SELECT * FROM campaign_milestones WHERE campaign_id=$1 AND is_completed=true ORDER BY reached_at DESC', [req.params.id]),
      pool.query('SELECT * FROM campaign_goal_breakdown WHERE campaign_id=$1 ORDER BY sort_order', [req.params.id]),
      pool.query('SELECT * FROM campaign_updates WHERE campaign_id=$1 AND is_public=true ORDER BY created_at DESC LIMIT 5', [req.params.id]),
      pool.query("SELECT * FROM campaign_testimonials WHERE campaign_id=$1 AND is_approved=true ORDER BY created_at DESC LIMIT 3", [req.params.id])
    ]);
    const pct = c.target > 0 ? Math.min(100, Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100)) : 0;

    res.send(renderPage('Impact Report - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="background:linear-gradient(135deg,#059669,#10b981);padding:40px;border-radius:20px;color:white;text-align:center;margin-bottom:24px">
          <h1 style="font-size:32px;font-weight:900;margin:0 0 8px 0">Impact Report</h1>
          <h2 style="font-size:22px;opacity:0.9;margin:0">${esc(c.title)}</h2>
          <p style="opacity:0.8;margin-top:8px">by ${esc(c.org_name)}</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#059669">UGX ${parseInt(c.raised||0).toLocaleString()}</div><div style="color:#64748b;font-size:14px">Total Raised</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#4f46e5">${parseInt(c.donor_count||0)}</div><div style="color:#64748b;font-size:14px">Donors</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#f59e0b">${pct}%</div><div style="color:#64748b;font-size:14px">Funded</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#7c3aed">${c.estimated_beneficiaries||'N/A'}</div><div style="color:#64748b;font-size:14px">Beneficiaries</div></div>
        </div>
        ${breakdown.rows.length > 0 ? '<div class="card" style="margin-bottom:20px"><h3>How Funds Are Being Used</h3><div style="display:grid;gap:12px">'+breakdown.rows.map(b => {
          const bPct = c.target > 0 ? Math.round(parseInt(b.amount)/parseInt(c.target)*100) : 0;
          return '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f8fafc;border-radius:10px"><div style="flex:1"><div style="font-weight:700">'+esc(b.item_name)+'</div>'+(b.description?'<div style="font-size:13px;color:#64748b">'+esc(b.description)+'</div>':'')+'</div><div style="text-align:right"><div style="font-weight:800;color:#059669">UGX '+parseInt(b.amount).toLocaleString()+'</div><div style="font-size:12px;color:#64748b">'+bPct+'% of total</div></div></div>';
        }).join('')+'</div></div>' : ''}
        ${impacts.rows.length > 0 ? '<div class="card" style="margin-bottom:20px"><h3>Verified Impact</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">'+impacts.rows.map(i => '<div style="background:#f0fdf4;border-radius:12px;padding:16px;text-align:center"><div style="font-size:24px;font-weight:900;color:#059669">'+esc(i.impact_value||'0')+'</div><div style="font-size:13px;color:#64748b">'+esc(i.impact_unit||'people')+'</div><div style="font-size:12px;color:#94a3b8;margin-top:4px">'+esc(i.impact_description||'')+'</div></div>').join('')+'</div></div>' : ''}
        ${milestones.rows.length > 0 ? '<div class="card" style="margin-bottom:20px"><h3>Milestones Achieved</h3>'+milestones.rows.map(m => '<div style="padding:12px;border-left:4px solid #059669;margin-bottom:8px;background:#f8fafc;border-radius:0 10px 10px 0"><strong>'+esc(m.title)+'</strong> <span style="font-size:12px;color:#64748b">'+(m.reached_at?new Date(m.reached_at).toLocaleDateString():'')+'</span>'+(m.description?'<p style="margin:4px 0;font-size:14px;color:#475569">'+esc(m.description)+'</p>':'')+'</div>').join('')+'</div>' : ''}
        ${testimonials.rows.length > 0 ? '<div class="card" style="margin-bottom:20px"><h3>Beneficiary Voices</h3>'+testimonials.rows.map(t => '<div style="background:#faf5ff;border-radius:12px;padding:16px;margin-bottom:10px;border-left:4px solid #7c3aed"><p style="font-style:italic;color:#475569">"'+esc(t.content)+'"</p><strong style="font-size:14px">'+esc(t.author_name)+'</strong></div>').join('')+'</div>' : ''}
        <div style="background:#f8fafc;border-radius:12px;padding:20px;text-align:center">
          <p style="color:#64748b;font-size:14px">This impact report was generated on ${new Date().toLocaleDateString()} based on data from the campaign organizer.</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
            <a href="/discover/${c.id}" class="btn btn-sm">View Campaign</a>
            <a href="/campaigns/${c.id}/impact" class="btn btn-sm" style="background:#059669;color:white">Add Impact Data</a>
          </div>
        </div>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V4 FEATURE 5: SMART DONATION SUGGESTIONS
  // =============================================

  // =============================================
  // V4 FEATURE 6: CAMPAIGN MERCHANDISE
  // =============================================

  app.get('/campaigns/:id/merch', ah(async (req, res) => {
    const c = (await pool.query('SELECT fc.*, t.name as org_name FROM fundraising_campaigns fc JOIN tenants t ON fc.tenant_id=t.id WHERE fc.id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');
    const items = (await pool.query('SELECT * FROM campaign_merchandise WHERE campaign_id=$1 AND is_active=true ORDER BY price ASC', [req.params.id])).rows;
    res.send(renderPage('Merchandise - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Support & Get Merch!</h1>
          <p style="color:#64748b">Every purchase supports "${esc(c.title)}"</p>
        </div>
        ${items.length > 0 ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px">' + items.map(i => '<div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">'+(i.image_url?'<div style="height:200px;overflow:hidden"><img src="'+esc(i.image_url)+'" style="width:100%;height:100%;object-fit:cover"></div>':'<div style="height:200px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:white;font-size:48px;font-weight:900">'+esc(i.item_name[0])+'</div>')+'<div style="padding:16px"><h3 style="font-weight:700">'+esc(i.item_name)+'</h3>'+(i.description?'<p style="color:#64748b;font-size:13px;margin:4px 0">'+esc(i.description)+'</p>':'')+'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><span style="font-size:20px;font-weight:800;color:#059669">UGX '+parseInt(i.price).toLocaleString()+'</span>'+(i.quantity_available?'<span style="font-size:12px;color:#64748b">'+parseInt(i.quantity_available-i.quantity_sold||0)+' left</span>':'<span style="font-size:12px;color:#059669">Available</span>')+'</div>'+(i.is_donation?'<div style="font-size:11px;color:#059669;font-weight:700;margin-top:4px">100% goes to campaign</div>':'')+'</div></div>').join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#128090;</div><h3>No Merchandise Available</h3><p style="color:#64748b">The organizer has not set up merchandise yet.</p></div>'}
        ${req.session.user && c.tenant_id === req.session.user.tenant_id ? '<a href="/campaigns/'+c.id+'/merch/new" style="display:block;margin-top:20px;text-align:center;padding:16px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700">Add Merchandise</a>' : ''}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/merch/new', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    res.send(renderPage('Add Merchandise', `
      <div style="max-width:500px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/merch/save" class="card">
          <h2>Add Merchandise</h2>
          <label>Item Name</label><input name="item_name" placeholder="e.g., Campaign T-Shirt" required>
          <label>Description</label><textarea name="description" rows="2" placeholder="Describe the item"></textarea>
          <label>Price (UGX)</label><input name="price" type="number" placeholder="30000" required>
          <label>Image URL</label><input name="image_url" placeholder="https://...">
          <label>Quantity Available (blank = unlimited)</label><input name="quantity_available" type="number" placeholder="50">
          <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_donation" checked> 100% of proceeds go to campaign</label>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Add Merchandise</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/merch/save', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const { item_name, description, price, image_url, quantity_available, is_donation } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query('INSERT INTO campaign_merchandise(tenant_id,campaign_id,item_name,description,price,image_url,quantity_available,is_donation) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, req.params.id, item_name, description||'', price, image_url||null, quantity_available||null, is_donation?true:false]);
    res.redirect('/campaigns/'+req.params.id+'/merch');
  }));

  // =============================================
  // V4 FEATURE 7: COMMUNITY BOARD
  // =============================================

  app.get('/campaigns/:id/community', ah(async (req, res) => {
    const posts = (await pool.query('SELECT * FROM campaign_community_posts WHERE campaign_id=$1 AND status=$2 ORDER BY is_pinned DESC, created_at DESC LIMIT 30', [req.params.id, 'visible'])).rows;
    res.send(renderPage('Community Board', `
      <div style="max-width:800px;margin:0 auto;padding:20px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="font-size:28px;font-weight:800">Community Board</h1>
          <p style="color:#64748b">Discuss, share ideas, and support each other</p>
        </div>
        ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/community/new" style="display:block;margin-bottom:20px;padding:14px;background:#4f46e5;color:white;text-align:center;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">Start a Discussion</a>' : ''}
        ${posts.length > 0 ? posts.map(p => '<div style="background:white;border-radius:12px;padding:20px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04)'+(p.is_pinned?';border:2px solid #f59e0b':'')+'"><div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-weight:700;font-size:16px">'+esc(p.author_name)+'</div><div style="font-size:12px;color:#64748b">'+(p.post_type!=='discussion'?'<span class="tag" style="background:#e0e7ff;color:#3730a3;margin-right:4px">'+esc(p.post_type)+'</span>':'')+new Date(p.created_at).toLocaleDateString()+'</div></div>'+(p.is_pinned?'<span class="tag" style="background:#fef3c7;color:#92400e">Pinned</span>':'')+'</div><h3 style="margin:12px 0 8px;font-weight:700">'+esc(p.title)+'</h3><p style="color:#475569;line-height:1.6">'+esc(p.content).replace(/\n/g,'<br>')+'</p><div style="display:flex;gap:12px;margin-top:12px;font-size:13px;color:#64748b"><span>&#128077; '+parseInt(p.likes||0)+'</span><span>&#128172; '+parseInt(p.replies_count||0)+' replies</span></div></div>').join('') : '<div style="text-align:center;padding:40px;background:white;border-radius:16px"><div style="font-size:48px">&#128172;</div><h3>No Discussions Yet</h3><p style="color:#64748b">Be the first to start a conversation!</p></div>'}
      </div>
    `, req.session.user));
  }));

  app.get('/campaigns/:id/community/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Start Discussion', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <form method="POST" action="/campaigns/${req.params.id}/community/save" class="card">
          <h2>Start a Discussion</h2>
          <label>Topic</label><input name="title" placeholder="What would you like to discuss?" required>
          <label>Post Type</label>
          <select name="post_type"><option value="discussion">Discussion</option><option value="question">Question</option><option value="idea">Idea</option><option value="celebration">Celebration</option><option value="update">Update</option></select>
          <label>Content</label><textarea name="content" rows="5" placeholder="Share your thoughts..." required></textarea>
          <label>Your Name</label><input name="author_name" value="${esc(req.session.user?.name||'')}" required>
          <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px">Post</button>
        </form>
      </div>
    `, req.session.user));
  }));

  app.post('/campaigns/:id/community/save', requireAuth, ah(async (req, res) => {
    const { title, post_type, content, author_name } = req.body;
    const t = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0]?.tenant_id;
    await pool.query('INSERT INTO campaign_community_posts(tenant_id,campaign_id,author_name,author_email,title,post_type,content) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [t, req.params.id, author_name, req.session.user.email, title, post_type||'discussion', content]);
    const result = await pool.query('SELECT id FROM campaign_community_posts WHERE tenant_id=$1 AND campaign_id=$2 AND author_email=$3 ORDER BY created_at DESC LIMIT 1', [t, req.params.id, req.session.user.email]);
    if (result.rows[0]) await audit(req.session.user.email, 'community_post_created', 'campaign_community_posts id=' + result.rows[0].id);
    res.redirect('/campaigns/'+req.params.id+'/community');
  }));

  // =============================================
  // V4 FEATURE 8: DONOR SEGMENTATION
  // =============================================

  app.get('/admin/donor-segments', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const [segments, topDonors, newDonors, recurring, lapsed] = await Promise.all([
      pool.query('SELECT * FROM donor_segments WHERE tenant_id=$1 ORDER BY created_at DESC', [t]),
      pool.query('SELECT donor_name, donor_email, SUM(amount) as total FROM campaign_donations WHERE tenant_id=$1 AND refunded=false GROUP BY donor_name, donor_email ORDER BY total DESC LIMIT 10', [t]),
      pool.query("SELECT donor_name, donor_email, SUM(amount) as total FROM campaign_donations WHERE tenant_id=$1 AND refunded=false AND donated_at >= NOW() - INTERVAL '30 days' GROUP BY donor_name, donor_email ORDER BY total DESC LIMIT 10", [t]),
      pool.query("SELECT dp.full_name, dp.user_email, dp.total_donated, dp.donation_count FROM donor_profiles dp WHERE dp.tenant_id=$1 AND dp.is_recurring_donor=true", [t]),
      pool.query("SELECT dp.full_name, dp.user_email, dp.total_donated, dp.last_donation_at FROM donor_profiles dp WHERE dp.tenant_id=$1 AND dp.last_donation_at < NOW() - INTERVAL '90 days' ORDER BY dp.total_donated DESC LIMIT 20", [t])
    ]);
    res.send(renderPage('Donor Segmentation', `
      <div style="max-width:1000px;margin:0 auto;padding:20px">
        <h1 style="margin-bottom:24px">Donor Segmentation & Targeting</h1>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#f59e0b">${topDonors.rows.length}</div><div style="color:#64748b">Top Donors</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#059669">${newDonors.rows.length}</div><div style="color:#64748b">New (30 days)</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#4f46e5">${recurring.rows.length}</div><div style="color:#64748b">Recurring</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#ef4444">${lapsed.rows.length}</div><div style="color:#64748b">Lapsed (90+ days)</div></div>
        </div>
        <div class="card" style="margin-bottom:20px"><h3>Top Donors (All Time)</h3><table><tr><th>Name</th><th>Total</th></tr>${topDonors.rows.map(d => '<tr><td>'+esc(d.donor_name)+'</td><td style="font-weight:700;color:#059669">UGX '+parseInt(d.total).toLocaleString()+'</td></tr>').join('')||'<tr><td colspan="2">No data</td></tr>'}</table></div>
        <div class="card" style="margin-bottom:20px"><h3>Recurring Donors</h3><table><tr><th>Name</th><th>Total</th><th>Count</th></tr>${recurring.rows.map(d => '<tr><td>'+esc(d.full_name)+'</td><td style="font-weight:700;color:#059669">UGX '+parseInt(d.total_donated).toLocaleString()+'</td><td>'+parseInt(d.donation_count)+'</td></tr>').join('')||'<tr><td colspan="3">No recurring donors yet. Encourage monthly giving!</td></tr>'}</table></div>
        <div class="card"><h3>Lapsed Donors (90+ days since last donation)</h3><p style="color:#64748b;font-size:14px;margin-bottom:12px">These donors haven't given in 3+ months. Consider reaching out!</p><table><tr><th>Name</th><th>Last Donation</th><th>Historical Total</th></tr>${lapsed.rows.map(d => '<tr><td>'+esc(d.full_name)+'</td><td>'+(d.last_donation_at?new Date(d.last_donation_at).toLocaleDateString():'N/A')+'</td><td style="font-weight:700;color:#f59e0b">UGX '+parseInt(d.total_donated).toLocaleString()+'</td></tr>').join('')||'<tr><td colspan="3">No lapsed donors - great job!</td></tr>'}</table></div>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V4 FEATURE 9: CAMPAIGN HEALTH MONITOR
  // =============================================

  app.get('/campaigns/:id/health', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const c = (await pool.query('SELECT fc.*, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as raised, (SELECT COUNT(*) FROM campaign_donations WHERE campaign_id=fc.id AND refunded=false) as donor_count, (SELECT MAX(donated_at) FROM campaign_donations WHERE campaign_id=fc.id) as last_donation, (SELECT COUNT(*) FROM campaign_updates WHERE campaign_id=fc.id) as update_count, (SELECT COUNT(*) FROM campaign_comments WHERE campaign_id=fc.id) as comment_count, (SELECT COUNT(*) FROM campaign_followers WHERE campaign_id=fc.id) as follower_count FROM fundraising_campaigns fc WHERE fc.id=$1 AND fc.tenant_id=$2', [req.params.id, t])).rows[0];
    if (!c) return res.status(404).send('Campaign not found');

    // Calculate health metrics
    const daysSinceCreation = Math.max(1, Math.ceil((new Date() - new Date(c.created_at)) / (1000*60*60*24)));
    const daysLeft = c.deadline ? Math.max(0, Math.ceil((new Date(c.deadline) - new Date()) / (1000*60*60*24))) : null;
    const pct = c.target > 0 ? Math.round(parseInt(c.raised||0)/parseInt(c.target)*100) : 0;
    const dailyRate = parseInt(c.raised||0) / daysSinceCreation;
    const projectedTotal = dailyRate * (daysLeft ? (daysSinceCreation + daysLeft) : daysSinceCreation * 2);
    const projectedPct = c.target > 0 ? Math.min(100, Math.round(projectedTotal / parseInt(c.target) * 100)) : 0;
    const daysSinceLastDonation = c.last_donation ? Math.ceil((new Date() - new Date(c.last_donation)) / (1000*60*60*24)) : 999;
    const lastUpdateDays = c.updated_at ? Math.ceil((new Date() - new Date(c.updated_at)) / (1000*60*60*24)) : 999;

    // Health scores
    const fundingHealth = pct >= 75 ? 'excellent' : pct >= 40 ? 'good' : pct >= 15 ? 'fair' : 'critical';
    const engagementHealth = parseInt(c.donor_count) > 20 ? 'excellent' : parseInt(c.donor_count) > 5 ? 'good' : parseInt(c.donor_count) > 0 ? 'fair' : 'critical';
    const momentumHealth = daysSinceLastDonation <= 2 ? 'excellent' : daysSinceLastDonation <= 7 ? 'good' : daysSinceLastDonation <= 30 ? 'fair' : 'critical';
    const updateHealth = lastUpdateDays <= 7 ? 'excellent' : lastUpdateDays <= 14 ? 'good' : lastUpdateDays <= 30 ? 'fair' : 'critical';

    const healthColors = { excellent:'#059669', good:'#0891b2', fair:'#f59e0b', critical:'#ef4444' };
    const healthLabels = { excellent:'Excellent', good:'Good', fair:'Needs Attention', critical:'Critical' };

    const alerts = [];
    if (fundingHealth === 'critical') alerts.push({ type: 'danger', msg: 'Funding is critically low. Consider adding matching sponsors or sharing more aggressively.' });
    if (momentumHealth === 'critical') alerts.push({ type: 'danger', msg: 'No donations in 30+ days. Post an update and re-share on social media.' });
    if (updateHealth === 'fair' || updateHealth === 'critical') alerts.push({ type: 'warning', msg: 'Campaign hasn\'t been updated recently. Regular updates boost donor confidence.' });
    if (daysLeft && daysLeft <= 7 && pct < 75) alerts.push({ type: 'warning', msg: 'Deadline approaching with less than 75% funded. Consider extending the deadline.' });
    if (!c.image_url) alerts.push({ type: 'info', msg: 'Add a cover image to increase donations by 2x.' });
    if (!c.video_url) alerts.push({ type: 'info', msg: 'Add a video to tell your story more effectively.' });
    if (pct >= 100 && c.status !== 'completed') alerts.push({ type: 'success', msg: 'Goal reached! Mark the campaign as completed.' });

    res.send(renderPage('Campaign Health - '+c.title, `
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="margin-bottom:8px">Campaign Health Monitor</h1>
        <h2 style="color:#64748b;font-size:18px;font-weight:400;margin-bottom:24px">${esc(c.title)}</h2>
        ${alerts.length > 0 ? '<div style="margin-bottom:24px">'+alerts.map(a => '<div style="padding:14px;border-radius:10px;margin-bottom:8px;background:'+({danger:'#fee2e2;color:#991b1b',warning:'#fef3c7;color:#92400e',info:'#e0e7ff;color:#3730a3',success:'#d1fae5;color:#065f46'}[a.type])+';border-left:4px solid '+({danger:'#ef4444',warning:'#f59e0b',info:'#4f46e5',success:'#059669'}[a.type])+'">'+esc(a.msg)+'</div>').join('')+'</div>' : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
          ${[['Funding',fundingHealth,pct+'% funded'],['Engagement',engagementHealth,parseInt(c.donor_count)+' donors'],['Momentum',momentumHealth,daysSinceLastDonation<=999?daysSinceLastDonation+'d since last donation':'No donations yet'],['Updates',updateHealth,lastUpdateDays<=999?lastUpdateDays+'d since last update':'Never updated']].map(([name,health,val]) => '<div style="background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-top:4px solid '+healthColors[health]+'"><div style="font-weight:700;margin-bottom:4px">'+name+'</div><div style="font-size:24px;font-weight:900;color:'+healthColors[health]+'">'+healthLabels[health]+'</div><div style="font-size:13px;color:#64748b;margin-top:4px">'+val+'</div></div>').join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#059669">UGX ${Math.round(dailyRate).toLocaleString()}</div><div style="color:#64748b;font-size:14px">Daily Rate</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#4f46e5">${projectedPct}%</div><div style="color:#64748b;font-size:14px">Projected at Deadline</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#f59e0b">${parseInt(c.follower_count||0)}</div><div style="color:#64748b;font-size:14px">Followers</div></div>
          <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:28px;font-weight:900;color:#0891b2">${parseInt(c.update_count||0)}</div><div style="color:#64748b;font-size:14px">Updates Posted</div></div>
        </div>
        <div class="card"><h3>Quick Actions to Improve Health</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px">
            <a href="/campaigns/${c.id}/emails/new" style="padding:14px;background:#e0e7ff;border-radius:10px;text-decoration:none;color:#3730a3;font-weight:700;text-align:center">Email Donors</a>
            <a href="/fundraising/${c.id}/update" style="padding:14px;background:#d1fae5;border-radius:10px;text-decoration:none;color:#065f46;font-weight:700;text-align:center">Post Update</a>
            <a href="/campaigns/${c.id}/matching/new" style="padding:14px;background:#fef3c7;border-radius:10px;text-decoration:none;color:#92400e;font-weight:700;text-align:center">Add Matching</a>
            <a href="/campaigns/${c.id}/peer" style="padding:14px;background:#faf5ff;border-radius:10px;text-decoration:none;color:#7c3aed;font-weight:700;text-align:center">Peer Fundraising</a>
            <a href="/campaigns/${c.id}/success-score" style="padding:14px;background:#f0fdf4;border-radius:10px;text-decoration:none;color:#065f46;font-weight:700;text-align:center">Success Score</a>
          </div>
        </div>
      </div>
    `, req.session.user));
  }));

  // =============================================
  // V4 FEATURE 10: MULTI-LANGUAGE SUPPORT
  // =============================================

  app.get('/api/campaigns/:id/translate', ah(async (req, res) => {
    const { lang } = req.query;
    if (!lang) return res.status(400).json({ error: 'Provide ?lang parameter (e.g., en, fr, sw, lg)' });
    const c = (await pool.query('SELECT title, description, story, impact_summary FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Campaign not found' });
    // Check for existing translation
    const existing = (await pool.query('SELECT * FROM campaign_translations WHERE campaign_id=$1 AND language=$2', [req.params.id, lang])).rows[0];
    if (existing) return res.json({ language: lang, translated: existing });
    // Return original with language hint for client-side translation
    res.json({ language: lang, original: c, note: 'Use client-side translation or add a manual translation via POST /api/campaigns/'+req.params.id+'/translate' });
  }));

  app.post('/api/campaigns/:id/translate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { language, title, description, story, impact_summary } = req.body;
    const t = req.session.user.tenant_id;
    await pool.query(`INSERT INTO campaign_translations(tenant_id,campaign_id,language,title,description,story,impact_summary,translated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (campaign_id, language) DO UPDATE SET title=$4,description=$5,story=$6,impact_summary=$7,translated_by=$8,updated_at=NOW()`,
      [t, req.params.id, language, title, description||null, story||null, impact_summary||null, req.session.user.email]);
    res.json({ success: true, message: 'Translation saved for language: '+language });
  }));

  // API: Get available translations for a campaign
  app.get('/api/campaigns/:id/languages', ah(async (req, res) => {
    const translations = (await pool.query('SELECT language, title FROM campaign_translations WHERE campaign_id=$1', [req.params.id])).rows;
    res.json({ available_languages: translations.map(t => t.language), translations });
  }));

  // =============================================
  // V4: UPDATED ENHANCED DASHBOARD WITH V4 LINKS
  // =============================================

  // Add V4 links to the existing enhanced dashboard (override by re-registering)
  app.get('/fundraising/v4-dashboard', requireAuth, requireNotBanned, requireFundraisingSubscription, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const [campaigns, donors, payouts, refunds, challenges, giftCards, healthAlerts] = await Promise.all([
      pool.query("SELECT id, title, status, target, (SELECT COALESCE(SUM(amount),0) FROM campaign_donations WHERE campaign_id=fundraising_campaigns.id) as raised, featured, urgency_level, success_score, is_verified, verification_badge FROM fundraising_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC", [t]),
      pool.query('SELECT COUNT(*) as count, SUM(total_donated) as total FROM donor_profiles WHERE tenant_id=$1', [t]),
      pool.query("SELECT COUNT(*) as count, SUM(amount) as total FROM payout_requests WHERE tenant_id=$1 AND status='pending'", [t]),
      pool.query("SELECT COUNT(*) as count FROM refund_requests WHERE tenant_id=$1 AND status='pending'", [t]),
      pool.query("SELECT COUNT(*) as count FROM campaign_challenges WHERE tenant_id=$1 AND status='active'", [t]),
      pool.query("SELECT COUNT(*) as count FROM donation_gift_cards WHERE purchaser_email=$1", [req.session.user.email]),
      pool.query("SELECT COUNT(*) as count FROM fundraising_campaigns WHERE tenant_id=$1 AND status='active'", [t])
    ]);
    const activeCampaigns = campaigns.rows.filter(c => c.status === 'active');
    const totalRaised = campaigns.rows.reduce((a,c) => a + parseInt(c.raised||0), 0);

    res.send(renderPage('Fundraising V4 Dashboard', `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#ec4899,#f59e0b)">
        <h1>Fundraising V4 Dashboard</h1>
        <p>All features for campaign success</p>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <a href="/fundraising" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Campaigns</a>
          <a href="/admin/donors" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Donors</a>
          <a href="/admin/donor-segments" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Segments</a>
          <a href="/admin/donor-retention" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Retention</a>
          <a href="/challenges" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Challenges</a>
          <a href="/gift-cards" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Gift Cards</a>
          <a href="/donor-leaderboard" class="btn" style="background:rgba(255,255,255,0.2);color:white;border:2px solid rgba(255,255,255,0.4)">Leaderboard</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${campaigns.rows.length}</div><div>Total Campaigns</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${activeCampaigns.length}</div><div>Active</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">UGX ${totalRaised.toLocaleString()}</div><div>Total Raised</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ec4899">${parseInt(donors.rows[0]?.count||0)}</div><div>Donors</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${parseInt(challenges.rows[0]?.count||0)}</div><div>Active Challenges</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${parseInt(giftCards.rows[0]?.count||0)}</div><div>Gift Cards</div></div>
      </div>
      <div class="card">
        <h3>All Campaigns</h3>
        <table><tr><th>Campaign</th><th>Status</th><th>Raised</th><th>Goal</th><th>Score</th><th>Health</th><th>Actions</th></tr>
        ${campaigns.rows.map(c => {
          const pct = c.target > 0 ? Math.round(parseInt(c.raised||0)/parseInt(c.target||1)*100) : 0;
          return '<tr><td><strong>'+esc(c.title)+'</strong>'+(c.is_verified?' <span style="background:#d1fae5;color:#065f46;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700">Verified</span>':'')+(c.featured?' <span style="background:#f59e0b;color:white;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700">Featured</span>':'')+'</td><td><span class="tag" style="background:'+(c.status==='active'?'#d1fae5;color:#065f46':'#fef3c7;color:#92400e')+'">'+esc(c.status)+'</span></td><td style="font-weight:700;color:#059669">UGX '+(parseInt(c.raised)||0).toLocaleString()+'</td><td>UGX '+(parseInt(c.target)||0).toLocaleString()+'</td><td style="font-weight:700;color:'+(parseFloat(c.success_score)>=70?'#059669':parseFloat(c.success_score)>=40?'#f59e0b':'#ef4444')+'">'+parseFloat(c.success_score||0).toFixed(0)+'</td><td><a href="/campaigns/'+c.id+'/health" class="btn btn-sm" style="background:#4f46e5;color:white">Health</a></td><td><a href="/fundraising/'+c.id+'" class="btn btn-sm">View</a> <a href="/campaigns/'+c.id+'/rewards/manage" class="btn btn-sm" style="background:#f59e0b;color:white">Rewards</a> <a href="/campaigns/'+c.id+'/success-score" class="btn btn-sm" style="background:#7c3aed;color:white">Score</a></td></tr>';
        }).join('')||'<tr><td colspan="7">No campaigns yet</td></tr>'}
        </table>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:20px">
        <a href="/gift-cards" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #f59e0b"><div style="font-size:32px;margin-bottom:8px">&#127873;</div><h4>Gift Cards</h4><p class="muted" style="font-size:13px">Give the gift of giving</p></a>
        <a href="/challenges" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #7c3aed"><div style="font-size:32px;margin-bottom:8px">&#127942;</div><h4>Challenges</h4><p class="muted" style="font-size:13px">Compete and fundraise together</p></a>
        <a href="/admin/donor-segments" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #ec4899"><div style="font-size:32px;margin-bottom:8px">&#128101;</div><h4>Donor Segments</h4><p class="muted" style="font-size:13px">Targeted communications</p></a>
        <a href="/donor-leaderboard" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #059669"><div style="font-size:32px;margin-bottom:8px">&#127941;</div><h4>Leaderboard</h4><p class="muted" style="font-size:13px">Top donor recognition</p></a>
        <a href="/admin/donor-retention" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #0891b2"><div style="font-size:32px;margin-bottom:8px">&#128200;</div><h4>Retention</h4><p class="muted" style="font-size:13px">Keep donors coming back</p></a>
        <a href="/admin/verifications" class="card" style="text-decoration:none;text-align:center;padding:24px;color:inherit;border-top:4px solid #10b981"><div style="font-size:32px;margin-bottom:8px">&#9989;</div><h4>Verifications</h4><p class="muted" style="font-size:13px">Trust badges for campaigns</p></a>
      </div>
    `, req.session.user));
  }));

  console.log('[Fundraising V5] Donor Referrals, Auctions, Pledges, Social Media Scheduler, Tributes/Memorials, Story Templates, Thermometer API, CRM Export, Campaign Comparison + All V4 Features');

  // =============================================
  // V5 FEATURE 1: DONOR REFERRAL PROGRAM
  // =============================================
  // API: Generate referral code for a campaign
  app.get('/api/campaigns/:id/referral-code', requireAuth, ah(async (req, res) => {
    try {
      const campaign = (await pool.query('SELECT tenant_id, title, referral_code FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      if (!campaign.referral_code) {
        const code = 'REF-' + req.params.id + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        await pool.query('UPDATE fundraising_campaigns SET referral_code=$1 WHERE id=$2 AND tenant_id=$3', [code, req.params.id, req.session.user.tenant_id]);
        campaign.referral_code = code;
      }
      const referralLink = BASE_URL + '/campaigns/' + req.params.id + '?ref=' + campaign.referral_code;
      const stats = (await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(donated_amount),0) as total FROM donor_referrals WHERE campaign_id=$1 AND referrer_email=$2', [req.params.id, req.session.user.email])).rows[0];
      res.json({ referral_code: campaign.referral_code, referral_link: referralLink, referrals: parseInt(stats?.count||0), total_donated: parseInt(stats?.total||0) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // API: Track referral sign-up
  app.post('/api/referrals/track', ah(async (req, res) => {
    try {
      const { referral_code, referred_email, referred_name, campaign_id } = req.body;
      if (!referral_code || !referred_email) return res.status(400).json({ error: 'Missing required fields' });
      const ref = (await pool.query('SELECT * FROM donor_referrals WHERE referral_code=$1 AND tenant_id=$2', [referral_code, req.session.user.tenant_id])).rows[0];
      if (!ref) return res.status(404).json({ error: 'Invalid referral code' });
      await pool.query('UPDATE donor_referrals SET referred_email=$1, referred_name=$2, status=$3 WHERE id=$4 AND tenant_id=$5',
        [referred_email, referred_name||'', 'signed_up', ref.id, req.session.user.tenant_id]);
      await pool.query('UPDATE fundraising_campaigns SET referral_count=referral_count+1 WHERE id=$1 AND tenant_id=$2', [ref.campaign_id, req.session.user.tenant_id]);
      const result = await pool.query('SELECT id FROM donor_referrals WHERE id=$1', [ref.id]);
      if (result.rows[0]) await audit(req.session.user.email, 'referral_tracked', 'donor_referrals id=' + result.rows[0].id);
      res.json({ success: true, message: 'Referral tracked successfully' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // Referral dashboard page
  app.get('/campaigns/:id/referrals', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT title, tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const referrals = (await pool.query('SELECT * FROM donor_referrals WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id])).rows;
      const totalReferrals = referrals.length;
      const totalDonated = referrals.reduce((s, r) => s + parseInt(r.donated_amount||0), 0);
      res.send(renderPage('Referral Program - '+c.title, `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800">Donor Referral Program</h1>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0">
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#4f46e5">${totalReferrals}</div><div style="color:#64748b">Referrals</div></div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#059669">UGX ${totalDonated.toLocaleString()}</div><div style="color:#64748b">Donated via Referrals</div></div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:32px;font-weight:800;color:#f59e0b">${referrals.filter(r=>r.status==='rewarded').length}</div><div style="color:#64748b">Rewards Given</div></div>
          </div>
          <div class="card"><h3>Share Your Referral Link</h3>
            <p>Share this link with friends. When they donate, you both earn rewards!</p>
            <div style="background:#f1f5f9;padding:12px;border-radius:8px;font-family:monospace;word-break:break-all" id="refLink">${BASE_URL}/campaigns/${req.params.id}?ref=YOUR_CODE</div>
          </div>
          ${referrals.length > 0 ? '<div class="card"><h3>Referral History</h3><table style="width:100%;border-collapse:collapse"><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Referred</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:right">Donated</th><th style="padding:10px;text-align:right">Reward</th></tr>' + referrals.map(r => '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px">'+esc(r.referred_name||r.referred_email||'Pending')+'</td><td style="padding:10px"><span style="background:'+(r.status==='rewarded'?'#d1fae5;color:#065f46':r.status==='donated'?'#dbeafe;color:#1e40af':'#fef3c7;color:#92400e')+';padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">'+esc(r.status)+'</span></td><td style="padding:10px;text-align:right">UGX '+parseInt(r.donated_amount||0).toLocaleString()+'</td><td style="padding:10px;text-align:right">UGX '+parseInt(r.reward_amount||0).toLocaleString()+'</td></tr>').join('') + '</table></div>' : ''}
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // =============================================
  // V5 FEATURE 2: CAMPAIGN AUCTIONS
  // =============================================
  app.get('/campaigns/:id/auctions', ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const auctions = (await pool.query("SELECT * FROM campaign_auctions WHERE campaign_id=$1 AND status IN ('active','upcoming','ending_soon') ORDER BY end_date ASC", [req.params.id])).rows;
      res.send(renderPage('Auctions - '+c.title, `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800;text-align:center">Campaign Auctions</h1>
          <p style="text-align:center;color:#64748b">Bid on items to support this campaign!</p>
          ${auctions.length > 0 ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;margin-top:24px">' + auctions.map(a => `
            <div style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
              ${a.image_url ? '<img src="'+esc(a.image_url)+'" style="width:100%;height:180px;object-fit:cover">' : '<div style="height:180px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;color:white;font-size:48px">&#128276;</div>'}
              <div style="padding:16px">
                <h3 style="font-size:18px;font-weight:700">${esc(a.item_name)}</h3>
                <p style="color:#64748b;font-size:14px;margin:4px 0">${esc(a.description||'').substring(0,80)}</p>
                <div style="display:flex;justify-content:space-between;margin-top:12px;padding:12px;background:#f8fafc;border-radius:8px">
                  <div><div style="font-size:12px;color:#64748b">Current Bid</div><div style="font-weight:800;color:#059669">UGX ${parseInt(a.current_bid||a.starting_bid).toLocaleString()}</div></div>
                  <div><div style="font-size:12px;color:#64748b">Bids</div><div style="font-weight:700">${a.total_bids}</div></div>
                </div>
                <div style="margin-top:12px;font-size:13px;color:#64748b">Ends: ${new Date(a.end_date).toLocaleDateString()}</div>
                ${a.buy_now_price ? '<div style="margin-top:8px"><a href="/campaigns/'+req.params.id+'/auctions/'+a.id+'/bid" style="display:block;padding:10px;background:#059669;color:white;border-radius:8px;text-align:center;font-weight:700;text-decoration:none">Buy Now: UGX '+parseInt(a.buy_now_price).toLocaleString()+'</a></div>' : '<a href="/campaigns/'+req.params.id+'/auctions/'+a.id+'/bid" style="display:block;margin-top:8px;padding:10px;background:#4f46e5;color:white;border-radius:8px;text-align:center;font-weight:700;text-decoration:none">Place Bid</a>'}
              </div>
            </div>
          `).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px;margin-top:24px"><div style="font-size:48px">&#128276;</div><h3>No Active Auctions</h3><p style="color:#64748b">Auction items will be posted by the campaign organizer.</p></div>'}
          ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/auctions/new" style="display:block;margin-top:24px;text-align:center;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700">Create Auction Item</a>' : ''}
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // Create auction item
  app.get('/campaigns/:id/auctions/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Create Auction Item', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <div class="card"><h2>Create Auction Item</h2>
          <form method="POST" action="/campaigns/${req.params.id}/auctions/save">
            <label>Item Name</label><input name="item_name" placeholder="e.g., Signed Artwork" required>
            <label>Description</label><textarea name="description" rows="3" placeholder="Describe the auction item"></textarea>
            <label>Image URL</label><input name="image_url" placeholder="https://...">
            <label>Starting Bid (UGX)</label><input name="starting_bid" type="number" min="0" value="50000" required>
            <label>Bid Increment (UGX)</label><input name="bid_increment" type="number" min="1000" value="10000">
            <label>Reserve Price (UGX, optional)</label><input name="reserve_price" type="number" min="0">
            <label>Buy Now Price (UGX, optional)</label><input name="buy_now_price" type="number" min="0">
            <label>Auction Start</label><input name="start_date" type="datetime-local" required>
            <label>Auction End</label><input name="end_date" type="datetime-local" required>
            <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Create Auction</button>
          </form>
        </div>
      </div>
    `));
  }));

  app.post('/campaigns/:id/auctions/save', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      await pool.query('INSERT INTO campaign_auctions(tenant_id,campaign_id,item_name,description,image_url,starting_bid,current_bid,bid_increment,reserve_price,buy_now_price,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11)',
        [c.tenant_id, req.params.id, req.body.item_name, req.body.description||'', req.body.image_url||'', parseInt(req.body.starting_bid)||50000, parseInt(req.body.bid_increment)||10000, parseInt(req.body.reserve_price)||null, parseInt(req.body.buy_now_price)||null, req.body.start_date, req.body.end_date]);
      const result = await pool.query('SELECT id FROM campaign_auctions WHERE tenant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC LIMIT 1', [c.tenant_id, req.params.id]);
      if (result.rows[0]) await audit(req.session.user.email, 'auction_created', 'campaign_auctions id=' + result.rows[0].id);
      await pool.query('UPDATE fundraising_campaigns SET has_auctions=true, auction_count=auction_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, c.tenant_id]);
      res.redirect('/campaigns/'+req.params.id+'/auctions');
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // Place bid page
  app.get('/campaigns/:campaignId/auctions/:auctionId/bid', requireAuth, ah(async (req, res) => {
    try {
      const auction = (await pool.query('SELECT * FROM campaign_auctions WHERE id=$1 AND tenant_id=$2', [req.params.auctionId, req.session.user.tenant_id])).rows[0];
      if (!auction) return res.status(404).send('Auction not found');
      const minBid = parseInt(auction.current_bid||auction.starting_bid) + parseInt(auction.bid_increment);
      res.send(renderPage('Bid on '+auction.item_name, `
        <div style="max-width:600px;margin:0 auto;padding:20px">
          <div class="card">
            <h2>${esc(auction.item_name)}</h2>
            <p style="color:#64748b">${esc(auction.description||'')}</p>
            <div style="background:#f0fdf4;padding:16px;border-radius:12px;margin:16px 0;text-align:center">
              <div style="font-size:14px;color:#64748b">Current Bid</div>
              <div style="font-size:32px;font-weight:800;color:#059669">UGX ${parseInt(auction.current_bid||auction.starting_bid).toLocaleString()}</div>
              <div style="font-size:13px;color:#64748b">${auction.total_bids} bid(s) | Ends ${new Date(auction.end_date).toLocaleString()}</div>
            </div>
            <form method="POST" action="/campaigns/${req.params.campaignId}/auctions/${req.params.auctionId}/bid/save">
              <label>Your Bid (min: UGX ${minBid.toLocaleString()})</label>
              <input name="bid_amount" type="number" min="${minBid}" value="${minBid}" required>
              <label>Your Name</label><input name="bidder_name" value="${esc(req.session.user?.name||'')}" required>
              <label>Your Email</label><input name="bidder_email" value="${esc(req.session.user?.email||'')}" required>
              <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Place Bid</button>
            </form>
          </div>
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  app.post('/campaigns/:campaignId/auctions/:auctionId/bid/save', requireAuth, ah(async (req, res) => {
    try {
      const auction = (await pool.query('SELECT * FROM campaign_auctions WHERE id=$1 AND tenant_id=$2', [req.params.auctionId, req.session.user.tenant_id])).rows[0];
      if (!auction) return res.status(404).send('Auction not found');
      const bidAmount = parseInt(req.body.bid_amount);
      const minBid = parseInt(auction.current_bid||auction.starting_bid) + parseInt(auction.bid_increment);
      if (bidAmount < minBid) return res.status(400).send('Bid must be at least UGX '+minBid.toLocaleString());
      const tenant_id = auction.tenant_id;
      // Mark all previous bids as not winning
      await pool.query('UPDATE auction_bids SET is_winning=false WHERE auction_id=$1 AND tenant_id=$2', [auction.id, tenant_id]);
      await pool.query('INSERT INTO auction_bids(tenant_id,auction_id,campaign_id,bidder_name,bidder_email,bid_amount,is_winning) VALUES($1,$2,$3,$4,$5,$6,true)',
        [tenant_id, auction.id, req.params.campaignId, req.body.bidder_name, req.body.bidder_email, bidAmount]);
      const result = await pool.query('SELECT id FROM auction_bids WHERE tenant_id=$1 AND auction_id=$2 AND bidder_email=$3 ORDER BY created_at DESC LIMIT 1', [tenant_id, auction.id, req.body.bidder_email]);
      if (result.rows[0]) await audit(req.session.user.email, 'bid_placed', 'auction_bids id=' + result.rows[0].id);
      // Update auction current bid
      await pool.query('UPDATE campaign_auctions SET current_bid=$1, current_bidder=$2, current_bidder_email=$3, total_bids=total_bids+1 WHERE id=$4 AND tenant_id=$5',
        [bidAmount, req.body.bidder_name, req.body.bidder_email, auction.id, tenant_id]);
      res.redirect('/campaigns/'+req.params.campaignId+'/auctions');
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // =============================================
  // V5 FEATURE 3: PLEDGE MANAGEMENT
  // =============================================
  app.get('/campaigns/:id/pledges', ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const pledges = (await pool.query('SELECT * FROM campaign_pledges WHERE campaign_id=$1 ORDER BY created_at DESC', [req.params.id])).rows;
      const totalPledged = pledges.reduce((s, p) => s + parseInt(p.pledged_amount||0), 0);
      const totalFulfilled = pledges.reduce((s, p) => s + parseInt(p.fulfilled_amount||0), 0);
      res.send(renderPage('Pledges - '+c.title, `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800">Campaign Pledges</h1>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0">
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:24px;font-weight:800;color:#4f46e5">UGX ${totalPledged.toLocaleString()}</div><div style="color:#64748b">Total Pledged</div></div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:24px;font-weight:800;color:#059669">UGX ${totalFulfilled.toLocaleString()}</div><div style="color:#64748b">Fulfilled</div></div>
            <div style="background:white;border-radius:12px;padding:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div style="font-size:24px;font-weight:800;color:#f59e0b">${pledges.length}</div><div style="color:#64748b">Pledgors</div></div>
          </div>
          ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/pledges/new" style="display:block;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700;text-align:center;margin-bottom:24px">Make a Pledge</a>' : ''}
          ${pledges.length > 0 ? '<div class="card"><table style="width:100%;border-collapse:collapse"><tr style="background:#f1f5f9"><th style="padding:10px;text-align:left">Pledgor</th><th style="padding:10px;text-align:right">Pledged</th><th style="padding:10px;text-align:right">Fulfilled</th><th style="padding:10px">Status</th></tr>' + pledges.map(p => '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px">'+esc(p.pledgor_name)+'</td><td style="padding:10px;text-align:right">UGX '+parseInt(p.pledged_amount).toLocaleString()+'</td><td style="padding:10px;text-align:right">UGX '+parseInt(p.fulfilled_amount||0).toLocaleString()+'</td><td style="padding:10px"><span style="background:'+(p.status==='fulfilled'?'#d1fae5;color:#065f46':p.status==='overdue'?'#fef2f2;color:#991b1b':'#fef3c7;color:#92400e')+';padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">'+esc(p.status)+'</span></td></tr>').join('') + '</table></div>' : ''}
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  app.get('/campaigns/:id/pledges/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Make a Pledge', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <div class="card"><h2>Make a Pledge</h2>
          <p style="color:#64748b">Commit to donating a specific amount by a target date.</p>
          <form method="POST" action="/campaigns/${req.params.id}/pledges/save">
            <label>Your Name</label><input name="pledgor_name" value="${esc(req.session.user?.name||'')}" required>
            <label>Email</label><input name="pledgor_email" value="${esc(req.session.user?.email||'')}" required>
            <label>Phone</label><input name="pledgor_phone" placeholder="+256...">
            <label>Pledge Amount (UGX)</label><input name="pledged_amount" type="number" min="1000" required>
            <label>Expected Date of Donation</label><input name="expected_fulfillment_date" type="date" required>
            <label>Notes (optional)</label><textarea name="notes" rows="2" placeholder="Any additional information"></textarea>
            <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Submit Pledge</button>
          </form>
        </div>
      </div>
    `));
  }));

  app.post('/campaigns/:id/pledges/save', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      await pool.query('INSERT INTO campaign_pledges(tenant_id,campaign_id,pledgor_name,pledgor_email,pledgor_phone,pledged_amount,pledge_date,expected_fulfillment_date,notes) VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,$8)',
        [c.tenant_id, req.params.id, req.body.pledgor_name, req.body.pledgor_email, req.body.pledgor_phone||'', parseInt(req.body.pledged_amount), req.body.expected_fulfillment_date, req.body.notes||'']);
      const result = await pool.query('SELECT id FROM campaign_pledges WHERE tenant_id=$1 AND campaign_id=$2 AND pledgor_email=$3 ORDER BY created_at DESC LIMIT 1', [c.tenant_id, req.params.id, req.body.pledgor_email]);
      if (result.rows[0]) await audit(req.session.user.email, 'pledge_created', 'campaign_pledges id=' + result.rows[0].id);
      await pool.query('UPDATE fundraising_campaigns SET has_pledges=true, pledge_total=pledge_total+$1 WHERE id=$2 AND tenant_id=$3', [parseInt(req.body.pledged_amount), req.params.id, c.tenant_id]);
      res.redirect('/campaigns/'+req.params.id+'/pledges');
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // =============================================
  // V5 FEATURE 4: SOCIAL MEDIA SCHEDULED POSTS
  // =============================================
  app.get('/campaigns/:id/social-posts', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const posts = (await pool.query("SELECT * FROM campaign_social_posts WHERE campaign_id=$1 ORDER BY scheduled_at ASC", [req.params.id])).rows;
      res.send(renderPage('Social Media Posts - '+c.title, `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800">Social Media Scheduler</h1>
          <p style="color:#64748b">Schedule posts to promote your campaign across social platforms.</p>
          <a href="/campaigns/${req.params.id}/social-posts/new" class="btn btn-green" style="margin:16px 0">Schedule New Post</a>
          ${posts.length > 0 ? '<div style="margin-top:16px">' + posts.map(p => '<div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04)"><div style="display:flex;justify-content:space-between;align-items:center"><div><span style="background:#ede9fe;color:#4f46e5;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700">'+esc(p.platform)+'</span> <span style="background:'+(p.status==='posted'?'#d1fae5;color:#065f46':p.status==='failed'?'#fef2f2;color:#991b1b':'#fef3c7;color:#92400e')+';padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700">'+esc(p.status)+'</span></div><div style="color:#64748b;font-size:13px">'+new Date(p.scheduled_at).toLocaleString()+'</div></div><p style="margin-top:8px;color:#1e293b">'+esc(p.content).substring(0,200)+'</p></div>').join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px;margin-top:24px"><div style="font-size:48px">&#128240;</div><h3>No Posts Scheduled</h3><p style="color:#64748b">Schedule your first social media post to boost your campaign!</p></div>'}
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  app.get('/campaigns/:id/social-posts/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Schedule Social Post', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <div class="card"><h2>Schedule Social Post</h2>
          <form method="POST" action="/campaigns/${req.params.id}/social-posts/save">
            <label>Platform</label><select name="platform"><option value="twitter">Twitter/X</option><option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="tiktok">TikTok</option></select>
            <label>Post Content</label><textarea name="content" rows="4" placeholder="Write your social media post..." required></textarea>
            <label>Image URL (optional)</label><input name="image_url" placeholder="https://...">
            <label>Link URL (optional)</label><input name="link_url" placeholder="https://...">
            <label>Hashtags (comma separated)</label><input name="hashtags" placeholder="#fundraising, #donate, #charity">
            <label>Schedule Date & Time</label><input name="scheduled_at" type="datetime-local" required>
            <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Schedule Post</button>
          </form>
        </div>
      </div>
    `));
  }));

  app.post('/campaigns/:id/social-posts/save', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const hashtags = (req.body.hashtags||'').split(',').map(t => t.trim()).filter(t => t);
      await pool.query('INSERT INTO campaign_social_posts(tenant_id,campaign_id,platform,content,image_url,link_url,hashtags,scheduled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [c.tenant_id, req.params.id, req.body.platform, req.body.content, req.body.image_url||'', req.body.link_url||'', hashtags, req.body.scheduled_at, req.session.user?.email||'']);
      const result = await pool.query('SELECT id FROM campaign_social_posts WHERE tenant_id=$1 AND campaign_id=$2 AND created_by=$3 ORDER BY created_at DESC LIMIT 1', [c.tenant_id, req.params.id, req.session.user?.email||'']);
      if (result.rows[0]) await audit(req.session.user.email, 'social_post_created', 'campaign_social_posts id=' + result.rows[0].id);
      res.redirect('/campaigns/'+req.params.id+'/social-posts');
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // =============================================
  // V5 FEATURE 5: DONOR TRIBUTES / MEMORIALS
  // =============================================
  app.get('/campaigns/:id/tributes', ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      const tributes = (await pool.query("SELECT * FROM donor_tributes WHERE campaign_id=$1 AND is_public=true ORDER BY created_at DESC", [req.params.id])).rows;
      res.send(renderPage('Tributes - '+c.title, `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800;text-align:center">Donor Tributes</h1>
          <p style="text-align:center;color:#64748b">Honor someone special with your donation</p>
          ${tributes.length > 0 ? '<div style="margin-top:24px">' + tributes.map(t => `
            <div style="background:white;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-left:4px solid ${t.tribute_type==='in_memory'?'#64748b':t.tribute_type==='in_honor'?'#f59e0b':t.tribute_type==='in_celebration'?'#059669':'#4f46e5'}">
              <div style="display:flex;justify-content:space-between;align-items:center"><span style="background:#f1f5f9;padding:4px 12px;border-radius:8px;font-size:12px;font-weight:700;color:#475569">${esc(t.tribute_type.replace('in_','').replace('_',' '))}</span><span style="color:#64748b;font-size:13px">${new Date(t.created_at).toLocaleDateString()}</span></div>
              <h3 style="margin-top:12px;font-size:18px">${t.tribute_type==='in_memory'?'In Loving Memory of':'In Honor of'} ${esc(t.honoree_name)}</h3>
              ${t.tribute_message ? '<p style="color:#475569;font-style:italic;margin-top:8px">"'+esc(t.tribute_message)+'"</p>' : ''}
              <div style="margin-top:8px;font-size:13px;color:#64748b">- ${esc(t.donor_name)}</div>
            </div>
          `).join('') + '</div>' : '<div style="text-align:center;padding:40px;background:white;border-radius:16px;margin-top:24px"><div style="font-size:48px">&#128142;</div><h3>No Tributes Yet</h3><p style="color:#64748b">Be the first to honor someone with your donation.</p></div>'}
          ${req.session.user ? '<a href="/campaigns/'+req.params.id+'/tributes/new" style="display:block;margin-top:20px;padding:14px;background:#4f46e5;color:white;border-radius:12px;text-decoration:none;font-weight:700;text-align:center">Write a Tribute</a>' : ''}
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  app.get('/campaigns/:id/tributes/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Write a Tribute', `
      <div style="max-width:600px;margin:0 auto;padding:20px">
        <div class="card"><h2>Write a Tribute</h2>
          <form method="POST" action="/campaigns/${req.params.id}/tributes/save">
            <label>Tribute Type</label><select name="tribute_type"><option value="in_honor">In Honor Of</option><option value="in_memory">In Memory Of</option><option value="in_celebration">In Celebration Of</option><option value="in_support">In Support Of</option></select>
            <label>Honoree Name</label><input name="honoree_name" placeholder="Name of the person being honored" required>
            <label>Honoree Email (optional)</label><input name="honoree_email" placeholder="To notify them of the tribute">
            <label>Relationship</label><input name="honoree_relationship" placeholder="e.g., Father, Teacher, Friend">
            <label>Tribute Message</label><textarea name="tribute_message" rows="4" placeholder="Share a message about this person..." required></textarea>
            <label>Your Name</label><input name="donor_name" value="${esc(req.session.user?.name||'')}" required>
            <label>Your Email</label><input name="donor_email" value="${esc(req.session.user?.email||'')}" required>
            <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" name="notify_honoree" value="true" checked> Notify honoree about this tribute</label>
            <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Submit Tribute</button>
          </form>
        </div>
      </div>
    `));
  }));

  app.post('/campaigns/:id/tributes/save', requireAuth, ah(async (req, res) => {
    try {
      const c = (await pool.query('SELECT tenant_id, title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!c) return res.status(404).send('Campaign not found');
      await pool.query('INSERT INTO donor_tributes(tenant_id,campaign_id,tribute_type,honoree_name,honoree_email,honoree_relationship,tribute_message,notify_honoree,donor_name,donor_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [c.tenant_id, req.params.id, req.body.tribute_type, req.body.honoree_name, req.body.honoree_email||'', req.body.honoree_relationship||'', req.body.tribute_message, req.body.notify_honoree==='true', req.body.donor_name, req.body.donor_email]);
      const result = await pool.query('SELECT id FROM donor_tributes WHERE tenant_id=$1 AND campaign_id=$2 AND donor_email=$3 ORDER BY created_at DESC LIMIT 1', [c.tenant_id, req.params.id, req.body.donor_email]);
      if (result.rows[0]) await audit(req.session.user.email, 'tribute_created', 'donor_tributes id=' + result.rows[0].id);
      await pool.query('UPDATE fundraising_campaigns SET has_tributes=true, tribute_count=tribute_count+1 WHERE id=$1 AND tenant_id=$2', [req.params.id, c.tenant_id]);
      // Notify honoree if requested
      if (req.body.notify_honoree === 'true' && req.body.honoree_email) {
        try {
          await sendEmail(req.body.honoree_email, 'A Tribute Has Been Made in Your Honor', `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:30px;border-radius:12px 12px 0 0;text-align:center;color:white"><h1>A Special Tribute</h1></div>
              <div style="padding:30px;background:white;border:1px solid #e2e8f0">
                <p>${esc(req.body.donor_name)} has made a tribute <strong>${esc(req.body.tribute_type.replace('in_','').replace('_',' '))}</strong> you in support of <strong>"${esc(c.title)}"</strong>.</p>
                <p style="font-style:italic;color:#475569">"${esc(req.body.tribute_message)}"</p>
                <a href="${BASE_URL}/campaigns/${req.params.id}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:white;border-radius:8px;text-decoration:none;font-weight:700">View Campaign</a>
              </div>
            </div>
          `);
          await pool.query('UPDATE donor_tributes SET notify_sent=true WHERE campaign_id=$1 AND honoree_email=$2', [req.params.id, req.body.honoree_email]);
        } catch(e) { console.warn('[Tribute Email Error]', e.message); }
      }
      res.redirect('/campaigns/'+req.params.id+'/tributes');
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // =============================================
  // V5 FEATURE 6: STORY TEMPLATES
  // =============================================
  app.get('/campaign-story-templates', ah(async (req, res) => {
    try {
      const templates = (await pool.query("SELECT * FROM campaign_story_templates WHERE is_featured=true OR tenant_id=$1 ORDER BY category, usage_count DESC", [req.session.user?.tenant_id||0])).rows;
      res.send(renderPage('Campaign Story Templates', `
        <div style="max-width:900px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800;text-align:center">Campaign Story Templates</h1>
          <p style="text-align:center;color:#64748b;margin-bottom:24px">Use these professional templates to create compelling campaign stories</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">
            ${templates.map(t => `
              <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);border-top:4px solid ${t.category==='medical'?'#ef4444':t.category==='education'?'#3b82f6':t.category==='disaster'?'#f59e0b':t.category==='community'?'#059669':'#4f46e5'}">
                <span style="background:#f1f5f9;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase">${esc(t.category)}</span>
                <h3 style="margin-top:12px;font-size:16px;font-weight:700">${esc(t.template_name)}</h3>
                <p style="color:#64748b;font-size:13px;margin:8px 0">${esc(t.title_template)}</p>
                <div style="font-size:13px;color:#059669;font-weight:700">Suggested Goal: UGX ${parseInt(t.goal_suggestion||0).toLocaleString()}</div>
                <div style="font-size:12px;color:#64748b;margin-top:8px">Used ${t.usage_count} times</div>
              </div>
            `).join('')}
          </div>
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // API: Get templates
  app.get('/api/campaign-story-templates', ah(async (req, res) => {
    try {
      const templates = (await pool.query("SELECT * FROM campaign_story_templates WHERE is_featured=true OR tenant_id=$1 ORDER BY category", [req.query.tenant_id||0])).rows;
      res.json(templates);
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // =============================================
  // V5 FEATURE 7: THERMOMETER / GOAL WIDGET API
  // =============================================
  app.get('/api/campaigns/:id/thermometer', ah(async (req, res) => {
    try {
      const campaign = (await pool.query('SELECT id, title, target, tenant_id FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
      const stats = (await pool.query('SELECT COALESCE(SUM(amount),0) as raised, COUNT(*) as donors, AVG(amount) as avg_donation FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [req.params.id])).rows[0];
      const raised = parseInt(stats?.raised||0);
      const target = parseInt(campaign.target||0);
      const donors = parseInt(stats?.donors||0);
      const pct = target > 0 ? Math.min(100, Math.round(raised/target*100*100)/100) : 0;
      // Calculate days remaining
      const deadline = (await pool.query('SELECT deadline FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0]?.deadline;
      const daysRemaining = deadline ? Math.max(0, Math.ceil((new Date(deadline) - new Date())/(1000*60*60*24))) : null;
      // Daily average and projection
      const firstDonation = (await pool.query('SELECT MIN(donated_at) as first FROM campaign_donations WHERE campaign_id=$1 AND refunded=false', [req.params.id])).rows[0]?.first;
      let dailyAvg = 0;
      let projected = 0;
      if (firstDonation) {
        const daysSinceStart = Math.max(1, Math.ceil((new Date() - new Date(firstDonation))/(1000*60*60*24)));
        dailyAvg = Math.round(raised / daysSinceStart);
        projected = daysRemaining ? raised + (dailyAvg * daysRemaining) : raised;
      }
      // Check milestones reached
      const milestonesReached = [25,50,75,100].filter(m => pct >= m);
      // Upsert thermometer data
      await pool.query(`INSERT INTO campaign_thermometers(tenant_id,campaign_id,current_amount,target_amount,percentage,donor_count,days_remaining,daily_average,projected_total,milestone_reached,last_updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (campaign_id) DO UPDATE SET current_amount=$3, target_amount=$4, percentage=$5, donor_count=$6, days_remaining=$7, daily_average=$8, projected_total=$9, milestone_reached=$10, last_updated=NOW()`,
        [campaign.tenant_id, campaign.id, raised, target, pct, donors, daysRemaining, dailyAvg, projected, JSON.stringify(milestonesReached)]);
      res.json({
        campaign_id: campaign.id,
        title: campaign.title,
        raised,
        target,
        percentage: pct,
        donor_count: donors,
        days_remaining: daysRemaining,
        daily_average: dailyAvg,
        projected_total: projected,
        milestones_reached: milestonesReached,
        on_track: projected >= target,
        embed_url: BASE_URL + '/api/campaigns/' + campaign.id + '/thermometer/embed'
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // Embeddable thermometer widget
  app.get('/api/campaigns/:id/thermometer/embed', ah(async (req, res) => {
    try {
      const t = (await pool.query('SELECT * FROM campaign_thermometers WHERE campaign_id=$1', [req.params.id])).rows[0];
      const c = (await pool.query('SELECT title FROM fundraising_campaigns WHERE id=$1', [req.params.id])).rows[0];
      if (!t || !c) return res.status(404).send('Not found');
      const pct = parseFloat(t.percentage||0);
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;padding:16px;background:#f8fafc}.thermometer{background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:400px;margin:0 auto}h2{font-size:16px;margin-bottom:12px;text-align:center}.bar{background:#e2e8f0;border-radius:20px;height:24px;overflow:hidden}.fill{background:linear-gradient(90deg,#059669,#10b981);height:100%;border-radius:20px;transition:width 1s;width:${pct}%}.stats{display:flex;justify-content:space-between;margin-top:12px;font-size:13px;color:#64748b}.amount{font-size:20px;font-weight:800;color:#059669;text-align:center;margin-top:8px}</style></head><body><div class="thermometer"><h2>${c.title}</h2><div class="bar"><div class="fill"></div></div><div class="amount">UGX ${parseInt(t.current_amount).toLocaleString()} / UGX ${parseInt(t.target_amount).toLocaleString()}</div><div class="stats"><span>${Math.round(pct)}% funded</span><span>${parseInt(t.donor_count)} donors</span><span>${t.days_remaining||'?'} days left</span></div></div></body></html>`);
    } catch(e) { res.status(500).send('Error'); }
  }));

  // =============================================
  // V5 FEATURE 8: DONOR CRM EXPORT
  // =============================================
  app.post('/api/donors/export', requireAuth, ah(async (req, res) => {
    try {
      const { export_type, export_scope, campaign_id, date_from, date_to, segment_id } = req.body;
      const tenant_id = req.session.user.tenant_id;
      // Build query based on scope
      let query = 'SELECT dp.full_name, dp.user_email, dp.phone, dp.country, dp.city, dp.total_donated, dp.donation_count, dp.campaigns_supported, dp.first_donation_at, dp.last_donation_at, dp.is_recurring_donor FROM donor_profiles dp WHERE dp.tenant_id=$1';
      const params = [tenant_id];
      if (export_scope === 'campaign' && campaign_id) {
        query += ' AND dp.user_email IN (SELECT donor_email FROM campaign_donations WHERE campaign_id=$2 AND refunded=false)';
        params.push(campaign_id);
      } else if (export_scope === 'top_donors') {
        query += ' ORDER BY dp.total_donated DESC LIMIT 100';
      } else if (export_scope === 'new_donors') {
        query += ' AND dp.first_donation_at >= NOW() - INTERVAL \'30 days\'';
      } else if (export_scope === 'recurring') {
        query += ' AND dp.is_recurring_donor=true';
      } else if (export_scope === 'lapsed') {
        query += ' AND dp.last_donation_at < NOW() - INTERVAL \'90 days\'';
      }
      const donors = (await pool.query(query, params)).rows;
      // Generate CSV
      const headers = 'Name,Email,Phone,Country,City,Total Donated,Donation Count,Campaigns,First Donation,Last Donation,Recurring';
      const rows = donors.map(d => `"${esc(d.full_name||'')}","${d.user_email||''}","${d.phone||''}","${d.country||''}","${d.city||''}",${d.total_donated||0},${d.donation_count||0},${d.campaigns_supported||0},"${d.first_donation_at||''}","${d.last_donation_at||''}",${d.is_recurring_donor||false}`);
      const csv = headers + '\n' + rows.join('\n');
      // Record export
      await pool.query('INSERT INTO donor_crm_exports(tenant_id,export_type,export_scope,campaign_id,date_from,date_to,record_count,status,requested_by,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())',
        [tenant_id, export_type||'csv', export_scope||'all_donors', campaign_id||null, date_from||null, date_to||null, donors.length, 'completed', req.session.user.email]);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=donors-export-' + new Date().toISOString().split('T')[0] + '.csv');
      res.send(csv);
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // Export page
  app.get('/admin/donor-export', requireAuth, ah(async (req, res) => {
    const exports = (await pool.query('SELECT * FROM donor_crm_exports WHERE tenant_id=$1 ORDER BY requested_at DESC LIMIT 20', [req.session.user.tenant_id])).rows;
    res.send(renderPage('Donor CRM Export', `
      <div style="max-width:700px;margin:0 auto;padding:20px">
        <h1 style="font-size:28px;font-weight:800">Donor CRM Export</h1>
        <div class="card" style="margin-top:20px">
          <form method="POST" action="/api/donors/export">
            <label>Export Format</label><select name="export_type"><option value="csv">CSV</option><option value="excel">Excel</option><option value="json">JSON</option></select>
            <label>Export Scope</label><select name="export_scope"><option value="all_donors">All Donors</option><option value="top_donors">Top Donors</option><option value="new_donors">New Donors (30 days)</option><option value="recurring">Recurring Donors</option><option value="lapsed">Lapsed Donors (90+ days)</option></select>
            <button class="btn btn-green" style="width:100%;padding:14px;font-size:16px;margin-top:16px">Export Donors</button>
          </form>
        </div>
        ${exports.length > 0 ? '<div class="card" style="margin-top:20px"><h3>Recent Exports</h3>' + exports.map(e => '<div style="padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="font-weight:700">'+esc(e.export_type.toUpperCase())+'</span> - '+esc(e.export_scope.replace('_',' '))+' ('+e.record_count+' records) <span style="color:#64748b;font-size:13px">'+new Date(e.requested_at).toLocaleString()+'</span></div>').join('') + '</div>' : ''}
      </div>
    `));
  }));

  // =============================================
  // V5 FEATURE 9: CAMPAIGN COMPARISON
  // =============================================
  app.get('/campaigns/compare', ah(async (req, res) => {
    try {
      const ids = (req.query.ids||'').split(',').filter(Boolean).map(Number).slice(0,5);
      if (ids.length < 2) {
        return res.send(renderPage('Compare Campaigns', `
          <div style="max-width:700px;margin:0 auto;padding:20px">
            <h1 style="font-size:28px;font-weight:800">Compare Campaigns</h1>
            <p style="color:#64748b">Select 2-5 campaigns to compare side by side.</p>
            <form method="GET" action="/campaigns/compare">
              <label>Campaign IDs (comma separated)</label><input name="ids" placeholder="1,2,3" required>
              <button class="btn btn-green" style="margin-top:12px">Compare</button>
            </form>
          </div>
        `));
      }
      const campaigns = (await pool.query('SELECT fc.id, fc.title, fc.target, fc.category, fc.country, fc.status, COALESCE(SUM(cd.amount),0) as raised, COUNT(cd.id) as donors, fc.total_shares, fc.created_at FROM fundraising_campaigns fc LEFT JOIN campaign_donations cd ON cd.campaign_id=fc.id AND cd.refunded=false WHERE fc.id=ANY($1) GROUP BY fc.id ORDER BY raised DESC', [ids])).rows;
      res.send(renderPage('Compare Campaigns', `
        <div style="max-width:1100px;margin:0 auto;padding:20px">
          <h1 style="font-size:28px;font-weight:800;text-align:center">Campaign Comparison</h1>
          <div style="overflow-x:auto;margin-top:24px">
            <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
              <tr style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white"><th style="padding:14px;text-align:left">Metric</th>${campaigns.map(c => '<th style="padding:14px;text-align:right">'+esc(c.title.substring(0,25))+'</th>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px;font-weight:600">Status</td>${campaigns.map(c => '<td style="padding:12px;text-align:right"><span style="background:'+(c.status==='active'?'#d1fae5;color:#065f46':c.status==='completed'?'#dbeafe;color:#1e40af':'#fef3c7;color:#92400e')+';padding:2px 8px;border-radius:8px;font-size:12px;font-weight:700">'+esc(c.status)+'</span></td>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px;font-weight:600">Target</td>${campaigns.map(c => '<td style="padding:12px;text-align:right">UGX '+parseInt(c.target).toLocaleString()+'</td>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc"><td style="padding:12px;font-weight:600">Raised</td>${campaigns.map(c => '<td style="padding:12px;text-align:right;font-weight:800;color:#059669">UGX '+parseInt(c.raised).toLocaleString()+'</td>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px;font-weight:600">% Funded</td>${campaigns.map(c => '<td style="padding:12px;text-align:right;font-weight:700">'+(parseInt(c.target)>0?Math.round(parseInt(c.raised)/parseInt(c.target)*100):0)+'%</td>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px;font-weight:600">Donors</td>${campaigns.map(c => '<td style="padding:12px;text-align:right">'+parseInt(c.donors)+'</td>').join('')}</tr>
              <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px;font-weight:600">Shares</td>${campaigns.map(c => '<td style="padding:12px;text-align:right">'+parseInt(c.total_shares||0)+'</td>').join('')}</tr>
              <tr><td style="padding:12px;font-weight:600">Category</td>${campaigns.map(c => '<td style="padding:12px;text-align:right">'+esc(c.category||'General')+'</td>').join('')}</tr>
            </table>
          </div>
        </div>
      `));
    } catch(e) { res.status(500).send('Error: '+e.message); }
  }));

  // API for comparison data
  app.get('/api/campaigns/compare', ah(async (req, res) => {
    try {
      const ids = (req.query.ids||'').split(',').filter(Boolean).map(Number).slice(0,5);
      if (ids.length < 2) return res.status(400).json({ error: 'Need at least 2 campaign IDs' });
      const campaigns = (await pool.query('SELECT fc.id, fc.title, fc.target, fc.category, fc.status, COALESCE(SUM(cd.amount),0) as raised, COUNT(cd.id) as donors, fc.total_shares FROM fundraising_campaigns fc LEFT JOIN campaign_donations cd ON cd.campaign_id=fc.id AND cd.refunded=false WHERE fc.id=ANY($1) GROUP BY fc.id', [ids])).rows;
      res.json(campaigns);
    } catch(e) { res.status(500).json({ error: e.message }); }
  }));

  // =============================================
  // V5: UPDATE ENHANCED DASHBOARD WITH V5 LINKS
  // =============================================
  // V5 links added to the existing enhanced dashboard
  console.log('[Fundraising Enhancements] All V5 routes registered successfully');
};
