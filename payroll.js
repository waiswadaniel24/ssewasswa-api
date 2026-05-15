// ============================================================
// PAYROLL MODULE — Multi-Tenant Payroll Management
// Employees, payroll runs, entries, processing, payslips.
// Usage: const payroll = require('./payroll');
//        payroll(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function payroll(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtMoney = (n) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';

  function runBadge(status) {
    const m = {
      draft:      { bg: '#f1f5f9', c: '#64748b', l: 'Draft' },
      processing: { bg: '#dbeafe', c: '#2563eb', l: 'Processing' },
      paid:       { bg: '#dcfce7', c: '#16a34a', l: 'Paid' },
      cancelled:  { bg: '#fee2e2', c: '#dc2626', l: 'Cancelled' }
    };
    const s = m[status] || m.draft;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function empBadge(status) {
    if (status === 'active') return '<span class="badge badge-success">Active</span>';
    if (status === 'inactive') return '<span class="badge badge-warning">Inactive</span>';
    return '<span class="badge" style="background:#f1f5f9;color:#64748b">' + esc(status) + '</span>';
  }

  // ── CSS ───────────────────────────────────────────────────
  const PR_CSS = `<style>
.pr-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.pr-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.pr-nav a:hover{background:#e2e8f0}.pr-nav a.active{background:#4f46e5;color:#fff}
.pr-tbl{width:100%;border-collapse:collapse;font-size:13px}
.pr-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.pr-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.pr-tbl tr:hover{background:#f8fafc}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
.payslip{border:2px solid #e2e8f0;border-radius:12px;max-width:680px;margin:16px auto;background:#fff}
.payslip-header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:20px 24px;border-radius:10px 10px 0 0}
.payslip-body{padding:24px}
.payslip-section{margin-bottom:16px}
.payslip-section h4{font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;border-bottom:1px solid #f1f5f9;padding-bottom:6px}
.payslip-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
.payslip-row .label{color:#475569}.payslip-row .value{font-weight:600;color:#1e293b}
.payslip-total{display:flex;justify-content:space-between;padding:12px 0;font-size:15px;font-weight:800;border-top:2px solid #4f46e5;margin-top:8px}
.payslip-total .value{color:#4f46e5}
.entry-form{display:flex;gap:6px;align-items:center}
.entry-form input{width:90px;padding:5px 8px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px;text-align:right}
.entry-form input:focus{outline:none;border-color:#4f46e5}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.pr-nav{flex-direction:column}}
</style>`;

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS payroll_employees (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_name VARCHAR(255) NOT NULL, employee_id VARCHAR(50),
      email VARCHAR(255), phone VARCHAR(20), department VARCHAR(100),
      position VARCHAR(100), base_salary NUMERIC(12,2) DEFAULT 0,
      bank_name VARCHAR(255), bank_account VARCHAR(50),
      tax_id VARCHAR(50), nssf_number VARCHAR(50),
      start_date DATE, status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payroll_runs (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      period_name VARCHAR(100) NOT NULL, pay_period_start DATE, pay_period_end DATE,
      total_gross NUMERIC(14,2) DEFAULT 0, total_deductions NUMERIC(14,2) DEFAULT 0,
      total_net NUMERIC(14,2) DEFAULT 0, employee_count INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'draft', processed_by INTEGER,
      processed_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payroll_entries (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
      gross_pay NUMERIC(12,2) DEFAULT 0, overtime NUMERIC(12,2) DEFAULT 0,
      bonus NUMERIC(12,2) DEFAULT 0, tax NUMERIC(12,2) DEFAULT 0,
      nssf NUMERIC(12,2) DEFAULT 0, other_deductions NUMERIC(12,2) DEFAULT 0,
      deduction_notes TEXT, net_pay NUMERIC(12,2) DEFAULT 0,
      payment_method VARCHAR(20) DEFAULT 'bank_transfer', payment_ref VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE IF NOT EXISTS — all columns
    ...[
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS department VARCHAR(100)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS position VARCHAR(100)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS base_salary NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS nssf_number VARCHAR(50)`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS start_date DATE`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
      `ALTER TABLE IF EXISTS payroll_employees ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS period_name VARCHAR(100)`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS pay_period_start DATE`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS pay_period_end DATE`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS total_gross NUMERIC(14,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS total_deductions NUMERIC(14,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS total_net NUMERIC(14,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS employee_count INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS processed_by INTEGER`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS payroll_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS run_id INTEGER`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS employee_id INTEGER`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS gross_pay NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS overtime NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS bonus NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS tax NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS nssf NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS other_deductions NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS deduction_notes TEXT`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS net_pay NUMERIC(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'bank_transfer'`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100)`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`,
      `ALTER TABLE IF EXISTS payroll_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`
    ],
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_payroll_emp_tenant ON payroll_employees(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_emp_status ON payroll_employees(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_emp_dept ON payroll_employees(tenant_id, department)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON payroll_runs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_entries_run ON payroll_entries(run_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_entries_tenant ON payroll_entries(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payroll_entries_emp ON payroll_entries(employee_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[Payroll] Cannot connect to DB for migrations'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Payroll] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { console.error('[Payroll] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ── helper: navigation bar ───────────────────────────────
  function nav(active) {
    const links = [
      ['/payroll', 'Dashboard'], ['/payroll/employees', 'Employees'],
      ['/payroll/run/new', 'New Run'], ['/payroll/history', 'History']
    ];
    return '<div class="pr-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ── helper: employee form field ──────────────────────────
  function empField(label, name, type, val, opts) {
    const req = opts && opts.required ? ' required' : '';
    const ro = opts && opts.readonly ? ' readonly' : '';
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}"${req}${ro}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"
        ${opts && opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : ''}></div>`;
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /payroll — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/payroll', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM payroll_employees WHERE tenant_id=$1 AND status='active') as emp_count,
        (SELECT COALESCE(SUM(total_net),0) FROM payroll_runs WHERE tenant_id=$1 AND status='paid') as total_paid,
        (SELECT COALESCE(SUM(total_net),0) FROM payroll_runs WHERE tenant_id=$1 AND status='paid'
          AND pay_period_start >= date_trunc('month', CURRENT_DATE)) as this_month,
        (SELECT COUNT(*) FROM payroll_runs WHERE tenant_id=$1 AND status IN ('draft','processing')) as pending_runs
    `, [tid])).rows[0];

    const recentRuns = (await pool.query(`
      SELECT pr.*, u.name as processor_name
      FROM payroll_runs pr LEFT JOIN users u ON u.id = pr.processed_by
      WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC LIMIT 10`, [tid])).rows;

    const deptSummary = (await pool.query(`
      SELECT department, COUNT(*) as cnt, COALESCE(SUM(base_salary),0) as total_salary
      FROM payroll_employees WHERE tenant_id=$1 AND status='active'
      GROUP BY department ORDER BY total_salary DESC LIMIT 6`, [tid])).rows;

    const runsHtml = recentRuns.map(r => `<tr>
      <td><a href="/payroll/run/${r.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(r.period_name)}</a></td>
      <td>${fmtDate(r.pay_period_start)} &ndash; ${fmtDate(r.pay_period_end)}</td>
      <td>${fmtMoney(r.total_gross)}</td>
      <td>${fmtMoney(r.total_net)}</td>
      <td>${r.employee_count || 0}</td>
      <td>${runBadge(r.status)}</td>
      <td>${fmtDateTime(r.created_at)}</td>
      <td><a href="/payroll/run/${r.id}" class="btn btn-sm btn-blue">View</a></td>
    </tr>`).join('');

    const deptHtml = deptSummary.map(d => `<div style="background:#f8fafc;padding:14px;border-radius:10px">
      <div style="font-weight:700;color:#1e293b;font-size:14px">${esc(d.department || 'Unassigned')}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px">${d.cnt} employee${d.cnt !== 1 ? 's' : ''}</div>
      <div style="font-size:16px;font-weight:800;color:#4f46e5;margin-top:4px">${fmtMoney(d.total_salary)}/mo</div>
    </div>`).join('');

    const html = PR_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/payroll')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💰 Payroll Management</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage employees, runs, and compensation</p></div>
        <div style="display:flex;gap:8px">
          <a href="/payroll/employees/new" class="btn btn-green">+ Add Employee</a>
          <a href="/payroll/run/new" class="btn btn-blue">🚀 New Payroll Run</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${stats.emp_count}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Active Employees</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(stats.total_paid)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Paid (All Time)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${fmtMoney(stats.this_month)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Paid This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${stats.pending_runs}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Pending Runs</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-top:20px">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="color:#1e293b;font-size:16px">Recent Payroll Runs</h3>
            <a href="/payroll/history" style="font-size:13px;color:#4f46e5;text-decoration:none">View All →</a>
          </div>
          <div style="overflow-x:auto"><table class="pr-tbl">
            <thead><tr><th>Period</th><th>Dates</th><th>Gross</th><th>Net</th><th>Emp</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>${runsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No payroll runs yet. <a href="/payroll/run/new" style="color:#4f46e5">Create your first run</a>.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Department Summary</h3>
          <div style="display:flex;flex-direction:column;gap:10px">${deptHtml || '<p class="muted" style="text-align:center;padding:20px">No departments yet.</p>'}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Payroll Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /payroll/employees — Employee List
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/employees', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, dept, status: fStatus } = req.query;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(employee_name ILIKE $${pi} OR email ILIKE $${pi} OR employee_id ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (dept) { where.push(`department=$${pi}`); params.push(dept); pi++; }
    if (fStatus) { where.push(`status=$${pi}`); params.push(fStatus); pi++; }

    const employees = (await pool.query(
      `SELECT * FROM payroll_employees WHERE ${where.join(' AND ')} ORDER BY employee_name LIMIT 200`, params
    )).rows;
    const departments = (await pool.query(
      'SELECT DISTINCT department FROM payroll_employees WHERE tenant_id=$1 AND department IS NOT NULL ORDER BY department', [tid]
    )).rows;

    const rowsHtml = employees.map(e => `<tr>
      <td><a href="/payroll/employees/${e.id}/edit" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(e.employee_name)}</a></td>
      <td style="font-family:monospace;font-size:12px;color:#64748b">${esc(e.employee_id || '\u2014')}</td>
      <td>${esc(e.department || '\u2014')}</td>
      <td>${esc(e.position || '\u2014')}</td>
      <td>${esc(e.email || '\u2014')}</td>
      <td style="font-weight:600;color:#1e293b">${fmtMoney(e.base_salary)}</td>
      <td>${empBadge(e.status)}</td>
      <td>
        <a href="/payroll/employees/${e.id}/edit" class="btn btn-sm btn-gold">Edit</a>
        <button onclick="confirmDelete(${e.id},'${esc(e.employee_name)}')" class="btn btn-sm btn-red">Delete</button>
      </td>
    </tr>`).join('');

    const html = PR_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/payroll/employees')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">👥 Payroll Employees</h1>
        <a href="/payroll/employees/new" class="btn btn-green">+ Add Employee</a>
      </div>
      <div class="card">
        <form method="GET" action="/payroll/employees" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Search</label>
            <input type="text" name="q" value="${esc(q || '')}" placeholder="Name, email, ID..." style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Department</label>
            <select name="dept" style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="">All</option>${departments.map(d => `<option value="${esc(d.department)}" ${dept === d.department ? 'selected' : ''}>${esc(d.department)}</option>`).join('')}</select></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="">All</option><option value="active" ${fStatus === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${fStatus === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
          <button type="submit" class="btn btn-sm btn-blue">Search</button>
        </form>
        <div style="overflow-x:auto"><table class="pr-tbl">
          <thead><tr><th>Name</th><th>Emp ID</th><th>Department</th><th>Position</th><th>Email</th><th>Base Salary</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No employees found. <a href="/payroll/employees/new" style="color:#4f46e5">Add your first employee</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
    <script>
    function confirmDelete(id, name) {
      if (confirm('Delete employee "' + name + '"? This cannot be undone.')) {
        fetch('/payroll/employees/' + id, { method: 'DELETE' }).then(r => r.json()).then(d => {
          if (d.ok) location.reload(); else alert(d.error || 'Delete failed');
        });
      }
    }</script>`;
    res.send(renderPage('Payroll Employees', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: GET /payroll/employees/new — Add Employee Form
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/employees/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = PR_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/payroll/employees')}
      <a href="/payroll/employees" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Employees</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">👤 Add New Employee</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Add an employee to the payroll system</p>
        <form method="POST" action="/payroll/employees/create" class="form-grid">
          ${empField('Full Name *', 'employee_name', 'text', '', { required: true, placeholder: 'John Doe' })}
          ${empField('Employee ID', 'employee_id', 'text', '', { placeholder: 'EMP-001' })}
          ${empField('Email', 'email', 'email', '', { placeholder: 'john@company.com' })}
          ${empField('Phone', 'phone', 'tel', '', { placeholder: '+1 555 0123' })}
          ${empField('Department', 'department', 'text', '', { placeholder: 'Engineering' })}
          ${empField('Position', 'position', 'text', '', { placeholder: 'Software Engineer' })}
          ${empField('Base Salary (Monthly) *', 'base_salary', 'number', '0', { required: true })}
          ${empField('Start Date', 'start_date', 'date', '')}
          ${empField('Bank Name', 'bank_name', 'text', '', { placeholder: 'National Bank' })}
          ${empField('Bank Account', 'bank_account', 'text', '', { placeholder: '****1234' })}
          ${empField('Tax ID', 'tax_id', 'text', '', { placeholder: 'TIN-12345' })}
          ${empField('NSSF Number', 'nssf_number', 'text', '', { placeholder: 'NSSF-67890' })}
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Save Employee</button>
            <a href="/payroll/employees" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Employee', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /payroll/employees/create
  // ════════════════════════════════════════════════════════════
  app.post('/payroll/employees/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { employee_name, employee_id, email, phone, department, position,
      base_salary, bank_name, bank_account, tax_id, nssf_number, start_date } = req.body;
    if (!employee_name || !employee_name.trim()) {
      return res.send('<div class="alert">Employee name is required.</div><a href="/payroll/employees/new" class="btn btn-blue">Back</a>');
    }
    await pool.query(
      `INSERT INTO payroll_employees (tenant_id, employee_name, employee_id, email, phone, department,
        position, base_salary, bank_name, bank_account, tax_id, nssf_number, start_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')`,
      [tid, employee_name.trim(), (employee_id || '').trim() || null,
        (email || '').trim() || null, (phone || '').trim() || null,
        (department || '').trim() || null, (position || '').trim() || null,
        parseFloat(base_salary) || 0, (bank_name || '').trim() || null,
        (bank_account || '').trim() || null, (tax_id || '').trim() || null,
        (nssf_number || '').trim() || null, start_date || null]
    );
    res.redirect('/payroll/employees');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /payroll/employees/:id/edit — Edit Employee
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/employees/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const emp = (await pool.query('SELECT * FROM payroll_employees WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!emp) return res.send('<div class="alert">Employee not found.</div><a href="/payroll/employees" class="btn btn-blue">Back</a>');

    const html = PR_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/payroll/employees')}
      <a href="/payroll/employees" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Employees</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:20px">✏️ Edit: ${esc(emp.employee_name)}</h2>
        <form method="POST" action="/payroll/employees/${id}/update" class="form-grid">
          ${empField('Full Name *', 'employee_name', 'text', emp.employee_name, { required: true })}
          ${empField('Employee ID', 'employee_id', 'text', emp.employee_id)}
          ${empField('Email', 'email', 'email', emp.email)}
          ${empField('Phone', 'phone', 'tel', emp.phone)}
          ${empField('Department', 'department', 'text', emp.department)}
          ${empField('Position', 'position', 'text', emp.position)}
          ${empField('Base Salary (Monthly)', 'base_salary', 'number', emp.base_salary)}
          ${empField('Start Date', 'start_date', 'date', emp.start_date)}
          ${empField('Bank Name', 'bank_name', 'text', emp.bank_name)}
          ${empField('Bank Account', 'bank_account', 'text', emp.bank_account)}
          ${empField('Tax ID', 'tax_id', 'text', emp.tax_id)}
          ${empField('NSSF Number', 'nssf_number', 'text', emp.nssf_number)}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="active" ${emp.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="inactive" ${emp.status === 'inactive' ? 'selected' : ''}>Inactive</option>
            </select></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Update Employee</button>
            <a href="/payroll/employees" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Employee: ' + emp.employee_name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /payroll/employees/:id/update
  // ════════════════════════════════════════════════════════════
  app.post('/payroll/employees/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { employee_name, employee_id, email, phone, department, position,
      base_salary, bank_name, bank_account, tax_id, nssf_number, start_date, status } = req.body;
    if (!employee_name || !employee_name.trim()) {
      return res.send('<div class="alert">Employee name is required.</div><a href="javascript:history.back()" class="btn btn-blue">Back</a>');
    }
    await pool.query(
      `UPDATE payroll_employees SET employee_name=$1, employee_id=$2, email=$3, phone=$4,
        department=$5, position=$6, base_salary=$7, bank_name=$8, bank_account=$9,
        tax_id=$10, nssf_number=$11, start_date=$12, status=$13
       WHERE id=$14 AND tenant_id=$15`,
      [employee_name.trim(), (employee_id || '').trim() || null,
        (email || '').trim() || null, (phone || '').trim() || null,
        (department || '').trim() || null, (position || '').trim() || null,
        parseFloat(base_salary) || 0, (bank_name || '').trim() || null,
        (bank_account || '').trim() || null, (tax_id || '').trim() || null,
        (nssf_number || '').trim() || null, start_date || null, status || 'active', id, tid]
    );
    res.redirect('/payroll/employees');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: DELETE /payroll/employees/:id
  // ════════════════════════════════════════════════════════════
  app.delete('/payroll/employees/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const emp = (await pool.query('SELECT id, employee_name FROM payroll_employees WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!emp) return res.json({ ok: false, error: 'Not found' });
    const hasRuns = (await pool.query('SELECT 1 FROM payroll_entries WHERE employee_id=$1 AND tenant_id=$2 LIMIT 1', [id, tid])).rows.length;
    if (hasRuns) return res.json({ ok: false, error: 'Cannot delete: employee has payroll entries' });
    await pool.query('DELETE FROM payroll_employees WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.json({ ok: true, message: 'Employee deleted' });
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: GET /payroll/run/new — New Payroll Run Wizard
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/run/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const activeEmps = (await pool.query(
      'SELECT * FROM payroll_employees WHERE tenant_id=$1 AND status=\'active\' ORDER BY department, employee_name', [tid]
    )).rows;

    const now = new Date();
    const periodName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' Payroll';
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const empsHtml = activeEmps.map((e, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:13px">
        <input type="checkbox" name="emp_ids" value="${e.id}" checked style="width:18px;height:18px;accent-color:#4f46e5">
        <div style="flex:1">
          <strong style="color:#1e293b">${esc(e.employee_name)}</strong>
          <span class="muted" style="margin-left:8px">${esc(e.department || '')} &middot; ${esc(e.position || '')}</span>
        </div>
        <div style="font-weight:700;color:#4f46e5">${fmtMoney(e.base_salary)}</div>
      </label>`).join('');

    const totalBase = activeEmps.reduce((s, e) => s + Number(e.base_salary || 0), 0);

    const html = PR_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${nav('/payroll/run/new')}
      <a href="/payroll" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">🚀 New Payroll Run</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a new payroll run for the selected period</p>
        <form method="POST" action="/payroll/run/create" class="form-grid">
          ${empField('Period Name *', 'period_name', 'text', periodName, { required: true })}
          ${empField('Period Start', 'pay_period_start', 'date', startDate)}
          ${empField('Period End', 'pay_period_end', 'date', endDate)}
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Optional notes for this payroll run..."></textarea></div>
          <div class="full">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <h3 style="color:#1e293b;font-size:15px">Select Employees (${activeEmps.length} active)</h3>
              <div style="font-size:14px;font-weight:700;color:#4f46e5">Total Base: ${fmtMoney(totalBase)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">${empsHtml || '<p class="muted" style="text-align:center;padding:20px">No active employees. <a href="/payroll/employees/new" style="color:#4f46e5">Add employees first</a>.</p>'}</div>
          </div>
          <div class="full" style="display:flex;gap:10px;margin-top:16px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px" ${activeEmps.length === 0 ? 'disabled' : ''}>💰 Create Payroll Run</button>
            <a href="/payroll" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Payroll Run', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /payroll/run/create — Create Payroll Run
  // ════════════════════════════════════════════════════════════
  app.post('/payroll/run/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { period_name, pay_period_start, pay_period_end, notes, emp_ids } = req.body;
    if (!period_name || !period_name.trim()) {
      return res.send('<div class="alert">Period name is required.</div><a href="/payroll/run/new" class="btn btn-blue">Back</a>');
    }
    const ids = Array.isArray(emp_ids) ? emp_ids.map(Number).filter(Boolean) : (emp_ids ? [Number(emp_ids)] : []);
    if (ids.length === 0) {
      return res.send('<div class="alert">Select at least one employee.</div><a href="/payroll/run/new" class="btn btn-blue">Back</a>');
    }
    const emps = (await pool.query(
      'SELECT * FROM payroll_employees WHERE tenant_id=$1 AND id = ANY($2) AND status=\'active\'', [tid, ids]
    )).rows;

    const runResult = await pool.query(
      `INSERT INTO payroll_runs (tenant_id, period_name, pay_period_start, pay_period_end, total_gross, total_deductions, total_net, employee_count, status, notes)
       VALUES ($1,$2,$3,$4,0,0,0,$5,'draft',$6) RETURNING id`,
      [tid, period_name.trim(), pay_period_start || null, pay_period_end || null, emps.length, (notes || '').trim() || null]
    );
    const runId = runResult.rows[0].id;

    for (const emp of emps) {
      const gross = Number(emp.base_salary || 0);
      const tax = Math.round(gross * 0.30 * 100) / 100;       // 30% PAYE
      const nssf = Math.round(gross * 0.05 * 100) / 100;       // 5% NSSF
      const deductions = tax + nssf;
      const net = Math.round((gross - deductions) * 100) / 100;
      await pool.query(
        `INSERT INTO payroll_entries (tenant_id, run_id, employee_id, gross_pay, overtime, bonus,
          tax, nssf, other_deductions, net_pay, status)
         VALUES ($1,$2,$3,$4,0,0,$5,$6,0,$7,'pending')`,
        [tid, runId, emp.id, gross, tax, nssf, net]
      );
    }

    // Recalculate totals
    const totals = (await pool.query(
      'SELECT COALESCE(SUM(gross_pay),0) as tg, COALESCE(SUM(tax + nssf + other_deductions),0) as td, COALESCE(SUM(net_pay),0) as tn FROM payroll_entries WHERE run_id=$1 AND tenant_id=$2',
      [runId, tid]
    )).rows[0];
    await pool.query(
      'UPDATE payroll_runs SET total_gross=$1, total_deductions=$2, total_net=$3 WHERE id=$4 AND tenant_id=$5',
      [totals.tg, totals.td, totals.tn, runId, tid]
    );

    res.redirect('/payroll/run/' + runId);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /payroll/run/:id — Payroll Run Detail
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/run/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const run = (await pool.query(
      'SELECT pr.*, u.name as processor_name FROM payroll_runs pr LEFT JOIN users u ON u.id=pr.processed_by WHERE pr.id=$1 AND pr.tenant_id=$2',
      [id, tid]
    )).rows[0];
    if (!run) return res.send('<div class="alert">Payroll run not found.</div><a href="/payroll" class="btn btn-blue">Back</a>');

    const entries = (await pool.query(
      `SELECT pe.*, e.employee_name, e.department, e.position, e.employee_id, e.email, e.bank_name, e.bank_account
       FROM payroll_entries pe JOIN payroll_employees e ON e.id = pe.employee_id
       WHERE pe.run_id=$1 AND pe.tenant_id=$2 ORDER BY e.employee_name`, [id, tid]
    )).rows;

    const isLocked = run.status === 'paid' || run.status === 'cancelled';

    const entryRows = entries.map(e => `<tr>
      <td style="font-weight:600">${esc(e.employee_name)}</td>
      <td class="muted">${esc(e.employee_id || '\u2014')}</td>
      <td class="muted">${esc(e.department || '\u2014')}</td>
      <td>
        <form method="POST" action="/payroll/run/${id}/entry/${e.id}" class="entry-form">
          <input type="hidden" name="employee_id" value="${e.employee_id}">
          <input type="number" step="0.01" name="gross_pay" value="${e.gross_pay}" title="Gross" ${isLocked ? 'disabled' : ''}>
          <input type="number" step="0.01" name="overtime" value="${e.overtime}" title="Overtime" ${isLocked ? 'disabled' : ''}>
          <input type="number" step="0.01" name="bonus" value="${e.bonus}" title="Bonus" ${isLocked ? 'disabled' : ''}>
          <input type="number" step="0.01" name="tax" value="${e.tax}" title="Tax" ${isLocked ? 'disabled' : ''}>
          <input type="number" step="0.01" name="nssf" value="${e.nssf}" title="NSSF" ${isLocked ? 'disabled' : ''}>
          <input type="number" step="0.01" name="other_deductions" value="${e.other_deductions}" title="Other Ded" ${isLocked ? 'disabled' : ''}>
          ${isLocked ? '' : '<button type="submit" class="btn btn-sm btn-blue" title="Save">&#10003;</button>'}
        </form>
      </td>
      <td style="font-weight:700;color:#059669">${fmtMoney(e.net_pay)}</td>
      <td><span class="badge" style="background:${e.status === 'paid' ? '#dcfce7;color:#16a34a' : '#fef3c7;color:#b45309'}">${e.status}</span></td>
    </tr>`).join('');

    const html = PR_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/payroll')}
      <a href="/payroll" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">${esc(run.period_name)}</h1>
          <p class="muted" style="font-size:13px;margin-top:2px">${fmtDate(run.pay_period_start)} &ndash; ${fmtDate(run.pay_period_end)} &middot; ${run.employee_count} employees &middot; ${runBadge(run.status)}</p>
        </div>
        <div style="display:flex;gap:8px">
          ${run.status === 'draft' ? `<form method="POST" action="/payroll/run/${id}/process" onsubmit="return confirm('Process this payroll run? Entries will be marked as paid.')">
            <button type="submit" class="btn btn-green">✅ Process &amp; Pay</button></form>` : ''}
          <a href="/payroll/run/${id}/payslips" class="btn btn-blue">📄 View Payslips</a>
        </div>
      </div>
      <div class="stats" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#1e293b">${fmtMoney(run.total_gross)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Gross</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fmtMoney(run.total_deductions)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Deductions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(run.total_net)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Net Pay</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${run.employee_count}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Employees</div></div>
      </div>
      ${run.notes ? `<div class="alert" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;margin-bottom:16px;padding:12px 16px;border-radius:10px;font-size:13px"><strong>Notes:</strong> ${esc(run.notes)}</div>` : ''}
      <div class="card">
        <h3 style="color:#1e293b;margin-bottom:14px">Payroll Entries</h3>
        <div style="overflow-x:auto"><table class="pr-tbl">
          <thead><tr><th>Employee</th><th>ID</th><th>Dept</th><th>
            <div style="display:flex;gap:2px;font-size:10px;white-space:nowrap">
              <span style="width:90px;display:inline-block;text-align:center">Gross</span>
              <span style="width:90px;display:inline-block;text-align:center">OT</span>
              <span style="width:90px;display:inline-block;text-align:center">Bonus</span>
              <span style="width:90px;display:inline-block;text-align:center">Tax</span>
              <span style="width:90px;display:inline-block;text-align:center">NSSF</span>
              <span style="width:90px;display:inline-block;text-align:center">Other</span>
              <span style="width:30px"></span>
            </div>
          </th><th>Net Pay</th><th>Status</th></tr></thead>
          <tbody>${entryRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No entries.</td></tr>'}</tbody>
        </table></div>
      </div>
      ${run.processed_at ? `<p class="muted" style="margin-top:12px;font-size:12px">Processed by ${esc(run.processor_name || 'Unknown')} on ${fmtDateTime(run.processed_at)}</p>` : ''}
    </div>`;
    res.send(renderPage('Payroll Run: ' + run.period_name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: POST /payroll/run/:id/entry/:eid — Update Entry
  // ════════════════════════════════════════════════════════════
  app.post('/payroll/run/:id/entry/:eid', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const runId = req.params.id, eid = req.params.eid;
    const run = (await pool.query('SELECT status FROM payroll_runs WHERE id=$1 AND tenant_id=$2', [runId, tid])).rows[0];
    if (!run) return res.send('<div class="alert">Run not found.</div>');
    if (run.status === 'paid' || run.status === 'cancelled') return res.send('<div class="alert">Cannot edit: run is ' + esc(run.status) + '.</div>');

    const gross = parseFloat(req.body.gross_pay) || 0;
    const overtime = parseFloat(req.body.overtime) || 0;
    const bonus = parseFloat(req.body.bonus) || 0;
    const tax = parseFloat(req.body.tax) || 0;
    const nssf = parseFloat(req.body.nssf) || 0;
    const otherDed = parseFloat(req.body.other_deductions) || 0;
    const net = Math.round((gross + overtime + bonus - tax - nssf - otherDed) * 100) / 100;

    await pool.query(
      `UPDATE payroll_entries SET gross_pay=$1, overtime=$2, bonus=$3, tax=$4, nssf=$5,
        other_deductions=$6, net_pay=$7 WHERE id=$8 AND run_id=$9 AND tenant_id=$10`,
      [gross, overtime, bonus, tax, nssf, otherDed, net, eid, runId, tid]
    );

    // Recalculate run totals
    const totals = (await pool.query(
      'SELECT COALESCE(SUM(gross_pay + overtime + bonus),0) as tg, COALESCE(SUM(tax + nssf + other_deductions),0) as td, COALESCE(SUM(net_pay),0) as tn FROM payroll_entries WHERE run_id=$1 AND tenant_id=$2',
      [runId, tid]
    )).rows[0];
    await pool.query(
      'UPDATE payroll_runs SET total_gross=$1, total_deductions=$2, total_net=$3 WHERE id=$4 AND tenant_id=$5',
      [totals.tg, totals.td, totals.tn, runId, tid]
    );

    res.redirect('/payroll/run/' + runId);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: POST /payroll/run/:id/process — Process Run
  // ════════════════════════════════════════════════════════════
  app.post('/payroll/run/:id/process', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const run = (await pool.query('SELECT * FROM payroll_runs WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!run) return res.send('<div class="alert">Run not found.</div>');
    if (run.status !== 'draft') return res.send('<div class="alert">Only draft runs can be processed.</div>');

    await pool.query(
      'UPDATE payroll_entries SET status=\'paid\' WHERE run_id=$1 AND tenant_id=$2',
      [id, tid]
    );
    await pool.query(
      `UPDATE payroll_runs SET status='paid', processed_by=$1, processed_at=NOW() WHERE id=$2 AND tenant_id=$3`,
      [user.id, id, tid]
    );
    res.redirect('/payroll/run/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: GET /payroll/run/:id/payslips — Payslips View
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/run/:id/payslips', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const run = (await pool.query('SELECT * FROM payroll_runs WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!run) return res.send('<div class="alert">Run not found.</div><a href="/payroll" class="btn btn-blue">Back</a>');

    const entries = (await pool.query(
      `SELECT pe.*, e.employee_name, e.employee_id, e.department, e.position, e.email,
        e.bank_name, e.bank_account, e.tax_id, e.nssf_number, e.base_salary
       FROM payroll_entries pe JOIN payroll_employees e ON e.id = pe.employee_id
       WHERE pe.run_id=$1 AND pe.tenant_id=$2 ORDER BY e.employee_name`, [id, tid]
    )).rows;

    const payslipsHtml = entries.map(e => `
      <div class="payslip">
        <div class="payslip-header">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:18px;font-weight:800">${esc(e.employee_name)}</div>
              <div style="font-size:12px;opacity:0.85;margin-top:2px">${esc(e.position || '')} &middot; ${esc(e.department || '')}</div></div>
            <div style="text-align:right"><div style="font-size:11px;opacity:0.8">PAYSLIP</div>
              <div style="font-size:13px;font-weight:600">${esc(run.period_name)}</div>
              <div style="font-size:11px;opacity:0.8">${fmtDate(run.pay_period_start)} &ndash; ${fmtDate(run.pay_period_end)}</div></div>
          </div>
        </div>
        <div class="payslip-body">
          <div class="payslip-section"><h4>Employee Information</h4>
            <div class="payslip-row"><span class="label">Employee ID</span><span class="value">${esc(e.employee_id || '\u2014')}</span></div>
            <div class="payslip-row"><span class="label">Email</span><span class="value">${esc(e.email || '\u2014')}</span></div>
            <div class="payslip-row"><span class="label">Tax ID</span><span class="value">${esc(e.tax_id || '\u2014')}</span></div>
            <div class="payslip-row"><span class="label">NSSF</span><span class="value">${esc(e.nssf_number || '\u2014')}</span></div>
          </div>
          <div class="payslip-section"><h4>Earnings</h4>
            <div class="payslip-row"><span class="label">Base Salary</span><span class="value">${fmtMoney(e.base_salary)}</span></div>
            <div class="payslip-row"><span class="label">Gross Pay</span><span class="value">${fmtMoney(e.gross_pay)}</span></div>
            <div class="payslip-row"><span class="label">Overtime</span><span class="value">${fmtMoney(e.overtime)}</span></div>
            <div class="payslip-row"><span class="label">Bonus</span><span class="value">${fmtMoney(e.bonus)}</span></div>
          </div>
          <div class="payslip-section"><h4>Deductions</h4>
            <div class="payslip-row"><span class="label">Tax (PAYE)</span><span class="value" style="color:#dc2626">-${fmtMoney(e.tax)}</span></div>
            <div class="payslip-row"><span class="label">NSSF</span><span class="value" style="color:#dc2626">-${fmtMoney(e.nssf)}</span></div>
            <div class="payslip-row"><span class="label">Other Deductions</span><span class="value" style="color:#dc2626">-${fmtMoney(e.other_deductions)}</span></div>
          </div>
          <div class="payslip-total"><span class="label" style="font-weight:800;color:#1e293b">NET PAY</span><span class="value">${fmtMoney(e.net_pay)}</span></div>
          ${e.bank_name ? `<div style="margin-top:12px;padding:10px;background:#f8fafc;border-radius:8px;font-size:12px;color:#64748b">
            <strong>Payment:</strong> ${esc(e.bank_name)} &middot; ${esc(e.bank_account || '\u2014')} &middot; ${esc(e.payment_method || 'bank_transfer')}</div>` : ''}
        </div>
      </div>`).join('');

    const html = PR_CSS + `
    <div style="max-width:750px;margin:0 auto">
      ${nav('/payroll')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <a href="/payroll/run/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:4px">\u2190 Back to Run</a>
          <h1 style="font-size:24px;color:#1e293b">📄 Payslips — ${esc(run.period_name)}</h1>
          <p class="muted" style="font-size:13px">${run.employee_count} employees &middot; ${runBadge(run.status)}</p>
        </div>
        <button onclick="window.print()" class="btn btn-blue">🖨️ Print Payslips</button>
      </div>
      ${payslipsHtml || '<div class="card"><p class="muted" style="text-align:center;padding:40px">No entries in this payroll run.</p></div>'}
    </div>`;
    res.send(renderPage('Payslips: ' + run.period_name, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /payroll/history — Payroll History
  // ════════════════════════════════════════════════════════════
  app.get('/payroll/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { period, status: fStatus } = req.query;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (fStatus) { where.push(`status=$${pi}`); params.push(fStatus); pi++; }
    if (period) { where.push(`period_name ILIKE $${pi}`); params.push('%' + period + '%'); pi++; }

    const runs = (await pool.query(
      `SELECT pr.*, u.name as processor_name FROM payroll_runs pr
        LEFT JOIN users u ON u.id = pr.processed_by
       WHERE ${where.join(' AND ')} ORDER BY pr.created_at DESC LIMIT 100`, params
    )).rows;

    const grandGross = runs.reduce((s, r) => s + Number(r.total_gross || 0), 0);
    const grandNet = runs.reduce((s, r) => s + Number(r.total_net || 0), 0);
    const paidCount = runs.filter(r => r.status === 'paid').length;

    const rowsHtml = runs.map(r => `<tr>
      <td><a href="/payroll/run/${r.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(r.period_name)}</a></td>
      <td>${fmtDate(r.pay_period_start)} &ndash; ${fmtDate(r.pay_period_end)}</td>
      <td>${r.employee_count || 0}</td>
      <td>${fmtMoney(r.total_gross)}</td>
      <td>${fmtMoney(r.total_deductions)}</td>
      <td style="font-weight:700;color:#059669">${fmtMoney(r.total_net)}</td>
      <td>${runBadge(r.status)}</td>
      <td class="muted">${fmtDateTime(r.processed_at)}</td>
      <td><a href="/payroll/run/${r.id}" class="btn btn-sm btn-blue">View</a>
        <a href="/payroll/run/${r.id}/payslips" class="btn btn-sm btn-gold">Payslips</a></td>
    </tr>`).join('');

    const html = PR_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/payroll/history')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📊 Payroll History</h1>
      <div class="card">
        <form method="GET" action="/payroll/history" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Period</label>
            <input type="text" name="period" value="${esc(period || '')}" placeholder="Search period..." style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="">All</option><option value="draft" ${fStatus === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="processing" ${fStatus === 'processing' ? 'selected' : ''}>Processing</option>
              <option value="paid" ${fStatus === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="cancelled" ${fStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></div>
          <button type="submit" class="btn btn-sm btn-blue">Filter</button>
          <a href="/payroll/history" class="btn btn-sm" style="background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px;padding:9px 14px">Clear</a>
        </form>
        <div class="stats" style="margin-bottom:16px">
          <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${runs.length}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Runs</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#059669">${paidCount}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Paid Runs</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#1e293b">${fmtMoney(grandGross)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Gross</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#0891b2">${fmtMoney(grandNet)}</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Net</div></div>
        </div>
        <div style="overflow-x:auto"><table class="pr-tbl">
          <thead><tr><th>Period</th><th>Dates</th><th>Emp</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th><th>Processed</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No payroll history found.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Payroll History', html, user, req));
  }));

  console.log('[Payroll] Payroll management loaded');
};
