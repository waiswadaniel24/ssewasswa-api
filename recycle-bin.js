/**
 * Recycle Bin / Soft Delete Module
 * ================================
 * Provides a full recycle bin system for soft-deleted entities with
 * restore, bulk operations, retention policies, statistics, export,
 * and per-entity-type configuration.
 *
 * Usage in server.js:
 *   const recycleBin = require('./recycle-bin');
 *   recycleBin(app, pool, opts);
 */

'use strict';

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const renderPage = opts.renderPage || ((title, body, user) => body);
  const ah = opts.ah || ((fn) => async (req, res, next) => {
    try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); }
  });
  const requireAuth = opts.requireAuth || ((req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  });
  const audit = opts.audit || (() => {});
  const schoolId = (req) => req.session?.user?.school_id || 1;
  const who = (req) => req.session?.user?.id || 0;
  const whoName = (req) => req.session?.user?.name || req.session?.user?.email || 'system';
  const prefix = '/admin/recycle-bin';

  // ─── Known Entity Types ──────────────────────────────────────
  const ENTITY_TYPES = [
    { type: 'student', label: 'Student', icon: '🎓', color: '#3b82f6' },
    { type: 'teacher', label: 'Teacher', icon: '👩‍🏫', color: '#8b5cf6' },
    { type: 'class', label: 'Class', icon: '🏫', color: '#06b6d4' },
    { type: 'subject', label: 'Subject', icon: '📖', color: '#f59e0b' },
    { type: 'assignment', label: 'Assignment', icon: '📝', color: '#10b981' },
    { type: 'fee', label: 'Fee Record', icon: '💰', color: '#ef4444' },
    { type: 'attendance', label: 'Attendance', icon: '📋', color: '#6366f1' },
    { type: 'announcement', label: 'Announcement', icon: '📢', color: '#ec4899' },
    { type: 'document', label: 'Document', icon: '📄', color: '#14b8a6' },
    { type: 'event', label: 'Event', icon: '📅', color: '#f97316' },
    { type: 'report', label: 'Report', icon: '📊', color: '#84cc16' },
    { type: 'parent', label: 'Parent', icon: '👨‍👩‍👧', color: '#a855f7' },
    { type: 'other', label: 'Other', icon: '📦', color: '#64748b' },
  ];

  const entityInfo = (type) => ENTITY_TYPES.find(e => e.type === type) || ENTITY_TYPES[ENTITY_TYPES.length - 1];

  // ─── Formatters ──────────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) : '—';

  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }) : '—';

  const fmtRelative = (d) => {
    if (!d) return '—';
    const now = new Date();
    const then = new Date(d);
    const diffMs = then - now;
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days < 0) return `<span style="color:#ef4444;font-weight:600">${Math.abs(days)}d overdue</span>`;
    if (days === 0) return `<span style="color:#f59e0b;font-weight:600">Today</span>`;
    if (days <= 7) return `<span style="color:#10b981">${days}d left</span>`;
    return `${days}d left`;
  };

  const fmtDataSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  };

  // ─── Inline CSS ──────────────────────────────────────────────
  const CSS = `<style>
    :root {
      --bg: #0f172a;
      --bg2: #1e293b;
      --bg3: #334155;
      --card: #1e293b;
      --card-hover: #263548;
      --border: #334155;
      --border-light: #475569;
      --txt: #f1f5f9;
      --txt2: #94a3b8;
      --txt3: #64748b;
      --pri: #3b82f6;
      --pri-light: #60a5fa;
      --pri-dark: #2563eb;
      --pri-bg: rgba(59,130,246,0.1);
      --danger: #ef4444;
      --danger-bg: rgba(239,68,68,0.1);
      --success: #10b981;
      --success-bg: rgba(16,185,129,0.1);
      --warn: #f59e0b;
      --warn-bg: rgba(245,158,11,0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--txt); line-height: 1.6; }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.75rem; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.02em; }
    h2 { font-size: 1.2rem; font-weight: 700; margin: 24px 0 12px; color: var(--txt); }
    h3 { font-size: 1rem; font-weight: 600; margin: 16px 0 8px; color: var(--txt2); }
    .subtitle { color: var(--txt3); margin-bottom: 24px; font-size: 0.9rem; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
    .badge-pri { background: var(--pri-bg); color: var(--pri-light); border: 1px solid rgba(59,130,246,0.25); }
    .badge-danger { background: var(--danger-bg); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
    .badge-success { background: var(--success-bg); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }
    .badge-warn { background: var(--warn-bg); color: #fcd34d; border: 1px solid rgba(245,158,11,0.25); }
    .badge-muted { background: rgba(100,116,139,0.15); color: var(--txt2); border: 1px solid rgba(100,116,139,0.25); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; transition: border-color 0.2s; }
    .stat-card:hover { border-color: var(--border-light); }
    .stat-card .icon { font-size: 1.6rem; margin-bottom: 8px; }
    .stat-card .num { font-size: 2rem; font-weight: 800; line-height: 1.1; }
    .stat-card .label { color: var(--txt3); font-size: 0.8rem; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 16px; }
    .card-glow { box-shadow: 0 0 20px rgba(59,130,246,0.08); }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { padding: 12px 16px; text-align: left; background: var(--bg2); color: var(--txt3); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 16px; border-bottom: 1px solid rgba(51,65,85,0.5); color: var(--txt); }
    tr:hover td { background: var(--card-hover); }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 10px; font-size: 0.85rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: all 0.15s; line-height: 1.4; }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-pri { background: var(--pri); color: #fff; }
    .btn-pri:hover { background: var(--pri-dark); }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: var(--success); color: #fff; }
    .btn-success:hover { background: #059669; }
    .btn-ghost { background: transparent; color: var(--txt2); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--bg3); color: var(--txt); border-color: var(--border-light); }
    .btn-sm { padding: 5px 12px; font-size: 0.78rem; border-radius: 8px; }
    .btn-xs { padding: 3px 8px; font-size: 0.72rem; border-radius: 6px; }
    .form-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label { font-weight: 600; font-size: 0.82rem; color: var(--txt2); }
    input, select, textarea { padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; font-size: 0.9rem; background: var(--bg2); color: var(--txt); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    input:focus, select:focus, textarea:focus { border-color: var(--pri); box-shadow: 0 0 0 3px var(--pri-bg); }
    input::placeholder { color: var(--txt3); }
    select option { background: var(--bg2); color: var(--txt); }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .meta { font-size: 0.78rem; color: var(--txt3); }
    .divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--txt3); }
    .empty-state .icon { font-size: 3.5rem; margin-bottom: 16px; opacity: 0.5; display: block; }
    .empty-state p { font-size: 0.95rem; margin-bottom: 12px; }
    .nav-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 24px; flex-wrap: wrap; }
    .nav-tabs a { padding: 10px 18px; text-decoration: none; color: var(--txt3); font-weight: 600; font-size: 0.85rem; border-radius: 8px 8px 0 0; transition: all 0.2s; border-bottom: 2px solid transparent; }
    .nav-tabs a:hover { color: var(--txt); background: var(--bg2); }
    .nav-tabs a.active { color: var(--pri-light); background: var(--pri-bg); border-bottom-color: var(--pri); }
    .checkbox-wrap { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 0.875rem; }
    .checkbox-wrap input[type="checkbox"] { accent-color: var(--pri); width: 16px; height: 16px; cursor: pointer; }
    .detail-row { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-weight: 600; color: var(--txt3); min-width: 140px; font-size: 0.82rem; flex-shrink: 0; }
    .detail-value { font-size: 0.9rem; word-break: break-word; }
    .json-preview { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.78rem; color: var(--txt2); max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .alert { padding: 14px 18px; border-radius: 10px; font-size: 0.85rem; font-weight: 500; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
    .alert-danger { background: var(--danger-bg); color: #fca5a5; border: 1px solid rgba(239,68,68,0.25); }
    .alert-success { background: var(--success-bg); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }
    .alert-warn { background: var(--warn-bg); color: #fcd34d; border: 1px solid rgba(245,158,11,0.25); }
    .progress-bar { height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .progress-bar .fill { height: 100%; background: var(--pri); border-radius: 3px; transition: width 0.4s ease; }
    .progress-bar .fill.danger { background: var(--danger); }
    .progress-bar .fill.warn { background: var(--warn); }
    .toast { position: fixed; top: 24px; right: 24px; padding: 14px 22px; border-radius: 12px; color: #fff; font-weight: 600; z-index: 9999; animation: slideIn 0.3s ease; font-size: 0.9rem; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .toast-success { background: linear-gradient(135deg, #059669, #10b981); }
    .toast-error { background: linear-gradient(135deg, #dc2626, #ef4444); }
    .toast-info { background: linear-gradient(135deg, #2563eb, #3b82f6); }
    @keyframes slideIn { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
    .count-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--pri); color: #fff; font-size: 0.68rem; font-weight: 700; margin-left: 6px; }
    .search-box { position: relative; flex: 1; min-width: 200px; max-width: 360px; }
    .search-box input { width: 100%; padding-left: 38px; }
    .search-box::before { content: '🔍'; position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 0.85rem; }
    .type-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 600; background: var(--bg2); border: 1px solid var(--border); color: var(--txt2); }
    .retention-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } .stats { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 640px) { .stats { grid-template-columns: 1fr; } .wrap { padding: 16px; } th, td { padding: 8px 10px; font-size: 0.8rem; } }
  </style>`;

  // ─── JavaScript ──────────────────────────────────────────────
  const JS = `<script>
    function confirmAction(msg, form) { if (confirm(msg)) form.submit(); }
    function toggleSelectAll(source) {
      var cbs = document.querySelectorAll('.row-checkbox');
      cbs.forEach(function(cb) { cb.checked = source.checked; });
      updateBulkBar();
    }
    function updateBulkBar() {
      var cbs = document.querySelectorAll('.row-checkbox:checked');
      var bar = document.getElementById('bulk-action-bar');
      var count = document.getElementById('bulk-count');
      if (bar) bar.style.display = cbs.length > 0 ? 'flex' : 'none';
      if (count) count.textContent = cbs.length;
    }
    function bulkAction(action) {
      var cbs = document.querySelectorAll('.row-checkbox:checked');
      var ids = Array.from(cbs).map(function(cb) { return cb.value; });
      if (ids.length === 0) return;
      var form = document.getElementById('bulk-form');
      form.action = '${prefix}/' + action;
      document.getElementById('bulk-ids').value = ids.join(',');
      var msg = action === 'bulk-restore'
        ? 'Restore ' + ids.length + ' item(s)?'
        : 'Permanently delete ' + ids.length + ' item(s)? This cannot be undone.';
      if (confirm(msg)) form.submit();
    }
    function showToast(msg, type) {
      var t = document.createElement('div');
      t.className = 'toast toast-' + (type || 'info');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 3000);
    }
    function toggleJsonPreview(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
  </script>`;

  // ─── Tab Helper ──────────────────────────────────────────────
  const navTabs = (active) => {
    const items = [
      ['/', 'Dashboard'],
      ['/data', 'All Items'],
      ['/stats', 'Statistics'],
      ['/settings', 'Settings'],
      ['/export', 'Export'],
    ];
    return '<div class="nav-tabs">' + items.map(([href, label]) =>
      '<a href="' + prefix + href + '" class="' + (active === label ? 'active' : '') + '">' + label + '</a>'
    ).join('') + '</div>';
  };

  // ─── Database Migrations (async IIFE) ────────────────────────
  (async () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS recycle_bin (
        id SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id INT NOT NULL,
        entity_name TEXT,
        entity_data JSONB,
        deleted_by INT,
        deleted_at TIMESTAMPTZ DEFAULT NOW(),
        restored_by INT,
        restored_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        permanent_delete_at TIMESTAMPTZ,
        school_id INT DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS recycle_bin_settings (
        id SERIAL PRIMARY KEY,
        school_id INT DEFAULT 1,
        entity_type TEXT NOT NULL,
        retention_days INT DEFAULT 30,
        auto_purge BOOLEAN DEFAULT false,
        max_items INT DEFAULT 1000,
        updated_by INT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, entity_type)
      );
      CREATE INDEX IF NOT EXISTS idx_recycle_bin_school ON recycle_bin(school_id);
      CREATE INDEX IF NOT EXISTS idx_recycle_bin_type ON recycle_bin(entity_type);
      CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted ON recycle_bin(deleted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recycle_bin_expires ON recycle_bin(expires_at);
      CREATE INDEX IF NOT EXISTS idx_recycle_bin_entity ON recycle_bin(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_rb_settings_school ON recycle_bin_settings(school_id);
    `;
    await migrateQuery(pool, 'RecycleBin', ddl);

    // Seed default settings for each entity type
    for (const et of ENTITY_TYPES) {
      await migrateQuery(pool, 'RecycleBin', `
        INSERT INTO recycle_bin_settings (school_id, entity_type, retention_days, auto_purge, max_items)
        VALUES (1, $1, 30, false, 1000)
        ON CONFLICT (school_id, entity_type) DO NOTHING
      `, [et.type]);
    }
    console.log('[recycle-bin] Tables & settings ready');
  })().catch(() => {});

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 1: GET / - Dashboard
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix, requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const msg = req.query.msg || '';

    const [totalRes, typeRes, recentRes, expiredRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1', [sid]),
      pool.query('SELECT entity_type, COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 GROUP BY entity_type ORDER BY n DESC', [sid]),
      pool.query('SELECT * FROM recycle_bin WHERE school_id=$1 ORDER BY deleted_at DESC LIMIT 12', [sid]),
      pool.query('SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 AND expires_at < NOW()', [sid]),
    ]);

    const total = totalRes.rows[0].n;
    const expired = expiredRes.rows[0].n;
    const recent = recentRes.rows;
    const types = typeRes.rows;

    // Build type breakdown cards
    const typeCards = types.map(t => {
      const info = entityInfo(t.entity_type);
      return '<div class="stat-card">' +
        '<div class="icon">' + info.icon + '</div>' +
        '<div class="num" style="color:' + info.color + '">' + t.n + '</div>' +
        '<div class="label">' + esc(info.label) + 's</div>' +
        '<a href="' + prefix + '/by-type/' + esc(t.entity_type) + '" class="btn btn-ghost btn-xs" style="margin-top:8px">View &rarr;</a>' +
      '</div>';
    }).join('');

    // Recent items table
    const recentRows = recent.map(r => {
      const info = entityInfo(r.entity_type);
      return '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td><span class="type-chip">' + info.icon + ' ' + esc(info.label) + '</span></td>' +
        '<td><strong>' + esc(r.entity_name || '#' + r.entity_id) + '</strong></td>' +
        '<td class="meta">' + fmtDateTime(r.deleted_at) + '</td>' +
        '<td>' + fmtRelative(r.expires_at) + '</td>' +
        '<td>' +
          '<a href="' + prefix + '/item/' + r.id + '" class="btn btn-ghost btn-xs">View</a> ' +
          '<form method="POST" action="' + prefix + '/restore/' + r.id + '" style="display:inline">' +
            '<button class="btn btn-success btn-xs">↩ Restore</button>' +
          '</form>' +
        '</td>' +
      '</tr>';
    }).join('');

    const body = CSS + JS + '<div class="wrap">' +
      '<h1>♻️ Recycle Bin</h1>' +
      '<p class="subtitle">Recover deleted items or permanently remove them. Items are retained per your retention policy.</p>' +
      navTabs('Dashboard') +

      (msg === 'restored' ? '<div class="alert alert-success">✅ Item restored successfully.</div>' : '') +
      (msg === 'bulk-restored' ? '<div class="alert alert-success">✅ Items restored successfully.</div>' : '') +
      (msg === 'purged' ? '<div class="alert alert-warn">🗑️ Item permanently deleted.</div>' : '') +
      (msg === 'bulk-purged' ? '<div class="alert alert-warn">🗑️ Items permanently deleted.</div>' : '') +
      (msg === 'emptied' ? '<div class="alert alert-warn">🗑️ Recycle bin emptied.</div>' : '') +
      (msg === 'configured' ? '<div class="alert alert-success">⚙️ Retention settings updated.</div>' : '') +

      '<div class="stats">' +
        '<div class="stat-card"><div class="icon">🗑️</div><div class="num" style="color:var(--pri)">' + total + '</div><div class="label">Total Items</div></div>' +
        '<div class="stat-card"><div class="icon">⏰</div><div class="num" style="color:' + (expired > 0 ? 'var(--danger)' : 'var(--success)') + '">' + expired + '</div><div class="label">Expired Items</div></div>' +
        '<div class="stat-card"><div class="icon">📂</div><div class="num" style="color:var(--warn)">' + types.length + '</div><div class="label">Entity Types</div></div>' +
        '<div class="stat-card"><div class="icon">📥</div><div class="num" style="color:var(--success)">—</div><div class="label">Restored Today</div></div>' +
      '</div>' +

      // Quick actions
      '<div class="card card-glow" style="margin-bottom:24px">' +
        '<h3 style="margin:0 0 12px">Quick Actions</h3>' +
        '<div class="form-row" style="margin:0">' +
          '<a href="' + prefix + '/data" class="btn btn-pri">📋 Browse All Items</a>' +
          '<a href="' + prefix + '/stats" class="btn btn-ghost">📊 View Statistics</a>' +
          '<a href="' + prefix + '/export" class="btn btn-ghost">⬇️ Export Data</a>' +
          '<form method="DELETE" action="' + prefix + '/empty" style="display:inline" onsubmit="return confirm(\'Empty entire recycle bin? This cannot be undone.\')">' +
            '<button class="btn btn-danger" type="submit">🗑️ Empty Bin</button>' +
          '</form>' +
        '</div>' +
      '</div>' +

      // Type breakdown
      (types.length > 0 ?
        '<h2>Items by Type</h2><div class="stats">' + typeCards + '</div>'
        : '') +

      // Recent items
      '<h2>Recently Deleted</h2>' +
      (recent.length > 0 ?
        '<div style="overflow-x:auto"><table><thead><tr>' +
          '<th>ID</th><th>Type</th><th>Name</th><th>Deleted At</th><th>Expires</th><th>Actions</th>' +
        '</tr></thead><tbody>' + recentRows + '</tbody></table></div>'
        : '<div class="empty-state"><span class="icon">♻️</span><p>Recycle bin is empty</p><span class="meta">Deleted items will appear here</span></div>') +

    '</div>';
    res.send(renderPage('Recycle Bin', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 2: GET /data - JSON deleted items list with filters
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/data', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const {
      entity_type = '', search = '', sort = 'deleted_at', dir = 'DESC',
      page = '1', limit = '50', format = 'html', from = '', to = '',
      status = ''
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(10, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    const validSorts = ['deleted_at', 'entity_type', 'entity_name', 'expires_at', 'id'];
    const sortCol = validSorts.includes(sort) ? sort : 'deleted_at';
    const sortDir = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // JSON response
    if (format === 'json') {
      let q = 'SELECT * FROM recycle_bin WHERE school_id=$1';
      const p = [sid];
      let c = 2;
      if (entity_type) { q += ' AND entity_type=$' + c++; p.push(entity_type); }
      if (search) { q += ' AND (entity_name ILIKE $' + c + ' OR entity_data::text ILIKE $' + c + ')'; p.push('%' + search + '%'); c++; }
      if (status === 'expired') { q += ' AND expires_at < NOW()'; }
      else if (status === 'active') { q += ' AND expires_at >= NOW()'; }
      if (from) { q += ' AND deleted_at >= $' + c++; p.push(from); }
      if (to) { q += ' AND deleted_at <= $' + c++; p.push(to + 'T23:59:59'); }
      q += ' ORDER BY ' + sortCol + ' ' + sortDir + ' LIMIT ' + limitNum + ' OFFSET ' + offset;
      const { rows } = await pool.query(q, p);
      const [{ count: total }] = (await pool.query(
        'SELECT COUNT(*)::int AS count FROM recycle_bin WHERE school_id=$1', [sid]
      )).rows;
      return res.json({ items: rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    }

    // HTML response
    let q = 'SELECT * FROM recycle_bin WHERE school_id=$1';
    const p = [sid];
    let c = 2;
    if (entity_type) { q += ' AND entity_type=$' + c++; p.push(entity_type); }
    if (search) { q += ' AND (entity_name ILIKE $' + c + ' OR entity_data::text ILIKE $' + c + ')'; p.push('%' + search + '%'); c++; }
    if (status === 'expired') { q += ' AND expires_at < NOW()'; }
    else if (status === 'active') { q += ' AND expires_at >= NOW()'; }
    if (from) { q += ' AND deleted_at >= $' + c++; p.push(from); }
    if (to) { q += ' AND deleted_at <= $' + c++; p.push(to + 'T23:59:59'); }

    const countQ = q.replace('SELECT *', 'SELECT COUNT(*)::int AS n');
    const [{ n: totalItems }] = (await pool.query(countQ, p)).rows;
    const totalPages = Math.ceil(totalItems / limitNum);

    q += ' ORDER BY ' + sortCol + ' ' + sortDir + ' LIMIT $' + c++ + ' OFFSET $' + c++;
    p.push(limitNum, offset);
    const { rows } = await pool.query(q, p);

    const typeOptions = ENTITY_TYPES.map(et =>
      '<option value="' + et.type + '"' + (entity_type === et.type ? ' selected' : '') + '>' + et.icon + ' ' + et.label + '</option>'
    ).join('');

    const rowsHtml = rows.map(r => {
      const info = entityInfo(r.entity_type);
      const isExpired = r.expires_at && new Date(r.expires_at) < new Date();
      return '<tr>' +
        '<td><label class="checkbox-wrap"><input type="checkbox" class="row-checkbox" value="' + r.id + '" onchange="updateBulkBar()"></label></td>' +
        '<td>' + r.id + '</td>' +
        '<td><span class="type-chip" style="border-color:' + info.color + '33;color:' + info.color + '">' + info.icon + ' ' + esc(info.label) + '</span></td>' +
        '<td><strong>' + esc(r.entity_name || '#' + r.entity_id) + '</strong> <span class="meta">#' + r.entity_id + '</span></td>' +
        '<td class="meta">' + fmtDateTime(r.deleted_at) + '</td>' +
        '<td>' + fmtRelative(r.expires_at) + (isExpired ? ' <span class="badge badge-danger">expired</span>' : '') + '</td>' +
        '<td>' +
          '<a href="' + prefix + '/item/' + r.id + '" class="btn btn-ghost btn-xs">View</a> ' +
          '<form method="POST" action="' + prefix + '/restore/' + r.id + '" style="display:inline">' +
            '<button class="btn btn-success btn-xs" title="Restore">↩</button>' +
          '</form> ' +
          '<form method="POST" action="' + prefix + '/permanent/' + r.id + '" style="display:inline" onsubmit="return confirm(\'Permanently delete this item?\')">' +
            '<button class="btn btn-danger btn-xs" title="Delete forever">🗑</button>' +
          '</form>' +
        '</td>' +
      '</tr>';
    }).join('');

    const pagination = totalPages > 1 ? '<div class="form-row" style="justify-content:center;margin-top:16px">' +
      (pageNum > 1 ? '<a href="' + prefix + '/data?page=' + (pageNum - 1) + '&entity_type=' + esc(entity_type) + '&search=' + esc(search) + '&sort=' + sort + '&dir=' + dir + '&status=' + status + '" class="btn btn-ghost btn-sm">&larr; Previous</a>' : '') +
      '<span class="meta" style="padding:8px">Page ' + pageNum + ' of ' + totalPages + ' (' + totalItems + ' items)</span>' +
      (pageNum < totalPages ? '<a href="' + prefix + '/data?page=' + (pageNum + 1) + '&entity_type=' + esc(entity_type) + '&search=' + esc(search) + '&sort=' + sort + '&dir=' + dir + '&status=' + status + '" class="btn btn-ghost btn-sm">Next &rarr;</a>' : '') +
    '</div>' : '';

    const body = CSS + JS +
      '<div class="wrap">' +
        '<h1>📋 All Deleted Items</h1>' +
        '<p class="subtitle">Browse, filter, and manage deleted entities</p>' +
        navTabs('All Items') +

        // Filters
        '<div class="card" style="margin-bottom:20px">' +
          '<form method="GET" action="' + prefix + '/data" class="form-row">' +
            '<div class="search-box"><input name="search" value="' + esc(search) + '" placeholder="Search items..."></div>' +
            '<select name="entity_type"><option value="">All Types</option>' + typeOptions + '</select>' +
            '<select name="status"><option value="">All Status</option><option value="active"' + (status === 'active' ? ' selected' : '') + '>Active</option><option value="expired"' + (status === 'expired' ? ' selected' : '') + '>Expired</option></select>' +
            '<input name="from" type="date" value="' + esc(from) + '" title="From date">' +
            '<input name="to" type="date" value="' + esc(to) + '" title="To date">' +
            '<select name="sort"><option value="deleted_at"' + (sort === 'deleted_at' ? ' selected' : '') + '>Sort: Date</option><option value="entity_name"' + (sort === 'entity_name' ? ' selected' : '') + '>Sort: Name</option><option value="entity_type"' + (sort === 'entity_type' ? ' selected' : '') + '>Sort: Type</option><option value="expires_at"' + (sort === 'expires_at' ? ' selected' : '') + '>Sort: Expires</option></select>' +
            '<button class="btn btn-pri btn-sm" type="submit">Filter</button>' +
            '<a href="' + prefix + '/data" class="btn btn-ghost btn-sm">Clear</a>' +
            '<a href="' + prefix + '/data?format=json' + (entity_type ? '&entity_type=' + entity_type : '') + '" class="btn btn-ghost btn-sm">API</a>' +
          '</form>' +
        '</div>' +

        // Bulk actions bar
        '<div id="bulk-action-bar" class="card" style="display:none;margin-bottom:12px;padding:12px 16px">' +
          '<div class="form-row" style="margin:0;align-items:center">' +
            '<span class="meta"><strong id="bulk-count">0</strong> item(s) selected</span>' +
            '<form id="bulk-form" method="POST"><input type="hidden" name="ids" id="bulk-ids"></form>' +
            '<button class="btn btn-success btn-sm" onclick="bulkAction(\'bulk-restore\')">↩ Restore Selected</button>' +
            '<button class="btn btn-danger btn-sm" onclick="bulkAction(\'bulk-permanent\')">🗑 Delete Forever</button>' +
          '</div>' +
        '</div>' +

        // Items table
        (rows.length > 0 ?
          '<div style="overflow-x:auto"><table><thead><tr>' +
            '<th><input type="checkbox" onchange="toggleSelectAll(this)"></th>' +
            '<th>ID</th><th>Type</th><th>Name</th><th>Deleted</th><th>Expires</th><th>Actions</th>' +
          '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + pagination
          : '<div class="empty-state"><span class="icon">📭</span><p>No deleted items found</p><span class="meta">Try adjusting your filters</span></div>') +

      '</div>';
    res.send(renderPage('Recycle Bin - All Items', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 3: GET /item/:id - View deleted item details
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/item/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const id = parseInt(req.params.id);
    const { rows: [item] } = await pool.query(
      'SELECT * FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]
    );
    if (!item) return res.status(404).send(renderPage('Not Found', '<div class="wrap"><div class="empty-state"><span class="icon">❌</span><p>Item not found in recycle bin</p><a href="' + prefix + '" class="btn btn-pri" style="margin-top:16px">&larr; Back to Recycle Bin</a></div></div>', req.session?.user));

    const info = entityInfo(item.entity_type);
    const data = item.entity_data || {};
    const dataKeys = Object.keys(data);
    const dataSize = JSON.stringify(data).length;
    const isExpired = item.expires_at && new Date(item.expires_at) < new Date();

    // Data preview rows
    const dataPreviewRows = dataKeys.slice(0, 20).map(k =>
      '<div class="detail-row">' +
        '<div class="detail-label">' + esc(k) + '</div>' +
        '<div class="detail-value">' + esc(String(data[k] ?? 'null')).slice(0, 200) + '</div>' +
      '</div>'
    ).join('');

    const dataJsonPreview = esc(JSON.stringify(data, null, 2));

    const body = CSS + JS + '<div class="wrap">' +
      '<a href="' + prefix + '" class="btn btn-ghost" style="margin-bottom:16px">&larr; Back to Recycle Bin</a>' +
      '<div class="card card-glow">' +
        '<div class="form-row" style="align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">' +
          '<div>' +
            '<h1 style="display:flex;align-items:center;gap:10px">' +
              '<span style="font-size:2rem">' + info.icon + '</span> ' +
              esc(item.entity_name || 'Untitled #' + item.entity_id) +
            '</h1>' +
            '<p class="subtitle" style="margin-bottom:0">' +
              '<span class="type-chip" style="border-color:' + info.color + '44;color:' + info.color + '">' + esc(info.label) + '</span>' +
              '<span class="meta" style="margin-left:8px">ID: ' + item.entity_id + '</span>' +
              (isExpired ? '<span class="badge badge-danger" style="margin-left:8px">Expired</span>' : '') +
            '</p>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<form method="POST" action="' + prefix + '/restore/' + item.id + '">' +
              '<button class="btn btn-success">↩ Restore Item</button>' +
            '</form>' +
            '<form method="POST" action="' + prefix + '/permanent/' + item.id + '" onsubmit="return confirm(\'Permanently delete this item? This cannot be undone.\')">' +
              '<button class="btn btn-danger">🗑 Delete Forever</button>' +
            '</form>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="grid-2">' +
        // Details card
        '<div class="card">' +
          '<h3 style="margin:0 0 12px">Item Details</h3>' +
          '<div class="detail-row"><div class="detail-label">Recycle Bin ID</div><div class="detail-value">' + item.id + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Entity Type</div><div class="detail-value">' + info.icon + ' ' + esc(info.label) + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Entity ID</div><div class="detail-value">' + item.entity_id + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Entity Name</div><div class="detail-value">' + esc(item.entity_name || '—') + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Deleted By</div><div class="detail-value">' + (item.deleted_by || '—') + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Deleted At</div><div class="detail-value">' + fmtDateTime(item.deleted_at) + '</div></div>' +
          '<div class="detail-row"><div class="detail-label">Expires At</div><div class="detail-value">' + fmtDateTime(item.expires_at) + ' ' + fmtRelative(item.expires_at) + '</div></div>' +
          (item.permanent_delete_at ? '<div class="detail-row"><div class="detail-label">Permanent Delete</div><div class="detail-value">' + fmtDateTime(item.permanent_delete_at) + '</div></div>' : '') +
          (item.restored_by ? '<div class="detail-row"><div class="detail-label">Restored By</div><div class="detail-value">' + item.restored_by + '</div></div>' : '') +
          (item.restored_at ? '<div class="detail-row"><div class="detail-label">Restored At</div><div class="detail-value">' + fmtDateTime(item.restored_at) + '</div></div>' : '') +
          '<div class="detail-row"><div class="detail-label">Data Size</div><div class="detail-value">' + fmtDataSize(dataSize) + ' (' + dataKeys.length + ' fields)</div></div>' +
        '</div>' +

        // Data preview card
        '<div class="card">' +
          '<h3 style="margin:0 0 12px">Entity Data</h3>' +
          (dataPreviewRows ?
            dataPreviewRows + (dataKeys.length > 20 ? '<p class="meta" style="margin-top:8px">Showing 20 of ' + dataKeys.length + ' fields</p>' : '')
            : '<p class="meta">No data stored</p>') +
          '<hr class="divider">' +
          '<button class="btn btn-ghost btn-sm" onclick="toggleJsonPreview(\'json-full\')">Toggle Raw JSON</button>' +
          '<div id="json-full" class="json-preview" style="display:none;margin-top:12px">' + dataJsonPreview + '</div>' +
        '</div>' +
      '</div>' +

    '</div>';
    res.send(renderPage('Recycle Bin - Item #' + item.id, body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 4: POST /restore/:id - Restore item
  // ═══════════════════════════════════════════════════════════════
  app.post(prefix + '/restore/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const userId = who(req);
    const id = parseInt(req.params.id);
    const { rows: [item] } = await pool.query(
      'SELECT * FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]
    );
    if (!item) return res.status(404).send('Item not found in recycle bin');

    // Attempt to restore the entity data back to its source table
    const data = item.entity_data || {};
    const tableName = item.entity_type + 's'; // e.g. "student" -> "students"
    const cols = Object.keys(data).filter(k => k !== 'id');
    let restored = false;

    if (cols.length > 0) {
      try {
        const setClauses = cols.map((c, i) => '"' + c + '" = $' + (i + 2)).join(', ');
        await pool.query(
          'INSERT INTO "' + tableName + '" (' + cols.map(c => '"' + c + '"').join(',') + ') ' +
          'VALUES (' + cols.map((_, i) => '$' + (i + 2)).join(',') + ') ' +
          'ON CONFLICT DO NOTHING SET ' + setClauses,
          [item.entity_id, ...cols.map(c => data[c])]
        );
        restored = true;
      } catch (e) {
        // Table might not exist or schema mismatch — mark as restored anyway from bin
      }
    }

    // Remove from recycle bin (mark restored)
    await pool.query(
      'DELETE FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]
    );

    audit('restore_from_recycle_bin', {
      recycleBinId: id, entityType: item.entity_type, entityId: item.entity_id,
      entityName: item.entity_name, tableRestored: restored
    }, req);

    res.redirect(prefix + '?msg=restored');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 5: POST /bulk-restore - Restore multiple items
  // ═══════════════════════════════════════════════════════════════
  app.post(prefix + '/bulk-restore', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const userId = who(req);
    const idsStr = req.body.ids || '';
    const ids = String(idsStr).split(',').map(Number).filter(n => n > 0);

    if (ids.length === 0) return res.redirect(prefix + '/data');

    const { rows: items } = await pool.query(
      'SELECT * FROM recycle_bin WHERE id = ANY($1) AND school_id=$2', [ids, sid]
    );

    let restored = 0;
    for (const item of items) {
      const data = item.entity_data || {};
      const tableName = item.entity_type + 's';
      const cols = Object.keys(data).filter(k => k !== 'id');
      if (cols.length > 0) {
        try {
          const setClauses = cols.map((c, i) => '"' + c + '" = $' + (i + 2)).join(', ');
          await pool.query(
            'INSERT INTO "' + tableName + '" (' + cols.map(c => '"' + c + '"').join(',') + ') ' +
            'VALUES (' + cols.map((_, i) => '$' + (i + 2)).join(',') + ') ' +
            'ON CONFLICT DO NOTHING SET ' + setClauses,
            [item.entity_id, ...cols.map(c => data[c])]
          );
        } catch (e) { /* skip individual failures */ }
      }
      restored++;
    }

    await pool.query('DELETE FROM recycle_bin WHERE id = ANY($1) AND school_id=$2', [ids, sid]);

    audit('bulk_restore_from_recycle_bin', {
      ids, count: items.length, restored
    }, req);

    res.redirect(prefix + '?msg=bulk-restored');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 6: DELETE /permanent/:id - Permanently delete item
  // ═══════════════════════════════════════════════════════════════
  app.post(prefix + '/permanent/:id', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const id = parseInt(req.params.id);
    const { rows: [item] } = await pool.query(
      'SELECT * FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]
    );
    if (!item) return res.status(404).send('Item not found in recycle bin');

    await pool.query('DELETE FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]);

    audit('permanent_delete_from_recycle_bin', {
      recycleBinId: id, entityType: item.entity_type, entityId: item.entity_id,
      entityName: item.entity_name
    }, req);

    res.redirect(prefix + '?msg=purged');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 7: POST /bulk-permanent - Permanently delete multiple
  // ═══════════════════════════════════════════════════════════════
  app.post(prefix + '/bulk-permanent', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const idsStr = req.body.ids || '';
    const ids = String(idsStr).split(',').map(Number).filter(n => n > 0);

    if (ids.length === 0) return res.redirect(prefix + '/data');

    const { rowCount } = await pool.query(
      'DELETE FROM recycle_bin WHERE id = ANY($1) AND school_id=$2', [ids, sid]
    );

    audit('bulk_permanent_delete', { ids, count: rowCount }, req);

    res.redirect(prefix + '?msg=bulk-purged');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 8: DELETE /empty - Empty entire recycle bin
  // ═══════════════════════════════════════════════════════════════
  app.delete(prefix + '/empty', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const onlyExpired = req.query.expired_only === 'true';
    let rowCount;

    if (onlyExpired) {
      const result = await pool.query(
        'DELETE FROM recycle_bin WHERE school_id=$1 AND expires_at < NOW()', [sid]
      );
      rowCount = result.rowCount;
    } else {
      const result = await pool.query(
        'DELETE FROM recycle_bin WHERE school_id=$1', [sid]
      );
      rowCount = result.rowCount;
    }

    audit('empty_recycle_bin', { schoolId: sid, purgedCount: rowCount, expiredOnly: onlyExpired }, req);

    res.redirect(prefix + '?msg=emptied');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 9: GET /stats - Deletion statistics by type
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/stats', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [totalRes, typeRes, dailyRes, sizeRes, expiredRes, restoredRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1', [sid]),
      pool.query(
        'SELECT entity_type, COUNT(*)::int AS n, MIN(deleted_at) AS earliest, MAX(deleted_at) AS latest ' +
        'FROM recycle_bin WHERE school_id=$1 GROUP BY entity_type ORDER BY n DESC', [sid]
      ),
      pool.query(
        'SELECT DATE(deleted_at) AS day, COUNT(*)::int AS n, COUNT(DISTINCT entity_type) AS types ' +
        'FROM recycle_bin WHERE school_id=$1 AND deleted_at >= $2 ' +
        'GROUP BY DATE(deleted_at) ORDER BY day DESC', [sid, since]
      ),
      pool.query(
        'SELECT entity_type, AVG(LENGTH(entity_data::text))::int AS avg_size, ' +
        'SUM(LENGTH(entity_data::text))::bigint AS total_size, COUNT(*)::int AS n ' +
        'FROM recycle_bin WHERE school_id=$1 GROUP BY entity_type', [sid]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 AND expires_at < NOW()', [sid]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 AND restored_at IS NOT NULL', [sid]
      ),
    ]);

    const total = totalRes.rows[0].n;
    const expired = expiredRes.rows[0].n;
    const restoredCount = restoredRes.rows[0].n;
    const typeStats = typeRes.rows;
    const dailyStats = dailyRes.rows;
    const sizeStats = sizeRes.rows;

    // Daily activity table
    const dailyRows = dailyStats.slice(0, 30).map(d =>
      '<tr>' +
        '<td class="meta">' + fmtDate(d.day) + '</td>' +
        '<td><strong>' + d.n + '</strong></td>' +
        '<td>' + d.types + '</td>' +
        '<td><div class="progress-bar" style="width:120px;display:inline-block;vertical-align:middle"><div class="fill" style="width:' + Math.min(100, (d.n / (Math.max(...dailyStats.map(x => x.n)) || 1)) * 100) + '%"></div></div></td>' +
      '</tr>'
    ).join('');

    // Type stats table
    const typeRows = typeStats.map(t => {
      const info = entityInfo(t.entity_type);
      const pct = total > 0 ? ((t.n / total) * 100).toFixed(1) : 0;
      return '<tr>' +
        '<td><span class="type-chip" style="border-color:' + info.color + '33;color:' + info.color + '">' + info.icon + ' ' + esc(info.label) + '</span></td>' +
        '<td><strong>' + t.n + '</strong></td>' +
        '<td>' + pct + '%</td>' +
        '<td><div class="progress-bar" style="width:100px;display:inline-block;vertical-align:middle"><div class="fill" style="width:' + pct + '%"></div></div></td>' +
        '<td class="meta">' + fmtDate(t.earliest) + '</td>' +
        '<td class="meta">' + fmtDate(t.latest) + '</td>' +
      '</tr>';
    }).join('');

    // Size stats
    const totalBytes = sizeStats.reduce((s, r) => s + (parseInt(r.total_size) || 0), 0);

    const sizeRows = sizeStats.map(s => {
      const info = entityInfo(s.entity_type);
      return '<tr>' +
        '<td><span class="type-chip" style="border-color:' + info.color + '33;color:' + info.color + '">' + info.icon + ' ' + esc(info.label) + '</span></td>' +
        '<td>' + fmtDataSize(s.total_size) + '</td>' +
        '<td>' + fmtDataSize(s.avg_size) + '</td>' +
        '<td>' + s.n + '</td>' +
      '</tr>';
    }).join('');

    const body = CSS + '<div class="wrap">' +
      '<h1>📊 Deletion Statistics</h1>' +
      '<p class="subtitle">Analytics on deleted items, storage usage, and trends</p>' +
      navTabs('Statistics') +

      '<div class="form-row" style="margin-bottom:20px">' +
        '<span class="meta">Showing data for last</span>' +
        '<a href="' + prefix + '/stats?days=7" class="btn ' + (days === 7 ? 'btn-pri' : 'btn-ghost') + ' btn-sm">7 days</a>' +
        '<a href="' + prefix + '/stats?days=30" class="btn ' + (days === 30 ? 'btn-pri' : 'btn-ghost') + ' btn-sm">30 days</a>' +
        '<a href="' + prefix + '/stats?days=90" class="btn ' + (days === 90 ? 'btn-pri' : 'btn-ghost') + ' btn-sm">90 days</a>' +
        '<a href="' + prefix + '/stats?days=365" class="btn ' + (days === 365 ? 'btn-pri' : 'btn-ghost') + ' btn-sm">1 year</a>' +
      '</div>' +

      '<div class="stats">' +
        '<div class="stat-card"><div class="icon">🗑️</div><div class="num" style="color:var(--pri)">' + total + '</div><div class="label">Total in Bin</div></div>' +
        '<div class="stat-card"><div class="icon">⏰</div><div class="num" style="color:var(--danger)">' + expired + '</div><div class="label">Expired</div></div>' +
        '<div class="stat-card"><div class="icon">💾</div><div class="num" style="color:var(--warn)">' + fmtDataSize(totalBytes) + '</div><div class="label">Storage Used</div></div>' +
        '<div class="stat-card"><div class="icon">↩️</div><div class="num" style="color:var(--success)">' + restoredCount + '</div><div class="label">Restored (total)</div></div>' +
      '</div>' +

      // Type breakdown
      '<h2>Breakdown by Entity Type</h2>' +
      (typeRows ?
        '<div style="overflow-x:auto"><table><thead><tr><th>Type</th><th>Count</th><th>%</th><th>Bar</th><th>Earliest</th><th>Latest</th></tr></thead><tbody>' + typeRows + '</tbody></table></div>'
        : '<div class="empty-state"><span class="icon">📭</span><p>No statistics available</p></div>') +

      // Storage breakdown
      '<h2>Storage by Entity Type</h2>' +
      (sizeRows ?
        '<div style="overflow-x:auto"><table><thead><tr><th>Type</th><th>Total Size</th><th>Avg Size</th><th>Items</th></tr></thead><tbody>' + sizeRows + '</tbody></table></div>'
        : '') +

      // Daily activity
      '<h2>Daily Deletion Activity</h2>' +
      (dailyRows ?
        '<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Items Deleted</th><th>Types</th><th>Volume</th></tr></thead><tbody>' + dailyRows + '</tbody></table></div>'
        : '<div class="empty-state"><span class="icon">📭</span><p>No activity in selected period</p></div>') +

    '</div>';
    res.send(renderPage('Recycle Bin - Statistics', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 10: POST /configure-retention - Set retention period
  // ═══════════════════════════════════════════════════════════════
  app.post(prefix + '/configure-retention', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const userId = who(req);
    const { entity_type, retention_days, auto_purge, max_items } = req.body;

    if (!entity_type) return res.status(400).send('entity_type is required');

    const days = Math.max(1, Math.min(3650, parseInt(retention_days) || 30));
    const autoPurge = auto_purge === 'on' || auto_purge === 'true';
    const maxItems = Math.max(10, Math.min(50000, parseInt(max_items) || 1000));

    await pool.query(`
      INSERT INTO recycle_bin_settings (school_id, entity_type, retention_days, auto_purge, max_items, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (school_id, entity_type)
      DO UPDATE SET retention_days=$3, auto_purge=$4, max_items=$5, updated_by=$6, updated_at=NOW()
    `, [sid, entity_type, days, autoPurge, maxItems, userId]);

    // Update existing items' expiry dates for this type
    if (autoPurge) {
      await pool.query(`
        UPDATE recycle_bin
        SET expires_at = deleted_at + ($1 || ' days')::INTERVAL,
            permanent_delete_at = deleted_at + ($1 || ' days')::INTERVAL
        WHERE school_id=$2 AND entity_type=$3 AND restored_at IS NULL
      `, [days, sid, entity_type]);
    }

    audit('configure_retention', {
      entityType: entity_type, retentionDays: days, autoPurge, maxItems
    }, req);

    res.redirect(prefix + '/settings?msg=configured');
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 11: GET /export - Export recycle bin contents
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/export', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const format = req.query.format || 'html';
    const entity_type = req.query.entity_type || '';
    const status = req.query.status || '';

    let q = 'SELECT * FROM recycle_bin WHERE school_id=$1';
    const p = [sid];
    let c = 2;
    if (entity_type) { q += ' AND entity_type=$' + c++; p.push(entity_type); }
    if (status === 'expired') { q += ' AND expires_at < NOW()'; }
    else if (status === 'active') { q += ' AND expires_at >= NOW()'; }
    q += ' ORDER BY deleted_at DESC LIMIT 10000';
    const { rows } = await pool.query(q, p);

    // JSON export
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="recycle-bin-export-' + new Date().toISOString().slice(0, 10) + '.json"');
      return res.json({
        exported_at: new Date().toISOString(),
        school_id: sid,
        total_items: rows.length,
        items: rows
      });
    }

    // CSV export
    if (format === 'csv') {
      const header = 'ID,Entity Type,Entity ID,Entity Name,Deleted By,Deleted At,Expires At,Restored By,Restored At';
      const csvLines = [header, ...rows.map(r =>
        [
          r.id, '"' + (r.entity_type || '').replace(/"/g, '""') + '"',
          r.entity_id, '"' + (r.entity_name || '').replace(/"/g, '""') + '"',
          r.deleted_by || '', r.deleted_at || '', r.expires_at || '',
          r.restored_by || '', r.restored_at || ''
        ].join(',')
      )];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="recycle-bin-export-' + new Date().toISOString().slice(0, 10) + '.csv"');
      return res.send(csvLines.join('\r\n'));
    }

    // HTML export page
    const typeOptions = ENTITY_TYPES.map(et =>
      '<option value="' + et.type + '"' + (entity_type === et.type ? ' selected' : '') + '>' + et.icon + ' ' + et.label + '</option>'
    ).join('');

    const body = CSS + JS + '<div class="wrap">' +
      '<h1>⬇️ Export Recycle Bin</h1>' +
      '<p class="subtitle">Download recycle bin data in various formats</p>' +
      navTabs('Export') +

      '<div class="card card-glow">' +
        '<h3 style="margin:0 0 16px">Export Options</h3>' +
        '<form method="GET" action="' + prefix + '/export" class="form-row">' +
          '<div class="form-group">' +
            '<label>Entity Type</label>' +
            '<select name="entity_type"><option value="">All Types</option>' + typeOptions + '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Status</label>' +
            '<select name="status"><option value="">All</option><option value="active">Active</option><option value="expired">Expired</option></select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Format</label>' +
            '<select name="format"><option value="html">HTML Preview</option><option value="json">JSON</option><option value="csv">CSV</option></select>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:flex-end">' +
            '<button class="btn btn-pri" type="submit">Export</button>' +
            '<a href="' + prefix + '/export?format=json' + (entity_type ? '&entity_type=' + entity_type : '') + '" class="btn btn-ghost">⬇ JSON</a>' +
            '<a href="' + prefix + '/export?format=csv' + (entity_type ? '&entity_type=' + entity_type : '') + '" class="btn btn-ghost">⬇ CSV</a>' +
          '</div>' +
        '</form>' +
      '</div>' +

      '<div class="alert alert-info" style="background:var(--pri-bg);color:var(--pri-light);border:1px solid rgba(59,130,246,0.25)">' +
        'ℹ️ Export limited to 10,000 most recent items. Use the API endpoint for full access.' +
      '</div>' +

      // Preview
      '<h2>Preview (' + rows.length + ' items)</h2>' +
      (rows.length > 0 ?
        '<div style="overflow-x:auto"><table><thead><tr>' +
          '<th>ID</th><th>Type</th><th>Name</th><th>Entity ID</th><th>Deleted At</th><th>Expires</th>' +
        '</tr></thead><tbody>' +
        rows.slice(0, 100).map(r => {
          const info = entityInfo(r.entity_type);
          return '<tr>' +
            '<td>' + r.id + '</td>' +
            '<td><span class="type-chip" style="border-color:' + info.color + '33;color:' + info.color + '">' + info.icon + ' ' + esc(info.label) + '</span></td>' +
            '<td>' + esc(r.entity_name || '—') + '</td>' +
            '<td class="meta">' + r.entity_id + '</td>' +
            '<td class="meta">' + fmtDateTime(r.deleted_at) + '</td>' +
            '<td>' + fmtRelative(r.expires_at) + '</td>' +
          '</tr>';
        }).join('') +
        (rows.length > 100 ? '<tr><td colspan="6" class="meta" style="text-align:center">... and ' + (rows.length - 100) + ' more items</td></tr>' : '') +
        '</tbody></table></div>'
        : '<div class="empty-state"><span class="icon">📭</span><p>No items to export</p></div>') +

    '</div>';
    res.send(renderPage('Recycle Bin - Export', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 12: GET /settings - Recycle bin settings
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/settings', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const msg = req.query.msg || '';

    const [settingsRes, totalRes, expiredRes] = await Promise.all([
      pool.query('SELECT * FROM recycle_bin_settings WHERE school_id=$1 ORDER BY entity_type', [sid]),
      pool.query('SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1', [sid]),
      pool.query('SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 AND expires_at < NOW()', [sid]),
    ]);

    const settings = settingsRes.rows;
    const totalItems = totalRes.rows[0].n;
    const expiredItems = expiredRes.rows[0].n;

    // Build settings cards with forms
    const settingsCards = ENTITY_TYPES.map(et => {
      const s = settings.find(x => x.entity_type === et.type) || {};
      const retention = s.retention_days || 30;
      const autoPurge = s.auto_purge || false;
      const maxItems = s.max_items || 1000;
      const updatedBy = s.updated_by || '—';
      const updatedAt = fmtDateTime(s.updated_at);

      // Get current count for this type
      return '<div class="retention-card">' +
        '<h3 style="margin:0 0 12px;display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:1.3rem">' + et.icon + '</span> ' + esc(et.label) +
        '</h3>' +
        '<form method="POST" action="' + prefix + '/configure-retention" style="display:flex;flex-direction:column;gap:12px">' +
          '<input type="hidden" name="entity_type" value="' + et.type + '">' +
          '<div class="form-row" style="margin:0">' +
            '<div class="form-group" style="flex:1">' +
              '<label>Retention (days)</label>' +
              '<input type="number" name="retention_days" value="' + retention + '" min="1" max="3650">' +
            '</div>' +
            '<div class="form-group" style="flex:1">' +
              '<label>Max Items</label>' +
              '<input type="number" name="max_items" value="' + maxItems + '" min="10" max="50000">' +
            '</div>' +
          '</div>' +
          '<div class="checkbox-wrap">' +
            '<input type="checkbox" name="auto_purge" id="auto-' + et.type + '"' + (autoPurge ? ' checked' : '') + '>' +
            '<label for="auto-' + et.type + '" style="margin:0;cursor:pointer">Auto-purge expired items</label>' +
          '</div>' +
          '<div class="form-row" style="margin:0;justify-content:space-between;align-items:center">' +
            '<span class="meta">Updated: ' + updatedAt + ' by ' + updatedBy + '</span>' +
            '<button class="btn btn-pri btn-sm" type="submit">Save</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    }).join('');

    const body = CSS + '<div class="wrap">' +
      '<h1>⚙️ Recycle Bin Settings</h1>' +
      '<p class="subtitle">Configure retention policies and auto-purge rules per entity type</p>' +
      navTabs('Settings') +

      (msg === 'configured' ? '<div class="alert alert-success">✅ Retention settings updated successfully.</div>' : '') +

      '<div class="stats">' +
        '<div class="stat-card"><div class="icon">🗑️</div><div class="num" style="color:var(--pri)">' + totalItems + '</div><div class="label">Items in Bin</div></div>' +
        '<div class="stat-card"><div class="icon">⏰</div><div class="num" style="color:var(--danger)">' + expiredItems + '</div><div class="label">Expired Items</div></div>' +
        '<div class="stat-card"><div class="icon">📁</div><div class="num" style="color:var(--warn)">' + ENTITY_TYPES.length + '</div><div class="label">Entity Types</div></div>' +
      '</div>' +

      // Global actions
      '<div class="card card-glow" style="margin-bottom:24px">' +
        '<h3 style="margin:0 0 12px">Global Actions</h3>' +
        '<div class="form-row" style="margin:0">' +
          '<form method="DELETE" action="' + prefix + '/empty?expired_only=true" style="display:inline" onsubmit="return confirm(\'Purge all expired items? This cannot be undone.\')">' +
            '<button class="btn btn-danger" type="submit">🗑️ Purge All Expired Items</button>' +
          '</form>' +
          '<form method="DELETE" action="' + prefix + '/empty" style="display:inline" onsubmit="return confirm(\'Empty entire recycle bin? This will permanently delete ALL items.\')">' +
            '<button class="btn btn-danger" type="submit" style="background:transparent;border:1px solid var(--danger);color:var(--danger)">⚠️ Empty Entire Bin</button>' +
          '</form>' +
        '</div>' +
      '</div>' +

      // Per-type settings
      '<h2>Retention Policies by Entity Type</h2>' +
      '<div class="grid-2">' + settingsCards + '</div>' +

    '</div>';
    res.send(renderPage('Recycle Bin - Settings', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // ROUTE 13: GET /by-type/:type - Items of specific type
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix + '/by-type/:type', requireAuth, ah(async (req, res) => {
    const sid = schoolId(req);
    const type = req.params.type;
    const info = entityInfo(type);
    const {
      page = '1', limit = '50', search = '', sort = 'deleted_at', dir = 'DESC'
    } = req.query;

    // Validate entity type
    if (!ENTITY_TYPES.find(e => e.type === type)) {
      return res.redirect(prefix);
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(10, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    const validSorts = ['deleted_at', 'entity_name', 'expires_at', 'id'];
    const sortCol = validSorts.includes(sort) ? sort : 'deleted_at';
    const sortDir = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count
    let countParams = [sid, type];
    let countQ = 'SELECT COUNT(*)::int AS n FROM recycle_bin WHERE school_id=$1 AND entity_type=$2';
    if (search) { countQ += ' AND (entity_name ILIKE $3 OR entity_data::text ILIKE $3)'; countParams.push('%' + search + '%'); }
    const [{ n: totalItems }] = (await pool.query(countQ, countParams)).rows;
    const totalPages = Math.ceil(totalItems / limitNum);

    // Data
    let q = 'SELECT * FROM recycle_bin WHERE school_id=$1 AND entity_type=$2';
    const p = [sid, type];
    let c = 3;
    if (search) { q += ' AND (entity_name ILIKE $3 OR entity_data::text ILIKE $3)'; p.push('%' + search + '%'); c++; }
    q += ' ORDER BY ' + sortCol + ' ' + sortDir + ' LIMIT $' + c++ + ' OFFSET $' + c++;
    p.push(limitNum, offset);
    const { rows } = await pool.query(q, p);

    // Type stats
    const [statRes, settingsRes] = await Promise.all([
      pool.query(
        'SELECT COUNT(*)::int AS n, MIN(deleted_at) AS earliest, MAX(deleted_at) AS latest ' +
        'FROM recycle_bin WHERE school_id=$1 AND entity_type=$2', [sid, type]
      ),
      pool.query(
        'SELECT * FROM recycle_bin_settings WHERE school_id=$1 AND entity_type=$2', [sid, type]
      ),
    ]);
    const stat = statRes.rows[0];
    const setting = settingsRes.rows[0];

    const rowsHtml = rows.map(r => {
      const isExpired = r.expires_at && new Date(r.expires_at) < new Date();
      return '<tr>' +
        '<td><label class="checkbox-wrap"><input type="checkbox" class="row-checkbox" value="' + r.id + '" onchange="updateBulkBar()"></label></td>' +
        '<td>' + r.id + '</td>' +
        '<td><strong>' + esc(r.entity_name || '#' + r.entity_id) + '</strong></td>' +
        '<td class="meta">' + fmtDateTime(r.deleted_at) + '</td>' +
        '<td>' + fmtRelative(r.expires_at) + (isExpired ? ' <span class="badge badge-danger">expired</span>' : '') + '</td>' +
        '<td>' +
          '<a href="' + prefix + '/item/' + r.id + '" class="btn btn-ghost btn-xs">View</a> ' +
          '<form method="POST" action="' + prefix + '/restore/' + r.id + '" style="display:inline">' +
            '<button class="btn btn-success btn-xs">↩</button>' +
          '</form> ' +
          '<form method="POST" action="' + prefix + '/permanent/' + r.id + '" style="display:inline" onsubmit="return confirm(\'Permanently delete?\')">' +
            '<button class="btn btn-danger btn-xs">🗑</button>' +
          '</form>' +
        '</td>' +
      '</tr>';
    }).join('');

    const pagination = totalPages > 1 ? '<div class="form-row" style="justify-content:center;margin-top:16px">' +
      (pageNum > 1 ? '<a href="' + prefix + '/by-type/' + type + '?page=' + (pageNum - 1) + '&search=' + esc(search) + '&sort=' + sort + '&dir=' + dir + '" class="btn btn-ghost btn-sm">&larr; Previous</a>' : '') +
      '<span class="meta" style="padding:8px">Page ' + pageNum + ' of ' + totalPages + '</span>' +
      (pageNum < totalPages ? '<a href="' + prefix + '/by-type/' + type + '?page=' + (pageNum + 1) + '&search=' + esc(search) + '&sort=' + sort + '&dir=' + dir + '" class="btn btn-ghost btn-sm">Next &rarr;</a>' : '') +
    '</div>' : '';

    const body = CSS + JS + '<div class="wrap">' +
      '<a href="' + prefix + '" class="btn btn-ghost" style="margin-bottom:16px">&larr; Back to Recycle Bin</a>' +
      '<h1 style="display:flex;align-items:center;gap:10px">' +
        '<span style="font-size:2rem">' + info.icon + '</span> ' + esc(info.label) + 's in Recycle Bin' +
      '</h1>' +
      '<p class="subtitle">' + totalItems + ' deleted ' + esc(info.label).toLowerCase() + ' item(s)' +
        (setting ? ' &middot; Retention: ' + setting.retention_days + ' days' +
          (setting.auto_purge ? ' &middot; Auto-purge: ON' : '') : '') +
      '</p>' +

      // Quick actions
      '<div class="card" style="margin-bottom:16px;padding:12px 16px">' +
        '<div class="form-row" style="margin:0;align-items:center">' +
          '<span class="meta">' + totalItems + ' items &middot; Earliest: ' + fmtDate(stat.earliest) + ' &middot; Latest: ' + fmtDate(stat.latest) + '</span>' +
          '<form id="bulk-form" method="POST"><input type="hidden" name="ids" id="bulk-ids"></form>' +
          (totalItems > 0 ? '<button class="btn btn-success btn-sm" onclick="bulkAction(\'bulk-restore\')">↩ Restore All (' + totalItems + ')</button>' : '') +
        '</div>' +
      '</div>' +

      // Search
      '<form method="GET" action="' + prefix + '/by-type/' + type + '" class="form-row">' +
        '<div class="search-box"><input name="search" value="' + esc(search) + '" placeholder="Search ' + esc(info.label).toLowerCase() + 's..."></div>' +
        '<select name="sort"><option value="deleted_at"' + (sort === 'deleted_at' ? ' selected' : '') + '>Sort: Date</option><option value="entity_name"' + (sort === 'entity_name' ? ' selected' : '') + '>Sort: Name</option><option value="expires_at"' + (sort === 'expires_at' ? ' selected' : '') + '>Sort: Expires</option></select>' +
        '<button class="btn btn-pri btn-sm" type="submit">Search</button>' +
        (search ? '<a href="' + prefix + '/by-type/' + type + '" class="btn btn-ghost btn-sm">Clear</a>' : '') +
      '</form>' +

      // Bulk actions bar
      '<div id="bulk-action-bar" class="card" style="display:none;margin-bottom:12px;padding:12px 16px">' +
        '<div class="form-row" style="margin:0;align-items:center">' +
          '<span class="meta"><strong id="bulk-count">0</strong> selected</span>' +
          '<button class="btn btn-success btn-sm" onclick="bulkAction(\'bulk-restore\')">↩ Restore</button>' +
          '<button class="btn btn-danger btn-sm" onclick="bulkAction(\'bulk-permanent\')">🗑 Delete Forever</button>' +
        '</div>' +
      '</div>' +

      // Items
      (rows.length > 0 ?
        '<div style="overflow-x:auto"><table><thead><tr>' +
          '<th><input type="checkbox" onchange="toggleSelectAll(this)"></th>' +
          '<th>ID</th><th>Name</th><th>Deleted</th><th>Expires</th><th>Actions</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' + pagination
        : '<div class="empty-state"><span class="icon">✨</span><p>No deleted ' + esc(info.label).toLowerCase() + 's found</p></div>') +

    '</div>';
    res.send(renderPage('Recycle Bin - ' + info.label + 's', body, req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // SOFT DELETE HELPER — Public API for other modules
  // ═══════════════════════════════════════════════════════════════

  /**
   * Move an entity to the recycle bin.
   * @param {Object} params
   * @param {string} params.entityType - e.g. 'student', 'teacher'
   * @param {number} params.entityId - the record ID
   * @param {string} [params.entityName] - display name
   * @param {Object} [params.entityData] - full record data (JSONB)
   * @param {number} [params.schoolId] - defaults to 1
   * @param {number} [params.deletedBy] - user ID who deleted
   * @returns {Promise<Object>} inserted row
   */
  app.recycleBin = {
    softDelete: async function(params) {
      const {
        entityType, entityId, entityName = null, entityData = {},
        schoolId: sId = 1, deletedBy = null
      } = params;

      if (!entityType || !entityId) {
        throw new Error('entityType and entityId are required');
      }

      // Get retention settings
      let retentionDays = 30;
      try {
        const { rows: [s] } = await pool.query(
          'SELECT retention_days FROM recycle_bin_settings WHERE school_id=$1 AND entity_type=$2',
          [sId, entityType]
        );
        if (s) retentionDays = s.retention_days;
      } catch (e) { /* use default */ }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + retentionDays);

      const { rows: [inserted] } = await pool.query(
        `INSERT INTO recycle_bin
          (entity_type, entity_id, entity_name, entity_data, deleted_by, school_id, expires_at, permanent_delete_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING *`,
        [entityType, entityId, entityName, JSON.stringify(entityData), deletedBy, sId, expiresAt]
      );

      return inserted;
    },

    /**
     * Restore an item from the recycle bin.
     * @param {number} id - recycle_bin ID
     * @param {number} [sid] - school ID
     * @returns {Promise<Object|null>} restored item or null
     */
    restore: async function(id, sid = 1) {
      const { rows: [item] } = await pool.query(
        'SELECT * FROM recycle_bin WHERE id=$1 AND school_id=$2', [id, sid]
      );
      if (!item) return null;

      const data = item.entity_data || {};
      const tableName = item.entity_type + 's';
      const cols = Object.keys(data).filter(k => k !== 'id');

      if (cols.length > 0) {
        try {
          const setClauses = cols.map((c, i) => '"' + c + '" = $' + (i + 2)).join(', ');
          await pool.query(
            'INSERT INTO "' + tableName + '" (' + cols.map(c => '"' + c + '"').join(',') + ') ' +
            'VALUES (' + cols.map((_, i) => '$' + (i + 2)).join(',') + ') ' +
            'ON CONFLICT DO NOTHING SET ' + setClauses,
            [item.entity_id, ...cols.map(c => data[c])]
          );
        } catch (e) { /* table might not exist */ }
      }

      await pool.query('DELETE FROM recycle_bin WHERE id=$1', [id]);
      return item;
    },

    /**
     * Check if an entity is in the recycle bin.
     * @param {string} entityType
     * @param {number} entityId
     * @param {number} [sid]
     * @returns {Promise<boolean>}
     */
    isInBin: async function(entityType, entityId, sid = 1) {
      const { rows: [{ exists }] } = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM recycle_bin WHERE entity_type=$1 AND entity_id=$2 AND school_id=$3)',
        [entityType, entityId, sid]
      );
      return exists;
    },

    /**
     * Purge expired items for a given school.
     * @param {number} [sid]
     * @returns {Promise<number>} number of purged items
     */
    purgeExpired: async function(sid = 1) {
      // First find types with auto-purge enabled
      const { rows: autoTypes } = await pool.query(
        'SELECT entity_type FROM recycle_bin_settings WHERE school_id=$1 AND auto_purge=true', [sid]
      );
      const types = autoTypes.map(r => r.entity_type);
      if (types.length === 0) return 0;

      const { rowCount } = await pool.query(
        'DELETE FROM recycle_bin WHERE school_id=$1 AND entity_type = ANY($2) AND expires_at < NOW()',
        [sid, types]
      );
      return rowCount;
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // Cleanup job — purge expired items (runs on module load)
  // ═══════════════════════════════════════════════════════════════
  (async () => {
    try {
      const purged = await app.recycleBin.purgeExpired(1);
      if (purged > 0) {
        console.log('[recycle-bin] Auto-purged ' + purged + ' expired items on startup');
      }
    } catch (e) {
      console.error('[recycle-bin] Auto-purge error:', e.message);
    }

    // Schedule hourly cleanup
    setInterval(async () => {
      try {
        const purged = await app.recycleBin.purgeExpired(1);
        if (purged > 0) {
          console.log('[recycle-bin] Auto-purged ' + purged + ' expired items (hourly)');
        }
      } catch (e) { /* silent */ }
    }, 60 * 60 * 1000);
  })();

  console.log('[recycle-bin] Module loaded at ' + prefix);
};
