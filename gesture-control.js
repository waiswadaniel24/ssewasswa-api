module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS gesture_mappings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, gesture_name VARCHAR(100) NOT NULL,
        action VARCHAR(200) NOT NULL, target_device VARCHAR(100), sensitivity INT DEFAULT 70,
        enabled BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS gesture_logs (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT,
        gesture VARCHAR(100) NOT NULL, action VARCHAR(200), confidence DECIMAL(5,2),
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS gesture_presets (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(150) NOT NULL,
        gestures JSONB DEFAULT '[]', created_by INT, shared BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[gesture-control] OK');
    } catch(e) { console.warn('[gesture-control] Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/gesture-control', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const [mappings, recentLogs, presets] = await Promise.all([
        pool.query('SELECT * FROM gesture_mappings WHERE tenant_id=$1 ORDER BY gesture_name', [tid]),
        pool.query('SELECT gl.*, u.name AS user_name FROM gesture_logs gl LEFT JOIN users u ON u.id=gl.user_id WHERE gl.tenant_id=$1 ORDER BY gl.timestamp DESC LIMIT 50', [tid]),
        pool.query('SELECT gp.*, u.name AS creator_name FROM gesture_presets gp LEFT JOIN users u ON u.id=gp.created_by WHERE gp.tenant_id=$1 ORDER BY gp.created_at DESC', [tid])
      ]);
      const totalGestures = mappings.rows.length;
      const enabledGestures = mappings.rows.filter(m => m.enabled).length;
      const todayLogs = (await pool.query("SELECT COUNT(*) FROM gesture_logs WHERE tenant_id=$1 AND timestamp::date=NOW()::date", [tid])).rows[0].count;
      const avgConfidence = (await pool.query("SELECT ROUND(AVG(confidence)::numeric,1) FROM gesture_logs WHERE tenant_id=$1 AND confidence IS NOT NULL", [tid])).rows[0].round;

      res.send(renderPage(req, 'Gesture Control Center', SKIP + `
        <div class="page-head"><h2>Gesture Control Center</h2>
          <a href="/school/gesture-control/mappings/new" class="btn">+ New Gesture Mapping</a>
          <a href="/school/gesture-control/presets/new" class="btn" style="background:#059669">+ Create Preset</a>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${totalGestures}</div><div style="color:${GRAY}">Total Mappings</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#059669">${enabledGestures}</div><div style="color:${GRAY}">Active Gestures</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#f59e0b">${todayLogs}</div><div style="color:${GRAY}">Today's Recognitions</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#8b5cf6">${avgConfidence || 0}%</div><div style="color:${GRAY}">Avg Confidence</div></div>
        </div>
        <div class="card"><h3>Active Gesture Mappings</h3>
          <table><thead><tr><th>Gesture</th><th>Action</th><th>Device</th><th>Sensitivity</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${mappings.rows.map(m => `<tr>
            <td><strong>${esc(m.gesture_name)}</strong></td>
            <td>${esc(m.action)}</td>
            <td>${esc(m.target_device || '-')}</td>
            <td>${m.sensitivity}%</td>
            <td><span style="color:${m.enabled ? '#059669' : '#ef4444'}">${m.enabled ? 'Active' : 'Disabled'}</span></td>
            <td><a href="/school/gesture-control/mappings/${m.id}/edit" class="btn" style="padding:4px 10px;font-size:12px">Edit</a>
                <form method="POST" action="/school/gesture-control/mappings/${m.id}/toggle" style="display:inline">
                  <button class="btn" style="padding:4px 10px;font-size:12px;background:${m.enabled ? '#f59e0b' : '#059669'}">${m.enabled ? 'Disable' : 'Enable'}</button></form></td>
          </tr>`).join('')}</tbody></table>
        </div>
        <div class="card"><h3>Recent Recognition Logs</h3>
          <table><thead><tr><th>Time</th><th>User</th><th>Gesture</th><th>Action</th><th>Confidence</th></tr></thead>
          <tbody>${recentLogs.rows.map(l => `<tr>
            <td>${new Date(l.timestamp).toLocaleString()}</td>
            <td>${esc(l.user_name || 'Anonymous')}</td>
            <td>${esc(l.gesture)}</td>
            <td>${esc(l.action || '-')}</td>
            <td><span style="color:${(l.confidence||0) > 80 ? '#059669' : (l.confidence||0) > 50 ? '#f59e0b' : '#ef4444'}">${l.confidence || 0}%</span></td>
          </tr>`).join('')}</tbody></table>
        </div>
        <div class="card"><h3>Gesture Presets Library</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
            ${presets.rows.map(p => `<div class="card" style="margin:0">
              <h4>${esc(p.name)}</h4>
              <p style="color:${GRAY};font-size:13px">${(p.gestures || []).length} gestures &middot; ${p.shared ? 'Shared' : 'Private'}</p>
              <p style="color:${GRAY};font-size:12px">By ${esc(p.creator_name || 'System')}</p>
              <a href="/school/gesture-control/presets/${p.id}/view" class="btn" style="padding:4px 12px;font-size:12px">View</a>
            </div>`).join('')}
          </div>
        </div>
      `, { nav: 'gesture-control' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── Analytics ─── */
  app.get('/school/gesture-control/analytics', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const hourly = await pool.query(`
        SELECT EXTRACT(HOUR FROM timestamp) AS hr, COUNT(*) AS cnt, ROUND(AVG(confidence)::numeric,1) AS avg_conf
        FROM gesture_logs WHERE tenant_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY hr ORDER BY hr`, [tid]);
      const byGesture = await pool.query(`
        SELECT gesture, COUNT(*) AS cnt, ROUND(AVG(confidence)::numeric,1) AS avg_conf
        FROM gesture_logs WHERE tenant_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY gesture ORDER BY cnt DESC LIMIT 20`, [tid]);
      const byUser = await pool.query(`
        SELECT u.name, COUNT(*) AS cnt, ROUND(AVG(gl.confidence)::numeric,1) AS avg_conf
        FROM gesture_logs gl JOIN users u ON u.id=gl.user_id
        WHERE gl.tenant_id=$1 AND gl.timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY u.name ORDER BY cnt DESC LIMIT 15`, [tid]);
      const topActions = await pool.query(`
        SELECT action, COUNT(*) AS cnt FROM gesture_logs
        WHERE tenant_id=$1 AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY action ORDER BY cnt DESC LIMIT 10`, [tid]);
      const maxHr = Math.max(...hourly.rows.map(r => parseInt(r.cnt)), 1);

      res.send(renderPage(req, 'Gesture Analytics', SKIP + `
        <div class="page-head"><h2>Gesture Analytics</h2>
          <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3>Hourly Usage (7 days)</h3>
            <div style="display:flex;align-items:flex-end;gap:4px;height:180px">
              ${hourly.rows.map(r => `<div title="${r.hr}:00 - ${r.cnt} events" style="flex:1;background:${P};height:${(parseInt(r.cnt)/maxHr)*100}%;min-height:4px;border-radius:4px 4px 0 0" data-hr="${r.hr}"></div>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:${GRAY};margin-top:4px">
              ${[0,4,8,12,16,20,23].map(h => `<span>${h}h</span>`).join('')}</div>
          </div>
          <div class="card"><h3>Top Gestures (7 days)</h3>
            <table><thead><tr><th>Gesture</th><th>Count</th><th>Avg Confidence</th></tr></thead>
            <tbody>${byGesture.rows.map(g => `<tr><td>${esc(g.gesture)}</td><td>${g.cnt}</td>
              <td><span style="color:${(g.avg_conf||0)>80?'#059669':(g.avg_conf||0)>50?'#f59e0b':'#ef4444'}">${g.avg_conf||0}%</span></td></tr>`).join('')}</tbody></table>
          </div>
          <div class="card"><h3>Usage by User (7 days)</h3>
            <table><thead><tr><th>User</th><th>Recognitions</th><th>Avg Confidence</th></tr></thead>
            <tbody>${byUser.rows.map(u => `<tr><td>${esc(u.name)}</td><td>${u.cnt}</td><td>${u.avg_conf||0}%</td></tr>`).join('')}</tbody></table>
          </div>
          <div class="card"><h3>Top Actions Triggered (7 days)</h3>
            <table><thead><tr><th>Action</th><th>Trigger Count</th></tr></thead>
            <tbody>${topActions.rows.map(a => `<tr><td>${esc(a.action)}</td><td>${a.cnt}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>
      `, { nav: 'gesture-control' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── New Mapping Form ─── */
  app.get('/school/gesture-control/mappings/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'New Gesture Mapping', SKIP + `
      <div class="page-head"><h2>New Gesture Mapping</h2>
        <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/gesture-control/mappings">
          <div style="margin-bottom:12px"><label>Gesture Name</label>
            <input name="gesture_name" placeholder="e.g. open_palm, thumbs_up, swipe_left" required></div>
          <div style="margin-bottom:12px"><label>Action</label>
            <select name="action" required>
              <option value="next_slide">Next Slide</option>
              <option value="prev_slide">Previous Slide</option>
              <option value="volume_up">Volume Up</option>
              <option value="volume_down">Volume Down</option>
              <option value="play_pause">Play / Pause</option>
              <option value="fullscreen">Toggle Fullscreen</option>
              <option value="mute">Mute / Unmute</option>
              <option value="whiteboard_clear">Clear Whiteboard</option>
              <option value="pointer_mode">Pointer Mode</option>
              <option value="draw_mode">Draw Mode</option>
              <option value="zoom_in">Zoom In</option>
              <option value="zoom_out">Zoom Out</option>
              <option value="custom">Custom Action</option>
            </select></div>
          <div style="margin-bottom:12px"><label>Custom Action URL/Command</label>
            <input name="custom_action" placeholder="Optional - for custom actions"></div>
          <div style="margin-bottom:12px"><label>Target Device</label>
            <select name="target_device">
              <option value="smart_board">Smart Board</option>
              <option value="projector">Projector</option>
              <option value="computer">Teacher Computer</option>
              <option value="speakers">Classroom Speakers</option>
              <option value="lights">Smart Lights</option>
              <option value="all">All Devices</option>
            </select></div>
          <div style="margin-bottom:12px"><label>Sensitivity (30-100%)</label>
            <input type="range" name="sensitivity" min="30" max="100" value="70" oninput="this.nextElementSibling.textContent=this.value+'%'">
            <span style="color:${GRAY}">70%</span></div>
          <div style="margin-bottom:12px"><label><input type="checkbox" name="enabled" checked> Enabled</label></div>
          <button type="submit" class="btn">Create Mapping</button>
        </form>
      </div>
    `, { nav: 'gesture-control' }));
  });

  /* ─── Create Mapping ─── */
  app.post('/school/gesture-control/mappings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { gesture_name, action, custom_action, target_device, sensitivity, enabled } = req.body;
    const finalAction = action === 'custom' ? custom_action : action;
    await pool.query(
      'INSERT INTO gesture_mappings (tenant_id, gesture_name, action, target_device, sensitivity, enabled) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, gesture_name, finalAction, target_device, sensitivity || 70, !!enabled]
    );
    audit(req, 'gesture_mapping_created', { gesture_name, action: finalAction });
    req.flash('success', 'Gesture mapping created');
    res.redirect('/school/gesture-control');
  }));

  /* ─── Edit Mapping Form ─── */
  app.get('/school/gesture-control/mappings/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const m = (await pool.query('SELECT * FROM gesture_mappings WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!m) return res.status(404).send('Not found');
    res.send(renderPage(req, 'Edit Gesture Mapping', SKIP + `
      <div class="page-head"><h2>Edit: ${esc(m.gesture_name)}</h2>
        <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/gesture-control/mappings/${m.id}">
          <input type="hidden" name="_method" value="PUT">
          <div style="margin-bottom:12px"><label>Gesture Name</label>
            <input name="gesture_name" value="${esc(m.gesture_name)}" required></div>
          <div style="margin-bottom:12px"><label>Action</label>
            <input name="action" value="${esc(m.action)}" required></div>
          <div style="margin-bottom:12px"><label>Target Device</label>
            <select name="target_device">
              ${['smart_board','projector','computer','speakers','lights','all'].map(d =>
                `<option value="${d}" ${d===m.target_device?'selected':''}>${d.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label>Sensitivity (30-100%)</label>
            <input type="range" name="sensitivity" min="30" max="100" value="${m.sensitivity}" oninput="this.nextElementSibling.textContent=this.value+'%'">
            <span style="color:${GRAY}">${m.sensitivity}%</span></div>
          <div style="margin-bottom:12px"><label><input type="checkbox" name="enabled" ${m.enabled?'checked':''}> Enabled</label></div>
          <button type="submit" class="btn">Update Mapping</button>
        </form>
      </div>
    `, { nav: 'gesture-control' }));
  });

  /* ─── Update Mapping ─── */
  app.post('/school/gesture-control/mappings/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { gesture_name, action, target_device, sensitivity, enabled } = req.body;
    await pool.query(
      'UPDATE gesture_mappings SET gesture_name=$1, action=$2, target_device=$3, sensitivity=$4, enabled=$5 WHERE id=$6 AND tenant_id=$7',
      [gesture_name, action, target_device, sensitivity, !!enabled, req.params.id, tid]
    );
    audit(req, 'gesture_mapping_updated', { id: req.params.id });
    req.flash('success', 'Mapping updated');
    res.redirect('/school/gesture-control');
  }));

  /* ─── Toggle Mapping ─── */
  app.post('/school/gesture-control/mappings/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query('UPDATE gesture_mappings SET enabled = NOT enabled WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'gesture_mapping_toggled', { id: req.params.id });
    res.redirect('/school/gesture-control');
  }));

  /* ─── Delete Mapping ─── */
  app.post('/school/gesture-control/mappings/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query('DELETE FROM gesture_mappings WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'gesture_mapping_deleted', { id: req.params.id });
    req.flash('success', 'Mapping deleted');
    res.redirect('/school/gesture-control');
  }));

  /* ─── New Preset Form ─── */
  app.get('/school/gesture-control/presets/new', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const mappings = (await pool.query('SELECT gesture_name, action, target_device, sensitivity FROM gesture_mappings WHERE tenant_id=$1 AND enabled=true', [tid])).rows;
    res.send(renderPage(req, 'Create Gesture Preset', SKIP + `
      <div class="page-head"><h2>Create Gesture Preset</h2>
        <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:700px">
        <form method="POST" action="/school/gesture-control/presets">
          <div style="margin-bottom:12px"><label>Preset Name</label>
            <input name="name" placeholder="e.g. Presentation Mode, Science Lab Controls" required></div>
          <div style="margin-bottom:12px"><label>Select Gestures to Include</label>
            <div style="max-height:250px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px">
              ${mappings.map(m => `<label style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid #f3f4f6">
                <input type="checkbox" name="gestures" value='${JSON.stringify(m)}'> 
                <strong>${esc(m.gesture_name)}</strong> &rarr; ${esc(m.action)} (${m.sensitivity}%)
              </label>`).join('')}
              ${mappings.length === 0 ? '<p style="color:'+GRAY+';text-align:center;padding:20px">No active mappings. Create mappings first.</p>' : ''}
            </div></div>
          <div style="margin-bottom:12px"><label><input type="checkbox" name="shared"> Share with other teachers</label></div>
          <button type="submit" class="btn">Save Preset</button>
        </form>
      </div>
    `, { nav: 'gesture-control' }));
  });

  /* ─── Create Preset ─── */
  app.post('/school/gesture-control/presets', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, shared, gestures } = req.body;
    const gestureArr = Array.isArray(gestures) ? gestures.map(g => typeof g === 'string' ? JSON.parse(g) : g) : (gestures ? [JSON.parse(gestures)] : []);
    await pool.query(
      'INSERT INTO gesture_presets (tenant_id, name, gestures, created_by, shared) VALUES ($1,$2,$3,$4,$5)',
      [tid, name, JSON.stringify(gestureArr), req.user.id, !!shared]
    );
    audit(req, 'gesture_preset_created', { name, gesture_count: gestureArr.length });
    req.flash('success', 'Preset created');
    res.redirect('/school/gesture-control');
  }));

  /* ─── View Preset ─── */
  app.get('/school/gesture-control/presets/:id/view', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const p = (await pool.query('SELECT gp.*, u.name AS creator_name FROM gesture_presets gp LEFT JOIN users u ON u.id=gp.created_by WHERE gp.id=$1 AND gp.tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!p) return res.status(404).send('Not found');
    const gestures = p.gestures || [];
    res.send(renderPage(req, 'Preset: ' + p.name, SKIP + `
      <div class="page-head"><h2>${esc(p.name)}</h2>
        <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:700px">
        <p style="color:${GRAY};margin-bottom:12px">Created by ${esc(p.creator_name||'System')} &middot; ${p.shared ? 'Shared' : 'Private'} &middot; ${new Date(p.created_at).toLocaleDateString()}</p>
        <h3>Gestures (${gestures.length})</h3>
        <table><thead><tr><th>Gesture</th><th>Action</th><th>Device</th><th>Sensitivity</th></tr></thead>
        <tbody>${gestures.map(g => `<tr>
          <td><strong>${esc(g.gesture_name)}</strong></td>
          <td>${esc(g.action)}</td>
          <td>${esc(g.target_device || '-')}</td>
          <td>${g.sensitivity}%</td>
        </tr>`).join('')}
        ${gestures.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No gestures in this preset</td></tr>' : ''}
        </tbody></table>
        <div style="margin-top:16px">
          <button class="btn" onclick="activatePreset(${p.id})">Activate Preset</button>
          <form method="POST" action="/school/gesture-control/presets/${p.id}/delete" style="display:inline">
            <button class="btn" style="background:#ef4444">Delete Preset</button></form>
        </div>
      </div>
      <script>
        async function activatePreset(id) {
          if (!confirm('Activate this preset? This will enable all included gesture mappings.')) return;
          await fetch('/school/gesture-control/presets/'+id+'/activate', {method:'POST',headers:{'Content-Type':'application/json'}});
          location.href = '/school/gesture-control';
        }
      </script>
    `, { nav: 'gesture-control' }));
  });

  /* ─── Activate Preset ─── */
  app.post('/school/gesture-control/presets/:id/activate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const p = (await pool.query('SELECT gestures FROM gesture_presets WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!p) return res.json({ error: 'Not found' });
    const gestures = p.gestures || [];
    for (const g of gestures) {
      await pool.query(
        'UPDATE gesture_mappings SET enabled=true WHERE tenant_id=$1 AND gesture_name=$2',
        [tid, g.gesture_name]
      );
    }
    audit(req, 'gesture_preset_activated', { preset_id: req.params.id, gesture_count: gestures.length });
    res.json({ success: true, activated: gestures.length });
  }));

  /* ─── Delete Preset ─── */
  app.post('/school/gesture-control/presets/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query('DELETE FROM gesture_presets WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'gesture_preset_deleted', { id: req.params.id });
    req.flash('success', 'Preset deleted');
    res.redirect('/school/gesture-control');
  }));

  /* ─── Gesture Log API (for real-time logging from devices) ─── */
  app.post('/school/gesture-control/api/log', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { gesture, action, confidence } = req.body;
    await pool.query(
      'INSERT INTO gesture_logs (tenant_id, user_id, gesture, action, confidence) VALUES ($1,$2,$3,$4,$5)',
      [tid, req.user.id, gesture, action, confidence || null]
    );
    // Find matching mapping and trigger action
    const mapping = (await pool.query(
      'SELECT * FROM gesture_mappings WHERE tenant_id=$1 AND gesture_name=$2 AND enabled=true',
      [tid, gesture]
    )).rows[0];
    if (mapping) {
      audit(req, 'gesture_recognized', { gesture, action: mapping.action, confidence, device: mapping.target_device });
    }
    res.json({ logged: true, mapping_found: !!mapping, action: mapping ? mapping.action : null });
  }));

  /* ─── Accessibility Gestures Page ─── */
  app.get('/school/gesture-control/accessibility', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const accessMappings = (await pool.query(
      "SELECT * FROM gesture_mappings WHERE tenant_id=$1 AND (action LIKE '%accessibility%' OR action LIKE '%magnify%' OR action LIKE '%narrate%' OR action LIKE '%contrast%' OR gesture_name LIKE '%access%')",
      [tid]
    )).rows;
    res.send(renderPage(req, 'Accessibility Gestures', SKIP + `
      <div class="page-head"><h2>Accessibility Gestures</h2>
        <a href="/school/gesture-control" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card">
        <h3>Inclusive Gesture Controls</h3>
        <p style="color:${GRAY};margin-bottom:16px">Configure gestures that assist students with disabilities in classroom interaction.</p>
        <table><thead><tr><th>Gesture</th><th>Action</th><th>Target</th><th>Status</th></tr></thead>
        <tbody>${accessMappings.map(m => `<tr>
          <td>${esc(m.gesture_name)}</td><td>${esc(m.action)}</td>
          <td>${esc(m.target_device||'-')}</td>
          <td><span style="color:${m.enabled?'#059669':'#ef4444'}">${m.enabled?'Active':'Disabled'}</span></td>
        </tr>`).join('')}
        ${accessMappings.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No accessibility gestures configured</td></tr>' : ''}
        </tbody></table>
        <h4 style="margin-top:20px">Recommended Accessibility Gestures</h4>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px">
          ${[{g:'slow_wave',a:'Activate Screen Reader',d:'Assists visually impaired'},{g:'two_hands_up',a:'Increase Font Size',d:'Low vision support'},
            {g:'closed_fist',a:'High Contrast Mode',d:'Visual impairment aid'},{g:'head_nod',a:'Confirm / Select',d:'Motor accessibility'},
            {g:'open_palm_hold',a:'Pause All Media',d:'Sensory overload support'},{g:'peace_sign',a:'Toggle Captions',d:'Hearing impairment support'}
          ].map(r => `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px">
            <strong>${r.g}</strong> <span style="color:${GRAY}">&rarr; ${r.a}</span>
            <p style="font-size:12px;color:${GRAY};margin:4px 0 0">${r.d}</p>
          </div>`).join('')}
        </div>
      </div>
    `, { nav: 'gesture-control' }));
  });
};
