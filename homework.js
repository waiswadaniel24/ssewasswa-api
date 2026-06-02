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

const { migrateQuery } = require('./db');
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
    try {
      await migrateQuery(pool, 'Homework', `CREATE TABLE IF NOT EXISTS homework_assignments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT,
        subject_id INTEGER, class_id INTEGER, teacher_id INTEGER,
        due_date TIMESTAMPTZ, total_marks NUMERIC(6,2) DEFAULT 100,
        submission_type VARCHAR(20) DEFAULT 'online',
        instructions JSONB DEFAULT '[]',
        is_published BOOLEAN DEFAULT false, grades_visible BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Homework', `CREATE TABLE IF NOT EXISTS homework_submissions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        content TEXT, files JSONB DEFAULT '[]',
        submitted_at TIMESTAMPTZ, status VARCHAR(20) DEFAULT 'draft',
        marks NUMERIC(6,2), feedback TEXT, rubric_scores JSONB,
        graded_by INTEGER, graded_at TIMESTAMPTZ, is_late BOOLEAN DEFAULT false,
        plagiarism_flag JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Homework', `CREATE TABLE IF NOT EXISTS homework_rubric (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        assignment_id INTEGER NOT NULL, criteria JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Homework', `CREATE TABLE IF NOT EXISTS homework_parent_notifications (
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
      ]) { try { await migrateQuery(pool, 'Homework', sql); } catch (_) {} }
      console.log('[Homework] Migrations applied successfully');
    } catch (e) { console.error('[Homework] Migration error:', e.message); }
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
};
