/**
 * Fundraising Ultimate 5 — Community & Social Module
 * 15 Features:
 *  1. Community Hub
 *  2. Discussion Forums Pro
 *  3. Mentorship Program
 *  4. Peer Network Groups
 *  5. Regional Chapters
 *  6. Alumni Giving Network
 *  7. Corporate CSR Portal
 *  8. Ambassador Program Pro
 *  9. Referral System Pro
 * 10. Social Impact Stories
 * 11. Volunteer Time Tracking
 * 12. Giving Circles
 * 13. Community Events Calendar
 * 14. Donor Wall Pro
 * 15. Recognition & Awards
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // ===== FEATURE 1: Community Hub =====
    `CREATE TABLE IF NOT EXISTS community_hub_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      post_type TEXT DEFAULT 'discussion' CHECK (post_type IN ('discussion','announcement','question','story','idea')),
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      is_pinned BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS community_hub_reactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      post_id INTEGER REFERENCES community_hub_posts(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      reaction_type TEXT DEFAULT 'like' CHECK (reaction_type IN ('like','love','celebrate','support','insightful')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, post_id, user_email, reaction_type)
    )`,

    // ===== FEATURE 2: Discussion Forums Pro =====
    `CREATE TABLE IF NOT EXISTS forum_categories_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS forum_threads_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES forum_categories_pro(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      title TEXT NOT NULL,
      is_pinned BOOLEAN DEFAULT false,
      is_locked BOOLEAN DEFAULT false,
      views INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS forum_replies_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      thread_id INTEGER REFERENCES forum_threads_pro(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 3: Mentorship Program =====
    `CREATE TABLE IF NOT EXISTS mentorship_programs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS mentorship_pairs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      program_id INTEGER REFERENCES mentorship_programs(id) ON DELETE CASCADE,
      mentor_email TEXT NOT NULL,
      mentee_email TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
      paired_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mentorship_sessions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      pair_id INTEGER REFERENCES mentorship_pairs(id) ON DELETE CASCADE,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      duration_minutes INTEGER DEFAULT 0
    )`,

    // ===== FEATURE 4: Peer Network Groups =====
    `CREATE TABLE IF NOT EXISTS peer_groups (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_private BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS peer_group_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES peer_groups(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      role TEXT DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, group_id, member_email)
    )`,
    `CREATE TABLE IF NOT EXISTS peer_group_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      group_id INTEGER REFERENCES peer_groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      description TEXT
    )`,

    // ===== FEATURE 5: Regional Chapters =====
    `CREATE TABLE IF NOT EXISTS regional_chapters (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      region TEXT,
      country TEXT,
      description TEXT,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS chapter_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      chapter_id INTEGER REFERENCES regional_chapters(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      role TEXT DEFAULT 'member' CHECK (role IN ('leader','coordinator','member')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, chapter_id, member_email)
    )`,
    `CREATE TABLE IF NOT EXISTS chapter_activities (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      chapter_id INTEGER REFERENCES regional_chapters(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      activity_date DATE NOT NULL,
      description TEXT
    )`,

    // ===== FEATURE 6: Alumni Giving Network =====
    `CREATE TABLE IF NOT EXISTS alumni_networks_ult5 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      institution TEXT,
      graduation_year_range TEXT,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS alumni_members_ult5 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      network_id INTEGER REFERENCES alumni_networks_ult5(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      graduation_year INTEGER,
      UNIQUE(tenant_id, network_id, member_email)
    )`,
    `CREATE TABLE IF NOT EXISTS alumni_events_ult5 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      network_id INTEGER REFERENCES alumni_networks_ult5(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      description TEXT
    )`,

    // ===== FEATURE 7: Corporate CSR Portal =====
    `CREATE TABLE IF NOT EXISTS csr_portals (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      contact_email TEXT,
      csr_focus TEXT,
      partnership_level TEXT DEFAULT 'basic' CHECK (partnership_level IN ('basic','silver','gold','platinum')),
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS csr_projects (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      portal_id INTEGER REFERENCES csr_portals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      budget INTEGER DEFAULT 0,
      status TEXT DEFAULT 'planning' CHECK (status IN ('planning','active','completed','on_hold','cancelled'))
    )`,
    `CREATE TABLE IF NOT EXISTS csr_reports (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES csr_projects(id) ON DELETE CASCADE,
      report_text TEXT,
      impact_metrics_json JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 8: Ambassador Program Pro =====
    `CREATE TABLE IF NOT EXISTS ambassadors_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')),
      referrals_count INTEGER DEFAULT 0,
      earnings INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      UNIQUE(tenant_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS ambassador_activities (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      ambassador_id INTEGER REFERENCES ambassadors_pro(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      description TEXT,
      points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ambassador_rewards (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      ambassador_id INTEGER REFERENCES ambassadors_pro(id) ON DELETE CASCADE,
      reward_type TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      claimed BOOLEAN DEFAULT false,
      claimed_at TIMESTAMPTZ
    )`,

    // ===== FEATURE 9: Referral System Pro =====
    `CREATE TABLE IF NOT EXISTS referral_tiers_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      min_referrals INTEGER NOT NULL DEFAULT 0,
      reward TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS referral_tracking_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      referrer_email TEXT NOT NULL,
      referred_email TEXT NOT NULL,
      campaign_id INTEGER,
      reward_earned INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 10: Social Impact Stories =====
    `CREATE TABLE IF NOT EXISTS impact_stories (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      beneficiary_name TEXT,
      image_url TEXT,
      campaign_id INTEGER,
      is_published BOOLEAN DEFAULT false,
      published_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS impact_story_reactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      story_id INTEGER REFERENCES impact_stories(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      reaction_type TEXT DEFAULT 'like' CHECK (reaction_type IN ('like','love','inspired','touched','celebrate')),
      UNIQUE(tenant_id, story_id, user_email, reaction_type)
    )`,

    // ===== FEATURE 11: Volunteer Time Tracking =====
    `CREATE TABLE IF NOT EXISTS volunteer_profiles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      skills_json JSONB DEFAULT '[]',
      total_hours NUMERIC(10,2) DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      UNIQUE(tenant_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS volunteer_time_logs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      volunteer_id INTEGER REFERENCES volunteer_profiles(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      hours NUMERIC(10,2) NOT NULL DEFAULT 0,
      activity TEXT,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      approved BOOLEAN DEFAULT false
    )`,

    // ===== FEATURE 12: Giving Circles =====
    `CREATE TABLE IF NOT EXISTS giving_circles (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      contribution_amount INTEGER DEFAULT 0,
      frequency TEXT DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
      total_members INTEGER DEFAULT 0,
      total_pool INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS giving_circle_members (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      circle_id INTEGER REFERENCES giving_circles(id) ON DELETE CASCADE,
      member_email TEXT NOT NULL,
      role TEXT DEFAULT 'member' CHECK (role IN ('admin','member')),
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, circle_id, member_email)
    )`,
    `CREATE TABLE IF NOT EXISTS giving_circle_nominations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      circle_id INTEGER REFERENCES giving_circles(id) ON DELETE CASCADE,
      nominee_email TEXT NOT NULL,
      nominator_email TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','voting')),
      UNIQUE(tenant_id, circle_id, nominee_email)
    )`,
    `CREATE TABLE IF NOT EXISTS giving_circle_votes (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      nomination_id INTEGER REFERENCES giving_circle_nominations(id) ON DELETE CASCADE,
      voter_email TEXT NOT NULL,
      vote TEXT NOT NULL CHECK (vote IN ('yes','no')),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, nomination_id, voter_email)
    )`,

    // ===== FEATURE 13: Community Events Calendar =====
    `CREATE TABLE IF NOT EXISTS community_events_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATE NOT NULL,
      location TEXT,
      max_attendees INTEGER DEFAULT 0,
      registered_count INTEGER DEFAULT 0,
      is_virtual BOOLEAN DEFAULT false,
      meeting_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS community_event_registrations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES community_events_pro(id) ON DELETE CASCADE,
      attendee_email TEXT NOT NULL,
      attendee_name TEXT NOT NULL,
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, event_id, attendee_email)
    )`,

    // ===== FEATURE 14: Donor Wall Pro =====
    `CREATE TABLE IF NOT EXISTS donor_wall_config_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'Donor Wall',
      layout TEXT DEFAULT 'grid' CHECK (layout IN ('grid','list','masonry','carousel')),
      show_amounts BOOLEAN DEFAULT true,
      show_dates BOOLEAN DEFAULT true,
      min_amount_display INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS donor_wall_entries_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_name TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      message TEXT,
      display_name TEXT,
      is_featured BOOLEAN DEFAULT false,
      donated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 15: Recognition & Awards =====
    `CREATE TABLE IF NOT EXISTS recognition_awards (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      criteria TEXT,
      icon_url TEXT,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS recognition_recipients (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      award_id INTEGER REFERENCES recognition_awards(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      awarded_by TEXT,
      awarded_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT
    )`,

    // ===== INDEXES =====
    `CREATE INDEX IF NOT EXISTS idx_community_hub_posts_tenant ON community_hub_posts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_community_hub_reactions_tenant ON community_hub_reactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forum_categories_pro_tenant ON forum_categories_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forum_threads_pro_tenant ON forum_threads_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forum_replies_pro_tenant ON forum_replies_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mentorship_programs_tenant ON mentorship_programs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mentorship_pairs_tenant ON mentorship_pairs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_tenant ON mentorship_sessions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_peer_groups_tenant ON peer_groups(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_peer_group_members_tenant ON peer_group_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_peer_group_events_tenant ON peer_group_events(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_regional_chapters_tenant ON regional_chapters(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_members_tenant ON chapter_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_activities_tenant ON chapter_activities(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alumni_networks_ult5_tenant ON alumni_networks_ult5(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alumni_members_ult5_tenant ON alumni_members_ult5(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alumni_events_ult5_tenant ON alumni_events_ult5(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_csr_portals_tenant ON csr_portals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_csr_projects_tenant ON csr_projects(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_csr_reports_tenant ON csr_reports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ambassadors_pro_tenant ON ambassadors_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ambassador_activities_tenant ON ambassador_activities(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ambassador_rewards_tenant ON ambassador_rewards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_tiers_pro_tenant ON referral_tiers_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_tracking_pro_tenant ON referral_tracking_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_stories_tenant ON impact_stories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_impact_story_reactions_tenant ON impact_story_reactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_volunteer_profiles_tenant ON volunteer_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_volunteer_time_logs_tenant ON volunteer_time_logs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_giving_circles_tenant ON giving_circles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_giving_circle_members_tenant ON giving_circle_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_giving_circle_nominations_tenant ON giving_circle_nominations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_giving_circle_votes_tenant ON giving_circle_votes(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_community_events_pro_tenant ON community_events_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_community_event_registrations_tenant ON community_event_registrations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_wall_config_pro_tenant ON donor_wall_config_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_wall_entries_pro_tenant ON donor_wall_entries_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recognition_awards_tenant ON recognition_awards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recognition_recipients_tenant ON recognition_recipients(tenant_id)`,
  ];

  // Run migrations and seed data
  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate5] Migrations complete');

    // ===== SEED DATA =====
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;

      // Seed: 4 forum categories per tenant
      const seedCategories = [
        { name: 'General Discussion', description: 'Open conversations about fundraising and community', sort_order: 1 },
        { name: 'Campaign Ideas', description: 'Share and brainstorm campaign ideas', sort_order: 2 },
        { name: 'Success Stories', description: 'Celebrate fundraising wins and milestones', sort_order: 3 },
        { name: 'Support & Help', description: 'Ask questions and get help from the community', sort_order: 4 }
      ];
      for (const t of tenants) {
        for (const cat of seedCategories) {
          await pool.query(
            `INSERT INTO forum_categories_pro (tenant_id, name, description, sort_order)
             SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM forum_categories_pro WHERE tenant_id=$1 AND name=$2)`,
            [t.id, cat.name, cat.description, cat.sort_order]
          );
        }
      }

      // Seed: 4 referral tiers per tenant
      const seedRefTiers = [
        { name: 'Starter', min_referrals: 0, reward: 'Community badge' },
        { name: 'Advocate', min_referrals: 5, reward: 'Exclusive updates and badge' },
        { name: 'Champion', min_referrals: 15, reward: 'Special recognition and event invite' },
        { name: 'Legend', min_referrals: 50, reward: 'VIP access and personalized thank-you' }
      ];
      for (const t of tenants) {
        for (const rt of seedRefTiers) {
          await pool.query(
            `INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward)
             SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM referral_tiers_pro WHERE tenant_id=$1 AND name=$2)`,
            [t.id, rt.name, rt.min_referrals, rt.reward]
          );
        }
      }

      // Seed: default donor wall config per tenant
      for (const t of tenants) {
        await pool.query(
          `INSERT INTO donor_wall_config_pro (tenant_id, title, layout, show_amounts, show_dates, min_amount_display, is_active)
           SELECT $1, 'Donor Wall', 'grid', true, true, 0, true
           WHERE NOT EXISTS (SELECT 1 FROM donor_wall_config_pro WHERE tenant_id=$1)`,
          [t.id]
        );
      }

      // Seed: 4 recognition awards per tenant
      const seedAwards = [
        { name: 'Top Donor', description: 'Awarded to the highest individual donor', criteria: 'Highest total donation amount in a period', icon_url: '🏆' },
        { name: 'Community Champion', description: 'Awarded for outstanding community engagement', criteria: 'Most active community participant', icon_url: '🌟' },
        { name: 'Fundraising Hero', description: 'Awarded for exceptional campaign creation', criteria: 'Created the most successful campaigns', icon_url: '🦸' },
        { name: 'Volunteer Star', description: 'Awarded for dedicated volunteer service', criteria: 'Most volunteer hours logged', icon_url: '⭐' }
      ];
      for (const t of tenants) {
        for (const aw of seedAwards) {
          await pool.query(
            `INSERT INTO recognition_awards (tenant_id, name, description, criteria, icon_url, is_active)
             SELECT $1, $2, $3, $4, $5, true
             WHERE NOT EXISTS (SELECT 1 FROM recognition_awards WHERE tenant_id=$1 AND name=$2)`,
            [t.id, aw.name, aw.description, aw.criteria, aw.icon_url]
          );
        }
      }

      console.log('[FundraisingUltimate5] Seed data complete');
    } catch(e) { console.warn('[FundraisingUltimate5] Seed error:', e.message); }
  })();

  // ================================================================
  // FEATURE 1: COMMUNITY HUB
  // ================================================================

  // GET /api/community-posts — List community posts
  app.get('/api/community-posts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { post_type, limit, offset } = req.query;
    let q = 'SELECT * FROM community_hub_posts WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (post_type) { q += ' AND post_type=$' + idx; params.push(esc(post_type)); idx++; }
    q += ' ORDER BY is_pinned DESC, created_at DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/community-posts — Create a community post
  app.post('/api/community-posts', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, content, post_type, is_pinned } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
    const validTypes = ['discussion','announcement','question','story','idea'];
    if (post_type && !validTypes.includes(post_type)) return res.status(400).json({ error: 'Invalid post_type' });
    const result = await pool.query(
      'INSERT INTO community_hub_posts (tenant_id, author_email, title, content, post_type, is_pinned) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(req.session.user.email), esc(title), esc(content), post_type || 'discussion', is_pinned || false]
    );
    await audit(req.session.user.email, 'community_post_created', 'Created community post: ' + esc(title));
    res.json(result.rows[0]);
  }));

  // PUT /api/community-posts/:id — Update a community post
  app.put('/api/community-posts/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, content, post_type, is_pinned } = req.body;
    const existing = (await pool.query('SELECT * FROM community_hub_posts WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    const result = await pool.query(
      'UPDATE community_hub_posts SET title=COALESCE($1,title), content=COALESCE($2,content), post_type=COALESCE($3,post_type), is_pinned=COALESCE($4,is_pinned) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [title ? esc(title) : null, content ? esc(content) : null, post_type || null, is_pinned !== undefined ? is_pinned : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'community_post_updated', 'Updated community post #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/community-posts/:id — Delete a community post
  app.delete('/api/community-posts/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM community_hub_posts WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Post not found' });
    await audit(req.session.user.email, 'community_post_deleted', 'Deleted community post #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/community-posts/:id/react — React to a community post
  app.post('/api/community-posts/:id/react', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const postId = parseInt(req.params.id);
    const { reaction_type } = req.body;
    const validReactions = ['like','love','celebrate','support','insightful'];
    if (reaction_type && !validReactions.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction_type' });
    const post = (await pool.query('SELECT * FROM community_hub_posts WHERE id=$1 AND tenant_id=$2', [postId, t])).rows[0];
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const rType = reaction_type || 'like';
    const existing = (await pool.query('SELECT * FROM community_hub_reactions WHERE tenant_id=$1 AND post_id=$2 AND user_email=$3 AND reaction_type=$4', [t, postId, esc(req.session.user.email), rType])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM community_hub_reactions WHERE id=$1', [existing.id]);
      await pool.query('UPDATE community_hub_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id=$1', [postId]);
      res.json({ action: 'removed', reaction_type: rType });
    } else {
      await pool.query('INSERT INTO community_hub_reactions (tenant_id, post_id, user_email, reaction_type) VALUES ($1,$2,$3,$4)', [t, postId, esc(req.session.user.email), rType]);
      await pool.query('UPDATE community_hub_posts SET likes_count = likes_count + 1 WHERE id=$1', [postId]);
      res.json({ action: 'added', reaction_type: rType });
    }
  }));

  // ================================================================
  // FEATURE 2: DISCUSSION FORUMS PRO
  // ================================================================

  // GET /api/forum-categories — List forum categories
  app.get('/api/forum-categories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM forum_categories_pro WHERE tenant_id=$1 ORDER BY sort_order ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/forum-categories — Create a forum category
  app.post('/api/forum-categories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO forum_categories_pro (tenant_id, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), description ? esc(description) : null, sort_order || 0]
    );
    await audit(req.session.user.email, 'forum_category_created', 'Created forum category: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // GET /api/forum-threads — List forum threads
  app.get('/api/forum-threads', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { category_id, limit, offset } = req.query;
    let q = 'SELECT ft.*, fc.name as category_name FROM forum_threads_pro ft JOIN forum_categories_pro fc ON ft.category_id=fc.id WHERE ft.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (category_id) { q += ' AND ft.category_id=$' + idx; params.push(parseInt(category_id)); idx++; }
    q += ' ORDER BY ft.is_pinned DESC, ft.created_at DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/forum-threads — Create a forum thread
  app.post('/api/forum-threads', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { category_id, title, is_pinned } = req.body;
    if (!category_id || !title) return res.status(400).json({ error: 'category_id and title are required' });
    const result = await pool.query(
      'INSERT INTO forum_threads_pro (tenant_id, category_id, author_email, title, is_pinned) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, parseInt(category_id), esc(req.session.user.email), esc(title), is_pinned || false]
    );
    await audit(req.session.user.email, 'forum_thread_created', 'Created forum thread: ' + esc(title));
    res.json(result.rows[0]);
  }));

  // GET /api/forum-threads/:id/replies — List replies for a thread
  app.get('/api/forum-threads/:id/replies', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const threadId = parseInt(req.params.id);
    // Increment view count
    await pool.query('UPDATE forum_threads_pro SET views = views + 1 WHERE id=$1 AND tenant_id=$2', [threadId, t]);
    const thread = (await pool.query('SELECT * FROM forum_threads_pro WHERE id=$1 AND tenant_id=$2', [threadId, t])).rows[0];
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const replies = (await pool.query('SELECT * FROM forum_replies_pro WHERE tenant_id=$1 AND thread_id=$2 ORDER BY created_at ASC', [t, threadId])).rows;
    res.json({ thread, replies });
  }));

  // POST /api/forum-threads/:id/replies — Create a reply
  app.post('/api/forum-threads/:id/replies', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const threadId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const thread = (await pool.query('SELECT * FROM forum_threads_pro WHERE id=$1 AND tenant_id=$2', [threadId, t])).rows[0];
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.is_locked) return res.status(400).json({ error: 'Thread is locked' });
    const result = await pool.query(
      'INSERT INTO forum_replies_pro (tenant_id, thread_id, author_email, content) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, threadId, esc(req.session.user.email), esc(content)]
    );
    await audit(req.session.user.email, 'forum_reply_created', 'Replied to thread #' + threadId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 3: MENTORSHIP PROGRAM
  // ================================================================

  // GET /api/mentorship-programs — List mentorship programs
  app.get('/api/mentorship-programs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM mentorship_programs WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/mentorship-programs — Create a mentorship program
  app.post('/api/mentorship-programs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO mentorship_programs (tenant_id, name, description, is_active) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), description ? esc(description) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'mentorship_program_created', 'Created mentorship program: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/mentorship-programs/:id — Update a mentorship program
  app.put('/api/mentorship-programs/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_active } = req.body;
    const result = await pool.query(
      'UPDATE mentorship_programs SET name=COALESCE($1,name), description=COALESCE($2,description), is_active=COALESCE($3,is_active) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Program not found' });
    await audit(req.session.user.email, 'mentorship_program_updated', 'Updated mentorship program #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/mentorship-pair — Create a mentorship pair
  app.post('/api/mentorship-pair', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { program_id, mentor_email, mentee_email, status } = req.body;
    if (!program_id || !mentor_email || !mentee_email) return res.status(400).json({ error: 'program_id, mentor_email, and mentee_email are required' });
    const result = await pool.query(
      'INSERT INTO mentorship_pairs (tenant_id, program_id, mentor_email, mentee_email, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, parseInt(program_id), esc(mentor_email), esc(mentee_email), status || 'active']
    );
    await audit(req.session.user.email, 'mentorship_pair_created', 'Paired mentor ' + mentor_email + ' with mentee ' + mentee_email);
    // Notify both
    notify(t, mentor_email, 'New Mentee Assigned', 'You have been paired as a mentor with ' + mentee_email, 'mentorship');
    notify(t, mentee_email, 'Mentor Assigned', 'You have been paired with mentor ' + mentor_email, 'mentorship');
    res.json(result.rows[0]);
  }));

  // GET /api/mentorship-sessions — List mentorship sessions
  app.get('/api/mentorship-sessions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { pair_id, limit, offset } = req.query;
    let q = 'SELECT ms.*, mp.mentor_email, mp.mentee_email FROM mentorship_sessions ms JOIN mentorship_pairs mp ON ms.pair_id=mp.id WHERE ms.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (pair_id) { q += ' AND ms.pair_id=$' + idx; params.push(parseInt(pair_id)); idx++; }
    q += ' ORDER BY ms.date DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/mentorship-sessions — Create a mentorship session
  app.post('/api/mentorship-sessions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { pair_id, date, notes, duration_minutes } = req.body;
    if (!pair_id) return res.status(400).json({ error: 'pair_id is required' });
    const pair = (await pool.query('SELECT * FROM mentorship_pairs WHERE id=$1 AND tenant_id=$2', [parseInt(pair_id), t])).rows[0];
    if (!pair) return res.status(404).json({ error: 'Mentorship pair not found' });
    const result = await pool.query(
      'INSERT INTO mentorship_sessions (tenant_id, pair_id, date, notes, duration_minutes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, parseInt(pair_id), date || null, notes ? esc(notes) : null, duration_minutes || 0]
    );
    await audit(req.session.user.email, 'mentorship_session_created', 'Logged mentorship session for pair #' + pair_id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 4: PEER NETWORK GROUPS
  // ================================================================

  // GET /api/peer-groups — List peer groups
  app.get('/api/peer-groups', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM peer_groups WHERE tenant_id=$1 ORDER BY created_at DESC', [t]);
    res.json(result.rows);
  }));

  // POST /api/peer-groups — Create a peer group
  app.post('/api/peer-groups', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_private } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO peer_groups (tenant_id, name, description, is_private) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), description ? esc(description) : null, is_private || false]
    );
    // Creator becomes admin
    await pool.query(
      'INSERT INTO peer_group_members (tenant_id, group_id, member_email, role) VALUES ($1,$2,$3,$4)',
      [t, result.rows[0].id, esc(req.session.user.email), 'admin']
    );
    await audit(req.session.user.email, 'peer_group_created', 'Created peer group: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/peer-groups/:id — Update a peer group
  app.put('/api/peer-groups/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_private } = req.body;
    const result = await pool.query(
      'UPDATE peer_groups SET name=COALESCE($1,name), description=COALESCE($2,description), is_private=COALESCE($3,is_private) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, is_private !== undefined ? is_private : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Peer group not found' });
    await audit(req.session.user.email, 'peer_group_updated', 'Updated peer group #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/peer-groups/:id — Delete a peer group
  app.delete('/api/peer-groups/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM peer_groups WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Peer group not found' });
    await audit(req.session.user.email, 'peer_group_deleted', 'Deleted peer group #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/peer-groups/:id/join — Join a peer group
  app.post('/api/peer-groups/:id/join', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id);
    const group = (await pool.query('SELECT * FROM peer_groups WHERE id=$1 AND tenant_id=$2', [groupId, t])).rows[0];
    if (!group) return res.status(404).json({ error: 'Peer group not found' });
    const existing = (await pool.query('SELECT * FROM peer_group_members WHERE tenant_id=$1 AND group_id=$2 AND member_email=$3', [t, groupId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already a member' });
    const result = await pool.query(
      'INSERT INTO peer_group_members (tenant_id, group_id, member_email, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, groupId, esc(req.session.user.email), 'member']
    );
    await audit(req.session.user.email, 'peer_group_joined', 'Joined peer group #' + groupId);
    res.json(result.rows[0]);
  }));

  // GET /api/peer-groups/:id/events — List events for a peer group
  app.get('/api/peer-groups/:id/events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM peer_group_events WHERE tenant_id=$1 AND group_id=$2 ORDER BY event_date DESC', [t, groupId]);
    res.json(result.rows);
  }));

  // POST /api/peer-groups/:id/events — Create a peer group event
  app.post('/api/peer-groups/:id/events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const groupId = parseInt(req.params.id);
    const { title, event_date, description } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });
    const group = (await pool.query('SELECT * FROM peer_groups WHERE id=$1 AND tenant_id=$2', [groupId, t])).rows[0];
    if (!group) return res.status(404).json({ error: 'Peer group not found' });
    const result = await pool.query(
      'INSERT INTO peer_group_events (tenant_id, group_id, title, event_date, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, groupId, esc(title), event_date, description ? esc(description) : null]
    );
    await audit(req.session.user.email, 'peer_group_event_created', 'Created event for peer group #' + groupId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 5: REGIONAL CHAPTERS
  // ================================================================

  // GET /api/chapters — List regional chapters
  app.get('/api/chapters', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM regional_chapters WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/chapters — Create a regional chapter
  app.post('/api/chapters', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, region, country, description, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO regional_chapters (tenant_id, name, region, country, description, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), region ? esc(region) : null, country ? esc(country) : null, description ? esc(description) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'chapter_created', 'Created chapter: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/chapters/:id — Update a regional chapter
  app.put('/api/chapters/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, region, country, description, is_active } = req.body;
    const result = await pool.query(
      'UPDATE regional_chapters SET name=COALESCE($1,name), region=COALESCE($2,region), country=COALESCE($3,country), description=COALESCE($4,description), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, region !== undefined ? esc(region) : null, country !== undefined ? esc(country) : null, description !== undefined ? esc(description) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Chapter not found' });
    await audit(req.session.user.email, 'chapter_updated', 'Updated chapter #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/chapters/:id/join — Join a chapter
  app.post('/api/chapters/:id/join', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const chapterId = parseInt(req.params.id);
    const { role } = req.body;
    const chapter = (await pool.query('SELECT * FROM regional_chapters WHERE id=$1 AND tenant_id=$2', [chapterId, t])).rows[0];
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const existing = (await pool.query('SELECT * FROM chapter_members WHERE tenant_id=$1 AND chapter_id=$2 AND member_email=$3', [t, chapterId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already a member' });
    const result = await pool.query(
      'INSERT INTO chapter_members (tenant_id, chapter_id, member_email, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, chapterId, esc(req.session.user.email), role || 'member']
    );
    await audit(req.session.user.email, 'chapter_joined', 'Joined chapter #' + chapterId);
    res.json(result.rows[0]);
  }));

  // GET /api/chapters/:id/activities — List chapter activities
  app.get('/api/chapters/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const chapterId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM chapter_activities WHERE tenant_id=$1 AND chapter_id=$2 ORDER BY activity_date DESC', [t, chapterId]);
    res.json(result.rows);
  }));

  // POST /api/chapters/:id/activities — Create a chapter activity
  app.post('/api/chapters/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const chapterId = parseInt(req.params.id);
    const { title, activity_date, description } = req.body;
    if (!title || !activity_date) return res.status(400).json({ error: 'title and activity_date are required' });
    const chapter = (await pool.query('SELECT * FROM regional_chapters WHERE id=$1 AND tenant_id=$2', [chapterId, t])).rows[0];
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    const result = await pool.query(
      'INSERT INTO chapter_activities (tenant_id, chapter_id, title, activity_date, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, chapterId, esc(title), activity_date, description ? esc(description) : null]
    );
    await audit(req.session.user.email, 'chapter_activity_created', 'Created activity for chapter #' + chapterId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 6: ALUMNI GIVING NETWORK
  // ================================================================

  // GET /api/alumni-networks — List alumni networks
  app.get('/api/alumni-networks', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM alumni_networks_ult5 WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/alumni-networks — Create an alumni network
  app.post('/api/alumni-networks', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, institution, graduation_year_range, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO alumni_networks_ult5 (tenant_id, name, institution, graduation_year_range, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), institution ? esc(institution) : null, graduation_year_range ? esc(graduation_year_range) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'alumni_network_created', 'Created alumni network: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/alumni-networks/:id — Update an alumni network
  app.put('/api/alumni-networks/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, institution, graduation_year_range, is_active } = req.body;
    const result = await pool.query(
      'UPDATE alumni_networks_ult5 SET name=COALESCE($1,name), institution=COALESCE($2,institution), graduation_year_range=COALESCE($3,graduation_year_range), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : null, institution !== undefined ? esc(institution) : null, graduation_year_range !== undefined ? esc(graduation_year_range) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Alumni network not found' });
    await audit(req.session.user.email, 'alumni_network_updated', 'Updated alumni network #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/alumni-networks/:id/join — Join an alumni network
  app.post('/api/alumni-networks/:id/join', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const networkId = parseInt(req.params.id);
    const { graduation_year } = req.body;
    const network = (await pool.query('SELECT * FROM alumni_networks_ult5 WHERE id=$1 AND tenant_id=$2', [networkId, t])).rows[0];
    if (!network) return res.status(404).json({ error: 'Alumni network not found' });
    const existing = (await pool.query('SELECT * FROM alumni_members_ult5 WHERE tenant_id=$1 AND network_id=$2 AND member_email=$3', [t, networkId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already a member' });
    const result = await pool.query(
      'INSERT INTO alumni_members_ult5 (tenant_id, network_id, member_email, graduation_year) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, networkId, esc(req.session.user.email), graduation_year || null]
    );
    await audit(req.session.user.email, 'alumni_network_joined', 'Joined alumni network #' + networkId);
    res.json(result.rows[0]);
  }));

  // GET /api/alumni-networks/:id/events — List alumni events
  app.get('/api/alumni-networks/:id/events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const networkId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM alumni_events_ult5 WHERE tenant_id=$1 AND network_id=$2 ORDER BY event_date DESC', [t, networkId]);
    res.json(result.rows);
  }));

  // POST /api/alumni-networks/:id/events — Create an alumni event
  app.post('/api/alumni-networks/:id/events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const networkId = parseInt(req.params.id);
    const { title, event_date, description } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });
    const network = (await pool.query('SELECT * FROM alumni_networks_ult5 WHERE id=$1 AND tenant_id=$2', [networkId, t])).rows[0];
    if (!network) return res.status(404).json({ error: 'Alumni network not found' });
    const result = await pool.query(
      'INSERT INTO alumni_events_ult5 (tenant_id, network_id, title, event_date, description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, networkId, esc(title), event_date, description ? esc(description) : null]
    );
    await audit(req.session.user.email, 'alumni_event_created', 'Created event for alumni network #' + networkId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 7: CORPORATE CSR PORTAL
  // ================================================================

  // GET /api/csr-portals — List CSR portals
  app.get('/api/csr-portals', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM csr_portals WHERE tenant_id=$1 ORDER BY company_name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/csr-portals — Create a CSR portal
  app.post('/api/csr-portals', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { company_name, contact_email, csr_focus, partnership_level, is_active } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name is required' });
    const validLevels = ['basic','silver','gold','platinum'];
    if (partnership_level && !validLevels.includes(partnership_level)) return res.status(400).json({ error: 'Invalid partnership_level' });
    const result = await pool.query(
      'INSERT INTO csr_portals (tenant_id, company_name, contact_email, csr_focus, partnership_level, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(company_name), contact_email ? esc(contact_email) : null, csr_focus ? esc(csr_focus) : null, partnership_level || 'basic', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'csr_portal_created', 'Created CSR portal for ' + esc(company_name));
    res.json(result.rows[0]);
  }));

  // PUT /api/csr-portals/:id — Update a CSR portal
  app.put('/api/csr-portals/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { company_name, contact_email, csr_focus, partnership_level, is_active } = req.body;
    const result = await pool.query(
      'UPDATE csr_portals SET company_name=COALESCE($1,company_name), contact_email=COALESCE($2,contact_email), csr_focus=COALESCE($3,csr_focus), partnership_level=COALESCE($4,partnership_level), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [company_name ? esc(company_name) : null, contact_email !== undefined ? esc(contact_email) : null, csr_focus !== undefined ? esc(csr_focus) : null, partnership_level || null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'CSR portal not found' });
    await audit(req.session.user.email, 'csr_portal_updated', 'Updated CSR portal #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /api/csr-portals/:id/projects — List CSR projects for a portal
  app.get('/api/csr-portals/:id/projects', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const portalId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM csr_projects WHERE tenant_id=$1 AND portal_id=$2 ORDER BY id DESC', [t, portalId]);
    res.json(result.rows);
  }));

  // POST /api/csr-portals/:id/projects — Create a CSR project
  app.post('/api/csr-portals/:id/projects', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const portalId = parseInt(req.params.id);
    const { title, description, budget, status } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const portal = (await pool.query('SELECT * FROM csr_portals WHERE id=$1 AND tenant_id=$2', [portalId, t])).rows[0];
    if (!portal) return res.status(404).json({ error: 'CSR portal not found' });
    const validStatuses = ['planning','active','completed','on_hold','cancelled'];
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const result = await pool.query(
      'INSERT INTO csr_projects (tenant_id, portal_id, title, description, budget, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, portalId, esc(title), description ? esc(description) : null, budget || 0, status || 'planning']
    );
    await audit(req.session.user.email, 'csr_project_created', 'Created CSR project: ' + esc(title));
    res.json(result.rows[0]);
  }));

  // PUT /api/csr-portals/:id/projects — Update a CSR project (uses project id in body)
  app.put('/api/csr-portals/:id/projects', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { project_id, title, description, budget, status } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });
    const result = await pool.query(
      'UPDATE csr_projects SET title=COALESCE($1,title), description=COALESCE($2,description), budget=COALESCE($3,budget), status=COALESCE($4,status) WHERE id=$5 AND tenant_id=$6 AND portal_id=$7 RETURNING *',
      [title ? esc(title) : null, description !== undefined ? esc(description) : null, budget !== undefined ? budget : null, status || null, project_id, t, parseInt(req.params.id)]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'CSR project not found' });
    await audit(req.session.user.email, 'csr_project_updated', 'Updated CSR project #' + project_id);
    res.json(result.rows[0]);
  }));

  // POST /api/csr-projects/:id/report — Create a CSR report for a project
  app.post('/api/csr-projects/:id/report', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const projectId = parseInt(req.params.id);
    const { report_text, impact_metrics_json } = req.body;
    const project = (await pool.query('SELECT * FROM csr_projects WHERE id=$1 AND tenant_id=$2', [projectId, t])).rows[0];
    if (!project) return res.status(404).json({ error: 'CSR project not found' });
    const result = await pool.query(
      'INSERT INTO csr_reports (tenant_id, project_id, report_text, impact_metrics_json) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, projectId, report_text ? esc(report_text) : null, impact_metrics_json ? JSON.stringify(impact_metrics_json) : '{}']
    );
    await audit(req.session.user.email, 'csr_report_created', 'Created report for CSR project #' + projectId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 8: AMBASSADOR PROGRAM PRO
  // ================================================================

  // GET /api/ambassadors-pro — List ambassadors
  app.get('/api/ambassadors-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM ambassadors_pro WHERE tenant_id=$1 ORDER BY referrals_count DESC', [t]);
    res.json(result.rows);
  }));

  // POST /api/ambassadors-pro — Create an ambassador
  app.post('/api/ambassadors-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { email, name, tier } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name are required' });
    const validTiers = ['bronze','silver','gold','platinum'];
    if (tier && !validTiers.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
    const result = await pool.query(
      'INSERT INTO ambassadors_pro (tenant_id, email, name, tier) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(email), esc(name), tier || 'bronze']
    );
    await audit(req.session.user.email, 'ambassador_created', 'Created ambassador: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/ambassadors-pro/:id — Update an ambassador
  app.put('/api/ambassadors-pro/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, tier, referrals_count, earnings, is_active } = req.body;
    const result = await pool.query(
      'UPDATE ambassadors_pro SET name=COALESCE($1,name), tier=COALESCE($2,tier), referrals_count=COALESCE($3,referrals_count), earnings=COALESCE($4,earnings), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, tier || null, referrals_count !== undefined ? referrals_count : null, earnings !== undefined ? earnings : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ambassador not found' });
    await audit(req.session.user.email, 'ambassador_updated', 'Updated ambassador #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /api/ambassadors-pro/:id/activities — List ambassador activities
  app.get('/api/ambassadors-pro/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const ambassadorId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM ambassador_activities WHERE tenant_id=$1 AND ambassador_id=$2 ORDER BY created_at DESC', [t, ambassadorId]);
    res.json(result.rows);
  }));

  // POST /api/ambassadors-pro/:id/activities — Create an ambassador activity
  app.post('/api/ambassadors-pro/:id/activities', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const ambassadorId = parseInt(req.params.id);
    const { activity_type, description, points } = req.body;
    if (!activity_type) return res.status(400).json({ error: 'activity_type is required' });
    const ambassador = (await pool.query('SELECT * FROM ambassadors_pro WHERE id=$1 AND tenant_id=$2', [ambassadorId, t])).rows[0];
    if (!ambassador) return res.status(404).json({ error: 'Ambassador not found' });
    const result = await pool.query(
      'INSERT INTO ambassador_activities (tenant_id, ambassador_id, activity_type, description, points) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, ambassadorId, esc(activity_type), description ? esc(description) : null, points || 0]
    );
    await audit(req.session.user.email, 'ambassador_activity_created', 'Logged activity for ambassador #' + ambassadorId);
    res.json(result.rows[0]);
  }));

  // GET /api/ambassadors-pro/:id/rewards — List ambassador rewards
  app.get('/api/ambassadors-pro/:id/rewards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const ambassadorId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM ambassador_rewards WHERE tenant_id=$1 AND ambassador_id=$2 ORDER BY id DESC', [t, ambassadorId]);
    res.json(result.rows);
  }));

  // POST /api/ambassadors-pro/:id/rewards — Create an ambassador reward
  app.post('/api/ambassadors-pro/:id/rewards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const ambassadorId = parseInt(req.params.id);
    const { reward_type, value } = req.body;
    if (!reward_type) return res.status(400).json({ error: 'reward_type is required' });
    const ambassador = (await pool.query('SELECT * FROM ambassadors_pro WHERE id=$1 AND tenant_id=$2', [ambassadorId, t])).rows[0];
    if (!ambassador) return res.status(404).json({ error: 'Ambassador not found' });
    const result = await pool.query(
      'INSERT INTO ambassador_rewards (tenant_id, ambassador_id, reward_type, value) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, ambassadorId, esc(reward_type), value || 0]
    );
    await audit(req.session.user.email, 'ambassador_reward_created', 'Created reward for ambassador #' + ambassadorId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 9: REFERRAL SYSTEM PRO
  // ================================================================

  // GET /api/referral-tiers-pro — List referral tiers
  app.get('/api/referral-tiers-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM referral_tiers_pro WHERE tenant_id=$1 ORDER BY min_referrals ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/referral-tiers-pro — Create a referral tier
  app.post('/api/referral-tiers-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, min_referrals, reward } = req.body;
    if (!name || min_referrals === undefined) return res.status(400).json({ error: 'name and min_referrals are required' });
    const result = await pool.query(
      'INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), parseInt(min_referrals), reward ? esc(reward) : null]
    );
    await audit(req.session.user.email, 'referral_tier_created', 'Created referral tier: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/referral-tiers-pro/:id — Update a referral tier
  app.put('/api/referral-tiers-pro/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, min_referrals, reward } = req.body;
    const result = await pool.query(
      'UPDATE referral_tiers_pro SET name=COALESCE($1,name), min_referrals=COALESCE($2,min_referrals), reward=COALESCE($3,reward) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [name ? esc(name) : null, min_referrals !== undefined ? parseInt(min_referrals) : null, reward !== undefined ? esc(reward) : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Referral tier not found' });
    await audit(req.session.user.email, 'referral_tier_updated', 'Updated referral tier #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /api/referral-tracking-pro — List referral tracking entries
  app.get('/api/referral-tracking-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { referrer_email, limit, offset } = req.query;
    let q = 'SELECT * FROM referral_tracking_pro WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (referrer_email) { q += ' AND referrer_email=$' + idx; params.push(esc(referrer_email)); idx++; }
    q += ' ORDER BY created_at DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/referral-tracking-pro — Create a referral tracking entry
  app.post('/api/referral-tracking-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { referrer_email, referred_email, campaign_id, reward_earned } = req.body;
    if (!referrer_email || !referred_email) return res.status(400).json({ error: 'referrer_email and referred_email are required' });
    const result = await pool.query(
      'INSERT INTO referral_tracking_pro (tenant_id, referrer_email, referred_email, campaign_id, reward_earned) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(referrer_email), esc(referred_email), campaign_id || null, reward_earned || 0]
    );
    // Update ambassador referrals_count if applicable
    await pool.query('UPDATE ambassadors_pro SET referrals_count = referrals_count + 1 WHERE tenant_id=$1 AND email=$2', [t, esc(referrer_email)]);
    await audit(req.session.user.email, 'referral_tracked', 'Tracked referral from ' + referrer_email + ' to ' + referred_email);
    // Notify referrer
    notify(t, referrer_email, 'New Referral', 'Your referral to ' + referred_email + ' has been recorded!', 'referral');
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 10: SOCIAL IMPACT STORIES
  // ================================================================

  // GET /api/impact-stories — List impact stories
  app.get('/api/impact-stories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { is_published, campaign_id, limit, offset } = req.query;
    let q = 'SELECT * FROM impact_stories WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (is_published !== undefined) { q += ' AND is_published=$' + idx; params.push(is_published === 'true'); idx++; }
    if (campaign_id) { q += ' AND campaign_id=$' + idx; params.push(parseInt(campaign_id)); idx++; }
    q += ' ORDER BY published_at DESC NULLS LAST, id DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/impact-stories — Create an impact story
  app.post('/api/impact-stories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, content, beneficiary_name, image_url, campaign_id } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
    const result = await pool.query(
      'INSERT INTO impact_stories (tenant_id, title, content, beneficiary_name, image_url, campaign_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(title), esc(content), beneficiary_name ? esc(beneficiary_name) : null, image_url ? esc(image_url) : null, campaign_id || null]
    );
    await audit(req.session.user.email, 'impact_story_created', 'Created impact story: ' + esc(title));
    res.json(result.rows[0]);
  }));

  // PUT /api/impact-stories/:id — Update an impact story
  app.put('/api/impact-stories/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, content, beneficiary_name, image_url, campaign_id, is_published } = req.body;
    const result = await pool.query(
      'UPDATE impact_stories SET title=COALESCE($1,title), content=COALESCE($2,content), beneficiary_name=COALESCE($3,beneficiary_name), image_url=COALESCE($4,image_url), campaign_id=COALESCE($5,campaign_id), is_published=COALESCE($6,is_published) WHERE id=$7 AND tenant_id=$8 RETURNING *',
      [title ? esc(title) : null, content ? esc(content) : null, beneficiary_name !== undefined ? esc(beneficiary_name) : null, image_url !== undefined ? esc(image_url) : null, campaign_id !== undefined ? campaign_id : null, is_published !== undefined ? is_published : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Impact story not found' });
    await audit(req.session.user.email, 'impact_story_updated', 'Updated impact story #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/impact-stories/:id — Delete an impact story
  app.delete('/api/impact-stories/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM impact_stories WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Impact story not found' });
    await audit(req.session.user.email, 'impact_story_deleted', 'Deleted impact story #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/impact-stories/:id/react — React to an impact story
  app.post('/api/impact-stories/:id/react', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const storyId = parseInt(req.params.id);
    const { reaction_type } = req.body;
    const validReactions = ['like','love','inspired','touched','celebrate'];
    if (reaction_type && !validReactions.includes(reaction_type)) return res.status(400).json({ error: 'Invalid reaction_type' });
    const story = (await pool.query('SELECT * FROM impact_stories WHERE id=$1 AND tenant_id=$2', [storyId, t])).rows[0];
    if (!story) return res.status(404).json({ error: 'Impact story not found' });
    const rType = reaction_type || 'like';
    const existing = (await pool.query('SELECT * FROM impact_story_reactions WHERE tenant_id=$1 AND story_id=$2 AND user_email=$3 AND reaction_type=$4', [t, storyId, esc(req.session.user.email), rType])).rows[0];
    if (existing) {
      await pool.query('DELETE FROM impact_story_reactions WHERE id=$1', [existing.id]);
      res.json({ action: 'removed', reaction_type: rType });
    } else {
      await pool.query('INSERT INTO impact_story_reactions (tenant_id, story_id, user_email, reaction_type) VALUES ($1,$2,$3,$4)', [t, storyId, esc(req.session.user.email), rType]);
      res.json({ action: 'added', reaction_type: rType });
    }
  }));

  // POST /api/impact-stories/:id/publish — Publish an impact story
  app.post('/api/impact-stories/:id/publish', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const storyId = parseInt(req.params.id);
    const result = await pool.query(
      "UPDATE impact_stories SET is_published=true, published_at=NOW() WHERE id=$1 AND tenant_id=$2 AND is_published=false RETURNING *",
      [storyId, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Unpublished impact story not found' });
    await audit(req.session.user.email, 'impact_story_published', 'Published impact story #' + storyId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 11: VOLUNTEER TIME TRACKING
  // ================================================================

  // GET /api/volunteer-profiles — List volunteer profiles
  app.get('/api/volunteer-profiles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { is_active, limit, offset } = req.query;
    let q = 'SELECT * FROM volunteer_profiles WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (is_active !== undefined) { q += ' AND is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY total_hours DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/volunteer-profiles — Create a volunteer profile
  app.post('/api/volunteer-profiles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { email, name, skills_json, is_active } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'email and name are required' });
    const result = await pool.query(
      `INSERT INTO volunteer_profiles (tenant_id, email, name, skills_json, is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, email) DO UPDATE SET name=$3, skills_json=COALESCE($4,volunteer_profiles.skills_json), is_active=COALESCE($5,volunteer_profiles.is_active)
       RETURNING *`,
      [t, esc(email), esc(name), skills_json ? JSON.stringify(skills_json) : '[]', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'volunteer_profile_created', 'Created volunteer profile for ' + esc(email));
    res.json(result.rows[0]);
  }));

  // PUT /api/volunteer-profiles/:id — Update a volunteer profile
  app.put('/api/volunteer-profiles/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, skills_json, is_active } = req.body;
    const result = await pool.query(
      'UPDATE volunteer_profiles SET name=COALESCE($1,name), skills_json=COALESCE($2,skills_json), is_active=COALESCE($3,is_active) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [name ? esc(name) : null, skills_json ? JSON.stringify(skills_json) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Volunteer profile not found' });
    await audit(req.session.user.email, 'volunteer_profile_updated', 'Updated volunteer profile #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // GET /api/volunteer-time-logs — List volunteer time logs
  app.get('/api/volunteer-time-logs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { volunteer_id, approved, limit, offset } = req.query;
    let q = 'SELECT vtl.*, vp.name as volunteer_name, vp.email as volunteer_email FROM volunteer_time_logs vtl JOIN volunteer_profiles vp ON vtl.volunteer_id=vp.id WHERE vtl.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (volunteer_id) { q += ' AND vtl.volunteer_id=$' + idx; params.push(parseInt(volunteer_id)); idx++; }
    if (approved !== undefined) { q += ' AND vtl.approved=$' + idx; params.push(approved === 'true'); idx++; }
    q += ' ORDER BY vtl.date DESC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/volunteer-time-logs — Create a volunteer time log
  app.post('/api/volunteer-time-logs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { volunteer_id, campaign_id, hours, activity, date } = req.body;
    if (!volunteer_id || !hours) return res.status(400).json({ error: 'volunteer_id and hours are required' });
    const volunteer = (await pool.query('SELECT * FROM volunteer_profiles WHERE id=$1 AND tenant_id=$2', [parseInt(volunteer_id), t])).rows[0];
    if (!volunteer) return res.status(404).json({ error: 'Volunteer profile not found' });
    const result = await pool.query(
      'INSERT INTO volunteer_time_logs (tenant_id, volunteer_id, campaign_id, hours, activity, date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, parseInt(volunteer_id), campaign_id || null, parseFloat(hours), activity ? esc(activity) : null, date || null]
    );
    // Update total_hours on profile
    await pool.query('UPDATE volunteer_profiles SET total_hours = total_hours + $1 WHERE id=$2 AND tenant_id=$3', [parseFloat(hours), parseInt(volunteer_id), t]);
    await audit(req.session.user.email, 'volunteer_time_logged', 'Logged ' + hours + ' hours for volunteer #' + volunteer_id);
    res.json(result.rows[0]);
  }));

  // PUT /api/volunteer-time-logs/:id/approve — Approve a volunteer time log
  app.put('/api/volunteer-time-logs/:id/approve', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      "UPDATE volunteer_time_logs SET approved=true WHERE id=$1 AND tenant_id=$2 AND approved=false RETURNING *",
      [req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Unapproved time log not found' });
    await audit(req.session.user.email, 'volunteer_time_approved', 'Approved time log #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 12: GIVING CIRCLES
  // ================================================================

  // GET /api/giving-circles — List giving circles
  app.get('/api/giving-circles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM giving_circles WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/giving-circles — Create a giving circle
  app.post('/api/giving-circles', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, contribution_amount, frequency, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const validFreqs = ['weekly','monthly','quarterly','yearly'];
    if (frequency && !validFreqs.includes(frequency)) return res.status(400).json({ error: 'Invalid frequency' });
    const result = await pool.query(
      'INSERT INTO giving_circles (tenant_id, name, description, contribution_amount, frequency, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), description ? esc(description) : null, contribution_amount || 0, frequency || 'monthly', is_active !== undefined ? is_active : true]
    );
    // Creator becomes admin
    await pool.query(
      'INSERT INTO giving_circle_members (tenant_id, circle_id, member_email, role) VALUES ($1,$2,$3,$4)',
      [t, result.rows[0].id, esc(req.session.user.email), 'admin']
    );
    await audit(req.session.user.email, 'giving_circle_created', 'Created giving circle: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/giving-circles/:id — Update a giving circle
  app.put('/api/giving-circles/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, contribution_amount, frequency, is_active } = req.body;
    const result = await pool.query(
      'UPDATE giving_circles SET name=COALESCE($1,name), description=COALESCE($2,description), contribution_amount=COALESCE($3,contribution_amount), frequency=COALESCE($4,frequency), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, contribution_amount !== undefined ? contribution_amount : null, frequency || null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Giving circle not found' });
    await audit(req.session.user.email, 'giving_circle_updated', 'Updated giving circle #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/giving-circles/:id/join — Join a giving circle
  app.post('/api/giving-circles/:id/join', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const circleId = parseInt(req.params.id);
    const circle = (await pool.query('SELECT * FROM giving_circles WHERE id=$1 AND tenant_id=$2', [circleId, t])).rows[0];
    if (!circle) return res.status(404).json({ error: 'Giving circle not found' });
    const existing = (await pool.query('SELECT * FROM giving_circle_members WHERE tenant_id=$1 AND circle_id=$2 AND member_email=$3', [t, circleId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already a member' });
    const result = await pool.query(
      'INSERT INTO giving_circle_members (tenant_id, circle_id, member_email, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, circleId, esc(req.session.user.email), 'member']
    );
    // Update total_members count
    await pool.query('UPDATE giving_circles SET total_members = total_members + 1 WHERE id=$1 AND tenant_id=$2', [circleId, t]);
    await audit(req.session.user.email, 'giving_circle_joined', 'Joined giving circle #' + circleId);
    res.json(result.rows[0]);
  }));

  // POST /api/giving-circles/:id/nominate — Nominate someone to a giving circle
  app.post('/api/giving-circles/:id/nominate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const circleId = parseInt(req.params.id);
    const { nominee_email } = req.body;
    if (!nominee_email) return res.status(400).json({ error: 'nominee_email is required' });
    const circle = (await pool.query('SELECT * FROM giving_circles WHERE id=$1 AND tenant_id=$2', [circleId, t])).rows[0];
    if (!circle) return res.status(404).json({ error: 'Giving circle not found' });
    const existing = (await pool.query('SELECT * FROM giving_circle_nominations WHERE tenant_id=$1 AND circle_id=$2 AND nominee_email=$3', [t, circleId, esc(nominee_email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Person already nominated' });
    const result = await pool.query(
      'INSERT INTO giving_circle_nominations (tenant_id, circle_id, nominee_email, nominator_email, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, circleId, esc(nominee_email), esc(req.session.user.email), 'pending']
    );
    await audit(req.session.user.email, 'giving_circle_nomination', 'Nominated ' + nominee_email + ' to circle #' + circleId);
    res.json(result.rows[0]);
  }));

  // POST /api/giving-circles/nominations/:id/vote — Vote on a nomination
  app.post('/api/giving-circles/nominations/:id/vote', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const nominationId = parseInt(req.params.id);
    const { vote } = req.body;
    if (!vote || !['yes','no'].includes(vote)) return res.status(400).json({ error: 'vote must be "yes" or "no"' });
    const nomination = (await pool.query('SELECT * FROM giving_circle_nominations WHERE id=$1 AND tenant_id=$2', [nominationId, t])).rows[0];
    if (!nomination) return res.status(404).json({ error: 'Nomination not found' });
    const existing = (await pool.query('SELECT * FROM giving_circle_votes WHERE tenant_id=$1 AND nomination_id=$2 AND voter_email=$3', [t, nominationId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already voted' });
    const result = await pool.query(
      'INSERT INTO giving_circle_votes (tenant_id, nomination_id, voter_email, vote) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, nominationId, esc(req.session.user.email), vote]
    );
    // Check if nomination should be auto-approved (simple majority)
    const votes = (await pool.query('SELECT vote, COUNT(*) as cnt FROM giving_circle_votes WHERE tenant_id=$1 AND nomination_id=$2 GROUP BY vote', [t, nominationId])).rows;
    const yesCount = parseInt((votes.find(v => v.vote === 'yes') || {}).cnt) || 0;
    const noCount = parseInt((votes.find(v => v.vote === 'no') || {}).cnt) || 0;
    const totalVotes = yesCount + noCount;
    const members = (await pool.query('SELECT COUNT(*) as cnt FROM giving_circle_members WHERE tenant_id=$1 AND circle_id=$2', [t, nomination.circle_id])).rows[0];
    const memberCount = parseInt(members.cnt) || 1;

    if (yesCount > memberCount / 2) {
      await pool.query("UPDATE giving_circle_nominations SET status='approved' WHERE id=$1", [nominationId]);
      // Auto-add as member
      const alreadyMember = (await pool.query('SELECT * FROM giving_circle_members WHERE tenant_id=$1 AND circle_id=$2 AND member_email=$3', [t, nomination.circle_id, nomination.nominee_email])).rows[0];
      if (!alreadyMember) {
        await pool.query('INSERT INTO giving_circle_members (tenant_id, circle_id, member_email, role) VALUES ($1,$2,$3,$4)', [t, nomination.circle_id, nomination.nominee_email, 'member']);
        await pool.query('UPDATE giving_circles SET total_members = total_members + 1 WHERE id=$1 AND tenant_id=$2', [nomination.circle_id, t]);
      }
    } else if (noCount > memberCount / 2) {
      await pool.query("UPDATE giving_circle_nominations SET status='rejected' WHERE id=$1", [nominationId]);
    }

    await audit(req.session.user.email, 'giving_circle_vote', 'Voted ' + vote + ' on nomination #' + nominationId);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 13: COMMUNITY EVENTS CALENDAR
  // ================================================================

  // GET /api/community-events — List community events
  app.get('/api/community-events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { is_virtual, limit, offset } = req.query;
    let q = 'SELECT * FROM community_events_pro WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (is_virtual !== undefined) { q += ' AND is_virtual=$' + idx; params.push(is_virtual === 'true'); idx++; }
    q += ' ORDER BY event_date ASC';
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/community-events — Create a community event
  app.post('/api/community-events', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, description, event_date, location, max_attendees, is_virtual, meeting_url } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });
    const result = await pool.query(
      'INSERT INTO community_events_pro (tenant_id, title, description, event_date, location, max_attendees, is_virtual, meeting_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, esc(title), description ? esc(description) : null, event_date, location ? esc(location) : null, max_attendees || 0, is_virtual || false, meeting_url ? esc(meeting_url) : null]
    );
    await audit(req.session.user.email, 'community_event_created', 'Created community event: ' + esc(title));
    res.json(result.rows[0]);
  }));

  // PUT /api/community-events/:id — Update a community event
  app.put('/api/community-events/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, description, event_date, location, max_attendees, is_virtual, meeting_url } = req.body;
    const result = await pool.query(
      'UPDATE community_events_pro SET title=COALESCE($1,title), description=COALESCE($2,description), event_date=COALESCE($3,event_date), location=COALESCE($4,location), max_attendees=COALESCE($5,max_attendees), is_virtual=COALESCE($6,is_virtual), meeting_url=COALESCE($7,meeting_url) WHERE id=$8 AND tenant_id=$9 RETURNING *',
      [title ? esc(title) : null, description !== undefined ? esc(description) : null, event_date || null, location !== undefined ? esc(location) : null, max_attendees !== undefined ? max_attendees : null, is_virtual !== undefined ? is_virtual : null, meeting_url !== undefined ? esc(meeting_url) : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Community event not found' });
    await audit(req.session.user.email, 'community_event_updated', 'Updated community event #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/community-events/:id/register — Register for a community event
  app.post('/api/community-events/:id/register', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const eventId = parseInt(req.params.id);
    const { attendee_name } = req.body;
    const event = (await pool.query('SELECT * FROM community_events_pro WHERE id=$1 AND tenant_id=$2', [eventId, t])).rows[0];
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.max_attendees > 0 && event.registered_count >= event.max_attendees) return res.status(400).json({ error: 'Event is full' });
    const existing = (await pool.query('SELECT * FROM community_event_registrations WHERE tenant_id=$1 AND event_id=$2 AND attendee_email=$3', [t, eventId, esc(req.session.user.email)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Already registered' });
    const result = await pool.query(
      'INSERT INTO community_event_registrations (tenant_id, event_id, attendee_email, attendee_name) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, eventId, esc(req.session.user.email), esc(attendee_name || req.session.user.email)]
    );
    // Update registered_count
    await pool.query('UPDATE community_events_pro SET registered_count = registered_count + 1 WHERE id=$1 AND tenant_id=$2', [eventId, t]);
    await audit(req.session.user.email, 'community_event_registered', 'Registered for event #' + eventId);
    res.json(result.rows[0]);
  }));

  // GET /api/community-events/:id/attendees — List event attendees
  app.get('/api/community-events/:id/attendees', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const eventId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM community_event_registrations WHERE tenant_id=$1 AND event_id=$2 ORDER BY registered_at ASC', [t, eventId]);
    res.json(result.rows);
  }));

  // ================================================================
  // FEATURE 14: DONOR WALL PRO
  // ================================================================

  // GET /api/donor-wall-pro/config — Get donor wall configuration
  app.get('/api/donor-wall-pro/config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM donor_wall_config_pro WHERE tenant_id=$1', [t]);
    if (!result.rows[0]) return res.json({ title: 'Donor Wall', layout: 'grid', show_amounts: true, show_dates: true, min_amount_display: 0, is_active: true });
    res.json(result.rows[0]);
  }));

  // PUT /api/donor-wall-pro/config — Update donor wall configuration
  app.put('/api/donor-wall-pro/config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { title, layout, show_amounts, show_dates, min_amount_display, is_active } = req.body;
    const validLayouts = ['grid','list','masonry','carousel'];
    if (layout && !validLayouts.includes(layout)) return res.status(400).json({ error: 'Invalid layout' });
    const result = await pool.query(
      `UPDATE donor_wall_config_pro SET title=COALESCE($1,title), layout=COALESCE($2,layout), show_amounts=COALESCE($3,show_amounts), show_dates=COALESCE($4,show_dates), min_amount_display=COALESCE($5,min_amount_display), is_active=COALESCE($6,is_active) WHERE tenant_id=$7 RETURNING *`,
      [title ? esc(title) : null, layout || null, show_amounts !== undefined ? show_amounts : null, show_dates !== undefined ? show_dates : null, min_amount_display !== undefined ? min_amount_display : null, is_active !== undefined ? is_active : null, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Donor wall config not found' });
    await audit(req.session.user.email, 'donor_wall_config_updated', 'Updated donor wall config');
    res.json(result.rows[0]);
  }));

  // GET /api/donor-wall-pro/entries — List donor wall entries
  app.get('/api/donor-wall-pro/entries', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM donor_wall_config_pro WHERE tenant_id=$1', [t])).rows[0];
    const minAmount = config ? (config.min_amount_display || 0) : 0;
    const showAmounts = config ? config.show_amounts : true;
    const result = await pool.query(
      'SELECT * FROM donor_wall_entries_pro WHERE tenant_id=$1 AND amount >= $2 ORDER BY is_featured DESC, amount DESC, donated_at DESC',
      [t, minAmount]
    );
    res.json({ entries: result.rows, config: config || {} });
  }));

  // POST /api/donor-wall-pro/entries — Create a donor wall entry
  app.post('/api/donor-wall-pro/entries', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_name, amount, message, display_name, is_featured, donated_at } = req.body;
    if (!donor_name) return res.status(400).json({ error: 'donor_name is required' });
    const result = await pool.query(
      'INSERT INTO donor_wall_entries_pro (tenant_id, donor_name, amount, message, display_name, is_featured, donated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, esc(donor_name), amount || 0, message ? esc(message) : null, display_name ? esc(display_name) : null, is_featured || false, donated_at || null]
    );
    await audit(req.session.user.email, 'donor_wall_entry_created', 'Created donor wall entry for ' + esc(donor_name));
    res.json(result.rows[0]);
  }));

  // PUT /api/donor-wall-pro/entries/:id/feature — Toggle featured status
  app.put('/api/donor-wall-pro/entries/:id/feature', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const entry = (await pool.query('SELECT * FROM donor_wall_entries_pro WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    const result = await pool.query(
      'UPDATE donor_wall_entries_pro SET is_featured=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [!entry.is_featured, req.params.id, t]
    );
    await audit(req.session.user.email, 'donor_wall_entry_featured', (entry.is_featured ? 'Unfeatured' : 'Featured') + ' donor wall entry #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 15: RECOGNITION & AWARDS
  // ================================================================

  // GET /api/recognition-awards — List recognition awards
  app.get('/api/recognition-awards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM recognition_awards WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/recognition-awards — Create a recognition award
  app.post('/api/recognition-awards', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, criteria, icon_url, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO recognition_awards (tenant_id, name, description, criteria, icon_url, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), description ? esc(description) : null, criteria ? esc(criteria) : null, icon_url ? esc(icon_url) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'recognition_award_created', 'Created recognition award: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/recognition-awards/:id — Update a recognition award
  app.put('/api/recognition-awards/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, criteria, icon_url, is_active } = req.body;
    const result = await pool.query(
      'UPDATE recognition_awards SET name=COALESCE($1,name), description=COALESCE($2,description), criteria=COALESCE($3,criteria), icon_url=COALESCE($4,icon_url), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, criteria !== undefined ? esc(criteria) : null, icon_url !== undefined ? esc(icon_url) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Recognition award not found' });
    await audit(req.session.user.email, 'recognition_award_updated', 'Updated recognition award #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/recognition-awards/:id — Delete a recognition award
  app.delete('/api/recognition-awards/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM recognition_awards WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Recognition award not found' });
    await audit(req.session.user.email, 'recognition_award_deleted', 'Deleted recognition award #' + req.params.id);
    res.json({ success: true });
  }));

  // GET /api/recognition-awards/:id/recipients — List recipients for an award
  app.get('/api/recognition-awards/:id/recipients', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const awardId = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM recognition_recipients WHERE tenant_id=$1 AND award_id=$2 ORDER BY awarded_at DESC', [t, awardId]);
    res.json(result.rows);
  }));

  // POST /api/recognition-awards/:id/recipients — Award a recognition to someone
  app.post('/api/recognition-awards/:id/recipients', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const awardId = parseInt(req.params.id);
    const { recipient_email, recipient_name, notes } = req.body;
    if (!recipient_email || !recipient_name) return res.status(400).json({ error: 'recipient_email and recipient_name are required' });
    const award = (await pool.query('SELECT * FROM recognition_awards WHERE id=$1 AND tenant_id=$2', [awardId, t])).rows[0];
    if (!award) return res.status(404).json({ error: 'Recognition award not found' });
    const result = await pool.query(
      'INSERT INTO recognition_recipients (tenant_id, award_id, recipient_email, recipient_name, awarded_by, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, awardId, esc(recipient_email), esc(recipient_name), esc(req.session.user.email), notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'recognition_awarded', 'Awarded "' + award.name + '" to ' + esc(recipient_name));
    // Notify recipient
    notify(t, recipient_email, 'You Received an Award!', 'You have been awarded "' + award.name + '". ' + (notes || ''), 'recognition');
    res.json(result.rows[0]);
  }));

}; // end module.exports
