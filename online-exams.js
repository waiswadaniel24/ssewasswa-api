// ============================================================
// ONLINE EXAMS & QUIZZES MODULE — Multi-Tenant SaaS Platform
// Create exams, manage questions with multiple types, take exams
// with real-time timer, auto-grade MCQ, track attempts & results.
// ============================================================
// Usage in server.js:
//   const onlineExams = require('./online-exams');
//   onlineExams(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const formatDuration = (mins) => {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function examStatusBadge(exam) {
  const now = new Date();
  if (exam.is_published) {
    if (exam.end_date && new Date(exam.end_date) < now) {
      return `<span class="badge" style="background:#f1f5f9;color:#64748b">Expired</span>`;
    }
    if (exam.start_date && new Date(exam.start_date) > now) {
      return `<span class="badge" style="background:#fef3c7;color:#b45309">Scheduled</span>`;
    }
    return `<span class="badge" style="background:#dcfce7;color:#16a34a">Published</span>`;
  }
  return `<span class="badge" style="background:#e2e8f0;color:#64748b">Draft</span>`;
}

function questionTypeBadge(type) {
  const map = {
    multiple_choice: { bg: '#dbeafe', c: '#1d4ed8', icon: '🔘', label: 'MCQ' },
    true_false: { bg: '#fef3c7', c: '#b45309', icon: '✅', label: 'True/False' },
    short_answer: { bg: '#f3e8ff', c: '#7c3aed', icon: '✏️', label: 'Short Answer' },
    fill_blank: { bg: '#ecfdf5', c: '#059669', icon: '📝', label: 'Fill in Blank' },
    essay: { bg: '#fff7ed', c: '#ea580c', icon: '📄', label: 'Essay' }
  };
  const s = map[type] || map.multiple_choice;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.icon} ${s.label}</span>`;
}

function attemptStatusBadge(status) {
  const map = {
    in_progress: { bg: '#fef3c7', c: '#b45309', label: 'In Progress' },
    submitted: { bg: '#dbeafe', c: '#1d4ed8', label: 'Submitted' },
    graded: { bg: '#dcfce7', c: '#16a34a', label: 'Graded' },
    timed_out: { bg: '#fee2e2', c: '#dc2626', label: 'Timed Out' }
  };
  const s = map[status] || map.submitted;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.label}</span>`;
}

function passFailBadge(score, total, passing) {
  if (total <= 0) return '';
  const pct = (score / total) * 100;
  const passMark = passing || 50;
  const passPct = (passMark / total) * 100;
  if (pct >= passPct) {
    return `<span class="badge" style="background:#dcfce7;color:#16a34a;font-weight:700">PASSED (${pct.toFixed(1)}%)</span>`;
  }
  return `<span class="badge" style="background:#fee2e2;color:#dc2626;font-weight:700">FAILED (${pct.toFixed(1)}%)</span>`;
}

