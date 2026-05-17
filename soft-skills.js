// ============================================================
// SOFT SKILLS ASSESSMENT MODULE
// Communication, teamwork, leadership, time management,
// conflict resolution, adaptability, emotional intelligence,
// interpersonal skills, skill development plans
// ============================================================
// Tables: soft_skill_categories, soft_skill_assessments, soft_skill_plans
// Prefix: /school/soft-skills
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ──────────────────────────────────────────────
  const tid = (req) => req.tenant?.id || req.session?.tenant_id || opts.tenantId || 1;
  const pn = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? (fb || 0) : n; };
  const pj = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb || {}); } catch(e) { return fb || {}; }};
  const scoreColor = (s) => s >= 80 ? '#059669' : s >= 60 ? '#d97706' : '#dc2626';
  const scoreBar = (pct, label) => {
    const c = scoreColor(pct);
    return '<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>' + esc(label) + '</span><span style="color:' + c + ';font-weight:600">' + Math.round(pct) + '%</span></div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="background:' + c + ';height:100%;width:' + pct + '%;border-radius:6px"></div></div></div>';
  };

  // ── Nav helper ──────────────────────────────────────────
  function nav(active) {
    const links = [
      { href: '/school/soft-skills', label: 'Dashboard', key: 'dash' },
      { href: '/school/soft-skills/categories', label: 'Categories', key: 'cat' },
      { href: '/school/soft-skills/assess', label: 'Assess', key: 'assess' },
      { href: '/school/soft-skills/plans', label: 'Plans', key: 'plans' },
      { href: '/school/soft-skills/analytics', label: 'Analytics', key: 'analytics' }
    ];
    return '<nav style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px">' +
      links.map(l => '<a href="' + l.href + '" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;' + (active === l.key ? 'background:' + P + ';color:#fff' : 'color:' + GRAY + ';background:#f3f4f6') + '">' + l.label + '</a>').join('') + '</nav>';
  }

  // ── DB Migration ────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS soft_skill_categories (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        skills JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS soft_skill_assessments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL,
        category_id INTEGER REFERENCES soft_skill_categories(id),
        evaluator_id INTEGER DEFAULT 0,
        scores JSONB DEFAULT '{}',
        comments TEXT DEFAULT '',
        overall_score NUMERIC(5,2) DEFAULT 0,
        assessment_date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS soft_skill_plans (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL,
        skill_id INTEGER DEFAULT 0,
        current_level TEXT DEFAULT 'beginner',
        target_level TEXT DEFAULT 'intermediate',
        activities JSONB DEFAULT '[]',
        deadline DATE,
        progress_pct NUMERIC(5,2) DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      const idxs = [
        'idx_ssc_tenant ON soft_skill_categories(tenant_id)',
        'idx_ssa_tenant ON soft_skill_assessments(tenant_id)',
        'idx_ssa_student ON soft_skill_assessments(tenant_id, student_id)',
        'idx_ssa_cat ON soft_skill_assessments(tenant_id, category_id)',
        'idx_ssp_tenant ON soft_skill_plans(tenant_id)',
        'idx_ssp_student ON soft_skill_plans(tenant_id, student_id)',
        'idx_ssp_status ON soft_skill_plans(tenant_id, status)'
      ];
      for (const i of idxs) { try { await pool.query('CREATE INDEX IF NOT EXISTS ' + i); } catch(e) {} }
      console.log('[soft-skills] OK');
    } catch(e) { console.warn('[soft-skills] Warn:', e.message); }
  })();

  // ================================================================
  // ROUTE 1: Dashboard
  // ================================================================
  app.get('/school/soft-skills', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const cats = await pool.query('SELECT COUNT(*)::int as cnt FROM soft_skill_categories WHERE tenant_id=$1', [t]);
    const assessments = await pool.query('SELECT COUNT(*)::int as cnt FROM soft_skill_assessments WHERE tenant_id=$1', [t]);
    const plans = await pool.query('SELECT COUNT(*)::int as cnt, AVG(progress_pct)::numeric(5,1) as avg_prog FROM soft_skill_plans WHERE tenant_id=$1', [t]);
    const recentAssessments = await pool.query(
      'SELECT sa.*, sc.name as cat_name FROM soft_skill_assessments sa LEFT JOIN soft_skill_categories sc ON sc.id=sa.category_id WHERE sa.tenant_id=$1 ORDER BY sa.created_at DESC LIMIT 5', [t]);
    const catCount = cats.rows[0].cnt;
    const assessCount = assessments.rows[0].cnt;
    const planCount = plans.rows[0].cnt;
    const avgProg = plans.rows[0].avg_prog || 0;

    let recentHtml = '';
    if (recentAssessments.rows.length) {
      recentHtml = '<table><tr><th>Category</th><th>Score</th><th>Date</th><th>Comments</th></tr>';
      recentAssessments.rows.forEach(r => {
        recentHtml += '<tr><td>' + esc(r.cat_name || 'N/A') + '</td><td><strong style="color:' + scoreColor(pn(r.overall_score, 0)) + '">' + pn(r.overall_score, 0) + '%</strong></td><td>' + esc(r.assessment_date) + '</td><td>' + esc((r.comments || '').substring(0, 60)) + '</td></tr>';
      });
      recentHtml += '</table>';
    }

    const page = renderPage('Soft Skills', SKIP + nav('dash') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:' + P + '">' + catCount + '</div><div style="color:' + GRAY + '">Categories</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:#059669">' + assessCount + '</div><div style="color:' + GRAY + '">Assessments</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:#d97706">' + planCount + '</div><div style="color:' + GRAY + '">Plans</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:#7c3aed">' + avgProg + '%</div><div style="color:' + GRAY + '">Avg Progress</div></div>' +
      '</div>' +
      '<div class="card"><h3 style="margin:0 0 12px">Recent Assessments</h3>' + (recentHtml || '<p style="color:' + GRAY + '">No assessments yet</p>') + '</div>' +
      '<div style="margin-top:16px"><a href="/school/soft-skills/assess" class="btn" style="display:inline-block;text-decoration:none;margin-right:8px">New Assessment</a>' +
      '<a href="/school/soft-skills/categories" class="btn" style="display:inline-block;text-decoration:none;background:#059669">Manage Categories</a></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 2: Manage Categories
  // ================================================================
  app.get('/school/soft-skills/categories', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const cats = await pool.query('SELECT * FROM soft_skill_categories WHERE tenant_id=$1 ORDER BY name', [t]);
    let rows = '';
    cats.rows.forEach(c => {
      const skills = pj(c.skills, []);
      const skillTags = skills.map(s => '<span style="display:inline-block;background:#eef2ff;color:' + P + ';padding:2px 10px;border-radius:12px;font-size:12px;margin:2px">' + esc(s.name || s) + '</span>').join('');
      rows += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start"><div><h4 style="margin:0 0 4px">' + esc(c.name) + '</h4><p style="margin:0 0 8px;color:' + GRAY + ';font-size:14px">' + esc(c.description) + '</p><div>' + skillTags + '</div></div>' +
        '<div style="display:flex;gap:6px"><a href="/school/soft-skills/categories/edit/' + c.id + '" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>' +
        '<form method="post" action="/school/soft-skills/categories/delete" style="display:inline"><input type="hidden" name="id" value="' + c.id + '"><button type="submit" class="btn" style="font-size:12px;padding:4px 10px;background:#dc2626">Delete</button></form></div></div></div>';
    });

    const page = renderPage('Skill Categories', SKIP + nav('cat') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3>Skill Categories</h3>' +
      '<a href="/school/soft-skills/categories/new" class="btn" style="text-decoration:none">+ Add Category</a></div>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No categories yet. <a href="/school/soft-skills/categories/new">Create one</a></div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 3: Create Category
  // ================================================================
  app.get('/school/soft-skills/categories/new', requireAuth, ah(async (req, res) => {
    const page = renderPage('New Category', SKIP + nav('cat') +
      '<div class="card"><h3 style="margin:0 0 16px">Create Skill Category</h3>' +
      '<form method="post" action="/school/soft-skills/categories">' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Category Name</label><input type="text" name="name" required placeholder="e.g., Communication Skills"></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Describe this skill category..."></textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Skills (one per line)</label><textarea name="skills" rows="5" placeholder="Verbal Communication\nWritten Communication\nActive Listening\nPresentation Skills\nPublic Speaking"></textarea></div>' +
        '<button type="submit" class="btn">Create Category</button>' +
      '</form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/soft-skills/categories', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { name, description, skills } = req.body;
    const skillsArr = (skills || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ name: s }));
    await pool.query('INSERT INTO soft_skill_categories (tenant_id, name, description, skills) VALUES ($1,$2,$3,$4)',
      [t, name, description || '', JSON.stringify(skillsArr)]);
    audit('soft_skill_category_created', { name, tenant: t });
    res.redirect('/school/soft-skills/categories');
  }));

  // ================================================================
  // ROUTE 4: Edit Category
  // ================================================================
  app.get('/school/soft-skills/categories/edit/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM soft_skill_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Category not found');
    const c = r.rows[0];
    const skills = pj(c.skills, []);
    const skillsText = skills.map(s => s.name || s).join('\n');
    const page = renderPage('Edit Category', SKIP + nav('cat') +
      '<div class="card"><h3 style="margin:0 0 16px">Edit Category</h3>' +
      '<form method="post" action="/school/soft-skills/categories/update">' +
        '<input type="hidden" name="id" value="' + c.id + '">' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Name</label><input type="text" name="name" required value="' + esc(c.name) + '"></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">' + esc(c.description) + '</textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Skills (one per line)</label><textarea name="skills" rows="5">' + esc(skillsText) + '</textarea></div>' +
        '<button type="submit" class="btn">Update Category</button>' +
      '</form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/soft-skills/categories/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { id, name, description, skills } = req.body;
    const skillsArr = (skills || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ name: s }));
    await pool.query('UPDATE soft_skill_categories SET name=$1, description=$2, skills=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5',
      [name, description || '', JSON.stringify(skillsArr), id, t]);
    audit('soft_skill_category_updated', { id, tenant: t });
    res.redirect('/school/soft-skills/categories');
  }));

  // ================================================================
  // ROUTE 5: Delete Category
  // ================================================================
  app.post('/school/soft-skills/categories/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM soft_skill_categories WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('soft_skill_category_deleted', { id: req.body.id, tenant: t });
    res.redirect('/school/soft-skills/categories');
  }));

  // ================================================================
  // ROUTE 6: New Assessment Form
  // ================================================================
  app.get('/school/soft-skills/assess', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const cats = await pool.query('SELECT * FROM soft_skill_categories WHERE tenant_id=$1 ORDER BY name', [t]);
    if (!cats.rows.length) {
      const page = renderPage('Assess', SKIP + nav('assess') +
        '<div class="card" style="text-align:center"><h3>No Categories</h3><p style="color:' + GRAY + '">Please create skill categories first.</p>' +
        '<a href="/school/soft-skills/categories/new" class="btn" style="display:inline-block;text-decoration:none;margin-top:12px">Create Category</a></div>',
        req.session?.user);
      res.send(page);
      return;
    }
    let catOptions = cats.rows.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    const page = renderPage('New Assessment', SKIP + nav('assess') +
      '<div class="card"><h3 style="margin:0 0 16px">Create Soft Skills Assessment</h3>' +
      '<form method="post" action="/school/soft-skills/assess">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" name="student_id" required min="1"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Category</label><select name="category_id" required>' + catOptions + '</select></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Assessment Date</label><input type="date" name="assessment_date" value="' + new Date().toISOString().split('T')[0] + '"></div>' +
        '<div id="skills-area"></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Comments</label><textarea name="comments" rows="3" placeholder="General observations..."></textarea></div>' +
        '<button type="submit" class="btn">Submit Assessment</button>' +
      '</form></div>' +
      '<script>const cats=' + JSON.stringify(cats.rows.map(c => ({ id: c.id, skills: pj(' + JSON.stringify(JSON.stringify(c.skills)) + ',[]) }))) + ';' +
      'function loadSkills(){const cid=document.querySelector("[name=category_id]").value;const cat=cats.find(c=>c.id==cid);const area=document.getElementById("skills-area");if(!cat||!cat.skills.length){area.innerHTML="";return;}let h="<h4 style=\\"margin:12px 0 8px\\">Skill Scores (0-100)</h4><div style=\\"display:grid;grid-template-columns:1fr 1fr;gap:8px\\">";cat.skills.forEach(s=>{h+="<div><label style=\\"font-size:13px;display:block;margin-bottom:2px\\">"+s.name+"</label><input type=\\"number\\" name=\\"score_"+s.name.replace(/\\s/g,"_")+"\\" min=\\"0\\" max=\\"100\\" value=\\"50\\" style=\\"font-size:14px\\"></div>";});h+="</div>";area.innerHTML=h;}' +
      'document.querySelector("[name=category_id]").addEventListener("change",loadSkills);loadSkills();' +
      'function pj(v){try{return JSON.parse(v);}catch(e){return [];}}</script>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/soft-skills/assess', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student_id, category_id, assessment_date, comments } = req.body;
    const scores = {};
    let total = 0, count = 0;
    for (const key of Object.keys(req.body)) {
      if (key.startsWith('score_')) {
        const skillName = key.replace('score_', '').replace(/_/g, ' ');
        scores[skillName] = pn(req.body[key], 50);
        total += scores[skillName];
        count++;
      }
    }
    const overall = count > 0 ? Math.round(total / count * 10) / 10 : 0;
    await pool.query('INSERT INTO soft_skill_assessments (tenant_id, student_id, category_id, evaluator_id, scores, comments, overall_score, assessment_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, student_id, category_id, req.session?.user?.id || 0, JSON.stringify(scores), comments || '', overall, assessment_date || new Date().toISOString().split('T')[0]]);
    audit('soft_skill_assessment_created', { student_id, category_id, overall, tenant: t });
    req.flash = req.flash || {};
    res.redirect('/school/soft-skills/assessments?student_id=' + student_id);
  }));

  // ================================================================
  // ROUTE 7: View Student Assessments
  // ================================================================
  app.get('/school/soft-skills/assessments', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.query.student_id;
    let where = 'sa.tenant_id = $1';
    let params = [t];
    if (studentId) { where += ' AND sa.student_id = $2'; params.push(studentId); }
    const r = await pool.query(
      'SELECT sa.*, sc.name as cat_name, u.name as evaluator_name FROM soft_skill_assessments sa LEFT JOIN soft_skill_categories sc ON sc.id=sa.category_id LEFT JOIN users u ON u.id=sa.evaluator_id WHERE ' + where + ' ORDER BY sa.assessment_date DESC', params);
    let table = '';
    r.rows.forEach(a => {
      const scores = pj(a.scores, {});
      const scoreDetails = Object.entries(scores).map(([k, v]) => esc(k) + ': ' + v + '%').join(', ');
      table += '<tr><td>' + esc(a.cat_name || 'N/A') + '</td><td>' + (a.student_id || '') + '</td><td><strong style="color:' + scoreColor(pn(a.overall_score, 0)) + '">' + pn(a.overall_score, 0) + '%</strong></td><td style="font-size:12px;color:' + GRAY + ';max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(scoreDetails) + '</td><td>' + esc(a.assessment_date) + '</td><td>' + esc(a.evaluator_name || 'System') + '</td></tr>';
    });
    const page = renderPage('Assessments', SKIP + nav('assess') +
      '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
        '<h3 style="margin:0">Assessment Records (' + r.rows.length + ')</h3>' +
        '<form method="get" action="/school/soft-skills/assessments" style="display:flex;gap:8px;align-items:center"><input type="number" name="student_id" placeholder="Student ID" value="' + esc(studentId || '') + '" style="width:140px"><button type="submit" class="btn" style="padding:6px 12px">Filter</button></form>' +
      '</div>' +
      '<div style="overflow-x:auto"><table><tr><th>Category</th><th>Student</th><th>Overall</th><th>Details</th><th>Date</th><th>Evaluator</th></tr>' +
        (table || '<tr><td colspan="6" style="text-align:center;color:' + GRAY + '">No assessments found</td></tr>') +
      '</table></div></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 8: Skill Development Plans
  // ================================================================
  app.get('/school/soft-skills/plans', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const plans = await pool.query('SELECT * FROM soft_skill_plans WHERE tenant_id=$1 ORDER BY created_at DESC', [t]);
    let cards = '';
    plans.rows.forEach(p => {
      const acts = pj(p.activities, []);
      const actList = acts.map(a => '<li style="font-size:13px">' + esc(a.text || a) + '</li>').join('');
      const statusColor = p.status === 'completed' ? '#059669' : p.status === 'active' ? P : '#dc2626';
      cards += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">' +
        '<div><h4 style="margin:0 0 4px">Student #' + p.student_id + ' - ' + esc(p.current_level) + ' → ' + esc(p.target_level) + '</h4>' +
        '<p style="margin:0 0 8px;color:' + GRAY + ';font-size:13px">Deadline: ' + esc(p.deadline || 'Not set') + '</p>' +
        scoreBar(pn(p.progress_pct, 0), 'Progress') +
        (actList ? '<ul style="margin:8px 0 0;padding-left:20px">' + actList + '</ul>' : '') +
        '</div><div style="display:flex;gap:6px">' +
        '<a href="/school/soft-skills/plans/edit/' + p.id + '" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>' +
        '<span style="display:inline-block;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;background:' + statusColor + '">' + esc(p.status) + '</span></div></div></div>';
    });

    const page = renderPage('Development Plans', SKIP + nav('plans') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3>Skill Development Plans</h3>' +
      '<a href="/school/soft-skills/plans/new" class="btn" style="text-decoration:none">+ New Plan</a></div>' +
      (cards || '<div class="card" style="text-align:center;color:' + GRAY + '">No plans yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 9: Create Plan
  // ================================================================
  app.get('/school/soft-skills/plans/new', requireAuth, ah(async (req, res) => {
    const page = renderPage('New Plan', SKIP + nav('plans') +
      '<div class="card"><h3 style="margin:0 0 16px">Create Development Plan</h3>' +
      '<form method="post" action="/school/soft-skills/plans">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" name="student_id" required min="1"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Deadline</label><input type="date" name="deadline"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Current Level</label><select name="current_level"><option>beginner</option><option>elementary</option><option>intermediate</option><option>advanced</option><option>expert</option></select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Target Level</label><select name="target_level"><option>elementary</option><option>intermediate</option><option>advanced</option><option>expert</option></select></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Development Activities (one per line)</label><textarea name="activities" rows="5" placeholder="Practice daily journaling\nJoin debate club\nAttend communication workshop\nComplete 3 presentations this term"></textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Initial Progress (%)</label><input type="number" name="progress_pct" min="0" max="100" value="0"></div>' +
        '<button type="submit" class="btn">Create Plan</button>' +
      '</form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/soft-skills/plans', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student_id, current_level, target_level, deadline, activities, progress_pct } = req.body;
    const acts = (activities || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ text: s, completed: false }));
    await pool.query('INSERT INTO soft_skill_plans (tenant_id, student_id, current_level, target_level, activities, deadline, progress_pct) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, student_id, current_level || 'beginner', target_level || 'intermediate', JSON.stringify(acts), deadline || null, pn(progress_pct, 0)]);
    audit('soft_skill_plan_created', { student_id, tenant: t });
    res.redirect('/school/soft-skills/plans');
  }));

  // ================================================================
  // ROUTE 10: Edit & Update Plan
  // ================================================================
  app.get('/school/soft-skills/plans/edit/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM soft_skill_plans WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Plan not found');
    const p = r.rows[0];
    const acts = pj(p.activities, []);
    const actsText = acts.map(a => a.text || a).join('\n');
    const page = renderPage('Edit Plan', SKIP + nav('plans') +
      '<div class="card"><h3 style="margin:0 0 16px">Edit Development Plan</h3>' +
      '<form method="post" action="/school/soft-skills/plans/update">' +
        '<input type="hidden" name="id" value="' + p.id + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" name="student_id" required value="' + p.student_id + '"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Deadline</label><input type="date" name="deadline" value="' + esc(p.deadline || '') + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Current Level</label><select name="current_level">' +
            ['beginner','elementary','intermediate','advanced','expert'].map(l => '<option' + (p.current_level === l ? ' selected' : '') + '>' + l + '</option>').join('') +
          '</select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Target Level</label><select name="target_level">' +
            ['beginner','elementary','intermediate','advanced','expert'].map(l => '<option' + (p.target_level === l ? ' selected' : '') + '>' + l + '</option>').join('') +
          '</select></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Activities (one per line)</label><textarea name="activities" rows="5">' + esc(actsText) + '</textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Progress (%)</label><input type="number" name="progress_pct" min="0" max="100" value="' + Math.round(pn(p.progress_pct, 0)) + '"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option' + (p.status === 'active' ? ' selected' : '') + '>active</option><option' + (p.status === 'paused' ? ' selected' : '') + '>paused</option><option' + (p.status === 'completed' ? ' selected' : '') + '>completed</option></select></div>' +
        '</div>' +
        '<button type="submit" class="btn">Update Plan</button>' +
      '</form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/soft-skills/plans/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { id, student_id, current_level, target_level, deadline, activities, progress_pct, status } = req.body;
    const acts = (activities || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ text: s, completed: false }));
    await pool.query('UPDATE soft_skill_plans SET student_id=$1, current_level=$2, target_level=$3, activities=$4, deadline=$5, progress_pct=$6, status=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9',
      [student_id, current_level, target_level, JSON.stringify(acts), deadline || null, pn(progress_pct, 0), status || 'active', id, t]);
    audit('soft_skill_plan_updated', { id, tenant: t });
    res.redirect('/school/soft-skills/plans');
  }));

  // ================================================================
  // ROUTE 11: Analytics
  // ================================================================
  app.get('/school/soft-skills/analytics', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    // Score distribution by category
    const catScores = await pool.query(
      'SELECT sc.name, AVG(sa.overall_score)::numeric(5,1) as avg_score, COUNT(*)::int as cnt FROM soft_skill_assessments sa JOIN soft_skill_categories sc ON sc.id=sa.category_id WHERE sa.tenant_id=$1 GROUP BY sc.name ORDER BY avg_score DESC', [t]);
    // Top performers
    const topStudents = await pool.query(
      'SELECT student_id, AVG(overall_score)::numeric(5,1) as avg_score, COUNT(*)::int as assessments FROM soft_skill_assessments WHERE tenant_id=$1 GROUP BY student_id ORDER BY avg_score DESC LIMIT 10', [t]);
    // Plan status summary
    const planStatus = await pool.query(
      'SELECT status, COUNT(*)::int as cnt FROM soft_skill_plans WHERE tenant_id=$1 GROUP BY status', [t]);
    // Monthly trend
    const trend = await pool.query(
      "SELECT TO_CHAR(assessment_date,'YYYY-MM') as month, AVG(overall_score)::numeric(5,1) as avg_score, COUNT(*)::int as cnt FROM soft_skill_assessments WHERE tenant_id=$1 GROUP BY month ORDER BY month DESC LIMIT 12", [t]);

    let catBars = '';
    catScores.rows.forEach(r => { catBars += scoreBar(pn(r.avg_score, 0), r.name + ' (' + r.cnt + ')'); });

    let studentRows = '';
    topStudents.rows.forEach((r, i) => {
      studentRows += '<tr><td>#' + (i + 1) + '</td><td>Student #' + r.student_id + '</td><td><strong style="color:' + scoreColor(pn(r.avg_score, 0)) + '">' + pn(r.avg_score, 0) + '%</strong></td><td>' + r.assessments + '</td></tr>';
    });

    let statusCards = '';
    const statusColors = { active: P, completed: '#059669', paused: '#d97706' };
    planStatus.rows.forEach(r => {
      statusCards += '<div style="background:' + (statusColors[r.status] || GRAY) + ';color:#fff;padding:16px 20px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:700">' + r.cnt + '</div><div style="font-size:13px;text-transform:capitalize">' + r.status + '</div></div>';
    });

    let trendRows = '';
    trend.rows.forEach(r => {
      trendRows += '<tr><td>' + esc(r.month) + '</td><td>' + pn(r.avg_score, 0) + '%</td><td>' + r.cnt + '</td></tr>';
    });

    const page = renderPage('Soft Skills Analytics', SKIP + nav('analytics') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Average Score by Category</h4>' + (catBars || '<p style="color:' + GRAY + '">No data</p>') + '</div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Plan Status Summary</h4><div style="display:flex;gap:12px;flex-wrap:wrap">' + (statusCards || '<p style="color:' + GRAY + '">No plans</p>') + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Top Performing Students</h4><table><tr><th>#</th><th>Student</th><th>Avg Score</th><th>Tests</th></tr>' + (studentRows || '<tr><td colspan="4" style="text-align:center;color:' + GRAY + '">No data</td></tr>') + '</table></div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Monthly Trend</h4><table><tr><th>Month</th><th>Avg Score</th><th>Count</th></tr>' + (trendRows || '<tr><td colspan="3" style="text-align:center;color:' + GRAY + '">No data</td></tr>') + '</table></div>' +
      '</div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 12: API - Delete Assessment
  // ================================================================
  app.post('/school/soft-skills/assessments/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM soft_skill_assessments WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('soft_skill_assessment_deleted', { id: req.body.id, tenant: t });
    res.json({ success: true });
  }));

  // ================================================================
  // ROUTE 13: API - Seed Default Categories
  // ================================================================
  app.post('/school/soft-skills/api/seed', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const defaults = [
      { name: 'Communication Skills', description: 'Verbal, written, and non-verbal communication abilities', skills: ['Verbal Communication', 'Written Communication', 'Active Listening', 'Presentation Skills', 'Non-verbal Communication'] },
      { name: 'Teamwork & Collaboration', description: 'Ability to work effectively with others', skills: ['Cooperation', 'Delegation', 'Conflict Resolution', 'Supportiveness', 'Shared Responsibility'] },
      { name: 'Leadership', description: 'Guiding and inspiring others toward common goals', skills: ['Vision Setting', 'Decision Making', 'Motivation', 'Accountability', 'Strategic Thinking'] },
      { name: 'Time Management', description: 'Efficient use of time and task prioritization', skills: ['Planning', 'Prioritization', 'Goal Setting', 'Meeting Deadlines', 'Task Delegation'] },
      { name: 'Emotional Intelligence', description: 'Self-awareness, empathy, and social skills', skills: ['Self-awareness', 'Self-regulation', 'Empathy', 'Social Skills', 'Motivation'] },
      { name: 'Adaptability', description: 'Flexibility and resilience in changing situations', skills: ['Flexibility', 'Resilience', 'Open-mindedness', 'Problem Solving', 'Learning Agility'] },
      { name: 'Interpersonal Skills', description: 'Building and maintaining positive relationships', skills: ['Relationship Building', 'Networking', 'Trust Building', 'Respect', 'Collaboration'] },
      { name: 'Critical Thinking', description: 'Analytical reasoning and sound judgment', skills: ['Analysis', 'Evaluation', 'Inference', 'Explanation', 'Self-correction'] }
    ];
    for (const d of defaults) {
      const existing = await pool.query('SELECT id FROM soft_skill_categories WHERE tenant_id=$1 AND name=$2', [t, d.name]);
      if (!existing.rows.length) {
        await pool.query('INSERT INTO soft_skill_categories (tenant_id, name, description, skills) VALUES ($1,$2,$3,$4)',
          [t, d.name, d.description, JSON.stringify(d.skills.map(s => ({ name: s })))]);
      }
    }
    audit('soft_skills_seeded', { tenant: t });
    res.json({ success: true, seeded: defaults.length });
  }));

  // ================================================================
  // ROUTE 14: Student Profile - All Skills Overview
  // ================================================================
  app.get('/school/soft-skills/student/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.params.id;
    const assessments = await pool.query(
      'SELECT sa.*, sc.name as cat_name FROM soft_skill_assessments sa JOIN soft_skill_categories sc ON sc.id=sa.category_id WHERE sa.tenant_id=$1 AND sa.student_id=$2 ORDER BY sa.assessment_date DESC', [t, studentId]);
    const plans = await pool.query(
      'SELECT * FROM soft_skill_plans WHERE tenant_id=$1 AND student_id=$2 AND status=$3', [t, studentId, 'active']);
    // Calculate overall average
    const avgR = await pool.query(
      'SELECT AVG(overall_score)::numeric(5,1) as avg, COUNT(*)::int as cnt FROM soft_skill_assessments WHERE tenant_id=$1 AND student_id=$2', [t, studentId]);
    const avgScore = pn(avgR.rows[0].avg, 0);
    const totalAssessments = avgR.rows[0].cnt;

    let assessmentCards = '';
    assessments.rows.forEach(a => {
      const scores = pj(a.scores, {});
      let bars = '';
      for (const [k, v] of Object.entries(scores)) {
        bars += scoreBar(pn(v, 0), k);
      }
      assessmentCards += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h4 style="margin:0">' + esc(a.cat_name) + '</h4><span style="font-size:20px;font-weight:700;color:' + scoreColor(pn(a.overall_score, 0)) + '">' + pn(a.overall_score, 0) + '%</span></div>' +
        '<p style="font-size:12px;color:' + GRAY + ';margin:0 0 8px">' + esc(a.assessment_date) + (a.comments ? ' — ' + esc((a.comments || '').substring(0, 80)) : '') + '</p>' + bars + '</div>';
    });

    let planCards = '';
    plans.rows.forEach(p => {
      planCards += '<div class="card"><h4 style="margin:0 0 4px">' + esc(p.current_level) + ' → ' + esc(p.target_level) + '</h4>' +
        scoreBar(pn(p.progress_pct, 0), 'Progress') +
        '<p style="font-size:12px;color:' + GRAY + ';margin:4px 0 0">Deadline: ' + esc(p.deadline || 'Not set') + '</p></div>';
    });

    const page = renderPage('Student #' + studentId + ' Skills', SKIP + nav('dash') +
      '<div style="display:flex;gap:16px;align-items:center;margin-bottom:20px">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:' + P + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700">#' + studentId + '</div>' +
        '<div><h2 style="margin:0">Student Profile</h2><p style="margin:4px 0 0;color:' + GRAY + '">Overall: <strong style="color:' + scoreColor(avgScore) + '">' + avgScore + '%</strong> across ' + totalAssessments + ' assessments</p></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:20px">' + assessmentCards + '</div>' +
      (planCards ? '<h3 style="margin:16px 0 8px">Active Development Plans</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">' + planCards + '</div>' : ''),
      req.session?.user);
    res.send(page);
  }));
};
