module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}.btn-warning{background:#d97706}.btn-warning:hover{background:#b45309}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-draft{background:#fef3c7;color:#92400e}.badge-upcoming{background:#dbeafe;color:#1e40af}.badge-active{background:#d1fae5;color:#065f46}.badge-judging{background:#ede9fe;color:#5b21b6}.badge-completed{background:#e5e7eb;color:#374151}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-num{font-size:28px;font-weight:700;color:#4f46e5}.stat-label{font-size:13px;color:#6b7280;margin-top:4px}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:#4f46e5;border-radius:4px}.empty{text-align:center;padding:40px;color:#6b7280}.countdown{font-size:24px;font-weight:700;color:#4f46e5;font-variant-numeric:tabular-nums}.leaderboard-row{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid #f3f4f6}.leaderboard-rank{font-size:18px;font-weight:700;min-width:32px;text-align:center}.leaderboard-name{flex:1;font-weight:600}.leaderboard-score{font-weight:700;color:#4f46e5;font-size:16px}</style>';

  /* ── Database Migration ── */
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS hackathons (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(300) NOT NULL,
        theme VARCHAR(200) NOT NULL, description TEXT, start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ, max_team_size INT DEFAULT 4,
        prize_pool NUMERIC(10,2) DEFAULT 0, status VARCHAR(50) DEFAULT 'draft',
        sponsors JSONB DEFAULT '[]', judging_criteria JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hackathon_teams (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, hackathon_id INT NOT NULL,
        name VARCHAR(200) NOT NULL, members JSONB DEFAULT '[]',
        project_name VARCHAR(300), project_description TEXT,
        repo_url TEXT, demo_url TEXT, tech_stack JSONB DEFAULT '[]',
        score NUMERIC(6,2) DEFAULT 0, rank INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hackathon_challenges (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, hackathon_id INT NOT NULL,
        title VARCHAR(300) NOT NULL, description TEXT, difficulty VARCHAR(50) DEFAULT 'medium',
        sponsor VARCHAR(200), points INT DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS hackathon_submissions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, team_id INT NOT NULL,
        challenge_id INT NOT NULL, description TEXT,
        demo_url TEXT, code_url TEXT, submitted_at TIMESTAMPTZ DEFAULT NOW(),
        judge_score NUMERIC(6,2) DEFAULT 0, judge_comments TEXT
      )`);
      console.log('[Mod] hackathon-platform OK');
    } catch (e) { console.warn('[Mod] hackathon-platform Warn:', e.message); }
  })();

  const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];
  const STATUSES = ['draft', 'upcoming', 'active', 'judging', 'completed'];
  const DEFAULT_CRITERIA = { innovation: 25, technical: 25, design: 20, impact: 15, presentation: 15 };

  /* ── Dashboard ── */
  app.get('/school/hackathon', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [hackathons] = await pool.query('SELECT * FROM hackathons WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const [allTeams] = await pool.query(
      'SELECT t.*, h.title as hackathon_title FROM hackathon_teams t JOIN hackathons h ON h.id=t.hackathon_id WHERE t.tenant_id=$1 ORDER BY t.score DESC LIMIT 20',
      [tid]
    );
    const activeCount = hackathons.filter(h => h.status === 'active').length;
    const totalTeams = allTeams.length;
    const totalSubs = await (async () => {
      const [r] = await pool.query('SELECT COUNT(*) as cnt FROM hackathon_submissions WHERE tenant_id=$1', [tid]);
      return r[0].cnt;
    })();
    const totalPrize = hackathons.reduce((a, h) => a + Number(h.prize_pool || 0), 0);

    const rows = hackathons.map(h => {
      const isLive = h.status === 'active';
      return `<tr>
        <td><a href="/school/hackathon/${h.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(h.title)}</a>
          ${isLive ? ' <span class="badge badge-active">🔴 LIVE</span>' : ''}</td>
        <td>${esc(h.theme)}</td>
        <td><span class="badge badge-${h.status}">${esc(h.status)}</span></td>
        <td>${h.start_date ? new Date(h.start_date).toLocaleDateString() : '-'}</td>
        <td>$${Number(h.prize_pool || 0).toFixed(0)}</td>
        <td>${(h.sponsors || []).length} sponsors</td>
        <td><a class="btn btn-sm" href="/school/hackathon/${h.id}">Manage</a></td>
      </tr>`;
    }).join('');

    const topTeams = allTeams.slice(0, 5).map((t, i) =>
      `<div class="leaderboard-row">
        <div class="leaderboard-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</div>
        <div class="leaderboard-name">${esc(t.name)}</div>
        <div class="leaderboard-score">${t.score} pts</div>
      </div>`).join('');

    const html = `${SKIP}
    <div style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:8px">
        <h1 style="color:${P};margin:0">💻 Hackathon Platform</h1>
        <a class="btn" href="/school/hackathon/create">+ New Hackathon</a>
      </div>
      <p style="color:${GRAY};margin-bottom:20px">Organize hackathons, manage teams, challenges and judging</p>
      <div class="grid" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-num">${hackathons.length}</div><div class="stat-label">Total Hackathons</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${activeCount}</div><div class="stat-label">Active Now</div></div>
        <div class="stat-card"><div class="stat-num">${totalTeams}</div><div class="stat-label">Teams</div></div>
        <div class="stat-card"><div class="stat-num">${totalSubs}</div><div class="stat-label">Submissions</div></div>
        <div class="stat-card"><div class="stat-num">$${totalPrize.toFixed(0)}</div><div class="stat-label">Total Prizes</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="card">
          <h3>🏆 Top Teams</h3>
          <div style="margin-top:8px">${topTeams || '<p class="empty">No teams yet</p>'}</div>
        </div>
        <div class="card">
          <h3>Quick Links</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            <a href="/school/hackathon/create" class="btn" style="text-align:center;text-decoration:none">Create Hackathon</a>
            <a href="/school/hackathon/schedule" class="btn btn-success" style="text-align:center;text-decoration:none">📅 Schedule</a>
            <a href="/school/hackathon/resources" class="btn" style="background:#7c3aed;text-align:center;text-decoration:none">📚 Resources</a>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>All Hackathons</h2>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Title</th><th>Theme</th><th>Status</th><th>Start</th><th>Prize Pool</th><th>Sponsors</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="empty">No hackathons created yet</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Hackathon Platform'));
  });

  /* ── Create Hackathon ── */
  app.get('/school/hackathon/create', requireAuth, requireNotBanned, async (req, res) => {
    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">🚀 Create Hackathon</h1>
      <form method="POST" action="/school/hackathon/create" class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Title *</label><input name="title" required placeholder="e.g., Spring CodeFest 2025"></div>
          <div><label>Theme *</label><input name="theme" required placeholder="e.g., AI for Good"></div>
        </div>
        <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="3" placeholder="What is this hackathon about?"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
          <div><label>Start Date *</label><input type="datetime-local" name="start_date" required></div>
          <div><label>End Date *</label><input type="datetime-local" name="end_date" required></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:12px">
          <div><label>Max Team Size</label><input type="number" name="max_team_size" value="4" min="1" max="10"></div>
          <div><label>Prize Pool ($)</label><input type="number" name="prize_pool" step="0.01" min="0" value="0"></div>
          <div><label>Status</label><select name="status">${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
        </div>
        <div style="margin-top:12px"><label>Sponsors (comma-separated names)</label><input name="sponsors" placeholder="Company A, Company B, Company C"></div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn">Create Hackathon</button>
          <a href="/school/hackathon" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Create Hackathon'));
  });

  app.post('/school/hackathon/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const { title, theme, description, start_date, end_date, max_team_size, prize_pool, status, sponsors } = req.body;
    const sponsorsArr = sponsors ? sponsors.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO hackathons(tenant_id,title,theme,description,start_date,end_date,max_team_size,prize_pool,status,sponsors,judging_criteria)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, title, theme, description, start_date, end_date, Number(max_team_size) || 4, Number(prize_pool) || 0, status, JSON.stringify(sponsorsArr), JSON.stringify(DEFAULT_CRITERIA)]
    );
    audit(req, 'hackathon_create', { title, theme });
    req.flash('success', 'Hackathon created!');
    res.redirect('/school/hackathon');
  }));

  /* ── Hackathon Detail ── */
  app.get('/school/hackathon/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [hacks] = await pool.query('SELECT * FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    if (!hacks.length) return res.status(404).send('Hackathon not found');
    const h = hacks[0];
    const [teams] = await pool.query('SELECT * FROM hackathon_teams WHERE tenant_id=$1 AND hackathon_id=$2 ORDER BY score DESC', [tid, hid]);
    const [challenges] = await pool.query('SELECT * FROM hackathon_challenges WHERE tenant_id=$1 AND hackathon_id=$2 ORDER BY points DESC', [tid, hid]);
    const [subs] = await pool.query(
      'SELECT s.*, t.name as team_name, c.title as challenge_title FROM hackathon_submissions s JOIN hackathon_teams t ON t.id=s.team_id JOIN hackathon_challenges c ON c.id=s.challenge_id WHERE s.tenant_id=$1 AND t.hackathon_id=$2',
      [tid, hid]
    );
    const isLive = h.status === 'active';
    const isJudging = h.status === 'judging';
    const sponsorsHtml = (h.sponsors || []).map(s => `<span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(s)}</span>`).join(' ');

    let countdownHtml = '';
    if (h.start_date && new Date(h.start_date) > new Date()) {
      const diff = new Date(h.start_date) - new Date();
      const days = Math.floor(diff / 86400000);
      const hrs = Math.floor((diff % 86400000) / 3600000);
      countdownHtml = `<div class="card" style="text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff">
        <p style="opacity:0.8;margin:0 0 4px">Starts In</p>
        <div class="countdown" style="color:#fff">${days}d ${hrs}h</div>
      </div>`;
    } else if (isLive && h.end_date) {
      const diff = new Date(h.end_date) - new Date();
      if (diff > 0) {
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        countdownHtml = `<div class="card" style="text-align:center;background:linear-gradient(135deg,#059669,#0d9488);color:#fff">
          <p style="opacity:0.8;margin:0 0 4px">Time Remaining</p>
          <div class="countdown" style="color:#fff">${hrs}h ${mins}m</div>
        </div>`;
      }
    }

    const teamRows = teams.map(t => `<tr>
      <td><strong>${esc(t.name)}</strong><br><small style="color:${GRAY}">${(t.members || []).length} member(s)</small></td>
      <td>${esc(t.project_name || 'No project yet')}</td>
      <td>${esc((t.tech_stack || []).join(', ') || '-')}</td>
      <td><strong>${t.score}</strong></td>
      <td>${t.rank > 0 ? '#' + t.rank : '-'}</td>
      <td>${t.repo_url ? `<a href="${esc(t.repo_url)}" target="_blank" style="color:${P}">Repo</a>` : '-'} ${t.demo_url ? `<a href="${esc(t.demo_url)}" target="_blank" style="color:${P};margin-left:8px">Demo</a>` : ''}</td>
    </tr>`).join('');
    const challengeRows = challenges.map(c => {
      const diffColor = c.difficulty === 'beginner' ? '#059669' : c.difficulty === 'intermediate' ? '#2563eb' : c.difficulty === 'advanced' ? '#d97706' : '#dc2626';
      return `<tr>
        <td><strong>${esc(c.title)}</strong></td>
        <td><span class="badge" style="background:${diffColor}20;color:${diffColor}">${esc(c.difficulty)}</span></td>
        <td>${c.points} pts</td>
        <td>${esc(c.sponsor || '-')}</td>
      </tr>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <h1 style="color:${P};margin:0">${esc(h.title)} ${isLive ? '🔴' : ''}</h1>
          <p style="color:${GRAY};margin:4px 0 0">Theme: <strong>${esc(h.theme)}</strong> · <span class="badge badge-${h.status}">${esc(h.status)}</span></p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-sm" href="/school/hackathon/${hid}/create-team">+ Create Team</a>
          ${isJudging ? `<a class="btn btn-sm btn-warning" href="/school/hackathon/${hid}/judging">Judging</a>` : ''}
          <a class="btn btn-sm" href="/school/hackathon/${hid}/leaderboard">Leaderboard</a>
          <a class="btn btn-sm btn-success" href="/school/hackathon/${hid}/sponsors">Sponsors</a>
          <a href="/school/hackathon" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
        </div>
      </div>
      <p style="color:${GRAY};margin-bottom:16px">${esc(h.description || '')}</p>
      <div class="grid" style="margin-bottom:20px">
        ${countdownHtml}
        <div class="stat-card"><div class="stat-num">${teams.length}</div><div class="stat-label">Teams</div></div>
        <div class="stat-card"><div class="stat-num">${challenges.length}</div><div class="stat-label">Challenges</div></div>
        <div class="stat-card"><div class="stat-num">${subs.length}</div><div class="stat-label">Submissions</div></div>
        <div class="stat-card"><div class="stat-num">$${Number(h.prize_pool || 0).toFixed(0)}</div><div class="stat-label">Prize Pool</div></div>
      </div>
      <div style="margin-bottom:8px">${sponsorsHtml}</div>
      <div class="card">
        <h2>Teams (${teams.length})</h2>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Team</th><th>Project</th><th>Tech Stack</th><th>Score</th><th>Rank</th><th>Links</th></tr></thead>
          <tbody>${teamRows || '<tr><td colspan="6" class="empty">No teams yet</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="card">
        <h2>Challenges (${challenges.length})</h2>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Challenge</th><th>Difficulty</th><th>Points</th><th>Sponsor</th></tr></thead>
          <tbody>${challengeRows || '<tr><td colspan="4" class="empty">No challenges yet</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, h.title));
  });

  /* ── Create Team ── */
  app.get('/school/hackathon/:id/create-team', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [hacks] = await pool.query('SELECT title,max_team_size FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    if (!hacks.length) return res.status(404).send('Hackathon not found');
    const h = hacks[0];
    const [students] = await pool.query("SELECT id, name FROM users WHERE tenant_id=$1 AND role='student' ORDER BY name", [tid]);
    const checks = students.map(s => `<label style="display:block;margin:4px 0"><input type="checkbox" name="member_ids" value="${s.id}"> ${esc(s.name)}</label>`).join('');

    const html = `${SKIP}
    <div style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">👥 Create Team</h1>
      <p style="color:${GRAY};margin-bottom:20px">For: ${esc(h.title)} (max ${h.max_team_size} members)</p>
      <form method="POST" action="/school/hackathon/${hid}/create-team" class="card">
        <div><label>Team Name *</label><input name="name" required placeholder="e.g., Code Ninjas"></div>
        <div style="margin-top:12px"><label>Members (max ${h.max_team_size})</label>
          <div style="max-height:200px;overflow-y:auto;border:1px solid #d1d5db;border-radius:8px;padding:8px">${checks || '<p style="color:#6b7280">No students found</p>'}</div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn">Create Team</button>
          <a href="/school/hackathon/${hid}" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Create Team'));
  });

  app.post('/school/hackathon/:id/create-team', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const { name, member_ids } = req.body;
    const mids = Array.isArray(member_ids) ? member_ids : (member_ids ? [member_ids] : []);
    await pool.query(
      'INSERT INTO hackathon_teams(tenant_id,hackathon_id,name,members) VALUES($1,$2,$3,$4)',
      [tid, hid, name, JSON.stringify(mids.map(Number))]
    );
    audit(req, 'hackathon_create_team', { hid, name });
    req.flash('success', `Team "${name}" created!`);
    res.redirect('/school/hackathon/' + hid);
  }));

  /* ── Challenges ── */
  app.get('/school/hackathon/:id/challenges', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [hacks] = await pool.query('SELECT title FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    if (!hacks.length) return res.status(404).send('Hackathon not found');
    const [challenges] = await pool.query('SELECT * FROM hackathon_challenges WHERE tenant_id=$1 AND hackathon_id=$2 ORDER BY points DESC', [tid, hid]);
    const [sponsors] = await pool.query('SELECT sponsors FROM hackathons WHERE id=$1', [hid]);
    const sponsorNames = sponsors[0]?.sponsors || [];
    const rows = challenges.map(c => {
      const diffColor = c.difficulty === 'beginner' ? '#059669' : c.difficulty === 'intermediate' ? '#2563eb' : c.difficulty === 'advanced' ? '#d97706' : '#dc2626';
      return `<tr>
        <td><strong>${esc(c.title)}</strong><br><small style="color:${GRAY}">${esc((c.description || '').substring(0, 80))}</small></td>
        <td><span class="badge" style="background:${diffColor}20;color:${diffColor}">${esc(c.difficulty)}</span></td>
        <td>${c.points}</td>
        <td>${esc(c.sponsor || '-')}</td>
        <td><button class="btn btn-sm btn-danger" onclick="delChallenge(${c.id})">Delete</button></td>
      </tr>`;
    }).join('');
    const sponsorOpts = sponsorNames.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🎯 Challenges</h1>
        <a href="/school/hackathon/${hid}" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Add Challenge</h3>
        <form method="POST" action="/school/hackathon/${hid}/challenges" style="margin-top:8px">
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px">
            <div><label>Title *</label><input name="title" required></div>
            <div><label>Difficulty</label><select name="difficulty">${DIFFICULTIES.map(d => `<option value="${d}">${d}</option>`).join('')}</select></div>
            <div><label>Points</label><input type="number" name="points" value="100" min="1"></div>
          </div>
          <div style="margin-top:8px"><label>Description</label><textarea name="description" rows="2"></textarea></div>
          <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Sponsor</label><select name="sponsor"><option value="">None</option>${sponsorOpts}</select></div>
            <div></div>
          </div>
          <div style="margin-top:12px"><button type="submit" class="btn">Add Challenge</button></div>
        </form>
      </div>
      <div class="card">
        <table><thead><tr><th>Challenge</th><th>Difficulty</th><th>Points</th><th>Sponsor</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">No challenges yet</td></tr>'}</tbody></table>
      </div>
      <script>function delChallenge(id){if(confirm('Delete this challenge?'))fetch('/school/hackathon/${hid}/challenges/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Challenges'));
  });

  app.post('/school/hackathon/:id/challenges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const { title, description, difficulty, sponsor, points } = req.body;
    await pool.query(
      'INSERT INTO hackathon_challenges(tenant_id,hackathon_id,title,description,difficulty,sponsor,points) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [tid, hid, title, description, difficulty, sponsor || null, Number(points) || 100]
    );
    audit(req, 'hackathon_add_challenge', { hid, title });
    req.flash('success', 'Challenge added!');
    res.redirect(`/school/hackathon/${hid}/challenges`);
  }));

  app.delete('/school/hackathon/:id/challenges/:cid', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM hackathon_challenges WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.cid)]);
    res.json({ ok: true });
  }));

  /* ── Submit to Challenge ── */
  app.get('/school/hackathon/:id/submit/:challenge_id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const cid = Number(req.params.challenge_id);
    const [challenges] = await pool.query('SELECT * FROM hackathon_challenges WHERE tenant_id=$1 AND id=$2', [tid, cid]);
    if (!challenges.length) return res.status(404).send('Challenge not found');
    const ch = challenges[0];
    const [teams] = await pool.query('SELECT id, name FROM hackathon_teams WHERE tenant_id=$1 AND hackathon_id=$2 ORDER BY name', [tid, hid]);
    const teamOpts = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    const html = `${SKIP}
    <div style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">📤 Submit Solution</h1>
      <p style="color:${GRAY};margin-bottom:20px">Challenge: <strong>${esc(ch.title)}</strong> (${ch.points} pts)</p>
      <form method="POST" action="/school/hackathon/${hid}/submit/${cid}" class="card">
        <div><label>Team *</label><select name="team_id" required><option value="">Select team...</option>${teamOpts}</select></div>
        <div style="margin-top:12px"><label>Description *</label><textarea name="description" rows="3" required placeholder="Describe your solution..."></textarea></div>
        <div style="margin-top:12px"><label>Demo URL</label><input name="demo_url" placeholder="https://your-demo.vercel.app"></div>
        <div style="margin-top:12px"><label>Code URL</label><input name="code_url" placeholder="https://github.com/..."></div>
        <div style="margin-top:16px"><button type="submit" class="btn btn-success">Submit Solution</button>
          <a href="/school/hackathon/${hid}/challenges" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Submit Solution'));
  });

  app.post('/school/hackathon/:id/submit/:challenge_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const cid = Number(req.params.challenge_id);
    const { team_id, description, demo_url, code_url } = req.body;
    await pool.query(
      'INSERT INTO hackathon_submissions(tenant_id,team_id,challenge_id,description,demo_url,code_url) VALUES($1,$2,$3,$4,$5,$6)',
      [tid, Number(team_id), cid, description, demo_url, code_url]
    );
    audit(req, 'hackathon_submit', { hid, cid, team_id });
    req.flash('success', 'Solution submitted!');
    res.redirect(`/school/hackathon/${hid}/challenges`);
  }));

  /* ── Judging ── */
  app.get('/school/hackathon/:id/judging', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [teams] = await pool.query('SELECT * FROM hackathon_teams WHERE tenant_id=$1 AND hackathon_id=$2 ORDER BY score DESC', [tid, hid]);
    const [subs] = await pool.query(
      'SELECT s.*, t.name as team_name, c.title as challenge_title FROM hackathon_submissions s JOIN hackathon_teams t ON t.id=s.team_id JOIN hackathon_challenges c ON c.id=s.challenge_id WHERE s.tenant_id=$1 AND t.hackathon_id=$2 ORDER BY s.submitted_at DESC',
      [tid, hid]
    );
    const criteriaFields = Object.entries(DEFAULT_CRITERIA).map(([k, max]) =>
      `<div style="margin-bottom:6px"><label style="display:block;font-weight:600;margin-bottom:2px">${esc(k)} (max ${max})</label><input type="number" name="score_${k}" min="0" max="${max}" value="0"></div>`
    ).join('');
    const teamSelect = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const subRows = subs.map(s => `<tr>
      <td><strong>${esc(s.team_name)}</strong></td>
      <td>${esc(s.challenge_title)}</td>
      <td>${s.judge_score || '-'}</td>
      <td>${esc(s.judge_comments || '-')}</td>
      <td>${new Date(s.submitted_at).toLocaleDateString()}</td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">⚖️ Judging Panel</h1>
        <a href="/school/hackathon/${hid}" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Score a Team</h3>
        <form method="POST" action="/school/hackathon/${hid}/judging" style="margin-top:8px">
          <div><label>Team *</label><select name="team_id" required><option value="">Select team...</option>${teamSelect}</select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">${criteriaFields}</div>
          <div style="margin-top:12px"><label>Comments</label><textarea name="judge_comments" rows="2" placeholder="Feedback for the team..."></textarea></div>
          <div style="margin-top:12px"><button type="submit" class="btn btn-warning">Submit Score</button></div>
        </form>
      </div>
      <div class="card">
        <h3>All Submissions (${subs.length})</h3>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Team</th><th>Challenge</th><th>Score</th><th>Feedback</th><th>Submitted</th></tr></thead>
          <tbody>${subRows || '<tr><td colspan="5" class="empty">No submissions yet</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Judging'));
  });

  app.post('/school/hackathon/:id/judging', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const { team_id, judge_comments } = req.body;
    let total = 0;
    for (const [k, max] of Object.entries(DEFAULT_CRITERIA)) {
      total += Math.min(max, Math.max(0, Number(req.body['score_' + k]) || 0));
    }
    await pool.query('UPDATE hackathon_teams SET score=$1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3', [total, tid, Number(team_id)]);
    audit(req, 'hackathon_judge_score', { hid, team_id, total });
    req.flash('success', `Team scored: ${total} pts`);
    res.redirect(`/school/hackathon/${hid}/judging`);
  }));

  /* ── Leaderboard ── */
  app.get('/school/hackathon/:id/leaderboard', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [hacks] = await pool.query('SELECT title,theme FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    if (!hacks.length) return res.status(404).send('Hackathon not found');
    const [teams] = await pool.query(
      'SELECT t.*, (SELECT COUNT(*) FROM hackathon_submissions s WHERE s.team_id=t.id) as sub_count FROM hackathon_teams t WHERE t.tenant_id=$1 AND t.hackathon_id=$2 ORDER BY t.score DESC',
      [tid, hid]
    );
    const maxScore = teams.length ? Math.max(...teams.map(t => Number(t.score || 0)), 1) : 1;
    const rows = teams.map((t, i) => {
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      const pct = Math.round((Number(t.score || 0) / maxScore) * 100);
      return `<div class="card" style="display:flex;align-items:center;gap:16px;padding:16px 20px">
        <div style="font-size:24px;min-width:40px;text-align:center">${rank}</div>
        <div style="flex:1">
          <h3 style="margin:0">${esc(t.name)}</h3>
          <p style="color:${GRAY};margin:2px 0 0;font-size:13px">${esc(t.project_name || 'No project')} · ${(t.members || []).length} members · ${t.sub_count} submissions</p>
          <div style="display:flex;gap:6px;margin-top:4px">${(t.tech_stack || []).map(ts => `<span class="badge" style="background:#f3f4f6;color:#374151">${esc(ts)}</span>`).join('')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:700;color:${P}">${t.score}</div>
          <div class="progress-bar" style="width:80px;margin-top:4px"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div><h1 style="color:${P};margin:0">🏆 Live Leaderboard</h1>
        <p style="color:${GRAY};margin:4px 0 0">${esc(hacks[0].title)} · ${esc(hacks[0].theme)}</p></div>
        <a href="/school/hackathon/${hid}" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div style="text-align:center;margin-bottom:20px"><small style="color:${GRAY}">Auto-refreshes with new scores</small></div>
      ${rows || '<div class="card"><p class="empty">No teams on the leaderboard yet</p></div>'}
    </div>`;
    res.send(renderPage(req, html, 'Leaderboard'));
  });

  /* ── Sponsors ── */
  app.get('/school/hackathon/:id/sponsors', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [hacks] = await pool.query('SELECT title,sponsors,prize_pool FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    if (!hacks.length) return res.status(404).send('Hackathon not found');
    const h = hacks[0];
    const sponsors = h.sponsors || [];
    const cards = sponsors.map(s => `
      <div class="card" style="text-align:center;border:2px solid #e0e7ff">
        <div style="font-size:32px;margin-bottom:8px">🏢</div>
        <h4 style="margin:0">${esc(s)}</h4>
        <p style="color:${GRAY};font-size:13px;margin-top:4px">Sponsor</p>
      </div>`).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🤝 Sponsors</h1>
        <a href="/school/hackathon/${hid}" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Manage Sponsors</h3>
        <form method="POST" action="/school/hackathon/${hid}/sponsors" style="margin-top:8px;display:flex;gap:8px">
          <div style="flex:1"><input name="sponsor_name" placeholder="Company name" required></div>
          <button type="submit" class="btn">Add Sponsor</button>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Current Sponsors (${sponsors.length})</h3>
          <div style="color:${GRAY}">Prize Pool: <strong>$${Number(h.prize_pool || 0).toFixed(0)}</strong></div>
        </div>
        <div class="grid" style="margin-top:12px">${cards || '<p class="empty" style="grid-column:1/-1">No sponsors yet</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Sponsors'));
  });

  app.post('/school/hackathon/:id/sponsors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const { sponsor_name } = req.body;
    const [hacks] = await pool.query('SELECT sponsors FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    const current = hacks[0]?.sponsors || [];
    current.push(sponsor_name);
    await pool.query('UPDATE hackathons SET sponsors=$1, updated_at=NOW() WHERE tenant_id=$2 AND id=$3', [JSON.stringify(current), tid, hid]);
    audit(req, 'hackathon_add_sponsor', { hid, sponsor_name });
    req.flash('success', 'Sponsor added!');
    res.redirect(`/school/hackathon/${hid}/sponsors`);
  }));

  /* ── Schedule / Demo Day ── */
  app.get('/school/hackathon/schedule', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [hackathons] = await pool.query(
      "SELECT * FROM hackathons WHERE tenant_id=$1 AND status IN ('upcoming','active','judging') ORDER BY start_date",
      [tid]
    );
    const rows = hackathons.map(h => {
      const isLive = h.status === 'active';
      const startDate = h.start_date ? new Date(h.start_date) : null;
      const endDate = h.end_date ? new Date(h.end_date) : null;
      let timeInfo = '';
      if (startDate && endDate) {
        const duration = Math.round((endDate - startDate) / 3600000);
        timeInfo = `${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${duration}h event`;
      }
      return `<div class="card" style="border-left:4px solid ${isLive ? '#059669' : P}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <h3 style="margin:0;color:${isLive ? '#059669' : P}">${esc(h.title)} ${isLive ? '🔴' : ''}</h3>
            <p style="color:${GRAY};margin:4px 0 0;font-size:14px">${esc(h.theme)}</p>
            <p style="color:${GRAY};font-size:13px;margin-top:4px">📅 ${timeInfo}</p>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/school/hackathon/${h.id}" class="btn btn-sm">View</a>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;gap:6px">
          <span class="badge badge-${h.status}">${esc(h.status)}</span>
          ${(h.sponsors || []).slice(0, 3).map(s => `<span class="badge" style="background:#f3f4f6">${esc(s)}</span>`).join('')}
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6">
          <h4 style="margin:0 0 8px;font-size:14px;color:${GRAY}">Demo Day Schedule</h4>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div><strong style="color:${P}">09:00</strong> Opening Ceremony</div>
            <div><strong style="color:${P}">10:00</strong> Hacking Begins</div>
            <div><strong style="color:${P}">12:00</strong> Lunch Break</div>
            <div><strong style="color:${P}">16:00</strong> Submission Deadline</div>
            <div><strong style="color:${P}">17:00</strong> Demos & Judging</div>
            <div><strong style="color:${P}">19:00</strong> Awards Ceremony</div>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📅 Schedule & Demo Day</h1>
        <a href="/school/hackathon" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      ${rows || '<div class="card"><p class="empty">No upcoming or active hackathons</p></div>'}
    </div>`;
    res.send(renderPage(req, html, 'Schedule'));
  });

  /* ── Resources ── */
  app.get('/school/hackathon/resources', requireAuth, requireNotBanned, async (req, res) => {
    const resources = [
      { icon: '📚', title: 'Getting Started Guide', desc: 'Step-by-step guide for first-time hackers', url: '#' },
      { icon: '🔧', title: 'API Documentation', desc: 'Available APIs and integration guides', url: '#' },
      { icon: '🎨', title: 'UI/UX Templates', desc: 'Pre-built templates and design systems', url: '#' },
      { icon: '☁️', title: 'Cloud Credits', desc: 'Free cloud hosting credits for participants', url: '#' },
      { icon: '🤖', title: 'AI/ML Resources', desc: 'Datasets, models, and AI tools', url: '#' },
      { icon: '📹', title: 'Workshop Recordings', desc: 'Past workshop and tutorial recordings', url: '#' },
      { icon: '💡', title: 'Project Ideas', desc: 'Starter project ideas by category', url: '#' },
      { icon: '🛠️', title: 'Dev Tools', desc: 'Recommended IDEs, extensions, and tools', url: '#' },
      { icon: '📝', title: 'Code of Conduct', desc: 'Rules and guidelines for all participants', url: '#' },
      { icon: '❓', title: 'FAQ', desc: 'Frequently asked questions and support', url: '#' }
    ];
    const cards = resources.map(r => `
      <div class="card" style="cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
        <div style="font-size:28px;margin-bottom:8px">${r.icon}</div>
        <h4 style="margin:0">${esc(r.title)}</h4>
        <p style="color:${GRAY};font-size:13px;margin-top:4px">${esc(r.desc)}</p>
      </div>`).join('');

    const html = `${SKIP}
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div><h1 style="color:${P};margin:0">📚 Resources</h1>
        <p style="color:${GRAY};margin:4px 0 0">Tools, guides and materials for hackathon participants</p></div>
        <a href="/school/hackathon" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="grid">${cards}</div>
    </div>`;
    res.send(renderPage(req, html, 'Resources'));
  });

  /* ── Edit Hackathon ── */
  app.post('/school/hackathon/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const { title, theme, description, start_date, end_date, max_team_size, prize_pool, status, sponsors } = req.body;
    const sponsorsArr = sponsors ? sponsors.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query(
      `UPDATE hackathons SET title=$1,theme=$2,description=$3,start_date=$4,end_date=$5,max_team_size=$6,prize_pool=$7,status=$8,sponsors=$9,updated_at=NOW() WHERE tenant_id=$10 AND id=$11`,
      [title, theme, description, start_date || null, end_date || null, Number(max_team_size) || 4, Number(prize_pool) || 0, status, JSON.stringify(sponsorsArr), tid, hid]
    );
    audit(req, 'hackathon_edit', { hid });
    req.flash('success', 'Hackathon updated!');
    res.redirect('/school/hackathon/' + hid);
  }));

  /* ── Edit Team ── */
  app.post('/school/hackathon/:id/team/:tid/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const teamId = Number(req.params.tid);
    const { project_name, project_description, repo_url, demo_url, tech_stack } = req.body;
    const ts = tech_stack ? tech_stack.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query(
      'UPDATE hackathon_teams SET project_name=$1,project_description=$2,repo_url=$3,demo_url=$4,tech_stack=$5,updated_at=NOW() WHERE tenant_id=$6 AND hackathon_id=$7 AND id=$8',
      [project_name, project_description, repo_url, demo_url, JSON.stringify(ts), tid, hid, teamId]
    );
    audit(req, 'hackathon_edit_team', { hid, teamId });
    req.flash('success', 'Team updated!');
    res.redirect('/school/hackathon/' + hid);
  }));

  /* ── Delete Hackathon ── */
  app.delete('/school/hackathon/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const hid = Number(req.params.id);
    const [teams] = await pool.query('SELECT id FROM hackathon_teams WHERE tenant_id=$1 AND hackathon_id=$2', [tid, hid]);
    const teamIds = teams.map(t => t.id);
    if (teamIds.length) {
      await pool.query('DELETE FROM hackathon_submissions WHERE tenant_id=$1 AND team_id = ANY($2)', [tid, teamIds]);
    }
    await pool.query('DELETE FROM hackathon_challenges WHERE tenant_id=$1 AND hackathon_id=$2', [tid, hid]);
    await pool.query('DELETE FROM hackathon_teams WHERE tenant_id=$1 AND hackathon_id=$2', [tid, hid]);
    await pool.query('DELETE FROM hackathons WHERE tenant_id=$1 AND id=$2', [tid, hid]);
    audit(req, 'hackathon_delete', { hid });
    res.json({ ok: true });
  }));

  /* ── Delete Team ── */
  app.delete('/school/hackathon/:id/team/:tid', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const teamId = Number(req.params.tid);
    await pool.query('DELETE FROM hackathon_submissions WHERE tenant_id=$1 AND team_id=$2', [tid, teamId]);
    await pool.query('DELETE FROM hackathon_teams WHERE tenant_id=$1 AND id=$2', [tid, teamId]);
    audit(req, 'hackathon_delete_team', { teamId });
    res.json({ ok: true });
  }));
};
