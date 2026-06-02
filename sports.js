// ============================================================
// SPORTS LEAGUE MANAGEMENT MODULE — Multi-Tenant SaaS Platform
// Teams, players, fixtures, results, standings, analytics
// ============================================================
// Usage in server.js:
//   const sports = require('./sports');
//   sports(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function sports(app, db, pool, renderPage, esc) {

  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const pts = (t) => (t.wins || 0) * 3 + (t.draws || 0);
  const played = (t) => (t.wins || 0) + (t.draws || 0) + (t.losses || 0);

  function statusBadge(s) {
    const m = { scheduled: { cls: 'badge', l: 'Scheduled' }, live: { cls: 'badge-warning', l: 'Live' },
      completed: { cls: 'badge-success', l: 'Completed' }, postponed: { cls: 'badge-warning', l: 'Postponed' },
      cancelled: { cls: 'badge-warning', l: 'Cancelled' } };
    const v = m[s] || { cls: 'badge', l: s };
    return `<span class="badge ${v.cls}">${v.l}</span>`;
  }
  const activeBadge = (a) => a ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>';

  const SPORTS = ['football', 'basketball', 'volleyball', 'cricket', 'hockey', 'badminton', 'tennis', 'swimming', 'athletics', 'handball'];
  const ICONS = { football: '⚽', basketball: '🏀', volleyball: '🏐', cricket: '🏏', hockey: '🏑', badminton: '🏸', tennis: '🎾', swimming: '🏊', athletics: '🏃', handball: '🤾' };
  const icon = (s) => ICONS[s] || '🏆';
  const sportLabel = (s) => icon(s) + ' ' + (s || '').charAt(0).toUpperCase() + (s || '').slice(1);
  const sportOpts = (extra) => [extra || { value: '', label: 'All Sports' }, ...SPORTS.map(s => ({ value: s, label: sportLabel(s) }))];

  // -- shared CSS --------------------------------------------------------
  const CSS = `<style>
    .sp-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .sp-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .sp-nav a:hover{background:#e2e8f0}.sp-nav a.active{background:#059669;color:#fff}
    .sp-table{width:100%;border-collapse:collapse;font-size:13px}
    .sp-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .sp-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .sp-table tr:hover{background:#f8fafc}
    .sp-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .sp-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .sp-filter input,.sp-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .sp-filter input:focus,.sp-filter select:focus{outline:none;border-color:#059669}
    .sp-dot{display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;margin-right:6px;border:2px solid #e2e8f0}
    .sp-score{font-size:22px;font-weight:800;letter-spacing:-1px;color:#1e293b}
    .sp-vs{font-size:13px;font-weight:700;color:#94a3b8;margin:0 12px}
    .sp-w{background:#16a34a;color:#fff;width:22px;height:22px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
    .sp-d{background:#f59e0b;color:#fff;width:22px;height:22px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
    .sp-l{background:#dc2626;color:#fff;width:22px;height:22px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
    .sp-pos{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;background:#f1f5f9;color:#475569}
    .sp-pos.top{background:#fbbf24;color:#92400e}
    @media(max-width:768px){.sp-nav{gap:4px}.sp-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  const nav = (a) => `<div class="sp-nav">
    <a href="/sports" class="${a === 'dash' ? 'active' : ''}">🏆 Dashboard</a>
    <a href="/sports/teams" class="${a === 'teams' ? 'active' : ''}">👥 Teams</a>
    <a href="/sports/fixtures" class="${a === 'fixtures' ? 'active' : ''}">📅 Fixtures</a>
    <a href="/sports/standings" class="${a === 'standings' ? 'active' : ''}">📊 Standings</a>
    <a href="/sports/report" class="${a === 'report' ? 'active' : ''}">📈 Analytics</a>
  </div>`;

  const formField = (label, name, type, value, ph, extra) => `<div>
    <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">${label}</label>
    <input type="${type}" name="${name}" value="${esc(value || '')}" placeholder="${esc(ph || '')}" ${extra || ''} style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
  </div>`;

  const selField = (label, name, options, value) => `<div>
    <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">${label}</label>
    <select name="${name}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff">
      ${options.map(o => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'Sports', `CREATE TABLE IF NOT EXISTS sports_teams (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, sport VARCHAR(50) DEFAULT 'football',
        coach_name VARCHAR(255), color VARCHAR(20) DEFAULT '#3b82f6',
        player_count INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, draws INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Sports', `CREATE TABLE IF NOT EXISTS sports_players (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES sports_teams(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, jersey_number INTEGER, position VARCHAR(50),
        goals INTEGER DEFAULT 0, assists INTEGER DEFAULT 0,
        yellow_cards INTEGER DEFAULT 0, red_cards INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Sports', `CREATE TABLE IF NOT EXISTS sports_fixtures (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        home_team_id INTEGER REFERENCES sports_teams(id), away_team_id INTEGER REFERENCES sports_teams(id),
        sport VARCHAR(50), venue VARCHAR(255), match_date TIMESTAMPTZ,
        home_score INTEGER, away_score INTEGER, status VARCHAR(20) DEFAULT 'scheduled',
        season VARCHAR(50), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const cols = {
        sports_teams: [['name',"VARCHAR(255) DEFAULT ''"],['sport',"VARCHAR(50) DEFAULT 'football'"],['coach_name','VARCHAR(255)'],['color',"VARCHAR(20) DEFAULT '#3b82f6'"],['player_count','INTEGER DEFAULT 0'],['wins','INTEGER DEFAULT 0'],['losses','INTEGER DEFAULT 0'],['draws','INTEGER DEFAULT 0'],['is_active','BOOLEAN DEFAULT true']],
        sports_players: [['team_id','INTEGER DEFAULT 0'],['name',"VARCHAR(255) DEFAULT ''"],['jersey_number','INTEGER'],['position','VARCHAR(50)'],['goals','INTEGER DEFAULT 0'],['assists','INTEGER DEFAULT 0'],['yellow_cards','INTEGER DEFAULT 0'],['red_cards','INTEGER DEFAULT 0'],['is_active','BOOLEAN DEFAULT true']],
        sports_fixtures: [['home_team_id','INTEGER'],['away_team_id','INTEGER'],['sport','VARCHAR(50)'],['venue','VARCHAR(255)'],['match_date','TIMESTAMPTZ'],['home_score','INTEGER'],['away_score','INTEGER'],['status',"VARCHAR(20) DEFAULT 'scheduled'"],['season','VARCHAR(50)'],['notes','TEXT']]
      };
      for (const [tbl, list] of Object.entries(cols)) {
        for (const [col, typ] of list) { try { await migrateQuery(pool, 'Sports', `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {} }
      }
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_st_tenant ON sports_teams(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_st_sport ON sports_teams(tenant_id, sport)',
        'CREATE INDEX IF NOT EXISTS idx_st_active ON sports_teams(tenant_id, is_active)',
        'CREATE INDEX IF NOT EXISTS idx_sp_tenant ON sports_players(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sp_team ON sports_players(tenant_id, team_id)',
        'CREATE INDEX IF NOT EXISTS idx_sp_active ON sports_players(tenant_id, is_active)',
        'CREATE INDEX IF NOT EXISTS idx_sf_tenant ON sports_fixtures(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_sf_sport ON sports_fixtures(tenant_id, sport)',
        'CREATE INDEX IF NOT EXISTS idx_sf_status ON sports_fixtures(tenant_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_sf_date ON sports_fixtures(tenant_id, match_date)',
      ];
      for (const sql of indexes) await migrateQuery(pool, 'Sports', sql);
      console.log('[Sports] Migrations applied successfully');
    } catch (e) { console.error('[Sports] Migration error:', e.message); }
  })();

  // Shared query: fixtures with team names
  const getFixtures = async (tid, extraWhere, params) => {
    const w = ['f.tenant_id=$1', ...(extraWhere || [])];
    return (await pool.query(
      `SELECT f.*, ht.name as home_team_name, ht.color as home_color, at.name as away_team_name, at.color as away_color
       FROM sports_fixtures f LEFT JOIN sports_teams ht ON ht.id=f.home_team_id LEFT JOIN sports_teams at ON at.id=f.away_team_id
       WHERE ${w.join(' AND ')} ORDER BY f.match_date DESC NULLS LAST, f.created_at DESC`, params || [tid]
    )).rows;
  };

  // ============================================================
  // ROUTE 1: GET /sports — Dashboard
  // ============================================================
  app.get('/sports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teams = (await pool.query(`SELECT * FROM sports_teams WHERE tenant_id=$1 ORDER BY sport, name`, [tid])).rows;
    const fixtures = await getFixtures(tid);
    const topScorers = (await pool.query(
      `SELECT p.*, t.name as team_name FROM sports_players p JOIN sports_teams t ON t.id=p.team_id
       WHERE p.tenant_id=$1 AND p.is_active=true ORDER BY p.goals DESC, p.assists DESC LIMIT 10`, [tid]
    )).rows;
    const activeTeams = teams.filter(t => t.is_active);
    const upcoming = fixtures.filter(f => f.status === 'scheduled' && new Date(f.match_date) >= new Date()).slice(0, 6);
    const recent = fixtures.filter(f => f.status === 'completed').slice(0, 6);
    const totalPlayers = activeTeams.reduce((s, t) => s + (t.player_count || 0), 0);
    const completedMatches = fixtures.filter(f => f.status === 'completed').length;
    const standings = [...activeTeams].sort((a, b) => pts(b) - pts(a) || (b.wins || 0) - (a.wins || 0)).slice(0, 5);

    const standingsHtml = standings.map((t, i) => `<tr>
      <td><span class="sp-pos ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
      <td><span class="sp-dot" style="background:${esc(t.color)}"></span><strong>${esc(t.name)}</strong></td>
      <td>${sportLabel(t.sport)}</td>
      <td><strong style="color:#16a34a">${t.wins || 0}</strong></td>
      <td><strong style="color:#f59e0b">${t.draws || 0}</strong></td>
      <td><strong style="color:#dc2626">${t.losses || 0}</strong></td>
      <td><strong style="font-size:15px">${pts(t)}</strong></td>
    </tr>`).join('');

    const fixtureRow = (f, showScore) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #f1f5f9">
      <div style="min-width:55px;font-size:11px;color:#64748b;text-align:center">${showScore ? fmtDate(f.match_date) : fmtDateTime(f.match_date).replace(/,\s*/, '<br>')}</div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">
        <span style="flex:1;text-align:right;font-size:13px;font-weight:600">${esc(f.home_team_name || 'TBD')}</span>
        ${showScore && f.home_score != null ? `<span class="sp-score">${f.home_score}</span><span class="sp-vs">–</span><span class="sp-score">${f.away_score}</span>` : '<span class="badge">VS</span>'}
        <span style="flex:1;text-align:left;font-size:13px;font-weight:600">${esc(f.away_team_name || 'TBD')}</span>
      </div>
      <div style="min-width:30px;text-align:right;font-size:11px">${icon(f.sport)}</div>
    </div>`;

    const scorersHtml = topScorers.map((p, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i < topScorers.length - 1 ? 'border-bottom:1px solid #f1f5f9' : ''}">
      <span style="width:22px;height:22px;border-radius:50%;background:${i === 0 ? '#fbbf24' : i === 1 ? '#d1d5db' : i === 2 ? '#cd7f32' : '#f1f5f9'};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${i < 3 ? '#fff' : '#64748b'}">${i + 1}</span>
      <strong style="flex:1;font-size:13px">${esc(p.name)}</strong>
      <span class="muted" style="font-size:11px">${esc(p.team_name)}</span>
      <span style="font-size:14px;font-weight:800;color:#16a34a">⚽${p.goals}</span>
      <span style="font-size:12px;color:#3b82f6">🅰️${p.assists}</span>
    </div>`).join('');

    const html = CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏆 Sports Dashboard</h1><p class="muted" style="font-size:13px">League management, fixtures, and analytics</p></div>
        <div style="display:flex;gap:8px"><a href="/sports/teams/new" class="btn btn-green btn-sm">+ New Team</a><a href="/sports/fixtures/new" class="btn btn-blue btn-sm">+ New Fixture</a></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${activeTeams.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Teams</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${SPORTS.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Sports Tracked</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${totalPlayers}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Players</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${completedMatches}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Matches Played</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${fixtures.filter(f => f.status === 'scheduled').length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Scheduled</div></div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="font-size:15px;color:#1e293b;margin:0">📅 Upcoming Fixtures</h3><a href="/sports/fixtures" style="font-size:12px;color:#059669;text-decoration:none">View all →</a></div>
          ${upcoming.map(f => fixtureRow(f, false)).join('') || '<p class="muted" style="text-align:center;padding:20px">No upcoming fixtures</p>'}
        </div>
        <div class="card" style="padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="font-size:15px;color:#1e293b;margin:0">✅ Recent Results</h3><a href="/sports/fixtures" style="font-size:12px;color:#059669;text-decoration:none">View all →</a></div>
          ${recent.map(f => fixtureRow(f, true)).join('') || '<p class="muted" style="text-align:center;padding:20px">No completed matches yet</p>'}
        </div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><h3 style="font-size:15px;color:#1e293b;margin:0">📊 Top Standings</h3><a href="/sports/standings" style="font-size:12px;color:#059669;text-decoration:none">Full table →</a></div>
          <div style="overflow-x:auto"><table class="sp-table"><thead><tr><th>#</th><th>Team</th><th>Sport</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead>
          <tbody>${standingsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">No teams yet</td></tr>'}</tbody></table></div>
        </div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚽ Top Scorers</h3>
          ${scorersHtml || '<p class="muted" style="text-align:center;padding:20px">No player stats yet</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Sports Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /sports/teams — Team list
  // ============================================================
  app.get('/sports/teams', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sf = req.query.sport || '';
    let w = ['tenant_id=$1'], p = [tid], pi = 2;
    if (sf) { w.push(`sport=$${pi++}`); p.push(sf); }
    const teams = (await pool.query(`SELECT * FROM sports_teams WHERE ${w.join(' AND ')} ORDER BY sport, name`, p)).rows;
    const rowsHtml = teams.map(t => `<tr>
      <td><span class="sp-dot" style="background:${esc(t.color)}"></span><strong>${esc(t.name)}</strong></td>
      <td>${sportLabel(t.sport)}</td>
      <td>${esc(t.coach_name || '—')}</td>
      <td>${t.player_count || 0}</td>
      <td><strong style="color:#16a34a">${t.wins || 0}</strong>/<strong style="color:#f59e0b">${t.draws || 0}</strong>/<strong style="color:#dc2626">${t.losses || 0}</strong></td>
      <td><strong>${pts(t)}</strong> <span class="muted">(${played(t)})</span></td>
      <td>${activeBadge(t.is_active)}</td>
      <td><a href="/sports/teams/${t.id}" class="btn btn-sm btn-blue">View</a></td>
    </tr>`).join('');
    const html = CSS + `<div style="max-width:1200px;margin:0 auto">${nav('teams')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">👥 Teams</h1><p class="muted" style="font-size:13px">Manage sports teams and rosters</p></div>
        <a href="/sports/teams/new" class="btn btn-green btn-sm">+ New Team</a>
      </div>
      <div class="sp-filter">${selField('Sport', 'sport', sportOpts(), sf)}</div>
      <div class="card"><div style="overflow-x:auto"><table class="sp-table">
        <thead><tr><th>Team</th><th>Sport</th><th>Coach</th><th>Players</th><th>W/D/L</th><th>Pts</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No teams found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Teams', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /sports/teams/new — Add team form
  // ============================================================
  app.get('/sports/teams/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = CSS + `<div style="max-width:700px;margin:0 auto">${nav('teams')}
      <a href="/sports/teams" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Teams</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ New Team</h2>
        <p class="muted" style="font-size:13px;margin-bottom:24px">Create a new sports team for your school</p>
        <form method="POST" action="/sports/teams/create" style="display:flex;flex-direction:column;gap:18px">
          ${formField('Team Name *', 'name', 'text', '', 'e.g., Eagles FC')}
          ${selField('Sport *', 'sport', SPORTS.map(s => ({ value: s, label: sportLabel(s) })), 'football')}
          ${formField('Coach Name', 'coach_name', 'text', '', 'e.g., Coach Smith')}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${formField('Team Color', 'color', 'color', '#3b82f6', '', 'style="height:44px;padding:4px"')}<div></div></div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">Create Team</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Team', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /sports/teams/create — Save team
  // ============================================================
  app.post('/sports/teams/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, sport, coach_name, color } = req.body;
    if (!name || !name.trim()) return res.redirect('/sports/teams/new');
    await pool.query(`INSERT INTO sports_teams (tenant_id, name, sport, coach_name, color) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name.trim(), sport || 'football', coach_name ? coach_name.trim() : null, color || '#3b82f6']);
    req.session.flash = { type: 'success', msg: `Team "${name.trim()}" created successfully` };
    res.redirect('/sports/teams');
  }));

  // ============================================================
  // ROUTE 5: GET /sports/teams/:id — Team detail
  // ============================================================
  app.get('/sports/teams/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, teamId = req.params.id;
    const team = (await pool.query(`SELECT * FROM sports_teams WHERE id=$1 AND tenant_id=$2`, [teamId, tid])).rows[0];
    if (!team) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Team not found</h2><a href="/sports/teams" class="btn btn-blue btn-sm" style="margin-top:12px">← Teams</a></div>', user, req));
    const players = (await pool.query(`SELECT * FROM sports_players WHERE team_id=$1 AND tenant_id=$2 ORDER BY jersey_number NULLS LAST, name`, [teamId, tid])).rows;
    const matches = (await pool.query(
      `SELECT f.*, ht.name as opp_name FROM sports_fixtures f
       LEFT JOIN sports_teams ht ON ht.id = CASE WHEN f.home_team_id=$1 THEN f.away_team_id ELSE f.home_team_id END
       WHERE f.tenant_id=$2 AND (f.home_team_id=$1 OR f.away_team_id=$1) ORDER BY f.match_date DESC NULLS LAST LIMIT 15`, [teamId, tid]
    )).rows;

    const playersHtml = players.map(p => `<tr>
      <td><strong>${p.jersey_number != null ? '#' + p.jersey_number : '—'}</strong></td>
      <td>${esc(p.name)}</td><td>${esc(p.position || '—')}</td>
      <td>⚽${p.goals || 0} 🅰️${p.assists || 0}</td>
      <td>${p.yellow_cards || 0}🟨 ${p.red_cards || 0}🟥</td>
      <td>${activeBadge(p.is_active)}</td>
      <td><form method="POST" action="/sports/players/${p.id}/remove" style="display:inline" onsubmit="return confirm('Remove ${esc(p.name)}?')">
        <button class="btn btn-red btn-sm" type="submit">Remove</button></form></td>
    </tr>`).join('');

    const matchesHtml = matches.map(f => {
      const isHome = f.home_team_id === parseInt(teamId);
      const ts = isHome ? f.home_score : f.away_score, os = isHome ? f.away_score : f.home_score;
      const r = f.status === 'completed' ? (ts > os ? '<span class="sp-w">W</span>' : ts < os ? '<span class="sp-l">L</span>' : '<span class="sp-d">D</span>') : '';
      return `<tr>
        <td>${statusBadge(f.status)}</td><td>${fmtDate(f.match_date)}</td>
        <td>${isHome ? 'vs' : '@'} <strong>${esc(f.opp_name || 'TBD')}</strong></td>
        <td>${f.status === 'completed' ? `<span class="sp-score">${ts} - ${os}</span>` : '<span class="muted">—</span>'}</td>
        <td>${r}</td><td><a href="/sports/fixtures/${f.id}" class="btn btn-sm btn-blue">View</a></td>
      </tr>`;
    }).join('');

    const html = CSS + `<div style="max-width:1200px;margin:0 auto">${nav('teams')}
      <a href="/sports/teams" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Teams</a>
      <div class="card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div style="width:60px;height:60px;border-radius:14px;background:${esc(team.color)};display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;flex-shrink:0">${icon(team.sport)}</div>
          <div style="flex:1">
            <h2 style="margin:0;color:#1e293b;font-size:22px">${esc(team.name)}</h2>
            <div style="font-size:13px;color:#64748b;margin-top:4px">${sportLabel(team.sport)} · Coach: ${esc(team.coach_name || 'Not assigned')} · ${activeBadge(team.is_active)}</div>
          </div>
          <div class="stats" style="display:flex;gap:12px">
            <div class="stat-card" style="text-align:center"><div class="stat-num" style="color:#16a34a;font-size:18px">${team.wins || 0}</div><div class="muted" style="font-size:10px">Wins</div></div>
            <div class="stat-card" style="text-align:center"><div class="stat-num" style="color:#f59e0b;font-size:18px">${team.draws || 0}</div><div class="muted" style="font-size:10px">Draws</div></div>
            <div class="stat-card" style="text-align:center"><div class="stat-num" style="color:#dc2626;font-size:18px">${team.losses || 0}</div><div class="muted" style="font-size:10px">Losses</div></div>
            <div class="stat-card" style="text-align:center"><div class="stat-num" style="color:#1e293b;font-size:18px">${pts(team)}</div><div class="muted" style="font-size:10px">Points</div></div>
            <div class="stat-card" style="text-align:center"><div class="stat-num" style="color:#64748b;font-size:18px">${played(team)}</div><div class="muted" style="font-size:10px">Played</div></div>
          </div>
        </div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <h3 style="font-size:15px;color:#1e293b;margin:0">📋 Squad (${players.length})</h3>
          <form method="POST" action="/sports/teams/${teamId}/players/add" style="display:flex;gap:6px;flex-wrap:wrap">
            <input type="text" name="name" placeholder="Player name" required style="padding:7px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">
            <input type="number" name="jersey_number" placeholder="#" style="width:50px;padding:7px 8px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">
            <input type="text" name="position" placeholder="Position" style="padding:7px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">
            <button type="submit" class="btn btn-green btn-sm">+ Add</button>
          </form>
        </div>
        <div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>#</th><th>Name</th><th>Position</th><th>Goals/Assists</th><th>Cards</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${playersHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No players yet</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🏟️ Recent Matches</h3>
        <div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>Status</th><th>Date</th><th>Opponent</th><th>Score</th><th>Result</th><th>Detail</th></tr></thead>
          <tbody>${matchesHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No matches yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage(team.name, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /sports/teams/:id/players/add
  // ============================================================
  app.post('/sports/teams/:id/players/add', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, teamId = req.params.id;
    const team = (await pool.query(`SELECT id FROM sports_teams WHERE id=$1 AND tenant_id=$2`, [teamId, tid])).rows[0];
    if (!team) return res.redirect('/sports/teams');
    const { name, jersey_number, position } = req.body;
    if (!name || !name.trim()) return res.redirect('/sports/teams/' + teamId);
    await pool.query(`INSERT INTO sports_players (tenant_id, team_id, name, jersey_number, position) VALUES ($1,$2,$3,$4,$5)`,
      [tid, teamId, name.trim(), jersey_number ? parseInt(jersey_number) : null, position ? position.trim() : null]);
    await pool.query(`UPDATE sports_teams SET player_count=(SELECT COUNT(*) FROM sports_players WHERE team_id=$1 AND tenant_id=$2 AND is_active=true) WHERE id=$1 AND tenant_id=$2`, [teamId, tid]);
    res.redirect('/sports/teams/' + teamId);
  }));

  // ============================================================
  // ROUTE 7: POST /sports/players/:id/remove
  // ============================================================
  app.post('/sports/players/:id/remove', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, playerId = req.params.id;
    const player = (await pool.query(`SELECT team_id FROM sports_players WHERE id=$1 AND tenant_id=$2`, [playerId, tid])).rows[0];
    if (!player) return res.redirect('/sports/teams');
    await pool.query(`DELETE FROM sports_players WHERE id=$1 AND tenant_id=$2`, [playerId, tid]);
    await pool.query(`UPDATE sports_teams SET player_count=(SELECT COUNT(*) FROM sports_players WHERE team_id=$1 AND tenant_id=$2 AND is_active=true) WHERE id=$1 AND tenant_id=$2`, [player.team_id, tid]);
    res.redirect('/sports/teams/' + player.team_id);
  }));

  // ============================================================
  // ROUTE 8: GET /sports/fixtures — Fixture list
  // ============================================================
  app.get('/sports/fixtures', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const sf = req.query.sport || '', stf = req.query.status || '', df = req.query.date || '';
    let w = [], p = [tid], pi = 2;
    if (sf) { w.push(`f.sport=$${pi++}`); p.push(sf); }
    if (stf) { w.push(`f.status=$${pi++}`); p.push(stf); }
    if (df) { w.push(`f.match_date::date=$${pi++}`); p.push(df); }
    const fixtures = await getFixtures(tid, w, p);

    const rowsHtml = fixtures.map(f => `<tr>
      <td>${statusBadge(f.status)}</td><td>${sportLabel(f.sport)}</td>
      <td style="font-weight:600">${esc(f.home_team_name || 'TBD')}</td>
      <td style="text-align:center">${f.status === 'completed' ? `<span class="sp-score">${f.home_score ?? '-'}</span> <span class="sp-vs">–</span> <span class="sp-score">${f.away_score ?? '-'}</span>` : '<span class="badge">VS</span>'}</td>
      <td style="font-weight:600">${esc(f.away_team_name || 'TBD')}</td>
      <td>${fmtDateTime(f.match_date)}</td><td>${esc(f.venue || '—')}</td>
      <td><a href="/sports/fixtures/${f.id}" class="btn btn-sm btn-blue">View</a></td>
    </tr>`).join('');

    const statusOpts = [{ value: '', label: 'All Status' }, { value: 'scheduled', label: '📅 Scheduled' }, { value: 'live', label: '🔴 Live' }, { value: 'completed', label: '✅ Completed' }, { value: 'postponed', label: '⏸️ Postponed' }, { value: 'cancelled', label: '❌ Cancelled' }];

    const html = CSS + `<div style="max-width:1200px;margin:0 auto">${nav('fixtures')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📅 Fixtures</h1><p class="muted" style="font-size:13px">Match schedule and results</p></div>
        <a href="/sports/fixtures/new" class="btn btn-green btn-sm">+ New Fixture</a>
      </div>
      <div class="sp-filter">
        ${selField('Sport', 'sport', sportOpts(), sf)}
        ${selField('Status', 'status', statusOpts, stf)}
        <div><label>Date</label><input type="date" value="${esc(df)}" onchange="location.href='/sports/fixtures?sport=${esc(sf)}&status=${esc(stf)}&date='+this.value"></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="sp-table">
        <thead><tr><th>Status</th><th>Sport</th><th>Home</th><th>Score</th><th>Away</th><th>Date</th><th>Venue</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No fixtures found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Fixtures', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /sports/fixtures/new — Create fixture form
  // ============================================================
  app.get('/sports/fixtures/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teams = (await pool.query(`SELECT id, name, sport FROM sports_teams WHERE tenant_id=$1 AND is_active=true ORDER BY sport, name`, [tid])).rows;
    const teamOpts = [{ value: '', label: 'Select team' }, ...teams.map(t => ({ value: t.id, label: `${sportLabel(t.sport)} ${t.name}` }))];
    const season = new Date().getFullYear() + '-' + (new Date().getFullYear() + 1);
    const html = CSS + `<div style="max-width:700px;margin:0 auto">${nav('fixtures')}
      <a href="/sports/fixtures" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Fixtures</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ New Fixture</h2>
        <p class="muted" style="font-size:13px;margin-bottom:24px">Schedule a new match</p>
        <form method="POST" action="/sports/fixtures/create" style="display:flex;flex-direction:column;gap:18px">
          ${selField('Sport', 'sport', SPORTS.map(s => ({ value: s, label: sportLabel(s) })), 'football')}
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:end">
            ${selField('Home Team', 'home_team_id', teamOpts, '')}
            <div style="padding-bottom:22px;font-weight:800;color:#94a3b8;font-size:16px">VS</div>
            ${selField('Away Team', 'away_team_id', teamOpts, '')}
          </div>
          ${formField('Match Date & Time *', 'match_date', 'datetime-local', '', '')}
          ${formField('Venue', 'venue', 'text', '', 'e.g., Main Field')}
          ${formField('Season', 'season', 'text', season, 'e.g., 2024-2025')}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Notes</label>
            <textarea name="notes" rows="3" placeholder="Optional..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px">Schedule Match</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Fixture', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /sports/fixtures/create — Save fixture
  // ============================================================
  app.post('/sports/fixtures/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { sport, home_team_id, away_team_id, match_date, venue, season, notes } = req.body;
    if (!sport || !match_date) return res.redirect('/sports/fixtures/new');
    await pool.query(`INSERT INTO sports_fixtures (tenant_id, sport, home_team_id, away_team_id, match_date, venue, season, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled')`,
      [tid, sport, home_team_id || null, away_team_id || null, match_date || null, venue ? venue.trim() : null, season ? season.trim() : null, notes ? notes.trim() : null]);
    req.session.flash = { type: 'success', msg: 'Fixture scheduled successfully' };
    res.redirect('/sports/fixtures');
  }));

  // ============================================================
  // ROUTE 11: POST /sports/fixtures/:id/result — Submit result
  // ============================================================
  app.post('/sports/fixtures/:id/result', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, fixtureId = req.params.id;
    const fixture = (await pool.query(`SELECT * FROM sports_fixtures WHERE id=$1 AND tenant_id=$2`, [fixtureId, tid])).rows[0];
    if (!fixture) return res.redirect('/sports/fixtures');
    const { home_score, away_score, status } = req.body;
    const hs = home_score != null && home_score !== '' ? parseInt(home_score) : null;
    const as2 = away_score != null && away_score !== '' ? parseInt(away_score) : null;
    const newStatus = status || 'completed';
    await pool.query(`UPDATE sports_fixtures SET home_score=$1, away_score=$2, status=$3 WHERE id=$4 AND tenant_id=$5`, [hs, as2, newStatus, fixtureId, tid]);
    if (newStatus === 'completed' && hs != null && as2 != null && fixture.home_team_id && fixture.away_team_id) {
      let homeResult, awayResult;
      if (hs > as2) { homeResult = 'wins'; awayResult = 'losses'; }
      else if (hs < as2) { homeResult = 'losses'; awayResult = 'wins'; }
      else { homeResult = 'draws'; awayResult = 'draws'; }
      await pool.query(`UPDATE sports_teams SET ${homeResult} = ${homeResult} + 1 WHERE id=$1 AND tenant_id=$2`, [fixture.home_team_id, tid]);
      await pool.query(`UPDATE sports_teams SET ${awayResult} = ${awayResult} + 1 WHERE id=$1 AND tenant_id=$2`, [fixture.away_team_id, tid]);
    }
    req.session.flash = { type: 'success', msg: 'Match result updated' };
    res.redirect('/sports/fixtures/' + fixtureId);
  }));

  // ============================================================
  // ROUTE 12: GET /sports/fixtures/:id — Fixture detail
  // ============================================================
  app.get('/sports/fixtures/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, fixtureId = req.params.id;
    const f = (await pool.query(
      `SELECT f.*, ht.name as home_team_name, ht.color as home_color, at.name as away_team_name, at.color as away_color
       FROM sports_fixtures f LEFT JOIN sports_teams ht ON ht.id=f.home_team_id LEFT JOIN sports_teams at ON at.id=f.away_team_id
       WHERE f.id=$1 AND f.tenant_id=$2`, [fixtureId, tid]
    )).rows[0];
    if (!f) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Fixture not found</h2><a href="/sports/fixtures" class="btn btn-blue btn-sm" style="margin-top:12px">← Fixtures</a></div>', user, req));

    const html = CSS + `<div style="max-width:800px;margin:0 auto">${nav('fixtures')}
      <a href="/sports/fixtures" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Fixtures</a>
      <div class="card" style="padding:32px;text-align:center;margin-bottom:16px">
        <div style="margin-bottom:8px">${statusBadge(f.status)} ${sportLabel(f.sport)}</div>
        <h1 style="font-size:28px;color:#1e293b;margin:16px 0">${esc(f.home_team_name || 'TBD')} vs ${esc(f.away_team_name || 'TBD')}</h1>
        <div style="margin:20px 0">${f.status === 'completed'
          ? `<div style="display:flex;align-items:center;justify-content:center;gap:20px">
              <div><div style="font-size:14px;color:#64748b;margin-bottom:4px">${esc(f.home_team_name || 'Home')}</div><div class="sp-score">${f.home_score ?? 0}</div></div>
              <div style="font-size:20px;color:#94a3b8;font-weight:800">—</div>
              <div><div style="font-size:14px;color:#64748b;margin-bottom:4px">${esc(f.away_team_name || 'Away')}</div><div class="sp-score">${f.away_score ?? 0}</div></div>
            </div>`
          : `<div style="font-size:18px;color:#94a3b8">Match ${f.status === 'live' ? 'in progress' : 'not yet played'}</div>`}
        </div>
        <div style="display:flex;justify-content:center;gap:20px;font-size:13px;color:#64748b;margin-top:16px;flex-wrap:wrap">
          <div>📅 ${fmtDateTime(f.match_date)}</div>
          ${f.venue ? `<div>🏟️ ${esc(f.venue)}</div>` : ''}
          ${f.season ? `<div>🏆 ${esc(f.season)}</div>` : ''}
        </div>
        ${f.notes ? `<div style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569">${esc(f.notes)}</div>` : ''}
      </div>
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">${f.status === 'completed' ? '✏️ Edit Result' : '📝 Submit Result'}</h3>
        <form method="POST" action="/sports/fixtures/${f.id}/result" style="display:flex;align-items:end;gap:14px;flex-wrap:wrap">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">${esc(f.home_team_name || 'Home')} Score</label>
            <input type="number" name="home_score" value="${f.home_score ?? ''}" min="0" style="width:80px;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;text-align:center;font-weight:700"></div>
          <span style="font-size:16px;font-weight:800;color:#94a3b8;padding-bottom:10px">—</span>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">${esc(f.away_team_name || 'Away')} Score</label>
            <input type="number" name="away_score" value="${f.away_score ?? ''}" min="0" style="width:80px;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:16px;text-align:center;font-weight:700"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff">
              <option value="completed" ${f.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="scheduled" ${f.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
              <option value="live" ${f.status === 'live' ? 'selected' : ''}>Live</option>
              <option value="postponed" ${f.status === 'postponed' ? 'selected' : ''}>Postponed</option>
              <option value="cancelled" ${f.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select></div>
          <button type="submit" class="btn btn-green btn-sm">Save Result</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Fixture Detail', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /sports/standings — League standings
  // ============================================================
  app.get('/sports/standings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sf = req.query.sport || '';
    let w = ['tenant_id=$1', 'is_active=true'], p = [tid], pi = 2;
    if (sf) { w.push(`sport=$${pi++}`); p.push(sf); }
    const teams = (await pool.query(`SELECT * FROM sports_teams WHERE ${w.join(' AND ')} ORDER BY sport, name`, p)).rows;
    teams.sort((a, b) => pts(b) - pts(a) || (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0));

    const grouped = {};
    teams.forEach(t => { (grouped[t.sport || 'other'] = grouped[t.sport || 'other'] || []).push(t); });

    let tablesHtml = '';
    for (const sport of Object.keys(grouped).sort()) {
      const rowsHtml = grouped[sport].map((t, i) => `<tr>
        <td><span class="sp-pos ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
        <td><a href="/sports/teams/${t.id}" style="text-decoration:none;color:#1e293b"><span class="sp-dot" style="background:${esc(t.color)}"></span><strong>${esc(t.name)}</strong></a></td>
        <td>${played(t)}</td><td style="color:#16a34a;font-weight:700">${t.wins || 0}</td>
        <td style="color:#f59e0b;font-weight:700">${t.draws || 0}</td><td style="color:#dc2626;font-weight:700">${t.losses || 0}</td>
        <td><strong style="font-size:16px">${pts(t)}</strong></td><td>${t.player_count || 0}</td>
      </tr>`).join('');
      tablesHtml += `<div style="margin-bottom:24px"><h3 style="font-size:16px;color:#1e293b;margin:0 0 12px">${sportLabel(sport)} League</h3>
        <div class="card"><div style="overflow-x:auto"><table class="sp-table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Players</th></tr></thead>
          <tbody>${rowsHtml}</tbody></table></div></div></div>`;
    }
    if (!tablesHtml) tablesHtml = '<div class="card" style="text-align:center;padding:40px"><p class="muted" style="font-size:14px">No active teams found</p><a href="/sports/teams/new" class="btn btn-green btn-sm" style="margin-top:12px">+ New Team</a></div>';

    const html = CSS + `<div style="max-width:1000px;margin:0 auto">${nav('standings')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 League Standings</h1><p class="muted" style="font-size:13px">Points table sorted by league points</p></div>
        ${selField('Filter by Sport', 'sport', sportOpts(), sf)}
      </div>
      ${tablesHtml}
    </div>`;
    res.send(renderPage('Standings', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /sports/report — Sports analytics
  // ============================================================
  app.get('/sports/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sf = req.query.sport || '';
    const allTeams = (await pool.query(`SELECT * FROM sports_teams WHERE tenant_id=$1 AND is_active=true`, [tid])).rows;
    const filtered = sf ? allTeams.filter(t => t.sport === sf) : allTeams;
    const fixtures = (await pool.query(
      `SELECT * FROM sports_fixtures WHERE tenant_id=$1 ${sf ? 'AND sport=$2' : ''} ORDER BY match_date DESC NULLS LAST`,
      sf ? [tid, sf] : [tid]
    )).rows;
    const completed = fixtures.filter(f => f.status === 'completed');
    const totalGoals = completed.reduce((s, f) => s + (f.home_score || 0) + (f.away_score || 0), 0);
    const avgGoals = completed.length > 0 ? (totalGoals / completed.length).toFixed(1) : '0';

    // Per-sport stats
    const ss = {};
    allTeams.forEach(t => {
      const sp = t.sport || 'other';
      if (!ss[sp]) ss[sp] = { teams: 0, players: 0, wins: 0, losses: 0, draws: 0, matches: 0 };
      ss[sp].teams++; ss[sp].players += (t.player_count || 0);
      ss[sp].wins += (t.wins || 0); ss[sp].losses += (t.losses || 0); ss[sp].draws += (t.draws || 0);
    });
    fixtures.forEach(f => { const sp = f.sport || 'other'; if (!ss[sp]) ss[sp] = { teams: 0, players: 0, wins: 0, losses: 0, draws: 0, matches: 0 }; ss[sp].matches++; });

    const ssHtml = Object.keys(ss).sort().map(sp => {
      const s = ss[sp], p2 = s.wins + s.draws + s.losses;
      return `<tr><td><strong>${sportLabel(sp)}</strong></td><td>${s.teams}</td><td>${s.players}</td><td>${s.matches}</td>
        <td style="color:#16a34a;font-weight:600">${s.wins}</td><td style="color:#f59e0b;font-weight:600">${s.draws}</td>
        <td style="color:#dc2626;font-weight:600">${s.losses}</td><td>${p2 > 0 ? Math.round(s.wins / p2 * 100) + '%' : '—'}</td></tr>`;
    }).join('');

    const queryTop = async (orderCol, limit) => (await pool.query(
      `SELECT p.*, t.name as team_name FROM sports_players p JOIN sports_teams t ON t.id=p.team_id
       WHERE p.tenant_id=$1 ${sf ? 'AND t.sport=$2' : ''} AND p.is_active=true ORDER BY ${orderCol} DESC LIMIT ${limit}`,
      sf ? [tid, sf] : [tid]
    )).rows;

    const topGoals = await queryTop('p.goals', 10);
    const topAssists = await queryTop('p.assists', 10);
    const topCards = await queryTop('(p.yellow_cards + p.red_cards*2)', 10);

    const playerList = (list, type) => list.map((p, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;${i < list.length - 1 ? 'border-bottom:1px solid #f1f5f9' : ''}">
      <span style="width:22px;text-align:center;font-size:11px;font-weight:800;color:#94a3b8">${i + 1}</span>
      <strong style="flex:1;font-size:13px">${esc(p.name)}</strong>
      <span class="muted" style="font-size:11px">${esc(p.team_name)}</span>
      <span style="font-size:13px;font-weight:800;color:${type === 'goals' ? '#16a34a' : type === 'assists' ? '#3b82f6' : '#f59e0b'}">${type === 'goals' ? '⚽' + p.goals : type === 'assists' ? '🅰️' + p.assists : '🟨' + p.yellow_cards + ' 🟥' + p.red_cards}</span>
    </div>`).join('');

    // Sport distribution chart
    const maxT = Math.max(1, ...Object.values(ss).map(s => s.teams));
    const colors = { football: '#16a34a', basketball: '#f59e0b', volleyball: '#3b82f6', cricket: '#8b5cf6', hockey: '#ef4444', badminton: '#06b6d4', tennis: '#d946ef', swimming: '#0ea5e9', athletics: '#f97316', handball: '#84cc16' };
    const distChart = Object.keys(ss).sort().map(sp => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="min-width:80px;font-size:12px;font-weight:600;color:#475569">${sportLabel(sp)}</span>
      <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
        <div style="height:100%;width:${Math.round(ss[sp].teams / maxT * 100)}%;background:${colors[sp] || '#64748b'};border-radius:6px"></div>
        <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700">${ss[sp].teams} teams</span>
      </div>
    </div>`).join('');

    const totalPlayers = allTeams.reduce((s, t) => s + (t.player_count || 0), 0);
    const html = CSS + `<div style="max-width:1200px;margin:0 auto">${nav('report')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📈 Sports Analytics</h1><p class="muted" style="font-size:13px">Per-sport statistics and top performers</p></div>
        ${selField('Sport', 'sport', sportOpts(), sf)}
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${allTeams.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Teams</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${totalPlayers}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Players</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${completed.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Matches Played</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${totalGoals}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Goals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${avgGoals}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Avg Goals/Match</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#06b6d4">${Object.keys(ss).length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Sports Active</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Per-Sport Statistics</h3>
          <div style="overflow-x:auto"><table class="sp-table">
            <thead><tr><th>Sport</th><th>Teams</th><th>Players</th><th>Matches</th><th>W</th><th>D</th><th>L</th><th>Win%</th></tr></thead>
            <tbody>${ssHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Sport Distribution</h3>${distChart || '<p class="muted">No data</p>'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⚽ Top Goalscorers</h3>${playerList(topGoals, 'goals') || '<p class="muted">No goals</p>'}</div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🅰️ Top Assists</h3>${playerList(topAssists, 'assists') || '<p class="muted">No assists</p>'}</div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🟨 Most Carded</h3>${playerList(topCards, 'cards') || '<p class="muted">No cards</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage('Sports Analytics', html, user, req));
  }));

  console.log('[Sports] Sports league management loaded');
};
