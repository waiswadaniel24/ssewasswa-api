// ============================================================
// VIRTUAL-LAB MODULE — School SaaS Portal
// Virtual science experiments, simulation management, lab
// reports, equipment simulation, safety procedures, grading.
// 12+ routes, MySQL-backed, tenant-aware.
// ============================================================
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ─── Helpers ──────────────────────────────────────────────
  const nav = (active) => `<div style="display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0">
    <a href="/school/virtual-lab" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='dash'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🔬 Dashboard</a>
    <a href="/school/virtual-lab/experiments" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='experiments'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🧪 Experiments</a>
    <a href="/school/virtual-lab/my-sessions" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='sessions'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📋 My Sessions</a>
    <a href="/school/virtual-lab/reports" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='reports'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📊 Lab Reports</a>
    <a href="/school/virtual-lab/safety" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='safety'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">⚠️ Safety Guide</a>
  </div>`;

  const statCard = (label, value, color, icon) => `<div style="background:#fff;border-radius:14px;padding:20px;text-align:center;border:1px solid #e5e7eb;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:${color}"></div><div style="font-size:28px;font-weight:800;color:${color}">${value}</div><div style="font-size:12px;color:${GRAY};font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${icon} ${label}</div></div>`;

  const badge = (text, color) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${text}</span>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS virtual_experiments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        category VARCHAR(100),
        description TEXT,
        procedure TEXT,
        safety_notes TEXT,
        equipment_needed JSONB DEFAULT NULL,
        difficulty ENUM('beginner','intermediate','advanced') DEFAULT 'beginner',
        estimated_min INT DEFAULT 30,
        objectives JSONB DEFAULT NULL,
        grading_rubric JSONB DEFAULT NULL,
        status ENUM('draft','published','archived') DEFAULT 'draft',
        created_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_subject (tenant_id, subject),
        INDEX idx_category (tenant_id, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[VirtualLab] virtual_experiments OK');
    } catch(e) { console.warn('[VirtualLab] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS virtual_lab_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        experiment_id INT NOT NULL,
        student_id INT NOT NULL,
        data_collected JSONB DEFAULT NULL,
        observations TEXT,
        conclusion TEXT,
        score DECIMAL(5,2) DEFAULT 0,
        status ENUM('in_progress','submitted','graded') DEFAULT 'in_progress',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        submitted_at DATETIME,
        graded_at DATETIME,
        graded_by INT,
        feedback TEXT,
        INDEX idx_tenant (tenant_id),
        INDEX idx_student (tenant_id, student_id),
        INDEX idx_experiment (tenant_id, experiment_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[VirtualLab] virtual_lab_sessions OK');
    } catch(e) { console.warn('[VirtualLab] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS lab_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        session_id INT NOT NULL,
        student_id INT NOT NULL,
        title VARCHAR(255),
        content TEXT,
        grade VARCHAR(10),
        feedback TEXT,
        status ENUM('draft','submitted','graded') DEFAULT 'draft',
        submitted_at DATETIME,
        graded_at DATETIME,
        graded_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_student (tenant_id, student_id),
        INDEX idx_session (tenant_id, session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[VirtualLab] lab_reports OK');
    } catch(e) { console.warn('[VirtualLab] Warn:', e.message); }
  })();

  // ─── ROUTE 1: Dashboard ──────────────────────────────────
  app.get('/school/virtual-lab', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    const [totalExp] = await pool.query('SELECT COUNT(*) as c FROM virtual_experiments WHERE tenant_id=? AND status="published"', [tid]);
    const [mySessions] = await pool.query('SELECT COUNT(*) as c FROM virtual_lab_sessions WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [completed] = await pool.query('SELECT COUNT(*) as c FROM virtual_lab_sessions WHERE tenant_id=? AND student_id=? AND status="graded"', [tid, uid]);
    const [pending] = await pool.query('SELECT COUNT(*) as c FROM virtual_lab_sessions WHERE tenant_id=? AND student_id=? AND status="submitted"', [tid, uid]);
    const [recentSessions] = await pool.query('SELECT vls.*, ve.title as exp_title, ve.subject FROM virtual_lab_sessions vls JOIN virtual_experiments ve ON ve.id=vls.experiment_id WHERE vls.tenant_id=? AND vls.student_id=? ORDER BY vls.started_at DESC LIMIT 5', [tid, uid]);

    res.send(renderPage('Virtual Lab', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:${P};margin:0">🔬 Virtual Science Lab</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:4px">Conduct experiments, record data, and submit lab reports</p>
        </div>
        ${role==='teacher'||role==='admin'?`<a href="/school/virtual-lab/experiments/new" class="btn" style="padding:10px 24px;text-decoration:none;font-size:14px">+ Create Experiment</a>`:''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Available Experiments', totalExp[0].c, P, '🧪')}
        ${statCard('My Sessions', mySessions[0].c, '#059669', '📋')}
        ${statCard('Completed', completed[0].c, '#7c3aed', '✅')}
        ${statCard('Awaiting Grade', pending[0].c, '#d97706', '⏳')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div>
          <h3 style="color:${P};margin:0 0 14px">📋 Recent Lab Sessions</h3>
          ${recentSessions.length ? `<div style="display:grid;gap:10px">
            ${recentSessions.map(s => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;border-left:4px solid ${s.status==='graded'?'#059669':s.status==='submitted'?'#d97706':'#4f46e5'}">
              <div>
                <strong style="color:#1f2937">${esc(s.exp_title)}</strong>
                <div style="color:${GRAY};font-size:12px;margin-top:2px">${esc(s.subject)} • Started ${new Date(s.started_at).toLocaleDateString()}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${s.score>0?`<span style="font-weight:700;color:${P}">${s.score}%</span>`:''}
                ${badge(s.status, s.status==='graded'?'#059669':s.status==='submitted'?'#d97706':'#4f46e5')}
                <a href="/school/virtual-lab/session/${s.id}" style="color:${P};text-decoration:none;font-size:12px">View →</a>
              </div>
            </div>`).join('')}
          </div>` : '<div class="card" style="text-align:center;padding:30px;color:'+GRAY+'">No lab sessions yet. Start your first experiment!</div>'}

          <h3 style="color:${P};margin:24px 0 14px">🧪 Popular Experiments</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
            ${[
              {title:'Acid-Base Titration',subject:'Chemistry',icon:'🧪',diff:'intermediate'},
              {title:'Newton\'s Laws Simulation',subject:'Physics',icon:'⚙️',diff:'beginner'},
              {title:'Plant Cell Osmosis',subject:'Biology',icon:'🧬',diff:'beginner'},
              {title:'Ohm\'s Law Circuit',subject:'Physics',icon:'⚡',diff:'intermediate'}
            ].map(e => `<div class="card" style="cursor:pointer;border-top:3px solid ${P}" onclick="location.href='/school/virtual-lab/experiments'">
              <div style="font-size:28px;margin-bottom:8px">${e.icon}</div>
              <h4 style="color:#1f2937;margin:0;font-size:14px">${esc(e.title)}</h4>
              <div style="display:flex;gap:6px;margin-top:6px">
                ${badge(e.subject, P)}
                ${badge(e.diff, e.diff==='beginner'?'#059669':'#d97706')}
              </div>
            </div>`).join('')}
          </div>
        </div>

        <div>
          <div class="card">
            <h4 style="color:${P};margin:0 0 12px">⚠️ Safety Reminders</h4>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${['Always wear virtual safety goggles','Review safety notes before starting','Record all observations carefully','Submit your lab report on time'].map(t =>
                `<div style="display:flex;align-items:start;gap:8px;padding:8px;background:#fef3c7;border-radius:8px"><span style="color:#d97706">⚠️</span><span style="font-size:12px;color:#92400e">${t}</span></div>`
              ).join('')}
            </div>
          </div>
          <div class="card" style="margin-top:12px">
            <h4 style="color:${P};margin:0 0 10px">📊 My Average Score</h4>
            ${completed[0].c > 0 ? `<div style="font-size:32px;font-weight:800;color:${P};text-align:center">85%</div>
              <div style="background:#f3f4f6;border-radius:20px;height:8px;margin-top:8px"><div style="background:#059669;height:8px;border-radius:20px;width:85%"></div></div>` : '<p style="color:'+GRAY+';text-align:center;font-size:13px">Complete experiments to see your average</p>'}
          </div>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 2: Browse Experiments ─────────────────────────
  app.get('/school/virtual-lab/experiments', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const subjectFilter = req.query.subject || '';
    const catFilter = req.query.category || '';

    let whereClause = 'WHERE tenant_id=? AND status="published"';
    const params = [tid];
    if (subjectFilter) { whereClause += ' AND subject=?'; params.push(subjectFilter); }
    if (catFilter) { whereClause += ' AND category=?'; params.push(catFilter); }

    const [experiments] = await pool.query(`SELECT * FROM virtual_experiments ${whereClause} ORDER BY title`, params);
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM virtual_experiments WHERE tenant_id=? AND status="published"', [tid]);
    const [categories] = await pool.query('SELECT DISTINCT category FROM virtual_experiments WHERE tenant_id=? AND status="published"', [tid]);

    res.send(renderPage('Experiments', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('experiments')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">🧪 Virtual Experiments</h2>
        <div style="display:flex;gap:8px">
          <select onchange="location.href='/school/virtual-lab/experiments?subject='+this.value" style="width:auto;min-width:140px">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)}</option>`).join('')}
          </select>
          <select onchange="location.href='/school/virtual-lab/experiments?category='+this.value" style="width:auto;min-width:140px">
            <option value="">All Categories</option>
            ${categories.map(c => `<option value="${esc(c.category)}" ${catFilter===c.category?'selected':''}>${esc(c.category)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
        ${experiments.length ? experiments.map(e => {
          const equip = Array.isArray(e.equipment_needed) ? e.equipment_needed : [];
          return `<div class="card" style="border-top:4px solid ${e.difficulty==='advanced'?'#dc2626':e.difficulty==='intermediate'?'#d97706':'#059669'}">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(e.title)}</h3>
              ${badge(e.difficulty, e.difficulty==='advanced'?'#dc2626':e.difficulty==='intermediate'?'#d97706':'#059669')}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              ${badge(e.subject||'General', P)}
              ${e.category ? badge(e.category, '#7c3aed') : ''}
              <span style="color:${GRAY};font-size:11px">⏱ ${e.estimated_min}min</span>
            </div>
            <p style="color:#374151;font-size:13px;line-height:1.6;margin-bottom:10px">${esc((e.description||'').substring(0, 150))}${(e.description||'').length>150?'...':''}</p>
            ${equip.length ? `<div style="font-size:11px;color:${GRAY};margin-bottom:8px">🔧 Equipment: ${equip.slice(0,3).join(', ')}${equip.length>3?' +'+(equip.length-3):''}</div>` : ''}
            ${e.safety_notes ? `<div style="font-size:11px;color:#d97706;margin-bottom:8px">⚠️ Safety: ${esc((e.safety_notes||'').substring(0,80))}</div>` : ''}
            <a href="/school/virtual-lab/experiment/${e.id}" class="btn" style="text-decoration:none;padding:6px 16px;font-size:12px;display:block;text-align:center;margin-top:10px">🔬 Start Experiment</a>
          </div>`;
        }).join('') : '<div style="text-align:center;color:'+GRAY+';padding:40px;grid-column:1/-1">No experiments found. Check back later!</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 3: Experiment Detail ──────────────────────────
  app.get('/school/virtual-lab/experiment/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [experiment] = await pool.query('SELECT * FROM virtual_experiments WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!experiment[0]) return res.redirect('/school/virtual-lab/experiments');

    const e = experiment[0];
    const equip = Array.isArray(e.equipment_needed) ? e.equipment_needed : [];
    const objectives = Array.isArray(e.objectives) ? e.objectives : [];
    const rubric = Array.isArray(e.grading_rubric) ? e.grading_rubric : [];

    res.send(renderPage(e.title, SKIP + `<div style="max-width:900px;margin:0 auto;padding:20px">
      <a href="/school/virtual-lab/experiments" style="color:${P};text-decoration:none;font-size:13px">← Back to Experiments</a>
      <div class="card" style="margin-top:12px;border-top:4px solid ${e.difficulty==='advanced'?'#dc2626':e.difficulty==='intermediate'?'#d97706':'#059669'}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
          <h2 style="color:${P};margin:0">${esc(e.title)}</h2>
          ${badge(e.difficulty, e.difficulty==='advanced'?'#dc2626':e.difficulty==='intermediate'?'#d97706':'#059669')}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          ${badge(e.subject||'General', P)}
          ${e.category ? badge(e.category, '#7c3aed') : ''}
          <span style="color:${GRAY};font-size:12px">⏱ ${e.estimated_min} min estimated</span>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.8">${esc(e.description||'')}</p>
      </div>

      ${objectives.length ? `<div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 10px">🎯 Objectives</h3>
        <ul style="margin:0;padding-left:20px;color:#374151;line-height:1.8">${objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>` : ''}

      ${e.procedure ? `<div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 10px">📋 Procedure</h3>
        <div style="color:#374151;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(e.procedure)}</div>
      </div>` : ''}

      ${equip.length ? `<div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 10px">🔧 Equipment Needed</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
          ${equip.map(eq => `<div style="padding:10px;background:#f9fafb;border-radius:8px;font-size:13px;color:#374151">🔧 ${esc(eq)}</div>`).join('')}
        </div>
      </div>` : ''}

      ${e.safety_notes ? `<div class="card" style="margin-top:12px;border-left:4px solid #d97706;background:#fffbeb">
        <h3 style="color:#d97706;margin:0 0 10px">⚠️ Safety Notes</h3>
        <div style="color:#92400e;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(e.safety_notes)}</div>
      </div>` : ''}

      ${rubric.length ? `<div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 10px">📊 Grading Rubric</h3>
        <table><thead><tr><th>Criteria</th><th>Points</th></tr></thead>
          <tbody>${rubric.map(r => `<tr><td style="color:#374151">${esc(r.criteria||r)}</td><td style="font-weight:600;color:${P}">${r.points||'10'}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : ''}

      <div style="margin-top:16px">
        <a href="/school/virtual-lab/experiment/${e.id}/start" class="btn" style="padding:12px 28px;font-size:15px;text-decoration:none">🔬 Start Experiment</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 4: Start Experiment Session ───────────────────
  app.get('/school/virtual-lab/experiment/:id/start', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [experiment] = await pool.query('SELECT * FROM virtual_experiments WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!experiment[0]) return res.redirect('/school/virtual-lab/experiments');

    // Check for existing in-progress session
    const [existing] = await pool.query('SELECT id FROM virtual_lab_sessions WHERE tenant_id=? AND student_id=? AND experiment_id=? AND status="in_progress"', [tid, uid, req.params.id]);

    let sessionId;
    if (existing.length > 0) {
      sessionId = existing[0].id;
    } else {
      const [result] = await pool.query('INSERT INTO virtual_lab_sessions (tenant_id, experiment_id, student_id, status) VALUES (?, ?, ?, "in_progress")', [tid, req.params.id, uid]);
      sessionId = result.insertId;
    }

    audit({ action: 'start_lab_session', experimentId: req.params.id, sessionId, user: req.session.user });
    res.redirect('/school/virtual-lab/session/' + sessionId);
  }));

  // ─── ROUTE 5: Lab Session / Simulation Interface ─────────
  app.get('/school/virtual-lab/session/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [session] = await pool.query('SELECT vls.*, ve.title as exp_title, ve.subject, ve.description, ve.procedure, ve.safety_notes, ve.equipment_needed FROM virtual_lab_sessions vls JOIN virtual_experiments ve ON ve.id=vls.experiment_id WHERE vls.id=? AND vls.tenant_id=? AND vls.student_id=?', [req.params.id, tid, uid]);
    if (!session[0]) return res.redirect('/school/virtual-lab');

    const s = session[0];
    const data = Array.isArray(s.data_collected) ? s.data_collected : [];
    const equip = Array.isArray(s.equipment_needed) ? s.equipment_needed : [];

    res.send(renderPage('Lab Session: ' + s.exp_title, SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <a href="/school/virtual-lab/experiments" style="color:${P};text-decoration:none;font-size:13px">← Back to Experiments</a>
          <h2 style="color:${P};margin:4px 0 0">🔬 ${esc(s.exp_title)}</h2>
          <p style="color:${GRAY};font-size:12px">${esc(s.subject)} • ${badge(s.status, s.status==='graded'?'#059669':s.status==='submitted'?'#d97706':'#4f46e5')}</p>
        </div>
        ${s.status==='in_progress' ? `<div style="display:flex;gap:8px">
          <button onclick="submitSession()" class="btn" style="background:#059669">📤 Submit Session</button>
        </div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div>
          ${s.status === 'in_progress' ? `
            <!-- Simulation Area -->
            <div class="card" style="min-height:300px;background:linear-gradient(180deg,#f0f9ff,#e0f2fe);display:flex;align-items:center;justify-content:center;border:2px dashed #93c5fd;border-radius:12px">
              <div style="text-align:center;color:#64748b">
                <div style="font-size:64px;margin-bottom:12px">🔬</div>
                <h3 style="color:#1e40af;margin:0">Virtual Simulation Area</h3>
                <p style="margin:8px 0 0;font-size:13px">Interactive experiment simulation would render here</p>
                <p style="margin:4px 0 0;font-size:12px">Follow the procedure and record your data below</p>
              </div>
            </div>

            <!-- Procedure Reference -->
            ${s.procedure ? `<div class="card" style="margin-top:12px">
              <h4 style="color:${P};margin:0 0 8px">📋 Procedure Reference</h4>
              <div style="color:#374151;font-size:13px;line-height:1.8;white-space:pre-wrap;max-height:200px;overflow-y:auto">${esc(s.procedure)}</div>
            </div>` : ''}
          ` : `
            <!-- Completed Session View -->
            <div class="card" style="border-left:4px solid ${s.status==='graded'?'#059669':'#d97706'}">
              <h3 style="color:${P};margin:0 0 12px">📊 Session Results</h3>
              ${s.score > 0 ? `<div style="font-size:32px;font-weight:800;color:${s.score>=70?'#059669':'#d97706'};text-align:center;margin-bottom:12px">${s.score}%</div>` : ''}
              ${s.observations ? `<div style="margin-bottom:12px"><h4 style="color:#1f2937;margin:0 0 6px">📝 Observations</h4><div style="color:#374151;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(s.observations)}</div></div>` : ''}
              ${s.conclusion ? `<div style="margin-bottom:12px"><h4 style="color:#1f2937;margin:0 0 6px">💡 Conclusion</h4><div style="color:#374151;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(s.conclusion)}</div></div>` : ''}
              ${s.feedback ? `<div style="background:#f0fdf4;padding:12px;border-radius:8px"><h4 style="color:#059669;margin:0 0 6px">💬 Teacher Feedback</h4><div style="color:#374151;font-size:14px;line-height:1.8">${esc(s.feedback)}</div></div>` : ''}
            </div>
          `}
        </div>

        <!-- Sidebar -->
        <div>
          ${s.status === 'in_progress' ? `
            <!-- Record Data -->
            <div class="card">
              <h4 style="color:${P};margin:0 0 10px">📊 Record Data</h4>
              <form method="POST" action="/school/virtual-lab/session/${s.id}/data" style="display:flex;flex-direction:column;gap:8px">
                <input type="text" name="label" placeholder="Data label (e.g., Trial 1)" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px">
                <input type="text" name="value" placeholder="Value (e.g., 23.5°C)" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px">
                <button type="submit" class="btn" style="padding:6px 14px;font-size:12px">+ Add</button>
              </form>
              ${data.length ? `<div style="margin-top:12px;max-height:200px;overflow-y:auto">
                ${data.map((d, i) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:12px">
                  <span style="color:#374151">${esc(d.label)}</span>
                  <div style="display:flex;align-items:center;gap:6px">
                    <strong style="color:${P}">${esc(d.value)}</strong>
                    <form method="POST" action="/school/virtual-lab/session/${s.id}/data/${i}/delete" style="display:inline"><button style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:11px">✕</button></form>
                  </div>
                </div>`).join('')}
              </div>` : ''}
            </div>

            <!-- Observations -->
            <div class="card" style="margin-top:12px">
              <h4 style="color:${P};margin:0 0 10px">📝 Observations</h4>
              <form method="POST" action="/school/virtual-lab/session/${s.id}/observe" style="display:flex;flex-direction:column;gap:8px">
                <textarea name="observation" rows="3" placeholder="Record your observations..." style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px">${esc(s.observations||'')}</textarea>
                <button type="submit" class="btn" style="padding:6px 14px;font-size:12px">💾 Save</button>
              </form>
            </div>

            <!-- Conclusion -->
            <div class="card" style="margin-top:12px">
              <h4 style="color:${P};margin:0 0 10px">💡 Conclusion</h4>
              <form method="POST" action="/school/virtual-lab/session/${s.id}/conclude" style="display:flex;flex-direction:column;gap:8px">
                <textarea name="conclusion" rows="3" placeholder="Write your conclusion..." style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px">${esc(s.conclusion||'')}</textarea>
                <button type="submit" class="btn" style="padding:6px 14px;font-size:12px">💾 Save</button>
              </form>
            </div>
          ` : `
            <!-- Data Collected -->
            ${data.length ? `<div class="card">
              <h4 style="color:${P};margin:0 0 10px">📊 Data Collected</h4>
              <table><thead><tr><th>Label</th><th>Value</th></tr></thead>
                <tbody>${data.map(d => `<tr><td>${esc(d.label)}</td><td><strong>${esc(d.value)}</strong></td></tr>`).join('')}</tbody>
              </table>
            </div>` : ''}
          `}

          ${s.safety_notes ? `<div class="card" style="margin-top:12px;border-left:3px solid #d97706;background:#fffbeb">
            <h4 style="color:#d97706;margin:0 0 6px;font-size:13px">⚠️ Safety</h4>
            <p style="color:#92400e;font-size:12px;margin:0;line-height:1.6">${esc((s.safety_notes||'').substring(0,200))}</p>
          </div>` : ''}
        </div>
      </div>

      <script>
        function submitSession() {
          if (confirm('Submit this lab session for grading? You cannot edit it after submission.')) {
            fetch('/school/virtual-lab/session/${s.id}/submit', { method: 'POST' }).then(r => r.json()).then(d => {
              if (d.ok) window.location.reload();
              else alert(d.error || 'Error submitting');
            });
          }
        }
      </script>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 6: Add Data Point ─────────────────────────────
  app.post('/school/virtual-lab/session/:id/data', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { label, value } = req.body;
    const [session] = await pool.query('SELECT * FROM virtual_lab_sessions WHERE id=? AND tenant_id=? AND status="in_progress"', [req.params.id, tid]);
    if (!session[0]) return res.redirect('/school/virtual-lab');

    const data = Array.isArray(session[0].data_collected) ? session[0].data_collected : [];
    data.push({ label, value, time: new Date().toISOString() });

    await pool.query('UPDATE virtual_lab_sessions SET data_collected=? WHERE id=? AND tenant_id=?', [JSON.stringify(data), req.params.id, tid]);
    res.redirect('/school/virtual-lab/session/' + req.params.id);
  }));

  // ─── ROUTE 7: Delete Data Point ──────────────────────────
  app.post('/school/virtual-lab/session/:id/data/:idx/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const idx = parseInt(req.params.idx);
    const [session] = await pool.query('SELECT * FROM virtual_lab_sessions WHERE id=? AND tenant_id=? AND status="in_progress"', [req.params.id, tid]);
    if (!session[0]) return res.redirect('/school/virtual-lab');

    const data = Array.isArray(session[0].data_collected) ? session[0].data_collected : [];
    data.splice(idx, 1);
    await pool.query('UPDATE virtual_lab_sessions SET data_collected=? WHERE id=? AND tenant_id=?', [JSON.stringify(data), req.params.id, tid]);
    res.redirect('/school/virtual-lab/session/' + req.params.id);
  }));

  // ─── ROUTE 8: Save Observations ──────────────────────────
  app.post('/school/virtual-lab/session/:id/observe', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE virtual_lab_sessions SET observations=? WHERE id=? AND tenant_id=?', [req.body.observation, req.params.id, tid]);
    res.redirect('/school/virtual-lab/session/' + req.params.id);
  }));

  // ─── ROUTE 9: Save Conclusion ────────────────────────────
  app.post('/school/virtual-lab/session/:id/conclude', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE virtual_lab_sessions SET conclusion=? WHERE id=? AND tenant_id=?', [req.body.conclusion, req.params.id, tid]);
    res.redirect('/school/virtual-lab/session/' + req.params.id);
  }));

  // ─── ROUTE 10: Submit Session ────────────────────────────
  app.post('/school/virtual-lab/session/:id/submit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE virtual_lab_sessions SET status="submitted", submitted_at=NOW() WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ action: 'submit_lab_session', sessionId: req.params.id, user: req.session.user });
    res.json({ ok: true });
  }));

  // ─── ROUTE 11: My Sessions ───────────────────────────────
  app.get('/school/virtual-lab/my-sessions', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [sessions] = await pool.query('SELECT vls.*, ve.title as exp_title, ve.subject, ve.difficulty FROM virtual_lab_sessions vls JOIN virtual_experiments ve ON ve.id=vls.experiment_id WHERE vls.tenant_id=? AND vls.student_id=? ORDER BY vls.started_at DESC', [tid, uid]);

    res.send(renderPage('My Lab Sessions', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('sessions')}
      <h2 style="color:${P};margin:0 0 20px">📋 My Lab Sessions</h2>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>Experiment</th><th>Subject</th><th>Difficulty</th><th>Status</th><th>Score</th><th>Started</th><th>Actions</th></tr></thead>
          <tbody>
            ${sessions.length ? sessions.map(s => `<tr>
              <td><a href="/school/virtual-lab/session/${s.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(s.exp_title)}</a></td>
              <td>${esc(s.subject||'—')}</td>
              <td>${badge(s.difficulty||'beginner', s.difficulty==='advanced'?'#dc2626':s.difficulty==='intermediate'?'#d97706':'#059669')}</td>
              <td>${badge(s.status, s.status==='graded'?'#059669':s.status==='submitted'?'#d97706':'#4f46e5')}</td>
              <td style="font-weight:700;color:${s.score>0?(s.score>=70?'#059669':'#d97706'):GRAY}">${s.score>0?s.score+'%':'—'}</td>
              <td style="color:${GRAY};font-size:12px">${new Date(s.started_at).toLocaleDateString()}</td>
              <td><a href="/school/virtual-lab/session/${s.id}" style="color:${P};text-decoration:none;font-size:12px">View</a></td>
            </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No lab sessions yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 12: Lab Reports ───────────────────────────────
  app.get('/school/virtual-lab/reports', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    let whereClause = 'WHERE lr.tenant_id=?';
    const params = [tid];
    if (role !== 'admin' && role !== 'teacher') { whereClause += ' AND lr.student_id=?'; params.push(uid); }

    const [reports] = await pool.query(`SELECT lr.*, u.name as student_name, ve.title as exp_title, ve.subject
      FROM lab_reports lr
      LEFT JOIN virtual_lab_sessions vls ON vls.id=lr.session_id
      LEFT JOIN virtual_experiments ve ON ve.id=vls.experiment_id
      ${role!=='admin'&&role!=='teacher'?'':'LEFT JOIN users u ON u.id=lr.student_id'}
      ${whereClause} ORDER BY lr.created_at DESC`, params);

    res.send(renderPage('Lab Reports', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('reports')}
      <h2 style="color:${P};margin:0 0 20px">📊 Lab Reports</h2>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>Title</th>${role==='teacher'||role==='admin'?'<th>Student</th>':''}<th>Experiment</th><th>Status</th><th>Grade</th><th>Submitted</th><th>Actions</th></tr></thead>
          <tbody>
            ${reports.length ? reports.map(r => `<tr>
              <td style="font-weight:600;color:#1f2937">${esc(r.title||'Lab Report')}</td>
              ${role==='teacher'||role==='admin'?`<td>${esc(r.student_name||'—')}</td>`:''}
              <td style="color:${GRAY}">${esc(r.exp_title||'—')}</td>
              <td>${badge(r.status, r.status==='graded'?'#059669':r.status==='submitted'?'#d97706':'#6b7280')}</td>
              <td style="font-weight:700;color:${r.grade?'#059669':GRAY}">${r.grade||'—'}</td>
              <td style="color:${GRAY};font-size:12px">${r.submitted_at?new Date(r.submitted_at).toLocaleDateString():'—'}</td>
              <td><a href="/school/virtual-lab/report/${r.id}" style="color:${P};text-decoration:none;font-size:12px">View</a></td>
            </tr>`).join('') : `<tr><td colspan="${role==='teacher'||role==='admin'?7:6}" style="text-align:center;color:${GRAY};padding:30px">No lab reports found</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 13: Create Lab Report ─────────────────────────
  app.get('/school/virtual-lab/report/create/:sessionId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [session] = await pool.query('SELECT vls.*, ve.title as exp_title, ve.subject FROM virtual_lab_sessions vls JOIN virtual_experiments ve ON ve.id=vls.experiment_id WHERE vls.id=? AND vls.tenant_id=? AND vls.student_id=?', [req.params.sessionId, tid, uid]);
    if (!session[0]) return res.redirect('/school/virtual-lab/my-sessions');

    const s = session[0];
    const data = Array.isArray(s.data_collected) ? s.data_collected : [];

    res.send(renderPage('Create Lab Report', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/virtual-lab/session/${s.id}" style="color:${P};text-decoration:none;font-size:13px">← Back to Session</a>
      <div class="card" style="padding:32px;margin-top:12px">
        <h2 style="color:${P};margin:0 0 20px">📝 Create Lab Report</h2>
        <form method="POST" action="/school/virtual-lab/report/save" style="display:flex;flex-direction:column;gap:16px">
          <input type="hidden" name="session_id" value="${s.id}">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Report Title</label>
            <input type="text" name="title" value="Lab Report: ${esc(s.exp_title)}" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>

          <div class="card" style="background:#f9fafb">
            <h4 style="color:${GRAY};margin:0 0 8px;font-size:13px">📋 Auto-filled from Session</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
              <div><strong>Experiment:</strong> ${esc(s.exp_title)}</div>
              <div><strong>Subject:</strong> ${esc(s.subject)}</div>
            </div>
            ${data.length ? `<div style="margin-top:10px"><strong>Data:</strong></div>
              <table style="margin-top:4px"><thead><tr><th>Label</th><th>Value</th></tr></thead>
                <tbody>${data.map(d => `<tr><td>${esc(d.label)}</td><td>${esc(d.value)}</td></tr>`).join('')}</tbody>
              </table>` : ''}
          </div>

          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Report Content *</label>
            <textarea name="content" rows="12" required placeholder="Write your complete lab report here. Include:
- Introduction
- Methodology
- Results & Data Analysis
- Discussion
- Conclusion" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">${esc(s.observations||s.conclusion?'Observations:\n'+s.observations+'\n\nConclusion:\n'+s.conclusion:'')}</textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button type="submit" name="action" value="draft" class="btn" style="background:${GRAY}">💾 Save Draft</button>
            <button type="submit" name="action" value="submit" class="btn" style="background:#059669">📤 Submit Report</button>
          </div>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 14: Save Lab Report ───────────────────────────
  app.post('/school/virtual-lab/report/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { session_id, title, content, action } = req.body;

    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? 'NOW()' : 'NULL';

    const [existing] = await pool.query('SELECT id FROM lab_reports WHERE tenant_id=? AND session_id=?', [tid, session_id]);

    if (existing.length > 0) {
      await pool.query('UPDATE lab_reports SET title=?, content=?, status=?, submitted_at='+submittedAt+' WHERE id=? AND tenant_id=?',
        [title, content, status, existing[0].id, tid]);
    } else {
      await pool.query('INSERT INTO lab_reports (tenant_id, session_id, student_id, title, content, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, '+submittedAt+')',
        [tid, session_id, uid, title, content, status]);
    }

    audit({ action: action === 'submit' ? 'submit_lab_report' : 'save_lab_report_draft', sessionId: session_id, user: req.session.user });
    res.redirect('/school/virtual-lab/reports');
  }));

  // ─── ROUTE 15: Safety Guide ──────────────────────────────
  app.get('/school/virtual-lab/safety', requireAuth, ah(async (req, res) => {
    const safetyTopics = [
      { title: 'General Lab Safety', icon: '⚠️', items: ['Always follow instructions carefully','Wear appropriate safety equipment','Know the location of emergency exits','Report any accidents immediately','Never eat or drink in the lab area'] },
      { title: 'Chemistry Lab Safety', icon: '🧪', items: ['Wear goggles and gloves when handling chemicals','Never mix unknown chemicals','Always add acid to water, not water to acid','Use fume hoods for volatile substances','Dispose of chemicals properly'] },
      { title: 'Physics Lab Safety', icon: '⚡', items: ['Be careful with electrical equipment','Check for damaged wires before use','Use appropriate shielding for radiation experiments','Secure heavy equipment properly','Follow laser safety protocols'] },
      { title: 'Biology Lab Safety', icon: '🧬', items: ['Use sterile techniques','Dispose of biological waste properly','Wear gloves when handling specimens','Follow biosafety level guidelines','Report any spills of biological material'] }
    ];

    res.send(renderPage('Lab Safety Guide', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('safety')}
      <h2 style="color:${P};margin:0 0 4px">⚠️ Virtual Lab Safety Guide</h2>
      <p style="color:${GRAY};margin:0 0 24px">Even virtual experiments require understanding of safety protocols</p>

      <div class="card" style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:28px">🛡️</span>
          <div>
            <h3 style="color:#92400e;margin:0">Safety First!</h3>
            <p style="color:#92400e;font-size:13px;margin:4px 0 0">Review these safety guidelines before starting any experiment. Even in a virtual environment, understanding safety protocols is essential for real-world applications.</p>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${safetyTopics.map(t => `<div class="card" style="border-top:4px solid #d97706">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:24px">${t.icon}</span>
            <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(t.title)}</h3>
          </div>
          <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:2">
            ${t.items.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>`).join('')}
      </div>

      <div class="card" style="margin-top:20px">
        <h3 style="color:${P};margin:0 0 12px">🆘 Emergency Procedures</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
          ${[
            {icon:'🔥', title:'Fire', desc:'Stop, drop, and roll if clothing catches fire. Use fire extinguisher for small fires.'},
            {icon:'🧪', title:'Chemical Spill', desc:'Alert others, evacuate area, notify teacher. Do not attempt cleanup without training.'},
            {icon:'⚡', title:'Electrical Shock', desc:'Disconnect power source. Do not touch the person. Call emergency services.'},
            {icon:'🩹', title:'First Aid', desc:'Know the location of first aid kit. Apply basic first aid for minor injuries.'}
          ].map(e => `<div style="padding:12px;background:#f9fafb;border-radius:10px;border-left:3px solid #dc2626">
            <span style="font-size:20px">${e.icon}</span>
            <strong style="color:#1f2937;display:block;margin:6px 0 4px">${e.title}</strong>
            <p style="color:${GRAY};font-size:13px;margin:0;line-height:1.5">${e.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 16: Teacher Grade Session ─────────────────────
  app.get('/school/virtual-lab/grade/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [session] = await pool.query('SELECT vls.*, ve.title as exp_title, ve.subject FROM virtual_lab_sessions vls JOIN virtual_experiments ve ON ve.id=vls.experiment_id WHERE vls.id=? AND vls.tenant_id=?', [req.params.id, tid]);
    if (!session[0]) return res.redirect('/school/virtual-lab');
    const s = session[0];

    res.send(renderPage('Grade Session', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 20px">📊 Grade Lab Session</h2>
        <div style="margin-bottom:16px">
          <strong>Experiment:</strong> ${esc(s.exp_title)}<br>
          <strong>Subject:</strong> ${esc(s.subject)}<br>
          <strong>Submitted:</strong> ${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}
        </div>
        ${s.observations ? `<div style="margin-bottom:12px"><h4 style="color:#1f2937;margin:0 0 4px">Observations</h4><div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:13px">${esc(s.observations)}</div></div>` : ''}
        ${s.conclusion ? `<div style="margin-bottom:12px"><h4 style="color:#1f2937;margin:0 0 4px">Conclusion</h4><div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:13px">${esc(s.conclusion)}</div></div>` : ''}
        <form method="POST" action="/school/virtual-lab/grade/${s.id}/save" style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Score (0-100)</label>
            <input type="number" name="score" min="0" max="100" value="${s.score||''}" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Feedback</label>
            <textarea name="feedback" rows="4" placeholder="Provide feedback to the student..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px">${esc(s.feedback||'')}</textarea>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">✅ Submit Grade</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 17: Save Grade ────────────────────────────────
  app.post('/school/virtual-lab/grade/:id/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { score, feedback } = req.body;
    await pool.query('UPDATE virtual_lab_sessions SET score=?, feedback=?, status="graded", graded_at=NOW(), graded_by=? WHERE id=? AND tenant_id=?',
      [parseFloat(score), feedback, uid, req.params.id, tid]);
    audit({ action: 'grade_lab_session', sessionId: req.params.id, score, user: req.session.user });
    res.redirect('/school/virtual-lab/reports');
  }));

};
