// ============================================================
// DIGITAL GATE PASS MODULE — Multi-Tenant SaaS Platform
// QR-based gate pass, visitor management, exit passes, late
// arrivals, gate scanner, dashboard, parent notifications.
// ============================================================
// Usage in server.js:
//   const gatePass = require('./gate-pass');
//   const { esc, renderPage } = gatePass(app, pool, { renderPage, esc });
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDateTime = (d) => d ? fmtDate(d) + ' ' + fmtTime(d) : '\u2014';

function passStatusBadge(status) {
  const map = {
    active:     { bg: '#dcfce7', c: '#16a34a', l: '\uD83D\uDFE2 Active' },
    used:       { bg: '#dbeafe', c: '#2563eb', l: '\uD83D\uDD35 Used' },
    expired:    { bg: '#f1f5f9', c: '#64748b', l: '\u26AB Expired' },
    cancelled:  { bg: '#fee2e2', c: '#dc2626', l: '\uD83D\uDD34 Cancelled' },
    returned:   { bg: '#e0e7ff', c: '#4f46e5', l: '\uD83D\uDFE3 Returned' },
    checked_in: { bg: '#dcfce7', c: '#16a34a', l: '\uD83D\uDFE2 Checked In' },
    checked_out:{ bg: '#dbeafe', c: '#2563eb', l: '\uD83D\uDD35 Checked Out' }
  };
  const s = map[status] || { bg: '#f1f5f9', c: '#64748b', l: status || 'Unknown' };
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function reasonColor(reason) {
  const map = { medical: '#dc2626', early_pickup: '#f59e0b', event: '#7c3aed', other: '#64748b' };
  return map[reason] || map.other;
}

function reasonLabel(reason) {
  const map = { medical: '\uD83C\uDFE5 Medical', early_pickup: '\uD83D\uDE9A Early Pickup', event: '\uD83C\uDF89 Event', other: '\uD83D\uDCCB Other' };
  return map[reason] || reason || 'Other';
}

// ============================================================
// SIMPLE SVG QR CODE GENERATOR
// Generates a deterministic visual QR-like pattern from a string
// ============================================================
function generateQRSvg(code, size) {
  size = size || 150;
  const cellSize = Math.max(4, Math.floor(size / 25));
  const grid = 25;
  const offset = Math.floor((size - grid * cellSize) / 2);

  // Deterministic hash-based pattern
  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function pseudoRandom(seed, idx) {
    const x = Math.sin(seed + idx * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  const seed = hashCode(code || 'default');
  const modules = [];

  // Generate pattern
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      // Finder patterns (top-left, top-right, bottom-left)
      const isFinderTL = row < 7 && col < 7;
      const isFinderTR = row < 7 && col >= grid - 7;
      const isFinderBL = row >= grid - 7 && col < 7;

      if (isFinderTL || isFinderTR || isFinderBL) {
        const localR = isFinderBL ? row - (grid - 7) : row;
        const localC = isFinderTR ? col - (grid - 7) : (isFinderBL ? col : col);
        const isOuter = localR === 0 || localR === 6 || localC === 0 || localC === 6;
        const isInner = localR >= 2 && localR <= 4 && localC >= 2 && localC <= 4;
        if (isOuter || isInner) {
          modules.push({ r: row, c: col });
        }
      } else if (pseudoRandom(seed, row * grid + col) > 0.52) {
        modules.push({ r: row, c: col });
      }
    }
  }

  const rects = modules.map(m =>
    `<rect x="${offset + m.c * cellSize}" y="${offset + m.r * cellSize}" width="${cellSize}" height="${cellSize}" rx="1"/>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR Code: ${code}">
    <rect width="${size}" height="${size}" fill="#ffffff" rx="8"/>
    <g fill="#1e1b4b">${rects}</g>
  </svg>`;
}

// ============================================================
// SVG BAR CHART — Exits by reason
// ============================================================
function generateReasonChart(data) {
  if (!data || !data.length) {
    return `<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">No exit data available for chart</div>`;
  }
  const maxVal = Math.max(...data.map(d => d.cnt), 1);
  const colors = ['#4f46e5', '#7c3aed', '#f59e0b', '#64748b', '#0891b2', '#dc2626', '#059669'];
  const barWidth = Math.max(40, Math.min(80, 500 / data.length));
  const chartHeight = 200;
  const labelSpace = 80;
  const svgWidth = labelSpace + data.length * (barWidth + 20) + 40;

  let bars = '';
  let labels = '';
  let values = '';
  let gridLines = '';

  for (let i = 0; i <= 4; i++) {
    const y = 10 + (chartHeight / 4) * i;
    const val = Math.round(maxVal - (maxVal / 4) * i);
    gridLines += `<line x1="${labelSpace}" y1="${y}" x2="${svgWidth - 10}" y2="${y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>`;
    gridLines += `<text x="${labelSpace - 8}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">${val}</text>`;
  }

  data.forEach((d, i) => {
    const barHeight = Math.max(4, (d.cnt / maxVal) * chartHeight);
    const x = labelSpace + 10 + i * (barWidth + 20);
    const y = 10 + chartHeight - barHeight;
    const color = colors[i % colors.length];
    const label = (d.reason || 'other').replace(/_/g, ' ');

    bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4" opacity="0.9">
      <title>${label}: ${d.cnt}</title></rect>`;
    labels += `<text x="${x + barWidth / 2}" y="${chartHeight + 28}" text-anchor="middle" fill="#475569" font-size="10" font-family="system-ui,sans-serif">${label.length > 10 ? label.substring(0, 10) + '..' : label}</text>`;
    values += `<text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" fill="#1e293b" font-size="12" font-weight="700" font-family="system-ui,sans-serif">${d.cnt}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${chartHeight + 50}" width="100%" height="auto" role="img" aria-label="Bar chart of exits by reason">
    <rect width="${svgWidth}" height="${chartHeight + 50}" fill="#ffffff" rx="8"/>
    ${gridLines}
    ${bars}
    ${values}
    ${labels}
  </svg>`;
}

// ============================================================
// SHARED CSS
// ============================================================
const GP_CSS = `<style>
.gp-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.gp-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.gp-nav a:hover{background:#e2e8f0}.gp-nav a.active{background:#4f46e5;color:#fff}
.gp-table{width:100%;border-collapse:collapse;font-size:13px}
.gp-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e0e7ff;color:#4f46e5;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f5f3ff}
.gp-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.gp-table tr:hover{background:#f8fafc}
.gp-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.gp-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.gp-filter input,.gp-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.gp-filter input:focus,.gp-filter select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px #e0e7ff}
.gp-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.gp-form input,.gp-form select,.gp-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit}
.gp-form input:focus,.gp-form select:focus,.gp-form textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px #e0e7ff}
.gp-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.gp-stat{background:#fff;border:1px solid #e0e7ff;border-radius:14px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(79,70,229,0.06)}
.gp-stat-num{font-size:28px;font-weight:800;color:#4f46e5;line-height:1.1}
.gp-stat-label{font-size:11px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
.gp-badge{border:3px solid #4f46e5;border-radius:16px;padding:24px;max-width:350px;background:#fff;box-shadow:0 4px 12px rgba(79,70,229,0.1)}
.gp-badge-header{background:#4f46e5;color:#fff;padding:12px 16px;border-radius:10px;text-align:center;margin-bottom:16px}
.gp-card{background:#fff;border:1px solid #e0e7ff;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(79,70,229,0.06)}
.gp-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:16px}
.gp-alert-success{background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0}
.gp-alert-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
.gp-alert-warning{background:#fef3c7;color:#b45309;border:1px solid #fde68a}
.gp-scanner-input{font-size:24px !important;padding:16px 20px !important;text-align:center;letter-spacing:2px;border-color:#4f46e5 !important;border-width:3px !important}
.gp-late-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.gp-late-track{flex:1;height:22px;background:#f1f5f9;border-radius:6px;overflow:hidden}
.gp-late-fill{height:100%;border-radius:6px;transition:width .3s ease}
@media(max-width:768px){.gp-grid{grid-template-columns:1fr}.gp-nav{gap:4px}.gp-nav a{padding:6px 10px;font-size:11px}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function gatePassModule(app, pool, opts) {
  opts = opts || {};

  // -- esc helper --------------------------------------------------------
  const esc = opts.esc || function(s) {
    return String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
      .replace(/[&<>"']/g, function(m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
      });
  };

  // -- renderPage from opts or default ------------------------------------
  const renderPage = opts.renderPage || function(title, body, user, req) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - Gate Pass</title></head><body>${body}</body></html>`;
  };

  // -- async handler wrapper ----------------------------------------------
  const ah = function(fn) {
    return function(req, res, next) {
      Promise.resolve(fn(req, res, next)).catch(function(err) {
        console.error('[GatePass] Route error:', err.message || err);
        if (!res.headersSent) res.status(500).send('Internal Server Error');
      });
    };
  };

  // -- auth middleware ----------------------------------------------------
  const requireAuth = function(req, res, next) {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };

  // -- audit logger -------------------------------------------------------
  const audit = function(action, details, userId, tenantId) {
    console.log(`[GatePass Audit] ${action} | User: ${userId || '-'} | Tenant: ${tenantId || '-'} | ${details || ''}`);
    // In production, persist to audit_logs table
  };

  // -- queueEmail placeholder ---------------------------------------------
  function queueEmail(to, subject, body, tenantId) {
    console.log(`[GatePass Email] TO: ${to} | Subject: ${subject} | Tenant: ${tenantId || '-'}`);
    audit('email_queued', `To: ${to}, Subject: ${subject}`, null, tenantId);
    // Placeholder: in production, insert into email_queue table
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async function() {
    let client = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      client = await pool.connect().catch(function() { return null; });
      if (client) break;
      console.warn('[GatePass] DB connection attempt ' + attempt + '/3 failed, retrying...');
      await new Promise(function(r) { setTimeout(r, 3000); });
    }
    if (!client) { console.error('[GatePass] Cannot connect to DB for migrations'); return; }
    try {
      // -- Table 1: gate_passes (student exit passes) --------------------
      await client.query(`CREATE TABLE IF NOT EXISTS gate_passes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
        student_name VARCHAR(255) NOT NULL,
        reason VARCHAR(50) NOT NULL DEFAULT 'other',
        destination VARCHAR(255),
        expected_return TIMESTAMPTZ,
        actual_return TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'active',
        qr_code VARCHAR(255) NOT NULL,
        approved_by INTEGER REFERENCES users(id),
        gate_used_by INTEGER REFERENCES users(id),
        gate_used_at TIMESTAMPTZ,
        notes TEXT,
        parent_notified BOOLEAN DEFAULT false,
        parent_notified_at TIMESTAMPTZ,
        parent_email VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- Table 2: visitor_passes ----------------------------------------
      await client.query(`CREATE TABLE IF NOT EXISTS visitor_passes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(30),
        email VARCHAR(255),
        purpose VARCHAR(255) NOT NULL,
        person_visiting VARCHAR(255),
        id_type VARCHAR(50),
        id_number VARCHAR(100),
        company VARCHAR(255),
        qr_code VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        check_in_time TIMESTAMPTZ,
        check_out_time TIMESTAMPTZ,
        badge_printed BOOLEAN DEFAULT false,
        vehicle_plate VARCHAR(30),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )`);

      // -- Table 3: late_arrivals -----------------------------------------
      await client.query(`CREATE TABLE IF NOT EXISTS late_arrivals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
        student_name VARCHAR(255) NOT NULL,
        arrival_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        minutes_late INTEGER NOT NULL DEFAULT 0,
        reason VARCHAR(255),
        recorded_by INTEGER REFERENCES users(id),
        class_name VARCHAR(100),
        notes TEXT,
        parent_notified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- ALTER TABLE gate_passes ----------------------------------------
      var gpCols = [
        ['student_name','VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['reason','VARCHAR(50) NOT NULL DEFAULT \'other\''],
        ['destination','VARCHAR(255)'],
        ['expected_return','TIMESTAMPTZ'],
        ['actual_return','TIMESTAMPTZ'],
        ['status','VARCHAR(20) DEFAULT \'active\''],
        ['qr_code','VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['approved_by','INTEGER'],
        ['gate_used_by','INTEGER'],
        ['gate_used_at','TIMESTAMPTZ'],
        ['notes','TEXT'],
        ['parent_notified','BOOLEAN DEFAULT false'],
        ['parent_notified_at','TIMESTAMPTZ'],
        ['parent_email','VARCHAR(255)'],
        ['updated_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (var i = 0; i < gpCols.length; i++) {
        try { await client.query('ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS ' + gpCols[i][0] + ' ' + gpCols[i][1]); } catch(e) {}
      }

      // -- ALTER TABLE visitor_passes -------------------------------------
      var vpCols = [
        ['phone','VARCHAR(30)'],['email','VARCHAR(255)'],
        ['purpose','VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['person_visiting','VARCHAR(255)'],
        ['id_type','VARCHAR(50)'],['id_number','VARCHAR(100)'],
        ['company','VARCHAR(255)'],['qr_code','VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['status','VARCHAR(20) DEFAULT \'active\''],
        ['check_in_time','TIMESTAMPTZ'],['check_out_time','TIMESTAMPTZ'],
        ['badge_printed','BOOLEAN DEFAULT false'],
        ['vehicle_plate','VARCHAR(30)'],['notes','TEXT'],['expires_at','TIMESTAMPTZ']
      ];
      for (var j = 0; j < vpCols.length; j++) {
        try { await client.query('ALTER TABLE visitor_passes ADD COLUMN IF NOT EXISTS ' + vpCols[j][0] + ' ' + vpCols[j][1]); } catch(e) {}
      }

      // -- ALTER TABLE late_arrivals --------------------------------------
      var laCols = [
        ['student_name','VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['minutes_late','INTEGER NOT NULL DEFAULT 0'],
        ['reason','VARCHAR(255)'],
        ['recorded_by','INTEGER'],
        ['class_name','VARCHAR(100)'],
        ['notes','TEXT'],
        ['parent_notified','BOOLEAN DEFAULT false']
      ];
      for (var k = 0; k < laCols.length; k++) {
        try { await client.query('ALTER TABLE late_arrivals ADD COLUMN IF NOT EXISTS ' + laCols[k][0] + ' ' + laCols[k][1]); } catch(e) {}
      }

      // -- Indexes -------------------------------------------------------
      await client.query('CREATE INDEX IF NOT EXISTS idx_gp_tenant ON gate_passes(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_gp_status ON gate_passes(tenant_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_gp_student ON gate_passes(tenant_id, student_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_gp_date ON gate_passes(tenant_id, created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_gp_qr ON gate_passes(tenant_id, qr_code)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_vp_tenant ON visitor_passes(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_vp_status ON visitor_passes(tenant_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_vp_qr ON visitor_passes(tenant_id, qr_code)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_vp_date ON visitor_passes(tenant_id, created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_la_tenant ON late_arrivals(tenant_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_la_student ON late_arrivals(tenant_id, student_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_la_date ON late_arrivals(tenant_id, arrival_time)');

      console.log('[GatePass] Migrations applied successfully');
    } catch (e) {
      console.error('[GatePass] Migration error:', e.message);
    } finally {
      client.release();
    }
  })();

  // ============================================================
  // NAVIGATION HELPER
  // ============================================================
  function nav(active) {
    return `<div class="gp-nav" role="navigation" aria-label="Gate Pass Navigation">
      <a href="/gate-pass" class="${active === 'dash' ? 'active' : ''}">\uD83D\uDCCA Dashboard</a>
      <a href="/gate-pass/exit-pass" class="${active === 'exit' ? 'active' : ''}">\uD83D\uDEAA Exit Pass</a>
      <a href="/gate-pass/visitor" class="${active === 'visitor' ? 'active' : ''}">\uD83D\uDC65 Visitor Pass</a>
      <a href="/gate-pass/scanner" class="${active === 'scanner' ? 'active' : ''}">\uD83D\uDD0D Scanner</a>
      <a href="/gate-pass/history" class="${active === 'history' ? 'active' : ''}">\uD83D\uDCDC History</a>
      <a href="/gate-pass/late" class="${active === 'late' ? 'active' : ''}">\u23F0 Late Arrival</a>
    </div>`;
  }

  // ============================================================
  // ROUTE 1: GET /gate-pass — Dashboard
  // ============================================================
  app.get('/gate-pass', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    var exitsToday = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM gate_passes WHERE tenant_id=$1 AND created_at >= CURRENT_DATE', [tid]
    )).rows[0].cnt;

    var activePasses = (await pool.query(
      "SELECT COUNT(*)::int as cnt FROM gate_passes WHERE tenant_id=$1 AND status='active'", [tid]
    )).rows[0].cnt;

    var visitorsToday = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM visitor_passes WHERE tenant_id=$1 AND created_at >= CURRENT_DATE', [tid]
    )).rows[0].cnt;

    var activeVisitors = (await pool.query(
      "SELECT COUNT(*)::int as cnt FROM visitor_passes WHERE tenant_id=$1 AND status='checked_in'", [tid]
    )).rows[0].cnt;

    var lateToday = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM late_arrivals WHERE tenant_id=$1 AND arrival_time >= CURRENT_DATE', [tid]
    )).rows[0].cnt;

    var chronicLate = (await pool.query(
      'SELECT COUNT(DISTINCT student_id)::int as cnt FROM late_arrivals WHERE tenant_id=$1 AND arrival_time >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY student_id HAVING COUNT(*) >= 3', [tid]
    )).rows.length;

    // Recent passes for quick view
    var recentPasses = (await pool.query(
      "SELECT gp.*, s.first_name, s.last_name FROM gate_passes gp LEFT JOIN students s ON s.id = gp.student_id WHERE gp.tenant_id=$1 ORDER BY gp.created_at DESC LIMIT 8", [tid]
    )).rows;

    var recentVisitors = (await pool.query(
      "SELECT * FROM visitor_passes WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5", [tid]
    )).rows;

    var recentRows = recentPasses.map(function(p) {
      var name = p.first_name ? (esc(p.first_name) + ' ' + esc(p.last_name || '')) : esc(p.student_name);
      return `<tr>
        <td><a href="/gate-pass/view/${p.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">GP-${String(p.id).padStart(4,'0')}</a></td>
        <td>${name}</td>
        <td>${reasonLabel(p.reason)}</td>
        <td>${passStatusBadge(p.status)}</td>
        <td style="font-size:12px">${fmtDateTime(p.created_at)}</td>
      </tr>`;
    }).join('');

    var visitorRows = recentVisitors.map(function(v) {
      return `<tr>
        <td style="font-weight:600">${esc(v.full_name)}</td>
        <td>${esc(v.purpose)}</td>
        <td>${passStatusBadge(v.status)}</td>
        <td style="font-size:12px">${fmtDateTime(v.created_at)}</td>
      </tr>`;
    }).join('');

    var html = GP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b">\uD83D\uDEAA Digital Gate Pass</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">QR-based gate pass and visitor management system</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/gate-pass/exit-pass" style="padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:13px">\uD83D\uDEAA New Exit Pass</a>
          <a href="/gate-pass/visitor" style="padding:10px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:13px">\uD83D\uDC65 Register Visitor</a>
        </div>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="gp-stat"><div class="gp-stat-num">${exitsToday}</div><div class="gp-stat-label">Exits Today</div></div>
        <div class="gp-stat"><div class="gp-stat-num" style="color:#16a34a">${activePasses}</div><div class="gp-stat-label">Active Passes</div></div>
        <div class="gp-stat"><div class="gp-stat-num" style="color:#7c3aed">${visitorsToday}</div><div class="gp-stat-label">Visitors Today</div></div>
        <div class="gp-stat"><div class="gp-stat-num" style="color:#0891b2">${activeVisitors}</div><div class="gp-stat-label">Visitors In</div></div>
        <div class="gp-stat"><div class="gp-stat-num" style="color:#f59e0b">${lateToday}</div><div class="gp-stat-label">Late Arrivals</div></div>
        <div class="gp-stat"><div class="gp-stat-num" style="color:#dc2626">${chronicLate}</div><div class="gp-stat-label">Chronic Late</div></div>
      </div>

      <!-- Recent tables -->
      <div class="gp-grid">
        <div class="gp-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDEAA Recent Exit Passes</h3>
            <a href="/gate-pass/history" style="font-size:12px;color:#4f46e5;text-decoration:none">View All \u2192</a>
          </div>
          <div style="overflow-x:auto"><table class="gp-table">
            <thead><tr><th>Pass</th><th>Student</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>${recentRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No passes yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="gp-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDC65 Recent Visitors</h3>
            <a href="/gate-pass/history?type=visitor" style="font-size:12px;color:#4f46e5;text-decoration:none">View All \u2192</a>
          </div>
          <div style="overflow-x:auto"><table class="gp-table">
            <thead><tr><th>Visitor</th><th>Purpose</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>${visitorRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:30px">No visitors today</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Gate Pass Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /gate-pass/exit-pass — Create Exit Pass
  // ============================================================
  app.get('/gate-pass/exit-pass', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var success = req.query.success;

    var students = (await pool.query(
      'SELECT id, first_name, last_name, admission_number, class_name FROM students WHERE tenant_id=$1 ORDER BY last_name, first_name LIMIT 500', [tid]
    )).rows;

    var studentOpts = students.map(function(s) {
      return '<option value="' + s.id + '">' + esc(s.last_name || '') + ', ' + esc(s.first_name || '') + ' (' + esc(s.admission_number || s.id) + ')' + (s.class_name ? ' [' + esc(s.class_name) + ']' : '') + '</option>';
    }).join('');

    var alertHtml = '';
    if (success) {
      alertHtml = '<div class="gp-alert gp-alert-success">\u2705 ' + esc(success) + '</div>';
    }

    var html = GP_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('exit')}
      <a href="/gate-pass" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Dashboard</a>
      ${alertHtml}
      <div class="gp-card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">\uD83D\uDEAA Create Student Exit Pass</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Authorize a student to leave campus. A QR code will be generated.</p>
        <form method="POST" action="/gate-pass/exit-pass" class="gp-form" style="display:flex;flex-direction:column;gap:16px" novalidate>
          <div class="gp-grid">
            <div>
              <label for="ep_student">Student *</label>
              <select name="student_id" id="ep_student" required>
                <option value="">Select student...</option>
                ${studentOpts}
              </select>
            </div>
            <div>
              <label for="ep_reason">Reason *</label>
              <select name="reason" id="ep_reason" required>
                <option value="medical">\uD83C\uDFE5 Medical</option>
                <option value="early_pickup">\uD83D\uDE9A Early Pickup</option>
                <option value="event">\uD83C\uDF89 Event</option>
                <option value="other">\uD83D\uDCCB Other</option>
              </select>
            </div>
          </div>
          <div class="gp-grid">
            <div>
              <label for="ep_dest">Destination</label>
              <input type="text" name="destination" id="ep_dest" placeholder="Where is the student going?">
            </div>
            <div>
              <label for="ep_return">Expected Return Time</label>
              <input type="datetime-local" name="expected_return" id="ep_return">
            </div>
          </div>
          <div>
            <label for="ep_parent">Parent/Guardian Email (for notification)</label>
            <input type="email" name="parent_email" id="ep_parent" placeholder="parent@email.com">
          </div>
          <div>
            <label for="ep_notes">Notes</label>
            <textarea name="notes" id="ep_notes" rows="3" placeholder="Additional details..."></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" style="padding:12px 28px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\u2709\uFE0F Generate Exit Pass</button>
            <a href="/gate-pass" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Exit Pass', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /gate-pass/exit-pass — Save Exit Pass
  // ============================================================
  app.post('/gate-pass/exit-pass', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var studentId = body.student_id;
    var reason = body.reason || 'other';
    var destination = (body.destination || '').trim();
    var expectedReturn = body.expected_return || null;
    var parentEmail = (body.parent_email || '').trim() || null;
    var notes = (body.notes || '').trim() || null;

    if (!studentId) {
      return res.redirect('/gate-pass/exit-pass');
    }

    // Get student info
    var student = (await pool.query(
      'SELECT first_name, last_name, guardian_email, guardian_phone FROM students WHERE id=$1 AND tenant_id=$2', [studentId, tid]
    )).rows[0];

    if (!student) {
      return res.redirect('/gate-pass/exit-pass');
    }

    var studentName = (student.first_name || '') + ' ' + (student.last_name || '');
    var qrCode = 'EXIT-' + Date.now() + '-' + studentId;
    var parentAddr = parentEmail || student.guardian_email || null;

    var result = await pool.query(
      `INSERT INTO gate_passes (tenant_id, student_id, student_name, reason, destination, expected_return, status, qr_code, approved_by, parent_email, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10) RETURNING id`,
      [tid, studentId, studentName.trim(), reason, destination || null, expectedReturn || null, qrCode, user.id, parentAddr, notes]
    );

    var passId = result.rows[0].id;
    audit('exit_pass_created', 'Pass #' + passId + ' for ' + studentName.trim(), user.id, tid);

    // Parent notification
    if (parentAddr) {
      var subject = 'Exit Pass: ' + studentName.trim() + ' - ' + reasonLabel(reason);
      var emailBody = 'Your child ' + studentName.trim() + ' has been issued an exit pass.\nReason: ' + reason + '\nDestination: ' + (destination || 'Not specified') + '\nExpected return: ' + (expectedReturn ? fmtDateTime(expectedReturn) : 'Not specified') + '\nPass ID: GP-' + String(passId).padStart(4, '0');
      queueEmail(parentAddr, subject, emailBody, tid);
      await pool.query(
        'UPDATE gate_passes SET parent_notified=true, parent_notified_at=NOW() WHERE id=$1 AND tenant_id=$2',
        [passId, tid]
      );
    }

    res.redirect('/gate-pass/exit-pass?success=' + encodeURIComponent('Exit pass GP-' + String(passId).padStart(4, '0') + ' created for ' + studentName.trim()));
  }));

  // ============================================================
  // ROUTE 4: GET /gate-pass/view/:id — View Exit Pass with QR
  // ============================================================
  app.get('/gate-pass/view/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var passId = req.params.id;

    var pass = (await pool.query(
      'SELECT * FROM gate_passes WHERE id=$1 AND tenant_id=$2', [passId, tid]
    )).rows[0];

    if (!pass) {
      return res.status(404).send('<h1>Pass not found</h1>');
    }

    var name = pass.student_name || 'Unknown Student';
    var qrSvg = generateQRSvg(pass.qr_code, 180);
    var canUse = pass.status === 'active';

    var html = GP_CSS + `<div style="max-width:600px;margin:0 auto;text-align:center">
      <a href="/gate-pass" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Dashboard</a>
      <div class="gp-badge" style="margin:0 auto">
        <div class="gp-badge-header">
          <div style="font-size:18px;font-weight:800">STUDENT EXIT PASS</div>
          <div style="font-size:12px;margin-top:2px">GP-${String(pass.id).padStart(4, '0')}</div>
        </div>
        <div style="margin:16px 0">${qrSvg}</div>
        <div style="font-size:18px;font-weight:700;color:#1e293b;margin-bottom:4px">${esc(name)}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:12px">${reasonLabel(pass.reason)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left;font-size:13px">
          <div><strong style="color:#4f46e5">Destination:</strong><br>${esc(pass.destination || 'Not specified')}</div>
          <div><strong style="color:#4f46e5">Expected Return:</strong><br>${fmtDateTime(pass.expected_return)}</div>
          <div><strong style="color:#4f46e5">Created:</strong><br>${fmtDateTime(pass.created_at)}</div>
          <div><strong style="color:#4f46e5">Status:</strong><br>${passStatusBadge(pass.status)}</div>
        </div>
        ${canUse ? `<form method="POST" action="/gate-pass/use/${pass.id}" style="margin-top:16px">
          <button type="submit" style="padding:12px 32px;background:#16a34a;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer" aria-label="Mark pass as used at gate">\u2705 Mark as Used at Gate</button>
        </form>` : ''}
      </div>
    </div>`;
    res.send(renderPage('Exit Pass GP-' + String(pass.id).padStart(4, '0'), html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /gate-pass/use/:id — Mark pass as used
  // ============================================================
  app.post('/gate-pass/use/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var passId = req.params.id;

    var result = await pool.query(
      "UPDATE gate_passes SET status='used', gate_used_by=$1, gate_used_at=NOW(), updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND status='active' RETURNING id",
      [user.id, passId, tid]
    );

    if (result.rows.length) {
      audit('exit_pass_used', 'Pass #' + passId + ' marked as used at gate', user.id, tid);
    }

    res.redirect('/gate-pass/view/' + passId);
  }));

  // ============================================================
  // ROUTE 6: POST /gate-pass/expire/:id — Expire a pass
  // ============================================================
  app.post('/gate-pass/expire/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, passId = req.params.id;
    await pool.query(
      "UPDATE gate_passes SET status='expired', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='active'",
      [passId, tid]
    );
    audit('exit_pass_expired', 'Pass #' + passId + ' expired', user.id, tid);
    res.redirect('/gate-pass/view/' + passId);
  }));

  // ============================================================
  // ROUTE 7: GET /gate-pass/visitor — Create Visitor Pass
  // ============================================================
  app.get('/gate-pass/visitor', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var success = req.query.success;

    var alertHtml = success
      ? '<div class="gp-alert gp-alert-success">\u2705 ' + esc(success) + '</div>'
      : '';

    var html = GP_CSS + `<div style="max-width:750px;margin:0 auto">
      ${nav('visitor')}
      <a href="/gate-pass" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Dashboard</a>
      ${alertHtml}
      <div class="gp-card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">\uD83D\uDC65 Register Visitor</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Register a visitor and generate a QR-coded badge. Auto-expires at end of day.</p>
        <form method="POST" action="/gate-pass/visitor" class="gp-form" style="display:flex;flex-direction:column;gap:16px" novalidate>
          <div class="gp-grid">
            <div>
              <label for="vis_name">Full Name *</label>
              <input type="text" name="full_name" id="vis_name" required placeholder="Visitor full name">
            </div>
            <div>
              <label for="vis_phone">Phone *</label>
              <input type="tel" name="phone" id="vis_phone" required placeholder="+1 234 567 890">
            </div>
          </div>
          <div class="gp-grid">
            <div>
              <label for="vis_email">Email</label>
              <input type="email" name="email" id="vis_email" placeholder="visitor@email.com">
            </div>
            <div>
              <label for="vis_company">Company / Organization</label>
              <input type="text" name="company" id="vis_company" placeholder="Company name">
            </div>
          </div>
          <div class="gp-grid">
            <div>
              <label for="vis_purpose">Purpose of Visit *</label>
              <select name="purpose" id="vis_purpose" required>
                <option value="meeting">Meeting</option>
                <option value="delivery">Delivery</option>
                <option value="maintenance">Maintenance</option>
                <option value="parent_visit">Parent Visit</option>
                <option value="interview">Interview</option>
                <option value="contractor">Contractor</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label for="vis_person">Person Visiting</label>
              <input type="text" name="person_visiting" id="vis_person" placeholder="Who are they visiting?">
            </div>
          </div>
          <div class="gp-grid">
            <div>
              <label for="vis_idtype">ID Type</label>
              <select name="id_type" id="vis_idtype">
                <option value="">-- Select --</option>
                <option value="national_id">National ID</option>
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver's License</option>
                <option value="voter_id">Voter ID</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label for="vis_idnum">ID Number</label>
              <input type="text" name="id_number" id="vis_idnum" placeholder="ID number">
            </div>
          </div>
          <div>
            <label for="vis_vehicle">Vehicle Plate (optional)</label>
            <input type="text" name="vehicle_plate" id="vis_vehicle" placeholder="License plate number">
          </div>
          <div>
            <label for="vis_notes">Notes</label>
            <textarea name="notes" id="vis_notes" rows="2" placeholder="Additional notes..."></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" style="padding:12px 28px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\uD83D\uDC65 Register Visitor & Generate Badge</button>
            <a href="/gate-pass" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Register Visitor', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /gate-pass/visitor — Save Visitor Pass
  // ============================================================
  app.post('/gate-pass/visitor', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var fullName = (body.full_name || '').trim();
    var phone = (body.phone || '').trim();

    if (!fullName || !phone) {
      return res.redirect('/gate-pass/visitor');
    }

    var qrCode = 'VIS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Auto-expire at end of today
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    var result = await pool.query(
      `INSERT INTO visitor_passes (tenant_id, full_name, phone, email, purpose, person_visiting, id_type, id_number, company, qr_code, status, check_in_time, notes, vehicle_plate, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'checked_in',NOW(),$11,$12,$13) RETURNING id`,
      [tid, fullName, phone, (body.email || '').trim() || null, body.purpose || 'other',
       (body.person_visiting || '').trim() || null, (body.id_type || '').trim() || null,
       (body.id_number || '').trim() || null, (body.company || '').trim() || null,
       qrCode, (body.notes || '').trim() || null, (body.vehicle_plate || '').trim() || null, tomorrow.toISOString()]
    );

    var passId = result.rows[0].id;
    audit('visitor_registered', 'Visitor #' + passId + ': ' + fullName, user.id, tid);

    res.redirect('/gate-pass/badge/' + passId);
  }));

  // ============================================================
  // ROUTE 9: GET /gate-pass/badge/:id — View Visitor Badge
  // ============================================================
  app.get('/gate-pass/badge/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var passId = req.params.id;

    var vis = (await pool.query(
      'SELECT * FROM visitor_passes WHERE id=$1 AND tenant_id=$2', [passId, tid]
    )).rows[0];

    if (!vis) {
      return res.status(404).send('<h1>Visitor pass not found</h1>');
    }

    var qrSvg = generateQRSvg(vis.qr_code, 160);

    // Mark badge as printed
    if (!vis.badge_printed) {
      await pool.query('UPDATE visitor_passes SET badge_printed=true WHERE id=$1 AND tenant_id=$2', [passId, tid]);
    }

    var html = GP_CSS + `<div style="max-width:450px;margin:20px auto">
      <div class="gp-badge" style="border-color:#7c3aed" role="article" aria-label="Visitor Badge for ${esc(vis.full_name)}">
        <div style="background:#7c3aed;color:#fff;padding:14px 16px;border-radius:10px;text-align:center;margin-bottom:16px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;opacity:.8">Visitor Badge</div>
          <div style="font-size:20px;font-weight:800;margin-top:2px">VISITOR</div>
          <div style="font-size:11px;opacity:.7">VIS-${String(vis.id).padStart(4, '0')}</div>
        </div>
        <div style="text-align:center;margin-bottom:16px">${qrSvg}</div>
        <div style="text-align:center;margin-bottom:16px">
          <div style="font-size:20px;font-weight:700;color:#1e293b">${esc(vis.full_name)}</div>
          <div style="font-size:13px;color:#64748b;margin-top:2px">${esc(vis.purpose)}</div>
          ${vis.person_visiting ? '<div style="font-size:12px;color:#4f46e5;margin-top:4px">Visiting: ' + esc(vis.person_visiting) + '</div>' : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px">
          ${vis.phone ? '<div>\uD83D\uDCDE Phone</div><div style="font-weight:600;color:#1e293b">' + esc(vis.phone) + '</div>' : ''}
          ${vis.company ? '<div>\uD83C\uDFE2 Company</div><div style="font-weight:600;color:#1e293b">' + esc(vis.company) + '</div>' : ''}
          ${vis.id_type ? '<div>\uD83D\uDCD7 ID Type</div><div style="font-weight:600;color:#1e293b">' + esc(vis.id_type.replace(/_/g,' ')) + '</div>' : ''}
          <div>\uD83D\uDCC5 Date</div><div style="font-weight:600;color:#1e293b">${fmtDate(vis.created_at)}</div>
        </div>
        <div style="text-align:center;margin-top:16px;font-size:10px;color:#94a3b8">
          Expires: ${vis.expires_at ? fmtDateTime(vis.expires_at) : 'End of day'} | ${passStatusBadge(vis.status)}
        </div>
        ${vis.status === 'checked_in' ? `<form method="POST" action="/gate-pass/visitor-out/${vis.id}" style="text-align:center;margin-top:12px">
          <button type="submit" style="padding:10px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">\uD83D\uDD35 Check Out Visitor</button>
        </form>` : ''}
      </div>
      <div style="text-align:center;margin-top:16px">
        <a href="/gate-pass/visitor" style="color:#4f46e5;text-decoration:none;font-size:13px;font-weight:600">\u2190 Register Another</a>
        <span style="margin:0 12px;color:#e2e8f0">|</span>
        <a href="/gate-pass/scanner" style="color:#4f46e5;text-decoration:none;font-size:13px;font-weight:600">\uD83D\uDD0D Open Scanner</a>
      </div>
    </div>`;
    res.send(renderPage('Visitor Badge - ' + vis.full_name, html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /gate-pass/visitor-out/:id — Check out visitor
  // ============================================================
  app.post('/gate-pass/visitor-out/:id', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id, visId = req.params.id;
    await pool.query(
      "UPDATE visitor_passes SET status='checked_out', check_out_time=NOW() WHERE id=$1 AND tenant_id=$2 AND status='checked_in'",
      [visId, tid]
    );
    audit('visitor_checkout', 'Visitor #' + visId + ' checked out', user.id, tid);
    res.redirect('/gate-pass/badge/' + visId);
  }));

  // ============================================================
  // ROUTE 11: GET /gate-pass/scanner — Gate Scanner View
  // ============================================================
  app.get('/gate-pass/scanner', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;

    var html = GP_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('scanner')}
      <h2 style="font-size:22px;color:#1e293b;margin-bottom:4px">\uD83D\uDD0D Gate Scanner</h2>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Scan or search QR code / name to validate gate passes</p>

      <div class="gp-card" style="padding:24px">
        <form method="POST" action="/gate-pass/scan" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label for="scan_input" style="display:block;font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px">Scan QR Code or Enter Code</label>
            <input type="text" name="code" id="scan_input" class="gp-scanner-input" placeholder="EXIT-... or VIS-..." autofocus autocomplete="off" aria-label="QR code or pass identifier">
          </div>
          <div style="display:flex;gap:8px">
            <button type="submit" style="flex:1;padding:14px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">\uD83D\uDD0D Validate Pass</button>
            <button type="button" onclick="document.getElementById('scan_input').value='';document.getElementById('scan_input').focus()" style="padding:14px 20px;background:#f1f5f9;color:#475569;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\u21BA Clear</button>
          </div>
        </form>
      </div>

      <div class="gp-card" style="padding:24px;margin-top:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDD0E Search by Name</h3>
        <form method="POST" action="/gate-pass/scan-name" style="display:flex;gap:8px">
          <input type="text" name="name" placeholder="Student or visitor name..." style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" aria-label="Search by name">
          <button type="submit" style="padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\uD83D\uDD0D Search</button>
        </form>
      </div>

      <!-- Quick stats -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px">
        <div style="background:#dcfce7;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#16a34a" id="activeCount">-</div>
          <div style="font-size:11px;color:#15803d;font-weight:600">Active Passes</div>
        </div>
        <div style="background:#dbeafe;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#2563eb" id="usedCount">-</div>
          <div style="font-size:11px;color:#1d4ed8;font-weight:600">Used Today</div>
        </div>
        <div style="background:#fef3c7;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:#b45309" id="visitorCount">-</div>
          <div style="font-size:11px;color:#92400e;font-weight:600">Visitors In</div>
        </div>
      </div>
    </div>
    <script>
      // Auto-focus scanner input
      document.getElementById('scan_input').focus();
      // Load quick stats via fetch
      fetch('/gate-pass/scanner-stats').then(function(r){return r.json()}).then(function(d){
        document.getElementById('activeCount').textContent = d.active || 0;
        document.getElementById('usedCount').textContent = d.used || 0;
        document.getElementById('visitorCount').textContent = d.visitors || 0;
      }).catch(function(){});
    </script>`;
    res.send(renderPage('Gate Scanner', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /gate-pass/scanner-stats — Quick JSON stats
  // ============================================================
  app.get('/gate-pass/scanner-stats', requireAuth, ah(async function(req, res) {
    var tid = req.session.user.tenant_id;
    var active = (await pool.query("SELECT COUNT(*)::int as cnt FROM gate_passes WHERE tenant_id=$1 AND status='active'", [tid])).rows[0].cnt;
    var used = (await pool.query("SELECT COUNT(*)::int as cnt FROM gate_passes WHERE tenant_id=$1 AND status='used' AND gate_used_at >= CURRENT_DATE", [tid])).rows[0].cnt;
    var visitors = (await pool.query("SELECT COUNT(*)::int as cnt FROM visitor_passes WHERE tenant_id=$1 AND status='checked_in'", [tid])).rows[0].cnt;
    res.json({ active: active, used: used, visitors: visitors });
  }));

  // ============================================================
  // ROUTE 13: POST /gate-pass/scan — Scan QR code
  // ============================================================
  app.post('/gate-pass/scan', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var code = (req.body.code || '').trim();

    if (!code) {
      return res.redirect('/gate-pass/scanner');
    }

    // Try to find in gate_passes
    var gatePass = (await pool.query(
      'SELECT * FROM gate_passes WHERE tenant_id=$1 AND qr_code=$2', [tid, code]
    )).rows[0];

    if (gatePass) {
      audit('qr_scanned', 'Gate pass found: GP-' + gatePass.id, user.id, tid);
      return res.redirect('/gate-pass/view/' + gatePass.id);
    }

    // Try visitor_passes
    var visPass = (await pool.query(
      'SELECT * FROM visitor_passes WHERE tenant_id=$1 AND qr_code=$2', [tid, code]
    )).rows[0];

    if (visPass) {
      audit('qr_scanned', 'Visitor pass found: VIS-' + visPass.id, user.id, tid);
      return res.redirect('/gate-pass/badge/' + visPass.id);
    }

    // Not found - show error
    var html = GP_CSS + `<div style="max-width:500px;margin:40px auto;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">\u274C</div>
      <h2 style="color:#dc2626;margin-bottom:8px">Pass Not Found</h2>
      <p style="color:#64748b;margin-bottom:20px">The QR code "<strong>${esc(code)}</strong>" does not match any active pass in the system.</p>
      <a href="/gate-pass/scanner" style="padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:10px;font-weight:600">\uD83D\uDD0D Try Again</a>
    </div>`;
    res.send(renderPage('QR Not Found', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: POST /gate-pass/scan-name — Search by name
  // ============================================================
  app.post('/gate-pass/scan-name', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var name = (req.body.name || '').trim();

    if (!name) {
      return res.redirect('/gate-pass/scanner');
    }

    var gateResults = (await pool.query(
      'SELECT * FROM gate_passes WHERE tenant_id=$1 AND (student_name ILIKE $2 OR qr_code ILIKE $2) ORDER BY created_at DESC LIMIT 10',
      [tid, '%' + name + '%']
    )).rows;

    var visResults = (await pool.query(
      'SELECT * FROM visitor_passes WHERE tenant_id=$1 AND (full_name ILIKE $2 OR qr_code ILIKE $2) ORDER BY created_at DESC LIMIT 10',
      [tid, '%' + name + '%']
    )).rows;

    var gateRows = gateResults.map(function(p) {
      return `<tr>
        <td><a href="/gate-pass/view/${p.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">GP-${String(p.id).padStart(4,'0')}</a></td>
        <td>${esc(p.student_name)}</td>
        <td>${reasonLabel(p.reason)}</td>
        <td>${passStatusBadge(p.status)}</td>
        <td>${fmtDateTime(p.created_at)}</td>
      </tr>`;
    }).join('');

    var visRows = visResults.map(function(v) {
      return `<tr>
        <td><a href="/gate-pass/badge/${v.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">VIS-${String(v.id).padStart(4,'0')}</a></td>
        <td>${esc(v.full_name)}</td>
        <td>${esc(v.purpose)}</td>
        <td>${passStatusBadge(v.status)}</td>
        <td>${fmtDateTime(v.created_at)}</td>
      </tr>`;
    }).join('');

    var html = GP_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('scanner')}
      <h2 style="font-size:20px;color:#1e293b;margin-bottom:16px">Search Results for "${esc(name)}"</h2>
      <div class="gp-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDEAA Exit Passes (${gateResults.length})</h3>
        <div style="overflow-x:auto"><table class="gp-table">
          <thead><tr><th>Pass</th><th>Student</th><th>Reason</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${gateRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No exit passes found</td></tr>'}</tbody>
        </table></div>
      </div>
      <div class="gp-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDC65 Visitor Passes (${visResults.length})</h3>
        <div style="overflow-x:auto"><table class="gp-table">
          <thead><tr><th>Pass</th><th>Visitor</th><th>Purpose</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>${visRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No visitor passes found</td></tr>'}</tbody>
        </table></div>
      </div>
      <div style="text-align:center;margin-top:16px">
        <a href="/gate-pass/scanner" style="color:#4f46e5;text-decoration:none;font-weight:600">\u2190 Back to Scanner</a>
      </div>
    </div>`;
    res.send(renderPage('Search Results', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: GET /gate-pass/history — Pass History with SVG chart
  // ============================================================
  app.get('/gate-pass/history', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var queryParams = req.query;
    var type = queryParams.type || 'all';
    var status = queryParams.status || '';
    var fromDate = queryParams.from || '';
    var toDate = queryParams.to || '';
    var search = queryParams.search || '';

    // Build WHERE for gate_passes
    var gpWhere = ['tenant_id=$1'];
    var gpParams = [tid];
    var pi = 2;
    if (status) { gpWhere.push('status=$' + (pi++)); gpParams.push(status); }
    if (fromDate) { gpWhere.push('created_at >= $' + (pi++)); gpParams.push(fromDate); }
    if (toDate) { gpWhere.push('created_at < ($' + (pi++) + '::date + INTERVAL \'1 day\')'); gpParams.push(toDate); }
    if (search) { gpWhere.push('student_name ILIKE $' + (pi++)); gpParams.push('%' + search + '%'); }

    // Build WHERE for visitor_passes
    var vpWhere = ['tenant_id=$1'];
    var vpParams = [tid];
    var vpi = 2;
    if (status) { vpWhere.push('status=$' + (vpi++)); vpParams.push(status); }
    if (fromDate) { vpWhere.push('created_at >= $' + (vpi++)); vpParams.push(fromDate); }
    if (toDate) { vpWhere.push('created_at < ($' + (vpi++) + '::date + INTERVAL \'1 day\')'); vpParams.push(toDate); }
    if (search) { vpWhere.push('full_name ILIKE $' + (vpi++)); vpParams.push('%' + search + '%'); }

    var gatePasses = [];
    var visitorPasses = [];

    if (type === 'all' || type === 'exit') {
      gatePasses = (await pool.query(
        'SELECT * FROM gate_passes WHERE ' + gpWhere.join(' AND ') + ' ORDER BY created_at DESC LIMIT 200', gpParams
      )).rows;
    }
    if (type === 'all' || type === 'visitor') {
      visitorPasses = (await pool.query(
        'SELECT * FROM visitor_passes WHERE ' + vpWhere.join(' AND ') + ' ORDER BY created_at DESC LIMIT 200', vpParams
      )).rows;
    }

    // SVG chart data — exits by reason
    var chartData = (await pool.query(
      'SELECT reason, COUNT(*)::int as cnt FROM gate_passes WHERE tenant_id=$1 GROUP BY reason ORDER BY cnt DESC',
      [tid]
    )).rows;

    var svgChart = generateReasonChart(chartData);

    // Build table rows
    var gpRows = gatePasses.map(function(p) {
      return `<tr>
        <td><a href="/gate-pass/view/${p.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">GP-${String(p.id).padStart(4,'0')}</a></td>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${reasonColor(p.reason)};margin-right:6px"></span>Exit</td>
        <td>${esc(p.student_name)}</td>
        <td>${reasonLabel(p.reason)}</td>
        <td>${passStatusBadge(p.status)}</td>
        <td style="font-size:12px">${fmtDateTime(p.created_at)}</td>
        <td style="font-size:12px">${p.gate_used_at ? fmtTime(p.gate_used_at) : '\u2014'}</td>
        ${p.status === 'active' ? '<td><form method="POST" action="/gate-pass/expire/' + p.id + '" style="display:inline"><button style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600">Expire</button></form></td>' : '<td></td>'}
      </tr>`;
    }).join('');

    var vpRows = visitorPasses.map(function(v) {
      return `<tr>
        <td><a href="/gate-pass/badge/${v.id}" style="color:#7c3aed;text-decoration:none;font-weight:600">VIS-${String(v.id).padStart(4,'0')}</a></td>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7c3aed;margin-right:6px"></span>Visitor</td>
        <td>${esc(v.full_name)}</td>
        <td>${esc(v.purpose)}</td>
        <td>${passStatusBadge(v.status)}</td>
        <td style="font-size:12px">${fmtDateTime(v.created_at)}</td>
        <td style="font-size:12px">${v.check_out_time ? fmtTime(v.check_out_time) : '\u2014'}</td>
        <td></td>
      </tr>`;
    }).join('');

    var totalCount = gatePasses.length + visitorPasses.length;

    var html = GP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('history')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h2 style="font-size:22px;color:#1e293b">\uD83D\uDCDC Pass History</h2>
        <span style="font-size:13px;color:#64748b;font-weight:600">${totalCount} record${totalCount !== 1 ? 's' : ''} found</span>
      </div>

      <!-- Filters -->
      <div class="gp-card" style="padding:16px">
        <div class="gp-filter">
          <div>
            <label for="hist_type">Type</label>
            <select id="hist_type" onchange="applyFilters()">
              <option value="all" ${type==='all'?'selected':''}>All Passes</option>
              <option value="exit" ${type==='exit'?'selected':''}>Exit Passes</option>
              <option value="visitor" ${type==='visitor'?'selected':''}>Visitor Passes</option>
            </select>
          </div>
          <div>
            <label for="hist_status">Status</label>
            <select id="hist_status" onchange="applyFilters()">
              <option value="">All Statuses</option>
              <option value="active" ${status==='active'?'selected':''}>Active</option>
              <option value="used" ${status==='used'?'selected':''}>Used</option>
              <option value="expired" ${status==='expired'?'selected':''}>Expired</option>
              <option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelled</option>
              <option value="returned" ${status==='returned'?'selected':''}>Returned</option>
              <option value="checked_in" ${status==='checked_in'?'selected':''}>Checked In</option>
              <option value="checked_out" ${status==='checked_out'?'selected':''}>Checked Out</option>
            </select>
          </div>
          <div>
            <label for="hist_from">From</label>
            <input type="date" id="hist_from" value="${esc(fromDate)}" onchange="applyFilters()">
          </div>
          <div>
            <label for="hist_to">To</label>
            <input type="date" id="hist_to" value="${esc(toDate)}" onchange="applyFilters()">
          </div>
          <div>
            <label for="hist_search">Search</label>
            <input type="text" id="hist_search" value="${esc(search)}" placeholder="Name..." onkeyup="if(event.key==='Enter')applyFilters()">
          </div>
        </div>
      </div>

      <!-- SVG Chart -->
      <div class="gp-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\uD83D\uDCCA Exits by Reason (All Time)</h3>
        <div style="overflow-x:auto;padding:8px 0">${svgChart}</div>
      </div>

      <!-- Table -->
      <div class="gp-card">
        <div style="overflow-x:auto"><table class="gp-table">
          <thead><tr><th>Pass ID</th><th>Type</th><th>Name</th><th>Reason/Purpose</th><th>Status</th><th>Created</th><th>Used At</th><th>Actions</th></tr></thead>
          <tbody>${gpRows}${vpRows}${!gpRows && !vpRows ? '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No pass records found for the selected filters</td></tr>' : ''}</tbody>
        </table></div>
      </div>
    </div>
    <script>
      function applyFilters(){
        var t = document.getElementById('hist_type').value;
        var s = document.getElementById('hist_status').value;
        var f = document.getElementById('hist_from').value;
        var to = document.getElementById('hist_to').value;
        var q = document.getElementById('hist_search').value;
        var params = [];
        if(t) params.push('type='+encodeURIComponent(t));
        if(s) params.push('status='+encodeURIComponent(s));
        if(f) params.push('from='+encodeURIComponent(f));
        if(to) params.push('to='+encodeURIComponent(to));
        if(q) params.push('search='+encodeURIComponent(q));
        location.href='/gate-pass/history' + (params.length ? '?'+params.join('&') : '');
      }
    </script>`;
    res.send(renderPage('Pass History', html, user, req));
  }));

  // ============================================================
  // ROUTE 16: GET /gate-pass/late — Late Arrivals
  // ============================================================
  app.get('/gate-pass/late', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var success = req.query.success;
    var alertHtml = success ? '<div class="gp-alert gp-alert-success">\u2705 ' + esc(success) + '</div>' : '';

    var students = (await pool.query(
      'SELECT id, first_name, last_name, admission_number, class_name FROM students WHERE tenant_id=$1 ORDER BY last_name, first_name LIMIT 500', [tid]
    )).rows;

    var studentOpts = students.map(function(s) {
      return '<option value="' + s.id + '" data-class="' + esc(s.class_name || '') + '" data-name="' + esc(s.first_name || '') + ' ' + esc(s.last_name || '') + '">' + esc(s.last_name || '') + ', ' + esc(s.first_name || '') + ' (' + esc(s.admission_number || s.id) + ')</option>';
    }).join('');

    // Late arrivals today
    var lateToday = (await pool.query(
      'SELECT la.*, u.display_name as recorder_name FROM late_arrivals la LEFT JOIN users u ON u.id = la.recorded_by WHERE la.tenant_id=$1 AND la.arrival_time >= CURRENT_DATE ORDER BY la.arrival_time DESC LIMIT 50', [tid]
    )).rows;

    // Chronic latecomers (3+ in last 30 days)
    var chronic = (await pool.query(
      'SELECT student_id, student_name, class_name, COUNT(*)::int as total_late, AVG(minutes_late)::int as avg_minutes FROM late_arrivals WHERE tenant_id=$1 AND arrival_time >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY student_id, student_name, class_name HAVING COUNT(*) >= 3 ORDER BY total_late DESC LIMIT 10', [tid]
    )).rows;

    var lateRows = lateToday.map(function(l) {
      var lateColor = l.minutes_late >= 30 ? '#dc2626' : l.minutes_late >= 15 ? '#f59e0b' : '#4f46e5';
      return `<tr>
        <td style="font-weight:600">${esc(l.student_name)}</td>
        <td>${esc(l.class_name || '-')}</td>
        <td style="font-size:12px">${fmtTime(l.arrival_time)}</td>
        <td><span style="font-weight:700;color:${lateColor}">${l.minutes_late} min</span></td>
        <td>${esc(l.reason || '-')}</td>
        <td style="font-size:11px;color:#94a3b8">${esc(l.recorder_name || '-')}</td>
      </tr>`;
    }).join('');

    var chronicBars = chronic.map(function(c) {
      var pct = Math.min(100, (c.total_late / 15) * 100);
      var color = c.total_late >= 10 ? '#dc2626' : c.total_late >= 5 ? '#f59e0b' : '#4f46e5';
      return `<div class="gp-late-bar">
        <span style="font-size:12px;font-weight:600;color:#475569;min-width:120px">${esc(c.student_name)}</span>
        <div class="gp-late-track">
          <div class="gp-late-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${color};min-width:60px">${c.total_late}x (avg ${c.avg_minutes}m)</span>
      </div>`;
    }).join('');

    var html = GP_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('late')}
      ${alertHtml}
      <div class="gp-grid">
        <div>
          <div class="gp-card" style="padding:24px">
            <h2 style="margin:0 0 4px;color:#1e293b">\u23F0 Record Late Arrival</h2>
            <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Auto-calculates minutes late from school start time</p>
            <form method="POST" action="/gate-pass/late" class="gp-form" style="display:flex;flex-direction:column;gap:16px" novalidate>
              <div>
                <label for="late_student">Student *</label>
                <select name="student_id" id="late_student" required onchange="onLateStudentChange()">
                  <option value="">Select student...</option>
                  ${studentOpts}
                </select>
              </div>
              <div class="gp-grid">
                <div>
                  <label for="late_time">Arrival Time *</label>
                  <input type="time" name="arrival_time" id="late_time" required value="${new Date().toTimeString().slice(0,5)}">
                </div>
                <div>
                  <label for="late_school_start">School Start Time</label>
                  <input type="time" name="school_start" id="late_school_start" value="07:30">
                </div>
              </div>
              <div>
                <label for="late_reason">Reason</label>
                <select name="reason" id="late_reason">
                  <option value="traffic">Traffic</option>
                  <option value="health">Health Issue</option>
                  <option value="family">Family Matter</option>
                  <option value="weather">Weather</option>
                  <option value="transport">Transport Problem</option>
                  <option value="overslept">Overslept</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label for="late_notes">Notes</label>
                <textarea name="notes" id="late_notes" rows="2" placeholder="Additional details..."></textarea>
              </div>
              <button type="submit" style="padding:12px 28px;background:#f59e0b;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">\u23F0 Record Late Arrival</button>
            </form>
          </div>
        </div>

        <div>
          <!-- Today's late arrivals -->
          <div class="gp-card">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\u23F0 Late Arrivals Today (${lateToday.length})</h3>
            <div style="overflow-x:auto"><table class="gp-table">
              <thead><tr><th>Student</th><th>Class</th><th>Time</th><th>Late</th><th>Reason</th><th>By</th></tr></thead>
              <tbody>${lateRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No late arrivals today</td></tr>'}</tbody>
            </table></div>
          </div>
        </div>
      </div>

      <!-- Chronic latecomers -->
      ${chronic.length ? `<div class="gp-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">\u26A0\uFE0F Chronic Latecomers (3+ in 30 days)</h3>
        ${chronicBars}
      </div>` : ''}
    </div>
    <script>
      function onLateStudentChange() {
        var sel = document.getElementById('late_student');
        var opt = sel.options[sel.selectedIndex];
        var timeField = document.getElementById('late_time');
        if (!timeField.value) {
          timeField.value = new Date().toTimeString().slice(0,5);
        }
      }
    </script>`;
    res.send(renderPage('Late Arrivals', html, user, req));
  }));

  // ============================================================
  // ROUTE 17: POST /gate-pass/late — Record Late Arrival
  // ============================================================
  app.post('/gate-pass/late', requireAuth, ah(async function(req, res) {
    var user = req.session.user, tid = user.tenant_id;
    var body = req.body;
    var studentId = body.student_id;
    var arrivalTime = body.arrival_time;
    var schoolStart = body.school_start || '07:30';
    var reason = body.reason || 'other';
    var notes = (body.notes || '').trim() || null;

    if (!studentId || !arrivalTime) {
      return res.redirect('/gate-pass/late');
    }

    // Get student info
    var student = (await pool.query(
      'SELECT first_name, last_name, class_name, guardian_email FROM students WHERE id=$1 AND tenant_id=$2', [studentId, tid]
    )).rows[0];

    if (!student) {
      return res.redirect('/gate-pass/late');
    }

    var studentName = (student.first_name || '') + ' ' + (student.last_name || '');

    // Calculate minutes late
    var arrival = arrivalTime.split(':');
    var start = schoolStart.split(':');
    var arrivalMinutes = parseInt(arrival[0], 10) * 60 + parseInt(arrival[1], 10);
    var startMinutes = parseInt(start[0], 10) * 60 + parseInt(start[1], 10);
    var minutesLate = Math.max(0, arrivalMinutes - startMinutes);

    // Build full timestamp
    var today = new Date();
    var fullArrival = new Date(today.getFullYear(), today.getMonth(), today.getDate(),
      parseInt(arrival[0], 10), parseInt(arrival[1], 10));

    await pool.query(
      `INSERT INTO late_arrivals (tenant_id, student_id, student_name, arrival_time, minutes_late, reason, recorded_by, class_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, studentId, studentName.trim(), fullArrival.toISOString(), minutesLate, reason, user.id, student.class_name || null, notes]
    );

    audit('late_arrival_recorded', studentName.trim() + ' - ' + minutesLate + ' min late', user.id, tid);

    // Notify parent for chronic cases
    var recentLate = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM late_arrivals WHERE tenant_id=$1 AND student_id=$2 AND arrival_time >= CURRENT_DATE - INTERVAL \'7 days\'',
      [tid, studentId]
    )).rows[0].cnt;

    if (recentLate >= 3 && student.guardian_email) {
      queueEmail(
        student.guardian_email,
        'Late Arrival Alert: ' + studentName.trim(),
        studentName.trim() + ' has been late ' + recentLate + ' times this week (' + minutesLate + ' minutes today). Please address this promptly.',
        tid
      );
      await pool.query(
        'UPDATE late_arrivals SET parent_notified=true WHERE tenant_id=$1 AND student_id=$2 AND arrival_time=$3',
        [tid, studentId, fullArrival.toISOString()]
      );
    }

    res.redirect('/gate-pass/late?success=' + encodeURIComponent(studentName.trim() + ' recorded as ' + minutesLate + ' minutes late'));
  }));

  // ============================================================
  // RETURN PUBLIC API
  // ============================================================
  return {
    esc: esc,
    renderPage: renderPage,
    ah: ah,
    requireAuth: requireAuth,
    audit: audit
  };
};
