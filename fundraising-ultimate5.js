/**
 * Fundraising Ultimate5 Module — Community, Social & Engagement Pro
 * Features: Community Hub, Forums Pro, Mentorship, Peer Groups, Regional Chapters,
 * Alumni Network, CSR Portal, Ambassador Pro, Referral Pro, Impact Stories,
 * Volunteer Time, Giving Circles, Community Events, Donor Wall Pro, Recognition Awards
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Community Hub
    `CREATE TABLE IF NOT EXISTS community_hub_posts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, author_email TEXT NOT NULL, title TEXT NOT NULL, content TEXT, post_type TEXT DEFAULT 'discussion' CHECK (post_type IN ('discussion','announcement','story','question','celebration','idea')), likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0, is_pinned BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS community_hub_reactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES community_hub_posts(id) ON DELETE CASCADE, user_email TEXT NOT NULL, reaction_type TEXT DEFAULT 'like' CHECK (reaction_type IN ('like','love','celebrate','support','insightful')), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(post_id, user_email))`,
    `CREATE INDEX IF NOT EXISTS idx_hub_posts_tenant ON community_hub_posts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_hub_reactions_post ON community_hub_reactions(post_id)`,

    // Feature 2: Discussion Forums Pro
    `CREATE TABLE IF NOT EXISTS forum_categories_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, icon TEXT, display_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS forum_threads_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, category_id INTEGER NOT NULL REFERENCES forum_categories_pro(id) ON DELETE CASCADE, author_email TEXT NOT NULL, title TEXT NOT NULL, content TEXT, is_locked BOOLEAN DEFAULT false, is_sticky BOOLEAN DEFAULT false, views_count INTEGER DEFAULT 0, replies_count INTEGER DEFAULT 0, last_reply_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS forum_replies_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, thread_id INTEGER NOT NULL REFERENCES forum_threads_pro(id) ON DELETE CASCADE, author_email TEXT NOT NULL, content TEXT NOT NULL, is_solution BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_forum_cats_pro_tenant ON forum_categories_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forum_threads_cat ON forum_threads_pro(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies_pro(thread_id)`,

    // Feature 3: Mentorship Program
    `CREATE TABLE IF NOT EXISTS mentorship_programs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, capacity INTEGER DEFAULT 20, current_mentees INTEGER DEFAULT 0, status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','completed')), start_date DATE, end_date DATE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS mentorship_pairs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, program_id INTEGER NOT NULL REFERENCES mentorship_programs(id) ON DELETE CASCADE, mentor_email TEXT NOT NULL, mentor_name TEXT, mentee_email TEXT NOT NULL, mentee_name TEXT, goals TEXT, status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')), matched_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS mentorship_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, pair_id INTEGER NOT NULL REFERENCES mentorship_pairs(id) ON DELETE CASCADE, session_date DATE, duration_minutes INTEGER DEFAULT 60, notes TEXT, action_items TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_mentor_prog_tenant ON mentorship_programs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mentor_pairs_prog ON mentorship_pairs(program_id)`,

    // Feature 4: Peer Network Groups
    `CREATE TABLE IF NOT EXISTS peer_groups (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'general', is_private BOOLEAN DEFAULT false, max_members INTEGER DEFAULT 50, member_count INTEGER DEFAULT 0, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS peer_group_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES peer_groups(id) ON DELETE CASCADE, user_email TEXT NOT NULL, role TEXT DEFAULT 'member' CHECK (role IN ('admin','moderator','member')), joined_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(group_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS peer_group_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES peer_groups(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_date DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_peer_groups_tenant ON peer_groups(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_peer_members_group ON peer_group_members(group_id)`,

    // Feature 5: Regional Chapters
    `CREATE TABLE IF NOT EXISTS regional_chapters (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, region TEXT, district TEXT, country TEXT DEFAULT 'Uganda', description TEXT, leader_email TEXT, coordinator_email TEXT, member_count INTEGER DEFAULT 0, total_raised INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS chapter_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, chapter_id INTEGER NOT NULL REFERENCES regional_chapters(id) ON DELETE CASCADE, user_email TEXT NOT NULL, role TEXT DEFAULT 'member' CHECK (role IN ('leader','coordinator','member')), joined_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS chapter_activities (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, chapter_id INTEGER NOT NULL REFERENCES regional_chapters(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, activity_date DATE, amount_raised INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_chapters_tenant ON regional_chapters(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chapter_members_chapter ON chapter_members(chapter_id)`,

    // Feature 6: Alumni Giving Network
    `CREATE TABLE IF NOT EXISTS alumni_networks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, institution_name TEXT NOT NULL, graduation_year_range TEXT, description TEXT, total_members INTEGER DEFAULT 0, total_given INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS alumni_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, network_id INTEGER NOT NULL REFERENCES alumni_networks(id) ON DELETE CASCADE, user_email TEXT NOT NULL, full_name TEXT, graduation_year INTEGER, current_role TEXT, total_given INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS alumni_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, network_id INTEGER NOT NULL REFERENCES alumni_networks(id) ON DELETE CASCADE, title TEXT NOT NULL, event_date DATE, description TEXT, target_amount INTEGER DEFAULT 0, raised_amount INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_alumni_nets_tenant ON alumni_networks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alumni_members_net ON alumni_members(network_id)`,

    // Feature 7: Corporate CSR Portal
    `CREATE TABLE IF NOT EXISTS csr_portals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, company_name TEXT NOT NULL, contact_email TEXT, csr_budget INTEGER DEFAULT 0, focus_areas_json TEXT DEFAULT '[]', partnership_level TEXT DEFAULT 'bronze' CHECK (partnership_level IN ('bronze','silver','gold','platinum')), status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','pending')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS csr_projects (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, portal_id INTEGER NOT NULL REFERENCES csr_portals(id) ON DELETE CASCADE, project_name TEXT NOT NULL, description TEXT, budget INTEGER DEFAULT 0, start_date DATE, end_date DATE, impact_metrics_json TEXT DEFAULT '{}', status TEXT DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS csr_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES csr_projects(id) ON DELETE CASCADE, period TEXT, activities_json TEXT DEFAULT '[]', impact_summary TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_csr_portals_tenant ON csr_portals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_csr_projects_portal ON csr_projects(portal_id)`,

    // Feature 8: Ambassador Program Pro
    `CREATE TABLE IF NOT EXISTS ambassadors_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, full_name TEXT, tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze','silver','gold','platinum')), campaigns_promoted INTEGER DEFAULT 0, total_raised INTEGER DEFAULT 0, referral_code TEXT UNIQUE, commission_rate NUMERIC DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')), joined_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ambassador_activities (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, ambassador_id INTEGER NOT NULL REFERENCES ambassadors_pro(id) ON DELETE CASCADE, activity_type TEXT DEFAULT 'share' CHECK (activity_type IN ('share','refer','co_host','content','event')), campaign_id INTEGER, reach INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0, amount_raised INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ambassador_rewards (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, ambassador_id INTEGER NOT NULL REFERENCES ambassadors_pro(id) ON DELETE CASCADE, reward_type TEXT DEFAULT 'badge' CHECK (reward_type IN ('badge','commission','gift','recognition')), value TEXT, earned_at TIMESTAMPTZ DEFAULT NOW(), redeemed_at TIMESTAMPTZ, status TEXT DEFAULT 'available' CHECK (status IN ('available','redeemed','expired')))`,
    `CREATE INDEX IF NOT EXISTS idx_ambassadors_tenant ON ambassadors_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ambassador_acts_amb ON ambassador_activities(ambassador_id)`,

    // Feature 9: Referral System Pro
    `CREATE TABLE IF NOT EXISTS referral_tiers_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, min_referrals INTEGER DEFAULT 0, reward_type TEXT DEFAULT 'badge' CHECK (reward_type IN ('badge','credit','gift','commission')), reward_value TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS referral_tracking_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, referrer_email TEXT NOT NULL, referee_email TEXT, referral_code TEXT, campaign_id INTEGER, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','converted','rewarded','expired')), reward_earned INTEGER DEFAULT 0, reward_claimed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_referral_tiers_tenant ON referral_tiers_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_referral_track_tenant ON referral_tracking_pro(tenant_id)`,

    // Feature 10: Social Impact Stories
    `CREATE TABLE IF NOT EXISTS impact_stories (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT, beneficiary_name TEXT, campaign_id INTEGER, media_urls_json TEXT DEFAULT '[]', author_email TEXT, published BOOLEAN DEFAULT false, published_at TIMESTAMPTZ, views_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS impact_story_reactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, story_id INTEGER NOT NULL REFERENCES impact_stories(id) ON DELETE CASCADE, user_email TEXT, reaction_type TEXT DEFAULT 'inspired' CHECK (reaction_type IN ('inspired','touched','grateful','motivated')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_impact_stories_tenant ON impact_stories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_story_reactions_story ON impact_story_reactions(story_id)`,

    // Feature 11: Volunteer Time Tracking
    `CREATE TABLE IF NOT EXISTS volunteer_profiles (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, full_name TEXT, skills_json TEXT DEFAULT '[]', availability TEXT DEFAULT 'flexible', total_hours NUMERIC DEFAULT 0, hourly_value INTEGER DEFAULT 15000, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS volunteer_time_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, volunteer_id INTEGER NOT NULL REFERENCES volunteer_profiles(id) ON DELETE CASCADE, campaign_id INTEGER, log_date DATE DEFAULT CURRENT_DATE, hours NUMERIC NOT NULL, activity_description TEXT, verified_by TEXT, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_vol_profiles_tenant ON volunteer_profiles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vol_time_vol ON volunteer_time_logs(volunteer_id)`,

    // Feature 12: Giving Circles
    `CREATE TABLE IF NOT EXISTS giving_circles (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, contribution_amount INTEGER DEFAULT 0, frequency TEXT DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly','annually')), member_count INTEGER DEFAULT 0, total_pool INTEGER DEFAULT 0, decision_process TEXT DEFAULT 'vote' CHECK (decision_process IN ('vote','consensus','rotating','random')), created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS giving_circle_members (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, circle_id INTEGER NOT NULL REFERENCES giving_circles(id) ON DELETE CASCADE, user_email TEXT NOT NULL, role TEXT DEFAULT 'member' CHECK (role IN ('founder','admin','member')), total_contributed INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS giving_circle_nominations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, circle_id INTEGER NOT NULL REFERENCES giving_circles(id) ON DELETE CASCADE, nominator_email TEXT, campaign_id INTEGER, nomination_text TEXT, votes_count INTEGER DEFAULT 0, status TEXT DEFAULT 'nominated' CHECK (status IN ('nominated','voting','selected','rejected')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS giving_circle_votes (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, nomination_id INTEGER NOT NULL REFERENCES giving_circle_nominations(id) ON DELETE CASCADE, voter_email TEXT NOT NULL, vote TEXT DEFAULT 'yes' CHECK (vote IN ('yes','no')), voted_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(nomination_id, voter_email))`,
    `CREATE INDEX IF NOT EXISTS idx_giving_circles_tenant ON giving_circles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON giving_circle_members(circle_id)`,

    // Feature 13: Community Events Calendar
    `CREATE TABLE IF NOT EXISTS community_events_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, event_type TEXT DEFAULT 'fundraiser' CHECK (event_type IN ('fundraiser','social','workshop','gala','volunteer','meeting','other')), start_date DATE, end_date DATE, location TEXT, virtual_link TEXT, max_attendees INTEGER, registered_count INTEGER DEFAULT 0, target_amount INTEGER DEFAULT 0, raised_amount INTEGER DEFAULT 0, organizer_email TEXT, status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming','ongoing','completed','cancelled')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS community_event_registrations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, event_id INTEGER NOT NULL REFERENCES community_events_pro(id) ON DELETE CASCADE, user_email TEXT, full_name TEXT, ticket_type TEXT DEFAULT 'general', amount_paid INTEGER DEFAULT 0, registered_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_comm_events_tenant ON community_events_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_event_regs_event ON community_event_registrations(event_id)`,

    // Feature 14: Donor Wall Pro
    `CREATE TABLE IF NOT EXISTS donor_wall_config_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, title TEXT DEFAULT 'Donor Wall', layout TEXT DEFAULT 'grid' CHECK (layout IN ('grid','list','masonry','carousel')), display_options_json TEXT DEFAULT '{}', auto_update BOOLEAN DEFAULT true, min_amount_display INTEGER DEFAULT 0, show_amounts BOOLEAN DEFAULT true, show_dates BOOLEAN DEFAULT false, show_messages BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donor_wall_entries_pro (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, config_id INTEGER REFERENCES donor_wall_config_pro(id), donor_name TEXT, display_name TEXT, amount INTEGER, message TEXT, tier TEXT, featured BOOLEAN DEFAULT false, display_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_wall_config_tenant ON donor_wall_config_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wall_entries_tenant ON donor_wall_entries_pro(tenant_id)`,

    // Feature 15: Recognition & Awards
    `CREATE TABLE IF NOT EXISTS recognition_awards (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, award_type TEXT DEFAULT 'badge' CHECK (award_type IN ('badge','certificate','honor','title','medal')), criteria_json TEXT DEFAULT '{}', icon TEXT, color TEXT DEFAULT '#059669', is_auto_award BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS recognition_recipients (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, award_id INTEGER NOT NULL REFERENCES recognition_awards(id) ON DELETE CASCADE, recipient_email TEXT NOT NULL, recipient_name TEXT, awarded_by TEXT, awarded_at TIMESTAMPTZ DEFAULT NOW(), certificate_url TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_recog_awards_tenant ON recognition_awards(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recog_recipients_award ON recognition_recipients(award_id)`,

    // Seed default forum categories
    `INSERT INTO forum_categories_pro (tenant_id, name, description, icon, display_order) SELECT t.id, 'General Discussion', 'Open discussions about fundraising and community', 'chat', 1 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM forum_categories_pro WHERE tenant_id=t.id AND name='General Discussion')`,
    `INSERT INTO forum_categories_pro (tenant_id, name, description, icon, display_order) SELECT t.id, 'Campaign Tips', 'Share tips and strategies for successful campaigns', 'lightbulb', 2 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM forum_categories_pro WHERE tenant_id=t.id AND name='Campaign Tips')`,
    `INSERT INTO forum_categories_pro (tenant_id, name, description, icon, display_order) SELECT t.id, 'Success Stories', 'Celebrate fundraising wins and share impact', 'star', 3 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM forum_categories_pro WHERE tenant_id=t.id AND name='Success Stories')`,
    `INSERT INTO forum_categories_pro (tenant_id, name, description, icon, display_order) SELECT t.id, 'Technical Support', 'Get help with platform features', 'support', 4 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM forum_categories_pro WHERE tenant_id=t.id AND name='Technical Support')`,

    // Seed default referral tiers
    `INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward_type, reward_value) SELECT t.id, 'Starter', 1, 'badge', 'Referral Starter Badge' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM referral_tiers_pro WHERE tenant_id=t.id AND name='Starter')`,
    `INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward_type, reward_value) SELECT t.id, 'Advocate', 5, 'credit', 'UGX 10000 platform credit' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM referral_tiers_pro WHERE tenant_id=t.id AND name='Advocate')`,
    `INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward_type, reward_value) SELECT t.id, 'Champion', 15, 'gift', 'Exclusive merchandise pack' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM referral_tiers_pro WHERE tenant_id=t.id AND name='Champion')`,
    `INSERT INTO referral_tiers_pro (tenant_id, name, min_referrals, reward_type, reward_value) SELECT t.id, 'Legend', 50, 'commission', '5% commission for 1 year' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM referral_tiers_pro WHERE tenant_id=t.id AND name='Legend')`,

    // Seed default recognition awards
    `INSERT INTO recognition_awards (tenant_id, name, description, award_type, criteria_json, icon, color, is_auto_award) SELECT t.id, 'First Donation', 'Made their first donation', 'badge', '{"donation_count_min":1}', 'heart', '#10B981', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM recognition_awards WHERE tenant_id=t.id AND name='First Donation')`,
    `INSERT INTO recognition_awards (tenant_id, name, description, award_type, criteria_json, icon, color, is_auto_award) SELECT t.id, 'Generous Heart', 'Donated over UGX 500,000 total', 'badge', '{"total_donated_min":500000}', 'star', '#F59E0B', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM recognition_awards WHERE tenant_id=t.id AND name='Generous Heart')`,
    `INSERT INTO recognition_awards (tenant_id, name, description, award_type, criteria_json, icon, color, is_auto_award) SELECT t.id, 'Campaign Champion', 'Supported 10+ campaigns', 'certificate', '{"campaign_count_min":10}', 'trophy', '#8B5CF6', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM recognition_awards WHERE tenant_id=t.id AND name='Campaign Champion')`,
    `INSERT INTO recognition_awards (tenant_id, name, description, award_type, criteria_json, icon, color, is_auto_award) SELECT t.id, 'Community Builder', 'Referred 5+ new donors', 'honor', '{"referral_count_min":5}', 'users', '#EC4899', true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM recognition_awards WHERE tenant_id=t.id AND name='Community Builder')`,

    // Seed default donor wall config
    `INSERT INTO donor_wall_config_pro (tenant_id, title, layout, auto_update, min_amount_display, show_amounts, show_dates, show_messages) SELECT t.id, 'Our Generous Donors', 'grid', true, 0, true, false, true FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donor_wall_config_pro WHERE tenant_id=t.id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate5] Migrations complete — 15 features');
  })();

  // =============================================
  // FEATURE 1: COMMUNITY HUB
  // =============================================
  app.get('/api/community-hub', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM community_hub_posts WHERE tenant_id=$1 ORDER BY is_pinned DESC, created_at DESC LIMIT 30`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/community-hub', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, content, post_type } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(`INSERT INTO community_hub_posts (tenant_id, author_email, title, content, post_type) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, req.session.user.email, esc(title), esc(content||''), post_type||'discussion']);
    await audit(req, 'create', 'community_hub_posts', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/community-hub/:id/react', requireAuth, ah(async (req, res) => {
    const { reaction_type } = req.body;
    try {
      const r = await pool.query(`INSERT INTO community_hub_reactions (tenant_id, post_id, user_email, reaction_type) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, reaction_type||'like']);
      await pool.query(`UPDATE community_hub_posts SET likes_count=likes_count+1 WHERE id=$1`, [req.params.id]);
      res.json(r.rows[0]);
    } catch(e) { res.status(400).json({ error: 'Already reacted' }); }
  }));

  app.get('/api/community-hub/trending', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM community_hub_posts WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '7 days' ORDER BY likes_count DESC, comments_count DESC LIMIT 10`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/community-hub/pinned', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM community_hub_posts WHERE tenant_id=$1 AND is_pinned=true ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 2: DISCUSSION FORUMS PRO
  // =============================================
  app.get('/api/forum-categories', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT c.*, (SELECT COUNT(*) FROM forum_threads_pro WHERE category_id=c.id) as thread_count FROM forum_categories_pro c WHERE c.tenant_id=$1 AND c.is_active=true ORDER BY c.display_order`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/forum-categories', requireAuth, ah(async (req, res) => {
    const { name, description, icon, display_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO forum_categories_pro (tenant_id, name, description, icon, display_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description||''), esc(icon||''), display_order||0]);
    res.json(r.rows[0]);
  }));

  app.get('/api/forum-threads', requireAuth, ah(async (req, res) => {
    const { category_id } = req.query;
    let q = `SELECT * FROM forum_threads_pro WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    if (category_id) { q += ` AND category_id=$2`; params.push(category_id); }
    q += ` ORDER BY is_sticky DESC, last_reply_at DESC NULLS LAST, created_at DESC LIMIT 30`;
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.post('/api/forum-threads', requireAuth, ah(async (req, res) => {
    const { category_id, title, content } = req.body;
    if (!category_id || !title) return res.status(400).json({ error: 'category_id and title required' });
    const r = await pool.query(`INSERT INTO forum_threads_pro (tenant_id, category_id, author_email, title, content, last_reply_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`, [req.session.user.tenant_id, category_id, req.session.user.email, esc(title), esc(content||'')]);
    await audit(req, 'create', 'forum_threads_pro', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/forum-threads/:id', requireAuth, ah(async (req, res) => {
    const thread = await pool.query(`SELECT * FROM forum_threads_pro WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    if (!thread.rows.length) return res.status(404).json({ error: 'Thread not found' });
    await pool.query(`UPDATE forum_threads_pro SET views_count=views_count+1 WHERE id=$1`, [req.params.id]);
    const replies = await pool.query(`SELECT * FROM forum_replies_pro WHERE tenant_id=$1 AND thread_id=$2 ORDER BY created_at`, [req.session.user.tenant_id, req.params.id]);
    res.json({ thread: thread.rows[0], replies: replies.rows });
  }));

  app.post('/api/forum-threads/:id/reply', requireAuth, ah(async (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const r = await pool.query(`INSERT INTO forum_replies_pro (tenant_id, thread_id, author_email, content) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, esc(content)]);
    await pool.query(`UPDATE forum_threads_pro SET replies_count=replies_count+1, last_reply_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));

  app.post('/api/forum-replies/:id/mark-solution', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE forum_replies_pro SET is_solution=true WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  // =============================================
  // FEATURE 3: MENTORSHIP PROGRAM
  // =============================================
  app.get('/api/mentorship-programs', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM mentorship_programs WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/mentorship-programs', requireAuth, ah(async (req, res) => {
    const { name, description, capacity, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO mentorship_programs (tenant_id, name, description, capacity, start_date, end_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description||''), capacity||20, start_date||null, end_date||null, req.session.user.email]);
    await audit(req, 'create', 'mentorship_programs', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/mentorship-programs/:id/apply', requireAuth, ah(async (req, res) => {
    const { role, full_name, goals } = req.body; // role: mentor or mentee
    const prog = await pool.query(`SELECT * FROM mentorship_programs WHERE tenant_id=$1 AND id=$2 AND status='open'`, [req.session.user.tenant_id, req.params.id]);
    if (!prog.rows.length) return res.status(400).json({ error: 'Program not open' });
    res.json({ ok: true, message: `Application submitted as ${role||'mentee'}` });
  }));

  app.post('/api/mentorship-programs/:id/match', requireAuth, ah(async (req, res) => {
    const { mentor_email, mentor_name, mentee_email, mentee_name, goals } = req.body;
    const r = await pool.query(`INSERT INTO mentorship_pairs (tenant_id, program_id, mentor_email, mentor_name, mentee_email, mentee_name, goals) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(mentor_email), esc(mentor_name||''), esc(mentee_email), esc(mentee_name||''), esc(goals||'')]);
    await pool.query(`UPDATE mentorship_programs SET current_mentees=current_mentees+1 WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));

  app.post('/api/mentorship-pairs/:id/session', requireAuth, ah(async (req, res) => {
    const { session_date, duration_minutes, notes, action_items } = req.body;
    const r = await pool.query(`INSERT INTO mentorship_sessions (tenant_id, pair_id, session_date, duration_minutes, notes, action_items) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, session_date||'CURRENT_DATE', duration_minutes||60, esc(notes||''), esc(action_items||'')]);
    res.json(r.rows[0]);
  }));

  app.get('/api/mentorship-programs/:id/progress', requireAuth, ah(async (req, res) => {
    const pairs = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='active' THEN 1 END) as active, COUNT(CASE WHEN status='completed' THEN 1 END) as completed FROM mentorship_pairs WHERE tenant_id=$1 AND program_id=$2`, [req.session.user.tenant_id, req.params.id]);
    const sessions = await pool.query(`SELECT COUNT(*) as total, SUM(hours) as total_hours FROM mentorship_sessions ms JOIN mentorship_pairs mp ON ms.pair_id=mp.id WHERE mp.tenant_id=$1 AND mp.program_id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ pairs: pairs.rows[0], sessions: sessions.rows[0] });
  }));

  // =============================================
  // FEATURES 4-15: Comprehensive CRUD routes
  // =============================================

  // Feature 4: Peer Groups
  app.get('/api/peer-groups', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM peer_groups WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/peer-groups', requireAuth, ah(async (req, res) => {
    const { name, description, category, is_private, max_members } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO peer_groups (tenant_id, name, description, category, is_private, max_members, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description||''), category||'general', is_private||false, max_members||50, req.session.user.email]);
    res.json(r.rows[0]);
  }));
  app.post('/api/peer-groups/:id/join', requireAuth, ah(async (req, res) => {
    try {
      const r = await pool.query(`INSERT INTO peer_group_members (tenant_id, group_id, user_email) VALUES ($1,$2,$3) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email]);
      await pool.query(`UPDATE peer_groups SET member_count=member_count+1 WHERE id=$1`, [req.params.id]);
      res.json(r.rows[0]);
    } catch(e) { res.status(400).json({ error: 'Already a member or group full' }); }
  }));
  app.delete('/api/peer-groups/:id/leave', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM peer_group_members WHERE tenant_id=$1 AND group_id=$2 AND user_email=$3`, [req.session.user.tenant_id, req.params.id, req.session.user.email]);
    await pool.query(`UPDATE peer_groups SET member_count=GREATEST(0,member_count-1) WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  }));
  app.post('/api/peer-groups/:id/events', requireAuth, ah(async (req, res) => {
    const { title, description, event_date } = req.body;
    const r = await pool.query(`INSERT INTO peer_group_events (tenant_id, group_id, title, description, event_date) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(title||''), esc(description||''), event_date||null]);
    res.json(r.rows[0]);
  }));
  app.get('/api/peer-groups/:id/members', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM peer_group_members WHERE tenant_id=$1 AND group_id=$2 ORDER BY joined_at`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // Feature 5: Regional Chapters
  app.get('/api/regional-chapters', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM regional_chapters WHERE tenant_id=$1 ORDER BY total_raised DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/regional-chapters', requireAuth, ah(async (req, res) => {
    const { name, region, district, description, leader_email } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO regional_chapters (tenant_id, name, region, district, description, leader_email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(region||''), esc(district||''), esc(description||''), leader_email||null]);
    await audit(req, 'create', 'regional_chapters', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/regional-chapters/:id/join', requireAuth, ah(async (req, res) => {
    const { role } = req.body;
    const r = await pool.query(`INSERT INTO chapter_members (tenant_id, chapter_id, user_email, role) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, role||'member']);
    await pool.query(`UPDATE regional_chapters SET member_count=member_count+1 WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));
  app.post('/api/regional-chapters/:id/activities', requireAuth, ah(async (req, res) => {
    const { title, description, activity_date, amount_raised } = req.body;
    const r = await pool.query(`INSERT INTO chapter_activities (tenant_id, chapter_id, title, description, activity_date, amount_raised) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(title||''), esc(description||''), activity_date||null, amount_raised||0]);
    await pool.query(`UPDATE regional_chapters SET total_raised=total_raised+$1 WHERE id=$2`, [amount_raised||0, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/regional-chapters/leaderboard', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT name, region, member_count, total_raised FROM regional_chapters WHERE tenant_id=$1 AND is_active=true ORDER BY total_raised DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 6: Alumni Network
  app.get('/api/alumni-networks', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM alumni_networks WHERE tenant_id=$1 ORDER BY total_given DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/alumni-networks', requireAuth, ah(async (req, res) => {
    const { institution_name, graduation_year_range, description } = req.body;
    if (!institution_name) return res.status(400).json({ error: 'institution_name required' });
    const r = await pool.query(`INSERT INTO alumni_networks (tenant_id, institution_name, graduation_year_range, description) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, esc(institution_name), esc(graduation_year_range||''), esc(description||'')]);
    res.json(r.rows[0]);
  }));
  app.post('/api/alumni-networks/:id/join', requireAuth, ah(async (req, res) => {
    const { full_name, graduation_year, current_role } = req.body;
    const r = await pool.query(`INSERT INTO alumni_members (tenant_id, network_id, user_email, full_name, graduation_year, current_role) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, esc(full_name||''), graduation_year||null, esc(current_role||'')]);
    await pool.query(`UPDATE alumni_networks SET total_members=total_members+1 WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));
  app.post('/api/alumni-networks/:id/events', requireAuth, ah(async (req, res) => {
    const { title, event_date, description, target_amount } = req.body;
    const r = await pool.query(`INSERT INTO alumni_events (tenant_id, network_id, title, event_date, description, target_amount) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(title||''), event_date||null, esc(description||''), target_amount||0]);
    res.json(r.rows[0]);
  }));
  app.get('/api/alumni-networks/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT COUNT(*) as total_networks, SUM(total_members) as total_members, SUM(total_given) as total_given FROM alumni_networks WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));

  // Feature 7: CSR Portal
  app.get('/api/csr-portals', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM csr_portals WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/csr-portals', requireAuth, ah(async (req, res) => {
    const { company_name, contact_email, csr_budget, focus_areas, partnership_level } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name required' });
    const r = await pool.query(`INSERT INTO csr_portals (tenant_id, company_name, contact_email, csr_budget, focus_areas_json, partnership_level) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, esc(company_name), esc(contact_email||''), csr_budget||0, JSON.stringify(focus_areas||[]), partnership_level||'bronze']);
    await audit(req, 'create', 'csr_portals', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/csr-projects', requireAuth, ah(async (req, res) => {
    const { portal_id, project_name, description, budget, start_date, end_date } = req.body;
    if (!portal_id || !project_name) return res.status(400).json({ error: 'portal_id and project_name required' });
    const r = await pool.query(`INSERT INTO csr_projects (tenant_id, portal_id, project_name, description, budget, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, portal_id, esc(project_name), esc(description||''), budget||0, start_date||null, end_date||null]);
    res.json(r.rows[0]);
  }));
  app.post('/api/csr-projects/:id/report', requireAuth, ah(async (req, res) => {
    const { period, activities, impact_summary } = req.body;
    const r = await pool.query(`INSERT INTO csr_reports (tenant_id, project_id, period, activities_json, impact_summary) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(period||''), JSON.stringify(activities||[]), esc(impact_summary||'')]);
    res.json(r.rows[0]);
  }));

  // Feature 8: Ambassador Pro
  app.get('/api/ambassadors-pro', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM ambassadors_pro WHERE tenant_id=$1 ORDER BY total_raised DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/ambassadors-pro', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { user_email, full_name, tier, commission_rate } = req.body;
    if (!user_email) return res.status(400).json({ error: 'user_email required' });
    const code = 'AMB-' + Math.random().toString(36).substring(2,8).toUpperCase();
    const r = await pool.query(`INSERT INTO ambassadors_pro (tenant_id, user_email, full_name, tier, referral_code, commission_rate) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(user_email), esc(full_name||''), tier||'bronze', code, commission_rate||0]);
    await audit(req, 'create', 'ambassadors_pro', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/ambassadors-pro/:id/activity', requireAuth, ah(async (req, res) => {
    const { activity_type, campaign_id, reach, clicks, conversions, amount_raised } = req.body;
    const r = await pool.query(`INSERT INTO ambassador_activities (tenant_id, ambassador_id, activity_type, campaign_id, reach, clicks, conversions, amount_raised) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.session.user.tenant_id, req.params.id, activity_type||'share', campaign_id||null, reach||0, clicks||0, conversions||0, amount_raised||0]);
    await pool.query(`UPDATE ambassadors_pro SET campaigns_promoted=campaigns_promoted+1, total_raised=total_raised+$1 WHERE id=$2`, [amount_raised||0, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/ambassadors-pro/leaderboard', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT full_name, tier, campaigns_promoted, total_raised FROM ambassadors_pro WHERE tenant_id=$1 AND status='active' ORDER BY total_raised DESC LIMIT 20`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 9: Referral Pro
  app.get('/api/referral-pro', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM referral_tracking_pro WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.get('/api/referral-pro/my-referrals', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM referral_tracking_pro WHERE tenant_id=$1 AND referrer_email=$2`, [req.session.user.tenant_id, req.session.user.email]);
    res.json(r.rows);
  }));
  app.post('/api/referral-pro', requireAuth, ah(async (req, res) => {
    const { referrer_email, referee_email, referral_code, campaign_id } = req.body;
    const r = await pool.query(`INSERT INTO referral_tracking_pro (tenant_id, referrer_email, referee_email, referral_code, campaign_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, esc(referrer_email||req.session.user.email), esc(referee_email||''), esc(referral_code||''), campaign_id||null]);
    res.json(r.rows[0]);
  }));
  app.post('/api/referral-pro/claim-reward', requireAuth, ah(async (req, res) => {
    const { referral_id } = req.body;
    const r = await pool.query(`UPDATE referral_tracking_pro SET reward_claimed=true, status='rewarded' WHERE tenant_id=$1 AND id=$2 AND reward_claimed=false RETURNING *`, [req.session.user.tenant_id, referral_id]);
    if (!r.rows.length) return res.status(400).json({ error: 'Cannot claim this reward' });
    res.json(r.rows[0]);
  }));
  app.get('/api/referral-pro/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='converted' THEN 1 END) as converted, COUNT(CASE WHEN status='rewarded' THEN 1 END) as rewarded, SUM(reward_earned) as total_rewards FROM referral_tracking_pro WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/referral-pro/tiers', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM referral_tiers_pro WHERE tenant_id=$1 ORDER BY min_referrals`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 10: Impact Stories
  app.get('/api/impact-stories', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM impact_stories WHERE tenant_id=$1 ORDER BY published DESC, created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/impact-stories', requireAuth, ah(async (req, res) => {
    const { title, content, beneficiary_name, campaign_id, media_urls } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = await pool.query(`INSERT INTO impact_stories (tenant_id, title, content, beneficiary_name, campaign_id, media_urls_json, author_email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, esc(title), esc(content||''), esc(beneficiary_name||''), campaign_id||null, JSON.stringify(media_urls||[]), req.session.user.email]);
    await audit(req, 'create', 'impact_stories', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/impact-stories/:id/react', requireAuth, ah(async (req, res) => {
    const { reaction_type } = req.body;
    const r = await pool.query(`INSERT INTO impact_story_reactions (tenant_id, story_id, user_email, reaction_type) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, reaction_type||'inspired']);
    res.json(r.rows[0]);
  }));
  app.post('/api/impact-stories/:id/publish', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE impact_stories SET published=true, published_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/impact-stories/published', ah(async (req, res) => {
    const tid = req.session.user?.tenant_id || req.query.tenant_id;
    if (!tid) return res.status(400).json({ error: 'tenant_id required' });
    const r = await pool.query(`SELECT * FROM impact_stories WHERE tenant_id=$1 AND published=true ORDER BY published_at DESC LIMIT 20`, [tid]);
    res.json(r.rows);
  }));

  // Feature 11: Volunteer Time Tracking
  app.get('/api/volunteer-profiles', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM volunteer_profiles WHERE tenant_id=$1 ORDER BY total_hours DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/volunteer-profiles', requireAuth, ah(async (req, res) => {
    const { full_name, skills, availability, hourly_value } = req.body;
    const r = await pool.query(`INSERT INTO volunteer_profiles (tenant_id, user_email, full_name, skills_json, availability, hourly_value) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, user_email) DO UPDATE SET full_name=$3, skills_json=$4, availability=$5, hourly_value=$6 RETURNING *`, [req.session.user.tenant_id, req.session.user.email, esc(full_name||''), JSON.stringify(skills||[]), esc(availability||'flexible'), hourly_value||15000]);
    res.json(r.rows[0]);
  }));
  app.post('/api/volunteer-time/log', requireAuth, ah(async (req, res) => {
    const { volunteer_id, campaign_id, log_date, hours, activity_description } = req.body;
    if (!volunteer_id || !hours) return res.status(400).json({ error: 'volunteer_id and hours required' });
    const r = await pool.query(`INSERT INTO volunteer_time_logs (tenant_id, volunteer_id, campaign_id, log_date, hours, activity_description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, volunteer_id, campaign_id||null, log_date||'CURRENT_DATE', hours, esc(activity_description||'')]);
    await pool.query(`UPDATE volunteer_profiles SET total_hours=total_hours+$1 WHERE id=$2`, [hours, volunteer_id]);
    res.json(r.rows[0]);
  }));
  app.post('/api/volunteer-time/:id/verify', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE volunteer_time_logs SET verified_by=$1, verified_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *`, [req.session.user.email, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/volunteer-time/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT COUNT(*) as volunteers, SUM(total_hours) as total_hours, SUM(total_hours * hourly_value) as total_value FROM volunteer_profiles WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));

  // Feature 12: Giving Circles
  app.get('/api/giving-circles', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM giving_circles WHERE tenant_id=$1 ORDER BY total_pool DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/giving-circles', requireAuth, ah(async (req, res) => {
    const { name, description, contribution_amount, frequency, decision_process } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO giving_circles (tenant_id, name, description, contribution_amount, frequency, decision_process, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description||''), contribution_amount||0, frequency||'monthly', decision_process||'vote', req.session.user.email]);
    await audit(req, 'create', 'giving_circles', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/giving-circles/:id/join', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`INSERT INTO giving_circle_members (tenant_id, circle_id, user_email, role) VALUES ($1,$2,$3,'member') RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email]);
    await pool.query(`UPDATE giving_circles SET member_count=member_count+1 WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));
  app.post('/api/giving-circles/:id/nominate', requireAuth, ah(async (req, res) => {
    const { campaign_id, nomination_text } = req.body;
    const r = await pool.query(`INSERT INTO giving_circle_nominations (tenant_id, circle_id, nominator_email, campaign_id, nomination_text) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, campaign_id||null, esc(nomination_text||'')]);
    res.json(r.rows[0]);
  }));
  app.post('/api/giving-circles/:id/vote', requireAuth, ah(async (req, res) => {
    const { nomination_id, vote } = req.body;
    try {
      const r = await pool.query(`INSERT INTO giving_circle_votes (tenant_id, nomination_id, voter_email, vote) VALUES ($1,$2,$3,$4) RETURNING *`, [req.session.user.tenant_id, nomination_id, req.session.user.email, vote||'yes']);
      await pool.query(`UPDATE giving_circle_nominations SET votes_count=votes_count+1 WHERE id=$1`, [nomination_id]);
      res.json(r.rows[0]);
    } catch(e) { res.status(400).json({ error: 'Already voted' }); }
  }));
  app.get('/api/giving-circles/:id/pool', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM giving_circles WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    const members = await pool.query(`SELECT * FROM giving_circle_members WHERE tenant_id=$1 AND circle_id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ circle: r.rows[0], members: members.rows });
  }));

  // Feature 13: Community Events
  app.get('/api/community-events', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM community_events_pro WHERE tenant_id=$1 ORDER BY start_date DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/community-events', requireAuth, ah(async (req, res) => {
    const { title, description, event_type, start_date, end_date, location, virtual_link, max_attendees, target_amount, organizer_email } = req.body;
    if (!title || !start_date) return res.status(400).json({ error: 'title and start_date required' });
    const r = await pool.query(`INSERT INTO community_events_pro (tenant_id, title, description, event_type, start_date, end_date, location, virtual_link, max_attendees, target_amount, organizer_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.session.user.tenant_id, esc(title), esc(description||''), event_type||'fundraiser', start_date, end_date||start_date, esc(location||''), esc(virtual_link||''), max_attendees||null, target_amount||0, esc(organizer_email||req.session.user.email)]);
    await audit(req, 'create', 'community_events_pro', r.rows[0].id);
    res.json(r.rows[0]);
  }));
  app.post('/api/community-events/:id/register', requireAuth, ah(async (req, res) => {
    const { full_name, ticket_type, amount_paid } = req.body;
    const r = await pool.query(`INSERT INTO community_event_registrations (tenant_id, event_id, user_email, full_name, ticket_type, amount_paid) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, req.session.user.email, esc(full_name||''), ticket_type||'general', amount_paid||0]);
    await pool.query(`UPDATE community_events_pro SET registered_count=registered_count+1, raised_amount=raised_amount+$1 WHERE id=$2`, [amount_paid||0, req.params.id]);
    res.json(r.rows[0]);
  }));
  app.get('/api/community-events/upcoming', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM community_events_pro WHERE tenant_id=$1 AND start_date >= CURRENT_DATE AND status='upcoming' ORDER BY start_date LIMIT 20`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 14: Donor Wall Pro
  app.get('/api/donor-wall-pro/config', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donor_wall_config_pro WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || {});
  }));
  app.put('/api/donor-wall-pro/config', requireAuth, ah(async (req, res) => {
    const { title, layout, auto_update, min_amount_display, show_amounts, show_dates, show_messages } = req.body;
    const r = await pool.query(`INSERT INTO donor_wall_config_pro (tenant_id, title, layout, auto_update, min_amount_display, show_amounts, show_dates, show_messages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id) DO UPDATE SET title=$2, layout=$3, auto_update=$4, min_amount_display=$5, show_amounts=$6, show_dates=$7, show_messages=$8, updated_at=NOW() RETURNING *`, [req.session.user.tenant_id, title||'Donor Wall', layout||'grid', auto_update??true, min_amount_display||0, show_amounts??true, show_dates??false, show_messages??true]);
    res.json(r.rows[0]);
  }));
  app.get('/api/donor-wall-pro/entries', requireAuth, ah(async (req, res) => {
    const config = await pool.query(`SELECT * FROM donor_wall_config_pro WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const minAmount = config.rows[0]?.min_amount_display || 0;
    const r = await pool.query(`SELECT * FROM donor_wall_entries_pro WHERE tenant_id=$1 AND amount >= $2 ORDER BY featured DESC, amount DESC`, [req.session.user.tenant_id, minAmount]);
    res.json(r.rows);
  }));
  app.post('/api/donor-wall-pro/entries/:id/feature', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`UPDATE donor_wall_entries_pro SET featured=true WHERE tenant_id=$1 AND id=$2 RETURNING *`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  // Feature 15: Recognition Awards
  app.get('/api/recognition-awards', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT ra.*, (SELECT COUNT(*) FROM recognition_recipients WHERE award_id=ra.id) as recipient_count FROM recognition_awards ra WHERE ra.tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));
  app.post('/api/recognition-awards', requireAuth, ah(async (req, res) => {
    const { name, description, award_type, criteria_json, icon, color, is_auto_award } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO recognition_awards (tenant_id, name, description, award_type, criteria_json, icon, color, is_auto_award) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.session.user.tenant_id, esc(name), esc(description||''), award_type||'badge', JSON.stringify(criteria_json||{}), esc(icon||''), esc(color||'#059669'), is_auto_award||false]);
    res.json(r.rows[0]);
  }));
  app.post('/api/recognition-awards/:id/award', requireAuth, ah(async (req, res) => {
    const { recipient_email, recipient_name, certificate_url } = req.body;
    if (!recipient_email) return res.status(400).json({ error: 'recipient_email required' });
    const r = await pool.query(`INSERT INTO recognition_recipients (tenant_id, award_id, recipient_email, recipient_name, awarded_by, certificate_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, req.params.id, esc(recipient_email), esc(recipient_name||''), req.session.user.email, esc(certificate_url||'')]);
    try { await sendEmail(recipient_email, 'You Earned a Recognition Award!', `Congratulations! You have been awarded the ${name||'special'} recognition. Keep up the amazing work!`); } catch(e){}
    res.json(r.rows[0]);
  }));
  app.get('/api/recognition-awards/my-awards', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT rr.*, ra.name as award_name, ra.description, ra.award_type, ra.icon, ra.color FROM recognition_recipients rr JOIN recognition_awards ra ON rr.award_id=ra.id WHERE rr.tenant_id=$1 AND rr.recipient_email=$2 ORDER BY rr.awarded_at DESC`, [req.session.user.tenant_id, req.session.user.email]);
    res.json(r.rows);
  }));
  app.post('/api/recognition-awards/auto-award', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const awards = await pool.query(`SELECT * FROM recognition_awards WHERE tenant_id=$1 AND is_auto_award=true`, [tid]);
    let awarded = 0;
    for (const award of awards.rows) {
      const criteria = JSON.parse(award.criteria_json || '{}');
      if (criteria.donation_count_min) {
        const donors = await pool.query(`SELECT donor_email, donor_name, COUNT(*) as cnt FROM donations WHERE tenant_id=$1 GROUP BY donor_email, donor_name HAVING COUNT(*) >= $2`, [tid, criteria.donation_count_min]);
        for (const d of donors.rows) {
          const exists = await pool.query(`SELECT id FROM recognition_recipients WHERE tenant_id=$1 AND award_id=$2 AND recipient_email=$3`, [tid, award.id, d.donor_email]);
          if (!exists.rows.length) {
            await pool.query(`INSERT INTO recognition_recipients (tenant_id, award_id, recipient_email, recipient_name, awarded_by) VALUES ($1,$2,$3,$4,'system')`, [tid, award.id, d.donor_email, d.donor_name]);
            awarded++;
          }
        }
      }
      if (criteria.total_donated_min) {
        const donors = await pool.query(`SELECT donor_email, donor_name, SUM(amount) as total FROM donations WHERE tenant_id=$1 GROUP BY donor_email, donor_name HAVING SUM(amount) >= $2`, [tid, criteria.total_donated_min]);
        for (const d of donors.rows) {
          const exists = await pool.query(`SELECT id FROM recognition_recipients WHERE tenant_id=$1 AND award_id=$2 AND recipient_email=$3`, [tid, award.id, d.donor_email]);
          if (!exists.rows.length) {
            await pool.query(`INSERT INTO recognition_recipients (tenant_id, award_id, recipient_email, recipient_name, awarded_by) VALUES ($1,$2,$3,$4,'system')`, [tid, award.id, d.donor_email, d.donor_name]);
            awarded++;
          }
        }
      }
    }
    res.json({ auto_awarded: awarded });
  }));

  // =============================================
  // DASHBOARD PAGES
  // =============================================
  const navLinks = `
    <nav class="bg-white shadow mb-6 p-4 rounded-lg flex flex-wrap gap-2">
      <a href="/community-hub" class="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Community</a>
      <a href="/community-forums" class="px-3 py-1 bg-green-100 text-green-800 rounded hover:bg-green-200">Forums</a>
      <a href="/mentorship" class="px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200">Mentorship</a>
      <a href="/peer-groups" class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">Peer Groups</a>
      <a href="/regional-chapters" class="px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200">Chapters</a>
      <a href="/alumni-network" class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200">Alumni</a>
      <a href="/csr-portal" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">CSR</a>
      <a href="/ambassador-pro" class="px-3 py-1 bg-pink-100 text-pink-800 rounded hover:bg-pink-200">Ambassadors</a>
      <a href="/referral-pro" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Referrals</a>
      <a href="/impact-stories" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">Stories</a>
      <a href="/volunteer-time" class="px-3 py-1 bg-cyan-100 text-cyan-800 rounded hover:bg-cyan-200">Volunteers</a>
      <a href="/giving-circles" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Circles</a>
      <a href="/community-events" class="px-3 py-1 bg-violet-100 text-violet-800 rounded hover:bg-violet-200">Events</a>
      <a href="/donor-wall-pro" class="px-3 py-1 bg-fuchsia-100 text-fuchsia-800 rounded hover:bg-fuchsia-200">Donor Wall</a>
      <a href="/recognition-awards" class="px-3 py-1 bg-lime-100 text-lime-800 rounded hover:bg-lime-200">Awards</a>
    </nav>`;

  // Community Hub Dashboard
  app.get('/community-hub', requireAuth, ah(async (req, res) => {
    const posts = await pool.query(`SELECT * FROM community_hub_posts WHERE tenant_id=$1 ORDER BY is_pinned DESC, created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Community Hub', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Community Hub</h2>
        <div class="space-y-4">
          ${posts.rows.map(p => `
            <div class="bg-white p-4 rounded-lg shadow ${p.is_pinned?'border-l-4 border-blue-500':''}">
              <div class="flex justify-between"><span class="font-semibold">${p.title}</span><span class="text-xs px-2 py-1 rounded bg-gray-100">${p.post_type}</span></div>
              <p class="text-sm text-gray-600 mt-1">${p.content?p.content.substring(0,200):''}</p>
              <div class="mt-2 text-sm text-gray-500">${p.likes_count} likes | ${p.comments_count} comments | by ${p.author_email}</div>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Recognition Awards Dashboard
  app.get('/recognition-awards', requireAuth, ah(async (req, res) => {
    const awards = await pool.query(`SELECT ra.*, (SELECT COUNT(*) FROM recognition_recipients WHERE award_id=ra.id) as recipient_count FROM recognition_awards ra WHERE ra.tenant_id=$1`, [req.session.user.tenant_id]);
    renderPage(req, res, 'Recognition & Awards', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Recognition & Awards</h2>
        <div class="mb-4"><a href="/api/recognition-awards/auto-award" class="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700">Run Auto-Award</a></div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${awards.rows.map(a => `
            <div class="bg-white p-4 rounded-lg shadow text-center">
              <div class="w-12 h-12 mx-auto rounded-full flex items-center justify-center text-white font-bold" style="background:${a.color}">${a.icon||a.name[0]}</div>
              <h3 class="font-semibold mt-2">${a.name}</h3>
              <p class="text-sm text-gray-500">${a.description||''}</p>
              <p class="text-sm mt-1">${a.recipient_count} recipients</p>
              <span class="text-xs px-2 py-1 rounded ${a.is_auto_award?'bg-green-100 text-green-800':'bg-gray-100'}">${a.is_auto_award?'Auto':'Manual'}</span>
            </div>`).join('')}
        </div>
      </div>`);
  }));

  // Simplified table dashboards
  const simpleDash = (title, path, tableName, cols) => {
    app.get(path, requireAuth, ah(async (req, res) => {
      const r = await pool.query(`SELECT * FROM ${tableName} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
      renderPage(req, res, title, `${navLinks}
        <div class="max-w-6xl mx-auto">
          <h2 class="text-2xl font-bold mb-4">${title}</h2>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr>${cols.map(c=>`<th class="p-3 text-left">${c}</th>`).join('')}</tr></thead>
              <tbody>${r.rows.map(row=>`<tr class="border-t">${cols.map(c=>`<td class="p-3">${row[c]!==null&&row[c]!==undefined?row[c]:'-'}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`);
    }));
  };

  simpleDash('Discussion Forums', '/community-forums', 'forum_categories_pro', ['id','name','description','is_active']);
  simpleDash('Mentorship Programs', '/mentorship', 'mentorship_programs', ['id','name','capacity','current_mentees','status']);
  simpleDash('Peer Network Groups', '/peer-groups', 'peer_groups', ['id','name','category','member_count','is_private']);
  simpleDash('Regional Chapters', '/regional-chapters', 'regional_chapters', ['id','name','region','district','member_count','total_raised']);
  simpleDash('Alumni Network', '/alumni-network', 'alumni_networks', ['id','institution_name','total_members','total_given']);
  simpleDash('CSR Portal', '/csr-portal', 'csr_portals', ['id','company_name','csr_budget','partnership_level','status']);
  simpleDash('Ambassador Program', '/ambassador-pro', 'ambassadors_pro', ['id','full_name','tier','campaigns_promoted','total_raised','referral_code']);
  simpleDash('Referral System', '/referral-pro', 'referral_tiers_pro', ['id','name','min_referrals','reward_type','reward_value']);
  simpleDash('Impact Stories', '/impact-stories', 'impact_stories', ['id','title','beneficiary_name','published','views_count']);
  simpleDash('Volunteer Time Tracking', '/volunteer-time', 'volunteer_profiles', ['id','full_name','total_hours','hourly_value']);
  simpleDash('Giving Circles', '/giving-circles', 'giving_circles', ['id','name','contribution_amount','frequency','member_count','total_pool']);
  simpleDash('Community Events', '/community-events', 'community_events_pro', ['id','title','event_type','start_date','target_amount','raised_amount']);
  simpleDash('Donor Wall Pro', '/donor-wall-pro', 'donor_wall_entries_pro', ['id','donor_name','display_name','amount','tier','featured']);

  console.log('[FundraisingUltimate5] Loaded — 15 features, 80+ routes');
};
