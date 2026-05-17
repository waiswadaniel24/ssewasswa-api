module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS startups (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255),
        description TEXT, industry VARCHAR(100), team_lead_id INT,
        members JSONB DEFAULT '[]', stage VARCHAR(50) DEFAULT 'idea',
        funding_raised DECIMAL(12,2) DEFAULT 0, mentors JSONB DEFAULT '[]',
        elevator_pitch TEXT, problem_statement TEXT, solution TEXT,
        target_market TEXT, business_model VARCHAR(100),
        website TEXT, logo_url TEXT, status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS startup_milestones (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, startup_id INT NOT NULL,
        title VARCHAR(255), description TEXT, due_date DATE,
        status VARCHAR(50) DEFAULT 'pending', completed_date DATE,
        priority VARCHAR(20) DEFAULT 'medium', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS startup_mentors (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, startup_id INT NOT NULL,
        mentor_id INT, mentor_name VARCHAR(255), mentor_email VARCHAR(255),
        expertise VARCHAR(255), meeting_frequency VARCHAR(100),
        notes TEXT, status VARCHAR(50) DEFAULT 'active',
        started_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS pitch_events (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255),
        description TEXT, date DATE, time TIME,
        venue VARCHAR(255), judges JSONB DEFAULT '[]',
        startups JSONB DEFAULT '[]', max_startups INT DEFAULT 10,
        prize_pool TEXT, status VARCHAR(50) DEFAULT 'upcoming',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS startup_meetings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, startup_id INT NOT NULL,
        mentor_id INT, title VARCHAR(255), description TEXT,
        meeting_date DATE, meeting_time TIME, duration_minutes INT DEFAULT 60,
        location VARCHAR(255), meeting_type VARCHAR(50) DEFAULT 'mentorship',
        status VARCHAR(50) DEFAULT 'scheduled', notes TEXT,
        action_items JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS startup_resources (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255),
        description TEXT, category VARCHAR(100), url TEXT,
        image_url TEXT, featured BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] startup-incubator OK');
    } catch(e) { console.warn('[Mod] startup-incubator Warn:', e.message); }
  })();

  const PREFIX = '/school/startup-incubator';

  // ─── 1. Dashboard ───
  app.get(PREFIX, requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [startups, milestones, events, meetings] = await Promise.all([
        pool.query('SELECT * FROM startups WHERE tenant_id=$1 AND status=$2 ORDER BY updated_at DESC', [req.tenant.id, 'active']),
        pool.query(`SELECT sm.*, s.name as startup_name FROM startup_milestones sm
          JOIN startups s ON s.id = sm.startup_id
          WHERE sm.tenant_id=$1 AND sm.status=$2 ORDER BY sm.due_date ASC LIMIT 10`,
          [req.tenant.id, 'pending']),
        pool.query('SELECT * FROM pitch_events WHERE tenant_id=$1 ORDER BY date DESC LIMIT 5', [req.tenant.id]),
        pool.query(`SELECT sm.*, s.name as startup_name FROM startup_meetings sm
          JOIN startups s ON s.id = sm.startup_id
          WHERE sm.tenant_id=$1 AND sm.status=$2 ORDER BY sm.meeting_date ASC LIMIT 5`,
          [req.tenant.id, 'scheduled'])
      ]);

      const totalFunding = startups.rows.reduce((s, st) => s + parseFloat(st.funding_raised || 0), 0);
      const stages = {};
      startups.rows.forEach(s => { stages[s.stage] = (stages[s.stage] || 0) + 1; });

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Startup Incubator</h2>
          <p style="color:${GRAY}">From idea to investment - nurture student entrepreneurship</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${startups.rows.length}</div>
            <div style="color:${GRAY}">Active Startups</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">$${totalFunding.toLocaleString()}</div>
            <div style="color:${GRAY}">Total Raised</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${milestones.rows.length}</div>
            <div style="color:${GRAY}">Pending Milestones</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#7c3aed">${meetings.rows.length}</div>
            <div style="color:${GRAY}">Upcoming Meetings</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/startups/new" class="btn" style="background:#059669">+ Register Startup</a>
          <a href="${PREFIX}/pitch-events" class="btn" style="background:#d97706">Pitch Events</a>
          <a href="${PREFIX}/resources" class="btn" style="background:#7c3aed">Resources</a>
          <a href="${PREFIX}/business-plan-builder" class="btn" style="background:#0891b2">Business Plan Builder</a>
          <a href="${PREFIX}/market-analysis" class="btn" style="background:#dc2626">Market Analysis</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
          ${Object.entries(stages).map(([stage, count]) => `
            <div class="card" style="text-align:center;border-left:4px solid ${P}">
              <div style="font-size:1.5em;font-weight:700;color:${P}">${count}</div>
              <div style="color:${GRAY}">${stage.charAt(0).toUpperCase() + stage.slice(1)} Stage</div>
            </div>
          `).join('')}
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Active Startups</h3>
          ${startups.rows.length ? `<table>
            <tr><th>Name</th><th>Industry</th><th>Stage</th><th>Team Size</th><th>Funding</th><th>Updated</th><th>Actions</th></tr>
            ${startups.rows.map(s => {
              const members = typeof s.members === 'string' ? JSON.parse(s.members) : (s.members || []);
              const mentors = typeof s.mentors === 'string' ? JSON.parse(s.mentors) : (s.mentors || []);
              return `<tr>
                <td><a href="${PREFIX}/startups/${s.id}" style="color:${P};font-weight:600">${esc(s.name)}</a></td>
                <td>${esc(s.industry || '-')}</td>
                <td><span style="background:${s.stage === 'idea' ? '#fef3c7' : s.stage === 'mvp' ? '#dbeafe' : s.stage === 'growth' ? '#dcfce7' : s.stage === 'seed' ? '#ede9fe' : '#f3f4f6'};padding:2px 10px;border-radius:20px;font-size:.85em">${s.stage}</span></td>
                <td>${members.length + 1}</td>
                <td>$${parseFloat(s.funding_raised || 0).toLocaleString()}</td>
                <td>${s.updated_at.toLocaleDateString()}</td>
                <td>
                  <a href="${PREFIX}/startups/${s.id}" class="btn" style="padding:4px 10px;font-size:.85em">View</a>
                  <a href="${PREFIX}/startups/edit/${s.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#d97706">Edit</a>
                </td>
              </tr>`;
            }).join('')}
          </table>` : '<p style="color:${GRAY}">No startups registered yet. Be the first to start!</p>'}
        </div>
        ${milestones.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Upcoming Milestones</h3>
          <table><tr><th>Startup</th><th>Milestone</th><th>Due</th><th>Priority</th></tr>
          ${milestones.rows.map(m => `<tr>
            <td>${esc(m.startup_name)}</td><td>${esc(m.title)}</td>
            <td>${m.due_date ? m.due_date.toLocaleDateString() : '-'}</td>
            <td><span style="background:${m.priority === 'high' ? '#fee2e2' : m.priority === 'medium' ? '#fef3c7' : '#dcfce7'};padding:2px 8px;border-radius:12px;font-size:.85em">${m.priority}</span></td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        ${meetings.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Upcoming Meetings</h3>
          <table><tr><th>Startup</th><th>Title</th><th>Date</th><th>Type</th></tr>
          ${meetings.rows.map(m => `<tr>
            <td>${esc(m.startup_name)}</td><td>${esc(m.title)}</td>
            <td>${m.meeting_date ? m.meeting_date.toLocaleDateString() : '-'}</td>
            <td>${m.meeting_type}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
      `;
      res.send(renderPage(req, 'Startup Incubator', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 2. Register Startup ───
  app.get(PREFIX + '/startups/new', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:16px">Register New Startup</h2>
        <form method="POST" action="${PREFIX}/startups/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Startup Name *</label>
              <input type="text" name="name" placeholder="Your startup name" required></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Industry *</label>
              <select name="industry" required>
                <option value="">-- Select Industry --</option>
                ${['Technology','Healthcare','Education','Finance','E-commerce','SaaS','AI/ML','IoT','CleanTech','AgriTech','FinTech','EdTech','HealthTech','Social Enterprise','Other'].map(i =>
                  `<option value="${i}">${i}</option>`).join('')}
              </select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Stage</label>
              <select name="stage">
                <option value="idea">Idea Stage</option>
                <option value="validation">Validation</option>
                <option value="mvp">MVP / Prototype</option>
                <option value="seed">Seed / Pre-Series</option>
                <option value="growth">Growth</option>
                <option value="scaling">Scaling</option>
              </select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Business Model</label>
              <select name="business_model">
                <option value="">-- Select --</option>
                <option value="B2B">B2B</option><option value="B2C">B2C</option>
                <option value="B2B2C">B2B2C</option><option value="Marketplace">Marketplace</option>
                <option value="Subscription">Subscription / SaaS</option>
                <option value="Freemium">Freemium</option>
                <option value="Advertising">Advertising</option>
                <option value="Licensing">Licensing</option>
              </select></div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Elevator Pitch *</label>
            <textarea name="elevator_pitch" rows="3" placeholder="Describe your startup in 2-3 sentences that would excite an investor..." required></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Problem Statement *</label>
            <textarea name="problem_statement" rows="3" placeholder="What problem are you solving? Who faces this problem?" required></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Solution *</label>
            <textarea name="solution" rows="3" placeholder="How does your startup solve this problem?" required></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Target Market</label>
            <textarea name="target_market" rows="2" placeholder="Who are your customers? What is the market size?"></textarea>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" placeholder="Detailed description of your startup, vision, and mission..."></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Website</label>
              <input type="url" name="website" placeholder="https://yourstartup.com"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Team Members (comma-separated names)</label>
              <input type="text" name="team_members" placeholder="e.g., Alice, Bob, Charlie"></div>
          </div>
          <button type="submit" class="btn">Register Startup</button>
          <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
        </form>
      </div>
    `;
    res.send(renderPage(req, 'Register Startup', body));
  });

  app.post(PREFIX + '/startups/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, industry, stage, elevator_pitch, problem_statement, solution, target_market, business_model, website, team_members } = req.body;
      const membersArr = (team_members || '').split(',').map(m => m.trim()).filter(Boolean);
      const result = await pool.query(
        `INSERT INTO startups (tenant_id, name, description, industry, team_lead_id, members, stage, elevator_pitch, problem_statement, solution, target_market, business_model, website)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [req.tenant.id, name, description, industry, req.user.id, JSON.stringify(membersArr), stage || 'idea', elevator_pitch, problem_statement, solution, target_market, business_model, website]
      );
      audit(req, 'startup_registered', { startup_id: result.rows[0].id, name });
      res.redirect(PREFIX + '/startups/' + result.rows[0].id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 3. Startup Detail ───
  app.get(PREFIX + '/startups/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT * FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const s = startup.rows[0];
      const [milestones, mentors, meetings] = await Promise.all([
        pool.query('SELECT * FROM startup_milestones WHERE tenant_id=$1 AND startup_id=$2 ORDER BY due_date ASC', [req.tenant.id, s.id]),
        pool.query('SELECT * FROM startup_mentors WHERE tenant_id=$1 AND startup_id=$2 AND status=$3', [req.tenant.id, s.id, 'active']),
        pool.query('SELECT * FROM startup_meetings WHERE tenant_id=$1 AND startup_id=$2 ORDER BY meeting_date DESC LIMIT 10', [req.tenant.id, s.id])
      ]);
      const members = typeof s.members === 'string' ? JSON.parse(s.members) : (s.members || []);
      const startupMentors = typeof s.mentors === 'string' ? JSON.parse(s.mentors) : (s.mentors || []);
      const completedMilestones = milestones.rows.filter(m => m.status === 'completed').length;
      const totalMilestones = milestones.rows.length;
      const progress = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;

      const stageColors = { idea: '#fef3c7', validation: '#e0e7ff', mvp: '#dbeafe', seed: '#ede9fe', growth: '#dcfce7', scaling: '#d1fae5' };

      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div>
              <h2 style="color:${P};margin-bottom:4px">${esc(s.name)}</h2>
              <p style="color:${GRAY}">${esc(s.industry || '')} &bull; ${esc(s.business_model || '')}</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="background:${stageColors[s.stage] || '#f3f4f6'};padding:4px 16px;border-radius:20px;font-weight:600;text-transform:capitalize">${s.stage} Stage</span>
              <a href="${PREFIX}/startups/edit/${s.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#d97706">Edit</a>
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:1.8em;font-weight:700;color:#059669">$${parseFloat(s.funding_raised || 0).toLocaleString()}</div>
            <div style="color:${GRAY}">Funding Raised</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:1.8em;font-weight:700;color:${P}">${members.length + 1}</div>
            <div style="color:${GRAY}">Team Members</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:1.8em;font-weight:700;color:#7c3aed">${startupMentors.length}</div>
            <div style="color:${GRAY}">Mentors</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:1.8em;font-weight:700;color:#d97706">${progress}%</div>
            <div style="color:${GRAY}">Milestone Progress</div>
          </div>
        </div>
        ${s.elevator_pitch ? `<div class="card" style="border-left:4px solid ${P}">
          <h3 style="margin-bottom:8px">Elevator Pitch</h3>
          <p style="font-style:italic">${esc(s.elevator_pitch)}</p>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          ${s.problem_statement ? `<div class="card">
            <h3 style="color:#dc2626;margin-bottom:8px">Problem</h3>
            <p>${esc(s.problem_statement)}</p>
          </div>` : ''}
          ${s.solution ? `<div class="card">
            <h3 style="color:#059669;margin-bottom:8px">Solution</h3>
            <p>${esc(s.solution)}</p>
          </div>` : ''}
        </div>
        ${s.target_market ? `<div class="card" style="margin-bottom:16px">
          <h3 style="margin-bottom:8px">Target Market</h3>
          <p>${esc(s.target_market)}</p>
        </div>` : ''}
        ${members.length ? `<div class="card" style="margin-bottom:16px">
          <h3 style="margin-bottom:8px">Team (${members.length + 1} members)</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <span style="background:#dcfce7;color:#059669;padding:6px 14px;border-radius:20px;font-weight:600">Team Lead</span>
            ${members.map(m => `<span style="background:#ede9fe;color:#4f46e5;padding:6px 14px;border-radius:20px">${esc(m)}</span>`).join('')}
          </div>
        </div>` : ''}
        ${s.website ? `<div class="card" style="margin-bottom:16px"><strong>Website:</strong> <a href="${esc(s.website)}" target="_blank" style="color:${P}">${esc(s.website)}</a></div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/milestones/${s.id}/new" class="btn" style="background:#059669">+ Add Milestone</a>
          <a href="${PREFIX}/mentors/${s.id}/new" class="btn" style="background:#7c3aed">+ Add Mentor</a>
          <a href="${PREFIX}/meetings/${s.id}/new" class="btn" style="background:#d97706">+ Schedule Meeting</a>
          <a href="${PREFIX}/funding/${s.id}" class="btn" style="background:#dc2626">Update Funding</a>
        </div>
        ${milestones.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Milestones (${completedMilestones}/${totalMilestones})</h3>
          <div style="margin-bottom:12px">
            <div style="background:#e5e7eb;border-radius:8px;height:10px">
              <div style="background:#059669;height:10px;border-radius:8px;width:${progress}%"></div>
            </div>
          </div>
          <table><tr><th>Title</th><th>Due</th><th>Priority</th><th>Status</th><th>Actions</th></tr>
          ${milestones.rows.map(m => `<tr>
            <td>${esc(m.title)}</td>
            <td>${m.due_date ? m.due_date.toLocaleDateString() : '-'}</td>
            <td><span style="background:${m.priority === 'high' ? '#fee2e2' : m.priority === 'medium' ? '#fef3c7' : '#dcfce7'};padding:2px 8px;border-radius:12px;font-size:.85em">${m.priority}</span></td>
            <td><span style="background:${m.status === 'completed' ? '#dcfce7' : m.status === 'in-progress' ? '#dbeafe' : '#fef3c7'};padding:2px 8px;border-radius:12px;font-size:.85em">${m.status}</span></td>
            <td>
              ${m.status !== 'completed' ? `<form method="POST" action="${PREFIX}/milestones/complete/${m.id}" style="display:inline">
                <button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#059669">&#10003;</button>
              </form>` : ''}
            </td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        ${mentors.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Mentors</h3>
          ${mentors.rows.map(m => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #e5e7eb">
              <div>
                <strong>${esc(m.mentor_name || 'Mentor')}</strong>
                <span style="color:${GRAY};margin-left:8px">${esc(m.expertise || '')}</span>
                <span style="color:${GRAY};margin-left:8px;font-size:.85em">${esc(m.meeting_frequency || '')}</span>
              </div>
            </div>
          `).join('')}
        </div>` : ''}
        ${meetings.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Meeting History</h3>
          <table><tr><th>Title</th><th>Date</th><th>Type</th><th>Duration</th><th>Status</th></tr>
          ${meetings.rows.map(m => `<tr>
            <td>${esc(m.title)}</td>
            <td>${m.meeting_date ? m.meeting_date.toLocaleDateString() : '-'}</td>
            <td>${esc(m.meeting_type)}</td>
            <td>${m.duration_minutes || 60}min</td>
            <td>${m.status}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, s.name, body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 4. Edit Startup ───
  app.get(PREFIX + '/startups/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT * FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const s = startup.rows[0];
      const members = typeof s.members === 'string' ? JSON.parse(s.members) : (s.members || []);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Edit: ${esc(s.name)}</h2>
          <form method="POST" action="${PREFIX}/startups/edit/${s.id}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Name *</label>
                <input type="text" name="name" value="${esc(s.name)}" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label>
                <select name="industry">
                  ${['Technology','Healthcare','Education','Finance','E-commerce','SaaS','AI/ML','IoT','CleanTech','AgriTech','FinTech','EdTech','HealthTech','Social Enterprise','Other'].map(i =>
                    `<option value="${i}" ${s.industry === i ? 'selected' : ''}>${i}</option>`).join('')}
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Stage</label>
                <select name="stage">
                  ${['idea','validation','mvp','seed','growth','scaling'].map(st =>
                    `<option value="${st}" ${s.stage === st ? 'selected' : ''}>${st.charAt(0).toUpperCase()+st.slice(1)}</option>`).join('')}
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Business Model</label>
                <select name="business_model">
                  ${['','B2B','B2C','B2B2C','Marketplace','Subscription','Freemium','Advertising','Licensing'].map(b =>
                    `<option value="${b}" ${s.business_model === b ? 'selected' : ''}>${b || '-- Select --'}</option>`).join('')}
                </select></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Elevator Pitch</label>
              <textarea name="elevator_pitch" rows="3">${esc(s.elevator_pitch || '')}</textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Problem Statement</label>
              <textarea name="problem_statement" rows="2">${esc(s.problem_statement || '')}</textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Solution</label>
              <textarea name="solution" rows="2">${esc(s.solution || '')}</textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Target Market</label>
              <textarea name="target_market" rows="2">${esc(s.target_market || '')}</textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3">${esc(s.description || '')}</textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Website</label>
                <input type="url" name="website" value="${esc(s.website || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Team Members</label>
                <input type="text" name="team_members" value="${esc(members.join(', '))}"></div>
            </div>
            <button type="submit" class="btn">Save Changes</button>
            <a href="${PREFIX}/startups/${s.id}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Edit Startup', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/startups/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, industry, stage, elevator_pitch, problem_statement, solution, target_market, business_model, website, team_members } = req.body;
      const membersArr = (team_members || '').split(',').map(m => m.trim()).filter(Boolean);
      await pool.query(
        `UPDATE startups SET name=$1, description=$2, industry=$3, stage=$4, elevator_pitch=$5, problem_statement=$6,
         solution=$7, target_market=$8, business_model=$9, website=$10, members=$11, updated_at=NOW()
         WHERE id=$12 AND tenant_id=$13`,
        [name, description, industry, stage, elevator_pitch, problem_statement, solution, target_market, business_model, website, JSON.stringify(membersArr), req.params.id, req.tenant.id]
      );
      audit(req, 'startup_updated', { startup_id: req.params.id });
      res.redirect(PREFIX + '/startups/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 5. Milestones ───
  app.get(PREFIX + '/milestones/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT name FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.startupId, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Add Milestone for ${esc(startup.rows[0].name)}</h2>
          <form method="POST" action="${PREFIX}/milestones/${req.params.startupId}/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Milestone Title *</label>
              <input type="text" name="title" placeholder="e.g., Complete MVP, First 100 users, Secure seed funding" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" placeholder="What needs to be achieved?"></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Due Date</label>
                <input type="date" name="due_date"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Priority</label>
                <select name="priority">
                  <option value="low">Low</option>
                  <option value="medium" selected>Medium</option>
                  <option value="high">High</option>
                </select></div>
            </div>
            <button type="submit" class="btn">Add Milestone</button>
            <a href="${PREFIX}/startups/${req.params.startupId}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Add Milestone', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/milestones/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, due_date, priority } = req.body;
      await pool.query(
        'INSERT INTO startup_milestones (tenant_id, startup_id, title, description, due_date, priority) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.tenant.id, req.params.startupId, title, description, due_date, priority || 'medium']
      );
      audit(req, 'milestone_added', { startup_id: req.params.startupId, title });
      res.redirect(PREFIX + '/startups/' + req.params.startupId);
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/milestones/complete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const milestone = await pool.query('SELECT startup_id FROM startup_milestones WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      await pool.query(
        "UPDATE startup_milestones SET status=$1, completed_date=NOW() WHERE id=$2 AND tenant_id=$3",
        ['completed', req.params.id, req.tenant.id]
      );
      audit(req, 'milestone_completed', { milestone_id: req.params.id });
      if (milestone.rows.length) res.redirect(PREFIX + '/startups/' + milestone.rows[0].startup_id);
      else res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 6. Mentors ───
  app.get(PREFIX + '/mentors/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT name FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.startupId, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Add Mentor for ${esc(startup.rows[0].name)}</h2>
          <form method="POST" action="${PREFIX}/mentors/${req.params.startupId}/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Mentor Name *</label>
                <input type="text" name="mentor_name" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Email</label>
                <input type="email" name="mentor_email"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Expertise</label>
                <input type="text" name="expertise" placeholder="e.g., Marketing, Fundraising, Product"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Meeting Frequency</label>
                <select name="meeting_frequency">
                  <option value="Weekly">Weekly</option>
                  <option value="Bi-weekly">Bi-weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="As needed">As Needed</option>
                </select></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" placeholder="Any additional notes about the mentor..."></textarea>
            </div>
            <button type="submit" class="btn">Add Mentor</button>
            <a href="${PREFIX}/startups/${req.params.startupId}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Add Mentor', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/mentors/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { mentor_name, mentor_email, expertise, meeting_frequency, notes } = req.body;
      await pool.query(
        `INSERT INTO startup_mentors (tenant_id, startup_id, mentor_name, mentor_email, expertise, meeting_frequency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.tenant.id, req.params.startupId, mentor_name, mentor_email, expertise, meeting_frequency, notes]
      );
      audit(req, 'mentor_added', { startup_id: req.params.startupId, mentor_name });
      res.redirect(PREFIX + '/startups/' + req.params.startupId);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 7. Schedule Meeting ───
  app.get(PREFIX + '/meetings/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT name FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.startupId, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Schedule Meeting for ${esc(startup.rows[0].name)}</h2>
          <form method="POST" action="${PREFIX}/meetings/${req.params.startupId}/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Meeting Title *</label>
              <input type="text" name="title" placeholder="e.g., Weekly Check-in, Pitch Practice, Investor Prep" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" placeholder="Agenda or topics to discuss..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Date *</label>
                <input type="date" name="meeting_date" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Time</label>
                <input type="time" name="meeting_time"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (minutes)</label>
                <input type="number" name="duration_minutes" value="60" min="15" step="15"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Meeting Type</label>
                <select name="meeting_type">
                  <option value="mentorship">Mentorship</option>
                  <option value="team">Team Meeting</option>
                  <option value="pitch_practice">Pitch Practice</option>
                  <option value="investor">Investor Meeting</option>
                  <option value="review">Progress Review</option>
                  <option value="other">Other</option>
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Location</label>
                <input type="text" name="location" placeholder="e.g., Room 101 or Zoom link"></div>
            </div>
            <button type="submit" class="btn">Schedule Meeting</button>
            <a href="${PREFIX}/startups/${req.params.startupId}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Schedule Meeting', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/meetings/:startupId/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, meeting_date, meeting_time, duration_minutes, meeting_type, location } = req.body;
      await pool.query(
        `INSERT INTO startup_meetings (tenant_id, startup_id, title, description, meeting_date, meeting_time, duration_minutes, meeting_type, location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.tenant.id, req.params.startupId, title, description, meeting_date, meeting_time, duration_minutes || 60, meeting_type, location]
      );
      audit(req, 'meeting_scheduled', { startup_id: req.params.startupId, title });
      res.redirect(PREFIX + '/startups/' + req.params.startupId);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 8. Update Funding ───
  app.get(PREFIX + '/funding/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startup = await pool.query('SELECT * FROM startups WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!startup.rows.length) return res.status(404).send('Startup not found');
      const s = startup.rows[0];
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Update Funding: ${esc(s.name)}</h2>
          <div class="card" style="text-align:center;margin-bottom:20px">
            <div style="font-size:2em;font-weight:700;color:#059669">$${parseFloat(s.funding_raised || 0).toLocaleString()}</div>
            <div style="color:${GRAY}">Current Total Funding</div>
          </div>
          <form method="POST" action="${PREFIX}/funding/${s.id}">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Add Funding Amount ($)</label>
              <input type="number" name="amount" step="0.01" min="0" placeholder="e.g., 5000" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Source / Notes</label>
              <textarea name="notes" rows="2" placeholder="e.g., Won pitch competition, Angel investment, Grant..."></textarea>
            </div>
            <button type="submit" class="btn">Update Funding</button>
            <a href="${PREFIX}/startups/${s.id}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Update Funding', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/funding/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { amount, notes } = req.body;
      const addAmount = parseFloat(amount || 0);
      if (addAmount > 0) {
        await pool.query(
          'UPDATE startups SET funding_raised = funding_raised + $1, updated_at = NOW() WHERE id=$2 AND tenant_id=$3',
          [addAmount, req.params.id, req.tenant.id]
        );
        audit(req, 'funding_updated', { startup_id: req.params.id, amount: addAmount, notes });
      }
      res.redirect(PREFIX + '/startups/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 9. Pitch Events ───
  app.get(PREFIX + '/pitch-events', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const events = await pool.query('SELECT * FROM pitch_events WHERE tenant_id=$1 ORDER BY date DESC', [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h2 style="color:${P};margin-bottom:4px">Pitch Events & Demo Days</h2>
              <p style="color:${GRAY}">Showcase your startup to investors and judges</p>
            </div>
            <a href="${PREFIX}/pitch-events/new" class="btn" style="background:#059669">+ Create Event</a>
          </div>
        </div>
        ${events.rows.length ? events.rows.map(ev => {
          const startups = typeof ev.startups === 'string' ? JSON.parse(ev.startups) : (ev.startups || []);
          const judges = typeof ev.judges === 'string' ? JSON.parse(ev.judges) : (ev.judges || []);
          const now = new Date();
          const isUpcoming = ev.date && new Date(ev.date) >= now;
          return `
          <div class="card" style="border-left:4px solid ${isUpcoming ? '#059669' : GRAY}">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
              <div>
                <h3 style="color:${P}">${esc(ev.title)}</h3>
                <p style="color:${GRAY};font-size:.9em">${ev.date ? ev.date.toLocaleDateString() : 'TBD'} ${ev.time ? 'at ' + ev.time : ''} &bull; ${esc(ev.venue || 'TBD')}</p>
              </div>
              <span style="background:${ev.status === 'upcoming' ? '#dcfce7' : ev.status === 'completed' ? '#dbeafe' : '#fef3c7'};padding:2px 12px;border-radius:20px;font-size:.85em;font-weight:600">${ev.status}</span>
            </div>
            <p style="margin-top:8px">${esc((ev.description || '').substring(0, 200))}</p>
            ${ev.prize_pool ? `<p style="margin-top:6px;font-size:.9em"><strong>Prize Pool:</strong> ${esc(ev.prize_pool)}</p>` : ''}
            <div style="margin-top:8px;font-size:.85em;color:${GRAY}">
              <span>${startups.length} startup(s) registered</span> &bull;
              <span>${judges.length} judge(s)</span>
            </div>
          </div>`;
        }).join('') : '<div class="card"><p style="color:${GRAY}">No pitch events scheduled yet.</p></div>'}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Pitch Events', body));
    } catch(e) { ah(e, req, res); }
  });

  app.get(PREFIX + '/pitch-events/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const allStartups = await pool.query('SELECT id, name FROM startups WHERE tenant_id=$1 AND status=$2 ORDER BY name', [req.tenant.id, 'active']);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Create Pitch Event</h2>
          <form method="POST" action="${PREFIX}/pitch-events/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Event Title *</label>
              <input type="text" name="title" placeholder="e.g., Spring Demo Day 2025" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" placeholder="Describe the event format, theme, and goals..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Date</label>
                <input type="date" name="date"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Time</label>
                <input type="time" name="time"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Venue</label>
                <input type="text" name="venue" placeholder="e.g., Main Auditorium"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Prize Pool</label>
              <input type="text" name="prize_pool" placeholder="e.g., $5,000 + mentorship">
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Max Startups</label>
              <input type="number" name="max_startups" value="10" min="1">
            </div>
            <button type="submit" class="btn">Create Event</button>
            <a href="${PREFIX}/pitch-events" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Create Pitch Event', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/pitch-events/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, date, time, venue, prize_pool, max_startups } = req.body;
      await pool.query(
        `INSERT INTO pitch_events (tenant_id, title, description, date, time, venue, prize_pool, max_startups)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.tenant.id, title, description, date, time, venue, prize_pool, max_startups || 10]
      );
      audit(req, 'pitch_event_created', { title });
      res.redirect(PREFIX + '/pitch-events');
    } catch(e) { ah(e, req, res); }
  });

  // ─── 10. Business Plan Builder ───
  app.get(PREFIX + '/business-plan-builder', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const startups = await pool.query('SELECT id, name FROM startups WHERE tenant_id=$1 AND status=$2 AND team_lead_id=$3', [req.tenant.id, 'active', req.user.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Business Plan Builder</h2>
          <p style="color:${GRAY}">Build a comprehensive business plan for your startup</p>
        </div>
        ${startups.rows.length ? `
        <div class="card">
          <label style="font-weight:600;display:block;margin-bottom:4px">Select Your Startup</label>
          <select id="startupSelect" onchange="loadStartupData()" style="margin-bottom:16px">
            ${startups.rows.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        ` : '<div class="card" style="background:#fef3c7;border-left:4px solid #d97706"><p>You need to register a startup first. <a href="' + PREFIX + '/startups/new" style="color:' + P + '">Register now</a></p></div>'}
        <div class="card">
          <h3 style="color:${P};margin-bottom:12px">Business Plan Sections</h3>
          <div style="display:grid;gap:16px">
            <div class="card" style="border-left:4px solid #dc2626">
              <h3>1. Executive Summary</h3>
              <textarea id="execSummary" rows="5" placeholder="A concise overview of your entire business plan. Include your mission, vision, value proposition, and key objectives. Keep it to 1-2 pages max."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #059669">
              <h3>2. Company Description</h3>
              <textarea id="companyDesc" rows="4" placeholder="Describe your company, its legal structure, location, and the problem you are solving. Explain why now is the right time."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #d97706">
              <h3>3. Market Analysis</h3>
              <textarea id="marketAnalysis" rows="4" placeholder="Define your target market, market size (TAM/SAM/SOM), customer segments, and competitive landscape. Include market trends and growth projections."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #7c3aed">
              <h3>4. Organization & Management</h3>
              <textarea id="orgManagement" rows="4" placeholder="Describe your team, organizational structure, key roles, and any advisors or board members. Highlight relevant experience."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #0891b2">
              <h3>5. Product/Service Line</h3>
              <textarea id="productLine" rows="4" placeholder="Describe your product or service in detail. What makes it unique? What is the technology behind it? Include your IP strategy."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #be185d">
              <h3>6. Marketing & Sales Strategy</h3>
              <textarea id="marketingSales" rows="4" placeholder="How will you acquire customers? Describe your marketing channels, pricing strategy, sales funnel, and customer retention plan."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #ea580c">
              <h3>7. Financial Projections</h3>
              <textarea id="financials" rows="4" placeholder="Include revenue projections for 3-5 years, cost structure, break-even analysis, and funding requirements. Be realistic with numbers."></textarea>
            </div>
            <div class="card" style="border-left:4px solid #16a34a">
              <h3>8. Funding Request</h3>
              <textarea id="fundingRequest" rows="4" placeholder="How much funding are you seeking? How will the funds be used? What milestones will the funding help achieve? What is the expected ROI for investors?"></textarea>
            </div>
          </div>
        </div>
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Business Plan Builder', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 11. Market Analysis Tools ───
  app.get(PREFIX + '/market-analysis', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:4px">Market Analysis Tools</h2>
        <p style="color:${GRAY}">Framework and templates for analyzing your market opportunity</p>
      </div>
      <div class="card" style="border-left:4px solid #dc2626">
        <h3 style="margin-bottom:12px">Revenue Model Canvas</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px">Revenue Streams</label>
            <textarea rows="3" placeholder="e.g., Subscription fees, One-time sales, Licensing..."></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px">Pricing Strategy</label>
            <textarea rows="3" placeholder="e.g., Freemium, Tiered pricing, Pay-per-use..."></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px">Customer Segments</label>
            <textarea rows="3" placeholder="e.g., Small businesses, Enterprise, Students..."></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:4px">Cost Structure</label>
            <textarea rows="3" placeholder="e.g., Development, Marketing, Operations, Salaries..."></textarea>
          </div>
        </div>
      </div>
      <div class="card" style="border-left:4px solid #059669">
        <h3 style="margin-bottom:12px">SWOT Analysis</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="background:#dcfce7;padding:16px;border-radius:8px">
            <h4 style="color:#059669;margin-top:0">Strengths</h4>
            <textarea rows="3" style="background:#fff" placeholder="What does your startup do better than anyone else?"></textarea>
          </div>
          <div style="background:#fee2e2;padding:16px;border-radius:8px">
            <h4 style="color:#dc2626;margin-top:0">Weaknesses</h4>
            <textarea rows="3" style="background:#fff" placeholder="Where does your startup need to improve?"></textarea>
          </div>
          <div style="background:#dbeafe;padding:16px;border-radius:8px">
            <h4 style="color:#2563eb;margin-top:0">Opportunities</h4>
            <textarea rows="3" style="background:#fff" placeholder="What market trends can you take advantage of?"></textarea>
          </div>
          <div style="background:#fef3c7;padding:16px;border-radius:8px">
            <h4 style="color:#d97706;margin-top:0">Threats</h4>
            <textarea rows="3" style="background:#fff" placeholder="What challenges or competitors could threaten you?"></textarea>
          </div>
        </div>
      </div>
      <div class="card" style="border-left:4px solid #7c3aed">
        <h3 style="margin-bottom:12px">Competitive Analysis Matrix</h3>
        <table>
          <tr><th>Feature</th><th>Your Startup</th><th>Competitor A</th><th>Competitor B</th><th>Competitor C</th></tr>
          ${['Core Feature 1', 'Core Feature 2', 'Pricing', 'User Experience', 'Customer Support', 'Scalability', 'Innovation'].map(f =>
            `<tr><td style="font-weight:600">${f}</td>${[0,1,2,3].map(() => `<td><select style="width:auto;padding:4px"><option value="5">&#11088;&#11088;&#11088;&#11088;&#11088;</option><option value="4">&#11088;&#11088;&#11088;&#11088;</option><option value="3">&#11088;&#11088;&#11088;</option><option value="2">&#11088;&#11088;</option><option value="1">&#11088;</option></select></td>`).join('')}</tr>`
          ).join('')}
        </table>
      </div>
      <div class="card" style="border-left:4px solid #d97706">
        <h3 style="margin-bottom:12px">TAM / SAM / SOM Calculator</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div style="background:#ede9fe;padding:16px;border-radius:8px;text-align:center">
            <h4 style="color:#4f46e5;margin-top:0">TAM</h4>
            <p style="font-size:.85em;color:${GRAY};margin-bottom:8px">Total Addressable Market</p>
            <input type="text" placeholder="e.g., $50B" style="text-align:center">
          </div>
          <div style="background:#dcfce7;padding:16px;border-radius:8px;text-align:center">
            <h4 style="color:#059669;margin-top:0">SAM</h4>
            <p style="font-size:.85em;color:${GRAY};margin-bottom:8px">Serviceable Addressable Market</p>
            <input type="text" placeholder="e.g., $5B" style="text-align:center">
          </div>
          <div style="background:#fef3c7;padding:16px;border-radius:8px;text-align:center">
            <h4 style="color:#d97706;margin-top:0">SOM</h4>
            <p style="font-size:.85em;color:${GRAY};margin-bottom:8px">Serviceable Obtainable Market</p>
            <input type="text" placeholder="e.g., $50M" style="text-align:center">
          </div>
        </div>
      </div>
      <div class="card" style="border-left:4px solid #0891b2">
        <h3 style="margin-bottom:12px">Value Proposition Canvas</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <h4 style="color:#dc2626">Customer Profile</h4>
            <div style="margin-bottom:8px"><label style="font-weight:600;font-size:.9em">Customer Jobs</label>
              <textarea rows="2" placeholder="What are customers trying to get done?"></textarea></div>
            <div style="margin-bottom:8px"><label style="font-weight:600;font-size:.9em">Pains</label>
              <textarea rows="2" placeholder="What annoys customers?"></textarea></div>
            <div><label style="font-weight:600;font-size:.9em">Gains</label>
              <textarea rows="2" placeholder="What outcomes do customers want?"></textarea></div>
          </div>
          <div>
            <h4 style="color:#059669">Value Map</h4>
            <div style="margin-bottom:8px"><label style="font-weight:600;font-size:.9em">Products & Services</label>
              <textarea rows="2" placeholder="What are you offering?"></textarea></div>
            <div style="margin-bottom:8px"><label style="font-weight:600;font-size:.9em">Pain Relievers</label>
              <textarea rows="2" placeholder="How do you eliminate customer pains?"></textarea></div>
            <div><label style="font-weight:600;font-size:.9em">Gain Creators</label>
              <textarea rows="2" placeholder="How do you create customer gains?"></textarea></div>
          </div>
        </div>
      </div>
      <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
    `;
    res.send(renderPage(req, 'Market Analysis', body));
  });

  // ─── 12. Resources ───
  app.get(PREFIX + '/resources', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resources = await pool.query('SELECT * FROM startup_resources WHERE tenant_id=$1 ORDER BY featured DESC, created_at DESC', [req.tenant.id]);
      const categories = [...new Set(resources.rows.map(r => r.category || 'General'))];
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Startup Resources</h2>
          <p style="color:${GRAY}">Curated tools, templates, and guides for student entrepreneurs</p>
        </div>
        ${categories.map(cat => `
          <h3 style="color:${P};margin:16px 0 8px">${esc(cat)}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:16px">
            ${resources.rows.filter(r => (r.category || 'General') === cat).map(r => `
              <div class="card" style="border-top:3px solid ${P}">
                ${r.featured ? '<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:12px;font-size:.75em;font-weight:600">FEATURED</span>' : ''}
                <h4 style="margin:4px 0">${esc(r.title)}</h4>
                <p style="color:${GRAY};font-size:.9em;margin-bottom:8px">${esc((r.description || '').substring(0, 150))}</p>
                ${r.url ? `<a href="${esc(r.url)}" target="_blank" class="btn" style="padding:4px 12px;font-size:.85em">Open Resource &rarr;</a>` : ''}
              </div>
            `).join('')}
          </div>
        `).join('')}
        ${resources.rows.length === 0 ? '<div class="card"><p style="color:${GRAY}">No resources added yet. Resources will appear here once configured.</p></div>' : ''}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Startup Resources', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 13. Pitch Deck Template ───
  app.get(PREFIX + '/pitch-deck-template', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:4px">Pitch Deck Template</h2>
        <p style="color:${GRAY}">Follow this 12-slide structure to create a compelling investor pitch</p>
        <style>.slide{background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:12px;page-break-inside:avoid}.slide h3{color:${P};margin-top:0;display:flex;align-items:center;gap:8px}.slide-num{background:${P};color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.85em;font-weight:700}</style>
      </div>
      ${[
        { num: 1, title: 'Title Slide', desc: 'Startup name, logo, tagline, and presenter info. Make it memorable and visually appealing.' },
        { num: 2, title: 'Problem', desc: 'Clearly define the problem you are solving. Use data and stories to make it relatable. Show the pain point.' },
        { num: 3, title: 'Solution', desc: 'Present your solution. Explain how it addresses the problem. Show a demo or mockup if possible.' },
        { num: 4, title: 'Market Opportunity', desc: 'Define TAM, SAM, SOM. Show market growth trends. Demonstrate the market is large and growing.' },
        { num: 5, title: 'Business Model', desc: 'How do you make money? Explain your revenue streams, pricing, and unit economics.' },
        { num: 6, title: 'Traction', desc: 'Show what you have achieved. Users, revenue, partnerships, press. Prove momentum.' },
        { num: 7, title: 'Product / Technology', desc: 'Deep dive into your product. Show the technology stack, IP, and product roadmap.' },
        { num: 8, title: 'Go-to-Market Strategy', desc: 'How will you acquire customers? Detail your marketing, sales, and distribution strategy.' },
        { num: 9, title: 'Competitive Analysis', desc: 'Show where you fit in the landscape. Highlight your competitive advantage / moat.' },
        { num: 10, title: 'Team', desc: 'Introduce your team. Highlight relevant experience and why this is the right team to win.' },
        { num: 11, title: 'Financial Projections', desc: 'Show 3-5 year projections. Revenue, costs, key metrics. Be realistic and defensible.' },
        { num: 12, title: 'The Ask', desc: 'How much are you raising? What will you use it for? What milestones will you hit? Contact info.' }
      ].map(s => `
        <div class="slide">
          <h3><span class="slide-num">${s.num}</span> ${s.title}</h3>
          <p>${s.desc}</p>
        </div>
      `).join('')}
      <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back to Incubator</a>
    `;
    res.send(renderPage(req, 'Pitch Deck Template', body));
  });
};
