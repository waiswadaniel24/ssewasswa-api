// ============================================================
// FINANCIAL SUITE MODULE — Comfort Zone Multi-Tenant SaaS
// Unified billing, invoices, payments, expenses, and reports.
// Usage: const finSuite = require('./financial-suite-routes');
//        finSuite(app, pool, { esc, renderPage, ah, requireAuth, audit });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ── helpers ────────────────────────────────────────────
  const fmtMoney = (n, curr) => {
    const amount = Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return (curr==='USD'?'$':curr?curr+' ':'') + amount;
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const invBadge = (status) => {
    const m = {
      draft:{bg:'#f1f5f9',c:'#64748b',l:'Draft'}, sent:{bg:'#dbeafe',c:'#2563eb',l:'Sent'},
      paid:{bg:'#dcfce7',c:'#16a34a',l:'Paid'}, partially_paid:{bg:'#fef3c7',c:'#d97706',l:'Partial'},
      overdue:{bg:'#fee2e2',c:'#dc2626',l:'Overdue'}, cancelled:{bg:'#f3f4f6',c:'#6b7280',l:'Cancelled'}
    };
    const s = m[status] || m.draft;
    return `<span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${s.l}</span>`;
  };
  const txBadge = (type) => {
    const m = {income:{bg:'#dcfce7',c:'#16a34a'}, expense:{bg:'#fee2e2',c:'#dc2626'}, refund:{bg:'#dbeafe',c:'#2563eb'}};
    const s = m[type] || {bg:'#f1f5f9',c:'#64748b'};
    return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${esc(type)}</span>`;
  };

  // ── CSS ────────────────────────────────────────────────
  const FIN_CSS = `<style>
.fin-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.fin-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.fin-nav a:hover{background:#e2e8f0}.fin-nav a.active{background:#4f46e5;color:#fff}
.fin-tbl{width:100%;border-collapse:collapse;font-size:13px}
.fin-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;white-space:nowrap}
.fin-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.fin-tbl tr:hover{background:#f8fafc}
.fin-tbl td.right,.fin-tbl th.right{text-align:right}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}
.stat-card .num{font-size:24px;font-weight:800;color:#1e293b}
.stat-card .label{font-size:12px;color:#94a3b8;margin-top:4px}
.stat-card .icon{font-size:28px;margin-bottom:8px}
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.filter-bar input,.filter-bar select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.filter-bar label{font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px}
.pagination{display:flex;gap:6px;justify-content:center;margin-top:16px}
.pagination a,.pagination span{padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9}
.pagination a:hover{background:#e2e8f0}.pagination span.current{background:#4f46e5;color:#fff}
.fin-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px}
.inv-view{max-width:780px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
.inv-view-header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:28px 32px}
.inv-view-body{padding:28px 32px}
.items-tbl{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
.items-tbl th{background:#f8fafc;padding:10px 12px;text-align:left;border:1px solid #e2e8f0;font-weight:700;font-size:11px;color:#64748b}
.items-tbl td{padding:10px 12px;border:1px solid #f1f5f9}
.inv-totals{margin-left:auto;width:280px}
.inv-totals .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#475569}
.inv-totals .row.total{border-top:2px solid #4f46e5;font-size:16px;font-weight:800;color:#1e293b;padding-top:10px;margin-top:6px}
.chart-bar{display:flex;align-items:end;gap:8px;height:180px;padding:0 4px}
.chart-bar .bar{flex:1;border-radius:6px 6px 0 0;min-width:30px;position:relative;transition:.2s}
.chart-bar .bar:hover{opacity:.8}
.chart-bar .bar-label{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);font-size:10px;color:#94a3b8;white-space:nowrap}
.chart-bar .bar-value{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#475569}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.stat-cards{grid-template-columns:1fr 1fr}.inv-totals{width:100%}}
</style>`;

  // ── navigation bar ─────────────────────────────────────
  function nav(active) {
    const links = [
      ['/financial','Dashboard'],['/financial/invoices','Invoices'],['/financial/expenses','Expenses'],
      ['/financial/reports','Reports'],['/financial/transactions','Transactions']
    ];
    return '<div class="fin-nav">' + links.map(([href,label]) =>
      `<a href="${href}" class="${active===href?'active':''}">${label}</a>`).join('') + '</div>';
  }

  // ── pagination HTML ────────────────────────────────────
  function paginationHtml(page, total, baseUrl) {
    const pages = Math.ceil(total/20);
    if (pages <= 1) return '';
    let h = '<div class="pagination">';
    if (page > 1) h += `<a href="${baseUrl}?page=${page-1}">&laquo; Prev</a>`;
    for (let i = Math.max(1,page-2); i <= Math.min(pages,page+2); i++)
      h += i===page ? `<span class="current">${i}</span>` : `<a href="${baseUrl}?page=${i}">${i}</a>`;
    if (page < pages) h += `<a href="${baseUrl}?page=${page+1}">Next &raquo;</a>`;
    return h + '</div>';
  }

  // ── form field helpers ─────────────────────────────────
  function field(label, name, type, val, extra) {
    extra = extra || {};
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val||''))}" ${extra.required?'required':''}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"
        ${extra.placeholder?'placeholder="'+esc(extra.placeholder)+'"':''}></div>`;
  }
  function selectField(label, name, options, val) {
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <select name="${name}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${options.map(([v,l]) =>
      `<option value="${esc(v)}" ${val===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
  }

  // ══════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ══════════════════════════════════════════════════════════
  const migrations = [
    `CREATE TABLE IF NOT EXISTS fin_invoices (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      invoice_number VARCHAR(50) NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_email VARCHAR(255),
      amount DECIMAL(12,2) DEFAULT 0,
      tax DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'draft',
      due_date DATE,
      paid_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
      description VARCHAR(500),
      quantity DECIMAL(10,2) DEFAULT 1,
      unit_price DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_expenses (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'UGX',
      expense_date DATE NOT NULL,
      receipt_url TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'UGX',
      reference VARCHAR(200),
      status VARCHAR(20) DEFAULT 'completed',
      method VARCHAR(50),
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fin_categories (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(20) NOT NULL,
      color VARCHAR(20) DEFAULT '#6366f1',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fin_inv_tenant ON fin_invoices(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_inv_status ON fin_invoices(tenant_id,status)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_inv_due ON fin_invoices(tenant_id,due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_inv_number ON fin_invoices(tenant_id,invoice_number)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_items_inv ON fin_invoice_items(invoice_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_exp_tenant ON fin_expenses(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_exp_cat ON fin_expenses(tenant_id,category)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_exp_date ON fin_expenses(tenant_id,expense_date)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_tx_tenant ON fin_transactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON fin_transactions(tenant_id,type)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON fin_transactions(tenant_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_cat_tenant ON fin_categories(tenant_id)`
  ];

  (async () => {
    try {
      for (const sql of migrations) await migrateQuery(pool, 'FinancialSuiteRoutes', sql);
      // Seed default categories if empty
      const catCount = (await migrateQuery(pool, 'FinancialSuiteRoutes', 'SELECT COUNT(*) FROM fin_categories WHERE tenant_id=0')).rows[0].count;
      if (parseInt(catCount) === 0) {
        await migrateQuery(pool, 'FinancialSuiteRoutes', `INSERT INTO fin_categories (tenant_id,name,type,color) VALUES
          (0,'Consulting','income','#16a34a'),(0,'Products','income','#2563eb'),(0,'Services','income','#7c3aed'),
          (0,'Rent','expense','#dc2626'),(0,'Utilities','expense','#d97706'),(0,'Salaries','expense','#ef4444'),
          (0,'Supplies','expense','#f59e0b'),(0,'Marketing','expense','#ec4899'),(0,'Transport','expense','#06b6d4')`);
      }
      console.log('[FinancialSuite] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) { console.error('[FinancialSuite] Migration error:', e.message); }
  })();

  // ── generate invoice number ────────────────────────────
  async function genInvoiceNum(tid) {
    const now = new Date();
    const prefix = `FIN-${tid}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
    const r = await pool.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number,'-',4) AS INTEGER)),0)+1 AS seq
       FROM fin_invoices WHERE tenant_id=$1 AND invoice_number LIKE $2`, [tid, prefix+'%']);
    return `${prefix}-${String(r.rows[0].seq).padStart(4,'0')}`;
  }

  // ══════════════════════════════════════════════════════════
  // GET /financial — Dashboard
  // ══════════════════════════════════════════════════════════
  app.get('/financial', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const stats = (await pool.query(`
      SELECT
        (SELECT COALESCE(SUM(total),0) FROM fin_invoices WHERE tenant_id=$1 AND status='paid'
          AND created_at >= date_trunc('month', CURRENT_DATE)) AS revenue,
        (SELECT COALESCE(SUM(total),0) FROM fin_invoices WHERE tenant_id=$1 AND status IN ('sent','draft')) AS pending,
        (SELECT COALESCE(SUM(total),0) FROM fin_invoices WHERE tenant_id=$1 AND status='overdue') AS overdue,
        (SELECT COALESCE(SUM(amount),0) FROM fin_expenses WHERE tenant_id=$1
          AND expense_date >= date_trunc('month', CURRENT_DATE)) AS expenses_month,
        (SELECT COUNT(*) FROM fin_invoices WHERE tenant_id=$1) AS total_invoices
    `, [tid])).rows[0];

    const recentTx = (await pool.query(`
      SELECT * FROM fin_transactions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8`, [tid])).rows;
    const recentHtml = recentTx.map(r => `<tr>
      <td>${txBadge(r.type)}</td>
      <td>${esc(r.description||r.reference||'N/A')}</td>
      <td class="right" style="color:${r.type==='income'?'#16a34a':'#dc2626'}">${r.type==='income'?'+':'−'}${fmtMoney(r.amount,r.currency)}</td>
      <td>${esc(r.method||'\u2014')}</td>
      <td>${fmtDate(r.created_at)}</td>
    </tr>`).join('');

    const chartData = (await pool.query(`
      SELECT TO_CHAR(created_at, 'Mon') AS mon, SUM(CASE WHEN status='paid' THEN total ELSE 0 END) AS rev
      FROM fin_invoices WHERE tenant_id=$1 AND created_at >= date_trunc('year',CURRENT_DATE)
      GROUP BY TO_CHAR(created_at,'Mon') ORDER BY MIN(created_at)
    `, [tid])).rows;
    const maxRev = Math.max(...chartData.map(c => Number(c.rev||0)), 1);
    const chartHtml = chartData.map(c => {
      const pct = Math.round((Number(c.rev||0)/maxRev)*100);
      return `<div class="bar" style="height:${Math.max(pct,4)}%;background:linear-gradient(to top,#4f46e5,#6366f1)">
        <div class="bar-value">${fmtMoney(c.rev,'')}</div><div class="bar-label">${esc(c.mon)}</div></div>`;
    }).join('');

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">&#x1F4CA; Financial Suite</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Revenue, invoices, expenses &amp; reports</p></div>
        <div style="display:flex;gap:8px">
          <a href="/financial/invoices" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ New Invoice</a>
          <a href="/financial/reports/export" class="btn" style="background:#16a34a;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">Export CSV</a>
        </div>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="icon">&#x1F4B0;</div><div class="num" style="color:#16a34a">${fmtMoney(stats.revenue)}</div><div class="label">Revenue (this month)</div></div>
        <div class="stat-card"><div class="icon">&#x23F3;</div><div class="num" style="color:#d97706">${fmtMoney(stats.pending)}</div><div class="label">Pending Invoices</div></div>
        <div class="stat-card"><div class="icon">&#x26A0;</div><div class="num" style="color:#dc2626">${fmtMoney(stats.overdue)}</div><div class="label">Overdue Amount</div></div>
        <div class="stat-card"><div class="icon">&#x1F4E6;</div><div class="num" style="color:#ef4444">${fmtMoney(stats.expenses_month)}</div><div class="label">Expenses (this month)</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">&#x1F4C8; Monthly Revenue</h3>
          <div style="height:200px;padding-bottom:24px">${chartHtml || '<div style="text-align:center;color:#94a3b8;padding:40px">No data yet</div>'}</div>
        </div>
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">&#x1F4E5; Recent Transactions</h3>
          <div style="overflow-x:auto"><table class="fin-tbl">
            <thead><tr><th>Type</th><th>Description</th><th>Amount</th><th>Method</th><th>Date</th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No transactions yet</td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:10px"><a href="/financial/transactions" style="font-size:13px;color:#4f46e5;text-decoration:none;font-weight:600">View All &rarr;</a></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Financial Dashboard', html, user, req));
    audit(req.session?.user?.email, 'fin_dashboard', 'Viewed financial dashboard');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/invoices — Invoice list
  // ══════════════════════════════════════════════════════════
  app.get('/financial/invoices', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || '';
    const search = req.query.q || '';
    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    if (status) { where += ' AND status=$2'; params.push(status); }
    if (search) { where += (status?' AND':' AND') + ' AND (invoice_number ILIKE $' + (params.length+1) + ' OR customer_name ILIKE $' + (params.length+1) + ')'; params.push('%'+search+'%'); }

    const count = (await pool.query(`SELECT COUNT(*) FROM fin_invoices ${where}`, params)).rows[0].count;
    const invoices = (await pool.query(
      `SELECT * FROM fin_invoices ${where} ORDER BY created_at DESC LIMIT 20 OFFSET $${params.length+1}`,
      [...params, (page-1)*20]
    )).rows;

    const rows = invoices.map(inv => `<tr>
      <td><a href="/financial/invoices/${inv.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(inv.invoice_number)}</a></td>
      <td>${esc(inv.customer_name)}</td>
      <td>${esc(inv.customer_email||'—')}</td>
      <td class="right">${fmtMoney(inv.total)}</td>
      <td>${fmtDate(inv.due_date)}</td>
      <td>${invBadge(inv.status)}</td>
      <td>
        <a href="/financial/invoices/${inv.id}" style="font-size:12px;color:#4f46e5;text-decoration:none">View</a>
        ${inv.status!=='paid' ? ` | <a href="/financial/invoices/${inv.id}" style="font-size:12px;color:#16a34a;text-decoration:none" onclick="document.getElementById('pay-form-${inv.id}').style.display='block';return false">Pay</a>` : ''}
      </td>
    </tr>`).join('');

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial/invoices')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4CB; Invoices</h1>
        <a href="/financial/invoices?action=create" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Create Invoice</a>
      </div>
      <div class="filter-bar">
        <div><label>Status</label>
          <select onchange="window.location='/financial/invoices?status='+this.value+'&q=${esc(search)}'">
            <option value="">All</option>
            <option value="draft" ${status==='draft'?'selected':''}>Draft</option>
            <option value="sent" ${status==='sent'?'selected':''}>Sent</option>
            <option value="paid" ${status==='paid'?'selected':''}>Paid</option>
            <option value="overdue" ${status==='overdue'?'selected':''}>Overdue</option>
          </select>
        </div>
        <div><label>Search</label>
          <form method="GET" action="/financial/invoices" style="display:flex;gap:6px">
            <input type="text" name="q" value="${esc(search)}" placeholder="Invoice # or customer...">
            <button type="submit" class="btn" style="background:#4f46e5;color:#fff;border:none;padding:9px 16px;border-radius:10px;font-size:13px">Search</button>
          </form>
        </div>
      </div>
      <div class="fin-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="fin-tbl">
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Email</th><th class="right">Total</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No invoices found</td></tr>'}</tbody>
        </table></div>
      </div>
      ${paginationHtml(page, parseInt(count), '/financial/invoices?status='+encodeURIComponent(status)+'&q='+encodeURIComponent(search))}
      <div style="margin-top:16px;text-align:right;color:#94a3b8;font-size:12px">${count} invoice(s) total</div>
    </div>`;
    res.send(renderPage('Invoices', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /financial/invoices — Create invoice
  // ══════════════════════════════════════════════════════════
  app.post('/financial/invoices', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { customer_name, customer_email, amount, tax, due_date, notes } = req.body;
    if (!customer_name || !customer_name.trim()) return res.status(400).send('Customer name required');

    const subtotal = parseFloat(amount) || 0;
    const taxAmt = parseFloat(tax) || 0;
    const total = subtotal + taxAmt;
    const invNum = await genInvoiceNum(tid);

    const r = await pool.query(
      `INSERT INTO fin_invoices (tenant_id,invoice_number,customer_name,customer_email,amount,tax,total,status,due_date,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',$8,$9) RETURNING id`,
      [tid, invNum, customer_name.trim(), (customer_email||'').trim()||null, subtotal, taxAmt, total, due_date||null, (notes||'').trim()||null]
    );
    const invId = r.rows[0].id;

    // Record transaction
    await pool.query(
      `INSERT INTO fin_transactions (tenant_id,type,amount,currency,reference,status,method,description)
       VALUES ($1,'income',$2,'UGX',$3,'completed','invoice','Invoice ${esc(invNum)}')`,
      [tid, total, invNum]);

    audit(user.email, 'fin_invoice_create', 'Created invoice ' + invNum);
    res.redirect('/financial/invoices/' + invId);
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/invoices/:id — Invoice detail
  // ══════════════════════════════════════════════════════════
  app.get('/financial/invoices/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;
    const inv = (await pool.query('SELECT * FROM fin_invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.status(404).send('Invoice not found');

    const items = (await pool.query(
      'SELECT * FROM fin_invoice_items WHERE invoice_id=$1 ORDER BY id', [id])).rows;
    const itemsHtml = items.map(it => `<tr>
      <td>${esc(it.description||'Item')}</td>
      <td class="right">${Number(it.quantity).toFixed(2)}</td>
      <td class="right">${fmtMoney(it.unit_price)}</td>
      <td class="right">${fmtMoney(it.total)}</td>
    </tr>`).join('');

    // Show create form if action=create query param
    if (req.query.action === 'create') {
      const html = FIN_CSS + `
      <div style="max-width:700px;margin:0 auto">
        ${nav('/financial/invoices')}
        <div class="fin-card">
          <h2 style="color:#1e293b;margin-bottom:20px">Create New Invoice</h2>
          <form method="POST" action="/financial/invoices">
            <div class="form-grid">
              ${field('Customer Name *', 'customer_name', 'text', '', {required:true, placeholder:'Acme Corp'})}
              ${field('Customer Email', 'customer_email', 'email', '', {placeholder:'billing@acme.com'})}
              ${field('Amount *', 'amount', 'number', '', {required:true, placeholder:'0.00'})}
              ${field('Tax', 'tax', 'number', '0', {placeholder:'0.00'})}
              ${field('Due Date', 'due_date', 'date', '')}
              <div></div>
            </div>
            <div style="margin-top:14px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Optional notes..."></textarea></div>
            <div style="display:flex;gap:10px;margin-top:20px">
              <button type="submit" class="btn" style="background:#4f46e5;color:#fff;padding:10px 24px;border:none;border-radius:10px;font-weight:600">Create &amp; Send</button>
              <a href="/financial/invoices" class="btn" style="padding:10px 24px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px">Cancel</a>
            </div>
          </form>
        </div>
      </div>`;
      return res.send(renderPage('Create Invoice', html, user, req));
    }

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial/invoices')}
      <a href="/financial/invoices" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Invoices</a>
      <div class="inv-view" style="position:relative">
        ${inv.status==='paid'?'<div style="position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);font-size:72px;font-weight:900;color:rgba(22,163,74,0.15);text-transform:uppercase;letter-spacing:8px;pointer-events:none">PAID</div>':''}
        <div class="inv-view-header">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div><h2 style="font-size:20px;margin-bottom:4px">Invoice ${esc(inv.invoice_number)}</h2>
              <p style="font-size:13px;opacity:.85">${esc(inv.customer_name)} &middot; ${esc(inv.customer_email||'No email')}</p></div>
            <div style="text-align:right"><div style="font-size:28px;font-weight:800">${fmtMoney(inv.total)}</div>
              <div style="margin-top:6px">${invBadge(inv.status)}</div></div>
          </div>
        </div>
        <div class="inv-view-body">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;font-size:13px">
            <div><span style="color:#94a3b8;font-weight:600">Amount</span><div style="color:#1e293b;font-weight:700;margin-top:2px">${fmtMoney(inv.amount)}</div></div>
            <div><span style="color:#94a3b8;font-weight:600">Tax</span><div style="color:#1e293b;font-weight:700;margin-top:2px">${fmtMoney(inv.tax)}</div></div>
            <div><span style="color:#94a3b8;font-weight:600">Due Date</span><div style="color:#1e293b;font-weight:700;margin-top:2px">${fmtDate(inv.due_date)}</div></div>
          </div>
          ${inv.notes ? `<div style="background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px;color:#475569"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ''}
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:8px">Line Items</h3>
          <table class="items-tbl">
            <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Total</th></tr></thead>
            <tbody>${itemsHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">No line items</td></tr>'}</tbody>
          </table>
          <div class="inv-totals">
            <div class="row"><span>Subtotal</span><span>${fmtMoney(inv.amount)}</span></div>
            <div class="row"><span>Tax</span><span>${fmtMoney(inv.tax)}</span></div>
            <div class="row total"><span>Total</span><span>${fmtMoney(inv.total)}</span></div>
          </div>
          ${inv.paid_at ? `<div style="margin-top:16px;padding:12px;background:#dcfce7;border-radius:8px;font-size:13px;color:#16a34a;font-weight:600">&#x2705; Paid on ${fmtDate(inv.paid_at)}</div>` : ''}
          <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
            ${inv.status!=='paid' ? `<form method="POST" action="/financial/invoices/${inv.id}/pay" style="display:inline">
              <input type="number" name="amount" value="${inv.total}" step="0.01" required style="width:140px;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px">
              <button type="submit" class="btn" style="background:#16a34a;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-weight:600;font-size:13px">Record Payment</button>
            </form>` : ''}
            <a href="/financial/invoices" class="btn" style="padding:8px 20px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px;font-size:13px">Back to List</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Invoice ' + inv.invoice_number, html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // PUT /financial/invoices/:id — Update invoice
  // ══════════════════════════════════════════════════════════
  app.put('/financial/invoices/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { customer_name, customer_email, amount, tax, status, due_date, notes } = req.body;
    const inv = (await pool.query('SELECT * FROM fin_invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.status(404).json({error:'Invoice not found'});

    const subtotal = parseFloat(amount) || inv.amount;
    const taxAmt = parseFloat(tax) || inv.tax;
    const total = subtotal + taxAmt;

    await pool.query(
      `UPDATE fin_invoices SET customer_name=$1,customer_email=$2,amount=$3,tax=$4,total=$5,
       status=COALESCE($6,status),due_date=COALESCE($7,due_date),notes=COALESCE($8,notes)
       WHERE id=$9 AND tenant_id=$10`,
      [(customer_name||'').trim()||inv.customer_name, (customer_email||'').trim()||null,
       subtotal, taxAmt, total, status||null, due_date||null, notes||null, id, tid]);

    audit(req.session?.user?.email, 'fin_invoice_update', 'Updated invoice ' + inv.invoice_number);
    res.json({success:true, id:parseInt(id)});
  }));

  // ══════════════════════════════════════════════════════════
  // POST /financial/invoices/:id/pay — Record payment
  // ══════════════════════════════════════════════════════════
  app.post('/financial/invoices/:id/pay', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;
    const payAmount = parseFloat(req.body.amount) || 0;
    const inv = (await pool.query('SELECT * FROM fin_invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.status(404).send('Invoice not found');
    if (inv.status === 'paid') return res.redirect('/financial/invoices/' + id);

    const remaining = Number(inv.total) - payAmount;
    const newStatus = remaining <= 0.01 ? 'paid' : 'partially_paid';

    await pool.query(
      `UPDATE fin_invoices SET status=$1, paid_at=CASE WHEN $1='paid' THEN NOW() ELSE paid_at END WHERE id=$2 AND tenant_id=$3`,
      [newStatus, id, tid]);

    await pool.query(
      `INSERT INTO fin_transactions (tenant_id,type,amount,currency,reference,status,method,description)
       VALUES ($1,'income',$2,'UGX',$3,'completed','payment','Payment on ${esc(inv.invoice_number)}')`,
      [tid, payAmount, inv.invoice_number]);

    // Add line item if description provided
    if (req.body.description) {
      await pool.query(
        `INSERT INTO fin_invoice_items (invoice_id,description,quantity,unit_price,total) VALUES ($1,$2,1,$3,$3)`,
        [id, req.body.description.trim(), payAmount]);
    }

    audit(user.email, 'fin_invoice_pay', 'Recorded payment of ' + payAmount + ' on ' + inv.invoice_number);
    res.redirect('/financial/invoices/' + id);
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/expenses — Expense tracker
  // ══════════════════════════════════════════════════════════
  app.get('/financial/expenses', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const cat = req.query.category || '';
    let where = 'WHERE e.tenant_id=$1';
    const params = [tid];
    if (cat) { where += ' AND e.category=$2'; params.push(cat); }

    const totalExp = (await pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM fin_expenses ${where}`, params)).rows[0].total;
    const expenses = (await pool.query(
      `SELECT e.*, c.color AS cat_color FROM fin_expenses e LEFT JOIN fin_categories c ON c.name=e.category
       ${where} ORDER BY e.expense_date DESC LIMIT 20 OFFSET $${params.length+1}`,
      [...params, (page-1)*20]
    )).rows;

    const catSummary = (await pool.query(`
      SELECT category, SUM(amount) AS total, COUNT(*) AS cnt
      FROM fin_expenses WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC LIMIT 10`, [tid])).rows;

    const rows = expenses.map(e => `<tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${e.cat_color||'#64748b'};margin-right:6px"></span>${esc(e.category)}</td>
      <td>${esc(e.description||'—')}</td>
      <td class="right" style="color:#dc2626;font-weight:600">${fmtMoney(e.amount,e.currency)}</td>
      <td>${fmtDate(e.expense_date)}</td>
      <td>${e.receipt_url ? '<a href="'+esc(e.receipt_url)+'" target="_blank" style="color:#4f46e5;font-size:12px">View Receipt</a>' : '<span style="color:#94a3b8;font-size:12px">None</span>'}</td>
    </tr>`).join('');

    const catHtml = catSummary.map(c => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="color:#1e293b;font-weight:600">${esc(c.category)}</span>
      <span style="color:#475569">${fmtMoney(c.total)} <span style="color:#94a3b8;font-size:11px">(${c.cnt})</span></span>
    </div>`).join('');

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial/expenses')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4E5; Expenses</h1>
        <a href="/financial/expenses?action=create" class="btn" style="background:#dc2626;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Add Expense</a>
      </div>

      ${req.query.action === 'create' ? `
      <div class="fin-card" style="margin-bottom:20px">
        <h2 style="color:#1e293b;margin-bottom:16px">Add New Expense</h2>
        <form method="POST" action="/financial/expenses">
          <div class="form-grid">
            ${selectField('Category *', 'category', catSummary.map(c=>[c.category,c.category]).concat([['Other','Other']]), '')}
            ${field('Amount *', 'amount', 'number', '', {required:true, placeholder:'0.00'})}
            ${field('Date *', 'expense_date', 'date', today(), {required:true})}
            ${selectField('Currency', 'currency', [['UGX','UGX'],['USD','USD'],['KES','KES']], 'UGX')}
          </div>
          <div style="margin-top:14px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="What was this expense for?"></textarea></div>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button type="submit" class="btn" style="background:#dc2626;color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:600">Save Expense</button>
            <a href="/financial/expenses" class="btn" style="padding:10px 24px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px">Cancel</a>
          </div>
        </form>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 300px;gap:16px">
        <div class="fin-card" style="padding:0;overflow:hidden">
          <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:15px;font-weight:700;color:#1e293b">All Expenses</span>
            <span style="font-size:14px;font-weight:700;color:#dc2626">Total: ${fmtMoney(totalExp)}</span>
          </div>
          <div style="overflow-x:auto"><table class="fin-tbl">
            <thead><tr><th>Category</th><th>Description</th><th class="right">Amount</th><th>Date</th><th>Receipt</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">No expenses recorded</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="fin-card">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">By Category</h3>
          ${catHtml || '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">No data</div>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Expenses', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /financial/expenses — Add expense
  // ══════════════════════════════════════════════════════════
  app.post('/financial/expenses', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { category, description, amount, currency, expense_date, receipt_url } = req.body;
    if (!category || !amount || !expense_date) return res.status(400).send('Category, amount, and date are required');

    await pool.query(
      `INSERT INTO fin_expenses (tenant_id,category,description,amount,currency,expense_date,receipt_url,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, category.trim(), (description||'').trim()||null, parseFloat(amount), currency||'UGX', expense_date,
       (receipt_url||'').trim()||null, user.id]);

    // Record transaction
    await pool.query(
      `INSERT INTO fin_transactions (tenant_id,type,amount,currency,reference,status,method,description)
       VALUES ($1,'expense',$2,$3,$4,'completed','manual','${esc(category)}: ${esc((description||'').substring(0,50))}')`,
      [tid, parseFloat(amount), currency||'UGX', category.trim()]);

    audit(user.email, 'fin_expense_add', 'Added expense: ' + category + ' ' + amount);
    res.redirect('/financial/expenses');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/reports — Financial reports
  // ══════════════════════════════════════════════════════════
  app.get('/financial/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const period = req.query.period || 'month';
    let dateFilter = "created_at >= date_trunc('month', CURRENT_DATE)";
    if (period === 'quarter') dateFilter = "created_at >= date_trunc('quarter', CURRENT_DATE)";
    if (period === 'year') dateFilter = "created_at >= date_trunc('year', CURRENT_DATE)";

    const income = (await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total FROM fin_invoices WHERE tenant_id=$1 AND status='paid' AND ${dateFilter}`, [tid])).rows[0].total;
    const expenses = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM fin_expenses WHERE tenant_id=$1 AND expense_date >= date_trunc(${period==='year'?"'year'":period==='quarter'?"'quarter'":"'month'"}, CURRENT_DATE)`, [tid])).rows[0].total;
    const netProfit = Number(income) - Number(expenses);
    const margin = Number(income) > 0 ? ((netProfit / Number(income)) * 100).toFixed(1) : '0.0';

    const invByStatus = (await pool.query(`
      SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS total FROM fin_invoices
      WHERE tenant_id=$1 GROUP BY status ORDER BY total DESC`, [tid])).rows;

    const expByCat = (await pool.query(`
      SELECT category, SUM(amount) AS total FROM fin_expenses WHERE tenant_id=$1
      AND expense_date >= date_trunc('month', CURRENT_DATE) GROUP BY category ORDER BY total DESC LIMIT 8`, [tid])).rows;

    const cashFlow = (await pool.query(`
      SELECT type, SUM(amount) AS total FROM fin_transactions WHERE tenant_id=$1 AND status='completed'
      AND ${dateFilter} GROUP BY type`, [tid])).rows;

    const statusHtml = invByStatus.map(r => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span>${invBadge(r.status)} ${esc(r.status)}</span>
      <span style="font-weight:600;color:#1e293b">${r.cnt} invoice(s) &middot; ${fmtMoney(r.total)}</span>
    </div>`).join('');

    const expCatHtml = expByCat.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="color:#1e293b">${esc(r.category)}</span>
      <span style="color:#dc2626;font-weight:600">${fmtMoney(r.total)}</span>
    </div>`).join('');

    const maxCatExp = Math.max(...expByCat.map(c => Number(c.total||0)), 1);
    const barHtml = expByCat.map(c => {
      const pct = Math.round((Number(c.total||0)/maxCatExp)*100);
      return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="color:#475569">${esc(c.category)}</span><span style="color:#94a3b8">${fmtMoney(c.total)}</span>
      </div><div style="background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#dc2626,#f87171);border-radius:6px;transition:.3s"></div>
      </div></div>`;
    }).join('');

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial/reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4CA; Financial Reports</h1>
        <div style="display:flex;gap:8px">
          <select id="period-sel" onchange="window.location='/financial/reports?period='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="month" ${period==='month'?'selected':''}>This Month</option>
            <option value="quarter" ${period==='quarter'?'selected':''}>This Quarter</option>
            <option value="year" ${period==='year'?'selected':''}>This Year</option>
          </select>
          <a href="/financial/reports/export?period=${esc(period)}" class="btn" style="background:#16a34a;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">&#x1F4E5; Export CSV</a>
        </div>
      </div>

      <div class="stat-cards">
        <div class="stat-card"><div class="icon">&#x1F4C8;</div><div class="num" style="color:#16a34a">${fmtMoney(income)}</div><div class="label">Total Income</div></div>
        <div class="stat-card"><div class="icon">&#x1F4C9;</div><div class="num" style="color:#dc2626">${fmtMoney(expenses)}</div><div class="label">Total Expenses</div></div>
        <div class="stat-card"><div class="icon">&#x1F4B0;</div><div class="num" style="color:${netProfit>=0?'#16a34a':'#dc2626'}">${fmtMoney(netProfit)}</div><div class="label">Net ${netProfit>=0?'Profit':'Loss'}</div></div>
        <div class="stat-card"><div class="icon">&#x1F4C9;</div><div class="num" style="color:#4f46e5">${margin}%</div><div class="label">Profit Margin</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">&#x1F4CB; P&amp;L Summary</h3>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:2px solid #e2e8f0;font-size:14px">
            <span style="font-weight:700;color:#1e293b">Revenue</span><span style="font-weight:700;color:#16a34a">${fmtMoney(income)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:2px solid #e2e8f0;font-size:14px">
            <span style="font-weight:700;color:#1e293b">Expenses</span><span style="font-weight:700;color:#dc2626">${fmtMoney(expenses)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:16px;font-weight:800">
            <span style="color:#1e293b">Net Profit</span><span style="color:${netProfit>=0?'#16a34a':'#dc2626'}">${fmtMoney(netProfit)}</span></div>
        </div>
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">&#x1F4B3; Cash Flow</h3>
          ${cashFlow.map(cf => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
            <span>${txBadge(cf.type)} ${esc(cf.type)}</span>
            <span style="font-weight:600">${fmtMoney(cf.total)}</span></div>`).join('')}
          ${cashFlow.length===0?'<div style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No cash flow data</div>':''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">&#x1F4CB; Invoices by Status</h3>
          ${statusHtml || '<div style="text-align:center;color:#94a3b8;padding:20px">No invoices</div>'}
        </div>
        <div class="fin-card">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">&#x1F4CA; Expense Breakdown</h3>
          ${barHtml || '<div style="text-align:center;color:#94a3b8;padding:20px">No expenses</div>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Financial Reports', html, user, req));
    audit(user.email, 'fin_reports', 'Viewed financial reports');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/reports/export — Export CSV
  // ══════════════════════════════════════════════════════════
  app.get('/financial/reports/export', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const type = req.query.type || 'transactions';
    let csv = '', filename = 'financial-export.csv';

    if (type === 'invoices') {
      const rows = (await pool.query(
        'SELECT invoice_number,customer_name,customer_email,amount,tax,total,status,due_date,paid_at,created_at FROM fin_invoices WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
      csv = 'Invoice Number,Customer,Email,Amount,Tax,Total,Status,Due Date,Paid At,Created At\n';
      rows.forEach(r => { csv += `"${r.invoice_number}","${(r.customer_name||'').replace(/"/g,'""')}","${r.customer_email||''}",${r.amount},${r.tax},${r.total},${r.status},${r.due_date||''},${r.paid_at||''},${r.created_at}\n`; });
      filename = 'invoices-export.csv';
    } else if (type === 'expenses') {
      const rows = (await pool.query(
        'SELECT category,description,amount,currency,expense_date,created_at FROM fin_expenses WHERE tenant_id=$1 ORDER BY expense_date DESC', [tid])).rows;
      csv = 'Category,Description,Amount,Currency,Date,Created At\n';
      rows.forEach(r => { csv += `"${(r.category||'').replace(/"/g,'""')}","${(r.description||'').replace(/"/g,'""')}",${r.amount},${r.currency||'UGX'},${r.expense_date},${r.created_at}\n`; });
      filename = 'expenses-export.csv';
    } else {
      const rows = (await pool.query(
        'SELECT type,amount,currency,reference,status,method,description,created_at FROM fin_transactions WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
      csv = 'Type,Amount,Currency,Reference,Status,Method,Description,Created At\n';
      rows.forEach(r => { csv += `"${r.type}",${r.amount},${r.currency||'UGX'},"${(r.reference||'').replace(/"/g,'""')}","${r.status||''}","${r.method||''}","${(r.description||'').replace(/"/g,'""')}",${r.created_at}\n`; });
      filename = 'transactions-export.csv';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="'+filename+'"');
    res.send(csv);
    audit(req.session?.user?.email, 'fin_export', 'Exported ' + type + ' CSV');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /financial/transactions — Transaction history
  // ══════════════════════════════════════════════════════════
  app.get('/financial/transactions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const type = req.query.type || '';
    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    if (type) { where += ' AND type=$2'; params.push(type); }

    const count = (await pool.query(`SELECT COUNT(*) FROM fin_transactions ${where}`, params)).rows[0].count;
    const txns = (await pool.query(
      `SELECT * FROM fin_transactions ${where} ORDER BY created_at DESC LIMIT 25 OFFSET $${params.length+1}`,
      [...params, (page-1)*25]
    )).rows;

    const totals = (await pool.query(`
      SELECT type, COALESCE(SUM(amount),0) AS total FROM fin_transactions WHERE tenant_id=$1 AND status='completed' GROUP BY type`, [tid])).rows;
    const totalIn = totals.find(t=>t.type==='income');
    const totalOut = totals.find(t=>t.type==='expense');

    const rows = txns.map(tx => `<tr>
      <td>${txBadge(tx.type)}</td>
      <td class="right" style="font-weight:600;color:${tx.type==='income'?'#16a34a':'#dc2626'}">${tx.type==='income'?'+':'\u2212'}${fmtMoney(tx.amount,tx.currency)}</td>
      <td>${esc(tx.reference||'\u2014')}</td>
      <td>${esc(tx.method||'\u2014')}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tx.description||'\u2014')}</td>
      <td>${esc(tx.status||'completed')}</td>
      <td>${fmtDate(tx.created_at)}</td>
    </tr>`).join('');

    const html = FIN_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/financial/transactions')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F504; Transactions</h1>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="window.location='/financial/transactions?type='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="">All Types</option>
            <option value="income" ${type==='income'?'selected':''}>Income</option>
            <option value="expense" ${type==='expense'?'selected':''}>Expenses</option>
          </select>
        </div>
      </div>
      <div class="stat-cards" style="margin-bottom:16px">
        <div class="stat-card"><div class="num" style="color:#16a34a">${fmtMoney(totalIn?.total||0)}</div><div class="label">Total Income</div></div>
        <div class="stat-card"><div class="num" style="color:#dc2626">${fmtMoney(totalOut?.total||0)}</div><div class="label">Total Expenses</div></div>
        <div class="stat-card"><div class="num" style="color:${(Number(totalIn?.total||0)-Number(totalOut?.total||0))>=0?'#16a34a':'#dc2626'}">${fmtMoney(Number(totalIn?.total||0)-Number(totalOut?.total||0))}</div><div class="label">Net Balance</div></div>
      </div>
      <div class="fin-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="fin-tbl">
          <thead><tr><th>Type</th><th class="right">Amount</th><th>Reference</th><th>Method</th><th>Description</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No transactions</td></tr>'}</tbody>
        </table></div>
      </div>
      ${paginationHtml(page, parseInt(count), '/financial/transactions?type='+encodeURIComponent(type))}
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
        <a href="/financial/reports/export?type=transactions" class="btn" style="background:#16a34a;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:13px">Export All CSV</a>
      </div>
    </div>`;
    res.send(renderPage('Transactions', html, req.session.user, req));
  }));

  console.log('[FinancialSuite] Routes registered successfully');
};
