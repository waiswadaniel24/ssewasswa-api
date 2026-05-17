/**
 * Smart Parking Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Zone management, slot allocation, vehicle registration,
 *   check-in/check-out, SVG occupancy grid, permits, visitor parking,
 *   violation tracking, peak hour analysis, EV charging, reserved parking,
 *   monthly passes, revenue reports
 * 15 routes · PostgreSQL · tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Smart Parking</div>';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function navUrl(a) { return '/school/parking' + a; }
  function fmtDate(d) { return d ? new Date(d).toISOString().split('T')[0] : '—'; }
  function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'; }
  function fmtMoney(v) { return '$' + parseFloat(v || 0).toFixed(2); }
  function badge(label, color) { return `<span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(label)}</span>`; }

  function nav(active) {
    const links = [
      ['Dashboard', ''], ['Zones', '/zones'], ['Permits', '/permits'],
      ['Check-In', '/checkin'], ['Check-Out', '/checkout'],
      ['Violations', '/violations'], ['Revenue', '/revenue'], ['Analytics', '/analytics'],
    ];
    return '<nav style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px">' +
      links.map(([l, h]) =>
        `<a href="${navUrl(h)}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;` +
        (active === l ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`
      ).join('') + '</nav>';
  }

  function alertBox(msg, type) {
    const colors = { success: '#dcfce7', error: '#fee2e2', warning: '#fef3c7', info: '#dbeafe' };
    const borders = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    return `<div style="background:${colors[type]||colors.info};border:1px solid ${borders[type]||borders.info};border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#1f2937">${msg}</div>`;
  }

  // ── SVG Parking Grid Builder ───────────────────────────────────────────────
  function buildSvgGrid(slots, zoneColors) {
    const cols = 8;
    const cellW = 70, cellH = 50, gap = 6;
    const statusColors = {
      available: '#22c55e', occupied: '#ef4444', reserved: '#f59e0b',
      ev_charging: '#3b82f6', visitor: '#8b5cf6', disabled: '#6b7280', maintenance: '#d1d5db'
    };
    const statusLabels = {
      available: 'Available', occupied: 'Occupied', reserved: 'Reserved',
      ev_charging: 'EV Charging', visitor: 'Visitor', disabled: 'Disabled', maintenance: 'Maintenance'
    };
    let rects = '';
    const rows = Math.ceil(slots.length / cols);
    const width = cols * (cellW + gap) + 20;
    const height = rows * (cellH + gap) + 20 + 30;

    // Background
    rects += `<rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>`;

    // Row labels (A, B, C...)
    for (let r = 0; r < rows; r++) {
      const label = String.fromCharCode(65 + r);
      rects += `<text x="10" y="${r * (cellH + gap) + 30 + cellH / 2 + 5}" font-size="12" fill="#94a3b8" font-weight="600">${label}</text>`;
    }

    slots.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 20 + col * (cellW + gap);
      const y = 20 + row * (cellH + gap);
      const color = statusColors[s.status] || statusColors.available;
      const label = String.fromCharCode(65 + row) + (col + 1);
      const zoneColor = (zoneColors && zoneColors[s.zone_id]) ? zoneColors[s.zone_id] : null;
      const borderClr = zoneColor || color;

      rects += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="6" fill="${color}" stroke="${borderClr}" stroke-width="2" opacity="0.9"/>`;
      rects += `<text x="${x + cellW / 2}" y="${y + 18}" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">${esc(label)}</text>`;
      rects += `<text x="${x + cellW / 2}" y="${y + 32}" text-anchor="middle" fill="#fff" font-size="8" opacity="0.9">${esc(s.slot_number)}</text>`;
      if (s.status === 'occupied' && s.vehicle_reg) {
        rects += `<text x="${x + cellW / 2}" y="${y + 44}" text-anchor="middle" fill="#fff" font-size="7" opacity="0.8">${esc(s.vehicle_reg.substring(0, 8))}</text>`;
      }
    });

    // Legend
    let legendY = height - 20;
    let legendX = 20;
    for (const [key, label] of Object.entries(statusLabels)) {
      rects += `<rect x="${legendX}" y="${legendY}" width="12" height="12" rx="3" fill="${statusColors[key]}"/>`;
      rects += `<text x="${legendX + 16}" y="${legendY + 10}" font-size="10" fill="#64748b">${label}</text>`;
      legendX += 100;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 10}" style="width:100%;max-width:700px;margin:0 auto;display:block">${rects}</svg>`;
  }

  // ── Database Migration ─────────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS parking_zones (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL, type VARCHAR(50) DEFAULT 'general',
          total_slots INTEGER DEFAULT 50, zone_color VARCHAR(7) DEFAULT '#4f46e5',
          location VARCHAR(255), hourly_rate NUMERIC(6,2) DEFAULT 2.00,
          is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS parking_slots (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES parking_zones(id) ON DELETE CASCADE,
          slot_number VARCHAR(20) NOT NULL, status VARCHAR(30) DEFAULT 'available',
          vehicle_type VARCHAR(30) DEFAULT 'any', assigned_to INTEGER,
          is_ev_charging BOOLEAN DEFAULT false, is_reserved BOOLEAN DEFAULT false,
          is_disabled BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(zone_id, slot_number)
        );
        CREATE TABLE IF NOT EXISTS parking_permits (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id INTEGER, vehicle_reg VARCHAR(30) NOT NULL, vehicle_type VARCHAR(30) DEFAULT 'car',
          vehicle_make VARCHAR(100), vehicle_color VARCHAR(50),
          permit_type VARCHAR(30) DEFAULT 'daily', valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
          valid_to DATE NOT NULL DEFAULT CURRENT_DATE, status VARCHAR(20) DEFAULT 'active',
          monthly_rate NUMERIC(6,2) DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS parking_logs (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          slot_id INTEGER NOT NULL REFERENCES parking_slots(id), permit_id INTEGER REFERENCES parking_permits(id),
          vehicle_reg VARCHAR(30) NOT NULL, zone_id INTEGER REFERENCES parking_zones(id),
          check_in TIMESTAMPTZ NOT NULL DEFAULT NOW(), check_out TIMESTAMPTZ,
          duration_min INTEGER DEFAULT 0, fee_charged NUMERIC(6,2) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS parking_violations (
          id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          vehicle_reg VARCHAR(30) NOT NULL, zone_id INTEGER REFERENCES parking_zones(id),
          violation_type VARCHAR(50) NOT NULL, description TEXT,
          fine_amount NUMERIC(6,2) DEFAULT 25.00, status VARCHAR(20) DEFAULT 'pending',
          evidence_notes TEXT, created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Indexes
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_pz_tenant ON parking_zones(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ps_tenant ON parking_slots(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ps_zone ON parking_slots(zone_id)',
        'CREATE INDEX IF NOT EXISTS idx_ps_status ON parking_slots(status)',
        'CREATE INDEX IF NOT EXISTS idx_pp_tenant ON parking_permits(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_pp_status ON parking_permits(status)',
        'CREATE INDEX IF NOT EXISTS idx_pp_vehicle ON parking_permits(vehicle_reg)',
        'CREATE INDEX IF NOT EXISTS idx_pl_tenant ON parking_logs(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_pl_slot ON parking_logs(slot_id)',
        'CREATE INDEX IF NOT EXISTS idx_pl_checkin ON parking_logs(check_in)',
        'CREATE INDEX IF NOT EXISTS idx_pv_tenant ON parking_violations(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_pv_status ON parking_violations(status)',
        'CREATE INDEX IF NOT EXISTS idx_pv_vehicle ON parking_violations(vehicle_reg)',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[SmartParking] Tables ready');
    } catch (e) { console.warn('[SmartParking] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard with SVG occupancy grid
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [zones, permits, logs, violations] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS c FROM parking_zones WHERE tenant_id=$1 AND is_active=true", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM parking_permits WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM parking_logs WHERE tenant_id=$1 AND check_out IS NULL", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM parking_violations WHERE tenant_id=$1 AND status='pending'", [tid]),
    ]);
    const totalSlots = await pool.query(
      "SELECT COUNT(*)::int AS c FROM parking_slots WHERE tenant_id=$1", [tid]);
    const occupiedSlots = await pool.query(
      "SELECT COUNT(*)::int AS c FROM parking_slots WHERE tenant_id=$1 AND status='occupied'", [tid]);
    const todayRevenue = await pool.query(
      "SELECT COALESCE(SUM(fee_charged),0)::numeric AS rev FROM parking_logs WHERE tenant_id=$1 AND check_in >= CURRENT_DATE", [tid]);

    const zoneStats = await pool.query(
      `SELECT z.id, z.name, z.type, z.zone_color, z.total_slots, z.hourly_rate,
        COUNT(s.id) FILTER (WHERE s.status='available') AS available,
        COUNT(s.id) FILTER (WHERE s.status='occupied') AS occupied,
        COUNT(s.id) FILTER (WHERE s.is_ev_charging=true) AS ev_slots
       FROM parking_zones z LEFT JOIN parking_slots s ON s.zone_id=z.id
       WHERE z.tenant_id=$1 AND z.is_active=true GROUP BY z.id ORDER BY z.name`, [tid]);

    // Build SVG grid from all slots
    const allSlots = await pool.query(
      `SELECT s.id, s.zone_id, s.slot_number, s.status, s.vehicle_type,
        s.is_ev_charging, s.is_reserved, s.is_disabled,
        (SELECT pl.vehicle_reg FROM parking_logs pl WHERE pl.slot_id=s.id AND pl.check_out IS NULL LIMIT 1) AS vehicle_reg
       FROM parking_slots s JOIN parking_zones z ON z.id=s.zone_id
       WHERE s.tenant_id=$1 AND z.is_active=true
       ORDER BY z.name, s.slot_number`, [tid]);

    const zoneColorMap = {};
    zoneStats.rows.forEach(z => { zoneColorMap[z.id] = z.zone_color; });
    const svgGrid = buildSvgGrid(allSlots.rows, zoneColorMap);

    const occupancyPct = totalSlots.rows[0].c > 0
      ? ((occupiedSlots.rows[0].c / totalSlots.rows[0].c) * 100).toFixed(1) : '0.0';

    let html = SKIP + nav('Dashboard');
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${zones.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Zones</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:${P}">${totalSlots.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Total Slots</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#ef4444">${occupiedSlots.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Occupied</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#22c55e">${occupancyPct}%</div><div style="color:${GRAY};font-size:13px">Occupancy Rate</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#3b82f6">${permits.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Active Permits</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#f59e0b">${violations.rows[0].c}</div><div style="color:${GRAY};font-size:13px">Pending Violations</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${fmtMoney(todayRevenue.rows[0].rev)}</div><div style="color:${GRAY};font-size:13px">Today Revenue</div></div>`;
    html += '</div>';

    // SVG Grid
    html += '<div class="card"><h3 style="margin-bottom:12px">Live Parking Occupancy Grid</h3>';
    html += allSlots.rows.length ? svgGrid : '<p style="color:#94a3b8">No slots configured. Add zones first.</p>';
    html += '</div>';

    // Zone breakdown
    html += '<div class="card"><h3 style="margin-bottom:12px">Zone Breakdown</h3>';
    if (zoneStats.rows.length) {
      html += '<table><tr><th>Zone</th><th>Type</th><th>Total</th><th>Available</th><th>Occupied</th><th>EV Slots</th><th>Occupancy</th><th>Rate/hr</th></tr>';
      zoneStats.rows.forEach(z => {
        const total = parseInt(z.total_slots) || (parseInt(z.available) + parseInt(z.occupied));
        const pct = total > 0 ? ((parseInt(z.occupied) / total) * 100).toFixed(0) : '0';
        const barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';
        html += `<tr>
          <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(z.zone_color)};margin-right:6px"></span><strong>${esc(z.name)}</strong></td>
          <td>${badge(z.type, '#e0e7ff')}</td>
          <td>${total}</td><td>${z.available}</td><td>${z.occupied}</td>
          <td>${z.ev_slots || 0}</td>
          <td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px;max-width:80px"><div style="width:${pct}%;background:${barColor};height:8px;border-radius:4px"></div></div><span style="font-size:12px">${pct}%</span></div></td>
          <td>${fmtMoney(z.hourly_rate)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No zones configured yet.</p>'; }
    html += '</div>';

    // Recent activity
    const recentLogs = await pool.query(
      `SELECT pl.*, s.slot_number, z.name AS zone_name
       FROM parking_logs pl
       JOIN parking_slots s ON s.id=pl.slot_id
       LEFT JOIN parking_zones z ON z.id=pl.zone_id
       WHERE pl.tenant_id=$1 ORDER BY pl.created_at DESC LIMIT 10`, [tid]);
    if (recentLogs.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Recent Activity</h3>';
      html += '<table><tr><th>Vehicle</th><th>Zone</th><th>Slot</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th>Fee</th></tr>';
      recentLogs.rows.forEach(l => {
        html += `<tr>
          <td><strong>${esc(l.vehicle_reg)}</strong></td>
          <td>${esc(l.zone_name || '—')}</td><td>${esc(l.slot_number)}</td>
          <td>${fmtTime(l.check_in)}</td><td>${l.check_out ? fmtTime(l.check_out) : '<em style="color:#22c55e">In Progress</em>'}</td>
          <td>${l.duration_min ? Math.floor(l.duration_min / 60) + 'h ' + (l.duration_min % 60) + 'm' : '—'}</td>
          <td>${fmtMoney(l.fee_charged)}</td></tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Smart Parking Dashboard', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Zones list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/zones', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      `SELECT z.*,
        COUNT(s.id) AS slot_count,
        COUNT(s.id) FILTER (WHERE s.status='available') AS available_count,
        COUNT(s.id) FILTER (WHERE s.status='occupied') AS occupied_count
       FROM parking_zones z LEFT JOIN parking_slots s ON s.zone_id=z.id
       WHERE z.tenant_id=$1 GROUP BY z.id ORDER BY z.name`, [tid]);

    let html = SKIP + nav('Zones');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Parking Zones</h2>';
    html += `<a href="${navUrl('/zones/new')}" class="btn">+ Add Zone</a></div>`;

    if (zones.rows.length) {
      html += '<table><tr><th>Name</th><th>Type</th><th>Location</th><th>Total Slots</th><th>Available</th><th>Occupied</th><th>Rate/hr</th><th>Status</th><th>Actions</th></tr>';
      zones.rows.forEach(z => {
        const total = parseInt(z.slot_count);
        const occ = total > 0 ? ((parseInt(z.occupied_count) / total) * 100).toFixed(0) : '0';
        html += `<tr>
          <td><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(z.zone_color)};margin-right:8px"></span><strong>${esc(z.name)}</strong></td>
          <td>${badge(z.type, '#e0e7ff')}</td>
          <td>${esc(z.location || '—')}</td>
          <td>${total}</td><td>${z.available_count}</td><td>${z.occupied_count}</td>
          <td>${fmtMoney(z.hourly_rate)}</td>
          <td>${z.is_active ? badge('Active', '#22c55e') : badge('Inactive', '#94a3b8')}</td>
          <td>
            <a href="${navUrl('/zones/' + z.id + '/edit')}" class="btn" style="padding:4px 10px;font-size:12px">Edit</a>
            <a href="${navUrl('/zones/' + z.id + '/slots')}" class="btn" style="padding:4px 10px;font-size:12px;background:#0ea5e9">Slots</a>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p style="color:#94a3b8">No parking zones configured yet. Create your first zone to get started.</p></div>';
    }
    res.send(renderPage('Parking Zones', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Create zone form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/zones/new', requireAuth, requireNotBanned, (req, res) => {
    let html = SKIP + nav('Zones');
    html += '<div class="card"><h2>Add New Parking Zone</h2>';
    html += `<form method="POST" action="${navUrl('/zones/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" required placeholder="e.g. Main Lot A"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            <option value="general">General</option><option value="staff">Staff Only</option>
            <option value="student">Student</option><option value="visitor">Visitor</option>
            <option value="ev_charging">EV Charging</option><option value="reserved">Reserved</option>
            <option value="disabled">Disabled Access</option><option value="motorcycle">Motorcycle</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Total Slots</label>
          <input name="total_slots" type="number" min="1" value="20"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Hourly Rate ($)</label>
          <input name="hourly_rate" type="number" step="0.01" min="0" value="2.00"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" placeholder="e.g. North Campus, Building B"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Color</label>
          <input name="zone_color" type="color" value="#4f46e5" style="height:42px;padding:4px"></div>
      </div>
      <div style="margin-top:16px">
        <label><input type="checkbox" name="is_active" checked> Active</label>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Create Zone</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Add Parking Zone', html, req.session.user, req));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save zone + auto-generate slots
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/zones/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, total_slots, hourly_rate, location, zone_color, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    const zoneResult = await pool.query(
      `INSERT INTO parking_zones (tenant_id, name, type, total_slots, zone_color, location, hourly_rate, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tid, name.trim(), type || 'general', parseInt(total_slots) || 20,
       zone_color || '#4f46e5', location || null, parseFloat(hourly_rate) || 2.00,
       is_active !== undefined && is_active !== 'false']);
    const zoneId = zoneResult.rows[0].id;

    // Auto-generate slots
    const slotCount = parseInt(total_slots) || 20;
    const isEV = type === 'ev_charging';
    const isReserved = type === 'reserved';
    const isDisabled = type === 'disabled';
    for (let i = 1; i <= slotCount; i++) {
      const rowLetter = String.fromCharCode(65 + Math.floor((i - 1) / 8));
      const colNum = ((i - 1) % 8) + 1;
      const slotNum = rowLetter + colNum;
      await pool.query(
        `INSERT INTO parking_slots (tenant_id, zone_id, slot_number, vehicle_type, is_ev_charging, is_reserved, is_disabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tid, zoneId, slotNum, 'any', isEV, isReserved, isDisabled]);
    }
    audit(req, 'parking_zone_created', { zone_id: zoneId, name: name.trim() });
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Edit zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/zones/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query('SELECT * FROM parking_zones WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    let html = SKIP + nav('Zones');
    html += `<div class="card"><h2>Edit Zone: ${esc(z.name)}</h2>`;
    html += `<form method="POST" action="${navUrl('/zones/' + z.id + '/update')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Name *</label>
          <input name="name" value="${esc(z.name)}" required></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Type</label>
          <select name="type">
            ${['general','staff','student','visitor','ev_charging','reserved','disabled','motorcycle']
              .map(t => `<option value="${t}" ${z.type === t ? 'selected' : ''}>${t.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Hourly Rate ($)</label>
          <input name="hourly_rate" type="number" step="0.01" min="0" value="${z.hourly_rate}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Location</label>
          <input name="location" value="${esc(z.location || '')}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone Color</label>
          <input name="zone_color" type="color" value="${esc(z.zone_color)}" style="height:42px;padding:4px"></div>
      </div>
      <div style="margin-top:16px"><label><input type="checkbox" name="is_active" ${z.is_active ? 'checked' : ''}> Active</label></div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Save Changes</button>
        <a href="${navUrl('/zones')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Edit Zone', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Update zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/zones/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { name, type, hourly_rate, location, zone_color, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).send('Zone name is required.');
    await pool.query(
      `UPDATE parking_zones SET name=$1, type=$2, hourly_rate=$3, location=$4, zone_color=$5, is_active=$6
       WHERE id=$7 AND tenant_id=$8`,
      [name.trim(), type || 'general', parseFloat(hourly_rate) || 2.00,
       location || null, zone_color || '#4f46e5',
       is_active !== undefined && is_active !== 'false', id, tid]);
    audit(req, 'parking_zone_updated', { zone_id: id });
    res.redirect(navUrl('/zones'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Manage slots for a zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/zones/:id/slots', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zone = await pool.query('SELECT * FROM parking_zones WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    const z = zone.rows[0];
    const slots = await pool.query(
      `SELECT s.*, (SELECT pl.vehicle_reg FROM parking_logs pl WHERE pl.slot_id=s.id AND pl.check_out IS NULL LIMIT 1) AS current_vehicle
       FROM parking_slots s WHERE s.zone_id=$1 AND s.tenant_id=$2 ORDER BY s.slot_number`, [z.id, tid]);

    const statusColors = { available: '#22c55e', occupied: '#ef4444', reserved: '#f59e0b', maintenance: '#d1d5db' };

    let html = SKIP + nav('Zones');
    html += `<a href="${navUrl('/zones')}" style="color:${P};text-decoration:none;margin-bottom:12px;display:inline-block">&larr; Back to Zones</a>`;
    html += `<div class="card"><h2>Slots: ${esc(z.name)} <span style="background:${esc(z.zone_color)};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;margin-left:8px">${esc(z.type)}</span></h2>`;

    // Zone SVG
    const zoneColorMap = { [z.id]: z.zone_color };
    const svgGrid = buildSvgGrid(slots.rows, zoneColorMap);
    html += '<div style="margin-bottom:16px">' + svgGrid + '</div>';

    // Add single slot form
    html += `<form method="POST" action="${navUrl('/zones/' + z.id + '/add-slot')}" style="display:inline-flex;gap:8px;margin-bottom:16px;align-items:end">
      <div><label style="font-size:12px;color:${GRAY}">Slot #</label><input name="slot_number" placeholder="e.g. Z1" style="width:100px"></div>
      <div><label style="font-size:12px;color:${GRAY}">Vehicle Type</label><select name="vehicle_type" style="width:100px">
        <option value="any">Any</option><option value="car">Car</option><option value="motorcycle">Motorcycle</option><option value="ev">EV Only</option>
      </select></div>
      <div><label style="font-size:12px;color:${GRAY}">EV</label><input type="checkbox" name="is_ev_charging" style="width:auto"></div>
      <div><label style="font-size:12px;color:${GRAY}">Reserved</label><input type="checkbox" name="is_reserved" style="width:auto"></div>
      <div><label style="font-size:12px;color:${GRAY}">Disabled</label><input type="checkbox" name="is_disabled" style="width:auto"></div>
      <button type="submit" class="btn" style="padding:8px 12px">+ Slot</button>
    </form>`;

    if (slots.rows.length) {
      html += '<table><tr><th>Slot #</th><th>Status</th><th>Vehicle Type</th><th>Current Vehicle</th><th>EV</th><th>Reserved</th><th>Disabled</th><th>Actions</th></tr>';
      slots.rows.forEach(s => {
        const sc = statusColors[s.status] || '#94a3b8';
        html += `<tr>
          <td><strong>${esc(s.slot_number)}</strong></td>
          <td>${badge(s.status, sc)}</td>
          <td>${esc(s.vehicle_type)}</td>
          <td>${esc(s.current_vehicle || '—')}</td>
          <td>${s.is_ev_charging ? '⚡' : '—'}</td>
          <td>${s.is_reserved ? '🔒' : '—'}</td>
          <td>${s.is_disabled ? '♿' : '—'}</td>
          <td>
            ${s.status === 'occupied'
              ? `<form method="POST" action="${navUrl('/slots/' + s.id + '/release')}" style="display:inline" onsubmit="return confirm('Release this slot?')"><button class="btn" style="padding:4px 10px;font-size:12px;background:#f59e0b">Release</button></form>`
              : s.status === 'available'
                ? `<form method="POST" action="${navUrl('/slots/' + s.id + '/toggle-maintenance')}" style="display:inline"><button class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Maint.</button></form>`
                : `<form method="POST" action="${navUrl('/slots/' + s.id + '/toggle-maintenance')}" style="display:inline"><button class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Activate</button></form>`
            }
            <form method="POST" action="${navUrl('/slots/' + s.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete slot ${esc(s.slot_number)}?')"><button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Delete</button></form>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p style="color:#94a3b8">No slots in this zone.</p>';
    }
    html += '</div>';
    res.send(renderPage('Zone Slots', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Add single slot to zone
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/zones/:id/add-slot', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const { slot_number, vehicle_type, is_ev_charging, is_reserved, is_disabled } = req.body;
    if (!slot_number || !slot_number.trim()) return res.status(400).send('Slot number is required.');
    const zone = await pool.query('SELECT id FROM parking_zones WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!zone.rows.length) return res.status(404).send('Zone not found.');
    try {
      await pool.query(
        `INSERT INTO parking_slots (tenant_id, zone_id, slot_number, vehicle_type, is_ev_charging, is_reserved, is_disabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tid, id, slot_number.trim(), vehicle_type || 'any',
         is_ev_charging === 'on', is_reserved === 'on', is_disabled === 'on']);
    } catch (e) {
      if (e.code === '23505') return res.send(alertBox('Slot number already exists in this zone.', 'warning') + '<a href="javascript:history.back()">Go back</a>');
    }
    res.redirect(navUrl('/zones/' + id + '/slots'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Release slot (force check-out)
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/slots/:id/release', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const slot = await pool.query('SELECT * FROM parking_slots WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!slot.rows.length) return res.status(404).send('Slot not found.');
    const now = new Date();
    await pool.query("UPDATE parking_logs SET check_out=$1, duration_min=EXTRACT(EPOCH FROM ($1 - check_in))::int/60 WHERE slot_id=$2 AND check_out IS NULL", [now, id]);
    await pool.query("UPDATE parking_slots SET status='available' WHERE id=$1 AND tenant_id=$2", [id, tid]);
    audit(req, 'parking_slot_released', { slot_id: id });
    res.redirect(req.headers.referer || navUrl(''));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Toggle maintenance
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/slots/:id/toggle-maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const slot = await pool.query('SELECT status FROM parking_slots WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!slot.rows.length) return res.status(404).send('Slot not found.');
    const newStatus = slot.rows[0].status === 'maintenance' ? 'available' : 'maintenance';
    await pool.query('UPDATE parking_slots SET status=$1 WHERE id=$2 AND tenant_id=$3', [newStatus, id, tid]);
    res.redirect(req.headers.referer || navUrl(''));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Delete slot
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/slots/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const slot = await pool.query('SELECT zone_id FROM parking_slots WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!slot.rows.length) return res.status(404).send('Slot not found.');
    await pool.query('DELETE FROM parking_logs WHERE slot_id=$1', [id]);
    await pool.query('DELETE FROM parking_slots WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.redirect(navUrl('/zones/' + slot.rows[0].zone_id + '/slots'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Permits management
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/permits', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'p.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND p.status=$2'; params.push(filter); }

    const permits = await pool.query(
      `SELECT p.* FROM parking_permits p WHERE ${where} ORDER BY p.created_at DESC`, params);

    let html = SKIP + nav('Permits');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Parking Permits</h2>';
    html += `<a href="${navUrl('/permits/new')}" class="btn">+ Issue Permit</a></div>`;

    // Filters
    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['active', 'Active'], ['expired', 'Expired'], ['revoked', 'Revoked']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/permits?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (permits.rows.length) {
      html += '<table><tr><th>ID</th><th>Vehicle Reg</th><th>Type</th><th>Make/Color</th><th>Permit Type</th><th>Valid From</th><th>Valid To</th><th>Monthly Rate</th><th>Status</th><th>Actions</th></tr>';
      permits.rows.forEach(p => {
        const isExpired = p.status !== 'revoked' && new Date(p.valid_to) < new Date();
        const displayStatus = isExpired ? 'expired' : p.status;
        const sc = displayStatus === 'active' ? '#22c55e' : displayStatus === 'expired' ? '#f59e0b' : '#ef4444';
        html += `<tr>
          <td>#${p.id}</td>
          <td><strong>${esc(p.vehicle_reg)}</strong></td>
          <td>${esc(p.vehicle_type)}</td>
          <td>${esc(p.vehicle_make || '—')} ${p.vehicle_color ? '(' + esc(p.vehicle_color) + ')' : ''}</td>
          <td>${badge(p.permit_type, '#e0e7ff')}</td>
          <td>${fmtDate(p.valid_from)}</td><td>${fmtDate(p.valid_to)}</td>
          <td>${p.monthly_rate > 0 ? fmtMoney(p.monthly_rate) : '—'}</td>
          <td>${badge(displayStatus, sc)}</td>
          <td>
            ${p.status === 'active'
              ? `<form method="POST" action="${navUrl('/permits/' + p.id + '/revoke')}" style="display:inline" onsubmit="return confirm('Revoke this permit?')"><button class="btn" style="padding:4px 10px;font-size:12px;background:#ef4444">Revoke</button></form>`
              : ''}
            <form method="POST" action="${navUrl('/permits/' + p.id + '/delete')}" style="display:inline" onsubmit="return confirm('Delete this permit?')"><button class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Delete</button></form>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p style="color:#94a3b8">No permits found.</p></div>';
    }
    res.send(renderPage('Parking Permits', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — New permit form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/permits/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    let html = SKIP + nav('Permits');
    html += '<div class="card"><h2>Issue New Parking Permit</h2>';
    html += `<form method="POST" action="${navUrl('/permits/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Registration *</label>
          <input name="vehicle_reg" required placeholder="e.g. ABC-1234"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Type</label>
          <select name="vehicle_type"><option value="car">Car</option><option value="motorcycle">Motorcycle</option><option value="ev">Electric Vehicle</option><option value="suv">SUV</option><option value="van">Van/Truck</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Make</label>
          <input name="vehicle_make" placeholder="e.g. Toyota Camry"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Color</label>
          <input name="vehicle_color" placeholder="e.g. Silver"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Permit Type</label>
          <select name="permit_type"><option value="daily">Daily Pass</option><option value="weekly">Weekly Pass</option><option value="monthly">Monthly Pass</option><option value="semester">Semester Pass</option><option value="annual">Annual Pass</option><option value="visitor">Visitor Pass</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Monthly Rate ($)</label>
          <input name="monthly_rate" type="number" step="0.01" min="0" value="0"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid From</label>
          <input name="valid_from" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Valid To</label>
          <input name="valid_to" type="date"></div>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn">Issue Permit</button>
        <a href="${navUrl('/permits')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Issue Parking Permit', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Save permit
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/permits/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { vehicle_reg, vehicle_type, vehicle_make, vehicle_color, permit_type, monthly_rate, valid_from, valid_to } = req.body;
    if (!vehicle_reg || !vehicle_reg.trim()) return res.status(400).send('Vehicle registration is required.');
    await pool.query(
      `INSERT INTO parking_permits (tenant_id, user_id, vehicle_reg, vehicle_type, vehicle_make, vehicle_color, permit_type, monthly_rate, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [tid, req.session.user.id, vehicle_reg.trim().toUpperCase(), vehicle_type || 'car',
       vehicle_make || null, vehicle_color || null, permit_type || 'daily',
       parseFloat(monthly_rate) || 0, valid_from || new Date().toISOString().split('T')[0],
       valid_to || new Date(Date.now() + 86400000).toISOString().split('T')[0]]);
    audit(req, 'parking_permit_issued', { vehicle_reg: vehicle_reg.trim().toUpperCase(), permit_type });
    res.redirect(navUrl('/permits'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 15 — Revoke permit
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/permits/:id/revoke', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE parking_permits SET status='revoked' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'parking_permit_revoked', { permit_id: req.params.id });
    res.redirect(navUrl('/permits'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 16 — Delete permit
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/permits/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM parking_permits WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.redirect(navUrl('/permits'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 17 — Check-in page
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query('SELECT id, name, type, hourly_rate FROM parking_zones WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]);
    const activePermits = await pool.query(
      "SELECT id, vehicle_reg, vehicle_type, permit_type FROM parking_permits WHERE tenant_id=$1 AND status='active' AND valid_to >= CURRENT_DATE ORDER BY vehicle_reg", [tid]);

    let html = SKIP + nav('Check-In');
    html += '<div class="card"><h2>Vehicle Check-In</h2>';
    html += `<form method="POST" action="${navUrl('/checkin/process')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Registration *</label>
          <input name="vehicle_reg" required placeholder="e.g. ABC-1234" id="vehicleRegInput">
          <datalist id="permitVehicles">
            ${activePermits.rows.map(p => `<option value="${esc(p.vehicle_reg)}">`).join('')}
          </datalist></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone *</label>
          <select name="zone_id" required>
            <option value="">-- Select Zone --</option>
            ${zones.rows.map(z => `<option value="${z.id}">${esc(z.name)} (${esc(z.type)}) — ${fmtMoney(z.hourly_rate)}/hr</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Preferred Slot (optional)</label>
          <select name="slot_id"><option value="">-- Auto-assign --</option></select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Permit (optional)</label>
          <select name="permit_id"><option value="">-- No Permit --</option>
            ${activePermits.rows.map(p => `<option value="${p.id}">${esc(p.vehicle_reg)} (${esc(p.permit_type)})</option>`).join('')}
          </select></div>
      </div>
      <div style="margin-top:16px">
        <button type="submit" class="btn" style="background:#22c55e">Check In Vehicle</button>
      </div>
    </form></div>`;

    // Current active check-ins
    const activeCheckins = await pool.query(
      `SELECT pl.*, s.slot_number, z.name AS zone_name, z.hourly_rate
       FROM parking_logs pl
       JOIN parking_slots s ON s.id=pl.slot_id
       LEFT JOIN parking_zones z ON z.id=pl.zone_id
       WHERE pl.tenant_id=$1 AND pl.check_out IS NULL
       ORDER BY pl.check_in DESC LIMIT 20`, [tid]);

    if (activeCheckins.rows.length) {
      html += '<div class="card"><h3 style="margin-bottom:12px">Currently Parked (' + activeCheckins.rows.length + ')</h3>';
      html += '<table><tr><th>Vehicle</th><th>Zone</th><th>Slot</th><th>Check-In Time</th><th>Duration</th><th>Est. Fee</th><th>Actions</th></tr>';
      activeCheckins.rows.forEach(l => {
        const durMin = Math.round((Date.now() - new Date(l.check_in).getTime()) / 60000);
        const hrs = Math.floor(durMin / 60);
        const mins = durMin % 60;
        const estFee = (durMin / 60) * parseFloat(l.hourly_rate || 2);
        html += `<tr>
          <td><strong>${esc(l.vehicle_reg)}</strong></td>
          <td>${esc(l.zone_name)}</td><td>${esc(l.slot_number)}</td>
          <td>${fmtTime(l.check_in)}</td>
          <td>${hrs}h ${mins}m</td>
          <td>${fmtMoney(estFee)}</td>
          <td><a href="${navUrl('/checkout?log_id=' + l.id + '&slot_id=' + l.slot_id)}" class="btn" style="padding:4px 10px;font-size:12px;background:#f59e0b">Check Out</a></td>
        </tr>`;
      });
      html += '</table></div>';
    }

    res.send(renderPage('Vehicle Check-In', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 18 — Process check-in
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/checkin/process', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { vehicle_reg, zone_id, slot_id, permit_id } = req.body;
    if (!vehicle_reg || !vehicle_reg.trim() || !zone_id) return res.status(400).send('Vehicle registration and zone are required.');

    // Check permit validity
    let finalSlotId = slot_id && slot_id.trim() ? parseInt(slot_id) : null;
    if (finalSlotId) {
      const slotCheck = await pool.query(
        "SELECT id FROM parking_slots WHERE id=$1 AND zone_id=$2 AND status='available' AND tenant_id=$3",
        [finalSlotId, zone_id, tid]);
      if (!slotCheck.rows.length) finalSlotId = null;
    }
    if (!finalSlotId) {
      const slotResult = await pool.query(
        "SELECT id FROM parking_slots WHERE zone_id=$1 AND status='available' AND tenant_id=$2 ORDER BY slot_number LIMIT 1",
        [zone_id, tid]);
      if (!slotResult.rows.length) return res.send(alertBox('No available slots in this zone. Please try another zone.', 'error') + `<a href="${navUrl('/checkin')}">Try Again</a>`);
      finalSlotId = slotResult.rows[0].id;
    }

    await pool.query(
      `INSERT INTO parking_logs (tenant_id, slot_id, permit_id, vehicle_reg, zone_id, check_in)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [tid, finalSlotId, permit_id && permit_id.trim() ? parseInt(permit_id) : null,
       vehicle_reg.trim().toUpperCase(), parseInt(zone_id)]);
    await pool.query("UPDATE parking_slots SET status='occupied' WHERE id=$1 AND tenant_id=$2", [finalSlotId, tid]);

    audit(req, 'parking_checkin', { vehicle_reg: vehicle_reg.trim().toUpperCase(), zone_id, slot_id: finalSlotId });
    res.redirect(navUrl('/checkin'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 19 — Check-out page
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/checkout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { log_id, slot_id } = req.query;
    if (!log_id || !slot_id) return res.redirect(navUrl('/checkin'));

    const log = await pool.query(
      `SELECT pl.*, s.slot_number, z.name AS zone_name, z.hourly_rate, p.permit_type
       FROM parking_logs pl
       JOIN parking_slots s ON s.id=pl.slot_id
       LEFT JOIN parking_zones z ON z.id=pl.zone_id
       LEFT JOIN parking_permits p ON p.id=pl.permit_id
       WHERE pl.id=$1 AND pl.tenant_id=$2 AND pl.check_out IS NULL`, [log_id, tid]);
    if (!log.rows.length) return res.send(alertBox('Active parking session not found.', 'error') + `<a href="${navUrl('/checkin')}">Back</a>`);

    const l = log.rows[0];
    const durMin = Math.round((Date.now() - new Date(l.check_in).getTime()) / 60000);
    const hrs = durMin / 60;
    const rate = parseFloat(l.hourly_rate || 2);
    const fee = Math.max(0, hrs * rate);
    const hasPermit = l.permit_type && ['monthly', 'semester', 'annual'].includes(l.permit_type);

    let html = SKIP + nav('Check-Out');
    html += '<div class="card"><h2>Vehicle Check-Out</h2>';
    html += `<form method="POST" action="${navUrl('/checkout/process')}">
      <input type="hidden" name="log_id" value="${l.id}">
      <input type="hidden" name="slot_id" value="${l.slot_id}">
      <table style="max-width:500px">
        <tr><td style="font-weight:600">Vehicle:</td><td><strong>${esc(l.vehicle_reg)}</strong></td></tr>
        <tr><td style="font-weight:600">Zone:</td><td>${esc(l.zone_name)}</td></tr>
        <tr><td style="font-weight:600">Slot:</td><td>${esc(l.slot_number)}</td></tr>
        <tr><td style="font-weight:600">Check-In:</td><td>${new Date(l.check_in).toLocaleString()}</td></tr>
        <tr><td style="font-weight:600">Duration:</td><td>${Math.floor(hrs)}h ${durMin % 60}m</td></tr>
        <tr><td style="font-weight:600">Rate:</td><td>${fmtMoney(rate)}/hr</td></tr>
        <tr><td style="font-weight:600">Permit:</td><td>${l.permit_type ? badge(l.permit_type, '#e0e7ff') : 'None'}</td></tr>
        <tr><td style="font-weight:600;font-size:18px">Fee Due:</td>
          <td style="font-size:24px;font-weight:700;color:#ef4444">${hasPermit ? '<span style="color:#22c55e">$0.00 (Covered by permit)</span>' : fmtMoney(fee)}</td></tr>
      </table>
      <div style="margin-top:16px">
        <button type="submit" class="btn" style="background:#f59e0b">Confirm Check-Out</button>
        <a href="${navUrl('/checkin')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Vehicle Check-Out', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 20 — Process check-out
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/checkout/process', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { log_id, slot_id } = req.body;
    const log = await pool.query(
      `SELECT pl.*, z.hourly_rate, p.permit_type
       FROM parking_logs pl
       LEFT JOIN parking_zones z ON z.id=pl.zone_id
       LEFT JOIN parking_permits p ON p.id=pl.permit_id
       WHERE pl.id=$1 AND pl.tenant_id=$2 AND pl.check_out IS NULL`, [log_id, tid]);
    if (!log.rows.length) return res.redirect(navUrl('/checkin'));

    const l = log.rows[0];
    const now = new Date();
    const durMin = Math.round((now - new Date(l.check_in).getTime()) / 60000);
    const rate = parseFloat(l.hourly_rate || 2);
    const hrs = durMin / 60;
    const hasPermit = l.permit_type && ['monthly', 'semester', 'annual'].includes(l.permit_type);
    const fee = hasPermit ? 0 : Math.max(0, hrs * rate);

    await pool.query(
      "UPDATE parking_logs SET check_out=$1, duration_min=$2, fee_charged=$3 WHERE id=$4 AND tenant_id=$5",
      [now, durMin, fee, log_id, tid]);
    await pool.query(
      "UPDATE parking_slots SET status='available' WHERE id=$1 AND tenant_id=$2",
      [slot_id, tid]);

    audit(req, 'parking_checkout', { log_id, vehicle_reg: l.vehicle_reg, duration_min: durMin, fee });
    res.redirect(navUrl('/checkin'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 21 — Violations
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/violations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const filter = req.query.status || '';
    let where = 'v.tenant_id=$1', params = [tid];
    if (filter) { where += ' AND v.status=$2'; params.push(filter); }

    const violations = await pool.query(
      `SELECT v.*, z.name AS zone_name FROM parking_violations v
       LEFT JOIN parking_zones z ON z.id=v.zone_id
       WHERE ${where} ORDER BY v.created_at DESC`, params);

    const totalFines = await pool.query(
      "SELECT COALESCE(SUM(fine_amount),0)::numeric AS total, COALESCE(SUM(fine_amount) FILTER (WHERE status='paid'),0)::numeric AS collected FROM parking_violations WHERE tenant_id=$1", [tid]);

    let html = SKIP + nav('Violations');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
    html += '<h2>Parking Violations</h2>';
    html += `<a href="${navUrl('/violations/new')}" class="btn" style="background:#ef4444">+ Log Violation</a></div>`;

    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">';
    html += `<div class="card" style="text-align:center"><div style="font-size:24px;font-weight:700;color:#ef4444">${fmtMoney(totalFines.rows[0].total)}</div><div style="color:${GRAY};font-size:13px">Total Fines</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:24px;font-weight:700;color:#22c55e">${fmtMoney(totalFines.rows[0].collected)}</div><div style="color:${GRAY};font-size:13px">Collected</div></div>`;
    html += `<div class="card" style="text-align:center"><div style="font-size:24px;font-weight:700;color:#f59e0b">${fmtMoney(parseFloat(totalFines.rows[0].total) - parseFloat(totalFines.rows[0].collected))}</div><div style="color:${GRAY};font-size:13px">Outstanding</div></div>`;
    html += '</div>';

    html += '<div style="display:flex;gap:6px;margin-bottom:16px">';
    [['', 'All'], ['pending', 'Pending'], ['paid', 'Paid'], ['dismissed', 'Dismissed']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/violations?status=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (filter === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    if (violations.rows.length) {
      html += '<table><tr><th>ID</th><th>Vehicle</th><th>Zone</th><th>Violation</th><th>Fine</th><th>Status</th><th>Date</th><th>Actions</th></tr>';
      violations.rows.forEach(v => {
        const sc = v.status === 'paid' ? '#22c55e' : v.status === 'dismissed' ? '#94a3b8' : '#f59e0b';
        html += `<tr>
          <td>#${v.id}</td>
          <td><strong>${esc(v.vehicle_reg)}</strong></td>
          <td>${esc(v.zone_name || '—')}</td>
          <td>${badge(v.violation_type, '#fee2e2')}</td>
          <td><strong>${fmtMoney(v.fine_amount)}</strong></td>
          <td>${badge(v.status, sc)}</td>
          <td>${new Date(v.created_at).toLocaleDateString()}</td>
          <td>
            ${v.status === 'pending' ? `
              <form method="POST" action="${navUrl('/violations/' + v.id + '/pay')}" style="display:inline"><button class="btn" style="padding:4px 10px;font-size:12px;background:#22c55e">Mark Paid</button></form>
              <form method="POST" action="${navUrl('/violations/' + v.id + '/dismiss')}" style="display:inline"><button class="btn" style="padding:4px 10px;font-size:12px;background:#6b7280">Dismiss</button></form>
            ` : ''}
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p style="color:#94a3b8">No violations recorded.</p></div>';
    }
    res.send(renderPage('Parking Violations', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 22 — New violation form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/violations/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query('SELECT id, name FROM parking_zones WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]);
    let html = SKIP + nav('Violations');
    html += '<div class="card"><h2>Log New Violation</h2>';
    html += `<form method="POST" action="${navUrl('/violations/create')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Vehicle Registration *</label>
          <input name="vehicle_reg" required placeholder="e.g. ABC-1234"></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Zone</label>
          <select name="zone_id"><option value="">-- Select --</option>
            ${zones.rows.map(z => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Violation Type *</label>
          <select name="violation_type" required>
            <option value="no_permit">No Valid Permit</option><option value="expired_permit">Expired Permit</option>
            <option value="wrong_zone">Wrong Zone</option><option value="reserved_slot">Parked in Reserved Slot</option>
            <option value="disabled_slot">Parked in Disabled Slot</option><option value="double_parked">Double Parked</option>
            <option value="blocking">Blocking Traffic/Driveway</option><option value="overstay">Overstay</option>
            <option value="no_display">Permit Not Displayed</option><option value="other">Other</option>
          </select></div>
        <div><label style="display:block;margin-bottom:4px;font-weight:600">Fine Amount ($)</label>
          <input name="fine_amount" type="number" step="0.01" min="0" value="25.00"></div>
      </div>
      <div style="margin-top:16px"><label style="display:block;margin-bottom:4px;font-weight:600">Description / Evidence Notes</label>
        <textarea name="description" rows="3" placeholder="Describe the violation..."></textarea></div>
      <div style="margin-top:16px">
        <button type="submit" class="btn" style="background:#ef4444">Log Violation</button>
        <a href="${navUrl('/violations')}" style="margin-left:8px;color:${GRAY}">Cancel</a>
      </div>
    </form></div>`;
    res.send(renderPage('Log Violation', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 23 — Create violation
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/violations/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { vehicle_reg, zone_id, violation_type, fine_amount, description } = req.body;
    if (!vehicle_reg || !vehicle_reg.trim()) return res.status(400).send('Vehicle registration is required.');
    await pool.query(
      `INSERT INTO parking_violations (tenant_id, vehicle_reg, zone_id, violation_type, description, fine_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, vehicle_reg.trim().toUpperCase(), zone_id || null, violation_type || 'other',
       description || null, parseFloat(fine_amount) || 25.00, req.session.user.id]);
    audit(req, 'parking_violation_created', { vehicle_reg: vehicle_reg.trim().toUpperCase(), violation_type });
    res.redirect(navUrl('/violations'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 24 — Pay / dismiss violation
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/school/parking/violations/:id/pay', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE parking_violations SET status='paid' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'parking_violation_paid', { violation_id: req.params.id });
    res.redirect(navUrl('/violations'));
  }));

  app.post('/school/parking/violations/:id/dismiss', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE parking_violations SET status='dismissed' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    res.redirect(navUrl('/violations'));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 25 — Revenue reports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/revenue', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const period = req.query.period || 'week';

    const dateRanges = {
      day: "AND pl.check_in >= CURRENT_DATE",
      week: "AND pl.check_in >= CURRENT_DATE - INTERVAL '7 days'",
      month: "AND pl.check_in >= CURRENT_DATE - INTERVAL '30 days'",
      quarter: "AND pl.check_in >= CURRENT_DATE - INTERVAL '90 days'",
      year: "AND pl.check_in >= CURRENT_DATE - INTERVAL '365 days'",
    };
    const rangeWhere = dateRanges[period] || dateRanges.week;

    const revenue = await pool.query(
      `SELECT
        COALESCE(SUM(pl.fee_charged),0)::numeric AS total_revenue,
        COUNT(pl.id)::int AS total_sessions,
        COALESCE(AVG(pl.duration_min),0)::int AS avg_duration,
        COALESCE(SUM(pl.fee_charged) FILTER (WHERE pl.permit_id IS NULL),0)::numeric AS casual_revenue,
        COUNT(pl.id) FILTER (WHERE pl.permit_id IS NULL)::int AS casual_sessions,
        COALESCE(SUM(pl.fee_charged) FILTER (WHERE pl.permit_id IS NOT NULL),0)::numeric AS permit_revenue
       FROM parking_logs pl WHERE pl.tenant_id=$1 AND pl.check_out IS NOT NULL ${rangeWhere}`, [tid]);

    const zoneRevenue = await pool.query(
      `SELECT z.name, z.type, z.hourly_rate,
        COUNT(pl.id)::int AS sessions,
        COALESCE(SUM(pl.fee_charged),0)::numeric AS revenue,
        COALESCE(AVG(pl.duration_min),0)::int AS avg_duration
       FROM parking_logs pl
       JOIN parking_zones z ON z.id=pl.zone_id
       WHERE pl.tenant_id=$1 AND pl.check_out IS NOT NULL ${rangeWhere}
       GROUP BY z.id ORDER BY revenue DESC`, [tid]);

    const dailyRevenue = await pool.query(
      `SELECT DATE(pl.check_in) AS day, COUNT(pl.id)::int AS sessions,
        COALESCE(SUM(pl.fee_charged),0)::numeric AS revenue
       FROM parking_logs pl
       WHERE pl.tenant_id=$1 AND pl.check_out IS NOT NULL ${rangeWhere}
       GROUP BY DATE(pl.check_in) ORDER BY day DESC LIMIT 14`, [tid]);

    const violationRevenue = await pool.query(
      `SELECT COALESCE(SUM(fine_amount) FILTER (WHERE status='paid'),0)::numeric AS fines_collected,
        COUNT(*)::int AS total_violations, COUNT(*) FILTER (WHERE status='paid')::int AS paid_violations
       FROM parking_violations WHERE tenant_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'`, [tid]);

    const r = revenue.rows[0];
    let html = SKIP + nav('Revenue');
    html += '<h2 style="margin-bottom:16px">Parking Revenue Report</h2>';

    // Period filter
    html += '<div style="display:flex;gap:6px;margin-bottom:20px">';
    [['day','Today'],['week','This Week'],['month','This Month'],['quarter','Quarter'],['year','Year']].forEach(([v, l]) => {
      html += `<a href="${navUrl('/revenue?period=' + v)}" style="padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;` +
        (period === v ? `background:${P};color:#fff` : `background:#f3f4f6;color:${GRAY}`) + `">${l}</a>`;
    });
    html += '</div>';

    // KPI cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px">';
    html += `<div class="card" style="text-align:center;border-left:4px solid ${P}"><div style="font-size:28px;font-weight:700;color:${P}">${fmtMoney(r.total_revenue)}</div><div style="color:${GRAY};font-size:13px">Total Revenue</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #22c55e"><div style="font-size:28px;font-weight:700;color:#22c55e">${r.total_sessions}</div><div style="color:${GRAY};font-size:13px">Sessions</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #f59e0b"><div style="font-size:28px;font-weight:700;color:#f59e0b">${Math.floor(r.avg_duration/60)}h ${r.avg_duration%60}m</div><div style="color:${GRAY};font-size:13px">Avg Duration</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #3b82f6"><div style="font-size:28px;font-weight:700;color:#3b82f6">${fmtMoney(r.casual_revenue)}</div><div style="color:${GRAY};font-size:13px">Casual Revenue</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #8b5cf6"><div style="font-size:28px;font-weight:700;color:#8b5cf6">${fmtMoney(r.permit_revenue)}</div><div style="color:${GRAY};font-size:13px">Permit Revenue</div></div>`;
    html += `<div class="card" style="text-align:center;border-left:4px solid #ef4444"><div style="font-size:28px;font-weight:700;color:#ef4444">${fmtMoney(violationRevenue.rows[0].fines_collected)}</div><div style="color:${GRAY};font-size:13px">Fines Collected</div></div>`;
    html += '</div>';

    // Zone revenue table
    html += '<div class="card"><h3 style="margin-bottom:12px">Revenue by Zone</h3>';
    if (zoneRevenue.rows.length) {
      html += '<table><tr><th>Zone</th><th>Type</th><th>Sessions</th><th>Revenue</th><th>Avg Duration</th><th>Rate/hr</th></tr>';
      zoneRevenue.rows.forEach(z => {
        html += `<tr><td><strong>${esc(z.name)}</strong></td><td>${badge(z.type, '#e0e7ff')}</td>
          <td>${z.sessions}</td><td><strong>${fmtMoney(z.revenue)}</strong></td>
          <td>${Math.floor(z.avg_duration/60)}h ${z.avg_duration%60}m</td><td>${fmtMoney(z.hourly_rate)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No data for this period.</p>'; }
    html += '</div>';

    // Daily trend
    html += '<div class="card"><h3 style="margin-bottom:12px">Daily Trend (Last 14 days)</h3>';
    if (dailyRevenue.rows.length) {
      const maxRev = Math.max(...dailyRevenue.rows.map(d => parseFloat(d.revenue)), 1);
      html += '<div style="display:flex;align-items:flex-end;gap:4px;height:180px">';
      dailyRevenue.rows.reverse().forEach(d => {
        const pct = (parseFloat(d.revenue) / maxRev) * 100;
        html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:10px;color:${GRAY}">${fmtMoney(d.revenue)}</div>
          <div style="width:100%;background:${P};border-radius:4px 4px 0 0;height:${Math.max(pct, 2)}%;min-height:4px" title="${d.day}: ${d.sessions} sessions, ${fmtMoney(d.revenue)}"></div>
          <div style="font-size:9px;color:${GRAY};white-space:nowrap">${d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</div>
        </div>`;
      });
      html += '</div>';
    } else { html += '<p style="color:#94a3b8">No daily data.</p>'; }
    html += '</div>';

    res.send(renderPage('Parking Revenue', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 26 — Analytics & Peak Hour Analysis
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Peak hour analysis
    const peakHours = await pool.query(
      `SELECT EXTRACT(HOUR FROM pl.check_in)::int AS hour,
        COUNT(pl.id)::int AS checkins,
        COUNT(pl.id) FILTER (WHERE pl.check_out IS NOT NULL)::int AS completed
       FROM parking_logs pl
       WHERE pl.tenant_id=$1 AND pl.check_in >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY EXTRACT(HOUR FROM pl.check_in) ORDER BY hour`, [tid]);

    // Day of week analysis
    const dayOfWeek = await pool.query(
      `SELECT EXTRACT(DOW FROM pl.check_in)::int AS dow,
        COUNT(pl.id)::int AS sessions,
        COALESCE(AVG(pl.duration_min),0)::int AS avg_duration
       FROM parking_logs pl
       WHERE pl.tenant_id=$1 AND pl.check_in >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY EXTRACT(DOW FROM pl.check_in) ORDER BY dow`, [tid]);

    // Vehicle type distribution
    const vehicleTypes = await pool.query(
      `SELECT p.vehicle_type, COUNT(p.id)::int AS count
       FROM parking_permits p
       WHERE p.tenant_id=$1 AND p.status='active'
       GROUP BY p.vehicle_type ORDER BY count DESC`, [tid]);

    // Zone utilization trends
    const zoneUtil = await pool.query(
      `SELECT z.name, z.total_slots,
        COUNT(s.id) FILTER (WHERE s.status='occupied') AS occupied,
        COUNT(s.id) FILTER (WHERE s.status='available') AS available,
        ROUND(COUNT(s.id) FILTER (WHERE s.status='occupied')::numeric / NULLIF(COUNT(s.id),0) * 100, 1) AS util_pct
       FROM parking_zones z
       LEFT JOIN parking_slots s ON s.zone_id=z.id
       WHERE z.tenant_id=$1 AND z.is_active=true
       GROUP BY z.id ORDER BY util_pct DESC`, [tid]);

    // Permit type distribution
    const permitTypes = await pool.query(
      `SELECT permit_type, COUNT(id)::int AS count,
        COUNT(id) FILTER (WHERE status='active')::int AS active,
        COALESCE(SUM(monthly_rate) FILTER (WHERE status='active'),0)::numeric AS monthly_value
       FROM parking_permits WHERE tenant_id=$1 GROUP BY permit_type ORDER BY count DESC`, [tid]);

    // Average turnover
    const turnover = await pool.query(
      `SELECT z.name,
        COUNT(pl.id)::int AS total_sessions,
        COALESCE(AVG(pl.duration_min),0)::int AS avg_duration
       FROM parking_logs pl
       JOIN parking_zones z ON z.id=pl.zone_id
       WHERE pl.tenant_id=$1 AND pl.check_out IS NOT NULL AND pl.check_in >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY z.id ORDER BY avg_duration DESC`, [tid]);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const maxHourly = peakHours.rows.length > 0 ? Math.max(...peakHours.rows.map(h => h.checkins)) : 1;

    let html = SKIP + nav('Analytics');
    html += '<h2 style="margin-bottom:16px">Parking Analytics</h2>';

    // Peak hours bar chart
    html += '<div class="card"><h3 style="margin-bottom:12px">Peak Hours (Last 30 Days)</h3>';
    html += '<div style="display:flex;align-items:flex-end;gap:2px;height:200px;border-bottom:2px solid #e5e7eb;padding-bottom:8px">';
    for (let h = 0; h < 24; h++) {
      const entry = peakHours.rows.find(r => r.hour === h);
      const count = entry ? entry.checkins : 0;
      const pct = (count / maxHourly) * 100;
      const isPeak = count > 0 && count >= maxHourly * 0.7;
      html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
        ${count > 0 ? `<div style="font-size:9px;color:${GRAY}">${count}</div>` : ''}
        <div style="width:100%;background:${isPeak ? '#ef4444' : P};border-radius:3px 3px 0 0;height:${Math.max(pct, 1)}%;min-height:2px;opacity:${isPeak ? 1 : 0.7}"></div>
        <div style="font-size:9px;color:${GRAY}">${String(h).padStart(2, '0')}</div>
      </div>`;
    }
    html += '</div>';
    html += '<div style="display:flex;gap:12px;margin-top:8px;font-size:12px;color:' + GRAY + '">';
    html += '<span><span style="display:inline-block;width:12px;height:12px;background:#ef4444;border-radius:2px"></span> Peak Hours</span>';
    html += '<span><span style="display:inline-block;width:12px;height:12px;background:' + P + ';border-radius:2px"></span> Normal</span>';
    html += '</div></div>';

    // Two-column layout
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">';

    // Day of week
    html += '<div class="card"><h3 style="margin-bottom:12px">Traffic by Day of Week</h3>';
    if (dayOfWeek.rows.length) {
      const maxDow = Math.max(...dayOfWeek.rows.map(d => d.sessions));
      dayOfWeek.rows.forEach(d => {
        const pct = maxDow > 0 ? (d.sessions / maxDow * 100) : 0;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:80px;font-size:13px;color:${GRAY}">${dayNames[d.dow]}</span>
          <div style="flex:1;background:#f3f4f6;border-radius:4px;height:24px;overflow:hidden">
            <div style="width:${pct}%;background:${P};height:100%;border-radius:4px;display:flex;align-items:center;padding-left:6px">
              <span style="color:#fff;font-size:11px;font-weight:600">${d.sessions} sessions</span>
            </div>
          </div></div>`;
      });
    } else { html += '<p style="color:#94a3b8">No data.</p>'; }
    html += '</div>';

    // Zone utilization
    html += '<div class="card"><h3 style="margin-bottom:12px">Zone Utilization</h3>';
    if (zoneUtil.rows.length) {
      zoneUtil.rows.forEach(z => {
        const pct = parseFloat(z.util_pct) || 0;
        const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e';
        html += `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
            <span>${esc(z.name)}</span><span style="font-weight:600">${pct}%</span>
          </div>
          <div style="background:#f3f4f6;border-radius:4px;height:16px;overflow:hidden">
            <div style="width:${pct}%;background:${color};height:100%;border-radius:4px"></div>
          </div></div>`;
      });
    } else { html += '<p style="color:#94a3b8">No zones.</p>'; }
    html += '</div>';
    html += '</div>';

    // Two-column: Permit types + Turnover
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:0">';

    // Permit types
    html += '<div class="card"><h3 style="margin-bottom:12px">Permit Distribution</h3>';
    if (permitTypes.rows.length) {
      html += '<table><tr><th>Type</th><th>Total</th><th>Active</th><th>Monthly Value</th></tr>';
      permitTypes.rows.forEach(p => {
        html += `<tr><td>${badge(p.permit_type, '#e0e7ff')}</td><td>${p.count}</td>
          <td>${p.active}</td><td>${fmtMoney(p.monthly_value)}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No permits.</p>'; }
    html += '</div>';

    // Turnover
    html += '<div class="card"><h3 style="margin-bottom:12px">Avg Session Duration by Zone</h3>';
    if (turnover.rows.length) {
      html += '<table><tr><th>Zone</th><th>Sessions</th><th>Avg Duration</th></tr>';
      turnover.rows.forEach(t => {
        html += `<tr><td>${esc(t.name)}</td><td>${t.total_sessions}</td>
          <td>${Math.floor(t.avg_duration/60)}h ${t.avg_duration%60}m</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p style="color:#94a3b8">No data.</p>'; }
    html += '</div>';
    html += '</div>';

    res.send(renderPage('Parking Analytics', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 27 — API: Real-time occupancy JSON
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/api/occupancy', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const zones = await pool.query(
      `SELECT z.id, z.name, z.type, z.zone_color, z.total_slots,
        COUNT(s.id) AS actual_slots,
        COUNT(s.id) FILTER (WHERE s.status='available') AS available,
        COUNT(s.id) FILTER (WHERE s.status='occupied') AS occupied,
        COUNT(s.id) FILTER (WHERE s.status='maintenance') AS maintenance,
        COUNT(s.id) FILTER (WHERE s.is_ev_charging=true) AS ev_slots,
        COUNT(s.id) FILTER (WHERE s.is_reserved=true) AS reserved_slots
       FROM parking_zones z LEFT JOIN parking_slots s ON s.zone_id=z.id
       WHERE z.tenant_id=$1 AND z.is_active=true GROUP BY z.id ORDER BY z.name`, [tid]);

    const totalAvailable = zones.rows.reduce((a, z) => a + parseInt(z.available), 0);
    const totalOccupied = zones.rows.reduce((a, z) => a + parseInt(z.occupied), 0);
    const totalSlots = totalAvailable + totalOccupied;

    res.json({
      timestamp: new Date().toISOString(),
      total_slots: totalSlots,
      available: totalAvailable,
      occupied: totalOccupied,
      occupancy_pct: totalSlots > 0 ? parseFloat(((totalOccupied / totalSlots) * 100).toFixed(1)) : 0,
      zones: zones.rows.map(z => ({
        id: z.id, name: z.name, type: z.type, color: z.zone_color,
        total_slots: parseInt(z.actual_slots),
        available: parseInt(z.available), occupied: parseInt(z.occupied),
        maintenance: parseInt(z.maintenance), ev_slots: parseInt(z.ev_slots),
        reserved_slots: parseInt(z.reserved_slots),
        occupancy_pct: parseInt(z.actual_slots) > 0
          ? parseFloat(((parseInt(z.occupied) / parseInt(z.actual_slots)) * 100).toFixed(1)) : 0,
      })),
    });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 28 — API: Check vehicle status
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/school/parking/api/vehicle/:reg', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const reg = req.params.reg.toUpperCase();

    const activeLog = await pool.query(
      `SELECT pl.id, pl.slot_id, s.slot_number, z.name AS zone_name, z.hourly_rate,
        pl.check_in, p.permit_type, p.valid_to AS permit_valid_to
       FROM parking_logs pl
       JOIN parking_slots s ON s.id=pl.slot_id
       LEFT JOIN parking_zones z ON z.id=pl.zone_id
       LEFT JOIN parking_permits p ON p.id=pl.permit_id
       WHERE pl.tenant_id=$1 AND pl.vehicle_reg=$2 AND pl.check_out IS NULL`, [tid, reg]);

    const permit = await pool.query(
      "SELECT id, permit_type, valid_from, valid_to, status, vehicle_type, vehicle_make, vehicle_color FROM parking_permits WHERE tenant_id=$1 AND vehicle_reg=$2 AND status='active' ORDER BY valid_to DESC LIMIT 1", [tid, reg]);

    const violations = await pool.query(
      "SELECT id, violation_type, fine_amount, status, created_at FROM parking_violations WHERE tenant_id=$1 AND vehicle_reg=$2 ORDER BY created_at DESC LIMIT 5", [tid, reg]);

    res.json({
      registration: reg,
      currently_parked: activeLog.rows.length > 0,
      session: activeLog.rows.length > 0 ? {
        log_id: activeLog.rows[0].id,
        slot: activeLog.rows[0].slot_number,
        zone: activeLog.rows[0].zone_name,
        check_in: activeLog.rows[0].check_in,
        rate_per_hour: activeLog.rows[0].hourly_rate,
        permit_type: activeLog.rows[0].permit_type,
      } : null,
      permit: permit.rows.length > 0 ? permit.rows[0] : null,
      recent_violations: violations.rows,
    });
  }));

  console.log('[SmartParking] Module loaded — 15+ routes on /school/parking');
};
