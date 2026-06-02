const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C='#6366f1'; const CL='#818cf8'; const CBG='#eef2ff'; const CG='#059669'; const CR='#dc2626'; const CY='#d97706';

  async function initTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS classroom_rooms (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_name VARCHAR(100), room_number VARCHAR(20), building VARCHAR(50), capacity INT DEFAULT 30, room_type TEXT DEFAULT 'classroom', floor INT DEFAULT 1, has_projector SMALLINT DEFAULT 0, has_ac SMALLINT DEFAULT 0, has_smart_board SMALLINT DEFAULT 0, has_computers SMALLINT DEFAULT 0, status TEXT DEFAULT 'available', current_class VARCHAR(100), notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_inventory (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, item_name VARCHAR(150), item_type TEXT DEFAULT 'other', brand VARCHAR(100), model VARCHAR(100), serial_number VARCHAR(100), purchase_date DATE, warranty_expiry DATE, status TEXT DEFAULT 'working', maintenance_notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_sensors (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, sensor_type TEXT DEFAULT 'temperature', sensor_name VARCHAR(100), min_threshold DECIMAL(8,2), max_threshold DECIMAL(8,2), unit VARCHAR(10), status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_sensor_readings (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, sensor_id INT, room_id INT, value DECIMAL(10,2), is_alert SMALLINT DEFAULT 0, recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_bookings (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, booked_by INT, purpose VARCHAR(200), booking_date DATE, start_time TIME, end_time TIME, status TEXT DEFAULT 'pending', attendees INT DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_maintenance (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, item_id INT, issue_type TEXT DEFAULT 'other', description TEXT, priority TEXT DEFAULT 'medium', reported_by INT, assigned_to INT, scheduled_date DATE, completed_date DATE, cost DECIMAL(10,2) DEFAULT 0, status TEXT DEFAULT 'reported', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_energy_logs (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, reading_type TEXT DEFAULT 'electricity', value DECIMAL(10,2), unit VARCHAR(10), cost DECIMAL(10,2), recorded_date DATE, recorded_by INT, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_signage (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, display_name VARCHAR(100), location VARCHAR(200), content_type TEXT DEFAULT 'announcement', content TEXT, is_active SMALLINT DEFAULT 1, priority INT DEFAULT 0, display_from TIMESTAMPTZ, display_until TIMESTAMPTZ, created_by INT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS classroom_lesson_recordings (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, room_id INT, subject VARCHAR(100), teacher_id INT, class_name VARCHAR(100), recording_url VARCHAR(500), duration_seconds INT DEFAULT 0, file_size_mb DECIMAL(8,2) DEFAULT 0, recorded_at TIMESTAMPTZ, status TEXT DEFAULT 'available', views INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const sql of tables) { try { await pool.query(sql); } catch(e) { console.warn('[SmartClassroom] Table:', e.message); } }
  }
  initTables();

  // ─── Dashboard ────────────────────────────────────────────────────
  app.get('/school/smart-classroom', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status="available" THEN 1 ELSE 0 END) as available, SUM(CASE WHEN status="occupied" THEN 1 ELSE 0 END) as occupied, SUM(CASE WHEN status="maintenance" THEN 1 ELSE 0 END) as maint FROM classroom_rooms WHERE tenant_id=?', [tid]);
    const [items] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN status="working" THEN 1 ELSE 0 END) as working, SUM(CASE WHEN status="faulty" THEN 1 ELSE 0 END) as faulty FROM classroom_inventory WHERE tenant_id=?', [tid]);
    const [alerts] = await pool.query('SELECT COUNT(*) as c FROM classroom_sensor_readings WHERE tenant_id=? AND is_alert=1 AND recorded_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)', [tid]);
    const [bookings] = await pool.query('SELECT COUNT(*) as c FROM classroom_bookings WHERE tenant_id=? AND booking_date=CURDATE() AND status="approved"', [tid]);
    const [maintReq] = await pool.query('SELECT COUNT(*) as c FROM classroom_maintenance WHERE tenant_id=? AND status IN ("reported","in_progress")', [tid]);
    const [recentAlerts] = await pool.query('SELECT csr.*, cs.sensor_type, cr.room_name FROM classroom_sensor_readings csr JOIN classroom_sensors cs ON cs.id=csr.sensor_id JOIN classroom_rooms cr ON cr.id=csr.room_id WHERE csr.tenant_id=? AND csr.is_alert=1 ORDER BY csr.recorded_at DESC LIMIT 5', [tid]);
    res.send(renderPage('Smart Classroom', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🏫 Smart Classroom Dashboard</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:25px;">
        ${[{l:'Total Rooms',v:rooms[0].total,c:C},{l:'Available',v:rooms[0].available,c:CG},{l:'Occupied',v:rooms[0].occupied,c:CY},{l:'Equipment',v:items[0].total,c:'#7c3aed'},{l:'Faulty Items',v:items[0].faulty,c:CR},{l:'Active Alerts',v:alerts[0].c,c:'#f97316'},{l:'Today Bookings',v:bookings[0].c,c:'#0891b2'},{l:'Maint. Requests',v:maintReq[0].c,c:CR}].map(s=>`<div style="background:${CBG};border-radius:12px;padding:20px;text-align:center;"><div style="font-size:2em;font-weight:bold;color:${s.c};">${s.v||0}</div><div style="color:#6b7280;font-size:0.9em;">${s.l}</div></div>`).join('')}
      </div>
      ${recentAlerts.length?`<div style="background:#fef2f2;border-radius:12px;padding:15px;margin-bottom:20px;border:1px solid #fecaca;"><h3 style="color:${CR};margin:0 0 10px;">⚠️ Recent Sensor Alerts</h3>${recentAlerts.map(a=>`<div style="padding:5px 0;font-size:0.85em;color:#991b1b;">${esc(a.room_name)} — ${a.sensor_type}: ${a.value} ${a.is_alert?'(OUT OF RANGE)':''} — ${new Date(a.recorded_at).toLocaleString()}</div>`).join('')}</div>`:''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/school/smart-classroom/rooms" style="background:${C};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🏛️ Rooms</a>
        <a href="/school/smart-classroom/sensors" style="background:#7c3aed;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📡 Sensors</a>
        <a href="/school/smart-classroom/bookings" style="background:#0891b2;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📅 Bookings</a>
        <a href="/school/smart-classroom/maintenance" style="background:${CR};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🔧 Maintenance</a>
        <a href="/school/smart-classroom/energy" style="background:${CY};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">⚡ Energy</a>
        <a href="/school/smart-classroom/signage" style="background:#059669;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📺 Signage</a>
        <a href="/school/smart-classroom/recordings" style="background:#be185d;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🎬 Recordings</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Rooms ────────────────────────────────────────────────────────
  app.get('/school/smart-classroom/rooms', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT cr.*, (SELECT COUNT(*) FROM classroom_inventory WHERE room_id=cr.id AND tenant_id=cr.tenant_id) as items FROM classroom_rooms cr WHERE cr.tenant_id=? ORDER BY cr.room_number', [tid]);
    const sc = {available:CG,occupied:CY,maintenance:CR,reserved:'#8b5cf6'};
    res.send(renderPage('Rooms', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${C};">🏛️ Classroom Rooms</h2><a href="/school/smart-classroom/rooms/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Add Room</a></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px;">
        ${rooms.map(r=>`<div style="background:white;border-radius:12px;padding:15px;border-left:4px solid ${sc[r.status]||'#9ca3af'};">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><h3 style="margin:0;">${esc(r.room_name)} <span style="color:#9ca3af;font-weight:normal;">(${esc(r.room_number)})</span></h3><span style="background:${sc[r.status]}22;color:${sc[r.status]};padding:2px 8px;border-radius:12px;font-size:0.75em;">${r.status}</span></div>
          <div style="font-size:0.8em;color:#6b7280;display:flex;gap:8px;flex-wrap:wrap;">${r.building?'<span>🏢 '+esc(r.building)+'</span>':''}<span>👥 ${r.capacity}</span><span>📦 ${r.items} items</span>${r.has_projector?'<span>🖥️</span>':''}${r.has_ac?'<span>❄️</span>':''}${r.has_smart_board?'<span>📊</span>':''}</div>
          <div style="margin-top:8px;"><a href="/school/smart-classroom/rooms/${r.id}" style="color:${C};text-decoration:none;font-size:0.85em;">Manage →</a></div>
        </div>`).join('')||'<p style="color:#6b7280;">No rooms added yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/rooms/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Add Room', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🏛️ Add Classroom</h2>
      <form method="POST" action="/school/smart-classroom/rooms/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room Name</label><input name="room_name" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room Number</label><input name="room_number" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Building</label><input name="building" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Capacity</label><input type="number" name="capacity" value="30" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="room_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>classroom</option><option>lab</option><option>lecture_hall</option><option>library</option><option>hall</option></select></div>
        </div>
        <div style="display:flex;gap:20px;margin-bottom:15px;">
          ${['has_projector|Projector','has_ac|AC','has_smart_board|Smart Board','has_computers|Computers'].map(f=>{const[k,l]=f.split('|');return `<label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" name="${k}" value="1"> ${l}</label>`;}).join('')}
        </div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Room</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/rooms/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {room_name,room_number,building,capacity,room_type,has_projector,has_ac,has_smart_board,has_computers,notes,id} = req.body;
    if (id) {
      await pool.query('UPDATE classroom_rooms SET room_name=?,room_number=?,building=?,capacity=?,room_type=?,has_projector=?,has_ac=?,has_smart_board=?,has_computers=?,notes=? WHERE id=? AND tenant_id=?', [room_name,room_number,building,capacity,room_type,has_projector||0,has_ac||0,has_smart_board||0,has_computers||0,notes,id,tid]);
    } else {
      await pool.query('INSERT INTO classroom_rooms (tenant_id,room_name,room_number,building,capacity,room_type,has_projector,has_ac,has_smart_board,has_computers,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [tid,room_name,room_number,building,capacity,room_type,has_projector||0,has_ac||0,has_smart_board||0,has_computers||0,notes]);
    }
    res.redirect('/school/smart-classroom/rooms');
  }));

  app.get('/school/smart-classroom/rooms/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [room] = await pool.query('SELECT * FROM classroom_rooms WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!room[0]) return res.redirect('/school/smart-classroom/rooms');
    const [inventory] = await pool.query('SELECT * FROM classroom_inventory WHERE tenant_id=? AND room_id=? ORDER BY item_type', [tid, req.params.id]);
    const [sensors] = await pool.query('SELECT cs.*, (SELECT value FROM classroom_sensor_readings WHERE sensor_id=cs.id ORDER BY recorded_at DESC LIMIT 1) as latest_value FROM classroom_sensors cs WHERE cs.tenant_id=? AND cs.room_id=?', [tid, req.params.id]);
    const r = room[0];
    res.send(renderPage('Room Detail', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <a href="/school/smart-classroom/rooms" style="color:${C};text-decoration:none;">← Back</a>
      <div style="margin-top:15px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <div style="display:flex;justify-content:space-between;"><h2 style="color:${C};margin:0;">${esc(r.room_name)} (${esc(r.room_number)})</h2><span style="font-size:1.2em;">${r.status==='occupied'?'🔴':r.status==='available'?'🟢':'🟡'}</span></div>
        <div style="color:#6b7280;font-size:0.85em;margin-top:5px;">${r.building?'Building: '+esc(r.building)+' • ':''}Capacity: ${r.capacity} • Floor: ${r.floor||1} • ${r.room_type}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${C};margin:0 0 15px;">📦 Equipment (${inventory.length})</h3>
          ${inventory.map(i=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:0.85em;"><span>${esc(i.item_name)} (${esc(i.item_type)})</span><span style="color:${i.status==='working'?CG:CR};">${i.status}</span></div>`).join('')||'<p style="color:#9ca3af;">No equipment</p>'}
          <a href="/school/smart-classroom/inventory/new?room_id=${r.id}" style="color:${C};text-decoration:none;font-size:0.85em;display:inline-block;margin-top:10px;">+ Add Equipment</a>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${C};margin:0 0 15px;">📡 Sensors (${sensors.length})</h3>
          ${sensors.map(s=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:0.85em;"><span>${esc(s.sensor_name)} (${s.sensor_type})</span><span style="font-weight:bold;">${s.latest_value||'-'} ${s.unit||''}</span></div>`).join('')||'<p style="color:#9ca3af;">No sensors</p>'}
          <a href="/school/smart-classroom/sensors/new?room_id=${r.id}" style="color:#7c3aed;text-decoration:none;font-size:0.85em;display:inline-block;margin-top:10px;">+ Add Sensor</a>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Inventory ────────────────────────────────────────────────────
  app.get('/school/smart-classroom/inventory/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT id, room_name, room_number FROM classroom_rooms WHERE tenant_id=? ORDER BY room_name', [tid]);
    res.send(renderPage('Add Equipment', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📦 Add Equipment</h2>
      <form method="POST" action="/school/smart-classroom/inventory/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Item Name</label><input name="item_name" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="item_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>projector</option><option>ac</option><option>smart_board</option><option>computer</option><option>desk</option><option>chair</option><option>whiteboard</option><option>speaker</option><option>microphone</option><option>printer</option><option>other</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room</label><select name="room_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${rooms.map(r=>`<option value="${r.id}" ${String(r.id)===req.query.room_id?'selected':''}>${esc(r.room_name)} (${esc(r.room_number)})</option>`).join('')}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Brand</label><input name="brand" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Serial Number</label><input name="serial_number" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Equipment</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/inventory/save', requireAuth, ah(async (req, res) => {
    await pool.query('INSERT INTO classroom_inventory (tenant_id,room_id,item_name,item_type,brand,model,serial_number,purchase_date,warranty_expiry) VALUES (?,?,?,?,?,?,?,?,?,?)', [req.session.user.tenant_id,req.body.room_id,req.body.item_name,req.body.item_type,req.body.brand,req.body.model,req.body.serial_number,req.body.purchase_date,req.body.warranty_expiry]);
    res.redirect('/school/smart-classroom/rooms/'+req.body.room_id);
  }));

  // ─── Sensors ──────────────────────────────────────────────────────
  app.get('/school/smart-classroom/sensors', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [sensors] = await pool.query('SELECT cs.*, cr.room_name FROM classroom_sensors cs JOIN classroom_rooms cr ON cr.id=cs.room_id WHERE cs.tenant_id=? ORDER BY cr.room_name, cs.sensor_type', [tid]);
    const typeIcons = {temperature:'🌡️',humidity:'💧',co2:'💨',light:'☀️',noise:'🔊',occupancy:'👥'};
    res.send(renderPage('Sensors', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${C};">📡 IoT Sensors</h2><a href="/school/smart-classroom/sensors/new" style="background:#7c3aed;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Add Sensor</a></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:15px;">
        ${sensors.map(s=>`<div style="background:white;border-radius:12px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:1.3em;">${typeIcons[s.sensor_type]||'📡'}</span><strong>${esc(s.sensor_name)}</strong></div>
          <div style="color:#6b7280;font-size:0.8em;">${esc(s.room_name)} • ${s.sensor_type} • ${s.min_threshold}–${s.max_threshold} ${s.unit||''}</div>
          <div style="margin-top:5px;color:${s.status==='active'?CG:'#9ca3af'};font-size:0.8em;">${s.status}</div>
        </div>`).join('')||'<p style="color:#6b7280;">No sensors configured</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/sensors/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT id, room_name, room_number FROM classroom_rooms WHERE tenant_id=? ORDER BY room_name', [tid]);
    res.send(renderPage('Add Sensor', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📡 Add Sensor</h2>
      <form method="POST" action="/school/smart-classroom/sensors/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Sensor Name</label><input name="sensor_name" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room</label><select name="room_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${rooms.map(r=>`<option value="${r.id}" ${String(r.id)===req.query.room_id?'selected':''}>${esc(r.room_name)}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="sensor_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>temperature</option><option>humidity</option><option>co2</option><option>light</option><option>noise</option><option>occupancy</option></select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Min Threshold</label><input type="number" name="min_threshold" step="0.1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Max Threshold</label><input type="number" name="max_threshold" step="0.1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Unit</label><input name="unit" value="°C" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <button type="submit" style="background:#7c3aed;color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Sensor</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/sensors/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('INSERT INTO classroom_sensors (tenant_id,room_id,sensor_name,sensor_type,min_threshold,max_threshold,unit) VALUES (?,?,?,?,?,?,?)', [tid,req.body.room_id,req.body.sensor_name,req.body.sensor_type,req.body.min_threshold,req.body.max_threshold,req.body.unit]);
    res.redirect('/school/smart-classroom/sensors');
  }));

  // ─── Bookings ─────────────────────────────────────────────────────
  app.get('/school/smart-classroom/bookings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [bookings] = await pool.query('SELECT cb.*, cr.room_name FROM classroom_bookings cb JOIN classroom_rooms cr ON cr.id=cb.room_id WHERE cb.tenant_id=? ORDER BY cb.booking_date DESC, cb.start_time', [tid]);
    const sc = {pending:CY,approved:CG,rejected:CR,completed:'#3b82f6',cancelled:'#9ca3af'};
    res.send(renderPage('Room Bookings', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${C};">📅 Room Bookings</h2><a href="/school/smart-classroom/bookings/new" style="background:#0891b2;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Book Room</a></div>
      <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead><tr style="background:${CBG};"><th style="padding:12px;text-align:left;">Room</th><th>Purpose</th><th>Date</th><th>Time</th><th>Status</th></tr></thead>
        <tbody>${bookings.map(b=>`<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px;">${esc(b.room_name)}</td><td style="padding:10px;">${esc(b.purpose)}</td><td style="padding:10px;">${b.booking_date}</td><td style="padding:10px;">${b.start_time||''} - ${b.end_time||''}</td><td style="padding:10px;"><span style="color:${sc[b.status]};">${b.status}</span></td></tr>`).join('')}</tbody>
      </table>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/bookings/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT id, room_name, room_number FROM classroom_rooms WHERE tenant_id=? AND status="available" ORDER BY room_name', [tid]);
    res.send(renderPage('Book Room', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📅 Book a Room</h2>
      <form method="POST" action="/school/smart-classroom/bookings/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Room</label><select name="room_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${rooms.map(r=>`<option value="${r.id}">${esc(r.room_name)} (${esc(r.room_number)})</option>`).join('')}</select></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Purpose</label><input name="purpose" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Date</label><input type="date" name="booking_date" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Start</label><input type="time" name="start_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">End</label><input type="time" name="end_time" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <button type="submit" style="background:#0891b2;color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Submit Booking</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/bookings/save', requireAuth, ah(async (req, res) => {
    await pool.query('INSERT INTO classroom_bookings (tenant_id,room_id,booked_by,purpose,booking_date,start_time,end_time,attendees,status) VALUES (?,?,?,?,?,?,"approved",0)', [req.session.user.tenant_id,req.body.room_id,req.session.user.id,req.body.purpose,req.body.booking_date,req.body.start_time,req.body.end_time]);
    res.redirect('/school/smart-classroom/bookings');
  }));

  // ─── Maintenance ──────────────────────────────────────────────────
  app.get('/school/smart-classroom/maintenance', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [mreqs] = await pool.query('SELECT cm.*, cr.room_name FROM classroom_maintenance cm LEFT JOIN classroom_rooms cr ON cr.id=cm.room_id WHERE cm.tenant_id=? ORDER BY cm.created_at DESC', [tid]);
    const sc = {reported:CY,in_progress:'#3b82f6',completed:CG,cancelled:'#9ca3af'};
    const pc = {low:'#3b82f6',medium:CY,high:'#f97316',emergency:CR};
    res.send(renderPage('Maintenance', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><h2 style="color:${CR};">🔧 Maintenance Requests</h2><a href="/school/smart-classroom/maintenance/new" style="background:${CR};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Request</a></div>
      <div style="display:grid;gap:10px;">
        ${mreqs.map(m=>`<div style="background:white;border-radius:10px;padding:12px;border-left:4px solid ${pc[m.priority]||CY};display:flex;justify-content:space-between;align-items:center;">
          <div><strong>${esc(m.description||m.issue_type)}</strong><div style="color:#6b7280;font-size:0.8em;">${esc(m.room_name||'No room')} • ${m.issue_type} • ${m.priority} priority</div></div>
          <span style="color:${sc[m.status]};padding:4px 10px;border-radius:12px;font-size:0.8em;background:${sc[m.status]}22;">${m.status}</span>
        </div>`).join('')||'<p style="color:#6b7280;">No maintenance requests</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/maintenance/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT id, room_name FROM classroom_rooms WHERE tenant_id=? ORDER BY room_name', [tid]);
    res.send(renderPage('New Request', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${CR};margin-bottom:20px;">🔧 New Maintenance Request</h2>
      <form method="POST" action="/school/smart-classroom/maintenance/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room</label><select name="room_id" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="">General</option>${rooms.map(r=>`<option value="${r.id}">${esc(r.room_name)}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Priority</label><select name="priority" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>low</option><option selected>medium</option><option>high</option><option>emergency</option></select></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Issue Type</label><select name="issue_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>electrical</option><option>plumbing</option><option>furniture</option><option>hvac</option><option>cleaning</option><option>other</option></select></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <button type="submit" style="background:${CR};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Submit Request</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/maintenance/save', requireAuth, ah(async (req, res) => {
    await pool.query('INSERT INTO classroom_maintenance (tenant_id,room_id,issue_type,description,priority,reported_by) VALUES (?,?,?,?,?,?)', [req.session.user.tenant_id,req.body.room_id||null,req.body.issue_type,req.body.description,req.body.priority,req.session.user.id]);
    res.redirect('/school/smart-classroom/maintenance');
  }));

  // ─── Energy ───────────────────────────────────────────────────────
  app.get('/school/smart-classroom/energy', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [logs] = await pool.query('SELECT cel.*, cr.room_name FROM classroom_energy_logs cel JOIN classroom_rooms cr ON cr.id=cel.room_id WHERE cel.tenant_id=? ORDER BY cel.recorded_date DESC LIMIT 50', [tid]);
    const [summary] = await pool.query('SELECT reading_type, SUM(value) as total, SUM(cost) as total_cost FROM classroom_energy_logs WHERE tenant_id=? AND recorded_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY reading_type', [tid]);
    const typeIcons = {electricity:'⚡',water:'💧',gas:'🔥'};
    res.send(renderPage('Energy Monitoring', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">⚡ Energy Monitoring</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin-bottom:20px;">
        ${summary.map(s=>`<div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:1.5em;">${typeIcons[s.reading_type]||'📊'}</div><div style="font-size:1.5em;font-weight:bold;color:${C};">${s.total?.toFixed(1)||0}</div><div style="color:#6b7280;font-size:0.9em;">${s.reading_type} (30d)</div><div style="color:${CY};font-weight:600;">Cost: $${s.total_cost?.toFixed(2)||0}</div></div>`).join('')}
      </div>
      <a href="/school/smart-classroom/energy/log" style="background:${CY};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Log Reading</a>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/energy/log', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rooms] = await pool.query('SELECT id, room_name FROM classroom_rooms WHERE tenant_id=? ORDER BY room_name', [tid]);
    res.send(renderPage('Log Reading', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${CY};margin-bottom:20px;">⚡ Log Energy Reading</h2>
      <form method="POST" action="/school/smart-classroom/energy/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Room</label><select name="room_id" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${rooms.map(r=>`<option value="${r.id}">${esc(r.room_name)}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="reading_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>electricity</option><option>water</option><option>gas</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Date</label><input type="date" name="recorded_date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Value</label><input type="number" step="0.1" name="value" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Unit</label><input name="unit" value="kWh" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Cost ($)</label><input type="number" step="0.01" name="cost" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <button type="submit" style="background:${CY};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Log Reading</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/smart-classroom/energy/save', requireAuth, ah(async (req, res) => {
    await pool.query('INSERT INTO classroom_energy_logs (tenant_id,room_id,reading_type,value,unit,cost,recorded_date,recorded_by) VALUES (?,?,?,?,?,?,?,?)', [req.session.user.tenant_id,req.body.room_id,req.body.reading_type,req.body.value,req.body.unit,req.body.cost,req.body.recorded_date,req.session.user.id]);
    res.redirect('/school/smart-classroom/energy');
  }));

  // ─── Signage & Recordings (minimal pages) ────────────────────────
  app.get('/school/smart-classroom/signage', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Digital Signage', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📺 Digital Signage</h2>
      <p style="color:#6b7280;">Manage digital display screens across campus. Schedule announcements, schedules, and achievements to show on hallway and classroom displays.</p>
      <div style="margin-top:15px;"><a href="/school/smart-classroom/signage/new" style="background:${CG};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Display Content</a></div>
    </div>`, req.session.user));
  }));

  app.get('/school/smart-classroom/recordings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [recordings] = await pool.query('SELECT clr.*, cr.room_name FROM classroom_lesson_recordings clr JOIN classroom_rooms cr ON cr.id=clr.room_id WHERE clr.tenant_id=? ORDER BY clr.recorded_at DESC LIMIT 20', [tid]);
    res.send(renderPage('Lesson Recordings', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:#be185d;margin-bottom:20px;">🎬 Lesson Recordings</h2>
      <div style="display:grid;gap:10px;">
        ${recordings.map(r=>`<div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;">
          <div><strong>${esc(r.subject)}</strong> — ${esc(r.class_name)}<div style="color:#6b7280;font-size:0.8em;">${esc(r.room_name)} • ${r.duration_seconds?Math.round(r.duration_seconds/60)+'min':''} • ${r.recorded_at?new Date(r.recorded_at).toLocaleDateString():''}</div></div>
          <span style="color:${r.status==='available'?CG:'#9ca3af'};">${r.status} • 👁 ${r.views}</span>
        </div>`).join('')||'<p style="color:#6b7280;">No recordings yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  console.log('[SmartClassroom] Module loaded — rooms, inventory, sensors, bookings, energy, signage, recordings');
};
