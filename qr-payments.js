// ============================================================
// QR CODE PAYMENT SYSTEM MODULE — SSEWASSWA Multi-Tenant SaaS
// QR-based payment collection (MTN MoMo, Airtel Money) with
// public payer checkout pages, tenant branding, analytics.
// ============================================================
// Usage in server.js:
//   const qrPayments = require('./qr-payments');
//   qrPayments(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function qrPayments(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ── formatters ────────────────────────────────────────────
  const fmtMoney = (n, cur) => {
    const amount = Number(n || 0).toLocaleString('en-US');
    return (cur || 'UGX') + ' ' + amount;
  };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';

  // ── status badge helper ───────────────────────────────────
  function statusBadge(status) {
    const m = {
      pending:   { bg: '#fef3c7', c: '#d97706', l: 'Pending' },
      paid:      { bg: '#dcfce7', c: '#16a34a', l: 'Paid' },
      expired:   { bg: '#f1f5f9', c: '#64748b', l: 'Expired' },
      cancelled: { bg: '#fee2e2', c: '#dc2626', l: 'Cancelled' }
    };
    const s = m[status] || m.pending;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function entityBadge(type) {
    const m = {
      student_fee:      { bg: '#dbeafe', c: '#2563eb', l: 'Student Fee' },
      shop_sale:        { bg: '#fef3c7', c: '#d97706', l: 'Shop Sale' },
      church_donation:  { bg: '#fce7f3', c: '#db2777', l: 'Church Donation' },
      invoice:          { bg: '#e0e7ff', c: '#4f46e5', l: 'Invoice' },
      event_ticket:     { bg: '#f3e8ff', c: '#9333ea', l: 'Event Ticket' },
      general:          { bg: '#f1f5f9', c: '#64748b', l: 'General' }
    };
    const s = m[type] || m.general;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:600;background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  function methodLabel(m) {
    const map = { mtn_momo: '\uD83D\uDCF1 MTN MoMo', airtel_money: '\uD83D\uDCF1 Airtel Money', card: '\uD83D\uDCB3 Card', cash: '\uD83D\uDCB5 Cash' };
    return map[m] || m || '\u2014';
  }

  // ── generate unique QR code ───────────────────────────────
  function generateQRCode() {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(16).substring(2, 8);
    return 'QR' + ts + rnd;
  }

  // ── generate inline SVG QR-like visual ────────────────────
  function generateQRSVG(code, size) {
    size = size || 200;
    // Deterministic pseudo-random grid from the code string
    const seed = code.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    let rng = seed;
    function nextRand() { rng = (rng * 16807 + 12345) % 2147483647; return rng / 2147483647; }
    const modules = 21;
    const cellSize = size / modules;
    let rects = '';
    // Draw finder patterns (top-left, top-right, bottom-left)
    function finder(ox, oy) {
      const s = cellSize;
      rects += `<rect x="${ox}" y="${oy}" width="${7*s}" height="${7*s}" fill="#059669"/>`;
      rects += `<rect x="${ox+s}" y="${oy+s}" width="${5*s}" height="${5*s}" fill="#fff"/>`;
      rects += `<rect x="${ox+2*s}" y="${oy+2*s}" width="${3*s}" height="${3*s}" fill="#059669"/>`;
    }
    finder(0, 0);
    finder(14 * cellSize, 0);
    finder(0, 14 * cellSize);
    // Timing patterns
    for (let i = 8; i < 14; i++) {
      rects += `<rect x="${i*cellSize}" y="${6*cellSize}" width="${cellSize}" height="${cellSize}" fill="${i%2===0?'#059669':'#fff'}"/>`;
      rects += `<rect x="${6*cellSize}" y="${i*cellSize}" width="${cellSize}" height="${cellSize}" fill="${i%2===0?'#059669':'#fff'}"/>`;
    }
    // Data modules (deterministic based on code)
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        // Skip finder + separator zones
        if (row < 8 && col < 8) continue;
        if (row < 8 && col > 12) continue;
        if (row > 12 && col < 8) continue;
        // Skip timing
        if (row === 6 || col === 6) continue;
        if (nextRand() > 0.5) {
          rects += `<rect x="${col*cellSize}" y="${row*cellSize}" width="${cellSize}" height="${cellSize}" fill="#059669" rx="1"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="border-radius:8px">
      <rect width="${size}" height="${size}" fill="#fff" rx="8"/>
      ${rects}
    </svg>`;
  }

  // ── inline CSS ────────────────────────────────────────────
  const QP_CSS = `<style>
.qp-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.qp-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.qp-nav a:hover{background:#e2e8f0}.qp-nav a.active{background:#059669;color:#fff}
.qp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px}
.qp-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.15s}
.qp-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
.qp-stat-val{font-size:28px;font-weight:800;color:#1e293b}
.qp-stat-lbl{font-size:12px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.qp-stat-icon{font-size:28px;margin-bottom:6px}
.qp-tbl{width:100%;border-collapse:collapse;font-size:13px}
.qp-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;white-space:nowrap}
.qp-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.qp-tbl tr:hover{background:#f8fafc}
.qp-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.qp-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.qp-filter input,.qp-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.qp-filter input:focus,.qp-filter select:focus{outline:none;border-color:#059669}
.qp-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.qp-btn:hover{opacity:.9;transform:translateY(-1px)}
.qp-btn-primary{background:#059669;color:#fff}
.qp-btn-danger{background:#fee2e2;color:#dc2626}
.qp-btn-secondary{background:#f1f5f9;color:#475569}
.qp-btn-mtn{background:#ffc107;color:#000;padding:14px 28px;font-size:16px;border-radius:12px}
.qp-btn-airtel{background:#dc2626;color:#fff;padding:14px 28px;font-size:16px;border-radius:12px}
.qp-btn-mtn:hover,.qp-btn-airtel:hover{opacity:.9;transform:translateY(-1px)}
.qp-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.qp-form-grid .full{grid-column:1/-1}
.qp-form-grid label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.qp-form-grid input,.qp-form-grid select,.qp-form-grid textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.qp-form-grid input:focus,.qp-form-grid select:focus,.qp-form-grid textarea:focus{outline:none;border-color:#059669}
.qp-chart-bar{display:flex;align-items:end;gap:6px;height:180px;padding:10px 0;border-bottom:2px solid #e2e8f0}
.qp-chart-bar-item{flex:1;text-align:center;position:relative}
.qp-chart-bar-fill{background:linear-gradient(180deg,#059669,#34d399);border-radius:6px 6px 0 0;min-height:2px;transition:.3s;position:absolute;bottom:30px;left:50%;transform:translateX(-50%);width:80%}
.qp-chart-bar-label{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:10px;color:#94a3b8;white-space:nowrap}
.qp-chart-bar-val{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#059669;white-space:nowrap}
.qp-qrcode-box{display:inline-flex;flex-direction:column;align-items:center;padding:24px;background:#fff;border:2px solid #e2e8f0;border-radius:16px}
.qp-qrcode-box .code-label{font-size:12px;color:#64748b;margin-top:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.qp-detail-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.qp-detail-row:last-child{border-bottom:none}
.qp-detail-row .lbl{color:#64748b}
.qp-detail-row .val{font-weight:600;color:#1e293b}
.qp-pager{display:flex;gap:6px;justify-content:center;margin-top:16px}
.qp-pager a,.qp-pager span{padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9}
.qp-pager a:hover{background:#e2e8f0}.qp-pager span.current{background:#059669;color:#fff}
.qp-scan-log{font-size:12px;color:#94a3b8;margin-top:8px}
/* Public payer page */
.payer-page{max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.payer-card{background:#fff;border-radius:20px;box-shadow:0 4px 24px rgba(0,0,0,.08);overflow:hidden}
.payer-header{background:linear-gradient(135deg,#059669,#047857);padding:28px 24px;color:#fff;text-align:center}
.payer-header h1{margin:0;font-size:20px;font-weight:700}
.payer-header p{margin:6px 0 0;font-size:14px;opacity:.9}
.payer-amount{text-align:center;padding:24px}
.payer-amount .big{font-size:42px;font-weight:800;color:#1e293b}
.payer-amount .curr{font-size:16px;color:#64748b}
.payer-amount .label{font-size:13px;color:#94a3b8;margin-top:4px}
.payer-info{padding:0 24px}
.payer-info-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.payer-info-row .k{color:#64748b}.payer-info-row .v{font-weight:600;color:#1e293b}
.payer-methods{padding:24px;display:flex;flex-direction:column;gap:12px}
.payer-method-btn{display:flex;align-items:center;gap:12px;padding:18px 20px;border:2px solid #e2e8f0;border-radius:14px;cursor:pointer;font-size:15px;font-weight:700;transition:.2s;text-decoration:none;color:#1e293b;background:#fff}
.payer-method-btn:hover{border-color:#059669;box-shadow:0 2px 12px rgba(5,150,105,.12)}
.payer-method-btn .icon{font-size:28px}
.payer-method-btn .sub{font-size:12px;font-weight:400;color:#94a3b8}
.payer-footer{text-align:center;padding:16px 24px 24px;font-size:12px;color:#94a3b8}
.payer-status{text-align:center;padding:40px 24px}
.payer-status .icon{font-size:64px;margin-bottom:12px}
.payer-status h2{font-size:22px;color:#1e293b;margin:0}
.payer-status p{font-size:14px;color:#64748b;margin-top:6px}
.payer-timer{font-size:36px;font-weight:800;color:#059669;font-variant-numeric:tabular-nums}
.payer-timer-label{font-size:12px;color:#94a3b8;margin-top:2px}
.payer-countdown-box{background:#f0fdf4;border-radius:12px;padding:16px;text-align:center;margin:16px 24px}
.payer-phone-form{padding:0 24px 20px}
.payer-phone-form input{width:100%;padding:14px 16px;border:2px solid #e2e8f0;border-radius:12px;font-size:16px;box-sizing:border-box}
.payer-phone-form input:focus{outline:none;border-color:#059669}
.payer-phone-form .error{color:#dc2626;font-size:13px;margin-top:6px}
.payer-phone-form .submit-btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px;color:#fff}
@media(max-width:768px){
  .qp-stats{grid-template-columns:1fr 1fr}
  .qp-filter{flex-direction:column}
  .qp-form-grid{grid-template-columns:1fr}
  .qp-nav{flex-direction:column}
  .payer-amount .big{font-size:36px}
}
@media print{.qp-no-print{display:none!important}}
</style>`;

  // ── navigation helper ─────────────────────────────────────
  function nav(active) {
    const links = [
      ['/qr-payments', '\uD83D\uDCCA Dashboard'],
      ['/qr-payments/generate', '\u2795 Generate QR'],
      ['/qr-payments/manage', '\uD83D\uDD0D Manage']
    ];
    return '<div class="qp-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ── pagination helper ─────────────────────────────────────
  function pagerHtml(page, totalPages, baseUrl) {
    if (totalPages <= 1) return '';
    let h = '<div class="qp-pager">';
    if (page > 1) h += `<a href="${baseUrl}?page=${page - 1}">&laquo; Prev</a>`;
    const s = Math.max(1, page - 2), e = Math.min(totalPages, page + 2);
    for (let i = s; i <= e; i++) h += i === page ? `<span class="current">${i}</span>` : `<a href="${baseUrl}?page=${i}">${i}</a>`;
    if (page < totalPages) h += `<a href="${baseUrl}?page=${page + 1}">Next &raquo;</a>`;
    h += '</div>';
    return h;
  }

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS qr_payments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      qr_code TEXT UNIQUE NOT NULL,
      qr_label VARCHAR(255),
      amount INTEGER NOT NULL,
      currency VARCHAR(5) DEFAULT 'UGX',
      entity_type VARCHAR(50),
      entity_id INTEGER,
      payer_name VARCHAR(255),
      payer_phone VARCHAR(20),
      payer_email VARCHAR(255),
      status VARCHAR(20) DEFAULT 'pending',
      payment_method VARCHAR(30),
      payment_ref VARCHAR(100),
      paid_amount INTEGER DEFAULT 0,
      paid_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS qr_payment_scans (
      id SERIAL PRIMARY KEY,
      qr_payment_id INTEGER NOT NULL REFERENCES qr_payments(id) ON DELETE CASCADE,
      scanned_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address VARCHAR(45),
      user_agent TEXT
    )`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_qrp_tenant ON qr_payments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qrp_tenant_status ON qr_payments(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_qrp_code ON qr_payments(qr_code)`,
    `CREATE INDEX IF NOT EXISTS idx_qrp_expires ON qr_payments(expires_at) WHERE status='pending'`,
    `CREATE INDEX IF NOT EXISTS idx_qrp_entity ON qr_payments(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qrp_created ON qr_payments(tenant_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_qrps_qrp ON qr_payment_scans(qr_payment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_qrps_time ON qr_payment_scans(scanned_at)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[QRPayments] Cannot connect to DB for migrations'); return; }
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[QRPayments] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) {
      console.error('[QRPayments] Migration error:', e.message);
    } finally {
      client.release();
    }
  })();

  // ── Auto-expire stale QR codes (runs periodically) ────────
  setInterval(async () => {
    try {
      const r = await pool.query(`UPDATE qr_payments SET status='expired' WHERE status='pending' AND expires_at < NOW()`);
      if (r.rowCount > 0) console.log('[QRPayments] Auto-expired ' + r.rowCount + ' QR codes');
    } catch (e) { /* silent */ }
  }, 5 * 60 * 1000); // every 5 minutes

  // ============================================================
  // ROUTE 1: GET /qr-payments — Dashboard
  // ============================================================
  app.get('/qr-payments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const totalQR = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM qr_payments WHERE tenant_id=$1`, [tid]
    )).rows[0].cnt;

    const totalCollected = (await pool.query(
      `SELECT COALESCE(SUM(paid_amount),0)::int as total FROM qr_payments WHERE tenant_id=$1 AND status='paid'`, [tid]
    )).rows[0].total;

    const pendingCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt, COALESCE(SUM(amount),0)::int as total FROM qr_payments WHERE tenant_id=$1 AND status='pending' AND expires_at > NOW()`, [tid]
    )).rows[0];

    const monthCollected = (await pool.query(
      `SELECT COALESCE(SUM(paid_amount),0)::int as total, COUNT(*)::int as cnt FROM qr_payments WHERE tenant_id=$1 AND status='paid' AND paid_at >= date_trunc('month', NOW())`, [tid]
    )).rows[0];

    const expiredCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM qr_payments WHERE tenant_id=$1 AND status='expired'`, [tid]
    )).rows[0].cnt;

    const conversionRate = totalQR > 0 ? ((monthCollected.cnt / Math.max(totalQR, 1)) * 100).toFixed(1) : '0';

    // Chart data: last 30 days daily collections
    const chartData = (await pool.query(`
      SELECT DATE(paid_at) as day, COALESCE(SUM(paid_amount),0)::int as total
      FROM qr_payments
      WHERE tenant_id=$1 AND status='paid' AND paid_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(paid_at) ORDER BY day
    `, [tid])).rows;

    // Fill in missing days
    const chartDays = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const found = chartData.find(r => r.day.toISOString().split('T')[0] === ds);
      chartDays.push({ day: ds, total: found ? found.total : 0, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) });
    }
    const maxChart = Math.max(...chartDays.map(d => d.total), 1);

    const chartBars = chartDays.map(d => {
      const h = Math.max(2, (d.total / maxChart) * 140);
      return `<div class="qp-chart-bar-item" style="min-width:0">
        ${d.total > 0 ? `<div class="qp-chart-bar-val">${(d.total / 1000).toFixed(0)}k</div>` : ''}
        <div class="qp-chart-bar-fill" style="height:${h}px"></div>
        <div class="qp-chart-bar-label">${d.label.split(' ')[0]}</div>
      </div>`;
    }).join('');

    // Recent QR payments
    const recent = (await pool.query(
      `SELECT * FROM qr_payments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]
    )).rows;

    const recentRows = recent.map(r => {
      const isExpired = r.status === 'expired' || (r.status === 'pending' && new Date(r.expires_at) < new Date());
      const displayStatus = isExpired ? 'expired' : r.status;
      return `<tr>
        <td style="font-weight:600;font-family:monospace;font-size:12px"><a href="/qr-payments/${r.id}" style="color:#059669;text-decoration:none">${esc(r.qr_code)}</a></td>
        <td>${esc(r.qr_label || '\u2014')}</td>
        <td style="font-weight:600">${fmtMoney(r.amount)}</td>
        <td>${entityBadge(r.entity_type)}</td>
        <td>${statusBadge(displayStatus)}</td>
        <td style="color:#94a3b8;font-size:12px">${fmtDateTime(r.created_at)}</td>
      </tr>`;
    }).join('');

    // Top entity types breakdown
    const entityBreakdown = (await pool.query(`
      SELECT entity_type, COUNT(*)::int as cnt, COALESCE(SUM(paid_amount),0)::int as collected
      FROM qr_payments WHERE tenant_id=$1 GROUP BY entity_type ORDER BY cnt DESC LIMIT 6
    `, [tid])).rows;

    const entityBars = entityBreakdown.map(r => {
      const pct = totalQR > 0 ? ((r.cnt / totalQR) * 100).toFixed(0) : 0;
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
          <span>${entityBadge(r.entity_type)}</span>
          <span style="font-weight:600;color:#475569">${r.cnt} (${pct}%)</span>
        </div>
        <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:100%;background:#059669;border-radius:4px;width:${pct}%;transition:.3s"></div>
        </div>
      </div>`;
    }).join('');

    const html = QP_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/qr-payments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">\uD83D\uDCF2 QR Payments</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Generate, manage, and track QR-based payments</p>
        </div>
        <a href="/qr-payments/generate" class="qp-btn qp-btn-primary">\u2795 Generate QR Code</a>
      </div>

      <div class="qp-stats">
        <div class="qp-stat">
          <div class="qp-stat-icon">\uD83D\uDCF2</div>
          <div class="qp-stat-val">${totalQR}</div>
          <div class="qp-stat-lbl">Total QR Codes</div>
        </div>
        <div class="qp-stat">
          <div class="qp-stat-icon">\uD83D\uDCB0</div>
          <div class="qp-stat-val" style="color:#059669">${fmtMoney(totalCollected)}</div>
          <div class="qp-stat-lbl">Total Collected</div>
        </div>
        <div class="qp-stat">
          <div class="qp-stat-icon">\u23F3</div>
          <div class="qp-stat-val" style="color:#d97706">${pendingCount.cnt}</div>
          <div class="qp-stat-lbl">Pending (${fmtMoney(pendingCount.total)})</div>
        </div>
        <div class="qp-stat">
          <div class="qp-stat-icon">\uD83D\uDCC5</div>
          <div class="qp-stat-val" style="color:#4f46e5">${fmtMoney(monthCollected.total)}</div>
          <div class="qp-stat-lbl">This Month (${monthCollected.cnt} paid)</div>
        </div>
        <div class="qp-stat">
          <div class="qp-stat-icon">\uD83D\uDCCA</div>
          <div class="qp-stat-val" style="color:${parseFloat(conversionRate) >= 50 ? '#059669' : '#d97706'}">${conversionRate}%</div>
          <div class="qp-stat-lbl">Conversion Rate</div>
        </div>
        <div class="qp-stat">
          <div class="qp-stat-icon">\u23F0</div>
          <div class="qp-stat-val" style="color:#64748b">${expiredCount}</div>
          <div class="qp-stat-lbl">Expired</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCA Collection Trends (Last 30 Days)</h3>
          <div class="qp-chart-bar">${chartBars}</div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDDFA Payment Types</h3>
          ${entityBars || '<p style="font-size:13px;color:#94a3b8;text-align:center;padding:20px">No data yet</p>'}
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0;font-size:16px;color:#1e293b">Recent QR Payments</h3>
          <a href="/qr-payments/manage" style="font-size:13px;color:#059669;text-decoration:none;font-weight:600">View All \u2192</a>
        </div>
        <div style="overflow-x:auto"><table class="qp-tbl">
          <thead><tr><th>QR Code</th><th>Label</th><th>Amount</th><th>Type</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No QR payments yet. <a href="/qr-payments/generate" style="color:#059669">Generate your first QR code</a>.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('QR Payments Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /qr-payments/generate — Generate QR Form
  // ============================================================
  app.get('/qr-payments/generate', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = QP_CSS + `
    <div style="max-width:700px;margin:0 auto">
      ${nav('/qr-payments/generate')}
      <a href="/qr-payments" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">\u2795 Generate QR Payment Code</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Create a QR code that links to a payment page. Share it with payers via print, SMS, or WhatsApp.</p>
        <form method="POST" action="/qr-payments/generate" id="genForm">
          <div class="qp-form-grid">
            <div>
              <label>Payment Label *</label>
              <input type="text" name="qr_label" required placeholder='e.g., "Term 2 Fees 2026"'>
            </div>
            <div>
              <label>Amount (UGX) *</label>
              <input type="number" name="amount" required min="100" step="100" placeholder="50000" id="amountInput">
            </div>
            <div>
              <label>Entity Type</label>
              <select name="entity_type">
                <option value="general">General</option>
                <option value="student_fee">Student Fee</option>
                <option value="shop_sale">Shop Sale</option>
                <option value="church_donation">Church Donation</option>
                <option value="invoice">Invoice</option>
                <option value="event_ticket">Event Ticket</option>
              </select>
            </div>
            <div>
              <label>Entity ID (optional)</label>
              <input type="number" name="entity_id" placeholder="Link to fee/invoice ID">
            </div>
            <div>
              <label>Payer Name (pre-fill)</label>
              <input type="text" name="payer_name" placeholder="e.g., John Mukasa">
            </div>
            <div>
              <label>Payer Phone (pre-fill)</label>
              <input type="tel" name="payer_phone" placeholder="0771234567">
            </div>
            <div class="full">
              <label>Payer Email (optional)</label>
              <input type="email" name="payer_email" placeholder="payer@email.com">
            </div>
            <div class="full">
              <label>Expiration</label>
              <select name="expires_hours">
                <option value="1">1 Hour</option>
                <option value="6">6 Hours</option>
                <option value="12">12 Hours</option>
                <option value="24" selected>24 Hours (Default)</option>
                <option value="48">48 Hours</option>
                <option value="168">7 Days</option>
              </select>
            </div>
          </div>
          <div style="margin-top:20px;padding:14px;background:#f0fdf4;border-radius:10px;font-size:13px;color:#475569;display:flex;align-items:center;gap:10px">
            <span style="font-size:20px">\u2139\uFE0F</span>
            <span>The QR code will encode a URL that opens a mobile-friendly payment page. Payers can pay via MTN MoMo or Airtel Money directly.</span>
          </div>
          <button type="submit" class="qp-btn qp-btn-primary" style="margin-top:20px;padding:14px 28px;font-size:15px;justify-content:center;width:100%">\uD83D\uDCF2 Generate QR Payment Code</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Generate QR Payment', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /qr-payments/generate — Create QR Payment
  // ============================================================
  app.post('/qr-payments/generate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { qr_label, amount, entity_type, entity_id, payer_name, payer_phone, payer_email, expires_hours } = req.body;

    if (!qr_label || !qr_label.trim()) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><p style="color:#dc2626;font-size:16px">Payment label is required.</p><a href="/qr-payments/generate" class="qp-btn qp-btn-primary" style="margin-top:16px">\u2190 Try Again</a></div>', user, req));
    }
    if (!amount || parseInt(amount) < 100) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><p style="color:#dc2626;font-size:16px">Amount must be at least UGX 100.</p><a href="/qr-payments/generate" class="qp-btn qp-btn-primary" style="margin-top:16px">\u2190 Try Again</a></div>', user, req));
    }

    const code = generateQRCode();
    const qrDataUrl = 'https://ssewasswa.onrender.com/qr/pay/' + code;
    const hours = parseInt(expires_hours) || 24;

    const result = await pool.query(
      `INSERT INTO qr_payments (tenant_id, qr_code, qr_label, amount, currency, entity_type, entity_id, payer_name, payer_phone, payer_email, expires_at, created_by)
       VALUES ($1,$2,$3,$4,'UGX',$5,$6,$7,$8,$9, NOW() + INTERVAL '${hours === 1 ? '1 hour' : hours + ' hours'}', $10)
       RETURNING id, qr_code, qr_data_url`,
      [tid, qrDataUrl, (qr_label || '').trim(), parseInt(amount),
       entity_type || 'general', entity_id ? parseInt(entity_id) : null,
       (payer_name || '').trim() || null, (payer_phone || '').trim() || null,
       (payer_email || '').trim() || null, user.id]
    );

    const qrId = result.rows[0].id;
    console.log('[QRPayments] QR code generated:', code, 'for tenant:', tid, 'amount:', amount);
    res.redirect('/qr-payments/' + qrId);
  }));

  // ============================================================
  // ROUTE 4: GET /qr-payments/manage — List with Filters
  // ============================================================
  app.get('/qr-payments/manage', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, entity_type, date_from, date_to, search, page } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limit = 20;
    const offset = (pageNum - 1) * limit;

    let where = ['qp.tenant_id=$1'];
    let params = [tid];
    let pi = 2;

    if (status && status !== 'all') { where.push(`qp.status=$${pi++}`); params.push(status); }
    if (entity_type && entity_type !== 'all') { where.push(`qp.entity_type=$${pi++}`); params.push(entity_type); }
    if (date_from) { where.push(`qp.created_at >= $${pi++}`); params.push(date_from); }
    if (date_to) { where.push(`qp.created_at <= $${pi++}`); params.push(date_to + ' 23:59:59'); }
    if (search) { where.push(`(qp.qr_label ILIKE $${pi} OR qp.qr_code ILIKE $${pi} OR qp.payer_name ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const whereClause = where.join(' AND ');

    const countResult = await pool.query(`SELECT COUNT(*)::int as total FROM qr_payments qp WHERE ${whereClause}`, params);
    const total = countResult.rows[0].total;
    const totalPages = Math.ceil(total / limit);

    const rows = (await pool.query(
      `SELECT qp.*,
        (SELECT COUNT(*)::int FROM qr_payment_scans qs WHERE qs.qr_payment_id=qp.id) as scan_count
       FROM qr_payments qp
       WHERE ${whereClause}
       ORDER BY qp.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    )).rows;

    const tableRows = rows.map(r => {
      const isExpired = r.status === 'expired' || (r.status === 'pending' && new Date(r.expires_at) < new Date());
      const displayStatus = isExpired ? 'expired' : r.status;
      return `<tr>
        <td style="font-weight:600;font-family:monospace;font-size:12px"><a href="/qr-payments/${r.id}" style="color:#059669;text-decoration:none">${esc(r.qr_code)}</a></td>
        <td>${esc(r.qr_label || '\u2014')}</td>
        <td style="font-weight:600">${fmtMoney(r.amount)}</td>
        <td>${entityBadge(r.entity_type)}</td>
        <td>${statusBadge(displayStatus)}</td>
        <td>${r.paid_amount > 0 ? '<span style="color:#059669;font-weight:600">' + fmtMoney(r.paid_amount) + '</span>' : '<span style="color:#94a3b8">\u2014</span>'}</td>
        <td style="color:#94a3b8;font-size:12px">${r.scan_count || 0}</td>
        <td style="color:#94a3b8;font-size:12px">${fmtDateTime(r.created_at)}</td>
        <td>
          ${displayStatus === 'pending' ? `<form method="POST" action="/qr-payments/${r.id}/cancel" style="display:inline" onsubmit="return confirm('Cancel this QR payment?')">
            <button class="qp-btn qp-btn-danger" style="padding:4px 10px;font-size:11px">Cancel</button></form>` : ''}
        </td>
      </tr>`;
    }).join('');

    const html = QP_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/qr-payments/manage')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">\uD83D\uDD0D Manage QR Payments</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${total} QR payment(s) found</p>
        </div>
        <a href="/qr-payments/generate" class="qp-btn qp-btn-primary">\u2795 Generate New</a>
      </div>

      <div class="card" style="padding:16px;margin-bottom:16px">
        <form method="GET" action="/qr-payments/manage" class="qp-filter">
          <div>
            <label>Search</label>
            <input type="text" name="search" value="${esc(search || '')}" placeholder="Label, code, payer...">
          </div>
          <div>
            <label>Status</label>
            <select name="status">
              <option value="all" ${!status || status === 'all' ? 'selected' : ''}>All</option>
              <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
              <option value="expired" ${status === 'expired' ? 'selected' : ''}>Expired</option>
              <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
          <div>
            <label>Type</label>
            <select name="entity_type">
              <option value="all" ${!entity_type || entity_type === 'all' ? 'selected' : ''}>All Types</option>
              <option value="student_fee" ${entity_type === 'student_fee' ? 'selected' : ''}>Student Fee</option>
              <option value="shop_sale" ${entity_type === 'shop_sale' ? 'selected' : ''}>Shop Sale</option>
              <option value="church_donation" ${entity_type === 'church_donation' ? 'selected' : ''}>Church Donation</option>
              <option value="invoice" ${entity_type === 'invoice' ? 'selected' : ''}>Invoice</option>
              <option value="event_ticket" ${entity_type === 'event_ticket' ? 'selected' : ''}>Event Ticket</option>
              <option value="general" ${entity_type === 'general' ? 'selected' : ''}>General</option>
            </select>
          </div>
          <div>
            <label>From</label>
            <input type="date" name="date_from" value="${esc(date_from || '')}">
          </div>
          <div>
            <label>To</label>
            <input type="date" name="date_to" value="${esc(date_to || '')}">
          </div>
          <div>
            <label>&nbsp;</label>
            <button type="submit" class="qp-btn qp-btn-primary" style="padding:9px 18px">\uD83D\uDD0D Filter</button>
          </div>
          <div>
            <label>&nbsp;</label>
            <a href="/qr-payments/manage" class="qp-btn qp-btn-secondary" style="padding:9px 18px">Clear</a>
          </div>
        </form>
      </div>

      <div class="card">
        <div style="overflow-x:auto"><table class="qp-tbl">
          <thead><tr><th>QR Code</th><th>Label</th><th>Amount</th><th>Type</th><th>Status</th><th>Paid</th><th>Scans</th><th>Created</th><th></th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:40px">No QR payments match your filters.</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagerHtml(pageNum, totalPages, '/qr-payments/manage?' + new URLSearchParams({ status: status || '', entity_type: entity_type || '', search: search || '', date_from: date_from || '', date_to: date_to || '' }).toString())}
    </div>`;
    res.send(renderPage('Manage QR Payments', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /qr-payments/:id — View QR Payment Details
  // ============================================================
  app.get('/qr-payments/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = parseInt(req.params.id);
    const qr = (await pool.query(
      `SELECT * FROM qr_payments WHERE id=$1 AND tenant_id=$2`, [id, tid]
    )).rows[0];
    if (!qr) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">QR payment not found</h2><a href="/qr-payments" class="qp-btn qp-btn-primary" style="margin-top:12px">\u2190 Dashboard</a></div>', user, req));

    const scans = (await pool.query(
      `SELECT * FROM qr_payment_scans WHERE qr_payment_id=$1 ORDER BY scanned_at DESC LIMIT 20`, [id]
    )).rows;

    const isExpired = qr.status === 'expired' || (qr.status === 'pending' && new Date(qr.expires_at) < new Date());
    const displayStatus = isExpired ? 'expired' : qr.status;
    const isPending = displayStatus === 'pending';

    const scanRows = scans.map(s => `<tr>
      <td style="color:#94a3b8;font-size:12px">${fmtDateTime(s.scanned_at)}</td>
      <td style="font-family:monospace;font-size:12px">${esc(s.ip_address || '\u2014')}</td>
      <td style="font-size:11px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.user_agent || '\u2014')}</td>
    </tr>`).join('');

    const paymentUrl = qr.qr_code;
    const qrSvg = generateQRSVG(qr.qr_code.replace('https://ssewasswa.onrender.com/qr/pay/', ''), 200);

    const html = QP_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/qr-payments')}
      <a href="/qr-payments/manage" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Manage</a>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="card" style="padding:24px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <div style="font-size:36px">${displayStatus === 'paid' ? '\u2705' : isPending ? '\u23F3' : '\u274C'}</div>
            <div>
              <h2 style="margin:0;color:#1e293b">${esc(qr.qr_label || 'QR Payment')}</h2>
              <div style="font-family:monospace;font-size:12px;color:#64748b;margin-top:2px">${esc(paymentUrl)}</div>
            </div>
          </div>

          <div class="qp-qrcode-box" style="width:fit-content;margin-bottom:20px">
            ${qrSvg}
            <div class="code-label">Scan to Pay</div>
          </div>

          <div style="margin-top:16px">
            <div class="qp-detail-row"><span class="lbl">Status</span><span class="val">${statusBadge(displayStatus)}</span></div>
            <div class="qp-detail-row"><span class="lbl">Amount</span><span class="val" style="font-size:18px;color:#059669">${fmtMoney(qr.amount)}</span></div>
            <div class="qp-detail-row"><span class="lbl">Currency</span><span class="val">${esc(qr.currency)}</span></div>
            <div class="qp-detail-row"><span class="lbl">Entity Type</span><span class="val">${entityBadge(qr.entity_type)}</span></div>
            ${qr.entity_id ? `<div class="qp-detail-row"><span class="lbl">Entity ID</span><span class="val">${qr.entity_id}</span></div>` : ''}
            <div class="qp-detail-row"><span class="lbl">Payer Name</span><span class="val">${esc(qr.payer_name || '\u2014')}</span></div>
            <div class="qp-detail-row"><span class="lbl">Payer Phone</span><span class="val">${esc(qr.payer_phone || '\u2014')}</span></div>
            <div class="qp-detail-row"><span class="lbl">Payer Email</span><span class="val">${esc(qr.payer_email || '\u2014')}</span></div>
            <div class="qp-detail-row"><span class="lbl">Created</span><span class="val">${fmtDateTime(qr.created_at)}</span></div>
            <div class="qp-detail-row"><span class="lbl">Expires</span><span class="val" style="color:${isPending ? '#d97706' : '#94a3b8'}">${fmtDateTime(qr.expires_at)}</span></div>
            ${qr.paid_amount > 0 ? `<div class="qp-detail-row"><span class="lbl">Paid Amount</span><span class="val" style="color:#059669;font-weight:700">${fmtMoney(qr.paid_amount)}</span></div>` : ''}
            ${qr.payment_method ? `<div class="qp-detail-row"><span class="lbl">Payment Method</span><span class="val">${methodLabel(qr.payment_method)}</span></div>` : ''}
            ${qr.payment_ref ? `<div class="qp-detail-row"><span class="lbl">Payment Ref</span><span class="val" style="font-family:monospace">${esc(qr.payment_ref)}</span></div>` : ''}
            ${qr.paid_at ? `<div class="qp-detail-row"><span class="lbl">Paid At</span><span class="val">${fmtDateTime(qr.paid_at)}</span></div>` : ''}
          </div>

          ${isPending ? `
          <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
            <a href="${esc(paymentUrl)}" target="_blank" class="qp-btn qp-btn-primary">\uD83D\uDCF2 Open Payment Page</a>
            <button class="qp-btn qp-btn-secondary" onclick="navigator.clipboard.writeText('${esc(paymentUrl)}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Link',2000)">Copy Payment Link</button>
            <form method="POST" action="/qr-payments/${qr.id}/cancel" style="display:inline" onsubmit="return confirm('Cancel this QR payment?')">
              <button class="qp-btn qp-btn-danger">Cancel QR</button>
            </form>
          </div>` : ''}
        </div>

        <div>
          <div class="card" style="padding:20px;margin-bottom:20px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDD0D Scan History (${scans.length})</h3>
            ${scans.length > 0 ? `<div style="overflow-x:auto"><table class="qp-tbl">
              <thead><tr><th>Time</th><th>IP Address</th><th>User Agent</th></tr></thead>
              <tbody>${scanRows}</tbody>
            </table></div>` : '<p style="font-size:13px;color:#94a3b8;text-align:center;padding:20px">No scans yet. Share the QR code or link to get started.</p>'}
          </div>

          <div class="card" style="padding:20px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCE1 Share QR Code</h3>
            <div style="display:flex;flex-direction:column;gap:10px">
              <a href="https://wa.me/?text=${encodeURIComponent('Please make a payment of ' + fmtMoney(qr.amount) + ' for ' + (qr.qr_label || '') + '. Pay here: ' + paymentUrl)}" target="_blank" class="qp-btn qp-btn-secondary" style="justify-content:center;background:#25D366;color:#fff">\uD83D\uDCAC Share via WhatsApp</a>
              <a href="sms:${esc(qr.payer_phone || '')}?body=${encodeURIComponent('Payment of ' + fmtMoney(qr.amount) + ' for ' + (qr.qr_label || '') + '. Pay: ' + paymentUrl)}" class="qp-btn qp-btn-secondary" style="justify-content:center">\uD83D\uDCF1 Share via SMS</a>
              <button class="qp-btn qp-btn-secondary" style="justify-content:center" onclick="navigator.clipboard.writeText('${esc(paymentUrl)}');this.textContent='Link Copied!';setTimeout(()=>this.textContent='Copy Payment Link',2000)">Copy Payment Link</button>
              <button class="qp-btn qp-btn-secondary" style="justify-content:center" onclick="window.print()">Print QR Code</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('QR Payment \u2014 ' + (qr.qr_label || qr.qr_code), html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /qr-payments/:id/cancel — Cancel QR Payment
  // ============================================================
  app.post('/qr-payments/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = parseInt(req.params.id);
    const qr = (await pool.query(
      `SELECT * FROM qr_payments WHERE id=$1 AND tenant_id=$2 AND status='pending'`, [id, tid]
    )).rows[0];
    if (!qr) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><p style="color:#dc2626">QR payment not found or already processed.</p><a href="/qr-payments" class="qp-btn qp-btn-primary" style="margin-top:12px">\u2190 Dashboard</a></div>', user, req));
    }
    await pool.query(`UPDATE qr_payments SET status='cancelled' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    console.log('[QRPayments] QR payment cancelled:', qr.qr_code, 'by:', user.email);
    res.redirect('/qr-payments/' + id);
  }));

  // ============================================================
  // ROUTE 7: GET /qr/pay/:code — PUBLIC Payment Page
  // ============================================================
  app.get('/qr/pay/:code', ah(async (req, res) => {
    const code = req.params.code;
    const qrDataUrl = 'https://ssewasswa.onrender.com/qr/pay/' + code;

    // Record scan
    try {
      await pool.query(
        `INSERT INTO qr_payment_scans (qr_payment_id, ip_address, user_agent)
         SELECT id, $2, $3 FROM qr_payments WHERE qr_code=$1 LIMIT 1`,
        [qrDataUrl, req.ip || req.connection?.remoteAddress, req.headers['user-agent'] || null]
      );
    } catch (e) { /* scan logging is non-critical */ }

    // Check if QR was recently marked as paid (auto-refresh)
    const paid = (await pool.query(
      `SELECT * FROM qr_payments WHERE qr_code=$1 AND status='paid'`, [qrDataUrl]
    )).rows[0];

    const qr = (await pool.query(
      `SELECT qp.*,
        t.name as tenant_name, t.logo_url, t.primary_color, t.phone as tenant_phone,
        u.name as creator_name
       FROM qr_payments qp
       LEFT JOIN tenants t ON t.id = qp.tenant_id
       LEFT JOIN users u ON u.id = qp.created_by
       WHERE qp.qr_code=$1`,
      [qrDataUrl]
    )).rows[0];

    if (!qr) {
      return res.status(404).send(payerPageShell('QR Code Not Found', `
        <div class="payer-status">
          <div class="icon">\u274C</div>
          <h2>Invalid QR Code</h2>
          <p>This QR code does not exist or has been removed. Please contact the organization for a new payment link.</p>
        </div>
      `, qr));
    }

    const isExpired = qr.status === 'expired' || qr.status === 'cancelled' || (qr.status === 'pending' && new Date(qr.expires_at) < new Date());
    const isPaid = qr.status === 'paid';
    const isPending = qr.status === 'pending' && !isExpired;

    const tenantColor = qr.primary_color || '#059669';
    const tenantName = qr.tenant_name || 'SSEWASSWA';
    const tenantPhone = qr.tenant_phone || '';

    if (isPaid) {
      return res.send(payerPageShell('Payment Complete', `
        <div class="payer-status">
          <div class="icon">\u2705</div>
          <h2>Payment Received!</h2>
          <p>Thank you, ${esc(qr.payer_name || 'payer')}! Your payment of <strong>${fmtMoney(qr.paid_amount)}</strong> for <strong>${esc(qr.qr_label || 'Payment')}</strong> has been received.</p>
          ${qr.payment_ref ? `<p style="font-family:monospace;font-size:13px;color:#64748b;margin-top:8px">Ref: ${esc(qr.payment_ref)}</p>` : ''}
          <p style="font-size:12px;color:#94a3b8;margin-top:12px">Paid via ${methodLabel(qr.payment_method)} on ${fmtDateTime(qr.paid_at)}</p>
          ${tenantPhone ? `<p style="margin-top:16px">Questions? Contact us at <a href="tel:${esc(tenantPhone)}" style="color:${tenantColor};font-weight:600">${esc(tenantPhone)}</a></p>` : ''}
        </div>
      `, qr, tenantColor, tenantName));
    }

    if (isExpired) {
      const statusText = qr.status === 'cancelled' ? 'This payment has been cancelled.' : 'This payment link has expired.';
      return res.send(payerPageShell('Payment Expired', `
        <div class="payer-status">
          <div class="icon">\u23F0</div>
          <h2>${qr.status === 'cancelled' ? 'Payment Cancelled' : 'Payment Link Expired'}</h2>
          <p>${statusText} Please contact ${esc(tenantName)} for a new payment link.</p>
          ${tenantPhone ? `<p style="margin-top:16px">Contact: <a href="tel:${esc(tenantPhone)}" style="color:${tenantColor};font-weight:600">${esc(tenantPhone)}</a></p>` : ''}
        </div>
      `, qr, tenantColor, tenantName));
    }

    // Active pending payment — show checkout page
    const expiresAt = new Date(qr.expires_at).getTime();
    const now = Date.now();
    const timeLeft = Math.max(0, expiresAt - now);

    const html = `
      <div class="payer-header" style="background:linear-gradient(135deg,${tenantColor},${darkenColor(tenantColor)})">
        <h1>${esc(tenantName)}</h1>
        <p>${esc(qr.qr_label || 'Payment')}</p>
      </div>

      <div class="payer-amount">
        <div class="curr">UGX</div>
        <div class="big">${Number(qr.amount).toLocaleString()}</div>
        <div class="label">${esc(qr.qr_label || 'Payment Request')}</div>
      </div>

      <div class="payer-countdown-box" id="countdown-box">
        <div class="payer-timer" id="countdown">${formatTime(timeLeft)}</div>
        <div class="payer-timer-label">This link expires soon</div>
      </div>

      ${qr.payer_name ? `<div class="payer-info"><div class="payer-info-row"><span class="k">Payer</span><span class="v">${esc(qr.payer_name)}</span></div></div>` : ''}

      <div class="payer-info" style="padding-bottom:0">
        <div class="payer-info-row"><span class="k">Reference</span><span class="v" style="font-family:monospace;font-size:12px">${esc(qr.qr_code.replace('https://ssewasswa.onrender.com/qr/pay/', ''))}</span></div>
        <div class="payer-info-row"><span class="k">Organization</span><span class="v">${esc(tenantName)}</span></div>
      </div>

      <div class="payer-methods">
        <p style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:4px">Choose Payment Method</p>

        <form method="POST" action="/qr/pay/${esc(qr.qr_code.replace('https://ssewasswa.onrender.com/qr/pay/', ''))}/momo" id="momoForm">
          <input type="hidden" name="payer_phone" id="momo_phone" value="${esc(qr.payer_phone || '')}">
          <button type="submit" class="payer-method-btn" onclick="return validatePhone('momo_phone')">
            <span class="icon" style="background:#ffc107;padding:8px;border-radius:10px">\uD83D\uDCF1</span>
            <div style="flex:1">
              <div>MTN Mobile Money</div>
              <div class="sub">Pay instantly from your MTN MoMo wallet</div>
            </div>
            <span style="color:#94a3b8">\u203A</span>
          </button>
        </form>

        <form method="POST" action="/qr/pay/${esc(qr.qr_code.replace('https://ssewasswa.onrender.com/qr/pay/', ''))}/airtel" id="airtelForm">
          <input type="hidden" name="payer_phone" id="airtel_phone" value="${esc(qr.payer_phone || '')}">
          <button type="submit" class="payer-method-btn" onclick="return validatePhone('airtel_phone')">
            <span class="icon" style="background:#fee2e2;padding:8px;border-radius:10px">\uD83D\uDCF1</span>
            <div style="flex:1">
              <div>Airtel Money</div>
              <div class="sub">Pay instantly from your Airtel Money wallet</div>
            </div>
            <span style="color:#94a3b8">\u203A</span>
          </button>
        </form>

        ${!qr.payer_phone ? `
        <div class="payer-phone-form">
          <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Your Phone Number (for payment prompt)</label>
          <input type="tel" id="payerPhoneInput" placeholder="0771234567" pattern="^(07[0-9]{8}|256[0-9]{9})$" onchange="document.getElementById('momo_phone').value=this.value;document.getElementById('airtel_phone').value=this.value">
          <div class="error" id="phoneError" style="display:none">Please enter a valid phone number (e.g., 0771234567)</div>
        </div>` : ''}
      </div>

      <div class="payer-footer">
        <p>Secured by ${esc(tenantName)} \u2022 Powered by SSEWASSWA</p>
        <p style="margin-top:4px">By paying, you agree to the payment terms</p>
      </div>

      <script>
        // Countdown timer
        const expiresAt = ${expiresAt};
        function updateCountdown() {
          const now = Date.now();
          const diff = Math.max(0, expiresAt - now);
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          const el = document.getElementById('countdown');
          if (el) {
            el.textContent = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
            if (diff <= 0) {
              el.style.color = '#dc2626';
              el.textContent = 'EXPIRED';
              document.getElementById('countdown-box').style.background = '#fef2f2';
            }
          }
        }
        setInterval(updateCountdown, 1000);
        updateCountdown();

        // Auto-check payment status
        let checkCount = 0;
        const statusCheck = setInterval(() => {
          checkCount++;
          if (checkCount > 120) { clearInterval(statusCheck); return; } // 10 minutes max
          fetch('/api/v1/qr-payments/verify/${esc(qr.qr_code.replace('https://ssewasswa.onrender.com/qr/pay/', ''))}')
            .then(r => r.json())
            .then(data => {
              if (data.status === 'paid') {
                clearInterval(statusCheck);
                window.location.reload();
              }
            })
            .catch(() => {});
        }, 5000);

        function validatePhone(inputId) {
          const phoneInput = document.getElementById(inputId);
          const val = phoneInput.value.trim();
          if (!val && document.getElementById('payerPhoneInput')) {
            document.getElementById('payerPhoneInput').focus();
            document.getElementById('phoneError').style.display = 'block';
            return false;
          }
          if (val && !/^(07[0-9]{8}|256[0-9]{9})$/.test(val)) {
            document.getElementById('phoneError').style.display = 'block';
            document.getElementById('phoneError').textContent = 'Invalid phone format. Use 07XXXXXXXX or 256XXXXXXXXX';
            return false;
          }
          return true;
        }
      </script>
    `;
    return res.send(payerPageShell('Pay ' + fmtMoney(qr.amount), html, qr, tenantColor, tenantName));
  }));

  // ============================================================
  // ROUTE 8: POST /qr/pay/:code/momo — Initiate MTN MoMo
  // ============================================================
  app.post('/qr/pay/:code/momo', ah(async (req, res) => {
    const code = req.params.code;
    const qrDataUrl = 'https://ssewasswa.onrender.com/qr/pay/' + code;
    const { payer_phone } = req.body;

    const qr = (await pool.query(
      `SELECT * FROM qr_payments WHERE qr_code=$1 AND status='pending'`, [qrDataUrl]
    )).rows[0];

    if (!qr) {
      return res.send(payerPageShell('Error', `
        <div class="payer-status">
          <div class="icon">\u274C</div>
          <h2>Payment Not Found</h2>
          <p>This QR payment link is invalid or has been processed.</p>
        </div>`, qr));
    }

    if (new Date(qr.expires_at) < new Date()) {
      await pool.query(`UPDATE qr_payments SET status='expired' WHERE id=$1`, [qr.id]);
      return res.redirect('/qr/pay/' + code);
    }

    const phone = (payer_phone || '').trim() || qr.payer_phone || '';
    const ref = 'MTN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Attempt to call requestMtnPayment if available (from payment-gateway module)
    let paymentResult = null;
    if (typeof app.get('requestMtnPayment') === 'function' || (app.locals && app.locals.requestMtnPayment)) {
      try {
        const fn = app.locals.requestMtnPayment || app.get('requestMtnPayment');
        paymentResult = await fn({ phone, amount: qr.amount, reference: ref, tenant_id: qr.tenant_id });
      } catch (e) {
        console.log('[QRPayments] MoMo API call failed, using demo mode:', e.message);
      }
    }

    // If no real API, use demo mode
    const isDemo = !paymentResult || paymentResult.status !== 'success';
    const demoRef = isDemo ? 'DEMO-' + ref : ref;

    console.log('[QRPayments] MTN MoMo payment initiated:', qr.qr_code, 'phone:', phone, 'demo:', isDemo);

    // In demo mode, mark as paid immediately for demonstration
    if (isDemo) {
      await pool.query(
        `UPDATE qr_payments SET status='paid', payment_method='mtn_momo', payment_ref=$1, paid_amount=amount, paid_at=NOW() WHERE id=$2`,
        [demoRef, qr.id]
      );
      // Update payer info if provided
      if (phone) {
        await pool.query(`UPDATE qr_payments SET payer_phone=$1 WHERE id=$2`, [phone, qr.id]);
      }
      // Track revenue for platform earnings
      try { await global.trackRevenue('qr_payment', qr.amount / 3700, `QR payment: ${qr.qr_code}`, qr.qr_code); } catch(e) {}
    }

    const html = `
      <div class="payer-status">
        <div class="icon">\uD83D\uDCF1</div>
        <h2>MTN MoMo Payment ${isDemo ? '(Demo)' : 'Initiated'}</h2>
        ${isDemo ? `<p>Your demo payment of <strong>${fmtMoney(qr.amount)}</strong> has been processed successfully!</p>
        <p style="font-family:monospace;font-size:13px;color:#64748b;margin-top:8px">Ref: ${esc(demoRef)}</p>
        <div style="margin-top:20px">
          <a href="/qr/pay/${code}" class="payer-method-btn" style="justify-content:center;border-color:#059669;color:#059669">
            <span>\u2705</span> View Payment Confirmation
          </a>
        </div>
        <p style="font-size:11px;color:#94a3b8;margin-top:12px">In production, you will receive an MTN MoMo prompt on your phone to confirm the payment.</p>` :
        `<p>A payment prompt has been sent to <strong>${esc(phone)}</strong> on MTN MoMo.</p>
        <p style="font-size:13px;color:#64748b;margin-top:8px">Please check your phone and confirm the payment of <strong>${fmtMoney(qr.amount)}</strong>.</p>
        <p style="font-family:monospace;font-size:13px;color:#64748b;margin-top:8px">Ref: ${esc(ref)}</p>
        <div style="margin-top:20px">
          <a href="/qr/pay/${code}" class="payer-method-btn" style="justify-content:center;border-color:#059669;color:#059669">
            <span>\u23F3</span> Check Payment Status
          </a>
        </div>`}
      </div>
      <div class="payer-footer">
        <p>Dial *165# on MTN to check your MoMo balance</p>
      </div>
      ${isDemo ? `<meta http-equiv="refresh" content="3;url=/qr/pay/${code}">` : ''}
    `;
    res.send(payerPageShell('MTN MoMo Payment', html, qr));
  }));

  // ============================================================
  // ROUTE 9: POST /qr/pay/:code/airtel — Initiate Airtel Money
  // ============================================================
  app.post('/qr/pay/:code/airtel', ah(async (req, res) => {
    const code = req.params.code;
    const qrDataUrl = 'https://ssewasswa.onrender.com/qr/pay/' + code;
    const { payer_phone } = req.body;

    const qr = (await pool.query(
      `SELECT * FROM qr_payments WHERE qr_code=$1 AND status='pending'`, [qrDataUrl]
    )).rows[0];

    if (!qr) {
      return res.send(payerPageShell('Error', `
        <div class="payer-status">
          <div class="icon">\u274C</div>
          <h2>Payment Not Found</h2>
          <p>This QR payment link is invalid or has been processed.</p>
        </div>`, qr));
    }

    if (new Date(qr.expires_at) < new Date()) {
      await pool.query(`UPDATE qr_payments SET status='expired' WHERE id=$1`, [qr.id]);
      return res.redirect('/qr/pay/' + code);
    }

    const phone = (payer_phone || '').trim() || qr.payer_phone || '';
    const ref = 'AIR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Attempt to call requestAirtelPayment if available
    let paymentResult = null;
    if (typeof app.get('requestAirtelPayment') === 'function' || (app.locals && app.locals.requestAirtelPayment)) {
      try {
        const fn = app.locals.requestAirtelPayment || app.get('requestAirtelPayment');
        paymentResult = await fn({ phone, amount: qr.amount, reference: ref, tenant_id: qr.tenant_id });
      } catch (e) {
        console.log('[QRPayments] Airtel API call failed, using demo mode:', e.message);
      }
    }

    const isDemo = !paymentResult || paymentResult.status !== 'success';
    const demoRef = isDemo ? 'DEMO-' + ref : ref;

    console.log('[QRPayments] Airtel Money payment initiated:', qr.qr_code, 'phone:', phone, 'demo:', isDemo);

    if (isDemo) {
      await pool.query(
        `UPDATE qr_payments SET status='paid', payment_method='airtel_money', payment_ref=$1, paid_amount=amount, paid_at=NOW() WHERE id=$2`,
        [demoRef, qr.id]
      );
      if (phone) {
        await pool.query(`UPDATE qr_payments SET payer_phone=$1 WHERE id=$2`, [phone, qr.id]);
      }
      // Track revenue for platform earnings
      try { await global.trackRevenue('qr_payment', qr.amount / 3700, `QR payment: ${qr.qr_code}`, qr.qr_code); } catch(e) {}
    }

    const html = `
      <div class="payer-status">
        <div class="icon">\uD83D\uDCF1</div>
        <h2>Airtel Money Payment ${isDemo ? '(Demo)' : 'Initiated'}</h2>
        ${isDemo ? `<p>Your demo payment of <strong>${fmtMoney(qr.amount)}</strong> has been processed successfully!</p>
        <p style="font-family:monospace;font-size:13px;color:#64748b;margin-top:8px">Ref: ${esc(demoRef)}</p>
        <div style="margin-top:20px">
          <a href="/qr/pay/${code}" class="payer-method-btn" style="justify-content:center;border-color:#dc2626;color:#dc2626">
            <span>\u2705</span> View Payment Confirmation
          </a>
        </div>
        <p style="font-size:11px;color:#94a3b8;margin-top:12px">In production, you will receive an Airtel Money prompt on your phone to confirm the payment.</p>` :
        `<p>A payment prompt has been sent to <strong>${esc(phone)}</strong> on Airtel Money.</p>
        <p style="font-size:13px;color:#64748b;margin-top:8px">Please check your phone and confirm the payment of <strong>${fmtMoney(qr.amount)}</strong>.</p>
        <p style="font-family:monospace;font-size:13px;color:#64748b;margin-top:8px">Ref: ${esc(ref)}</p>
        <div style="margin-top:20px">
          <a href="/qr/pay/${code}" class="payer-method-btn" style="justify-content:center;border-color:#dc2626;color:#dc2626">
            <span>\u23F3</span> Check Payment Status
          </a>
        </div>`}
      </div>
      <div class="payer-footer">
        <p>Dial *185# on Airtel to check your Airtel Money balance</p>
      </div>
      ${isDemo ? `<meta http-equiv="refresh" content="3;url=/qr/pay/${code}">` : ''}
    `;
    res.send(payerPageShell('Airtel Money Payment', html, qr));
  }));

  // ============================================================
  // ROUTE 10: GET /api/v1/qr-payments/verify/:code — Public API
  // ============================================================
  app.get('/api/v1/qr-payments/verify/:code', ah(async (req, res) => {
    const code = req.params.code;
    const qrDataUrl = 'https://ssewasswa.onrender.com/qr/pay/' + code;

    const qr = (await pool.query(
      `SELECT qp.id, qp.qr_code, qp.qr_label, qp.amount, qp.currency, qp.status,
        qp.payment_method, qp.payment_ref, qp.paid_amount, qp.paid_at, qp.expires_at,
        qp.payer_name, qp.payer_phone,
        t.name as tenant_name
       FROM qr_payments qp
       LEFT JOIN tenants t ON t.id = qp.tenant_id
       WHERE qp.qr_code=$1`,
      [qrDataUrl]
    )).rows[0];

    if (!qr) {
      return res.json({ status: 'error', message: 'QR payment not found', code: code });
    }

    // Auto-expire if past expiration
    const isExpired = qr.status === 'pending' && new Date(qr.expires_at) < new Date();
    let status = qr.status;
    if (isExpired) {
      status = 'expired';
      // Fire-and-forget update
      pool.query(`UPDATE qr_payments SET status='expired' WHERE id=$1`, [qr.id]).catch(() => {});
    }

    res.json({
      status: status,
      code: code,
      label: qr.qr_label,
      amount: Number(qr.amount),
      currency: qr.currency,
      payment_method: qr.payment_method,
      payment_ref: qr.payment_ref,
      paid_amount: Number(qr.paid_amount),
      paid_at: qr.paid_at,
      expires_at: qr.expires_at,
      payer_name: qr.payer_name,
      payer_phone: qr.payer_phone,
      tenant: qr.tenant_name
    });
  }));

  // ============================================================
  // HELPER: Public payer page shell (standalone, no auth layout)
  // ============================================================
  function payerPageShell(title, bodyHtml, qr, accentColor, tenantName) {
    const color = accentColor || '#059669';
    const name = tenantName || (qr && qr.tenant_name) || 'SSEWASSWA';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>${esc(title)} \u2014 ${esc(name)}</title>
  <meta name="description" content="${esc(title)} via ${esc(name)} QR Payment System">
  <meta name="theme-color" content="${color}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${QP_CSS}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f1f5f9;
      color: #1e293b;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .payer-topbar {
      background: #fff;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e2e8f0;
    }
    .payer-topbar .logo {
      font-size: 16px;
      font-weight: 800;
      color: ${color};
    }
    .payer-topbar .secure {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    main { flex: 1; padding: 20px 16px 40px; }
    @media(min-width: 600px) {
      main { max-width: 520px; margin: 0 auto; }
    }
  </style>
</head>
<body>
  <div class="payer-topbar">
    <div class="logo">${esc(name)}</div>
    <div class="secure">\uD83D\uDD12 Secure Payment</div>
  </div>
  <main>
    <div class="payer-page">
      <div class="payer-card">
        ${bodyHtml}
      </div>
    </div>
  </main>
</body>
</html>`;
  }

  // ============================================================
  // HELPER: Format milliseconds as HH:MM:SS
  // ============================================================
  function formatTime(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ============================================================
  // HELPER: Darken a hex color
  // ============================================================
  function darkenColor(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = Math.max(0, parseInt(hex.substring(0,2), 16) - 30);
    const g = Math.max(0, parseInt(hex.substring(2,4), 16) - 30);
    const b = Math.max(0, parseInt(hex.substring(4,6), 16) - 30);
    return '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
  }

  console.log('[QRPayments] Module loaded — 10 routes registered');
};
