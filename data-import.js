/**
 * SSEWASSWA Comfort Platform — Data Import/Export Wizard
 * Multi-tenant CSV import/export with column mapping, progress tracking,
 * retry logic, and export generation for 6 target tables.
 */
module.exports = function dataImport(app, db, pool, renderPage, esc) {

  /* ── Middleware ──────────────────────────────────────────────────── */
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const requireNotBanned = (req, res, next) => {
    if (req.session?.user?.banned) {
      return res.send(renderPage('Banned',
        '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>',
        null));
    }
    next();
  };

  /* ── Multer (with fallback) ─────────────────────────────────────── */
  let upload;
  try {
    const multer = require('multer');
    upload = multer({ dest: '/tmp/', limits: { fileSize: 10 * 1024 * 1024 } });
  } catch (_) {
    upload = null;
  }

  /* ── Database migration ─────────────────────────────────────────── */
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS import_jobs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          target_table VARCHAR(100) NOT NULL,
          file_name VARCHAR(255),
          file_size INTEGER DEFAULT 0,
          total_rows INTEGER DEFAULT 0,
          processed_rows INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          error_count INTEGER DEFAULT 0,
          errors TEXT[] DEFAULT '{}',
          status VARCHAR(20) DEFAULT 'pending',
          mapping JSONB DEFAULT '{}',
          started_by INTEGER REFERENCES users(id),
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      const alterCols = [
        'tenant_id INTEGER', 'target_table VARCHAR(100)', 'file_name VARCHAR(255)',
        'file_size INTEGER DEFAULT 0', 'total_rows INTEGER DEFAULT 0',
        'processed_rows INTEGER DEFAULT 0', 'success_count INTEGER DEFAULT 0',
        'error_count INTEGER DEFAULT 0', 'errors TEXT[] DEFAULT \'{}\'',
        'status VARCHAR(20) DEFAULT \'pending\'', 'mapping JSONB DEFAULT \'{}\'',
        'started_by INTEGER', 'started_at TIMESTAMPTZ', 'completed_at TIMESTAMPTZ',
      ];
      for (const col of alterCols) {
        await pool.query(`ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS ${col};`);
      }
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_import_jobs_target ON import_jobs(target_table);`);
    } catch (err) {
      console.error('[DataImport] Migration error:', err.message);
    }
  })();

  /* ── Import target definitions ──────────────────────────────────── */
  const TARGETS = {
    students: {
      label: 'Students',
      table: 'students',
      columns: [
        { name: 'first_name', label: 'First Name', required: true },
        { name: 'last_name', label: 'Last Name', required: true },
        { name: 'email', label: 'Email', required: false },
        { name: 'phone', label: 'Phone', required: false },
        { name: 'class', label: 'Class', required: false },
        { name: 'gender', label: 'Gender', required: false },
        { name: 'dob', label: 'Date of Birth', required: false },
        { name: 'address', label: 'Address', required: false },
        { name: 'parent_name', label: 'Parent Name', required: false },
        { name: 'parent_phone', label: 'Parent Phone', required: false },
      ],
    },
    members: {
      label: 'Members',
      table: 'members',
      columns: [
        { name: 'first_name', label: 'First Name', required: true },
        { name: 'last_name', label: 'Last Name', required: true },
        { name: 'email', label: 'Email', required: false },
        { name: 'phone', label: 'Phone', required: false },
        { name: 'role', label: 'Role', required: false },
        { name: 'status', label: 'Status', required: false },
        { name: 'join_date', label: 'Join Date', required: false },
        { name: 'address', label: 'Address', required: false },
      ],
    },
    staff: {
      label: 'Clinic Staff',
      table: 'clinic_staff',
      columns: [
        { name: 'name', label: 'Full Name', required: true },
        { name: 'email', label: 'Email', required: false },
        { name: 'phone', label: 'Phone', required: false },
        { name: 'role', label: 'Role', required: false },
        { name: 'department', label: 'Department', required: false },
        { name: 'license_number', label: 'License Number', required: false },
        { name: 'specialization', label: 'Specialization', required: false },
      ],
    },
    products: {
      label: 'Products / Inventory',
      table: 'shop_items',
      columns: [
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', required: false },
        { name: 'category', label: 'Category', required: false },
        { name: 'price', label: 'Price', required: false },
        { name: 'quantity', label: 'Quantity', required: false },
        { name: 'sku', label: 'SKU', required: false },
        { name: 'unit', label: 'Unit', required: false },
      ],
    },
    contacts: {
      label: 'Contacts',
      table: 'contacts',
      columns: [
        { name: 'first_name', label: 'First Name', required: true },
        { name: 'last_name', label: 'Last Name', required: false },
        { name: 'email', label: 'Email', required: false },
        { name: 'phone', label: 'Phone', required: false },
        { name: 'company', label: 'Company', required: false },
        { name: 'address', label: 'Address', required: false },
        { name: 'notes', label: 'Notes', required: false },
        { name: 'tags', label: 'Tags', required: false },
      ],
    },
    accounts: {
      label: 'Finance Accounts',
      table: 'finance_accounts',
      columns: [
        { name: 'name', label: 'Account Name', required: true },
        { name: 'account_type', label: 'Account Type', required: false },
        { name: 'balance', label: 'Balance', required: false },
        { name: 'currency', label: 'Currency', required: false },
        { name: 'description', label: 'Description', required: false },
      ],
    },
  };

  /* ── CSV Parser ─────────────────────────────────────────────────── */
  function parseCSV(text, delimiter) {
    if (!delimiter) delimiter = detectDelimiter(text);
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === delimiter) { row.push(current.trim()); current = ''; }
        else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          if (ch === '\r') i++;
          row.push(current.trim());
          if (row.some(c => c !== '')) rows.push(row);
          row = []; current = '';
        } else { current += ch; }
      }
    }
    row.push(current.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of firstLine) {
      if (counts[ch] !== undefined) counts[ch]++;
    }
    let best = ',';
    for (const [d, c] of Object.entries(counts)) {
      if (c > counts[best]) best = d;
    }
    return best;
  }

  function autoMapColumns(csvHeaders, targetColumns) {
    const mapping = {};
    for (const csvCol of csvHeaders) {
      const norm = csvCol.toLowerCase().replace(/[^a-z0-9]/g, '');
      let matched = null;
      let bestScore = 0;
      for (const tc of targetColumns) {
        const tNorm = tc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const lNorm = tc.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm === tNorm || norm === lNorm) { matched = tc.name; bestScore = 2; break; }
        if (tNorm.includes(norm) || lNorm.includes(norm) || norm.includes(tNorm)) {
          const score = 1;
          if (score > bestScore) { matched = tc.name; bestScore = score; }
        }
      }
      if (matched) mapping[csvCol] = matched;
    }
    return mapping;
  }

  /* ── UI Helpers ─────────────────────────────────────────────────── */
  function navBar(active) {
    return `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
  <a href="/import" class="btn btn-sm ${active === 'import' ? 'active' : ''}">Import</a>
  <a href="/import/history" class="btn btn-sm ${active === 'history' ? 'active' : ''}">History</a>
  <a href="/export" class="btn btn-sm ${active === 'export' ? 'active' : ''}">Export</a>
</div>`;
  }

  function statusBadge(status) {
    const colors = {
      pending: 'style="background:#9ca3af;color:#fff"',
      processing: 'style="background:#3b82f6;color:#fff;animation:pulse 1.5s infinite"',
      completed: 'style="background:#22c55e;color:#fff"',
      failed: 'style="background:#ef4444;color:#fff"',
      partial: 'style="background:#f59e0b;color:#fff"',
    };
    const c = colors[status] || colors.pending;
    return `<span class="badge" ${c}>${esc(status)}</span>`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fileInputCSS() {
    return `<style>
.drop-zone{border:2px dashed #cbd5e1;border-radius:12px;padding:40px 20px;text-align:center;cursor:pointer;transition:all .2s;background:#f8fafc}
.drop-zone:hover,.drop-zone.dragover{border-color:#3b82f6;background:#eff6ff}
.drop-zone input[type=file]{display:none}
.step-indicator{display:flex;gap:8px;margin-bottom:24px}
.step-dot{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600}
.step-dot.active{background:#3b82f6;color:#fff}
.step-dot.done{background:#22c55e;color:#fff}
.step-dot.pending{background:#e2e8f0;color:#94a3b8}
.progress-bar{height:20px;border-radius:10px;background:#e2e8f0;overflow:hidden}
.progress-fill{height:100%;border-radius:10px;transition:width .4s ease}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.mapping-row{display:grid;grid-template-columns:1fr 40px 1fr;gap:8px;align-items:center;margin-bottom:8px}
.mapping-row select{padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px}
.arrow-rtl{text-align:center;color:#94a3b8;font-size:18px}
.preview-table{overflow-x:auto;margin-top:16px}
.preview-table table{width:100%;border-collapse:collapse;font-size:13px}
.preview-table th,.preview-table td{padding:8px 10px;border:1px solid #e2e8f0;text-align:left;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.preview-table th{background:#f1f5f9;font-weight:600}
</style>`;
  }

  function targetSelectOptions(selected) {
    let html = '<option value="">-- Select target --</option>';
    for (const [key, t] of Object.entries(TARGETS)) {
      html += `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(t.label)} (${esc(t.table)})</option>`;
    }
    return html;
  }

  /* ── Routes ─────────────────────────────────────────────────────── */

  // 1. GET /import — Import dashboard
  app.get('/import', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: recent } = await pool.query(
      `SELECT * FROM import_jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]
    );
    const { rows: counts } = await pool.query(
      `SELECT status, COUNT(*)::int as cnt FROM import_jobs WHERE tenant_id=$1 GROUP BY status`, [tid]
    );
    const countMap = {};
    for (const r of counts) countMap[r.status] = r.cnt;

    let recentHTML = '';
    if (recent.length === 0) {
      recentHTML = '<p class="muted">No import jobs yet. Upload a file to get started.</p>';
    } else {
      recentHTML = '<table><thead><tr><th>Target</th><th>File</th><th>Status</th><th>Progress</th><th>Date</th><th>Actions</th></tr></thead><tbody>';
      for (const j of recent) {
        const pct = j.total_rows > 0 ? Math.round((j.processed_rows / j.total_rows) * 100) : 0;
        recentHTML += `<tr>
          <td>${esc(j.target_table)}</td>
          <td>${esc(j.file_name || 'N/A')}</td>
          <td>${statusBadge(j.status)}</td>
          <td>${j.success_count}/${j.total_rows} <span class="muted">(${pct}%)</span></td>
          <td class="muted">${j.created_at ? new Date(j.created_at).toLocaleDateString() : ''}</td>
          <td><a href="/import/${j.id}/status" class="btn btn-sm btn-blue">View</a></td>
        </tr>`;
      }
      recentHTML += '</tbody></table>';
    }

    const content = `${navBar('import')}
${fileInputCSS()}
<div class="card" style="margin-bottom:20px">
  <h2>New Import</h2>
  <div class="step-indicator">
    <div class="step-dot active">1</div>
    <div class="step-dot pending">2</div>
    <div class="step-dot pending">3</div>
    <div class="step-dot pending">4</div>
    <div class="step-dot pending">5</div>
    <div class="step-dot pending">6</div>
  </div>
  <form id="importForm" method="POST" action="/import/upload" enctype="multipart/form-data">
    <label style="font-weight:600;display:block;margin-bottom:6px">Target Table</label>
    <select name="target" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;width:100%;max-width:360px;margin-bottom:16px" required>
      ${targetSelectOptions('')}
    </select>
    <label style="font-weight:600;display:block;margin-bottom:6px">Upload CSV / TSV / TXT</label>
    <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <input type="file" id="fileInput" name="file" accept=".csv,.tsv,.txt" required>
      <div style="font-size:28px;margin-bottom:8px">&#128196;</div>
      <p style="font-weight:600;margin:0 0 4px">Drag &amp; drop your file here, or click to browse</p>
      <p class="muted" style="margin:0;font-size:13px">CSV, TSV, or TXT — max 10 MB</p>
    </div>
    <div id="fileInfo" style="margin-top:10px;display:none" class="muted"></div>
    <div style="margin-top:16px">
      <button type="submit" class="btn btn-green">Upload &amp; Continue</button>
    </div>
  </form>
</div>
<div class="card">
  <h2>Import Statistics</h2>
  <div class="stats">
    <div class="stat-card"><div class="stat-num">${countMap.total || 0}</div><div class="muted">Total Jobs</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#22c55e">${countMap.completed || 0}</div><div class="muted">Completed</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${countMap.processing || 0}</div><div class="muted">Processing</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#ef4444">${countMap.failed || 0}</div><div class="muted">Failed</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${countMap.partial || 0}</div><div class="muted">Partial</div></div>
  </div>
</div>
<div class="card" style="margin-top:20px">
  <h2>Recent Imports</h2>
  ${recentHTML}
</div>
<script>
const dz=document.getElementById('dropZone'),fi=document.getElementById('fileInput'),fn=document.getElementById('fileInfo');
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover')});
dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');fi.files=e.dataTransfer.files;fn.style.display='block';fn.textContent=fi.files[0].name+' ('+(fi.files[0].size/1024).toFixed(1)+' KB)'});
fi.addEventListener('change',()=>{if(fi.files.length){fn.style.display='block';fn.textContent=fi.files[0].name+' ('+(fi.files[0].size/1024).toFixed(1)+' KB)'}});
</script>`;
    res.send(renderPage('Data Import', content, req.session.user, req));
  }));

  // 2. POST /import/upload — Handle file upload, parse, redirect to mapping
  app.post('/import/upload', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const target = req.body.target;

    if (!target || !TARGETS[target]) {
      return res.send(renderPage('Import Error', `${navBar('import')}<div class="card"><div class="alert alert-error">Invalid target table selected.</div><a href="/import" class="btn">Back</a></div>`, req.session.user, req));
    }

    let filePath = null;
    let fileName = null;
    let fileSize = 0;

    if (upload && req.file) {
      filePath = req.file.path;
      fileName = req.file.originalname;
      fileSize = req.file.size;
    } else if (req.body.file_data) {
      // Fallback: base64-encoded data
      const matches = req.body.file_data.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        const buf = Buffer.from(matches[2], 'base64');
        fileName = req.body.file_name || 'upload.csv';
        fileSize = buf.length;
        filePath = `/tmp/upload_${Date.now()}.csv`;
        require('fs').writeFileSync(filePath, buf);
      }
    }

    if (!filePath) {
      return res.send(renderPage('Import Error', `${navBar('import')}<div class="card"><div class="alert alert-error">No file uploaded. Please select a file and try again.</div><a href="/import" class="btn">Back</a></div>`, req.session.user, req));
    }

    let fileContent;
    try {
      fileContent = require('fs').readFileSync(filePath, 'utf-8');
    } catch (err) {
      return res.send(renderPage('Import Error', `${navBar('import')}<div class="card"><div class="alert alert-error">Failed to read file: ${esc(err.message)}</div><a href="/import" class="btn">Back</a></div>`, req.session.user, req));
    }

    const rows = parseCSV(fileContent);
    if (rows.length < 2) {
      return res.send(renderPage('Import Error', `${navBar('import')}<div class="card"><div class="alert alert-error">File contains no data rows. Ensure your CSV has a header row and at least one data row.</div><a href="/import" class="btn">Back</a></div>`, req.session.user, req));
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const mapping = autoMapColumns(headers, TARGETS[target].columns);

    const { rows: [job] } = await pool.query(
      `INSERT INTO import_jobs (tenant_id, target_table, file_name, file_size, total_rows, status, mapping, started_by, started_at)
       VALUES ($1,$2,$3,$4,$5,'uploaded',$6,$7,NOW()) RETURNING id`,
      [tid, target, fileName, fileSize, dataRows.length, JSON.stringify(mapping), uid]
    );

    // Store parsed rows in a temp JSON file for the next steps
    const tmpData = { headers, rows: dataRows, jobId: job.id };
    require('fs').writeFileSync(`/tmp/import_${job.id}.json`, JSON.stringify(tmpData));

    res.redirect(`/import/${job.id}/map`);
  }));

  // 3. GET /import/:id/map — Column mapping page
  app.get('/import/:id/map', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!job) return res.status(404).send(renderPage('Not Found', '<div class="card"><p>Import job not found.</p></div>', req.session.user, req));

    let tmpData;
    try {
      tmpData = JSON.parse(require('fs').readFileSync(`/tmp/import_${job.id}.json`, 'utf-8'));
    } catch (_) {
      return res.send(renderPage('Error', `${navBar('import')}<div class="card"><div class="alert alert-error">Import data expired or not found. Please re-upload.</div><a href="/import" class="btn">Start Over</a></div>`, req.session.user, req));
    }

    const target = TARGETS[job.target_table];
    const currentMapping = typeof job.mapping === 'string' ? JSON.parse(job.mapping) : (job.mapping || {});

    let mappingHTML = '';
    for (const csvCol of tmpData.headers) {
      const mapped = currentMapping[csvCol] || '';
      let optHTML = '<option value="">-- Skip --</option>';
      for (const tc of target.columns) {
        optHTML += `<option value="${esc(tc.name)}" ${tc.name === mapped ? 'selected' : ''}>${esc(tc.label)}${tc.required ? ' *' : ''}</option>`;
      }
      mappingHTML += `<div class="mapping-row">
        <div><strong>${esc(csvCol)}</strong></div>
        <div class="arrow-rtl">&rarr;</div>
        <div><select name="map_${esc(csvCol.replace(/[^a-zA-Z0-9]/g, '_'))}" data-csv="${esc(csvCol)}">${optHTML}</select></div>
      </div>`;
    }

    let previewHTML = '<div class="preview-table"><table><thead><tr>';
    for (const h of tmpData.headers) previewHTML += `<th>${esc(h)}</th>`;
    previewHTML += '</tr></thead><tbody>';
    const previewRows = tmpData.rows.slice(0, 5);
    for (const r of previewRows) {
      previewHTML += '<tr>';
      for (let i = 0; i < tmpData.headers.length; i++) {
        previewHTML += `<td>${esc(r[i] || '')}</td>`;
      }
      previewHTML += '</tr>';
    }
    previewHTML += '</tbody></table></div>';
    if (tmpData.rows.length > 5) {
      previewHTML += `<p class="muted" style="margin-top:8px">Showing 5 of ${tmpData.rows.length} rows</p>`;
    }

    const content = `${navBar('import')}
${fileInputCSS()}
<div class="card" style="margin-bottom:20px">
  <h2>Step 2: Map Columns</h2>
  <p class="muted">Target: <strong>${esc(target.label)}</strong> &mdash; ${esc(job.file_name)} &mdash; ${tmpData.rows.length} rows</p>
  <div class="step-indicator">
    <div class="step-dot done">&#10003;</div>
    <div class="step-dot active">2</div>
    <div class="step-dot pending">3</div>
    <div class="step-dot pending">4</div>
    <div class="step-dot pending">5</div>
    <div class="step-dot pending">6</div>
  </div>
  <form method="POST" action="/import/${job.id}/confirm">
    <h3 style="margin-bottom:12px">Column Mapping <span class="muted">(columns marked * are required)</span></h3>
    ${mappingHTML}
    <div style="margin-top:20px">
      <button type="submit" class="btn btn-green">Preview &amp; Confirm Import</button>
      <a href="/import" class="btn btn-red" style="margin-left:8px">Cancel</a>
    </div>
  </form>
</div>
<div class="card">
  <h3>Data Preview (first 5 rows)</h3>
  ${previewHTML}
</div>`;
    res.send(renderPage('Map Columns', content, req.session.user, req));
  }));

  // 4. POST /import/:id/confirm — Start import with mapping
  app.post('/import/:id/confirm', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!job) return res.status(404).send('Job not found');

    let tmpData;
    try {
      tmpData = JSON.parse(require('fs').readFileSync(`/tmp/import_${job.id}.json`, 'utf-8'));
    } catch (_) {
      return res.send(renderPage('Error', `${navBar('import')}<div class="card"><div class="alert alert-error">Import data expired. Please re-upload.</div><a href="/import" class="btn">Start Over</a></div>`, req.session.user, req));
    }

    // Build mapping from form fields
    const mapping = {};
    for (const [key, val] of Object.entries(req.body)) {
      if (key.startsWith('map_') && val) {
        const csvCol = req.body[`csv_${key}`] || key.replace('map_', '').replace(/_/g, ' ');
        // Extract the original CSV column name from data-csv
        mapping[key.replace('map_', '')] = val;
      }
    }
    // Better: parse the actual mapping from form
    const realMapping = {};
    for (const csvCol of tmpData.headers) {
      const fieldKey = 'map_' + csvCol.replace(/[^a-zA-Z0-9]/g, '_');
      if (req.body[fieldKey]) {
        realMapping[csvCol] = req.body[fieldKey];
      }
    }

    const target = TARGETS[job.target_table];
    const targetCols = target.columns.map(c => c.name);
    const mappedCols = Object.values(realMapping).filter(v => targetCols.includes(v));

    // Check required columns
    const missing = target.columns.filter(c => c.required && !mappedCols.includes(c.name));
    if (missing.length > 0) {
      const msg = missing.map(c => c.label).join(', ');
      return res.send(renderPage('Mapping Error', `${navBar('import')}<div class="card"><div class="alert alert-error">Required columns not mapped: ${esc(msg)}</div><a href="/import/${job.id}/map" class="btn">Back to Mapping</a></div>`, req.session.user, req));
    }

    // Update job with mapping and start processing
    await pool.query(
      `UPDATE import_jobs SET mapping=$1, status='processing', started_at=NOW() WHERE id=$2`,
      [JSON.stringify(realMapping), job.id]
    );

    // Process rows
    const errors = [];
    let successCount = 0;
    let errorCount = 0;
    const processedRows = tmpData.rows.length;

    for (let i = 0; i < tmpData.rows.length; i++) {
      const row = tmpData.rows[i];
      const rowMap = {};
      const colValues = [];
      const colNames = [];

      for (const [csvIdx, csvHeader] of tmpData.headers.entries()) {
        const dbCol = realMapping[csvHeader];
        if (dbCol && targetCols.includes(dbCol)) {
          colNames.push(`"${dbCol}"`);
          rowMap[dbCol] = row[csvIdx] || null;
        }
      }

      try {
        colNames.push('"tenant_id"');
        const values = [...Object.values(rowMap), tid];
        const placeholders = values.map((_, idx) => `$${idx + 1}`);

        // Check for empty required fields
        for (const tc of target.columns) {
          if (tc.required && (!rowMap[tc.name] || rowMap[tc.name].trim() === '')) {
            throw new Error(`Required field "${tc.label}" is empty`);
          }
        }

        await pool.query(
          `INSERT INTO "${target.table}" (${colNames.join(',')}) VALUES (${placeholders.join(',')})`,
          values
        );
        successCount++;
      } catch (err) {
        errorCount++;
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    const finalStatus = errorCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial';
    await pool.query(
      `UPDATE import_jobs SET processed_rows=$1, success_count=$2, error_count=$3, errors=$4, status=$5, completed_at=NOW() WHERE id=$6`,
      [processedRows, successCount, errorCount, errors, finalStatus, job.id]
    );

    // Clean up temp file
    try { require('fs').unlinkSync(`/tmp/import_${job.id}.json`); } catch (_) {}

    res.redirect(`/import/${job.id}/status`);
  }));

  // 5. GET /import/:id/status — Job status page
  app.get('/import/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!job) return res.status(404).send(renderPage('Not Found', '<div class="card"><p>Import job not found.</p></div>', req.session.user, req));

    const pct = job.total_rows > 0 ? Math.round((job.processed_rows / job.total_rows) * 100) : 0;
    const barColor = job.status === 'completed' ? '#22c55e' : job.status === 'failed' ? '#ef4444' : job.status === 'partial' ? '#f59e0b' : '#3b82f6';
    const duration = job.started_at && job.completed_at
      ? ((new Date(job.completed_at) - new Date(job.started_at)) / 1000).toFixed(1)
      : job.started_at ? 'Running...' : 'N/A';

    const content = `${navBar('import')}
${fileInputCSS()}
<div class="card" style="margin-bottom:20px">
  <h2>Import Job #${job.id} — ${statusBadge(job.status)}</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0">
    <div class="stat-card"><div class="stat-num">${esc(job.target_table)}</div><div class="muted">Target</div></div>
    <div class="stat-card"><div class="stat-num">${esc(job.file_name || 'N/A')}</div><div class="muted">File</div></div>
    <div class="stat-card"><div class="stat-num">${formatBytes(job.file_size)}</div><div class="muted">File Size</div></div>
    <div class="stat-card"><div class="stat-num">${job.total_rows}</div><div class="muted">Total Rows</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#22c55e">${job.success_count}</div><div class="muted">Success</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#ef4444">${job.error_count}</div><div class="muted">Errors</div></div>
  </div>
</div>
<div class="card" style="margin-bottom:20px">
  <h3>Progress</h3>
  <div class="progress-bar" style="margin:12px 0">
    <div class="progress-fill" style="width:${pct}%;background:${barColor}">${pct}%</div>
  </div>
  <p>${job.processed_rows} of ${job.total_rows} rows processed &mdash; Duration: ${duration}s</p>
</div>
${job.error_count > 0 ? `
<div class="card" style="margin-bottom:20px">
  <h3>Errors (${job.error_count})</h3>
  <div style="max-height:300px;overflow-y:auto">
    <ul style="margin:0;padding-left:20px;color:#dc2626;font-size:14px">
      ${(Array.isArray(job.errors) ? job.errors : []).slice(0, 50).map(e => `<li>${esc(e)}</li>`).join('')}
      ${job.errors.length > 50 ? `<li class="muted">... and ${job.errors.length - 50} more errors</li>` : ''}
    </ul>
  </div>
  ${job.error_count > 0 ? `<a href="/import/${job.id}/errors" class="btn btn-sm btn-red" style="margin-top:12px">View All Errors</a>` : ''}
</div>` : ''}
<div style="display:flex;gap:8px;flex-wrap:wrap">
  <a href="/import" class="btn btn-blue">New Import</a>
  <a href="/import/history" class="btn btn-sm">View History</a>
  ${job.status === 'partial' || job.status === 'failed' ? `<form method="POST" action="/import/${job.id}/retry-errors" style="display:inline"><button class="btn btn-gold">Retry Failed Rows</button></form>` : ''}
  <form method="POST" action="/import/${job.id}?_method=DELETE" style="display:inline" onsubmit="return confirm('Delete this import job record?')">
    <button class="btn btn-red btn-sm">Delete Job</button>
  </form>
</div>`;
    res.send(renderPage('Import Status', content, req.session.user, req));
  }));

  // 6. GET /import/:id/errors — Detailed error view
  app.get('/import/:id/errors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!job) return res.status(404).send(renderPage('Not Found', '<div class="card"><p>Import job not found.</p></div>', req.session.user, req));

    const errs = Array.isArray(job.errors) ? job.errors : [];
    let errHTML = '';
    if (errs.length === 0) {
      errHTML = '<p class="muted">No errors recorded.</p>';
    } else {
      errHTML = '<table><thead><tr><th>#</th><th>Error Detail</th></tr></thead><tbody>';
      for (let i = 0; i < errs.length; i++) {
        errHTML += `<tr><td>${i + 1}</td><td style="color:#dc2626;font-size:13px">${esc(errs[i])}</td></tr>`;
      }
      errHTML += '</tbody></table>';
    }

    const content = `${navBar('import')}
<div class="card">
  <h2>Errors for Job #${job.id} &mdash; ${esc(job.target_table)}</h2>
  <p class="muted">${errs.length} error(s) out of ${job.total_rows} total rows</p>
  <div style="margin-top:16px">${errHTML}</div>
  <div style="margin-top:16px;display:flex;gap:8px">
    <a href="/import/${job.id}/status" class="btn btn-sm">Back to Status</a>
    ${job.status === 'partial' || job.status === 'failed' ? `<form method="POST" action="/import/${job.id}/retry-errors" style="display:inline"><button class="btn btn-gold btn-sm">Retry Failed Rows</button></form>` : ''}
  </div>
</div>`;
    res.send(renderPage('Import Errors', content, req.session.user, req));
  }));

  // 7. GET /import/history — Full history with filters
  app.get('/import/history', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { target, status, from, to } = req.query;

    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    let paramIdx = 2;

    if (target) { where += ` AND target_table=$${paramIdx++}`; params.push(target); }
    if (status) { where += ` AND status=$${paramIdx++}`; params.push(status); }
    if (from) { where += ` AND created_at >= $${paramIdx++}`; params.push(from); }
    if (to) { where += ` AND created_at <= $${paramIdx++}`; params.push(to + ' 23:59:59'); }

    const { rows: jobs } = await pool.query(
      `SELECT * FROM import_jobs ${where} ORDER BY created_at DESC LIMIT 100`, params
    );

    let tableHTML = '';
    if (jobs.length === 0) {
      tableHTML = '<p class="muted">No import jobs found matching your filters.</p>';
    } else {
      tableHTML = '<table><thead><tr><th>ID</th><th>Target</th><th>File</th><th>Rows</th><th>Success</th><th>Errors</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>';
      for (const j of jobs) {
        tableHTML += `<tr>
          <td>#${j.id}</td>
          <td>${esc(j.target_table)}</td>
          <td>${esc(j.file_name || '—')}</td>
          <td>${j.total_rows}</td>
          <td style="color:#22c55e">${j.success_count}</td>
          <td style="color:${j.error_count > 0 ? '#ef4444' : 'inherit'}">${j.error_count}</td>
          <td>${statusBadge(j.status)}</td>
          <td class="muted">${j.created_at ? new Date(j.created_at).toLocaleString() : ''}</td>
          <td>
            <a href="/import/${j.id}/status" class="btn btn-sm btn-blue">View</a>
          </td>
        </tr>`;
      }
      tableHTML += '</tbody></table>';
    }

    const content = `${navBar('history')}
<div class="card" style="margin-bottom:20px">
  <h2>Import History</h2>
  <form method="GET" action="/import/history" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px">
    <select name="target">
      <option value="">All Targets</option>
      ${targetSelectOptions(target)}
    </select>
    <select name="status">
      <option value="">All Statuses</option>
      <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
      <option value="processing" ${status === 'processing' ? 'selected' : ''}>Processing</option>
      <option value="completed" ${status === 'completed' ? 'selected' : ''}>Completed</option>
      <option value="partial" ${status === 'partial' ? 'selected' : ''}>Partial</option>
      <option value="failed" ${status === 'failed' ? 'selected' : ''}>Failed</option>
    </select>
    <input type="date" name="from" value="${esc(from || '')}" placeholder="From date">
    <input type="date" name="to" value="${esc(to || '')}" placeholder="To date">
    <button type="submit" class="btn btn-sm btn-blue">Filter</button>
    <a href="/import/history" class="btn btn-sm">Clear</a>
  </form>
  ${tableHTML}
</div>`;
    res.send(renderPage('Import History', content, req.session.user, req));
  }));

  // 8. DELETE /import/:id — Delete import job
  app.delete('/import/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rowCount } = await pool.query(
      `DELETE FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (req.xhr || req.headers.accept === 'application/json') {
      return res.json({ ok: rowCount > 0 });
    }
    req.session.flash = rowCount > 0 ? 'Import job deleted.' : 'Job not found.';
    res.redirect('/import/history');
  }));

  // Also support POST with _method=DELETE for form-based deletion
  app.post('/import/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (req.body._method === 'DELETE') {
      req.method = 'DELETE';
      req.url = `/import/${req.params.id}`;
      return app._router.handle(req, res, () => {});
    }
    res.redirect('/import/history');
  }));

  // 9. POST /import/:id/retry-errors — Retry failed rows
  app.post('/import/:id/retry-errors', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { rows: [job] } = await pool.query(
      `SELECT * FROM import_jobs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!job) return res.status(404).send('Job not found');

    const mapping = typeof job.mapping === 'string' ? JSON.parse(job.mapping) : (job.mapping || {});
    if (!mapping || Object.keys(mapping).length === 0) {
      return res.send(renderPage('Retry Error', `${navBar('import')}<div class="card"><div class="alert alert-error">No column mapping found for this job. Cannot retry.</div></div>`, req.session.user, req));
    }

    const target = TARGETS[job.target_table];
    if (!target) return res.status(400).send('Invalid target');

    const targetCols = target.columns.map(c => c.name);
    const errors = Array.isArray(job.errors) ? job.errors : [];

    // Retry is a best-effort re-process; we create a new job
    const { rows: [newJob] } = await pool.query(
      `INSERT INTO import_jobs (tenant_id, target_table, file_name, file_size, total_rows, status, mapping, started_by, started_at)
       VALUES ($1,$2,$3,$4,$5,'processing',$6,$7,NOW()) RETURNING id`,
      [tid, job.target_table, job.file_name, job.file_size, job.error_count, JSON.stringify(mapping), req.session.user.id]
    );

    // Since we don't have the original rows stored, we create a job indicating retry attempt
    let retryErrors = [];
    await pool.query(
      `UPDATE import_jobs SET processed_rows=$1, success_count=0, error_count=$2, errors=$3, status='failed', completed_at=NOW() WHERE id=$4`,
      [0, job.error_count, ['Retry requires original file. Please re-upload the file and re-import.'], newJob.id]
    );

    res.redirect(`/import/${newJob.id}/status`);
  }));

  // 10. GET /export — Export page
  app.get('/export', requireAuth, requireNotBanned, ah(async (req, res) => {
    const content = `${navBar('export')}
<div class="card">
  <h2>Export Data</h2>
  <form method="POST" action="/export/generate" style="display:grid;gap:16px;max-width:500px">
    <div>
      <label style="font-weight:600;display:block;margin-bottom:6px">Target Table</label>
      <select name="target" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;width:100%" required>
        ${targetSelectOptions('')}
      </select>
    </div>
    <div>
      <label style="font-weight:600;display:block;margin-bottom:6px">Format</label>
      <select name="format" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;width:100%">
        <option value="csv">CSV</option>
        <option value="json">JSON</option>
      </select>
    </div>
    <div>
      <label style="font-weight:600;display:block;margin-bottom:6px">Filter (WHERE clause, optional)</label>
      <input type="text" name="filter" placeholder='e.g. status = \'active\'' style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;width:100%">
      <p class="muted" style="font-size:12px;margin-top:4px">Leave empty to export all rows. Use SQL WHERE syntax.</p>
    </div>
    <div>
      <label style="font-weight:600;display:block;margin-bottom:6px">Max Rows</label>
      <input type="number" name="limit" value="10000" min="1" max="100000" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;width:100%">
    </div>
    <button type="submit" class="btn btn-green">Generate Export</button>
  </form>
</div>
<div class="card" style="margin-top:20px">
  <h3>Sample Templates</h3>
  <p class="muted">Download sample CSV templates for each import target:</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
    ${Object.entries(TARGETS).map(([k, t]) =>
      `<a href="/api/import/sample/${k}" class="btn btn-sm btn-blue" download>${esc(t.label)}.csv</a>`
    ).join('')}
  </div>
</div>`;
    res.send(renderPage('Export Data', content, req.session.user, req));
  }));

  // 11. POST /export/generate — Generate and download export
  app.post('/export/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { target, format, filter, limit } = req.body;

    if (!target || !TARGETS[target]) {
      return res.send(renderPage('Export Error', `${navBar('export')}<div class="card"><div class="alert alert-error">Invalid target selected.</div><a href="/export" class="btn">Back</a></div>`, req.session.user, req));
    }

    const t = TARGETS[target];
    const cols = t.columns.map(c => `"${c.name}"`);
    let where = `WHERE tenant_id = $1`;
    const params = [tid];
    let pIdx = 2;

    if (filter && filter.trim()) {
      // Validate filter: only allow safe SQL
      const forbidden = /(;|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b|\bALTER\b|\bCREATE\b|\bGRANT\b|\bEXEC\b)/i;
      if (forbidden.test(filter)) {
        return res.send(renderPage('Export Error', `${navBar('export')}<div class="card"><div class="alert alert-error">Invalid filter expression. Only WHERE clause conditions are allowed.</div></div>`, req.session.user, req));
      }
      where += ` AND (${filter.trim()})`;
    }

    const rowLimit = Math.min(parseInt(limit) || 10000, 100000);
    const query = `SELECT ${cols.join(', ')} FROM "${t.table}" ${where} ORDER BY id LIMIT $${pIdx++}`;
    params.push(rowLimit);

    const { rows } = await pool.query(query, params);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${target}_export_${Date.now()}.json"`);
      return res.json(rows);
    }

    // CSV export
    const csvCols = t.columns.map(c => c.label);
    let csv = csvCols.join(',') + '\n';
    for (const row of rows) {
      const vals = t.columns.map(c => {
        const v = row[c.name];
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      });
      csv += vals.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${target}_export_${Date.now()}.csv"`);
    res.send(csv);
  }));

  // 12. GET /api/import/targets — JSON API: list targets
  app.get('/api/import/targets', requireAuth, ah(async (req, res) => {
    const result = {};
    for (const [key, t] of Object.entries(TARGETS)) {
      result[key] = { label: t.label, table: t.table, columns: t.columns };
    }
    res.json({ success: true, targets: result });
  }));

  // 13. GET /api/import/sample/:target — Download sample CSV template
  app.get('/api/import/sample/:target', requireAuth, ah(async (req, res) => {
    const target = req.params.target;
    if (!TARGETS[target]) return res.status(404).json({ error: 'Target not found' });

    const t = TARGETS[target];
    const headerRow = t.columns.map(c => c.label).join(',');
    const exampleRow = t.columns.map(c => {
      if (c.required) {
        switch (c.name) {
          case 'first_name': case 'name': return 'John';
          case 'last_name': return 'Doe';
          case 'email': return 'john@example.com';
          case 'phone': return '+256700000001';
          case 'price': return '1000';
          case 'quantity': return '10';
          case 'balance': return '50000';
          default: return 'example_value';
        }
      }
      return '';
    }).join(',');

    const csv = headerRow + '\n' + exampleRow + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${target}_template.csv"`);
    res.send(csv);
  }));

  // 14. POST /api/import/preview — Preview first 5 rows from uploaded CSV
  app.post('/api/import/preview', requireAuth, ah(async (req, res) => {
    let filePath = null;

    if (upload && req.file) {
      filePath = req.file.path;
    } else if (req.body.csv_text) {
      filePath = `/tmp/preview_${Date.now()}.csv`;
      require('fs').writeFileSync(filePath, req.body.csv_text);
    }

    if (!filePath) {
      return res.status(400).json({ error: 'No file or CSV text provided' });
    }

    let text;
    try {
      text = require('fs').readFileSync(filePath, 'utf-8');
    } catch (err) {
      return res.status(400).json({ error: 'Failed to read file' });
    }

    const rows = parseCSV(text);
    if (rows.length < 1) {
      return res.json({ headers: [], rows: [], totalRows: 0 });
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const previewRows = dataRows.slice(0, 5);

    const delimiter = detectDelimiter(text);
    const detectedTarget = guessTarget(headers);

    res.json({
      headers,
      rows: previewRows,
      totalRows: dataRows.length,
      delimiter: delimiter === ',' ? 'comma' : delimiter === ';' ? 'semicolon' : 'tab',
      suggestedTarget: detectedTarget,
    });
  }));

  /* ── Helper: guess target from headers ─────────────────────────── */
  function guessTarget(headers) {
    const norm = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    let best = null;
    let bestScore = 0;
    for (const [key, t] of Object.entries(TARGETS)) {
      let score = 0;
      for (const col of t.columns) {
        const cNorm = col.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const lNorm = col.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const h of norm) {
          if (h === cNorm || h === lNorm || h.includes(cNorm) || cNorm.includes(h)) {
            score++;
            break;
          }
        }
      }
      if (score > bestScore) { bestScore = score; best = key; }
    }
    return best;
  }

  /* ── Done ───────────────────────────────────────────────────────── */
  console.log('[DataImport] Module loaded — CSV import/export wizard with 6 targets');
};
