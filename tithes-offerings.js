// ============================================================
// TITHES & OFFERINGS MODULE — Multi-Tenant SaaS Platform
// Church-focused module for managing tithes, offerings,
// donations, giving campaigns, recurring giving, receipts.
// ============================================================
// Usage in server.js:
//   const tithesOfferings = require('./tithes-offerings');
//   tithesOfferings(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function tithesOfferings(app, db, pool, renderPage, esc) {

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
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function typeBadge(t) {
    const m = {
      tithe: { cls: 'badge-success', label: 'Tithe' },
      offering: { cls: 'badge', label: 'Offering', style: 'background:#dbeafe;color:#1d4ed8' },
      donation: { cls: 'badge-warning', label: 'Donation' },
      thanksgiving: { cls: 'badge', label: 'Thanksgiving', style: 'background:#fef3c7;color:#92400e' },
      special: { cls: 'badge', label: 'Special', style: 'background:#ede9fe;color:#6d28d9' },
    };
    const v = m[t] || { cls: 'badge', label: t };
    return `<span class="badge ${v.cls}" ${v.style ? 'style="' + v.style + '"' : ''}>${v.label}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const TO_CSS = `<style>
    .to-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .to-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .to-nav a:hover{background:#e2e8f0}.to-nav a.active{background:#4f46e5;color:#fff}
    .to-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .to-btn:hover{opacity:.9;transform:translateY(-1px)}
    .to-btn-primary{background:#4f46e5;color:#fff}.to-btn-success{background:#059669;color:#fff}
    .to-btn-danger{background:#fee2e2;color:#dc2626}.to-btn-secondary{background:#f1f5f9;color:#475569}
    .to-table{width:100%;border-collapse:collapse;font-size:13px}
    .to-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .to-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .to-table tr:hover{background:#f8fafc}
    .to-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .to-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .to-filter input,.to-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .to-filter input:focus,.to-filter select:focus{outline:none;border-color:#6366f1}
    .to-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    @media(max-width:768px){.to-nav{gap:4px}.to-nav a{padding:6px 12px;font-size:12px}.to-form-grid{grid-template-columns:1fr}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="to-nav">
    <a href="/tithes" class="${active === 'dash' ? 'active' : ''}">💰 Dashboard</a>
    <a href="/tithes/record" class="${active === 'record' ? 'active' : ''}">📝 Record</a>
    <a href="/tithes/history" class="${active === 'history' ? 'active' : ''}">📋 History</a>
    <a href="/tithes/reports" class="${active === 'reports' ? 'active' : ''}">📊 Reports</a>
    <a href="/tithes/recurring" class="${active === 'recurring' ? 'active' : ''}">🔄 Recurring</a>
    <a href="/tithes/campaigns" class="${active === 'campaigns' ? 'active' : ''}">🎯 Campaigns</a>
    <a href="/tithes/receipts" class="${active === 'receipts' ? 'active' : ''}">🧾 Receipts</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'TithesOfferings', `CREATE TABLE IF NOT EXISTS tithes_records (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        member_id INTEGER, member_name VARCHAR(255), type VARCHAR(20) DEFAULT 'tithe',
        amount DECIMAL(12,2) DEFAULT 0, payment_method VARCHAR(50), reference VARCHAR(100),
        date DATE NOT NULL, notes TEXT, campaign_id INTEGER, created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE TABLE IF NOT EXISTS giving_campaigns (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), description TEXT, target_amount DECIMAL(12,2) DEFAULT 0,
        start_date DATE, end_date DATE, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER columns
      const trCols = [
        ['member_id','INTEGER'],['member_name','VARCHAR(255)'],['type',"VARCHAR(20) DEFAULT 'tithe'"],
        ['amount','DECIMAL(12,2) DEFAULT 0'],['payment_method','VARCHAR(50)'],['reference','VARCHAR(100)'],
        ['date','DATE NOT NULL'],['notes','TEXT'],['campaign_id','INTEGER'],['created_by','INTEGER'],
        ['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of trCols) { try { await migrateQuery(pool, 'TithesOfferings', `ALTER TABLE tithes_records ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      const gcCols = [
        ['name','VARCHAR(255)'],['description','TEXT'],['target_amount','DECIMAL(12,2) DEFAULT 0'],
        ['start_date','DATE'],['end_date','DATE'],['is_active','BOOLEAN DEFAULT true'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of gcCols) { try { await migrateQuery(pool, 'TithesOfferings', `ALTER TABLE giving_campaigns ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch(e){} }
      // Indexes
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_tr_tenant ON tithes_records(tenant_id)`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_tr_date ON tithes_records(date)`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_tr_type ON tithes_records(tenant_id, type)`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_tr_member ON tithes_records(tenant_id, member_id)`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_gc_tenant ON giving_campaigns(tenant_id)`);
      await migrateQuery(pool, 'TithesOfferings', `CREATE INDEX IF NOT EXISTS idx_gc_active ON giving_campaigns(tenant_id, is_active)`);
      console.log('[Tithes] Migrations applied successfully');
    } catch (e) { console.error('[Tithes] Migration error:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /tithes — Dashboard
  // ============================================================
  app.get('/tithes', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = today();
    const monthStart = now.substring(0, 7) + '-01';

    // Overall totals
    const totals = (await pool.query(
      `SELECT type, COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 GROUP BY type ORDER BY total DESC`,
      [tid]
    )).rows;
    const grandTotal = totals.reduce((s, r) => s + Number(r.total), 0);

    // This month totals
    const monthTotals = (await pool.query(
      `SELECT type, COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 AND date >= $2 GROUP BY type`,
      [tid, monthStart]
    )).rows;
    const monthTotal = monthTotals.reduce((s, r) => s + Number(r.total), 0);

    // Today
    const todayTotal = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 AND date=$2`,
      [tid, now]
    )).rows[0].total;

    // Unique givers
    const uniqueGivers = (await pool.query(
      `SELECT COUNT(DISTINCT COALESCE(member_id, member_name))::int as cnt FROM tithes_records WHERE tenant_id=$1 AND date >= $2`,
      [tid, monthStart]
    )).rows[0].cnt;

    // Active campaigns
    const activeCampaigns = (await pool.query(
      `SELECT gc.*, COALESCE(SUM(tr.amount),0) as raised FROM giving_campaigns gc LEFT JOIN tithes_records tr ON tr.campaign_id=gc.id AND tr.tenant_id=gc.tenant_id WHERE gc.tenant_id=$1 AND gc.is_active=true GROUP BY gc.id ORDER BY gc.created_at DESC`,
      [tid]
    )).rows;

    // Recent records
    const recent = (await pool.query(
      `SELECT * FROM tithes_records WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [tid]
    )).rows;

    // Monthly trend (last 6 months)
    const trend = (await pool.query(
      `SELECT to_char(date,'Mon YYYY') as label, COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 AND date >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months') GROUP BY label ORDER BY MIN(date)`,
      [tid]
    )).rows;
    const maxTrend = Math.max(...trend.map(r => Number(r.total)), 1);

    const trendChart = trend.map(r => {
      const pct = Math.round(Number(r.total) / maxTrend * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:90px">${esc(r.label)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px;transition:.3s"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${fmtMoney(r.total)}</span>
        </div>
      </div>`;
    }).join('');

    const typeHtml = totals.map(t => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      ${typeBadge(t.type)}<span style="flex:1;font-size:13px;color:#475569">${fmtMoney(t.total)}</span>
      <span style="font-size:12px;font-weight:700;color:#1e293b">${t.cnt} records</span>
    </div>`).join('');

    const campaignHtml = activeCampaigns.map(c => {
      const pct = Number(c.target_amount) > 0 ? Math.round(Number(c.raised) / Number(c.target_amount) * 100) : 0;
      return `<div style="padding:14px;background:#f8fafc;border-radius:10px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <strong style="font-size:14px;color:#1e293b">${esc(c.name || 'Campaign')}</strong>
          <span style="font-size:12px;color:#64748b">${pct}%</span>
        </div>
        <div style="background:#e2e8f0;border-radius:6px;height:10px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${Math.min(pct, 100)}%;background:#4f46e5;border-radius:6px"></div>
        </div>
        <div style="font-size:12px;color:#64748b">${fmtMoney(c.raised)} of ${fmtMoney(c.target_amount)}</div>
      </div>`;
    }).join('');

    const recentHtml = recent.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${typeBadge(r.type)}</td>
      <td><strong>${esc(r.member_name || '—')}</strong></td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(r.amount)}</td>
      <td class="muted">${esc(r.payment_method || '—')}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💰 Tithes & Offerings</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage church giving, tithes, and donations</p></div>
        <a href="/tithes/record" class="to-btn to-btn-primary">📝 Record Giving</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${fmtMoney(grandTotal)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Giving</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(monthTotal)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${fmtMoney(todayTotal)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Today</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${uniqueGivers}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Monthly Givers</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${activeCampaigns.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Campaigns</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Giving by Type</h3>
          ${typeHtml || '<p class="muted" style="font-size:13px">No records yet</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Monthly Trend</h3>
          ${trendChart || '<p class="muted" style="font-size:13px">No trend data</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Active Campaigns</h3>
          ${campaignHtml || '<p class="muted" style="font-size:13px">No active campaigns</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 Recent Records</h3>
        <div style="overflow-x:auto"><table class="to-table">
          <thead><tr><th>Date</th><th>Type</th><th>Member</th><th>Amount</th><th>Method</th><th>Recorded</th></tr></thead>
          <tbody>${recentHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No giving records yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Tithes & Offerings Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /tithes/record — Record giving form
  // ============================================================
  app.get('/tithes/record', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const members = (await pool.query(`SELECT id, full_name, email FROM church_members WHERE tenant_id=$1 ORDER BY full_name LIMIT 200`, [tid])).rows;
    const campaigns = (await pool.query(`SELECT id, name FROM giving_campaigns WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;

    const memberOpts = members.map(m => `<option value="${m.id}" data-name="${esc(m.full_name)}">${esc(m.full_name)}</option>`).join('');
    const campaignOpts = campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    const html = TO_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('record')}
      <a href="/tithes" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">📝 Record Tithe / Offering</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Add a new giving record to the system</p>
        <form method="POST" action="/tithes/record" style="display:flex;flex-direction:column;gap:18px">
          <div class="to-form-grid">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Member (optional)</label>
              <select name="member_id" id="memberSelect" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="">— Non-member / Guest —</option>
                ${memberOpts}
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Member Name</label>
              <input type="text" name="member_name" id="memberName" placeholder="Auto-filled or enter manually" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div class="to-form-grid">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Type *</label>
              <select name="type" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="tithe">Tithe</option><option value="offering">Offering</option>
                <option value="donation">Donation</option><option value="thanksgiving">Thanksgiving</option>
                <option value="special">Special</option>
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Amount *</label>
              <input type="number" name="amount" required min="0" step="0.01" placeholder="0.00" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div class="to-form-grid">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Date *</label>
              <input type="date" name="date" required value="${today()}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Payment Method</label>
              <select name="payment_method" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option>
                <option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option>
                <option value="card">Card</option><option value="online">Online</option>
              </select></div>
          </div>
          <div class="to-form-grid">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Reference</label>
              <input type="text" name="reference" placeholder="Transaction reference" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Campaign (optional)</label>
              <select name="campaign_id" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
                <option value="">— No Campaign —</option>
                ${campaignOpts}
              </select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Notes</label>
            <textarea name="notes" rows="2" placeholder="Optional notes..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <button type="submit" class="to-btn to-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">💾 Save Record</button>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('memberSelect').addEventListener('change', function() {
        var opt = this.options[this.selectedIndex];
        document.getElementById('memberName').value = opt.dataset.name || '';
      });
    </script>`;
    res.send(renderPage('Record Tithe / Offering', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /tithes/record — Save giving record
  // ============================================================
  app.post('/tithes/record', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { member_id, member_name, type, amount, payment_method, reference, date, notes, campaign_id } = req.body;
    if (!amount || !date) { req.session.flash = { type: 'error', msg: 'Amount and date are required' }; return res.redirect('/tithes/record'); }
    await pool.query(
      `INSERT INTO tithes_records (tenant_id, member_id, member_name, type, amount, payment_method, reference, date, notes, campaign_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, member_id || null, (member_name || '').trim(), type || 'tithe', parseFloat(amount) || 0, payment_method || 'cash', (reference || '').trim(), date, (notes || '').trim(), campaign_id || null, user.id]
    );
    req.session.flash = { type: 'success', msg: 'Giving record saved successfully!' };
    res.redirect('/tithes/record');
  }));

  // ============================================================
  // ROUTE 4: GET /tithes/history — Giving history
  // ============================================================
  app.get('/tithes/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { from, to, type, member } = req.query;
    const dateFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dateTo = to || today();

    let where = ['tenant_id=$1', 'date >= $2', 'date <= $3'], params = [tid, dateFrom, dateTo], pi = 4;
    if (type) { where.push(`type=$${pi++}`); params.push(type); }
    if (member) { where.push(`member_name ILIKE $${pi}`); params.push(`%${member}%`); pi++; }

    const records = (await pool.query(
      `SELECT tr.*, gc.name as campaign_name FROM tithes_records tr LEFT JOIN giving_campaigns gc ON gc.id=tr.campaign_id WHERE ${where.join(' AND ')} ORDER BY tr.date DESC, tr.created_at DESC`,
      params
    )).rows;
    const totalFiltered = records.reduce((s, r) => s + Number(r.amount), 0);

    const rowsHtml = records.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${typeBadge(r.type)}</td>
      <td><strong>${esc(r.member_name || '—')}</strong></td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(r.amount)}</td>
      <td class="muted">${esc(r.payment_method || '—')}</td>
      <td>${esc(r.reference || '—')}</td>
      <td>${esc(r.campaign_name || '—')}</td>
      <td>${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('history')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Giving History</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Browse and filter all giving records</p></div>
        <div style="display:flex;gap:8px">
          <span class="badge" style="background:#dcfce7;color:#166534;font-size:13px;padding:8px 16px">Total: ${fmtMoney(totalFiltered)}</span>
        </div>
      </div>
      <div class="to-filter">
        <div><label>From</label><input type="date" value="${esc(dateFrom)}" onchange="location.href='/tithes/history?from='+this.value+'&to=${esc(dateTo)}${type ? '&type=' + type : ''}${member ? '&member=' + encodeURIComponent(member) : ''}'"></div>
        <div><label>To</label><input type="date" value="${esc(dateTo)}" onchange="location.href='/tithes/history?from=${esc(dateFrom)}&to='+this.value${type ? '&type=' + type : ''}${member ? '&member=' + encodeURIComponent(member) : ''}"></div>
        <div><label>Type</label><select onchange="location.href='/tithes/history?from=${esc(dateFrom)}&to=${esc(dateTo)}&type='+this.value${member ? '&member=' + encodeURIComponent(member) : ''}">
          <option value="">All Types</option>
          <option value="tithe" ${type === 'tithe' ? 'selected' : ''}>Tithe</option>
          <option value="offering" ${type === 'offering' ? 'selected' : ''}>Offering</option>
          <option value="donation" ${type === 'donation' ? 'selected' : ''}>Donation</option>
          <option value="thanksgiving" ${type === 'thanksgiving' ? 'selected' : ''}>Thanksgiving</option>
          <option value="special" ${type === 'special' ? 'selected' : ''}>Special</option>
        </select></div>
        <div><label>Member</label><form method="GET" action="/tithes/history" style="display:flex;gap:6px">
          <input type="hidden" name="from" value="${esc(dateFrom)}"><input type="hidden" name="to" value="${esc(dateTo)}">
          <input type="text" name="member" value="${esc(member || '')}" placeholder="Search member..." style="width:180px">
          <button type="submit" class="btn btn-sm" style="background:#4f46e5;color:#fff">Search</button>
        </form></div>
      </div>
      <div class="card" style="padding:20px">
        <div style="overflow-x:auto"><table class="to-table">
          <thead><tr><th>Date</th><th>Type</th><th>Member</th><th>Amount</th><th>Method</th><th>Reference</th><th>Campaign</th><th>Recorded</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No records found for this filter</td></tr>'}</tbody>
        </table></div>
        <div style="margin-top:12px;font-size:12px;color:#94a3b8">Showing ${records.length} records</div>
      </div>
    </div>`;
    res.send(renderPage('Giving History', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /tithes/reports — Giving reports
  // ============================================================
  app.get('/tithes/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const period = req.query.period || 'monthly';

    let dateTrunc = "to_char(date,'Mon YYYY')";
    let label = 'Monthly';
    if (period === 'weekly') { dateTrunc = "to_char(date,'WW YYYY')"; label = 'Weekly'; }
    else if (period === 'yearly') { dateTrunc = "EXTRACT(YEAR FROM date)::text"; label = 'Yearly'; }

    const breakdown = (await pool.query(
      `SELECT ${dateTrunc} as period, type, COALESCE(SUM(amount),0) as total, COUNT(*)::int as cnt FROM tithes_records WHERE tenant_id=$1 GROUP BY period, type ORDER BY MIN(date)`,
      [tid]
    )).rows;

    const summary = (await pool.query(
      `SELECT ${dateTrunc} as period, COALESCE(SUM(amount),0) as total, COUNT(*)::int as cnt FROM tithes_records WHERE tenant_id=$1 GROUP BY period ORDER BY MIN(date) DESC LIMIT 12`,
      [tid]
    )).rows;
    const maxPeriod = Math.max(...summary.map(r => Number(r.total)), 1);

    const chartHtml = summary.map(s => {
      const pct = Math.round(Number(s.total) / maxPeriod * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:100px">${esc(String(s.period))}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:24px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:4px;font-size:11px;font-weight:700;color:#1e293b">${fmtMoney(s.total)}</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:50px">${s.cnt} records</span>
      </div>`;
    }).join('');

    // Top givers
    const topGivers = (await pool.query(
      `SELECT member_name, COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 AND member_name IS NOT NULL AND member_name != '' GROUP BY member_name ORDER BY total DESC LIMIT 10`,
      [tid]
    )).rows;

    const giversHtml = topGivers.map((g, i) => `<tr>
      <td><strong>#${i + 1}</strong></td>
      <td><strong>${esc(g.member_name)}</strong></td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(g.total)}</td>
      <td class="muted">${g.cnt} contributions</td>
    </tr>`).join('');

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Giving Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Summarize giving patterns by ${label}</p></div>
        <div style="display:flex;gap:6px">
          <a href="/tithes/reports?period=weekly" class="to-btn ${period === 'weekly' ? 'to-btn-primary' : 'to-btn-secondary'}">Weekly</a>
          <a href="/tithes/reports?period=monthly" class="to-btn ${period === 'monthly' ? 'to-btn-primary' : 'to-btn-secondary'}">Monthly</a>
          <a href="/tithes/reports?period=yearly" class="to-btn ${period === 'yearly' ? 'to-btn-primary' : 'to-btn-secondary'}">Yearly</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">${label} Giving Summary</h3>
          ${chartHtml || '<p class="muted" style="font-size:13px">No data yet</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">🏆 Top Givers</h3>
          <div style="overflow-x:auto"><table class="to-table">
            <thead><tr><th>#</th><th>Name</th><th>Total</th><th>Count</th></tr></thead>
            <tbody>${giversHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Giving Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /tithes/recurring — Recurring giving
  // ============================================================
  app.get('/tithes/recurring', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const recurring = (await pool.query(
      `SELECT * FROM recurring_donations WHERE tenant_id=$1 ORDER BY created_at DESC`,
      [tid]
    )).rows;
    const totalRecurring = recurring.reduce((s, r) => s + Number(r.amount), 0);

    const rowsHtml = recurring.map(r => `<tr>
      <td><strong>${esc(r.donor_name)}</strong></td>
      <td class="muted">${esc(r.donor_email || '—')}</td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(r.amount)}</td>
      <td><span class="badge" style="background:#dbeafe;color:#1d4ed8">${esc(r.schedule || 'monthly')}</span></td>
      <td>${fmtDate(r.next_date)}</td>
      <td>${r.status === 'active' ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Inactive</span>'}</td>
      <td>${r.total_donated || 0}</td>
    </tr>`).join('');

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('recurring')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔄 Recurring Giving</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage recurring donation commitments</p></div>
        <a href="/tithes/recurring" class="to-btn to-btn-primary" onclick="document.getElementById('newForm').style.display='block';return false">+ New Recurring</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${recurring.length}</div><div class="muted" style="font-size:11px">Active Plans</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${fmtMoney(totalRecurring)}</div><div class="muted" style="font-size:11px">Monthly Total</div></div>
      </div>
      <div id="newForm" class="card" style="padding:24px;margin-bottom:20px;display:none">
        <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">New Recurring Donation</h3>
        <form method="POST" action="/tithes/recurring" style="display:flex;flex-wrap:wrap;gap:14px;align-items:end">
          <div style="flex:1;min-width:180px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Donor Name *</label>
            <input type="text" name="donor_name" required placeholder="Full name" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:180px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Email</label>
            <input type="email" name="donor_email" placeholder="email@example.com" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:120px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Amount *</label>
            <input type="number" name="amount" required min="0" step="0.01" placeholder="0.00" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="flex:1;min-width:120px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Schedule</label>
            <select name="schedule" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
            </select></div>
          <div style="flex:1;min-width:140px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Payment Method</label>
            <select name="payment_method" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="mobile_money">Mobile Money</option><option value="bank_transfer">Bank Transfer</option><option value="card">Card</option>
            </select></div>
          <button type="submit" class="to-btn to-btn-primary">Create</button>
        </form>
      </div>
      <div class="card" style="padding:20px">
        <div style="overflow-x:auto"><table class="to-table">
          <thead><tr><th>Donor</th><th>Email</th><th>Amount</th><th>Schedule</th><th>Next Date</th><th>Status</th><th>Total Given</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No recurring donations</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Recurring Giving', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /tithes/recurring — Create recurring donation
  // ============================================================
  app.post('/tithes/recurring', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { donor_name, donor_email, amount, schedule, payment_method } = req.body;
    if (!donor_name || !amount) { req.session.flash = { type: 'error', msg: 'Name and amount are required' }; return res.redirect('/tithes/recurring'); }
    await pool.query(
      `INSERT INTO recurring_donations (tenant_id, donor_name, donor_email, amount, schedule, next_date, payment_method, status) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,'active')`,
      [tid, donor_name.trim(), (donor_email || '').trim(), parseFloat(amount), schedule || 'monthly', payment_method || 'mobile_money']
    );
    req.session.flash = { type: 'success', msg: 'Recurring donation created!' };
    res.redirect('/tithes/recurring');
  }));

  // ============================================================
  // ROUTE 8: GET /tithes/campaigns — Giving campaigns
  // ============================================================
  app.get('/tithes/campaigns', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const campaigns = (await pool.query(
      `SELECT gc.*, COALESCE(SUM(tr.amount),0) as raised FROM giving_campaigns gc LEFT JOIN tithes_records tr ON tr.campaign_id=gc.id AND tr.tenant_id=gc.tenant_id WHERE gc.tenant_id=$1 GROUP BY gc.id ORDER BY gc.is_active DESC, gc.created_at DESC`,
      [tid]
    )).rows;

    const cardsHtml = campaigns.map(c => {
      const pct = Number(c.target_amount) > 0 ? Math.round(Number(c.raised) / Number(c.target_amount) * 100) : 0;
      return `<div class="card" style="padding:20px;margin-bottom:12px;border-left:4px solid ${c.is_active ? '#4f46e5' : '#94a3b8'}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <h3 style="font-size:16px;color:#1e293b;margin:0">${esc(c.name || 'Untitled Campaign')}</h3>
          ${c.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge" style="background:#f1f5f9;color:#94a3b8">Closed</span>'}
        </div>
        ${c.description ? `<p style="font-size:13px;color:#64748b;margin-bottom:10px">${esc(c.description)}</p>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;font-size:13px;color:#475569">
          <div>Target: <strong>${fmtMoney(c.target_amount)}</strong></div>
          <div>Raised: <strong style="color:#16a34a">${fmtMoney(c.raised)}</strong></div>
          <div>Progress: <strong>${pct}%</strong></div>
        </div>
        <div style="background:#e2e8f0;border-radius:6px;height:12px;overflow:hidden">
          <div style="height:100%;width:${Math.min(pct, 100)}%;background:#4f46e5;border-radius:6px;transition:.3s"></div>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:6px">${c.start_date ? fmtDate(c.start_date) : '—'} to ${c.end_date ? fmtDate(c.end_date) : 'Open'}</div>
      </div>`;
    }).join('');

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('campaigns')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🎯 Giving Campaigns</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Building fund, missions, and special campaigns</p></div>
        <a href="/tithes/campaigns" class="to-btn to-btn-primary" onclick="document.getElementById('newCamp').style.display='block';return false">+ New Campaign</a>
      </div>
      <div id="newCamp" class="card" style="padding:24px;margin-bottom:20px;display:none">
        <h3 style="font-size:16px;color:#1e293b;margin-bottom:16px">Create Giving Campaign</h3>
        <form method="POST" action="/tithes/campaigns" style="display:flex;flex-direction:column;gap:14px">
          <div class="to-form-grid">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Campaign Name *</label>
              <input type="text" name="name" required placeholder="e.g., Building Fund" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Target Amount</label>
              <input type="number" name="target_amount" min="0" step="0.01" placeholder="0.00" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div class="to-form-grid">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Start Date</label>
              <input type="date" name="start_date" value="${today()}" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">End Date</label>
              <input type="date" name="end_date" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" placeholder="Campaign purpose..." style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></textarea></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="to-btn to-btn-primary">Create Campaign</button>
            <button type="button" class="to-btn to-btn-secondary" onclick="document.getElementById('newCamp').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>
      ${campaigns.length ? cardsHtml : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b">No campaigns yet</p><p class="muted" style="margin-top:8px">Create your first giving campaign above</p></div>'}
    </div>`;
    res.send(renderPage('Giving Campaigns', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /tithes/campaigns — Create campaign
  // ============================================================
  app.post('/tithes/campaigns', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, target_amount, start_date, end_date, description } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Campaign name is required' }; return res.redirect('/tithes/campaigns'); }
    await pool.query(
      `INSERT INTO giving_campaigns (tenant_id, name, description, target_amount, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name.trim(), (description || '').trim(), parseFloat(target_amount) || 0, start_date || null, end_date || null]
    );
    req.session.flash = { type: 'success', msg: 'Campaign created!' };
    res.redirect('/tithes/campaigns');
  }));

  // ============================================================
  // ROUTE 10: GET /tithes/receipts — Giving receipts
  // ============================================================
  app.get('/tithes/receipts', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id } = req.query;
    let receiptRecord = null;

    if (id) {
      const recs = (await pool.query(
        `SELECT tr.*, gc.name as campaign_name FROM tithes_records tr LEFT JOIN giving_campaigns gc ON gc.id=tr.campaign_id WHERE tr.id=$1 AND tr.tenant_id=$2`,
        [id, tid]
      )).rows;
      if (recs.length) receiptRecord = recs[0];
    }

    const recentRecords = (await pool.query(
      `SELECT * FROM tithes_records WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [tid]
    )).rows;

    const listHtml = recentRecords.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${typeBadge(r.type)}</td>
      <td><strong>${esc(r.member_name || '—')}</strong></td>
      <td style="font-weight:700;color:#16a34a">${fmtMoney(r.amount)}</td>
      <td><a href="/tithes/receipts?id=${r.id}" class="to-btn to-btn-secondary" style="padding:5px 12px;font-size:11px" target="_blank">🧾 View</a></td>
    </tr>`).join('');

    let receiptHtml = '';
    if (receiptRecord) {
      receiptHtml = `<div class="card" style="padding:32px;max-width:600px;margin:20px auto;border:2px solid #e2e8f0">
        <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid #f1f5f9;padding-bottom:16px">
          <h2 style="color:#1e293b;margin:0;font-size:22px">🙏 Giving Receipt</h2>
          <p style="font-size:12px;color:#94a3b8;margin-top:4px">Receipt #${receiptRecord.id} · ${fmtDateTime(receiptRecord.created_at)}</p>
        </div>
        <div style="display:grid;gap:10px;font-size:14px">
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Member:</span><strong>${esc(receiptRecord.member_name || '—')}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Type:</span><strong>${esc(receiptRecord.type)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Date:</span><strong>${fmtDate(receiptRecord.date)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Amount:</span><strong style="color:#16a34a;font-size:18px">${fmtMoney(receiptRecord.amount)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Method:</span><strong>${esc(receiptRecord.payment_method || '—')}</strong></div>
          ${receiptRecord.reference ? `<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Reference:</span><strong>${esc(receiptRecord.reference)}</strong></div>` : ''}
          ${receiptRecord.campaign_name ? `<div style="display:flex;justify-content:space-between"><span style="color:#64748b">Campaign:</span><strong>${esc(receiptRecord.campaign_name)}</strong></div>` : ''}
          ${receiptRecord.notes ? `<div style="margin-top:10px;padding:10px;background:#f8fafc;border-radius:8px"><span style="color:#64748b;font-size:12px">Notes:</span><p style="font-size:13px;color:#475569;margin:4px 0 0">${esc(receiptRecord.notes)}</p></div>` : ''}
        </div>
        <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #f1f5f9">
          <p style="font-size:12px;color:#94a3b8">Thank you for your generous giving!</p>
          <button onclick="window.print()" class="to-btn to-btn-secondary" style="margin-top:8px">🖨️ Print</button>
        </div>
      </div>`;
    }

    const html = TO_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('receipts')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🧾 Giving Receipts</h1>
      ${receiptHtml}
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Recent Records — Click to View Receipt</h3>
        <div style="overflow-x:auto"><table class="to-table">
          <thead><tr><th>Date</th><th>Type</th><th>Member</th><th>Amount</th><th>Receipt</th></tr></thead>
          <tbody>${listHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No records</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Giving Receipts', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /tithes/api/summary — JSON API
  // ============================================================
  app.get('/tithes/api/summary', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = today();
    const monthStart = now.substring(0, 7) + '-01';

    const totalAll = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*)::int as cnt FROM tithes_records WHERE tenant_id=$1`, [tid])).rows[0];
    const monthData = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total, COUNT(*)::int as cnt FROM tithes_records WHERE tenant_id=$1 AND date >= $2`, [tid, monthStart])).rows[0];
    const todayData = (await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 AND date=$2`, [tid, now])).rows[0];
    const byType = (await pool.query(`SELECT type, COALESCE(SUM(amount),0) as total FROM tithes_records WHERE tenant_id=$1 GROUP BY type`, [tid])).rows;
    const activeCampaigns = (await pool.query(`SELECT COUNT(*)::int as cnt FROM giving_campaigns WHERE tenant_id=$1 AND is_active=true`, [tid])).rows[0].cnt;
    const activeRecurring = (await pool.query(`SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount),0) as monthly_total FROM recurring_donations WHERE tenant_id=$1 AND status='active'`, [tid])).rows[0];

    res.json({
      grand_total: Number(totalAll.total),
      total_records: totalAll.cnt,
      month_total: Number(monthData.total),
      month_records: monthData.cnt,
      today_total: Number(todayData.total),
      by_type: byType.reduce((m, r) => { m[r.type] = Number(r.total); return m; }, {}),
      active_campaigns: activeCampaigns,
      active_recurring_plans: activeRecurring.cnt,
      recurring_monthly_total: Number(activeRecurring.monthly_total),
    });
  }));

};
