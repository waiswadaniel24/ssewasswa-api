// ============================================================
// CERTIFICATE GENERATOR MODULE — Multi-Tenant SaaS Platform
// Templates, issue, batch-issue, print-ready layout, public
// verification, analytics. 13 routes, PostgreSQL-backed.
// ============================================================
// Usage in server.js:
//   const certificates = require('./certificates');
//   certificates(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS (declared outside module for hoisting)
// ============================================================
const { migrateQuery } = require('./db');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);

function generateCertNumber(tid) {
  const prefix = 'CERT';
  const ts = Date.now().toString(36).toUpperCase();
  const rand = require('crypto').randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${tid}-${ts}-${rand}`;
}

function certTypeBadge(type) {
  const map = {
    achievement: { bg: '#dbeafe', c: '#1d4ed8', icon: '🏆', label: 'Achievement' },
    completion: { bg: '#dcfce7', c: '#16a34a', icon: '🎓', label: 'Completion' },
    participation: { bg: '#fef3c7', c: '#b45309', icon: '🤝', label: 'Participation' },
    excellence: { bg: '#f3e8ff', c: '#7c3aed', icon: '⭐', label: 'Excellence' },
    attendance: { bg: '#ecfdf5', c: '#059669', icon: '📋', label: 'Attendance' },
    appreciation: { bg: '#fff7ed', c: '#ea580c', icon: '🙏', label: 'Appreciation' },
  };
  const s = map[type] || { bg: '#f1f5f9', c: '#64748b', icon: '📜', label: type || 'Certificate' };
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.icon} ${s.label}</span>`;
}

function verifiedBadge(isVerified) {
  if (isVerified) return `<span class="badge" style="background:#dcfce7;color:#16a34a">✓ Verified</span>`;
  return `<span class="badge" style="background:#fee2e2;color:#dc2626">✗ Revoked</span>`;
}

