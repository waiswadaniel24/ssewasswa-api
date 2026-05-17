module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.8em}.progress-bar{background:#e5e7eb;border-radius:8px;height:12px;overflow:hidden}.progress-fill{height:100%;border-radius:8px;transition:width 0.3s}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_frameworks (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255) NOT NULL,
        description TEXT, category VARCHAR(100) DEFAULT 'general',
        skills JSONB DEFAULT '[]', levels JSONB DEFAULT '[]',
        industry_alignment JSONB DEFAULT '[]', version VARCHAR(20) DEFAULT '1.0',
        is_active BOOLEAN DEFAULT true, created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_rubrics (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, framework_id INT REFERENCES skill_frameworks(id),
        skill_name VARCHAR(255) NOT NULL, criteria JSONB DEFAULT '[]',
        max_score INT DEFAULT 100, weight DECIMAL(5,2) DEFAULT 1.0,
        description TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_assessments (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        framework_id INT REFERENCES skill_frameworks(id), evaluator_id INT,
        scores JSONB DEFAULT '{}', overall_level VARCHAR(50),
        overall_score DECIMAL(5,2) DEFAULT 0, feedback TEXT,
        assessment_type VARCHAR(50) DEFAULT 'formative',
        status VARCHAR(20) DEFAULT 'draft', date DATE DEFAULT CURRENT_DATE,
        recommendations JSONB DEFAULT '[]', cert_recommendation TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_profiles (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        skills JSONB DEFAULT '{}', certifications JSONB DEFAULT '[]',
        strengths JSONB DEFAULT '[]', weaknesses JSONB DEFAULT '[]',
        goals JSONB DEFAULT '[]', overall_level VARCHAR(50) DEFAULT 'beginner',
        competency_score DECIMAL(5,2) DEFAULT 0,
        industry_readiness DECIMAL(5,2) DEFAULT 0,
        last_assessment_id INT, last_updated TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_class_mapping (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, class_id INT NOT NULL,
        framework_id INT REFERENCES skill_frameworks(id),
        required_level VARCHAR(50) DEFAULT 'intermediate',
        student_scores JSONB DEFAULT '{}', coverage DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS skill_certifications (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        framework_id INT REFERENCES skill_frameworks(id),
        cert_name VARCHAR(255), level_achieved VARCHAR(50),
        score DECIMAL(5,2), issued_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ, cert_code VARCHAR(100) UNIQUE,
        status VARCHAR(20) DEFAULT 'active'
      )`);
      console.log('[Mod] skill-assessment OK');
    } catch(e) { console.warn('[Mod] skill-assessment Warn:', e.message); }
  })();

  const LEVELS = ['beginner','elementary','intermediate','advanced','expert','master'];
  const LEVEL_COLORS = { beginner:'#94a3b8', elementary:'#10b981', intermediate:'#3b82f6', advanced:'#f59e0b', expert:'#ef4444', master:'#8b5cf6' };
  const ASSESSMENT_TYPES = ['formative','summative','diagnostic','placement','certification'];

  /* ════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const [frameworks, assessments, profiles, certs] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM skill_assessments WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM skill_profiles WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM skill_certifications WHERE tenant_id=$1 AND status=$2', [tid, 'active'])
      ]);
      const myProfile = await pool.query('SELECT * FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [tid, req.user_id]);
      const myAssessments = await pool.query('SELECT COUNT(*) AS cnt FROM skill_assessments WHERE tenant_id=$1 AND student_id=$2', [tid, req.user_id]);
      const classMapping = await pool.query('SELECT COUNT(*) AS cnt FROM skill_class_mapping WHERE tenant_id=$1', [tid]);
      const rows = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${frameworks.rows[0].cnt}</div><div style="color:${GRAY}">Frameworks</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${assessments.rows[0].cnt}</div><div style="color:${GRAY}">Assessments</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#10b981">${profiles.rows[0].cnt}</div><div style="color:${GRAY}">Profiles</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#f59e0b">${certs.rows[0].cnt}</div><div style="color:${GRAY}">Certifications</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#ec4899">${myAssessments.rows[0].cnt}</div><div style="color:${GRAY}">My Assessments</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#8b5cf6">${classMapping.rows[0].cnt}</div><div style="color:${GRAY}">Class Mappings</div></div>
        </div>
        ${myProfile.rows[0]?`
        <div class="card"><h3 style="margin-top:0">My Skill Profile</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:${LEVEL_COLORS[myProfile.rows[0].overall_level]||P}">${esc(myProfile.rows[0].overall_level||'beginner').charAt(0).toUpperCase()+esc(myProfile.rows[0].overall_level||'beginner').slice(1)}</div><div style="color:${GRAY}">Overall Level</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:${P}">${myProfile.rows[0].competency_score||0}%</div><div style="color:${GRAY}">Competency Score</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#10b981">${myProfile.rows[0].industry_readiness||0}%</div><div style="color:${GRAY}">Industry Readiness</div></div>
          </div>
          ${(myProfile.rows[0].strengths||[]).length?`<div style="margin-top:12px"><strong>Strengths:</strong> ${(myProfile.rows[0].strengths||[]).map(s=>`<span class="badge" style="background:#d1fae5;color:#065f46;margin:2px">${esc(s)}</span>`).join('')}</div>`:''}
          ${(myProfile.rows[0].weaknesses||[]).length?`<div style="margin-top:8px"><strong>Areas for Improvement:</strong> ${(myProfile.rows[0].weaknesses||[]).map(w=>`<span class="badge" style="background:#fee2e2;color:#991b1b;margin:2px">${esc(w)}</span>`).join('')}</div>`:''}
        </div>`:'<div class="card" style="text-align:center;padding:30px"><p style="color:${GRAY};font-size:1.1em">You do not have a skill profile yet.</p><a class="btn" href="/school/skill-assessment/profile" style="margin-top:12px;display:inline-block">Create Profile</a></div>'}
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <a class="btn" href="/school/skill-assessment/frameworks" style="text-decoration:none">Frameworks</a>
          <a class="btn" href="/school/skill-assessment/assessments" style="background:#10b981;text-decoration:none">Assessments</a>
          <a class="btn" href="/school/skill-assessment/profile" style="background:#8b5cf6;text-decoration:none">My Profile</a>
          <a class="btn" href="/school/skill-assessment/rubrics" style="background:#f59e0b;text-decoration:none">Rubrics</a>
          <a class="btn" href="/school/skill-assessment/class-mapping" style="background:#ec4899;text-decoration:none">Class Mapping</a>
          <a class="btn" href="/school/skill-assessment/certifications" style="background:#06b6d4;text-decoration:none">Certifications</a>
          <a class="btn" href="/school/skill-assessment/analytics" style="background:#64748b;text-decoration:none">Analytics</a>
          <a class="btn" href="/school/skill-assessment/gap-analysis" style="background:#dc2626;text-decoration:none">Gap Analysis</a>
          <a class="btn" href="/school/skill-assessment/industry-alignment" style="background:#7c3aed;text-decoration:none">Industry Alignment</a>
          <a class="btn" href="/school/skill-assessment/recommendations" style="background:#059669;text-decoration:none">Recommendations</a>
        </div>`;
      renderPage(req, res, 'Skill Assessment', rows, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 2 — Frameworks List
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/frameworks', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { category, search } = req.query;
      let sql = 'SELECT * FROM skill_frameworks WHERE tenant_id=$1';
      const params = [req.tenant_id];
      let i = 2;
      if (category) { sql += ` AND category=$${i++}`; params.push(category); }
      if (search) { sql += ` AND name ILIKE $${i++}`; params.push(`%${search}%`); }
      sql += ' ORDER BY created_at DESC';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Competency Frameworks <a class="btn" href="/school/skill-assessment/frameworks/new" style="background:#10b981;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search frameworks..." value="${esc(search||'')}" style="width:200px">
            <input name="category" placeholder="Category..." value="${esc(category||'')}" style="width:150px">
            <button class="btn" type="submit">Search</button>
          </form>
          <div style="display:grid;gap:12px">
            ${result.rows.map(f => {
              const skills = f.skills || [];
              const levels = f.levels || [];
              return `<div class="card" style="border-left:4px solid ${P}">
                <div style="display:flex;justify-content:space-between;align-items:start">
                  <div><h4 style="margin:0">${esc(f.name)} <span class="badge" style="background:#f3f4f6;color:${GRAY}">v${esc(f.version)}</span> ${f.is_active?'<span class="badge" style="background:#d1fae5;color:#065f46">Active</span>':'<span class="badge" style="background:#fee2e2;color:#991b1b">Inactive</span>'}</h4>
                  <p style="color:${GRAY};font-size:0.9em;margin:4px 0 0">${esc(f.description||'')}</p></div>
                  <div style="display:flex;gap:4px">
                    <a class="btn" href="/school/skill-assessment/frameworks/${f.id}" style="font-size:0.85em;padding:4px 10px">View</a>
                    <a class="btn" href="/school/skill-assessment/frameworks/${f.id}/edit" style="font-size:0.85em;padding:4px 10px;background:#f59e0b">Edit</a>
                  </div>
                </div>
                <div style="display:flex;gap:12px;margin-top:8px;font-size:0.85em;color:${GRAY}">
                  <span>${skills.length} skills</span><span>${levels.length} levels</span><span>Category: ${esc(f.category||'general')}</span>
                </div>
                ${(f.industry_alignment||[]).length?`<div style="margin-top:6px">Industry: ${(f.industry_alignment||[]).map(ind=>`<span class="badge" style="background:#e0e7ff;color:${P};margin:2px">${esc(ind)}</span>`).join('')}</div>`:''}
              </div>`;
            }).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';text-align:center">No frameworks found</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Frameworks', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 3 — Create Framework
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/frameworks/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Competency Framework</h3>
        <form method="post" action="/school/skill-assessment/frameworks/new">
          <div style="margin-bottom:12px"><label>Name *</label><input name="name" required placeholder="e.g. Digital Literacy Framework"></div>
          <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Framework purpose and scope..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Category</label><input name="category" placeholder="e.g. technology, soft_skills"></div>
            <div><label>Version</label><input name="version" value="1.0" placeholder="1.0"></div>
            <div><label>Active</label><select name="is_active"><option value="true">Active</option><option value="false">Draft</option></select></div>
          </div>
          <div style="margin-top:12px"><label>Skills (JSON array of objects)</label><textarea name="skills" rows="5" placeholder='[{"name":"Critical Thinking","category":"cognitive"},{"name":"Communication","category":"interpersonal"}]'></textarea></div>
          <div style="margin-top:12px"><label>Levels (JSON array)</label><textarea name="levels" rows="5" placeholder='[{"name":"beginner","min_score":0,"description":"Basic awareness"},{"name":"intermediate","min_score":50,"description":"Applied knowledge"},{"name":"expert","min_score":80,"description":"Mastery level"}]'></textarea></div>
          <div style="margin-top:12px"><label>Industry Alignment (JSON array)</label><input name="industry_alignment" placeholder='["IT","Healthcare","Finance"]'></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Create Framework</button> <a class="btn" href="/school/skill-assessment/frameworks" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Framework', html, SKIP, '/school/skill-assessment');
  });

  app.post('/school/skill-assessment/frameworks/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, category, version, is_active, skills, levels, industry_alignment } = req.body;
      let skillArr = [], levelArr = [], indArr = [];
      try { skillArr = JSON.parse(skills || '[]'); } catch(_) {}
      try { levelArr = JSON.parse(levels || '[]'); } catch(_) {}
      try { indArr = JSON.parse(industry_alignment || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO skill_frameworks (tenant_id,name,description,category,version,is_active,skills,levels,industry_alignment,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.tenant_id, name, description, category, version || '1.0', is_active !== 'false', JSON.stringify(skillArr), JSON.stringify(levelArr), JSON.stringify(indArr), req.user_id]);
      audit(req, 'framework_created', { name });
      req.flash('success', 'Framework created');
      res.redirect('/school/skill-assessment/frameworks');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 4 — View Framework
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/frameworks/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const fw = await pool.query('SELECT * FROM skill_frameworks WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!fw.rows[0]) return res.status(404).send('Framework not found');
      const f = fw.rows[0];
      const rubrics = await pool.query('SELECT * FROM skill_rubrics WHERE framework_id=$1 AND tenant_id=$2 ORDER BY skill_name', [f.id, req.tenant_id]);
      const assessments = await pool.query(`SELECT COUNT(*) AS cnt FROM skill_assessments WHERE framework_id=$1 AND tenant_id=$2`, [f.id, req.tenant_id]);
      const skills = f.skills || [];
      const levels = f.levels || [];
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(f.name)}</h3>
          <p>${esc(f.description||'')}</p>
          <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;font-size:0.85em">
            <span class="badge" style="background:#f3f4f6">${esc(f.category||'general')}</span>
            <span class="badge" style="background:#e0e7ff;color:${P}">v${esc(f.version)}</span>
            ${f.is_active?'<span class="badge" style="background:#d1fae5;color:#065f46">Active</span>':''}
            <span style="color:${GRAY}">${assessments.rows[0].cnt} assessments</span>
          </div>
        </div>
        ${skills.length?`<div class="card"><h3 style="margin-top:0">Skills (${skills.length})</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
            ${skills.map(s => `<div style="background:#f9fafb;padding:12px;border-radius:8px"><strong>${esc(s.name)}</strong><br><span style="color:${GRAY};font-size:0.85em">${esc(s.category||'')}</span></div>`).join('')}
          </div></div>`:''}
        ${levels.length?`<div class="card"><h3 style="margin-top:0">Proficiency Levels</h3>
          <table><tr><th>Level</th><th>Min Score</th><th>Description</th></tr>
          ${levels.map(l => `<tr><td><span class="badge" style="background:${LEVEL_COLORS[l.name]||'#e5e7eb'};color:#fff">${esc(l.name)}</span></td><td>${l.min_score}</td><td>${esc(l.description||'')}</td></tr>`).join('')}
          </table></div>`:''}
        ${(f.industry_alignment||[]).length?`<div class="card"><h3 style="margin-top:0">Industry Alignment</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${(f.industry_alignment||[]).map(ind=>`<span class="badge" style="background:#dbeafe;color:#1e40af;font-size:0.9em">${esc(ind)}</span>`).join('')}</div></div>`:''}
        <div class="card"><h3 style="margin-top:0">Rubrics (${rubrics.rows.length}) <a class="btn" href="/school/skill-assessment/rubrics/new?framework_id=${f.id}" style="background:#f59e0b;font-size:0.85em;padding:4px 12px;text-decoration:none">+ Add Rubric</a></h3>
          <table><tr><th>Skill</th><th>Max Score</th><th>Weight</th><th>Criteria Count</th></tr>
          ${rubrics.rows.map(r => `<tr><td>${esc(r.skill_name)}</td><td>${r.max_score}</td><td>${r.weight}</td><td>${(r.criteria||[]).length}</td></tr>`).join('')}
          ${rubrics.rows.length===0?'<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No rubrics defined</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, f.name, html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/skill-assessment/frameworks/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const fw = await pool.query('SELECT * FROM skill_frameworks WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!fw.rows[0]) return res.status(404).send('Not found');
      const f = fw.rows[0];
      const html = `
        <div class="card"><h3 style="margin-top:0">Edit: ${esc(f.name)}</h3>
          <form method="post" action="/school/skill-assessment/frameworks/${f.id}/edit">
            <div style="margin-bottom:12px"><label>Name *</label><input name="name" value="${esc(f.name)}" required></div>
            <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3">${esc(f.description||'')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Category</label><input name="category" value="${esc(f.category||'')}"></div>
              <div><label>Status</label><select name="is_active"><option value="true" ${f.is_active?'selected':''}>Active</option><option value="false" ${!f.is_active?'selected':''}>Inactive</option></select></div>
            </div>
            <div style="margin-top:12px"><label>Skills (JSON)</label><textarea name="skills" rows="4">${esc(JSON.stringify(f.skills||[]))}</textarea></div>
            <div style="margin-top:12px"><label>Levels (JSON)</label><textarea name="levels" rows="4">${esc(JSON.stringify(f.levels||[]))}</textarea></div>
            <div style="margin-top:12px"><label>Industry (JSON)</label><input name="industry_alignment" value="${esc(JSON.stringify(f.industry_alignment||[]))}"></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Save Changes</button> <a class="btn" href="/school/skill-assessment/frameworks/${f.id}" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'Edit Framework', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/skill-assessment/frameworks/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, description, category, is_active, skills, levels, industry_alignment } = req.body;
      let sArr = [], lArr = [], iArr = [];
      try { sArr = JSON.parse(skills || '[]'); } catch(_) {}
      try { lArr = JSON.parse(levels || '[]'); } catch(_) {}
      try { iArr = JSON.parse(industry_alignment || '[]'); } catch(_) {}
      await pool.query(`UPDATE skill_frameworks SET name=$1,description=$2,category=$3,is_active=$4,skills=$5,levels=$6,industry_alignment=$7,updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
        [name, description, category, is_active !== 'false', JSON.stringify(sArr), JSON.stringify(lArr), JSON.stringify(iArr), req.params.id, req.tenant_id]);
      audit(req, 'framework_updated', { id: req.params.id });
      req.flash('success', 'Framework updated');
      res.redirect('/school/skill-assessment/frameworks/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 5 — Assessments List & Create
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/assessments', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { framework_id, student_id, status: st, type } = req.query;
      let sql = `SELECT a.*, f.name AS framework_name, u.name AS student_name, e.name AS evaluator_name
        FROM skill_assessments a LEFT JOIN skill_frameworks f ON a.framework_id=f.id
        LEFT JOIN users u ON a.student_id=u.id LEFT JOIN users e ON a.evaluator_id=e.id
        WHERE a.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (framework_id) { sql += ` AND a.framework_id=$${i++}`; params.push(framework_id); }
      if (student_id) { sql += ` AND a.student_id=$${i++}`; params.push(student_id); }
      if (st) { sql += ` AND a.status=$${i++}`; params.push(st); }
      if (type) { sql += ` AND a.assessment_type=$${i++}`; params.push(type); }
      sql += ' ORDER BY a.date DESC LIMIT 100';
      const result = await pool.query(sql, params);
      const frameworks = await pool.query('SELECT id,name FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true ORDER BY name', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Assessments <a class="btn" href="/school/skill-assessment/assessments/new" style="background:#10b981;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="framework_id" style="width:200px"><option value="">All Frameworks</option>${frameworks.rows.map(f=>`<option value="${f.id}" ${framework_id==f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>
            <select name="type" style="width:140px"><option value="">All Types</option>${ASSESSMENT_TYPES.map(t=>`<option value="${t}" ${type===t?'selected':''}>${t}</option>`).join('')}</select>
            <select name="status" style="width:120px"><option value="">All</option><option value="draft" ${st==='draft'?'selected':''}>Draft</option><option value="completed" ${st==='completed'?'selected':''}>Completed</option><option value="published" ${st==='published'?'selected':''}>Published</option></select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <table><tr><th>Student</th><th>Framework</th><th>Type</th><th>Score</th><th>Level</th><th>Status</th><th>Date</th><th>Actions</th></tr>
          ${result.rows.map(a => `<tr>
            <td>${esc(a.student_name||'ID:'+a.student_id)}</td><td>${esc(a.framework_name||'—')}</td><td>${esc(a.assessment_type)}</td>
            <td>${a.overall_score||0}%</td><td><span class="badge" style="background:${LEVEL_COLORS[a.overall_level]||'#e5e7eb'};color:#fff">${esc(a.overall_level||'—')}</span></td>
            <td><span style="color:${a.status==='completed'?'#10b981':a.status==='published'?'#3b82f6':GRAY}">${esc(a.status)}</span></td>
            <td>${new Date(a.date).toLocaleDateString()}</td>
            <td><a class="btn" href="/school/skill-assessment/assessments/${a.id}" style="font-size:0.85em;padding:4px 10px">View</a></td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="8" style="text-align:center;color:'+GRAY+'">No assessments found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Assessments', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/skill-assessment/assessments/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const frameworks = await pool.query('SELECT id,name,skills FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true ORDER BY name', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Create Assessment</h3>
          <form method="post" action="/school/skill-assessment/assessments/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Student ID *</label><input name="student_id" type="number" required placeholder="Student user ID"></div>
              <div><label>Framework *</label><select name="framework_id" required id="fw-select"><option value="">Select...</option>${frameworks.rows.map(f=>`<option value="${f.id}" data-skills='${esc(JSON.stringify(f.skills||[]))}'>${esc(f.name)}</option>`).join('')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Assessment Type</label><select name="assessment_type">${ASSESSMENT_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
              <div><label>Date</label><input name="date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
            </div>
            <div id="skills-container" style="margin-top:16px;display:none">
              <h4 style="margin-bottom:12px">Skill Scores</h4>
              <div id="skills-list"></div>
            </div>
            <div style="margin-top:12px"><label>Feedback</label><textarea name="feedback" rows="3" placeholder="Overall assessment feedback..."></textarea></div>
            <div style="margin-top:12px"><label>Recommendations (JSON array)</label><textarea name="recommendations" rows="2" placeholder='["Take advanced course X","Practice skill Y"]'></textarea></div>
            <div style="margin-top:16px"><button class="btn" type="submit" style="background:#10b981">Save Assessment</button> <a class="btn" href="/school/skill-assessment/assessments" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>
        <script>
        document.getElementById('fw-select').addEventListener('change', function() {
          var opt = this.options[this.selectedIndex];
          var skills = JSON.parse(opt.getAttribute('data-skills') || '[]');
          var container = document.getElementById('skills-container');
          var list = document.getElementById('skills-list');
          if (skills.length === 0) { container.style.display = 'none'; return; }
          container.style.display = 'block';
          list.innerHTML = skills.map(function(s, i) {
            return '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-bottom:8px"><label style="display:flex;align-items:center">'+s.name+'<span style="color:#6b7280;font-size:0.85em;margin-left:8px">'+(s.category||'')+'</span></label><input name="skill_score_'+i+'" type="number" min="0" max="100" placeholder="0-100" style="width:120px" data-skill="'+s.name+'"></div>';
          }).join('');
        });
        </script>`;
      renderPage(req, res, 'New Assessment', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/skill-assessment/assessments/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { student_id, framework_id, assessment_type, date, feedback, recommendations } = req.body;
      let recs = [];
      try { recs = JSON.parse(recommendations || '[]'); } catch(_) {}
      /* Collect skill scores from dynamic fields */
      const scores = {};
      let totalScore = 0, skillCount = 0;
      Object.keys(req.body).forEach(key => {
        if (key.startsWith('skill_score_')) {
          const score = parseInt(req.body[key]) || 0;
          scores[req.body[key + '_name'] || key] = score;
          totalScore += score;
          skillCount++;
        }
      });
      const overallScore = skillCount > 0 ? Math.round(totalScore / skillCount) : 0;
      let overallLevel = 'beginner';
      if (overallScore >= 90) overallLevel = 'master';
      else if (overallScore >= 75) overallLevel = 'expert';
      else if (overallScore >= 60) overallLevel = 'advanced';
      else if (overallScore >= 40) overallLevel = 'intermediate';
      else if (overallScore >= 20) overallLevel = 'elementary';
      /* Determine certification recommendation */
      let certRec = '';
      if (overallScore >= 80) certRec = 'Eligible for Advanced Certification';
      else if (overallScore >= 60) certRec = 'Eligible for Intermediate Certification';
      else if (overallScore >= 40) certRec = 'Foundational level achieved';
      await pool.query(`INSERT INTO skill_assessments (tenant_id,student_id,framework_id,evaluator_id,assessment_type,scores,overall_score,overall_level,feedback,recommendations,cert_recommendation,status,date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'completed',$12)`,
        [req.tenant_id, parseInt(student_id), parseInt(framework_id), req.user_id, assessment_type || 'formative',
        JSON.stringify(scores), overallScore, overallLevel, feedback, JSON.stringify(recs), certRec, date || new Date().toISOString().split('T')[0]]);
      /* Update student profile */
      await pool.query(`INSERT INTO skill_profiles (tenant_id,student_id,skills,overall_level,competency_score,last_updated)
        VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,student_id)
        SET skills=skill_profiles.skills||$3, overall_level=$4, competency_score=$5, last_updated=NOW()`,
        [req.tenant_id, parseInt(student_id), JSON.stringify(scores), overallLevel, overallScore]);
      audit(req, 'assessment_created', { student_id, framework_id, overall_score: overallScore });
      queueEmail(parseInt(student_id), 'skill_assessment_completed', { score: overallScore, level: overallLevel });
      req.flash('success', `Assessment saved. Score: ${overallScore}%, Level: ${overallLevel}`);
      res.redirect('/school/skill-assessment/assessments');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 6 — View Assessment
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/assessments/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const a = await pool.query(`SELECT a.*, f.name AS framework_name, u.name AS student_name, e.name AS evaluator_name
        FROM skill_assessments a LEFT JOIN skill_frameworks f ON a.framework_id=f.id
        LEFT JOIN users u ON a.student_id=u.id LEFT JOIN users e ON a.evaluator_id=e.id
        WHERE a.id=$1 AND a.tenant_id=$2`, [req.params.id, req.tenant_id]);
      if (!a.rows[0]) return res.status(404).send('Assessment not found');
      const asmt = a.rows[0];
      const scores = asmt.scores || {};
      const skillEntries = Object.entries(scores);
      const html = `
        <div class="card"><h3 style="margin-top:0">Assessment: ${esc(asmt.student_name||'Student #' + asmt.student_id)}</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-top:12px">
            <div style="text-align:center"><div style="font-size:1.5em;color:${P}">${asmt.overall_score||0}%</div><div style="color:${GRAY}">Overall Score</div></div>
            <div style="text-align:center"><div style="font-size:1.5em"><span class="badge" style="background:${LEVEL_COLORS[asmt.overall_level]||'#e5e7eb'};color:#fff;font-size:1em;padding:4px 12px">${esc(asmt.overall_level||'—')}</span></div><div style="color:${GRAY}">Level</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;color:#10b981">${esc(asmt.framework_name||'—')}</div><div style="color:${GRAY}">Framework</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;color:#f59e0b">${esc(asmt.assessment_type)}</div><div style="color:${GRAY}">Type</div></div>
          </div>
        </div>
        <div class="card"><h3 style="margin-top:0">Skill Scores</h3>
          ${skillEntries.length ? skillEntries.map(([skill, score]) => {
            const color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
            return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500">${esc(skill)}</span><span style="color:${color}">${score}/100</span></div><div class="progress-bar"><div class="progress-fill" style="width:${score}%;background:${color}"></div></div></div>`;
          }).join('') : '<p style="color:'+GRAY+'">No skill scores recorded</p>'}
        </div>
        ${asmt.feedback?`<div class="card"><h3 style="margin-top:0">Feedback</h3><p>${esc(asmt.feedback)}</p></div>`:''}
        ${(asmt.recommendations||[]).length?`<div class="card"><h3 style="margin-top:0">Recommendations</h3><ul>${(asmt.recommendations||[]).map(r=>`<li style="margin-bottom:4px">${esc(r)}</li>`).join('')}</ul></div>`:''}
        ${asmt.cert_recommendation?`<div class="card" style="background:#f0fdf4;border:1px solid #10b981"><strong>Certification: </strong>${esc(asmt.cert_recommendation)}</div>`:''}
        <div class="card"><h3 style="margin-top:0">Details</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.9em;color:${GRAY}">
            <span>Evaluator: ${esc(asmt.evaluator_name||'—')}</span><span>Date: ${new Date(asmt.date).toLocaleDateString()}</span>
            <span>Status: ${esc(asmt.status)}</span><span>Created: ${new Date(asmt.created_at).toLocaleString()}</span>
          </div>
        </div>`;
      renderPage(req, res, 'Assessment Detail', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 7 — Student Skill Profile
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/profile', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const targetStudentId = req.query.student_id || req.user_id;
      const profile = await pool.query('SELECT * FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, targetStudentId]);
      const assessments = await pool.query(`SELECT a.*, f.name AS framework_name FROM skill_assessments a
        LEFT JOIN skill_frameworks f ON a.framework_id=f.id WHERE a.tenant_id=$1 AND a.student_id=$2 AND a.status='completed' ORDER BY a.date DESC`, [req.tenant_id, targetStudentId]);
      const certs = await pool.query('SELECT * FROM skill_certifications WHERE tenant_id=$1 AND student_id=$2 ORDER BY issued_at DESC', [req.tenant_id, targetStudentId]);
      const p = profile.rows[0];
      const skills = p ? (p.skills || {}) : {};
      const skillEntries = Object.entries(skills);
      const html = `
        <div class="card"><h3 style="margin-top:0">Skill Profile ${targetStudentId != req.user_id ? `(Student #${targetStudentId})` : '(My Profile)'}</h3>
          ${!p ? '<p style="color:'+GRAY+'">No profile data yet. Complete an assessment to generate your profile.</p>' : `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-top:16px">
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:${LEVEL_COLORS[p.overall_level]||P}">${esc((p.overall_level||'beginner').charAt(0).toUpperCase()+(p.overall_level||'beginner').slice(1))}</div><div style="color:${GRAY}">Level</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:${P}">${p.competency_score||0}%</div><div style="color:${GRAY}">Competency</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#10b981">${p.industry_readiness||0}%</div><div style="color:${GRAY}">Industry Ready</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#f59e0b">${assessments.rows.length}</div><div style="color:${GRAY}">Assessments</div></div>
          </div>
          ${(p.strengths||[]).length?`<div style="margin-top:16px"><strong style="color:#065f46">Strengths:</strong><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${(p.strengths||[]).map(s=>`<span class="badge" style="background:#d1fae5;color:#065f46">${esc(s)}</span>`).join('')}</div></div>`:''}
          ${(p.weaknesses||[]).length?`<div style="margin-top:8px"><strong style="color:#991b1b">Areas for Improvement:</strong><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${(p.weaknesses||[]).map(w=>`<span class="badge" style="background:#fee2e2;color:#991b1b">${esc(w)}</span>`).join('')}</div></div>`:''}
          ${(p.goals||[]).length?`<div style="margin-top:8px"><strong style="color:${P}">Goals:</strong><div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${(p.goals||[]).map(g=>`<span class="badge" style="background:#e0e7ff;color:${P}">${esc(g)}</span>`).join('')}</div></div>`:''}`}
        </div>
        ${skillEntries.length?`<div class="card"><h3 style="margin-top:0">Skill Scores</h3>
          ${skillEntries.map(([skill, score]) => {
            const sc = typeof score === 'number' ? score : parseInt(score) || 0;
            const color = sc >= 80 ? '#10b981' : sc >= 60 ? '#3b82f6' : sc >= 40 ? '#f59e0b' : '#ef4444';
            return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span>${esc(skill)}</span><span style="color:${color};font-weight:bold">${sc}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(sc,100)}%;background:${color}"></div></div></div>`;
          }).join('')}
        </div>`:''}
        ${certs.rows.length?`<div class="card"><h3 style="margin-top:0">Certifications (${certs.rows.length})</h3>
          <table><tr><th>Name</th><th>Level</th><th>Score</th><th>Issued</th><th>Status</th></tr>
          ${certs.rows.map(c=>`<tr><td>${esc(c.cert_name||'—')}</td><td>${esc(c.level_achieved||'—')}</td><td>${c.score||'—'}</td><td>${new Date(c.issued_at).toLocaleDateString()}</td><td>${esc(c.status)}</td></tr>`).join('')}
          </table></div>`:''}
        <div class="card"><h3 style="margin-top:0">Assessment History (${assessments.rows.length})</h3>
          <table><tr><th>Framework</th><th>Type</th><th>Score</th><th>Level</th><th>Date</th></tr>
          ${assessments.rows.map(a=>`<tr><td>${esc(a.framework_name||'—')}</td><td>${esc(a.assessment_type)}</td><td>${a.overall_score||0}%</td><td><span class="badge" style="background:${LEVEL_COLORS[a.overall_level]||'#e5e7eb'};color:#fff">${esc(a.overall_level||'—')}</span></td><td>${new Date(a.date).toLocaleDateString()}</td></tr>`).join('')}
          ${assessments.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No assessments completed</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Skill Profile', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 8 — Rubrics Management
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/rubrics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const rubrics = await pool.query(`SELECT r.*, f.name AS framework_name FROM skill_rubrics r
        LEFT JOIN skill_frameworks f ON r.framework_id=f.id WHERE r.tenant_id=$1 ORDER BY f.name, r.skill_name`, [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Rubrics <a class="btn" href="/school/skill-assessment/rubrics/new" style="background:#f59e0b;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <table><tr><th>Framework</th><th>Skill</th><th>Max Score</th><th>Weight</th><th>Criteria</th><th>Actions</th></tr>
          ${rubrics.rows.map(r => `<tr><td>${esc(r.framework_name||'—')}</td><td>${esc(r.skill_name)}</td><td>${r.max_score}</td><td>${r.weight}x</td><td>${(r.criteria||[]).length} items</td>
            <td><a class="btn" href="/school/skill-assessment/rubrics/${r.id}/edit" style="font-size:0.85em;padding:4px 10px;background:#f59e0b">Edit</a></td></tr>`).join('')}
          ${rubrics.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No rubrics defined</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Rubrics', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/skill-assessment/rubrics/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const frameworks = await pool.query('SELECT id,name FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true ORDER BY name', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Create Rubric</h3>
          <form method="post" action="/school/skill-assessment/rubrics/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Framework *</label><select name="framework_id" required><option value="">Select...</option>${frameworks.rows.map(f=>`<option value="${f.id}" ${req.query.framework_id==f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></div>
              <div><label>Skill Name *</label><input name="skill_name" required placeholder="e.g. Problem Solving"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Max Score</label><input name="max_score" type="number" value="100" min="1"></div>
              <div><label>Weight</label><input name="weight" type="number" step="0.1" value="1.0" min="0.1"></div>
            </div>
            <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="2" placeholder="Rubric description..."></textarea></div>
            <div style="margin-top:12px"><label>Criteria (JSON array)</label><textarea name="criteria" rows="5" placeholder='[{"level":"beginner","description":"Can identify basic problems","score_range":[0,30]},{"level":"advanced","description":"Can solve complex multi-step problems","score_range":[70,100]}]'></textarea></div>
            <div style="margin-top:16px"><button class="btn" type="submit" style="background:#f59e0b">Create Rubric</button> <a class="btn" href="/school/skill-assessment/rubrics" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'New Rubric', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/skill-assessment/rubrics/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { framework_id, skill_name, max_score, weight, description, criteria } = req.body;
      let critArr = [];
      try { critArr = JSON.parse(criteria || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO skill_rubrics (tenant_id,framework_id,skill_name,max_score,weight,description,criteria)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.tenant_id, parseInt(framework_id), skill_name, parseInt(max_score)||100, parseFloat(weight)||1, description, JSON.stringify(critArr)]);
      audit(req, 'rubric_created', { skill_name });
      req.flash('success', 'Rubric created');
      res.redirect('/school/skill-assessment/rubrics');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 9 — Class Skill Mapping
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/class-mapping', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const mappings = await pool.query(`SELECT cm.*, f.name AS framework_name FROM skill_class_mapping cm
        LEFT JOIN skill_frameworks f ON cm.framework_id=f.id WHERE cm.tenant_id=$1 ORDER BY cm.created_at DESC`, [req.tenant_id]);
      const frameworks = await pool.query('SELECT id,name FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Class Skill Mapping</h3>
          <form method="post" action="/school/skill-assessment/class-mapping" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="class_id" type="number" placeholder="Class ID" required style="width:120px">
            <select name="framework_id" required style="width:250px"><option value="">Select Framework...</option>${frameworks.rows.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
            <select name="required_level" style="width:150px">${LEVELS.map(l=>`<option value="${l}" ${l==='intermediate'?'selected':''}>${l}</option>`).join('')}</select>
            <button class="btn" type="submit" style="background:#ec4899">Map Class</button>
          </form>
          <table><tr><th>Class ID</th><th>Framework</th><th>Required Level</th><th>Coverage</th><th>Created</th></tr>
          ${mappings.rows.map(m => `<tr><td>${m.class_id}</td><td>${esc(m.framework_name||'—')}</td><td>${esc(m.required_level)}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="width:100px"><div class="progress-fill" style="width:${m.coverage||0}%;background:${P}"></div></div><span>${m.coverage||0}%</span></div></td><td>${new Date(m.created_at).toLocaleDateString()}</td></tr>`).join('')}
          ${mappings.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No class mappings</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Class Mapping', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/skill-assessment/class-mapping', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { class_id, framework_id, required_level } = req.body;
      await pool.query(`INSERT INTO skill_class_mapping (tenant_id,class_id,framework_id,required_level) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [req.tenant_id, parseInt(class_id), parseInt(framework_id), required_level]);
      audit(req, 'class_mapped', { class_id, framework_id });
      req.flash('success', 'Class mapped to framework');
      res.redirect('/school/skill-assessment/class-mapping');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 10 — Gap Analysis
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/gap-analysis', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const frameworks = await pool.query('SELECT id,name,skills FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true ORDER BY name', [req.tenant_id]);
      const selectedFw = req.query.framework_id ? frameworks.rows.find(f => f.id == req.query.framework_id) : null;
      let gaps = [];
      if (selectedFw) {
        const profile = await pool.query('SELECT skills FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
        const studentSkills = profile.rows[0]?.skills || {};
        const fwSkills = selectedFw.skills || [];
        gaps = fwSkills.map(s => {
          const current = studentSkills[s.name] !== undefined ? parseInt(studentSkills[s.name]) : null;
          const target = 70; /* Default target threshold */
          return { name: s.name, category: s.category, current, target, gap: current !== null ? Math.max(0, target - current) : target };
        }).sort((a, b) => b.gap - a.gap);
      }
      const html = `
        <div class="card"><h3 style="margin-top:0">Skill Gap Analysis</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="framework_id" style="width:250px"><option value="">Select Framework...</option>${frameworks.rows.map(f=>`<option value="${f.id}" ${req.query.framework_id==f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>
            <button class="btn" type="submit" style="background:#dc2626">Analyze Gaps</button>
          </form>
          ${selectedFw ? `
            <div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;margin-bottom:16px">
              <strong>Framework:</strong> ${esc(selectedFw.name)} | <strong>Skills analyzed:</strong> ${gaps.length} |
              <strong>With gaps:</strong> ${gaps.filter(g => g.gap > 0).length} |
              <strong>On target:</strong> ${gaps.filter(g => g.gap === 0).length}
            </div>
            <table><tr><th>Skill</th><th>Category</th><th>Current</th><th>Target</th><th>Gap</th><th>Status</th></tr>
            ${gaps.map(g => {
              const isOnTarget = g.gap === 0;
              const isMissing = g.current === null;
              return `<tr style="${isOnTarget?'background:#f0fdf4':isMissing?'background:#fef2f2':''}">
                <td>${esc(g.name)}</td><td>${esc(g.category||'')}</td>
                <td>${isMissing?'<span style="color:${GRAY}">Not assessed</span>':`<span style="color:${g.current>=g.target?'#10b981':'#ef4444'};font-weight:bold">${g.current}</span>`}</td>
                <td>${g.target}</td>
                <td><span style="color:${g.gap>30?'#ef4444':g.gap>0?'#f59e0b':'#10b981'};font-weight:bold">${isMissing?'N/A':g.gap}</span></td>
                <td>${isOnTarget?'✅ On Target':isMissing?'❓ Missing':'⚠️ Gap'}</td></tr>`;
            }).join('')}
            </table>
            ${gaps.filter(g => g.gap > 0).length ? `
            <div class="card" style="margin-top:16px"><h4>Recommended Actions</h4>
              <ul>${gaps.filter(g => g.gap > 0).slice(0, 5).map(g => `<li style="margin-bottom:4px"><strong>${esc(g.name)}</strong>: Gap of ${g.gap} points. ${g.gap > 30 ? 'Consider intensive training or tutoring.' : g.gap > 15 ? 'Practice exercises and workshops recommended.' : 'Self-study and online resources should suffice.'}</li>`).join('')}</ul>
            </div>`:''}` : '<p style="color:'+GRAY+'">Select a framework to analyze skill gaps.</p>'}
        </div>`;
      renderPage(req, res, 'Gap Analysis', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 11 — Industry Alignment
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/industry-alignment', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const frameworks = await pool.query('SELECT id,name,industry_alignment,skills FROM skill_frameworks WHERE tenant_id=$1 AND is_active=true', [req.tenant_id]);
      const industries = {};
      frameworks.rows.forEach(f => {
        (f.industry_alignment || []).forEach(ind => {
          if (!industries[ind]) industries[ind] = { frameworks: [], totalSkills: 0 };
          industries[ind].frameworks.push(f.name);
          industries[ind].totalSkills += (f.skills || []).length;
        });
      });
      const profile = await pool.query('SELECT competency_score, industry_readiness FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      const p = profile.rows[0];
      const industryList = Object.entries(industries);
      const html = `
        <div class="card"><h3 style="margin-top:0">Industry Skill Alignment</h3>
          ${p ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
            <div style="background:#eff6ff;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2em;color:${P}">${p.competency_score||0}%</div><div style="color:${GRAY}">Your Competency</div></div>
            <div style="background:#f0fdf4;padding:16px;border-radius:8px;text-align:center"><div style="font-size:2em;color:#10b981">${p.industry_readiness||0}%</div><div style="color:${GRAY}">Industry Readiness</div></div>
          </div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
            ${industryList.map(([industry, data]) => `<div class="card" style="border-top:4px solid ${P}">
              <h4>${esc(industry)}</h4>
              <p style="color:${GRAY};font-size:0.9em">${data.frameworks.length} frameworks, ${data.totalSkills} skills</p>
              <div style="margin-top:8px"><strong>Frameworks:</strong><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${data.frameworks.map(fw=>`<span class="badge" style="background:#e0e7ff;color:${P}">${esc(fw)}</span>`).join('')}</div></div>
            </div>`).join('')}
            ${industryList.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No industry alignments configured. Add them in your frameworks.</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Industry Alignment', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 12 — Certifications
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/certifications', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const isAdmin = req.user_role === 'admin';
      let certs;
      if (isAdmin) {
        certs = await pool.query(`SELECT c.*, u.name AS student_name, f.name AS framework_name FROM skill_certifications c
          JOIN users u ON c.student_id=u.id LEFT JOIN skill_frameworks f ON c.framework_id=f.id WHERE c.tenant_id=$1 ORDER BY c.issued_at DESC LIMIT 100`, [req.tenant_id]);
      } else {
        certs = await pool.query(`SELECT c.*, f.name AS framework_name FROM skill_certifications c
          LEFT JOIN skill_frameworks f ON c.framework_id=f.id WHERE c.tenant_id=$1 AND c.student_id=$2 ORDER BY c.issued_at DESC`, [req.tenant_id, req.user_id]);
      }
      const html = `
        <div class="card"><h3 style="margin-top:0">Certifications</h3>
          <table><tr><th>${isAdmin?'Student':'Framework'}</th><th>Cert Name</th><th>Level</th><th>Score</th><th>Issued</th><th>Status</th><th>Code</th></tr>
          ${certs.rows.map(c => `<tr><td>${isAdmin?esc(c.student_name):esc(c.framework_name||'—')}</td><td>${esc(c.cert_name||'—')}</td>
            <td><span class="badge" style="background:${LEVEL_COLORS[c.level_achieved]||'#e5e7eb'};color:#fff">${esc(c.level_achieved||'—')}</span></td>
            <td>${c.score||'—'}</td><td>${new Date(c.issued_at).toLocaleDateString()}</td>
            <td>${c.status==='active'?'✅ Active':'❌ Expired'}</td>
            <td style="font-family:monospace;font-size:0.8em">${esc(c.cert_code||'—')}</td></tr>`).join('')}
          ${certs.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No certifications</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Certifications', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 13 — Recommendations
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/recommendations', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const profile = await pool.query('SELECT * FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      const p = profile.rows[0];
      const skills = p ? (p.skills || {}) : {};
      const skillEntries = Object.entries(skills);
      const weaknesses = p ? (p.weaknesses || []) : [];
      /* Generate recommendations based on profile data */
      const recommendations = [];
      if (weaknesses.length > 0) {
        weaknesses.forEach(w => recommendations.push({ type: 'improvement', skill: w, action: `Enroll in ${w} improvement workshop`, priority: 'high' }));
      }
      skillEntries.filter(([_, v]) => parseInt(v) < 40).forEach(([k]) => {
        if (!recommendations.find(r => r.skill === k)) {
          recommendations.push({ type: 'foundation', skill: k, action: `Complete foundational ${k} course`, priority: 'high' });
        }
      });
      skillEntries.filter(([_, v]) => parseInt(v) >= 40 && parseInt(v) < 70).forEach(([k]) => {
        if (!recommendations.find(r => r.skill === k)) {
          recommendations.push({ type: 'practice', skill: k, action: `Practice ${k} with intermediate exercises`, priority: 'medium' });
        }
      });
      if (p && p.competency_score >= 70) {
        recommendations.push({ type: 'advancement', skill: 'Overall', action: 'Consider advanced certification track', priority: 'medium' });
      }
      recommendations.push({ type: 'general', skill: 'Soft Skills', action: 'Join a collaborative project team', priority: 'low' });
      const html = `
        <div class="card"><h3 style="margin-top:0">Personalized Recommendations</h3>
          ${!p ? '<p style="color:'+GRAY+'">Complete an assessment to receive personalized recommendations.</p>' : `
          <div style="background:#eff6ff;padding:16px;border-radius:8px;margin-bottom:16px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><strong>Current Level:</strong> <span class="badge" style="background:${LEVEL_COLORS[p.overall_level]||'#e5e7eb'};color:#fff">${esc((p.overall_level||'beginner').charAt(0).toUpperCase()+(p.overall_level||'beginner').slice(1))}</span></div>
              <div><strong>Competency:</strong> ${p.competency_score||0}%</div>
            </div>
          </div>
          <div style="display:grid;gap:12px">
            ${recommendations.map(r => {
              const priorityColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };
              return `<div style="border:1px solid #e5e7eb;border-left:4px solid ${priorityColors[r.priority]||GRAY};padding:16px;border-radius:8px">
                <div style="display:flex;justify-content:space-between;align-items:start">
                  <div><strong>${esc(r.action)}</strong><p style="color:${GRAY};font-size:0.9em;margin:4px 0 0">Skill: ${esc(r.skill)} | Type: ${esc(r.type)}</p></div>
                  <span class="badge" style="background:${priorityColors[r.priority]}20;color:${priorityColors[r.priority]}">${esc(r.priority)}</span>
                </div>
              </div>`;
            }).join('')}
          </div>`}
        </div>`;
      renderPage(req, res, 'Recommendations', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 14 — Analytics Dashboard
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [totalAssessments, avgScore, byType, byLevel, monthlyTrend] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM skill_assessments WHERE tenant_id=$1 AND status=$2', [req.tenant_id, 'completed']),
        pool.query('SELECT AVG(overall_score) AS avg_score FROM skill_assessments WHERE tenant_id=$1 AND status=$2', [req.tenant_id, 'completed']),
        pool.query(`SELECT assessment_type, COUNT(*) AS cnt, AVG(overall_score) AS avg FROM skill_assessments WHERE tenant_id=$1 AND status='completed' GROUP BY assessment_type ORDER BY cnt DESC`, [req.tenant_id]),
        pool.query(`SELECT overall_level, COUNT(*) AS cnt FROM skill_assessments WHERE tenant_id=$1 AND status='completed' GROUP BY overall_level ORDER BY cnt DESC`, [req.tenant_id]),
        pool.query(`SELECT DATE(date) AS month, COUNT(*) AS cnt, AVG(overall_score) AS avg FROM skill_assessments WHERE tenant_id=$1 AND status='completed' AND date > NOW() - INTERVAL '12 months' GROUP BY DATE(date) ORDER BY month DESC`, [req.tenant_id])
      ]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Assessment Analytics</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
            <div style="text-align:center;background:#eff6ff;padding:20px;border-radius:12px"><div style="font-size:2em;color:${P}">${totalAssessments.rows[0].cnt}</div><div style="color:${GRAY}">Total Assessments</div></div>
            <div style="text-align:center;background:#f0fdf4;padding:20px;border-radius:12px"><div style="font-size:2em;color:#10b981">${Number(avgScore.rows[0].avg_score||0).toFixed(1)}%</div><div style="color:${GRAY}">Average Score</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card"><h4>By Assessment Type</h4>
              <table><tr><th>Type</th><th>Count</th><th>Avg Score</th></tr>
              ${byType.rows.map(t=>`<tr><td>${esc(t.assessment_type)}</td><td>${t.cnt}</td><td>${Number(t.avg).toFixed(1)}%</td></tr>`).join('')}
              </table>
            </div>
            <div class="card"><h4>Level Distribution</h4>
              <table><tr><th>Level</th><th>Count</th><th>Bar</th></tr>
              ${byLevel.rows.map(l => { const maxCnt = byLevel.rows[0]?.cnt || 1; return `<tr><td><span class="badge" style="background:${LEVEL_COLORS[l.overall_level]||'#e5e7eb'};color:#fff">${esc(l.overall_level)}</span></td><td>${l.cnt}</td><td><div class="progress-bar" style="width:120px;display:inline-block;vertical-align:middle"><div class="progress-fill" style="width:${(l.cnt/maxCnt)*100}%;background:${LEVEL_COLORS[l.overall_level]||GRAY}"></div></div></td></tr>`; }).join('')}
              </table>
            </div>
          </div>
          ${monthlyTrend.rows.length?`<div class="card"><h4>Monthly Trend (12 months)</h4>
            <table><tr><th>Month</th><th>Assessments</th><th>Avg Score</th></tr>
            ${monthlyTrend.rows.slice(0,12).map(m=>`<tr><td>${new Date(m.month).toLocaleDateString('default',{month:'short',year:'numeric'})}</td><td>${m.cnt}</td><td>${Number(m.avg).toFixed(1)}%</td></tr>`).join('')}
            </table></div>`:''}
        </div>`;
      renderPage(req, res, 'Analytics', html, SKIP, '/school/skill-assessment');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 15 — API: Student profile summary
     ════════════════════════════════════════════════ */
  app.get('/school/skill-assessment/api/profile', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const profile = await pool.query('SELECT * FROM skill_profiles WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      res.json({ ok: true, profile: profile.rows[0] || null });
    } catch(e) { ah(e, req, res, true); }
  });
};
