// ============================================================
// REPORTS & EXPORT CENTER MODULE — SSEWASSWA Comfort Platform
// Comprehensive reporting with financial, academic, HR, sales,
// attendance reports. CSV/HTML generation, saved configs,
// custom report builder, and export tracking.
// ============================================================
// Usage in server.js:
//   const reportsCenter = require('./reports-center');
//   reportsCenter(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatCurrency = (amt) => 'UGX ' + Number(amt || 0).toLocaleString();
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const formatSize = (b) => { if (!b) return '0 B'; const u = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(i>0?1:0)+' '+u[i]; };

function generateCSV(headers, rows) {
  const lines = [headers.map(h => '"' + String(h).replace(/"/g, '""') + '"').join(',')];
  rows.forEach(row => {
    lines.push(headers.map(h => {
      const v = row[h] !== null && row[h] !== undefined ? String(row[h]) : '';
      return '"' + v.replace(/"/g, '""') + '"';
    }).join(','));
  });
  return lines.join('\r\n');
}

function htmlTable(headers, rows, opts = {}) {
  if (!rows || rows.length === 0) return '<p style="color:#94a3b8;padding:20px;text-align:center">No data found for the selected criteria.</p>';
  let html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">';
  html += '<thead><tr>' + headers.map(h => '<th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.3px;background:#f8fafc">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>';
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
    html += '<tr style="background:' + bg + '">' + headers.map(h => {
      let val = row[h];
      if (opts.currencyFields && opts.currencyFields.includes(h)) val = formatCurrency(val);
      else if (opts.dateFields && opts.dateFields.includes(h)) val = formatDate(val);
      else if (opts.pctFields && opts.pctFields.includes(h)) val = val !== null ? Number(val).toFixed(1) + '%' : '-';
      else val = esc(val !== null && val !== undefined ? String(val) : '-');
      return '<td style="padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b">' + val + '</td>';
    }).join('') + '</tr>';
  });
  html += '</tbody>';
  if (opts.totalsRow) {
    html += '<tfoot><tr style="background:#eef2ff;font-weight:700">' + headers.map(h => {
      if (opts.totalsRow[h] !== undefined) {
        const v = opts.currencyFields && opts.currencyFields.includes(h) ? formatCurrency(opts.totalsRow[h]) : esc(String(opts.totalsRow[h]));
        return '<td style="padding:10px 14px;border-top:2px solid #c7d2fe;color:#1e293b">' + v + '</td>';
      }
      return '<td style="padding:10px 14px;border-top:2px solid #c7d2fe"></td>';
    }).join('') + '</tr></tfoot>';
  }
  html += '</table></div>';
  return html;
}

function renderReportPage(title, content, user) {
  return renderPage(title, content, user);
}

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function reportsCenter(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS saved_reports (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(500) NOT NULL, report_type VARCHAR(100) NOT NULL,
      description TEXT, query_config JSONB DEFAULT '{}',
      format VARCHAR(10) DEFAULT 'csv', created_by VARCHAR(255) NOT NULL,
      is_scheduled BOOLEAN DEFAULT false, schedule_frequency VARCHAR(50),
      last_generated TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS report_exports (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      report_id INTEGER REFERENCES saved_reports(id) ON DELETE SET NULL,
      file_url TEXT, file_name VARCHAR(500) NOT NULL, file_size INTEGER DEFAULT 0,
      format VARCHAR(10) NOT NULL, generated_by VARCHAR(255) NOT NULL,
      record_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_saved_reports_tenant ON saved_reports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_saved_reports_type ON saved_reports(report_type)`,
    `CREATE INDEX IF NOT EXISTS idx_report_exports_tenant ON report_exports(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_report_exports_report ON report_exports(report_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { logger.warn('[ReportsCenter] Cannot connect to DB'); return; }
    try { for (const sql of migrations) await client.query(sql); logger.info({ msg: '[ReportsCenter] Migrations applied', count: migrations.length }); }
    catch (e) { logger.error({ msg: '[ReportsCenter] Migration error', error: e.message }); }
    finally { client.release(); }
  })();

  // ============================================================
  // REPORT TEMPLATE DEFINITIONS
  // ============================================================
  const REPORT_CATEGORIES = {
    financial: { label: 'Financial', icon: '💰', color: '#059669', reports: [
      { key: 'income_statement', name: 'Income Statement', desc: 'Revenue vs expenses summary' },
      { key: 'balance_sheet', name: 'Balance Sheet', desc: 'Assets, liabilities, and equity' },
      { key: 'cash_flow', name: 'Cash Flow', desc: 'Cash inflows and outflows' },
      { key: 'fee_collection', name: 'Fee Collection Summary', desc: 'Fees collected by class/term' },
      { key: 'expense_breakdown', name: 'Expense Breakdown', desc: 'Expenses by category' },
      { key: 'tax_summary', name: 'Tax Summary', desc: 'Taxable income and deductions' }
    ]},
    academic: { label: 'Academic', icon: '🎓', color: '#4f46e5', reports: [
      { key: 'enrollment_summary', name: 'Enrollment Summary', desc: 'Students per class and stream' },
      { key: 'attendance_report', name: 'Attendance Report', desc: 'Attendance statistics' },
      { key: 'fee_arrears', name: 'Fee Arrears', desc: 'Outstanding fee balances' },
      { key: 'performance_subject', name: 'Performance by Subject', desc: 'Average marks per subject' },
      { key: 'class_ranking', name: 'Class Ranking', desc: 'Top students by performance' },
      { key: 'demographics', name: 'Demographics', desc: 'Student age/gender distribution' }
    ]},
    hr: { label: 'HR', icon: '👥', color: '#7c3aed', reports: [
      { key: 'staff_list', name: 'Staff List', desc: 'All employees directory' },
      { key: 'leave_summary', name: 'Leave Summary', desc: 'Leave balances and usage' },
      { key: 'payroll_summary', name: 'Payroll Summary', desc: 'Salary disbursements' },
      { key: 'department_headcount', name: 'Department Headcount', desc: 'Staff per department' },
      { key: 'birthday_list', name: 'Birthday List', desc: 'Upcoming staff birthdays' },
      { key: 'contract_expiry', name: 'Contract Expiry', desc: 'Expiring contracts this month' }
    ]},
    sales: { label: 'Sales', icon: '🛒', color: '#ea580c', reports: [
      { key: 'daily_sales', name: 'Daily Sales', desc: 'Sales per day breakdown' },
      { key: 'product_performance', name: 'Product Performance', desc: 'Best/worst selling products' },
      { key: 'revenue_category', name: 'Revenue by Category', desc: 'Income per product category' },
      { key: 'customer_analysis', name: 'Customer Analysis', desc: 'Customer spending patterns' },
      { key: 'stock_movement', name: 'Stock Movement', desc: 'Inventory changes over time' },
      { key: 'profit_loss', name: 'Profit & Loss', desc: 'Revenue minus costs' }
    ]},
    attendance: { label: 'Attendance', icon: '📋', color: '#0891b2', reports: [
      { key: 'daily_attendance', name: 'Daily Attendance', desc: 'Who was present/absent today' },
      { key: 'monthly_summary', name: 'Monthly Summary', desc: 'Attendance rates per class' },
      { key: 'class_trend', name: 'Class Attendance Trend', desc: 'Weekly attendance trends' },
      { key: 'individual_student', name: 'Individual Student', desc: 'Single student attendance log' },
      { key: 'latecomers', name: 'Latecomers List', desc: 'Frequently late students' }
    ]}
  };

  // Shared CSS
  const RC_CSS = `<style>
.rc-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.rc-tab{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;border:2px solid transparent;transition:.15s}
.rc-tab:hover{background:#e2e8f0}
.rc-tab.active{color:#fff;border-color:transparent}
.rc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.rc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s;cursor:pointer}
.rc-card:hover{border-color:#c7d2fe;box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
.rc-card-icon{font-size:28px;margin-bottom:10px}
.rc-card-title{font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px}
.rc-card-desc{font-size:12px;color:#94a3b8;line-height:1.4}
.rc-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.rc-filter label{font-size:12px;font-weight:600;color:#64748b}
.rc-filter input,.rc-filter select{padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.rc-filter input:focus,.rc-filter select:focus{outline:none;border-color:#6366f1}
.rc-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.rc-btn:hover{opacity:.9}
.rc-btn-primary{background:#4f46e5;color:#fff}
.rc-btn-secondary{background:#f1f5f9;color:#475569}
.rc-btn-success{background:#059669;color:#fff}
.rc-btn-danger{background:#fee2e2;color:#dc2626}
.rc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.rc-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center}
.rc-stat-val{font-size:24px;font-weight:800;color:#1e293b}
.rc-stat-lbl{font-size:11px;color:#94a3b8;margin-top:2px}
.rc-empty{text-align:center;padding:60px 20px;color:#94a3b8}
.rc-empty-icon{font-size:48px;margin-bottom:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:9px 14px;text-align:left;border-bottom:1px solid #f1f5f9}
th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
.rc-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
@media(max-width:768px){.rc-grid{grid-template-columns:1fr}.rc-tabs{gap:4px}.rc-tab{padding:6px 12px;font-size:12px}}
</style>`;

  // ============================================================
  // ROUTE 1: GET /reports — Reports Dashboard
  // ============================================================
  app.get('/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const recentExports = (await pool.query(
      `SELECT re.*, sr.name as report_name FROM report_exports re LEFT JOIN saved_reports sr ON sr.id=re.report_id WHERE re.tenant_id=$1 ORDER BY re.created_at DESC LIMIT 10`, [tid]
    )).rows;
    const totalExports = (await pool.query('SELECT COUNT(*) as cnt FROM report_exports WHERE tenant_id=$1', [tid])).rows[0].cnt;
    const savedCount = (await pool.query('SELECT COUNT(*) as cnt FROM saved_reports WHERE tenant_id=$1', [tid])).rows[0].cnt;
    const thisMonth = (await pool.query("SELECT COUNT(*) as cnt FROM report_exports WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())", [tid])).rows[0].cnt;

    const tabsHtml = Object.entries(REPORT_CATEGORIES).map(([key, cat]) =>
      `<a href="/reports/${key}" class="rc-tab" style="background:${cat.color}">${cat.icon} ${cat.label}</a>`
    ).join('') + '<a href="/reports/custom" class="rc-tab" style="background:#64748b">🔧 Custom</a>' +
             '<a href="/reports/saved" class="rc-tab" style="background:#f59e0b;color:#fff">📁 Saved</a>';

    const allCards = Object.values(REPORT_CATEGORIES).flatMap(cat =>
      cat.reports.map(r => `<div class="rc-card" onclick="location.href='/reports/${r.key}?cat=${cat.label.toLowerCase()}'">
        <div class="rc-card-icon">${cat.icon}</div>
        <div class="rc-card-title">${esc(r.name)}</div>
        <div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:10px"><span class="rc-badge" style="background:${cat.color}18;color:${cat.color}">${esc(cat.label)}</span></div>
      </div>`)
    ).join('');

    const recentHtml = recentExports.length ? htmlTable(
      ['Report', 'Format', 'Records', 'Generated By', 'Date'],
      recentExports.map(r => ({ Report: r.report_name || 'Manual Export', Format: (r.format || 'csv').toUpperCase(), Records: r.record_count, 'Generated By': r.generated_by, Date: r.created_at })),
      { dateFields: ['Date'] }
    ) : '<p style="color:#94a3b8;text-align:center;padding:20px">No exports yet. Generate your first report above.</p>';

    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Reports & Export Center</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Generate, schedule, and export institutional reports</p></div>
        <div style="display:flex;gap:8px"><a href="/reports/custom" class="rc-btn rc-btn-primary">🔧 Custom Report</a><a href="/reports/saved" class="rc-btn rc-btn-secondary">📁 Saved Reports</a></div>
      </div>
      <div class="rc-stats">
        <div class="rc-stat"><div class="rc-stat-val" style="color:#4f46e5">${totalExports}</div><div class="rc-stat-lbl">Total Exports</div></div>
        <div class="rc-stat"><div class="rc-stat-val" style="color:#059669">${thisMonth}</div><div class="rc-stat-lbl">This Month</div></div>
        <div class="rc-stat"><div class="rc-stat-val" style="color:#f59e0b">${savedCount}</div><div class="rc-stat-lbl">Saved Configs</div></div>
        <div class="rc-stat"><div class="rc-stat-val" style="color:#7c3aed">${Object.values(REPORT_CATEGORIES).reduce((s,c) => s+c.reports.length, 0)}</div><div class="rc-stat-lbl">Report Templates</div></div>
      </div>
      <div class="rc-tabs">${tabsHtml}</div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">All Report Templates</h2>
      <div class="rc-grid">${allCards}</div>
      <h2 style="font-size:18px;color:#1e293b;margin:28px 0 14px">Recent Exports</h2>
      <div class="card">${recentHtml}</div>
    </div>`;
    res.send(renderReportPage('Reports Center', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /reports/financial — Financial Reports
  // ============================================================
  app.get('/reports/financial', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const reports = REPORT_CATEGORIES.financial.reports;
    const cardsHtml = reports.map(r => `
      <div class="rc-card">
        <div class="rc-card-icon">💰</div>
        <div class="rc-card-title">${esc(r.name)}</div>
        <div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="rc-badge" style="background:#d1fae5;color:#065f46">CSV</span>
          <span class="rc-badge" style="background:#dbeafe;color:#1e40af">HTML</span>
          <span class="rc-badge" style="background:#fef3c7;color:#92400e">Print</span>
        </div>
      </div>`).join('');

    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">💰 Financial Reports</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Income, expenses, fees, and tax reports</p>
      <div class="card" style="margin-bottom:20px">
        <h3 style="margin-bottom:12px">Generate Report</h3>
        <form method="GET" action="/reports/generate" class="rc-filter">
          <input type="hidden" name="report_type" value="fee_collection">
          <div><label>Report</label><select name="report_type" style="width:220px">${reports.map(r => '<option value="' + r.key + '">' + esc(r.name) + '</option>').join('')}</select></div>
          <div><label>From</label><input type="date" name="date_from"></div>
          <div><label>To</label><input type="date" name="date_to"></div>
          <div><label>Format</label><select name="format"><option value="html">HTML (Preview)</option><option value="csv">CSV Download</option></select></div>
          <button type="submit" class="rc-btn rc-btn-primary">📊 Generate</button>
        </form>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Available Reports</h2>
      <div class="rc-grid">${cardsHtml}</div>
    </div>`;
    res.send(renderReportPage('Financial Reports', html, user));
  }));

  // ============================================================
  // ROUTE 3: GET /reports/students — Student Reports
  // ============================================================
  app.get('/reports/students', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const reports = REPORT_CATEGORIES.academic.reports;
    const cardsHtml = reports.map(r => `
      <div class="rc-card">
        <div class="rc-card-icon">🎓</div>
        <div class="rc-card-title">${esc(r.name)}</div>
        <div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:12px;display:flex;gap:6px"><span class="rc-badge" style="background:#eef2ff;color:#4f46e5">CSV</span><span class="rc-badge" style="background:#dbeafe;color:#1e40af">HTML</span></div>
      </div>`).join('');
    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">🎓 Student Reports</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Enrollment, performance, attendance, and demographics</p>
      <div class="card" style="margin-bottom:20px">
        <h3 style="margin-bottom:12px">Generate Report</h3>
        <form method="GET" action="/reports/generate" class="rc-filter">
          <div><label>Report</label><select name="report_type" style="width:220px">${reports.map(r => '<option value="' + r.key + '">' + esc(r.name) + '</option>').join('')}</select></div>
          <div><label>From</label><input type="date" name="date_from"></div>
          <div><label>To</label><input type="date" name="date_to"></div>
          <div><label>Format</label><select name="format"><option value="html">HTML (Preview)</option><option value="csv">CSV Download</option></select></div>
          <button type="submit" class="rc-btn rc-btn-primary">📊 Generate</button>
        </form>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Available Reports</h2>
      <div class="rc-grid">${cardsHtml}</div>
    </div>`;
    res.send(renderReportPage('Student Reports', html, user));
  }));

  // ============================================================
  // ROUTE 4: GET /reports/hr — HR Reports
  // ============================================================
  app.get('/reports/hr', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const reports = REPORT_CATEGORIES.hr.reports;
    const cardsHtml = reports.map(r => `
      <div class="rc-card"><div class="rc-card-icon">👥</div><div class="rc-card-title">${esc(r.name)}</div><div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:12px;display:flex;gap:6px"><span class="rc-badge" style="background:#ede9fe;color:#7c3aed">CSV</span><span class="rc-badge" style="background:#dbeafe;color:#1e40af">HTML</span></div>
      </div>`).join('');
    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">👥 HR Reports</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Staff, payroll, leave, and HR analytics</p>
      <div class="card" style="margin-bottom:20px">
        <h3 style="margin-bottom:12px">Generate Report</h3>
        <form method="GET" action="/reports/generate" class="rc-filter">
          <div><label>Report</label><select name="report_type" style="width:220px">${reports.map(r => '<option value="' + r.key + '">' + esc(r.name) + '</option>').join('')}</select></div>
          <div><label>From</label><input type="date" name="date_from"></div>
          <div><label>To</label><input type="date" name="date_to"></div>
          <div><label>Format</label><select name="format"><option value="html">HTML (Preview)</option><option value="csv">CSV Download</option></select></div>
          <button type="submit" class="rc-btn rc-btn-primary">📊 Generate</button>
        </form>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Available Reports</h2>
      <div class="rc-grid">${cardsHtml}</div>
    </div>`;
    res.send(renderReportPage('HR Reports', html, user));
  }));

  // ============================================================
  // ROUTE 5: GET /reports/sales — Sales Reports
  // ============================================================
  app.get('/reports/sales', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const reports = REPORT_CATEGORIES.sales.reports;
    const cardsHtml = reports.map(r => `
      <div class="rc-card"><div class="rc-card-icon">🛒</div><div class="rc-card-title">${esc(r.name)}</div><div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:12px;display:flex;gap:6px"><span class="rc-badge" style="background:#fff7ed;color:#ea580c">CSV</span><span class="rc-badge" style="background:#dbeafe;color:#1e40af">HTML</span></div>
      </div>`).join('');
    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">🛒 Sales Reports</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Revenue, products, customers, and profitability</p>
      <div class="card" style="margin-bottom:20px">
        <h3 style="margin-bottom:12px">Generate Report</h3>
        <form method="GET" action="/reports/generate" class="rc-filter">
          <div><label>Report</label><select name="report_type" style="width:220px">${reports.map(r => '<option value="' + r.key + '">' + esc(r.name) + '</option>').join('')}</select></div>
          <div><label>From</label><input type="date" name="date_from"></div>
          <div><label>To</label><input type="date" name="date_to"></div>
          <div><label>Format</label><select name="format"><option value="html">HTML (Preview)</option><option value="csv">CSV Download</option></select></div>
          <button type="submit" class="rc-btn rc-btn-primary">📊 Generate</button>
        </form>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Available Reports</h2>
      <div class="rc-grid">${cardsHtml}</div>
    </div>`;
    res.send(renderReportPage('Sales Reports', html, user));
  }));

  // ============================================================
  // ROUTE 6: GET /reports/attendance — Attendance Reports
  // ============================================================
  app.get('/reports/attendance', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const reports = REPORT_CATEGORIES.attendance.reports;
    const cardsHtml = reports.map(r => `
      <div class="rc-card"><div class="rc-card-icon">📋</div><div class="rc-card-title">${esc(r.name)}</div><div class="rc-card-desc">${esc(r.desc)}</div>
        <div style="margin-top:12px;display:flex;gap:6px"><span class="rc-badge" style="background:#ecfeff;color:#0891b2">CSV</span><span class="rc-badge" style="background:#dbeafe;color:#1e40af">HTML</span></div>
      </div>`).join('');
    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📋 Attendance Reports</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Daily, monthly, and trend attendance analysis</p>
      <div class="card" style="margin-bottom:20px">
        <h3 style="margin-bottom:12px">Generate Report</h3>
        <form method="GET" action="/reports/generate" class="rc-filter">
          <div><label>Report</label><select name="report_type" style="width:220px">${reports.map(r => '<option value="' + r.key + '">' + esc(r.name) + '</option>').join('')}</select></div>
          <div><label>From</label><input type="date" name="date_from"></div>
          <div><label>To</label><input type="date" name="date_to"></div>
          <div><label>Format</label><select name="format"><option value="html">HTML (Preview)</option><option value="csv">CSV Download</option></select></div>
          <button type="submit" class="rc-btn rc-btn-primary">📊 Generate</button>
        </form>
      </div>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Available Reports</h2>
      <div class="rc-grid">${cardsHtml}</div>
    </div>`;
    res.send(renderReportPage('Attendance Reports', html, user));
  }));

  // ============================================================
  // ROUTE 7: GET /reports/generate — Report Generation Engine
  // ============================================================
  app.get('/reports/generate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { report_type, date_from, date_to, format } = req.query;
    if (!report_type) return res.redirect('/reports');

    let sql = '', params = [tid], headers = [], opts = {}, reportTitle = report_type;

    // Date filters
    const dateWhere = [];
    let pi = 2;
    if (date_from) { dateWhere.push('created_at >= $' + pi++); params.push(date_from); }
    if (date_to) { dateWhere.push('created_at <= $' + pi++); params.push(date_to + ' 23:59:59'); }
    const dateClause = dateWhere.length ? ' AND ' + dateWhere.join(' AND ') : '';

    // Report SQL definitions
    switch (report_type) {
      case 'income_statement':
        reportTitle = 'Income Statement';
        sql = `SELECT 'Fees Collected' as category, COALESCE(SUM(amount),0) as amount, COUNT(*) as txn_count FROM fee_payments WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'Expenses', COALESCE(SUM(amount),0), COUNT(*) FROM expense_claims WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'Other Income', COALESCE(SUM(amount),0), COUNT(*) FROM transactions WHERE tenant_id=$1 AND type='credit' ${dateClause}`;
        headers = ['category', 'amount', 'txn_count'];
        opts = { currencyFields: ['amount'], totalsRow: { category: 'NET INCOME', amount: null, txn_count: null } };
        break;
      case 'balance_sheet':
        reportTitle = 'Balance Sheet';
        sql = `SELECT 'Accounts Receivable' as item, COALESCE(SUM(amount - COALESCE(paid,0)),0) as value FROM fees WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'Cash on Hand', COALESCE(SUM(amount),0) FROM fee_payments WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'Total Liabilities', COALESCE(SUM(amount),0) FROM expense_claims WHERE tenant_id=$1 AND status='pending' ${dateClause}`;
        headers = ['item', 'value'];
        opts = { currencyFields: ['value'] };
        break;
      case 'cash_flow':
        reportTitle = 'Cash Flow Statement';
        sql = `SELECT date_trunc('day', created_at) as period, SUM(CASE WHEN type='credit' THEN amount ELSE 0 END) as inflow, SUM(CASE WHEN type='debit' THEN amount ELSE 0 END) as outflow, SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) as net FROM transactions WHERE tenant_id=$1 ${dateClause} GROUP BY period ORDER BY period`;
        headers = ['period', 'inflow', 'outflow', 'net'];
        opts = { currencyFields: ['inflow', 'outflow', 'net'] };
        break;
      case 'fee_collection':
        reportTitle = 'Fee Collection Summary';
        sql = `SELECT s.class, s.stream, COUNT(DISTINCT fp.student_id) as students, SUM(fp.amount) as total_collected, AVG(fp.amount) as avg_payment, MAX(fp.created_at) as last_payment FROM fee_payments fp JOIN students s ON s.id=fp.student_id WHERE fp.tenant_id=$1 ${dateClause} GROUP BY s.class, s.stream ORDER BY s.class, s.stream`;
        headers = ['class', 'stream', 'students', 'total_collected', 'avg_payment', 'last_payment'];
        opts = { currencyFields: ['total_collected', 'avg_payment'], dateFields: ['last_payment'] };
        break;
      case 'expense_breakdown':
        reportTitle = 'Expense Breakdown';
        sql = `SELECT category, status, COUNT(*) as count, SUM(amount) as total, AVG(amount) as average, MAX(created_at) as latest FROM expense_claims WHERE tenant_id=$1 ${dateClause} GROUP BY category, status ORDER BY total DESC`;
        headers = ['category', 'status', 'count', 'total', 'average', 'latest'];
        opts = { currencyFields: ['total', 'average'], dateFields: ['latest'] };
        break;
      case 'tax_summary':
        reportTitle = 'Tax Summary';
        sql = `SELECT 'Gross Revenue' as item, COALESCE(SUM(amount),0) as value FROM fee_payments WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'Deductible Expenses', COALESCE(SUM(amount),0) FROM expense_claims WHERE tenant_id=$1 AND status='approved' ${dateClause}
               UNION ALL SELECT 'Estimated Tax (18%)', COALESCE((SELECT SUM(amount) FROM fee_payments WHERE tenant_id=$1 ${dateClause}) * 0.18, 0)`;
        headers = ['item', 'value'];
        opts = { currencyFields: ['value'] };
        break;
      case 'enrollment_summary':
        reportTitle = 'Enrollment Summary';
        sql = `SELECT class, stream, COUNT(*) as total, COUNT(*) FILTER (WHERE gender='Male') as males, COUNT(*) FILTER (WHERE gender='Female') as females FROM students WHERE tenant_id=$1 AND is_active=true GROUP BY class, stream ORDER BY class`;
        headers = ['class', 'stream', 'total', 'males', 'females'];
        opts = { totalsRow: { class: 'TOTAL', stream: '', total: null, males: null, females: null } };
        break;
      case 'fee_arrears':
        reportTitle = 'Fee Arrears Report';
        sql = `SELECT s.name, s.class, s.stream, f.term, f.year, f.amount, f.paid, (f.amount - COALESCE(f.paid,0)) as balance FROM fees f JOIN students s ON s.id=f.student_id WHERE f.tenant_id=$1 AND (f.amount - COALESCE(f.paid,0)) > 0 ORDER BY balance DESC`;
        headers = ['name', 'class', 'stream', 'term', 'year', 'amount', 'paid', 'balance'];
        opts = { currencyFields: ['amount', 'paid', 'balance'] };
        break;
      case 'performance_subject':
        reportTitle = 'Performance by Subject';
        sql = `SELECT m.subject, COUNT(*) as students, ROUND(AVG(m.marks)::numeric, 1) as avg_marks, MAX(m.marks) as highest, MIN(m.marks) as lowest, COUNT(*) FILTER (WHERE m.marks >= 50) as passed FROM marks m JOIN students s ON s.id=m.student_id WHERE m.tenant_id=$1 ${dateClause} GROUP BY m.subject ORDER BY avg_marks DESC`;
        headers = ['subject', 'students', 'avg_marks', 'highest', 'lowest', 'passed'];
        break;
      case 'class_ranking':
        reportTitle = 'Class Ranking';
        sql = `SELECT s.name, s.class, s.stream, ROUND(AVG(m.marks)::numeric, 1) as avg_marks, COUNT(m.subject) as subjects, RANK() OVER (PARTITION BY s.class ORDER BY AVG(m.marks) DESC) as rank FROM marks m JOIN students s ON s.id=m.student_id WHERE m.tenant_id=$1 AND s.is_active=true ${dateClause} GROUP BY s.id, s.name, s.class, s.stream ORDER BY s.class, rank`;
        headers = ['name', 'class', 'stream', 'avg_marks', 'subjects', 'rank'];
        break;
      case 'demographics':
        reportTitle = 'Student Demographics';
        sql = `SELECT gender, COUNT(*) as total, COUNT(*) FILTER (WHERE age IS NOT NULL) as with_age, ROUND(AVG(age)::numeric, 1) as avg_age FROM students WHERE tenant_id=$1 AND is_active=true GROUP BY gender`;
        headers = ['gender', 'total', 'with_age', 'avg_age'];
        break;
      case 'attendance_report':
        reportTitle = 'Attendance Report';
        sql = `SELECT s.class, COUNT(DISTINCT a.student_id) as total_students, COUNT(*) FILTER (WHERE a.status='present') as present, COUNT(*) FILTER (WHERE a.status='absent') as absent, COUNT(*) FILTER (WHERE a.status='late') as late, ROUND(COUNT(*) FILTER (WHERE a.status='present')::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate_pct FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 ${dateClause} GROUP BY s.class ORDER BY s.class`;
        headers = ['class', 'total_students', 'present', 'absent', 'late', 'rate_pct'];
        opts = { pctFields: ['rate_pct'] };
        break;
      case 'staff_list':
        reportTitle = 'Staff List';
        sql = `SELECT name, email, department, position, phone, date_of_joining, is_active FROM employee_directory WHERE tenant_id=$1 ORDER BY department, name`;
        params = [tid];
        headers = ['name', 'email', 'department', 'position', 'phone', 'date_of_joining', 'is_active'];
        opts = { dateFields: ['date_of_joining'] };
        break;
      case 'leave_summary':
        reportTitle = 'Leave Summary';
        sql = `SELECT e.name, e.department, lr.leave_type, COUNT(*) as days_taken, lr.status FROM leave_requests lr JOIN employee_directory e ON e.id=lr.employee_id WHERE lr.tenant_id=$1 ${dateClause} GROUP BY e.name, e.department, lr.leave_type, lr.status ORDER BY days_taken DESC`;
        headers = ['name', 'department', 'leave_type', 'days_taken', 'status'];
        break;
      case 'payroll_summary':
        reportTitle = 'Payroll Summary';
        sql = `SELECT e.department, COUNT(*) as staff_count, COALESCE(SUM(e.salary),0) as total_salary, COALESCE(AVG(e.salary),0) as avg_salary, COALESCE(MIN(e.salary),0) as min_salary, COALESCE(MAX(e.salary),0) as max_salary FROM employee_directory e WHERE e.tenant_id=$1 AND e.is_active=true GROUP BY e.department ORDER BY total_salary DESC`;
        params = [tid];
        headers = ['department', 'staff_count', 'total_salary', 'avg_salary', 'min_salary', 'max_salary'];
        opts = { currencyFields: ['total_salary', 'avg_salary', 'min_salary', 'max_salary'] };
        break;
      case 'department_headcount':
        reportTitle = 'Department Headcount';
        sql = `SELECT department, COUNT(*) as total, COUNT(*) FILTER (WHERE gender='Male') as male, COUNT(*) FILTER (WHERE gender='Female') as female FROM employee_directory WHERE tenant_id=$1 AND is_active=true GROUP BY department ORDER BY total DESC`;
        params = [tid];
        headers = ['department', 'total', 'male', 'female'];
        break;
      case 'birthday_list':
        reportTitle = 'Birthday List';
        sql = `SELECT name, department, position, date_of_birth, EXTRACT(MONTH FROM date_of_birth) as birth_month FROM employee_directory WHERE tenant_id=$1 AND date_of_birth IS NOT NULL ORDER BY birth_month, EXTRACT(DAY FROM date_of_birth)`;
        params = [tid];
        headers = ['name', 'department', 'position', 'date_of_birth', 'birth_month'];
        opts = { dateFields: ['date_of_birth'] };
        break;
      case 'contract_expiry':
        reportTitle = 'Contract Expiry Report';
        sql = `SELECT name, department, position, contract_end_date, date_of_joining, CASE WHEN contract_end_date < NOW() THEN 'Expired' WHEN contract_end_date < NOW() + INTERVAL '30 days' THEN 'Expiring Soon' ELSE 'Active' END as status FROM employee_directory WHERE tenant_id=$1 AND contract_end_date IS NOT NULL ORDER BY contract_end_date`;
        params = [tid];
        headers = ['name', 'department', 'position', 'contract_end_date', 'date_of_joining', 'status'];
        opts = { dateFields: ['contract_end_date', 'date_of_joining'] };
        break;
      case 'daily_sales':
        reportTitle = 'Daily Sales Report';
        sql = `SELECT date_trunc('day', so.created_at) as sale_date, COUNT(*) as orders, COALESCE(SUM(so.total_amount),0) as revenue, COALESCE(AVG(so.total_amount),0) as avg_order FROM restaurant_orders so WHERE so.tenant_id=$1 ${dateClause} GROUP BY sale_date ORDER BY sale_date DESC`;
        headers = ['sale_date', 'orders', 'revenue', 'avg_order'];
        opts = { currencyFields: ['revenue', 'avg_order'] };
        break;
      case 'product_performance':
        reportTitle = 'Product Performance';
        sql = `SELECT oi.item_name, COUNT(*) as qty_sold, COALESCE(SUM(oi.total_price),0) as revenue, COALESCE(SUM(oi.cost_price * oi.quantity),0) as cost, COALESCE(SUM(oi.total_price) - SUM(oi.cost_price * oi.quantity),0) as profit FROM order_items oi JOIN restaurant_orders so ON so.id=oi.order_id WHERE so.tenant_id=$1 ${dateClause} GROUP BY oi.item_name ORDER BY revenue DESC LIMIT 100`;
        headers = ['item_name', 'qty_sold', 'revenue', 'cost', 'profit'];
        opts = { currencyFields: ['revenue', 'cost', 'profit'] };
        break;
      case 'revenue_category':
        reportTitle = 'Revenue by Category';
        sql = `SELECT oi.category, COUNT(DISTINCT so.id) as orders, COALESCE(SUM(oi.total_price),0) as revenue FROM order_items oi JOIN restaurant_orders so ON so.id=oi.order_id WHERE so.tenant_id=$1 ${dateClause} GROUP BY oi.category ORDER BY revenue DESC`;
        headers = ['category', 'orders', 'revenue'];
        opts = { currencyFields: ['revenue'] };
        break;
      case 'customer_analysis':
        reportTitle = 'Customer Analysis';
        sql = `SELECT so.customer_name, COUNT(*) as orders, COALESCE(SUM(so.total_amount),0) as total_spent, COALESCE(AVG(so.total_amount),0) as avg_order, MAX(so.created_at) as last_order FROM restaurant_orders so WHERE so.tenant_id=$1 ${dateClause} GROUP BY so.customer_name ORDER BY total_spent DESC LIMIT 50`;
        headers = ['customer_name', 'orders', 'total_spent', 'avg_order', 'last_order'];
        opts = { currencyFields: ['total_spent', 'avg_order'], dateFields: ['last_order'] };
        break;
      case 'stock_movement':
        reportTitle = 'Stock Movement';
        sql = `SELECT item_name, SUM(quantity) as total_moved, COUNT(*) as transactions, MAX(created_at) as last_activity FROM order_items oi JOIN restaurant_orders so ON so.id=oi.order_id WHERE so.tenant_id=$1 ${dateClause} GROUP BY item_name ORDER BY total_moved DESC LIMIT 100`;
        headers = ['item_name', 'total_moved', 'transactions', 'last_activity'];
        opts = { dateFields: ['last_activity'] };
        break;
      case 'profit_loss':
        reportTitle = 'Profit & Loss';
        sql = `SELECT 'Revenue' as item, COALESCE(SUM(total_amount),0) as amount FROM restaurant_orders WHERE tenant_id=$1 ${dateClause}
               UNION ALL SELECT 'COGS', COALESCE((SELECT SUM(oi.cost_price * oi.quantity) FROM order_items oi JOIN restaurant_orders so ON so.id=oi.order_id WHERE so.tenant_id=$1 ${dateClause}),0)
               UNION ALL SELECT 'Operating Expenses', COALESCE((SELECT SUM(amount) FROM expense_claims WHERE tenant_id=$1 ${dateClause}),0)
               UNION ALL SELECT 'Net Profit', COALESCE((SELECT SUM(total_amount) FROM restaurant_orders WHERE tenant_id=$1 ${dateClause}),0) - COALESCE((SELECT SUM(amount) FROM expense_claims WHERE tenant_id=$1 ${dateClause}),0)`;
        headers = ['item', 'amount'];
        opts = { currencyFields: ['amount'] };
        break;
      case 'daily_attendance':
        reportTitle = 'Daily Attendance';
        sql = `SELECT s.name, s.class, s.stream, a.date, a.status, a.check_in_time FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 AND a.date = COALESCE($2, CURRENT_DATE) ORDER BY s.class, s.name`;
        params = [tid, date_from || null];
        headers = ['name', 'class', 'stream', 'date', 'status', 'check_in_time'];
        opts = { dateFields: ['date'] };
        break;
      case 'monthly_summary':
        reportTitle = 'Monthly Attendance Summary';
        sql = `SELECT s.class, date_trunc('month', a.date) as month, COUNT(DISTINCT a.student_id) as total, COUNT(*) FILTER (WHERE a.status='present') as present, ROUND(COUNT(*) FILTER (WHERE a.status='present')::numeric / NULLIF(COUNT(*),0) * 100, 1) as pct FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 ${dateClause} GROUP BY s.class, month ORDER BY month DESC, s.class`;
        headers = ['class', 'month', 'total', 'present', 'pct'];
        opts = { pctFields: ['pct'] };
        break;
      case 'class_trend':
        reportTitle = 'Class Attendance Trend';
        sql = `SELECT s.class, date_trunc('week', a.date) as week, COUNT(*) FILTER (WHERE a.status='present') as present, COUNT(*) as total, ROUND(COUNT(*) FILTER (WHERE a.status='present')::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 ${dateClause} GROUP BY s.class, week ORDER BY week, s.class`;
        headers = ['class', 'week', 'present', 'total', 'rate'];
        opts = { pctFields: ['rate'] };
        break;
      case 'individual_student':
        reportTitle = 'Individual Student Attendance';
        sql = `SELECT s.name, s.class, a.date, a.status, a.check_in_time FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 ${dateClause} ORDER BY s.name, a.date DESC LIMIT 500`;
        headers = ['name', 'class', 'date', 'status', 'check_in_time'];
        opts = { dateFields: ['date'] };
        break;
      case 'latecomers':
        reportTitle = 'Latecomers List';
        sql = `SELECT s.name, s.class, s.stream, COUNT(*) as late_count, MAX(a.date) as last_late FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.tenant_id=$1 AND a.status='late' ${dateClause} GROUP BY s.id, s.name, s.class, s.stream ORDER BY late_count DESC LIMIT 50`;
        headers = ['name', 'class', 'stream', 'late_count', 'last_late'];
        opts = { dateFields: ['last_late'] };
        break;
      default:
        return res.redirect('/reports');
    }

    const result = await pool.query(sql, params);
    const rows = result.rows;

    // Compute totals for totalsRow
    if (opts.totalsRow && rows.length > 0) {
      Object.keys(opts.totalsRow).forEach(k => {
        if (opts.totalsRow[k] === null) {
          opts.totalsRow[k] = rows.reduce((s, r) => s + Number(r[k] || 0), 0);
        }
      });
    }

    // CSV format — trigger download
    if (format === 'csv') {
      const csv = generateCSV(headers, rows);
      const fileName = report_type.replace(/_/g, '-') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
      // Save export record
      await pool.query(
        `INSERT INTO report_exports (tenant_id, file_name, file_size, format, generated_by, record_count) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, fileName, Buffer.byteLength(csv, 'utf8'), 'csv', user.email, rows.length]
      );
      audit(user.email, 'report_export_csv', `${report_type}: ${rows.length} records`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
      return res.send(csv);
    }

    // HTML format — render in page
    const tableHtml = htmlTable(headers, rows, opts);
    const saveUrl = '/reports/save-config?report_type=' + encodeURIComponent(report_type) + '&date_from=' + encodeURIComponent(date_from || '') + '&date_to=' + encodeURIComponent(date_to || '');
    const csvUrl = '/reports/generate?report_type=' + encodeURIComponent(report_type) + '&date_from=' + encodeURIComponent(date_from || '') + '&date_to=' + encodeURIComponent(date_to || '') + '&format=csv';

    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 ${esc(reportTitle)}</h1>
        <p style="font-size:13px;color:#94a3b8">${rows.length} records ${date_from ? ' · From: ' + formatDate(date_from) : ''} ${date_to ? ' · To: ' + formatDate(date_to) : ''}</p></div>
        <div style="display:flex;gap:8px">
          <a href="${esc(csvUrl)}" class="rc-btn rc-btn-success">📥 Download CSV</a>
          <a href="${esc(saveUrl)}" class="rc-btn rc-btn-secondary">💾 Save Config</a>
          <button onclick="window.print()" class="rc-btn rc-btn-secondary">🖨 Print</button>
        </div>
      </div>
      <div class="rc-stats">
        <div class="rc-stat"><div class="rc-stat-val" style="color:#4f46e5">${rows.length}</div><div class="rc-stat-lbl">Records</div></div>
        <div class="rc-stat"><div class="rc-stat-val" style="color:#059669">${format}</div><div class="rc-stat-lbl">Format</div></div>
      </div>
      <div class="card">${tableHtml}</div>
    </div>`;
    audit(user.email, 'report_generate', `${report_type}: ${rows.length} rows`);
    res.send(renderReportPage(reportTitle, html, user));
  }));

  // ============================================================
  // ROUTE 8: GET /reports/export/:id — Download Export
  // ============================================================
  app.get('/reports/export/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const exportId = parseInt(req.params.id);
    const exp = (await pool.query('SELECT * FROM report_exports WHERE id=$1 AND tenant_id=$2', [exportId, tid])).rows[0];
    if (!exp) return res.send(renderReportPage('Not Found', '<div class="card rc-empty"><div class="rc-empty-icon">❌</div><h3>Export not found</h3><a href="/reports/saved" class="rc-btn rc-btn-primary" style="margin-top:12px">← Back to Saved</a></div>', user));
    audit(user.email, 'report_download', `Export #${exportId}: ${exp.file_name}`);
    if (exp.format === 'csv' && exp.file_url) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="' + exp.file_name + '"');
      return res.send(exp.file_url);
    }
    res.send(renderReportPage('Export Detail', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#1e293b">' + esc(exp.file_name) + '</h2><p style="color:#94a3b8;margin-top:8px">Format: ' + (exp.format || 'csv').toUpperCase() + ' · Records: ' + exp.record_count + ' · Size: ' + formatSize(exp.file_size) + '</p><p style="color:#94a3b8;margin-top:4px">Generated: ' + formatDateTime(exp.created_at) + ' by ' + esc(exp.generated_by) + '</p></div>', user));
  }));

  // ============================================================
  // ROUTE 9: GET /reports/saved — Saved Reports
  // ============================================================
  app.get('/reports/saved', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const saved = (await pool.query(
      `SELECT sr.*, (SELECT COUNT(*) FROM report_exports re WHERE re.report_id=sr.id) as export_count FROM saved_reports sr WHERE sr.tenant_id=$1 ORDER BY sr.created_at DESC LIMIT 100`, [tid]
    )).rows;
    const exports = (await pool.query(
      `SELECT re.*, sr.name as report_name FROM report_exports re LEFT JOIN saved_reports sr ON sr.id=re.report_id WHERE re.tenant_id=$1 ORDER BY re.created_at DESC LIMIT 50`, [tid]
    )).rows;

    const savedHtml = saved.length ? htmlTable(
      ['Name', 'Type', 'Format', 'Scheduled', 'Last Generated', 'Exports', 'Actions'],
      saved.map(r => ({
        Name: r.name, Type: r.report_type, Format: (r.format || 'csv').toUpperCase(),
        Scheduled: r.is_scheduled ? r.schedule_frequency : 'No',
        'Last Generated': formatDateTime(r.last_generated),
        Exports: r.export_count,
        Actions: '<a href="/reports/generate?report_type=' + encodeURIComponent(r.report_type) + '&date_from=' + encodeURIComponent((r.query_config && r.query_config.date_from) || '') + '&date_to=' + encodeURIComponent((r.query_config && r.query_config.date_to) || '') + '" class="rc-btn rc-btn-primary" style="padding:4px 10px;font-size:11px">Run</a>'
      })),
      { dateFields: ['Last Generated'] }
    ) : '<div class="rc-empty"><div class="rc-empty-icon">💾</div><h3>No saved report configurations</h3><p style="color:#94a3b8;margin-top:4px">Save a report config to quickly regenerate it later</p></div>';

    const exportsHtml = exports.length ? htmlTable(
      ['Report', 'Format', 'Records', 'Size', 'Generated By', 'Date', 'Download'],
      exports.map(r => ({
        Report: r.report_name || 'Manual', Format: (r.format || 'csv').toUpperCase(), Records: r.record_count,
        Size: formatSize(r.file_size), 'Generated By': r.generated_by,
        Date: formatDateTime(r.created_at),
        Download: '<a href="/reports/export/' + r.id + '" class="rc-btn rc-btn-success" style="padding:4px 10px;font-size:11px">📥</a>'
      })),
      { dateFields: ['Date'] }
    ) : '';

    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📁 Saved Reports & Exports</h1>
      <h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Saved Configurations</h2>
      <div class="card" style="margin-bottom:24px">${savedHtml}</div>
      ${exportsHtml ? '<h2 style="font-size:18px;color:#1e293b;margin-bottom:14px">Recent Exports</h2><div class="card">' + exportsHtml + '</div>' : ''}
    </div>`;
    res.send(renderReportPage('Saved Reports', html, user));
  }));

  // ============================================================
  // ROUTE 10: POST /reports/save-config — Save Report Config
  // ============================================================
  app.post('/reports/save-config', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, report_type, format, date_from, date_to, schedule_frequency, description } = req.body;
    if (!report_type) return res.redirect('/reports');
    const queryConfig = JSON.stringify({ date_from: date_from || '', date_to: date_to || '' });
    const isScheduled = schedule_frequency && schedule_frequency !== 'none';
    await pool.query(
      `INSERT INTO saved_reports (tenant_id, name, report_type, description, query_config, format, created_by, is_scheduled, schedule_frequency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, name || report_type.replace(/_/g, ' '), report_type, description || '', queryConfig, format || 'csv', user.email, isScheduled, isScheduled ? schedule_frequency : null]
    );
    audit(user.email, 'report_config_saved', `Saved config for ${report_type}`);
    req.flash = req.flash || {}; req.flash.success = 'Report configuration saved!';
    res.redirect('/reports/saved');
  }));

  // ============================================================
  // GET /reports/save-config (redirect form)
  // ============================================================
  app.get('/reports/save-config', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const { report_type, date_from, date_to } = req.query;
    const catKey = Object.entries(REPORT_CATEGORIES).find(([_, c]) => c.reports.some(r => r.key === report_type));
    const catLabel = catKey ? catKey[1].label : 'General';
    const reportName = (report_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const html = RC_CSS + `
    <div style="max-width:600px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <div class="card" style="padding:24px">
        <h2 style="margin-bottom:4px;color:#1e293b">💾 Save Report Configuration</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Save this config for quick re-generation</p>
        <form method="POST" action="/reports/save-config" style="display:flex;flex-direction:column;gap:14px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Report Name</label>
            <input type="text" name="name" value="${esc(reportName)}" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Category</label>
            <input type="text" value="${esc(catLabel)}" disabled style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;background:#f8fafc"></div>
          <input type="hidden" name="report_type" value="${esc(report_type)}">
          <input type="hidden" name="date_from" value="${esc(date_from || '')}">
          <input type="hidden" name="date_to" value="${esc(date_to || '')}">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" placeholder="Optional description..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Default Format</label>
              <select name="format" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"><option value="csv">CSV</option><option value="html">HTML</option></select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Schedule</label>
              <select name="schedule_frequency" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="none">No Schedule</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select></div>
          </div>
          <button type="submit" class="rc-btn rc-btn-primary" style="padding:12px;justify-content:center;font-size:15px">💾 Save Configuration</button>
        </form>
      </div>
    </div>`;
    res.send(renderReportPage('Save Report Config', html, user));
  }));

  // ============================================================
  // ROUTE 11: GET /reports/custom — Custom Report Builder
  // ============================================================
  app.get('/reports/custom', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Fetch available tables for this tenant
    const availableTables = [
      { value: 'students', label: 'Students', columns: ['name','class','stream','gender','admission_no','dob','is_active'] },
      { value: 'fee_payments', label: 'Fee Payments', columns: ['student_id','amount','method','receipt_no','created_at'] },
      { value: 'fees', label: 'Fees', columns: ['student_id','amount','paid','term','year'] },
      { value: 'attendance', label: 'Attendance', columns: ['student_id','date','status','check_in_time'] },
      { value: 'marks', label: 'Marks', columns: ['student_id','subject','marks','grade','exam_id'] },
      { value: 'employee_directory', label: 'Employees', columns: ['name','email','department','position','phone','salary','gender'] },
      { value: 'expense_claims', label: 'Expense Claims', columns: ['employee_id','category','amount','status','created_at'] },
      { value: 'restaurant_orders', label: 'Orders', columns: ['customer_name','total_amount','status','created_at'] }
    ];

    const tableOptions = availableTables.map(t =>
      '<option value="' + t.value + '" data-cols="' + t.columns.join(',') + '">' + esc(t.label) + ' (' + t.value + ')</option>'
    ).join('');

    const html = RC_CSS + `
    <div style="max-width:1000px;margin:0 auto">
      <a href="/reports" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Reports</a>
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">🔧 Custom Report Builder</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select a table, choose columns, apply filters, and generate</p>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <form method="GET" action="/reports/custom" id="customForm" style="display:flex;flex-direction:column;gap:16px">
          <input type="hidden" name="generate" value="1">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Table</label>
              <select name="table" id="tableSelect" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" onchange="updateColumns()">
                <option value="">-- Select Table --</option>${tableOptions}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Sort By</label>
              <input type="text" name="sort" placeholder="e.g., name, created_at" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Columns (comma-separated, or * for all)</label>
            <input type="text" name="columns" id="columnsInput" placeholder="name, class, stream, gender" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">WHERE Filter (optional SQL, e.g., class = 'P7')</label>
            <input type="text" name="filter" placeholder="is_active = true" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
            <span style="font-size:11px;color:#ef4444;margin-top:2px;display:block">⚠ Use with caution. Only basic comparisons are allowed.</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Limit</label>
              <input type="number" name="limit" value="100" min="1" max="5000" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Format</label>
              <select name="format" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"><option value="html">HTML Preview</option><option value="csv">CSV Download</option></select></div>
            <div style="display:flex;align-items:flex-end">
              <button type="submit" class="rc-btn rc-btn-primary" style="width:100%;padding:12px;justify-content:center;font-size:15px">📊 Generate Report</button></div>
          </div>
        </form>
      </div>
    </div>
    <script>
    function updateColumns(){
      var sel=document.getElementById('tableSelect');
      var opt=sel.options[sel.selectedIndex];
      if(opt&&opt.dataset.cols){
        document.getElementById('columnsInput').value=opt.dataset.cols;
      }
    }
    </script>`;
    res.send(renderReportPage('Custom Report Builder', html, user));
  }));

  // Custom report generation (reuses /reports/custom with query params)
  app.get('/reports/custom', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (!req.query.generate) return; // handled above by no-query branch

    const { table, columns, filter, sort, limit: limitVal, format } = req.query;
    if (!table) return res.redirect('/reports/custom');

    // Validate table name against whitelist
    const allowedTables = ['students','fee_payments','fees','attendance','marks','employee_directory','expense_claims','restaurant_orders','order_items','transactions','saved_reports','report_exports'];
    if (!allowedTables.includes(table)) return res.send(renderReportPage('Error', '<div class="card rc-empty"><div class="rc-empty-icon">🚫</div><h3>Invalid table selected</h3></div>', user));

    // Sanitize column names
    let colStr = '*';
    if (columns && columns.trim() !== '*') {
      const safeCols = columns.split(',').map(c => c.trim()).filter(c => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
      if (safeCols.length === 0) colStr = '*';
      else colStr = safeCols.join(', ');
    }

    let sql = `SELECT ${colStr} FROM ${table} WHERE tenant_id = $1`;
    const params = [tid];

    // Safely append filter (only allow basic comparisons)
    if (filter && filter.trim()) {
      const safeFilter = filter.replace(/[';]/g, '').trim();
      if (safeFilter.length > 0) sql += ' AND ' + safeFilter;
    }

    // Sort
    if (sort && /^[a-zA-Z_][a-zA-Z0-9_]*(\s+(asc|desc))?$/i.test(sort.trim())) {
      sql += ' ORDER BY ' + sort.trim();
    }

    // Limit
    const limit = Math.min(parseInt(limitVal) || 100, 5000);
    sql += ' LIMIT ' + limit;

    const result = await pool.query(sql, params);
    const rows = result.rows;
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const reportTitle = 'Custom: ' + table;

    if (format === 'csv') {
      const csv = generateCSV(headers, rows);
      const fileName = 'custom-' + table + '_' + new Date().toISOString().slice(0, 10) + '.csv';
      await pool.query(
        `INSERT INTO report_exports (tenant_id, file_name, file_size, format, generated_by, record_count) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, fileName, Buffer.byteLength(csv, 'utf8'), 'csv', user.email, rows.length]
      );
      audit(user.email, 'custom_report_csv', `Table ${table}: ${rows.length} records`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
      return res.send(csv);
    }

    const tableHtml = htmlTable(headers, rows);
    const html = RC_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      <a href="/reports/custom" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← New Custom Report</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 ${esc(reportTitle)}</h1>
        <p style="font-size:13px;color:#94a3b8">${rows.length} records · Table: ${esc(table)} · Columns: ${esc(colStr)}</p></div>
        <div style="display:flex;gap:8px">
          <a href="/reports/custom?generate=1&table=${encodeURIComponent(table)}&columns=${encodeURIComponent(columns || '*')}&filter=${encodeURIComponent(filter || '')}&sort=${encodeURIComponent(sort || '')}&limit=${limit}&format=csv" class="rc-btn rc-btn-success">📥 CSV</a>
          <button onclick="window.print()" class="rc-btn rc-btn-secondary">🖨 Print</button>
        </div>
      </div>
      <div class="card">${tableHtml}</div>
    </div>`;
    audit(user.email, 'custom_report_generate', `Table ${table}: ${rows.length} rows`);
    res.send(renderReportPage(reportTitle, html, user));
  }));

  logger.info('[ReportsCenter] Module loaded — 11 routes registered');
};
