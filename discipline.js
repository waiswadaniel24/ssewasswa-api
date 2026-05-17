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
    let c = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      c = await pool.connect().catch(() => null);
      if (c) break;
      console.warn(`[Discipline] DB connection attempt ${attempt}/3 failed, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!c) { console.error('[Discipline] Cannot connect to DB for migrations after 3 attempts'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS discipline_incidents (
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

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_consequences (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        incident_id INTEGER, student_id INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL, subtype VARCHAR(50),
        details TEXT, assigned_by INTEGER, start_date DATE,
        due_date DATE, completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMPTZ, completion_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_merits (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, category VARCHAR(100),
        description TEXT, points INTEGER DEFAULT 0,
        badge VARCHAR(100), awarded_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_offense_types (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL, category VARCHAR(50),
        severity VARCHAR(20) DEFAULT 'minor',
        default_consequence VARCHAR(50), demerit_points INTEGER DEFAULT 0,
        description TEXT, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_settings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        point_thresholds JSONB DEFAULT $1,
        auto_notify_parent BOOLEAN DEFAULT true,
        require_acknowledgment BOOLEAN DEFAULT true,
        counseling_referral_threshold INTEGER DEFAULT 15,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`, [JSON.stringify([
        { points: 5, action: 'verbal_warning', label: '5 pts — Verbal Warning' },
        { points: 10, action: 'parent_meeting', label: '10 pts — Parent Meeting' },
        { points: 15, action: 'counseling_referral', label: '15 pts — Counseling Referral' },
        { points: 20, action: 'suspension', label: '20 pts — Suspension' },
        { points: 30, action: 'expulsion_referral', label: '30 pts — Expulsion Referral' },
      ])]);

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_committee (
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

      await c.query(`CREATE TABLE IF NOT EXISTS discipline_demerit_history (
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
      ]) { try { await c.query(sql); } catch (_) {} }

      // Seed default offense types if none exist (per-tenant seeding happens on first use)
      console.log('[Discipline] Migrations applied successfully');
    } catch (e) { console.error('[Discipline] Migration error:', e.message); }
    finally { c.release(); }
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
       FROM discipline_incidents di WHERE di.tenant_id=$1 AND di.created_at >= CURRENT_DATE - $2::interval
       GROUP BY TO_CHAR(di.created_at, 'YYYY-MM'), di.severity ORDER BY month, severity`, [tid, months + ' months']);
    ok(res, { months_period: months, data: rows.rows });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS
  // ============================================================
  const NEW_DISC_MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS discipline_detentions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
      incident_id INTEGER, student_id INTEGER NOT NULL,
      scheduled_date DATE NOT NULL, scheduled_time TIME NOT NULL DEFAULT '15:00:00',
      duration_minutes INTEGER DEFAULT 60, supervisor_id INTEGER,
      status VARCHAR(20) DEFAULT 'scheduled',
      checked_in_at TIMESTAMPTZ, checked_out_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];
  (async () => {
    const mc = await pool.connect().catch(() => null);
    if (!mc) return;
    try {
      for (const sql of NEW_DISC_MIGRATIONS) { try { await mc.query(sql); } catch (_) {} }
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_ddet_tenant ON discipline_detentions(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_student ON discipline_detentions(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_date ON discipline_detentions(scheduled_date)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_status ON discipline_detentions(status)',
      ]) { try { await mc.query(sql); } catch (_) {} }
      console.log('[Discipline] New migrations applied');
    } catch (e) { console.error('[Discipline] New migration error:', e.message); }
    finally { mc.release(); }
  })();

  // ─── Local helpers for HTML pages ──────────────────────────
  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const renderPage = (res, title, body) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f3f4f6;color:#1f2937;line-height:1.6}header{background:#7c2d12;color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between}header h1{font-size:1.25rem}nav a{color:#fbbf24;text-decoration:none;margin-left:1rem;font-size:.875rem}nav a:hover{color:#fff}.container{max-width:1200px;margin:2rem auto;padding:0 1rem}.card{background:#fff;border-radius:.75rem;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}.card h2{font-size:1.125rem;margin-bottom:.75rem;color:#7c2d12}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1rem}.stat{text-align:center;padding:1.5rem;background:linear-gradient(135deg,#7c2d12,#a0522d);color:#fff;border-radius:.75rem}.stat .num{font-size:2rem;font-weight:700}.stat .label{font-size:.8rem;opacity:.85;margin-top:.25rem}table{width:100%;border-collapse:collapse;font-size:.875rem}th,td{text-align:left;padding:.75rem;border-bottom:1px solid #e5e7eb}th{background:#f9fafb;font-weight:600;color:#374151}tr:hover{background:#f9fafb}.badge{display:inline-block;padding:.125rem .5rem;border-radius:9999px;font-size:.75rem;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#4b5563}.badge-purple{background:#ede9fe;color:#5b21b6}.btn{display:inline-block;padding:.5rem 1rem;border-radius:.5rem;text-decoration:none;font-size:.875rem;font-weight:500;border:none;cursor:pointer}.btn-primary{background:#7c2d12;color:#fff}.btn-primary:hover{background:#a0522d}.btn-sm{padding:.25rem .75rem;font-size:.75rem}.btn-danger{background:#dc2626;color:#fff}.btn-danger:hover{background:#b91c1c}.empty{text-align:center;padding:3rem;color:#6b7280}footer{margin-top:2rem;padding:1.5rem;text-align:center;font-size:.75rem;color:#9ca3af;border-top:1px solid #e5e7eb}</style></head><body><header><h1>${esc(title)}</h1><nav><a href="/discipline/dashboard">Dashboard</a><a href="/discipline/incidents">Incidents</a></nav></header><main class="container">${body}</main><footer>&copy; ${new Date().getFullYear()} School Portal — Discipline Module</footer></body></html>`);

  // ============================================================
  // HTML FRONTEND PAGES
  // ============================================================

  // GET /discipline/dashboard — Teacher/admin dashboard
  app.get('/discipline/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const [todayInc, pendingCons, openCases, recentInc, severityDist] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE tenant_id=$1 AND created_at >= $2`, [tid, today()]),
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_consequences WHERE tenant_id=$1 AND completed=false`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE tenant_id=$1 AND status IN ('open','under_review')`, [tid]),
      pool.query(`SELECT di.*, us.name AS student_name FROM discipline_incidents di LEFT JOIN students ds ON ds.id=di.student_id LEFT JOIN users us ON us.id=ds.user_id WHERE di.tenant_id=$1 ORDER BY di.created_at DESC LIMIT 15`, [tid]),
      pool.query(`SELECT severity, COUNT(*)::int AS count FROM discipline_incidents WHERE tenant_id=$1 GROUP BY severity ORDER BY count DESC`, [tid]),
    ]);
    const body = `
      <div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:2rem">
        <div class="stat"><div class="num">${esc(todayInc.rows[0].total)}</div><div class="label">Incidents Today</div></div>
        <div class="stat"><div class="num">${esc(openCases.rows[0].total)}</div><div class="label">Open Cases</div></div>
        <div class="stat"><div class="num">${esc(pendingCons.rows[0].total)}</div><div class="label">Pending Consequences</div></div>
        <div class="stat"><div class="num">${esc(todayInc.rows[0].total > 0 ? Math.round(severityDist.rows.filter(s=>s.severity==='critical').length/todayInc.rows[0].total*100) : 0)}%</div><div class="label">Critical Rate</div></div>
      </div>
      <div class="grid">
        <div class="card"><h2>Severity Distribution</h2>
          ${severityDist.rows.length ? `<table><tr><th>Severity</th><th>Count</th></tr>${severityDist.rows.map(r => `<tr><td><span class="badge ${r.severity==='critical'?'badge-red':r.severity==='major'?'badge-yellow':'badge-green'}">${esc(r.severity)}</span></td><td>${esc(r.count)}</td></tr>`).join('')}</table>` : '<p class="empty">No data</p>'}
        </div>
        <div class="card"><h2>Recent Incidents</h2>
          ${recentInc.rows.length ? `<table><tr><th>Student</th><th>Type</th><th>Severity</th><th>Status</th></tr>${recentInc.rows.map(r => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.category||r.type||'—')}</td><td><span class="badge ${r.severity==='critical'?'badge-red':r.severity==='major'?'badge-yellow':'badge-green'}">${esc(r.severity)}</span></td><td><span class="badge ${r.status==='open'?'badge-red':r.status==='resolved'?'badge-green':'badge-gray'}">${esc(r.status)}</span></td></tr>`).join('')}</table>` : '<p class="empty">No incidents</p>'}
        </div>
      </div>`;
    renderPage(res, 'Discipline Dashboard', body);
  }));

  // GET /discipline/incidents — Incidents list page
  app.get('/discipline/incidents', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { severity, status } = req.query;
    let sql = `SELECT di.*, us.name AS student_name FROM discipline_incidents di
      LEFT JOIN students ds ON ds.id=di.student_id LEFT JOIN users us ON us.id=ds.user_id
      WHERE di.tenant_id=$1`; const params = [tid]; let pi = 2;
    if (severity && VALID_SEVERITIES.includes(severity)) { sql += ` AND di.severity=$${pi++}`; params.push(severity); }
    if (status && VALID_INCIDENT_STATUS.includes(status)) { sql += ` AND di.status=$${pi++}`; params.push(status); }
    sql += ` ORDER BY di.created_at DESC LIMIT 50`;
    const rows = await pool.query(sql, params);
    const body = `
      <div class="card"><h2>All Incidents</h2>
        ${rows.rows.length ? `<table><tr><th>Student</th><th>Type</th><th>Severity</th><th>Status</th><th>Date</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r.student_name)}</td><td>${esc(r.category||'—')}</td><td><span class="badge ${r.severity==='critical'?'badge-red':r.severity==='major'?'badge-yellow':'badge-green'}">${esc(r.severity)}</span></td><td><span class="badge ${r.status==='open'?'badge-red':r.status==='resolved'?'badge-green':'badge-gray'}">${esc(r.status)}</span></td><td>${esc(r.created_at ? r.created_at.slice(0,10) : '')}</td><td><a class="btn btn-sm btn-primary" href="/discipline/incidents/${esc(r.id)}">View</a></td></tr>`).join('')}</table>` : '<p class="empty">No incidents found</p>'}
      </div>`;
    renderPage(res, 'Incidents', body);
  }));

  // GET /discipline/incidents/:id — Incident detail page
  app.get('/discipline/incidents/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, incId = req.params.id;
    const [incident, consequences] = await Promise.all([
      pool.query(`SELECT di.*, u.name AS reporter_name FROM discipline_incidents di LEFT JOIN users u ON u.id=di.reporter_id WHERE di.id=$1 AND di.tenant_id=$2`, [incId, tid]),
      pool.query(`SELECT dc.*, u.name AS assigned_by_name FROM discipline_consequences dc LEFT JOIN users u ON u.id=dc.assigned_by WHERE dc.incident_id=$1 AND dc.tenant_id=$2`, [incId, tid]),
    ]);
    if (!incident.rows[0]) return res.status(404).send('Incident not found');
    const i = incident.rows[0];
    const body = `
      <div class="card">
        <h2>Incident #${esc(i.id)}</h2>
        <p><strong>Student:</strong> ${esc(i.student_id)} &nbsp; <strong>Reporter:</strong> ${esc(i.reporter_name)}</p>
        <p><strong>Type:</strong> ${esc(i.category||'—')} &nbsp; <strong>Severity:</strong> <span class="badge ${i.severity==='critical'?'badge-red':i.severity==='major'?'badge-yellow':'badge-green'}">${esc(i.severity)}</span></p>
        <p><strong>Status:</strong> <span class="badge ${i.status==='open'?'badge-red':i.status==='resolved'?'badge-green':'badge-gray'}">${esc(i.status)}</span> &nbsp; <strong>Demerits:</strong> ${esc(i.demerit_points)}</p>
        ${i.description ? `<div style="margin-top:1rem;padding:1rem;background:#f9fafb;border-radius:.5rem">${esc(i.description)}</div>` : ''}
        ${i.resolution ? `<div style="margin-top:1rem;padding:1rem;background:#d1fae5;border-radius:.5rem"><strong>Resolution:</strong> ${esc(i.resolution)}</div>` : ''}
      </div>
      <div class="card"><h2>Consequences</h2>
        ${consequences.rows.length ? `<table><tr><th>Type</th><th>Details</th><th>Assigned By</th><th>Completed</th><th></th></tr>${consequences.rows.map(c => `<tr><td><span class="badge badge-purple">${esc(c.type)}</span></td><td>${esc(c.details||'—')}</td><td>${esc(c.assigned_by_name)}</td><td>${c.completed ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td><td>${!c.completed ? `<button class="btn btn-sm btn-primary" onclick="fetch('/api/discipline/consequences/${esc(c.id)}/complete',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({completion_notes:''}}).then(()=>location.reload())">Complete</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="empty">No consequences assigned</p>'}
      </div>`;
    renderPage(res, `Incident #${i.id}`, body);
  }));

  // ============================================================
  // DETENTION SCHEDULING
  // ============================================================

  // POST /api/discipline/detentions/schedule
  app.post('/api/discipline/detentions/schedule', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (!scheduled_date) return errorRes(res, 400, 'scheduled_date is required');
    if (!scheduled_time) return errorRes(res, 400, 'scheduled_time is required (HH:MM format)');
    if (duration_minutes && (Number(duration_minutes) < 15 || Number(duration_minutes) > 480))
      return errorRes(res, 400, 'duration_minutes must be between 15 and 480');
    if (!incident_id) return errorRes(res, 400, 'incident_id is required');

    const incident = await pool.query(`SELECT id, student_id FROM discipline_incidents WHERE id=$1 AND tenant_id=$2`, [incident_id, tid]);
    if (!incident.rows[0]) return errorRes(res, 404, 'Incident not found');

    const result = await pool.query(
      `INSERT INTO discipline_detentions (tenant_id, incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
      [tid, incident_id, student_id, scheduled_date, scheduled_time, Number(duration_minutes) || 60, supervisor_id || req.user.id]);

    wsBroadcast(tid, 'discipline:detention_scheduled', { detention_id: result.rows[0].id, student_id, scheduled_date });
    try { global.trackRevenue && global.trackRevenue(tid, 'detention_scheduled', {}); } catch {}
    ok(res, result.rows[0], 201);
  }));

  // GET /api/discipline/detentions
  app.get('/api/discipline/detentions', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { status, student_id, from, to, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;
    let sql = `SELECT dd.*, us.name AS student_name, u.name AS supervisor_name, di.description AS incident_description
      FROM discipline_detentions dd
      LEFT JOIN students ds ON ds.id=dd.student_id LEFT JOIN users us ON us.id=ds.user_id
      LEFT JOIN users u ON u.id=dd.supervisor_id
      LEFT JOIN discipline_incidents di ON di.id=dd.incident_id AND di.tenant_id=$1
      WHERE dd.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (status) { const validStatuses = ['scheduled','checked_in','checked_out','completed','cancelled']; if (validStatuses.includes(status)) { sql += ` AND dd.status=$${pi++}`; params.push(status); } }
    if (student_id) { sql += ` AND dd.student_id=$${pi++}`; params.push(student_id); }
    if (from) { sql += ` AND dd.scheduled_date >= $${pi++}`; params.push(from); }
    if (to) { sql += ` AND dd.scheduled_date <= $${pi++}`; params.push(to); }
    sql += ` ORDER BY dd.scheduled_date ASC, dd.scheduled_time ASC LIMIT $${pi++} OFFSET $${pi++}`;
    params.push(ln, offset);
    const [rows, cnt] = await Promise.all([pool.query(sql, params), pool.query(`SELECT COUNT(*)::int AS total FROM discipline_detentions WHERE tenant_id=$1`, [tid])]);
    ok(res, { detentions: rows.rows, pagination: { page: pn, limit: ln, total: cnt.rows[0].total, pages: Math.ceil(cnt.rows[0].total / ln) } });
  }));

  // POST /api/discipline/detentions/:id/checkin
  app.post('/api/discipline/detentions/:id/checkin', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, detId = req.params.id;
    const { action } = req.body;
    if (action !== 'checkin' && action !== 'checkout')
      return errorRes(res, 400, 'action must be "checkin" or "checkout"');

    const det = await pool.query(`SELECT id, status FROM discipline_detentions WHERE id=$1 AND tenant_id=$2`, [detId, tid]);
    if (!det.rows[0]) return errorRes(res, 404, 'Detention not found');

    if (action === 'checkin') {
      if (det.rows[0].status !== 'scheduled')
        return errorRes(res, 400, 'Detention must be in scheduled status to check in');
      const result = await pool.query(
        `UPDATE discipline_detentions SET status='checked_in', checked_in_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [detId, tid]);
      wsBroadcast(tid, 'discipline:detention_checkin', { detention_id: detId });
      ok(res, result.rows[0]);
    } else {
      if (det.rows[0].status !== 'checked_in')
        return errorRes(res, 400, 'Student must be checked in to check out');
      const result = await pool.query(
        `UPDATE discipline_detentions SET status='completed', checked_out_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [detId, tid]);
      wsBroadcast(tid, 'discipline:detention_checkout', { detention_id: detId });
      ok(res, result.rows[0]);
    }
  }));

  // ============================================================
  // ANONYMOUS REPORTING
  // ============================================================

  // POST /api/discipline/incidents/anonymous — No login required
  app.post('/api/discipline/incidents/anonymous', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, type, category, severity, description, location } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (severity && !VALID_SEVERITIES.includes(severity))
      return errorRes(res, 400, 'Invalid severity', { valid: VALID_SEVERITIES });
    if (category && !VALID_OFFENSE_CATEGORIES.includes(category))
      return errorRes(res, 400, 'Invalid category', { valid: VALID_OFFENSE_CATEGORIES });
    if (!description?.trim()) return errorRes(res, 400, 'Description is required');

    await seedOffenseTypes(tid);
    let demeritPoints = 0;
    const offenseType = type ? await pool.query(
      `SELECT demerit_points FROM discipline_offense_types WHERE tenant_id=$1 AND (id=$2 OR name=$3) AND is_active=true LIMIT 1`, [tid, type, type]
    ) : null;
    if (offenseType?.rows[0]) demeritPoints = offenseType.rows[0].demerit_points;

    const result = await pool.query(
      `INSERT INTO discipline_incidents (tenant_id, student_id, reporter_id, type, category, severity, description, location, demerit_points, status)
       VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,'open') RETURNING *`,
      [tid, student_id, type || null, category || null, severity || 'minor', description.trim(), location || null, demeritPoints]);

    if (demeritPoints > 0) {
      const currentBalance = await pool.query(
        `SELECT COALESCE(SUM(points), 0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`, [tid, student_id]);
      const newBalance = currentBalance.rows[0].balance + demeritPoints;
      await pool.query(
        `INSERT INTO discipline_demerit_history (tenant_id, student_id, incident_id, points, reason, balance_after) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, student_id, result.rows[0].id, demeritPoints, `Anonymous report #${result.rows[0].id}`, newBalance]);
    }

    wsBroadcast(tid, 'discipline:anonymous_incident', { incident_id: result.rows[0].id, student_id });
    ok(res, result.rows[0], 201);
  }));

  // ============================================================
  // BEHAVIOR REPORT CARD
  // ============================================================

  // GET /api/discipline/student/:id/report-card
  app.get('/api/discipline/student/:id/report-card', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.id;
    const [merits, demerits, incidents, balance, trends] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(points),0)::int AS total_points, COUNT(*)::int AS count,
        array_agg(DISTINCT category) AS categories
        FROM discipline_merits WHERE tenant_id=$1 AND student_id=$2 GROUP BY student_id`, [tid, studentId]),
      pool.query(`SELECT COALESCE(SUM(points),0)::int AS total_points, COUNT(*)::int AS count,
        (SELECT COUNT(*)::int FROM discipline_incidents WHERE tenant_id=$1 AND student_id=$2 AND created_at >= CURRENT_DATE - INTERVAL '6 months') AS recent_count
        FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2 GROUP BY student_id`, [tid, studentId]),
      pool.query(`SELECT COUNT(*)::int AS total, severity, status FROM discipline_incidents WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
      pool.query(`SELECT COALESCE(SUM(points),0)::int AS balance FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
      pool.query(`SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*)::int AS incidents,
        SUM(CASE WHEN severity='critical' THEN 3 WHEN severity='major' THEN 2 ELSE 1 END)::int AS weighted_score
        FROM discipline_incidents WHERE tenant_id=$1 AND student_id=$2 AND created_at >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month`, [tid, studentId]),
    ]);
    const summary = incidents.rows.reduce((acc, row) => {
      acc[row.severity] = (acc[row.severity] || 0) + 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    const trendScore = trends.rows.length > 1
      ? (trends.rows[trends.rows.length - 1].weighted_score - trends.rows[0].weighted_score) / Math.max(1, trends.rows.length - 1)
      : 0;

    ok(res, {
      student_id: studentId,
      merits: { total_points: merits.rows[0]?.total_points || 0, count: merits.rows[0]?.count || 0, categories: merits.rows[0]?.categories || [] },
      demerits: { total_points: demerits.rows[0]?.total_points || 0, count: demerits.rows[0]?.count || 0, recent_count: demerits.rows[0]?.recent_count || 0 },
      demerit_balance: balance.rows[0].balance,
      incident_summary: summary,
      trend: trendScore > 0 ? 'worsening' : trendScore < 0 ? 'improving' : 'stable',
      trend_score: Math.round(trendScore * 100) / 100,
    });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS — Detention Table
  // ============================================================
  (async () => {
    const mc = await pool.connect().catch(() => null);
    if (!mc) return;
    try {
      await mc.query(`CREATE TABLE IF NOT EXISTS discipline_detentions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        incident_id INTEGER, student_id INTEGER NOT NULL,
        scheduled_date DATE, scheduled_time TIME,
        duration_minutes INTEGER DEFAULT 60,
        supervisor_id INTEGER, status TEXT DEFAULT 'scheduled',
        checked_in_at TIMESTAMPTZ, checked_out_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_ddet_tenant ON discipline_detentions(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_student ON discipline_detentions(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_status ON discipline_detentions(status)',
        'CREATE INDEX IF NOT EXISTS idx_ddet_date ON discipline_detentions(scheduled_date)',
      ]) { try { await mc.query(sql); } catch (_) {} }
      console.log('[Discipline] Detention migration applied');
    } catch (e) { console.error('[Discipline] Detention migration error:', e.message); }
    finally { mc.release(); }
  })();

  // ============================================================
  // HTML FRONTEND PAGES (SSR)
  // ============================================================

  // GET /discipline/dashboard — Teacher/admin dashboard
  app.get('/discipline/dashboard', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const [stats, recentIncidents, bySeverity, byCategory] = await Promise.all([
      pool.query(`SELECT
        COUNT(*)::int AS total_incidents,
        COUNT(*) FILTER(WHERE status='open')::int AS open_incidents,
        COUNT(*) FILTER(WHERE status='resolved')::int AS resolved_incidents,
        COUNT(*) FILTER(WHERE severity='critical')::int AS critical_incidents,
        COUNT(*) FILTER(WHERE created_at >= NOW() - INTERVAL '7 days')::int AS this_week
        FROM discipline_incidents WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT di.id, di.description, di.category, di.severity, di.status, di.created_at,
        us.name AS student_name, uc.name AS class_name
        FROM discipline_incidents di
        LEFT JOIN students ds ON ds.id=di.student_id LEFT JOIN users us ON us.id=ds.user_id
        LEFT JOIN classes uc ON uc.id=ds.class_id
        WHERE di.tenant_id=$1 ORDER BY di.created_at DESC LIMIT 10`, [tid]),
      pool.query(`SELECT severity, COUNT(*)::int AS count FROM discipline_incidents WHERE tenant_id=$1 GROUP BY severity`, [tid]),
      pool.query(`SELECT category, COUNT(*)::int AS count FROM discipline_incidents WHERE tenant_id=$1 GROUP BY category ORDER BY count DESC`, [tid]),
    ]);
    const s = stats.rows[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Discipline Dashboard</title>
      <style>body{font-family:system-ui;max-width:1200px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}
      h1{color:#333}h2{color:#555;border-bottom:2px solid #eee;padding-bottom:.3em}
      .stats{display:flex;gap:1em;margin:1em 0;flex-wrap:wrap}.stat{background:#f9f9f9;padding:1em;border-radius:8px;flex:1;min-width:140px;text-align:center}
      .stat .num{font-size:2em;font-weight:bold}.stat .lbl{font-size:.85em;color:#888}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .minor{background:#10b981}.major{background:#f59e0b}.critical{background:#ef4444}
      .open{background:#3b82f6}.resolved{background:#10b981}.under_review{background:#f59e0b}</style></head><body>
      <h1>Discipline Dashboard</h1>
      <div class="stats">
        <div class="stat"><div class="num">${s.total_incidents}</div><div class="lbl">Total Incidents</div></div>
        <div class="stat"><div class="num">${s.open_incidents}</div><div class="lbl">Open</div></div>
        <div class="stat"><div class="num">${s.resolved_incidents}</div><div class="lbl">Resolved</div></div>
        <div class="stat"><div class="num">${s.critical_incidents}</div><div class="lbl">Critical</div></div>
        <div class="stat"><div class="num">${s.this_week}</div><div class="lbl">This Week</div></div>
      </div>
      <h2>Recent Incidents</h2>
      <table><tr><th>ID</th><th>Student</th><th>Class</th><th>Description</th><th>Category</th><th>Severity</th><th>Status</th><th>Date</th></tr>
      ${recentIncidents.rows.map(i=>`<tr><td>${i.id}</td><td>${esc(i.student_name||'—')}</td><td>${esc(i.class_name||'—')}</td>
        <td>${esc((i.description||'').substring(0,60))}${(i.description||'').length>60?'...':''}</td>
        <td>${esc(i.category||'—')}</td><td><span class="badge ${i.severity}">${i.severity}</span></td>
        <td><span class="badge ${i.status}">${i.status.replace('_',' ')}</span></td><td>${i.created_at?.slice(0,10)||'—'}</td></tr>`).join('')}
      ${recentIncidents.rows.length===0?'<tr><td colspan="8">No incidents found</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // GET /discipline/incidents — HTML page listing incidents
  app.get('/discipline/incidents', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { severity, status, category } = req.query;
    let sql = `SELECT di.*, us.name AS student_name, uc.name AS class_name
               FROM discipline_incidents di
               LEFT JOIN students ds ON ds.id=di.student_id
               LEFT JOIN users us ON us.id=ds.user_id LEFT JOIN classes uc ON uc.id=ds.class_id
               WHERE di.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (severity && VALID_SEVERITIES.includes(severity)) { sql += ` AND di.severity=$${pi}`; params.push(severity); pi++; }
    if (status && VALID_INCIDENT_STATUS.includes(status)) { sql += ` AND di.status=$${pi}`; params.push(status); pi++; }
    if (category && VALID_OFFENSE_CATEGORIES.includes(category)) { sql += ` AND di.category=$${pi}`; params.push(category); pi++; }
    sql += ` ORDER BY di.created_at DESC LIMIT 50`;
    const rows = await pool.query(sql, params);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Incidents</title>
      <style>body{font-family:system-ui;max-width:1200px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}
      a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .minor{background:#10b981}.major{background:#f59e0b}.critical{background:#ef4444}
      .open{background:#3b82f6}.resolved{background:#10b981}.under_review{background:#f59e0b}.closed{background:#9ca3af}
      .filters{margin:1em 0;padding:1em;background:#f9f9f9;border-radius:8px}.filters label{margin-right:1em}
      select{padding:4px 8px;border:1px solid #ddd;border-radius:4px}</style></head><body>
      <h1>Discipline Incidents</h1>
      <div class="filters">
        <label>Severity: <select onchange="location.href='/discipline/incidents?severity='+this.value"><option value="">All</option>
        <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label>
        <label>Status: <select onchange="location.href='/discipline/incidents?status='+this.value"><option value="">All</option>
        <option value="open">Open</option><option value="under_review">Under Review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label>
      </div>
      <table><tr><th>ID</th><th>Student</th><th>Class</th><th>Category</th><th>Severity</th><th>Description</th><th>Status</th><th>Date</th></tr>
      ${rows.rows.map(i=>`<tr><td><a href="/discipline/incidents/${i.id}">#${i.id}</a></td><td>${esc(i.student_name||'—')}</td><td>${esc(i.class_name||'—')}</td>
        <td>${esc(i.category||'—')}</td><td><span class="badge ${i.severity}">${i.severity}</span></td>
        <td>${esc((i.description||'').substring(0,50))}${(i.description||'').length>50?'...':''}</td>
        <td><span class="badge ${i.status}">${i.status.replace('_',' ')}</span></td><td>${i.created_at?.slice(0,10)||'—'}</td></tr>`).join('')}
      ${rows.rows.length===0?'<tr><td colspan="8">No incidents found</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // GET /discipline/incidents/:id — Incident detail page with action buttons
  app.get('/discipline/incidents/:id', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, incidentId = req.params.id;
    const [incident, consequences, committee, history] = await Promise.all([
      pool.query(`SELECT di.*, u.name AS reporter_name FROM discipline_incidents di
        LEFT JOIN users u ON u.id=di.reporter_id WHERE di.id=$1 AND di.tenant_id=$2`, [incidentId, tid]),
      pool.query(`SELECT dc.*, u.name AS assigned_by_name FROM discipline_consequences dc
        LEFT JOIN users u ON u.id=dc.assigned_by WHERE dc.incident_id=$1 AND dc.tenant_id=$2`, [incidentId, tid]),
      pool.query(`SELECT * FROM discipline_committee WHERE incident_id=$1 AND tenant_id=$2`, [incidentId, tid]),
      pool.query(`SELECT * FROM discipline_demerit_history WHERE incident_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [incidentId, tid]),
    ]);
    if (!incident.rows[0]) return errorRes(res, 404, 'Incident not found');
    const i = incident.rows[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Incident #${i.id}</title>
      <style>body{font-family:system-ui;max-width:1000px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}
      h1{color:#333}h2{color:#555;border-bottom:2px solid #eee;padding-bottom:.3em}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:.5em;margin:1em 0;font-size:.9em}
      .info dt{font-weight:bold;color:#555}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .minor{background:#10b981}.major{background:#f59e0b}.critical{background:#ef4444}
      .open{background:#3b82f6}.resolved{background:#10b981}.under_review{background:#f59e0b}.closed{background:#9ca3af}
      .actions{margin:1em 0;padding:1em;background:#f0f9ff;border-radius:8px}
      .actions button{padding:6px 16px;margin-right:8px;border:none;border-radius:4px;cursor:pointer;font-size:.9em;color:#fff}
      .btn-warn{background:#f59e0b}.btn-ok{background:#10b981}.btn-info{background:#3b82f6}.btn-danger{background:#ef4444}</style></head><body>
      <h1>Incident #${i.id}</h1>
      <dl class="info">
        <dt>Severity</dt><dd><span class="badge ${i.severity}">${i.severity}</span></dd>
        <dt>Status</dt><dd><span class="badge ${i.status}">${i.status.replace('_',' ')}</span></dd>
        <dt>Category</dt><dd>${esc(i.category||'—')}</dd>
        <dt>Reporter</dt><dd>${esc(i.reporter_name||'—')}</dd>
        <dt>Location</dt><dd>${esc(i.location||'—')}</dd>
        <dt>Created</dt><dd>${i.created_at||'—'}</dd>
        <dt>Demerit Points</dt><dd>${i.demerit_points||0}</dd>
        <dt>Parent Notified</dt><dd>${i.parent_notified?'Yes':'No'}</dd>
      </dl>
      <p><strong>Description:</strong> ${esc(i.description)}</p>
      ${i.resolution?`<p><strong>Resolution:</strong> ${esc(i.resolution)}</p>`:''}
      <div class="actions">
        <button class="btn-info" onclick="fetch('/api/discipline/incidents/${i.id}/notify-parent',{method:'POST'}).then(()=>alert('Parent notified'))">Notify Parent</button>
        <button class="btn-warn" onclick="fetch('/api/discipline/incidents/${i.id}/referral',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})}).then(()=>location.reload())">Committee Referral</button>
      </div>
      <h2>Consequences (${consequences.rows.length})</h2>
      <table><tr><th>Type</th><th>Details</th><th>Assigned By</th><th>Completed</th></tr>
      ${consequences.rows.map(c=>`<tr><td>${esc(c.type)}</td><td>${esc(c.details||'—')}</td><td>${esc(c.assigned_by_name||'—')}</td><td>${c.completed?'Yes':'No'}</td></tr>`).join('')}
      ${consequences.rows.length===0?'<tr><td colspan="4">No consequences</td></tr>':''}
      </table>
      ${committee.rows[0]?`<h2>Committee</h2><p>Decision: ${esc(committee.rows[0].decision||'Pending')}</p>`:''}
      <h2>Demerit History</h2>
      <table><tr><th>Points</th><th>Reason</th><th>Balance After</th><th>Date</th></tr>
      ${history.rows.map(h=>`<tr><td>${h.points}</td><td>${esc(h.reason||'—')}</td><td>${h.balance_after}</td><td>${h.created_at?.slice(0,10)||'—'}</td></tr>`).join('')}
      ${history.rows.length===0?'<tr><td colspan="4">No demerit history</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // ============================================================
  // DETENTION SCHEDULING
  // ============================================================

  // POST /api/discipline/detentions/schedule — Schedule detention
  app.post('/api/discipline/detentions/schedule', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (!scheduled_date) return errorRes(res, 400, 'scheduled_date is required');

    const dur = duration_minutes ? Math.min(480, Math.max(15, Number(duration_minutes))) : 60;

    const result = await pool.query(
      `INSERT INTO discipline_detentions (tenant_id, incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') RETURNING *`,
      [tid, incident_id || null, student_id, scheduled_date, scheduled_time || null, dur, supervisor_id || null]);

    wsBroadcast(tid, 'discipline:detention_scheduled', { detention_id: result.rows[0].id, student_id, scheduled_date });
    ok(res, result.rows[0], 201);
  }));

  // GET /api/discipline/detentions — List scheduled detentions
  app.get('/api/discipline/detentions', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, status, from, to, page, limit } = req.query;
    const pn = Math.max(1, parseInt(page) || 1), ln = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const offset = (pn - 1) * ln;

    let sql = `SELECT d.*, us.name AS student_name, sup.name AS supervisor_name
               FROM discipline_detentions d
               LEFT JOIN students ds ON ds.id=d.student_id
               LEFT JOIN users us ON us.id=ds.user_id
               LEFT JOIN users sup ON sup.id=d.supervisor_id
               WHERE d.tenant_id=$1`;
    const params = [tid]; let pi = 2;
    if (student_id) { sql += ` AND d.student_id=$${pi}`; params.push(student_id); pi++; }
    if (status) { sql += ` AND d.status=$${pi}`; params.push(status); pi++; }
    if (from) { sql += ` AND d.scheduled_date >= $${pi}`; params.push(from); pi++; }
    if (to) { sql += ` AND d.scheduled_date <= $${pi}`; params.push(to); pi++; }
    sql += ` ORDER BY d.scheduled_date ASC, d.scheduled_time ASC LIMIT $${pi} OFFSET $${pi + 1}`;
    params.push(ln, offset);

    const rows = await pool.query(sql, params);
    ok(res, { detentions: rows.rows, pagination: { page: pn, limit: ln } });
  }));

  // POST /api/discipline/detentions/:id/checkin — Check student in/out
  app.post('/api/discipline/detentions/:id/checkin', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, detentionId = req.params.id;
    const { action } = req.body;
    if (action !== 'checkin' && action !== 'checkout')
      return errorRes(res, 400, 'action must be "checkin" or "checkout"');

    const existing = await pool.query(
      `SELECT * FROM discipline_detentions WHERE id=$1 AND tenant_id=$2`, [detentionId, tid]);
    if (!existing.rows[0]) return errorRes(res, 404, 'Detention not found');

    if (action === 'checkin') {
      if (existing.rows[0].status !== 'scheduled')
        return errorRes(res, 400, 'Can only check in to scheduled detentions');
      const result = await pool.query(
        `UPDATE discipline_detentions SET status='in_progress', checked_in_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [detentionId, tid]);
      wsBroadcast(tid, 'discipline:detention_checkin', { detention_id: detentionId, student_id: existing.rows[0].student_id });
      ok(res, result.rows[0]);
    } else {
      if (existing.rows[0].status !== 'in_progress')
        return errorRes(res, 400, 'Can only check out from in-progress detentions');
      const result = await pool.query(
        `UPDATE discipline_detentions SET status='completed', checked_out_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [detentionId, tid]);
      wsBroadcast(tid, 'discipline:detention_checkout', { detention_id: detentionId, student_id: existing.rows[0].student_id });
      ok(res, result.rows[0]);
    }
  }));

  // ============================================================
  // ANONYMOUS REPORTING
  // ============================================================

  // POST /api/discipline/incidents/anonymous — Submit anonymous report
  app.post('/api/discipline/incidents/anonymous', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { student_id, category, severity, description, location } = req.body;
    if (!student_id) return errorRes(res, 400, 'student_id is required');
    if (!description?.trim()) return errorRes(res, 400, 'Description is required');

    const sev = (severity && VALID_SEVERITIES.includes(severity)) ? severity : 'minor';
    const cat = (category && VALID_OFFENSE_CATEGORIES.includes(category)) ? category : 'other';

    const result = await pool.query(
      `INSERT INTO discipline_incidents (tenant_id, student_id, reporter_id, category, severity, description, location, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open') RETURNING *`,
      [tid, student_id, req.user.id, cat, sev, description.trim(), location || null]);

    wsBroadcast(tid, 'discipline:anonymous_report', { incident_id: result.rows[0].id, student_id, severity: sev });
    ok(res, result.rows[0], 201);
  }));

  // ============================================================
  // BEHAVIOR REPORT CARD
  // ============================================================

  // GET /api/discipline/student/:id/report-card — Behavior summary
  app.get('/api/discipline/student/:id/report-card', tenantMiddleware, requireAuth, ah(async (req, res) => {
    const tid = req.tenant.id, studentId = req.params.id;

    const [incidents, merits, balance, meritsAgg] = await Promise.all([
      pool.query(`SELECT severity, COUNT(*)::int AS count, category
        FROM discipline_incidents WHERE tenant_id=$1 AND student_id=$2
        GROUP BY severity, category ORDER BY severity`, [tid, studentId]),
      pool.query(`SELECT category, SUM(points)::int AS total_points, COUNT(*)::int AS count
        FROM discipline_merits WHERE tenant_id=$1 AND student_id=$2
        GROUP BY category ORDER BY total_points DESC`, [tid, studentId]),
      pool.query(`SELECT COALESCE(SUM(points), 0)::int AS balance
        FROM discipline_demerit_history WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
      pool.query(`SELECT SUM(points)::int AS total_points, COUNT(*)::int AS count,
        COUNT(DISTINCT category)::int AS categories
        FROM discipline_merits WHERE tenant_id=$1 AND student_id=$2`, [tid, studentId]),
    ]);

    const totalIncidents = incidents.rows.reduce((s, r) => s + r.count, 0);
    const totalMerits = meritsAgg.rows[0].total_points || 0;
    const demeritBalance = balance.rows[0].balance;
    const resolvedCount = incidents.rows.reduce((s, r) => s, 0);

    // Behavior score: merit points offset demerit points, scale 0-100
    const netScore = Math.max(0, Math.min(100, 100 - demeritBalance + totalMerits));

    ok(res, {
      student_id: studentId,
      behavior_score: netScore,
      demerit_balance: demeritBalance,
      total_merit_points: totalMerits,
      merit_categories: meritsAgg.rows[0].categories || 0,
      total_incidents: totalIncidents,
      incidents_by_severity: incidents.rows.reduce((acc, r) => { acc[r.severity] = (acc[r.severity] || 0) + r.count; return acc; }, {}),
      incidents_by_category: incidents.rows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + r.count; return acc; }, {}),
      merits_breakdown: merits.rows,
      overall_rating: netScore >= 80 ? 'Excellent' : netScore >= 60 ? 'Good' : netScore >= 40 ? 'Satisfactory' : netScore >= 20 ? 'Needs Improvement' : 'Critical',
    });
  }));

  // ============================================================
  // UPGRADED: HTML Frontend, Detention Scheduling, Anonymous Reporting
  // ============================================================

  const renderDiscPage = (title, content, user) => `<!DOCTYPE html><html><head><title>${esc(title)} — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
    .hero{background:linear-gradient(135deg,#ef4444,#f59e0b);color:#fff;padding:24px;border-radius:16px;margin-bottom:20px}
    .hero h1{font-size:24px}.hero p{opacity:.9;margin-top:4px;font-size:14px}
    .card{background:#fff;padding:20px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px}
    .stat-card{background:#fff;padding:16px;border-radius:12px;border:1px solid #e2e8f0;text-align:center}
    .stat-num{font-size:28px;font-weight:700}.card h3{margin-bottom:12px;font-size:18px}
    .btn{display:inline-block;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px;text-decoration:none;color:#fff}
    .btn-primary{background:#ef4444}.btn-green{background:#10b981}.btn-red{background:#dc2626}.btn-sm{padding:4px 12px;font-size:12px}
    nav{background:#fff;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
    nav a{color:#ef4444;text-decoration:none;font-weight:600}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
    .badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fef2f2;color:#991b1b}.badge-yellow{background:#fef9c3;color:#854d0e}.badge-blue{background:#ede9fe;color:#5b21b6}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}th{font-weight:600;color:#64748b;font-size:13px}
    @media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card,.stat-card,nav{background:#1e293b;border-color:#334155}th{color:#94a3b8}td{border-color:#1e293b}a{color:#f87171}}
    </style></head><body>
    <nav><a href="/">Comfort Zone</a><span style="font-size:14px;color:#64748b">Discipline Module</span></nav>
    ${content}</body></html>`;

  // Detention Scheduling
  app.post('/api/discipline/detentions/schedule', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id } = req.body;
    if (!incident_id || !student_id || !scheduled_date) return errorRes(res, 400, 'incident_id, student_id, scheduled_date required');
    const det = (await pool.query(`INSERT INTO discipline_detentions (tenant_id, incident_id, student_id, scheduled_date, scheduled_time, duration_minutes, supervisor_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, incident_id, student_id, scheduled_date, scheduled_time || '15:00', parseInt(duration_minutes)||60, supervisor_id || null])).rows[0];
    ok(res, det);
  }));

  app.get('/api/discipline/detentions', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { status, from, to } = req.query;
    let q = 'SELECT d.*, i.description as incident_desc FROM discipline_detentions d LEFT JOIN discipline_incidents i ON i.id=d.incident_id WHERE d.tenant_id=$1';
    const params = [tid];
    if (status) { q += ' AND d.status=$2'; params.push(status); }
    if (from) { q += ` AND d.scheduled_date >= $${params.length+1}`; params.push(from); }
    if (to) { q += ` AND d.scheduled_date <= $${params.length+1}`; params.push(to); }
    q += ' ORDER BY d.scheduled_date DESC, d.scheduled_time ASC LIMIT 100';
    ok(res, (await pool.query(q, params)).rows);
  }));

  app.post('/api/discipline/detentions/:id/checkin', requireAuth, ah(async (req, res) => {
    const { action } = req.body; // 'in' or 'out'
    if (action === 'in') {
      await pool.query('UPDATE discipline_detentions SET status=$1, checked_in_at=NOW() WHERE id=$2', ['in_progress', req.params.id]);
    } else if (action === 'out') {
      await pool.query('UPDATE discipline_detentions SET status=$1, checked_out_at=NOW() WHERE id=$2', ['completed', req.params.id]);
    } else {
      return errorRes(res, 400, 'Action must be "in" or "out"');
    }
    ok(res, { message: `Detention ${action === 'in' ? 'started' : 'completed'}` });
  }));

  // Anonymous Incident Reporting
  app.post('/api/discipline/incidents/anonymous', ah(async (req, res) => {
    const { tenant_id, student_id, category, description, location, severity } = req.body;
    if (!description) return errorRes(res, 400, 'Description required');
    const incident = (await pool.query(`INSERT INTO discipline_incidents (tenant_id, student_id, category, description, location, severity, reported_by, is_anonymous)
      VALUES ($1,$2,$3,$4,$5,$6,'anonymous',true) RETURNING *`,
      [tenant_id || null, student_id || null, category || 'other', description, location || '', severity || 'minor'])).rows[0];
    ok(res, { id: incident.id, message: 'Anonymous report submitted successfully' });
  }));

  // HTML: Discipline Dashboard
  app.get('/discipline/dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const [todayInc, openCons, merits] = await Promise.all([
      pool.query("SELECT COUNT(*) as total FROM discipline_incidents WHERE tenant_id=$1 AND created_at >= CURRENT_DATE", [tid]),
      pool.query("SELECT COUNT(*) as total FROM discipline_consequences WHERE tenant_id=$1 AND status='pending'", [tid]),
      pool.query('SELECT COALESCE(SUM(points),0) as total FROM discipline_merits WHERE tenant_id=$1 AND created_at >= CURRENT_DATE', [tid]),
    ]);
    const recent = (await pool.query('SELECT id, student_id, category, severity, created_at FROM discipline_incidents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid])).rows;
    res.send(renderDiscPage('Discipline Dashboard', `
      <div class="hero"><h1>Discipline Management</h1><p>${todayInc.rows[0].total} incidents today &bull; ${openCons.rows[0].total} pending consequences</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${todayInc.rows[0].total}</div><div>Incidents Today</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${openCons.rows[0].total}</div><div>Pending Consequences</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${merits.rows[0].total}</div><div>Merits Awarded Today</div></div>
      </div>
      <div class="card"><h3>Recent Incidents</h3><table><thead><tr><th>ID</th><th>Category</th><th>Severity</th><th>Time</th></tr></thead><tbody>
        ${recent.map(r => `<tr><td>#${r.id}</td><td><span class="badge badge-blue">${esc(r.category)}</span></td>
          <td><span class="badge ${r.severity==='major'?'badge-red':r.severity==='moderate'?'badge-yellow':'badge-green'}">${esc(r.severity)}</span></td>
          <td>${new Date(r.created_at).toLocaleString()}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/discipline/incidents" class="btn btn-primary">All Incidents</a>
        <a href="/api/discipline/reports" class="btn btn-green">Reports</a>
        <a href="/api/discipline/detentions" class="btn btn-sm" style="background:#6366f1">Detentions</a>
      </div>`, req.session?.user || {}));
  }));

  // HTML: Incidents List
  app.get('/discipline/incidents', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { severity, category } = req.query;
    let q = 'SELECT * FROM discipline_incidents WHERE tenant_id=$1';
    const params = [tid];
    if (severity) { q += ' AND severity=$2'; params.push(severity); }
    if (category) { q += ` AND category=$${params.length+1}`; params.push(category); }
    q += ' ORDER BY created_at DESC LIMIT 100';
    const incidents = (await pool.query(q, params)).rows;
    res.send(renderDiscPage('All Incidents', `
      <div class="hero"><h1>Incident Records</h1><p>${incidents.length} incidents found</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <a href="/discipline/incidents" class="btn btn-sm btn-primary">All</a>
        <a href="/discipline/incidents?severity=minor" class="btn btn-sm" style="background:#94a3b8">Minor</a>
        <a href="/discipline/incidents?severity=moderate" class="btn btn-sm" style="background:#94a3b8">Moderate</a>
        <a href="/discipline/incidents?severity=major" class="btn btn-sm" style="background:#94a3b8">Major</a>
      </div>
      <div class="card"><table><thead><tr><th>ID</th><th>Category</th><th>Severity</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${incidents.map(i => `<tr><td>#${i.id}</td><td><span class="badge badge-blue">${esc(i.category)}</span></td>
          <td><span class="badge ${i.severity==='major'?'badge-red':i.severity==='moderate'?'badge-yellow':'badge-green'}">${esc(i.severity)}</span></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.description||'')}</td>
          <td><span class="badge ${i.status==='resolved'?'badge-green':'badge-yellow'}">${esc(i.status)}</span></td>
          <td><a href="/discipline/incidents/${i.id}" class="btn btn-sm btn-primary">View</a></td></tr>`).join('')}
      </tbody></table></div>`, req.session?.user || {}));
  }));

  // HTML: Incident Detail
  app.get('/discipline/incidents/:id', requireAuth, ah(async (req, res) => {
    const incident = (await pool.query('SELECT * FROM discipline_incidents WHERE id=$1', [req.params.id])).rows[0];
    if (!incident) return res.status(404).send('Not found');
    const consequences = (await pool.query('SELECT * FROM discipline_consequences WHERE incident_id=$1', [req.params.id])).rows;
    res.send(renderDiscPage('Incident #'+incident.id, `
      <div class="hero"><h1>Incident #${incident.id}</h1><p>${esc(incident.category)} &bull; <span class="badge ${incident.severity==='major'?'badge-red':incident.severity==='moderate'?'badge-yellow':'badge-green'}">${esc(incident.severity)}</span></p></div>
      <div class="card"><h3>Description</h3><p style="margin-top:8px;color:#475569">${esc(incident.description||'No description')}</p>
        ${incident.location ? `<p style="margin-top:8px;color:#64748b">Location: ${esc(incident.location)}</p>` : ''}
        <p style="margin-top:4px;color:#64748b">Reported: ${new Date(incident.created_at).toLocaleString()}</p>
      </div>
      ${consequences.length > 0 ? `<div class="card"><h3>Consequences (${consequences.length})</h3>
        <table><thead><tr><th>Type</th><th>Status</th><th>Assigned</th></tr></thead><tbody>
        ${consequences.map(c => `<tr><td>${esc(c.consequence_type)}</td>
          <td><span class="badge ${c.status==='completed'?'badge-green':'badge-yellow'}">${esc(c.status)}</span></td>
          <td>${c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="card"><p style="color:#94a3b8">No consequences assigned yet</p></div>'}
    `, req.session?.user || {}));
  }));

};
