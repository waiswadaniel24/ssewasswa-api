// ============================================================
// SMART HOSTEL MODULE — AI-Based Room Allocation & Management
// Room CRUD, Smart Allocation, Swaps, Inspections, Maintenance,
// Check-in/Check-out with SVG charts and tenant isolation.
// ============================================================
'use strict';

const { migrateQuery } = require('./db');
module.exports = function smartHostel(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // -- Internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;
  const P = '#4f46e5'; // primary indigo
  const P2 = '#6366f1';
  const PL = '#e0e7ff';
  const PG = '#10b981';
  const PR = '#ef4444';
  const PY = '#f59e0b';

  // -- Shared CSS ---------------------------------------------------------
  const CSS = `<style>
    .sh-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
    .sh-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#4b5563;background:#f3f4f6;transition:.15s}
    .sh-nav a:hover{background:#e0e7ff;color:${P}}
    .sh-nav a.active{background:${P};color:#fff}
    .sh-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s;color:#fff}
    .sh-btn:hover{opacity:.9;transform:translateY(-1px)}
    .sh-btn-p{background:${P}}.sh-btn-g{background:${PG}}.sh-btn-r{background:${PR}}.sh-btn-y{background:${PY}}
    .sh-btn-o{background:transparent;color:#6b7280;border:1px solid #d1d5db}
    .sh-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .sh-tbl{width:100%;border-collapse:collapse;font-size:13px}
    .sh-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid ${PL};color:${P};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .sh-tbl td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1e293b}
    .sh-tbl tr:hover{background:#f8fafc}
    .sh-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px}
    .sh-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);text-align:center}
    .sh-stat-n{font-size:28px;font-weight:800;color:${P};line-height:1.1}
    .sh-stat-l{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
    .sh-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
    .sh-fg{margin-bottom:16px}
    .sh-fg label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px}
    .sh-fg input,.sh-fg select,.sh-fg textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.15s;font-family:inherit}
    .sh-fg input:focus,.sh-fg select:focus,.sh-fg textarea:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .sh-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .sh-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
    .sh-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px}
    .sh-alert-ok{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
    .sh-alert-err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
    .sh-empty{text-align:center;padding:40px;color:#9ca3af;font-size:14px}
    @media(max-width:768px){.sh-grid2,.sh-grid3{grid-template-columns:1fr}.sh-nav{gap:4px}.sh-nav a{padding:6px 10px;font-size:12px}}
  </style>`;

  // -- Badge helpers ------------------------------------------------------
  function badge(text, color) {
    return `<span class="sh-badge" style="background:${color}18;color:${color}">${esc(text)}</span>`;
  }
  function statusBadge(s) {
    const m = { available: [PG, 'Available'], occupied: [P, 'Occupied'], maintenance: [PR, 'Maintenance'], full: [PY, 'Full'], reserved: ['#8b5cf6', 'Reserved'], pending: [PY, 'Pending'], approved: [PG, 'Approved'], rejected: [PR, 'Rejected'], checked_in: [PG, 'Checked In'], checked_out: ['#6b7280', 'Checked Out'], open: [PY, 'Open'], in_progress: [P, 'In Progress'], resolved: [PG, 'Resolved'] };
    const v = m[s] || ['#6b7280', s || 'Unknown'];
    return badge(v[1], v[0]);
  }

  // -- Navigation ---------------------------------------------------------
  const nav = (active) => `<div class="sh-nav" role="navigation" aria-label="Smart Hostel navigation">
    <a href="/smart-hostel" class="${active === 'dash' ? 'active' : ''}">🏠 Dashboard</a>
    <a href="/smart-hostel/rooms" class="${active === 'rooms' ? 'active' : ''}">🛏️ Rooms</a>
    <a href="/smart-hostel/allocate" class="${active === 'allocate' ? 'active' : ''}">🤖 Smart Allocate</a>
    <a href="/smart-hostel/allocations" class="${active === 'allocations' ? 'active' : ''}">📋 Allocations</a>
    <a href="/smart-hostel/swaps" class="${active === 'swaps' ? 'active' : ''}">🔄 Swaps</a>
    <a href="/smart-hostel/inspections" class="${active === 'inspections' ? 'active' : ''}">🔍 Inspections</a>
    <a href="/smart-hostel/maintenance" class="${active === 'maint' ? 'active' : ''}">🔧 Maintenance</a>
    <a href="/smart-hostel/checkinout" class="${active === 'cio' ? 'active' : ''}">🔑 Check-in/out</a>
  </div>`;

  // -- SVG Chart: Donut ---------------------------------------------------
  function svgDonut(data, w, h) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10;
    let cum = 0;
    let arcs = '';
    let legend = '';
    data.forEach(d => {
      const p = d.value / total;
      const x1 = cx + r * Math.cos(2 * Math.PI * cum - Math.PI / 2);
      const y1 = cy + r * Math.sin(2 * Math.PI * cum - Math.PI / 2);
      cum += p;
      const x2 = cx + r * Math.cos(2 * Math.PI * cum - Math.PI / 2);
      const y2 = cy + r * Math.sin(2 * Math.PI * cum - Math.PI / 2);
      const large = p > 0.5 ? 1 : 0;
      arcs += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
      legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px"><div style="width:10px;height:10px;border-radius:3px;background:${d.color}"></div>${esc(d.label)} (${d.value})</div>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Donut chart">${arcs}<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/></svg><div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">${legend}</div>`;
  }

  // -- SVG Chart: Bar -----------------------------------------------------
  function svgBar(data, w, h, maxVal) {
    maxVal = maxVal || Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(12, (w / data.length) - 12);
    const gap = (w - barW * data.length) / (data.length + 1);
    let bars = '';
    data.forEach((d, i) => {
      const bh = (d.value / maxVal) * (h - 40);
      const x = gap + i * (barW + gap);
      const y = h - 20 - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="4" fill="${d.color || P}" opacity="0.85"><title>${esc(d.label)}: ${d.value}</title></rect>`;
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.label.length > 8 ? d.label.slice(0, 8) : d.label)}</text>`;
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${P}">${d.value}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart">${bars}</svg>`;
  }

  // -- SVG Chart: Horizontal bars -----------------------------------------
  function svgHBar(data, w, h) {
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barH = Math.max(14, Math.min(24, (h - 10) / data.length - 4));
    let bars = '';
    data.forEach((d, i) => {
      const y = i * (barH + 4);
      const bw = (d.value / maxVal) * (w - 140);
      bars += `<text x="0" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="11" fill="#374151" font-weight="600">${esc(d.label)}</text>`;
      bars += `<rect x="100" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH}" rx="4" fill="${d.color || P}" opacity="0.8"><title>${esc(d.label)}: ${d.value}</title></rect>`;
      bars += `<text x="${(104 + bw).toFixed(1)}" y="${(y + barH / 2 + 4).toFixed(1)}" font-size="10" font-weight="700" fill="#374151">${d.value}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Horizontal bar chart">${bars}</svg>`;
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    let c = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      c = await pool.connect().catch(() => null);
      if (c) break;
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!c) { console.error('[SmartHostel] DB connection failed'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS hostel_rooms_smart (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        block VARCHAR(50) NOT NULL DEFAULT 'A',
        floor INTEGER NOT NULL DEFAULT 1,
        capacity INTEGER NOT NULL DEFAULT 4,
        current_occupants INTEGER NOT NULL DEFAULT 0,
        amenities TEXT[] DEFAULT '{}',
        gender VARCHAR(20) NOT NULL DEFAULT 'male',
        status VARCHAR(20) NOT NULL DEFAULT 'available',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const roomCols = [['name','VARCHAR(100) NOT NULL DEFAULT \'\''],['block','VARCHAR(50) NOT NULL DEFAULT \'A\''],
        ['floor','INTEGER NOT NULL DEFAULT 1'],['capacity','INTEGER NOT NULL DEFAULT 4'],
        ['current_occupants','INTEGER NOT NULL DEFAULT 0'],['amenities','TEXT[] DEFAULT \'{}\''],
        ['gender','VARCHAR(20) NOT NULL DEFAULT \'male\''],['status','VARCHAR(20) NOT NULL DEFAULT \'available\''],
        ['notes','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()'],['updated_at','TIMESTAMPTZ DEFAULT NOW()']];
      for (const [col, typ] of roomCols) { try { await c.query(`ALTER TABLE hostel_rooms_smart ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {} }

      await c.query(`CREATE TABLE IF NOT EXISTS room_allocations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES hostel_rooms_smart(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        student_name VARCHAR(200) NOT NULL,
        student_class VARCHAR(100),
        bed_number INTEGER,
        preferred_roommate VARCHAR(200),
        preferred_floor INTEGER,
        preferred_block VARCHAR(50),
        allocation_score NUMERIC(5,2) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        check_in_date DATE,
        check_out_date DATE,
        key_handover BOOLEAN DEFAULT false,
        condition_report TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const allocCols = [['student_id','INTEGER'],['student_name','VARCHAR(200) NOT NULL DEFAULT \'\''],
        ['student_class','VARCHAR(100)'],['bed_number','INTEGER'],
        ['preferred_roommate','VARCHAR(200)'],['preferred_floor','INTEGER'],['preferred_block','VARCHAR(50)'],
        ['allocation_score','NUMERIC(5,2) DEFAULT 0'],['status','VARCHAR(20) NOT NULL DEFAULT \'active\''],
        ['check_in_date','DATE'],['check_out_date','DATE'],['key_handover','BOOLEAN DEFAULT false'],
        ['condition_report','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()']];
      for (const [col, typ] of allocCols) { try { await c.query(`ALTER TABLE room_allocations ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {} }

      await c.query(`CREATE TABLE IF NOT EXISTS room_swap_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        requester_alloc_id INTEGER NOT NULL REFERENCES room_allocations(id),
        target_room_id INTEGER NOT NULL REFERENCES hostel_rooms_smart(id),
        target_student_name VARCHAR(200),
        reason TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMPTZ,
        review_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const swapCols = [['requester_alloc_id','INTEGER NOT NULL'],['target_room_id','INTEGER NOT NULL'],
        ['target_student_name','VARCHAR(200)'],['reason','TEXT'],['status','VARCHAR(20) NOT NULL DEFAULT \'pending\''],
        ['reviewed_by','INTEGER'],['reviewed_at','TIMESTAMPTZ'],['review_notes','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()']];
      for (const [col, typ] of swapCols) { try { await c.query(`ALTER TABLE room_swap_requests ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {} }

      await c.query(`CREATE TABLE IF NOT EXISTS room_inspections (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES hostel_rooms_smart(id) ON DELETE CASCADE,
        inspector_name VARCHAR(200) NOT NULL,
        inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
        cleanliness_score INTEGER NOT NULL DEFAULT 0 CHECK (cleanliness_score BETWEEN 0 AND 10),
        organization_score INTEGER NOT NULL DEFAULT 0 CHECK (organization_score BETWEEN 0 AND 10),
        damage_score INTEGER NOT NULL DEFAULT 10 CHECK (damage_score BETWEEN 0 AND 10),
        total_score NUMERIC(5,2) NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const inspCols = [['inspector_name','VARCHAR(200) NOT NULL DEFAULT \'\''],
        ['inspection_date','DATE NOT NULL DEFAULT CURRENT_DATE'],
        ['cleanliness_score','INTEGER NOT NULL DEFAULT 0'],
        ['organization_score','INTEGER NOT NULL DEFAULT 0'],
        ['damage_score','INTEGER NOT NULL DEFAULT 10'],
        ['total_score','NUMERIC(5,2) NOT NULL DEFAULT 0'],
        ['notes','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()']];
      for (const [col, typ] of inspCols) { try { await c.query(`ALTER TABLE room_inspections ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {} }

      await c.query(`CREATE TABLE IF NOT EXISTS room_maintenance (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        room_id INTEGER REFERENCES hostel_rooms_smart(id) ON DELETE CASCADE,
        item_name VARCHAR(200) NOT NULL,
        issue_description TEXT NOT NULL,
        reported_by VARCHAR(200),
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        assigned_to VARCHAR(200),
        resolved_at TIMESTAMPTZ,
        resolution_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const maintCols = [['room_id','INTEGER'],['item_name','VARCHAR(200) NOT NULL DEFAULT \'\''],
        ['issue_description','TEXT NOT NULL'],['reported_by','VARCHAR(200)'],
        ['priority','VARCHAR(20) NOT NULL DEFAULT \'normal\''],['status','VARCHAR(20) NOT NULL DEFAULT \'open\''],
        ['assigned_to','VARCHAR(200)'],['resolved_at','TIMESTAMPTZ'],['resolution_notes','TEXT'],
        ['created_at','TIMESTAMPTZ DEFAULT NOW()']];
      for (const [col, typ] of maintCols) { try { await c.query(`ALTER TABLE room_maintenance ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {} }

      // Indexes
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_hrs_tenant ON hostel_rooms_smart(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_hrs_block ON hostel_rooms_smart(tenant_id,block)',
        'CREATE INDEX IF NOT EXISTS idx_hrs_status ON hostel_rooms_smart(tenant_id,status)',
        'CREATE INDEX IF NOT EXISTS idx_ra_tenant ON room_allocations(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ra_room ON room_allocations(tenant_id,room_id)',
        'CREATE INDEX IF NOT EXISTS idx_ra_student ON room_allocations(tenant_id,student_id)',
        'CREATE INDEX IF NOT EXISTS idx_ra_status ON room_allocations(tenant_id,status)',
        'CREATE INDEX IF NOT EXISTS idx_rsr_tenant ON room_swap_requests(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_rsr_status ON room_swap_requests(tenant_id,status)',
        'CREATE INDEX IF NOT EXISTS idx_ri_tenant ON room_inspections(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_ri_room ON room_inspections(tenant_id,room_id)',
        'CREATE INDEX IF NOT EXISTS idx_rm_tenant ON room_maintenance(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_rm_status ON room_maintenance(tenant_id,status)',
      ];
      for (const sql of idxs) { try { await c.query(sql); } catch(e) {} }
      console.log('[SmartHostel] Migrations complete');
    } catch (e) { /* migration OK */ }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /smart-hostel — Dashboard
  // ============================================================
  app.get('/smart-hostel', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms, allocs, swaps, maint, insp] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM hostel_rooms_smart WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM room_allocations WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM room_swap_requests WHERE tenant_id=$1 AND status='pending'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM room_maintenance WHERE tenant_id=$1 AND status='open'", [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM room_inspections WHERE tenant_id=$1', [tid]),
    ]);
    const rc = rooms.rows[0].c, ac = allocs.rows[0].c, sc = swaps.rows[0].c, mc = maint.rows[0].c, ic = insp.rows[0].c;

    // Occupancy by block
    const blockStats = (await pool.query(
      `SELECT block, COUNT(*)::int AS total,
        SUM(CASE WHEN status='available' OR status='reserved' THEN 1 ELSE 0 END)::int AS avail,
        SUM(CASE WHEN status='occupied' OR status='full' THEN 1 ELSE 0 END)::int AS occ
       FROM hostel_rooms_smart WHERE tenant_id=$1 GROUP BY block ORDER BY block`, [tid])).rows;
    const donutData = blockStats.map(b => ({ label: 'Block ' + b.block, value: b.total, color: [P, '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#8b5cf6', '#a78bfa'][blockStats.indexOf(b) % 7] }));
    const donutSvg = donutData.length ? svgDonut(donutData, 180, 180) : '<p class="sh-empty">No data</p>';

    // Recent inspections (last 5)
    const recentInsp = (await pool.query(
      `SELECT ri.*, hrs.name AS room_name FROM room_inspections ri
       JOIN hostel_rooms_smart hrs ON hrs.id=ri.room_id
       WHERE ri.tenant_id=$1 ORDER BY ri.inspection_date DESC LIMIT 5`, [tid])).rows;

    // Gender distribution
    const genderStats = (await pool.query(
      `SELECT gender, COUNT(*)::int AS c FROM hostel_rooms_smart WHERE tenant_id=$1 GROUP BY gender`, [tid])).rows;
    const genderDonut = genderStats.map(g => ({ label: (g.gender || 'unspecified'), value: g.c, color: g.gender === 'male' ? '#3b82f6' : g.gender === 'female' ? '#ec4899' : '#8b5cf6' }));

    let html = CSS + nav('dash');
    html += `<div style="max-width:1200px;margin:0 auto">
      <div style="margin-bottom:20px"><h1 style="font-size:24px;color:#111827">🏠 Smart Hostel Dashboard</h1>
      <p style="font-size:13px;color:#6b7280">AI-powered room allocation and hostel management</p></div>
      <div class="sh-stats">
        <div class="sh-stat"><div class="sh-stat-n">${rc}</div><div class="sh-stat-l">Total Rooms</div></div>
        <div class="sh-stat"><div class="sh-stat-n">${ac}</div><div class="sh-stat-l">Occupants</div></div>
        <div class="sh-stat"><div class="sh-stat-n">${sc}</div><div class="sh-stat-l">Swap Requests</div></div>
        <div class="sh-stat"><div class="sh-stat-n">${mc}</div><div class="sh-stat-l">Open Repairs</div></div>
        <div class="sh-stat"><div class="sh-stat-n">${ic}</div><div class="sh-stat-l">Inspections</div></div>
      </div>
      <div class="sh-grid2">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">📊 Rooms by Block</h3>${donutSvg}</div>
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">🏠 Gender Distribution</h3>${genderDonut.length ? svgDonut(genderDonut, 180, 180) : '<p class="sh-empty">No rooms</p>'}</div>
      </div>
      <div class="sh-card" style="margin-top:16px"><h3 style="color:#111827;margin:0 0 12px">🔍 Recent Inspections</h3>`;
    if (recentInsp.length) {
      html += '<table class="sh-tbl"><tr><th>Room</th><th>Inspector</th><th>Date</th><th>Clean</th><th>Organize</th><th>Damage</th><th>Total</th></tr>';
      recentInsp.forEach(r => {
        const total = r.total_score || 0;
        const color = total >= 8 ? PG : total >= 5 ? PY : PR;
        html += `<tr><td>${esc(r.room_name)}</td><td>${esc(r.inspector_name)}</td><td>${fmtDate(r.inspection_date)}</td>
          <td>${r.cleanliness_score}/10</td><td>${r.organization_score}/10</td><td>${r.damage_score}/10</td>
          <td><strong style="color:${color}">${total.toFixed(1)}/10</strong></td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="sh-empty">No inspections yet</p>'; }
    html += '</div></div>';
    res.send(renderPage('Smart Hostel Dashboard', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /smart-hostel/rooms — Room List
  // ============================================================
  app.get('/smart-hostel/rooms', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const block = req.query.block || '';
    const gender = req.query.gender || '';
    let where = 'WHERE r.tenant_id=$1';
    const params = [tid];
    if (block) { where += ' AND r.block=$2'; params.push(block); }
    if (gender) { where += ` AND r.gender=$${params.length + 1}`; params.push(gender); }

    const rooms = await pool.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM room_allocations a WHERE a.room_id=r.id AND a.status='active') AS occupants
       FROM hostel_rooms_smart r ${where} ORDER BY r.block, r.floor, r.name`, params);
    const blocks = (await pool.query('SELECT DISTINCT block FROM hostel_rooms_smart WHERE tenant_id=$1 ORDER BY block', [tid])).rows.map(r => r.block);

    let html = CSS + nav('rooms');
    html += `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h2 style="color:#111827">🛏️ Room Management</h2>
        <a href="/smart-hostel/rooms/new" class="sh-btn sh-btn-p">+ Add Room</a>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
        <div class="sh-fg" style="width:140px;margin:0"><label>Block</label>
          <select name="block" onchange="location.href='/smart-hostel/rooms?block='+this.value">
            <option value="">All Blocks</option>${blocks.map(b => `<option value="${esc(b)}" ${block === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
          </select></div>
        <div class="sh-fg" style="width:140px;margin:0"><label>Gender</label>
          <select name="gender" onchange="location.href='/smart-hostel/rooms?gender='+this.value">
            <option value="">All</option>
            <option value="male" ${gender === 'male' ? 'selected' : ''}>Male</option>
            <option value="female" ${gender === 'female' ? 'selected' : ''}>Female</option>
          </select></div>
      </div>`;
    if (rooms.rows.length) {
      html += '<div style="overflow-x:auto"><table class="sh-tbl"><tr><th>Name</th><th>Block</th><th>Floor</th><th>Capacity</th><th>Occupants</th><th>Amenities</th><th>Gender</th><th>Status</th><th>Actions</th></tr>';
      rooms.rows.forEach(r => {
        const amenStr = (r.amenities || []).join(', ') || '—';
        const full = r.occupants >= r.capacity;
        const st = full ? 'full' : r.current_occupants > 0 ? 'occupied' : r.status;
        html += `<tr>
          <td><a href="/smart-hostel/rooms/${r.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(r.name)}</a></td>
          <td>${esc(r.block)}</td><td>${r.floor}</td><td>${r.capacity}</td>
          <td>${r.occupants}/${r.capacity}</td><td style="font-size:11px">${esc(amenStr)}</td>
          <td>${badge(r.gender === 'male' ? 'Male' : 'Female', r.gender === 'male' ? '#3b82f6' : '#ec4899')}</td>
          <td>${statusBadge(st)}</td>
          <td>
            <a href="/smart-hostel/rooms/${r.id}/edit" class="sh-btn sh-btn-o" style="padding:5px 10px;font-size:11px">Edit</a>
            <form method="POST" action="/smart-hostel/rooms/${r.id}/delete" style="display:inline" onsubmit="return confirm('Delete room ${esc(r.name)}?')">
              <button class="sh-btn sh-btn-r" style="padding:5px 10px;font-size:11px">Del</button>
            </form>
          </td></tr>`;
      });
      html += '</table></div>';
    } else { html += '<div class="sh-card"><p class="sh-empty">No rooms added yet.</p></div>'; }
    html += '</div>';
    res.send(renderPage('Room Management', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /smart-hostel/rooms/new — Add Room Form
  // ============================================================
  app.get('/smart-hostel/rooms/new', requireAuth, ah(async (req, res) => {
    let html = CSS + nav('rooms');
    html += `<div style="max-width:600px;margin:0 auto"><div class="sh-card">
      <h2 style="color:#111827;margin:0 0 20px">➕ Add New Room</h2>
      <form method="POST" action="/smart-hostel/rooms/new" style="display:flex;flex-direction:column;gap:16px">
        <div class="sh-fg"><label>Room Name *</label><input name="name" required placeholder="e.g., A101"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="sh-fg"><label>Block *</label><input name="block" required value="A"></div>
          <div class="sh-fg"><label>Floor *</label><input name="floor" type="number" min="0" required value="1"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="sh-fg"><label>Capacity *</label><input name="capacity" type="number" min="1" max="12" required value="4"></div>
          <div class="sh-fg"><label>Gender *</label>
            <select name="gender" required><option value="male">Male</option><option value="female">Female</option></select></div>
        </div>
        <div class="sh-fg"><label>Amenities</label>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="AC"> AC</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="WiFi"> WiFi</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="Bathroom"> Bathroom</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="Study Table"> Study Table</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="Wardrobe"> Wardrobe</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="Fan"> Fan</label>
          </div></div>
        <div class="sh-fg"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="sh-btn sh-btn-p">Save Room</button>
          <a href="/smart-hostel/rooms" class="sh-btn sh-btn-o">Cancel</a>
        </div>
      </form></div></div>`;
    res.send(renderPage('Add Room', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /smart-hostel/rooms/new — Save Room
  // ============================================================
  app.post('/smart-hostel/rooms/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, block, floor, capacity, gender, notes } = req.body;
    const amenities = Array.isArray(req.body.amenities) ? req.body.amenities : (req.body.amenities ? [req.body.amenities] : []);
    if (!name || !name.trim()) return res.send('<div class="sh-alert sh-alert-err">Room name is required.</div><a href="javascript:history.back()">Back</a>');
    await pool.query(
      `INSERT INTO hostel_rooms_smart (tenant_id,name,block,floor,capacity,gender,amenities,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, name.trim(), (block || 'A').toUpperCase(), parseInt(floor) || 1, parseInt(capacity) || 4, gender || 'male', amenities, notes || null]);
    audit('room_created', { name: name.trim() });
    res.redirect('/smart-hostel/rooms');
  }));

  // ============================================================
  // ROUTE 5: GET /smart-hostel/rooms/:id/edit — Edit Room
  // ============================================================
  app.get('/smart-hostel/rooms/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const room = await pool.query('SELECT * FROM hostel_rooms_smart WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!room.rows.length) return res.status(404).send('Room not found.');
    const r = room.rows[0];
    const amenSet = new Set(r.amenities || []);
    const amenOpts = ['AC', 'WiFi', 'Bathroom', 'Study Table', 'Wardrobe', 'Fan'];
    let html = CSS + nav('rooms');
    html += `<div style="max-width:600px;margin:0 auto"><div class="sh-card">
      <h2 style="color:#111827;margin:0 0 20px">✏️ Edit Room: ${esc(r.name)}</h2>
      <form method="POST" action="/smart-hostel/rooms/${r.id}/edit" style="display:flex;flex-direction:column;gap:16px">
        <div class="sh-fg"><label>Room Name *</label><input name="name" required value="${esc(r.name)}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="sh-fg"><label>Block *</label><input name="block" required value="${esc(r.block)}"></div>
          <div class="sh-fg"><label>Floor *</label><input name="floor" type="number" min="0" required value="${r.floor}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="sh-fg"><label>Capacity *</label><input name="capacity" type="number" min="1" max="12" required value="${r.capacity}"></div>
          <div class="sh-fg"><label>Gender *</label>
            <select name="gender" required>
              <option value="male" ${r.gender === 'male' ? 'selected' : ''}>Male</option>
              <option value="female" ${r.gender === 'female' ? 'selected' : ''}>Female</option>
            </select></div>
        </div>
        <div class="sh-fg"><label>Status</label>
          <select name="status"><option value="available" ${r.status === 'available' ? 'selected' : ''}>Available</option>
            <option value="maintenance" ${r.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
            <option value="reserved" ${r.status === 'reserved' ? 'selected' : ''}>Reserved</option>
          </select></div>
        <div class="sh-fg"><label>Amenities</label>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
            ${amenOpts.map(a => `<label style="display:flex;align-items:center;gap:4px;font-size:13px"><input type="checkbox" name="amenities" value="${a}" ${amenSet.has(a) ? 'checked' : ''}> ${a}</label>`).join('')}
          </div></div>
        <div class="sh-fg"><label>Notes</label><textarea name="notes" rows="2">${esc(r.notes || '')}</textarea></div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="sh-btn sh-btn-p">Update Room</button>
          <a href="/smart-hostel/rooms" class="sh-btn sh-btn-o">Cancel</a>
        </div>
      </form></div></div>`;
    res.send(renderPage('Edit Room', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /smart-hostel/rooms/:id/edit — Update Room
  // ============================================================
  app.post('/smart-hostel/rooms/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, block, floor, capacity, gender, status, notes } = req.body;
    const amenities = Array.isArray(req.body.amenities) ? req.body.amenities : (req.body.amenities ? [req.body.amenities] : []);
    if (!name || !name.trim()) return res.send('<div class="sh-alert sh-alert-err">Name required.</div><a href="javascript:history.back()">Back</a>');
    await pool.query(
      `UPDATE hostel_rooms_smart SET name=$1,block=$2,floor=$3,capacity=$4,gender=$5,status=$6,amenities=$7,notes=$8,updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10`,
      [name.trim(), (block || 'A').toUpperCase(), parseInt(floor) || 1, parseInt(capacity) || 4, gender || 'male', status || 'available', amenities, notes || null, req.params.id, tid]);
    audit('room_updated', { id: req.params.id });
    res.redirect('/smart-hostel/rooms');
  }));

  // ============================================================
  // ROUTE 7: POST /smart-hostel/rooms/:id/delete — Delete Room
  // ============================================================
  app.post('/smart-hostel/rooms/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const occ = await pool.query('SELECT COUNT(*)::int AS c FROM room_allocations WHERE room_id=$1 AND tenant_id=$2 AND status=$3', [req.params.id, tid, 'active']);
    if (occ.rows[0].c > 0) return res.send('<div class="sh-alert sh-alert-err">Cannot delete room with active occupants.</div><a href="javascript:history.back()">Back</a>');
    await pool.query('DELETE FROM hostel_rooms_smart WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit('room_deleted', { id: req.params.id });
    res.redirect('/smart-hostel/rooms');
  }));

  // ============================================================
  // ROUTE 8: GET /smart-hostel/rooms/:id — Room Detail
  // ============================================================
  app.get('/smart-hostel/rooms/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const room = await pool.query('SELECT * FROM hostel_rooms_smart WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!room.rows.length) return res.status(404).send('Room not found.');
    const r = room.rows[0];
    const allocs = await pool.query(
      'SELECT * FROM room_allocations WHERE room_id=$1 AND tenant_id=$2 AND status=$3 ORDER BY bed_number', [r.id, tid, 'active']);
    const inspections = await pool.query(
      'SELECT * FROM room_inspections WHERE room_id=$1 AND tenant_id=$2 ORDER BY inspection_date DESC LIMIT 5', [r.id, tid]);
    const maintIssues = await pool.query(
      "SELECT * FROM room_maintenance WHERE room_id=$1 AND tenant_id=$2 AND status='open' ORDER BY created_at DESC", [r.id, tid]);

    let html = CSS + nav('rooms');
    html += `<div style="max-width:1000px;margin:0 auto">
      <a href="/smart-hostel/rooms" class="sh-btn sh-btn-o" style="margin-bottom:12px">← All Rooms</a>
      <div class="sh-grid2" style="margin-bottom:16px">
        <div class="sh-card">
          <h2 style="color:#111827;margin:0 0 12px">🛏️ ${esc(r.name)}</h2>
          <p style="font-size:13px;color:#4b5563">Block <strong>${esc(r.block)}</strong> · Floor <strong>${r.floor}</strong> · Gender: <strong>${esc(r.gender)}</strong></p>
          <p style="font-size:13px;color:#4b5563">Capacity: <strong>${r.capacity}</strong> · Occupants: <strong>${allocs.rows.length}</strong></p>
          <p style="font-size:13px;color:#4b5563">Amenities: ${(r.amenities || []).map(a => badge(a, P)).join(' ') || 'None'}</p>
          ${statusBadge(r.status)}
          ${r.notes ? `<p style="font-size:12px;color:#6b7280;margin-top:8px">${esc(r.notes)}</p>` : ''}
        </div>
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">📋 Current Occupants</h3>`;
    if (allocs.rows.length) {
      html += '<table class="sh-tbl"><tr><th>Bed</th><th>Student</th><th>Class</th></tr>';
      allocs.rows.forEach(a => {
        html += `<tr><td>#${a.bed_number || '—'}</td><td>${esc(a.student_name)}</td><td>${esc(a.student_class || '—')}</td></tr>`;
      });
      html += '</table>';
    } else { html += '<p class="sh-empty">No occupants</p>'; }
    html += '</div></div>';

    // Inspection chart
    if (inspections.rows.length) {
      const barData = inspections.rows.map(i => ({ label: fmtDate(i.inspection_date).slice(0, 6), value: Number(i.total_score || 0), color: (i.total_score || 0) >= 8 ? PG : (i.total_score || 0) >= 5 ? PY : PR }));
      html += `<div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">📈 Inspection Trend</h3>${svgBar(barData, 500, 140)}</div>`;
    }

    // Open maintenance
    if (maintIssues.rows.length) {
      html += '<div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">🔧 Open Maintenance</h3><table class="sh-tbl"><tr><th>Item</th><th>Priority</th><th>Reported</th></tr>';
      maintIssues.rows.forEach(m => {
        html += `<tr><td>${esc(m.item_name)}</td><td>${statusBadge(m.priority)}</td><td>${fmtDate(m.created_at)}</td></tr>`;
      });
      html += '</table></div>';
    }
    html += '</div>';
    res.send(renderPage('Room: ' + r.name, html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /smart-hostel/allocate — Smart Allocation
  // ============================================================
  app.get('/smart-hostel/allocate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const students = (await pool.query(
      `SELECT id, first_name, last_name, admission_number, class FROM students
       WHERE tenant_id=$1 AND id NOT IN (SELECT student_id FROM room_allocations WHERE tenant_id=$1 AND status='active' AND student_id IS NOT NULL)
       ORDER BY last_name, first_name LIMIT 500`, [tid])).rows;
    const rooms = (await pool.query(
      "SELECT * FROM hostel_rooms_smart WHERE tenant_id=$1 AND status IN ('available','reserved') AND current_occupants < capacity ORDER BY block, floor, name", [tid])).rows;

    const stuOpts = students.map(s =>
      `<option value="${s.id}" data-class="${esc(s.class || '')}">${esc(s.last_name || '')}, ${esc(s.first_name || '')} (${esc(s.class || 'N/A')})</option>`).join('');
    const roomOpts = rooms.map(r =>
      `<option value="${r.id}" data-block="${esc(r.block)}" data-floor="${r.floor}" data-gender="${esc(r.gender)}">Block ${esc(r.block)} · Floor ${r.floor} · ${esc(r.name)} (${r.current_occupants}/${r.capacity})</option>`).join('');

    let html = CSS + nav('allocate');
    html += `<div style="max-width:700px;margin:0 auto"><div class="sh-card">
      <h2 style="color:#111827;margin:0 0 4px">🤖 Smart Room Allocation</h2>
      <p style="font-size:13px;color:#6b7280;margin-bottom:20px">Submit student preferences; the algorithm matches by class, preferences, and availability.</p>
      <form method="POST" action="/smart-hostel/allocate" id="allocForm" style="display:flex;flex-direction:column;gap:16px">
        <div class="sh-fg"><label>Student *</label><select name="student_id" required id="stuSel"><option value="">Select student...</option>${stuOpts}</select></div>
        <div class="sh-fg"><label>Preferred Roommate (optional)</label><input name="preferred_roommate" placeholder="Name of preferred roommate"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="sh-fg"><label>Preferred Floor</label><input name="preferred_floor" type="number" min="0" placeholder="Any"></div>
          <div class="sh-fg"><label>Preferred Block</label><input name="preferred_block" placeholder="e.g., A"></div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" name="action" value="single" class="sh-btn sh-btn-p">Allocate</button>
          <button type="submit" name="action" value="auto" class="sh-btn sh-btn-g">🤖 Auto-Assign All Unallocated</button>
        </div>
      </form></div></div>
    <script>
      document.getElementById('stuSel').addEventListener('change', function(){
        var opt = this.options[this.selectedIndex];
      });
    </script>`;
    res.send(renderPage('Smart Allocation', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /smart-hostel/allocate — Process Allocation
  // ============================================================
  app.post('/smart-hostel/allocate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const action = req.body.action;

    if (action === 'auto') {
      // AUTO-ASSIGN: assign all unallocated students using algorithm
      const unassigned = (await pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.class, s.gender
         FROM students s WHERE s.tenant_id=$1
         AND s.id NOT IN (SELECT student_id FROM room_allocations WHERE tenant_id=$1 AND status='active' AND student_id IS NOT NULL)`, [tid])).rows;

      const availRooms = (await pool.query(
        `SELECT r.*, (SELECT COUNT(*)::int FROM room_allocations a WHERE a.room_id=r.id AND a.status='active') AS occ
         FROM hostel_rooms_smart r WHERE r.tenant_id=$1 AND r.status IN ('available','reserved') AND r.current_occupants < r.capacity
         ORDER BY r.block, r.floor`, [tid])).rows;

      // Build class -> room assignments map to group same-class students
      const classMap = {};
      unassigned.forEach(s => {
        const cls = s.class || 'unassigned';
        if (!classMap[cls]) classMap[cls] = [];
        classMap[cls].push(s);
      });

      let allocated = 0;
      for (const [cls, stuList] of Object.entries(classMap)) {
        for (const stu of stuList) {
          // Find best room: same class first, then preferred block/floor, then gender match, then availability
          const occupied = (await pool.query(
            `SELECT room_id FROM room_allocations WHERE tenant_id=$1 AND status='active' AND student_id=$2`, [tid, stu.id])).rows;
          if (occupied.length) continue;

          // Find rooms with same-class occupants
          const classRoomIds = (await pool.query(
            `SELECT DISTINCT a.room_id FROM room_allocations a
             JOIN room_allocations a2 ON a2.room_id = a.room_id AND a2.student_class = $1 AND a2.status = 'active'
             WHERE a.tenant_id=$2 AND a.status='active'`, [cls, tid])).rows.map(r => r.room_id);

          // Find rooms matching student gender
          const genderStr = (stu.gender || 'male').toLowerCase().startsWith('f') ? 'female' : 'male';
          let bestRoom = null;
          let bestScore = -1;

          const freshRooms = (await pool.query(
            `SELECT r.*, (SELECT COUNT(*)::int FROM room_allocations a WHERE a.room_id=r.id AND a.status='active') AS occ
             FROM hostel_rooms_smart r WHERE r.tenant_id=$1 AND r.status IN ('available','reserved') AND r.current_occupants < r.capacity
             ORDER BY r.block, r.floor`, [tid])).rows;

          for (const rm of freshRooms) {
            let score = 0;
            const spaceAvail = rm.capacity - (rm.occ || 0);
            if (spaceAvail <= 0) continue;
            if (classRoomIds.includes(rm.id)) score += 50; // same class bonus
            if (rm.gender === genderStr) score += 20; // gender match
            score += (10 - rm.floor) * 2; // prefer lower floors
            if (rm.amenities && rm.amenities.includes('AC')) score += 5;
            score += spaceAvail * 3; // prefer rooms with more space
            if (score > bestScore) { bestScore = score; bestRoom = rm; }
          }

          if (bestRoom) {
            const bedNum = (bestRoom.occ || 0) + 1;
            await pool.query(
              `INSERT INTO room_allocations (tenant_id,room_id,student_id,student_name,student_class,bed_number,allocation_score,status,check_in_date)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
              [tid, bestRoom.id, stu.id, (stu.first_name + ' ' + stu.last_name).trim(), cls, bedNum, bestScore, today()]);
            await pool.query(
              'UPDATE hostel_rooms_smart SET current_occupants=current_occupants+1, status=CASE WHEN current_occupants+1>=capacity THEN $1 ELSE status END, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
              ['full', bestRoom.id, tid]);
            allocated++;
          }
        }
      }
      audit('auto_allocation', { count: allocated });
      req.session.smartHostelMsg = `Auto-assigned ${allocated} student(s).`;
      return res.redirect('/smart-hostel/allocations');
    }

    // SINGLE ALLOCATION
    const { student_id, preferred_roommate, preferred_floor, preferred_block } = req.body;
    if (!student_id) return res.send('<div class="sh-alert sh-alert-err">Select a student.</div><a href="javascript:history.back()">Back</a>');

    const stu = (await pool.query(
      'SELECT id, first_name, last_name, class, gender FROM students WHERE id=$1 AND tenant_id=$2', [student_id, tid])).rows[0];
    if (!stu) return res.send('<div class="sh-alert sh-alert-err">Student not found.</div><a href="javascript:history.back()">Back</a>');

    const genderStr = (stu.gender || 'male').toLowerCase().startsWith('f') ? 'female' : 'male';
    const stuClass = stu.class || '';
    const stuName = (stu.first_name + ' ' + stu.last_name).trim();

    // Algorithm: find best room
    const candidates = (await pool.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM room_allocations a WHERE a.room_id=r.id AND a.status='active') AS occ
       FROM hostel_rooms_smart r WHERE r.tenant_id=$1 AND r.status IN ('available','reserved') AND r.current_occupants < r.capacity
       ORDER BY r.block, r.floor`, [tid])).rows;

    // Check preferred roommate
    let roommateRoomId = null;
    if (preferred_roommate && preferred_roommate.trim()) {
      const rmAlloc = (await pool.query(
        `SELECT a.room_id, r.capacity, (SELECT COUNT(*)::int FROM room_allocations a2 WHERE a2.room_id=a.room_id AND a2.status='active') AS occ
         FROM room_allocations a JOIN hostel_rooms_smart r ON r.id=a.room_id
         WHERE a.tenant_id=$1 AND a.student_name ILIKE $2 AND a.status='active'`, [tid, '%' + preferred_roommate.trim() + '%'])).rows;
      if (rmAlloc.length) {
        const ra = rmAlloc[0];
        if (ra.occ < ra.capacity) roommateRoomId = ra.room_id;
      }
    }

    let bestRoom = null;
    let bestScore = -1;
    for (const rm of candidates) {
      let score = 0;
      const spaceAvail = rm.capacity - (rm.occ || 0);
      if (spaceAvail <= 0) continue;
      // Roommate preference
      if (roommateRoomId && rm.id === roommateRoomId) score += 100;
      // Gender match
      if (rm.gender === genderStr) score += 30;
      // Block preference
      if (preferred_block && rm.block.toUpperCase() === preferred_block.toUpperCase()) score += 20;
      // Floor preference
      if (preferred_floor && rm.floor === parseInt(preferred_floor)) score += 15;
      // Same-class bonus: check if room has occupants from same class
      if (stuClass) {
        const classOcc = (await pool.query(
          `SELECT COUNT(*)::int AS c FROM room_allocations WHERE room_id=$1 AND tenant_id=$2 AND student_class=$3 AND status='active'`, [rm.id, tid, stuClass])).rows[0].c;
        if (classOcc > 0) score += 25;
      }
      // Amenity bonus
      if (rm.amenities && rm.amenities.includes('AC')) score += 5;
      if (rm.amenities && rm.amenities.includes('WiFi')) score += 5;
      // Lower floor preference
      score += (10 - rm.floor) * 2;
      score += spaceAvail * 3;
      if (score > bestScore) { bestScore = score; bestRoom = rm; }
    }

    if (!bestRoom) return res.send('<div class="sh-alert sh-alert-err">No suitable room available for this student.</div><a href="javascript:history.back()">Back</a>');

    const bedNum = (bestRoom.occ || 0) + 1;
    await pool.query(
      `INSERT INTO room_allocations (tenant_id,room_id,student_id,student_name,student_class,bed_number,preferred_roommate,preferred_floor,preferred_block,allocation_score,status,check_in_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)`,
      [tid, bestRoom.id, stu.id, stuName, stuClass, bedNum,
        preferred_roommate || null, preferred_floor ? parseInt(preferred_floor) : null,
        preferred_block || null, bestScore, today()]);
    await pool.query(
      'UPDATE hostel_rooms_smart SET current_occupants=current_occupants+1, status=CASE WHEN current_occupants+1>=capacity THEN $1 ELSE status END, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      ['full', bestRoom.id, tid]);
    audit('allocation_created', { student: stuName, room: bestRoom.name, score: bestScore });
    req.session.smartHostelMsg = `Allocated ${stuName} to ${bestRoom.name} (score: ${bestScore}).`;
    res.redirect('/smart-hostel/allocations');
  }));

  // ============================================================
  // ROUTE 11: GET /smart-hostel/allocations — Allocation List
  // ============================================================
  app.get('/smart-hostel/allocations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const msg = req.session.smartHostelMsg;
    delete req.session.smartHostelMsg;
    const allocs = await pool.query(
      `SELECT a.*, r.name AS room_name, r.block, r.floor FROM room_allocations a
       JOIN hostel_rooms_smart r ON r.id=a.room_id
       WHERE a.tenant_id=$1 ORDER BY a.status DESC, r.block, r.floor, a.bed_number`, [tid]);

    let html = CSS + nav('allocations');
    if (msg) html += `<div class="sh-alert sh-alert-ok">✅ ${esc(msg)}</div>`;
    html += `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="color:#111827">📋 Room Allocations</h2>
        <a href="/smart-hostel/allocate" class="sh-btn sh-btn-p">🤖 Smart Allocate</a>
      </div>`;
    if (allocs.rows.length) {
      html += '<div style="overflow-x:auto"><table class="sh-tbl"><tr><th>Student</th><th>Class</th><th>Room</th><th>Block</th><th>Floor</th><th>Bed</th><th>Score</th><th>Status</th><th>Actions</th></tr>';
      allocs.rows.forEach(a => {
        const scoreColor = (a.allocation_score || 0) >= 80 ? PG : (a.allocation_score || 0) >= 50 ? PY : PR;
        html += `<tr>
          <td><strong>${esc(a.student_name)}</strong></td>
          <td>${esc(a.student_class || '—')}</td>
          <td>${esc(a.room_name)}</td><td>${esc(a.block)}</td><td>${a.floor}</td><td>#${a.bed_number || '—'}</td>
          <td><span style="font-weight:700;color:${scoreColor}">${a.allocation_score || 0}</span></td>
          <td>${statusBadge(a.status)}</td>
          <td>${a.status === 'active' ? `<form method="POST" action="/smart-hostel/allocations/${a.id}/deallocate" style="display:inline" onsubmit="return confirm('Deallocate ${esc(a.student_name)}?')">
            <button class="sh-btn sh-btn-r" style="padding:4px 10px;font-size:11px">Remove</button></form>` : '—'}</td></tr>`;
      });
      html += '</table></div>';
    } else { html += '<div class="sh-card"><p class="sh-empty">No allocations yet.</p></div>'; }
    html += '</div>';
    res.send(renderPage('Allocations', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 12: POST dealloc
  // ============================================================
  app.post('/smart-hostel/allocations/:id/deallocate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const alloc = await pool.query('SELECT room_id, student_name FROM room_allocations WHERE id=$1 AND tenant_id=$2 AND status=$3', [req.params.id, tid, 'active']);
    if (!alloc.rows.length) return res.status(404).send('Allocation not found.');
    await pool.query('UPDATE room_allocations SET status=$1, check_out_date=NOW() WHERE id=$2 AND tenant_id=$3', ['checked_out', req.params.id, tid]);
    await pool.query('UPDATE hostel_rooms_smart SET current_occupants=GREATEST(current_occupants-1,0), status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', ['available', alloc.rows[0].room_id, tid]);
    audit('deallocation', { id: req.params.id, student: alloc.rows[0].student_name });
    res.redirect('/smart-hostel/allocations');
  }));

  // ============================================================
  // ROUTE 13: GET /smart-hostel/swaps — Room Swap Requests
  // ============================================================
  app.get('/smart-hostel/swaps', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const swaps = await pool.query(
      `SELECT sr.*, a.student_name, a.student_class, hrs.name AS current_room, hrs.block AS current_block,
        t.name AS target_room, t.block AS target_block
       FROM room_swap_requests sr
       JOIN room_allocations a ON a.id=sr.requester_alloc_id
       JOIN hostel_rooms_smart hrs ON hrs.id=a.room_id
       JOIN hostel_rooms_smart t ON t.id=sr.target_room_id
       WHERE sr.tenant_id=$1 ORDER BY sr.created_at DESC`, [tid]);
    const activeAllocs = (await pool.query(
      `SELECT a.id, a.student_name, a.student_class, r.name AS room_name, r.block, r.floor
       FROM room_allocations a JOIN hostel_rooms_smart r ON r.id=a.room_id
       WHERE a.tenant_id=$1 AND a.status='active'`, [tid])).rows;
    const rooms = (await pool.query(
      "SELECT * FROM hostel_rooms_smart WHERE tenant_id=$1 AND status IN ('available','reserved') AND current_occupants < capacity ORDER BY block, name", [tid])).rows;

    let html = CSS + nav('swaps');
    html += `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="color:#111827">🔄 Room Swap Requests</h2>
      </div>
      <div class="sh-grid2" style="margin-bottom:16px">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">Request Swap</h3>
          <form method="POST" action="/smart-hostel/swaps" style="display:flex;flex-direction:column;gap:12px">
            <div class="sh-fg"><label>Student (Current Allocation) *</label>
              <select name="alloc_id" required>
                <option value="">Select...</option>
                ${activeAllocs.map(a => `<option value="${a.id}">${esc(a.student_name)} — ${esc(a.room_name)} (Block ${esc(a.block)})</option>`).join('')}
              </select></div>
            <div class="sh-fg"><label>Target Room *</label>
              <select name="target_room_id" required>
                <option value="">Select room with space...</option>
                ${rooms.map(r => `<option value="${r.id}">Block ${esc(r.block)} · ${esc(r.name)} (${r.current_occupants}/${r.capacity})</option>`).join('')}
              </select></div>
            <div class="sh-fg"><label>Reason</label><textarea name="reason" rows="2"></textarea></div>
            <button type="submit" class="sh-btn sh-btn-p">Submit Request</button>
          </form></div>
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">Swap Statistics</h3>
          ${swaps.rows.length ? (() => {
            const approved = swaps.rows.filter(s => s.status === 'approved').length;
            const pending = swaps.rows.filter(s => s.status === 'pending').length;
            const rejected = swaps.rows.filter(s => s.status === 'rejected').length;
            return svgDonut([
              { label: 'Pending', value: pending, color: PY },
              { label: 'Approved', value: approved, color: PG },
              { label: 'Rejected', value: rejected, color: PR }
            ], 160, 160);
          })() : '<p class="sh-empty">No swaps yet</p>'}
        </div></div>`;
    if (swaps.rows.length) {
      html += '<div class="sh-card"><table class="sh-tbl"><tr><th>Student</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th>Date</th><th>Actions</th></tr>';
      swaps.rows.forEach(s => {
        const actions = s.status === 'pending' ? `
          <form method="POST" action="/smart-hostel/swaps/${s.id}/approve" style="display:inline"><button class="sh-btn sh-btn-g" style="padding:4px 10px;font-size:11px">Approve</button></form>
          <form method="POST" action="/smart-hostel/swaps/${s.id}/reject" style="display:inline"><button class="sh-btn sh-btn-r" style="padding:4px 10px;font-size:11px">Reject</button></form>` : '—';
        html += `<tr><td>${esc(s.student_name)}</td><td>Block ${esc(s.current_block)} · ${esc(s.current_room)}</td>
          <td>Block ${esc(s.target_block)} · ${esc(s.target_room)}</td>
          <td style="font-size:12px">${esc((s.reason || '').slice(0, 60))}</td>
          <td>${statusBadge(s.status)}</td><td>${fmtDate(s.created_at)}</td><td>${actions}</td></tr>`;
      });
      html += '</table></div>';
    } else { html += '<div class="sh-card"><p class="sh-empty">No swap requests.</p></div>'; }
    html += '</div>';
    res.send(renderPage('Room Swaps', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 14: POST /smart-hostel/swaps — Create Swap Request
  // ============================================================
  app.post('/smart-hostel/swaps', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { alloc_id, target_room_id, reason } = req.body;
    if (!alloc_id || !target_room_id) return res.send('<div class="sh-alert sh-alert-err">Select student and target room.</div><a href="javascript:history.back()">Back</a>');
    await pool.query(
      'INSERT INTO room_swap_requests (tenant_id,requester_alloc_id,target_room_id,reason) VALUES ($1,$2,$3,$4)',
      [tid, alloc_id, target_room_id, reason || null]);
    audit('swap_requested', { alloc_id, target_room_id });
    res.redirect('/smart-hostel/swaps');
  }));

  // ============================================================
  // ROUTE 15: POST approve swap
  // ============================================================
  app.post('/smart-hostel/swaps/:id/approve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const swap = await pool.query('SELECT * FROM room_swap_requests WHERE id=$1 AND tenant_id=$2 AND status=$3', [req.params.id, tid, 'pending']);
    if (!swap.rows.length) return res.status(404).send('Swap request not found.');
    const s = swap.rows[0];
    const targetRoom = (await pool.query('SELECT * FROM hostel_rooms_smart WHERE id=$1 AND tenant_id=$2', [s.target_room_id, tid])).rows[0];
    const currentAlloc = (await pool.query('SELECT * FROM room_allocations WHERE id=$1 AND tenant_id=$2', [s.requester_alloc_id, tid])).rows[0];
    if (!targetRoom || !currentAlloc) return res.send('<div class="sh-alert sh-alert-err">Invalid swap data.</div>');

    const client = await pool.connect();
    try {
      await migrateQuery(pool, 'SmartHostel', 'BEGIN');
      // Free old room
      await migrateQuery(pool, 'SmartHostel', 'UPDATE hostel_rooms_smart SET current_occupants=GREATEST(current_occupants-1,0), status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', ['available', currentAlloc.room_id, tid]);
      // Fill new room
      const newOcc = (await migrateQuery(pool, 'SmartHostel', 'SELECT COUNT(*)::int AS c FROM room_allocations WHERE room_id=$1 AND tenant_id=$2 AND status=$3', [s.target_room_id, tid, 'active'])).rows[0].c;
      await migrateQuery(pool, 'SmartHostel', 'UPDATE room_allocations SET room_id=$1, bed_number=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4', [s.target_room_id, newOcc + 1, currentAlloc.id, tid]);
      await migrateQuery(pool, 'SmartHostel', 'UPDATE hostel_rooms_smart SET current_occupants=current_occupants+1, status=CASE WHEN current_occupants+1>=capacity THEN $1 ELSE status END, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', ['full', s.target_room_id, tid]);
      await migrateQuery(pool, 'SmartHostel', 'UPDATE room_swap_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3 AND tenant_id=$4', ['approved', req.session.user.id, s.id, tid]);
      await migrateQuery(pool, 'SmartHostel', 'COMMIT');
      audit('swap_approved', { swap_id: s.id });
    } catch (e) { await migrateQuery(pool, 'SmartHostel', 'ROLLBACK'); throw e; }
    res.redirect('/smart-hostel/swaps');
  }));

  // ============================================================
  // ROUTE 16: POST reject swap
  // ============================================================
  app.post('/smart-hostel/swaps/:id/reject', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE room_swap_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3 AND tenant_id=$4 AND status=$5', ['rejected', req.session.user.id, req.params.id, tid, 'pending']);
    audit('swap_rejected', { id: req.params.id });
    res.redirect('/smart-hostel/swaps');
  }));

  // ============================================================
  // ROUTE 17: GET /smart-hostel/inspections — Inspections
  // ============================================================
  app.get('/smart-hostel/inspections', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const inspections = (await pool.query(
      `SELECT ri.*, hrs.name AS room_name, hrs.block
       FROM room_inspections ri JOIN hostel_rooms_smart hrs ON hrs.id=ri.room_id
       WHERE ri.tenant_id=$1 ORDER BY ri.inspection_date DESC LIMIT 50`, [tid])).rows;
    const rooms = (await pool.query(
      'SELECT * FROM hostel_rooms_smart WHERE tenant_id=$1 ORDER BY block, name', [tid])).rows;

    // Leaderboard: rooms sorted by latest average score
    const leaderboard = (await pool.query(
      `SELECT hrs.id, hrs.name, hrs.block, AVG(ri.total_score)::numeric(5,2) AS avg_score
       FROM hostel_rooms_smart hrs
       JOIN room_inspections ri ON ri.room_id=hrs.id
       WHERE hrs.tenant_id=$1 GROUP BY hrs.id, hrs.name, hrs.block
       ORDER BY avg_score DESC LIMIT 10`, [tid])).rows;

    const lbData = leaderboard.map((r, i) => ({ label: `${r.name} (${r.block})`, value: Number(r.avg_score || 0), color: i < 3 ? PG : P }));

    let html = CSS + nav('inspections');
    html += `<div style="max-width:1200px;margin:0 auto">
      <h2 style="color:#111827;margin-bottom:16px">🔍 Room Inspections</h2>
      <div class="sh-grid2" style="margin-bottom:16px">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">📝 Submit Inspection</h3>
          <form method="POST" action="/smart-hostel/inspections" style="display:flex;flex-direction:column;gap:12px">
            <div class="sh-fg"><label>Room *</label>
              <select name="room_id" required>
                <option value="">Select room...</option>
                ${rooms.map(r => `<option value="${r.id}">Block ${esc(r.block)} · ${esc(r.name)}</option>`).join('')}
              </select></div>
            <div class="sh-fg"><label>Inspector Name *</label><input name="inspector_name" required value="${esc(req.session.user.name || '')}"></div>
            <div class="sh-fg"><label>Date</label><input name="inspection_date" type="date" value="${today()}"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
              <div class="sh-fg"><label>Cleanliness (0-10)</label><input name="cleanliness_score" type="number" min="0" max="10" required></div>
              <div class="sh-fg"><label>Organization (0-10)</label><input name="organization_score" type="number" min="0" max="10" required></div>
              <div class="sh-fg"><label>Damage-free (0-10)</label><input name="damage_score" type="number" min="0" max="10" required value="10"></div>
            </div>
            <div class="sh-fg"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
            <button type="submit" class="sh-btn sh-btn-p">Submit Inspection</button>
          </form></div>
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">🏆 Cleanest Rooms Leaderboard</h3>
          ${lbData.length ? svgHBar(lbData, 320, Math.max(120, lbData.length * 30)) : '<p class="sh-empty">No inspection data yet</p>'}
        </div></div>`;
    if (inspections.length) {
      html += '<div class="sh-card"><table class="sh-tbl"><tr><th>Room</th><th>Block</th><th>Inspector</th><th>Date</th><th>Clean</th><th>Org</th><th>Damage</th><th>Total</th></tr>';
      inspections.forEach(r => {
        const total = r.total_score || 0;
        const color = total >= 8 ? PG : total >= 5 ? PY : PR;
        html += `<tr><td>${esc(r.room_name)}</td><td>${esc(r.block)}</td><td>${esc(r.inspector_name)}</td>
          <td>${fmtDate(r.inspection_date)}</td><td>${r.cleanliness_score}/10</td><td>${r.organization_score}/10</td><td>${r.damage_score}/10</td>
          <td><strong style="color:${color};font-size:16px">${total.toFixed(1)}</strong></td></tr>`;
      });
      html += '</table></div>';
    }
    html += '</div>';
    res.send(renderPage('Room Inspections', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 18: POST /smart-hostel/inspections — Save Inspection
  // ============================================================
  app.post('/smart-hostel/inspections', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { room_id, inspector_name, inspection_date, cleanliness_score, organization_score, damage_score, notes } = req.body;
    if (!room_id || !inspector_name) return res.send('<div class="sh-alert sh-alert-err">Room and inspector required.</div><a href="javascript:history.back()">Back</a>');
    const clean = Math.min(10, Math.max(0, parseInt(cleanliness_score) || 0));
    const org = Math.min(10, Math.max(0, parseInt(organization_score) || 0));
    const dmg = Math.min(10, Math.max(0, parseInt(damage_score) || 0));
    const total = ((clean + org + dmg) / 3).toFixed(2);
    await pool.query(
      `INSERT INTO room_inspections (tenant_id,room_id,inspector_name,inspection_date,cleanliness_score,organization_score,damage_score,total_score,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, room_id, inspector_name.trim(), inspection_date || today(), clean, org, dmg, total, notes || null]);
    audit('inspection_created', { room_id, score: total });
    res.redirect('/smart-hostel/inspections');
  }));

  // ============================================================
  // ROUTE 19: GET /smart-hostel/maintenance — Maintenance
  // ============================================================
  app.get('/smart-hostel/maintenance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';
    let where = 'WHERE m.tenant_id=$1';
    const params = [tid];
    if (statusFilter) { where += ' AND m.status=$2'; params.push(statusFilter); }
    const issues = (await pool.query(
      `SELECT m.*, hrs.name AS room_name, hrs.block
       FROM room_maintenance m LEFT JOIN hostel_rooms_smart hrs ON hrs.id=m.room_id
       ${where} ORDER BY m.created_at DESC`, params)).rows;
    const rooms = (await pool.query(
      'SELECT id, name, block FROM hostel_rooms_smart WHERE tenant_id=$1 ORDER BY block, name', [tid])).rows;

    // Priority breakdown chart
    const prioBreakdown = (await pool.query(
      `SELECT priority, COUNT(*)::int AS c FROM room_maintenance WHERE tenant_id=$1 AND status='open' GROUP BY priority`, [tid])).rows;
    const prioData = prioBreakdown.map(p => ({ label: p.priority || 'normal', value: p.c, color: p.priority === 'high' ? PR : p.priority === 'low' ? PG : PY }));

    const filters = [['', 'All'], ['open', 'Open'], ['in_progress', 'In Progress'], ['resolved', 'Resolved']];

    let html = CSS + nav('maint');
    html += `<div style="max-width:1200px;margin:0 auto">
      <h2 style="color:#111827;margin-bottom:16px">🔧 Maintenance Requests</h2>
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${filters.map(([v, l]) => `<a href="/smart-hostel/maintenance?status=${v}" class="sh-btn ${statusFilter === v ? 'sh-btn-p' : 'sh-btn-o'}" style="padding:6px 14px;font-size:12px">${l}</a>`).join('')}
      </div>
      <div class="sh-grid2" style="margin-bottom:16px">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">📋 Report Issue</h3>
          <form method="POST" action="/smart-hostel/maintenance" style="display:flex;flex-direction:column;gap:12px">
            <div class="sh-fg"><label>Room</label>
              <select name="room_id"><option value="">General (no room)</option>
                ${rooms.map(r => `<option value="${r.id}">Block ${esc(r.block)} · ${esc(r.name)}</option>`).join('')}
              </select></div>
            <div class="sh-fg"><label>Item Name *</label><input name="item_name" required placeholder="e.g., Ceiling fan, Door lock"></div>
            <div class="sh-fg"><label>Issue Description *</label><textarea name="issue_description" required rows="2"></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div class="sh-fg"><label>Priority</label>
                <select name="priority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option></select></div>
              <div class="sh-fg"><label>Reported By</label><input name="reported_by" value="${esc(req.session.user.name || '')}"></div>
            </div>
            <button type="submit" class="sh-btn sh-btn-p">Submit Report</button>
          </form></div>
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">📊 Open Issues by Priority</h3>
          ${prioData.length ? svgDonut(prioData, 160, 160) : '<p class="sh-empty">No open issues</p>'}
        </div></div>`;
    if (issues.length) {
      html += '<div class="sh-card"><div style="overflow-x:auto"><table class="sh-tbl"><tr><th>ID</th><th>Item</th><th>Room</th><th>Description</th><th>Priority</th><th>Status</th><th>Reported</th><th>Actions</th></tr>';
      issues.forEach(m => {
        const acts = m.status === 'open' ? `
          <form method="POST" action="/smart-hostel/maintenance/${m.id}/progress" style="display:inline"><button class="sh-btn sh-btn-y" style="padding:4px 10px;font-size:11px">Start</button></form>
          <form method="POST" action="/smart-hostel/maintenance/${m.id}/resolve" style="display:inline"><button class="sh-btn sh-btn-g" style="padding:4px 10px;font-size:11px">Resolve</button></form>` :
          m.status === 'in_progress' ? `<form method="POST" action="/smart-hostel/maintenance/${m.id}/resolve" style="display:inline"><button class="sh-btn sh-btn-g" style="padding:4px 10px;font-size:11px">Resolve</button></form>` : '—';
        html += `<tr><td>#${m.id}</td><td>${esc(m.item_name)}</td><td>${m.room_name ? esc(m.room_name) : 'General'}</td>
          <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((m.issue_description || '').slice(0, 80))}</td>
          <td>${statusBadge(m.priority)}</td><td>${statusBadge(m.status)}</td><td>${fmtDate(m.created_at)}</td><td>${acts}</td></tr>`;
      });
      html += '</table></div></div>';
    } else { html += '<div class="sh-card"><p class="sh-empty">No maintenance requests.</p></div>'; }
    html += '</div>';
    res.send(renderPage('Maintenance', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 20: POST /smart-hostel/maintenance — Create Issue
  // ============================================================
  app.post('/smart-hostel/maintenance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { room_id, item_name, issue_description, priority, reported_by } = req.body;
    if (!item_name || !issue_description) return res.send('<div class="sh-alert sh-alert-err">Item name and description required.</div><a href="javascript:history.back()">Back</a>');
    await pool.query(
      'INSERT INTO room_maintenance (tenant_id,room_id,item_name,issue_description,reported_by,priority) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, room_id || null, item_name.trim(), issue_description.trim(), reported_by || null, priority || 'normal']);
    audit('maintenance_created', { item: item_name });
    res.redirect('/smart-hostel/maintenance');
  }));

  // ============================================================
  // ROUTE 21: POST maintenance progress/resolve
  // ============================================================
  app.post('/smart-hostel/maintenance/:id/progress', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE room_maintenance SET status=$1, assigned_to=$2 WHERE id=$3 AND tenant_id=$4", ['in_progress', req.session.user.name, req.params.id, tid]);
    res.redirect('/smart-hostel/maintenance');
  }));

  app.post('/smart-hostel/maintenance/:id/resolve', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query("UPDATE room_maintenance SET status=$1, resolved_at=NOW() WHERE id=$2 AND tenant_id=$3", ['resolved', req.params.id, tid]);
    audit('maintenance_resolved', { id: req.params.id });
    res.redirect('/smart-hostel/maintenance');
  }));

  // ============================================================
  // ROUTE 22: GET /smart-hostel/checkinout — Check-in/out
  // ============================================================
  app.get('/smart-hostel/checkinout', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const mode = req.query.mode || 'checkin';
    const term = req.query.term || 'Term 1';

    // Check-in view: unallocated students + available rooms
    const unassigned = (await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.class, s.admission_number FROM students s
       WHERE s.tenant_id=$1 AND s.id NOT IN (SELECT student_id FROM room_allocations WHERE tenant_id=$1 AND status='active' AND student_id IS NOT NULL)
       ORDER BY s.last_name, s.first_name LIMIT 500`, [tid])).rows;

    // Check-out view: active allocations
    const activeAllocs = (await pool.query(
      `SELECT a.*, r.name AS room_name, r.block, r.floor FROM room_allocations a
       JOIN hostel_rooms_smart r ON r.id=a.room_id
       WHERE a.tenant_id=$1 AND a.status='active' ORDER BY r.block, r.floor, a.bed_number`, [tid])).rows;

    // Rooms available for check-in
    const availRooms = (await pool.query(
      "SELECT * FROM hostel_rooms_smart WHERE tenant_id=$1 AND status IN ('available','reserved') AND current_occupants < capacity ORDER BY block, name", [tid])).rows;

    // Check-in/out stats
    const cioStats = (await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM room_allocations WHERE tenant_id=$1 AND check_in_date >= date_trunc('month', CURRENT_DATE) GROUP BY status`, [tid])).rows;
    const cioDonut = cioStats.map(s => ({ label: s.status.replace('_', ' '), value: s.c, color: s.status === 'active' || s.status === 'checked_in' ? PG : s.status === 'checked_out' ? '#6b7280' : PY }));

    let html = CSS + nav('cio');
    html += `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h2 style="color:#111827">🔑 Check-in / Check-out</h2>
        <div style="display:flex;gap:8px">
          <a href="/smart-hostel/checkinout?mode=checkin" class="sh-btn ${mode === 'checkin' ? 'sh-btn-p' : 'sh-btn-o'}">Check-in</a>
          <a href="/smart-hostel/checkinout?mode=checkout" class="sh-btn ${mode === 'checkout' ? 'sh-btn-r' : 'sh-btn-o'}">Check-out</a>
        </div></div>`;

    if (mode === 'checkin') {
      html += `<div class="sh-grid2">
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">📥 Student Check-in (${esc(term)})</h3>
          <form method="POST" action="/smart-hostel/checkinout" style="display:flex;flex-direction:column;gap:12px">
            <input type="hidden" name="action" value="checkin">
            <div class="sh-fg"><label>Student *</label>
              <select name="student_id" required>
                <option value="">Select student...</option>
                ${unassigned.map(s => `<option value="${s.id}" data-class="${esc(s.class || '')}">${esc(s.last_name)}, ${esc(s.first_name)} (${esc(s.class || 'N/A')})</option>`).join('')}
              </select>
              ${unassigned.length === 0 ? '<small style="color:#6b7280">All students allocated!</small>' : `<small style="color:#6b7280">${unassigned.length} students pending</small>`}</div>
            <div class="sh-fg"><label>Assign Room *</label>
              <select name="room_id" required>
                <option value="">Select room...</option>
                ${availRooms.map(r => `<option value="${r.id}">Block ${esc(r.block)} · ${esc(r.name)} (${r.current_occupants}/${r.capacity})</option>`).join('')}
              </select></div>
            <div class="sh-fg"><label>Condition Report</label><textarea name="condition_report" rows="2" placeholder="Note room condition at check-in..."></textarea></div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151">
              <input type="checkbox" name="key_handover" value="1"> Key handed over</label>
            <button type="submit" class="sh-btn sh-btn-g">✅ Process Check-in</button>
          </form></div>
        <div class="sh-card">
          <h3 style="color:#111827;margin:0 0 12px">📊 This Month's Activity</h3>
          ${cioDonut.length ? svgDonut(cioDonut, 160, 160) : '<p class="sh-empty">No data</p>'}
          <div style="margin-top:16px">
            <p style="font-size:13px;color:#374151"><strong>${unassigned.length}</strong> students pending check-in</p>
            <p style="font-size:13px;color:#374151"><strong>${activeAllocs.length}</strong> currently checked in</p>
            <p style="font-size:13px;color:#374151"><strong>${availRooms.length}</strong> rooms with space</p>
          </div></div></div>`;
    } else {
      html += `<div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">📤 Student Check-out (${esc(term)})</h3>`;
      if (activeAllocs.length) {
        html += '<div style="overflow-x:auto"><table class="sh-tbl"><tr><th>Student</th><th>Class</th><th>Room</th><th>Block</th><th>Checked In</th><th>Actions</th></tr>';
        activeAllocs.forEach(a => {
          html += `<tr><td>${esc(a.student_name)}</td><td>${esc(a.student_class || '—')}</td>
            <td>${esc(a.room_name)}</td><td>${esc(a.block)}</td><td>${fmtDate(a.check_in_date)}</td>
            <td><form method="POST" action="/smart-hostel/checkinout" style="display:inline" onsubmit="return confirm('Check out ${esc(a.student_name)}?')">
              <input type="hidden" name="action" value="checkout"><input type="hidden" name="alloc_id" value="${a.id}">
              <button class="sh-btn sh-btn-r" style="padding:5px 12px;font-size:12px">Check Out</button></form></td></tr>`;
        });
        html += '</table></div>';
      } else { html += '<p class="sh-empty">No students currently checked in.</p>'; }
      html += '</div>';
    }
    html += '</div>';
    res.send(renderPage('Check-in/out', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 23: POST /smart-hostel/checkinout — Process CIO
  // ============================================================
  app.post('/smart-hostel/checkinout', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const action = req.body.action;

    if (action === 'checkin') {
      const { student_id, room_id, condition_report, key_handover } = req.body;
      if (!student_id || !room_id) return res.send('<div class="sh-alert sh-alert-err">Select student and room.</div><a href="javascript:history.back()">Back</a>');

      const stu = (await pool.query('SELECT first_name, last_name, class FROM students WHERE id=$1 AND tenant_id=$2', [student_id, tid])).rows[0];
      if (!stu) return res.send('<div class="sh-alert sh-alert-err">Student not found.</div><a href="javascript:history.back()">Back</a>');
      const room = (await pool.query('SELECT * FROM hostel_rooms_smart WHERE id=$1 AND tenant_id=$2', [room_id, tid])).rows[0];
      if (!room) return res.send('<div class="sh-alert sh-alert-err">Room not found.</div><a href="javascript:history.back()">Back</a>');

      const bedNum = room.current_occupants + 1;
      const stuName = (stu.first_name + ' ' + stu.last_name).trim();
      await pool.query(
        `INSERT INTO room_allocations (tenant_id,room_id,student_id,student_name,student_class,bed_number,status,check_in_date,key_handover,condition_report)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)`,
        [tid, room_id, student_id, stuName, stu.class, bedNum, today(), key_handover === '1', condition_report || null]);
      await pool.query(
        'UPDATE hostel_rooms_smart SET current_occupants=current_occupants+1, status=CASE WHEN current_occupants+1>=capacity THEN $1 ELSE status END, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
        ['full', room_id, tid]);
      audit('check_in', { student: stuName, room: room.name });
      req.session.smartHostelMsg = `${stuName} checked into ${room.name}.`;
      res.redirect('/smart-hostel/checkinout?mode=checkin');
    } else if (action === 'checkout') {
      const { alloc_id } = req.body;
      if (!alloc_id) return res.send('<div class="sh-alert sh-alert-err">Invalid allocation.</div><a href="javascript:history.back()">Back</a>');
      const alloc = (await pool.query(
        'SELECT a.room_id, a.student_name FROM room_allocations a WHERE a.id=$1 AND a.tenant_id=$2 AND a.status=$3', [alloc_id, tid, 'active'])).rows;
      if (!alloc.length) return res.status(404).send('Active allocation not found.');
      await pool.query('UPDATE room_allocations SET status=$1, check_out_date=NOW() WHERE id=$2 AND tenant_id=$3', ['checked_out', alloc_id, tid]);
      await pool.query('UPDATE hostel_rooms_smart SET current_occupants=GREATEST(current_occupants-1,0), status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', ['available', alloc[0].room_id, tid]);
      audit('check_out', { student: alloc[0].student_name, alloc_id });
      req.session.smartHostelMsg = `${alloc[0].student_name} checked out.`;
      res.redirect('/smart-hostel/checkinout?mode=checkout');
    } else {
      res.redirect('/smart-hostel/checkinout');
    }
  }));

  // ============================================================
  // ROUTE 24: GET /smart-hostel/reports — Analytics
  // ============================================================
  app.get('/smart-hostel/reports', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Occupancy by floor
    const floorOcc = (await pool.query(
      `SELECT floor, COUNT(*)::int AS total,
        SUM(CASE WHEN current_occupants > 0 THEN 1 ELSE 0 END)::int AS occupied_rooms,
        SUM(current_occupants)::int AS total_occupants,
        SUM(capacity)::int AS total_capacity
       FROM hostel_rooms_smart WHERE tenant_id=$1 GROUP BY floor ORDER BY floor`, [tid])).rows;
    const floorBar = floorOcc.map(f => ({
      label: 'F' + f.floor, value: f.total_capacity > 0 ? pct(f.total_occupants, f.total_capacity) : 0,
      color: f.total_capacity > 0 && pct(f.total_occupants, f.total_capacity) > 80 ? PR : P
    }));

    // Amenity distribution
    const amenStats = (await pool.query(
      `SELECT unnest(amenities) AS amen, COUNT(*)::int AS c
       FROM hostel_rooms_smart WHERE tenant_id=$1 AND amenities != '{}' GROUP BY amen ORDER BY c DESC`, [tid])).rows;
    const amenBar = amenStats.map(a => ({ label: a.amen, value: a.c, color: [P, P2, '#818cf8', '#8b5cf6', '#a78bfa', PG][amenStats.indexOf(a) % 6] }));

    // Maintenance resolution time
    const maintResolution = (await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM room_maintenance WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;
    const maintDonut = maintResolution.map(m => ({ label: m.status.replace('_', ' '), value: m.c, color: m.status === 'resolved' ? PG : m.status === 'in_progress' ? PY : m.status === 'open' ? PR : '#6b7280' }));

    // Inspection score distribution
    const scoreDist = (await pool.query(
      `SELECT CASE WHEN total_score >= 8 THEN 'Excellent' WHEN total_score >= 5 THEN 'Good' ELSE 'Poor' END AS grade,
        COUNT(*)::int AS c FROM room_inspections WHERE tenant_id=$1 GROUP BY grade ORDER BY grade`, [tid])).rows;
    const scoreColors = { 'Excellent': PG, 'Good': PY, 'Poor': PR };
    const scoreDonut = scoreDist.map(s => ({ label: s.grade, value: s.c, color: scoreColors[s.grade] || '#6b7280' }));

    let html = CSS + nav('dash');
    html += `<div style="max-width:1200px;margin:0 auto">
      <h2 style="color:#111827;margin-bottom:20px">📊 Smart Hostel Analytics</h2>
      <div class="sh-grid2" style="margin-bottom:16px">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">Occupancy by Floor</h3>
          ${floorBar.length ? `<p style="font-size:12px;color:#6b7280;margin-bottom:8px">Occupancy % per floor</p>${svgBar(floorBar, 400, 160)}` : '<p class="sh-empty">No data</p>'}</div>
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">Amenity Distribution</h3>
          ${amenBar.length ? svgHBar(amenBar, 380, Math.max(100, amenBar.length * 30)) : '<p class="sh-empty">No data</p>'}</div>
      </div>
      <div class="sh-grid2">
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">Maintenance Status</h3>
          ${maintDonut.length ? svgDonut(maintDonut, 160, 160) : '<p class="sh-empty">No data</p>'}</div>
        <div class="sh-card"><h3 style="color:#111827;margin:0 0 12px">Inspection Grades</h3>
          ${scoreDonut.length ? svgDonut(scoreDonut, 160, 160) : '<p class="sh-empty">No data</p>'}</div>
      </div></div>`;
    res.send(renderPage('Hostel Analytics', html, req.session.user, req));
  }));
};
