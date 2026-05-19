// ============================================================
// === FIX SCHEMA GAPS — Missing Tables + Duplicate Conflicts ===
// ============================================================
// This migration creates tables that are queried by code but never
// created by any module, and adds missing columns to tables whose
// CREATE TABLE IF NOT EXISTS was shadowed by an earlier definition.
//
// Module load order (determines which CREATE TABLE wins):
//   1. monetization-engine.js  (first → canonical for premium_content)
//   2. viral-content-engine.js (second → canonical for referrals,
//      referral_rewards, newsletter_subscribers, user_points,
//      affiliate_links)
//   3. engagement-engine.js
//   4. revenue-quickstart.js
//   5. global-viral-engine.js
//   6. referral-system.js (later → its CREATE TABLE is ignored)
//   7. server.js async block (medical referrals → also ignored)
// ============================================================

module.exports = async function (pool) {
  const results = { created: [], altered: [] };

  // ============================================================
  // PART 1: CREATE MISSING TABLES
  // ============================================================

  const missingTables = [
    // --- scraped_content ---
    // Queried by viral-content-engine.js scrapeRSSFeeds() and /discover route.
    // Uses ON CONFLICT ON CONSTRAINT scraped_content_tenant_title_source_key.
    `CREATE TABLE IF NOT EXISTS scraped_content (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      title TEXT NOT NULL,
      url TEXT,
      summary TEXT,
      image_url TEXT,
      category TEXT DEFAULT 'news',
      source TEXT,
      view_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      published_at TIMESTAMPTZ,
      scraped_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT scraped_content_tenant_title_source_key UNIQUE (title, source)
    )`,

    // --- scraped_jobs ---
    // Queried by global-viral-engine.js search route.
    `CREATE TABLE IF NOT EXISTS scraped_jobs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      title TEXT NOT NULL,
      company TEXT,
      location TEXT DEFAULT 'Uganda',
      url TEXT,
      description TEXT,
      source TEXT,
      posted_date DATE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- scraped_opportunities ---
    // Queried by global-viral-engine.js search route.
    `CREATE TABLE IF NOT EXISTS scraped_opportunities (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      title TEXT NOT NULL,
      organization TEXT,
      type TEXT DEFAULT 'scholarship',
      url TEXT,
      description TEXT,
      deadline DATE,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- developer_revenue ---
    // Queried by monetization-engine.js creditDeveloperRevenue()
    // and viral-content-engine.js trackAdClick().
    `CREATE TABLE IF NOT EXISTS developer_revenue (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER,
      source TEXT NOT NULL,
      source_id INTEGER,
      amount INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      description TEXT,
      earned_at TIMESTAMPTZ,
      paid_out BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- poll_options ---
    // Queried by global-viral-engine.js embed widget (/embed/poll/:id).
    `CREATE TABLE IF NOT EXISTS poll_options (
      id SERIAL PRIMARY KEY,
      poll_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      vote_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- ad_clicks ---
    // Queried by viral-content-engine.js trackAdClick().
    `CREATE TABLE IF NOT EXISTS ad_clicks (
      id SERIAL PRIMARY KEY,
      ad_id INTEGER,
      tenant_id INTEGER,
      ad_placement TEXT,
      ip_address TEXT,
      user_agent TEXT,
      revenue_usd NUMERIC DEFAULT 0,
      revenue NUMERIC DEFAULT 0,
      clicked_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // --- onboarding_data ---
    // Queried by /onboarding wizard routes (POST /onboarding/step, GET /onboarding).
    // Also created by user-onboarding.js but included here for safety.
    `CREATE TABLE IF NOT EXISTS onboarding_data (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL,
      step INT NOT NULL,
      data JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, step)
    )`,

    // --- tenant_wallets ---
    // Queried by /admin/overview KPI dashboard for wallet balance.
    `CREATE TABLE IF NOT EXISTS tenant_wallets (
      id SERIAL PRIMARY KEY,
      tenant_id INT UNIQUE NOT NULL,
      balance NUMERIC DEFAULT 0,
      currency TEXT DEFAULT 'UGX',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  for (const sql of missingTables) {
    try {
      await pool.query(sql);
      // Extract table name from CREATE TABLE IF NOT EXISTS <name>
      const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (match) results.created.push(match[1]);
    } catch (e) {
      if (!e.message.includes('already exists')) {
        console.warn('[SchemaGaps] Create table error:', e.message);
      }
    }
  }

  // ============================================================
  // PART 2: ADD MISSING COLUMNS TO EXISTING TABLES
  // (for tables where a later module's CREATE TABLE was ignored)
  // ============================================================

  const alterStatements = [
    // ----------------------------------------------------------
    // referrals — canonical: viral-content-engine.js
    //   has: id, tenant_id, referrer_email, referred_email,
    //        referral_code (UNIQUE), status, reward_earned,
    //        reward_type, created_at, converted_at
    //
    //   server.js line 36470 also tries to CREATE this table with
    //   medical referral columns (patient_name, referring_doctor,
    //   etc.) which are silently ignored. Add them so both systems
    //   can coexist.
    // ----------------------------------------------------------
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS patient_name VARCHAR(255)`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS patient_id INTEGER`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS patient_type VARCHAR(20) DEFAULT 'student'`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referring_doctor VARCHAR(255)`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS receiving_facility VARCHAR(255)`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS receiving_facility_contact VARCHAR(255)`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_category VARCHAR(50) DEFAULT 'specialist'`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) DEFAULT 'routine'`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reason TEXT`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS clinical_notes TEXT`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS diagnosis TEXT`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(255)`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
    `ALTER TABLE referrals ADD COLUMN IF NOT EXISTS notes TEXT`,

    // ----------------------------------------------------------
    // referral_rewards — canonical: viral-content-engine.js
    //   has: id, tenant_id, user_email, referral_count,
    //        total_reward, reward_type, last_reward_at,
    //        created_at, UNIQUE(tenant_id, user_email)
    //
    //   referral-system.js also creates this table with:
    //     reward_value, source_email, claimed, claimed_at, expires_at
    //   These columns are MISSING because the earlier definition won.
    // ----------------------------------------------------------
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS reward_value INTEGER DEFAULT 0`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS source_email TEXT`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS claimed BOOLEAN DEFAULT false`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`,
    `ALTER TABLE referral_rewards ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,

    // ----------------------------------------------------------
    // premium_content — canonical: monetization-engine.js
    //   has: id, title, slug (UNIQUE), excerpt, full_content,
    //        category, unlock_type, email_required,
    //        points_required, is_premium, views, unlocks,
    //        created_at, updated_at
    //
    //   revenue-quickstart.js also creates this table with:
    //     image_url, price, currency, purchases, is_published
    //   These columns are MISSING.
    // ----------------------------------------------------------
    `ALTER TABLE premium_content ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE premium_content ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 500`,
    `ALTER TABLE premium_content ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`,
    `ALTER TABLE premium_content ADD COLUMN IF NOT EXISTS purchases INTEGER DEFAULT 0`,
    `ALTER TABLE premium_content ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true`,

    // ----------------------------------------------------------
    // newsletter_subscribers — canonical: viral-content-engine.js
    //   has: id, email (UNIQUE), name, source, is_verified,
    //        verification_token, subscribed_at
    //
    //   monetization-engine.js inserts (email, name, source) —
    //   all columns exist. No ALTER needed, but adding a few
    //   useful columns that may be expected by future code.
    // ----------------------------------------------------------
    `ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    `ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`,

    // ----------------------------------------------------------
    // user_points — canonical: viral-content-engine.js
    //   has: id, user_email (UNIQUE), points, level,
    //        streak_days, last_active, created_at
    //
    //   engagement-engine.js reads (points, level) — both exist.
    //   No ALTER strictly needed, but add total_points for
    //   engagement scores if not present.
    // ----------------------------------------------------------
    `ALTER TABLE user_points ADD COLUMN IF NOT EXISTS total_points INTEGER DEFAULT 0`,

    // ----------------------------------------------------------
    // subscriptions — Trial enforcement columns
    //   Used by checkTrialAccess middleware to enforce 2-month
    //   free trial expiration and redirect to billing.
    // ----------------------------------------------------------
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_expired BOOLEAN DEFAULT false`,
    `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,

    // ----------------------------------------------------------
    // affiliate_links — canonical: viral-content-engine.js
    //   has: id, tenant_id, original_url, affiliate_slug (UNIQUE),
    //        title, description, platform, clicks, conversions,
    //        revenue, created_at
    //
    //   revenue-quickstart.js references affiliate_links(id) as FK
    //   from affiliate_revenue table — no missing columns.
    // ----------------------------------------------------------

    // ----------------------------------------------------------
    // tenants — Onboarding wizard tracking columns
    //   Used by /onboarding wizard to track progress per tenant.
    //   onboarding_step: current step (0=not started, 1-4 = steps)
    //   onboarding_completed: whether the wizard was finished
    // ----------------------------------------------------------
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0`,
    `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`,
  ];

  for (const sql of alterStatements) {
    try {
      await pool.query(sql);
      // Extract table and column from ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <c>
      const match = sql.match(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
      if (match) {
        const key = `${match[1]}.${match[2]}`;
        results.altered.push(key);
      }
    } catch (e) {
      if (!e.message.includes('already exists')) {
        console.warn('[SchemaGaps] Alter table error:', e.message);
      }
    }
  }

  // ============================================================
  // PART 3: ADD VALID_TABLES ENTRIES
  // (so the generic API and admin tools recognize these tables)
  // ============================================================
  if (typeof VALID_TABLES !== 'undefined') {
    ['scraped_content', 'scraped_jobs', 'scraped_opportunities',
     'developer_revenue', 'poll_options', 'ad_clicks'
    ].forEach(t => VALID_TABLES.add(t));
  }

  // ============================================================
  // PART 4: BACKFILL TRIAL DATES FOR EXISTING FREE SUBSCRIPTIONS
  // Existing free-plan tenants get a 2-month trial from the time
  // this migration runs. Paid-plan tenants are left alone.
  // ============================================================
  try {
    const backfillResult = await pool.query(`
      UPDATE subscriptions
      SET trial_start = COALESCE(started_at, NOW()),
          trial_end = COALESCE(started_at, NOW()) + INTERVAL '60 days',
          trial_expired = false
      WHERE plan = 'free'
        AND status = 'active'
        AND trial_start IS NULL
        AND trial_end IS NULL
    `);
    if (backfillResult.rowCount > 0) {
      results.altered.push(`subscriptions.trial_backfill (${backfillResult.rowCount} rows)`);
      console.log(`[SchemaGaps] Backfilled trial dates for ${backfillResult.rowCount} existing free subscriptions`);
    }
  } catch (e) {
    if (!e.message.includes('does not exist')) {
      console.warn('[SchemaGaps] Trial backfill error:', e.message);
    }
  }

  console.log('[SchemaGaps] Created tables:', results.created.join(', '));
  console.log('[SchemaGaps] Added columns:', results.altered.join(', '));

  return results;
};
