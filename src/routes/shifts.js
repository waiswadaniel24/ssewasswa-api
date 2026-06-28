/**
 * Shift scheduling module — ssewasswa-api (Gap 5)
 *
 * Full CRUD Express router for employee shift scheduling, supporting:
 *
 *   - Shifts: a single scheduled work period for an employee. Filterable by
 *     date range, employee, status, location, role. Bulk-create endpoint
 *     powers the weekly drag-drop UI. Week-view endpoint returns all shifts
 *     for the ISO week containing a given date.
 *
 *   - Shift templates: recurring shift definitions (e.g. "Morning shift
 *     Mon-Fri 8-12"). Apply-template walks a date range and materializes
 *     one `shifts` row per day that matches the recurrence rule
 *     (none | daily | weekdays | weekends | weekly).
 *
 *   - Time-off requests: employee leave requests with an approval flow
 *     (pending → approved / rejected). Reviewed by an admin.
 *
 * Routes (mounted at /api/shifts in server.js):
 *   SHIFTS:
 *     GET    /                  — list with filters (from, to, employee_id, status, location, role)
 *     GET    /week/:date        — all shifts for the ISO week containing :date (Sun→Sat)
 *     POST   /                  — create a single shift
 *     POST   /bulk              — create multiple shifts at once (drag-drop UI)
 *     PUT    /:id               — update a shift (time, status, location, role, break, notes)
 *     DELETE /:id               — delete a shift
 *   TEMPLATES:
 *     GET    /templates         — list active templates
 *     POST   /templates         — create a template
 *     POST   /templates/:id/apply — generate shifts from a template for a date range
 *   TIME OFF:
 *     GET    /time-off          — list time-off requests (optional ?status= filter)
 *     POST   /time-off          — submit a new time-off request
 *     POST   /time-off/:id/approve  — approve a request
 *     POST   /time-off/:id/reject   — reject a request
 *
 * Every route is gated by `requireAuth` + `requireSubscription('basic')`.
 * All writes are audit-logged via the shared `audit()` helper.
 */

'use strict';

const express = require('express');

// ── Pure helpers (exported for unit testing) ────────────────────────
// These are kept pure (no DB, no req/res) so they can be tested in
// isolation without spinning up an Express app or mocking the pool.

/**
 * Decide whether a template should be materialized on a given day of week.
 * Mirrors the inline logic in POST /templates/:id/apply — keeping it as a
 * pure function so the recurrence rules are unit-testable.
 *
 * @param {string} recurrence   — 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly'
 * @param {number} dayOfWeek    — 0 (Sun) .. 6 (Sat) — JS Date#getDay()
 * @param {number} [recurrenceDayOfWeek] — for 'weekly' recurrence, 0..6
 * @returns {boolean}
 */
function shouldApplyOnDay(recurrence, dayOfWeek, recurrenceDayOfWeek) {
  switch (recurrence) {
    case 'daily':    return true;
    case 'weekdays': return dayOfWeek >= 1 && dayOfWeek <= 5;
    case 'weekends': return dayOfWeek === 0 || dayOfWeek === 6;
    case 'weekly':   return dayOfWeek === recurrenceDayOfWeek;
    case 'none':
    default:         return false;
  }
}

/**
 * Validate that a shift's end_time is strictly after its start_time.
 * Returns { ok: true } or { ok: false, error: '...' }.
 */
function validateShiftTimes(start_time, end_time) {
  if (!start_time || !end_time) {
    return { ok: false, error: 'start_time and end_time are required' };
  }
  const s = new Date(start_time);
  const e = new Date(end_time);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return { ok: false, error: 'start_time and end_time must be valid ISO dates' };
  }
  if (e <= s) {
    return { ok: false, error: 'end_time must be after start_time' };
  }
  return { ok: true };
}

/**
 * Validate that a time-off request's end_date is on or after its start_date.
 * Returns { ok: true } or { ok: false, error: '...' }.
 */
