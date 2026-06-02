// ============================================================
// CUSTOM FORMS MODULE — Multi-Tenant SaaS Platform (Comfort Zone)
// Dynamic form builder with field types, drag-drop, submissions,
// responses, CSV export, templates, and JSON APIs.
// ============================================================
// Usage in server.js:
//   const customForms = require('./custom-forms');
//   customForms(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function customForms(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  // -- field type helpers ------------------------------------------------
  const FIELD_TYPES = [
    { value: 'text', label: 'Short Text', icon: '📝' },
    { value: 'textarea', label: 'Long Text', icon: '📄' },
    { value: 'number', label: 'Number', icon: '🔢' },
    { value: 'email', label: 'Email', icon: '📧' },
    { value: 'phone', label: 'Phone', icon: '📞' },
    { value: 'date', label: 'Date', icon: '📅' },
    { value: 'select', label: 'Dropdown', icon: '📋' },
    { value: 'radio', label: 'Radio Group', icon: '🔘' },
    { value: 'checkbox', label: 'Checkboxes', icon: '☑️' },
    { value: 'file', label: 'File Upload', icon: '📎' },
    { value: 'rating', label: 'Rating', icon: '⭐' },
    { value: 'section', label: 'Section Header', icon: '📌' }
  ];

  function fieldTypeBadge(type) {
    const ft = FIELD_TYPES.find(f => f.value === type);
    const icon = ft ? ft.icon : '📝';
    const label = ft ? ft.label : type;
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:#f0fdf4;color:#059669">${icon} ${label}</span>`;
  }

  function formStatusBadge(s) {
    const m = { draft: { bg: '#f1f5f9', c: '#64748b' }, published: { bg: '#dcfce7', c: '#16a34a' }, closed: { bg: '#fee2e2', c: '#dc2626' } };
    const v = m[s] || m.draft;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${s || 'draft'}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const CF_CSS = `<style>
    .cf-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .cf-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .cf-nav a:hover{background:#e2e8f0}.cf-nav a.active{background:#0891b2;color:#fff}
    .cf-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .cf-btn:hover{opacity:.9;transform:translateY(-1px)}
    .cf-btn-primary{background:#0891b2;color:#fff}.cf-btn-success{background:#059669;color:#fff}
    .cf-btn-danger{background:#fee2e2;color:#dc2626}.cf-btn-secondary{background:#f1f5f9;color:#475569}
    .cf-table{width:100%;border-collapse:collapse;font-size:13px}
    .cf-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .cf-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .cf-table tr:hover{background:#f8fafc}
    .cf-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .cf-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .cf-filter input,.cf-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .cf-filter input:focus,.cf-filter select:focus{outline:none;border-color:#0891b2}
    .cf-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
    .cf-field{border:2px dashed #cbd5e1;border-radius:12px;padding:16px;margin-bottom:12px;background:#fefefe;transition:.15s;cursor:move}
    .cf-field:hover{border-color:#0891b2;background:#f0fdfa}
    .cf-field-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .cf-field-label{font-size:14px;font-weight:700;color:#1e293b}.cf-field-type{font-size:11px;color:#94a3b8}
    .cf-field-actions{display:flex;gap:6px}
    .cf-field-actions button{padding:4px 10px;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600}
    .cf-template-card{border:2px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;transition:.15s;cursor:pointer}
    .cf-template-card:hover{border-color:#0891b2;box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
    .cf-template-icon{font-size:36px;margin-bottom:8px}
    .cf-template-name{font-size:15px;font-weight:700;color:#1e293b}
    .cf-template-desc{font-size:12px;color:#94a3b8;margin-top:4px}
    @media(max-width:768px){.cf-nav{gap:4px}.cf-nav a{padding:6px 12px;font-size:12px}.cf-filter{flex-direction:column}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="cf-nav">
    <a href="/forms" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/forms/builder" class="${active === 'builder' ? 'active' : ''}">🔧 Builder</a>
    <a href="/forms/templates" class="${active === 'templates' ? 'active' : ''}">📦 Templates</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // Create tables in dependency order: forms first, then submissions, then fields/values
      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS custom_forms (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL, description TEXT, status VARCHAR(20) DEFAULT 'draft',
        is_public BOOLEAN DEFAULT false, allow_anonymous BOOLEAN DEFAULT false,
        created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS form_submissions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        form_id INTEGER, respondent_id INTEGER, respondent_name VARCHAR(255),
        respondent_email VARCHAR(255), ip_address VARCHAR(45),
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS custom_fields (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        form_id INTEGER, field_type VARCHAR(50), label VARCHAR(255),
        placeholder TEXT, help_text TEXT, is_required BOOLEAN DEFAULT false,
        options TEXT, sort_order INTEGER DEFAULT 0, validations TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS custom_field_values (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        submission_id INTEGER, field_id INTEGER, field_label VARCHAR(255),
        field_value TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS form_field_options (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        field_id INTEGER, option_label VARCHAR(255), option_value VARCHAR(255),
        sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'CustomForms', `CREATE TABLE IF NOT EXISTS form_submission_files (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        submission_id INTEGER, field_id INTEGER, file_name VARCHAR(255),
        file_url TEXT, file_size INTEGER, uploaded_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Add missing columns if tables already existed from prior partial migration
      // Using DO blocks with information_schema checks for maximum compatibility
      const alterMigrations = [
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='custom_field_values' AND column_name='submission_id') THEN ALTER TABLE custom_field_values ADD COLUMN submission_id INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='custom_field_values' AND column_name='field_id') THEN ALTER TABLE custom_field_values ADD COLUMN field_id INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='custom_field_values' AND column_name='field_label') THEN ALTER TABLE custom_field_values ADD COLUMN field_label VARCHAR(255); END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='custom_field_values' AND column_name='field_value') THEN ALTER TABLE custom_field_values ADD COLUMN field_value TEXT; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submission_files' AND column_name='submission_id') THEN ALTER TABLE form_submission_files ADD COLUMN submission_id INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submission_files' AND column_name='field_id') THEN ALTER TABLE form_submission_files ADD COLUMN field_id INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submission_files' AND column_name='file_name') THEN ALTER TABLE form_submission_files ADD COLUMN file_name VARCHAR(255); END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submission_files' AND column_name='file_url') THEN ALTER TABLE form_submission_files ADD COLUMN file_url TEXT; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submission_files' AND column_name='file_size') THEN ALTER TABLE form_submission_files ADD COLUMN file_size INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submissions' AND column_name='respondent_id') THEN ALTER TABLE form_submissions ADD COLUMN respondent_id INTEGER; END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submissions' AND column_name='respondent_name') THEN ALTER TABLE form_submissions ADD COLUMN respondent_name VARCHAR(255); END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submissions' AND column_name='respondent_email') THEN ALTER TABLE form_submissions ADD COLUMN respondent_email VARCHAR(255); END IF; END $$`,
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_submissions' AND column_name='ip_address') THEN ALTER TABLE form_submissions ADD COLUMN ip_address VARCHAR(45); END IF; END $$`,
      ];
      for (const sql of alterMigrations) {
        try { await migrateQuery(pool, 'CustomForms', sql); } catch(e) { console.warn('[CustomForms] Alter warning:', e.message); }
      }

      // Create indexes — only if the target column exists
      const indexMigrations = [
        `CREATE INDEX IF NOT EXISTS idx_cf_tenant ON custom_forms(tenant_id)`,
        `CREATE INDEX IF NOT EXISTS idx_cfields_form ON custom_fields(form_id)`,
        `CREATE INDEX IF NOT EXISTS idx_fs_form ON form_submissions(form_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ffo_field ON form_field_options(field_id)`,
      ];
      for (const sql of indexMigrations) {
        try { await migrateQuery(pool, 'CustomForms', sql); } catch(e) { console.warn('[CustomForms] Index warning:', e.message); }
      }
      // Conditional indexes on columns that may not exist yet
      const condIndexes = [
        { sql: `CREATE INDEX IF NOT EXISTS idx_cfv_submission ON custom_field_values(submission_id)`, col: 'submission_id', tbl: 'custom_field_values' },
        { sql: `CREATE INDEX IF NOT EXISTS idx_fsf_submission ON form_submission_files(submission_id)`, col: 'submission_id', tbl: 'form_submission_files' },
      ];
      for (const ci of condIndexes) {
        try {
          const colCheck = await migrateQuery(pool, 'CustomForms', `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [ci.tbl, ci.col]);
          if (colCheck.rows.length > 0) await migrateQuery(pool, 'CustomForms', ci.sql);
        } catch(e) { console.warn('[CustomForms] Cond index warning:', e.message); }
      }

      console.log('[CustomForms] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /forms — Dashboard
  // ============================================================
  app.get('/forms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const forms = (await pool.query(
      `SELECT cf.*, (SELECT COUNT(*)::int FROM form_submissions WHERE form_id=cf.id) as submission_count, (SELECT COUNT(*)::int FROM custom_fields WHERE form_id=cf.id) as field_count FROM custom_forms cf WHERE cf.tenant_id=$1 ORDER BY cf.updated_at DESC`,
      [tid]
    )).rows;
    const totalForms = forms.length;
    const totalSubmissions = forms.reduce((s, f) => s + f.submission_count, 0);
    const publishedForms = forms.filter(f => f.status === 'published').length;

    const rows = forms.map(f => `<tr>
      <td><a href="/forms/builder/${f.id}" style="color:#0891b2;text-decoration:none;font-weight:600">${esc(f.title)}</a></td>
      <td>${esc(f.description || '—').substring(0, 60)}</td>
      <td>${f.field_count} fields</td>
      <td><span style="font-weight:600;color:#4f46e5">${f.submission_count}</span></td>
      <td>${formStatusBadge(f.status)}</td>
      <td>${f.is_public ? '<span style="color:#16a34a">Yes</span>' : '<span style="color:#94a3b8">No</span>'}</td>
      <td>${fmtDateTime(f.updated_at)}</td>
      <td style="white-space:nowrap">
        <a href="/forms/${f.id}" class="cf-btn cf-btn-secondary" style="padding:4px 10px;font-size:11px" target="_blank">View</a>
        <a href="/forms/responses/${f.id}" class="cf-btn cf-btn-secondary" style="padding:4px 10px;font-size:11px">Responses</a>
      </td>
    </tr>`).join('');

    const html = CF_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📝 Form Builder</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Create dynamic forms, collect responses, analyze data</p></div>
        <div style="display:flex;gap:8px">
          <a href="/forms/builder" class="cf-btn cf-btn-primary">➕ New Form</a>
          <a href="/forms/templates" class="cf-btn cf-btn-secondary">📦 Templates</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${totalForms}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Forms</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${publishedForms}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Published</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalSubmissions}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Responses</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a16207">${forms.length ? Math.round(totalSubmissions / Math.max(1, totalForms)) : 0}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Avg Responses</div></div>
      </div>
      <div class="cf-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Your Forms</h3>
        <div style="overflow-x:auto"><table class="cf-table">
          <thead><tr><th>Title</th><th>Description</th><th>Fields</th><th>Responses</th><th>Status</th><th>Public</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No forms yet. Create your first form!</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Form Builder Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /forms/builder — Create new form
  // ============================================================
  app.get('/forms/builder', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const fieldTypesHtml = FIELD_TYPES.map(ft =>
      `<div class="cf-template-card" onclick="addField('${ft.value}','${ft.label}')">
        <div class="cf-template-icon">${ft.icon}</div>
        <div class="cf-template-name">${ft.label}</div>
      </div>`
    ).join('');

    const html = CF_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('builder')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🔧 Form Builder</h1>
      <form method="POST" action="/forms/builder" id="formBuilder">
        <div class="cf-card" style="margin-bottom:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Form Title *</label>
              <input type="text" name="title" required placeholder="e.g. Student Feedback Form" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
              <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="draft">Draft</option><option value="published">Published</option>
              </select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" placeholder="Describe this form..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
        </div>
        <div class="cf-card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0;color:#1e293b;font-size:15px">Add Fields</h3>
            <span style="font-size:12px;color:#94a3b8">Click a field type to add it to your form</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px" id="fieldTypes">${fieldTypesHtml}</div>
        </div>
        <div class="cf-card" style="margin-bottom:16px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Form Fields <span id="fieldCount" style="color:#94a3b8;font-weight:400">(0)</span></h3>
          <div id="fieldList"><p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No fields added yet. Click a field type above to start building.</p></div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="cf-btn cf-btn-primary" style="padding:12px 28px">💾 Save Form</button>
          <a href="/forms" class="cf-btn cf-btn-secondary" style="padding:12px 28px">Cancel</a>
        </div>
      </form>
    </div>
    <script>
      let fieldCounter = 0;
      function addField(type, label) {
        fieldCounter++;
        const id = 'field_' + fieldCounter;
        const optsInput = (type === 'select' || type === 'radio' || type === 'checkbox')
          ? '<input type="text" name="' + id + '_options" placeholder="Option1, Option2, Option3" style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px;margin-top:6px">'
          : '';
        const html = '<div class="cf-field" id="' + id + '_wrapper">' +
          '<div class="cf-field-header"><div><span class="cf-field-label">' + label + '</span> <span class="cf-field-type">' + type + '</span></div>' +
          '<div class="cf-field-actions"><button type="button" onclick="removeField(\'' + id + '\')" style="background:#fee2e2;color:#dc2626">Remove</button></div></div>' +
          '<input type="hidden" name="field_type" value="' + type + '">' +
          '<input type="text" name="' + id + '_label" placeholder="Field Label *" required style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:6px">' +
          '<input type="text" name="' + id + '_placeholder" placeholder="Placeholder text (optional)" style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px;margin-bottom:6px">' +
          optsInput +
          '<div style="display:flex;gap:10px;margin-top:6px"><label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" name="' + id + '_required"> Required</label></div></div>';
        const list = document.getElementById('fieldList');
        if (fieldCounter === 1) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', html);
        document.getElementById('fieldCount').textContent = '(' + fieldCounter + ')';
      }
      function removeField(id) {
        const el = document.getElementById(id + '_wrapper');
        if (el) { el.remove(); fieldCounter--; document.getElementById('fieldCount').textContent = '(' + fieldCounter + ')'; }
      }
    </script>`;
    res.send(renderPage('Form Builder', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /forms/builder — Save form with fields
  // ============================================================
  app.post('/forms/builder', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, status } = req.body;
    if (!title || !title.trim()) return res.redirect('/forms/builder');

    const form = await pool.query(
      `INSERT INTO custom_forms (tenant_id, title, description, status, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, title.trim(), (description || '').trim(), status || 'draft', user.id]
    );
    const formId = form.rows[0].id;

    const fieldTypes = Array.isArray(req.body.field_type) ? req.body.field_type : req.body.field_type ? [req.body.field_type] : [];
    for (let i = 0; i < fieldTypes.length; i++) {
      const fType = fieldTypes[i];
      const fId = req.body['field_' + (i + 1) + '_label'] ? 'field_' + (i + 1) : null;
      if (!fId) continue;
      const fLabel = req.body[fId + '_label'];
      const fPlaceholder = req.body[fId + '_placeholder'];
      const fRequired = req.body[fId + '_required'];
      const fOptions = req.body[fId + '_options'];
      if (!fLabel) continue;

      const field = await pool.query(
        `INSERT INTO custom_fields (tenant_id, form_id, field_type, label, placeholder, help_text, is_required, options, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tid, formId, fType, fLabel.trim(), (fPlaceholder || '').trim(), '', fRequired ? true : false, (fOptions || '').trim(), i + 1]
      );
      if (fOptions && (fType === 'select' || fType === 'radio' || fType === 'checkbox')) {
        const opts = fOptions.split(',').map(o => o.trim()).filter(Boolean);
        for (let j = 0; j < opts.length; j++) {
          await pool.query(
            `INSERT INTO form_field_options (tenant_id, field_id, option_label, option_value, sort_order) VALUES ($1,$2,$3,$4,$5)`,
            [tid, field.rows[0].id, opts[j], opts[j].toLowerCase().replace(/\s+/g, '_'), j + 1]
          );
        }
      }
    }
    res.redirect('/forms/builder/' + formId);
  }));

  // ============================================================
  // ROUTE 4: GET /forms/builder/:id — Edit form
  // ============================================================
  app.get('/forms/builder/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [formId, tid])).rows[0];
    if (!form) return res.send(renderPage('Not Found', '<div class="cf-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Form not found</h2></div>', user, req));

    const fields = (await pool.query(`SELECT * FROM custom_fields WHERE form_id=$1 AND tenant_id=$2 ORDER BY sort_order`, [formId, tid])).rows;
    const fieldsHtmlParts = [];
    for (const f of fields) {
      const opts = (await pool.query(`SELECT * FROM form_field_options WHERE field_id=$1 AND tenant_id=$2 ORDER BY sort_order`, [f.id, tid])).rows;
      const optsStr = opts.map(o => o.option_label).join(', ');
      fieldsHtmlParts.push(`<div class="cf-field">
        <div class="cf-field-header"><div><span class="cf-field-label">${esc(f.label)}</span> <span class="cf-field-type">${fieldTypeBadge(f.field_type)} ${f.is_required ? '— <span style="color:#dc2626;font-weight:600">Required</span>' : ''}</span></div>
          <div class="cf-field-actions">
            <form method="POST" action="/forms/builder/${formId}/fields/${f.id}/delete" style="display:inline" onsubmit="return confirm('Delete this field?')">
              <button type="submit" style="background:#fee2e2;color:#dc2626">Delete</button>
            </form>
          </div></div>
        ${f.placeholder ? `<div style="font-size:12px;color:#94a3b8">Placeholder: ${esc(f.placeholder)}</div>` : ''}
        ${optsStr ? `<div style="font-size:12px;color:#0891b2">Options: ${esc(optsStr)}</div>` : ''}
      </div>`);
    }
    const fieldsHtml = fieldsHtmlParts.join('');

    const html = CF_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('builder')}
      <a href="/forms" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forms</a>
      <div class="cf-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(form.title)}</h1>
            <p style="font-size:13px;color:#94a3b8;margin:0">${formStatusBadge(form.status)} — ${fields.length} fields — ${form.is_public ? 'Public' : 'Private'}</p>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/forms/${formId}" class="cf-btn cf-btn-secondary" target="_blank">👁 Preview</a>
            <a href="/forms/responses/${formId}" class="cf-btn cf-btn-success">📊 Responses</a>
          </div>
        </div>
      </div>
      <div class="cf-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Form Fields (${fields.length})</h3>
        ${fieldsHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No fields defined yet</p>'}
      </div>
    </div>`;
    res.send(renderPage('Edit Form: ' + form.title, html, user, req));
  }));

  app.post('/forms/builder/:id/fields/:fid/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id, fieldId = req.params.fid;
    await pool.query(`DELETE FROM form_field_options WHERE field_id=$1 AND tenant_id=$2`, [fieldId, tid]);
    await pool.query(`DELETE FROM custom_field_values WHERE field_id=$1 AND tenant_id=$2`, [fieldId, tid]);
    await pool.query(`DELETE FROM custom_fields WHERE id=$1 AND tenant_id=$2 AND form_id=$3`, [fieldId, tid, formId]);
    res.redirect('/forms/builder/' + formId);
  }));

  // ============================================================
  // ROUTE 5: GET /forms/:id — Public form view
  // ============================================================
  app.get('/forms/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [formId, tid])).rows[0];
    if (!form) return res.send(renderPage('Not Found', '<div class="cf-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Form not found</h2></div>', user, req));

    const fields = (await pool.query(`SELECT * FROM custom_fields WHERE form_id=$1 AND tenant_id=$2 AND field_type != 'section' ORDER BY sort_order`, [formId, tid])).rows;
    const fieldInputs = fields.map(f => {
      const reqMark = f.is_required ? ' <span style="color:#dc2626">*</span>' : '';
      let input = '';
      switch (f.field_type) {
        case 'text': input = `<input type="text" name="field_${f.id}" ${f.is_required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`; break;
        case 'textarea': input = `<textarea name="field_${f.id}" ${f.is_required ? 'required' : ''} rows="4" placeholder="${esc(f.placeholder || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea>`; break;
        case 'number': input = `<input type="number" name="field_${f.id}" ${f.is_required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`; break;
        case 'email': input = `<input type="email" name="field_${f.id}" ${f.is_required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`; break;
        case 'date': input = `<input type="date" name="field_${f.id}" ${f.is_required ? 'required' : ''} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`; break;
        default: input = `<input type="text" name="field_${f.id}" ${f.is_required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`;
      }
      return `<div style="margin-bottom:16px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">${esc(f.label)}${reqMark}</label>${input}</div>`;
    }).join('');

    const html = CF_CSS + `<div style="max-width:700px;margin:0 auto;padding-top:20px">
      <div class="cf-card" style="padding:28px;border:2px solid #e2e8f0">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(form.title)}</h1>
          ${form.description ? `<p style="font-size:13px;color:#94a3b8;margin:0">${esc(form.description)}</p>` : ''}
        </div>
        <form method="POST" action="/forms/${formId}/submit">
          ${fieldInputs}
          <button type="submit" class="cf-btn cf-btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:15px;margin-top:8px">📤 Submit Response</button>
        </form>
      </div>
      <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:12px">Powered by Comfort Zone Forms</p>
    </div>`;
    res.send(renderPage(form.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /forms/:id/submit — Submit form response
  // ============================================================
  app.post('/forms/:id/submit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [formId, tid])).rows[0];
    if (!form) return res.redirect('/forms');

    const fields = (await pool.query(`SELECT * FROM custom_fields WHERE form_id=$1 AND tenant_id=$2 AND field_type != 'section' ORDER BY sort_order`, [formId, tid])).rows;
    const submission = await pool.query(
      `INSERT INTO form_submissions (tenant_id, form_id, respondent_id, respondent_name, respondent_email) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, formId, user.id, user.name || '', user.email || '']
    );
    const subId = submission.rows[0].id;

    for (const f of fields) {
      const val = req.body['field_' + f.id];
      if (val !== undefined && val !== '') {
        await pool.query(
          `INSERT INTO custom_field_values (tenant_id, submission_id, field_id, field_label, field_value) VALUES ($1,$2,$3,$4,$5)`,
          [tid, subId, f.id, f.label, String(val)]
        );
      }
    }
    await pool.query(`UPDATE custom_forms SET updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [formId, tid]);
    req.session.flash = { type: 'success', msg: 'Form submitted successfully!' };
    res.redirect('/forms/' + formId);
  }));

  // ============================================================
  // ROUTE 7: GET /forms/responses/:id — View submissions
  // ============================================================
  app.get('/forms/responses/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [formId, tid])).rows[0];
    if (!form) return res.send(renderPage('Not Found', '<div class="cf-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Form not found</h2></div>', user, req));

    const fields = (await pool.query(`SELECT * FROM custom_fields WHERE form_id=$1 AND tenant_id=$2 AND field_type != 'section' ORDER BY sort_order`, [formId, tid])).rows;
    const submissions = (await pool.query(
      `SELECT fs.*, (SELECT COUNT(*)::int FROM custom_field_values WHERE submission_id=fs.id) as answer_count FROM form_submissions fs WHERE fs.form_id=$1 AND fs.tenant_id=$2 ORDER BY fs.submitted_at DESC LIMIT 50`,
      [formId, tid]
    )).rows;

    const headers = fields.map(f => `<th>${esc(f.label)}</th>`).join('');
    const rowParts = [];
    for (const s of submissions) {
      const vals = (await pool.query(`SELECT * FROM custom_field_values WHERE submission_id=$1 AND tenant_id=$2`, [s.id, tid])).rows;
      const cells = fields.map(f => {
        const v = vals.find(v => v.field_id === f.id);
        return `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v?.field_value || '')}">${esc(v?.field_value || '—')}</td>`;
      }).join('');
      rowParts.push(`<tr><td style="font-weight:600;color:#1e293b">${esc(s.respondent_name || 'Anonymous')}</td><td style="color:#94a3b8;font-size:12px">${fmtDateTime(s.submitted_at)}</td>${cells}</tr>`);
    }
    const rows = rowParts.join('');

    const html = CF_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <a href="/forms" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forms</a>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0 0 4px;color:#1e293b;font-size:22px">📊 Responses: ${esc(form.title)}</h1>
          <p style="font-size:13px;color:#94a3b8;margin:0">${submissions.length} responses collected</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/forms/responses/${formId}/export" class="cf-btn cf-btn-success">📥 Export CSV</a>
          <a href="/forms/${formId}" class="cf-btn cf-btn-secondary" target="_blank">👁 View Form</a>
        </div>
      </div>
      <div class="cf-card">
        <div style="overflow-x:auto"><table class="cf-table">
          <thead><tr><th>Respondent</th><th>Submitted</th>${headers}</tr></thead>
          <tbody>${rows || '<tr><td colspan="' + (fields.length + 2) + '" style="text-align:center;color:#94a3b8;padding:30px">No responses yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Form Responses: ' + form.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /forms/responses/:id/export — CSV export
  // ============================================================
  app.get('/forms/responses/:id/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [formId, tid])).rows[0];
    if (!form) return res.redirect('/forms');

    const fields = (await pool.query(`SELECT * FROM custom_fields WHERE form_id=$1 AND tenant_id=$2 AND field_type != 'section' ORDER BY sort_order`, [formId, tid])).rows;
    const submissions = (await pool.query(`SELECT * FROM form_submissions WHERE form_id=$1 AND tenant_id=$2 ORDER BY submitted_at`, [formId, tid])).rows;

    const headerRow = ['Respondent', 'Email', 'Submitted At', ...fields.map(f => f.label)];
    const csvRows = [headerRow.map(h => `"${h}"`).join(',')];
    for (const s of submissions) {
      const vals = (await pool.query(`SELECT * FROM custom_field_values WHERE submission_id=$1 AND tenant_id=$2`, [s.id, tid])).rows;
      const row = [s.respondent_name || '', s.respondent_email || '', fmtDateTime(s.submitted_at)];
      for (const f of fields) {
        const v = vals.find(v => v.field_id === f.id);
        row.push((v?.field_value || '').replace(/"/g, '""'));
      }
      csvRows.push(row.map(c => `"${c}"`).join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${form.title.replace(/[^a-z0-9]/gi, '_')}_responses.csv"`);
    res.send(csvRows.join('\n'));
  }));

  // ============================================================
  // ROUTE 9: GET /forms/templates — Template gallery
  // ============================================================
  app.get('/forms/templates', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const templates = [
      { id: 1, name: 'Leave Request', desc: 'Employee leave application form with dates, reason, and approval', icon: '🏖️', fields: '[{"type":"text","label":"Employee Name"},{"type":"select","label":"Leave Type","options":"Annual,Sick,Maternity,Paternity,Unpaid"},{"type":"date","label":"Start Date"},{"type":"date","label":"End Date"},{"type":"textarea","label":"Reason"}]' },
      { id: 2, name: 'Student Feedback', desc: 'Course feedback with ratings, comments, and suggestions', icon: '🎓', fields: '[{"type":"select","label":"Course","options":"Mathematics,English,Science,History"},{"type":"rating","label":"Overall Rating"},{"type":"textarea","label":"What did you like?"},{"type":"textarea","label":"Suggestions for improvement"},{"type":"radio","label":"Would you recommend?","options":"Yes,No,Maybe"}]' },
      { id: 3, name: 'Parent Contact', desc: 'Parent information collection for school records', icon: '👨‍👩‍👧', fields: '[{"type":"text","label":"Parent Full Name"},{"type":"email","label":"Email Address"},{"type":"phone","label":"Phone Number"},{"type":"text","label":"Occupation"},{"type":"textarea","label":"Emergency Contact Info"}]' },
      { id: 4, name: 'Incident Report', desc: 'Document incidents with details, witnesses, and actions taken', icon: '📋', fields: '[{"type":"date","label":"Incident Date"},{"type":"text","label":"Location"},{"type":"select","label":"Severity","options":"Low,Medium,High,Critical"},{"type":"textarea","label":"Description"},{"type":"text","label":"Witnesses"},{"type":"textarea","label":"Actions Taken"}]' },
      { id: 5, name: 'Equipment Request', desc: 'Request equipment, supplies, or resources', icon: '💻', fields: '[{"type":"text","label":"Item Name"},{"type":"select","label":"Category","options":"Electronics,Furniture,Stationery,Sports,Lab Equipment"},{"type":"number","label":"Quantity"},{"type":"date","label":"Needed By"},{"type":"textarea","label":"Justification"}]' },
      { id: 6, name: 'Visitor Check-in', desc: 'Visitor registration form for security tracking', icon: '🏛️', fields: '[{"type":"text","label":"Visitor Name"},{"type":"text","label":"Organization"},{"type":"phone","label":"Phone"},{"type":"text","label":"Purpose of Visit"},{"type":"text","label":"Person to Visit"},{"type":"date","label":"Visit Date"}]' }
    ];

    const cardsHtml = templates.map(t => `<div class="cf-template-card">
      <div class="cf-template-icon">${t.icon}</div>
      <div class="cf-template-name">${t.name}</div>
      <div class="cf-template-desc">${t.desc}</div>
      <form method="POST" action="/forms/templates/${t.id}/use" style="margin-top:12px">
        <button type="submit" class="cf-btn cf-btn-primary" style="padding:6px 16px;font-size:12px">Use Template</button>
      </form>
    </div>`).join('');

    const html = CF_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('templates')}
      <div style="margin-bottom:20px">
        <h1 style="font-size:24px;color:#1e293b">📦 Form Templates</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Start with a pre-built template and customize it to your needs</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${cardsHtml}</div>
    </div>`;
    res.send(renderPage('Form Templates', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /forms/templates/:id/use — Create from template
  // ============================================================
  app.post('/forms/templates/:id/use', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, tmplId = req.params.id;
    const templates = {
      1: { name: 'Leave Request', desc: 'Employee leave application form', fields: [{ type: 'text', label: 'Employee Name' }, { type: 'select', label: 'Leave Type', options: 'Annual,Sick,Maternity,Paternity,Unpaid' }, { type: 'date', label: 'Start Date' }, { type: 'date', label: 'End Date' }, { type: 'textarea', label: 'Reason' }] },
      2: { name: 'Student Feedback', desc: 'Course feedback with ratings', fields: [{ type: 'select', label: 'Course', options: 'Mathematics,English,Science,History' }, { type: 'text', label: 'Overall Rating (1-5)' }, { type: 'textarea', label: 'What did you like?' }, { type: 'textarea', label: 'Suggestions' }, { type: 'radio', label: 'Recommend?', options: 'Yes,No,Maybe' }] },
      3: { name: 'Parent Contact', desc: 'Parent information collection', fields: [{ type: 'text', label: 'Parent Full Name' }, { type: 'email', label: 'Email Address' }, { type: 'text', label: 'Phone Number' }, { type: 'text', label: 'Occupation' }, { type: 'textarea', label: 'Emergency Contact' }] },
      4: { name: 'Incident Report', desc: 'Document incidents', fields: [{ type: 'date', label: 'Incident Date' }, { type: 'text', label: 'Location' }, { type: 'select', label: 'Severity', options: 'Low,Medium,High,Critical' }, { type: 'textarea', label: 'Description' }, { type: 'textarea', label: 'Actions Taken' }] },
      5: { name: 'Equipment Request', desc: 'Request equipment', fields: [{ type: 'text', label: 'Item Name' }, { type: 'select', label: 'Category', options: 'Electronics,Furniture,Stationery,Sports,Lab' }, { type: 'number', label: 'Quantity' }, { type: 'date', label: 'Needed By' }, { type: 'textarea', label: 'Justification' }] },
      6: { name: 'Visitor Check-in', desc: 'Visitor registration', fields: [{ type: 'text', label: 'Visitor Name' }, { type: 'text', label: 'Organization' }, { type: 'text', label: 'Phone' }, { type: 'text', label: 'Purpose' }, { type: 'date', label: 'Visit Date' }] }
    };

    const tmpl = templates[tmplId];
    if (!tmpl) return res.redirect('/forms/templates');

    const form = await pool.query(
      `INSERT INTO custom_forms (tenant_id, title, description, status, created_by) VALUES ($1,$2,$3,'draft',$4) RETURNING id`,
      [tid, tmpl.name, tmpl.desc, user.id]
    );
    const formId = form.rows[0].id;

    for (let i = 0; i < tmpl.fields.length; i++) {
      const f = tmpl.fields[i];
      const field = await pool.query(
        `INSERT INTO custom_fields (tenant_id, form_id, field_type, label, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tid, formId, f.type, f.label, i + 1]
      );
      if (f.options) {
        const opts = f.options.split(',');
        for (let j = 0; j < opts.length; j++) {
          await pool.query(
            `INSERT INTO form_field_options (tenant_id, field_id, option_label, option_value, sort_order) VALUES ($1,$2,$3,$4,$5)`,
            [tid, field.rows[0].id, opts[j].trim(), opts[j].trim().toLowerCase().replace(/\s+/g, '_'), j + 1]
          );
        }
      }
    }
    res.redirect('/forms/builder/' + formId);
  }));

  // ============================================================
  // ROUTE 11: GET /forms/api/forms — JSON API
  // ============================================================
  app.get('/forms/api/forms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const forms = (await pool.query(
      `SELECT f.id, f.title, f.description, f.status, f.is_public, f.created_at, f.updated_at, (SELECT COUNT(*)::int FROM form_submissions WHERE form_id=f.id) as submission_count FROM custom_forms f WHERE f.tenant_id=$1 ORDER BY f.title`,
      [tid]
    )).rows;
    res.json({ forms, count: forms.length });
  }));

  console.log('[CustomForms] Module loaded');
};