// ============================================================
// SHARED CSS
// ============================================================
const EX_CSS = `<style>
.ex-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.ex-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.ex-nav a:hover{background:#e2e8f0}.ex-nav a.active{background:#4f46e5;color:#fff}
.ex-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.ex-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s}
.ex-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
.ex-card-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px}
.ex-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0}
.ex-card-meta{display:flex;gap:16px;font-size:12px;color:#64748b;margin-bottom:14px}
.ex-card-actions{display:flex;gap:6px;flex-wrap:wrap}
.ex-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.ex-btn:hover{opacity:.9;transform:translateY(-1px)}
.ex-btn-primary{background:#4f46e5;color:#fff}.ex-btn-success{background:#059669;color:#fff}
.ex-btn-danger{background:#fee2e2;color:#dc2626}.ex-btn-warning{background:#fef3c7;color:#b45309}
.ex-btn-secondary{background:#f1f5f9;color:#475569}.ex-btn-sm{padding:5px 12px;font-size:11px;border-radius:8px}
.ex-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.ex-form input,.ex-form select,.ex-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.ex-form input:focus,.ex-form select:focus,.ex-form textarea:focus{outline:none;border-color:#6366f1}
.ex-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ex-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.ex-timer{position:fixed;top:80px;right:20px;z-index:100;background:#1e293b;color:#fff;padding:12px 20px;border-radius:14px;font-size:22px;font-weight:800;font-family:monospace;box-shadow:0 4px 20px rgba(0,0,0,.2)}
.ex-timer.warning{background:#dc2626;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
.ex-sidebar{position:sticky;top:20px;max-height:70vh;overflow-y:auto}
.ex-qnav-item{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;font-size:13px;cursor:pointer;transition:.15s;margin-bottom:4px;border:2px solid transparent}
.ex-qnav-item:hover{background:#f1f5f9}
.ex-qnav-item.active{background:#eef2ff;border-color:#4f46e5;color:#4f46e5;font-weight:700}
.ex-qnav-item.answered{background:#dcfce7;border-color:#86efac;color:#16a34a}
.ex-progress{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-bottom:20px}
.ex-progress-bar{height:100%;background:linear-gradient(90deg,#4f46e5,#818cf8);border-radius:4px;transition:width .3s}
.ex-question-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px;margin-bottom:16px}
.ex-option{display:flex;align-items:center;gap:10px;padding:12px 16px;border:2px solid #e2e8f0;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:.15s;font-size:14px}
.ex-option:hover{border-color:#a5b4fc;background:#eef2ff}
.ex-option input[type="radio"]{accent-color:#4f46e5;width:18px;height:18px}
.ex-score-ring{width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;margin:0 auto}
.ex-table{width:100%;border-collapse:collapse;font-size:13px}
.ex-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.ex-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.ex-table tr:hover{background:#f8fafc}
.ex-result-bar{height:20px;border-radius:6px;min-width:2px;transition:width .3s}
@media(max-width:768px){.ex-grid,.ex-grid-3{grid-template-columns:1fr}.ex-cards{grid-template-columns:1fr}.ex-timer{position:static;margin-bottom:16px}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function onlineExams(app, db, pool, renderPage, esc) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS exams (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL, description TEXT, subject VARCHAR(100),
      duration_minutes INTEGER DEFAULT 60, total_marks INTEGER DEFAULT 100, passing_marks INTEGER DEFAULT 50,
      instructions TEXT, is_published BOOLEAN DEFAULT false, shuffle_questions BOOLEAN DEFAULT false,
      show_results BOOLEAN DEFAULT true, allow_retry BOOLEAN DEFAULT false, max_attempts INTEGER DEFAULT 1,
      start_date TIMESTAMPTZ, end_date TIMESTAMPTZ, target_group VARCHAR(50),
      created_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS exam_questions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL, question_type VARCHAR(20) DEFAULT 'multiple_choice',
      options TEXT[], correct_answer TEXT, marks INTEGER DEFAULT 1, explanation TEXT,
      question_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS exam_attempts (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id), user_name VARCHAR(255),
      score NUMERIC(5,2) DEFAULT 0, total_marks NUMERIC(5,2) DEFAULT 0,
      answers JSONB DEFAULT '{}', time_started TIMESTAMPTZ, time_submitted TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'in_progress', attempt_number INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE exams columns
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS subject VARCHAR(100)`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 60`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS total_marks INTEGER DEFAULT 100`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS passing_marks INTEGER DEFAULT 50`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS instructions TEXT`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS show_results BOOLEAN DEFAULT true`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS allow_retry BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS target_group VARCHAR(50)`,
    `ALTER TABLE IF EXISTS exams ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)`,
    // ALTER TABLE exam_questions columns
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS question_text TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) DEFAULT 'multiple_choice'`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS options TEXT[]`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS correct_answer TEXT`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS marks INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS explanation TEXT`,
    `ALTER TABLE IF EXISTS exam_questions ADD COLUMN IF NOT EXISTS question_order INTEGER DEFAULT 0`,
    // ALTER TABLE exam_attempts columns
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS user_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS score NUMERIC(5,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS total_marks NUMERIC(5,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS time_started TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS time_submitted TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'in_progress'`,
    `ALTER TABLE IF EXISTS exam_attempts ADD COLUMN IF NOT EXISTS attempt_number INTEGER DEFAULT 1`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_exams_tenant ON exams(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_exams_published ON exams(tenant_id, is_published)`,
    `CREATE INDEX IF NOT EXISTS idx_eq_tenant ON exam_questions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_eq_exam ON exam_questions(exam_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_tenant ON exam_attempts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_exam ON exam_attempts(exam_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_user ON exam_attempts(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_status ON exam_attempts(tenant_id, status)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[Exams] Cannot connect to DB'); return; }
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[Exams] Migrations applied');
    } catch (e) { console.error('[Exams] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  const nav = (active) => `<div class="ex-nav">
    <a href="/exams" class="${active === 'all' ? 'active' : ''}">📝 All Exams</a>
    <a href="/exams/my-results" class="${active === 'results' ? 'active' : ''}">📊 My Results</a>
  </div>`;

  const QUESTION_TYPES = [
    { value: 'multiple_choice', label: 'Multiple Choice' },
    { value: 'true_false', label: 'True / False' },
    { value: 'short_answer', label: 'Short Answer' },
    { value: 'fill_blank', label: 'Fill in the Blank' },
    { value: 'essay', label: 'Essay / Long Answer' }
  ];

  // ============================================================
  // ROUTE 15: GET /exams/my-results — Must be before /:id routes
  // ============================================================
  app.get('/exams/my-results', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const attempts = (await pool.query(
      `SELECT ea.*, e.title as exam_title, e.subject, e.passing_marks, e.total_marks as exam_total,
              e.duration_minutes, e.show_results
       FROM exam_attempts ea
       JOIN exams e ON e.id = ea.exam_id
       WHERE ea.tenant_id=$1 AND ea.user_id=$2 AND ea.status != 'in_progress'
       ORDER BY ea.time_submitted DESC LIMIT 100`, [tid, user.id]
    )).rows;

    const totalExams = new Set(attempts.map(a => a.exam_id)).size;
    const avgScore = attempts.length ? (attempts.reduce((s, a) => s + parseFloat(a.score || 0), 0) / attempts.length).toFixed(1) : 0;
    const passed = attempts.filter(a => parseFloat(a.score || 0) >= (parseFloat(a.exam_total || 100) * (parseFloat(a.passing_marks || 50) / 100))).length;
    const passRate = attempts.length ? Math.round((passed / attempts.length) * 100) : 0;

    const rows = attempts.map(a => {
      const examTotal = parseFloat(a.exam_total || a.total_marks || 100);
      const passMark = parseFloat(a.passing_marks || 50);
      const scoreVal = parseFloat(a.score || 0);
      const pct = examTotal > 0 ? Math.round((scoreVal / examTotal) * 100) : 0;
      const barColor = pct >= (passMark / examTotal * 100) ? '#16a34a' : '#dc2626';
      const dur = a.time_started && a.time_submitted
        ? Math.round((new Date(a.time_submitted) - new Date(a.time_started)) / 60000)
        : null;
      return `<tr>
        <td><a href="/exams/results/${a.exam_id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(a.exam_title)}</a>
          <span class="muted" style="display:block;font-size:11px">${esc(a.subject || '')} · Attempt #${a.attempt_number}</span></td>
        <td>${attemptStatusBadge(a.status)}</td>
        <td style="font-weight:700;color:${barColor}">${scoreVal} / ${examTotal} <span class="muted">(${pct}%)</span></td>
        <td><div style="background:#f1f5f9;border-radius:6px;overflow:hidden;width:80px"><div class="ex-result-bar" style="width:${pct}%;background:${barColor}"></div></div></td>
        <td>${dur !== null ? formatDuration(dur) : '—'}</td>
        <td class="muted">${formatDateTime(a.time_submitted)}</td>
        <td>${a.show_results ? passFailBadge(scoreVal, examTotal, passMark) : '<span class="muted">Hidden</span>'}</td>
      </tr>`;
    }).join('');

    const html = EX_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('results')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 My Exam Results</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track your exam performance and history</p></div>
        <a href="/exams" class="ex-btn ex-btn-primary">📝 Browse Exams</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${totalExams}</div><div class="muted">Exams Taken</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${attempts.length}</div><div class="muted">Total Attempts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgScore}%</div><div class="muted">Avg Score</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${passRate}%</div><div class="muted">Pass Rate</div></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="ex-table">
        <thead><tr><th>Exam</th><th>Status</th><th>Score</th><th>%</th><th>Duration</th><th>Submitted</th><th>Result</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No exam attempts yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('My Exam Results', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /exams/take/:id — Take Exam (before /:id)
  // ============================================================
  app.get('/exams/take/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam || !exam.is_published) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Exam not found or not published</h2><a href="/exams" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    }
    // Check availability window
    const now = new Date();
    if (exam.start_date && new Date(exam.start_date) > now) {
      return res.send(renderPage('Not Available', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#b45309">This exam is not yet open</h2><p class="muted">Starts: ' + formatDate(exam.start_date) + '</p><a href="/exams" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    }
    if (exam.end_date && new Date(exam.end_date) < now) {
      return res.send(renderPage('Expired', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">This exam has expired</h2><a href="/exams" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    }
    // Check attempt limits
    const prevAttempts = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM exam_attempts WHERE exam_id=$1 AND user_id=$2 AND tenant_id=$3`,
      [examId, user.id, tid]
    )).rows[0].cnt;
    if (prevAttempts >= exam.max_attempts && !exam.allow_retry) {
      return res.send(renderPage('Limit Reached', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Maximum attempts reached</h2><p class="muted">You have used all ' + exam.max_attempts + ' attempt(s)</p><a href="/exams" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    }
    // Check for in-progress attempt
    const existingAttempt = (await pool.query(
      `SELECT * FROM exam_attempts WHERE exam_id=$1 AND user_id=$2 AND tenant_id=$3 AND status='in_progress' ORDER BY id DESC LIMIT 1`,
      [examId, user.id, tid]
    )).rows[0];

    let questions = (await pool.query(
      `SELECT * FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2 ORDER BY question_order, id`,
      [examId, tid]
    )).rows;
    if (exam.shuffle_questions) questions = questions.sort(() => Math.random() - 0.5);

    let attempt = existingAttempt;
    if (!attempt) {
      const newAttempt = (await pool.query(
        `INSERT INTO exam_attempts (tenant_id, exam_id, user_id, user_name, time_started, status, attempt_number, answers)
         VALUES ($1,$2,$3,$4,NOW(),'in_progress',$5,'{}'::jsonb) RETURNING *`,
        [tid, examId, user.id, user.name || user.email, prevAttempts + 1]
      )).rows[0];
      attempt = newAttempt;
    }

    const savedAnswers = attempt.answers || {};
    const answeredCount = Object.keys(savedAnswers).length;
    const progressPct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

    // Calculate remaining time
    const elapsed = attempt.time_started ? Math.floor((now - new Date(attempt.time_started)) / 1000) : 0;
    const totalSeconds = (exam.duration_minutes || 60) * 60;
    const remaining = Math.max(0, totalSeconds - elapsed);

    const questionCards = questions.map((q, i) => {
      const idx = String(i);
      const isAnswered = savedAnswers[idx] !== undefined && savedAnswers[idx] !== '';
      const navClass = isAnswered ? 'answered' : '';
      let optionsHtml = '';
      if (q.question_type === 'multiple_choice') {
        const opts = Array.isArray(q.options) ? q.options : [];
        optionsHtml = opts.map((o, oi) => {
          const letter = String.fromCharCode(65 + oi);
          const checked = savedAnswers[idx] === letter ? 'checked' : '';
          return `<label class="ex-option"><input type="radio" name="q_${idx}" value="${letter}" ${checked}> <strong>${letter}.</strong> ${esc(o)}</label>`;
        }).join('');
      } else if (q.question_type === 'true_false') {
        optionsHtml = ['true', 'false'].map(v => {
          const checked = savedAnswers[idx] === v ? 'checked' : '';
          return `<label class="ex-option"><input type="radio" name="q_${idx}" value="${v}" ${checked}> <strong>${v === 'true' ? 'True' : 'False'}</strong></label>`;
        }).join('');
      } else if (q.question_type === 'short_answer' || q.question_type === 'fill_blank') {
        optionsHtml = `<textarea name="q_${idx}" rows="3" placeholder="Type your answer..." style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(savedAnswers[idx] || '')}</textarea>`;
      } else {
        optionsHtml = `<textarea name="q_${idx}" rows="6" placeholder="Write your essay response here..." style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical">${esc(savedAnswers[idx] || '')}</textarea>`;
      }
      return `<div class="ex-question-card" id="question-${i}" style="${i > 0 ? 'display:none' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <span style="font-size:18px;font-weight:800;color:#4f46e5">Question ${i + 1} of ${questions.length}</span>
          <div style="display:flex;gap:8px;align-items:center">
            ${questionTypeBadge(q.question_type)}
            <span class="badge" style="background:#f8fafc;color:#64748b">${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div style="font-size:16px;color:#1e293b;line-height:1.6;margin-bottom:20px;white-space:pre-wrap">${esc(q.question_text)}</div>
        ${optionsHtml}
        <div style="display:flex;justify-content:space-between;margin-top:20px">
          ${i > 0 ? `<button type="button" class="ex-btn ex-btn-secondary" onclick="showQuestion(${i - 1})">← Previous</button>` : '<div></div>'}
          ${i < questions.length - 1
            ? `<button type="button" class="ex-btn ex-btn-primary" onclick="saveAndNext(${i})">Next →</button>`
            : `<button type="button" class="ex-btn ex-btn-success" onclick="confirmSubmit()">Submit Exam</button>`}
        </div>
      </div>`;
    }).join('');

    const qNavItems = questions.map((q, i) => {
      const isAnswered = savedAnswers[String(i)] !== undefined && savedAnswers[String(i)] !== '';
      return `<div class="ex-qnav-item ${isAnswered ? 'answered' : ''}" onclick="showQuestion(${i})" id="qnav-${i}">
        <span style="width:28px;height:28px;border-radius:50%;background:${isAnswered ? '#dcfce7' : '#f1f5f9'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${isAnswered ? '#16a34a' : '#64748b'};flex-shrink:0">${i + 1}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.question_text.substring(0, 40))}${q.question_text.length > 40 ? '...' : ''}</span>
      </div>`;
    }).join('');

    const html = EX_CSS + `<div style="max-width:1100px;margin:0 auto">
      <div class="ex-timer" id="exam-timer">${formatTimerSeconds(remaining)}</div>
      <div style="margin-bottom:16px">
        <a href="/exams" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Exams</a>
      </div>
      <div class="card" style="padding:16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:20px;color:#1e293b;margin:0">${esc(exam.title)}</h1>
            <p class="muted" style="font-size:13px;margin-top:4px">${esc(exam.subject || '')} · ${formatDuration(exam.duration_minutes)} · ${questions.length} questions</p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge" style="background:#eef2ff;color:#4f46e5">Attempt #${attempt.attempt_number}</span>
            <button class="ex-btn ex-btn-danger ex-btn-sm" onclick="confirmSubmit()">Submit</button>
          </div>
        </div>
        <div class="ex-progress" style="margin-top:12px"><div class="ex-progress-bar" id="progress-bar" style="width:${progressPct}%"></div></div>
        <div class="muted" style="font-size:12px">${answeredCount} of ${questions.length} answered (${progressPct}%)</div>
      </div>
      ${exam.instructions ? `<div class="alert" style="padding:14px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;margin-bottom:16px;font-size:13px;color:#3730a3"><strong>Instructions:</strong> ${esc(exam.instructions)}</div>` : ''}
      <form id="exam-form" method="POST" action="/exams/submit/${examId}">
        <input type="hidden" name="attempt_id" value="${attempt.id}">
        <div style="display:grid;grid-template-columns:1fr 260px;gap:16px">
          <div id="questions-container">${questionCards}</div>
          <div class="ex-sidebar">
            <div class="card" style="padding:16px">
              <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Question Navigator</h3>
              ${qNavItems}
            </div>
          </div>
        </div>
      </form>
    </div>
    <script>
      let currentQ = 0;
      const totalQ = ${questions.length};
      const timerSeconds = ${remaining};
      let timerInterval;

      function formatTimer(s) {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const el = document.getElementById('exam-timer');
        el.textContent = h > 0
          ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
          : String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        if (s <= 300) el.classList.add('warning'); else el.classList.remove('warning');
        if (s <= 0) { clearInterval(timerInterval); document.getElementById('exam-form').submit(); }
      }
      function startTimer() {
        let left = timerSeconds;
        formatTimer(left);
        timerInterval = setInterval(() => { left--; formatTimer(left); }, 1000);
      }

      function showQuestion(idx) {
        for (let i = 0; i < totalQ; i++) {
          const el = document.getElementById('question-' + i);
          const nav = document.getElementById('qnav-' + i);
          if (el) el.style.display = i === idx ? 'block' : 'none';
          if (nav) { nav.classList.remove('active'); if (i === idx) nav.classList.add('active'); }
        }
        currentQ = idx;
        window.scrollTo({ top: 200, behavior: 'smooth' });
        updateProgress();
      }

      function saveAndNext(idx) {
        const radios = document.querySelectorAll('input[name="q_' + idx + '"]');
        const textarea = document.querySelector('textarea[name="q_' + idx + '"]');
        if (radios.length) radios.forEach(r => {
          const nav = document.getElementById('qnav-' + idx);
          if (r.checked && nav) nav.classList.add('answered');
        });
        if (textarea && textarea.value.trim()) {
          const nav = document.getElementById('qnav-' + idx);
          if (nav) nav.classList.add('answered');
        }
        showQuestion(idx + 1);
      }

      function updateProgress() {
        let answered = 0;
        for (let i = 0; i < totalQ; i++) {
          const nav = document.getElementById('qnav-' + i);
          if (nav && nav.classList.contains('answered')) answered++;
        }
        const pct = Math.round((answered / totalQ) * 100);
        document.getElementById('progress-bar').style.width = pct + '%';
      }

      function confirmSubmit() {
        if (confirm('Are you sure you want to submit? You cannot change answers after submission.')) {
          clearInterval(timerInterval);
          document.getElementById('exam-form').submit();
        }
      }

      // Auto-save every 30 seconds
      setInterval(() => {
        const form = document.getElementById('exam-form');
        if (!form) return;
        const fd = new FormData(form);
        fd.append('_autosave', '1');
        fetch('/exams/submit/${examId}', { method: 'POST', body: fd }).catch(() => {});
      }, 30000);

      startTimer();
    </script>
    <script>
      function formatTimerSeconds(s) {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return h > 0
          ? String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
          : String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      }
    </script>`;
    res.send(renderPage('Taking: ' + exam.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /exams/results/:id — View Results for an Exam
  // ============================================================
  app.get('/exams/results/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');

    const attempts = (await pool.query(
      `SELECT ea.* FROM exam_attempts ea WHERE ea.exam_id=$1 AND ea.tenant_id=$2 AND ea.status != 'in_progress'
       ORDER BY ea.time_submitted DESC`, [examId, tid]
    )).rows;

    const totalAttempts = attempts.length;
    const avgScore = attempts.length ? (attempts.reduce((s, a) => s + parseFloat(a.score || 0), 0) / attempts.length).toFixed(1) : 0;
    const examTotal = exam.total_marks || 100;
    const passMark = exam.passing_marks || 50;
    const passed = attempts.filter(a => parseFloat(a.score || 0) >= passMark).length;
    const passRate = attempts.length ? Math.round((passed / totalAttempts) * 100) : 0;
    const highest = attempts.length ? Math.max(...attempts.map(a => parseFloat(a.score || 0))) : 0;

    const rows = attempts.map(a => {
      const pct = examTotal > 0 ? Math.round((parseFloat(a.score || 0) / examTotal) * 100) : 0;
      const barColor = pct >= (passMark / examTotal * 100) ? '#16a34a' : '#dc2626';
      const dur = a.time_started && a.time_submitted
        ? Math.round((new Date(a.time_submitted) - new Date(a.time_started)) / 60000) : null;
      return `<tr>
        <td>${esc(a.user_name || '—')}<span class="muted" style="display:block;font-size:11px">Attempt #${a.attempt_number}</span></td>
        <td>${attemptStatusBadge(a.status)}</td>
        <td style="font-weight:700;color:${barColor}">${parseFloat(a.score || 0)} / ${examTotal}</td>
        <td><div style="display:flex;align-items:center;gap:8px"><div style="background:#f1f5f9;border-radius:6px;overflow:hidden;flex:1"><div class="ex-result-bar" style="width:${pct}%;background:${barColor}"></div></div><span style="font-size:12px;font-weight:600">${pct}%</span></div></td>
        <td>${dur !== null ? formatDuration(dur) : '—'}</td>
        <td class="muted">${formatDateTime(a.time_submitted)}</td>
        <td>${exam.show_results ? passFailBadge(parseFloat(a.score || 0), examTotal, passMark) : '<span class="muted">Hidden</span>'}</td>
      </tr>`;
    }).join('');

    const html = EX_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('')}
      <div style="margin-bottom:16px"><a href="/exams/${examId}" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Exam</a></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📊 Results — ${esc(exam.title)}</h1><p class="muted" style="font-size:13px;margin-top:2px">${esc(exam.subject || '')} · Pass mark: ${passMark}/${examTotal}</p></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${totalAttempts}</div><div class="muted">Total Attempts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${avgScore}</div><div class="muted">Avg Score</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${highest}</div><div class="muted">Highest</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${passRate >= 70 ? '#22c55e' : '#dc2626'}">${passRate}%</div><div class="muted">Pass Rate</div></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="ex-table">
        <thead><tr><th>User</th><th>Status</th><th>Score</th><th>Performance</th><th>Duration</th><th>Submitted</th><th>Result</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No submissions yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Results — ' + exam.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 13: POST /exams/submit/:id — Submit & Auto-Grade
  // ============================================================
  app.post('/exams/submit/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const { attempt_id, _autosave } = req.body;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    const questions = (await pool.query(`SELECT * FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2 ORDER BY question_order, id`, [examId, tid])).rows;

    let attempt;
    if (attempt_id) {
      attempt = (await pool.query(`SELECT * FROM exam_attempts WHERE id=$1 AND exam_id=$2 AND user_id=$3 AND tenant_id=$4 AND status='in_progress'`, [attempt_id, examId, user.id, tid])).rows[0];
    }
    if (!attempt) {
      attempt = (await pool.query(`SELECT * FROM exam_attempts WHERE exam_id=$1 AND user_id=$2 AND tenant_id=$3 AND status='in_progress' ORDER BY id DESC LIMIT 1`, [examId, user.id, tid])).rows[0];
    }
    if (!attempt) return res.redirect('/exams');

    // Collect answers
    const answers = {};
    let score = 0, totalMarks = 0;
    questions.forEach((q, i) => {
      const key = 'q_' + i;
      const answer = req.body[key] || '';
      answers[String(i)] = answer;
      totalMarks += parseInt(q.marks || 1);
      // Auto-grade MCQ and True/False
      if (q.question_type === 'multiple_choice') {
        const opts = Array.isArray(q.options) ? q.options : [];
        const correctLetter = q.correct_answer ? q.correct_answer.toUpperCase() : '';
        const correctIdx = correctLetter ? correctLetter.charCodeAt(0) - 65 : -1;
        if (correctIdx >= 0 && correctIdx < opts.length && answer === correctLetter) {
          score += parseInt(q.marks || 1);
        }
      } else if (q.question_type === 'true_false') {
        if (q.correct_answer && answer.toLowerCase() === q.correct_answer.toLowerCase()) {
          score += parseInt(q.marks || 1);
        }
      }
    });

    // Check time expiry
    const elapsed = attempt.time_started ? (new Date() - new Date(attempt.time_started)) / 1000 : 0;
    const isTimedOut = elapsed > (exam.duration_minutes || 60) * 60;
    const status = isTimedOut ? 'timed_out' : 'graded';

    if (!_autosave) {
      await pool.query(
        `UPDATE exam_attempts SET answers=$1, score=$2, total_marks=$3, time_submitted=NOW(), status=$4 WHERE id=$5`,
        [JSON.stringify(answers), score, totalMarks, status, attempt.id]
      );
      console.log(`[Exams] Exam #${examId} submitted by ${user.email}: ${score}/${totalMarks} (${status})`);
      return res.redirect('/exams/my-results');
    } else {
      // Autosave: update answers but keep status in_progress
      await pool.query(
        `UPDATE exam_attempts SET answers=$1 WHERE id=$2`,
        [JSON.stringify(answers), attempt.id]
      );
      res.setHeader('Content-Type', 'text/plain');
      res.send('autosaved');
    }
  }));

  // ============================================================
  // ROUTE 1: GET /exams — Exam List Dashboard
  // ============================================================
  app.get('/exams', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { filter, subject, search } = req.query;
    let where = ['e.tenant_id=$1'], params = [tid], pi = 2;
    if (filter === 'published') { where.push('e.is_published=true'); }
    else if (filter === 'draft') { where.push('e.is_published=false'); }
    if (subject) { where.push(`e.subject ILIKE $${pi++}`); params.push('%' + subject + '%'); }
    if (search) { where.push(`(e.title ILIKE $${pi} OR e.description ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const exams = (await pool.query(
      `SELECT e.*, (SELECT COUNT(*)::int FROM exam_questions eq WHERE eq.exam_id=e.id) as question_count,
              (SELECT COUNT(*)::int FROM exam_attempts ea WHERE ea.exam_id=e.id AND ea.status != 'in_progress') as attempt_count
       FROM exams e WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC LIMIT 100`, params
    )).rows;

    const published = exams.filter(e => e.is_published).length;
    const drafts = exams.length - published;
    const totalQuestions = exams.reduce((s, e) => s + (e.question_count || 0), 0);
    const avgAttempts = exams.length ? (exams.reduce((s, e) => s + (e.attempt_count || 0), 0) / exams.length).toFixed(1) : 0;

    const subjects = [...new Set(exams.map(e => e.subject).filter(Boolean))];

    const cards = exams.map(e => {
      const qCount = e.question_count || 0;
      return `<div class="ex-card">
        <div class="ex-card-header">
          <div><h3 class="ex-card-title">${esc(e.title)}</h3>
            <p class="muted" style="font-size:12px;margin-top:4px">${esc(e.subject || 'No subject')}</p></div>
          ${examStatusBadge(e)}
        </div>
        ${e.description ? `<p style="font-size:13px;color:#64748b;margin-bottom:12px;line-height:1.5">${esc(e.description.substring(0, 120))}${e.description.length > 120 ? '...' : ''}</p>` : ''}
        <div class="ex-card-meta">
          <span>📝 ${qCount} question${qCount !== 1 ? 's' : ''}</span>
          <span>⏱ ${formatDuration(e.duration_minutes)}</span>
          <span>📊 ${e.attempt_count || 0} attempts</span>
          <span>📅 ${formatDate(e.created_at)}</span>
        </div>
        <div class="ex-card-actions">
          ${e.is_published ? `<a href="/exams/take/${e.id}" class="ex-btn ex-btn-success ex-btn-sm">▶ Take Exam</a>` : ''}
          <a href="/exams/${e.id}" class="ex-btn ex-btn-secondary ex-btn-sm">👁 View</a>
          <a href="/exams/${e.id}/questions" class="ex-btn ex-btn-secondary ex-btn-sm">📝 Questions</a>
          <a href="/exams/${e.id}/edit" class="ex-btn ex-btn-secondary ex-btn-sm">✏️ Edit</a>
          <a href="/exams/results/${e.id}" class="ex-btn ex-btn-secondary ex-btn-sm">📊 Results</a>
          <form method="POST" action="/exams/${e.id}/publish" style="display:inline">
            <input type="hidden" name="publish" value="${e.is_published ? 'false' : 'true'}">
            <button type="submit" class="ex-btn ex-btn-sm ${e.is_published ? 'ex-btn-warning' : 'ex-btn-primary'}">${e.is_published ? 'Unpublish' : 'Publish'}</button>
          </form>
          <form method="POST" action="/exams/${e.id}/delete" style="display:inline" onsubmit="return confirm('Delete this exam permanently?')">
            <button type="submit" class="ex-btn ex-btn-danger ex-btn-sm">Delete</button>
          </form>
        </div>
      </div>`;
    }).join('');

    const html = EX_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('all')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📝 Online Exams & Quizzes</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Create, manage, and take exams</p></div>
        <a href="/exams/new" class="ex-btn ex-btn-primary">+ Create Exam</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${exams.length}</div><div class="muted">Total Exams</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${published}</div><div class="muted">Published</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#94a3b8">${drafts}</div><div class="muted">Drafts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalQuestions}</div><div class="muted">Total Questions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgAttempts}</div><div class="muted">Avg Attempts</div></div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:end">
        <div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Filter</label>
          <select onchange="location.href='/exams?filter='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="">All Exams</option><option value="published" ${filter === 'published' ? 'selected' : ''}>Published</option>
            <option value="draft" ${filter === 'draft' ? 'selected' : ''}>Drafts</option></select></div>
        ${subjects.length ? `<div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Subject</label>
          <select onchange="location.href='/exams?subject='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="">All Subjects</option>${subjects.map(s => `<option value="${esc(s)}" ${subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}
        <div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Search</label>
          <form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="${esc(search || '')}" placeholder="Search exams..." style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;width:220px"><button class="ex-btn ex-btn-secondary" type="submit">Search</button></form></div>
      </div>
      ${exams.length ? `<div class="ex-cards">${cards}</div>`
        : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b;margin-bottom:16px">No exams found</p><a href="/exams/new" class="ex-btn ex-btn-primary">Create Your First Exam</a></div>'}
    </div>`;
    res.send(renderPage('Online Exams', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /exams/new — Create Exam Form
  // ============================================================
  app.get('/exams/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user;
    const html = EX_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('')}
      <a href="/exams" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Exams</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">📝 Create New Exam</h2>
        <p class="muted" style="margin-bottom:24px">Set up exam details, scoring, and scheduling</p>
        <form method="POST" action="/exams/create" class="ex-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Exam Title *</label><input type="text" name="title" required placeholder="e.g., Midterm Mathematics Exam"></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Brief description of this exam..."></textarea></div>
          <div class="ex-grid">
            <div><label>Subject</label><input type="text" name="subject" placeholder="e.g., Mathematics"></div>
            <div><label>Target Group</label>
              <select name="target_group"><option value="">All</option><option value="students">Students</option>
                <option value="teachers">Teachers</option><option value="staff">Staff</option></select></div>
          </div>
          <div class="ex-grid-3">
            <div><label>Duration (minutes)</label><input type="number" name="duration_minutes" value="60" min="5" max="480"></div>
            <div><label>Total Marks</label><input type="number" name="total_marks" value="100" min="1"></div>
            <div><label>Passing Marks</label><input type="number" name="passing_marks" value="50" min="0"></div>
          </div>
          <div class="ex-grid-3">
            <div><label>Max Attempts</label><input type="number" name="max_attempts" value="1" min="1" max="100"></div>
            <div style="display:flex;flex-direction:column;gap:10px;padding-top:24px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer"><input type="checkbox" name="shuffle_questions"> Shuffle questions</label>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;padding-top:24px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer"><input type="checkbox" name="show_results" checked> Show results to users</label>
            </div>
          </div>
          <div class="ex-grid">
            <div><label>Start Date (optional)</label><input type="datetime-local" name="start_date"></div>
            <div><label>End Date (optional)</label><input type="datetime-local" name="end_date"></div>
          </div>
          <div><label>Instructions (shown before exam starts)</label><textarea name="instructions" rows="3" placeholder="e.g., Answer all questions. No electronic devices allowed."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">📝 Create Exam</button>
            <a href="/exams" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Exam', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /exams/create — Save Exam
  // ============================================================
  app.post('/exams/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, subject, duration_minutes, total_marks, passing_marks,
      instructions, shuffle_questions, show_results, allow_retry, max_attempts,
      start_date, end_date, target_group } = req.body;
    if (!title || !title.trim()) return res.redirect('/exams/new');
    await pool.query(
      `INSERT INTO exams (tenant_id, title, description, subject, duration_minutes, total_marks, passing_marks,
        instructions, shuffle_questions, show_results, allow_retry, max_attempts, start_date, end_date, target_group, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tid, title.trim(), (description || '').trim(), (subject || '').trim(),
        parseInt(duration_minutes) || 60, parseInt(total_marks) || 100, parseInt(passing_marks) || 50,
        (instructions || '').trim(), shuffle_questions === 'on', show_results !== 'off',
        allow_retry === 'on', parseInt(max_attempts) || 1,
        start_date || null, end_date || null, (target_group || '').trim(), user.id]
    );
    console.log(`[Exams] Exam created: "${title.trim()}" by ${user.email}`);
    res.redirect('/exams');
  }));

  // ============================================================
  // ROUTE 4: GET /exams/:id — Exam Detail
  // ============================================================
  app.get('/exams/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Exam not found</h2><a href="/exams" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    const questions = (await pool.query(`SELECT * FROM exam_questions WHERE exam_id=$1 ORDER BY question_order, id`, [examId])).rows;
    const totalQMarks = questions.reduce((s, q) => s + (parseInt(q.marks) || 1), 0);
    const typeCounts = {};
    questions.forEach(q => { typeCounts[q.question_type] = (typeCounts[q.question_type] || 0) + 1; });

    const qList = questions.map((q, i) => `<tr>
      <td style="font-weight:600;color:#64748b">${i + 1}</td>
      <td style="max-width:400px">${esc(q.question_text.substring(0, 80))}${q.question_text.length > 80 ? '...' : ''}</td>
      <td>${questionTypeBadge(q.question_type)}</td>
      <td style="font-weight:600">${q.marks || 1}</td>
      <td>${q.explanation ? '✅' : '<span class="muted">None</span>'}</td>
    </tr>`).join('');

    const html = EX_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('')}
      <a href="/exams" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Exams</a>
      <div class="card" style="padding:28px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div><h1 style="font-size:22px;color:#1e293b;margin:0 0 4px">${esc(exam.title)}</h1>
            <p class="muted" style="font-size:13px">${esc(exam.subject || 'No subject')}</p></div>
          ${examStatusBadge(exam)}
        </div>
        ${exam.description ? `<p style="font-size:14px;color:#475569;margin-top:12px;line-height:1.6">${esc(exam.description)}</p>` : ''}
        <div class="ex-grid" style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span class="muted" style="display:block;font-size:11px">Duration</span><strong>${formatDuration(exam.duration_minutes)}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Total Marks</span><strong>${exam.total_marks}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Passing</span><strong>${exam.passing_marks} (${Math.round(exam.passing_marks / exam.total_marks * 100)}%)</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Max Attempts</span><strong>${exam.max_attempts}${exam.allow_retry ? ' (retry allowed)' : ''}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Window</span><strong>${exam.start_date ? formatDate(exam.start_date) : 'Open'} — ${exam.end_date ? formatDate(exam.end_date) : 'No end'}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Questions</span><strong>${questions.length} (${totalQMarks} marks)</strong></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <a href="/exams/${examId}/questions" class="ex-btn ex-btn-primary">📝 Manage Questions</a>
          <a href="/exams/${examId}/edit" class="ex-btn ex-btn-secondary">✏️ Edit Settings</a>
          ${exam.is_published ? `<a href="/exams/take/${examId}" class="ex-btn ex-btn-success">▶ Take Exam</a>` : ''}
          <a href="/exams/results/${examId}" class="ex-btn ex-btn-secondary">📊 Results</a>
          <form method="POST" action="/exams/${examId}/publish" style="display:inline">
            <input type="hidden" name="publish" value="${exam.is_published ? 'false' : 'true'}">
            <button type="submit" class="ex-btn ex-btn-sm ${exam.is_published ? 'ex-btn-warning' : 'ex-btn-primary'}">${exam.is_published ? 'Unpublish' : 'Publish'}</button>
          </form>
        </div>
      </div>
      ${exam.instructions ? `<div class="alert" style="padding:14px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;margin-bottom:16px;font-size:13px;color:#3730a3"><strong>Instructions:</strong> ${esc(exam.instructions)}</div>` : ''}
      <div class="card" style="padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="font-size:15px;color:#1e293b;margin:0">📝 Questions (${questions.length})</h3>
          <div style="display:flex;gap:6px">${Object.entries(typeCounts).map(([t, c]) => questionTypeBadge(t) + ` <span class="muted">${c}</span>`).join(' ')}</div>
        </div>
        ${questions.length ? `<div style="overflow-x:auto"><table class="ex-table">
          <thead><tr><th>#</th><th>Question</th><th>Type</th><th>Marks</th><th>Explanation</th></tr></thead>
          <tbody>${qList}</tbody></table></div>`
          : '<p class="muted" style="text-align:center;padding:20px">No questions yet. <a href="/exams/' + examId + '/questions" style="color:#4f46e5">Add questions</a></p>'}
      </div>
    </div>`;
    res.send(renderPage(exam.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /exams/:id/edit — Edit Exam Settings
  // ============================================================
  app.get('/exams/:id/edit', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    const fmtDate = (d) => d ? new Date(d).toISOString().slice(0, 16) : '';

    const html = EX_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('')}
      <a href="/exams/${examId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Exam</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Exam: ${esc(exam.title)}</h2>
        <p class="muted" style="margin-bottom:24px">Update exam settings and configuration</p>
        <form method="POST" action="/exams/${examId}/update" class="ex-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Exam Title *</label><input type="text" name="title" required value="${esc(exam.title)}"></div>
          <div><label>Description</label><textarea name="description" rows="3">${esc(exam.description || '')}</textarea></div>
          <div class="ex-grid">
            <div><label>Subject</label><input type="text" name="subject" value="${esc(exam.subject || '')}"></div>
            <div><label>Target Group</label>
              <select name="target_group"><option value="">All</option><option value="students" ${exam.target_group === 'students' ? 'selected' : ''}>Students</option>
                <option value="teachers" ${exam.target_group === 'teachers' ? 'selected' : ''}>Teachers</option>
                <option value="staff" ${exam.target_group === 'staff' ? 'selected' : ''}>Staff</option></select></div>
          </div>
          <div class="ex-grid-3">
            <div><label>Duration (minutes)</label><input type="number" name="duration_minutes" value="${exam.duration_minutes}" min="5" max="480"></div>
            <div><label>Total Marks</label><input type="number" name="total_marks" value="${exam.total_marks}" min="1"></div>
            <div><label>Passing Marks</label><input type="number" name="passing_marks" value="${exam.passing_marks}" min="0"></div>
          </div>
          <div class="ex-grid-3">
            <div><label>Max Attempts</label><input type="number" name="max_attempts" value="${exam.max_attempts}" min="1" max="100"></div>
            <div style="display:flex;flex-direction:column;gap:10px;padding-top:24px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer"><input type="checkbox" name="shuffle_questions" ${exam.shuffle_questions ? 'checked' : ''}> Shuffle questions</label>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;padding-top:24px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer"><input type="checkbox" name="show_results" ${exam.show_results ? 'checked' : ''}> Show results</label>
            </div>
          </div>
          <div class="ex-grid">
            <div><label>Start Date</label><input type="datetime-local" name="start_date" value="${fmtDate(exam.start_date)}"></div>
            <div><label>End Date</label><input type="datetime-local" name="end_date" value="${fmtDate(exam.end_date)}"></div>
          </div>
          <div><label>Instructions</label><textarea name="instructions" rows="3">${esc(exam.instructions || '')}</textarea></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-blue" style="padding:12px 28px">Save Changes</button>
            <a href="/exams/${examId}" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Exam', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /exams/:id/update — Update Exam
  // ============================================================
  app.post('/exams/:id/update', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT id FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    const { title, description, subject, duration_minutes, total_marks, passing_marks,
      instructions, shuffle_questions, show_results, allow_retry, max_attempts,
      start_date, end_date, target_group } = req.body;
    if (!title || !title.trim()) return res.redirect(`/exams/${examId}/edit`);
    await pool.query(
      `UPDATE exams SET title=$1, description=$2, subject=$3, duration_minutes=$4, total_marks=$5, passing_marks=$6,
        instructions=$7, shuffle_questions=$8, show_results=$9, allow_retry=$10, max_attempts=$11,
        start_date=$12, end_date=$13, target_group=$14 WHERE id=$15 AND tenant_id=$16`,
      [title.trim(), (description || '').trim(), (subject || '').trim(),
        parseInt(duration_minutes) || 60, parseInt(total_marks) || 100, parseInt(passing_marks) || 50,
        (instructions || '').trim(), shuffle_questions === 'on', show_results === 'on',
        allow_retry === 'on', parseInt(max_attempts) || 1,
        start_date || null, end_date || null, (target_group || '').trim(), examId, tid]
    );
    console.log(`[Exams] Exam #${examId} updated by ${user.email}`);
    res.redirect(`/exams/${examId}`);
  }));

  // ============================================================
  // ROUTE 7: DELETE /exams/:id — Delete Exam
  // ============================================================
  app.post('/exams/:id/delete', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT title FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    await pool.query(`DELETE FROM exam_attempts WHERE exam_id=$1 AND tenant_id=$2`, [examId, tid]);
    await pool.query(`DELETE FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2`, [examId, tid]);
    await pool.query(`DELETE FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid]);
    console.log(`[Exams] Exam #${examId} "${exam.title}" deleted by ${user.email}`);
    res.redirect('/exams');
  }));

  // ============================================================
  // ROUTE 8: GET /exams/:id/questions — Manage Questions
  // ============================================================
  app.get('/exams/:id/questions', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT * FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    const questions = (await pool.query(`SELECT * FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2 ORDER BY question_order, id`, [examId, tid])).rows;
    const totalMarks = questions.reduce((s, q) => s + (parseInt(q.marks) || 1), 0);

    const qItems = questions.map((q, i) => `<div class="ex-question-card" style="border-left:4px solid #4f46e5">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-weight:800;color:#4f46e5;font-size:16px">Q${i + 1}</span>
          ${questionTypeBadge(q.question_type)}
          <span class="badge" style="background:#f8fafc;color:#64748b">${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;gap:4px">
          ${i > 0 ? `<form method="POST" action="/exams/${examId}/questions/reorder" style="display:inline"><input type="hidden" name="qid" value="${q.id}"><input type="hidden" name="direction" value="up"><button class="ex-btn ex-btn-sm ex-btn-secondary" type="submit">↑</button></form>` : ''}
          ${i < questions.length - 1 ? `<form method="POST" action="/exams/${examId}/questions/reorder" style="display:inline"><input type="hidden" name="qid" value="${q.id}"><input type="hidden" name="direction" value="down"><button class="ex-btn ex-btn-sm ex-btn-secondary" type="submit">↓</button></form>` : ''}
          <form method="POST" action="/exams/${examId}/questions/${q.id}/delete" style="display:inline" onsubmit="return confirm('Delete this question?')">
            <button type="submit" class="ex-btn ex-btn-danger ex-btn-sm">Delete</button></form>
        </div>
      </div>
      <div style="font-size:14px;color:#1e293b;margin-bottom:8px;white-space:pre-wrap">${esc(q.question_text)}</div>
      ${q.question_type === 'multiple_choice' && q.options ? `<div style="margin-bottom:6px">${Array.isArray(q.options) ? q.options.map((o, oi) => {
        const letter = String.fromCharCode(65 + oi);
        const isCorrect = q.correct_answer && q.correct_answer.toUpperCase() === letter;
        return `<span style="display:inline-block;padding:4px 10px;margin:2px;border-radius:6px;font-size:12px;background:${isCorrect ? '#dcfce7' : '#f8fafc'};color:${isCorrect ? '#16a34a' : '#64748b'};font-weight:${isCorrect ? '700' : '400'}">${letter}. ${esc(o)} ${isCorrect ? '✓' : ''}</span>`;
      }).join('') : ''}</div>` : ''}
      ${q.question_type === 'true_false' ? `<span style="font-size:12px;color:#64748b">Answer: <strong>${esc(q.correct_answer || 'Not set')}</strong></span>` : ''}
      ${q.explanation ? `<div style="margin-top:8px;padding:8px 12px;background:#fffbeb;border-radius:8px;font-size:12px;color:#92400e">💡 ${esc(q.explanation)}</div>` : ''}
    </div>`).join('');

    const typeOpts = QUESTION_TYPES.map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('');

    const html = EX_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('')}
      <a href="/exams/${examId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Exam</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📝 Questions — ${esc(exam.title)}</h1>
          <p class="muted" style="font-size:13px;margin-top:2px">${questions.length} questions · ${totalMarks} total marks</p></div>
        <a href="/exams/${examId}" class="ex-btn ex-btn-secondary">👁 View Exam</a>
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 16px">➕ Add New Question</h3>
        <form method="POST" action="/exams/${examId}/questions/add" class="ex-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Question Type</label>
            <select name="question_type" id="q-type" onchange="toggleOptions()">${typeOpts}</select></div>
          <div><label>Question Text *</label>
            <textarea name="question_text" rows="3" required placeholder="Enter your question here..."></textarea></div>
          <div id="options-section" class="ex-grid">
            <div><label>Options (one per line)</label>
              <textarea name="options" rows="4" placeholder="Option A\nOption B\nOption C\nOption D"></textarea></div>
            <div><label>Correct Answer (letter: A, B, C, D)</label>
              <input type="text" name="correct_answer" placeholder="e.g., B" maxlength="1" style="text-transform:uppercase"></div>
          </div>
          <div id="tf-section" style="display:none" class="ex-grid">
            <div><label>Correct Answer</label>
              <select name="correct_answer_tf"><option value="true">True</option><option value="false">False</option></select></div>
          </div>
          <div class="ex-grid">
            <div><label>Marks</label><input type="number" name="marks" value="1" min="1" max="100"></div>
            <div><label>Explanation (optional)</label><input type="text" name="explanation" placeholder="Explain why this is correct..."></div>
          </div>
          <button type="submit" class="btn btn-green" style="padding:10px 24px;align-self:flex-start">➕ Add Question</button>
        </form>
      </div>
      ${qItems || '<div class="card" style="text-align:center;padding:40px"><p class="muted">No questions yet. Add your first question above.</p></div>'}
    </div>
    <script>
      function toggleOptions(){
        const t=document.getElementById('q-type').value;
        const os=document.getElementById('options-section');
        const tf=document.getElementById('tf-section');
        if(t==='multiple_choice'){os.style.display='grid';tf.style.display='none';}
        else if(t==='true_false'){os.style.display='none';tf.style.display='grid';}
        else{os.style.display='none';tf.style.display='none';}
      }
      toggleOptions();
    </script>`;
    res.send(renderPage('Questions — ' + exam.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /exams/:id/questions/add — Add Question
  // ============================================================
  app.post('/exams/:id/questions/add', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const exam = (await pool.query(`SELECT id FROM exams WHERE id=$1 AND tenant_id=$2`, [examId, tid])).rows[0];
    if (!exam) return res.redirect('/exams');
    const { question_text, question_type, options, correct_answer, correct_answer_tf, marks, explanation } = req.body;
    if (!question_text || !question_text.trim()) return res.redirect(`/exams/${examId}/questions`);

    const qType = question_type || 'multiple_choice';
    let parsedOptions = null;
    let correctAns = '';

    if (qType === 'multiple_choice') {
      parsedOptions = (options || '').split('\n').map(o => o.trim()).filter(Boolean);
      correctAns = (correct_answer || '').toUpperCase();
    } else if (qType === 'true_false') {
      correctAns = correct_answer_tf || 'true';
    }

    const order = (await pool.query(
      `SELECT COALESCE(MAX(question_order), -1) + 1 as next_ord FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2`,
      [examId, tid]
    )).rows[0].next_ord;

    await pool.query(
      `INSERT INTO exam_questions (tenant_id, exam_id, question_text, question_type, options, correct_answer, marks, explanation, question_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, examId, question_text.trim(), qType, parsedOptions, correctAns || null,
        parseInt(marks) || 1, (explanation || '').trim(), order]
    );
    console.log(`[Exams] Question added to exam #${examId} by ${user.email}`);
    res.redirect(`/exams/${examId}/questions`);
  }));

  // ============================================================
  // ROUTE 10: DELETE /exams/:id/questions/:qid — Delete Question
  // ============================================================
  app.post('/exams/:id/questions/:qid/delete', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const examId = req.params.id, qid = req.params.qid;
    await pool.query(`DELETE FROM exam_questions WHERE id=$1 AND exam_id=$2 AND tenant_id=$3`, [qid, examId, tid]);
    console.log(`[Exams] Question #${qid} deleted from exam #${examId} by ${user.email}`);
    res.redirect(`/exams/${examId}/questions`);
  }));

  // ============================================================
  // ROUTE: POST /exams/:id/questions/reorder — Reorder Question
  // ============================================================
  app.post('/exams/:id/questions/reorder', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const examId = req.params.id, { qid, direction } = req.body;
    const all = (await pool.query(`SELECT id, question_order FROM exam_questions WHERE exam_id=$1 AND tenant_id=$2 ORDER BY question_order, id`, [examId, tid])).rows;
    const idx = all.findIndex(q => q.id == qid);
    if (idx < 0) return res.redirect(`/exams/${examId}/questions`);
    if ((direction === 'up' && idx > 0) || (direction === 'down' && idx < all.length - 1)) {
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      await pool.query(`UPDATE exam_questions SET question_order=$1 WHERE id=$2`, [all[swapIdx].question_order, qid]);
      await pool.query(`UPDATE exam_questions SET question_order=$1 WHERE id=$2`, [all[idx].question_order, all[swapIdx].id]);
    }
    res.redirect(`/exams/${examId}/questions`);
  }));

  // ============================================================
  // ROUTE 11: POST /exams/:id/publish — Publish/Unpublish
  // ============================================================
  app.post('/exams/:id/publish', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, examId = req.params.id;
    const { publish } = req.body;
    const isPub = publish === 'true';
    await pool.query(`UPDATE exams SET is_published=$1 WHERE id=$2 AND tenant_id=$3`, [isPub, examId, tid]);
    console.log(`[Exams] Exam #${examId} ${isPub ? 'published' : 'unpublished'} by ${user.email}`);
    res.redirect(`/exams/${examId}`);
  }));

  console.log('[Exams] Online exams & quizzes loaded');
};
