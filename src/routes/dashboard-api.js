// src/routes/dashboard-api.js
//
// Dashboard auto-refresh API (extracted from server.js as part of the
// Conservative route-extraction refactor — Track 1, Task t1).
//
// Behavior is identical to the original inline handlers in server.js.
// The module exports a factory that accepts a shared context object so the
// route handlers can close over the same `pool`, `requireAuth`, `ah`, etc.
// that the rest of server.js uses — no behavior changes, no re-definitions.
//
// Mount point in server.js:
//   app.use('/api/dashboard', require('./src/routes/dashboard-api')(sharedCtx));

module.exports = function createDashboardApiRouter(ctx) {
  const express = require('express');
  const router = express.Router();
  const { pool, requireAuth, ah } = ctx;

  // GET /api/dashboard/stats — tenant-type-aware dashboard stats
  router.get('/stats', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const tenantType = req.session.user.tenant_type;
    try {
      let stats = {};
      if (tenantType === 'school') {
        const [students, fees, feePaid, exams, attendance] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM students WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COALESCE(SUM(amount),0)::int as total FROM fees WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COALESCE(SUM(paid),0)::int as total FROM fees WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM exams WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COUNT(DISTINCT student_id)::int as cnt FROM attendance WHERE tenant_id=$1 AND date=CURRENT_DATE AND status='present'", [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          student_count: students.rows[0].cnt,
          fee_total: fees.rows[0].total,
          fee_collected: feePaid.rows[0].total,
          exam_count: exams.rows[0].cnt,
          attendance_today: attendance.rows[0].cnt
        };
      } else if (tenantType === 'church') {
        const [members, tithes, sermons, prayers, events] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM members WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COALESCE(SUM(amount),0)::int as total FROM org_finance WHERE tenant_id=$1 AND type='income' AND description ILIKE '%tithe%'", [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM sermons WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM prayer_requests WHERE tenant_id=$1 AND is_private=false', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM events WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          member_count: members.rows[0].cnt,
          tithe_total: tithes.rows[0].total,
          sermon_count: sermons.rows[0].cnt,
          prayer_count: prayers.rows[0].cnt,
          event_count: events.rows[0].cnt
        };
      } else if (tenantType === 'organization') {
        const [members, projects, events, budget, notices] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM members WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM projects WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM events WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COALESCE(SUM(amount),0)::int as total FROM org_finance WHERE tenant_id=$1 AND type='income'", [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM notice_board WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          member_count: members.rows[0].cnt,
          project_count: projects.rows[0].cnt,
          event_count: events.rows[0].cnt,
          income_total: budget.rows[0].total,
          notice_count: notices.rows[0].cnt
        };
      } else if (tenantType === 'health') {
        const [patients, appointments, beds, staff, consults] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM clinic_patients WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COUNT(*)::int as cnt FROM clinic_appointments WHERE tenant_id=$1 AND appointment_date=CURRENT_DATE", [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COUNT(*)::int as total, COALESCE(SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END),0)::int as occupied FROM clinic_beds WHERE tenant_id=$1", [t]).catch(() => ({ rows: [{ total: 0, occupied: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM clinic_staff WHERE tenant_id=$1 AND is_active=true', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COUNT(*)::int as cnt FROM consultations WHERE tenant_id=$1 AND created_at>DATE_TRUNC('day',NOW())", [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          patient_count: patients.rows[0].cnt,
          appointment_today: appointments.rows[0].cnt,
          bed_total: beds.rows[0].total,
          bed_occupied: beds.rows[0].occupied,
          active_staff: staff.rows[0].cnt,
          consult_today: consults.rows[0].cnt
        };
      } else if (tenantType === 'business') {
        const [sales, inventory, invoices, expenses, customers] = await Promise.all([
          pool.query("SELECT COALESCE(SUM(total),0)::int as total FROM sales WHERE tenant_id=$1 AND created_at>DATE_TRUNC('month', NOW())", [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM inventory WHERE tenant_id=$1 AND quantity<5', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COUNT(*)::int as cnt FROM invoices WHERE tenant_id=$1 AND status='unpaid'", [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query("SELECT COALESCE(SUM(amount),0)::int as total FROM expenses WHERE tenant_id=$1 AND COALESCE(expense_date, created_at::date)>DATE_TRUNC('month', NOW())", [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM customers WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          revenue_total: sales.rows[0].total,
          low_stock_count: inventory.rows[0].cnt,
          unpaid_invoices: invoices.rows[0].cnt,
          expense_total: expenses.rows[0].total,
          customer_count: customers.rows[0].cnt,
          net_profit: sales.rows[0].total - expenses.rows[0].total
        };
      } else if (tenantType === 'individual') {
        const [goals, notes, budgetPlanned, budgetActual] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM goals WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM personal_notes WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COALESCE(SUM(planned),0)::int as total FROM budget_items WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query('SELECT COALESCE(SUM(actual),0)::int as total FROM budget_items WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ total: 0 }] }))
        ]);
        stats = {
          goal_count: goals.rows[0].cnt,
          note_count: notes.rows[0].cnt,
          budget_planned: budgetPlanned.rows[0].total,
          budget_actual: budgetActual.rows[0].total
        };
      } else if (tenantType === 'public') {
        const [pages, posts, shopItems] = await Promise.all([
          pool.query('SELECT COUNT(*)::int as cnt FROM public_pages WHERE tenant_id=$1 AND is_published=true', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM public_posts WHERE tenant_id=$1', [t]).catch(() => ({ rows: [{ cnt: 0 }] })),
          pool.query('SELECT COUNT(*)::int as cnt FROM school_shop_items WHERE tenant_id=$1 AND (is_active=true OR is_active IS NULL)', [t]).catch(() => ({ rows: [{ cnt: 0 }] }))
        ]);
        stats = {
          page_count: pages.rows[0].cnt,
          post_count: posts.rows[0].cnt,
          shop_item_count: shopItems.rows[0].cnt
        };
      } else {
        stats = { message: 'No dashboard stats available for this tenant type' };
      }
      res.json({ success: true, tenant_type: tenantType, stats });
    } catch (err) {
      console.error('[Dashboard Stats API]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load dashboard stats' });
    }
  }));

  // GET /api/dashboard/chart-data
  router.get('/chart-data', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const tenantType = req.session.user.tenant_type;
    const chartType = req.query.type || 'revenue';
    const days = parseInt(req.query.days) || 30;
    try {
      let labels = [];
      let datasets = [];
      if (tenantType === 'school') {
        if (chartType === 'revenue') {
          const rows = (await pool.query("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(paid),0)::int as total FROM fees WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Fees Collected', data: rows.map(r => r.total), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.15)', fill: true }];
        } else if (chartType === 'activity') {
          const rows = (await pool.query("SELECT TO_CHAR(date, 'YYYY-MM-DD') as day, COUNT(*)::int as cnt FROM attendance WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Attendance Records', data: rows.map(r => r.cnt), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.15)', fill: true }];
        }
      } else if (tenantType === 'business') {
        if (chartType === 'revenue') {
          const rows = (await pool.query("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(total),0)::int as total FROM sales WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Daily Sales', data: rows.map(r => r.total), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.15)', fill: true }];
        }
      } else if (tenantType === 'church') {
        if (chartType === 'revenue') {
          const rows = (await pool.query("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(amount),0)::int as total FROM org_finance WHERE tenant_id=$1 AND type='income' AND created_at > NOW() - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Income', data: rows.map(r => r.total), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.15)', fill: true }];
        }
      } else if (tenantType === 'health') {
        if (chartType === 'activity') {
          const rows = (await pool.query("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COUNT(*)::int as cnt FROM consultations WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Consultations', data: rows.map(r => r.cnt), borderColor: '#14b8a6', backgroundColor: 'rgba(20,184,166,0.15)', fill: true }];
        }
      } else if (tenantType === 'organization') {
        if (chartType === 'revenue') {
          const rows = (await pool.query("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as day, COALESCE(SUM(amount),0)::int as total FROM org_finance WHERE tenant_id=$1 AND type='income' AND created_at > NOW() - INTERVAL '1 day' * $2 GROUP BY day ORDER BY day", [t, days])).rows;
          labels = rows.map(r => r.day);
          datasets = [{ label: 'Income', data: rows.map(r => r.total), borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.15)', fill: true }];
        }
      }
      if (datasets.length === 0) {
        // Generate empty chart data for unsupported combos
        const now = new Date();
        labels = Array.from({ length: Math.min(days, 7) }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return d.toISOString().split('T')[0]; }).reverse();
        datasets = [{ label: 'No data', data: labels.map(() => 0), borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,0.1)' }];
      }
      res.json({ success: true, type: chartType, labels, datasets });
    } catch (err) {
      console.error('[Dashboard Chart API]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load chart data' });
    }
  }));

  // =============================================
  // DASHBOARD CUSTOMIZATION: Per-user prefs
  // =============================================
  // GET /api/dashboard/prefs — Get user's dashboard preferences
  router.get('/prefs', requireAuth, ah(async (req, res) => {
    const result = await pool.query(
      'SELECT widgets, layout FROM user_dashboard_prefs WHERE user_id=$1 AND portal_type=$2',
      [req.session.user.id, req.session.user.tenant_type || 'school']
    );
    res.json(result.rows[0] || { widgets: [], layout: 'default' });
  }));

  // POST /api/dashboard/prefs — Save user's dashboard preferences
  router.post('/prefs', requireAuth, ah(async (req, res) => {
    const { widgets, layout } = req.body;
    await pool.query(
      `INSERT INTO user_dashboard_prefs (user_id, portal_type, widgets, layout, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, portal_type) DO UPDATE SET widgets=$3, layout=$4, updated_at=NOW()`,
      [req.session.user.id, req.session.user.tenant_type || 'school', JSON.stringify(widgets || []), layout || 'default']
    );
    res.json({ success: true });
  }));

  return router;
};
