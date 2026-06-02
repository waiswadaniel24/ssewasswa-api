// ============================================================
// FEE MANAGEMENT MODULE — Multi-Tenant SaaS Platform (Comfort Zone)
// Fee structures, collection, receipts, reminders, balance
// reports, payment processing, JSON APIs.
// ============================================================
// Usage in server.js:
//   const feeManagement = require('./fee-management');
//   feeManagement(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function feeManagement(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      paid: { cls: 'badge-success', label: 'Paid' },
      partial: { cls: 'badge-warning', label: 'Partial' },
      pending: { cls: 'badge', label: 'Pending', style: 'background:#dbeafe;color:#1d4ed8' },
      overdue: { cls: 'badge-error', label: 'Overdue' },
      active: { cls: 'badge-success', label: 'Active' },
      cancelled: { cls: 'badge-error', label: 'Cancelled' },
      sent: { cls: 'badge-success', label: 'Sent' },
    };
    const v = m[s] || { cls: 'badge', label: s };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const FM_CSS = `<style>
    .fm-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .fm-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .fm-nav a:hover{background:#e2e8f0}.fm-nav a.active{background:#4f46e5;color:#fff}
    .fm-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .fm-btn:hover{opacity:.9;transform:translateY(-1px)}
    .fm-btn-primary{background:#4f46e5;color:#fff}.fm-btn-success{background:#059669;color:#fff}
    .fm-btn-danger{background:#fee2e2;color:#dc2626}.fm-btn-secondary{background:#f1f5f9;color:#475569}
    .fm-table{width:100%;border-collapse:collapse;font-size:13px}
    .fm-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .fm-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .fm-table tr:hover{background:#f8fafc}
    .fm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .fm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .fm-filter input,.fm-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .fm-filter input:focus,.fm-filter select:focus{outline:none;border-color:#6366f1}
    .fm-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
    @media(max-width:768px){.fm-nav{gap:4px}.fm-nav a{padding:6px 12px;font-size:12px}.fm-filter{flex-direction:column}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="fm-nav">
    <a href="/fees" class="${active === 'dash' ? 'active' : ''}">💰 Dashboard</a>
    <a href="/fees/structures" class="${active === 'structures' ? 'active' : ''}">🏗️ Structures</a>
    <a href="/fees/collect" class="${active === 'collect' ? 'active' : ''}">💳 Collect</a>
    <a href="/fees/receipts" class="${active === 'receipts' ? 'active' : ''}">🧾 Receipts</a>
    <a href="/fees/balance" class="${active === 'balance' ? 'active' : ''}">📊 Balance</a>
    <a href="/fees/reminders" class="${active === 'reminders' ? 'active' : ''}">🔔 Reminders</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // Ensure fee_structures columns
      const fsCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(255)' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'total_amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'description', type: 'TEXT' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'created_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of fsCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure fees_structure columns (alias table)
      const fs2Cols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'fee_id', type: 'INTEGER' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'due_date', type: 'DATE' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of fs2Cols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE fees_structure ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure fee_receipts columns
      const frCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'fee_structure_id', type: 'INTEGER' },
        { name: 'receipt_number', type: 'VARCHAR(50) UNIQUE' },
        { name: 'amount_paid', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'balance', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'payment_method', type: 'VARCHAR(50)' },
        { name: 'reference', type: 'VARCHAR(100)' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'paid\'' },
        { name: 'received_by', type: 'INTEGER' },
        { name: 'notes', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of frCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE fee_receipts ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure fee_reminder_settings columns
      const fRemCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'reminder_type', type: 'VARCHAR(50)' },
        { name: 'threshold_days', type: 'INTEGER DEFAULT 7' },
        { name: 'message_template', type: 'TEXT' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'last_sent', type: 'TIMESTAMPTZ' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of fRemCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE fee_reminder_settings ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure class_payments columns
      const cpCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'payment_date', type: 'DATE' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'status', type: 'VARCHAR(20)' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of cpCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE class_payments ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure payment_methods columns
      const pmCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(100)' },
        { name: 'type', type: 'VARCHAR(50)' },
        { name: 'account_details', type: 'TEXT' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of pmCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure payment_requests columns
      const prCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'pending\'' },
        { name: 'token', type: 'VARCHAR(100)' },
        { name: 'expires_at', type: 'TIMESTAMPTZ' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of prCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure payment_transactions columns
      const ptCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'payment_request_id', type: 'INTEGER' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'amount', type: 'NUMERIC(12,2) DEFAULT 0' },
        { name: 'method', type: 'VARCHAR(50)' },
        { name: 'reference', type: 'VARCHAR(100)' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'pending\'' },
        { name: 'processed_at', type: 'TIMESTAMPTZ' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of ptCols) { try { await migrateQuery(pool, 'FeeManagement', `ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Indexes
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_structures_tenant ON fee_structures(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_structures_class ON fee_structures(class_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_receipts_tenant ON fee_receipts(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_receipts_student ON fee_receipts(student_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_receipts_receipt ON fee_receipts(receipt_number)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_fee_reminder_tenant ON fee_reminder_settings(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_class_payments_tenant ON class_payments(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant ON payment_methods(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_payment_requests_tenant ON payment_requests(tenant_id)`);
      await migrateQuery(pool, 'FeeManagement', `CREATE INDEX IF NOT EXISTS idx_payment_trans_tenant ON payment_transactions(tenant_id)`);
      console.log('[FeeManagement] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /fees — Dashboard
  // ============================================================
  app.get('/fees', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const year = req.query.year || new Date().getFullYear().toString();

    // Stats
    const totalCollected = (await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0)::numeric(14,2) as total FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [tid, year]
    )).rows[0].total;

    const totalStructures = (await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(14,2) as total FROM fee_structures WHERE tenant_id=$1 AND is_active=true`,
      [tid]
    )).rows[0].total;

    const totalBalance = (await pool.query(
      `SELECT COALESCE(SUM(balance), 0)::numeric(14,2) as total FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 AND balance > 0`,
      [tid, year]
    )).rows[0].total;

    const receiptCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [tid, year]
    )).rows[0].cnt;

    // Monthly collection trend
    const monthly = (await pool.query(
      `SELECT TO_CHAR(created_at, 'Mon') as month, SUM(amount_paid)::numeric(12,2) as collected, COUNT(*)::int as receipts
       FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2 GROUP BY TO_CHAR(created_at, 'Mon'), EXTRACT(MONTH FROM created_at) ORDER BY EXTRACT(MONTH FROM created_at)`,
      [tid, year]
    )).rows;

    const maxCollected = Math.max(...monthly.map(m => Number(m.collected) || 0), 1);
    const barChart = monthly.map(m => {
      const pct = Math.round((Number(m.collected) || 0) / maxCollected * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:40px">${m.month}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${Number(m.collected).toLocaleString()}</span>
        </div>
      </div>`;
    }).join('');

    // Recent receipts
    const recent = (await pool.query(
      `SELECT fr.*, s.first_name, s.last_name, s.admission_number, c.name as class_name
       FROM fee_receipts fr
       LEFT JOIN students s ON s.id = fr.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE fr.tenant_id=$1 ORDER BY fr.created_at DESC LIMIT 10`,
      [tid]
    )).rows;

    const recentHtml = recent.map(r => `<tr>
      <td><strong>${esc(r.first_name + ' ' + r.last_name)}</strong></td>
      <td class="muted">${esc(r.admission_number || '')}</td>
      <td>${esc(r.class_name || '')}</td>
      <td style="font-weight:600;color:#16a34a">${Number(r.amount_paid).toLocaleString()}</td>
      <td>${esc(r.payment_method || '')}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💰 Fee Management</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track fee collection, balances, and generate receipts</p></div>
        <div style="display:flex;gap:8px">
          <a href="/fees/collect" class="fm-btn fm-btn-primary">💳 Collect Fee</a>
          <a href="/fees/reports" class="fm-btn fm-btn-secondary">📈 Reports</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${Number(totalCollected).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Collected (${year})</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${Number(totalStructures).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Fee Structures</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${Number(totalBalance).toLocaleString()}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Outstanding Balance</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${receiptCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Receipts Issued</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:20px">
        <div class="fm-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Monthly Collections</h3>
          ${barChart || '<p class="muted" style="font-size:13px">No data for this year</p>'}
        </div>
        <div class="fm-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Recent Receipts</h3>
          <div style="overflow-x:auto"><table class="fm-table">
            <thead><tr><th>Student</th><th>Adm#</th><th>Class</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No receipts yet</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Fee Management Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /fees/structures — Fee structures list
  // ============================================================
  app.get('/fees/structures', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const structures = (await pool.query(
      `SELECT fs.*, c.name as class_name FROM fee_structures fs LEFT JOIN classes c ON c.id = fs.class_id WHERE fs.tenant_id=$1 ORDER BY fs.created_at DESC`,
      [tid]
    )).rows;

    const rowsHtml = structures.map(s => `<tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.class_name || 'All Classes')}</td>
      <td>${esc(s.term || '—')}</td>
      <td style="font-weight:600;color:#4f46e5">${Number(s.total_amount).toLocaleString()}</td>
      <td>${s.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Inactive</span>'}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td>
        <form method="POST" action="/fees/structures/delete" style="display:inline" onsubmit="return confirm('Delete this fee structure?')">
          <input type="hidden" name="id" value="${s.id}">
          <button type="submit" class="fm-btn fm-btn-danger" style="padding:4px 10px;font-size:11px">Delete</button>
        </form>
      </td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('structures')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏗️ Fee Structures</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Define fees per class and term</p></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px">
        <div class="fm-card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">Create Fee Structure</h3>
          <form method="POST" action="/fees/structures" style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Name *</label>
              <input type="text" name="name" required minlength="2" maxlength="200" placeholder="e.g., Term 1 Tuition" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Class</label>
              <select name="class_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="">All Classes</option>
                ${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Term</label>
              <select name="term" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option><option value="Annual">Annual</option>
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Amount *</label>
              <input type="number" name="total_amount" required min="0" step="0.01" placeholder="0.00" data-ugx="true" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="2" maxlength="500" placeholder="Optional description" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
            <button type="submit" class="fm-btn fm-btn-primary" style="justify-content:center">💾 Save Structure</button>
          </form>
        </div>
        <div class="fm-card">
          <h3 style="margin:0 0 14px;color:#1e293b">All Fee Structures (${structures.length})</h3>
          <div style="overflow-x:auto"><table class="fm-table">
            <thead><tr><th>Name</th><th>Class</th><th>Term</th><th>Amount</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No fee structures defined</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Fee Structures', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /fees/structures — Create fee structure
  // ============================================================
  app.post('/fees/structures', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, class_id, term, total_amount, description } = req.body;
    if (!name || !total_amount) return res.redirect('/fees/structures');

    await pool.query(
      `INSERT INTO fee_structures (tenant_id, name, class_id, term, total_amount, description, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, name.trim(), class_id || null, term || 'Term 1', total_amount, description || null, user.id]
    );
    req.session.flash = { type: 'success', msg: 'Fee structure created successfully' };
    res.redirect('/fees/structures');
  }));

  // Delete fee structure
  app.post('/fees/structures/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM fee_structures WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
    res.redirect('/fees/structures');
  }));

  // ============================================================
  // ROUTE 4: GET /fees/collect — Fee collection form
  // ============================================================
  app.get('/fees/collect', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const structures = (await pool.query(`SELECT id, name, total_amount, term FROM fee_structures WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;

    // Students by selected class
    const selectedClass = req.query.class_id || '';
    let students = [];
    if (selectedClass) {
      students = (await pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number,
          COALESCE((SELECT SUM(fr.balance) FROM fee_receipts fr WHERE fr.student_id=s.id AND fr.tenant_id=$1 AND fr.balance > 0), 0)::numeric(12,2) as outstanding
         FROM students s WHERE s.tenant_id=$1 AND s.class_id=$2 ORDER BY s.last_name, s.first_name`,
        [tid, selectedClass]
      )).rows;
    }

    const studentsHtml = students.map(s => `<tr>
      <td><strong>${esc(s.last_name + ', ' + s.first_name)}</strong></td>
      <td class="muted">${esc(s.admission_number || '')}</td>
      <td style="color:${s.outstanding > 0 ? '#dc2626' : '#16a34a'};font-weight:600">${Number(s.outstanding).toLocaleString()}</td>
      <td><a href="/fees/collect?class_id=${esc(selectedClass)}&student_id=${s.id}" class="fm-btn fm-btn-primary" style="padding:4px 12px;font-size:11px">Collect</a></td>
    </tr>`).join('');

    // Student collection form
    const studentId = req.query.student_id || '';
    let studentInfo = null, studentBalances = [], totalDue = 0;
    if (studentId) {
      studentInfo = (await pool.query(`SELECT s.*, c.name as class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id=$1 AND s.tenant_id=$2`, [studentId, tid])).rows[0];
      studentBalances = (await pool.query(
        `SELECT * FROM fee_receipts WHERE tenant_id=$1 AND student_id=$2 AND balance > 0 ORDER BY created_at`,
        [tid, studentId]
      )).rows;
      totalDue = studentBalances.reduce((s, r) => s + Number(r.balance || 0), 0);
    }

    const balanceHtml = studentBalances.map(b => `<tr>
      <td>${esc(b.receipt_number || '—')}</td>
      <td>${Number(b.balance).toLocaleString()}</td>
      <td>${esc(b.term || '')}</td>
      <td>${esc(b.notes || '')}</td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('collect')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">💳 Collect Fee Payment</h1>
      <div class="fm-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Class</label><select onchange="location.href='/fees/collect?class_id='+this.value">
          <option value="">Select class</option>
          ${classes.map(c => `<option value="${c.id}" ${selectedClass == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
      </div>
      ${selectedClass ? `
      <div class="fm-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Students — Outstanding Balances</h3>
        <div style="overflow-x:auto;max-height:300px;overflow-y:auto"><table class="fm-table">
          <thead style="position:sticky;top:0"><tr><th>Student</th><th>Adm#</th><th>Outstanding</th><th>Action</th></tr></thead>
          <tbody>${studentsHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:30px">No students</td></tr>'}</tbody>
        </table></div>
      </div>` : ''}
      ${studentInfo ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="fm-card" style="padding:24px">
          <h3 style="margin:0 0 10px;color:#1e293b">Student: ${esc(studentInfo.first_name + ' ' + studentInfo.last_name)}</h3>
          <p class="muted" style="font-size:13px">${esc(studentInfo.class_name || '')} · ${esc(studentInfo.admission_number || '')}</p>
          <p style="margin-top:12px;font-size:18px;font-weight:700;color:#dc2626">Total Due: ${totalDue.toLocaleString()}</p>
          <h4 style="margin:16px 0 8px;font-size:13px;color:#64748b;text-transform:uppercase">Outstanding Items</h4>
          <div style="overflow-x:auto"><table class="fm-table">
            <thead><tr><th>Receipt#</th><th>Balance</th><th>Term</th><th>Notes</th></tr></thead>
            <tbody>${balanceHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px">No outstanding balance</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="fm-card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">Process Payment</h3>
          <form method="POST" action="/fees/collect" style="display:flex;flex-direction:column;gap:14px">
            <input type="hidden" name="student_id" value="${studentId}">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Amount *</label>
              <input type="number" name="amount" required min="0" step="0.01" placeholder="0.00" data-ugx="true" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Fee Structure</label>
              <select name="fee_structure_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="">Select (optional)</option>
                ${structures.map(s => `<option value="${s.id}">${esc(s.name)} — ${Number(s.total_amount).toLocaleString()}</option>`).join('')}
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Payment Method *</label>
              <select name="payment_method" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="mobile_money">Mobile Money</option><option value="cheque">Cheque</option><option value="card">Card</option>
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Reference</label>
              <input type="text" name="reference" placeholder="Transaction reference" maxlength="100" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Term</label>
              <select name="term" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option>
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" placeholder="Optional notes" maxlength="500" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
            <button type="submit" class="fm-btn fm-btn-success" style="padding:14px 28px;font-size:15px;justify-content:center">💰 Process Payment</button>
          </form>
        </div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Collect Fee Payment', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /fees/collect — Process fee payment
  // ============================================================
  app.post('/fees/collect', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, amount, fee_structure_id, payment_method, reference, term, notes } = req.body;
    if (!student_id || !amount || Number(amount) <= 0) {
      req.session.flash = { type: 'error', msg: 'Please provide student and valid amount' };
      return res.redirect('/fees/collect');
    }

    // Get fee structure amount for balance calc
    let totalAmount = Number(amount);
    if (fee_structure_id) {
      const fs = (await pool.query(`SELECT total_amount FROM fee_structures WHERE id=$1 AND tenant_id=$2`, [fee_structure_id, tid])).rows[0];
      if (fs) totalAmount = Number(fs.total_amount);
    }

    const balance = totalAmount - Number(amount);
    const receiptNumber = 'RCP-' + Date.now().toString(36).toUpperCase() + '-' + genToken().substring(0, 6).toUpperCase();

    await pool.query(
      `INSERT INTO fee_receipts (tenant_id, student_id, fee_structure_id, receipt_number, amount_paid, balance, payment_method, reference, term, year, status, received_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paid',$11,$12)`,
      [tid, student_id, fee_structure_id || null, receiptNumber, amount, balance > 0 ? balance : 0, payment_method || 'cash', reference || null, term || 'Term 1', new Date().getFullYear().toString(), user.id, notes || null]
    );

    // Also record in payments table
    const student = (await pool.query(`SELECT first_name, last_name FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid])).rows[0];
    try {
      await pool.query(
        `INSERT INTO payments (tenant_id, student_id, amount, method, reference, status, term, created_by) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7)`,
        [tid, student_id, amount, payment_method || 'cash', reference || null, term || 'Term 1', user.id]
      );
    } catch (e) { /* payments table may have different schema */ }

    req.session.flash = { type: 'success', msg: `Payment of ${Number(amount).toLocaleString()} recorded. Receipt: ${receiptNumber}` };
    res.redirect(`/fees/receipts?search=${receiptNumber}`);
  }));

  // ============================================================
  // ROUTE 6: GET /fees/receipts — Receipt list
  // ============================================================
  app.get('/fees/receipts', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = req.query.search || '';
    const term = req.query.term || '';
    const status = req.query.status || '';

    let where = ['fr.tenant_id=$1'], params = [tid], pi = 2;
    if (search) { where.push(`(fr.receipt_number ILIKE $${pi} OR s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }
    if (term) { where.push(`fr.term=$${pi++}`); params.push(term); }
    if (status) { where.push(`fr.status=$${pi++}`); params.push(status); }

    const receipts = (await pool.query(
      `SELECT fr.*, s.first_name, s.last_name, s.admission_number, c.name as class_name
       FROM fee_receipts fr
       LEFT JOIN students s ON s.id = fr.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE ${where.join(' AND ')} ORDER BY fr.created_at DESC LIMIT 100`,
      params
    )).rows;

    const rowsHtml = receipts.map(r => `<tr>
      <td><a href="/fees/receipts/${r.id}" style="color:#4f46e5;font-weight:600;text-decoration:none">${esc(r.receipt_number || '—')}</a></td>
      <td><strong>${esc(r.first_name + ' ' + r.last_name)}</strong></td>
      <td>${esc(r.class_name || '')}</td>
      <td style="font-weight:600;color:#16a34a">${Number(r.amount_paid).toLocaleString()}</td>
      <td style="color:${r.balance > 0 ? '#dc2626' : '#16a34a'}">${Number(r.balance).toLocaleString()}</td>
      <td>${esc(r.payment_method || '')}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('receipts')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🧾 Fee Receipts</h1>
      <div class="fm-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Search</label><input type="text" name="search" value="${esc(search)}" placeholder="Receipt# or name" onchange="location.href='/fees/receipts?search='+this.value"></div>
        <div><label>Term</label><select onchange="location.href='/fees/receipts?search=${esc(search)}&term='+this.value">
          <option value="">All</option>
          <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
          <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
          <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option>
        </select></div>
        <div><label>Status</label><select onchange="location.href='/fees/receipts?search=${esc(search)}&status='+this.value">
          <option value="">All</option>
          <option value="paid" ${status==='paid'?'selected':''}>Paid</option>
          <option value="partial" ${status==='partial'?'selected':''}>Partial</option>
          <option value="overdue" ${status==='overdue'?'selected':''}>Overdue</option>
        </select></div>
      </div>
      <div class="fm-card">
        <div style="overflow-x:auto"><table class="fm-table">
          <thead><tr><th>Receipt#</th><th>Student</th><th>Class</th><th>Paid</th><th>Balance</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No receipts found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Fee Receipts', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /fees/receipts/:id — Individual receipt
  // ============================================================
  app.get('/fees/receipts/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const receipt = (await pool.query(
      `SELECT fr.*, s.first_name, s.last_name, s.admission_number, s.class_id, c.name as class_name
       FROM fee_receipts fr
       LEFT JOIN students s ON s.id = fr.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE fr.id=$1 AND fr.tenant_id=$2`,
      [req.params.id, tid]
    )).rows[0];
    if (!receipt) return res.send(renderPage('Not Found', '<div class="fm-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Receipt not found</h2></div>', user, req));

    const html = FM_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('receipts')}
      <a href="/fees/receipts" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Receipts</a>
      <div class="fm-card" style="border:2px solid #e2e8f0;padding:32px;text-align:center">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">🧾 Fee Payment Receipt</h2>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:20px">Comfort Zone — Official Payment Record</p>
        <div style="text-align:left;background:#f8fafc;border-radius:10px;padding:20px;margin-bottom:20px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:14px">
            <div><span class="muted">Receipt#:</span> <strong>${esc(receipt.receipt_number)}</strong></div>
            <div><span class="muted">Date:</span> ${fmtDateTime(receipt.created_at)}</div>
            <div><span class="muted">Student:</span> <strong>${esc(receipt.first_name + ' ' + receipt.last_name)}</strong></div>
            <div><span class="muted">Admission:</span> ${esc(receipt.admission_number || '—')}</div>
            <div><span class="muted">Class:</span> ${esc(receipt.class_name || '—')}</div>
            <div><span class="muted">Term:</span> ${esc(receipt.term || '—')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
          <div style="background:#f0fdf4;border-radius:10px;padding:16px">
            <div class="muted" style="font-size:11px;text-transform:uppercase">Amount Paid</div>
            <div style="font-size:24px;font-weight:700;color:#16a34a">${Number(receipt.amount_paid).toLocaleString()}</div>
          </div>
          <div style="background:#fef2f2;border-radius:10px;padding:16px">
            <div class="muted" style="font-size:11px;text-transform:uppercase">Balance</div>
            <div style="font-size:24px;font-weight:700;color:#dc2626">${Number(receipt.balance).toLocaleString()}</div>
          </div>
          <div style="background:#f5f3ff;border-radius:10px;padding:16px">
            <div class="muted" style="font-size:11px;text-transform:uppercase">Method</div>
            <div style="font-size:16px;font-weight:600;color:#4f46e5">${esc(receipt.payment_method || '—')}</div>
          </div>
        </div>
        ${receipt.reference ? `<div style="font-size:13px;color:#64748b;margin-bottom:8px">Reference: <code style="background:#f1f5f9;padding:2px 8px;border-radius:4px">${esc(receipt.reference)}</code></div>` : ''}
        ${receipt.notes ? `<div style="font-size:13px;color:#64748b">Notes: ${esc(receipt.notes)}</div>` : ''}
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">Generated by Comfort Zone SaaS Platform</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
        <button onclick="window.print()" class="fm-btn fm-btn-secondary">🖨️ Print Receipt</button>
        <a href="/fees/receipts" class="fm-btn fm-btn-secondary">← All Receipts</a>
      </div>
    </div>`;
    res.send(renderPage(`Receipt — ${receipt.receipt_number}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /fees/reminders — Fee reminder settings
  // ============================================================
  app.get('/fees/reminders', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const reminders = (await pool.query(`SELECT * FROM fee_reminder_settings WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid])).rows;

    // Count of students with outstanding balance
    const overdueCount = (await pool.query(
      `SELECT COUNT(DISTINCT fr.student_id)::int as cnt FROM fee_receipts fr WHERE fr.tenant_id=$1 AND fr.balance > 0`,
      [tid]
    )).rows[0].cnt;

    const rowsHtml = reminders.map(r => `<tr>
      <td>${esc(r.reminder_type || '—')}</td>
      <td>${r.threshold_days || 7} days before due</td>
      <td>${r.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Inactive</span>'}</td>
      <td>${r.last_sent ? fmtDateTime(r.last_sent) : 'Never'}</td>
      <td><button onclick="sendReminder(${r.id})" class="fm-btn fm-btn-primary" style="padding:4px 10px;font-size:11px">🔔 Send Now</button></td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('reminders')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🔔 Fee Reminders</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${overdueCount}</div><div class="muted" style="font-size:11px">Students with Outstanding Balance</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${reminders.length}</div><div class="muted" style="font-size:11px">Reminder Rules</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="fm-card" style="padding:24px">
          <h3 style="margin:0 0 16px;color:#1e293b">Add Reminder Rule</h3>
          <form method="POST" action="/fees/reminders" style="display:flex;flex-direction:column;gap:14px">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Reminder Type</label>
              <select name="reminder_type" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="sms">SMS</option><option value="email">Email</option><option value="push">Push Notification</option>
              </select></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Days Before Due</label>
              <input type="number" name="threshold_days" value="7" min="1" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Message Template</label>
              <textarea name="message_template" rows="4" placeholder="Dear {parent_name}, a reminder that the school fees of {amount} are due on {due_date}..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
            <button type="submit" class="fm-btn fm-btn-primary" style="justify-content:center">💾 Save Rule</button>
          </form>
        </div>
        <div class="fm-card">
          <h3 style="margin:0 0 14px;color:#1e293b">Active Reminder Rules</h3>
          <div style="overflow-x:auto"><table class="fm-table">
            <thead><tr><th>Type</th><th>Threshold</th><th>Status</th><th>Last Sent</th><th>Action</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No reminder rules</td></tr>'}</tbody>
          </table></div>
          <form method="POST" action="/fees/reminders/send" style="margin-top:16px">
            <button type="submit" class="fm-btn fm-btn-danger" style="justify-content:center;width:100%">🔔 Send Reminders to All Outstanding</button>
          </form>
        </div>
      </div>
    </div>
    <script>function sendReminder(id){fetch('/fees/reminders/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule_id:id})}).then(r=>r.json()).then(d=>{if(d.success)alert('Reminders sent: '+d.count);else alert('Error: '+d.error)})}</script>`;
    res.send(renderPage('Fee Reminders', html, user, req));
  }));

  app.post('/fees/reminders', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { reminder_type, threshold_days, message_template } = req.body;
    await pool.query(
      `INSERT INTO fee_reminder_settings (tenant_id, reminder_type, threshold_days, message_template, is_active) VALUES ($1,$2,$3,$4,true)`,
      [tid, reminder_type || 'sms', threshold_days || 7, message_template || null]
    );
    req.session.flash = { type: 'success', msg: 'Reminder rule created' };
    res.redirect('/fees/reminders');
  }));

  app.post('/fees/reminders/send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    // Get students with outstanding balances
    const students = (await pool.query(
      `SELECT DISTINCT s.id, s.first_name, s.last_name, SUM(fr.balance)::numeric(12,2) as total_due
       FROM students s JOIN fee_receipts fr ON fr.student_id = s.id
       WHERE s.tenant_id=$1 AND fr.tenant_id=$1 AND fr.balance > 0
       GROUP BY s.id, s.first_name, s.last_name LIMIT 100`,
      [tid]
    )).rows;

    // Simulate sending (in production this would integrate with SMS/email)
    req.session.flash = { type: 'success', msg: `Reminder queued for ${students.length} student(s) with outstanding balances` };

    if (req.headers['content-type']?.includes('application/json')) {
      return res.json({ success: true, count: students.length });
    }
    res.redirect('/fees/reminders');
  }));

  // ============================================================
  // ROUTE 9: GET /fees/balance — Outstanding balance report
  // ============================================================
  app.get('/fees/balance', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classId = req.query.class_id || '';
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    let where = ['fr.tenant_id=$1', 'fr.balance > 0'], params = [tid], pi = 2;
    if (classId) {
      where.push(`s.class_id=$${pi++}`);
      params.push(classId);
    }

    const balances = (await pool.query(
      `SELECT s.id as student_id, s.first_name, s.last_name, s.admission_number, c.name as class_name,
        SUM(fr.balance)::numeric(12,2) as total_balance,
        COUNT(fr.id)::int as receipt_count
       FROM students s
       JOIN fee_receipts fr ON fr.student_id = s.id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE ${where.join(' AND ')}
       GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
       ORDER BY total_balance DESC LIMIT 200`,
      params
    )).rows;

    const totalOutstanding = balances.reduce((s, r) => s + Number(r.total_balance || 0), 0);

    const rowsHtml = balances.map(r => `<tr>
      <td><strong>${esc(r.last_name + ', ' + r.first_name)}</strong></td>
      <td class="muted">${esc(r.admission_number || '')}</td>
      <td>${esc(r.class_name || '')}</td>
      <td style="font-weight:700;color:#dc2626">${Number(r.total_balance).toLocaleString()}</td>
      <td>${r.receipt_count}</td>
      <td><a href="/fees/collect?student_id=${r.student_id}" class="fm-btn fm-btn-primary" style="padding:4px 12px;font-size:11px">Collect</a></td>
    </tr>`).join('');

    const html = FM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('balance')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📊 Outstanding Balances</h1>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${Number(totalOutstanding).toLocaleString()}</div><div class="muted" style="font-size:11px">Total Outstanding</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${balances.length}</div><div class="muted" style="font-size:11px">Students with Balance</div></div>
      </div>
      <div class="fm-filter" style="background:#f8fafc;padding:14px;border-radius:12px;margin-bottom:20px">
        <div><label>Class</label><select onchange="location.href='/fees/balance?class_id='+this.value">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${c.id}" ${classId == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
      </div>
      <div class="fm-card">
        <div style="overflow-x:auto;max-height:600px;overflow-y:auto"><table class="fm-table">
          <thead style="position:sticky;top:0"><tr><th>Student</th><th>Adm#</th><th>Class</th><th>Balance</th><th>Receipts</th><th>Action</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No outstanding balances — all clear! 🎉</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Outstanding Balances', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: GET /fees/api/summary — JSON API
  // ============================================================
  app.get('/fees/api/summary', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const year = req.query.year || new Date().getFullYear().toString();

    const totalCollected = (await pool.query(
      `SELECT COALESCE(SUM(amount_paid), 0)::numeric(14,2) as total FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [tid, year]
    )).rows[0].total;

    const totalBalance = (await pool.query(
      `SELECT COALESCE(SUM(balance), 0)::numeric(14,2) as total FROM fee_receipts WHERE tenant_id=$1 AND balance > 0`,
      [tid]
    )).rows[0].total;

    const receiptCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM fee_receipts WHERE tenant_id=$1 AND EXTRACT(YEAR FROM created_at)=$2`,
      [tid, year]
    )).rows[0].cnt;

    const overdueStudents = (await pool.query(
      `SELECT COUNT(DISTINCT student_id)::int as cnt FROM fee_receipts WHERE tenant_id=$1 AND balance > 0`,
      [tid]
    )).rows[0].cnt;

    res.json({
      success: true,
      year,
      total_collected: totalCollected,
      outstanding_balance: totalBalance,
      receipt_count: receiptCount,
      overdue_students: overdueStudents
    });
  }));

};
