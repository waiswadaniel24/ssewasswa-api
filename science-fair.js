module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-draft{background:#fef3c7;color:#92400e}.badge-review{background:#dbeafe;color:#1e40af}.badge-scored{background:#d1fae5;color:#065f46}.badge-winner{background:#ede9fe;color:#5b21b6}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-num{font-size:28px;font-weight:700;color:#4f46e5}.stat-label{font-size:13px;color:#6b7280;margin-top:4px}.tabs{display:flex;gap:8px;margin-bottom:16px}.tab{padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px;border:1px solid #e5e7eb;background:#fff}.tab.active{background:#4f46e5;color:#fff;border-color:#4f46e5}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:#4f46e5;border-radius:4px}.empty{text-align:center;padding:40px;color:#6b7280}</style>';

  /* ── Database Migration ── */
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS science_categories (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(120) NOT NULL,
        description TEXT, max_score INT DEFAULT 100, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS science_projects (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(300) NOT NULL,
        category VARCHAR(100) NOT NULL, abstract TEXT, hypothesis TEXT, methodology TEXT,
        results TEXT, conclusion TEXT, student_ids JSONB DEFAULT '[]',
        mentor_id INT, status VARCHAR(50) DEFAULT 'draft', score NUMERIC(6,2) DEFAULT 0,
        grade VARCHAR(10), display_board_url TEXT, documentation_url TEXT,
        budget_amount NUMERIC(10,2) DEFAULT 0, timeline_data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS science_judges (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT NOT NULL,
        categories JSONB DEFAULT '[]', assigned_projects JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS science_scores (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, project_id INT NOT NULL,
        judge_id INT NOT NULL, criteria_scores JSONB DEFAULT '{}',
        total_score NUMERIC(6,2) DEFAULT 0, comments TEXT,
        scored_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] science-fair OK');
    } catch (e) { console.warn('[Mod] science-fair Warn:', e.message); }
  })();

  const CATS = ['Biology','Chemistry','Physics','Computer Science','Engineering'];
  const STATUSES = ['draft','submitted','under_review','scored','awarded','finalist','winner'];
  const CRITERIA = { creativity: 25, scientific_method: 25, presentation: 20, depth: 15, originality: 15 };

  /* ── Helper: seed categories ── */
  async function seedCategories(tid) {
    for (const c of CATS) {
      const [r] = await pool.query('SELECT 1 FROM science_categories WHERE tenant_id=$1 AND name=$2', [tid, c]);
      if (!r.length) await pool.query('INSERT INTO science_categories(tenant_id,name,description,max_score) VALUES($1,$2,$3,$4)', [tid, c, c + ' projects', 100]);
    }
  }

  /* ── Dashboard ── */
  app.get('/school/science-fair', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    await seedCategories(tid);
    const [projects] = await pool.query('SELECT * FROM science_projects WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 50', [tid]);
    const [judges] = await pool.query('SELECT * FROM science_judges WHERE tenant_id=$1', [tid]);
    const [cats] = await pool.query('SELECT * FROM science_categories WHERE tenant_id=$1', [tid]);
    const statusCounts = {};
    STATUSES.forEach(s => statusCounts[s] = 0);
    projects.forEach(p => { if (statusCounts[p.status] !== undefined) statusCounts[p.status]++; });
    const totalProjects = projects.length;
    const avgScore = totalProjects ? (projects.reduce((a, p) => a + Number(p.score || 0), 0) / totalProjects).toFixed(1) : 0;
    const categoriesHtml = cats.map(c => `<span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(c.name)}</span>`).join(' ');

    const rows = projects.map(p => {
      const badge = `badge-${p.status}`;
      return `<tr>
        <td><a href="/school/science-fair/project/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.title)}</a></td>
        <td>${esc(p.category)}</td>
        <td><span class="badge ${badge}">${esc(p.status)}</span></td>
        <td>${p.score || 0}</td>
        <td>${esc(p.grade || '-')}</td>
        <td>${new Date(p.updated_at).toLocaleDateString()}</td>
        <td><a class="btn btn-sm" href="/school/science-fair/project/${p.id}">View</a></td>
      </tr>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:1200px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">🔬 Science Fair</h1>
      <p style="color:${GRAY};margin-bottom:20px">Manage projects, judges, scoring and awards</p>
      <div class="grid" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-num">${totalProjects}</div><div class="stat-label">Total Projects</div></div>
        <div class="stat-card"><div class="stat-num">${judges.length}</div><div class="stat-label">Judges</div></div>
        <div class="stat-card"><div class="stat-num">${avgScore}</div><div class="stat-label">Avg Score</div></div>
        <div class="stat-card"><div class="stat-num">${cats.length}</div><div class="stat-label">Categories</div></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
          <h2>Projects</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn" href="/school/science-fair/register">Register Project</a>
            <a class="btn btn-success" href="/school/science-fair/judges">Manage Judges</a>
            <a class="btn" href="/school/science-fair/results">Results</a>
            <a class="btn" href="/school/science-fair/virtual-fair">Virtual Fair</a>
          </div>
        </div>
        <div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap">
          ${categoriesHtml}
          ${STATUSES.map(s => `<span class="badge badge-${s}">${s.replace('_',' ')}: ${statusCounts[s]}</span>`).join('')}
        </div>
        <div style="overflow-x:auto"><table><thead><tr>
          <th>Title</th><th>Category</th><th>Status</th><th>Score</th><th>Grade</th><th>Updated</th><th>Actions</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">No projects yet. Register your first project!</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Science Fair'));
  });

  /* ── Register Project ── */
  app.get('/school/science-fair/register', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [cats] = await pool.query('SELECT * FROM science_categories WHERE tenant_id=$1 ORDER BY name', [tid]);
    const [mentors] = await pool.query("SELECT id, name FROM users WHERE tenant_id=$1 AND role IN ('teacher','admin') ORDER BY name", [tid]);
    const [students] = await pool.query("SELECT id, name FROM users WHERE tenant_id=$1 AND role='student' ORDER BY name", [tid]);
    const catOpts = cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    const mentorOpts = mentors.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    const studentChecks = students.map(s => `<label style="display:block;margin:4px 0"><input type="checkbox" name="student_ids" value="${s.id}"> ${esc(s.name)}</label>`).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:20px">📋 Register Science Fair Project</h1>
      <form method="POST" action="/school/science-fair/register" class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><label>Title *</label><input name="title" required placeholder="Project title"></div>
          <div><label>Category *</label><select name="category" required><option value="">Select...</option>${catOpts}</select></div>
        </div>
        <div style="margin-top:12px"><label>Abstract *</label><textarea name="abstract" rows="3" required placeholder="Brief overview of your project"></textarea></div>
        <div style="margin-top:12px"><label>Hypothesis</label><textarea name="hypothesis" rows="2" placeholder="What do you expect to discover?"></textarea></div>
        <div style="margin-top:12px"><label>Methodology</label><textarea name="methodology" rows="3" placeholder="Describe your research methodology"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
          <div><label>Mentor</label><select name="mentor_id"><option value="">None</option>${mentorOpts}</select></div>
          <div><label>Budget ($)</label><input type="number" name="budget_amount" step="0.01" min="0" value="0"></div>
        </div>
        <div style="margin-top:12px"><label>Team Members</label><div style="max-height:150px;overflow-y:auto;border:1px solid #d1d5db;border-radius:8px;padding:8px">${studentChecks || '<p style="color:#6b7280">No students found</p>'}</div></div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn">Register Project</button>
          <a href="/school/science-fair" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Register Project'));
  });

  app.post('/school/science-fair/register', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const { title, category, abstract, hypothesis, methodology, mentor_id, budget_amount, student_ids } = req.body;
    const sids = Array.isArray(student_ids) ? student_ids : (student_ids ? [student_ids] : []);
    const sidsJson = JSON.stringify(sids.map(Number));
    const budget = Math.max(0, Number(budget_amount) || 0);
    await pool.query(
      `INSERT INTO science_projects(tenant_id,title,category,abstract,hypothesis,methodology,mentor_id,budget_amount,student_ids,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted')`,
      [tid, title, category, abstract, hypothesis, methodology, mentor_id ? Number(mentor_id) : null, budget, sidsJson]
    );
    audit(req, 'science_fair_register', { title, category });
    req.flash('success', 'Project registered successfully!');
    res.redirect('/school/science-fair');
  }));

  /* ── View / Edit Project ── */
  app.get('/school/science-fair/project/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const pid = Number(req.params.id);
    const [rows] = await pool.query('SELECT * FROM science_projects WHERE tenant_id=$1 AND id=$2', [tid, pid]);
    if (!rows.length) return res.status(404).send('Project not found');
    const p = rows[0];
    const [scores] = await pool.query(
      'SELECT s.*, u.name AS judge_name FROM science_scores s JOIN users u ON u.id=s.judge_id WHERE s.tenant_id=$1 AND s.project_id=$2',
      [tid, pid]
    );
    const criteriaHtml = Object.entries(CRITERIA).map(([k, v]) =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6"><span>${esc(k.replace(/_/g,' '))}</span><strong>${v} pts</strong></div>`
    ).join('');
    const scoreRows = scores.map(s => {
      const cs = s.criteria_scores || {};
      const breakdown = Object.entries(cs).map(([k, v]) => `${k}: ${v}`).join(', ');
      return `<tr><td>${esc(s.judge_name)}</td><td>${breakdown || '-'}</td><td><strong>${s.total_score}</strong></td><td>${esc(s.comments || '-')}</td></tr>`;
    }).join('');
    const students = (p.student_ids || []).map(id => `<span class="badge" style="background:#dbeafe;color:#1e40af">Student #${id}</span>`).join(' ');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div><h1 style="color:${P};margin:0">🔬 ${esc(p.title)}</h1>
        <p style="color:${GRAY};margin:4px 0 0">${esc(p.category)} · <span class="badge badge-${p.status}">${esc(p.status)}</span></p></div>
        <a href="/school/science-fair" class="btn btn-sm">← Back</a>
      </div>
      <div class="grid">
        <div class="card">
          <h3>Project Details</h3>
          <div style="margin-top:8px"><strong>Abstract:</strong><p style="color:${GRAY}">${esc(p.abstract || 'N/A')}</p></div>
          <div style="margin-top:8px"><strong>Hypothesis:</strong><p style="color:${GRAY}">${esc(p.hypothesis || 'N/A')}</p></div>
          <div style="margin-top:8px"><strong>Methodology:</strong><p style="color:${GRAY}">${esc(p.methodology || 'N/A')}</p></div>
          <div style="margin-top:8px"><strong>Results:</strong><p style="color:${GRAY}">${esc(p.results || 'N/A')}</p></div>
          <div style="margin-top:8px"><strong>Conclusion:</strong><p style="color:${GRAY}">${esc(p.conclusion || 'N/A')}</p></div>
          <div style="margin-top:12px"><strong>Team:</strong><div style="margin-top:4px">${students || '<span style="color:#6b7280">No team members</span>'}</div></div>
          <div style="margin-top:8px"><strong>Mentor:</strong> <span style="color:${GRAY}">${p.mentor_id ? '#' + p.mentor_id : 'None'}</span></div>
          <div style="margin-top:8px"><strong>Budget:</strong> <span style="color:${GRAY}">$${Number(p.budget_amount || 0).toFixed(2)}</span></div>
        </div>
        <div>
          <div class="card">
            <h3>Scores</h3>
            <div style="text-align:center;margin:12px 0"><div style="font-size:36px;font-weight:700;color:${P}">${p.score || 0}</div><div style="color:${GRAY}">Overall Score</div></div>
            <div style="margin-bottom:8px"><strong>Grade:</strong> <span class="badge badge-winner">${esc(p.grade || 'Pending')}</span></div>
          </div>
          <div class="card">
            <h3>Rubric Criteria</h3>
            <div style="margin-top:8px">${criteriaHtml}</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Judge Scores (${scores.length})</h3>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Judge</th><th>Breakdown</th><th>Total</th><th>Comments</th></tr></thead>
          <tbody>${scoreRows || '<tr><td colspan="4" class="empty">No scores yet</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Edit Project</h3>
        <form method="POST" action="/school/science-fair/project/${pid}">
          <div style="margin-top:8px"><label>Results</label><textarea name="results" rows="3">${esc(p.results || '')}</textarea></div>
          <div style="margin-top:8px"><label>Conclusion</label><textarea name="conclusion" rows="3">${esc(p.conclusion || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
            <div><label>Status</label><select name="status">${STATUSES.map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.replace(/_/g,' ')}</option>`).join('')}</select></div>
            <div><label>Display Board URL</label><input name="display_board_url" value="${esc(p.display_board_url || '')}" placeholder="https://..."></div>
          </div>
          <div style="margin-top:8px"><label>Documentation URL</label><input name="documentation_url" value="${esc(p.documentation_url || '')}" placeholder="https://..."></div>
          <div style="margin-top:12px"><button type="submit" class="btn">Save Changes</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage(req, html, p.title));
  });

  app.post('/school/science-fair/project/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const pid = Number(req.params.id);
    const { results, conclusion, status, display_board_url, documentation_url } = req.body;
    await pool.query(
      `UPDATE science_projects SET results=$1,conclusion=$2,status=$3,display_board_url=$4,documentation_url=$5,updated_at=NOW() WHERE tenant_id=$6 AND id=$7`,
      [results, conclusion, status, display_board_url, documentation_url, tid, pid]
    );
    audit(req, 'science_fair_edit_project', { pid, status });
    req.flash('success', 'Project updated!');
    res.redirect('/school/science-fair/project/' + pid);
  }));

  /* ── Judges Management ── */
  app.get('/school/science-fair/judges', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [judges] = await pool.query(
      'SELECT j.*, u.name, u.email FROM science_judges j JOIN users u ON u.id=j.user_id WHERE j.tenant_id=$1 ORDER BY j.created_at DESC',
      [tid]
    );
    const [available] = await pool.query(
      "SELECT u.id, u.name, u.email FROM users u WHERE u.tenant_id=$1 AND u.role IN ('teacher','admin') AND u.id NOT IN (SELECT user_id FROM science_judges WHERE tenant_id=$1) ORDER BY u.name",
      [tid, tid]
    );
    const judgeRows = judges.map(j => {
      const cats = (j.categories || []).map(c => `<span class="badge" style="background:#e0e7ff;color:#3730a3">${esc(c)}</span>`).join(' ');
      const assigned = (j.assigned_projects || []).length;
      return `<tr>
        <td><strong>${esc(j.name)}</strong><br><small style="color:${GRAY}">${esc(j.email)}</small></td>
        <td>${cats || '<span style="color:#6b7280">All categories</span>'}</td>
        <td>${assigned} projects</td>
        <td><button class="btn btn-sm btn-danger" onclick="removeJudge(${j.id})">Remove</button></td>
      </tr>`;
    }).join('');
    const addOpts = available.map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.email)})</option>`).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">👨‍⚖️ Science Fair Judges</h1>
        <a href="/school/science-fair" class="btn btn-sm">← Dashboard</a>
      </div>
      <div class="card">
        <h3>Add Judge</h3>
        <form method="POST" action="/school/science-fair/judges" style="display:flex;gap:8px;align-items:end;margin-top:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px"><label>User</label><select name="user_id" required><option value="">Select teacher/admin...</option>${addOpts}</select></div>
          <div style="min-width:250px"><label>Categories</label><input name="categories" placeholder="Biology, Chemistry (comma separated)"></div>
          <button type="submit" class="btn">Add Judge</button>
        </form>
      </div>
      <div class="card">
        <h3>Current Judges (${judges.length})</h3>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Judge</th><th>Categories</th><th>Assigned</th><th>Actions</th></tr></thead>
          <tbody>${judgeRows || '<tr><td colspan="4" class="empty">No judges added yet</td></tr>'}</tbody></table>
        </div>
      </div>
      <script>
      function removeJudge(id){if(confirm('Remove this judge?'))fetch('/school/science-fair/judges/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}
      </script>
    </div>`;
    res.send(renderPage(req, html, 'Manage Judges'));
  });

  app.post('/school/science-fair/judges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { user_id, categories } = req.body;
    const cats = categories ? categories.split(',').map(c => c.trim()).filter(Boolean) : [];
    await pool.query(
      'INSERT INTO science_judges(tenant_id,user_id,categories) VALUES($1,$2,$3)',
      [tid, Number(user_id), JSON.stringify(cats)]
    );
    audit(req, 'science_fair_add_judge', { user_id });
    req.flash('success', 'Judge added!');
    res.redirect('/school/science-fair/judges');
  }));

  app.delete('/school/science-fair/judges/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM science_judges WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.id)]);
    audit(req, 'science_fair_remove_judge', { judge_id: req.params.id });
    res.json({ ok: true });
  }));

  /* ── Scoring ── */
  app.get('/school/science-fair/scoring/:project_id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const pid = Number(req.params.project_id);
    const [projects] = await pool.query('SELECT * FROM science_projects WHERE tenant_id=$1 AND id=$2', [tid, pid]);
    if (!projects.length) return res.status(404).send('Project not found');
    const p = projects[0];
    const [existing] = await pool.query('SELECT * FROM science_scores WHERE tenant_id=$1 AND project_id=$2 AND judge_id=$3', [tid, pid, uid]);
    const scores = existing.length ? existing[0].criteria_scores : {};
    const fields = Object.entries(CRITERIA).map(([k, max]) =>
      `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <label style="width:180px;font-weight:600">${esc(k.replace(/_/g,' '))} <small style="color:${GRAY}">(max ${max})</small></label>
        <input type="number" name="score_${k}" min="0" max="${max}" value="${scores[k] || 0}" style="width:100px">
      </div>`
    ).join('');

    const html = `${SKIP}
    <div style="max-width:700px;margin:0 auto;padding:20px">
      <h1 style="color:${P};margin-bottom:4px">📝 Score Project</h1>
      <p style="color:${GRAY};margin-bottom:20px">${esc(p.title)} · ${esc(p.category)}</p>
      <div class="card">
        <p style="margin-bottom:12px">${esc(p.abstract || '')}</p>
      </div>
      <form method="POST" action="/school/science-fair/scoring/${pid}" class="card">
        <h3>Criteria Scores</h3>
        <div style="margin-top:12px">${fields}</div>
        <div style="margin-top:12px"><label>Comments</label><textarea name="comments" rows="3" placeholder="Provide detailed feedback...">${esc(existing.length ? existing[0].comments : '')}</textarea></div>
        <div style="margin-top:16px"><button type="submit" class="btn">Submit Score</button>
          <a href="/school/science-fair" class="btn" style="background:#6b7280;text-decoration:none;margin-left:8px">Cancel</a></div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Score Project'));
  });

  app.post('/school/science-fair/scoring/:project_id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const pid = Number(req.params.project_id);
    const { comments } = req.body;
    const criteriaScores = {};
    let total = 0;
    for (const [k, max] of Object.entries(CRITERIA)) {
      const v = Math.min(max, Math.max(0, Number(req.body['score_' + k]) || 0));
      criteriaScores[k] = v;
      total += v;
    }
    const [existing] = await pool.query('SELECT id FROM science_scores WHERE tenant_id=$1 AND project_id=$2 AND judge_id=$3', [tid, pid, uid]);
    if (existing.length) {
      await pool.query('UPDATE science_scores SET criteria_scores=$1,total_score=$2,comments=$3,scored_at=NOW() WHERE tenant_id=$4 AND project_id=$5 AND judge_id=$6',
        [JSON.stringify(criteriaScores), total, comments, tid, pid, uid]);
    } else {
      await pool.query('INSERT INTO science_scores(tenant_id,project_id,judge_id,criteria_scores,total_score,comments) VALUES($1,$2,$3,$4,$5,$6)',
        [tid, pid, uid, JSON.stringify(criteriaScores), total, comments]);
    }
    await pool.query('UPDATE science_projects SET score=COALESCE((SELECT ROUND(AVG(total_score),2) FROM science_scores WHERE project_id=$1),0), status=CASE WHEN (SELECT COUNT(*) FROM science_scores WHERE project_id=$1)>=2 THEN \'scored\' ELSE status END, updated_at=NOW() WHERE id=$1', [pid]);
    audit(req, 'science_fair_score', { pid, total });
    req.flash('success', `Score submitted: ${total} points`);
    res.redirect('/school/science-fair');
  }));

  /* ── Results ── */
  app.get('/school/science-fair/results', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [projects] = await pool.query(
      "SELECT p.*, (SELECT COUNT(*) FROM science_scores WHERE project_id=p.id) AS judge_count FROM science_projects p WHERE p.tenant_id=$1 AND p.status IN ('scored','awarded','winner') ORDER BY p.score DESC, p.title ASC",
      [tid]
    );
    const rows = projects.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const scorePct = Math.min(100, Math.round((Number(p.score) / 100) * 100));
      return `<tr>
        <td style="font-size:20px">${medal}</td>
        <td><a href="/school/science-fair/project/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.title)}</a></td>
        <td>${esc(p.category)}</td>
        <td><div class="progress-bar" style="width:120px"><div class="progress-fill" style="width:${scorePct}%"></div></div></td>
        <td><strong>${p.score}</strong></td>
        <td>${p.judge_count} judges</td>
        <td><span class="badge badge-${p.status}">${esc(p.status)}</span></td>
      </tr>`;
    }).join('');
    const winners = projects.filter(p => p.status === 'winner');
    const topScore = projects.length ? projects[0].score : 0;
    const avgScore = projects.length ? (projects.reduce((a, p) => a + Number(p.score), 0) / projects.length).toFixed(1) : 0;

    const html = `${SKIP}
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🏆 Science Fair Results</h1>
        <div style="display:flex;gap:8px">
          <a class="btn" href="/school/science-fair/certificates">Certificates</a>
          <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
        </div>
      </div>
      <div class="grid" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${projects.length}</div><div class="stat-label">Scored Projects</div></div>
        <div class="stat-card"><div class="stat-num">${topScore}</div><div class="stat-label">Top Score</div></div>
        <div class="stat-card"><div class="stat-num">${avgScore}</div><div class="stat-label">Average</div></div>
        <div class="stat-card"><div class="stat-num">${winners.length}</div><div class="stat-label">Winners</div></div>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table><thead><tr>
          <th>#</th><th>Project</th><th>Category</th><th>Progress</th><th>Score</th><th>Judges</th><th>Status</th>
        </tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">No scored projects yet</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Results'));
  });

  /* ── Categories Management ── */
  app.get('/school/science-fair/categories', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    await seedCategories(tid);
    const [cats] = await pool.query('SELECT c.*, (SELECT COUNT(*) FROM science_projects p WHERE p.tenant_id=$1 AND p.category=c.name) AS project_count FROM science_categories c WHERE c.tenant_id=$1 ORDER BY c.name', [tid, tid]);
    const rows = cats.map(c => `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.description || '-')}</td>
      <td>${c.max_score}</td>
      <td>${c.project_count} projects</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteCat(${c.id})">Delete</button></td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📂 Categories</h1>
        <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Add Category</h3>
        <form method="POST" action="/school/science-fair/categories" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px">
          <div style="flex:1;min-width:150px"><label>Name</label><input name="name" required></div>
          <div style="flex:2;min-width:200px"><label>Description</label><input name="description"></div>
          <div style="width:100px"><label>Max Score</label><input type="number" name="max_score" value="100" min="1"></div>
          <button type="submit" class="btn">Add</button>
        </form>
      </div>
      <div class="card">
        <table><thead><tr><th>Name</th><th>Description</th><th>Max Score</th><th>Projects</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
      <script>function deleteCat(id){if(confirm('Delete this category?'))fetch('/school/science-fair/categories/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Categories'));
  });

  app.post('/school/science-fair/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const { name, description, max_score } = req.body;
    await pool.query('INSERT INTO science_categories(tenant_id,name,description,max_score) VALUES($1,$2,$3,$4)',
      [tid, name, description, Number(max_score) || 100]);
    audit(req, 'science_fair_add_category', { name });
    req.flash('success', 'Category added!');
    res.redirect('/school/science-fair/categories');
  }));

  app.delete('/school/science-fair/categories/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM science_categories WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.id)]);
    audit(req, 'science_fair_delete_category', { id: req.params.id });
    res.json({ ok: true });
  }));

  /* ── Certificates ── */
  app.get('/school/science-fair/certificates', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [winners] = await pool.query(
      "SELECT * FROM science_projects WHERE tenant_id=$1 AND status IN ('winner','awarded','finalist') ORDER BY score DESC",
      [tid]
    );
    const [topCategory] = await pool.query(
      "SELECT category, MAX(score) as top_score FROM science_projects WHERE tenant_id=$1 AND status='scored' GROUP BY category ORDER BY top_score DESC",
      [tid]
    );
    const certCards = winners.map(p => {
      const label = p.status === 'winner' ? '🏆 Winner' : p.status === 'finalist' ? '🌟 Finalist' : '🎖️ Awarded';
      return `<div class="card" style="text-align:center;border:2px solid #e0e7ff">
        <div style="font-size:40px;margin-bottom:8px">🏆</div>
        <h3>${esc(p.title)}</h3>
        <p style="color:${GRAY}">${esc(p.category)}</p>
        <p style="font-size:24px;font-weight:700;color:${P}">Score: ${p.score}</p>
        <span class="badge badge-${p.status}">${label}</span>
        <div style="margin-top:12px"><button class="btn btn-sm" onclick="generateCert(${p.id})">📄 Generate Certificate</button></div>
      </div>`;
    }).join('');
    const catWinners = topCategory.map(c => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between"><strong>${esc(c.category)}</strong><span>${c.top_score} pts</span></div>`).join('');

    const html = `${SKIP}
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📜 Certificates & Awards</h1>
        <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Category Top Scores</h3>
        <div style="margin-top:8px">${catWinners || '<p class="empty">No category data yet</p>'}</div>
        <div style="margin-top:12px"><button class="btn" onclick="generateAllCerts()">Generate All Certificates</button></div>
      </div>
      <h2 style="margin:20px 0 12px;color:${P}">Awardees</h2>
      <div class="grid">${certCards || '<div class="empty" style="grid-column:1/-1">No awardees yet. Score projects and set winners first.</div>'}</div>
      <script>
      function generateCert(id){alert('Certificate generation queued for project #'+id)}
      function generateAllCerts(){alert('Bulk certificate generation started')}
      </script>
    </div>`;
    res.send(renderPage(req, html, 'Certificates'));
  });

  /* ── Virtual Fair ── */
  app.get('/school/science-fair/virtual-fair', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [projects] = await pool.query(
      "SELECT * FROM science_projects WHERE tenant_id=$1 AND status IN ('submitted','under_review','scored','awarded','winner') ORDER BY category, score DESC",
      [tid]
    );
    const grouped = {};
    projects.forEach(p => { (grouped[p.category] = grouped[p.category] || []).push(p); });
    const sections = Object.entries(grouped).map(([cat, projs]) => {
      const cards = projs.map(p => `
        <div class="card" style="cursor:pointer" onclick="location.href='/school/science-fair/project/${p.id}'">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <h4 style="margin:0">${esc(p.title)}</h4>
            <span class="badge badge-${p.status}">${esc(p.status)}</span>
          </div>
          <p style="color:${GRAY};font-size:13px;margin-top:6px">${esc((p.abstract || '').substring(0, 120))}${(p.abstract || '').length > 120 ? '...' : ''}</p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <span style="font-size:13px;color:${GRAY}">By ${(p.student_ids || []).length} student(s)</span>
            <strong style="color:${P}">${p.score || 0} pts</strong>
          </div>
          ${p.display_board_url ? `<div style="margin-top:8px"><a href="${esc(p.display_board_url)}" target="_blank" class="btn btn-sm">🖥️ View Display Board</a></div>` : ''}
          ${p.documentation_url ? `<div style="margin-top:4px"><a href="${esc(p.documentation_url)}" target="_blank" style="color:${P};font-size:13px">📄 Documentation</a></div>` : ''}
        </div>`).join('');
      return `<div class="card">
        <h2 style="color:${P};margin-bottom:12px">${esc(cat)} (${projs.length})</h2>
        <div class="grid">${cards}</div>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div><h1 style="color:${P};margin:0">🌐 Virtual Science Fair</h1>
        <p style="color:${GRAY};margin:4px 0 0">${projects.length} projects exhibited</p></div>
        <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      ${sections || '<div class="card"><p class="empty">No projects to exhibit yet</p></div>'}
    </div>`;
    res.send(renderPage(req, html, 'Virtual Fair'));
  });

  /* ── Timeline ── */
  app.get('/school/science-fair/timeline', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [projects] = await pool.query(
      "SELECT id, title, category, status, created_at, updated_at FROM science_projects WHERE tenant_id=$1 ORDER BY created_at",
      [tid]
    );
    const milestones = [
      { label: 'Registration Open', date: 'TBD', color: '#4f46e5' },
      { label: 'Project Submission Deadline', date: 'TBD', color: '#7c3aed' },
      { label: 'Judging Period', date: 'TBD', color: '#2563eb' },
      { label: 'Results Announcement', date: 'TBD', color: '#059669' },
      { label: 'Awards Ceremony', date: 'TBD', color: '#d97706' }
    ];
    const timelineHtml = milestones.map((m, i) => `
      <div style="display:flex;gap:16px;margin-bottom:20px;position:relative">
        <div style="width:16px;height:16px;background:${m.color};border-radius:50%;margin-top:4px;flex-shrink:0"></div>
        ${i < milestones.length - 1 ? `<div style="position:absolute;left:7px;top:20px;width:2px;height:calc(100% - 4px);background:#e5e7eb"></div>` : ''}
        <div><strong>${esc(m.label)}</strong><br><span style="color:${GRAY}">${m.date}</span></div>
      </div>`).join('');
    const projectTimeline = projects.slice(-10).map(p => `
      <div style="display:flex;gap:16px;margin-bottom:12px">
        <div style="width:12px;height:12px;background:${P};border-radius:50%;margin-top:6px;flex-shrink:0"></div>
        <div><strong style="color:${P}">${esc(p.title)}</strong><br>
        <small style="color:${GRAY}">Registered ${new Date(p.created_at).toLocaleDateString()} · ${esc(p.category)} · <span class="badge badge-${p.status}" style="font-size:11px">${esc(p.status)}</span></small></div>
      </div>`).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📅 Timeline</h1>
        <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="card">
        <h3>Event Milestones</h3>
        <div style="margin-top:16px">${timelineHtml}</div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Recent Project Activity</h3>
        <div style="margin-top:12px">${projectTimeline || '<p class="empty">No activity yet</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Timeline'));
  });

  /* ── Budget Overview ── */
  app.get('/school/science-fair/budget', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [projects] = await pool.query(
      'SELECT category, COUNT(*) as cnt, SUM(budget_amount) as total FROM science_projects WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC',
      [tid]
    );
    const [grand] = await pool.query('SELECT SUM(budget_amount) as grand_total, COUNT(*) as total_projects FROM science_projects WHERE tenant_id=$1', [tid]);
    const gt = Number(grand[0]?.grand_total || 0);
    const tp = Number(grand[0]?.total_projects || 0);
    const rows = projects.map(r => {
      const pct = gt > 0 ? Math.round((Number(r.total) / gt) * 100) : 0;
      return `<tr>
        <td><strong>${esc(r.category)}</strong></td>
        <td>${r.cnt} projects</td>
        <td>$${Number(r.total).toFixed(2)}</td>
        <td><div class="progress-bar" style="width:120px"><div class="progress-fill" style="width:${pct}%"></div></div> ${pct}%</td>
      </tr>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">💰 Budget Overview</h1>
        <a href="/school/science-fair" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <div class="grid">
        <div class="stat-card"><div class="stat-num">$${gt.toFixed(2)}</div><div class="stat-label">Total Budget</div></div>
        <div class="stat-card"><div class="stat-num">${tp}</div><div class="stat-label">Projects</div></div>
        <div class="stat-card"><div class="stat-num">$${tp > 0 ? (gt / tp).toFixed(2) : '0.00'}</div><div class="stat-label">Avg per Project</div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3>Budget by Category</h3>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Category</th><th>Projects</th><th>Total</th><th>Distribution</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty">No budget data</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Budget'));
  });

  /* ── Delete Project ── */
  app.delete('/school/science-fair/project/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const pid = Number(req.params.id);
    await pool.query('DELETE FROM science_scores WHERE tenant_id=$1 AND project_id=$2', [tid, pid]);
    await pool.query('DELETE FROM science_projects WHERE tenant_id=$1 AND id=$2', [tid, pid]);
    audit(req, 'science_fair_delete_project', { pid });
    res.json({ ok: true });
  }));
};
