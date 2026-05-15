// ============================================================
// INVOICING & BILLING MODULE — Multi-Tenant SaaS Platform
// Full invoicing lifecycle: create, send, pay, recurring, analytics.
// Usage: const invoicingBilling = require('./invoicing-billing');
//        invoicingBilling(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function invoicingBilling(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtMoney = (n, curr) => {
    const amount = Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (curr === 'USD' ? '$' : curr ? curr + ' ' : '') + amount;
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const thirtyDays = () => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; };

  // ── status badges ─────────────────────────────────────────
  function invBadge(status) {
    const m = {
      draft:         { bg: '#f1f5f9', c: '#64748b', l: 'Draft' },
      sent:          { bg: '#dbeafe', c: '#2563eb', l: 'Sent' },
      paid:          { bg: '#dcfce7', c: '#16a34a', l: 'Paid' },
      partially_paid:{ bg: '#fef3c7', c: '#d97706', l: 'Partially Paid' },
      overdue:       { bg: '#fee2e2', c: '#dc2626', l: 'Overdue' },
      cancelled:     { bg: '#f3f4f6', c: '#6b7280', l: 'Cancelled' }
    };
    const s = m[status] || m.draft;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function payBadge(status) {
    const m = {
      completed: { bg: '#dcfce7', c: '#16a34a', l: 'Completed' },
      pending:   { bg: '#fef3c7', c: '#d97706', l: 'Pending' },
      failed:    { bg: '#fee2e2', c: '#dc2626', l: 'Failed' }
    };
    const s = m[status] || m.pending;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  // ── CSS ───────────────────────────────────────────────────
  const INV_CSS = `<style>
.inv-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.inv-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.inv-nav a:hover{background:#e2e8f0}.inv-nav a.active{background:#4f46e5;color:#fff}
.inv-tbl{width:100%;border-collapse:collapse;font-size:13px}
.inv-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;white-space:nowrap}
.inv-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.inv-tbl tr:hover{background:#f8fafc}
.inv-tbl td.right,.inv-tbl th.right{text-align:right}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}
.stat-card .num{font-size:24px;font-weight:800;color:#1e293b}
.stat-card .label{font-size:12px;color:#94a3b8;margin-top:4px}
.inv-view{max-width:780px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
.inv-view-header{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:28px 32px}
.inv-view-body{padding:28px 32px}
.inv-items-table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
.inv-items-table th{background:#f8fafc;padding:10px 12px;text-align:left;border:1px solid #e2e8f0;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#64748b}
.inv-items-table td{padding:10px 12px;border:1px solid #f1f5f9}
.inv-totals{margin-left:auto;width:280px}
.inv-totals .row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#475569}
.inv-totals .row.total{border-top:2px solid #4f46e5;font-size:16px;font-weight:800;color:#1e293b;padding-top:10px;margin-top:6px}
.paid-stamp{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);font-size:72px;font-weight:900;color:rgba(22,163,74,0.2);text-transform:uppercase;letter-spacing:8px;pointer-events:none;z-index:10}
.line-items{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.line-items-header{background:#f8fafc;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
.line-item-row{display:grid;grid-template-columns:2fr 2fr 0.7fr 1fr 1fr 40px;gap:8px;padding:8px 14px;border-bottom:1px solid #f1f5f9;align-items:center;font-size:13px}
.line-item-row input,.line-item-row select{padding:7px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;width:100%}
.line-item-row input:focus,.line-item-row select:focus{outline:none;border-color:#4f46e5}
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.filter-bar input,.filter-bar select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.filter-bar label{font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px}
.status-tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
.status-tabs a{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;color:#64748b;background:#f1f5f9;transition:.15s}
.status-tabs a:hover{background:#e2e8f0}.status-tabs a.active{background:#4f46e5;color:#fff}
.pagination{display:flex;gap:6px;justify-content:center;margin-top:16px}
.pagination a,.pagination span{padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9}
.pagination a:hover{background:#e2e8f0}.pagination span.current{background:#4f46e5;color:#fff}
.payment-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:500px}
@media(max-width:768px){
  .form-grid{grid-template-columns:1fr}
  .line-item-row{grid-template-columns:1fr;gap:6px}
  .inv-nav{flex-direction:column}
  .payment-form{grid-template-columns:1fr}
  .stat-cards{grid-template-columns:1fr 1fr}
  .inv-totals{width:100%}
}
</style>`;

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_number VARCHAR(50) NOT NULL,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      client_address TEXT,
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      subtotal DECIMAL(12,2) DEFAULT 0,
      tax_rate DECIMAL(5,2) DEFAULT 0,
      tax_amount DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'draft',
      notes TEXT,
      terms TEXT,
      created_by INTEGER,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      currency VARCHAR(10) DEFAULT 'UGX',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      description TEXT,
      quantity DECIMAL(10,2) DEFAULT 1,
      unit_price DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount DECIMAL(12,2) NOT NULL,
      payment_method VARCHAR(30) DEFAULT 'cash',
      reference VARCHAR(100),
      status VARCHAR(20) DEFAULT 'completed',
      notes TEXT,
      received_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS recurring_invoices (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_name VARCHAR(255) NOT NULL,
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      client_address TEXT,
      subtotal DECIMAL(12,2) DEFAULT 0,
      tax_rate DECIMAL(5,2) DEFAULT 0,
      tax_amount DECIMAL(12,2) DEFAULT 0,
      discount DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      notes TEXT,
      terms TEXT,
      currency VARCHAR(10) DEFAULT 'UGX',
      frequency VARCHAR(20) DEFAULT 'monthly',
      next_date DATE,
      last_generated TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS recurring_invoice_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      recurring_id INTEGER NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
      item_name VARCHAR(255) NOT NULL,
      description TEXT,
      quantity DECIMAL(10,2) DEFAULT 1,
      unit_price DECIMAL(12,2) DEFAULT 0,
      total DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE IF NOT EXISTS — invoices
    ...[
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50)`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS client_email VARCHAR(255)`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS client_phone VARCHAR(50)`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS client_address TEXT`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS issue_date DATE`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS due_date DATE`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS discount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS total DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS terms TEXT`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX'`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      // invoice_items
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS quantity DECIMAL(10,2) DEFAULT 1`,
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS total DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS invoice_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      // payments
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS amount DECIMAL(12,2)`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'cash'`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS reference VARCHAR(100)`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed'`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS received_by INTEGER`,
      `ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      // recurring_invoices
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS client_email VARCHAR(255)`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS client_phone VARCHAR(50)`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS client_address TEXT`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS discount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS total DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS terms TEXT`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'UGX'`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS frequency VARCHAR(20) DEFAULT 'monthly'`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS next_date DATE`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS last_generated TIMESTAMPTZ`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `ALTER TABLE IF EXISTS recurring_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      // recurring_invoice_items
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(255)`,
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS quantity DECIMAL(10,2) DEFAULT 1`,
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS total DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE IF EXISTS recurring_invoice_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`
    ],
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due ON invoices(tenant_id, due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(tenant_id, invoice_number)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant ON invoice_items(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items(invoice_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_inv ON payments(invoice_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(tenant_id, payment_method)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_tenant ON recurring_invoices(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_invoices(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_items ON recurring_invoice_items(recurring_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_items_tenant ON recurring_invoice_items(tenant_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[Invoicing] Cannot connect to DB for migrations'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Invoicing] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { console.error('[Invoicing] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ── helper: navigation bar ───────────────────────────────
  function nav(active) {
    const links = [
      ['/invoicing', 'Dashboard'],
      ['/invoicing/new', 'New Invoice'],
      ['/invoicing/list', 'All Invoices'],
      ['/invoicing/payments', 'Payments'],
      ['/invoicing/recurring', 'Recurring'],
      ['/invoicing/overdue', 'Overdue'],
      ['/invoicing/stats', 'Analytics']
    ];
    return '<div class="inv-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ── helper: form field ───────────────────────────────────
  function field(label, name, type, val, opts) {
    const req = opts && opts.required ? ' required' : '';
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}"${req}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"
        ${opts && opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : ''}></div>`;
  }

  function selectField(label, name, options, val) {
    const opts = options.map(([v, l]) => `<option value="${esc(v)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <select name="${name}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${opts}</select></div>`;
  }

  // ── helper: generate invoice number ──────────────────────
  async function generateInvoiceNumber(tid) {
    const now = new Date();
    const prefix = `INV-${tid}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 4) AS INTEGER)), 0) + 1 AS seq
         FROM invoices WHERE tenant_id = $1 AND invoice_number LIKE $2`, [tid, prefix + '%']
      );
      const seq = result.rows[0].seq;
      await client.query('COMMIT');
      return `${prefix}-${String(seq).padStart(4, '0')}`;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── helper: calculate next date based on frequency ───────
  function addFrequency(dateStr, freq) {
    const d = new Date(dateStr);
    switch (freq) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      case 'quarterly': d.setMonth(d.getMonth() + 3); break;
      case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
      default: d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().split('T')[0];
  }

  // ── helper: pagination HTML ──────────────────────────────
  function paginationHtml(currentPage, totalPages, baseUrl) {
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    if (currentPage > 1) html += `<a href="${baseUrl}?page=${currentPage - 1}">&laquo; Prev</a>`;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let i = start; i <= end; i++) {
      html += i === currentPage
        ? `<span class="current">${i}</span>`
        : `<a href="${baseUrl}?page=${i}">${i}</a>`;
    }
    if (currentPage < totalPages) html += `<a href="${baseUrl}?page=${currentPage + 1}">Next &raquo;</a>`;
    html += '</div>';
    return html;
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /invoicing — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    console.log('[Invoicing] Dashboard loaded for tenant:', tid);

    const stats = (await pool.query(`
      SELECT
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partially_paid')
          AND issue_date >= date_trunc('month', CURRENT_DATE)) as revenue_this_month,
        (SELECT COALESCE(SUM(total - paid_amount),0) FROM invoices WHERE tenant_id=$1
          AND status IN ('sent','partially_paid','overdue')) as outstanding,
        (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='overdue') as overdue_count,
        (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1
          AND issue_date >= date_trunc('month', CURRENT_DATE)) as invoices_this_month
    `, [tid])).rows[0];

    const recent = (await pool.query(`
      SELECT id, invoice_number, client_name, total, paid_amount, status, issue_date, due_date, currency
      FROM invoices WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid])).rows;

    const recentHtml = recent.map(r => `<tr>
      <td><a href="/invoicing/view/${r.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(r.invoice_number)}</a></td>
      <td>${esc(r.client_name)}</td>
      <td>${fmtDate(r.issue_date)}</td>
      <td class="right">${fmtMoney(r.total, r.currency)}</td>
      <td>${invBadge(r.status)}</td>
      <td>
        <a href="/invoicing/view/${r.id}" class="btn btn-sm" style="background:#4f46e5;color:#fff">View</a>
      </td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📄 Invoicing & Billing</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage invoices, payments, and revenue</p></div>
        <div style="display:flex;gap:8px">
          <a href="/invoicing/new" class="btn btn-success">+ New Invoice</a>
          <a href="/invoicing/recurring" class="btn" style="background:#7c3aed;color:#fff">Recurring</a>
        </div>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="num" style="color:#16a34a">${fmtMoney(stats.revenue_this_month)}</div><div class="label">Revenue This Month</div></div>
        <div class="stat-card"><div class="num" style="color:#d97706">${fmtMoney(stats.outstanding)}</div><div class="label">Outstanding Amount</div></div>
        <div class="stat-card"><div class="num" style="color:#dc2626">${stats.overdue_count}</div><div class="label">Overdue Invoices</div></div>
        <div class="stat-card"><div class="num" style="color:#4f46e5">${stats.invoices_this_month}</div><div class="label">Invoices This Month</div></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="color:#1e293b;font-size:16px">Recent Invoices</h3>
          <a href="/invoicing/list" style="font-size:13px;color:#4f46e5;text-decoration:none">View All &rarr;</a>
        </div>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>${recentHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No invoices yet. <a href="/invoicing/new" style="color:#4f46e5">Create your first invoice</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Invoicing Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /invoicing/new — Create Invoice Form
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;

    const html = INV_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/invoicing/new')}
      <a href="/invoicing" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">Create New Invoice</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Fill in client details and line items below</p>
        <form method="POST" action="/invoicing/new" id="invoiceForm">
          <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken || '')}">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Client Information</h3>
          <div class="form-grid">
            ${field('Client Name *', 'client_name', 'text', '', { required: true, placeholder: 'Acme Corporation' })}
            ${field('Email', 'client_email', 'email', '', { placeholder: 'billing@acme.com' })}
            ${field('Phone', 'client_phone', 'tel', '', { placeholder: '+256 700 000 000' })}
            ${field('Address', 'client_address', 'text', '', { placeholder: '123 Business Street' })}
          </div>
          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Invoice Details</h3>
          <div class="form-grid">
            ${field('Issue Date *', 'issue_date', 'date', today(), { required: true })}
            ${field('Due Date *', 'due_date', 'date', thirtyDays(), { required: true })}
            ${selectField('Currency', 'currency', [['UGX','UGX (Ugandan Shilling)'],['KES','KES (Kenyan Shilling)'],['TZS','TZS (Tanzanian Shilling)'],['USD','USD (US Dollar)'],['RWF','RWF (Rwandan Franc)']], 'UGX')}
            ${field('Tax Rate (%)', 'tax_rate', 'number', '0', {})}
            ${field('Discount', 'discount', 'number', '0', {})}
          </div>
          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Line Items</h3>
          <div class="line-items">
            <div class="line-items-header">
              <span style="font-weight:700;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Items</span>
              <button type="button" onclick="addLineItem()" class="btn btn-sm" style="background:#16a34a;color:#fff">+ Add Item</button>
            </div>
            <div id="lineItemsContainer">
              <div style="padding:6px 14px 4px;display:grid;grid-template-columns:2fr 2fr 0.7fr 1fr 1fr 40px;gap:8px;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">
                <span>Item</span><span>Description</span><span>Qty</span><span>Unit Price</span><span>Total</span><span></span>
              </div>
              <div class="line-item-row" data-row="1">
                <input type="text" name="item_name_1" placeholder="Item name" required>
                <input type="text" name="item_desc_1" placeholder="Description">
                <input type="number" name="item_qty_1" value="1" min="0" step="any" class="qty-input">
                <input type="number" name="item_price_1" value="0" min="0" step="0.01" class="price-input">
                <input type="text" name="item_total_1" value="0.00" readonly style="background:#f8fafc;font-weight:600">
                <button type="button" onclick="removeLineItem(this)" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;padding:6px 8px">&times;</button>
              </div>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:16px;padding:16px;background:#f8fafc;border-radius:10px">
            <div style="width:280px">
              <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#475569"><span>Subtotal:</span><span id="calcSubtotal" style="font-weight:600">0.00</span></div>
              <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#475569"><span>Tax:</span><span id="calcTax" style="font-weight:600">0.00</span></div>
              <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#475569"><span>Discount:</span><span id="calcDiscount" style="font-weight:600">0.00</span></div>
              <div style="display:flex;justify-content:space-between;font-size:18px;padding:10px 0 0;margin-top:6px;border-top:2px solid #4f46e5;font-weight:800;color:#1e293b"><span>Total:</span><span id="calcTotal">0.00</span></div>
            </div>
          </div>
          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Additional</h3>
          <div class="form-grid">
            <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Additional notes for the client..."></textarea></div>
            <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Terms & Conditions</label>
              <textarea name="terms" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Payment terms...">Payment is due within 30 days of invoice date.</textarea></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" name="action" value="send" class="btn" style="padding:12px 28px;background:#4f46e5;color:#fff">Send Invoice</button>
            <button type="submit" name="action" value="draft" class="btn" style="padding:12px 28px;background:#64748b;color:#fff">Save as Draft</button>
            <a href="/invoicing" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px">Cancel</a>
          </div>
        </form>
      </div>
    </div>
    <script>
    let lineItemCounter = 1;
    function addLineItem() {
      lineItemCounter++;
      const container = document.getElementById('lineItemsContainer');
      const row = document.createElement('div');
      row.className = 'line-item-row';
      row.setAttribute('data-row', lineItemCounter);
      row.innerHTML = '<input type="text" name="item_name_' + lineItemCounter + '" placeholder="Item name" required>'
        + '<input type="text" name="item_desc_' + lineItemCounter + '" placeholder="Description">'
        + '<input type="number" name="item_qty_' + lineItemCounter + '" value="1" min="0" step="any" class="qty-input">'
        + '<input type="number" name="item_price_' + lineItemCounter + '" value="0" min="0" step="0.01" class="price-input">'
        + '<input type="text" name="item_total_' + lineItemCounter + '" value="0.00" readonly style="background:#f8fafc;font-weight:600">'
        + '<button type="button" onclick="removeLineItem(this)" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;padding:6px 8px">&times;</button>';
      container.appendChild(row);
    }
    function removeLineItem(btn) {
      const rows = document.querySelectorAll('.line-item-row');
      if (rows.length <= 1) { alert('At least one line item is required.'); return; }
      btn.closest('.line-item-row').remove();
      recalculate();
    }
    function recalculate() {
      let subtotal = 0;
      document.querySelectorAll('.line-item-row').forEach(row => {
        const qty = parseFloat(row.querySelector('.qty-input').value) || 0;
        const price = parseFloat(row.querySelector('.price-input').value) || 0;
        const total = Math.round(qty * price * 100) / 100;
        row.querySelector('input[name^="item_total_"]').value = total.toFixed(2);
        subtotal += total;
      });
      const taxRate = parseFloat(document.querySelector('input[name="tax_rate"]').value) || 0;
      const discount = parseFloat(document.querySelector('input[name="discount"]').value) || 0;
      const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const grandTotal = Math.round((subtotal + taxAmount - discount) * 100) / 100;
      document.getElementById('calcSubtotal').textContent = subtotal.toFixed(2);
      document.getElementById('calcTax').textContent = taxAmount.toFixed(2);
      document.getElementById('calcDiscount').textContent = discount.toFixed(2);
      document.getElementById('calcTotal').textContent = grandTotal.toFixed(2);
    }
    document.addEventListener('change', e => { if (e.target.classList.contains('qty-input') || e.target.classList.contains('price-input') || e.target.name === 'tax_rate' || e.target.name === 'discount') recalculate(); });
    document.addEventListener('input', e => { if (e.target.classList.contains('qty-input') || e.target.classList.contains('price-input') || e.target.name === 'tax_rate' || e.target.name === 'discount') recalculate(); });
    </script>`;
    res.send(renderPage('Create Invoice', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /invoicing/new — Save Invoice
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { client_name, client_email, client_phone, client_address, issue_date, due_date,
      currency, tax_rate, discount, notes, terms, action } = req.body;

    if (!client_name || !client_name.trim()) {
      return res.send('<div class="alert alert-danger">Client name is required.</div><a href="/invoicing/new" class="btn">Back</a>');
    }
    if (!issue_date || !due_date) {
      return res.send('<div class="alert alert-danger">Issue date and due date are required.</div><a href="/invoicing/new" class="btn">Back</a>');
    }

    // Gather line items from form
    const items = [];
    let idx = 1;
    while (req.body['item_name_' + idx]) {
      const qty = parseFloat(req.body['item_qty_' + idx]) || 0;
      const unitPrice = parseFloat(req.body['item_price_' + idx]) || 0;
      items.push({
        name: (req.body['item_name_' + idx] || '').trim(),
        description: (req.body['item_desc_' + idx] || '').trim() || null,
        quantity: qty,
        unit_price: unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100
      });
      idx++;
    }
    if (items.length === 0) {
      return res.send('<div class="alert alert-danger">At least one line item is required.</div><a href="/invoicing/new" class="btn">Back</a>');
    }

    // Server-side recalculation
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const taxRateVal = parseFloat(tax_rate) || 0;
    const discountVal = parseFloat(discount) || 0;
    const taxAmount = Math.round(subtotal * (taxRateVal / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount - discountVal) * 100) / 100;
    const invoiceNumber = await generateInvoiceNumber(tid);
    const status = action === 'send' ? 'sent' : 'draft';

    console.log('[Invoicing] Creating invoice:', invoiceNumber, 'for tenant:', tid);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invResult = await client.query(
        `INSERT INTO invoices (tenant_id, invoice_number, client_name, client_email, client_phone, client_address,
          issue_date, due_date, subtotal, tax_rate, tax_amount, discount, total, status, notes, terms, created_by, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [tid, invoiceNumber, client_name.trim(), (client_email || '').trim() || null,
          (client_phone || '').trim() || null, (client_address || '').trim() || null,
          issue_date, due_date, Math.round(subtotal * 100) / 100, taxRateVal,
          taxAmount, discountVal, total, status,
          (notes || '').trim() || null, (terms || '').trim() || null, user.id, currency || 'UGX']
      );
      const invId = invResult.rows[0].id;

      for (const item of items) {
        await client.query(
          `INSERT INTO invoice_items (tenant_id, invoice_id, item_name, description, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, invId, item.name, item.description, item.quantity, item.unit_price, item.total]
        );
      }
      await client.query('COMMIT');
      console.log('[Invoicing] Invoice created:', invoiceNumber, 'status:', status);
      res.redirect('/invoicing/view/' + invId);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[Invoicing] Create error:', e.message);
      return res.send('<div class="alert alert-danger">Error creating invoice: ' + esc(e.message) + '</div><a href="/invoicing/new" class="btn">Back</a>');
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: GET /invoicing/view/:id — View Single Invoice
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/view/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const inv = (await pool.query('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.send('<div class="alert alert-danger">Invoice not found.</div><a href="/invoicing" class="btn">Back</a>');

    const items = (await pool.query(
      'SELECT * FROM invoice_items WHERE invoice_id=$1 AND tenant_id=$2 ORDER BY id', [id, tid]
    )).rows;

    const payments = (await pool.query(
      `SELECT p.*, u.name as received_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.received_by
       WHERE p.invoice_id=$1 AND p.tenant_id=$2 ORDER BY p.created_at DESC`, [id, tid]
    )).rows;

    const remaining = Math.round((Number(inv.total) - Number(inv.paid_amount)) * 100) / 100;
    const isPaid = inv.status === 'paid';
    const isDraft = inv.status === 'draft';
    const isSent = inv.status === 'sent' || inv.status === 'overdue';

    const itemsHtml = items.map(i => `<tr>
      <td>${esc(i.item_name)}</td>
      <td style="color:#64748b">${esc(i.description || '')}</td>
      <td class="right">${Number(i.quantity).toFixed(2)}</td>
      <td class="right">${fmtMoney(i.unit_price, inv.currency)}</td>
      <td class="right" style="font-weight:600">${fmtMoney(i.total, inv.currency)}</td>
    </tr>`).join('');

    const paymentsHtml = payments.map(p => `<tr>
      <td>${fmtMoney(p.amount, inv.currency)}</td>
      <td><span style="text-transform:capitalize">${esc(p.payment_method)}</span></td>
      <td>${esc(p.reference || '\u2014')}</td>
      <td>${payBadge(p.status)}</td>
      <td>${esc(p.received_by_name || '\u2014')}</td>
      <td>${fmtDateTime(p.created_at)}</td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/invoicing')}
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/invoicing" style="color:#64748b;font-size:14px;text-decoration:none">&larr; Back</a>
        <span style="flex:1"></span>
        ${isDraft ? `<a href="/invoicing/view/${id}" onclick="event.preventDefault();document.getElementById('editForm').style.display=document.getElementById('editForm').style.display==='none'?'block':'none'" class="btn btn-sm" style="background:#d97706;color:#fff">Edit</a>` : ''}
        ${isSent ? `<form method="POST" action="/invoicing/pay/${id}" style="display:inline"><button type="button" onclick="document.getElementById('paymentForm').style.display='block'" class="btn btn-sm" style="background:#16a34a;color:#fff">Record Payment</button></form>` : ''}
        ${isDraft ? `<form method="POST" action="/invoicing/send/${id}" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#4f46e5;color:#fff">Send Invoice</button></form>` : ''}
        <button onclick="window.print()" class="btn btn-sm" style="background:#64748b;color:#fff">Print</button>
        ${isDraft ? `<form method="POST" action="/invoicing/delete/${id}" onsubmit="return confirm('Delete this invoice? This cannot be undone.')" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#dc2626;color:#fff">Delete</button></form>` : ''}
      </div>
      <div class="inv-view" style="position:relative">
        ${isPaid ? '<div class="paid-stamp">PAID</div>' : ''}
        <div class="inv-view-header">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div>
              <h2 style="font-size:28px;font-weight:800;margin:0">INVOICE</h2>
              <div style="font-size:16px;margin-top:4px;opacity:.9">${esc(inv.invoice_number)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:14px;opacity:.8">Status: ${invBadge(inv.status)}</div>
              <div style="font-size:14px;margin-top:4px;opacity:.8">Date: ${fmtDate(inv.issue_date)}</div>
              <div style="font-size:14px;opacity:.8">Due: ${fmtDate(inv.due_date)}</div>
            </div>
          </div>
        </div>
        <div class="inv-view-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
            <div>
              <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Bill To</div>
              <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(inv.client_name)}</div>
              ${inv.client_email ? `<div style="font-size:13px;color:#64748b;margin-top:2px">${esc(inv.client_email)}</div>` : ''}
              ${inv.client_phone ? `<div style="font-size:13px;color:#64748b">${esc(inv.client_phone)}</div>` : ''}
              ${inv.client_address ? `<div style="font-size:13px;color:#64748b;white-space:pre-line">${esc(inv.client_address)}</div>` : ''}
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Payment Summary</div>
              <div style="font-size:13px;color:#475569">Total Due: <strong style="color:#1e293b">${fmtMoney(remaining, inv.currency)}</strong></div>
              <div style="font-size:13px;color:#475569">Paid: <strong style="color:#16a34a">${fmtMoney(inv.paid_amount, inv.currency)}</strong></div>
              <div style="font-size:13px;color:#475569">Currency: ${esc(inv.currency)}</div>
            </div>
          </div>
          <table class="inv-items-table">
            <thead><tr><th>Item</th><th>Description</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Total</th></tr></thead>
            <tbody>
              ${itemsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No items</td></tr>'}
            </tbody>
          </table>
          <div class="inv-totals">
            <div class="row"><span>Subtotal</span><span>${fmtMoney(inv.subtotal, inv.currency)}</span></div>
            <div class="row"><span>Tax (${Number(inv.tax_rate)}%)</span><span>${fmtMoney(inv.tax_amount, inv.currency)}</span></div>
            ${Number(inv.discount) > 0 ? `<div class="row"><span>Discount</span><span>-${fmtMoney(inv.discount, inv.currency)}</span></div>` : ''}
            <div class="row total"><span>Total</span><span>${fmtMoney(inv.total, inv.currency)}</span></div>
          </div>
          ${inv.terms ? `<div style="margin-top:20px;padding:14px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569"><strong>Terms:</strong> ${esc(inv.terms)}</div>` : ''}
          ${inv.notes ? `<div style="margin-top:8px;padding:14px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569"><strong>Notes:</strong> ${esc(inv.notes)}</div>` : ''}
        </div>
      </div>

      <!-- Payment History -->
      ${payments.length > 0 ? `
      <div class="card" style="margin-top:20px">
        <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Payment History (${payments.length})</h3>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th class="right">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Received By</th><th>Date</th></tr></thead>
          <tbody>${paymentsHtml}</tbody>
        </table></div>
      </div>` : ''}

      <!-- Record Payment Form (hidden) -->
      <div id="paymentForm" style="display:none" class="card" >
        <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Record Payment</h3>
        <form method="POST" action="/invoicing/pay/${id}">
          <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken || '')}">
          <div class="payment-form">
            ${field('Amount *', 'amount', 'number', remaining.toFixed(2), { required: true })}
            ${selectField('Payment Method', 'payment_method', [['cash','Cash'],['mobile_money','Mobile Money'],['bank_transfer','Bank Transfer'],['card','Card'],['cheque','Cheque'],['other','Other']], 'cash')}
            ${field('Reference #', 'reference', 'text', '', { placeholder: 'Transaction reference' })}
            ${field('Notes', 'pay_notes', 'text', '', { placeholder: 'Optional notes' })}
          </div>
          <div style="display:flex;gap:8px;margin-top:16px">
            <button type="submit" class="btn btn-success">Record Payment</button>
            <button type="button" onclick="document.getElementById('paymentForm').style.display='none'" class="btn" style="background:#f1f5f9;color:#475569;border-radius:8px">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Invoice: ' + inv.invoice_number, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /invoicing/list — All Invoices
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/list', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, status: fStatus, from_date, to_date, sort, page: qPage } = req.query;
    const page = Math.max(1, parseInt(qPage) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = ['i.tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(i.client_name ILIKE $${pi} OR i.invoice_number ILIKE $${pi} OR i.client_email ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (fStatus && fStatus !== 'all') { where.push(`i.status=$${pi}`); params.push(fStatus); pi++; }
    if (from_date) { where.push(`i.issue_date >= $${pi}`); params.push(from_date); pi++; }
    if (to_date) { where.push(`i.issue_date <= $${pi}`); params.push(to_date); pi++; }

    const orderClause = sort === 'amount' ? 'i.total DESC' : sort === 'amount_asc' ? 'i.total ASC' : 'i.created_at DESC';

    const countResult = await pool.query(`SELECT COUNT(*) FROM invoices i WHERE ${where.join(' AND ')}`, params);
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    const invoices = (await pool.query(
      `SELECT i.* FROM invoices i WHERE ${where.join(' AND ')} ORDER BY ${orderClause} LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    )).rows;

    const statusCounts = (await pool.query(
      `SELECT status, COUNT(*) as cnt FROM invoices WHERE tenant_id=$1 GROUP BY status`, [tid]
    )).rows;
    const statusMap = {};
    statusCounts.forEach(s => { statusMap[s.status] = parseInt(s.cnt); });

    const allCount = Object.values(statusMap).reduce((a, b) => a + b, 0);

    const rowsHtml = invoices.map(inv => `<tr>
      <td><a href="/invoicing/view/${inv.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(inv.invoice_number)}</a></td>
      <td>${esc(inv.client_name)}</td>
      <td>${fmtDate(inv.issue_date)}</td>
      <td>${fmtDate(inv.due_date)}</td>
      <td class="right">${fmtMoney(inv.total, inv.currency)}</td>
      <td class="right">${fmtMoney(inv.paid_amount, inv.currency)}</td>
      <td>${invBadge(inv.status)}</td>
      <td><a href="/invoicing/view/${inv.id}" class="btn btn-sm" style="background:#4f46e5;color:#fff">View</a></td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing/list')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">All Invoices</h1>
        <a href="/invoicing/new" class="btn btn-success">+ New Invoice</a>
      </div>
      <div class="status-tabs">
        <a href="/invoicing/list" class="${!fStatus || fStatus === 'all' ? 'active' : ''}">All (${allCount})</a>
        <a href="/invoicing/list?status=draft" class="${fStatus === 'draft' ? 'active' : ''}">Draft (${statusMap.draft || 0})</a>
        <a href="/invoicing/list?status=sent" class="${fStatus === 'sent' ? 'active' : ''}">Sent (${statusMap.sent || 0})</a>
        <a href="/invoicing/list?status=paid" class="${fStatus === 'paid' ? 'active' : ''}">Paid (${statusMap.paid || 0})</a>
        <a href="/invoicing/list?status=overdue" class="${fStatus === 'overdue' ? 'active' : ''}">Overdue (${statusMap.overdue || 0})</a>
        <a href="/invoicing/list?status=cancelled" class="${fStatus === 'cancelled' ? 'active' : ''}">Cancelled (${statusMap.cancelled || 0})</a>
      </div>
      <div class="card">
        <form method="GET" action="/invoicing/list" class="filter-bar">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Client, invoice #, email..."></div>
          <div><label>From Date</label><input type="date" name="from_date" value="${esc(from_date || '')}"></div>
          <div><label>To Date</label><input type="date" name="to_date" value="${esc(to_date || '')}"></div>
          <div><label>Sort By</label>
            <select name="sort">
              <option value="date" ${sort === 'date' || !sort ? 'selected' : ''}>Newest First</option>
              <option value="amount" ${sort === 'amount' ? 'selected' : ''}>Highest Amount</option>
              <option value="amount_asc" ${sort === 'amount_asc' ? 'selected' : ''}>Lowest Amount</option>
            </select></div>
          <button type="submit" class="btn btn-sm" style="background:#4f46e5;color:#fff;margin-top:auto">Filter</button>
          <a href="/invoicing/list" class="btn btn-sm" style="background:#f1f5f9;color:#475569;margin-top:auto">Clear</a>
        </form>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Invoice #</th><th>Client</th><th>Issue Date</th><th>Due Date</th><th class="right">Total</th><th class="right">Paid</th><th>Status</th><th></th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No invoices found.</td></tr>'}</tbody>
        </table></div>
        ${paginationHtml(page, totalPages, '/invoicing/list?' + new URLSearchParams({ q: q || '', status: fStatus || '', from_date: from_date || '', to_date: to_date || '', sort: sort || '' }).toString())}
      </div>
    </div>`;
    res.send(renderPage('All Invoices', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /invoicing/update/:id — Update Invoice
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/update/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const inv = (await pool.query('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.send('<div class="alert alert-danger">Invoice not found.</div><a href="/invoicing" class="btn">Back</a>');
    if (inv.status !== 'draft') return res.send('<div class="alert alert-danger">Only draft invoices can be edited.</div><a href="/invoicing/view/' + id + '" class="btn">Back</a>');

    const { client_name, client_email, client_phone, client_address, issue_date, due_date,
      currency, tax_rate, discount, notes, terms } = req.body;

    if (!client_name || !client_name.trim()) {
      return res.send('<div class="alert alert-danger">Client name is required.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }

    // Gather line items
    const items = [];
    let idx = 1;
    while (req.body['item_name_' + idx]) {
      const qty = parseFloat(req.body['item_qty_' + idx]) || 0;
      const unitPrice = parseFloat(req.body['item_price_' + idx]) || 0;
      items.push({
        name: (req.body['item_name_' + idx] || '').trim(),
        description: (req.body['item_desc_' + idx] || '').trim() || null,
        quantity: qty,
        unit_price: unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100
      });
      idx++;
    }
    if (items.length === 0) {
      return res.send('<div class="alert alert-danger">At least one line item is required.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }

    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const taxRateVal = parseFloat(tax_rate) || 0;
    const discountVal = parseFloat(discount) || 0;
    const taxAmount = Math.round(subtotal * (taxRateVal / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount - discountVal) * 100) / 100;

    console.log('[Invoicing] Updating invoice:', inv.invoice_number);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE invoices SET client_name=$1, client_email=$2, client_phone=$3, client_address=$4,
          issue_date=$5, due_date=$6, currency=$7, tax_rate=$8, tax_amount=$9, discount=$10,
          subtotal=$11, total=$12, notes=$13, terms=$14, updated_at=NOW()
         WHERE id=$15 AND tenant_id=$16`,
        [client_name.trim(), (client_email || '').trim() || null, (client_phone || '').trim() || null,
          (client_address || '').trim() || null, issue_date, due_date, currency || 'UGX',
          taxRateVal, taxAmount, discountVal, Math.round(subtotal * 100) / 100, total,
          (notes || '').trim() || null, (terms || '').trim() || null, id, tid]
      );
      await client.query('DELETE FROM invoice_items WHERE invoice_id=$1 AND tenant_id=$2', [id, tid]);
      for (const item of items) {
        await client.query(
          `INSERT INTO invoice_items (tenant_id, invoice_id, item_name, description, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, id, item.name, item.description, item.quantity, item.unit_price, item.total]
        );
      }
      await client.query('COMMIT');
      console.log('[Invoicing] Invoice updated:', inv.invoice_number);
      res.redirect('/invoicing/view/' + id);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[Invoicing] Update error:', e.message);
      return res.send('<div class="alert alert-danger">Error updating invoice: ' + esc(e.message) + '</div><a href="javascript:history.back()" class="btn">Back</a>');
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: POST /invoicing/delete/:id — Delete Invoice
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/delete/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const inv = (await pool.query('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.send('<div class="alert alert-danger">Invoice not found.</div><a href="/invoicing" class="btn">Back</a>');
    if (inv.status !== 'draft') return res.send('<div class="alert alert-danger">Only draft invoices can be deleted.</div><a href="/invoicing/view/' + id + '" class="btn">Back</a>');

    console.log('[Invoicing] Deleting invoice:', inv.invoice_number);
    await pool.query('DELETE FROM invoice_items WHERE invoice_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM payments WHERE invoice_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.redirect('/invoicing');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: POST /invoicing/send/:id — Mark as Sent
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/send/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const inv = (await pool.query('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.send('<div class="alert alert-danger">Invoice not found.</div><a href="/invoicing" class="btn">Back</a>');
    if (inv.status !== 'draft') return res.redirect('/invoicing/view/' + id);

    console.log('[Invoicing] Sending invoice:', inv.invoice_number);
    await pool.query("UPDATE invoices SET status='sent', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [id, tid]);
    console.log('[Invoicing] Activity: Invoice ' + inv.invoice_number + ' sent by user ' + user.id);
    res.redirect('/invoicing/view/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /invoicing/pay/:id — Record Payment
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/pay/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const inv = (await pool.query('SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!inv) return res.send('<div class="alert alert-danger">Invoice not found.</div><a href="/invoicing" class="btn">Back</a>');

    const { amount, payment_method, reference, pay_notes } = req.body;
    const payAmount = parseFloat(amount);
    if (!payAmount || payAmount <= 0) {
      return res.send('<div class="alert alert-danger">Payment amount must be greater than 0.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }

    const validMethods = ['cash', 'mobile_money', 'bank_transfer', 'card', 'cheque', 'other'];
    const method = validMethods.includes(payment_method) ? payment_method : 'cash';
    const remaining = Number(inv.total) - Number(inv.paid_amount);

    console.log('[Invoicing] Recording payment:', payAmount, 'for invoice:', inv.invoice_number, 'method:', method);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO payments (tenant_id, invoice_id, amount, payment_method, reference, status, notes, received_by)
         VALUES ($1,$2,$3,$4,$5,'completed',$6,$7)`,
        [tid, id, payAmount, method, (reference || '').trim() || null, (pay_notes || '').trim() || null, user.id]
      );

      const newPaid = Math.round((Number(inv.paid_amount) + payAmount) * 100) / 100;
      let newStatus = inv.status;
      if (newPaid >= Number(inv.total)) {
        newStatus = 'paid';
      } else if (inv.status !== 'overdue') {
        newStatus = 'partially_paid';
      }

      await client.query(
        `UPDATE invoices SET paid_amount=$1, status=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4`,
        [newPaid, newStatus, id, tid]
      );

      await client.query('COMMIT');
      console.log('[Invoicing] Payment recorded. Invoice status:', newStatus);
      res.redirect('/invoicing/view/' + id);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[Invoicing] Payment error:', e.message);
      return res.send('<div class="alert alert-danger">Error recording payment: ' + esc(e.message) + '</div><a href="javascript:history.back()" class="btn">Back</a>');
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /invoicing/payments — Payment History
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/payments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, method: fMethod, from_date, to_date, page: qPage } = req.query;
    const page = Math.max(1, parseInt(qPage) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = ['p.tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(i.client_name ILIKE $${pi} OR i.invoice_number ILIKE $${pi} OR p.reference ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (fMethod) { where.push(`p.payment_method=$${pi}`); params.push(fMethod); pi++; }
    if (from_date) { where.push(`p.created_at >= $${pi}`); params.push(from_date); pi++; }
    if (to_date) { where.push(`p.created_at < ($${pi}::date + interval '1 day')`); params.push(to_date); pi++; }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE ${where.join(' AND ')}`, params
    );
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    const payments = (await pool.query(
      `SELECT p.*, i.invoice_number, i.client_name, i.currency, u.name as received_by_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN users u ON u.id = p.received_by
       WHERE ${where.join(' AND ')}
       ORDER BY p.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    )).rows;

    const totalRevenue = (await pool.query(
      `SELECT COALESCE(SUM(p.amount),0) as total FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id=$1 AND p.status='completed' ${q ? 'AND (i.client_name ILIKE $2 OR i.invoice_number ILIKE $2)' : ''}`,
      q ? [tid, '%' + q + '%'] : [tid]
    )).rows[0].total;

    const rowsHtml = payments.map(p => `<tr>
      <td><a href="/invoicing/view/${p.invoice_id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(p.invoice_number)}</a></td>
      <td>${esc(p.client_name)}</td>
      <td class="right" style="font-weight:600">${fmtMoney(p.amount, p.currency)}</td>
      <td><span style="text-transform:capitalize">${esc(p.payment_method)}</span></td>
      <td>${esc(p.reference || '\u2014')}</td>
      <td>${payBadge(p.status)}</td>
      <td>${esc(p.received_by_name || '\u2014')}</td>
      <td>${fmtDateTime(p.created_at)}</td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing/payments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">Payment History</h1>
          <div style="font-size:14px;color:#16a34a;font-weight:700;margin-top:4px">Total Collected: ${fmtMoney(totalRevenue)}</div>
        </div>
      </div>
      <div class="card">
        <form method="GET" action="/invoicing/payments" class="filter-bar">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Invoice #, client, reference..."></div>
          <div><label>Method</label>
            <select name="method">
              <option value="">All Methods</option>
              <option value="cash" ${fMethod === 'cash' ? 'selected' : ''}>Cash</option>
              <option value="mobile_money" ${fMethod === 'mobile_money' ? 'selected' : ''}>Mobile Money</option>
              <option value="bank_transfer" ${fMethod === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
              <option value="card" ${fMethod === 'card' ? 'selected' : ''}>Card</option>
              <option value="cheque" ${fMethod === 'cheque' ? 'selected' : ''}>Cheque</option>
              <option value="other" ${fMethod === 'other' ? 'selected' : ''}>Other</option>
            </select></div>
          <div><label>From</label><input type="date" name="from_date" value="${esc(from_date || '')}"></div>
          <div><label>To</label><input type="date" name="to_date" value="${esc(to_date || '')}"></div>
          <button type="submit" class="btn btn-sm" style="background:#4f46e5;color:#fff;margin-top:auto">Filter</button>
          <a href="/invoicing/payments" class="btn btn-sm" style="background:#f1f5f9;color:#475569;margin-top:auto">Clear</a>
        </form>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Invoice #</th><th>Client</th><th class="right">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Received By</th><th>Date</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No payments found.</td></tr>'}</tbody>
        </table></div>
        ${paginationHtml(page, totalPages, '/invoicing/payments?' + new URLSearchParams({ q: q || '', method: fMethod || '', from_date: from_date || '', to_date: to_date || '' }).toString())}
      </div>
    </div>`;
    res.send(renderPage('Payment History', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: GET /invoicing/recurring — Recurring Invoices
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/recurring', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    console.log('[Invoicing] Recurring invoices list for tenant:', tid);

    const recurring = (await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id=$1 AND i.client_name=r.client_name
          AND i.issue_date >= date_trunc('month', CURRENT_DATE)) as invoices_this_month
       FROM recurring_invoices r WHERE r.tenant_id=$1 ORDER BY r.created_at DESC`, [tid]
    )).rows;

    const rowsHtml = recurring.map(r => {
      const freqLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
      return `<tr>
        <td>${esc(r.client_name)}</td>
        <td><span class="badge" style="background:${r.is_active ? '#dcfce7;color:#16a34a' : '#f3f4f6;color:#6b7280'}">${r.is_active ? 'Active' : 'Paused'}</span></td>
        <td>${esc(freqLabel[r.frequency] || r.frequency)}</td>
        <td class="right">${fmtMoney(r.total, r.currency)}</td>
        <td>${fmtDate(r.next_date)}</td>
        <td>${fmtDateTime(r.last_generated)}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap">
          ${r.is_active
            ? `<form method="POST" action="/invoicing/recurring/pause/${r.id}" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#f59e0b;color:#fff">Pause</button></form>`
            : `<form method="POST" action="/invoicing/recurring/resume/${r.id}" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#16a34a;color:#fff">Resume</button></form>`}
          <form method="POST" action="/invoicing/recurring/generate/${r.id}" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#4f46e5;color:#fff">Generate Now</button></form>
          <form method="POST" action="/invoicing/recurring/delete/${r.id}" onsubmit="return confirm('Delete this recurring invoice?')" style="display:inline"><button type="submit" class="btn btn-sm" style="background:#dc2626;color:#fff">Delete</button></form>
        </td>
      </tr>`;
    }).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing/recurring')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">Recurring Invoices</h1>
        <a href="/invoicing/recurring/new" class="btn btn-success">+ New Recurring</a>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Client</th><th>Status</th><th>Frequency</th><th class="right">Amount</th><th>Next Date</th><th>Last Generated</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No recurring invoices. <a href="/invoicing/recurring/new" style="color:#4f46e5">Create one</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Recurring Invoices', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: GET /invoicing/recurring/new — Create Recurring
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/recurring/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = INV_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/invoicing/recurring')}
      <a href="/invoicing/recurring" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Recurring</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">New Recurring Invoice</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Set up automatic invoice generation</p>
        <form method="POST" action="/invoicing/recurring/new" id="recurringForm">
          <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken || '')}">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Client Information</h3>
          <div class="form-grid">
            ${field('Client Name *', 'client_name', 'text', '', { required: true, placeholder: 'Acme Corporation' })}
            ${field('Email', 'client_email', 'email', '', { placeholder: 'billing@acme.com' })}
            ${field('Phone', 'client_phone', 'tel', '', { placeholder: '+256 700 000 000' })}
            ${field('Address', 'client_address', 'text', '', { placeholder: '123 Business Street' })}
          </div>
          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Invoice Details</h3>
          <div class="form-grid">
            ${selectField('Frequency *', 'frequency', [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['quarterly','Quarterly'],['yearly','Yearly']], 'monthly')}
            ${field('First Invoice Date *', 'next_date', 'date', today(), { required: true })}
            ${selectField('Currency', 'currency', [['UGX','UGX'],['KES','KES'],['TZS','TZS'],['USD','USD'],['RWF','RWF']], 'UGX')}
            ${field('Tax Rate (%)', 'tax_rate', 'number', '0', {})}
            ${field('Discount', 'discount', 'number', '0', {})}
          </div>
          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Line Items</h3>
          <div class="line-items">
            <div class="line-items-header">
              <span style="font-weight:700;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Items</span>
              <button type="button" onclick="addRecurringItem()" class="btn btn-sm" style="background:#16a34a;color:#fff">+ Add Item</button>
            </div>
            <div id="recurringItemsContainer">
              <div class="line-item-row" data-row="1">
                <input type="text" name="r_item_name_1" placeholder="Item name" required>
                <input type="text" name="r_item_desc_1" placeholder="Description">
                <input type="number" name="r_item_qty_1" value="1" min="0" step="any" class="r-qty">
                <input type="number" name="r_item_price_1" value="0" min="0" step="0.01" class="r-price">
                <input type="text" name="r_item_total_1" value="0.00" readonly style="background:#f8fafc;font-weight:600">
                <button type="button" onclick="removeRecurringItem(this)" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;padding:6px 8px">&times;</button>
              </div>
            </div>
          </div>
          <div class="form-grid" style="margin-top:16px">
            <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Notes..."></textarea></div>
            <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Terms & Conditions</label>
              <textarea name="terms" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Payment terms...">Payment is due within 30 days.</textarea></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="btn" style="padding:12px 28px;background:#4f46e5;color:#fff">Create Recurring Invoice</button>
            <a href="/invoicing/recurring" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px">Cancel</a>
          </div>
        </form>
      </div>
    </div>
    <script>
    let recurringCounter = 1;
    function addRecurringItem() {
      recurringCounter++;
      const container = document.getElementById('recurringItemsContainer');
      const row = document.createElement('div');
      row.className = 'line-item-row';
      row.innerHTML = '<input type="text" name="r_item_name_' + recurringCounter + '" placeholder="Item name" required>'
        + '<input type="text" name="r_item_desc_' + recurringCounter + '" placeholder="Description">'
        + '<input type="number" name="r_item_qty_' + recurringCounter + '" value="1" min="0" step="any" class="r-qty">'
        + '<input type="number" name="r_item_price_' + recurringCounter + '" value="0" min="0" step="0.01" class="r-price">'
        + '<input type="text" name="r_item_total_' + recurringCounter + '" value="0.00" readonly style="background:#f8fafc;font-weight:600">'
        + '<button type="button" onclick="removeRecurringItem(this)" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;padding:6px 8px">&times;</button>';
      container.appendChild(row);
    }
    function removeRecurringItem(btn) {
      if (document.querySelectorAll('#recurringItemsContainer .line-item-row').length <= 1) { alert('At least one item required.'); return; }
      btn.closest('.line-item-row').remove();
    }
    </script>`;
    res.send(renderPage('New Recurring Invoice', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12b: POST /invoicing/recurring/new — Save Recurring
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/recurring/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { client_name, client_email, client_phone, client_address,
      frequency, next_date, currency, tax_rate, discount, notes, terms } = req.body;

    if (!client_name || !client_name.trim()) {
      return res.send('<div class="alert alert-danger">Client name is required.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }
    if (!next_date) {
      return res.send('<div class="alert alert-danger">First invoice date is required.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }

    // Gather items
    const items = [];
    let idx = 1;
    while (req.body['r_item_name_' + idx]) {
      const qty = parseFloat(req.body['r_item_qty_' + idx]) || 0;
      const unitPrice = parseFloat(req.body['r_item_price_' + idx]) || 0;
      items.push({
        name: (req.body['r_item_name_' + idx] || '').trim(),
        description: (req.body['r_item_desc_' + idx] || '').trim() || null,
        quantity: qty,
        unit_price: unitPrice,
        total: Math.round(qty * unitPrice * 100) / 100
      });
      idx++;
    }
    if (items.length === 0) {
      return res.send('<div class="alert alert-danger">At least one line item is required.</div><a href="javascript:history.back()" class="btn">Back</a>');
    }

    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const taxRateVal = parseFloat(tax_rate) || 0;
    const discountVal = parseFloat(discount) || 0;
    const taxAmount = Math.round(subtotal * (taxRateVal / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount - discountVal) * 100) / 100;

    console.log('[Invoicing] Creating recurring invoice for client:', client_name.trim());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recResult = await client.query(
        `INSERT INTO recurring_invoices (tenant_id, client_name, client_email, client_phone, client_address,
          subtotal, tax_rate, tax_amount, discount, total, notes, terms, currency, frequency, next_date, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16) RETURNING id`,
        [tid, client_name.trim(), (client_email || '').trim() || null,
          (client_phone || '').trim() || null, (client_address || '').trim() || null,
          Math.round(subtotal * 100) / 100, taxRateVal, taxAmount, discountVal, total,
          (notes || '').trim() || null, (terms || '').trim() || null, currency || 'UGX',
          frequency || 'monthly', next_date, user.id]
      );
      const recId = recResult.rows[0].id;

      for (const item of items) {
        await client.query(
          `INSERT INTO recurring_invoice_items (tenant_id, recurring_id, item_name, description, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, recId, item.name, item.description, item.quantity, item.unit_price, item.total]
        );
      }
      await client.query('COMMIT');
      console.log('[Invoicing] Recurring invoice created, id:', recId);
      res.redirect('/invoicing/recurring');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[Invoicing] Recurring create error:', e.message);
      return res.send('<div class="alert alert-danger">Error: ' + esc(e.message) + '</div><a href="javascript:history.back()" class="btn">Back</a>');
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: POST /invoicing/recurring/generate/:id
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/recurring/generate/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const rec = (await pool.query('SELECT * FROM recurring_invoices WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!rec) return res.send('<div class="alert alert-danger">Recurring invoice not found.</div><a href="/invoicing/recurring" class="btn">Back</a>');

    const recItems = (await pool.query(
      'SELECT * FROM recurring_invoice_items WHERE recurring_id=$1 AND tenant_id=$2', [id, tid]
    )).rows;

    console.log('[Invoicing] Generating invoice from recurring template:', id, 'for client:', rec.client_name);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invoiceNumber = await generateInvoiceNumber(tid);
      const invResult = await client.query(
        `INSERT INTO invoices (tenant_id, invoice_number, client_name, client_email, client_phone, client_address,
          issue_date, due_date, subtotal, tax_rate, tax_amount, discount, total, status, notes, terms, created_by, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'sent',$14,$15,$16,$17) RETURNING id`,
        [tid, invoiceNumber, rec.client_name, rec.client_email, rec.client_phone, rec.client_address,
          rec.next_date || today(), addFrequency(rec.next_date || today(), rec.frequency),
          rec.subtotal, rec.tax_rate, rec.tax_amount, rec.discount, rec.total,
          rec.notes, rec.terms, user.id, rec.currency]
      );
      const invId = invResult.rows[0].id;

      for (const item of recItems) {
        await client.query(
          `INSERT INTO invoice_items (tenant_id, invoice_id, item_name, description, quantity, unit_price, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, invId, item.item_name, item.description, item.quantity, item.unit_price, item.total]
        );
      }

      const newNextDate = addFrequency(rec.next_date || today(), rec.frequency);
      await client.query(
        `UPDATE recurring_invoices SET last_generated=NOW(), next_date=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
        [newNextDate, id, tid]
      );

      await client.query('COMMIT');
      console.log('[Invoicing] Generated invoice:', invoiceNumber, 'from recurring:', id);
      res.redirect('/invoicing/view/' + invId);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[Invoicing] Generate error:', e.message);
      return res.send('<div class="alert alert-danger">Error: ' + esc(e.message) + '</div><a href="javascript:history.back()" class="btn">Back</a>');
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13b: POST /invoicing/recurring/pause/:id
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/recurring/pause/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    console.log('[Invoicing] Pausing recurring invoice:', id);
    await pool.query("UPDATE recurring_invoices SET is_active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [id, tid]);
    res.redirect('/invoicing/recurring');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13c: POST /invoicing/recurring/resume/:id
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/recurring/resume/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    console.log('[Invoicing] Resuming recurring invoice:', id);
    await pool.query("UPDATE recurring_invoices SET is_active=true, updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [id, tid]);
    res.redirect('/invoicing/recurring');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13d: POST /invoicing/recurring/delete/:id
  // ════════════════════════════════════════════════════════════
  app.post('/invoicing/recurring/delete/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    console.log('[Invoicing] Deleting recurring invoice:', id);
    await pool.query('DELETE FROM recurring_invoice_items WHERE recurring_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM recurring_invoices WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.redirect('/invoicing/recurring');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /invoicing/overdue — Overdue Invoices
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/overdue', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    console.log('[Invoicing] Checking overdue invoices for tenant:', tid);

    // Batch update: mark sent invoices as overdue where due_date < NOW()
    const updateResult = await pool.query(
      `UPDATE invoices SET status='overdue', updated_at=NOW()
       WHERE tenant_id=$1 AND status='sent' AND due_date < CURRENT_DATE`,
      [tid]
    );
    if (updateResult.rowCount > 0) {
      console.log('[Invoicing] Marked', updateResult.rowCount, 'invoices as overdue');
    }

    const overdueInvoices = (await pool.query(`
      SELECT i.*,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id AND p.status='completed') as total_paid
      FROM invoices i
      WHERE i.tenant_id=$1 AND (i.status='overdue' OR (i.status='sent' AND i.due_date < CURRENT_DATE))
      ORDER BY i.due_date ASC`, [tid]
    )).rows;

    const totalOverdue = overdueInvoices.reduce((s, i) => s + Number(i.total) - Number(i.paid_amount || 0), 0);

    const rowsHtml = overdueInvoices.map(inv => {
      const remaining = Math.round((Number(inv.total) - Number(inv.paid_amount || 0)) * 100) / 100;
      const daysOverdue = Math.floor((new Date() - new Date(inv.due_date)) / (1000 * 60 * 60 * 24));
      return `<tr>
        <td><a href="/invoicing/view/${inv.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(inv.invoice_number)}</a></td>
        <td>${esc(inv.client_name)}</td>
        <td>${fmtDate(inv.due_date)}</td>
        <td style="color:#dc2626;font-weight:700">${daysOverdue} days</td>
        <td class="right">${fmtMoney(inv.total, inv.currency)}</td>
        <td class="right" style="color:#dc2626;font-weight:700">${fmtMoney(remaining, inv.currency)}</td>
        <td>${invBadge(inv.status)}</td>
        <td>
          <a href="/invoicing/view/${inv.id}" class="btn btn-sm" style="background:#4f46e5;color:#fff">View</a>
          <form method="POST" action="/invoicing/send/${inv.id}" style="display:inline" onsubmit="return confirm('Send reminder?')">
            <button type="submit" class="btn btn-sm" style="background:#f59e0b;color:#fff">Send Reminder</button>
          </form>
        </td>
      </tr>`;
    }).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing/overdue')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#dc2626">Overdue Invoices</h1>
          <div style="font-size:14px;color:#dc2626;font-weight:700;margin-top:4px">Total Overdue: ${fmtMoney(totalOverdue)}</div>
        </div>
        <div style="font-size:13px;color:#94a3b8">${overdueInvoices.length} overdue invoice${overdueInvoices.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Invoice #</th><th>Client</th><th>Due Date</th><th>Days Overdue</th><th class="right">Total</th><th class="right">Outstanding</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No overdue invoices. Great job!</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Overdue Invoices', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 15: GET /invoicing/stats — Revenue Analytics (JSON)
  // ════════════════════════════════════════════════════════════
  app.get('/invoicing/stats', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    console.log('[Invoicing] Analytics for tenant:', tid);

    // Revenue by month (last 12 months)
    const monthlyRevenue = (await pool.query(`
      SELECT TO_CHAR(issue_date, 'YYYY-MM') as month, SUM(total) as revenue, COUNT(*) as invoice_count
      FROM invoices
      WHERE tenant_id=$1 AND status IN ('paid','partially_paid')
        AND issue_date >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
      ORDER BY month DESC`, [tid]
    )).rows;

    // Revenue by payment method
    const methodRevenue = (await pool.query(`
      SELECT payment_method, SUM(amount) as total, COUNT(*) as count
      FROM payments
      WHERE tenant_id=$1 AND status='completed'
      GROUP BY payment_method
      ORDER BY total DESC`, [tid]
    )).rows;

    // Top clients by revenue
    const topClients = (await pool.query(`
      SELECT client_name, SUM(total) as total_revenue, COUNT(*) as invoice_count,
        COALESCE(SUM(paid_amount),0) as total_paid
      FROM invoices
      WHERE tenant_id=$1
      GROUP BY client_name
      ORDER BY total_revenue DESC LIMIT 10`, [tid]
    )).rows;

    // Summary stats
    const summary = (await pool.query(`
      SELECT
        (SELECT AVG(total) FROM invoices WHERE tenant_id=$1 AND status IN ('paid','partially_paid')) as avg_invoice,
        (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1) as total_invoices,
        (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1 AND status='paid') as paid_count,
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE tenant_id=$1) as total_revenue,
        (SELECT COALESCE(SUM(paid_amount),0) FROM invoices WHERE tenant_id=$1) as total_collected,
        (SELECT COALESCE(SUM(total - paid_amount),0) FROM invoices WHERE tenant_id=$1 AND status IN ('sent','overdue','partially_paid')) as total_outstanding
    `, [tid])).rows[0];

    // Average payment time (days between issue and first payment)
    const avgPaymentTime = (await pool.query(`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (p.created_at - i.issue_date)) / 86400), 0) as avg_days
      FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.tenant_id=$1 AND p.status='completed' AND i.issue_date IS NOT NULL`, [tid]
    )).rows[0].avg_days;

    const statsData = {
      monthlyRevenue: monthlyRevenue.map(r => ({
        month: r.month,
        revenue: parseFloat(r.revenue),
        invoiceCount: parseInt(r.invoice_count)
      })),
      revenueByMethod: methodRevenue.map(r => ({
        method: r.payment_method,
        total: parseFloat(r.total),
        count: parseInt(r.count)
      })),
      topClients: topClients.map(r => ({
        name: r.client_name,
        revenue: parseFloat(r.total_revenue),
        paid: parseFloat(r.total_paid),
        invoiceCount: parseInt(r.invoice_count)
      })),
      summary: {
        avgInvoiceValue: parseFloat(summary.avg_invoice) || 0,
        totalInvoices: parseInt(summary.total_invoices),
        paidInvoices: parseInt(summary.paid_count),
        totalRevenue: parseFloat(summary.total_revenue),
        totalCollected: parseFloat(summary.total_collected),
        totalOutstanding: parseFloat(summary.total_outstanding),
        avgPaymentDays: parseFloat(avgPaymentTime) || 0
      }
    };

    // If requested as JSON (for chart integration)
    if (req.query.format === 'json') {
      return res.json(statsData);
    }

    // Otherwise render HTML dashboard
    const monthlyHtml = statsData.monthlyRevenue.map(m => `<tr>
      <td>${esc(m.month)}</td>
      <td class="right" style="font-weight:600">${fmtMoney(m.revenue)}</td>
      <td class="right">${m.invoiceCount}</td>
    </tr>`).join('');

    const methodHtml = statsData.revenueByMethod.map(m => `<tr>
      <td style="text-transform:capitalize">${esc(m.method.replace('_', ' '))}</td>
      <td class="right" style="font-weight:600">${fmtMoney(m.total)}</td>
      <td class="right">${m.count}</td>
    </tr>`).join('');

    const clientHtml = statsData.topClients.map(c => `<tr>
      <td style="font-weight:600">${esc(c.name)}</td>
      <td class="right" style="font-weight:600">${fmtMoney(c.revenue)}</td>
      <td class="right">${fmtMoney(c.paid)}</td>
      <td class="right">${c.invoiceCount}</td>
    </tr>`).join('');

    const html = INV_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/invoicing/stats')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">Revenue Analytics</h1>
        <a href="/invoicing/stats?format=json" target="_blank" class="btn btn-sm" style="background:#64748b;color:#fff">Export JSON</a>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="num" style="color:#4f46e5">${fmtMoney(statsData.summary.totalRevenue)}</div><div class="label">Total Revenue</div></div>
        <div class="stat-card"><div class="num" style="color:#16a34a">${fmtMoney(statsData.summary.totalCollected)}</div><div class="label">Total Collected</div></div>
        <div class="stat-card"><div class="num" style="color:#d97706">${fmtMoney(statsData.summary.totalOutstanding)}</div><div class="label">Outstanding</div></div>
        <div class="stat-card"><div class="num" style="color:#0891b2">${fmtMoney(statsData.summary.avgInvoiceValue)}</div><div class="label">Avg Invoice Value</div></div>
        <div class="stat-card"><div class="num" style="color:#7c3aed">${statsData.summary.avgPaymentDays.toFixed(1)} days</div><div class="label">Avg Payment Time</div></div>
        <div class="stat-card"><div class="num" style="color:#1e293b">${statsData.summary.paidInvoices} / ${statsData.summary.totalInvoices}</div><div class="label">Paid / Total Invoices</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px">
        <div class="card">
          <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Monthly Revenue (Last 12 Months)</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Month</th><th class="right">Revenue</th><th class="right">Invoices</th></tr></thead>
            <tbody>${monthlyHtml || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Revenue by Payment Method</h3>
          <div style="overflow-x:auto"><table class="inv-tbl">
            <thead><tr><th>Method</th><th class="right">Total</th><th class="right">Transactions</th></tr></thead>
            <tbody>${methodHtml || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="color:#1e293b;font-size:16px;margin-bottom:16px">Top Clients by Revenue</h3>
        <div style="overflow-x:auto"><table class="inv-tbl">
          <thead><tr><th>Client</th><th class="right">Total Revenue</th><th class="right">Paid</th><th class="right">Invoices</th></tr></thead>
          <tbody>${clientHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
    <style>
    @media(max-width:768px){[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr !important}}
    </style>`;
    res.send(renderPage('Revenue Analytics', html, user, req));
  }));

  console.log('[Invoicing] Module loaded successfully');
};
