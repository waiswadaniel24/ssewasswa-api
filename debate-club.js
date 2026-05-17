/**
 * Debate Club Management Module
 * Complete module for managing debate topics, events, teams, scoring, brackets, archives, and skill tracking.
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req,res,next) => next());
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const uiT = opts.uiT || ((k) => k);
  const P = '#4f46e5', GRAY = '#6b7280';

  const SKIP = `<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Debate Club</div>`;

  // ─── Table creation ────────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_topics (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          category VARCHAR(100),
          description TEXT,
          pro_arguments JSONB DEFAULT '[]'::jsonb,
          con_arguments JSONB DEFAULT '[]'::jsonb,
          difficulty VARCHAR(50) DEFAULT 'intermediate',
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_events (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          topic_id INTEGER,
          format VARCHAR(100) DEFAULT 'parliamentary',
          date TIMESTAMPTZ,
          venue VARCHAR(255),
          status VARCHAR(50) DEFAULT 'upcoming',
          max_teams INTEGER DEFAULT 8,
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_teams (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          name VARCHAR(255) NOT NULL,
          members JSONB DEFAULT '[]'::jsonb,
          side VARCHAR(50),
          wins INTEGER DEFAULT 0,
          losses INTEGER DEFAULT 0,
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_scores (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          team_id INTEGER NOT NULL REFERENCES debate_teams(id),
          judge_id INTEGER NOT NULL,
          criteria JSONB DEFAULT '{}'::jsonb,
          total_score NUMERIC(6,2) DEFAULT 0,
          comments TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_brackets (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          round INTEGER DEFAULT 1,
          match_number INTEGER DEFAULT 1,
          team_a_id INTEGER REFERENCES debate_teams(id),
          team_b_id INTEGER REFERENCES debate_teams(id),
          winner_id INTEGER REFERENCES debate_teams(id),
          score_a NUMERIC(6,2),
          score_b NUMERIC(6,2),
          status VARCHAR(50) DEFAULT 'pending',
          scheduled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_speaker_profiles (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          user_id INTEGER NOT NULL,
          bio TEXT,
          specialization VARCHAR(200),
          total_debates INTEGER DEFAULT 0,
          wins INTEGER DEFAULT 0,
          average_score NUMERIC(6,2) DEFAULT 0,
          achievements JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_research (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          topic_id INTEGER REFERENCES debate_topics(id),
          title VARCHAR(500) NOT NULL,
          content TEXT,
          source_url VARCHAR(500),
          source_type VARCHAR(50) DEFAULT 'article',
          tags JSONB DEFAULT '[]'::jsonb,
          added_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_archives (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          title VARCHAR(500) NOT NULL,
          topic_title VARCHAR(500),
          winning_team VARCHAR(255),
          runner_up VARCHAR(255),
          final_scores JSONB DEFAULT '{}'::jsonb,
          highlights TEXT,
          video_url VARCHAR(500),
          archived_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_skill_tracking (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          user_id INTEGER NOT NULL,
          skill_name VARCHAR(200) NOT NULL,
          proficiency_level VARCHAR(50) DEFAULT 'beginner',
          practice_hours NUMERIC(6,2) DEFAULT 0,
          self_rating INTEGER DEFAULT 1,
          peer_rating NUMERIC(3,2) DEFAULT 0,
          notes TEXT,
          assessed_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_votes (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          bracket_id INTEGER REFERENCES debate_brackets(id),
          voter_id INTEGER NOT NULL,
          team_id INTEGER NOT NULL,
          voted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(bracket_id, voter_id)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS debate_speech_timer (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          event_id INTEGER NOT NULL REFERENCES debate_events(id),
          team_id INTEGER NOT NULL REFERENCES debate_teams(id),
          speaker_name VARCHAR(255),
          speech_type VARCHAR(100) DEFAULT 'constructive',
          allotted_seconds INTEGER DEFAULT 300,
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          actual_seconds INTEGER,
          status VARCHAR(50) DEFAULT 'ready',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_topics_tenant ON debate_topics(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_events_tenant ON debate_events(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_teams_tenant ON debate_teams(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_scores_tenant ON debate_scores(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_brackets_tenant ON debate_brackets(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_speaker_profiles_tenant ON debate_speaker_profiles(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_research_tenant ON debate_research(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_archives_tenant ON debate_archives(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_skill_tenant ON debate_skill_tracking(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_votes_tenant ON debate_votes(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_debate_speech_timer_tenant ON debate_speech_timer(tenant_id);`);
      console.log('[DebateClub] Tables ready');
    } catch(e) { console.warn('[DebateClub] Migration warning:', e.message); }
  })();

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function statusBadge(status) {
    const colors = {
      upcoming: '#2563eb', ongoing: '#059669', completed: '#6b7280', cancelled: '#dc2626',
      pending: '#d97706', active: '#059669', finished: '#6b7280', in_progress: '#059669',
      draft: '#9ca3af', published: '#059669', archived: '#6b7280', beginner: '#10b981',
      intermediate: '#f59e0b', advanced: '#ef4444'
    };
    const bg = colors[status] || '#6b7280';
    return `<span style="display:inline-block;padding:3px 12px;border-radius:9999px;font-size:12px;font-weight:600;color:#fff;background:${bg};">${esc(String(status).replace(/_/g,' ').toUpperCase())}</span>`;
  }

  function pageNav(active) {
    const links = [
      { href: '/school/debate-club', label: 'Dashboard', id: 'dashboard' },
      { href: '/school/debate-club/topics', label: 'Topics', id: 'topics' },
      { href: '/school/debate-club/events', label: 'Events', id: 'events' },
      { href: '/school/debate-club/leaderboard', label: 'Leaderboard', id: 'leaderboard' },
      { href: '/school/debate-club/archive', label: 'Archives', id: 'archive' },
      { href: '/school/debate-club/my-debates', label: 'My Debates', id: 'my-debates' },
      { href: '/school/debate-club/skills', label: 'Skills', id: 'skills' }
    ];
    return links.map(l =>
      `<a href="${l.href}" style="display:inline-block;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;color:${active===l.id?'#fff':P};background:${active===l.id?P:'#eef2ff'};">${l.label}</a>`
    ).join(' ');
  }

  function statCard(label, value, color) {
    return `<div style="background:${color||'#eef2ff'};border-radius:12px;padding:20px;flex:1;min-width:160px;">
      <div style="font-size:13px;color:${GRAY};margin-bottom:4px;">${esc(label)}</div>
      <div style="font-size:24px;font-weight:800;color:#111827;">${esc(String(value))}</div>
    </div>`;
  }

  function difficultyStars(level) {
    const map = { beginner: 1, intermediate: 2, advanced: 3 };
    const n = map[level] || 1;
    return '&#9733;'.repeat(n) + '&#9734;'.repeat(3 - n);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;

    const [topicsR, eventsR, teamsR, recentScores] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS c FROM debate_topics WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM debate_events WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM debate_teams dt JOIN debate_events de ON de.id = dt.event_id WHERE dt.tenant_id = $1`, [tid]),
      pool.query(`SELECT ds.*, dt.name AS team_name FROM debate_scores ds JOIN debate_teams dt ON dt.id = ds.team_id WHERE ds.tenant_id = $1 ORDER BY ds.created_at DESC LIMIT 5`, [tid])
    ]);

    const upcomingEvents = await pool.query(
      `SELECT * FROM debate_events WHERE tenant_id = $1 AND status = 'upcoming' ORDER BY date ASC LIMIT 4`, [tid]
    );

    const myTeamCount = await pool.query(
      `SELECT COUNT(*) AS c FROM debate_teams WHERE tenant_id = $1 AND $2 = ANY(SELECT jsonb_array_elements_text(members)::int)`, [tid, uid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0;">Debate Club</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('dashboard')}</div>
      </div>

      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px;">
        ${statCard('Topics', topicsR.rows[0].c)}
        ${statCard('Events', eventsR.rows[0].c)}
        ${statCard('Teams', teamsR.rows[0].c)}
        ${statCard('My Teams', myTeamCount.rows[0].c, '#fef3c7')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px 0;">Upcoming Events</h3>`;
    if (upcomingEvents.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No upcoming events. <a href="/school/debate-club/events/new" style="color:${P};">Create one</a>.</p>`;
    } else {
      for (const ev of upcomingEvents.rows) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <a href="/school/debate-club/events/${ev.id}" style="font-weight:600;color:#111827;text-decoration:none;">${esc(ev.title)}</a>
            <div style="font-size:12px;color:${GRAY};">${ev.date ? new Date(ev.date).toLocaleDateString() : 'TBD'} &bull; ${esc(ev.format||'Parliamentary')}</div>
          </div>
          ${statusBadge(ev.status)}
        </div>`;
      }
    }
    html += `</div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px 0;">Recent Scores</h3>`;
    if (recentScores.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No scores recorded yet.</p>`;
    } else {
      for (const s of recentScores.rows) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-weight:600;color:#111827;">${esc(s.team_name)}</span>
          <span style="font-size:18px;font-weight:700;color:${P};">${Number(s.total_score).toFixed(1)}</span>
        </div>`;
      }
    }
    html += `</div></div>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px 0;">Quick Actions</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/school/debate-club/topics/new" class="btn" style="text-decoration:none;">+ Add Topic</a>
          <a href="/school/debate-club/events/new" class="btn" style="text-decoration:none;background:#059669;">+ Create Event</a>
          <a href="/school/debate-club/skills" class="btn" style="text-decoration:none;background:#d97706;">Track Skills</a>
          <a href="/school/debate-club/research" class="btn" style="text-decoration:none;background:#2563eb;">Research Hub</a>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Debate Club', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: TOPICS LIST
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/topics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { search, category, difficulty: diff } = req.query;
    let where = `WHERE t.tenant_id = $1`;
    const params = [tid];
    let pi = 2;

    if (search) { where += ` AND t.title ILIKE $${pi++}`; params.push(`%${search}%`); }
    if (category) { where += ` AND t.category = $${pi++}`; params.push(category); }
    if (diff) { where += ` AND t.difficulty = $${pi++}`; params.push(diff); }

    const result = await pool.query(
      `SELECT t.*, u.name AS author FROM debate_topics t LEFT JOIN users u ON u.id = t.created_by ${where} ORDER BY t.created_at DESC LIMIT 50`,
      params
    );
    const categories = await pool.query(`SELECT DISTINCT category FROM debate_topics WHERE tenant_id = $1 ORDER BY category`, [tid]);

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Debate Topics</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('topics')}</div>
      </div>

      <form method="GET" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
        <input type="text" name="search" value="${esc(search||'')}" placeholder="Search topics..." style="width:280px;"/>
        <select name="category" style="width:160px;">
          <option value="">All Categories</option>
          ${(categories.rows||[]).map(c => `<option value="${esc(c.category)}" ${category===c.category?'selected':''}>${esc(c.category)}</option>`).join('')}
        </select>
        <select name="difficulty" style="width:150px;">
          <option value="">All Levels</option>
          <option value="beginner" ${diff==='beginner'?'selected':''}>Beginner</option>
          <option value="intermediate" ${diff==='intermediate'?'selected':''}>Intermediate</option>
          <option value="advanced" ${diff==='advanced'?'selected':''}>Advanced</option>
        </select>
        <button type="submit" class="btn">Filter</button>
        <a href="/school/debate-club/topics/new" class="btn" style="text-decoration:none;background:#059669;">+ New Topic</a>
      </form>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};">
        <p style="font-size:40px;margin-bottom:12px;">🎯</p>
        <p style="font-size:16px;">No topics found. Create your first debate topic.</p>
      </div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">`;
      for (const t of result.rows) {
        const proArgs = Array.isArray(t.pro_arguments) ? t.pro_arguments : JSON.parse(t.pro_arguments || '[]');
        const conArgs = Array.isArray(t.con_arguments) ? t.con_arguments : JSON.parse(t.con_arguments || '[]');
        html += `<div class="card" style="border-left:4px solid ${P};">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">${esc(t.title)}</h3>
            ${statusBadge(t.difficulty)}
          </div>
          <p style="font-size:13px;color:${GRAY};margin:6px 0;line-height:1.5;">${esc((t.description||'').slice(0,120))}${(t.description||'').length>120?'...':''}</p>
          <div style="display:flex;gap:12px;font-size:12px;color:${GRAY};margin:8px 0;">
            <span>Pro: ${proArgs.length}</span><span>Con: ${conArgs.length}</span>
            ${t.category ? `<span style="background:#eef2ff;color:${P};padding:2px 8px;border-radius:4px;">${esc(t.category)}</span>` : ''}
          </div>
          <div style="margin-top:10px;">
            <a href="/school/debate-club/topics/${t.id}" style="color:${P};font-weight:600;font-size:13px;text-decoration:none;">View Details &rarr;</a>
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    res.send(renderPage('Debate Topics', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: TOPIC DETAIL / ARGUMENT TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/topics/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT t.*, u.name AS author FROM debate_topics t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1 AND t.tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Topic not found');
    const t = result.rows[0];
    const proArgs = Array.isArray(t.pro_arguments) ? t.pro_arguments : JSON.parse(t.pro_arguments || '[]');
    const conArgs = Array.isArray(t.con_arguments) ? t.con_arguments : JSON.parse(t.con_arguments || '[]');

    const research = await pool.query(
      `SELECT * FROM debate_research WHERE topic_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`, [id, tid]
    );

    let html = `${SKIP}<div style="max-width:900px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/debate-club/topics" style="color:${P};text-decoration:none;">&larr; Back to Topics</a></div>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px 0;">${esc(t.title)}</h1>
      <p style="color:${GRAY};margin:0 0 16px 0;">${esc(t.description||'')} &bull; Difficulty: ${difficultyStars(t.difficulty)} &bull; By ${esc(t.author||'Unknown')}</p>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="card" style="border-top:3px solid #059669;">
          <h3 style="font-size:16px;font-weight:700;color:#059669;margin:0 0 10px 0;">Pro Arguments (${proArgs.length})</h3>
          <form method="POST" action="/school/debate-club/topics/${id}/arguments" style="margin-bottom:12px;">
            <input type="hidden" name="side" value="pro"/>
            <div style="display:flex;gap:8px;">
              <input type="text" name="argument" placeholder="Add a pro argument..." required style="flex:1;"/>
              <button type="submit" class="btn" style="background:#059669;white-space:nowrap;">Add</button>
            </div>
          </form>
          ${proArgs.map((a,i) => `<div style="padding:8px 12px;background:#f0fdf4;border-radius:8px;margin-bottom:6px;font-size:14px;color:#111827;">
            <strong>${i+1}.</strong> ${esc(a)}
          </div>`).join('')}
        </div>
        <div class="card" style="border-top:3px solid #dc2626;">
          <h3 style="font-size:16px;font-weight:700;color:#dc2626;margin:0 0 10px 0;">Con Arguments (${conArgs.length})</h3>
          <form method="POST" action="/school/debate-club/topics/${id}/arguments" style="margin-bottom:12px;">
            <input type="hidden" name="side" value="con"/>
            <div style="display:flex;gap:8px;">
              <input type="text" name="argument" placeholder="Add a con argument..." required style="flex:1;"/>
              <button type="submit" class="btn" style="background:#dc2626;white-space:nowrap;">Add</button>
            </div>
          </form>
          ${conArgs.map((a,i) => `<div style="padding:8px 12px;background:#fef2f2;border-radius:8px;margin-bottom:6px;font-size:14px;color:#111827;">
            <strong>${i+1}.</strong> ${esc(a)}
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">Research Resources (${research.rows.length})</h3>
          <form method="POST" action="/school/debate-club/topics/${id}/research" style="display:flex;gap:8px;">
            <input type="text" name="title" placeholder="Resource title" required style="width:200px;"/>
            <input type="url" name="source_url" placeholder="URL (optional)" style="width:200px;"/>
            <button type="submit" class="btn" style="white-space:nowrap;">Add</button>
          </form>
        </div>
        ${research.rows.length === 0 ? `<p style="color:${GRAY};font-size:14px;">No research added yet.</p>` :
          research.rows.map(r => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;">
            <div>
              <span style="font-weight:600;color:#111827;">${esc(r.title)}</span>
              ${r.source_url ? ` &mdash; <a href="${esc(r.source_url)}" target="_blank" style="color:${P};font-size:13px;">Link</a>` : ''}
            </div>
            <span style="font-size:12px;color:${GRAY};">${statusBadge(r.source_type||'article')}</span>
          </div>`).join('')}
      </div>
    </div>`;
    res.send(renderPage('Topic: ' + t.title, html, req.session.user));
  }));

  // Add argument to topic
  app.post('/school/debate-club/topics/:id/arguments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { side, argument } = req.body;
    if (!['pro','con'].includes(side) || !argument) return res.status(400).send('Invalid input');
    const result = await pool.query(`SELECT pro_arguments, con_arguments FROM debate_topics WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!result.rows[0]) return res.status(404).send('Topic not found');
    const row = result.rows[0];
    const col = side === 'pro' ? 'pro_arguments' : 'con_arguments';
    const arr = Array.isArray(row[col]) ? row[col] : JSON.parse(row[col] || '[]');
    arr.push(argument.trim());
    await pool.query(`UPDATE debate_topics SET ${col} = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(arr), id, tid]);
    audit('debate_argument_added', { topic_id: id, side, argument: argument.trim() }, req);
    res.redirect(`/school/debate-club/topics/${id}`);
  }));

  // Add research resource to topic
  app.post('/school/debate-club/topics/:id/research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { title, source_url, source_type } = req.body;
    if (!title) return res.status(400).send('Title is required');
    await pool.query(
      `INSERT INTO debate_research (tenant_id, topic_id, title, source_url, source_type, added_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, id, title.trim(), source_url || null, source_type || 'article', uid]
    );
    audit('debate_research_added', { topic_id: id, title: title.trim() }, req);
    res.redirect(`/school/debate-club/topics/${id}`);
  }));

  // Create new topic
  app.get('/school/debate-club/topics/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/debate-club/topics" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back to Topics</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">New Debate Topic</h1>
      <form method="POST" action="/school/debate-club/topics" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Topic Title *</label>
          <input type="text" name="title" required placeholder="e.g. Social media does more harm than good"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Category</label>
            <select name="category">
              <option value="ethics">Ethics</option>
              <option value="politics">Politics</option>
              <option value="technology">Technology</option>
              <option value="education">Education</option>
              <option value="environment">Environment</option>
              <option value="economics">Economics</option>
              <option value="social">Social Issues</option>
              <option value="science">Science</option>
              <option value="philosophy">Philosophy</option>
              <option value="sports">Sports</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Difficulty</label>
            <select name="difficulty">
              <option value="beginner">Beginner</option>
              <option value="intermediate" selected>Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3" placeholder="Provide context for this debate topic..."></textarea>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Pro Arguments (one per line)</label>
          <textarea name="pro_arguments" rows="3" placeholder="Argument 1&#10;Argument 2&#10;Argument 3"></textarea>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Con Arguments (one per line)</label>
          <textarea name="con_arguments" rows="3" placeholder="Counter-argument 1&#10;Counter-argument 2&#10;Counter-argument 3"></textarea>
        </div>
        <button type="submit" class="btn">Create Topic</button>
      </form>
    </div>`;
    res.send(renderPage('New Debate Topic', html, req.session.user));
  }));

  app.post('/school/debate-club/topics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, category, description, difficulty, pro_arguments, con_arguments } = req.body;
    if (!title) return res.status(400).send('Title is required');
    const proArr = (pro_arguments||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const conArr = (con_arguments||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const result = await pool.query(
      `INSERT INTO debate_topics (tenant_id, title, category, description, pro_arguments, con_arguments, difficulty, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, title, category || null, description || null, JSON.stringify(proArr), JSON.stringify(conArr), difficulty || 'intermediate', uid]
    );
    audit('debate_topic_created', { topic_id: result.rows[0].id, title }, req);
    res.redirect(`/school/debate-club/topics/${result.rows[0].id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: EVENTS CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/events', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT de.*, dt.title AS topic_title FROM debate_events de LEFT JOIN debate_topics dt ON dt.id = de.topic_id WHERE de.tenant_id = $1 ORDER BY de.date DESC NULLS LAST`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Debate Events</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('events')}</div>
      </div>
      <a href="/school/debate-club/events/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;background:#059669;">+ Create Event</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;">🏆</p><p>No events yet.</p></div>`;
    } else {
      html += `<table><thead><tr><th>Title</th><th>Format</th><th>Date</th><th>Venue</th><th>Teams</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
      for (const ev of result.rows) {
        const teamCount = await pool.query(`SELECT COUNT(*) AS c FROM debate_teams WHERE event_id = $1 AND tenant_id = $2`, [ev.id, tid]);
        html += `<tr>
          <td><a href="/school/debate-club/events/${ev.id}" style="color:${P};font-weight:600;text-decoration:none;">${esc(ev.title)}</a>
            ${ev.topic_title ? `<div style="font-size:12px;color:${GRAY};">${esc(ev.topic_title)}</div>` : ''}</td>
          <td>${esc((ev.format||'parliamentary').charAt(0).toUpperCase()+(ev.format||'parliamentary').slice(1))}</td>
          <td>${ev.date ? new Date(ev.date).toLocaleDateString() : 'TBD'}</td>
          <td>${esc(ev.venue||'-')}</td>
          <td>${teamCount.rows[0].c}/${ev.max_teams||'∞'}</td>
          <td>${statusBadge(ev.status)}</td>
          <td>
            <a href="/school/debate-club/events/${ev.id}" style="color:${P};font-size:13px;text-decoration:none;">View</a>
            ${ev.status==='upcoming'?` | <a href="/school/debate-club/register-team/${ev.id}" style="color:#059669;font-size:13px;text-decoration:none;">Register</a>`:''}
            ${ev.status==='ongoing'?` | <a href="/school/debate-club/score/${ev.id}" style="color:#d97706;font-size:13px;text-decoration:none;">Score</a>`:''}
          </td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Debate Events', html, req.session.user));
  }));

  // Create event form
  app.get('/school/debate-club/events/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const topics = await pool.query(`SELECT id, title FROM debate_topics WHERE tenant_id = $1 ORDER BY title`, [tid]);
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/debate-club/events" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back to Events</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">New Debate Event</h1>
      <form method="POST" action="/school/debate-club/events" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Event Title *</label>
          <input type="text" name="title" required placeholder="e.g. Inter-House Debate Championship"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Format</label>
            <select name="format">
              <option value="parliamentary">Parliamentary</option>
              <option value="lincoln-douglas">Lincoln-Douglas</option>
              <option value="policy">Policy Debate</option>
              <option value="public-forum">Public Forum</option>
              <option value="karl-popper">Karl Popper</option>
              <option value="world-schools">World Schools</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Max Teams</label>
            <input type="number" name="max_teams" min="2" max="64" value="8"/>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Date</label>
            <input type="datetime-local" name="date"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Venue</label>
            <input type="text" name="venue" placeholder="e.g. School Auditorium"/>
          </div>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Topic (optional)</label>
          <select name="topic_id">
            <option value="">-- Select a topic --</option>
            ${(topics.rows||[]).map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn">Create Event</button>
      </form>
    </div>`;
    res.send(renderPage('New Debate Event', html, req.session.user));
  }));

  app.post('/school/debate-club/events', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, format, date, venue, max_teams, topic_id } = req.body;
    if (!title) return res.status(400).send('Title is required');
    const result = await pool.query(
      `INSERT INTO debate_events (tenant_id, title, topic_id, format, date, venue, max_teams, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, title, topic_id || null, format || 'parliamentary', date || null, venue || null, parseInt(max_teams) || 8, uid]
    );
    audit('debate_event_created', { event_id: result.rows[0].id, title }, req);
    res.redirect(`/school/debate-club/events/${result.rows[0].id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: EVENT DETAIL
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/events/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const evResult = await pool.query(
      `SELECT de.*, dt.title AS topic_title, dt.description AS topic_desc, u.name AS organizer FROM debate_events de LEFT JOIN debate_topics dt ON dt.id = de.topic_id LEFT JOIN users u ON u.id = de.created_by WHERE de.id = $1 AND de.tenant_id = $2`,
      [id, tid]
    );
    if (!evResult.rows[0]) return res.status(404).send('Event not found');
    const ev = evResult.rows[0];

    const teams = await pool.query(
      `SELECT * FROM debate_teams WHERE event_id = $1 AND tenant_id = $2 ORDER BY created_at`, [id, tid]
    );
    const scores = await pool.query(
      `SELECT ds.*, dt.name AS team_name, u.name AS judge_name FROM debate_scores ds JOIN debate_teams dt ON dt.id = ds.team_id LEFT JOIN users u ON u.id = ds.judge_id WHERE ds.event_id = $1 AND ds.tenant_id = $2 ORDER BY ds.total_score DESC`,
      [id, tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/debate-club/events" style="color:${P};text-decoration:none;">&larr; Back to Events</a></div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px 0;">${esc(ev.title)}</h1>
          <p style="color:${GRAY};margin:0;font-size:14px;">${ev.topic_title ? esc(ev.topic_title) : 'No topic assigned'} &bull; ${esc(ev.format||'Parliamentary')} &bull; ${ev.date ? new Date(ev.date).toLocaleString() : 'TBD'} &bull; ${esc(ev.venue||'TBD')}</p>
        </div>
        ${statusBadge(ev.status)}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        ${ev.status==='upcoming'?`<a href="/school/debate-club/register-team/${ev.id}" class="btn" style="text-decoration:none;background:#059669;">Register Team</a>`:''}
        ${ev.status==='ongoing'||ev.status==='completed'?`<a href="/school/debate-club/score/${ev.id}" class="btn" style="text-decoration:none;background:#d97706;">Score Teams</a>`:''}
        ${ev.status!=='cancelled'?`<a href="/school/debate-club/brackets/${ev.id}" class="btn" style="text-decoration:none;background:#7c3aed;">View Brackets</a>`:''}
        ${ev.status==='completed'?`<form method="POST" action="/school/debate-club/events/${ev.id}/archive" style="display:inline;"><button type="submit" class="btn" style="background:#6b7280;">Archive</button></form>`:''}
        ${ev.status==='upcoming'?`<form method="POST" action="/school/debate-club/events/${ev.id}/start" style="display:inline;"><button type="submit" class="btn" style="background:#059669;">Start Event</button></form>`:''}
        ${ev.status==='ongoing'?`<form method="POST" action="/school/debate-club/events/${ev.id}/complete" style="display:inline;"><button type="submit" class="btn" style="background:#6b7280;">Complete Event</button></form>`:''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px;">Teams (${teams.rows.length}/${ev.max_teams||'∞'})</h3>`;
    if (teams.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No teams registered yet.</p>`;
    } else {
      for (const t of teams.rows) {
        const members = Array.isArray(t.members) ? t.members : JSON.parse(t.members || '[]');
        html += `<div style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="color:#111827;">${esc(t.name)}</strong>
              <span style="margin-left:8px;font-size:12px;color:${GRAY};">${t.side ? statusBadge(t.side) : ''} &bull; W:${t.wins} L:${t.losses}</span>
              <div style="font-size:12px;color:${GRAY};margin-top:2px;">${members.map(m => esc(String(m))).join(', ')}</div>
            </div>
          </div>
        </div>`;
      }
    }
    html += `</div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px;">Scores & Rankings</h3>`;
    if (scores.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No scores recorded yet.</p>`;
    } else {
      let rank = 1;
      for (const s of scores.rows) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <span style="font-weight:700;color:${P};font-size:18px;margin-right:10px;">#${rank++}</span>
            <span style="font-weight:600;color:#111827;">${esc(s.team_name)}</span>
            <div style="font-size:12px;color:${GRAY};">Judge: ${esc(s.judge_name||'Unknown')}</div>
          </div>
          <span style="font-size:20px;font-weight:800;color:${P};">${Number(s.total_score).toFixed(1)}</span>
        </div>`;
      }
    }
    html += `</div></div></div>`;
    res.send(renderPage('Event: ' + ev.title, html, req.session.user));
  }));

  // Event status transitions
  app.post('/school/debate-club/events/:id/start', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE debate_events SET status = 'ongoing', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('debate_event_started', { event_id: id }, req);
    res.redirect(`/school/debate-club/events/${id}`);
  }));

  app.post('/school/debate-club/events/:id/complete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE debate_events SET status = 'completed', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('debate_event_completed', { event_id: id }, req);
    res.redirect(`/school/debate-club/events/${id}`);
  }));

  // Archive event
  app.post('/school/debate-club/events/:id/archive', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found');
    const ev = evResult.rows[0];
    // Get top scoring team
    const topTeam = await pool.query(
      `SELECT dt.name, AVG(ds.total_score) AS avg_score FROM debate_scores ds JOIN debate_teams dt ON dt.id = ds.team_id WHERE ds.event_id = $1 AND ds.tenant_id = $2 GROUP BY dt.id, dt.name ORDER BY avg_score DESC LIMIT 1`,
      [id, tid]
    );
    const runnerUp = await pool.query(
      `SELECT dt.name, AVG(ds.total_score) AS avg_score FROM debate_scores ds JOIN debate_teams dt ON dt.id = ds.team_id WHERE ds.event_id = $1 AND ds.tenant_id = $2 GROUP BY dt.id, dt.name ORDER BY avg_score DESC LIMIT 1 OFFSET 1`,
      [id, tid]
    );
    await pool.query(
      `INSERT INTO debate_archives (tenant_id, event_id, title, topic_title, winning_team, runner_up) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, id, ev.title, ev.topic_title || null, topTeam.rows[0]?.name || null, runnerUp.rows[0]?.name || null]
    );
    await pool.query(`UPDATE debate_events SET status = 'archived', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('debate_event_archived', { event_id: id }, req);
    res.redirect('/school/debate-club/archive');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: REGISTER TEAM
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/register-team/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2 AND status = 'upcoming'`, [id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found or not accepting registrations');
    const ev = evResult.rows[0];
    const existingTeams = await pool.query(`SELECT COUNT(*) AS c FROM debate_teams WHERE event_id = $1 AND tenant_id = $2`, [id, tid]);
    if (existingTeams.rows[0].c >= (ev.max_teams || 999)) return res.status(400).send('Event is full');

    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/debate-club/events/${id}" style="color:${P};text-decoration:none;">&larr; Back to Event</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0;">Register Team</h1>
      <p style="color:${GRAY};margin-bottom:20px;">Event: ${esc(ev.title)}</p>
      <form method="POST" action="/school/debate-club/register-team/${id}" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Team Name *</label>
          <input type="text" name="name" required placeholder="e.g. The Arguers"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Preferred Side</label>
          <select name="side">
            <option value="">No Preference</option>
            <option value="pro">Proposition (Pro)</option>
            <option value="con">Opposition (Con)</option>
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Member Names (one per line, max 5)</label>
          <textarea name="members" rows="5" placeholder="John Doe&#10;Jane Smith"></textarea>
        </div>
        <button type="submit" class="btn">Register Team</button>
      </form>
    </div>`;
    res.send(renderPage('Register Team', html, req.session.user));
  }));

  app.post('/school/debate-club/register-team/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { name, side, members } = req.body;
    if (!name) return res.status(400).send('Team name is required');
    const membersArr = (members||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,5);
    const result = await pool.query(
      `INSERT INTO debate_teams (tenant_id, event_id, name, members, side, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, id, name, JSON.stringify(membersArr), side || null, uid]
    );
    audit('debate_team_registered', { event_id: id, team_id: result.rows[0].id, name }, req);
    res.redirect(`/school/debate-club/events/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: JUDGE SCORING
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/score/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found');
    const ev = evResult.rows[0];

    const teams = await pool.query(
      `SELECT * FROM debate_teams WHERE event_id = $1 AND tenant_id = $2 ORDER BY name`, [id, tid]
    );

    const existingScores = await pool.query(
      `SELECT team_id FROM debate_scores WHERE event_id = $1 AND judge_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );
    const scoredTeams = new Set(existingScores.rows.map(s => s.team_id));

    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <a href="/school/debate-club/events/${id}" style="color:${P};text-decoration:none;">&larr; Back to Event</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0;">Score Teams &mdash; ${esc(ev.title)}</h1>
      <p style="color:${GRAY};margin-bottom:20px;">Judge: ${esc(req.session.user.name || 'You')}</p>`;

    for (const t of teams.rows) {
      const done = scoredTeams.has(t.id);
      html += `<div class="card" style="border-left:4px solid ${done?'#059669':P};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">${esc(t.name)}</h3>
          ${done ? '<span style="color:#059669;font-weight:600;">Scored ✓</span>' : ''}
        </div>
        ${done ? '' : `<form method="POST" action="/school/debate-club/score/${id}/${t.id}">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
            <div>
              <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Argument Quality (0-30)</label>
              <input type="number" name="argument_quality" min="0" max="30" value="15" required/>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Delivery (0-25)</label>
              <input type="number" name="delivery" min="0" max="25" value="12" required/>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Evidence (0-25)</label>
              <input type="number" name="evidence" min="0" max="25" value="12" required/>
            </div>
            <div>
              <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Rebuttal (0-20)</label>
              <input type="number" name="rebuttal" min="0" max="20" value="10" required/>
            </div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Comments</label>
            <textarea name="comments" rows="2" placeholder="Optional feedback..."></textarea>
          </div>
          <button type="submit" class="btn">Submit Score</button>
        </form>`}
      </div>`;
    }

    html += `</div>`;
    res.send(renderPage('Score Teams', html, req.session.user));
  }));

  app.post('/school/debate-club/score/:eventId/:teamId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { eventId, teamId } = req.params;
    const { argument_quality, delivery, evidence, rebuttal, comments } = req.body;
    const aq = Math.max(0, Math.min(30, parseInt(argument_quality) || 0));
    const del = Math.max(0, Math.min(25, parseInt(delivery) || 0));
    const evi = Math.max(0, Math.min(25, parseInt(evidence) || 0));
    const reb = Math.max(0, Math.min(20, parseInt(rebuttal) || 0));
    const total = aq + del + evi + reb;
    await pool.query(
      `INSERT INTO debate_scores (tenant_id, event_id, team_id, judge_id, criteria, total_score, comments) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, eventId, teamId, uid, JSON.stringify({ argument_quality: aq, delivery: del, evidence: evi, rebuttal: reb }), total, comments || null]
    );
    audit('debate_score_submitted', { event_id: eventId, team_id: teamId, total }, req);
    res.redirect(`/school/debate-club/score/${eventId}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: BRACKETS / TOURNAMENT
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/brackets/:event_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { event_id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2`, [event_id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found');
    const ev = evResult.rows[0];

    const brackets = await pool.query(
      `SELECT db.*, ta.name AS team_a_name, tb.name AS team_b_name, tw.name AS winner_name FROM debate_brackets db LEFT JOIN debate_teams ta ON ta.id = db.team_a_id LEFT JOIN debate_teams tb ON tb.id = db.team_b_id LEFT JOIN debate_teams tw ON tw.id = db.winner_id WHERE db.event_id = $1 AND db.tenant_id = $2 ORDER BY db.round, db.match_number`,
      [event_id, tid]
    );

    // Group by round
    const rounds = {};
    for (const b of brackets.rows) {
      (rounds[b.round] = rounds[b.round] || []).push(b);
    }
    const maxRound = Math.max(...Object.keys(rounds).map(Number), 0);

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/debate-club/events/${event_id}" style="color:${P};text-decoration:none;">&larr; Back to Event</a></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Tournament Brackets &mdash; ${esc(ev.title)}</h1>
        <form method="POST" action="/school/debate-club/brackets/${event_id}/generate" style="display:inline;">
          <button type="submit" class="btn" style="background:#059669;">Generate Brackets</button>
        </form>
      </div>`;

    if (maxRound === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;">🏆</p><p>No brackets generated. Click "Generate Brackets" to create the tournament structure.</p></div>`;
    } else {
      for (let r = 1; r <= maxRound; r++) {
        const roundName = r === maxRound ? 'Final' : maxRound - 1 === r ? 'Semifinal' : `Round ${r}`;
        const matches = rounds[r] || [];
        html += `<div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:18px;font-weight:700;color:${P};margin:0 0 14px;">${roundName}</h3>`;
        for (const m of matches) {
          const aWin = m.winner_id === m.team_a_id;
          const bWin = m.winner_id === m.team_b_id;
          html += `<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;background:#fff;">
            <div style="flex:1;text-align:right;${aWin?'font-weight:700;color:#059669;':''}">${esc(m.team_a_name||'TBD')} ${aWin?'★':''}</div>
            <div style="font-weight:800;color:${GRAY};font-size:14px;min-width:60px;text-align:center;">
              ${m.score_a != null ? `${Number(m.score_a).toFixed(0)} - ${Number(m.score_b).toFixed(0)}` : 'vs'}
            </div>
            <div style="flex:1;${bWin?'font-weight:700;color:#059669;':''}">${bWin?'★':''} ${esc(m.team_b_name||'TBD')}</div>
            ${m.status==='pending'&&m.team_a_id&&m.team_b_id?`<form method="POST" action="/school/debate-club/brackets/${event_id}/resolve" style="display:flex;gap:4px;flex-direction:column;">
              <input type="hidden" name="bracket_id" value="${m.id}"/>
              <button name="winner" value="${m.team_a_id}" style="padding:2px 10px;background:#eef2ff;color:${P};border:1px solid #c7d2fe;border-radius:4px;cursor:pointer;font-size:11px;">${esc(m.team_a_name)}</button>
              <button name="winner" value="${m.team_b_id}" style="padding:2px 10px;background:#eef2ff;color:${P};border:1px solid #c7d2fe;border-radius:4px;cursor:pointer;font-size:11px;">${esc(m.team_b_name)}</button>
            </form>`:''}
          </div>`;
        }
        html += `</div>`;
      }
    }

    html += `</div>`;
    res.send(renderPage('Tournament Brackets', html, req.session.user));
  }));

  // Generate brackets from registered teams
  app.post('/school/debate-club/brackets/:event_id/generate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { event_id } = req.params;
    const teams = await pool.query(`SELECT id FROM debate_teams WHERE event_id = $1 AND tenant_id = $2 ORDER BY id`, [event_id, tid]);
    if (teams.rows.length < 2) return res.status(400).send('Need at least 2 teams');
    // Clear existing brackets
    await pool.query(`DELETE FROM debate_brackets WHERE event_id = $1 AND tenant_id = $2`, [event_id, tid]);
    // Pair up teams into round 1 matches
    const teamIds = teams.rows.map(t => t.id);
    let matchNum = 1;
    for (let i = 0; i < teamIds.length; i += 2) {
      const a = teamIds[i];
      const b = teamIds[i + 1] || null;
      await pool.query(
        `INSERT INTO debate_brackets (tenant_id, event_id, round, match_number, team_a_id, team_b_id, status) VALUES ($1,$2,1,$3,$4,$5,'pending')`,
        [tid, event_id, matchNum++, a, b]
      );
    }
    audit('debate_brackets_generated', { event_id, teams: teamIds.length }, req);
    res.redirect(`/school/debate-club/brackets/${event_id}`);
  }));

  // Resolve a bracket match
  app.post('/school/debate-club/brackets/:event_id/resolve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { event_id } = req.params;
    const { bracket_id, winner } = req.body;
    const wid = parseInt(winner);
    await pool.query(
      `UPDATE debate_brackets SET winner_id = $1, status = 'finished' WHERE id = $2 AND tenant_id = $3`,
      [wid, bracket_id, tid]
    );
    // Advance winner to next round
    const bracket = await pool.query(`SELECT * FROM debate_brackets WHERE id = $1 AND tenant_id = $2`, [bracket_id, tid]);
    if (bracket.rows[0]) {
      const b = bracket.rows[0];
      const nextRound = b.round + 1;
      // Check if a slot exists in next round
      const existing = await pool.query(
        `SELECT * FROM debate_brackets WHERE event_id = $1 AND round = $2 AND tenant_id = $3 AND team_a_id IS NULL LIMIT 1`,
        [event_id, nextRound, tid]
      );
      if (existing.rows.length > 0) {
        await pool.query(`UPDATE debate_brackets SET team_b_id = $1 WHERE id = $2 AND tenant_id = $3`, [wid, existing.rows[0].id, tid]);
      } else {
        await pool.query(
          `INSERT INTO debate_brackets (tenant_id, event_id, round, match_number, team_a_id, status) VALUES ($1,$2,$3,1,$4,'pending')`,
          [tid, event_id, nextRound, wid]
        );
      }
    }
    // Update team wins/losses
    const loser = bracket.rows[0]?.team_a_id === wid ? bracket.rows[0]?.team_b_id : bracket.rows[0]?.team_a_id;
    if (loser) await pool.query(`UPDATE debate_teams SET losses = losses + 1 WHERE id = $1 AND tenant_id = $2`, [loser, tid]);
    await pool.query(`UPDATE debate_teams SET wins = wins + 1 WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    audit('debate_bracket_resolved', { bracket_id, winner_id: wid }, req);
    res.redirect(`/school/debate-club/brackets/${event_id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/leaderboard', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const teamLeaderboard = await pool.query(
      `SELECT dt.name, dt.side, SUM(dt.wins) AS total_wins, SUM(dt.losses) AS total_losses,
              COUNT(ds.id) AS score_count, COALESCE(AVG(ds.total_score),0) AS avg_score
       FROM debate_teams dt
       LEFT JOIN debate_scores ds ON ds.team_id = dt.id AND ds.tenant_id = dt.tenant_id
       WHERE dt.tenant_id = $1
       GROUP BY dt.id
       ORDER BY total_wins DESC, avg_score DESC
       LIMIT 20`,
      [tid]
    );

    const speakerLeaderboard = await pool.query(
      `SELECT * FROM debate_speaker_profiles WHERE tenant_id = $1 ORDER BY average_score DESC LIMIT 20`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Leaderboard</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('leaderboard')}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <h3 style="font-size:18px;font-weight:700;color:${P};margin:0 0 14px;">Team Rankings</h3>
          ${teamLeaderboard.rows.length === 0 ? '<p style="color:'+GRAY+';">No data yet.</p>' :
            `<table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Avg Score</th></tr></thead><tbody>` +
            teamLeaderboard.rows.map((t,i) => `<tr>
              <td style="font-weight:800;color:${i<3?'#f59e0b':P};font-size:18px;">${i+1}</td>
              <td style="font-weight:600;">${esc(t.name)}</td>
              <td style="color:#059669;font-weight:700;">${t.total_wins}</td>
              <td style="color:#dc2626;">${t.total_losses}</td>
              <td style="font-weight:700;">${Number(t.avg_score).toFixed(1)}</td>
            </tr>`).join('') + '</tbody></table>'}
        </div>
        <div class="card">
          <h3 style="font-size:18px;font-weight:700;color:${P};margin:0 0 14px;">Speaker Rankings</h3>
          ${speakerLeaderboard.rows.length === 0 ? '<p style="color:'+GRAY+';">No speaker profiles yet.</p>' :
            `<table><thead><tr><th>#</th><th>Speaker</th><th>Debates</th><th>Wins</th><th>Avg</th></tr></thead><tbody>` +
            speakerLeaderboard.rows.map((s,i) => `<tr>
              <td style="font-weight:800;color:${i<3?'#f59e0b':P};font-size:18px;">${i+1}</td>
              <td style="font-weight:600;">${esc(s.bio?.slice(0,40)||'Speaker #'+s.id)}</td>
              <td>${s.total_debates}</td>
              <td style="color:#059669;font-weight:700;">${s.wins}</td>
              <td style="font-weight:700;">${Number(s.average_score).toFixed(1)}</td>
            </tr>`).join('') + '</tbody></table>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Leaderboard', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: ARCHIVES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/archive', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const archives = await pool.query(
      `SELECT da.* FROM debate_archives da WHERE da.tenant_id = $1 ORDER BY da.archived_at DESC LIMIT 50`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Debate Archives</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('archive')}</div>
      </div>`;

    if (archives.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;">📚</p><p>No archived debates yet.</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;">`;
      for (const a of archives.rows) {
        html += `<div class="card" style="border-left:4px solid #f59e0b;">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 6px;">${esc(a.title)}</h3>
          <p style="font-size:13px;color:${GRAY};margin:0 0 8px;">Topic: ${esc(a.topic_title||'N/A')}</p>
          <div style="display:flex;gap:16px;font-size:13px;">
            <span style="color:#f59e0b;font-weight:700;">Winner: ${esc(a.winning_team||'N/A')}</span>
            <span style="color:${GRAY};">Runner-up: ${esc(a.runner_up||'N/A')}</span>
          </div>
          <div style="font-size:12px;color:${GRAY};margin-top:8px;">Archived: ${a.archived_at ? new Date(a.archived_at).toLocaleDateString() : 'N/A'}</div>
          <a href="/school/debate-club/events/${a.event_id}" style="color:${P};font-size:13px;text-decoration:none;font-weight:600;">View Full Details &rarr;</a>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    res.send(renderPage('Debate Archives', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11: MY DEBATES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/my-debates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const myTeams = await pool.query(
      `SELECT dt.*, de.title AS event_title, de.date AS event_date, de.status AS event_status, de.format AS event_format
       FROM debate_teams dt
       JOIN debate_events de ON de.id = dt.event_id
       WHERE dt.tenant_id = $1 AND $2 = ANY(SELECT jsonb_array_elements_text(dt.members)::int)
       ORDER BY de.date DESC NULLS LAST`,
      [tid, uid]
    );

    const myScores = await pool.query(
      `SELECT ds.*, dt.name AS team_name, de.title AS event_title FROM debate_scores ds
       JOIN debate_teams dt ON dt.id = ds.team_id
       JOIN debate_events de ON de.id = ds.event_id
       WHERE ds.tenant_id = $1 AND $2 = ANY(SELECT jsonb_array_elements_text(dt.members)::int)
       ORDER BY ds.created_at DESC`,
      [tid, uid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">My Debates</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('my-debates')}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">My Teams (${myTeams.rows.length})</h3>`;
    if (myTeams.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">You haven't joined any debate teams yet.</p>`;
    } else {
      for (const t of myTeams.rows) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <strong style="color:#111827;">${esc(t.name)}</strong>
            <div style="font-size:12px;color:${GRAY};">${esc(t.event_title)} &bull; W:${t.wins} L:${t.losses}</div>
          </div>
          ${statusBadge(t.event_status)}
        </div>`;
      }
    }
    html += `</div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Scores Received (${myScores.rows.length})</h3>`;
    if (myScores.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No scores yet.</p>`;
    } else {
      for (const s of myScores.rows) {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <span style="font-weight:600;color:#111827;">${esc(s.team_name)}</span>
            <div style="font-size:12px;color:${GRAY};">${esc(s.event_title)}</div>
          </div>
          <span style="font-size:18px;font-weight:800;color:${P};">${Number(s.total_score).toFixed(1)}</span>
        </div>`;
      }
    }
    html += `</div></div></div>`;
    res.send(renderPage('My Debates', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12: SPEAKER PROFILES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/speakers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const speakers = await pool.query(
      `SELECT dsp.*, u.name AS user_name FROM debate_speaker_profiles dsp LEFT JOIN users u ON u.id = dsp.user_id WHERE dsp.tenant_id = $1 ORDER BY dsp.average_score DESC`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Speaker Profiles</h1>
        <form method="POST" action="/school/debate-club/speakers" style="display:inline;">
          <button type="submit" class="btn" style="background:#059669;">Create My Profile</button>
        </form>
      </div>`;

    if (speakers.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;">🎤</p><p>No speaker profiles yet. Create yours!</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">`;
      for (const s of speakers.rows) {
        const achievements = Array.isArray(s.achievements) ? s.achievements : JSON.parse(s.achievements || '[]');
        html += `<div class="card" style="text-align:center;">
          <div style="width:64px;height:64px;border-radius:50%;background:${P};color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin:0 auto 12px;">
            ${esc((s.user_name||'?')[0])}
          </div>
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 4px;">${esc(s.user_name||'Unknown')}</h3>
          <p style="font-size:13px;color:${GRAY};margin:0 0 8px;">${esc(s.specialization||'General Debater')}</p>
          <div style="display:flex;justify-content:center;gap:16px;font-size:13px;margin-bottom:8px;">
            <span><strong>${s.total_debates}</strong> debates</span>
            <span><strong>${s.wins}</strong> wins</span>
            <span><strong>${Number(s.average_score).toFixed(1)}</strong> avg</span>
          </div>
          ${achievements.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center;">
            ${achievements.map(a => `<span style="display:inline-block;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:11px;">${esc(a)}</span>`).join('')}
          </div>` : ''}
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    res.send(renderPage('Speaker Profiles', html, req.session.user));
  }));

  app.post('/school/debate-club/speakers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    await pool.query(
      `INSERT INTO debate_speaker_profiles (tenant_id, user_id, bio) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tid, uid, `Debater profile for ${req.session.user.name || 'User'}`]
    );
    res.redirect('/school/debate-club/speakers');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13: SKILL DEVELOPMENT TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/skills', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const mySkills = await pool.query(
      `SELECT * FROM debate_skill_tracking WHERE tenant_id = $1 AND user_id = $2 ORDER BY skill_name`,
      [tid, uid]
    );

    const allSkills = [
      'Public Speaking', 'Argumentation', 'Critical Thinking', 'Research',
      'Rebuttal', 'Persuasion', 'Logic', 'Evidence Analysis',
      'Cross-Examination', 'Time Management', 'Emotional Appeal', 'Fact-Checking'
    ];
    const existingSkills = new Set(mySkills.rows.map(s => s.skill_name));

    let html = `${SKIP}<div style="max-width:900px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Skill Development</h1>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pageNav('skills')}</div>
      </div>

      <form method="POST" action="/school/debate-club/skills" class="card" style="margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Add or Update a Skill</h3>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Skill Name *</label>
            <select name="skill_name" required>
              <option value="">Select a skill...</option>
              ${allSkills.filter(s => !existingSkills.has(s)).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
              ${allSkills.filter(s => existingSkills.has(s)).map(s => `<option value="${esc(s)}">${esc(s)} (update)</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Proficiency</label>
            <select name="proficiency_level">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Self Rating (1-10)</label>
            <input type="number" name="self_rating" min="1" max="10" value="5"/>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Practice Hours</label>
            <input type="number" name="practice_hours" min="0" step="0.5" value="0"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Notes</label>
            <input type="text" name="notes" placeholder="What have you been working on?"/>
          </div>
        </div>
        <button type="submit" class="btn">Save Skill</button>
      </form>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">My Skills (${mySkills.rows.length})</h3>`;
    if (mySkills.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No skills tracked yet. Start tracking your debate skills above.</p>`;
    } else {
      html += `<table><thead><tr><th>Skill</th><th>Level</th><th>Self Rating</th><th>Hours</th><th>Peer Rating</th><th>Notes</th><th>Actions</th></tr></thead><tbody>`;
      for (const s of mySkills.rows) {
        html += `<tr>
          <td style="font-weight:600;">${esc(s.skill_name)}</td>
          <td>${statusBadge(s.proficiency_level)}</td>
          <td><span style="font-size:18px;font-weight:800;color:${P};">${s.self_rating}</span>/10</td>
          <td>${Number(s.practice_hours).toFixed(1)}h</td>
          <td>${s.peer_rating > 0 ? Number(s.peer_rating).toFixed(1) : '-'}</td>
          <td style="font-size:13px;color:${GRAY};">${esc((s.notes||'').slice(0,40))}</td>
          <td><a href="/school/debate-club/skills/${s.id}/edit" style="color:${P};font-size:13px;text-decoration:none;">Edit</a></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div></div>`;
    res.send(renderPage('Skill Development', html, req.session.user));
  }));

  app.post('/school/debate-club/skills', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { skill_name, proficiency_level, self_rating, practice_hours, notes } = req.body;
    if (!skill_name) return res.status(400).send('Skill name is required');
    const existing = await pool.query(
      `SELECT id FROM debate_skill_tracking WHERE tenant_id = $1 AND user_id = $2 AND skill_name = $3`,
      [tid, uid, skill_name]
    );
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE debate_skill_tracking SET proficiency_level = $1, self_rating = $2, practice_hours = $3, notes = $4, updated_at = NOW() WHERE id = $5 AND tenant_id = $6`,
        [proficiency_level||'beginner', parseInt(self_rating)||5, parseFloat(practice_hours)||0, notes||null, existing.rows[0].id, tid]
      );
    } else {
      await pool.query(
        `INSERT INTO debate_skill_tracking (tenant_id, user_id, skill_name, proficiency_level, self_rating, practice_hours, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, uid, skill_name, proficiency_level||'beginner', parseInt(self_rating)||5, parseFloat(practice_hours)||0, notes||null]
      );
    }
    audit('debate_skill_updated', { skill_name }, req);
    res.redirect('/school/debate-club/skills');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14: RESEARCH RESOURCES HUB
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { search } = req.query;
    let where = `WHERE dr.tenant_id = $1`;
    const params = [tid];
    if (search) { where += ` AND (dr.title ILIKE $2 OR dr.content ILIKE $2)`; params.push(`%${search}%`); }

    const resources = await pool.query(
      `SELECT dr.*, dt.title AS topic_title FROM debate_research dr LEFT JOIN debate_topics dt ON dt.id = dr.topic_id ${where} ORDER BY dr.created_at DESC LIMIT 50`,
      params
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 20px;">Research Hub</h1>
      <form method="GET" style="display:flex;gap:10px;margin-bottom:20px;">
        <input type="text" name="search" value="${esc(search||'')}" placeholder="Search resources..." style="flex:1;"/>
        <button type="submit" class="btn">Search</button>
      </form>
      <form method="POST" action="/school/debate-club/research" class="card" style="margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Add Resource</h3>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
            <input type="text" name="title" required placeholder="Resource title"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Type</label>
            <select name="source_type">
              <option value="article">Article</option>
              <option value="video">Video</option>
              <option value="book">Book</option>
              <option value="study">Study/Research Paper</option>
              <option value="website">Website</option>
              <option value="news">News</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Source URL</label>
          <input type="url" name="source_url" placeholder="https://..."/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Content / Summary</label>
          <textarea name="content" rows="3" placeholder="Brief summary of this resource..."></textarea>
        </div>
        <button type="submit" class="btn">Add Resource</button>
      </form>`;

    if (resources.rows.length === 0) {
      html += `<div style="text-align:center;padding:40px;color:${GRAY};"><p>No research resources found.</p></div>`;
    } else {
      html += `<table><thead><tr><th>Title</th><th>Topic</th><th>Type</th><th>Added</th><th>Link</th></tr></thead><tbody>`;
      for (const r of resources.rows) {
        html += `<tr>
          <td style="font-weight:600;">${esc(r.title)}</td>
          <td>${esc(r.topic_title||'General')}</td>
          <td>${statusBadge(r.source_type||'article')}</td>
          <td style="font-size:12px;color:${GRAY};">${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'N/A'}</td>
          <td>${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" style="color:${P};text-decoration:none;">Open</a>` : '-'}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    html += `</div>`;
    res.send(renderPage('Research Hub', html, req.session.user));
  }));

  app.post('/school/debate-club/research', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, source_url, source_type, content } = req.body;
    if (!title) return res.status(400).send('Title is required');
    await pool.query(
      `INSERT INTO debate_research (tenant_id, title, source_url, source_type, content, added_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, title.trim(), source_url || null, source_type || 'article', content || null, uid]
    );
    audit('debate_research_added_general', { title: title.trim() }, req);
    res.redirect('/school/debate-club/research');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15: SPEECH TIMING
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/timer/:event_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { event_id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2`, [event_id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found');
    const ev = evResult.rows[0];

    const teams = await pool.query(`SELECT id, name FROM debate_teams WHERE event_id = $1 AND tenant_id = $2 ORDER BY name`, [event_id, tid]);
    const timers = await pool.query(
      `SELECT dst.*, dt.name AS team_name FROM debate_speech_timer dst JOIN debate_teams dt ON dt.id = dst.team_id WHERE dst.event_id = $1 AND dst.tenant_id = $2 ORDER BY dst.created_at DESC`,
      [event_id, tid]
    );

    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <a href="/school/debate-club/events/${event_id}" style="color:${P};text-decoration:none;">&larr; Back to Event</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0;">Speech Timer &mdash; ${esc(ev.title)}</h1>

      <form method="POST" action="/school/debate-club/timer/${event_id}" class="card" style="margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">New Timer</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Team</label>
            <select name="team_id" required>
              ${(teams.rows||[]).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Speaker</label>
            <input type="text" name="speaker_name" placeholder="Speaker name"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Speech Type</label>
            <select name="speech_type">
              <option value="constructive">Constructive</option>
              <option value="rebuttal">Rebuttal</option>
              <option value="summary">Summary</option>
              <option value="opening">Opening</option>
              <option value="closing">Closing</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Time (seconds)</label>
            <input type="number" name="allotted_seconds" min="30" max="1800" value="300"/>
          </div>
        </div>
        <button type="submit" class="btn">Start Timer</button>
      </form>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Timer History</h3>`;
    if (timers.rows.length === 0) {
      html += `<p style="color:${GRAY};font-size:14px;">No timers recorded yet.</p>`;
    } else {
      html += `<table><thead><tr><th>Team</th><th>Speaker</th><th>Type</th><th>Allotted</th><th>Actual</th><th>Status</th></tr></thead><tbody>`;
      for (const t of timers.rows) {
        html += `<tr>
          <td style="font-weight:600;">${esc(t.team_name)}</td>
          <td>${esc(t.speaker_name||'-')}</td>
          <td>${statusBadge(t.speech_type)}</td>
          <td>${Math.floor(t.allotted_seconds/60)}:${String(t.allotted_seconds%60).padStart(2,'0')}</td>
          <td>${t.actual_seconds ? `${Math.floor(t.actual_seconds/60)}:${String(t.actual_seconds%60).padStart(2,'0')}` : '-'}</td>
          <td>${statusBadge(t.status)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div></div>`;
    res.send(renderPage('Speech Timer', html, req.session.user));
  }));

  app.post('/school/debate-club/timer/:event_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { event_id } = req.params;
    const { team_id, speaker_name, speech_type, allotted_seconds } = req.body;
    if (!team_id) return res.status(400).send('Team is required');
    const allotted = parseInt(allotted_seconds) || 300;
    await pool.query(
      `INSERT INTO debate_speech_timer (tenant_id, event_id, team_id, speaker_name, speech_type, allotted_seconds, started_at, status) VALUES ($1,$2,$3,$4,$5,$6,NOW(),'in_progress')`,
      [tid, event_id, parseInt(team_id), speaker_name || null, speech_type || 'constructive', allotted]
    );
    audit('debate_timer_started', { event_id, team_id }, req);
    res.redirect(`/school/debate-club/timer/${event_id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16: VOTING
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/debate-club/vote/:event_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { event_id } = req.params;
    const evResult = await pool.query(`SELECT * FROM debate_events WHERE id = $1 AND tenant_id = $2 AND status = 'ongoing'`, [event_id, tid]);
    if (!evResult.rows[0]) return res.status(404).send('Event not found or not active for voting');

    const brackets = await pool.query(
      `SELECT db.*, ta.name AS team_a_name, tb.name AS team_b_name FROM debate_brackets db
       LEFT JOIN debate_teams ta ON ta.id = db.team_a_id
       LEFT JOIN debate_teams tb ON tb.id = db.team_b_id
       WHERE db.event_id = $1 AND db.tenant_id = $2 AND db.status = 'finished'
       ORDER BY db.round DESC, db.match_number`,
      [event_id, tid]
    );

    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <a href="/school/debate-club/events/${event_id}" style="color:${P};text-decoration:none;">&larr; Back to Event</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0;">Audience Vote &mdash; ${esc(evResult.rows[0].title)}</h1>`;

    if (brackets.rows.length === 0) {
      html += `<div style="text-align:center;padding:40px;color:${GRAY};"><p>No completed matches to vote on yet.</p></div>`;
    } else {
      for (const b of brackets.rows) {
        const hasVoted = await pool.query(
          `SELECT id FROM debate_votes WHERE bracket_id = $1 AND voter_id = $2 AND tenant_id = $3`,
          [b.id, uid, tid]
        );
        html += `<div class="card" style="border-left:4px solid #7c3aed;">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px;">Round ${b.round} - Match ${b.match_number}</h3>
          ${hasVoted.rows.length > 0 ? `<p style="color:#059669;font-weight:600;">You have voted for this match.</p>` : `
          <form method="POST" action="/school/debate-club/vote/${event_id}">
            <input type="hidden" name="bracket_id" value="${b.id}"/>
            <div style="display:flex;gap:16px;align-items:center;">
              <label style="flex:1;padding:12px;background:#eef2ff;border-radius:8px;text-align:center;cursor:pointer;">
                <input type="radio" name="team_id" value="${b.team_a_id}" required style="margin-right:8px;"/>
                <strong>${esc(b.team_a_name||'Team A')}</strong>
              </label>
              <span style="font-weight:700;color:${GRAY};">VS</span>
              <label style="flex:1;padding:12px;background:#eef2ff;border-radius:8px;text-align:center;cursor:pointer;">
                <input type="radio" name="team_id" value="${b.team_b_id}" style="margin-right:8px;"/>
                <strong>${esc(b.team_b_name||'Team B')}</strong>
              </label>
            </div>
            <button type="submit" class="btn" style="margin-top:12px;width:100%;background:#7c3aed;">Cast Vote</button>
          </form>`}
        </div>`;
      }
    }

    html += `</div>`;
    res.send(renderPage('Audience Vote', html, req.session.user));
  }));

  app.post('/school/debate-club/vote/:event_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { event_id } = req.params;
    const { bracket_id, team_id } = req.body;
    if (!bracket_id || !team_id) return res.status(400).send('Select a team to vote for');
    try {
      await pool.query(
        `INSERT INTO debate_votes (tenant_id, event_id, bracket_id, voter_id, team_id) VALUES ($1,$2,$3,$4,$5)`,
        [tid, event_id, parseInt(bracket_id), uid, parseInt(team_id)]
      );
      audit('debate_vote_cast', { bracket_id, team_id }, req);
    } catch(e) {
      if (e.code === '23505') {
        return res.send('<p style="color:#d97706;font-weight:600;">You have already voted for this match.</p><a href="/school/debate-club/vote/'+event_id+'">Go back</a>');
      }
      throw e;
    }
    res.redirect(`/school/debate-club/vote/${event_id}`);
  }));

  console.log('[DebateClub] Routes registered');
};
