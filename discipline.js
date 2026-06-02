// ============================================================
// DISCIPLINE & BEHAVIOR MODULE — Multi-Tenant SaaS Platform
// Incident recording, offense categories, consequence management,
// demerit point system, behavior tracking, parent communication,
// disciplinary committee, reports & analytics.
// ============================================================
// Usage in server.js:
//   const discipline = require('./discipline');
//   discipline(app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis }) => {

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  const VALID_SEVERITIES = ['minor', 'major', 'critical'];
  const VALID_INCIDENT_STATUS = ['open', 'under_review', 'resolved', 'closed'];
  const VALID_CONSEQUENCE_TYPES = ['warning', 'detention', 'suspension', 'counseling', 'community_service', 'expulsion'];
  const VALID_OFFENSE_CATEGORIES = ['dress_code', 'fighting', 'bullying', 'cheating', 'tardiness', 'truancy',
    'vandalism', 'substance_abuse', 'disrespect', 'other'];

  const errorRes = (res, status, msg, details) => {
    const body = { success: false, error: msg };
    if (details) body.details = details;
    return res.status(status).json(body);
  };
  const ok = (res, data, code) => res.status(code || 200).json({ success: true, data });

  // ─── Database Migrations ──────────────────────────────────
  (async () => {
    try {
      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_incidents (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, reporter_id INTEGER NOT NULL,
        type VARCHAR(100), category VARCHAR(50), severity VARCHAR(20) DEFAULT 'minor',
        description TEXT, location VARCHAR(255), witnesses JSONB DEFAULT '[]',
        evidence JSONB DEFAULT '[]', status VARCHAR(20) DEFAULT 'open',
        resolution TEXT, consequences JSONB DEFAULT '[]',
        demerit_points INTEGER DEFAULT 0,
        parent_notified BOOLEAN DEFAULT false, parent_acknowledged BOOLEAN DEFAULT false,
        parent_notified_at TIMESTAMPTZ, parent_acknowledged_at TIMESTAMPTZ,
        committee_referral BOOLEAN DEFAULT false, committee_id INTEGER,
        appeal_status VARCHAR(20) DEFAULT 'none',
        created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_consequences (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        incident_id INTEGER, student_id INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL, subtype VARCHAR(50),
        details TEXT, assigned_by INTEGER, start_date DATE,
        due_date DATE, completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMPTZ, completion_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_merits (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, category VARCHAR(100),
        description TEXT, points INTEGER DEFAULT 0,
        badge VARCHAR(100), awarded_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_offense_types (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL, category VARCHAR(50),
        severity VARCHAR(20) DEFAULT 'minor',
        default_consequence VARCHAR(50), demerit_points INTEGER DEFAULT 0,
        description TEXT, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_settings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        point_thresholds JSONB DEFAULT '[{"points":5,"action":"verbal_warning","label":"5 pts - Verbal Warning"},{"points":10,"action":"parent_meeting","label":"10 pts - Parent Meeting"},{"points":15,"action":"counseling_referral","label":"15 pts - Counseling Referral"},{"points":20,"action":"suspension","label":"20 pts - Suspension"},{"points":30,"action":"expulsion_referral","label":"30 pts - Expulsion Referral"}]',
        auto_notify_parent BOOLEAN DEFAULT true,
        require_acknowledgment BOOLEAN DEFAULT true,
        counseling_referral_threshold INTEGER DEFAULT 15,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_committee (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        incident_id INTEGER, student_id INTEGER NOT NULL,
        hearing_date TIMESTAMPTZ, hearing_location VARCHAR(255),
        committee_members JSONB DEFAULT '[]',
        summary TEXT, decision VARCHAR(255),
        decision_details TEXT, decided_at TIMESTAMPTZ,
        appeal_requested BOOLEAN DEFAULT false,
        appeal_reason TEXT, appeal_status VARCHAR(20) DEFAULT 'none',
        appeal_hearing_date TIMESTAMPTZ, appeal_decision TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Discipline', `CREATE TABLE IF NOT EXISTS discipline_demerit_history (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, incident_id INTEGER,
        points INTEGER NOT NULL, reason TEXT,
        balance_after INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_di_tenant ON discipline_incidents(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_di_student ON discipline_incidents(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_di_status ON discipline_incidents(status)',
        'CREATE INDEX IF NOT EXISTS idx_di_severity ON discipline_incidents(severity)',
        'CREATE INDEX IF NOT EXISTS idx_di_category ON discipline_incidents(category)',
        'CREATE INDEX IF NOT EXISTS idx_di_created ON discipline_incidents(created_at)',
        'CREATE INDEX IF NOT EXISTS idx_dc_tenant ON discipline_consequences(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dc_student ON discipline_consequences(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_dc_type ON discipline_consequences(type)',
        'CREATE INDEX IF NOT EXISTS idx_dm_tenant ON discipline_merits(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dm_student ON discipline_merits(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_dot_tenant ON discipline_offense_types(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dset_tenant ON discipline_settings(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dcom_tenant ON discipline_committee(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_dcom_incident ON discipline_committee(incident_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddh_tenant ON discipline_demerit_history(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddh_student ON discipline_demerit_history(student_id)',
      ]) { try { await migrateQuery(pool, 'Discipline', sql); } catch (_) {} }

      // Seed default offense types if none exist (per-tenant seeding happens on first use)
      console.log('[Discipline] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // Helper: seed default offense types for tenant
  async function seedOffenseTypes(tid) {
    const existing = await pool.query(`SELECT COUNT(*)::int AS cnt FROM discipline_offense_types WHERE tenant_id=$1`, [tid]);
    if (existing.rows[0].cnt > 0) return;
    const defaults = [
      { name: 'Dress Code Violation', category: 'dress_code', severity: 'minor', dc: 'warning', dp: 1 },
      { name: 'Tardiness', category: 'tardiness', severity: 'minor', dc: 'warning', dp: 1 },
      { name: 'Disrespect to Staff', category: 'disrespect', severity: 'minor', dc: 'warning', dp: 2 },
      { name: 'Minor Disruption', category: 'other', severity: 'minor', dc: 'warning', dp: 1 },
      { name: 'Cheating', category: 'cheating', severity: 'major', dc: 'detention', dp: 5 },
      { name: 'Truancy', category: 'truancy', severity: 'major', dc: 'detention', dp: 5 },
      { name: 'Fighting', category: 'fighting', severity: 'major', dc: 'suspension', dp: 10 },
      { name: 'Bullying', category: 'bullying', severity: 'major', dc: 'suspension', dp: 10 },
      { name: 'Vandalism', category: 'vandalism', severity: 'major', dc: 'suspension', dp: 8 },
      { name: 'Substance Abuse', category: 'substance_abuse', severity: 'critical', dc: 'expulsion', dp: 20 },
      { name: 'Severe Assault', category: 'fighting', severity: 'critical', dc: 'expulsion', dp: 25 },
      { name: 'Repeated Offenses', category: 'other', severity: 'critical', dc: 'suspension', dp: 15 },
    ];
    for (const d of defaults) {
      await pool.query(
        `INSERT INTO discipline_offense_types (tenant_id, name, category, severity, default_consequence, demerit_points, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, d.name, d.category, d.severity, d.dc, d.dp, `${d.name} — default offense type`]);
    }
  }

  // ============================================================
  // INCIDENT RECORDING
  // ============================================================

  // POST /api/discipline/incidents — Create incident
  app.post('/api/discipline/incidents', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, reporterId = req.user.id;
    const { student_id, type, category, severity, description, location, witnesses, evidence } = req.body;

    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (severity && !VALID_SEVERITIES.includes(severity))
      return errorRes(res, 400, 'Invalid severity', { valid: VALID_SEVERITIES });
    if (category && !VALID_OFFENSE_CATEGORIES.includes(category))
      return errorRes(res, 400, 'Invalid category', { valid: VALID_OFFENSE_CATEGORIES });
    if (!description?.trim()) return errorRes(res, 400, 'Description is required');

    // Ensure tenant has offense types seeded
    await seedOffenseTypes(tid);

    // Look up offense type for default points
    let demeritPoints = 0;
    const offenseType = type ? await pool.query(
      `SELECT demerit_points, default_consequence FROM discipline_offense_types WHERE tenant_id=$1 AND (id=$2 OR name=$3) AND is_active=true LIMIT 1`,
      [tid, type, type]
    ) : null;
    if (offenseType?.rows[0]) {
      demeritPoints = offenseType.rows[0].demerit_points;
    }

    let parsedWitnesses = [], parsedEvidence = [];
    try { if (witnesses) parsedWitnesses = Array.isArray(witnesses) ? witnesses : JSON.parse(witnesses); } catch {}
    try { if (evidence) parsedEvidence = Array.isArray(evidence) ? evidence : JSON.parse(evidence); } catch {}

    const result = await pool.query(
      `INSERT INTO discipline_incidents (tenant_id, student_id, reporter_id, type, category, severity, description, location, witnesses, evidence, demerit_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid, student_id, reporterId, type || null, category || null, severity || 'minor',
       description.trim(), location || null, JSON.stringify(parsedWitnesses), JSON.stringify(parsedEvidence), demeritPoints]);

    const incident = result.rows[0];

    // Add demerit history entry
    if (demeritPoints > 0) {
      const currentBalance = await pool.query(
        `SELECT COALESCE(SUM(points), 0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`,
        [tid, student_id]);
      const newBalance = currentBalance.rows[0].balance + demeritPoints;
      await pool.query(
        `INSERT INTO discipline_demerit_history (tenant_id, student_id, incident_id, points, reason, balance_after)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, student_id, incident.id, demeritPoints, `Incident #${incident.id}: ${description.trim().substring(0, 100)}`, newBalance]);

      // Check thresholds and create consequence if needed
      const settings = await pool.query(`SELECT point_thresholds FROM discipline_settings WHERE tenant_id=$1 LIMIT 1`, [tid]);
      if (settings.rows[0]?.point_thresholds) {
        const thresholds = typeof settings.rows[0].point_thresholds === 'string'
          ? JSON.parse(settings.rows[0].point_thresholds) : settings.rows[0].point_thresholds;
        const triggered = thresholds
          .filter(t => newBalance >= t.points && newBalance - demeritPoints < t.points)
          .sort((a, b) => b.points - a.points);
        if (triggered.length > 0) {
          const action = triggered[0];
          const consType = action.action.includes('suspension') ? 'suspension' :
            action.action.includes('expulsion') ? 'expulsion' :
            action.action.includes('counseling') ? 'counseling' : 'warning';
          await pool.query(
            `INSERT INTO discipline_consequences (tenant_id, incident_id, student_id, type, details, assigned_by, due_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [tid, incident.id, student_id, consType,
             `Auto-triggered: ${action.label}. Total demerit points: ${newBalance}`,
             reporterId, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)]);
          wsBroadcast(tid, 'discipline:threshold_triggered', { student_id, points: newBalance, action: action.label });
        }
      }
    }

    wsBroadcast(tid, 'discipline:incident_created', { incident_id: incident.id, student_id, severity: incident.severity });
    ok(res, incident, 201);
  }));

  // GET /api/discipline/incidents — List incidents
  app.get('/api/discipline/incidents', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, severity, status, category, from, to, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT di.*, u.name AS reporter_name, us.name AS student_name, uc.name AS class_name
               FROM discipline_incidents di
               LEFT JOIN users u ON u.id=di.reporter_id
               LEFT JOIN students ds ON ds.id=di.student_id
               LEFT JOIN users us ON us.id=ds.user_id
               LEFT JOIN classes uc ON uc.id=ds.class_id
               WHERE di.tenant_id = $1`;
    const params = [tid]; let pi = 2;

    if (student_id) { sql += ` AND di.student_id=$${pi}`; params.push(student_id); pi++; }
    if (severity && VALID_SEVERITIES.includes(severity)) { sql += ` AND di.severity=$${pi}`; params.push(severity); pi++; }
    if (status && VALID_INCIDENT_STATUS.includes(status)) { sql += ` AND di.status=$${pi}`; params.push(status); pi++; }
    if (category && VALID_OFFENSE_CATEGORIES.includes(category)) { sql += ` AND di.category=$${pi}`; params.push(category); pi++; }
    if (from) { sql += ` AND di.created_at >= $${pi}`; params.push(from); pi++; }
    if (to) { sql += ` AND di.created_at <= $${pi}`; params.push(to); pi++; }

    sql += ` ORDER BY di.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const [rows, cnt] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE tenant_id=$1`, [tid])
    ]);
    ok(res, { incidents: rows.rows, pagination: { page: pn, limit: ln, total: cnt.rows[0].total, pages: Math.ceil(cnt.rows[0].total / ln) } });
  }));

  // GET /api/discipline/incidents/:id — Single incident with consequences & committee
  app.get('/api/discipline/incidents/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const [incident, consequences, committee, history] = await Promise.all([
      pool.query(`SELECT di.*, u.name AS reporter_name FROM discipline_incidents di
        LEFT JOIN users u ON u.id=di.reporter_id WHERE di.id=$1 AND di.tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT dc.*, u.name AS assigned_by_name FROM discipline_consequences dc
        LEFT JOIN users u ON u.id=dc.assigned_by WHERE dc.incident_id=$1 AND dc.tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT * FROM discipline_committee WHERE incident_id=$1 AND tenant_id=$2`, [req.params.id, tid]),
      pool.query(`SELECT * FROM discipline_demerit_history WHERE incident_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [req.params.id, tid]),
    ]);
    if (!incident.rows[0]) return errorRes(res, 404, 'Incident not found');
    ok(res, { incident: incident.rows[0], consequences: consequences.rows, committee: committee.rows[0] || null, demerit_history: history.rows });
  }));

  // PUT /api/discipline/incidents/:id — Update incident
  app.put('/api/discipline/incidents/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { description, location, witnesses, evidence, status, resolution, severity, category } = req.body;
    const exists = await pool.query(`SELECT id, status AS old_status FROM discipline_incidents WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!exists.rows[0]) return errorRes(res, 404, 'Incident not found');

    let parsedWitnesses = null, parsedEvidence = null;
    if (witnesses !== undefined) {
      try { parsedWitnesses = JSON.stringify(Array.isArray(witnesses) ? witnesses : JSON.parse(witnesses)); } catch { return errorRes(res, 400, 'Invalid witnesses format'); }
    }
    if (evidence !== undefined) {
      try { parsedEvidence = JSON.stringify(Array.isArray(evidence) ? evidence : JSON.parse(evidence)); } catch { return errorRes(res, 400, 'Invalid evidence format'); }
    }

    const resolvedAt = (status === 'resolved' || status === 'closed') && exists.rows[0].old_status !== 'resolved' && exists.rows[0].old_status !== 'closed' ? 'NOW()' : null;

    const result = await pool.query(
      `UPDATE discipline_incidents SET description=COALESCE($1,description), location=COALESCE($2,location),
       witnesses=COALESCE($3,witnesses), evidence=COALESCE($4,evidence), status=COALESCE($5,status),
       resolution=COALESCE($6,resolution), severity=COALESCE($7,severity), category=COALESCE($8,category),
       resolved_at=COALESCE(${resolvedAt ? 'NOW()' : 'resolved_at'},resolved_at), updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [description || null, location || null, parsedWitnesses, parsedEvidence, status || null,
       resolution || null, severity || null, category || null, req.params.id, tid]);

    wsBroadcast(tid, 'discipline:incident_updated', { incident_id: req.params.id, status });
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // CONSEQUENCE MANAGEMENT
  // ============================================================

  // POST /api/discipline/consequences — Assign consequence
  app.post('/api/discipline/consequences', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, assignedBy = req.user.id;
    const { incident_id, student_id, type, subtype, details, start_date, due_date } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (!type || !VALID_CONSEQUENCE_TYPES.includes(type))
      return errorRes(res, 400, 'Invalid consequence type', { valid: VALID_CONSEQUENCE_TYPES });

    const result = await pool.query(
      `INSERT INTO discipline_consequences (tenant_id, incident_id, student_id, type, subtype, details, assigned_by, start_date, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, incident_id || null, student_id, type, subtype || null, details || null,
       assignedBy, start_date || null, due_date || null]);

    wsBroadcast(tid, 'discipline:consequence_assigned', { consequence_id: result.rows[0].id, student_id, type });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/discipline/consequences — List consequences
  app.get('/api/discipline/consequences', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, type, completed, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT dc.*, u.name AS assigned_by_name, us.name AS student_name
               FROM discipline_consequences dc
               LEFT JOIN users u ON u.id=dc.assigned_by
               LEFT JOIN students ds ON ds.id=dc.student_id
               LEFT JOIN users us ON us.id=ds.user_id
               WHERE dc.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (student_id) { sql += ` AND dc.student_id=$${pi}`; params.push(student_id); pi++; }
    if (type && VALID_CONSEQUENCE_TYPES.includes(type)) { sql += ` AND dc.type=$${pi}`; params.push(type); pi++; }
    if (completed !== undefined) { sql += ` AND dc.completed=$${pi}`; params.push(completed === 'true'); pi++; }
    sql += ` ORDER BY dc.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const rows = await pool.query(sql, params);
    ok(res, { consequences: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // PUT /api/discipline/consequences/:id/complete — Mark consequence complete
  app.put('/api/discipline/consequences/:id/complete', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { completion_notes } = req.body;
    const result = await pool.query(
      `UPDATE discipline_consequences SET completed=true, completed_at=NOW(), completion_notes=$1
       WHERE id=$2 AND tenant_id=$3 AND completed=false RETURNING *`, [completion_notes || null, req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Consequence not found or already completed');
    wsBroadcast(tid, 'discipline:consequence_completed', { consequence_id: req.params.id });
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // DEMERIT POINT SYSTEM
  // ============================================================

  // GET /api/discipline/demerits/:student_id — Student demerit balance & history
  app.get('/api/discipline/demerits/:student_id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.student_id;
    const [balance, history, settings] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(points), 0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
      pool.query(`SELECT dh.*, di.description AS incident_description FROM discipline_demerit_history dh
        LEFT JOIN discipline_incidents di ON di.id=dh.incident_id AND di.tenant_id=$1
        WHERE dh.tenant_id=$1 AND dh.student_id=$2 ORDER BY dh.created_at DESC LIMIT 50`, [tid, studentId]),
      pool.query(`SELECT point_thresholds FROM discipline_settings WHERE tenant_id=$1 LIMIT 1`, [tid]),
    ]);
    const currentBalance = balance.rows[0].balance;
    const thresholds = settings.rows[0]?.point_thresholds
      ? (typeof settings.rows[0].point_thresholds === 'string' ? JSON.parse(settings.rows[0].point_thresholds) : settings.rows[0].point_thresholds)
      : [];

    ok(res, { student_id: studentId, current_balance: currentBalance, history: history.rows, thresholds });
  }));

  // POST /api/discipline/demerits/:student_id/adjust — Manual point adjustment
  app.post('/api/discipline/demerits/:student_id/adjust', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.student_id;
    const { points, reason, incident_id } = req.body;
    if (!points || points === 0) return errorRes(res, 400, 'Non-zero points value required');
    if (!reason?.trim()) return errorRes(res, 400, 'Reason is required');

    const currentBalance = (await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`,
      [tid, studentId])).rows[0].balance;
    const newBalance = currentBalance + Number(points);

    if (newBalance < 0) return errorRes(res, 400, 'Balance cannot go below zero');

    await pool.query(
      `INSERT INTO discipline_demerit_history (tenant_id, student_id, incident_id, points, reason, balance_after)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, studentId, incident_id || null, Number(points), reason.trim(), newBalance]);

    // Update incident demerit_points if linked
    if (incident_id && Number(points) > 0) {
      await pool.query(
        `UPDATE discipline_incidents SET demerit_points = demerit_points + $1 WHERE id=$2 AND tenant_id=$3`,
        [Number(points), incident_id, tid]);
    }

    wsBroadcast(tid, 'discipline:points_adjusted', { student_id: studentId, points, new_balance: newBalance });
    ok(res, { student_id: studentId, points_adjusted: Number(points), new_balance: newBalance });
  }));

  // ============================================================
  // BEHAVIOR TRACKING (Merits)
  // ============================================================

  // POST /api/discipline/merits — Award merit
  app.post('/api/discipline/merits', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, awardedBy = req.user.id;
    const { student_id, category, description, points, badge } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (!category?.trim()) return errorRes(res, 400, 'category is required');
    if (!description?.trim()) return errorRes(res, 400, 'description is required');

    const result = await pool.query(
      `INSERT INTO discipline_merits (tenant_id, student_id, category, description, points, badge, awarded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, student_id, category.trim(), description.trim(), points || 0, badge || null, awardedBy]);

    wsBroadcast(tid, 'discipline:merit_awarded', { student_id, category, points: points || 0 });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/discipline/merits — List merits
  app.get('/api/discipline/merits', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, category, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));

    let sql = `SELECT dm.*, u.name AS awarded_by_name, us.name AS student_name
               FROM discipline_merits dm
               LEFT JOIN users u ON u.id=dm.awarded_by
               LEFT JOIN students ds ON ds.id=dm.student_id
               LEFT JOIN users us ON us.id=ds.user_id
               WHERE dm.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (student_id) { sql += ` AND dm.student_id=$${pi}`; params.push(student_id); pi++; }
    if (category) { sql += ` AND dm.category ILIKE '%' || $${pi} || '%'`; params.push(category); pi++; }
    sql += ` ORDER BY dm.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, (pn - 1) * ln);

    const rows = await pool.query(sql, params);
    ok(res, { merits: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // GET /api/discipline/behavior-trends/:student_id — Behavior trend over time
  app.get('/api/discipline/behavior-trends/:student_id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.student_id;
    const months = parseInt(req.query.months) || 6;
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);

    const [incidents, merits, demerits] = await Promise.all([
      pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, severity, COUNT(*)::int AS count
         FROM discipline_incidents WHERE tenant_id=$1 AND student_id=$2 AND created_at >= $3
         GROUP BY TO_CHAR(created_at, 'YYYY-MM'), severity ORDER BY month`,
        [tid, studentId, fromDate.toISOString()]),
      pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, category, SUM(points)::int AS points
         FROM discipline_merits WHERE tenant_id=$1 AND student_id=$2 AND created_at >= $3
         GROUP BY TO_CHAR(created_at, 'YYYY-MM'), category ORDER BY month`,
        [tid, studentId, fromDate.toISOString()]),
      pool.query(
        `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, SUM(points)::int AS points
         FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2 AND created_at >= $3
         GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month`,
        [tid, studentId, fromDate.toISOString()]),
    ]);

    ok(res, { student_id: studentId, period_months: months, incidents: incidents.rows, merits: merits.rows, demerit_trend: demerits.rows });
  }));

  // ============================================================
  // PARENT COMMUNICATION
  // ============================================================

  // POST /api/discipline/incidents/:id/notify-parent
  app.post('/api/discipline/incidents/:id/notify-parent', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, incidentId = req.params.id;
    const { message } = req.body;
    const incident = await pool.query(
      `SELECT di.*, s.parent_id FROM discipline_incidents di
       LEFT JOIN students s ON s.id=di.student_id AND s.tenant_id=$1
       WHERE di.id=$2 AND di.tenant_id=$1`, [tid, incidentId]);
    if (!incident.rows[0]) return errorRes(res, 404, 'Incident not found');
    if (!incident.rows[0].parent_id) return errorRes(res, 400, 'No parent associated with this student');

    await pool.query(
      `UPDATE discipline_incidents SET parent_notified=true, parent_notified_at=NOW() WHERE id=$1 AND tenant_id=$2`, [incidentId, tid]);
    const notifMsg = message || `Discipline incident reported regarding your child. Type: ${incident.rows[0].category || 'General'}. Severity: ${incident.rows[0].severity}.`;
    wsBroadcast(tid, 'discipline:parent_notified', { incident_id: incidentId, parent_id: incident.rows[0].parent_id, student_id: incident.rows[0].student_id, message: notifMsg });
    ok(res, { message: 'Parent notified successfully', parent_id: incident.rows[0].parent_id });
  }));

  // PUT /api/discipline/incidents/:id/acknowledge
  app.put('/api/discipline/incidents/:id/acknowledge', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const result = await pool.query(
      `UPDATE discipline_incidents SET parent_acknowledged=true, parent_acknowledged_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND parent_notified=true AND parent_acknowledged=false RETURNING id`, [req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Incident not found, not notified, or already acknowledged');
    wsBroadcast(tid, 'discipline:parent_acknowledged', { incident_id: req.params.id });
    ok(res, { message: 'Parent acknowledgment recorded' });
  }));

  // ============================================================
  // OFFENSE TYPES MANAGEMENT
  // ============================================================

  // GET /api/discipline/offense-types
  app.get('/api/discipline/offense-types', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    await seedOffenseTypes(tid);
    const { category, severity, is_active } = req.query;
    let sql = `SELECT * FROM discipline_offense_types WHERE tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (category) { sql += ` AND category=$${pi}`; params.push(category); pi++; }
    if (severity && VALID_SEVERITIES.includes(severity)) { sql += ` AND severity=$${pi}`; params.push(severity); pi++; }
    if (is_active !== undefined) { sql += ` AND is_active=$${pi}`; params.push(is_active === 'true'); pi++; }
    sql += ` ORDER BY severity, name`;
    ok(res, (await pool.query(sql, params)).rows);
  }));

  // POST /api/discipline/offense-types
  app.post('/api/discipline/offense-types', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, category, severity, default_consequence, demerit_points, description } = req.body;
    if (!name?.trim()) return errorRes(res, 400, 'Name is required');
    if (severity && !VALID_SEVERITIES.includes(severity))
      return errorRes(res, 400, 'Invalid severity', { valid: VALID_SEVERITIES });
    if (default_consequence && !VALID_CONSEQUENCE_TYPES.includes(default_consequence))
      return errorRes(res, 400, 'Invalid default_consequence', { valid: VALID_CONSEQUENCE_TYPES });

    const result = await pool.query(
      `INSERT INTO discipline_offense_types (tenant_id, name, category, severity, default_consequence, demerit_points, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, name.trim(), category || null, severity || 'minor', default_consequence || null,
       demerit_points || 0, description || null]);
    ok(res, result.rows[0], 201);
  }));

  // PUT /api/discipline/offense-types/:id
  app.put('/api/discipline/offense-types/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, category, severity, default_consequence, demerit_points, description, is_active } = req.body;
    const exists = await pool.query(`SELECT id FROM discipline_offense_types WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!exists.rows[0]) return errorRes(res, 404, 'Offense type not found');

    const result = await pool.query(
      `UPDATE discipline_offense_types SET name=COALESCE($1,name), category=COALESCE($2,category),
       severity=COALESCE($3,severity), default_consequence=COALESCE($4,default_consequence),
       demerit_points=COALESCE($5,demerit_points), description=COALESCE($6,description),
       is_active=COALESCE($7,is_active)
       WHERE id=$8 AND tenant_id=$9 RETURNING *`,
      [name || null, category || null, severity || null, default_consequence || null,
       demerit_points !== undefined ? demerit_points : null, description || null,
       is_active !== undefined ? is_active : null, req.params.id, tid]);
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // DISCIPLINARY COMMITTEE
  // ============================================================

  // POST /api/discipline/incidents/:id/referral
  app.post('/api/discipline/incidents/:id/referral', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, incidentId = req.params.id;
    const { hearing_date, hearing_location, committee_members } = req.body;

    const incident = await pool.query(`SELECT id, student_id FROM discipline_incidents WHERE id=$1 AND tenant_id=$2`, [incidentId, tid]);
    if (!incident.rows[0]) return errorRes(res, 404, 'Incident not found');

    let parsedMembers = [];
    if (committee_members) {
      try { parsedMembers = Array.isArray(committee_members) ? committee_members : JSON.parse(committee_members); }
      catch { return errorRes(res, 400, 'Invalid committee_members format'); }
    }

    await pool.query(`UPDATE discipline_incidents SET committee_referral=true, status='under_review', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [incidentId, tid]);

    const result = await pool.query(
      `INSERT INTO discipline_committee (tenant_id, incident_id, student_id, hearing_date, hearing_location, committee_members)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, incidentId, incident.rows[0].student_id, hearing_date || null, hearing_location || null, JSON.stringify(parsedMembers)]);

    wsBroadcast(tid, 'discipline:committee_referral', { incident_id: incidentId, student_id: incident.rows[0].student_id });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/discipline/committee — List committee cases
  app.get('/api/discipline/committee', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { status, student_id, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(50, Math.max(1, parseInt(limit) || 25));

    let sql = `SELECT dc.*, us.name AS student_name, di.description AS incident_description, di.severity AS incident_severity
               FROM discipline_committee dc
               LEFT JOIN students ds ON ds.id=dc.student_id
               LEFT JOIN users us ON us.id=ds.user_id
               LEFT JOIN discipline_incidents di ON di.id=dc.incident_id
               WHERE dc.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (student_id) { sql += ` AND dc.student_id=$${pi}`; params.push(student_id); pi++; }
    if (status) { sql += ` AND dc.appeal_status=$${pi}`; params.push(status); pi++; }
    sql += ` ORDER BY dc.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, (pn - 1) * ln);

    const rows = await pool.query(sql, params);
    ok(res, { cases: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // POST /api/discipline/committee/:id/decision
  app.post('/api/discipline/committee/:id/decision', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { decision, decision_details } = req.body;
    if (!decision?.trim()) return errorRes(res, 400, 'Decision is required');

    const result = await pool.query(
      `UPDATE discipline_committee SET decision=$1, decision_details=$2, decided_at=NOW()
       WHERE id=$3 AND tenant_id=$4 AND decision IS NULL RETURNING *`,
      [decision.trim(), decision_details || null, req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Case not found or already decided');

    // Update incident status
    if (result.rows[0].incident_id) {
      await pool.query(
        `UPDATE discipline_incidents SET status='resolved', resolved_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
        [result.rows[0].incident_id, tid]);
    }

    wsBroadcast(tid, 'discipline:committee_decision', { case_id: req.params.id, decision });
    ok(res, result.rows[0]);
  }));

  // POST /api/discipline/committee/:id/appeal
  app.post('/api/discipline/committee/:id/appeal', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { reason } = req.body;
    if (!reason?.trim()) return errorRes(res, 400, 'Appeal reason is required');

    const result = await pool.query(
      `UPDATE discipline_committee SET appeal_requested=true, appeal_reason=$1, appeal_status='pending'
       WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [reason.trim(), req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Case not found');

    wsBroadcast(tid, 'discipline:appeal_submitted', { case_id: req.params.id });
    ok(res, result.rows[0]);
  }));

  // POST /api/discipline/committee/:id/appeal-decision
  app.post('/api/discipline/committee/:id/appeal-decision', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { decision, hearing_date } = req.body;
    if (!decision?.trim()) return errorRes(res, 400, 'Appeal decision is required');

    const result = await pool.query(
      `UPDATE discipline_committee SET appeal_decision=$1, appeal_status='resolved',
       appeal_hearing_date=COALESCE($2, appeal_hearing_date)
       WHERE id=$3 AND tenant_id=$4 AND appeal_requested=true RETURNING *`,
      [decision.trim(), hearing_date || null, req.params.id, tid]);
    if (!result.rows[0]) return errorRes(res, 404, 'Case not found or no appeal pending');
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // SETTINGS
  // ============================================================

  // GET /api/discipline/settings
  app.get('/api/discipline/settings', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    let settings = (await pool.query(`SELECT * FROM discipline_settings WHERE tenant_id=$1 LIMIT 1`, [tid])).rows[0];
    if (!settings) settings = (await pool.query(`INSERT INTO discipline_settings (tenant_id) VALUES ($1) RETURNING *`, [tid])).rows[0];
    ok(res, settings);
  }));

  // PUT /api/discipline/settings
  app.put('/api/discipline/settings', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { point_thresholds, auto_notify_parent, require_acknowledgment, counseling_referral_threshold } = req.body;
    let parsedThresholds = null;
    if (point_thresholds !== undefined) {
      try { parsedThresholds = JSON.stringify(Array.isArray(point_thresholds) ? point_thresholds : JSON.parse(point_thresholds)); }
      catch { return errorRes(res, 400, 'Invalid point_thresholds format — expected JSON array'); }
    }
    const result = await pool.query(
      `UPDATE discipline_settings SET point_thresholds=COALESCE($1,point_thresholds), auto_notify_parent=COALESCE($2,auto_notify_parent),
       require_acknowledgment=COALESCE($3,require_acknowledgment), counseling_referral_threshold=COALESCE($4,counseling_referral_threshold), updated_at=NOW()
       WHERE tenant_id=$5 RETURNING *`,
      [parsedThresholds, auto_notify_parent !== undefined ? auto_notify_parent : null,
       require_acknowledgment !== undefined ? require_acknowledgment : null,
       counseling_referral_threshold !== undefined ? counseling_referral_threshold : null, tid]);
    ok(res, result.rows[0]);
  }));

  // ============================================================
  // REPORTS
  // ============================================================

  // GET /api/discipline/reports/overview — Overall discipline overview
  app.get('/api/discipline/reports/overview', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { from, to } = req.query;
    const fromDate = from || new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10);
    const toDate = to || today();

    const [totalIncidents, bySeverity, byCategory, byClass, repeatOffenders, openCases] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, fromDate, toDate]),
      pool.query(`SELECT severity, COUNT(*)::int AS count FROM discipline_incidents WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3 GROUP BY severity ORDER BY count DESC`, [tid, fromDate, toDate]),
      pool.query(`SELECT category, COUNT(*)::int AS count FROM discipline_incidents WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3 AND category IS NOT NULL GROUP BY category ORDER BY count DESC`, [tid, fromDate, toDate]),
      pool.query(`SELECT uc.name AS class_name, COUNT(di.id)::int AS incidents
        FROM discipline_incidents di LEFT JOIN students ds ON ds.id=di.student_id AND ds.tenant_id=$1
        LEFT JOIN classes uc ON uc.id=ds.class_id
        WHERE di.tenant_id=$1 AND di.created_at BETWEEN $2 AND $3 GROUP BY uc.name ORDER BY incidents DESC LIMIT 20`, [tid, fromDate, toDate]),
      pool.query(`SELECT di.student_id, us.name AS student_name, uc.name AS class_name, COUNT(di.id)::int AS incidents,
        SUM(di.demerit_points)::int AS total_points
        FROM discipline_incidents di LEFT JOIN students ds ON ds.id=di.student_id AND ds.tenant_id=$1
        LEFT JOIN users us ON us.id=ds.user_id LEFT JOIN classes uc ON uc.id=ds.class_id
        WHERE di.tenant_id=$1 AND di.created_at BETWEEN $2 AND $3
        GROUP BY di.student_id, us.name, uc.name HAVING COUNT(di.id) >= 3 ORDER BY incidents DESC LIMIT 20`, [tid, fromDate, toDate]),
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE tenant_id=$1 AND status IN ('open','under_review')`, [tid]),
    ]);
    ok(res, { period: { from: fromDate, to: toDate }, total_incidents: totalIncidents.rows[0].total,
      open_cases: openCases.rows[0].total, by_severity: bySeverity.rows, by_category: byCategory.rows,
      by_class: byClass.rows, repeat_offenders: repeatOffenders.rows });
  }));

  // GET /api/discipline/reports/student/:student_id — Individual student report
  app.get('/api/discipline/reports/student/:student_id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.student_id;
    const [incidents, merits, consequences, demeritBalance] = await Promise.all([
      pool.query(`SELECT di.* FROM discipline_incidents di WHERE di.tenant_id=$1 AND di.student_id=$2 ORDER BY di.created_at DESC`, [tid, studentId]),
      pool.query(`SELECT dm.* FROM discipline_merits dm WHERE dm.tenant_id=$1 AND dm.student_id=$2 ORDER BY dm.created_at DESC`, [tid, studentId]),
      pool.query(`SELECT dc.* FROM discipline_consequences dc WHERE dc.tenant_id=$1 AND dc.student_id=$2 ORDER BY dc.created_at DESC`, [tid, studentId]),
      pool.query(`SELECT COALESCE(SUM(points), 0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
    ]);
    const summary = {
      total: incidents.rows.length,
      minor: incidents.rows.filter(i => i.severity === 'minor').length,
      major: incidents.rows.filter(i => i.severity === 'major').length,
      critical: incidents.rows.filter(i => i.severity === 'critical').length,
      open: incidents.rows.filter(i => i.status === 'open' || i.status === 'under_review').length,
    };
    ok(res, {
      student_id: studentId, demerit_balance: demeritBalance.rows[0].balance,
      incidents, merits, consequences: consequences.rows,
      active_consequences: consequences.rows.filter(c => !c.completed),
      incident_summary: summary,
      total_merit_points: merits.rows.reduce((s, m) => s + (Number(m.points) || 0), 0),
    });
  }));

  // GET /api/discipline/reports/trends — Trend data for charts
  app.get('/api/discipline/reports/trends', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, months = parseInt(req.query.months) || 12;
    const rows = await pool.query(
      `SELECT TO_CHAR(di.created_at, 'YYYY-MM') AS month, di.severity, COUNT(*)::int AS count
       FROM discipline_incidents di WHERE di.tenant_id=$1 AND di.created_at >= CURRENT_DATE - ($2 || ' months')::interval
       GROUP BY TO_CHAR(di.created_at, 'YYYY-MM'), di.severity ORDER BY month, severity`, [tid, months]);
    ok(res, { months_period: months, data: rows.rows });
  }));
};
