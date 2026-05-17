module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS restroom_locations (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, building VARCHAR(120) NOT NULL,
        floor VARCHAR(60) NOT NULL DEFAULT 'Ground', type VARCHAR(40) NOT NULL DEFAULT 'Standard',
        max_occupancy INT NOT NULL DEFAULT 4, status VARCHAR(20) NOT NULL DEFAULT 'active',
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS restroom_status (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location_id INT REFERENCES restroom_locations(id),
        current_occupancy INT NOT NULL DEFAULT 0, soap_level INT NOT NULL DEFAULT 100,
        paper_level INT NOT NULL DEFAULT 100, cleanliness_score NUMERIC(3,1) NOT NULL DEFAULT 5.0,
        last_cleaned TIMESTAMPTZ, last_checked TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS restroom_maintenance (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location_id INT REFERENCES restroom_locations(id),
        issue_type VARCHAR(80) NOT NULL, description TEXT, priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        status VARCHAR(20) NOT NULL DEFAULT 'open', reported_by VARCHAR(120),
        reported_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ, resolved_by VARCHAR(120)
      )`);
      console.log('[Mod] smart-restroom OK');
    } catch(e) { console.warn('[Mod] smart-restroom Warn:', e.message); }
  })();

  /* ─── Helpers ─────────────────────────────────────────────── */
  const getBar = (pct, color) => {
    const c = pct > 60 ? '#22c55e' : pct > 30 ? '#f59e0b' : '#ef4444';
    const cl = color || c;
    return `<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%"><div style="background:${cl};height:10px;border-radius:6px;width:${Math.min(pct,100)}%"></div></div>`;
  };
  const statusBadge = (s) => {
    const colors = { open: '#ef4444', 'in-progress': '#f59e0b', resolved: '#22c55e', closed: '#6b7280' };
    return `<span style="background:${colors[s]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(s)}</span>`;
  };
  const priorityBadge = (p) => {
    const colors = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626' };
    return `<span style="background:${colors[p]||'#6b7280'};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px">${esc(p)}</span>`;
  };
  const scoreBadge = (s) => {
    const v = parseFloat(s) || 0;
    const c = v >= 4 ? '#22c55e' : v >= 2.5 ? '#f59e0b' : '#ef4444';
    return `<span style="color:${c};font-weight:700;font-size:18px">${v.toFixed(1)}</span>`;
  };

  /* ─── Route 1: Dashboard ──────────────────────────────────── */
  app.get('/school/smart-restroom', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [locs, stats, openTickets, recent] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM restroom_locations WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT AVG(cleanliness_score) AS avg_score, AVG(soap_level) AS avg_soap, AVG(paper_level) AS avg_paper, SUM(current_occupancy) AS total_occ FROM restroom_status rs JOIN restroom_locations rl ON rs.location_id=rl.id WHERE rl.tenant_id=$1`, [tid]),
        pool.query(`SELECT COUNT(*) AS cnt FROM restroom_maintenance WHERE tenant_id=$1 AND status IN ('open','in-progress')`, [tid]),
        pool.query(`SELECT rm.*, rl.building, rl.floor, rl.type FROM restroom_maintenance rm JOIN restroom_locations rl ON rm.location_id=rl.id WHERE rl.tenant_id=$1 ORDER BY rm.reported_at DESC LIMIT 5`, [tid])
      ]);
      const locsCount = parseInt(locs.rows[0]?.total) || 0;
      const st = stats.rows[0] || {};
      const openCount = parseInt(openTickets.rows[0]?.cnt) || 0;
      let locationsHTML = '';
      const locList = await pool.query(`SELECT rl.*, rs.current_occupancy, rs.soap_level, rs.paper_level, rs.cleanliness_score, rs.last_cleaned FROM restroom_locations rl LEFT JOIN restroom_status rs ON rs.location_id=rl.id WHERE rl.tenant_id=$1 ORDER BY rl.building, rl.floor`, [tid]);
      for (const loc of locList.rows) {
        const occ = loc.current_occupancy || 0;
        const maxO = loc.max_occupancy || 1;
        const occPct = Math.round((occ / maxO) * 100);
        locationsHTML += `<tr>
          <td>${esc(loc.building)}</td><td>${esc(loc.floor)}</td><td>${esc(loc.type)}</td>
          <td><div style="display:flex;align-items:center;gap:6px">${occ}/${maxO} ${getBar(occPct)}</div></td>
          <td>${getBar(loc.soap_level||0)} <small>${loc.soap_level||0}%</small></td>
          <td>${getBar(loc.paper_level||0)} <small>${loc.paper_level||0}%</small></td>
          <td>${scoreBadge(loc.cleanliness_score)}</td>
          <td>${loc.last_cleaned ? new Date(loc.last_cleaned).toLocaleDateString() : '<em style="color:${GRAY}">Never</em>'}</td>
        </tr>`;
      }
      let ticketsHTML = '';
      for (const t of recent.rows) {
        ticketsHTML += `<tr><td>${esc(t.building)} ${esc(t.floor)}</td><td>${esc(t.issue_type)}</td>
          <td>${priorityBadge(t.priority)}</td><td>${statusBadge(t.status)}</td>
          <td>${new Date(t.reported_at).toLocaleDateString()}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:28px;font-weight:700;color:${P}">${locsCount}</div><div style="color:${GRAY}">Restroom Locations</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#22c55e">${scoreBadge(st.avg_score||0)}</div><div style="color:${GRAY}">Avg Cleanliness</div></div>
        <div><div style="font-size:28px;font-weight:700;color:#f59e0b">${openCount}</div><div style="color:${GRAY}">Open Tickets</div></div>
        <div><div style="font-size:28px;font-weight:700;color:${P}">${st.total_occ||0}</div><div style="color:${GRAY}">Current Occupancy</div></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Restroom Locations</h3>
          <a href="/school/smart-restroom/locations" class="btn" style="text-decoration:none;font-size:13px">Manage Locations</a>
        </div>
        <div style="overflow-x:auto"><table><thead><tr><th>Building</th><th>Floor</th><th>Type</th><th>Occupancy</th><th>Soap</th><th>Paper</th><th>Cleanliness</th><th>Last Cleaned</th></tr></thead>
        <tbody>${locationsHTML}</tbody></table></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">Recent Maintenance</h3>
          <a href="/school/smart-restroom/maintenance" class="btn" style="text-decoration:none;font-size:13px">All Tickets</a>
        </div>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Issue</th><th>Priority</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${ticketsHTML}</tbody></table></div>
      </div>`;
      renderPage(req, res, 'Smart Restroom Monitor', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 2: Manage Locations ───────────────────────────── */
  app.get('/school/smart-restroom/locations', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const rows = await pool.query(`SELECT * FROM restroom_locations WHERE tenant_id=$1 ORDER BY building, floor`, [tid]);
      let list = '';
      for (const r of rows.rows) {
        list += `<tr><td>${r.id}</td><td>${esc(r.building)}</td><td>${esc(r.floor)}</td><td>${esc(r.type)}</td>
          <td>${r.max_occupancy}</td><td><span style="color:${r.status==='active'?'#22c55e':'#ef4444'}">${esc(r.status)}</span></td>
          <td><a href="/school/smart-restroom/locations/edit/${r.id}" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>
          <form method="POST" action="/school/smart-restroom/locations/delete" style="display:inline">
            <input type="hidden" name="id" value="${r.id}">
            <button class="btn" style="background:#ef4444;font-size:12px;padding:4px 10px" onclick="return confirm('Delete this location?')">Delete</button>
          </form></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Restroom Locations</h3>
        <a href="/school/smart-restroom/locations/add" class="btn" style="text-decoration:none">+ Add Location</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Building</th><th>Floor</th><th>Type</th><th>Max Occupancy</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none">← Back to Dashboard</a>`;
      renderPage(req, res, 'Restroom Locations', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 3: Add Location Form ──────────────────────────── */
  app.get('/school/smart-restroom/locations/add', requireAuth, requireNotBanned, (req, res) => {
    const html = `${SKIP}
    <div class="card"><h3>Add Restroom Location</h3>
      <form method="POST" action="/school/smart-restroom/locations/add" style="display:grid;gap:12px;max-width:500px">
        <label>Building <input name="building" required></label>
        <label>Floor <input name="floor" value="Ground" required></label>
        <label>Type <select name="type"><option>Standard</option><option>Accessible</option><option>Staff Only</option><option>Gender Neutral</option></select></label>
        <label>Max Occupancy <input type="number" name="max_occupancy" value="4" min="1" required></label>
        <label>Notes <textarea name="notes" rows="3"></textarea></label>
        <button type="submit" class="btn">Add Location</button>
        <a href="/school/smart-restroom/locations" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
      </form>
    </div>`;
    renderPage(req, res, 'Add Restroom Location', html, { activeTab: 'smart-restroom' });
  });

  app.post('/school/smart-restroom/locations/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { building, floor, type, max_occupancy, notes } = req.body;
      const tid = req.user.tenant_id;
      const result = await pool.query(`INSERT INTO restroom_locations (tenant_id,building,floor,type,max_occupancy,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [tid, building, floor, type, parseInt(max_occupancy)||4, notes]);
      const locId = result.rows[0].id;
      await pool.query(`INSERT INTO restroom_status (tenant_id,location_id) VALUES ($1,$2)`, [tid, locId]);
      audit(req, 'restroom_location_add', { building, floor, type });
      req.flash('success', 'Location added successfully');
      res.redirect('/school/smart-restroom/locations');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 4: Edit Location ──────────────────────────────── */
  app.get('/school/smart-restroom/locations/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const loc = await pool.query(`SELECT * FROM restroom_locations WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!loc.rows.length) return res.redirect('/school/smart-restroom/locations');
      const l = loc.rows[0];
      const html = `${SKIP}
      <div class="card"><h3>Edit Restroom Location</h3>
        <form method="POST" action="/school/smart-restroom/locations/edit/${l.id}" style="display:grid;gap:12px;max-width:500px">
          <label>Building <input name="building" value="${esc(l.building)}" required></label>
          <label>Floor <input name="floor" value="${esc(l.floor)}" required></label>
          <label>Type <select name="type"><option ${l.type==='Standard'?'selected':''}>Standard</option><option ${l.type==='Accessible'?'selected':''}>Accessible</option><option ${l.type==='Staff Only'?'selected':''}>Staff Only</option><option ${l.type==='Gender Neutral'?'selected':''}>Gender Neutral</option></select></label>
          <label>Max Occupancy <input type="number" name="max_occupancy" value="${l.max_occupancy}" min="1" required></label>
          <label>Status <select name="status"><option ${l.status==='active'?'selected':''} value="active">Active</option><option ${l.status==='inactive'?'selected':''} value="inactive">Inactive</option><option ${l.status==='maintenance'?'selected':''} value="maintenance">Under Maintenance</option></select></label>
          <label>Notes <textarea name="notes" rows="3">${esc(l.notes||'')}</textarea></label>
          <button type="submit" class="btn">Update Location</button>
          <a href="/school/smart-restroom/locations" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Edit Location', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/locations/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { building, floor, type, max_occupancy, status, notes } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_locations SET building=$1,floor=$2,type=$3,max_occupancy=$4,status=$5,notes=$6 WHERE id=$7 AND tenant_id=$8`, [building, floor, type, parseInt(max_occupancy)||4, status, notes, req.params.id, tid]);
      audit(req, 'restroom_location_edit', { id: req.params.id, building, floor });
      req.flash('success', 'Location updated');
      res.redirect('/school/smart-restroom/locations');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 5: Delete Location ────────────────────────────── */
  app.post('/school/smart-restroom/locations/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`DELETE FROM restroom_status WHERE location_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM restroom_maintenance WHERE location_id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      await pool.query(`DELETE FROM restroom_locations WHERE id=$1 AND tenant_id=$2`, [req.body.id, tid]);
      audit(req, 'restroom_location_delete', { id: req.body.id });
      req.flash('success', 'Location deleted');
      res.redirect('/school/smart-restroom/locations');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 6: Update Status ──────────────────────────────── */
  app.get('/school/smart-restroom/status/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const loc = await pool.query(`SELECT rl.*, rs.* FROM restroom_locations rl JOIN restroom_status rs ON rs.location_id=rl.id WHERE rl.id=$1 AND rl.tenant_id=$2`, [req.params.id, tid]);
      if (!loc.rows.length) return res.redirect('/school/smart-restroom');
      const s = loc.rows[0];
      const html = `${SKIP}
      <div class="card"><h3>Update Status — ${esc(s.building)} ${esc(s.floor)}</h3>
        <form method="POST" action="/school/smart-restroom/status/${s.id}" style="display:grid;gap:12px;max-width:500px">
          <label>Current Occupancy <input type="number" name="current_occupancy" value="${s.current_occupancy}" min="0" max="${s.max_occupancy}"></label>
          <label>Soap Level (%) <input type="range" name="soap_level" min="0" max="100" value="${s.soap_level}" oninput="this.nextElementSibling.textContent=this.value+'%'"><span>${s.soap_level}%</span></label>
          <label>Paper Level (%) <input type="range" name="paper_level" min="0" max="100" value="${s.paper_level}" oninput="this.nextElementSibling.textContent=this.value+'%'"><span>${s.paper_level}%</span></label>
          <label>Cleanliness Score (0-5) <input type="number" name="cleanliness_score" value="${s.cleanliness_score}" min="0" max="5" step="0.1"></label>
          <label>Last Cleaned <input type="datetime-local" name="last_cleaned" value="${s.last_cleaned ? new Date(s.last_cleaned).toISOString().slice(0,16) : ''}"></label>
          <button type="submit" class="btn">Update Status</button>
          <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Update Restroom Status', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/status/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { current_occupancy, soap_level, paper_level, cleanliness_score, last_cleaned } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_status SET current_occupancy=$1,soap_level=$2,paper_level=$3,cleanliness_score=$4,last_cleaned=$5,last_checked=NOW(),updated_at=NOW() WHERE location_id=$6 AND tenant_id=$7`, [parseInt(current_occupancy)||0, parseInt(soap_level)||0, parseInt(paper_level)||0, parseFloat(cleanliness_score)||0, last_cleaned||null, req.params.id, tid]);
      const soapVal = parseInt(soap_level)||0;
      const paperVal = parseInt(paper_level)||0;
      if (soapVal < 20 || paperVal < 20) {
        queueEmail(tid, { subject: 'Low Supply Alert: ' + req.params.id, body: `Soap: ${soapVal}%, Paper: ${paperVal}% — restocking needed urgently.` });
      }
      audit(req, 'restroom_status_update', { id: req.params.id, soap_level, paper_level });
      req.flash('success', 'Status updated');
      res.redirect('/school/smart-restroom');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 7: Maintenance Tickets ────────────────────────── */
  app.get('/school/smart-restroom/maintenance', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const statusFilter = req.query.status || 'all';
      let where = 'WHERE rm.tenant_id=$1';
      const params = [tid];
      if (statusFilter !== 'all') { where += ' AND rm.status=$2'; params.push(statusFilter); }
      const tickets = await pool.query(`SELECT rm.*, rl.building, rl.floor, rl.type FROM restroom_maintenance rm JOIN restroom_locations rl ON rm.location_id=rl.id ${where} ORDER BY rm.reported_at DESC`, params);
      let list = '';
      for (const t of tickets.rows) {
        list += `<tr><td>${t.id}</td><td>${esc(t.building)} ${esc(t.floor)} (${esc(t.type)})</td>
          <td>${esc(t.issue_type)}</td><td>${esc((t.description||'').slice(0,60))}</td>
          <td>${priorityBadge(t.priority)}</td><td>${statusBadge(t.status)}</td>
          <td>${esc(t.reported_by||'System')}</td><td>${new Date(t.reported_at).toLocaleDateString()}</td>
          <td>${t.status!=='resolved'&&t.status!=='closed'?`<a href="/school/smart-restroom/maintenance/resolve/${t.id}" class="btn" style="font-size:11px;padding:3px 8px;background:#22c55e">Resolve</a>
          <a href="/school/smart-restroom/maintenance/edit/${t.id}" class="btn" style="font-size:11px;padding:3px 8px">Edit</a>`:'<em style="color:'+GRAY+'">Done</em>'}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Maintenance Tickets</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <a href="/school/smart-restroom/maintenance/add" class="btn" style="text-decoration:none">+ New Ticket</a>
          <select onchange="location.href='/school/smart-restroom/maintenance?status='+this.value" style="width:auto;padding:6px 10px">
            <option value="all" ${statusFilter==='all'?'selected':''}>All</option>
            <option value="open" ${statusFilter==='open'?'selected':''}>Open</option>
            <option value="in-progress" ${statusFilter==='in-progress'?'selected':''}>In Progress</option>
            <option value="resolved" ${statusFilter==='resolved'?'selected':''}>Resolved</option>
          </select>
        </div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>ID</th><th>Location</th><th>Issue</th><th>Description</th><th>Priority</th><th>Status</th><th>Reported By</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${list}</tbody></table></div></div>
      <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Restroom Maintenance', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 8: Add Maintenance Ticket ─────────────────────── */
  app.get('/school/smart-restroom/maintenance/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const locs = await pool.query(`SELECT id, building, floor, type FROM restroom_locations WHERE tenant_id=$1 AND status='active' ORDER BY building`, [tid]);
      let optHTML = '';
      for (const l of locs.rows) optHTML += `<option value="${l.id}">${esc(l.building)} — ${esc(l.floor)} (${esc(l.type)})</option>`;
      const html = `${SKIP}
      <div class="card"><h3>Report Maintenance Issue</h3>
        <form method="POST" action="/school/smart-restroom/maintenance/add" style="display:grid;gap:12px;max-width:550px">
          <label>Location <select name="location_id" required><option value="">Select...</option>${optHTML}</select></label>
          <label>Issue Type <select name="issue_type" required><option>Plumbing</option><option>Electrical</option><option>Cleaning</option><option>Supply Restock</option><option>Fixture Damage</option><option>Ventilation</option><option>Other</option></select></label>
          <label>Description <textarea name="description" rows="4" required></textarea></label>
          <label>Priority <select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
          <label>Reported By <input name="reported_by" value="${esc(req.user.name||req.user.email)}"></label>
          <button type="submit" class="btn">Submit Ticket</button>
          <a href="/school/smart-restroom/maintenance" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Report Maintenance Issue', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/maintenance/add', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { location_id, issue_type, description, priority, reported_by } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`INSERT INTO restroom_maintenance (tenant_id,location_id,issue_type,description,priority,reported_by) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, parseInt(location_id), issue_type, description, priority, reported_by]);
      if (priority === 'critical' || priority === 'high') {
        queueEmail(tid, { subject: 'URGENT: Restroom Maintenance — ' + issue_type, body: `Priority ${priority} issue reported at location ${location_id}: ${description}` });
      }
      audit(req, 'restroom_maintenance_add', { location_id, issue_type, priority });
      req.flash('success', 'Ticket submitted');
      res.redirect('/school/smart-restroom/maintenance');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Edit Maintenance Ticket ─────────────────────────────── */
  app.get('/school/smart-restroom/maintenance/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const t = await pool.query(`SELECT * FROM restroom_maintenance WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      if (!t.rows.length) return res.redirect('/school/smart-restroom/maintenance');
      const m = t.rows[0];
      const html = `${SKIP}
      <div class="card"><h3>Edit Ticket #${m.id}</h3>
        <form method="POST" action="/school/smart-restroom/maintenance/edit/${m.id}" style="display:grid;gap:12px;max-width:550px">
          <label>Issue Type <select name="issue_type"><option ${m.issue_type==='Plumbing'?'selected':''}>Plumbing</option><option ${m.issue_type==='Electrical'?'selected':''}>Electrical</option><option ${m.issue_type==='Cleaning'?'selected':''}>Cleaning</option><option ${m.issue_type==='Supply Restock'?'selected':''}>Supply Restock</option><option ${m.issue_type==='Fixture Damage'?'selected':''}>Fixture Damage</option><option ${m.issue_type==='Ventilation'?'selected':''}>Ventilation</option><option ${m.issue_type==='Other'?'selected':''}>Other</option></select></label>
          <label>Description <textarea name="description" rows="4">${esc(m.description||'')}</textarea></label>
          <label>Priority <select name="priority"><option value="low" ${m.priority==='low'?'selected':''}>Low</option><option value="medium" ${m.priority==='medium'?'selected':''}>Medium</option><option value="high" ${m.priority==='high'?'selected':''}>High</option><option value="critical" ${m.priority==='critical'?'selected':''}>Critical</option></select></label>
          <label>Status <select name="status"><option value="open" ${m.status==='open'?'selected':''}>Open</option><option value="in-progress" ${m.status==='in-progress'?'selected':''}>In Progress</option><option value="resolved" ${m.status==='resolved'?'selected':''}>Resolved</option><option value="closed" ${m.status==='closed'?'selected':''}>Closed</option></select></label>
          <button type="submit" class="btn">Update Ticket</button>
          <a href="/school/smart-restroom/maintenance" class="btn" style="background:${GRAY};text-decoration:none;text-align:center">Cancel</a>
        </form>
      </div>`;
      renderPage(req, res, 'Edit Ticket', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/maintenance/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { issue_type, description, priority, status } = req.body;
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_maintenance SET issue_type=$1,description=$2,priority=$3,status=$4 WHERE id=$5 AND tenant_id=$6`, [issue_type, description, priority, status, req.params.id, tid]);
      if (status === 'resolved') await pool.query(`UPDATE restroom_maintenance SET resolved_at=NOW(),resolved_by=$1 WHERE id=$2 AND tenant_id=$3`, [req.user.name||req.user.email, req.params.id, tid]);
      audit(req, 'restroom_maintenance_edit', { id: req.params.id, status });
      req.flash('success', 'Ticket updated');
      res.redirect('/school/smart-restroom/maintenance');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Resolve Ticket ──────────────────────────────────────── */
  app.get('/school/smart-restroom/maintenance/resolve/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_maintenance SET status='resolved',resolved_at=NOW(),resolved_by=$1 WHERE id=$2 AND tenant_id=$3`, [req.user.name||req.user.email, req.params.id, tid]);
      audit(req, 'restroom_maintenance_resolve', { id: req.params.id });
      req.flash('success', 'Ticket resolved');
      res.redirect('/school/smart-restroom/maintenance');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 9: Analytics ──────────────────────────────────── */
  app.get('/school/smart-restroom/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const period = req.query.period || '7d';
      const days = period === '30d' ? 30 : period === '90d' ? 90 : 7;
      const locStats = await pool.query(`
        SELECT rl.building, rl.floor, rl.type,
          AVG(rs.cleanliness_score) AS avg_clean,
          AVG(rs.soap_level) AS avg_soap,
          AVG(rs.paper_level) AS avg_paper,
          MAX(rs.current_occupancy) AS peak_occ
        FROM restroom_locations rl
        JOIN restroom_status rs ON rs.location_id=rl.id
        WHERE rl.tenant_id=$1
        GROUP BY rl.id, rl.building, rl.floor, rl.type
        ORDER BY avg_clean ASC`, [tid]);
      const ticketStats = await pool.query(`
        SELECT issue_type, COUNT(*) AS cnt,
          COUNT(CASE WHEN status='resolved' THEN 1 END) AS resolved_cnt
        FROM restroom_maintenance WHERE tenant_id=$1
        AND reported_at > NOW() - INTERVAL '${days} days'
        GROUP BY issue_type ORDER BY cnt DESC`, [tid]);
      const avgResolve = await pool.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - reported_at))/3600) AS avg_hours
        FROM restroom_maintenance WHERE tenant_id=$1 AND status='resolved' AND resolved_at IS NOT NULL`, [tid]);
      const supplyAlerts = await pool.query(`
        SELECT rl.building, rl.floor, rs.soap_level, rs.paper_level
        FROM restroom_locations rl JOIN restroom_status rs ON rs.location_id=rl.id
        WHERE rl.tenant_id=$1 AND (rs.soap_level < 30 OR rs.paper_level < 30)`, [tid]);
      let locHTML = '';
      for (const r of locStats.rows) {
        const clean = parseFloat(r.avg_clean)||0;
        locHTML += `<tr><td>${esc(r.building)} ${esc(r.floor)}</td><td>${esc(r.type)}</td>
          <td>${scoreBadge(clean)}</td><td>${Math.round(r.avg_soap||0)}%</td><td>${Math.round(r.avg_paper||0)}%</td>
          <td>${r.peak_occ||0}</td></tr>`;
      }
      let ticketHTML = '';
      for (const t of ticketStats.rows) {
        const pct = t.cnt > 0 ? Math.round((t.resolved_cnt/t.cnt)*100) : 0;
        ticketHTML += `<tr><td>${esc(t.issue_type)}</td><td>${t.cnt}</td><td>${t.resolved_cnt}</td><td>${getBar(pct)} ${pct}%</td></tr>`;
      }
      let alertHTML = '';
      for (const a of supplyAlerts.rows) {
        const items = [];
        if (a.soap_level < 30) items.push(`Soap: ${a.soap_level}%`);
        if (a.paper_level < 30) items.push(`Paper: ${a.paper_level}%`);
        alertHTML += `<tr><td>${esc(a.building)} ${esc(a.floor)}</td><td style="color:#ef4444">${items.join(', ')}</td></tr>`;
      }
      if (!alertHTML) alertHTML = '<tr><td colspan="2" style="text-align:center;color:#22c55e">All supplies above 30% — no alerts</td></tr>';
      const avgH = avgResolve.rows[0]?.avg_hours ? parseFloat(avgResolve.rows[0].avg_hours).toFixed(1) : 'N/A';
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">Restroom Analytics</h3>
        <div style="display:flex;gap:6px">
          <a href="/school/smart-restroom/analytics?period=7d" class="btn" style="font-size:12px;padding:4px 10px;${period==='7d'?'background:#3730a3':''}">7 Days</a>
          <a href="/school/smart-restroom/analytics?period=30d" class="btn" style="font-size:12px;padding:4px 10px;${period==='30d'?'background:#3730a3':''}">30 Days</a>
          <a href="/school/smart-restroom/analytics?period=90d" class="btn" style="font-size:12px;padding:4px 10px;${period==='90d'?'background:#3730a3':''}">90 Days</a>
        </div>
      </div>
      <div class="card" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center">
        <div><div style="font-size:24px;font-weight:700;color:${P}">${locStats.rows.length}</div><div style="color:${GRAY}">Locations Tracked</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#22c55e">${avgH}h</div><div style="color:${GRAY}">Avg Resolution Time</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#ef4444">${supplyAlerts.rows.length}</div><div style="color:${GRAY}">Low Supply Alerts</div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Location Rankings (worst cleanliness first)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Type</th><th>Avg Clean</th><th>Soap</th><th>Paper</th><th>Peak Occupancy</th></tr></thead><tbody>${locHTML}</tbody></table></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Ticket Breakdown (Last ${days}d)</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Issue Type</th><th>Total</th><th>Resolved</th><th>Resolution Rate</th></tr></thead><tbody>${ticketHTML}</tbody></table></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">⚠️ Low Supply Alerts</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Alerts</th></tr></thead><tbody>${alertHTML}</tbody></table></div>
      </div>
      <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Restroom Analytics', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 10: Cleaning Schedule ─────────────────────────── */
  app.get('/school/smart-restroom/schedule', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const locs = await pool.query(`SELECT rl.*, rs.cleanliness_score, rs.last_cleaned, rs.soap_level, rs.paper_level FROM restroom_locations rl LEFT JOIN restroom_status rs ON rs.location_id=rl.id WHERE rl.tenant_id=$1 AND rl.status='active' ORDER BY rl.building, rl.floor`, [tid]);
      let rows = '';
      for (const l of locs.rows) {
        const clean = parseFloat(l.cleanliness_score)||0;
        const needsAttn = clean < 3 || (l.soap_level||0) < 40 || (l.paper_level||0) < 40;
        const priorityClass = needsAttn ? 'color:#ef4444;font-weight:700' : '';
        const lastClean = l.last_cleaned ? new Date(l.last_cleaned) : null;
        const hoursSince = lastClean ? Math.round((Date.now() - lastClean.getTime()) / 3600000) : 999;
        const urgency = hoursSince > 8 ? '🔴 Urgent' : hoursSince > 4 ? '🟡 Due Soon' : '🟢 OK';
        rows += `<tr style="${priorityClass}">
          <td>${esc(l.building)}</td><td>${esc(l.floor)}</td><td>${esc(l.type)}</td>
          <td>${scoreBadge(clean)}</td><td>${esc(l.last_cleaned ? lastClean.toLocaleString() : 'Never')}</td>
          <td>${hoursSince}h ago</td><td>${urgency}</td>
          <td><form method="POST" action="/school/smart-restroom/schedule/mark-cleaned" style="display:inline">
            <input type="hidden" name="location_id" value="${l.id}">
            <button type="submit" class="btn" style="font-size:11px;padding:3px 8px">✓ Mark Cleaned</button>
          </form></td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Cleaning Schedule & Priority</h3>
        <form method="POST" action="/school/smart-restroom/schedule/mark-all" style="display:inline">
          <button class="btn" style="background:#22c55e" onclick="return confirm('Mark all locations as cleaned now?')">✓ Mark All Cleaned</button>
        </form>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Building</th><th>Floor</th><th>Type</th><th>Clean Score</th><th>Last Cleaned</th><th>Hours Ago</th><th>Urgency</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Cleaning Schedule', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/schedule/mark-cleaned', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_status SET last_cleaned=NOW(), cleanliness_score=5.0, soap_level=100, paper_level=100, updated_at=NOW() WHERE location_id=$1 AND tenant_id=$2`, [req.body.location_id, tid]);
      audit(req, 'restroom_mark_cleaned', { location_id: req.body.location_id });
      req.flash('success', 'Marked as cleaned');
      res.redirect('/school/smart-restroom/schedule');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/smart-restroom/schedule/mark-all', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      await pool.query(`UPDATE restroom_status SET last_cleaned=NOW(), cleanliness_score=5.0, soap_level=100, paper_level=100, updated_at=NOW() FROM restroom_locations WHERE restroom_locations.id=restroom_status.location_id AND restroom_locations.tenant_id=$1 AND restroom_locations.status='active'`, [tid]);
      audit(req, 'restroom_mark_all_cleaned', {});
      req.flash('success', 'All locations marked as cleaned');
      res.redirect('/school/smart-restroom/schedule');
    } catch(e) { ah(e, req, res); }
  });

  /* ─── Route 11: Supply Report ──────────────────────────────── */
  app.get('/school/smart-restroom/supplies', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const data = await pool.query(`
        SELECT rl.building, rl.floor, rs.soap_level, rs.paper_level, rs.last_checked
        FROM restroom_locations rl JOIN restroom_status rs ON rs.location_id=rl.id
        WHERE rl.tenant_id=$1 AND rl.status='active'
        ORDER BY rs.soap_level ASC, rs.paper_level ASC`, [tid]);
      const summary = await pool.query(`
        SELECT
          COUNT(CASE WHEN soap_level < 20 THEN 1 END) AS soap_critical,
          COUNT(CASE WHEN soap_level >= 20 AND soap_level < 50 THEN 1 END) AS soap_low,
          COUNT(CASE WHEN paper_level < 20 THEN 1 END) AS paper_critical,
          COUNT(CASE WHEN paper_level >= 20 AND paper_level < 50 THEN 1 END) AS paper_low,
          AVG(soap_level)::int AS avg_soap, AVG(paper_level)::int AS avg_paper
        FROM restroom_status rs JOIN restroom_locations rl ON rl.id=rs.location_id
        WHERE rl.tenant_id=$1 AND rl.status='active'`, [tid]);
      const s = summary.rows[0] || {};
      let rows = '';
      for (const d of data.rows) {
        const soapOk = d.soap_level >= 50;
        const paperOk = d.paper_level >= 50;
        rows += `<tr>
          <td>${esc(d.building)} ${esc(d.floor)}</td>
          <td><div style="display:flex;align-items:center;gap:6px">${getBar(d.soap_level, soapOk?'#22c55e':'#ef4444')} <span style="font-weight:600;color:${soapOk?'#22c55e':'#ef4444'}">${d.soap_level}%</span></div></td>
          <td><div style="display:flex;align-items:center;gap:6px">${getBar(d.paper_level, paperOk?'#22c55e':'#ef4444')} <span style="font-weight:600;color:${paperOk?'#22c55e':'#ef4444'}">${d.paper_level}%</span></div></td>
          <td>${d.last_checked ? new Date(d.last_checked).toLocaleString() : '<em style="color:'+GRAY+'">N/A</em>'}</td></tr>`;
      }
      const html = `${SKIP}
      <div class="card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
        <div><div style="font-size:24px;font-weight:700;color:#ef4444">${s.soap_critical||0}</div><div style="color:${GRAY}">Soap Critical</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#f59e0b">${s.soap_low||0}</div><div style="color:${GRAY}">Soap Low</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#ef4444">${s.paper_critical||0}</div><div style="color:${GRAY}">Paper Critical</div></div>
        <div><div style="font-size:24px;font-weight:700;color:#f59e0b">${s.paper_low||0}</div><div style="color:${GRAY}">Paper Low</div></div>
      </div>
      <div class="card"><h3 style="margin:0 0 10px">Supply Levels by Location</h3>
        <div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Soap Level</th><th>Paper Level</th><th>Last Checked</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      <a href="/school/smart-restroom" class="btn" style="background:${GRAY};text-decoration:none">← Dashboard</a>`;
      renderPage(req, res, 'Supply Report', html, { activeTab: 'smart-restroom' });
    } catch(e) { ah(e, req, res); }
  });
};
