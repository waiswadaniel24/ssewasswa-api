// ============================================================
// HOMEWORK & ASSIGNMENTS MODULE — Multi-Tenant SaaS Platform
// Assignment CRUD, submissions, grading with rubrics, calendar
// view, plagiarism flags, parent notifications, statistics.
// ============================================================
// Usage in server.js:
//   const homework = require('./homework');
//   homework(app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis });
// ============================================================

'use strict';

module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis }) => {

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const today = () => new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const VALID_SUB_TYPES = ['online', 'file', 'in-class'];
  const VALID_STATUSES = ['draft', 'submitted', 'late', 'graded'];
  const VALID_FLAG_STATUSES = ['pending_review', 'reviewed', 'dismissed', 'confirmed'];

  const errorRes = (res, status, msg, details) => {
    const body = { success: false, error: msg };
    if (details) body.details = details;
    return res.status(status).json(body);
  };
  const ok = (res, data, code) => res.status(code || 200).json({ success: true, data });

  // Trigram-based text similarity for plagiarism detection
  function textSimilarity(a, b) {
    if (!a || !b || a.trim().length < 20 || b.trim().length < 20) return 0;
    const words = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    const trigrams = (t) => {
      const w = words(t), set = new Set();
      for (let i = 0; i < w.length - 2; i++) set.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
      return set;
    };
    const ta = trigrams(a), tb = trigrams(b);
    if (ta.size === 0 || tb.size === 0) return 0;
    let inter = 0;
    for (const t of ta) { if (tb.has(t)) inter++; }
    const union = ta.size + tb.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  // ─── Database Migrations ──────────────────────────────────
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Homework] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS homework_assignments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT,
        subject_id INTEGER, class_id INTEGER, teacher_id INTEGER,
        due_date TIMESTAMPTZ, total_marks NUMERIC(6,2) DEFAULT 100,
        submission_type VARCHAR(20) DEFAULT 'online',
        instructions JSONB DEFAULT '[]',
        is_published BOOLEAN DEFAULT false, grades_visible BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS homework_submissions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        content TEXT, files JSONB DEFAULT '[]',
        submitted_at TIMESTAMPTZ, status VARCHAR(20) DEFAULT 'draft',
        marks NUMERIC(6,2), feedback TEXT, rubric_scores JSONB,
        graded_by INTEGER, graded_at TIMESTAMPTZ, is_late BOOLEAN DEFAULT false,
        plagiarism_flag JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS homework_rubric (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        assignment_id INTEGER NOT NULL, criteria JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS homework_parent_notifications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        assignment_id INTEGER, student_id INTEGER NOT NULL, parent_id INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL, message TEXT,
        acknowledged BOOLEAN DEFAULT false, acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_hw_assign_tenant ON homework_assignments(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_assign_class ON homework_assignments(class_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_assign_teacher ON homework_assignments(teacher_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_sub_tenant ON homework_submissions(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_sub_assign ON homework_submissions(assignment_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_sub_student ON homework_submissions(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_rubric_tenant ON homework_rubric(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_pn_tenant ON homework_parent_notifications(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hw_pn_student ON homework_parent_notifications(student_id)',
      ]) { try { await c.query(sql); } catch (_) {} }
      console.log('[Homework] Migrations applied successfully');
    } catch (e) { console.error('[Homework] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ASSIGNMENTS CRUD
  // ============================================================

  // POST /api/homework/assignments — Create assignment
  app.post('/api/homework/assignments', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { title, description, subject_id, class_id, due_date, total_marks, submission_type, instructions } = req.body;
    if (!title?.trim()) return errorRes(res, 400, 'Title is required');
    if (submission_type && !VALID_SUB_TYPES.includes(submission_type))
      return errorRes(res, 400, 'Invalid submission type', { valid: VALID_SUB_TYPES });
    if (total_marks !== undefined && (Number(total_marks) < 0 || Number(total_marks) > 10000))
      return errorRes(res, 400, 'Total marks must be between 0 and 10000');

    let parsedInstr = [];
    if (instructions) {
      try { parsedInstr = Array.isArray(instructions) ? instructions : JSON.parse(instructions); }
      catch { return errorRes(res, 400, 'Invalid instructions — expected JSON array'); }
    }

    const result = await pool.query(
      `INSERT INTO homework_assignments (tenant_id, title, description, subject_id, class_id, teacher_id, due_date, total_marks, submission_type, instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tid, title.trim(), description || null, subject_id || null, class_id || null, req.user.id,
       due_date || null, total_marks || 100, submission_type || 'online', JSON.stringify(parsedInstr)]
    );

    // Notify parents of new assignment
    try {
      if (class_id) {
        const students = await pool.query(
          `SELECT id, parent_id FROM students WHERE tenant_id = $1 AND class_id = $2`, [tid, class_id]);
        for (const s of students.rows) {
          if (s.parent_id) {
            await pool.query(
              `INSERT INTO homework_parent_notifications (tenant_id, assignment_id, student_id, parent_id, type, message)
               VALUES ($1,$2,$3,$4,'new_assignment',$5)`,
              [tid, result.rows[0].id, s.id, s.parent_id, `New homework: "${title.trim()}". Due: ${due_date || 'No deadline'}.`]
            );
          }
        }
      }
    } catch (e) { console.error('[Homework] Notification error:', e.message); }

    wsBroadcast(tid, 'homework:assignment_created', { assignment_id: result.rows[0].id, title, class_id });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/homework/assignments — List assignments
  app.get('/api/homework/assignments', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { class_id, subject_id, teacher_id, is_published, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name
               FROM homework_assignments ha
               LEFT JOIN users u ON u.id = ha.teacher_id LEFT JOIN subjects sub ON sub.id = ha.subject_id
               LEFT JOIN classes c ON c.id = ha.class_id WHERE ha.tenant_id = $1`;
    const params = [tid];
    let pi = 2;
    if (class_id) { sql += ` AND ha.class_id=$${pi}`; params.push(class_id); pi++; }
    if (subject_id) { sql += ` AND ha.subject_id=$${pi}`; params.push(subject_id); pi++; }
    if (teacher_id) { sql += ` AND ha.teacher_id=$${pi}`; params.push(teacher_id); pi++; }
    if (is_published !== undefined) { sql += ` AND ha.is_published=$${pi}`; params.push(is_published === 'true'); pi++; }
    sql += ` ORDER BY ha.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const [rows, cnt] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM homework_assignments WHERE tenant_id=$1`, [tid])
    ]);
    ok(res, { assignments: rows.rows, pagination: { page: pn, limit: ln, total: cnt.rows[0].total, pages: Math.ceil(cnt.rows[0].total / ln) } });
  }));

  // GET /api/homework/assignments/:id — Single assignment with rubric & submission stats
  app.get('/api/homework/assignments/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const [assignment, rubric, stats] = await Promise.all([
      pool.query(`SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name
        FROM homework_assignments ha LEFT JOIN users u ON u.id=ha.teacher_id
        LEFT JOIN subjects sub ON sub.id=ha.subject_id LEFT JOIN classes c ON c.id=ha.class_id
        WHERE ha.id=$1 AND ha.tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT * FROM homework_rubric WHERE assignment_id=$1 AND tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status IN ('submitted','graded')) AS submitted,
        COUNT(*) FILTER(WHERE is_late) AS late, COUNT(*) FILTER(WHERE status='graded') AS graded
        FROM homework_submissions WHERE assignment_id=$1 AND tenant_id=$2`, [req.params.id, tid]),
    ]);
    if (!assignment.rows[0]) return errorRes(res, 404, 'Assignment not found');
    ok(res, { assignment: assignment.rows[0], rubric: rubric.rows[0] || null, submission_stats: stats.rows[0] });
  }));

  // PUT /api/homework/assignments/:id — Update assignment
  app.put('/api/homework/assignments/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { title, description, subject_id, class_id, due_date, total_marks, submission_type, instructions, is_published, grades_visible } = req.body;
    const exists = await pool.query(`SELECT id FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!exists.rows[0]) return errorRes(res, 404, 'Assignment not found');
    if (submission_type && !VALID_SUB_TYPES.includes(submission_type))
      return errorRes(res, 400, 'Invalid submission type', { valid: VALID_SUB_TYPES });

    let parsedInstr = null;
    if (instructions !== undefined) {
      try { parsedInstr = JSON.stringify(Array.isArray(instructions) ? instructions : JSON.parse(instructions)); }
      catch { return errorRes(res, 400, 'Invalid instructions format'); }
    }

    const result = await pool.query(
      `UPDATE homework_assignments SET title=COALESCE($1,title), description=COALESCE($2,description),
       subject_id=COALESCE($3,subject_id), class_id=COALESCE($4,class_id), due_date=COALESCE($5,due_date),
       total_marks=COALESCE($6,total_marks), submission_type=COALESCE($7,submission_type),
       instructions=COALESCE($8,instructions), is_published=COALESCE($9,is_published),
       grades_visible=COALESCE($10,grades_visible), updated_at=NOW()
       WHERE id=$11 AND tenant_id=$12 RETURNING *`,
      [title||null, description||null, subject_id||null, class_id||null, due_date||null,
       total_marks||null, submission_type||null, parsedInstr,
       is_published!==undefined ? is_published : null, grades_visible!==undefined ? grades_visible : null,
       req.params.id, tid]
    );
    wsBroadcast(tid, 'homework:assignment_updated', { assignment_id: req.params.id });
    ok(res, result.rows[0]);
  }));

  // DELETE /api/homework/assignments/:id
  app.delete('/api/homework/assignments/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const result = await pool.query(`DELETE FROM homework_assignments WHERE id=$1 AND tenant_id=$2 RETURNING id`, [req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Assignment not found');
    wsBroadcast(tid, 'homework:assignment_deleted', { assignment_id: req.params.id });
    ok(res, { deleted: true });
  }));

  // ============================================================
  // SUBMISSIONS
  // ============================================================

  // POST /api/homework/assignments/:id/submit — Submit or resubmit work
  app.post('/api/homework/assignments/:id/submit', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id, assignId = req.params.id;
    const { content, files } = req.body;

    const assignment = await pool.query(`SELECT * FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [assignId, tid]);
    if (!assignment.rows[0]) return errorRes(res, 404, 'Assignment not found');
    if (!assignment.rows[0].is_published) return errorRes(res, 400, 'Assignment is not published');

    const isLate = assignment.rows[0].due_date && new Date() > new Date(assignment.rows[0].due_date);
    const status = isLate ? 'late' : 'submitted';

    let parsedFiles = [];
    if (files) {
      try { parsedFiles = Array.isArray(files) ? files : JSON.parse(files); }
      catch { return errorRes(res, 400, 'Invalid files format — expected JSON array'); }
    }

    const existing = await pool.query(
      `SELECT id FROM homework_submissions WHERE assignment_id=$1 AND student_id=$2 AND tenant_id=$3`, [assignId, userId, tid]);

    let result;
    if (existing.rows[0]) {
      result = await pool.query(
        `UPDATE homework_submissions SET content=$1, files=$2, submitted_at=NOW(), status=$3, is_late=$4
         WHERE id=$5 AND tenant_id=$6 RETURNING *`,
        [content || null, JSON.stringify(parsedFiles), status, isLate, existing.rows[0].id, tid]);
    } else {
      result = await pool.query(
        `INSERT INTO homework_submissions (tenant_id, assignment_id, student_id, content, files, submitted_at, status, is_late)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *`,
        [tid, assignId, userId, content || null, JSON.stringify(parsedFiles), status, isLate]);
    }
    wsBroadcast(tid, 'homework:submission', { assignment_id: assignId, student_id: userId, status });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/homework/assignments/:id/submissions — List all submissions for assignment
  app.get('/api/homework/assignments/:id/submissions', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { status, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT hs.*, u.name AS student_name, ug.name AS graded_by_name
               FROM homework_submissions hs
               LEFT JOIN users u ON u.id=hs.student_id LEFT JOIN users ug ON ug.id=hs.graded_by
               WHERE hs.assignment_id=$1 AND hs.tenant_id=$2`;
    const params = [req.params.id, tid];
    if (status && VALID_STATUSES.includes(status)) { sql += ` AND hs.status=$3`; params.push(status); }
    sql += ` ORDER BY hs.submitted_at DESC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(ln, offset);

    const rows = await pool.query(sql, params);
    ok(res, { submissions: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // GET /api/homework/my-submissions — Current student's submissions
  app.get('/api/homework/my-submissions', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const rows = await pool.query(
      `SELECT hs.*, ha.title AS assignment_title, ha.total_marks, ha.due_date, ha.grades_visible,
              sub.name AS subject_name, c.name AS class_name
       FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
       LEFT JOIN subjects sub ON sub.id=ha.subject_id LEFT JOIN classes c ON c.id=ha.class_id
       WHERE hs.student_id=$2 AND hs.tenant_id=$1 ORDER BY hs.submitted_at DESC NULLS LAST`, [tid, userId]);
    ok(res, { submissions: rows.rows });
  }));

  // ============================================================
  // GRADING & FEEDBACK
  // ============================================================

  // POST /api/homework/assignments/:id/rubric — Set grading rubric
  app.post('/api/homework/assignments/:id/rubric', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const { criteria } = req.body;
    if (!criteria || !Array.isArray(criteria) || criteria.length === 0 || criteria.length > 20)
      return errorRes(res, 400, 'Criteria must be an array of 1-20 items with {name, max_marks, description}');
    if (!criteria.every(c => c.name && Number(c.max_marks) > 0 && typeof c.description === 'string'))
      return errorRes(res, 400, 'Each criterion needs name, max_marks (positive number), description');

    const assign = await pool.query(`SELECT id FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [assignId, tid]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');

    const existing = await pool.query(`SELECT id FROM homework_rubric WHERE assignment_id=$1 AND tenant_id=$2`, [assignId, tid]);
    const rubricData = JSON.stringify(criteria);
    let result;
    if (existing.rows[0]) {
      result = await pool.query(`UPDATE homework_rubric SET criteria=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *`, [rubricData, existing.rows[0].id, tid]);
    } else {
      result = await pool.query(`INSERT INTO homework_rubric (tenant_id, assignment_id, criteria) VALUES ($1,$2,$3) RETURNING *`, [tid, assignId, rubricData]);
    }

    const totalFromRubric = criteria.reduce((s, c) => s + Number(c.max_marks), 0);
    await pool.query(`UPDATE homework_assignments SET total_marks=$1 WHERE id=$2 AND tenant_id=$3`, [totalFromRubric, assignId, tid]);
    ok(res, result.rows[0]);
  }));

  // POST /api/homework/submissions/:id/grade — Grade a submission
  app.post('/api/homework/submissions/:id/grade', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, subId = req.params.id, graderId = req.user.id;
    const { marks, feedback, rubric_scores } = req.body;

    const submission = await pool.query(
      `SELECT hs.*, ha.total_marks FROM homework_submissions hs
       JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
       WHERE hs.id=$2 AND hs.tenant_id=$1`, [tid, subId]);
    if (!submission.rows[0]) return errorRes(res, 404, 'Submission not found');

    const total = Number(submission.rows[0].total_marks) || 100;
    if (marks !== undefined && (Number(marks) < 0 || Number(marks) > total))
      return errorRes(res, 400, `Marks must be between 0 and ${total}`);

    let rubricJson = null;
    if (rubric_scores) {
      try { rubricJson = JSON.stringify(Array.isArray(rubric_scores) ? rubric_scores : JSON.parse(rubric_scores)); }
      catch { return errorRes(res, 400, 'Invalid rubric_scores format'); }
    }

    const result = await pool.query(
      `UPDATE homework_submissions SET marks=COALESCE($1,marks), feedback=COALESCE($2,feedback),
       rubric_scores=COALESCE($3,rubric_scores), graded_by=$4, graded_at=NOW(), status='graded'
       WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [marks !== undefined ? Number(marks) : null, feedback || null, rubricJson, graderId, subId, tid]);

    wsBroadcast(tid, 'homework:graded', { submission_id: subId, student_id: submission.rows[0].student_id, marks });
    ok(res, result.rows[0]);
  }));

  // POST /api/homework/assignments/:id/release-grades — Release all grades
  app.post('/api/homework/assignments/:id/release-grades', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const result = await pool.query(
      `UPDATE homework_assignments SET grades_visible=true, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id,title`, [assignId, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Assignment not found');

    // Notify parents about grade release
    try {
      const graded = await pool.query(
        `SELECT DISTINCT hs.student_id, s.parent_id FROM homework_submissions hs
         JOIN students s ON s.id=hs.student_id AND s.tenant_id=$1
         WHERE hs.assignment_id=$2 AND hs.tenant_id=$1 AND hs.status='graded'`, [tid, assignId]);
      for (const row of graded.rows) {
        if (row.parent_id) {
          await pool.query(
            `INSERT INTO homework_parent_notifications (tenant_id, assignment_id, student_id, parent_id, type, message)
             VALUES ($1,$2,$3,$4,'grade_release',$5)`,
            [tid, assignId, row.student_id, row.parent_id, `Grades for "${result.rows[0].title}" have been released.`]);
        }
      }
    } catch (e) { console.error('[Homework] Notification error:', e.message); }

    wsBroadcast(tid, 'homework:grades_released', { assignment_id: assignId });
    ok(res, { message: 'Grades released successfully', assignment_id: assignId });
  }));

  // ============================================================
  // HOMEWORK CALENDAR
  // ============================================================

  // GET /api/homework/calendar — Calendar view
  app.get('/api/homework/calendar', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { class_id, subject_id, from, to } = req.query;
    const fromDate = from || today();
    const toDate = to || new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10);

    let sql = `SELECT ha.id, ha.title, ha.due_date, ha.submission_type, ha.total_marks, ha.is_published, ha.grades_visible,
                      sub.name AS subject_name, c.name AS class_name,
                      (SELECT COUNT(*)::int FROM homework_submissions hs WHERE hs.assignment_id=ha.id AND hs.tenant_id=$1 AND hs.status IN ('submitted','graded','late')) AS submission_count
               FROM homework_assignments ha
               LEFT JOIN subjects sub ON sub.id=ha.subject_id LEFT JOIN classes c ON c.id=ha.class_id
               WHERE ha.tenant_id=$1 AND ha.due_date BETWEEN $2 AND $3`;
    const params = [tid, fromDate, toDate], filters = [];
    if (class_id) filters.push(`ha.class_id=${Number(class_id)}`);
    if (subject_id) filters.push(`ha.subject_id=${Number(subject_id)}`);
    if (filters.length) sql += ` AND ${filters.join(' AND ')}`;
    sql += ` ORDER BY ha.due_date ASC`;

    const rows = await pool.query(sql, params);
    const overdue = rows.rows.filter(r => r.due_date && new Date(r.due_date) < new Date() && !r.grades_visible);
    const upcoming = rows.rows.filter(r => !r.due_date || new Date(r.due_date) >= new Date());

    ok(res, { assignments: rows.rows, overdue_count: overdue.length, upcoming_count: upcoming.length, date_range: { from: fromDate, to: toDate } });
  }));

  // ============================================================
  // PLAGIARISM FLAGS
  // ============================================================

  // POST /api/homework/assignments/:id/check-plagiarism — Run similarity check
  app.post('/api/homework/assignments/:id/check-plagiarism', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;

    const subs = await pool.query(
      `SELECT id, student_id, content FROM homework_submissions
       WHERE assignment_id=$1 AND tenant_id=$2 AND status IN ('submitted','late','graded') AND content IS NOT NULL AND content != ''`,
      [assignId, tid]);

    if (subs.rows.length < 2) return ok(res, { message: 'Not enough submissions to compare', flags: [] });

    const flags = [];
    for (let i = 0; i < subs.rows.length; i++) {
      for (let j = i + 1; j < subs.rows.length; j++) {
        const sim = textSimilarity(subs.rows[i].content, subs.rows[j].content);
        if (sim > 0.75) {
          const flag = { submission_a: subs.rows[i].id, submission_b: subs.rows[j].id,
            student_a: subs.rows[i].student_id, student_b: subs.rows[j].student_id,
            similarity: Math.round(sim * 100), status: 'pending_review' };
          flags.push(flag);
          // Store flag on both submissions
          for (const sid of [flag.submission_a, flag.submission_b]) {
            await pool.query(
              `UPDATE homework_submissions SET plagiarism_flag = COALESCE(plagiarism_flag, '[]'::jsonb) || $1::jsonb WHERE id=$2 AND tenant_id=$3`,
              [JSON.stringify([{ ...flag, flagged_at: now() }]), sid, tid]);
          }
        }
      }
    }
    wsBroadcast(tid, 'homework:plagiarism_check', { assignment_id: assignId, flags_found: flags.length });
    ok(res, { assignment_id: assignId, flags, total_submissions: subs.rows.length });
  }));

  // PUT /api/homework/submissions/:id/plagiarism-status — Update flag status
  app.put('/api/homework/submissions/:id/plagiarism-status', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, { status } = req.body;
    if (!VALID_FLAG_STATUSES.includes(status)) return errorRes(res, 400, 'Invalid status', { valid: VALID_FLAG_STATUSES });
    const sub = await pool.query(`SELECT id FROM homework_submissions WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!sub.rows[0]) return errorRes(res, 404, 'Submission not found');
    await pool.query(
      `UPDATE homework_submissions SET plagiarism_flag = jsonb_set(plagiarism_flag, '{0, status}', $1::jsonb) WHERE id=$2 AND tenant_id=$3`,
      [JSON.stringify(status), req.params.id, tid]);
    ok(res, { message: 'Flag status updated', status });
  }));

  // ============================================================
  // PARENT NOTIFICATIONS
  // ============================================================

  // GET /api/homework/notifications
  app.get('/api/homework/notifications', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, type, acknowledged, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));

    let sql = `SELECT * FROM homework_parent_notifications WHERE tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (student_id) { sql += ` AND student_id=$${pi}`; params.push(student_id); pi++; }
    if (type) { sql += ` AND type=$${pi}`; params.push(type); pi++; }
    if (acknowledged !== undefined) { sql += ` AND acknowledged=$${pi}`; params.push(acknowledged === 'true'); pi++; }
    sql += ` ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, (pn - 1) * ln);

    const rows = await pool.query(sql, params);
    ok(res, { notifications: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // PUT /api/homework/notifications/:id/acknowledge
  app.put('/api/homework/notifications/:id/acknowledge', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const result = await pool.query(
      `UPDATE homework_parent_notifications SET acknowledged=true, acknowledged_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND acknowledged=false RETURNING id`, [req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Notification not found or already acknowledged');
    ok(res, { message: 'Notification acknowledged' });
  }));

  // POST /api/homework/send-reminders — Send submission reminders to parents
  app.post('/api/homework/send-reminders', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { assignment_id } = req.body;
    if (!assignment_id) return errorRes(res, 400, 'assignment_id is required');

    const assignment = await pool.query(`SELECT id, title, due_date, class_id FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [assignment_id, tid]);
    if (!assignment.rows[0]) return errorRes(res, 404, 'Assignment not found');

    const pending = await pool.query(
      `SELECT s.id AS student_id, s.parent_id, s.first_name
       FROM students s LEFT JOIN homework_submissions hs ON hs.student_id=s.id AND hs.assignment_id=$1 AND hs.tenant_id=$2
       WHERE s.tenant_id=$2 AND s.class_id=$3 AND hs.id IS NULL`, [assignment_id, tid, assignment.rows[0].class_id]);

    let sentCount = 0;
    for (const s of pending.rows) {
      if (s.parent_id) {
        await pool.query(
          `INSERT INTO homework_parent_notifications (tenant_id, assignment_id, student_id, parent_id, type, message)
           VALUES ($1,$2,$3,$4,'submission_reminder',$5)`,
          [tid, assignment_id, s.student_id, s.parent_id,
           `Reminder: ${s.first_name || 'Your child'} has not submitted "${assignment.rows[0].title}". Due: ${assignment.rows[0].due_date || 'No deadline'}.`]);
        sentCount++;
      }
    }
    wsBroadcast(tid, 'homework:reminders_sent', { assignment_id, reminders_sent: sentCount });
    ok(res, { message: `Sent ${sentCount} reminder(s)`, reminders_sent: sentCount });
  }));

  // ============================================================
  // STATISTICS
  // ============================================================

  // GET /api/homework/stats — Overall statistics
  app.get('/api/homework/stats', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { class_id, subject_id } = req.query;

    let classFilter = '', subFilter = '', params = [tid];
    if (class_id) { classFilter = ` AND ha.class_id=$2`; params.push(class_id); }
    if (subject_id) { subFilter = ` AND ha.subject_id=$${params.length + 1}`; params.push(subject_id); }

    const [overview, perAssign, classComp] = await Promise.all([
      // Overview stats
      pool.query(
        `SELECT COUNT(DISTINCT ha.id)::int AS total_assignments,
                COUNT(DISTINCT hs.id)::int AS total_submissions,
                ROUND(AVG(hs.marks)::numeric, 1) AS avg_grade,
                COUNT(hs.id) FILTER(WHERE hs.is_late)::int AS late_count,
                COUNT(hs.id)::int AS graded_count
         FROM homework_assignments ha
         LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=ha.tenant_id
         WHERE ha.tenant_id=$1${classFilter}${subFilter}`, params),
      // Per-assignment breakdown
      pool.query(
        `SELECT ha.id, ha.title, ha.total_marks, ha.due_date,
                COUNT(hs.id)::int AS submissions,
                (SELECT COUNT(*)::int FROM students s WHERE s.tenant_id=$1 AND s.class_id=ha.class_id) AS class_size,
                ROUND(COUNT(hs.id)::numeric / NULLIF((SELECT COUNT(*)::int FROM students s WHERE s.tenant_id=$1 AND s.class_id=ha.class_id), 0) * 100, 1) AS submission_rate,
                ROUND(AVG(hs.marks)::numeric, 1) AS average_score
         FROM homework_assignments ha
         LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1
         WHERE ha.tenant_id=$1 AND ha.is_published=true${classFilter}${subFilter}
         GROUP BY ha.id ORDER BY ha.created_at DESC LIMIT 20`, [tid, ...(class_id ? [class_id] : []), ...(subject_id ? [subject_id] : [])]),
      // Class comparison
      pool.query(
        `SELECT c.id AS class_id, c.name AS class_name,
                COUNT(DISTINCT ha.id)::int AS assignments, COUNT(DISTINCT hs.id)::int AS submissions,
                ROUND(AVG(hs.marks)::numeric, 1) AS avg_score,
                COUNT(hs.id) FILTER(WHERE hs.is_late)::int AS late_count
         FROM classes c
         LEFT JOIN homework_assignments ha ON ha.class_id=c.id AND ha.tenant_id=$1 AND ha.is_published=true
         LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1
         WHERE c.tenant_id=$1 GROUP BY c.id, c.name ORDER BY avg_score DESC NULLS LAST`, [tid]),
    ]);

    const o = overview.rows[0];
    const latePct = o.graded_count > 0 ? Math.round(o.late_count / o.graded_count * 100) : 0;

    ok(res, {
      overview: { total_assignments: o.total_assignments, total_submissions: o.total_submissions,
        average_grade: o.avg_grade, late_submission_rate: latePct },
      per_assignment: perAssign.rows, class_comparison: classComp.rows
    });
  }));

  // GET /api/homework/assignments/:id/stats — Single assignment statistics
  app.get('/api/homework/assignments/:id/stats', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const [assign, stats, dist] = await Promise.all([
      pool.query(`SELECT * FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [assignId, tid]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='graded')::int AS graded,
        COUNT(*) FILTER(WHERE is_late)::int AS late,
        ROUND(AVG(marks)::numeric, 1) AS avg, ROUND(MAX(marks)::numeric, 1) AS highest,
        ROUND(MIN(marks)::numeric, 1) AS lowest, ROUND(STDDEV(marks)::numeric, 1) AS std_dev
        FROM homework_submissions WHERE assignment_id=$1 AND tenant_id=$2 AND marks IS NOT NULL`, [assignId, tid]),
      pool.query(`SELECT CASE WHEN marks/NULLIF(ha.total_marks,0) >= 0.8 THEN 'A' WHEN marks/NULLIF(ha.total_marks,0) >= 0.7 THEN 'B'
        WHEN marks/NULLIF(ha.total_marks,0) >= 0.6 THEN 'C' WHEN marks/NULLIF(ha.total_marks,0) >= 0.5 THEN 'D' ELSE 'F' END AS grade,
        COUNT(*)::int AS count FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id
        WHERE hs.assignment_id=$1 AND hs.tenant_id=$2 AND hs.status='graded' GROUP BY grade ORDER BY grade`, [assignId, tid]),
    ]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');

    const classSize = (await pool.query(`SELECT COUNT(*)::int AS total FROM students WHERE tenant_id=$1 AND class_id=$2`, [tid, assign.rows[0].class_id])).rows[0].total;
    const s = stats.rows[0];

    ok(res, { assignment: assign.rows[0], class_size: classSize,
      submission_rate: classSize > 0 ? Math.round(s.total / classSize * 100) : 0,
      stats: s, grade_distribution: dist.rows });
  }));

  // ============================================================
  // BULK OPERATIONS
  // ============================================================

  // POST /api/homework/assignments/:id/bulk-grade — Bulk grade
  app.post('/api/homework/assignments/:id/bulk-grade', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, graderId = req.user.id;
    const { grades } = req.body;
    if (!grades || !Array.isArray(grades) || grades.length === 0 || grades.length > 200)
      return errorRes(res, 400, 'grades must be an array of 1-200 { submission_id, marks, feedback }');

    const assign = await pool.query(`SELECT total_marks FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');
    const total = Number(assign.rows[0].total_marks) || 100;

    let updated = 0;
    for (const g of grades) {
      if (!g.submission_id || g.marks === undefined) continue;
      const m = Number(g.marks);
      if (m < 0 || m > total) continue;
      await pool.query(
        `UPDATE homework_submissions SET marks=$1, feedback=$2, graded_by=$3, graded_at=NOW(), status='graded'
         WHERE id=$4 AND tenant_id=$5 AND assignment_id=$6`,
        [m, g.feedback || null, graderId, g.submission_id, tid, req.params.id]);
      updated++;
    }
    wsBroadcast(tid, 'homework:bulk_graded', { assignment_id: req.params.id, updated });
    ok(res, { message: `Graded ${updated} submission(s)`, updated });
  }));

  // POST /api/homework/bulk-publish — Publish multiple assignments
  app.post('/api/homework/bulk-publish', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { assignment_ids } = req.body;
    if (!assignment_ids || !Array.isArray(assignment_ids) || assignment_ids.length === 0 || assignment_ids.length > 50)
      return errorRes(res, 400, 'assignment_ids must be an array of 1-50 IDs');

    const result = await pool.query(
      `UPDATE homework_assignments SET is_published=true, updated_at=NOW() WHERE id=ANY($1) AND tenant_id=$2 RETURNING id`,
      [assignment_ids, tid]);
    wsBroadcast(tid, 'homework:bulk_published', { published_count: result.rows.length });
    ok(res, { message: `Published ${result.rows.length} assignment(s)`, published: result.rows.length });
  }));

  // GET /api/homework/drafts — List unpublished assignments
  app.get('/api/homework/drafts', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const rows = await pool.query(`SELECT * FROM homework_assignments WHERE tenant_id=$1 AND is_published=false ORDER BY created_at DESC`, [tid]);
    ok(res, { drafts: rows.rows });
  }));

  // GET /api/homework/search — Search assignments & submissions
  app.get('/api/homework/search', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, q = (req.query.q || '').trim();
    if (q.length < 2) return errorRes(res, 400, 'Query must be at least 2 characters');

    const [assigns, subs] = await Promise.all([
      pool.query(`SELECT ha.id, ha.title, ha.due_date, 'assignment' AS type FROM homework_assignments ha
        WHERE ha.tenant_id=$1 AND (ha.title ILIKE '%' || $2 || '%' OR ha.description ILIKE '%' || $2 || '%')
        ORDER BY ha.created_at DESC LIMIT 20`, [tid, q]),
      pool.query(`SELECT hs.id, hs.content, hs.student_id, hs.submitted_at, ha.title AS assignment_title, 'submission' AS type
        FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
        WHERE hs.tenant_id=$1 AND hs.content ILIKE '%' || $2 || '%' ORDER BY hs.submitted_at DESC LIMIT 20`, [tid, q]),
    ]);
    ok(res, { query: q, assignments: assigns.rows, submissions: subs.rows, total: assigns.rows.length + subs.rows.length });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS
  // ============================================================
  const NEW_HW_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS homework_peer_reviews (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
      assignment_id INTEGER NOT NULL, reviewer_email VARCHAR(255) NOT NULL,
      submission_id INTEGER NOT NULL, score NUMERIC(6,2),
      feedback TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS homework_penalty_settings (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
      penalty_percent_per_day NUMERIC(5,2) DEFAULT 5.00,
      max_penalty_percent NUMERIC(5,2) DEFAULT 50.00,
      enabled BOOLEAN DEFAULT true
    )`,
  ];
  (async () => {
    const mc = await pool.connect().catch(() => null);
    if (!mc) return;
    try {
      for (const sql of NEW_HW_MIGRATIONS) { try { await mc.query(sql); } catch (_) {} }
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_hpr_tenant ON homework_peer_reviews(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hpr_assign ON homework_peer_reviews(assignment_id)',
        'CREATE INDEX IF NOT EXISTS idx_hpr_sub ON homework_peer_reviews(submission_id)',
        'CREATE INDEX IF NOT EXISTS idx_hps_tenant ON homework_penalty_settings(tenant_id)',
      ]) { try { await mc.query(sql); } catch (_) {} }
      console.log('[Homework] New migrations applied');
    } catch (e) { console.error('[Homework] New migration error:', e.message); }
    finally { mc.release(); }
  })();

  // ─── Local helpers for HTML pages ──────────────────────────
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const renderPage = (res, title, body) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f3f4f6;color:#1f2937;line-height:1.6}header{background:#1e3a5f;color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between}header h1{font-size:1.25rem}nav a{color:#93c5fd;text-decoration:none;margin-left:1rem;font-size:.875rem}nav a:hover{color:#fff}.container{max-width:1200px;margin:2rem auto;padding:0 1rem}.card{background:#fff;border-radius:.75rem;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}.card h2{font-size:1.125rem;margin-bottom:.75rem;color:#1e3a5f}.card h3{font-size:1rem;margin-bottom:.5rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem}.stat{text-align:center;padding:1.5rem;background:linear-gradient(135deg,#1e3a5f,#2d5f8a);color:#fff;border-radius:.75rem}.stat .num{font-size:2rem;font-weight:700}.stat .label{font-size:.8rem;opacity:.85;margin-top:.25rem}table{width:100%;border-collapse:collapse;font-size:.875rem}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #e5e7eb}th{background:#f9fafb;font-weight:600;color:#374151}tr:hover{background:#f9fafb}.badge{display:inline-block;padding:.125rem .5rem;border-radius:9999px;font-size:.75rem;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#4b5563}.btn{display:inline-block;padding:.5rem 1rem;border-radius:.5rem;text-decoration:none;font-size:.875rem;font-weight:500;border:none;cursor:pointer}.btn-primary{background:#1e3a5f;color:#fff}.btn-primary:hover{background:#2d5f8a}.btn-sm{padding:.25rem .75rem;font-size:.75rem}.empty{text-align:center;padding:3rem;color:#6b7280}.empty p{margin-bottom:1rem}footer{margin-top:2rem;padding:1.5rem;text-align:center;font-size:.75rem;color:#9ca3af;border-top:1px solid #e5e7eb}</style></head><body><header><h1>${esc(title)}</h1><nav><a href="/homework/dashboard">Dashboard</a><a href="/homework/assignments">Assignments</a></nav></header><main class="container">${body}</main><footer>&copy; ${new Date().getFullYear()} School Portal — Homework Module</footer></body></html>`);

  // ============================================================
  // HTML FRONTEND PAGES
  // ============================================================

  // GET /homework/dashboard — Teacher dashboard
  app.get('/homework/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const [myAssignments, pendingSubs, recentGraded, recentActivity] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM homework_assignments WHERE tenant_id=$1 AND teacher_id=$2 AND is_published=true`, [tid, userId]),
      pool.query(`SELECT ha.id,ha.title,ha.due_date,COUNT(hs.id)::int AS pending_count FROM homework_assignments ha LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1 AND hs.status IN ('draft','submitted','late') WHERE ha.tenant_id=$1 AND ha.teacher_id=$2 AND ha.is_published=true AND ha.due_date >= $3 GROUP BY ha.id ORDER BY ha.due_date ASC LIMIT 10`, [tid, userId, today()]),
      pool.query(`SELECT ha.id,ha.title,hs.marks,hs.feedback,hs.graded_at,u.name AS student_name FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1 JOIN users u ON u.id=hs.student_id WHERE hs.tenant_id=$1 AND hs.graded_by=$2 AND hs.graded_at >= NOW() - INTERVAL '7 days' ORDER BY hs.graded_at DESC LIMIT 10`, [tid, userId]),
      pool.query(`SELECT 'graded' AS type, hs.graded_at AS act_at, ha.title AS detail, u.name AS student_name FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id JOIN users u ON u.id=hs.student_id WHERE hs.tenant_id=$1 AND hs.graded_by=$2 AND hs.graded_at >= NOW() - INTERVAL '30 days' UNION ALL SELECT 'submitted' AS type, hs.submitted_at AS act_at, ha.title AS detail, u.name AS student_name FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id JOIN users u ON u.id=hs.student_id WHERE hs.tenant_id=$1 AND hs.submitted_at >= NOW() - INTERVAL '30 days' ORDER BY act_at DESC LIMIT 20`, [tid, userId]),
    ]);
    const body = `
      <div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:2rem">
        <div class="stat"><div class="num">${esc(myAssignments.rows[0].total)}</div><div class="label">My Assignments</div></div>
        <div class="stat"><div class="num">${esc(pendingSubs.rows.length)}</div><div class="label">Awaiting Review</div></div>
        <div class="stat"><div class="num">${esc(recentGraded.rows.length)}</div><div class="label">Graded This Week</div></div>
      </div>
      <div class="grid">
        <div class="card"><h2>Pending Submissions</h2>
          ${pendingSubs.rows.length ? `<table><tr><th>Assignment</th><th>Due</th><th>Pending</th><th></th></tr>${pendingSubs.rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.due_date ? r.due_date.slice(0,10) : '—')}</td><td><span class="badge badge-yellow">${esc(r.pending_count)}</span></td><td><a class="btn btn-sm btn-primary" href="/homework/assignments/${esc(r.id)}">View</a></td></tr>`).join('')}</table>` : '<p class="empty">No pending submissions</p>'}
        </div>
        <div class="card"><h2>Recent Grades</h2>
          ${recentGraded.rows.length ? `<table><tr><th>Student</th><th>Assignment</th><th>Score</th><th>When</th></tr>${recentGraded.rows.map(r => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.title)}</td><td><span class="badge badge-green">${esc(r.marks)}</span></td><td>${esc(r.graded_at ? r.graded_at.slice(0,16) : '')}</td></tr>`).join('')}</table>` : '<p class="empty">No recent grades</p>'}
        </div>
      </div>
      <div class="card" style="margin-top:1.5rem"><h2>Recent Activity</h2>
        ${recentActivity.rows.length ? `<table><tr><th>Type</th><th>Detail</th><th>Student</th><th>When</th></tr>${recentActivity.rows.map(r => `<tr><td><span class="badge ${r.type==='graded'?'badge-green':'badge-blue'}">${esc(r.type)}</span></td><td>${esc(r.detail)}</td><td>${esc(r.student_name||'—')}</td><td>${esc(r.act_at ? r.act_at.slice(0,16) : '')}</td></tr>`).join('')}</table>` : '<p class="empty">No recent activity</p>'}
      </div>`;
    renderPage(res, 'Homework Dashboard', body);
  }));

  // GET /homework/assignments — Assignments list page
  app.get('/homework/assignments', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { class_id, subject_id } = req.query;
    let sql = `SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name,
      (SELECT COUNT(*)::int FROM homework_submissions hs WHERE hs.assignment_id=ha.id AND hs.tenant_id=$1 AND hs.status IN ('submitted','graded','late')) AS sub_count
      FROM homework_assignments ha
      LEFT JOIN users u ON u.id=ha.teacher_id LEFT JOIN subjects sub ON sub.id=ha.subject_id
      LEFT JOIN classes c ON c.id=ha.class_id WHERE ha.tenant_id=$1 AND ha.is_published=true`;
    const params = [tid]; let pi = 2;
    if (class_id) { sql += ` AND ha.class_id=$${pi++}`; params.push(class_id); }
    if (subject_id) { sql += ` AND ha.subject_id=$${pi++}`; params.push(subject_id); }
    sql += ` ORDER BY ha.created_at DESC LIMIT 50`;
    const rows = await pool.query(sql, params);
    const body = `
      <div class="card"><h2>All Assignments</h2>
        ${rows.rows.length ? `<table><tr><th>Title</th><th>Subject</th><th>Class</th><th>Due Date</th><th>Submissions</th><th>Status</th><th></th></tr>${rows.rows.map(r => {
          const overdue = r.due_date && new Date(r.due_date) < new Date() && !r.grades_visible;
          return `<tr><td>${esc(r.title)}</td><td>${esc(r.subject_name||'—')}</td><td>${esc(r.class_name||'—')}</td><td>${esc(r.due_date ? r.due_date.slice(0,10) : '—')}</td><td>${esc(r.sub_count)}</td><td>${r.grades_visible ? '<span class="badge badge-green">Grades Out</span>' : overdue ? '<span class="badge badge-red">Overdue</span>' : '<span class="badge badge-blue">Open</span>'}</td><td><a class="btn btn-sm btn-primary" href="/homework/assignments/${esc(r.id)}">Details</a></td></tr>`;
        }).join('')}</table>` : '<p class="empty">No assignments found</p>'}
      </div>`;
    renderPage(res, 'Assignments', body);
  }));

  // GET /homework/assignments/:id — Assignment detail page
  app.get('/homework/assignments/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const [assign, rubric, subs] = await Promise.all([
      pool.query(`SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name
        FROM homework_assignments ha LEFT JOIN users u ON u.id=ha.teacher_id
        LEFT JOIN subjects sub ON sub.id=ha.subject_id LEFT JOIN classes c ON c.id=ha.class_id
        WHERE ha.id=$1 AND ha.tenant_id=$2`, [assignId, tid]),
      pool.query(`SELECT * FROM homework_rubric WHERE assignment_id=$1 AND tenant_id=$2`, [assignId, tid]),
      pool.query(`SELECT hs.*, u.name AS student_name FROM homework_submissions hs
        LEFT JOIN users u ON u.id=hs.student_id WHERE hs.assignment_id=$1 AND hs.tenant_id=$2
        ORDER BY hs.submitted_at DESC NULLS LAST`, [assignId, tid]),
    ]);
    if (!assign.rows[0]) return res.status(404).send('Assignment not found');
    const a = assign.rows[0];
    const rubricData = rubric.rows[0] ? (typeof rubric.rows[0].criteria === 'string' ? JSON.parse(rubric.rows[0].criteria) : rubric.rows[0].criteria) : [];
    const body = `
      <div class="card">
        <h2>${esc(a.title)}</h2>
        <p><strong>Subject:</strong> ${esc(a.subject_name||'—')} &nbsp; <strong>Class:</strong> ${esc(a.class_name||'—')} &nbsp; <strong>Teacher:</strong> ${esc(a.teacher_name)}</p>
        <p><strong>Due:</strong> ${esc(a.due_date ? a.due_date.slice(0,16) : '—')} &nbsp; <strong>Total Marks:</strong> ${esc(a.total_marks)} &nbsp; <strong>Type:</strong> <span class="badge badge-blue">${esc(a.submission_type)}</span></p>
        ${a.description ? `<div style="margin-top:.75rem;padding:1rem;background:#f9fafb;border-radius:.5rem">${esc(a.description)}</div>` : ''}
      </div>
      <div class="grid">
        <div class="card"><h2>Rubric</h2>
          ${rubricData.length ? `<table><tr><th>Criteria</th><th>Max Marks</th><th>Description</th></tr>${rubricData.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.max_marks)}</td><td>${esc(c.description)}</td></tr>`).join('')}</table>` : '<p class="empty">No rubric defined</p>'}
        </div>
        <div class="card"><h2>Submission Stats</h2>
          <div style="display:flex;gap:1.5rem;margin-top:.5rem">
            <div><strong>${esc(subs.rows.length)}</strong> total</div>
            <div><strong>${esc(subs.rows.filter(s=>s.status==='graded').length)}</strong> graded</div>
            <div><strong>${esc(subs.rows.filter(s=>s.is_late).length)}</strong> late</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1.5rem"><h2>Submissions (${esc(subs.rows.length)})</h2>
        ${subs.rows.length ? `<table><tr><th>Student</th><th>Status</th><th>Submitted</th><th>Marks</th><th>Feedback</th></tr>${subs.rows.map(s => `<tr><td>${esc(s.student_name||'Student #'+s.student_id)}</td><td><span class="badge ${s.status==='graded'?'badge-green':s.is_late?'badge-red':'badge-yellow'}">${esc(s.status)}</span></td><td>${esc(s.submitted_at ? s.submitted_at.slice(0,16) : '—')}</td><td>${s.marks !== null ? esc(s.marks) : '—'}</td><td>${esc(s.feedback||'—')}</td></tr>`).join('')}</table>` : '<p class="empty">No submissions yet</p>'}
      </div>`;
    renderPage(res, `Assignment: ${a.title}`, body);
  }));

  // ============================================================
  // PEER REVIEW SYSTEM
  // ============================================================

  // POST /api/homework/assignments/:id/peer-review/assign
  app.post('/api/homework/assignments/:id/peer-review/assign', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const { reviewer_emails, submission_ids } = req.body;
    if (!Array.isArray(reviewer_emails) || reviewer_emails.length === 0 || reviewer_emails.length > 50)
      return errorRes(res, 400, 'reviewer_emails must be a non-empty array of up to 50 emails');
    if (!Array.isArray(submission_ids) || submission_ids.length === 0 || submission_ids.length > 200)
      return errorRes(res, 400, 'submission_ids must be a non-empty array of up to 200 IDs');

    const assign = await pool.query(`SELECT id FROM homework_assignments WHERE id=$1 AND tenant_id=$2 AND is_published=true`, [assignId, tid]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');

    let assigned = 0;
    const validEmails = reviewer_emails.filter(e => typeof e === 'string' && e.includes('@'));
    for (const subId of submission_ids) {
      for (const email of validEmails) {
        const existing = await pool.query(
          `SELECT id FROM homework_peer_reviews WHERE tenant_id=$1 AND assignment_id=$2 AND submission_id=$3 AND reviewer_email=$4`,
          [tid, assignId, subId, email.trim().toLowerCase()]);
        if (!existing.rows[0]) {
          await pool.query(
            `INSERT INTO homework_peer_reviews (tenant_id, assignment_id, reviewer_email, submission_id) VALUES ($1,$2,$3,$4)`,
            [tid, assignId, email.trim().toLowerCase(), subId]);
          assigned++;
        }
      }
    }

    wsBroadcast(tid, 'homework:peer_reviews_assigned', { assignment_id: assignId, assigned });
    ok(res, { message: `Assigned ${assigned} peer review(s)`, assigned });
  }));

  // POST /api/homework/peer-review/:submissionId
  app.post('/api/homework/peer-review/:submissionId', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, subId = req.params.submissionId;
    const { score, feedback } = req.body;
    if (score === undefined || Number(score) < 0 || Number(score) > 100)
      return errorRes(res, 400, 'score must be between 0 and 100');
    if (!feedback?.trim()) return errorRes(res, 400, 'feedback is required');

    const sub = await pool.query(
      `SELECT id FROM homework_submissions WHERE id=$1 AND tenant_id=$2`, [subId, tid]);
    if (!sub.rows[0]) return errorRes(res, 404, 'Submission not found');

    const reviewerEmail = req.user.email || req.user.id;
    const existing = await pool.query(
      `SELECT id FROM homework_peer_reviews WHERE tenant_id=$1 AND submission_id=$2 AND reviewer_email=$3`,
      [tid, subId, reviewerEmail]);
    if (!existing.rows[0]) return errorRes(res, 403, 'You are not assigned as a reviewer for this submission');

    const result = await pool.query(
      `UPDATE homework_peer_reviews SET score=$1, feedback=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [Number(score), feedback.trim(), existing.rows[0].id, tid]);

    wsBroadcast(tid, 'homework:peer_review_submitted', { submission_id: subId, reviewer: reviewerEmail });
    ok(res, result.rows[0]);
  }));

  // GET /api/homework/peer-review/:submissionId
  app.get('/api/homework/peer-review/:submissionId', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, subId = req.params.submissionId;
    const rows = await pool.query(
      `SELECT hpr.*, u.name AS reviewer_name FROM homework_peer_reviews hpr
       LEFT JOIN users u ON u.email = hpr.reviewer_email
       WHERE hpr.tenant_id=$1 AND hpr.submission_id=$2 ORDER BY hpr.created_at DESC`,
      [tid, subId]);
    ok(res, { submission_id: subId, reviews: rows.rows });
  }));

  // ============================================================
  // LATE PENALTY CONFIGURATION
  // ============================================================

  // GET /api/homework/settings/penalties
  app.get('/api/homework/settings/penalties', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const rows = await pool.query(`SELECT * FROM homework_penalty_settings WHERE tenant_id=$1 ORDER BY id`, [tid]);
    if (rows.rows.length === 0) {
      // Seed default
      const def = await pool.query(
        `INSERT INTO homework_penalty_settings (tenant_id, penalty_percent_per_day, max_penalty_percent, enabled) VALUES ($1,5.00,50.00,true) RETURNING *`, [tid]);
      ok(res, def.rows[0]);
    } else {
      ok(res, rows.rows[0]);
    }
  }));

  // PUT /api/homework/settings/penalties
  app.put('/api/homework/settings/penalties', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { penalty_percent_per_day, max_penalty_percent, enabled } = req.body;

    const ppd = penalty_percent_per_day !== undefined ? Number(penalty_percent_per_day) : null;
    const mp = max_penalty_percent !== undefined ? Number(max_penalty_percent) : null;
    if (ppd !== null && (ppd < 0 || ppd > 100)) return errorRes(res, 400, 'penalty_percent_per_day must be 0-100');
    if (mp !== null && (mp < 0 || mp > 100)) return errorRes(res, 400, 'max_penalty_percent must be 0-100');

    const existing = await pool.query(`SELECT id FROM homework_penalty_settings WHERE tenant_id=$1 LIMIT 1`, [tid]);
    let result;
    if (existing.rows[0]) {
      result = await pool.query(
        `UPDATE homework_penalty_settings SET penalty_percent_per_day=COALESCE($1,penalty_percent_per_day), max_penalty_percent=COALESCE($2,max_penalty_percent), enabled=COALESCE($3,enabled) WHERE id=$4 AND tenant_id=$5 RETURNING *`,
        [ppd, mp, enabled !== undefined ? enabled : null, existing.rows[0].id, tid]);
    } else {
      result = await pool.query(
        `INSERT INTO homework_penalty_settings (tenant_id, penalty_percent_per_day, max_penalty_percent, enabled) VALUES ($1,$2,$3,$4) RETURNING *`,
        [tid, ppd || 5, mp || 50, enabled !== undefined ? enabled : true]);
    }
    wsBroadcast(tid, 'homework:penalty_settings_updated', result.rows[0]);
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // STUDENT DASHBOARD API
  // ============================================================

  // GET /api/homework/student/dashboard
  app.get('/api/homework/student/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;

    const [pending, upcoming, recentGrades, stats] = await Promise.all([
      pool.query(`SELECT ha.id, ha.title, ha.due_date, ha.subject_id, sub.name AS subject_name, ha.total_marks,
        ha.submission_type, ha.description
        FROM homework_assignments ha
        LEFT JOIN subjects sub ON sub.id=ha.subject_id
        LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.student_id=$2 AND hs.tenant_id=$1
        WHERE ha.tenant_id=$1 AND ha.is_published=true AND hs.id IS NULL AND ha.due_date >= $3
        ORDER BY ha.due_date ASC LIMIT 20`, [tid, userId, today()]),
      pool.query(`SELECT ha.id, ha.title, ha.due_date, sub.name AS subject_name, ha.total_marks,
        hs.status AS submission_status, hs.submitted_at
        FROM homework_assignments ha
        JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.student_id=$2 AND hs.tenant_id=$1
        LEFT JOIN subjects sub ON sub.id=ha.subject_id
        WHERE ha.tenant_id=$1 AND ha.is_published=true AND hs.status IN ('draft','submitted','late')
        ORDER BY ha.due_date ASC LIMIT 20`, [tid, userId]),
      pool.query(`SELECT ha.id, ha.title, hs.marks, ha.total_marks, hs.feedback, hs.graded_at, sub.name AS subject_name,
        ROUND(hs.marks / NULLIF(ha.total_marks,0) * 100, 1) AS percentage
        FROM homework_submissions hs
        JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
        LEFT JOIN subjects sub ON sub.id=ha.subject_id
        WHERE hs.tenant_id=$1 AND hs.student_id=$2 AND hs.status='graded' AND hs.graded_at >= NOW() - INTERVAL '30 days'
        ORDER BY hs.graded_at DESC LIMIT 20`, [tid, userId]),
      pool.query(`SELECT
        COUNT(*)::int AS total_submitted,
        COUNT(*) FILTER(WHERE hs.status='graded')::int AS total_graded,
        COUNT(*) FILTER(WHERE hs.is_late)::int AS total_late,
        ROUND(AVG(hs.marks)::numeric, 1) AS avg_score,
        ROUND(AVG(hs.marks / NULLIF(ha.total_marks,0) * 100)::numeric, 1) AS avg_percentage
        FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
        WHERE hs.tenant_id=$1 AND hs.student_id=$2 AND hs.status='graded'`, [tid, userId]),
    ]);

    const overdue = pending.rows.filter(r => r.due_date && new Date(r.due_date) < new Date());

    ok(res, {
      pending_assignments: pending.rows.filter(r => !overdue.includes(r)),
      overdue_assignments: overdue,
      upcoming_deadlines: upcoming.rows,
      recent_grades: recentGrades.rows,
      summary: stats.rows[0]
    });
  }));

  // ============================================================
  // HTML FRONTEND PAGES (SSR via renderPage)
  // ============================================================

  // GET /homework/dashboard — Teacher dashboard
  app.get('/homework/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, teacherId = req.user.id;
    const [assignments, pendingSubs, recentActivity] = await Promise.all([
      pool.query(`SELECT ha.id, ha.title, ha.due_date, ha.submission_type, ha.total_marks,
        COUNT(hs.id)::int AS submission_count,
        COUNT(hs.id) FILTER(WHERE hs.status='graded')::int AS graded_count
        FROM homework_assignments ha
        LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1
        WHERE ha.tenant_id=$1 AND ha.teacher_id=$2 AND ha.is_published=true
        GROUP BY ha.id ORDER BY ha.created_at DESC LIMIT 10`, [tid, teacherId]),
      pool.query(`SELECT ha.id AS assignment_id, ha.title, COUNT(hs.id)::int AS pending_count
        FROM homework_assignments ha
        LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1 AND hs.status IN ('submitted','late')
        JOIN homework_submissions ungraded ON ungraded.assignment_id=ha.id AND ungraded.tenant_id=$1 AND ungraded.status IN ('submitted','late') AND ungraded.graded_by IS NULL
        WHERE ha.tenant_id=$1 AND ha.teacher_id=$2 AND ha.is_published=true
        GROUP BY ha.id, ha.title ORDER BY ha.due_date ASC LIMIT 5`, [tid, teacherId]),
      pool.query(`SELECT 'graded' AS type, hs.graded_at AS at, hs.id AS ref_id, u.name AS label
        FROM homework_submissions hs LEFT JOIN users u ON u.id=hs.student_id
        WHERE hs.tenant_id=$1 AND hs.graded_by=$2
        UNION ALL
        SELECT 'submitted' AS type, hs.submitted_at AS at, hs.id AS ref_id, u.name AS label
        FROM homework_submissions hs LEFT JOIN users u ON u.id=hs.student_id
        WHERE hs.tenant_id=$1 AND hs.teacher_id=$2 AND hs.status IN ('submitted','late')
        ORDER BY at DESC LIMIT 10`, [tid, teacherId]),
    ]);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Homework Dashboard</title>
      <style>body{font-family:system-ui;max-width:1200px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f5f5f5}h1{color:#333}h2{color:#555;border-bottom:2px solid #eee;padding-bottom:.3em}
      .stats{display:flex;gap:1em;margin:1em 0}.stat{background:#f9f9f9;padding:1em;border-radius:8px;flex:1;text-align:center}
      .stat .num{font-size:2em;font-weight:bold;color:#333}.stat .lbl{font-size:.85em;color:#888}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .pending{background:#f59e0b}.graded{background:#10b981}.late{background:#ef4444}</style></head><body>
      <h1>Homework Dashboard</h1>
      <div class="stats">
        <div class="stat"><div class="num">${assignments.rows.length}</div><div class="lbl">Active Assignments</div></div>
        <div class="stat"><div class="num">${pendingSubs.rows.reduce((s,r)=>s+r.pending_count,0)}</div><div class="lbl">Pending to Grade</div></div>
        <div class="stat"><div class="num">${recentActivity.rows.length}</div><div class="lbl">Recent Activity</div></div>
      </div>
      <h2>Assignments</h2><table><tr><th>Title</th><th>Due Date</th><th>Submissions</th><th>Graded</th><th>Status</th></tr>
      ${assignments.rows.map(a=>`<tr><td>${esc(a.title)}</td><td>${a.due_date||'—'}</td><td>${a.submission_count}</td><td>${a.graded_count}</td><td>${a.due_date && new Date(a.due_date)<new Date()?'<span class="badge late">Overdue</span>':'<span class="badge graded">Active</span>'}</td></tr>`).join('')}
      ${assignments.rows.length===0?'<tr><td colspan="5">No assignments found</td></tr>':''}
      </table>
      <h2>Recent Activity</h2><table><tr><th>Type</th><th>Student</th><th>Date</th></tr>
      ${recentActivity.rows.map(a=>`<tr><td><span class="badge ${a.type==='graded'?'graded':'pending'}">${a.type}</span></td><td>${esc(a.label||'—')}</td><td>${a.at||'—'}</td></tr>`).join('')}
      ${recentActivity.rows.length===0?'<tr><td colspan="3">No recent activity</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // GET /homework/assignments — HTML page listing all assignments
  app.get('/homework/assignments', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { class_id, subject_id, is_published } = req.query;
    let sql = `SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name
               FROM homework_assignments ha
               LEFT JOIN users u ON u.id = ha.teacher_id LEFT JOIN subjects sub ON sub.id = ha.subject_id
               LEFT JOIN classes c ON c.id = ha.class_id WHERE ha.tenant_id = $1`;
    const params = [tid]; let pi = 2;
    if (class_id) { sql += ` AND ha.class_id=$${pi}`; params.push(class_id); pi++; }
    if (subject_id) { sql += ` AND ha.subject_id=$${pi}`; params.push(subject_id); pi++; }
    if (is_published !== undefined) { sql += ` AND ha.is_published=$${pi}`; params.push(is_published === 'true'); pi++; }
    sql += ` ORDER BY ha.created_at DESC LIMIT 50`;
    const rows = await pool.query(sql, params);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Assignments</title>
      <style>body{font-family:system-ui;max-width:1200px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f5f5f5}a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .published{background:#10b981}.draft{background:#9ca3af}.filters{margin:1em 0;padding:1em;background:#f9f9f9;border-radius:8px}
      .filters label{margin-right:1em}select,input{padding:4px 8px;border:1px solid #ddd;border-radius:4px}</style></head><body>
      <h1>Assignments</h1>
      <div class="filters">
        <label>Class: <select onchange="location.href='/homework/assignments?class_id='+this.value+(this.value?'':'')">
        <option value="">All</option></select></label>
        <label>Published: <select onchange="location.href='/homework/assignments?is_published='+this.value">
        <option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
      </div>
      <table><tr><th>Title</th><th>Subject</th><th>Class</th><th>Teacher</th><th>Due Date</th><th>Total Marks</th><th>Published</th></tr>
      ${rows.rows.map(a=>`<tr><td><a href="/homework/assignments/${a.id}">${esc(a.title)}</a></td><td>${esc(a.subject_name||'—')}</td><td>${esc(a.class_name||'—')}</td><td>${esc(a.teacher_name||'—')}</td><td>${a.due_date||'—'}</td><td>${a.total_marks}</td><td><span class="badge ${a.is_published?'published':'draft'}">${a.is_published?'Published':'Draft'}</span></td></tr>`).join('')}
      ${rows.rows.length===0?'<tr><td colspan="7">No assignments found</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // GET /homework/assignments/:id — HTML page showing assignment detail
  app.get('/homework/assignments/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const [assign, rubric, submissions, stats] = await Promise.all([
      pool.query(`SELECT ha.*, u.name AS teacher_name, sub.name AS subject_name, c.name AS class_name
        FROM homework_assignments ha LEFT JOIN users u ON u.id=ha.teacher_id
        LEFT JOIN subjects sub ON sub.id=ha.subject_id LEFT JOIN classes c ON c.id=ha.class_id
        WHERE ha.id=$1 AND ha.tenant_id=$2`, [assignId, tid]),
      pool.query(`SELECT * FROM homework_rubric WHERE assignment_id=$1 AND tenant_id=$2`, [assignId, tid]),
      pool.query(`SELECT hs.*, u.name AS student_name FROM homework_submissions hs
        LEFT JOIN users u ON u.id=hs.student_id
        WHERE hs.assignment_id=$1 AND hs.tenant_id=$2 ORDER BY hs.submitted_at DESC NULLS LAST`, [assignId, tid]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status IN ('submitted','graded'))::int AS submitted,
        COUNT(*) FILTER(WHERE is_late)::int AS late, COUNT(*) FILTER(WHERE status='graded')::int AS graded,
        ROUND(AVG(marks)::numeric,1) AS avg_score FROM homework_submissions WHERE assignment_id=$1 AND tenant_id=$2`, [assignId, tid]),
    ]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');
    const a = assign.rows[0];
    const rubricData = rubric.rows[0] ? (typeof rubric.rows[0].criteria === 'string' ? JSON.parse(rubric.rows[0].criteria) : rubric.rows[0].criteria) : [];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(a.title)}</title>
      <style>body{font-family:system-ui;max-width:1000px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}
      h1{color:#333}h2{color:#555;border-bottom:2px solid #eee;padding-bottom:.3em}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:.5em;margin:1em 0;font-size:.9em}
      .info dt{font-weight:bold;color:#555}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .draft{background:#9ca3af}.submitted{background:#3b82f6}.late{background:#ef4444}.graded{background:#10b981}
      .rubric{margin:1em 0;padding:1em;background:#f0f9ff;border-radius:8px;border-left:4px solid #2563eb}</style></head><body>
      <h1>${esc(a.title)}</h1>
      <dl class="info">
        <dt>Subject</dt><dd>${esc(a.subject_name||'—')}</dd>
        <dt>Class</dt><dd>${esc(a.class_name||'—')}</dd>
        <dt>Teacher</dt><dd>${esc(a.teacher_name||'—')}</dd>
        <dt>Due Date</dt><dd>${a.due_date||'No deadline'}</dd>
        <dt>Total Marks</dt><dd>${a.total_marks}</dd>
        <dt>Submission Type</dt><dd>${a.submission_type}</dd>
        <dt>Published</dt><dd>${a.is_published?'Yes':'No'}</dd>
        <dt>Grades Visible</dt><dd>${a.grades_visible?'Yes':'No'}</dd>
      </dl>
      ${a.description?`<p>${esc(a.description)}</p>`:''}
      ${rubricData.length?`<div class="rubric"><h2>Rubric</h2><table><tr><th>Criterion</th><th>Max Marks</th><th>Description</th></tr>
      ${rubricData.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.max_marks}</td><td>${esc(r.description)}</td></tr>`).join('')}
      </table></div>`:''}
      <h2>Submission Stats</h2>
      <table><tr><th>Total</th><th>Submitted</th><th>Late</th><th>Graded</th><th>Avg Score</th></tr>
      <tr><td>${stats.rows[0].total}</td><td>${stats.rows[0].submitted}</td><td>${stats.rows[0].late}</td><td>${stats.rows[0].graded}</td><td>${stats.rows[0].avg_score||'—'}</td></tr></table>
      <h2>Submissions (${submissions.rows.length})</h2>
      <table><tr><th>Student</th><th>Status</th><th>Submitted</th><th>Marks</th><th>Feedback</th></tr>
      ${submissions.rows.map(s=>`<tr><td>${esc(s.student_name||'—')}</td><td><span class="badge ${s.status}">${s.status}</span></td><td>${s.submitted_at||'—'}</td><td>${s.marks!==null?s.marks:'—'}</td><td>${esc(s.feedback||'')}</td></tr>`).join('')}
      ${submissions.rows.length===0?'<tr><td colspan="5">No submissions yet</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // ============================================================
  // PEER REVIEW SYSTEM
  // ============================================================

  // POST /api/homework/assignments/:id/peer-review/assign — Assign peer reviews
  app.post('/api/homework/assignments/:id/peer-review/assign', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignId = req.params.id;
    const { reviews } = req.body;
    if (!reviews || !Array.isArray(reviews) || reviews.length === 0 || reviews.length > 100)
      return errorRes(res, 400, 'reviews must be an array of 1-100 { reviewer_email, submission_id }');

    const assign = await pool.query(`SELECT id FROM homework_assignments WHERE id=$1 AND tenant_id=$2`, [assignId, tid]);
    if (!assign.rows[0]) return errorRes(res, 404, 'Assignment not found');

    let created = 0;
    for (const r of reviews) {
      if (!r.reviewer_email || !r.submission_id) continue;
      const existing = await pool.query(
        `SELECT id FROM homework_peer_reviews WHERE assignment_id=$1 AND reviewer_email=$2 AND submission_id=$3 AND tenant_id=$4`,
        [assignId, r.reviewer_email, r.submission_id, tid]);
      if (existing.rows[0]) continue;
      await pool.query(
        `INSERT INTO homework_peer_reviews (tenant_id, assignment_id, reviewer_email, submission_id)
         VALUES ($1,$2,$3,$4)`, [tid, assignId, r.reviewer_email, r.submission_id]);
      created++;
    }
    wsBroadcast(tid, 'homework:peer_reviews_assigned', { assignment_id: assignId, count: created });
    ok(res, { message: `Assigned ${created} peer review(s)`, assigned: created }, 201);
  }));

  // POST /api/homework/peer-review/:submissionId — Submit peer review feedback
  app.post('/api/homework/peer-review/:submissionId', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, submissionId = req.params.submissionId;
    const { score, feedback } = req.body;
    if (score === undefined || score < 0 || score > 100)
      return errorRes(res, 400, 'score must be between 0 and 100');
    if (!feedback?.trim()) return errorRes(res, 400, 'feedback is required');

    const existing = await pool.query(
      `SELECT id FROM homework_peer_reviews WHERE submission_id=$1 AND reviewer_email=$2 AND tenant_id=$3`,
      [submissionId, req.user.email, tid]);
    if (!existing.rows[0]) return errorRes(res, 404, 'No peer review assignment found for this submission');

    const result = await pool.query(
      `UPDATE homework_peer_reviews SET score=$1, feedback=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *`,
      [Number(score), feedback.trim(), existing.rows[0].id, tid]);

    wsBroadcast(tid, 'homework:peer_review_submitted', { submission_id: submissionId, score });
    ok(res, result.rows[0]);
  }));

  // GET /api/homework/peer-review/:submissionId — Get peer review for submission
  app.get('/api/homework/peer-review/:submissionId', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, submissionId = req.params.submissionId;
    const rows = await pool.query(
      `SELECT pr.*, u.name AS reviewer_name FROM homework_peer_reviews pr
       LEFT JOIN users u ON u.email = pr.reviewer_email
       WHERE pr.submission_id=$1 AND pr.tenant_id=$2 ORDER BY pr.created_at DESC`, [submissionId, tid]);
    ok(res, { peer_reviews: rows.rows });
  }));

  // ============================================================
  // LATE PENALTY CONFIGURATION
  // ============================================================

  // GET /api/homework/settings/penalties — Get penalty settings
  app.get('/api/homework/settings/penalties', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const rows = await pool.query(`SELECT * FROM homework_penalty_settings WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tid]);
    if (!rows.rows[0]) {
      return ok(res, { penalty_percent_per_day: 5, max_penalty_percent: 50, enabled: true });
    }
    ok(res, rows.rows[0]);
  }));

  // PUT /api/homework/settings/penalties — Update penalty settings
  app.put('/api/homework/settings/penalties', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { penalty_percent_per_day, max_penalty_percent, enabled } = req.body;

    const ppd = penalty_percent_per_day !== undefined ? Number(penalty_percent_per_day) : 5;
    const mpp = max_penalty_percent !== undefined ? Number(max_penalty_percent) : 50;
    if (ppd < 0 || ppd > 100) return errorRes(res, 400, 'penalty_percent_per_day must be 0-100');
    if (mpp < 0 || mpp > 100) return errorRes(res, 400, 'max_penalty_percent must be 0-100');
    if (ppd > mpp) return errorRes(res, 400, 'penalty_percent_per_day cannot exceed max_penalty_percent');

    const existing = await pool.query(`SELECT id FROM homework_penalty_settings WHERE tenant_id=$1 LIMIT 1`, [tid]);
    let result;
    if (existing.rows[0]) {
      result = await pool.query(
        `UPDATE homework_penalty_settings SET penalty_percent_per_day=$1, max_penalty_percent=$2, enabled=COALESCE($3,enabled)
         WHERE id=$4 AND tenant_id=$5 RETURNING *`,
        [ppd, mpp, enabled !== undefined ? enabled : null, existing.rows[0].id, tid]);
    } else {
      result = await pool.query(
        `INSERT INTO homework_penalty_settings (tenant_id, penalty_percent_per_day, max_penalty_percent, enabled)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tid, ppd, mpp, enabled !== undefined ? enabled : true]);
    }

    wsBroadcast(tid, 'homework:penalty_settings_updated', result.rows[0]);
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // STUDENT DASHBOARD API
  // ============================================================

  // GET /api/homework/student/dashboard — Student's personal dashboard
  app.get('/api/homework/student/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;

    const [pending, upcoming, recentGrades] = await Promise.all([
      pool.query(`SELECT ha.id, ha.title, ha.due_date, ha.submission_type, ha.total_marks, ha.description,
        sub.name AS subject_name, c.name AS class_name
        FROM homework_assignments ha
        LEFT JOIN subjects sub ON sub.id = ha.subject_id LEFT JOIN classes c ON c.id = ha.class_id
        WHERE ha.tenant_id=$1 AND ha.is_published=true
          AND NOT EXISTS (SELECT 1 FROM homework_submissions hs WHERE hs.assignment_id=ha.id AND hs.student_id=$2 AND hs.tenant_id=$1)
          AND ha.due_date IS NOT NULL AND ha.due_date >= NOW()
        ORDER BY ha.due_date ASC LIMIT 20`, [tid, userId]),
      pool.query(`SELECT ha.id, ha.title, ha.due_date, ha.total_marks,
        sub.name AS subject_name, c.name AS class_name,
        DATEDIFF(ha.due_date, NOW()) AS days_remaining
        FROM homework_assignments ha
        LEFT JOIN subjects sub ON sub.id = ha.subject_id LEFT JOIN classes c ON c.id = ha.class_id
        WHERE ha.tenant_id=$1 AND ha.is_published=true
          AND NOT EXISTS (SELECT 1 FROM homework_submissions hs WHERE hs.assignment_id=ha.id AND hs.student_id=$2 AND hs.tenant_id=$1)
          AND ha.due_date >= NOW()
        ORDER BY ha.due_date ASC LIMIT 5`, [tid, userId]),
      pool.query(`SELECT hs.id AS submission_id, hs.marks, hs.feedback, hs.graded_at,
        ha.title AS assignment_title, ha.total_marks, ha.subject_id,
        sub.name AS subject_name, ROUND(hs.marks / NULLIF(ha.total_marks,0) * 100, 1) AS percentage
        FROM homework_submissions hs
        JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1
        LEFT JOIN subjects sub ON sub.id=ha.subject_id
        WHERE hs.student_id=$2 AND hs.tenant_id=$1 AND hs.status='graded' AND hs.marks IS NOT NULL
        ORDER BY hs.graded_at DESC NULLS LAST LIMIT 10`, [tid, userId]),
    ]);

    const overdue = pending.rows.filter(r => r.due_date && new Date(r.due_date) < new Date());

    ok(res, {
      pending_assignments: pending.rows.filter(r => !overdue.includes(r)),
      overdue_assignments: overdue,
      upcoming_deadlines: upcoming.rows,
      recent_grades: recentGrades.rows,
      summary: {
        pending_count: pending.rows.length,
        overdue_count: overdue.length,
        recently_graded: recentGrades.rows.length,
      }
    });
  }));

  // ============================================================
  // UPGRADED: Peer Review System, HTML Frontend, Penalty Settings
  // ============================================================

  const renderHwPage = (title, content, user) => `<!DOCTYPE html><html><head><title>${esc(title)} — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
    .hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:24px;border-radius:16px;margin-bottom:20px}
    .hero h1{font-size:24px}.hero p{opacity:.9;margin-top:4px;font-size:14px}
    .card{background:#fff;padding:20px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px}
    .stat-card{background:#fff;padding:16px;border-radius:12px;border:1px solid #e2e8f0;text-align:center}
    .stat-num{font-size:28px;font-weight:700}.card h3{margin-bottom:12px;font-size:18px}
    .btn{display:inline-block;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px;text-decoration:none;color:#fff}
    .btn-primary{background:#6366f1}.btn-green{background:#10b981}.btn-red{background:#ef4444}.btn-sm{padding:4px 12px;font-size:12px}
    nav{background:#fff;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
    nav a{color:#6366f1;text-decoration:none;font-weight:600}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
    .badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fef2f2;color:#991b1b}.badge-yellow{background:#fef9c3;color:#854d0e}.badge-blue{background:#ede9fe;color:#5b21b6}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}th{font-weight:600;color:#64748b;font-size:13px}
    @media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card,.stat-card,nav{background:#1e293b;border-color:#334155}th{color:#94a3b8}td{border-color:#1e293b}a{color:#818cf8}}
    </style></head><body>
    <nav><a href="/">Comfort Zone</a><span style="font-size:14px;color:#64748b">Homework Module</span></nav>
    ${content}</body></html>`;

  // Peer Review Assignments
  app.post('/api/homework/assignments/:id/peer-review/assign', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const aid = req.params.id;
    const { reviewer_emails } = req.body; // array of student emails to assign reviews
    if (!Array.isArray(reviewer_emails) || reviewer_emails.length === 0) return errorRes(res, 400, 'Provide reviewer_emails array');
    const subs = (await pool.query('SELECT id, student_email FROM homework_submissions WHERE assignment_id=$1 AND status=$2', [aid, 'submitted'])).rows;
    if (subs.length === 0) return errorRes(res, 404, 'No submissions to review');
    let assigned = 0;
    for (const email of reviewer_emails.slice(0, subs.length)) {
      const sub = subs[assigned % subs.length];
      await pool.query('INSERT INTO homework_peer_reviews (tenant_id, assignment_id, reviewer_email, submission_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [tid, aid, email, sub.id]).catch(() => {});
      assigned++;
    }
    ok(res, { assigned, message: `${assigned} peer reviews assigned` });
  }));

  // Submit Peer Review
  app.post('/api/homework/peer-review/:submissionId', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const sid = req.params.submissionId;
    const { score, feedback } = req.body;
    if (score === undefined) return errorRes(res, 400, 'Score required');
    await pool.query('UPDATE homework_peer_reviews SET score=$1, feedback=$2 WHERE submission_id=$3 AND reviewer_email=$4 RETURNING id',
      [Math.min(100, Math.max(0, parseInt(score)||0)), feedback || '', sid, req.session?.user?.email]);
    ok(res, { message: 'Peer review submitted' });
  }));

  // Get Peer Review for Submission
  app.get('/api/homework/peer-review/:submissionId', requireAuth, ah(async (req, res) => {
    const reviews = (await pool.query('SELECT * FROM homework_peer_reviews WHERE submission_id=$1', [req.params.submissionId])).rows;
    ok(res, reviews);
  }));

  // Late Penalty Settings
  app.get('/api/homework/settings/penalties', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const settings = (await pool.query('SELECT * FROM homework_penalty_settings WHERE tenant_id=$1', [tid])).rows[0];
    ok(res, settings || { tenant_id: tid, penalty_percent_per_day: 5, max_penalty_percent: 50, enabled: true });
  }));

  app.put('/api/homework/settings/penalties', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { penalty_percent_per_day, max_penalty_percent, enabled } = req.body;
    await pool.query(`INSERT INTO homework_penalty_settings (tenant_id, penalty_percent_per_day, max_penalty_percent, enabled)
      VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET penalty_percent_per_day=$2, max_penalty_percent=$3, enabled=$4`,
      [tid, parseFloat(penalty_percent_per_day)||5, parseFloat(max_penalty_percent)||50, enabled !== false]);
    ok(res, { message: 'Penalty settings updated' });
  }));

  // HTML: Homework Dashboard
  app.get('/homework/dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const [assignments, pending, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM homework_assignments WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*) as total FROM homework_submissions hs JOIN homework_assignments ha ON ha.id=hs.assignment_id WHERE ha.tenant_id=$1 AND hs.status='submitted'", [tid]),
      pool.query('SELECT ha.title, ha.due_date, COUNT(hs.id) as sub_count FROM homework_assignments ha LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id WHERE ha.tenant_id=$1 GROUP BY ha.id, ha.title, ha.due_date ORDER BY ha.created_at DESC LIMIT 10', [tid]),
    ]);
    const user = req.session?.user || { name: 'User' };
    res.send(renderHwPage('Homework Dashboard', `
      <div class="hero"><h1>Homework Management</h1><p>${assignments.rows[0].total} assignments &bull; ${pending.rows[0].total} pending reviews</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#6366f1">${assignments.rows[0].total}</div><div>Total Assignments</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pending.rows[0].total}</div><div>Pending Reviews</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${recent.rows.length}</div><div>Recent Activity</div></div>
      </div>
      <div class="card"><h3>Recent Assignments</h3>
        <table><thead><tr><th>Title</th><th>Due Date</th><th>Submissions</th></tr></thead><tbody>
        ${recent.rows.map(r => `<tr><td>${esc(r.title)}</td><td>${r.due_date || '—'}</td><td><span class="badge badge-blue">${r.sub_count}</span></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/homework/assignments" class="btn btn-primary">View All Assignments</a>
        <a href="/api/homework/stats" class="btn btn-green">Statistics</a>
      </div>`, user));
  }));

  // HTML: Assignments List
  app.get('/homework/assignments', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { status, search } = req.query;
    let q = 'SELECT * FROM homework_assignments WHERE tenant_id=$1';
    const params = [tid];
    if (status) { q += ' AND status=$2'; params.push(status); }
    if (search) { q += ` AND title ILIKE $${params.length+1}`; params.push('%'+search+'%'); }
    q += ' ORDER BY created_at DESC LIMIT 50';
    const assignments = (await pool.query(q, params)).rows;
    res.send(renderHwPage('Assignments', `
      <div class="hero"><h1>All Assignments</h1><p>${assignments.length} assignments found</p></div>
      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="/homework/assignments" class="btn btn-sm btn-primary">All</a>
        <a href="/homework/assignments?status=draft" class="btn btn-sm" style="background:#94a3b8">Drafts</a>
        <a href="/homework/assignments?status=published" class="btn btn-sm" style="background:#94a3b8">Published</a>
      </div>
      <div class="card"><table><thead><tr><th>Title</th><th>Subject</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${assignments.map(a => `<tr><td><strong>${esc(a.title)}</strong></td><td>${esc(a.subject||'')}</td><td>${a.due_date||'—'}</td>
          <td><span class="badge ${a.status==='published'?'badge-green':a.status==='draft'?'badge-yellow':'badge-blue'}">${esc(a.status)}</span></td>
          <td><a href="/homework/assignments/${a.id}" class="btn btn-sm btn-primary">View</a></td></tr>`).join('')}
      </tbody></table></div>`, req.session?.user || {}));
  }));

  // HTML: Assignment Detail
  app.get('/homework/assignments/:id', requireAuth, ah(async (req, res) => {
    const assignment = (await pool.query('SELECT * FROM homework_assignments WHERE id=$1', [req.params.id])).rows[0];
    if (!assignment) return res.status(404).send('Not found');
    const subs = (await pool.query('SELECT * FROM homework_submissions WHERE assignment_id=$1 ORDER BY submitted_at DESC', [req.params.id])).rows;
    res.send(renderHwPage('Assignment: '+assignment.title, `
      <div class="hero"><h1>${esc(assignment.title)}</h1><p>Subject: ${esc(assignment.subject||'N/A')} &bull; Due: ${assignment.due_date||'No deadline'}</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#6366f1">${subs.length}</div><div>Submissions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${subs.filter(s=>s.status==='graded').length}</div><div>Graded</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${subs.filter(s=>s.status==='submitted').length}</div><div>Pending</div></div>
      </div>
      ${assignment.description ? `<div class="card"><h3>Description</h3><p style="margin-top:8px;color:#475569">${esc(assignment.description)}</p></div>` : ''}
      <div class="card"><h3>Submissions</h3><table><thead><tr><th>Student</th><th>Status</th><th>Score</th><th>Submitted</th></tr></thead><tbody>
        ${subs.map(s => `<tr><td>${esc(s.student_email)}</td>
          <td><span class="badge ${s.status==='graded'?'badge-green':s.status==='late'?'badge-red':'badge-blue'}">${esc(s.status)}</span></td>
          <td>${s.score !== null ? s.score+'/'+(s.max_score||100) : '—'}</td>
          <td>${s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—'}</td></tr>`).join('')}
      </tbody></table></div>`, req.session?.user || {}));
  }));

};
