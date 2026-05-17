module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_modules (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255) NOT NULL,
        description TEXT, difficulty VARCHAR(20) DEFAULT 'beginner',
        content TEXT, exercises JSONB DEFAULT '[]', prerequisites JSONB DEFAULT '[]',
        tags JSONB DEFAULT '[]', estimated_hours DECIMAL(5,1) DEFAULT 1.0,
        order_index INT DEFAULT 0, status VARCHAR(20) DEFAULT 'published',
        created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_exercises (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, module_id INT REFERENCES qc_modules(id),
        title VARCHAR(255) NOT NULL, description TEXT, initial_state TEXT,
        expected_output TEXT, difficulty VARCHAR(20) DEFAULT 'beginner',
        hints JSONB DEFAULT '[]', test_cases JSONB DEFAULT '[]',
        max_attempts INT DEFAULT 10, points INT DEFAULT 100,
        category VARCHAR(50) DEFAULT 'general', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_submissions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        exercise_id INT REFERENCES qc_exercises(id), solution TEXT,
        correct BOOLEAN DEFAULT false, attempts INT DEFAULT 1,
        score DECIMAL(5,2) DEFAULT 0, submitted_at TIMESTAMPTZ DEFAULT NOW(),
        execution_time_ms INT DEFAULT 0, qasm_output TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_progress (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL UNIQUE,
        modules_completed JSONB DEFAULT '[]', exercises_solved JSONB DEFAULT '[]',
        total_score DECIMAL(8,2) DEFAULT 0, level INT DEFAULT 1,
        xp INT DEFAULT 0, streak_days INT DEFAULT 0, last_activity TIMESTAMPTZ DEFAULT NOW(),
        certificates JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_glossary (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, term VARCHAR(255) NOT NULL,
        definition TEXT, category VARCHAR(50), related_terms JSONB DEFAULT '[]',
        example TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS qc_certificates (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        certificate_type VARCHAR(50), title VARCHAR(255), description TEXT,
        modules_completed JSONB, score_achieved DECIMAL(5,2),
        issued_at TIMESTAMPTZ DEFAULT NOW(), certificate_code VARCHAR(50) UNIQUE
      )`);
      console.log('[Mod] quantum-computing OK');
    } catch(e) { console.warn('[Mod] quantum-computing Warn:', e.message); }
  })();

  const DIFFICULTIES = ['beginner','intermediate','advanced','expert'];
  const CATEGORIES = ['gates','algorithms','simulation','programming','theory','measurement'];

  /* ════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const [modules, exercises, submissions, progress] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM qc_modules WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM qc_exercises WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM qc_submissions WHERE tenant_id=$1 AND student_id=$2 AND correct=true', [tid, req.user_id]),
        pool.query('SELECT * FROM qc_progress WHERE tenant_id=$1 AND student_id=$2', [tid, req.user_id])
      ]);
      const p = progress.rows[0];
      const leaderboard = await pool.query(`SELECT p.student_id, u.name, p.total_score, p.level, p.xp
        FROM qc_progress p JOIN users u ON p.student_id=u.id WHERE p.tenant_id=$1 ORDER BY p.total_score DESC LIMIT 10`, [tid]);
      const rows = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${modules.rows[0].cnt}</div><div style="color:${GRAY}">Learning Modules</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${exercises.rows[0].cnt}</div><div style="color:${GRAY}">Exercises</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#10b981">${submissions.rows[0].cnt}</div><div style="color:${GRAY}">Solved by You</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#f59e0b">Lv.${p?p.level:1}</div><div style="color:${GRAY}">Your Level</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${p?p.xp:0}</div><div style="color:${GRAY}">Total XP</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3 style="margin-top:0">Leaderboard</h3>
            <table><tr><th>#</th><th>Student</th><th>Score</th><th>Level</th><th>XP</th></tr>
            ${leaderboard.rows.map((l,i)=>`<tr><td>${i+1}</td><td>${esc(l.name)}</td><td>${l.total_score}</td><td>Lv.${l.level}</td><td>${l.xp}</td></tr>`).join('')}
            ${leaderboard.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No data yet</td></tr>':''}
            </table>
          </div>
          <div class="card"><h3 style="margin-top:0">Quick Actions</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              <a class="btn" href="/school/quantum-computing/modules" style="text-decoration:none;text-align:center">Browse Modules</a>
              <a class="btn" href="/school/quantum-computing/exercises" style="background:#10b981;text-decoration:none;text-align:center">Practice Exercises</a>
              <a class="btn" href="/school/quantum-computing/simulator" style="background:#8b5cf6;text-decoration:none;text-align:center">Qubit Simulator</a>
              <a class="btn" href="/school/quantum-computing/glossary" style="background:#f59e0b;text-decoration:none;text-align:center">Glossary</a>
              <a class="btn" href="/school/quantum-computing/certificates" style="background:#06b6d4;text-decoration:none;text-align:center">Certificates</a>
              <a class="btn" href="/school/quantum-computing/progress" style="background:#ec4899;text-decoration:none;text-align:center">My Progress</a>
            </div>
          </div>
        </div>`;
      renderPage(req, res, 'Quantum Computing Lab', rows, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 2 — Modules List
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/modules', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { difficulty, search } = req.query;
      let sql = 'SELECT * FROM qc_modules WHERE tenant_id=$1 AND status=$2';
      const params = [req.tenant_id, 'published'];
      let i = 3;
      if (difficulty) { sql += ` AND difficulty=$${i++}`; params.push(difficulty); }
      if (search) { sql += ` AND title ILIKE $${i++}`; params.push(`%${search}%`); }
      sql += ' ORDER BY order_index ASC, created_at DESC';
      const result = await pool.query(sql, params);
      const diffColors = { beginner:'#10b981', intermediate:'#f59e0b', advanced:'#ef4444', expert:'#8b5cf6' };
      const html = `
        <div class="card"><h3 style="margin-top:0">Learning Modules</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search modules..." value="${esc(search||'')}" style="width:200px">
            <select name="difficulty" style="width:150px"><option value="">All Levels</option>${DIFFICULTIES.map(d=>`<option value="${d}" ${difficulty===d?'selected':''}>${d}</option>`).join('')}</select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
            ${result.rows.map(m => `
              <div class="card" style="border-left:4px solid ${diffColors[m.difficulty]||P}">
                <h4>${esc(m.title)}</h4>
                <p style="color:${GRAY};font-size:0.9em">${esc(m.description||'').substring(0,120)}${(m.description||'').length>120?'...':''}</p>
                <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
                  <span style="background:${diffColors[m.difficulty]||P};color:#fff;padding:2px 8px;border-radius:12px;font-size:0.8em">${esc(m.difficulty)}</span>
                  <span style="color:${GRAY};font-size:0.85em">${m.estimated_hours}h</span>
                  <span style="color:${GRAY};font-size:0.85em">${(m.exercises||[]).length} exercises</span>
                </div>
                <a class="btn" href="/school/quantum-computing/modules/${m.id}" style="margin-top:12px;display:block;text-align:center">Start Learning</a>
              </div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center">No modules found</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'QC Modules', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 3 — Module Detail
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/modules/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const mod = await pool.query('SELECT * FROM qc_modules WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!mod.rows[0]) return res.status(404).send('Module not found');
      const m = mod.rows[0];
      const exercises = await pool.query('SELECT * FROM qc_exercises WHERE module_id=$1 AND tenant_id=$2 ORDER BY id', [m.id, req.tenant_id]);
      const mySubs = await pool.query('SELECT exercise_id, correct FROM qc_submissions WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      const solvedSet = new Set(mySubs.rows.filter(s => s.correct).map(s => s.exercise_id));
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(m.title)}</h3>
          <p>${esc(m.description||'')}</p>
          <div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap">
            <span style="background:${P};color:#fff;padding:4px 12px;border-radius:12px">${esc(m.difficulty)}</span>
            <span style="color:${GRAY}">Estimated: ${m.estimated_hours}h</span>
            <span style="color:${GRAY}">Exercises: ${exercises.rows.length} | Solved: ${exercises.rows.filter(e=>solvedSet.has(e.id)).length}</span>
            ${m.prerequisites&&m.prerequisites.length?`<span style="color:${GRAY}">Prerequisites: ${m.prerequisites.map(p=>esc(String(p))).join(', ')}</span>`:''}
          </div>
        </div>
        <div class="card"><h3 style="margin-top:0">Content</h3>
          <div style="background:#f9fafb;padding:20px;border-radius:8px;white-space:pre-wrap;font-family:monospace;font-size:0.9em;max-height:500px;overflow:auto">${esc(m.content||'Content coming soon...')}</div>
        </div>
        <div class="card"><h3 style="margin-top:0">Exercises (${exercises.rows.length})</h3>
          <table><tr><th>#</th><th>Title</th><th>Difficulty</th><th>Points</th><th>Status</th><th>Actions</th></tr>
          ${exercises.rows.map((e,i) => `<tr><td>${i+1}</td><td>${esc(e.title)}</td><td>${esc(e.difficulty)}</td><td>${e.points}</td><td>${solvedSet.has(e.id)?'<span style="color:#10b981">✅ Solved</span>':'—'}</td><td><a class="btn" href="/school/quantum-computing/exercises/${e.id}">Attempt</a></td></tr>`).join('')}
          ${exercises.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No exercises yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, m.title, html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 4 — Create Module (admin)
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/modules/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create QC Module</h3>
        <form method="post" action="/school/quantum-computing/modules/new">
          <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="e.g. Introduction to Qubits"></div>
          <div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="2" placeholder="Brief module description..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Difficulty *</label><select name="difficulty" required>${DIFFICULTIES.map(d=>`<option value="${d}">${d}</option>`).join('')}</select></div>
            <div><label>Est. Hours</label><input name="estimated_hours" type="number" step="0.5" min="0.5" value="2"></div>
            <div><label>Order Index</label><input name="order_index" type="number" min="0" value="0"></div>
          </div>
          <div style="margin-bottom:12px;margin-top:12px"><label>Content (Markdown/HTML) *</label><textarea name="content" rows="10" placeholder="Module content including theory, examples, code..."></textarea></div>
          <div style="margin-bottom:12px"><label>Tags (JSON array)</label><textarea name="tags" rows="1" placeholder='["quantum-gates","superposition"]'></textarea></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Create Module</button> <a class="btn" href="/school/quantum-computing/modules" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New QC Module', html, SKIP, '/school/quantum-computing');
  });

  app.post('/school/quantum-computing/modules/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, difficulty, content, estimated_hours, order_index, tags } = req.body;
      let tagArr = [];
      try { tagArr = JSON.parse(tags || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO qc_modules (tenant_id,title,description,difficulty,content,estimated_hours,order_index,tags,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.tenant_id, title, description, difficulty, content, parseFloat(estimated_hours)||2, parseInt(order_index)||0, JSON.stringify(tagArr), req.user_id]);
      audit(req, 'qc_module_created', { title });
      req.flash('success', 'Module created');
      res.redirect('/school/quantum-computing/modules');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 5 — Exercises List
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/exercises', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { difficulty, category } = req.query;
      let sql = `SELECT e.*, m.title AS module_title FROM qc_exercises e LEFT JOIN qc_modules m ON e.module_id=m.id WHERE e.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (difficulty) { sql += ` AND e.difficulty=$${i++}`; params.push(difficulty); }
      if (category) { sql += ` AND e.category=$${i++}`; params.push(category); }
      sql += ' ORDER BY e.id';
      const result = await pool.query(sql, params);
      const mySubs = await pool.query('SELECT exercise_id, correct, attempts FROM qc_submissions WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      const subMap = {};
      mySubs.rows.forEach(s => { subMap[s.exercise_id] = s; });
      const html = `
        <div class="card"><h3 style="margin-top:0">Quantum Exercises</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="difficulty" style="width:150px"><option value="">All Levels</option>${DIFFICULTIES.map(d=>`<option value="${d}" ${difficulty===d?'selected':''}>${d}</option>`).join('')}</select>
            <select name="category" style="width:150px"><option value="">All Categories</option>${CATEGORIES.map(c=>`<option value="${c}" ${category===c?'selected':''}>${c}</option>`).join('')}</select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <table><tr><th>#</th><th>Title</th><th>Module</th><th>Category</th><th>Difficulty</th><th>Points</th><th>Your Status</th><th>Actions</th></tr>
          ${result.rows.map((e,idx) => {
            const sub = subMap[e.id];
            let status = '—';
            if (sub) status = sub.correct ? '✅ Solved' : `❌ Attempt ${sub.attempts}`;
            return `<tr><td>${idx+1}</td><td>${esc(e.title)}</td><td>${esc(e.module_title||'—')}</td><td>${esc(e.category)}</td><td>${esc(e.difficulty)}</td><td>${e.points}</td><td>${status}</td><td><a class="btn" href="/school/quantum-computing/exercises/${e.id}">Attempt</a></td></tr>`;
          }).join('')}
          ${result.rows.length===0?'<tr><td colspan="8" style="text-align:center;color:'+GRAY+'">No exercises found</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'QC Exercises', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 6 — Exercise Detail & Submit
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/exercises/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const ex = await pool.query(`SELECT e.*, m.title AS module_title FROM qc_exercises e LEFT JOIN qc_modules m ON e.module_id=m.id WHERE e.id=$1 AND e.tenant_id=$2`, [req.params.id, req.tenant_id]);
      if (!ex.rows[0]) return res.status(404).send('Exercise not found');
      const e = ex.rows[0];
      const prevSubs = await pool.query('SELECT * FROM qc_submissions WHERE exercise_id=$1 AND tenant_id=$2 AND student_id=$3 ORDER BY submitted_at DESC LIMIT 5', [e.id, req.tenant_id, req.user_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">${esc(e.title)}</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
            <span style="background:${P};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.85em">${esc(e.difficulty)}</span>
            <span style="background:#f3f4f6;padding:2px 10px;border-radius:12px;font-size:0.85em">${esc(e.category)}</span>
            <span style="color:${GRAY};font-size:0.85em">${e.points} points</span>
            <span style="color:${GRAY};font-size:0.85em">Max attempts: ${e.max_attempts}</span>
          </div>
          <p>${esc(e.description||'')}</p>
        </div>
        <div class="card"><h3 style="margin-top:0">Initial State</h3>
          <pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow:auto;font-family:monospace;font-size:0.9em">${esc(e.initial_state||'// No initial state provided')}</pre>
        </div>
        <div class="card"><h3 style="margin-top:0">Expected Output</h3>
          <pre style="background:#1e1e2e;color:#a6e3a1;padding:16px;border-radius:8px;overflow:auto;font-family:monospace;font-size:0.9em">${esc(e.expected_output||'// Expected output will be compared')}</pre>
        </div>
        ${e.hints&&e.hints.length?`<div class="card"><h3 style="margin-top:0">Hints</h3><ul>${e.hints.map(h=>`<li style="margin-bottom:4px">${esc(h)}</li>`).join('')}</ul></div>`:''}
        <div class="card"><h3 style="margin-top:0">Submit Solution</h3>
          <form method="post" action="/school/quantum-computing/exercises/${e.id}/submit">
            <textarea name="solution" rows="8" placeholder="// Write your quantum circuit here (Qiskit-like syntax)&#10;// Example:&#10;qreg q[2];&#10;creg c[2];&#10;h q[0];&#10;cx q[0], q[1];&#10;measure q -> c;" style="font-family:monospace;background:#1e1e2e;color:#cdd6f4;border-color:#45475a"></textarea>
            <div style="margin-top:12px"><button class="btn" type="submit" style="background:#10b981">Submit Solution</button></div>
          </form>
        </div>
        ${prevSubs.rows.length?`<div class="card"><h3 style="margin-top:0">Previous Submissions</h3>
          <table><tr><th>Submitted</th><th>Result</th><th>Attempts</th><th>Score</th><th>Time</th></tr>
          ${prevSubs.rows.map(s=>`<tr><td>${new Date(s.submitted_at).toLocaleString()}</td><td>${s.correct?'✅ Correct':'❌ Incorrect'}</td><td>${s.attempts}</td><td>${s.score}</td><td>${s.execution_time_ms}ms</td></tr>`).join('')}
          </table></div>`:''}`;
      renderPage(req, res, e.title, html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/quantum-computing/exercises/:id/submit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const exercise = await pool.query('SELECT * FROM qc_exercises WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!exercise.rows[0]) return res.status(404).send('Not found');
      const ex = exercise.rows[0];
      const solution = req.body.solution;
      const startTime = Date.now();
      /* Simulated quantum circuit evaluation */
      let correct = false;
      let score = 0;
      try {
        /* Basic syntax validation and pattern matching for educational simulation */
        const normalizedSolution = solution.toLowerCase().replace(/\s+/g, '');
        const normalizedExpected = (ex.expected_output || '').toLowerCase().replace(/\s+/g, '');
        if (normalizedExpected && normalizedSolution.includes(normalizedExpected)) {
          correct = true;
          score = ex.points || 100;
        } else {
          /* Check for quantum keywords as partial credit */
          const quantumKeywords = ['h gates', 'cx gate', 'measure', 'cnot', 'hadamard', 'pauli', 'toffoli', 'circuit'];
          const found = quantumKeywords.filter(kw => normalizedSolution.includes(kw.replace(/\s/g,'')));
          score = Math.round((found.length / quantumKeywords.length) * (ex.points || 100) * 0.5);
        }
      } catch(_) { score = 0; }
      const execTime = Date.now() - startTime;
      const prevSubs = await pool.query('SELECT attempts FROM qc_submissions WHERE exercise_id=$1 AND tenant_id=$2 AND student_id=$3 ORDER BY submitted_at DESC LIMIT 1', [req.params.id, req.tenant_id, req.user_id]);
      const attempts = (prevSubs.rows[0]?.attempts || 0) + 1;
      await pool.query(`INSERT INTO qc_submissions (tenant_id,student_id,exercise_id,solution,correct,attempts,score,execution_time_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.tenant_id, req.user_id, req.params.id, solution, correct, attempts, score, execTime]);
      /* Update progress */
      if (correct) {
        const xpGain = ex.points || 100;
        await pool.query(`INSERT INTO qc_progress (tenant_id,student_id,total_score,xp,exercises_solved,last_activity)
          VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (tenant_id,student_id)
          SET total_score=qc_progress.total_score+$3, xp=qc_progress.xp+$4,
          exercises_solved=qc_progress.exercises_solved||$5::jsonb, last_activity=NOW()`,
          [req.tenant_id, req.user_id, score, xpGain, JSON.stringify(req.params.id)]);
        queueEmail(req.user_id, 'quantum_exercise_solved', { exercise_title: ex.title, score, xp: xpGain });
      }
      audit(req, 'qc_submission', { exercise_id: req.params.id, correct, attempts, score });
      req.flash(correct ? 'success' : 'error', correct ? `Correct! +${score} points` : `Not quite right. Score: ${score}. Keep trying!`);
      res.redirect('/school/quantum-computing/exercises/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 7 — Qubit Simulator
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/simulator', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Qubit Simulator</h3>
        <p style="color:${GRAY}">Interactive quantum circuit simulator with Qiskit-like syntax.</p>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-top:16px">
          <div>
            <label>Circuit Code</label>
            <textarea id="qc-code" rows="12" style="font-family:monospace;background:#1e1e2e;color:#cdd6f4;border-color:#45475a;margin-top:4px" placeholder="// Quantum Circuit Simulator&#10;// Supported: qreg, creg, h, x, y, z, cx, measure&#10;&#10;qreg q[3];&#10;creg c[3];&#10;h q[0];&#10;cx q[0], q[1];&#10;cx q[1], q[2];&#10;measure q -> c;">// Build your quantum circuit here
qreg q[2]
creg c[2]
h q[0]
cx q[0], q[1]
measure q -> c</textarea>
            <div style="margin-top:8px;display:flex;gap:8px">
              <button class="btn" onclick="runSimulator()" style="background:#10b981">Run Simulation</button>
              <button class="btn" onclick="clearOutput()" style="background:${GRAY}">Clear</button>
            </div>
          </div>
          <div>
            <label>Gate Reference</label>
            <div style="background:#f9fafb;padding:12px;border-radius:8px;font-size:0.85em;margin-top:4px">
              <p><strong>h q[n]</strong> — Hadamard</p>
              <p><strong>x q[n]</strong> — Pauli-X (NOT)</p>
              <p><strong>y q[n]</strong> — Pauli-Y</p>
              <p><strong>z q[n]</strong> — Pauli-Z</p>
              <p><strong>cx q[a], q[b]</strong> — CNOT</p>
              <p><strong>ccx q[a], q[b], q[c]</strong> — Toffoli</p>
              <p><strong>measure q -> c</strong> — Measure</p>
              <p><strong>rz(theta) q[n]</strong> — Rz rotation</p>
            </div>
          </div>
        </div>
      </div>
      <div class="card"><h3 style="margin-top:0">Simulation Output</h3>
        <pre id="qc-output" style="background:#1e1e2e;color:#a6e3a1;padding:16px;border-radius:8px;min-height:150px;font-family:monospace;white-space:pre-wrap">Run a circuit to see results here...</pre>
      </div>
      <script>
      function runSimulator() {
        var code = document.getElementById('qc-code').value;
        var lines = code.split('\\n').filter(l => l.trim() && !l.trim().startsWith('//'));
        var qubits = {};
        var cbits = {};
        var output = [];
        var numQ = 0, numC = 0;
        lines.forEach(function(line) {
          line = line.trim().replace(/;/g, '');
          var m;
          if ((m = line.match(/^qreg\\s+q\\[(\\d+)\\]/i))) { numQ = parseInt(m[1]); for(var i=0;i<numQ;i++) qubits[i]='0'; output.push('Initialized '+numQ+' qubits to |0⟩'); }
          else if ((m = line.match(/^creg\\s+c\\[(\\d+)\\]/i))) { numC = parseInt(m[1]); for(var i=0;i<numC;i++) cbits[i]=0; output.push('Initialized '+numC+' classical bits'); }
          else if ((m = line.match(/^h\\s+q\\[(\\d+)\\]/i))) { output.push('H gate applied to q['+m[1]+'] → Superposition'); }
          else if ((m = line.match(/^x\\s+q\\[(\\d+)\\]/i))) { output.push('X gate (NOT) applied to q['+m[1]+'] → Bit flip'); }
          else if ((m = line.match(/^y\\s+q\\[(\\d+)\\]/i))) { output.push('Y gate applied to q['+m[1]+'] → Phase+bit flip'); }
          else if ((m = line.match(/^z\\s+q\\[(\\d+)\\]/i))) { output.push('Z gate applied to q['+m[1]+'] → Phase flip'); }
          else if ((m = line.match(/^cx\\s+q\\[(\\d+)\\],\\s*q\\[(\\d+)\\]/i))) { output.push('CNOT: q['+m[1]+'] → q['+m[2]+'] → Entanglement'); }
          else if ((m = line.match(/^ccx\\s+q\\[(\\d+)\\],\\s*q\\[(\\d+)\\],\\s*q\\[(\\d+)\\]/i))) { output.push('Toffoli: q['+m[1]+'],q['+m[2]+'] → q['+m[3]+']'); }
          else if ((m = line.match(/^(?:rz|rx|ry)\\s*\\(?\\s*([\\d.]+)\\s*\\)?\\s+q\\[(\\d+)\\]/i))) { output.push(m[1].toUpperCase().charAt(0)+'z rotation ('+m[2]+'π) on q['+m[3]+']'); }
          else if (line.match(/^measure/i)) { output.push('Measurement performed → Collapse to classical state'); }
          else if (line) { output.push('Unknown: ' + line); }
        });
        output.push('\\n--- Simulation Complete ---');
        output.push('Circuit depth: ~' + lines.length);
        output.push('Qubits used: ' + numQ);
        output.push('Classical bits: ' + numC);
        document.getElementById('qc-output').textContent = output.join('\\n');
      }
      function clearOutput() { document.getElementById('qc-output').textContent = 'Cleared. Run a circuit to see results.'; }
      </script>`;
    renderPage(req, res, 'Qubit Simulator', html, SKIP, '/school/quantum-computing');
  });

  /* ════════════════════════════════════════════════
     ROUTE 8 — Glossary
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/glossary', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { search, category } = req.query;
      let sql = 'SELECT * FROM qc_glossary WHERE tenant_id=$1';
      const params = [req.tenant_id];
      let i = 2;
      if (search) { sql += ` AND (term ILIKE $${i++} OR definition ILIKE $${i++})`; params.push(`%${search}%`,`%${search}%`); }
      if (category) { sql += ` AND category=$${i++}`; params.push(category); }
      sql += ' ORDER BY term ASC';
      const result = await pool.query(sql, params);
      const categories = await pool.query('SELECT DISTINCT category FROM qc_glossary WHERE tenant_id=$1 ORDER BY category', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Quantum Computing Glossary</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search terms..." value="${esc(search||'')}" style="width:250px">
            <select name="category" style="width:150px"><option value="">All Categories</option>${categories.rows.map(c=>`<option value="${esc(c.category)}" ${category===c.category?'selected':''}>${esc(c.category)}</option>`).join('')}</select>
            <button class="btn" type="submit">Search</button>
            <a class="btn" href="/school/quantum-computing/glossary/new" style="background:#10b981;text-decoration:none">+ Add Term</a>
          </form>
          <div style="display:grid;gap:12px">
            ${result.rows.map(g => `<div style="background:#f9fafb;padding:16px;border-radius:8px;border-left:4px solid ${P}">
              <h4 style="margin:0 0 4px 0">${esc(g.term)} <span style="color:${GRAY};font-weight:normal;font-size:0.85em">${esc(g.category||'')}</span></h4>
              <p style="margin:0;color:#374151">${esc(g.definition||'')}</p>
              ${g.example?`<p style="margin:4px 0 0 0;color:${GRAY};font-size:0.9em;font-style:italic">Example: ${esc(g.example)}</p>`:''}
              ${g.related_terms&&g.related_terms.length?`<div style="margin-top:4px"><span style="color:${GRAY};font-size:0.8em">Related: ${g.related_terms.map(t=>`<span style="background:#e0e7ff;color:${P};padding:1px 6px;border-radius:8px;margin-right:4px">${esc(t)}</span>`).join('')}</span></div>`:''}
            </div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';text-align:center">No terms found</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'QC Glossary', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/quantum-computing/glossary/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Add Glossary Term</h3>
        <form method="post" action="/school/quantum-computing/glossary/new">
          <div style="margin-bottom:12px"><label>Term *</label><input name="term" required placeholder="e.g. Superposition"></div>
          <div style="margin-bottom:12px"><label>Definition *</label><textarea name="definition" rows="3" required placeholder="Clear definition..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Category</label><input name="category" placeholder="e.g. fundamental"></div>
            <div><label>Related Terms (JSON)</label><input name="related_terms" placeholder='["entanglement","qubit"]'></div>
          </div>
          <div style="margin-top:12px"><label>Example</label><textarea name="example" rows="2" placeholder="Usage example..."></textarea></div>
          <div style="margin-top:16px"><button class="btn" type="submit">Add Term</button> <a class="btn" href="/school/quantum-computing/glossary" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'Add Term', html, SKIP, '/school/quantum-computing');
  });

  app.post('/school/quantum-computing/glossary/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { term, definition, category, related_terms, example } = req.body;
      let rel = [];
      try { rel = JSON.parse(related_terms || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO qc_glossary (tenant_id,term,definition,category,related_terms,example) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.tenant_id, term, definition, category, JSON.stringify(rel), example]);
      audit(req, 'qc_glossary_added', { term });
      req.flash('success', 'Term added');
      res.redirect('/school/quantum-computing/glossary');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 9 — Student Progress
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/progress', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const prog = await pool.query('SELECT * FROM qc_progress WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      const p = prog.rows[0];
      const submissions = await pool.query(`SELECT s.*, e.title AS exercise_title, e.difficulty
        FROM qc_submissions s JOIN qc_exercises e ON s.exercise_id=e.id
        WHERE s.tenant_id=$1 AND s.student_id=$2 ORDER BY s.submitted_at DESC LIMIT 20`, [req.tenant_id, req.user_id]);
      const levelXp = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5500, 7500, 10000];
      const currentLevelXp = levelXp[Math.min((p?.level || 1) - 1, levelXp.length - 1)] || 0;
      const nextLevelXp = levelXp[Math.min(p?.level || 1, levelXp.length - 1)] || 99999;
      const xpProgress = Math.min(100, Math.round(((p?.xp || 0) - currentLevelXp) / (nextLevelXp - currentLevelXp) * 100));
      const html = `
        <div class="card"><h3 style="margin-top:0">My Quantum Progress</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:20px">
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:${P}">Level ${p?.level||1}</div><div style="color:${GRAY}">Current Level</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#f59e0b">${p?.xp||0} XP</div><div style="color:${GRAY}">Total XP</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#10b981">${p?.total_score||0}</div><div style="color:${GRAY}">Total Score</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#8b5cf6">${(p?.exercises_solved||[]).length}</div><div style="color:${GRAY}">Solved</div></div>
            <div style="text-align:center"><div style="font-size:1.5em;font-weight:bold;color:#ec4899">${p?.streak_days||0}</div><div style="color:${GRAY}">Day Streak</div></div>
          </div>
          <div style="margin-bottom:16px"><label>Level Progress (${xpProgress}%)</label>
            <div style="background:#e5e7eb;border-radius:8px;height:20px;overflow:hidden;margin-top:4px"><div style="background:${P};height:100%;width:${xpProgress}%;border-radius:8px;transition:width 0.3s"></div></div>
          </div>
        </div>
        <div class="card"><h3 style="margin-top:0">Recent Submissions</h3>
          <table><tr><th>Exercise</th><th>Difficulty</th><th>Result</th><th>Score</th><th>Attempts</th><th>Date</th></tr>
          ${submissions.rows.map(s=>`<tr><td>${esc(s.exercise_title)}</td><td>${esc(s.difficulty)}</td><td>${s.correct?'✅':'❌'}</td><td>${s.score}</td><td>${s.attempts}</td><td>${new Date(s.submitted_at).toLocaleDateString()}</td></tr>`).join('')}
          ${submissions.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No submissions yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'My Progress', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 10 — Certificates
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/certificates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const certs = await pool.query('SELECT * FROM qc_certificates WHERE tenant_id=$1 AND student_id=$2 ORDER BY issued_at DESC', [req.tenant_id, req.user_id]);
      const allCerts = await pool.query('SELECT c.*, u.name AS student_name FROM qc_certificates c JOIN users u ON c.student_id=u.id WHERE c.tenant_id=$1 ORDER BY c.issued_at DESC LIMIT 20', [req.tenant_id]);
      const isStudent = req.user_role === 'student';
      const html = `
        <div class="card"><h3 style="margin-top:0">${isStudent?'My':'All'} Certificates</h3>
          <table><tr><th>Type</th><th>Title</th><th>${isStudent?'Issued':'Student'}</th><th>Score</th><th>Code</th></tr>
          ${(isStudent?certs:allCerts).rows.map(c=>`<tr><td>${esc(c.certificate_type||'completion')}</td><td>${esc(c.title)}</td><td>${isStudent?new Date(c.issued_at).toLocaleDateString():esc(c.student_name)}</td><td>${c.score_achieved||'—'}</td><td style="font-family:monospace;font-size:0.85em">${esc(c.certificate_code||'—')}</td></tr>`).join('')}
          ${(isStudent?certs:allCerts).rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No certificates yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Certificates', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 11 — Leaderboard
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/leaderboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const lb = await pool.query(`SELECT p.*, u.name, u.avatar_url
        FROM qc_progress p JOIN users u ON p.student_id=u.id
        WHERE p.tenant_id=$1 ORDER BY p.total_score DESC LIMIT 50`, [req.tenant_id]);
      const medals = ['🥇','🥈','🥉'];
      const html = `
        <div class="card"><h3 style="margin-top:0">Quantum Computing Leaderboard</h3>
          <table><tr><th>Rank</th><th>Student</th><th>Level</th><th>Score</th><th>XP</th><th>Exercises Solved</th><th>Streak</th></tr>
          ${lb.rows.map((l,i) => `<tr style="${l.student_id===req.user_id?'background:#f0f0ff':''}">
            <td>${i<3?medals[i]:(i+1)}</td><td>${esc(l.name)}</td><td>Lv.${l.level}</td><td>${l.total_score}</td><td>${l.xp}</td><td>${(l.exercises_solved||[]).length}</td><td>${l.streak_days||0}d</td></tr>`).join('')}
          ${lb.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No rankings yet</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Leaderboard', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 12 — Admin: Create Exercise
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/exercises/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const modules = await pool.query('SELECT id,title FROM qc_modules WHERE tenant_id=$1 AND status=$2 ORDER BY title', [req.tenant_id, 'published']);
      const html = `
        <div class="card"><h3 style="margin-top:0">Create Exercise</h3>
          <form method="post" action="/school/quantum-computing/exercises/new">
            <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="e.g. Create a Bell State"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Module *</label><select name="module_id" required><option value="">Select...</option>${modules.rows.map(m=>`<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></div>
              <div><label>Category</label><select name="category">${CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Difficulty</label><select name="difficulty">${DIFFICULTIES.map(d=>`<option value="${d}">${d}</option>`).join('')}</select></div>
              <div><label>Points</label><input name="points" type="number" value="100" min="10"></div>
              <div><label>Max Attempts</label><input name="max_attempts" type="number" value="10" min="1"></div>
            </div>
            <div style="margin-top:12px"><label>Description</label><textarea name="description" rows="3" placeholder="What the student needs to do..."></textarea></div>
            <div style="margin-top:12px"><label>Initial State</label><textarea name="initial_state" rows="4" style="font-family:monospace" placeholder="Starting circuit code..."></textarea></div>
            <div style="margin-top:12px"><label>Expected Output</label><textarea name="expected_output" rows="4" style="font-family:monospace" placeholder="Expected result..."></textarea></div>
            <div style="margin-top:12px"><label>Hints (JSON array)</label><textarea name="hints" rows="2" placeholder='["Use the Hadamard gate first","Apply CNOT for entanglement"]'></textarea></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Create Exercise</button> <a class="btn" href="/school/quantum-computing/exercises" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'New Exercise', html, SKIP, '/school/quantum-computing');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/quantum-computing/exercises/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, module_id, category, difficulty, points, max_attempts, description, initial_state, expected_output, hints } = req.body;
      let hintArr = [];
      try { hintArr = JSON.parse(hints || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO qc_exercises (tenant_id,module_id,title,description,initial_state,expected_output,difficulty,hints,points,max_attempts,category)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.tenant_id, parseInt(module_id), title, description, initial_state, expected_output, difficulty, JSON.stringify(hintArr), parseInt(points)||100, parseInt(max_attempts)||10, category]);
      audit(req, 'qc_exercise_created', { title });
      req.flash('success', 'Exercise created');
      res.redirect('/school/quantum-computing/exercises');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     API: Progress summary
     ════════════════════════════════════════════════ */
  app.get('/school/quantum-computing/api/progress', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const prog = await pool.query('SELECT * FROM qc_progress WHERE tenant_id=$1 AND student_id=$2', [req.tenant_id, req.user_id]);
      res.json({ ok: true, progress: prog.rows[0] || null });
    } catch(e) { ah(e, req, res, true); }
  });
};
