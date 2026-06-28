/**
 * Migration 000006 — Shift scheduling module (Gap 5)
 *
 * Adds the schema support needed by src/routes/shifts.js:
 *
 *   1. `shifts` — a single scheduled work period for an employee.
 *      Status flows: scheduled → in_progress → completed (or cancelled / no_show).
 *      CHECK constraint guarantees end_time > start_time at the DB level.
 *
 *   2. `shift_templates` — recurring shift definitions (e.g. "Morning shift
 *      Mon-Fri 8-12"). Recurrence is one of: none | daily | weekdays |
 *      weekends | weekly (with recurrence_day_of_week 0-6, Sun=0).
 *      Apply-template walks a date range and materializes a `shifts` row
 *      for each day that matches the recurrence rule.
 *
 *   3. `time_off_requests` — employee leave requests with an approval flow
 *      (pending → approved / rejected / cancelled). CHECK constraint
 *      guarantees end_date >= start_date.
 *
 * All three tables are tenant-scoped (FK → tenants(id) ON DELETE CASCADE)
 * so deleting a tenant automatically cleans up their scheduling data.
 *
 * Pattern: uses pgm.sql() with `IF NOT EXISTS` clauses, matching the
 * "lift and shift" convention from migrations/000001, 000002, 000003.
 * Each statement is idempotent so re-running the migration (e.g. after a
 * deploy rollback) is safe.
 *
 * Down: drops all three tables in reverse dependency order (no cross-FKs
 * between them, but we still drop the child tables first for clarity).
 */

module.exports = {
  up: (pgm) => {
    // ---------------------------------------------------------------
    // 1. shifts — one scheduled work period for an employee
    // ---------------------------------------------------------------
    pgm.sql(`
      CREATE TABLE IF NOT EXISTS shifts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        employee_name TEXT NOT NULL,
        location TEXT,
        role TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        break_minutes INTEGER DEFAULT 30,
        status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT shifts_time_order CHECK (end_time > start_time)
      );
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_shifts_tenant ON shifts(tenant_id, start_time DESC)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts(tenant_id, employee_id, start_time DESC)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(tenant_id, status)`);

    // ---------------------------------------------------------------
    // 2. shift_templates — recurring shift definitions
    // ---------------------------------------------------------------
    pgm.sql(`
      CREATE TABLE IF NOT EXISTS shift_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        break_minutes INTEGER DEFAULT 30,
        role TEXT,
        location TEXT,
        recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekends', 'weekly')),
        recurrence_day_of_week INTEGER CHECK (recurrence_day_of_week BETWEEN 0 AND 6),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_shift_templates_tenant ON shift_templates(tenant_id, is_active)`);

    // ---------------------------------------------------------------
    // 3. time_off_requests — employee leave requests
    // ---------------------------------------------------------------
    pgm.sql(`
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        employee_name TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        reviewed_by INTEGER,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT time_off_date_order CHECK (end_date >= start_date)
      );
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS idx_time_off_tenant ON time_off_requests(tenant_id, status, start_date)`);
  },
  down: (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS time_off_requests`);
    pgm.sql(`DROP TABLE IF EXISTS shift_templates`);
    pgm.sql(`DROP TABLE IF EXISTS shifts`);
  },
};