// ============================================================
// SHARED CSS
// ============================================================
const CERT_CSS = `<style>
  .cert-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
  .cert-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
  .cert-nav a:hover{background:#e2e8f0}.cert-nav a.active{background:#4f46e5;color:#fff}
  .cert-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .cert-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s;cursor:pointer}
  .cert-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);border-color:#c7d2fe}
  .cert-card.selected{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.15)}
  .cert-card-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px}
  .cert-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0}
  .cert-card-meta{display:flex;gap:14px;font-size:12px;color:#64748b;margin-bottom:12px}
  .cert-card-actions{display:flex;gap:6px;flex-wrap:wrap}
  .cert-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .cert-btn:hover{opacity:.9;transform:translateY(-1px)}
  .cert-btn-primary{background:#4f46e5;color:#fff}.cert-btn-success{background:#059669;color:#fff}
  .cert-btn-danger{background:#fee2e2;color:#dc2626}.cert-btn-gold{background:#f59e0b;color:#fff}
  .cert-btn-secondary{background:#f1f5f9;color:#475569}
  .cert-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
  .cert-form input,.cert-form select,.cert-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
  .cert-form input:focus,.cert-form select:focus,.cert-form textarea:focus{outline:none;border-color:#6366f1}
  .cert-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .cert-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
  .cert-table{width:100%;border-collapse:collapse;font-size:13px}
  .cert-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
  .cert-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.cert-table tr:hover{background:#f8fafc}

  /* Print-ready certificate */
  .cert-print{width:1056px;height:816px;position:relative;background:#fff;border-radius:4px;overflow:hidden;font-family:Georgia,'Times New Roman',serif}
  .cert-print-landscape{width:1056px;height:816px}
  .cert-print-portrait{width:816px;height:1056px}
  .cert-border{position:absolute;inset:12px;border:4px solid;border-radius:6px}
  .cert-inner-border{position:absolute;inset:20px;border:2px solid;opacity:.3;border-radius:4px}
  .cert-content{position:absolute;inset:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px}
  .cert-logo{width:80px;height:80px;border-radius:50%;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:36px;margin-bottom:16px}
  .cert-header-text{font-size:14px;text-transform:uppercase;letter-spacing:4px;color:#64748b;margin-bottom:8px;font-weight:600}
  .cert-title{font-size:36px;font-weight:700;color:#1e293b;margin-bottom:4px}
  .cert-recipient{font-size:42px;font-weight:700;margin:16px 0;color:#1e293b;font-style:italic}
  .cert-description{font-size:16px;color:#475569;max-width:600px;line-height:1.6;margin-bottom:16px}
  .cert-details{font-size:13px;color:#64748b;margin-bottom:24px}
  .cert-signature-area{display:flex;justify-content:space-between;width:100%;max-width:600px;margin-top:24px}
  .cert-signature-box{text-align:center;min-width:180px}
  .cert-signature-line{width:180px;height:1px;background:#1e293b;margin:8px auto 4px}
  .cert-signature-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px}
  .cert-verify-badge{position:absolute;bottom:32px;right:32px;font-size:10px;color:#94a3b8;text-align:center}
  .cert-verify-qr{width:50px;height:50px;border:1px solid #e2e8f0;border-radius:4px;margin-bottom:4px;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-size:8px;color:#94a3b8}
  .cert-ornament{font-size:24px;color:#e2e8f0;margin:8px 0}

  @media print{
    .cert-nav,.cert-btn,.no-print{display:none!important}
    .cert-print{border:none!important;box-shadow:none!important;margin:0!important}
    body{background:#fff!important}
  }
  @media(max-width:768px){.cert-grid,.cert-grid-3{grid-template-columns:1fr}.cert-cards{grid-template-columns:1fr}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function certificates(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="cert-nav">
    <a href="/certificates" class="${active === 'dash' ? 'active' : ''}">🏆 Dashboard</a>
    <a href="/certificates/templates" class="${active === 'templates' ? 'active' : ''}">🎨 Templates</a>
    <a href="/certificates/issue" class="${active === 'issue' ? 'active' : ''}">✏️ Issue</a>
    <a href="/certificates/issued" class="${active === 'issued' ? 'active' : ''}">📋 Issued</a>
    <a href="/certificates/report" class="${active === 'report' ? 'active' : ''}">📊 Report</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      // -- CREATE TABLES --------------------------------------------------
      await migrateQuery(pool, 'Certificates', `CREATE TABLE IF NOT EXISTS certificate_templates (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, description TEXT,
        border_color VARCHAR(20) DEFAULT '#4f46e5', background_color VARCHAR(20) DEFAULT '#ffffff',
        header_text VARCHAR(255) DEFAULT 'Certificate of Achievement',
        body_template TEXT, footer_text VARCHAR(255),
        orientation VARCHAR(10) DEFAULT 'landscape', font_size INTEGER DEFAULT 24,
        show_logo BOOLEAN DEFAULT true, show_signature BOOLEAN DEFAULT true,
        signature_line VARCHAR(255) DEFAULT 'Director',
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await migrateQuery(pool, 'Certificates', `CREATE TABLE IF NOT EXISTS certificates_issued (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        template_id INTEGER REFERENCES certificate_templates(id),
        recipient_name VARCHAR(255) NOT NULL, recipient_email VARCHAR(255),
        certificate_type VARCHAR(100), course VARCHAR(255),
        date_issued DATE DEFAULT CURRENT_DATE, certificate_number VARCHAR(50) UNIQUE,
        description TEXT, grade VARCHAR(20), issued_by INTEGER REFERENCES users(id),
        is_verified BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // -- ALTER TABLE IF EXISTS: certificate_templates --------------------
      const tplCols = [
        ['name', "VARCHAR(255) NOT NULL DEFAULT ''"], ['description', "TEXT"],
        ['border_color', "VARCHAR(20) DEFAULT '#4f46e5'"], ['background_color', "VARCHAR(20) DEFAULT '#ffffff'"],
        ['header_text', "VARCHAR(255) DEFAULT 'Certificate of Achievement'"], ['body_template', "TEXT"],
        ['footer_text', "VARCHAR(255)"], ['orientation', "VARCHAR(10) DEFAULT 'landscape'"],
        ['font_size', "INTEGER DEFAULT 24"], ['show_logo', "BOOLEAN DEFAULT true"],
        ['show_signature', "BOOLEAN DEFAULT true"], ['signature_line', "VARCHAR(255) DEFAULT 'Director'"],
        ['is_active', "BOOLEAN DEFAULT true"],
      ];
      for (const [col, def] of tplCols) {
        try { await migrateQuery(pool, 'Certificates', `ALTER TABLE certificate_templates ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // -- ALTER TABLE IF EXISTS: certificates_issued ----------------------
      const issCols = [
        ['template_id', "INTEGER REFERENCES certificate_templates(id)"],
        ['recipient_name', "VARCHAR(255) NOT NULL DEFAULT ''"], ['recipient_email', "VARCHAR(255)"],
        ['certificate_type', "VARCHAR(100)"], ['course', "VARCHAR(255)"],
        ['date_issued', "DATE DEFAULT CURRENT_DATE"], ['certificate_number', "VARCHAR(50) UNIQUE"],
        ['description', "TEXT"], ['grade', "VARCHAR(20)"], ['issued_by', "INTEGER REFERENCES users(id)"],
        ['is_verified', "BOOLEAN DEFAULT true"],
      ];
      for (const [col, def] of issCols) {
        try { await migrateQuery(pool, 'Certificates', `ALTER TABLE certificates_issued ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {}
      }

      // -- INDEXES ---------------------------------------------------------
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ct_tenant ON certificate_templates(tenant_id)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ct_active ON certificate_templates(tenant_id, is_active)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ci_tenant ON certificates_issued(tenant_id)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ci_cert_number ON certificates_issued(certificate_number)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ci_type ON certificates_issued(tenant_id, certificate_type)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ci_date ON certificates_issued(date_issued)`);
      await migrateQuery(pool, 'Certificates', `CREATE INDEX IF NOT EXISTS idx_ci_recipient ON certificates_issued(recipient_email)`);

      // -- SEED DEFAULT TEMPLATES ------------------------------------------
      const seedTemplates = [
        { name: 'Certificate of Achievement', header_text: 'Certificate of Achievement', border_color: '#4f46e5', body_template: 'This is to certify that {{recipient_name}} has demonstrated outstanding achievement in {{course}}.', description: 'For recognizing exceptional performance and accomplishment.' },
        { name: 'Certificate of Completion', header_text: 'Certificate of Completion', border_color: '#16a34a', body_template: 'This is to certify that {{recipient_name}} has successfully completed the course "{{course}}" on {{date}}.', description: 'For verifying successful course or program completion.' },
        { name: 'Certificate of Participation', header_text: 'Certificate of Participation', border_color: '#f59e0b', body_template: 'This is to certify that {{recipient_name}} actively participated in {{course}} held on {{date}}.', description: 'For acknowledging active participation in events or programs.' },
      ];

      for (const seed of seedTemplates) {
        await migrateQuery(pool, 'Certificates', `INSERT INTO certificate_templates (tenant_id, name, description, border_color, header_text, body_template, signature_line, is_active)
          VALUES (1, $1, $2, $3, $4, $5, 'Director', true)
          ON CONFLICT DO NOTHING`, [seed.name, seed.description, seed.border_color, seed.header_text, seed.body_template]);
      }

      console.log('[Certificates] Migrations & seeds applied successfully');
    } catch (e) { console.error('[Certificates] Migration error:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /certificates — Dashboard
  // ============================================================
  app.get('/certificates', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const totalIssued = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalTemplates = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificate_templates WHERE tenant_id=$1 AND is_active=true`, [tid])).rows[0].cnt;
    const verifiedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 AND is_verified=true`, [tid])).rows[0].cnt;
    const revokedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 AND is_verified=false`, [tid])).rows[0].cnt;
    const thisMonth = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 AND date_issued >= date_trunc('month', CURRENT_DATE)`, [tid])).rows[0].cnt;

    const recentCerts = (await pool.query(
      `SELECT ci.*, ct.name as template_name, u.name as issuer_name
       FROM certificates_issued ci
       LEFT JOIN certificate_templates ct ON ct.id = ci.template_id
       LEFT JOIN users u ON u.id = ci.issued_by
       WHERE ci.tenant_id=$1 ORDER BY ci.created_at DESC LIMIT 8`, [tid]
    )).rows;

    const recentHtml = recentCerts.map(c => `<tr>
      <td><a href="/certificates/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.recipient_name)}</a></td>
      <td>${certTypeBadge(c.certificate_type)}</td>
      <td>${esc(c.template_name || '—')}</td>
      <td>${verifiedBadge(c.is_verified)}</td>
      <td class="muted">${fmtDateShort(c.date_issued)}</td>
    </tr>`).join('');

    const templates = (await pool.query(`SELECT * FROM certificate_templates WHERE tenant_id=$1 AND is_active=true ORDER BY name LIMIT 4`, [tid])).rows;
    const tplCards = templates.map(t => `<div class="cert-card" onclick="location.href='/certificates/templates'">
      <div style="width:100%;height:6px;border-radius:3px;background:${esc(t.border_color)};margin-bottom:12px"></div>
      <div class="cert-card-title">${esc(t.name)}</div>
      <div class="cert-card-meta"><span>${t.orientation || 'landscape'}</span><span>${t.font_size || 24}px</span></div>
    </div>`).join('');

    const html = CERT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🏆 Certificate Generator</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Create, issue, and verify professional certificates</p></div>
        <div style="display:flex;gap:8px">
          <a href="/certificates/issue" class="cert-btn cert-btn-primary">✏️ Issue Certificate</a>
          <a href="/certificates/templates/new" class="cert-btn cert-btn-secondary">🎨 New Template</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalIssued}</div><div class="muted" style="font-size:11px">Total Issued</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${verifiedCount}</div><div class="muted" style="font-size:11px">Verified</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${thisMonth}</div><div class="muted" style="font-size:11px">This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${totalTemplates}</div><div class="muted" style="font-size:11px">Templates</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${revokedCount}</div><div class="muted" style="font-size:11px">Revoked</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">🎨 Templates</h3>
            <a href="/certificates/templates" class="cert-btn cert-btn-secondary" style="padding:4px 12px;font-size:11px">View All →</a>
          </div>
          <div class="cert-cards">${tplCards || '<p class="muted" style="font-size:13px;grid-column:1/-1;text-align:center;padding:20px">No templates yet. <a href="/certificates/templates/new" style="color:#4f46e5">Create one</a></p>'}</div>
        </div>
        <div class="card" style="padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">📋 Recent Certificates</h3>
            <a href="/certificates/issued" class="cert-btn cert-btn-secondary" style="padding:4px 12px;font-size:11px">View All →</a>
          </div>
          <div style="overflow-x:auto"><table class="cert-table">
            <thead><tr><th>Recipient</th><th>Type</th><th>Template</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No certificates issued yet</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /certificates/templates — Template Gallery
  // ============================================================
  app.get('/certificates/templates', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const templates = (await pool.query(
      `SELECT ct.*, (SELECT COUNT(*)::int FROM certificates_issued ci WHERE ci.template_id = ct.id) as issued_count
       FROM certificate_templates ct WHERE ct.tenant_id=$1 ORDER BY ct.is_active DESC, ct.name`, [tid]
    )).rows;

    const cards = templates.map(t => `<div class="cert-card">
      <div class="cert-card-header">
        <div class="cert-card-title">${esc(t.name)}</div>
        <div>${t.is_active ? '<span class="badge" style="background:#dcfce7;color:#16a34a">Active</span>' : '<span class="badge" style="background:#fee2e2;color:#dc2626">Inactive</span>'}</div>
      </div>
      <p class="muted" style="font-size:12px;margin-bottom:10px">${esc(t.description || 'No description')}</p>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <div style="width:24px;height:24px;border-radius:4px;background:${esc(t.border_color)};border:1px solid #e2e8f0"></div>
        <span class="muted" style="font-size:11px">${t.orientation || 'landscape'} · ${t.font_size || 24}px</span>
      </div>
      <div class="cert-card-meta">
        <span>📋 ${t.issued_count} issued</span>
        <span>📅 ${fmtDateShort(t.created_at)}</span>
      </div>
      <div class="cert-card-actions" style="margin-top:12px">
        <a href="/certificates/issue?template=${t.id}" class="cert-btn cert-btn-primary" style="padding:5px 12px;font-size:11px">✏️ Issue</a>
        <a href="/certificates/issue?template=${t.id}" class="cert-btn cert-btn-secondary" style="padding:5px 12px;font-size:11px">📋 Details</a>
      </div>
    </div>`).join('');

    const html = CERT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('templates')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🎨 Certificate Templates</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Design and manage certificate layouts</p></div>
        <a href="/certificates/templates/new" class="cert-btn cert-btn-primary">+ New Template</a>
      </div>
      <div class="cert-cards">${cards || '<p class="muted" style="font-size:14px;grid-column:1/-1;text-align:center;padding:40px">No templates found. <a href="/certificates/templates/new" style="color:#4f46e5">Create your first template</a></p>'}</div>
    </div>`;
    res.send(renderPage('Certificate Templates', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /certificates/templates/new — Create Template
  // ============================================================
  app.get('/certificates/templates/new', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user;
    const html = CERT_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('templates')}
      <a href="/certificates/templates" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Templates</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">🎨 Create Certificate Template</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Design a professional certificate layout</p>
        <form method="POST" action="/certificates/templates/create" class="cert-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Template Name *</label>
            <input type="text" name="name" required placeholder="e.g., Certificate of Excellence"></div>
          <div><label>Description</label>
            <textarea name="description" rows="2" placeholder="Brief description of this template..."></textarea></div>
          <div class="cert-grid-3">
            <div><label>Border Color</label>
              <input type="color" name="border_color" value="#4f46e5" style="height:42px;padding:4px;cursor:pointer"></div>
            <div><label>Background Color</label>
              <input type="color" name="background_color" value="#ffffff" style="height:42px;padding:4px;cursor:pointer"></div>
            <div><label>Font Size (px)</label>
              <input type="number" name="font_size" value="24" min="12" max="48"></div>
          </div>
          <div class="cert-grid">
            <div><label>Orientation</label>
              <select name="orientation"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></div>
            <div><label>Signature Line</label>
              <input type="text" name="signature_line" value="Director" placeholder="e.g., Director, Principal"></div>
          </div>
          <div><label>Header Text *</label>
            <input type="text" name="header_text" value="Certificate of Achievement" required></div>
          <div><label>Body Template</label>
            <textarea name="body_template" rows="3" placeholder="Use {{recipient_name}}, {{course}}, {{date}} as placeholders...">This is to certify that {{recipient_name}} has demonstrated outstanding achievement in {{course}}.</textarea></div>
          <div><label>Footer Text</label>
            <input type="text" name="footer_text" placeholder="Optional footer message"></div>
          <div style="display:flex;gap:16px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer">
              <input type="checkbox" name="show_logo" value="true" checked style="width:18px;height:18px;accent-color:#4f46e5"> Show Logo</label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#475569;cursor:pointer">
              <input type="checkbox" name="show_signature" value="true" checked style="width:18px;height:18px;accent-color:#4f46e5"> Show Signature</label>
          </div>
          <button type="submit" class="cert-btn cert-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🚀 Create Template</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Certificate Template', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /certificates/templates/create — Save Template
  // ============================================================
  app.post('/certificates/templates/create', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, border_color, background_color, header_text, body_template, footer_text,
            orientation, font_size, show_logo, show_signature, signature_line } = req.body;
    if (!name || !name.trim()) return res.redirect('/certificates/templates/new');

    await pool.query(
      `INSERT INTO certificate_templates (tenant_id, name, description, border_color, background_color,
        header_text, body_template, footer_text, orientation, font_size, show_logo, show_signature, signature_line)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tid, name.trim(), description || null, border_color || '#4f46e5', background_color || '#ffffff',
       header_text || 'Certificate of Achievement', body_template || null, footer_text || null,
       orientation || 'landscape', parseInt(font_size) || 24,
       show_logo === 'true', show_signature === 'true', signature_line || 'Director']
    );
    req.session.flash = { type: 'success', msg: `Template "${name.trim()}" created successfully` };
    res.redirect('/certificates/templates');
  }));

  // ============================================================
  // ROUTE 5: GET /certificates/issue — Issue Certificate Form
  // ============================================================
  app.get('/certificates/issue', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const preselected = req.query.template || '';
    const templates = (await pool.query(`SELECT * FROM certificate_templates WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;

    const tplOptions = templates.map(t => `<option value="${t.id}" ${preselected == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

    const html = CERT_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('issue')}
      <a href="/certificates" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Issue Certificate</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Create and issue a new certificate</p>
        <form method="POST" action="/certificates/issue/save" class="cert-form" style="display:flex;flex-direction:column;gap:16px">
          <div class="cert-grid">
            <div><label>Template *</label>
              <select name="template_id" required><option value="">Select template...</option>${tplOptions}</select></div>
            <div><label>Certificate Type</label>
              <select name="certificate_type">
                <option value="achievement">🏆 Achievement</option><option value="completion">🎓 Completion</option>
                <option value="participation">🤝 Participation</option><option value="excellence">⭐ Excellence</option>
                <option value="attendance">📋 Attendance</option><option value="appreciation">🙏 Appreciation</option>
              </select></div>
          </div>
          <div class="cert-grid">
            <div><label>Recipient Name *</label>
              <input type="text" name="recipient_name" required placeholder="Full name of recipient"></div>
            <div><label>Recipient Email</label>
              <input type="email" name="recipient_email" placeholder="email@example.com"></div>
          </div>
          <div class="cert-grid">
            <div><label>Course / Program</label>
              <input type="text" name="course" placeholder="e.g., Advanced Web Development"></div>
            <div><label>Grade</label>
              <select name="grade"><option value="">No grade</option><option value="A+">A+</option><option value="A">A</option><option value="B+">B+</option><option value="B">B</option><option value="C">C</option><option value="Pass">Pass</option></select></div>
          </div>
          <div><label>Description</label>
            <textarea name="description" rows="2" placeholder="Additional details about this certificate..."></textarea></div>
          <div><label>Date Issued</label>
            <input type="date" name="date_issued" value="${today()}"></div>
          <button type="submit" class="cert-btn cert-btn-gold" style="padding:14px 28px;font-size:15px;justify-content:center">📜 Issue Certificate</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Issue Certificate', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /certificates/issue/save — Issue Certificate
  // ============================================================
  app.post('/certificates/issue/save', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { template_id, recipient_name, recipient_email, certificate_type, course, date_issued, description, grade } = req.body;
    if (!recipient_name || !recipient_name.trim()) {
      req.session.flash = { type: 'error', msg: 'Recipient name is required' };
      return res.redirect('/certificates/issue');
    }

    // Generate unique certificate number
    let certNumber;
    let attempts = 0;
    do {
      certNumber = generateCertNumber(tid);
      const existing = (await pool.query(`SELECT 1 FROM certificates_issued WHERE certificate_number=$1`, [certNumber])).rows[0];
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    const result = await pool.query(
      `INSERT INTO certificates_issued (tenant_id, template_id, recipient_name, recipient_email,
        certificate_type, course, date_issued, certificate_number, description, grade, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tid, template_id || null, recipient_name.trim(), recipient_email || null,
       certificate_type || 'achievement', course || null, date_issued || today(),
       certNumber, description || null, grade || null, user.id]
    );
    req.session.flash = { type: 'success', msg: `Certificate issued to ${recipient_name.trim()} (${certNumber})` };
    res.redirect('/certificates/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 7: POST /certificates/batch-issue — Batch Issue
  // ============================================================
  app.post('/certificates/batch-issue', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { template_id, certificate_type, course, date_issued, recipients_text } = req.body;
    if (!recipients_text || !recipients_text.trim()) {
      req.session.flash = { type: 'error', msg: 'Recipients list is empty' };
      return res.redirect('/certificates/issue');
    }

    // Parse recipients: one per line, format "Name" or "Name, email"
    const lines = recipients_text.trim().split('\n').map(l => l.trim()).filter(Boolean);
    let issued = 0;
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      const name = parts[0];
      const email = parts[1] || null;
      if (!name) continue;

      let certNumber;
      let attempts = 0;
      do {
        certNumber = generateCertNumber(tid);
        const existing = (await pool.query(`SELECT 1 FROM certificates_issued WHERE certificate_number=$1`, [certNumber])).rows[0];
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      try {
        await pool.query(
          `INSERT INTO certificates_issued (tenant_id, template_id, recipient_name, recipient_email,
            certificate_type, course, date_issued, certificate_number, issued_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tid, template_id || null, name, email, certificate_type || 'achievement',
           course || null, date_issued || today(), certNumber, user.id]
        );
        issued++;
      } catch (e) { /* skip duplicates */ }
    }
    req.session.flash = { type: 'success', msg: `Batch issued ${issued} certificate${issued !== 1 ? 's' : ''} successfully` };
    res.redirect('/certificates/issued');
  }));

  // ============================================================
  // ROUTE 8: GET /certificates/:id — View Certificate (Print-Ready)
  // ============================================================
  app.get('/certificates/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, certId = req.params.id;
    const cert = (await pool.query(
      `SELECT ci.*, ct.name as template_name, ct.border_color, ct.background_color, ct.header_text,
              ct.body_template, ct.footer_text, ct.orientation, ct.font_size, ct.show_logo, ct.show_signature,
              ct.signature_line, u.name as issuer_name
       FROM certificates_issued ci
       LEFT JOIN certificate_templates ct ON ct.id = ci.template_id
       LEFT JOIN users u ON u.id = ci.issued_by
       WHERE ci.id=$1 AND ci.tenant_id=$2`, [certId, tid]
    )).rows[0];
    if (!cert) {
      return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Certificate not found</h2><a href="/certificates" class="btn btn-blue btn-sm" style="margin-top:12px">← Back</a></div>', user, req));
    }

    const borderColor = cert.border_color || '#4f46e5';
    const bgColor = cert.background_color || '#ffffff';
    const headerText = cert.header_text || 'Certificate of Achievement';
    const fontSize = cert.font_size || 24;
    const orient = cert.orientation || 'landscape';
    const sigLine = cert.signature_line || 'Director';
    const bodyText = (cert.body_template || 'This is to certify that {{recipient_name}} has successfully completed the requirements.')
      .replace(/\{\{recipient_name\}\}/g, esc(cert.recipient_name))
      .replace(/\{\{course\}\}/g, esc(cert.course || 'the program'))
      .replace(/\{\{date\}\}/g, fmtDate(cert.date_issued))
      .replace(/\{\{grade\}\}/g, esc(cert.grade || ''));

    const printHtml = `<div class="cert-print cert-print-${orient}" style="background:${bgColor};margin:0 auto" id="cert-print">
      <div class="cert-border" style="border-color:${borderColor}"></div>
      <div class="cert-inner-border" style="border-color:${borderColor}"></div>
      <div class="cert-content">
        ${cert.show_logo ? '<div class="cert-logo">🏛️</div>' : ''}
        <div class="cert-header-text" style="font-size:${Math.round(fontSize * 0.55)}px">${esc(headerText).toUpperCase()}</div>
        <div class="cert-ornament">❧ ✦ ❧</div>
        <div class="cert-recipient" style="font-size:${Math.round(fontSize * 1.8)}px;color:${borderColor}">${esc(cert.recipient_name)}</div>
        <div class="cert-description" style="font-size:${Math.round(fontSize * 0.7)}px">${bodyText}</div>
        ${cert.course ? `<div style="font-size:${Math.round(fontSize * 0.6)}px;color:#475569;margin-bottom:8px"><strong>Course:</strong> ${esc(cert.course)}</div>` : ''}
        ${cert.grade ? `<div style="font-size:${Math.round(fontSize * 0.6)}px;color:#475569;margin-bottom:8px"><strong>Grade:</strong> ${esc(cert.grade)}</div>` : ''}
        <div class="cert-details" style="font-size:${Math.round(fontSize * 0.5)}px">Issued on ${fmtDate(cert.date_issued)} ${cert.certificate_type ? '· ' + cert.certificate_type.charAt(0).toUpperCase() + cert.certificate_type.slice(1) : ''}</div>
        ${cert.show_signature ? `<div class="cert-signature-area">
          <div class="cert-signature-box">
            <div style="font-style:italic;font-size:18px;color:#1e293b">${esc(user.name || 'Administrator')}</div>
            <div class="cert-signature-line"></div>
            <div class="cert-signature-label">${esc(sigLine)}</div>
          </div>
          <div class="cert-signature-box">
            <div style="font-style:italic;font-size:18px;color:#1e293b">${esc(cert.issuer_name || user.name || 'Administrator')}</div>
            <div class="cert-signature-line"></div>
            <div class="cert-signature-label">${esc(sigLine)}</div>
          </div>
        </div>` : ''}
        ${cert.footer_text ? `<div style="margin-top:16px;font-size:11px;color:#94a3b8">${esc(cert.footer_text)}</div>` : ''}
      </div>
      <div class="cert-verify-badge">
        <div class="cert-verify-qr">QR</div>
        <div>Verify at<br><strong>/certificates/verify/${esc(cert.certificate_number)}</strong></div>
      </div>
    </div>`;

    const html = CERT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('')}
      <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><a href="/certificates" style="color:#64748b;font-size:14px;text-decoration:none">← Dashboard</a>
          <h1 style="font-size:22px;color:#1e293b;margin:4px 0 0">📜 ${esc(cert.recipient_name)}</h1>
          <p class="muted" style="font-size:12px;margin-top:2px">${esc(cert.certificate_number)} · ${verifiedBadge(cert.is_verified)} · ${fmtDate(cert.date_issued)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="window.print()" class="cert-btn cert-btn-primary">🖨️ Print Certificate</button>
          <a href="/certificates/verify/${esc(cert.certificate_number)}" target="_blank" class="cert-btn cert-btn-secondary">🔗 Verification Link</a>
          ${cert.is_verified ? `<form method="POST" action="/certificates/${cert.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this certificate?')"><button class="cert-btn cert-btn-danger">Revoke</button></form>` : ''}
        </div>
      </div>
      <div style="overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:20px">
        ${printHtml}
      </div>
    </div>`;
    res.send(renderPage('Certificate — ' + cert.recipient_name, html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /certificates/verify/:number — Public Verification
  // ============================================================
  app.get('/certificates/verify/:number', ah(async (req, res) => {
    const certNumber = req.params.number;
    const cert = (await pool.query(
      `SELECT ci.*, ct.name as template_name, ct.header_text, u.name as issuer_name
       FROM certificates_issued ci
       LEFT JOIN certificate_templates ct ON ct.id = ci.template_id
       LEFT JOIN users u ON u.id = ci.issued_by
       WHERE ci.certificate_number=$1`, [certNumber]
    )).rows[0];

    let content;
    if (!cert) {
      content = `<div style="max-width:500px;margin:0 auto;text-align:center;padding:60px 20px">
        <div style="font-size:64px;margin-bottom:16px">❌</div>
        <h2 style="color:#dc2626;font-size:22px;margin-bottom:8px">Certificate Not Found</h2>
        <p class="muted" style="font-size:14px">The certificate number <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px">${esc(certNumber)}</code> does not match any issued certificate.</p>
        <p class="muted" style="font-size:12px;margin-top:12px">This may be an invalid or forged certificate number.</p>
      </div>`;
    } else if (!cert.is_verified) {
      content = `<div style="max-width:500px;margin:0 auto;text-align:center;padding:60px 20px">
        <div style="font-size:64px;margin-bottom:16px">⚠️</div>
        <h2 style="color:#dc2626;font-size:22px;margin-bottom:8px">Certificate Revoked</h2>
        <p class="muted" style="font-size:14px">This certificate issued to <strong>${esc(cert.recipient_name)}</strong> has been revoked and is no longer valid.</p>
        <div class="card" style="margin-top:20px;text-align:left;padding:20px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="muted">Certificate Number</span><strong>${esc(cert.certificate_number)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="muted">Recipient</span><strong>${esc(cert.recipient_name)}</strong></div>
          <div style="display:flex;justify-content:space-between"><span class="muted">Issued Date</span><strong>${fmtDate(cert.date_issued)}</strong></div>
        </div>
      </div>`;
    } else {
      content = `<div style="max-width:600px;margin:0 auto;text-align:center;padding:40px 20px">
        <div style="font-size:64px;margin-bottom:16px">✅</div>
        <h2 style="color:#16a34a;font-size:22px;margin-bottom:8px">Certificate Verified</h2>
        <p class="muted" style="font-size:14px;margin-bottom:20px">This is an authentic, valid certificate.</p>
        <div class="card" style="text-align:left;padding:24px">
          <div style="margin-bottom:16px">
            <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Recipient</div>
            <div style="font-size:20px;font-weight:700;color:#1e293b">${esc(cert.recipient_name)}</div>
            ${cert.recipient_email ? `<div class="muted" style="font-size:12px">${esc(cert.recipient_email)}</div>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Certificate Number</div><strong style="font-size:13px">${esc(cert.certificate_number)}</strong></div>
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Type</div>${certTypeBadge(cert.certificate_type)}</div>
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Course</div><strong style="font-size:13px">${esc(cert.course || '—')}</strong></div>
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Date Issued</div><strong style="font-size:13px">${fmtDate(cert.date_issued)}</strong></div>
            ${cert.grade ? `<div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Grade</div><strong style="font-size:13px">${esc(cert.grade)}</strong></div>` : ''}
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Template</div><strong style="font-size:13px">${esc(cert.template_name || '—')}</strong></div>
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Issued By</div><strong style="font-size:13px">${esc(cert.issuer_name || '—')}</strong></div>
            <div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px">Status</div>${verifiedBadge(cert.is_verified)}</div>
          </div>
          ${cert.description ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #f1f5f9"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Description</div><p style="font-size:13px;color:#475569;margin:0">${esc(cert.description)}</p></div>` : ''}
        </div>
        <p class="muted" style="font-size:11px;margin-top:20px">Verified on ${fmtDateTime(new Date())}</p>
      </div>`;
    }

    const html = CERT_CSS + content;
    res.send(renderPage('Certificate Verification', html, null, req));
  }));

  // ============================================================
  // ROUTE 10: GET /certificates/issued — List All Issued
  // ============================================================
  app.get('/certificates/issued', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { type, search, status } = req.query;

    let where = ['ci.tenant_id=$1'], params = [tid], pi = 2;
    if (type) { where.push(`ci.certificate_type=$${pi++}`); params.push(type); }
    if (status === 'verified') { where.push(`ci.is_verified=true`); }
    else if (status === 'revoked') { where.push(`ci.is_verified=false`); }
    if (search) { where.push(`(ci.recipient_name ILIKE $${pi} OR ci.certificate_number ILIKE $${pi} OR ci.recipient_email ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const certs = (await pool.query(
      `SELECT ci.*, ct.name as template_name, ct.border_color, u.name as issuer_name
       FROM certificates_issued ci
       LEFT JOIN certificate_templates ct ON ct.id = ci.template_id
       LEFT JOIN users u ON u.id = ci.issued_by
       WHERE ${where.join(' AND ')} ORDER BY ci.created_at DESC LIMIT 200`, params
    )).rows;

    const rows = certs.map(c => `<tr>
      <td><a href="/certificates/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.recipient_name)}</a>
        ${c.recipient_email ? `<br><span class="muted" style="font-size:11px">${esc(c.recipient_email)}</span>` : ''}</td>
      <td>${certTypeBadge(c.certificate_type)}</td>
      <td>${esc(c.course || '—')}</td>
      <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:11px">${esc(c.certificate_number || '—')}</code></td>
      <td>${verifiedBadge(c.is_verified)}</td>
      <td>${esc(c.grade || '—')}</td>
      <td class="muted">${fmtDateShort(c.date_issued)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="/certificates/${c.id}" class="btn btn-blue btn-sm" style="padding:3px 8px;font-size:10px">View</a>
          <a href="/certificates/verify/${esc(c.certificate_number)}" target="_blank" class="btn btn-sm" style="padding:3px 8px;font-size:10px;background:#f1f5f9;color:#475569">Verify</a>
          ${c.is_verified ? `<form method="POST" action="/certificates/${c.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this certificate?')"><button class="btn btn-red btn-sm" style="padding:3px 8px;font-size:10px">Revoke</button></form>` : ''}
        </div>
      </td>
    </tr>`).join('');

    const html = CERT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('issued')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Issued Certificates</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${certs.length} certificate${certs.length !== 1 ? 's' : ''} found</p></div>
        <a href="/certificates/issue" class="cert-btn cert-btn-primary">✏️ Issue New</a>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end">
        <div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Search</label>
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Name, email, or cert number..." style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;width:240px" id="search-input"></div>
        <div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Type</label>
          <select onchange="location.href='/certificates/issued?${status ? 'status=' + status + '&' : ''}type='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="">All Types</option><option value="achievement" ${type==='achievement'?'selected':''}>Achievement</option>
            <option value="completion" ${type==='completion'?'selected':''}>Completion</option><option value="participation" ${type==='participation'?'selected':''}>Participation</option>
            <option value="excellence" ${type==='excellence'?'selected':''}>Excellence</option><option value="attendance" ${type==='attendance'?'selected':''}>Attendance</option>
          </select></div>
        <div><label style="display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px">Status</label>
          <select onchange="location.href='/certificates/issued?${type ? 'type=' + type + '&' : ''}status='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <option value="">All</option><option value="verified" ${status==='verified'?'selected':''}>Verified</option><option value="revoked" ${status==='revoked'?'selected':''}>Revoked</option>
          </select></div>
        <button class="btn btn-sm" style="padding:8px 14px" onclick="location.href='/certificates/issued'">Clear</button>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="cert-table">
        <thead><tr><th>Recipient</th><th>Type</th><th>Course</th><th>Cert Number</th><th>Status</th><th>Grade</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No certificates found</td></tr>'}</tbody>
      </table></div></div>
    </div>
    <script>document.getElementById('search-input').addEventListener('keydown', function(e){if(e.key==='Enter') location.href='/certificates/issued?search='+encodeURIComponent(this.value)});</script>`;
    res.send(renderPage('Issued Certificates', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: DELETE /certificates/:id — Revoke/Delete Certificate
  // ============================================================
  app.delete('/certificates/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id, certId = req.params.id;
    const cert = (await pool.query(`SELECT * FROM certificates_issued WHERE id=$1 AND tenant_id=$2`, [certId, tid])).rows[0];
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    await pool.query(`UPDATE certificates_issued SET is_verified=false WHERE id=$1 AND tenant_id=$2`, [certId, tid]);
    res.json({ success: true, message: 'Certificate revoked' });
  }));

  // Revoke via POST (for HTML forms)
  app.post('/certificates/:id/revoke', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id, certId = req.params.id;
    await pool.query(`UPDATE certificates_issued SET is_verified=false WHERE id=$1 AND tenant_id=$2`, [certId, tid]);
    req.session.flash = { type: 'success', msg: 'Certificate revoked successfully' };
    res.redirect('/certificates/' + certId);
  }));

  // ============================================================
  // ROUTE 12: GET /certificates/report — Analytics
  // ============================================================
  app.get('/certificates/report', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Overall stats
    const totalIssued = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const activeCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 AND is_verified=true`, [tid])).rows[0].cnt;
    const revokedCount = totalIssued - activeCount;

    // By type
    const byType = (await pool.query(
      `SELECT certificate_type, COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 GROUP BY certificate_type ORDER BY cnt DESC`, [tid]
    )).rows;

    // Monthly trends (last 12 months)
    const monthly = (await pool.query(
      `SELECT to_char(date_issued, 'YYYY-MM') as month, COUNT(*)::int as cnt
       FROM certificates_issued WHERE tenant_id=$1 AND date_issued >= date_trunc('month', CURRENT_DATE) - interval '11 months'
       GROUP BY to_char(date_issued, 'YYYY-MM') ORDER BY month`, [tid]
    )).rows;

    const maxMonthly = monthly.length ? Math.max(...monthly.map(m => m.cnt)) : 1;

    const typeHtml = byType.map(t => {
      const pct = totalIssued > 0 ? Math.round((t.cnt / totalIssued) * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${certTypeBadge(t.certificate_type)}
        <div style="flex:1"><div style="background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#4f46e5;border-radius:6px"></div></div></div>
        <span style="font-size:13px;font-weight:700;color:#1e293b;min-width:50px;text-align:right">${t.cnt}</span>
        <span class="muted" style="font-size:11px;min-width:36px">${pct}%</span>
      </div>`;
    }).join('');

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const barHtml = monthly.map(m => {
      const [yr, mo] = m.month.split('-');
      const label = monthNames[parseInt(mo) - 1] + ' ' + yr.slice(2);
      const barPct = Math.round((m.cnt / maxMonthly) * 100);
      return `<div style="text-align:center;flex:1;min-width:40px">
        <div style="height:${Math.max(4, barPct * 1.2)}px;background:linear-gradient(180deg,#4f46e5,#818cf8);border-radius:4px 4px 0 0;margin:0 auto;width:80%;max-width:40px;transition:.3s" title="${m.cnt} certificates"></div>
        <div style="font-size:10px;color:#64748b;margin-top:4px">${label}</div>
        <div style="font-size:11px;font-weight:700;color:#1e293b">${m.cnt}</div>
      </div>`;
    }).join('');

    // Top courses
    const topCourses = (await pool.query(
      `SELECT course, COUNT(*)::int as cnt FROM certificates_issued WHERE tenant_id=$1 AND course IS NOT NULL AND course != '' GROUP BY course ORDER BY cnt DESC LIMIT 8`, [tid]
    )).rows;

    const courseHtml = topCourses.map((c, i) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="font-size:12px;font-weight:700;color:#94a3b8;min-width:20px">#${i + 1}</span>
      <span style="flex:1;font-size:13px;color:#1e293b">${esc(c.course)}</span>
      <span style="font-size:13px;font-weight:700;color:#4f46e5">${c.cnt}</span>
    </div>`).join('');

    const html = CERT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('report')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📊 Certificate Analytics</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Track certificate issuance trends and statistics</p>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalIssued}</div><div class="muted" style="font-size:11px">Total Issued</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${activeCount}</div><div class="muted" style="font-size:11px">Active / Verified</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${revokedCount}</div><div class="muted" style="font-size:11px">Revoked</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${byType.length}</div><div class="muted" style="font-size:11px">Certificate Types</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${topCourses.length}</div><div class="muted" style="font-size:11px">Unique Courses</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">By Certificate Type</h3>
          ${typeHtml || '<p class="muted" style="font-size:13px">No data available</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Top Courses</h3>
          ${courseHtml || '<p class="muted" style="font-size:13px">No course data available</p>'}
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Monthly Issuance Trend (Last 12 Months)</h3>
        <div style="display:flex;align-items:end;gap:4px;height:200px;padding-bottom:4px;border-bottom:2px solid #e2e8f0">
          ${barHtml || '<p class="muted" style="font-size:13px;margin:auto">No data for this period</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Certificate Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /api/certificates/verify/:number — JSON API
  // ============================================================
  app.get('/api/certificates/verify/:number', ah(async (req, res) => {
    const certNumber = req.params.number;
    if (!certNumber) return res.status(400).json({ valid: false, error: 'Certificate number is required' });

    const cert = (await pool.query(
      `SELECT ci.id, ci.certificate_number, ci.recipient_name, ci.recipient_email,
              ci.certificate_type, ci.course, ci.date_issued, ci.grade, ci.description,
              ci.is_verified, ci.created_at,
              ct.name as template_name, u.name as issuer_name
       FROM certificates_issued ci
       LEFT JOIN certificate_templates ct ON ct.id = ci.template_id
       LEFT JOIN users u ON u.id = ci.issued_by
       WHERE ci.certificate_number=$1`, [certNumber]
    )).rows[0];

    if (!cert) {
      return res.json({ valid: false, verified: false, error: 'Certificate not found', certificate_number: certNumber });
    }

    res.json({
      valid: true,
      verified: cert.is_verified,
      certificate_number: cert.certificate_number,
      recipient: { name: cert.recipient_name, email: cert.recipient_email },
      certificate_type: cert.certificate_type,
      course: cert.course,
      date_issued: cert.date_issued,
      grade: cert.grade,
      description: cert.description,
      template: cert.template_name,
      issued_by: cert.issuer_name,
      created_at: cert.created_at,
    });
  }));

  console.log('[Certificates] Certificate generator loaded');
};
