// ============================================================
// ROBOTICS CLUB MODULE — Multi-Tenant SaaS School Portal
// Project management, team formation, parts inventory,
// competition tracking, mentorship, budget, achievements
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Robotics Club</div>';

  // -- Internal helpers ---------------------------------------------------
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateFull = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const pctColor = p => p >= 80 ? '#16a34a' : p >= 50 ? '#f59e0b' : '#dc2626';

  const statusBadge = s => {
    const m = {
      planning: '#6366f1', active: '#16a34a', completed: '#9ca3af', on_hold: '#f59e0b',
      cancelled: '#dc2626', upcoming: '#2563eb', in_progress: '#059669', draft: '#9ca3af',
      new: '#16a34a', used: '#f59e0b', worn: '#dc2626', excellent: '#16a34a', good: '#059669',
      fair: '#f59e0b', poor: '#dc2626', pending: '#d97706', approved: '#16a34a', rejected: '#dc2626'
    };
    const c = m[s] || GRAY;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${c}20;color:${c}">${esc((s || '').replace(/_/g, ' '))}</span>`;
  };

  const statCard = (num, label, color) => `<div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${color || P}">${num}</div><div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(label)}</div></div>`;

  const progressBar = (pct, h) => {
    const c = pctColor(pct);
    return `<div style="width:100%;background:#e5e7eb;border-radius:8px;height:${h || 10}px;overflow:hidden"><div style="width:${Math.max(0, Math.min(100, pct))}%;background:${c};height:100%;border-radius:8px;transition:width .3s"></div></div><div style="font-size:11px;color:${c};font-weight:600;margin-top:2px">${Math.round(pct)}%</div>`;
  };

  const nav = (active) => `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <a href="/school/robotics-club" class="btn" style="${active === 'dash' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🤖 Dashboard</a>
    <a href="/school/robotics-club/projects" class="btn" style="${active === 'projects' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🔧 Projects</a>
    <a href="/school/robotics-club/teams" class="btn" style="${active === 'teams' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">👥 Teams</a>
    <a href="/school/robotics-club/parts-inventory" class="btn" style="${active === 'parts' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🔩 Parts</a>
    <a href="/school/robotics-club/competitions" class="btn" style="${active === 'competitions' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🏆 Competitions</a>
    <a href="/school/robotics-club/achievements" class="btn" style="${active === 'achievements' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🏅 Badges</a>
    <a href="/school/robotics-club/mentors" class="btn" style="${active === 'mentors' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🧑‍🏫 Mentors</a>
    <a href="/school/robotics-club/budget" class="btn" style="${active === 'budget' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">💰 Budget</a>
    <a href="/school/robotics-club/gallery" class="btn" style="${active === 'gallery' ? 'background:#3730a3' : 'background:#eef2ff;color:' + P}">🖼️ Gallery</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_projects (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(255) NOT NULL, description TEXT,
        team_id INTEGER, status VARCHAR(50) DEFAULT 'planning',
        category VARCHAR(100), robot_name VARCHAR(255),
        progress_pct INTEGER DEFAULT 0, github_url VARCHAR(500),
        created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_teams (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL, members JSONB DEFAULT '[]'::jsonb,
        mentor_id INTEGER, founded_date DATE, description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_parts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL, part_type VARCHAR(100),
        quantity INTEGER DEFAULT 0, condition VARCHAR(50) DEFAULT 'new',
        location VARCHAR(255), unit_cost NUMERIC(10,2) DEFAULT 0,
        supplier VARCHAR(255), min_stock INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_competitions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL, date DATE, location VARCHAR(255),
        category VARCHAR(100), team_id INTEGER,
        results TEXT, awards TEXT, registration_deadline DATE,
        description TEXT, max_team_size INTEGER DEFAULT 5,
        status VARCHAR(50) DEFAULT 'upcoming',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_budget (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        description VARCHAR(255) NOT NULL, amount NUMERIC(10,2) NOT NULL,
        type VARCHAR(20) NOT NULL, category VARCHAR(100),
        expense_date DATE, approved_by INTEGER,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_mentors (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER, name VARCHAR(255), specialization VARCHAR(200),
        bio TEXT, email VARCHAR(255), phone VARCHAR(50),
        availability VARCHAR(100), max_teams INTEGER DEFAULT 2,
        status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_achievements (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER, badge_type VARCHAR(100), badge_name VARCHAR(255),
        badge_icon VARCHAR(50), earned_date DATE,
        description TEXT, project_id INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_gallery (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(255), image_url VARCHAR(500),
        description TEXT, project_id INTEGER, category VARCHAR(100),
        uploaded_by INTEGER, uploaded_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_sensor_data (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        project_id INTEGER, sensor_type VARCHAR(100), value NUMERIC(12,4),
        unit VARCHAR(50), recorded_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_challenges (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(255) NOT NULL, description TEXT,
        difficulty VARCHAR(50) DEFAULT 'beginner',
        category VARCHAR(100), points INTEGER DEFAULT 100,
        hint TEXT, solution TEXT, status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_competition_checklists (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        competition_id INTEGER NOT NULL, item VARCHAR(255) NOT NULL,
        completed BOOLEAN DEFAULT false, assigned_to INTEGER,
        due_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS robotics_sponsors (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL, contact_person VARCHAR(255),
        email VARCHAR(255), phone VARCHAR(50),
        contribution_type VARCHAR(100), contribution_value NUMERIC(10,2),
        logo_url VARCHAR(500), website VARCHAR(500),
        status VARCHAR(50) DEFAULT 'active', notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rp_tenant ON robotics_projects(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rt_tenant ON robotics_teams(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rparts_tenant ON robotics_parts(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rc_tenant ON robotics_competitions(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rb_tenant ON robotics_budget(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rmentors_tenant ON robotics_mentors(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rachieve_tenant ON robotics_achievements(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rgallery_tenant ON robotics_gallery(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsensor_tenant ON robotics_sensor_data(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rchall_tenant ON robotics_challenges(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rcheck_tenant ON robotics_competition_checklists(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_rsponsor_tenant ON robotics_sponsors(tenant_id)`);
      console.log('[RoboticsClub] Tables ready');
    } catch (e) { console.warn('[RoboticsClub] Migration warning:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/robotics-club — Dashboard
  // ============================================================
  app.get('/school/robotics-club', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const [projectCount, teamCount, partCount, compCount, budgetRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM robotics_projects WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS c FROM robotics_teams WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS c FROM robotics_parts WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS c FROM robotics_competitions WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense FROM robotics_budget WHERE tenant_id=$1`, [tid])
    ]);
    const activeProjects = (await pool.query(`SELECT * FROM robotics_projects WHERE tenant_id=$1 AND status IN ('planning','active','in_progress') ORDER BY updated_at DESC LIMIT 5`, [tid])).rows;
    const upcomingComps = (await pool.query(`SELECT * FROM robotics_competitions WHERE tenant_id=$1 AND status='upcoming' ORDER BY date LIMIT 4`, [tid])).rows;
    const lowStockParts = (await pool.query(`SELECT * FROM robotics_parts WHERE tenant_id=$1 AND quantity <= min_stock ORDER BY quantity ASC LIMIT 5`, [tid])).rows;
    const recentBadges = (await pool.query(`SELECT * FROM robotics_achievements WHERE tenant_id=$1 ORDER BY earned_date DESC LIMIT 6`, [tid])).rows;
    const balance = (budgetRes.rows[0].income - budgetRes.rows[0].expense).toFixed(2);

    const projectsHtml = activeProjects.map(p => `<div class="card" style="padding:14px;display:flex;align-items:center;gap:14px">
      <div style="width:44px;height:44px;border-radius:10px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🔧</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:14px">${esc(p.title)}</strong>${statusBadge(p.status)}</div>
        <div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(p.robot_name || 'No robot name')} · ${esc(p.category || 'General')}</div>
        <div style="margin-top:6px;max-width:200px">${progressBar(p.progress_pct, 8)}</div>
      </div>
      <a href="/school/robotics-club/projects/${p.id}" class="btn" style="font-size:12px;padding:6px 12px">View</a>
    </div>`).join('');

    const compsHtml = upcomingComps.map(c => `<div class="card" style="padding:12px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px">🏆</div>
      <div style="flex:1"><strong style="font-size:13px">${esc(c.name)}</strong><div style="font-size:11px;color:${GRAY};margin-top:2px">${fmtDate(c.date)} · ${esc(c.location || 'TBD')}</div></div>
      ${statusBadge(c.status)}
    </div>`).join('');

    const lowStockHtml = lowStockParts.map(p => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <span style="font-size:18px">🔩</span>
      <div style="flex:1"><strong style="font-size:13px">${esc(p.name)}</strong><div style="font-size:11px;color:${GRAY}">${esc(p.location || 'Unknown')}</div></div>
      <span style="font-weight:700;color:#dc2626;font-size:14px">${p.quantity} left</span>
    </div>`).join('');

    const badgesHtml = recentBadges.map(b => `<div style="text-align:center;padding:8px">
      <div style="font-size:28px">${esc(b.badge_icon || '🏅')}</div>
      <div style="font-size:11px;font-weight:600;margin-top:4px">${esc(b.badge_name)}</div>
      <div style="font-size:10px;color:${GRAY}">${fmtDate(b.earned_date)}</div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🤖 Robotics Club</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Build, innovate, compete — the future starts here</p></div>
        <a href="/school/robotics-club/projects/new" class="btn" style="padding:10px 20px;font-size:14px">+ New Project</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        ${statCard(projectCount.rows[0].c, 'Projects', P)}
        ${statCard(teamCount.rows[0].c, 'Teams', '#16a34a')}
        ${statCard(partCount.rows[0].c, 'Parts', '#f59e0b')}
        ${statCard(compCount.rows[0].c, 'Competitions', '#2563eb')}
        ${statCard('$' + balance, 'Budget Balance', balance >= 0 ? '#16a34a' : '#dc2626')}
        ${statCard(lowStockParts.length, 'Low Stock Alerts', '#dc2626')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🔧 Active Projects</h3>
          ${projectsHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No active projects</p>'}
        </div>
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🏆 Upcoming Competitions</h3>
          ${compsHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No upcoming competitions</p>'}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">⚠️ Low Stock Alerts</h3>
          ${lowStockHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">All parts are well stocked</p>'}
        </div>
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🏅 Recent Badges</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${badgesHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px;grid-column:1/-1">No badges earned yet</p>'}</div>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 14px;font-size:15px">⚡ Quick Actions</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="/school/robotics-club/projects/new" class="btn" style="background:#16a34a">+ New Project</a>
          <a href="/school/robotics-club/teams" class="btn" style="background:#059669">👥 Form Team</a>
          <a href="/school/robotics-club/parts-inventory" class="btn" style="background:#d97706">🔩 Parts Inventory</a>
          <a href="/school/robotics-club/competitions" class="btn" style="background:#2563eb">🏆 Competitions</a>
          <a href="/school/robotics-club/achievements" class="btn" style="background:#8b5cf6">🏅 Badges</a>
          <a href="/school/robotics-club/gallery" class="btn" style="background:#ec4899">🖼️ Gallery</a>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Robotics Club', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/robotics-club/projects — Projects List
  // ============================================================
  app.get('/school/robotics-club/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const status = req.query.status || '';
    const category = req.query.category || '';
    const search = req.query.q || '';
    let where = ['p.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`p.status=$${pi++}`); params.push(status); }
    if (category) { where.push(`p.category=$${pi++}`); params.push(category); }
    if (search) { where.push(`(p.title ILIKE $${pi} OR p.robot_name ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    const projects = (await pool.query(
      `SELECT p.*, t.name AS team_name FROM robotics_projects p LEFT JOIN robotics_teams t ON t.id=p.team_id WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 60`, params
    )).rows;
    const categories = (await pool.query(`SELECT DISTINCT category FROM robotics_projects WHERE tenant_id=$1 AND category IS NOT NULL ORDER BY category`, [tid])).rows.map(r => r.category);
    const statusCounts = (await pool.query(`SELECT status, COUNT(*)::int AS c FROM robotics_projects WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;

    const statusTabs = [{ v: '', l: 'All' }, { v: 'planning', l: 'Planning' }, { v: 'active', l: 'Active' }, { v: 'in_progress', l: 'In Progress' }, { v: 'completed', l: 'Completed' }, { v: 'on_hold', l: 'On Hold' }];
    const statusTabsHtml = statusTabs.map(s => {
      const count = s.v ? (statusCounts.find(sc => sc.status === s.v) || {}).c || 0 : projects.length;
      return `<a href="/school/robotics-club/projects?status=${s.v}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${status === s.v ? '#fff' : GRAY};background:${status === s.v ? P : '#f3f4f6'}">${s.l} (${count})</a>`;
    }).join(' ');

    const rowsHtml = projects.map(p => `<tr>
      <td><a href="/school/robotics-club/projects/${p.id}" style="color:${P};font-weight:600;text-decoration:none">${esc(p.title)}</a>
        ${p.robot_name ? `<div style="font-size:11px;color:${GRAY}">🤖 ${esc(p.robot_name)}</div>` : ''}</td>
      <td>${esc(p.team_name || 'Unassigned')}</td>
      <td>${esc(p.category || '—')}</td>
      <td>${statusBadge(p.status)}</td>
      <td style="min-width:120px">${progressBar(p.progress_pct, 8)}</td>
      <td><div style="display:flex;gap:6px">
        <a href="/school/robotics-club/projects/${p.id}" class="btn" style="font-size:11px;padding:4px 10px">View</a>
        <form method="POST" action="/school/robotics-club/projects/${p.id}/delete" onsubmit="return confirm('Delete this project?')"><button class="btn" style="font-size:11px;padding:4px 10px;background:#dc2626">✕</button></form>
      </div></td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('projects')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🔧 Robotics Projects</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${projects.length} projects</p></div>
        <div style="display:flex;gap:8px">
          <form method="GET" style="display:flex;gap:8px"><input type="text" name="q" value="${esc(search)}" placeholder="Search projects..." style="width:200px"><button class="btn" style="padding:8px 14px">Search</button></form>
          <a href="/school/robotics-club/projects/new" class="btn" style="background:#16a34a">+ New Project</a>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap">${statusTabsHtml}</div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Project</th><th>Team</th><th>Category</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:' + GRAY + ';padding:30px">No projects found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Robotics Projects', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/robotics-club/projects/new — New Project
  // ============================================================
  app.get('/school/robotics-club/projects/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teams = (await pool.query(`SELECT id, name FROM robotics_teams WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const categories = ['Autonomous', 'Tele-operated', 'Drone', 'Underwater', 'Walking', 'Arm/Manipulator', 'Rover', 'Sumo', 'Soccer', 'Line Follower', 'Maze Solver', 'Other'];
    const teamOpts = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const catOpts = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('projects')}
      <a href="/school/robotics-club/projects" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Projects</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 4px">🆕 New Robotics Project</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Start a new robot build or engineering challenge</p>
        <form method="POST" action="/school/robotics-club/projects" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Project Title *</label><input type="text" name="title" required placeholder="e.g., Autonomous Line Follower v2"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Robot Name</label><input type="text" name="robot_name" placeholder="e.g., TurboBot X1"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="">Select category</option>${catOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Team</label><select name="team_id"><option value="">No team yet</option>${teamOpts}</select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">GitHub Repository URL</label><input type="url" name="github_url" placeholder="https://github.com/org/repo"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="4" placeholder="Describe your robot concept, objectives, and approach..."></textarea></div>
          <button type="submit" class="btn" style="padding:12px 24px;font-size:15px">Create Project</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Project', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /school/robotics-club/projects — Create Project
  // ============================================================
  app.post('/school/robotics-club/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, robot_name, category, team_id, github_url, description } = req.body;
    if (!title || !title.trim()) {
      req.session.flash = { type: 'error', msg: 'Project title is required' };
      return res.redirect('/school/robotics-club/projects/new');
    }
    await pool.query(
      `INSERT INTO robotics_projects (tenant_id, title, description, team_id, status, category, robot_name, github_url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, title.trim(), description ? description.trim() : null, team_id || null, 'planning', category || null, robot_name ? robot_name.trim() : null, github_url ? github_url.trim() : null, user.id]
    );
    await audit(tid, user.id, 'robotics_project_create', { title: title.trim(), category });
    req.session.flash = { type: 'success', msg: 'Project created successfully!' };
    res.redirect('/school/robotics-club/projects');
  }));

  // ============================================================
  // ROUTE 5: GET /school/robotics-club/projects/:id — View/Edit Project
  // ============================================================
  app.get('/school/robotics-club/projects/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const proj = (await pool.query(`SELECT p.*, t.name AS team_name FROM robotics_projects p LEFT JOIN robotics_teams t ON t.id=p.team_id WHERE p.id=$1 AND p.tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!proj) return res.status(404).send('Project not found');
    const teams = (await pool.query(`SELECT id, name FROM robotics_teams WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const teamOpts = teams.map(t => `<option value="${t.id}" ${t.id === proj.team_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const categories = ['Autonomous', 'Tele-operated', 'Drone', 'Underwater', 'Walking', 'Arm/Manipulator', 'Rover', 'Sumo', 'Soccer', 'Line Follower', 'Maze Solver', 'Other'];
    const catOpts = categories.map(c => `<option value="${c}" ${c === proj.category ? 'selected' : ''}>${c}</option>`).join('');
    const statusOpts = ['planning', 'active', 'in_progress', 'completed', 'on_hold', 'cancelled'].map(s =>
      `<option value="${s}" ${s === proj.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`
    ).join('');
    const sensorData = (await pool.query(`SELECT * FROM robotics_sensor_data WHERE project_id=$1 AND tenant_id=$2 ORDER BY recorded_at DESC LIMIT 20`, [proj.id, tid])).rows;
    const galleryImgs = (await pool.query(`SELECT * FROM robotics_gallery WHERE project_id=$1 AND tenant_id=$2 ORDER BY uploaded_at DESC`, [proj.id, tid])).rows;

    const sensorHtml = sensorData.map(s => `<tr>
      <td>${esc(s.sensor_type)}</td><td>${Number(s.value).toFixed(2)} ${esc(s.unit || '')}</td>
      <td>${fmtDateFull(s.recorded_at)}</td>
    </tr>`).join('');

    const galleryHtml = galleryImgs.map(g => `<div class="card" style="padding:0;overflow:hidden">
      ${g.image_url ? `<img src="${esc(g.image_url)}" style="width:100%;height:150px;object-fit:cover" alt="${esc(g.title || '')}">` : ''}
      <div style="padding:8px"><div style="font-size:12px;font-weight:600">${esc(g.title || 'Untitled')}</div>
      <div style="font-size:11px;color:${GRAY}">${esc(g.category || '')} · ${fmtDate(g.uploaded_at)}</div></div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">${nav('projects')}
      <a href="/school/robotics-club/projects" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Projects</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0 20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🔧 ${esc(proj.title)}</h1>
        ${proj.robot_name ? `<p style="color:${GRAY};font-size:14px;margin:4px 0 0">🤖 ${esc(proj.robot_name)}</p>` : ''}</div>
        ${statusBadge(proj.status)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div style="display:grid;gap:16px">
          <div class="card"><h3 style="margin:0 0 16px;font-size:15px">📝 Edit Project</h3>
            <form method="POST" action="/school/robotics-club/projects/${proj.id}" style="display:flex;flex-direction:column;gap:14px">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Status</label><select name="status">${statusOpts}</select></div>
                <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Progress %</label><input type="number" name="progress_pct" value="${proj.progress_pct}" min="0" max="100"></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="">None</option>${catOpts}</select></div>
                <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Team</label><select name="team_id"><option value="">None</option>${teamOpts}</select></div>
              </div>
              <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(proj.description || '')}</textarea></div>
              <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">GitHub URL</label><input type="url" name="github_url" value="${esc(proj.github_url || '')}"></div>
              <button type="submit" class="btn">Save Changes</button>
            </form>
          </div>
        </div>
        <div style="display:grid;gap:16px">
          <div class="card"><h3 style="margin:0 0 12px;font-size:15px">📊 Progress</h3>
            <div style="text-align:center;padding:20px 0">${progressBar(proj.progress_pct, 20)}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
              <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY}">Team</div><div style="font-size:14px;font-weight:700">${esc(proj.team_name || 'Unassigned')}</div></div>
              <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY}">Category</div><div style="font-size:14px;font-weight:700">${esc(proj.category || '—')}</div></div>
              <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY}">Created</div><div style="font-size:14px;font-weight:700">${fmtDate(proj.created_at)}</div></div>
              <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY}">Updated</div><div style="font-size:14px;font-weight:700">${fmtDate(proj.updated_at)}</div></div>
            </div>
            ${proj.github_url ? `<a href="${esc(proj.github_url)}" target="_blank" class="btn" style="display:block;text-align:center;margin-top:14px;background:#24292e">🌐 Open GitHub</a>` : ''}
          </div>
        </div>
      </div>
      ${sensorData.length > 0 ? `<div class="card"><h3 style="margin:0 0 12px;font-size:15px">📡 Sensor Data (Last 20)</h3><table>
        <thead><tr><th>Sensor</th><th>Value</th><th>Recorded</th></tr></thead>
        <tbody>${sensorHtml}</tbody></table></div>` : ''}
      ${galleryImgs.length > 0 ? `<div class="card"><h3 style="margin:0 0 12px;font-size:15px">🖼️ Project Gallery</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">${galleryHtml}</div></div>` : ''}
    </div>`;
    res.send(renderPage('Project: ' + proj.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/robotics-club/projects/:id — Update Project
  // ============================================================
  app.post('/school/robotics-club/projects/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;
    const { title, description, team_id, status, category, robot_name, github_url, progress_pct } = req.body;
    const proj = (await pool.query(`SELECT id FROM robotics_projects WHERE id=$1 AND tenant_id=$2`, [pid, tid])).rows[0];
    if (!proj) return res.status(404).send('Project not found');
    await pool.query(
      `UPDATE robotics_projects SET status=$1, progress_pct=$2, category=$3, team_id=$4, description=$5, github_url=$6, updated_at=NOW() WHERE id=$7 AND tenant_id=$8`,
      [status || 'planning', Math.min(100, Math.max(0, parseInt(progress_pct) || 0)), category || null, team_id || null, description || null, github_url || null, pid, tid]
    );
    await audit(tid, user.id, 'robotics_project_update', { project_id: parseInt(pid), status });
    req.session.flash = { type: 'success', msg: 'Project updated!' };
    res.redirect(`/school/robotics-club/projects/${pid}`);
  }));

  // ============================================================
  // ROUTE 7: POST /school/robotics-club/projects/:id/delete
  // ============================================================
  app.post('/school/robotics-club/projects/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, pid = req.params.id;
    await pool.query(`DELETE FROM robotics_sensor_data WHERE project_id=$1 AND tenant_id=$2`, [pid, tid]);
    await pool.query(`DELETE FROM robotics_gallery WHERE project_id=$1 AND tenant_id=$2`, [pid, tid]);
    await pool.query(`DELETE FROM robotics_projects WHERE id=$1 AND tenant_id=$2`, [pid, tid]);
    await audit(tid, req.session.user.id, 'robotics_project_delete', { project_id: parseInt(pid) });
    req.session.flash = { type: 'success', msg: 'Project deleted' };
    res.redirect('/school/robotics-club/projects');
  }));

  // ============================================================
  // ROUTE 8: GET /school/robotics-club/teams — Teams Management
  // ============================================================
  app.get('/school/robotics-club/teams', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teams = (await pool.query(
      `SELECT t.*, m.name AS mentor_name, (SELECT COUNT(*)::int FROM robotics_projects p WHERE p.team_id=t.id AND p.tenant_id=$1) AS project_count FROM robotics_teams t LEFT JOIN robotics_mentors m ON m.id=t.mentor_id WHERE t.tenant_id=$1 ORDER BY t.name`, [tid]
    )).rows;

    const teamsHtml = teams.map(t => {
      const members = Array.isArray(t.members) ? t.members : JSON.parse(t.members || '[]');
      return `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:50px;height:50px;border-radius:12px;background:${P}20;display:flex;align-items:center;justify-content:center;font-size:24px">👥</div>
          <div style="flex:1">
            <strong style="font-size:16px">${esc(t.name)}</strong>
            <div style="font-size:12px;color:${GRAY};margin-top:2px">${members.length} member${members.length !== 1 ? 's' : ''} · ${t.project_count} project${t.project_count !== 1 ? 's' : ''} · Founded ${fmtDate(t.founded_date)}</div>
            ${t.mentor_name ? `<div style="font-size:12px;color:${P};margin-top:2px">🧑‍🏫 Mentor: ${esc(t.mentor_name)}</div>` : '<div style="font-size:12px;color:#dc2626;margin-top:2px">⚠️ No mentor assigned</div>'}
          </div>
          <form method="POST" action="/school/robotics-club/teams/${t.id}/delete" onsubmit="return confirm('Delete this team?')"><button class="btn" style="font-size:11px;padding:4px 12px;background:#dc2626">Delete</button></form>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('teams')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">👥 Robotics Teams</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${teams.length} teams</p></div>
      </div>
      <div class="card" style="padding:28px;margin-bottom:20px">
        <h3 style="margin:0 0 16px">➕ Create New Team</h3>
        <form method="POST" action="/school/robotics-club/teams" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Team Name *</label><input type="text" name="name" required placeholder="e.g., Circuit Breakers"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Founded Date</label><input type="date" name="founded_date" value="${today()}"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="2" placeholder="Team mission and goals..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a">Create Team</button>
        </form>
      </div>
      ${teamsHtml || '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '"><p style="font-size:40px;margin-bottom:12px">👥</p>No teams yet. Create your first team!</div>'}
    </div>`;
    res.send(renderPage('Robotics Teams', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /school/robotics-club/teams — Create Team
  // ============================================================
  app.post('/school/robotics-club/teams', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, founded_date, description } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Team name is required' }; return res.redirect('/school/robotics-club/teams'); }
    await pool.query(`INSERT INTO robotics_teams (tenant_id, name, members, founded_date, description) VALUES ($1,$2,'[]'::jsonb,$3,$4)`,
      [tid, name.trim(), founded_date || null, description || null]);
    await audit(tid, user.id, 'robotics_team_create', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Team created!' };
    res.redirect('/school/robotics-club/teams');
  }));

  app.post('/school/robotics-club/teams/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE robotics_projects SET team_id=NULL WHERE team_id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    await pool.query(`DELETE FROM robotics_teams WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    await audit(tid, req.session.user.id, 'robotics_team_delete', { team_id: parseInt(req.params.id) });
    req.session.flash = { type: 'success', msg: 'Team deleted' };
    res.redirect('/school/robotics-club/teams');
  }));

  // ============================================================
  // ROUTE 10: GET /school/robotics-club/parts-inventory — Parts
  // ============================================================
  app.get('/school/robotics-club/parts-inventory', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const partType = req.query.type || '';
    const search = req.query.q || '';
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (partType) { where.push(`part_type=$${pi++}`); params.push(partType); }
    if (search) { where.push(`(name ILIKE $${pi} OR location ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    const parts = (await pool.query(`SELECT * FROM robotics_parts WHERE ${where.join(' AND ')} ORDER BY name`, params)).rows;
    const totalValue = parts.reduce((sum, p) => sum + (Number(p.unit_cost) || 0) * (Number(p.quantity) || 0), 0);
    const partTypes = ['Motor', 'Sensor', 'Controller', 'Chassis', 'Wheel', 'Battery', 'Wire', 'Connector', 'Servo', 'Gear', 'Bearing', 'LED', 'Display', 'Camera', 'Bluetooth Module', 'WiFi Module', 'PCB', 'Resistor', 'Capacitor', 'Other'];

    const rowsHtml = parts.map(p => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.part_type || '—')}</td>
      <td style="font-weight:700;color:${p.quantity <= p.min_stock ? '#dc2626' : '#111827'}">${p.quantity}</td>
      <td>${statusBadge(p.condition || 'new')}</td>
      <td>${esc(p.location || '—')}</td>
      <td>$${Number(p.unit_cost || 0).toFixed(2)}</td>
      <td><div style="display:flex;gap:4px">
        <form method="POST" action="/school/robotics-club/parts/${p.id}/adjust"><input type="number" name="delta" value="0" style="width:60px;padding:4px;text-align:center" title="Change quantity"><button class="btn" style="font-size:10px;padding:4px 8px">✓</button></form>
        <form method="POST" action="/school/robotics-club/parts/${p.id}/delete" onsubmit="return confirm('Delete?')"><button class="btn" style="font-size:10px;padding:4px 8px;background:#dc2626">✕</button></form>
      </div></td>
    </tr>`).join('');

    const typeTabs = [{ v: '', l: 'All' }, ...partTypes.map(t => ({ v: t, l: t }))].map(t =>
      `<a href="/school/robotics-club/parts-inventory?type=${encodeURIComponent(t.v)}" style="padding:4px 12px;border-radius:16px;font-size:11px;text-decoration:none;color:${partType === t.v ? '#fff' : GRAY};background:${partType === t.v ? P : '#f3f4f6'}">${t.l}</a>`
    ).join(' ');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('parts')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🔩 Parts Inventory</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${parts.length} items · Total value: <strong style="color:#16a34a">$${totalValue.toFixed(2)}</strong></p></div>
        <form method="GET" style="display:flex;gap:8px"><input type="text" name="q" value="${esc(search)}" placeholder="Search parts..." style="width:200px"><button class="btn" style="padding:8px 14px">Search</button></form>
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="margin:0 0 16px">➕ Add New Part</h3>
        <form method="POST" action="/school/robotics-club/parts" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Name *</label><input type="text" name="name" required placeholder="Part name"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Type</label><select name="part_type">${partTypes.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Qty</label><input type="number" name="quantity" value="1" min="0"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Condition</label><select name="condition"><option value="new">New</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="worn">Worn</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Location</label><input type="text" name="location" placeholder="Shelf/bin"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Unit Cost</label><input type="number" name="unit_cost" step="0.01" min="0" value="0"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Min Stock</label><input type="number" name="min_stock" value="2" min="0"></div>
          <div style="display:flex;align-items:flex-end"><button type="submit" class="btn" style="background:#16a34a">+ Add</button></div>
        </form>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${typeTabs}</div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Part</th><th>Type</th><th>Qty</th><th>Condition</th><th>Location</th><th>Unit Cost</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:' + GRAY + ';padding:30px">No parts in inventory</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Parts Inventory', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: POST /school/robotics-club/parts — Add Part
  // ============================================================
  app.post('/school/robotics-club/parts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, part_type, quantity, condition, location, unit_cost, min_stock, supplier } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Part name required' }; return res.redirect('/school/robotics-club/parts-inventory'); }
    await pool.query(
      `INSERT INTO robotics_parts (tenant_id, name, part_type, quantity, condition, location, unit_cost, min_stock, supplier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, name.trim(), part_type || null, parseInt(quantity) || 0, condition || 'new', location || null, parseFloat(unit_cost) || 0, parseInt(min_stock) || 0, supplier || null]
    );
    await audit(tid, req.session.user.id, 'robotics_part_add', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Part added!' };
    res.redirect('/school/robotics-club/parts-inventory');
  }));

  app.post('/school/robotics-club/parts/:id/adjust', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, pid = req.params.id, delta = parseInt(req.body.delta) || 0;
    await pool.query(`UPDATE robotics_parts SET quantity = GREATEST(0, quantity + $1) WHERE id=$2 AND tenant_id=$3`, [delta, pid, tid]);
    await audit(tid, req.session.user.id, 'robotics_part_adjust', { part_id: parseInt(pid), delta });
    req.session.flash = { type: 'success', msg: 'Stock updated!' };
    res.redirect('/school/robotics-club/parts-inventory');
  }));

  app.post('/school/robotics-club/parts/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM robotics_parts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    req.session.flash = { type: 'success', msg: 'Part removed' };
    res.redirect('/school/robotics-club/parts-inventory');
  }));

  // ============================================================
  // ROUTE 12: GET /school/robotics-club/competitions — Competitions
  // ============================================================
  app.get('/school/robotics-club/competitions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const competitions = (await pool.query(
      `SELECT c.*, t.name AS team_name FROM robotics_competitions c LEFT JOIN robotics_teams t ON t.id=c.team_id WHERE c.tenant_id=$1 ORDER BY c.date DESC NULLS LAST`, [tid]
    )).rows;

    const rowsHtml = competitions.map(c => `<tr>
      <td><strong>${esc(c.name)}</strong><div style="font-size:11px;color:${GRAY}">${esc(c.category || 'General')}</div></td>
      <td>${fmtDate(c.date)}</td>
      <td>${esc(c.location || 'TBD')}</td>
      <td>${esc(c.team_name || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${c.awards ? `<span style="color:#f59e0b;font-weight:600">${esc(c.awards)}</span>` : '—'}</td>
      <td>${c.results ? esc(c.results.slice(0, 60)) : '—'}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('competitions')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🏆 Robotics Competitions</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${competitions.length} competitions tracked</p></div>
        <a href="/school/robotics-club/competitions/register" class="btn" style="background:#16a34a">+ Register for Competition</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Competition</th><th>Date</th><th>Location</th><th>Team</th><th>Status</th><th>Awards</th><th>Results</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:' + GRAY + ';padding:30px">No competitions tracked</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Competitions', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET/POST /school/robotics-club/competitions/register
  // ============================================================
  app.get('/school/robotics-club/competitions/register', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teams = (await pool.query(`SELECT id, name FROM robotics_teams WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const teamOpts = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const categories = ['FIRST Robotics', 'VEX Robotics', 'RoboCup', 'World Robot Olympiad', 'Botball', 'BEST Robotics', 'National Robotics Challenge', 'Local Meet', 'Hackathon', 'Other'];
    const catOpts = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('competitions')}
      <a href="/school/robotics-club/competitions" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Competitions</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 4px">📝 Register Competition</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Track a new competition entry</p>
        <form method="POST" action="/school/robotics-club/competitions/register" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Competition Name *</label><input type="text" name="name" required placeholder="e.g., State Robotics Championship 2025"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date</label><input type="date" name="date"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Registration Deadline</label><input type="date" name="registration_deadline"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Location</label><input type="text" name="location" placeholder="e.g., Convention Center, City"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="">Select</option>${catOpts}</select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Team</label><select name="team_id"><option value="">No team assigned</option>${teamOpts}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description / Notes</label><textarea name="description" rows="3" placeholder="Competition details, requirements, rules..."></textarea></div>
          <button type="submit" class="btn" style="padding:12px 24px;font-size:15px;background:#16a34a">Register Competition</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Register Competition', html, user, req));
  }));

  app.post('/school/robotics-club/competitions/register', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, date, location, category, team_id, description, registration_deadline, max_team_size } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Competition name required' }; return res.redirect('/school/robotics-club/competitions/register'); }
    await pool.query(
      `INSERT INTO robotics_competitions (tenant_id, name, date, location, category, team_id, description, registration_deadline, max_team_size, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'upcoming')`,
      [tid, name.trim(), date || null, location || null, category || null, team_id || null, description || null, registration_deadline || null, parseInt(max_team_size) || 5]
    );
    await audit(tid, user.id, 'robotics_comp_register', { name: name.trim(), category });
    req.session.flash = { type: 'success', msg: 'Competition registered!' };
    res.redirect('/school/robotics-club/competitions');
  }));

  // ============================================================
  // ROUTE 14: GET /school/robotics-club/achievements — Badges
  // ============================================================
  app.get('/school/robotics-club/achievements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const allBadges = (await pool.query(`SELECT * FROM robotics_achievements WHERE tenant_id=$1 ORDER BY earned_date DESC`, [tid])).rows;
    const myBadges = (await pool.query(`SELECT * FROM robotics_achievements WHERE tenant_id=$1 AND user_id=$2 ORDER BY earned_date DESC`, [tid, uid])).rows;
    const badgeTypes = allBadges.reduce((acc, b) => { const t = b.badge_type || 'General'; acc[t] = (acc[t] || 0) + 1; return acc; }, {});

    const predefinedBadges = [
      { type: 'First Build', icon: '🔧', name: 'First Build', desc: 'Complete your first robotics project' },
      { type: 'Team Player', icon: '🤝', name: 'Team Player', desc: 'Join a robotics team' },
      { type: 'Competition Ready', icon: '🏆', name: 'Competition Ready', desc: 'Participate in your first competition' },
      { type: 'Award Winner', icon: '🥇', name: 'Award Winner', desc: 'Win an award at a competition' },
      { type: 'Mentor', icon: '🧑‍🏫', name: 'Mentor', desc: 'Mentor a robotics team' },
      { type: '100% Progress', icon: '💯', name: 'Perfectionist', desc: 'Complete a project at 100%' },
      { type: 'Code Wizard', icon: '💻', name: 'Code Wizard', desc: 'Write robot code with GitHub integration' },
      { type: 'Parts Master', icon: '🔩', name: 'Parts Master', desc: 'Manage parts inventory for 3+ projects' },
      { type: 'Sensor Expert', icon: '📡', name: 'Sensor Expert', desc: 'Log 50+ sensor data points' },
      { type: 'Robot Designer', icon: '🎨', name: 'Robot Designer', desc: 'Design 3 different robot types' }
    ];
    const earnedSet = new Set(myBadges.map(b => b.badge_type));
    const badgesHtml = predefinedBadges.map(b => {
      const earned = earnedSet.has(b.type);
      return `<div class="card" style="text-align:center;padding:20px;${earned ? '' : 'opacity:0.4;filter:grayscale(1)'}">
        <div style="font-size:40px;margin-bottom:8px">${b.icon}</div>
        <div style="font-size:14px;font-weight:700">${esc(b.name)}</div>
        <div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(b.desc)}</div>
        ${earned ? '<div style="margin-top:8px;color:#16a34a;font-weight:600;font-size:12px">✅ Earned</div>' : '<div style="margin-top:8px;color:' + GRAY + ';font-size:12px">🔒 Locked</div>'}
      </div>`;
    }).join('');

    const recentHtml = myBadges.slice(0, 8).map(b => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6">
      <div style="font-size:28px">${esc(b.badge_icon || '🏅')}</div>
      <div style="flex:1"><strong style="font-size:13px">${esc(b.badge_name)}</strong><div style="font-size:11px;color:${GRAY}">${esc(b.badge_type)}</div></div>
      <div style="font-size:12px;color:${GRAY}">${fmtDate(b.earned_date)}</div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('achievements')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🏅 Achievement Badges</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${myBadges.length} of ${predefinedBadges.length} badges earned</p></div>
        <div style="display:flex;gap:8px">
          ${user.role === 'admin' || user.role === 'teacher' ? `<button onclick="document.getElementById('awardForm').style.display='block'" class="btn" style="background:#16a34a">+ Award Badge</button>` : ''}
        </div>
      </div>
      ${(user.role === 'admin' || user.role === 'teacher') ? `<div id="awardForm" class="card" style="padding:20px;display:none;margin-bottom:20px">
        <h3 style="margin:0 0 14px">🏅 Award a Badge</h3>
        <form method="POST" action="/school/robotics-club/achievements/award" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">User ID</label><input type="number" name="user_id" required placeholder="Student ID"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Badge</label><select name="badge_type">${predefinedBadges.map(b => `<option value="${b.type}">${b.icon} ${b.name}</option>`).join('')}</select></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date</label><input type="date" name="earned_date" value="${today()}"></div>
          <button type="submit" class="btn" style="background:#16a34a">Award</button>
        </form>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:20px">${badgesHtml}</div>
      <div class="card"><h3 style="margin:0 0 12px;font-size:15px">🎖️ My Recent Badges</h3>
        ${recentHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No badges earned yet. Start building!</p>'}
      </div>
    </div>`;
    res.send(renderPage('Achievement Badges', html, user, req));
  }));

  app.post('/school/robotics-club/achievements/award', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { user_id, badge_type, earned_date } = req.body;
    if (!user_id || !badge_type) { req.session.flash = { type: 'error', msg: 'User ID and badge type required' }; return res.redirect('/school/robotics-club/achievements'); }
    const predefinedBadges = {
      'First Build': { icon: '🔧', name: 'First Build' }, 'Team Player': { icon: '🤝', name: 'Team Player' },
      'Competition Ready': { icon: '🏆', name: 'Competition Ready' }, 'Award Winner': { icon: '🥇', name: 'Award Winner' },
      'Mentor': { icon: '🧑‍🏫', name: 'Mentor' }, '100% Progress': { icon: '💯', name: 'Perfectionist' },
      'Code Wizard': { icon: '💻', name: 'Code Wizard' }, 'Parts Master': { icon: '🔩', name: 'Parts Master' },
      'Sensor Expert': { icon: '📡', name: 'Sensor Expert' }, 'Robot Designer': { icon: '🎨', name: 'Robot Designer' }
    };
    const badge = predefinedBadges[badge_type] || { icon: '🏅', name: badge_type };
    await pool.query(`INSERT INTO robotics_achievements (tenant_id, user_id, badge_type, badge_name, badge_icon, earned_date) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, parseInt(user_id), badge_type, badge.name, badge.icon, earned_date || today()]);
    await audit(tid, req.session.user.id, 'robotics_badge_award', { user_id: parseInt(user_id), badge_type });
    req.session.flash = { type: 'success', msg: `Badge "${badge.name}" awarded!` };
    res.redirect('/school/robotics-club/achievements');
  }));

  // ============================================================
  // ROUTE 15: GET /school/robotics-club/mentors — Mentorship
  // ============================================================
  app.get('/school/robotics-club/mentors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const mentors = (await pool.query(`SELECT m.*, (SELECT COUNT(*)::int FROM robotics_teams t WHERE t.mentor_id=m.id AND t.tenant_id=$1) AS team_count FROM robotics_mentors m WHERE m.tenant_id=$1 ORDER BY m.name`, [tid])).rows;

    const mentorsHtml = mentors.map(m => `<div class="card" style="padding:20px;display:flex;align-items:center;gap:16px">
      <div style="width:56px;height:56px;border-radius:50%;background:${P}20;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">🧑‍🏫</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px"><strong style="font-size:16px">${esc(m.name)}</strong>${statusBadge(m.status)}</div>
        <div style="font-size:13px;color:${GRAY};margin-top:2px">${esc(m.specialization || 'General')} · ${m.team_count} team${m.team_count !== 1 ? 's' : ''}</div>
        ${m.bio ? `<div style="font-size:12px;color:#374151;margin-top:4px">${esc(m.bio.slice(0, 120))}${m.bio.length > 120 ? '...' : ''}</div>` : ''}
        <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;color:${GRAY}">
          ${m.email ? `<span>✉️ ${esc(m.email)}</span>` : ''}
          ${m.availability ? `<span>🕐 ${esc(m.availability)}</span>` : ''}
        </div>
      </div>
      <form method="POST" action="/school/robotics-club/mentors/${m.id}/delete" onsubmit="return confirm('Remove mentor?')"><button class="btn" style="font-size:11px;padding:4px 12px;background:#dc2626">Remove</button></form>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('mentors')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🧑‍🏫 Mentors</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${mentors.length} mentors</p></div>
      </div>
      <div class="card" style="padding:28px;margin-bottom:20px">
        <h3 style="margin:0 0 16px">➕ Add Mentor</h3>
        <form method="POST" action="/school/robotics-club/mentors" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Name *</label><input type="text" name="name" required placeholder="Mentor name"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Specialization</label><input type="text" name="specialization" placeholder="e.g., Arduino, ROS, CAD"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Email</label><input type="email" name="email" placeholder="mentor@example.com"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Availability</label><select name="availability"><option value="weekday-mornings">Weekday Mornings</option><option value="weekday-afternoons">Weekday Afternoons</option><option value="weekday-evenings">Weekday Evenings</option><option value="weekends">Weekends Only</option><option value="flexible">Flexible</option></select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Bio</label><textarea name="bio" rows="2" placeholder="Background, experience, areas of expertise..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a">Add Mentor</button>
        </form>
      </div>
      ${mentorsHtml || '<div class="card" style="text-align:center;padding:40px;color:' + GRAY + '"><p style="font-size:40px;margin-bottom:12px">🧑‍🏫</p>No mentors added yet. Add your first mentor to guide the teams!</div>'}
    </div>`;
    res.send(renderPage('Mentors', html, user, req));
  }));

  app.post('/school/robotics-club/mentors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, specialization, email, phone, bio, availability } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Mentor name required' }; return res.redirect('/school/robotics-club/mentors'); }
    await pool.query(`INSERT INTO robotics_mentors (tenant_id, name, specialization, email, phone, bio, availability) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, name.trim(), specialization || null, email || null, phone || null, bio || null, availability || null]);
    await audit(tid, req.session.user.id, 'robotics_mentor_add', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Mentor added!' };
    res.redirect('/school/robotics-club/mentors');
  }));

  app.post('/school/robotics-club/mentors/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE robotics_teams SET mentor_id=NULL WHERE mentor_id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    await pool.query(`DELETE FROM robotics_mentors WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    req.session.flash = { type: 'success', msg: 'Mentor removed' };
    res.redirect('/school/robotics-club/mentors');
  }));

  // ============================================================
  // ROUTE 16: GET /school/robotics-club/budget — Budget Tracking
  // ============================================================
  app.get('/school/robotics-club/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const entries = (await pool.query(`SELECT b.*, u.name AS approver_name FROM robotics_budget b LEFT JOIN users u ON u.id=b.approved_by WHERE b.tenant_id=$1 ORDER BY b.expense_date DESC NULLS LAST, b.created_at DESC LIMIT 100`, [tid])).rows;
    const summary = (await pool.query(`SELECT type, category, SUM(amount) AS total FROM robotics_budget WHERE tenant_id=$1 GROUP BY type, category ORDER BY type, total DESC`, [tid])).rows;
    const totals = entries.reduce((acc, e) => {
      acc[e.type === 'income' ? 'income' : 'expense'] += Number(e.amount) || 0;
      return acc;
    }, { income: 0, expense: 0 });
    const balance = totals.income - totals.expense;
    const sponsors = (await pool.query(`SELECT * FROM robotics_sponsors WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const incomeByCategory = summary.filter(s => s.type === 'income').map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><span>${esc(s.category || 'Uncategorized')}</span><span style="font-weight:600;color:#16a34a">+$${Number(s.total).toFixed(2)}</span></div>`).join('');
    const expenseByCategory = summary.filter(s => s.type === 'expense').map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><span>${esc(s.category || 'Uncategorized')}</span><span style="font-weight:600;color:#dc2626">-$${Number(s.total).toFixed(2)}</span></div>`).join('');

    const rowsHtml = entries.map(e => `<tr>
      <td>${fmtDate(e.expense_date || e.created_at)}</td>
      <td>${esc(e.description)}</td>
      <td>${esc(e.category || '—')}</td>
      <td style="font-weight:700;color:${e.type === 'income' ? '#16a34a' : '#dc2626'}">${e.type === 'income' ? '+' : '-'}$${Number(e.amount).toFixed(2)}</td>
      <td>${statusBadge(e.type === 'income' ? 'approved' : 'pending')}</td>
    </tr>`).join('');

    const sponsorsHtml = sponsors.map(s => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6">
      <div style="font-size:24px">🏢</div>
      <div style="flex:1"><strong style="font-size:13px">${esc(s.name)}</strong>
        <div style="font-size:11px;color:${GRAY}">${esc(s.contribution_type || '')} · $${Number(s.contribution_value || 0).toFixed(2)} · ${esc(s.contact_person || '')}</div></div>
      ${statusBadge(s.status)}
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('budget')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">💰 Budget Tracker</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Track income, expenses, and sponsors</p></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        ${statCard('$' + totals.income.toFixed(2), 'Total Income', '#16a34a')}
        ${statCard('$' + totals.expense.toFixed(2), 'Total Expenses', '#dc2626')}
        ${statCard('$' + balance.toFixed(2), 'Balance', balance >= 0 ? '#2563eb' : '#dc2626')}
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="margin:0 0 16px">➕ Add Transaction</h3>
        <form method="POST" action="/school/robotics-club/budget" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description *</label><input type="text" name="description" required placeholder="What for?"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Amount ($) *</label><input type="number" name="amount" step="0.01" min="0" required placeholder="0.00"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Type</label><select name="type"><option value="expense">Expense</option><option value="income">Income</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="parts">Parts</option><option value="tools">Tools</option><option value="competition">Competition</option><option value="sponsorship">Sponsorship</option><option value="membership">Membership</option><option value="travel">Travel</option><option value="software">Software</option><option value="other">Other</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date</label><input type="date" name="expense_date" value="${today()}"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Notes</label><input type="text" name="notes" placeholder="Optional notes"></div>
          <button type="submit" class="btn" style="background:#16a34a">+ Add</button>
        </form>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 12px;font-size:15px">📋 Transactions</h3>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:' + GRAY + ';padding:30px">No transactions yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div style="display:grid;gap:16px">
          <div class="card"><h3 style="margin:0 0 8px;font-size:14px;color:#16a34a">💰 Income</h3>${incomeByCategory || '<p style="color:' + GRAY + ';font-size:13px">No income recorded</p>'}</div>
          <div class="card"><h3 style="margin:0 0 8px;font-size:14px;color:#dc2626">💸 Expenses</h3>${expenseByCategory || '<p style="color:' + GRAY + ';font-size:13px">No expenses recorded</p>'}</div>
        </div>
      </div>
      <div class="card"><h3 style="margin:0 0 12px;font-size:15px">🏢 Sponsors (${sponsors.length})</h3>
        ${sponsorsHtml || '<p style="color:' + GRAY + ';text-align:center;padding:20px">No sponsors yet</p>'}
      </div>
    </div>`;
    res.send(renderPage('Budget Tracker', html, user, req));
  }));

  app.post('/school/robotics-club/budget', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { description, amount, type, category, expense_date, notes } = req.body;
    if (!description || !amount) { req.session.flash = { type: 'error', msg: 'Description and amount required' }; return res.redirect('/school/robotics-club/budget'); }
    await pool.query(`INSERT INTO robotics_budget (tenant_id, description, amount, type, category, expense_date, approved_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, description.trim(), parseFloat(amount), type || 'expense', category || 'other', expense_date || null, uid, notes || null]);
    await audit(tid, uid, 'robotics_budget_add', { amount: parseFloat(amount), type, category });
    req.session.flash = { type: 'success', msg: 'Transaction added!' };
    res.redirect('/school/robotics-club/budget');
  }));

  // ============================================================
  // ROUTE 17: GET /school/robotics-club/gallery — Photo Gallery
  // ============================================================
  app.get('/school/robotics-club/gallery', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cat = req.query.category || '';
    let where = ['g.tenant_id=$1'], params = [tid], pi = 2;
    if (cat) { where.push(`g.category=$${pi++}`); params.push(cat); }
    const gallery = (await pool.query(
      `SELECT g.*, p.title AS project_title FROM robotics_gallery g LEFT JOIN robotics_projects p ON p.id=g.project_id WHERE ${where.join(' AND ')} ORDER BY g.uploaded_at DESC LIMIT 60`, params
    )).rows;
    const categories = (await pool.query(`SELECT DISTINCT category FROM robotics_gallery WHERE tenant_id=$1 AND category IS NOT NULL ORDER BY category`, [tid])).rows.map(r => r.category);

    const catTabs = [{ v: '', l: 'All' }, ...categories.map(c => ({ v: c, l: c }))].map(c =>
      `<a href="/school/robotics-club/gallery?category=${encodeURIComponent(c.v)}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${cat === c.v ? '#fff' : GRAY};background:${cat === c.v ? P : '#f3f4f6'}">${c.l}</a>`
    ).join(' ');

    const itemsHtml = gallery.map(g => `<div class="card" style="padding:0;overflow:hidden">
      ${g.image_url ? `<img src="${esc(g.image_url)}" style="width:100%;height:200px;object-fit:cover" alt="${esc(g.title || '')}">` : `<div style="width:100%;height:200px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:48px;color:${GRAY}">🖼️</div>`}
      <div style="padding:12px"><strong style="font-size:13px">${esc(g.title || 'Untitled')}</strong>
        <div style="font-size:11px;color:${GRAY};margin-top:4px">${g.project_title ? esc(g.project_title) + ' · ' : ''}${fmtDate(g.uploaded_at)}</div>
        ${g.description ? `<div style="font-size:12px;color:#374151;margin-top:4px">${esc(g.description.slice(0, 80))}${g.description.length > 80 ? '...' : ''}</div>` : ''}
        ${g.category ? `<span style="display:inline-block;margin-top:6px;background:#eef2ff;color:${P};padding:2px 8px;border-radius:12px;font-size:10px">${esc(g.category)}</span>` : ''}
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('gallery')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🖼️ Robot Gallery</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${gallery.length} photos</p></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 14px">📤 Upload Photo</h3>
        <form method="POST" action="/school/robotics-club/gallery" style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:12px;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Image URL *</label><input type="url" name="image_url" required placeholder="https://..."></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title</label><input type="text" name="title" placeholder="Photo title"></div>
          <div><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><select name="category"><option value="">None</option><option value="build">Build</option><option value="competition">Competition</option><option value="design">Design</option><option value="team">Team</option><option value="prototype">Prototype</option><option value="CAD">CAD</option><option value="testing">Testing</option></select></div>
          <button type="submit" class="btn" style="background:#16a34a">Upload</button>
        </form>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap">${catTabs}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
        ${itemsHtml || '<div style="text-align:center;padding:60px;color:' + GRAY + ';grid-column:1/-1"><p style="font-size:40px;margin-bottom:12px">🖼️</p>No photos in the gallery yet. Upload your first robot photo!</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Robot Gallery', html, user, req));
  }));

  app.post('/school/robotics-club/gallery', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { image_url, title, description, category } = req.body;
    if (!image_url || !image_url.trim()) { req.session.flash = { type: 'error', msg: 'Image URL required' }; return res.redirect('/school/robotics-club/gallery'); }
    await pool.query(`INSERT INTO robotics_gallery (tenant_id, title, image_url, description, category, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, title || null, image_url.trim(), description || null, category || null, uid]);
    await audit(tid, uid, 'robotics_gallery_upload', { title: title || 'Untitled' });
    req.session.flash = { type: 'success', msg: 'Photo uploaded!' };
    res.redirect('/school/robotics-club/gallery');
  }));

  // ============================================================
  // ROUTE 18: GET /school/robotics-club/curriculum — Robotics Curriculum
  // ============================================================
  app.get('/school/robotics-club/curriculum', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const modules = [
      { week: '1-2', title: 'Introduction to Robotics', topics: ['What is robotics?', 'History of robots', 'Types of robots', 'Robotics ethics'], color: '#6366f1' },
      { week: '3-4', title: 'Electronics Basics', topics: ['Ohm\'s law', 'Circuit components', 'Breadboarding', 'Using a multimeter'], color: '#2563eb' },
      { week: '5-6', title: 'Microcontrollers', topics: ['Arduino setup', 'Digital I/O', 'Analog sensors', 'PWM control'], color: '#16a34a' },
      { week: '7-8', title: 'Motor Control', topics: ['DC motors', 'Servo motors', 'Stepper motors', 'Motor drivers (L298N, H-bridge)'], color: '#059669' },
      { week: '9-10', title: 'Sensor Integration', topics: ['Ultrasonic sensors', 'IR sensors', 'Temperature sensors', 'Accelerometers/gyros'], color: '#f59e0b' },
      { week: '11-12', title: 'Programming Robots', topics: ['C++ for Arduino', 'Control structures', 'Serial communication', 'State machines'], color: '#d97706' },
      { week: '13-14', title: 'Robot Design & CAD', topics: ['Design principles', 'Tinkercad/Fusion 360', '3D printing basics', 'Mechanical assembly'], color: '#dc2626' },
      { week: '15-16', title: 'Autonomous Navigation', topics: ['Line following', 'Obstacle avoidance', 'Maze solving', 'PID control'], color: '#8b5cf6' },
      { week: '17-18', title: 'Computer Vision', topics: ['OpenCV basics', 'Color detection', 'Object tracking', 'Camera calibration'], color: '#ec4899' },
      { week: '19-20', title: 'Competition Prep', topics: ['Strategy planning', 'Testing protocols', 'Competition rules', 'Team coordination'], color: '#f43f5e' }
    ];

    const modulesHtml = modules.map(m => `<div class="card" style="border-left:4px solid ${m.color}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span style="background:${m.color};color:#fff;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600">Week ${m.week}</span>
        <strong style="font-size:15px">${esc(m.title)}</strong>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${m.topics.map(t => `<div style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="color:${m.color}">▸</span> ${esc(t)}</div>`).join('')}
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('')}
      <div style="margin-bottom:20px">
        <h1 style="font-size:24px;margin:0">📚 Robotics Curriculum</h1>
        <p style="color:${GRAY};font-size:13px;margin:4px 0 0">20-week structured learning path from beginner to competition-ready</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">${modulesHtml}</div>
    </div>`;
    res.send(renderPage('Robotics Curriculum', html, user, req));
  }));

  // ============================================================
  // ROUTE 19: GET /school/robotics-club/challenges — Programming Challenges
  // ============================================================
  app.get('/school/robotics-club/challenges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const challenges = (await pool.query(`SELECT * FROM robotics_challenges WHERE tenant_id=$1 AND status='active' ORDER BY points DESC`, [tid])).rows;

    const difficultyStars = d => { const m = { beginner: 1, intermediate: 2, advanced: 3 }; return '⭐'.repeat(m[d] || 1) + '☆'.repeat(3 - (m[d] || 1)); };
    const diffColor = d => ({ beginner: '#16a34a', intermediate: '#f59e0b', advanced: '#dc2626' }[d] || GRAY);

    const challengesHtml = challenges.map(c => `<div class="card" style="border-left:4px solid ${diffColor(c.difficulty)}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="font-size:15px">${esc(c.title)}</strong>
        <span style="font-size:13px;color:${P};font-weight:700">${c.points} pts</span>
      </div>
      <div style="display:flex;gap:12px;font-size:12px;color:${GRAY};margin-bottom:8px">
        <span>${difficultyStars(c.difficulty)}</span>
        ${c.category ? `<span style="background:#f3f4f6;padding:2px 8px;border-radius:8px">${esc(c.category)}</span>` : ''}
      </div>
      <p style="font-size:13px;color:#374151;margin:8px 0;line-height:1.5">${esc(c.description || '')}</p>
      ${c.hint ? `<div style="font-size:12px;color:${GRAY};background:#f9fafb;padding:8px 12px;border-radius:8px;margin-top:8px">💡 <strong>Hint:</strong> ${esc(c.hint)}</div>` : ''}
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">⚡ Programming Challenges</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${challenges.length} challenges available</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/robotics-club/challenges/new" class="btn" style="background:#16a34a">+ Create Challenge</a>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
        ${challengesHtml || '<div style="text-align:center;padding:60px;color:' + GRAY + ';grid-column:1/-1"><p style="font-size:40px;margin-bottom:12px">⚡</p>No challenges yet. Ask your mentor to create some!</p></div>'}
      </div>
    </div>`;
    res.send(renderPage('Programming Challenges', html, user, req));
  }));

  app.get('/school/robotics-club/challenges/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/robotics-club/challenges');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('')}
      <a href="/school/robotics-club/challenges" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Challenges</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 16px">⚡ Create Challenge</h2>
        <form method="POST" action="/school/robotics-club/challenges" style="display:flex;flex-direction:column;gap:14px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g., Blink an LED</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Difficulty</label><select name="difficulty"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Points</label><input type="number" name="points" value="100" min="10"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><input type="text" name="category" placeholder="e.g., Arduino"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description *</label><textarea name="description" rows="4" required placeholder="Challenge requirements and objectives..."></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Hint</label><input type="text" name="hint" placeholder="Optional hint to help students"></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Create Challenge</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Challenge', html, user, req));
  }));

  app.post('/school/robotics-club/challenges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'teacher') return res.redirect('/school/robotics-club/challenges');
    const { title, description, difficulty, category, points, hint } = req.body;
    if (!title || !description) { req.session.flash = { type: 'error', msg: 'Title and description required' }; return res.redirect('/school/robotics-club/challenges/new'); }
    await pool.query(`INSERT INTO robotics_challenges (tenant_id, title, description, difficulty, category, points, hint) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, title.trim(), description.trim(), difficulty || 'beginner', category || null, parseInt(points) || 100, hint || null]);
    await audit(tid, req.session.user.id, 'robotics_challenge_create', { title: title.trim() });
    req.session.flash = { type: 'success', msg: 'Challenge created!' };
    res.redirect('/school/robotics-club/challenges');
  }));

  // ============================================================
  // ROUTE 20: POST /school/robotics-club/sensor-data — Log Sensor
  // ============================================================
  app.post('/school/robotics-club/sensor-data', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { project_id, sensor_type, value, unit } = req.body;
    if (!project_id || !sensor_type || value === undefined) { req.session.flash = { type: 'error', msg: 'Project, sensor type, and value required' }; return res.redirect('back'); }
    await pool.query(`INSERT INTO robotics_sensor_data (tenant_id, project_id, sensor_type, value, unit) VALUES ($1,$2,$3,$4,$5)`,
      [tid, parseInt(project_id), sensor_type.trim(), parseFloat(value), unit || null]);
    await audit(tid, req.session.user.id, 'robotics_sensor_log', { project_id: parseInt(project_id), sensor_type: sensor_type.trim() });
    req.session.flash = { type: 'success', msg: 'Sensor data logged!' };
    res.redirect('back');
  }));

  // ============================================================
  // ROUTE 21: POST /school/robotics-club/competitions/:id/checklist
  // ============================================================
  app.post('/school/robotics-club/competitions/:id/checklist', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, cid = req.params.id;
    const { item, assigned_to, due_date } = req.body;
    if (!item || !item.trim()) { req.session.flash = { type: 'error', msg: 'Checklist item required' }; return res.redirect('back'); }
    await pool.query(`INSERT INTO robotics_competition_checklists (tenant_id, competition_id, item, assigned_to, due_date) VALUES ($1,$2,$3,$4,$5)`,
      [tid, parseInt(cid), item.trim(), assigned_to || null, due_date || null]);
    await audit(tid, req.session.user.id, 'robotics_checklist_add', { competition_id: parseInt(cid) });
    req.session.flash = { type: 'success', msg: 'Checklist item added!' };
    res.redirect('back');
  }));

  console.log('[RoboticsClub] Module loaded');
};
