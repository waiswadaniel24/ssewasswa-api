/**
 * Interactive Campus Map Module
 * Multi-tenant SaaS school portal
 *
 * Features: SVG campus map, location CRUD, routing, search, accessibility,
 *           evacuation routes, POI management, virtual tour, directory
 * 15 routes • PostgreSQL • tenant_id scoped
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Interactive Campus Map</div>';
  const GREEN = '#059669', RED = '#dc2626', AMBER = '#d97706', BLUE = '#2563eb';
  const CARD = 'style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)"';

  /* ── Helpers ────────────────────────────────────────────────────── */
  const navLink = (href, label, active) => {
    const bg = active ? P : '#e5e7eb';
    const fg = active ? '#fff' : GRAY;
    return `<a href="/school/campus-map${href}" style="display:inline-block;padding:6px 14px;border-radius:8px;background:${bg};color:${fg};text-decoration:none;font-size:0.85em;margin:0 4px 4px 0">${label}</a>`;
  };
  const navBar = (active) => {
    const links = [
      ['','Map'],['/locations','Locations'],['/routes','Routes'],
      ['/search','Search'],['/accessibility','Accessibility'],
      ['/evacuation','Evacuation'],['/building-directory','Directory'],
      ['/poi','POIs'],['/tour','Virtual Tour']
    ];
    return '<div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:4px">' +
      links.map(([h,l]) => navLink(h, l, active === l)).join('') + '</div>';
  };
  const typeIcon = (t) => {
    const m = { building:'🏛️', room:'🚪', hall:'🏫', lab:'🔬', library:'📚',
      sports:'⚽', parking:'🅿️', outdoor:'🌳', cafeteria:'🍽️', clinic:'🏥',
      admin:'🏢', playground:' swings', garden:'🌿', gate:'🚧', workshop:'🔧' };
    return m[t] || '📍';
  };
  const badge = (text, color) => `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.75em;background:${color}22;color:${color};font-weight:600">${text}</span>`;

  /* ── Migrations ─────────────────────────────────────────────────── */
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS campus_locations (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          type VARCHAR(50) DEFAULT 'building',
          description TEXT,
          svg_coords JSONB DEFAULT '{}',
          capacity INTEGER DEFAULT 0,
          facilities JSONB DEFAULT '[]',
          floor INTEGER DEFAULT 1,
          building_id INTEGER REFERENCES campus_locations(id) ON DELETE SET NULL,
          accessible BOOLEAN DEFAULT false,
          photo_url VARCHAR(500),
          floor_plan_url VARCHAR(500),
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS campus_routes (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          waypoints JSONB DEFAULT '[]',
          distance_m NUMERIC(8,1) DEFAULT 0,
          est_walk_min NUMERIC(5,1) DEFAULT 0,
          accessible BOOLEAN DEFAULT false,
          route_type VARCHAR(30) DEFAULT 'general',
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS campus_poi (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          location_id INTEGER REFERENCES campus_locations(id) ON DELETE CASCADE,
          poi_type VARCHAR(50) DEFAULT 'info',
          icon VARCHAR(50) DEFAULT '📍',
          label VARCHAR(255) NOT NULL,
          description TEXT,
          svg_coords JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_cl_tenant ON campus_locations(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_cl_type ON campus_locations(tenant_id, type);',
        'CREATE INDEX IF NOT EXISTS idx_cl_building ON campus_locations(tenant_id, building_id);',
        'CREATE INDEX IF NOT EXISTS idx_cl_status ON campus_locations(tenant_id, status);',
        'CREATE INDEX IF NOT EXISTS idx_cr_tenant ON campus_routes(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_cr_type ON campus_routes(tenant_id, route_type);',
        'CREATE INDEX IF NOT EXISTS idx_cp_tenant ON campus_poi(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_cp_location ON campus_poi(tenant_id, location_id);',
      ];
      for (const sql of idxs) { try { await pool.query(sql); } catch (_) {} }
      console.log('[CampusMap] Tables ready');
    } catch(e) { console.warn('[CampusMap] Migration warning:', e.message); }
  })();

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 1 — Main SVG Campus Map
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [locs] = await pool.query(
      'SELECT id, name, type, svg_coords, accessible, capacity, floor FROM campus_locations WHERE tenant_id = $1 AND status = $2',
      [tid, 'active']
    );
    const [pois] = await pool.query(
      'SELECT id, label, icon, svg_coords, poi_type FROM campus_poi WHERE tenant_id = $1',
      [tid]
    );
    let svgShapes = '';
    locs.forEach(l => {
      const c = l.svg_coords || {};
      const x = c.x || 100, y = c.y || 100, w = c.w || 80, h = c.h || 60;
      const fill = { building:'#dbeafe', room:'#f0fdf4', hall:'#fef3c7', lab:'#fce7f3',
        library:'#ede9fe', sports:'#d1fae5', parking:'#f3f4f6', cafeteria:'#fff7ed',
        clinic:'#fee2e2', admin:'#e0e7ff', outdoor:'#ecfdf5' }[l.type] || '#f9fafb';
      const accBorder = l.accessible ? `stroke:${GREEN};stroke-width:3` : 'stroke:#94a3b8;stroke-width:1.5';
      const tip = `${l.name} (${l.type})${l.accessible ? ' ♿' : ''}${l.capacity ? ' | Cap: '+l.capacity : ''} | Floor: ${l.floor||1}`;
      svgShapes += `<a href="/school/campus-map/details/${l.id}" tabindex="0">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" ${accBorder} class="map-zone" data-name="${esc(l.name)}">
          <title>${esc(tip)}</title>
        </rect>
        <text x="${x + w/2}" y="${y + h/2 + 4}" text-anchor="middle" font-size="9" fill="#374151">${esc(l.name.length > 10 ? l.name.substring(0,9)+'…' : l.name)}</text>
      </a>`;
    });
    pois.forEach(p => {
      const c = p.svg_coords || {};
      const x = c.x || 50, y = c.y || 50;
      svgShapes += `<a href="/school/campus-map/details/${p.location_id || 0}" tabindex="0">
        <circle cx="${x}" cy="${y}" r="10" fill="#fef3c7" stroke="#d97706" stroke-width="1.5" class="map-poi">
          <title>${esc(p.label)} — ${esc(p.icon)}</title>
        </circle>
        <text x="${x}" y="${y + 3}" text-anchor="middle" font-size="10">${p.icon}</text>
      </a>`;
    });

    const body = SKIP + navBar('Map') + `
      <div ${CARD}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2 style="margin:0;color:${P}">🗺️ Interactive Campus Map</h2>
          <div>
            <a href="/school/campus-map/locations/new" class="btn" style="margin-right:6px">+ Add Location</a>
            <a href="/school/campus-map/tour" class="btn" style="background:${AMBER}">🎬 Virtual Tour</a>
          </div>
        </div>
        <div style="position:relative;border:2px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#f0fdf4">
          <svg viewBox="0 0 900 600" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
            <defs>
              <style>
                .map-zone { transition: all 0.2s ease; cursor: pointer; }
                .map-zone:hover { filter: brightness(0.92); stroke-width: 3; }
                .map-poi { transition: all 0.2s ease; cursor: pointer; }
                .map-poi:hover { r: 14; filter: brightness(0.9); }
              </style>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
              </pattern>
            </defs>
            <rect width="900" height="600" fill="url(#grid)"/>
            <!-- Paths / Walkways -->
            <line x1="100" y1="300" x2="800" y2="300" stroke="#cbd5e1" stroke-width="8" stroke-linecap="round"/>
            <line x1="450" y1="50" x2="450" y2="550" stroke="#cbd5e1" stroke-width="8" stroke-linecap="round"/>
            <line x1="200" y1="100" x2="700" y2="500" stroke="#cbd5e1" stroke-width="6" stroke-dasharray="12 6" stroke-linecap="round"/>
            <!-- Trees -->
            <circle cx="50" cy="80" r="18" fill="#86efac" opacity="0.6"/><circle cx="830" cy="520" r="22" fill="#86efac" opacity="0.6"/>
            <circle cx="780" cy="90" r="16" fill="#86efac" opacity="0.6"/><circle cx="120" cy="500" r="20" fill="#86efac" opacity="0.6"/>
            <!-- Locations & POIs -->
            ${svgShapes}
            <!-- Legend -->
            <rect x="690" y="10" width="200" height="100" rx="8" fill="white" fill-opacity="0.9" stroke="#e5e7eb"/>
            <text x="700" y="28" font-size="10" font-weight="bold" fill="#374151">Legend</text>
            <rect x="700" y="34" width="14" height="10" rx="2" fill="#dbeafe" stroke="#94a3b8"/><text x="720" y="43" font-size="8" fill="#6b7280">Building</text>
            <rect x="770" y="34" width="14" height="10" rx="2" fill="#f0fdf4" stroke="${GREEN}" stroke-width="2.5"/><text x="790" y="43" font-size="8" fill="#6b7280">Accessible</text>
            <circle cx="707" cy="58" r="5" fill="#fef3c7" stroke="#d97706"/><text x="720" y="61" font-size="8" fill="#6b7280">POI</text>
            <line x1="700" y1="75" x2="714" y2="75" stroke="#cbd5e1" stroke-width="4"/><text x="720" y="78" font-size="8" fill="#6b7280">Walkway</text>
          </svg>
        </div>
        <div style="margin-top:10px;font-size:0.8em;color:${GRAY}">
          ${locs.length} locations &middot; ${pois.length} points of interest &middot;
          ${locs.filter(l => l.accessible).length} accessible &middot; Click any zone for details
        </div>
      </div>`;
    res.send(renderPage('Campus Map', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 2 — Locations List
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/locations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const typeFilter = req.query.type || '';
    let sql = 'SELECT l.*, b.name AS building_name FROM campus_locations l LEFT JOIN campus_locations b ON b.id = l.building_id WHERE l.tenant_id = $1';
    const params = [tid];
    if (typeFilter) { sql += ' AND l.type = $2'; params.push(typeFilter); }
    sql += ' ORDER BY l.type, l.name';
    const [locs] = await pool.query(sql, params);
    const types = ['building','room','hall','lab','library','sports','parking','outdoor','cafeteria','clinic','admin','playground','garden','gate','workshop'];
    let body = SKIP + navBar('Locations') + `
      <div ${CARD}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2 style="margin:0;color:${P}">📍 Campus Locations</h2>
          <a href="/school/campus-map/locations/new" class="btn">+ Add Location</a>
        </div>
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:4px">
          ${navLink('/locations', 'All', !typeFilter)}
          ${types.map(t => navLink('/locations?type='+t, typeIcon(t)+' '+t.charAt(0).toUpperCase()+t.slice(1), typeFilter===t)).join('')}
        </div>`;
    if (locs.length) {
      body += `<table><tr><th>Name</th><th>Type</th><th>Building</th><th>Floor</th><th>Capacity</th><th>Accessible</th><th>Actions</th></tr>`;
      locs.forEach(l => {
        body += `<tr>
          <td><a href="/school/campus-map/details/${l.id}" style="color:${P};text-decoration:none;font-weight:600">${typeIcon(l.type)} ${esc(l.name)}</a></td>
          <td>${badge(l.type, BLUE)}</td>
          <td>${esc(l.building_name || '—')}</td>
          <td>${l.floor || 1}</td>
          <td>${l.capacity || '—'}</td>
          <td>${l.accessible ? badge('Wheelchair ♿', GREEN) : '<span style="color:#9ca3af">No</span>'}</td>
          <td>
            <a href="/school/campus-map/locations/${l.id}/edit" style="color:${BLUE};text-decoration:none;font-size:0.85em">Edit</a> |
            <form method="POST" action="/school/campus-map/locations/${l.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(l.name)}?')">
              <button style="background:none;border:none;color:${RED};cursor:pointer;font-size:0.85em;padding:0">Delete</button>
            </form>
          </td></tr>`;
      });
      body += '</table>';
    } else {
      body += '<p style="color:#9ca3af;text-align:center;padding:30px">No locations found. <a href="/school/campus-map/locations/new" style="color:'+P+'">Add your first location.</a></p>';
    }
    body += '</div>';
    res.send(renderPage('Locations', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 3 — Add Location Form
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/locations/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [buildings] = await pool.query(
      'SELECT id, name FROM campus_locations WHERE tenant_id = $1 AND type = $2 AND status = $3 ORDER BY name',
      [tid, 'building', 'active']
    );
    const types = ['building','room','hall','lab','library','sports','parking','outdoor','cafeteria','clinic','admin','playground','garden','gate','workshop'];
    const facilityOptions = ['Projector','Whiteboard','AC','Wi-Fi','Computers','Lab Equipment','Smart Board','Sound System','Kitchen','Medical Equipment','Restrooms','Elevator','Ramps','Prayer Room','Storage','Locker Room'];
    let body = SKIP + navBar('Locations') + `
      <div ${CARD}>
        <h2 style="color:${P};margin-bottom:16px">➕ Add Campus Location</h2>
        <form method="POST" action="/school/campus-map/locations/save">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Name *</label>
              <input name="name" required placeholder="e.g. Science Block A"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Type *</label>
              <select name="type">${types.map(t => '<option value="'+t+'">'+typeIcon(t)+' '+t.charAt(0).toUpperCase()+t.slice(1)+'</option>').join('')}</select></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" placeholder="Brief description of this location"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Parent Building</label>
              <select name="building_id"><option value="">— None (top-level) —</option>${buildings.map(b => '<option value="'+b.id+'">'+esc(b.name)+'</option>').join('')}</select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Floor</label>
              <input name="floor" type="number" min="0" value="1"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Capacity</label>
              <input name="capacity" type="number" min="0" value="0"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG X</label>
              <input name="svg_x" type="number" min="0" value="100" placeholder="X coord"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG Y</label>
              <input name="svg_y" type="number" min="0" value="100" placeholder="Y coord"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG Width × Height</label>
              <div style="display:flex;gap:6px"><input name="svg_w" type="number" min="20" value="80" placeholder="W" style="width:50%"><input name="svg_h" type="number" min="20" value="60" placeholder="H" style="width:50%"></div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Photo URL</label>
              <input name="photo_url" placeholder="https://..."></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Floor Plan URL</label>
              <input name="floor_plan_url" placeholder="https://..."></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Facilities</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${facilityOptions.map(f => '<label style="display:flex;align-items:center;gap:4px;font-size:0.85em"><input type="checkbox" name="facilities" value="'+f+'"> '+f+'</label>').join('')}
            </div></div>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:16px;font-weight:600">
            <input type="checkbox" name="accessible" value="1"> ♿ Wheelchair Accessible</label>
          <button type="submit" class="btn">Save Location</button>
          <a href="/school/campus-map/locations" style="margin-left:8px;color:${GRAY};text-decoration:none">Cancel</a>
        </form>
      </div>`;
    res.send(renderPage('Add Location', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 4 — Save Location (Create / Update)
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/locations/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, type, description, building_id, floor, capacity,
            svg_x, svg_y, svg_w, svg_h, photo_url, floor_plan_url,
            accessible, id } = req.body;
    if (!name || !name.trim()) return res.send('<p style="color:red;padding:20px">Name is required.</p><a href="javascript:history.back()">Go back</a>');
    const facilities = Array.isArray(req.body.facilities) ? req.body.facilities : (req.body.facilities ? [req.body.facilities] : []);
    const svgCoords = JSON.stringify({ x: parseInt(svg_x)||100, y: parseInt(svg_y)||100, w: parseInt(svg_w)||80, h: parseInt(svg_h)||60 });
    if (id) {
      await pool.query(
        `UPDATE campus_locations SET name=$1, type=$2, description=$3, building_id=$4, floor=$5,
         capacity=$6, svg_coords=$7, facilities=$8, accessible=$9, photo_url=$10,
         floor_plan_url=$11, updated_at=NOW() WHERE id=$12 AND tenant_id=$13`,
        [name.trim(), type||'building', description||null, building_id||null, parseInt(floor)||1,
         parseInt(capacity)||0, svgCoords, JSON.stringify(facilities), !!accessible,
         photo_url||null, floor_plan_url||null, id, tid]
      );
      audit('campus_location_updated', { id, name: name.trim() });
    } else {
      const [ins] = await pool.query(
        `INSERT INTO campus_locations (tenant_id, name, type, description, building_id, floor,
         capacity, svg_coords, facilities, accessible, photo_url, floor_plan_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tid, name.trim(), type||'building', description||null, building_id||null, parseInt(floor)||1,
         parseInt(capacity)||0, svgCoords, JSON.stringify(facilities), !!accessible,
         photo_url||null, floor_plan_url||null]
      );
      audit('campus_location_created', { id: ins[0].id, name: name.trim() });
    }
    res.redirect('/school/campus-map/locations');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 5 — Edit Location
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/locations/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rows] = await pool.query('SELECT * FROM campus_locations WHERE id = $1 AND tenant_id = $2', [req.params.id, tid]);
    if (!rows[0]) return res.status(404).send('Location not found.');
    const loc = rows[0];
    const [buildings] = await pool.query(
      'SELECT id, name FROM campus_locations WHERE tenant_id = $1 AND type = $2 AND status = $3 AND id != $4 ORDER BY name',
      [tid, 'building', 'active', loc.id]
    );
    const types = ['building','room','hall','lab','library','sports','parking','outdoor','cafeteria','clinic','admin','playground','garden','gate','workshop'];
    const facilityOptions = ['Projector','Whiteboard','AC','Wi-Fi','Computers','Lab Equipment','Smart Board','Sound System','Kitchen','Medical Equipment','Restrooms','Elevator','Ramps','Prayer Room','Storage','Locker Room'];
    const curFacilities = Array.isArray(loc.facilities) ? loc.facilities : [];
    const c = loc.svg_coords || {};
    let body = SKIP + navBar('Locations') + `
      <div ${CARD}>
        <h2 style="color:${P};margin-bottom:16px">✏️ Edit: ${esc(loc.name)}</h2>
        <form method="POST" action="/school/campus-map/locations/save">
          <input type="hidden" name="id" value="${loc.id}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Name *</label>
              <input name="name" required value="${esc(loc.name)}"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Type *</label>
              <select name="type">${types.map(t => '<option value="'+t+'"'+(loc.type===t?' selected':'')+'>'+typeIcon(t)+' '+t.charAt(0).toUpperCase()+t.slice(1)+'</option>').join('')}</select></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2">${esc(loc.description||'')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Parent Building</label>
              <select name="building_id"><option value="">— None —</option>${buildings.map(b => '<option value="'+b.id+'"'+(loc.building_id===b.id?' selected':'')+'>'+esc(b.name)+'</option>').join('')}</select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Floor</label>
              <input name="floor" type="number" min="0" value="${loc.floor||1}"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Capacity</label>
              <input name="capacity" type="number" min="0" value="${loc.capacity||0}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG X</label><input name="svg_x" type="number" value="${c.x||100}"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG Y</label><input name="svg_y" type="number" value="${c.y||100}"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">W × H</label>
              <div style="display:flex;gap:6px"><input name="svg_w" type="number" value="${c.w||80}" style="width:50%"><input name="svg_h" type="number" value="${c.h||60}" style="width:50%"></div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Photo URL</label><input name="photo_url" value="${esc(loc.photo_url||'')}"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Floor Plan URL</label><input name="floor_plan_url" value="${esc(loc.floor_plan_url||'')}"></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Facilities</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${facilityOptions.map(f => '<label style="display:flex;align-items:center;gap:4px;font-size:0.85em"><input type="checkbox" name="facilities" value="'+f+'"'+(curFacilities.includes(f)?' checked':'')+'> '+f+'</label>').join('')}
            </div></div>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:16px;font-weight:600">
            <input type="checkbox" name="accessible" value="1"${loc.accessible?' checked':''}> ♿ Wheelchair Accessible</label>
          <button type="submit" class="btn">Update Location</button>
          <a href="/school/campus-map/locations" style="margin-left:8px;color:${GRAY};text-decoration:none">Cancel</a>
        </form>
      </div>`;
    res.send(renderPage('Edit Location', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 6 — Delete Location
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/locations/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campus_poi WHERE tenant_id = $1 AND location_id = $2', [tid, req.params.id]);
    await pool.query('UPDATE campus_locations SET building_id = NULL WHERE tenant_id = $1 AND building_id = $2', [tid, req.params.id]);
    await pool.query('DELETE FROM campus_locations WHERE id = $1 AND tenant_id = $2', [req.params.id, tid]);
    audit('campus_location_deleted', { id: req.params.id });
    res.redirect('/school/campus-map/locations');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 7 — Location Details
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/details/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [rows] = await pool.query(
      `SELECT l.*, b.name AS building_name FROM campus_locations l
       LEFT JOIN campus_locations b ON b.id = l.building_id
       WHERE l.id = $1 AND l.tenant_id = $2`, [req.params.id, tid]);
    if (!rows[0]) return res.status(404).send('Location not found.');
    const loc = rows[0];
    const [children] = await pool.query(
      'SELECT id, name, type, floor, capacity, accessible FROM campus_locations WHERE tenant_id = $1 AND building_id = $2 AND status = $3 ORDER BY floor, name',
      [tid, loc.id, 'active']
    );
    const [pois] = await pool.query(
      'SELECT * FROM campus_poi WHERE tenant_id = $1 AND location_id = $2 ORDER BY poi_type', [tid, loc.id]
    );
    const [nearbyRoutes] = await pool.query(
      `SELECT r.id, r.name, r.route_type, r.distance_m, r.est_walk_min FROM campus_routes r
       WHERE r.tenant_id = $1 AND r.status = $2
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.waypoints) AS w WHERE w::int = $3)
       ORDER BY r.name LIMIT 5`, [tid, 'active', loc.id]
    );
    const facilities = Array.isArray(loc.facilities) ? loc.facilities : [];
    const c = loc.svg_coords || {};

    let body = SKIP + navBar('Map') + `
      <a href="/school/campus-map" style="color:${P};text-decoration:none;display:inline-block;margin-bottom:12px">&larr; Back to Map</a>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div>
          <div ${CARD}>
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div>
                <h2 style="margin:0;color:${P}">${typeIcon(loc.type)} ${esc(loc.name)}</h2>
                <p style="margin:4px 0 0;color:${GRAY}">${badge(loc.type, BLUE)} &middot; Floor ${loc.floor||1} &middot; ${loc.capacity?'Capacity: '+loc.capacity:'No capacity set'}</p>
              </div>
              <div>${loc.accessible ? badge('♿ Accessible', GREEN) : ''}</div>
            </div>
            ${loc.description ? '<p style="margin-top:12px;color:#374151">'+esc(loc.description)+'</p>' : ''}
            ${loc.building_name ? '<p style="margin-top:8px;color:#6b7280">Building: <strong>'+esc(loc.building_name)+'</strong></p>' : ''}
            ${loc.photo_url ? '<div style="margin-top:12px"><img src="'+esc(loc.photo_url)+'" alt="'+esc(loc.name)+'" style="max-width:100%;max-height:300px;border-radius:8px;border:1px solid #e5e7eb" onerror="this.style.display=\'none\'"></div>' : ''}
            ${loc.floor_plan_url ? '<div style="margin-top:12px"><h3 style="color:'+P+'">Floor Plan</h3><img src="'+esc(loc.floor_plan_url)+'" alt="Floor plan" style="max-width:100%;max-height:400px;border-radius:8px;border:1px solid #e5e7eb" onerror="this.style.display=\'none\'"></div>' : ''}
          </div>
          ${facilities.length ? `
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">🛠️ Facilities</h3>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${facilities.map(f => '<span style="display:inline-block;padding:4px 12px;border-radius:8px;font-size:0.8em;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">'+esc(f)+'</span>').join('')}
            </div>
          </div>` : ''}
          ${children.length ? `
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">🏢 Rooms & Sub-locations (${children.length})</h3>
            <table><tr><th>Name</th><th>Type</th><th>Floor</th><th>Capacity</th><th>Access</th></tr>
              ${children.map(ch => `<tr>
                <td><a href="/school/campus-map/details/${ch.id}" style="color:${P};text-decoration:none">${esc(ch.name)}</a></td>
                <td>${typeIcon(ch.type)} ${ch.type}</td><td>${ch.floor||1}</td><td>${ch.capacity||'—'}</td>
                <td>${ch.accessible ? '♿' : ''}</td></tr>`).join('')}
            </table>
          </div>` : ''}
        </div>
        <div>
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">📍 Map Position</h3>
            <div style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;border:1px solid #d1fae5">
              <svg viewBox="0 0 200 150" style="width:100%;height:auto">
                <rect width="200" height="150" fill="#f0fdf4"/>
                <rect x="${(c.x||100)*200/900-10}" y="${(c.y||100)*150/600-8}" width="${(c.w||80)*200/900}" height="${(c.h||60)*150/600}" rx="4" fill="${P}" opacity="0.7"/>
                <text x="${(c.x||100)*200/900-10+(c.w||80)*200/900/2}" y="${(c.y||100)*150/600-8+(c.h||60)*150/600/2+3}" text-anchor="middle" font-size="7" fill="white">${esc(loc.name)}</text>
              </svg>
              <p style="font-size:0.75em;color:${GRAY};margin:6px 0 0">X:${c.x||0} Y:${c.y||0} W:${c.w||0} H:${c.h||0}</p>
            </div>
          </div>
          ${pois.length ? `
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">📌 Points of Interest (${pois.length})</h3>
            ${pois.map(p => '<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:0.85em"><span style="font-size:1.1em">'+p.icon+'</span> <strong>'+esc(p.label)+'</strong><div style="color:'+GRAY+'">'+esc(p.poi_type)+(p.description ? ': '+esc(p.description) : '')+'</div></div>').join('')}
          </div>` : ''}
          ${nearbyRoutes.length ? `
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">🚶 Nearby Routes (${nearbyRoutes.length})</h3>
            ${nearbyRoutes.map(r => '<div style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:0.85em"><a href="/school/campus-map/routes" style="color:'+P+';text-decoration:none;font-weight:600">'+esc(r.name)+'</a><div style="color:'+GRAY+'">'+badge(r.route_type||'general', AMBER)+' &middot; '+r.distance_m+'m &middot; ~'+r.est_walk_min+' min</div></div>').join('')}
          </div>` : ''}
          <div ${CARD}>
            <h3 style="color:${P};margin:0 0 10px">🛠️ Quick Actions</h3>
            <a href="/school/campus-map/locations/${loc.id}/edit" class="btn" style="display:block;margin-bottom:6px;text-align:center">✏️ Edit Location</a>
            <a href="/school/campus-map/search?q=${encodeURIComponent(loc.name)}" class="btn" style="display:block;margin-bottom:6px;text-align:center;background:${GRAY}">🔍 Nearby Search</a>
            <a href="/school/campus-map/evacuation" class="btn" style="display:block;text-align:center;background:${RED}">🚨 Evacuation Info</a>
          </div>
        </div>
      </div>`;
    res.send(renderPage('Location: ' + loc.name, body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 8 — Location Search
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/search', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const q = (req.query.q || '').trim();
    const typeFilter = req.query.type || '';
    let results = [];
    if (q) {
      let sql = `SELECT l.*, b.name AS building_name FROM campus_locations l
        LEFT JOIN campus_locations b ON b.id = l.building_id
        WHERE l.tenant_id = $1 AND l.status = $2 AND (
          l.name ILIKE $3 OR l.description ILIKE $3 OR l.type ILIKE $3
        )`;
      const params = [tid, 'active', '%' + q + '%'];
      if (typeFilter) { sql += ' AND l.type = $4'; params.push(typeFilter); }
      sql += ' ORDER BY l.name LIMIT 50';
      const [rows] = await pool.query(sql, params);
      results = rows;
    }
    const types = ['building','room','hall','lab','library','sports','parking','outdoor','cafeteria','clinic','admin'];
    let body = SKIP + navBar('Search') + `
      <div ${CARD}>
        <h2 style="color:${P};margin:0 0 16px">🔍 Search Campus Locations</h2>
        <form method="GET" action="/school/campus-map/search" style="display:flex;gap:8px;margin-bottom:16px">
          <input name="q" value="${esc(q)}" placeholder="Search by name, type, or description..." style="flex:1" autofocus>
          <button type="submit" class="btn">Search</button>
        </form>
        ${q ? '<div style="margin-bottom:10px;font-size:0.8em;color:'+GRAY+'">Showing results for "<strong>'+esc(q)+'</strong>"</div>' : ''}
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:4px">
          ${navLink('/search'+(q ? '?q='+encodeURIComponent(q) : ''), 'All', !typeFilter)}
          ${types.map(t => navLink('/search?type='+t+(q ? '&q='+encodeURIComponent(q) : ''), t.charAt(0).toUpperCase()+t.slice(1), typeFilter===t)).join('')}
        </div>`;
    if (results.length) {
      body += '<table><tr><th>Name</th><th>Type</th><th>Building</th><th>Floor</th><th>Capacity</th><th>Facilities</th><th></th></tr>';
      results.forEach(r => {
        const facs = Array.isArray(r.facilities) ? r.facilities.slice(0,3).join(', ') : '';
        body += `<tr>
          <td><strong>${typeIcon(r.type)} ${esc(r.name)}</strong></td>
          <td>${badge(r.type, BLUE)}</td>
          <td>${esc(r.building_name||'—')}</td><td>${r.floor||1}</td><td>${r.capacity||'—'}</td>
          <td style="font-size:0.8em;color:${GRAY}">${esc(facs)}${Array.isArray(r.facilities)&&r.facilities.length>3?' +'+(r.facilities.length-3):''}</td>
          <td><a href="/school/campus-map/details/${r.id}" class="btn" style="padding:4px 10px;font-size:0.8em">View</a></td></tr>`;
      });
      body += '</table>';
    } else if (q) {
      body += '<p style="text-align:center;color:'+GRAY+';padding:20px">No results found for "'+esc(q)+'".</p>';
    } else {
      body += '<p style="text-align:center;color:'+GRAY+';padding:20px">Enter a search term to find campus locations.</p>';
    }
    body += '</div>';
    res.send(renderPage('Search Locations', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 9 — Campus Routes
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/routes', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const typeFilter = req.query.type || '';
    let sql = 'SELECT * FROM campus_routes WHERE tenant_id = $1';
    const params = [tid];
    if (typeFilter) { sql += ' AND route_type = $2'; params.push(typeFilter); }
    sql += ' ORDER BY route_type, name';
    const [routes] = await pool.query(sql, params);
    const [locs] = await pool.query('SELECT id, name FROM campus_locations WHERE tenant_id = $1 AND status = $2 ORDER BY name', [tid, 'active']);
    const locMap = {};
    locs.forEach(l => { locMap[l.id] = l.name; });
    const routeTypes = ['general','accessible','emergency','scenic','shortcut'];

    let body = SKIP + navBar('Routes') + `
      <div ${CARD}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h2 style="margin:0;color:${P}">🚶 Campus Routes</h2>
          <a href="/school/campus-map/routes/new" class="btn">+ Add Route</a>
        </div>
        <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:4px">
          ${navLink('/routes', 'All', !typeFilter)}
          ${routeTypes.map(t => navLink('/routes?type='+t, t.charAt(0).toUpperCase()+t.slice(1), typeFilter===t)).join('')}
        </div>`;
    if (routes.length) {
      body += '<table><tr><th>Name</th><th>Type</th><th>Waypoints</th><th>Distance</th><th>Est. Walk</th><th>Accessible</th><th>Actions</th></tr>';
      routes.forEach(r => {
        const wps = Array.isArray(r.waypoints) ? r.waypoints : [];
        const wpNames = wps.map(w => locMap[parseInt(w)] || '#'+w).join(' → ');
        const typeColors = { general: BLUE, accessible: GREEN, emergency: RED, scenic: AMBER, shortcut: '#8b5cf6' };
        body += `<tr>
          <td><strong>${esc(r.name)}</strong>${r.description ? '<br><small style="color:'+GRAY+'">'+esc(r.description.substring(0,60))+'</small>' : ''}</td>
          <td>${badge(r.route_type||'general', typeColors[r.route_type]||BLUE)}</td>
          <td style="font-size:0.8em;max-width:250px">${esc(wpNames) || '—'}</td>
          <td>${r.distance_m||0}m</td><td>~${r.est_walk_min||0} min</td>
          <td>${r.accessible ? '♿' : '—'}</td>
          <td><form method="POST" action="/school/campus-map/routes/${r.id}/delete" style="display:inline" onsubmit="return confirm('Delete this route?')"><button style="background:none;border:none;color:${RED};cursor:pointer;padding:0">Delete</button></form></td></tr>`;
      });
      body += '</table>';
    } else {
      body += '<p style="text-align:center;color:'+GRAY+';padding:20px">No routes defined yet. <a href="/school/campus-map/routes/new" style="color:'+P+'">Create a route.</a></p>';
    }
    body += '</div>';
    res.send(renderPage('Campus Routes', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 10 — Add Route Form
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/routes/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [locs] = await pool.query('SELECT id, name, type FROM campus_locations WHERE tenant_id = $1 AND status = $2 ORDER BY name', [tid, 'active']);
    let body = SKIP + navBar('Routes') + `
      <div ${CARD}>
        <h2 style="color:${P};margin-bottom:16px">➕ Add Campus Route</h2>
        <form method="POST" action="/school/campus-map/routes/save">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Route Name *</label>
              <input name="name" required placeholder="e.g. Main Gate to Library"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Route Type *</label>
              <select name="route_type">
                <option value="general">🚶 General</option><option value="accessible">♿ Accessible</option>
                <option value="emergency">🚨 Emergency</option><option value="scenic">🌸 Scenic</option>
                <option value="shortcut">⚡ Shortcut</option>
              </select></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" placeholder="Describe the route"></textarea></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Waypoints (select in order)</label>
            <div style="max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px">
              ${locs.map(l => '<label style="display:flex;align-items:center;gap:6px;padding:4px;font-size:0.85em;cursor:pointer"><input type="checkbox" name="waypoints" value="'+l.id+'"> '+typeIcon(l.type)+' '+esc(l.name)+' <span style="color:'+GRAY+';font-size:0.75em">'+l.type+'</span></label>').join('')}
            </div>
            <small style="color:${GRAY}">Check locations in traversal order</small>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Distance (meters)</label>
              <input name="distance_m" type="number" min="0" step="1" value="0"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Estimated Walk Time (min)</label>
              <input name="est_walk_min" type="number" min="0" step="0.5" value="0"></div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:16px;font-weight:600">
            <input type="checkbox" name="accessible" value="1"> ♿ Accessible Route</label>
          <button type="submit" class="btn">Save Route</button>
          <a href="/school/campus-map/routes" style="margin-left:8px;color:${GRAY};text-decoration:none">Cancel</a>
        </form>
      </div>`;
    res.send(renderPage('Add Route', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 11 — Save Route
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/routes/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, route_type, description, distance_m, est_walk_min, accessible } = req.body;
    if (!name || !name.trim()) return res.send('<p style="color:red;padding:20px">Route name is required.</p><a href="javascript:history.back()">Go back</a>');
    const waypoints = Array.isArray(req.body.waypoints) ? req.body.waypoints.map(Number) : (req.body.waypoints ? [Number(req.body.waypoints)] : []);
    await pool.query(
      `INSERT INTO campus_routes (tenant_id, name, route_type, description, waypoints, distance_m, est_walk_min, accessible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tid, name.trim(), route_type||'general', description||null, JSON.stringify(waypoints),
       parseFloat(distance_m)||0, parseFloat(est_walk_min)||0, !!accessible]
    );
    audit('campus_route_created', { name: name.trim(), type: route_type });
    res.redirect('/school/campus-map/routes');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 12 — Delete Route
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/routes/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campus_routes WHERE id = $1 AND tenant_id = $2', [req.params.id, tid]);
    res.redirect('/school/campus-map/routes');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 13 — Accessibility Overview
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/accessibility', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [total] = await pool.query('SELECT COUNT(*)::int AS c FROM campus_locations WHERE tenant_id = $1 AND status = $2', [tid, 'active']);
    const [accessible] = await pool.query('SELECT COUNT(*)::int AS c FROM campus_locations WHERE tenant_id = $1 AND status = $2 AND accessible = true', [tid, 'active']);
    const [accLocs] = await pool.query(
      `SELECT l.id, l.name, l.type, l.floor, l.building_id, b.name AS building_name,
              l.facilities, l.photo_url
       FROM campus_locations l LEFT JOIN campus_locations b ON b.id = l.building_id
       WHERE l.tenant_id = $1 AND l.status = $2 AND l.accessible = true
       ORDER BY l.type, l.name`, [tid, 'active']
    );
    const [accRoutes] = await pool.query(
      'SELECT * FROM campus_routes WHERE tenant_id = $1 AND accessible = true AND status = $2 ORDER BY name', [tid, 'active']
    );
    const pct = total[0].c > 0 ? Math.round((accessible[0].c / total[0].c) * 100) : 0;
    const barColor = pct >= 75 ? GREEN : pct >= 50 ? AMBER : RED;

    let body = SKIP + navBar('Accessibility') + `
      <div ${CARD}>
        <h2 style="color:${P};margin:0 0 16px">♿ Accessibility Overview</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
          <div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:12px">
            <div style="font-size:2.5em;font-weight:bold;color:${GREEN}">${accessible[0].c}</div>
            <div style="color:${GRAY}">Accessible Locations</div>
          </div>
          <div style="text-align:center;padding:20px;background:#f9fafb;border-radius:12px">
            <div style="font-size:2.5em;font-weight:bold;color:${P}">${total[0].c}</div>
            <div style="color:${GRAY}">Total Locations</div>
          </div>
          <div style="text-align:center;padding:20px;background:#fef3c7;border-radius:12px">
            <div style="font-size:2.5em;font-weight:bold;color:${AMBER}">${pct}%</div>
            <div style="color:${GRAY}">Coverage</div>
            <div style="margin-top:8px;background:#e5e7eb;border-radius:8px;height:8px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${barColor};border-radius:8px;transition:width 0.5s"></div>
            </div>
          </div>
        </div>
        <h3 style="color:${P};margin:0 0 10px">♿ Accessible Locations</h3>`;
    if (accLocs.length) {
      body += '<table><tr><th>Name</th><th>Type</th><th>Building</th><th>Floor</th><th>Key Features</th></tr>';
      accLocs.forEach(l => {
        const facs = Array.isArray(l.facilities) ? l.facilities.filter(f => ['Elevator','Ramps','Restrooms'].includes(f)) : [];
        body += `<tr>
          <td><a href="/school/campus-map/details/${l.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(l.name)}</a></td>
          <td>${typeIcon(l.type)} ${l.type}</td>
          <td>${esc(l.building_name||'—')}</td><td>${l.floor||1}</td>
          <td>${facs.length ? facs.map(f => badge(f, GREEN)).join(' ') : '<span style="color:'+GRAY+'">—</span>'}</td></tr>`;
      });
      body += '</table>';
    } else {
      body += '<p style="color:'+GRAY+';text-align:center;padding:16px">No accessible locations marked yet.</p>';
    }
    body += '</div>';
    if (accRoutes.length) {
      body += `<div ${CARD}>
        <h3 style="color:${P};margin:0 0 10px">🚶 Accessible Routes (${accRoutes.length})</h3>
        <table><tr><th>Route</th><th>Description</th><th>Distance</th><th>Time</th></tr>
          ${accRoutes.map(r => `<tr>
            <td><strong>${esc(r.name)}</strong></td>
            <td style="color:${GRAY};font-size:0.85em">${esc(r.description||'—')}</td>
            <td>${r.distance_m||0}m</td><td>~${r.est_walk_min||0} min</td></tr>`).join('')}
        </table></div>`;
    }
    res.send(renderPage('Accessibility', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 14 — Emergency Evacuation Routes
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/evacuation', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [emergRoutes] = await pool.query(
      `SELECT r.*, jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'accessible', l.accessible)) AS loc_details
       FROM campus_routes r
       LEFT JOIN campus_locations l ON l.id = ANY(
         SELECT (elem)::int FROM jsonb_array_elements_text(r.waypoints) AS elem
       ) AND l.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.route_type = $2 AND r.status = $3
       GROUP BY r.id ORDER BY r.name`, [tid, 'emergency', 'active']
    );
    const [exits] = await pool.query(
      "SELECT id, name, type, svg_coords, accessible FROM campus_locations WHERE tenant_id = $1 AND status = $2 AND (type = 'gate' OR name ILIKE '%exit%' OR name ILIKE '%gate%') ORDER BY name",
      [tid, 'active']
    );
    const [assemblyPoints] = await pool.query(
      "SELECT id, name, description, svg_coords, capacity FROM campus_locations WHERE tenant_id = $1 AND status = $2 AND (type = 'outdoor' OR type = 'playground' OR name ILIKE '%assembly%' OR name ILIKE '%field%') ORDER BY name",
      [tid, 'active']
    );

    let body = SKIP + navBar('Evacuation') + `
      <div style="background:linear-gradient(135deg,#fef2f2,#fff1f2);border:2px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:16px">
        <h2 style="color:${RED};margin:0 0 8px">🚨 Emergency Evacuation Routes</h2>
        <p style="color:#991b1b;margin:0;font-size:0.9em">In case of emergency, follow the routes below to the nearest exit or assembly point. Remain calm and assist those who need help.</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        <div ${CARD} style="text-align:center;border-left:4px solid ${RED}">
          <div style="font-size:1.8em">🚪</div>
          <div style="font-size:1.5em;font-weight:bold;color:${RED}">${exits.length}</div>
          <div style="color:${GRAY};font-size:0.85em">Emergency Exits</div>
        </div>
        <div ${CARD} style="text-align:center;border-left:4px solid ${AMBER}">
          <div style="font-size:1.8em">🏃</div>
          <div style="font-size:1.5em;font-weight:bold;color:${AMBER}">${emergRoutes.length}</div>
          <div style="color:${GRAY};font-size:0.85em">Evacuation Routes</div>
        </div>
        <div ${CARD} style="text-align:center;border-left:4px solid ${GREEN}">
          <div style="font-size:1.8em">📍</div>
          <div style="font-size:1.5em;font-weight:bold;color:${GREEN}">${assemblyPoints.length}</div>
          <div style="color:${GRAY};font-size:0.85em">Assembly Points</div>
        </div>
      </div>`;

    if (emergRoutes.length) {
      body += `<div ${CARD}><h3 style="color:${RED};margin:0 0 12px">🚨 Evacuation Routes</h3>`;
      emergRoutes.forEach(r => {
        const wps = Array.isArray(r.loc_details) ? r.loc_details : [];
        body += `<div style="background:#fef2f2;border-radius:8px;padding:12px;margin-bottom:10px;border:1px solid #fecaca">
          <div style="font-weight:bold;color:${RED};margin-bottom:6px">${esc(r.name)} ${r.accessible ? badge('♿', GREEN) : ''}</div>
          ${r.description ? '<p style="margin:0 0 6px;font-size:0.85em;color:#991b1b">'+esc(r.description)+'</p>' : ''}
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px">
            ${wps.map((w, i) => '<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:white;border-radius:6px;font-size:0.8em;border:1px solid #fecaca">'+(i > 0 ? '<span style="color:#d97706">→</span> ' : '')+(w.accessible ? '♿ ' : '')+esc(w.name||'Unknown')+'</span>').join('')}
          </div>
          <div style="margin-top:6px;font-size:0.8em;color:${GRAY}">${r.distance_m||0}m &middot; ~${r.est_walk_min||0} min walk</div>
        </div>`;
      });
      body += '</div>';
    }

    if (exits.length) {
      body += `<div ${CARD}><h3 style="color:${RED};margin:0 0 10px">🚪 Emergency Exits</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
        ${exits.map(e => '<div style="background:#fef2f2;border-radius:8px;padding:10px;text-align:center;border:1px solid #fecaca"><div style="font-size:1.5em">🚪</div><div style="font-weight:600">'+esc(e.name)+'</div>'+(e.accessible ? badge('♿', GREEN) : '')+'</div>').join('')}
        </div></div>`;
    }

    if (assemblyPoints.length) {
      body += `<div ${CARD}><h3 style="color:${GREEN};margin:0 0 10px">📍 Assembly Points</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
        ${assemblyPoints.map(a => '<div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center;border:1px solid #bbf7d0"><div style="font-size:1.5em">📍</div><div style="font-weight:600">'+esc(a.name)+'</div>'+(a.capacity ? '<div style="color:'+GRAY+';font-size:0.8em">Capacity: '+a.capacity+'</div>' : '')+'</div>').join('')}
        </div></div>`;
    }

    body += `<div ${CARD}>
      <h3 style="color:${P};margin:0 0 10px">📋 Emergency Guidelines</h3>
      <ol style="line-height:2;color:#374151">
        <li><strong>Stay calm</strong> — Do not panic. Alert others around you quietly.</li>
        <li><strong>Follow routes</strong> — Use the nearest evacuation route shown above.</li>
        <li><strong>Assist others</strong> — Help anyone with mobility needs using accessible routes.</li>
        <li><strong>Do not use elevators</strong> — Use stairs and ramps only.</li>
        <li><strong>Proceed to assembly points</strong> — Gather at the designated safe areas.</li>
        <li><strong>Do not re-enter</strong> — Wait for official clearance before returning.</li>
        <li><strong>Call emergency services</strong> — Dial local emergency number if needed.</li>
      </ol>
    </div>`;
    res.send(renderPage('Emergency Evacuation', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 15 — Building Directory
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/building-directory', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [buildings] = await pool.query(
      `SELECT b.*,
        (SELECT COUNT(*)::int FROM campus_locations l WHERE l.building_id = b.id AND l.tenant_id = $2 AND l.status = 'active') AS room_count,
        (SELECT COALESCE(SUM(l.capacity), 0) FROM campus_locations l WHERE l.building_id = b.id AND l.tenant_id = $2 AND l.status = 'active') AS total_capacity,
        (SELECT COUNT(*)::int FROM campus_locations l WHERE l.building_id = b.id AND l.tenant_id = $2 AND l.status = 'active' AND l.accessible = true) AS accessible_rooms
       FROM campus_locations b
       WHERE b.tenant_id = $1 AND b.type = 'building' AND b.status = 'active'
       ORDER BY b.name`, [tid, tid]
    );

    let body = SKIP + navBar('Directory') + `
      <div ${CARD}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0;color:${P}">🏢 Building Directory</h2>
          <div style="color:${GRAY};font-size:0.85em">${buildings.length} buildings</div>
        </div>`;
    if (buildings.length) {
      body += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">';
      buildings.forEach(b => {
        const facs = Array.isArray(b.facilities) ? b.facilities.slice(0, 4) : [];
        body += `
          <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
            ${b.photo_url ? '<img src="'+esc(b.photo_url)+'" alt="'+esc(b.name)+'" style="width:100%;height:140px;object-fit:cover" onerror="this.style.display=\'none\'">' : '<div style="width:100%;height:60px;background:#dbeafe"></div>'}
            <div style="padding:14px">
              <a href="/school/campus-map/details/${b.id}" style="color:${P};text-decoration:none;font-weight:700;font-size:1.1em">${esc(b.name)}</a>
              ${b.description ? '<p style="margin:4px 0 0;color:'+GRAY+';font-size:0.8em">'+esc(b.description.substring(0,80))+'</p>' : ''}
              <div style="display:flex;gap:12px;margin-top:8px;font-size:0.8em;color:${GRAY}">
                <span>🚪 ${b.room_count} rooms</span>
                <span>👥 ${b.total_capacity} cap</span>
                ${b.accessible_rooms > 0 ? '<span style="color:'+GREEN+'">♿ '+b.accessible_rooms+'</span>' : ''}
              </div>
              ${facs.length ? '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">'+facs.map(f => '<span style="padding:2px 8px;border-radius:6px;font-size:0.7em;background:#f0fdf4;color:#166534">'+esc(f)+'</span>').join('')+'</div>' : ''}
              ${b.floor_plan_url ? '<div style="margin-top:8px"><a href="/school/campus-map/details/'+b.id+'" style="color:'+P+';font-size:0.8em;text-decoration:none">📐 View Floor Plan</a></div>' : ''}
            </div>
          </div>`;
      });
      body += '</div>';
    } else {
      body += '<p style="text-align:center;color:'+GRAY+';padding:30px">No buildings added yet. <a href="/school/campus-map/locations/new" style="color:'+P+'">Add a building.</a></p>';
    }
    body += '</div>';
    res.send(renderPage('Building Directory', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 16 — POI Management
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/poi', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [pois] = await pool.query(
      `SELECT p.*, l.name AS location_name FROM campus_poi p
       LEFT JOIN campus_locations l ON l.id = p.location_id
       WHERE p.tenant_id = $1 ORDER BY p.poi_type, p.label`, [tid]
    );
    const [locs] = await pool.query(
      'SELECT id, name FROM campus_locations WHERE tenant_id = $1 AND status = $2 ORDER BY name', [tid, 'active']
    );
    const poiTypes = ['info','water','restroom','elevator','exit','first_aid','parking','food','atm','shelter','recycling','wifi','phone','aeds','security'];
    const iconOptions = ['📍','💧','🚻','🛗','🚪','🩹','🅿️','🍔','🏧','⛺','♻️','📶','📞','🫀','🛡️','⚠️','🔥','🌿'];

    let body = SKIP + navBar('POIs') + `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div ${CARD}>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h2 style="margin:0;color:${P}">📌 Points of Interest (${pois.length})</h2>
          </div>`;
    if (pois.length) {
      body += '<table><tr><th>Icon</th><th>Label</th><th>Type</th><th>Location</th><th>Coords</th><th>Actions</th></tr>';
      pois.forEach(p => {
        const c = p.svg_coords || {};
        body += `<tr>
          <td style="font-size:1.5em">${p.icon||'📍'}</td>
          <td><strong>${esc(p.label)}</strong>${p.description ? '<br><small style="color:'+GRAY+'">'+esc(p.description.substring(0,50))+'</small>' : ''}</td>
          <td>${badge(p.poi_type, AMBER)}</td>
          <td>${p.location_id ? '<a href="/school/campus-map/details/'+p.location_id+'" style="color:'+P+';text-decoration:none">'+esc(p.location_name||'Link')+'</a>' : '—'}</td>
          <td style="font-size:0.8em;color:${GRAY}">(${c.x||0}, ${c.y||0})</td>
          <td>
            <form method="POST" action="/school/campus-map/poi/${p.id}/delete" style="display:inline" onsubmit="return confirm('Delete this POI?')">
              <button style="background:none;border:none;color:${RED};cursor:pointer;padding:0">Delete</button>
            </form>
          </td></tr>`;
      });
      body += '</table>';
    } else {
      body += '<p style="text-align:center;color:'+GRAY+';padding:20px">No POIs defined. Add points of interest to the campus map.</p>';
    }
    body += '</div>';

    body += `<div ${CARD}>
      <h3 style="color:${P};margin:0 0 12px">➕ Add POI</h3>
      <form method="POST" action="/school/campus-map/poi/save">
        <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Label *</label>
          <input name="label" required placeholder="e.g. Water Fountain"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div><label style="font-weight:600;display:block;margin-bottom:4px">Icon</label>
            <select name="icon">${iconOptions.map(i => '<option value="'+i+'">'+i+'</option>').join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:4px">Type</label>
            <select name="poi_type">${poiTypes.map(t => '<option value="'+t+'">'+t.charAt(0).toUpperCase()+t.slice(1)+'</option>').join('')}</select></div>
        </div>
        <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Location</label>
          <select name="location_id"><option value="">— None —</option>${locs.map(l => '<option value="'+l.id+'">'+esc(l.name)+'</option>').join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG X</label><input name="svg_x" type="number" value="50"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:4px">SVG Y</label><input name="svg_y" type="number" value="50"></div>
        </div>
        <div style="margin-bottom:10px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
          <textarea name="description" rows="2"></textarea></div>
        <button type="submit" class="btn">Add POI</button>
      </form>
    </div></div>`;
    res.send(renderPage('Points of Interest', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 17 — Save POI
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/poi/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { label, icon, poi_type, location_id, svg_x, svg_y, description } = req.body;
    if (!label || !label.trim()) return res.send('<p style="color:red;padding:20px">Label is required.</p><a href="javascript:history.back()">Go back</a>');
    const svgCoords = JSON.stringify({ x: parseInt(svg_x)||50, y: parseInt(svg_y)||50 });
    await pool.query(
      `INSERT INTO campus_poi (tenant_id, location_id, poi_type, icon, label, description, svg_coords)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tid, location_id||null, poi_type||'info', icon||'📍', label.trim(), description||null, svgCoords]
    );
    res.redirect('/school/campus-map/poi');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 18 — Delete POI
     ═══════════════════════════════════════════════════════════════════ */
  app.post('/school/campus-map/poi/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM campus_poi WHERE id = $1 AND tenant_id = $2', [req.params.id, tid]);
    res.redirect('/school/campus-map/poi');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 19 — Virtual Tour Mode
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/tour', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const step = parseInt(req.query.step) || 0;
    const [locs] = await pool.query(
      'SELECT id, name, type, description, photo_url, svg_coords, capacity, accessible, facilities FROM campus_locations WHERE tenant_id = $1 AND status = $2 ORDER BY type, name',
      [tid, 'active']
    );
    const loc = locs[step];
    const total = locs.length;
    const facs = loc && Array.isArray(loc.facilities) ? loc.facilities : [];
    const c = loc ? (loc.svg_coords || {}) : {};
    const hasPhoto = loc && loc.photo_url;

    let body = SKIP + navBar('Virtual Tour') + `
      <div style="background:linear-gradient(135deg,#ede9fe,#e0e7ff);border-radius:16px;padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0;color:${P}">🎬 Virtual Campus Tour</h2>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="color:${GRAY};font-size:0.9em">${step + 1} / ${total}</span>
            <div style="background:#e5e7eb;border-radius:8px;height:6px;width:120px;overflow:hidden">
              <div style="height:100%;width:${total>0?((step+1)/total*100):0}%;background:${P};border-radius:8px;transition:width 0.3s"></div>
            </div>
          </div>
        </div>`;

    if (loc) {
      body += `<div style="display:grid;grid-template-columns:${hasPhoto?'2fr':'1fr'} 1fr;gap:20px">
        <div style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
          ${hasPhoto ? '<img src="'+esc(loc.photo_url)+'" alt="'+esc(loc.name)+'" style="width:100%;max-height:350px;object-fit:cover" onerror="this.style.display=\'none\'">' : '<div style="height:120px;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:3em">'+typeIcon(loc.type)+'</div>'}
          <div style="padding:20px">
            <h3 style="color:${P};margin:0 0 8px">${typeIcon(loc.type)} ${esc(loc.name)}</h3>
            <div style="margin-bottom:8px">${badge(loc.type, BLUE)} ${loc.accessible ? badge('♿ Accessible', GREEN) : ''} ${loc.capacity ? badge('👥 '+loc.capacity, '#0891b2') : ''}</div>
            <p style="color:#374151;margin:0">${esc(loc.description || 'No description available for this location.')}</p>
            ${facs.length ? '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">'+facs.map(f => '<span style="padding:3px 10px;border-radius:6px;font-size:0.8em;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0">'+esc(f)+'</span>').join('')+'</div>' : ''}
            <div style="margin-top:16px">
              <a href="/school/campus-map/details/${loc.id}" class="btn" style="display:inline-block">View Full Details</a>
            </div>
          </div>
        </div>
        <div>
          <div style="background:white;border-radius:12px;padding:16px;border:1px solid #e5e7eb">
            <h4 style="color:${P};margin:0 0 10px">📍 Map Position</h4>
            <div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center">
              <svg viewBox="0 0 200 150" style="width:100%;height:auto">
                <rect width="200" height="150" fill="#f0fdf4"/>
                <line x1="20" y1="75" x2="180" y2="75" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>
                <line x1="100" y1="15" x2="100" y2="135" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round"/>
                <circle cx="${(c.x||100)*200/900}" cy="${(c.y||100)*150/600}" r="8" fill="${RED}" opacity="0.8">
                  <animate attributeName="r" values="8;12;8" dur="2s" repeatCount="indefinite"/>
                </circle>
              </svg>
            </div>
          </div>
          <div style="margin-top:12px;background:white;border-radius:12px;padding:16px;border:1px solid #e5e7eb">
            <h4 style="color:${P};margin:0 0 8px">📋 Tour Stops</h4>
            <div style="max-height:200px;overflow-y:auto">
              ${locs.map((l, i) => '<div style="padding:4px 0;'+(i===step?'font-weight:bold;color:'+P+';background:#ede9fe;margin:0 -8px;padding:4px 8px;border-radius:4px':'color:'+GRAY)+';font-size:0.8em;cursor:pointer">'+(i+1)+'. '+typeIcon(l.type)+' '+esc(l.name)+'</div>').join('')}
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:16px">
        ${step > 0 ? '<a href="/school/campus-map/tour?step='+(step-1)+'" class="btn" style="background:'+GRAY+'">&larr; Previous</a>' : '<span></span>'}
        ${step < total - 1 ? '<a href="/school/campus-map/tour?step='+(step+1)+'" class="btn">Next &rarr;</a>' : '<a href="/school/campus-map" class="btn" style="background:'+GREEN+'">✅ Finish Tour</a>'}
      </div>`;
    } else {
      body += `<div style="text-align:center;padding:40px;background:white;border-radius:12px;border:1px solid #e5e7eb">
        <div style="font-size:3em;margin-bottom:12px">🗺️</div>
        <h3 style="color:${P}">No locations to tour</h3>
        <p style="color:${GRAY}">Add campus locations to start the virtual tour.</p>
        <a href="/school/campus-map/locations/new" class="btn" style="display:inline-block;margin-top:12px">+ Add Location</a>
      </div>`;
    }
    body += '</div>';
    res.send(renderPage('Virtual Tour', body, req.session.user, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     ROUTE 20 — API: Search Locations (JSON)
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/campus-map/api/search', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);
    const [rows] = await pool.query(
      `SELECT id, name, type, svg_coords, accessible, capacity, floor, building_id,
              photo_url, description
       FROM campus_locations WHERE tenant_id = $1 AND status = $2
       AND (name ILIKE $3 OR type ILIKE $3)
       ORDER BY name LIMIT 20`,
      [tid, 'active', '%' + q + '%']
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, type: r.type, accessible: r.accessible,
      capacity: r.capacity, floor: r.floor, svg_coords: r.svg_coords,
      photo_url: r.photo_url, description: r.description,
      url: '/school/campus-map/details/' + r.id
    })));
  }));

  console.log('[CampusMap] Module loaded — /school/campus-map');
};
