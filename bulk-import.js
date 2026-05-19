// ============================================================
// BULK IMPORT MODULE — Multi-Tenant School SaaS Portal
// CSV/Excel import for students, staff, parents with validation,
// column mapping, duplicate detection, import history & rollback.
// ============================================================
// Usage in server.js:
//   const bulkImport = require('./bulk-import');
//   bulkImport(app, pool, opts);
// ============================================================
// Tables this module creates:
//   import_history, import_errors
// Add to VALID_TABLES in server.js:
//   ['import_history','import_errors'].forEach(t => VALID_TABLES.add(t));
// ============================================================

'use strict';

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const { renderPage, ah, requireAuth, audit } = opts;

  // ── Inline fallbacks ──────────────────────────────────────
  const _auth = requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const _ah = ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const _audit = audit || (() => {});

  // ══════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ══════════════════════════════════════════════════════════
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS import_history (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          import_type VARCHAR(50) NOT NULL,
          filename VARCHAR(255),
          total_rows INT DEFAULT 0,
          imported_rows INT DEFAULT 0,
          skipped_rows INT DEFAULT 0,
          error_rows INT DEFAULT 0,
          status VARCHAR(20) DEFAULT 'completed',
          errors JSONB DEFAULT '[]',
          mapping JSONB DEFAULT '{}',
          performed_by VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS import_errors (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          import_id INT REFERENCES import_history(id) ON DELETE CASCADE,
          row_number INT,
          error_message TEXT,
          row_data JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_imp_hist_tenant ON import_history(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_imp_err_tenant ON import_errors(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_imp_err_import ON import_errors(import_id)`);
    } catch (e) { console.error('[BulkImport] Migration error:', e.message); }
  })();

  // ══════════════════════════════════════════════════════════
  // CSV PARSER (handles quoted fields, BOM, CRLF/LF)
  // ══════════════════════════════════════════════════════════
  function parseCSV(text) {
    if (!text || !text.trim()) return { headers: [], rows: [] };
    text = text.replace(/^\uFEFF/, ''); // strip BOM
    const allRows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { row.push(field.trim()); field = ''; }
        else if (c === '\r' && text[i + 1] === '\n') { i++; row.push(field.trim()); if (row.some(f => f)) allRows.push(row); row = []; field = ''; }
        else if (c === '\n') { row.push(field.trim()); if (row.some(f => f)) allRows.push(row); row = []; field = ''; }
        else { field += c; }
      }
    }
    row.push(field.trim());
    if (row.some(f => f)) allRows.push(row);
    if (allRows.length < 2) return { headers: [], rows: [] };
    const headers = allRows[0];
    const rows = allRows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] || ''; });
      return obj;
    });
    return { headers, rows };
  }

  // ══════════════════════════════════════════════════════════
  // TYPE CONFIGURATION
  // ══════════════════════════════════════════════════════════
  const TYPES = {
    students: {
      label: 'Students', icon: '🎓', table: 'students',
      fields: [
        { key: 'first_name', label: 'First Name', required: true },
        { key: 'last_name', label: 'Last Name', required: true },
        { key: 'email', label: 'Email', required: true, unique: true },
        { key: 'grade', label: 'Grade' },
        { key: 'section', label: 'Section' },
        { key: 'roll_number', label: 'Roll Number' },
        { key: 'date_of_birth', label: 'Date of Birth' },
        { key: 'gender', label: 'Gender' },
        { key: 'phone', label: 'Phone' },
        { key: 'address', label: 'Address' }
      ]
    },
    staff: {
      label: 'Staff', icon: '👨‍🏫', table: 'staff',
      fields: [
        { key: 'first_name', label: 'First Name', required: true },
        { key: 'last_name', label: 'Last Name', required: true },
        { key: 'email', label: 'Email', required: true, unique: true },
        { key: 'role', label: 'Role', required: true },
        { key: 'department', label: 'Department' },
        { key: 'phone', label: 'Phone' },
        { key: 'qualification', label: 'Qualification' },
        { key: 'experience_years', label: 'Experience (Years)' },
        { key: 'joining_date', label: 'Joining Date' }
      ]
    },
    parents: {
      label: 'Parents', icon: '👨‍👩‍👧', table: 'parents',
      fields: [
        { key: 'father_name', label: 'Father Name', required: true },
        { key: 'mother_name', label: 'Mother Name' },
        { key: 'email', label: 'Email', required: true, unique: true },
        { key: 'phone', label: 'Phone', required: true },
        { key: 'student_name', label: 'Student Name', required: true },
        { key: 'student_grade', label: 'Student Grade' },
        { key: 'relation', label: 'Relation' },
        { key: 'occupation', label: 'Occupation' },
        { key: 'address', label: 'Address' }
      ]
    }
  };

  // ══════════════════════════════════════════════════════════
  // AUTO COLUMN MAPPING
  // ══════════════════════════════════════════════════════════
  function autoMap(csvHeaders, fields) {
    const mapping = {};
    const used = new Set();
    for (const f of fields) {
      const t1 = f.label.toLowerCase();
      const t2 = f.key.toLowerCase().replace(/_/g, ' ');
      let best = null, bestScore = 0;
      for (const h of csvHeaders) {
        if (used.has(h)) continue;
        const hl = h.toLowerCase().trim();
        const hr = hl.replace(/[^a-z0-9]/g, '');
        const t1r = t1.replace(/[^a-z0-9]/g, '');
        const t2r = t2.replace(/[^a-z0-9]/g, '');
        if (hr === t1r || hr === t2r) { best = h; bestScore = 300; break; }
        if (hl === t1 || hl === t2) { best = h; bestScore = 250; }
        else {
          const score = (hl.includes(t1) ? 100 : 0) + (hl.includes(t2) ? 90 : 0) + (t1.includes(hl) ? 50 : 0) + (t2.includes(hl) ? 40 : 0);
          if (score > bestScore) { best = h; bestScore = score; }
        }
      }
      if (best) { mapping[f.key] = best; used.add(best); }
    }
    return mapping;
  }

  // ══════════════════════════════════════════════════════════
  // ROW VALIDATION (required fields, email format, duplicates)
  // ══════════════════════════════════════════════════════════
  async function validateRows(parsedRows, mapping, config, tid) {
    const emailField = config.fields.find(f => f.key === 'email');
    let existingEmails = new Set();
    if (emailField) {
      try {
        const res = await pool.query(`SELECT LOWER(email) AS email FROM ${config.table} WHERE tenant_id = $1`, [tid]);
        existingEmails = new Set(res.rows.map(r => r.email));
      } catch (_) { /* target table may not exist yet */ }
    }
    const csvEmails = new Set();
    const results = [];
    for (let i = 0; i < parsedRows.length; i++) {
      const raw = parsedRows[i];
      const errors = [];
      const mapped = {};
      for (const f of config.fields) {
        const csvCol = mapping[f.key];
        mapped[f.key] = csvCol ? (raw[csvCol] || '').trim() : '';
        if (f.required && !mapped[f.key]) errors.push(f.label + ' is required');
      }
      const email = mapped.email || '';
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Invalid email format');
        else {
          const el = email.toLowerCase();
          if (existingEmails.has(el)) errors.push('Email already exists in database');
          if (csvEmails.has(el)) errors.push('Duplicate email within CSV');
          csvEmails.add(el);
        }
      }
      results.push({ rowNumber: i + 1, valid: errors.length === 0, errors, data: mapped, raw });
    }
    return results;
  }

  // ══════════════════════════════════════════════════════════
  // SHARED STYLES
  // ══════════════════════════════════════════════════════════
  const CSS = `<style>
.imp-wrap{max-width:1100px;margin:0 auto;padding:24px}
.imp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.imp-head h1{font-size:1.6rem;font-weight:700;color:#1e1b4b;margin:0}
.imp-head p{color:#6b7280;margin:4px 0 0;font-size:.9rem}
.imp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.imp-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;transition:box-shadow .2s}
.imp-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.07)}
.imp-card .num{font-size:1.8rem;font-weight:700;color:#4f46e5}
.imp-card .lbl{font-size:.82rem;color:#6b7280;margin-top:2px}
.imp-tbl{width:100%;border-collapse:collapse;font-size:.88rem}
.imp-tbl th{background:#f8fafc;padding:10px 14px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;position:sticky;top:0;z-index:1}
.imp-tbl td{padding:8px 14px;border-bottom:1px solid #f3f4f6;color:#4b5563}
.imp-tbl tr:hover td{background:#f9fafb}
.imp-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:500;cursor:pointer;border:none;text-decoration:none;transition:all .15s}
.imp-btn-p{background:#4f46e5;color:#fff}.imp-btn-p:hover{background:#4338ca}
.imp-btn-o{background:#fff;color:#4f46e5;border:1px solid #c7d2fe}.imp-btn-o:hover{background:#eef2ff}
.imp-btn-d{background:#ef4444;color:#fff}.imp-btn-d:hover{background:#dc2626}
.imp-btn-s{padding:5px 12px;font-size:.78rem;border-radius:6px}
.imp-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.74rem;font-weight:600}
.imp-ok{background:#dcfce7;color:#166534}.imp-err{background:#fee2e2;color:#991b1b}
.imp-warn{background:#fef3c7;color:#92400e}.imp-info{background:#e0e7ff;color:#3730a3}
.imp-scroll{max-height:420px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px}
.imp-scroll::-webkit-scrollbar{width:6px}.imp-scroll::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
.drop-zone{border:2px dashed #d1d5db;border-radius:12px;padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:#f9fafb}
.drop-zone:hover,.drop-zone.over{border-color:#4f46e5;background:#eef2ff}
.drop-zone .dz-icon{font-size:2.5rem;margin-bottom:8px}
.map-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.map-row label{min-width:150px;font-weight:500;font-size:.88rem;color:#374151}
.map-row select{flex:1;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.88rem;max-width:260px}
.v-row{background:#f0fdf4!important}.i-row{background:#fef2f2!important}
.imp-progress{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:4px}
.imp-progress div{height:100%;border-radius:4px;transition:width .3s}
@media(max-width:768px){.imp-wrap{padding:16px}.imp-cards{grid-template-columns:1fr}.imp-head{flex-direction:column;align-items:flex-start}}
</style>`;

  // ── Nav helper ────────────────────────────────────────────
  function impNav(active) {
    const links = [
      ['Dashboard', '/school/import', '📦'],
      ['History', '/school/import/history', '📋'],
      ['Templates', '/school/import/templates', '📄'],
      ['Students', '/school/import/students', '🎓'],
      ['Staff', '/school/import/staff', '👨‍🏫'],
      ['Parents', '/school/import/parents', '👨‍👩‍👧']
    ];
    return '<div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap">' +
      links.map(([l, h, i]) => '<a href="' + h + '" class="imp-btn ' + (active === l ? 'imp-btn-p' : 'imp-btn-o imp-btn-s') + '">' + i + ' ' + l + '</a>').join('') +
      '</div>';
  }

  function statusBadge(s) {
    const m = { completed: 'imp-ok', rolled_back: 'imp-err', failed: 'imp-err', partial: 'imp-warn' };
    return '<span class="imp-badge ' + (m[s] || 'imp-info') + '">' + esc(s) + '</span>';
  }

  // ══════════════════════════════════════════════════════════
  // ROUTE 1: GET /school/import — Dashboard
  // ══════════════════════════════════════════════════════════
  app.get('/school/import', _auth, _ah(async (req, res) => {
    const tid = tenantId(req);
    const s = (await pool.query(`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='completed')::int AS done,
        COALESCE(SUM(total_rows),0)::int AS total_rows, COALESCE(SUM(imported_rows),0)::int AS imported,
        COALESCE(SUM(error_rows),0)::int AS total_errors
      FROM import_history WHERE tenant_id=$1`, [tid])).rows[0];
    const rate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const recent = (await pool.query(`SELECT * FROM import_history WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 12`, [tid])).rows;
    const typeStats = (await pool.query(
      `SELECT import_type, COUNT(*)::int AS cnt, COALESCE(SUM(imported_rows),0)::int AS imp, COALESCE(SUM(error_rows),0)::int AS errs
       FROM import_history WHERE tenant_id=$1 GROUP BY import_type ORDER BY cnt DESC`, [tid])).rows;
    const typeStatMap = {};
    for (const ts of typeStats) typeStatMap[ts.import_type] = ts;

    const typeCards = Object.entries(TYPES).map(([k, t]) => {
      const ts = typeStatMap[k];
      return '<a href="/school/import/' + k + '" class="imp-card" style="text-decoration:none;display:block">' +
      '<div style="font-size:1.8rem;margin-bottom:8px">' + t.icon + '</div>' +
      '<div style="font-weight:600;color:#1e1b4b">Import ' + t.label + '</div>' +
      '<div style="font-size:.8rem;color:#6b7280;margin-top:4px">' + t.fields.length + ' fields &bull; CSV upload</div>' +
      (ts ? '<div style="margin-top:8px;font-size:.75rem;color:#6b7280">' + ts.cnt + ' imports &bull; ' + ts.imp + ' rows &bull; ' + ts.errs + ' errors</div>' : '') +
      '</a>';
    }).join('');

    const rows = recent.map(r => '<tr>' +
      '<td>' + esc(r.filename || '—') + '</td>' +
      '<td><span class="imp-badge imp-info">' + esc(r.import_type) + '</span></td>' +
      '<td>' + r.total_rows + '</td>' +
      '<td style="color:#059669;font-weight:600">' + r.imported_rows + '</td>' +
      '<td style="color:' + (r.error_rows > 0 ? '#dc2626' : '#6b7280') + '">' + r.error_rows + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td>' + (r.created_at ? new Date(r.created_at).toLocaleDateString() : '—') + '</td>' +
      '<td><a href="/school/import/errors/' + r.id + '" class="imp-btn imp-btn-o imp-btn-s">Details</a>' +
      (r.status === 'completed' ? ' <form method="POST" action="/school/import/rollback/' + r.id + '" style="display:inline" onsubmit="return confirm(\'Rollback import # ' + r.id + '? This deletes ' + r.imported_rows + ' records.\')"><button class="imp-btn imp-btn-d imp-btn-s">Rollback</button></form>' : '') +
      '</td></tr>').join('');

    const body = CSS + '<div class="imp-wrap">' + impNav('Dashboard') +
      '<div class="imp-head"><div><h1>📦 Bulk Import</h1><p>Import students, staff, and parents from CSV files</p></div>' +
      '<a href="/school/import/templates" class="imp-btn imp-btn-o">⬇ Download Templates</a></div>' +
      '<div class="imp-cards">' +
      '<div class="imp-card"><div class="num">' + s.total + '</div><div class="lbl">Total Imports</div></div>' +
      '<div class="imp-card"><div class="num">' + rate + '%</div><div class="lbl">Success Rate</div></div>' +
      '<div class="imp-card"><div class="num">' + s.imported + '</div><div class="lbl">Rows Imported</div></div>' +
      '<div class="imp-card"><div class="num" style="color:' + (s.total_errors > 0 ? '#ef4444' : '#4f46e5') + '">' + s.total_errors + '</div><div class="lbl">Total Errors</div></div>' +
      '</div>' +
      '<div class="imp-card" style="margin-bottom:24px;padding:16px;background:#f8fafc;border-color:#e2e8f0">' +
      '<h3 style="margin:0 0 10px;font-size:.9rem;color:#374151">📈 Import Summary by Type</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">' +
      Object.entries(typeStatMap).map(([k, ts]) => {
        const t = TYPES[k];
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px;background:#fff;border-radius:8px;border:1px solid #e5e7eb">' +
          '<span style="font-size:1.2rem">' + (t ? t.icon : '📄') + '</span>' +
          '<div><div style="font-size:.82rem;font-weight:600;color:#1e293b">' + esc(k) + '</div>' +
          '<div style="font-size:.72rem;color:#6b7280">' + ts.cnt + ' imports &bull; ' + ts.imp + ' rows</div></div></div>';
      }).join('') +
      '</div></div>' +
      '<h2 style="font-size:1.1rem;font-weight:600;color:#374151;margin-bottom:12px">Quick Actions</h2>' +
      '<div class="imp-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:28px">' + typeCards + '</div>' +
      '<h2 style="font-size:1.1rem;font-weight:600;color:#374151;margin-bottom:12px">Recent Imports</h2>' +
      '<div class="imp-scroll"><table class="imp-tbl"><thead><tr><th>File</th><th>Type</th><th>Total</th><th>Imported</th><th>Errors</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:28px">No imports yet. Start by choosing a data type above.</td></tr>') + '</tbody></table></div></div>';
    res.send(renderPage(req, res, { title: 'Bulk Import Dashboard', content: body }));
  }));

  // ══════════════════════════════════════════════════════════
  // IMPORT PAGE BUILDER (shared for students / staff / parents)
  // ══════════════════════════════════════════════════════════
  function buildImportPage(type, req, res) {
    const c = TYPES[type];
    if (!c) return res.status(404).send('Invalid import type');
    const tags = c.fields.map(f =>
      '<span class="imp-badge ' + (f.required ? 'imp-err' : 'imp-info') + '">' + esc(f.label) + (f.required ? ' *' : '') + '</span>'
    ).join(' ');
    const body = CSS + '<div class="imp-wrap">' + impNav(c.label) +
      '<div class="imp-head"><div><h1>' + c.icon + ' Import ' + c.label + '</h1><p>Upload a CSV file to bulk import ' + c.label.toLowerCase() + ' data</p></div>' +
      '<a href="/school/import/templates" class="imp-btn imp-btn-o">⬇ Get Template</a></div>' +
      '<div class="imp-card" style="margin-bottom:20px"><h3 style="margin:0 0 10px;font-size:.95rem">Required Fields</h3>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' + tags + '</div></div>' +
      '<form id="impForm" method="POST" action="/school/import/' + type + '/preview">' +
      '<input type="hidden" name="csvData" id="csvData"><input type="hidden" name="filename" id="filename">' +
      '<div class="drop-zone" id="dropZone" onclick="document.getElementById(\'fileInput\').click()">' +
      '<div class="dz-icon">📁</div>' +
      '<div style="font-size:1.05rem;font-weight:600;color:#374151;margin-bottom:4px">Drop your CSV file here</div>' +
      '<div style="color:#6b7280;font-size:.88rem">or click to browse &bull; Supports .csv up to 10 MB</div>' +
      '<div id="fileInfo" style="display:none;margin-top:12px;padding:10px;background:#fff;border-radius:8px;text-align:left">' +
      '<span style="font-weight:600;color:#059669" id="fileName"></span>' +
      '<span style="color:#9ca3af;margin-left:8px" id="fileSize"></span></div></div>' +
      '<input type="file" id="fileInput" accept=".csv" style="display:none">' +
      '<div style="margin-top:16px;display:flex;gap:12px">' +
      '<button type="submit" id="uploadBtn" class="imp-btn imp-btn-p" disabled>📤 Upload &amp; Preview</button>' +
      '<a href="/school/import" class="imp-btn imp-btn-o">&larr; Back to Dashboard</a></div></form>' +
      '<script>(function(){var dz=document.getElementById("dropZone"),fi=document.getElementById("fileInput");' +
      '["dragenter","dragover"].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.add("over")})});' +
      '["dragleave","drop"].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.remove("over")})});' +
      'dz.addEventListener("drop",function(ev){if(ev.dataTransfer.files[0])handleFile(ev.dataTransfer.files[0])});' +
      'fi.addEventListener("change",function(){if(fi.files[0])handleFile(fi.files[0])});' +
      'function handleFile(f){if(!/\\.csv$/i.test(f.name)){alert("Please upload a CSV file");return}' +
      'document.getElementById("fileName").textContent=f.name;document.getElementById("fileSize").textContent=(f.size/1024).toFixed(1)+" KB";' +
      'document.getElementById("fileInfo").style.display="block";var r=new FileReader();' +
      'r.onload=function(e){document.getElementById("csvData").value=e.target.result;document.getElementById("filename").value=f.name;document.getElementById("uploadBtn").disabled=false};' +
      'r.readAsText(f)}})()</script></div>';
    res.send(renderPage(req, res, { title: 'Import ' + c.label, content: body }));
  }

  // ══════════════════════════════════════════════════════════
  // PREVIEW HANDLER (shared)
  // ══════════════════════════════════════════════════════════
  async function handlePreview(type, req, res) {
    const c = TYPES[type], tid = tenantId(req);
    const csvText = (req.body.csvData || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const filename = req.body.filename || 'upload.csv';
    if (!csvText.trim()) {
      const body = CSS + '<div class="imp-wrap"><div class="imp-card imp-err" style="padding:16px"><strong>&#9888; No data received.</strong> Please go back and upload a CSV file.</div>' +
        '<a href="/school/import/' + type + '" class="imp-btn imp-btn-o" style="margin-top:12px">&larr; Go Back</a></div>';
      return res.send(renderPage(req, res, { title: 'Import Error', content: body }));
    }
    const parsed = parseCSV(csvText);
    if (parsed.rows.length === 0) {
      const body = CSS + '<div class="imp-wrap"><div class="imp-card imp-err" style="padding:16px"><strong>&#9888; Could not parse CSV.</strong> Ensure your file has headers in the first row.</div>' +
        '<a href="/school/import/' + type + '" class="imp-btn imp-btn-o" style="margin-top:12px">&larr; Go Back</a></div>';
      return res.send(renderPage(req, res, { title: 'Import Error', content: body }));
    }
    const mapping = autoMap(parsed.headers, c.fields);
    const validated = await validateRows(parsed.rows, mapping, c, tid);
    const validN = validated.filter(v => v.valid).length, invalidN = validated.length - validN;
    const preview = validated.slice(0, 100);

    const mapSelects = c.fields.map(f => {
      const opts = parsed.headers.map(h =>
        '<option value="' + esc(h) + '"' + (mapping[f.key] === h ? ' selected' : '') + '>' + esc(h) + '</option>'
      ).join('');
      return '<div class="map-row"><label>' + esc(f.label) + (f.required ? ' <span style="color:#ef4444">*</span>' : '') + '</label>' +
        '<select name="map_' + f.key + '">' + opts + '<option value="">— Skip —</option></select></div>';
    }).join('');

    const tRows = preview.map(v => '<tr class="' + (v.valid ? 'v-row' : 'i-row') + '">' +
      '<td style="font-weight:600">#' + v.rowNumber + '</td><td>' +
      (v.valid ? '<span class="imp-badge imp-ok">&#10003; Valid</span>' :
        '<span class="imp-badge imp-err">&#10007; ' + esc(v.errors.join('; ')) + '</span>') + '</td>' +
      c.fields.slice(0, 4).map(f => '<td>' + esc(v.data[f.key] || '—') + '</td>').join('') +
      (c.fields.length > 4 ? '<td style="color:#9ca3af">…</td>' : '') + '</tr>').join('');

    const body = CSS + '<div class="imp-wrap">' + impNav(c.label) +
      '<div class="imp-head"><div><h1>👀 Preview: ' + esc(filename) + '</h1>' +
      '<p>' + parsed.rows.length + ' rows found &bull; <span style="color:#059669;font-weight:600">' + validN + ' valid</span> &bull; <span style="color:#dc2626;font-weight:600">' + invalidN + ' invalid</span></p></div></div>' +
      '<div class="imp-card" style="margin-bottom:16px"><h3 style="margin:0 0 10px;font-size:.95rem">Column Mapping</h3>' +
      mapSelects +
      '<p style="font-size:.78rem;color:#9ca3af;margin-top:8px">Adjust mappings if columns were not auto-detected correctly.</p></div>' +
      '<form method="POST" action="/school/import/' + type + '/confirm">' +
      '<input type="hidden" name="csvData" value="' + esc(csvText) + '">' +
      '<input type="hidden" name="filename" value="' + esc(filename) + '">' +
      '<div class="imp-scroll" style="margin-bottom:16px"><table class="imp-tbl"><thead><tr><th>#</th><th>Status</th>' +
      c.fields.slice(0, 4).map(f => '<th>' + esc(f.label) + '</th>').join('') +
      (c.fields.length > 4 ? '<th></th>' : '') + '</tr></thead><tbody>' + tRows + '</tbody></table></div>' +
      (parsed.rows.length > 100 ? '<p style="color:#6b7280;font-size:.82rem;margin-bottom:12px">Showing first 100 of ' + parsed.rows.length + ' rows.</p>' : '') +
      '<div style="display:flex;gap:12px;align-items:center">' +
      '<button type="submit" class="imp-btn imp-btn-p"' + (validN === 0 ? ' disabled style="opacity:.5;cursor:not-allowed"' : '') + '>✅ Confirm Import (' + validN + ' rows)</button>' +
      '<a href="/school/import/' + type + '" class="imp-btn imp-btn-o">&larr; Cancel</a></div></form></div>';
    res.send(renderPage(req, res, { title: 'Preview Import — ' + c.label, content: body }));
  }

  // ══════════════════════════════════════════════════════════
  // CONFIRM HANDLER (shared)
  // ══════════════════════════════════════════════════════════
  async function handleConfirm(type, req, res) {
    const c = TYPES[type], tid = tenantId(req);
    const csvText = (req.body.csvData || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const filename = req.body.filename || 'upload.csv';
    const mapping = {};
    for (const f of c.fields) { const v = req.body['map_' + f.key]; if (v) mapping[f.key] = v; }
    const parsed = parseCSV(csvText);
    const validated = await validateRows(parsed.rows, mapping, c, tid);
    const validRows = validated.filter(v => v.valid);
    const invalidRows = validated.filter(v => !v.valid);
    const importedIds = [];

    try {
      const cols = c.fields.map(f => '"' + f.key + '"').join(', ');
      const phs = c.fields.map((_, i) => '$' + (i + 2)).join(', ');
      for (const row of validRows) {
        const vals = c.fields.map(f => row.data[f.key] || null);
        try {
          const r = await pool.query(
            'INSERT INTO ' + c.table + ' (tenant_id, ' + cols + ') VALUES ($1, ' + phs + ') RETURNING id',
            [tid, ...vals]);
          importedIds.push(r.rows[0].id);
        } catch (e) { invalidRows.push({ rowNumber: row.rowNumber, errors: [e.message], data: row.data }); }
      }
    } catch (e) {
      const body = CSS + '<div class="imp-wrap"><div class="imp-card imp-err" style="padding:20px"><h2 style="margin:0 0 8px">&#9888; Import Failed</h2>' +
        '<p style="color:#6b7280">Could not insert into table <strong>' + esc(c.table) + '</strong>. Ensure the table exists with the correct schema.</p>' +
        '<pre style="margin-top:8px;padding:12px;background:#f1f5f9;border-radius:8px;font-size:.8rem;overflow-x:auto">' + esc(e.message) + '</pre></div>' +
        '<a href="/school/import" class="imp-btn imp-btn-o" style="margin-top:16px">&larr; Dashboard</a></div>';
      return res.send(renderPage(req, res, { title: 'Import Error', content: body }));
    }

    const histR = await pool.query(
      `INSERT INTO import_history (tenant_id, import_type, filename, total_rows, imported_rows, skipped_rows, error_rows, status, mapping, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid, type, filename, validated.length, importedIds.length, 0, invalidRows.length, 'completed',
        JSON.stringify({ mapping, imported_ids: importedIds }), req.session?.user?.name || 'Unknown']);
    const histId = histR.rows[0].id;

    for (const err of invalidRows) {
      await pool.query(
        `INSERT INTO import_errors (tenant_id, import_id, row_number, error_message, row_data) VALUES ($1,$2,$3,$4,$5)`,
        [tid, histId, err.rowNumber, err.errors.join('; '), JSON.stringify(err.data)]);
    }
    _audit(req, 'bulk_import', 'Imported ' + importedIds.length + ' ' + type + ' from ' + filename);

    const body = CSS + '<div class="imp-wrap" style="text-align:center;padding-top:60px">' +
      '<div style="font-size:3rem;margin-bottom:16px">🎉</div>' +
      '<h1 style="color:#059669">Import Complete!</h1>' +
      '<p style="color:#6b7280;font-size:1.05rem;margin-bottom:24px">Successfully imported <strong>' + importedIds.length + '</strong> ' + c.label.toLowerCase() +
      (invalidRows.length > 0 ? ' with <strong style="color:#dc2626">' + invalidRows.length + ' errors</strong>' : '') + '</p>' +
      '<div class="imp-cards" style="max-width:500px;margin:0 auto 24px">' +
      '<div class="imp-card"><div class="num">' + validated.length + '</div><div class="lbl">Total Rows</div></div>' +
      '<div class="imp-card"><div class="num" style="color:#059669">' + importedIds.length + '</div><div class="lbl">Imported</div></div>' +
      '<div class="imp-card"><div class="num" style="color:#dc2626">' + invalidRows.length + '</div><div class="lbl">Errors</div></div></div>' +
      '<div style="display:flex;gap:12px;justify-content:center">' +
      (invalidRows.length > 0 ? '<a href="/school/import/errors/' + histId + '" class="imp-btn imp-btn-o">📋 View Errors</a>' : '') +
      '<a href="/school/import" class="imp-btn imp-btn-p">&larr; Dashboard</a></div></div>';
    res.send(renderPage(req, res, { title: 'Import Complete', content: body }));
  }

  // ══════════════════════════════════════════════════════════
  // ROUTES 2-10: Student / Staff / Parents (GET + preview + confirm)
  // ══════════════════════════════════════════════════════════
  ['students', 'staff', 'parents'].forEach(type => {
    app.get('/school/import/' + type, _auth, _ah((req, res) => buildImportPage(type, req, res)));
    app.post('/school/import/' + type + '/preview', _auth, _ah(async (req, res) => handlePreview(type, req, res)));
    app.post('/school/import/' + type + '/confirm', _auth, _ah(async (req, res) => handleConfirm(type, req, res)));
  });

  // ══════════════════════════════════════════════════════════
  // ROUTE 11: GET /school/import/history — Import History
  // ══════════════════════════════════════════════════════════
  app.get('/school/import/history', _auth, _ah(async (req, res) => {
    const tid = tenantId(req);
    const { type: typeFilter, status: statusFilter } = req.query;
    let where = 'WHERE tenant_id=$1', params = [tid], pi = 2;
    if (typeFilter) { where += ' AND import_type=$' + pi++; params.push(typeFilter); }
    if (statusFilter) { where += ' AND status=$' + pi++; params.push(statusFilter); }
    const { rows } = await pool.query(
      `SELECT * FROM import_history ${where} ORDER BY created_at DESC LIMIT 100`, params);

    const tRows = rows.map(r => {
      const pct = r.total_rows > 0 ? Math.round((r.imported_rows / r.total_rows) * 100) : 0;
      const barCol = pct > 80 ? '#059669' : pct > 50 ? '#d97706' : '#dc2626';
      return '<tr><td style="font-weight:600">#' + r.id + '</td>' +
        '<td>' + esc(r.filename || '—') + '</td>' +
        '<td><span class="imp-badge imp-info">' + esc(r.import_type) + '</span></td>' +
        '<td>' + r.total_rows + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;min-width:60px"><div class="imp-progress"><div style="width:' + pct + '%;background:' + barCol + '"></div></div></div>' +
        '<span style="font-size:.78rem;font-weight:600;color:#374151">' + pct + '%</span></div></td>' +
        '<td style="color:' + (r.error_rows > 0 ? '#dc2626' : '#6b7280') + '">' + r.error_rows + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td>' + esc(r.performed_by || '—') + '</td>' +
        '<td>' + (r.created_at ? new Date(r.created_at).toLocaleString() : '—') + '</td>' +
        '<td><a href="/school/import/errors/' + r.id + '" class="imp-btn imp-btn-o imp-btn-s">Errors</a> ' +
        (r.status === 'completed' ? '<form method="POST" action="/school/import/rollback/' + r.id + '" style="display:inline" onsubmit="return confirm(\'Rollback # ' + r.id + '?\')"><button class="imp-btn imp-btn-d imp-btn-s">Rollback</button></form>' : '') +
        '</td></tr>';
    }).join('');

    const typeOpts = Object.entries(TYPES).map(([k, t]) =>
      '<option value="' + k + '"' + (typeFilter === k ? ' selected' : '') + '>' + t.label + '</option>').join('');
    const statusOpts = ['completed', 'rolled_back'].map(s =>
      '<option value="' + s + '"' + (statusFilter === s ? ' selected' : '') + '>' + s + '</option>').join('');

    const body = CSS + '<div class="imp-wrap">' + impNav('History') +
      '<div class="imp-head"><div><h1>📋 Import History</h1><p>Complete log of all bulk import operations</p></div>' +
      '<a href="/school/import" class="imp-btn imp-btn-o">&larr; Dashboard</a></div>' +
      '<div class="imp-card" style="margin-bottom:16px;padding:16px">' +
      '<form method="GET" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">' +
      '<div><label style="font-size:.78rem;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Type</label><select name="type" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem">' +
      '<option value="">All Types</option>' + typeOpts + '</select></div>' +
      '<div><label style="font-size:.78rem;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Status</label><select name="status" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem">' +
      '<option value="">All Statuses</option>' + statusOpts + '</select></div>' +
      '<button type="submit" class="imp-btn imp-btn-p imp-btn-s">Filter</button>' +
      '<a href="/school/import/history" class="imp-btn imp-btn-o imp-btn-s">Clear</a></form></div>' +
      '<div class="imp-scroll"><table class="imp-tbl"><thead><tr><th>ID</th><th>File</th><th>Type</th><th>Total</th><th>Success</th><th>Errors</th><th>Status</th><th>By</th><th>Date</th><th>Actions</th></tr></thead>' +
      '<tbody>' + (tRows || '<tr><td colspan="10" style="text-align:center;color:#9ca3af;padding:32px">No import history found.</td></tr>') + '</tbody></table></div></div>';
    res.send(renderPage(req, res, { title: 'Import History', content: body }));
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE 12: GET /school/import/templates — CSV Templates
  // ══════════════════════════════════════════════════════════
  app.get('/school/import/templates', _auth, _ah(async (req, res) => {
    const sampleData = {
      students: ['John', 'Doe', 'john.doe@school.com', '10', 'A', '101', '2010-05-15', 'Male', '+1234567890', '123 Main St'],
      staff: ['Jane', 'Smith', 'jane.smith@school.com', 'Teacher', 'Mathematics', '+1234567891', 'M.Ed', '5', '2020-08-01'],
      parents: ['Robert', 'Mary', 'robert.doe@email.com', '+1234567892', 'John Doe', '10', 'Father', 'Engineer', '123 Main St']
    };
    const cards = Object.entries(TYPES).map(([key, t]) => {
      const headers = t.fields.map(f => f.label).join(',');
      const sample = sampleData[key].join(',');
      const sample2 = sample.replace(/John/g, 'Alice').replace(/Doe/g, 'Johnson').replace(/jane/g, 'bob').replace(/Smith/g, 'Williams').replace(/\+1234567890/, '+1234567893');
      const sample3 = sample.replace(/John/g, 'Emma').replace(/Doe/g, 'Brown').replace(/jane/g, 'carol').replace(/Smith/g, 'Davis').replace(/\+1234567890/, '+1234567894');
      const csv = headers + '\n' + sample + '\n' + sample2 + '\n' + sample3;
      const b64 = Buffer.from(csv).toString('base64');
      return '<div class="imp-card" style="text-align:center">' +
        '<div style="font-size:2rem;margin-bottom:8px">' + t.icon + '</div>' +
        '<h3 style="margin:0 0 4px;font-size:1.05rem">' + t.label + '</h3>' +
        '<p style="color:#6b7280;font-size:.82rem;margin-bottom:12px">' + t.fields.length + ' fields &bull; ' + t.fields.filter(f => f.required).length + ' required</p>' +
        '<div style="font-size:.76rem;color:#9ca3af;margin-bottom:12px;padding:8px;background:#f8fafc;border-radius:6px;text-align:left;font-family:monospace;overflow-x:auto;white-space:nowrap">' +
        esc(t.fields.slice(0, 5).map(f => f.label).join(', ')) + ', ...</div>' +
        '<a href="data:text/csv;base64,' + b64 + '" download="' + key + '_template.csv" class="imp-btn imp-btn-p" style="width:100%;justify-content:center">⬇ Download Template</a></div>';
    }).join('');

    const body = CSS + '<div class="imp-wrap">' + impNav('Templates') +
      '<div class="imp-head"><div><h1>📄 Import Templates</h1><p>Download CSV templates with correct column headers</p></div>' +
      '<a href="/school/import" class="imp-btn imp-btn-o">&larr; Dashboard</a></div>' +
      '<div class="imp-card" style="margin-bottom:20px;background:#eef2ff;border-color:#c7d2fe;padding:20px">' +
      '<h3 style="margin:0 0 8px;color:#3730a3">💡 Tips for Successful Import</h3>' +
      '<ul style="margin:0;padding-left:20px;color:#4338ca;font-size:.86rem;line-height:1.8">' +
      '<li>Use the exact column headers from the template</li>' +
      '<li>Required fields (marked *) must not be empty</li>' +
      '<li>Email addresses must be unique — no duplicates in file or database</li>' +
      '<li>Save your file as CSV (comma-separated values) with UTF-8 encoding</li>' +
      '<li>Maximum file size: 10 MB &bull; Maximum rows: 10,000 per import</li></ul></div>' +
      '<div class="imp-cards" style="grid-template-columns:repeat(3,1fr)">' + cards + '</div></div>';
    res.send(renderPage(req, res, { title: 'Import Templates', content: body }));
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE 13: GET /school/import/errors/:id — Error Details
  // ══════════════════════════════════════════════════════════
  app.get('/school/import/errors/:id', _auth, _ah(async (req, res) => {
    const tid = tenantId(req), importId = parseInt(req.params.id);
    const hist = (await pool.query(`SELECT * FROM import_history WHERE id=$1 AND tenant_id=$2`, [importId, tid])).rows;
    if (!hist[0]) {
      const body = CSS + '<div class="imp-wrap"><div class="imp-card" style="padding:20px;text-align:center"><p style="color:#6b7280">Import record not found.</p>' +
        '<a href="/school/import/history" class="imp-btn imp-btn-o" style="margin-top:12px">&larr; History</a></div></div>';
      return res.send(renderPage(req, res, { title: 'Not Found', content: body }));
    }
    const h = hist[0];
    const errors = (await pool.query(
      `SELECT * FROM import_errors WHERE import_id=$1 AND tenant_id=$2 ORDER BY row_number`, [h.id, tid])).rows;

    const eRows = errors.map(e => {
      const data = typeof e.row_data === 'string' ? JSON.parse(e.row_data) : (e.row_data || {});
      const dataStr = Object.entries(data).filter(([, v]) => v).map(([k, v]) =>
        '<strong style="color:#374151">' + esc(k) + ':</strong> ' + esc(String(v))).join(', ');
      return '<tr><td style="font-weight:600;white-space:nowrap">Row #' + e.row_number + '</td>' +
        '<td><span class="imp-badge imp-err">' + esc(e.error_message) + '</span></td>' +
        '<td style="font-size:.84rem;color:#6b7280;max-width:300px">' + (dataStr || '—') + '</td>' +
        '<td style="white-space:nowrap">' + (e.created_at ? new Date(e.created_at).toLocaleString() : '—') + '</td></tr>';
    }).join('');

    const body = CSS + '<div class="imp-wrap">' + impNav('History') +
      '<div class="imp-head"><div><h1>⚠ Import Errors — #' + h.id + '</h1>' +
      '<p>' + esc(h.filename) + ' &bull; ' + esc(h.import_type) + ' &bull; ' + (h.created_at ? new Date(h.created_at).toLocaleString() : '') + '</p></div>' +
      '<a href="/school/import/history" class="imp-btn imp-btn-o">&larr; History</a></div>' +
      '<div class="imp-cards" style="margin-bottom:20px">' +
      '<div class="imp-card"><div class="num">' + h.total_rows + '</div><div class="lbl">Total Rows</div></div>' +
      '<div class="imp-card"><div class="num" style="color:#059669">' + h.imported_rows + '</div><div class="lbl">Imported</div></div>' +
      '<div class="imp-card"><div class="num" style="color:#dc2626">' + h.error_rows + '</div><div class="lbl">Errors</div></div></div>' +
      (errors.length > 0 ?
        '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">' +
        '<span class="imp-badge imp-err" style="font-size:.82rem;padding:5px 14px">' + errors.length + ' error(s) found</span>' +
        '<span style="font-size:.82rem;color:#6b7280">across ' + h.total_rows + ' total rows</span></div>' +
        '<div class="imp-scroll"><table class="imp-tbl"><thead><tr><th>Row</th><th>Error</th><th>Row Data</th><th>Time</th></tr></thead>' +
        '<tbody>' + eRows + '</tbody></table></div>' +
        '<div style="margin-top:16px;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">' +
        '<h3 style="margin:0 0 8px;font-size:.9rem;color:#374151">💡 Common Fixes</h3>' +
        '<ul style="margin:0;padding-left:18px;color:#6b7280;font-size:.84rem;line-height:1.7">' +
        '<li>Ensure required fields are not empty for each row</li>' +
        '<li>Check for duplicate email addresses within your CSV file</li>' +
        '<li>Verify email format follows name@domain.com pattern</li>' +
        '<li>Remove any rows with emails already in the database</li></ul></div>' :
        '<div class="imp-card" style="text-align:center;padding:28px;color:#059669;font-weight:600">✅ No errors recorded for this import. All ' + h.imported_rows + ' rows were imported successfully.</div>') +
      '</div>';
    res.send(renderPage(req, res, { title: 'Import Errors #' + h.id, content: body }));
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE 14: POST /school/import/rollback/:id — Rollback
  // ══════════════════════════════════════════════════════════
  app.post('/school/import/rollback/:id', _auth, _ah(async (req, res) => {
    const tid = tenantId(req), importId = parseInt(req.params.id);
    const hist = (await pool.query(`SELECT * FROM import_history WHERE id=$1 AND tenant_id=$2`, [importId, tid])).rows;
    if (!hist[0]) {
      const body = CSS + '<div class="imp-wrap"><div class="imp-card" style="padding:20px;text-align:center"><p style="color:#6b7280">Import record not found.</p>' +
        '<a href="/school/import/history" class="imp-btn imp-btn-o" style="margin-top:12px">&larr; History</a></div></div>';
      return res.send(renderPage(req, res, { title: 'Not Found', content: body }));
    }
    const h = hist[0];
    if (h.status !== 'completed') {
      const body = CSS + '<div class="imp-wrap" style="text-align:center;padding-top:40px"><div style="font-size:2rem;margin-bottom:12px">⚠️</div>' +
        '<h2>Cannot Rollback</h2><p style="color:#6b7280">This import has already been rolled back or is not in a valid state.</p>' +
        '<a href="/school/import/history" class="imp-btn imp-btn-o" style="margin-top:16px">&larr; History</a></div>';
      return res.send(renderPage(req, res, { title: 'Rollback Error', content: body }));
    }

    const mapping = typeof h.mapping === 'string' ? JSON.parse(h.mapping) : (h.mapping || {});
    const config = TYPES[h.import_type];
    const ids = mapping.imported_ids || [];
    let deletedCount = 0;

    if (ids.length > 0 && config) {
      try {
        const result = await pool.query(
          'DELETE FROM ' + config.table + ' WHERE id = ANY($1) AND tenant_id = $2', [ids, tid]);
        deletedCount = result.rowCount || 0;
      } catch (e) { console.warn('[BulkImport] Rollback delete error:', e.message); }
    }

    await pool.query(
      'UPDATE import_history SET status = $1, mapping = $2 WHERE id = $3',
      ['rolled_back', JSON.stringify({ ...mapping, rollback_deleted: deletedCount, rollback_at: new Date().toISOString() }), importId]);
    _audit(req, 'import_rollback', 'Rolled back import #' + importId + ' (' + deletedCount + ' rows deleted)');

    const body = CSS + '<div class="imp-wrap" style="text-align:center;padding-top:60px">' +
      '<div style="font-size:3rem;margin-bottom:16px">↩️</div>' +
      '<h1 style="color:#4f46e5">Rollback Complete</h1>' +
      '<p style="color:#6b7280;font-size:1.05rem;margin-bottom:24px">Import <strong>#' + importId + '</strong> has been rolled back.<br>' +
      '<strong>' + deletedCount + '</strong> records were deleted from <strong>' + esc(h.import_type) + '</strong>.</p>' +
      '<div class="imp-cards" style="max-width:400px;margin:0 auto 24px">' +
      '<div class="imp-card"><div class="num" style="color:#dc2626">' + deletedCount + '</div><div class="lbl">Records Deleted</div></div>' +
      '<div class="imp-card"><div class="num">' + esc(h.import_type) + '</div><div class="lbl">Target Table</div></div></div>' +
      '<div style="display:flex;gap:12px;justify-content:center">' +
      '<a href="/school/import/history" class="imp-btn imp-btn-p">&larr; Import History</a>' +
      '<a href="/school/import" class="imp-btn imp-btn-o">Dashboard</a></div></div>';
    res.send(renderPage(req, res, { title: 'Rollback Complete', content: body }));
  }));
};
