/**
 * GDPR / Privacy Compliance Center — School SaaS Portal
 * Features: data export, account deletion (right to be forgotten),
 * consent management, cookie audit, compliance reports, retention policies.
 *
 * Usage: gdprModule(app, pool, { esc, renderPage, ah, requireAuth, audit });
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  /* ── Helpers ────────────────────────────────────────────────── */
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const isAdmin = (req) => req.session?.user?.role === 'admin';

  /* ── Inline CSS ─────────────────────────────────────────────── */
  const CSS = `
  .gdpr-wrap{max-width:980px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,sans-serif;color:#1e293b}
  .gdpr-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .gdpr-h1{font-size:1.75rem;font-weight:700;margin:0 0 4px}.gdpr-h2{font-size:1.2rem;font-weight:600;margin:0 0 12px}
  .gdpr-h3{font-size:1rem;font-weight:600;margin:16px 0 8px}.gdpr-p{color:#64748b;margin:0 0 20px;font-size:.95rem}
  .gdpr-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600;text-transform:capitalize}
  .badge-ok{background:#dcfce7;color:#166534}.badge-warn{background:#fef9c3;color:#854d0e}.badge-err{background:#fee2e2;color:#991b1b}
  .gdpr-btn{display:inline-block;padding:9px 20px;border-radius:8px;font-size:.875rem;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:background .15s}
  .gdpr-btn-primary{background:#4f46e5;color:#fff}.gdpr-btn-primary:hover{background:#4338ca}
  .gdpr-btn-outline{background:transparent;border:1px solid #4f46e5;color:#4f46e5}.gdpr-btn-outline:hover{background:#eef2ff}
  .gdpr-btn-danger{background:#dc2626;color:#fff}.gdpr-btn-danger:hover{background:#b91c1c}
  .gdpr-btn-success{background:#16a34a;color:#fff}.gdpr-btn-success:hover{background:#15803d}
  .gdpr-btn-sm{padding:6px 14px;font-size:.8rem}
  .gdpr-table{width:100%;border-collapse:collapse;font-size:.875rem}
  .gdpr-table th{text-align:left;padding:10px 12px;border-bottom:2px solid #e2e8f0;font-weight:600;color:#475569;background:#f8fafc}
  .gdpr-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9}.gdpr-table tr:hover{background:#f8fafc}
  .gdpr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
  .gdpr-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .gdpr-stat{text-align:center;padding:20px}.gdpr-stat .num{font-size:2rem;font-weight:700;color:#4f46e5}.gdpr-stat .lbl{font-size:.8rem;color:#64748b;margin-top:4px}
  .gdpr-gauge{width:180px;height:180px;border-radius:50%;background:conic-gradient(#4f46e5 var(--pct,0%),#e2e8f0 0%);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
  .gdpr-gauge-inner{width:140px;height:140px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:#4f46e5}
  .gdpr-form label{display:block;font-weight:600;margin-bottom:4px;font-size:.875rem}
  .gdpr-form input,.gdpr-form select,.gdpr-form textarea{width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:.875rem;margin-bottom:14px;box-sizing:border-box;background:#fff}
  .gdpr-form textarea{min-height:80px;resize:vertical}
  .gdpr-tabs{display:flex;gap:2px;margin-bottom:20px;border-bottom:2px solid #e2e8f0;overflow-x:auto}
  .gdpr-tab{padding:10px 16px;cursor:pointer;font-size:.85rem;font-weight:600;color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;text-decoration:none;white-space:nowrap}
  .gdpr-tab:hover{color:#4f46e5}.gdpr-tab.active{color:#4f46e5;border-bottom-color:#4f46e5}
  .gdpr-timeline{position:relative;padding-left:28px;margin:16px 0}.gdpr-timeline::before{content:'';position:absolute;left:8px;top:4px;bottom:4px;width:2px;background:#e2e8f0}
  .gdpr-tl-item{position:relative;margin-bottom:14px;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:.85rem}
  .gdpr-tl-item::before{content:'';position:absolute;left:-24px;top:12px;width:12px;height:12px;border-radius:50%;background:#4f46e5;border:2px solid #fff}
  .gdpr-tl-time{font-size:.75rem;color:#94a3b8}
  .gdpr-empty{text-align:center;padding:40px 20px;color:#94a3b8;font-style:italic}
  .gdpr-alert{padding:14px 18px;border-radius:8px;margin-bottom:16px;font-size:.875rem;line-height:1.5}
  .gdpr-alert-info{background:#eef2ff;color:#3730a3}.gdpr-alert-warn{background:#fffbeb;color:#92400e}.gdpr-alert-ok{background:#f0fdf4;color:#166534}.gdpr-alert-err{background:#fef2f2;color:#991b1b}
  .gdpr-flex{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .gdpr-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;background:#f1f5f9;color:#475569}
  .gdpr-progress{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin:8px 0 4px}
  .gdpr-progress-bar{height:100%;background:#4f46e5;border-radius:4px;transition:width .4s}
  .gdpr-switch{position:relative;display:inline-block;width:44px;height:24px;vertical-align:middle}
  .gdpr-switch input{opacity:0;width:0;height:0}.gdpr-switch .slider{position:absolute;cursor:pointer;inset:0;background:#cbd5e1;border-radius:24px;transition:.2s}
  .gdpr-switch .slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
  .gdpr-switch input:checked+.slider{background:#4f46e5}.gdpr-switch input:checked+.slider:before{transform:translateX(20px)}
  .gdpr-scroll{max-height:400px;overflow-y:auto}
  .gdpr-code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:.8rem}
  `;

  /* ── SQL Migrations ─────────────────────────────────────────── */
  const MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS gdpr_consents(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    user_email VARCHAR(255), consent_type VARCHAR(80),
    consented BOOLEAN DEFAULT false,
    ip_address VARCHAR(45), user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_export_requests(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    user_email VARCHAR(255), format VARCHAR(20) DEFAULT 'json',
    status VARCHAR(30) DEFAULT 'pending',
    file_path TEXT, completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_deletion_requests(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    user_email VARCHAR(255), reason TEXT,
    status VARCHAR(30) DEFAULT 'pending',
    reviewed_by VARCHAR(255), reviewed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_cookie_audit(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    cookie_name VARCHAR(120), category VARCHAR(60),
    description TEXT, is_required BOOLEAN DEFAULT false,
    expiry_days INT DEFAULT 365, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_retention_policies(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    data_type VARCHAR(100), retention_days INT DEFAULT 2555,
    auto_delete BOOLEAN DEFAULT true, description TEXT,
    created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_compliance_reports(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    report_type VARCHAR(60), generated_by VARCHAR(255),
    content JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS gdpr_data_access_log(
    id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
    accessor_email VARCHAR(255), target_email VARCHAR(255),
    data_type VARCHAR(100), action VARCHAR(60),
    ip_address VARCHAR(45), created_at TIMESTAMPTZ DEFAULT now());
  CREATE INDEX IF NOT EXISTS idx_gdpr_consents_tid ON gdpr_consents(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gdpr_exports_tid ON gdpr_export_requests(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gdpr_deletions_tid ON gdpr_deletion_requests(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_gdpr_audit_tid ON gdpr_data_access_log(tenant_id);
  `;

  async function runMigrations() {
    const stmts = MIGRATIONS.trim().split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) { try { await pool.query(stmt); } catch(e) { /* migration OK */ } }
  }
  runMigrations().catch(console.error);

  /* ── Seed default cookies & retention policies ──────────────── */
  const DEFAULT_COOKIES = [
    ['session_id','essential','Maintains user session state across page requests',true,0],
    ['csrf_token','essential','Cross-site request forgery protection token',true,0],
    ['gdpr_consent','essential','Stores user cookie consent preferences',true,365],
    ['theme_pref','functional','Remembers user theme preference (light/dark mode)',false,365],
    ['lang_pref','functional','Stores user language/locale preference',false,365],
    ['ga_id','analytics','Google Analytics tracking cookie for site usage stats',false,400],
    ['hotjar','analytics','Hotjar heatmap and behavior analytics cookie',false,365],
    ['fb_pixel','marketing','Facebook advertising pixel for retargeting campaigns',false,180],
    ['gads','marketing','Google Ads remarketing cookie',false,90],
    ['perf_timing','performance','Records page load performance metrics',false,0],
  ];
  const DEFAULT_RETENTION = [
    ['student_records',     2555, 'Student enrollment and academic records — retained 7 years per regulations'],
    ['attendance_data',     1095, 'Daily attendance logs — retained 3 years for reporting purposes'],
    ['financial_records',   2555, 'Fee payments, invoices, and financial transactions — 7 years for audit'],
    ['communication_logs',   730, 'Email and message logs — 2 years for dispute resolution'],
    ['system_audit_logs',    180, 'System access and change logs — 6 months for operational security'],
    ['export_files',           7, 'User data export downloads — auto-deleted after 7 days'],
    ['assessment_results',   1825, 'Exam and assessment records — 5 years for academic review'],
  ];

  async function seedDefaults(tid) {
    for (const [cn, cat, desc, req, exp] of DEFAULT_COOKIES) {
      const r = await pool.query('SELECT 1 FROM gdpr_cookie_audit WHERE tenant_id=$1 AND cookie_name=$2', [tid, cn]);
      if (!r.rowCount) await pool.query(
        'INSERT INTO gdpr_cookie_audit(cookie_name,category,description,is_required,expiry_days,tenant_id) VALUES($1,$2,$3,$4,$5,$6)',
        [cn, cat, desc, req, exp, tid]);
    }
    for (const [dt, days, desc] of DEFAULT_RETENTION) {
      const r = await pool.query('SELECT 1 FROM gdpr_retention_policies WHERE tenant_id=$1 AND data_type=$2', [tid, dt]);
      if (!r.rowCount) await pool.query(
        'INSERT INTO gdpr_retention_policies(data_type,retention_days,description,tenant_id) VALUES($1,$2,$3,$4)',
        [dt, days, desc, tid]);
    }
  }

  /* ── Utility helpers ────────────────────────────────────────── */
  function wrapHTML(title, body, req) {
    return renderPage(title,
      `<link rel="stylesheet" href="/css/sk.css"><style>${CSS}</style><div class="gdpr-wrap">${body}</div>`,
      req.session?.user);
  }

  function badge(status) {
    if (['compliant','approved','completed','consented','enabled'].includes(status))
      return `<span class="gdpr-badge badge-ok">${esc(status)}</span>`;
    if (['warning','pending','processing','undecided'].includes(status))
      return `<span class="gdpr-badge badge-warn">${esc(status)}</span>`;
    return `<span class="gdpr-badge badge-err">${esc(status)}</span>`;
  }

  function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 50) return '#d97706';
    return '#dc2626';
  }

  function retentionLabel(days) {
    if (days === 0) return 'Session';
    if (days < 30) return days + ' days';
    if (days < 365) return Math.round(days / 30) + ' months';
    const y = Math.round(days / 365);
    return y + (y > 1 ? ' years' : ' year');
  }

  function tabsHTML(active) {
    const tabs = [
      ['/school/gdpr',        'Dashboard'],
      ['/school/gdpr/consent', 'Consents'],
      ['/school/gdpr/export',  'Export'],
      ['/school/gdpr/deletion','Deletion'],
      ['/school/gdpr/cookies', 'Cookies'],
      ['/school/gdpr/retention','Retention'],
      ['/school/gdpr/reports', 'Reports'],
      ['/school/gdpr/audit',   'Audit Log'],
    ];
    return `<nav class="gdpr-tabs">${tabs.map(([href, label]) =>
      `<a class="gdpr-tab${href === active ? ' active' : ''}" href="${href}">${label}</a>`
    ).join('')}</nav>`;
  }

  async function getConsentStatus(tid, email) {
    const types = ['analytics','marketing','third_party_sharing','essential','performance','functional'];
    const results = {};
    for (const t of types) {
      const r = await pool.query(
        "SELECT consented, created_at FROM gdpr_consents WHERE tenant_id=$1 AND user_email=$2 AND consent_type=$3 ORDER BY created_at DESC LIMIT 1",
        [tid, email, t]);
      results[t] = r.rowCount
        ? { consented: r.rows[0].consented, date: r.rows[0].created_at }
        : { consented: null, date: null };
    }
    return results;
  }

  async function calcScore(tid) {
    let score = 0;
    const consents = await pool.query(
      "SELECT consent_type, consented FROM gdpr_consents WHERE tenant_id=$1 GROUP BY consent_type, consented", [tid]);
    const cMap = {};
    consents.rows.forEach(r => { cMap[r.consent_type] = r.consented; });
    /* Core consents: 15 pts each = 45 max */
    ['essential','performance','functional'].forEach(t => { if (cMap[t] === true) score += 15; });
    /* Optional consents: 5 pts each = 15 max */
    ['analytics','marketing','third_party_sharing'].forEach(t => { if (cMap[t] === true) score += 5; });
    /* Retention policies configured: 10 pts */
    const ret = await pool.query("SELECT COUNT(*)::int AS c FROM gdpr_retention_policies WHERE tenant_id=$1", [tid]);
    if (ret.rows[0].c >= 3) score += 10;
    /* No pending deletions: 5 pts */
    const del = await pool.query("SELECT COUNT(*)::int AS c FROM gdpr_deletion_requests WHERE tenant_id=$1 AND status='pending'", [tid]);
    if (del.rows[0].c === 0) score += 5;
    /* Cookie audit complete: 5 pts */
    const ck = await pool.query("SELECT COUNT(*)::int AS c FROM gdpr_cookie_audit WHERE tenant_id=$1", [tid]);
    if (ck.rows[0].c >= 3) score += 5;
    /* Export available: 5 pts */
    const exp = await pool.query("SELECT COUNT(*)::int AS c FROM gdpr_export_requests WHERE tenant_id=$1", [tid]);
    if (exp.rows[0].c > 0) score += 5;
    /* Report generated: 5 pts */
    const rep = await pool.query("SELECT COUNT(*)::int AS c FROM gdpr_compliance_reports WHERE tenant_id=$1", [tid]);
    if (rep.rows[0].c > 0) score += 5;
    return Math.min(score, 100);
  }

  async function logAccess(tid, accessor, target, dataType, action, ip) {
    await pool.query(
      "INSERT INTO gdpr_data_access_log(tenant_id,accessor_email,target_email,data_type,action,ip_address) VALUES($1,$2,$3,$4,$5,$6)",
      [tid, accessor, target, dataType, action, ip]);
  }

  const CONSENT_LABELS = {
    analytics:             'Analytics Tracking',
    marketing:             'Marketing Communications',
    third_party_sharing:   'Third-Party Data Sharing',
    essential:             'Essential System Cookies',
    performance:           'Performance Monitoring',
    functional:            'Functional Preferences',
  };
  const CONSENT_DESC = {
    analytics:             'Allow collection of anonymous usage data to improve our services and understand user behavior.',
    marketing:             'Receive promotional emails, newsletters, and information about new features or events.',
    third_party_sharing:   'Permit sharing of your data with trusted third-party educational service providers.',
    essential:             'Required cookies for authentication, security, and core platform functionality.',
    performance:           'Enable performance monitoring to detect and fix issues, measure page load times.',
    functional:            'Remember your preferences such as language, theme, and notification settings.',
  };

  /* ── Scheduled tasks ─────────────────────────────────────────── */
  async function cleanupExpiredExports() {
    const expired = await pool.query("UPDATE gdpr_export_requests SET status='expired' WHERE expires_at IS NOT NULL AND expires_at < now() AND status='completed' RETURNING id,file_path");
    const fs = require('fs');
    for (const row of expired.rows) { try { if (row.file_path && fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path); } catch(_) {} }
  }
  async function enforceRetentionDeletions() {
    const cutoff = new Date(Date.now() - 30*24*60*60*1000);
    const ready = await pool.query("UPDATE gdpr_deletion_requests SET status='completed',completed_at=now() WHERE status='approved' AND reviewed_at < $1 RETURNING id,user_email,tenant_id",[cutoff]);
    for (const row of ready.rows) {
      for (const t of ['users','students','staff','parents','guardians']) {
        try { await pool.query(`DELETE FROM ${t} WHERE (email=$1 OR user_email=$1 OR guardian_email=$1) AND tenant_id=$2`,[row.user_email,row.tenant_id]); } catch(_) {}
      }
    }
  }
  setInterval(cleanupExpiredExports, 6*60*60*1000);
  setInterval(enforceRetentionDeletions, 24*60*60*1000);
  cleanupExpiredExports().catch(() => {});

  /* ══════════════════════════════════════════════════════════════
     ROUTES
     ══════════════════════════════════════════════════════════════ */

  /* 1 ─ GET /school/gdpr — Compliance Dashboard ───────────────── */
  app.get('/school/gdpr', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    await seedDefaults(tid);
    const score = await calcScore(tid);
    const color = scoreColor(score);
    const pendingDel = await pool.query("SELECT * FROM gdpr_deletion_requests WHERE tenant_id=$1 AND status IN('pending','processing') ORDER BY created_at DESC LIMIT 5",[tid]);
    const recentExports = await pool.query("SELECT * FROM gdpr_export_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5",[tid]);
    const myConsents = await getConsentStatus(tid, email);
    const totalConsented = Object.values(myConsents).filter(v => v.consented === true).length;
    const consentPct = Math.round((totalConsented / Object.keys(myConsents).length) * 100);
    const recentAudit = await pool.query("SELECT * FROM gdpr_data_access_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 6",[tid]);
    res.send(wrapHTML('GDPR Compliance Center', `
      <h1 class="gdpr-h1">🛡️ GDPR Compliance Center</h1>
      <p class="gdpr-p">Manage data privacy, consent, and regulatory compliance for your school.</p>
      <div class="gdpr-card" style="text-align:center">
        <div class="gdpr-gauge" style="--pct:${score}%; background:conic-gradient(${color} var(--pct,0%),#e2e8f0 0%)">
          <div class="gdpr-gauge-inner" style="color:${color}">${score}%</div>
        </div>
        <p style="font-weight:600;margin:0 0 4px">Overall Compliance Score</p>
        <p style="font-size:.8rem;color:#64748b;margin:0">${score >= 80 ? 'Great! Most GDPR requirements met.' : score >= 50 ? 'Good progress — review recommendations.' : 'Action needed — compliance gaps detected.'}</p>
        <div class="gdpr-progress" style="max-width:300px;margin:12px auto 0"><div class="gdpr-progress-bar" style="width:${score}%;background:${color}"></div></div>
      </div>
      <div class="gdpr-grid">
        <div class="gdpr-card gdpr-stat"><div class="num">${totalConsented}/6</div><div class="lbl">Consent Types Active</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${consentPct}%</div><div class="lbl">Consent Coverage</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${pendingDel.rowCount}</div><div class="lbl">Pending Deletions</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${recentExports.rowCount}</div><div class="lbl">Total Exports</div></div>
      </div>
      ${tabsHTML('/school/gdpr')}
      <div class="gdpr-grid-2">
        ${pendingDel.rowCount ? `<div class="gdpr-card"><h2 class="gdpr-h2">⚠️ Pending Deletions</h2>
          <table class="gdpr-table"><tr><th>Email</th><th>Status</th><th>Date</th></tr>
          ${pendingDel.rows.map(r => `<tr><td>${esc(r.user_email)}</td><td>${badge(r.status)}</td><td>${r.created_at.toLocaleDateString()}</td></tr>`).join('')}
          </table></div>` : '<div class="gdpr-card"><h2 class="gdpr-h2">✅ No Pending Deletions</h2><p style="color:#64748b;font-size:.85rem">All deletion requests have been handled.</p></div>'}
        ${recentExports.rowCount ? `<div class="gdpr-card"><h2 class="gdpr-h2">📦 Recent Exports</h2>
          <table class="gdpr-table"><tr><th>Email</th><th>Format</th><th>Status</th></tr>
          ${recentExports.rows.map(r => `<tr><td>${esc(r.user_email)}</td><td><span class="gdpr-tag">${esc(r.format.toUpperCase())}</span></td><td>${badge(r.status)}</td></tr>`).join('')}
          </table></div>` : '<div class="gdpr-card"><h2 class="gdpr-h2">📤 Data Exports</h2><p style="color:#64748b;font-size:.85rem">No exports requested yet. <a href="/school/gdpr/export">Create one now →</a></p></div>'}
      </div>
      ${recentAudit.rowCount ? `<div class="gdpr-card"><h2 class="gdpr-h2">🔍 Recent Activity</h2>
        <div class="gdpr-timeline">${recentAudit.rows.map(r => `
          <div class="gdpr-tl-item"><strong>${esc(r.accessor_email)}</strong> performed <span class="gdpr-tag">${esc(r.action)}</span> on ${esc(r.data_type)}
          ${r.target_email ? `(${esc(r.target_email)})` : ''}<div class="gdpr-tl-time">${r.created_at.toLocaleString()}</div></div>`).join('')}
        </div></div>` : ''}
    `, req));
  }));

  /* 2 ─ GET /school/gdpr/consent — Consent Management Center ─── */
  app.get('/school/gdpr/consent', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    await seedDefaults(tid);
    const consents = await getConsentStatus(tid, email);
    const totalConsented = Object.values(consents).filter(v => v.consented === true).length;
    const allConsents = await pool.query(
      "SELECT * FROM gdpr_consents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50", [tid]);
    const cards = Object.entries(CONSENT_LABELS).map(([key, label]) => {
      const s = consents[key];
      return `<div class="gdpr-card">
        <div class="gdpr-flex">
          <div style="flex:1"><h3 class="gdpr-h3" style="margin:0 0 4px">${esc(label)}</h3>
            <p style="color:#64748b;font-size:.8rem;margin:0">${esc(CONSENT_DESC[key])}</p>
            <p style="font-size:.75rem;color:#94a3b8;margin:6px 0 0">Last updated: ${s.date ? s.date.toLocaleDateString() : 'Never'}</p></div>
          <div>${s.consented === true ? badge('consented') : s.consented === false ? badge('declined') : badge('undecided')}</div>
        </div>
        <form method="POST" action="/school/gdpr/consent/update" style="display:flex;gap:8px;margin-top:12px">
          <input type="hidden" name="consent_type" value="${esc(key)}">
          <button class="gdpr-btn gdpr-btn-sm gdpr-btn-success" type="submit" name="consented" value="true">Accept</button>
          <button class="gdpr-btn gdpr-btn-sm gdpr-btn-danger" type="submit" name="consented" value="false">Decline</button>
        </form>
      </div>`;
    }).join('');
    res.send(wrapHTML('Consent Management', `
      <h1 class="gdpr-h1">📋 Consent Management</h1>
      <p class="gdpr-p">Review and manage your privacy consent preferences. You may withdraw consent at any time.</p>
      <div class="gdpr-alert gdpr-alert-info">Under GDPR Articles 6 & 7, you have the right to be informed about and control how your personal data is processed. Each consent type governs a specific category of data use.</div>
      <div class="gdpr-grid" style="margin-bottom:20px">
        <div class="gdpr-card gdpr-stat"><div class="num">${totalConsented}/6</div><div class="lbl">Active Consents</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${Math.round(totalConsented/6*100)}%</div><div class="lbl">Coverage</div></div>
      </div>
      ${tabsHTML('/school/gdpr/consent')}
      ${cards}
      <div class="gdpr-card"><h2 class="gdpr-h2">Recent Consent Activity</h2>
      ${allConsents.rowCount ? `<div class="gdpr-scroll"><table class="gdpr-table"><tr><th>User</th><th>Type</th><th>Decision</th><th>IP</th><th>Date</th></tr>
        ${allConsents.rows.map(r => `<tr><td>${esc(r.user_email)}</td><td><span class="gdpr-tag">${esc(r.consent_type)}</span></td>
        <td>${r.consented ? badge('consented') : badge('declined')}</td>
        <td class="gdpr-code">${esc(r.ip_address)}</td><td>${r.created_at.toLocaleString()}</td></tr>`).join('')}
      </table></div>` : '<div class="gdpr-empty">No consent records found.</div>'}</div>
    `, req));
  }));

  /* 3 ─ POST /school/gdpr/consent/update ──────────────────────── */
  app.post('/school/gdpr/consent/update', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const { consent_type, consented } = req.body;
    if (!CONSENT_LABELS[consent_type]) return res.status(400).send('Invalid consent type');
    const isConsented = consented === 'true';
    await pool.query(
      "INSERT INTO gdpr_consents(tenant_id,user_email,consent_type,consented,ip_address,user_agent) VALUES($1,$2,$3,$4,$5,$6)",
      [tid, email, consent_type, isConsented, req.ip, req.headers['user-agent']]);
    await logAccess(tid, email, email, 'consent', isConsented ? 'accept' : 'decline', req.ip);
    audit('gdpr_consent_update', { tenant_id: tid, user: email, type: consent_type, consented: isConsented });
    res.redirect('/school/gdpr/consent');
  }));

  /* 4 ─ GET /school/gdpr/export — Data Export Options ─────────── */
  app.get('/school/gdpr/export', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const exports = await pool.query(
      "SELECT * FROM gdpr_export_requests WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC LIMIT 15", [tid, email]);
    res.send(wrapHTML('Data Export', `
      <h1 class="gdpr-h1">📤 Data Export</h1>
      <p class="gdpr-p">Download a complete copy of all personal data we hold about you. Under GDPR Article 20, you have the right to data portability.</p>
      <div class="gdpr-alert gdpr-alert-info">Exports are generated instantly and available for download for 7 days, after which they are automatically deleted.</div>
      ${tabsHTML('/school/gdpr/export')}
      <div class="gdpr-grid-2">
        <div class="gdpr-card">
          <h2 class="gdpr-h2">Request New Export</h2>
          <form method="POST" action="/school/gdpr/export/request" class="gdpr-form">
            <label>Export Format</label>
            <select name="format">
              <option value="json">JSON — Complete structured data</option>
              <option value="csv">CSV — Tabular spreadsheet format</option>
              <option value="pdf">PDF — Human-readable summary</option>
            </select>
            <p style="font-size:.78rem;color:#64748b;margin:-6px 0 12px">Scans tables: users, students, staff, parents, fee_records, attendance_records, grades, guardians, communications.</p>
            <button class="gdpr-btn gdpr-btn-primary" type="submit">Generate Export</button>
          </form>
        </div>
        <div class="gdpr-card">
          <h2 class="gdpr-h2">📋 What's Included</h2>
          <div class="gdpr-timeline">
            <div class="gdpr-tl-item"><strong>Profile data</strong> — name, email, phone, role</div>
            <div class="gdpr-tl-item"><strong>Academic records</strong> — grades, attendance, enrollment</div>
            <div class="gdpr-tl-item"><strong>Financial data</strong> — fee records, payment history</div>
            <div class="gdpr-tl-item"><strong>Guardian info</strong> — linked parent/guardian records</div>
            <div class="gdpr-tl-item"><strong>Communications</strong> — messages, notifications sent</div>
            <div class="gdpr-tl-item"><strong>Consent log</strong> — all privacy consent decisions</div>
          </div>
        </div>
      </div>
      <div class="gdpr-card"><h2 class="gdpr-h2">Your Exports</h2>
      ${exports.rowCount ? `<table class="gdpr-table"><tr><th>Format</th><th>Status</th><th>Requested</th><th>Completed</th><th>Expires</th><th>Action</th></tr>
        ${exports.rows.map(r => `<tr>
          <td><span class="gdpr-tag">${esc(r.format.toUpperCase())}</span></td>
          <td>${badge(r.status)}</td>
          <td>${r.created_at.toLocaleDateString()}</td>
          <td>${r.completed_at ? r.completed_at.toLocaleDateString() : '—'}</td>
          <td>${r.expires_at ? r.expires_at.toLocaleDateString() : '—'}</td>
          <td>${r.status === 'completed' ? `<a class="gdpr-btn gdpr-btn-sm gdpr-btn-primary" href="/school/gdpr/export/download/${r.id}">⬇ Download</a>` : r.status === 'processing' ? '<span style="color:#854d0e;font-size:.8rem">Processing…</span>' : '—'}</td>
        </tr>`).join('')}
      </table>` : '<div class="gdpr-empty">No export requests yet. Use the form above to create your first export.</div>'}</div>
    `, req));
  }));

  /* 5 ─ POST /school/gdpr/export/request ──────────────────────── */
  app.post('/school/gdpr/export/request', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const format = (req.body.format || 'json').toLowerCase();
    if (!['json','csv','pdf'].includes(format)) return res.status(400).send('Invalid export format');
    const r = await pool.query(
      "INSERT INTO gdpr_export_requests(tenant_id,user_email,format,status,expires_at) VALUES($1,$2,$3,'processing',$4) RETURNING id",
      [tid, email, format, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]);
    const id = r.rows[0].id;
    /* Scan all known user-data tables */
    const tables = ['users','students','staff','parents','fee_records','attendance_records','grades','guardians','communications'];
    const data = {};
    for (const t of tables) {
      try {
        const tr = await pool.query(
          `SELECT * FROM ${t} WHERE tenant_id=$1 AND (email=$2 OR user_email=$2 OR guardian_email=$2 OR student_email=$2) LIMIT 500`,
          [tid, email]);
        if (tr.rowCount) data[t] = tr.rows;
      } catch (_) { /* table may not exist */ }
    }
    const fs = require('fs');
    const dir = '/tmp/gdpr_exports';
    fs.mkdirSync(dir, { recursive: true });
    const filePath = `${dir}/export_${id}_${Date.now()}.${format}`;
    if (format === 'json') {
      fs.writeFileSync(filePath, JSON.stringify({ exported_for: email, exported_at: new Date().toISOString(), tenant_id: tid, data }, null, 2));
    } else if (format === 'csv') {
      let csv = `GDPR Data Export — ${email} — ${new Date().toISOString()}\n\n`;
      Object.entries(data).forEach(([k, v]) => {
        if (!v.length) return;
        csv += `=== ${k} (${v.length} records) ===\n`;
        csv += Object.keys(v[0]).join(',') + '\n';
        v.forEach(row => { csv += Object.values(row).map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(',') + '\n'; });
        csv += '\n';
      });
      fs.writeFileSync(filePath, csv);
    } else {
      let txt = `GDPR DATA EXPORT REPORT\n${'='.repeat(50)}\nEmail: ${email}\nDate: ${new Date().toISOString()}\nTenant: ${tid}\n\n`;
      Object.entries(data).forEach(([k, v]) => { txt += `${k}: ${v.length} record(s)\n`; });
      txt += `\nTotal tables with data: ${Object.keys(data).length}\nTotal records: ${Object.values(data).reduce((s,v) => s + v.length, 0)}\n\nNote: For complete machine-readable data, use JSON format.`;
      fs.writeFileSync(filePath, txt);
    }
    await pool.query("UPDATE gdpr_export_requests SET status='completed',file_path=$1,completed_at=now() WHERE id=$2", [filePath, id]);
    await logAccess(tid, email, email, 'export', 'create', req.ip);
    audit('gdpr_export_request', { tenant_id: tid, user: email, format, id });
    res.redirect('/school/gdpr/export');
  }));

  /* 6 ─ GET /school/gdpr/export/download/:id ─────────────────── */
  app.get('/school/gdpr/export/download/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const r = await pool.query(
      "SELECT * FROM gdpr_export_requests WHERE id=$1 AND tenant_id=$2 AND user_email=$3", [+req.params.id, tid, email]);
    if (!r.rowCount) return res.status(404).send('Export not found');
    const exp = r.rows[0];
    if (exp.status !== 'completed') return res.status(400).send('Export is not ready yet');
    if (exp.expires_at && exp.expires_at < new Date()) return res.status(410).send('This export has expired. Please request a new one.');
    const fs = require('fs');
    if (!fs.existsSync(exp.file_path)) return res.status(404).send('Export file not found on disk');
    const ext = exp.format === 'csv' ? 'csv' : exp.format === 'pdf' ? 'txt' : 'json';
    await logAccess(tid, email, email, 'export', 'download', req.ip);
    res.download(exp.file_path, `gdpr_export_${exp.id}.${ext}`);
  }));

  /* 7 ─ GET /school/gdpr/deletion — Deletion Requests ────────── */
  app.get('/school/gdpr/deletion', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const q = isAdmin(req) ? [tid] : [tid, email];
    const where = isAdmin(req) ? 'tenant_id=$1' : 'tenant_id=$1 AND user_email=$2';
    const reqs = await pool.query(`SELECT d.*, (SELECT COUNT(*)::int FROM gdpr_data_access_log l WHERE l.tenant_id=d.tenant_id AND l.target_email=d.user_email AND l.data_type='deletion') AS audit_count FROM gdpr_deletion_requests d WHERE ${where} ORDER BY d.created_at DESC LIMIT 20`, q);
    res.send(wrapHTML('Right to Be Forgotten', `
      <h1 class="gdpr-h1">🗑️ Data Deletion — Right to Be Forgotten</h1>
      <p class="gdpr-p">Under GDPR Article 17, you may request complete deletion of your personal data from our systems.</p>
      ${tabsHTML('/school/gdpr/deletion')}
      <div class="gdpr-alert gdpr-alert-warn"><strong>Important:</strong> Deletion is irreversible after a 30-day grace period. During this window, your account is marked as "pending deletion" and related records are anonymized. After 30 days, all data is permanently removed.</div>
      <div class="gdpr-card">
        <h2 class="gdpr-h2">Submit Deletion Request</h2>
        <form method="POST" action="/school/gdpr/deletion/request" class="gdpr-form">
          <label>Reason for Deletion</label>
          <textarea name="reason" required placeholder="Please explain why you want your data deleted (min 10 characters)…" minlength="10"></textarea>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400;font-size:.875rem">
            <input type="checkbox" name="confirmed" value="true" required style="width:auto;margin:0">
            I understand this action cannot be undone after the 30-day grace period and I will lose access to all my data.
          </label>
          <button class="gdpr-btn gdpr-btn-danger" type="submit">Request Data Deletion</button>
        </form>
      </div>
      ${isAdmin(req) ? '<div class="gdpr-alert gdpr-alert-info">🔐 Administrator view — showing all deletion requests across the tenant.</div>' : ''}
      <div class="gdpr-card"><h2 class="gdpr-h2">Deletion Requests</h2>
      ${reqs.rowCount ? `<div class="gdpr-scroll"><table class="gdpr-table"><tr><th>Email</th><th>Reason</th><th>Status</th><th>Submitted</th><th>Audit</th>${isAdmin(req) ? '<th>Actions</th>' : ''}</tr>
        ${reqs.rows.map(r => `<tr>
          <td><strong>${esc(r.user_email)}</strong></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.reason)}">${esc((r.reason||'').substring(0,40))}${(r.reason||'').length>40?'…':''}</td>
          <td>${badge(r.status)}</td>
          <td>${r.created_at.toLocaleDateString()}</td>
          <td>${r.audit_count}</td>
          ${isAdmin(req) ? `<td>${r.status === 'pending' ? `
            <button class="gdpr-btn gdpr-btn-sm gdpr-btn-success" onclick="if(confirm('Approve deletion for ${esc(r.user_email)}?'))fetch('/school/gdpr/deletion/approve/${r.id}',{method:'POST'}).then(()=>location.reload())">Approve</button>
            <button class="gdpr-btn gdpr-btn-sm gdpr-btn-outline" onclick="if(confirm('Reject deletion for ${esc(r.user_email)}?'))fetch('/school/gdpr/deletion/reject/${r.id}',{method:'POST'}).then(()=>location.reload())">Reject</button>` : r.status === 'approved' ? `<span style="font-size:.8rem;color:#854d0e">Grace period active</span>` : '—'}</td>` : ''}
        </tr>`).join('')}
      </table></div>` : '<div class="gdpr-empty">No deletion requests found.</div>'}</div>
    `, req));
  }));

  /* 8 ─ POST /school/gdpr/deletion/request ────────────────────── */
  app.post('/school/gdpr/deletion/request', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const { reason, confirmed } = req.body;
    if (confirmed !== 'true') return res.status(400).send('You must acknowledge the deletion confirmation');
    if (!reason || reason.trim().length < 10) return res.status(400).send('Please provide a detailed reason (min 10 characters)');
    const dup = await pool.query("SELECT id FROM gdpr_deletion_requests WHERE tenant_id=$1 AND user_email=$2 AND status IN('pending','approved')",[tid, email]);
    if (dup.rowCount) return res.redirect('/school/gdpr/deletion');
    await pool.query("INSERT INTO gdpr_deletion_requests(tenant_id,user_email,reason,status) VALUES($1,$2,$3,'pending')",[tid, email, reason.trim()]);
    await logAccess(tid, email, email, 'deletion', 'request', req.ip);
    audit('gdpr_deletion_request', { tenant_id: tid, user: email });
    res.redirect('/school/gdpr/deletion');
  }));

  /* 9 ─ POST /school/gdpr/deletion/approve/:id ───────────────── */
  app.post('/school/gdpr/deletion/approve/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send('Administrator access required');
    const tid = tenantId(req), admin = req.session.user.email;
    const dr = await pool.query("SELECT * FROM gdpr_deletion_requests WHERE id=$1 AND tenant_id=$2 AND status='pending'",[+req.params.id, tid]);
    if (!dr.rowCount) return res.status(404).send('Request not found');
    const del = dr.rows[0];
    await pool.query("UPDATE gdpr_deletion_requests SET status='approved',reviewed_by=$1,reviewed_at=now() WHERE id=$2",[admin, del.id]);
    try { await pool.query("UPDATE users SET status='pending_deletion' WHERE email=$1 AND tenant_id=$2",[del.user_email, tid]); } catch(_) {}
    const pii = ['first_name','last_name','email','phone'];
    for (const tbl of ['students','staff','parents','guardians']) {
      try { await pool.query(`UPDATE ${tbl} SET ${pii.map(f=>f+"='DELETED'").join(',')} WHERE (email=$1 OR user_email=$1 OR guardian_email=$1) AND tenant_id=$2`,[del.user_email, tid]); } catch(_) {}
    }
    await logAccess(tid, admin, del.user_email, 'deletion', 'approve', req.ip);
    audit('gdpr_deletion_approve', { tenant_id: tid, admin, target: del.user_email, id: del.id });
    res.redirect('/school/gdpr/deletion');
  }));

  /* 10 ─ POST /school/gdpr/deletion/reject/:id ───────────────── */
  app.post('/school/gdpr/deletion/reject/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send('Administrator access required');
    const tid = tenantId(req), admin = req.session.user.email;
    const dr = await pool.query("SELECT * FROM gdpr_deletion_requests WHERE id=$1 AND tenant_id=$2 AND status='pending'",[+req.params.id, tid]);
    if (!dr.rowCount) return res.status(404).send('Request not found');
    await pool.query("UPDATE gdpr_deletion_requests SET status='rejected',reviewed_by=$1,reviewed_at=now(),notes=$2 WHERE id=$3",
      [admin, (req.body.notes || 'Rejected by administrator').trim(), +req.params.id]);
    await logAccess(tid, admin, dr.rows[0].user_email, 'deletion', 'reject', req.ip);
    audit('gdpr_deletion_reject', { tenant_id: tid, admin, id: +req.params.id });
    res.redirect('/school/gdpr/deletion');
  }));

  /* 11 ─ GET /school/gdpr/cookies — Cookie Audit ─────────────── */
  app.get('/school/gdpr/cookies', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await seedDefaults(tid);
    const cookies = await pool.query("SELECT * FROM gdpr_cookie_audit WHERE tenant_id=$1 ORDER BY category,cookie_name", [tid]);
    const categories = {};
    cookies.rows.forEach(c => { (categories[c.category] = categories[c.category] || []).push(c); });
    const sections = Object.entries(categories).map(([cat, items]) =>
      `<div class="gdpr-card"><h2 class="gdpr-h2">🍪 ${esc(cat.charAt(0).toUpperCase()+cat.slice(1))} Cookies <span style="font-weight:400;color:#94a3b8;font-size:.85rem">(${items.length})</span></h2>
        <table class="gdpr-table"><tr><th>Name</th><th>Description</th><th>Required</th><th>Expiry</th></tr>
        ${items.map(c => `<tr><td><span class="gdpr-code">${esc(c.cookie_name)}</span></td>
          <td>${esc(c.description)}</td><td>${c.is_required ? badge('enabled') : badge('disabled')}</td>
          <td>${c.expiry_days === 0 ? 'Session' : c.expiry_days + ' days'}</td></tr>`).join('')}</table></div>`
    ).join('');
    res.send(wrapHTML('Cookie Audit', `
      <h1 class="gdpr-h1">🍪 Cookie Audit & Configuration</h1>
      <p class="gdpr-p">Review all cookies used by this platform. Required cookies cannot be disabled as they are necessary for core functionality.</p>
      ${tabsHTML('/school/gdpr/cookies')}
      <div class="gdpr-grid">
        <div class="gdpr-card gdpr-stat"><div class="num">${cookies.rowCount}</div><div class="lbl">Total Cookies</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${cookies.rows.filter(c=>c.is_required).length}</div><div class="lbl">Required</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${cookies.rows.filter(c=>!c.is_required).length}</div><div class="lbl">Optional</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${Object.keys(categories).length}</div><div class="lbl">Categories</div></div>
      </div>
      ${sections}
      <div class="gdpr-card"><h2 class="gdpr-h2">Add / Update Cookie Entry</h2>
        <form method="POST" action="/school/gdpr/cookies/update" class="gdpr-form">
          <div class="gdpr-grid-2">
            <div><label>Cookie Name</label><input name="cookie_name" required placeholder="e.g. analytics_id"></div>
            <div><label>Category</label><select name="category"><option value="essential">Essential</option><option value="analytics">Analytics</option><option value="marketing">Marketing</option><option value="functional">Functional</option><option value="performance">Performance</option></select></div>
          </div>
          <label>Description</label><textarea name="description" required placeholder="What does this cookie do?"></textarea>
          <div class="gdpr-grid-2">
            <div><label>Expiry (days, 0 = session)</label><input type="number" name="expiry_days" value="365" min="0"></div>
            <div><label>Required?</label><select name="is_required"><option value="false">No — user can opt out</option><option value="true">Yes — always active</option></select></div>
          </div>
          <button class="gdpr-btn gdpr-btn-primary" type="submit">Save Cookie Entry</button>
        </form>
      </div>
    `, req));
  }));

  /* 12 ─ POST /school/gdpr/cookies/update ─────────────────────── */
  app.post('/school/gdpr/cookies/update', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send('Administrator access required');
    const tid = tenantId(req);
    const { cookie_name, category, description, expiry_days, is_required } = req.body;
    if (!cookie_name || !description) return res.status(400).send('Cookie name and description are required');
    const existing = await pool.query("SELECT id FROM gdpr_cookie_audit WHERE tenant_id=$1 AND cookie_name=$2",[tid, cookie_name]);
    if (existing.rowCount) {
      await pool.query("UPDATE gdpr_cookie_audit SET category=$1,description=$2,expiry_days=$3,is_required=$4 WHERE tenant_id=$5 AND cookie_name=$6",
        [category, description, +expiry_days, is_required === 'true', tid, cookie_name]);
    } else {
      await pool.query("INSERT INTO gdpr_cookie_audit(tenant_id,cookie_name,category,description,expiry_days,is_required) VALUES($1,$2,$3,$4,$5,$6)",
        [tid, cookie_name, category, description, +expiry_days, is_required === 'true']);
    }
    audit('gdpr_cookie_update', { tenant_id: tid, cookie: cookie_name, action: existing.rowCount ? 'update' : 'create' });
    res.redirect('/school/gdpr/cookies');
  }));

  /* 13 ─ GET /school/gdpr/retention — Retention Policies ─────── */
  app.get('/school/gdpr/retention', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await seedDefaults(tid);
    const policies = await pool.query("SELECT * FROM gdpr_retention_policies WHERE tenant_id=$1 ORDER BY retention_days DESC", [tid]);
    res.send(wrapHTML('Data Retention Policies', `
      <h1 class="gdpr-h1">⏱️ Data Retention Policies</h1>
      <p class="gdpr-p">Configure how long different categories of data are retained before automatic deletion or anonymization.</p>
      ${tabsHTML('/school/gdpr/retention')}
      <div class="gdpr-alert gdpr-alert-ok">Auto-delete is enabled by default. Data exceeding its retention period is automatically anonymized and scheduled for removal.</div>
      <div class="gdpr-card"><h2 class="gdpr-h2">Active Policies</h2>
      ${policies.rowCount ? `<table class="gdpr-table"><tr><th>Data Type</th><th>Retention Period</th><th>Auto-Delete</th><th>Description</th></tr>
        ${policies.rows.map(r => `<tr>
          <td><strong>${esc(r.data_type)}</strong></td>
          <td>${retentionLabel(r.retention_days)}</td>
          <td>${r.auto_delete ? badge('enabled') : badge('disabled')}</td>
          <td style="color:#64748b;font-size:.82rem">${esc(r.description)}</td>
        </tr>`).join('')}
      </table>` : '<div class="gdpr-empty">No retention policies configured yet.</div>'}</div>
      <div class="gdpr-card"><h2 class="gdpr-h2">Add / Update Policy</h2>
        <form method="POST" action="/school/gdpr/retention/update" class="gdpr-form">
          <div class="gdpr-grid-2">
            <div><label>Data Type</label><input name="data_type" required placeholder="e.g. student_records"></div>
            <div><label>Retention (days)</label><input type="number" name="retention_days" value="2555" min="1" required></div>
          </div>
          <label>Description</label><textarea name="description" required placeholder="Describe the data category and retention rationale…"></textarea>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
            <label class="gdpr-switch"><input type="checkbox" name="auto_delete" value="true" checked><span class="slider"></span></label>
            Enable automatic deletion after retention period expires
          </label>
          <button class="gdpr-btn gdpr-btn-primary" type="submit">Save Policy</button>
        </form>
      </div>
    `, req));
  }));

  /* 14 ─ POST /school/gdpr/retention/update ───────────────────── */
  app.post('/school/gdpr/retention/update', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.status(403).send('Administrator access required');
    const tid = tenantId(req);
    const { data_type, retention_days, description, auto_delete } = req.body;
    if (!data_type || !retention_days) return res.status(400).send('Data type and retention days are required');
    const existing = await pool.query("SELECT id FROM gdpr_retention_policies WHERE tenant_id=$1 AND data_type=$2",[tid, data_type]);
    if (existing.rowCount) {
      await pool.query("UPDATE gdpr_retention_policies SET retention_days=$1,auto_delete=$2,description=$3 WHERE tenant_id=$4 AND data_type=$5",
        [+retention_days, auto_delete === 'true', description || '', tid, data_type]);
    } else {
      await pool.query("INSERT INTO gdpr_retention_policies(tenant_id,data_type,retention_days,auto_delete,description) VALUES($1,$2,$3,$4,$5)",
        [tid, data_type, +retention_days, auto_delete === 'true', description || '']);
    }
    audit('gdpr_retention_update', { tenant_id: tid, data_type, action: existing.rowCount ? 'update' : 'create' });
    res.redirect('/school/gdpr/retention');
  }));

  /* 15 ─ GET /school/gdpr/reports — Compliance Reports ────────── */
  app.get('/school/gdpr/reports', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    await seedDefaults(tid);
    const reports = await pool.query("SELECT * FROM gdpr_compliance_reports WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20",[tid]);
    const score = await calcScore(tid), color = scoreColor(score);
    const stats = await pool.query("SELECT (SELECT COUNT(*)::int FROM gdpr_deletion_requests WHERE tenant_id=$1 AND status='pending') AS pending_del,(SELECT COUNT(*)::int FROM gdpr_export_requests WHERE tenant_id=$1) AS total_exports,(SELECT COUNT(*)::int FROM gdpr_consents WHERE tenant_id=$1 AND consented=true) AS consents_yes,(SELECT COUNT(*)::int FROM gdpr_consents WHERE tenant_id=$1 AND consented=false) AS consents_no",[tid]);
    const s = stats.rows[0];
    res.send(wrapHTML('Compliance Reports', `
      <h1 class="gdpr-h1">📊 Compliance Reports</h1>
      <p class="gdpr-p">Auto-generated compliance verification reports for GDPR, FERPA, and COPPA regulatory frameworks.</p>
      ${tabsHTML('/school/gdpr/reports')}
      <div class="gdpr-grid">
        <div class="gdpr-card gdpr-stat"><div class="num" style="color:${color}">${score}%</div><div class="lbl">GDPR Score</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${s.consents_yes}</div><div class="lbl">Consents Given</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${s.consents_no}</div><div class="lbl">Consents Declined</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${s.pending_del}</div><div class="lbl">Deletions Pending</div></div>
      </div>
      <div class="gdpr-card">
        <h2 class="gdpr-h2">Generate New Report</h2>
        <form method="POST" action="/school/gdpr/reports/generate" class="gdpr-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:220px"><label>Report Type</label>
            <select name="report_type"><option value="gdpr">GDPR</option><option value="ferpa">FERPA</option><option value="coppa">COPPA</option><option value="full">Full Audit</option></select></div>
          <button class="gdpr-btn gdpr-btn-primary" type="submit" style="margin:0">Generate</button>
        </form>
      </div>
      <div class="gdpr-card"><h2 class="gdpr-h2">Report History</h2>
      ${reports.rowCount ? `<div class="gdpr-scroll"><table class="gdpr-table"><tr><th>Type</th><th>By</th><th>Date</th><th>Score</th></tr>
        ${reports.rows.map(r => {
          const c = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
          return `<tr><td><span class="gdpr-tag" style="text-transform:uppercase">${esc(r.report_type)}</span></td><td>${esc(r.generated_by)}</td><td>${r.created_at.toLocaleDateString()}</td><td>${c.score !== undefined ? `<strong style="color:${scoreColor(c.score)}">${c.score}%</strong>` : '—'}</td></tr>`;}).join('')}
      </table></div>` : '<div class="gdpr-empty">No reports generated yet.</div>'}</div>
    `, req));
  }));

  /* POST generate report (helper for #15) */
  app.post('/school/gdpr/reports/generate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const reportType = req.body.report_type || 'gdpr';
    if (!['gdpr','ferpa','coppa','full'].includes(reportType)) return res.status(400).send('Invalid report type');
    const score = await calcScore(tid);
    const content = {
      report_type: reportType,
      score,
      generated_at: new Date().toISOString(),
      generated_by: email,
      tenant_id: tid,
      sections: {}
    };
    /* Data summaries */
    const consents = await pool.query("SELECT consent_type,consented,COUNT(*)::int AS count FROM gdpr_consents WHERE tenant_id=$1 GROUP BY consent_type,consented ORDER BY consent_type",[tid]);
    const deletions = await pool.query("SELECT status,COUNT(*)::int AS count FROM gdpr_deletion_requests WHERE tenant_id=$1 GROUP BY status",[tid]);
    const exports = await pool.query("SELECT format,status,COUNT(*)::int AS count FROM gdpr_export_requests WHERE tenant_id=$1 GROUP BY format,status",[tid]);
    const retention = await pool.query("SELECT data_type,retention_days,auto_delete FROM gdpr_retention_policies WHERE tenant_id=$1 ORDER BY data_type",[tid]);
    const cookies = await pool.query("SELECT category,COUNT(*)::int AS count,COUNT(*) FILTER(WHERE is_required) AS req FROM gdpr_cookie_audit WHERE tenant_id=$1 GROUP BY category",[tid]);
    content.sections = { consent_summary: consents.rows, deletion_summary: deletions.rows, export_summary: exports.rows, retention_policies: retention.rows, cookie_audit: cookies.rows };
    /* Regulation-specific checks */
    const checks = [];
    if (['gdpr','full'].includes(reportType)) {
      checks.push({ rule: 'GDPR Art.5 — Data processing principles', status: score >= 80 ? 'pass' : 'review' });
      checks.push({ rule: 'GDPR Art.7 — Consent records maintained', status: consents.rows.length > 0 ? 'pass' : 'fail' });
      checks.push({ rule: 'GDPR Art.17 — Right to erasure mechanism', status: 'pass' });
      checks.push({ rule: 'GDPR Art.20 — Data portability (export)', status: 'pass' });
    }
    if (['ferpa','full'].includes(reportType)) {
      checks.push({ rule: 'FERPA — Educational records protection', status: retention.rows.length > 0 ? 'pass' : 'review' });
      checks.push({ rule: 'FERPA — Directory information controls', status: 'pass' });
    }
    if (['coppa','full'].includes(reportType)) {
      checks.push({ rule: 'COPPA — Parental consent for minors', status: consents.rows.some(r=>r.consent_type==='essential'&&r.consented) ? 'pass' : 'review' });
      checks.push({ rule: 'COPPA — Data minimization for under-13', status: 'pass' });
    }
    content.sections.regulatory_checks = checks;
    /* Recommendations */
    content.recommendations = [];
    if (score < 70) content.recommendations.push('Increase consent coverage to improve compliance score.');
    if (deletions.rows.find(r => r.status === 'pending')) content.recommendations.push('Review and process pending deletion requests within 30 days.');
    if (retention.rows.length < 3) content.recommendations.push('Define retention policies for all data categories.');
    content.recommendations.push('Conduct a quarterly privacy impact assessment (PIA).');
    content.recommendations.push('Review and update the public privacy policy at least annually.');
    await pool.query(
      "INSERT INTO gdpr_compliance_reports(tenant_id,report_type,generated_by,content) VALUES($1,$2,$3,$4)",
      [tid, reportType, email, JSON.stringify(content)]);
    await logAccess(tid, email, 'system', 'report', 'generate', req.ip);
    audit('gdpr_report_generate', { tenant_id: tid, type: reportType, score });
    res.redirect('/school/gdpr/reports');
  }));

  /* 16 ─ GET /school/gdpr/audit — Data Access Audit Trail ────── */
  app.get('/school/gdpr/audit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), email = req.session.user.email;
    const page = Math.max(1, +req.query.page || 1);
    const perPage = 25;
    const offset = (page - 1) * perPage;
    const filterAction = req.query.action || '';
    const filterType = req.query.type || '';
    let wc = 'tenant_id=$1', params = [tid], pi = 2;
    if (filterAction) { wc += ` AND action=$${pi++}`; params.push(filterAction); }
    if (filterType) { wc += ` AND data_type=$${pi++}`; params.push(filterType); }
    const count = await pool.query(`SELECT COUNT(*)::int AS c FROM gdpr_data_access_log WHERE ${wc}`, params);
    const total = count.rows[0].c, totalPages = Math.ceil(total / perPage);
    const logs = await pool.query(`SELECT * FROM gdpr_data_access_log WHERE ${wc} ORDER BY created_at DESC LIMIT $${pi++} OFFSET $${pi++}`, [...params, perPage, offset]);
    const actions = await pool.query("SELECT DISTINCT action FROM gdpr_data_access_log WHERE tenant_id=$1 ORDER BY action", [tid]);
    const types = await pool.query("SELECT DISTINCT data_type FROM gdpr_data_access_log WHERE tenant_id=$1 ORDER BY data_type", [tid]);
    const pagination = totalPages > 1 ? `<div class="gdpr-flex" style="justify-content:center;margin-top:16px">
      ${page > 1 ? `<a class="gdpr-btn gdpr-btn-outline gdpr-btn-sm" href="?page=${page-1}&action=${esc(filterAction)}&type=${esc(filterType)}">← Prev</a>` : ''}
      <span style="padding:6px 12px;font-size:.85rem;color:#64748b">Page ${page} of ${totalPages} (${total} events)</span>
      ${page < totalPages ? `<a class="gdpr-btn gdpr-btn-outline gdpr-btn-sm" href="?page=${page+1}&action=${esc(filterAction)}&type=${esc(filterType)}">Next →</a>` : ''}</div>` : '';
    res.send(wrapHTML('Data Access Audit Trail', `
      <h1 class="gdpr-h1">🔍 Data Access Audit Trail</h1>
      <p class="gdpr-p">Complete log of all data access events — who accessed what data, when, and from where.</p>
      ${tabsHTML('/school/gdpr/audit')}
      <div class="gdpr-card">
        <form method="GET" class="gdpr-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:160px"><label>Action</label>
            <select name="action"><option value="">All Actions</option>
            ${actions.rows.map(r => `<option value="${esc(r.action)}"${r.action===filterAction?' selected':''}>${esc(r.action)}</option>`).join('')}
            </select></div>
          <div style="flex:1;min-width:160px"><label>Data Type</label>
            <select name="type"><option value="">All Types</option>
            ${types.rows.map(r => `<option value="${esc(r.data_type)}"${r.data_type===filterType?' selected':''}>${esc(r.data_type)}</option>`).join('')}
            </select></div>
          <button class="gdpr-btn gdpr-btn-outline gdpr-btn-sm" type="submit" style="margin:0">Filter</button>
          <a class="gdpr-btn gdpr-btn-outline gdpr-btn-sm" href="/school/gdpr/audit" style="margin:0">Clear</a>
        </form>
      </div>
      <div class="gdpr-grid">
        <div class="gdpr-card gdpr-stat"><div class="num">${total}</div><div class="lbl">Total Events</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${logs.rows.length}</div><div class="lbl">Showing</div></div>
        <div class="gdpr-card gdpr-stat"><div class="num">${actions.rowCount}</div><div class="lbl">Action Types</div></div>
      </div>
      <div class="gdpr-card"><h2 class="gdpr-h2">Access Log</h2>
      ${logs.rowCount ? `<div class="gdpr-scroll" style="max-height:500px"><table class="gdpr-table">
        <tr><th>Timestamp</th><th>Accessor</th><th>Target</th><th>Data Type</th><th>Action</th><th>IP Address</th></tr>
        ${logs.rows.map(r => `<tr>
          <td style="white-space:nowrap;font-size:.82rem">${r.created_at.toLocaleString()}</td>
          <td><strong>${esc(r.accessor_email)}</strong></td>
          <td>${esc(r.target_email) || '<span style="color:#94a3b8">—</span>'}</td>
          <td><span class="gdpr-tag">${esc(r.data_type)}</span></td>
          <td><span class="gdpr-badge ${r.action==='delete'||r.action==='reject'?'badge-err':'badge-ok'}">${esc(r.action)}</span></td>
          <td><span class="gdpr-code">${esc(r.ip_address)}</span></td>
        </tr>`).join('')}
      </table></div>` : '<div class="gdpr-empty">No access events recorded.</div>'}
      ${pagination}</div>
    `, req));
  }));
};
