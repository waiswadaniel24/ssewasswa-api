// ============================================================
// FEE INSTALLMENT PLAN MODULE — Multi-Tenant SaaS School Platform
// Allows parents to pay fees in monthly installments instead of
// lump sum. Includes dashboard, scheduling, payment recording,
// SMS reminders, receipt generation, and analytics.
// ============================================================
// Usage in server.js:
//   try { const m = require('./fee-installments');
//         m(app, db, pool, renderPage, esc);
//         console.log('[FeeInstallments] Module loaded'); }
//   catch(e) { console.warn('[FeeInstallments] Error:', e.message); }
// ============================================================

'use strict';

module.exports = function feeInstallments(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ── formatters ────────────────────────────────────────────
  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  // ── status badges ─────────────────────────────────────────
  function planBadge(status) {
    const m = {
      active:    { bg: '#ede9fe', c: '#7c3aed', l: 'Active' },
      completed: { bg: '#dcfce7', c: '#16a34a', l: 'Completed' },
      defaulted: { bg: '#fee2e2', c: '#dc2626', l: 'Defaulted' },
      cancelled: { bg: '#f3f4f6', c: '#6b7280', l: 'Cancelled' }
    };
    const s = m[status] || m.active;
    return `<span class="fi-badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function installmentBadge(status) {
    const m = {
      pending:       { bg: '#fef9c3', c: '#a16207', l: 'Pending' },
      paid:          { bg: '#dcfce7', c: '#16a34a', l: 'Paid' },
      overdue:       { bg: '#fee2e2', c: '#dc2626', l: 'Overdue' },
      partially_paid:{ bg: '#dbeafe', c: '#2563eb', l: 'Partial' }
    };
    const s = m[status] || m.pending;
    return `<span class="fi-badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function methodIcon(method) {
    const m = { mtn_momo: '📱 MTN', airtel_money: '📱 Airtel', cash: '💵 Cash', bank_transfer: '🏦 Bank' };
    return m[method] || '💰 ' + (method || 'N/A');
  }

  // ── inline CSS ────────────────────────────────────────────
  const FI_CSS = `<style>
.fi-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.fi-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.fi-nav a:hover{background:#e2e8f0}
.fi-nav a.active{background:#7c3aed;color:#fff}
.fi-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700}
.fi-tbl{width:100%;border-collapse:collapse;font-size:13px}
.fi-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;white-space:nowrap}
.fi-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.fi-tbl tr:hover{background:#f8fafc}
.fi-tbl td.right,.fi-tbl th.right{text-align:right}
.fi-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fi-form-grid .full{grid-column:1/-1}
.fi-stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.fi-stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}
.fi-stat-card .num{font-size:24px;font-weight:800;color:#1e293b}
.fi-stat-card .label{font-size:12px;color:#94a3b8;margin-top:4px}
.fi-progress{width:100%;height:10px;background:#f1f5f9;border-radius:10px;overflow:hidden}
.fi-progress-bar{height:100%;border-radius:10px;transition:width .4s ease}
.fi-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.fi-filter label{font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px}
.fi-filter input,.fi-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.fi-filter input:focus,.fi-filter select:focus{outline:none;border-color:#7c3aed}
.fi-schedule-item{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;transition:.15s}
.fi-schedule-item:hover{box-shadow:0 2px 8px rgba(124,58,237,.08)}
.fi-schedule-num{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.fi-schedule-num.paid{background:#dcfce7;color:#16a34a}
.fi-schedule-num.pending{background:#fef9c3;color:#a16207}
.fi-schedule-num.overdue{background:#fee2e2;color:#dc2626}
.fi-schedule-num.partial{background:#dbeafe;color:#2563eb}
.fi-schedule-num.cancelled{background:#f3f4f6;color:#6b7280}
.fi-timeline{position:relative;padding-left:40px}
.fi-timeline::before{content:'';position:absolute;left:17px;top:0;bottom:0;width:3px;background:#e2e8f0;border-radius:3px}
.fi-receipt{max-width:700px;margin:0 auto;background:#fff;border:2px solid #7c3aed;border-radius:0;overflow:hidden;color:#1e293b}
.fi-receipt-header{background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;padding:28px 32px}
.fi-receipt-body{padding:28px 32px}
.fi-receipt-body table{width:100%;border-collapse:collapse;margin:16px 0}
.fi-receipt-body th,.fi-receipt-body td{padding:10px 14px;text-align:left;border-bottom:1px solid #f1f5f9;font-size:13px}
.fi-receipt-body th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
.fi-receipt-total{font-size:22px;font-weight:800;text-align:right;padding:16px 14px;border-top:3px solid #7c3aed}
.fi-chart-bar{display:flex;align-items:end;gap:8px;height:180px;padding:0 8px}
.fi-chart-col{flex:1;border-radius:6px 6px 0 0;position:relative;min-width:30px;transition:.3s}
.fi-chart-col:hover{opacity:.85}
.fi-chart-label{position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);font-size:10px;color:#64748b;white-space:nowrap}
.fi-chart-val{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#1e293b}
@media(max-width:768px){
  .fi-form-grid{grid-template-columns:1fr}
  .fi-nav{flex-direction:column}
  .fi-stat-cards{grid-template-columns:1fr 1fr}
  .fi-filter{flex-direction:column}
}
@media print{
  .fi-no-print{display:none!important}
  .fi-receipt{border:none;padding:20px}
}
</style>`;

  // ── helper: navigation ────────────────────────────────────
  function fiNav(active) {
    const links = [
      ['/fee-installments', 'Dashboard'],
      ['/fee-installments/create', 'New Plan'],
      ['/fee-installments/plans', 'All Plans'],
      ['/fee-installments/overdue', 'Overdue'],
      ['/fee-installments/reports', 'Reports']
    ];
    return '<div class="fi-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ── helper: form field ────────────────────────────────────
  function fiField(label, name, type, val, opts) {
    const req = opts && opts.required ? ' required' : '';
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}"${req}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"
        ${opts && opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '"' : ''}></div>`;
  }

  function fiSelect(label, name, options, val) {
    const opts = options.map(([v, l]) => `<option value="${esc(v)}" ${val === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <select name="${name}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${opts}</select></div>`;
  }

  // ── helper: progress bar ──────────────────────────────────
  function progressBar(paid, total, height) {
    const p = pct(paid, total);
    let color = '#7c3aed';
    if (p >= 100) color = '#16a34a';
    else if (p >= 60) color = '#a78bfa';
    else if (p >= 30) color = '#f59e0b';
    else color = '#dc2626';
    const h = height || 10;
    return `<div class="fi-progress" style="height:${h}px"><div class="fi-progress-bar" style="width:${p}%;background:${color}"></div></div>
      <span style="font-size:11px;color:#64748b;margin-top:2px;display:block">${paid} of ${total} installments (${p}%)</span>`;
  }

  // ── helper: generate receipt number ───────────────────────
  async function generateReceiptNumber(tid) {
    const now = new Date();
    const prefix = `FIR-${tid}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await pool.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(receipt_number, '-', 4) AS INTEGER)), 0) + 1 AS seq
       FROM installment_payments WHERE tenant_id = $1 AND receipt_number LIKE $2`,
      [tid, prefix + '%']
    );
    return `${prefix}-${String(result.rows[0].seq).padStart(4, '0')}`;
  }

  // ── helper: log SMS (idempotent) ──────────────────────────
  async function logSMS(tid, phone, message, type) {
    try {
      await pool.query(
        `INSERT INTO sms_logs (tenant_id, phone_number, message, type, status, created_at)
         VALUES ($1, $2, $3, $4, 'sent', NOW())`,
        [tid, phone, message, type || 'installment_reminder']
      );
    } catch (e) {
      console.log('[FeeInstallments] SMS log skipped (table may not exist):', e.message);
    }
  }

  // ════════════════════════════════════════════════════════════
  // MIGRATIONS
  // ════════════════════════════════════════════════════════════
  const migrations = [
    `CREATE TABLE IF NOT EXISTS installment_plans (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      fee_id INTEGER REFERENCES fees(id) ON DELETE CASCADE,
      total_amount INTEGER NOT NULL,
      number_of_installments INTEGER DEFAULT 3,
      installment_amount INTEGER NOT NULL,
      paid_installments INTEGER DEFAULT 0,
      total_paid INTEGER DEFAULT 0,
      balance INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      start_date DATE DEFAULT CURRENT_DATE,
      end_date DATE,
      guardian_phone VARCHAR(20),
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS installment_payments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      due_date DATE NOT NULL,
      amount INTEGER NOT NULL,
      paid_amount INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'pending',
      payment_method VARCHAR(30),
      payment_ref VARCHAR(100),
      paid_at TIMESTAMPTZ,
      receipt_number VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE fallbacks — installment_plans
    ...[
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS student_id INTEGER`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS fee_id INTEGER`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS total_amount INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS number_of_installments INTEGER DEFAULT 3`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS installment_amount INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS paid_installments INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS total_paid INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS balance INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS end_date DATE`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(20)`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS created_by INTEGER`,
      `ALTER TABLE IF EXISTS installment_plans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      // installment_payments)
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS tenant_id INTEGER`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS plan_id INTEGER`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS installment_number INTEGER DEFAULT 1`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS due_date DATE`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS amount INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS paid_amount INTEGER DEFAULT 0`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30)`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS payment_ref VARCHAR(100)`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50)`,
      `ALTER TABLE IF EXISTS installment_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`
    ],
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_iplans_tenant ON installment_plans(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_iplans_student ON installment_plans(student_id)`,
    `CREATE INDEX IF NOT EXISTS idx_iplans_fee ON installment_plans(fee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_iplans_status ON installment_plans(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_iplans_dates ON installment_plans(tenant_id, start_date, end_date)`,
    `CREATE INDEX IF NOT EXISTS idx_ipayments_tenant ON installment_payments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ipayments_plan ON installment_payments(plan_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ipayments_status ON installment_payments(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ipayments_due ON installment_payments(tenant_id, due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_ipayments_receipt ON installment_payments(receipt_number)`
  ];

  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) return;
    try {
      for (const sql of migrations) await c.query(sql);
      console.log('[FeeInstallments] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) {
      console.error('[FeeInstallments] Migration error:', e.message);
    }
    finally { c.release(); }
  })();

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /fee-installments — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    console.log('[FeeInstallments] Dashboard for tenant:', tid);

    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM installment_plans WHERE tenant_id=$1 AND status='active') as active_plans,
        (SELECT COALESCE(SUM(total_amount),0) FROM installment_plans WHERE tenant_id=$1 AND status IN ('active','completed')) as total_committed,
        (SELECT COALESCE(SUM(total_paid),0) FROM installment_plans WHERE tenant_id=$1) as total_collected,
        (SELECT COUNT(*) FROM installment_payments ip
          JOIN installment_plans p ON p.id = ip.plan_id
          WHERE p.tenant_id=$1 AND ip.status='overdue') as overdue_count,
        (SELECT COALESCE(SUM(ip.amount),0) FROM installment_payments ip
          JOIN installment_plans p ON p.id = ip.plan_id
          WHERE p.tenant_id=$1 AND ip.status='overdue') as overdue_amount
    `, [tid])).rows[0];

    const collectionRate = stats.total_committed > 0
      ? pct(stats.total_collected, stats.total_committed) : 0;

    const recent = (await pool.query(`
      SELECT p.id, p.total_amount, p.paid_installments, p.number_of_installments, p.status,
             p.created_at, s.first_name, s.last_name, c.name as class_name
      FROM installment_plans p
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.tenant_id=$1
      ORDER BY p.created_at DESC LIMIT 10
    `, [tid])).rows;

    const upcoming = (await pool.query(`
      SELECT ip.id, ip.installment_number, ip.due_date, ip.amount, ip.status,
             s.first_name, s.last_name, p.id as plan_id
      FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      LEFT JOIN students s ON s.id = p.student_id
      WHERE p.tenant_id=$1 AND ip.status='pending'
        AND ip.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
      ORDER BY ip.due_date ASC LIMIT 8
    `, [tid])).rows;

    const recentHtml = recent.map(r => {
      const studentName = (r.first_name || '') + ' ' + (r.last_name || '');
      return `<tr>
        <td><a href="/fee-installments/plans/${r.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">#${r.id}</a></td>
        <td>${esc(studentName || 'Unknown')}</td>
        <td>${esc(r.class_name || '\u2014')}</td>
        <td class="right">${fmtMoney(r.total_amount)}</td>
        <td>${progressBar(r.paid_installments, r.number_of_installments, 6)}</td>
        <td>${planBadge(r.status)}</td>
        <td><a href="/fee-installments/plans/${r.id}" class="btn btn-sm" style="background:#7c3aed;color:#fff">View</a></td>
      </tr>`;
    }).join('');

    const upcomingHtml = upcoming.map(r => {
      const studentName = (r.first_name || '') + ' ' + (r.last_name || '');
      const daysLeft = Math.ceil((new Date(r.due_date) - new Date()) / 86400000);
      const daysLabel = daysLeft <= 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : daysLeft + ' days';
      return `<div class="fi-schedule-item">
        <div class="fi-schedule-num pending">${r.installment_number}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px;color:#1e293b">${esc(studentName || 'Unknown')}</div>
          <div style="font-size:12px;color:#64748b">Installment #${r.installment_number} of Plan #${r.plan_id}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;font-size:14px;color:#1e293b">${fmtMoney(r.amount)}</div>
          <div style="font-size:11px;color:#a16207">${daysLabel} &middot; ${fmtDate(r.due_date)}</div>
        </div>
      </div>`;
    }).join('');

    const html = FI_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${fiNav('/fee-installments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">📅 Fee Installments</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage installment payment plans for school fees</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/fee-installments/create" class="btn btn-success">+ New Plan</a>
          <a href="/fee-installments/overdue" class="btn" style="background:#dc2626;color:#fff">⚠ ${stats.overdue_count} Overdue</a>
          <a href="/fee-installments/remind" class="btn" style="background:#7c3aed;color:#fff" title="Send Reminders">📲 Remind</a>
        </div>
      </div>

      <div class="fi-stat-cards">
        <div class="fi-stat-card">
          <div class="num" style="color:#7c3aed">${stats.active_plans}</div>
          <div class="label">Active Plans</div>
        </div>
        <div class="fi-stat-card">
          <div class="num" style="color:#1e293b">${fmtMoney(stats.total_committed)}</div>
          <div class="label">Total Committed</div>
        </div>
        <div class="fi-stat-card">
          <div class="num" style="color:#16a34a">${fmtMoney(stats.total_collected)}</div>
          <div class="label">Total Collected</div>
        </div>
        <div class="fi-stat-card">
          <div class="num" style="color:${collectionRate >= 60 ? '#16a34a' : '#f59e0b'}">${collectionRate}%</div>
          <div class="label">Collection Rate</div>
        </div>
        <div class="fi-stat-card">
          <div class="num" style="color:#dc2626">${stats.overdue_count}</div>
          <div class="label">Overdue Installments</div>
        </div>
        <div class="fi-stat-card">
          <div class="num" style="color:#dc2626">${fmtMoney(stats.overdue_amount)}</div>
          <div class="label">Overdue Amount</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="color:#1e293b;font-size:16px">Recent Plans</h3>
            <a href="/fee-installments/plans" style="font-size:13px;color:#7c3aed;text-decoration:none">View All &rarr;</a>
          </div>
          <div style="overflow-x:auto"><table class="fi-tbl">
            <thead><tr><th>Plan</th><th>Student</th><th>Class</th><th>Total</th><th>Progress</th><th>Status</th><th></th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:40px">No installment plans yet. <a href="/fee-installments/create" style="color:#7c3aed">Create the first plan</a>.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div>
          <div class="card" style="margin-bottom:20px">
            <h3 style="color:#1e293b;font-size:16px;margin-bottom:14px">📅 Upcoming Due</h3>
            ${upcomingHtml || '<p style="text-align:center;color:#94a3b8;padding:20px;font-size:13px">No upcoming installments</p>'}
          </div>
          <div class="card">
            <h3 style="color:#1e293b;font-size:16px;margin-bottom:12px">Quick Actions</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              <a href="/fee-installments/create" class="btn" style="background:#ede9fe;color:#7c3aed;text-align:center;text-decoration:none">+ Create New Plan</a>
              <a href="/fee-installments/overdue" class="btn" style="background:#fee2e2;color:#dc2626;text-align:center;text-decoration:none">⚠ View Overdue</a>
              <a href="/fee-installments/reports" class="btn" style="background:#f1f5f9;color:#475569;text-align:center;text-decoration:none">📊 View Reports</a>
            </div>
          </div>
        </div>
      </div>
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}.btn-success{background:#16a34a;color:#fff}</style>`;
    res.send(renderPage('Fee Installments Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /fee-installments/create — Create Plan Form
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const students = (await pool.query(`
      SELECT s.id, s.first_name, s.last_name, c.name as class_name
      FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.tenant_id=$1 AND s.status='active'
      ORDER BY s.last_name, s.first_name
    `, [tid])).rows;

    const studentOpts = students.map(s =>
      [s.id, `${s.last_name || ''} ${s.first_name || ''} — ${s.class_name || 'No Class'}`]
    );

    // Fetch unpaid fees for the selected student if provided
    const selStudent = req.query.student_id;
    let feeOpts = [];
    if (selStudent) {
      const fees = (await pool.query(`
        SELECT f.id, f.fee_type, f.amount, f.term,
          COALESCE(f.amount - f.paid_amount, f.amount) as balance
        FROM fees f
        WHERE f.student_id=$1 AND f.tenant_id=$2 AND f.balance > 0
        ORDER BY f.term, f.fee_type
      `, [selStudent, tid])).rows;
      feeOpts = fees.map(f =>
        [f.id, `${f.fee_type || 'Fee'} — ${f.term || 'Term'} — ${fmtMoney(f.balance)} balance`]
      );
    }

    const html = FI_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${fiNav('/fee-installments/create')}
      <a href="/fee-installments" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">Create Installment Plan</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Set up a monthly payment plan for a student's fees</p>
        <form method="POST" action="/fee-installments/create" id="planForm">
          <input type="hidden" name="_csrf" value="${esc(req.session.csrfToken || '')}">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Student & Fee</h3>
          <div class="fi-form-grid">
            ${fiSelect('Student *', 'student_id', studentOpts, selStudent)}
            <div id="feeSelectWrapper">${feeOpts.length > 0 ? fiSelect('Fee / Invoice', 'fee_id', feeOpts, '') : '<div style="padding-top:24px"><span style="font-size:13px;color:#94a3b8">Select a student first to see available fees</span></div>'}</div>
          </div>

          <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Plan Details</h3>
          <div class="fi-form-grid">
            ${fiField('Total Amount (UGX) *', 'total_amount', 'number', '', { required: true, placeholder: '1500000' })}
            ${fiSelect('Number of Installments *', 'number_of_installments',
              Array.from({ length: 11 }, (_, i) => [i + 2, `${i + 2} months`]),
              '3')}
            ${fiField('Start Date', 'start_date', 'date', today(), { required: true })}
            ${fiField('Guardian Phone (for SMS)', 'guardian_phone', 'tel', '', { placeholder: '+256 700 000 000' })}
            <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Optional notes about this plan..."></textarea></div>
          </div>

          <div style="padding:16px;background:#ede9fe;border-radius:10px;margin-top:16px">
            <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#475569">
              <span>Installment Amount:</span>
              <span id="calcInstallment" style="font-weight:700;color:#7c3aed">—</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#475569">
              <span>Estimated End Date:</span>
              <span id="calcEndDate" style="font-weight:600">—</span>
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:20px">
            <button type="submit" class="btn" style="padding:12px 28px;background:#7c3aed;color:#fff">Create Plan</button>
            <a href="/fee-installments" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px">Cancel</a>
          </div>
        </form>
      </div>
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}.btn-success{background:#16a34a;color:#fff}</style>
    <script>
      // Recalculate installment amount and end date
      function recalc() {
        const total = parseFloat(document.querySelector('input[name=total_amount]').value) || 0;
        const months = parseInt(document.querySelector('select[name=number_of_installments]').value) || 3;
        const start = document.querySelector('input[name=start_date]').value;
        const perMonth = total > 0 && months > 0 ? Math.round(total / months) : 0;
        document.getElementById('calcInstallment').textContent = perMonth > 0 ? 'UGX ' + perMonth.toLocaleString() + '/month' : '\u2014';
        if (start && perMonth > 0) {
          const d = new Date(start);
          d.setMonth(d.getMonth() + months);
          document.getElementById('calcEndDate').textContent = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        } else {
          document.getElementById('calcEndDate').textContent = '\u2014';
        }
      }
      document.querySelector('input[name=total_amount]').addEventListener('input', recalc);
      document.querySelector('select[name=number_of_installments]').addEventListener('change', recalc);
      document.querySelector('input[name=start_date]').addEventListener('change', recalc);
      // Load fees when student changes
      document.querySelector('select[name=student_id]').addEventListener('change', function() {
        if (this.value) window.location.href = '/fee-installments/create?student_id=' + encodeURIComponent(this.value);
      });
      recalc();
    </script>`;
    res.send(renderPage('Create Installment Plan', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /fee-installments/create — Create Plan
  // ════════════════════════════════════════════════════════════
  app.post('/fee-installments/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, fee_id, total_amount, number_of_installments, start_date, guardian_phone, notes } = req.body;

    if (!student_id || !total_amount || !number_of_installments) {
      return res.send(`<div class="alert alert-danger">Student, total amount, and number of installments are required.</div>
        <a href="/fee-installments/create" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    }

    const totalAmt = parseInt(total_amount) || 0;
    const numInstallments = Math.min(12, Math.max(2, parseInt(number_of_installments) || 3));
    const perInstallment = Math.round(totalAmt / numInstallments);
    // Adjust last installment to handle rounding
    const startDate = start_date || today();

    // Calculate end date
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + numInstallments);

    console.log('[FeeInstallments] Creating plan:', { student_id, totalAmt, numInstallments, startDate });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert the plan
      const planResult = await client.query(
        `INSERT INTO installment_plans
          (tenant_id, student_id, fee_id, total_amount, number_of_installments,
           installment_amount, balance, start_date, end_date, guardian_phone, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [tid, student_id, fee_id || null, totalAmt, numInstallments,
         perInstallment, totalAmt, startDate, endDate.toISOString().split('T')[0],
         (guardian_phone || '').trim() || null, (notes || '').trim() || null, user.id]
      );
      const planId = planResult.rows[0].id;

      // Auto-generate installment payment records
      for (let i = 0; i < numInstallments; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        const amount = (i === numInstallments - 1) ? totalAmt - (perInstallment * (numInstallments - 1)) : perInstallment;

        await client.query(
          `INSERT INTO installment_payments
            (tenant_id, plan_id, installment_number, due_date, amount)
           VALUES ($1,$2,$3,$4,$5)`,
          [tid, planId, i + 1, dueDate.toISOString().split('T')[0], amount]
        );
      }

      await client.query('COMMIT');
      console.log('[FeeInstallments] Plan #' + planId + ' created with ' + numInstallments + ' installments');

      // Send welcome SMS if guardian phone exists
      const phone = (guardian_phone || '').trim();
      if (phone) {
        try {
          const student = (await pool.query('SELECT first_name, last_name FROM students WHERE id=$1', [student_id])).rows[0];
          const studentName = (student?.first_name || '') + ' ' + (student?.last_name || '');
          const msg = `Dear Parent, an installment plan of ${numInstallments} months (${fmtMoney(perInstallment)}/month) has been created for ${studentName.trim()}. First payment due: ${fmtDate(startDate)}. Thank you.`;
          await logSMS(tid, phone, msg, 'plan_created');
        } catch (e) { /* non-critical */ }
      }

      res.redirect('/fee-installments/plans/' + planId);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[FeeInstallments] Create error:', e.message);
      return res.send(`<div class="alert alert-danger">Error creating plan: ${esc(e.message)}</div>
        <a href="/fee-installments/create" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: GET /fee-installments/plans — List All Plans
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/plans', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, class_id, search, page } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limit = 20;
    const offset = (pageNum - 1) * limit;

    let where = ['p.tenant_id=$1'];
    const params = [tid];
    let pi = 2;

    if (status) { where.push(`p.status=$${pi++}`); params.push(status); }
    if (class_id) {
      where.push(`EXISTS (SELECT 1 FROM students s WHERE s.id=p.student_id AND s.class_id=$${pi++})`);
      params.push(class_id);
    }
    if (search) {
      where.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR CAST(p.id AS VARCHAR) ILIKE $${pi})`);
      params.push('%' + search + '%');
      pi++;
    }

    const whereClause = where.join(' AND ');

    const totalResult = await pool.query(`SELECT COUNT(*) FROM installment_plans p LEFT JOIN students s ON s.id=p.student_id WHERE ${whereClause}`, params);
    const totalPages = Math.ceil(parseInt(totalResult.rows[0].count) / limit);

    const plans = (await pool.query(`
      SELECT p.*, s.first_name, s.last_name, s.student_number, c.name as class_name
      FROM installment_plans p
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params)).rows;

    const classes = (await pool.query(
      `SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid]
    )).rows;

    const plansHtml = plans.map(p => {
      const studentName = (p.first_name || '') + ' ' + (p.last_name || '');
      return `<tr>
        <td><a href="/fee-installments/plans/${p.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">#${p.id}</a></td>
        <td>${esc(studentName || 'Unknown')}</td>
        <td>${esc(p.student_number || '\u2014')}</td>
        <td>${esc(p.class_name || '\u2014')}</td>
        <td class="right">${fmtMoney(p.total_amount)}</td>
        <td>${progressBar(p.paid_installments, p.number_of_installments, 6)}</td>
        <td class="right">${fmtMoney(p.balance)}</td>
        <td>${planBadge(p.status)}</td>
        <td>${fmtDate(p.start_date)}</td>
        <td><a href="/fee-installments/plans/${p.id}" class="btn btn-sm" style="background:#7c3aed;color:#fff">View</a></td>
      </tr>`;
    }).join('');

    // Pagination
    let pagination = '';
    if (totalPages > 1) {
      pagination = '<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">';
      if (pageNum > 1) pagination += `<a href="?page=${pageNum - 1}&status=${esc(status || '')}&class_id=${esc(class_id || '')}&search=${esc(search || '')}" style="padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9">&laquo; Prev</a>`;
      for (let i = Math.max(1, pageNum - 2); i <= Math.min(totalPages, pageNum + 2); i++) {
        pagination += i === pageNum
          ? `<span style="padding:8px 14px;border-radius:8px;font-size:13px;background:#7c3aed;color:#fff">${i}</span>`
          : `<a href="?page=${i}&status=${esc(status || '')}&class_id=${esc(class_id || '')}&search=${esc(search || '')}" style="padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9">${i}</a>`;
      }
      if (pageNum < totalPages) pagination += `<a href="?page=${pageNum + 1}&status=${esc(status || '')}&class_id=${esc(class_id || '')}&search=${esc(search || '')}" style="padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9">Next &raquo;</a>`;
      pagination += '</div>';
    }

    const html = FI_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${fiNav('/fee-installments/plans')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">📋 All Installment Plans</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${totalResult.rows[0].count} total plans</p>
        </div>
        <a href="/fee-installments/create" class="btn btn-success">+ New Plan</a>
      </div>

      <div class="fi-filter">
        <div>
          <label>Search</label>
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Name or Plan #">
        </div>
        <div>
          <label>Status</label>
          <select name="status">
            <option value="">All Statuses</option>
            <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
            <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="defaulted" ${status === 'defaulted' ? 'selected' : ''}>Defaulted</option>
            <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
        <div>
          <label>Class</label>
          <select name="class_id">
            <option value="">All Classes</option>
            ${classes.map(c => `<option value="${c.id}" ${class_id === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div style="align-self:end">
          <button type="submit" class="btn" style="background:#7c3aed;color:#fff;padding:9px 20px" onclick="this.closest('form')?.submit() || (window.location.search='?search='+document.querySelector('input[name=search]').value+'&status='+document.querySelector('select[name=status]').value+'&class_id='+document.querySelector('select[name=class_id]').value)">Filter</button>
        </div>
        <div style="align-self:end">
          <a href="/fee-installments/plans" class="btn" style="background:#f1f5f9;color:#64748b;padding:9px 14px;text-decoration:none">Clear</a>
        </div>
      </div>

      <div class="card">
        <div style="overflow-x:auto"><table class="fi-tbl">
          <thead><tr><th>Plan</th><th>Student</th><th>Adm #</th><th>Class</th><th>Total</th><th>Progress</th><th>Balance</th><th>Status</th><th>Start</th><th></th></tr></thead>
          <tbody>${plansHtml || '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:40px">No installment plans found.</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagination}
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}.btn-success{background:#16a34a;color:#fff}</style>`;
    res.send(renderPage('All Installment Plans', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /fee-installments/plans/:id — Plan Details
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/plans/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;

    const plan = (await pool.query(`
      SELECT p.*, s.first_name, s.last_name, s.student_number, s.admission_number,
             c.name as class_name,
             cb.name as creator_name
      FROM installment_plans p
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN users cb ON cb.id = p.created_by
      WHERE p.id=$1 AND p.tenant_id=$2
    `, [id, tid])).rows[0];

    if (!plan) {
      return res.send(`<div class="alert alert-danger">Plan not found.</div>
        <a href="/fee-installments/plans" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back to Plans</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    }

    const payments = (await pool.query(`
      SELECT * FROM installment_payments
      WHERE plan_id=$1 AND tenant_id=$2
      ORDER BY installment_number
    `, [id, tid])).rows;

    const studentName = (plan.first_name || '') + ' ' + (plan.last_name || '');
    const completionPct = pct(plan.paid_installments, plan.number_of_installments);

    // Payment schedule items
    const scheduleHtml = payments.map(p => {
      const isPaid = p.status === 'paid';
      const isOverdue = p.status === 'overdue';
      const isPartial = p.status === 'partially_paid';
      const numClass = isPaid ? 'paid' : isOverdue ? 'overdue' : isPartial ? 'partial' : p.status === 'cancelled' ? 'cancelled' : 'pending';

      let actionHtml = '';
      if (p.status === 'pending' || p.status === 'overdue' || p.status === 'partially_paid') {
        actionHtml = `<a href="/fee-installments/plans/${id}?record_payment=${p.id}" class="btn btn-sm" style="background:#7c3aed;color:#fff">Record Payment</a>`;
      } else if (isPaid && p.receipt_number) {
        actionHtml = `<a href="/fee-installments/receipt/${p.id}" class="btn btn-sm" style="background:#16a34a;color:#fff">Receipt</a>`;
      }

      return `<div class="fi-schedule-item" style="${isPaid ? 'opacity:.85;' : ''}">
        <div class="fi-schedule-num ${numClass}">${p.installment_number}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;color:#1e293b">
            Installment #${p.installment_number}
            ${isPaid ? ' <span style="color:#16a34a">&#10003; Paid</span>' : ''}
          </div>
          <div style="font-size:12px;color:#64748b">
            Due: ${fmtDate(p.due_date)}
            ${p.paid_at ? ' &middot; Paid: ' + fmtDateTime(p.paid_at) : ''}
            ${p.payment_method ? ' &middot; ' + methodIcon(p.payment_method) : ''}
          </div>
          ${p.payment_ref ? '<div style="font-size:11px;color:#94a3b8;font-family:monospace">Ref: ' + esc(p.payment_ref) + '</div>' : ''}
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;font-size:14px;color:#1e293b">${fmtMoney(p.amount)}</div>
          ${isPartial ? `<div style="font-size:12px;color:#2563eb">Paid: ${fmtMoney(p.paid_amount)}</div>` : ''}
          <div style="margin-top:4px">${installmentBadge(p.status)}</div>
        </div>
        <div>${actionHtml}</div>
      </div>`;
    }).join('');

    // Payment recording form (inline)
    let recordForm = '';
    const recordPaymentId = req.query.record_payment;
    if (recordPaymentId) {
      const targetPayment = payments.find(p => p.id === parseInt(recordPaymentId));
      if (targetPayment) {
        const remaining = targetPayment.amount - targetPayment.paid_amount;
        recordForm = `
        <div class="card" style="padding:24px;margin-top:20px;border:2px solid #7c3aed">
          <h3 style="color:#7c3aed;margin-bottom:16px">💰 Record Payment — Installment #${targetPayment.installment_number}</h3>
          <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-bottom:16px;font-size:13px;color:#475569">
            Amount Due: <strong>${fmtMoney(targetPayment.amount)}</strong>
            ${targetPayment.paid_amount > 0 ? ' &middot; Already Paid: <strong style="color:#16a34a">' + fmtMoney(targetPayment.paid_amount) + '</strong> &middot; Remaining: <strong style="color:#7c3aed">' + fmtMoney(remaining) + '</strong>' : ''}
            &middot; Due: ${fmtDate(targetPayment.due_date)}
          </div>
          <form method="POST" action="/fee-installments/plans/${id}/record-payment">
            <input type="hidden" name="payment_id" value="${targetPayment.id}">
            <div class="fi-form-grid">
              ${fiField('Amount (UGX) *', 'paid_amount', 'number', remaining, { required: true, placeholder: String(remaining) })}
              ${fiSelect('Payment Method *', 'payment_method',
                [['cash', '💵 Cash'], ['mtn_momo', '📱 MTN MoMo'], ['airtel_money', '📱 Airtel Money'], ['bank_transfer', '🏦 Bank Transfer']],
                'cash')}
              ${fiField('Payment Reference', 'payment_ref', 'text', '', { placeholder: 'Transaction ID or reference' })}
              <div style="display:flex;align-items:end;gap:8px">
                <button type="submit" class="btn" style="padding:11px 24px;background:#16a34a;color:#fff">Confirm Payment</button>
                <a href="/fee-installments/plans/${id}" class="btn" style="padding:11px 16px;background:#f1f5f9;color:#64748b;text-decoration:none">Cancel</a>
              </div>
            </div>
          </form>
        </div>`;
      }
    }

    const html = FI_CSS + `
    <div style="max-width:1000px;margin:0 auto">
      ${fiNav('/fee-installments/plans')}
      <a href="/fee-installments/plans" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Plans</a>

      <!-- Plan Header -->
      <div class="card" style="padding:24px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <h2 style="color:#1e293b;margin:0">Plan #${plan.id}</h2>
              ${planBadge(plan.status)}
            </div>
            <p style="font-size:14px;color:#475569">
              <strong>${esc(studentName)}</strong>
              ${plan.student_number ? ' &middot; ' + esc(plan.student_number) : ''}
              ${plan.class_name ? ' &middot; <span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:600">' + esc(plan.class_name) + '</span>' : ''}
            </p>
            ${plan.guardian_phone ? '<p style="font-size:12px;color:#94a3b8;margin-top:4px">📲 Guardian: ' + esc(plan.guardian_phone) + '</p>' : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:800;color:#7c3aed">${fmtMoney(plan.total_amount)}</div>
            <div style="font-size:13px;color:#64748b">${plan.number_of_installments} installments &times; ${fmtMoney(plan.installment_amount)}/mo</div>
            ${plan.status === 'active' ? `
            <div style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end">
              <a href="/fee-installments/plans/${id}?record_payment=" class="btn btn-sm" style="background:#16a34a;color:#fff">Record Payment</a>
              <form method="POST" action="/fee-installments/plans/${id}/cancel" style="display:inline">
                <button type="submit" class="btn btn-sm" style="background:#fee2e2;color:#dc2626" onclick="return confirm('Cancel this installment plan? This action cannot be undone.')">Cancel Plan</button>
              </form>
            </div>` : ''}
          </div>
        </div>

        <!-- Progress -->
        <div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:6px">
            <span>Plan Progress</span>
            <span>${plan.paid_installments} of ${plan.number_of_installments} installments paid (${completionPct}%)</span>
          </div>
          ${progressBar(plan.paid_installments, plan.number_of_installments)}
        </div>

        <!-- Summary Grid -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px">
          <div style="padding:12px;background:#ede9fe;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px">Total Amount</div>
            <div style="font-size:16px;font-weight:800;color:#1e293b;margin-top:4px">${fmtMoney(plan.total_amount)}</div>
          </div>
          <div style="padding:12px;background:#dcfce7;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px">Collected</div>
            <div style="font-size:16px;font-weight:800;color:#16a34a;margin-top:4px">${fmtMoney(plan.total_paid)}</div>
          </div>
          <div style="padding:12px;background:#fee2e2;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px">Balance</div>
            <div style="font-size:16px;font-weight:800;color:#dc2626;margin-top:4px">${fmtMoney(plan.balance)}</div>
          </div>
          <div style="padding:12px;background:#f8fafc;border-radius:8px;text-align:center">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.3px">Duration</div>
            <div style="font-size:16px;font-weight:800;color:#1e293b;margin-top:4px">${fmtDate(plan.start_date)}</div>
          </div>
        </div>

        ${plan.notes ? '<div style="margin-top:12px;padding:10px 14px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569"><strong>Notes:</strong> ' + esc(plan.notes) + '</div>' : ''}
        <div style="margin-top:8px;font-size:11px;color:#94a3b8">Created ${fmtDateTime(plan.created_at)} by ${esc(plan.creator_name || 'System')}</div>
      </div>

      <!-- Payment Schedule -->
      <div class="card" style="padding:20px">
        <h3 style="color:#1e293b;margin-bottom:16px">📅 Payment Schedule</h3>
        <div class="fi-timeline">
          ${scheduleHtml || '<p style="text-align:center;color:#94a3b8;padding:20px">No payment schedule</p>'}
        </div>
      </div>

      ${recordForm}
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}.btn-success{background:#16a34a;color:#fff}</style>`;
    res.send(renderPage('Plan #' + id + ' — ' + studentName, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /fee-installments/plans/:id/record-payment
  // ════════════════════════════════════════════════════════════
  app.post('/fee-installments/plans/:id/record-payment', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, planId = req.params.id;
    const { payment_id, paid_amount, payment_method, payment_ref } = req.body;

    const payAmount = parseInt(paid_amount) || 0;
    if (!payment_id || payAmount <= 0) {
      return res.send(`<div class="alert alert-danger">Payment ID and a valid amount are required.</div>
        <a href="/fee-installments/plans/${planId}" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the payment record
      const payment = (await client.query(
        `SELECT ip.*, p.balance as plan_balance, p.total_paid as plan_total_paid,
                p.paid_installments as plan_paid_installments, p.total_amount, p.student_id,
                p.number_of_installments, p.fee_id, p.guardian_phone, p.status as plan_status
         FROM installment_payments ip
         JOIN installment_plans p ON p.id = ip.plan_id
         WHERE ip.id=$1 AND ip.plan_id=$2 AND ip.tenant_id=$3`,
        [payment_id, planId, tid]
      )).rows[0];

      if (!payment) {
        await client.query('ROLLBACK');
        return res.send(`<div class="alert alert-danger">Payment record not found.</div>
          <a href="/fee-installments/plans/${planId}" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
          <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
      }

      if (payment.status === 'paid') {
        await client.query('ROLLBACK');
        return res.send(`<div class="alert alert-warning">This installment is already fully paid.</div>
          <a href="/fee-installments/plans/${planId}" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
          <style>.alert{padding:14px 20px;background:#fef9c3;color:#a16207;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
      }

      const remaining = payment.amount - payment.paid_amount;
      const actualPay = Math.min(payAmount, remaining);
      const newPaidAmount = payment.paid_amount + actualPay;
      const isFullPayment = newPaidAmount >= payment.amount;
      const newStatus = isFullPayment ? 'paid' : 'partially_paid';

      // Generate receipt number
      const receiptNumber = await generateReceiptNumber(tid);

      // Update the installment payment
      await client.query(
        `UPDATE installment_payments SET
          paid_amount = $1,
          status = $2,
          payment_method = $3,
          payment_ref = $4,
          paid_at = CASE WHEN $5 THEN NOW() ELSE paid_at END,
          receipt_number = CASE WHEN $5 THEN $6 ELSE receipt_number END
        WHERE id = $7 AND tenant_id = $8`,
        [newPaidAmount, newStatus, (payment_method || 'cash').trim(), (payment_ref || '').trim() || null,
         isFullPayment, isFullPayment ? receiptNumber : null, payment_id, tid]
      );

      // Update plan totals if this is a full payment or partial
      let newPlanPaid = payment.plan_total_paid + actualPay;
      let newPlanBalance = payment.plan_balance - actualPay;
      let newPaidInstallments = payment.plan_paid_installments;

      if (isFullPayment && payment.status !== 'paid') {
        newPaidInstallments += 1;
      }

      // Determine new plan status
      let newPlanStatus = payment.plan_status;
      if (newPaidInstallments >= payment.number_of_installments && newPlanBalance <= 0) {
        newPlanStatus = 'completed';
        newPlanBalance = 0;
      }

      await client.query(
        `UPDATE installment_plans SET
          total_paid = $1,
          balance = $2,
          paid_installments = $3,
          status = $4
        WHERE id = $5 AND tenant_id = $6`,
        [newPlanPaid, Math.max(0, newPlanBalance), newPaidInstallments, newPlanStatus, planId, tid]
      );

      // Update fees table balance if fee_id exists
      if (payment.fee_id) {
        try {
          await client.query(
            `UPDATE fees SET paid_amount = COALESCE(paid_amount, 0) + $1,
              balance = GREATEST(0, COALESCE(balance, amount) - $1)
             WHERE id = $2 AND tenant_id = $3`,
            [actualPay, payment.fee_id, tid]
          );
        } catch (feeErr) {
          console.log('[FeeInstallments] Fees table update skipped:', feeErr.message);
        }
      }

      await client.query('COMMIT');
      console.log(`[FeeInstallments] Payment recorded: Plan #${planId}, Installment #${payment.installment_number}, ${fmtMoney(actualPay)} (${payment_method})`);

      // Send payment confirmation SMS
      if (payment.guardian_phone) {
        try {
          const student = (await pool.query('SELECT first_name, last_name FROM students WHERE id=$1', [payment.student_id])).rows[0];
          const studentName = ((student?.first_name || '') + ' ' + (student?.last_name || '')).trim();
          const msg = `Payment of ${fmtMoney(actualPay)} received for ${studentName} (Installment #${payment.installment_number}). Receipt: ${receiptNumber || 'N/A'}. Balance: ${fmtMoney(Math.max(0, newPlanBalance))}. Thank you!`;
          await logSMS(tid, payment.guardian_phone, msg, 'payment_confirmation');
        } catch (e) { /* non-critical */ }
      }

      res.redirect('/fee-installments/plans/' + planId);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[FeeInstallments] Record payment error:', e.message);
      return res.send(`<div class="alert alert-danger">Error recording payment: ${esc(e.message)}</div>
        <a href="/fee-installments/plans/${planId}" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    } finally {
      client.release();
    }
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: POST /fee-installments/plans/:id/cancel — Cancel
  // ════════════════════════════════════════════════════════════
  app.post('/fee-installments/plans/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, planId = req.params.id;

    const plan = (await pool.query(
      'SELECT * FROM installment_plans WHERE id=$1 AND tenant_id=$2 AND status IN (\'active\',\'defaulted\')',
      [planId, tid]
    )).rows[0];

    if (!plan) {
      return res.send(`<div class="alert alert-danger">Active plan not found.</div>
        <a href="/fee-installments/plans" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back to Plans</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    }

    await pool.query(
      `UPDATE installment_plans SET status='cancelled' WHERE id=$1 AND tenant_id=$2`,
      [planId, tid]
    );

    // Cancel all pending installments
    await pool.query(
      `UPDATE installment_payments SET status='cancelled'
       WHERE plan_id=$1 AND tenant_id=$2 AND status IN ('pending','overdue')`,
      [planId, tid]
    );

    console.log('[FeeInstallments] Plan #' + planId + ' cancelled by user #' + user.id);

    // Send cancellation SMS if guardian phone exists
    if (plan.guardian_phone) {
      try {
        const student = (await pool.query('SELECT first_name, last_name FROM students WHERE id=$1', [plan.student_id])).rows[0];
        const studentName = ((student?.first_name || '') + ' ' + (student?.last_name || '')).trim();
        const msg = `The installment plan for ${studentName} has been cancelled. Amount already paid: ${fmtMoney(plan.total_paid)}. For inquiries, please contact the school. Thank you.`;
        await logSMS(tid, plan.guardian_phone, msg, 'plan_cancelled');
      } catch (e) { /* non-critical */ }
    }

    res.redirect('/fee-installments/plans/' + planId);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: GET /fee-installments/overdue — Overdue List
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/overdue', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Mark overdue installments (due_date < today AND status = pending)
    await pool.query(`
      UPDATE installment_payments SET status='overdue'
      WHERE status='pending' AND due_date < CURRENT_DATE
        AND plan_id IN (SELECT id FROM installment_plans WHERE tenant_id=$1 AND status='active')
    `, [tid]);

    // Mark defaulted plans (all installments overdue)
    await pool.query(`
      UPDATE installment_plans SET status='defaulted'
      WHERE tenant_id=$1 AND status='active'
        AND id IN (
          SELECT p.id FROM installment_plans p
          WHERE p.tenant_id=$1 AND p.status='active'
            AND NOT EXISTS (
              SELECT 1 FROM installment_payments ip
              WHERE ip.plan_id=p.id AND ip.status IN ('pending','partially_paid','paid')
            )
        )
    `, [tid]);

    const overdue = (await pool.query(`
      SELECT ip.*, p.id as plan_id, p.guardian_phone,
             s.first_name, s.last_name, s.student_number, c.name as class_name
      FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.tenant_id=$1 AND ip.status='overdue'
      ORDER BY ip.due_date ASC
    `, [tid])).rows;

    const totalOverdueAmount = overdue.reduce((s, r) => s + r.amount, 0);

    const overdueHtml = overdue.map(r => {
      const studentName = (r.first_name || '') + ' ' + (r.last_name || '');
      const daysOverdue = Math.ceil((new Date() - new Date(r.due_date)) / 86400000);
      return `<tr>
        <td><a href="/fee-installments/plans/${r.plan_id}" style="color:#7c3aed;text-decoration:none;font-weight:600">#${r.plan_id}</a></td>
        <td>${esc(studentName || 'Unknown')}</td>
        <td>${esc(r.class_name || '\u2014')}</td>
        <td>Installment #${r.installment_number}</td>
        <td class="right" style="font-weight:700;color:#dc2626">${fmtMoney(r.amount)}</td>
        <td>${fmtDate(r.due_date)}</td>
        <td><span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${daysOverdue} days</span></td>
        <td>${esc(r.guardian_phone || '\u2014')}</td>
        <td><a href="/fee-installments/plans/${r.plan_id}?record_payment=${r.id}" class="btn btn-sm" style="background:#16a34a;color:#fff">Record</a></td>
      </tr>`;
    }).join('');

    const html = FI_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${fiNav('/fee-installments/overdue')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#dc2626">⚠ Overdue Installments</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${overdue.length} overdue installments totaling ${fmtMoney(totalOverdueAmount)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <form method="POST" action="/fee-installments/remind" style="display:inline">
            <input type="hidden" name="type" value="overdue">
            <button type="submit" class="btn" style="background:#7c3aed;color:#fff;padding:10px 20px" onclick="return confirm('Send SMS reminders for all overdue installments?')">
              📲 Remind All Overdue
            </button>
          </form>
          <a href="/fee-installments/plans" class="btn" style="background:#f1f5f9;color:#475569;padding:10px 20px;text-decoration:none">All Plans</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        <div class="fi-stat-card" style="border-left:4px solid #dc2626">
          <div class="num" style="color:#dc2626">${overdue.length}</div>
          <div class="label">Overdue Installments</div>
        </div>
        <div class="fi-stat-card" style="border-left:4px solid #f59e0b">
          <div class="num" style="color:#f59e0b">${fmtMoney(totalOverdueAmount)}</div>
          <div class="label">Total Overdue Amount</div>
        </div>
        <div class="fi-stat-card" style="border-left:4px solid #7c3aed">
          <div class="num" style="color:#7c3aed">${overdue.filter(r => r.guardian_phone).length}</div>
          <div class="label">With Phone (SMS Ready)</div>
        </div>
      </div>

      <div class="card">
        <div style="overflow-x:auto"><table class="fi-tbl">
          <thead><tr><th>Plan</th><th>Student</th><th>Class</th><th>Installment</th><th>Amount</th><th>Due Date</th><th>Days Overdue</th><th>Phone</th><th></th></tr></thead>
          <tbody>${overdueHtml || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">🎉 No overdue installments!</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}</style>`;
    res.send(renderPage('Overdue Installments', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /fee-installments/remind — SMS Reminders
  // ════════════════════════════════════════════════════════════
  app.post('/fee-installments/remind', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { type, plan_ids } = req.body;

    console.log('[FeeInstallments] Sending reminders, type:', type);

    let targets = [];

    if (type === 'overdue') {
      // Remind all overdue installments
      targets = (await pool.query(`
        SELECT ip.id, ip.installment_number, ip.due_date, ip.amount, p.id as plan_id,
               p.guardian_phone, s.first_name, s.last_name
        FROM installment_payments ip
        JOIN installment_plans p ON p.id = ip.plan_id
        LEFT JOIN students s ON s.id = p.student_id
        WHERE p.tenant_id=$1 AND ip.status='overdue' AND p.guardian_phone IS NOT NULL AND p.guardian_phone != ''
      `, [tid])).rows;
    } else if (type === 'upcoming') {
      // Remind upcoming (next 7 days)
      targets = (await pool.query(`
        SELECT ip.id, ip.installment_number, ip.due_date, ip.amount, p.id as plan_id,
               p.guardian_phone, s.first_name, s.last_name
        FROM installment_payments ip
        JOIN installment_plans p ON p.id = ip.plan_id
        LEFT JOIN students s ON s.id = p.student_id
        WHERE p.tenant_id=$1 AND ip.status='pending'
          AND ip.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND p.guardian_phone IS NOT NULL AND p.guardian_phone != ''
      `, [tid])).rows;
    } else if (plan_ids) {
      // Remind specific plans
      const ids = Array.isArray(plan_ids) ? plan_ids : [plan_ids];
      const placeholders = ids.map((_, i) => '$' + (i + 2)).join(',');
      targets = (await pool.query(`
        SELECT ip.id, ip.installment_number, ip.due_date, ip.amount, p.id as plan_id,
               p.guardian_phone, s.first_name, s.last_name
        FROM installment_payments ip
        JOIN installment_plans p ON p.id = ip.plan_id
        LEFT JOIN students s ON s.id = p.student_id
        WHERE p.tenant_id=$1 AND ip.status IN ('pending','overdue')
          AND p.id IN (${placeholders})
          AND p.guardian_phone IS NOT NULL AND p.guardian_phone != ''
      `, [tid, ...ids])).rows;
    }

    let sent = 0, skipped = 0;
    for (const t of targets) {
      const studentName = ((t.first_name || '') + ' ' + (t.last_name || '')).trim();
      const isOverdue = new Date(t.due_date) < new Date();
      const msg = isOverdue
        ? `Reminder: Payment of ${fmtMoney(t.amount)} for ${studentName} (Installment #${t.installment_number}) was due on ${fmtDate(t.due_date)} and is now overdue. Please make payment urgently. Thank you.`
        : `Reminder: Payment of ${fmtMoney(t.amount)} for ${studentName} (Installment #${t.installment_number}) is due on ${fmtDate(t.due_date)}. Please make payment before the due date. Thank you.`;

      try {
        await logSMS(tid, t.guardian_phone, msg, 'installment_reminder');
        sent++;
      } catch (e) {
        skipped++;
      }
    }

    console.log(`[FeeInstallments] Reminders sent: ${sent}, skipped: ${skipped}`);

    res.send(`
    <div style="max-width:500px;margin:80px auto;text-align:center">
      <div style="font-size:64px;margin-bottom:16px">${sent > 0 ? '📲' : '⚠️'}</div>
      <h2 style="color:#1e293b;margin-bottom:8px">SMS Reminders ${sent > 0 ? 'Sent' : 'Failed'}</h2>
      <div style="padding:20px;background:#f8fafc;border-radius:12px;margin:20px 0;font-size:14px;color:#475569">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0">
          <span>Sent Successfully</span>
          <strong style="color:#16a34a">${sent}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0">
          <span>Skipped (no phone)</span>
          <strong style="color:#94a3b8">${skipped}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0">
          <span>Type</span>
          <strong>${esc(type || 'selected')}</strong>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <a href="/fee-installments" class="btn" style="padding:12px 28px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600">Dashboard</a>
        <a href="/fee-installments/overdue" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;font-weight:600">View Overdue</a>
      </div>
    </div>
    <style>.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}</style>`);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /fee-installments/reports — Reports
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Monthly collection for last 6 months
    const monthlyCollection = (await pool.query(`
      SELECT
        TO_CHAR(ip.paid_at, 'YYYY-MM') as month,
        COUNT(*) as payment_count,
        SUM(ip.paid_amount) as total_collected
      FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      WHERE p.tenant_id=$1 AND ip.status='paid' AND ip.paid_at >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY TO_CHAR(ip.paid_at, 'YYYY-MM')
      ORDER BY month DESC
    `, [tid])).rows;

    // Collection by class
    const classBreakdown = (await pool.query(`
      SELECT c.name as class_name,
        COUNT(DISTINCT p.id) as plan_count,
        SUM(p.total_amount) as total_committed,
        SUM(p.total_paid) as total_collected,
        ROUND(SUM(p.total_paid)::numeric / NULLIF(SUM(p.total_amount), 0) * 100, 1) as collection_rate
      FROM installment_plans p
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE p.tenant_id=$1
      GROUP BY c.name
      ORDER BY total_collected DESC NULLS LAST
    `, [tid])).rows;

    // Default rate (plans where no payment was made on time)
    const defaultStats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status='defaulted') as defaulted_count,
        COUNT(*) FILTER (WHERE p.status='active') as active_count,
        COUNT(*) FILTER (WHERE p.status='completed') as completed_count,
        COUNT(*) FILTER (WHERE p.status='cancelled') as cancelled_count,
        COUNT(*) as total_plans,
        ROUND(COUNT(*) FILTER (WHERE p.status='defaulted')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as default_rate
      FROM installment_plans p
      WHERE p.tenant_id=$1
    `, [tid])).rows[0];

    // Payment method breakdown
    const methodBreakdown = (await pool.query(`
      SELECT payment_method,
        COUNT(*) as count,
        SUM(paid_amount) as total
      FROM installment_payments
      WHERE tenant_id=$1 AND status='paid' AND payment_method IS NOT NULL
      GROUP BY payment_method
      ORDER BY total DESC
    `, [tid])).rows;

    // Build chart bar for monthly collection
    const maxCollection = Math.max(...monthlyCollection.map(r => parseInt(r.total_collected || 0)), 1);
    const chartBars = monthlyCollection.reverse().map(r => {
      const h = Math.max(4, (parseInt(r.total_collected || 0) / maxCollection) * 160);
      const monthLabel = new Date(r.month + '-01').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      return `<div class="fi-chart-col" style="height:${h}px;background:#7c3aed">
        <div class="fi-chart-val">${fmtMoney(r.total_collected)}</div>
        <div class="fi-chart-label">${monthLabel}</div>
      </div>`;
    }).join('');

    const classRows = classBreakdown.map(r => `<tr>
      <td style="font-weight:600">${esc(r.class_name || 'Unassigned')}</td>
      <td>${r.plan_count}</td>
      <td class="right">${fmtMoney(r.total_committed)}</td>
      <td class="right" style="color:#16a34a;font-weight:600">${fmtMoney(r.total_collected)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:8px;background:#f1f5f9;border-radius:8px;overflow:hidden">
            <div style="height:100%;width:${Math.min(100, parseFloat(r.collection_rate || 0))}%;background:${parseFloat(r.collection_rate || 0) >= 60 ? '#16a34a' : '#f59e0b'};border-radius:8px"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:#475569">${r.collection_rate || 0}%</span>
        </div>
      </td>
    </tr>`).join('');

    const methodRows = methodBreakdown.map(r => `<tr>
      <td>${methodIcon(r.payment_method)}</td>
      <td style="font-weight:600">${r.count}</td>
      <td class="right" style="font-weight:700">${fmtMoney(r.total)}</td>
    </tr>`).join('');

    const html = FI_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${fiNav('/fee-installments/reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">📊 Installment Reports</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Analytics and insights for fee installment plans</p>
        </div>
      </div>

      <!-- Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
        <div class="fi-stat-card" style="border-left:4px solid #7c3aed">
          <div class="num" style="color:#7c3aed">${defaultStats.total_plans}</div>
          <div class="label">Total Plans</div>
        </div>
        <div class="fi-stat-card" style="border-left:4px solid #16a34a">
          <div class="num" style="color:#16a34a">${defaultStats.completed_count}</div>
          <div class="label">Completed</div>
        </div>
        <div class="fi-stat-card" style="border-left:4px solid #f59e0b">
          <div class="num" style="color:#f59e0b">${defaultStats.active_count}</div>
          <div class="label">Active</div>
        </div>
        <div class="fi-stat-card" style="border-left:4px solid #dc2626">
          <div class="num" style="color:#dc2626">${defaultStats.defaulted_count} (${defaultStats.default_rate || 0}%)</div>
          <div class="label">Defaulted (Rate)</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <!-- Monthly Collection Chart -->
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:16px">Monthly Collection (Last 6 Months)</h3>
          ${monthlyCollection.length > 0 ? `
          <div class="fi-chart-bar" style="margin-bottom:30px">
            ${chartBars}
          </div>` : '<p style="text-align:center;color:#94a3b8;padding:40px;font-size:13px">No collection data yet</p>'}
        </div>

        <!-- Payment Method Breakdown -->
        <div class="card">
          <h3 style="color:#1e293b;margin-bottom:16px">Payment Methods</h3>
          <table class="fi-tbl">
            <thead><tr><th>Method</th><th>Count</th><th>Total</th></tr></thead>
            <tbody>${methodRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:30px">No payments recorded yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <!-- Class Breakdown -->
      <div class="card">
        <h3 style="color:#1e293b;margin-bottom:16px">Collection by Class</h3>
        <div style="overflow-x:auto">
          <table class="fi-tbl">
            <thead><tr><th>Class</th><th>Plans</th><th>Committed</th><th>Collected</th><th>Rate</th></tr></thead>
            <tbody>${classRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">No data available</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}</style>`;
    res.send(renderPage('Installment Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: GET /fee-installments/receipt/:payment_id
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/receipt/:payment_id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, paymentId = req.params.payment_id;

    const payment = (await pool.query(`
      SELECT ip.*, p.id as plan_id, p.total_amount, p.number_of_installments, p.start_date,
             p.guardian_phone, p.notes as plan_notes,
             s.first_name, s.last_name, s.student_number, s.admission_number,
             c.name as class_name, t.name as tenant_name
      FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      LEFT JOIN students s ON s.id = p.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN tenants t ON t.id = p.tenant_id
      WHERE ip.id=$1 AND ip.tenant_id=$2 AND ip.status='paid'
    `, [paymentId, tid])).rows[0];

    if (!payment) {
      return res.send(`<div class="alert alert-danger">Receipt not found. Payment may not be recorded yet.</div>
        <a href="/fee-installments" class="btn" style="padding:10px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Back to Dashboard</a>
        <style>.alert{padding:14px 20px;background:#fee2e2;color:#dc2626;border-radius:10px;margin-bottom:16px;font-size:14px}</style>`);
    }

    const studentName = ((payment.first_name || '') + ' ' + (payment.last_name || '')).trim();
    const tenantName = payment.tenant_name || 'School';

    // Get all installment payments for this plan for context
    const allPayments = (await pool.query(`
      SELECT installment_number, amount, paid_amount, status, paid_at
      FROM installment_payments
      WHERE plan_id=$1 AND tenant_id=$2
      ORDER BY installment_number
    `, [payment.plan_id, tid])).rows;

    const paymentsRows = allPayments.map(p => `<tr>
      <td style="text-align:center">${p.installment_number}</td>
      <td style="text-align:right">${fmtMoney(p.amount)}</td>
      <td style="text-align:right">${p.status === 'paid' ? fmtMoney(p.paid_amount) : '\u2014'}</td>
      <td>${installmentBadge(p.status)}</td>
    </tr>`).join('');

    const totalPaid = allPayments.reduce((s, p) => s + p.paid_amount, 0);

    const html = FI_CSS + `
    <div class="fi-no-print" style="max-width:700px;margin:0 auto 20px;text-align:center">
      <a href="/fee-installments/plans/${payment.plan_id}" style="color:#64748b;font-size:14px;text-decoration:none">&larr; Back to Plan</a>
      <div style="margin-top:12px">
        <button onclick="window.print()" class="btn" style="padding:10px 24px;background:#7c3aed;color:#fff;font-size:14px">🖨 Print Receipt</button>
      </div>
    </div>

    <div class="fi-receipt">
      <div class="fi-receipt-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h2 style="margin:0;font-size:20px">${esc(tenantName)}</h2>
            <p style="margin:4px 0 0;font-size:13px;opacity:.85">Fee Installment Payment Receipt</p>
          </div>
          <div style="text-align:right">
            <div style="font-size:14px;opacity:.85">Receipt #</div>
            <div style="font-size:18px;font-weight:800;font-family:monospace">${esc(payment.receipt_number || 'N/A')}</div>
          </div>
        </div>
      </div>

      <div class="fi-receipt-body">
        <!-- Student Info -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Student</div>
            <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(studentName || 'Unknown')}</div>
            <div style="font-size:12px;color:#64748b">${esc(payment.student_number || payment.admission_number || '')}</div>
            <div style="font-size:12px;color:#64748b">${esc(payment.class_name || '')}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Payment Details</div>
            <div style="font-size:13px;color:#475569">Installment #${payment.installment_number} of ${payment.number_of_installments}</div>
            <div style="font-size:13px;color:#475569">Paid: ${fmtDateTime(payment.paid_at)}</div>
            <div style="font-size:13px;color:#475569">Method: ${methodIcon(payment.payment_method)}</div>
            ${payment.payment_ref ? '<div style="font-size:12px;color:#94a3b8;font-family:monospace">Ref: ' + esc(payment.payment_ref) + '</div>' : ''}
          </div>
        </div>

        <!-- Payment Schedule Table -->
        <table>
          <thead>
            <tr><th style="text-align:center">#</th><th style="text-align:right">Amount</th><th style="text-align:right">Paid</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${paymentsRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="font-weight:700;padding:10px 14px;text-align:right">Plan Total:</td>
              <td style="text-align:right;font-weight:700;padding:10px 14px">${fmtMoney(payment.total_amount)}</td>
              <td></td>
            </tr>
            <tr>
              <td colspan="2" style="font-weight:700;padding:10px 14px;text-align:right;color:#16a34a">Total Collected:</td>
              <td style="text-align:right;font-weight:800;padding:10px 14px;color:#16a34a">${fmtMoney(totalPaid)}</td>
              <td></td>
            </tr>
            <tr>
              <td colspan="2" style="font-weight:700;padding:10px 14px;text-align:right;color:#dc2626">Balance Remaining:</td>
              <td style="text-align:right;font-weight:800;padding:10px 14px;color:#dc2626">${fmtMoney(payment.total_amount - totalPaid)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <!-- Amount Paid (This Receipt) -->
        <div style="margin-top:20px;padding:16px;background:#ede9fe;border-radius:10px;text-align:center">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Amount Paid (This Installment)</div>
          <div style="font-size:32px;font-weight:900;color:#7c3aed;margin-top:4px">${fmtMoney(payment.paid_amount)}</div>
        </div>

        <!-- Footer -->
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8">
          <p>This receipt serves as proof of payment for installment #${payment.installment_number} under Plan #${payment.plan_id}.</p>
          <p>Generated on ${fmtDateTime(new Date())}</p>
          ${payment.guardian_phone ? '<p>Guardian Phone: ' + esc(payment.guardian_phone) + '</p>' : ''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Receipt — ' + (payment.receipt_number || 'Payment'), html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // POST /fee-installments/remind page (GET handler for remind UI)
  // ════════════════════════════════════════════════════════════
  app.get('/fee-installments/remind', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const overdueCount = (await pool.query(`
      SELECT COUNT(*) as cnt FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      WHERE p.tenant_id=$1 AND ip.status='overdue' AND p.guardian_phone IS NOT NULL AND p.guardian_phone != ''
    `, [tid])).rows[0].cnt;

    const upcomingCount = (await pool.query(`
      SELECT COUNT(*) as cnt FROM installment_payments ip
      JOIN installment_plans p ON p.id = ip.plan_id
      WHERE p.tenant_id=$1 AND ip.status='pending'
        AND ip.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND p.guardian_phone IS NOT NULL AND p.guardian_phone != ''
    `, [tid])).rows[0].cnt;

    const html = FI_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${fiNav('/fee-installments')}
      <a href="/fee-installments" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Dashboard</a>
      <div class="card" style="padding:32px;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">📲</div>
        <h2 style="color:#1e293b;margin-bottom:8px">Send SMS Reminders</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Send SMS reminders to guardians with upcoming or overdue installment payments</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
          <div style="padding:20px;border:2px solid #fee2e2;border-radius:12px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#dc2626">${overdueCount}</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:12px">Overdue (with phone)</div>
            <form method="POST" action="/fee-installments/remind">
              <input type="hidden" name="type" value="overdue">
              <button type="submit" class="btn" style="padding:10px 20px;background:#dc2626;color:#fff;width:100%" ${overdueCount == 0 ? 'disabled style="padding:10px 20px;background:#e2e8f0;color:#94a3b8;width:100%;cursor:not-allowed"' : ''}>
                Send Overdue Reminders
              </button>
            </form>
          </div>
          <div style="padding:20px;border:2px solid #fef9c3;border-radius:12px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#a16207">${upcomingCount}</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:12px">Due Within 7 Days</div>
            <form method="POST" action="/fee-installments/remind">
              <input type="hidden" name="type" value="upcoming">
              <button type="submit" class="btn" style="padding:10px 20px;background:#f59e0b;color:#fff;width:100%" ${upcomingCount == 0 ? 'disabled style="padding:10px 20px;background:#e2e8f0;color:#94a3b8;width:100%;cursor:not-allowed"' : ''}>
                Send Upcoming Reminders
              </button>
            </form>
          </div>
        </div>

        <div style="padding:16px;background:#f8fafc;border-radius:10px;font-size:12px;color:#64748b;text-align:left">
          <strong>ℹ Note:</strong> SMS reminders are logged in the system. The actual SMS delivery depends on your SMS gateway configuration. Only guardians with valid phone numbers will receive reminders.
        </div>
      </div>
    </div>
    <style>.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}.btn:hover{opacity:.9}.btn-sm{padding:5px 12px;font-size:12px}.btn-success{background:#16a34a;color:#fff}</style>`;
    res.send(renderPage('Send SMS Reminders', html, user, req));
  }));

  console.log('[FeeInstallments] Module loaded with 11 routes');
};
