/**
 * Hostel / Accommodation Management Module
 * Multi-tenant SaaS platform (schools)
 *
 * Features: Buildings, Rooms, Allocations, Maintenance, Reports, Bed Spaces
 * 14 routes • PostgreSQL • tenant_id scoped
 */
module.exports = function hostelManager(app, db, pool, renderPage, esc) {

  // ── Helpers ────────────────────────────────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (action) => `/hostel${action}`;

  // ── Migrations ─────────────────────────────────────────────────────────────
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hostel_buildings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, type VARCHAR(20) DEFAULT 'boys',
        total_rooms INTEGER DEFAULT 0, warden_name VARCHAR(255), warden_phone VARCHAR(20),
        description TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS hostel_rooms (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        building_id INTEGER NOT NULL REFERENCES hostel_buildings(id) ON DELETE CASCADE,
        room_number VARCHAR(20) NOT NULL, floor INTEGER DEFAULT 1,
        capacity INTEGER DEFAULT 4, current_occupants INTEGER DEFAULT 0,
        room_type VARCHAR(20) DEFAULT 'shared', amenities TEXT[],
        status VARCHAR(20) DEFAULT 'available', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS hostel_allocations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
        student_name VARCHAR(255) NOT NULL, student_id VARCHAR(50),
        class VARCHAR(50), bed_number INTEGER,
        check_in_date DATE, check_out_date DATE,
        status VARCHAR(20) DEFAULT 'active', parent_phone VARCHAR(20),
        emergency_contact TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS hostel_maintenance (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        room_id INTEGER REFERENCES hostel_rooms(id), building_id INTEGER REFERENCES hostel_buildings(id),
        issue_type VARCHAR(50), description TEXT,
        reported_by VARCHAR(255), priority VARCHAR(20) DEFAULT 'normal',
        status VARCHAR(20) DEFAULT 'pending', resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ALTER TABLE for any columns that might be missing
    const alters = [
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT '';`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'boys';`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS total_rooms INTEGER DEFAULT 0;`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS warden_name VARCHAR(255);`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS warden_phone VARCHAR(20);`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS description TEXT;`,
      `ALTER TABLE hostel_buildings ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS room_number VARCHAR(20) NOT NULL DEFAULT '';`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS floor INTEGER DEFAULT 1;`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 4;`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS current_occupants INTEGER DEFAULT 0;`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS room_type VARCHAR(20) DEFAULT 'shared';`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS amenities TEXT[];`,
      `ALTER TABLE hostel_rooms ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'available';`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) NOT NULL DEFAULT '';`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS student_id VARCHAR(50);`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS class VARCHAR(50);`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS bed_number INTEGER;`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS check_in_date DATE;`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS check_out_date DATE;`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS parent_phone VARCHAR(20);`,
      `ALTER TABLE hostel_allocations ADD COLUMN IF NOT EXISTS emergency_contact TEXT;`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS issue_type VARCHAR(50);`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS description TEXT;`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS reported_by VARCHAR(255);`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';`,
      `ALTER TABLE hostel_maintenance ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;`,
    ];
    for (const sql of alters) { try { await pool.query(sql); } catch (_) { /* exists */ } }

    // Indexes
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_hb_tenant ON hostel_buildings(tenant_id);`,
      `CREATE INDEX IF NOT EXISTS idx_hb_status ON hostel_buildings(status);`,
      `CREATE INDEX IF NOT EXISTS idx_hr_tenant ON hostel_rooms(tenant_id);`,
      `CREATE INDEX IF NOT EXISTS idx_hr_building ON hostel_rooms(building_id);`,
      `CREATE INDEX IF NOT EXISTS idx_hr_status ON hostel_rooms(status);`,
      `CREATE INDEX IF NOT EXISTS idx_ha_tenant ON hostel_allocations(tenant_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ha_room ON hostel_allocations(room_id);`,
      `CREATE INDEX IF NOT EXISTS idx_ha_status ON hostel_allocations(status);`,
      `CREATE INDEX IF NOT EXISTS idx_hm_tenant ON hostel_maintenance(tenant_id);`,
      `CREATE INDEX IF NOT EXISTS idx_hm_building ON hostel_maintenance(building_id);`,
      `CREATE INDEX IF NOT EXISTS idx_hm_status ON hostel_maintenance(status);`,
    ];
    for (const sql of indexes) { try { await pool.query(sql); } catch (_) { /* exists */ } }
  }

  // ── Shared nav ─────────────────────────────────────────────────────────────
  function nav(active) {
    const links = [
      ['Dashboard', ah('')],
      ['Buildings', ah('/buildings')],
      ['Maintenance', ah('/maintenance')],
      ['Reports', ah('/report')],
      ['Bed Spaces', ah('/bed-spaces')],
    ];
    return '<nav class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:24px;">' +
      links.map(([label, href]) =>
        `<a href="${href}" class="btn btn-sm ${active === label ? 'btn-green' : 'btn-blue'}">${label}</a>`
      ).join('') + '</nav>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1 — Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [bldgs, rooms, allocs, maint] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM hostel_buildings WHERE tenant_id=$1 AND is_active=true', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM hostel_rooms WHERE tenant_id=$1', [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM hostel_allocations WHERE tenant_id=$1 AND status='active'", [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM hostel_maintenance WHERE tenant_id=$1 AND status='pending'", [tid]),
    ]);
    const bc = bldgs.rows[0].c, rc = rooms.rows[0].c;
    const ac = allocs.rows[0].c, mc = maint.rows[0].c;

    // Recent allocations
    const recent = await pool.query(
      `SELECT a.*, r.room_number, b.name AS building_name
       FROM hostel_allocations a
       JOIN hostel_rooms r ON r.id=a.room_id
       JOIN hostel_buildings b ON b.id=r.building_id
       WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 8`, [tid]);

    // Pending maintenance
    const pendingMaint = await pool.query(
      `SELECT m.*, b.name AS building_name, r.room_number
       FROM hostel_maintenance m
       LEFT JOIN hostel_buildings b ON b.id=m.building_id
       LEFT JOIN hostel_rooms r ON r.id=m.room_id
       WHERE m.tenant_id=$1 AND m.status='pending'
       ORDER BY m.created_at DESC LIMIT 5`, [tid]);

    let html = nav('Dashboard');
    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${bc}</div><div>Buildings</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${rc}</div><div>Total Rooms</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${ac}</div><div>Occupants</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${mc}</div><div>Maintenance Pending</div></div>`;
    html += '</div>';

    html += '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px;">';

    // Recent allocations card
    html += '<div class="card"><h3>Recent Allocations</h3>';
    if (recent.rows.length) {
      html += '<table><tr><th>Student</th><th>Room</th><th>Building</th><th>Date</th></tr>';
      recent.rows.forEach(r => {
        html += `<tr><td>${esc(r.student_name)}</td><td>${esc(r.room_number)}</td>` +
          `<td>${esc(r.building_name)}</td><td>${r.check_in_date || '—'}</td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No allocations yet.</p>';
    }
    html += '</div>';

    // Pending maintenance card
    html += '<div class="card"><h3>Pending Maintenance</h3>';
    if (pendingMaint.rows.length) {
      html += '<table><tr><th>Issue</th><th>Location</th><th>Priority</th><th>Action</th></tr>';
      pendingMaint.rows.forEach(m => {
        const loc = [m.building_name, m.room_number].filter(Boolean).join(' / ');
        const pBadge = m.priority === 'high'
          ? '<span class="badge badge-warning">High</span>'
          : `<span class="badge">${esc(m.priority || 'normal')}</span>`;
        html += `<tr><td>${esc(m.issue_type || 'N/A')}</td><td>${esc(loc || '—')}</td>` +
          `<td>${pBadge}</td>` +
          `<td><form method="POST" action="${ah('/maintenance/' + m.id + '/resolve')}" style="display:inline">` +
          `<button class="btn btn-sm btn-green">Resolve</button></form></td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No pending issues.</p>';
    }
    html += '</div></div>';

    renderPage('Hostel Dashboard', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2 — Buildings list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/buildings', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const result = await pool.query(`
      SELECT b.*,
        (SELECT COUNT(*)::int FROM hostel_rooms WHERE building_id=b.id) AS room_count,
        (SELECT COUNT(*)::int FROM hostel_allocations a
          JOIN hostel_rooms r ON r.id=a.room_id
          WHERE r.building_id=b.id AND a.status='active') AS occupant_count
      FROM hostel_buildings b
      WHERE b.tenant_id=$1 ORDER BY b.name`, [tid]);

    let html = nav('Buildings');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Hostel Buildings</h2>' +
      `<a href="${ah('/buildings/new')}" class="btn btn-green">+ Add Building</a></div>`;

    if (result.rows.length) {
      html += '<table><tr><th>Name</th><th>Type</th><th>Rooms</th><th>Occupants</th>' +
        '<th>Warden</th><th>Status</th><th>Actions</th></tr>';
      result.rows.forEach(b => {
        const statusBadge = b.is_active
          ? '<span class="badge badge-success">Active</span>'
          : '<span class="badge badge-warning">Inactive</span>';
        html += `<tr>
          <td><a href="${ah('/buildings/' + b.id)}">${esc(b.name)}</a></td>
          <td>${esc(b.type)}</td>
          <td>${b.room_count}</td>
          <td>${b.occupant_count}</td>
          <td>${esc(b.warden_name || '—')}</td>
          <td>${statusBadge}</td>
          <td>
            <a href="${ah('/buildings/' + b.id)}" class="btn btn-sm btn-blue">View</a>
            <form method="POST" action="${ah('/buildings/' + b.id + '/delete')}" style="display:inline" ` +
            `onsubmit="return confirm('Delete this building and all its rooms?')">` +
            `<input type="hidden" name="_method" value="DELETE">` +
            `<button class="btn btn-sm btn-red">Delete</button></form>
          </td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p class="muted">No buildings added yet.</p></div>';
    }
    renderPage('Hostel Buildings', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3 — Add building form
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/buildings/new', requireAuth, async (req, res) => {
    let html = nav('Buildings');
    html += '<div class="card"><h2>Add New Building</h2>';
    html += `<form method="POST" action="${ah('/buildings/create')}">`;
    html += `
      <label>Name *</label><br><input name="name" required style="width:100%;max-width:400px;padding:8px;"><br><br>
      <label>Type</label><br>
      <select name="type" style="padding:8px;">
        <option value="boys">Boys</option>
        <option value="girls">Girls</option>
        <option value="mixed">Mixed</option>
        <option value="staff">Staff</option>
      </select><br><br>
      <label>Total Rooms</label><br>
      <input name="total_rooms" type="number" min="0" value="0" style="width:120px;padding:8px;"><br><br>
      <label>Warden Name</label><br>
      <input name="warden_name" style="width:100%;max-width:400px;padding:8px;"><br><br>
      <label>Warden Phone</label><br>
      <input name="warden_phone" style="width:200px;padding:8px;"><br><br>
      <label>Description</label><br>
      <textarea name="description" rows="3" style="width:100%;max-width:500px;padding:8px;"></textarea><br><br>
      <label><input type="checkbox" name="is_active" checked> Active</label><br><br>
      <button type="submit" class="btn btn-green">Save Building</button>
      <a href="${ah('/buildings')}" class="btn btn-sm">Cancel</a>
    `;
    html += '</form></div>';
    renderPage('Add Building', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4 — Save building
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/hostel/buildings/create', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, total_rooms, warden_name, warden_phone, description, is_active } = req.body;
    if (!name || !name.trim()) {
      return res.send('<div class="alert">Building name is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    await pool.query(
      `INSERT INTO hostel_buildings (tenant_id,name,type,total_rooms,warden_name,warden_phone,description,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, name.trim(), type || 'boys', parseInt(total_rooms) || 0,
        warden_name || null, warden_phone || null, description || null,
        is_active !== undefined && is_active !== 'false']
    );
    res.redirect(ah('/buildings'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5 — Building detail with room grid
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/buildings/:id', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const bldg = await pool.query(
      'SELECT * FROM hostel_buildings WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!bldg.rows.length) return res.status(404).send('Building not found.');
    const b = bldg.rows[0];

    const rooms = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*)::int FROM hostel_allocations a WHERE a.room_id=r.id AND a.status='active') AS occupants
       FROM hostel_rooms r WHERE r.building_id=$1 AND r.tenant_id=$2 ORDER BY r.floor, r.room_number`,
      [id, tid]);

    let html = nav('Buildings');
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h2>${esc(b.name)} <span class="muted">(${esc(b.type)})</span></h2>
      <a href="${ah('/buildings')}" class="btn btn-sm btn-blue">&larr; All Buildings</a>
    </div>`;

    // Building info card
    html += '<div class="card">';
    html += `<p><strong>Warden:</strong> ${esc(b.warden_name || '—')} &nbsp; <strong>Phone:</strong> ${esc(b.warden_phone || '—')}</p>`;
    html += `<p><strong>Total Rooms:</strong> ${b.total_rooms} &nbsp; <strong>Status:</strong> ` +
      (b.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>') + '</p>';
    if (b.description) html += `<p><strong>Description:</strong> ${esc(b.description)}</p>`;
    html += '</div>';

    // Rooms grid
    html += '<h3 style="margin:20px 0 12px;">Rooms</h3>';
    if (rooms.rows.length) {
      html += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">';
      rooms.rows.forEach(r => {
        const full = r.occupants >= r.capacity;
        const sBadge = full
          ? '<span class="badge badge-warning">Full</span>'
          : r.status === 'maintenance'
            ? '<span class="badge badge-warning">Maint.</span>'
            : '<span class="badge badge-success">Available</span>';
        html += `<div class="card" style="text-align:center;">
          <a href="${ah('/rooms/' + r.id)}" style="font-weight:bold;font-size:1.2em;">${esc(r.room_number)}</a>
          <br>Floor ${r.floor} &middot; ${esc(r.room_type)}
          <br>${r.occupants}/${r.capacity} occupants ${sBadge}
          <br><small class="muted">${(r.amenities || []).join(', ') || 'No amenities'}</small>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<p class="muted">No rooms in this building yet.</p>';
    }
    renderPage('Building: ' + b.name, html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6 — Room detail with occupants
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/rooms/:id', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const room = await pool.query(
      `SELECT r.*, b.name AS building_name, b.type AS building_type
       FROM hostel_rooms r JOIN hostel_buildings b ON b.id=r.building_id
       WHERE r.id=$1 AND r.tenant_id=$2`, [id, tid]);
    if (!room.rows.length) return res.status(404).send('Room not found.');
    const r = room.rows[0];

    const allocs = await pool.query(
      `SELECT * FROM hostel_allocations WHERE room_id=$1 AND tenant_id=$2 AND status='active'
       ORDER BY bed_number`, [id, tid]);

    const bedNums = [];
    for (let i = 1; i <= r.capacity; i++) {
      const occ = allocs.rows.find(a => a.bed_number === i);
      bedNums.push({ bed: i, occupied: !!occ, occupant: occ });
    }

    let html = nav('Dashboard');
    html += `<a href="${ah('/buildings/' + r.building_id)}" class="btn btn-sm btn-blue" style="margin-bottom:12px;">&larr; ${esc(r.building_name)}</a>`;
    html += '<div class="card">';
    html += `<h2>Room ${esc(r.room_number)}</h2>`;
    html += `<p><strong>Building:</strong> ${esc(r.building_name)} (${esc(r.building_type)})</p>`;
    html += `<p><strong>Floor:</strong> ${r.floor} &middot; <strong>Type:</strong> ${esc(r.room_type)} &middot; <strong>Capacity:</strong> ${r.capacity}</p>`;
    html += `<p><strong>Amenities:</strong> ${(r.amenities || []).join(', ') || 'None'}</p>`;
    html += `<p><strong>Status:</strong> ${r.status === 'available'
      ? '<span class="badge badge-success">Available</span>'
      : r.status === 'full'
        ? '<span class="badge badge-warning">Full</span>'
        : '<span class="badge badge-warning">' + esc(r.status) + '</span>'}</p>`;
    html += '</div>';

    // Bed space visualization
    html += '<h3 style="margin:16px 0 8px;">Bed Spaces</h3>';
    html += '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">';
    bedNums.forEach(b => {
      if (b.occupied) {
        const o = b.occupant;
        html += `<div class="card" style="border-left:4px solid #27ae60;">
          <strong>Bed ${b.bed}</strong><br>
          ${esc(o.student_name)}<br>
          <small class="muted">${esc(o.class || '')} ${esc(o.student_id || '')}</small><br>
          <form method="POST" action="${ah('/deallocate/' + o.id)}" style="display:inline;margin-top:6px;"
            onsubmit="return confirm('Remove ${esc(o.student_name)}?')">
            <button class="btn btn-sm btn-red">Remove</button>
          </form>
        </div>`;
      } else {
        html += `<div class="card" style="border-left:4px solid #3498db;text-align:center;opacity:0.7;">
          <strong>Bed ${b.bed}</strong><br><span class="muted">Vacant</span>
        </div>`;
      }
    });
    html += '</div>';

    // Allocate student form
    const availableBeds = bedNums.filter(b => !b.occupied).map(b => b.bed);
    if (availableBeds.length) {
      html += '<h3 style="margin:20px 0 8px;">Allocate Student</h3>';
      html += `<div class="card"><form method="POST" action="${ah('/allocate')}">
        <input type="hidden" name="room_id" value="${r.id}">
        <table>
          <tr><td><label>Student Name *</label></td><td><input name="student_name" required style="width:250px;padding:8px;"></td></tr>
          <tr><td><label>Student ID</label></td><td><input name="student_id" style="width:200px;padding:8px;"></td></tr>
          <tr><td><label>Class</label></td><td><input name="class" style="width:200px;padding:8px;"></td></tr>
          <tr><td><label>Bed Number *</label></td><td>
            <select name="bed_number" required style="padding:8px;">${availableBeds.map(b =>
              `<option value="${b}">Bed ${b}</option>`).join('')}
            </select></td></tr>
          <tr><td><label>Check-in Date</label></td><td><input name="check_in_date" type="date" style="padding:8px;"></td></tr>
          <tr><td><label>Parent Phone</label></td><td><input name="parent_phone" style="width:200px;padding:8px;"></td></tr>
          <tr><td><label>Emergency Contact</label></td><td><input name="emergency_contact" style="width:300px;padding:8px;"></td></tr>
        </table>
        <button type="submit" class="btn btn-green">Allocate</button>
      </form></div>`;
    }

    renderPage('Room ' + r.room_number, html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7 — Allocate student
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/hostel/allocate', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { room_id, student_name, student_id, class: cls, bed_number, check_in_date, parent_phone, emergency_contact } = req.body;
    if (!student_name || !student_name.trim() || !room_id || !bed_number) {
      return res.send('<div class="alert">Student name, room, and bed number are required.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Verify room belongs to tenant and has capacity
    const roomCheck = await pool.query(
      'SELECT capacity, current_occupants FROM hostel_rooms WHERE id=$1 AND tenant_id=$2', [room_id, tid]);
    if (!roomCheck.rows.length) return res.status(404).send('Room not found.');
    const rm = roomCheck.rows[0];
    if (rm.current_occupants >= rm.capacity) {
      return res.send('<div class="alert">Room is full.</div><a href="javascript:history.back()">Go back</a>');
    }

    // Check bed not already taken
    const bedCheck = await pool.query(
      `SELECT id FROM hostel_allocations WHERE room_id=$1 AND bed_number=$2 AND tenant_id=$3 AND status='active'`,
      [room_id, bed_number, tid]);
    if (bedCheck.rows.length) {
      return res.send('<div class="alert">Bed ' + bed_number + ' is already occupied.</div><a href="javascript:history.back()">Go back</a>');
    }

    await pool.query(
      `INSERT INTO hostel_allocations
        (tenant_id,room_id,student_name,student_id,class,bed_number,check_in_date,parent_phone,emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, room_id, student_name.trim(), student_id || null, cls || null,
        parseInt(bed_number), check_in_date || null, parent_phone || null, emergency_contact || null]);

    // Update room occupancy
    await pool.query(
      `UPDATE hostel_rooms SET current_occupants = current_occupants + 1,
        status = CASE WHEN current_occupants + 1 >= capacity THEN 'full' ELSE 'available' END
       WHERE id=$1`, [room_id]);

    res.redirect(ah('/rooms/' + room_id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8 — Deallocate student
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/hostel/deallocate/:id', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const alloc = await pool.query(
      'SELECT room_id FROM hostel_allocations WHERE id=$1 AND tenant_id=$2 AND status=\'active\'', [id, tid]);
    if (!alloc.rows.length) return res.status(404).send('Allocation not found.');

    await pool.query(
      `UPDATE hostel_allocations SET status='checked_out', check_out_date=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tid]);
    await pool.query(
      `UPDATE hostel_rooms SET current_occupants = GREATEST(current_occupants - 1, 0),
        status = 'available' WHERE id=$1`, [alloc.rows[0].room_id]);

    res.redirect(ah('/rooms/' + alloc.rows[0].room_id));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9 — Maintenance requests list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/maintenance', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const statusFilter = req.query.status || '';

    let where = 'm.tenant_id=$1';
    const params = [tid];
    if (statusFilter) {
      where += ' AND m.status=$2';
      params.push(statusFilter);
    }

    const list = await pool.query(
      `SELECT m.*, b.name AS building_name, r.room_number
       FROM hostel_maintenance m
       LEFT JOIN hostel_buildings b ON b.id=m.building_id
       LEFT JOIN hostel_rooms r ON r.id=m.room_id
       WHERE ${where} ORDER BY m.created_at DESC`, params);

    const buildings = await pool.query(
      'SELECT id, name FROM hostel_buildings WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]);

    const rooms = await pool.query(
      'SELECT r.id, r.room_number, b.name AS building_name FROM hostel_rooms r JOIN hostel_buildings b ON b.id=r.building_id WHERE r.tenant_id=$1 ORDER BY b.name, r.room_number', [tid]);

    let html = nav('Maintenance');
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h2>Maintenance Requests</h2>' +
      '<div><a href="#report-form" class="btn btn-gold">+ Report Issue</a></div></div>';

    // Filter buttons
    const filters = [['', 'All'], ['pending', 'Pending'], ['in_progress', 'In Progress'], ['resolved', 'Resolved']];
    html += '<div style="margin-bottom:16px;">';
    filters.forEach(([val, label]) => {
      html += `<a href="${ah('/maintenance?status=' + val)}" class="btn btn-sm ${statusFilter === val ? 'btn-green' : ''}">${label}</a> `;
    });
    html += '</div>';

    if (list.rows.length) {
      html += '<table><tr><th>ID</th><th>Issue</th><th>Description</th><th>Location</th>' +
        '<th>Priority</th><th>Status</th><th>Reported</th><th>Actions</th></tr>';
      list.rows.forEach(m => {
        const loc = [m.building_name, m.room_number].filter(Boolean).join(' / ');
        const pBadge = m.priority === 'high'
          ? '<span class="badge badge-warning">High</span>'
          : m.priority === 'low'
            ? '<span class="badge badge-success">Low</span>'
            : `<span class="badge">${esc(m.priority || 'normal')}</span>`;
        const sBadge = m.status === 'resolved'
          ? '<span class="badge badge-success">Resolved</span>'
          : m.status === 'in_progress'
            ? '<span class="badge badge-warning">In Progress</span>'
            : '<span class="badge">Pending</span>';
        const resolveBtn = m.status !== 'resolved'
          ? `<form method="POST" action="${ah('/maintenance/' + m.id + '/resolve')}" style="display:inline">
             <button class="btn btn-sm btn-green">Resolve</button></form>`
          : '<span class="muted">Done</span>';
        html += `<tr>
          <td>#${m.id}</td>
          <td>${esc(m.issue_type || 'N/A')}</td>
          <td>${esc((m.description || '').substring(0, 80))}${(m.description || '').length > 80 ? '…' : ''}</td>
          <td>${esc(loc || '—')}</td>
          <td>${pBadge}</td>
          <td>${sBadge}</td>
          <td>${m.created_at ? m.created_at.toISOString().split('T')[0] : '—'}</td>
          <td>${resolveBtn}</td>
        </tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No maintenance requests found.</p>';
    }

    // Report issue form
    html += `<div id="report-form" class="card" style="margin-top:24px;"><h3>Report Maintenance Issue</h3>`;
    html += `<form method="POST" action="${ah('/maintenance/new')}">
      <table>
        <tr><td><label>Building</label></td><td>
          <select name="building_id" style="padding:8px;" id="maint-building">
            <option value="">-- Select --</option>
            ${buildings.rows.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
          </select></td></tr>
        <tr><td><label>Room</label></td><td>
          <select name="room_id" style="padding:8px;">
            <option value="">-- Select --</option>
            ${rooms.rows.map(r => `<option value="${r.id}" data-bldg="">${esc(r.building_name)} - ${esc(r.room_number)}</option>`).join('')}
          </select></td></tr>
        <tr><td><label>Issue Type</label></td><td>
          <select name="issue_type" style="padding:8px;">
            <option value="plumbing">Plumbing</option>
            <option value="electrical">Electrical</option>
            <option value="furniture">Furniture</option>
            <option value="structural">Structural</option>
            <option value="cleaning">Cleaning</option>
            <option value="painting">Painting</option>
            <option value="other">Other</option>
          </select></td></tr>
        <tr><td><label>Priority</label></td><td>
          <select name="priority" style="padding:8px;">
            <option value="low">Low</option>
            <option value="normal" selected>Normal</option>
            <option value="high">High</option>
          </select></td></tr>
        <tr><td><label>Description</label></td><td>
          <textarea name="description" rows="3" style="width:100%;max-width:400px;padding:8px;" required></textarea></td></tr>
        <tr><td><label>Reported By</label></td><td>
          <input name="reported_by" value="${esc(req.session.user.name || '')}" style="width:250px;padding:8px;"></td></tr>
      </table>
      <button type="submit" class="btn btn-green">Submit Report</button>
    </form></div>`;

    renderPage('Hostel Maintenance', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10 — Report new maintenance issue
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/hostel/maintenance/new', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { building_id, room_id, issue_type, priority, description, reported_by } = req.body;
    if (!description || !description.trim()) {
      return res.send('<div class="alert">Description is required.</div><a href="javascript:history.back()">Go back</a>');
    }
    await pool.query(
      `INSERT INTO hostel_maintenance (tenant_id,building_id,room_id,issue_type,description,reported_by,priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, building_id || null, room_id || null, issue_type || 'other',
        description.trim(), reported_by || null, priority || 'normal']);
    res.redirect(ah('/maintenance'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11 — Resolve maintenance issue
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/hostel/maintenance/:id/resolve', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE hostel_maintenance SET status='resolved', resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [id, tid]);
    if (result.rowCount === 0) return res.status(404).send('Maintenance request not found.');
    res.redirect(ah('/maintenance'));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12 — Occupancy Reports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/report', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Building-level stats
    const bStats = await pool.query(`
      SELECT b.id, b.name, b.type,
        (SELECT COUNT(*)::int FROM hostel_rooms WHERE building_id=b.id) AS total_rooms,
        (SELECT COALESCE(SUM(r.capacity),0)::int FROM hostel_rooms r WHERE r.building_id=b.id) AS total_beds,
        (SELECT COUNT(*)::int FROM hostel_allocations a
          JOIN hostel_rooms r ON r.id=a.room_id
          WHERE r.building_id=b.id AND a.status='active') AS occupants
      FROM hostel_buildings b WHERE b.tenant_id=$1 AND b.is_active=true ORDER BY b.name`, [tid]);

    // Room type breakdown
    const typeBreakdown = await pool.query(`
      SELECT r.room_type, COUNT(*)::int AS rooms,
        SUM(r.capacity)::int AS total_capacity,
        SUM(r.current_occupants)::int AS total_occupied
      FROM hostel_rooms r WHERE r.tenant_id=$1 GROUP BY r.room_type ORDER BY r.room_type`, [tid]);

    // Class distribution
    const classDist = await pool.query(`
      SELECT a.class, COUNT(*)::int AS students
      FROM hostel_allocations a WHERE a.tenant_id=$1 AND a.status='active' AND a.class IS NOT NULL
      GROUP BY a.class ORDER BY students DESC`, [tid]);

    // Maintenance stats
    const mStats = await pool.query(`
      SELECT status, COUNT(*)::int AS c FROM hostel_maintenance
      WHERE tenant_id=$1 GROUP BY status`, [tid]);

    let html = nav('Reports');
    html += '<h2>Occupancy Report</h2>';

    // Summary stats
    const totalRooms = bStats.rows.reduce((s, b) => s + b.total_rooms, 0);
    const totalBeds = bStats.rows.reduce((s, b) => s + b.total_beds, 0);
    const totalOcc = bStats.rows.reduce((s, b) => s + b.occupants, 0);
    const occRate = totalBeds > 0 ? ((totalOcc / totalBeds) * 100).toFixed(1) : 0;

    html += '<div class="stats">';
    html += `<div class="stat-card"><div class="stat-num">${bStats.rows.length}</div><div>Buildings</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${totalRooms}</div><div>Total Rooms</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${totalBeds}</div><div>Total Bed Spaces</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${totalOcc}</div><div>Occupied</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${occRate}%</div><div>Occupancy Rate</div></div>`;
    html += '</div>';

    // Building stats table
    html += '<div class="card"><h3>Building Overview</h3>';
    if (bStats.rows.length) {
      html += '<table><tr><th>Building</th><th>Type</th><th>Rooms</th><th>Beds</th><th>Occupied</th><th>Available</th><th>Occupancy %</th></tr>';
      bStats.rows.forEach(b => {
        const avail = Math.max(b.total_beds - b.occupants, 0);
        const pct = b.total_beds > 0 ? ((b.occupants / b.total_beds) * 100).toFixed(1) : 0;
        html += `<tr><td><a href="${ah('/buildings/' + b.id)}">${esc(b.name)}</a></td>
          <td>${esc(b.type)}</td><td>${b.total_rooms}</td><td>${b.total_beds}</td>
          <td>${b.occupants}</td><td>${avail}</td><td>${pct}%</td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No building data.</p>';
    }
    html += '</div>';

    // Room type breakdown
    html += '<div class="card"><h3>Room Type Breakdown</h3>';
    if (typeBreakdown.rows.length) {
      html += '<table><tr><th>Room Type</th><th>Rooms</th><th>Capacity</th><th>Occupied</th><th>Available</th></tr>';
      typeBreakdown.rows.forEach(r => {
        html += `<tr><td>${esc(r.room_type)}</td><td>${r.rooms}</td><td>${r.total_capacity}</td>` +
          `<td>${r.total_occupied}</td><td>${Math.max(r.total_capacity - r.total_occupied, 0)}</td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No room data.</p>';
    }
    html += '</div>';

    // Class distribution
    html += '<div class="card"><h3>Occupants by Class</h3>';
    if (classDist.rows.length) {
      html += '<table><tr><th>Class</th><th>Students</th></tr>';
      classDist.rows.forEach(c => {
        html += `<tr><td>${esc(c.class)}</td><td>${c.students}</td></tr>`;
      });
      html += '</table>';
    } else {
      html += '<p class="muted">No class distribution data.</p>';
    }
    html += '</div>';

    // Maintenance summary
    const maintMap = {};
    mStats.rows.forEach(r => { maintMap[r.status] = r.c; });
    html += '<div class="card"><h3>Maintenance Summary</h3>';
    html += '<table><tr><th>Status</th><th>Count</th></tr>';
    html += `<tr><td>Pending</td><td>${maintMap['pending'] || 0}</td></tr>`;
    html += `<tr><td>In Progress</td><td>${maintMap['in_progress'] || 0}</td></tr>`;
    html += `<tr><td>Resolved</td><td>${maintMap['resolved'] || 0}</td></tr>`;
    html += '</table></div>';

    renderPage('Hostel Reports', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 13 — Find available bed spaces
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/hostel/bed-spaces', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const typeFilter = req.query.type || '';

    let where = 'r.tenant_id=$1 AND r.capacity > r.current_occupants AND r.status != \'maintenance\'';
    const params = [tid];
    if (typeFilter) {
      where += ' AND b.type=$2';
      params.push(typeFilter);
    }

    const spaces = await pool.query(`
      SELECT r.id, r.room_number, r.floor, r.capacity, r.current_occupants,
             r.room_type, r.amenities,
             b.id AS building_id, b.name AS building_name, b.type AS building_type,
             (r.capacity - r.current_occupants) AS available_beds
      FROM hostel_rooms r
      JOIN hostel_buildings b ON b.id = r.building_id
      WHERE ${where}
      ORDER BY b.name, r.floor, r.room_number`, params);

    const totalAvail = spaces.rows.reduce((s, r) => s + r.available_beds, 0);

    let html = nav('Bed Spaces');
    html += '<h2>Available Bed Spaces</h2>';

    // Type filters
    html += '<div style="margin-bottom:16px;">';
    [['', 'All'], ['boys', 'Boys'], ['girls', 'Girls'], ['mixed', 'Mixed']].forEach(([val, label]) => {
      html += `<a href="${ah('/bed-spaces?type=' + val)}" class="btn btn-sm ${typeFilter === val ? 'btn-green' : ''}">${label}</a> `;
    });
    html += `<span class="muted" style="margin-left:12px;">${totalAvail} bed(s) available</span></div>`;

    if (spaces.rows.length) {
      html += '<table><tr><th>Building</th><th>Type</th><th>Room</th><th>Floor</th>' +
        '<th>Room Type</th><th>Occupancy</th><th>Available Beds</th><th>Amenities</th><th>Action</th></tr>';
      spaces.rows.forEach(r => {
        html += `<tr>
          <td><a href="${ah('/buildings/' + r.building_id)}">${esc(r.building_name)}</a></td>
          <td>${esc(r.building_type)}</td>
          <td><a href="${ah('/rooms/' + r.id)}">${esc(r.room_number)}</a></td>
          <td>${r.floor}</td>
          <td>${esc(r.room_type)}</td>
          <td>${r.current_occupants}/${r.capacity}</td>
          <td><strong>${r.available_beds}</strong></td>
          <td>${(r.amenities || []).join(', ') || '<span class="muted">—</span>'}</td>
          <td><a href="${ah('/rooms/' + r.id)}" class="btn btn-sm btn-blue">Allocate</a></td>
        </tr>`;
      });
      html += '</table>';
    } else {
      html += '<div class="card"><p class="muted">No available bed spaces found.</p></div>';
    }

    renderPage('Available Bed Spaces', html, req.session.user, req);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 14 — Delete building
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete('/hostel/buildings/:id', requireAuth, async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id } = req.params;

    // Check for active allocations
    const allocCheck = await pool.query(`
      SELECT COUNT(*)::int AS c FROM hostel_allocations a
      JOIN hostel_rooms r ON r.id = a.room_id
      WHERE r.building_id=$1 AND a.tenant_id=$2 AND a.status='active'`, [id, tid]);
    if (allocCheck.rows[0].c > 0) {
      return res.send(`<div class="alert">Cannot delete building with ${allocCheck.rows[0].c} active occupant(s). Deallocate all students first.</div>
        <a href="${ah('/buildings')}" class="btn btn-sm btn-blue">Back to Buildings</a>`);
    }

    const result = await pool.query(
      'DELETE FROM hostel_buildings WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (result.rowCount === 0) return res.status(404).send('Building not found.');

    res.redirect(ah('/buildings'));
  });

  // Also support POST with _method=DELETE for form-based deletion
  app.post('/hostel/buildings/:id/delete', requireAuth, async (req, res) => {
    req.method = 'DELETE';
    req.url = ah('/buildings/' + req.params.id);
    app._router.handle(req, res);
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  migrate().then(() => {
    console.log('[Hostel] Hostel management loaded');
  }).catch(err => {
    console.error('[Hostel] Migration failed:', err.message);
  });

};
