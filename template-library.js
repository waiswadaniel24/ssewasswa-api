// ============================================================
// TEMPLATE LIBRARY MODULE — SSEWASSWA Comfort Platform
// Multi-tenant template management with categories, variables,
// live preview, versioning, usage tracking, and JSON API.
// ============================================================
// Usage in server.js:
//   const templateLibrary = require('./template-library');
//   templateLibrary(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function extractVariables(text) {
  if (!text) return [];
  const matches = text.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

function renderTemplate(body, vars) {
  let rendered = body || '';
  for (const [key, val] of Object.entries(vars || {})) {
    rendered = rendered.split('{' + key + '}').join(val || '');
  }
  return rendered;
}

function sampleDataForVariable(varName) {
  const samples = {
    name: 'John Mukasa', organization: 'SSEWASSWA Academy', invoice_number: 'INV-2025-0042',
    amount: 'UGX 1,500,000', date: '15 Jan 2025', due_date: '15 Feb 2025',
    account: 'ACC-1001', meeting_title: 'Q1 Strategy Review', time: '10:00 AM',
    location: 'Conference Room A', title: 'Annual Performance Report',
    period: 'January – December 2024', school_name: 'SSEWASSWA Primary School',
    term: 'Term 1, 2025', events: 'Sports Day, Science Fair, Parent-Teacher Conference',
    church_name: 'SSEWASSWA Community Church', sermon_title: 'Walking in Faith',
    announcements: 'Youth Camp registration open, Bible Study every Wednesday',
    patient_name: 'Grace Nakamya', doctor_name: 'Dr. Samuel Okello',
    start_date: '01 February 2025', employee_name: 'Peter Ochieng',
    position: 'Senior Developer', department: 'IT & Systems',
    system_name: 'SSEWASSWA Comfort Platform', scheduled_date: '20 January 2025',
    duration: '2 hours', email: 'admin@ssewasswa.org', phone: '+256 700 123 456'
  };
  return samples[varName] || varName;
}

const TYPE_BADGES = {
  document: { label: 'Document', bg: '#dbeafe', color: '#1e40af' },
  email:    { label: 'Email',    bg: '#dcfce7', color: '#16a34a' },
  report:   { label: 'Report',   bg: '#ede9fe', color: '#7c3aed' },
  letter:   { label: 'Letter',   bg: '#ffedd5', color: '#ea580c' },
  certificate: { label: 'Certificate', bg: '#fef9c3', color: '#a16207' }
};

const CATEGORIES = ['general', 'finance', 'communication', 'reporting', 'education', 'church', 'clinic', 'hr'];

function typeBadge(type) {
  const t = TYPE_BADGES[type] || TYPE_BADGES.document;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${t.bg};color:${t.color}">${t.label}</span>`;
}

function variableTags(variables) {
  if (!variables || !variables.length) return '<span class="muted" style="font-size:12px">No variables</span>';
  return variables.map(v =>
    `<span style="display:inline-block;padding:2px 10px;border-radius:14px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;margin:2px">{${v}}</span>`
  ).join('');
}

