/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Multi-Branch / Multi-Campus Management Module — "Comfort Zone"
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *   1. Branch Management     — Full CRUD with coordinates, facilities, operating hours
 *   2. Branch Transfer        — Entity transfers (student/staff/equipment) with approval
 *   3. Inter-Branch Ops       — Resource sharing with request/approval workflow
 *   4. Branch Performance     — KPI metrics, benchmarking, ranking across branches
 *   5. Centralized Dashboard  — Organization-wide overview with per-branch breakdowns
 *   6. Branch Settings        — JSONB settings (timetable, fees, branding) + holidays
 *   7. Communication         — Broadcast messages to specific or all branches
 *   8. Audit Trail            — Cross-branch operation tracking and entity history
 *
 * Tables — add to VALID_TABLES in server.js if not already present:
 *   'branches'              — already in VALID_TABLES
 *   'branch_transfers'      — already in VALID_TABLES
 *   'branch_inter_requests' — ADD to VALID_TABLES
 *   'branch_kpis'           — ADD to VALID_TABLES
 *   'branch_holidays'       — ADD to VALID_TABLES
 *
 * Registration in server.js:
 *   const mb = require('./multi-branch');
 *   mb(app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis });
 *
 * module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis, ah }) => { ... }
 */

module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis, ah }) => {
  const BASE = '/api/multi-branch';

  // ── Validation Sets ─────────────────────────────────────────────────────────
  const ENTITY_TYPES   = new Set(['student', 'staff', 'equipment']);
  const XFER_STATUSES   = new Set(['requested', 'approved', 'rejected', 'completed', 'cancelled']);
  const REQ_TYPES       = new Set(['staff_share', 'equipment_transfer', 'inventory_share', 'resource_request']);
  const BRANCH_STATUSES = new Set(['active', 'inactive', 'upcoming']);
  const KPI_PERIODS     = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
  const RESOURCE_TYPES  = new Set(['staff', 'equipment', 'inventory', 'funds', 'facility']);
  const REQ_STATUSES    = new Set(['pending', 'approved', 'rejected', 'completed', 'cancelled']);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  // All input is sanitized; parameterized queries only (never string interpolation)
  const s  = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null;        // safe string
  const n  = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 ? x : null; }; // safe int
  const f  = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };       // safe float
  const jp = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } }; // safe JSON parse
  const d  = (v) => { if (!v) return null; const x = new Date(v); return isNaN(x.getTime()) ? null : x; }; // safe date
  const okEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const okCoord = (v) => typeof v === 'number' && v >= -180 && v <= 180;

  const j = (res, st, data) => res.status(st).json({ status: st, timestamp: new Date().toISOString(), ...data });

  const h = (fn) => async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) { console.error(`[MultiBranch] ${err.message}`); j(res, 500, { error: 'Internal server error' }); }
  };

  const audit = async (tid, uid, action, bid, details) => {
    try {
      await pool.query(`INSERT INTO audit_logs (tenant_id, user_email, action, details) VALUES ($1,$2,$3,$4)`,
        [tid, uid || 'system', `multi_branch:${action}`, JSON.stringify({ branch_id: bid, ...details })]);
    } catch {}
  };

  const ws = (tid, event, payload) => {
    try { wsBroadcast(tid, { source: 'multi-branch', event, ...payload }); } catch {}
  };

  const cacheGet = async (k) => { if (!redis) return null; try { const v = await redis.get(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const cacheSet = async (k, v, t = 300) => { if (!redis) return; try { await redis.setex(k, t, JSON.stringify(v)); } catch {} };
  const cacheDel = async (p) => { if (!redis) return; try { const ks = await redis.keys(p); if (ks.length) await redis.del(ks); } catch {} };

  const pg = (req) => {
    const page = Math.max(1, n(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, n(req.query.limit) || 25));
    return { page, limit, offset: (page - 1) * limit };
  };
  const pag = (data, page, limit, total) => ({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });

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

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 1 — BRANCH MANAGEMENT (CRUD)
  // ═════════════════════════════════════════════════════════════════════════════

  // List branches
  app.get(`${BASE}/branches`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { page, limit, offset } = pg(req);
    const sf = req.query.status;
    let w = 'WHERE b.tenant_id = $1', p = [tid];
    if (sf && BRANCH_STATUSES.has(sf)) { w += ' AND b.status = $2'; p.push(sf); }
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT b.*, u.name AS manager_name FROM branches b LEFT JOIN users u ON u.id = b.manager_id AND u.tenant_id = b.tenant_id ${w} ORDER BY b.name ASC LIMIT $${p.length+1} OFFSET $${p.length+2}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM branches b ${w}`, p)
    ]);
    j(res, 200, pag(rows.rows, page, limit, cnt.rows[0].total));
  }));

  // Get single branch
  app.get(`${BASE}/branches/:id`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, bid = n(req.params.id);
    if (!bid) return j(res, 400, { error: 'Invalid branch ID' });
    const r = await pool.query(`SELECT b.*, u.name AS manager_name FROM branches b LEFT JOIN users u ON u.id = b.manager_id AND u.tenant_id = b.tenant_id WHERE b.id = $1 AND b.tenant_id = $2`, [bid, tid]);
    if (!r.rows.length) return j(res, 404, { error: 'Branch not found' });
    j(res, 200, { data: r.rows[0] });
  }));

  // Create branch
  app.post(`${BASE}/branches`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { name, code, address, city, country, phone, email, latitude, longitude, manager_id, capacity, facilities, operating_hours, settings, logo, status, established_date } = req.body;
    const bname = s(name);
    if (!bname) return j(res, 400, { error: 'Branch name is required' });
    const bcode = s(code);
    if (bcode) { const dup = await pool.query('SELECT id FROM branches WHERE tenant_id=$1 AND code=$2', [tid, bcode]); if (dup.rows.length) return j(res, 409, { error: 'Branch code already exists' }); }
    if (email && !okEmail(email)) return j(res, 400, { error: 'Invalid email' });
    if (status && !BRANCH_STATUSES.has(status)) return j(res, 400, { error: `Invalid status: ${[...BRANCH_STATUSES].join(', ')}` });
    if (latitude != null && !okCoord(latitude)) return j(res, 400, { error: 'Latitude out of range' });
    if (longitude != null && !okCoord(longitude)) return j(res, 400, { error: 'Longitude out of range' });
    const result = await pool.query(
      `INSERT INTO branches (tenant_id,name,code,address,city,country,phone,email,latitude,longitude,manager_id,capacity,facilities,operating_hours,settings,logo,status,established_date,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()) RETURNING *`,
      [tid, bname, bcode, s(address), s(city), s(country), s(phone), s(email), f(latitude), f(longitude), n(manager_id), n(capacity)||0, JSON.stringify(jp(facilities)), JSON.stringify(jp(operating_hours)), JSON.stringify(jp(settings)), s(logo), status||'active', d(established_date)]
    );
    await audit(tid, uid, 'branch_created', result.rows[0].id, { name: bname });
    ws(tid, 'branch_created', { branch: result.rows[0] });
    cacheDel(`mb:dashboard:${tid}`);
    j(res, 201, { data: result.rows[0], message: 'Branch created' });
  }));

  // Update branch
  app.put(`${BASE}/branches/:id`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, bid = n(req.params.id);
    if (!bid) return j(res, 400, { error: 'Invalid branch ID' });
    const ex = await pool.query('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [bid, tid]);
    if (!ex.rows.length) return j(res, 404, { error: 'Branch not found' });
    const { name, code, address, city, country, phone, email, latitude, longitude, manager_id, capacity, facilities, operating_hours, settings, logo, status, established_date } = req.body;
    if (email && !okEmail(email)) return j(res, 400, { error: 'Invalid email' });
    if (status && !BRANCH_STATUSES.has(status)) return j(res, 400, { error: 'Invalid status' });
    if (latitude != null && !okCoord(latitude)) return j(res, 400, { error: 'Latitude out of range' });
    if (longitude != null && !okCoord(longitude)) return j(res, 400, { error: 'Longitude out of range' });
    const r = await pool.query(
      `UPDATE branches SET name=COALESCE($3,name), code=COALESCE($4,code), address=$5, city=$6, country=$7, phone=$8, email=$9, latitude=$10, longitude=$11, manager_id=$12, capacity=COALESCE($13,capacity), facilities=COALESCE($14,facilities), operating_hours=COALESCE($15,operating_hours), settings=COALESCE($16,settings), logo=$17, status=COALESCE($18,status), established_date=$19, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [bid, tid, s(name), s(code), s(address), s(city), s(country), s(phone), s(email), f(latitude), f(longitude), n(manager_id), n(capacity), facilities?JSON.stringify(jp(facilities)):null, operating_hours?JSON.stringify(jp(operating_hours)):null, settings?JSON.stringify(jp(settings)):null, s(logo), s(status), d(established_date)]
    );
    await audit(tid, uid, 'branch_updated', bid, req.body);
    ws(tid, 'branch_updated', { branch_id: bid });
    cacheDel(`mb:dashboard:${tid}`);
    j(res, 200, { data: r.rows[0], message: 'Branch updated' });
  }));

  // Search branches by name, code, city, or country
  app.get(`${BASE}/branches/search`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const q = s(req.query.q);
    if (!q) return j(res, 400, { error: 'Search query (q) is required' });
    const { page, limit, offset } = pg(req);
    const pattern = `%${q}%`;
    const [rows, cnt] = await Promise.all([
      pool.query(
        `SELECT b.*, u.name AS manager_name FROM branches b
         LEFT JOIN users u ON u.id = b.manager_id AND u.tenant_id = b.tenant_id
         WHERE b.tenant_id = $1
           AND (b.name ILIKE $2 OR b.code ILIKE $2 OR b.city ILIKE $2 OR b.country ILIKE $2)
         ORDER BY b.name ASC LIMIT $3 OFFSET $4`,
        [tid, pattern, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM branches b
         WHERE b.tenant_id = $1
           AND (b.name ILIKE $2 OR b.code ILIKE $2 OR b.city ILIKE $2 OR b.country ILIKE $2)`,
        [tid, pattern]
      )
    ]);
    j(res, 200, pag(rows.rows, page, limit, cnt.rows[0].total));
  }));

  // Branch statistics (summary counts per branch)
  app.get(`${BASE}/branches/stats`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const rows = await pool.query(
      `SELECT b.id, b.name, b.status, b.city, b.capacity,
        (SELECT COUNT(*)::int FROM branch_transfers t
         WHERE t.tenant_id = b.tenant_id AND (t.from_branch_id = b.id OR t.to_branch_id = b.id)
         AND t.status IN ('requested', 'approved')) AS active_transfers,
        (SELECT COUNT(*)::int FROM branch_transfers t
         WHERE t.tenant_id = b.tenant_id AND t.to_branch_id = b.id
         AND t.status = 'completed') AS incoming_completed,
        (SELECT COUNT(*)::int FROM branch_inter_requests r
         WHERE r.tenant_id = b.tenant_id
         AND (r.from_branch_id = b.id OR r.to_branch_id = b.id)
         AND r.status = 'pending') AS pending_requests,
        (SELECT COUNT(*)::int FROM branch_holidays h
         WHERE h.tenant_id = b.tenant_id AND h.branch_id = b.id) AS holidays
       FROM branches b WHERE b.tenant_id = $1 ORDER BY b.name`,
      [tid]
    );
    const totals = {
      total_branches: rows.rows.length,
      active: rows.rows.filter(r => r.status === 'active').length,
      inactive: rows.rows.filter(r => r.status === 'inactive').length,
      upcoming: rows.rows.filter(r => r.status === 'upcoming').length,
      total_capacity: rows.rows.reduce((s, r) => s + (r.capacity || 0), 0),
      total_active_transfers: rows.rows.reduce((s, r) => s + (r.active_transfers || 0), 0),
      total_pending_requests: rows.rows.reduce((s, r) => s + (r.pending_requests || 0), 0)
    };
    j(res, 200, { data: rows.rows, totals });
  }));

  // Delete branch (soft — sets inactive; blocks if active transfers exist)
  app.delete(`${BASE}/branches/:id`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, bid = n(req.params.id);
    if (!bid) return j(res, 400, { error: 'Invalid branch ID' });
    const ex = await pool.query('SELECT id,name FROM branches WHERE id=$1 AND tenant_id=$2', [bid, tid]);
    if (!ex.rows.length) return j(res, 404, { error: 'Branch not found' });
    const at = await pool.query(`SELECT COUNT(*)::int AS c FROM branch_transfers WHERE tenant_id=$1 AND (from_branch_id=$2 OR to_branch_id=$2) AND status IN ('requested','approved')`, [tid, bid]);
    if (at.rows[0].c > 0) return j(res, 409, { error: 'Cannot deactivate branch with active transfers' });
    await pool.query('UPDATE branches SET status=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [bid, tid, 'inactive']);
    await audit(tid, uid, 'branch_deleted', bid, { name: ex.rows[0].name });
    ws(tid, 'branch_deleted', { branch_id: bid });
    cacheDel(`mb:dashboard:${tid}`);
    j(res, 200, { message: 'Branch deactivated' });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 2 — BRANCH TRANSFERS (Approval Workflow)
  // ═════════════════════════════════════════════════════════════════════════════

  // Create transfer request
  app.post(`${BASE}/transfers`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { entity_type, entity_id, from_branch_id, to_branch_id, effective_date, notes } = req.body;
    if (!ENTITY_TYPES.has(entity_type)) return j(res, 400, { error: `entity_type: ${[...ENTITY_TYPES].join(', ')}` });
    if (!n(entity_id)) return j(res, 400, { error: 'entity_id is required' });
    if (!n(from_branch_id) || !n(to_branch_id)) return j(res, 400, { error: 'from_branch_id and to_branch_id required' });
    if (n(from_branch_id) === n(to_branch_id)) return j(res, 400, { error: 'Same branch transfer not allowed' });
    const [fb, tb] = await Promise.all([
      pool.query('SELECT id,name,status FROM branches WHERE id=$1 AND tenant_id=$2', [n(from_branch_id), tid]),
      pool.query('SELECT id,name,status FROM branches WHERE id=$1 AND tenant_id=$2', [n(to_branch_id), tid])
    ]);
    if (!fb.rows.length) return j(res, 404, { error: 'Source branch not found' });
    if (!tb.rows.length) return j(res, 404, { error: 'Destination branch not found' });
    const result = await pool.query(
      `INSERT INTO branch_transfers (tenant_id,entity_type,entity_id,from_branch_id,to_branch_id,request_date,effective_date,status,notes,created_at) VALUES ($1,$2,$3,$4,$5,NOW(),$6,'requested',$7,NOW()) RETURNING *`,
      [tid, entity_type, n(entity_id), n(from_branch_id), n(to_branch_id), d(effective_date), s(notes)]
    );
    await audit(tid, uid, 'transfer_requested', result.rows[0].id, { entity_type, from: fb.rows[0].name, to: tb.rows[0].name });
    ws(tid, 'transfer_requested', { transfer: result.rows[0] });
    j(res, 201, { data: result.rows[0], message: 'Transfer request created' });
  }));

  // List transfers
  app.get(`${BASE}/transfers`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { page, limit, offset } = pg(req);
    const { status, entity_type, branch_id } = req.query;
    let w = 'WHERE t.tenant_id=$1', p = [tid], i = 2;
    if (status && XFER_STATUSES.has(status)) { w += ` AND t.status=$${i++}`; p.push(status); }
    if (entity_type && ENTITY_TYPES.has(entity_type)) { w += ` AND t.entity_type=$${i++}`; p.push(entity_type); }
    if (n(branch_id)) { w += ` AND (t.from_branch_id=$${i} OR t.to_branch_id=$${i})`; p.push(n(branch_id)); i++; }
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT t.*,fb.name AS from_branch_name,tb.name AS to_branch_name,au.name AS approved_by_name FROM branch_transfers t LEFT JOIN branches fb ON fb.id=t.from_branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id LEFT JOIN users au ON au.id=t.approved_by ${w} ORDER BY t.created_at DESC LIMIT $${i++} OFFSET $${i++}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM branch_transfers t ${w}`, p)
    ]);
    j(res, 200, pag(rows.rows, page, limit, cnt.rows[0].total));
  }));

  // Approve / reject transfer
  app.put(`${BASE}/transfers/:id/approve`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, xid = n(req.params.id);
    const { action, notes } = req.body;
    if (!xid) return j(res, 400, { error: 'Invalid transfer ID' });
    if (action !== 'approve' && action !== 'reject') return j(res, 400, { error: 'action must be "approve" or "reject"' });
    const ex = await pool.query('SELECT * FROM branch_transfers WHERE id=$1 AND tenant_id=$2 AND status=$3', [xid, tid, 'requested']);
    if (!ex.rows.length) return j(res, 404, { error: 'Transfer not found or not in requested status' });
    const ns = action === 'approve' ? 'approved' : 'rejected';
    const r = await pool.query(`UPDATE branch_transfers SET status=$3, approved_by=$4, notes=COALESCE($5,notes) WHERE id=$1 AND tenant_id=$2 RETURNING *`, [xid, tid, ns, uid, s(notes)]);
    await audit(tid, uid, `transfer_${ns}`, xid, { action });
    ws(tid, `transfer_${ns}`, { transfer_id: xid, status: ns });
    j(res, 200, { data: r.rows[0], message: `Transfer ${ns}` });
  }));

  // Complete transfer
  app.put(`${BASE}/transfers/:id/complete`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, xid = n(req.params.id);
    const ex = await pool.query('SELECT * FROM branch_transfers WHERE id=$1 AND tenant_id=$2 AND status=$3', [xid, tid, 'approved']);
    if (!ex.rows.length) return j(res, 404, { error: 'Transfer not found or not approved' });
    const r = await pool.query(`UPDATE branch_transfers SET status='completed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING *`, [xid, tid]);
    await audit(tid, uid, 'transfer_completed', xid, ex.rows[0]);
    ws(tid, 'transfer_completed', { transfer_id: xid });
    j(res, 200, { data: r.rows[0], message: 'Transfer completed' });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 3 — INTER-BRANCH OPERATIONS (Resource Sharing)
  // ═════════════════════════════════════════════════════════════════════════════

  // Create inter-branch resource request
  app.post(`${BASE}/inter-requests`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { from_branch_id, to_branch_id, request_type, resource_type, resource_id, quantity, notes } = req.body;
    if (!n(from_branch_id) || !n(to_branch_id)) return j(res, 400, { error: 'from_branch_id and to_branch_id required' });
    if (!REQ_TYPES.has(request_type)) return j(res, 400, { error: `request_type: ${[...REQ_TYPES].join(', ')}` });
    if (!RESOURCE_TYPES.has(resource_type)) return j(res, 400, { error: `resource_type: ${[...RESOURCE_TYPES].join(', ')}` });
    const [fb, tb] = await Promise.all([
      pool.query('SELECT id,name FROM branches WHERE id=$1 AND tenant_id=$2', [n(from_branch_id), tid]),
      pool.query('SELECT id,name FROM branches WHERE id=$1 AND tenant_id=$2', [n(to_branch_id), tid])
    ]);
    if (!fb.rows.length || !tb.rows.length) return j(res, 404, { error: 'Branch not found' });
    const result = await pool.query(
      `INSERT INTO branch_inter_requests (tenant_id,from_branch_id,to_branch_id,request_type,resource_type,resource_id,quantity,status,requested_by,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,NOW()) RETURNING *`,
      [tid, n(from_branch_id), n(to_branch_id), request_type, resource_type, n(resource_id), n(quantity)||1, uid, s(notes)]
    );
    await audit(tid, uid, 'inter_request_created', result.rows[0].id, { request_type, from: fb.rows[0].name, to: tb.rows[0].name });
    ws(tid, 'inter_request_created', { request: result.rows[0] });
    j(res, 201, { data: result.rows[0], message: 'Inter-branch request created' });
  }));

  // List inter-branch requests
  app.get(`${BASE}/inter-requests`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { page, limit, offset } = pg(req);
    const { status, request_type, branch_id } = req.query;
    let w = 'WHERE r.tenant_id=$1', p = [tid], i = 2;
    if (status && REQ_STATUSES.has(status)) { w += ` AND r.status=$${i++}`; p.push(status); }
    if (request_type && REQ_TYPES.has(request_type)) { w += ` AND r.request_type=$${i++}`; p.push(request_type); }
    if (n(branch_id)) { w += ` AND (r.from_branch_id=$${i} OR r.to_branch_id=$${i})`; p.push(n(branch_id)); i++; }
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT r.*,fb.name AS from_branch_name,tb.name AS to_branch_name,req_by.name AS requested_by_name,app_by.name AS approved_by_name FROM branch_inter_requests r LEFT JOIN branches fb ON fb.id=r.from_branch_id LEFT JOIN branches tb ON tb.id=r.to_branch_id LEFT JOIN users req_by ON req_by.email=r.requested_by LEFT JOIN users app_by ON app_by.id=r.approved_by ${w} ORDER BY r.created_at DESC LIMIT $${i++} OFFSET $${i++}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM branch_inter_requests r ${w}`, p)
    ]);
    j(res, 200, pag(rows.rows, page, limit, cnt.rows[0].total));
  }));

  // Approve / reject inter-branch request
  app.put(`${BASE}/inter-requests/:id/approve`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, rid = n(req.params.id);
    const { action, notes } = req.body;
    if (!rid) return j(res, 400, { error: 'Invalid request ID' });
    if (action !== 'approve' && action !== 'reject') return j(res, 400, { error: 'action must be "approve" or "reject"' });
    const ex = await pool.query('SELECT * FROM branch_inter_requests WHERE id=$1 AND tenant_id=$2 AND status=$3', [rid, tid, 'pending']);
    if (!ex.rows.length) return j(res, 404, { error: 'Request not found or not pending' });
    const ns = action === 'approve' ? 'approved' : 'rejected';
    const r = await pool.query(`UPDATE branch_inter_requests SET status=$3, approved_by=$4, notes=COALESCE($5,notes) WHERE id=$1 AND tenant_id=$2 RETURNING *`, [rid, tid, ns, uid, s(notes)]);
    await audit(tid, uid, `inter_request_${ns}`, rid, { action });
    ws(tid, `inter_request_${ns}`, { request_id: rid, status: ns });
    j(res, 200, { data: r.rows[0], message: `Request ${ns}` });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 4 — BRANCH PERFORMANCE (KPIs, Ranking, Benchmarking)
  // ═════════════════════════════════════════════════════════════════════════════

  // Record KPI metrics (upsert)
  app.post(`${BASE}/kpis`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { branch_id, period, period_date, metrics } = req.body;
    if (!n(branch_id)) return j(res, 400, { error: 'branch_id required' });
    if (!KPI_PERIODS.has(period)) return j(res, 400, { error: `period: ${[...KPI_PERIODS].join(', ')}` });
    if (!period_date) return j(res, 400, { error: 'period_date required' });
    const br = await pool.query('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [n(branch_id), tid]);
    if (!br.rows.length) return j(res, 404, { error: 'Branch not found' });
    const mo = jp(metrics);
    if (!mo || typeof mo !== 'object') return j(res, 400, { error: 'metrics must be a JSON object' });
    const r = await pool.query(
      `INSERT INTO branch_kpis (tenant_id,branch_id,period,period_date,metrics,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT ON CONSTRAINT branch_kpis_pkey DO UPDATE SET metrics=$5 RETURNING *`,
      [tid, n(branch_id), period, d(period_date), JSON.stringify(mo)]
    );
    await audit(tid, uid, 'kpi_recorded', n(branch_id), { period });
    cacheDel(`mb:kpi:${tid}:*`); cacheDel(`mb:dashboard:${tid}`);
    j(res, 201, { data: r.rows[0], message: 'KPI recorded' });
  }));

  // Get KPIs
  app.get(`${BASE}/kpis`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { branch_id, period, from_date, to_date } = req.query;
    const { page, limit, offset } = pg(req);
    const ck = `mb:kpi:${tid}:${branch_id||'all'}:${period||'all'}:${from_date||''}:${to_date||''}:${page}:${limit}`;
    const cached = await cacheGet(ck);
    if (cached) return j(res, 200, cached);
    let w = 'WHERE k.tenant_id=$1', p = [tid], i = 2;
    if (n(branch_id)) { w += ` AND k.branch_id=$${i++}`; p.push(n(branch_id)); }
    if (period && KPI_PERIODS.has(period)) { w += ` AND k.period=$${i++}`; p.push(period); }
    if (from_date) { w += ` AND k.period_date>=$${i++}`; p.push(d(from_date)); }
    if (to_date) { w += ` AND k.period_date<=$${i++}`; p.push(d(to_date)); }
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT k.*,b.name AS branch_name FROM branch_kpis k LEFT JOIN branches b ON b.id=k.branch_id ${w} ORDER BY k.period_date DESC LIMIT $${i++} OFFSET $${i++}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM branch_kpis k ${w}`, p)
    ]);
    const resp = pag(rows.rows, page, limit, cnt.rows[0].total);
    cacheSet(ck, resp, 120);
    j(res, 200, resp);
  }));

  // Branch ranking / benchmarking
  app.get(`${BASE}/kpis/ranking`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { period, metric_key } = req.query;
    const ck = `mb:ranking:${tid}:${period||'monthly'}:${metric_key||'all'}`;
    const cached = await cacheGet(ck);
    if (cached) return j(res, 200, cached);
    let w = 'WHERE k.tenant_id=$1', p = [tid], i = 2;
    if (period && KPI_PERIODS.has(period)) { w += ` AND k.period=$${i++}`; p.push(period); }
    const rows = await pool.query(
      `SELECT DISTINCT ON (k.branch_id) k.branch_id,k.period,k.period_date,k.metrics,b.name AS branch_name,b.city,b.status AS branch_status FROM branch_kpis k JOIN branches b ON b.id=k.branch_id ${w} ORDER BY k.branch_id,k.period_date DESC`, p
    );
    let ranked;
    if (metric_key) {
      ranked = rows.rows.filter(r => r.metrics && typeof r.metrics[metric_key] === 'number')
        .sort((a, b) => b.metrics[metric_key] - a.metrics[metric_key])
        .map((r, idx) => ({ ...r, rank: idx + 1, metric_value: r.metrics[metric_key] }));
    } else {
      ranked = rows.rows.map((r, idx) => ({ ...r, rank: idx + 1 }));
    }
    const resp = { data: ranked, total: ranked.length };
    cacheSet(ck, resp, 180);
    j(res, 200, resp);
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 5 — CENTRALIZED DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════════

  app.get(`${BASE}/dashboard`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const ck = `mb:dashboard:${tid}`;
    const cached = await cacheGet(ck);
    if (cached) return j(res, 200, cached);
    const [bc, ab, pt, pir, bl, rt, rir, ts, irs] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM branches WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*)::int AS total FROM branches WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS total FROM branch_transfers WHERE tenant_id=$1 AND status='requested'", [tid]),
      pool.query("SELECT COUNT(*)::int AS total FROM branch_inter_requests WHERE tenant_id=$1 AND status='pending'", [tid]),
      pool.query(`SELECT b.id,b.name,b.code,b.city,b.country,b.status,b.capacity,(SELECT COUNT(*)::int FROM branch_transfers t WHERE t.tenant_id=b.tenant_id AND (t.from_branch_id=b.id OR t.to_branch_id=b.id)) AS transfer_count FROM branches b WHERE b.tenant_id=$1 ORDER BY b.name`, [tid]),
      pool.query(`SELECT t.*,fb.name AS from_branch_name,tb.name AS to_branch_name FROM branch_transfers t LEFT JOIN branches fb ON fb.id=t.from_branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 10`, [tid]),
      pool.query(`SELECT r.*,fb.name AS from_branch_name,tb.name AS to_branch_name FROM branch_inter_requests r LEFT JOIN branches fb ON fb.id=r.from_branch_id LEFT JOIN branches tb ON tb.id=r.to_branch_id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [tid]),
      pool.query(`SELECT status,COUNT(*)::int AS count FROM branch_transfers WHERE tenant_id=$1 GROUP BY status`, [tid]),
      pool.query(`SELECT status,COUNT(*)::int AS count FROM branch_inter_requests WHERE tenant_id=$1 GROUP BY status`, [tid])
    ]);
    const resp = { data: {
      summary: { total_branches: bc.rows[0].total, active_branches: ab.rows[0].total, pending_transfers: pt.rows[0].total, pending_inter_requests: pir.rows[0].total },
      branches: bl.rows, recent_transfers: rt.rows, recent_inter_requests: rir.rows,
      transfer_stats: ts.rows, inter_request_stats: irs.rows
    }};
    cacheSet(ck, resp, 60);
    j(res, 200, resp);
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 6 — BRANCH SETTINGS & HOLIDAYS
  // ═════════════════════════════════════════════════════════════════════════════

  // Update branch settings (JSONB deep merge)
  app.put(`${BASE}/branches/:id/settings`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, bid = n(req.params.id);
    if (!bid) return j(res, 400, { error: 'Invalid branch ID' });
    const br = await pool.query('SELECT id,settings FROM branches WHERE id=$1 AND tenant_id=$2', [bid, tid]);
    if (!br.rows.length) return j(res, 404, { error: 'Branch not found' });
    const ns = jp(req.body.settings);
    if (!ns || typeof ns !== 'object') return j(res, 400, { error: 'settings must be a JSON object' });
    const merged = { ...(br.rows[0].settings || {}), ...ns };
    const r = await pool.query('UPDATE branches SET settings=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id,name,settings', [bid, tid, JSON.stringify(merged)]);
    await audit(tid, uid, 'branch_settings_updated', bid, { settings: ns });
    ws(tid, 'branch_settings_updated', { branch_id: bid });
    j(res, 200, { data: r.rows[0], message: 'Settings updated' });
  }));

  // Add holiday (single branch or all branches)
  app.post(`${BASE}/holidays`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { branch_id, name, date: hdate, is_recurring } = req.body;
    if (!s(name)) return j(res, 400, { error: 'Holiday name required' });
    if (!hdate) return j(res, 400, { error: 'date required' });
    if (branch_id === 'all') {
      const brs = await pool.query('SELECT id FROM branches WHERE tenant_id=$1 AND status=$2', [tid, 'active']);
      const results = [];
      for (const b of brs.rows) {
        const r = await pool.query(`INSERT INTO branch_holidays (tenant_id,branch_id,name,date,is_recurring,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`, [tid, b.id, s(name), d(hdate), is_recurring === true]);
        results.push(r.rows[0]);
      }
      await audit(tid, uid, 'holiday_added_all', null, { name: s(name), count: results.length });
      ws(tid, 'holiday_added', { name: s(name), all_branches: true });
      j(res, 201, { data: results, message: `Holiday added to ${results.length} branches` });
    } else {
      if (!n(branch_id)) return j(res, 400, { error: 'branch_id required' });
      const br = await pool.query('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [n(branch_id), tid]);
      if (!br.rows.length) return j(res, 404, { error: 'Branch not found' });
      const r = await pool.query(`INSERT INTO branch_holidays (tenant_id,branch_id,name,date,is_recurring,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`, [tid, n(branch_id), s(name), d(hdate), is_recurring === true]);
      await audit(tid, uid, 'holiday_added', n(branch_id), { name: s(name) });
      ws(tid, 'holiday_added', { branch_id: n(branch_id) });
      j(res, 201, { data: r.rows[0], message: 'Holiday added' });
    }
  }));

  // List holidays
  app.get(`${BASE}/holidays`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const bid = n(req.query.branch_id), yr = n(req.query.year);
    let w = 'WHERE h.tenant_id=$1', p = [tid], i = 2;
    if (bid) { w += ` AND h.branch_id=$${i++}`; p.push(bid); }
    if (yr) { w += ` AND EXTRACT(YEAR FROM h.date)=$${i++}`; p.push(yr); }
    const rows = await pool.query(`SELECT h.*,b.name AS branch_name FROM branch_holidays h LEFT JOIN branches b ON b.id=h.branch_id ${w} ORDER BY h.date ASC`, p);
    j(res, 200, { data: rows.rows });
  }));

  // Delete holiday
  app.delete(`${BASE}/holidays/:id`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email, hid = n(req.params.id);
    if (!hid) return j(res, 400, { error: 'Invalid holiday ID' });
    const ex = await pool.query('SELECT id FROM branch_holidays WHERE id=$1 AND tenant_id=$2', [hid, tid]);
    if (!ex.rows.length) return j(res, 404, { error: 'Holiday not found' });
    await pool.query('DELETE FROM branch_holidays WHERE id=$1 AND tenant_id=$2', [hid, tid]);
    await audit(tid, uid, 'holiday_deleted', null, { holiday_id: hid });
    j(res, 200, { message: 'Holiday deleted' });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 7 — COMMUNICATION (Broadcast)
  // ═════════════════════════════════════════════════════════════════════════════

  app.post(`${BASE}/broadcast`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { title, message, branch_ids, priority, channels } = req.body;
    if (!s(title)) return j(res, 400, { error: 'title required' });
    if (!s(message)) return j(res, 400, { error: 'message required' });
    const targetIds = Array.isArray(branch_ids) && branch_ids.length > 0 ? branch_ids.map(n).filter(Boolean) : null;
    if (targetIds) {
      const valid = await pool.query('SELECT id FROM branches WHERE tenant_id=$1 AND id=ANY($2)', [tid, targetIds]);
      const validIds = valid.rows.map(r => r.id);
      const invalid = targetIds.filter(id => !validIds.includes(id));
      if (invalid.length) return j(res, 400, { error: `Invalid branch IDs: ${invalid.join(', ')}` });
    }
    const ids = targetIds || (await pool.query('SELECT id FROM branches WHERE tenant_id=$1 AND status=$2', [tid, 'active'])).rows.map(r => r.id);
    const inserted = [];
    for (const bid of ids) {
      const r = await pool.query(`INSERT INTO notifications (tenant_id,title,message,type,created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,
        [tid, `${s(title)} [Branch #${bid}]`, s(message), `branch_broadcast_${priority||'normal'}`]);
      inserted.push(r.rows[0]);
    }
    ws(tid, 'branch_broadcast', { title: s(title), message: s(message), branch_ids: ids, priority: priority || 'normal', channels: channels || ['in_app'] });
    await audit(tid, uid, 'broadcast_sent', null, { title: s(title), branch_count: ids.length });
    j(res, 201, { data: { notifications_created: inserted.length, branch_ids: ids }, message: `Broadcast sent to ${ids.length} branch(es)` });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 8 — AUDIT TRAIL
  // ═════════════════════════════════════════════════════════════════════════════

  // Cross-branch audit log
  app.get(`${BASE}/audit`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { page, limit, offset } = pg(req);
    const { action, branch_id, from_date, to_date } = req.query;
    let w = "WHERE a.tenant_id=$1 AND a.details::text LIKE '%multi_branch%'", p = [tid], i = 2;
    if (s(action)) { w += ` AND a.action ILIKE $${i++}`; p.push(`%${s(action)}%`); }
    if (n(branch_id)) { w += ` AND a.details::text ILIKE $${i++}`; p.push(`%${n(branch_id)}%`); }
    if (from_date) { w += ` AND a.created_at>=$${i++}`; p.push(d(from_date)); }
    if (to_date) { w += ` AND a.created_at<=$${i++}`; p.push(d(to_date)); }
    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT a.id,a.user_email,a.action,a.details,a.created_at FROM audit_logs a ${w} ORDER BY a.created_at DESC LIMIT $${i++} OFFSET $${i++}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM audit_logs a ${w}`, p)
    ]);
    const data = rows.rows.map(r => {
      let pd = {}; try { pd = typeof r.details === 'string' ? JSON.parse(r.details) : (r.details||{}); } catch {}
      return { id: r.id, user: r.user_email, action: r.action, branch_id: pd.branch_id||null, details: pd, timestamp: r.created_at };
    });
    j(res, 200, pag(data, page, limit, cnt.rows[0].total));
  }));

  // Entity transfer history
  app.get(`${BASE}/audit/entity-history`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !ENTITY_TYPES.has(entity_type)) return j(res, 400, { error: `entity_type: ${[...ENTITY_TYPES].join(', ')}` });
    if (!n(entity_id)) return j(res, 400, { error: 'entity_id required' });
    const rows = await pool.query(
      `SELECT t.*,fb.name AS from_branch_name,tb.name AS to_branch_name,au.name AS approved_by_name FROM branch_transfers t LEFT JOIN branches fb ON fb.id=t.from_branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id LEFT JOIN users au ON au.id=t.approved_by WHERE t.tenant_id=$1 AND t.entity_type=$2 AND t.entity_id=$3 ORDER BY t.created_at DESC`,
      [tid, entity_type, n(entity_id)]
    );
    const summary = {
      total_transfers: rows.rows.length,
      completed: rows.rows.filter(r => r.status === 'completed').length,
      pending: rows.rows.filter(r => r.status === 'requested' || r.status === 'approved').length,
      rejected: rows.rows.filter(r => r.status === 'rejected').length,
      branches_visited: [...new Set([...rows.rows.map(r => r.from_branch_id), ...rows.rows.filter(r => r.status==='completed').map(r => r.to_branch_id)])].length
    };
    j(res, 200, { data: { transfers: rows.rows, summary } });
  }));

  // ═════════════════════════════════════════════════════════════════════════════
  // AUTO-MIGRATION
  // ═════════════════════════════════════════════════════════════════════════════
  (async () => {
    // Retry logic for DB connection
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS branch_inter_requests (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          from_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          to_branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          request_type VARCHAR(50) NOT NULL DEFAULT 'resource_request',
          resource_type VARCHAR(50) NOT NULL DEFAULT 'equipment',
          resource_id INTEGER, quantity INTEGER DEFAULT 1,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          requested_by VARCHAR(255), approved_by INTEGER REFERENCES users(id),
          notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS branch_kpis (
          id SERIAL, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          period VARCHAR(20) NOT NULL DEFAULT 'monthly', period_date DATE NOT NULL,
          metrics JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (tenant_id, branch_id, period, period_date)
        );
        CREATE TABLE IF NOT EXISTS branch_holidays (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL, date DATE NOT NULL,
          is_recurring BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_bir_tenant ON branch_inter_requests(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_bir_status ON branch_inter_requests(status)',
        'CREATE INDEX IF NOT EXISTS idx_bir_branches ON branch_inter_requests(from_branch_id,to_branch_id)',
        'CREATE INDEX IF NOT EXISTS idx_bk_tenant ON branch_kpis(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_bk_branch ON branch_kpis(branch_id)',
        'CREATE INDEX IF NOT EXISTS idx_bk_period ON branch_kpis(period,period_date)',
        'CREATE INDEX IF NOT EXISTS idx_bh_tenant ON branch_holidays(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_bh_branch ON branch_holidays(branch_id)',
        'CREATE INDEX IF NOT EXISTS idx_bh_date ON branch_holidays(date)',
      ]) { try { await pool.query(sql); } catch {} }
      console.log('[MultiBranch] Tables and indexes ready');
      success = true;
      break;
      } catch (err) {
        if (attempt < 3) {
          console.warn(`[MultiBranch] Migration attempt ${attempt}/3 failed: ${err.message}, retrying in 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        console.error('[MultiBranch] Migration error:', err.message);
      }
    }
  })();

  // ============================================================
  // NEW DATABASE MIGRATIONS — Cross-Branch Enrollment
  // ============================================================
  (async () => {
    const mc = await pool.connect().catch(() => null);
    if (!mc) return;
    try {
      await mc.query(`CREATE TABLE IF NOT EXISTS cross_branch_enrollments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, from_branch_id INTEGER, to_branch_id INTEGER,
        status TEXT DEFAULT 'pending', transfer_date DATE,
        reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_cbe_tenant ON cross_branch_enrollments(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_cbe_student ON cross_branch_enrollments(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_cbe_status ON cross_branch_enrollments(status)',
        'CREATE INDEX IF NOT EXISTS idx_cbe_from ON cross_branch_enrollments(from_branch_id)',
        'CREATE INDEX IF NOT EXISTS idx_cbe_to ON cross_branch_enrollments(to_branch_id)',
      ]) { try { await mc.query(sql); } catch (_) {} }
      console.log('[MultiBranch] Cross-branch enrollment migration applied');
    } catch (e) { console.error('[MultiBranch] Enrollment migration error:', e.message); }
    finally { mc.release(); }
  })();

  // ============================================================
  // HTML DASHBOARD — SSR Page
  // ============================================================
  const esc = (str) => typeof str === 'string' ? str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : (str || '');

  // GET /multi-branch/dashboard — Organization overview with branch stats
  app.get('/multi-branch/dashboard', tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const [branches, transfers, interReqs] = await Promise.all([
      pool.query(`SELECT b.id, b.name, b.code, b.city, b.status, b.capacity,
        (SELECT COUNT(*)::int FROM branch_transfers t WHERE t.tenant_id=b.tenant_id AND (t.from_branch_id=b.id OR t.to_branch_id=b.id) AND t.status IN ('requested','approved')) AS active_transfers
        FROM branches b WHERE b.tenant_id=$1 ORDER BY b.name`, [tid]),
      pool.query(`SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name
        FROM branch_transfers t LEFT JOIN branches fb ON fb.id=t.from_branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id
        WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 10`, [tid]),
      pool.query(`SELECT r.*, fb.name AS from_branch_name, tb.name AS to_branch_name
        FROM branch_inter_requests r LEFT JOIN branches fb ON fb.id=r.from_branch_id LEFT JOIN branches tb ON tb.id=r.to_branch_id
        WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 5`, [tid]),
    ]);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Multi-Branch Dashboard</title>
      <style>body{font-family:system-ui;max-width:1200px;margin:2em auto;padding:0 1em}
      table{width:100%;border-collapse:collapse;margin:1em 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}
      h1{color:#333}h2{color:#555;border-bottom:2px solid #eee;padding-bottom:.3em}
      .stats{display:flex;gap:1em;margin:1em 0;flex-wrap:wrap}.stat{background:#f9f9f9;padding:1em;border-radius:8px;flex:1;min-width:140px;text-align:center}
      .stat .num{font-size:2em;font-weight:bold}.stat .lbl{font-size:.85em;color:#888}
      .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75em;color:#fff}
      .active{background:#10b981}.inactive{background:#9ca3af}.upcoming{background:#3b82f6}
      .requested{background:#f59e0b}.approved{background:#10b981}.pending{background:#9ca3af}</style></head><body>
      <h1>Multi-Branch Dashboard</h1>
      <div class="stats">
        <div class="stat"><div class="num">${branches.rows.length}</div><div class="lbl">Total Branches</div></div>
        <div class="stat"><div class="num">${branches.rows.filter(b=>b.status==='active').length}</div><div class="lbl">Active</div></div>
        <div class="stat"><div class="num">${branches.rows.reduce((s,b)=>s+(b.active_transfers||0),0)}</div><div class="lbl">Active Transfers</div></div>
        <div class="stat"><div class="num">${transfers.rows.length>0?transfers.rows[0].created_at.slice(0,10):'—'}</div><div class="lbl">Latest Transfer</div></div>
      </div>
      <h2>Branches</h2>
      <table><tr><th>Name</th><th>Code</th><th>City</th><th>Status</th><th>Capacity</th><th>Active Transfers</th></tr>
      ${branches.rows.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.code||'—')}</td><td>${esc(b.city||'—')}</td>
        <td><span class="badge ${b.status}">${b.status}</span></td><td>${b.capacity||0}</td><td>${b.active_transfers||0}</td></tr>`).join('')}
      ${branches.rows.length===0?'<tr><td colspan="6">No branches found</td></tr>':''}
      </table>
      <h2>Recent Transfers</h2>
      <table><tr><th>From</th><th>To</th><th>Type</th><th>Status</th><th>Date</th></tr>
      ${transfers.rows.map(t=>`<tr><td>${esc(t.from_branch_name||'—')}</td><td>${esc(t.to_branch_name||'—')}</td><td>${esc(t.entity_type||'—')}</td>
        <td><span class="badge ${t.status}">${t.status}</span></td><td>${t.created_at?.slice(0,10)||'—'}</td></tr>`).join('')}
      ${transfers.rows.length===0?'<tr><td colspan="5">No transfers</td></tr>':''}
      </table></body></html>`;
    res.type('html').send(html);
  }));

  // ============================================================
  // CROSS-BRANCH ENROLLMENT
  // ============================================================

  // POST /api/multi-branch/enroll — Transfer student across branches
  app.post(`${BASE}/enroll`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, uid = req.user?.email || req.session?.user?.email;
    const { student_id, from_branch_id, to_branch_id, transfer_date, reason } = req.body;
    if (!n(student_id)) return j(res, 400, { error: 'student_id is required' });
    if (!n(from_branch_id) || !n(to_branch_id)) return j(res, 400, { error: 'from_branch_id and to_branch_id required' });
    if (n(from_branch_id) === n(to_branch_id)) return j(res, 400, { error: 'Same branch transfer not allowed' });

    const [fb, tb] = await Promise.all([
      pool.query('SELECT id,name,status FROM branches WHERE id=$1 AND tenant_id=$2', [n(from_branch_id), tid]),
      pool.query('SELECT id,name,status FROM branches WHERE id=$1 AND tenant_id=$2', [n(to_branch_id), tid]),
    ]);
    if (!fb.rows.length) return j(res, 404, { error: 'Source branch not found' });
    if (!tb.rows.length) return j(res, 404, { error: 'Destination branch not found' });

    const result = await pool.query(
      `INSERT INTO cross_branch_enrollments (tenant_id, student_id, from_branch_id, to_branch_id, transfer_date, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, n(student_id), n(from_branch_id), n(to_branch_id), d(transfer_date), s(reason)]);

    await audit(tid, uid, 'cross_branch_enrollment', result.rows[0].id, {
      student_id, from: fb.rows[0].name, to: tb.rows[0].name });
    ws(tid, 'cross_branch_enrollment', { enrollment_id: result.rows[0].id, student_id, from_branch_id: n(from_branch_id), to_branch_id: n(to_branch_id) });
    try { if (global.trackRevenue) global.trackRevenue(tid, 'cross_branch_enrollment', 1); } catch {}
    j(res, 201, { data: result.rows[0], message: 'Cross-branch enrollment created' });
  }));

  // GET /api/multi-branch/enrollments — List transfers
  app.get(`${BASE}/enrollments`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { status, student_id, from_branch_id, to_branch_id } = req.query;
    const { page, limit, offset } = pg(req);
    const ENROLL_STATUSES = new Set(['pending', 'approved', 'rejected', 'completed', 'cancelled']);
    let w = 'WHERE e.tenant_id=$1', p = [tid], i = 2;
    if (status && ENROLL_STATUSES.has(status)) { w += ` AND e.status=$${i++}`; p.push(status); }
    if (n(student_id)) { w += ` AND e.student_id=$${i++}`; p.push(n(student_id)); }
    if (n(from_branch_id)) { w += ` AND e.from_branch_id=$${i++}`; p.push(n(from_branch_id)); }
    if (n(to_branch_id)) { w += ` AND e.to_branch_id=$${i++}`; p.push(n(to_branch_id)); }

    const [rows, cnt] = await Promise.all([
      pool.query(`SELECT e.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
        us.name AS student_name
        FROM cross_branch_enrollments e
        LEFT JOIN branches fb ON fb.id=e.from_branch_id LEFT JOIN branches tb ON tb.id=e.to_branch_id
        LEFT JOIN students ds ON ds.id=e.student_id LEFT JOIN users us ON us.id=ds.user_id
        ${w} ORDER BY e.created_at DESC LIMIT $${i++} OFFSET $${i++}`, [...p, limit, offset]),
      pool.query(`SELECT COUNT(*)::int AS total FROM cross_branch_enrollments e ${w}`, p),
    ]);
    j(res, 200, pag(rows.rows, page, limit, cnt.rows[0].total));
  }));

  // GET /api/multi-branch/enrollments/:id — Transfer detail
  app.get(`${BASE}/enrollments/:id`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id, eid = n(req.params.id);
    if (!eid) return j(res, 400, { error: 'Invalid enrollment ID' });
    const rows = await pool.query(`SELECT e.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
      us.name AS student_name
      FROM cross_branch_enrollments e
      LEFT JOIN branches fb ON fb.id=e.from_branch_id LEFT JOIN branches tb ON tb.id=e.to_branch_id
      LEFT JOIN students ds ON ds.id=e.student_id LEFT JOIN users us ON us.id=ds.user_id
      WHERE e.id=$1 AND e.tenant_id=$2`, [eid, tid]);
    if (!rows.rows.length) return j(res, 404, { error: 'Enrollment not found' });
    j(res, 200, { data: rows.rows[0] });
  }));

  // ============================================================
  // CENTRALIZED REPORTS
  // ============================================================

  // GET /api/multi-branch/reports — Consolidated financial and academic reports
  app.get(`${BASE}/reports`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { branch_id, period_type, from_date, to_date } = req.query;
    const fromD = d(from_date) || new Date(new Date().getFullYear(), 0, 1);
    const toD = d(to_date) || new Date();

    // Financial: revenue and expenses per branch
    let finSql = `SELECT b.id AS branch_id, b.name AS branch_name,
      COALESCE(SUM(CASE WHEN e.type='revenue' THEN e.amount ELSE 0 END), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END), 0) AS total_expense
      FROM branches b
      LEFT JOIN expenses e ON e.branch_id=b.id AND e.tenant_id=$1
      WHERE b.tenant_id=$1`;
    const finParams = [tid];
    let fi = 2;
    if (n(branch_id)) { finSql += ` AND b.id=$${fi++}`; finParams.push(n(branch_id)); }
    if (from_date) { finSql += ` AND e.date >= $${fi++}`; finParams.push(fromD); }
    if (to_date) { finSql += ` AND e.date <= $${fi++}`; finParams.push(toD); }
    finSql += ` GROUP BY b.id, b.name ORDER BY b.name`;

    // Academic: enrollment and performance per branch
    let acadSql = `SELECT b.id AS branch_id, b.name AS branch_name,
      COUNT(DISTINCT s.id)::int AS total_students,
      COUNT(DISTINCT a.id)::int AS total_assignments,
      ROUND(AVG(hs.marks)::numeric, 1) AS avg_score
      FROM branches b
      LEFT JOIN students s ON s.branch_id=b.id AND s.tenant_id=$1
      LEFT JOIN homework_assignments ha ON ha.class_id=s.class_id AND ha.tenant_id=$1 AND ha.is_published=true
      LEFT JOIN homework_submissions hs ON hs.assignment_id=ha.id AND hs.tenant_id=$1 AND hs.status='graded'
      WHERE b.tenant_id=$1 AND b.status='active'
      GROUP BY b.id, b.name ORDER BY b.name`;

    const [financial, academic, branches] = await Promise.all([
      pool.query(finSql, finParams),
      pool.query(acadSql, [tid]),
      pool.query(`SELECT id, name, status FROM branches WHERE tenant_id=$1 ORDER BY name`, [tid]),
    ]);

    // Merge data
    const reports = branches.rows.map(b => {
      const fin = financial.rows.find(f => f.branch_id === b.id) || {};
      const acad = academic.rows.find(a => a.branch_id === b.id) || {};
      return {
        branch_id: b.id, branch_name: b.name,
        revenue: fin.total_revenue || 0, expenses: fin.total_expense || 0,
        net_income: (fin.total_revenue || 0) - (fin.total_expense || 0),
        total_students: acad.total_students || 0,
        total_assignments: acad.total_assignments || 0,
        avg_score: acad.avg_score || 0,
      };
    });

    const totals = reports.reduce((acc, r) => ({
      revenue: acc.revenue + r.revenue, expenses: acc.expenses + r.expenses,
      students: acc.students + r.total_students, assignments: acc.assignments + r.total_assignments,
    }), { revenue: 0, expenses: 0, students: 0, assignments: 0 });

    j(res, 200, {
      data: reports,
      summary: { total_revenue: totals.revenue, total_expenses: totals.expenses,
        total_net_income: totals.revenue - totals.expenses,
        total_students: totals.students, total_assignments: totals.assignments },
    });
  }));

  // GET /api/multi-branch/reports/export — Export as CSV
  app.get(`${BASE}/reports/export`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const fromD = d(req.query.from_date) || new Date(new Date().getFullYear(), 0, 1);
    const toD = d(req.query.to_date) || new Date();

    const [financial, academic] = await Promise.all([
      pool.query(`SELECT b.name AS branch_name, e.type, e.amount, e.date, e.description
        FROM expenses e JOIN branches b ON b.id=e.branch_id AND e.tenant_id=$1
        WHERE e.tenant_id=$1 AND e.date BETWEEN $2 AND $3
        ORDER BY b.name, e.date`, [tid, fromD, toD]),
      pool.query(`SELECT b.name AS branch_name, s.id AS student_id, us.name AS student_name,
        COUNT(DISTINCT ha.id)::int AS assignments_submitted,
        ROUND(AVG(hs.marks)::numeric, 1) AS avg_score
        FROM branches b
        LEFT JOIN students s ON s.branch_id=b.id AND s.tenant_id=$1
        LEFT JOIN users us ON us.id=s.user_id
        LEFT JOIN homework_submissions hs ON hs.student_id=s.id AND hs.tenant_id=$1 AND hs.status='graded'
        LEFT JOIN homework_assignments ha ON ha.id=hs.assignment_id AND ha.tenant_id=$1 AND ha.is_published=true
        WHERE b.tenant_id=$1 AND b.status='active'
        GROUP BY b.id, b.name, s.id, us.name ORDER BY b.name, s.id`),
    ]);

    // Build CSV
    const lines = ['Branch,Type,Amount,Date,Description'];
    for (const row of financial.rows) {
      lines.push(`${row.branch_name},${row.type},${row.amount},${row.date},${(row.description||'').replace(/,/g, ';')}`);
    }
    lines.push('');
    lines.push('Branch,Student ID,Student Name,Assignments Submitted,Avg Score');
    for (const row of academic.rows) {
      lines.push(`${row.branch_name},${row.student_id},${(row.student_name||'').replace(/,/g, ';')},${row.assignments_submitted},${row.avg_score || 0}`);
    }
    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=multi-branch-report-${today()}.csv`);
    res.send(csv);
  }));

  // ============================================================
  // FINANCIAL CONSOLIDATION
  // ============================================================

  // GET /api/multi-branch/finance — Revenue/expenses per branch
  app.get(`${BASE}/finance`, tenantMiddleware, requireAuth, requireSubscription('pro'), h(async (req, res) => {
    const tid = req.tenant.id;
    const { branch_id, from_date, to_date, group_by } = req.query;
    const fromD = d(from_date) || new Date(new Date().getFullYear(), 0, 1);
    const toD = d(to_date) || new Date();
    const gb = (group_by === 'month') ? "TO_CHAR(e.date, 'YYYY-MM')" : (group_by === 'week') ? "TO_CHAR(e.date, 'YYYY-\"WW\"')" : 'e.date';

    let sql = `SELECT COALESCE(${gb}, e.date) AS period,
      b.id AS branch_id, b.name AS branch_name,
      SUM(CASE WHEN e.type='revenue' THEN e.amount ELSE 0 END) AS revenue,
      SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END) AS expenses
      FROM branches b
      LEFT JOIN expenses e ON e.branch_id=b.id AND e.tenant_id=$1 AND e.date BETWEEN $2 AND $3
      WHERE b.tenant_id=$1`;
    const params = [tid, fromD, toD];
    let pi = 4;
    if (n(branch_id)) { sql += ` AND b.id=$${pi++}`; params.push(n(branch_id)); }

    sql += ` GROUP BY COALESCE(${gb}, e.date), b.id, b.name ORDER BY period DESC, b.name`;

    const [data, totals] = await Promise.all([
      pool.query(sql, params),
      pool.query(`SELECT
        COALESCE(SUM(CASE WHEN e.type='revenue' THEN e.amount ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END), 0) AS total_expenses
        FROM expenses e JOIN branches b ON b.id=e.branch_id AND e.tenant_id=$1
        WHERE e.tenant_id=$1 AND e.date BETWEEN $2 AND $3`, [tid, fromD, toD]),
    ]);

    const perBranch = {};
    for (const r of data.rows) {
      if (!perBranch[r.branch_id]) perBranch[r.branch_id] = { branch_id: r.branch_id, branch_name: r.branch_name, periods: [], total_revenue: 0, total_expenses: 0 };
      perBranch[r.branch_id].periods.push({ period: r.period, revenue: Number(r.revenue), expenses: Number(r.expenses) });
      perBranch[r.branch_id].total_revenue += Number(r.revenue);
      perBranch[r.branch_id].total_expenses += Number(r.expenses);
    }

    j(res, 200, {
      data: Object.values(perBranch),
      summary: {
        total_revenue: Number(totals.rows[0].total_revenue) || 0,
        total_expenses: Number(totals.rows[0].total_expenses) || 0,
        net_income: (Number(totals.rows[0].total_revenue) || 0) - (Number(totals.rows[0].total_expenses) || 0),
        date_range: { from: fromD.toISOString().slice(0, 10), to: toD.toISOString().slice(0, 10) },
      },
    });
  }));

  // ============================================================
  // UPGRADED: HTML Dashboard, Cross-Branch Enrollment, Reports
  // ============================================================

  const renderMbPage = (title, content, user) => `<!DOCTYPE html><html><head><title>${esc(title)} — Comfort Zone</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b}
    .hero{background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:24px;border-radius:16px;margin-bottom:20px}
    .hero h1{font-size:24px}.hero p{opacity:.9;margin-top:4px;font-size:14px}
    .card{background:#fff;padding:20px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px}
    .stat-card{background:#fff;padding:16px;border-radius:12px;border:1px solid #e2e8f0;text-align:center}
    .stat-num{font-size:28px;font-weight:700}.card h3{margin-bottom:12px;font-size:18px}
    .btn{display:inline-block;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px;text-decoration:none;color:#fff}
    .btn-primary{background:#6366f1}.btn-green{background:#10b981}.btn-red{background:#ef4444}.btn-sm{padding:4px 12px;font-size:12px}
    nav{background:#fff;padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
    nav a{color:#0ea5e9;text-decoration:none;font-weight:600}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
    .badge-green{background:#dcfce7;color:#166534}.badge-red{background:#fef2f2;color:#991b1b}.badge-blue{background:#ede9fe;color:#5b21b6}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}th{font-weight:600;color:#64748b;font-size:13px}
    @media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card,.stat-card,nav{background:#1e293b;border-color:#334155}th{color:#94a3b8}td{border-color:#1e293b}a{color:#38bdf8}}
    </style></head><body>
    <nav><a href="/">Comfort Zone</a><span style="font-size:14px;color:#64748b">Multi-Branch</span></nav>
    ${content}</body></html>`;

  // Cross-Branch Enrollment
  app.post('/api/multi-branch/enroll', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const { student_id, from_branch_id, to_branch_id, reason } = req.body;
    if (!student_id || !from_branch_id || !to_branch_id) return errorRes(res, 400, 'student_id, from_branch_id, to_branch_id required');
    if (from_branch_id === to_branch_id) return errorRes(res, 400, 'Source and destination branches must differ');
    const transfer = (await pool.query(`INSERT INTO cross_branch_enrollments (tenant_id, student_id, from_branch_id, to_branch_id, status, transfer_date, reason)
      VALUES ($1,$2,$3,$4,'pending',CURRENT_DATE,$5) RETURNING *`,
      [tid, student_id, from_branch_id, to_branch_id, reason || ''])).rows[0];
    ok(res, transfer);
  }));

  app.get('/api/multi-branch/enrollments', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const enrollments = (await pool.query('SELECT ce.*, f.name as from_name, t.name as to_name FROM cross_branch_enrollments ce LEFT JOIN branches f ON f.id=ce.from_branch_id LEFT JOIN branches t ON t.id=ce.to_branch_id WHERE ce.tenant_id=$1 ORDER BY ce.created_at DESC LIMIT 100', [tid])).rows;
    ok(res, enrollments);
  }));

  app.get('/api/multi-branch/enrollments/:id', requireAuth, ah(async (req, res) => {
    const enrollment = (await pool.query('SELECT * FROM cross_branch_enrollments WHERE id=$1', [req.params.id])).rows[0];
    if (!enrollment) return errorRes(res, 404, 'Enrollment transfer not found');
    ok(res, enrollment);
  }));

  // Centralized Reports
  app.get('/api/multi-branch/reports', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const [branches, students, enrollCount, transferCount] = await Promise.all([
      pool.query('SELECT id, name, location, is_active FROM branches WHERE tenant_id=$1', [tid]),
      pool.query('SELECT b.name as branch_name, COUNT(s.id) as student_count FROM branches b LEFT JOIN students s ON s.branch_id=b.id WHERE b.tenant_id=$1 GROUP BY b.id, b.name', [tid]),
      pool.query("SELECT COUNT(*) as total FROM cross_branch_enrollments WHERE tenant_id=$1 AND status='completed'", [tid]),
      pool.query("SELECT COUNT(*) as total FROM cross_branch_enrollments WHERE tenant_id=$1 AND status='pending'", [tid]),
    ]);
    ok(res, {
      branches: branches.rows,
      student_distribution: students.rows,
      completed_transfers: enrollCount.rows[0].total,
      pending_transfers: transferCount.rows[0].total,
    });
  }));

  app.get('/api/multi-branch/reports/export', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const data = (await pool.query('SELECT b.name as branch, COUNT(s.id) as students FROM branches b LEFT JOIN students s ON s.branch_id=b.id WHERE b.tenant_id=$1 GROUP BY b.id, b.name', [tid])).rows;
    let csv = 'Branch,Students\n';
    data.forEach(r => { csv += `"${r.branch}",${r.students}\n`; });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=branch-report.csv');
    res.send(csv);
  }));

  // HTML: Multi-Branch Dashboard
  app.get('/multi-branch/dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.tenant?.id || req.session?.user?.tenant_id;
    const [branches, transfers, pending] = await Promise.all([
      pool.query('SELECT * FROM branches WHERE tenant_id=$1 ORDER BY name', [tid]),
      pool.query("SELECT COUNT(*) as total FROM cross_branch_enrollments WHERE tenant_id=$1 AND status='completed'", [tid]),
      pool.query("SELECT COUNT(*) as total FROM cross_branch_enrollments WHERE tenant_id=$1 AND status='pending'", [tid]),
    ]);
    const recentTransfers = (await pool.query('SELECT * FROM cross_branch_enrollments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10', [tid])).rows;
    res.send(renderMbPage('Multi-Branch Dashboard', `
      <div class="hero"><h1>Organization Overview</h1><p>${branches.rows.length} branches &bull; ${transfers.rows[0].total} completed transfers &bull; ${pending.rows[0].total} pending</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0ea5e9">${branches.rows.length}</div><div>Branches</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${transfers.rows[0].total}</div><div>Completed Transfers</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pending.rows[0].total}</div><div>Pending Transfers</div></div>
      </div>
      <div class="card"><h3>Branches</h3><table><thead><tr><th>Name</th><th>Location</th><th>Status</th></tr></thead><tbody>
        ${branches.rows.map(b => `<tr><td><strong>${esc(b.name)}</strong></td><td>${esc(b.location||'—')}</td>
          <td><span class="badge ${b.is_active?'badge-green':'badge-red'}">${b.is_active?'Active':'Inactive'}</span></td></tr>`).join('')}
      </tbody></table></div>
      ${recentTransfers.length > 0 ? `<div class="card"><h3>Recent Transfer Requests</h3><table><thead><tr><th>Student ID</th><th>From</th><th>To</th><th>Status</th><th>Date</th></tr></thead><tbody>
        ${recentTransfers.map(t => `<tr><td>${t.student_id}</td><td>Branch #${t.from_branch_id}</td><td>Branch #${t.to_branch_id}</td>
          <td><span class="badge ${t.status==='completed'?'badge-green':t.status==='pending'?'badge-blue':'badge-red'}">${esc(t.status)}</span></td>
          <td>${new Date(t.created_at).toLocaleDateString()}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/api/multi-branch/reports" class="btn btn-primary">View Reports</a>
        <a href="/api/multi-branch/finance" class="btn btn-green">Financial Overview</a>
      </div>`, req.session?.user || {}));
  }));

};
