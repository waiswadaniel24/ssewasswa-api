// ============================================================
// PER-TENANT FINANCIAL REPORTING MODULE — SSEWASSWA Comfort Platform
// Comprehensive financial statements: P&L, Balance Sheet,
// Cash Flow, A/R Aging, and chart API endpoints.
// Multi-tenant safe — every query filters by tenant_id.
// ============================================================
// Usage in server.js:
//   const financialReports = require('./financial-reports');
//   financialReports(app, pool, _newModOpts);
// ============================================================

'use strict';

module.exports = function financialReports(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const ah = opts.ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth;
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => next());
  const renderPage = opts.renderPage;
  const tid = (req) => req.session?.user?.tenant_id || 0;

  /* ───────── helpers ───────── */
  const fmtUGX = (n) => 'UGX ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const pct = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0';
  const arrow = (v) => v >= 0 ? '&#9650;' : '&#9660;';
  const badgeCls = (v) => v >= 0 ? 'fr-green' : 'fr-red';
  const today = () => new Date().toISOString().split('T')[0];
  const firstOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };

  /** Safely query a table that may not exist. Returns rows or empty array. */
  const safeQuery = async (sql, params) => {
    try {
      const result = await pool.query(sql, params);
      return result.rows;
    } catch (e) {
      // Table likely doesn't exist
      return [];
    }
  };

  /** Get date range from query params, defaulting to current month. */
  const getDateRange = (req) => {
    const period = req.query.period || 'this_month';
    const customFrom = req.query.from_date;
    const customTo = req.query.to_date;
    const now = new Date();
    let fromDate, toDate;

    switch (period) {
      case 'last_month': {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        fromDate = `${lm.getFullYear()}-${String(lm.getMonth()+1).padStart(2,'0')}-01`;
        const le = new Date(now.getFullYear(), now.getMonth(), 0);
        toDate = `${le.getFullYear()}-${String(le.getMonth()+1).padStart(2,'0')}-${String(le.getDate()).padStart(2,'0')}`;
        break;
      }
      case 'this_quarter': {
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        fromDate = `${now.getFullYear()}-${String(qMonth+1).padStart(2,'0')}-01`;
        const qEnd = new Date(now.getFullYear(), qMonth + 3, 0);
        toDate = `${qEnd.getFullYear()}-${String(qEnd.getMonth()+1).padStart(2,'0')}-${String(qEnd.getDate()).padStart(2,'0')}`;
        break;
      }
      case 'this_year':
        fromDate = `${now.getFullYear()}-01-01`;
        toDate = today();
        break;
      case 'custom':
        fromDate = customFrom || firstOfMonth();
        toDate = customTo || today();
        break;
      default: // this_month
        fromDate = firstOfMonth();
        toDate = today();
    }
    return { fromDate, toDate, period };
  };

  /** Check if a table exists in the current database. */
  const tableExistsCache = {};
  const tableExists = async (tableName) => {
    if (tableExistsCache[tableName] !== undefined) return tableExistsCache[tableName];
    try {
      const result = await pool.query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)",
        [tableName]
      );
      tableExistsCache[tableName] = result.rows[0].exists;
      return tableExistsCache[tableName];
    } catch {
      tableExistsCache[tableName] = false;
      return false;
    }
  };

  /* ───────── shared CSS ───────── */
  const FR_CSS = `<style>
.fr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
.fr-card{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.fr-card h3{font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:.25rem}
.fr-card .val{font-size:1.65rem;font-weight:700;color:#111827}
.fr-card .sub{font-size:.78rem;color:#6b7280;margin-top:.15rem}
.fr-badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:600}
.fr-green{background:#d1fae5;color:#065f46}
.fr-red{background:#fee2e2;color:#991b1b}
.fr-amber{background:#fef3c7;color:#92400e}
.fr-blue{background:#dbeafe;color:#1e40af}
.fr-table{width:100%;border-collapse:collapse;font-size:.85rem}
.fr-table th{text-align:left;padding:.6rem .75rem;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
.fr-table td{padding:.55rem .75rem;border-bottom:1px solid #f3f4f6;color:#374151}
.fr-table tr:hover td{background:#f8faff}
.fr-table .subtotal td{background:#eef2ff;font-weight:700;border-top:2px solid #c7d2fe}
.fr-table .total td{background:#1e293b;color:#fff;font-weight:700;border-top:3px solid #0f172a}
.fr-tabs{display:flex;gap:.25rem;border-bottom:2px solid #e5e7eb;padding:0 1rem;overflow-x:auto}
.fr-tabs a{padding:.6rem 1rem;font-size:.82rem;font-weight:500;color:#6b7280;text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-2px;white-space:nowrap;transition:all .15s}
.fr-tabs a:hover,.fr-tabs a.active{color:#059669;border-bottom-color:#059669}
.fr-section{font-size:1.1rem;font-weight:700;color:#111827;margin:1.5rem 0 .5rem;padding-bottom:.25rem;border-bottom:2px solid #e5e7eb}
.fr-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.fr-filter label{font-size:12px;font-weight:600;color:#64748b}
.fr-filter input,.fr-filter select{padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.fr-filter input:focus,.fr-filter select:focus{outline:none;border-color:#059669}
.fr-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.fr-btn:hover{opacity:.9}
.fr-btn-primary{background:#059669;color:#fff}
.fr-btn-secondary{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
.fr-btn-danger{background:#fee2e2;color:#dc2626}
.fr-spark{display:flex;align-items:flex-end;gap:2px;height:32px;margin-top:8px}
.fr-spark-bar{background:#059669;border-radius:2px 2px 0 0;min-width:6px;transition:height .3s}
.fr-link-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.fr-link-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;transition:.2s;text-decoration:none;color:inherit;display:block}
.fr-link-card:hover{border-color:#059669;box-shadow:0 4px 16px rgba(5,150,105,.1);transform:translateY(-2px)}
.fr-link-card h3{font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px}
.fr-link-card p{font-size:12px;color:#94a3b8;line-height:1.4}
.fr-two-col{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
@media(max-width:640px){.fr-grid{grid-template-columns:1fr 1fr}.fr-card .val{font-size:1.3rem}.fr-two-col{grid-template-columns:1fr}.fr-link-grid{grid-template-columns:1fr}}
@media print{
  .fr-tabs,.fr-filter,.fr-btn,.no-print,nav,.pp-sidebar,.pp-bottom-nav{display:none!important}
  .fr-card{box-shadow:none;border:1px solid #ccc}
  body{background:#fff}
  .fr-table th,.fr-table td{padding:.3rem .5rem;font-size:.75rem}
  h1{font-size:18px!important}h2{font-size:15px!important}
}
</style>`;

  /** Period selector component */
  const periodSelector = (currentPeriod, fromDate, toDate) => `
    <div class="fr-filter no-print">
      <div><label>Period</label>
        <select name="period" onchange="this.form.submit()">
          <option value="this_month"${currentPeriod==='this_month'?' selected':''}>This Month</option>
          <option value="last_month"${currentPeriod==='last_month'?' selected':''}>Last Month</option>
          <option value="this_quarter"${currentPeriod==='this_quarter'?' selected':''}>This Quarter</option>
          <option value="this_year"${currentPeriod==='this_year'?' selected':''}>This Year</option>
          <option value="custom"${currentPeriod==='custom'?' selected':''}>Custom Range</option>
        </select>
      </div>
      ${currentPeriod==='custom'?`
      <div><label>From</label><input type="date" name="from_date" value="${esc(fromDate)}"></div>
      <div><label>To</label><input type="date" name="to_date" value="${esc(toDate)}"></div>
      `:''}
      <button type="submit" class="fr-btn fr-btn-primary" style="align-self:flex-end">Apply</button>
    </div>`;

  /** Tab navigation */
  const TABS = (active) => `
    <div class="fr-tabs">
      <a href="/financial-reports"${active==='dashboard'?' class="active"':''}>&#128200; Dashboard</a>
      <a href="/financial-reports/profit-loss"${active==='pnl'?' class="active"':''}>&#128176; Profit & Loss</a>
      <a href="/financial-reports/balance-sheet"${active==='bs'?' class="active"':''}>&#9878; Balance Sheet</a>
      <a href="/financial-reports/cash-flow"${active==='cf'?' class="active"':''}>&#127974; Cash Flow</a>
      <a href="/financial-reports/receivables"${active==='ar'?' class="active"':''}>&#128203; A/R Aging</a>
    </div>`;

  /** Sparkline bars (CSS-only mini chart) */
  const sparkline = (values, maxVal, color='#059669') => {
    if (!values || !values.length) return '';
    const mx = maxVal || Math.max(...values.map(Math.abs), 1);
    return `<div class="fr-spark">${values.map(v =>
      `<div class="fr-spark-bar" style="height:${Math.max(2, Math.abs(v)/mx*30)}px;background:${v>=0?color:'#dc2626'}" title="${fmtUGX(v)}"></div>`
    ).join('')}</div>`;
  };

  /** Generate CSV response */
  const sendCSV = (res, filename, headers, rows) => {
    const lines = [headers.map(h => '"' + String(h).replace(/"/g, '""') + '"').join(',')];
    rows.forEach(row => {
      lines.push(headers.map(h => {
        const v = row[h] !== null && row[h] !== undefined ? String(row[h]) : '';
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n'));
  };

  /* ============================================================
     ROUTE 1: GET /financial-reports — Dashboard
     ============================================================ */
  app.get('/financial-reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const { fromDate, toDate, period } = getDateRange(req);

    // Revenue: paid invoices
    const invoiceRev = await safeQuery(
      `SELECT COALESCE(SUM(paid_amount),0) as total FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND issue_date >= $2 AND issue_date <= $3`,
      [t, fromDate, toDate]
    );
    const invoiceRevenue = Number(invoiceRev[0]?.total || 0);

    // Fee collection
    const feeRev = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date >= $2 AND payment_date <= $3`,
      [t, fromDate, toDate]
    );
    const feeRevenue = Number(feeRev[0]?.total || 0);

    // Payment transactions (net_amount)
    const ptxRev = await safeQuery(
      `SELECT COALESCE(SUM(net_amount),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const ptxRevenue = Number(ptxRev[0]?.total || 0);

    const totalRevenue = invoiceRevenue + feeRevenue + ptxRevenue;

    // Expenses
    const hasExpenses = await tableExists('expenses');
    let expenseTotal = 0;
    let expenseCategories = [];
    if (hasExpenses) {
      const expResult = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date >= $2 AND date <= $3`,
        [t, fromDate, toDate]
      );
      expenseTotal = Number(expResult[0]?.total || 0);
      const expCats = await safeQuery(
        `SELECT COALESCE(category,'Uncategorized') as category, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date >= $2 AND date <= $3 GROUP BY category ORDER BY total DESC`,
        [t, fromDate, toDate]
      );
      expenseCategories = expCats;
    }

    // Salary payments
    const hasSalary = await tableExists('salary_payments');
    let salaryTotal = 0;
    if (hasSalary) {
      const salResult = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM salary_payments WHERE tenant_id=$1`,
        [t]
      );
      salaryTotal = Number(salResult[0]?.total || 0);
    }

    // Processing fees
    const procFees = await safeQuery(
      `SELECT COALESCE(SUM(fee),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const processingFees = Number(procFees[0]?.total || 0);

    // Platform fees
    const platFees = await safeQuery(
      `SELECT COALESCE(SUM(platform_fee),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const platformFees = Number(platFees[0]?.total || 0);

    const totalExpenses = expenseTotal + salaryTotal + processingFees + platformFees;
    const netIncome = totalRevenue - totalExpenses;
    const margin = totalRevenue ? pct(netIncome, totalRevenue) : '0.0';

    // Outstanding invoices
    const outstanding = await safeQuery(
      `SELECT COALESCE(SUM(total - paid_amount),0) as total FROM invoices WHERE tenant_id=$1 AND status NOT IN ('paid','cancelled') AND total > paid_amount`,
      [t]
    );
    const outstandingAmount = Number(outstanding[0]?.total || 0);

    // Monthly revenue for sparkline (last 6 months)
    const monthlyRev = await safeQuery(
      `SELECT TO_CHAR(issue_date, 'YYYY-MM') as month, COALESCE(SUM(paid_amount),0) as total
       FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND issue_date >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month`,
      [t]
    );
    const sparkValues = monthlyRev.map(r => Number(r.total));

    // Monthly expense sparkline
    const monthlyExp = hasExpenses ? await safeQuery(
      `SELECT TO_CHAR(date, 'YYYY-MM') as month, COALESCE(SUM(amount),0) as total
       FROM expenses WHERE tenant_id=$1 AND date >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month`,
      [t]
    ) : [];
    const expSparkValues = monthlyExp.map(r => Number(r.total));

    let html = `<style>${FR_CSS}</style>`;
    html += `<form method="GET" action="/financial-reports">`;
    html += TABS('dashboard');
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:22px;color:#1e293b;margin:0">&#128200; Financial Reports Dashboard</h1>
      <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">${esc(fromDate)} to ${esc(toDate)}</p></div>
      <div style="display:flex;gap:8px">
        <a href="/financial-reports?period=${period}&from_date=${fromDate}&to_date=${toDate}&export=csv" class="fr-btn fr-btn-secondary">&#11015; CSV</a>
        <button type="button" onclick="window.print()" class="fr-btn fr-btn-secondary">&#128424; Print</button>
      </div>
    </div>`;
    html += periodSelector(period, fromDate, toDate);

    // Quick stats
    html += `<div class="fr-grid">
      <div class="fr-card"><h3>Total Revenue</h3><div class="val" style="color:#059669">${fmtUGX(totalRevenue)}</div>
        <div class="sub">Invoices: ${fmtUGX(invoiceRevenue)}</div>
        ${sparkline(sparkValues, Math.max(...sparkValues, 1))}
      </div>
      <div class="fr-card"><h3>Total Expenses</h3><div class="val" style="color:#dc2626">${fmtUGX(totalExpenses)}</div>
        <div class="sub">Direct: ${fmtUGX(expenseTotal)}${hasSalary?' | Salaries: '+fmtUGX(salaryTotal):''}</div>
        ${sparkline(expSparkValues, Math.max(...expSparkValues, 1), '#dc2626')}
      </div>
      <div class="fr-card"><h3>Net Income</h3><div class="val" style="color:${netIncome>=0?'#059669':'#dc2626'}">${fmtUGX(netIncome)}</div>
        <div class="sub">Margin: ${margin}%</div>
      </div>
      <div class="fr-card"><h3>Outstanding Invoices</h3><div class="val" style="color:#d97706">${fmtUGX(outstandingAmount)}</div>
        <div class="sub">Unpaid invoices</div>
      </div>
    </div>`;

    // Report links
    html += `<h2 style="font-size:18px;color:#1e293b;margin:28px 0 14px">&#128218; Detailed Reports</h2>`;
    html += `<div class="fr-link-grid">
      <a href="/financial-reports/profit-loss" class="fr-link-card">
        <h3>&#128176; Profit & Loss Statement</h3>
        <p>Revenue vs expenses, net income and margin analysis</p>
      </a>
      <a href="/financial-reports/balance-sheet" class="fr-link-card">
        <h3>&#9878; Balance Sheet</h3>
        <p>Assets, liabilities, equity and balance verification</p>
      </a>
      <a href="/financial-reports/cash-flow" class="fr-link-card">
        <h3>&#127974; Cash Flow Statement</h3>
        <p>Operating, investing, financing cash activities</p>
      </a>
      <a href="/financial-reports/receivables" class="fr-link-card">
        <h3>&#128203; Accounts Receivable Aging</h3>
        <p>Outstanding invoices by aging bucket (0-30, 31-60, 61-90, 90+)</p>
      </a>
    </div>`;

    // Expense breakdown mini table
    if (expenseCategories.length > 0) {
      html += `<h2 style="font-size:18px;color:#1e293b;margin:28px 0 14px">&#128200; Expense Breakdown</h2>`;
      html += `<div class="fr-card"><table class="fr-table"><tr><th>Category</th><th>Amount</th><th>%</th></tr>`;
      expenseCategories.forEach(c => {
        html += `<tr><td>${esc(c.category)}</td><td>${fmtUGX(c.total)}</td><td>${pct(c.total, totalExpenses)}%</td></tr>`;
      });
      html += `<tr class="subtotal"><td>Total Expenses</td><td>${fmtUGX(totalExpenses)}</td><td>100%</td></tr></table></div>`;
    }

    // Revenue composition mini table
    html += `<h2 style="font-size:18px;color:#1e293b;margin:28px 0 14px">&#128200; Revenue Composition</h2>`;
    html += `<div class="fr-card"><table class="fr-table"><tr><th>Source</th><th>Amount</th><th>%</th></tr>`;
    html += `<tr><td>Invoice Revenue</td><td>${fmtUGX(invoiceRevenue)}</td><td>${pct(invoiceRevenue, totalRevenue)}%</td></tr>`;
    html += `<tr><td>Fee Collection</td><td>${fmtUGX(feeRevenue)}</td><td>${pct(feeRevenue, totalRevenue)}%</td></tr>`;
    html += `<tr><td>Payment Transactions</td><td>${fmtUGX(ptxRevenue)}</td><td>${pct(ptxRevenue, totalRevenue)}%</td></tr>`;
    html += `<tr class="subtotal"><td>Total Revenue</td><td>${fmtUGX(totalRevenue)}</td><td>100%</td></tr></table></div>`;

    html += `</div></form>`;

    // Handle CSV export
    if (req.query.export === 'csv') {
      return sendCSV(res, `financial-dashboard-${fromDate}-to-${toDate}.csv`,
        ['Metric', 'Amount'],
        [
          { Metric: 'Total Revenue', Amount: totalRevenue },
          { Metric: '  Invoice Revenue', Amount: invoiceRevenue },
          { Metric: '  Fee Collection', Amount: feeRevenue },
          { Metric: '  Payment Transactions', Amount: ptxRevenue },
          { Metric: 'Total Expenses', Amount: totalExpenses },
          { Metric: '  Direct Expenses', Amount: expenseTotal },
          { Metric: '  Salaries', Amount: salaryTotal },
          { Metric: '  Processing Fees', Amount: processingFees },
          { Metric: '  Platform Fees', Amount: platformFees },
          { Metric: 'Net Income', Amount: netIncome },
          { Metric: 'Margin %', Amount: margin + '%' },
          { Metric: 'Outstanding Invoices', Amount: outstandingAmount }
        ]
      );
    }

    res.send(renderPage('Financial Reports Dashboard', html, req.session.user, req));
  }));

  /* ============================================================
     ROUTE 2: GET /financial-reports/profit-loss — Income Statement
     ============================================================ */
  app.get('/financial-reports/profit-loss', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const { fromDate, toDate, period } = getDateRange(req);

    // ---- REVENUE ----
    const invoiceRev = await safeQuery(
      `SELECT COALESCE(SUM(paid_amount),0) as total FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND issue_date >= $2 AND issue_date <= $3`,
      [t, fromDate, toDate]
    );
    const invoiceRevenue = Number(invoiceRev[0]?.total || 0);

    const feeRev = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date >= $2 AND payment_date <= $3`,
      [t, fromDate, toDate]
    );
    const feeRevenue = Number(feeRev[0]?.total || 0);

    const ptxRev = await safeQuery(
      `SELECT COALESCE(SUM(net_amount),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const ptxRevenue = Number(ptxRev[0]?.total || 0);

    const totalRevenue = invoiceRevenue + feeRevenue + ptxRevenue;

    // ---- EXPENSES ----
    const hasExpenses = await tableExists('expenses');
    let expenseTotal = 0;
    let expenseCategories = [];
    if (hasExpenses) {
      const expResult = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date >= $2 AND date <= $3`,
        [t, fromDate, toDate]
      );
      expenseTotal = Number(expResult[0]?.total || 0);
      const expCats = await safeQuery(
        `SELECT COALESCE(category,'Uncategorized') as category, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date >= $2 AND date <= $3 GROUP BY category ORDER BY total DESC`,
        [t, fromDate, toDate]
      );
      expenseCategories = expCats;
    }

    // Salary payments
    const hasSalary = await tableExists('salary_payments');
    let salaryTotal = 0;
    let salaryRows = [];
    if (hasSalary) {
      const salResult = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM salary_payments WHERE tenant_id=$1`,
        [t]
      );
      salaryTotal = Number(salResult[0]?.total || 0);
      salaryRows = await safeQuery(
        `SELECT month, year, COALESCE(SUM(amount),0) as total FROM salary_payments WHERE tenant_id=$1 GROUP BY month, year ORDER BY year, month`,
        [t]
      );
    }

    // Processing fees
    const procFees = await safeQuery(
      `SELECT COALESCE(SUM(fee),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const processingFees = Number(procFees[0]?.total || 0);

    // Platform fees
    const platFees = await safeQuery(
      `SELECT COALESCE(SUM(platform_fee),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const platformFees = Number(platFees[0]?.total || 0);

    const totalExpenses = expenseTotal + salaryTotal + processingFees + platformFees;
    const grossProfit = totalRevenue - expenseTotal; // Revenue - COGS (direct expenses)
    const netIncome = totalRevenue - totalExpenses;
    const margin = totalRevenue ? pct(netIncome, totalRevenue) : '0.0';
    const grossMargin = totalRevenue ? pct(grossProfit, totalRevenue) : '0.0';

    let html = `<style>${FR_CSS}</style>`;
    html += `<form method="GET" action="/financial-reports/profit-loss">`;
    html += TABS('pnl');
    html += `<div style="padding:1rem;max-width:1100px;margin:0 auto">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:22px;color:#1e293b;margin:0">&#128176; Profit & Loss Statement</h1>
      <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">Income Statement for ${esc(fromDate)} to ${esc(toDate)}</p></div>
      <div style="display:flex;gap:8px">
        <a href="/financial-reports/profit-loss?period=${period}&from_date=${fromDate}&to_date=${toDate}&export=csv" class="fr-btn fr-btn-secondary">&#11015; Export CSV</a>
        <button type="button" onclick="window.print()" class="fr-btn fr-btn-secondary">&#128424; Print</button>
      </div>
    </div>`;
    html += periodSelector(period, fromDate, toDate);

    // P&L Table
    html += `<div class="fr-card" style="margin-top:8px">`;
    html += `<table class="fr-table">`;

    // Revenue Section
    html += `<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;font-size:14px;color:#059669;padding:12px">REVENUE</td></tr>`;
    html += `<tr><td style="padding-left:24px">Invoice Revenue</td><td style="text-align:right">${fmtUGX(invoiceRevenue)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Fee Collection Revenue</td><td style="text-align:right">${fmtUGX(feeRevenue)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Payment Transaction Income</td><td style="text-align:right">${fmtUGX(ptxRevenue)}</td></tr>`;
    html += `<tr class="subtotal"><td>Total Revenue</td><td style="text-align:right">${fmtUGX(totalRevenue)}</td></tr>`;

    // Expenses Section
    html += `<tr><td colspan="2" style="background:#fef2f2;font-weight:700;font-size:14px;color:#dc2626;padding:12px;margin-top:16px">EXPENSES</td></tr>`;
    if (hasExpenses && expenseCategories.length > 0) {
      expenseCategories.forEach(c => {
        html += `<tr><td style="padding-left:24px">${esc(c.category)}</td><td style="text-align:right">${fmtUGX(c.total)}</td></tr>`;
      });
      html += `<tr class="subtotal"><td>Direct Expenses</td><td style="text-align:right">${fmtUGX(expenseTotal)}</td></tr>`;
    } else if (hasExpenses) {
      html += `<tr><td style="padding-left:24px">Direct Expenses</td><td style="text-align:right">${fmtUGX(expenseTotal)}</td></tr>`;
    }
    if (hasSalary) {
      html += `<tr><td style="padding-left:24px">Salary Payments</td><td style="text-align:right">${fmtUGX(salaryTotal)}</td></tr>`;
    }
    html += `<tr><td style="padding-left:24px">Payment Processing Fees</td><td style="text-align:right">${fmtUGX(processingFees)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Platform Fees</td><td style="text-align:right">${fmtUGX(platformFees)}</td></tr>`;
    html += `<tr class="subtotal"><td>Total Expenses</td><td style="text-align:right;color:#dc2626">${fmtUGX(totalExpenses)}</td></tr>`;

    // Summary
    html += `<tr><td colspan="2" style="background:#eef2ff;font-weight:700;font-size:14px;color:#4f46e5;padding:12px">SUMMARY</td></tr>`;
    html += `<tr><td style="font-weight:600">Gross Profit (Revenue - Direct Expenses)</td><td style="text-align:right;font-weight:600;color:${grossProfit>=0?'#059669':'#dc2626'}">${fmtUGX(grossProfit)}</td></tr>`;
    html += `<tr><td style="font-weight:600">Gross Margin</td><td style="text-align:right;font-weight:600">${grossMargin}%</td></tr>`;
    html += `<tr class="total"><td>Net Income</td><td style="text-align:right">${fmtUGX(netIncome)}</td></tr>`;
    html += `<tr class="total"><td>Net Margin</td><td style="text-align:right">${margin}%</td></tr>`;

    html += `</table></div>`;

    // Salary detail if available
    if (hasSalary && salaryRows.length > 0) {
      html += `<div class="fr-section">Salary Detail</div>`;
      html += `<div class="fr-card"><table class="fr-table"><tr><th>Month</th><th>Year</th><th>Amount</th></tr>`;
      salaryRows.forEach(r => {
        html += `<tr><td>${esc(r.month)}</td><td>${esc(r.year)}</td><td>${fmtUGX(r.total)}</td></tr>`;
      });
      html += `</table></div>`;
    }

    html += `</div></form>`;

    // CSV Export
    if (req.query.export === 'csv') {
      const rows = [
        { Section: 'REVENUE', Item: 'Invoice Revenue', Amount: invoiceRevenue },
        { Section: 'REVENUE', Item: 'Fee Collection Revenue', Amount: feeRevenue },
        { Section: 'REVENUE', Item: 'Payment Transaction Income', Amount: ptxRevenue },
        { Section: 'REVENUE', Item: 'Total Revenue', Amount: totalRevenue },
        { Section: 'EXPENSES', Item: 'Direct Expenses', Amount: expenseTotal },
      ];
      expenseCategories.forEach(c => rows.push({ Section: 'EXPENSES', Item: '  ' + c.category, Amount: Number(c.total) }));
      rows.push(
        { Section: 'EXPENSES', Item: 'Salary Payments', Amount: salaryTotal },
        { Section: 'EXPENSES', Item: 'Processing Fees', Amount: processingFees },
        { Section: 'EXPENSES', Item: 'Platform Fees', Amount: platformFees },
        { Section: 'EXPENSES', Item: 'Total Expenses', Amount: totalExpenses },
        { Section: 'SUMMARY', Item: 'Gross Profit', Amount: grossProfit },
        { Section: 'SUMMARY', Item: 'Gross Margin', Amount: grossMargin + '%' },
        { Section: 'SUMMARY', Item: 'Net Income', Amount: netIncome },
        { Section: 'SUMMARY', Item: 'Net Margin', Amount: margin + '%' }
      );
      return sendCSV(res, `profit-loss-${fromDate}-to-${toDate}.csv`, ['Section', 'Item', 'Amount'], rows);
    }

    res.send(renderPage('Profit & Loss Statement', html, req.session.user, req));
  }));

  /* ============================================================
     ROUTE 3: GET /financial-reports/balance-sheet
     ============================================================ */
  app.get('/financial-reports/balance-sheet', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const asOfDate = req.query.as_of_date || today();

    // Assets: Cash & Bank (completed payments received)
    const cashResult = await safeQuery(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE tenant_id=$1 AND status='completed' AND created_at <= $2+' 23:59:59'`,
      [t, asOfDate]
    );
    const cashAndBank = Number(cashResult[0]?.total || 0);

    // Also check fee_receipts for cash
    const feeCashResult = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date <= $2`,
      [t, asOfDate]
    );
    const feeCash = Number(feeCashResult[0]?.total || 0);

    // Also check payment_transactions
    const ptxCashResult = await safeQuery(
      `SELECT COALESCE(SUM(net_amount),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at <= $2+' 23:59:59'`,
      [t, asOfDate]
    );
    const ptxCash = Number(ptxCashResult[0]?.total || 0);

    const totalCashAndBank = cashAndBank + feeCash + ptxCash;

    // Assets: Accounts Receivable (outstanding invoices)
    const arResult = await safeQuery(
      `SELECT COALESCE(SUM(total - paid_amount),0) as total FROM invoices WHERE tenant_id=$1 AND status NOT IN ('paid','cancelled') AND total > paid_amount AND issue_date <= $2`,
      [t, asOfDate]
    );
    const accountsReceivable = Number(arResult[0]?.total || 0);

    const totalAssets = totalCashAndBank + accountsReceivable;

    // Liabilities: Accounts Payable (unpaid expenses)
    const hasExpenses = await tableExists('expenses');
    let accountsPayable = 0;
    if (hasExpenses) {
      const apResult = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date <= $2`,
        [t, asOfDate]
      );
      accountsPayable = Number(apResult[0]?.total || 0);
    }

    // Deferred Revenue (advance payments — payments received but not yet invoiced)
    const deferredResult = await safeQuery(
      `SELECT COALESCE(SUM(paid_amount) - SUM(total),0) as total FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND paid_amount > total AND issue_date <= $2`,
      [t, asOfDate]
    );
    const deferredRevenue = Math.max(0, Number(deferredResult[0]?.total || 0));

    const totalLiabilities = accountsPayable + deferredRevenue;

    // Equity: Retained Earnings (accumulated net income up to as-of date)
    // Revenue
    const revResult = await safeQuery(
      `SELECT COALESCE(SUM(paid_amount),0) as total FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND issue_date <= $2`,
      [t, asOfDate]
    );
    const accInvoiceRev = Number(revResult[0]?.total || 0);

    const accFeeRev = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date <= $2`,
      [t, asOfDate]
    );
    const accFeeRevenue = Number(accFeeRev[0]?.total || 0);

    const accPtxRev = await safeQuery(
      `SELECT COALESCE(SUM(net_amount),0) as total FROM payment_transactions WHERE tenant_id=$1 AND status='completed' AND created_at <= $2+' 23:59:59'`,
      [t, asOfDate]
    );
    const accPtxRevenue = Number(accPtxRev[0]?.total || 0);

    const accTotalRevenue = accInvoiceRev + accFeeRevenue + accPtxRevenue;
    const accTotalExpenses = accountsPayable; // Simplified: all expenses are liabilities
    const retainedEarnings = accTotalRevenue - accTotalExpenses;

    const totalEquity = retainedEarnings;
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    const balanceCheck = totalAssets - totalLiabilitiesAndEquity;
    const isBalanced = Math.abs(balanceCheck) < 1;

    let html = `<style>${FR_CSS}</style>`;
    html += `<form method="GET" action="/financial-reports/balance-sheet">`;
    html += TABS('bs');
    html += `<div style="padding:1rem;max-width:1100px;margin:0 auto">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:22px;color:#1e293b;margin:0">&#9878; Balance Sheet</h1>
      <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">As of ${esc(asOfDate)}</p></div>
      <div style="display:flex;gap:8px">
        <a href="/financial-reports/balance-sheet?as_of_date=${asOfDate}&export=csv" class="fr-btn fr-btn-secondary">&#11015; Export CSV</a>
        <button type="button" onclick="window.print()" class="fr-btn fr-btn-secondary">&#128424; Print</button>
      </div>
    </div>`;
    html += `<div class="fr-filter no-print">
      <div><label>As of Date</label><input type="date" name="as_of_date" value="${esc(asOfDate)}"></div>
      <button type="submit" class="fr-btn fr-btn-primary">Apply</button>
    </div>`;

    // Balance Sheet Table
    html += `<div class="fr-card">`;
    html += `<table class="fr-table">`;

    // ASSETS
    html += `<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;font-size:14px;color:#059669;padding:12px">ASSETS</td></tr>`;
    html += `<tr><td style="padding-left:24px">Cash & Bank</td><td style="text-align:right">${fmtUGX(totalCashAndBank)}</td></tr>`;
    html += `<tr><td style="padding-left:40px;font-size:12px;color:#6b7280">Payments Received</td><td style="text-align:right;font-size:12px;color:#6b7280">${fmtUGX(cashAndBank)}</td></tr>`;
    html += `<tr><td style="padding-left:40px;font-size:12px;color:#6b7280">Fee Receipts</td><td style="text-align:right;font-size:12px;color:#6b7280">${fmtUGX(feeCash)}</td></tr>`;
    html += `<tr><td style="padding-left:40px;font-size:12px;color:#6b7280">Transaction Proceeds</td><td style="text-align:right;font-size:12px;color:#6b7280">${fmtUGX(ptxCash)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Accounts Receivable</td><td style="text-align:right">${fmtUGX(accountsReceivable)}</td></tr>`;
    html += `<tr class="subtotal"><td>Total Assets</td><td style="text-align:right">${fmtUGX(totalAssets)}</td></tr>`;

    // LIABILITIES
    html += `<tr><td colspan="2" style="background:#fef2f2;font-weight:700;font-size:14px;color:#dc2626;padding:12px">LIABILITIES</td></tr>`;
    if (hasExpenses) {
      html += `<tr><td style="padding-left:24px">Accounts Payable</td><td style="text-align:right">${fmtUGX(accountsPayable)}</td></tr>`;
    }
    html += `<tr><td style="padding-left:24px">Deferred Revenue</td><td style="text-align:right">${fmtUGX(deferredRevenue)}</td></tr>`;
    html += `<tr class="subtotal"><td>Total Liabilities</td><td style="text-align:right;color:#dc2626">${fmtUGX(totalLiabilities)}</td></tr>`;

    // EQUITY
    html += `<tr><td colspan="2" style="background:#eef2ff;font-weight:700;font-size:14px;color:#4f46e5;padding:12px">EQUITY</td></tr>`;
    html += `<tr><td style="padding-left:24px">Retained Earnings (Accumulated)</td><td style="text-align:right">${fmtUGX(retainedEarnings)}</td></tr>`;
    html += `<tr class="subtotal"><td>Total Equity</td><td style="text-align:right">${fmtUGX(totalEquity)}</td></tr>`;

    // BALANCE CHECK
    html += `<tr><td colspan="2" style="background:#f8fafc;font-weight:700;font-size:14px;padding:12px">BALANCE VERIFICATION</td></tr>`;
    html += `<tr><td>Total Assets</td><td style="text-align:right">${fmtUGX(totalAssets)}</td></tr>`;
    html += `<tr><td>Total Liabilities + Equity</td><td style="text-align:right">${fmtUGX(totalLiabilitiesAndEquity)}</td></tr>`;
    html += `<tr class="${isBalanced?'subtotal':'total'}"><td>Difference</td><td style="text-align:right;color:${isBalanced?'#059669':'#dc2626'}">${isBalanced?'BALANCED':fmtUGX(balanceCheck)}</td></tr>`;

    html += `</table></div>`;
    html += `</div></form>`;

    // CSV Export
    if (req.query.export === 'csv') {
      const rows = [
        { Section: 'ASSETS', Item: 'Cash & Bank', Amount: totalCashAndBank },
        { Section: 'ASSETS', Item: '  Payments Received', Amount: cashAndBank },
        { Section: 'ASSETS', Item: '  Fee Receipts', Amount: feeCash },
        { Section: 'ASSETS', Item: '  Transaction Proceeds', Amount: ptxCash },
        { Section: 'ASSETS', Item: 'Accounts Receivable', Amount: accountsReceivable },
        { Section: 'ASSETS', Item: 'Total Assets', Amount: totalAssets },
        { Section: 'LIABILITIES', Item: 'Accounts Payable', Amount: accountsPayable },
        { Section: 'LIABILITIES', Item: 'Deferred Revenue', Amount: deferredRevenue },
        { Section: 'LIABILITIES', Item: 'Total Liabilities', Amount: totalLiabilities },
        { Section: 'EQUITY', Item: 'Retained Earnings', Amount: retainedEarnings },
        { Section: 'EQUITY', Item: 'Total Equity', Amount: totalEquity },
        { Section: 'CHECK', Item: 'Total Assets', Amount: totalAssets },
        { Section: 'CHECK', Item: 'Total Liabilities + Equity', Amount: totalLiabilitiesAndEquity },
        { Section: 'CHECK', Item: 'Difference', Amount: balanceCheck },
      ];
      return sendCSV(res, `balance-sheet-${asOfDate}.csv`, ['Section', 'Item', 'Amount'], rows);
    }

    res.send(renderPage('Balance Sheet', html, req.session.user, req));
  }));

  /* ============================================================
     ROUTE 4: GET /financial-reports/cash-flow — Cash Flow Statement
     ============================================================ */
  app.get('/financial-reports/cash-flow', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const { fromDate, toDate, period } = getDateRange(req);

    // Operating: Cash from invoices
    const invCash = await safeQuery(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE tenant_id=$1 AND status='completed' AND created_at >= $2 AND created_at <= $3+' 23:59:59'`,
      [t, fromDate, toDate]
    );
    const cashFromInvoices = Number(invCash[0]?.total || 0);

    // Operating: Cash from fees
    const feeCash = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date >= $2 AND payment_date <= $3`,
      [t, fromDate, toDate]
    );
    const cashFromFees = Number(feeCash[0]?.total || 0);

    // Operating: Cash paid for expenses
    const hasExpenses = await tableExists('expenses');
    let cashPaidForExpenses = 0;
    if (hasExpenses) {
      const expCash = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 AND date >= $2 AND date <= $3`,
        [t, fromDate, toDate]
      );
      cashPaidForExpenses = Number(expCash[0]?.total || 0);
    }

    // Operating: Cash paid for salaries
    const hasSalary = await tableExists('salary_payments');
    let cashPaidForSalaries = 0;
    if (hasSalary) {
      const salCash = await safeQuery(
        `SELECT COALESCE(SUM(amount),0) as total FROM salary_payments WHERE tenant_id=$1`,
        [t]
      );
      cashPaidForSalaries = Number(salCash[0]?.total || 0);
    }

    const netOperatingCashFlow = (cashFromInvoices + cashFromFees) - cashPaidForExpenses - cashPaidForSalaries;

    // Beginning cash balance (all payments received before fromDate)
    const begCash = await safeQuery(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE tenant_id=$1 AND status='completed' AND created_at < $2`,
      [t, fromDate]
    );
    const begFeeCash = await safeQuery(
      `SELECT COALESCE(SUM(amount_paid),0) as total FROM fee_receipts WHERE tenant_id=$1 AND payment_date < $2`,
      [t, fromDate]
    );
    const beginningCashBalance = Number(begCash[0]?.total || 0) + Number(begFeeCash[0]?.total || 0);
    const endingCashBalance = beginningCashBalance + netOperatingCashFlow;

    let html = `<style>${FR_CSS}</style>`;
    html += `<form method="GET" action="/financial-reports/cash-flow">`;
    html += TABS('cf');
    html += `<div style="padding:1rem;max-width:1100px;margin:0 auto">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:22px;color:#1e293b;margin:0">&#127974; Cash Flow Statement</h1>
      <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">${esc(fromDate)} to ${esc(toDate)}</p></div>
      <div style="display:flex;gap:8px">
        <a href="/financial-reports/cash-flow?period=${period}&from_date=${fromDate}&to_date=${toDate}&export=csv" class="fr-btn fr-btn-secondary">&#11015; Export CSV</a>
        <button type="button" onclick="window.print()" class="fr-btn fr-btn-secondary">&#128424; Print</button>
      </div>
    </div>`;
    html += periodSelector(period, fromDate, toDate);

    // Cash Flow Table
    html += `<div class="fr-card">`;
    html += `<table class="fr-table">`;

    // OPERATING ACTIVITIES
    html += `<tr><td colspan="2" style="background:#f0fdf4;font-weight:700;font-size:14px;color:#059669;padding:12px">OPERATING ACTIVITIES</td></tr>`;
    html += `<tr><td style="padding-left:24px">Cash Received from Invoices</td><td style="text-align:right;color:#059669">${fmtUGX(cashFromInvoices)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Cash Received from Fees</td><td style="text-align:right;color:#059669">${fmtUGX(cashFromFees)}</td></tr>`;
    html += `<tr><td style="padding-left:24px">Cash Paid for Expenses</td><td style="text-align:right;color:#dc2626">(${fmtUGX(cashPaidForExpenses)})</td></tr>`;
    if (hasSalary) {
      html += `<tr><td style="padding-left:24px">Cash Paid for Salaries</td><td style="text-align:right;color:#dc2626">(${fmtUGX(cashPaidForSalaries)})</td></tr>`;
    }
    html += `<tr class="subtotal"><td>Net Operating Cash Flow</td><td style="text-align:right;color:${netOperatingCashFlow>=0?'#059669':'#dc2626'}">${fmtUGX(netOperatingCashFlow)}</td></tr>`;

    // INVESTING ACTIVITIES
    html += `<tr><td colspan="2" style="background:#eef2ff;font-weight:700;font-size:14px;color:#4f46e5;padding:12px">INVESTING ACTIVITIES</td></tr>`;
    html += `<tr><td style="padding-left:24px;color:#94a3b8">Asset Purchases</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;
    html += `<tr><td style="padding-left:24px;color:#94a3b8">Asset Disposals</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;
    html += `<tr class="subtotal"><td>Net Investing Cash Flow</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;

    // FINANCING ACTIVITIES
    html += `<tr><td colspan="2" style="background:#fef3c7;font-weight:700;font-size:14px;color:#92400e;padding:12px">FINANCING ACTIVITIES</td></tr>`;
    html += `<tr><td style="padding-left:24px;color:#94a3b8">Loans Received</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;
    html += `<tr><td style="padding-left:24px;color:#94a3b8">Loan Repayments</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;
    html += `<tr><td style="padding-left:24px;color:#94a3b8">Investments Received</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;
    html += `<tr class="subtotal"><td>Net Financing Cash Flow</td><td style="text-align:right;color:#94a3b8">UGX 0</td></tr>`;

    // NET CHANGE
    html += `<tr><td colspan="2" style="background:#1e293b;font-weight:700;font-size:14px;color:#fff;padding:12px">NET CHANGE IN CASH</td></tr>`;
    html += `<tr class="total"><td>Net Change in Cash</td><td style="text-align:right">${fmtUGX(netOperatingCashFlow)}</td></tr>`;
    html += `<tr><td>Beginning Cash Balance</td><td style="text-align:right">${fmtUGX(beginningCashBalance)}</td></tr>`;
    html += `<tr class="total"><td>Ending Cash Balance</td><td style="text-align:right">${fmtUGX(endingCashBalance)}</td></tr>`;

    html += `</table></div>`;

    // Quick stats
    html += `<div class="fr-grid" style="margin-top:20px">
      <div class="fr-card"><h3>Net Operating Cash Flow</h3><div class="val" style="color:${netOperatingCashFlow>=0?'#059669':'#dc2626'}">${fmtUGX(netOperatingCashFlow)}</div></div>
      <div class="fr-card"><h3>Beginning Balance</h3><div class="val">${fmtUGX(beginningCashBalance)}</div></div>
      <div class="fr-card"><h3>Ending Balance</h3><div class="val" style="color:${endingCashBalance>=0?'#059669':'#dc2626'}">${fmtUGX(endingCashBalance)}</div></div>
    </div>`;

    html += `</div></form>`;

    // CSV Export
    if (req.query.export === 'csv') {
      const rows = [
        { Section: 'OPERATING', Item: 'Cash from Invoices', Amount: cashFromInvoices },
        { Section: 'OPERATING', Item: 'Cash from Fees', Amount: cashFromFees },
        { Section: 'OPERATING', Item: 'Cash Paid for Expenses', Amount: -cashPaidForExpenses },
        { Section: 'OPERATING', Item: 'Cash Paid for Salaries', Amount: -cashPaidForSalaries },
        { Section: 'OPERATING', Item: 'Net Operating Cash Flow', Amount: netOperatingCashFlow },
        { Section: 'INVESTING', Item: 'Net Investing Cash Flow', Amount: 0 },
        { Section: 'FINANCING', Item: 'Net Financing Cash Flow', Amount: 0 },
        { Section: 'SUMMARY', Item: 'Net Change in Cash', Amount: netOperatingCashFlow },
        { Section: 'SUMMARY', Item: 'Beginning Cash Balance', Amount: beginningCashBalance },
        { Section: 'SUMMARY', Item: 'Ending Cash Balance', Amount: endingCashBalance },
      ];
      return sendCSV(res, `cash-flow-${fromDate}-to-${toDate}.csv`, ['Section', 'Item', 'Amount'], rows);
    }

    res.send(renderPage('Cash Flow Statement', html, req.session.user, req));
  }));

  /* ============================================================
     ROUTE 5: GET /financial-reports/receivables — A/R Aging
     ============================================================ */
  app.get('/financial-reports/receivables', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);

    // Get all outstanding invoices with client info
    const invoices = await safeQuery(
      `SELECT id, total, tax_amount, discount, paid_amount, status, issue_date, due_date,
              COALESCE(total - paid_amount, 0) as balance,
              CASE WHEN due_date IS NOT NULL THEN CURRENT_DATE - due_date ELSE 0 END as days_overdue
       FROM invoices WHERE tenant_id=$1 AND status NOT IN ('paid','cancelled') AND total > paid_amount
       ORDER BY due_date ASC`,
      [t]
    );

    // Aging buckets
    const current = invoices.filter(i => i.days_overdue <= 30);
    const days31_60 = invoices.filter(i => i.days_overdue > 30 && i.days_overdue <= 60);
    const days61_90 = invoices.filter(i => i.days_overdue > 60 && i.days_overdue <= 90);
    const over90 = invoices.filter(i => i.days_overdue > 90);

    const sumBucket = (arr) => arr.reduce((s, i) => s + Number(i.balance), 0);
    const totalOutstanding = sumBucket(invoices);

    let html = `<style>${FR_CSS}</style>`;
    html += TABS('ar');
    html += `<div style="padding:1rem;max-width:1200px;margin:0 auto">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
      <div><h1 style="font-size:22px;color:#1e293b;margin:0">&#128203; Accounts Receivable Aging</h1>
      <p style="font-size:13px;color:#94a3b8;margin:2px 0 0">As of ${today()}</p></div>
      <div style="display:flex;gap:8px">
        <a href="/financial-reports/receivables?export=csv" class="fr-btn fr-btn-secondary">&#11015; Export CSV</a>
        <button type="button" onclick="window.print()" class="fr-btn fr-btn-secondary">&#128424; Print</button>
      </div>
    </div>`;

    // Summary cards
    html += `<div class="fr-grid">
      <div class="fr-card"><h3>Current (0-30 days)</h3><div class="val" style="color:#059669">${fmtUGX(sumBucket(current))}</div><div class="sub">${current.length} invoices</div></div>
      <div class="fr-card"><h3>31-60 Days</h3><div class="val" style="color:#d97706">${fmtUGX(sumBucket(days31_60))}</div><div class="sub">${days31_60.length} invoices</div></div>
      <div class="fr-card"><h3>61-90 Days</h3><div class="val" style="color:#ea580c">${fmtUGX(sumBucket(days61_90))}</div><div class="sub">${days61_90.length} invoices</div></div>
      <div class="fr-card"><h3>Over 90 Days</h3><div class="val" style="color:#dc2626">${fmtUGX(sumBucket(over90))}</div><div class="sub">${over90.length} invoices</div></div>
    </div>`;

    // Total outstanding
    html += `<div class="fr-card" style="margin-top:16px;text-align:center;background:#1e293b">
      <h3 style="color:#94a3b8">Total Outstanding</h3>
      <div class="val" style="color:#fff;font-size:2rem">${fmtUGX(totalOutstanding)}</div>
      <div class="sub" style="color:#94a3b8">${invoices.length} outstanding invoices</div>
    </div>`;

    // Aging bar visualization
    const maxVal = Math.max(sumBucket(current), sumBucket(days31_60), sumBucket(days61_90), sumBucket(over90), 1);
    html += `<div style="margin-top:20px;display:flex;gap:4px;align-items:flex-end;height:60px;border-bottom:2px solid #e5e7eb">
      <div style="flex:1;background:#059669;border-radius:4px 4px 0 0;height:${Math.max(2, sumBucket(current)/maxVal*55)}px" title="Current: ${fmtUGX(sumBucket(current))}"></div>
      <div style="flex:1;background:#d97706;border-radius:4px 4px 0 0;height:${Math.max(2, sumBucket(days31_60)/maxVal*55)}px" title="31-60: ${fmtUGX(sumBucket(days31_60))}"></div>
      <div style="flex:1;background:#ea580c;border-radius:4px 4px 0 0;height:${Math.max(2, sumBucket(days61_90)/maxVal*55)}px" title="61-90: ${fmtUGX(sumBucket(days61_90))}"></div>
      <div style="flex:1;background:#dc2626;border-radius:4px 4px 0 0;height:${Math.max(2, sumBucket(over90)/maxVal*55)}px" title="90+: ${fmtUGX(sumBucket(over90))}"></div>
    </div>
    <div style="display:flex;gap:4px;font-size:11px;color:#6b7280;margin-bottom:20px">
      <div style="flex:1;text-align:center">Current</div>
      <div style="flex:1;text-align:center">31-60</div>
      <div style="flex:1;text-align:center">61-90</div>
      <div style="flex:1;text-align:center">90+</div>
    </div>`;

    // Detail table by bucket
    const renderBucket = (title, rows, color) => {
      if (!rows.length) return '';
      let h = `<div class="fr-section" style="color:${color}">${title} (${rows.length} invoices)</div>`;
      h += `<div class="fr-card"><table class="fr-table"><tr><th>Invoice #</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Issue Date</th><th>Due Date</th><th>Days Overdue</th><th>Status</th></tr>`;
      rows.forEach(inv => {
        const days = Math.max(0, inv.days_overdue);
        const statusBadge = days === 0 ? 'fr-green' : days <= 30 ? 'fr-amber' : days <= 60 ? 'fr-amber' : 'fr-red';
        h += `<tr>
          <td><strong>#${esc(inv.id)}</strong></td>
          <td>${fmtUGX(inv.total)}</td>
          <td>${fmtUGX(inv.paid_amount)}</td>
          <td style="font-weight:600">${fmtUGX(inv.balance)}</td>
          <td>${esc(inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : '-')}</td>
          <td>${esc(inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '-')}</td>
          <td><span class="fr-badge ${statusBadge}">${days} days</span></td>
          <td>${esc(inv.status)}</td>
        </tr>`;
      });
      h += `<tr class="subtotal"><td colspan="3">Bucket Total</td><td>${fmtUGX(sumBucket(rows))}</td><td colspan="4"></td></tr>`;
      h += `</table></div>`;
      return h;
    };

    html += renderBucket('Current (0-30 days)', current, '#059669');
    html += renderBucket('31-60 Days Overdue', days31_60, '#d97706');
    html += renderBucket('61-90 Days Overdue', days61_90, '#ea580c');
    html += renderBucket('Over 90 Days Overdue', over90, '#dc2626');

    if (invoices.length === 0) {
      html += `<div style="text-align:center;padding:60px 20px;color:#94a3b8">
        <div style="font-size:48px;margin-bottom:12px">&#127881;</div>
        <h3>No Outstanding Invoices</h3>
        <p>All invoices are paid up. Great job!</p>
      </div>`;
    }

    html += `</div>`;

    // CSV Export
    if (req.query.export === 'csv') {
      const csvRows = invoices.map(inv => ({
        'Invoice #': inv.id,
        'Total': Number(inv.total),
        'Paid': Number(inv.paid_amount),
        'Balance': Number(inv.balance),
        'Issue Date': inv.issue_date,
        'Due Date': inv.due_date,
        'Days Overdue': Math.max(0, inv.days_overdue),
        'Aging Bucket': inv.days_overdue <= 30 ? 'Current' : inv.days_overdue <= 60 ? '31-60' : inv.days_overdue <= 90 ? '61-90' : '90+',
        'Status': inv.status
      }));
      return sendCSV(res, `receivables-aging-${today()}.csv`,
        ['Invoice #', 'Total', 'Paid', 'Balance', 'Issue Date', 'Due Date', 'Days Overdue', 'Aging Bucket', 'Status'],
        csvRows
      );
    }

    res.send(renderPage('Accounts Receivable Aging', html, req.session.user, req));
  }));

  /* ============================================================
     API ROUTES: Chart data endpoints (JSON)
     ============================================================ */

  // GET /api/reports/revenue-chart?period=month
  app.get('/api/reports/revenue-chart', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const periodType = req.query.period || 'month';

    let sql, params;
    if (periodType === 'quarter') {
      sql = `SELECT TO_CHAR(issue_date, 'YYYY-"Q"Q') as label, COALESCE(SUM(paid_amount),0) as value
             FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial')
             GROUP BY label ORDER BY MIN(issue_date)`;
      params = [t];
    } else if (periodType === 'year') {
      sql = `SELECT TO_CHAR(issue_date, 'YYYY') as label, COALESCE(SUM(paid_amount),0) as value
             FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial')
             GROUP BY label ORDER BY label`;
      params = [t];
    } else {
      sql = `SELECT TO_CHAR(issue_date, 'YYYY-MM') as label, COALESCE(SUM(paid_amount),0) as value
             FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partial') AND issue_date >= NOW() - INTERVAL '12 months'
             GROUP BY label ORDER BY label`;
      params = [t];
    }

    const invoiceData = await safeQuery(sql, params);

    // Fee data
    let feeSql, feeParams;
    if (periodType === 'quarter') {
      feeSql = `SELECT TO_CHAR(payment_date, 'YYYY-"Q"Q') as label, COALESCE(SUM(amount_paid),0) as value FROM fee_receipts WHERE tenant_id=$1 GROUP BY label ORDER BY MIN(payment_date)`;
      feeParams = [t];
    } else if (periodType === 'year') {
      feeSql = `SELECT TO_CHAR(payment_date, 'YYYY') as label, COALESCE(SUM(amount_paid),0) as value FROM fee_receipts WHERE tenant_id=$1 GROUP BY label ORDER BY label`;
      feeParams = [t];
    } else {
      feeSql = `SELECT TO_CHAR(payment_date, 'YYYY-MM') as label, COALESCE(SUM(amount_paid),0) as value FROM fee_receipts WHERE tenant_id=$1 AND payment_date >= NOW() - INTERVAL '12 months' GROUP BY label ORDER BY label`;
      feeParams = [t];
    }
    const feeData = await safeQuery(feeSql, feeParams);

    res.json({
      period: periodType,
      invoices: invoiceData.map(r => ({ label: r.label, value: Number(r.value) })),
      fees: feeData.map(r => ({ label: r.label, value: Number(r.value) }))
    });
  }));

  // GET /api/reports/expense-chart?period=month
  app.get('/api/reports/expense-chart', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const periodType = req.query.period || 'month';
    const hasExp = await tableExists('expenses');

    if (!hasExp) {
      return res.json({ period: periodType, expenses: [], categories: [] });
    }

    let sql, params;
    if (periodType === 'quarter') {
      sql = `SELECT TO_CHAR(date, 'YYYY-"Q"Q') as label, COALESCE(SUM(amount),0) as value FROM expenses WHERE tenant_id=$1 GROUP BY label ORDER BY MIN(date)`;
      params = [t];
    } else if (periodType === 'year') {
      sql = `SELECT TO_CHAR(date, 'YYYY') as label, COALESCE(SUM(amount),0) as value FROM expenses WHERE tenant_id=$1 GROUP BY label ORDER BY label`;
      params = [t];
    } else {
      sql = `SELECT TO_CHAR(date, 'YYYY-MM') as label, COALESCE(SUM(amount),0) as value FROM expenses WHERE tenant_id=$1 AND date >= NOW() - INTERVAL '12 months' GROUP BY label ORDER BY label`;
      params = [t];
    }
    const expenses = await safeQuery(sql, params);

    // By category
    const categories = await safeQuery(
      `SELECT COALESCE(category,'Uncategorized') as category, COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC`,
      [t]
    );

    res.json({
      period: periodType,
      expenses: expenses.map(r => ({ label: r.label, value: Number(r.value) })),
      categories: categories.map(r => ({ category: r.category, value: Number(r.total) }))
    });
  }));

  // GET /api/reports/cashflow-chart?period=month
  app.get('/api/reports/cashflow-chart', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const periodType = req.query.period || 'month';

    const periodExpr = periodType === 'year'
      ? `TO_CHAR(created_at, 'YYYY')`
      : periodType === 'quarter'
        ? `TO_CHAR(created_at, 'YYYY-"Q"Q')`
        : `TO_CHAR(created_at, 'YYYY-MM')`;

    // Inflows (payments)
    const inflows = await safeQuery(
      `SELECT ${periodExpr} as label, COALESCE(SUM(amount),0) as value FROM payments WHERE tenant_id=$1 AND status='completed' AND created_at >= NOW() - INTERVAL '12 months' GROUP BY label ORDER BY MIN(created_at)`,
      [t]
    );

    // Outflows (expenses)
    const hasExp = await tableExists('expenses');
    let outflows = [];
    if (hasExp) {
      outflows = await safeQuery(
        `SELECT ${periodExpr} as label, COALESCE(SUM(amount),0) as value FROM expenses WHERE tenant_id=$1 AND date >= NOW() - INTERVAL '12 months' GROUP BY label ORDER BY MIN(date)`,
        [t]
      );
    }

    // Compute net cash flow per period
    const allLabels = new Set([...inflows.map(r => r.label), ...outflows.map(r => r.label)]);
    const inflowMap = Object.fromEntries(inflows.map(r => [r.label, Number(r.value)]));
    const outflowMap = Object.fromEntries(outflows.map(r => [r.label, Number(r.value)]));

    const net = [...allLabels].sort().map(label => ({
      label,
      inflow: inflowMap[label] || 0,
      outflow: outflowMap[label] || 0,
      net: (inflowMap[label] || 0) - (outflowMap[label] || 0)
    }));

    res.json({
      period: periodType,
      inflows: inflows.map(r => ({ label: r.label, value: Number(r.value) })),
      outflows: outflows.map(r => ({ label: r.label, value: Number(r.value) })),
      net
    });
  }));

  console.log('[FinancialReports] Per-tenant financial reporting loaded — 5 page routes + 3 API endpoints');
};
