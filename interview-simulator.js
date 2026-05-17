// ============================================================
// INTERVIEW SIMULATOR MODULE
// Mock interview practice, question bank by industry,
// AI feedback scoring, behavioral questions, technical questions,
// STAR method training, interview scheduling, peer practice,
// performance analytics, interview tips library
// ============================================================
// Tables: interview_questions, interview_sessions, interview_feedback
// Prefix: /school/interview-simulator
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
  const diffColor = (d) => d === 'easy' ? '#059669' : d === 'medium' ? '#d97706' : '#dc2626';
  const scoreBar = (pct, label) => {
    const c = scoreColor(pct);
    return '<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>' + esc(label) + '</span><span style="color:' + c + ';font-weight:600">' + Math.round(pct) + '%</span></div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="background:' + c + ';height:100%;width:' + pct + '%;border-radius:6px"></div></div></div>';
  };

  // ── Nav helper ──────────────────────────────────────────
  function nav(active) {
    const links = [
      { href: '/school/interview-simulator', label: 'Dashboard', key: 'dash' },
      { href: '/school/interview-simulator/questions', label: 'Question Bank', key: 'qb' },
      { href: '/school/interview-simulator/practice', label: 'Practice', key: 'practice' },
      { href: '/school/interview-simulator/sessions', label: 'Sessions', key: 'sessions' },
      { href: '/school/interview-simulator/peer', label: 'Peer Practice', key: 'peer' },
      { href: '/school/interview-simulator/tips', label: 'Tips Library', key: 'tips' },
      { href: '/school/interview-simulator/analytics', label: 'Analytics', key: 'analytics' }
    ];
    return '<nav style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px">' +
      links.map(l => '<a href="' + l.href + '" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;' + (active === l.key ? 'background:' + P + ';color:#fff' : 'color:' + GRAY + ';background:#f3f4f6') + '">' + l.label + '</a>').join('') + '</nav>';
  }

  // ── DB Migration ────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS interview_questions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        category TEXT NOT NULL DEFAULT 'behavioral',
        difficulty TEXT NOT NULL DEFAULT 'medium',
        question_text TEXT NOT NULL,
        ideal_answer TEXT DEFAULT '',
        tips TEXT DEFAULT '',
        industry TEXT DEFAULT '',
        times_asked INTEGER DEFAULT 0,
        avg_score NUMERIC(5,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS interview_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL,
        question_ids JSONB DEFAULT '[]',
        answers JSONB DEFAULT '[]',
        scores JSONB DEFAULT '{}',
        feedback TEXT DEFAULT '',
        duration_min INTEGER DEFAULT 0,
        session_date DATE DEFAULT CURRENT_DATE,
        session_type TEXT DEFAULT 'self',
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS interview_feedback (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        session_id INTEGER REFERENCES interview_sessions(id),
        evaluator_id INTEGER DEFAULT 0,
        criteria_scores JSONB DEFAULT '{}',
        overall_score NUMERIC(5,2) DEFAULT 0,
        strengths TEXT DEFAULT '',
        improvements TEXT DEFAULT '',
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      const idxs = [
        'idx_iq_tenant ON interview_questions(tenant_id)',
        'idx_iq_category ON interview_questions(tenant_id, category)',
        'idx_iq_industry ON interview_questions(tenant_id, industry)',
        'idx_iq_difficulty ON interview_questions(tenant_id, difficulty)',
        'idx_is_tenant ON interview_sessions(tenant_id)',
        'idx_is_student ON interview_sessions(tenant_id, student_id)',
        'idx_is_date ON interview_sessions(tenant_id, session_date)',
        'idx_if_tenant ON interview_feedback(tenant_id)',
        'idx_if_session ON interview_feedback(tenant_id, session_id)'
      ];
      for (const i of idxs) { try { await pool.query('CREATE INDEX IF NOT EXISTS ' + i); } catch(e) {} }
      console.log('[interview-simulator] OK');
    } catch(e) { console.warn('[interview-simulator] Warn:', e.message); }
  })();

  // ================================================================
  // ROUTE 1: Dashboard
  // ================================================================
  app.get('/school/interview-simulator', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const totalQ = await pool.query('SELECT COUNT(*)::int as cnt FROM interview_questions WHERE tenant_id=$1', [t]);
    const totalS = await pool.query('SELECT COUNT(*)::int as cnt, AVG((scores->\'overall\')::numeric)::numeric(5,1) as avg_score FROM interview_sessions WHERE tenant_id=$1 AND status=$2', [t, 'completed']);
    const byType = await pool.query('SELECT session_type, COUNT(*)::int as cnt FROM interview_sessions WHERE tenant_id=$1 GROUP BY session_type', [t]);
    const recent = await pool.query('SELECT * FROM interview_sessions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5', [t]);

    let recentHtml = '';
    recent.rows.forEach(s => {
      const scores = pj(s.scores, {});
      const overall = pn(scores.overall, 0);
      recentHtml += '<div class="card" style="padding:12px;display:flex;justify-content:space-between;align-items:center"><div><strong>Student #' + s.student_id + '</strong> <span style="color:' + GRAY + ';font-size:13px">— ' + esc(s.session_type) + '</span><br><span style="font-size:12px;color:' + GRAY + '">' + esc(s.session_date) + (s.duration_min ? ' · ' + s.duration_min + ' min' : '') + '</span></div><div style="font-size:18px;font-weight:700;color:' + scoreColor(overall) + '">' + overall + '%</div></div>';
    });

    let typeCards = '';
    const typeLabels = { self: 'Self Practice', peer: 'Peer Review', mock: 'Mock Interview', scheduled: 'Scheduled' };
    const typeColors = { self: P, peer: '#059669', mock: '#d97706', scheduled: '#7c3aed' };
    byType.rows.forEach(r => {
      typeCards += '<div style="background:' + (typeColors[r.session_type] || GRAY) + ';color:#fff;padding:16px;border-radius:10px;text-align:center;min-width:120px"><div style="font-size:22px;font-weight:700">' + r.cnt + '</div><div style="font-size:12px">' + esc(typeLabels[r.session_type] || r.session_type) + '</div></div>';
    });

    const page = renderPage('Interview Simulator', SKIP + nav('dash') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:' + P + '">' + totalQ.rows[0].cnt + '</div><div style="color:' + GRAY + '">Questions</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:#059669">' + totalS.rows[0].cnt + '</div><div style="color:' + GRAY + '">Sessions</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:32px;font-weight:700;color:#d97706">' + (totalS.rows[0].avg_score || 0) + '%</div><div style="color:' + GRAY + '">Avg Score</div></div>' +
      '</div>' +
      (typeCards ? '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">' + typeCards + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Recent Sessions</h4>' + (recentHtml || '<p style="color:' + GRAY + '">No sessions yet</p>') + '</div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Quick Actions</h4><div style="display:flex;flex-direction:column;gap:8px">' +
          '<a href="/school/interview-simulator/practice" class="btn" style="display:block;text-align:center;text-decoration:none">Start Practice</a>' +
          '<a href="/school/interview-simulator/questions/new" class="btn" style="display:block;text-align:center;text-decoration:none;background:#059669">Add Question</a>' +
          '<a href="/school/interview-simulator/tips" class="btn" style="display:block;text-align:center;text-decoration:none;background:#7c3aed">Interview Tips</a>' +
          '<a href="/school/interview-simulator/analytics" class="btn" style="display:block;text-align:center;text-decoration:none;background:#d97706">View Analytics</a>' +
        '</div></div></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 2: Question Bank
  // ================================================================
  app.get('/school/interview-simulator/questions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    let where = 'tenant_id = $1';
    let params = [t];
    let pi = 2;
    if (req.query.category) { where += ' AND category = $' + (pi++); params.push(req.query.category); }
    if (req.query.difficulty) { where += ' AND difficulty = $' + (pi++); params.push(req.query.difficulty); }
    if (req.query.industry) { where += ' AND industry = $' + (pi++); params.push(req.query.industry); }
    if (req.query.search) { where += ' AND question_text ILIKE $' + (pi++); params.push('%' + req.query.search + '%'); }

    const r = await pool.query('SELECT * FROM interview_questions WHERE ' + where + ' ORDER BY created_at DESC LIMIT 100', params);
    let rows = '';
    r.rows.forEach(q => {
      rows += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px"><div style="flex:1">' +
        '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap"><span style="background:#eef2ff;color:' + P + ';padding:2px 10px;border-radius:12px;font-size:12px">' + esc(q.category) + '</span>' +
        '<span style="background:' + diffColor(q.difficulty) + '1a;color:' + diffColor(q.difficulty) + ';padding:2px 10px;border-radius:12px;font-size:12px">' + esc(q.difficulty) + '</span>' +
        (q.industry ? '<span style="background:#f3f4f6;color:' + GRAY + ';padding:2px 10px;border-radius:12px;font-size:12px">' + esc(q.industry) + '</span>' : '') +
        '</div>' +
        '<p style="margin:0 0 4px;font-weight:500">' + esc(q.question_text) + '</p>' +
        '<p style="margin:0;font-size:13px;color:' + GRAY + '">Asked ' + (q.times_asked || 0) + ' times · Avg score: ' + (q.avg_score || 0) + '%</p>' +
        '</div><div style="display:flex;gap:6px"><a href="/school/interview-simulator/questions/edit/' + q.id + '" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>' +
        '<form method="post" action="/school/interview-simulator/questions/delete" style="display:inline"><input type="hidden" name="id" value="' + q.id + '"><button type="submit" class="btn" style="font-size:12px;padding:4px 10px;background:#dc2626">Del</button></form></div></div></div>';
    });

    const page = renderPage('Question Bank', SKIP + nav('qb') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h3>Question Bank (' + r.rows.length + ')</h3>' +
      '<a href="/school/interview-simulator/questions/new" class="btn" style="text-decoration:none">+ Add Question</a></div>' +
      '<form method="get" action="/school/interview-simulator/questions" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
        '<input type="text" name="search" placeholder="Search questions..." value="' + esc(req.query.search || '') + '" style="width:220px">' +
        '<select name="category" style="width:140px"><option value="">All Categories</option><option value="behavioral"' + (req.query.category === 'behavioral' ? ' selected' : '') + '>Behavioral</option><option value="technical"' + (req.query.category === 'technical' ? ' selected' : '') + '>Technical</option><option value="situational"' + (req.query.category === 'situational' ? ' selected' : '') + '>Situational</option><option value="star"' + (req.query.category === 'star' ? ' selected' : '') + '>STAR Method</option></select>' +
        '<select name="difficulty" style="width:120px"><option value="">All Difficulties</option><option value="easy"' + (req.query.difficulty === 'easy' ? ' selected' : '') + '>Easy</option><option value="medium"' + (req.query.difficulty === 'medium' ? ' selected' : '') + '>Medium</option><option value="hard"' + (req.query.difficulty === 'hard' ? ' selected' : '') + '>Hard</option></select>' +
        '<button type="submit" class="btn" style="padding:6px 14px">Filter</button></form>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No questions found</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 3: Create Question
  // ================================================================
  app.get('/school/interview-simulator/questions/new', requireAuth, ah(async (req, res) => {
    const page = renderPage('Add Question', SKIP + nav('qb') +
      '<div class="card"><h3 style="margin:0 0 16px">Add Interview Question</h3>' +
      '<form method="post" action="/school/interview-simulator/questions">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Category</label><select name="category"><option value="behavioral">Behavioral</option><option value="technical">Technical</option><option value="situational">Situational</option><option value="star">STAR Method</option><option value="general">General</option></select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Difficulty</label><select name="difficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label><input type="text" name="industry" placeholder="e.g., Technology, Healthcare"></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Question Text</label><textarea name="question_text" rows="3" required placeholder="Enter the interview question..."></textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Ideal Answer / Key Points</label><textarea name="ideal_answer" rows="4" placeholder="What makes a great answer to this question?"></textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Tips for Students</label><textarea name="tips" rows="3" placeholder="Advice for answering this question well..."></textarea></div>' +
        '<button type="submit" class="btn">Add Question</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/interview-simulator/questions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { category, difficulty, industry, question_text, ideal_answer, tips } = req.body;
    await pool.query('INSERT INTO interview_questions (tenant_id, category, difficulty, industry, question_text, ideal_answer, tips) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, category || 'behavioral', difficulty || 'medium', industry || '', question_text, ideal_answer || '', tips || '']);
    audit('interview_question_created', { category, difficulty, tenant: t });
    res.redirect('/school/interview-simulator/questions');
  }));

  // ================================================================
  // ROUTE 4: Edit Question
  // ================================================================
  app.get('/school/interview-simulator/questions/edit/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM interview_questions WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Question not found');
    const q = r.rows[0];
    const page = renderPage('Edit Question', SKIP + nav('qb') +
      '<div class="card"><h3 style="margin:0 0 16px">Edit Question</h3>' +
      '<form method="post" action="/school/interview-simulator/questions/update">' +
        '<input type="hidden" name="id" value="' + q.id + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Category</label><select name="category">' +
            ['behavioral','technical','situational','star','general'].map(c => '<option value="' + c + '"' + (q.category === c ? ' selected' : '') + '>' + c + '</option>').join('') +
          '</select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Difficulty</label><select name="difficulty">' +
            ['easy','medium','hard'].map(d => '<option value="' + d + '"' + (q.difficulty === d ? ' selected' : '') + '>' + d + '</option>').join('') +
          '</select></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label><input type="text" name="industry" value="' + esc(q.industry || '') + '"></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Question</label><textarea name="question_text" rows="3" required>' + esc(q.question_text) + '</textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Ideal Answer</label><textarea name="ideal_answer" rows="4">' + esc(q.ideal_answer || '') + '</textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Tips</label><textarea name="tips" rows="3">' + esc(q.tips || '') + '</textarea></div>' +
        '<button type="submit" class="btn">Update</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/interview-simulator/questions/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { id, category, difficulty, industry, question_text, ideal_answer, tips } = req.body;
    await pool.query('UPDATE interview_questions SET category=$1, difficulty=$2, industry=$3, question_text=$4, ideal_answer=$5, tips=$6 WHERE id=$7 AND tenant_id=$8',
      [category, difficulty, industry, question_text, ideal_answer || '', tips || '', id, t]);
    audit('interview_question_updated', { id, tenant: t });
    res.redirect('/school/interview-simulator/questions');
  }));

  // ================================================================
  // ROUTE 5: Delete Question
  // ================================================================
  app.post('/school/interview-simulator/questions/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM interview_questions WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('interview_question_deleted', { id: req.body.id, tenant: t });
    res.redirect('/school/interview-simulator/questions');
  }));

  // ================================================================
  // ROUTE 6: Start Practice Session
  // ================================================================
  app.get('/school/interview-simulator/practice', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const categories = ['behavioral', 'technical', 'situational', 'star'];
    const catFilter = req.query.category || '';
    const diffFilter = req.query.difficulty || '';
    let where = 'tenant_id = $1';
    let params = [t];
    let pi = 2;
    if (catFilter) { where += ' AND category = $' + (pi++); params.push(catFilter); }
    if (diffFilter) { where += ' AND difficulty = $' + (pi++); params.push(diffFilter); }
    const questions = await pool.query('SELECT * FROM interview_questions WHERE ' + where + ' ORDER BY RANDOM() LIMIT 5', params);
    let catOptions = categories.map(c => '<option value="' + c + '"' + (catFilter === c ? ' selected' : '') + '>' + c + '</option>').join('');

    let questionCards = '';
    questions.rows.forEach((q, i) => {
      questionCards += '<div class="card" id="q' + i + '"><div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><span style="background:#eef2ff;color:' + P + ';padding:2px 8px;border-radius:10px;font-size:11px">' + esc(q.category) + '</span><span style="color:' + diffColor(q.difficulty) + ';font-size:11px;font-weight:600">' + esc(q.difficulty) + '</span></div>' +
        '<p style="margin:0 0 12px;font-weight:500">' + esc(q.question_text) + '</p>' +
        '<textarea class="answer-field" data-qid="' + q.id + '" rows="4" placeholder="Type your answer here..." style="margin-bottom:8px"></textarea>' +
        (q.tips ? '<div style="background:#fef3c7;padding:8px 12px;border-radius:8px;font-size:13px"><strong>Tip:</strong> ' + esc(q.tips) + '</div>' : '') +
        '</div>';
    });

    const page = renderPage('Practice Interview', SKIP + nav('practice') +
      '<form method="get" action="/school/interview-simulator/practice" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
        '<select name="category" style="width:160px"><option value="">All Categories</option>' + catOptions + '</select>' +
        '<select name="difficulty" style="width:130px"><option value="">Any Difficulty</option><option value="easy"' + (diffFilter === 'easy' ? ' selected' : '') + '>Easy</option><option value="medium"' + (diffFilter === 'medium' ? ' selected' : '') + '>Medium</option><option value="hard"' + (diffFilter === 'hard' ? ' selected' : '') + '>Hard</option></select>' +
        '<button type="submit" class="btn" style="padding:6px 14px">New Questions</button></form>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" id="student_id" value="' + (req.session?.user?.id || 1) + '"></div>' +
        '<div><label style="font-weight:600;display:block;margin-bottom:4px">Session Type</label><select id="session_type"><option value="self">Self Practice</option><option value="mock">Mock Interview</option><option value="scheduled">Scheduled</option></select></div></div>' +
      (questionCards || '<div class="card" style="text-align:center;color:' + GRAY + '">No questions available. <a href="/school/interview-simulator/questions/new">Add some</a></div>') +
      (questions.rows.length ? '<button type="button" onclick="submitSession()" class="btn" style="padding:12px 32px;font-size:16px;display:block;margin:16px auto">Submit Answers</button>' : '') +
      '<div id="result-area"></div>' +
      '<script>function sCol(s){return s>=80?"#059669":s>=60?"#d97706":"#dc2626";}function submitSession(){var studentId=document.getElementById("student_id").value;var type=document.getElementById("session_type").value;var answers=[];document.querySelectorAll(".answer-field").forEach(function(f){answers.push({qid:parseInt(f.dataset.qid),answer:f.value});});fetch("/school/interview-simulator/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({student_id:parseInt(studentId),session_type:type,answers:answers})}).then(function(r){return r.json();}).then(function(d){if(d.success){var s=d.session;var sc=JSON.parse(s.scores);var ov=sc.overall||0;var col=sCol(ov);var h="<div class=\\"card\\" style=\\"border:2px solid #059669\\"><h3 style=\\"color:#059669\\">Session Submitted!</h3>";h+="<p>Overall Score: <strong style=\\"font-size:24px;color:"+col+"\\">"+ov+"%</strong></p>";h+="<p>Duration: "+(s.duration_min||0)+" minutes</p>";h+="<a href=\\"/school/interview-simulator/sessions\\" class=\\"btn\\" style=\\"display:inline-block;text-decoration:none;margin-top:8px\\">View All Sessions</a></div>";document.getElementById("result-area").innerHTML=h;}}).catch(function(e){alert("Error: "+e.message);});}</script>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 7: Submit Session (API)
  // ================================================================
  app.post('/school/interview-simulator/api/sessions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student_id, session_type, answers } = req.body;
    if (!answers || !answers.length) return res.status(400).json({ error: 'No answers provided' });

    const qIds = answers.map(a => a.qid);
    const startTime = new Date();
    const scores = {};
    let totalScore = 0;
    const answerData = [];

    for (const ans of answers) {
      const qR = await pool.query('SELECT * FROM interview_questions WHERE id=$1 AND tenant_id=$2', [ans.qid, t]);
      const q = qR.rows[0];
      if (!q) continue;
      // Simple scoring: presence of answer, word count, key phrase matching
      const answerText = (ans.answer || '').trim();
      const wordCount = answerText.split(/\s+/).filter(Boolean).length;
      let qScore = Math.min(100, Math.round((wordCount / 30) * 50)); // base score from length
      // Bonus for matching ideal answer key phrases
      if (q.ideal_answer) {
        const idealWords = q.ideal_answer.toLowerCase().split(/\s+/);
        const matchCount = idealWords.filter(w => w.length > 4 && answerText.toLowerCase().includes(w)).length;
        qScore = Math.min(100, qScore + Math.round((matchCount / Math.min(idealWords.length, 20)) * 50));
      }
      scores['q_' + ans.qid] = qScore;
      totalScore += qScore;
      answerData.push({ question_id: ans.qid, answer: answerText, score: qScore });
      // Update question stats
      await pool.query('UPDATE interview_questions SET times_asked = times_asked + 1 WHERE id=$1 AND tenant_id=$2', [ans.qid, t]);
    }
    const overall = answers.length > 0 ? Math.round(totalScore / answers.length) : 0;
    scores.overall = overall;
    const endTime = new Date();
    const durationMin = Math.round((endTime - startTime) / 60000) || Math.round(answers.length * 5);

    const r = await pool.query('INSERT INTO interview_sessions (tenant_id, student_id, question_ids, answers, scores, duration_min, session_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, student_id, JSON.stringify(qIds), JSON.stringify(answerData), JSON.stringify(scores), durationMin, session_type || 'self', 'completed']);
    audit('interview_session_created', { student_id, overall, type: session_type, tenant: t });
    res.json({ success: true, session: r.rows[0] });
  }));

  // ================================================================
  // ROUTE 8: Sessions List
  // ================================================================
  app.get('/school/interview-simulator/sessions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.query.student_id;
    let where = 'tenant_id = $1';
    let params = [t];
    if (studentId) { where += ' AND student_id = $2'; params.push(studentId); }
    const r = await pool.query('SELECT * FROM interview_sessions WHERE ' + where + ' ORDER BY created_at DESC LIMIT 50', params);

    let rows = '';
    r.rows.forEach(s => {
      const scores = pj(s.scores, {});
      const overall = pn(scores.overall, 0);
      const answers = pj(s.answers, []);
      const typeLabels = { self: 'Self Practice', peer: 'Peer Review', mock: 'Mock', scheduled: 'Scheduled' };
      rows += '<div class="card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<div><strong>Student #' + s.student_id + '</strong><br><span style="font-size:13px;color:' + GRAY + '">' + esc(typeLabels[s.session_type] || s.session_type) + ' · ' + esc(s.session_date) + ' · ' + (s.duration_min || 0) + ' min · ' + answers.length + ' questions</span></div>' +
        '<div style="display:flex;align-items:center;gap:12px"><div style="text-align:center"><div style="font-size:24px;font-weight:700;color:' + scoreColor(overall) + '">' + overall + '%</div><div style="font-size:11px;color:' + GRAY + '">Overall</div></div>' +
        '<a href="/school/interview-simulator/sessions/' + s.id + '" class="btn" style="font-size:12px;padding:4px 10px">View</a></div></div></div>';
    });

    const page = renderPage('Interview Sessions', SKIP + nav('sessions') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h3>Sessions (' + r.rows.length + ')</h3>' +
        '<form method="get" style="display:flex;gap:8px;align-items:center"><input type="number" name="student_id" placeholder="Student ID" value="' + esc(studentId || '') + '" style="width:130px"><button type="submit" class="btn" style="padding:6px 12px">Filter</button></form></div>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No sessions recorded yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 9: Session Detail
  // ================================================================
  app.get('/school/interview-simulator/sessions/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const sR = await pool.query('SELECT * FROM interview_sessions WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!sR.rows[0]) return res.status(404).send('Session not found');
    const s = sR.rows[0];
    const scores = pj(s.scores, {});
    const answers = pj(s.answers, []);
    const overall = pn(scores.overall, 0);

    let detailHtml = '';
    if (Array.isArray(answers) && answers.length) {
      for (const a of answers) {
        const qR = await pool.query('SELECT question_text, ideal_answer, tips FROM interview_questions WHERE id=$1', [a.question_id]);
        const q = qR.rows[0] || {};
        const sc = pn(a.score || scores['q_' + a.question_id] || 0, 0);
        detailHtml += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><p style="margin:0;flex:1;font-weight:500">' + esc(q.question_text || 'Question #' + a.question_id) + '</p>' +
          '<span style="font-size:18px;font-weight:700;color:' + scoreColor(sc) + '">' + sc + '%</span></div>' +
          '<div style="background:#f9fafb;padding:10px;border-radius:8px;margin-bottom:8px"><strong style="font-size:12px;color:' + GRAY + '">Student Answer:</strong><p style="margin:4px 0 0;font-size:14px">' + esc(a.answer || 'No answer provided') + '</p></div>' +
          (q.ideal_answer ? '<div style="background:#eef2ff;padding:10px;border-radius:8px;margin-bottom:8px"><strong style="font-size:12px;color:' + P + '">Ideal Answer:</strong><p style="margin:4px 0 0;font-size:13px">' + esc(q.ideal_answer) + '</p></div>' : '') +
          '</div>';
      }
    }

    // Feedback from evaluators
    const fbR = await pool.query('SELECT * FROM interview_feedback WHERE tenant_id=$1 AND session_id=$2 ORDER BY submitted_at DESC', [t, req.params.id]);
    let feedbackHtml = '';
    fbR.rows.forEach(f => {
      const cs = pj(f.criteria_scores, {});
      feedbackHtml += '<div class="card"><h5 style="margin:0 0 8px">Evaluator #' + f.evaluator_id + ' — Score: ' + pn(f.overall_score, 0) + '%</h5>';
      for (const [k, v] of Object.entries(cs)) {
        feedbackHtml += scoreBar(pn(v, 0), k);
      }
      feedbackHtml += '<p style="font-size:13px"><strong>Strengths:</strong> ' + esc(f.strengths || 'None noted') + '</p>';
      feedbackHtml += '<p style="font-size:13px"><strong>Improvements:</strong> ' + esc(f.improvements || 'None noted') + '</p></div>';
    });

    const page = renderPage('Session Detail', SKIP + nav('sessions') +
      '<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">' +
        '<div><h2 style="margin:0">Session #' + s.id + '</h2><p style="color:' + GRAY + ';margin:4px 0 0">Student #' + s.student_id + ' · ' + esc(s.session_type) + ' · ' + esc(s.session_date) + ' · ' + (s.duration_min || 0) + ' min</p></div>' +
        '<div style="text-align:center"><div style="font-size:36px;font-weight:700;color:' + scoreColor(overall) + '">' + overall + '%</div><div style="font-size:13px;color:' + GRAY + '">Overall Score</div></div></div>' +
      '<h3 style="margin:16px 0 8px">Questions & Answers</h3>' + detailHtml +
      (feedbackHtml ? '<h3 style="margin:16px 0 8px">Evaluator Feedback</h3>' + feedbackHtml : '') +
      '<div style="margin-top:16px"><a href="/school/interview-simulator/sessions/' + s.id + '/feedback" class="btn" style="text-decoration:none;background:#059669">Add Feedback</a></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 10: Add Feedback
  // ================================================================
  app.get('/school/interview-simulator/sessions/:id/feedback', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const sR = await pool.query('SELECT * FROM interview_sessions WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!sR.rows[0]) return res.status(404).send('Session not found');
    const criteria = ['Clarity', 'Relevance', 'Confidence', 'Structure', 'Depth', 'Communication', 'STAR Usage', 'Overall Impression'];

    let criteriaFields = '';
    criteria.forEach(c => {
      criteriaFields += '<div style="margin-bottom:8px"><label style="font-weight:500;font-size:13px;display:block;margin-bottom:2px">' + esc(c) + ' (0-100)</label><input type="number" name="score_' + c.replace(/\s/g, '_') + '" min="0" max="100" value="50"></div>';
    });

    const page = renderPage('Add Feedback', SKIP + nav('sessions') +
      '<div class="card"><h3 style="margin:0 0 16px">Evaluate Session #' + sR.rows[0].id + '</h3>' +
      '<form method="post" action="/school/interview-simulator/feedback">' +
        '<input type="hidden" name="session_id" value="' + sR.rows[0].id + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">' + criteriaFields + '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Strengths</label><textarea name="strengths" rows="3" placeholder="What did the student do well?"></textarea></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Areas for Improvement</label><textarea name="improvements" rows="3" placeholder="What could be improved?"></textarea></div>' +
        '<button type="submit" class="btn">Submit Feedback</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/interview-simulator/feedback', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { session_id, strengths, improvements } = req.body;
    const criteriaScores = {};
    let total = 0, count = 0;
    for (const key of Object.keys(req.body)) {
      if (key.startsWith('score_')) {
        const name = key.replace('score_', '').replace(/_/g, ' ');
        criteriaScores[name] = pn(req.body[key], 0);
        total += criteriaScores[name];
        count++;
      }
    }
    const overall = count > 0 ? Math.round(total / count) : 0;
    await pool.query('INSERT INTO interview_feedback (tenant_id, session_id, evaluator_id, criteria_scores, overall_score, strengths, improvements) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, session_id, req.session?.user?.id || 0, JSON.stringify(criteriaScores), overall, strengths || '', improvements || '']);
    audit('interview_feedback_submitted', { session_id, overall, tenant: t });
    res.redirect('/school/interview-simulator/sessions/' + session_id);
  }));

  // ================================================================
  // ROUTE 11: Peer Practice Matching
  // ================================================================
  app.get('/school/interview-simulator/peer', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    // Show students with recent sessions for pairing
    const peerData = await pool.query(
      'SELECT student_id, COUNT(*)::int as sessions, AVG((scores->\'overall\')::numeric)::numeric(5,1) as avg_score FROM interview_sessions WHERE tenant_id=$1 GROUP BY student_id ORDER BY student_id LIMIT 30', [t]);
    let peerCards = '';
    peerData.rows.forEach(r => {
      peerCards += '<div class="card" style="padding:12px;cursor:pointer;text-align:center"><div style="font-size:24px;font-weight:700;color:' + P + ';margin-bottom:4px">#' + r.student_id + '</div><div style="font-size:13px;color:' + GRAY + '">' + r.sessions + ' sessions</div><div style="font-size:14px;font-weight:600;color:' + scoreColor(pn(r.avg_score, 0)) + '">' + pn(r.avg_score, 0) + '% avg</div></div>';
    });

    const page = renderPage('Peer Practice', SKIP + nav('peer') +
      '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 8px">Peer Interview Practice</h3><p style="color:' + GRAY + ';margin:0">Pair students for mock interview practice sessions. Students take turns as interviewer and interviewee.</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px">' + peerCards + '</div>' +
      '<div class="card"><h4 style="margin:0 0 12px">Schedule Peer Session</h4>' +
        '<form method="post" action="/school/interview-simulator/peer/schedule">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student 1 (Interviewer)</label><input type="number" name="student1" required min="1"></div>' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student 2 (Interviewee)</label><input type="number" name="student2" required min="1"></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="' + new Date().toISOString().split('T')[0] + '"></div>' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (min)</label><input type="number" name="duration" value="30" min="10" max="120"></div>' +
          '</div>' +
          '<button type="submit" class="btn">Schedule Peer Session</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/interview-simulator/peer/schedule', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student1, student2, date, duration } = req.body;
    if (student1 == student2) return res.status(400).send('Students must be different');
    await pool.query('INSERT INTO interview_sessions (tenant_id, student_id, session_type, session_date, duration_min, status, feedback) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, student1, 'peer', date, pn(duration, 30), 'scheduled', 'Peer session with Student #' + student2]);
    await pool.query('INSERT INTO interview_sessions (tenant_id, student_id, session_type, session_date, duration_min, status, feedback) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [t, student2, 'peer', date, pn(duration, 30), 'scheduled', 'Peer session with Student #' + student1]);
    audit('peer_session_scheduled', { student1, student2, date, tenant: t });
    res.redirect('/school/interview-simulator/peer');
  }));

  // ================================================================
  // ROUTE 12: Interview Tips Library
  // ================================================================
  app.get('/school/interview-simulator/tips', requireAuth, ah(async (req, res) => {
    const tips = [
      { title: 'STAR Method', category: 'Framework', content: 'Structure your behavioral answers: **S**ituation — Set the scene, **T**ask — Describe your responsibility, **A**ction — Explain what you did, **R**esult — Share the outcome with quantifiable results.', icon: '⭐' },
      { title: 'Research the Company', category: 'Preparation', content: 'Before any interview, research the company\'s mission, values, recent news, products, and culture. Reference specific details during the interview to show genuine interest.', icon: '🔍' },
      { title: 'Body Language Matters', category: 'Delivery', content: 'Maintain eye contact, sit up straight, use natural hand gestures, and smile genuinely. Your non-verbal communication is as important as your words.', icon: '👀' },
      { title: 'Answer the "Tell Me About Yourself" Question', category: 'Common Questions', content: 'Structure your answer: Present (current role/studies), Past (relevant experience), Future (why you\'re excited about this opportunity). Keep it to 2 minutes.', icon: '🎤' },
      { title: 'Ask Intelligent Questions', category: 'Strategy', content: 'Always prepare 3-5 questions to ask the interviewer. Examples: "What does success look like in this role?", "How would you describe the team culture?", "What are the biggest challenges ahead?"', icon: '❓' },
      { title: 'Handle Weakness Questions Gracefully', category: 'Common Questions', content: 'Choose a real weakness you\'re actively improving. Share specific steps you\'re taking to overcome it. Avoid clichés like "I\'m a perfectionist."', icon: '💪' },
      { title: 'Practice Out Loud', category: 'Preparation', content: 'Practice your answers out loud, not just in your head. Record yourself to identify filler words, pacing issues, and areas where you ramble. Aim for concise, structured responses.', icon: '🗣️' },
      { title: 'Dress Code Research', category: 'Preparation', content: 'Research the company dress code. When in doubt, overdress slightly. For virtual interviews, ensure professional attire from the waist up and a clean, neutral background.', icon: '👔' },
      { title: 'Quantify Your Achievements', category: 'Strategy', content: 'Use numbers to make your impact tangible: "Increased sales by 25%", "Managed a team of 12", "Reduced processing time by 40%". Numbers are memorable and persuasive.', icon: '📊' },
      { title: 'Follow Up After the Interview', category: 'Post-Interview', content: 'Send a thank-you email within 24 hours. Reference specific topics discussed, reiterate your interest, and add any information you forgot to mention during the interview.', icon: '📧' },
      { title: 'Technical Interview Strategy', category: 'Technical', content: 'Think aloud during technical interviews. Ask clarifying questions. Start with a brute force approach, then optimize. Discuss time/space complexity. Test edge cases.', icon: '💻' },
      { title: 'Manage Interview Anxiety', category: 'Wellness', content: 'Practice deep breathing (4-7-8 technique), arrive early to acclimate, prepare thoroughly, get good sleep the night before, and remember: interviews are a two-way evaluation.', icon: '🧘' }
    ];

    let tipCards = '';
    tips.forEach(tip => {
      const catColors = { 'Framework': P, 'Preparation': '#059669', 'Delivery': '#d97706', 'Common Questions': '#7c3aed', 'Strategy': '#0891b2', 'Post-Interview': '#dc2626', 'Technical': '#2563eb', 'Wellness': '#db2777' };
      const col = catColors[tip.category] || GRAY;
      tipCards += '<div class="card"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><span style="font-size:24px">' + tip.icon + '</span>' +
        '<div><h4 style="margin:0">' + esc(tip.title) + '</h4><span style="font-size:11px;color:' + col + ';font-weight:600;text-transform:uppercase">' + esc(tip.category) + '</span></div></div>' +
        '<p style="margin:0;font-size:14px;line-height:1.6">' + esc(tip.content) + '</p></div>';
    });

    const page = renderPage('Interview Tips Library', SKIP + nav('tips') +
      '<div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,' + P + ',#7c3aed);color:#fff"><h3 style="margin:0 0 8px">Interview Tips & Strategies</h3><p style="margin:0;opacity:0.9">Curated advice to help students ace their interviews</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">' + tipCards + '</div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 13: Analytics Dashboard
  // ================================================================
  app.get('/school/interview-simulator/analytics', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    // Score distribution
    const scoreDist = await pool.query(
      "SELECT CASE WHEN (scores->>'overall')::numeric >= 80 THEN 'A (80+)' WHEN (scores->>'overall')::numeric >= 60 THEN 'B (60-79)' ELSE 'C (<60)' END as grade, COUNT(*)::int as cnt FROM interview_sessions WHERE tenant_id=$1 AND status='completed' GROUP BY grade ORDER BY grade", [t]);
    // Category performance
    const catPerf = await pool.query(
      'SELECT iq.category, AVG(iq.avg_score)::numeric(5,1) as avg_difficulty_score, COUNT(iq.id)::int as q_count FROM interview_questions iq WHERE iq.tenant_id=$1 GROUP BY iq.category ORDER BY avg_difficulty_score DESC', [t]);
    // Top students
    const topStudents = await pool.query(
      "SELECT student_id, AVG((scores->>'overall')::numeric)::numeric(5,1) as avg_score, COUNT(*)::int as sessions, SUM(duration_min)::int as total_min FROM interview_sessions WHERE tenant_id=$1 AND status='completed' GROUP BY student_id ORDER BY avg_score DESC LIMIT 10", [t]);
    // Monthly trend
    const trend = await pool.query(
      "SELECT TO_CHAR(session_date,'YYYY-MM') as month, AVG((scores->>'overall')::numeric)::numeric(5,1) as avg, COUNT(*)::int as cnt FROM interview_sessions WHERE tenant_id=$1 AND status='completed' GROUP BY month ORDER BY month DESC LIMIT 12", [t]);
    // Category usage
    const catUsage = await pool.query('SELECT category, COUNT(*)::int as cnt FROM interview_questions WHERE tenant_id=$1 GROUP BY category', [t]);

    let gradeCards = '';
    const gradeColors = { 'A (80+)': '#059669', 'B (60-79)': '#d97706', 'C (<60)': '#dc2626' };
    scoreDist.rows.forEach(r => {
      gradeCards += '<div style="background:' + (gradeColors[r.grade] || GRAY) + ';color:#fff;padding:20px;border-radius:12px;text-align:center"><div style="font-size:28px;font-weight:700">' + r.cnt + '</div><div style="font-size:14px">' + esc(r.grade) + '</div></div>';
    });

    let studentRows = '';
    topStudents.rows.forEach((r, i) => {
      studentRows += '<tr><td>#' + (i + 1) + '</td><td>Student #' + r.student_id + '</td><td><strong style="color:' + scoreColor(pn(r.avg_score, 0)) + '">' + pn(r.avg_score, 0) + '%</strong></td><td>' + r.sessions + '</td><td>' + (r.total_min || 0) + ' min</td></tr>';
    });

    let catBars = '';
    catUsage.rows.forEach(r => { catBars += '<div style="margin:4px 0"><span style="font-size:13px;display:inline-block;min-width:120px">' + esc(r.category) + '</span><div style="display:inline-block;background:' + P + ';height:20px;border-radius:4px;min-width:10px;width:' + Math.max(10, r.cnt * 3) + 'px;vertical-align:middle"></div><span style="font-size:12px;color:' + GRAY + ';margin-left:6px">' + r.cnt + '</span></div>'; });

    let trendRows = '';
    trend.rows.forEach(r => {
      trendRows += '<tr><td>' + esc(r.month) + '</td><td>' + pn(r.avg, 0) + '%</td><td>' + r.cnt + '</td></tr>';
    });

    const page = renderPage('Interview Analytics', SKIP + nav('analytics') +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">' + (gradeCards || '<div class="card" style="color:' + GRAY + '">No data</div>') + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Score Distribution</h4>' + (gradeCards || '<p style="color:' + GRAY + '">No sessions completed</p>') + '</div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Question Categories</h4>' + catBars + '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Top Performing Students</h4><table><tr><th>#</th><th>Student</th><th>Avg</th><th>Sessions</th><th>Time</th></tr>' + (studentRows || '<tr><td colspan="5" style="text-align:center;color:' + GRAY + '">No data</td></tr>') + '</table></div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Monthly Trend</h4><table><tr><th>Month</th><th>Avg Score</th><th>Sessions</th></tr>' + (trendRows || '<tr><td colspan="3" style="text-align:center;color:' + GRAY + '">No data</td></tr>') + '</table></div>' +
      '</div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 14: API - Seed Default Questions
  // ================================================================
  app.post('/school/interview-simulator/api/seed', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const defaults = [
      { category: 'behavioral', difficulty: 'medium', question_text: 'Tell me about a time when you had to work with a difficult team member. How did you handle the situation?', ideal_answer: 'Use STAR method. Describe the situation, your specific role, actions taken (communication, empathy, finding common ground), and the positive result or lesson learned.', tips: 'Focus on your actions, not blaming others. Show emotional intelligence.' },
      { category: 'behavioral', difficulty: 'easy', question_text: 'Describe a situation where you demonstrated leadership. What was the outcome?', ideal_answer: 'Clearly describe a leadership moment, whether formal or informal. Highlight decision-making, delegation, motivating others, and measurable outcomes.', tips: 'Leadership can be shown in any role. Focus on influence, not just titles.' },
      { category: 'technical', difficulty: 'hard', question_text: 'Explain a complex technical concept to someone without a technical background.', ideal_answer: 'Choose a clear analogy, break the concept into parts, use simple language, check for understanding, and relate it to everyday experience.', tips: 'The key is simplicity. If you can\'t explain it simply, you don\'t understand it well enough.' },
      { category: 'situational', difficulty: 'medium', question_text: 'If you discovered a significant mistake made by a colleague that could impact a project, what would you do?', ideal_answer: 'Address it privately with the colleague first, offer to help fix it, escalate if necessary, and focus on solutions rather than blame.', tips: 'Show integrity, problem-solving, and interpersonal sensitivity.' },
      { category: 'star', difficulty: 'medium', question_text: 'Give me an example of a goal you set and how you achieved it.', ideal_answer: 'STAR: Situation (context), Task (specific goal), Action (steps taken, timeline, resources used), Result (quantifiable outcome, lessons learned).', tips: 'Make your goal SMART (Specific, Measurable, Achievable, Relevant, Time-bound).' },
      { category: 'behavioral', difficulty: 'hard', question_text: 'Tell me about a time you failed. What did you learn from it?', ideal_answer: 'Be honest about the failure, take responsibility, explain what you learned, and describe how you\'ve applied those lessons since.', tips: 'Vulnerability shows maturity. Focus on growth, not the failure itself.' },
      { category: 'technical', difficulty: 'medium', question_text: 'What is your approach to solving a problem you\'ve never encountered before?', ideal_answer: 'Break down the problem, research similar cases, identify constraints, develop hypotheses, test solutions, iterate based on feedback.', tips: 'Show systematic thinking and resourcefulness.' },
      { category: 'situational', difficulty: 'easy', question_text: 'How would you handle multiple deadlines approaching simultaneously?', ideal_answer: 'Prioritize by urgency and importance, communicate with stakeholders about realistic timelines, break work into manageable chunks, and ask for help when needed.', tips: 'Demonstrate time management and communication skills.' },
      { category: 'star', difficulty: 'easy', question_text: 'Describe a time when you went above and beyond what was expected.', ideal_answer: 'STAR format. Show initiative, the extra effort you put in, and the positive impact on the team or project.', tips: 'Choose an example that shows genuine passion, not just overtime work.' },
      { category: 'behavioral', difficulty: 'medium', question_text: 'How do you handle constructive criticism?', ideal_answer: 'Listen actively, ask clarifying questions, thank the person, reflect on the feedback, and implement changes. Show a specific example.', tips: 'Show openness to growth. Mention a time feedback actually helped you improve.' }
    ];
    let seeded = 0;
    for (const d of defaults) {
      const exists = await pool.query('SELECT id FROM interview_questions WHERE tenant_id=$1 AND question_text=$2', [t, d.question_text]);
      if (!exists.rows.length) {
        await pool.query('INSERT INTO interview_questions (tenant_id, category, difficulty, question_text, ideal_answer, tips) VALUES ($1,$2,$3,$4,$5,$6)',
          [t, d.category, d.difficulty, d.question_text, d.ideal_answer, d.tips]);
        seeded++;
      }
    }
    audit('interview_questions_seeded', { count: seeded, tenant: t });
    res.json({ success: true, seeded });
  }));

  // ================================================================
  // ROUTE 15: API - Delete Session
  // ================================================================
  app.post('/school/interview-simulator/api/sessions/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM interview_feedback WHERE session_id=$1 AND tenant_id=$2', [req.body.id, t]);
    await pool.query('DELETE FROM interview_sessions WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('interview_session_deleted', { id: req.body.id, tenant: t });
    res.json({ success: true });
  }));
};
