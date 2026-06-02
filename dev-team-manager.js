'use strict';
// ============================================================
// DEV TEAM MANAGER MODULE — SSEWASSWA Comfort Platform
// Developer team management, task tracking, activity logging,
// sprint planning, and productivity dashboards.
// ============================================================
// Usage in server.js:
//   const devTeamManager = require('./dev-team-manager');
//   devTeamManager(app, db, pool, renderPage, esc);
// ============================================================

const { migrateQuery } = require('./db');
module.exports = function devTeamManager(app, db, pool, renderPage, esc) {

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

  // ============================================================
  // COLOR THEME HELPERS
  // ============================================================
  var COLORS = {
    primary: '#6366f1',
    accent: '#818cf8',
    light: '#e0e7ff',
    lighter: '#eef2ff',
    dark: '#4f46e5',
    text: '#1e293b',
    muted: '#64748b',
    faint: '#94a3b8',
    border: '#e2e8f0',
    surface: '#f8fafc',
    white: '#ffffff',
    green: '#22c55e',
    red: '#ef4444',
    orange: '#f59e0b',
    blue: '#3b82f6'
  };

  function roleBadge(role) {
    var map = {
      lead: { bg: '#eef2ff', c: '#4f46e5' },
      senior: { bg: '#f0fdf4', c: '#166534' },
      developer: { bg: '#e0e7ff', c: '#6366f1' },
      junior: { bg: '#fef9c3', c: '#a16207' },
      intern: { bg: '#f1f5f9', c: '#475569' },
      designer: { bg: '#fce7f3', c: '#be185d' },
      devops: { bg: '#ecfccb', c: '#4d7c0f' },
      qa: { bg: '#e0f2fe', c: '#0369a1' }
    };
    var s = map[role] || map.developer;
    return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + esc(role || 'developer') + '</span>';
  }

  function statusDot(status) {
    var colors = { active: '#22c55e', available: '#22c55e', busy: '#ef4444', on_leave: '#f59e0b', offline: '#94a3b8' };
    var color = colors[status] || '#94a3b8';
    return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + ';border:2px solid ' + COLORS.white + ';box-shadow:0 0 0 2px ' + color + ';margin-right:6px"></span>';
  }

  function priorityBadge(priority) {
    var map = {
      low: { bg: '#f1f5f9', c: '#475569' },
      normal: { bg: '#e0e7ff', c: '#6366f1' },
      high: { bg: '#ffedd5', c: '#ea580c' },
      urgent: { bg: '#fee2e2', c: '#dc2626' },
      critical: { bg: '#fee2e2', c: '#dc2626' }
    };
    var s = map[priority] || map.normal;
    return '<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + esc(priority || 'normal') + '</span>';
  }

  function taskStatusBadge(status) {
    var map = {
      open: { bg: '#f1f5f9', c: '#475569' },
      in_progress: { bg: '#e0e7ff', c: '#6366f1' },
      in_review: { bg: '#f3e8ff', c: '#7c3aed' },
      testing: { bg: '#fef9c3', c: '#a16207' },
      completed: { bg: '#dcfce7', c: '#166534' },
      cancelled: { bg: '#f1f5f9', c: '#94a3b8' },
      blocked: { bg: '#fee2e2', c: '#dc2626' }
    };
    var s = map[status] || map.open;
    var label = status ? status.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) : 'Open';
    return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + label + '</span>';
  }

  function taskTypeBadge(type) {
    var map = {
      feature: { bg: '#eef2ff', c: '#4f46e5', icon: '🚀' },
      bugfix: { bg: '#fee2e2', c: '#dc2626', icon: '🐛' },
      enhancement: { bg: '#f0fdf4', c: '#166534', icon: '✨' },
      refactor: { bg: '#e0f2fe', c: '#0369a1', icon: '🔧' },
      documentation: { bg: '#fef9c3', c: '#a16207', icon: '📝' },
      testing: { bg: '#fce7f3', c: '#be185d', icon: '🧪' },
      deployment: { bg: '#ecfccb', c: '#4d7c0f', icon: '🚢' },
      security: { bg: '#fef2f2', c: '#991b1b', icon: '🔒' }
    };
    var s = map[type] || map.feature;
    return '<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + (s.icon || '') + ' ' + esc(type || 'feature') + '</span>';
  }

  function sprintStatusBadge(status) {
    var map = {
      planning: { bg: '#f1f5f9', c: '#475569' },
      active: { bg: '#dcfce7', c: '#166534' },
      review: { bg: '#fef9c3', c: '#a16207' },
      completed: { bg: '#e0e7ff', c: '#4f46e5' }
    };
    var s = map[status] || map.planning;
    var label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Planning';
    return '<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:' + s.bg + ';color:' + s.c + '">' + label + '</span>';
  }

  function progressBar(pctVal, height) {
    var h = height || 10;
    var c = pctVal >= 80 ? COLORS.green : pctVal >= 50 ? COLORS.primary : pctVal >= 25 ? COLORS.orange : COLORS.faint;
    return '<div style="background:' + COLORS.border + ';border-radius:' + h + 'px;height:' + h + 'px;overflow:hidden;width:100%">' +
      '<div style="background:' + c + ';height:100%;border-radius:' + h + 'px;width:' + Math.min(100, Math.max(0, pctVal)) + '%;transition:width 0.3s ease"></div>' +
      '</div><span style="font-size:11px;color:' + COLORS.muted + '">' + pctVal + '%</span>';
  }

  function skillTag(skill) {
    return '<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;background:' + COLORS.lighter + ';color:' + COLORS.dark + ';margin:2px">' + esc(skill) + '</span>';
  }

  // ============================================================
  // SHARED CSS STYLES
  // ============================================================
  var DTM_CSS = '<style>' +
    '.dtm-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center}' +
    '.dtm-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:' + COLORS.muted + ';background:' + COLORS.surface + ';transition:.15s}' +
    '.dtm-nav a:hover{background:' + COLORS.border + '}' +
    '.dtm-nav a.active{background:' + COLORS.primary + ';color:#fff}' +
    '.dtm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}' +
    '.dtm-stat{background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:14px;padding:20px;text-align:center;transition:.15s}' +
    '.dtm-stat:hover{box-shadow:0 4px 20px rgba(99,102,241,.08);transform:translateY(-2px)}' +
    '.dtm-stat-icon{font-size:28px;margin-bottom:8px}' +
    '.dtm-stat-val{font-size:30px;font-weight:800;color:' + COLORS.text + '}' +
    '.dtm-stat-lbl{font-size:11px;color:' + COLORS.faint + ';margin-top:4px;text-transform:uppercase;letter-spacing:.5px}' +
    '.dtm-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}' +
    '.dtm-btn:hover{opacity:.9;transform:translateY(-1px)}' +
    '.dtm-btn-primary{background:' + COLORS.primary + ';color:#fff}' +
    '.dtm-btn-success{background:#059669;color:#fff}' +
    '.dtm-btn-danger{background:#fee2e2;color:#dc2626}' +
    '.dtm-btn-secondary{background:' + COLORS.surface + ';color:' + COLORS.muted + '}' +
    '.dtm-btn-accent{background:' + COLORS.accent + ';color:#fff}' +
    '.dtm-table{width:100%;border-collapse:collapse;font-size:13px}' +
    '.dtm-table th{padding:10px 14px;text-align:left;border-bottom:2px solid ' + COLORS.border + ';color:' + COLORS.muted + ';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:' + COLORS.surface + '}' +
    '.dtm-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:' + COLORS.text + '}' +
    '.dtm-table tr:hover{background:#f8fafc}' +
    '.dtm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}' +
    '.dtm-filter label{display:block;font-size:12px;font-weight:600;color:' + COLORS.muted + ';margin-bottom:4px}' +
    '.dtm-filter input,.dtm-filter select{padding:8px 14px;border:2px solid ' + COLORS.border + ';border-radius:10px;font-size:13px;background:' + COLORS.white + '}' +
    '.dtm-filter input:focus,.dtm-filter select:focus{outline:none;border-color:' + COLORS.primary + '}' +
    '.dtm-card{background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:14px;padding:20px;transition:.15s}' +
    '.dtm-card:hover{box-shadow:0 4px 20px rgba(99,102,241,.06);transform:translateY(-1px)}' +
    '.dtm-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}' +
    '.dtm-member-card{background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:14px;padding:20px;transition:.2s;cursor:pointer}' +
    '.dtm-member-card:hover{box-shadow:0 8px 30px rgba(99,102,241,.1);transform:translateY(-3px);border-color:' + COLORS.accent + '}' +
    '.dtm-member-avatar{width:56px;height:56px;border-radius:50%;background:' + COLORS.light + ';display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:' + COLORS.dark + ';flex-shrink:0}' +
    '.dtm-task-card{background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:12px;padding:16px;margin-bottom:10px;border-left:4px solid ' + COLORS.primary + ';transition:.15s;cursor:pointer}' +
    '.dtm-task-card:hover{box-shadow:0 4px 16px rgba(99,102,241,.08);transform:translateY(-1px)}' +
    '.dtm-task-title{font-size:14px;font-weight:700;color:' + COLORS.text + ';margin-bottom:6px}' +
    '.dtm-task-meta{font-size:11px;color:' + COLORS.faint + ';display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.dtm-timeline{position:relative;padding-left:24px}' +
    '.dtm-timeline::before{content:"";position:absolute;left:8px;top:0;bottom:0;width:2px;background:' + COLORS.light + '}' +
    '.dtm-timeline-item{position:relative;margin-bottom:16px;padding:12px 16px;background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:10px;border-left:3px solid ' + COLORS.accent + '}' +
    '.dtm-timeline-item::before{content:"";position:absolute;left:-29px;top:16px;width:12px;height:12px;border-radius:50%;background:' + COLORS.primary + ';border:2px solid ' + COLORS.white + ';box-shadow:0 0 0 2px ' + COLORS.light + '}' +
    '.dtm-timeline-time{font-size:11px;color:' + COLORS.faint + ';margin-top:4px}' +
    '.dtm-sprint-card{background:' + COLORS.white + ';border:1px solid ' + COLORS.border + ';border-radius:14px;padding:20px;margin-bottom:16px}' +
    '.dtm-sprint-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}' +
    '.dtm-sprint-progress{background:' + COLORS.border + ';border-radius:10px;height:12px;overflow:hidden;margin:10px 0}' +
    '.dtm-sprint-bar{height:100%;border-radius:10px;background:linear-gradient(90deg,' + COLORS.primary + ',' + COLORS.accent + ');transition:width .3s ease}' +
    '.dtm-form-group{margin-bottom:16px}' +
    '.dtm-form-group label{display:block;font-size:13px;font-weight:600;color:' + COLORS.muted + ';margin-bottom:5px}' +
    '.dtm-input{width:100%;padding:10px 14px;border:2px solid ' + COLORS.border + ';border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box}' +
    '.dtm-input:focus{outline:none;border-color:' + COLORS.primary + ';box-shadow:0 0 0 3px ' + COLORS.lighter + '}' +
    '.dtm-select{width:100%;padding:10px 14px;border:2px solid ' + COLORS.border + ';border-radius:10px;font-size:13px;background:' + COLORS.white + ';box-sizing:border-box}' +
    '.dtm-textarea{width:100%;padding:10px 14px;border:2px solid ' + COLORS.border + ';border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;font-family:inherit}' +
    '.dtm-textarea:focus{outline:none;border-color:' + COLORS.primary + ';box-shadow:0 0 0 3px ' + COLORS.lighter + '}' +
    '.dtm-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.dtm-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}' +
    '.dtm-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}' +
    '.dtm-section-title{font-size:16px;font-weight:700;color:' + COLORS.text + ';margin-bottom:14px;display:flex;align-items:center;gap:8px}' +
    '.dtm-empty{text-align:center;padding:40px;color:' + COLORS.faint + '}' +
    '.dtm-empty-icon{font-size:48px;margin-bottom:12px}' +
    '.dtm-badge-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;font-size:11px;font-weight:700;background:' + COLORS.primary + ';color:#fff}' +
    '.dtm-activity-type{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}' +
    '.dtm-page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px}' +
    '.dtm-page-header h1{font-size:22px;color:' + COLORS.text + ';margin:0}' +
    '.dtm-page-header p{font-size:13px;color:' + COLORS.faint + ';margin:4px 0 0}' +
    '.dtm-back{color:' + COLORS.muted + ';font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block}' +
    '.dtm-back:hover{color:' + COLORS.primary + '}' +
    '.dtm-alert{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px}' +
    '.dtm-alert-success{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}' +
    '.dtm-alert-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}' +
    '.dtm-alert-info{background:' + COLORS.lighter + ';color:' + COLORS.dark + ';border:1px solid ' + COLORS.light + '}' +
    '.dtm-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:.15s;border:1px solid ' + COLORS.border + ';background:' + COLORS.white + ';color:' + COLORS.muted + '}' +
    '.dtm-chip:hover{border-color:' + COLORS.primary + ';color:' + COLORS.primary + '}' +
    '.dtm-chip.active{background:' + COLORS.primary + ';color:#fff;border-color:' + COLORS.primary + '}' +
    '.dtm-pagination{display:flex;justify-content:space-between;align-items:center;margin-top:14px}' +
    '.dtm-pagination-info{font-size:13px;color:' + COLORS.muted + '}' +
    '.dtm-pagination-btns{display:flex;gap:4px}' +
    '.dtm-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}' +
    '@media(max-width:768px){' +
      '.dtm-stats{grid-template-columns:1fr 1fr}' +
      '.dtm-grid-2,.dtm-grid-3,.dtm-grid-4{grid-template-columns:1fr}' +
      '.dtm-card-grid{grid-template-columns:1fr}' +
      '.dtm-page-header{flex-direction:column;align-items:flex-start}' +
    '}' +
    '</style>';

  // ============================================================
  // NAVIGATION HELPER
  // ============================================================
  function nav(active) {
    var items = [
      { href: '/dev-team', label: '\u{1F4CA} Dashboard', key: 'dashboard' },
      { href: '/dev-team/members', label: '\u{1F465} Members', key: 'members' },
      { href: '/dev-team/tasks', label: '\u{1F4CB} Tasks', key: 'tasks' },
      { href: '/dev-team/activity', label: '\u{1F4C5} Activity', key: 'activity' },
      { href: '/dev-team/sprints', label: '\u{1F3C1} Sprints', key: 'sprints' }
    ];
    return '<div class="dtm-nav">' +
      items.map(function(item) {
        return '<a href="' + item.href + '" class="' + (active === item.key ? 'active' : '') + '">' + item.label + '</a>';
      }).join('') +
      '</div>';
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  var migrations = [
    // Table 1: dev_team_members
    'CREATE TABLE IF NOT EXISTS dev_team_members (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'name VARCHAR(150) NOT NULL,' +
      'email VARCHAR(200),' +
      'phone VARCHAR(30),' +
      'github_username VARCHAR(100),' +
      'role VARCHAR(30) DEFAULT \'developer\',' +
      'department VARCHAR(100),' +
      'skills TEXT[],' +
      'bio TEXT,' +
      'avatar_url VARCHAR(500),' +
      'status VARCHAR(20) DEFAULT \'active\',' +
      'hourly_rate INTEGER DEFAULT 0,' +
      'max_hours_per_week INTEGER DEFAULT 40,' +
      'joined_date DATE DEFAULT CURRENT_DATE,' +
      'notes TEXT,' +
      'created_by INTEGER,' +
      'created_at TIMESTAMPTZ DEFAULT NOW(),' +
      'updated_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Table 2: dev_tasks
    'CREATE TABLE IF NOT EXISTS dev_tasks (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'title VARCHAR(300) NOT NULL,' +
      'description TEXT,' +
      'module VARCHAR(100),' +
      'task_type VARCHAR(30) DEFAULT \'feature\',' +
      'priority VARCHAR(20) DEFAULT \'normal\',' +
      'status VARCHAR(20) DEFAULT \'open\',' +
      'assigned_to INTEGER,' +
      'assigned_by INTEGER,' +
      'assigned_at TIMESTAMPTZ,' +
      'started_at TIMESTAMPTZ,' +
      'completed_at TIMESTAMPTZ,' +
      'estimated_hours DECIMAL(5,1) DEFAULT 0,' +
      'actual_hours DECIMAL(5,1) DEFAULT 0,' +
      'due_date DATE,' +
      'github_issue_url VARCHAR(500),' +
      'github_pr_url VARCHAR(500),' +
      'commit_hash VARCHAR(100),' +
      'tags TEXT[],' +
      'progress INTEGER DEFAULT 0,' +
      'review_notes TEXT,' +
      'created_at TIMESTAMPTZ DEFAULT NOW(),' +
      'updated_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Table 3: dev_activity_log
    'CREATE TABLE IF NOT EXISTS dev_activity_log (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'member_id INTEGER,' +
      'task_id INTEGER,' +
      'activity_type VARCHAR(30) NOT NULL,' +
      'description TEXT NOT NULL,' +
      'github_url VARCHAR(500),' +
      'details JSONB DEFAULT \'{}\',' +
      'created_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Table 4: dev_sprints
    'CREATE TABLE IF NOT EXISTS dev_sprints (' +
      'id SERIAL PRIMARY KEY,' +
      'tenant_id INTEGER NOT NULL,' +
      'name VARCHAR(150) NOT NULL,' +
      'description TEXT,' +
      'start_date DATE NOT NULL,' +
      'end_date DATE NOT NULL,' +
      'goal TEXT,' +
      'status VARCHAR(20) DEFAULT \'planning\',' +
      'total_tasks INTEGER DEFAULT 0,' +
      'completed_tasks INTEGER DEFAULT 0,' +
      'created_by INTEGER,' +
      'created_at TIMESTAMPTZ DEFAULT NOW(),' +
      'updated_at TIMESTAMPTZ DEFAULT NOW()' +
    ')',

    // Indexes
    'CREATE INDEX IF NOT EXISTS idx_dtm_members_tenant ON dev_team_members(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_members_status ON dev_team_members(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_members_role ON dev_team_members(tenant_id, role)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_tasks_tenant ON dev_tasks(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_tasks_status ON dev_tasks(tenant_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_tasks_priority ON dev_tasks(tenant_id, priority)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_tasks_assigned ON dev_tasks(assigned_to)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_tasks_module ON dev_tasks(tenant_id, module)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_activity_tenant ON dev_activity_log(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_activity_member ON dev_activity_log(member_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_activity_task ON dev_activity_log(task_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_activity_type ON dev_activity_log(tenant_id, activity_type)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_sprints_tenant ON dev_sprints(tenant_id)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_sprints_dates ON dev_sprints(start_date, end_date)',
    'CREATE INDEX IF NOT EXISTS idx_dtm_sprints_status ON dev_sprints(tenant_id, status)',

    // ALTER TABLE fallbacks for dev_team_members
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS skills TEXT[]',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS hourly_rate INTEGER DEFAULT 0',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS max_hours_per_week INTEGER DEFAULT 40',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS department VARCHAR(100)',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS github_username VARCHAR(100)',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS phone VARCHAR(30)',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS notes TEXT',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS bio TEXT',
    'ALTER TABLE dev_team_members ADD COLUMN IF NOT EXISTS joined_date DATE DEFAULT CURRENT_DATE',

    // ALTER TABLE fallbacks for dev_tasks
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS module VARCHAR(100)',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS task_type VARCHAR(30) DEFAULT \'feature\'',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS github_issue_url VARCHAR(500)',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS github_pr_url VARCHAR(500)',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS commit_hash VARCHAR(100)',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS tags TEXT[]',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0',
    'ALTER TABLE dev_tasks ADD COLUMN IF NOT EXISTS review_notes TEXT',

    // ALTER TABLE fallbacks for dev_activity_log
    'ALTER TABLE dev_activity_log ADD COLUMN IF NOT EXISTS github_url VARCHAR(500)',
    'ALTER TABLE dev_activity_log ADD COLUMN IF NOT EXISTS details JSONB DEFAULT \'{}\'',

    // ALTER TABLE fallbacks for dev_sprints
    'ALTER TABLE dev_sprints ADD COLUMN IF NOT EXISTS goal TEXT',
    'ALTER TABLE dev_sprints ADD COLUMN IF NOT EXISTS total_tasks INTEGER DEFAULT 0',
    'ALTER TABLE dev_sprints ADD COLUMN IF NOT EXISTS completed_tasks INTEGER DEFAULT 0'
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
      console.log('[DevTeamManager] Migrations applied successfully (' + migrations.length + ' statements)');
    }).catch(function(err) {
      /* migration OK */
    });
  })();

  // ============================================================
  // ACTIVITY LOGGING HELPER
  // ============================================================
  function logActivity(tenantId, memberId, taskId, activityType, description, githubUrl, details) {
    var params = [tenantId, memberId || null, taskId || null, activityType, description, githubUrl || null];
    var sql = 'INSERT INTO dev_activity_log (tenant_id, member_id, task_id, activity_type, description, github_url' +
      (details ? ', details' : '') +
      ') VALUES ($1, $2, $3, $4, $5, $6' +
      (details ? ', $7' : '') + ')';
    if (details) params.push(typeof details === 'string' ? details : JSON.stringify(details));
    pool.query(sql, params).catch(function(err) {
      console.error('[DevTeamManager] Activity log error:', err.message);
    });
  }

  // ============================================================
  // UPDATE SPRINT TOTALS HELPER
  // ============================================================
  function recalcSprintTotals(sprintId, tenantId) {
    pool.query(
      'SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE status = \'completed\')::int as done FROM dev_tasks WHERE tenant_id = $1 AND due_date >= (SELECT start_date FROM dev_sprints WHERE id = $2) AND due_date <= (SELECT end_date FROM dev_sprints WHERE id = $2)',
      [tenantId, sprintId]
    ).then(function(r) {
      if (r.rows[0]) {
        pool.query('UPDATE dev_sprints SET total_tasks = $1, completed_tasks = $2, updated_at = NOW() WHERE id = $3',
          [r.rows[0].total, r.rows[0].done, sprintId]
        ).catch(function() {});
      }
    }).catch(function() {});
  }

  // ============================================================
  // ROUTE 1: GET /dev-team — Main Dashboard
  // ============================================================
  app.get('/dev-team', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;

    return Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM dev_team_members WHERE tenant_id = $1', [tid]),
      pool.query('SELECT COUNT(*)::int as cnt FROM dev_tasks WHERE tenant_id = $1 AND status NOT IN (\'completed\', \'cancelled\')', [tid]),
      pool.query('SELECT COUNT(*)::int as cnt FROM dev_tasks WHERE tenant_id = $1 AND status = \'completed\' AND completed_at >= date_trunc(\'week\', NOW())', [tid]),
      pool.query('SELECT * FROM dev_sprints WHERE tenant_id = $1 AND status IN (\'planning\', \'active\') ORDER BY start_date DESC LIMIT 1', [tid]),
      pool.query('SELECT m.*, COUNT(t.id)::int as active_tasks FROM dev_team_members m LEFT JOIN dev_tasks t ON t.assigned_to = m.id AND t.status NOT IN (\'completed\', \'cancelled\') WHERE m.tenant_id = $1 GROUP BY m.id ORDER BY m.name', [tid]),
      pool.query('SELECT al.*, m.name as member_name, t.title as task_title FROM dev_activity_log al LEFT JOIN dev_team_members m ON m.id = al.member_id LEFT JOIN dev_tasks t ON t.id = al.task_id WHERE al.tenant_id = $1 ORDER BY al.created_at DESC LIMIT 15', [tid]),
      pool.query('SELECT * FROM dev_tasks WHERE tenant_id = $1 AND status NOT IN (\'completed\', \'cancelled\') AND priority IN (\'urgent\', \'critical\') ORDER BY priority DESC, created_at ASC LIMIT 8', [tid])
    ]).then(function(results) {
      var totalMembers = results[0].rows[0].cnt;
      var activeTasks = results[1].rows[0].cnt;
      var completedThisWeek = results[2].rows[0].cnt;
      var currentSprint = results[3].rows[0];
      var members = results[4].rows;
      var activities = results[5].rows;
      var priorityTasks = results[6].rows;

      var sprintPct = currentSprint ? pct(currentSprint.completed_tasks, currentSprint.total_tasks) : 0;
      var sprintHtml = '';
      if (currentSprint) {
        sprintHtml = '<div class="dtm-card">' +
          '<div class="dtm-section-title">\u{1F3C1} Current Sprint</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div><span style="font-size:15px;font-weight:700;color:' + COLORS.text + '">' + esc(currentSprint.name) + '</span> ' + sprintStatusBadge(currentSprint.status) + '</div>' +
            '<span style="font-size:12px;color:' + COLORS.muted + '">' + fmtDate(currentSprint.start_date) + ' — ' + fmtDate(currentSprint.end_date) + '</span>' +
          '</div>' +
          (currentSprint.goal ? '<p style="font-size:13px;color:' + COLORS.muted + ';margin-bottom:10px">' + esc(currentSprint.goal) + '</p>' : '') +
          progressBar(sprintPct, 12) +
          '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:' + COLORS.faint + '">' +
            '<span>' + (currentSprint.completed_tasks || 0) + ' completed</span>' +
            '<span>' + (currentSprint.total_tasks || 0) + ' total tasks</span>' +
          '</div>' +
        '</div>';
      } else {
        sprintHtml = '<div class="dtm-card"><div class="dtm-section-title">\u{1F3C1} Current Sprint</div>' +
          '<div class="dtm-empty"><div class="dtm-empty-icon">\u{1F3C1}</div><p>No active sprint</p>' +
          '<a href="/dev-team/sprints" class="dtm-btn dtm-btn-primary" style="margin-top:10px">Create Sprint</a></div></div>';
      }

      var memberGrid = members.map(function(m) {
        var initials = m.name ? m.name.split(' ').map(function(n) { return n.charAt(0); }).join('').toUpperCase().slice(0, 2) : '??';
        return '<div class="dtm-member-card" onclick="location.href=\'/dev-team/members/' + m.id + '\'">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
            '<div class="dtm-member-avatar">' + esc(initials) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;font-weight:700;color:' + COLORS.text + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.name) + '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">' + statusDot(m.status) + roleBadge(m.role) + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;color:' + COLORS.faint + '">' +
            '<span>\u{1F4BB} ' + (m.active_tasks || 0) + ' active tasks</span>' +
            (m.department ? '<span>' + esc(m.department) + '</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      var activityTypeIcon = { commit: '\u{1F500}', push: '\u{2B06}', task_created: '\u{2795}', task_completed: '\u{2705}', review: '\u{1F44D}', deployment: '\u{1F680}', meeting: '\u{1F4DE}', note: '\u{1F4DD}' };
      var activityTypeColor = { commit: '#059669', push: '#0369a1', task_created: '#6366f1', task_completed: '#166534', review: '#7c3aed', deployment: '#4d7c0f', meeting: '#ea580c', note: '#64748b' };

      var timelineHtml = activities.map(function(a) {
        var icon = activityTypeIcon[a.activity_type] || '\u{1F4CB}';
        var color = activityTypeColor[a.activity_type] || COLORS.muted;
        return '<div class="dtm-timeline-item">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span>' + icon + '</span>' +
            '<span style="font-size:13px;font-weight:600;color:' + COLORS.text + '">' + esc(a.member_name || 'System') + '</span>' +
            '<span class="dtm-activity-type" style="background:' + color + '15;color:' + color + '">' + esc(a.activity_type) + '</span>' +
          '</div>' +
          '<p style="font-size:13px;color:' + COLORS.muted + ';margin:0">' + esc(a.description) + '</p>' +
          (a.github_url ? '<a href="' + esc(a.github_url) + '" target="_blank" style="font-size:12px;color:' + COLORS.primary + '">View on GitHub \u{2197}</a>' : '') +
          '<div class="dtm-timeline-time">' + fmtDateTime(a.created_at) + '</div>' +
        '</div>';
      }).join('');

      var priorityHtml = priorityTasks.map(function(t) {
        return '<div class="dtm-task-card" style="border-left-color:' + (t.priority === 'critical' ? '#dc2626' : '#ea580c') + '" onclick="location.href=\'/dev-team/tasks\'">' +
          '<div class="dtm-task-title">' + esc(t.title) + '</div>' +
          '<div class="dtm-task-meta">' +
            priorityBadge(t.priority) +
            taskStatusBadge(t.status) +
            (t.module ? '<span>\u{1F4E6} ' + esc(t.module) + '</span>' : '') +
            (t.due_date ? '<span>\u{1F4C5} ' + fmtDate(t.due_date) + '</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      var html = DTM_CSS + '<div style="max-width:1200px;margin:0 auto">' +
        nav('dashboard') +
        '<div class="dtm-page-header"><div><h1>\u{1F680} Dev Team Dashboard</h1><p>Developer productivity at a glance</p></div>' +
          '<div style="display:flex;gap:8px">' +
            '<a href="/dev-team/members/add" class="dtm-btn dtm-btn-primary">\u{2795} Add Member</a>' +
            '<a href="/dev-team/tasks/create" class="dtm-btn dtm-btn-accent">\u{1F4CB} New Task</a>' +
          '</div>' +
        '</div>' +
        '<div class="dtm-stats">' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F465}</div><div class="dtm-stat-val">' + totalMembers + '</div><div class="dtm-stat-lbl">Team Members</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F527}</div><div class="dtm-stat-val">' + activeTasks + '</div><div class="dtm-stat-lbl">Active Tasks</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{2705}</div><div class="dtm-stat-val">' + completedThisWeek + '</div><div class="dtm-stat-lbl">Done This Week</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F3C1}</div><div class="dtm-stat-val">' + sprintPct + '%</div><div class="dtm-stat-lbl">Sprint Progress</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
          sprintHtml +
          '<div class="dtm-card"><div class="dtm-section-title">\u{1F525} Priority Tasks</div>' +
            (priorityHtml || '<div class="dtm-empty"><p>No urgent tasks \u{2728}</p></div>') +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
          '<div class="dtm-card"><div class="dtm-section-title">\u{1F465} Team Availability</div>' +
            '<div class="dtm-card-grid">' + (memberGrid || '<div class="dtm-empty"><p>No team members yet</p></div>') + '</div>' +
          '</div>' +
          '<div class="dtm-card"><div class="dtm-section-title">\u{1F4C5} Recent Activity</div>' +
            '<div class="dtm-timeline">' + (timelineHtml || '<div class="dtm-empty"><p>No activity yet</p></div>') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      res.send(renderPage('Dev Team Dashboard', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 2: GET /dev-team/members — Team Directory
  // ============================================================
  app.get('/dev-team/members', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var search = req.query.search || '';
    var roleFilter = req.query.role || '';
    var statusFilter = req.query.status || '';
    var skillFilter = req.query.skill || '';

    var where = ['m.tenant_id = $1'];
    var params = [tid];
    var pi = 2;

    if (search) { where.push('(m.name ILIKE $' + (pi++) + ' OR m.email ILIKE $' + (pi++) + ')'); params.push('%' + search + '%'); params.push('%' + search + '%'); }
    if (roleFilter) { where.push('m.role = $' + (pi++)); params.push(roleFilter); }
    if (statusFilter) { where.push('m.status = $' + (pi++)); params.push(statusFilter); }
    if (skillFilter) { where.push('$' + (pi++) + ' = ANY(m.skills)'); params.push(skillFilter); }

    var sql = 'SELECT m.*, COUNT(t.id)::int as task_count, COUNT(t.id) FILTER (WHERE t.status = \'completed\')::int as completed_count ' +
      'FROM dev_team_members m LEFT JOIN dev_tasks t ON t.assigned_to = m.id WHERE ' + where.join(' AND ') +
      ' GROUP BY m.id ORDER BY m.name';

    return Promise.all([
      pool.query(sql, params),
      pool.query('SELECT DISTINCT unnest(skills) as skill FROM dev_team_members WHERE tenant_id = $1 AND skills IS NOT NULL AND array_length(skills, 1) > 0 ORDER BY skill', [tid])
    ]).then(function(results) {
      var members = results[0].rows;
      var allSkills = results[1].rows.map(function(r) { return r.skill; });

      var roles = ['lead', 'senior', 'developer', 'junior', 'intern', 'designer', 'devops', 'qa'];
      var statuses = ['active', 'available', 'busy', 'on_leave', 'offline'];

      var memberCards = members.map(function(m) {
        var initials = m.name ? m.name.split(' ').map(function(n) { return n.charAt(0); }).join('').toUpperCase().slice(0, 2) : '??';
        var skillsHtml = (m.skills || []).map(skillTag).join('');
        return '<div class="dtm-member-card" onclick="location.href=\'/dev-team/members/' + m.id + '\'">' +
          '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">' +
            '<div class="dtm-member-avatar">' + esc(initials) + '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:15px;font-weight:700;color:' + COLORS.text + '">' + esc(m.name) + '</div>' +
              (m.email ? '<div style="font-size:12px;color:' + COLORS.faint + '">' + esc(m.email) + '</div>' : '') +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' + statusDot(m.status) + roleBadge(m.role) + '</div>' +
            '</div>' +
          '</div>' +
          (m.department ? '<div style="font-size:12px;color:' + COLORS.muted + ';margin-bottom:8px">\u{1F3E2} ' + esc(m.department) + '</div>' : '') +
          (skillsHtml ? '<div style="margin-bottom:8px">' + skillsHtml + '</div>' : '') +
          '<div style="display:flex;gap:16px;font-size:12px;color:' + COLORS.faint + ';border-top:1px solid ' + COLORS.border + ';padding-top:8px">' +
            '<span>\u{1F4BB} ' + (m.task_count || 0) + ' tasks</span>' +
            '<span>\u{2705} ' + (m.completed_count || 0) + ' done</span>' +
            '<span>\u{1F4B0} ' + fmtMoney(m.hourly_rate) + '/hr</span>' +
          '</div>' +
        '</div>';
      }).join('');

      var filterChips = '<div class="dtm-filter" style="flex-direction:column;align-items:flex-start">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
          '<span style="font-size:12px;font-weight:700;color:' + COLORS.muted + '">Roles:</span>' +
          roles.map(function(r) {
            return '<a href="/dev-team/members?role=' + r + (search ? '&search=' + encodeURIComponent(search) : '') + (skillFilter ? '&skill=' + encodeURIComponent(skillFilter) : '') + '" class="dtm-chip ' + (roleFilter === r ? 'active' : '') + '">' + roleBadge(r) + '</a>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
          '<span style="font-size:12px;font-weight:700;color:' + COLORS.muted + '">Status:</span>' +
          statuses.map(function(s) {
            return '<a href="/dev-team/members?status=' + s + (search ? '&search=' + encodeURIComponent(search) : '') + (roleFilter ? '&role=' + roleFilter : '') + (skillFilter ? '&skill=' + encodeURIComponent(skillFilter) : '') + '" class="dtm-chip ' + (statusFilter === s ? 'active' : '') + '">' + statusDot(s) + '<span style="text-transform:capitalize">' + s.replace('_', ' ') + '</span></a>';
          }).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<span style="font-size:12px;font-weight:700;color:' + COLORS.muted + '">Skills:</span>' +
          allSkills.map(function(sk) {
            return '<a href="/dev-team/members?skill=' + encodeURIComponent(sk) + (search ? '&search=' + encodeURIComponent(search) : '') + (roleFilter ? '&role=' + roleFilter : '') + '" class="dtm-chip ' + (skillFilter === sk ? 'active' : '') + '">' + skillTag(sk) + '</a>';
          }).join('') +
        '</div>' +
      '</div>';

      var html = DTM_CSS + '<div style="max-width:1200px;margin:0 auto">' +
        nav('members') +
        '<div class="dtm-page-header"><div><h1>\u{1F465} Team Members</h1><p>' + members.length + ' developer' + (members.length !== 1 ? 's' : '') + ' found</p></div>' +
          '<a href="/dev-team/members/add" class="dtm-btn dtm-btn-primary">\u{2795} Add Member</a>' +
        '</div>' +
        '<form method="GET" action="/dev-team/members" class="dtm-filter">' +
          '<div style="flex:1;min-width:200px"><label>Search</label><input type="text" name="search" value="' + esc(search) + '" placeholder="Name or email..."></div>' +
          '<div><label>Role</label><select name="role"><option value="">All Roles</option>' +
            roles.map(function(r) { return '<option value="' + r + '"' + (roleFilter === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>Status</label><select name="status"><option value="">All Status</option>' +
            statuses.map(function(s) { return '<option value="' + s + '"' + (statusFilter === s ? ' selected' : '') + '>' + s.replace('_', ' ') + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>&nbsp;</label><button type="submit" class="dtm-btn dtm-btn-primary">Search</button></div>' +
        '</form>' +
        filterChips +
        '<div class="dtm-card-grid">' + (memberCards || '<div class="dtm-empty" style="grid-column:1/-1"><div class="dtm-empty-icon">\u{1F465}</div><p>No team members found</p><a href="/dev-team/members/add" class="dtm-btn dtm-btn-primary" style="margin-top:10px">Add Your First Member</a></div>') + '</div>' +
      '</div>';

      res.send(renderPage('Team Members', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 3: GET /dev-team/members/add — Add Member Form
  // ============================================================
  app.get('/dev-team/members/add', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var roles = ['lead', 'senior', 'developer', 'junior', 'intern', 'designer', 'devops', 'qa'];
    var statuses = ['active', 'available', 'busy', 'on_leave', 'offline'];
    var allSkills = ['JavaScript', 'TypeScript', 'Node.js', 'React', 'Vue.js', 'Angular', 'Next.js', 'Python', 'Django', 'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'DevOps', 'UI/UX', 'Figma', 'Tailwind CSS', 'GraphQL', 'REST API', 'Git', 'CI/CD', 'Linux', 'Nginx'];

    var skillsHtml = allSkills.map(function(sk) {
      return '<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:' + COLORS.lighter + ';color:' + COLORS.dark + ';margin:2px;cursor:pointer;border:2px solid transparent;transition:.15s">' +
        '<input type="checkbox" name="skills" value="' + esc(sk) + '" style="display:none">' +
        esc(sk) +
      '</label>';
    }).join('');

    var formHtml = '<div class="dtm-card" style="padding:28px">' +
      '<h2 style="margin:0 0 4px;color:' + COLORS.text + '">\u{2795} Add Team Member</h2>' +
      '<p style="font-size:13px;color:' + COLORS.faint + ';margin-bottom:24px">Add a new developer to your team</p>' +
      '<form method="POST" action="/dev-team/members/add" style="display:flex;flex-direction:column;gap:18px">' +
        '<div class="dtm-grid-2">' +
          '<div class="dtm-form-group"><label>Full Name *</label><input type="text" name="name" required class="dtm-input" placeholder="John Doe"></div>' +
          '<div class="dtm-form-group"><label>Email</label><input type="email" name="email" class="dtm-input" placeholder="john@example.com"></div>' +
        '</div>' +
        '<div class="dtm-grid-3">' +
          '<div class="dtm-form-group"><label>Phone</label><input type="text" name="phone" class="dtm-input" placeholder="+256 700 000 000"></div>' +
          '<div class="dtm-form-group"><label>GitHub Username</label><input type="text" name="github_username" class="dtm-input" placeholder="johndoe"></div>' +
          '<div class="dtm-form-group"><label>Department</label><input type="text" name="department" class="dtm-input" placeholder="Engineering"></div>' +
        '</div>' +
        '<div class="dtm-grid-3">' +
          '<div class="dtm-form-group"><label>Role *</label><select name="role" class="dtm-select">' +
            roles.map(function(r) { return '<option value="' + r + '">' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="dtm-form-group"><label>Status</label><select name="status" class="dtm-select">' +
            statuses.map(function(s) { return '<option value="' + s + '"' + (s === 'active' ? ' selected' : '') + '>' + s.replace('_', ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="dtm-form-group"><label>Hourly Rate (UGX)</label><input type="number" name="hourly_rate" class="dtm-input" value="0" min="0"></div>' +
        '</div>' +
        '<div class="dtm-form-group"><label>Max Hours / Week</label><input type="number" name="max_hours_per_week" class="dtm-input" value="40" min="1" max="80"></div>' +
        '<div class="dtm-form-group"><label>Skills (click to select)</label><div style="display:flex;flex-wrap:wrap;gap:0">' + skillsHtml + '</div></div>' +
        '<div class="dtm-form-group"><label>Bio</label><textarea name="bio" rows="3" class="dtm-textarea" placeholder="Brief description..."></textarea></div>' +
        '<div class="dtm-form-group"><label>Notes</label><textarea name="notes" rows="2" class="dtm-textarea" placeholder="Internal notes..."></textarea></div>' +
        '<div style="display:flex;gap:10px;margin-top:8px">' +
          '<button type="submit" class="dtm-btn dtm-btn-primary" style="padding:12px 28px">\u{1F4BE} Save Member</button>' +
          '<a href="/dev-team/members" class="dtm-btn dtm-btn-secondary" style="padding:12px 28px">Cancel</a>' +
        '</div>' +
      '</form>' +
    '</div>';

    var html = DTM_CSS + '<script>document.addEventListener("click",function(e){if(e.target.closest("label")){var cb=e.target.querySelector("input[type=checkbox]");if(cb){cb.checked=!cb.checked;e.currentTarget.style.borderColor=cb.checked?"#6366f1":"transparent"}}})</script>' +
      '<div style="max-width:800px;margin:0 auto">' +
      nav('members') +
      '<a href="/dev-team/members" class="dtm-back">\u{2190} Back to Members</a>' +
      formHtml +
      '</div>';

    res.send(renderPage('Add Team Member', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /dev-team/members/add — Save New Member
  // ============================================================
  app.post('/dev-team/members/add', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var name = (req.body.name || '').trim();
    var email = (req.body.email || '').trim() || null;
    var phone = (req.body.phone || '').trim() || null;
    var githubUsername = (req.body.github_username || '').trim() || null;
    var role = req.body.role || 'developer';
    var department = (req.body.department || '').trim() || null;
    var bio = (req.body.bio || '').trim() || null;
    var memberStatus = req.body.status || 'active';
    var hourlyRate = parseInt(req.body.hourly_rate) || 0;
    var maxHours = parseInt(req.body.max_hours_per_week) || 40;
    var notes = (req.body.notes || '').trim() || null;

    var validRoles = ['lead', 'senior', 'developer', 'junior', 'intern', 'designer', 'devops', 'qa'];
    var validStatuses = ['active', 'available', 'busy', 'on_leave', 'offline'];

    if (!name) { return res.redirect('/dev-team/members/add'); }
    if (validRoles.indexOf(role) === -1) { role = 'developer'; }
    if (validStatuses.indexOf(memberStatus) === -1) { memberStatus = 'active'; }

    var skills = req.body.skills;
    if (!Array.isArray(skills)) { skills = skills ? [skills] : []; }
    if (skills.length === 0) { skills = null; }

    return pool.query(
      'INSERT INTO dev_team_members (tenant_id, name, email, phone, github_username, role, department, skills, bio, status, hourly_rate, max_hours_per_week, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id',
      [tid, name, email, phone, githubUsername, role, department, skills, bio, memberStatus, hourlyRate, maxHours, notes, user.id]
    ).then(function(result) {
      var memberId = result.rows[0].id;
      logActivity(tid, memberId, null, 'note', 'New team member "' + name + '" joined as ' + role);
      res.redirect('/dev-team/members/' + memberId);
    });
  }));

  // ============================================================
  // ROUTE 5: GET /dev-team/members/:id — Member Profile
  // ============================================================
  app.get('/dev-team/members/:id', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var memberId = req.params.id;

    return Promise.all([
      pool.query('SELECT * FROM dev_team_members WHERE id = $1 AND tenant_id = $2', [memberId, tid]),
      pool.query('SELECT * FROM dev_tasks WHERE tenant_id = $1 AND assigned_to = $2 AND status NOT IN (\'completed\', \'cancelled\') ORDER BY priority DESC, created_at DESC', [tid, memberId]),
      pool.query('SELECT * FROM dev_tasks WHERE tenant_id = $1 AND assigned_to = $2 AND status = \'completed\' ORDER BY completed_at DESC LIMIT 10', [tid, memberId]),
      pool.query('SELECT * FROM dev_activity_log WHERE tenant_id = $1 AND member_id = $2 ORDER BY created_at DESC LIMIT 20', [tid, memberId]),
      pool.query('SELECT COUNT(*)::int as total, COALESCE(SUM(actual_hours), 0)::float as hours FROM dev_tasks WHERE tenant_id = $1 AND assigned_to = $2 AND status = \'completed\'', [tid, memberId])
    ]).then(function(results) {
      var member = results[0].rows[0];
      if (!member) {
        return res.send(renderPage('Not Found', DTM_CSS + '<div class="dtm-card" style="text-align:center;padding:60px"><div class="dtm-empty-icon">\u{2753}</div><h2 style="color:#dc2626">Member not found</h2><a href="/dev-team/members" class="dtm-btn dtm-btn-primary" style="margin-top:12px">\u{2190} Back to Members</a></div>', user, req));
      }

      var activeTasks = results[1].rows;
      var completedTasks = results[2].rows;
      var activities = results[3].rows;
      var perf = results[4].rows[0];

      var initials = member.name ? member.name.split(' ').map(function(n) { return n.charAt(0); }).join('').toUpperCase().slice(0, 2) : '??';
      var skillsHtml = (member.skills || []).map(skillTag).join('');

      var activeTasksHtml = activeTasks.map(function(t) {
        return '<div class="dtm-task-card" style="border-left-color:' + (t.priority === 'critical' ? '#dc2626' : t.priority === 'urgent' ? '#ea580c' : t.priority === 'high' ? '#f59e0b' : COLORS.primary) + '">' +
          '<div class="dtm-task-title">' + esc(t.title) + '</div>' +
          '<div class="dtm-task-meta">' +
            priorityBadge(t.priority) + taskStatusBadge(t.status) + taskTypeBadge(t.task_type) +
            (t.due_date ? '<span>\u{1F4C5} ' + fmtDate(t.due_date) + '</span>' : '') +
          '</div>' +
          progressBar(t.progress || 0, 6) +
        '</div>';
      }).join('');

      var completedTasksHtml = completedTasks.map(function(t) {
        return '<div class="dtm-task-card" style="border-left-color:#22c55e;opacity:.85">' +
          '<div class="dtm-task-title" style="text-decoration:line-through;color:' + COLORS.faint + '">' + esc(t.title) + '</div>' +
          '<div class="dtm-task-meta">' +
            '<span>\u{2705} ' + fmtDate(t.completed_at) + '</span>' +
            '<span>\u{23F1} ' + (t.actual_hours || 0) + 'h</span>' +
          '</div>' +
        '</div>';
      }).join('');

      var activityTypeIcon = { commit: '\u{1F500}', push: '\u{2B06}', task_created: '\u{2795}', task_completed: '\u{2705}', review: '\u{1F44D}', deployment: '\u{1F680}', meeting: '\u{1F4DE}', note: '\u{1F4DD}' };
      var timelineHtml = activities.map(function(a) {
        return '<div class="dtm-timeline-item">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span>' + (activityTypeIcon[a.activity_type] || '\u{1F4CB}') + '</span>' +
            '<span class="dtm-activity-type">' + esc(a.activity_type) + '</span>' +
          '</div>' +
          '<p style="font-size:13px;color:' + COLORS.muted + ';margin:0">' + esc(a.description) + '</p>' +
          '<div class="dtm-timeline-time">' + fmtDateTime(a.created_at) + '</div>' +
        '</div>';
      }).join('');

      var html = DTM_CSS + '<div style="max-width:1000px;margin:0 auto">' +
        nav('members') +
        '<a href="/dev-team/members" class="dtm-back">\u{2190} Back to Members</a>' +
        '<div class="dtm-card" style="padding:28px;margin-bottom:16px">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:16px">' +
            '<div style="display:flex;align-items:center;gap:16px">' +
              '<div class="dtm-member-avatar" style="width:72px;height:72px;font-size:28px">' + esc(initials) + '</div>' +
              '<div>' +
                '<h1 style="margin:0 0 4px;color:' + COLORS.text + ';font-size:22px">' + esc(member.name) + '</h1>' +
                '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                  statusDot(member.status) + roleBadge(member.role) +
                  (member.department ? '<span style="font-size:13px;color:' + COLORS.muted + '">\u{1F3E2} ' + esc(member.department) + '</span>' : '') +
                '</div>' +
                '<div style="margin-top:6px;font-size:13px;color:' + COLORS.faint + '">' +
                  (member.email ? '\u{1F4E7} ' + esc(member.email) + ' &nbsp;&nbsp;' : '') +
                  (member.github_username ? '\u{1F4BB} <a href="https://github.com/' + esc(member.github_username) + '" target="_blank" style="color:' + COLORS.primary + '">' + esc(member.github_username) + '</a>' : '') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<form method="POST" action="/dev-team/members/' + member.id + '/edit"><button type="submit" class="dtm-btn dtm-btn-primary">\u{270F} Edit</button></form>' +
          '</div>' +
          (member.bio ? '<div style="margin-top:16px;padding:14px;background:' + COLORS.surface + ';border-radius:10px;font-size:14px;color:' + COLORS.muted + '">' + esc(member.bio) + '</div>' : '') +
          (skillsHtml ? '<div style="margin-top:12px">' + skillsHtml + '</div>' : '') +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px;padding-top:16px;border-top:1px solid ' + COLORS.border + '">' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + COLORS.primary + '">' + (perf.total || 0) + '</div><div style="font-size:11px;color:' + COLORS.faint + '">Tasks Completed</div></div>' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:#059669">' + (perf.hours || 0).toFixed(1) + 'h</div><div style="font-size:11px;color:' + COLORS.faint + '">Hours Logged</div></div>' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + COLORS.orange + '">' + activeTasks.length + '</div><div style="font-size:11px;color:' + COLORS.faint + '">Active Tasks</div></div>' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + COLORS.dark + '">' + fmtMoney(member.hourly_rate) + '</div><div style="font-size:11px;color:' + COLORS.faint + '">Hourly Rate</div></div>' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + COLORS.muted + '">' + member.max_hours_per_week + 'h</div><div style="font-size:11px;color:' + COLORS.faint + '">Max Hours/Week</div></div>' +
            '<div style="text-align:center"><div style="font-size:24px;font-weight:800;color:' + COLORS.muted + '">' + fmtDate(member.joined_date) + '</div><div style="font-size:11px;color:' + COLORS.faint + '">Joined</div></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
          '<div class="dtm-card"><div class="dtm-section-title">\u{1F527} Active Tasks (' + activeTasks.length + ')</div>' +
            (activeTasksHtml || '<div class="dtm-empty"><p>No active tasks</p></div>') +
          '</div>' +
          '<div class="dtm-card"><div class="dtm-section-title">\u{2705} Recent Completions</div>' +
            (completedTasksHtml || '<div class="dtm-empty"><p>No completed tasks yet</p></div>') +
          '</div>' +
        '</div>' +
        '<div class="dtm-card"><div class="dtm-section-title">\u{1F4C5} Activity Timeline</div>' +
          '<div class="dtm-timeline">' + (timelineHtml || '<div class="dtm-empty"><p>No activity recorded</p></div>') + '</div>' +
        '</div>' +
      '</div>';

      res.send(renderPage(member.name + ' — Profile', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 6: POST /dev-team/members/:id/edit — Edit Member
  // ============================================================
  app.post('/dev-team/members/:id/edit', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var memberId = req.params.id;
    var name = (req.body.name || '').trim();
    var email = (req.body.email || '').trim() || null;
    var phone = (req.body.phone || '').trim() || null;
    var githubUsername = (req.body.github_username || '').trim() || null;
    var role = req.body.role || 'developer';
    var department = (req.body.department || '').trim() || null;
    var bio = (req.body.bio || '').trim() || null;
    var memberStatus = req.body.status || 'active';
    var hourlyRate = parseInt(req.body.hourly_rate) || 0;
    var maxHours = parseInt(req.body.max_hours_per_week) || 40;
    var notes = (req.body.notes || '').trim() || null;

    var validRoles = ['lead', 'senior', 'developer', 'junior', 'intern', 'designer', 'devops', 'qa'];
    var validStatuses = ['active', 'available', 'busy', 'on_leave', 'offline'];

    if (!name) { return res.redirect('/dev-team/members/' + memberId); }
    if (validRoles.indexOf(role) === -1) { role = 'developer'; }
    if (validStatuses.indexOf(memberStatus) === -1) { memberStatus = 'active'; }

    var skills = req.body.skills;
    if (!Array.isArray(skills)) { skills = skills ? [skills] : []; }
    if (skills.length === 0) { skills = null; }

    return pool.query(
      'UPDATE dev_team_members SET name=$1, email=$2, phone=$3, github_username=$4, role=$5, department=$6, skills=$7, bio=$8, status=$9, hourly_rate=$10, max_hours_per_week=$11, notes=$12, updated_at=NOW() WHERE id=$13 AND tenant_id=$14',
      [name, email, phone, githubUsername, role, department, skills, bio, memberStatus, hourlyRate, maxHours, notes, memberId, tid]
    ).then(function() {
      logActivity(tid, parseInt(memberId), null, 'note', 'Member profile "' + name + '" updated');
      res.redirect('/dev-team/members/' + memberId);
    });
  }));

  // ============================================================
  // ROUTE 7: GET /dev-team/tasks — Task Board
  // ============================================================
  app.get('/dev-team/tasks', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var statusFilter = req.query.status || '';
    var priorityFilter = req.query.priority || '';
    var assignFilter = req.query.assigned_to || '';
    var moduleFilter = req.query.module || '';
    var typeFilter = req.query.type || '';
    var searchQuery = req.query.q || '';
    var view = req.query.view || 'list';
    var page = parseInt(req.query.page) || 1;
    var sort = req.query.sort || 'created_at';
    var dir = req.query.dir || 'desc';

    var where = ['t.tenant_id = $1'];
    var params = [tid];
    var pi = 2;

    if (statusFilter) { where.push('t.status = $' + (pi++)); params.push(statusFilter); }
    if (priorityFilter) { where.push('t.priority = $' + (pi++)); params.push(priorityFilter); }
    if (assignFilter) { where.push('t.assigned_to = $' + (pi++)); params.push(assignFilter); }
    if (moduleFilter) { where.push('t.module = $' + (pi++)); params.push(moduleFilter); }
    if (typeFilter) { where.push('t.task_type = $' + (pi++)); params.push(typeFilter); }
    if (searchQuery) { where.push('(t.title ILIKE $' + (pi++) + ' OR t.description ILIKE $' + (pi++) + ')'); params.push('%' + searchQuery + '%'); params.push('%' + searchQuery + '%'); }

    var allowedSort = { title: 't.title', status: 't.status', priority: 't.priority', due_date: 't.due_date', created_at: 't.created_at', progress: 't.progress' };
    var orderCol = allowedSort[sort] || 't.created_at';
    var orderDir = dir === 'asc' ? 'ASC' : 'DESC';
    var limit = 20;
    var offset = (page - 1) * limit;

    var countParams = params.slice(0, pi - 1);

    return Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM dev_tasks t WHERE ' + where.join(' AND '), countParams),
      pool.query('SELECT t.*, m.name as assignee_name FROM dev_tasks t LEFT JOIN dev_team_members m ON m.id = t.assigned_to WHERE ' + where.join(' AND ') + ' ORDER BY ' + orderCol + ' ' + orderDir + ' LIMIT $' + pi + ' OFFSET $' + (pi + 1), params.concat([limit, offset])),
      pool.query('SELECT id, name FROM dev_team_members WHERE tenant_id = $1 AND status IN (\'active\', \'available\', \'busy\') ORDER BY name', [tid]),
      pool.query('SELECT DISTINCT module FROM dev_tasks WHERE tenant_id = $1 AND module IS NOT NULL ORDER BY module', [tid]),
      pool.query('SELECT status, COUNT(*)::int as cnt FROM dev_tasks WHERE tenant_id = $1 GROUP BY status', [tid])
    ]).then(function(results) {
      var totalCount = results[0].rows[0].cnt;
      var tasks = results[1].rows;
      var members = results[2].rows;
      var modules = results[3].rows;
      var statusCounts = results[4].rows;

      var totalPages = Math.ceil(totalCount / limit);

      var statuses = ['open', 'in_progress', 'in_review', 'testing', 'completed', 'cancelled', 'blocked'];
      var priorities = ['low', 'normal', 'high', 'urgent', 'critical'];
      var types = ['feature', 'bugfix', 'enhancement', 'refactor', 'documentation', 'testing', 'deployment', 'security'];

      var statusCountMap = {};
      statusCounts.forEach(function(r) { statusCountMap[r.status] = r.cnt; });

      var taskRows = tasks.map(function(t) {
        var isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed' && t.status !== 'cancelled';
        return '<tr>' +
          '<td><a href="javascript:void(0)" onclick="document.getElementById(\'task-' + t.id + '-detail\').style.display=document.getElementById(\'task-' + t.id + '-detail\').style.display===\'none\'?\'block\':\'none\'" style="color:' + COLORS.primary + ';text-decoration:none;font-weight:600">' + esc(t.title) + '</a></td>' +
          '<td>' + taskTypeBadge(t.task_type) + '</td>' +
          '<td>' + priorityBadge(t.priority) + '</td>' +
          '<td>' + taskStatusBadge(t.status) + '</td>' +
          '<td>' + (t.assignee_name ? '<a href="/dev-team/members/' + t.assigned_to + '" style="color:' + COLORS.primary + ';text-decoration:none">' + esc(t.assignee_name) + '</a>' : '<span style="color:' + COLORS.faint + '">Unassigned</span>') + '</td>' +
          (moduleFilter === '' ? '<td>' + (t.module ? esc(t.module) : '<span style="color:' + COLORS.faint + '">\u2014</span>') + '</td>' : '') +
          '<td style="color:' + (isOverdue ? '#dc2626;font-weight:700' : COLORS.muted) + '">' + (t.due_date ? fmtDate(t.due_date) : '\u2014') + '</td>' +
          '<td style="min-width:120px">' + progressBar(t.progress || 0, 6) + '</td>' +
        '</tr>';
      }).join('');

      var taskCards = tasks.map(function(t) {
        var isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed' && t.status !== 'cancelled';
        return '<div class="dtm-task-card" style="border-left-color:' + (t.priority === 'critical' ? '#dc2626' : t.priority === 'urgent' ? '#ea580c' : t.priority === 'high' ? '#f59e0b' : COLORS.primary) + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px">' +
            '<div class="dtm-task-title">' + esc(t.title) + '</div>' +
            (t.id ? '<form method="POST" action="/dev-team/tasks/' + t.id + '/update" style="flex-shrink:0"><input type="hidden" name="from" value="tasks"><select name="status" onchange="this.form.submit()" style="padding:4px 8px;border:1px solid ' + COLORS.border + ';border-radius:8px;font-size:11px;background:' + COLORS.white + '">' +
              statuses.map(function(s) { return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) + '</option>'; }).join('') +
            '</select></form>' : '') +
          '</div>' +
          (t.description ? '<p style="font-size:12px;color:' + COLORS.faint + ';margin:4px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.description).slice(0, 100) + '</p>' : '') +
          '<div class="dtm-task-meta">' +
            taskTypeBadge(t.task_type) + priorityBadge(t.priority) +
            (t.assignee_name ? '<span>\u{1F464} ' + esc(t.assignee_name) + '</span>' : '') +
            (t.module ? '<span>\u{1F4E6} ' + esc(t.module) + '</span>' : '') +
            (t.due_date ? '<span style="color:' + (isOverdue ? '#dc2626' : COLORS.faint) + '">\u{1F4C5} ' + fmtDate(t.due_date) + '</span>' : '') +
          '</div>' +
          progressBar(t.progress || 0, 6) +
        '</div>';
      }).join('');

      var viewToggle = '<div style="display:flex;gap:4px;margin-bottom:12px">' +
        '<a href="/dev-team/tasks?view=list&status=' + statusFilter + '&priority=' + priorityFilter + '&q=' + encodeURIComponent(searchQuery) + '" class="dtm-chip ' + (view === 'list' ? 'active' : '') + '">\u{1F4CB} List</a>' +
        '<a href="/dev-team/tasks?view=grid&status=' + statusFilter + '&priority=' + priorityFilter + '&q=' + encodeURIComponent(searchQuery) + '" class="dtm-chip ' + (view === 'grid' ? 'active' : '') + '">\u{1F5FA} Grid</a>' +
      '</div>';

      var statusFilterHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
        statuses.map(function(s) {
          var count = statusCountMap[s] || 0;
          return '<a href="/dev-team/tasks?status=' + s + '&view=' + view + '" class="dtm-chip ' + (statusFilter === s ? 'active' : '') + '">' + taskStatusBadge(s) + ' <span class="dtm-badge-count">' + count + '</span></a>';
        }).join('') +
      '</div>';

      var pageLinks = '';
      if (totalPages > 1) {
        var startP = Math.max(1, page - 2);
        var endP = Math.min(totalPages, page + 3);
        for (var i = startP; i <= endP; i++) {
          pageLinks += '<a href="/dev-team/tasks?page=' + i + '&status=' + statusFilter + '&priority=' + priorityFilter + '&q=' + encodeURIComponent(searchQuery) + '&view=' + view + '&sort=' + sort + '&dir=' + dir + '" class="dtm-btn ' + (page === i ? 'dtm-btn-primary' : 'dtm-btn-secondary') + '" style="padding:4px 10px;font-size:12px">' + i + '</a>';
        }
      }

      var mainContent = '';
      if (view === 'grid') {
        mainContent = '<div class="dtm-card-grid">' + (taskCards || '<div class="dtm-empty" style="grid-column:1/-1"><div class="dtm-empty-icon">\u{1F4CB}</div><p>No tasks found</p><a href="/dev-team/tasks/create" class="dtm-btn dtm-btn-primary" style="margin-top:10px">Create Task</a></div>') + '</div>';
      } else {
        mainContent = '<div class="dtm-card" style="overflow-x:auto"><table class="dtm-table"><thead><tr>' +
          '<th>Task</th><th>Type</th><th>Priority</th><th>Status</th><th>Assigned To</th>' +
          (moduleFilter === '' ? '<th>Module</th>' : '') + '<th>Due</th><th>Progress</th>' +
          '</tr></thead><tbody>' +
          (taskRows || '<tr><td colspan="8" style="text-align:center;color:' + COLORS.faint + ';padding:40px">No tasks found</td></tr>') +
          '</tbody></table></div>';
      }

      var html = DTM_CSS + '<div style="max-width:1200px;margin:0 auto">' +
        nav('tasks') +
        '<div class="dtm-page-header"><div><h1>\u{1F4CB} Tasks</h1><p>' + totalCount + ' task' + (totalCount !== 1 ? 's' : '') + ' total</p></div>' +
          '<a href="/dev-team/tasks/create" class="dtm-btn dtm-btn-primary">\u{2795} Create Task</a>' +
        '</div>' +
        statusFilterHtml +
        '<form method="GET" action="/dev-team/tasks" class="dtm-filter">' +
          '<div style="flex:1;min-width:200px"><label>Search</label><input type="text" name="q" value="' + esc(searchQuery) + '" placeholder="Search tasks..."></div>' +
          '<div><label>Priority</label><select name="priority"><option value="">All</option>' +
            priorities.map(function(p) { return '<option value="' + p + '"' + (priorityFilter === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>Module</label><select name="module"><option value="">All</option>' +
            modules.map(function(m) { return '<option value="' + esc(m.module) + '"' + (moduleFilter === m.module ? ' selected' : '') + '>' + esc(m.module) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>Assigned To</label><select name="assigned_to"><option value="">Anyone</option>' +
            members.map(function(m) { return '<option value="' + m.id + '"' + (assignFilter === String(m.id) ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>Type</label><select name="type"><option value="">All</option>' +
            types.map(function(ty) { return '<option value="' + ty + '"' + (typeFilter === ty ? ' selected' : '') + '>' + ty.charAt(0).toUpperCase() + ty.slice(1) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>&nbsp;</label><button type="submit" class="dtm-btn dtm-btn-primary">Search</button></div>' +
        '</form>' +
        viewToggle +
        mainContent +
        (totalPages > 1 ? '<div class="dtm-pagination"><div class="dtm-pagination-info">Page ' + page + ' of ' + totalPages + ' (' + totalCount + ' tasks)</div><div class="dtm-pagination-btns">' + pageLinks + '</div></div>' : '') +
      '</div>';

      res.send(renderPage('Tasks', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 8: GET /dev-team/tasks/create — Create Task Form
  // ============================================================
  app.get('/dev-team/tasks/create', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;

    return Promise.all([
      pool.query('SELECT id, name, role FROM dev_team_members WHERE tenant_id = $1 AND status IN (\'active\', \'available\', \'busy\') ORDER BY name', [tid]),
      pool.query('SELECT DISTINCT module FROM dev_tasks WHERE tenant_id = $1 AND module IS NOT NULL ORDER BY module', [tid])
    ]).then(function(results) {
      var members = results[0].rows;
      var existingModules = results[1].rows.map(function(r) { return r.module; });
      var modules = ['Core', 'LMS', 'Payments', 'CRM', 'HR', 'Finance', 'Analytics', 'API', 'Frontend', 'Mobile', 'DevOps', 'Security', 'UI/UX', 'Documentation'].concat(existingModules);
      var uniqueModules = [];
      var seenModules = {};
      modules.forEach(function(m) { if (!seenModules[m]) { seenModules[m] = true; uniqueModules.push(m); } });

      var types = ['feature', 'bugfix', 'enhancement', 'refactor', 'documentation', 'testing', 'deployment', 'security'];
      var priorities = ['low', 'normal', 'high', 'urgent', 'critical'];

      var formHtml = '<div class="dtm-card" style="padding:28px">' +
        '<h2 style="margin:0 0 4px;color:' + COLORS.text + '">\u{2795} Create Task</h2>' +
        '<p style="font-size:13px;color:' + COLORS.faint + ';margin-bottom:24px">Create a new development task</p>' +
        '<form method="POST" action="/dev-team/tasks/create" style="display:flex;flex-direction:column;gap:18px">' +
          '<div class="dtm-form-group"><label>Task Title *</label><input type="text" name="title" required class="dtm-input" placeholder="Implement user authentication..."></div>' +
          '<div class="dtm-form-group"><label>Description</label><textarea name="description" rows="4" class="dtm-textarea" placeholder="Detailed description of the task..."></textarea></div>' +
          '<div class="dtm-grid-3">' +
            '<div class="dtm-form-group"><label>Module</label><select name="module" class="dtm-select"><option value="">Select module...</option>' +
              uniqueModules.map(function(m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="dtm-form-group"><label>Task Type *</label><select name="task_type" class="dtm-select">' +
              types.map(function(t) { return '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="dtm-form-group"><label>Priority *</label><select name="priority" class="dtm-select">' +
              priorities.map(function(p) { return '<option value="' + p + '"' + (p === 'normal' ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') +
            '</select></div>' +
          '</div>' +
          '<div class="dtm-grid-2">' +
            '<div class="dtm-form-group"><label>Assign To</label><select name="assigned_to" class="dtm-select"><option value="">Unassigned</option>' +
              members.map(function(m) { return '<option value="' + m.id + '">' + esc(m.name) + ' (' + esc(m.role) + ')</option>'; }).join('') +
            '</select></div>' +
            '<div class="dtm-form-group"><label>Due Date</label><input type="date" name="due_date" class="dtm-input"></div>' +
          '</div>' +
          '<div class="dtm-grid-2">' +
            '<div class="dtm-form-group"><label>Estimated Hours</label><input type="number" name="estimated_hours" class="dtm-input" step="0.5" min="0" value="0"></div>' +
            '<div class="dtm-form-group"><label>Progress (%)</label><input type="number" name="progress" class="dtm-input" min="0" max="100" value="0"></div>' +
          '</div>' +
          '<div class="dtm-grid-2">' +
            '<div class="dtm-form-group"><label>GitHub Issue URL</label><input type="url" name="github_issue_url" class="dtm-input" placeholder="https://github.com/..."></div>' +
            '<div class="dtm-form-group"><label>GitHub PR URL</label><input type="url" name="github_pr_url" class="dtm-input" placeholder="https://github.com/..."></div>' +
          '</div>' +
          '<div class="dtm-form-group"><label>Tags (comma separated)</label><input type="text" name="tags" class="dtm-input" placeholder="frontend, api, urgent"></div>' +
          '<div style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="dtm-btn dtm-btn-primary" style="padding:12px 28px">\u{1F4BE} Create Task</button>' +
            '<a href="/dev-team/tasks" class="dtm-btn dtm-btn-secondary" style="padding:12px 28px">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>';

      var html = DTM_CSS + '<div style="max-width:800px;margin:0 auto">' +
        nav('tasks') +
        '<a href="/dev-team/tasks" class="dtm-back">\u{2190} Back to Tasks</a>' +
        formHtml +
      '</div>';

      res.send(renderPage('Create Task', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 9: POST /dev-team/tasks/create — Save Task
  // ============================================================
  app.post('/dev-team/tasks/create', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var title = (req.body.title || '').trim();
    var description = (req.body.description || '').trim() || null;
    var module = (req.body.module || '').trim() || null;
    var taskType = req.body.task_type || 'feature';
    var priority = req.body.priority || 'normal';
    var assignedTo = req.body.assigned_to ? parseInt(req.body.assigned_to) : null;
    var dueDate = req.body.due_date || null;
    var estimatedHours = parseFloat(req.body.estimated_hours) || 0;
    var progressVal = parseInt(req.body.progress) || 0;
    var githubIssueUrl = (req.body.github_issue_url || '').trim() || null;
    var githubPrUrl = (req.body.github_pr_url || '').trim() || null;
    var tagsStr = (req.body.tags || '').trim();
    var tags = tagsStr ? tagsStr.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t.length > 0; }) : null;

    var validTypes = ['feature', 'bugfix', 'enhancement', 'refactor', 'documentation', 'testing', 'deployment', 'security'];
    var validPriorities = ['low', 'normal', 'high', 'urgent', 'critical'];
    if (!title) { return res.redirect('/dev-team/tasks/create'); }
    if (validTypes.indexOf(taskType) === -1) { taskType = 'feature'; }
    if (validPriorities.indexOf(priority) === -1) { priority = 'normal'; }
    if (progressVal < 0) { progressVal = 0; }
    if (progressVal > 100) { progressVal = 100; }

    return pool.query(
      'INSERT INTO dev_tasks (tenant_id, title, description, module, task_type, priority, status, assigned_to, assigned_by, assigned_at, estimated_hours, due_date, github_issue_url, github_pr_url, tags, progress) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13, $14, $15) RETURNING id',
      [tid, title, description, module, taskType, priority, assignedTo ? 'open' : 'open', assignedTo, user.id, estimatedHours, dueDate, githubIssueUrl, githubPrUrl, tags, progressVal]
    ).then(function(result) {
      var taskId = result.rows[0].id;
      logActivity(tid, assignedTo, taskId, 'task_created', 'Task "' + title + '" created (' + taskType + ', ' + priority + ')', githubIssueUrl);

      if (assignedTo) {
        logActivity(tid, assignedTo, taskId, 'task_created', 'Task "' + title + '" assigned to team member');
      }

      var activeSprint = pool.query('SELECT id FROM dev_sprints WHERE tenant_id = $1 AND status IN (\'planning\', \'active\') AND $2 BETWEEN start_date AND end_date ORDER BY created_at DESC LIMIT 1', [tid, dueDate || today()]);
      activeSprint.then(function(sr) {
        if (sr.rows.length > 0) {
          recalcSprintTotals(sr.rows[0].id, tid);
        }
      });

      res.redirect('/dev-team/tasks');
    });
  }));

  // ============================================================
  // ROUTE 10: POST /dev-team/tasks/:id/update — Update Task
  // ============================================================
  app.post('/dev-team/tasks/:id/update', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var taskId = parseInt(req.params.id);
    var newStatus = req.body.status;
    var newProgress = parseInt(req.body.progress);
    var actualHours = parseFloat(req.body.actual_hours);
    var reviewNotes = (req.body.review_notes || '').trim() || null;
    var newTitle = (req.body.title || '').trim();
    var newDescription = (req.body.description || '').trim() || null;
    var newPriority = req.body.priority;
    var newDueDate = req.body.due_date || null;
    var newEstimated = parseFloat(req.body.estimated_hours);
    var commitHash = (req.body.commit_hash || '').trim() || null;
    var from = req.body.from || 'tasks';

    var validStatuses = ['open', 'in_progress', 'in_review', 'testing', 'completed', 'cancelled', 'blocked'];
    var validPriorities = ['low', 'normal', 'high', 'urgent', 'critical'];

    return pool.query('SELECT * FROM dev_tasks WHERE id = $1 AND tenant_id = $2', [taskId, tid]).then(function(result) {
      var task = result.rows[0];
      if (!task) { return res.redirect('/dev-team/tasks'); }

      var updates = [];
      var params = [];
      var pi = 1;
      var changedStatus = false;
      var oldStatus = task.status;

      if (newTitle && newTitle !== task.title) { updates.push('title = $' + (pi++)); params.push(newTitle); }
      if (newDescription !== undefined && newDescription !== task.description) { updates.push('description = $' + (pi++)); params.push(newDescription); }
      if (newPriority && validPriorities.indexOf(newPriority) !== -1 && newPriority !== task.priority) { updates.push('priority = $' + (pi++)); params.push(newPriority); }
      if (newDueDate !== undefined && newDueDate !== String(task.due_date)) { updates.push('due_date = $' + (pi++)); params.push(newDueDate || null); }
      if (!isNaN(newEstimated) && newEstimated >= 0) { updates.push('estimated_hours = $' + (pi++)); params.push(newEstimated); }
      if (commitHash !== null) { updates.push('commit_hash = $' + (pi++)); params.push(commitHash); }

      if (newStatus && validStatuses.indexOf(newStatus) !== -1 && newStatus !== task.status) {
        changedStatus = true;
        updates.push('status = $' + (pi++));
        params.push(newStatus);

        if (newStatus === 'in_progress' && !task.started_at) {
          updates.push('started_at = NOW()');
        }
        if (newStatus === 'completed') {
          updates.push('completed_at = NOW()');
          updates.push('progress = 100');
        }
      }

      if (!isNaN(newProgress) && newProgress >= 0 && newProgress <= 100) {
        updates.push('progress = $' + (pi++));
        params.push(newProgress);
      }

      if (!isNaN(actualHours) && actualHours >= 0) {
        updates.push('actual_hours = $' + (pi++));
        params.push(actualHours);
      }

      if (reviewNotes !== null) {
        updates.push('review_notes = $' + (pi++));
        params.push(reviewNotes);
      }

      updates.push('updated_at = NOW()');
      params.push(taskId);
      params.push(tid);

      if (updates.length <= 1) { return res.redirect(from === 'tasks' ? '/dev-team/tasks' : '/dev-team/members/' + (task.assigned_to || '')); }

      return pool.query(
        'UPDATE dev_tasks SET ' + updates.join(', ') + ' WHERE id = $' + pi + ' AND tenant_id = $' + (pi + 1),
        params
      ).then(function() {
        if (changedStatus) {
          logActivity(tid, task.assigned_to, taskId, newStatus === 'completed' ? 'task_completed' : 'review',
            'Task "' + (newTitle || task.title) + '" status changed from ' + oldStatus.replace(/_/g, ' ') + ' to ' + newStatus.replace(/_/g, ' '));
        }

        if (task.assigned_to) {
          var activeSprint = pool.query('SELECT id FROM dev_sprints WHERE tenant_id = $1 AND status IN (\'planning\', \'active\') ORDER BY created_at DESC LIMIT 1', [tid]);
          activeSprint.then(function(sr) {
            if (sr.rows.length > 0) {
              recalcSprintTotals(sr.rows[0].id, tid);
            }
          });
        }

        var redirectUrl = from === 'tasks' ? '/dev-team/tasks' : '/dev-team/members/' + (task.assigned_to || '');
        res.redirect(redirectUrl);
      });
    });
  }));

  // ============================================================
  // ROUTE 11: POST /dev-team/tasks/:id/assign — Assign Task
  // ============================================================
  app.post('/dev-team/tasks/:id/assign', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var taskId = parseInt(req.params.id);
    var assignTo = req.body.assigned_to ? parseInt(req.body.assigned_to) : null;

    return pool.query('SELECT * FROM dev_tasks WHERE id = $1 AND tenant_id = $2', [taskId, tid]).then(function(result) {
      var task = result.rows[0];
      if (!task) { return res.redirect('/dev-team/tasks'); }

      return pool.query(
        'UPDATE dev_tasks SET assigned_to = $1, assigned_by = $2, assigned_at = NOW(), updated_at = NOW() WHERE id = $3 AND tenant_id = $4',
        [assignTo, user.id, taskId, tid]
      ).then(function() {
        if (assignTo) {
          logActivity(tid, assignTo, taskId, 'note', 'Task "' + task.title + '" assigned by ' + (user.name || user.email || 'Admin'));
        } else {
          logActivity(tid, task.assigned_to, taskId, 'note', 'Task "' + task.title + '" unassigned');
        }
        res.redirect('/dev-team/tasks');
      });
    });
  }));

  // ============================================================
  // ROUTE 12: GET /dev-team/activity — Activity Log
  // ============================================================
  app.get('/dev-team/activity', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var memberFilter = req.query.member_id || '';
    var typeFilter = req.query.type || '';
    var dateFrom = req.query.date_from || '';
    var dateTo = req.query.date_to || '';
    var page = parseInt(req.query.page) || 1;
    var limit = 30;
    var offset = (page - 1) * limit;

    var where = ['al.tenant_id = $1'];
    var params = [tid];
    var pi = 2;

    if (memberFilter) { where.push('al.member_id = $' + (pi++)); params.push(memberFilter); }
    if (typeFilter) { where.push('al.activity_type = $' + (pi++)); params.push(typeFilter); }
    if (dateFrom) { where.push('al.created_at >= $' + (pi++)); params.push(dateFrom + 'T00:00:00'); }
    if (dateTo) { where.push('al.created_at <= $' + (pi++)); params.push(dateTo + 'T23:59:59'); }

    var countParams = params.slice(0, pi - 1);

    return Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM dev_activity_log al WHERE ' + where.join(' AND '), countParams),
      pool.query('SELECT al.*, m.name as member_name, t.title as task_title FROM dev_activity_log al LEFT JOIN dev_team_members m ON m.id = al.member_id LEFT JOIN dev_tasks t ON t.id = al.task_id WHERE ' + where.join(' AND ') + ' ORDER BY al.created_at DESC LIMIT $' + pi + ' OFFSET $' + (pi + 1), params.concat([limit, offset])),
      pool.query('SELECT id, name FROM dev_team_members WHERE tenant_id = $1 ORDER BY name', [tid]),
      pool.query('SELECT DISTINCT activity_type FROM dev_activity_log WHERE tenant_id = $1 ORDER BY activity_type', [tid])
    ]).then(function(results) {
      var totalCount = results[0].rows[0].cnt;
      var activities = results[1].rows;
      var members = results[2].rows;
      var activityTypes = results[3].rows.map(function(r) { return r.activity_type; });
      var totalPages = Math.ceil(totalCount / limit);

      var activityTypeIcon = { commit: '\u{1F500}', push: '\u{2B06}', task_created: '\u{2795}', task_completed: '\u{2705}', review: '\u{1F44D}', deployment: '\u{1F680}', meeting: '\u{1F4DE}', note: '\u{1F4DD}' };
      var activityTypeColor = { commit: '#059669', push: '#0369a1', task_created: '#6366f1', task_completed: '#166534', review: '#7c3aed', deployment: '#4d7c0f', meeting: '#ea580c', note: '#64748b' };
      var activityTypeLabel = { commit: 'Commit', push: 'Push', task_created: 'Task Created', task_completed: 'Task Done', review: 'Review', deployment: 'Deploy', meeting: 'Meeting', note: 'Note' };

      var timelineHtml = activities.map(function(a) {
        var icon = activityTypeIcon[a.activity_type] || '\u{1F4CB}';
        var color = activityTypeColor[a.activity_type] || COLORS.muted;
        var label = activityTypeLabel[a.activity_type] || a.activity_type;
        return '<div class="dtm-timeline-item" style="border-left-color:' + color + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<span>' + icon + '</span>' +
              (a.member_name ? '<a href="/dev-team/members/' + a.member_id + '" style="color:' + COLORS.primary + ';text-decoration:none;font-weight:600">' + esc(a.member_name) + '</a>' : '<span style="font-weight:600;color:' + COLORS.text + '">System</span>') +
              '<span class="dtm-activity-type" style="background:' + color + '15;color:' + color + '">' + label + '</span>' +
            '</div>' +
            '<span style="font-size:11px;color:' + COLORS.faint + '">' + fmtDateTime(a.created_at) + '</span>' +
          '</div>' +
          '<p style="font-size:13px;color:' + COLORS.muted + ';margin:0">' + esc(a.description) + '</p>' +
          '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">' +
            (a.task_title ? '<span style="font-size:12px;color:' + COLORS.primary + '">\u{1F4CB} ' + esc(a.task_title) + '</span>' : '') +
            (a.github_url ? '<a href="' + esc(a.github_url) + '" target="_blank" style="font-size:12px;color:' + COLORS.primary + '">View on GitHub \u{2197}</a>' : '') +
          '</div>' +
        '</div>';
      }).join('');

      var pageLinks = '';
      if (totalPages > 1) {
        var startP = Math.max(1, page - 2);
        var endP = Math.min(totalPages, page + 3);
        for (var i = startP; i <= endP; i++) {
          pageLinks += '<a href="/dev-team/activity?page=' + i + '&member_id=' + memberFilter + '&type=' + typeFilter + '&date_from=' + dateFrom + '&date_to=' + dateTo + '" class="dtm-btn ' + (page === i ? 'dtm-btn-primary' : 'dtm-btn-secondary') + '" style="padding:4px 10px;font-size:12px">' + i + '</a>';
        }
      }

      var typeFilterHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
        '<a href="/dev-team/activity" class="dtm-chip ' + (!typeFilter ? 'active' : '') + '">All</a>' +
        activityTypes.map(function(ty) {
          var icon = activityTypeIcon[ty] || '';
          var label = activityTypeLabel[ty] || ty;
          return '<a href="/dev-team/activity?type=' + ty + (memberFilter ? '&member_id=' + memberFilter : '') + '" class="dtm-chip ' + (typeFilter === ty ? 'active' : '') + '">' + icon + ' ' + label + '</a>';
        }).join('') +
      '</div>';

      var html = DTM_CSS + '<div style="max-width:1000px;margin:0 auto">' +
        nav('activity') +
        '<div class="dtm-page-header"><div><h1>\u{1F4C5} Activity Log</h1><p>' + totalCount + ' activit' + (totalCount !== 1 ? 'ies' : 'y') + ' recorded</p></div></div>' +
        typeFilterHtml +
        '<form method="GET" action="/dev-team/activity" class="dtm-filter">' +
          '<div><label>Member</label><select name="member_id"><option value="">All Members</option>' +
            members.map(function(m) { return '<option value="' + m.id + '"' + (memberFilter === String(m.id) ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
          '</select></div>' +
          '<div><label>From Date</label><input type="date" name="date_from" value="' + esc(dateFrom) + '"></div>' +
          '<div><label>To Date</label><input type="date" name="date_to" value="' + esc(dateTo) + '"></div>' +
          '<div><label>&nbsp;</label><button type="submit" class="dtm-btn dtm-btn-primary">Filter</button></div>' +
          (memberFilter || dateFrom || dateTo ? '<div><label>&nbsp;</label><a href="/dev-team/activity" class="dtm-btn dtm-btn-secondary">Clear</a></div>' : '') +
        '</form>' +
        '<div class="dtm-timeline" style="margin-top:20px">' +
          (timelineHtml || '<div class="dtm-empty"><div class="dtm-empty-icon">\u{1F4C5}</div><p>No activity found</p></div>') +
        '</div>' +
        (totalPages > 1 ? '<div class="dtm-pagination"><div class="dtm-pagination-info">Page ' + page + ' of ' + totalPages + '</div><div class="dtm-pagination-btns">' + pageLinks + '</div></div>' : '') +
      '</div>';

      res.send(renderPage('Activity Log', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 13: GET /dev-team/sprints — Sprint Management
  // ============================================================
  app.get('/dev-team/sprints', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;

    return Promise.all([
      pool.query('SELECT s.* FROM dev_sprints s WHERE s.tenant_id = $1 ORDER BY s.start_date DESC', [tid]),
      pool.query('SELECT status, COUNT(*)::int as cnt FROM dev_sprints WHERE tenant_id = $1 GROUP BY status', [tid])
    ]).then(function(results) {
      var sprints = results[0].rows;
      var sprintCounts = results[1].rows;

      var totalSprints = sprints.length;
      var activeSprints = sprints.filter(function(s) { return s.status === 'active'; }).length;
      var completedSprints = sprints.filter(function(s) { return s.status === 'completed'; }).length;
      var totalPlannedTasks = sprints.reduce(function(sum, s) { return sum + (s.total_tasks || 0); }, 0);
      var totalDoneTasks = sprints.reduce(function(sum, s) { return sum + (s.completed_tasks || 0); }, 0);

      var sprintCards = sprints.map(function(s) {
        var sp = pct(s.completed_tasks, s.total_tasks);
        var isCurrent = s.status === 'active';
        var borderColor = isCurrent ? COLORS.primary : COLORS.border;
        var bgColor = isCurrent ? COLORS.lighter : COLORS.white;

        var statusSummary = '';
        if (s.total_tasks > 0) {
          var remaining = s.total_tasks - s.completed_tasks;
          statusSummary = '<div style="display:flex;justify-content:space-between;font-size:12px;color:' + COLORS.faint + ';margin-top:8px">' +
            '<span>\u{2705} ' + s.completed_tasks + ' done</span>' +
            '<span>\u{1F527} ' + remaining + ' remaining</span>' +
            '<span>\u{1F4C4} ' + s.total_tasks + ' total</span>' +
          '</div>';
        }

        var daysLeft = '';
        if (s.status === 'active' && s.end_date) {
          var end = new Date(s.end_date);
          var now = new Date();
          var diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
          if (diff >= 0) {
            daysLeft = '<div style="font-size:12px;color:' + (diff <= 3 ? '#dc2626' : COLORS.faint) + ';margin-top:4px">\u{23F0} ' + diff + ' day' + (diff !== 1 ? 's' : '') + ' remaining</div>';
          } else {
            daysLeft = '<div style="font-size:12px;color:#dc2626;margin-top:4px">\u{26A0} Overdue by ' + Math.abs(diff) + ' day' + (Math.abs(diff) !== 1 ? 's' : '') + '</div>';
          }
        }

        return '<div class="dtm-sprint-card" style="border:2px solid ' + borderColor + ';background:' + bgColor + '">' +
          '<div class="dtm-sprint-header">' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:' + COLORS.text + '">' + esc(s.name) + '</div>' +
              (isCurrent ? '<span style="font-size:11px;color:' + COLORS.primary + ';font-weight:700">\u{1F7E2} CURRENT SPRINT</span>' : '') +
            '</div>' +
            sprintStatusBadge(s.status) +
          '</div>' +
          '<div style="font-size:13px;color:' + COLORS.faint + ';margin-bottom:8px">' +
            '\u{1F4C5} ' + fmtDate(s.start_date) + ' \u{2192} ' + fmtDate(s.end_date) +
          '</div>' +
          (s.goal ? '<p style="font-size:13px;color:' + COLORS.muted + ';margin-bottom:10px;padding:8px 12px;background:rgba(255,255,255,.7);border-radius:8px">\u{1F3AF} ' + esc(s.goal) + '</p>' : '') +
          progressBar(sp, 14) +
          statusSummary +
          daysLeft +
        '</div>';
      }).join('');

      var html = DTM_CSS + '<div style="max-width:1000px;margin:0 auto">' +
        nav('sprints') +
        '<div class="dtm-page-header"><div><h1>\u{1F3C1} Sprint Management</h1><p>Plan and track development sprints</p></div>' +
          '<a href="/dev-team/sprints/create" class="dtm-btn dtm-btn-primary">\u{2795} New Sprint</a>' +
        '</div>' +
        '<div class="dtm-stats">' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F3C1}</div><div class="dtm-stat-val">' + totalSprints + '</div><div class="dtm-stat-lbl">Total Sprints</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F7E2}</div><div class="dtm-stat-val">' + activeSprints + '</div><div class="dtm-stat-lbl">Active</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{2705}</div><div class="dtm-stat-val">' + completedSprints + '</div><div class="dtm-stat-lbl">Completed</div></div>' +
          '<div class="dtm-stat"><div class="dtm-stat-icon">\u{1F4CA}</div><div class="dtm-stat-val">' + pct(totalDoneTasks, totalPlannedTasks) + '%</div><div class="dtm-stat-lbl">Overall Completion</div></div>' +
        '</div>' +
        sprintCards +
      '</div>';

      res.send(renderPage('Sprint Management', html, user, req));
    });
  }));

  // ============================================================
  // ROUTE 14: POST /dev-team/sprints/create — Create Sprint
  // ============================================================
  app.post('/dev-team/sprints/create', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;
    var name = (req.body.name || '').trim();
    var description = (req.body.description || '').trim() || null;
    var startDate = req.body.start_date;
    var endDate = req.body.end_date;
    var goal = (req.body.goal || '').trim() || null;
    var sprintStatus = req.body.status || 'planning';

    var validStatuses = ['planning', 'active', 'review', 'completed'];

    if (!name || !startDate || !endDate) {
      return res.redirect('/dev-team/sprints');
    }

    if (validStatuses.indexOf(sprintStatus) === -1) { sprintStatus = 'planning'; }

    return Promise.all([
      pool.query(
        'INSERT INTO dev_sprints (tenant_id, name, description, start_date, end_date, goal, status, total_tasks, completed_tasks, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8) RETURNING id',
        [tid, name, description, startDate, endDate, goal, sprintStatus, user.id]
      ),
      pool.query(
        'SELECT COUNT(*)::int as total FROM dev_tasks WHERE tenant_id = $1 AND status NOT IN (\'completed\', \'cancelled\') AND due_date >= $2 AND due_date <= $3',
        [tid, startDate, endDate]
      )
    ]).then(function(results) {
      var sprintId = results[0].rows[0].id;
      var openTaskCount = results[1].rows[0].total;

      return pool.query('UPDATE dev_sprints SET total_tasks = $1, updated_at = NOW() WHERE id = $2', [openTaskCount, sprintId]);
    }).then(function() {
      logActivity(tid, null, null, 'note', 'Sprint "' + name + '" created (' + startDate + ' to ' + endDate + ')');
      res.redirect('/dev-team/sprints');
    });
  }));

  // ============================================================
  // ROUTE: GET /dev-team/sprints/create — Create Sprint Form
  // ============================================================
  app.get('/dev-team/sprints/create', requireAuth, ah(function(req, res) {
    var user = req.session.user;
    var tid = user.tenant_id;

    var formHtml = '<div class="dtm-card" style="padding:28px">' +
      '<h2 style="margin:0 0 4px;color:' + COLORS.text + '">\u{1F3C1} Create Sprint</h2>' +
      '<p style="font-size:13px;color:' + COLORS.faint + ';margin-bottom:24px">Plan a new development sprint with goals and timeline</p>' +
      '<form method="POST" action="/dev-team/sprints/create" style="display:flex;flex-direction:column;gap:18px">' +
        '<div class="dtm-form-group"><label>Sprint Name *</label><input type="text" name="name" required class="dtm-input" placeholder="Sprint 1 — June 2025"></div>' +
        '<div class="dtm-form-group"><label>Description</label><textarea name="description" rows="3" class="dtm-textarea" placeholder="Sprint objectives and focus areas..."></textarea></div>' +
        '<div class="dtm-grid-2">' +
          '<div class="dtm-form-group"><label>Start Date *</label><input type="date" name="start_date" required class="dtm-input" value="' + today() + '"></div>' +
          '<div class="dtm-form-group"><label>End Date *</label><input type="date" name="end_date" required class="dtm-input"></div>' +
        '</div>' +
        '<div class="dtm-form-group"><label>Sprint Goal</label><textarea name="goal" rows="2" class="dtm-textarea" placeholder="What should be achieved by the end of this sprint?"></textarea></div>' +
        '<div class="dtm-form-group"><label>Initial Status</label><select name="status" class="dtm-select">' +
          '<option value="planning">Planning</option>' +
          '<option value="active">Active</option>' +
        '</select></div>' +
        '<div style="display:flex;gap:10px;margin-top:8px">' +
          '<button type="submit" class="dtm-btn dtm-btn-primary" style="padding:12px 28px">\u{1F3C1} Create Sprint</button>' +
          '<a href="/dev-team/sprints" class="dtm-btn dtm-btn-secondary" style="padding:12px 28px">Cancel</a>' +
        '</div>' +
      '</form>' +
    '</div>';

    var html = DTM_CSS + '<div style="max-width:700px;margin:0 auto">' +
      nav('sprints') +
      '<a href="/dev-team/sprints" class="dtm-back">\u{2190} Back to Sprints</a>' +
      formHtml +
    '</div>';

    res.send(renderPage('Create Sprint', html, user, req));
  }));

  // ============================================================
  // SEED DATA (wrapped in try/catch, tenant_id=0 won't exist)
  // ============================================================
  (function() {
    pool.query('SELECT COUNT(*)::int as cnt FROM dev_team_members WHERE tenant_id = 0').then(function(r) {
      if (r.rows[0].cnt > 0) return;

      var seedMemberSql = 'INSERT INTO dev_team_members (tenant_id, name, email, phone, github_username, role, department, skills, bio, status, hourly_rate, max_hours_per_week, created_by, joined_date) VALUES ' +
        '($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';

      var seedMembers = [
        ['Mugisha Ivan', 'ivan@mugisha.dev', '+256 700 100 200', 'imugisha', 'lead', 'Engineering', '{Node.js,React,PostgreSQL,DevOps}', 'Full-stack lead developer with 8+ years experience', 'active', 50000, 40],
        ['Nakamya Grace', 'grace@nakamya.io', '+256 771 200 300', 'gnakamya', 'senior', 'Engineering', '{Python,Django,PostgreSQL,REST API}', 'Backend specialist focused on API design', 'active', 45000, 40],
        ['Okello James', 'james@okello.dev', '+256 782 300 400', 'jokello', 'developer', 'Frontend', '{React,Vue.js,TypeScript,Tailwind CSS}', 'Frontend developer with passion for UI/UX', 'busy', 35000, 40],
        ['Achieng Sarah', 'sarah@achieng.dev', '+256 703 400 500', 'sachieng', 'designer', 'Design', '{UI/UX,Figma,Adobe XD,HTML,CSS}', 'Creative designer specializing in modern interfaces', 'active', 30000, 35],
        ['Tumwesigye David', 'david@tumwesigye.dev', '+256 714 500 600', 'dtumwesigye', 'junior', 'Engineering', '{JavaScript,React,Node.js}', 'Junior developer eager to learn and contribute', 'available', 20000, 40]
      ];

      var chain = Promise.resolve();
      seedMembers.forEach(function(m) {
        chain = chain.then(function() {
          return pool.query(seedMemberSql, [0].concat(m, [null, today()])).catch(function() {});
        });
      });

      return chain;
    }).then(function() {
      console.log('[DevTeamManager] Seed data check complete');
    }).catch(function() {
      // tenant_id=0 won't exist — ignore
    });
  })();

  console.log('[DevTeamManager] Dev Team Manager module loaded with 14 routes');
};
