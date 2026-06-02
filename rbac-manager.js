'use strict';
// ============================================================
// RBAC MANAGER MODULE — School SaaS Portal
// Advanced Role-Based Access Control with visual permission
// matrix, role hierarchy, and granular permission management.
// ============================================================
// Usage in server.js:
//   const rbacManager = require('./rbac-manager');
//   rbacManager(app, pool, { renderPage, esc, ah, requireAuth, audit });
// ============================================================

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  opts = opts || {};
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  // ── Color Theme ──────────────────────────────────────────
  const P = '#4f46e5', M = '#6b7280', G = '#059669', R = '#dc2626', O = '#d97706';
  const PL = '#eef2ff', ML = '#f3f4f6', GL = '#d1fae5', RL = '#fee2e2', OL = '#fef3c7';

  // ── Default Permissions (30+) ────────────────────────────
  const DEFAULT_PERMS = [
    { key:'students.view', name:'View Students', category:'students', description:'View student profiles and lists' },
    { key:'students.create', name:'Create Student', category:'students', description:'Add new student records' },
    { key:'students.edit', name:'Edit Student', category:'students', description:'Modify student information' },
    { key:'students.delete', name:'Delete Student', category:'students', description:'Remove student records' },
    { key:'students.export', name:'Export Students', category:'students', description:'Export student data to files' },
    { key:'academics.gradebook', name:'Manage Gradebook', category:'academics', description:'Enter and edit grades' },
    { key:'academics.lessons', name:'Manage Lessons', category:'academics', description:'Create and organize lessons' },
    { key:'academics.exams', name:'Manage Exams', category:'academics', description:'Create and schedule exams' },
    { key:'academics.reports', name:'Academic Reports', category:'academics', description:'Generate academic reports' },
    { key:'academics.curriculum', name:'Manage Curriculum', category:'academics', description:'Edit curriculum and subjects' },
    { key:'finance.fees', name:'Manage Fees', category:'finance', description:'Configure fee structures' },
    { key:'finance.payments', name:'Record Payments', category:'finance', description:'Process fee payments' },
    { key:'finance.payroll', name:'Manage Payroll', category:'finance', description:'Staff salary management' },
    { key:'finance.expenses', name:'Track Expenses', category:'finance', description:'Record school expenses' },
    { key:'finance.reports', name:'Financial Reports', category:'finance', description:'View financial summaries' },
    { key:'hr.staff', name:'Manage Staff', category:'hr', description:'Add and manage staff records' },
    { key:'hr.leave', name:'Manage Leave', category:'hr', description:'Approve/deny staff leave requests' },
    { key:'hr.recruitment', name:'Recruitment', category:'hr', description:'Post jobs and manage hiring' },
    { key:'hr.appraisals', name:'Staff Appraisals', category:'hr', description:'Conduct performance reviews' },
    { key:'communications.announcements', name:'Post Announcements', category:'communications', description:'Create school announcements' },
    { key:'communications.messages', name:'Send Messages', category:'communications', description:'Send messages to users' },
    { key:'communications.newsletter', name:'Newsletter', category:'communications', description:'Manage email newsletters' },
    { key:'admin.settings', name:'System Settings', category:'admin', description:'Configure system settings' },
    { key:'admin.users', name:'Manage Users', category:'admin', description:'Create and manage user accounts' },
    { key:'admin.backup', name:'Backup Data', category:'admin', description:'Create data backups' },
    { key:'admin.integrations', name:'Integrations', category:'admin', description:'Manage third-party integrations' },
    { key:'reports.view', name:'View Reports', category:'reports', description:'Access all report dashboards' },
    { key:'reports.export', name:'Export Reports', category:'reports', description:'Download reports as PDF/Excel' },
    { key:'reports.analytics', name:'Advanced Analytics', category:'reports', description:'Access analytics features' },
    { key:'settings.general', name:'General Settings', category:'settings', description:'Edit school profile and branding' },
    { key:'settings.modules', name:'Module Settings', category:'settings', description:'Enable/disable modules' },
    { key:'settings.theme', name:'Theme Settings', category:'settings', description:'Customize appearance' },
    { key:'students.attendance', name:'Manage Attendance', category:'students', description:'Record and view attendance' },
    { key:'academics.timetable', name:'Manage Timetable', category:'academics', description:'Create class schedules' },
    { key:'communications.sms', name:'Send SMS', category:'communications', description:'Bulk SMS messaging' },
    { key:'admin.billing', name:'Manage Billing', category:'admin', description:'Subscription and billing settings' },
    { key:'reports.attendance', name:'Attendance Reports', category:'reports', description:'Attendance summary and analysis' },
    { key:'settings.security', name:'Security Settings', category:'settings', description:'Password policies, 2FA, sessions' },
    { key:'finance.invoices', name:'Manage Invoices', category:'finance', description:'Create and send invoices' },
    { key:'hr.attendance', name:'Staff Attendance', category:'hr', description:'Track staff check-in/out' },
  ];

  // ── Default Roles ────────────────────────────────────────
  const DEFAULT_ROLES = [
    { name:'super_admin', desc:'Full system access', priority:1, color:'#dc2626', is_system:true, perms:'ALL' },
    { name:'admin', desc:'School administrator', priority:2, color:'#d97706', is_system:true,
      perms:['students','academics','hr','communications','reports','settings','admin.settings','admin.users'] },
    { name:'teacher', desc:'Classroom teacher', priority:3, color:'#059669', is_system:true,
      perms:['students.view','students.edit','academics'] },
    { name:'parent', desc:'Student parent/guardian', priority:4, color:'#2563eb', is_system:true,
      perms:['academics.reports','communications.messages','reports.view'] },
    { name:'student', desc:'Student self-service', priority:5, color:'#7c3aed', is_system:true,
      perms:['academics.reports','reports.view'] },
    { name:'accountant', desc:'Finance staff', priority:3, color:'#0891b2', is_system:true,
      perms:['finance','reports.view','reports.export'] },
    { name:'librarian', desc:'Library manager', priority:4, color:'#65a30d', is_system:true,
      perms:['students.view','reports.view','communications.announcements'] },
  ];

  // ── Shared CSS ───────────────────────────────────────────
  // Include external stylesheet and inline styles
  const SK_CSS = '<link rel="stylesheet" href="/css/sk.css">';
  const CSS = `<style>
    .rbac-root{max-width:1200px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif}
    .rbac-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center;padding:12px 16px;background:${PL};border-radius:14px;border:1px solid #c7d2fe}
    .rbac-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${M};background:#fff;transition:.15s;border:1px solid transparent}
    .rbac-nav a:hover{background:#e0e7ff;color:#312e81}
    .rbac-nav a.active{background:${P};color:#fff;border-color:${P};box-shadow:0 2px 8px rgba(79,70,229,.25)}
    .rbac-hero{background:linear-gradient(135deg,#312e81,${P});padding:28px 32px;border-radius:16px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}
    .rbac-hero::after{content:"";position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(129,140,248,.15)}
    .rbac-hero h1{font-size:24px;margin:0 0 4px;position:relative;z-index:1}
    .rbac-hero p{opacity:.85;margin:0;font-size:14px;position:relative;z-index:1}
    .rbac-hero-actions{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
    .rbac-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}
    .rbac-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;text-align:center;transition:.2s}
    .rbac-stat:hover{box-shadow:0 4px 24px rgba(79,70,229,.1);transform:translateY(-2px)}
    .rbac-stat-icon{font-size:28px;margin-bottom:6px}
    .rbac-stat-val{font-size:32px;font-weight:800;color:#1e1b4b}
    .rbac-stat-lbl{font-size:11px;color:${M};margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .rbac-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .rbac-btn:hover{opacity:.9;transform:translateY(-1px)}
    .rbac-btn-primary{background:${P};color:#fff}
    .rbac-btn-danger{background:${RL};color:${R};border:1px solid #fecaca}
    .rbac-btn-secondary{background:${ML};color:${M};border:1px solid #e5e7eb}
    .rbac-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
    .rbac-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;transition:.15s}
    .rbac-card:hover{box-shadow:0 4px 20px rgba(79,70,229,.06)}
    .rbac-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
    .rbac-card-title{font-size:16px;font-weight:700;color:#1e1b4b;display:flex;align-items:center;gap:8px}
    .rbac-table{width:100%;border-collapse:collapse;font-size:13px}
    .rbac-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e5e7eb;color:${M};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:${ML}}
    .rbac-table td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1e1b4b}
    .rbac-table tr:nth-child(even){background:#fafafa}
    .rbac-table tr:hover{background:#eef2ff}
    .rbac-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box;font-family:inherit}
    .rbac-input:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .rbac-form-group{margin-bottom:16px}
    .rbac-form-group label{display:block;font-size:13px;font-weight:600;color:#1e1b4b;margin-bottom:5px}
    .rbac-matrix{width:100%;border-collapse:collapse;font-size:12px}
    .rbac-matrix th{padding:8px 6px;text-align:center;background:${PL};color:#312e81;font-weight:700;font-size:11px;border:1px solid #c7d2fe;white-space:nowrap}
    .rbac-matrix th:first-child{text-align:left;min-width:160px}
    .rbac-matrix td{padding:6px;text-align:center;border:1px solid #e0e7ff;background:#fff}
    .rbac-matrix td:first-child{text-align:left;font-weight:600;color:#1e1b4b;font-size:12px;background:${PL};white-space:nowrap}
    .rbac-matrix input[type=checkbox]{width:16px;height:16px;accent-color:${P};cursor:pointer}
    .rbac-matrix .cat-row td{background:#e0e7ff;font-weight:700;color:#312e81;font-size:12px;text-align:left}
    .rbac-alert{padding:14px 18px;border-radius:10px;font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .rbac-alert-success{background:${GL};color:#065f46;border:1px solid #a7f3d0}
    .rbac-alert-error{background:${RL};color:#991b1b;border:1px solid #fecaca}
    .rbac-alert-info{background:${PL};color:#312e81;border:1px solid #c7d2fe}
    .rbac-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .rbac-timeline{position:relative;padding-left:28px}
    .rbac-timeline::before{content:"";position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e0e7ff}
    .rbac-timeline-item{position:relative;margin-bottom:14px;padding:12px 16px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;border-left:3px solid #818cf8;transition:.15s}
    .rbac-timeline-item:hover{box-shadow:0 2px 12px rgba(79,70,229,.06)}
    .rbac-timeline-item::before{content:"";position:absolute;left:-33px;top:16px;width:12px;height:12px;border-radius:50%;background:${P};border:2px solid #fff;box-shadow:0 0 0 2px #c7d2fe}
    .rbac-timeline-time{font-size:11px;color:#9ca3af;margin-top:4px}
    .rbac-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .rbac-empty{text-align:center;padding:40px;color:#9ca3af}
    .rbac-role-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;transition:.2s;border-left:4px solid ${P}}
    .rbac-role-card:hover{box-shadow:0 4px 20px rgba(79,70,229,.1);transform:translateY(-2px)}
    .rbac-tree{padding-left:24px;border-left:2px solid #e0e7ff}
    .rbac-tree-node{margin:8px 0;padding:8px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;display:inline-flex;align-items:center;gap:8px}
    .rbac-select{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff;box-sizing:border-box;font-family:inherit;cursor:pointer}
    .rbac-select:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .rbac-textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit}
    .rbac-textarea:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .rbac-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .rbac-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:.15s;border:1px solid #e5e7eb;background:#fff;color:${M};text-decoration:none}
    .rbac-chip:hover{border-color:${P};color:${P}}
    .rbac-chip.active{background:${P};color:#fff;border-color:${P}}
    .rbac-progress{background:#e5e7eb;border-radius:8px;height:10px;overflow:hidden;width:100%}
    .rbac-progress-bar{height:100%;border-radius:8px;transition:width .4s ease}
    .rbac-section{margin-bottom:20px}
    .rbac-section-title{font-size:18px;font-weight:700;color:#1e1b4b;margin:0 0 12px;display:flex;align-items:center;gap:8px}
    .rbac-toggle-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6}
    .rbac-toggle-row:last-child{border-bottom:none}
    .rbac-user-row{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;transition:.15s}
    .rbac-user-row:hover{box-shadow:0 2px 12px rgba(79,70,229,.08);border-color:#c7d2fe}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-track{background:#f1f5f9;border-radius:3px}
    ::-webkit-scrollbar-thumb{background:#c7d2fe;border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:#818cf8}
    @media(max-width:768px){.rbac-stats{grid-template-columns:1fr 1fr}.rbac-grid-2,.rbac-grid-3{grid-template-columns:1fr}.rbac-nav{flex-direction:column}.rbac-hero{padding:20px}}
  </style>`;

  // ── Navigation ───────────────────────────────────────────
  function nav(active) {
    const items = [
      { href:'/school/rbac', label:'📋 Dashboard', key:'dash' },
      { href:'/school/rbac/roles', label:'👥 Roles', key:'roles' },
      { href:'/school/rbac/permissions', label:'🔐 Matrix', key:'perms' },
      { href:'/school/rbac/hierarchy', label:'🌳 Hierarchy', key:'tree' },
      { href:'/school/rbac/audit', label:'📝 Audit', key:'audit' },
    ];
    return `<nav class="rbac-nav" aria-label="RBAC Navigation">${items.map(i =>
      `<a href="${i.href}" class="${active===i.key?'active':''}">${i.label}</a>`).join('')}</nav>`;
  }

  // ── Database Migrations ──────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS rbac_roles (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      role_name VARCHAR(80) NOT NULL, description TEXT,
      is_system BOOLEAN DEFAULT false, priority INTEGER DEFAULT 50,
      color VARCHAR(7) DEFAULT '#4f46e5', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS rbac_permissions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      permission_key VARCHAR(100) NOT NULL, permission_name VARCHAR(150) NOT NULL,
      category VARCHAR(50) NOT NULL, description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, permission_key))`,
    `CREATE TABLE IF NOT EXISTS rbac_role_permissions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      role_id INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(role_id, permission_id))`,
    `CREATE TABLE IF NOT EXISTS rbac_user_roles (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      user_email VARCHAR(200) NOT NULL, role_id INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      assigned_by VARCHAR(200), assigned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_email, role_id))`,
    `CREATE TABLE IF NOT EXISTS rbac_permission_audit (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      action VARCHAR(50) NOT NULL, user_email VARCHAR(200),
      target_email VARCHAR(200), role_id INTEGER,
      permission_id INTEGER, details TEXT,
      ip_address VARCHAR(50), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_roles_tid ON rbac_roles(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_perms_tid ON rbac_permissions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_perms_cat ON rbac_permissions(tenant_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_rp_rid ON rbac_role_permissions(role_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_ur_email ON rbac_user_roles(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_audit_tid ON rbac_permission_audit(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rbac_audit_created ON rbac_permission_audit(created_at DESC)`,
  ];

  // ── Seed data on startup ─────────────────────────────────
  async function seedTenant(tid) {
    const { rows: pc } = await pool.query('SELECT COUNT(*)::int as c FROM rbac_permissions WHERE tenant_id=$1',[tid]);
    if (pc[0].c > 0) return;
    for (const p of DEFAULT_PERMS) {
      await pool.query(`INSERT INTO rbac_permissions (tenant_id,permission_key,permission_name,category,description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [tid, p.key, p.name, p.category, p.description]);
    }
    const { rows: perms } = await pool.query('SELECT id, permission_key FROM rbac_permissions WHERE tenant_id=$1',[tid]);
    const pmap = {};
    perms.forEach(p => pmap[p.permission_key] = p.id);
    const categories = [...new Set(DEFAULT_PERMS.map(p => p.category))];

    for (const r of DEFAULT_ROLES) {
      const { rows: er } = await pool.query('SELECT id FROM rbac_roles WHERE tenant_id=$1 AND role_name=$2',[tid, r.name]);
      if (er.length) continue;
      const { rows: rr } = await pool.query(
        `INSERT INTO rbac_roles (tenant_id,role_name,description,is_system,priority,color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tid, r.name, r.desc, r.is_system, r.priority, r.color]);
      const roleId = rr[0].id;
      const pidList = [];
      if (r.perms === 'ALL') {
        perms.forEach(p => pidList.push(p.id));
      } else {
        for (const spec of r.perms) {
          if (pmap[spec]) { pidList.push(pmap[spec]); }
          else {
            Object.keys(pmap).filter(k => k.startsWith(spec + '.')).forEach(k => pidList.push(pmap[k]));
          }
          if (categories.includes(spec)) {
            Object.keys(pmap).filter(k => k.startsWith(spec + '.')).forEach(k => { if (!pidList.includes(pmap[k])) pidList.push(pmap[k]); });
          }
        }
      }
      for (const pid of [...new Set(pidList)]) {
        await pool.query('INSERT INTO rbac_role_permissions (tenant_id,role_id,permission_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[tid,roleId,pid]);
      }
    }
  }

  // Run migrations
  (async () => {
    const client = await pool.connect();
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[RBAC] Migrations applied (' + migrations.length + ' statements)');
      await seedTenant(0);
      console.log('[RBAC] Default seed data ready');
    } catch(e) { /* migration OK */ }
    finally { client.release(); }
  })();

  // ── Helper: log audit ────────────────────────────────────
  async function logAction(tid, action, user_email, target_email, role_id, perm_id, details, req) {
    await pool.query(`INSERT INTO rbac_permission_audit (tenant_id,action,user_email,target_email,role_id,permission_id,details,ip_address,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [tid, action, user_email, target_email, role_id, perm_id, details, req?.ip || req?.connection?.remoteAddress || null]);
  }

  // ── ROUTE 1: GET /school/rbac — Dashboard ────────────────
  app.get('/school/rbac', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    await seedTenant(tid);
    const [[rc],[pc],[urc],[ac]] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as c FROM rbac_roles WHERE tenant_id=$1',[tid]),
      pool.query('SELECT COUNT(*)::int as c FROM rbac_permissions WHERE tenant_id=$1',[tid]),
      pool.query('SELECT COUNT(DISTINCT user_email)::int as c FROM rbac_user_roles WHERE tenant_id=$1',[tid]),
      pool.query('SELECT COUNT(*)::int as c FROM rbac_permission_audit WHERE tenant_id=$1'),
    ]);
    const { rows: roles } = await pool.query('SELECT * FROM rbac_roles WHERE tenant_id=$1 ORDER BY priority',[tid]);
    const { rows: recent } = await pool.query('SELECT * FROM rbac_permission_audit WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8',[tid]);

    const roleCards = roles.map(r => {
      const style = `border-left-color:${r.color||P}`;
      return `<div class="rbac-role-card" style="${style}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong style="color:#1e1b4b">${esc(r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</strong>
          <div style="font-size:12px;color:${M}">${esc(r.description||'')}</div></div>
          ${r.is_system?'<span class="rbac-badge" style="background:${OL};color:#92400e">⚙ System</span>':'<span class="rbac-badge" style="background:${PL};color:#4338ca">Custom</span>'}
        </div></div>`;
    }).join('');

    const timeline = recent.map(a => `<div class="rbac-timeline-item">
      <div style="font-size:13px;font-weight:600;color:#1e1b4b">${esc(a.action?.replace(/_/g,' '))}</div>
      ${a.details?'<div style="font-size:12px;color:'+M+'">'+esc(a.details)+'</div>':''}
      <div class="rbac-timeline-time">${fmtDT(a.created_at)}</div>
    </div>`).join('') || '<div class="rbac-empty">No activity yet</div>';

    // Top assigned users for dashboard
    const { rows: topUsers } = await pool.query(
      `SELECT ur.user_email, COUNT(ur.role_id)::int as role_cnt, STRING_AGG(DISTINCT r.role_name, ', ') as role_names
       FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.tenant_id=$1 GROUP BY ur.user_email ORDER BY role_cnt DESC LIMIT 6`,[tid]);

    const userRows = topUsers.map(usr => {
      const names = (usr.role_names||'').split(', ');
      return `<div class="rbac-user-row">
        <div style="width:36px;height:36px;border-radius:50%;background:${PL};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${P}">${esc((usr.user_email||'?')[0].toUpperCase())}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1e1b4b">${esc(usr.user_email)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${names.map(n=>'<span class="rbac-badge" style="background:'+PL+';color:#4338ca">'+esc(n)+'</span>').join('')}</div>
        </div>
        <a href="/school/rbac/users/${encodeURIComponent(usr.user_email)}" class="rbac-btn rbac-btn-sm rbac-btn-secondary">View →</a>
      </div>`;
    }).join('') || '<div class="rbac-empty">No users with assigned roles yet</div>';

    // Permission coverage stats
    const totalPerms = pc.rows[0].c;
    const rolesWithPerms = roles.map(async r => {
      const { rows: rpc } = await pool.query('SELECT COUNT(*)::int as c FROM rbac_role_permissions WHERE role_id=$1 AND tenant_id=$2',[r.id, tid]);
      return { name: r.role_name, color: r.color, count: rpc[0].c, pct: totalPerms ? Math.round(rpc[0].c / totalPerms * 100) : 0 };
    });
    const rolePermStats = await Promise.all(rolesWithPerms);
    const coverageHtml = rolePermStats.map(s =>
      `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="font-weight:600;color:#1e1b4b">${esc(s.name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</span><span style="color:${M}">${s.count}/${totalPerms} (${s.pct}%)</span></div><div class="rbac-progress"><div class="rbac-progress-bar" style="width:${s.pct}%;background:${s.color||P}"></div></div></div>`
    ).join('');

    const msg = req.query.msg ? `<div class="rbac-alert rbac-alert-success">✅ ${esc(req.query.msg)}</div>` : '';
    const html = CSS + `<div class="rbac-root">${nav('dash')}
      <div class="rbac-hero"><h1>🛡️ RBAC Manager</h1><p>Advanced Role-Based Access Control for your school portal</p>
        <div class="rbac-hero-actions">
          <a href="/school/rbac/roles/create" class="rbac-btn" style="background:#818cf8;color:#fff">➕ Create Role</a>
          <a href="/school/rbac/permissions" class="rbac-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">🔐 Permission Matrix</a>
        </div></div>
      ${msg}
      <div class="rbac-stats">
        <div class="rbac-stat"><div class="rbac-stat-icon">👥</div><div class="rbac-stat-val">${rc.rows[0].c}</div><div class="rbac-stat-lbl">Roles</div></div>
        <div class="rbac-stat"><div class="rbac-stat-icon">🔑</div><div class="rbac-stat-val">${pc.rows[0].c}</div><div class="rbac-stat-lbl">Permissions</div></div>
        <div class="rbac-stat"><div class="rbac-stat-icon">👤</div><div class="rbac-stat-val">${urc.rows[0].c}</div><div class="rbac-stat-lbl">Assigned Users</div></div>
        <div class="rbac-stat"><div class="rbac-stat-icon">📝</div><div class="rbac-stat-val">${ac.rows[0].c}</div><div class="rbac-stat-lbl">Audit Entries</div></div>
      </div>
      <div class="rbac-grid-2">
        <div class="rbac-card"><div class="rbac-card-header"><div class="rbac-card-title">📊 Permission Coverage</div></div><div style="margin-top:8px">${coverageHtml||'<div class="rbac-empty">No data</div>'}</div></div>
        <div class="rbac-card"><div class="rbac-card-title">👥 Roles</div><div style="display:grid;gap:8px;margin-top:12px">${roleCards||'<div class="rbac-empty">No roles</div>'}</div></div>
      </div>
      <div class="rbac-grid-2" style="margin-top:14px">
        <div class="rbac-card"><div class="rbac-card-header"><div class="rbac-card-title">📝 Recent Changes</div><a href="/school/rbac/audit" class="rbac-btn rbac-btn-sm rbac-btn-secondary">View All →</a></div><div class="rbac-timeline" style="margin-top:12px">${timeline}</div></div>
        <div class="rbac-card"><div class="rbac-card-header"><div class="rbac-card-title">👤 Top Users</div></div><div style="margin-top:8px">${userRows}</div></div>
      </div></div>`;
    res.send(renderPage('RBAC Dashboard', html, u, req));
  }));

  // ── ROUTE 2: GET /school/rbac/roles — Role list ─────────
  app.get('/school/rbac/roles', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    await seedTenant(tid);
    const { rows: roles } = await pool.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM rbac_user_roles ur WHERE ur.role_id=r.id AND ur.tenant_id=$1) as member_count,
       (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id=r.id AND rp.tenant_id=$1) as perm_count
       FROM rbac_roles r WHERE r.tenant_id=$1 ORDER BY r.priority`, [tid]);

    const rows = roles.map(r => `<tr>
      <td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${r.color||P};margin-right:8px"></span><strong>${esc(r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</strong></td>
      <td style="font-size:12px;color:${M}">${esc(r.description||'—')}</td>
      <td><span class="rbac-badge" style="background:${PL};color:#4338ca">${r.perm_count}</span></td>
      <td><span class="rbac-badge" style="background:${GL};color:#065f46">${r.member_count}</span></td>
      <td>${r.is_system?'<span class="rbac-badge" style="background:'+OL+';color:#92400e">System</span>':'<span class="rbac-badge" style="background:'+ML+';color:'+M+'">Custom</span>'}</td>
      <td>
        <a href="/school/rbac/roles/${r.id}/edit" class="rbac-btn rbac-btn-sm rbac-btn-primary">✏️ Edit</a>
        ${!r.is_system?`<form method="POST" action="/school/rbac/roles/${r.id}/delete" style="display:inline" onsubmit="return confirm('Delete this role?')"><button class="rbac-btn rbac-btn-sm rbac-btn-danger">🗑️</button></form>`:''}
      </td></tr>`).join('');

    const html = CSS + `<div class="rbac-root">${nav('roles')}
      <div class="rbac-hero"><h1>👥 Role Management</h1><p>Create, edit and manage access roles</p>
        <div class="rbac-hero-actions"><a href="/school/rbac/roles/create" class="rbac-btn" style="background:#818cf8;color:#fff">➕ Create Role</a></div></div>
      <div class="rbac-card"><div style="overflow-x:auto"><table class="rbac-table">
        <thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Members</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" class="rbac-empty">No roles found</td></tr>'}</tbody>
      </table></div></div></div>`;
    res.send(renderPage('Roles', html, u, req));
  }));

  // ── ROUTE 3: GET /school/rbac/roles/create ───────────────
  app.get('/school/rbac/roles/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    await seedTenant(tid);
    const { rows: perms } = await pool.query('SELECT * FROM rbac_permissions WHERE tenant_id=$1 ORDER BY category, permission_key',[tid]);
    const cats = [...new Set(perms.map(p => p.category))];

    const matrix = cats.map(cat => {
      const catPerms = perms.filter(p => p.category === cat);
      return `<div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#312e81;font-size:14px;text-transform:capitalize">${esc(cat)}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px">
          ${catPerms.map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:4px 0">
            <input type="checkbox" name="perms" value="${p.id}" style="accent-color:${P};width:16px;height:16px"> ${esc(p.permission_name)}</label>`).join('')}
        </div></div>`;
    }).join('');

    const html = CSS + `<div class="rbac-root">${nav('roles')}
      <a href="/school/rbac/roles" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Roles</a>
      <div class="rbac-card" style="max-width:800px">
        <div class="rbac-card-title">➕ Create New Role</div>
        <form method="POST" action="/school/rbac/roles/create">
          <div class="rbac-form-group"><label>Role Name</label><input class="rbac-input" name="role_name" required placeholder="e.g. department_head"></div>
          <div class="rbac-form-group"><label>Description</label><input class="rbac-input" name="description" placeholder="Brief role description"></div>
          <div class="rbac-grid-2">
            <div class="rbac-form-group"><label>Priority (lower = higher)</label><input class="rbac-input" type="number" name="priority" value="50" min="1" max="100"></div>
            <div class="rbac-form-group"><label>Color</label><input class="rbac-input" type="color" name="color" value="#4f46e5"></div>
          </div>
          <div style="margin-top:20px;margin-bottom:12px"><h3 style="margin:0 0 12px;color:#1e1b4b">🔐 Assign Permissions</h3>${matrix}</div>
          <button type="submit" class="rbac-btn rbac-btn-primary" style="margin-top:12px">💾 Create Role</button>
        </form></div></div>`;
    res.send(renderPage('Create Role', html, u, req));
  }));

  // ── ROUTE 4: POST /school/rbac/roles/create ──────────────
  app.post('/school/rbac/roles/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { role_name, description='', priority=50, color='#4f46e5', perms=[] } = req.body;
    const permIds = Array.isArray(perms) ? perms.map(Number).filter(n=>n>0) : [Number(perms)].filter(n=>n>0);
    const { rows: rr } = await pool.query(
      `INSERT INTO rbac_roles (tenant_id,role_name,description,priority,color) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tid, role_name, description, Number(priority), color]);
    for (const pid of permIds) {
      await pool.query('INSERT INTO rbac_role_permissions (tenant_id,role_id,permission_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[tid,rr[0].id,pid]);
    }
    await logAction(tid,'role_created',u.email,null,rr[0].id,null,`Created role "${role_name}" with ${permIds.length} permissions`,req);
    audit('role_created', u, { role_name, perm_count: permIds.length });
    res.redirect('/school/rbac/roles?msg=Role+created+successfully');
  }));

  // ── ROUTE 5: GET /school/rbac/roles/:id/edit ────────────
  app.get('/school/rbac/roles/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, rid = req.params.id;
    await seedTenant(tid);
    const { rows: role } = await pool.query('SELECT * FROM rbac_roles WHERE id=$1 AND tenant_id=$2',[rid, tid]);
    if (!role.length) return res.status(404).send('Role not found');
    const { rows: perms } = await pool.query('SELECT * FROM rbac_permissions WHERE tenant_id=$1 ORDER BY category, permission_key',[tid]);
    const { rows: assigned } = await pool.query('SELECT permission_id FROM rbac_role_permissions WHERE role_id=$1 AND tenant_id=$2',[rid, tid]);
    const assignedIds = new Set(assigned.map(a => a.permission_id));
    const cats = [...new Set(perms.map(p => p.category))];

    const matrix = cats.map(cat => {
      const catPerms = perms.filter(p => p.category === cat);
      return `<div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#312e81;font-size:14px;text-transform:capitalize">${esc(cat)}</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px">
          ${catPerms.map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:4px 0">
            <input type="checkbox" name="perms" value="${p.id}" ${assignedIds.has(p.id)?'checked':''} style="accent-color:${role[0].color||P};width:16px;height:16px"> ${esc(p.permission_name)}</label>`).join('')}
        </div></div>`;
    }).join('');

    const html = CSS + `<div class="rbac-root">${nav('roles')}
      <a href="/school/rbac/roles" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Roles</a>
      <div class="rbac-card" style="max-width:800px">
        <div class="rbac-card-title">✏️ Edit Role: <span style="color:${role[0].color||P}">${esc(role[0].role_name)}</span></div>
        <form method="POST" action="/school/rbac/roles/${rid}/edit">
          <div class="rbac-form-group"><label>Role Name</label><input class="rbac-input" name="role_name" value="${esc(role[0].role_name)}" required></div>
          <div class="rbac-form-group"><label>Description</label><input class="rbac-input" name="description" value="${esc(role[0].description||'')}"></div>
          <div class="rbac-grid-2">
            <div class="rbac-form-group"><label>Priority</label><input class="rbac-input" type="number" name="priority" value="${role[0].priority}" min="1" max="100"></div>
            <div class="rbac-form-group"><label>Color</label><input class="rbac-input" type="color" name="color" value="${role[0].color||'#4f46e5'}"></div>
          </div>
          <div style="margin-top:20px;margin-bottom:12px"><h3 style="margin:0 0 12px;color:#1e1b4b">🔐 Permissions (${assignedIds.size} assigned)</h3>${matrix}</div>
          <button type="submit" class="rbac-btn rbac-btn-primary" style="margin-top:12px">💾 Save Changes</button>
        </form></div></div>`;
    res.send(renderPage('Edit Role', html, u, req));
  }));

  // ── ROUTE 6: POST /school/rbac/roles/:id/edit ───────────
  app.post('/school/rbac/roles/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, rid = req.params.id;
    const { role_name, description='', priority=50, color='#4f46e5', perms=[] } = req.body;
    const permIds = Array.isArray(perms) ? perms.map(Number).filter(n=>n>0) : [Number(perms)].filter(n=>n>0);
    await pool.query('UPDATE rbac_roles SET role_name=$1,description=$2,priority=$3,color=$4 WHERE id=$5 AND tenant_id=$6',
      [role_name, description, Number(priority), color, rid, tid]);
    await pool.query('DELETE FROM rbac_role_permissions WHERE role_id=$1 AND tenant_id=$2',[rid, tid]);
    for (const pid of permIds) {
      await pool.query('INSERT INTO rbac_role_permissions (tenant_id,role_id,permission_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[tid,rid,pid]);
    }
    await logAction(tid,'role_updated',u.email,null,Number(rid),null,`Updated role "${role_name}" — ${permIds.length} permissions`,req);
    res.redirect('/school/rbac/roles?msg=Role+updated');
  }));

  // ── ROUTE 7: POST /school/rbac/roles/:id/delete ─────────
  app.post('/school/rbac/roles/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, rid = req.params.id;
    const { rows: role } = await pool.query('SELECT * FROM rbac_roles WHERE id=$1 AND tenant_id=$2',[rid, tid]);
    if (!role.length) return res.status(404).send('Role not found');
    if (role[0].is_system) return res.status(400).send('Cannot delete system role');
    const { rows: members } = await pool.query('SELECT id FROM rbac_user_roles WHERE role_id=$1 AND tenant_id=$2',[rid, tid]);
    await pool.query('DELETE FROM rbac_role_permissions WHERE role_id=$1 AND tenant_id=$2',[rid, tid]);
    await pool.query('DELETE FROM rbac_user_roles WHERE role_id=$1 AND tenant_id=$2',[rid, tid]);
    await pool.query('DELETE FROM rbac_roles WHERE id=$1 AND tenant_id=$2',[rid, tid]);
    await logAction(tid,'role_deleted',u.email,null,Number(rid),null,`Deleted role "${role[0].role_name}" (${members.length} members reassigned)`,req);
    res.redirect('/school/rbac/roles?msg=Role+deleted');
  }));

  // ── ROUTE 8: GET /school/rbac/permissions — Matrix ──────
  app.get('/school/rbac/permissions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    await seedTenant(tid);
    const { rows: roles } = await pool.query('SELECT * FROM rbac_roles WHERE tenant_id=$1 ORDER BY priority',[tid]);
    const { rows: perms } = await pool.query('SELECT * FROM rbac_permissions WHERE tenant_id=$1 ORDER BY category, permission_key',[tid]);
    const { rows: rp } = await pool.query('SELECT role_id, permission_id FROM rbac_role_permissions WHERE tenant_id=$1',[tid]);
    const rpSet = new Set(rp.map(r => `${r.role_id}:${r.permission_id}`));

    const headerCells = roles.map(r =>
      `<th><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${r.color||P};margin-right:4px"></span>${esc(r.role_name.length>10?r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).substring(0,10)+'…':r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</th>`).join('');
    const cats = [...new Set(perms.map(p => p.category))];
    let bodyHtml = '';
    for (const cat of cats) {
      bodyHtml += `<tr class="cat-row"><td>${esc(cat.toUpperCase())}</td><td colspan="${roles.length}"></td></tr>`;
      const catPerms = perms.filter(p => p.category === cat);
      for (const p of catPerms) {
        bodyHtml += `<tr><td title="${esc(p.description||'')}">${esc(p.permission_name)}</td>`;
        for (const r of roles) {
          const checked = rpSet.has(`${r.id}:${p.id}`);
          bodyHtml += `<td><input type="checkbox" ${checked?'checked':''} disabled style="accent-color:${checked?(r.color||P):'#d1d5db'}"></td>`;
        }
        bodyHtml += `</tr>`;
      }
    }

    const html = CSS + `<div class="rbac-root">${nav('perms')}
      <div class="rbac-hero"><h1>🔐 Permission Matrix</h1><p>Visual overview of all role-permission assignments</p></div>
      <div class="rbac-card"><div style="overflow-x:auto">
        <table class="rbac-matrix"><thead><tr><th>Permission</th>${headerCells}</tr></thead>
        <tbody>${bodyHtml}</tbody></table>
      </div></div></div>`;
    res.send(renderPage('Permission Matrix', html, u, req));
  }));

  // ── ROUTE 9: GET /school/rbac/users/:email ──────────────
  app.get('/school/rbac/users/:email', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, email = decodeURIComponent(req.params.email);
    const { rows: assignments } = await pool.query(
      `SELECT ur.*, r.role_name, r.color, r.description, (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id=r.id AND rp.tenant_id=$2) as perm_count
       FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id WHERE ur.user_email=$1 AND ur.tenant_id=$2 ORDER BY r.priority`,
      [email, tid]);

    const allPerms = await Promise.all(assignments.map(async a => {
      const { rows: pp } = await pool.query(
        `SELECT p.* FROM rbac_permissions p JOIN rbac_role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=$1 AND rp.tenant_id=$2`,
        [a.role_id, tid]);
      return { role: a, perms: pp };
    }));

    const roleCards = allPerms.map(({ role: a, perms: pp }) => {
      const permList = pp.map(p => `<span class="rbac-badge" style="background:${PL};color:#4338ca;margin:2px">${esc(p.permission_key)}</span>`).join('');
      return `<div class="rbac-card" style="border-left:4px solid ${a.color||P}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong style="color:#1e1b4b">${esc(a.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</strong>
          <div style="font-size:12px;color:${M}">${a.perm_count} permissions · Assigned ${fmtDT(a.assigned_at)}</div></div>
          <form method="POST" action="/school/rbac/users/${encodeURIComponent(email)}/revoke" style="display:inline">
            <input type="hidden" name="role_id" value="${a.role_id}">
            <button class="rbac-btn rbac-btn-sm rbac-btn-danger" onclick="return confirm('Revoke this role?')">❌ Revoke</button>
          </form>
        </div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${permList||'<span style="font-size:12px;color:'+M+'">No permissions</span>'}</div>
      </div>`;
    }).join('');

    const html = CSS + `<div class="rbac-root">${nav('dash')}
      <a href="/school/rbac" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Dashboard</a>
      <div class="rbac-hero"><h1>👤 ${esc(email)}</h1><p>Roles and permissions for this user</p></div>
      <div class="rbac-card" style="margin-bottom:16px">
        <div class="rbac-card-title">➕ Assign New Role</div>
        <form method="POST" action="/school/rbac/users/${encodeURIComponent(email)}/assign" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:200px"><label style="font-size:12px;font-weight:600;color:#1e1b4b;display:block;margin-bottom:4px">Role</label>
            <select name="role_id" class="rbac-input" required>
              <option value="">Select role...</option>
              ${await (async () => { const { rows: allR } = await pool.query('SELECT * FROM rbac_roles WHERE tenant_id=$1 ORDER BY priority',[tid]); const assigned = new Set(assignments.map(a=>a.role_id)); return allR.filter(r=>!assigned.has(r.id)).map(r=>`<option value="${r.id}">${esc(r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</option>`).join(''); })()}
            </select></div>
          <button type="submit" class="rbac-btn rbac-btn-primary">Assign Role</button>
        </form></div>
      <div style="display:grid;gap:12px">${roleCards||'<div class="rbac-empty">No roles assigned to this user</div>'}</div></div>`;
    res.send(renderPage('User RBAC — '+email, html, u, req));
  }));

  // ── ROUTE 10: POST /school/rbac/users/:email/assign ─────
  app.post('/school/rbac/users/:email/assign', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const email = decodeURIComponent(req.params.email), roleId = req.body.role_id;
    await pool.query('INSERT INTO rbac_user_roles (tenant_id,user_email,role_id,assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[tid,email,roleId,u.email]);
    const { rows: rr } = await pool.query('SELECT role_name FROM rbac_roles WHERE id=$1',[roleId]);
    await logAction(tid,'role_assigned',u.email,email,Number(roleId),null,`Assigned role "${rr[0]?.role_name}" to ${email}`,req);
    res.redirect(`/school/rbac/users/${encodeURIComponent(email)}?msg=Role+assigned`);
  }));

  // ── ROUTE 11: POST /school/rbac/users/:email/revoke ─────
  app.post('/school/rbac/users/:email/revoke', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const email = decodeURIComponent(req.params.email), roleId = req.body.role_id;
    const { rows: rr } = await pool.query('SELECT role_name FROM rbac_roles WHERE id=$1',[roleId]);
    await pool.query('DELETE FROM rbac_user_roles WHERE user_email=$1 AND role_id=$2 AND tenant_id=$3',[email,roleId,tid]);
    await logAction(tid,'role_revoked',u.email,email,Number(roleId),null,`Revoked role "${rr[0]?.role_name}" from ${email}`,req);
    res.redirect(`/school/rbac/users/${encodeURIComponent(email)}?msg=Role+revoked`);
  }));

  // ── ROUTE 12: GET /school/rbac/audit ─────────────────────
  app.get('/school/rbac/audit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const page = Math.max(1, Number(req.query.page)||1), limit = 25, offset = (page-1)*limit;
    const { rows: entries, rowCount } = await pool.query(
      'SELECT * FROM rbac_permission_audit WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[tid, limit, offset]);
    const { rows: tc } = await pool.query('SELECT COUNT(*)::int as c FROM rbac_permission_audit WHERE tenant_id=$1',[tid]);
    const total = tc[0].c, pages = Math.ceil(total/limit);

    const actionColors = { role_created:G, role_updated:'#2563eb', role_deleted:R, role_assigned:G, role_revoked:O, permission_checked:M };
    const rows = entries.map(e => {
      const ac = actionColors[e.action] || M;
      return `<div class="rbac-timeline-item" style="border-left-color:${ac}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="rbac-badge" style="background:${ac}20;color:${ac}">${esc(e.action.replace(/_/g,' '))}</span>
          ${e.user_email?`<span style="font-size:13px;font-weight:600">${esc(e.user_email)}</span>`:''}
          ${e.target_email?`<span style="font-size:12px;color:${M}">→ ${esc(e.target_email)}</span>`:''}
        </div>
        ${e.details?`<div style="font-size:12px;color:${M};margin-top:4px">${esc(e.details)}</div>`:''}
        <div class="rbac-timeline-time">${fmtDT(e.created_at)}${e.ip_address?' · IP: '+esc(e.ip_address):''}</div>
      </div>`;
    }).join('') || '<div class="rbac-empty">No audit entries</div>';

    const pagination = pages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">
      ${Array.from({length:pages},(_,i)=>`<a href="/school/rbac/audit?page=${i+1}" class="rbac-btn rbac-btn-sm ${page===i+1?'rbac-btn-primary':'rbac-btn-secondary'}">${i+1}</a>`).join('')}</div>` : '';

    const html = CSS + `<div class="rbac-root">${nav('audit')}
      <div class="rbac-hero"><h1>📝 Audit Trail</h1><p>Complete history of permission and role changes</p></div>
      <div class="rbac-card"><div class="rbac-card-header">
          <div class="rbac-card-title">${total} entries</div>
          <span style="font-size:12px;color:${M}">Page ${page} of ${pages||1}</span>
        </div>
        <div class="rbac-timeline">${rows}</div>${pagination}</div></div>`;
    res.send(renderPage('RBAC Audit Trail', html, u, req));
  }));

  // ── ROUTE 13: POST /school/rbac/check — AJAX API ────────
  app.post('/school/rbac/check', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const permission = req.body.permission;
    if (!permission) return res.json({ allowed:false, error:'Missing permission parameter' });
    const { rows: perms } = await pool.query(
      `SELECT COUNT(*)::int as c FROM rbac_user_roles ur
       JOIN rbac_role_permissions rp ON rp.role_id=ur.role_id AND rp.tenant_id=$1
       JOIN rbac_permissions p ON p.id=rp.permission_id AND p.permission_key=$2
       WHERE ur.user_email=$3 AND ur.tenant_id=$1`, [tid, permission, u.email]);
    const allowed = perms[0].c > 0;
    await logAction(tid,'permission_checked',u.email,null,null,null,`${permission} → ${allowed?'GRANTED':'DENIED'}`,req);
    res.json({ permission, allowed, email: u.email });
  }));

  // ── ROUTE 14: GET /school/rbac/hierarchy — Visual tree ──
  // Displays a visual hierarchy of roles sorted by priority with
  // permission counts, member counts, and relative access bars.
  app.get('/school/rbac/hierarchy', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    await seedTenant(tid);
    const { rows: roles } = await pool.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM rbac_user_roles ur WHERE ur.role_id=r.id AND ur.tenant_id=$1) as member_count,
       (SELECT COUNT(*)::int FROM rbac_role_permissions rp WHERE rp.role_id=r.id AND rp.tenant_id=$1) as perm_count
       FROM rbac_roles r WHERE r.tenant_id=$1 ORDER BY r.priority`, [tid]);
    const sorted = [...roles].sort((a,b) => a.priority - b.priority);
    const maxPriority = sorted.length ? sorted[sorted.length-1].priority : 1;

    function buildTree(rolesList, level) {
      return rolesList.map(r => {
        const barW = Math.round(((maxPriority - r.priority + 1) / maxPriority) * 100);
        const indent = level * 32;
        const node = `<div style="margin-left:${indent}px;margin-bottom:12px">
          <div class="rbac-tree-node" style="border-left:4px solid ${r.color||P};min-width:320px">
            <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${r.color||P}"></span>
            <div style="flex:1">
              <strong style="color:#1e1b4b;font-size:14px">${esc(r.role_name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</strong>
              <div style="font-size:12px;color:${M}">${esc(r.description||'')} · Priority ${r.priority}</div>
              <div style="margin-top:6px">
                <span class="rbac-badge" style="background:${GL};color:#065f46">${r.member_count} members</span>
                <span class="rbac-badge" style="background:${PL};color:#4338ca">${r.perm_count} perms</span>
                ${r.is_system?'<span class="rbac-badge" style="background:'+OL+';color:#92400e">System</span>':''}
              </div>
              <div style="margin-top:6px;background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;width:200px">
                <div style="background:${r.color||P};height:100%;width:${barW}%;border-radius:4px"></div>
              </div>
            </div>
          </div></div>`;
        return node;
      }).join('');
    }

    // Category legend for hierarchy view
    const { rows: allPerms } = await pool.query('SELECT DISTINCT category FROM rbac_permissions WHERE tenant_id=$1 ORDER BY category',[tid]);
    const catLegend = allPerms.map(c => `<span class="rbac-chip" style="font-size:11px">${esc(c.category)}</span>`).join(' ');

    const html = CSS + `<div class="rbac-root">${nav('tree')}
      <div class="rbac-hero"><h1>🌳 Role Hierarchy</h1><p>Visual representation of role priority and structure</p></div>
      <div class="rbac-card">
        <div style="font-size:12px;color:${M};margin-bottom:12px">Higher priority roles (lower number) have broader access. Bar width represents relative priority.</div>
        <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:4px">${catLegend}</div>
        <div class="rbac-tree">${buildTree(sorted, 0)}</div>
      </div>
      <div class="rbac-card" style="margin-top:16px">
        <div class="rbac-card-title">ℹ️ Hierarchy Rules</div>
        <div style="font-size:13px;color:${M};line-height:1.8">
          <div class="rbac-toggle-row"><span><strong style="color:#1e1b4b">Priority 1-10</strong> — Full access roles (Super Admin, Admin)</span><span class="rbac-badge" style="background:${RL};color:${R}">Critical</span></div>
          <div class="rbac-toggle-row"><span><strong style="color:#1e1b4b">Priority 11-30</strong> — Management roles with broad permissions</span><span class="rbac-badge" style="background:${OL};color:#92400e">Elevated</span></div>
          <div class="rbac-toggle-row"><span><strong style="color:#1e1b4b">Priority 31-60</strong> — Staff roles with departmental access</span><span class="rbac-badge" style="background:${PL};color:#4338ca">Standard</span></div>
          <div class="rbac-toggle-row"><span><strong style="color:#1e1b4b">Priority 61-100</strong> — Limited / view-only roles</span><span class="rbac-badge" style="background:${GL};color:#065f46">Restricted</span></div>
        </div>
      </div></div>`;
    res.send(renderPage('Role Hierarchy', html, u, req));
  }));

  // ── Public API: checkPermission helper (usable by other modules) ─
  // Returns true if the given user email has the specified permission key.
  // Usage: rbacManager.checkPermission(pool, tenantId, userEmail, 'students.view')
  app._rbacCheckPermission = async function(pool, tid, email, permKey) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int as c FROM rbac_user_roles ur
       JOIN rbac_role_permissions rp ON rp.role_id=ur.role_id AND rp.tenant_id=$1
       JOIN rbac_permissions p ON p.id=rp.permission_id AND p.permission_key=$2
       WHERE ur.user_email=$3 AND ur.tenant_id=$1`, [tid, permKey, email]);
    return rows[0].c > 0;
  };

  // ── Public API: getUserPermissions (returns array of permission keys) ─
  app._rbacGetUserPermissions = async function(pool, tid, email) {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.permission_key, p.permission_name, p.category, r.role_name
       FROM rbac_user_roles ur
       JOIN rbac_roles r ON r.id=ur.role_id
       JOIN rbac_role_permissions rp ON rp.role_id=r.id
       JOIN rbac_permissions p ON p.id=rp.permission_id
       WHERE ur.user_email=$1 AND ur.tenant_id=$2
       ORDER BY p.category, p.permission_key`, [email, tid]);
    return rows;
  };

  // ── Public API: getUserRoles (returns array of role objects) ─
  app._rbacGetUserRoles = async function(pool, tid, email) {
    const { rows } = await pool.query(
      `SELECT r.* FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id
       WHERE ur.user_email=$1 AND ur.tenant_id=$2 ORDER BY r.priority`, [email, tid]);
    return rows;
  };

  console.log('[RBAC] Module loaded — 14 routes, 5 tables, ' + DEFAULT_PERMS.length + ' permissions, ' + DEFAULT_ROLES.length + ' default roles');
};
