module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#059669}.badge-yellow{background:#fef3c7;color:#d97706}.badge-red{background:#fee2e2;color:#dc2626}.badge-blue{background:#dbeafe;color:#2563eb}.badge-purple{background:#ede9fe;color:#7c3aed}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS iot_projects (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        components JSONB DEFAULT '[]', status VARCHAR(30) DEFAULT 'idea',
        team_id INT, mentor_id INT, category VARCHAR(50),
        difficulty VARCHAR(20) DEFAULT 'beginner',
        code_repository TEXT, documentation_url TEXT,
        circuit_diagram_url TEXT, demo_video_url TEXT,
        progress INT DEFAULT 0, safety_checklist JSONB DEFAULT '[]',
        badges_earned JSONB DEFAULT '[]',
        submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
        created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS iot_components (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL, type VARCHAR(50),
        category VARCHAR(50), quantity INT DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0,
        location VARCHAR(100), bin_number VARCHAR(50),
        datasheet_url TEXT, image_url TEXT,
        specifications JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'available',
        min_stock_level INT DEFAULT 5,
        total_used INT DEFAULT 0, total_restocked INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS iot_workshops (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        date DATE, start_time TIME, duration INT DEFAULT 60,
        max_students INT DEFAULT 20, enrolled_count INT DEFAULT 0,
        instructor VARCHAR(100), instructor_id INT,
        venue VARCHAR(100), topics JSONB DEFAULT '[]',
        prerequisites TEXT, materials_needed JSONB DEFAULT '[]',
        status VARCHAR(20) DEFAULT 'scheduled',
        feedback_avg NUMERIC(3,2) DEFAULT 0,
        created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] iot-workshop OK');
    } catch(e) { console.warn('[Mod] iot-workshop Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/iot-workshop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [projects] = await pool.query('SELECT COUNT(*) AS c FROM iot_projects WHERE tenant_id=$1', [tid]);
    const [components] = await pool.query('SELECT COUNT(*) AS c, SUM(quantity) AS total FROM iot_components WHERE tenant_id=$1', [tid]);
    const [workshops] = await pool.query('SELECT COUNT(*) AS c FROM iot_workshops WHERE tenant_id=$1 AND status IN ($1,$2)', [tid, 'scheduled', 'active']);
    const [lowStock] = await pool.query('SELECT COUNT(*) AS c FROM iot_components WHERE tenant_id=$1 AND quantity <= min_stock_level', [tid]);
    const [recentProjects] = await pool.query(
      'SELECT * FROM iot_projects WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5', [tid]);
    const [upcomingWorkshops] = await pool.query(
      'SELECT * FROM iot_workshops WHERE tenant_id=$1 AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 5', [tid]);
    const [byStatus] = await pool.query(
      'SELECT status, COUNT(*) AS c FROM iot_projects WHERE tenant_id=$1 GROUP BY status ORDER BY c DESC', [tid]);
    res.send(renderPage(req, 'IoT Workshop', SKIP + `
      <div class="card"><h2 style="color:${P}">IoT Workshop Hub</h2>
      <div class="grid-3" style="margin:20px 0">
        <div class="card" style="text-align:center;border-left:4px solid ${P}"><h3 style="color:${P}">${projects.c}</h3><small>Projects</small></div>
        <div class="card" style="text-align:center;border-left:4px solid #059669"><h3 style="color:#059669">${components.total||0}</h3><small>Components in Stock</small></div>
        <div class="card" style="text-align:center;border-left:4px solid #d97706"><h3 style="color:#d97706">${workshops.c}</h3><small>Upcoming Workshops</small></div>
      </div>
      ${lowStock.c > 0 ? `<div class="card" style="background:#fef2f2;border:1px solid #fecaca;margin-bottom:16px">
        <strong style="color:#dc2626">⚠ ${lowStock.c} component(s) are below minimum stock level.</strong>
        <a href="/school/iot-workshop/components?filter=low_stock" style="color:${P};margin-left:8px">Review →</a></div>` : ''}
      <div class="grid-2">
        <div class="card"><h3 style="color:${P}">Project Status Overview</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
            ${byStatus.map(s => `<span class="badge ${s.status==='completed'?'badge-green':s.status==='active'?'badge-blue':s.status==='review'?'badge-yellow':'badge-purple'}">${esc(s.status)}: ${s.c}</span>`).join('')}
          </div>
          <h4 style="color:${GRAY}">Recent Projects</h4>
          <table><tr><th>Title</th><th>Status</th><th>Progress</th></tr>
          ${recentProjects.map(p => `<tr><td>${esc(p.title)}</td>
            <td><span class="badge ${p.status==='completed'?'badge-green':p.status==='active'?'badge-blue':'badge-yellow'}">${esc(p.status)}</span></td>
            <td><div style="background:#e5e7eb;border-radius:4px;height:8px;width:100px;display:inline-block">
              <div style="background:${P};height:8px;border-radius:4px;width:${p.progress}%"></div></div> ${p.progress}%</td></tr>`).join('')}
          </table></div>
        <div class="card"><h3 style="color:${P}">Upcoming Workshops</h3>
          ${upcomingWorkshops.length === 0 ? '<p style="color:${GRAY}">No upcoming workshops.</p>' :
            `<table><tr><th>Title</th><th>Date</th><th>Enrolled</th><th>Status</th></tr>
            ${upcomingWorkshops.map(w => `<tr><td>${esc(w.title)}</td><td>${w.date}</td>
              <td>${w.enrolled_count}/${w.max_students}</td>
              <td><span class="badge badge-blue">${esc(w.status)}</span></td></tr>`).join('')}</table>`}
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="/school/iot-workshop/projects">All Projects</a>
        <a class="btn" href="/school/iot-workshop/components" style="background:#059669">Component Inventory</a>
        <a class="btn" href="/school/iot-workshop/workshops" style="background:#d97706">Workshops</a>
        <a class="btn" href="/school/iot-workshop/safety" style="background:#dc2626">Safety Protocols</a>
        <a class="btn" href="/school/iot-workshop/badges" style="background:#7c3aed">Achievement Badges</a>
      </div></div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── Projects List ─── */
  app.get('/school/iot-workshop/projects', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const statusFilter = req.query.status || '';
    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    if (statusFilter) { where += ' AND status=$2'; params.push(statusFilter); }
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS creator_name FROM iot_projects p LEFT JOIN users u ON p.created_by=u.id ${where} ORDER BY p.created_at DESC`, params);
    const [statuses] = await pool.query('SELECT DISTINCT status FROM iot_projects WHERE tenant_id=$1', [tid]);
    res.send(renderPage(req, 'IoT Projects', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">IoT Projects (${rows.length})</h2>
          <a class="btn" href="/school/iot-workshop/projects/new">+ New Project</a>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
          <a href="/school/iot-workshop/projects" class="btn" style="background:${GRAY};font-size:12px;padding:4px 10px">All</a>
          ${statuses.map(s => `<a href="/school/iot-workshop/projects?status=${s.status}" class="btn" style="background:${statusFilter===s.status?P:GRAY};font-size:12px;padding:4px 10px">${esc(s.status)}</a>`).join('')}
        </div>
        <table><tr><th>Title</th><th>Category</th><th>Status</th><th>Difficulty</th><th>Progress</th><th>Created</th><th>Actions</th></tr>
        ${rows.map(p => `<tr>
          <td><strong>${esc(p.title)}</strong><br><small style="color:${GRAY}">by ${esc(p.creator_name||'-')}</small></td>
          <td>${esc(p.category||'-')}</td>
          <td><span class="badge ${p.status==='completed'?'badge-green':p.status==='active'?'badge-blue':p.status==='review'?'badge-yellow':'badge-purple'}">${esc(p.status)}</span></td>
          <td>${esc(p.difficulty||'-')}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div style="background:#e5e7eb;border-radius:4px;height:6px;flex:1;min-width:60px">
            <div style="background:${P};height:6px;border-radius:4px;width:${p.progress}%"></div></div><small>${p.progress}%</small></div></td>
          <td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : '-'}</td>
          <td><a href="/school/iot-workshop/projects/${p.id}/view" style="color:${P}">View</a> |
              <a href="/school/iot-workshop/projects/${p.id}/edit" style="color:#059669">Edit</a></td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── New Project ─── */
  app.get('/school/iot-workshop/projects/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'New IoT Project', SKIP + `
      <div class="card"><h2 style="color:${P}">Create IoT Project</h2>
      <form method="POST" action="/school/iot-workshop/projects/new">
        <div class="grid-2">
          <div><label>Project Title</label><input name="title" required placeholder="e.g. Smart Greenhouse Monitor"></div>
          <div><label>Category</label><select name="category">
            <option value="environment">Environment</option><option value="automation">Home Automation</option>
            <option value="wearable">Wearable Tech</option><option value="robotics">Robotics</option>
            <option value="smart_agriculture">Smart Agriculture</option><option value="health">Health Monitor</option>
            <option value="security">Security System</option><option value="other">Other</option></select></div>
          <div><label>Difficulty</label><select name="difficulty">
            <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option></select></div>
          <div><label>Status</label><select name="status">
            <option value="idea">Idea</option><option value="planning">Planning</option><option value="active">Active</option>
            <option value="review">Under Review</option><option value="completed">Completed</option></select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="4" placeholder="Describe the project goals, approach, and expected outcome..."></textarea></div>
          <div><label>Code Repository URL</label><input name="code_repository" placeholder="https://github.com/..."></div>
          <div><label>Documentation URL</label><input name="documentation_url" placeholder="https://docs..."></div>
          <div><label>Circuit Diagram URL</label><input name="circuit_diagram_url" placeholder="https://..."></div>
          <div><label>Demo Video URL</label><input name="demo_video_url" placeholder="https://..."></div>
          <div><label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="0"></div>
          <div><label>Mentor ID</label><input name="mentor_id" type="number" placeholder="Staff user ID"></div>
        </div>
        <h3 style="color:${P};margin-top:20px">Components Used</h3>
        <div id="components-section">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 80px;gap:8px;margin-bottom:8px">
            <input name="comp_name[]" placeholder="Component name">
            <input name="comp_qty[]" type="number" placeholder="Qty" value="1">
            <select name="comp_type[]"><option value="sensor">Sensor</option><option value="actuator">Actuator</option>
              <option value="microcontroller">Microcontroller</option><option value="communication">Communication</option>
              <option value="power">Power</option><option value="passive">Passive</option><option value="other">Other</option></select>
            <button type="button" class="btn" style="background:#dc2626;font-size:12px" onclick="this.parentElement.remove()">✕</button>
          </div>
        </div>
        <button type="button" class="btn" style="background:${GRAY};margin:8px 0" onclick="addCompRow()">+ Add Component</button>
        <script>
        function addCompRow(){
          const s=document.getElementById('components-section');
          const d=document.createElement('div');
          d.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr 80px;gap:8px;margin-bottom:8px';
          d.innerHTML='<input name="comp_name[]" placeholder="Component name"><input name="comp_qty[]" type="number" placeholder="Qty" value="1">'
            +'<select name="comp_type[]"><option value="sensor">Sensor</option><option value="actuator">Actuator</option>'
            +'<option value="microcontroller">Microcontroller</option><option value="communication">Communication</option>'
            +'<option value="power">Power</option><option value="passive">Passive</option><option value="other">Other</option></select>'
            +'<button type="button" class="btn" style="background:#dc2626;font-size:12px" onclick="this.parentElement.remove()">✕</button>';
          s.appendChild(d);
        }</script>
        <h3 style="color:${P};margin-top:16px">Safety Checklist</h3>
        <textarea name="safety_checklist" rows="3" placeholder='["Check voltage ratings","Use heat shrink tubing","Test circuits before powering"]'></textarea>
        <button class="btn" type="submit" style="margin-top:16px">Create Project</button>
        <a href="/school/iot-workshop/projects" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  });

  app.post('/school/iot-workshop/projects/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, description, category, difficulty, status, code_repository, documentation_url,
            circuit_diagram_url, demo_video_url, progress, mentor_id, safety_checklist } = req.body;
    const compNames = Array.isArray(req.body['comp_name[]']) ? req.body['comp_name[]'] : [req.body['comp_name[]']];
    const compQty = Array.isArray(req.body['comp_qty[]']) ? req.body['comp_qty[]'] : [req.body['comp_qty[]']];
    const compType = Array.isArray(req.body['comp_type[]']) ? req.body['comp_type[]'] : [req.body['comp_type[]']];
    const componentsList = [];
    if (compNames[0]) {
      compNames.forEach((name, i) => {
        if (name && name.trim()) componentsList.push({ name: name.trim(), quantity: parseInt(compQty[i]) || 1, type: compType[i] || 'other' });
      });
    }
    let safetyItems = [];
    try { safetyItems = JSON.parse(safety_checklist || '[]'); } catch(e) { safetyItems = []; }
    await pool.query(
      `INSERT INTO iot_projects (tenant_id, title, description, category, difficulty, status, code_repository,
       documentation_url, circuit_diagram_url, demo_video_url, progress, mentor_id, components, safety_checklist, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [tid, title, description, category, difficulty, status, code_repository, documentation_url,
       circuit_diagram_url, demo_video_url, progress || 0, mentor_id || null, JSON.stringify(componentsList), JSON.stringify(safetyItems), req.user.id]);
    await audit(req, 'iot_project_created', { title, category });
    res.redirect('/school/iot-workshop/projects');
  }));

  /* ─── View Project ─── */
  app.get('/school/iot-workshop/projects/:id/view', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS creator_name, m.name AS mentor_name FROM iot_projects p
       LEFT JOIN users u ON p.created_by=u.id LEFT JOIN users m ON p.mentor_id=m.id
       WHERE p.id=$1 AND p.tenant_id=$2`, [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const p = rows[0];
    const comps = Array.isArray(p.components) ? p.components : (typeof p.components === 'string' ? JSON.parse(p.components || '[]') : []);
    const badges = Array.isArray(p.badges_earned) ? p.badges_earned : (typeof p.badges_earned === 'string' ? JSON.parse(p.badges_earned || '[]') : []);
    const safety = Array.isArray(p.safety_checklist) ? p.safety_checklist : (typeof p.safety_checklist === 'string' ? JSON.parse(p.safety_checklist || '[]') : []);
    res.send(renderPage(req, `Project: ${p.title}`, SKIP + `
      <div class="card">
        <a href="/school/iot-workshop/projects" style="color:${P}">← Back to Projects</a>
        <div style="display:flex;justify-content:space-between;align-items:start;margin-top:12px">
          <div>
            <h2 style="color:${P}">${esc(p.title)}</h2>
            <span class="badge ${p.status==='completed'?'badge-green':p.status==='active'?'badge-blue':'badge-yellow'}">${esc(p.status)}</span>
            <span class="badge badge-purple" style="margin-left:4px">${esc(p.difficulty)}</span>
            <span class="badge badge-blue" style="margin-left:4px">${esc(p.category)}</span>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/school/iot-workshop/projects/${p.id}/edit" class="btn">Edit</a>
            <a href="/school/iot-workshop/projects/${p.id}/delete" class="btn" style="background:#dc2626" onclick="return confirm('Delete?')">Delete</a>
          </div>
        </div>
        <div style="margin-top:16px">
          <h4 style="color:${GRAY}">Progress</h4>
          <div style="background:#e5e7eb;border-radius:8px;height:12px;max-width:400px">
            <div style="background:${P};height:12px;border-radius:8px;width:${p.progress}%;transition:width 0.3s"></div>
          </div>
          <small style="color:${GRAY}">${p.progress}% complete</small>
        </div>
        <div style="margin-top:20px" class="grid-2">
          <div><h4 style="color:${P}">Description</h4><p>${esc(p.description || 'No description')}</p></div>
          <div>
            <h4 style="color:${P}">Details</h4>
            <p><strong>Created by:</strong> ${esc(p.creator_name||'-')}</p>
            <p><strong>Mentor:</strong> ${esc(p.mentor_name||'None assigned')}</p>
            <p><strong>Created:</strong> ${p.created_at || '-'}</p>
            ${p.submitted_at ? `<p><strong>Submitted:</strong> ${p.submitted_at}</p>` : ''}
            ${p.approved_at ? `<p><strong>Approved:</strong> ${p.approved_at}</p>` : ''}
          </div>
        </div>
        ${comps.length ? `<div class="card" style="margin-top:16px"><h4 style="color:${P}">Components (${comps.length})</h4>
          <table><tr><th>Component</th><th>Type</th><th>Quantity</th></tr>
          ${comps.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${c.quantity}</td></tr>`).join('')}
          </table></div>` : ''}
        ${safety.length ? `<div class="card" style="margin-top:16px"><h4 style="color:${P}">Safety Checklist</h4>
          <ul>${safety.map(s => `<li style="padding:4px 0">☐ ${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${badges.length ? `<div class="card" style="margin-top:16px"><h4 style="color:${P}">Badges Earned</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${badges.map(b => `<span class="badge badge-green">🏅 ${esc(b)}</span>`).join('')}</div></div>` : ''}
        <div class="card" style="margin-top:16px"><h4 style="color:${P}">Resources</h4>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            ${p.code_repository ? `<a href="${esc(p.code_repository)}" target="_blank" class="btn" style="background:#059669;font-size:13px">💻 Code Repo</a>` : ''}
            ${p.documentation_url ? `<a href="${esc(p.documentation_url)}" target="_blank" class="btn" style="background:#2563eb;font-size:13px">📄 Documentation</a>` : ''}
            ${p.circuit_diagram_url ? `<a href="${esc(p.circuit_diagram_url)}" target="_blank" class="btn" style="background:#d97706;font-size:13px">🔌 Circuit Diagram</a>` : ''}
            ${p.demo_video_url ? `<a href="${esc(p.demo_video_url)}" target="_blank" class="btn" style="background:#dc2626;font-size:13px">🎥 Demo Video</a>` : ''}
          </div></div>
      </div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── Edit Project ─── */
  app.get('/school/iot-workshop/projects/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM iot_projects WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const p = rows[0];
    const comps = Array.isArray(p.components) ? p.components : (typeof p.components === 'string' ? JSON.parse(p.components || '[]') : []);
    const safety = Array.isArray(p.safety_checklist) ? p.safety_checklist : (typeof p.safety_checklist === 'string' ? JSON.parse(p.safety_checklist || '[]') : []);
    res.send(renderPage(req, 'Edit IoT Project', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(p.title)}</h2>
      <form method="POST" action="/school/iot-workshop/projects/${p.id}/edit">
        <div class="grid-2">
          <div><label>Title</label><input name="title" value="${esc(p.title)}" required></div>
          <div><label>Category</label><select name="category">
            ${['environment','automation','wearable','robotics','smart_agriculture','health','security','other'].map(c =>
              `<option value="${c}" ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div><label>Difficulty</label><select name="difficulty">
            ${['beginner','intermediate','advanced'].map(d => `<option value="${d}" ${p.difficulty===d?'selected':''}>${d}</option>`).join('')}</select></div>
          <div><label>Status</label><select name="status">
            ${['idea','planning','active','review','completed'].map(s => `<option value="${s}" ${p.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="4">${esc(p.description||'')}</textarea></div>
          <div><label>Code Repo</label><input name="code_repository" value="${esc(p.code_repository||'')}"></div>
          <div><label>Docs URL</label><input name="documentation_url" value="${esc(p.documentation_url||'')}"></div>
          <div><label>Circuit Diagram</label><input name="circuit_diagram_url" value="${esc(p.circuit_diagram_url||'')}"></div>
          <div><label>Demo Video</label><input name="demo_video_url" value="${esc(p.demo_video_url||'')}"></div>
          <div><label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="${p.progress}"></div>
          <div><label>Mentor ID</label><input name="mentor_id" type="number" value="${p.mentor_id||''}"></div>
        </div>
        <h3 style="color:${P};margin-top:16px">Components</h3>
        <div id="components-section">
          ${comps.map(c => `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 80px;gap:8px;margin-bottom:8px">
            <input name="comp_name[]" value="${esc(c.name)}"><input name="comp_qty[]" type="number" value="${c.quantity}">
            <select name="comp_type[]">${['sensor','actuator','microcontroller','communication','power','passive','other'].map(t =>
              `<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('')}</select>
            <button type="button" class="btn" style="background:#dc2626;font-size:12px" onclick="this.parentElement.remove()">✕</button>
          </div>`).join('')}
        </div>
        <h3 style="color:${P};margin-top:16px">Safety Checklist</h3>
        <textarea name="safety_checklist" rows="3">${esc(JSON.stringify(safety))}</textarea>
        <button class="btn" type="submit" style="margin-top:16px">Save Changes</button>
        <a href="/school/iot-workshop/projects/${p.id}/view" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  }));

  app.post('/school/iot-workshop/projects/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { title, description, category, difficulty, status, code_repository, documentation_url,
            circuit_diagram_url, demo_video_url, progress, mentor_id, safety_checklist } = req.body;
    const compNames = Array.isArray(req.body['comp_name[]']) ? req.body['comp_name[]'] : [req.body['comp_name[]']];
    const compQty = Array.isArray(req.body['comp_qty[]']) ? req.body['comp_qty[]'] : [req.body['comp_qty[]']];
    const compType = Array.isArray(req.body['comp_type[]']) ? req.body['comp_type[]'] : [req.body['comp_type[]']];
    const componentsList = [];
    if (compNames[0]) {
      compNames.forEach((name, i) => { if (name && name.trim()) componentsList.push({ name: name.trim(), quantity: parseInt(compQty[i]) || 1, type: compType[i] || 'other' }); });
    }
    let safetyItems = []; try { safetyItems = JSON.parse(safety_checklist || '[]'); } catch(e) {}
    await pool.query(
      `UPDATE iot_projects SET title=$1, description=$2, category=$3, difficulty=$4, status=$5, code_repository=$6,
       documentation_url=$7, circuit_diagram_url=$8, demo_video_url=$9, progress=$10, mentor_id=$11,
       components=$12, safety_checklist=$13, updated_at=NOW() WHERE id=$14 AND tenant_id=$15`,
      [title, description, category, difficulty, status, code_repository, documentation_url,
       circuit_diagram_url, demo_video_url, progress || 0, mentor_id || null, JSON.stringify(componentsList), JSON.stringify(safetyItems), req.params.id, req.user.tenant_id]);
    await audit(req, 'iot_project_updated', { id: req.params.id });
    res.redirect(`/school/iot-workshop/projects/${req.params.id}/view`);
  }));

  /* ─── Delete Project ─── */
  app.get('/school/iot-workshop/projects/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM iot_projects WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    await audit(req, 'iot_project_deleted', { id: req.params.id });
    res.redirect('/school/iot-workshop/projects');
  }));

  /* ─── Component Inventory ─── */
  app.get('/school/iot-workshop/components', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const filter = req.query.filter || '';
    let where = 'WHERE tenant_id=$1', params = [tid];
    if (filter === 'low_stock') { where += ' AND quantity <= min_stock_level'; }
    else if (filter === 'depleted') { where += ' AND quantity = 0'; }
    const [rows] = await pool.query(
      `SELECT * FROM iot_components WHERE tenant_id=$1 ${filter === 'low_stock' ? 'AND quantity <= min_stock_level' : filter === 'depleted' ? 'AND quantity = 0' : ''} ORDER BY type, name`, [tid]);
    const [types] = await pool.query('SELECT type, COUNT(*) AS c, SUM(quantity) AS total FROM iot_components WHERE tenant_id=$1 GROUP BY type ORDER BY c DESC', [tid]);
    const [totalValue] = await pool.query('SELECT SUM(quantity * unit_cost)::numeric(12,2) AS val FROM iot_components WHERE tenant_id=$1', [tid]);
    res.send(renderPage(req, 'Component Inventory', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Component Inventory <small style="color:${GRAY}">(Value: $${totalValue.val || '0.00'})</small></h2>
          <a class="btn" href="/school/iot-workshop/components/new">+ Add Component</a>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
          <a href="/school/iot-workshop/components" class="btn" style="background:${GRAY};font-size:12px;padding:4px 10px">All</a>
          <a href="/school/iot-workshop/components?filter=low_stock" class="btn" style="background:${filter==='low_stock'?'#dc2626':GRAY};font-size:12px;padding:4px 10px">Low Stock</a>
          <a href="/school/iot-workshop/components?filter=depleted" class="btn" style="background:${filter==='depleted'?'#dc2626':GRAY};font-size:12px;padding:4px 10px">Depleted</a>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          ${types.map(t => `<span class="badge badge-blue">${esc(t.type)}: ${t.c} (${t.total} units)</span>`).join('')}
        </div>
        <table><tr><th>Name</th><th>Type</th><th>In Stock</th><th>Min Level</th><th>Unit Cost</th><th>Location</th><th>Status</th><th>Actions</th></tr>
        ${rows.map(c => `<tr>
          <td><strong>${esc(c.name)}</strong>${c.datasheet_url ? `<br><small><a href="${esc(c.datasheet_url)}" target="_blank" style="color:${P}">Datasheet</a></small>` : ''}</td>
          <td><span class="badge badge-purple">${esc(c.type)}</span></td>
          <td style="font-weight:600;color:${c.quantity<=c.min_stock_level?'#dc2626':'#059669'}">${c.quantity}</td>
          <td>${c.min_stock_level}</td>
          <td>$${c.unit_cost}</td>
          <td>${esc(c.location||'-')}${c.bin_number ? ` / ${esc(c.bin_number)}` : ''}</td>
          <td>${c.quantity===0 ? '<span class="badge badge-red">Out of Stock</span>' :
               c.quantity<=c.min_stock_level ? '<span class="badge badge-yellow">Low</span>' :
               '<span class="badge badge-green">Available</span>'}</td>
          <td><a href="/school/iot-workshop/components/${c.id}/edit" style="color:${P}">Edit</a> |
              <a href="/school/iot-workshop/components/${c.id}/restock" style="color:#059669">Restock</a></td>
        </tr>`).join('')}
      </table></div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── Add Component ─── */
  app.get('/school/iot-workshop/components/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'Add Component', SKIP + `
      <div class="card"><h2 style="color:${P}">Add Component to Inventory</h2>
      <form method="POST" action="/school/iot-workshop/components/new">
        <div class="grid-2">
          <div><label>Component Name</label><input name="name" required placeholder="e.g. ESP32 DevKit"></div>
          <div><label>Type</label><select name="type">
            <option value="sensor">Sensor</option><option value="actuator">Actuator</option>
            <option value="microcontroller">Microcontroller</option><option value="communication">Communication Module</option>
            <option value="power">Power Supply</option><option value="passive">Passive (R/C/L)</option>
            <option value="display">Display</option><option value="connector">Connector</option>
            <option value="pcb">PCB/Board</option><option value="tools">Tools</option>
            <option value="other">Other</option></select></div>
          <div><label>Category</label><input name="category" placeholder="e.g. Temperature, Motor"></div>
          <div><label>Quantity</label><input name="quantity" type="number" value="1" min="0"></div>
          <div><label>Unit Cost ($)</label><input name="unit_cost" type="number" step="0.01" value="0"></div>
          <div><label>Min Stock Level</label><input name="min_stock_level" type="number" value="5"></div>
          <div><label>Location</label><input name="location" placeholder="e.g. Shelf A, Lab 2"></div>
          <div><label>Bin Number</label><input name="bin_number" placeholder="e.g. A-12"></div>
          <div><label>Datasheet URL</label><input name="datasheet_url" placeholder="https://..."></div>
          <div><label>Image URL</label><input name="image_url" placeholder="https://..."></div>
          <div style="grid-column:span 2"><label>Specifications (JSON)</label>
            <textarea name="specifications" rows="3" placeholder='{"voltage":"3.3V","pins":38}'></textarea></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Add Component</button>
        <a href="/school/iot-workshop/components" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  });

  app.post('/school/iot-workshop/components/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, type, category, quantity, unit_cost, location, bin_number, datasheet_url,
            image_url, min_stock_level, specifications } = req.body;
    let specs = {}; try { specs = JSON.parse(specifications || '{}'); } catch(e) {}
    await pool.query(
      `INSERT INTO iot_components (tenant_id, name, type, category, quantity, unit_cost, location,
       bin_number, datasheet_url, image_url, min_stock_level, specifications)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, name, type, category, quantity||0, unit_cost||0, location, bin_number,
       datasheet_url, image_url, min_stock_level||5, specs]);
    await audit(req, 'iot_component_added', { name, type });
    res.redirect('/school/iot-workshop/components');
  }));

  /* ─── Edit Component ─── */
  app.get('/school/iot-workshop/components/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM iot_components WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const c = rows[0];
    const specStr = typeof c.specifications === 'string' ? c.specifications : JSON.stringify(c.specifications || {});
    const typeOpts = ['sensor','actuator','microcontroller','communication','power','passive','display','connector','pcb','tools','other'];
    res.send(renderPage(req, 'Edit Component', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(c.name)}</h2>
      <form method="POST" action="/school/iot-workshop/components/${c.id}/edit">
        <div class="grid-2">
          <div><label>Name</label><input name="name" value="${esc(c.name)}" required></div>
          <div><label>Type</label><select name="type">${typeOpts.map(t => `<option value="${t}" ${c.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
          <div><label>Category</label><input name="category" value="${esc(c.category||'')}"></div>
          <div><label>Quantity</label><input name="quantity" type="number" value="${c.quantity}"></div>
          <div><label>Unit Cost ($)</label><input name="unit_cost" type="number" step="0.01" value="${c.unit_cost}"></div>
          <div><label>Min Stock</label><input name="min_stock_level" type="number" value="${c.min_stock_level}"></div>
          <div><label>Location</label><input name="location" value="${esc(c.location||'')}"></div>
          <div><label>Bin Number</label><input name="bin_number" value="${esc(c.bin_number||'')}"></div>
          <div><label>Datasheet URL</label><input name="datasheet_url" value="${esc(c.datasheet_url||'')}"></div>
          <div><label>Image URL</label><input name="image_url" value="${esc(c.image_url||'')}"></div>
          <div style="grid-column:span 2"><label>Specifications</label><textarea name="specifications" rows="3">${esc(specStr)}</textarea></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Save</button>
        <a href="/school/iot-workshop/components" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  }));

  app.post('/school/iot-workshop/components/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { name, type, category, quantity, unit_cost, location, bin_number, datasheet_url,
            image_url, min_stock_level, specifications } = req.body;
    let specs = {}; try { specs = JSON.parse(specifications || '{}'); } catch(e) {}
    await pool.query(
      `UPDATE iot_components SET name=$1, type=$2, category=$3, quantity=$4, unit_cost=$5, location=$6,
       bin_number=$7, datasheet_url=$8, image_url=$9, min_stock_level=$10, specifications=$11, updated_at=NOW()
       WHERE id=$12 AND tenant_id=$13`,
      [name, type, category, quantity||0, unit_cost||0, location, bin_number,
       datasheet_url, image_url, min_stock_level||5, specs, req.params.id, req.user.tenant_id]);
    res.redirect('/school/iot-workshop/components');
  }));

  /* ─── Restock Component ─── */
  app.get('/school/iot-workshop/components/:id/restock', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM iot_components WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const c = rows[0];
    res.send(renderPage(req, 'Restock Component', SKIP + `
      <div class="card" style="max-width:500px">
        <h2 style="color:${P}">Restock: ${esc(c.name)}</h2>
        <p>Current stock: <strong>${c.quantity}</strong> | Min level: ${c.min_stock_level}</p>
        <form method="POST" action="/school/iot-workshop/components/${c.id}/restock">
          <div style="margin:16px 0"><label>Quantity to Add</label><input name="qty" type="number" min="1" value="${c.min_stock_level - c.quantity}" required></div>
          <button class="btn" type="submit">Restock</button>
          <a href="/school/iot-workshop/components" class="btn" style="background:${GRAY}">Cancel</a>
        </form></div>`, {activeNav: 'iot-workshop'}));
  }));

  app.post('/school/iot-workshop/components/:id/restock', requireAuth, requireNotBanned, ah(async (req, res) => {
    const qty = parseInt(req.body.qty) || 0;
    if (qty > 0) {
      await pool.query(
        'UPDATE iot_components SET quantity = quantity + $1, total_restocked = total_restocked + $1, status = CASE WHEN quantity + $1 > min_stock_level THEN \'available\' ELSE status END, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
        [qty, req.params.id, req.user.tenant_id]);
      await audit(req, 'iot_component_restocked', { id: req.params.id, qty });
    }
    res.redirect('/school/iot-workshop/components');
  }));

  /* ─── Workshops List ─── */
  app.get('/school/iot-workshop/workshops', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [rows] = await pool.query(
      `SELECT w.*, (SELECT COUNT(*) FROM iot_workshop_enrollments WHERE workshop_id=w.id) AS enrolled
       FROM iot_workshops w WHERE w.tenant_id=$1 ORDER BY w.date DESC`, [tid]);
    res.send(renderPage(req, 'IoT Workshops', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Workshop Schedule (${rows.length})</h2>
          <a class="btn" href="/school/iot-workshop/workshops/new">+ Schedule Workshop</a>
        </div>
        <table><tr><th>Title</th><th>Date</th><th>Duration</th><th>Enrolled</th><th>Instructor</th><th>Status</th><th>Actions</th></tr>
        ${rows.map(w => {
          const full = w.enrolled >= w.max_students;
          return `<tr>
            <td><strong>${esc(w.title)}</strong></td>
            <td>${w.date}${w.start_time ? ' ' + w.start_time : ''}</td>
            <td>${w.duration} min</td>
            <td><span style="color:${full?'#dc2626':'#059669'}">${w.enrolled || 0}/${w.max_students}</span></td>
            <td>${esc(w.instructor||'-')}</td>
            <td><span class="badge ${w.status==='completed'?'badge-green':w.status==='active'?'badge-blue':w.status==='cancelled'?'badge-red':'badge-yellow'}">${esc(w.status)}</span></td>
            <td><a href="/school/iot-workshop/workshops/${w.id}/edit" style="color:${P}">Edit</a> |
                <a href="/school/iot-workshop/workshops/${w.id}/delete" style="color:#dc2626" onclick="return confirm('Delete?')">Delete</a></td>
          </tr>`;
        }).join('')}
      </table></div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── New Workshop ─── */
  app.get('/school/iot-workshop/workshops/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'Schedule Workshop', SKIP + `
      <div class="card"><h2 style="color:${P}">Schedule New Workshop</h2>
      <form method="POST" action="/school/iot-workshop/workshops/new">
        <div class="grid-2">
          <div><label>Workshop Title</label><input name="title" required placeholder="e.g. Introduction to Arduino"></div>
          <div><label>Instructor</label><input name="instructor" placeholder="Name"></div>
          <div><label>Date</label><input name="date" type="date" required></div>
          <div><label>Start Time</label><input name="start_time" type="time"></div>
          <div><label>Duration (min)</label><input name="duration" type="number" value="60" min="15"></div>
          <div><label>Max Students</label><input name="max_students" type="number" value="20" min="1"></div>
          <div><label>Venue</label><input name="venue" placeholder="e.g. IoT Lab, Room 201"></div>
          <div><label>Status</label><select name="status">
            <option value="scheduled">Scheduled</option><option value="active">Active</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3" placeholder="Workshop overview and learning objectives..."></textarea></div>
          <div style="grid-column:span 2"><label>Prerequisites</label><textarea name="prerequisites" rows="2" placeholder="e.g. Basic electronics knowledge"></textarea></div>
          <div style="grid-column:span 2"><label>Topics (JSON array)</label>
            <textarea name="topics" rows="3" placeholder='["LED circuits","Button inputs","Serial communication"]'></textarea></div>
        </div>
        <button class="btn" type="submit" style="margin-top:16px">Schedule Workshop</button>
        <a href="/school/iot-workshop/workshops" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  });

  app.post('/school/iot-workshop/workshops/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, description, date, start_time, duration, max_students, instructor, venue,
            status, prerequisites, topics } = req.body;
    let topicList = []; try { topicList = JSON.parse(topics || '[]'); } catch(e) {}
    await pool.query(
      `INSERT INTO iot_workshops (tenant_id, title, description, date, start_time, duration, max_students,
       instructor, venue, status, prerequisites, topics, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tid, title, description, date, start_time, duration||60, max_students||20,
       instructor, venue, status||'scheduled', prerequisites, JSON.stringify(topicList), req.user.id]);
    await audit(req, 'iot_workshop_created', { title, date });
    res.redirect('/school/iot-workshop/workshops');
  }));

  /* ─── Edit Workshop ─── */
  app.get('/school/iot-workshop/workshops/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM iot_workshops WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const w = rows[0];
    const topicStr = Array.isArray(w.topics) ? JSON.stringify(w.topics) : (typeof w.topics === 'string' ? w.topics : '[]');
    res.send(renderPage(req, 'Edit Workshop', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(w.title)}</h2>
      <form method="POST" action="/school/iot-workshop/workshops/${w.id}/edit">
        <div class="grid-2">
          <div><label>Title</label><input name="title" value="${esc(w.title)}" required></div>
          <div><label>Instructor</label><input name="instructor" value="${esc(w.instructor||'')}"></div>
          <div><label>Date</label><input name="date" type="date" value="${w.date}"></div>
          <div><label>Start Time</label><input name="start_time" type="time" value="${w.start_time||''}"></div>
          <div><label>Duration</label><input name="duration" type="number" value="${w.duration}"></div>
          <div><label>Max Students</label><input name="max_students" type="number" value="${w.max_students}"></div>
          <div><label>Venue</label><input name="venue" value="${esc(w.venue||'')}"></div>
          <div><label>Status</label><select name="status">
            ${['scheduled','active','completed','cancelled'].map(s => `<option value="${s}" ${w.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="3">${esc(w.description||'')}</textarea></div>
          <div style="grid-column:span 2"><label>Topics (JSON)</label><textarea name="topics" rows="3">${esc(topicStr)}</textarea></div>
        </div>
        <button class="btn" type="submit">Save</button>
        <a href="/school/iot-workshop/workshops" class="btn" style="background:${GRAY}">Cancel</a>
      </form></div>`, {activeNav: 'iot-workshop'}));
  }));

  app.post('/school/iot-workshop/workshops/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { title, description, date, start_time, duration, max_students, instructor, venue, status, topics } = req.body;
    let topicList = []; try { topicList = JSON.parse(topics || '[]'); } catch(e) {}
    await pool.query(
      `UPDATE iot_workshops SET title=$1, description=$2, date=$3, start_time=$4, duration=$5, max_students=$6,
       instructor=$7, venue=$8, status=$9, topics=$10, updated_at=NOW() WHERE id=$11 AND tenant_id=$12`,
      [title, description, date, start_time, duration, max_students, instructor, venue, status, JSON.stringify(topicList), req.params.id, req.user.tenant_id]);
    res.redirect('/school/iot-workshop/workshops');
  }));

  /* ─── Delete Workshop ─── */
  app.get('/school/iot-workshop/workshops/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM iot_workshops WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    await audit(req, 'iot_workshop_deleted', { id: req.params.id });
    res.redirect('/school/iot-workshop/workshops');
  }));

  /* ─── Safety Protocols ─── */
  app.get('/school/iot-workshop/safety', requireAuth, requireNotBanned, ah(async (req, res) => {
    const protocols = [
      { title: 'Electrical Safety', icon: '⚡', items: ['Always check voltage ratings before connecting', 'Never touch live circuits', 'Use insulated tools only', 'Disconnect power before modifying circuits'] },
      { title: 'Soldering Safety', icon: '🔥', items: ['Work in well-ventilated areas', 'Use fume extractors', 'Wear safety glasses', 'Keep soldering iron in holder when not in use'] },
      { title: 'Component Handling', icon: '🔧', items: ['Handle ICs by edges only', 'Use anti-static wristbands', 'Store components in labeled containers', 'Check polarity before connecting'] },
      { title: 'Workshop Rules', icon: '📋', items: ['No food or drinks at workstations', 'Clean up after each session', 'Report damaged equipment immediately', 'Sign in/out of workshop sessions'] },
      { title: 'First Aid', icon: '🩹', items: ['Know the location of first aid kit', 'Treat burns with cool running water', 'Report all injuries to instructor', 'Emergency contacts posted at entrance'] }
    ];
    res.send(renderPage(req, 'Safety Protocols', SKIP + `
      <div class="card">
        <h2 style="color:${P}">IoT Workshop Safety Protocols</h2>
        <div class="grid-2" style="margin-top:16px">
          ${protocols.map(p => `<div class="card" style="border-left:4px solid ${P}">
            <h3 style="color:${P}">${p.icon} ${esc(p.title)}</h3>
            <ul style="margin:8px 0">${p.items.map(i => `<li style="padding:3px 0;color:${GRAY}">☐ ${esc(i)}</li>`).join('')}</ul>
          </div>`).join('')}
        </div>
        <div class="card" style="margin-top:16px;background:#fef2f2;border:1px solid #fecaca">
          <h3 style="color:#dc2626">🚨 Emergency Procedures</h3>
          <ul>
            <li style="color:${GRAY}">Fire: Activate alarm, evacuate, call emergency services</li>
            <li style="color:${GRAY}">Electrical shock: Disconnect power, do not touch victim directly</li>
            <li style="color:${GRAY}">Chemical spill: Ventilate area, use appropriate PPE</li>
            <li style="color:${GRAY}">Report all incidents within 24 hours using the school incident form</li>
          </ul>
        </div>
      </div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── Achievement Badges ─── */
  app.get('/school/iot-workshop/badges', requireAuth, requireNotBanned, ah(async (req, res) => {
    const badgeDefs = [
      { id: 'first_blink', title: 'First Blink', desc: 'Successfully blink an LED', icon: '💡', level: 'beginner' },
      { id: 'sensor_master', title: 'Sensor Master', desc: 'Read data from 3+ sensor types', icon: '🌡️', level: 'intermediate' },
      { id: 'circuit_designer', title: 'Circuit Designer', desc: 'Design and build a custom circuit', icon: '🔌', level: 'intermediate' },
      { id: 'wifi_warrior', title: 'WiFi Warrior', desc: 'Connect project to WiFi', icon: '📶', level: 'beginner' },
      { id: 'cloud_connector', title: 'Cloud Connector', desc: 'Send data to cloud service', icon: '☁️', level: 'advanced' },
      { id: 'full_stack_iot', title: 'Full-Stack IoT', desc: 'Complete an end-to-end IoT project', icon: '🏆', level: 'advanced' },
      { id: 'team_player', title: 'Team Player', desc: 'Collaborate on a team project', icon: '🤝', level: 'beginner' },
      { id: 'mentor', title: 'Mentor', desc: 'Help another student with their project', icon: '🎓', level: 'intermediate' },
      { id: 'safety_star', title: 'Safety Star', desc: 'Complete all safety training modules', icon: '⭐', level: 'beginner' },
      { id: 'innovation', title: 'Innovation Award', desc: 'Create a novel IoT solution', icon: '🚀', level: 'advanced' }
    ];
    const tid = req.user.tenant_id;
    const [projectBadges] = await pool.query(
      `SELECT badges_earned FROM iot_projects WHERE tenant_id=$1 AND badges_earned IS NOT NULL`, [tid]);
    const allBadges = new Set();
    projectBadges.forEach(p => {
      const b = Array.isArray(p.badges_earned) ? p.badges_earned : JSON.parse(p.badges_earned || '[]');
      b.forEach(badge => allBadges.add(badge));
    });
    res.send(renderPage(req, 'Achievement Badges', SKIP + `
      <div class="card">
        <h2 style="color:${P}">IoT Achievement Badges</h2>
        <p style="color:${GRAY}">Earn badges by completing projects and workshops. Badges are awarded by mentors.</p>
        <div class="grid-3" style="margin-top:16px">
          ${badgeDefs.map(b => `<div class="card" style="text-align:center;opacity:${allBadges.has(b.id)?1:0.5};border:2px solid ${allBadges.has(b.id)?'#059669':'#e5e7eb'}">
            <div style="font-size:36px">${b.icon}</div>
            <h4>${esc(b.title)}</h4>
            <p style="color:${GRAY};font-size:13px">${esc(b.desc)}</p>
            <span class="badge badge-purple" style="margin-top:4px">${esc(b.level)}</span>
            ${allBadges.has(b.id) ? '<div style="color:#059669;font-weight:600;margin-top:8px">✓ Earned</div>' : ''}
          </div>`).join('')}
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="color:${P}">Badge Statistics</h3>
          <p style="color:${GRAY}">Badges Earned: <strong>${allBadges.size}</strong> / ${badgeDefs.length}</p>
          <div style="background:#e5e7eb;border-radius:8px;height:12px;margin-top:8px">
            <div style="background:#059669;height:12px;border-radius:8px;width:${(allBadges.size/badgeDefs.length)*100}%"></div>
          </div>
        </div>
      </div>`, {activeNav: 'iot-workshop'}));
  }));

  /* ─── API: Search Components ─── */
  app.get('/school/iot-workshop/api/components/search', requireAuth, ah(async (req, res) => {
    const q = `%${req.query.q || ''}%`;
    const [rows] = await pool.query(
      'SELECT id, name, type, category, quantity, unit_cost, location FROM iot_components WHERE tenant_id=$1 AND (name ILIKE $2 OR type ILIKE $2 OR category ILIKE $2) AND quantity > 0 ORDER BY name LIMIT 20',
      [req.user.tenant_id, q]);
    res.json(rows);
  }));
};
