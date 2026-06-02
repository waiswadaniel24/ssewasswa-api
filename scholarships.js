// ============================================================
// SCHOLARSHIPS & BURSARIES MANAGEMENT MODULE
// Multi-Tenant SaaS Platform — Comfort Zone
// ============================================================
// IMPORTANT: Add these tables to VALID_TABLES in server.js:
//   scholarship_programs, scholarship_applications,
//   scholarship_awards, scholarship_sponsors,
//   scholarship_evaluations
//
// Usage in server.js:
//   const scholarships = require('./scholarships');
//   scholarships(app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis }) => {

  // ── Helpers ───────────────────────────────────────────────
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.user?.role === 'super_admin') return next();
    try {
      const tid = req.tenant?.id || req.user?.tenant_id;
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [tid]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) {
        return res.status(403).json({ error: 'Subscription required', min_plan: minPlan, current_plan: plan, message: `Upgrade to ${minPlan} or higher to access this feature.` });
      }
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  const uuid = () => require('crypto').randomBytes(16).toString('hex');
  const parseNum = (v, fb = 0) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
  const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });
  const ok = (res, data, code = 200) => res.status(code).json({ success: true, ...data });
  const parseJson = (v, fb = {}) => typeof v === 'string' ? JSON.parse(v) : (v || fb);
  const NUM_FIELDS = new Set(['award_amount', 'coverage_value', 'min_gpa', 'min_attendance',
    'gpa', 'attendance_pct', 'financial_need_score', 'score', 'amount', 'pledge_amount', 'donated_amount']);
  const INT_FIELDS = new Set(['duration_months', 'max_recipients']);

  // ── Broadcast helper ──────────────────────────────────────
  const notify = async (tid, event, payload) => {
    try {
      if (wsBroadcast) wsBroadcast(`tenant:${tid}:scholarships`, { event, ...payload });
      if (redis) await redis.publish(`tenant:${tid}:notifications`, JSON.stringify({ event, module: 'scholarships', ...payload }));
    } catch (_) { /* best-effort */ }
  };

  const PROGRAM_TYPES = ['academic', 'sports', 'music', 'need_based', 'merit', 'special_category', 'corporate'];
  const COVERAGE_TYPES = ['full', 'partial', 'percentage'];

  // ── Generic field builder for UPDATE queries ──────────────
  const buildUpdate = (fields, body, numSet, intSet, jsonSet) => {
    const set = [], params = [], pi = { v: 0 };
    const nextP = () => `$${++pi.v}`;
    for (const f of fields) {
      if (body[f] === undefined) continue;
      if (numSet && numSet.has(f)) { set.push(`${f} = ${nextP()}`); params.push(parseNum(body[f])); }
      else if (intSet && intSet.has(f)) { set.push(`${f} = ${nextP()}`); params.push(parseInt(body[f]) || 0); }
      else if (jsonSet && jsonSet.has(f)) { set.push(`${f} = ${nextP()}`); params.push(parseJson(body[f])); }
      else if (f === 'is_active') { set.push(`is_active = ${nextP()}`); params.push(body[f] === true || body[f] === 'true'); }
      else if (f === 'deadline' || f === 'start_date' || f === 'end_date') { set.push(`${f} = ${nextP()}`); params.push(body[f] || null); }
      else { set.push(`${f} = ${nextP()}`); params.push(body[f]); }
    }
    return { set, params };
  };

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'Scholarships', `CREATE TABLE IF NOT EXISTS scholarship_programs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'academic', description TEXT, criteria JSONB DEFAULT '{}',
        award_amount NUMERIC(12,2) DEFAULT 0, coverage_type VARCHAR(20) DEFAULT 'partial',
        coverage_value NUMERIC(5,2) DEFAULT 0, duration_months INTEGER DEFAULT 12,
        max_recipients INTEGER DEFAULT 10, min_gpa NUMERIC(4,2) DEFAULT 3.0,
        min_attendance NUMERIC(5,2) DEFAULT 75.0, deadline DATE, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Scholarships', `CREATE TABLE IF NOT EXISTS scholarship_applications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, program_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, status VARCHAR(30) DEFAULT 'draft', gpa NUMERIC(4,2),
        attendance_pct NUMERIC(5,2), financial_need_score NUMERIC(5,2) DEFAULT 0,
        documents JSONB DEFAULT '[]', essay TEXT, recommendation_letters JSONB DEFAULT '[]',
        score NUMERIC(5,2), reviewer_notes TEXT, awarded_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Scholarships', `CREATE TABLE IF NOT EXISTS scholarship_awards (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, program_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, application_id INTEGER, amount NUMERIC(12,2) DEFAULT 0,
        coverage_type VARCHAR(20) DEFAULT 'partial', start_date DATE, end_date DATE,
        renewal_conditions JSONB DEFAULT '{}', status VARCHAR(20) DEFAULT 'active',
        installments JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Scholarships', `CREATE TABLE IF NOT EXISTS scholarship_sponsors (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
        email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255),
        pledge_amount NUMERIC(12,2) DEFAULT 0, donated_amount NUMERIC(12,2) DEFAULT 0,
        recognition_level VARCHAR(30) DEFAULT 'bronze', is_active BOOLEAN DEFAULT true,
        communication_log JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Scholarships', `CREATE TABLE IF NOT EXISTS scholarship_evaluations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, application_id INTEGER NOT NULL,
        evaluator_id INTEGER NOT NULL, scores JSONB DEFAULT '{}', comments TEXT,
        recommendation VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const idxs = [
        'idx_sch_prog_t ON scholarship_programs(tenant_id)', 'idx_sch_prog_type ON scholarship_programs(tenant_id, type)',
        'idx_sch_prog_active ON scholarship_programs(tenant_id, is_active)',
        'idx_sch_app_tenant ON scholarship_applications(tenant_id)', 'idx_sch_app_prog ON scholarship_applications(tenant_id, program_id)',
        'idx_sch_app_student ON scholarship_applications(tenant_id, student_id)', 'idx_sch_app_status ON scholarship_applications(tenant_id, status)',
        'idx_sch_award_tenant ON scholarship_awards(tenant_id)', 'idx_sch_award_student ON scholarship_awards(tenant_id, student_id)',
        'idx_sch_award_status ON scholarship_awards(tenant_id, status)',
        'idx_sch_sponsor_tenant ON scholarship_sponsors(tenant_id)',
        'idx_sch_eval_tenant ON scholarship_evaluations(tenant_id)', 'idx_sch_eval_app ON scholarship_evaluations(tenant_id, application_id)',
      ];
      for (const i of idxs) await migrateQuery(pool, 'Scholarships', `CREATE INDEX IF NOT EXISTS ${i}`);
      console.log('[Scholarships] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // 1. SCHOLARSHIP PROGRAMS — CRUD
  // ============================================================

  app.get('/api/scholarships/programs', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let w = ['sp.tenant_id = $1'], p = [tid], pi = 2;
    if (req.query.type) { w.push(`sp.type = $${pi++}`); p.push(req.query.type); }
    if (req.query.active !== undefined) { w.push(`sp.is_active = $${pi++}`); p.push(req.query.active === 'true'); }
    if (req.query.search) { w.push(`sp.name ILIKE $${pi++}`); p.push(`%${req.query.search}%`); }
    const r = await pool.query(
      `SELECT sp.*, (SELECT COUNT(*)::int FROM scholarship_applications sa WHERE sa.program_id=sp.id AND sa.tenant_id=$1) as apps,
        (SELECT COUNT(*)::int FROM scholarship_awards aw WHERE aw.program_id=sp.id AND aw.tenant_id=$1 AND aw.status='active') as active_awards
       FROM scholarship_programs sp WHERE ${w.join(' AND ')} ORDER BY sp.created_at DESC`, p);
    ok(res, { programs: r.rows, count: r.rows.length });
  }));

  app.get('/api/scholarships/programs/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM scholarship_programs WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenant.id]);
    if (!r.rows[0]) return err(res, 'Program not found', 404);
    ok(res, { program: r.rows[0] });
  }));

  app.post('/api/scholarships/programs', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, type, description, criteria, award_amount, coverage_type, coverage_value,
      duration_months, max_recipients, min_gpa, min_attendance, deadline, is_active } = req.body;
    if (!name || !type) return err(res, 'Name and type required');
    if (!PROGRAM_TYPES.includes(type)) return err(res, `Invalid type: ${PROGRAM_TYPES.join(', ')}`);
    if (coverage_type && !COVERAGE_TYPES.includes(coverage_type)) return err(res, `Invalid coverage: ${COVERAGE_TYPES.join(', ')}`);
    const r = await pool.query(
      `INSERT INTO scholarship_programs (tenant_id,name,type,description,criteria,award_amount,coverage_type,coverage_value,
        duration_months,max_recipients,min_gpa,min_attendance,deadline,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tid, name.trim(), type, description || null, parseJson(criteria), parseNum(award_amount), coverage_type || 'partial',
       parseNum(coverage_value), parseInt(duration_months) || 12, parseInt(max_recipients) || 10,
       parseNum(min_gpa, 3.0), parseNum(min_attendance, 75.0), deadline || null, is_active !== false]);
    await notify(tid, 'program:created', { programId: r.rows[0].id });
    ok(res, { program: r.rows[0] }, 201);
  }));

  app.put('/api/scholarships/programs/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const ex = await pool.query(`SELECT id FROM scholarship_programs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!ex.rows[0]) return err(res, 'Program not found', 404);
    const { set, params } = buildUpdate(
      ['name', 'type', 'description', 'criteria', 'award_amount', 'coverage_type', 'coverage_value',
       'duration_months', 'max_recipients', 'min_gpa', 'min_attendance', 'deadline', 'is_active'],
      req.body, NUM_FIELDS, INT_FIELDS, new Set(['criteria']));
    if (!set.length) return err(res, 'No fields to update');
    set.push("updated_at = NOW()");
    const r = await pool.query(`UPDATE scholarship_programs SET ${set.join(',')} WHERE id=$2 AND tenant_id=$1 RETURNING *`, [tid, req.params.id, ...params]);
    await notify(tid, 'program:updated', { programId: r.rows[0].id });
    ok(res, { program: r.rows[0] });
  }));

  app.delete('/api/scholarships/programs/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query(`UPDATE scholarship_programs SET is_active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id`, [req.params.id, req.tenant.id]);
    if (!r.rows[0]) return err(res, 'Program not found', 404);
    await notify(req.tenant.id, 'program:deactivated', { programId: +req.params.id });
    ok(res, { message: 'Program deactivated' });
  }));

  // ============================================================
  // 2. APPLICATIONS — Create, submit, track, update
  // ============================================================

  app.get('/api/scholarships/applications', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let w = ['sa.tenant_id = $1'], p = [tid], pi = 2;
    if (req.query.program_id) { w.push(`sa.program_id=$${pi++}`); p.push(req.query.program_id); }
    if (req.query.student_id) { w.push(`sa.student_id=$${pi++}`); p.push(req.query.student_id); }
    if (req.query.status) { w.push(`sa.status=$${pi++}`); p.push(req.query.status); }
    if (req.query.search) { w.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR sp.name ILIKE $${pi})`); p.push(`%${req.query.search}%`); pi++; }
    const r = await pool.query(
      `SELECT sa.*, sp.name as program_name, sp.type as program_type, sp.award_amount,
        s.first_name, s.last_name, s.admission_number
       FROM scholarship_applications sa JOIN scholarship_programs sp ON sp.id=sa.program_id
       LEFT JOIN students s ON s.id=sa.student_id WHERE ${w.join(' AND ')} ORDER BY sa.created_at DESC`, p);
    ok(res, { applications: r.rows, count: r.rows.length });
  }));

  app.get('/api/scholarships/applications/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, aid = req.params.id;
    const r = await pool.query(
      `SELECT sa.*, sp.name as program_name, sp.type as program_type, sp.award_amount, sp.min_gpa, sp.min_attendance,
        s.first_name, s.last_name, s.admission_number
       FROM scholarship_applications sa JOIN scholarship_programs sp ON sp.id=sa.program_id
       LEFT JOIN students s ON s.id=sa.student_id WHERE sa.id=$1 AND sa.tenant_id=$2`, [aid, tid]);
    if (!r.rows[0]) return err(res, 'Application not found', 404);
    const evals = await pool.query(
      `SELECT se.*, u.name as evaluator_name FROM scholarship_evaluations se
       LEFT JOIN users u ON u.id=se.evaluator_id WHERE se.application_id=$1 AND se.tenant_id=$2 ORDER BY se.created_at DESC`, [aid, tid]);
    ok(res, { application: r.rows[0], evaluations: evals.rows });
  }));

  app.post('/api/scholarships/applications', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { program_id, student_id, status, gpa, attendance_pct, financial_need_score,
      documents, essay, recommendation_letters } = req.body;
    if (!program_id || !student_id) return err(res, 'program_id and student_id required');

    const prog = await pool.query(`SELECT id,max_recipients,deadline,is_active FROM scholarship_programs WHERE id=$1 AND tenant_id=$2`, [program_id, tid]);
    if (!prog.rows[0]) return err(res, 'Program not found', 404);
    if (!prog.rows[0].is_active) return err(res, 'Program not accepting applications');
    if (prog.rows[0].deadline && new Date(prog.rows[0].deadline) < new Date()) return err(res, 'Deadline passed');

    const awards = await pool.query(`SELECT COUNT(*)::int as n FROM scholarship_awards WHERE program_id=$1 AND tenant_id=$2 AND status='active'`, [program_id, tid]);
    if (awards.rows[0].n >= prog.rows[0].max_recipients) return err(res, 'Max recipients reached');

    const dup = await pool.query(`SELECT id,status FROM scholarship_applications WHERE program_id=$1 AND student_id=$2 AND tenant_id=$3 AND status NOT IN ('rejected','withdrawn')`, [program_id, student_id, tid]);
    if (dup.rows[0]) return err(res, `Already applied (${dup.rows[0].status})`, 409);

    const st = status === 'submitted' ? 'submitted' : 'draft';
    const r = await pool.query(
      `INSERT INTO scholarship_applications (tenant_id,program_id,student_id,status,gpa,attendance_pct,financial_need_score,documents,essay,recommendation_letters)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tid, program_id, student_id, st, parseNum(gpa), parseNum(attendance_pct), parseNum(financial_need_score), parseJson(documents, []), essay || null, parseJson(recommendation_letters, [])]);
    await notify(tid, `application:${st}`, { applicationId: r.rows[0].id, programId: program_id });
    ok(res, { application: r.rows[0] }, 201);
  }));

  app.put('/api/scholarships/applications/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, aid = req.params.id;
    const ex = await pool.query(`SELECT id,status FROM scholarship_applications WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    if (!ex.rows[0]) return err(res, 'Application not found', 404);
    const staffStatuses = ['under_review', 'shortlisted', 'interview_scheduled', 'approved', 'rejected'];
    if (!['draft', 'submitted'].includes(ex.rows[0].status) && !staffStatuses.includes(req.body.status)) {
      return err(res, 'Cannot update application in current status');
    }
    const { set, params } = buildUpdate(
      ['gpa', 'attendance_pct', 'financial_need_score', 'essay', 'reviewer_notes', 'score', 'status', 'documents', 'recommendation_letters'],
      req.body, new Set(['gpa', 'attendance_pct', 'financial_need_score', 'score']), null, new Set(['documents', 'recommendation_letters']));
    set.push("updated_at = NOW()");
    if (req.body.status === 'approved') set.push("awarded_at = NOW()");
    const r = await pool.query(`UPDATE scholarship_applications SET ${set.join(',')} WHERE id=$2 AND tenant_id=$1 RETURNING *`, [tid, aid, ...params]);
    await notify(tid, 'application:updated', { applicationId: +aid, status: r.rows[0].status });
    ok(res, { application: r.rows[0] });
  }));

  app.post('/api/scholarships/applications/:id/submit', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, aid = req.params.id;
    const ex = await pool.query(`SELECT id,status FROM scholarship_applications WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    if (!ex.rows[0]) return err(res, 'Not found', 404);
    if (ex.rows[0].status !== 'draft') return err(res, 'Only drafts can be submitted');
    const r = await pool.query(`UPDATE scholarship_applications SET status='submitted',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [aid, tid]);
    await notify(tid, 'application:submitted', { applicationId: +aid });
    ok(res, { application: r.rows[0] });
  }));

  // ============================================================
  // 3. ELIGIBILITY CHECKING — GPA, attendance, need, capacity
  // ============================================================

  app.get('/api/scholarships/check-eligibility/:programId/:studentId', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, { programId, studentId } = req.params;
    const prog = await pool.query(`SELECT * FROM scholarship_programs WHERE id=$1 AND tenant_id=$2 AND is_active=true`, [programId, tid]);
    if (!prog.rows[0]) return err(res, 'Program not found or inactive', 404);
    const p = prog.rows[0];
    const checks = [];
    let eligible = true;

    // GPA check
    const gpaR = await pool.query(
      `SELECT COALESCE((SELECT AVG(gpa) FROM students WHERE id=$1 AND tenant_id=$2), 0) as v`, [studentId, tid]
    ).catch(() => ({ rows: [{ v: 0 }] }));
    const sgpa = parseNum(gpaR.rows[0].v);
    const gpaOk = sgpa >= parseNum(p.min_gpa, 0);
    checks.push({ criterion: 'GPA', required: parseNum(p.min_gpa, 0), actual: sgpa, met: gpaOk });
    if (!gpaOk) eligible = false;

    // Attendance check
    const attR = await pool.query(
      `SELECT COALESCE((SELECT AVG(present::numeric/NULLIF(total::numeric,0)*100) FROM attendance_records WHERE student_id=$1 AND tenant_id=$2), 0) as v`,
      [studentId, tid]).catch(() => ({ rows: [{ v: 0 }] }));
    const satt = parseNum(attR.rows[0].v);
    const attOk = satt >= parseNum(p.min_attendance, 0);
    checks.push({ criterion: 'Attendance', required: `${parseNum(p.min_attendance, 0)}%`, actual: `${satt.toFixed(1)}%`, met: attOk });
    if (!attOk) eligible = false;

    // Deadline check
    const dlOk = !p.deadline || new Date(p.deadline) >= new Date();
    checks.push({ criterion: 'Deadline', required: p.deadline || 'Open', actual: 'Now', met: dlOk });
    if (!dlOk) eligible = false;

    // No duplicate award
    const dupR = await pool.query(`SELECT COUNT(*)::int as n FROM scholarship_awards WHERE student_id=$1 AND program_id=$2 AND tenant_id=$3 AND status='active'`, [studentId, programId, tid]);
    const noDup = dupR.rows[0].n === 0;
    checks.push({ criterion: 'No Duplicate', required: true, actual: noDup, met: noDup });
    if (!noDup) eligible = false;

    // Capacity check
    const capR = await pool.query(`SELECT COUNT(*)::int as n FROM scholarship_awards WHERE program_id=$1 AND tenant_id=$2 AND status='active'`, [programId, tid]);
    const capOk = capR.rows[0].n < parseInt(p.max_recipients || 0);
    checks.push({ criterion: 'Capacity', required: `Max ${p.max_recipients}`, actual: `${capR.rows[0].n} awarded`, met: capOk });
    if (!capOk) eligible = false;

    // JSONB criteria checks (informational)
    if (p.criteria && typeof p.criteria === 'object') {
      if (p.criteria.special_categories) {
        const catR = await pool.query(`SELECT special_categories FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid]).catch(() => ({ rows: [{}] }));
        const cats = catR.rows[0]?.special_categories || '';
        checks.push({ criterion: 'Special Category', required: p.criteria.special_categories.join(', '), actual: cats || 'None', met: p.criteria.special_categories.some(c => cats.toLowerCase().includes(c.toLowerCase())) || undefined });
      }
      if (p.criteria.min_household_income) {
        checks.push({ criterion: 'Household Income', required: `Below ${p.criteria.min_household_income}`, actual: 'Manual verification', met: null });
      }
    }

    const metCount = checks.filter(c => c.met === true).length;
    const hardCount = checks.filter(c => c.met !== null).length;
    ok(res, { eligible, score: hardCount ? Math.round((metCount / hardCount) * 100) : 0, program: { id: p.id, name: p.name, type: p.type }, checks, gpa: sgpa, attendance: satt });
  }));

  app.post('/api/scholarships/bulk-eligibility', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, { program_id, student_ids } = req.body;
    if (!program_id || !Array.isArray(student_ids)) return err(res, 'program_id and student_ids array required');
    const results = [];
    for (const sid of student_ids.slice(0, 200)) {
      try {
        const c = await pool.query(
          `SELECT sp.min_gpa,sp.min_attendance,sp.deadline,
            (SELECT COUNT(*)::int FROM scholarship_awards sa WHERE sa.student_id=$2 AND sa.program_id=$1 AND sa.tenant_id=$3 AND sa.status='active') as has
           FROM scholarship_programs sp WHERE sp.id=$1 AND sp.tenant_id=$3 AND sp.is_active=true`, [program_id, sid, tid]);
        if (!c.rows[0]) continue;
        const dlOk = !c.rows[0].deadline || new Date(c.rows[0].deadline) >= new Date();
        results.push({ student_id: sid, eligible: c.rows[0].has === 0 && dlOk, deadline_met: dlOk, no_duplicate: c.rows[0].has === 0 });
      } catch (_) { results.push({ student_id: sid, eligible: false }); }
    }
    ok(res, { results, checked: results.length, eligible_count: results.filter(r => r.eligible).length });
  }));

  // ============================================================
  // 4. EVALUATION & SCORING — Committee review, shortlisting
  // ============================================================

  app.post('/api/scholarships/evaluations', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, { application_id, evaluator_id, scores, comments, recommendation } = req.body;
    if (!application_id || !evaluator_id) return err(res, 'application_id and evaluator_id required');
    const app = await pool.query(`SELECT id FROM scholarship_applications WHERE id=$1 AND tenant_id=$2`, [application_id, tid]);
    if (!app.rows[0]) return err(res, 'Application not found', 404);

    const validRecs = ['strong_approve', 'approve', 'neutral', 'reject', 'strong_reject'];
    const r = await pool.query(
      `INSERT INTO scholarship_evaluations (tenant_id,application_id,evaluator_id,scores,comments,recommendation)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, application_id, evaluator_id, parseJson(scores), comments || null, validRecs.includes(recommendation) ? recommendation : 'pending']);

    // Recompute average score for application
    const allEv = await pool.query(`SELECT scores FROM scholarship_evaluations WHERE application_id=$1 AND tenant_id=$2`, [application_id, tid]);
    if (allEv.rows.length) {
      const vals = allEv.rows.flatMap(e => Object.values(parseJson(e.scores)).map(Number).filter(n => !isNaN(n)));
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      await pool.query(`UPDATE scholarship_applications SET score=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [Math.round(avg * 100) / 100, application_id, tid]);
    }
    await notify(tid, 'evaluation:submitted', { applicationId: application_id });
    ok(res, { evaluation: r.rows[0] }, 201);
  }));

  app.get('/api/scholarships/evaluations/:applicationId', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query(
      `SELECT se.*, u.name as evaluator_name FROM scholarship_evaluations se
       LEFT JOIN users u ON u.id=se.evaluator_id WHERE se.application_id=$1 AND se.tenant_id=$2 ORDER BY se.created_at DESC`,
      [req.params.applicationId, req.tenant.id]);
    ok(res, { evaluations: r.rows });
  }));

  app.post('/api/scholarships/shortlist/:programId', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, pid = req.params.programId, limit = parseInt(req.body.limit) || 20;
    const prog = await pool.query(`SELECT id FROM scholarship_programs WHERE id=$1 AND tenant_id=$2`, [pid, tid]);
    if (!prog.rows[0]) return err(res, 'Program not found', 404);
    const r = await pool.query(
      `UPDATE scholarship_applications SET status='shortlisted', updated_at=NOW()
       WHERE id IN (SELECT sa.id FROM scholarship_applications sa WHERE sa.program_id=$1 AND sa.tenant_id=$2 AND sa.status='under_review'
         ORDER BY sa.score DESC NULLS LAST, sa.financial_need_score DESC NULLS LAST LIMIT $3) RETURNING id,student_id,score`,
      [pid, tid, limit]);
    await notify(tid, 'program:shortlisted', { programId: +pid, count: r.rows.length });
    ok(res, { shortlisted: r.rows, count: r.rows.length });
  }));

  // ============================================================
  // 5. AWARD MANAGEMENT — Disbursement, installments, renewal
  // ============================================================

  app.get('/api/scholarships/awards', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let w = ['aw.tenant_id = $1'], p = [tid], pi = 2;
    if (req.query.program_id) { w.push(`aw.program_id=$${pi++}`); p.push(req.query.program_id); }
    if (req.query.student_id) { w.push(`aw.student_id=$${pi++}`); p.push(req.query.student_id); }
    if (req.query.status) { w.push(`aw.status=$${pi++}`); p.push(req.query.status); }
    const r = await pool.query(
      `SELECT aw.*, sp.name as program_name, sp.type as program_type, s.first_name, s.last_name, s.admission_number
       FROM scholarship_awards aw JOIN scholarship_programs sp ON sp.id=aw.program_id
       LEFT JOIN students s ON s.id=aw.student_id WHERE ${w.join(' AND ')} ORDER BY aw.created_at DESC`, p);
    ok(res, { awards: r.rows, count: r.rows.length });
  }));

  app.post('/api/scholarships/awards', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { program_id, student_id, application_id, amount, coverage_type, start_date, end_date,
      renewal_conditions, installments } = req.body;
    if (!program_id || !student_id) return err(res, 'program_id and student_id required');

    const prog = await pool.query(`SELECT award_amount,coverage_type,duration_months FROM scholarship_programs WHERE id=$1 AND tenant_id=$2`, [program_id, tid]);
    if (!prog.rows[0]) return err(res, 'Program not found', 404);

    const amt = parseNum(amount) || parseNum(prog.rows[0].award_amount, 0);
    const cov = coverage_type || prog.rows[0].coverage_type || 'partial';
    const start = start_date || new Date().toISOString().slice(0, 10);
    const dur = parseInt(prog.rows[0].duration_months) || 12;
    const end = end_date || new Date(new Date(start).setMonth(new Date(start).getMonth() + dur)).toISOString().slice(0, 10);
    const renewDef = { min_gpa: 3.0, min_attendance: 85, max_disciplinary: 0 };
    const renew = parseJson(renewal_conditions, renewDef);
    const inst = parseJson(installments, []);

    const r = await pool.query(
      `INSERT INTO scholarship_awards (tenant_id,program_id,student_id,application_id,amount,coverage_type,start_date,end_date,renewal_conditions,installments,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active') RETURNING *`,
      [tid, program_id, student_id, application_id || null, amt, cov, start, end, renew, inst]);

    if (application_id) {
      await pool.query(`UPDATE scholarship_applications SET status='approved',awarded_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [application_id, tid]);
    }
    await notify(tid, 'award:created', { awardId: r.rows[0].id, programId: program_id, studentId: student_id, amount: amt });
    ok(res, { award: r.rows[0] }, 201);
  }));

  app.put('/api/scholarships/awards/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, aid = req.params.id;
    const ex = await pool.query(`SELECT id FROM scholarship_awards WHERE id=$1 AND tenant_id=$2`, [aid, tid]);
    if (!ex.rows[0]) return err(res, 'Award not found', 404);
    const { set, params } = buildUpdate(
      ['amount', 'coverage_type', 'start_date', 'end_date', 'status', 'installments'],
      req.body, new Set(['amount']), null, new Set(['installments']));
    if (!set.length) return err(res, 'No fields to update');
    const r = await pool.query(`UPDATE scholarship_awards SET ${set.join(',')} WHERE id=$2 AND tenant_id=$1 RETURNING *`, [tid, aid, ...params]);
    await notify(tid, 'award:updated', { awardId: +aid, status: r.rows[0].status });
    ok(res, { award: r.rows[0] });
  }));

  app.post('/api/scholarships/awards/:id/renew', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, aid = req.params.id;
    const aw = await pool.query(`SELECT * FROM scholarship_awards WHERE id=$1 AND tenant_id=$2 AND status='active'`, [aid, tid]);
    if (!aw.rows[0]) return err(res, 'Active award not found', 404);
    const a = aw.rows[0];
    const newEnd = new Date(a.end_date); newEnd.setMonth(newEnd.getMonth() + 12);
    const endStr = newEnd.toISOString().slice(0, 10);
    await pool.query(`UPDATE scholarship_awards SET end_date=$1,status='renewed' WHERE id=$2 AND tenant_id=$3`, [endStr, aid, tid]);
    await pool.query(
      `INSERT INTO scholarship_awards (tenant_id,program_id,student_id,application_id,amount,coverage_type,start_date,end_date,renewal_conditions,installments,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')`,
      [tid, a.program_id, a.student_id, a.application_id, a.amount, a.coverage_type, a.end_date, endStr, a.renewal_conditions, a.installments]);
    await notify(tid, 'award:renewed', { awardId: +aid, studentId: a.student_id });
    ok(res, { message: 'Award renewed', renewed_until: endStr });
  }));

  app.post('/api/scholarships/awards/:id/revoke', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const r = await pool.query(`UPDATE scholarship_awards SET status='revoked' WHERE id=$1 AND tenant_id=$2 RETURNING id,student_id`, [req.params.id, tid]);
    if (!r.rows[0]) return err(res, 'Award not found', 404);
    await notify(tid, 'award:revoked', { awardId: +req.params.id, studentId: r.rows[0].student_id, reason: req.body.reason });
    ok(res, { message: 'Award revoked' });
  }));

  // ============================================================
  // 6. DONOR / SPONSOR MANAGEMENT
  // ============================================================

  app.get('/api/scholarships/sponsors', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let w = ['ss.tenant_id = $1'], p = [tid], pi = 2;
    if (req.query.active !== undefined) { w.push(`ss.is_active=$${pi++}`); p.push(req.query.active === 'true'); }
    if (req.query.recognition_level) { w.push(`ss.recognition_level=$${pi++}`); p.push(req.query.recognition_level); }
    const r = await pool.query(`SELECT * FROM scholarship_sponsors ss WHERE ${w.join(' AND ')} ORDER BY ss.donated_amount DESC NULLS LAST, ss.created_at DESC`, p);
    ok(res, { sponsors: r.rows, count: r.rows.length });
  }));

  app.get('/api/scholarships/sponsors/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM scholarship_sponsors WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenant.id]);
    if (!r.rows[0]) return err(res, 'Sponsor not found', 404);
    ok(res, { sponsor: r.rows[0] });
  }));

  app.post('/api/scholarships/sponsors', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, { name, email, phone, company, pledge_amount, donated_amount, recognition_level } = req.body;
    if (!name) return err(res, 'Name required');
    const r = await pool.query(
      `INSERT INTO scholarship_sponsors (tenant_id,name,email,phone,company,pledge_amount,donated_amount,recognition_level,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, name.trim(), email || null, phone || null, company || null, parseNum(pledge_amount), parseNum(donated_amount), recognition_level || 'bronze', true]);
    await notify(tid, 'sponsor:created', { sponsorId: r.rows[0].id });
    ok(res, { sponsor: r.rows[0] }, 201);
  }));

  app.put('/api/scholarships/sponsors/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, sid = req.params.id;
    const ex = await pool.query(`SELECT id FROM scholarship_sponsors WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    if (!ex.rows[0]) return err(res, 'Sponsor not found', 404);
    const { set, params } = buildUpdate(
      ['name', 'email', 'phone', 'company', 'pledge_amount', 'donated_amount', 'recognition_level', 'is_active'],
      req.body, new Set(['pledge_amount', 'donated_amount']), null, null);
    if (!set.length) return err(res, 'No fields to update');
    const r = await pool.query(`UPDATE scholarship_sponsors SET ${set.join(',')} WHERE id=$2 AND tenant_id=$1 RETURNING *`, [tid, sid, ...params]);
    ok(res, { sponsor: r.rows[0] });
  }));

  app.post('/api/scholarships/sponsors/:id/log-communication', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, sid = req.params.id;
    const { method, subject, notes, date } = req.body;
    const ex = await pool.query(`SELECT id,communication_log FROM scholarship_sponsors WHERE id=$1 AND tenant_id=$2`, [sid, tid]);
    if (!ex.rows[0]) return err(res, 'Sponsor not found', 404);
    const log = parseJson(ex.rows[0].communication_log, []);
    log.push({ id: uuid().slice(0, 8), method: method || 'email', subject: subject || '', notes: notes || '', date: date || new Date().toISOString(), logged_by: req.user?.id });
    await pool.query(`UPDATE scholarship_sponsors SET communication_log=$1 WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(log), sid, tid]);
    ok(res, { message: 'Communication logged', entries: log.length });
  }));

  app.post('/api/scholarships/sponsors/:id/donate', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, sid = req.params.id, amt = parseNum(req.body.amount);
    if (amt <= 0) return err(res, 'Valid amount required');
    const r = await pool.query(
      `UPDATE scholarship_sponsors SET donated_amount=COALESCE(donated_amount,0)+$1 WHERE id=$2 AND tenant_id=$3 RETURNING id,name,donated_amount`,
      [amt, sid, tid]);
    if (!r.rows[0]) return err(res, 'Sponsor not found', 404);
    const total = parseNum(r.rows[0].donated_amount);
    let level = 'bronze';
    if (total >= 50000) level = 'platinum'; else if (total >= 20000) level = 'gold'; else if (total >= 5000) level = 'silver';
    await pool.query(`UPDATE scholarship_sponsors SET recognition_level=$1 WHERE id=$2 AND tenant_id=$3`, [level, sid, tid]);
    await notify(tid, 'sponsor:donation', { sponsorId: +sid, amount: amt, reference: req.body.reference });
    ok(res, { donated: amt, recognition_level: level, total_donated: total });
  }));

  // ============================================================
  // 7. REPORTS & ANALYTICS
  // ============================================================

  app.get('/api/scholarships/reports/overview', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const [programs, apps, pending, activeAwards] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as n FROM scholarship_programs WHERE tenant_id=$1 AND is_active=true`, [tid]),
      pool.query(`SELECT COUNT(*)::int as n FROM scholarship_applications WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int as n FROM scholarship_applications WHERE tenant_id=$1 AND status='submitted'`, [tid]),
      pool.query(`SELECT COUNT(*)::int as n FROM scholarship_awards WHERE tenant_id=$1 AND status IN ('active','renewed')`, [tid]),
    ]);
    const [disbursed, pledged, donated, sponsorN] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount),0)::numeric(14,2) as t FROM scholarship_awards WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(pledge_amount),0)::numeric(14,2) as t FROM scholarship_sponsors WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COALESCE(SUM(donated_amount),0)::numeric(14,2) as t FROM scholarship_sponsors WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int as n FROM scholarship_sponsors WHERE tenant_id=$1 AND is_active=true`, [tid]),
    ]);
    const pipeline = (await pool.query(`SELECT status, COUNT(*)::int as count FROM scholarship_applications WHERE tenant_id=$1 GROUP BY status ORDER BY count DESC`, [tid])).rows;
    const types = (await pool.query(`SELECT type, COUNT(*)::int as count FROM scholarship_programs WHERE tenant_id=$1 GROUP BY type`, [tid])).rows;
    ok(res, {
      stats: { activePrograms: programs.rows[0].n, totalApplications: apps.rows[0].n, pendingReviews: pending.rows[0].n, activeAwards: activeAwards.rows[0].n, totalDisbursed: disbursed.rows[0].t },
      sponsors: { count: sponsorN.rows[0].n, totalPledged: pledged.rows[0].t, totalDonated: donated.rows[0].t },
      pipeline, typeDistribution: types
    });
  }));

  app.get('/api/scholarships/reports/utilization', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const byProgram = (await pool.query(
      `SELECT sp.id,sp.name,sp.type,sp.award_amount,sp.max_recipients,sp.coverage_type,
        (SELECT COUNT(*)::int FROM scholarship_awards aw WHERE aw.program_id=sp.id AND aw.tenant_id=$1 AND aw.status='active') as awarded,
        COALESCE((SELECT SUM(aw.amount) FROM scholarship_awards aw WHERE aw.program_id=sp.id AND aw.tenant_id=$1),0)::numeric(12,2) as disbursed,
        (SELECT COUNT(*)::int FROM scholarship_applications sa WHERE sa.program_id=sp.id AND sa.tenant_id=$1) as applications
       FROM scholarship_programs sp WHERE sp.tenant_id=$1 AND sp.is_active=true ORDER BY sp.name`, [tid])).rows;
    const totalBudget = byProgram.reduce((s, p) => s + parseNum(p.award_amount) * parseInt(p.max_recipients), 0);
    const totalSpent = byProgram.reduce((s, p) => s + parseNum(p.disbursed), 0);
    ok(res, { byProgram, totalBudget, totalSpent, utilizationRate: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0 });
  }));

  app.get('/api/scholarships/reports/demographics', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const [byGender, byClass, byType] = await Promise.all([
      pool.query(`SELECT COALESCE(s.gender,'unspecified') as gender, COUNT(*)::int as count FROM scholarship_awards aw LEFT JOIN students s ON s.id=aw.student_id WHERE aw.tenant_id=$1 AND aw.status='active' GROUP BY s.gender`, [tid]),
      pool.query(`SELECT c.name as class_name, COUNT(*)::int as count, COALESCE(SUM(aw.amount),0)::numeric(12,2) as total FROM scholarship_awards aw LEFT JOIN students s ON s.id=aw.student_id LEFT JOIN classes c ON c.id=s.class_id WHERE aw.tenant_id=$1 AND aw.status='active' GROUP BY c.name ORDER BY count DESC`, [tid]),
      pool.query(`SELECT sp.type, COUNT(aw.id)::int as awards, COALESCE(SUM(aw.amount),0)::numeric(12,2) as total FROM scholarship_awards aw JOIN scholarship_programs sp ON sp.id=aw.program_id WHERE aw.tenant_id=$1 AND aw.status='active' GROUP BY sp.type ORDER BY awards DESC`, [tid]),
    ]);
    ok(res, { byGender: byGender.rows, byClass: byClass.rows, byType: byType.rows });
  }));

  app.get('/api/scholarships/reports/gpa-comparison', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const schStudents = (await pool.query(
      `SELECT aw.student_id, s.first_name, s.last_name, aw.amount, sp.name as program_name
       FROM scholarship_awards aw JOIN students s ON s.id=aw.student_id JOIN scholarship_programs sp ON sp.id=aw.program_id
       WHERE aw.tenant_id=$1 AND aw.status IN ('active','renewed')`, [tid])).rows;
    const ids = schStudents.map(s => s.student_id);
    let comparison = { scholarship_avg_gpa: null, non_scholarship_avg_gpa: null, difference: null, scholarship_count: 0 };
    if (ids.length) {
      const [schG, nonG] = await Promise.all([
        pool.query(`SELECT COALESCE(AVG(gpa),0)::numeric(4,2) as v FROM students WHERE id=ANY($1) AND tenant_id=$2 AND gpa IS NOT NULL`, [ids, tid]).catch(() => ({ rows: [{ v: 0 }] })),
        pool.query(`SELECT COALESCE(AVG(gpa),0)::numeric(4,2) as v FROM students WHERE id!=ALL($1) AND tenant_id=$2 AND gpa IS NOT NULL`, [ids, tid]).catch(() => ({ rows: [{ v: 0 }] })),
      ]);
      comparison = { scholarship_avg_gpa: parseNum(schG.rows[0].v), non_scholarship_avg_gpa: parseNum(nonG.rows[0].v), difference: parseNum(schG.rows[0].v) - parseNum(nonG.rows[0].v), scholarship_count: ids.length };
    }
    ok(res, { comparison, scholarship_students: schStudents });
  }));

  app.get('/api/scholarships/reports/retention', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const all = (await pool.query(
      `SELECT status, COUNT(*)::int as count FROM scholarship_awards WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;
    const m = {}; all.forEach(r => m[r.status] = r.count);
    const total = all.reduce((s, r) => s + r.count, 0) || 1;
    const byCoverage = (await pool.query(`SELECT coverage_type, COUNT(*)::int as count, COALESCE(SUM(amount),0)::numeric(12,2) as total FROM scholarship_awards WHERE tenant_id=$1 GROUP BY coverage_type`, [tid])).rows;
    ok(res, { retentionRate: Math.round(((m.active || 0) + (m.completed || 0) + (m.renewed || 0)) / total * 100), byStatus: m, byCoverage, total });
  }));

  // ============================================================
  // CSV EXPORT
  // ============================================================

  app.get('/api/scholarships/export/applications', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let w = ['sa.tenant_id = $1'], p = [tid], pi = 2;
    if (req.query.program_id) { w.push(`sa.program_id=$${pi++}`); p.push(req.query.program_id); }
    if (req.query.status) { w.push(`sa.status=$${pi++}`); p.push(req.query.status); }
    const r = await pool.query(
      `SELECT sa.id,sa.status,sa.gpa,sa.attendance_pct,sa.financial_need_score,sa.score,sa.created_at,sa.awarded_at,
        sp.name as program_name,sp.type,sp.award_amount,s.first_name,s.last_name,s.admission_number
       FROM scholarship_applications sa JOIN scholarship_programs sp ON sp.id=sa.program_id
       LEFT JOIN students s ON s.id=sa.student_id WHERE ${w.join(' AND ')} ORDER BY sa.created_at DESC`, p);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${Date.now()}.csv"`);
    const h = ['ID', 'Program', 'Type', 'Student', 'Adm#', 'Status', 'GPA', 'Attendance%', 'Need Score', 'Score', 'Amount', 'Applied', 'Awarded'];
    const rows = r.rows.map(r => [r.id, r.program_name, r.type, `${r.first_name||''} ${r.last_name||''}`.trim(), r.admission_number, r.status, r.gpa, r.attendance_pct, r.financial_need_score, r.score, r.award_amount, r.created_at, r.awarded_at]);
    res.send([h, ...rows].map(row => row.map(v => `"${String(v||'').replace(/"/g, '""')}"`).join(',')).join('\n'));
  }));

};
