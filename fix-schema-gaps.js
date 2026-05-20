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

    // --- user_invitations ---
    // Email-based user invitations with accept/reject flow
    `CREATE TABLE IF NOT EXISTS user_invitations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(100) DEFAULT 'staff',
      token VARCHAR(255) NOT NULL UNIQUE,
      invited_by INTEGER REFERENCES users(id),
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      declined_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(token)`,
    `CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON user_invitations(tenant_id)`,

    // --- user_dashboard_prefs ---
    // Per-user dashboard customization (widget visibility, layout)
    `CREATE TABLE IF NOT EXISTS user_dashboard_prefs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      portal_type VARCHAR(50),
      widgets JSONB DEFAULT '[]',
      layout VARCHAR(20) DEFAULT 'default',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, portal_type)
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
     'developer_revenue', 'poll_options', 'ad_clicks', 'user_dashboard_prefs',
     'user_invitations'
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

  // ============================================================
  // PART 5: FIX COMMON DEPLOYMENT ERRORS
  // These fixes address errors seen in Render deployment logs.
  // ============================================================

  const fixStatements = [
    // --- Fix missing columns that seed data references ---
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_criteria JSONB DEFAULT '{}'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subject TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS default_percentage NUMERIC DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS next_date DATE`,

    // --- Fix missing columns for auction/auction_items ---
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS auction_id INTEGER`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pledgor_email TEXT`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,

    // --- Fix email_queue missing columns referenced by worker ---
    `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS html BOOLEAN DEFAULT false`,
    `ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`,

    // --- Fix campaign_story_templates FK issues ---
    `ALTER TABLE campaign_story_templates ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,

    // --- Fix clinic tables missing columns ---
    `ALTER TABLE clinic_queue ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
    `ALTER TABLE clinic_prescriptions ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,

    // --- Fix marks table: ensure amount columns are NUMERIC not INTEGER ---
    // (The "invalid input syntax for type integer: 29.99" error)

    // --- Fix notifications table missing tenant_id for RLS ---
    `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,

    // --- Fix donor_loyalty_tiers missing columns (FATAL: column "min_points" does not exist) ---
    `ALTER TABLE donor_loyalty_tiers ADD COLUMN IF NOT EXISTS min_points INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE donor_loyalty_tiers ADD COLUMN IF NOT EXISTS max_points INTEGER`,
    `ALTER TABLE donor_loyalty_tiers ADD COLUMN IF NOT EXISTS badge_color TEXT DEFAULT '#6b7280'`,
    `ALTER TABLE donor_loyalty_tiers ADD COLUMN IF NOT EXISTS benefits TEXT`,

    // --- Fix currency_wallets missing column (FATAL: column "currency" does not exist) ---
    `ALTER TABLE currency_wallets ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'UGX'`,
    `ALTER TABLE currency_wallets ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0`,
    `ALTER TABLE currency_wallets ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,

    // --- Fix forum_categories_pro missing sort_order ---
    `ALTER TABLE forum_categories_pro ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,

    // --- Fix translations missing entity_type ---
    `ALTER TABLE translations ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'general'`,
    `ALTER TABLE translations ADD COLUMN IF NOT EXISTS entity_id INTEGER`,

    // --- Fix payment_gateways missing gateway_type ---
    `ALTER TABLE payment_gateways ADD COLUMN IF NOT EXISTS gateway_type TEXT DEFAULT 'mtn_momo'`,

    // --- Fix compliance_requirements missing regulation_reference ---
    `ALTER TABLE compliance_requirements ADD COLUMN IF NOT EXISTS regulation_reference TEXT`,

    // --- Fix thank_you_templates missing subject ---
    `ALTER TABLE thank_you_templates ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT 'Thank You'`,

    // --- Fix reengagement_campaigns missing target_criteria ---
    `ALTER TABLE reengagement_campaigns ADD COLUMN IF NOT EXISTS target_criteria JSONB DEFAULT '{}'`,

    // --- Fix campaign_templates missing story_template ---
    `ALTER TABLE campaign_templates ADD COLUMN IF NOT EXISTS story_template TEXT`,

    // --- Fix tip_settings missing default_percentage ---
    `ALTER TABLE tip_settings ADD COLUMN IF NOT EXISTS default_percentage NUMERIC DEFAULT 10`,

    // --- Fix currency_display_settings missing supported_currencies_json ---
    `ALTER TABLE currency_display_settings ADD COLUMN IF NOT EXISTS supported_currencies_json JSONB DEFAULT '[]'`,

    // --- Fix email_verifications missing columns ---
    `ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS code VARCHAR(10)`,
    `ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'`,
    `ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false`,
    `ALTER TABLE email_verifications ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`,

    // --- Fix session manager missing expires_at ---
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS tenant_id INT`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_type VARCHAR(20)`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS browser VARCHAR(50)`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS os VARCHAR(50)`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS location VARCHAR(100)`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT false`,
    `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW()`,
    // --- Fix scraped_content missing view_count ---
    `ALTER TABLE scraped_content ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`,
    `ALTER TABLE scraped_content ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0`,
    `ALTER TABLE scraped_content ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
  ];

  for (const sql of fixStatements) {
    try {
      await pool.query(sql);
      const match = sql.match(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
      if (match) results.altered.push(`${match[1]}.${match[2]}`);
    } catch (e) {
      if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
        console.warn('[SchemaGaps] Fix error:', e.message.substring(0, 100));
      }
    }
  }

  // --- Fix marks table: cast amount-like columns from INTEGER to NUMERIC ---
  // This addresses "invalid input syntax for type integer: 29.99"
  try {
    const marksCols = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'marks' AND column_name IN ('mark', 'score', 'percentage', 'grade', 'points')
    `);
    for (const col of marksCols.rows) {
      if (col.data_type === 'integer') {
        await pool.query(`ALTER TABLE marks ALTER COLUMN ${col.column_name} TYPE NUMERIC USING ${col.column_name}::NUMERIC`);
        results.altered.push(`marks.${col.column_name} (integer→numeric)`);
      }
    }
  } catch (e) {
    // Non-critical - table might not exist yet
    if (!e.message.includes('does not exist')) {
      console.warn('[SchemaGaps] Marks type fix error:', e.message.substring(0, 100));
    }
  }

  // --- Fix RLS POLICY syntax: Drop broken policies and recreate with correct syntax ---
  // The error "syntax error at or near POLICY" occurs when using CREATE POLICY on tables
  // that don't have RLS enabled, or using incorrect policy syntax.
  // Safe approach: only enable RLS if the table exists, and create policies with IF NOT EXISTS logic.
  try {
    const rlsTables = ['notifications', 'inventory', 'attendance', 'marks', 'announcements', 'events'];
    for (const table of rlsTables) {
      try {
        // Check if table exists and has tenant_id
        const tableCheck = await pool.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'tenant_id'
          LIMIT 1
        `, [table]);

        if (tableCheck.rows.length > 0) {
          // Enable RLS on the table
          await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).catch(() => {});

          // Drop existing policies if any (to avoid conflicts)
          const existingPolicies = await pool.query(`
            SELECT policyname FROM pg_policies WHERE tablename = $1
          `, [table]);

          for (const p of existingPolicies.rows) {
            await pool.query(`DROP POLICY IF EXISTS "${p.policyname}" ON ${table}`).catch(() => {});
          }

          // Create tenant isolation policy
          await pool.query(`
            CREATE POLICY tenant_isolation ON ${table}
            USING (tenant_id = current_setting('app.current_tenant_id', true)::integer)
          `).catch(() => {});

          results.altered.push(`${table}.rls_policy`);
        }
      } catch (e) {
        // Non-critical - RLS setup failure shouldn't block startup
        if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
          console.warn(`[SchemaGaps] RLS fix for ${table}:`, e.message.substring(0, 80));
        }
      }
    }
  } catch (e) {
    console.warn('[SchemaGaps] RLS batch error:', e.message.substring(0, 100));
  }

  console.log('[SchemaGaps] Created tables:', results.created.join(', '));
  console.log('[SchemaGaps] Added columns:', results.altered.join(', '));

  return results;
};
