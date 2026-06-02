'use strict';
// ============================================================
// STAFF ACCESS CONTROL MODULE — SSEWASSWA Comfort Platform
// Multi-tenant Role-Based Access Control (RBAC) for managing
// sub-managers, workers, permissions, positions, and audit logs.
// ============================================================
// Usage in server.js:
//   const staffAccessControl = require('./staff-access-control');
//   staffAccessControl(app, db, pool, renderPage, esc);
// ============================================================

const { migrateQuery } = require('./db');
module.exports = function staffAccessControl(app, db, pool, renderPage, esc) {

  // ============================================================
  // INTERNAL HELPERS & MIDDLEWARE
  // ============================================================
  var requireAuth = function(req, res, next) {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };

  var ah = function(fn) {
    return function(req, res, next) {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  };

  if (!esc) {
    esc = function(s) {
      return String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
        .replace(/([&<>"'])/g, function(m) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
        });
    };
  }

  var fmtMoney = function(n) { return 'UGX ' + Number(n || 0).toLocaleString(); };
  var fmtDate = function(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014'; };
  var fmtDateTime = function(d) { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'; };
  var today = function() { return new Date().toISOString().split('T')[0]; };
  var pct = function(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; };

  var bcrypt;
  try { bcrypt = require('bcrypt'); } catch (e) {
    try { bcrypt = require('bcryptjs'); } catch (e2) { bcrypt = null; }
  }

  // ============================================================
  // COLOR THEME — Deep Purple / Slate
  // ============================================================
  var C = {
    primary: '#7c3aed',
    dark: '#1e1b4b',
    accent: '#a78bfa',
    light: '#ede9fe',
    lighter: '#f5f3ff',
    text: '#1e1b4b',
    muted: '#6b7280',
    faint: '#9ca3af',
    border: '#e5e7eb',
    surface: '#f9fafb',
    white: '#ffffff',
    green: '#059669',
    greenLight: '#d1fae5',
    red: '#dc2626',
    redLight: '#fee2e2',
    orange: '#d97706',
    orangeLight: '#fef3c7',
    blue: '#2563eb',
    blueLight: '#dbeafe',
    purple: '#7c3aed',
    purpleLight: '#ede9fe'
  };

  // ============================================================
  // PERMISSION MODULES & FEATURES
  // ============================================================
  var PERM_MODULES = [
    'Students', 'Staff', 'Fees', 'Attendance', 'Academics', 'Reports',
    'Finance', 'Inventory', 'Communications', 'Settings', 'Users',
    'Exams', 'Transport', 'Library', 'Sports', 'Health', 'Events'
  ];
  var PERM_FEATURES = ['view', 'create', 'edit', 'delete', 'export'];

  // ============================================================
  // UI BADGE HELPERS
  // ============================================================
  function roleBadge(role) {
    var map = {
      super_admin: { bg: '#fef3c7', c: '#92400e', icon: '\u{1F451}' },
      admin: { bg: '#ede9fe', c: '#5b21b6', icon: '\u{1F396}' },
      manager: { bg: '#e0e7ff', c: '#3730a3', icon: '\u{1F4BC}' },
      head_teacher: { bg: '#dbeafe', c: '#1e40af', icon: '\u{1F9D0}' },
      bursar: { bg: '#d1fae5', c: '#065f46', icon: '\u{1F4B0}' },
      staff: { bg: '#f1f5f9', c: '#334155', icon: '\u{1F465}' },
      teacher: { bg: '#fce7f3', c: '#9d174d', icon: '\u{1F4DA}' },
      viewer: { bg: '#f1f5f9', c: '#475569', icon: '\u{1F441}' }
    };
    var s = map[role] || map.staff;
    return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + (s.icon || '') + ' ' + esc(role || 'staff') + '</span>';
  }

  function statusBadge(status, approved, banned) {
    if (banned) return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + C.redLight + ';color:' + C.red + '">\u{1F6AB} Banned</span>';
    if (!approved) return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + C.orangeLight + ';color:' + C.orange + '">\u{23F3} Pending</span>';
    if (status === 'active' || status === true) return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + C.greenLight + ';color:' + C.green + '">\u{2705} Active</span>';
    return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#f1f5f9;color:#94a3b8">\u{23F8} Inactive</span>';
  }

  function actionColor(action) {
    var map = {
      user_created: C.green,
      role_changed: C.blue,
      permission_updated: C.purple,
      user_activated: C.green,
      user_deactivated: C.orange,
      user_banned: C.red,
      user_unbanned: C.blue,
      login_allowed: C.green,
      login_blocked: C.red
    };
    return map[action] || C.muted;
  }

  function actionLabel(action) {
    return (action || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  function progressBar(pctVal, height, color) {
    var h = height || 8;
    var c = color || (pctVal >= 80 ? C.green : pctVal >= 50 ? C.primary : pctVal >= 25 ? C.orange : C.faint);
    return '<div style="background:' + C.border + ';border-radius:' + h + 'px;height:' + h + 'px;overflow:hidden;width:100%">' +
      '<div style="background:' + c + ';height:100%;border-radius:' + h + 'px;width:' + Math.min(100, Math.max(0, pctVal)) + '%;transition:width .3s ease"></div></div>';
  }

  // ============================================================
  // SHARED CSS
  // ============================================================
  var SAC_CSS = '<style>' +
    '.sac-root{max-width:1200px;margin:0 auto}' +
    '.sac-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center;padding:12px 16px;background:' + C.lighter + ';border-radius:14px;border:1px solid ' + C.light + '}' +
    '.sac-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:' + C.muted + ';background:' + C.white + ';transition:.15s;border:1px solid transparent}' +
    '.sac-nav a:hover{background:' + C.light + ';color:' + C.dark + '}' +
    '.sac-nav a.active{background:' + C.primary + ';color:#fff;border-color:' + C.primary + ';box-shadow:0 2px 8px rgba(124,58,237,.25)}' +
    '.sac-hero{background:linear-gradient(135deg,' + C.dark + ',' + C.primary + ');padding:28px 32px;border-radius:16px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}' +
    '.sac-hero::after{content:"";position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(167,139,250,.15)}' +
    '.sac-hero h1{font-size:24px;margin:0 0 4px;position:relative;z-index:1}' +
    '.sac-hero p{opacity:.85;margin:0;font-size:14px;position:relative;z-index:1}' +
    '.sac-hero-actions{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}' +
    '.sac-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}' +
    '.sac-stat{background:' + C.white + ';border:1px solid ' + C.border + ';border-radius:14px;padding:20px;text-align:center;transition:.2s}' +
    '.sac-stat:hover{box-shadow:0 4px 24px rgba(124,58,237,.1);transform:translateY(-2px)}' +
    '.sac-stat-icon{font-size:30px;margin-bottom:8px}' +
    '.sac-stat-val{font-size:32px;font-weight:800;color:' + C.text + '}' +
    '.sac-stat-lbl{font-size:11px;color:' + C.faint + ';margin-top:4px;text-transform:uppercase;letter-spacing:.5px}' +
    '.sac-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}' +
    '.sac-btn:hover{opacity:.9;transform:translateY(-1px)}' +
    '.sac-btn-primary{background:' + C.primary + ';color:#fff}' +
    '.sac-btn-success{background:' + C.green + ';color:#fff}' +
    '.sac-btn-danger{background:' + C.redLight + ';color:' + C.red + ';border:1px solid #fecaca}' +
    '.sac-btn-secondary{background:' + C.surface + ';color:' + C.muted + ';border:1px solid ' + C.border + '}' +
    '.sac-btn-accent{background:' + C.accent + ';color:#fff}' +
    '.sac-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}' +
    '.sac-card{background:' + C.white + ';border:1px solid ' + C.border + ';border-radius:14px;padding:20px;transition:.15s}' +
    '.sac-card:hover{box-shadow:0 4px 20px rgba(124,58,237,.06)}' +
    '.sac-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}' +
    '.sac-card-title{font-size:16px;font-weight:700;color:' + C.text + ';display:flex;align-items:center;gap:8px}' +
    '.sac-table{width:100%;border-collapse:collapse;font-size:13px}' +
    '.sac-table th{padding:10px 14px;text-align:left;border-bottom:2px solid ' + C.border + ';color:' + C.muted + ';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:' + C.surface + '}' +
    '.sac-table td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:' + C.text + '}' +
    '.sac-table tr:nth-child(even){background:' + C.lighter + '}' +
    '.sac-table tr:hover{background:' + C.light + '}' +
    '.sac-form-group{margin-bottom:16px}' +
    '.sac-form-group label{display:block;font-size:13px;font-weight:600;color:' + C.text + ';margin-bottom:5px}' +
    '.sac-input{width:100%;padding:10px 14px;border:2px solid ' + C.border + ';border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box;font-family:inherit}' +
    '.sac-input:focus{outline:none;border-color:' + C.primary + ';box-shadow:0 0 0 3px ' + C.light + '}' +
    '.sac-select{width:100%;padding:10px 14px;border:2px solid ' + C.border + ';border-radius:10px;font-size:13px;background:' + C.white + ';box-sizing:border-box;font-family:inherit}' +
    '.sac-select:focus{outline:none;border-color:' + C.primary + ';box-shadow:0 0 0 3px ' + C.light + '}' +
    '.sac-textarea{width:100%;padding:10px 14px;border:2px solid ' + C.border + ';border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit}' +
    '.sac-textarea:focus{outline:none;border-color:' + C.primary + ';box-shadow:0 0 0 3px ' + C.light + '}' +
    '.sac-toggle{display:flex;align-items:center;gap:10px;padding:10px 0}' +
    '.sac-toggle input[type=checkbox]{width:20px;height:20px;accent-color:' + C.primary + ';cursor:pointer}' +
    '.sac-toggle label{font-size:13px;color:' + C.text + ';cursor:pointer}' +
    '.sac-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.sac-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}' +
    '.sac-section-title{font-size:16px;font-weight:700;color:' + C.text + ';margin-bottom:14px;display:flex;align-items:center;gap:8px}' +
    '.sac-empty{text-align:center;padding:40px;color:' + C.faint + '}' +
    '.sac-empty-icon{font-size:48px;margin-bottom:12px}' +
    '.sac-alert{padding:14px 18px;border-radius:10px;font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px}' +
    '.sac-alert-success{background:' + C.greenLight + ';color:#065f46;border:1px solid #a7f3d0}' +
    '.sac-alert-error{background:' + C.redLight + ';color:#991b1b;border:1px solid #fecaca}' +
    '.sac-alert-info{background:' + C.light + ';color:' + C.dark + ';border:1px solid ' + C.accent + '}' +
    '.sac-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}' +
    '.sac-filter label{display:block;font-size:12px;font-weight:600;color:' + C.muted + ';margin-bottom:4px}' +
    '.sac-filter input,.sac-filter select{padding:8px 14px;border:2px solid ' + C.border + ';border-radius:10px;font-size:13px;background:' + C.white + ';font-family:inherit}' +
    '.sac-filter input:focus,.sac-filter select:focus{outline:none;border-color:' + C.primary + '}' +
    '.sac-timeline{position:relative;padding-left:28px}' +
    '.sac-timeline::before{content:"";position:absolute;left:8px;top:0;bottom:0;width:2px;background:' + C.light + '}' +
    '.sac-timeline-item{position:relative;margin-bottom:14px;padding:12px 16px;background:' + C.white + ';border:1px solid ' + C.border + ';border-radius:10px;border-left:3px solid ' + C.accent + ';transition:.15s}' +
    '.sac-timeline-item:hover{box-shadow:0 2px 12px rgba(124,58,237,.06)}' +
    '.sac-timeline-item::before{content:"";position:absolute;left:-33px;top:16px;width:12px;height:12px;border-radius:50%;background:' + C.primary + ';border:2px solid ' + C.white + ';box-shadow:0 0 0 2px ' + C.light + '}' +
    '.sac-timeline-time{font-size:11px;color:' + C.faint + ';margin-top:4px}' +
    '.sac-role-card{background:' + C.white + ';border:1px solid ' + C.border + ';border-radius:12px;padding:16px;transition:.2s;cursor:pointer}' +
    '.sac-role-card:hover{box-shadow:0 4px 20px rgba(124,58,237,.1);transform:translateY(-2px);border-color:' + C.accent + '}' +
    '.sac-perm-matrix{width:100%;border-collapse:collapse;font-size:12px}' +
    '.sac-perm-matrix th{padding:8px 6px;text-align:center;background:' + C.lighter + ';color:' + C.dark + ';font-weight:700;font-size:11px;border:1px solid ' + C.light + ';text-transform:uppercase}' +
    '.sac-perm-matrix th:first-child{text-align:left;min-width:120px}' +
    '.sac-perm-matrix td{padding:6px;text-align:center;border:1px solid ' + C.light + ';background:' + C.white + '}' +
    '.sac-perm-matrix td:first-child{text-align:left;font-weight:600;color:' + C.text + ';font-size:12px;background:' + C.lighter + '}' +
    '.sac-perm-matrix input[type=checkbox]{width:16px;height:16px;accent-color:' + C.primary + ';cursor:pointer}' +
    '.sac-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:.15s;border:1px solid ' + C.border + ';background:' + C.white + ';color:' + C.muted + ';text-decoration:none}' +
    '.sac-chip:hover{border-color:' + C.primary + ';color:' + C.primary + '}' +
    '.sac-chip.active{background:' + C.primary + ';color:#fff;border-color:' + C.primary + '}' +
    '.sac-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:8px}' +
    '.sac-pagination-info{font-size:13px;color:' + C.muted + '}' +
    '.sac-confirm-dialog{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(30,27,75,.5);display:flex;align-items:center;justify-content:center;z-index:9999}' +
    '.sac-confirm-box{background:#fff;border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2)}' +
    '.sac-confirm-box h3{margin:0 0 10px;color:' + C.text + '}' +
    '.sac-confirm-box p{color:' + C.muted + ';font-size:14px;margin:0 0 20px}' +
    '.sac-confirm-actions{display:flex;gap:8px;justify-content:flex-end}' +
    '.sac-back{color:' + C.muted + ';font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-flex;align-items:center;gap:4px}' +
    '.sac-back:hover{color:' + C.primary + '}' +
    '@media(max-width:768px){' +
      '.sac-stats{grid-template-columns:1fr 1fr}' +
      '.sac-grid-2,.sac-grid-3{grid-template-columns:1fr}' +
      '.sac-nav{flex-direction:column;align-items:stretch}' +
      '.sac-hero{padding:20px}' +
    '}' +
    '</style>';

  // ============================================================
  // NAVIGATION HELPER
  // ============================================================
  function sacNav(active) {
    var items = [
      { href: '/staff-control', label: '\u{1F4CA} Dashboard', key: 'dashboard' },
      { href: '/staff-control/roles', label: '\u{1F6E1} Roles & Permissions', key: 'roles' },
      { href: '/staff-control/staff', label: '\u{1F465} Staff', key: 'staff' },
      { href: '/staff-control/positions', label: '\u{1F3E2} Positions', key: 'positions' },
      { href: '/staff-control/audit', label: '\u{1F4DD} Audit Log', key: 'audit' }
    ];
    return '<nav class="sac-nav" aria-label="Staff Control Navigation">' +
      items.map(function(item) {
        return '<a href="' + item.href + '" class="' + (active === item.key ? 'active' : '') + '" aria-current="' + (active === item.key ? 'page' : 'false') + '">' + item.label + '</a>';
      }).join('') +
      '</nav>';
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  var migrations = [
    // Table 1: staff_positions
    'CREATE TABLE IF NOT EXISTS staff_positions (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'title VARCHAR(100) NOT NULL,' +
      'department VARCHAR(100),' +
      'reports_to INTEGER REFERENCES users(id) ON DELETE SET NULL,' +
      'description TEXT,' +
      'is_manager BOOLEAN DEFAULT false,' +
      'can_create_users BOOLEAN DEFAULT false,' +
      'max_sub_workers INTEGER DEFAULT 0,' +
      'access_level INTEGER DEFAULT 1,' +
      'sort_order INTEGER DEFAULT 0,' +
      'status VARCHAR(20) DEFAULT \'active\',' +
      'created_by INTEGER,' +
      'created_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Table 2: staff_audit_log
    'CREATE TABLE IF NOT EXISTS staff_audit_log (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,' +
      'target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,' +
      'action VARCHAR(50) NOT NULL,' +
      'details JSONB DEFAULT \'{}\',' +
      'ip_address VARCHAR(50),' +
      'user_agent TEXT,' +
      'created_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Indexes
    'CREATE INDEX IF NOT EXISTS idx_sp_tenant ON staff_positions(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sp_tenant_status ON staff_positions(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_sp_department ON staff_positions(tenant_id, department)',
    'CREATE INDEX IF NOT EXISTS idx_sal_tenant ON staff_audit_log(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sal_actor ON staff_audit_log(actor_id)',
    'CREATE INDEX IF NOT EXISTS idx_sal_target ON staff_audit_log(target_user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sal_action ON staff_audit_log(tenant_id, action)',
    'CREATE INDEX IF NOT EXISTS idx_sal_created ON staff_audit_log(created_at)',

    // ALTER TABLE fallbacks for staff_positions
    'ALTER TABLE staff_positions ADD COLUMN IF NOT EXISTS can_create_users BOOLEAN DEFAULT false',
    'ALTER TABLE staff_positions ADD COLUMN IF NOT EXISTS max_sub_workers INTEGER DEFAULT 0',
    'ALTER TABLE staff_positions ADD COLUMN IF NOT EXISTS access_level INTEGER DEFAULT 1',
    'ALTER TABLE staff_positions ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0',
    'ALTER TABLE staff_positions ADD COLUMN IF NOT EXISTS description TEXT',

    // ALTER TABLE fallbacks for staff_audit_log
    'ALTER TABLE staff_audit_log ADD COLUMN IF NOT EXISTS details JSONB DEFAULT \'{}\'',
    'ALTER TABLE staff_audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50)',
    'ALTER TABLE staff_audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT'
  ];

  // Run migrations on startup
  (function() {
    pool.connect().then(function(client) {
      var chain = Promise.resolve();
      migrations.forEach(function(sql) {
        chain = chain.then(function() { return client.query(sql); });
      });
      return chain;
    }).then(function() {
      console.log('[StaffAccessControl] Migrations applied successfully (' + migrations.length + ' statements)');

      // Seed default roles if they don't exist (try/catch for safety)
      return pool.query("SELECT COUNT(*)::int as cnt FROM role_permissions WHERE tenant_id = 0").then(function(r) {
        if (r.rows[0].cnt === 0) {
          var defaultRoles = [
            { role_name: 'head_teacher', permissions: JSON.stringify({ Students: ['view','create','edit','delete','export'], Academics: ['view','create','edit','export'], Attendance: ['view','create','edit','export'], Reports: ['view','export'], Exams: ['view','create','edit','export'] }) },
            { role_name: 'bursar', permissions: JSON.stringify({ Fees: ['view','create','edit','export'], Finance: ['view','create','edit','export'], Reports: ['view','export'], Students: ['view'] }) },
            { role_name: 'teacher', permissions: JSON.stringify({ Students: ['view'], Attendance: ['view','create','edit'], Academics: ['view','create','edit'], Exams: ['view','create','edit'], Reports: ['view'] }) },
            { role_name: 'receptionist', permissions: JSON.stringify({ Students: ['view','create'], Communications: ['view','create'], Attendance: ['view'] }) },
            { role_name: 'data_entry', permissions: JSON.stringify({ Students: ['view','create','edit'], Attendance: ['view','create','edit'], Fees: ['view','create'] }) },
            { role_name: 'viewer', permissions: JSON.stringify({ Students: ['view'], Reports: ['view'] }) }
          ];
          var seedChain = Promise.resolve();
          defaultRoles.forEach(function(dr) {
            seedChain = seedChain.then(function() {
              return pool.query(
                'INSERT INTO role_permissions (tenant_id, role_name, permissions) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                [0, dr.role_name, dr.permissions]
              );
            });
          });
          return seedChain.then(function() {
            console.log('[StaffAccessControl] Default role templates seeded');
          });
        }
      });
    }).catch(function(err) {
      /* migration OK */
    });
  })();

  // ============================================================
  // AUDIT LOGGING HELPER
  // ============================================================
  function logAudit(tenantId, actorId, action, targetUserId, details, req) {
    var params = [tenantId, actorId, action, targetUserId || null];
    var detailObj = details || {};
    var sql = 'INSERT INTO staff_audit_log (tenant_id, actor_id, action, target_user_id, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)';
    params.push(typeof detailObj === 'string' ? detailObj : JSON.stringify(detailObj));
    params.push(req ? (req.ip || req.connection ? req.connection.remoteAddress : null) : null);
    params.push(req ? (req.headers ? req.headers['user-agent'] : null) : null);
    pool.query(sql, params).catch(function(err) {
      console.error('[StaffAccessControl] Audit log error:', err.message);
    });
  }

  // ============================================================
  // ACCESS CONTROL MIDDLEWARE
  // ============================================================
  function requireAdmin(req, res, next) {
    var user = req.session.user;
    if (!user) return res.redirect('/login');
    if (user.role !== 'super_admin' && user.role !== 'admin') {
      return res.send(renderPage('Access Denied',
        SAC_CSS + '<div class="sac-root"><div class="sac-alert sac-alert-error" style="margin-top:20px">\u{1F6AB} You do not have permission to access Staff Control. Only administrators can manage staff and roles.</div>' +
        '<a href="/dashboard" class="sac-btn sac-btn-secondary">\u{2190} Back to Dashboard</a></div>',
        user, req));
    }
    next();
  }

  function requireAdminOrManager(req, res, next) {
    var user = req.session.user;
    if (!user) return res.redirect('/login');
    if (user.role === 'super_admin' || user.role === 'admin') return next();
    // Check if the user is a sub-manager with can_create_users
    pool.query(
      'SELECT sp.is_manager, sp.can_create_users FROM staff_positions sp JOIN users u ON u.position_id = sp.id WHERE u.id = $1 AND sp.tenant_id = $2',
      [user.id, user.tenant_id]
    ).then(function(r) {
      if (r.rows.length > 0 && r.rows[0].can_create_users) {
        req.isSubManager = true;
        next();
      } else {
        return res.send(renderPage('Access Denied',
          SAC_CSS + '<div class="sac-root"><div class="sac-alert sac-alert-error" style="margin-top:20px">\u{1F6AB} You do not have permission to access this feature.</div>' +
          '<a href="/dashboard" class="sac-btn sac-btn-secondary">\u{2190} Back to Dashboard</a></div>',
          user, req));
      }
    }).catch(next);
  }

  // ============================================================
  // HELPER: Get roles for a tenant
  // ============================================================
  function getTenantRoles(tenantId) {
    // Get system-level roles (tenant_id = 0) plus tenant-specific roles
    return pool.query(
      'SELECT DISTINCT ON (rp.role_name) rp.* FROM role_permissions rp WHERE rp.tenant_id = 0 OR rp.tenant_id = $1 ORDER BY rp.role_name, CASE WHEN rp.tenant_id = $1 THEN 0 ELSE 1 END',
      [tenantId]
    ).then(function(r) { return r.rows; });
  }

  // ============================================================
  // HELPER: Build permission matrix HTML
  // ============================================================
  function permMatrixHtml(existingPerms) {
    var perms = existingPerms || {};
    var html = '<div style="overflow-x:auto"><table class="sac-perm-matrix"><thead><tr><th>Module</th>';
    PERM_FEATURES.forEach(function(f) {
      html += '<th>' + esc(f.charAt(0).toUpperCase() + f.slice(1)) + '</th>';
    });
    html += '</tr></thead><tbody>';
    PERM_MODULES.forEach(function(mod) {
      var modPerms = perms[mod] || [];
      html += '<tr><td>' + esc(mod) + '</td>';
      PERM_FEATURES.forEach(function(feat) {
        var checked = modPerms.indexOf(feat) !== -1 ? ' checked' : '';
        html += '<td><input type="checkbox" name="perm_' + esc(mod.toLowerCase()) + '_' + feat + '"' + checked + ' aria-label="' + esc(mod) + ' ' + esc(feat) + '"></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // Parse permissions from form body
  function parsePermsFromBody(body) {
    var perms = {};
    PERM_MODULES.forEach(function(mod) {
      var modulePerms = [];
      PERM_FEATURES.forEach(function(feat) {
        var key = 'perm_' + mod.toLowerCase() + '_' + feat;
        if (body[key] === 'on' || body[key] === 'true' || body[key] === '1') {
          modulePerms.push(feat);
        }
      });
      if (modulePerms.length > 0) perms[mod] = modulePerms;
    });
    return perms;
  }

  // ============================================================
  // ROUTE 1: GET /staff-control — Main Dashboard
  // ============================================================
  app.get('/staff-control', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var msg = req.query.msg || '';
    var msgType = req.query.msg_type || 'info';

    return Promise.all([
      // Total staff count (exclude super_admin)
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role != 'super_admin'", [tid]),
      // Active staff count
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role != 'super_admin' AND (is_active = true OR is_active IS NULL) AND approved = true AND (banned = false OR banned IS NULL)", [tid]),
      // Manager count
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role IN ('admin', 'manager', 'head_teacher', 'bursar') AND (is_active = true OR is_active IS NULL)", [tid]),
      // Recent hires (last 30 days)
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role != 'super_admin' AND created_at >= NOW() - INTERVAL '30 days'", [tid]),
      // Role distribution
      pool.query("SELECT role, COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role != 'super_admin' GROUP BY role ORDER BY cnt DESC", [tid]),
      // Recent audit activity (last 10)
      pool.query("SELECT sal.*, actor.email as actor_email, target.email as target_email FROM staff_audit_log sal LEFT JOIN users actor ON actor.id = sal.actor_id LEFT JOIN users target ON target.id = sal.target_user_id WHERE sal.tenant_id = $1 ORDER BY sal.created_at DESC LIMIT 10", [tid]),
      // Staff summary list
      pool.query("SELECT u.id, u.email, u.role, u.approved, u.banned, u.is_active, u.created_at FROM users u WHERE u.tenant_id = $1 AND u.role != 'super_admin' ORDER BY u.created_at DESC LIMIT 15", [tid]),
      // Positions count
      pool.query("SELECT COUNT(*)::int as cnt FROM staff_positions WHERE tenant_id = $1 AND status = 'active'", [tid])
    ]).then(function(results) {
      var totalStaff = results[0].rows[0].cnt;
      var activeStaff = results[1].rows[0].cnt;
      var managerCount = results[2].rows[0].cnt;
      var recentHires = results[3].rows[0].cnt;
      var roleDist = results[4].rows;
      var recentAudit = results[5].rows;
      var staffList = results[6].rows;
      var positionCount = results[7].rows[0].cnt;

      var activePct = pct(activeStaff, totalStaff);

      // Role distribution chart (simple bar chart)
      var maxCount = roleDist.length > 0 ? roleDist[0].cnt : 1;
      var roleChartHtml = roleDist.map(function(r) {
        var barWidth = Math.round((r.cnt / maxCount) * 100);
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<div style="width:100px;text-align:right;flex-shrink:0">' + roleBadge(r.role) + '</div>' +
          '<div style="flex:1;background:' + C.lighter + ';border-radius:6px;height:24px;overflow:hidden">' +
            '<div style="background:' + C.primary + ';height:100%;border-radius:6px;width:' + barWidth + '%;display:flex;align-items:center;padding-left:8px;min-width:30px">' +
              '<span style="font-size:11px;font-weight:700;color:#fff">' + r.cnt + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      // Recent audit timeline
      var auditHtml = recentAudit.map(function(a) {
        var color = actionColor(a.action);
        return '<div class="sac-timeline-item" style="border-left-color:' + color + '">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span style="font-size:13px;font-weight:600;color:' + C.text + '">' + esc(a.actor_email || 'System') + '</span>' +
            '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + color + '20;color:' + color + '">' + actionLabel(a.action) + '</span>' +
          '</div>' +
          (a.target_email ? '<p style="font-size:12px;color:' + C.muted + ';margin:0">Target: <strong>' + esc(a.target_email) + '</strong></p>' : '') +
          '<div class="sac-timeline-time">' + fmtDateTime(a.created_at) + '</div>' +
        '</div>';
      }).join('');

      // Staff summary table
      var staffTableHtml = staffList.map(function(s) {
        return '<tr>' +
          '<td>' + esc(s.email || 'N/A') + '</td>' +
          '<td>' + roleBadge(s.role) + '</td>' +
          '<td>' + statusBadge(s.is_active, s.approved, s.banned) + '</td>' +
          '<td style="font-size:12px;color:' + C.faint + '">' + fmtDateTime(s.created_at) + '</td>' +
        '</tr>';
      }).join('');

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('dashboard') +
        '<div class="sac-hero">' +
          '<h1>\u{1F6E1} Staff Access Control</h1>' +
          '<p>Manage roles, permissions, staff accounts, and activity across your organization</p>' +
          '<div class="sac-hero-actions">' +
            '<a href="/staff-control/staff/add" class="sac-btn" style="background:' + C.accent + ';color:#fff">\u{2795} Add Staff</a>' +
            '<a href="/staff-control/roles/create" class="sac-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">\u{1F511} Create Role</a>' +
            '<a href="/staff-control/audit" class="sac-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">\u{1F4DD} View Audit</a>' +
          '</div>' +
        '</div>' +

        (msg ? '<div class="sac-alert sac-alert-' + esc(msgType) + '">' + esc(msg) + '</div>' : '') +

        // Stats cards
        '<div class="sac-stats">' +
          '<div class="sac-stat"><div class="sac-stat-icon">\u{1F465}</div><div class="sac-stat-val">' + totalStaff + '</div><div class="sac-stat-lbl">Total Staff</div></div>' +
          '<div class="sac-stat"><div class="sac-stat-icon">\u{2705}</div><div class="sac-stat-val">' + activeStaff + '</div><div class="sac-stat-lbl">Active Staff</div></div>' +
          '<div class="sac-stat"><div class="sac-stat-icon">\u{1F396}</div><div class="sac-stat-val">' + managerCount + '</div><div class="sac-stat-lbl">Managers</div></div>' +
          '<div class="sac-stat"><div class="sac-stat-icon">\u{1F4C5}</div><div class="sac-stat-val">' + recentHires + '</div><div class="sac-stat-lbl">New (30 days)</div></div>' +
          '<div class="sac-stat"><div class="sac-stat-icon">\u{1F3E2}</div><div class="sac-stat-val">' + positionCount + '</div><div class="sac-stat-lbl">Positions</div></div>' +
        '</div>' +

        // Two-column layout
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">' +
          // Role distribution
          '<div class="sac-card"><div class="sac-card-title">\u{1F4CA} Role Distribution</div>' +
            '<div style="margin-top:12px">' + (roleChartHtml || '<div class="sac-empty"><p>No staff data yet</p></div>') + '</div>' +
          '</div>' +
          // Active staff percentage
          '<div class="sac-card"><div class="sac-card-title">\u{1F4C8} Staff Activation</div>' +
            '<div style="margin-top:16px;text-align:center;padding:10px">' +
              '<div style="font-size:48px;font-weight:800;color:' + C.primary + '">' + activePct + '%</div>' +
              '<p style="color:' + C.muted + ';margin:8px 0">' + activeStaff + ' of ' + totalStaff + ' staff are active</p>' +
              progressBar(activePct, 16, C.primary) +
            '</div>' +
          '</div>' +
        '</div>' +

        // Recent audit
        '<div class="sac-card" style="margin-bottom:20px"><div class="sac-card-header">' +
            '<div class="sac-card-title">\u{1F4DD} Recent Activity</div>' +
            '<a href="/staff-control/audit" class="sac-btn sac-btn-sm sac-btn-secondary">View All \u{2192}</a>' +
          '</div>' +
          '<div class="sac-timeline">' + (auditHtml || '<div class="sac-empty"><div class="sac-empty-icon">\u{1F4DD}</div><p>No recent activity</p></div>') + '</div>' +
        '</div>' +

        // Staff summary table
        '<div class="sac-card"><div class="sac-card-header">' +
            '<div class="sac-card-title">\u{1F4CB} Staff Summary</div>' +
            '<a href="/staff-control/staff" class="sac-btn sac-btn-sm sac-btn-secondary">Manage All \u{2192}</a>' +
          '</div>' +
          '<div style="overflow-x:auto"><table class="sac-table"><thead><tr>' +
            '<th>Email</th><th>Role</th><th>Status</th><th>Created</th>' +
          '</tr></thead><tbody>' + (staffTableHtml || '<tr><td colspan="4" class="sac-empty">No staff found</td></tr>') + '</tbody></table></div>' +
        '</div>' +
      '</div>';

      res.send(renderPage('Staff Access Control Dashboard', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 2: GET /staff-control/roles — Role & Permission Management
  // ============================================================
  app.get('/staff-control/roles', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;

    return getTenantRoles(tid).then(function(roles) {
      var roleCardsHtml = roles.map(function(r) {
        var perms = {};
        try { perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions) : (r.permissions || {}); } catch(e) { perms = {}; }
        var moduleCount = Object.keys(perms).length;
        var permCount = 0;
        Object.values(perms).forEach(function(arr) { permCount += (arr || []).length; });
        var isSystem = r.tenant_id === 0;
        var isProtected = r.role_name === 'admin' || r.role_name === 'super_admin';

        return '<div class="sac-role-card">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:' + C.text + '">' + esc(r.role_name.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); })) + '</div>' +
              (isSystem ? '<span style="font-size:11px;color:' + C.faint + '">\u{1F3E0} System Template</span>' : '<span style="font-size:11px;color:' + C.accent + '">\u{1F3E2} Custom Role</span>') +
            '</div>' +
            roleBadge(r.role_name) +
          '</div>' +
          '<div style="display:flex;gap:16px;font-size:12px;color:' + C.muted + ';margin-bottom:12px">' +
            '<span>\u{1F4E6} ' + moduleCount + ' modules</span>' +
            '<span>\u{1F511} ' + permCount + ' permissions</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px">' +
            Object.keys(perms).slice(0, 5).map(function(mod) {
              return '<span style="padding:2px 8px;border-radius:6px;font-size:10px;background:' + C.lighter + ';color:' + C.dark + '">' + esc(mod) + '</span>';
            }).join('') +
            (Object.keys(perms).length > 5 ? '<span style="padding:2px 8px;border-radius:6px;font-size:10px;background:' + C.surface + ';color:' + C.muted + '">+' + (Object.keys(perms).length - 5) + ' more</span>' : '') +
          '</div>' +
          (!isProtected ? '<div style="display:flex;gap:6px">' +
            '<form method="POST" action="/staff-control/roles/' + r.id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete role ' + esc(r.role_name) + '? This cannot be undone.\')">' +
              '<button type="submit" class="sac-btn sac-btn-danger sac-btn-sm">\u{1F5D1} Delete</button>' +
            '</form>' +
          '</div>' : '<div style="font-size:11px;color:' + C.faint + '">\u{1F512} Protected role</div>') +
        '</div>';
      }).join('');

      // Quick-create common roles
      var quickRoles = [
        { name: 'Head Teacher', icon: '\u{1F9D0}', desc: 'Full academics & student management' },
        { name: 'Bursar', icon: '\u{1F4B0}', desc: 'Financial & fee management' },
        { name: 'Teacher', icon: '\u{1F4DA}', desc: 'Attendance, exams & academics' },
        { name: 'Receptionist', icon: '\u{1F4DE}', desc: 'Student lookup & communications' },
        { name: 'Data Entry', icon: '\u{2328}', desc: 'Data input & basic editing' },
        { name: 'Viewer', icon: '\u{1F441}', desc: 'Read-only access to reports' }
      ];
      var quickHtml = quickRoles.map(function(qr) {
        return '<a href="/staff-control/roles/create?preset=' + encodeURIComponent(qr.name.toLowerCase().replace(/ /g, '_')) + '" class="sac-btn sac-btn-secondary sac-btn-sm" style="display:inline-flex;flex-direction:column;align-items:center;min-width:100px;padding:12px 8px;gap:4px">' +
          '<span style="font-size:20px">' + qr.icon + '</span>' +
          '<span style="font-size:12px;font-weight:600;color:' + C.text + '">' + qr.name + '</span>' +
        '</a>';
      }).join('');

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('roles') +
        '<div class="sac-hero">' +
          '<h1>\u{1F6E1} Roles & Permissions</h1>' +
          '<p>Define access levels and permission sets for every role in your organization</p>' +
          '<div class="sac-hero-actions">' +
            '<a href="/staff-control/roles/create" class="sac-btn" style="background:' + C.accent + ';color:#fff">\u{2795} Create New Role</a>' +
          '</div>' +
        '</div>' +

        // Quick create section
        '<div class="sac-card" style="margin-bottom:20px"><div class="sac-card-title">\u{26A1} Quick Create</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' + quickHtml + '</div>' +
        '</div>' +

        // Roles grid
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">' +
          (roleCardsHtml || '<div class="sac-empty"><div class="sac-empty-icon">\u{1F511}</div><p>No roles defined yet</p>' +
            '<a href="/staff-control/roles/create" class="sac-btn sac-btn-primary" style="margin-top:10px">\u{2795} Create Your First Role</a></div>') +
        '</div>' +
      '</div>';

      res.send(renderPage('Roles & Permissions', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 3: GET /staff-control/roles/create — Create Role Form
  // ============================================================
  app.get('/staff-control/roles/create', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var preset = req.query.preset || '';

    // Pre-fill from preset if provided
    var presetPerms = {};
    if (preset) {
      var presetMap = {
        head_teacher: { Students: ['view','create','edit','delete','export'], Academics: ['view','create','edit','export'], Attendance: ['view','create','edit','export'], Reports: ['view','export'], Exams: ['view','create','edit','export'] },
        bursar: { Fees: ['view','create','edit','export'], Finance: ['view','create','edit','export'], Reports: ['view','export'], Students: ['view'] },
        teacher: { Students: ['view'], Attendance: ['view','create','edit'], Academics: ['view','create','edit'], Exams: ['view','create','edit'], Reports: ['view'] },
        receptionist: { Students: ['view','create'], Communications: ['view','create'], Attendance: ['view'] },
        data_entry: { Students: ['view','create','edit'], Attendance: ['view','create','edit'], Fees: ['view','create'] },
        viewer: { Students: ['view'], Reports: ['view'] }
      };
      presetPerms = presetMap[preset] || {};
    }

    var html = SAC_CSS + '<div class="sac-root">' +
      sacNav('roles') +
      '<a href="/staff-control/roles" class="sac-back">\u{2190} Back to Roles</a>' +
      '<div class="sac-card">' +
        '<div class="sac-card-title">\u{2795} Create New Role</div>' +
        '<p style="color:' + C.muted + ';font-size:13px;margin-bottom:20px">Define the permissions for this role. Members assigned this role will inherit these access rights.</p>' +
        '<form method="POST" action="/staff-control/roles/create">' +
          '<div class="sac-form-group">' +
            '<label for="role_name">Role Name <span style="color:' + C.red + '">*</span></label>' +
            '<input id="role_name" name="role_name" class="sac-input" required placeholder="e.g. Head Teacher, Bursar, Librarian..." value="' + esc(preset ? preset.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) : '') + '">' +
          '</div>' +

          // Toggle options
          '<div style="background:' + C.lighter + ';border-radius:12px;padding:16px;margin-bottom:20px">' +
            '<div class="sac-section-title" style="margin-bottom:12px">\u{2699} Special Permissions</div>' +
            '<div class="sac-toggle"><input type="checkbox" name="can_manage_users" id="can_manage_users"><label for="can_manage_users">\u{1F465} Can manage users (create, edit roles)</label></div>' +
            '<div class="sac-toggle"><input type="checkbox" name="can_send_sms" id="can_send_sms"><label for="can_send_sms">\u{1F4E8} Can send SMS messages</label></div>' +
            '<div class="sac-toggle"><input type="checkbox" name="can_view_financial" id="can_view_financial"><label for="can_view_financial">\u{1F4CA} Can view financial reports</label></div>' +
            '<div class="sac-toggle"><input type="checkbox" name="can_manage_settings" id="can_manage_settings"><label for="can_manage_settings">\u{2699} Can manage settings</label></div>' +
          '</div>' +

          // Permission matrix
          '<div class="sac-section-title">\u{1F511} Permission Matrix</div>' +
          '<p style="color:' + C.muted + ';font-size:12px;margin-bottom:12px">Select which modules this role can access and what actions they can perform.</p>' +
          permMatrixHtml(presetPerms) +

          '<div style="display:flex;gap:8px;margin-top:20px">' +
            '<button type="submit" class="sac-btn sac-btn-primary">\u{2705} Create Role</button>' +
            '<a href="/staff-control/roles" class="sac-btn sac-btn-secondary">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';

    res.send(renderPage('Create Role', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /staff-control/roles/create — Save Role
  // ============================================================
  app.post('/staff-control/roles/create', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var roleName = (req.body.role_name || '').trim().toLowerCase().replace(/\s+/g, '_');
    var canManageUsers = req.body.can_manage_users === 'on';
    var canSendSms = req.body.can_send_sms === 'on';
    var canViewFinancial = req.body.can_view_financial === 'on';
    var canManageSettings = req.body.can_manage_settings === 'on';

    if (!roleName) {
      return res.redirect('/staff-control/roles/create?msg=Role+name+is+required&msg_type=error');
    }

    var perms = parsePermsFromBody(req.body);
    perms._meta = {
      can_manage_users: canManageUsers,
      can_send_sms: canSendSms,
      can_view_financial: canViewFinancial,
      can_manage_settings: canManageSettings
    };

    return pool.query(
      'INSERT INTO role_permissions (tenant_id, role_name, permissions) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [tid, roleName, JSON.stringify(perms)]
    ).then(function() {
      logAudit(tid, user.id, 'permission_updated', null, { role_name: roleName, action: 'created' }, req);
      res.redirect('/staff-control/roles?msg=Role+' + encodeURIComponent(roleName) + '+created+successfully&msg_type=success');
    }).catch(function(err) {
      res.redirect('/staff-control/roles/create?msg=Error:+please+try+again&msg_type=error');
    });
  }));

  // ============================================================
  // ROUTE 5: POST /staff-control/roles/:id/delete — Delete Role
  // ============================================================
  app.post('/staff-control/roles/:id/delete', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var roleId = parseInt(req.params.id);

    return pool.query('SELECT * FROM role_permissions WHERE id = $1 AND (tenant_id = $2 OR tenant_id = 0)', [roleId, tid]).then(function(r) {
      if (r.rows.length === 0) {
        return res.redirect('/staff-control/roles?msg=Role+not+found&msg_type=error');
      }
      var role = r.rows[0];
      if (role.role_name === 'admin' || role.role_name === 'super_admin') {
        return res.redirect('/staff-control/roles?msg=Cannot+delete+protected+role&msg_type=error');
      }
      // Check if any active users have this role
      return pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE tenant_id = $1 AND role = $2 AND (is_active = true OR is_active IS NULL)", [tid, role.role_name]).then(function(ur) {
        if (ur.rows[0].cnt > 0 && role.tenant_id === 0) {
          return res.redirect('/staff-control/roles?msg=Cannot+delete+system+role+assigned+to+' + ur.rows[0].cnt + '+active+users&msg_type=error');
        }
        return pool.query('DELETE FROM role_permissions WHERE id = $1', [roleId]).then(function() {
          logAudit(tid, user.id, 'permission_updated', null, { role_name: role.role_name, action: 'deleted' }, req);
          res.redirect('/staff-control/roles?msg=Role+deleted+successfully&msg_type=success');
        });
      });
    });
  }));

  // ============================================================
  // ROUTE 6: GET /staff-control/staff — All Staff List
  // ============================================================
  app.get('/staff-control/staff', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var limit = 20;
    var offset = (page - 1) * limit;
    var search = (req.query.search || '').trim();
    var roleFilter = req.query.role || '';
    var statusFilter = req.query.status || '';
    var deptFilter = req.query.department || '';

    var where = ['u.tenant_id = $1', "u.role != 'super_admin'"];
    var params = [tid];
    var pi = 2;

    if (search) {
      where.push('(u.email ILIKE $' + (pi++) + ')');
      params.push('%' + search + '%');
    }
    if (roleFilter) {
      where.push('u.role = $' + (pi++));
      params.push(roleFilter);
    }
    if (statusFilter === 'active') {
      where.push('(u.is_active = true OR u.is_active IS NULL) AND u.approved = true AND (u.banned = false OR u.banned IS NULL)');
    } else if (statusFilter === 'inactive') {
      where.push('(u.is_active = false)');
    } else if (statusFilter === 'banned') {
      where.push('(u.banned = true)');
    } else if (statusFilter === 'pending') {
      where.push('(u.approved = false OR u.approved IS NULL)');
    }

    var whereClause = where.join(' AND ');

    return Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM users u WHERE ' + whereClause, params),
      pool.query(
        'SELECT u.id, u.email, u.role, u.approved, u.banned, u.is_active, u.created_at, u.ban_reason, sp.title as position_title, sp.department FROM users u LEFT JOIN staff_positions sp ON sp.id = u.position_id WHERE ' + whereClause + ' ORDER BY u.created_at DESC LIMIT $' + (pi++) + ' OFFSET $' + (pi++),
        params.concat([limit, offset])
      ),
      pool.query("SELECT DISTINCT role FROM users WHERE tenant_id = $1 AND role != 'super_admin' ORDER BY role", [tid]),
      pool.query("SELECT DISTINCT department FROM staff_positions WHERE tenant_id = $1 AND department IS NOT NULL ORDER BY department", [tid]),
      getTenantRoles(tid)
    ]).then(function(results) {
      var totalRows = results[0].rows[0].cnt;
      var staff = results[1].rows;
      var allRoles = results[2].rows.map(function(r) { return r.role; });
      var departments = results[3].rows.map(function(r) { return r.department; });
      var roles = results[4].rows;
      var totalPages = Math.ceil(totalRows / limit);

      // Filter chip status options
      var statusChips = [
        { key: '', label: 'All' }, { key: 'active', label: '\u{2705} Active' },
        { key: 'inactive', label: '\u{23F8} Inactive' }, { key: 'banned', label: '\u{1F6AB} Banned' },
        { key: 'pending', label: '\u{23F3} Pending' }
      ];

      var statusChipsHtml = statusChips.map(function(sc) {
        var q = '?page=1';
        if (search) q += '&search=' + encodeURIComponent(search);
        if (roleFilter) q += '&role=' + encodeURIComponent(roleFilter);
        if (department) q += '&department=' + encodeURIComponent(deptFilter);
        if (sc.key) q += '&status=' + encodeURIComponent(sc.key);
        return '<a href="/staff-control/staff' + q + '" class="sac-chip ' + (statusFilter === sc.key ? 'active' : '') + '">' + sc.label + '</a>';
      }).join('');

      var roleChipsHtml = allRoles.map(function(r) {
        var q = '?page=1';
        if (search) q += '&search=' + encodeURIComponent(search);
        if (statusFilter) q += '&status=' + encodeURIComponent(statusFilter);
        if (deptFilter) q += '&department=' + encodeURIComponent(deptFilter);
        q += '&role=' + encodeURIComponent(r);
        return '<a href="/staff-control/staff' + q + '" class="sac-chip ' + (roleFilter === r ? 'active' : '') + '">' + roleBadge(r) + '</a>';
      }).join('');

      // Staff table rows
      var staffRows = staff.map(function(s) {
        return '<tr>' +
          '<td style="font-weight:600">' + esc(s.email) + '</td>' +
          '<td>' + roleBadge(s.role) + '</td>' +
          '<td>' + esc(s.position_title || '\u2014') + '</td>' +
          '<td>' + esc(s.department || '\u2014') + '</td>' +
          '<td>' + statusBadge(s.is_active, s.approved, s.banned) + '</td>' +
          '<td style="font-size:12px;color:' + C.faint + '">' + fmtDateTime(s.created_at) + '</td>' +
          '<td>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
              '<form method="POST" action="/staff-control/staff/' + s.id + '/role" style="display:inline">' +
                '<select name="new_role" style="padding:4px 8px;border-radius:6px;border:1px solid ' + C.border + ';font-size:11px" onchange="this.form.submit()" aria-label="Change role for ' + esc(s.email) + '">' +
                  roles.map(function(r) { return '<option value="' + esc(r.role_name) + '"' + (r.role_name === s.role ? ' selected' : '') + '>' + esc(r.role_name) + '</option>'; }).join('') +
                '</select>' +
              '</form>' +
              '<form method="POST" action="/staff-control/staff/' + s.id + '/toggle" style="display:inline">' +
                '<button type="submit" class="sac-btn sac-btn-sm ' + (s.is_active !== false ? 'sac-btn-danger' : 'sac-btn-success') + '" title="' + (s.is_active !== false ? 'Deactivate' : 'Activate') + '">' + (s.is_active !== false ? '\u{23F8}' : '\u{25B6}') + '</button>' +
              '</form>' +
              '<form method="POST" action="/staff-control/staff/' + s.id + '/ban" style="display:inline">' +
                '<button type="submit" class="sac-btn sac-btn-sm ' + (s.banned ? 'sac-btn-success' : 'sac-btn-danger') + '" title="' + (s.banned ? 'Unban' : 'Ban') + '">' + (s.banned ? '\u{1F513}' : '\u{1F6AB}') + '</button>' +
              '</form>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

      // Pagination
      var paginationHtml = '';
      if (totalPages > 1) {
        paginationHtml = '<div class="sac-pagination"><div class="sac-pagination-info">Page ' + page + ' of ' + totalPages + ' (' + totalRows + ' total)</div><div style="display:flex;gap:4px">';
        var baseQ = '?search=' + encodeURIComponent(search) + '&role=' + encodeURIComponent(roleFilter) + '&status=' + encodeURIComponent(statusFilter);
        if (page > 1) paginationHtml += '<a href="/staff-control/staff' + baseQ + '&page=' + (page - 1) + '" class="sac-btn sac-btn-sm sac-btn-secondary">\u{2190} Prev</a>';
        if (page < totalPages) paginationHtml += '<a href="/staff-control/staff' + baseQ + '&page=' + (page + 1) + '" class="sac-btn sac-btn-sm sac-btn-primary">Next \u{2192}</a>';
        paginationHtml += '</div></div>';
      }

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('staff') +
        '<div class="sac-hero">' +
          '<h1>\u{1F465} Staff Management</h1>' +
          '<p>View, manage, and configure all staff accounts for your organization</p>' +
          '<div class="sac-hero-actions">' +
            '<a href="/staff-control/staff/add" class="sac-btn" style="background:' + C.accent + ';color:#fff">\u{2795} Add New Staff</a>' +
          '</div>' +
        '</div>' +

        // Filters
        '<div class="sac-card" style="margin-bottom:16px">' +
          '<form method="GET" action="/staff-control/staff" class="sac-filter">' +
            '<div><label>Search Email</label><input name="search" value="' + esc(search) + '" placeholder="Type to search..."></div>' +
            '<div><label>Department</label><select name="department"><option value="">All</option>' + departments.map(function(d) { return '<option value="' + esc(d) + '"' + (d === deptFilter ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select></div>' +
            '<div style="display:flex;gap:8px;align-self:end"><button type="submit" class="sac-btn sac-btn-primary sac-btn-sm">Search</button><a href="/staff-control/staff" class="sac-btn sac-btn-secondary sac-btn-sm">Clear</a></div>' +
          '</form>' +
          '<div style="margin-top:10px"><span style="font-size:12px;font-weight:700;color:' + C.muted + '">Status: </span>' + statusChipsHtml + '</div>' +
          '<div style="margin-top:8px"><span style="font-size:12px;font-weight:700;color:' + C.muted + '">Role: </span>' + roleChipsHtml + '</div>' +
        '</div>' +

        // Staff table
        '<div class="sac-card">' +
          '<div style="overflow-x:auto"><table class="sac-table"><thead><tr>' +
            '<th>Email</th><th>Role</th><th>Position</th><th>Department</th><th>Status</th><th>Created</th><th>Actions</th>' +
          '</tr></thead><tbody>' + (staffRows || '<tr><td colspan="7" class="sac-empty">No staff found</td></tr>') + '</tbody></table></div>' +
        '</div>' +
        paginationHtml +
      '</div>';

      res.send(renderPage('Staff Management', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 7: GET /staff-control/staff/add — Add New Staff Member
  // ============================================================
  app.get('/staff-control/staff/add', requireAdminOrManager, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var isSubManager = req.isSubManager;

    return Promise.all([
      getTenantRoles(tid),
      pool.query('SELECT * FROM staff_positions WHERE tenant_id = $1 AND status = \'active\' ORDER BY sort_order, title', [tid]),
      pool.query("SELECT u.id, u.email, sp.title as position_title FROM users u LEFT JOIN staff_positions sp ON sp.id = u.position_id WHERE u.tenant_id = $1 AND u.role IN ('admin','manager','head_teacher','bursar') AND (u.is_active = true OR u.is_active IS NULL) AND (u.banned = false OR u.banned IS NULL) ORDER BY u.email", [tid]),
      pool.query("SELECT DISTINCT department FROM staff_positions WHERE tenant_id = $1 AND department IS NOT NULL ORDER BY department", [tid])
    ]).then(function(results) {
      var roles = results[0].rows;
      var positions = results[1].rows;
      var managers = results[2].rows;
      var departments = results[3].rows.map(function(r) { return r.department; });

      // Sub-managers can only assign viewer/editor level roles
      var availableRoles = roles;
      if (isSubManager) {
        availableRoles = roles.filter(function(r) {
          return r.role_name === 'viewer' || r.role_name === 'teacher' || r.role_name === 'receptionist' || r.role_name === 'data_entry';
        });
      }

      var roleOptions = availableRoles.map(function(r) {
        return '<option value="' + esc(r.role_name) + '">' + esc(r.role_name.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); })) + '</option>';
      }).join('');

      var positionOptions = positions.map(function(p) {
        return '<option value="' + p.id + '" data-is-manager="' + (p.is_manager ? 'true' : 'false') + '" data-can-create="' + (p.can_create_users ? 'true' : 'false') + '">[' + esc(p.department || 'General') + '] ' + esc(p.title) + (p.is_manager ? ' \u{1F396}' : '') + '</option>';
      }).join('');

      var managerOptions = managers.map(function(m) {
        return '<option value="' + m.id + '">' + esc(m.email) + (m.position_title ? ' (' + esc(m.position_title) + ')' : '') + '</option>';
      }).join('');

      var deptOptions = departments.map(function(d) {
        return '<option value="' + esc(d) + '">' + esc(d) + '</option>';
      }).join('');

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('staff') +
        '<a href="/staff-control/staff" class="sac-back">\u{2190} Back to Staff List</a>' +
        '<div class="sac-card">' +
          '<div class="sac-card-title">\u{2795} Add New Staff Member</div>' +
          (isSubManager ? '<div class="sac-alert sac-alert-info">\u{1F4A1} As a sub-manager, you can only create staff with limited roles (viewer, teacher, receptionist, data entry).</div>' : '') +
          '<form method="POST" action="/staff-control/staff/add" id="addStaffForm">' +
            '<div class="sac-grid-2">' +
              '<div class="sac-form-group">' +
                '<label for="email">Email Address <span style="color:' + C.red + '">*</span></label>' +
                '<input id="email" name="email" type="email" class="sac-input" required placeholder="staff@school.ac.ug">' +
              '</div>' +
              '<div class="sac-form-group">' +
                '<label for="password">Password <span style="color:' + C.red + '">*</span></label>' +
                '<div style="display:flex;gap:6px">' +
                  '<input id="password" name="password" type="password" class="sac-input" required minlength="4" placeholder="Min 4 characters">' +
                  '<button type="button" class="sac-btn sac-btn-secondary sac-btn-sm" onclick="document.getElementById(\'password\').value=Array.from({length:12},()=>\'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789\'[Math.floor(Math.random()*58)]).join(\'\');document.getElementById(\'auto-gen-note\').style.display=\'block\'">\u{1F3B2}</button>' +
                '</div>' +
                '<div id="auto-gen-note" style="display:none;font-size:11px;color:' + C.green + ';margin-top:4px">\u{2705} Auto-generated password</div>' +
              '</div>' +
            '</div>' +

            '<div class="sac-grid-3">' +
              '<div class="sac-form-group">' +
                '<label for="role">Role <span style="color:' + C.red + '">*</span></label>' +
                '<select id="role" name="role" class="sac-select" required onchange="updatePermPreview()">' +
                  '<option value="">-- Select Role --</option>' + roleOptions +
                '</select>' +
              '</div>' +
              '<div class="sac-form-group">' +
                '<label for="position_id">Position</label>' +
                '<select id="position_id" name="position_id" class="sac-select" onchange="updateReportsTo()">' +
                  '<option value="">-- Select Position --</option>' + positionOptions +
                '</select>' +
              '</div>' +
              '<div class="sac-form-group">' +
                '<label for="department">Department</label>' +
                '<select id="department" name="department" class="sac-select">' +
                  '<option value="">-- Select Department --</option>' + deptOptions +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="sac-form-group">' +
              '<label for="reports_to">Reports To</label>' +
              '<select id="reports_to" name="reports_to" class="sac-select">' +
                '<option value="">-- Select Manager --</option>' + managerOptions +
              '</select>' +
            '</div>' +

            // Approval toggle
            '<div style="background:' + C.lighter + ';border-radius:12px;padding:16px;margin-bottom:20px">' +
              '<div class="sac-section-title" style="margin-bottom:12px">\u{2699} Account Settings</div>' +
              '<div class="sac-toggle"><input type="checkbox" name="approved" id="approved" checked><label for="approved">\u{2705} Auto-approve account (can log in immediately)</label></div>' +
              '<div class="sac-toggle"><input type="checkbox" name="send_welcome" id="send_welcome"><label for="send_welcome">\u{1F4E8} Send welcome email with credentials</label></div>' +
            '</div>' +

            // Permission preview
            '<div id="perm-preview" style="display:none;margin-bottom:20px">' +
              '<div class="sac-section-title">\u{1F511} Permission Preview (from role)</div>' +
              '<div id="perm-preview-content" class="sac-card" style="padding:16px;font-size:12px;color:' + C.muted + '">Select a role to preview permissions</div>' +
            '</div>' +

            '<div style="display:flex;gap:8px">' +
              '<button type="submit" class="sac-btn sac-btn-primary">\u{2705} Create Staff Account</button>' +
              '<a href="/staff-control/staff" class="sac-btn sac-btn-secondary">Cancel</a>' +
            '</div>' +
          '</form>' +
        '</div>' +

        '<script>' +
          'var allRoles = ' + JSON.stringify(roles.map(function(r) { return { name: r.role_name, perms: r.permissions }; })) + ';' +
          'function updatePermPreview() {' +
            'var sel = document.getElementById("role");' +
            'var preview = document.getElementById("perm-preview");' +
            'var content = document.getElementById("perm-preview-content");' +
            'if (!sel.value) { preview.style.display = "none"; return; }' +
            'var role = allRoles.find(function(r) { return r.name === sel.value; });' +
            'if (!role) { preview.style.display = "none"; return; }' +
            'preview.style.display = "block";' +
            'var perms = {}; try { perms = typeof role.perms === "string" ? JSON.parse(role.perms) : (role.perms || {}); } catch(e) {}' +
            'var meta = perms._meta || {};' +
            'var html = "<div style=\\"margin-bottom:8px\\">";' +
            'if (meta.can_manage_users) html += "<span style=\\"padding:2px 8px;border-radius:6px;font-size:10px;background:#ede9fe;color:#5b21b6\\">\u{1F465} Can Manage Users</span> ";' +
            'if (meta.can_send_sms) html += "<span style=\\"padding:2px 8px;border-radius:6px;font-size:10px;background:#dbeafe;color:#1e40af\\">\u{1F4E8} Can Send SMS</span> ";' +
            'if (meta.can_view_financial) html += "<span style=\\"padding:2px 8px;border-radius:6px;font-size:10px;background:#d1fae5;color:#065f46\\">\u{1F4CA} Financial Reports</span> ";' +
            'if (meta.can_manage_settings) html += "<span style=\\"padding:2px 8px;border-radius:6px;font-size:10px;background:#fef3c7;color:#92400e\\">\u{2699} Can Manage Settings</span> ";' +
            'html += "</div>";' +
            'delete perms._meta;' +
            'Object.keys(perms).forEach(function(mod) {' +
              'html += "<div style=\\"margin-bottom:4px\\"><strong>" + mod + ":</strong> " + perms[mod].join(", ") + "</div>";' +
            '});' +
            'content.innerHTML = html;' +
          '}' +
          'function updateReportsTo() {' +
            'var sel = document.getElementById("position_id");' +
            'var opt = sel.options[sel.selectedIndex];' +
          '}' +
        '</script>' +
      '</div>';

      res.send(renderPage('Add Staff Member', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 8: POST /staff-control/staff/add — Create New User
  // ============================================================
  app.post('/staff-control/staff/add', requireAdminOrManager, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var email = (req.body.email || '').trim().toLowerCase();
    var password = req.body.password || '';
    var role = (req.body.role || '').trim().toLowerCase();
    var positionId = parseInt(req.body.position_id) || null;
    var department = (req.body.department || '').trim();
    var reportsTo = parseInt(req.body.reports_to) || null;
    var approved = req.body.approved === 'on';
    var sendWelcome = req.body.send_welcome === 'on';

    // Validation
    if (!email || !password || !role) {
      return res.redirect('/staff-control/staff/add?msg=Email,+password,+and+role+are+required&msg_type=error');
    }
    if (password.length < 4) {
      return res.redirect('/staff-control/staff/add?msg=Password+must+be+at+least+4+characters&msg_type=error');
    }

    // Sub-manager restrictions
    if (req.isSubManager) {
      var allowedRoles = ['viewer', 'teacher', 'receptionist', 'data_entry'];
      if (allowedRoles.indexOf(role) === -1) {
        return res.redirect('/staff-control/staff/add?msg=You+can+only+assign+limited+roles&msg_type=error');
      }
    }

    var client;
    return pool.connect().then(function(c) {
      client = c;
      return client.query('BEGIN');
    }).then(function() {
      // Check email uniqueness
      return client.query('SELECT id FROM users WHERE email = $1', [email]);
    }).then(function(r) {
      if (r.rows.length > 0) {
        throw new Error('A user with this email already exists');
      }
      // Hash password
      if (bcrypt) {
        return bcrypt.hash(password, 10);
      }
      throw new Error('bcrypt not available');
    }).then(function(hash) {
      // Check if user has position_id column
      return client.query(
        "INSERT INTO users (tenant_id, email, password, password_hash, role, approved, is_active, position_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW()) RETURNING id",
        [tid, email, password, hash, role, approved, positionId]
      );
    }).then(function(r) {
      var newUserId = r.rows[0].id;

      // Set position's reports_to if provided
      if (reportsTo) {
        // Log reports_to relationship in details
      }

      // Log welcome email if requested (just log it)
      if (sendWelcome) {
        console.log('[StaffAccessControl] Welcome email would be sent to: ' + email + ' (password: ' + password + ')');
      }

      // Audit log
      return client.query(
        'INSERT INTO staff_audit_log (tenant_id, actor_id, target_user_id, action, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [tid, user.id, newUserId, 'user_created', JSON.stringify({ email: email, role: role, approved: approved, position_id: positionId, department: department, welcome_email: sendWelcome }), req.ip || null, req.headers ? req.headers['user-agent'] : null]
      );
    }).then(function() {
      return client.query('COMMIT');
    }).then(function() {
      if (client) client.release();
      res.redirect('/staff-control/staff?msg=Staff+member+' + encodeURIComponent(email) + '+created+successfully&msg_type=success');
    }).catch(function(err) {
      if (client) {
        return client.query('ROLLBACK').then(function() { client.release(); }).then(function() {
          res.redirect('/staff-control/staff/add?msg=' + encodeURIComponent(err.message || 'Error creating staff member') + '&msg_type=error');
        });
      }
      res.redirect('/staff-control/staff/add?msg=' + encodeURIComponent(err.message || 'Error creating staff member') + '&msg_type=error');
    });
  }));

  // ============================================================
  // ROUTE 9: POST /staff-control/staff/:id/role — Change Staff Role
  // ============================================================
  app.post('/staff-control/staff/:id/role', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var targetId = parseInt(req.params.id);
    var newRole = (req.body.new_role || '').trim().toLowerCase();

    if (!newRole) {
      return res.redirect('/staff-control/staff?msg=Role+is+required&msg_type=error');
    }

    return pool.query('SELECT id, email, role FROM users WHERE id = $1 AND tenant_id = $2', [targetId, tid]).then(function(r) {
      if (r.rows.length === 0) {
        return res.redirect('/staff-control/staff?msg=User+not+found&msg_type=error');
      }
      var target = r.rows[0];
      var oldRole = target.role;

      if (oldRole === newRole) {
        return res.redirect('/staff-control/staff?msg=Role+unchanged&msg_type=info');
      }

      // Cannot change super_admin role
      if (target.role === 'super_admin') {
        return res.redirect('/staff-control/staff?msg=Cannot+change+super_admin+role&msg_type=error');
      }

      return pool.query('UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3', [newRole, targetId, tid]).then(function() {
        logAudit(tid, user.id, 'role_changed', targetId, { email: target.email, old_role: oldRole, new_role: newRole }, req);
        res.redirect('/staff-control/staff?msg=Role+changed+for+' + encodeURIComponent(target.email) + '&msg_type=success');
      });
    });
  }));

  // ============================================================
  // ROUTE 10: POST /staff-control/staff/:id/toggle — Activate/Deactivate
  // ============================================================
  app.post('/staff-control/staff/:id/toggle', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var targetId = parseInt(req.params.id);

    return pool.query('SELECT id, email, is_active, role FROM users WHERE id = $1 AND tenant_id = $2', [targetId, tid]).then(function(r) {
      if (r.rows.length === 0) {
        return res.redirect('/staff-control/staff?msg=User+not+found&msg_type=error');
      }
      var target = r.rows[0];
      if (target.role === 'super_admin') {
        return res.redirect('/staff-control/staff?msg=Cannot+modify+super_admin&msg_type=error');
      }

      var newActive = target.is_active === false ? true : false;
      var action = newActive ? 'user_activated' : 'user_deactivated';

      return pool.query('UPDATE users SET is_active = $1, approved = $1 WHERE id = $2 AND tenant_id = $3', [newActive, targetId, tid]).then(function() {
        logAudit(tid, user.id, action, targetId, { email: target.email, new_state: newActive ? 'active' : 'inactive' }, req);
        res.redirect('/staff-control/staff?msg=' + encodeURIComponent(target.email) + (newActive ? '+activated' : '+deactivated') + '&msg_type=success');
      });
    });
  }));

  // ============================================================
  // ROUTE 11: POST /staff-control/staff/:id/ban — Ban/Unban Staff
  // ============================================================
  app.post('/staff-control/staff/:id/ban', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var targetId = parseInt(req.params.id);
    var banReason = (req.body.ban_reason || '').trim();

    return pool.query('SELECT id, email, banned, role FROM users WHERE id = $1 AND tenant_id = $2', [targetId, tid]).then(function(r) {
      if (r.rows.length === 0) {
        return res.redirect('/staff-control/staff?msg=User+not+found&msg_type=error');
      }
      var target = r.rows[0];
      if (target.role === 'super_admin') {
        return res.redirect('/staff-control/staff?msg=Cannot+ban+super_admin&msg_type=error');
      }

      var newBanned = !target.banned;
      var action = newBanned ? 'user_banned' : 'user_unbanned';

      return pool.query('UPDATE users SET banned = $1, ban_reason = $2 WHERE id = $3 AND tenant_id = $4', [newBanned, newBanned ? banReason : null, targetId, tid]).then(function() {
        logAudit(tid, user.id, action, targetId, { email: target.email, banned: newBanned, reason: banReason || null }, req);
        res.redirect('/staff-control/staff?msg=' + encodeURIComponent(target.email) + (newBanned ? '+banned' : '+unbanned') + '&msg_type=success');
      });
    });
  }));

  // ============================================================
  // ROUTE 12: GET /staff-control/positions — Manage Positions
  // ============================================================
  app.get('/staff-control/positions', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var msg = req.query.msg || '';
    var msgType = req.query.msg_type || 'info';

    return Promise.all([
      pool.query('SELECT sp.*, m.email as reports_to_email, (SELECT COUNT(*)::int FROM users u WHERE u.position_id = sp.id) as staff_count FROM staff_positions sp LEFT JOIN users m ON m.id = sp.reports_to WHERE sp.tenant_id = $1 ORDER BY sp.sort_order, sp.title', [tid]),
      pool.query("SELECT u.id, u.email FROM users u WHERE u.tenant_id = $1 AND u.role IN ('admin','manager','head_teacher','bursar') AND (u.is_active = true OR u.is_active IS NULL) AND (u.banned = false OR u.banned IS NULL) ORDER BY u.email", [tid])
    ]).then(function(results) {
      var positions = results[0].rows;
      var managers = results[1].rows;

      var accessLevelLabels = { 1: 'Viewer', 2: 'Editor', 3: 'Manager', 4: 'Admin' };
      var accessLevelColors = { 1: '#64748b', 2: '#2563eb', 3: '#7c3aed', 4: '#dc2626' };

      var positionRows = positions.map(function(p) {
        var levelColor = accessLevelColors[p.access_level] || '#64748b';
        var levelLabel = accessLevelLabels[p.access_level] || 'Level ' + p.access_level;
        return '<tr>' +
          '<td><div style="font-weight:600;color:' + C.text + '">' + esc(p.title) + '</div>' +
            (p.description ? '<div style="font-size:11px;color:' + C.faint + ';max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.description) + '</div>' : '') +
          '</td>' +
          '<td>' + esc(p.department || '\u2014') + '</td>' +
          '<td>' + (p.reports_to_email ? esc(p.reports_to_email) : '\u2014') + '</td>' +
          '<td>' +
            (p.is_manager ? '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + C.purpleLight + ';color:' + C.purple + '">\u{1F396} Manager</span>' : '<span style="font-size:12px;color:' + C.faint + '">\u2014</span>') +
          '</td>' +
          '<td>' +
            (p.can_create_users ? '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + C.greenLight + ';color:' + C.green + '">\u{2705} Can Create</span>' : '<span style="font-size:12px;color:' + C.faint + '">\u2014</span>') +
          '</td>' +
          '<td><span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + levelColor + '15;color:' + levelColor + '">' + levelLabel + '</span></td>' +
          '<td style="font-weight:600;text-align:center">' + (p.staff_count || 0) + '</td>' +
          '<td>' +
            (p.status === 'active' ? '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + C.greenLight + ';color:' + C.green + '">\u{2705} Active</span>' : '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#f1f5f9;color:#94a3b8">Inactive</span>') +
          '</td>' +
        '</tr>';
      }).join('');

      var managerOptions = managers.map(function(m) {
        return '<option value="' + m.id + '">' + esc(m.email) + '</option>';
      }).join('');

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('positions') +
        '<div class="sac-hero">' +
          '<h1>\u{1F3E2} Position Management</h1>' +
          '<p>Define organizational positions, departments, and management hierarchies</p>' +
        '</div>' +

        (msg ? '<div class="sac-alert sac-alert-' + esc(msgType) + '">' + esc(msg) + '</div>' : '') +

        // Create position form
        '<div class="sac-card" style="margin-bottom:20px">' +
          '<div class="sac-card-title">\u{2795} Create New Position</div>' +
          '<form method="POST" action="/staff-control/positions/create">' +
            '<div class="sac-grid-3">' +
              '<div class="sac-form-group"><label for="title">Position Title <span style="color:' + C.red + '">*</span></label><input id="title" name="title" class="sac-input" required placeholder="e.g. Head Teacher, Bursar..."></div>' +
              '<div class="sac-form-group"><label for="department">Department</label><input id="department" name="department" class="sac-input" placeholder="e.g. Administration, Finance..." list="dept-list">' +
                '<datalist id="dept-list"><option value="Administration"><option value="Finance"><option value="Academics"><option value="Operations"><option value="Support"></datalist>' +
              '</div>' +
              '<div class="sac-form-group"><label for="reports_to">Reports To</label><select id="reports_to" name="reports_to" class="sac-select"><option value="">-- None --</option>' + managerOptions + '</select></div>' +
            '</div>' +
            '<div class="sac-grid-3" style="margin-bottom:16px">' +
              '<div class="sac-form-group"><label for="access_level">Access Level</label><select id="access_level" name="access_level" class="sac-select"><option value="1">1 - Viewer (read-only)</option><option value="2">2 - Editor (can modify)</option><option value="3" selected>3 - Manager (can create users)</option><option value="4">4 - Admin (full access)</option></select></div>' +
              '<div class="sac-form-group"><label for="sort_order">Sort Order</label><input id="sort_order" name="sort_order" type="number" class="sac-input" value="0" min="0"></div>' +
              '<div class="sac-form-group"><label for="max_sub_workers">Max Sub-Workers (0 = unlimited)</label><input id="max_sub_workers" name="max_sub_workers" type="number" class="sac-input" value="0" min="0"></div>' +
            '</div>' +
            '<div style="background:' + C.lighter + ';border-radius:12px;padding:16px;margin-bottom:16px">' +
              '<div class="sac-toggle"><input type="checkbox" name="is_manager" id="is_manager"><label for="is_manager">\u{1F396} This position is a management role</label></div>' +
              '<div class="sac-toggle"><input type="checkbox" name="can_create_users" id="can_create_users"><label for="can_create_users">\u{1F465} Can create new user accounts</label></div>' +
            '</div>' +
            '<div class="sac-form-group"><label for="description">Description</label><textarea id="description" name="description" class="sac-textarea" rows="2" placeholder="Brief description of this position..."></textarea></div>' +
            '<button type="submit" class="sac-btn sac-btn-primary">\u{2705} Create Position</button>' +
          '</form>' +
        '</div>' +

        // Positions table
        '<div class="sac-card">' +
          '<div class="sac-card-header"><div class="sac-card-title">\u{1F3E2} All Positions (' + positions.length + ')</div></div>' +
          '<div style="overflow-x:auto"><table class="sac-table"><thead><tr>' +
            '<th>Position</th><th>Department</th><th>Reports To</th><th>Manager</th><th>Create Users</th><th>Access Level</th><th style="text-align:center">Staff</th><th>Status</th>' +
          '</tr></thead><tbody>' + (positionRows || '<tr><td colspan="8" class="sac-empty">No positions defined yet</td></tr>') + '</tbody></table></div>' +
        '</div>' +
      '</div>';

      res.send(renderPage('Position Management', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 13: POST /staff-control/positions/create — Create Position
  // ============================================================
  app.post('/staff-control/positions/create', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var title = (req.body.title || '').trim();
    var department = (req.body.department || '').trim();
    var reportsTo = parseInt(req.body.reports_to) || null;
    var isManager = req.body.is_manager === 'on';
    var canCreateUsers = req.body.can_create_users === 'on';
    var maxSubWorkers = parseInt(req.body.max_sub_workers) || 0;
    var accessLevel = parseInt(req.body.access_level) || 1;
    var sortOrder = parseInt(req.body.sort_order) || 0;
    var description = (req.body.description || '').trim();

    if (!title) {
      return res.redirect('/staff-control/positions?msg=Position+title+is+required&msg_type=error');
    }

    return pool.query(
      'INSERT INTO staff_positions (tenant_id, title, department, reports_to, description, is_manager, can_create_users, max_sub_workers, access_level, sort_order, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, \'active\', $11)',
      [tid, title, department || null, reportsTo, description || null, isManager, canCreateUsers, maxSubWorkers, accessLevel, sortOrder, user.id]
    ).then(function() {
      logAudit(tid, user.id, 'permission_updated', null, { action: 'position_created', title: title, department: department, is_manager: isManager, can_create_users: canCreateUsers, access_level: accessLevel }, req);
      res.redirect('/staff-control/positions?msg=Position+' + encodeURIComponent(title) + '+created+successfully&msg_type=success');
    }).catch(function(err) {
      res.redirect('/staff-control/positions?msg=' + encodeURIComponent(err.message || 'Error creating position') + '&msg_type=error');
    });
  }));

  // ============================================================
  // ROUTE 14: GET /staff-control/audit — Audit Log
  // ============================================================
  app.get('/staff-control/audit', requireAdmin, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var limit = 25;
    var offset = (page - 1) * limit;
    var filterActor = (req.query.actor || '').trim();
    var filterAction = req.query.action || '';
    var filterDateFrom = req.query.date_from || '';
    var filterDateTo = req.query.date_to || '';
    var exportView = req.query.export === '1';

    var where = ['sal.tenant_id = $1'];
    var params = [tid];
    var pi = 2;

    if (filterActor) {
      where.push('(actor.email ILIKE $' + (pi++) + ')');
      params.push('%' + filterActor + '%');
    }
    if (filterAction) {
      where.push('sal.action = $' + (pi++));
      params.push(filterAction);
    }
    if (filterDateFrom) {
      where.push('sal.created_at >= $' + (pi++));
      params.push(filterDateFrom);
    }
    if (filterDateTo) {
      where.push('sal.created_at <= $' + (pi++) + ' + INTERVAL \'1 day\'');
      params.push(filterDateTo);
    }

    var whereClause = where.join(' AND ');

    return Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM staff_audit_log sal WHERE ' + whereClause, params),
      pool.query(
        'SELECT sal.*, actor.email as actor_email, target.email as target_email FROM staff_audit_log sal LEFT JOIN users actor ON actor.id = sal.actor_id LEFT JOIN users target ON target.id = sal.target_user_id WHERE ' + whereClause + ' ORDER BY sal.created_at DESC LIMIT $' + (pi++) + ' OFFSET $' + (pi++),
        params.concat([limit, offset])
      ),
      pool.query("SELECT DISTINCT action FROM staff_audit_log WHERE tenant_id = $1 ORDER BY action", [tid])
    ]).then(function(results) {
      var totalRows = results[0].rows[0].cnt;
      var logs = results[1].rows;
      var actionTypes = results[2].rows.map(function(r) { return r.action; });
      var totalPages = Math.ceil(totalRows / limit);

      // Export view (simple text display)
      if (exportView) {
        var exportText = 'Staff Audit Log — Generated ' + new Date().toISOString() + '\n';
        exportText += '=' .repeat(100) + '\n\n';
        logs.forEach(function(l) {
          exportText += fmtDateTime(l.created_at) + ' | ' + (l.actor_email || 'System') + ' | ' + actionLabel(l.action) + ' | ' + (l.target_email || 'N/A') + '\n';
          try {
            var d = typeof l.details === 'string' ? JSON.parse(l.details) : (l.details || {});
            Object.keys(d).forEach(function(k) { exportText += '  ' + k + ': ' + d[k] + '\n'; });
          } catch(e) {}
          exportText += '  IP: ' + (l.ip_address || 'N/A') + '\n\n';
        });
        exportText += '=' .repeat(100) + '\nTotal: ' + totalRows + ' entries\n';

        var html = SAC_CSS + '<div class="sac-root">' +
          sacNav('audit') +
          '<div class="sac-card">' +
            '<div class="sac-card-header"><div class="sac-card-title">\u{1F4CB} Audit Log Export</div><a href="/staff-control/audit" class="sac-btn sac-btn-sm sac-btn-secondary">\u{2190} Back</a></div>' +
            '<pre style="background:' + C.surface + ';padding:16px;border-radius:10px;font-size:12px;max-height:600px;overflow:auto;white-space:pre-wrap;word-break:break-all;border:1px solid ' + C.border + '">' + esc(exportText) + '</pre>' +
          '</div>' +
        '</div>';
        return res.send(renderPage('Audit Log Export', html, user, req));
      }

      // Action filter chips
      var actionChips = [''].concat(actionTypes);
      var actionLabelsMap = {
        '': 'All', user_created: '\u{2795} Created', role_changed: '\u{1F504} Role Changed',
        permission_updated: '\u{1F511} Permissions', user_activated: '\u{25B6} Activated',
        user_deactivated: '\u{23F8} Deactivated', user_banned: '\u{1F6AB} Banned',
        user_unbanned: '\u{1F513} Unbanned', login_allowed: '\u{2705} Login Allowed',
        login_blocked: '\u{1F512} Login Blocked'
      };
      var actionChipsHtml = actionChips.map(function(a) {
        var q = '?page=1';
        if (filterActor) q += '&actor=' + encodeURIComponent(filterActor);
        if (filterDateFrom) q += '&date_from=' + encodeURIComponent(filterDateFrom);
        if (filterDateTo) q += '&date_to=' + encodeURIComponent(filterDateTo);
        if (a) q += '&action=' + encodeURIComponent(a);
        var label = actionLabelsMap[a] || (a ? actionLabel(a) : 'All');
        return '<a href="/staff-control/audit' + q + '" class="sac-chip ' + (filterAction === a ? 'active' : '') + '">' + label + '</a>';
      }).join('');

      // Timeline
      var timelineHtml = logs.map(function(l) {
        var color = actionColor(l.action);
        var detailStr = '';
        try {
          var d = typeof l.details === 'string' ? JSON.parse(l.details) : (l.details || {});
          Object.keys(d).forEach(function(k) {
            if (k === '_meta') return;
            detailStr += '<span style="color:' + C.faint + '">' + esc(k) + ':</span> <strong>' + esc(String(d[k]).substring(0, 100)) + '</strong> ';
          });
        } catch(e) {
          detailStr = esc(String(l.details || '').substring(0, 200));
        }

        return '<div class="sac-timeline-item" style="border-left-color:' + color + '">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">' +
            '<span style="font-size:13px;font-weight:600;color:' + C.text + '">' + esc(l.actor_email || 'System') + '</span>' +
            '<span style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:' + color + '20;color:' + color + '">' + actionLabel(l.action) + '</span>' +
            (l.target_email ? '<span style="font-size:12px;color:' + C.muted + '">\u{2192} ' + esc(l.target_email) + '</span>' : '') +
          '</div>' +
          (detailStr ? '<div style="font-size:12px;margin-bottom:4px">' + detailStr + '</div>' : '') +
          '<div style="display:flex;gap:12px;font-size:11px;color:' + C.faint + '">' +
            '<span>' + fmtDateTime(l.created_at) + '</span>' +
            (l.ip_address ? '<span>\u{1F310} ' + esc(l.ip_address) + '</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      // Pagination
      var paginationHtml = '';
      if (totalPages > 1) {
        paginationHtml = '<div class="sac-pagination"><div class="sac-pagination-info">Page ' + page + ' of ' + totalPages + ' (' + totalRows + ' total)</div><div style="display:flex;gap:4px">';
        var baseQ = '?actor=' + encodeURIComponent(filterActor) + '&action=' + encodeURIComponent(filterAction) + '&date_from=' + encodeURIComponent(filterDateFrom) + '&date_to=' + encodeURIComponent(filterDateTo);
        if (page > 1) paginationHtml += '<a href="/staff-control/audit' + baseQ + '&page=' + (page - 1) + '" class="sac-btn sac-btn-sm sac-btn-secondary">\u{2190} Prev</a>';
        if (page < totalPages) paginationHtml += '<a href="/staff-control/audit' + baseQ + '&page=' + (page + 1) + '" class="sac-btn sac-btn-sm sac-btn-primary">Next \u{2192}</a>';
        paginationHtml += '</div></div>';
      }

      var html = SAC_CSS + '<div class="sac-root">' +
        sacNav('audit') +
        '<div class="sac-hero">' +
          '<h1>\u{1F4DD} Audit Log</h1>' +
          '<p>Complete activity timeline for all staff management actions</p>' +
          '<div class="sac-hero-actions">' +
            '<a href="/staff-control/audit?export=1&actor=' + encodeURIComponent(filterActor) + '&action=' + encodeURIComponent(filterAction) + '&date_from=' + encodeURIComponent(filterDateFrom) + '&date_to=' + encodeURIComponent(filterDateTo) + '" class="sac-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">\u{1F4E5} Export View</a>' +
          '</div>' +
        '</div>' +

        // Filters
        '<div class="sac-card" style="margin-bottom:16px">' +
          '<form method="GET" action="/staff-control/audit" class="sac-filter">' +
            '<div><label>Actor (Email)</label><input name="actor" value="' + esc(filterActor) + '" placeholder="Filter by actor email..."></div>' +
            '<div><label>Date From</label><input name="date_from" type="date" value="' + esc(filterDateFrom) + '"></div>' +
            '<div><label>Date To</label><input name="date_to" type="date" value="' + esc(filterDateTo) + '"></div>' +
            '<div style="display:flex;gap:8px;align-self:end"><button type="submit" class="sac-btn sac-btn-primary sac-btn-sm">Filter</button><a href="/staff-control/audit" class="sac-btn sac-btn-secondary sac-btn-sm">Clear</a></div>' +
          '</form>' +
          '<div style="margin-top:10px"><span style="font-size:12px;font-weight:700;color:' + C.muted + '">Actions: </span>' + actionChipsHtml + '</div>' +
        '</div>' +

        // Stats summary
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">' +
          '<div class="sac-card" style="text-align:center;padding:14px"><div style="font-size:22px;font-weight:800;color:' + C.primary + '">' + totalRows + '</div><div style="font-size:11px;color:' + C.faint + '">Total Events</div></div>' +
          '<div class="sac-card" style="text-align:center;padding:14px"><div style="font-size:22px;font-weight:800;color:' + C.green + '">' + logs.filter(function(l) { return l.action === 'user_created' || l.action === 'user_activated'; }).length + '</div><div style="font-size:11px;color:' + C.faint + '">Creations/Activations</div></div>' +
          '<div class="sac-card" style="text-align:center;padding:14px"><div style="font-size:22px;font-weight:800;color:' + C.blue + '">' + logs.filter(function(l) { return l.action === 'role_changed' || l.action === 'permission_updated'; }).length + '</div><div style="font-size:11px;color:' + C.faint + '">Role/Perm Changes</div></div>' +
          '<div class="sac-card" style="text-align:center;padding:14px"><div style="font-size:22px;font-weight:800;color:' + C.red + '">' + logs.filter(function(l) { return l.action === 'user_banned' || l.action === 'user_deactivated'; }).length + '</div><div style="font-size:11px;color:' + C.faint + '">Bans/Deactivations</div></div>' +
        '</div>' +

        // Timeline
        '<div class="sac-card">' +
          '<div class="sac-card-header"><div class="sac-card-title">\u{1F4DD} Activity Timeline</div><div style="font-size:12px;color:' + C.faint + '">' + totalRows + ' events total</div></div>' +
          '<div class="sac-timeline">' + (timelineHtml || '<div class="sac-empty"><div class="sac-empty-icon">\u{1F4DD}</div><p>No audit activity found</p></div>') + '</div>' +
        '</div>' +
        paginationHtml +
      '</div>';

      res.send(renderPage('Audit Log', html, user, req));
    });
  }));

  // ============================================================
  // DONE — Module loaded
  // ============================================================
  console.log('[StaffAccessControl] Module loaded — 14 routes registered under /staff-control');
};
