/**
 * Peer Review System – SaaS School Portal Module
 * Routes prefix: /school/peer-review
 * Features: Assignment-based peer review, anonymous reviews, review rubrics,
 *           reviewer assignment (random/manual), deadline management, feedback
 *           quality scoring, multiple revision rounds, statistics, calibration,
 *           plagiarism flagging, teacher oversight dashboard.
 */
const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>'
    + '.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}'
    + '.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}'
    + '.btn:hover{background:#3730a3}'
    + '.btn-sm{padding:5px 12px;font-size:13px}'
    + '.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}'
    + '.btn-success{background:#059669}.btn-success:hover{background:#047857}'
    + '.btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}'
    + '.btn-outline:hover{background:#f3f4f6}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}'
    + 'th{background:#f9fafb;font-weight:600;color:#374151}'
    + 'input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}'
    + 'textarea{min-height:80px;resize:vertical}'
    + '.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}'
    + '.badge-green{background:#d1fae5;color:#065f46}'
    + '.badge-yellow{background:#fef3c7;color:#92400e}'
    + '.badge-red{background:#fee2e2;color:#991b1b}'
    + '.badge-blue{background:#dbeafe;color:#1e40af}'
    + '.badge-gray{background:#f3f4f6;color:#4b5563}'
    + '.stat-card{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;border-radius:12px;padding:20px;text-align:center}'
    + '.stat-card h3{font-size:28px;margin:0 0 4px}.stat-card p{margin:0;opacity:.85;font-size:14px}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}'
    + '.flex{display:flex;align-items:center;gap:8px}.flex-between{display:flex;justify-content:space-between;align-items:center}'
    + '.mb-8{margin-bottom:8px}.mb-16{margin-bottom:16px}.mt-16{margin-top:16px}'
    + '.text-muted{color:#6b7280}.text-sm{font-size:13px}'
    + '.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}'
    + '.progress-fill{height:100%;background:#4f46e5;border-radius:4px}'
    + '.tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e5e7eb;padding-bottom:0}'
    + '.tab{padding:8px 16px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;font-weight:500}'
    + '.tab.active{border-color:#4f46e5;color:#4f46e5}'
    + '.alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}'
    + '.alert-warn{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}'
    + '.alert-info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}'
    + '.alert-success{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}'
    + '.score-bar{display:flex;gap:4px;align-items:center}.score-bar .bar{width:60px;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}'
    + '.score-bar .fill{height:100%;border-radius:4px}'
    + '</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Peer Review</div>';

  /* ─── helpers ─────────────────────────────────────────────────────── */
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const statusBadge = (s) => {
    const map = {
      pending: 'badge-yellow', assigned: 'badge-blue', in_progress: 'badge-blue',
      submitted: 'badge-green', completed: 'badge-green', overdue: 'badge-red',
      flagged: 'badge-red', draft: 'badge-gray'
    };
    return `<span class="badge ${map[s] || 'badge-gray'}">${esc(s || 'draft')}</span>`;
  };
  const scoreColor = (v, max) => {
    const pct = max > 0 ? (v / max) * 100 : 0;
    if (pct >= 80) return '#059669';
    if (pct >= 60) return '#d97706';
    return '#dc2626';
  };
  const pctBar = (v, max, color) => {
    const c = color || scoreColor(v, max);
    const pct = max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0;
    return `<div class="score-bar"><span style="width:32px;text-align:right;font-weight:600">${v}</span>`
      + `<div class="bar"><div class="fill" style="width:${pct}%;background:${c}"></div></div>`
      + `<span class="text-muted text-sm">/ ${max}</span></div>`;
  };

  /* ─── auto-migration ─────────────────────────────────────────────── */
  setTimeout(() => {
  (async () => {
    try {
      await migrateQuery(pool, 'PeerReview', `
        CREATE TABLE IF NOT EXISTS peer_review_assignments (
          id            SERIAL PRIMARY KEY,
          tenant_id     INT NOT NULL,
          assignment_id INT NOT NULL DEFAULT 0,
          title         VARCHAR(255) NOT NULL DEFAULT '',
          description   TEXT,
          subject       VARCHAR(100) DEFAULT '',
          rubric_id     INT DEFAULT 0,
          reviewer_id   INT NOT NULL,
          reviewee_id   INT NOT NULL,
          status        VARCHAR(30) NOT NULL DEFAULT 'assigned',
          due_date      DATE,
          round         INT NOT NULL DEFAULT 1,
          max_rounds    INT NOT NULL DEFAULT 3,
          anonymous     BOOLEAN NOT NULL DEFAULT true,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await migrateQuery(pool, 'PeerReview', `
        CREATE TABLE IF NOT EXISTS peer_reviews (
          id                    SERIAL PRIMARY KEY,
          tenant_id             INT NOT NULL,
          assignment_id         INT NOT NULL DEFAULT 0,
          reviewer_id           INT NOT NULL,
          reviewee_id           INT NOT NULL,
          round                 INT NOT NULL DEFAULT 1,
          content_quality_score NUMERIC(5,2) DEFAULT 0,
          originality_score     NUMERIC(5,2) DEFAULT 0,
          clarity_score         NUMERIC(5,2) DEFAULT 0,
          effort_score          NUMERIC(5,2) DEFAULT 0,
          overall_score         NUMERIC(5,2) DEFAULT 0,
          comments              TEXT,
          feedback_quality      NUMERIC(5,2) DEFAULT 0,
          plagiarism_flagged    BOOLEAN NOT NULL DEFAULT false,
          plagiarism_notes      TEXT,
          teacher_override_score NUMERIC(5,2) DEFAULT 0,
          teacher_notes         TEXT,
          submitted_at          TIMESTAMPTZ,
          created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await migrateQuery(pool, 'PeerReview', `
        CREATE TABLE IF NOT EXISTS review_rubrics (
          id        SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          title     VARCHAR(255) NOT NULL,
          criteria  JSONB NOT NULL DEFAULT '[]',
          max_score NUMERIC(5,2) NOT NULL DEFAULT 20,
          subject   VARCHAR(100) DEFAULT '',
          is_default BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await migrateQuery(pool, 'PeerReview', `
        CREATE INDEX IF NOT EXISTS idx_pra_tenant ON peer_review_assignments(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_pr_tenant ON peer_reviews(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_rr_tenant ON review_rubrics(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_pra_reviewer ON peer_review_assignments(reviewer_id);
        CREATE INDEX IF NOT EXISTS idx_pra_reviewee ON peer_review_assignments(reviewee_id);
        CREATE INDEX IF NOT EXISTS idx_pra_status ON peer_review_assignments(status);
        CREATE INDEX IF NOT EXISTS idx_pr_reviewer ON peer_reviews(reviewer_id);
        CREATE INDEX IF NOT EXISTS idx_pr_reviewee ON peer_reviews(reviewee_id);
      `);
      console.log('[PeerReview] Tables ready');
    } catch (e) {
      console.warn('[PeerReview] Migration warning:', e.message);
    }
  })();
  }, Math.random() * 10000);

  /* ─── 1. DASHBOARD ──────────────────────────────────────────────── */
  app.get('/school/peer-review', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const uid = req.user.id;
      const tid = req.user.tenant_id;
      const role = req.user.role || 'student';
      const isTeacher = role === 'teacher' || role === 'admin';

      // Stats for teachers – whole tenant; for students – personal
      let statsQuery, statsParams;
      if (isTeacher) {
        statsQuery = `SELECT
            COUNT(*)::int AS total_assignments,
            COUNT(*) FILTER (WHERE status='submitted')::int AS submitted,
            COUNT(*) FILTER (WHERE status='overdue')::int AS overdue,
            COUNT(*) FILTER (WHERE status='assigned' OR status='in_progress')::int AS pending,
            ROUND(AVG(overall_score)::numeric,2) AS avg_score,
            COUNT(DISTINCT reviewer_id)::int AS active_reviewers
          FROM peer_reviews WHERE tenant_id=$1`;
        statsParams = [tid];
      } else {
        statsQuery = `SELECT
            (SELECT COUNT(*)::int FROM peer_review_assignments WHERE tenant_id=$1 AND reviewer_id=$2) AS total_assignments,
            (SELECT COUNT(*)::int FROM peer_review_assignments WHERE tenant_id=$1 AND reviewer_id=$2 AND status='submitted') AS submitted,
            (SELECT COUNT(*)::int FROM peer_review_assignments WHERE tenant_id=$1 AND reviewer_id=$2 AND status='overdue') AS overdue,
            (SELECT COUNT(*)::int FROM peer_review_assignments WHERE tenant_id=$1 AND reviewer_id=$2 AND (status='assigned' OR status='in_progress')) AS pending,
            (SELECT ROUND(AVG(overall_score)::numeric,2) FROM peer_reviews WHERE tenant_id=$1 AND reviewee_id=$2) AS avg_score_received,
            0 AS active_reviewers`;
        statsParams = [tid, uid];
      }
      const st = (await pool.query(statsQuery, statsParams)).rows[0];

      // Recent activity
      const recentQ = isTeacher
        ? `SELECT pra.id, pra.title, pra.status, pra.due_date, pra.round,
             u1.name AS reviewer_name, u2.name AS reviewee_name
           FROM peer_review_assignments pra
           LEFT JOIN users u1 ON u1.id=pra.reviewer_id
           LEFT JOIN users u2 ON u2.id=pra.reviewee_id
           WHERE pra.tenant_id=$1 ORDER BY pra.updated_at DESC LIMIT 10`
        : `SELECT pra.id, pra.title, pra.status, pra.due_date, pra.round,
             u2.name AS reviewee_name
           FROM peer_review_assignments pra
           LEFT JOIN users u2 ON u2.id=pra.reviewee_id
           WHERE pra.tenant_id=$1 AND pra.reviewer_id=$2 ORDER BY pra.updated_at DESC LIMIT 10`;
      const recentParams = isTeacher ? [tid] : [tid, uid];
      const recent = (await pool.query(recentQ, recentParams)).rows;

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Peer Review Dashboard</h2>';
      html += '<div class="grid">';
      html += `<div class="stat-card"><h3>${st.total_assignments || 0}</h3><p>${isTeacher ? 'Total Assignments' : 'Assigned to Me'}</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>${st.submitted || 0}</h3><p>Completed Reviews</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#f59e0b)"><h3>${st.pending || 0}</h3><p>Pending Reviews</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#dc2626,#ef4444)"><h3>${st.overdue || 0}</h3><p>Overdue</p></div>`;
      html += '</div>';

      if (st.avg_score) {
        html += `<div class="card mt-16"><strong>Average Score:</strong> ${st.avg_score}/20`;
        if (isTeacher && st.active_reviewers) html += ` &nbsp;|&nbsp; <strong>Active Reviewers:</strong> ${st.active_reviewers}`;
        html += '</div>';
      }

      html += '<div class="card"><h3 style="margin:0 0 12px">Recent Activity</h3>';
      if (recent.length === 0) {
        html += '<p class="text-muted">No peer review activity yet.</p>';
      } else {
        html += '<table><tr><th>Title</th>';
        if (isTeacher) html += '<th>Reviewer</th>';
        html += '<th>Reviewee</th><th>Status</th><th>Due</th><th>Round</th><th>Actions</th></tr>';
        for (const r of recent) {
          html += `<tr><td>${esc(r.title || 'Untitled')}</td>`;
          if (isTeacher) html += `<td>${esc(r.reviewer_name || '—')}</td>`;
          html += `<td>${esc(r.reviewee_name || '—')}</td>`;
          html += `<td>${statusBadge(r.status)}</td>`;
          html += `<td>${fmtDate(r.due_date)}</td>`;
          html += `<td>${r.round}</td>`;
          html += `<td><a href="/school/peer-review/view-assignment/${r.id}" class="btn btn-sm">View</a></td>`;
          html += '</tr>';
        }
        html += '</table>';
      }
      html += '</div>';

      html += '<div class="flex mt-16">';
      html += '<a href="/school/peer-review/assignments" class="btn">Manage Assignments</a> ';
      html += '<a href="/school/peer-review/rubrics" class="btn btn-outline">Rubrics</a> ';
      html += '<a href="/school/peer-review/statistics" class="btn btn-outline">Statistics</a> ';
      html += '<a href="/school/peer-review/calibration" class="btn btn-outline">Calibration</a>';
      html += '</div>';

      ah(req, res, html, 'Peer Review – Dashboard');
    } catch (e) {
      console.error('[PeerReview] dashboard error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading dashboard.</div>', 'Peer Review');
    }
  });

  /* ─── 2. ASSIGNMENTS LIST ───────────────────────────────────────── */
  app.get('/school/peer-review/assignments', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const role = req.user.role || 'student';
      const isTeacher = role === 'teacher' || role === 'admin';
      const { status, round, q } = req.query;

      let where = 'WHERE pra.tenant_id=$1';
      const params = [tid];
      let pi = 2;

      if (!isTeacher) {
        where += ` AND (pra.reviewer_id=$${pi} OR pra.reviewee_id=$${pi})`;
        params.push(req.user.id);
        pi++;
      }
      if (status) {
        where += ` AND pra.status=$${pi}`;
        params.push(status);
        pi++;
      }
      if (round) {
        where += ` AND pra.round=$${pi}`;
        params.push(parseInt(round, 10));
        pi++;
      }
      if (q) {
        where += ` AND pra.title ILIKE $${pi}`;
        params.push(`%${q}%`);
        pi++;
      }

      const data = await pool.query(
        `SELECT pra.*, u1.name AS reviewer_name, u2.name AS reviewee_name, u3.name AS reviewee_name_safe
         FROM peer_review_assignments pra
         LEFT JOIN users u1 ON u1.id=pra.reviewer_id
         LEFT JOIN users u2 ON u2.id=pra.reviewee_id
         LEFT JOIN users u3 ON u3.id=pra.reviewee_id
         ${where} ORDER BY pra.updated_at DESC LIMIT 50`,
        params
      );

      let html = SKIP;
      html += '<div class="flex-between"><h2 style="margin:0">Review Assignments</h2>';
      if (isTeacher) {
        html += '<a href="/school/peer-review/create-assignment" class="btn btn-success">+ New Assignment</a>';
      }
      html += '</div>';

      // Filters
      html += '<form method="GET" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">';
      html += '<div style="flex:1;min-width:150px"><label class="text-sm text-muted">Search</label><input name="q" value="' + esc(q || '') + '" placeholder="Title…"></div>';
      html += '<div style="min-width:130px"><label class="text-sm text-muted">Status</label><select name="status">'
        + '<option value="">All</option>'
        + '<option value="assigned"' + (status === 'assigned' ? ' selected' : '') + '>Assigned</option>'
        + '<option value="in_progress"' + (status === 'in_progress' ? ' selected' : '') + '>In Progress</option>'
        + '<option value="submitted"' + (status === 'submitted' ? ' selected' : '') + '>Submitted</option>'
        + '<option value="overdue"' + (status === 'overdue' ? ' selected' : '') + '>Overdue</option>'
        + '</select></div>';
      html += '<div style="min-width:100px"><label class="text-sm text-muted">Round</label><input name="round" type="number" min="1" value="' + esc(round || '') + '" style="width:80px"></div>';
      html += '<button type="submit" class="btn">Filter</button></form>';

      html += `<p class="text-muted text-sm mb-16">${data.rows.length} assignment(s) found</p>`;

      if (data.rows.length === 0) {
        html += '<div class="card"><p class="text-muted">No assignments found. Create one to get started.</p></div>';
      } else {
        html += '<table><tr><th>Title</th><th>Reviewer</th><th>Reviewee</th><th>Status</th><th>Due</th><th>Round</th><th>Actions</th></tr>';
        for (const a of data.rows) {
          const revieweeDisplay = a.anonymous && !isTeacher ? 'Anonymous' : esc(a.reviewee_name || '—');
          html += '<tr>';
          html += `<td><strong>${esc(a.title || 'Untitled')}</strong>${a.anonymous ? ' <span class="badge badge-gray">Anon</span>' : ''}</td>`;
          html += `<td>${esc(a.reviewer_name || '—')}</td>`;
          html += `<td>${revieweeDisplay}</td>`;
          html += `<td>${statusBadge(a.status)}</td>`;
          html += `<td>${fmtDate(a.due_date)}</td>`;
          html += `<td>${a.round}/${a.max_rounds}</td>`;
          html += `<td class="flex"><a href="/school/peer-review/view-assignment/${a.id}" class="btn btn-sm">View</a>`;
          if (isTeacher) {
            html += ` <a href="/school/peer-review/edit-assignment/${a.id}" class="btn btn-sm btn-outline">Edit</a>`;
          }
          html += '</td></tr>';
        }
        html += '</table>';
      }

      ah(req, res, html, 'Peer Review – Assignments');
    } catch (e) {
      console.error('[PeerReview] assignments error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading assignments.</div>', 'Peer Review – Assignments');
    }
  });

  /* ─── 3. CREATE ASSIGNMENT ──────────────────────────────────────── */
  app.get('/school/peer-review/create-assignment', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rubrics = (await pool.query('SELECT id, title, subject FROM review_rubrics WHERE tenant_id=$1 ORDER BY title', [tid])).rows;
      const students = (await pool.query(
        "SELECT id, name FROM users WHERE tenant_id=$1 AND role='student' ORDER BY name LIMIT 500", [tid]
      )).rows;

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Create Review Assignment</h2>';
      html += '<form method="POST" action="/school/peer-review/create-assignment" class="card">';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
      html += '<div><label class="text-sm text-muted">Title *</label><input name="title" required placeholder="e.g. Essay #3 Peer Review"></div>';
      html += '<div><label class="text-sm text-muted">Subject</label><input name="subject" placeholder="English, Math…"></div>';
      html += '<div style="grid-column:span 2"><label class="text-sm text-muted">Description</label><textarea name="description" placeholder="Instructions for reviewers…"></textarea></div>';
      html += '<div><label class="text-sm text-muted">Due Date *</label><input name="due_date" type="date" required></div>';
      html += '<div><label class="text-sm text-muted">Rubric</label><select name="rubric_id"><option value="0">— None —</option>';
      for (const r of rubrics) html += `<option value="${r.id}">${esc(r.title)} (${esc(r.subject)})</option>`;
      html += '</select></div>';
      html += '<div><label class="text-sm text-muted">Max Rounds</label><input name="max_rounds" type="number" min="1" max="10" value="3"></div>';
      html += '<div><label class="text-sm text-muted">Assignment Mode</label>'
        + '<select name="assign_mode"><option value="random">Random Assignment</option><option value="manual">Manual Selection</option></select></div>';
      html += '<div style="grid-column:span 2"><label><input type="checkbox" name="anonymous" value="1" checked> Anonymous Reviews</label></div>';

      // Manual reviewer/reviewee selection
      html += '<div style="grid-column:span 2"><label class="text-sm text-muted">Manual Reviewer-Reviewee Pairs (if Manual mode)</label>';
      html += '<div id="pairs-container">';
      html += '<div class="flex mb-8"><select name="reviewer_0" style="flex:1"><option value="">Select Reviewer…</option>';
      for (const s of students) html += `<option value="${s.id}">${esc(s.name)}</option>`;
      html += '</select> <span style="padding:0 8px">reviews</span>';
      html += '<select name="reviewee_0" style="flex:1"><option value="">Select Reviewee…</option>';
      for (const s of students) html += `<option value="${s.id}">${esc(s.name)}</option>`;
      html += '</select></div>';
      html += '</div>';
      html += '<button type="button" onclick="addPair()" class="btn btn-sm btn-outline">+ Add Pair</button></div>';

      html += '</div>';
      html += '<div class="mt-16"><button type="submit" class="btn btn-success">Create Assignment</button> '
        + '<a href="/school/peer-review/assignments" class="btn btn-outline">Cancel</a></div>';
      html += '</form>';

      html += '<script>let pairCount=1;'
        + 'function addPair(){const c=document.getElementById("pairs-container");'
        + 'const d=document.createElement("div");d.className="flex mb-8";'
        + 'd.innerHTML=`<select name="reviewer_${pairCount}" style="flex:1">${document.querySelector("select[name=reviewer_0]").innerHTML}</select>'
        + ' <span style="padding:0 8px">reviews</span>'
        + ' <select name="reviewee_${pairCount}" style="flex:1">${document.querySelector("select[name=reviewee_0]").innerHTML}</select>`;'
        + 'c.appendChild(d);pairCount++;}</script>';

      ah(req, res, html, 'Peer Review – Create Assignment');
    } catch (e) {
      console.error('[PeerReview] create-assignment form error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading form.</div>', 'Peer Review – Create');
    }
  });

  app.post('/school/peer-review/create-assignment', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const uid = req.user.id;
      const tid = req.user.tenant_id;
      const { title, subject, description, due_date, rubric_id, max_rounds, assign_mode, anonymous } = req.body;
      const rounds = Math.max(1, Math.min(10, parseInt(max_rounds, 10) || 3));
      const isAnon = anonymous === '1' || anonymous === 'on' || anonymous === true;
      const rubricId = parseInt(rubric_id, 10) || 0;

      if (!title || !due_date) {
        return ah(req, res, SKIP + '<div class="alert alert-warn">Title and due date are required.</div>', 'Create Assignment');
      }

      if (assign_mode === 'manual') {
        // Manual pairs
        let idx = 0;
        let created = 0;
        while (req.body[`reviewer_${idx}`] !== undefined) {
          const reviewerId = parseInt(req.body[`reviewer_${idx}`], 10);
          const revieweeId = parseInt(req.body[`reviewee_${idx}`], 10);
          if (reviewerId && revieweeId && reviewerId !== revieweeId) {
            await pool.query(
              `INSERT INTO peer_review_assignments (tenant_id, title, description, subject, rubric_id, reviewer_id, reviewee_id, status, due_date, round, max_rounds, anonymous)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'assigned',$8,1,$9,$10)`,
              [tid, title, description || '', subject || '', rubricId, reviewerId, revieweeId, due_date, rounds, isAnon]
            );
            created++;
          }
          idx++;
        }
        if (created === 0) {
          return ah(req, res, SKIP + '<div class="alert alert-warn">No valid reviewer-reviewee pairs provided.</div>', 'Create Assignment');
        }
        audit(req, 'peer_review_assignment_created', { title, mode: 'manual', pairs: created });
      } else {
        // Random assignment – pair students up
        const students = (await pool.query(
          "SELECT id FROM users WHERE tenant_id=$1 AND role='student' ORDER BY random()", [tid]
        )).rows;
        if (students.length < 2) {
          return ah(req, res, SKIP + '<div class="alert alert-warn">Need at least 2 students for random assignment.</div>', 'Create Assignment');
        }
        let created = 0;
        for (let i = 0; i < students.length; i++) {
          const reviewerId = students[i].id;
          const revieweeId = students[(i + 1) % students.length].id;
          await pool.query(
            `INSERT INTO peer_review_assignments (tenant_id, title, description, subject, rubric_id, reviewer_id, reviewee_id, status, due_date, round, max_rounds, anonymous)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'assigned',$8,1,$9,$10)`,
            [tid, title, description || '', subject || '', rubricId, reviewerId, revieweeId, due_date, rounds, isAnon]
          );
          created++;
        }
        audit(req, 'peer_review_assignment_created', { title, mode: 'random', pairs: created });

        // Notify reviewers
        if (queueEmail) {
          for (const s of students) {
            const revieweeIdx = (students.indexOf(s) + 1) % students.length;
            queueEmail(s.id, 'Peer Review Assigned', `You have been assigned to review a peer submission for "${title}". Due: ${due_date}.`);
          }
        }
      }

      res.redirect('/school/peer-review/assignments');
    } catch (e) {
      console.error('[PeerReview] create-assignment post error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error creating assignment: ' + esc(e.message) + '</div>', 'Create Assignment');
    }
  });

  /* ─── 4. EDIT ASSIGNMENT ────────────────────────────────────────── */
  app.get('/school/peer-review/edit-assignment/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const aid = parseInt(req.params.id, 10);
      const a = (await pool.query(
        'SELECT * FROM peer_review_assignments WHERE id=$1 AND tenant_id=$2', [aid, tid]
      )).rows[0];
      if (!a) return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment not found.</div>', 'Edit Assignment');

      const rubrics = (await pool.query('SELECT id, title FROM review_rubrics WHERE tenant_id=$1 ORDER BY title', [tid])).rows;
      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Edit Assignment: ' + esc(a.title) + '</h2>';
      html += `<form method="POST" action="/school/peer-review/edit-assignment/${aid}" class="card">`;
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
      html += `<div><label class="text-sm text-muted">Title *</label><input name="title" required value="${esc(a.title)}"></div>`;
      html += `<div><label class="text-sm text-muted">Subject</label><input name="subject" value="${esc(a.subject || '')}"></div>`;
      html += `<div style="grid-column:span 2"><label class="text-sm text-muted">Description</label><textarea name="description">${esc(a.description || '')}</textarea></div>`;
      html += `<div><label class="text-sm text-muted">Due Date</label><input name="due_date" type="date" value="${a.due_date || ''}"></div>`;
      html += `<div><label class="text-sm text-muted">Status</label><select name="status">`
        + `<option value="assigned"${a.status === 'assigned' ? ' selected' : ''}>Assigned</option>`
        + `<option value="in_progress"${a.status === 'in_progress' ? ' selected' : ''}>In Progress</option>`
        + `<option value="overdue"${a.status === 'overdue' ? ' selected' : ''}>Overdue</option>`
        + `<option value="submitted"${a.status === 'submitted' ? ' selected' : ''}>Submitted</option>`
        + `</select></div>`;
      html += `<div><label class="text-sm text-muted">Rubric</label><select name="rubric_id"><option value="0">— None —</option>`;
      for (const r of rubrics) html += `<option value="${r.id}"${a.rubric_id === r.id ? ' selected' : ''}>${esc(r.title)}</option>`;
      html += `</select></div>`;
      html += `<div><label><input type="checkbox" name="anonymous" value="1"${a.anonymous ? ' checked' : ''}> Anonymous</label></div>`;
      html += `</div>`;
      html += `<div class="mt-16"><button type="submit" class="btn">Save Changes</button> `
        + `<a href="/school/peer-review/view-assignment/${aid}" class="btn btn-outline">Cancel</a></div>`;
      html += '</form>';
      ah(req, res, html, 'Peer Review – Edit');
    } catch (e) {
      console.error('[PeerReview] edit-assignment form error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading form.</div>', 'Edit Assignment');
    }
  });

  app.post('/school/peer-review/edit-assignment/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const aid = parseInt(req.params.id, 10);
      const { title, subject, description, due_date, status, rubric_id, anonymous } = req.body;
      const isAnon = anonymous === '1' || anonymous === 'on' || anonymous === true;
      const result = await pool.query(
        `UPDATE peer_review_assignments SET title=$1, subject=$2, description=$3, due_date=$4,
         status=$5, rubric_id=$6, anonymous=$7, updated_at=now() WHERE id=$8 AND tenant_id=$9`,
        [title, subject || '', description || '', due_date || null, status || 'assigned',
          parseInt(rubric_id, 10) || 0, isAnon, aid, tid]
      );
      if (result.rowCount === 0) {
        return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment not found.</div>', 'Edit Assignment');
      }
      audit(req, 'peer_review_assignment_updated', { aid });
      res.redirect('/school/peer-review/view-assignment/' + aid);
    } catch (e) {
      console.error('[PeerReview] edit-assignment post error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error updating: ' + esc(e.message) + '</div>', 'Edit Assignment');
    }
  });

  /* ─── 5. VIEW ASSIGNMENT ────────────────────────────────────────── */
  app.get('/school/peer-review/view-assignment/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const uid = req.user.id;
      const aid = parseInt(req.params.id, 10);
      const a = (await pool.query(
        `SELECT pra.*, u1.name AS reviewer_name, u2.name AS reviewee_name,
                rr.title AS rubric_title, rr.criteria AS rubric_criteria, rr.max_score
         FROM peer_review_assignments pra
         LEFT JOIN users u1 ON u1.id=pra.reviewer_id
         LEFT JOIN users u2 ON u2.id=pra.reviewee_id
         LEFT JOIN review_rubrics rr ON rr.id=pra.rubric_id
         WHERE pra.id=$1 AND pra.tenant_id=$2`, [aid, tid]
      )).rows[0];
      if (!a) return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment not found.</div>', 'View Assignment');

      const reviews = (await pool.query(
        `SELECT pr.*, u.name AS reviewer_name
         FROM peer_reviews pr
         LEFT JOIN users u ON u.id=pr.reviewer_id
         WHERE pr.assignment_id=$1 AND pr.tenant_id=$2 ORDER BY pr.round`, [a.assignment_id || aid, tid]
      )).rows;

      const isTeacher = req.user.role === 'teacher' || req.user.role === 'admin';
      const isReviewer = a.reviewer_id === uid;
      const revieweeName = a.anonymous && !isTeacher ? 'Anonymous Student' : (a.reviewee_name || '—');

      let html = SKIP;
      html += '<div class="flex-between"><h2 style="margin:0">' + esc(a.title || 'Untitled') + '</h2>';
      html += statusBadge(a.status) + '</div>';

      html += '<div class="grid mt-16">';
      html += `<div class="card"><strong>Reviewer:</strong> ${esc(a.reviewer_name || '—')}</div>`;
      html += `<div class="card"><strong>Reviewee:</strong> ${esc(revieweeName)}</div>`;
      html += `<div class="card"><strong>Due:</strong> ${fmtDate(a.due_date)}</div>`;
      html += `<div class="card"><strong>Round:</strong> ${a.round} / ${a.max_rounds}</div>`;
      if (a.rubric_title) html += `<div class="card"><strong>Rubric:</strong> ${esc(a.rubric_title)}</div>`;
      if (a.anonymous) html += `<div class="card"><span class="badge badge-blue">Anonymous Review</span></div>`;
      html += '</div>';

      if (a.description) {
        html += `<div class="card mt-16"><strong>Description:</strong><p class="text-muted">${esc(a.description)}</p></div>`;
      }

      // Rubric display
      if (a.rubric_criteria && Array.isArray(a.rubric_criteria)) {
        html += '<div class="card mt-16"><h3>Rubric Criteria</h3><table><tr><th>Criterion</th><th>Weight</th></tr>';
        for (const c of a.rubric_criteria) {
          html += `<tr><td>${esc(c.name || c.label || '—')}</td><td>${c.weight || c.points || 1}</td></tr>`;
        }
        html += '</table></div>';
      }

      // Existing reviews
      html += `<div class="card mt-16"><h3>Reviews (${reviews.length})</h3>`;
      if (reviews.length === 0) {
        html += '<p class="text-muted">No reviews submitted yet.</p>';
      } else {
        for (const r of reviews) {
          html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px">`;
          html += `<div class="flex-between mb-8"><strong>Round ${r.round}</strong>`;
          if (r.submitted_at) html += `<span class="text-muted text-sm">${fmtDate(r.submitted_at)}</span>`;
          html += '</div>';
          html += `<div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px">`;
          html += `<div>${pctBar(r.content_quality_score, a.max_score || 5)}</div>`;
          html += `<div>${pctBar(r.originality_score, a.max_score || 5)}</div>`;
          html += `<div>${pctBar(r.clarity_score, a.max_score || 5)}</div>`;
          html += `<div>${pctBar(r.effort_score, a.max_score || 5)}</div>`;
          html += `<div><strong>Overall:</strong> ${pctBar(r.overall_score, a.max_score || 20)}</div>`;
          html += `<div><strong>Feedback Quality:</strong> ${pctBar(r.feedback_quality, 5)}</div>`;
          html += '</div>';
          if (r.comments) html += `<p class="mt-16">${esc(r.comments)}</p>`;
          if (r.plagiarism_flagged) {
            html += `<div class="alert alert-warn mt-16">⚠ Plagiarism Flagged${r.plagiarism_notes ? ': ' + esc(r.plagiarism_notes) : ''}</div>`;
          }
          if (r.teacher_notes && isTeacher) {
            html += `<div class="alert alert-info mt-16">Teacher Notes: ${esc(r.teacher_notes)}</div>`;
          }
          html += `<div class="mt-16"><a href="/school/peer-review/view-review/${r.id}" class="btn btn-sm btn-outline">View Full Review</a></div>`;
          html += '</div>';
        }
      }
      html += '</div>';

      // Actions
      html += '<div class="flex mt-16">';
      if (isReviewer && a.status !== 'submitted') {
        html += `<a href="/school/peer-review/submit-review?assignment_id=${aid}" class="btn btn-success">Submit Review</a> `;
      }
      if (isTeacher) {
        html += `<a href="/school/peer-review/edit-assignment/${aid}" class="btn">Edit</a> `;
        if (a.round < a.max_rounds) {
          html += `<form method="POST" action="/school/peer-review/next-round" style="display:inline">`
            + `<input type="hidden" name="assignment_id" value="${aid}">`
            + `<button type="submit" class="btn btn-outline">Advance to Round ${a.round + 1}</button></form> `;
        }
        html += `<form method="POST" action="/school/peer-review/delete-assignment/${aid}" style="display:inline" onsubmit="return confirm('Delete this assignment?')">`
          + `<button type="submit" class="btn btn-danger btn-sm">Delete</button></form>`;
      }
      html += '<a href="/school/peer-review/assignments" class="btn btn-outline">Back</a></div>';

      ah(req, res, html, 'Peer Review – ' + (a.title || 'Assignment'));
    } catch (e) {
      console.error('[PeerReview] view-assignment error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading assignment.</div>', 'View Assignment');
    }
  });

  /* ─── 6. DELETE ASSIGNMENT ──────────────────────────────────────── */
  app.post('/school/peer-review/delete-assignment/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const aid = parseInt(req.params.id, 10);
      await pool.query('DELETE FROM peer_reviews WHERE assignment_id=$1 AND tenant_id=$2', [aid, tid]);
      await pool.query('DELETE FROM peer_review_assignments WHERE id=$1 AND tenant_id=$2', [aid, tid]);
      audit(req, 'peer_review_assignment_deleted', { aid });
      res.redirect('/school/peer-review/assignments');
    } catch (e) {
      console.error('[PeerReview] delete-assignment error:', e);
      res.redirect('/school/peer-review/assignments');
    }
  });

  /* ─── 7. SUBMIT REVIEW (form) ───────────────────────────────────── */
  app.get('/school/peer-review/submit-review', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const uid = req.user.id;
      const aid = parseInt(req.query.assignment_id, 10);

      if (!aid) return ah(req, res, SKIP + '<div class="alert alert-warn">Missing assignment ID.</div>', 'Submit Review');

      const a = (await pool.query(
        `SELECT pra.*, rr.criteria AS rubric_criteria, rr.max_score
         FROM peer_review_assignments pra
         LEFT JOIN review_rubrics rr ON rr.id=pra.rubric_id
         WHERE pra.id=$1 AND pra.tenant_id=$2 AND pra.reviewer_id=$3`,
        [aid, tid, uid]
      )).rows[0];

      if (!a) return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment not found or you are not the reviewer.</div>', 'Submit Review');

      // Check if already submitted for this round
      const existing = (await pool.query(
        'SELECT id FROM peer_reviews WHERE assignment_id=$1 AND reviewer_id=$2 AND reviewee_id=$3 AND round=$4 AND tenant_id=$5',
        [a.assignment_id || aid, uid, a.reviewee_id, a.round, tid]
      )).rows[0];

      const maxScore = a.max_score || 5;
      const revieweeName = a.anonymous ? 'Anonymous Student' : '';

      let html = SKIP;
      html += `<h2 style="margin:0 0 16px">Submit Review: ${esc(a.title)}</h2>`;
      if (a.anonymous) html += '<div class="alert alert-info">This is an anonymous review. Your identity will not be revealed.</div>';

      const formAction = existing
        ? `/school/peer-review/submit-review?assignment_id=${aid}&edit=${existing.id}`
        : `/school/peer-review/submit-review?assignment_id=${aid}`;

      html += `<form method="POST" action="${formAction}" class="card">`;
      html += `<input type="hidden" name="assignment_id" value="${aid}">`;
      html += `<input type="hidden" name="reviewee_id" value="${a.reviewee_id}">`;
      html += `<input type="hidden" name="round" value="${a.round}">`;

      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

      // Rubric-based criteria or default scores
      if (a.rubric_criteria && Array.isArray(a.rubric_criteria) && a.rubric_criteria.length > 0) {
        for (const c of a.rubric_criteria) {
          const key = c.key || c.name.toLowerCase().replace(/\s+/g, '_');
          html += `<div><label class="text-sm text-muted">${esc(c.name || c.label)} (max ${c.max || maxScore})</label>`;
          html += `<input name="score_${esc(key)}" type="number" min="0" max="${c.max || maxScore}" step="0.5" required></div>`;
        }
      } else {
        html += `<div><label class="text-sm text-muted">Content Quality (0–${maxScore})</label>`
          + `<input name="content_quality_score" type="number" min="0" max="${maxScore}" step="0.5" required></div>`;
        html += `<div><label class="text-sm text-muted">Originality (0–${maxScore})</label>`
          + `<input name="originality_score" type="number" min="0" max="${maxScore}" step="0.5" required></div>`;
        html += `<div><label class="text-sm text-muted">Clarity (0–${maxScore})</label>`
          + `<input name="clarity_score" type="number" min="0" max="${maxScore}" step="0.5" required></div>`;
        html += `<div><label class="text-sm text-muted">Effort (0–${maxScore})</label>`
          + `<input name="effort_score" type="number" min="0" max="${maxScore}" step="0.5" required></div>`;
      }

      html += `<div><label class="text-sm text-muted">Overall Score (0–20)</label>`
        + `<input name="overall_score" type="number" min="0" max="20" step="0.5" required></div>`;
      html += `<div><label class="text-sm text-muted">Feedback Quality (self-assessment, 0–5)</label>`
        + `<input name="feedback_quality" type="number" min="0" max="5" step="0.5" value="3"></div>`;
      html += '</div>';

      html += `<div class="mt-16"><label class="text-sm text-muted">Comments *</label>`
        + `<textarea name="comments" required placeholder="Provide detailed, constructive feedback…">${existing ? '' : ''}</textarea></div>`;

      html += `<div class="mt-16"><label><input type="checkbox" name="plagiarism_flagged" value="1"> Flag for potential plagiarism</label></div>`;
      html += `<div id="plag-notes" style="display:none" class="mt-8"><label class="text-sm text-muted">Plagiarism Notes</label>`
        + `<textarea name="plagiarism_notes" placeholder="Describe the concern…"></textarea></div>`;

      html += `<div class="mt-16"><button type="submit" class="btn btn-success">Submit Review</button> `
        + `<a href="/school/peer-review/view-assignment/${aid}" class="btn btn-outline">Cancel</a></div>`;
      html += '</form>';

      html += '<script>document.querySelector("input[name=plagiarism_flagged]").addEventListener("change",function(){'
        + 'document.getElementById("plag-notes").style.display=this.checked?"block":"none"});</script>';

      ah(req, res, html, 'Peer Review – Submit');
    } catch (e) {
      console.error('[PeerReview] submit-review form error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading form.</div>', 'Submit Review');
    }
  });

  app.post('/school/peer-review/submit-review', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const uid = req.user.id;
      const tid = req.user.tenant_id;
      const aid = parseInt(req.body.assignment_id, 10);
      const revieweeId = parseInt(req.body.reviewee_id, 10);
      const round = parseInt(req.body.round, 10) || 1;
      const editId = parseInt(req.query.edit, 10) || 0;
      const {
        content_quality_score, originality_score, clarity_score, effort_score,
        overall_score, comments, feedback_quality, plagiarism_flagged, plagiarism_notes
      } = req.body;

      if (!aid || !revieweeId || !comments || !overall_score) {
        return ah(req, res, SKIP + '<div class="alert alert-warn">Missing required fields.</div>', 'Submit Review');
      }

      const isFlagged = plagiarism_flagged === '1' || plagiarism_flagged === 'on' || plagiarism_flagged === true;

      if (editId) {
        await pool.query(
          `UPDATE peer_reviews SET content_quality_score=$1, originality_score=$2,
           clarity_score=$3, effort_score=$4, overall_score=$5, comments=$6,
           feedback_quality=$7, plagiarism_flagged=$8, plagiarism_notes=$9,
           submitted_at=now(), updated_at=now()
           WHERE id=$10 AND tenant_id=$11 AND reviewer_id=$12`,
          [
            parseFloat(content_quality_score) || 0,
            parseFloat(originality_score) || 0,
            parseFloat(clarity_score) || 0,
            parseFloat(effort_score) || 0,
            parseFloat(overall_score) || 0,
            comments, parseFloat(feedback_quality) || 3,
            isFlagged, plagiarism_notes || '', editId, tid, uid
          ]
        );
        audit(req, 'peer_review_updated', { reviewId: editId, aid });
      } else {
        await pool.query(
          `INSERT INTO peer_reviews (tenant_id, assignment_id, reviewer_id, reviewee_id, round,
           content_quality_score, originality_score, clarity_score, effort_score,
           overall_score, comments, feedback_quality, plagiarism_flagged, plagiarism_notes, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
          [
            tid, aid, uid, revieweeId, round,
            parseFloat(content_quality_score) || 0,
            parseFloat(originality_score) || 0,
            parseFloat(clarity_score) || 0,
            parseFloat(effort_score) || 0,
            parseFloat(overall_score) || 0,
            comments, parseFloat(feedback_quality) || 3,
            isFlagged, plagiarism_notes || ''
          ]
        );
        // Update assignment status
        await pool.query(
          "UPDATE peer_review_assignments SET status='submitted', updated_at=now() WHERE id=$1 AND tenant_id=$2",
          [aid, tid]
        );
        audit(req, 'peer_review_submitted', { aid, round, isFlagged });

        // Notify reviewee
        if (queueEmail && !isFlagged) {
          queueEmail(revieweeId, 'Peer Review Completed', 'Your submission has been reviewed. Check your peer review dashboard for feedback.');
        }
        if (queueEmail && isFlagged) {
          queueEmail(revieweeId, 'Peer Review – Plagiarism Notice', 'Your submission has been flagged for potential plagiarism. Please contact your teacher.');
        }
      }

      res.redirect('/school/peer-review/view-assignment/' + aid);
    } catch (e) {
      console.error('[PeerReview] submit-review post error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error submitting review: ' + esc(e.message) + '</div>', 'Submit Review');
    }
  });

  /* ─── 8. VIEW REVIEW ────────────────────────────────────────────── */
  app.get('/school/peer-review/view-review/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const uid = req.user.id;
      const rid = parseInt(req.params.id, 10);
      const isTeacher = req.user.role === 'teacher' || req.user.role === 'admin';

      const r = (await pool.query(
        `SELECT pr.*, pra.title AS assignment_title, pra.anonymous,
                u1.name AS reviewer_name, u2.name AS reviewee_name
         FROM peer_reviews pr
         JOIN peer_review_assignments pra ON pra.id=pr.assignment_id
         LEFT JOIN users u1 ON u1.id=pr.reviewer_id
         LEFT JOIN users u2 ON u2.id=pr.reviewee_id
         WHERE pr.id=$1 AND pr.tenant_id=$2`, [rid, tid]
      )).rows[0];

      if (!r) return ah(req, res, SKIP + '<div class="alert alert-warn">Review not found.</div>', 'View Review');

      // Access control: teacher, reviewer, or reviewee
      if (!isTeacher && r.reviewer_id !== uid && r.reviewee_id !== uid) {
        return ah(req, res, SKIP + '<div class="alert alert-warn">You do not have access to this review.</div>', 'View Review');
      }

      const maxScore = 5;
      const reviewerDisplay = r.anonymous && r.reviewee_id === uid && !isTeacher ? 'Anonymous Reviewer' : (r.reviewer_name || '—');

      let html = SKIP;
      html += `<h2 style="margin:0 0 4px">Review #${r.id}</h2>`;
      html += `<p class="text-muted mb-16">${esc(r.assignment_title || 'Untitled')} — Round ${r.round}</p>`;

      if (r.plagiarism_flagged) {
        html += `<div class="alert alert-warn">⚠ <strong>Plagiarism Flagged</strong>${r.plagiarism_notes ? ': ' + esc(r.plagiarism_notes) : ''}</div>`;
      }

      html += '<div class="grid">';
      html += `<div class="card"><strong>Reviewer:</strong> ${esc(reviewerDisplay)}</div>`;
      html += `<div class="card"><strong>Reviewee:</strong> ${esc(r.reviewee_name || '—')}</div>`;
      html += `<div class="card"><strong>Submitted:</strong> ${fmtDate(r.submitted_at)}</div>`;
      html += '</div>';

      html += '<div class="card mt-16"><h3 style="margin:0 0 12px">Scores</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
      html += `<div><span class="text-sm text-muted">Content Quality</span>${pctBar(r.content_quality_score, maxScore)}</div>`;
      html += `<div><span class="text-sm text-muted">Originality</span>${pctBar(r.originality_score, maxScore)}</div>`;
      html += `<div><span class="text-sm text-muted">Clarity</span>${pctBar(r.clarity_score, maxScore)}</div>`;
      html += `<div><span class="text-sm text-muted">Effort</span>${pctBar(r.effort_score, maxScore)}</div>`;
      html += `<div><span class="text-sm text-muted">Overall Score</span>${pctBar(r.overall_score, 20, P)}</div>`;
      html += `<div><span class="text-sm text-muted">Feedback Quality</span>${pctBar(r.feedback_quality, 5)}</div>`;
      if (isTeacher && r.teacher_override_score > 0) {
        html += `<div><span class="text-sm text-muted">Teacher Override</span>${pctBar(r.teacher_override_score, 20, '#7c3aed')}</div>`;
      }
      html += '</div></div>';

      if (r.comments) {
        html += `<div class="card mt-16"><h3 style="margin:0 0 8px">Comments</h3><p>${esc(r.comments)}</p></div>`;
      }

      if (isTeacher && r.teacher_notes) {
        html += `<div class="card mt-16"><h3 style="margin:0 0 8px">Teacher Notes</h3><p>${esc(r.teacher_notes)}</p></div>`;
      }

      // Teacher actions
      if (isTeacher) {
        html += '<div class="card mt-16">';
        html += `<h3 style="margin:0 0 8px">Teacher Actions</h3>`;
        html += `<form method="POST" action="/school/peer-review/teacher-override/${rid}" style="margin-bottom:12px">`;
        html += `<div class="flex mb-8">`;
        html += `<input name="teacher_override_score" type="number" min="0" max="20" step="0.5" placeholder="Override Score" style="width:150px">`;
        html += `<input name="teacher_notes" placeholder="Teacher notes…" style="flex:1">`;
        html += `<button type="submit" class="btn btn-sm">Save</button>`;
        html += `</div></form>`;

        html += `<form method="POST" action="/school/peer-review/flag-plagiarism" style="display:inline">`;
        html += `<input type="hidden" name="review_id" value="${rid}">`;
        html += `<input name="plagiarism_notes" placeholder="Plagiarism note…" style="width:250px">`;
        html += `<button type="submit" class="btn btn-danger btn-sm">Flag Plagiarism</button>`;
        html += `</form> `;
        html += `<form method="POST" action="/school/peer-review/unflag-plagiarism" style="display:inline">`;
        html += `<input type="hidden" name="review_id" value="${rid}">`;
        html += `<button type="submit" class="btn btn-outline btn-sm">Remove Flag</button>`;
        html += `</form>`;
        html += '</div>';
      }

      html += `<div class="mt-16"><a href="/school/peer-review/view-assignment/${r.assignment_id}" class="btn btn-outline">Back to Assignment</a></div>`;
      ah(req, res, html, 'Peer Review – #' + rid);
    } catch (e) {
      console.error('[PeerReview] view-review error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading review.</div>', 'View Review');
    }
  });

  /* ─── 9. TEACHER OVERRIDE ───────────────────────────────────────── */
  app.post('/school/peer-review/teacher-override/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.params.id, 10);
      const { teacher_override_score, teacher_notes } = req.body;
      await pool.query(
        `UPDATE peer_reviews SET teacher_override_score=$1, teacher_notes=$2, updated_at=now()
         WHERE id=$3 AND tenant_id=$4`,
        [parseFloat(teacher_override_score) || 0, teacher_notes || '', rid, tid]
      );
      audit(req, 'peer_review_teacher_override', { rid, score: teacher_override_score });
      res.redirect('/school/peer-review/view-review/' + rid);
    } catch (e) {
      console.error('[PeerReview] teacher-override error:', e);
      res.redirect('/school/peer-review/view-review/' + req.params.id);
    }
  });

  /* ─── 10. PLAGIARISM FLAGGING ───────────────────────────────────── */
  app.post('/school/peer-review/flag-plagiarism', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.body.review_id, 10);
      const { plagiarism_notes } = req.body;
      await pool.query(
        `UPDATE peer_reviews SET plagiarism_flagged=true, plagiarism_notes=$1, updated_at=now()
         WHERE id=$2 AND tenant_id=$3`,
        [plagiarism_notes || '', rid, tid]
      );
      audit(req, 'peer_review_plagiarism_flagged', { rid });
      // Notify affected student
      const review = (await pool.query('SELECT reviewee_id FROM peer_reviews WHERE id=$1', [rid])).rows[0];
      if (review && queueEmail) {
        queueEmail(review.reviewee_id, 'Plagiarism Flag – Peer Review', 'Your submission has been flagged for potential plagiarism. Contact your teacher immediately.');
      }
      res.redirect('/school/peer-review/view-review/' + rid);
    } catch (e) {
      console.error('[PeerReview] flag-plagiarism error:', e);
      res.redirect('/school/peer-review');
    }
  });

  app.post('/school/peer-review/unflag-plagiarism', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.body.review_id, 10);
      await pool.query(
        `UPDATE peer_reviews SET plagiarism_flagged=false, plagiarism_notes='', updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [rid, tid]
      );
      audit(req, 'peer_review_plagiarism_unflagged', { rid });
      res.redirect('/school/peer-review/view-review/' + rid);
    } catch (e) {
      console.error('[PeerReview] unflag-plagiarism error:', e);
      res.redirect('/school/peer-review');
    }
  });

  /* ─── 11. NEXT ROUND ────────────────────────────────────────────── */
  app.post('/school/peer-review/next-round', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const aid = parseInt(req.body.assignment_id, 10);
      const a = (await pool.query(
        'SELECT * FROM peer_review_assignments WHERE id=$1 AND tenant_id=$2', [aid, tid]
      )).rows[0];
      if (!a) return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment not found.</div>', 'Next Round');
      if (a.round >= a.max_rounds) return ah(req, res, SKIP + '<div class="alert alert-warn">Maximum rounds reached.</div>', 'Next Round');

      const nextRound = a.round + 1;
      await pool.query(
        `UPDATE peer_review_assignments SET round=$1, status='assigned', updated_at=now()
         WHERE id=$2 AND tenant_id=$3`,
        [nextRound, aid, tid]
      );
      audit(req, 'peer_review_next_round', { aid, round: nextRound });

      if (queueEmail) {
        queueEmail(a.reviewer_id, 'Peer Review – Next Round', `Round ${nextRound} of "${a.title}" is now open. Please submit your review.`);
        queueEmail(a.reviewee_id, 'Peer Review – Next Round', `Round ${nextRound} of "${a.title}" has started.`);
      }

      res.redirect('/school/peer-review/view-assignment/' + aid);
    } catch (e) {
      console.error('[PeerReview] next-round error:', e);
      res.redirect('/school/peer-review');
    }
  });

  /* ─── 12. RUBRICS LIST ──────────────────────────────────────────── */
  app.get('/school/peer-review/rubrics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rubrics = (await pool.query(
        'SELECT * FROM review_rubrics WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]
      )).rows;

      let html = SKIP;
      html += '<div class="flex-between"><h2 style="margin:0">Review Rubrics</h2>';
      html += '<a href="/school/peer-review/rubrics/create" class="btn btn-success">+ New Rubric</a></div>';

      if (rubrics.length === 0) {
        html += '<div class="card mt-16"><p class="text-muted">No rubrics yet. Create one to standardize reviews.</p></div>';
      } else {
        for (const r of rubrics) {
          const criteria = Array.isArray(r.criteria) ? r.criteria : [];
          html += `<div class="card">`;
          html += `<div class="flex-between"><div><h3 style="margin:0">${esc(r.title)}</h3>`;
          html += `<span class="text-sm text-muted">${esc(r.subject || 'General')} &middot; Max Score: ${r.max_score} &middot; ${criteria.length} criteria</span></div>`;
          html += `<div class="flex">`;
          if (r.is_default) html += '<span class="badge badge-blue">Default</span> ';
          html += `<a href="/school/peer-review/rubrics/edit/${r.id}" class="btn btn-sm btn-outline">Edit</a> `;
          html += `<form method="POST" action="/school/peer-review/rubrics/delete/${r.id}" style="display:inline" onsubmit="return confirm('Delete this rubric?')">`
            + `<button type="submit" class="btn btn-danger btn-sm">Delete</button></form>`;
          html += `</div></div>`;
          if (criteria.length > 0) {
            html += '<table style="margin-top:8px"><tr><th>Criterion</th><th>Weight</th><th>Max</th></tr>';
            for (const c of criteria) {
              html += `<tr><td>${esc(c.name || c.label || '—')}</td><td>${c.weight || 1}</td><td>${c.max || c.points || 5}</td></tr>`;
            }
            html += '</table>';
          }
          html += '</div>';
        }
      }

      ah(req, res, html, 'Peer Review – Rubrics');
    } catch (e) {
      console.error('[PeerReview] rubrics error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading rubrics.</div>', 'Rubrics');
    }
  });

  /* ─── 13. CREATE RUBRIC ─────────────────────────────────────────── */
  app.get('/school/peer-review/rubrics/create', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP;
    html += '<h2 style="margin:0 0 16px">Create Review Rubric</h2>';
    html += '<form method="POST" action="/school/peer-review/rubrics/create" class="card">';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += '<div><label class="text-sm text-muted">Title *</label><input name="title" required placeholder="e.g. Essay Rubric"></div>';
    html += '<div><label class="text-sm text-muted">Subject</label><input name="subject" placeholder="English, Science…"></div>';
    html += '<div><label class="text-sm text-muted">Max Score</label><input name="max_score" type="number" min="1" max="100" value="20"></div>';
    html += '<div><label><input type="checkbox" name="is_default" value="1"> Set as Default</label></div>';
    html += '</div>';
    html += '<div class="mt-16"><h3>Criteria</h3><div id="criteria-container">';
    html += buildCriterionRow(0, 'Content Quality', 1, 5);
    html += buildCriterionRow(1, 'Originality', 1, 5);
    html += buildCriterionRow(2, 'Clarity', 1, 5);
    html += buildCriterionRow(3, 'Effort', 1, 5);
    html += '</div>';
    html += '<button type="button" onclick="addCriterion()" class="btn btn-sm btn-outline mt-8">+ Add Criterion</button></div>';
    html += '<div class="mt-16"><button type="submit" class="btn btn-success">Create Rubric</button> '
      + '<a href="/school/peer-review/rubrics" class="btn btn-outline">Cancel</a></div>';
    html += '</form>';
    html += addCriterionScript();
    ah(req, res, html, 'Peer Review – Create Rubric');
  });

  app.post('/school/peer-review/rubrics/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const { title, subject, max_score, is_default } = req.body;
      if (!title) return ah(req, res, SKIP + '<div class="alert alert-warn">Title is required.</div>', 'Create Rubric');

      const criteria = extractCriteria(req.body);
      const isDef = is_default === '1' || is_default === 'on';

      if (isDef) {
        await pool.query('UPDATE review_rubrics SET is_default=false WHERE tenant_id=$1', [tid]);
      }

      await pool.query(
        `INSERT INTO review_rubrics (tenant_id, title, criteria, max_score, subject, is_default)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, title, JSON.stringify(criteria), parseFloat(max_score) || 20, subject || '', isDef]
      );
      audit(req, 'review_rubric_created', { title });
      res.redirect('/school/peer-review/rubrics');
    } catch (e) {
      console.error('[PeerReview] create-rubric error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error creating rubric: ' + esc(e.message) + '</div>', 'Create Rubric');
    }
  });

  /* ─── 14. EDIT RUBRIC ───────────────────────────────────────────── */
  app.get('/school/peer-review/rubrics/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.params.id, 10);
      const r = (await pool.query('SELECT * FROM review_rubrics WHERE id=$1 AND tenant_id=$2', [rid, tid])).rows[0];
      if (!r) return ah(req, res, SKIP + '<div class="alert alert-warn">Rubric not found.</div>', 'Edit Rubric');

      const criteria = Array.isArray(r.criteria) ? r.criteria : [];
      let html = SKIP;
      html += `<h2 style="margin:0 0 16px">Edit Rubric: ${esc(r.title)}</h2>`;
      html += `<form method="POST" action="/school/peer-review/rubrics/edit/${rid}" class="card">`;
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
      html += `<div><label class="text-sm text-muted">Title *</label><input name="title" required value="${esc(r.title)}"></div>`;
      html += `<div><label class="text-sm text-muted">Subject</label><input name="subject" value="${esc(r.subject || '')}"></div>`;
      html += `<div><label class="text-sm text-muted">Max Score</label><input name="max_score" type="number" min="1" max="100" value="${r.max_score}"></div>`;
      html += `<div><label><input type="checkbox" name="is_default" value="1"${r.is_default ? ' checked' : ''}> Set as Default</label></div>`;
      html += '</div>';
      html += '<div class="mt-16"><h3>Criteria</h3><div id="criteria-container">';
      for (let i = 0; i < criteria.length; i++) {
        html += buildCriterionRow(i, criteria[i].name || criteria[i].label || '', criteria[i].weight || 1, criteria[i].max || criteria[i].points || 5);
      }
      html += '</div>';
      html += '<button type="button" onclick="addCriterion()" class="btn btn-sm btn-outline mt-8">+ Add Criterion</button></div>';
      html += `<div class="mt-16"><button type="submit" class="btn">Save Changes</button> `
        + `<a href="/school/peer-review/rubrics" class="btn btn-outline">Cancel</a></div>`;
      html += '</form>';
      html += addCriterionScript();
      ah(req, res, html, 'Peer Review – Edit Rubric');
    } catch (e) {
      console.error('[PeerReview] edit-rubric form error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading form.</div>', 'Edit Rubric');
    }
  });

  app.post('/school/peer-review/rubrics/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.params.id, 10);
      const { title, subject, max_score, is_default } = req.body;
      if (!title) return ah(req, res, SKIP + '<div class="alert alert-warn">Title is required.</div>', 'Edit Rubric');

      const criteria = extractCriteria(req.body);
      const isDef = is_default === '1' || is_default === 'on';

      if (isDef) {
        await pool.query('UPDATE review_rubrics SET is_default=false WHERE tenant_id=$1', [tid]);
      }

      await pool.query(
        `UPDATE review_rubrics SET title=$1, criteria=$2, max_score=$3, subject=$4,
         is_default=$5, updated_at=now() WHERE id=$6 AND tenant_id=$7`,
        [title, JSON.stringify(criteria), parseFloat(max_score) || 20, subject || '', isDef, rid, tid]
      );
      audit(req, 'review_rubric_updated', { rid });
      res.redirect('/school/peer-review/rubrics');
    } catch (e) {
      console.error('[PeerReview] edit-rubric post error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error updating rubric: ' + esc(e.message) + '</div>', 'Edit Rubric');
    }
  });

  /* ─── 15. DELETE RUBRIC ─────────────────────────────────────────── */
  app.post('/school/peer-review/rubrics/delete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rid = parseInt(req.params.id, 10);
      await pool.query('DELETE FROM review_rubrics WHERE id=$1 AND tenant_id=$2', [rid, tid]);
      audit(req, 'review_rubric_deleted', { rid });
      res.redirect('/school/peer-review/rubrics');
    } catch (e) {
      console.error('[PeerReview] delete-rubric error:', e);
      res.redirect('/school/peer-review/rubrics');
    }
  });

  /* ─── 16. MY REVIEWS (reviewer perspective) ─────────────────────── */
  app.get('/school/peer-review/my-reviews', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const uid = req.user.id;
      const tid = req.user.tenant_id;
      const { status } = req.query;

      let where = 'WHERE pra.tenant_id=$1 AND pra.reviewer_id=$2';
      const params = [tid, uid];
      if (status) {
        where += ' AND pra.status=$3';
        params.push(status);
      }

      const data = await pool.query(
        `SELECT pra.*, u.name AS reviewee_name,
                (SELECT COUNT(*)::int FROM peer_reviews pr WHERE pr.assignment_id=pra.id AND pr.reviewer_id=$1 AND pr.round=pra.round) AS has_review
         FROM peer_review_assignments pra
         LEFT JOIN users u ON u.id=pra.reviewee_id
         ${where} ORDER BY pra.due_date ASC NULLS LAST, pra.updated_at DESC LIMIT 50`,
        params
      );

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">My Reviews</h2>';

      html += '<div class="tab-bar">';
      html += `<a href="/school/peer-review/my-reviews" class="tab ${!status ? 'active' : ''}">All</a>`;
      html += `<a href="/school/peer-review/my-reviews?status=assigned" class="tab ${status === 'assigned' ? 'active' : ''}">Pending</a>`;
      html += `<a href="/school/peer-review/my-reviews?status=submitted" class="tab ${status === 'submitted' ? 'active' : ''}">Submitted</a>`;
      html += `<a href="/school/peer-review/my-reviews?status=overdue" class="tab ${status === 'overdue' ? 'active' : ''}">Overdue</a>`;
      html += '</div>';

      if (data.rows.length === 0) {
        html += '<div class="card"><p class="text-muted">No reviews assigned to you.</p></div>';
      } else {
        html += '<table><tr><th>Title</th><th>Reviewee</th><th>Due</th><th>Round</th><th>Status</th><th>Actions</th></tr>';
        for (const a of data.rows) {
          const revieweeName = a.anonymous ? 'Anonymous' : esc(a.reviewee_name || '—');
          html += '<tr>';
          html += `<td>${esc(a.title || 'Untitled')}</td>`;
          html += `<td>${revieweeName}</td>`;
          html += `<td>${fmtDate(a.due_date)}</td>`;
          html += `<td>${a.round}/${a.max_rounds}</td>`;
          html += `<td>${statusBadge(a.status)}</td>`;
          html += `<td>`;
          if (a.status !== 'submitted') {
            html += `<a href="/school/peer-review/submit-review?assignment_id=${a.id}" class="btn btn-sm btn-success">Submit Review</a> `;
          } else {
            html += `<a href="/school/peer-review/view-assignment/${a.id}" class="btn btn-sm btn-outline">View</a> `;
          }
          html += '</td></tr>';
        }
        html += '</table>';
      }

      ah(req, res, html, 'Peer Review – My Reviews');
    } catch (e) {
      console.error('[PeerReview] my-reviews error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading your reviews.</div>', 'My Reviews');
    }
  });

  /* ─── 17. MY SUBMISSIONS (reviewee perspective) ─────────────────── */
  app.get('/school/peer-review/my-submissions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const uid = req.user.id;
      const tid = req.user.tenant_id;

      const data = await pool.query(
        `SELECT pra.*, pr.id AS review_id, pr.overall_score, pr.comments, pr.submitted_at AS review_submitted_at,
                pr.content_quality_score, pr.originality_score, pr.clarity_score, pr.effort_score,
                pr.plagiarism_flagged, pr.round AS review_round
         FROM peer_review_assignments pra
         LEFT JOIN peer_reviews pr ON pr.assignment_id=pra.id AND pr.reviewee_id=$1 AND pr.tenant_id=$2
         WHERE pra.tenant_id=$2 AND pra.reviewee_id=$1
         ORDER BY pra.updated_at DESC LIMIT 50`,
        [uid, tid]
      );

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Reviews Received</h2>';

      if (data.rows.length === 0) {
        html += '<div class="card"><p class="text-muted">No reviews received yet.</p></div>';
      } else {
        for (const r of data.rows) {
          html += '<div class="card">';
          html += `<div class="flex-between"><strong>${esc(r.title || 'Untitled')}</strong>`;
          html += `${statusBadge(r.status)}</div>`;
          html += `<p class="text-muted text-sm mb-8">Round ${r.round}/${r.max_rounds}</p>`;
          if (r.review_id) {
            html += `<div class="grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">`;
            html += `<div>${pctBar(r.content_quality_score, 5)}</div>`;
            html += `<div>${pctBar(r.originality_score, 5)}</div>`;
            html += `<div>${pctBar(r.clarity_score, 5)}</div>`;
            html += `<div>${pctBar(r.effort_score, 5)}</div>`;
            html += `</div>`;
            html += `<div class="mt-8"><strong>Overall:</strong> ${pctBar(r.overall_score, 20, P)}</div>`;
            if (r.comments) html += `<p class="mt-8">${esc(r.comments)}</p>`;
            if (r.plagiarism_flagged) html += `<div class="alert alert-warn mt-8">⚠ Plagiarism Flagged</div>`;
          } else {
            html += '<p class="text-muted">Review not yet submitted.</p>';
          }
          html += '</div>';
        }
      }

      ah(req, res, html, 'Peer Review – Reviews Received');
    } catch (e) {
      console.error('[PeerReview] my-submissions error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading submissions.</div>', 'Reviews Received');
    }
  });

  /* ─── 18. STATISTICS ────────────────────────────────────────────── */
  app.get('/school/peer-review/statistics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;

      const overview = (await pool.query(`
        SELECT
          COUNT(DISTINCT pra.id)::int AS total_assignments,
          COUNT(DISTINCT pr.id)::int AS total_reviews,
          COUNT(DISTINCT pr.reviewer_id)::int AS unique_reviewers,
          COUNT(DISTINCT pr.reviewee_id)::int AS unique_reviewees,
          ROUND(AVG(pr.overall_score)::numeric, 2) AS avg_overall,
          ROUND(AVG(pr.content_quality_score)::numeric, 2) AS avg_content,
          ROUND(AVG(pr.originality_score)::numeric, 2) AS avg_originality,
          ROUND(AVG(pr.clarity_score)::numeric, 2) AS avg_clarity,
          ROUND(AVG(pr.effort_score)::numeric, 2) AS avg_effort,
          ROUND(AVG(pr.feedback_quality)::numeric, 2) AS avg_feedback_quality,
          COUNT(*) FILTER (WHERE pr.plagiarism_flagged)::int AS plagiarism_flags,
          ROUND(STDDEV(pr.overall_score)::numeric, 2) AS stddev_overall
        FROM peer_review_assignments pra
        LEFT JOIN peer_reviews pr ON pr.assignment_id=pra.id AND pr.tenant_id=pra.tenant_id
        WHERE pra.tenant_id=$1`, [tid]
      )).rows[0];

      // Score distribution
      const dist = (await pool.query(`
        SELECT
          CASE
            WHEN overall_score >= 18 THEN 'Excellent (18-20)'
            WHEN overall_score >= 14 THEN 'Good (14-17)'
            WHEN overall_score >= 10 THEN 'Average (10-13)'
            WHEN overall_score >= 6 THEN 'Below Avg (6-9)'
            ELSE 'Poor (0-5)'
          AS bucket,
          COUNT(*)::int AS cnt
        FROM peer_reviews WHERE tenant_id=$1 AND overall_score > 0
        GROUP BY bucket ORDER BY MIN(overall_score) DESC`, [tid]
      )).rows;

      // Per-round stats
      const rounds = (await pool.query(`
        SELECT pra.round, COUNT(pr.id)::int AS reviews,
               ROUND(AVG(pr.overall_score)::numeric, 2) AS avg_score
        FROM peer_review_assignments pra
        LEFT JOIN peer_reviews pr ON pr.assignment_id=pra.id AND pr.round=pra.round
        WHERE pra.tenant_id=$1
        GROUP BY pra.round ORDER BY pra.round`, [tid]
      )).rows;

      // Top reviewers (by feedback quality)
      const topReviewers = (await pool.query(`
        SELECT u.name, COUNT(pr.id)::int AS reviews_count,
               ROUND(AVG(pr.feedback_quality)::numeric, 2) AS avg_fb_quality,
               ROUND(AVG(pr.overall_score)::numeric, 2) AS avg_given_score
        FROM peer_reviews pr
        JOIN users u ON u.id=pr.reviewer_id
        WHERE pr.tenant_id=$1
        GROUP BY u.name ORDER BY avg_fb_quality DESC LIMIT 10`, [tid]
      )).rows;

      // Completion rate by assignment
      const completion = (await pool.query(`
        SELECT pra.title, pra.round, pra.max_rounds,
               COUNT(pr.id)::int AS reviews_submitted,
               (SELECT COUNT(*)::int FROM peer_review_assignments WHERE assignment_id=pra.assignment_id AND tenant_id=$1) AS total_pairs
        FROM peer_review_assignments pra
        LEFT JOIN peer_reviews pr ON pr.assignment_id=pra.id AND pr.round=pra.round
        WHERE pra.tenant_id=$1
        GROUP BY pra.id, pra.title, pra.round, pra.max_rounds, pra.assignment_id
        ORDER BY pra.title, pra.round`, [tid]
      )).rows;

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Peer Review Statistics</h2>';

      // Overview cards
      html += '<div class="grid">';
      html += `<div class="stat-card"><h3>${overview.total_assignments || 0}</h3><p>Assignments</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#059669,#10b981)"><h3>${overview.total_reviews || 0}</h3><p>Reviews Submitted</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#7c3aed,#a78bfa)"><h3>${overview.avg_overall || '—'}</h3><p>Avg Overall Score</p></div>`;
      html += `<div class="stat-card" style="background:linear-gradient(135deg,#d97706,#fbbf24)"><h3>${overview.plagiarism_flags || 0}</h3><p>Plagiarism Flags</p></div>`;
      html += '</div>';

      // Score breakdown
      html += '<div class="card mt-16"><h3>Average Scores by Criterion</h3>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      html += `<div><span class="text-sm">Content Quality</span>${pctBar(overview.avg_content || 0, 5)}</div>`;
      html += `<div><span class="text-sm">Originality</span>${pctBar(overview.avg_originality || 0, 5)}</div>`;
      html += `<div><span class="text-sm">Clarity</span>${pctBar(overview.avg_clarity || 0, 5)}</div>`;
      html += `<div><span class="text-sm">Effort</span>${pctBar(overview.avg_effort || 0, 5)}</div>`;
      html += `<div><span class="text-sm">Feedback Quality</span>${pctBar(overview.avg_feedback_quality || 0, 5)}</div>`;
      html += `<div><span class="text-sm">Std Deviation</span><strong>${overview.stddev_overall || 0}</strong></div>`;
      html += '</div></div>';

      // Score distribution
      html += '<div class="card mt-16"><h3>Score Distribution</h3>';
      if (dist.length > 0) {
        const maxCnt = Math.max(...dist.map(d => d.cnt), 1);
        html += '<table><tr><th>Range</th><th>Count</th><th>Bar</th></tr>';
        for (const d of dist) {
          const pct = Math.round((d.cnt / maxCnt) * 100);
          const colors = { 'Excellent (18-20)': '#059669', 'Good (14-17)': '#4f46e5', 'Average (10-13)': '#d97706', 'Below Avg (6-9)': '#ea580c', 'Poor (0-5)': '#dc2626' };
          html += `<tr><td>${d.bucket}</td><td>${d.cnt}</td><td><div class="progress-bar" style="width:200px"><div class="progress-fill" style="width:${pct}%;background:${colors[d.bucket] || P}"></div></div></td></tr>`;
        }
        html += '</table>';
      } else {
        html += '<p class="text-muted">No review data available.</p>';
      }
      html += '</div>';

      // Per-round progress
      html += '<div class="card mt-16"><h3>Progress by Round</h3>';
      if (rounds.length > 0) {
        html += '<table><tr><th>Round</th><th>Reviews</th><th>Avg Score</th></tr>';
        for (const r of rounds) {
          html += `<tr><td>${r.round}</td><td>${r.reviews}</td><td>${r.avg_score || '—'}</td></tr>`;
        }
        html += '</table>';
      } else {
        html += '<p class="text-muted">No round data.</p>';
      }
      html += '</div>';

      // Top reviewers
      html += '<div class="card mt-16"><h3>Top Reviewers (by Feedback Quality)</h3>';
      if (topReviewers.length > 0) {
        html += '<table><tr><th>Reviewer</th><th>Reviews</th><th>Avg Feedback Quality</th><th>Avg Score Given</th></tr>';
        for (const r of topReviewers) {
          html += `<tr><td>${esc(r.name)}</td><td>${r.reviews_count}</td><td>${pctBar(r.avg_fb_quality, 5)}</td><td>${r.avg_given_score}</td></tr>`;
        }
        html += '</table>';
      } else {
        html += '<p class="text-muted">No reviewer data.</p>';
      }
      html += '</div>';

      // Completion rates
      html += '<div class="card mt-16"><h3>Completion Rates</h3>';
      if (completion.length > 0) {
        html += '<table><tr><th>Assignment</th><th>Round</th><th>Submitted</th><th>Total</th><th>Progress</th></tr>';
        for (const c of completion) {
          const total = c.total_pairs || 1;
          const pct = Math.round((c.reviews_submitted / total) * 100);
          const color = pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
          html += `<tr><td>${esc(c.title || '—')}</td><td>${c.round}/${c.max_rounds}</td><td>${c.reviews_submitted}</td><td>${c.total_pairs}</td>`;
          html += `<td><div class="progress-bar" style="width:100px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div> ${pct}%</td></tr>`;
        }
        html += '</table>';
      } else {
        html += '<p class="text-muted">No completion data.</p>';
      }
      html += '</div>';

      ah(req, res, html, 'Peer Review – Statistics');
    } catch (e) {
      console.error('[PeerReview] statistics error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading statistics.</div>', 'Statistics');
    }
  });

  /* ─── 19. CALIBRATION ───────────────────────────────────────────── */
  app.get('/school/peer-review/calibration', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;

      // Find reviewees with multiple reviews to check reviewer alignment
      const calibration = (await pool.query(`
        SELECT pr.reviewee_id, u.name AS reviewee_name,
               COUNT(DISTINCT pr.reviewer_id)::int AS num_reviewers,
               ROUND(AVG(pr.overall_score)::numeric, 2) AS avg_score,
               ROUND(STDDEV(pr.overall_score)::numeric, 2) AS stddev,
               MIN(pr.overall_score)::float AS min_score,
               MAX(pr.overall_score)::float AS max_score,
               ARRAY_AGG(DISTINCT pr.reviewer_id) AS reviewer_ids
        FROM peer_reviews pr
        JOIN users u ON u.id=pr.reviewee_id
        WHERE pr.tenant_id=$1 AND pr.plagiarism_flagged=false
        GROUP BY pr.reviewee_id, u.name
        HAVING COUNT(DISTINCT pr.reviewer_id) >= 2
        ORDER BY stddev DESC NULLS LAST
        LIMIT 30`, [tid]
      )).rows;

      // Reviewer leniency/strictness
      const reviewerProfile = (await pool.query(`
        SELECT pr.reviewer_id, u.name AS reviewer_name,
               COUNT(pr.id)::int AS total_reviews,
               ROUND(AVG(pr.overall_score)::numeric, 2) AS avg_given,
               ROUND(AVG(pr.feedback_quality)::numeric, 2) AS avg_fb_quality
        FROM peer_reviews pr
        JOIN users u ON u.id=pr.reviewer_id
        WHERE pr.tenant_id=$1
        GROUP BY pr.reviewer_id, u.name
        ORDER BY avg_given DESC`, [tid]
      )).rows;

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Grade Calibration</h2>';
      html += '<div class="alert alert-info">This view shows how aligned reviewers are. High standard deviation indicates reviewers disagree significantly.</div>';

      // Calibration table
      html += '<div class="card mt-16"><h3>Review Alignment by Submission</h3>';
      if (calibration.length === 0) {
        html += '<p class="text-muted">Need at least 2 reviewers per submission to show calibration data.</p>';
      } else {
        html += '<table><tr><th>Student</th><th>Reviewers</th><th>Avg Score</th><th>Std Dev</th><th>Range</th><th>Alignment</th></tr>';
        for (const c of calibration) {
          const alignment = c.stddev === null ? 'Perfect' : c.stddev <= 1 ? 'Good' : c.stddev <= 3 ? 'Moderate' : 'Poor';
          const alignBadge = alignment === 'Perfect' ? 'badge-green' : alignment === 'Good' ? 'badge-green' : alignment === 'Moderate' ? 'badge-yellow' : 'badge-red';
          html += `<tr><td>${esc(c.reviewee_name)}</td><td>${c.num_reviewers}</td>`;
          html += `<td>${c.avg_score}</td><td>${c.stddev || '0.00'}</td>`;
          html += `<td>${c.min_score} – ${c.max_score}</td>`;
          html += `<td><span class="badge ${alignBadge}">${alignment}</span></td></tr>`;
        }
        html += '</table>';
      }
      html += '</div>';

      // Reviewer profile
      html += '<div class="card mt-16"><h3>Reviewer Profiles (Lenient → Strict)</h3>';
      if (reviewerProfile.length === 0) {
        html += '<p class="text-muted">No reviewer data available.</p>';
      } else {
        html += '<table><tr><th>Reviewer</th><th>Reviews</th><th>Avg Score Given</th><th>Feedback Quality</th><th>Profile</th></tr>';
        const maxAvg = Math.max(...reviewerProfile.map(r => parseFloat(r.avg_given) || 0), 1);
        for (const rp of reviewerProfile) {
          const profile = rp.avg_given >= 16 ? 'Lenient' : rp.avg_given >= 12 ? 'Balanced' : rp.avg_given >= 8 ? 'Moderate' : 'Strict';
          const profBadge = profile === 'Lenient' ? 'badge-yellow' : profile === 'Balanced' ? 'badge-green' : profile === 'Moderate' ? 'badge-blue' : 'badge-red';
          html += `<tr><td>${esc(rp.reviewer_name)}</td><td>${rp.total_reviews}</td>`;
          html += `<td>${pctBar(rp.avg_given, 20)}</td>`;
          html += `<td>${pctBar(rp.avg_fb_quality, 5)}</td>`;
          html += `<td><span class="badge ${profBadge}">${profile}</span></td></tr>`;
        }
        html += '</table>';
      }
      html += '</div>';

      // Calibration recommendations
      html += '<div class="card mt-16"><h3>Recommendations</h3><ul>';
      html += '<li>Reviewers with "Strict" profiles may need calibration guidance to align with peer averages.</li>';
      html += '<li>Submissions with "Poor" alignment may warrant teacher review to reconcile scoring differences.</li>';
      html += '<li>Consider pairing lenient reviewers with strict ones in future assignments.</li>';
      html += '</ul></div>';

      ah(req, res, html, 'Peer Review – Calibration');
    } catch (e) {
      console.error('[PeerReview] calibration error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading calibration data.</div>', 'Calibration');
    }
  });

  /* ─── 20. OVERDUE REVIEWS ───────────────────────────────────────── */
  app.get('/school/peer-review/overdue', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const isTeacher = req.user.role === 'teacher' || req.user.role === 'admin';
      const uid = req.user.id;

      // Mark overdue
      await pool.query(
        `UPDATE peer_review_assignments SET status='overdue', updated_at=now()
         WHERE tenant_id=$1 AND due_date < CURRENT_DATE AND status NOT IN ('submitted','completed','overdue')`,
        [tid]
      );

      let where = 'WHERE pra.tenant_id=$1 AND pra.status=\'overdue\'';
      const params = [tid];
      if (!isTeacher) {
        where += ' AND pra.reviewer_id=$2';
        params.push(uid);
      }

      const data = await pool.query(
        `SELECT pra.*, u1.name AS reviewer_name, u2.name AS reviewee_name,
                CURRENT_DATE - pra.due_date AS days_overdue
         FROM peer_review_assignments pra
         LEFT JOIN users u1 ON u1.id=pra.reviewer_id
         LEFT JOIN users u2 ON u2.id=pra.reviewee_id
         ${where} ORDER BY pra.due_date ASC`,
        params
      );

      let html = SKIP;
      html += '<h2 style="margin:0 0 16px">Overdue Reviews</h2>';

      if (data.rows.length === 0) {
        html += '<div class="card"><div class="alert alert-success">✓ No overdue reviews. Great job!</div></div>';
      } else {
        html += `<div class="alert alert-warn">${data.rows.length} overdue review(s) found.</div>`;
        html += '<table><tr><th>Title</th><th>Reviewer</th><th>Reviewee</th><th>Due Date</th><th>Days Overdue</th><th>Round</th>';
        if (isTeacher) html += '<th>Actions</th>';
        html += '</tr>';
        for (const a of data.rows) {
          html += '<tr>';
          html += `<td>${esc(a.title || 'Untitled')}</td>`;
          html += `<td>${esc(a.reviewer_name || '—')}</td>`;
          html += `<td>${esc(a.reviewee_name || '—')}</td>`;
          html += `<td>${fmtDate(a.due_date)}</td>`;
          html += `<td><span class="badge badge-red">${a.days_overdue} days</span></td>`;
          html += `<td>${a.round}/${a.max_rounds}</td>`;
          if (isTeacher) {
            html += `<td class="flex">`;
            html += `<a href="/school/peer-review/view-assignment/${a.id}" class="btn btn-sm">View</a> `;
            if (queueEmail) {
              html += `<form method="POST" action="/school/peer-review/nudge-reviewer" style="display:inline">`;
              html += `<input type="hidden" name="assignment_id" value="${a.id}">`;
              html += `<button type="submit" class="btn btn-sm btn-outline">Send Reminder</button></form>`;
            }
            html += '</td>';
          }
          html += '</tr>';
        }
        html += '</table>';
      }

      ah(req, res, html, 'Peer Review – Overdue');
    } catch (e) {
      console.error('[PeerReview] overdue error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error loading overdue reviews.</div>', 'Overdue');
    }
  });

  /* ─── 21. NUDGE REVIEWER ────────────────────────────────────────── */
  app.post('/school/peer-review/nudge-reviewer', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const aid = parseInt(req.body.assignment_id, 10);
      const a = (await pool.query(
        'SELECT pra.*, u.email FROM peer_review_assignments pra JOIN users u ON u.id=pra.reviewer_id WHERE pra.id=$1 AND pra.tenant_id=$2',
        [aid, tid]
      )).rows[0];
      if (a && queueEmail) {
        queueEmail(a.reviewer_id, 'Peer Review – Overdue Reminder',
          `Your peer review for "${a.title}" is overdue. It was due on ${fmtDate(a.due_date)}. Please submit as soon as possible.`);
        audit(req, 'peer_review_nudge', { aid, reviewer_id: a.reviewer_id });
      }
      res.redirect('/school/peer-review/overdue');
    } catch (e) {
      console.error('[PeerReview] nudge error:', e);
      res.redirect('/school/peer-review/overdue');
    }
  });

  /* ─── 22. ASSIGN REVIEWERS (standalone) ─────────────────────────── */
  app.post('/school/peer-review/assign-reviewers', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const { assignment_id, reviewer_ids, reviewee_ids } = req.body;
      const aId = parseInt(assignment_id, 10);

      if (!aId) return ah(req, res, SKIP + '<div class="alert alert-warn">Assignment ID required.</div>', 'Assign');

      // Support comma-separated or JSON array
      const parseIds = (val) => {
        if (Array.isArray(val)) return val.map(Number).filter(n => n > 0);
        if (typeof val === 'string') {
          try { return JSON.parse(val).map(Number).filter(n => n > 0); } catch (_) { /* fallthrough */ }
          return val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
        }
        return [];
      };
      const reviewers = parseIds(reviewer_ids);
      const reviewees = parseIds(reviewee_ids);

      if (reviewers.length === 0 || reviewees.length === 0) {
        return ah(req, res, SKIP + '<div class="alert alert-warn">Provide reviewer and reviewee IDs.</div>', 'Assign');
      }

      let count = 0;
      for (const rev of reviewers) {
        for (const revi of reviewees) {
          if (rev !== revi) {
            await pool.query(
              `INSERT INTO peer_review_assignments (tenant_id, assignment_id, reviewer_id, reviewee_id, status, round)
               VALUES ($1,$2,$3,$4,'assigned',1)`,
              [tid, aId, rev, revi]
            );
            count++;
          }
        }
      }

      audit(req, 'peer_review_reviewers_assigned', { assignment_id: aId, pairs: count });
      ah(req, res, SKIP + `<div class="alert alert-success">Assigned ${count} reviewer-reviewee pair(s).</div>`, 'Assign Reviewers');
    } catch (e) {
      console.error('[PeerReview] assign-reviewers error:', e);
      ah(req, res, SKIP + '<div class="alert alert-warn">Error: ' + esc(e.message) + '</div>', 'Assign');
    }
  });

  /* ─── helpers ────────────────────────────────────────────────────── */
  function buildCriterionRow(idx, name, weight, max) {
    return `<div class="flex mb-8" id="criterion_${idx}">`
      + `<input name="crit_name_${idx}" placeholder="Criterion name" value="${esc(name || '')}" style="flex:2">`
      + `<input name="crit_weight_${idx}" type="number" min="0.1" step="0.1" value="${weight || 1}" style="flex:1" title="Weight">`
      + `<input name="crit_max_${idx}" type="number" min="1" value="${max || 5}" style="flex:1" title="Max points">`
      + `<button type="button" onclick="document.getElementById('criterion_${idx}').remove()" class="btn btn-danger btn-sm">×</button>`
      + '</div>';
  }

  function addCriterionScript() {
    const startIdx = 100;
    return `<script>var _cc=${startIdx};`
      + `function addCriterion(){`
      + `var c=document.getElementById("criteria-container");`
      + `var d=document.createElement("div");d.className="flex mb-8";d.id="criterion_"+_cc;`
      + `d.innerHTML='<input name="crit_name_'+_cc+'" placeholder="Criterion name" style="flex:2">'`
      + `+'<input name="crit_weight_'+_cc+'" type="number" min="0.1" step="0.1" value="1" style="flex:1" title="Weight">'`
      + `+'<input name="crit_max_'+_cc+'" type="number" min="1" value="5" style="flex:1" title="Max points">'`
      + `+'<button type="button" onclick="document.getElementById(\\x27criterion_'+_cc+'\\x27).remove()" class="btn btn-danger btn-sm">&times;</button>';`
      + `c.appendChild(d);_cc++;}</script>`;
  }

  function extractCriteria(body) {
    const criteria = [];
    let idx = 0;
    while (body[`crit_name_${idx}`] !== undefined) {
      const name = body[`crit_name_${idx}`];
      if (name && name.trim()) {
        criteria.push({
          name: name.trim(),
          weight: parseFloat(body[`crit_weight_${idx}`]) || 1,
          max: parseInt(body[`crit_max_${idx}`], 10) || 5
        });
      }
      idx++;
    }
    return criteria.length > 0 ? criteria : [
      { name: 'Content Quality', weight: 1, max: 5 },
      { name: 'Originality', weight: 1, max: 5 },
      { name: 'Clarity', weight: 1, max: 5 },
      { name: 'Effort', weight: 1, max: 5 }
    ];
  }

  console.log('[PeerReview] Module loaded – 22 routes registered');
};
