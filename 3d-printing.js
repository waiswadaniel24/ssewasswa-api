module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#374151}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS print_jobs (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT,
        printer_id INT, model_name VARCHAR(200) NOT NULL, file_url TEXT,
        material VARCHAR(50), status VARCHAR(30) DEFAULT 'queued',
        print_time_min INT, quality_score DECIMAL(3,1), cost DECIMAL(8,2),
        notes TEXT, reviewed_by INT, created_at TIMESTAMPTZ DEFAULT NOW(),
        started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS printers_3d (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(100) NOT NULL,
        model VARCHAR(100), location VARCHAR(150), status VARCHAR(30) DEFAULT 'available',
        total_print_hours DECIMAL(8,1) DEFAULT 0, last_maintenance DATE,
        firmware_version VARCHAR(50), build_volume TEXT, nozzle_diameter DECIMAL(3,2) DEFAULT 0.4
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS filament_inventory (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, color VARCHAR(50) NOT NULL,
        material_type VARCHAR(50) NOT NULL, weight_remaining_grams DECIMAL(8,1),
        cost_per_gram DECIMAL(6,4), status VARCHAR(30) DEFAULT 'available',
        supplier VARCHAR(100), batch_number VARCHAR(50), expiry_date DATE,
        added_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS model_library (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(200) NOT NULL,
        description TEXT, category VARCHAR(100), file_url TEXT,
        thumbnail_url TEXT, difficulty VARCHAR(20) DEFAULT 'beginner',
        created_by INT, downloads INT DEFAULT 0,
        estimated_print_time_min INT, estimated_material_grams DECIMAL(8,1),
        tags TEXT[], created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[3d-printing] OK');
    } catch(e) { console.warn('[3d-printing] Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/3d-printing', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const [jobs, printers, filaments, models] = await Promise.all([
        pool.query(`SELECT pj.*, u.name AS student_name, p3.name AS printer_name
          FROM print_jobs pj LEFT JOIN users u ON u.id=pj.student_id
          LEFT JOIN printers_3d p3 ON p3.id=pj.printer_id
          WHERE pj.tenant_id=$1 ORDER BY pj.created_at DESC LIMIT 30`, [tid]),
        pool.query('SELECT * FROM printers_3d WHERE tenant_id=$1 ORDER BY name', [tid]),
        pool.query('SELECT * FROM filament_inventory WHERE tenant_id=$1 ORDER BY material_type, color', [tid]),
        pool.query('SELECT ml.*, u.name AS creator_name FROM model_library ml LEFT JOIN users u ON u.id=ml.created_by WHERE ml.tenant_id=$1 ORDER BY ml.created_at DESC LIMIT 20', [tid])
      ]);
      const queued = jobs.rows.filter(j => j.status === 'queued').length;
      const printing = jobs.rows.filter(j => j.status === 'printing').length;
      const completed = jobs.rows.filter(j => j.status === 'completed').length;
      const avgQuality = jobs.rows.filter(j => j.quality_score).reduce((s, j) => s + parseFloat(j.quality_score), 0) / (jobs.rows.filter(j => j.quality_score).length || 1);
      const totalFilament = filaments.rows.reduce((s, f) => s + parseFloat(f.weight_remaining_grams || 0), 0);
      const statusBadge = s => {
        const map = { queued: 'badge-yellow', printing: 'badge-blue', completed: 'badge-green', failed: 'badge-red', cancelled: 'badge-gray', review: 'badge-yellow' };
        return `<span class="badge ${map[s] || 'badge-gray'}">${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
      };
      const printerStatusBadge = s => {
        const map = { available: 'badge-green', printing: 'badge-blue', maintenance: 'badge-red', offline: 'badge-gray' };
        return `<span class="badge ${map[s] || 'badge-gray'}">${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
      };

      res.send(renderPage(req, '3D Printing Lab', SKIP + `
        <div class="page-head">
          <h2>3D Printing Lab</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/school/3d-printing/jobs/new" class="btn">+ New Print Job</a>
            <a href="/school/3d-printing/models/new" class="btn" style="background:#059669">+ Upload Model</a>
            <a href="/school/3d-printing/printers/new" class="btn" style="background:#7c3aed">+ Add Printer</a>
            <a href="/school/3d-printing/filament/new" class="btn" style="background:#f59e0b;color:#000">+ Add Filament</a>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:1.8em;color:#f59e0b">${queued}</div><div style="color:${GRAY};font-size:13px">Queued</div></div>
          <div class="card" style="text-align:center"><div style="font-size:1.8em;color:${P}">${printing}</div><div style="color:${GRAY};font-size:13px">Printing</div></div>
          <div class="card" style="text-align:center"><div style="font-size:1.8em;color:#059669">${completed}</div><div style="color:${GRAY};font-size:13px">Completed</div></div>
          <div class="card" style="text-align:center"><div style="font-size:1.8em;color:#8b5cf6">${avgQuality.toFixed(1)}</div><div style="color:${GRAY};font-size:13px">Avg Quality</div></div>
          <div class="card" style="text-align:center"><div style="font-size:1.8em;color:#0891b2">${(totalFilament/1000).toFixed(1)}kg</div><div style="color:${GRAY};font-size:13px">Filament Stock</div></div>
        </div>

        <div class="card"><h3>Print Queue</h3>
          <table><thead><tr><th>ID</th><th>Student</th><th>Model</th><th>Printer</th><th>Material</th><th>Est. Time</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${jobs.rows.map(j => `<tr>
            <td>#${j.id}</td><td>${esc(j.student_name||'Staff')}</td><td>${esc(j.model_name)}</td>
            <td>${esc(j.printer_name||'-')}</td><td>${esc(j.material||'-')}</td>
            <td>${j.print_time_min ? j.print_time_min+'m' : '-'}</td>
            <td>${statusBadge(j.status)}</td>
            <td>
              <a href="/school/3d-printing/jobs/${j.id}" class="btn" style="padding:3px 8px;font-size:11px">View</a>
              ${j.status==='queued' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/start" style="display:inline"><button class="btn" style="padding:3px 8px;font-size:11px;background:#059669">Start</button></form>` : ''}
              ${j.status==='printing' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/complete" style="display:inline"><button class="btn" style="padding:3px 8px;font-size:11px;background:#7c3aed">Complete</button></form>` : ''}
            </td>
          </tr>`).join('')}</tbody></table>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3>Printers (${printers.rows.length})</h3>
            <table><thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Total Hours</th><th>Actions</th></tr></thead>
            <tbody>${printers.rows.map(p => `<tr>
              <td><strong>${esc(p.name)}</strong></td><td>${esc(p.location||'-')}</td>
              <td>${printerStatusBadge(p.status)}</td><td>${p.total_print_hours}h</td>
              <td><a href="/school/3d-printing/printers/${p.id}/edit" class="btn" style="padding:3px 8px;font-size:11px">Edit</a>
                  <form method="POST" action="/school/3d-printing/printers/${p.id}/maintenance" style="display:inline">
                    <button class="btn" style="padding:3px 8px;font-size:11px;background:#f59e0b;color:#000">Maint.</button></form></td>
            </tr>`).join('')}</tbody></table>
          </div>
          <div class="card"><h3>Filament Inventory</h3>
            <table><thead><tr><th>Material</th><th>Color</th><th>Remaining</th><th>Status</th></tr></thead>
            <tbody>${filaments.rows.map(f => `<tr>
              <td>${esc(f.material_type)}</td><td>${esc(f.color)}</td>
              <td>${f.weight_remaining_grams ? (f.weight_remaining_grams/1000).toFixed(2)+'kg' : '-'}</td>
              <td>${statusBadge(f.status)}</td>
            </tr>`).join('')}</tbody></table>
          </div>
        </div>

        <div class="card"><h3>Model Library</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
            ${models.rows.map(m => `<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
              ${m.thumbnail_url ? `<div style="height:120px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:${GRAY}">Preview</div>` : '<div style="height:120px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);display:flex;align-items:center;justify-content:center;color:'+P+';font-size:2rem">&#9651;</div>'}
              <div style="padding:12px">
                <strong>${esc(m.name)}</strong>
                <p style="color:${GRAY};font-size:12px">${esc(m.category||'Uncategorized')} &middot; ${m.difficulty} &middot; ${m.estimated_print_time_min ? m.estimated_print_time_min+'m' : '?'}</p>
                <p style="color:${GRAY};font-size:11px">${m.downloads} downloads &middot; ${esc(m.creator_name||'Staff')}</p>
                <a href="/school/3d-printing/models/${m.id}" class="btn" style="padding:4px 10px;font-size:11px;margin-top:6px">View</a>
              </div>
            </div>`).join('')}
          </div>
        </div>
      `, { nav: '3d-printing' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── New Print Job Form ─── */
  app.get('/school/3d-printing/jobs/new', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const [printers, filaments, models] = await Promise.all([
      pool.query("SELECT * FROM printers_3d WHERE tenant_id=$1 AND status='available'", [tid]),
      pool.query("SELECT * FROM filament_inventory WHERE tenant_id=$1 AND status='available'", [tid]),
      pool.query('SELECT id, name, estimated_print_time_min, estimated_material_grams FROM model_library WHERE tenant_id=$1 ORDER BY name', [tid])
    ]);
    res.send(renderPage(req, 'New Print Job', SKIP + `
      <div class="page-head"><h2>New Print Job</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:650px">
        <form method="POST" action="/school/3d-printing/jobs" enctype="multipart/form-data">
          <div style="margin-bottom:12px"><label>Student (optional)</label>
            <input name="student_id" type="number" placeholder="Student user ID"></div>
          <div style="margin-bottom:12px"><label>Model from Library</label>
            <select name="model_library_id" id="modelSelect" onchange="fillFromModel()">
              <option value="">-- Select or enter custom --</option>
              ${models.rows.map(m => `<option value="${m.id}" data-time="${m.estimated_print_time_min||''}" data-grams="${m.estimated_material_grams||''}">${esc(m.name)}</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label>Model Name *</label>
            <input name="model_name" id="modelName" required placeholder="e.g. Student Name - Phone Stand"></div>
          <div style="margin-bottom:12px"><label>STL File URL</label>
            <input name="file_url" placeholder="https://... or /uploads/model.stl"></div>
          <div style="margin-bottom:12px"><label>Printer</label>
            <select name="printer_id">
              <option value="">-- Auto-assign --</option>
              ${printers.rows.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.location||'')})</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label>Material</label>
            <select name="material">
              ${filaments.rows.map(f => `<option value="${f.material_type} - ${f.color}">${esc(f.material_type)} - ${esc(f.color)} (${(f.weight_remaining_grams/1000).toFixed(2)}kg)</option>`).join('')}
            </select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Estimated Print Time (min)</label>
              <input name="print_time_min" id="printTime" type="number" placeholder="120"></div>
            <div><label>Estimated Cost ($)</label>
              <input name="cost" id="estCost" type="number" step="0.01" placeholder="2.50"></div>
          </div>
          <div style="margin-bottom:12px"><label>Notes</label>
            <textarea name="notes" rows="3" placeholder="Special instructions, support settings, infill %..."></textarea></div>
          <button type="submit" class="btn">Submit Print Job</button>
        </form>
      </div>
      <script>
        function fillFromModel() {
          const sel = document.getElementById('modelSelect');
          const opt = sel.options[sel.selectedIndex];
          if (opt.value) {
            document.getElementById('modelName').value = opt.textContent;
            document.getElementById('printTime').value = opt.dataset.time || '';
          }
        }
      </script>
    `, { nav: '3d-printing' }));
  });

  /* ─── Create Print Job ─── */
  app.post('/school/3d-printing/jobs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, model_name, file_url, printer_id, material, print_time_min, cost, notes } = req.body;
    const result = await pool.query(
      'INSERT INTO print_jobs (tenant_id, student_id, model_name, file_url, printer_id, material, print_time_min, cost, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [tid, student_id || null, model_name, file_url || null, printer_id || null, material || null, print_time_min || null, cost || null, notes || null]
    );
    audit(req, 'print_job_created', { id: result.rows[0].id, model_name });
    if (printer_id) {
      await pool.query("UPDATE printers_3d SET status='printing' WHERE id=$1 AND tenant_id=$2", [printer_id, tid]);
    }
    req.flash('success', `Print job #${result.rows[0].id} queued`);
    res.redirect('/school/3d-printing');
  }));

  /* ─── View Job Detail ─── */
  app.get('/school/3d-printing/jobs/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const j = (await pool.query(`SELECT pj.*, u.name AS student_name, p3.name AS printer_name, rv.name AS reviewer_name
      FROM print_jobs pj LEFT JOIN users u ON u.id=pj.student_id
      LEFT JOIN printers_3d p3 ON p3.id=pj.printer_id
      LEFT JOIN users rv ON rv.id=pj.reviewed_by
      WHERE pj.id=$1 AND pj.tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!j) return res.status(404).send('Not found');
    const statusBadge = s => {
      const map = { queued: 'badge-yellow', printing: 'badge-blue', completed: 'badge-green', failed: 'badge-red', cancelled: 'badge-gray', review: 'badge-yellow' };
      return `<span class="badge ${map[s] || 'badge-gray'}">${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
    };
    res.send(renderPage(req, 'Job #' + j.id, SKIP + `
      <div class="page-head"><h2>Print Job #${j.id}</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div>
          <div class="card"><h3>${esc(j.model_name)}</h3>
            <table>
              <tr><td style="width:140px;color:${GRAY}">Student</td><td>${esc(j.student_name||'N/A')}</td></tr>
              <tr><td style="color:${GRAY}">Printer</td><td>${esc(j.printer_name||'Not assigned')}</td></tr>
              <tr><td style="color:${GRAY}">Material</td><td>${esc(j.material||'N/A')}</td></tr>
              <tr><td style="color:${GRAY}">Print Time</td><td>${j.print_time_min ? j.print_time_min + ' minutes' : 'N/A'}</td></tr>
              <tr><td style="color:${GRAY}">Quality Score</td><td>${j.quality_score ? j.quality_score + '/10' : 'Pending'}</td></tr>
              <tr><td style="color:${GRAY}">Cost</td><td>${j.cost ? '$' + parseFloat(j.cost).toFixed(2) : 'N/A'}</td></tr>
              <tr><td style="color:${GRAY}">Notes</td><td>${esc(j.notes||'None')}</td></tr>
              <tr><td style="color:${GRAY}">Reviewed By</td><td>${esc(j.reviewer_name||'N/A')}</td></tr>
              <tr><td style="color:${GRAY}">Created</td><td>${new Date(j.created_at).toLocaleString()}</td></tr>
              <tr><td style="color:${GRAY}">Started</td><td>${j.started_at ? new Date(j.started_at).toLocaleString() : 'Not started'}</td></tr>
              <tr><td style="color:${GRAY}">Completed</td><td>${j.completed_at ? new Date(j.completed_at).toLocaleString() : 'Not completed'}</td></tr>
            </table>
            ${j.file_url ? `<a href="${esc(j.file_url)}" target="_blank" class="btn" style="margin-top:8px">Download STL</a>` : ''}
          </div>
        </div>
        <div>
          <div class="card" style="text-align:center">
            <h3>Status</h3>
            <div style="font-size:1.5em;margin:12px 0">${statusBadge(j.status)}</div>
          </div>
          <div class="card"><h3>Actions</h3>
            ${j.status === 'queued' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/start"><button class="btn" style="width:100%;margin-bottom:6px;background:#059669">Start Printing</button></form>` : ''}
            ${j.status === 'printing' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/complete" style="margin-bottom:6px"><button class="btn" style="width:100%;background:#7c3aed">Mark Complete</button></form>
              <form method="POST" action="/school/3d-printing/jobs/${j.id}/fail" style="margin-bottom:6px"><button class="btn" style="width:100%;background:#ef4444">Mark Failed</button></form>` : ''}
            ${j.status === 'completed' || j.status === 'failed' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/review" style="margin-bottom:6px">
              <label style="font-size:13px">Quality Score (1-10)</label>
              <input name="quality_score" type="number" min="1" max="10" step="0.1" value="${j.quality_score || 5}" style="margin-bottom:4px">
              <button class="btn" style="width:100%">Submit Review</button></form>` : ''}
            ${j.status !== 'completed' && j.status !== 'cancelled' ? `<form method="POST" action="/school/3d-printing/jobs/${j.id}/cancel" style="margin-bottom:6px"><button class="btn" style="width:100%;background:#6b7280">Cancel Job</button></form>` : ''}
          </div>
        </div>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Start Job ─── */
  app.post('/school/3d-printing/jobs/:id/start', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const job = (await pool.query('SELECT * FROM print_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!job) return res.status(404).send('Not found');
    await pool.query("UPDATE print_jobs SET status='printing', started_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (job.printer_id) {
      await pool.query("UPDATE printers_3d SET status='printing' WHERE id=$1 AND tenant_id=$2", [job.printer_id, tid]);
    }
    audit(req, 'print_job_started', { id: req.params.id });
    req.flash('success', 'Job started printing');
    res.redirect('/school/3d-printing/jobs/' + req.params.id);
  }));

  /* ─── Complete Job ─── */
  app.post('/school/3d-printing/jobs/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const job = (await pool.query('SELECT * FROM print_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!job) return res.status(404).send('Not found');
    await pool.query("UPDATE print_jobs SET status='review', completed_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (job.printer_id) {
      await pool.query("UPDATE printers_3d SET status='available', total_print_hours=total_print_hours+$1 WHERE id=$2 AND tenant_id=$3",
        [((job.print_time_min || 60) / 60).toFixed(1), job.printer_id, tid]);
    }
    audit(req, 'print_job_completed', { id: req.params.id });
    req.flash('success', 'Job completed - pending review');
    res.redirect('/school/3d-printing/jobs/' + req.params.id);
  }));

  /* ─── Fail Job ─── */
  app.post('/school/3d-printing/jobs/:id/fail', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const job = (await pool.query('SELECT * FROM print_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!job) return res.status(404).send('Not found');
    await pool.query("UPDATE print_jobs SET status='failed', completed_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (job.printer_id) {
      await pool.query("UPDATE printers_3d SET status='available' WHERE id=$1 AND tenant_id=$2", [job.printer_id, tid]);
    }
    audit(req, 'print_job_failed', { id: req.params.id });
    req.flash('error', 'Job marked as failed');
    res.redirect('/school/3d-printing/jobs/' + req.params.id);
  }));

  /* ─── Review Job ─── */
  app.post('/school/3d-printing/jobs/:id/review', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { quality_score } = req.body;
    const score = Math.min(10, Math.max(1, parseFloat(quality_score) || 5));
    await pool.query("UPDATE print_jobs SET status='completed', quality_score=$1, reviewed_by=$2 WHERE id=$3 AND tenant_id=$4",
      [score, req.user.id, req.params.id, tid]);
    audit(req, 'print_job_reviewed', { id: req.params.id, score });
    req.flash('success', `Quality score: ${score}/10`);
    res.redirect('/school/3d-printing/jobs/' + req.params.id);
  }));

  /* ─── Cancel Job ─── */
  app.post('/school/3d-printing/jobs/:id/cancel', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const job = (await pool.query('SELECT * FROM print_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!job) return res.status(404).send('Not found');
    await pool.query("UPDATE print_jobs SET status='cancelled' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    if (job.printer_id && job.status === 'printing') {
      await pool.query("UPDATE printers_3d SET status='available' WHERE id=$1 AND tenant_id=$2", [job.printer_id, tid]);
    }
    audit(req, 'print_job_cancelled', { id: req.params.id });
    req.flash('success', 'Job cancelled');
    res.redirect('/school/3d-printing');
  }));

  /* ─── Add Printer Form ─── */
  app.get('/school/3d-printing/printers/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'Add 3D Printer', SKIP + `
      <div class="page-head"><h2>Add 3D Printer</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:550px">
        <form method="POST" action="/school/3d-printing/printers">
          <div style="margin-bottom:12px"><label>Printer Name *</label>
            <input name="name" required placeholder="e.g. Lab Printer 1"></div>
          <div style="margin-bottom:12px"><label>Model</label>
            <input name="model" placeholder="e.g. Creality Ender 3, Prusa MK3S"></div>
          <div style="margin-bottom:12px"><label>Location</label>
            <input name="location" placeholder="e.g. Room 204, Maker Space"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Build Volume</label><input name="build_volume" placeholder="220x220x250mm"></div>
            <div><label>Nozzle Diameter (mm)</label><input name="nozzle_diameter" type="number" step="0.01" value="0.4"></div>
          </div>
          <div style="margin-bottom:12px"><label>Firmware Version</label>
            <input name="firmware_version" placeholder="e.g. Marlin 2.0.9"></div>
          <button type="submit" class="btn">Add Printer</button>
        </form>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Create Printer ─── */
  app.post('/school/3d-printing/printers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, model, location, build_volume, nozzle_diameter, firmware_version } = req.body;
    await pool.query(
      'INSERT INTO printers_3d (tenant_id, name, model, location, build_volume, nozzle_diameter, firmware_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, name, model, location, build_volume, nozzle_diameter || 0.4, firmware_version]
    );
    audit(req, 'printer_added', { name });
    req.flash('success', 'Printer added');
    res.redirect('/school/3d-printing');
  }));

  /* ─── Edit Printer ─── */
  app.get('/school/3d-printing/printers/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const p = (await pool.query('SELECT * FROM printers_3d WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!p) return res.status(404).send('Not found');
    res.send(renderPage(req, 'Edit Printer', SKIP + `
      <div class="page-head"><h2>Edit: ${esc(p.name)}</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:550px">
        <form method="POST" action="/school/3d-printing/printers/${p.id}">
          <input type="hidden" name="_method" value="PUT">
          <div style="margin-bottom:12px"><label>Name</label><input name="name" value="${esc(p.name)}" required></div>
          <div style="margin-bottom:12px"><label>Model</label><input name="model" value="${esc(p.model||'')}"></div>
          <div style="margin-bottom:12px"><label>Location</label><input name="location" value="${esc(p.location||'')}"></div>
          <div style="margin-bottom:12px"><label>Status</label>
            <select name="status">${['available','printing','maintenance','offline'].map(s =>
              `<option value="${s}" ${s===p.status?'selected':''}>${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label>Build Volume</label><input name="build_volume" value="${esc(p.build_volume||'')}"></div>
          <div style="margin-bottom:12px"><label>Nozzle Diameter</label><input name="nozzle_diameter" type="number" step="0.01" value="${p.nozzle_diameter||0.4}"></div>
          <div style="margin-bottom:12px"><label>Firmware Version</label><input name="firmware_version" value="${esc(p.firmware_version||'')}"></div>
          <button type="submit" class="btn">Update Printer</button>
        </form>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Update Printer ─── */
  app.post('/school/3d-printing/printers/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, model, location, status, build_volume, nozzle_diameter, firmware_version } = req.body;
    await pool.query(
      'UPDATE printers_3d SET name=$1, model=$2, location=$3, status=$4, build_volume=$5, nozzle_diameter=$6, firmware_version=$7 WHERE id=$8 AND tenant_id=$9',
      [name, model, location, status, build_volume, nozzle_diameter, firmware_version, req.params.id, tid]
    );
    audit(req, 'printer_updated', { id: req.params.id });
    req.flash('success', 'Printer updated');
    res.redirect('/school/3d-printing');
  }));

  /* ─── Log Printer Maintenance ─── */
  app.post('/school/3d-printing/printers/:id/maintenance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query("UPDATE printers_3d SET status='maintenance', last_maintenance=NOW() WHERE id=$1 AND tenant_id=$2",
      [req.params.id, tid]);
    audit(req, 'printer_maintenance', { id: req.params.id });
    req.flash('success', 'Printer marked for maintenance');
    res.redirect('/school/3d-printing');
  }));

  /* ─── Add Filament Form ─── */
  app.get('/school/3d-printing/filament/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'Add Filament', SKIP + `
      <div class="page-head"><h2>Add Filament Stock</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:550px">
        <form method="POST" action="/school/3d-printing/filament">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Material Type *</label>
              <select name="material_type" required>
                <option value="PLA">PLA</option><option value="ABS">ABS</option>
                <option value="PETG">PETG</option><option value="TPU">TPU (Flexible)</option>
                <option value="Nylon">Nylon</option><option value="Resin">Resin</option>
                <option value="Wood PLA">Wood PLA</option><option value="Carbon Fiber">Carbon Fiber</option>
              </select></div>
            <div><label>Color *</label><input name="color" required placeholder="e.g. White, Black, Blue"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Weight (grams)</label><input name="weight_remaining_grams" type="number" value="1000"></div>
            <div><label>Cost per Gram ($)</label><input name="cost_per_gram" type="number" step="0.0001" value="0.02"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Supplier</label><input name="supplier" placeholder="e.g. Hatchbox, Elegoo"></div>
            <div><label>Batch Number</label><input name="batch_number" placeholder="Optional batch code"></div>
          </div>
          <div style="margin-bottom:12px"><label>Expiry Date</label><input name="expiry_date" type="date"></div>
          <button type="submit" class="btn">Add Filament</button>
        </form>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Create Filament ─── */
  app.post('/school/3d-printing/filament', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { material_type, color, weight_remaining_grams, cost_per_gram, supplier, batch_number, expiry_date } = req.body;
    await pool.query(
      'INSERT INTO filament_inventory (tenant_id, material_type, color, weight_remaining_grams, cost_per_gram, supplier, batch_number, expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, material_type, color, weight_remaining_grams || 1000, cost_per_gram || 0.02, supplier, batch_number, expiry_date || null]
    );
    audit(req, 'filament_added', { material_type, color });
    req.flash('success', 'Filament stock added');
    res.redirect('/school/3d-printing');
  }));

  /* ─── Upload Model Form ─── */
  app.get('/school/3d-printing/models/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'Upload 3D Model', SKIP + `
      <div class="page-head"><h2>Upload 3D Model</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/3d-printing/models">
          <div style="margin-bottom:12px"><label>Model Name *</label>
            <input name="name" required placeholder="e.g. Desk Organizer v2"></div>
          <div style="margin-bottom:12px"><label>Description</label>
            <textarea name="description" rows="3" placeholder="Describe the model, purpose, recommended settings..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Category</label>
              <select name="category">
                <option value="educational">Educational</option><option value="engineering">Engineering</option>
                <option value="art">Art & Design</option><option value="functional">Functional</option>
                <option value="robotics">Robotics</option><option value="biology">Biology</option>
                <option value="architecture">Architecture</option><option value="challenge">Design Challenge</option>
                <option value="other">Other</option>
              </select></div>
            <div><label>Difficulty</label>
              <select name="difficulty">
                <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option><option value="expert">Expert</option>
              </select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>File URL</label><input name="file_url" placeholder="/uploads/models/organizer.stl"></div>
            <div><label>Thumbnail URL</label><input name="thumbnail_url" placeholder="/uploads/thumbs/organizer.png"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Est. Print Time (min)</label><input name="estimated_print_time_min" type="number" placeholder="120"></div>
            <div><label>Est. Material (grams)</label><input name="estimated_material_grams" type="number" step="0.1" placeholder="25"></div>
          </div>
          <div style="margin-bottom:12px"><label>Tags (comma separated)</label>
            <input name="tags" placeholder="e.g. organizer, desk, school, beginner"></div>
          <button type="submit" class="btn">Upload Model</button>
        </form>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Create Model ─── */
  app.post('/school/3d-printing/models', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, description, category, difficulty, file_url, thumbnail_url, estimated_print_time_min, estimated_material_grams, tags } = req.body;
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      'INSERT INTO model_library (tenant_id, name, description, category, difficulty, file_url, thumbnail_url, estimated_print_time_min, estimated_material_grams, tags, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [tid, name, description, category, difficulty, file_url, thumbnail_url, estimated_print_time_min || null, estimated_material_grams || null, tagArr, req.user.id]
    );
    audit(req, 'model_uploaded', { name, category });
    req.flash('success', 'Model uploaded to library');
    res.redirect('/school/3d-printing');
  }));

  /* ─── View Model ─── */
  app.get('/school/3d-printing/models/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const m = (await pool.query('SELECT ml.*, u.name AS creator_name FROM model_library ml LEFT JOIN users u ON u.id=ml.created_by WHERE ml.id=$1 AND ml.tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!m) return res.status(404).send('Not found');
    const relatedJobs = (await pool.query("SELECT id, student_id, status, quality_score, created_at FROM print_jobs WHERE tenant_id=$1 AND model_name ILIKE $2 LIMIT 10", [tid, '%' + m.name + '%'])).rows;
    res.send(renderPage(req, m.name, SKIP + `
      <div class="page-head"><h2>${esc(m.name)}</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a>
        <a href="/school/3d-printing/jobs/new?model=${m.id}" class="btn" style="background:#059669">Print This</a>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px">
        <div>
          ${m.thumbnail_url ? `<img src="${esc(m.thumbnail_url)}" style="width:100%;border-radius:8px">` :
            `<div style="aspect-ratio:1;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:4rem;color:${P}">&#9651;</div>`}
          <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
            ${(m.tags||[]).map(t => `<span class="badge badge-blue">${esc(t)}</span>`).join('')}
          </div>
        </div>
        <div>
          <div class="card">
            <p>${esc(m.description || 'No description')}</p>
            <table style="margin-top:12px">
              <tr><td style="width:160px;color:${GRAY}">Category</td><td>${esc(m.category||'-')}</td></tr>
              <tr><td style="color:${GRAY}">Difficulty</td><td><span class="badge ${m.difficulty==='beginner'?'badge-green':m.difficulty==='advanced'?'badge-red':'badge-yellow'}">${m.difficulty}</span></td></tr>
              <tr><td style="color:${GRAY}">Est. Print Time</td><td>${m.estimated_print_time_min ? m.estimated_print_time_min + ' min' : 'N/A'}</td></tr>
              <tr><td style="color:${GRAY}">Est. Material</td><td>${m.estimated_material_grams ? m.estimated_material_grams + 'g' : 'N/A'}</td></tr>
              <tr><td style="color:${GRAY}">Downloads</td><td>${m.downloads}</td></tr>
              <tr><td style="color:${GRAY}">Uploaded By</td><td>${esc(m.creator_name||'Staff')}</td></tr>
              <tr><td style="color:${GRAY}">Date</td><td>${new Date(m.created_at).toLocaleDateString()}</td></tr>
            </table>
            ${m.file_url ? `<a href="${esc(m.file_url)}" class="btn" style="margin-top:12px" download>Download STL</a>` : ''}
          </div>
          ${relatedJobs.length > 0 ? `<div class="card"><h3>Related Print Jobs (${relatedJobs.length})</h3>
            <table><thead><tr><th>Job #</th><th>Status</th><th>Quality</th><th>Date</th></tr></thead>
            <tbody>${relatedJobs.map(j => `<tr><td>#${j.id}</td><td>${j.status}</td><td>${j.quality_score || '-'}</td><td>${new Date(j.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>
          </div>` : ''}
        </div>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Cost Estimator ─── */
  app.get('/school/3d-printing/cost-estimator', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const filaments = (await pool.query("SELECT DISTINCT material_type, color, cost_per_gram FROM filament_inventory WHERE tenant_id=$1 AND status='available'", [tid])).rows;
    res.send(renderPage(req, 'Print Cost Estimator', SKIP + `
      <div class="page-head"><h2>Print Cost Estimator</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:550px">
        <h3>Estimate Your Print Cost</h3>
        <div style="margin-bottom:12px"><label>Material Weight (grams)</label>
          <input id="weight" type="number" value="25" oninput="calcCost()"></div>
        <div style="margin-bottom:12px"><label>Material</label>
          <select id="materialSelect" onchange="calcCost()">
            ${filaments.map((f,i) => `<option value="${f.cost_per_gram}" data-index="${i}">${esc(f.material_type)} - ${esc(f.color)} ($${f.cost_per_gram}/g)</option>`).join('')}
            ${filaments.length === 0 ? '<option value="0.02">PLA - Generic ($0.02/g)</option>' : ''}
          </select></div>
        <div style="margin-bottom:12px"><label>Print Time (minutes)</label>
          <input id="printTime" type="number" value="120" oninput="calcCost()"></div>
        <div style="margin-bottom:12px"><label>Electricity Rate ($/hr)</label>
          <input id="elecRate" type="number" step="0.01" value="0.15" oninput="calcCost()"></div>
        <div class="card" style="background:#f0fdf4;border:2px solid #059669;text-align:center;margin-top:16px">
          <div style="font-size:13px;color:${GRAY}">Estimated Total Cost</div>
          <div id="totalCost" style="font-size:2.5em;color:#059669;font-weight:700">$0.80</div>
          <div id="costBreakdown" style="font-size:12px;color:${GRAY};margin-top:8px"></div>
        </div>
      </div>
      <script>
        function calcCost() {
          const w = parseFloat(document.getElementById('weight').value) || 0;
          const sel = document.getElementById('materialSelect');
          const cpg = parseFloat(sel.options[sel.selectedIndex].value) || 0.02;
          const pt = parseFloat(document.getElementById('printTime').value) || 0;
          const er = parseFloat(document.getElementById('elecRate').value) || 0.15;
          const matCost = w * cpg;
          const elecCost = (pt / 60) * er;
          const markup = (matCost + elecCost) * 0.3;
          const total = matCost + elecCost + markup;
          document.getElementById('totalCost').textContent = '$' + total.toFixed(2);
          document.getElementById('costBreakdown').textContent = 
            'Material: $' + matCost.toFixed(2) + ' + Electricity: $' + elecCost.toFixed(2) + ' + Markup: $' + markup.toFixed(2);
        }
        calcCost();
      </script>
    `, { nav: '3d-printing' }));
  });

  /* ─── Print Analytics ─── */
  app.get('/school/3d-printing/analytics', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const [byStatus, byMaterial, byPrinter, recentCompleted, topModels] = await Promise.all([
      pool.query("SELECT status, COUNT(*) AS cnt FROM print_jobs WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC", [tid]),
      pool.query("SELECT material, COUNT(*) AS cnt, ROUND(AVG(quality_score)::numeric,1) AS avg_q FROM print_jobs WHERE tenant_id=$1 AND material IS NOT NULL GROUP BY material ORDER BY cnt DESC", [tid]),
      pool.query("SELECT p3.name, p3.total_print_hours, COUNT(pj.id) AS jobs FROM printers_3d p3 LEFT JOIN print_jobs pj ON pj.printer_id=p3.id AND pj.tenant_id=$1 WHERE p3.tenant_id=$1 GROUP BY p3.name, p3.total_print_hours ORDER BY jobs DESC", [tid]),
      pool.query("SELECT * FROM print_jobs WHERE tenant_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 20", [tid]),
      pool.query("SELECT model_name, COUNT(*) AS cnt FROM print_jobs WHERE tenant_id=$1 GROUP BY model_name ORDER BY cnt DESC LIMIT 10", [tid])
    ]);
    const totalJobs = byStatus.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
    const avgQAll = (await pool.query("SELECT ROUND(AVG(quality_score)::numeric,1) FROM print_jobs WHERE tenant_id=$1 AND quality_score IS NOT NULL", [tid])).rows[0].round;
    const statusColors = { queued: '#f59e0b', printing: P, completed: '#059669', failed: '#ef4444', cancelled: GRAY, review: '#f59e0b' };

    res.send(renderPage(req, '3D Print Analytics', SKIP + `
      <div class="page-head"><h2>Print Analytics</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
        <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${totalJobs}</div><div style="color:${GRAY}">Total Jobs</div></div>
        <div class="card" style="text-align:center"><div style="font-size:2em;color:#059669">${avgQAll || 0}</div><div style="color:${GRAY}">Avg Quality Score</div></div>
        <div class="card" style="text-align:center"><div style="font-size:2em;color:#8b5cf6">${byPrinter.rows.reduce((s,p)=>s+parseFloat(p.total_print_hours||0),0).toFixed(1)}h</div><div style="color:${GRAY}">Total Print Hours</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><h3>Jobs by Status</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${byStatus.rows.map(r => {
              const pct = totalJobs > 0 ? (parseInt(r.cnt)/totalJobs*100) : 0;
              return `<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
                <span>${r.status.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span><span>${r.cnt} (${pct.toFixed(0)}%)</span></div>
                <div style="background:#f3f4f6;border-radius:4px;height:18px;overflow:hidden"><div style="background:${statusColors[r.status]||GRAY};height:100%;width:${pct}%;border-radius:4px"></div></div></div>`;
            }).join('')}
          </div></div>
        <div class="card"><h3>Material Usage</h3>
          <table><thead><tr><th>Material</th><th>Jobs</th><th>Avg Quality</th></tr></thead>
          <tbody>${byMaterial.rows.map(m => `<tr><td>${esc(m.material)}</td><td>${m.cnt}</td><td>${m.avg_q||'-'}</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="card"><h3>Printer Performance</h3>
          <table><thead><tr><th>Printer</th><th>Jobs</th><th>Total Hours</th></tr></thead>
          <tbody>${byPrinter.rows.map(p => `<tr><td>${esc(p.name)}</td><td>${p.jobs}</td><td>${parseFloat(p.total_print_hours||0).toFixed(1)}h</td></tr>`).join('')}</tbody></table>
        </div>
        <div class="card"><h3>Most Printed Models</h3>
          <table><thead><tr><th>Model</th><th>Times Printed</th></tr></thead>
          <tbody>${topModels.rows.map(m => `<tr><td>${esc(m.model_name)}</td><td>${m.cnt}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
    `, { nav: '3d-printing' }));
  });

  /* ─── Design Challenges ─── */
  app.get('/school/3d-printing/challenges', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'Design Challenges', SKIP + `
      <div class="page-head"><h2>3D Design Challenges</h2>
        <a href="/school/3d-printing" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${[
          {title:'Bridge Builder', desc:'Design a bridge that can hold 500g using minimal material. Test structural integrity!', difficulty:'intermediate', time:'2 weeks', icon:'🌉'},
          {title:'Phone Stand Sprint', desc:'Create an ergonomic phone stand in under 4 hours print time. Form meets function!', difficulty:'beginner', time:'1 week', icon:'📱'},
          {title:'Gear System', desc:'Design a working gear system with at least 3 interlocking gears. Precision matters!', difficulty:'advanced', time:'3 weeks', icon:'⚙️'},
          {title:'Eco Container', desc:'Design a reusable container that reduces plastic waste. Sustainability focus.', difficulty:'intermediate', time:'2 weeks', icon:'♻️'},
          {title:'Articulated Figure', desc:'Print an articulated character or animal figure with movable joints. No assembly!', difficulty:'expert', time:'3 weeks', icon:'🦖'},
          {title:'Math Manipulatives', desc:'Create 3D math teaching aids (fraction bars, geometric solids, etc.)', difficulty:'beginner', time:'1 week', icon:'📐'}
        ].map(c => `<div class="card">
          <div style="font-size:2rem;margin-bottom:8px">${c.icon}</div>
          <h3>${c.title}</h3>
          <span class="badge ${c.difficulty==='beginner'?'badge-green':c.difficulty==='advanced'?'badge-red':'badge-yellow'}">${c.difficulty}</span>
          <span class="badge badge-gray" style="margin-left:4px">${c.time}</span>
          <p style="color:${GRAY};font-size:13px;margin-top:8px">${c.desc}</p>
          <button class="btn" style="margin-top:8px" onclick="alert('Challenge participation coming soon!')">Join Challenge</button>
        </div>`).join('')}
      </div>
    `, { nav: '3d-printing' }));
  });
};
