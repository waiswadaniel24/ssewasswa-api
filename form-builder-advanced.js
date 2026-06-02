/**
 * Advanced Form Builder Module
 * Full-featured form builder with drag-drop field editor, conditional logic,
 * analytics, public submissions, templates, CSV export, and review workflow.
 *
 * Usage in server.js:
 *   const formBuilderAdvanced = require('./form-builder-advanced');
 *   formBuilderAdvanced(app, pool, opts);
 */
'use strict';

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const renderPage = opts.renderPage || ((title, content, user) => content);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); }});
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const userSlug = (req) => req.session?.user?.username || req.session?.user?.email || 'unknown';

  // ──────────────────────────── Helpers ────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  const FIELD_TYPES = [
    { value: 'text', label: 'Short Text', icon: '📝', category: 'basic' },
    { value: 'textarea', label: 'Long Text', icon: '📄', category: 'basic' },
    { value: 'number', label: 'Number', icon: '🔢', category: 'basic' },
    { value: 'email', label: 'Email', icon: '📧', category: 'basic' },
    { value: 'phone', label: 'Phone', icon: '📞', category: 'basic' },
    { value: 'date', label: 'Date', icon: '📅', category: 'basic' },
    { value: 'time', label: 'Time', icon: '⏰', category: 'basic' },
    { value: 'url', label: 'URL', icon: '🔗', category: 'basic' },
    { value: 'select', label: 'Dropdown', icon: '📋', category: 'choice' },
    { value: 'radio', label: 'Radio Group', icon: '🔘', category: 'choice' },
    { value: 'checkbox', label: 'Checkboxes', icon: '☑️', category: 'choice' },
    { value: 'file', label: 'File Upload', icon: '📎', category: 'advanced' },
    { value: 'rating', label: 'Rating', icon: '⭐', category: 'advanced' },
    { value: 'range', label: 'Range Slider', icon: '📊', category: 'advanced' },
    { value: 'section', label: 'Section Header', icon: '📌', category: 'layout' },
    { value: 'divider', label: 'Divider', icon: '➖', category: 'layout' },
    { value: 'html', label: 'HTML Block', icon: '🖥️', category: 'layout' },
  ];

  const TEMPLATES = [
    { id: 'contact', name: 'Contact Form', icon: '📧', desc: 'Basic contact form with name, email, phone, subject, and message fields.',
      fields: [{ type: 'text', label: 'Full Name', required: true },{ type: 'email', label: 'Email Address', required: true },{ type: 'phone', label: 'Phone Number' },{ type: 'text', label: 'Subject', required: true },{ type: 'textarea', label: 'Message', required: true, placeholder: 'Type your message here...' }] },
    { id: 'feedback', name: 'Feedback Survey', icon: '⭐', desc: 'Customer/student feedback with ratings, NPS score, and open comments.',
      fields: [{ type: 'section', label: 'How was your experience?' },{ type: 'rating', label: 'Overall Satisfaction' },{ type: 'radio', label: 'Would you recommend us?', options: 'Definitely,Probably,Not Sure,Probably Not,Definitely Not' },{ type: 'select', label: 'What did you like most?', options: 'Teaching Quality,Facilities,Staff Friendliness,Value for Money,Other' },{ type: 'textarea', label: 'What can we improve?' },{ type: 'text', label: 'Your Name' },{ type: 'email', label: 'Email (optional)' }] },
    { id: 'registration', name: 'Event Registration', icon: '🎉', desc: 'Event sign-up form with attendee details, session selection, and dietary requirements.',
      fields: [{ type: 'text', label: 'Full Name', required: true },{ type: 'email', label: 'Email Address', required: true },{ type: 'phone', label: 'Phone Number', required: true },{ type: 'select', label: 'Ticket Type', options: 'General,VIP,Student,Group' },{ type: 'checkbox', label: 'Sessions to Attend', options: 'Keynote,Workshop A,Workshop B,Networking Lunch' },{ type: 'radio', label: 'Dietary Requirements', options: 'None,Vegetarian,Vegan,Gluten-Free,Other' },{ type: 'textarea', label: 'Special Requirements' }] },
    { id: 'application', name: 'Job Application', icon: '💼', desc: 'Employment application with personal info, experience, education, and file upload.',
      fields: [{ type: 'section', label: 'Personal Information' },{ type: 'text', label: 'Full Name', required: true },{ type: 'email', label: 'Email Address', required: true },{ type: 'phone', label: 'Phone Number', required: true },{ type: 'url', label: 'LinkedIn Profile' },{ type: 'section', label: 'Professional Details' },{ type: 'select', label: 'Position Applied For', options: 'Software Engineer,Designer,Product Manager,Marketing,HR,Other' },{ type: 'number', label: 'Years of Experience' },{ type: 'textarea', label: 'Cover Letter' },{ type: 'file', label: 'Resume / CV', required: true }] },
    { id: 'quiz', name: 'Quiz / Assessment', icon: '🧠', desc: 'Create quizzes with various question types for assessments and tests.',
      fields: [{ type: 'section', label: 'Student Assessment Quiz' },{ type: 'radio', label: 'Question 1: Capital of France?', options: 'London,Paris,Berlin,Madrid' },{ type: 'radio', label: 'Question 2: Largest planet?', options: 'Mars,Jupiter,Saturn,Neptune' },{ type: 'checkbox', label: 'Question 3: Select all even numbers', options: '1,2,3,4,5,6' },{ type: 'select', label: 'Question 4: Boiling point of water?', options: '50°C,100°C,150°C,200°C' },{ type: 'text', label: 'Question 5: Who wrote Hamlet?' },{ type: 'textarea', label: 'Short Essay: Explain the water cycle' }] },
    { id: 'order', name: 'Order / Request Form', icon: '📦', desc: 'Product order or resource request with item selection, quantities, and delivery info.',
      fields: [{ type: 'section', label: 'Contact Information' },{ type: 'text', label: 'Name', required: true },{ type: 'email', label: 'Email', required: true },{ type: 'phone', label: 'Phone' },{ type: 'section', label: 'Order Details' },{ type: 'select', label: 'Item Category', options: 'Stationery,Electronics,Furniture,Sports Equipment,Lab Supplies' },{ type: 'text', label: 'Item Name / Description', required: true },{ type: 'number', label: 'Quantity', required: true },{ type: 'date', label: 'Delivery Date Needed' },{ type: 'textarea', label: 'Special Instructions' }] },
    { id: 'health', name: 'Health / Medical Form', icon: '🏥', desc: 'Health declaration with medical history, allergies, emergency contacts, and consent.',
      fields: [{ type: 'section', label: 'Patient Information' },{ type: 'text', label: 'Full Name', required: true },{ type: 'date', label: 'Date of Birth', required: true },{ type: 'radio', label: 'Gender', options: 'Male,Female,Non-binary,Prefer not to say' },{ type: 'text', label: 'Blood Group', placeholder: 'e.g. A+, B-, O+' },{ type: 'section', label: 'Medical History' },{ type: 'checkbox', label: 'Existing Conditions', options: 'Diabetes,Hypertension,Asthma,Heart Disease,Allergies,None' },{ type: 'textarea', label: 'Current Medications' },{ type: 'textarea', label: 'Allergies' },{ type: 'textarea', label: 'Additional Notes' }] },
    { id: 'evaluation', name: 'Teacher Evaluation', icon: '👨‍🏫', desc: 'Peer or student teacher evaluation with structured rating criteria.',
      fields: [{ type: 'section', label: 'Evaluator Details' },{ type: 'text', label: 'Evaluator Name', required: true },{ type: 'select', label: 'Subject / Course', options: 'Mathematics,English,Science,History,Art,Physical Education' },{ type: 'section', label: 'Evaluation Criteria' },{ type: 'rating', label: 'Teaching Clarity' },{ type: 'rating', label: 'Subject Knowledge' },{ type: 'rating', label: 'Student Engagement' },{ type: 'rating', label: 'Classroom Management' },{ type: 'rating', label: 'Use of Technology' },{ type: 'textarea', label: 'Strengths' },{ type: 'textarea', label: 'Areas for Improvement' },{ type: 'textarea', label: 'Additional Comments' }] },
  ];

  function fieldTypeBadge(type) {
    const ft = FIELD_TYPES.find(f => f.value === type);
    const icon = ft ? ft.icon : '📝';
    const label = ft ? ft.label : type;
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:rgba(59,130,246,0.15);color:#60a5fa">${icon} ${label}</span>`;
  }

  function statusBadge(s) {
    const m = {
      new: { bg: 'rgba(59,130,246,0.15)', c: '#60a5fa' },
      reviewed: { bg: 'rgba(16,185,129,0.15)', c: '#34d399' },
      flagged: { bg: 'rgba(245,158,11,0.15)', c: '#fbbf24' },
      rejected: { bg: 'rgba(239,68,68,0.15)', c: '#f87171' },
      published: { bg: 'rgba(16,185,129,0.15)', c: '#34d399' },
      draft: { bg: 'rgba(107,114,128,0.15)', c: '#9ca3af' },
    };
    const v = m[s] || m.new;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${s || 'new'}</span>`;
  }

  // ──────────────────────────── Inline CSS (Dark Theme, Blue Accents) ────────────────────────────
  const CSS = `<style>
    .fb-wrap{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:1400px;margin:0 auto;padding:24px;color:#e5e7eb}
    .fb-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
    .fb-header h1{font-size:1.75rem;font-weight:700;margin:0;color:#f9fafb}
    .fb-header p.sub{margin:4px 0 0;color:#9ca3af;font-size:.95rem}
    .fb-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:10px;border:none;cursor:pointer;font-size:.875rem;font-weight:600;transition:all .15s;text-decoration:none}
    .fb-btn:hover{opacity:.9;transform:translateY(-1px)}
    .fb-btn-primary{background:#3b82f6;color:#fff}.fb-btn-primary:hover{background:#2563eb}
    .fb-btn-secondary{background:rgba(107,114,128,0.2);color:#d1d5db;border:1px solid rgba(107,114,128,0.3)}.fb-btn-secondary:hover{background:rgba(107,114,128,0.3)}
    .fb-btn-success{background:#059669;color:#fff}.fb-btn-danger{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)}
    .fb-btn-danger:hover{background:rgba(239,68,68,0.25)}
    .fb-btn-sm{padding:5px 12px;font-size:.8rem;border-radius:8px}
    .fb-card{background:#1e2330;border:1px solid rgba(107,114,128,0.2);border-radius:14px;padding:20px;margin-bottom:16px;transition:box-shadow .15s}
    .fb-card:hover{box-shadow:0 4px 20px rgba(0,0,0,0.3)}
    .fb-card h3{margin:0 0 10px;font-size:1rem;font-weight:600;color:#f3f4f6}
    .fb-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
    .fb-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#9ca3af;background:rgba(107,114,128,0.1);transition:.15s}
    .fb-nav a:hover{background:rgba(107,114,128,0.2);color:#e5e7eb}
    .fb-nav a.active{background:#3b82f6;color:#fff}
    .fb-table{width:100%;border-collapse:collapse;font-size:13px}
    .fb-table th{padding:11px 14px;text-align:left;border-bottom:2px solid rgba(107,114,128,0.3);color:#9ca3af;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#161b26}
    .fb-table td{padding:10px 14px;border-bottom:1px solid rgba(107,114,128,0.15);color:#d1d5db}
    .fb-table tr:hover td{background:rgba(59,130,246,0.05)}
    .fb-input,.fb-select,.fb-textarea{width:100%;padding:10px 14px;border:1px solid rgba(107,114,128,0.3);border-radius:10px;font-size:14px;color:#e5e7eb;background:#161b26;box-sizing:border-box;transition:border-color .15s}
    .fb-input:focus,.fb-select:focus,.fb-textarea:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.15)}
    .fb-input::placeholder{color:#6b7280}
    .fb-textarea{resize:vertical;min-height:80px}
    .fb-label{display:block;font-size:13px;font-weight:600;color:#d1d5db;margin-bottom:5px}
    .fb-form-group{margin-bottom:16px}
    .fb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
    .fb-stat{background:#1e2330;border:1px solid rgba(107,114,128,0.2);border-radius:14px;padding:20px;text-align:center}
    .fb-stat-num{font-size:2rem;font-weight:800;color:#3b82f6;letter-spacing:-.02em}
    .fb-stat-label{font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
    .fb-field{border:2px dashed rgba(107,114,128,0.3);border-radius:12px;padding:16px;margin-bottom:12px;background:rgba(22,27,38,0.5);transition:.15s;cursor:move}
    .fb-field:hover{border-color:#3b82f6;background:rgba(59,130,246,0.05)}
    .fb-field.dragging{opacity:.5;border-color:#60a5fa}
    .fb-field-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .fb-field-label{font-size:14px;font-weight:700;color:#f3f4f6}
    .fb-field-actions{display:flex;gap:6px}
    .fb-field-actions button{padding:4px 10px;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600}
    .fb-template-card{border:2px solid rgba(107,114,128,0.2);border-radius:14px;padding:20px;text-align:center;transition:.15s;cursor:pointer;background:#1e2330}
    .fb-template-card:hover{border-color:#3b82f6;box-shadow:0 4px 16px rgba(59,130,246,0.15);transform:translateY(-2px)}
    .fb-template-icon{font-size:36px;margin-bottom:8px}
    .fb-template-name{font-size:15px;font-weight:700;color:#f3f4f6}
    .fb-template-desc{font-size:12px;color:#9ca3af;margin-top:4px}
    .fb-grid{display:grid;gap:16px}
    .fb-grid-2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
    .fb-grid-3{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
    .fb-grid-4{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    .fb-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.72rem;font-weight:600}
    .fb-badge-blue{background:rgba(59,130,246,0.15);color:#60a5fa}
    .fb-badge-green{background:rgba(16,185,129,0.15);color:#34d399}
    .fb-badge-amber{background:rgba(245,158,11,0.15);color:#fbbf24}
    .fb-badge-red{background:rgba(239,68,68,0.15);color:#f87171}
    .fb-badge-gray{background:rgba(107,114,128,0.15);color:#9ca3af}
    .fb-tabs{display:flex;gap:4px;border-bottom:2px solid rgba(107,114,128,0.2);margin-bottom:20px}
    .fb-tab{padding:10px 18px;font-size:.85rem;font-weight:500;color:#9ca3af;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
    .fb-tab.active{color:#3b82f6;border-bottom-color:#3b82f6}
    .fb-tab:hover{color:#e5e7eb}
    .fb-empty{text-align:center;padding:60px 20px;color:#9ca3af}
    .fb-empty .icon{font-size:3rem;margin-bottom:12px}
    .fb-progress{height:8px;background:rgba(107,114,128,0.2);border-radius:4px;overflow:hidden;margin-top:8px}
    .fb-progress-fill{height:100%;border-radius:4px;background:#3b82f6;transition:width .4s}
    .fb-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .fb-filter label{display:block;font-size:12px;font-weight:600;color:#9ca3af;margin-bottom:4px}
    .fb-condition{background:#161b26;border:1px solid rgba(107,114,128,0.2);border-radius:10px;padding:14px;margin-bottom:10px}
    .fb-toast{position:fixed;bottom:24px;right:24px;padding:12px 20px;background:#1e2330;border:1px solid rgba(59,130,246,0.3);color:#e5e7eb;border-radius:10px;font-size:.85rem;z-index:9999;animation:slideIn .3s}
    .fb-chart-bar{display:flex;align-items:end;gap:8px;height:120px;padding:8px 0}
    .fb-chart-bar-item{flex:1;background:rgba(59,130,246,0.3);border-radius:4px 4px 0 0;min-width:20px;transition:height .4s;position:relative}
    .fb-chart-bar-item:hover{background:rgba(59,130,246,0.5)}
    .fb-chart-bar-item span{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:9px;color:#9ca3af;white-space:nowrap}
    .fb-public-form{max-width:700px;margin:0 auto;padding:24px}
    .fb-public-card{background:#1e2330;border:1px solid rgba(107,114,128,0.2);border-radius:16px;padding:32px}
    .fb-public-card h1{font-size:24px;font-weight:700;color:#f9fafb;text-align:center;margin:0 0 6px}
    .fb-public-card p.desc{font-size:14px;color:#9ca3af;text-align:center;margin:0 0 24px}
    .fb-public-card .fb-input,.fb-public-card .fb-textarea,.fb-public-card .fb-select{background:#161b26;border:1px solid rgba(107,114,128,0.3)}
    .fb-public-card label{color:#d1d5db}
    .fb-public-submit{width:100%;padding:14px;background:#3b82f6;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s}
    .fb-public-submit:hover{background:#2563eb}
    @keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
    @media(max-width:768px){.fb-grid-2,.fb-grid-3,.fb-grid-4{grid-template-columns:1fr!important}.fb-header{flex-direction:column;align-items:flex-start}.fb-filter{flex-direction:column}.fb-nav{gap:4px}.fb-nav a{padding:6px 12px;font-size:12px}}
  </style>`;

  const nav = (active) => `<div class="fb-nav">
    <a href="/admin/form-builder" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/admin/form-builder/create" class="${active === 'create' ? 'active' : ''}">➕ New Form</a>
    <a href="/admin/form-builder/templates" class="${active === 'templates' ? 'active' : ''}">📦 Templates</a>
    <a href="/admin/form-builder/fields/types" class="${active === 'fields' ? 'active' : ''}">🔧 Field Types</a>
  </div>`;

  // ──────────────────────────── Migrations ────────────────────────────
  (async () => {
    try {
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE TABLE IF NOT EXISTS custom_forms (
        id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
        fields JSONB DEFAULT '[]', theme TEXT DEFAULT 'light',
        submit_button_text TEXT DEFAULT 'Submit', success_message TEXT,
        allow_file_upload BOOLEAN DEFAULT false, max_file_size_mb INT DEFAULT 10,
        require_login BOOLEAN DEFAULT false, limit_submissions BOOLEAN DEFAULT false,
        max_submissions INT DEFAULT 0, notification_email TEXT,
        is_active BOOLEAN DEFAULT true, published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(), tenant_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE TABLE IF NOT EXISTS form_submissions (
        id SERIAL PRIMARY KEY, form_id INT REFERENCES custom_forms(id) ON DELETE CASCADE,
        submitter_id INT, submitter_name TEXT, submitter_email TEXT,
        responses JSONB, status TEXT DEFAULT 'new',
        reviewed_by INT, reviewed_at TIMESTAMPTZ, notes TEXT,
        ip_address TEXT, user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), tenant_id INT DEFAULT 1
      )`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE TABLE IF NOT EXISTS form_conditions (
        id SERIAL PRIMARY KEY, form_id INT REFERENCES custom_forms(id) ON DELETE CASCADE,
        field_id TEXT, operator TEXT, value TEXT, action TEXT,
        target_field_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE INDEX IF NOT EXISTS idx_cfa_form ON custom_forms(tenant_id)`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE INDEX IF NOT EXISTS idx_fs_form_id ON form_submissions(form_id)`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE INDEX IF NOT EXISTS idx_fs_status ON form_submissions(status)`);
      await migrateQuery(pool, 'FormBuilderAdvanced', `CREATE INDEX IF NOT EXISTS idx_fc_form_id ON form_conditions(form_id)`);
      console.log('[FormBuilderAdvanced] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ═══════════════════════════ ROUTES ═══════════════════════════

  // ─── 1. GET / - Form List Dashboard ───
  app.get('/admin/form-builder', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: forms } = await pool.query(`
      SELECT f.*, (SELECT COUNT(*)::int FROM form_submissions WHERE form_id=f.id) as submission_count,
        (SELECT COUNT(*)::int FROM form_conditions WHERE form_id=f.id) as condition_count
      FROM custom_forms f WHERE f.tenant_id=$1 ORDER BY f.created_at DESC`, [tid]);
    const totalForms = forms.length;
    const totalSubmissions = forms.reduce((s, f) => s + (f.submission_count || 0), 0);
    const publishedForms = forms.filter(f => f.is_active && f.published_at).length;
    const recentSubs = (await pool.query(`SELECT COUNT(*)::int as c FROM form_submissions WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '7 days'`, [tid])).rows[0].c;

    const rows = forms.map(f => {
      const fieldCount = Array.isArray(f.fields) ? f.fields.length : 0;
      return `<tr>
        <td><a href="/admin/form-builder/edit/${f.id}" style="color:#60a5fa;text-decoration:none;font-weight:600">${esc(f.title)}</a></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.description || '—').substring(0, 80)}</td>
        <td><span class="fb-badge fb-badge-blue">${fieldCount} fields</span></td>
        <td style="font-weight:600;color:#60a5fa">${f.submission_count || 0}</td>
        <td>${f.is_active && f.published_at ? statusBadge('published') : statusBadge('draft')}</td>
        <td>${fmtDateTime(f.created_at)}</td>
        <td style="white-space:nowrap">
          <a href="/admin/form-builder/edit/${f.id}" class="fb-btn fb-btn-secondary fb-btn-sm">Edit</a>
          <a href="/admin/form-builder/${f.id}/submissions" class="fb-btn fb-btn-secondary fb-btn-sm">Submissions</a>
          <a href="/admin/form-builder/${f.id}/analytics" class="fb-btn fb-btn-secondary fb-btn-sm">Analytics</a>
        </td>
      </tr>`;
    }).join('');

    const html = `${CSS}<div class="fb-wrap">
      ${nav('dash')}
      <div class="fb-header"><div><h1>Form Builder</h1><p class="sub">Create powerful forms, collect submissions, and analyze responses</p></div>
        <div style="display:flex;gap:8px">
          <a href="/admin/form-builder/create" class="fb-btn fb-btn-primary">➕ Create Form</a>
          <a href="/admin/form-builder/templates" class="fb-btn fb-btn-secondary">📦 Templates</a>
        </div>
      </div>
      <div class="fb-stats">
        <div class="fb-stat"><div class="fb-stat-num">${totalForms}</div><div class="fb-stat-label">Total Forms</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#34d399">${publishedForms}</div><div class="fb-stat-label">Published</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#a78bfa">${totalSubmissions}</div><div class="fb-stat-label">Total Submissions</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#fbbf24">${recentSubs}</div><div class="fb-stat-label">Last 7 Days</div></div>
      </div>
      <div class="fb-card">
        <h3>📋 All Forms</h3>
        <div style="overflow-x:auto"><table class="fb-table">
          <thead><tr><th>Title</th><th>Description</th><th>Fields</th><th>Submissions</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:30px;color:#9ca3af">No forms yet. Create your first form!</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Form Builder Dashboard', html, req.session?.user));
  }));

  // ─── 2. GET /data - JSON forms list ───
  app.get('/admin/form-builder/data', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows } = await pool.query(`
      SELECT f.*, (SELECT COUNT(*)::int FROM form_submissions WHERE form_id=f.id) as submission_count
      FROM custom_forms f WHERE f.tenant_id=$1 ORDER BY f.created_at DESC`, [tid]);
    res.json({ success: true, forms: rows, total: rows.length });
  }));

  // ─── 3. POST /create - Create new form ───
  app.post('/admin/form-builder/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { title, description, theme, submit_button_text, success_message, allow_file_upload, max_file_size_mb, require_login, limit_submissions, max_submissions, notification_email } = req.body;
    if (!title || !title.trim()) return res.redirect('/admin/form-builder/create');

    const { rows } = await pool.query(
      `INSERT INTO custom_forms (tenant_id, title, description, theme, submit_button_text, success_message,
        allow_file_upload, max_file_size_mb, require_login, limit_submissions, max_submissions, notification_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tid, title.trim(), (description || '').trim(), theme || 'light', submit_button_text || 'Submit',
        (success_message || '').trim(), allow_file_upload === 'on', parseInt(max_file_size_mb) || 10,
        require_login === 'on', limit_submissions === 'on', parseInt(max_submissions) || 0,
        (notification_email || '').trim()]
    );
    audit(req, 'form_create', { id: rows[0].id, title: title.trim() });
    res.redirect('/admin/form-builder/edit/' + rows[0].id);
  }));

  // ─── 4. GET /edit/:id - Edit form with drag-drop builder ───
  app.get('/admin/form-builder/edit/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!form) return res.status(404).send('<div class="fb-empty"><div class="icon">❌</div><h3>Form not found</h3></div>');

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const { rows: conditions } = await pool.query(`SELECT * FROM form_conditions WHERE form_id=$1 ORDER BY id`, [form.id]);

    const fieldTypesByCategory = {};
    FIELD_TYPES.forEach(ft => {
      if (!fieldTypesByCategory[ft.category]) fieldTypesByCategory[ft.category] = [];
      fieldTypesByCategory[ft.category].push(ft);
    });
    const categoryLabels = { basic: 'Basic Fields', choice: 'Choice Fields', advanced: 'Advanced', layout: 'Layout' };
    const fieldPaletteHtml = Object.entries(fieldTypesByCategory).map(([cat, types]) =>
      `<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${categoryLabels[cat] || cat}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px">
        ${types.map(ft => `<div class="fb-template-card" style="padding:12px 8px" onclick="addField('${ft.value}','${ft.label}','${ft.icon}')" draggable="true" ondragstart="dragStart(event,'${ft.value}','${ft.label}','${ft.icon}')">
          <div style="font-size:20px">${ft.icon}</div><div style="font-size:11px;font-weight:600;color:#d1d5db;margin-top:4px">${ft.label}</div>
        </div>`).join('')}
      </div></div>`
    ).join('');

    const existingFieldsHtml = fields.map((f, i) => renderFieldCard(f, i)).join('');
    const conditionsHtml = conditions.map(c => `<div class="fb-condition">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="fb-select" style="width:auto;min-width:150px" data-cond-field="${c.id}">${fields.map(f => `<option value="${f.id}" ${f.id === c.field_id ? 'selected' : ''}>${esc(f.label || f.id)}</option>`).join('')}</select>
        <select class="fb-select" style="width:auto;min-width:100px" data-cond-op="${c.id}">
          ${['equals','not equals','contains','is empty','is not empty','greater than','less than'].map(op => `<option value="${op}" ${c.operator === op ? 'selected' : ''}>${op}</option>`).join('')}
        </select>
        <input class="fb-input" style="width:auto;min-width:120px" value="${esc(c.value || '')}" placeholder="Value" data-cond-val="${c.id}">
        <select class="fb-select" style="width:auto;min-width:130px" data-cond-action="${c.id}">
          ${['show','hide','require','disable'].map(a => `<option value="${a}" ${c.action === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
        <select class="fb-select" style="width:auto;min-width:150px" data-cond-target="${c.id}">${fields.map(f => `<option value="${f.id}" ${f.id === c.target_field_id ? 'selected' : ''}>${esc(f.label || f.id)}</option>`).join('')}</select>
        <button class="fb-btn fb-btn-danger fb-btn-sm" onclick="removeCondition(${c.id})">✕</button>
      </div>
    </div>`).join('');

    const html = `${CSS}<div class="fb-wrap">
      ${nav('create')}
      <a href="/admin/form-builder" style="color:#9ca3af;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="fb-header"><div><h1>Edit: ${esc(form.title)}</h1><p class="sub">${statusBadge(form.is_active && form.published_at ? 'published' : 'draft')} · ${fields.length} fields · ${form.submission_count || 0} submissions</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/admin/form-builder/${form.id}/submissions" class="fb-btn fb-btn-secondary">📊 Submissions</a>
          <a href="/admin/form-builder/${form.id}/analytics" class="fb-btn fb-btn-secondary">📈 Analytics</a>
          <button class="fb-btn fb-btn-primary" onclick="saveForm()">💾 Save Form</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 380px;gap:16px;align-items:start" id="builderGrid">
        <!-- Left: Form Settings + Canvas -->
        <div>
          <div class="fb-card" id="settingsCard">
            <h3>⚙️ Form Settings</h3>
            <input type="hidden" id="formId" value="${form.id}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="fb-form-group"><label class="fb-label">Title *</label><input class="fb-input" id="formTitle" value="${esc(form.title)}" required></div>
              <div class="fb-form-group"><label class="fb-label">Theme</label><select class="fb-select" id="formTheme">
                <option value="light" ${form.theme === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${form.theme === 'dark' ? 'selected' : ''}>Dark</option>
                <option value="blue" ${form.theme === 'blue' ? 'selected' : ''}>Blue Accent</option>
                <option value="minimal" ${form.theme === 'minimal' ? 'selected' : ''}>Minimal</option>
              </select></div>
            </div>
            <div class="fb-form-group"><label class="fb-label">Description</label><textarea class="fb-textarea" id="formDesc" rows="2">${esc(form.description || '')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <div class="fb-form-group"><label class="fb-label">Button Text</label><input class="fb-input" id="formBtnText" value="${esc(form.submit_button_text || 'Submit')}"></div>
              <div class="fb-form-group"><label class="fb-label">Success Message</label><input class="fb-input" id="formSuccessMsg" value="${esc(form.success_message || '')}"></div>
              <div class="fb-form-group"><label class="fb-label">Notification Email</label><input class="fb-input" id="formNotifEmail" value="${esc(form.notification_email || '')}" placeholder="alerts@school.com"></div>
            </div>
            <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:8px">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" id="formFileUpload" ${form.allow_file_upload ? 'checked' : ''}> Allow File Upload</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" id="formRequireLogin" ${form.require_login ? 'checked' : ''}> Require Login</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" id="formLimitSubs" ${form.limit_submissions ? 'checked' : ''}> Limit Submissions</label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div class="fb-form-group"><label class="fb-label">Max File Size (MB)</label><input class="fb-input" type="number" id="formMaxFileSize" value="${form.max_file_size_mb || 10}"></div>
              <div class="fb-form-group"><label class="fb-label">Max Submissions</label><input class="fb-input" type="number" id="formMaxSubs" value="${form.max_submissions || 0}" ${!form.limit_submissions ? 'disabled' : ''}></div>
            </div>
          </div>

          <div class="fb-card">
            <h3>📝 Form Fields <span style="color:#9ca3af;font-weight:400">(${fields.length})</span></h3>
            <div id="fieldCanvas" ondrop="dropField(event)" ondragover="event.preventDefault()"
              style="min-height:100px">
              ${existingFieldsHtml || '<div class="fb-empty" style="padding:30px"><div class="icon">📝</div><p>Drag fields from the right panel or click to add</p></div>'}
            </div>
          </div>
        </div>

        <!-- Right: Field Palette + Conditions -->
        <div>
          <div class="fb-card" style="position:sticky;top:20px">
            <h3>🔧 Field Palette</h3>
            ${fieldPaletteHtml}
          </div>
          <div class="fb-card" style="margin-top:16px">
            <h3>🔀 Conditional Logic <span style="color:#9ca3af;font-weight:400">(${conditions.length})</span></h3>
            <button class="fb-btn fb-btn-secondary fb-btn-sm" onclick="addCondition()" style="margin-bottom:12px">+ Add Condition</button>
            <div id="conditionsContainer">${conditionsHtml}</div>
          </div>
        </div>
      </div>
    </div>

    <script>
      let fieldCounter = ${fields.length};
      let draggedType = null, draggedLabel = null, draggedIcon = null;

      function generateFieldId() { return 'field_' + Date.now() + '_' + (++fieldCounter); }

      function dragStart(e, type, label, icon) { draggedType = type; draggedLabel = label; draggedIcon = icon; e.dataTransfer.effectAllowed = 'copy'; }
      function dropField(e) { e.preventDefault(); if (draggedType) { addField(draggedType, draggedLabel, draggedIcon); draggedType = null; } }

      function addField(type, label, icon) {
        const id = generateFieldId();
        const needsOptions = ['select','radio','checkbox'].includes(type);
        const html = renderFieldHtml(id, type, label || 'Untitled Field', icon || '📝', '', '', needsOptions ? '' : '', false, needsOptions ? 'Option 1, Option 2, Option 3' : '', '', '');
        const canvas = document.getElementById('fieldCanvas');
        const empty = canvas.querySelector('.fb-empty');
        if (empty) empty.remove();
        canvas.insertAdjacentHTML('beforeend', html);
        updateFieldCount();
      }

      function renderFieldHtml(id, type, label, icon, placeholder, helpText, required, minVal, maxVal, defaultValue, validationMsg) {
        const needsOptions = ['select','radio','checkbox'].includes(type);
        return '<div class="fb-field" id="' + id + '_wrapper" draggable="true" ondragstart="dragFieldStart(event)" ondragover="event.preventDefault()" ondrop="dropFieldOnField(event)">' +
          '<div class="fb-field-header"><div style="display:flex;align-items:center;gap:8px"><span style="cursor:grab;font-size:16px">⠿</span><span class="fb-field-label">' + esc(label) + '</span>' + fieldTypeBadgeHtml(type) +
          (required ? ' <span style="color:#f87171;font-size:11px;font-weight:600">*Required</span>' : '') + '</div>' +
          '<div class="fb-field-actions"><button onclick="editField(\'' + id + '\')" style="background:rgba(59,130,246,0.15);color:#60a5fa">Edit</button>' +
          '<button onclick="removeField(\'' + id + '\')" style="background:rgba(239,68,68,0.15);color:#f87171">Delete</button></div></div>' +
          '<div id="' + id + '_props" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(107,114,128,0.2)">' +
          '<input type="hidden" value="' + id + '" class="field-id"><input type="hidden" value="' + type + '" class="field-type">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
          '<div class="fb-form-group"><label class="fb-label">Field Label</label><input class="fb-input field-label" value="' + esc(label) + '"></div>' +
          '<div class="fb-form-group"><label class="fb-label">Placeholder</label><input class="fb-input field-placeholder" value="' + esc(placeholder || '') + '"></div>' +
          '<div class="fb-form-group"><label class="fb-label">Default Value</label><input class="fb-input field-default" value="' + esc(defaultValue || '') + '"></div>' +
          '<div class="fb-form-group"><label class="fb-label">Help Text</label><input class="fb-input field-help" value="' + esc(helpText || '') + '"></div>' +
          (needsOptions ? '<div class="fb-form-group" style="grid-column:1/-1"><label class="fb-label">Options (comma-separated)</label><input class="fb-input field-options" value="' + esc(minVal || 'Option 1, Option 2, Option 3') + '"></div>' : '') +
          (!needsOptions ? '<div class="fb-form-group"><label class="fb-label">Min Value</label><input class="fb-input field-min" type="number" value="' + esc(minVal || '') + '"></div>' +
          '<div class="fb-form-group"><label class="fb-label">Max Value</label><input class="fb-input field-max" type="number" value="' + esc(maxVal || '') + '"></div>' : '') +
          '<div class="fb-form-group"><label class="fb-label">Validation Message</label><input class="fb-input field-validation" value="' + esc(validationMsg || '') + '" placeholder="e.g. This field is required"></div>' +
          '</div><div style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" class="field-required" ' + (required ? 'checked' : '') + '> Required Field</label></div></div></div>';
      }

      function fieldTypeBadgeHtml(type) { return '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:rgba(59,130,246,0.15);color:#60a5fa">' + type + '</span>'; }
      function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

      function editField(id) { const props = document.getElementById(id + '_props'); if (props) props.style.display = props.style.display === 'none' ? 'block' : 'none'; }
      function removeField(id) { const el = document.getElementById(id + '_wrapper'); if (el) { el.remove(); updateFieldCount(); } }

      function updateFieldCount() {
        const count = document.querySelectorAll('#fieldCanvas .fb-field').length;
        const h3 = document.querySelector('#fieldCanvas').parentElement.querySelector('h3');
        if (h3) h3.innerHTML = '📝 Form Fields <span style="color:#9ca3af;font-weight:400">(' + count + ')</span>';
      }

      function collectFields() {
        const fields = [];
        document.querySelectorAll('#fieldCanvas .fb-field').forEach((el, idx) => {
          const id = el.querySelector('.field-id')?.value || 'field_' + idx;
          const type = el.querySelector('.field-type')?.value || 'text';
          const label = el.querySelector('.field-label')?.value || 'Untitled';
          const placeholder = el.querySelector('.field-placeholder')?.value || '';
          const helpText = el.querySelector('.field-help')?.value || '';
          const required = el.querySelector('.field-required')?.checked || false;
          const defaultValue = el.querySelector('.field-default')?.value || '';
          const options = el.querySelector('.field-options')?.value || '';
          const min = el.querySelector('.field-min')?.value || '';
          const max = el.querySelector('.field-max')?.value || '';
          const validation = el.querySelector('.field-validation')?.value || '';
          fields.push({ id, type, label, placeholder, helpText, required, default: defaultValue, options, min, max, validation });
        });
        return fields;
      }

      function addCondition() {
        const container = document.getElementById('conditionsContainer');
        const count = container.children.length + 1;
        const id = 'new_' + count;
        const fields = collectFields();
        const fieldOptions = fields.map(f => '<option value="' + f.id + '">' + esc(f.label) + '</option>').join('');
        container.insertAdjacentHTML('beforeend',
          '<div class="fb-condition" id="cond_' + id + '">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<select class="fb-select" style="width:auto;min-width:150px" data-cond-field="' + id + '">' + fieldOptions + '</select>' +
          '<select class="fb-select" style="width:auto;min-width:100px" data-cond-op="' + id + '">' +
          '<option value="equals">equals</option><option value="not equals">not equals</option><option value="contains">contains</option><option value="is empty">is empty</option><option value="is not empty">is not empty</option></select>' +
          '<input class="fb-input" style="width:auto;min-width:120px" placeholder="Value" data-cond-val="' + id + '">' +
          '<select class="fb-select" style="width:auto;min-width:130px" data-cond-action="' + id + '">' +
          '<option value="show">show</option><option value="hide">hide</option><option value="require">require</option><option value="disable">disable</option></select>' +
          '<select class="fb-select" style="width:auto;min-width:150px" data-cond-target="' + id + '">' + fieldOptions + '</select>' +
          '<button class="fb-btn fb-btn-danger fb-btn-sm" onclick="removeCondition(\'' + id + '\')">✕</button></div></div>');
      }

      function removeCondition(id) { const el = document.getElementById('cond_' + id); if (el) el.remove(); }

      async function saveForm() {
        const formId = document.getElementById('formId').value;
        const fields = collectFields();
        const conditions = [];
        document.querySelectorAll('#conditionsContainer .fb-condition').forEach(el => {
          const id = el.id.replace('cond_', '');
          const fieldId = el.querySelector('[data-cond-field]')?.value || '';
          const operator = el.querySelector('[data-cond-op]')?.value || 'equals';
          const value = el.querySelector('[data-cond-val]')?.value || '';
          const action = el.querySelector('[data-cond-action]')?.value || 'show';
          const targetFieldId = el.querySelector('[data-cond-target]')?.value || '';
          conditions.push({ field_id: fieldId, operator, value, action, target_field_id: targetFieldId });
        });

        const body = {
          title: document.getElementById('formTitle').value,
          description: document.getElementById('formDesc').value,
          theme: document.getElementById('formTheme').value,
          submit_button_text: document.getElementById('formBtnText').value,
          success_message: document.getElementById('formSuccessMsg').value,
          notification_email: document.getElementById('formNotifEmail').value,
          allow_file_upload: document.getElementById('formFileUpload').checked,
          require_login: document.getElementById('formRequireLogin').checked,
          limit_submissions: document.getElementById('formLimitSubs').checked,
          max_file_size_mb: document.getElementById('formMaxFileSize').value,
          max_submissions: document.getElementById('formMaxSubs').value,
          fields: fields,
          conditions: conditions
        };

        try {
          const resp = await fetch('/admin/form-builder/' + formId, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          });
          const data = await resp.json();
          if (data.success) { showToast('Form saved successfully!'); } else { showToast('Error: ' + (data.error || 'Unknown')); }
        } catch (e) { showToast('Network error: ' + e.message); }
      }

      function showToast(msg) {
        const t = document.createElement('div'); t.className = 'fb-toast'; t.textContent = msg;
        document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
      }

      document.getElementById('formLimitSubs').addEventListener('change', function() {
        document.getElementById('formMaxSubs').disabled = !this.checked;
      });
    </script>`;
    res.send(renderPage('Edit Form: ' + form.title, html, req.session?.user));
  }));

  function renderFieldCard(f, i) {
    const needsOptions = ['select','radio','checkbox'].includes(f.type);
    return `<div class="fb-field" id="${f.id}_wrapper">
      <div class="fb-field-header"><div style="display:flex;align-items:center;gap:8px">
        <span style="cursor:grab;font-size:16px">⠿</span>
        <span class="fb-field-label">${esc(f.label || 'Untitled')}</span>
        ${fieldTypeBadge(f.type)}
        ${f.required ? '<span style="color:#f87171;font-size:11px;font-weight:600">*Required</span>' : ''}
      </div>
      <div class="fb-field-actions">
        <button onclick="editField('${f.id}')" style="background:rgba(59,130,246,0.15);color:#60a5fa">Edit</button>
        <button onclick="removeField('${f.id}')" style="background:rgba(239,68,68,0.15);color:#f87171">Delete</button>
      </div></div>
      <div id="${f.id}_props" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(107,114,128,0.2)">
        <input type="hidden" value="${f.id}" class="field-id"><input type="hidden" value="${f.type}" class="field-type">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="fb-form-group"><label class="fb-label">Field Label</label><input class="fb-input field-label" value="${esc(f.label || '')}"></div>
          <div class="fb-form-group"><label class="fb-label">Placeholder</label><input class="fb-input field-placeholder" value="${esc(f.placeholder || '')}"></div>
          <div class="fb-form-group"><label class="fb-label">Default Value</label><input class="fb-input field-default" value="${esc(f.default || f.defaultValue || '')}"></div>
          <div class="fb-form-group"><label class="fb-label">Help Text</label><input class="fb-input field-help" value="${esc(f.helpText || f.help_text || '')}"></div>
          ${needsOptions ? `<div class="fb-form-group" style="grid-column:1/-1"><label class="fb-label">Options (comma-separated)</label><input class="fb-input field-options" value="${esc(f.options || '')}"></div>` :
            `<div class="fb-form-group"><label class="fb-label">Min Value</label><input class="fb-input field-min" type="number" value="${esc(f.min || '')}"></div>
             <div class="fb-form-group"><label class="fb-label">Max Value</label><input class="fb-input field-max" type="number" value="${esc(f.max || '')}"></div>`}
          <div class="fb-form-group"><label class="fb-label">Validation Message</label><input class="fb-input field-validation" value="${esc(f.validation || f.validation_message || '')}" placeholder="e.g. This field is required"></div>
        </div>
        <div style="margin-top:8px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" class="field-required" ${f.required ? 'checked' : ''}> Required Field</label></div>
      </div>
    </div>`;
  }

  // ─── 5. PUT /:id - Update form ───
  app.put('/admin/form-builder/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { title, description, theme, submit_button_text, success_message, allow_file_upload, max_file_size_mb, require_login, limit_submissions, max_submissions, notification_email, fields, conditions } = req.body;

    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.json({ success: false, error: 'Form not found' });

    await pool.query(
      `UPDATE custom_forms SET title=$1, description=$2, theme=$3, submit_button_text=$4, success_message=$5,
        allow_file_upload=$6, max_file_size_mb=$7, require_login=$8, limit_submissions=$9, max_submissions=$10,
        notification_email=$11, fields=$12 WHERE id=$13 AND tenant_id=$14`,
      [title, description, theme, submit_button_text, success_message, allow_file_upload,
        parseInt(max_file_size_mb) || 10, require_login, limit_submissions, parseInt(max_submissions) || 0,
        notification_email, JSON.stringify(fields || []), id, tid]
    );

    if (Array.isArray(conditions)) {
      await pool.query(`DELETE FROM form_conditions WHERE form_id=$1`, [id]);
      for (const c of conditions) {
        if (c.field_id && c.action) {
          await pool.query(`INSERT INTO form_conditions (form_id, field_id, operator, value, action, target_field_id) VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, c.field_id, c.operator || 'equals', c.value || '', c.action, c.target_field_id || '']);
        }
      }
    }

    audit(req, 'form_update', { id, title });
    res.json({ success: true, message: 'Form updated' });
  }));

  // ─── 6. DELETE /:id - Delete form ───
  app.delete('/admin/form-builder/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    await pool.query(`DELETE FROM form_conditions WHERE form_id=$1`, [id]);
    await pool.query(`DELETE FROM form_submissions WHERE form_id=$1`, [id]);
    const { rowCount } = await pool.query(`DELETE FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    audit(req, 'form_delete', { id });
    res.json({ success: true, deleted: rowCount > 0 });
  }));

  // ─── 7. POST /:id/duplicate - Duplicate form ───
  app.post('/admin/form-builder/:id/duplicate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.redirect('/admin/form-builder');

    const { rows: [newForm] } = await pool.query(
      `INSERT INTO custom_forms (tenant_id, title, description, fields, theme, submit_button_text, success_message,
        allow_file_upload, max_file_size_mb, require_login, limit_submissions, max_submissions, notification_email, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) RETURNING id`,
      [tid, (form.title || '') + ' (Copy)', form.description, form.fields, form.theme, form.submit_button_text,
        form.success_message, form.allow_file_upload, form.max_file_size_mb, form.require_login,
        form.limit_submissions, form.max_submissions, form.notification_email]
    );

    const { rows: conditions } = await pool.query(`SELECT * FROM form_conditions WHERE form_id=$1`, [id]);
    for (const c of conditions) {
      await pool.query(`INSERT INTO form_conditions (form_id, field_id, operator, value, action, target_field_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [newForm.id, c.field_id, c.operator, c.value, c.action, c.target_field_id]);
    }

    audit(req, 'form_duplicate', { from: id, to: newForm.id });
    res.redirect('/admin/form-builder/edit/' + newForm.id);
  }));

  // ─── 8. POST /:id/publish - Publish/unpublish form ───
  app.post('/admin/form-builder/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.json({ success: false, error: 'Form not found' });

    const shouldPublish = !form.published_at;
    await pool.query(`UPDATE custom_forms SET is_active=$1, published_at=$2 WHERE id=$3 AND tenant_id=$4`,
      [shouldPublish, shouldPublish ? new Date() : null, id, tid]);

    audit(req, shouldPublish ? 'form_publish' : 'form_unpublish', { id });
    res.json({ success: true, published: shouldPublish });
  }));

  // ─── 9. GET /:id/submissions - View submissions ───
  app.get('/admin/form-builder/:id/submissions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { status, search, page = 1 } = req.query;
    const limit = 25;
    const offset = (parseInt(page) - 1) * limit;

    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.status(404).send('<div class="fb-empty"><div class="icon">❌</div><h3>Form not found</h3></div>');

    let where = `WHERE s.form_id=$1 AND s.tenant_id=$2`;
    const params = [id, tid];
    if (status) { where += ` AND s.status=$${params.length + 1}`; params.push(status); }
    if (search) { where += ` AND (s.submitter_name ILIKE $${params.length + 1} OR s.submitter_email ILIKE $${params.length + 1})`; params.push('%' + search + '%'); }

    const { rows: submissions, rowCount: total } = await pool.query(
      `SELECT s.* FROM form_submissions s ${where} ORDER BY s.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);

    const totalPages = Math.ceil(total / limit);
    const pagination = totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">
      ${Array.from({ length: Math.min(totalPages, 10) }, (_, i) => `<a href="?page=${i + 1}${status ? '&status=' + status : ''}${search ? '&search=' + search : ''}" class="fb-btn fb-btn-sm ${parseInt(page) === i + 1 ? 'fb-btn-primary' : 'fb-btn-secondary'}">${i + 1}</a>`).join('')}
    </div>` : '';

    const rows = submissions.map(s => {
      const responses = typeof s.responses === 'object' ? s.responses : (s.responses ? JSON.parse(s.responses) : {});
      const respPreview = Object.entries(responses).slice(0, 3).map(([k, v]) => `<span style="display:inline-block;background:rgba(59,130,246,0.1);padding:2px 8px;border-radius:4px;font-size:11px;margin:2px;color:#60a5fa">${esc(k)}: ${esc(String(v).substring(0, 30))}</span>`).join('');
      return `<tr>
        <td style="font-weight:600;color:#e5e7eb">#${s.id}</td>
        <td>${esc(s.submitter_name || 'Anonymous')}</td>
        <td style="color:#9ca3af">${esc(s.submitter_email || '—')}</td>
        <td>${statusBadge(s.status)}</td>
        <td style="max-width:300px">${respPreview}</td>
        <td style="font-size:12px;color:#9ca3af">${fmtDateTime(s.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="fb-btn fb-btn-secondary fb-btn-sm" onclick="viewSubmission(${s.id})">View</button>
          <button class="fb-btn fb-btn-success fb-btn-sm" onclick="reviewSubmission(${s.id})">Review</button>
        </td>
      </tr>`;
    }).join('');

    const html = `${CSS}<div class="fb-wrap">
      ${nav('dash')}
      <a href="/admin/form-builder" style="color:#9ca3af;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="fb-header"><div><h1>Submissions: ${esc(form.title)}</h1><p class="sub">${total} submissions</p></div>
        <div style="display:flex;gap:8px">
          <a href="/admin/form-builder/${id}/submissions/export" class="fb-btn fb-btn-success">📥 Export CSV</a>
          <a href="/admin/form-builder/${id}/analytics" class="fb-btn fb-btn-secondary">📈 Analytics</a>
          <a href="/admin/form-builder/edit/${id}" class="fb-btn fb-btn-secondary">Edit Form</a>
        </div>
      </div>
      <div class="fb-filter">
        <div><label>Status</label><select class="fb-select" style="width:auto" onchange="location.href='?status='+this.value">
          <option value="">All Status</option><option value="new" ${status === 'new' ? 'selected' : ''}>New</option>
          <option value="reviewed" ${status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
          <option value="flagged" ${status === 'flagged' ? 'selected' : ''}>Flagged</option>
          <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select></div>
        <form method="get" style="display:flex;gap:8px"><div><label>Search</label><input class="fb-input" name="search" value="${esc(search || '')}" placeholder="Name or email..."></div>
          <button type="submit" class="fb-btn fb-btn-primary fb-btn-sm" style="margin-top:18px">Search</button></form>
      </div>
      <div class="fb-card">
        <div style="overflow-x:auto"><table class="fb-table">
          <thead><tr><th>ID</th><th>Submitter</th><th>Email</th><th>Status</th><th>Preview</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:30px;color:#9ca3af">No submissions yet</td></tr>'}</tbody>
        </table></div>
        ${pagination}
      </div>
      <div id="submissionModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:none;align-items:center;justify-content:center">
        <div style="background:#1e2330;border:1px solid rgba(107,114,128,0.3);border-radius:16px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;color:#f3f4f6" id="modalTitle">Submission Details</h3>
            <button onclick="closeModal()" style="background:none;border:none;color:#9ca3af;font-size:20px;cursor:pointer">✕</button>
          </div>
          <div id="modalContent"></div>
        </div>
      </div>
    </div>
    <script>
      async function viewSubmission(id) {
        const resp = await fetch('/admin/form-builder/submissions/' + id);
        const data = await resp.json();
        if (!data.success) return;
        const s = data.submission;
        const r = typeof s.responses === 'object' ? s.responses : {};
        let html = '<div style="display:grid;gap:12px">';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
        html += '<div><span style="color:#9ca3af;font-size:12px">Submitter:</span><div style="color:#e5e7eb;font-weight:600">' + (s.submitter_name || 'Anonymous') + '</div></div>';
        html += '<div><span style="color:#9ca3af;font-size:12px">Email:</span><div style="color:#e5e7eb">' + (s.submitter_email || '—') + '</div></div>';
        html += '<div><span style="color:#9ca3af;font-size:12px">Status:</span><div>' + '${statusBadge(s.status)}' + '</div></div>';
        html += '<div><span style="color:#9ca3af;font-size:12px">Submitted:</span><div style="color:#e5e7eb">' + (s.created_at || '—') + '</div></div>';
        if (s.ip_address) html += '<div><span style="color:#9ca3af;font-size:12px">IP:</span><div style="color:#e5e7eb">' + s.ip_address + '</div></div>';
        html += '</div><hr style="border-color:rgba(107,114,128,0.2);margin:8px 0"><div style="font-weight:600;color:#f3f4f6;margin-bottom:8px">Responses:</div>';
        for (const [key, val] of Object.entries(r)) {
          html += '<div style="background:#161b26;border-radius:8px;padding:10px"><span style="color:#9ca3af;font-size:12px">' + key + '</span><div style="color:#e5e7eb;margin-top:4px">' + val + '</div></div>';
        }
        if (s.notes) html += '<div style="background:rgba(59,130,246,0.1);border-radius:8px;padding:10px"><span style="color:#60a5fa;font-size:12px">Review Notes:</span><div style="color:#e5e7eb;margin-top:4px">' + s.notes + '</div></div>';
        html += '</div>';
        document.getElementById('modalTitle').textContent = 'Submission #' + id;
        document.getElementById('modalContent').innerHTML = html;
        document.getElementById('submissionModal').style.display = 'flex';
      }

      function reviewSubmission(id) {
        const newStatus = prompt('Enter new status (new, reviewed, flagged, rejected):');
        if (!newStatus) return;
        const notes = prompt('Review notes (optional):') || '';
        fetch('/admin/form-builder/submissions/' + id + '/review', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus, notes }) })
          .then(r => r.json()).then(d => { if (d.success) location.reload(); else alert(d.error || 'Error'); });
      }

      function closeModal() { document.getElementById('submissionModal').style.display = 'none'; }
      document.getElementById('submissionModal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
    </script>`;
    res.send(renderPage('Submissions: ' + form.title, html, req.session?.user));
  }));

  // ─── 10. GET /:id/submissions/export - Export submissions CSV ───
  app.get('/admin/form-builder/:id/submissions/export', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.redirect('/admin/form-builder');

    const { rows: submissions } = await pool.query(`SELECT * FROM form_submissions WHERE form_id=$1 AND tenant_id=$2 ORDER BY created_at`, [id, tid]);
    const allKeys = new Set();
    submissions.forEach(s => {
      const r = typeof s.responses === 'object' ? s.responses : (s.responses ? JSON.parse(s.responses) : {});
      Object.keys(r).forEach(k => allKeys.add(k));
    });
    const headers = ['ID', 'Submitter', 'Email', 'Status', 'Submitted', 'IP', ...allKeys];
    const csvRows = [headers.map(h => `"${h}"`).join(',')];
    for (const s of submissions) {
      const r = typeof s.responses === 'object' ? s.responses : (s.responses ? JSON.parse(s.responses) : {});
      const row = [s.id, (s.submitter_name || '').replace(/"/g, '""'), (s.submitter_email || '').replace(/"/g, '""'),
        s.status || 'new', fmtDateTime(s.created_at), s.ip_address || ''];
      for (const k of allKeys) { row.push(String(r[k] || '').replace(/"/g, '""')); }
      csvRows.push(row.map(c => `"${c}"`).join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${slugify(form.title)}_submissions.csv"`);
    res.send(csvRows.join('\n'));
  }));

  // ─── 11. GET /:id/analytics - Submission analytics ───
  app.get('/admin/form-builder/:id/analytics', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { id } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!form) return res.status(404).send('<div class="fb-empty"><div class="icon">❌</div><h3>Form not found</h3></div>');

    const total = (await pool.query(`SELECT COUNT(*)::int FROM form_submissions WHERE form_id=$1`, [id])).rows[0].count;
    const newCount = (await pool.query(`SELECT COUNT(*)::int FROM form_submissions WHERE form_id=$1 AND status='new'`, [id])).rows[0].count;
    const reviewedCount = (await pool.query(`SELECT COUNT(*)::int FROM form_submissions WHERE form_id=$1 AND status='reviewed'`, [id])).rows[0].count;
    const flaggedCount = (await pool.query(`SELECT COUNT(*)::int FROM form_submissions WHERE form_id=$1 AND status='flagged'`, [id])).rows[0].count;

    const dailyStats = (await pool.query(`
      SELECT DATE(created_at) as day, COUNT(*)::int as count
      FROM form_submissions WHERE form_id=$1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY day`, [id])).rows;

    const maxDaily = Math.max(...dailyStats.map(d => d.count), 1);
    const chartBars = dailyStats.slice(-14).map(d => {
      const h = Math.max(4, (d.count / maxDaily) * 100);
      return `<div class="fb-chart-bar-item" style="height:${h}%" title="${d.day}: ${d.count}"><span>${new Date(d.day).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span></div>`;
    }).join('');

    // Field completion stats
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const { rows: submissions } = await pool.query(`SELECT responses FROM form_submissions WHERE form_id=$1`, [id]);
    let fieldCompletionHtml = '';
    for (const f of fields) {
      if (f.type === 'section' || f.type === 'divider' || f.type === 'html') continue;
      let filled = 0;
      submissions.forEach(s => {
        const r = typeof s.responses === 'object' ? s.responses : (s.responses ? JSON.parse(s.responses) : {});
        if (r[f.label] && String(r[f.label]).trim()) filled++;
      });
      const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
      fieldCompletionHtml += `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:#d1d5db">${esc(f.label)}</span><span style="color:#9ca3af">${filled}/${total} (${pct}%)</span>
        </div>
        <div class="fb-progress"><div class="fb-progress-fill" style="width:${pct}%;background:${pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171'}"></div></div>
      </div>`;
    }

    const html = `${CSS}<div class="fb-wrap">
      ${nav('dash')}
      <a href="/admin/form-builder/${id}/submissions" style="color:#9ca3af;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Submissions</a>
      <div class="fb-header"><div><h1>Analytics: ${esc(form.title)}</h1><p class="sub">Track submission trends and field completion</p></div>
        <div style="display:flex;gap:8px">
          <a href="/admin/form-builder/${id}/submissions/export" class="fb-btn fb-btn-success">📥 Export CSV</a>
          <a href="/admin/form-builder/edit/${id}" class="fb-btn fb-btn-secondary">Edit Form</a>
        </div>
      </div>
      <div class="fb-stats">
        <div class="fb-stat"><div class="fb-stat-num">${total}</div><div class="fb-stat-label">Total Submissions</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#60a5fa">${newCount}</div><div class="fb-stat-label">New</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#34d399">${reviewedCount}</div><div class="fb-stat-label">Reviewed</div></div>
        <div class="fb-stat"><div class="fb-stat-num" style="color:#f87171">${flaggedCount}</div><div class="fb-stat-label">Flagged</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="fb-grid">
        <div class="fb-card">
          <h3>📈 Submissions (Last 14 Days)</h3>
          <div style="height:150px;margin-bottom:24px">${chartBars || '<div style="color:#9ca3af;text-align:center;padding:40px">No data</div>'}</div>
        </div>
        <div class="fb-card">
          <h3>📊 Field Completion Rate</h3>
          ${fieldCompletionHtml || '<div style="color:#9ca3af;text-align:center;padding:40px">No submissions to analyze</div>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Analytics: ' + form.title, html, req.session?.user));
  }));

  // ─── 12. POST /preview - Preview form ───
  app.post('/admin/form-builder/preview', requireAuth, ah(async (req, res) => {
    const { title, description, fields, submit_button_text, theme } = req.body;
    const parsedFields = typeof fields === 'string' ? JSON.parse(fields) : (fields || []);
    const html = `${CSS}<div class="fb-public-form">
      <div class="fb-public-card">
        <h1>${esc(title || 'Preview Form')}</h1>
        <p class="desc">${esc(description || '')}</p>
        <div id="previewFields">${parsedFields.map(f => renderPublicField(f)).join('')}</div>
        <div style="margin-top:20px;padding:12px;background:rgba(245,158,11,0.1);border-radius:10px;text-align:center;color:#fbbf24;font-size:13px;font-weight:600">⚠️ This is a preview only. Submissions will not be saved.</div>
      </div>
    </div>`;
    res.send(renderPage('Preview: ' + (title || 'Form'), html, req.session?.user));
  }));

  function renderPublicField(f) {
    if (f.type === 'section') return `<div style="font-size:18px;font-weight:700;color:#f3f4f6;margin:20px 0 12px;padding-bottom:8px;border-bottom:2px solid rgba(59,130,246,0.3)">${esc(f.label || '')}</div>`;
    if (f.type === 'divider') return '<hr style="border:none;border-top:1px solid rgba(107,114,128,0.2);margin:20px 0">';
    if (f.type === 'html') return `<div style="margin:16px 0;color:#d1d5db">${f.label || ''}</div>`;

    const reqMark = f.required ? ' <span style="color:#f87171">*</span>' : '';
    const helpHtml = f.helpText ? `<div style="font-size:11px;color:#6b7280;margin-top:3px">${esc(f.helpText)}</div>` : '';
    let input = '';

    switch (f.type) {
      case 'text': input = `<input class="fb-input" type="text" placeholder="${esc(f.placeholder || '')}" disabled>`; break;
      case 'textarea': input = `<textarea class="fb-textarea" rows="4" placeholder="${esc(f.placeholder || '')}" disabled></textarea>`; break;
      case 'number': input = `<input class="fb-input" type="number" placeholder="${esc(f.placeholder || '')}" ${f.min ? 'min="' + f.min + '"' : ''} ${f.max ? 'max="' + f.max + '"' : ''} disabled>`; break;
      case 'email': input = `<input class="fb-input" type="email" placeholder="${esc(f.placeholder || 'email@example.com')}" disabled>`; break;
      case 'phone': input = `<input class="fb-input" type="tel" placeholder="${esc(f.placeholder || '+1 (555) 000-0000')}" disabled>`; break;
      case 'date': input = `<input class="fb-input" type="date" disabled>`; break;
      case 'time': input = `<input class="fb-input" type="time" disabled>`; break;
      case 'url': input = `<input class="fb-input" type="url" placeholder="${esc(f.placeholder || 'https://')}" disabled>`; break;
      case 'file': input = `<div style="border:2px dashed rgba(107,114,128,0.3);border-radius:10px;padding:20px;text-align:center;color:#9ca3af">📎 Click to upload file${f.helpText ? ' (' + esc(f.helpText) + ')' : ''}</div>`; break;
      case 'rating': input = `<div style="display:flex;gap:4px">${'⭐'.repeat(5).split('').map((_, i) => `<span style="font-size:24px;cursor:pointer;opacity:0.3">★</span>`).join('')}</div>`; break;
      case 'range': input = `<input type="range" min="${f.min || 0}" max="${f.max || 100}" value="${f.default || 50}" style="width:100%" disabled><div style="display:flex;justify-content:space-between;font-size:11px;color:#9ca3af"><span>${f.min || 0}</span><span>${f.max || 100}</span></div>`; break;
      case 'select': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<select class="fb-select" disabled><option value="">Select...</option>${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
        break;
      }
      case 'radio': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<div style="display:flex;flex-direction:column;gap:6px">${opts.map(o => `<label style="display:flex;align-items:center;gap:8px;color:#d1d5db;cursor:pointer;font-size:14px"><input type="radio" name="preview_${f.id}" disabled> ${esc(o)}</label>`).join('')}</div>`;
        break;
      }
      case 'checkbox': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<div style="display:flex;flex-direction:column;gap:6px">${opts.map(o => `<label style="display:flex;align-items:center;gap:8px;color:#d1d5db;cursor:pointer;font-size:14px"><input type="checkbox" disabled> ${esc(o)}</label>`).join('')}</div>`;
        break;
      }
      default: input = `<input class="fb-input" type="text" placeholder="${esc(f.placeholder || '')}" disabled>`;
    }

    return `<div style="margin-bottom:18px"><label style="display:block;font-size:13px;font-weight:600;color:#d1d5db;margin-bottom:6px">${esc(f.label || 'Untitled')}${reqMark}</label>${input}${helpHtml}</div>`;
  }

  // ─── 13. GET /public/:slug - Public form view (no auth) ───
  app.get('/admin/form-builder/public/:slug', ah(async (req, res) => {
    const { slug } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1`, [slug]);
    if (!form || !form.is_active || !form.published_at) return res.status(404).send('<div style="text-align:center;padding:60px;color:#9ca3af"><h2 style="font-size:24px">Form not found or unavailable</h2></div>');

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const fieldInputs = fields.map(f => renderActivePublicField(f)).join('');
    const { rows: [condRows] } = await pool.query(`SELECT * FROM form_conditions WHERE form_id=$1`, [form.id]);

    const html = `${CSS}<div class="fb-public-form">
      <div class="fb-public-card">
        <h1>${esc(form.title)}</h1>
        <p class="desc">${esc(form.description || '')}</p>
        <form method="POST" action="/admin/form-builder/public/${slug}/submit" id="publicForm">
          ${fieldInputs}
          <button type="submit" class="fb-public-submit" style="margin-top:20px">${esc(form.submit_button_text || 'Submit')}</button>
        </form>
      </div>
      <p style="text-align:center;font-size:11px;color:#6b7280;margin-top:16px">Powered by Advanced Form Builder</p>
    </div>`;
    res.send(renderPage(form.title, html, null));
  }));

  function renderActivePublicField(f) {
    if (f.type === 'section') return `<div style="font-size:18px;font-weight:700;color:#f3f4f6;margin:20px 0 12px;padding-bottom:8px;border-bottom:2px solid rgba(59,130,246,0.3)">${esc(f.label || '')}</div>`;
    if (f.type === 'divider') return '<hr style="border:none;border-top:1px solid rgba(107,114,128,0.2);margin:20px 0">';
    if (f.type === 'html') return `<div style="margin:16px 0;color:#d1d5db">${f.label || ''}</div>`;

    const reqMark = f.required ? ' <span style="color:#f87171">*</span>' : '';
    const helpHtml = f.helpText ? `<div style="font-size:11px;color:#6b7280;margin-top:3px">${esc(f.helpText)}</div>` : '';
    let input = '';

    switch (f.type) {
      case 'text': input = `<input class="fb-input" type="text" name="response_${f.id}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'textarea': input = `<textarea class="fb-textarea" rows="4" name="response_${f.id}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>${esc(f.default || '')}</textarea>`; break;
      case 'number': input = `<input class="fb-input" type="number" name="response_${f.id}" placeholder="${esc(f.placeholder || '')}" ${f.min ? 'min="' + f.min + '"' : ''} ${f.max ? 'max="' + f.max + '"' : ''} ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'email': input = `<input class="fb-input" type="email" name="response_${f.id}" placeholder="${esc(f.placeholder || 'email@example.com')}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'phone': input = `<input class="fb-input" type="tel" name="response_${f.id}" placeholder="${esc(f.placeholder || '+1 (555) 000-0000')}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'date': input = `<input class="fb-input" type="date" name="response_${f.id}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'time': input = `<input class="fb-input" type="time" name="response_${f.id}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'url': input = `<input class="fb-input" type="url" name="response_${f.id}" placeholder="${esc(f.placeholder || 'https://')}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`; break;
      case 'file': input = `<input type="file" name="file_${f.id}" ${f.required ? 'required' : ''} style="width:100%;color:#d1d5db">`; break;
      case 'rating': input = `<div style="display:flex;gap:4px" id="rating_${f.id}">${[1,2,3,4,5].map(n => `<span style="font-size:28px;cursor:pointer;opacity:0.3;transition:opacity .15s" onclick="setRating('${f.id}',${n})" data-rating="${n}">★</span>`).join('')}</div><input type="hidden" name="response_${f.id}" id="rating_val_${f.id}" value="">`; break;
      case 'range': input = `<input type="range" name="response_${f.id}" min="${f.min || 0}" max="${f.max || 100}" value="${f.default || 50}" style="width:100%" oninput="this.nextElementSibling.textContent=this.value"><span style="color:#60a5fa;font-weight:600">${f.default || 50}</span>`; break;
      case 'select': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<select class="fb-select" name="response_${f.id}" ${f.required ? 'required' : ''}><option value="">Select...</option>${opts.map(o => `<option value="${esc(o)}" ${f.default === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        break;
      }
      case 'radio': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<div style="display:flex;flex-direction:column;gap:6px">${opts.map(o => `<label style="display:flex;align-items:center;gap:8px;color:#d1d5db;cursor:pointer;font-size:14px"><input type="radio" name="response_${f.id}" value="${esc(o)}" ${f.required ? 'required' : ''}> ${esc(o)}</label>`).join('')}</div>`;
        break;
      }
      case 'checkbox': {
        const opts = (f.options || '').split(',').map(o => o.trim()).filter(Boolean);
        input = `<div style="display:flex;flex-direction:column;gap:6px">${opts.map(o => `<label style="display:flex;align-items:center;gap:8px;color:#d1d5db;cursor:pointer;font-size:14px"><input type="checkbox" name="response_${f.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>`;
        break;
      }
      default: input = `<input class="fb-input" type="text" name="response_${f.id}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} value="${esc(f.default || '')}">`;
    }
    return `<div style="margin-bottom:18px" data-field-id="${f.id}"><label style="display:block;font-size:13px;font-weight:600;color:#d1d5db;margin-bottom:6px">${esc(f.label || 'Untitled')}${reqMark}</label>${input}${helpHtml}</div>`;
  }

  // ─── 14. POST /public/:slug/submit - Public form submission ───
  app.post('/admin/form-builder/public/:slug', ah(async (req, res) => {
    const { slug } = req.params;
    const { rows: [form] } = await pool.query(`SELECT * FROM custom_forms WHERE id=$1`, [slug]);
    if (!form || !form.is_active || !form.published_at) return res.status(404).json({ success: false, error: 'Form not found' });

    // Check submission limits
    if (form.limit_submissions && form.max_submissions > 0) {
      const { rows: [cnt] } = await pool.query(`SELECT COUNT(*)::int FROM form_submissions WHERE form_id=$1`, [form.id]);
      if (cnt.count >= form.max_submissions) return res.status(400).json({ success: false, error: 'Submission limit reached' });
    }

    const fields = Array.isArray(form.fields) ? form.fields : [];
    const responses = {};
    for (const f of fields) {
      if (f.type === 'section' || f.type === 'divider' || f.type === 'html') continue;
      const val = req.body['response_' + f.id];
      if (f.type === 'checkbox' && Array.isArray(val)) {
        responses[f.label || f.id] = val.join(', ');
      } else if (val !== undefined && val !== null) {
        responses[f.label || f.id] = String(val);
      }
    }

    const submitterName = req.body.submitter_name || (req.session?.user?.name || '');
    const submitterEmail = req.body.submitter_email || (req.session?.user?.email || '');

    await pool.query(
      `INSERT INTO form_submissions (form_id, tenant_id, submitter_id, submitter_name, submitter_email, responses, ip_address, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [form.id, form.tenant_id, req.session?.user?.id || null, submitterName, submitterEmail,
        JSON.stringify(responses), req.ip || req.connection?.remoteAddress || '', req.headers['user-agent'] || '']
    );

    const msg = form.success_message || 'Thank you for your submission!';
    const html = `${CSS}<div class="fb-public-form">
      <div class="fb-public-card" style="text-align:center;padding:60px 32px">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h1 style="margin-bottom:8px">Submission Received!</h1>
        <p style="color:#9ca3af;font-size:15px">${esc(msg)}</p>
      </div>
    </div>`;
    res.send(renderPage('Success', html, null));
  }));

  // ─── 15. GET /templates - Form templates ───
  app.get('/admin/form-builder/templates', requireAuth, ah(async (req, res) => {
    const cardsHtml = TEMPLATES.map(t => {
      const fieldSummary = t.fields.map(f => `<span style="display:inline-block;background:rgba(59,130,246,0.1);padding:2px 8px;border-radius:4px;font-size:10px;margin:2px;color:#60a5fa">${f.type}</span>`).join('');
      const fieldCount = t.fields.length;
      return `<div class="fb-template-card" style="text-align:left;padding:20px">
        <div style="text-align:center;margin-bottom:12px"><div class="fb-template-icon">${t.icon}</div>
        <div class="fb-template-name">${t.name}</div>
        <div class="fb-template-desc">${t.desc}</div></div>
        <div style="margin-bottom:12px">${fieldSummary}</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <form method="POST" action="/admin/form-builder/templates/use" style="display:inline">
            <input type="hidden" name="template_id" value="${t.id}">
            <button type="submit" class="fb-btn fb-btn-primary fb-btn-sm">Use Template</button>
          </form>
        </div>
      </div>`;
    }).join('');

    const html = `${CSS}<div class="fb-wrap">
      ${nav('templates')}
      <div class="fb-header"><div><h1>Form Templates</h1><p class="sub">Start with a pre-built template and customize it to your needs</p></div>
        <a href="/admin/form-builder/create" class="fb-btn fb-btn-primary">➕ Blank Form</a>
      </div>
      <div class="fb-grid fb-grid-3">${cardsHtml}</div>
    </div>`;
    res.send(renderPage('Form Templates', html, req.session?.user));
  }));

  // Use template handler
  app.post('/admin/form-builder/templates/use', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { template_id } = req.body;
    const tmpl = TEMPLATES.find(t => t.id === template_id);
    if (!tmpl) return res.redirect('/admin/form-builder/templates');

    const { rows } = await pool.query(
      `INSERT INTO custom_forms (tenant_id, title, description, fields, theme, submit_button_text, is_active)
      VALUES ($1,$2,$3,$4,'dark','Submit',false) RETURNING id`,
      [tid, tmpl.name, tmpl.desc, JSON.stringify(tmpl.fields)]
    );
    audit(req, 'form_from_template', { template_id: tmpl.id, form_id: rows[0].id });
    res.redirect('/admin/form-builder/edit/' + rows[0].id);
  }));

  // ─── 16. PUT /submissions/:id/review - Review submission ───
  app.put('/admin/form-builder/submissions/:id/review', requireAuth, ah(async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;
    const validStatuses = ['new', 'reviewed', 'flagged', 'rejected'];
    const newStatus = validStatuses.includes(status) ? status : 'reviewed';

    const { rowCount } = await pool.query(
      `UPDATE form_submissions SET status=$1, notes=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4`,
      [newStatus, notes || '', req.session?.user?.id || null, id]
    );

    audit(req, 'submission_review', { id, status: newStatus });
    res.json({ success: true, updated: rowCount > 0 });
  }));

  // GET single submission (for modal)
  app.get('/admin/form-builder/submissions/:id', requireAuth, ah(async (req, res) => {
    const { id } = req.params;
    const { rows: [sub] } = await pool.query(`SELECT * FROM form_submissions WHERE id=$1`, [id]);
    if (!sub) return res.json({ success: false, error: 'Submission not found' });
    res.json({ success: true, submission: sub });
  }));

  // ─── 17. GET /fields/types - Available field types reference ───
  app.get('/admin/form-builder/fields/types', requireAuth, ah(async (req, res) => {
    const categoryLabels = { basic: 'Basic Fields', choice: 'Choice Fields', advanced: 'Advanced Fields', layout: 'Layout Elements' };
    const categoryDescs = {
      basic: 'Standard input fields for collecting various types of text and numeric data.',
      choice: 'Fields that allow users to select from predefined options.',
      advanced: 'Specialized fields for file uploads, ratings, and sliders.',
      layout: 'Non-input elements used to organize and structure your form.'
    };
    const categoryColors = {
      basic: { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', color: '#60a5fa' },
      choice: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', color: '#34d399' },
      advanced: { bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)', color: '#a78bfa' },
      layout: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.3)', color: '#9ca3af' }
    };

    const categories = {};
    FIELD_TYPES.forEach(ft => {
      if (!categories[ft.category]) categories[ft.category] = [];
      categories[ft.category].push(ft);
    });

    const categoryHtml = Object.entries(categories).map(([cat, types]) => {
      const cc = categoryColors[cat] || categoryColors.basic;
      const fieldsHtml = types.map(ft => `<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(22,27,38,0.5);border-radius:10px;border:1px solid rgba(107,114,128,0.15)">
        <div style="font-size:28px;flex-shrink:0">${ft.icon}</div>
        <div style="flex:1">
          <div style="font-weight:700;color:#f3f4f6;font-size:14px">${ft.label}</div>
          <div style="font-size:11px;color:#9ca3af;font-family:monospace;background:rgba(59,130,246,0.1);display:inline-block;padding:1px 6px;border-radius:4px;margin-top:3px">${ft.value}</div>
        </div>
        <div style="font-size:12px;color:#6b7280;max-width:200px">${getFieldTypeDescription(ft.value)}</div>
      </div>`).join('');

      return `<div class="fb-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:12px 16px;border-radius:10px;background:${cc.bg};border:1px solid ${cc.border}">
          <span style="font-weight:700;color:${cc.color};font-size:16px">${categoryLabels[cat] || cat}</span>
        </div>
        <p style="font-size:13px;color:#9ca3af;margin:-8px 0 16px">${categoryDescs[cat] || ''}</p>
        <div style="display:flex;flex-direction:column;gap:8px">${fieldsHtml}</div>
      </div>`;
    }).join('');

    const html = `${CSS}<div class="fb-wrap">
      ${nav('fields')}
      <div class="fb-header"><div><h1>Field Types Reference</h1><p class="sub">All available field types for building your forms</p></div>
        <a href="/admin/form-builder/create" class="fb-btn fb-btn-primary">➕ Create Form</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(500px,1fr));gap:16px">${categoryHtml}</div>
      <div class="fb-card" style="margin-top:16px">
        <h3>💡 Tips for Building Great Forms</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:12px">
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#60a5fa;font-weight:600;margin-bottom:4px">Keep it concise</div><div style="font-size:13px;color:#9ca3af">Only ask for information you truly need. Shorter forms get higher completion rates.</div></div>
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#34d399;font-weight:600;margin-bottom:4px">Use sections</div><div style="font-size:13px;color:#9ca3af">Group related fields with section headers to make long forms more scannable.</div></div>
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#fbbf24;font-weight:600;margin-bottom:4px">Add help text</div><div style="font-size:13px;color:#9ca3af">Clarify what you're asking with helpful descriptions and placeholder examples.</div></div>
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#a78bfa;font-weight:600;margin-bottom:4px">Use conditional logic</div><div style="font-size:13px;color:#9ca3af">Show/hide fields based on responses to create dynamic, personalized form experiences.</div></div>
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#f87171;font-weight:600;margin-bottom:4px">Test before publishing</div><div style="font-size:13px;color:#9ca3af">Always preview your form and submit a test entry before making it public.</div></div>
          <div style="padding:12px;background:rgba(22,27,38,0.5);border-radius:10px"><div style="color:#60a5fa;font-weight:600;margin-bottom:4px">Set validation</div><div style="font-size:13px;color:#9ca3af">Use min/max values, required fields, and validation messages to ensure data quality.</div></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Field Types Reference', html, req.session?.user));
  }));

  function getFieldTypeDescription(type) {
    const descriptions = {
      text: 'Single-line text input for names, titles, and short answers.',
      textarea: 'Multi-line text area for longer responses, essays, and comments.',
      number: 'Numeric input with optional min/max validation for quantities and measurements.',
      email: 'Email input with built-in format validation.',
      phone: 'Phone number input with tel keyboard on mobile devices.',
      date: 'Date picker with calendar dropdown.',
      time: 'Time picker for scheduling and time-based inputs.',
      url: 'URL input with format validation for website links.',
      select: 'Dropdown menu for selecting one option from a list.',
      radio: 'Radio button group for selecting exactly one option.',
      checkbox: 'Checkbox group for selecting multiple options.',
      file: 'File upload input supporting various document and image formats.',
      rating: 'Star rating component (1-5) for satisfaction and quality feedback.',
      range: 'Slider input for selecting a value within a defined range.',
      section: 'Visual section header to organize form into logical groups.',
      divider: 'Horizontal line separator for visual spacing.',
      html: 'Custom HTML block for embedding rich content and instructions.'
    };
    return descriptions[type] || 'A versatile form field.';
  }

  // ─── Create form page ───
  app.get('/admin/form-builder/create', requireAuth, ah(async (req, res) => {
    const html = `${CSS}<div class="fb-wrap">
      ${nav('create')}
      <a href="/admin/form-builder" style="color:#9ca3af;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="fb-header"><div><h1>Create New Form</h1><p class="sub">Set up the basics, then add fields in the editor</p></div></div>
      <div class="fb-card" style="max-width:700px">
        <form method="POST" action="/admin/form-builder/create">
          <div class="fb-form-group"><label class="fb-label">Form Title *</label>
            <input class="fb-input" name="title" required placeholder="e.g. Student Registration Form"></div>
          <div class="fb-form-group"><label class="fb-label">Description</label>
            <textarea class="fb-textarea" name="description" rows="3" placeholder="Describe what this form is for..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="fb-form-group"><label class="fb-label">Theme</label>
              <select class="fb-select" name="theme"><option value="light">Light</option><option value="dark">Dark</option><option value="blue">Blue Accent</option><option value="minimal">Minimal</option></select></div>
            <div class="fb-form-group"><label class="fb-label">Submit Button Text</label>
              <input class="fb-input" name="submit_button_text" value="Submit"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="fb-form-group"><label class="fb-label">Success Message</label>
              <input class="fb-input" name="success_message" placeholder="Thank you for your submission!"></div>
            <div class="fb-form-group"><label class="fb-label">Notification Email</label>
              <input class="fb-input" name="notification_email" placeholder="alerts@school.com"></div>
          </div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" name="allow_file_upload"> Allow File Upload</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" name="require_login"> Require Login</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#d1d5db;cursor:pointer"><input type="checkbox" name="limit_submissions"> Limit Submissions</label>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div class="fb-form-group"><label class="fb-label">Max File Size (MB)</label><input class="fb-input" type="number" name="max_file_size_mb" value="10"></div>
            <div class="fb-form-group"><label class="fb-label">Max Submissions</label><input class="fb-input" type="number" name="max_submissions" value="0"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:20px">
            <button type="submit" class="fb-btn fb-btn-primary" style="padding:12px 28px">Create & Edit Fields</button>
            <a href="/admin/form-builder" class="fb-btn fb-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Form', html, req.session?.user));
  }));

  // ─── JSON API: Get single submission (used by modal) ───
  app.get('/admin/form-builder/submissions/:id', requireAuth, ah(async (req, res) => {
    const { rows: [sub] } = await pool.query(`SELECT * FROM form_submissions WHERE id=$1`, [req.params.id]);
    if (!sub) return res.json({ success: false, error: 'Not found' });
    res.json({ success: true, submission: sub });
  }));

  console.log('[FormBuilderAdvanced] Module loaded with 17 routes under /admin/form-builder');
};
