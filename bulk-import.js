// ============================================================
// BULK CSV IMPORT MODULE — Multi-Tenant SaaS Platform
// Import students, members, patients, clients, users, invoices
// with CSV template download, validation, preview, confirm & history.
// ============================================================
// Usage in server.js:
//   const m = require('./bulk-import');
//   m(app, pool, requireAuth, ah, esc, renderPage, logger, audit);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
const crypto = require('crypto');

module.exports = function (app, pool, requireAuth, ah, esc, renderPage, logger, audit) {

  // ── Fallbacks in case any arg is missing ──────────────────
  const _auth = requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const _ah = ah || (fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const _esc = esc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const _logger = logger || { info: console.log, error: console.error, warn: console.warn };
  const _audit = audit || (() => {});

  // ── Multer setup for file upload ──────────────────────────
  let upload;
  try {
    const multer = require('multer');
    upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
    });
  } catch (_) {
    upload = null;
  }

  // ══════════════════════════════════════════════════════════
  // DATABASE MIGRATION
  // ══════════════════════════════════════════════════════════
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS import_logs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          import_type VARCHAR(50) NOT NULL,
          filename VARCHAR(255),
          total_rows INTEGER DEFAULT 0,
          created_rows INTEGER DEFAULT 0,
          skipped_rows INTEGER DEFAULT 0,
          failed_rows INTEGER DEFAULT 0,
          errors JSONB DEFAULT '[]',
          status VARCHAR(20) DEFAULT 'completed',
          imported_by INTEGER REFERENCES users(id),
          csv_data TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await migrateQuery(pool, 'BulkImport', `CREATE INDEX IF NOT EXISTS idx_import_logs_tenant ON import_logs(tenant_id)`);
      await migrateQuery(pool, 'BulkImport', `CREATE INDEX IF NOT EXISTS idx_import_logs_type ON import_logs(import_type)`);
      // Add csv_data column if missing (for re-download)
      await migrateQuery(pool, 'BulkImport', `ALTER TABLE import_logs ADD COLUMN IF NOT EXISTS csv_data TEXT`);
      _logger.info('[BulkImport] Database tables ready');
    } catch (e) {
      _logger.error('[BulkImport] Migration error: ' + e.message);
    }
  })();

  // ══════════════════════════════════════════════════════════
  // IMPORT TYPE CONFIGURATION
  // ══════════════════════════════════════════════════════════
  const IMPORT_TYPES = {
    students: {
      label: 'Students',
      icon: '&#x1F393;',
      description: 'Import student records with admission details and guardian info',
      table: 'students',
      columns: [
        { key: 'admission_no', label: 'Admission No', required: true, unique: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'class', label: 'Class', required: false },
        { key: 'stream', label: 'Stream', required: false },
        { key: 'gender', label: 'Gender', required: false },
        { key: 'dob', label: 'Date of Birth', required: false },
        { key: 'guardian_name', label: 'Guardian Name', required: false },
        { key: 'guardian_phone', label: 'Guardian Phone', required: false },
        { key: 'email', label: 'Email', required: false, unique: true }
      ],
      examples: [
        ['STD001', 'John Mukasa', 'S1', 'A', 'Male', '2010-03-15', 'James Mukasa', '+256771234567', 'john@school.ug'],
        ['STD002', 'Mary Nakamya', 'S2', 'B', 'Female', '2009-07-22', 'Grace Nakamya', '+256772345678', 'mary@school.ug']
      ]
    },
    members: {
      label: 'Church Members',
      icon: '&#x1F54C;',
      description: 'Import church member records with contact and group information',
      table: 'members',
      columns: [
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: false, unique: true },
        { key: 'phone', label: 'Phone', required: false },
        { key: 'address', label: 'Address', required: false },
        { key: 'group', label: 'Group', required: false },
        { key: 'joined_date', label: 'Joined Date', required: false }
      ],
      examples: [
        ['Pastor James Okello', 'james@church.ug', '+256771111111', 'Kampala', 'Choir', '2020-01-15'],
        ['Sarah Apio', 'sarah@church.ug', '+256772222222', 'Entebbe', 'Ushers', '2021-06-20']
      ]
    },
    patients: {
      label: 'Patients',
      icon: '&#x1F3E5;',
      description: 'Import patient records with medical and next-of-kin details',
      table: 'patients',
      columns: [
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: false, unique: true },
        { key: 'phone', label: 'Phone', required: false },
        { key: 'dob', label: 'Date of Birth', required: false },
        { key: 'gender', label: 'Gender', required: false },
        { key: 'address', label: 'Address', required: false },
        { key: 'next_of_kin', label: 'Next of Kin', required: false },
        { key: 'medical_notes', label: 'Medical Notes', required: false }
      ],
      examples: [
        ['Emily Nalubega', 'emily@mail.ug', '+256773333333', '1985-09-10', 'Female', 'Makindye', 'Robert Nalubega', 'No known allergies'],
        ['David Ochieng', 'david@mail.ug', '+256774444444', '1978-02-28', 'Male', 'Nansana', 'Jane Ochieng', 'Diabetic']
      ]
    },
    clients: {
      label: 'Clients / Customers',
      icon: '&#x1F4BC;',
      description: 'Import client or customer records with contact information',
      table: 'clients',
      columns: [
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: false, unique: true },
        { key: 'phone', label: 'Phone', required: false },
        { key: 'address', label: 'Address', required: false },
        { key: 'city', label: 'City', required: false }
      ],
      examples: [
        ['Acme Ltd', 'info@acme.ug', '+256775555555', 'Plot 12 Kampala Rd', 'Kampala'],
        ['TechHub Uganda', 'hello@techhub.ug', '+256776666666', 'Kira Road', 'Kampala']
      ]
    },
    users: {
      label: 'Users / Staff',
      icon: '&#x1F464;',
      description: 'Import user or staff accounts with role assignments',
      table: 'users',
      columns: [
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: true, unique: true },
        { key: 'phone', label: 'Phone', required: false },
        { key: 'role', label: 'Role', required: false }
      ],
      examples: [
        ['Alice Kyomuhendo', 'alice@org.ug', '+256777777777', 'admin'],
        ['Bob Tumusiime', 'bob@org.ug', '+256778888888', 'staff']
      ]
    },
    invoices: {
      label: 'Invoices',
      icon: '&#x1F4CB;',
      description: 'Import invoice records with client and payment details',
      table: 'invoices',
      columns: [
        { key: 'invoice_no', label: 'Invoice No', required: true, unique: true },
        { key: 'client_name', label: 'Client Name', required: true },
        { key: 'amount', label: 'Amount', required: true },
        { key: 'due_date', label: 'Due Date', required: false },
        { key: 'status', label: 'Status', required: false },
        { key: 'description', label: 'Description', required: false }
      ],
      examples: [
        ['INV-001', 'Acme Ltd', '500000', '2025-04-30', 'pending', 'Web development'],
        ['INV-002', 'TechHub', '250000', '2025-05-15', 'paid', 'Consulting fee']
      ]
    }
  };

  // ══════════════════════════════════════════════════════════
  // CSV PARSER (handles BOM, quoted fields, mixed line endings)
  // ══════════════════════════════════════════════════════════
  function parseCSV(text) {
    if (!text || !text.trim()) return { headers: [], rows: [] };

    // Strip UTF-8 BOM (Excel exports often include this)
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/^\uFEFF/, '');

    const allRows = [];
    let row = [], field = '', inQ = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') {
          // Escaped quote ""
          field += '"'; i++;
        } else if (c === '"') {
          // End of quoted field
          inQ = false;
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQ = true;
        } else if (c === ',') {
          row.push(field.trim()); field = '';
        } else if (c === '\r' && text[i + 1] === '\n') {
          // CRLF
          i++; row.push(field.trim());
          if (row.some(f => f !== '')) allRows.push(row);
          row = []; field = '';
        } else if (c === '\r') {
          // Bare CR
          row.push(field.trim());
          if (row.some(f => f !== '')) allRows.push(row);
          row = []; field = '';
        } else if (c === '\n') {
          // LF
          row.push(field.trim());
          if (row.some(f => f !== '')) allRows.push(row);
          row = []; field = '';
        } else {
          field += c;
        }
      }
    }
    // Last field/row
    row.push(field.trim());
    if (row.some(f => f !== '')) allRows.push(row);

    if (allRows.length < 1) return { headers: [], rows: [] };

    const headers = allRows[0].map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
    const rows = allRows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
    return { headers, rows };
  }

  // ══════════════════════════════════════════════════════════
  // VALIDATION HELPERS
  // ══════════════════════════════════════════════════════════
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Uganda phone: +256XXXXXXXXX or 0XXXXXXXXX, 10-13 digits
  const PHONE_RE = /^(\+?256|0)?\d{9}$/;

  function validateEmail(v) { return !v || EMAIL_RE.test(v); }
  function validatePhone(v) {
    if (!v) return true;
    const cleaned = v.replace(/[\s\-\(\)]/g, '');
    return PHONE_RE.test(cleaned);
  }

  function validateRow(row, config, tid) {
    const errors = [];
    const data = {};

    for (const col of config.columns) {
      const val = (row[col.key] || row[col.label.toLowerCase().replace(/\s+/g, '_')] || '').trim();
      data[col.key] = val;

      if (col.required && !val) {
        errors.push(`${col.label} is required`);
      }
      if (col.key === 'email' && val && !validateEmail(val)) {
        errors.push('Invalid email format');
      }
      if ((col.key === 'phone' || col.key === 'guardian_phone') && val && !validatePhone(val)) {
        errors.push('Invalid phone format (use Uganda format: +256XXXXXXXXX or 0XXXXXXXXX)');
      }
    }

    return { valid: errors.length === 0, errors, data };
  }

  // ══════════════════════════════════════════════════════════
  // CONFIRMATION TOKEN
  // ══════════════════════════════════════════════════════════
  const pendingImports = new Map(); // token -> { csvData, type, filename, expires }

  function generateToken(csvData, type, filename) {
    const token = crypto.randomBytes(16).toString('hex');
    pendingImports.set(token, {
      csvData,
      type,
      filename,
      expires: Date.now() + 30 * 60 * 1000 // 30 minutes
    });
    // Clean up expired tokens periodically
    for (const [k, v] of pendingImports) {
      if (v.expires < Date.now()) pendingImports.delete(k);
    }
    return token;
  }

  function consumeToken(token) {
    const entry = pendingImports.get(token);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      pendingImports.delete(token);
      return null;
    }
    pendingImports.delete(token);
    return entry;
  }

  // ══════════════════════════════════════════════════════════
  // SHARED CSS
  // ══════════════════════════════════════════════════════════
  const CSS = `<style>
.bi-wrap{max-width:1100px;margin:0 auto;padding:24px}
.bi-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
.bi-head h1{font-size:1.6rem;font-weight:700;color:#1e1b4b;margin:0}
.bi-head p{color:#6b7280;margin:4px 0 0;font-size:.9rem}
.bi-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:24px}
.bi-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;transition:box-shadow .2s,transform .2s;cursor:pointer;text-decoration:none;color:inherit;display:block}
.bi-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.08);transform:translateY(-2px)}
.bi-card .bi-icon{font-size:2rem;margin-bottom:8px}
.bi-card h3{margin:0 0 4px;font-size:1.05rem;font-weight:600;color:#1e1b4b}
.bi-card p{margin:0;font-size:.82rem;color:#6b7280;line-height:1.5}
.bi-card .bi-cols{margin-top:10px;display:flex;flex-wrap:wrap;gap:4px}
.bi-card .bi-col-tag{font-size:.7rem;padding:2px 8px;border-radius:12px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe}
.bi-card .bi-col-tag.req{background:#fef2f2;color:#991b1b;border-color:#fecaca}
.bi-tbl{width:100%;border-collapse:collapse;font-size:.85rem}
.bi-tbl th{background:#f8fafc;padding:10px 14px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;position:sticky;top:0;z-index:1}
.bi-tbl td{padding:8px 14px;border-bottom:1px solid #f3f4f6;color:#4b5563;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bi-tbl tr:hover td{background:#f9fafb}
.bi-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:500;cursor:pointer;border:none;text-decoration:none;transition:all .15s}
.bi-btn-p{background:#4f46e5;color:#fff}.bi-btn-p:hover{background:#4338ca}
.bi-btn-o{background:#fff;color:#4f46e5;border:1px solid #c7d2fe}.bi-btn-o:hover{background:#eef2ff}
.bi-btn-d{background:#ef4444;color:#fff}.bi-btn-d:hover{background:#dc2626}
.bi-btn-g{background:#059669;color:#fff}.bi-btn-g:hover{background:#047857}
.bi-btn-s{padding:5px 12px;font-size:.78rem;border-radius:6px}
.bi-btn:disabled{opacity:.5;cursor:not-allowed}
.bi-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.74rem;font-weight:600}
.bi-ok{background:#dcfce7;color:#166534}.bi-err{background:#fee2e2;color:#991b1b}
.bi-warn{background:#fef3c7;color:#92400e}.bi-info{background:#e0e7ff;color:#3730a3}
.bi-scroll{max-height:420px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px}
.bi-scroll::-webkit-scrollbar{width:6px}.bi-scroll::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}
.drop-zone{border:2px dashed #d1d5db;border-radius:12px;padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:#f9fafb}
.drop-zone:hover,.drop-zone.over{border-color:#4f46e5;background:#eef2ff}
.drop-zone .dz-icon{font-size:2.5rem;margin-bottom:8px}
.bi-progress{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-top:4px}
.bi-progress div{height:100%;border-radius:4px;transition:width .3s}
.v-row{background:#f0fdf4!important}.i-row{background:#fef2f2!important}
.bi-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.bi-stat{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center}
.bi-stat .num{font-size:1.8rem;font-weight:700;color:#4f46e5}
.bi-stat .lbl{font-size:.8rem;color:#6b7280;margin-top:2px}
.bi-empty{text-align:center;padding:40px 20px;color:#9ca3af}
@media(max-width:768px){.bi-wrap{padding:16px}.bi-cards{grid-template-columns:1fr}.bi-head{flex-direction:column;align-items:flex-start}.bi-tbl td,.bi-tbl th{padding:6px 8px;font-size:.78rem}}
</style>`;

  // ══════════════════════════════════════════════════════════
  // ROUTE: GET /import — Import Dashboard
  // ══════════════════════════════════════════════════════════
  app.get('/import', _auth, _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Recent import history
    let recent = [];
    try {
      const r = await pool.query(
        'SELECT * FROM import_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10',
        [tid]
      );
      recent = r.rows;
    } catch (_) { /* table may not exist yet */ }

    // Build type cards
    const typeCards = Object.entries(IMPORT_TYPES).map(([key, t]) => {
      const colTags = t.columns.map(c =>
        `<span class="bi-col-tag${c.required ? ' req' : ''}">${_esc(c.label)}${c.required ? ' *' : ''}</span>`
      ).join('');

      return `<a href="/import?type=${key}" class="bi-card" onclick="document.getElementById('importType').value='${key}';return false">
        <div class="bi-icon">${t.icon}</div>
        <h3>${_esc(t.label)}</h3>
        <p>${_esc(t.description)}</p>
        <div class="bi-cols">${colTags}</div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <span class="bi-btn bi-btn-o bi-btn-s" onclick="event.stopPropagation();event.preventDefault();window.location.href='/import/template/${key}'">&#11015; Template</span>
        </div>
      </a>`;
    }).join('');

    // Recent imports table
    const recentRows = recent.length > 0 ? recent.map(r => {
      const pct = r.total_rows > 0 ? Math.round((r.created_rows / r.total_rows) * 100) : 0;
      const barCol = pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
      return `<tr>
        <td>${_esc(r.filename || '—')}</td>
        <td><span class="bi-badge bi-info">${_esc(r.import_type)}</span></td>
        <td>${r.total_rows}</td>
        <td style="color:#059669;font-weight:600">${r.created_rows}</td>
        <td style="color:#d97706">${r.skipped_rows}</td>
        <td style="color:${r.failed_rows > 0 ? '#dc2626' : '#6b7280'}">${r.failed_rows}</td>
        <td><span class="bi-badge ${r.status === 'completed' ? 'bi-ok' : r.status === 'partial' ? 'bi-warn' : 'bi-err'}">${_esc(r.status)}</span></td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
        <td>${r.csv_data ? `<a href="/import/history/csv/${r.id}" class="bi-btn bi-btn-o bi-btn-s">CSV</a>` : ''}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" class="bi-empty">No imports yet. Choose a type above to get started.</td></tr>`;

    // Upload form with drag-and-drop
    const typeOpts = Object.entries(IMPORT_TYPES).map(([k, t]) =>
      `<option value="${k}">${t.icon} ${_esc(t.label)}</option>`
    ).join('');

    const body = CSS + `<div class="bi-wrap">
      <div class="bi-head">
        <div><h1>&#128230; Bulk Import</h1><p>Import data from CSV files — validate, preview, then confirm</p></div>
        <a href="/import/history" class="bi-btn bi-btn-o">&#128203; History</a>
      </div>

      <h2 style="font-size:1.1rem;font-weight:600;color:#374151;margin-bottom:12px">Import Types</h2>
      <div class="bi-cards">${typeCards}</div>

      <h2 style="font-size:1.1rem;font-weight:600;color:#374151;margin-bottom:12px">Upload CSV</h2>
      <div class="bi-card" style="margin-bottom:24px">
        <form id="importForm" method="POST" action="/import/upload" enctype="multipart/form-data">
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:6px;color:#374151">Import Type</label>
            <select name="type" id="importType" required style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;width:100%;max-width:360px">
              <option value="">— Select Type —</option>
              ${typeOpts}
            </select>
          </div>

          <div class="drop-zone" id="dropZone" onclick="document.getElementById('csvFile').click()">
            <div class="dz-icon">&#128193;</div>
            <div style="font-size:1.05rem;font-weight:600;color:#374151;margin-bottom:4px">Drop your CSV file here</div>
            <div style="color:#6b7280;font-size:.88rem">or click to browse &bull; .csv files up to 5 MB</div>
            <div id="fileInfo" style="display:none;margin-top:12px;padding:10px;background:#fff;border-radius:8px;text-align:left">
              <span style="font-weight:600;color:#059669" id="fileName"></span>
              <span style="color:#9ca3af;margin-left:8px" id="fileSize"></span>
            </div>
          </div>
          <input type="file" id="csvFile" name="file" accept=".csv" style="display:none">

          <div style="margin-top:16px;display:flex;gap:12px">
            <button type="submit" id="uploadBtn" class="bi-btn bi-btn-p" disabled>&#128228; Upload &amp; Preview</button>
          </div>
        </form>
      </div>

      <h2 style="font-size:1.1rem;font-weight:600;color:#374151;margin-bottom:12px">Recent Imports</h2>
      <div class="bi-scroll">
        <table class="bi-tbl">
          <thead><tr><th>File</th><th>Type</th><th>Total</th><th>Created</th><th>Skipped</th><th>Failed</th><th>Status</th><th>Date</th><th>CSV</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table>
      </div>
    </div>

    <script>
    (function(){
      var dz=document.getElementById('dropZone'),fi=document.getElementById('csvFile'),ub=document.getElementById('uploadBtn');
      ['dragenter','dragover'].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.add('over')})});
      ['dragleave','drop'].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.remove('over')})});
      dz.addEventListener('drop',function(ev){if(ev.dataTransfer.files[0])handleFile(ev.dataTransfer.files[0])});
      fi.addEventListener('change',function(){if(fi.files[0])handleFile(fi.files[0])});
      function handleFile(f){
        if(!/\\.csv$/i.test(f.name)){alert('Please upload a CSV file');return}
        if(f.size>5*1024*1024){alert('File too large. Maximum 5 MB.');return}
        document.getElementById('fileName').textContent=f.name;
        document.getElementById('fileSize').textContent=(f.size/1024).toFixed(1)+' KB';
        document.getElementById('fileInfo').style.display='block';
        ub.disabled=false;
      }
      document.getElementById('importForm').addEventListener('submit',function(e){
        if(!fi.files[0]){e.preventDefault();alert('Please select a file first')}
      });
    })();
    </script>`;

    res.send(renderPage('Bulk Import', body, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE: GET /import/template/:type — Download CSV Template
  // ══════════════════════════════════════════════════════════
  app.get('/import/template/:type', _auth, _ah(async (req, res) => {
    const type = req.params.type;
    const config = IMPORT_TYPES[type];
    if (!config) return res.status(404).send('Invalid import type');

    // Build CSV: headers + 2 example rows
    const headers = config.columns.map(c => c.key).join(',');
    const examples = (config.examples || []).map(row =>
      row.map(v => {
        // Quote fields that contain commas or quotes
        if (v.includes(',') || v.includes('"') || v.includes('\n')) {
          return '"' + v.replace(/"/g, '""') + '"';
        }
        return v;
      }).join(',')
    );

    const csv = headers + '\n' + examples.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_template.csv"`);
    // Add BOM for Excel UTF-8 compatibility
    res.send('\uFEFF' + csv);
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE: POST /import/upload — Upload and Preview CSV
  // ══════════════════════════════════════════════════════════
  app.post('/import/upload', _auth, upload ? upload.single('file') : (req, res, next) => next(), _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const type = req.body.type;
    const config = IMPORT_TYPES[type];

    if (!config) {
      return res.json({ error: 'Invalid import type' });
    }

    // Get file content
    let csvText = '';
    let filename = 'upload.csv';

    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
      filename = req.file.originalname || 'upload.csv';
    } else if (req.body.csvData) {
      csvText = req.body.csvData;
      filename = req.body.filename || 'upload.csv';
    }

    if (!csvText.trim()) {
      return res.json({ error: 'No CSV data received. Please upload a file.' });
    }

    // Check size limit (5MB)
    if (Buffer.byteLength(csvText, 'utf-8') > 5 * 1024 * 1024) {
      return res.json({ error: 'File too large. Maximum 5 MB.' });
    }

    // Parse CSV
    const parsed = parseCSV(csvText);
    if (parsed.rows.length === 0) {
      return res.json({ error: 'Could not parse CSV. Ensure your file has headers in the first row and data rows below.' });
    }

    // Validate headers — check if expected columns are present
    const expectedKeys = config.columns.map(c => c.key);
    const expectedLabels = config.columns.map(c => c.label.toLowerCase());
    const headerMatches = parsed.headers.filter(h =>
      expectedKeys.includes(h) || expectedLabels.includes(h.toLowerCase().replace(/\s+/g, '_'))
    );
    if (headerMatches.length === 0) {
      return res.json({
        error: `No matching columns found. Expected columns: ${expectedKeys.join(', ')}. Got: ${parsed.headers.join(', ')}`
      });
    }

    // Validate each row
    const results = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      results.push({
        rowNumber: i + 1,
        ...validateRow(parsed.rows[i], config, tid)
      });
    }

    const validRows = results.filter(r => r.valid);
    const invalidRows = results.filter(r => !r.valid);

    // Check for duplicates within the CSV (by unique columns)
    const uniqueCols = config.columns.filter(c => c.unique).map(c => c.key);
    const seenValues = {};
    for (const col of uniqueCols) {
      seenValues[col] = new Set();
    }
    for (const r of results) {
      for (const col of uniqueCols) {
        const val = (r.data[col] || '').toLowerCase().trim();
        if (val) {
          if (seenValues[col].has(val)) {
            r.valid = false;
            r.errors.push(`Duplicate ${col} within CSV`);
          } else {
            seenValues[col].add(val);
          }
        }
      }
    }

    // Re-count after duplicate check
    const finalValid = results.filter(r => r.valid).length;
    const finalInvalid = results.filter(r => !r.valid).length;

    // Generate confirmation token
    const token = generateToken(csvText, type, filename);

    // Build preview data (first 10 rows)
    const previewData = results.slice(0, 10).map(r => ({
      rowNumber: r.rowNumber,
      valid: r.valid,
      errors: r.errors,
      data: r.data
    }));

    res.json({
      total_rows: parsed.rows.length,
      valid_rows: finalValid,
      invalid_rows: finalInvalid,
      preview_data: previewData,
      errors: invalidRows.slice(0, 20).map(r => ({ row: r.rowNumber, errors: r.errors })),
      token: token,
      filename: filename,
      type: type
    });
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE: POST /import/confirm — Confirm and Execute Import
  // ══════════════════════════════════════════════════════════
  app.post('/import/confirm', _auth, _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { token } = req.body;

    // Validate token
    const pending = consumeToken(token);
    if (!pending) {
      return res.json({ error: 'Invalid or expired confirmation token. Please re-upload your CSV.' });
    }

    const { csvData, type, filename } = pending;
    const config = IMPORT_TYPES[type];
    if (!config) {
      return res.json({ error: 'Invalid import type' });
    }

    // Re-parse CSV
    const parsed = parseCSV(csvData);
    if (parsed.rows.length === 0) {
      return res.json({ error: 'Could not re-parse CSV data.' });
    }

    // Re-validate all rows
    const results = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      results.push({
        rowNumber: i + 1,
        ...validateRow(parsed.rows[i], config, tid)
      });
    }

    // Check for duplicates within CSV
    const uniqueCols = config.columns.filter(c => c.unique).map(c => c.key);
    const seenValues = {};
    for (const col of uniqueCols) seenValues[col] = new Set();
    for (const r of results) {
      for (const col of uniqueCols) {
        const val = (r.data[col] || '').toLowerCase().trim();
        if (val) {
          if (seenValues[col].has(val)) {
            r.valid = false;
            r.errors.push(`Duplicate ${col} within CSV`);
          } else {
            seenValues[col].add(val);
          }
        }
      }
    }

    const validRows = results.filter(r => r.valid);
    const allErrors = [];
    let created = 0, skipped = 0, failed = 0;

    // Get existing unique values from the database for duplicate checking
    for (const col of uniqueCols) {
      try {
        const dbRes = await pool.query(
          `SELECT LOWER(${col}) AS val FROM ${config.table} WHERE tenant_id = $1 AND ${col} IS NOT NULL AND ${col} != ''`,
          [tid]
        );
        const existingSet = new Set(dbRes.rows.map(r => r.val));
        // Mark rows with existing values as duplicates
        for (const r of validRows) {
          const val = (r.data[col] || '').toLowerCase().trim();
          if (val && existingSet.has(val)) {
            r.valid = false;
            r.errors.push(`${col} already exists in database`);
          }
        }
      } catch (_) { /* table/column may not exist */ }
    }

    // Re-filter after DB duplicate check
    const finalValidRows = results.filter(r => r.valid);
    const dbDuplicateRows = validRows.filter(r => !r.valid);

    // Insert valid rows
    const cols = config.columns.map(c => `"${c.key}"`).join(', ');

    for (const row of finalValidRows) {
      const vals = config.columns.map(c => {
        const v = row.data[c.key];
        if (v === '' || v === undefined || v === null) return null;
        return v;
      });

      try {
        const phs = vals.map((_, i) => `$${i + 2}`).join(', ');
        await pool.query(
          `INSERT INTO ${config.table} (tenant_id, ${cols}) VALUES ($1, ${phs})`,
          [tid, ...vals]
        );
        created++;
      } catch (e) {
        failed++;
        allErrors.push({ row: row.rowNumber, error: e.message, data: row.data });
      }
    }

    skipped = dbDuplicateRows.length;
    // Count other invalid rows as failed
    const otherInvalid = results.filter(r => !r.valid && !dbDuplicateRows.includes(r));
    failed += otherInvalid.length;
    for (const r of otherInvalid) {
      allErrors.push({ row: r.rowNumber, error: r.errors.join('; '), data: r.data });
    }

    // Create import_log entry
    let logId = null;
    try {
      const logRes = await pool.query(
        `INSERT INTO import_logs (tenant_id, import_type, filename, total_rows, created_rows, skipped_rows, failed_rows, errors, status, imported_by, csv_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          tid, type, filename, parsed.rows.length, created, skipped, failed,
          JSON.stringify(allErrors.slice(0, 100)),
          failed === 0 ? 'completed' : (created > 0 ? 'partial' : 'failed'),
          uid,
          csvData
        ]
      );
      logId = logRes.rows[0].id;
    } catch (e) {
      _logger.error('[BulkImport] Failed to log import: ' + e.message);
    }

    // Audit log
    try {
      _audit(
        req.session.user.email || 'unknown',
        'bulk_import',
        `Imported ${created} ${type}, skipped ${skipped}, failed ${failed} from ${filename}`,
        tid,
        req
      );
    } catch (_) {}

    _logger.info(`[BulkImport] Import complete: ${created} created, ${skipped} skipped, ${failed} failed for tenant ${tid}`);

    res.json({
      created,
      skipped,
      failed,
      errors: allErrors.slice(0, 50),
      log_id: logId
    });
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE: GET /import/history — Import History
  // ══════════════════════════════════════════════════════════
  app.get('/import/history', _auth, _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { type: typeFilter, status: statusFilter } = req.query;

    let where = 'WHERE tenant_id=$1', params = [tid], pi = 2;
    if (typeFilter) { where += ` AND import_type=$${pi++}`; params.push(typeFilter); }
    if (statusFilter) { where += ` AND status=$${pi++}`; params.push(statusFilter); }

    let rows = [];
    try {
      const r = await pool.query(
        `SELECT * FROM import_logs ${where} ORDER BY created_at DESC LIMIT 100`,
        params
      );
      rows = r.rows;
    } catch (_) {}

    const typeOpts = Object.entries(IMPORT_TYPES).map(([k, t]) =>
      `<option value="${k}"${typeFilter === k ? ' selected' : ''}>${_esc(t.label)}</option>`
    ).join('');
    const statusOpts = ['completed', 'partial', 'failed'].map(s =>
      `<option value="${s}"${statusFilter === s ? ' selected' : ''}>${s}</option>`
    ).join('');

    const tRows = rows.length > 0 ? rows.map(r => {
      const pct = r.total_rows > 0 ? Math.round((r.created_rows / r.total_rows) * 100) : 0;
      const barCol = pct >= 80 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
      return `<tr>
        <td>#${r.id}</td>
        <td>${_esc(r.filename || '—')}</td>
        <td><span class="bi-badge bi-info">${_esc(r.import_type)}</span></td>
        <td>${r.total_rows}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;min-width:50px"><div class="bi-progress"><div style="width:${pct}%;background:${barCol}"></div></div></div>
            <span style="font-size:.78rem;font-weight:600">${r.created_rows} (${pct}%)</span>
          </div>
        </td>
        <td style="color:#d97706">${r.skipped_rows}</td>
        <td style="color:${r.failed_rows > 0 ? '#dc2626' : '#6b7280'}">${r.failed_rows}</td>
        <td><span class="bi-badge ${r.status === 'completed' ? 'bi-ok' : r.status === 'partial' ? 'bi-warn' : 'bi-err'}">${_esc(r.status)}</span></td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
        <td>${r.csv_data ? `<a href="/import/history/csv/${r.id}" class="bi-btn bi-btn-o bi-btn-s">CSV</a>` : ''}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="10" class="bi-empty">No import history found.</td></tr>`;

    const body = CSS + `<div class="bi-wrap">
      <div class="bi-head">
        <div><h1>&#128203; Import History</h1><p>Complete log of all bulk import operations</p></div>
        <div style="display:flex;gap:8px">
          <a href="/import" class="bi-btn bi-btn-o">&larr; Dashboard</a>
        </div>
      </div>

      <div class="bi-card" style="margin-bottom:16px;padding:16px">
        <form method="GET" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <div>
            <label style="font-size:.78rem;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Type</label>
            <select name="type" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem">
              <option value="">All Types</option>${typeOpts}
            </select>
          </div>
          <div>
            <label style="font-size:.78rem;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.85rem">
              <option value="">All Statuses</option>${statusOpts}
            </select>
          </div>
          <button type="submit" class="bi-btn bi-btn-p bi-btn-s">Filter</button>
          <a href="/import/history" class="bi-btn bi-btn-o bi-btn-s">Clear</a>
        </form>
      </div>

      <div class="bi-scroll">
        <table class="bi-tbl">
          <thead><tr><th>ID</th><th>File</th><th>Type</th><th>Total</th><th>Created</th><th>Skipped</th><th>Failed</th><th>Status</th><th>Date</th><th>CSV</th></tr></thead>
          <tbody>${tRows}</tbody>
        </table>
      </div>
    </div>`;

    res.send(renderPage('Import History', body, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // ROUTE: GET /import/history/csv/:id — Re-download original CSV
  // ══════════════════════════════════════════════════════════
  app.get('/import/history/csv/:id', _auth, _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const id = parseInt(req.params.id);

    let row;
    try {
      const r = await pool.query(
        'SELECT * FROM import_logs WHERE id=$1 AND tenant_id=$2',
        [id, tid]
      );
      row = r.rows[0];
    } catch (_) {}

    if (!row || !row.csv_data) {
      return res.status(404).send('Import record or CSV data not found');
    }

    const filename = row.filename || `import_${id}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(row.csv_data);
  }));

  // ══════════════════════════════════════════════════════════
  // PREVIEW PAGE (HTML version — shows after upload)
  // ══════════════════════════════════════════════════════════
  app.get('/import/preview', _auth, _ah(async (req, res) => {
    const body = CSS + `<div class="bi-wrap">
      <div class="bi-head">
        <div><h1>&#128065; Import Preview</h1><p>Review your data before importing</p></div>
        <a href="/import" class="bi-btn bi-btn-o">&larr; Back</a>
      </div>

      <div id="previewContent" style="text-align:center;padding:40px">
        <p style="color:#6b7280">Loading preview...</p>
      </div>

      <div id="confirmSection" style="display:none;margin-top:20px">
        <div class="bi-stat-grid" id="previewStats"></div>
        <div class="bi-scroll" id="previewTable" style="margin-bottom:16px"></div>
        <div id="errorSection" style="margin-bottom:16px"></div>
        <div style="display:flex;gap:12px;align-items:center">
          <button id="confirmBtn" class="bi-btn bi-btn-g" onclick="confirmImport()">&#10003; Confirm Import</button>
          <a href="/import" class="bi-btn bi-btn-o">Cancel</a>
          <div id="progressSection" style="display:none;flex:1">
            <div class="bi-progress" style="height:12px"><div id="progressBar" style="width:0%;background:#059669;transition:width .3s"></div></div>
            <p id="progressText" style="font-size:.82rem;color:#6b7280;margin-top:4px">Importing...</p>
          </div>
        </div>
      </div>
    </div>

    <script>
    (function(){
      // Get upload result from sessionStorage (set by upload page)
      var result = sessionStorage.getItem('importPreviewResult');
      if (!result) {
        document.getElementById('previewContent').innerHTML =
          '<p style="color:#6b7280">No preview data found. <a href="/import" class="bi-btn bi-btn-o">Upload a CSV</a></p>';
        return;
      }

      var data = JSON.parse(result);
      document.getElementById('previewContent').style.display = 'none';
      document.getElementById('confirmSection').style.display = 'block';

      // Stats
      document.getElementById('previewStats').innerHTML =
        '<div class="bi-stat"><div class="num">' + data.total_rows + '</div><div class="lbl">Total Rows</div></div>' +
        '<div class="bi-stat"><div class="num" style="color:#059669">' + data.valid_rows + '</div><div class="lbl">Valid</div></div>' +
        '<div class="bi-stat"><div class="num" style="color:#dc2626">' + data.invalid_rows + '</div><div class="lbl">Invalid</div></div>';

      // Preview table
      var html = '<table class="bi-tbl"><thead><tr><th>#</th><th>Status</th>';
      if (data.preview_data && data.preview_data.length > 0) {
        var keys = Object.keys(data.preview_data[0].data);
        keys.slice(0, 5).forEach(function(k) { html += '<th>' + k + '</th>'; });
      }
      html += '</tr></thead><tbody>';

      if (data.preview_data) {
        data.preview_data.forEach(function(r) {
          html += '<tr class="' + (r.valid ? 'v-row' : 'i-row') + '">';
          html += '<td style="font-weight:600">#' + r.rowNumber + '</td>';
          html += '<td>' + (r.valid
            ? '<span class="bi-badge bi-ok">&#10003; Valid</span>'
            : '<span class="bi-badge bi-err">&#10007; ' + (r.errors||[]).join('; ') + '</span>') + '</td>';
          if (r.data) {
            Object.values(r.data).slice(0, 5).forEach(function(v) {
              html += '<td>' + (v || '—') + '</td>';
            });
          }
          html += '</tr>';
        });
      }
      html += '</tbody></table>';
      document.getElementById('previewTable').innerHTML = html;

      // Errors section
      if (data.errors && data.errors.length > 0) {
        var errHtml = '<div class="bi-card" style="border-color:#fecaca;background:#fef2f2"><h3 style="color:#dc2626;margin:0 0 8px">Validation Errors</h3><ul style="margin:0;padding-left:20px;font-size:.82rem;color:#991b1b">';
        data.errors.forEach(function(e) {
          errHtml += '<li>Row ' + e.row + ': ' + (e.errors||[]).join('; ') + '</li>';
        });
        errHtml += '</ul></div>';
        document.getElementById('errorSection').innerHTML = errHtml;
      }

      // Confirm button
      if (data.valid_rows === 0) {
        document.getElementById('confirmBtn').disabled = true;
        document.getElementById('confirmBtn').style.opacity = '0.5';
      }

      window.confirmImport = function() {
        var btn = document.getElementById('confirmBtn');
        btn.disabled = true;
        btn.innerHTML = '&#8987; Importing...';
        document.getElementById('progressSection').style.display = 'block';

        fetch('/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: data.token })
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.error) {
            btn.innerHTML = '&#10007; Error';
            btn.className = 'bi-btn bi-btn-d';
            document.getElementById('progressBar').style.width = '100%';
            document.getElementById('progressBar').style.background = '#dc2626';
            document.getElementById('progressText').textContent = result.error;
            return;
          }

          document.getElementById('progressBar').style.width = '100%';
          document.getElementById('progressBar').style.background = '#059669';
          document.getElementById('progressText').textContent = 'Import complete!';

          var stats = document.getElementById('previewStats');
          stats.innerHTML =
            '<div class="bi-stat"><div class="num" style="color:#059669">' + result.created + '</div><div class="lbl">Created</div></div>' +
            '<div class="bi-stat"><div class="num" style="color:#d97706">' + result.skipped + '</div><div class="lbl">Skipped</div></div>' +
            '<div class="bi-stat"><div class="num" style="color:#dc2626">' + result.failed + '</div><div class="lbl">Failed</div></div>';

          btn.innerHTML = '&#10003; Complete!';
          btn.className = 'bi-btn bi-btn-g';
          btn.onclick = null;

          // Add link to history
          var histLink = document.createElement('a');
          histLink.href = '/import/history';
          histLink.className = 'bi-btn bi-btn-o';
          histLink.innerHTML = '&#128203; View History';
          btn.parentNode.appendChild(histLink);

          sessionStorage.removeItem('importPreviewResult');
        })
        .catch(function(err) {
          btn.innerHTML = '&#10007; Error';
          btn.className = 'bi-btn bi-btn-d';
          document.getElementById('progressText').textContent = 'Network error: ' + err.message;
        });
      };
    })();
    </script>`;

    res.send(renderPage('Import Preview', body, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // AJAX UPLOAD (for the drag-and-drop upload that returns JSON)
  // This is an alternate upload endpoint that stores the result
  // in session and redirects to the preview page
  // ══════════════════════════════════════════════════════════
  app.post('/import/upload-redirect', _auth, upload ? upload.single('file') : (req, res, next) => next(), _ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const type = req.body.type;
    const config = IMPORT_TYPES[type];

    if (!config) {
      return res.redirect('/import?error=invalid_type');
    }

    let csvText = '';
    let filename = 'upload.csv';

    if (req.file) {
      csvText = req.file.buffer.toString('utf-8');
      filename = req.file.originalname || 'upload.csv';
    }

    if (!csvText.trim()) {
      return res.redirect('/import?error=no_data');
    }

    if (Buffer.byteLength(csvText, 'utf-8') > 5 * 1024 * 1024) {
      return res.redirect('/import?error=too_large');
    }

    const parsed = parseCSV(csvText);
    if (parsed.rows.length === 0) {
      return res.redirect('/import?error=parse_error');
    }

    // Validate headers
    const expectedKeys = config.columns.map(c => c.key);
    const expectedLabels = config.columns.map(c => c.label.toLowerCase());
    const headerMatches = parsed.headers.filter(h =>
      expectedKeys.includes(h) || expectedLabels.includes(h.toLowerCase().replace(/\s+/g, '_'))
    );
    if (headerMatches.length === 0) {
      return res.redirect('/import?error=headers_mismatch');
    }

    // Validate rows
    const results = [];
    for (let i = 0; i < parsed.rows.length; i++) {
      results.push({ rowNumber: i + 1, ...validateRow(parsed.rows[i], config, tid) });
    }

    // Check duplicates within CSV
    const uniqueCols = config.columns.filter(c => c.unique).map(c => c.key);
    const seenValues = {};
    for (const col of uniqueCols) seenValues[col] = new Set();
    for (const r of results) {
      for (const col of uniqueCols) {
        const val = (r.data[col] || '').toLowerCase().trim();
        if (val) {
          if (seenValues[col].has(val)) {
            r.valid = false;
            r.errors.push(`Duplicate ${col} within CSV`);
          } else {
            seenValues[col].add(val);
          }
        }
      }
    }

    const validRows = results.filter(r => r.valid).length;
    const invalidRows = results.filter(r => !r.valid).length;

    // Generate token
    const token = generateToken(csvText, type, filename);

    // Build preview data (first 10 rows)
    const previewData = results.slice(0, 10).map(r => ({
      rowNumber: r.rowNumber,
      valid: r.valid,
      errors: r.errors,
      data: r.data
    }));

    // Store in session for the preview page
    req.session._importPreview = {
      total_rows: parsed.rows.length,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      preview_data: previewData,
      errors: results.filter(r => !r.valid).slice(0, 20).map(r => ({ row: r.rowNumber, errors: r.errors })),
      token: token,
      filename: filename,
      type: type
    };

    res.redirect('/import/preview');
  }));

  // Override the preview page to also use session data
  // (The /import/preview route above already handles sessionStorage,
  //  but for form-based uploads we inject the data server-side)

  _logger.info('[BulkImport] Module loaded — 6 import types, 7 routes');
};
