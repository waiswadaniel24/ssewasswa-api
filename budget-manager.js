// ============================================================
// BUDGET MANAGER MODULE — Multi-Tenant SaaS Platform
// Departmental budgets, expenses, purchase requests,
// financial planning and reporting.
// Usage: const budgetManager = require('./budget-manager');
//        budgetManager(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function budgetManager(app, db, pool, renderPage, esc) {

  // ── inline fallbacks & helpers ────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/([&<>"'])/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // ── status badge helper ──────────────────────────────────
  function statusBadge(status) {
    const map = {
      active:         { bg: '#dcfce7', color: '#16a34a', label: 'Active' },
      inactive:       { bg: '#f1f5f9', color: '#64748b', label: 'Inactive' },
      pending:        { bg: '#dbeafe', color: '#2563eb', label: 'Pending' },
      approved:       { bg: '#dcfce7', color: '#16a34a', label: 'Approved' },
      paid:           { bg: '#d1fae5', color: '#059669', label: 'Paid' },
      rejected:       { bg: '#fee2e2', color: '#dc2626', label: 'Rejected' },
      cancelled:      { bg: '#f1f5f9', color: '#64748b', label: 'Cancelled' },
      under_review:   { bg: '#fef3c7', color: '#d97706', label: 'Under Review' },
      ordered:        { bg: '#e0e7ff', color: '#4f46e5', label: 'Ordered' },
      received:       { bg: '#d1fae5', color: '#059669', label: 'Received' },
    };
    const s = map[status] || { bg: '#f1f5f9', color: '#64748b', label: status };
    return '<span class="bdg-badge" style="background:' + s.bg + ';color:' + s.color + '">' + s.label + '</span>';
  }

  function priorityBadge(priority) {
    const map = {
      low:    { bg: '#f1f5f9', color: '#64748b', label: 'Low' },
      normal: { bg: '#dbeafe', color: '#2563eb', label: 'Normal' },
      high:   { bg: '#fef3c7', color: '#d97706', label: 'High' },
      urgent: { bg: '#fee2e2', color: '#dc2626', label: 'Urgent' },
    };
    const s = map[priority] || map.normal;
    return '<span class="bdg-badge" style="background:' + s.bg + ';color:' + s.color + '">' + s.label + '</span>';
  }

  function utilBarColor(pctVal) {
    if (pctVal >= 90) return '#dc2626';
    if (pctVal >= 70) return '#d97706';
    return '#16a34a';
  }

  function utilBar(current, total) {
    const p = pct(current, total);
    const color = utilBarColor(p);
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;background:#e2e8f0;border-radius:6px;height:18px;overflow:hidden;min-width:80px">' +
      '<div style="height:100%;width:' + Math.min(p, 100) + '%;background:' + color + ';border-radius:6px;transition:width .3s"></div>' +
      '</div>' +
      '<span style="font-size:12px;font-weight:700;color:' + color + ';min-width:38px;text-align:right">' + p + '%</span>' +
      '</div>';
  }

  // ── form input helper ────────────────────────────────────
  function formField(label, name, type, value, opts) {
    opts = opts || {};
    const req = opts.required ? ' required' : '';
    const ro = opts.readonly ? ' readonly' : '';
    const ph = opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '';
    const step = opts.step ? ' step="' + esc(opts.step) + '"' : '';
    return '<div>' +
      '<label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">' + esc(label) + '</label>' +
      '<input type="' + type + '" name="' + name + '" value="' + esc(String(value || '')) + '"' + req + ro + ph + step +
      ' style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;background:#fff">' +
      '</div>';
  }

  function formSelect(label, name, options, selected, opts) {
    opts = opts || {};
    const req = opts.required ? ' required' : '';
    const blank = opts.blank !== false ? '<option value="">' + (opts.blankLabel || 'Select...') + '</option>' : '';
    const optsHtml = options.map(function(o) {
      const val = typeof o === 'object' ? o.value : o;
      const lbl = typeof o === 'object' ? o.label : o;
      const sel = String(val) === String(selected) ? ' selected' : '';
      return '<option value="' + esc(String(val)) + '"' + sel + '>' + esc(String(lbl)) + '</option>';
    }).join('');
    return '<div>' +
      '<label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">' + esc(label) + '</label>' +
      '<select name="' + name + '"' + req +
      ' style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;background:#fff">' +
      blank + optsHtml + '</select></div>';
  }

  // ── CSS ──────────────────────────────────────────────────
  const BDG_CSS = '<style>' +
  '.bdg-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}' +
  '.bdg-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}' +
  '.bdg-nav a:hover{background:#e2e8f0}.bdg-nav a.active{background:#1e40af;color:#fff}' +
  '.bdg-card{background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}' +
  '.bdg-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}' +
  '.bdg-card-header h3{margin:0;font-size:16px;color:#1e293b}' +
  '.bdg-tbl{width:100%;border-collapse:collapse;font-size:13px}' +
  '.bdg-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}' +
  '.bdg-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}' +
  '.bdg-tbl tr:hover{background:#f8fafc}' +
  '.bdg-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap}' +
  '.bdg-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}' +
  '.bdg-btn:hover{opacity:.9;transform:translateY(-1px)}' +
  '.bdg-btn-primary{background:#1e40af;color:#fff}' +
  '.bdg-btn-success{background:#059669;color:#fff}' +
  '.bdg-btn-danger{background:#fee2e2;color:#dc2626}' +
  '.bdg-btn-warning{background:#fef3c7;color:#d97706}' +
  '.bdg-btn-secondary{background:#f1f5f9;color:#475569}' +
  '.bdg-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}' +
  '.bdg-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}' +
  '.bdg-filter input,.bdg-filter select{padding:8px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:13px;background:#fff}' +
  '.bdg-filter input:focus,.bdg-filter select:focus{outline:none;border-color:#1e40af}' +
  '.bdg-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
  '.bdg-form-grid .full{grid-column:1/-1}' +
  '.bdg-stat{background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:20px;text-align:center}' +
  '.bdg-stat-num{font-size:26px;font-weight:800;color:#1e293b}' +
  '.bdg-stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}' +
  '.bdg-alert{padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:14px}' +
  '.bdg-alert-success{background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0}' +
  '.bdg-alert-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}' +
  '.bdg-alert-info{background:#dbeafe;color:#2563eb;border:1px solid #bfdbfe}' +
  '.bdg-section-title{font-size:15px;font-weight:700;color:#1e293b;margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid #1e40af;display:inline-block}' +
  '.bdg-empty{text-align:center;padding:40px;color:#94a3b8;font-size:14px}' +
  '.bdg-empty a{color:#1e40af;text-decoration:none;font-weight:600}' +
  '.bdg-chart-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px}' +
  '.bdg-chart-label{font-size:11px;color:#64748b;min-width:80px;text-align:right}' +
  '.bdg-chart-track{flex:1;background:#e2e8f0;border-radius:6px;height:22px;overflow:hidden;position:relative}' +
  '.bdg-chart-fill{height:100%;border-radius:6px;transition:width .3s}' +
  '.bdg-chart-val{position:absolute;right:6px;top:2px;font-size:11px;font-weight:700;color:#1e293b}' +
  '.bdg-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000;display:flex;align-items:center;justify-content:center}' +
  '.bdg-modal{background:#fff;border-radius:14px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}' +
  '.bdg-modal h3{margin:0 0 16px;color:#1e293b}' +
  '.bdg-progress-ring{display:inline-flex;align-items:center;gap:10px}' +
  '.bdg-trend-up{color:#16a34a;font-weight:700}' +
  '.bdg-trend-down{color:#dc2626;font-weight:700}' +
  '@media(max-width:768px){' +
  '.bdg-nav{gap:4px}.bdg-nav a{padding:6px 10px;font-size:12px}' +
  '.bdg-form-grid{grid-template-columns:1fr}' +
  '.bdg-filter{flex-direction:column}' +
  '}' +
  '</style>';

  // ── navigation helper ────────────────────────────────────
  function nav(active) {
    var links = [
      ['/budget',                    'Dashboard'],
      ['/budget/departments',        'Departments'],
      ['/budget/expenses',           'Expenses'],
      ['/budget/purchase-requests',  'Purchase Requests'],
      ['/budget/reports',            'Reports']
    ];
    return '<div class="bdg-nav">' + links.map(function(l) {
      return '<a href="' + l[0] + '" class="' + (active === l[0] ? 'active' : '') + '">' + l[1] + '</a>';
    }).join('') + '</div>';
  }

  // ── flash message helper ─────────────────────────────────
  function flashMsg(req) {
    var f = req.session.flash;
    if (!f) return '';
    req.session.flash = null;
    return '<div class="bdg-alert bdg-alert-' + (f.type || 'info') + '">' + esc(f.msg) + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS (async IIFE)
  // ════════════════════════════════════════════════════════════
  (async function() {
    // Using migrateQuery for concurrency-limited migrations
    try {
      // --- Table 1: budget_departments ---
      await migrateQuery(pool, 'BudgetManager', 'CREATE TABLE IF NOT EXISTS budget_departments (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL DEFAULT 0,' +
        'name VARCHAR(150) NOT NULL,' +
        'code VARCHAR(20),' +
        'description TEXT,' +
        'head_of_department VARCHAR(200),' +
        'annual_budget INTEGER DEFAULT 0,' +
        'spent INTEGER DEFAULT 0,' +
        'committed INTEGER DEFAULT 0,' +
        'remaining INTEGER DEFAULT 0,' +
        'status VARCHAR(20) DEFAULT \'active\',' +
        'created_at TIMESTAMPTZ DEFAULT NOW(),' +
        'updated_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');
      var deptCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0',
        'name VARCHAR(150)',
        'code VARCHAR(20)',
        'description TEXT',
        'head_of_department VARCHAR(200)',
        'annual_budget INTEGER DEFAULT 0',
        'spent INTEGER DEFAULT 0',
        'committed INTEGER DEFAULT 0',
        'remaining INTEGER DEFAULT 0',
        'status VARCHAR(20) DEFAULT \'active\'',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
        'updated_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var i = 0; i < deptCols.length; i++) {
        var parts = deptCols[i].split(' ');
        try { await migrateQuery(pool, 'BudgetManager', 'ALTER TABLE budget_departments ADD COLUMN IF NOT EXISTS ' + parts[0] + ' ' + deptCols[i].substring(parts[0].length)); } catch(e) {}
      }

      // --- Table 2: budget_expenses ---
      await migrateQuery(pool, 'BudgetManager', 'CREATE TABLE IF NOT EXISTS budget_expenses (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL DEFAULT 0,' +
        'department_id INTEGER,' +
        'expense_type VARCHAR(30) NOT NULL,' +
        'description TEXT,' +
        'amount INTEGER NOT NULL DEFAULT 0,' +
        'vendor VARCHAR(200),' +
        'invoice_number VARCHAR(100),' +
        'payment_method VARCHAR(30),' +
        'payment_ref VARCHAR(100),' +
        'expense_date DATE NOT NULL,' +
        'status VARCHAR(20) DEFAULT \'pending\',' +
        'approved_by INTEGER,' +
        'approved_at TIMESTAMPTZ,' +
        'paid_at TIMESTAMPTZ,' +
        'receipt_path VARCHAR(500),' +
        'notes TEXT,' +
        'academic_year VARCHAR(20),' +
        'quarter VARCHAR(10),' +
        'created_by INTEGER,' +
        'created_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');
      var expCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0',
        'department_id INTEGER',
        'expense_type VARCHAR(30)',
        'description TEXT',
        'amount INTEGER DEFAULT 0',
        'vendor VARCHAR(200)',
        'invoice_number VARCHAR(100)',
        'payment_method VARCHAR(30)',
        'payment_ref VARCHAR(100)',
        'expense_date DATE',
        'status VARCHAR(20) DEFAULT \'pending\'',
        'approved_by INTEGER',
        'approved_at TIMESTAMPTZ',
        'paid_at TIMESTAMPTZ',
        'receipt_path VARCHAR(500)',
        'notes TEXT',
        'academic_year VARCHAR(20)',
        'quarter VARCHAR(10)',
        'created_by INTEGER',
        'created_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var j = 0; j < expCols.length; j++) {
        var expParts = expCols[j].split(' ');
        try { await migrateQuery(pool, 'BudgetManager', 'ALTER TABLE budget_expenses ADD COLUMN IF NOT EXISTS ' + expParts[0] + ' ' + expCols[j].substring(expParts[0].length)); } catch(e) {}
      }

      // --- Table 3: budget_purchase_requests ---
      await migrateQuery(pool, 'BudgetManager', 'CREATE TABLE IF NOT EXISTS budget_purchase_requests (' +
        'id SERIAL PRIMARY KEY,' +
        'tenant_id INTEGER NOT NULL DEFAULT 0,' +
        'department_id INTEGER,' +
        'title VARCHAR(200) NOT NULL,' +
        'description TEXT,' +
        'item_details JSONB DEFAULT \'[]\',' +
        'total_amount INTEGER DEFAULT 0,' +
        'justification TEXT,' +
        'priority VARCHAR(20) DEFAULT \'normal\',' +
        'requested_by INTEGER,' +
        'status VARCHAR(20) DEFAULT \'pending\',' +
        'approved_by INTEGER,' +
        'approved_at TIMESTAMPTZ,' +
        'approved_amount INTEGER DEFAULT 0,' +
        'rejection_reason TEXT,' +
        'supplier VARCHAR(200),' +
        'expected_delivery DATE,' +
        'received_at TIMESTAMPTZ,' +
        'notes TEXT,' +
        'created_at TIMESTAMPTZ DEFAULT NOW(),' +
        'updated_at TIMESTAMPTZ DEFAULT NOW()' +
      ')');
      var prCols = [
        'tenant_id INTEGER NOT NULL DEFAULT 0',
        'department_id INTEGER',
        'title VARCHAR(200)',
        'description TEXT',
        'item_details JSONB DEFAULT \'[]\'',
        'total_amount INTEGER DEFAULT 0',
        'justification TEXT',
        'priority VARCHAR(20) DEFAULT \'normal\'',
        'requested_by INTEGER',
        'status VARCHAR(20) DEFAULT \'pending\'',
        'approved_by INTEGER',
        'approved_at TIMESTAMPTZ',
        'approved_amount INTEGER DEFAULT 0',
        'rejection_reason TEXT',
        'supplier VARCHAR(200)',
        'expected_delivery DATE',
        'received_at TIMESTAMPTZ',
        'notes TEXT',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
        'updated_at TIMESTAMPTZ DEFAULT NOW()'
      ];
      for (var k = 0; k < prCols.length; k++) {
        var prParts = prCols[k].split(' ');
        try { await migrateQuery(pool, 'BudgetManager', 'ALTER TABLE budget_purchase_requests ADD COLUMN IF NOT EXISTS ' + prParts[0] + ' ' + prCols[k].substring(prParts[0].length)); } catch(e) {}
      }

      // --- Indexes ---
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_dept_tenant ON budget_departments(tenant_id)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_dept_status ON budget_departments(tenant_id, status)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_dept_code ON budget_departments(code) WHERE code IS NOT NULL');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_tenant ON budget_expenses(tenant_id)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_dept ON budget_expenses(department_id)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_status ON budget_expenses(tenant_id, status)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_date ON budget_expenses(expense_date)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_type ON budget_expenses(expense_type)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_exp_quarter ON budget_expenses(quarter)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_pr_tenant ON budget_purchase_requests(tenant_id)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_pr_dept ON budget_purchase_requests(department_id)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_pr_status ON budget_purchase_requests(tenant_id, status)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_pr_priority ON budget_purchase_requests(priority)');
      await migrateQuery(pool, 'BudgetManager', 'CREATE INDEX IF NOT EXISTS idx_bdg_pr_requested ON budget_purchase_requests(requested_by)');

      console.log('[BudgetManager] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /budget — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/budget', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    // Overall budget stats
    var stats = (await pool.query(
      'SELECT' +
      ' (SELECT COALESCE(SUM(annual_budget),0)::bigint FROM budget_departments WHERE tenant_id=$1 AND status=\'active\') as total_budget,' +
      ' (SELECT COALESCE(SUM(spent),0)::bigint FROM budget_departments WHERE tenant_id=$1 AND status=\'active\') as total_spent,' +
      ' (SELECT COALESCE(SUM(committed),0)::bigint FROM budget_departments WHERE tenant_id=$1 AND status=\'active\') as total_committed,' +
      ' (SELECT COUNT(*)::int FROM budget_departments WHERE tenant_id=$1 AND status=\'active\') as dept_count,' +
      ' (SELECT COUNT(*)::int FROM budget_expenses WHERE tenant_id=$1 AND status=\'pending\') as pending_expenses,' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests WHERE tenant_id=$1 AND status=\'pending\') as pending_requests',
      [tid]
    )).rows[0];

    var totalBudget = Number(stats.total_budget || 0);
    var totalSpent = Number(stats.total_spent || 0);
    var totalCommitted = Number(stats.total_committed || 0);
    var totalRemaining = totalBudget - totalSpent - totalCommitted;
    var overallPct = pct(totalSpent + totalCommitted, totalBudget);

    // Department utilization
    var departments = (await pool.query(
      'SELECT * FROM budget_departments WHERE tenant_id=$1 AND status=\'active\' ORDER BY name LIMIT 20',
      [tid]
    )).rows;

    var deptBarsHtml = departments.map(function(d) {
      var annual = Number(d.annual_budget || 0);
      var used = Number(d.spent || 0) + Number(d.committed || 0);
      return '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:13px;font-weight:600;color:#1e293b">' + esc(d.name) + '</span>' +
        '<span style="font-size:12px;color:#64748b">' + fmtMoney(used) + ' / ' + fmtMoney(annual) + '</span>' +
        '</div>' +
        utilBar(used, annual) +
        '</div>';
    }).join('');

    // Recent expenses
    var recentExpenses = (await pool.query(
      'SELECT e.*, d.name as dept_name FROM budget_expenses e' +
      ' LEFT JOIN budget_departments d ON d.id = e.department_id' +
      ' WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT 8',
      [tid]
    )).rows;

    var recentExpHtml = recentExpenses.map(function(e) {
      return '<tr>' +
        '<td><strong>' + esc(e.dept_name || 'Unassigned') + '</strong></td>' +
        '<td>' + esc(e.description || e.expense_type) + '</td>' +
        '<td>' + esc(e.expense_type) + '</td>' +
        '<td style="font-weight:600;color:#1e293b">' + fmtMoney(e.amount) + '</td>' +
        '<td>' + statusBadge(e.status) + '</td>' +
        '<td style="font-size:12px;color:#94a3b8">' + fmtDate(e.expense_date) + '</td>' +
        '</tr>';
    }).join('');

    // Pending purchase requests
    var pendingPR = (await pool.query(
      'SELECT pr.*, d.name as dept_name FROM budget_purchase_requests pr' +
      ' LEFT JOIN budget_departments d ON d.id = pr.department_id' +
      ' WHERE pr.tenant_id=$1 AND pr.status IN (\'pending\',\'under_review\') ORDER BY pr.created_at DESC LIMIT 5',
      [tid]
    )).rows;

    var pendingPRHtml = pendingPR.map(function(pr) {
      return '<tr>' +
        '<td><strong>' + esc(pr.title) + '</strong></td>' +
        '<td>' + esc(pr.dept_name || 'Unassigned') + '</td>' +
        '<td style="font-weight:600">' + fmtMoney(pr.total_amount) + '</td>' +
        '<td>' + priorityBadge(pr.priority) + '</td>' +
        '<td>' + statusBadge(pr.status) + '</td>' +
        '<td>' + fmtDate(pr.created_at) + '</td>' +
        '</tr>';
    }).join('');

    // Monthly spending trend (current year)
    var monthly = (await pool.query(
      'SELECT TO_CHAR(expense_date, \'Mon\') as month, EXTRACT(MONTH FROM expense_date)::int as mnum,' +
      ' COALESCE(SUM(amount),0)::bigint as total' +
      ' FROM budget_expenses WHERE tenant_id=$1 AND EXTRACT(YEAR FROM expense_date)=EXTRACT(YEAR FROM CURRENT_DATE)' +
      ' GROUP BY TO_CHAR(expense_date, \'Mon\'), EXTRACT(MONTH FROM expense_date) ORDER BY mnum',
      [tid]
    )).rows;

    var maxMonthly = Math.max.apply(null, monthly.map(function(m) { return Number(m.total || 0); }).concat([1]));
    var monthlyChartHtml = monthly.map(function(m) {
      var p = pct(Number(m.total || 0), maxMonthly);
      return '<div class="bdg-chart-bar">' +
        '<span class="bdg-chart-label">' + m.month + '</span>' +
        '<div class="bdg-chart-track">' +
        '<div class="bdg-chart-fill" style="width:' + p + '%;background:#3b82f6"></div>' +
        '<span class="bdg-chart-val">' + Number(m.total).toLocaleString() + '</span>' +
        '</div></div>';
    }).join('');

    var html = BDG_CSS +
    '<div style="max-width:1200px;margin:0 auto">' +
      nav('/budget') +
      flashMsg(req) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div>' +
          '<h1 style="font-size:24px;color:#1e293b;margin:0">Budget Management</h1>' +
          '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Departmental budgets, expenses and financial planning</p>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<a href="/budget/expenses/add" class="bdg-btn bdg-btn-primary">+ Add Expense</a>' +
          '<a href="/budget/purchase-requests/new" class="bdg-btn bdg-btn-secondary">+ Purchase Request</a>' +
        '</div>' +
      '</div>' +

      // Stats row
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#1e40af">' + fmtMoney(totalBudget) + '</div><div class="bdg-stat-label">Total Annual Budget</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#dc2626">' + fmtMoney(totalSpent) + '</div><div class="bdg-stat-label">Total Spent</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#d97706">' + fmtMoney(totalCommitted) + '</div><div class="bdg-stat-label">Committed</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#16a34a">' + fmtMoney(totalRemaining) + '</div><div class="bdg-stat-label">Remaining</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#1e40af">' + overallPct + '%</div><div class="bdg-stat-label">Budget Utilised</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#64748b">' + stats.dept_count + '</div><div class="bdg-stat-label">Departments</div></div>' +
      '</div>' +

      // Main grid: departments + monthly trend
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div class="bdg-card">' +
          '<div class="bdg-card-header"><h3>Department Utilisation</h3>' +
          '<a href="/budget/departments" style="font-size:12px;color:#1e40af;text-decoration:none">View All</a></div>' +
          (deptBarsHtml || '<div class="bdg-empty">No departments configured. <a href="/budget/departments">Add a department</a></div>') +
        '</div>' +
        '<div class="bdg-card">' +
          '<div class="bdg-card-header"><h3>Monthly Spending Trend</h3></div>' +
          (monthlyChartHtml || '<div class="bdg-empty">No spending data for this year.</div>') +
        '</div>' +
      '</div>' +

      // Recent expenses + Pending PRs
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="bdg-card">' +
          '<div class="bdg-card-header"><h3>Recent Expenses</h3>' +
          '<a href="/budget/expenses" style="font-size:12px;color:#1e40af;text-decoration:none">View All</a></div>' +
          '<div style="overflow-x:auto"><table class="bdg-tbl"><thead><tr><th>Department</th><th>Description</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>' +
          '<tbody>' + (recentExpHtml || '<tr><td colspan="6" class="bdg-empty">No expenses recorded yet.</td></tr>') + '</tbody></table></div>' +
        '</div>' +
        '<div class="bdg-card">' +
          '<div class="bdg-card-header"><h3>Pending Purchase Requests</h3>' +
          '<a href="/budget/purchase-requests" style="font-size:12px;color:#1e40af;text-decoration:none">View All</a></div>' +
          '<div style="overflow-x:auto"><table class="bdg-tbl"><thead><tr><th>Title</th><th>Dept</th><th>Amount</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead>' +
          '<tbody>' + (pendingPRHtml || '<tr><td colspan="6" class="bdg-empty">No pending requests.</td></tr>') + '</tbody></table></div>' +
        '</div>' +
      '</div>' +

    '</div>';
    res.send(renderPage('Budget Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /budget/departments — Department List
  // ════════════════════════════════════════════════════════════
  app.get('/budget/departments', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    var departments = (await pool.query(
      'SELECT d.*,' +
      ' (SELECT COUNT(*)::int FROM budget_expenses e WHERE e.department_id=d.id AND e.tenant_id=$1) as expense_count,' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests pr WHERE pr.department_id=d.id AND pr.tenant_id=$1 AND pr.status=\'pending\') as pending_pr' +
      ' FROM budget_departments d WHERE d.tenant_id=$1 ORDER BY d.name',
      [tid]
    )).rows;

    // Edit form data
    var editId = req.query.edit || '';
    var editDept = null;
    if (editId) {
      editDept = (await pool.query('SELECT * FROM budget_departments WHERE id=$1 AND tenant_id=$2', [editId, tid])).rows[0];
    }

    var rowsHtml = departments.map(function(d) {
      var annual = Number(d.annual_budget || 0);
      var used = Number(d.spent || 0) + Number(d.committed || 0);
      var remaining = annual - used;
      return '<tr>' +
        '<td><strong>' + esc(d.name) + '</strong>' + (d.code ? '<br><span style="font-size:11px;color:#94a3b8;font-family:monospace">' + esc(d.code) + '</span>' : '') + '</td>' +
        '<td>' + esc(d.head_of_department || '\u2014') + '</td>' +
        '<td style="font-weight:600;color:#1e40af">' + fmtMoney(annual) + '</td>' +
        '<td style="font-weight:600;color:#dc2626">' + fmtMoney(d.spent) + '</td>' +
        '<td style="font-weight:600;color:#d97706">' + fmtMoney(d.committed) + '</td>' +
        '<td style="font-weight:600;color:' + (remaining < 0 ? '#dc2626' : '#16a34a') + '">' + fmtMoney(remaining) + '</td>' +
        '<td style="min-width:140px">' + utilBar(used, annual) + '</td>' +
        '<td>' + statusBadge(d.status) + '</td>' +
        '<td style="white-space:nowrap">' +
          (d.expense_count > 0 ? '<span style="font-size:11px;color:#64748b">' + d.expense_count + ' exp</span><br>' : '') +
          (d.pending_pr > 0 ? '<span style="font-size:11px;color:#d97706">' + d.pending_pr + ' PR</span>' : '') +
        '</td>' +
        '<td><a href="/budget/departments?edit=' + d.id + '" class="bdg-btn bdg-btn-secondary" style="padding:4px 10px;font-size:11px">Edit</a></td>' +
        '</tr>';
    }).join('');

    // Create form HTML
    var createForm = '<div class="bdg-card" style="padding:24px">' +
      '<h3 class="bdg-section-title">Create Department</h3>' +
      '<form method="POST" action="/budget/departments/create" class="bdg-form-grid">' +
      formField('Department Name *', 'name', 'text', '', { required: true, placeholder: 'e.g., Science Department' }) +
      formField('Department Code', 'code', 'text', '', { placeholder: 'e.g., SCI' }) +
      formField('Head of Department', 'head_of_department', 'text', '', { placeholder: 'e.g., Dr. Jane Smith' }) +
      formField('Annual Budget (UGX) *', 'annual_budget', 'number', '0', { required: true, placeholder: '50000000' }) +
      '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>' +
      '<textarea name="description" rows="2" placeholder="Brief description of the department" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
      '<div class="full"><button type="submit" class="bdg-btn bdg-btn-primary" style="justify-content:center">Create Department</button></div>' +
      '</form></div>';

    // Edit form HTML
    var editFormHtml = '';
    if (editDept) {
      editFormHtml = '<div class="bdg-card" style="padding:24px;border:2px solid #1e40af">' +
        '<h3 class="bdg-section-title">Edit: ' + esc(editDept.name) + '</h3>' +
        '<form method="POST" action="/budget/departments/' + editDept.id + '/edit" class="bdg-form-grid">' +
        formField('Department Name *', 'name', 'text', editDept.name, { required: true }) +
        formField('Department Code', 'code', 'text', editDept.code) +
        formField('Head of Department', 'head_of_department', 'text', editDept.head_of_department) +
        formField('Annual Budget (UGX)', 'annual_budget', 'number', editDept.annual_budget) +
        formSelect('Status', 'status', [
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' }
        ], editDept.status) +
        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>' +
        '<textarea name="description" rows="2" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical">' + esc(editDept.description || '') + '</textarea></div>' +
        '<div class="full" style="display:flex;gap:10px">' +
        '<button type="submit" class="bdg-btn bdg-btn-primary">Update Department</button>' +
        '<a href="/budget/departments" class="bdg-btn bdg-btn-secondary">Cancel</a>' +
        '</div></form></div>';
    }

    var html = BDG_CSS +
    '<div style="max-width:1200px;margin:0 auto">' +
      nav('/budget/departments') +
      flashMsg(req) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b;margin:0">Departments</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage departmental budgets and allocation</p></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 2fr;gap:20px">' +
        '<div>' + createForm + (editFormHtml ? '<div style="margin-top:16px">' + editFormHtml + '</div>' : '') + '</div>' +
        '<div class="bdg-card">' +
          '<div class="bdg-card-header"><h3>All Departments (' + departments.length + ')</h3></div>' +
          '<div style="overflow-x:auto"><table class="bdg-tbl">' +
          '<thead><tr><th>Name</th><th>HOD</th><th>Budget</th><th>Spent</th><th>Committed</th><th>Remaining</th><th>Utilisation</th><th>Status</th><th>Stats</th><th>Action</th></tr></thead>' +
          '<tbody>' + (rowsHtml || '<tr><td colspan="10" class="bdg-empty">No departments yet. Create one to get started.</td></tr>') + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Budget Departments', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /budget/departments/create
  // ════════════════════════════════════════════════════════════
  app.post('/budget/departments/create', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var name = (req.body.name || '').trim();
    var code = (req.body.code || '').trim() || null;
    var headOfDepartment = (req.body.head_of_department || '').trim() || null;
    var annualBudget = parseInt(req.body.annual_budget) || 0;
    var description = (req.body.description || '').trim() || null;

    if (!name) {
      req.session.flash = { type: 'error', msg: 'Department name is required.' };
      return res.redirect('/budget/departments');
    }

    await pool.query(
      'INSERT INTO budget_departments (tenant_id, name, code, head_of_department, annual_budget, spent, committed, remaining, description, status)' +
      ' VALUES ($1,$2,$3,$4,$5,0,0,$5,$6,\'active\')',
      [tid, name, code, headOfDepartment, annualBudget, description]
    );

    req.session.flash = { type: 'success', msg: 'Department "' + name + '" created with budget ' + fmtMoney(annualBudget) };
    res.redirect('/budget/departments');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /budget/departments/:id/edit
  // ════════════════════════════════════════════════════════════
  app.post('/budget/departments/:id/edit', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;
    var name = (req.body.name || '').trim();
    var code = (req.body.code || '').trim() || null;
    var headOfDepartment = (req.body.head_of_department || '').trim() || null;
    var annualBudget = parseInt(req.body.annual_budget) || 0;
    var description = (req.body.description || '').trim() || null;
    var status = req.body.status || 'active';

    if (!name) {
      req.session.flash = { type: 'error', msg: 'Department name is required.' };
      return res.redirect('/budget/departments?edit=' + id);
    }

    // Recalculate remaining: annual_budget - spent - committed
    await pool.query(
      'UPDATE budget_departments SET name=$1, code=$2, head_of_department=$3, annual_budget=$4,' +
      ' remaining=$4 - spent - committed, description=$5, status=$6, updated_at=NOW()' +
      ' WHERE id=$7 AND tenant_id=$8',
      [name, code, headOfDepartment, annualBudget, description, status, id, tid]
    );

    req.session.flash = { type: 'success', msg: 'Department "' + name + '" updated successfully.' };
    res.redirect('/budget/departments');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /budget/expenses — Expense List
  // ════════════════════════════════════════════════════════════
  app.get('/budget/expenses', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var perPage = 25;
    var offset = (page - 1) * perPage;

    // Filter params
    var filterDept = req.query.department_id || '';
    var filterType = req.query.expense_type || '';
    var filterStatus = req.query.status || '';
    var filterFrom = req.query.date_from || '';
    var filterTo = req.query.date_to || '';
    var filterQuarter = req.query.quarter || '';

    // Build WHERE clause
    var where = ['e.tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (filterDept) { where.push('e.department_id=$' + (pi++)); params.push(parseInt(filterDept)); }
    if (filterType) { where.push('e.expense_type=$' + (pi++)); params.push(filterType); }
    if (filterStatus) { where.push('e.status=$' + (pi++)); params.push(filterStatus); }
    if (filterFrom) { where.push('e.expense_date >= $' + (pi++)); params.push(filterFrom); }
    if (filterTo) { where.push('e.expense_date <= $' + (pi++)); params.push(filterTo); }
    if (filterQuarter) { where.push('e.quarter=$' + (pi++)); params.push(filterQuarter); }

    var whereClause = where.join(' AND ');

    // Get departments for filter
    var departments = (await pool.query('SELECT id, name FROM budget_departments WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    // Count
    var countResult = (await pool.query('SELECT COUNT(*)::int as total FROM budget_expenses e WHERE ' + whereClause, params)).rows[0];
    var totalCount = countResult.total;
    var totalPages = Math.ceil(totalCount / perPage);

    // Fetch expenses
    var expenses = (await pool.query(
      'SELECT e.*, d.name as dept_name FROM budget_expenses e' +
      ' LEFT JOIN budget_departments d ON d.id = e.department_id' +
      ' WHERE ' + whereClause +
      ' ORDER BY e.expense_date DESC, e.created_at DESC LIMIT $' + (pi++) + ' OFFSET $' + (pi++),
      params.concat([perPage, offset])
    )).rows;

    // Summary totals
    var summary = (await pool.query(
      'SELECT COALESCE(SUM(amount),0)::bigint as total_amount,' +
      ' COALESCE(SUM(CASE WHEN status=\'paid\' THEN amount ELSE 0 END),0)::bigint as paid_amount,' +
      ' COALESCE(SUM(CASE WHEN status=\'pending\' THEN amount ELSE 0 END),0)::bigint as pending_amount' +
      ' FROM budget_expenses e WHERE ' + whereClause,
      params.slice(0, pi - 3)
    )).rows[0];

    var rowsHtml = expenses.map(function(e) {
      return '<tr>' +
        '<td><strong>' + esc(e.dept_name || 'Unassigned') + '</strong></td>' +
        '<td>' + esc(e.description || '\u2014') + '</td>' +
        '<td><span style="font-size:11px;color:#64748b;text-transform:capitalize">' + esc(e.expense_type) + '</span></td>' +
        '<td style="font-weight:700;color:#1e293b">' + fmtMoney(e.amount) + '</td>' +
        '<td>' + esc(e.vendor || '\u2014') + '</td>' +
        '<td>' + statusBadge(e.status) + '</td>' +
        '<td style="font-size:12px">' + fmtDate(e.expense_date) + '</td>' +
        '<td style="font-size:12px;color:#94a3b8">' + fmtDate(e.created_at) + '</td>' +
        '</tr>';
    }).join('');

    // Pagination
    var paginationHtml = '';
    if (totalPages > 1) {
      var pages = [];
      for (var p = 1; p <= totalPages; p++) {
        if (p === page) {
          pages.push('<span style="padding:6px 12px;background:#1e40af;color:#fff;border-radius:6px;font-size:12px;font-weight:700">' + p + '</span>');
        } else {
          pages.push('<a href="/budget/expenses?page=' + p + '&department_id=' + filterDept + '&expense_type=' + filterType + '&status=' + filterStatus + '&date_from=' + filterFrom + '&date_to=' + filterTo + '&quarter=' + filterQuarter + '" style="padding:6px 12px;background:#f1f5f9;border-radius:6px;font-size:12px;text-decoration:none;color:#475569">' + p + '</a>');
        }
      }
      paginationHtml = '<div style="display:flex;gap:4px;justify-content:center;margin-top:16px;flex-wrap:wrap">' + pages.join('') + '</div>';
    }

    var html = BDG_CSS +
    '<div style="max-width:1200px;margin:0 auto">' +
      nav('/budget/expenses') +
      flashMsg(req) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b;margin:0">Expenses</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Track all departmental expenses</p></div>' +
        '<a href="/budget/expenses/add" class="bdg-btn bdg-btn-primary">+ Add Expense</a>' +
      '</div>' +

      // Summary cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#1e40af">' + fmtMoney(summary.total_amount) + '</div><div class="bdg-stat-label">Total (' + totalCount + ' expenses)</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#059669">' + fmtMoney(summary.paid_amount) + '</div><div class="bdg-stat-label">Paid</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#d97706">' + fmtMoney(summary.pending_amount) + '</div><div class="bdg-stat-label">Pending</div></div>' +
      '</div>' +

      // Filters
      '<div class="bdg-card">' +
        '<form method="GET" action="/budget/expenses" class="bdg-filter">' +
        formSelect('Department', 'department_id', departments.map(function(d) { return { value: d.id, label: d.name }; }), filterDept, { blankLabel: 'All Departments' }) +
        formSelect('Type', 'expense_type', [
          { value: 'supplies', label: 'Supplies' },
          { value: 'equipment', label: 'Equipment' },
          { value: 'services', label: 'Services' },
          { value: 'utilities', label: 'Utilities' },
          { value: 'maintenance', label: 'Maintenance' },
          { value: 'salary', label: 'Salary' },
          { value: 'travel', label: 'Travel' },
          { value: 'miscellaneous', label: 'Miscellaneous' }
        ], filterType, { blankLabel: 'All Types' }) +
        formSelect('Status', 'status', [
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'paid', label: 'Paid' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'cancelled', label: 'Cancelled' }
        ], filterStatus, { blankLabel: 'All Statuses' }) +
        formSelect('Quarter', 'quarter', [
          { value: 'Q1', label: 'Q1' },
          { value: 'Q2', label: 'Q2' },
          { value: 'Q3', label: 'Q3' },
          { value: 'Q4', label: 'Q4' }
        ], filterQuarter, { blankLabel: 'All Quarters' }) +
        formField('From Date', 'date_from', 'date', filterFrom) +
        formField('To Date', 'date_to', 'date', filterTo) +
        '<div><button type="submit" class="bdg-btn bdg-btn-primary" style="margin-top:22px">Filter</button></div>' +
        '</form>' +
      '</div>' +

      // Table
      '<div class="bdg-card">' +
        '<div style="overflow-x:auto"><table class="bdg-tbl">' +
        '<thead><tr><th>Department</th><th>Description</th><th>Type</th><th>Amount</th><th>Vendor</th><th>Status</th><th>Date</th><th>Created</th></tr></thead>' +
        '<tbody>' + (rowsHtml || '<tr><td colspan="8" class="bdg-empty">No expenses found matching your filters.</td></tr>') + '</tbody>' +
        '</table></div>' +
        paginationHtml +
      '</div>' +
    '</div>';
    res.send(renderPage('Budget Expenses', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: GET /budget/expenses/add — Add Expense Form
  // ════════════════════════════════════════════════════════════
  app.get('/budget/expenses/add', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var departments = (await pool.query('SELECT id, name FROM budget_departments WHERE tenant_id=$1 AND status=\'active\' ORDER BY name', [tid])).rows;

    var currentYear = new Date().getFullYear();
    var currentMonth = new Date().getMonth();
    var currentQuarter = 'Q' + Math.floor(currentMonth / 3 + 1);

    var html = BDG_CSS +
    '<div style="max-width:700px;margin:0 auto">' +
      nav('/budget/expenses') +
      '<a href="/budget/expenses" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Expenses</a>' +
      '<div class="bdg-card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">Add New Expense</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Record a new departmental expense</p>' +
        '<form method="POST" action="/budget/expenses/add" class="bdg-form-grid">' +
        formSelect('Department *', 'department_id', departments.map(function(d) { return { value: d.id, label: d.name }; }), '', { required: true, blankLabel: 'Select Department' }) +
        formSelect('Expense Type *', 'expense_type', [
          { value: 'supplies', label: 'Supplies' },
          { value: 'equipment', label: 'Equipment' },
          { value: 'services', label: 'Services' },
          { value: 'utilities', label: 'Utilities' },
          { value: 'maintenance', label: 'Maintenance' },
          { value: 'salary', label: 'Salary' },
          { value: 'travel', label: 'Travel' },
          { value: 'miscellaneous', label: 'Miscellaneous' }
        ], '', { required: true }) +
        formField('Amount (UGX) *', 'amount', 'number', '', { required: true, placeholder: '0' }) +
        formField('Expense Date *', 'expense_date', 'date', today(), { required: true }) +
        formField('Vendor', 'vendor', 'text', '', { placeholder: 'Supplier or vendor name' }) +
        formField('Invoice Number', 'invoice_number', 'text', '', { placeholder: 'INV-001' }) +
        formSelect('Payment Method', 'payment_method', [
          { value: 'cash', label: 'Cash' },
          { value: 'bank_transfer', label: 'Bank Transfer' },
          { value: 'mobile_money', label: 'Mobile Money' },
          { value: 'cheque', label: 'Cheque' },
          { value: 'card', label: 'Card' },
          { value: 'internal_transfer', label: 'Internal Transfer' }
        ], '') +
        formField('Payment Reference', 'payment_ref', 'text', '', { placeholder: 'Transaction reference' }) +
        formSelect('Quarter', 'quarter', [
          { value: 'Q1', label: 'Q1' },
          { value: 'Q2', label: 'Q2' },
          { value: 'Q3', label: 'Q3' },
          { value: 'Q4', label: 'Q4' }
        ], currentQuarter) +
        formField('Academic Year', 'academic_year', 'text', currentYear + '/' + (currentYear + 1), { placeholder: '2024/2025' }) +
        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>' +
        '<textarea name="description" rows="2" placeholder="Describe the expense" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>' +
        '<textarea name="notes" rows="2" placeholder="Additional notes" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
        '<div class="full" style="display:flex;gap:10px;margin-top:8px">' +
        '<button type="submit" class="bdg-btn bdg-btn-primary" style="padding:12px 28px">Save Expense</button>' +
        '<a href="/budget/expenses" class="bdg-btn bdg-btn-secondary">Cancel</a>' +
        '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Add Expense', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: POST /budget/expenses/add — Save Expense
  // ════════════════════════════════════════════════════════════
  app.post('/budget/expenses/add', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var departmentId = parseInt(req.body.department_id) || null;
    var expenseType = (req.body.expense_type || '').trim();
    var amount = parseInt(req.body.amount) || 0;
    var expenseDate = req.body.expense_date || today();
    var vendor = (req.body.vendor || '').trim() || null;
    var invoiceNumber = (req.body.invoice_number || '').trim() || null;
    var paymentMethod = (req.body.payment_method || '').trim() || null;
    var paymentRef = (req.body.payment_ref || '').trim() || null;
    var quarter = (req.body.quarter || '').trim() || null;
    var academicYear = (req.body.academic_year || '').trim() || null;
    var description = (req.body.description || '').trim() || null;
    var notes = (req.body.notes || '').trim() || null;

    if (!departmentId || !expenseType || amount <= 0) {
      req.session.flash = { type: 'error', msg: 'Department, expense type, and a valid amount are required.' };
      return res.redirect('/budget/expenses/add');
    }

    if (!expenseDate) expenseDate = today();

    // Use transaction for expense insert + department spent update
    var client = await pool.connect();
    try {
      await migrateQuery(pool, 'BudgetManager', 'BEGIN');

      // Insert expense
      var result = await migrateQuery(pool, 'BudgetManager', 
        'INSERT INTO budget_expenses (tenant_id, department_id, expense_type, amount, expense_date, vendor,' +
        ' invoice_number, payment_method, payment_ref, status, quarter, academic_year, description, notes, created_by)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'approved\',$10,$11,$12,$13,$14) RETURNING id',
        [tid, departmentId, expenseType, amount, expenseDate, vendor, invoiceNumber, paymentMethod, paymentRef, quarter, academicYear, description, notes, user.id]
      );

      // Update department spent and remaining
      await migrateQuery(pool, 'BudgetManager', 
        'UPDATE budget_departments SET spent = spent + $1, remaining = annual_budget - spent - committed - $1, updated_at = NOW()' +
        ' WHERE id = $2 AND tenant_id = $3',
        [amount, departmentId, tid]
      );

      await migrateQuery(pool, 'BudgetManager', 'COMMIT');
      req.session.flash = { type: 'success', msg: 'Expense of ' + fmtMoney(amount) + ' recorded successfully.' };
    } catch (err) {
      await migrateQuery(pool, 'BudgetManager', 'ROLLBACK');
      req.session.flash = { type: 'error', msg: 'Failed to save expense: ' + err.message };
    }

    res.redirect('/budget/expenses');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: GET /budget/purchase-requests — Purchase Request List
  // ════════════════════════════════════════════════════════════
  app.get('/budget/purchase-requests', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var filterStatus = req.query.status || '';
    var filterDept = req.query.department_id || '';
    var filterPriority = req.query.priority || '';

    var where = ['pr.tenant_id=$1'];
    var params = [tid];
    var pi = 2;

    if (filterStatus) { where.push('pr.status=$' + (pi++)); params.push(filterStatus); }
    if (filterDept) { where.push('pr.department_id=$' + (pi++)); params.push(parseInt(filterDept)); }
    if (filterPriority) { where.push('pr.priority=$' + (pi++)); params.push(filterPriority); }

    var whereClause = where.join(' AND ');

    // Departments for filter
    var departments = (await pool.query('SELECT id, name FROM budget_departments WHERE tenant_id=$1 ORDER BY name', [tid])).rows;

    // Summary
    var summary = (await pool.query(
      'SELECT' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests WHERE tenant_id=$1) as total,' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests WHERE tenant_id=$1 AND status=\'pending\') as pending,' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests WHERE tenant_id=$1 AND status=\'under_review\') as review,' +
      ' (SELECT COUNT(*)::int FROM budget_purchase_requests WHERE tenant_id=$1 AND status=\'approved\') as approved,' +
      ' (SELECT COALESCE(SUM(total_amount),0)::bigint FROM budget_purchase_requests WHERE tenant_id=$1 AND status IN (\'pending\',\'under_review\')) as pending_value,' +
      ' (SELECT COALESCE(SUM(approved_amount),0)::bigint FROM budget_purchase_requests WHERE tenant_id=$1 AND status=\'approved\') as approved_value',
      [tid]
    )).rows[0];

    // Purchase requests
    var requests = (await pool.query(
      'SELECT pr.*, d.name as dept_name, req_u.name as requester_name, app_u.name as approver_name' +
      ' FROM budget_purchase_requests pr' +
      ' LEFT JOIN budget_departments d ON d.id = pr.department_id' +
      ' LEFT JOIN users req_u ON req_u.id = pr.requested_by' +
      ' LEFT JOIN users app_u ON app_u.id = pr.approved_by' +
      ' WHERE ' + whereClause +
      ' ORDER BY pr.created_at DESC LIMIT 100',
      params
    )).rows;

    var rowsHtml = requests.map(function(pr) {
      var items = [];
      try { items = JSON.parse(pr.item_details || '[]'); } catch(e) { items = []; }
      var itemSummary = items.length > 0 ? items.map(function(it) { return esc(it.item || it.name || 'Item'); }).join(', ') : esc(pr.description || '\u2014');
      if (itemSummary.length > 60) itemSummary = itemSummary.substring(0, 60) + '...';

      return '<tr>' +
        '<td><strong><a href="/budget/purchase-requests?action=approve&id=' + pr.id + '" style="color:#1e40af;text-decoration:none">' + esc(pr.title) + '</a></strong></td>' +
        '<td>' + esc(pr.dept_name || 'Unassigned') + '</td>' +
        '<td>' + esc(pr.requester_name || '\u2014') + '</td>' +
        '<td style="font-weight:700;color:#1e293b">' + fmtMoney(pr.total_amount) + '</td>' +
        (pr.approved_amount ? '<td style="font-weight:600;color:#059669">' + fmtMoney(pr.approved_amount) + '</td>' : '<td>\u2014</td>') +
        '<td>' + priorityBadge(pr.priority) + '</td>' +
        '<td>' + statusBadge(pr.status) + '</td>' +
        '<td style="font-size:12px">' + fmtDate(pr.created_at) + '</td>' +
        '<td style="white-space:nowrap">' +
          (pr.status === 'pending' || pr.status === 'under_review' ?
            '<a href="/budget/purchase-requests?action=approve&id=' + pr.id + '" class="bdg-btn bdg-btn-success" style="padding:3px 10px;font-size:11px">Review</a>' : '') +
          '<span style="font-size:11px;color:#94a3b8;margin-left:4px">' + items.length + ' items</span>' +
        '</td>' +
        '</tr>';
    }).join('');

    // Approve/reject modal (if action=approve&id is in query)
    var modalHtml = '';
    var actionId = req.query.action === 'approve' ? req.query.id : '';
    if (actionId) {
      var prDetail = (await pool.query(
        'SELECT pr.*, d.name as dept_name FROM budget_purchase_requests pr' +
        ' LEFT JOIN budget_departments d ON d.id = pr.department_id' +
        ' WHERE pr.id=$1 AND pr.tenant_id=$2',
        [actionId, tid]
      )).rows[0];

      if (prDetail && (prDetail.status === 'pending' || prDetail.status === 'under_review')) {
        var detailItems = [];
        try { detailItems = JSON.parse(prDetail.item_details || '[]'); } catch(e) { detailItems = []; }
        var itemsTableHtml = detailItems.map(function(it) {
          return '<tr><td>' + esc(it.item || it.name || '\u2014') + '</td>' +
            '<td>' + esc(it.description || '\u2014') + '</td>' +
            '<td>' + (it.quantity || 0) + '</td>' +
            '<td>' + fmtMoney(it.unit_price || 0) + '</td>' +
            '<td style="font-weight:600">' + fmtMoney((it.quantity || 0) * (it.unit_price || 0)) + '</td></tr>';
        }).join('');

        modalHtml = '<div class="bdg-modal-overlay" onclick="if(event.target===this)this.style.display=\'none\'">' +
          '<div class="bdg-modal" style="max-width:650px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<h3>' + esc(prDetail.title) + '</h3>' +
          '<button onclick="this.closest(\'.bdg-modal-overlay\').style.display=\'none\'" style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8">&times;</button>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:13px">' +
          '<div><span style="color:#64748b">Department:</span> <strong>' + esc(prDetail.dept_name || 'Unassigned') + '</strong></div>' +
          '<div><span style="color:#64748b">Priority:</span> ' + priorityBadge(prDetail.priority) + '</div>' +
          '<div><span style="color:#64748b">Requested Amount:</span> <strong style="color:#1e293b">' + fmtMoney(prDetail.total_amount) + '</strong></div>' +
          '<div><span style="color:#64748b">Status:</span> ' + statusBadge(prDetail.status) + '</div>' +
          '</div>' +
          (prDetail.justification ? '<div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:14px;font-size:13px"><strong style="color:#475569">Justification:</strong><br>' + esc(prDetail.justification) + '</div>' : '') +
          (itemsTableHtml ? '<div style="margin-bottom:14px"><table class="bdg-tbl"><thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>' + itemsTableHtml + '</tbody></table></div>' : '') +
          '<form method="POST" action="/budget/purchase-requests/' + prDetail.id + '/approve" class="bdg-form-grid">' +
          formField('Approved Amount (UGX)', 'approved_amount', 'number', prDetail.total_amount) +
          formSelect('Action', 'action', [
            { value: 'approve', label: 'Approve' },
            { value: 'reject', label: 'Reject' }
          ], 'approve', { required: true }) +
          '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Rejection Reason (if rejecting)</label>' +
          '<textarea name="rejection_reason" rows="2" placeholder="Provide reason for rejection" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
          '<div class="full" style="display:flex;gap:10px">' +
          '<button type="submit" class="bdg-btn bdg-btn-success">Submit Decision</button>' +
          '<button type="button" onclick="this.closest(\'.bdg-modal-overlay\').style.display=\'none\'" class="bdg-btn bdg-btn-secondary">Cancel</button>' +
          '</div></form>' +
          '</div></div>';
      }
    }

    var html = BDG_CSS +
    '<div style="max-width:1200px;margin:0 auto">' +
      nav('/budget/purchase-requests') +
      flashMsg(req) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b;margin:0">Purchase Requests</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage and review procurement requests</p></div>' +
        '<a href="/budget/purchase-requests/new" class="bdg-btn bdg-btn-primary">+ New Request</a>' +
      '</div>' +

      // Summary
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#1e40af">' + summary.total + '</div><div class="bdg-stat-label">Total Requests</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#d97706">' + summary.pending + '</div><div class="bdg-stat-label">Pending</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#2563eb">' + summary.review + '</div><div class="bdg-stat-label">Under Review</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#059669">' + summary.approved + '</div><div class="bdg-stat-label">Approved</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#dc2626">' + fmtMoney(summary.pending_value) + '</div><div class="bdg-stat-label">Pending Value</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#16a34a">' + fmtMoney(summary.approved_value) + '</div><div class="bdg-stat-label">Approved Value</div></div>' +
      '</div>' +

      // Filters
      '<div class="bdg-card">' +
        '<form method="GET" action="/budget/purchase-requests" class="bdg-filter">' +
        formSelect('Department', 'department_id', departments.map(function(d) { return { value: d.id, label: d.name }; }), filterDept, { blankLabel: 'All Departments' }) +
        formSelect('Status', 'status', [
          { value: 'pending', label: 'Pending' },
          { value: 'under_review', label: 'Under Review' },
          { value: 'approved', label: 'Approved' },
          { value: 'ordered', label: 'Ordered' },
          { value: 'received', label: 'Received' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'cancelled', label: 'Cancelled' }
        ], filterStatus, { blankLabel: 'All Statuses' }) +
        formSelect('Priority', 'priority', [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' }
        ], filterPriority, { blankLabel: 'All Priorities' }) +
        '<div><button type="submit" class="bdg-btn bdg-btn-primary" style="margin-top:22px">Filter</button></div>' +
        '</form>' +
      '</div>' +

      // Table
      '<div class="bdg-card">' +
        '<div style="overflow-x:auto"><table class="bdg-tbl">' +
        '<thead><tr><th>Title</th><th>Dept</th><th>Requested By</th><th>Amount</th><th>Approved</th><th>Priority</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>' +
        '<tbody>' + (rowsHtml || '<tr><td colspan="9" class="bdg-empty">No purchase requests found.</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
      modalHtml +
    '</div>';
    res.send(renderPage('Purchase Requests', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: GET /budget/purchase-requests/new — New PR Form
  // ════════════════════════════════════════════════════════════
  app.get('/budget/purchase-requests/new', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var departments = (await pool.query('SELECT id, name FROM budget_departments WHERE tenant_id=$1 AND status=\'active\' ORDER BY name', [tid])).rows;

    var html = BDG_CSS +
    '<div style="max-width:750px;margin:0 auto">' +
      nav('/budget/purchase-requests') +
      '<a href="/budget/purchase-requests" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Purchase Requests</a>' +
      '<div class="bdg-card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin:0 0 4px">New Purchase Request</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a procurement request for your department</p>' +
        '<form method="POST" action="/budget/purchase-requests/new" id="prForm">' +
        '<div class="bdg-form-grid" style="margin-bottom:16px">' +
        formField('Request Title *', 'title', 'text', '', { required: true, placeholder: 'e.g., Laboratory Equipment for Term 2' }) +
        formSelect('Department *', 'department_id', departments.map(function(d) { return { value: d.id, label: d.name }; }), '', { required: true, blankLabel: 'Select Department' }) +
        formSelect('Priority *', 'priority', [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' }
        ], 'normal', { required: true }) +
        formField('Supplier', 'supplier', 'text', '', { placeholder: 'Preferred supplier name' }) +
        formField('Expected Delivery', 'expected_delivery', 'date', '') +
        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>' +
        '<textarea name="description" rows="2" placeholder="Brief description of the request" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Justification *' +
        '</label><textarea name="justification" rows="3" required placeholder="Explain why this purchase is needed" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +
        '</div>' +

        // Dynamic items section
        '<div style="margin-bottom:20px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<h3 class="bdg-section-title" style="border:none;padding:0;margin:0">Item Details</h3>' +
        '<button type="button" onclick="addItemRow()" class="bdg-btn bdg-btn-secondary" style="padding:5px 12px;font-size:12px">+ Add Item</button>' +
        '</div>' +
        '<div style="overflow-x:auto"><table class="bdg-tbl" id="itemsTable">' +
        '<thead><tr><th>Item Name</th><th>Description</th><th>Quantity</th><th>Unit Price (UGX)</th><th>Total</th><th></th></tr></thead>' +
        '<tbody id="itemsBody">' +
        '<tr class="item-row">' +
        '<td><input type="text" name="item_name[]" required placeholder="Item name" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"></td>' +
        '<td><input type="text" name="item_desc[]" placeholder="Description" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"></td>' +
        '<td><input type="number" name="item_qty[]" value="1" min="1" required oninput="calcRowTotal(this)" style="width:70px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;text-align:center"></td>' +
        '<td><input type="number" name="item_price[]" value="0" min="0" required oninput="calcRowTotal(this)" style="width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;text-align:right"></td>' +
        '<td class="row-total" style="font-weight:700;color:#1e293b;min-width:100px">UGX 0</td>' +
        '<td><button type="button" onclick="removeItemRow(this)" class="bdg-btn bdg-btn-danger" style="padding:3px 8px;font-size:11px">&times;</button></td>' +
        '</tr>' +
        '</tbody>' +
        '</table></div>' +
        '<div style="text-align:right;margin-top:12px;font-size:18px;font-weight:800;color:#1e40af">Total: <span id="grandTotal">UGX 0</span></div>' +
        '</div>' +

        '<div class="full"><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Additional Notes</label>' +
        '<textarea name="notes" rows="2" placeholder="Any additional information" style="width:100%;padding:10px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>' +

        '<div style="display:flex;gap:10px;margin-top:16px">' +
        '<button type="submit" class="bdg-btn bdg-btn-primary" style="padding:12px 28px">Submit Request</button>' +
        '<a href="/budget/purchase-requests" class="bdg-btn bdg-btn-secondary">Cancel</a>' +
        '</div>' +
        '</form>' +
      '</div>' +

      '<script>' +
      'function addItemRow() {' +
      '  var tbody = document.getElementById("itemsBody");' +
      '  var row = document.createElement("tr");' +
      '  row.className = "item-row";' +
      '  row.innerHTML = \'<td><input type="text" name="item_name[]" required placeholder="Item name" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"></td>\' +' +
      '    \'<td><input type="text" name="item_desc[]" placeholder="Description" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px"></td>\' +' +
      '    \'<td><input type="number" name="item_qty[]" value="1" min="1" required oninput="calcRowTotal(this)" style="width:70px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;text-align:center"></td>\' +' +
      '    \'<td><input type="number" name="item_price[]" value="0" min="0" required oninput="calcRowTotal(this)" style="width:120px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;text-align:right"></td>\' +' +
      '    \'<td class="row-total" style="font-weight:700;color:#1e293b;min-width:100px">UGX 0</td>\' +' +
      '    \'<td><button type="button" onclick="removeItemRow(this)" class="bdg-btn bdg-btn-danger" style="padding:3px 8px;font-size:11px">&times;</button></td>\';' +
      '  tbody.appendChild(row);' +
      '}' +
      'function removeItemRow(btn) {' +
      '  var row = btn.closest("tr");' +
      '  if (row.parentNode.rows.length <= 1) { alert("At least one item is required."); return; }' +
      '  row.remove();' +
      '  calcGrandTotal();' +
      '}' +
      'function calcRowTotal(input) {' +
      '  var row = input.closest("tr");' +
      '  var qty = parseInt(row.querySelector(\'input[name="item_qty[]"]\').value) || 0;' +
      '  var price = parseInt(row.querySelector(\'input[name="item_price[]"]\').value) || 0;' +
      '  var total = qty * price;' +
      '  row.querySelector(".row-total").textContent = "UGX " + total.toLocaleString();' +
      '  calcGrandTotal();' +
      '}' +
      'function calcGrandTotal() {' +
      '  var rows = document.querySelectorAll("#itemsBody tr");' +
      '  var grand = 0;' +
      '  rows.forEach(function(row) {' +
      '    var qty = parseInt(row.querySelector(\'input[name="item_qty[]"]\').value) || 0;' +
      '    var price = parseInt(row.querySelector(\'input[name="item_price[]"]\').value) || 0;' +
      '    grand += qty * price;' +
      '  });' +
      '  document.getElementById("grandTotal").textContent = "UGX " + grand.toLocaleString();' +
      '}' +
      '</script>' +
    '</div>';
    res.send(renderPage('New Purchase Request', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: POST /budget/purchase-requests/new — Save PR
  // ════════════════════════════════════════════════════════════
  app.post('/budget/purchase-requests/new', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var title = (req.body.title || '').trim();
    var departmentId = parseInt(req.body.department_id) || null;
    var priority = req.body.priority || 'normal';
    var supplier = (req.body.supplier || '').trim() || null;
    var expectedDelivery = req.body.expected_delivery || null;
    var description = (req.body.description || '').trim() || null;
    var justification = (req.body.justification || '').trim() || null;
    var notes = (req.body.notes || '').trim() || null;

    if (!title || !departmentId) {
      req.session.flash = { type: 'error', msg: 'Title and department are required.' };
      return res.redirect('/budget/purchase-requests/new');
    }

    // Build item_details JSON
    var itemNames = req.body.item_name;
    var itemDescs = req.body.item_desc;
    var itemQtys = req.body.item_qty;
    var itemPrices = req.body.item_price;

    // Normalise to arrays
    if (!Array.isArray(itemNames)) itemNames = [itemNames];
    if (!Array.isArray(itemDescs)) itemDescs = [itemDescs];
    if (!Array.isArray(itemQtys)) itemQtys = [itemQtys];
    if (!Array.isArray(itemPrices)) itemPrices = [itemPrices];

    var items = [];
    var totalAmount = 0;
    for (var i = 0; i < itemNames.length; i++) {
      if (itemNames[i] && String(itemNames[i]).trim()) {
        var qty = parseInt(itemQtys[i]) || 0;
        var price = parseInt(itemPrices[i]) || 0;
        var itemTotal = qty * price;
        items.push({
          item: String(itemNames[i]).trim(),
          description: String(itemDescs[i] || '').trim(),
          quantity: qty,
          unit_price: price,
          total: itemTotal
        });
        totalAmount += itemTotal;
      }
    }

    if (items.length === 0) {
      req.session.flash = { type: 'error', msg: 'At least one item is required.' };
      return res.redirect('/budget/purchase-requests/new');
    }

    await pool.query(
      'INSERT INTO budget_purchase_requests (tenant_id, department_id, title, description, item_details, total_amount,' +
      ' justification, priority, requested_by, status, supplier, expected_delivery, notes)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'pending\',$10,$11,$12)',
      [tid, departmentId, title, description, JSON.stringify(items), totalAmount, justification, priority, user.id, supplier, expectedDelivery, notes]
    );

    req.session.flash = { type: 'success', msg: 'Purchase request "' + title + '" submitted for ' + fmtMoney(totalAmount) + '.' };
    res.redirect('/budget/purchase-requests');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: POST /budget/purchase-requests/:id/approve
  // ════════════════════════════════════════════════════════════
  app.post('/budget/purchase-requests/:id/approve', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, id = req.params.id;
    var action = (req.body.action || '').trim();
    var approvedAmount = parseInt(req.body.approved_amount) || 0;
    var rejectionReason = (req.body.rejection_reason || '').trim() || null;

    if (action !== 'approve' && action !== 'reject') {
      req.session.flash = { type: 'error', msg: 'Invalid action. Must be approve or reject.' };
      return res.redirect('/budget/purchase-requests');
    }

    var pr = (await pool.query(
      'SELECT * FROM budget_purchase_requests WHERE id=$1 AND tenant_id=$2',
      [id, tid]
    )).rows[0];

    if (!pr) {
      req.session.flash = { type: 'error', msg: 'Purchase request not found.' };
      return res.redirect('/budget/purchase-requests');
    }

    if (pr.status !== 'pending' && pr.status !== 'under_review') {
      req.session.flash = { type: 'error', msg: 'This request has already been processed (' + pr.status + ').' };
      return res.redirect('/budget/purchase-requests');
    }

    var client = await pool.connect();
    try {
      await migrateQuery(pool, 'BudgetManager', 'BEGIN');

      if (action === 'approve') {
        var approveAmt = approvedAmount > 0 ? approvedAmount : Number(pr.total_amount || 0);

        // Update purchase request
        await migrateQuery(pool, 'BudgetManager', 
          'UPDATE budget_purchase_requests SET status=\'approved\', approved_by=$1, approved_at=NOW(),' +
          ' approved_amount=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
          [user.id, approveAmt, id, tid]
        );

        // Update department committed budget
        if (pr.department_id) {
          await migrateQuery(pool, 'BudgetManager', 
            'UPDATE budget_departments SET committed = committed + $1, remaining = annual_budget - spent - committed - $1, updated_at = NOW()' +
            ' WHERE id = $2 AND tenant_id = $3',
            [approveAmt, pr.department_id, tid]
          );
        }

        await migrateQuery(pool, 'BudgetManager', 'COMMIT');
        req.session.flash = { type: 'success', msg: 'Purchase request approved for ' + fmtMoney(approveAmt) + '. Committed budget updated.' };
      } else {
        // Reject
        await migrateQuery(pool, 'BudgetManager', 
          'UPDATE budget_purchase_requests SET status=\'rejected\', approved_by=$1, approved_at=NOW(),' +
          ' rejection_reason=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
          [user.id, rejectionReason, id, tid]
        );

        await migrateQuery(pool, 'BudgetManager', 'COMMIT');
        req.session.flash = { type: 'success', msg: 'Purchase request rejected.' + (rejectionReason ? ' Reason: ' + rejectionReason : '') };
      }
    } catch (err) {
      await migrateQuery(pool, 'BudgetManager', 'ROLLBACK');
      req.session.flash = { type: 'error', msg: 'Failed to process request: ' + err.message };
    }

    res.redirect('/budget/purchase-requests');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: GET /budget/reports — Financial Reports
  // ════════════════════════════════════════════════════════════
  app.get('/budget/reports', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var reportYear = req.query.year || new Date().getFullYear().toString();

    // ── 1. Spending by Department ──
    var deptSpending = (await pool.query(
      'SELECT d.name, d.annual_budget, d.spent, d.committed, d.remaining,' +
      ' (SELECT COALESCE(SUM(e.amount),0)::bigint FROM budget_expenses e WHERE e.department_id=d.id AND e.tenant_id=$1 AND EXTRACT(YEAR FROM e.expense_date)=$2) as year_spent' +
      ' FROM budget_departments d WHERE d.tenant_id=$1 AND d.status=\'active\' ORDER BY year_spent DESC',
      [tid, reportYear]
    )).rows;

    var maxDeptSpend = Math.max.apply(null, deptSpending.map(function(d) { return Number(d.year_spent || 0); }).concat([1]));

    var deptSpendingHtml = deptSpending.map(function(d) {
      var ys = Number(d.year_spent || 0);
      var p = pct(ys, maxDeptSpend);
      return '<div style="margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
        '<span style="font-size:13px;font-weight:600;color:#1e293b">' + esc(d.name) + '</span>' +
        '<span style="font-size:12px;color:#64748b">' + fmtMoney(ys) + ' / ' + fmtMoney(d.annual_budget) + '</span>' +
        '</div>' +
        '<div class="bdg-chart-track">' +
        '<div class="bdg-chart-fill" style="width:' + Math.min(p, 100) + '%;background:#1e40af"></div>' +
        '</div></div>';
    }).join('');

    // ── 2. Monthly Spending Trends ──
    var monthlyTrend = (await pool.query(
      'SELECT EXTRACT(MONTH FROM expense_date)::int as mnum,' +
      ' TO_CHAR(expense_date, \'Mon\') as month,' +
      ' COALESCE(SUM(CASE WHEN status IN (\'approved\',\'paid\') THEN amount ELSE 0 END),0)::bigint as approved_amt,' +
      ' COALESCE(SUM(CASE WHEN status=\'pending\' THEN amount ELSE 0 END),0)::bigint as pending_amt,' +
      ' COALESCE(SUM(amount),0)::bigint as total_amt' +
      ' FROM budget_expenses WHERE tenant_id=$1 AND EXTRACT(YEAR FROM expense_date)=$2' +
      ' GROUP BY EXTRACT(MONTH FROM expense_date), TO_CHAR(expense_date, \'Mon\') ORDER BY mnum',
      [tid, reportYear]
    )).rows;

    var maxMonthlyAmt = Math.max.apply(null, monthlyTrend.map(function(m) { return Number(m.total_amt || 0); }).concat([1]));

    var monthlyTrendHtml = monthlyTrend.map(function(m) {
      var p = pct(Number(m.total_amt || 0), maxMonthlyAmt);
      var pendingP = pct(Number(m.pending_amt || 0), maxMonthlyAmt);
      return '<div style="margin-bottom:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">' +
        '<span style="font-size:12px;font-weight:600;color:#475569;min-width:40px">' + m.month + '</span>' +
        '<span style="font-size:12px;color:#1e293b;font-weight:700">' + fmtMoney(m.total_amt) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:2px;height:20px;border-radius:6px;overflow:hidden;background:#e2e8f0">' +
        '<div style="width:' + pct(Number(m.approved_amt || 0), maxMonthlyAmt) + '%;background:#1e40af;border-radius:6px 0 0 6px"></div>' +
        '<div style="width:' + pendingP + '%;background:#fbbf24;border-radius:0 6px 6px 0"></div>' +
        '</div></div>';
    }).join('');

    // ── 3. Expense Type Breakdown ──
    var typeBreakdown = (await pool.query(
      'SELECT expense_type, COUNT(*)::int as count, COALESCE(SUM(amount),0)::bigint as total' +
      ' FROM budget_expenses WHERE tenant_id=$1 AND EXTRACT(YEAR FROM expense_date)=$2' +
      ' GROUP BY expense_type ORDER BY total DESC',
      [tid, reportYear]
    )).rows;

    var totalByType = typeBreakdown.reduce(function(s, t) { return s + Number(t.total || 0); }, 0);
    var typeColors = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe', '#d97706', '#059669', '#dc2626'];

    var typeBreakdownHtml = typeBreakdown.map(function(t, idx) {
      var p = pct(Number(t.total || 0), totalByType);
      var color = typeColors[idx % typeColors.length];
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        '<div style="width:12px;height:12px;border-radius:3px;background:' + color + ';flex-shrink:0"></div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:3px">' +
        '<span style="font-size:13px;font-weight:600;color:#1e293b;text-transform:capitalize">' + esc(t.expense_type) + '</span>' +
        '<span style="font-size:12px;color:#64748b">' + fmtMoney(t.total) + ' (' + p + '%)</span>' +
        '</div>' +
        '<div style="background:#e2e8f0;border-radius:6px;height:14px;overflow:hidden">' +
        '<div style="height:100%;width:' + p + '%;background:' + color + ';border-radius:6px"></div>' +
        '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + t.count + ' expense' + (t.count !== 1 ? 's' : '') + '</div>' +
        '</div></div>';
    }).join('');

    // ── 4. Budget Variance ──
    var budgetVariance = (await pool.query(
      'SELECT d.name as dept_name, d.annual_budget,' +
      ' d.spent as total_spent, d.committed as total_committed,' +
      ' d.annual_budget - d.spent - d.committed as total_remaining,' +
      ' CASE WHEN d.annual_budget > 0 THEN ROUND(((d.spent + d.committed)::numeric / d.annual_budget::numeric) * 100, 1) ELSE 0 END as utilisation_pct' +
      ' FROM budget_departments d WHERE d.tenant_id=$1 AND d.status=\'active\' AND d.annual_budget > 0' +
      ' ORDER BY utilisation_pct DESC',
      [tid]
    )).rows;

    var varianceRowsHtml = budgetVariance.map(function(v) {
      var upct = Number(v.utilisation_pct || 0);
      var variance = Number(v.total_remaining || 0);
      var statusLabel = upct >= 100 ? 'Over Budget' : upct >= 90 ? 'Near Limit' : upct >= 70 ? 'On Track' : 'Under Budget';
      var statusColor = upct >= 100 ? '#dc2626' : upct >= 90 ? '#d97706' : upct >= 70 ? '#2563eb' : '#16a34a';
      return '<tr>' +
        '<td><strong>' + esc(v.dept_name) + '</strong></td>' +
        '<td style="font-weight:600">' + fmtMoney(v.annual_budget) + '</td>' +
        '<td style="font-weight:600;color:#dc2626">' + fmtMoney(v.total_spent) + '</td>' +
        '<td style="font-weight:600;color:#d97706">' + fmtMoney(v.total_committed) + '</td>' +
        '<td style="font-weight:600;color:' + (variance < 0 ? '#dc2626' : '#16a34a') + '">' + fmtMoney(variance) + '</td>' +
        '<td>' + utilBar(Number(v.total_spent) + Number(v.total_committed), Number(v.annual_budget)) + '</td>' +
        '<td><span class="bdg-badge" style="background:' + statusColor + '20;color:' + statusColor + '">' + statusLabel + '</span></td>' +
        '</tr>';
    }).join('');

    // Totals row
    var totalBudgetAll = budgetVariance.reduce(function(s, v) { return s + Number(v.annual_budget || 0); }, 0);
    var totalSpentAll = budgetVariance.reduce(function(s, v) { return s + Number(v.total_spent || 0); }, 0);
    var totalCommittedAll = budgetVariance.reduce(function(s, v) { return s + Number(v.total_committed || 0); }, 0);
    var totalRemainingAll = budgetVariance.reduce(function(s, v) { return s + Number(v.total_remaining || 0); }, 0);
    var totalUtilPct = pct(totalSpentAll + totalCommittedAll, totalBudgetAll);

    // ── 5. Quarter-over-Quarter Comparison ──
    var quarterData = (await pool.query(
      'SELECT quarter, COALESCE(SUM(amount),0)::bigint as total,' +
      ' COUNT(*)::int as count' +
      ' FROM budget_expenses WHERE tenant_id=$1 AND EXTRACT(YEAR FROM expense_date)=$2 AND quarter IS NOT NULL' +
      ' GROUP BY quarter ORDER BY quarter',
      [tid, reportYear]
    )).rows;

    var quarterHtml = quarterData.map(function(q) {
      var maxQ = Math.max.apply(null, quarterData.map(function(x) { return Number(x.total || 0); }).concat([1]));
      var p = pct(Number(q.total || 0), maxQ);
      return '<div style="flex:1;text-align:center;padding:14px;background:#f8fafc;border-radius:10px">' +
        '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px">' + esc(q.quarter) + '</div>' +
        '<div style="font-size:18px;font-weight:800;color:#1e40af">' + fmtMoney(q.total) + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + q.count + ' expenses</div>' +
        '</div>';
    }).join('');

    var html = BDG_CSS +
    '<div style="max-width:1200px;margin:0 auto">' +
      nav('/budget/reports') +
      flashMsg(req) +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b;margin:0">Financial Reports</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Budget analysis, spending trends and variance reports</p></div>' +
        '<div class="bdg-filter" style="margin:0">' +
        '<label>Year</label>' +
        '<select onchange="location.href=\'/budget/reports?year=\'+this.value" style="padding:8px 14px;border:2px solid #cbd5e1;border-radius:10px;font-size:13px">' +
        '<option value="2024"' + (reportYear === '2024' ? ' selected' : '') + '>2024</option>' +
        '<option value="2025"' + (reportYear === '2025' ? ' selected' : '') + '>2025</option>' +
        '<option value="2026"' + (reportYear === '2026' ? ' selected' : '') + '>2026</option>' +
        '</select></div>' +
      '</div>' +

      // Summary totals
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#1e40af">' + fmtMoney(totalBudgetAll) + '</div><div class="bdg-stat-label">Total Budget</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#dc2626">' + fmtMoney(totalSpentAll) + '</div><div class="bdg-stat-label">Total Spent</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#d97706">' + fmtMoney(totalCommittedAll) + '</div><div class="bdg-stat-label">Total Committed</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:#16a34a">' + fmtMoney(totalRemainingAll) + '</div><div class="bdg-stat-label">Total Remaining</div></div>' +
        '<div class="bdg-stat"><div class="bdg-stat-num" style="color:' + (totalUtilPct >= 90 ? '#dc2626' : '#1e40af') + '">' + totalUtilPct + '%</div><div class="bdg-stat-label">Overall Utilisation</div></div>' +
      '</div>' +

      // Row 1: Spending by Dept + Monthly Trends
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div class="bdg-card">' +
          '<h3 class="bdg-section-title">Spending by Department (' + reportYear + ')</h3>' +
          (deptSpendingHtml || '<div class="bdg-empty">No data available for ' + reportYear + '.</div>') +
        '</div>' +
        '<div class="bdg-card">' +
          '<h3 class="bdg-section-title">Monthly Spending Trend (' + reportYear + ')</h3>' +
          '<div style="margin-bottom:8px;display:flex;gap:12px;font-size:11px;color:#94a3b8">' +
          '<span><span style="display:inline-block;width:10px;height:10px;background:#1e40af;border-radius:2px;margin-right:4px"></span>Approved/Paid</span>' +
          '<span><span style="display:inline-block;width:10px;height:10px;background:#fbbf24;border-radius:2px;margin-right:4px"></span>Pending</span>' +
          '</div>' +
          (monthlyTrendHtml || '<div class="bdg-empty">No data available for ' + reportYear + '.</div>') +
        '</div>' +
      '</div>' +

      // Row 2: Expense Type + Quarterly
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div class="bdg-card">' +
          '<h3 class="bdg-section-title">Expense Type Breakdown (' + reportYear + ')</h3>' +
          (typeBreakdownHtml || '<div class="bdg-empty">No expense data.</div>') +
        '</div>' +
        '<div class="bdg-card">' +
          '<h3 class="bdg-section-title">Quarterly Summary (' + reportYear + ')</h3>' +
          '<div style="display:flex;gap:12px">' + (quarterHtml || '<div class="bdg-empty">No quarterly data.</div>') + '</div>' +
        '</div>' +
      '</div>' +

      // Row 3: Budget Variance Table
      '<div class="bdg-card">' +
        '<h3 class="bdg-section-title">Budget Variance Report</h3>' +
        '<div style="overflow-x:auto"><table class="bdg-tbl">' +
        '<thead><tr><th>Department</th><th>Annual Budget</th><th>Spent</th><th>Committed</th><th>Remaining</th><th>Utilisation</th><th>Status</th></tr></thead>' +
        '<tbody>' +
        (varianceRowsHtml || '<tr><td colspan="7" class="bdg-empty">No departments with budget allocated.</td></tr>') +
        '<tr style="font-weight:800;background:#f8fafc;border-top:2px solid #1e40af">' +
        '<td>TOTAL</td>' +
        '<td style="color:#1e40af">' + fmtMoney(totalBudgetAll) + '</td>' +
        '<td style="color:#dc2626">' + fmtMoney(totalSpentAll) + '</td>' +
        '<td style="color:#d97706">' + fmtMoney(totalCommittedAll) + '</td>' +
        '<td style="color:' + (totalRemainingAll < 0 ? '#dc2626' : '#16a34a') + '">' + fmtMoney(totalRemainingAll) + '</td>' +
        '<td>' + utilBar(totalSpentAll + totalCommittedAll, totalBudgetAll) + '</td>' +
        '<td>' +
        '<span class="bdg-badge" style="background:' + (totalUtilPct >= 100 ? '#dc2626' : totalUtilPct >= 90 ? '#d97706' : '#16a34a') + '20;color:' + (totalUtilPct >= 100 ? '#dc2626' : totalUtilPct >= 90 ? '#d97706' : '#16a34a') + '">' +
        (totalUtilPct >= 100 ? 'Over Budget' : totalUtilPct >= 90 ? 'Near Limit' : totalUtilPct >= 70 ? 'On Track' : 'Under Budget') +
        '</span></td>' +
        '</tr>' +
        '</tbody></table></div>' +
      '</div>' +

    '</div>';
    res.send(renderPage('Budget Reports - ' + reportYear, html, user, req));
  }));

};