// ============================================================
// SHARED CSS
// ============================================================
const TL_CSS = `<style>
.tl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:22px}
.tl-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;transition:.15s}
.tl-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}
.tl-stat-val{font-size:28px;font-weight:800;color:#1e293b}
.tl-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.tl-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.tl-btn:hover{opacity:.9;transform:translateY(-1px)}
.tl-btn-primary{background:#4f46e5;color:#fff}
.tl-btn-success{background:#059669;color:#fff}
.tl-btn-danger{background:#fee2e2;color:#dc2626}
.tl-btn-secondary{background:#f1f5f9;color:#475569}
.tl-btn-gold{background:#fef9c3;color:#a16207}
.tl-btn-blue{background:#dbeafe;color:#1e40af}
.tl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px}
.tl-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s;display:flex;flex-direction:column}
.tl-card:hover{border-color:#c7d2fe;box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}
.tl-card-title{font-size:16px;font-weight:700;color:#1e293b;margin-bottom:4px}
.tl-card-desc{font-size:13px;color:#94a3b8;line-height:1.5;margin-bottom:12px;flex:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tl-card-meta{display:flex;gap:10px;font-size:12px;color:#64748b;margin-bottom:10px;align-items:center}
.tl-card-vars{margin-bottom:12px}
.tl-card-actions{display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid #f1f5f9;padding-top:12px;margin-top:auto}
.tl-card-actions .tl-btn{padding:5px 12px;font-size:11px}
.tl-list-item{display:grid;grid-template-columns:2fr 1fr 1fr 120px 100px 160px;gap:12px;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f5f9;font-size:13px;transition:.1s}
.tl-list-item:hover{background:#f8fafc}
.tl-list-header{font-weight:700;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.tl-tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.tl-tab{padding:7px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;border:2px solid transparent;transition:.15s}
.tl-tab:hover{background:#e2e8f0}
.tl-tab.active{color:#fff;background:#4f46e5;border-color:#4f46e5}
.tl-search{position:relative;margin-bottom:18px}
.tl-search input{width:100%;padding:11px 14px 11px 40px;border:2px solid #e2e8f0;border-radius:12px;font-size:14px;transition:.15s}
.tl-search input:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.tl-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px}
.tl-filter-bar{display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
.tl-filter-bar label{font-size:12px;font-weight:600;color:#64748b}
.tl-filter-bar select,.tl-filter-bar input{padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.tl-filter-bar select:focus,.tl-filter-bar input:focus{outline:none;border-color:#6366f1}
.tl-preview{background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:20px;margin-top:16px;min-height:120px}
.tl-preview h4{margin:0 0 12px;color:#475569;font-size:14px}
.tl-form-group{margin-bottom:18px}
.tl-form-group label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px}
.tl-form-group input,.tl-form-group select,.tl-form-group textarea{width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box}
.tl-form-group input:focus,.tl-form-group select:focus,.tl-form-group textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.tl-form-group textarea{resize:vertical;font-family:monospace}
.tl-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.tl-var-row{display:flex;gap:8px;margin-bottom:8px;align-items:center}
.tl-var-row input{flex:1;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px}
.tl-var-row input:focus{outline:none;border-color:#6366f1}
.tl-system-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#fef3c7;color:#a16207}
.tl-usage-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#e0e7ff;color:#4338ca}
.tl-version-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#f1f5f9;color:#64748b}
.tl-empty{text-align:center;padding:60px 20px;color:#94a3b8}
.tl-empty-icon{font-size:48px;margin-bottom:12px}
.tl-detail-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;flex-wrap:wrap;gap:12px}
.tl-detail-section{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;margin-bottom:16px}
.tl-detail-section h3{margin:0 0 14px;font-size:16px;color:#1e293b}
.tl-split{display:grid;grid-template-columns:1fr 1fr;gap:20px}
table.tl-table{width:100%;border-collapse:collapse;font-size:13px}
table.tl-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
table.tl-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
table.tl-table tr:hover{background:#f8fafc}
@media(max-width:768px){.tl-cards{grid-template-columns:1fr}.tl-split{grid-template-columns:1fr}.tl-form-row{grid-template-columns:1fr}.tl-list-item{grid-template-columns:1fr;gap:6px}.tl-stats{grid-template-columns:1fr 1fr}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function templateLibrary(app, db, pool, renderPage, esc) {
  if (!esc) esc = s => String(s == null ? '' : typeof s === 'object' ? JSON.stringify(s) : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const requireAuth = (req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); };
  const requireNotBanned = (req, res, next) => { if (req.session?.user?.banned) return res.send(renderPage('Banned', '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>', null)); next(); };

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.warn('[TemplateLibrary] DB connect failed'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'general',
        type VARCHAR(50) DEFAULT 'document',
        subject TEXT,
        body TEXT NOT NULL,
        variables TEXT[] DEFAULT '{}',
        is_system BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        usage_count INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        version INTEGER DEFAULT 1,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE IF NOT EXISTS for all columns (safe upgrades from prior deploys)
      const alterCols = [
        'name VARCHAR(255)', 'description TEXT', 'category VARCHAR(50)', 'type VARCHAR(50)',
        'subject TEXT', 'body TEXT', 'variables TEXT[]', 'is_system BOOLEAN',
        'is_active BOOLEAN', 'usage_count INTEGER', 'created_by INTEGER',
        'version INTEGER', 'tags TEXT[]', 'created_at TIMESTAMPTZ', 'updated_at TIMESTAMPTZ'
      ];
      for (const col of alterCols) {
        try { await c.query(`ALTER TABLE templates ADD COLUMN IF NOT EXISTS ${col}`); } catch (e) {}
      }
      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tpl_tenant ON templates(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tpl_category ON templates(category)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tpl_type ON templates(type)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_tpl_active ON templates(is_active)`);
      // Unique constraint for ON CONFLICT in seed (tenant_id, name)
      try { await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tpl_tenant_name ON templates(tenant_id, name)`); } catch (e) {}
      console.log('[TemplateLibrary] Migrations applied');
    } catch (e) {
      console.error('[TemplateLibrary] Migration error:', e.message);
    } finally {
      c.release();
    }

    // ============================================================
    // SEED SYSTEM TEMPLATES
    // ============================================================
    try {
      // Fetch all tenants for seeding
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;
      for (const tenant of tenants) {
        const tid = tenant.id;
        const seeds = [
          { name: 'Welcome Email', category: 'general', type: 'email', subject: 'Welcome to {organization}, {name}!',
            body: 'Dear {name},\n\nWelcome to {organization}! We are thrilled to have you join our community.\n\nYour account has been set up and you can now access all features of our platform.\n\nIf you have any questions, please don\'t hesitate to reach out.\n\nBest regards,\nThe {organization} Team',
            variables: ['name', 'organization'], tags: ['welcome', 'onboarding'] },
          { name: 'Invoice Receipt', category: 'finance', type: 'document', subject: 'Receipt — Invoice {invoice_number}',
            body: 'INVOICE RECEIPT\n\nInvoice Number: {invoice_number}\nDate: {date}\nDue Date: {due_date}\n\nAmount Due: {amount}\n\nPayment has been received. Thank you for your prompt payment.\n\nIf you have any questions regarding this invoice, please contact our accounts department.',
            variables: ['invoice_number', 'amount', 'date', 'due_date'], tags: ['invoice', 'receipt', 'payment'] },
          { name: 'Meeting Invitation', category: 'communication', type: 'email', subject: 'Meeting: {meeting_title}',
            body: 'You are invited to attend the following meeting:\n\nMeeting: {meeting_title}\nDate: {date}\nTime: {time}\nLocation: {location}\n\nPlease confirm your attendance at your earliest convenience.\n\nAgenda will be shared prior to the meeting.',
            variables: ['meeting_title', 'date', 'time', 'location'], tags: ['meeting', 'invitation'] },
          { name: 'Payment Reminder', category: 'finance', type: 'email', subject: 'Payment Reminder — {name}',
            body: 'Dear {name},\n\nThis is a gentle reminder that a payment of {amount} is due by {due_date}.\n\nPlease ensure payment is made to Account: {account}\n\nIf payment has already been made, kindly disregard this notice.\n\nThank you for your cooperation.',
            variables: ['name', 'amount', 'due_date', 'account'], tags: ['payment', 'reminder', 'finance'] },
          { name: 'Report Cover', category: 'reporting', type: 'document', subject: '{title}',
            body: '{title}\n\nPrepared by: {organization}\nPeriod: {period}\n\n---\n\nThis report contains comprehensive analysis and findings for the specified period.\nAll data has been verified and reviewed by the responsible departments.',
            variables: ['title', 'organization', 'period'], tags: ['report', 'cover'] },
          { name: 'Parent Newsletter', category: 'education', type: 'email', subject: '{school_name} — {term} Newsletter',
            body: 'Dear Parents and Guardians,\n\nWelcome to the {term} newsletter from {school_name}!\n\nUpcoming Events:\n{events}\n\nWe encourage all parents to participate actively in school activities.\n\nThank you for your continued support.\n\n{school_name} Administration',
            variables: ['school_name', 'term', 'events'], tags: ['newsletter', 'education', 'parents'] },
          { name: 'Church Bulletin', category: 'church', type: 'document', subject: 'Weekly Bulletin — {church_name}',
            body: '{church_name}\nWeekly Bulletin — {date}\n\nSermon Title: {sermon_title}\n\nAnnouncements:\n{announcements}\n\nWe warmly welcome all visitors. May God bless you abundantly.\n\nHave a blessed week!',
            variables: ['church_name', 'date', 'sermon_title', 'announcements'], tags: ['church', 'bulletin', 'sermon'] },
          { name: 'Appointment Confirmation', category: 'clinic', type: 'email', subject: 'Appointment Confirmed — {patient_name}',
            body: 'Dear {patient_name},\n\nYour appointment has been confirmed.\n\nDoctor: {doctor_name}\nDate: {date}\nTime: {time}\n\nPlease arrive 15 minutes before your scheduled time.\nRemember to bring your identification and any relevant medical documents.\n\nIf you need to reschedule, please contact us at least 24 hours in advance.',
            variables: ['patient_name', 'doctor_name', 'date', 'time'], tags: ['appointment', 'medical', 'clinic'] },
          { name: 'Employee Onboarding', category: 'hr', type: 'document', subject: 'Welcome aboard, {employee_name}!',
            body: 'EMPLOYEE ONBOARDING GUIDE\n\nWelcome, {employee_name}!\n\nPosition: {position}\nDepartment: {department}\nStart Date: {start_date}\n\nWe are excited to have you join our team. Please review the following:\n\n1. Complete all HR documentation\n2. Set up your system accounts\n3. Attend the orientation session\n4. Meet your team members\n\nIf you have any questions, please contact HR.',
            variables: ['employee_name', 'position', 'department', 'start_date'], tags: ['onboarding', 'hr', 'employee'] },
          { name: 'Maintenance Notice', category: 'general', type: 'email', subject: 'Scheduled Maintenance — {system_name}',
            body: 'Dear Users,\n\nPlease be informed that {system_name} will undergo scheduled maintenance.\n\nScheduled Date: {scheduled_date}\nExpected Duration: {duration}\n\nDuring this period, the system may be temporarily unavailable. We apologize for any inconvenience.\n\nThank you for your patience and understanding.',
            variables: ['system_name', 'scheduled_date', 'duration'], tags: ['maintenance', 'notice', 'system'] },
          { name: 'Student Progress Report', category: 'education', type: 'document', subject: 'Progress Report — {student_name}',
            body: 'STUDENT PROGRESS REPORT\n\nStudent: {student_name}\nClass: {class_name}\nTerm: {term}\n\nAcademic Performance: {performance}\nTeacher Remarks: {remarks}\n\nOverall Grade: {grade}\n\nPlease review and sign below.',
            variables: ['student_name', 'class_name', 'term', 'performance', 'remarks', 'grade'], tags: ['education', 'report', 'student'] },
          { name: 'Sunday Service Program', category: 'church', type: 'document', subject: 'Service Program — {church_name}',
            body: '{church_name}\nSunday Service Program\nDate: {date}\n\nOrder of Service:\n1. Praise and Worship\n2. Opening Prayer\n3. Announcements\n4. Sermon: {sermon_topic}\n5. Offertory\n6. Closing Prayer\n\nTheme: {theme}',
            variables: ['church_name', 'date', 'sermon_topic', 'theme'], tags: ['church', 'service', 'program'] },
          { name: 'Patient Visit Summary', category: 'clinic', type: 'document', subject: 'Visit Summary — {patient_name}',
            body: 'PATIENT VISIT SUMMARY\n\nPatient: {patient_name}\nDate: {date}\nDoctor: {doctor_name}\n\nDiagnosis: {diagnosis}\nPrescription: {prescription}\nFollow-up: {followup_date}\n\nNotes: {notes}',
            variables: ['patient_name', 'date', 'doctor_name', 'diagnosis', 'prescription', 'followup_date', 'notes'], tags: ['medical', 'clinic', 'visit'] },
          { name: 'Leave Request Confirmation', category: 'hr', type: 'email', subject: 'Leave Request Received — {employee_name}',
            body: 'Dear {employee_name},\n\nYour leave request has been received and is pending approval.\n\nLeave Type: {leave_type}\nFrom: {start_date}\nTo: {end_date}\nDays: {days}\n\nYou will be notified once your request is reviewed by your manager.',
            variables: ['employee_name', 'leave_type', 'start_date', 'end_date', 'days'], tags: ['hr', 'leave', 'request'] },
          { name: 'Event Invitation Card', category: 'general', type: 'document', subject: 'You\'re Invited — {event_name}',
            body: 'YOU ARE CORDIALLY INVITED\n\nEvent: {event_name}\nHosted by: {organization}\nDate: {date}\nTime: {time}\nVenue: {venue}\n\nDress Code: {dress_code}\nRSVP: {rsvp_contact}\n\nWe look forward to seeing you there!',
            variables: ['event_name', 'organization', 'date', 'time', 'venue', 'dress_code', 'rsvp_contact'], tags: ['event', 'invitation', 'general'] }
        ];

        for (const s of seeds) {
          await pool.query(
            `INSERT INTO templates (tenant_id, name, description, category, type, subject, body, variables, is_system, tags)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
             ON CONFLICT (tenant_id, name) DO NOTHING`,
            [tid, s.name, s.description || '', s.category, s.type, s.subject, s.body, s.variables, s.tags]
          );
        }
      }
      console.log('[TemplateLibrary] System templates seeded for ' + tenants.length + ' tenant(s)');
    } catch (e) {
      console.error('[TemplateLibrary] Seed error:', e.message);
    }
  })();

  // ============================================================
  // NAV BAR HELPER
  // ============================================================
  function navBar(active) {
    return `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
  <a href="/templates" class="btn btn-sm ${active === 'library' ? 'active' : ''}">Library</a>
  <a href="/templates/new" class="btn btn-sm ${active === 'create' ? 'active' : ''}">+ Create</a>
  <a href="/templates/categories" class="btn btn-sm ${active === 'categories' ? 'active' : ''}">Categories</a>
</div>`;
  }

  // ============================================================
  // ROUTE 1: GET /templates — Template Library
  // ============================================================
  app.get('/templates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { q: search, category, type, sort, view } = req.query;
    const viewMode = view === 'list' ? 'list' : 'grid';

    let sql = 'SELECT * FROM templates WHERE tenant_id = $1';
    const params = [tid];
    let pi = 2;

    if (search && search.trim()) {
      sql += ` AND (name ILIKE $${pi} OR description ILIKE $${pi} OR subject ILIKE $${pi})`;
      params.push(`%${search.trim()}%`);
      pi++;
    }
    if (category && category !== 'all') {
      sql += ` AND category = $${pi}`;
      params.push(category);
      pi++;
    }
    if (type && type !== 'all') {
      sql += ` AND type = $${pi}`;
      params.push(type);
      pi++;
    }

    const sortMap = {
      name: 'name ASC', date: 'created_at DESC', usage: 'usage_count DESC', category: 'category ASC'
    };
    sql += ` ORDER BY is_system DESC, ${sortMap[sort] || sortMap.date}, id DESC`;

    const templates = (await pool.query(sql, params)).rows;
    const totalCount = (await pool.query('SELECT COUNT(*) as cnt FROM templates WHERE tenant_id=$1', [tid])).rows[0].cnt;
    const systemCount = templates.filter(t => t.is_system).length;
    const customCount = totalCount - systemCount;
    const totalUsage = templates.reduce((a, t) => a + (t.usage_count || 0), 0);

    // Category tabs
    const catTabs = ['all', ...CATEGORIES].map(c =>
      `<a href="/templates?category=${c}${search ? '&q=' + encodeURIComponent(search) : ''}${type && type !== 'all' ? '&type=' + type : ''}${sort ? '&sort=' + sort : ''}${view ? '&view=' + view : ''}" class="tl-tab ${category === c || (!category && c === 'all') ? 'active' : ''}">${c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}</a>`
    ).join('');

    // Render templates
    let templateHtml = '';
    if (viewMode === 'grid') {
      templateHtml = `<div class="tl-cards">` + templates.map(t => {
        const vars = t.variables || [];
        return `<div class="tl-card">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <div class="tl-card-title">${esc(t.name)}</div>
            <div style="display:flex;gap:4px;flex-shrink:0">
              ${t.is_system ? '<span class="tl-system-badge">🔒 System</span>' : ''}
              ${typeBadge(t.type)}
            </div>
          </div>
          <div class="tl-card-desc">${esc(t.description || t.subject || 'No description')}</div>
          <div class="tl-card-meta">
            <span>📁 ${esc(t.category)}</span>
            ${t.usage_count > 0 ? `<span class="tl-usage-badge">📊 ${t.usage_count}</span>` : ''}
            <span class="tl-version-badge">v${t.version || 1}</span>
          </div>
          <div class="tl-card-vars">${variableTags(vars)}</div>
          <div class="tl-card-actions">
            <a href="/templates/${t.id}" class="tl-btn tl-btn-primary">👁 View</a>
            ${!t.is_system ? `<a href="/templates/${t.id}/edit" class="tl-btn tl-btn-secondary">✏️ Edit</a>` : ''}
            <a href="/templates/${t.id}/duplicate" class="tl-btn tl-btn-secondary">📋 Duplicate</a>
            <form method="POST" action="/templates/${t.id}/use" style="display:inline"><button class="tl-btn tl-btn-success">▶ Use</button></form>
          </div>
        </div>`;
      }).join('') + `</div>`;
    } else {
      templateHtml = `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
        <div class="tl-list-item tl-list-header">
          <div>Name</div><div>Category</div><div>Type</div><div>Usage</div><div>Version</div><div>Actions</div>
        </div>` + templates.map(t => `<div class="tl-list-item">
          <div><strong>${esc(t.name)}</strong>${t.is_system ? ' <span class="tl-system-badge">🔒</span>' : ''}</div>
          <div>${esc(t.category)}</div>
          <div>${typeBadge(t.type)}</div>
          <div>${t.usage_count || 0}</div>
          <div>v${t.version || 1}</div>
          <div style="display:flex;gap:4px">
            <a href="/templates/${t.id}" class="tl-btn tl-btn-primary" style="padding:4px 10px;font-size:11px">View</a>
            ${!t.is_system ? `<a href="/templates/${t.id}/edit" class="tl-btn tl-btn-secondary" style="padding:4px 10px;font-size:11px">Edit</a>` : ''}
            <a href="/templates/${t.id}/duplicate" class="tl-btn tl-btn-secondary" style="padding:4px 10px;font-size:11px">Dup</a>
          </div>
        </div>`).join('') + `</div>`;
    }

    const html = TL_CSS + navBar('library') + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📄 Template Library</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage reusable templates for your organization</p></div>
        <a href="/templates/new" class="tl-btn tl-btn-primary">+ Create Template</a>
      </div>
      <div class="tl-stats">
        <div class="tl-stat"><div class="tl-stat-val" style="color:#4f46e5">${totalCount}</div><div class="tl-stat-lbl">Total Templates</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#a16207">${systemCount}</div><div class="tl-stat-lbl">System Templates</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#059669">${customCount}</div><div class="tl-stat-lbl">Custom Templates</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#7c3aed">${totalUsage}</div><div class="tl-stat-lbl">Total Usage</div></div>
      </div>
      <div class="tl-tabs">${catTabs}</div>
      <div class="tl-filter-bar">
        <div class="tl-search" style="flex:1;min-width:220px">
          <span class="tl-search-icon">🔍</span>
          <input type="text" id="tpl-search" placeholder="Search templates..." value="${esc(search || '')}" onkeyup="debounceSearch()">
        </div>
        <div>
          <label>Type</label>
          <select onchange="this.options[this.selectedIndex].value && (window.location='/templates?category=${category || 'all'}&type='+this.value+'&sort=${sort || 'date'}&view=${viewMode}')">
            <option value="all" ${(!type || type === 'all') ? 'selected' : ''}>All Types</option>
            <option value="document" ${type === 'document' ? 'selected' : ''}>Document</option>
            <option value="email" ${type === 'email' ? 'selected' : ''}>Email</option>
            <option value="report" ${type === 'report' ? 'selected' : ''}>Report</option>
            <option value="letter" ${type === 'letter' ? 'selected' : ''}>Letter</option>
            <option value="certificate" ${type === 'certificate' ? 'selected' : ''}>Certificate</option>
          </select>
        </div>
        <div>
          <label>Sort</label>
          <select onchange="window.location='/templates?category=${category || 'all'}&type=${type || 'all'}&sort='+this.value+'&view=${viewMode}'">
            <option value="date" ${(!sort || sort === 'date') ? 'selected' : ''}>Newest</option>
            <option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option>
            <option value="usage" ${sort === 'usage' ? 'selected' : ''}>Most Used</option>
            <option value="category" ${sort === 'category' ? 'selected' : ''}>Category</option>
          </select>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <a href="/templates?category=${category || 'all'}&type=${type || 'all'}&sort=${sort || 'date'}&view=grid" class="tl-btn ${viewMode === 'grid' ? 'tl-btn-primary' : 'tl-btn-secondary'}" style="padding:7px 12px;font-size:12px">▦ Grid</a>
          <a href="/templates?category=${category || 'all'}&type=${type || 'all'}&sort=${sort || 'date'}&view=list" class="tl-btn ${viewMode === 'list' ? 'tl-btn-primary' : 'tl-btn-secondary'}" style="padding:7px 12px;font-size:12px">☰ List</a>
        </div>
      </div>
      ${templates.length ? templateHtml : '<div class="tl-empty"><div class="tl-empty-icon">📄</div><p style="font-size:18px;margin-bottom:12px">No templates found</p><p style="font-size:14px">Try adjusting your filters or create a new template.</p><a href="/templates/new" class="tl-btn tl-btn-primary" style="margin-top:16px">+ Create Template</a></div>'}
    </div>
    <script>
      let debounceTimer;
      function debounceSearch(){
        clearTimeout(debounceTimer);
        debounceTimer=setTimeout(()=>{
          const q=document.getElementById('tpl-search').value;
          window.location='/templates?category=${category || 'all'}&type=${type || 'all'}&sort=${sort || 'date'}&view=${viewMode}&q='+encodeURIComponent(q);
        },400);
      }
    </script>`;
    res.send(renderPage('Template Library', html, u));
  }));

  // ============================================================
  // ROUTE 2: GET /templates/new — Create Template Form
  // ============================================================
  app.get('/templates/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user;
    const catOptions = CATEGORIES.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
    const typeOptions = Object.entries(TYPE_BADGES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

    const html = TL_CSS + navBar('create') + `
    <div style="max-width:1100px;margin:0 auto">
      <a href="/templates" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>
      <div class="tl-split">
        <div class="card" style="padding:28px">
          <h2 style="margin:0 0 4px;color:#1e293b">📝 Create New Template</h2>
          <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Design a reusable template with dynamic variables</p>
          <form method="POST" action="/templates/create" id="tpl-form">
            <div class="tl-form-group">
              <label>Template Name *</label>
              <input type="text" name="name" required placeholder="e.g., Welcome Email" oninput="updatePreview()">
            </div>
            <div class="tl-form-row">
              <div class="tl-form-group">
                <label>Category</label>
                <select name="category" onchange="updatePreview()">${catOptions}</select>
              </div>
              <div class="tl-form-group">
                <label>Type</label>
                <select name="type" onchange="updatePreview()">${typeOptions}</select>
              </div>
            </div>
            <div class="tl-form-group">
              <label>Subject / Title</label>
              <input type="text" name="subject" placeholder="e.g., Welcome to our platform, {name}!" oninput="updatePreview()">
            </div>
            <div class="tl-form-group">
              <label>Body *</label>
              <textarea name="body" rows="12" required placeholder="Write your template here. Use {variable_name} for dynamic fields..." oninput="updatePreview()"></textarea>
            </div>
            <div class="tl-form-group">
              <label>Tags (comma-separated)</label>
              <input type="text" name="tags" placeholder="e.g., welcome, onboarding, email">
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="submit" class="tl-btn tl-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">💾 Save Template</button>
              <button type="button" class="tl-btn tl-btn-secondary" onclick="updatePreview()">🔄 Refresh Preview</button>
            </div>
          </form>
        </div>
        <div>
          <div class="card" style="padding:22px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#1e293b">🏷️ Detected Variables</h3>
            <div id="detected-vars"><span class="muted" style="font-size:12px">Start typing to detect variables...</span></div>
          </div>
          <div class="card" style="padding:22px">
            <h3 style="margin:0 0 12px;color:#1e293b">👁 Live Preview</h3>
            <div class="tl-preview" id="live-preview">
              <h4>Preview with sample data</h4>
              <div id="preview-content" style="font-size:13px;color:#64748b;white-space:pre-wrap">Start typing in the form to see a live preview here...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const sampleMap = ${JSON.stringify({
        name: 'John Mukasa', organization: 'SSEWASSWA Academy', invoice_number: 'INV-2025-0042',
        amount: 'UGX 1,500,000', date: '15 Jan 2025', due_date: '15 Feb 2025',
        account: 'ACC-1001', meeting_title: 'Q1 Strategy Review', time: '10:00 AM',
        location: 'Conference Room A', title: 'Annual Performance Report',
        period: 'January – December 2024', school_name: 'SSEWASSWA Primary School',
        term: 'Term 1, 2025', events: 'Sports Day, Science Fair',
        church_name: 'SSEWASSWA Community Church', sermon_title: 'Walking in Faith',
        announcements: 'Youth Camp registration open', patient_name: 'Grace Nakamya',
        doctor_name: 'Dr. Samuel Okello', start_date: '01 February 2025',
        employee_name: 'Peter Ochieng', position: 'Senior Developer',
        department: 'IT & Systems', system_name: 'SSEWASSWA Platform',
        scheduled_date: '20 Jan 2025', duration: '2 hours', email: 'admin@ssewasswa.org',
        phone: '+256 700 123 456', student_name: 'Jane Achieng', class_name: 'Primary 6',
        performance: 'Excellent', remarks: 'Outstanding student', grade: 'A',
        sermon_topic: 'Faith and Strength', theme: 'Unity in Christ',
        diagnosis: 'General checkup', prescription: 'Paracetamol 500mg',
        followup_date: '20 Feb 2025', notes: 'Patient in good health',
        leave_type: 'Annual Leave', end_date: '15 Feb 2025', days: '5',
        event_name: 'Annual Gala', venue: 'Main Hall', dress_code: 'Formal',
        rsvp_contact: 'admin@ssewasswa.org'
      })};
      function updatePreview(){
        const form=document.getElementById('tpl-form');
        const body=form.body.value||'';
        const subject=form.subject.value||'';
        const combined=subject+' '+body;
        const vars=[...new Set((combined.match(/\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}/g)||[]).map(m=>m.slice(1,-1)))];
        // Variables display
        const varsDiv=document.getElementById('detected-vars');
        if(vars.length){
          varsDiv.innerHTML=vars.map(v=>'<span style="display:inline-block;padding:3px 12px;border-radius:14px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;margin:2px">{'+v+'}</span>').join('');
        }else{
          varsDiv.innerHTML='<span class="muted" style="font-size:12px">No variables detected. Use {variable_name} syntax.</span>';
        }
        // Preview
        let rendered=body;
        for(const v of vars){rendered=rendered.split('{'+v+'}').join(sampleMap[v]||v)}
        let renderedSubject=subject;
        for(const v of vars){renderedSubject=renderedSubject.split('{'+v+'}').join(sampleMap[v]||v)}
        const previewDiv=document.getElementById('preview-content');
        previewDiv.innerHTML=(renderedSubject?'<div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #e2e8f0">'+renderedSubject+'</div>':'')+'<div style="white-space:pre-wrap;color:#334155;line-height:1.7">'+(rendered||'<em>Empty body</em>')+'</div>';
      }
    </script>`;
    res.send(renderPage('Create Template', html, u));
  }));

  // ============================================================
  // ROUTE 3: POST /templates/create — Save New Template
  // ============================================================
  app.post('/templates/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { name, description, category, type, subject, body, tags } = req.body;
    if (!name || !name.trim() || !body || !body.trim()) {
      return res.redirect('/templates/new');
    }
    const allText = (subject || '') + ' ' + (body || '');
    const variables = extractVariables(allText);
    const tagArr = (tags || '').split(',').map(t => t.trim()).filter(Boolean);

    const result = await pool.query(
      `INSERT INTO templates (tenant_id, name, description, category, type, subject, body, variables, is_system, created_by, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10) RETURNING id`,
      [tid, name.trim(), (description || '').trim(), category || 'general', type || 'document',
       (subject || '').trim(), body.trim(), variables, u.id, tagArr]
    );
    console.log(`[TemplateLibrary] Template "${name.trim()}" created by ${u.email} (id=${result.rows[0].id})`);
    res.redirect('/templates/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 4: GET /templates/:id — View Template Detail
  // ============================================================
  app.get('/templates/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT t.*, u.email as creator_email FROM templates t LEFT JOIN users u ON u.id=t.created_by WHERE t.id=$1 AND t.tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Template not found</h2><a href="/templates" class="tl-btn tl-btn-primary" style="margin-top:12px">← Back to Library</a></div>', u));

    const variables = tpl.variables || [];
    const sampleVars = {};
    variables.forEach(v => { sampleVars[v] = sampleDataForVariable(v); });
    const renderedBody = renderTemplate(tpl.body, sampleVars);
    const renderedSubject = renderTemplate(tpl.subject, sampleVars);

    // JSON for client-side preview editing
    const sampleMapJSON = JSON.stringify(sampleVars);

    const html = TL_CSS + navBar('library') + `
    <div style="max-width:1100px;margin:0 auto">
      <a href="/templates" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>
      <div class="tl-detail-header">
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
            <h1 style="font-size:24px;color:#1e293b;margin:0">${esc(tpl.name)}</h1>
            ${tpl.is_system ? '<span class="tl-system-badge">🔒 System Template</span>' : ''}
            ${typeBadge(tpl.type)}
          </div>
          <p style="font-size:13px;color:#94a3b8;margin:0">${esc(tpl.description || 'No description')}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${!tpl.is_system ? `<a href="/templates/${id}/edit" class="tl-btn tl-btn-primary">✏️ Edit</a>` : ''}
          <a href="/templates/${id}/duplicate" class="tl-btn tl-btn-gold">📋 Duplicate</a>
          <form method="POST" action="/templates/${id}/use" style="display:inline"><button class="tl-btn tl-btn-success">▶ Use Template</button></form>
          ${!tpl.is_system ? `<form method="POST" action="/templates/${id}" style="display:inline" onsubmit="return confirm('Delete this template permanently?')"><input type="hidden" name="_method" value="DELETE"><button class="tl-btn tl-btn-danger">🗑 Delete</button></form>` : ''}
        </div>
      </div>

      <div class="tl-stats" style="margin-bottom:20px">
        <div class="tl-stat"><div class="tl-stat-val" style="color:#4f46e5">${tpl.usage_count || 0}</div><div class="tl-stat-lbl">Times Used</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#a16207">v${tpl.version || 1}</div><div class="tl-stat-lbl">Version</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#059669">${variables.length}</div><div class="tl-stat-lbl">Variables</div></div>
        <div class="tl-stat"><div class="tl-stat-val" style="color:#64748b" style="font-size:16px">${formatDate(tpl.created_at)}</div><div class="tl-stat-lbl">Created</div></div>
      </div>

      <div class="tl-split">
        <div>
          <div class="tl-detail-section">
            <h3>📋 Template Content</h3>
            ${tpl.subject ? `<div style="padding:10px 14px;background:#eef2ff;border-radius:8px;margin-bottom:14px;font-size:14px;font-weight:600;color:#4f46e5"><strong>Subject:</strong> ${esc(tpl.subject)}</div>` : ''}
            <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;font-size:13px;color:#334155;white-space:pre-wrap;line-height:1.7;overflow-x:auto;margin:0">${esc(tpl.body)}</pre>
          </div>
          <div class="tl-detail-section">
            <h3>ℹ️ Details</h3>
            <table class="tl-table">
              <tr><td style="font-weight:600;width:140px">Category</td><td>${esc(tpl.category)}</td></tr>
              <tr><td style="font-weight:600">Type</td><td>${typeBadge(tpl.type)}</td></tr>
              <tr><td style="font-weight:600">Creator</td><td>${esc(tpl.creator_email || 'System')}</td></tr>
              <tr><td style="font-weight:600">Created</td><td>${formatDateTime(tpl.created_at)}</td></tr>
              <tr><td style="font-weight:600">Updated</td><td>${formatDateTime(tpl.updated_at)}</td></tr>
              ${tpl.tags && tpl.tags.length ? `<tr><td style="font-weight:600">Tags</td><td>${tpl.tags.map(t => `<span class="badge badge-info">${esc(t)}</span>`).join(' ')}</td></tr>` : ''}
            </table>
          </div>
        </div>
        <div>
          <div class="tl-detail-section">
            <h3>🏷️ Variables Reference</h3>
            ${variables.length ? `
              <div style="margin-bottom:12px">${variableTags(variables)}</div>
              <p style="font-size:12px;color:#94a3b8;margin-bottom:14px">Edit values below to customize the preview:</p>
              <div id="var-inputs">${variables.map(v => `
                <div class="tl-var-row">
                  <label style="font-size:12px;font-weight:600;color:#64748b;min-width:120px">{${v}}</label>
                  <input type="text" data-var="${v}" value="${esc(sampleDataForVariable(v))}" oninput="updateDetailPreview()">
                </div>`).join('')}
              </div>` : '<p class="muted" style="font-size:13px">This template has no variables.</p>'}
          </div>
          <div class="tl-detail-section">
            <h3>👁 Live Preview</h3>
            <div class="tl-preview" id="detail-preview" style="border-style:solid;border-color:#c7d2fe">
              ${renderedSubject ? `<div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #e2e8f0">${esc(renderedSubject)}</div>` : ''}
              <div style="white-space:pre-wrap;color:#334155;line-height:1.7">${esc(renderedBody)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const baseVars = ${sampleMapJSON};
      function updateDetailPreview(){
        const inputs = document.querySelectorAll('#var-inputs input[data-var]');
        let subject = ${JSON.stringify(tpl.subject || '')};
        let body = ${JSON.stringify(tpl.body || '')};
        inputs.forEach(inp => {
          const v = inp.dataset.var;
          subject = subject.split('{'+v+'}').join(inp.value);
          body = body.split('{'+v+'}').join(inp.value);
        });
        const div = document.getElementById('detail-preview');
        div.innerHTML = (subject ? '<div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #e2e8f0">'+subject.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>' : '') +
          '<div style="white-space:pre-wrap;color:#334155;line-height:1.7">'+body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
      }
    </script>`;
    res.send(renderPage(tpl.name + ' — Template', html, u));
  }));

  // ============================================================
  // ROUTE 5: GET /templates/:id/edit — Edit Template Form
  // ============================================================
  app.get('/templates/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.redirect('/templates');
    if (tpl.is_system) return res.send(renderPage('Restricted', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#a16207">🔒 System templates cannot be edited</h2><p style="color:#94a3b8;margin:12px 0">Duplicate this template to create an editable copy.</p><a href="/templates/' + id + '/duplicate" class="tl-btn tl-btn-gold">📋 Duplicate Instead</a></div>', u));

    const catOptions = CATEGORIES.map(c => `<option value="${c}" ${tpl.category === c ? 'selected' : ''}>${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('');
    const typeOptions = Object.entries(TYPE_BADGES).map(([k, v]) => `<option value="${k}" ${tpl.type === k ? 'selected' : ''}>${v.label}</option>`).join('');
    const tagsStr = (tpl.tags || []).join(', ');

    const html = TL_CSS + navBar('library') + `
    <div style="max-width:1100px;margin:0 auto">
      <a href="/templates/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Template</a>
      <div class="tl-split">
        <div class="card" style="padding:28px">
          <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Template</h2>
          <p style="font-size:13px;color:#94a3b8;margin-bottom:4px">Editing: <strong>${esc(tpl.name)}</strong> (v${tpl.version || 1})</p>
          <div class="alert alert-success" style="margin-bottom:20px;padding:10px 14px;border-radius:10px;font-size:12px">ℹ️ Saving will bump the version to v${(tpl.version || 1) + 1}</div>
          <form method="POST" action="/templates/${id}/update" id="tpl-edit-form">
            <input type="hidden" name="current_version" value="${tpl.version || 1}">
            <div class="tl-form-group">
              <label>Template Name *</label>
              <input type="text" name="name" required value="${esc(tpl.name)}" oninput="updateEditPreview()">
            </div>
            <div class="tl-form-row">
              <div class="tl-form-group">
                <label>Category</label>
                <select name="category" onchange="updateEditPreview()">${catOptions}</select>
              </div>
              <div class="tl-form-group">
                <label>Type</label>
                <select name="type" onchange="updateEditPreview()">${typeOptions}</select>
              </div>
            </div>
            <div class="tl-form-group">
              <label>Subject / Title</label>
              <input type="text" name="subject" value="${esc(tpl.subject || '')}" oninput="updateEditPreview()">
            </div>
            <div class="tl-form-group">
              <label>Description</label>
              <textarea name="description" rows="2" style="font-family:inherit">${esc(tpl.description || '')}</textarea>
            </div>
            <div class="tl-form-group">
              <label>Body *</label>
              <textarea name="body" rows="12" required oninput="updateEditPreview()">${esc(tpl.body)}</textarea>
            </div>
            <div class="tl-form-group">
              <label>Tags (comma-separated)</label>
              <input type="text" name="tags" value="${esc(tagsStr)}">
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="tl-btn tl-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">💾 Save Changes</button>
              <a href="/templates/${id}" class="tl-btn tl-btn-secondary" style="padding:14px 20px">Cancel</a>
            </div>
          </form>
        </div>
        <div>
          <div class="card" style="padding:22px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;color:#1e293b">🏷️ Variables</h3>
            <div id="edit-detected-vars">${variableTags(tpl.variables || [])}</div>
          </div>
          <div class="card" style="padding:22px">
            <h3 style="margin:0 0 12px;color:#1e293b">👁 Preview</h3>
            <div class="tl-preview" id="edit-preview">
              <div id="edit-preview-content" style="white-space:pre-wrap;color:#334155;line-height:1.7">${esc(renderTemplate(tpl.body, (tpl.variables || []).reduce((a, v) => { a[v] = sampleDataForVariable(v); return a; }, {})))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const sampleMap = ${JSON.stringify({
        name:'John Mukasa',organization:'SSEWASSWA Academy',invoice_number:'INV-2025-0042',
        amount:'UGX 1,500,000',date:'15 Jan 2025',due_date:'15 Feb 2025',
        account:'ACC-1001',meeting_title:'Q1 Strategy Review',time:'10:00 AM',
        location:'Conference Room A',title:'Annual Performance Report',
        period:'Jan–Dec 2024',school_name:'SSEWASSWA Primary School',term:'Term 1, 2025',
        events:'Sports Day, Science Fair',church_name:'SSEWASSWA Community Church',
        sermon_title:'Walking in Faith',announcements:'Youth Camp open',
        patient_name:'Grace Nakamya',doctor_name:'Dr. Samuel Okello',
        start_date:'01 Feb 2025',employee_name:'Peter Ochieng',position:'Senior Developer',
        department:'IT & Systems',system_name:'SSEWASSWA Platform',
        scheduled_date:'20 Jan 2025',duration:'2 hours',email:'admin@ssewasswa.org',
        phone:'+256 700 123 456',student_name:'Jane Achieng',class_name:'Primary 6',
        performance:'Excellent',remarks:'Outstanding',grade:'A',
        sermon_topic:'Faith and Strength',theme:'Unity in Christ',
        diagnosis:'General checkup',prescription:'Paracetamol 500mg',
        followup_date:'20 Feb 2025',notes:'Good health',
        leave_type:'Annual Leave',end_date:'15 Feb 2025',days:'5',
        event_name:'Annual Gala',venue:'Main Hall',dress_code:'Formal',
        rsvp_contact:'admin@ssewasswa.org'
      })};
      function updateEditPreview(){
        const form=document.getElementById('tpl-edit-form');
        const body=form.body.value||'';
        const subject=form.subject.value||'';
        const combined=subject+' '+body;
        const vars=[...new Set((combined.match(/\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}/g)||[]).map(m=>m.slice(1,-1)))];
        document.getElementById('edit-detected-vars').innerHTML=vars.length?vars.map(v=>'<span style="display:inline-block;padding:3px 12px;border-radius:14px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;margin:2px">{'+v+'}</span>').join(''):'<span class="muted" style="font-size:12px">No variables</span>';
        let rendered=body;for(const v of vars){rendered=rendered.split('{'+v+'}').join(sampleMap[v]||v)}
        document.getElementById('edit-preview-content').textContent=rendered||'(empty)';
      }
    </script>`;
    res.send(renderPage('Edit Template — ' + tpl.name, html, u));
  }));

  // ============================================================
  // ROUTE 6: POST /templates/:id/update — Update Template
  // ============================================================
  app.post('/templates/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.redirect('/templates');
    if (tpl.is_system) return res.redirect('/templates/' + id);

    const { name, description, category, type, subject, body, tags, current_version } = req.body;
    if (!name || !name.trim() || !body || !body.trim()) return res.redirect('/templates/' + id + '/edit');

    const allText = (subject || '') + ' ' + (body || '');
    const variables = extractVariables(allText);
    const tagArr = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const newVersion = (parseInt(current_version) || tpl.version || 1) + 1;

    await pool.query(
      `UPDATE templates SET name=$1, description=$2, category=$3, type=$4, subject=$5, body=$6,
       variables=$7, tags=$8, version=$9, updated_at=NOW() WHERE id=$10 AND tenant_id=$11`,
      [name.trim(), (description || '').trim(), category || 'general', type || 'document',
       (subject || '').trim(), body.trim(), variables, tagArr, newVersion, id, tid]
    );
    console.log(`[TemplateLibrary] Template "${name.trim()}" updated to v${newVersion} by ${u.email}`);
    res.redirect('/templates/' + id);
  }));

  // ============================================================
  // ROUTE 7: GET /templates/:id/duplicate — Clone Template
  // ============================================================
  app.get('/templates/:id/duplicate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.redirect('/templates');

    const dupName = tpl.name + ' (Copy)';
    const result = await pool.query(
      `INSERT INTO templates (tenant_id, name, description, category, type, subject, body, variables, is_system, created_by, version, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, 1, $10) RETURNING id`,
      [tid, dupName, (tpl.description || 'Duplicated from: ' + tpl.name).trim(), tpl.category, tpl.type,
       tpl.subject, tpl.body, tpl.variables || [], u.id, tpl.tags || []]
    );
    console.log(`[TemplateLibrary] Template "${tpl.name}" duplicated as "${dupName}" by ${u.email}`);
    res.redirect('/templates/' + result.rows[0].id + '/edit');
  }));

  // ============================================================
  // ROUTE 8: DELETE /templates/:id — Delete Template
  // ============================================================
  app.delete('/templates/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.redirect('/templates');
    if (tpl.is_system) return res.redirect('/templates/' + id);

    await pool.query('DELETE FROM templates WHERE id=$1 AND tenant_id=$2 AND is_system=false', [id, tid]);
    console.log(`[TemplateLibrary] Template "${tpl.name}" deleted by ${u.email}`);
    res.redirect('/templates');
  }));

  // Also support POST with _method=DELETE for forms
  app.post('/templates/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (req.body._method === 'DELETE') {
      const u = req.session.user, tid = u.tenant_id, id = req.params.id;
      const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
      if (!tpl || tpl.is_system) return res.redirect('/templates');
      await pool.query('DELETE FROM templates WHERE id=$1 AND tenant_id=$2 AND is_system=false', [id, tid]);
      console.log(`[TemplateLibrary] Template "${tpl.name}" deleted by ${u.email}`);
    }
    res.redirect('/templates');
  }));

  // ============================================================
  // ROUTE 9: POST /templates/:id/use — Increment Usage
  // ============================================================
  app.post('/templates/:id/use', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.redirect('/templates');

    await pool.query('UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW() WHERE id=$1 AND tenant_id=$2', [id, tid]);
    console.log(`[TemplateLibrary] Template "${tpl.name}" used by ${u.email} (usage: ${(tpl.usage_count || 0) + 1})`);

    // Redirect based on type
    const typeRedirects = {
      email: '/messaging/compose?tpl_id=' + id,
      document: '/templates/' + id,
      report: '/reports',
      letter: '/templates/' + id,
      certificate: '/templates/' + id
    };
    res.redirect(typeRedirects[tpl.type] || '/templates/' + id);
  }));

  // ============================================================
  // ROUTE 10: GET /templates/categories — Category Management
  // ============================================================
  app.get('/templates/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;

    // Get template counts per category
    const counts = (await pool.query(
      `SELECT category, COUNT(*) as cnt, COUNT(*) FILTER (WHERE is_active=true) as active_cnt
       FROM templates WHERE tenant_id=$1 GROUP BY category ORDER BY cnt DESC`, [tid]
    )).rows;

    const totalTemplates = counts.reduce((a, c) => a + parseInt(c.cnt), 0);

    const catRows = CATEGORIES.map(cat => {
      const c = counts.find(r => r.category === cat) || { cnt: 0, active_cnt: 0 };
      return `<tr>
        <td style="font-weight:600;text-transform:capitalize">${esc(cat)}</td>
        <td>${c.cnt}</td>
        <td>${c.active_cnt}</td>
        <td style="width:200px">
          <div style="background:#f1f5f9;border-radius:6px;overflow:hidden;height:8px">
            <div style="height:100%;background:linear-gradient(90deg,#4f46e5,#818cf8);border-radius:6px;width:${totalTemplates ? Math.round(c.cnt / totalTemplates * 100) : 0}%"></div>
          </div>
        </td>
      </tr>`;
    }).join('');

    // Add custom categories from existing templates
    const existingCats = new Set(CATEGORIES);
    const customCats = counts.filter(c => !existingCats.has(c.category));
    const customCatRows = customCats.map(c => `<tr>
      <td style="font-weight:600;text-transform:capitalize">${esc(c.category)} <span class="badge badge-warning">Custom</span></td>
      <td>${c.cnt}</td><td>${c.active_cnt}</td>
      <td></td>
    </tr>`).join('');

    const html = TL_CSS + navBar('categories') + `
    <div style="max-width:900px;margin:0 auto">
      <a href="/templates" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📁 Category Management</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage template categories and their usage</p></div>
      </div>
      <div class="card" style="padding:24px;margin-bottom:20px">
        <h3 style="margin:0 0 16px;color:#1e293b">Add Custom Category</h3>
        <form method="POST" action="/templates/categories/add" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <div class="tl-form-group" style="margin:0;flex:1;min-width:200px">
            <label>Category Name</label>
            <input type="text" name="category" required placeholder="e.g., marketing, legal" pattern="[a-z_]+" title="Lowercase letters and underscores only">
          </div>
          <button type="submit" class="tl-btn tl-btn-primary" style="padding:11px 20px">+ Add Category</button>
        </form>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="margin:0 0 16px;color:#1e293b">Categories Overview</h3>
        <div style="overflow-x:auto">
          <table class="tl-table">
            <thead><tr><th>Category</th><th>Total</th><th>Active</th><th>Distribution</th></tr></thead>
            <tbody>${catRows}${customCatRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card" style="padding:24px;margin-top:16px">
        <h3 style="margin:0 0 12px;color:#1e293b">📖 Category Guide</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${[
            { name: 'General', icon: '📋', desc: 'General-purpose templates for common tasks' },
            { name: 'Finance', icon: '💰', desc: 'Invoices, receipts, payment reminders' },
            { name: 'Communication', icon: '💬', desc: 'Meeting invites, announcements, notices' },
            { name: 'Reporting', icon: '📊', desc: 'Report covers, summaries, analyses' },
            { name: 'Education', icon: '🎓', desc: 'Newsletters, progress reports, school notices' },
            { name: 'Church', icon: '⛪', desc: 'Bulletins, service programs, event cards' },
            { name: 'Clinic', icon: '🏥', desc: 'Appointments, visit summaries, medical notices' },
            { name: 'HR', icon: '👥', desc: 'Onboarding, leave requests, HR documents' }
          ].map(c => `<div style="padding:12px;background:#f8fafc;border-radius:10px;font-size:13px">
            <span style="font-size:18px;margin-right:6px">${c.icon}</span>
            <strong style="color:#1e293b">${c.name}</strong>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:12px">${c.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Category Management', html, u));
  }));

  // ============================================================
  // ROUTE 11: POST /templates/categories/add — Add Category
  // ============================================================
  app.post('/templates/categories/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { category } = req.body;
    if (!category || !category.trim()) return res.redirect('/templates/categories');
    const catName = category.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (CATEGORIES.includes(catName)) return res.redirect('/templates/categories');
    CATEGORIES.push(catName);
    console.log(`[TemplateLibrary] Custom category "${catName}" added`);
    res.redirect('/templates/categories');
  }));

  // ============================================================
  // ROUTE 12: GET /api/templates — JSON API
  // ============================================================
  app.get('/api/templates', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { category, type, is_active, q: search, limit, offset } = req.query;

    let sql = 'SELECT * FROM templates WHERE tenant_id = $1';
    const params = [tid];
    let pi = 2;

    if (search && search.trim()) {
      sql += ` AND (name ILIKE $${pi} OR description ILIKE $${pi} OR subject ILIKE $${pi})`;
      params.push(`%${search.trim()}%`);
      pi++;
    }
    if (category) { sql += ` AND category = $${pi}`; params.push(category); pi++; }
    if (type) { sql += ` AND type = $${pi}`; params.push(type); pi++; }
    if (is_active !== undefined) { sql += ` AND is_active = $${pi}`; params.push(is_active === 'true'); pi++; }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = (await pool.query(countSql, params)).rows[0].total;

    sql += ' ORDER BY is_system DESC, created_at DESC';
    if (limit) { sql += ` LIMIT $${pi}`; params.push(parseInt(limit)); pi++; }
    if (offset) { sql += ` OFFSET $${pi}`; params.push(parseInt(offset)); pi++; }

    const templates = (await pool.query(sql, params)).rows;
    res.json({ success: true, total, page: parseInt(offset || 0), limit: parseInt(limit || 50), data: templates });
  }));

  // ============================================================
  // ROUTE 13: GET /api/templates/:id/preview — Render Preview
  // ============================================================
  app.get('/api/templates/:id/preview', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.json({ success: false, error: 'Template not found' });

    const variables = tpl.variables || [];
    const sampleVars = {};
    variables.forEach(v => { sampleVars[v] = sampleDataForVariable(v); });

    res.json({
      success: true,
      template: {
        id: tpl.id, name: tpl.name, category: tpl.category, type: tpl.type,
        subject: tpl.subject, body: tpl.body, variables: tpl.variables,
        is_system: tpl.is_system, usage_count: tpl.usage_count, version: tpl.version
      },
      preview: {
        subject: renderTemplate(tpl.subject, sampleVars),
        body: renderTemplate(tpl.body, sampleVars),
        sample_data: sampleVars
      }
    });
  }));

  // ============================================================
  // ROUTE 14: POST /api/templates/render — Render with Data
  // ============================================================
  app.post('/api/templates/render', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { template_id, body, subject, variables } = req.body;

    let tpl = null;
    if (template_id) {
      tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [template_id, tid])).rows[0];
    }

    const tplBody = tpl ? tpl.body : (body || '');
    const tplSubject = tpl ? tpl.subject : (subject || '');
    const renderVars = variables || {};

    const renderedSubject = renderTemplate(tplSubject, renderVars);
    const renderedBody = renderTemplate(tplBody, renderVars);

    // Track usage if using a stored template
    if (tpl) {
      await pool.query('UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW() WHERE id=$1 AND tenant_id=$2', [tpl.id, tid]);
    }

    res.json({
      success: true,
      rendered: {
        subject: renderedSubject,
        body: renderedBody,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
          ${renderedSubject ? `<h1 style="color:#1e293b;margin-bottom:16px">${esc(renderedSubject)}</h1>` : ''}
          <div style="white-space:pre-wrap;color:#334155;line-height:1.7">${esc(renderedBody)}</div>
        </div>`
      },
      template_id: tpl ? tpl.id : null,
      variables_used: renderVars
    });
  }));

  // ============================================================
  // ROUTE 15: POST /api/templates/:id/toggle — Toggle Active
  // ============================================================
  app.post('/api/templates/:id/toggle', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const tpl = (await pool.query('SELECT * FROM templates WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!tpl) return res.json({ success: false, error: 'Not found' });
    if (tpl.is_system) return res.json({ success: false, error: 'Cannot toggle system template' });

    const newActive = !tpl.is_active;
    await pool.query('UPDATE templates SET is_active=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [newActive, id, tid]);
    res.json({ success: true, is_active: newActive });
  }));

  console.log('[TemplateLibrary] Module loaded — template library with 10 system templates');
};