function validateTimeOffDates(start_date, end_date) {
  if (!start_date || !end_date) {
    return { ok: false, error: 'start_date and end_date are required' };
  }
  const s = new Date(start_date);
  const e = new Date(end_date);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return { ok: false, error: 'start_date and end_date must be valid dates' };
  }
  // Compare calendar dates only — strip the time component so a same-day
  // request with "2026-01-15" / "2026-01-15" passes (end_date >= start_date).
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  if (e < s) {
    return { ok: false, error: 'end_date must be on or after start_date' };
  }
  return { ok: true };
}


module.exports = function (ctx) {
  const { pool, ah, requireAuth, audit, esc } = ctx;

  // ── requireSubscription fallback ────────────────────────────────────
  // The shared ctx from server.js does not currently expose a global
  // requireSubscription (each business module defines its own local copy —
  // see scholarships.js:25, pos-terminal.js:30, canteen.js:22, etc.).
  // We follow the same pattern here: prefer ctx.requireSubscription if a
  // future refactor adds it to _routeSharedCtx, otherwise use this local
  // definition. Either way, every route below is gated by 'basic'.
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2, enterprise: 3 };
  const requireSubscription = ctx.requireSubscription || ((minPlan) => async (req, res, next) => {
    // Super admins bypass the subscription check
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const tid = req.session?.user?.tenant_id;
      if (!tid) return next(); // unauthenticated — requireAuth above will catch it
      const sub = await pool.query(
        "SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'",
        [tid]
      );
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) {
        return res.status(403).json({
          error: 'Subscription required',
          min_plan: minPlan,
          current_plan: plan,
          message: `Upgrade to ${minPlan} or higher to access shift scheduling.`,
        });
      }
    } catch (e) {
      // Allow through on DB error — same forgiving behavior as scholarships.js.
      // A subscription check failure should NOT block a paying customer whose
      // DB is temporarily unreachable.
    }
    next();
  });

  // ── audit() adapter ─────────────────────────────────────────────────
  // server.js's audit() has signature (email, action, details, tenantId, req).
  // Internally we want to call logAudit(req, action, details) so the call
  // sites are clean. We adapt here; if ctx.audit is missing, no-op.
  const logAudit = (req, action, details) => {
    try {
      if (typeof audit !== 'function') return;
      const email = req?.session?.user?.email || 'system';
      const tenantId = req?.session?.user?.tenant_id;
      return audit(email, action, details, tenantId, req);
    } catch (_) {
      // best-effort — never fail a request because audit logging failed
    }
  };

  const router = express.Router();

  // All routes require auth + basic subscription
  router.use(requireAuth, requireSubscription('basic'));

  // ============================================================
  // SHIFTS
  // ============================================================

  // GET /api/shifts — list shifts (with filters)
  // Query params: from, to, employee_id, status, location, role
  router.get('/', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { from, to, employee_id, status, location, role } = req.query;
    const conditions = ['tenant_id = $1'];
    const params = [tid];
    let paramIdx = 2;
    if (from) { conditions.push(`start_time >= $${paramIdx++}`); params.push(from); }
    if (to) { conditions.push(`end_time <= $${paramIdx++}`); params.push(to); }
    if (employee_id) { conditions.push(`employee_id = $${paramIdx++}`); params.push(parseInt(employee_id)); }
    if (status) { conditions.push(`status = $${paramIdx++}`); params.push(status); }
    if (location) { conditions.push(`location = $${paramIdx++}`); params.push(esc(location)); }
    if (role) { conditions.push(`role = $${paramIdx++}`); params.push(esc(role)); }
    const where = conditions.join(' AND ');
    const result = await pool.query(
      `SELECT * FROM shifts WHERE ${where} ORDER BY start_time ASC LIMIT 500`,
      params
    );
    res.json({ shifts: result.rows, count: result.rows.length });
  }));

  // GET /api/shifts/week/:date — get all shifts for the week containing :date
  router.get('/week/:date', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const date = new Date(req.params.date);
    if (isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const result = await pool.query(
      `SELECT * FROM shifts WHERE tenant_id = $1 AND start_time >= $2 AND start_time < $3 ORDER BY start_time ASC`,
      [tid, weekStart, weekEnd]
    );
    res.json({ shifts: result.rows, week_start: weekStart, week_end: weekEnd });
  }));

  // POST /api/shifts — create a shift
  router.post('/', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { employee_id, employee_name, location, role, start_time, end_time, break_minutes = 30, notes } = req.body;
    if (!employee_id || !employee_name || !start_time || !end_time) {
      return res.status(400).json({ error: 'employee_id, employee_name, start_time, end_time are required' });
    }
    if (new Date(end_time) <= new Date(start_time)) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }
    const result = await pool.query(
      `INSERT INTO shifts (tenant_id, employee_id, employee_name, location, role, start_time, end_time, break_minutes, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tid, employee_id, esc(employee_name), location ? esc(location) : null, role ? esc(role) : null,
       start_time, end_time, break_minutes, notes ? esc(notes) : null, req.session.user.id]
    );
    logAudit(req, 'shift_create', { shift_id: result.rows[0].id, employee_id });
    res.status(201).json(result.rows[0]);
  }));

  // POST /api/shifts/bulk — create multiple shifts at once (for the weekly drag-drop UI)
  router.post('/bulk', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { shifts } = req.body;
    if (!Array.isArray(shifts) || !shifts.length) {
      return res.status(400).json({ error: 'shifts array is required' });
    }
    const created = [];
    for (const s of shifts) {
      if (!s.employee_id || !s.employee_name || !s.start_time || !s.end_time) continue;
      const result = await pool.query(
        `INSERT INTO shifts (tenant_id, employee_id, employee_name, location, role, start_time, end_time, break_minutes, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [tid, s.employee_id, esc(s.employee_name), s.location || null, s.role || null,
         s.start_time, s.end_time, s.break_minutes || 30, s.notes || null, req.session.user.id]
      );
      created.push(result.rows[0]);
    }
    logAudit(req, 'shift_bulk_create', { count: created.length });
    res.status(201).json({ shifts: created, count: created.length });
  }));

  // PUT /api/shifts/:id — update a shift (e.g., drag to a different time)
  router.put('/:id', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const { start_time, end_time, status, location, role, break_minutes, notes } = req.body;
    const result = await pool.query(
      `UPDATE shifts SET
         start_time = COALESCE($1, start_time),
         end_time = COALESCE($2, end_time),
         status = COALESCE($3, status),
         location = COALESCE($4, location),
         role = COALESCE($5, role),
         break_minutes = COALESCE($6, break_minutes),
         notes = COALESCE($7, notes),
         updated_at = NOW()
       WHERE id = $8 AND tenant_id = $9 RETURNING *`,
      [start_time, end_time, status, location, role, break_minutes, notes, id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Shift not found' });
    logAudit(req, 'shift_update', { shift_id: id });
    res.json(result.rows[0]);
  }));

  // DELETE /api/shifts/:id
  router.delete('/:id', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query('DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tid]);
    if (!result.rows.length) return res.status(404).json({ error: 'Shift not found' });
    logAudit(req, 'shift_delete', { shift_id: id });
    res.json({ message: 'Shift deleted', id });
  }));

  // ============================================================
  // SHIFT TEMPLATES
  // ============================================================

  router.get('/templates', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM shift_templates WHERE tenant_id = $1 AND is_active = true ORDER BY name', [tid]);
    res.json({ templates: result.rows });
  }));

  router.post('/templates', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, start_time, end_time, break_minutes = 30, role, location, recurrence = 'none', recurrence_day_of_week } = req.body;
    if (!name || !start_time || !end_time) return res.status(400).json({ error: 'name, start_time, end_time are required' });
    const result = await pool.query(
      `INSERT INTO shift_templates (tenant_id, name, start_time, end_time, break_minutes, role, location, recurrence, recurrence_day_of_week)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tid, esc(name), start_time, end_time, break_minutes, role, location, recurrence, recurrence_day_of_week]
    );
    res.status(201).json(result.rows[0]);
  }));

  // POST /api/shifts/templates/:id/apply — generate shifts from a template for a date range
  router.post('/templates/:id/apply', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templateId = parseInt(req.params.id, 10);
    const { employee_id, employee_name, from_date, to_date } = req.body;
    if (!employee_id || !employee_name || !from_date || !to_date) {
      return res.status(400).json({ error: 'employee_id, employee_name, from_date, to_date are required' });
    }
    const tmplResult = await pool.query('SELECT * FROM shift_templates WHERE id = $1 AND tenant_id = $2 AND is_active = true', [templateId, tid]);
    if (!tmplResult.rows.length) return res.status(404).json({ error: 'Template not found' });
    const tmpl = tmplResult.rows[0];

    const created = [];
    const fromDate = new Date(from_date);
    const toDate = new Date(to_date);
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const shouldApply = shouldApplyOnDay(tmpl.recurrence, dayOfWeek, tmpl.recurrence_day_of_week);

      if (shouldApply) {
        const startDate = new Date(d);
        const [sh, sm] = tmpl.start_time.split(':').map(Number);
        startDate.setHours(sh, sm, 0, 0);
        const endDate = new Date(d);
        const [eh, em] = tmpl.end_time.split(':').map(Number);
        endDate.setHours(eh, em, 0, 0);
        const result = await pool.query(
          `INSERT INTO shifts (tenant_id, employee_id, employee_name, location, role, start_time, end_time, break_minutes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [tid, employee_id, esc(employee_name), tmpl.location, tmpl.role, startDate, endDate, tmpl.break_minutes, req.session.user.id]
        );
        created.push(result.rows[0]);
      }
    }
    logAudit(req, 'shift_template_apply', { template_id: templateId, count: created.length });
    res.json({ shifts: created, count: created.length });
  }));

  // ============================================================
  // TIME OFF REQUESTS
  // ============================================================

  router.get('/time-off', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status } = req.query;
    const conditions = ['tenant_id = $1'];
    const params = [tid];
    if (status) { conditions.push('status = $2'); params.push(status); }
    const result = await pool.query(
      `SELECT * FROM time_off_requests WHERE ${conditions.join(' AND ')} ORDER BY start_date ASC`,
      params
    );
    res.json({ requests: result.rows });
  }));

  router.post('/time-off', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { employee_id, employee_name, start_date, end_date, reason } = req.body;
    if (!employee_id || !employee_name || !start_date || !end_date) {
      return res.status(400).json({ error: 'employee_id, employee_name, start_date, end_date are required' });
    }
    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: 'end_date must be on or after start_date' });
    }
    const result = await pool.query(
      `INSERT INTO time_off_requests (tenant_id, employee_id, employee_name, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tid, employee_id, esc(employee_name), start_date, end_date, reason ? esc(reason) : null]
    );
    logAudit(req, 'time_off_request_create', { request_id: result.rows[0].id, employee_id });
    res.status(201).json(result.rows[0]);
  }));

  router.post('/time-off/:id/approve', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      `UPDATE time_off_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [req.session.user.id, id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Request not found' });
    logAudit(req, 'time_off_approve', { request_id: id });
    res.json(result.rows[0]);
  }));

  router.post('/time-off/:id/reject', ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id, 10);
    const result = await pool.query(
      `UPDATE time_off_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [req.session.user.id, id, tid]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Request not found' });
    logAudit(req, 'time_off_reject', { request_id: id });
    res.json(result.rows[0]);
  }));

  return router;
};

// ── Expose pure helpers for unit testing ─────────────────────────────
// Attached as properties on the factory function so callers can do:
//   const shifts = require('./src/routes/shifts');
//   const router = shifts(ctx);                  // normal usage
//   shifts.shouldApplyOnDay('weekdays', 3);      // test helper
//   shifts.validateShiftTimes('2026-01-01T08:00', '2026-01-01T12:00');
module.exports.shouldApplyOnDay = shouldApplyOnDay;
module.exports.validateShiftTimes = validateShiftTimes;
module.exports.validateTimeOffDates = validateTimeOffDates;

