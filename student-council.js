/**
 * Student Council Management Module
 * Complete module for managing council positions, members, elections, meetings,
 * proposals, budget, community service, achievements, events, and reports.
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

  const SKIP = `<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Student Council</div>`;

  // ─── Table creation ────────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_positions (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          max_holders INTEGER DEFAULT 1,
          precedence INTEGER DEFAULT 0,
          responsibilities TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_terms (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          label VARCHAR(255) NOT NULL,
          term_start DATE NOT NULL,
          term_end DATE NOT NULL,
          status VARCHAR(50) DEFAULT 'upcoming',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_members (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          position_id INTEGER NOT NULL REFERENCES council_positions(id),
          term_id INTEGER NOT NULL REFERENCES council_terms(id),
          student_id INTEGER NOT NULL,
          status VARCHAR(50) DEFAULT 'active',
          photo VARCHAR(500),
          manifesto TEXT,
          joined_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_elections (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          position_id INTEGER NOT NULL REFERENCES council_positions(id),
          term_id INTEGER NOT NULL REFERENCES council_terms(id),
          title VARCHAR(500) NOT NULL,
          description TEXT,
          nomination_start TIMESTAMPTZ,
          nomination_end TIMESTAMPTZ,
          voting_start TIMESTAMPTZ,
          voting_end TIMESTAMPTZ,
          status VARCHAR(50) DEFAULT 'draft',
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_candidates (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          election_id INTEGER NOT NULL REFERENCES council_elections(id),
          student_id INTEGER NOT NULL,
          manifesto TEXT,
          photo VARCHAR(500),
          status VARCHAR(50) DEFAULT 'nominated',
          vote_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_votes (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          election_id INTEGER NOT NULL REFERENCES council_elections(id),
          voter_id INTEGER NOT NULL,
          candidate_id INTEGER NOT NULL REFERENCES council_candidates(id),
          voted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(election_id, voter_id)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_meetings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          meeting_date DATE NOT NULL,
          meeting_time TIME,
          venue VARCHAR(255),
          agenda TEXT,
          minutes TEXT,
          attendees JSONB DEFAULT '[]'::jsonb,
          status VARCHAR(50) DEFAULT 'scheduled',
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_proposals (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          proposer_id INTEGER NOT NULL,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          category VARCHAR(100),
          status VARCHAR(50) DEFAULT 'open',
          votes_for INTEGER DEFAULT 0,
          votes_against INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_proposal_votes (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          proposal_id INTEGER NOT NULL REFERENCES council_proposals(id),
          voter_id INTEGER NOT NULL,
          vote VARCHAR(10) NOT NULL,
          voted_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(proposal_id, voter_id)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_budget (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          term_id INTEGER NOT NULL REFERENCES council_terms(id),
          category VARCHAR(200) NOT NULL,
          allocated NUMERIC(12,2) DEFAULT 0,
          spent NUMERIC(12,2) DEFAULT 0,
          description TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_budget_transactions (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          budget_id INTEGER NOT NULL REFERENCES council_budget(id),
          description VARCHAR(500) NOT NULL,
          amount NUMERIC(12,2) NOT NULL,
          transaction_type VARCHAR(20) DEFAULT 'expense',
          receipt_url VARCHAR(500),
          approved_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_community_service (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          event_date DATE,
          venue VARCHAR(255),
          category VARCHAR(100),
          status VARCHAR(50) DEFAULT 'planned',
          participant_ids JSONB DEFAULT '[]'::jsonb,
          hours_contributed NUMERIC(6,2) DEFAULT 0,
          coordinator_id INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_achievements (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          achievement_date DATE,
          category VARCHAR(100),
          awarded_to INTEGER,
          certificate_url VARCHAR(500),
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS council_events (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL DEFAULT 0,
          title VARCHAR(500) NOT NULL,
          description TEXT,
          event_date DATE,
          event_time TIME,
          venue VARCHAR(255),
          budget_allocated NUMERIC(12,2) DEFAULT 0,
          status VARCHAR(50) DEFAULT 'planned',
          organizer_id INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_positions_tenant ON council_positions(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_terms_tenant ON council_terms(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_members_tenant ON council_members(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_elections_tenant ON council_elections(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_candidates_tenant ON council_candidates(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_votes_tenant ON council_votes(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_meetings_tenant ON council_meetings(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_proposals_tenant ON council_proposals(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_proposal_votes_tenant ON council_proposal_votes(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_budget_tenant ON council_budget(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_budget_tx_tenant ON council_budget_transactions(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_community_tenant ON council_community_service(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_achievements_tenant ON council_achievements(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_council_events_tenant ON council_events(tenant_id);`);
      console.log('[StudentCouncil] Tables ready');
    } catch(e) { console.warn('[StudentCouncil] Migration warning:', e.message); }
  })();

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function statusBadge(status) {
    const colors = {
      active: '#059669', inactive: '#6b7280', upcoming: '#2563eb', ongoing: '#059669',
      completed: '#6b7280', scheduled: '#2563eb', draft: '#9ca3af', open: '#059669',
      closed: '#dc2626', approved: '#059669', rejected: '#dc2626', planned: '#d97706',
      cancelled: '#dc2626', nominated: '#2563eb', elected: '#059669', past: '#6b7280',
      resolved: '#4f46e5', pending: '#d97706', published: '#059669'
    };
    const bg = colors[status] || '#6b7280';
    return `<span style="display:inline-block;padding:3px 12px;border-radius:9999px;font-size:12px;font-weight:600;color:#fff;background:${bg};">${esc(String(status).replace(/_/g,' ').toUpperCase())}</span>`;
  }

  function pageNav(active) {
    const links = [
      { href: '/school/student-council', label: 'Dashboard', id: 'dashboard' },
      { href: '/school/student-council/positions', label: 'Positions', id: 'positions' },
      { href: '/school/student-council/members', label: 'Members', id: 'members' },
      { href: '/school/student-council/elections', label: 'Elections', id: 'elections' },
      { href: '/school/student-council/meetings', label: 'Meetings', id: 'meetings' },
      { href: '/school/student-council/proposals', label: 'Proposals', id: 'proposals' },
      { href: '/school/student-council/budget', label: 'Budget', id: 'budget' },
      { href: '/school/student-council/community-service', label: 'Service', id: 'community-service' },
      { href: '/school/student-council/achievements', label: 'Achievements', id: 'achievements' },
      { href: '/school/student-council/reports', label: 'Reports', id: 'reports' }
    ];
    return links.map(l =>
      `<a href="${l.href}" style="display:inline-block;padding:7px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;color:${active===l.id?'#fff':P};background:${active===l.id?P:'#eef2ff'};">${l.label}</a>`
    ).join(' ');
  }

  function statCard(label, value, color) {
    return `<div style="background:${color||'#eef2ff'};border-radius:12px;padding:20px;flex:1;min-width:150px;">
      <div style="font-size:13px;color:${GRAY};margin-bottom:4px;">${esc(label)}</div>
      <div style="font-size:24px;font-weight:800;color:#111827;">${esc(String(value))}</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;

    const [posR, memR, meetR, propR, elecR, achR, servR, evtR] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS c FROM council_positions WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_members cm JOIN council_terms ct ON ct.id = cm.term_id WHERE cm.tenant_id = $1 AND cm.status = 'active' AND ct.status IN ('active','upcoming')`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_meetings WHERE tenant_id = $1 AND meeting_date >= CURRENT_DATE`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_proposals WHERE tenant_id = $1 AND status = 'open'`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_elections WHERE tenant_id = $1 AND status IN ('nomination','voting')`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_achievements WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(hours_contributed),0) AS total FROM council_community_service WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_events WHERE tenant_id = $1 AND event_date >= CURRENT_DATE`, [tid])
    ]);

    const upcomingMeetings = await pool.query(
      `SELECT * FROM council_meetings WHERE tenant_id = $1 AND meeting_date >= CURRENT_DATE ORDER BY meeting_date ASC LIMIT 5`, [tid]
    );
    const recentProposals = await pool.query(
      `SELECT cp.*, u.name AS proposer_name FROM council_proposals cp LEFT JOIN users u ON u.id = cp.proposer_id WHERE cp.tenant_id = $1 ORDER BY cp.created_at DESC LIMIT 5`, [tid]
    );
    const activeElections = await pool.query(
      `SELECT ce.*, cp.title AS position_title FROM council_elections ce JOIN council_positions cp ON cp.id = ce.position_id WHERE ce.tenant_id = $1 AND ce.status IN ('nomination','voting') ORDER BY ce.voting_start ASC LIMIT 3`, [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0;">Student Council</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('dashboard')}</div>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
        ${statCard('Positions', posR.rows[0].c)}
        ${statCard('Active Members', memR.rows[0].c)}
        ${statCard('Upcoming Meetings', meetR.rows[0].c)}
        ${statCard('Open Proposals', propR.rows[0].c)}
        ${statCard('Active Elections', elecR.rows[0].c)}
        ${statCard('Achievements', achR.rows[0].c)}
        ${statCard('Service Hours', Number(servR.rows[0].total).toFixed(1), '#fef3c7')}
        ${statCard('Upcoming Events', evtR.rows[0].c, '#ecfdf5')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">Upcoming Meetings</h3>
            <a href="/school/student-council/meetings" style="color:${P};font-size:13px;text-decoration:none;">View all</a>
          </div>
          ${upcomingMeetings.rows.length === 0 ? `<p style="color:${GRAY};font-size:14px;">No upcoming meetings.</p>` :
            upcomingMeetings.rows.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
              <div>
                <a href="/school/student-council/meetings/${m.id}" style="font-weight:600;color:#111827;text-decoration:none;">${esc(m.title)}</a>
                <div style="font-size:12px;color:${GRAY};">${new Date(m.meeting_date).toLocaleDateString()} ${m.meeting_time ? 'at ' + m.meeting_time : ''} &bull; ${esc(m.venue||'TBD')}</div>
              </div>
              ${statusBadge(m.status)}
            </div>`).join('')}
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">Recent Proposals</h3>
            <a href="/school/student-council/proposals" style="color:${P};font-size:13px;text-decoration:none;">View all</a>
          </div>
          ${recentProposals.rows.length === 0 ? `<p style="color:${GRAY};font-size:14px;">No proposals yet.</p>` :
            recentProposals.rows.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
              <div>
                <a href="/school/student-council/proposals/${p.id}" style="font-weight:600;color:#111827;text-decoration:none;">${esc(p.title)}</a>
                <div style="font-size:12px;color:${GRAY};">By ${esc(p.proposer_name||'Unknown')} &bull; ${p.votes_for}/${p.votes_against} votes</div>
              </div>
              ${statusBadge(p.status)}
            </div>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">Active Elections</h3>
            <a href="/school/student-council/elections" style="color:${P};font-size:13px;text-decoration:none;">View all</a>
          </div>
          ${activeElections.rows.length === 0 ? `<p style="color:${GRAY};font-size:14px;">No active elections.</p>` :
            activeElections.rows.map(e => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;">
              <div>
                <a href="/school/student-council/elections/${e.id}" style="font-weight:600;color:#111827;text-decoration:none;">${esc(e.title)}</a>
                <div style="font-size:12px;color:${GRAY};">${esc(e.position_title)} &bull; ${e.voting_end ? new Date(e.voting_end).toLocaleDateString() : 'TBD'}</div>
              </div>
              ${statusBadge(e.status)}
            </div>`).join('')}
        </div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px;">Quick Actions</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/school/student-council/positions/new" class="btn" style="text-decoration:none;">+ Position</a>
            <a href="/school/student-council/elections/new" class="btn" style="text-decoration:none;background:#059669;">+ Election</a>
            <a href="/school/student-council/meetings/new" class="btn" style="text-decoration:none;background:#2563eb;">+ Meeting</a>
            <a href="/school/student-council/proposals/new" class="btn" style="text-decoration:none;background:#d97706;">+ Proposal</a>
            <a href="/school/student-council/community-service/new" class="btn" style="text-decoration:none;background:#7c3aed;">+ Service</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Student Council', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: POSITIONS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/positions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT * FROM council_positions WHERE tenant_id = $1 ORDER BY precedence ASC, title ASC`, [tid]
    );
    let html = `${SKIP}<div style="max-width:900px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Positions</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('positions')}</div>
      </div>
      <a href="/school/student-council/positions/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Add Position</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">🏛️</p><p>No positions defined yet.</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">`;
      for (const p of result.rows) {
        html += `<div class="card" style="border-left:4px solid ${P};">
          <h3 style="font-size:17px;font-weight:700;color:#111827;margin:0 0 6px;">${esc(p.title)}</h3>
          <p style="font-size:13px;color:${GRAY};margin:0 0 8px;">${esc(p.description||'No description')}</p>
          <div style="font-size:12px;color:${GRAY};">Max holders: ${p.max_holders} &bull; Precedence: ${p.precedence}</div>
          <div style="margin-top:10px;display:flex;gap:8px;">
            <a href="/school/student-council/positions/${p.id}/edit" style="color:${P};font-size:13px;text-decoration:none;font-weight:600;">Edit</a>
            <form method="POST" action="/school/student-council/positions/${p.id}/delete" style="display:inline;" onsubmit="return confirm('Delete this position?')">
              <button style="color:#dc2626;font-size:13px;border:none;background:none;cursor:pointer;font-weight:600;">Delete</button>
            </form>
          </div>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Positions', html, req.session.user));
  }));

  app.get('/school/student-council/positions/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/positions" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Add Position</h1>
      <form method="POST" action="/school/student-council/positions" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. President, Vice President"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Max Holders</label>
            <input type="number" name="max_holders" min="1" value="1"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Precedence</label>
            <input type="number" name="precedence" min="0" value="0"/>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3" placeholder="Describe the role and its responsibilities..."></textarea>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Responsibilities</label>
          <textarea name="responsibilities" rows="3" placeholder="Key responsibilities of this position..."></textarea>
        </div>
        <button type="submit" class="btn">Create Position</button>
      </form>
    </div>`;
    res.send(renderPage('Add Position', html, req.session.user));
  }));

  app.post('/school/student-council/positions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { title, description, max_holders, precedence, responsibilities } = req.body;
    if (!title) return res.status(400).send('Title is required');
    await pool.query(
      `INSERT INTO council_positions (tenant_id, title, description, max_holders, precedence, responsibilities) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, title.trim(), description || null, parseInt(max_holders) || 1, parseInt(precedence) || 0, responsibilities || null]
    );
    audit('council_position_created', { title: title.trim() }, req);
    res.redirect('/school/student-council/positions');
  }));

  app.get('/school/student-council/positions/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM council_positions WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!result.rows[0]) return res.status(404).send('Position not found');
    const p = result.rows[0];
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/positions" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Edit Position</h1>
      <form method="POST" action="/school/student-council/positions/${id}" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required value="${esc(p.title)}"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Max Holders</label>
            <input type="number" name="max_holders" min="1" value="${p.max_holders}"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Precedence</label>
            <input type="number" name="precedence" min="0" value="${p.precedence}"/>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3">${esc(p.description||'')}</textarea>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Responsibilities</label>
          <textarea name="responsibilities" rows="3">${esc(p.responsibilities||'')}</textarea>
        </div>
        <button type="submit" class="btn">Update Position</button>
      </form>
    </div>`;
    res.send(renderPage('Edit Position', html, req.session.user));
  }));

  app.post('/school/student-council/positions/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { title, description, max_holders, precedence, responsibilities } = req.body;
    if (!title) return res.status(400).send('Title is required');
    await pool.query(
      `UPDATE council_positions SET title=$1, description=$2, max_holders=$3, precedence=$4, responsibilities=$5 WHERE id=$6 AND tenant_id=$7`,
      [title.trim(), description || null, parseInt(max_holders) || 1, parseInt(precedence) || 0, responsibilities || null, id, tid]
    );
    audit('council_position_updated', { id, title: title.trim() }, req);
    res.redirect('/school/student-council/positions');
  }));

  app.post('/school/student-council/positions/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`DELETE FROM council_positions WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('council_position_deleted', { id }, req);
    res.redirect('/school/student-council/positions');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: MEMBERS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/members', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const terms = await pool.query(`SELECT * FROM council_terms WHERE tenant_id = $1 ORDER BY term_start DESC`, [tid]);
    const activeTerm = terms.rows.find(t => t.status === 'active') || terms.rows[0];
    const termId = activeTerm ? activeTerm.id : null;

    let members = [];
    if (termId) {
      const result = await pool.query(
        `SELECT cm.*, cp.title AS position_title, u.name AS student_name, u.email AS student_email
         FROM council_members cm
         JOIN council_positions cp ON cp.id = cm.position_id
         LEFT JOIN users u ON u.id = cm.student_id
         WHERE cm.tenant_id = $1 AND cm.term_id = $2
         ORDER BY cp.precedence ASC, cm.joined_at ASC`,
        [tid, termId]
      );
      members = result.rows;
    }

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Members</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('members')}</div>
      </div>

      <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
        <label style="font-weight:600;color:#374151;">Term:</label>
        <select id="termSelect" onchange="location.href='/school/student-council/members?term='+this.value" style="width:auto;">
          ${terms.rows.map(t => `<option value="${t.id}" ${t.id === termId ? 'selected' : ''}>${esc(t.label)} (${new Date(t.term_start).getFullYear()}-${new Date(t.term_end).getFullYear()})</option>`).join('')}
        </select>
        ${termId ? `<a href="/school/student-council/members/new?term=${termId}" class="btn" style="text-decoration:none;background:#059669;">+ Add Member</a>` : ''}
      </div>`;

    if (members.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">👥</p><p>No members for this term.</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">`;
      for (const m of members) {
        html += `<div class="card" style="text-align:center;">
          <div style="width:64px;height:64px;border-radius:50%;background:#eef2ff;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;color:${P};overflow:hidden;">
            ${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((m.student_name||'?')[0])}
          </div>
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">${esc(m.student_name||'Unknown')}</h3>
          <div style="color:${P};font-weight:600;font-size:14px;margin:4px 0;">${esc(m.position_title)}</div>
          ${statusBadge(m.status)}
          ${m.manifesto ? `<p style="font-size:12px;color:${GRAY};margin:8px 0;">${esc(m.manifesto.slice(0,80))}${m.manifesto.length>80?'...':''}</p>` : ''}
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:center;">
            <a href="/school/student-council/members/${m.id}/edit" style="color:${P};font-size:13px;text-decoration:none;">Edit</a>
            <form method="POST" action="/school/student-council/members/${m.id}/remove" style="display:inline;" onsubmit="return confirm('Remove this member?')">
              <button style="color:#dc2626;font-size:13px;border:none;background:none;cursor:pointer;">Remove</button>
            </form>
          </div>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Members', html, req.session.user));
  }));

  app.get('/school/student-council/members/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const termId = req.query.term;
    const positions = await pool.query(`SELECT * FROM council_positions WHERE tenant_id = $1 ORDER BY precedence ASC`, [tid]);
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/members" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Add Council Member</h1>
      <form method="POST" action="/school/student-council/members" class="card">
        <input type="hidden" name="term_id" value="${esc(termId||'')}"/>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Student Name or ID *</label>
          <input type="text" name="student_name" required placeholder="Search student by name or ID"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Position *</label>
          <select name="position_id" required>
            <option value="">Select position...</option>
            ${positions.rows.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
          <input type="url" name="photo" placeholder="https://..."/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Manifesto / Bio</label>
          <textarea name="manifesto" rows="3" placeholder="Student's manifesto or bio..."></textarea>
        </div>
        <button type="submit" class="btn">Add Member</button>
      </form>
    </div>`;
    res.send(renderPage('Add Member', html, req.session.user));
  }));

  app.post('/school/student-council/members', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { term_id, student_name, position_id, photo, manifesto } = req.body;
    if (!term_id || !student_name || !position_id) return res.status(400).send('Term, student, and position are required');
    const studentResult = await pool.query(
      `SELECT id FROM users WHERE (name ILIKE $1 OR CAST(id AS TEXT) = $2) AND tenant_id = $3 LIMIT 1`,
      [`%${student_name}%`, student_name, tid]
    );
    if (!studentResult.rows[0]) return res.status(400).send('Student not found');
    await pool.query(
      `INSERT INTO council_members (tenant_id, position_id, term_id, student_id, photo, manifesto) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, parseInt(position_id), parseInt(term_id), studentResult.rows[0].id, photo || null, manifesto || null]
    );
    audit('council_member_added', { student_id: studentResult.rows[0].id, position_id }, req);
    res.redirect('/school/student-council/members?term=' + term_id);
  }));

  app.get('/school/student-council/members/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT cm.*, cp.title AS position_title FROM council_members cm JOIN council_positions cp ON cp.id = cm.position_id WHERE cm.id = $1 AND cm.tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Member not found');
    const m = result.rows[0];
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/members" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Edit Member</h1>
      <form method="POST" action="/school/student-council/members/${id}" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Status</label>
          <select name="status">
            <option value="active" ${m.status==='active'?'selected':''}>Active</option>
            <option value="inactive" ${m.status==='inactive'?'selected':''}>Inactive</option>
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
          <input type="url" name="photo" value="${esc(m.photo||'')}"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Manifesto / Bio</label>
          <textarea name="manifesto" rows="4">${esc(m.manifesto||'')}</textarea>
        </div>
        <button type="submit" class="btn">Update Member</button>
      </form>
    </div>`;
    res.send(renderPage('Edit Member', html, req.session.user));
  }));

  app.post('/school/student-council/members/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { status, photo, manifesto } = req.body;
    await pool.query(
      `UPDATE council_members SET status=$1, photo=$2, manifesto=$3 WHERE id=$4 AND tenant_id=$5`,
      [status || 'active', photo || null, manifesto || null, id, tid]
    );
    audit('council_member_updated', { id }, req);
    res.redirect('/school/student-council/members');
  }));

  app.post('/school/student-council/members/:id/remove', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`DELETE FROM council_members WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('council_member_removed', { id }, req);
    res.redirect('/school/student-council/members');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: ELECTIONS & CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/elections', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT ce.*, cp.title AS position_title, ct.label AS term_label
       FROM council_elections ce
       JOIN council_positions cp ON cp.id = ce.position_id
       JOIN council_terms ct ON ct.id = ce.term_id
       WHERE ce.tenant_id = $1 ORDER BY ce.created_at DESC`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Elections</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('elections')}</div>
      </div>
      <a href="/school/student-council/elections/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Create Election</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">🗳️</p><p>No elections yet.</p></div>`;
    } else {
      html += `<table><thead><tr><th>Title</th><th>Position</th><th>Term</th><th>Status</th><th>Voting Period</th><th>Actions</th></tr></thead><tbody>`;
      for (const e of result.rows) {
        html += `<tr>
          <td><a href="/school/student-council/elections/${e.id}" style="color:${P};font-weight:600;text-decoration:none;">${esc(e.title)}</a></td>
          <td>${esc(e.position_title)}</td>
          <td>${esc(e.term_label)}</td>
          <td>${statusBadge(e.status)}</td>
          <td style="font-size:12px;">${e.voting_start ? new Date(e.voting_start).toLocaleDateString() : 'TBD'} &mdash; ${e.voting_end ? new Date(e.voting_end).toLocaleDateString() : 'TBD'}</td>
          <td><a href="/school/student-council/elections/${e.id}" style="color:${P};font-size:13px;text-decoration:none;">View</a></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Elections', html, req.session.user));
  }));

  app.get('/school/student-council/elections/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const [positions, terms] = await Promise.all([
      pool.query(`SELECT * FROM council_positions WHERE tenant_id = $1 ORDER BY precedence`, [tid]),
      pool.query(`SELECT * FROM council_terms WHERE tenant_id = $1 ORDER BY term_start DESC`, [tid])
    ]);
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/student-council/elections" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Create Election</h1>
      <form method="POST" action="/school/student-council/elections" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Election Title *</label>
          <input type="text" name="title" required placeholder="e.g. Student Body President 2025"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Position *</label>
            <select name="position_id" required>
              <option value="">Select...</option>
              ${positions.rows.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Term *</label>
            <select name="term_id" required>
              <option value="">Select...</option>
              ${terms.rows.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3" placeholder="Describe this election..."></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Nomination Start</label>
            <input type="datetime-local" name="nomination_start"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Nomination End</label>
            <input type="datetime-local" name="nomination_end"/>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Voting Start</label>
            <input type="datetime-local" name="voting_start"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Voting End</label>
            <input type="datetime-local" name="voting_end"/>
          </div>
        </div>
        <button type="submit" class="btn">Create Election</button>
      </form>
    </div>`;
    res.send(renderPage('Create Election', html, req.session.user));
  }));

  app.post('/school/student-council/elections', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, position_id, term_id, description, nomination_start, nomination_end, voting_start, voting_end } = req.body;
    if (!title || !position_id || !term_id) return res.status(400).send('Title, position, and term are required');
    const result = await pool.query(
      `INSERT INTO council_elections (tenant_id, position_id, term_id, title, description, nomination_start, nomination_end, voting_start, voting_end, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid, parseInt(position_id), parseInt(term_id), title.trim(), description || null, nomination_start || null, nomination_end || null, voting_start || null, voting_end || null, uid]
    );
    audit('council_election_created', { election_id: result.rows[0].id, title }, req);
    res.redirect(`/school/student-council/elections/${result.rows[0].id}`);
  }));

  app.get('/school/student-council/elections/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;

    const elResult = await pool.query(
      `SELECT ce.*, cp.title AS position_title, ct.label AS term_label FROM council_elections ce JOIN council_positions cp ON cp.id = ce.position_id JOIN council_terms ct ON ct.id = ce.term_id WHERE ce.id = $1 AND ce.tenant_id = $2`,
      [id, tid]
    );
    if (!elResult.rows[0]) return res.status(404).send('Election not found');
    const el = elResult.rows[0];

    const candidates = await pool.query(
      `SELECT cc.*, u.name AS student_name FROM council_candidates cc LEFT JOIN users u ON u.id = cc.student_id WHERE cc.election_id = $1 AND cc.tenant_id = $2 ORDER BY cc.vote_count DESC`,
      [id, tid]
    );

    const hasVoted = await pool.query(
      `SELECT COUNT(*) AS c FROM council_votes WHERE election_id = $1 AND voter_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );
    const voted = parseInt(hasVoted.rows[0].c) > 0;

    let html = `${SKIP}<div style="max-width:900px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/student-council/elections" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back to Elections</a></div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px;">${esc(el.title)}</h1>
          <p style="color:${GRAY};margin:0;font-size:14px;">${esc(el.position_title)} &bull; ${esc(el.term_label)} &bull; ${esc(el.description||'')}</p>
        </div>
        ${statusBadge(el.status)}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
        <form method="POST" action="/school/student-council/elections/${id}/status" style="display:inline;">
          <input type="hidden" name="status" value="${el.status==='draft'?'nomination':el.status==='nomination'?'voting':el.status==='voting'?'closed':'draft'}"/>
          <button type="submit" class="btn" style="font-size:13px;">
            Advance to: ${esc((el.status==='draft'?'Nomination':el.status==='nomination'?'Voting':el.status==='voting'?'Closed':'Draft').toUpperCase())}
          </button>
        </form>
        ${el.status==='nomination'?`<a href="/school/student-council/elections/${id}/nominate" class="btn" style="text-decoration:none;background:#059669;">Nominate Yourself</a>`:''}
        ${el.status==='voting' && !voted?`<a href="/school/student-council/elections/${id}/vote" class="btn" style="text-decoration:none;background:#d97706;">Cast Vote</a>`:''}
        ${voted?`<span style="color:#059669;font-weight:600;padding:8px 16px;">You have voted</span>`:''}
      </div>

      <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:14px;">Candidates (${candidates.rows.length})</h2>`;
    if (candidates.rows.length === 0) {
      html += `<p style="color:${GRAY};">No candidates yet.</p>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;">`;
      for (const c of candidates.rows) {
        html += `<div class="card" style="border-top:3px solid ${P};">
          <div style="width:56px;height:56px;border-radius:50%;background:#eef2ff;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;color:${P};overflow:hidden;">
            ${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(c.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((c.student_name||'?')[0])}
          </div>
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;text-align:center;">${esc(c.student_name||'Unknown')}</h3>
          ${statusBadge(c.status)}
          <p style="font-size:13px;color:${GRAY};margin:8px 0;">${esc((c.manifesto||'No manifesto').slice(0,120))}${(c.manifesto||'').length>120?'...':''}</p>
          ${el.status==='closed'?`<div style="text-align:center;font-size:20px;font-weight:800;color:${P};">${c.vote_count} votes</div>`:''}
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    res.send(renderPage('Election: ' + el.title, html, req.session.user));
  }));

  app.post('/school/student-council/elections/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { status } = req.body;
    const valid = ['draft','nomination','voting','closed'];
    if (!valid.includes(status)) return res.status(400).send('Invalid status');
    await pool.query(`UPDATE council_elections SET status = $1 WHERE id = $2 AND tenant_id = $3`, [status, id, tid]);
    audit('council_election_status_changed', { id, status }, req);
    res.redirect(`/school/student-council/elections/${id}`);
  }));

  app.get('/school/student-council/elections/:id/nominate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const elResult = await pool.query(`SELECT * FROM council_elections WHERE id = $1 AND tenant_id = $2 AND status = 'nomination'`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found or not accepting nominations');
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/elections/${id}" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Nominate Yourself</h1>
      <form method="POST" action="/school/student-council/elections/${id}/nominate" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
          <input type="url" name="photo" placeholder="https://..."/>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Manifesto *</label>
          <textarea name="manifesto" rows="6" required placeholder="Why should students vote for you?"></textarea>
        </div>
        <button type="submit" class="btn">Submit Nomination</button>
      </form>
    </div>`;
    res.send(renderPage('Nominate', html, req.session.user));
  }));

  app.post('/school/student-council/elections/:id/nominate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { photo, manifesto } = req.body;
    if (!manifesto) return res.status(400).send('Manifesto is required');
    await pool.query(
      `INSERT INTO council_candidates (tenant_id, election_id, student_id, manifesto, photo) VALUES ($1,$2,$3,$4,$5)`,
      [tid, id, uid, manifesto.trim(), photo || null]
    );
    audit('council_nomination_submitted', { election_id: id, student_id: uid }, req);
    res.redirect(`/school/student-council/elections/${id}`);
  }));

  app.get('/school/student-council/elections/:id/vote', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const elResult = await pool.query(`SELECT * FROM council_elections WHERE id = $1 AND tenant_id = $2 AND status = 'voting'`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found or not in voting phase');
    const candidates = await pool.query(
      `SELECT cc.*, u.name AS student_name FROM council_candidates cc LEFT JOIN users u ON u.id = cc.student_id WHERE cc.election_id = $1 AND cc.tenant_id = $2 AND cc.status = 'nominated'`,
      [id, tid]
    );
    if (candidates.rows.length === 0) return res.status(400).send('No candidates available');
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/student-council/elections/${id}" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Cast Your Vote</h1>
      <form method="POST" action="/school/student-council/elections/${id}/vote" class="card">
        <p style="color:${GRAY};margin-bottom:16px;">Select one candidate:</p>
        ${candidates.rows.map(c => `
          <label style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;cursor:pointer;">
            <input type="radio" name="candidate_id" value="${c.id}" required style="width:auto;"/>
            <div style="flex:1;">
              <strong style="color:#111827;">${esc(c.student_name||'Candidate')}</strong>
              <p style="font-size:13px;color:${GRAY};margin:4px 0 0;">${esc((c.manifesto||'').slice(0,100))}</p>
            </div>
          </label>
        `).join('')}
        <button type="submit" class="btn" style="margin-top:12px;">Submit Vote</button>
      </form>
    </div>`;
    res.send(renderPage('Vote', html, req.session.user));
  }));

  app.post('/school/student-council/elections/:id/vote', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { candidate_id } = req.body;
    if (!candidate_id) return res.status(400).send('Please select a candidate');
    const existing = await pool.query(
      `SELECT COUNT(*) AS c FROM council_votes WHERE election_id = $1 AND voter_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );
    if (parseInt(existing.rows[0].c) > 0) return res.status(400).send('You have already voted');
    await pool.query(`BEGIN`);
    try {
      await pool.query(
        `INSERT INTO council_votes (tenant_id, election_id, voter_id, candidate_id) VALUES ($1,$2,$3,$4)`,
        [tid, id, uid, parseInt(candidate_id)]
      );
      await pool.query(
        `UPDATE council_candidates SET vote_count = vote_count + 1 WHERE id = $1 AND tenant_id = $2`,
        [parseInt(candidate_id), tid]
      );
      await pool.query(`COMMIT`);
    } catch(e) {
      await pool.query(`ROLLBACK`);
      throw e;
    }
    audit('council_vote_cast', { election_id: id, candidate_id }, req);
    res.redirect(`/school/student-council/elections/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: MEETINGS & MINUTES
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/meetings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT * FROM council_meetings WHERE tenant_id = $1 ORDER BY meeting_date DESC`, [tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Meetings</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('meetings')}</div>
      </div>
      <a href="/school/student-council/meetings/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Schedule Meeting</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">📅</p><p>No meetings scheduled.</p></div>`;
    } else {
      html += `<table><thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Venue</th><th>Status</th><th>Minutes</th><th>Actions</th></tr></thead><tbody>`;
      for (const m of result.rows) {
        html += `<tr>
          <td><a href="/school/student-council/meetings/${m.id}" style="color:${P};font-weight:600;text-decoration:none;">${esc(m.title)}</a></td>
          <td>${new Date(m.meeting_date).toLocaleDateString()}</td>
          <td>${m.meeting_time || '-'}</td>
          <td>${esc(m.venue||'-')}</td>
          <td>${statusBadge(m.status)}</td>
          <td>${m.minutes ? '<span style="color:#059669;font-weight:600;">Yes</span>' : '<span style="color:#d97706;">Pending</span>'}</td>
          <td><a href="/school/student-council/meetings/${m.id}" style="color:${P};font-size:13px;text-decoration:none;">View</a></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Meetings', html, req.session.user));
  }));

  app.get('/school/student-council/meetings/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/student-council/meetings" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Schedule Meeting</h1>
      <form method="POST" action="/school/student-council/meetings" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. Monthly Council Meeting"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Date *</label>
            <input type="date" name="meeting_date" required/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Time</label>
            <input type="time" name="meeting_time"/>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Venue</label>
          <input type="text" name="venue" placeholder="e.g. Council Chamber"/>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Agenda</label>
          <textarea name="agenda" rows="5" placeholder="Meeting agenda items..."></textarea>
        </div>
        <button type="submit" class="btn">Schedule Meeting</button>
      </form>
    </div>`;
    res.send(renderPage('Schedule Meeting', html, req.session.user));
  }));

  app.post('/school/student-council/meetings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, meeting_date, meeting_time, venue, agenda } = req.body;
    if (!title || !meeting_date) return res.status(400).send('Title and date are required');
    const result = await pool.query(
      `INSERT INTO council_meetings (tenant_id, title, meeting_date, meeting_time, venue, agenda, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tid, title.trim(), meeting_date, meeting_time || null, venue || null, agenda || null, uid]
    );
    audit('council_meeting_created', { id: result.rows[0].id, title }, req);
    res.redirect('/school/student-council/meetings');
  }));

  app.get('/school/student-council/meetings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT cm.*, u.name AS organizer_name FROM council_meetings cm LEFT JOIN users u ON u.id = cm.created_by WHERE cm.id = $1 AND cm.tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Meeting not found');
    const m = result.rows[0];

    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/student-council/meetings" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a></div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px;">${esc(m.title)}</h1>
          <p style="color:${GRAY};margin:0;">${new Date(m.meeting_date).toLocaleDateString()} ${m.meeting_time ? 'at ' + m.meeting_time : ''} &bull; ${esc(m.venue||'TBD')} &bull; By ${esc(m.organizer_name||'Unknown')}</p>
        </div>
        ${statusBadge(m.status)}
      </div>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 10px;">Agenda</h3>
        <pre style="white-space:pre-wrap;font-family:inherit;color:#374151;font-size:14px;">${esc(m.agenda||'No agenda set')}</pre>
      </div>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 10px;">Minutes</h3>
        ${m.minutes ? `<pre style="white-space:pre-wrap;font-family:inherit;color:#374151;font-size:14px;">${esc(m.minutes)}</pre>` :
          `<form method="POST" action="/school/student-council/meetings/${id}/minutes" class="card" style="box-shadow:none;padding:0;">
            <textarea name="minutes" rows="8" placeholder="Enter meeting minutes..." style="margin-bottom:12px;"></textarea>
            <button type="submit" class="btn">Save Minutes</button>
          </form>`}
      </div>

      <form method="POST" action="/school/student-council/meetings/${id}/status" style="margin-top:12px;">
        <input type="hidden" name="status" value="${m.status==='scheduled'?'completed':'scheduled'}"/>
        <button type="submit" class="btn" style="font-size:13px;">
          Mark as ${m.status==='scheduled'?'Completed':'Scheduled'}
        </button>
      </form>
    </div>`;
    res.send(renderPage('Meeting: ' + m.title, html, req.session.user));
  }));

  app.post('/school/student-council/meetings/:id/minutes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { minutes } = req.body;
    await pool.query(`UPDATE council_meetings SET minutes = $1 WHERE id = $2 AND tenant_id = $3`, [minutes || null, id, tid]);
    audit('council_minutes_saved', { id }, req);
    res.redirect(`/school/student-council/meetings/${id}`);
  }));

  app.post('/school/student-council/meetings/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { status } = req.body;
    if (!['scheduled','completed','cancelled'].includes(status)) return res.status(400).send('Invalid status');
    await pool.query(`UPDATE council_meetings SET status = $1 WHERE id = $2 AND tenant_id = $3`, [status, id, tid]);
    res.redirect(`/school/student-council/meetings/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: PROPOSALS
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/proposals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT cp.*, u.name AS proposer_name FROM council_proposals cp LEFT JOIN users u ON u.id = cp.proposer_id WHERE cp.tenant_id = $1 ORDER BY cp.created_at DESC`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Proposals</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('proposals')}</div>
      </div>
      <a href="/school/student-council/proposals/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Submit Proposal</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">📋</p><p>No proposals yet.</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">`;
      for (const p of result.rows) {
        html += `<div class="card" style="border-left:4px solid ${P};">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;"><a href="/school/student-council/proposals/${p.id}" style="color:#111827;text-decoration:none;">${esc(p.title)}</a></h3>
            ${statusBadge(p.status)}
          </div>
          <p style="font-size:13px;color:${GRAY};margin:6px 0;">${esc((p.description||'').slice(0,120))}${(p.description||'').length>120?'...':''}</p>
          <div style="font-size:12px;color:${GRAY};">By ${esc(p.proposer_name||'Unknown')} &bull; ${p.category ? esc(p.category) : 'General'}</div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:13px;">
            <span style="color:#059669;font-weight:600;">For: ${p.votes_for}</span>
            <span style="color:#dc2626;font-weight:600;">Against: ${p.votes_against}</span>
          </div>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Proposals', html, req.session.user));
  }));

  app.get('/school/student-council/proposals/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/student-council/proposals" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Submit Proposal</h1>
      <form method="POST" action="/school/student-council/proposals" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. Improve Cafeteria Menu Options"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Category</label>
          <select name="category">
            <option value="academic">Academic</option>
            <option value="facilities">Facilities</option>
            <option value="events">Events</option>
            <option value="policy">Policy</option>
            <option value="welfare">Student Welfare</option>
            <option value="finance">Finance</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description *</label>
          <textarea name="description" rows="6" required placeholder="Describe your proposal in detail..."></textarea>
        </div>
        <button type="submit" class="btn">Submit Proposal</button>
      </form>
    </div>`;
    res.send(renderPage('Submit Proposal', html, req.session.user));
  }));

  app.post('/school/student-council/proposals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, category, description } = req.body;
    if (!title || !description) return res.status(400).send('Title and description are required');
    const result = await pool.query(
      `INSERT INTO council_proposals (tenant_id, proposer_id, title, description, category) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, uid, title.trim(), description.trim(), category || 'other']
    );
    audit('council_proposal_submitted', { id: result.rows[0].id, title }, req);
    res.redirect('/school/student-council/proposals');
  }));

  app.get('/school/student-council/proposals/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT cp.*, u.name AS proposer_name FROM council_proposals cp LEFT JOIN users u ON u.id = cp.proposer_id WHERE cp.id = $1 AND cp.tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Proposal not found');
    const p = result.rows[0];

    const userVote = await pool.query(
      `SELECT vote FROM council_proposal_votes WHERE proposal_id = $1 AND voter_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );

    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/student-council/proposals" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a></div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px;">${esc(p.title)}</h1>
          <p style="color:${GRAY};margin:0;">By ${esc(p.proposer_name||'Unknown')} &bull; ${esc(p.category||'General')} &bull; ${new Date(p.created_at).toLocaleDateString()}</p>
        </div>
        ${statusBadge(p.status)}
      </div>

      <div class="card">
        <pre style="white-space:pre-wrap;font-family:inherit;color:#374151;font-size:14px;line-height:1.6;">${esc(p.description||'')}</pre>
      </div>

      <div style="display:flex;gap:16px;margin:16px 0;padding:16px;background:#f9fafb;border-radius:10px;">
        <div style="flex:1;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#059669;">${p.votes_for}</div>
          <div style="font-size:13px;color:${GRAY};">For</div>
        </div>
        <div style="flex:1;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#dc2626;">${p.votes_against}</div>
          <div style="font-size:13px;color:${GRAY};">Against</div>
        </div>
      </div>

      ${p.status === 'open' && userVote.rows.length === 0 ? `
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px;">Vote on this Proposal</h3>
          <form method="POST" action="/school/student-council/proposals/${id}/vote" style="display:flex;gap:12px;">
            <button type="submit" name="vote" value="for" class="btn" style="background:#059669;flex:1;">Vote For</button>
            <button type="submit" name="vote" value="against" class="btn" style="background:#dc2626;flex:1;">Vote Against</button>
          </form>
        </div>
      ` : userVote.rows.length > 0 ? `<p style="color:#059669;font-weight:600;">You voted: ${userVote.rows[0].vote.toUpperCase()}</p>` : ''}

      ${p.status === 'open' ? `
        <div style="margin-top:16px;display:flex;gap:10px;">
          <form method="POST" action="/school/student-council/proposals/${id}/resolve" style="display:inline;">
            <input type="hidden" name="status" value="approved"/>
            <button type="submit" class="btn" style="background:#059669;font-size:13px;">Approve</button>
          </form>
          <form method="POST" action="/school/student-council/proposals/${id}/resolve" style="display:inline;">
            <input type="hidden" name="status" value="rejected"/>
            <button type="submit" class="btn" style="background:#dc2626;font-size:13px;">Reject</button>
          </form>
        </div>
      ` : ''}
    </div>`;
    res.send(renderPage('Proposal: ' + p.title, html, req.session.user));
  }));

  app.post('/school/student-council/proposals/:id/vote', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { vote } = req.body;
    if (!['for','against'].includes(vote)) return res.status(400).send('Invalid vote');
    await pool.query(`BEGIN`);
    try {
      await pool.query(
        `INSERT INTO council_proposal_votes (tenant_id, proposal_id, voter_id, vote) VALUES ($1,$2,$3,$4)`,
        [tid, id, uid, vote]
      );
      const col = vote === 'for' ? 'votes_for' : 'votes_against';
      await pool.query(
        `UPDATE council_proposals SET ${col} = ${col} + 1 WHERE id = $1 AND tenant_id = $2`,
        [id, tid]
      );
      await pool.query(`COMMIT`);
    } catch(e) {
      await pool.query(`ROLLBACK`);
      throw e;
    }
    audit('council_proposal_voted', { proposal_id: id, vote }, req);
    res.redirect(`/school/student-council/proposals/${id}`);
  }));

  app.post('/school/student-council/proposals/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { status } = req.body;
    if (!['approved','rejected'].includes(status)) return res.status(400).send('Invalid status');
    await pool.query(
      `UPDATE council_proposals SET status = $1, resolved_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [status, id, tid]
    );
    audit('council_proposal_resolved', { id, status }, req);
    res.redirect(`/school/student-council/proposals/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: BUDGET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const terms = await pool.query(`SELECT * FROM council_terms WHERE tenant_id = $1 ORDER BY term_start DESC`, [tid]);
    const activeTerm = terms.rows.find(t => t.status === 'active') || terms.rows[0];
    const termId = req.query.term || (activeTerm ? activeTerm.id : null);

    let budgets = [];
    let totalAllocated = 0;
    let totalSpent = 0;
    if (termId) {
      const budgetResult = await pool.query(
        `SELECT * FROM council_budget WHERE tenant_id = $1 AND term_id = $2 ORDER BY category`,
        [tid, termId]
      );
      budgets = budgetResult.rows;
      for (const b of budgets) {
        totalAllocated += Number(b.allocated || 0);
        totalSpent += Number(b.spent || 0);
      }
    }

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Budget Management</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('budget')}</div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <label style="font-weight:600;color:#374151;">Term:</label>
        <select onchange="location.href='/school/student-council/budget?term='+this.value" style="width:auto;">
          ${terms.rows.map(t => `<option value="${t.id}" ${t.id === parseInt(termId) ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
        ${termId ? `<a href="/school/student-council/budget/new?term=${termId}" class="btn" style="text-decoration:none;background:#059669;">+ Budget Line</a>` : ''}
      </div>

      <div style="display:flex;gap:14px;margin-bottom:20px;">
        ${statCard('Total Allocated', '$' + totalAllocated.toFixed(2))}
        ${statCard('Total Spent', '$' + totalSpent.toFixed(2), '#fef2f2')}
        ${statCard('Remaining', '$' + (totalAllocated - totalSpent).toFixed(2), '#ecfdf5')}
      </div>

      ${termId ? `
      <table><thead><tr><th>Category</th><th>Allocated</th><th>Spent</th><th>Remaining</th><th>Usage</th><th>Actions</th></tr></thead><tbody>
        ${budgets.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:${GRAY};">No budget lines for this term.</td></tr>` :
          budgets.map(b => {
            const pct = Number(b.allocated) > 0 ? Math.min(100, (Number(b.spent) / Number(b.allocated)) * 100) : 0;
            const barColor = pct > 90 ? '#dc2626' : pct > 70 ? '#d97706' : '#059669';
            return `<tr>
              <td style="font-weight:600;">${esc(b.category)}</td>
              <td>$${Number(b.allocated).toFixed(2)}</td>
              <td>$${Number(b.spent).toFixed(2)}</td>
              <td>$${(Number(b.allocated) - Number(b.spent)).toFixed(2)}</td>
              <td><div style="background:#e5e7eb;border-radius:4px;height:8px;width:100px;"><div style="background:${barColor};border-radius:4px;height:8px;width:${pct}%;"></div></div> ${pct.toFixed(0)}%</td>
              <td><a href="/school/student-council/budget/${b.id}" style="color:${P};font-size:13px;text-decoration:none;">Details</a></td>
            </tr>`;
          }).join('')}
      </tbody></table>` : ''}
    </div>`;
    res.send(renderPage('Budget Management', html, req.session.user));
  }));

  app.get('/school/student-council/budget/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const termId = req.query.term;
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/budget" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Add Budget Line</h1>
      <form method="POST" action="/school/student-council/budget" class="card">
        <input type="hidden" name="term_id" value="${esc(termId||'')}"/>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Category *</label>
          <input type="text" name="category" required placeholder="e.g. Events, Sports, Welfare"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Allocated Amount *</label>
          <input type="number" name="allocated" step="0.01" min="0" required placeholder="0.00"/>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3" placeholder="Budget description..."></textarea>
        </div>
        <button type="submit" class="btn">Create Budget Line</button>
      </form>
    </div>`;
    res.send(renderPage('Add Budget Line', html, req.session.user));
  }));

  app.post('/school/student-council/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { term_id, category, allocated, description } = req.body;
    if (!term_id || !category) return res.status(400).send('Term and category are required');
    await pool.query(
      `INSERT INTO council_budget (tenant_id, term_id, category, allocated, description) VALUES ($1,$2,$3,$4,$5)`,
      [tid, parseInt(term_id), category.trim(), parseFloat(allocated) || 0, description || null]
    );
    audit('council_budget_created', { category }, req);
    res.redirect('/school/student-council/budget?term=' + term_id);
  }));

  app.get('/school/student-council/budget/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const budget = await pool.query(`SELECT cb.*, ct.label AS term_label FROM council_budget cb JOIN council_terms ct ON ct.id = cb.term_id WHERE cb.id = $1 AND cb.tenant_id = $2`, [id, tid]);
    if (!budget.rows[0]) return res.status(404).send('Budget line not found');
    const b = budget.rows[0];

    const transactions = await pool.query(
      `SELECT bt.*, u.name AS approver_name FROM council_budget_transactions bt LEFT JOIN users u ON u.id = bt.approved_by WHERE bt.budget_id = $1 AND bt.tenant_id = $2 ORDER BY bt.created_at DESC`,
      [id, tid]
    );

    let html = `${SKIP}<div style="max-width:900px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/student-council/budget" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a></div>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 6px;">${esc(b.category)}</h1>
      <p style="color:${GRAY};">${esc(b.term_label)} &bull; Allocated: $${Number(b.allocated).toFixed(2)} &bull; Spent: $${Number(b.spent).toFixed(2)}</p>

      <div style="margin:20px 0;">
        <a href="/school/student-council/budget/${id}/transaction/new" class="btn" style="text-decoration:none;background:#d97706;">+ Record Transaction</a>
      </div>

      <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:12px;">Transactions</h2>`;
    if (transactions.rows.length === 0) {
      html += `<p style="color:${GRAY};">No transactions recorded.</p>`;
    } else {
      html += `<table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th></tr></thead><tbody>`;
      for (const t of transactions.rows) {
        const amountColor = t.transaction_type === 'income' ? '#059669' : '#dc2626';
        html += `<tr>
          <td>${new Date(t.created_at).toLocaleDateString()}</td>
          <td>${esc(t.description)}</td>
          <td>${statusBadge(t.transaction_type)}</td>
          <td style="color:${amountColor};font-weight:700;">${t.transaction_type === 'income' ? '+' : '-'}$${Number(t.amount).toFixed(2)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Budget: ' + b.category, html, req.session.user));
  }));

  app.get('/school/student-council/budget/:id/transaction/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { id } = req.params;
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/budget/${id}" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Record Transaction</h1>
      <form method="POST" action="/school/student-council/budget/${id}/transaction" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Type</label>
          <select name="transaction_type">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description *</label>
          <input type="text" name="description" required placeholder="What was this transaction for?"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Amount *</label>
          <input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00"/>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Receipt URL</label>
          <input type="url" name="receipt_url" placeholder="https://..."/>
        </div>
        <button type="submit" class="btn">Record Transaction</button>
      </form>
    </div>`;
    res.send(renderPage('Record Transaction', html, req.session.user));
  }));

  app.post('/school/student-council/budget/:id/transaction', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { transaction_type, description, amount, receipt_url } = req.body;
    if (!description || !amount) return res.status(400).send('Description and amount are required');
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).send('Invalid amount');
    await pool.query(`BEGIN`);
    try {
      await pool.query(
        `INSERT INTO council_budget_transactions (tenant_id, budget_id, description, amount, transaction_type, receipt_url, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, id, description.trim(), amt, transaction_type || 'expense', receipt_url || null, uid]
      );
      if (transaction_type === 'expense') {
        await pool.query(`UPDATE council_budget SET spent = spent + $1 WHERE id = $2 AND tenant_id = $3`, [amt, id, tid]);
      } else {
        await pool.query(`UPDATE council_budget SET allocated = allocated + $1 WHERE id = $2 AND tenant_id = $3`, [amt, id, tid]);
      }
      await pool.query(`COMMIT`);
    } catch(e) {
      await pool.query(`ROLLBACK`);
      throw e;
    }
    audit('council_budget_transaction', { budget_id: id, amount: amt, type: transaction_type }, req);
    res.redirect(`/school/student-council/budget/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: COMMUNITY SERVICE
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/community-service', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT cs.*, u.name AS coordinator_name FROM council_community_service cs LEFT JOIN users u ON u.id = cs.coordinator_id WHERE cs.tenant_id = $1 ORDER BY cs.event_date DESC NULLS LAST`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Community Service</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('community-service')}</div>
      </div>
      <a href="/school/student-council/community-service/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Log Service Activity</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">🤝</p><p>No community service activities recorded.</p></div>`;
    } else {
      html += `<table><thead><tr><th>Title</th><th>Date</th><th>Category</th><th>Hours</th><th>Participants</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
      for (const s of result.rows) {
        const parts = Array.isArray(s.participant_ids) ? s.participant_ids : JSON.parse(s.participant_ids || '[]');
        html += `<tr>
          <td><a href="/school/student-council/community-service/${s.id}" style="color:${P};font-weight:600;text-decoration:none;">${esc(s.title)}</a></td>
          <td>${s.event_date ? new Date(s.event_date).toLocaleDateString() : '-'}</td>
          <td>${esc(s.category||'-')}</td>
          <td style="font-weight:700;">${Number(s.hours_contributed).toFixed(1)}</td>
          <td>${parts.length}</td>
          <td>${statusBadge(s.status)}</td>
          <td><a href="/school/student-council/community-service/${s.id}" style="color:${P};font-size:13px;text-decoration:none;">View</a></td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Community Service', html, req.session.user));
  }));

  app.get('/school/student-council/community-service/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:700px;margin:0 auto;">
      <a href="/school/student-council/community-service" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Log Service Activity</h1>
      <form method="POST" action="/school/student-council/community-service" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. Park Cleanup Drive"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Date</label>
            <input type="date" name="event_date"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Hours Contributed</label>
            <input type="number" name="hours_contributed" step="0.1" min="0" value="0"/>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Venue</label>
            <input type="text" name="venue" placeholder="Location"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Category</label>
            <select name="category">
              <option value="environment">Environment</option>
              <option value="education">Education</option>
              <option value="health">Health</option>
              <option value="social">Social Welfare</option>
              <option value="fundraising">Fundraising</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="4" placeholder="Describe the service activity..."></textarea>
        </div>
        <button type="submit" class="btn">Log Activity</button>
      </form>
    </div>`;
    res.send(renderPage('Log Service', html, req.session.user));
  }));

  app.post('/school/student-council/community-service', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, description, event_date, venue, category, hours_contributed } = req.body;
    if (!title) return res.status(400).send('Title is required');
    await pool.query(
      `INSERT INTO council_community_service (tenant_id, title, description, event_date, venue, category, hours_contributed, coordinator_id, participant_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, title.trim(), description || null, event_date || null, venue || null, category || 'other', parseFloat(hours_contributed) || 0, uid, JSON.stringify([uid])]
    );
    audit('council_service_logged', { title }, req);
    res.redirect('/school/student-council/community-service');
  }));

  app.get('/school/student-council/community-service/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM council_community_service WHERE id = $1 AND tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Activity not found');
    const s = result.rows[0];
    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <div style="margin-bottom:20px;"><a href="/school/student-council/community-service" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a></div>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 8px;">${esc(s.title)}</h1>
      <p style="color:${GRAY};">${s.event_date ? new Date(s.event_date).toLocaleDateString() : 'TBD'} &bull; ${esc(s.venue||'TBD')} &bull; ${esc(s.category||'')} &bull; ${Number(s.hours_contributed).toFixed(1)} hours</p>
      <div style="margin:8px 0;">${statusBadge(s.status)}</div>
      <div class="card" style="margin-top:16px;">
        <pre style="white-space:pre-wrap;font-family:inherit;color:#374151;font-size:14px;">${esc(s.description||'No description')}</pre>
      </div>
    </div>`;
    res.send(renderPage('Service: ' + s.title, html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: ACHIEVEMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/achievements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT ca.*, u.name AS awarded_to_name FROM council_achievements ca LEFT JOIN users u ON u.id = ca.awarded_to WHERE ca.tenant_id = $1 ORDER BY ca.achievement_date DESC NULLS LAST, ca.created_at DESC`,
      [tid]
    );

    let html = `${SKIP}<div style="max-width:1000px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Achievement Records</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('achievements')}</div>
      </div>
      <a href="/school/student-council/achievements/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;">+ Record Achievement</a>`;

    if (result.rows.length === 0) {
      html += `<div style="text-align:center;padding:60px;color:${GRAY};"><p style="font-size:40px;margin-bottom:12px;">🏆</p><p>No achievements recorded yet.</p></div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;">`;
      for (const a of result.rows) {
        html += `<div class="card" style="border-top:3px solid #d97706;">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
            <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">${esc(a.title)}</h3>
            ${a.category ? `<span style="font-size:11px;color:#fff;background:${P};padding:2px 8px;border-radius:4px;">${esc(a.category)}</span>` : ''}
          </div>
          <p style="font-size:13px;color:${GRAY};margin:6px 0;">${esc((a.description||'').slice(0,100))}${(a.description||'').length>100?'...':''}</p>
          <div style="font-size:12px;color:${GRAY};">${a.achievement_date ? new Date(a.achievement_date).toLocaleDateString() : ''} ${a.awarded_to_name ? '&bull; ' + esc(a.awarded_to_name) : ''}</div>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    res.send(renderPage('Achievements', html, req.session.user));
  }));

  app.get('/school/student-council/achievements/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/achievements" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Record Achievement</h1>
      <form method="POST" action="/school/student-council/achievements" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. Best Student Council Award 2025"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Date</label>
            <input type="date" name="achievement_date"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Category</label>
            <select name="category">
              <option value="academic">Academic</option>
              <option value="leadership">Leadership</option>
              <option value="service">Service</option>
              <option value="sports">Sports</option>
              <option value="arts">Arts</option>
              <option value="innovation">Innovation</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Awarded To (Student Name or ID)</label>
          <input type="text" name="awarded_to_name" placeholder="Leave blank for council-wide"/>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="4" placeholder="Describe the achievement..."></textarea>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Certificate URL</label>
          <input type="url" name="certificate_url" placeholder="https://..."/>
        </div>
        <button type="submit" class="btn">Record Achievement</button>
      </form>
    </div>`;
    res.send(renderPage('Record Achievement', html, req.session.user));
  }));

  app.post('/school/student-council/achievements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, description, achievement_date, category, awarded_to_name, certificate_url } = req.body;
    if (!title) return res.status(400).send('Title is required');
    let awardedTo = null;
    if (awarded_to_name && awarded_to_name.trim()) {
      const studentResult = await pool.query(
        `SELECT id FROM users WHERE (name ILIKE $1 OR CAST(id AS TEXT) = $2) AND tenant_id = $3 LIMIT 1`,
        [`%${awarded_to_name}%`, awarded_to_name, tid]
      );
      if (studentResult.rows[0]) awardedTo = studentResult.rows[0].id;
    }
    await pool.query(
      `INSERT INTO council_achievements (tenant_id, title, description, achievement_date, category, awarded_to, certificate_url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, title.trim(), description || null, achievement_date || null, category || 'other', awardedTo, certificate_url || null, uid]
    );
    audit('council_achievement_recorded', { title }, req);
    res.redirect('/school/student-council/achievements');
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: REPORTS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;

    const [totalMeetings, completedMeetings, totalProposals, approvedProposals, totalElections, closedElections,
           totalService, serviceHours, totalBudget, spentBudget, totalMembers, totalAchievements] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS c FROM council_meetings WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_meetings WHERE tenant_id = $1 AND status = 'completed'`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_proposals WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_proposals WHERE tenant_id = $1 AND status = 'approved'`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_elections WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_elections WHERE tenant_id = $1 AND status = 'closed'`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_community_service WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(hours_contributed),0) AS total FROM council_community_service WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(allocated),0) AS total FROM council_budget WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(spent),0) AS total FROM council_budget WHERE tenant_id = $1`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_members cm JOIN council_terms ct ON ct.id = cm.term_id WHERE cm.tenant_id = $1 AND cm.status = 'active' AND ct.status IN ('active','upcoming')`, [tid]),
      pool.query(`SELECT COUNT(*) AS c FROM council_achievements WHERE tenant_id = $1`, [tid])
    ]);

    const proposalByCategory = await pool.query(
      `SELECT category, COUNT(*) AS c FROM council_proposals WHERE tenant_id = $1 GROUP BY category ORDER BY c DESC`, [tid]
    );
    const serviceByCategory = await pool.query(
      `SELECT category, COUNT(*) AS c, SUM(hours_contributed) AS hrs FROM council_community_service WHERE tenant_id = $1 GROUP BY category ORDER BY hrs DESC`, [tid]
    );
    const meetingsByMonth = await pool.query(
      `SELECT TO_CHAR(meeting_date, 'YYYY-MM') AS month, COUNT(*) AS c FROM council_meetings WHERE tenant_id = $1 AND meeting_date IS NOT NULL GROUP BY TO_CHAR(meeting_date, 'YYYY-MM') ORDER BY month DESC LIMIT 12`, [tid]
    );
    const topVotedProposals = await pool.query(
      `SELECT cp.*, u.name AS proposer_name FROM council_proposals cp LEFT JOIN users u ON u.id = cp.proposer_id WHERE cp.tenant_id = $1 ORDER BY (cp.votes_for + cp.votes_against) DESC LIMIT 5`, [tid]
    );

    let html = `${SKIP}<div style="max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Council Reports</h1>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${pageNav('reports')}</div>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
        ${statCard('Total Members', totalMembers.rows[0].c)}
        ${statCard('Meetings Held', completedMeetings.rows[0].c + '/' + totalMeetings.rows[0].c)}
        ${statCard('Proposals', approvedProposals.rows[0].c + '/' + totalProposals.rows[0].c + ' approved')}
        ${statCard('Elections', closedElections.rows[0].c + '/' + totalElections.rows[0].c + ' closed')}
        ${statCard('Service Hours', Number(serviceHours.rows[0].total).toFixed(1), '#fef3c7')}
        ${statCard('Budget Used', '$' + Number(spentBudget.rows[0].total).toFixed(0) + ' / $' + Number(totalBudget.rows[0].total).toFixed(0), '#ecfdf5')}
        ${statCard('Achievements', totalAchievements.rows[0].c, '#fef3c7')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Proposals by Category</h3>
          ${proposalByCategory.rows.length === 0 ? `<p style="color:${GRAY};">No data.</p>` :
            proposalByCategory.rows.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">
              <span style="color:#374151;">${esc(r.category || 'Uncategorized')}</span>
              <span style="font-weight:700;color:${P};">${r.c}</span>
            </div>`).join('')}
        </div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Service by Category</h3>
          ${serviceByCategory.rows.length === 0 ? `<p style="color:${GRAY};">No data.</p>` :
            serviceByCategory.rows.map(r => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">
              <span style="color:#374151;">${esc(r.category || 'Other')}</span>
              <span style="font-weight:700;color:${P};">${Number(r.hrs).toFixed(1)} hrs (${r.c} activities)</span>
            </div>`).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Monthly Meeting Activity</h3>
          ${meetingsByMonth.rows.length === 0 ? `<p style="color:${GRAY};">No data.</p>` :
            meetingsByMonth.rows.map(m => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">
              <span style="color:#374151;">${esc(m.month)}</span>
              <span style="font-weight:700;color:${P};">${m.c} meetings</span>
            </div>`).join('')}
        </div>
        <div class="card">
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Most Discussed Proposals</h3>
          ${topVotedProposals.rows.length === 0 ? `<p style="color:${GRAY};">No data.</p>` :
            topVotedProposals.rows.map(p => `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;">
              <a href="/school/student-council/proposals/${p.id}" style="font-weight:600;color:#111827;text-decoration:none;">${esc(p.title)}</a>
              <div style="font-size:12px;color:${GRAY};"><span style="color:#059669;">${p.votes_for} for</span> / <span style="color:#dc2626;">${p.votes_against} against</span></div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px;">Quick Summary</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
          <div style="background:#f0fdf4;border-radius:8px;padding:12px;">
            <div style="font-size:12px;color:${GRAY};">Meeting Completion Rate</div>
            <div style="font-size:18px;font-weight:800;color:#059669;">${totalMeetings.rows[0].c > 0 ? Math.round((completedMeetings.rows[0].c / totalMeetings.rows[0].c) * 100) : 0}%</div>
          </div>
          <div style="background:#eff6ff;border-radius:8px;padding:12px;">
            <div style="font-size:12px;color:${GRAY};">Proposal Approval Rate</div>
            <div style="font-size:18px;font-weight:800;color:${P};">${totalProposals.rows[0].c > 0 ? Math.round((approvedProposals.rows[0].c / totalProposals.rows[0].c) * 100) : 0}%</div>
          </div>
          <div style="background:#fefce8;border-radius:8px;padding:12px;">
            <div style="font-size:12px;color:${GRAY};">Budget Utilization</div>
            <div style="font-size:18px;font-weight:800;color:#d97706;">${Number(totalBudget.rows[0].total) > 0 ? Math.round((Number(spentBudget.rows[0].total) / Number(totalBudget.rows[0].total)) * 100) : 0}%</div>
          </div>
          <div style="background:#fdf2f8;border-radius:8px;padding:12px;">
            <div style="font-size:12px;color:${GRAY};">Total Service Activities</div>
            <div style="font-size:18px;font-weight:800;color:#ec4899;">${totalService.rows[0].c}</div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Council Reports', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // TERM MANAGEMENT (Admin utility)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/student-council/terms', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const terms = await pool.query(`SELECT * FROM council_terms WHERE tenant_id = $1 ORDER BY term_start DESC`, [tid]);
    let html = `${SKIP}<div style="max-width:800px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Manage Terms</h1>
        <a href="/school/student-council" style="color:${P};text-decoration:none;">&larr; Dashboard</a>
      </div>
      <a href="/school/student-council/terms/new" class="btn" style="text-decoration:none;display:inline-block;margin-bottom:20px;background:#059669;">+ Create Term</a>`;

    if (terms.rows.length === 0) {
      html += `<p style="color:${GRAY};">No terms defined. Create one to start managing council.</p>`;
    } else {
      html += `<table><thead><tr><th>Label</th><th>Start</th><th>End</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
      for (const t of terms.rows) {
        html += `<tr>
          <td style="font-weight:600;">${esc(t.label)}</td>
          <td>${new Date(t.term_start).toLocaleDateString()}</td>
          <td>${new Date(t.term_end).toLocaleDateString()}</td>
          <td>${statusBadge(t.status)}</td>
          <td>
            <form method="POST" action="/school/student-council/terms/${t.id}/activate" style="display:inline;">
              <button type="submit" class="btn" style="font-size:12px;padding:4px 10px;background:#059669;">Activate</button>
            </form>
          </td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
    res.send(renderPage('Council Terms', html, req.session.user));
  }));

  app.get('/school/student-council/terms/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = `${SKIP}<div style="max-width:600px;margin:0 auto;">
      <a href="/school/student-council/terms" style="color:${P};text-decoration:none;font-size:14px;">&larr; Back</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:12px 0 20px;">Create Term</h1>
      <form method="POST" action="/school/student-council/terms" class="card">
        <div style="margin-bottom:14px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Term Label *</label>
          <input type="text" name="label" required placeholder="e.g. 2025-2026 Academic Year"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Start Date *</label>
            <input type="date" name="term_start" required/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">End Date *</label>
            <input type="date" name="term_end" required/>
          </div>
        </div>
        <button type="submit" class="btn">Create Term</button>
      </form>
    </div>`;
    res.send(renderPage('Create Term', html, req.session.user));
  }));

  app.post('/school/student-council/terms', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { label, term_start, term_end } = req.body;
    if (!label || !term_start || !term_end) return res.status(400).send('All fields are required');
    await pool.query(
      `INSERT INTO council_terms (tenant_id, label, term_start, term_end) VALUES ($1,$2,$3,$4)`,
      [tid, label.trim(), term_start, term_end]
    );
    audit('council_term_created', { label }, req);
    res.redirect('/school/student-council/terms');
  }));

  app.post('/school/student-council/terms/:id/activate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE council_terms SET status = 'past' WHERE tenant_id = $1 AND status = 'active'`, [tid]);
    await pool.query(`UPDATE council_terms SET status = 'active' WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    audit('council_term_activated', { id }, req);
    res.redirect('/school/student-council/terms');
  }));

  console.log('[StudentCouncil] Module loaded');
};
