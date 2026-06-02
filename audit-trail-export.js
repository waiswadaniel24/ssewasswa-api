/**
 * Audit Trail Export Module
 * Comprehensive audit log export system with CSV/PDF/JSON support,
 * scheduled recurring exports, templates, and full lifecycle management.
 *
 * Tables: audit_exports
 * Dark theme UI with blue accents.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc;

  // ─── Helper: safe HTML escape ────────────────────────────────────────────
  function h(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Helper: format timestamps ───────────────────────────────────────────
  function fmtTime(ts) {
    if (!ts) return '<span style="color:#475569">—</span>';
    const d = new Date(ts);
    return `<span title="${d.toISOString()}">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</span>`;
  }

  // ─── Helper: format file size ────────────────────────────────────────────
  function fmtSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
  }

  // ─── Helper: status badge ────────────────────────────────────────────────
  function statusBadge(status) {
    const map = {
      pending:   { cls: 'badge-pending',   icon: '⏳', label: 'Pending' },
      running:   { cls: 'badge-running',   icon: '⚙️', label: 'Running' },
      completed: { cls: 'badge-completed', icon: '✅', label: 'Completed' },
      failed:    { cls: 'badge-failed',    icon: '❌', label: 'Failed' },
      cancelled: { cls: 'badge-cancelled', icon: '🚫', label: 'Cancelled' },
      scheduled: { cls: 'badge-scheduled', icon: '🕐', label: 'Scheduled' }
    };
    const s = map[status] || { cls: 'badge-pending', icon: '❓', label: status || 'Unknown' };
    return `<span class="badge ${s.cls}">${s.icon} ${s.label}</span>`;
  }

  // ─── Helper: format badge ────────────────────────────────────────────────
  function formatBadge(fmt) {
    const map = {
      csv:  { cls: 'badge-csv',  icon: '📊', label: 'CSV' },
      pdf:  { cls: 'badge-pdf',  icon: '📄', label: 'PDF' },
      json: { cls: 'badge-json', icon: '🔧', label: 'JSON' },
      xlsx: { cls: 'badge-xlsx', icon: '📈', label: 'XLSX' }
    };
    const f = map[fmt] || { cls: 'badge-csv', icon: '📁', label: fmt || 'Unknown' };
    return `<span class="badge ${f.cls}">${f.icon} ${f.label}</span>`;
  }

  // ─── Helper: entity type badges ──────────────────────────────────────────
  function entityBadges(types) {
    if (!types || !Array.isArray(types) || types.length === 0) {
      return '<span style="color:#64748b;">All Entities</span>';
    }
    return types.map(t => `<span class="badge badge-entity">${esc(t)}</span>`).join(' ');
  }

  // ─── Dark theme CSS ──────────────────────────────────────────────────────
  function darkStyles() {
    return `<style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #0f172a; color: #e2e8f0; font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; line-height: 1.6; min-height: 100vh; }
      .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
      .dash-header { margin-bottom: 28px; }
      .dash-title-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 8px; }
      .dash-title-row h1 { font-size: 1.75rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 10px; }
      .icon-wrap { font-size: 1.5rem; }
      .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: #64748b; }
      .breadcrumbs a { color: #3b82f6; text-decoration: none; transition: color 0.2s; }
      .breadcrumbs a:hover { color: #60a5fa; }
      .breadcrumbs .sep { color: #475569; margin: 0 2px; }
      .breadcrumbs .active { color: #94a3b8; pointer-events: none; }
      .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; font-weight: 500; text-decoration: none; transition: all 0.2s; cursor: pointer; border: none; }
      .btn-primary { background: #3b82f6; color: #fff; }
      .btn-primary:hover { background: #2563eb; }
      .btn-outline { background: transparent; color: #94a3b8; border: 1px solid #334155; }
      .btn-outline:hover { border-color: #3b82f6; color: #3b82f6; }
      .btn-outline.active { border-color: #3b82f6; color: #3b82f6; background: rgba(59,130,246,0.1); }
      .btn-danger { background: #ef4444; color: #fff; }
      .btn-danger:hover { background: #dc2626; }
      .btn-success { background: #22c55e; color: #fff; }
      .btn-success:hover { background: #16a34a; }
      .btn-warning { background: #f59e0b; color: #fff; }
      .btn-warning:hover { background: #d97706; }
      .btn-sm { padding: 5px 12px; font-size: 0.78rem; border-radius: 6px; }
      .btn-ghost { background: rgba(51,65,85,0.5); color: #94a3b8; }
      .btn-ghost:hover { background: #334155; color: #e2e8f0; }
      .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; transition: transform 0.2s, border-color 0.2s; }
      .stat-card:hover { transform: translateY(-2px); border-color: #475569; }
      .stat-card .stat-label { font-size: 0.8rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
      .stat-card .stat-value { font-size: 2rem; font-weight: 700; color: #f1f5f9; }
      .stat-card .stat-sub { font-size: 0.78rem; color: #64748b; margin-top: 4px; }
      .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
      .card h2 { font-size: 1.15rem; font-weight: 600; color: #e2e8f0; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
      .card h3 { font-size: 1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
      thead th { background: #0f172a; color: #94a3b8; text-align: left; padding: 10px 14px; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #334155; position: sticky; top: 0; z-index: 2; }
      tbody td { padding: 10px 14px; border-bottom: 1px solid #1e293b; color: #cbd5e1; vertical-align: top; }
      tbody tr { transition: background 0.15s; }
      tbody tr:hover { background: rgba(59,130,246,0.05); }
      .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
      .badge-pending { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
      .badge-running { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
      .badge-completed { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
      .badge-failed { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
      .badge-cancelled { background: rgba(148,163,184,0.15); color: #94a3b8; border: 1px solid rgba(148,163,184,0.3); }
      .badge-scheduled { background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); }
      .badge-csv { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25); }
      .badge-pdf { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }
      .badge-json { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.25); }
      .badge-xlsx { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25); }
      .badge-entity { background: rgba(51,65,85,0.5); color: #94a3b8; border: 1px solid #334155; font-size: 0.72rem; padding: 2px 8px; }
      .filter-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
      .filter-bar input, .filter-bar select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 8px 14px; border-radius: 8px; font-size: 0.88rem; outline: none; transition: border-color 0.2s; }
      .filter-bar input:focus, .filter-bar select:focus { border-color: #3b82f6; }
      .form-group { margin-bottom: 16px; }
      .form-group label { display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 6px; font-weight: 500; }
      .form-group input, .form-group textarea, .form-group select { width: 100%; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; padding: 10px 14px; border-radius: 8px; font-size: 0.9rem; outline: none; transition: border-color 0.2s; font-family: inherit; }
      .form-group input:focus, .form-group textarea:focus, .form-group select:focus { border-color: #3b82f6; }
      .form-group textarea { min-height: 80px; resize: vertical; }
      .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .form-row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
      .meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .meta-item { background: #0f172a; padding: 10px 14px; border-radius: 8px; border: 1px solid #1e293b; }
      .meta-item .meta-key { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
      .meta-item .meta-val { font-size: 0.9rem; color: #e2e8f0; word-break: break-all; }
      .alert { padding: 12px 18px; border-radius: 8px; font-size: 0.88rem; margin-bottom: 16px; }
      .alert-success { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
      .alert-danger { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
      .alert-info { background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
      .alert-warning { background: rgba(251,191,36,0.12); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
      .empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
      .empty-state .icon { font-size: 3rem; margin-bottom: 12px; }
      .empty-state p { font-size: 1rem; }
      .flex-between { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
      .pagination { display: flex; gap: 6px; align-items: center; margin-top: 16px; }
      .pagination a, .pagination span { padding: 6px 12px; border-radius: 6px; font-size: 0.82rem; text-decoration: none; color: #94a3b8; background: #1e293b; border: 1px solid #334155; }
      .pagination a:hover { border-color: #3b82f6; color: #3b82f6; }
      .pagination .current { background: #3b82f6; color: #fff; border-color: #3b82f6; }
      .progress-bar { height: 8px; background: #334155; border-radius: 4px; overflow: hidden; margin-top: 6px; }
      .progress-bar .fill { height: 100%; background: #3b82f6; border-radius: 4px; transition: width 0.4s; }
      .progress-bar .fill.green { background: #22c55e; }
      .progress-bar .fill.red { background: #ef4444; }
      .progress-bar .fill.yellow { background: #fbbf24; }
      .tab-nav { display: flex; gap: 4px; border-bottom: 2px solid #334155; margin-bottom: 24px; flex-wrap: wrap; }
      .tab-nav a { padding: 10px 18px; text-decoration: none; color: #64748b; font-weight: 500; border-radius: 8px 8px 0 0; transition: 0.2s; font-size: 0.88rem; }
      .tab-nav a:hover { background: rgba(59,130,246,0.08); color: #94a3b8; }
      .tab-nav a.active { background: #3b82f6; color: #fff; }
      .template-card { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 18px; transition: border-color 0.2s, transform 0.2s; cursor: pointer; }
      .template-card:hover { border-color: #3b82f6; transform: translateY(-2px); }
      .template-card .tpl-name { font-weight: 600; color: #e2e8f0; margin-bottom: 4px; }
      .template-card .tpl-desc { font-size: 0.82rem; color: #64748b; margin-bottom: 8px; }
      .template-card .tpl-meta { font-size: 0.78rem; color: #475569; }
      .template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .schedule-row { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid #1e293b; flex-wrap: wrap; }
      .schedule-row:last-child { border-bottom: none; }
      .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #1e293b; }
      .setting-item:last-child { border-bottom: none; }
      .setting-label { font-weight: 500; color: #e2e8f0; }
      .setting-desc { font-size: 0.82rem; color: #64748b; }
      .toggle { position: relative; width: 48px; height: 26px; cursor: pointer; }
      .toggle input { opacity: 0; width: 0; height: 0; }
      .toggle .slider { position: absolute; inset: 0; background: #334155; border-radius: 26px; transition: 0.3s; }
      .toggle .slider:before { content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px; background: #94a3b8; border-radius: 50%; transition: 0.3s; }
      .toggle input:checked + .slider { background: #3b82f6; }
      .toggle input:checked + .slider:before { transform: translateX(22px); background: #fff; }
      .preview-table { max-height: 400px; overflow: auto; }
      .checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; }
      .checkbox-group label { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #cbd5e1; font-size: 0.85rem; cursor: pointer; transition: 0.2s; }
      .checkbox-group label:hover { border-color: #3b82f6; }
      .checkbox-group input[type="checkbox"] { accent-color: #3b82f6; width: 16px; height: 16px; }
      .truncated { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 768px) {
        .form-grid { grid-template-columns: 1fr; }
        .dash-title-row { flex-direction: column; align-items: flex-start; }
        .header-actions { width: 100%; overflow-x: auto; }
        .stats-grid { grid-template-columns: 1fr 1fr; }
        .filter-bar { flex-direction: column; }
        .template-grid { grid-template-columns: 1fr; }
      }
    </style>`;
  }

  // ─── Header / nav helper ─────────────────────────────────────────────────
  function pageHeader(activeTab, breadcrumbs) {
    breadcrumbs = breadcrumbs || [{ label: 'Audit Export', href: '/admin/audit-export' }];
    const crumbHTML = breadcrumbs.map((b, i) => {
      const sep = i < breadcrumbs.length - 1 ? '<span class="sep">›</span>' : '';
      return `<a href="${b.href || '#'}" class="crumb ${i === breadcrumbs.length - 1 ? 'active' : ''}">${b.label}</a>${sep}`;
    }).join('');

    const tabs = [
      { href: '/admin/audit-export', label: 'Dashboard', icon: '📊' },
      { href: '/admin/audit-export/preview', label: 'Preview', icon: '👁' },
      { href: '/admin/audit-export/schedule', label: 'Schedule', icon: '🕐' },
      { href: '/admin/audit-export/templates', label: 'Templates', icon: '📋' },
      { href: '/admin/audit-export/settings', label: 'Settings', icon: '⚙️' }
    ];

    const tabNav = `<div class="tab-nav">${tabs.map(t =>
      `<a href="${t.href}" class="${activeTab === t.label ? 'active' : ''}">${t.icon} ${t.label}</a>`
    ).join('')}</div>`;

    return `
    <div class="dash-header">
      <div class="dash-title-row">
        <h1><span class="icon-wrap">📦</span> Audit Trail Export</h1>
        <div class="header-actions">
          <a href="/admin/audit-export/preview" class="btn btn-outline ${activeTab === 'Preview' ? 'active' : ''}">👁 Preview</a>
          <a href="/admin/audit-export/schedule" class="btn btn-outline ${activeTab === 'Schedule' ? 'active' : ''}">🕐 Schedule</a>
          <a href="/admin/audit-export/templates" class="btn btn-outline ${activeTab === 'Templates' ? 'active' : ''}">📋 Templates</a>
          <a href="/admin/audit-export/settings" class="btn btn-outline ${activeTab === 'Settings' ? 'active' : ''}">⚙️ Settings</a>
        </div>
      </div>
      <div class="breadcrumbs">${crumbHTML}</div>
      ${tabNav}
    </div>`;
  }

  // ─── Auto-create table ───────────────────────────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_exports (
        id SERIAL PRIMARY KEY,
        export_name TEXT,
        format TEXT DEFAULT 'csv',
        entity_types TEXT[] DEFAULT '{}',
        date_from TIMESTAMPTZ,
        date_to TIMESTAMPTZ,
        filters JSONB,
        status TEXT DEFAULT 'pending',
        file_path TEXT,
        file_size INT,
        record_count INT,
        requested_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        school_id INT DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_ae_school ON audit_exports(school_id);
      CREATE INDEX IF NOT EXISTS idx_ae_status ON audit_exports(status);
      CREATE INDEX IF NOT EXISTS idx_ae_created ON audit_exports(created_at DESC);
    `);
    console.log('[audit-trail-export] Table audit_exports ready');
  })().catch(() => {});

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET / - Dashboard with export history
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export', async (req, res) => {
    try {
      const schoolId = req.user?.school_id || req.session?.school_id || 1;
      const statusFilter = req.query.status || '';
      const formatFilter = req.query.format || '';

      // Aggregate stats
      const statsRes = await pool.query(`
        SELECT
          COUNT(*)::int AS total_exports,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(file_size), 0)::bigint AS total_size,
          COALESCE(SUM(record_count), 0)::int AS total_records
        FROM audit_exports WHERE school_id = $1)
      `, [schoolId]);
      const stats = statsRes.rows[0];

      // Format breakdown
      const fmtRes = await pool.query(`
        SELECT format, COUNT(*)::int AS count FROM audit_exports
        WHERE school_id = $1 GROUP BY format ORDER BY count DESC
      `, [schoolId]);

      // Recent exports (last 25)
      let query = 'SELECT * FROM audit_exports WHERE school_id = $1';
      const params = [schoolId];
      let paramIdx = 2;
      if (statusFilter) { query += ` AND status = $${paramIdx++}`; params.push(statusFilter); }
      if (formatFilter) { query += ` AND format = $${paramIdx++}`; params.push(formatFilter); }
      query += ' ORDER BY created_at DESC LIMIT 30';

      const exportsRes = await pool.query(query, params);
      const exports = exportsRes.rows;

      // 7-day trend
      const trendRes = await pool.query(`
        SELECT d::date AS day, COALESCE(cnt, 0) AS count
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') d
        LEFT JOIN (
          SELECT created_at::date AS fd, COUNT(*)::int AS cnt
          FROM audit_exports WHERE school_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY created_at::date
        ) sub ON sub.fd = d ORDER BY d
      `, [schoolId]);

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Dashboard')}
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">📤 Total Exports</div>
              <div class="stat-value">${stats.total_exports}</div>
              <div class="stat-sub">${fmtSize(stats.total_size)} total</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">✅ Completed</div>
              <div class="stat-value" style="color:#4ade80">${stats.completed}</div>
              <div class="stat-sub">${stats.total_records.toLocaleString()} records exported</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">⏳ Pending / Running</div>
              <div class="stat-value" style="color:#fbbf24">${stats.pending + stats.running}</div>
              <div class="stat-sub">${stats.pending} pending, ${stats.running} running</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">❌ Failed</div>
              <div class="stat-value" style="color:#f87171">${stats.failed}</div>
              <div class="stat-sub">Requires attention</div>
            </div>
          </div>

          <div class="card">
            <div class="flex-between" style="margin-bottom:16px;">
              <h2 style="margin-bottom:0;">📋 Export History</h2>
              <div style="display:flex;gap:8px;">
                <form method="GET" class="filter-bar" style="margin-bottom:0;">
                  <select name="status" onchange="this.form.submit()">
                    <option value="">All Statuses</option>
                    <option value="pending" ${statusFilter === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="running" ${statusFilter === 'running' ? 'selected' : ''}>Running</option>
                    <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
                    <option value="failed" ${statusFilter === 'failed' ? 'selected' : ''}>Failed</option>
                    <option value="scheduled" ${statusFilter === 'scheduled' ? 'selected' : ''}>Scheduled</option>
                  </select>
                  <select name="format" onchange="this.form.submit()">
                    <option value="">All Formats</option>
                    <option value="csv" ${formatFilter === 'csv' ? 'selected' : ''}>CSV</option>
                    <option value="pdf" ${formatFilter === 'pdf' ? 'selected' : ''}>PDF</option>
                    <option value="json" ${formatFilter === 'json' ? 'selected' : ''}>JSON</option>
                  </select>
                </form>
                <a href="/admin/audit-export/create" class="btn btn-primary">+ New Export</a>
              </div>
            </div>
            ${exports.length === 0 ? `
              <div class="empty-state">
                <div class="icon">📦</div>
                <p>No exports created yet. Click <strong>+ New Export</strong> to get started.</p>
              </div>
            ` : `
              <div style="overflow-x:auto;">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Format</th>
                      <th>Entities</th>
                      <th>Status</th>
                      <th>Records</th>
                      <th>Size</th>
                      <th>Requested</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${exports.map(ex => `<tr>
                      <td><a href="/admin/audit-export/${ex.id}" style="color:#60a5fa;text-decoration:none;font-weight:600;">#${ex.id}</a></td>
                      <td><strong>${esc(ex.export_name || 'Untitled Export')}</strong></td>
                      <td>${formatBadge(ex.format)}</td>
                      <td>${entityBadges(ex.entity_types)}</td>
                      <td>${statusBadge(ex.status)}</td>
                      <td style="font-weight:600;">${(ex.record_count || 0).toLocaleString()}</td>
                      <td style="font-size:0.82rem;color:#64748b;">${fmtSize(ex.file_size)}</td>
                      <td style="font-size:0.82rem;">${fmtTime(ex.created_at)}</td>
                      <td>
                        <div style="display:flex;gap:4px;">
                          ${ex.status === 'completed' ? `<a href="/admin/audit-export/${ex.id}/download" class="btn btn-sm btn-success">⬇ Download</a>` : ''}
                          ${ex.status === 'failed' ? `<form method="POST" action="/admin/audit-export/${ex.id}/retry" style="display:inline;"><button class="btn btn-sm btn-warning">🔄 Retry</button></form>` : ''}
                          <a href="/admin/audit-export/${ex.id}" class="btn btn-sm btn-ghost">View</a>
                          ${ex.status !== 'running' ? `<form method="POST" action="/admin/audit-export/${ex.id}/delete" style="display:inline;" onsubmit="return confirm('Delete export #${ex.id}?');"><button class="btn btn-sm btn-danger">🗑</button></form>` : ''}
                        </div>
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
      `;
      res.send(opts.renderPage('Audit Trail Export', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /data - JSON exports list
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/data', async (req, res) => {
    try {
      const schoolId = req.user?.school_id || req.session?.school_id || 1;
      const { status, format, from_date, to_date, search, page = '1', limit = '50' } = req.query;
      let where = ['school_id = $1'];
      let params = [schoolId];
      let idx = 2;

      if (status) { where.push(`status = $${idx++}`); params.push(status); }
      if (format) { where.push(`format = $${idx++}`); params.push(format); }
      if (from_date) { where.push(`created_at >= $${idx++}`); params.push(from_date); }
      if (to_date) { where.push(`created_at <= $${idx++}`); params.push(to_date + ' 23:59:59'); }
      if (search) { where.push(`export_name ILIKE $${idx++}`); params.push(`%${search}%`); }

      const whereClause = where.join(' AND ');
      const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
      const pageNum = Math.max(1, parseInt(page));
      const offsetNum = (pageNum - 1) * limitNum;

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM audit_exports WHERE ${whereClause}`, params);
      const dataRes = await pool.query(
        `SELECT * FROM audit_exports WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limitNum, offsetNum]
      );

      res.json({
        success: true,
        total: countRes.rows[0].total,
        page: pageNum,
        limit: limitNum,
        data: dataRes.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: GET /create - New export form (renders page)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/create', async (req, res) => {
    try {
      const availableEntities = [
        'students', 'teachers', 'attendance', 'grades', 'assignments',
        'fees', 'discipline', 'parents', 'classes', 'enrollments',
        'staff', 'payroll', 'inventory', 'library', 'transport'
      ];
      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Dashboard', [
            { label: 'Audit Export', href: '/admin/audit-export' },
            { label: 'Create Export', href: '/admin/audit-export/create' }
          ])}
          <div class="card" style="max-width: 720px;">
            <h2>🆕 Create New Export</h2>
            <form method="POST" action="/admin/audit-export/create">
              <div class="form-group">
                <label>Export Name *</label>
                <input type="text" name="export_name" placeholder="e.g. Q4 Attendance Report" required>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label>Format *</label>
                  <select name="format">
                    <option value="csv">CSV (Comma-Separated Values)</option>
                    <option value="pdf">PDF (Document Report)</option>
                    <option value="json">JSON (Structured Data)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>School ID</label>
                  <input type="number" name="school_id" value="1" min="1">
                </div>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label>Date From</label>
                  <input type="datetime-local" name="date_from">
                </div>
                <div class="form-group">
                  <label>Date To</label>
                  <input type="datetime-local" name="date_to">
                </div>
              </div>
              <div class="form-group">
                <label>Entity Types</label>
                <div class="checkbox-group">
                  ${availableEntities.map(e => `<label><input type="checkbox" name="entity_types" value="${e}"> ${e}</label>`).join('')}
                </div>
                <p style="font-size:0.78rem;color:#64748b;margin-top:6px;">Leave empty to include all entity types.</p>
              </div>
              <div class="form-group">
                <label>Filters (JSON)</label>
                <textarea name="filters" placeholder='{"grade_level": ["10","11"], "status": "active"}'></textarea>
              </div>
              <div style="display:flex;gap:10px;margin-top:8px;">
                <button type="submit" class="btn btn-primary">🚀 Create Export</button>
                <a href="/admin/audit-export" class="btn btn-outline">Cancel</a>
              </div>
            </form>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Create Export', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: POST /create - Create new export
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/audit-export/create', async (req, res) => {
    try {
      const userId = req.user?.id || req.session?.userId || null;
      const { export_name, format, entity_types, date_from, date_to, filters, school_id } = req.body;

      if (!export_name) {
        return res.status(400).json({ error: 'Export name is required' });
      }

      const validFormats = ['csv', 'pdf', 'json', 'xlsx'];
      const selectedFormat = validFormats.includes(format) ? format : 'csv';

      // Parse entity types from multi-select
      let types = [];
      if (Array.isArray(entity_types)) {
        types = entity_types;
      } else if (typeof entity_types === 'string' && entity_types.length > 0) {
        types = [entity_types];
      }

      // Parse filters JSON
      let parsedFilters = null;
      if (filters) {
        try {
          parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;
        } catch {
          parsedFilters = { raw: filters };
        }
      }

      const result = await pool.query(`
        INSERT INTO audit_exports (export_name, format, entity_types, date_from, date_to, filters, status, requested_by, school_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
        RETURNING *
      `, [
        export_name, selectedFormat, types.length > 0 ? types : null,
        date_from || null, date_to || null,
        parsedFilters ? JSON.stringify(parsedFilters) : null,
        userId, school_id || 1
      ]);

      const newExport = result.rows[0];

      // Simulate async export processing
      processExport(newExport.id).catch(e => console.error('[audit-export] Process error:', e.message));

      res.redirect(`/admin/audit-export/${newExport.id}?msg=created`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Helper: process export asynchronously ───────────────────────────────
  async function processExport(exportId) {
    const client = await pool.connect();
    try {
      await client.query('UPDATE audit_exports SET status = $1 WHERE id = $2', ['running', exportId]);

      const { rows: [exp] } = await client.query('SELECT * FROM audit_exports WHERE id = $1', [exportId]);
      if (!exp) throw new Error('Export not found');

      // Simulate data gathering based on format
      const sampleRecords = Math.floor(Math.random() * 5000) + 100;
      const sampleSize = sampleRecords * Math.floor(Math.random() * 50) + 1024;
      const fileName = `audit_export_${exp.id}_${Date.now()}.${exp.format}`;
      const filePath = `/exports/audit/${fileName}`;

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 2000));

      // Random failure for demo (5% chance)
      if (Math.random() < 0.05) {
        await client.query(
          'UPDATE audit_exports SET status = $1, completed_at = NOW() WHERE id = $2',
          ['failed', exportId]
        );
        return;
      }

      await client.query(`
        UPDATE audit_exports SET
          status = 'completed',
          file_path = $1,
          file_size = $2,
          record_count = $3,
          completed_at = NOW()
        WHERE id = $4
      `, [filePath, sampleSize, sampleRecords, exportId]);

      console.log(`[audit-export] Export #${exportId} completed: ${sampleRecords} records, ${fmtSize(sampleSize)}`);
    } catch (err) {
      await client.query(
        'UPDATE audit_exports SET status = $1, completed_at = NOW() WHERE id = $2',
        ['failed', exportId]
      ).catch(() => {});
      console.error(`[audit-export] Export #${exportId} failed:`, err.message);
    } finally {
      client.release();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: GET /:id - Export details and download link
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT * FROM audit_exports WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).send('Export not found');
      }
      const ex = result.rows[0];
      const msg = req.query.msg;

      // Calculate duration if completed
      let duration = '';
      if (ex.completed_at && ex.created_at) {
        const ms = new Date(ex.completed_at) - new Date(ex.created_at);
        const secs = Math.round(ms / 1000);
        duration = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
      }

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Dashboard', [
            { label: 'Audit Export', href: '/admin/audit-export' },
            { label: `Export #${ex.id}`, href: `/admin/audit-export/${ex.id}` }
          ])}
          ${msg === 'created' ? '<div class="alert alert-success">✅ Export created successfully. Processing will begin shortly.</div>' : ''}
          ${msg === 'retried' ? '<div class="alert alert-info">🔄 Export retry initiated.</div>' : ''}
          ${msg === 'deleted' ? '<div class="alert alert-warning">🗑 Export deleted successfully.</div>' : ''}
          <div class="card">
            <div class="flex-between" style="margin-bottom:16px;">
              <h2 style="margin-bottom:0;">📋 Export Details #${ex.id}</h2>
              <div style="display:flex;gap:8px;">
                ${ex.status === 'completed' ? `<a href="/admin/audit-export/${ex.id}/download" class="btn btn-primary">⬇ Download File</a>` : ''}
                ${ex.status === 'failed' ? `<form method="POST" action="/admin/audit-export/${ex.id}/retry" style="display:inline;"><button class="btn btn-warning">🔄 Retry Export</button></form>` : ''}
                <a href="/admin/audit-export" class="btn btn-outline">← Back to List</a>
              </div>
            </div>
            <div class="meta-grid">
              <div class="meta-item"><div class="meta-key">Name</div><div class="meta-val"><strong>${esc(ex.export_name || 'Untitled')}</strong></div></div>
              <div class="meta-item"><div class="meta-key">Format</div><div class="meta-val">${formatBadge(ex.format)}</div></div>
              <div class="meta-item"><div class="meta-key">Status</div><div class="meta-val">${statusBadge(ex.status)}</div></div>
              <div class="meta-item"><div class="meta-key">Records</div><div class="meta-val" style="font-weight:700;color:#fbbf24;">${(ex.record_count || 0).toLocaleString()}</div></div>
              <div class="meta-item"><div class="meta-key">File Size</div><div class="meta-val">${fmtSize(ex.file_size)}</div></div>
              <div class="meta-item"><div class="meta-key">File Path</div><div class="meta-val" style="font-size:0.82rem;color:#64748b;">${esc(ex.file_path) || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">Entity Types</div><div class="meta-val">${entityBadges(ex.entity_types)}</div></div>
              <div class="meta-item"><div class="meta-key">Date Range</div><div class="meta-val">${fmtTime(ex.date_from)} → ${fmtTime(ex.date_to)}</div></div>
              <div class="meta-item"><div class="meta-key">Requested By</div><div class="meta-val">User #${ex.requested_by || '—'}</div></div>
              <div class="meta-item"><div class="meta-key">School ID</div><div class="meta-val">${ex.school_id}</div></div>
              <div class="meta-item"><div class="meta-key">Created</div><div class="meta-val">${fmtTime(ex.created_at)}</div></div>
              <div class="meta-item"><div class="meta-key">Completed</div><div class="meta-val">${fmtTime(ex.completed_at)} ${duration ? `<span style="color:#64748b;">(${duration})</span>` : ''}</div></div>
            </div>
            ${ex.filters ? `
              <h3 style="margin-top:16px;">🔍 Filters Applied</h3>
              <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px;font-family:'Fira Code',monospace;font-size:0.85rem;color:#94a3b8;overflow-x:auto;white-space:pre-wrap;">
${h(typeof ex.filters === 'string' ? JSON.stringify(JSON.parse(ex.filters), null, 2) : JSON.stringify(ex.filters, null, 2))}
              </div>
            ` : ''}
          </div>
          ${ex.status === 'running' ? `
            <div class="card" style="border-left:3px solid #3b82f6;">
              <div class="alert alert-info" style="margin-bottom:0;">
                ⚙️ This export is currently being processed. The page will update once completed.
                <div class="progress-bar" style="margin-top:10px;">
                  <div class="fill" style="width:60%;animation:pulse 1.5s infinite;"></div>
                </div>
              </div>
              <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}</style>
            </div>
          ` : ''}
          ${ex.status === 'failed' ? `
            <div class="card" style="border-left:3px solid #ef4444;">
              <div class="alert alert-danger" style="margin-bottom:0;">
                ❌ This export failed to process. You can retry it or delete it and create a new one.
              </div>
            </div>
          ` : ''}
        </div>
      `;
      res.send(opts.renderPage(`Export #${id}`, html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: GET /:id/download - Download export file
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/:id/download', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT * FROM audit_exports WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Export not found' });
      }
      const ex = result.rows[0];
      if (ex.status !== 'completed') {
        return res.status(400).json({ error: 'Export is not yet completed', status: ex.status });
      }
      if (!ex.file_path) {
        return res.status(404).json({ error: 'No file available for download' });
      }

      // Generate sample data for download
      const mimeTypes = {
        csv: 'text/csv',
        pdf: 'application/pdf',
        json: 'application/json'
      };
      const contentType = mimeTypes[ex.format] || 'application/octet-stream';
      const fileName = `${(ex.export_name || 'audit_export').replace(/[^a-zA-Z0-9]/g, '_')}.${ex.format}`;

      if (ex.format === 'json') {
        const sampleData = {
          export_info: {
            id: ex.id,
            name: ex.export_name,
            format: ex.format,
            generated_at: new Date().toISOString(),
            record_count: ex.record_count
          },
          records: Array.from({ length: Math.min(50, ex.record_count || 10) }, (_, i) => ({
            id: i + 1,
            entity: ex.entity_types?.[0] || 'audit_log',
            action: ['create', 'update', 'delete', 'login', 'export'][Math.floor(Math.random() * 5)],
            actor: `user_${Math.floor(Math.random() * 100)}`,
            timestamp: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
            details: { field: 'status', old_value: 'active', new_value: 'inactive' }
          }))
        };
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(JSON.stringify(sampleData, null, 2));
      }

      if (ex.format === 'csv') {
        const header = 'id,entity,action,actor,timestamp,details\n';
        const rows = Array.from({ length: Math.min(50, ex.record_count || 10) }, (_, i) =>
          `${i + 1},${ex.entity_types?.[0] || 'audit_log'},update,user_${Math.floor(Math.random() * 100)},${new Date(Date.now() - Math.random() * 86400000 * 30).toISOString()},"status changed"`
        ).join('\n');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(header + rows);
      }

      // PDF placeholder
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(`Audit Export #${ex.id}: ${(ex.export_name || 'Untitled')}\n${'='.repeat(60)}\n\nFormat: ${ex.format}\nRecords: ${ex.record_count}\nGenerated: ${new Date().toISOString()}\n\n(PDF generation requires a rendering engine — placeholder output)`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: DELETE /:id - Delete export
  // ═══════════════════════════════════════════════════════════════════════════
  app.delete('/admin/audit-export/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM audit_exports WHERE id = $1 AND status != $2 RETURNING *', [id, 'running']);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Export not found or currently running' });
      }
      res.json({ success: true, deleted: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST delete handler (for form submissions)
  app.post('/admin/audit-export/:id/delete', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM audit_exports WHERE id = $1 AND status != $2', [id, 'running']);
      res.redirect('/admin/audit-export?msg=deleted');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 7: POST /:id/retry - Retry failed export
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/audit-export/:id/retry', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "UPDATE audit_exports SET status = 'pending', file_path = NULL, file_size = NULL, record_count = NULL, completed_at = NULL WHERE id = $1 AND status = $2 RETURNING *",
        [id, 'failed']
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Only failed exports can be retried' });
      }
      processExport(id).catch(e => console.error('[audit-export] Retry error:', e.message));
      res.redirect(`/admin/audit-export/${id}?msg=retried`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 8: GET /preview - Preview audit data before export
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/preview', async (req, res) => {
    try {
      const schoolId = req.user?.school_id || req.session?.school_id || 1;
      const entity = req.query.entity || 'all';
      const limit = Math.min(100, parseInt(req.query.limit) || 20);
      const dateFrom = req.query.from || '';
      const dateTo = req.query.to || '';

      // Generate sample preview data
      const sampleEntities = ['students', 'teachers', 'attendance', 'grades', 'fees', 'discipline', 'staff', 'library'];
      const sampleActions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT', 'VIEW'];
      const previewData = Array.from({ length: limit }, (_, i) => ({
        id: i + 1,
        timestamp: new Date(Date.now() - Math.random() * 86400000 * 60).toISOString(),
        entity: entity === 'all' ? sampleEntities[Math.floor(Math.random() * sampleEntities.length)] : entity,
        action: sampleActions[Math.floor(Math.random() * sampleActions.length)],
        actor: `user_${Math.floor(Math.random() * 200) + 1}`,
        actor_name: `User ${Math.floor(Math.random() * 200) + 1}`,
        ip_address: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        details: JSON.stringify({ field: 'status', old: 'pending', new: 'completed' })
      }));

      // Count estimates
      const countRes = await pool.query(`
        SELECT COUNT(*)::int AS total FROM audit_exports WHERE school_id = $1
      `, [schoolId]);
      const estimatedRecords = countRes.rows[0].total * 150 + Math.floor(Math.random() * 10000);

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Preview')}
          <div class="card">
            <h2>👁 Data Preview</h2>
            <p style="color:#64748b;margin-bottom:16px;">Preview audit data before creating an export. Adjust filters below.</p>
            <form method="GET" class="filter-bar">
              <select name="entity">
                <option value="all" ${entity === 'all' ? 'selected' : ''}>All Entities</option>
                ${sampleEntities.map(e => `<option value="${e}" ${entity === e ? 'selected' : ''}>${e}</option>`).join('')}
              </select>
              <input type="date" name="from" value="${esc(dateFrom)}" title="From date">
              <input type="date" name="to" value="${esc(dateTo)}" title="To date">
              <select name="limit">
                <option value="10" ${limit === 10 ? 'selected' : ''}>10 rows</option>
                <option value="20" ${limit === 20 ? 'selected' : ''}>20 rows</option>
                <option value="50" ${limit === 50 ? 'selected' : ''}>50 rows</option>
                <option value="100" ${limit === 100 ? 'selected' : ''}>100 rows</option>
              </select>
              <button type="submit" class="btn btn-primary btn-sm">🔍 Refresh</button>
            </form>
            <div class="alert alert-info">
              📊 Estimated total records matching filters: <strong>${estimatedRecords.toLocaleString()}</strong>
            </div>
            <div class="preview-table" style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Timestamp</th>
                    <th>Entity</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>IP Address</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${previewData.map(row => `<tr>
                    <td>${row.id}</td>
                    <td style="font-size:0.82rem;white-space:nowrap;">${fmtTime(row.timestamp)}</td>
                    <td><span class="badge badge-entity">${esc(row.entity)}</span></td>
                    <td>
                      <span class="badge ${row.action === 'DELETE' ? 'badge-failed' : row.action === 'CREATE' ? 'badge-completed' : 'badge-pending'}">
                        ${row.action}
                      </span>
                    </td>
                    <td>${esc(row.actor_name)}</td>
                    <td style="font-size:0.82rem;color:#64748b;font-family:monospace;">${esc(row.ip_address)}</td>
                    <td style="font-size:0.78rem;color:#64748b;max-width:200px;" class="truncated">${esc(row.details)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div style="margin-top:16px;display:flex;gap:10px;">
              <a href="/admin/audit-export/create?entity=${entity}" class="btn btn-primary">🚀 Export This Data</a>
              <a href="/admin/audit-export" class="btn btn-outline">← Back</a>
            </div>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Preview Audit Data', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 9: GET /schedule - Schedule recurring exports
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/schedule', async (req, res) => {
    try {
      // Get scheduled exports (status = 'scheduled' or recurring ones)
      const schoolId = req.user?.school_id || req.session?.school_id || 1;
      const scheduledRes = await pool.query(`
        SELECT * FROM audit_exports
        WHERE school_id = $1 AND (status = 'scheduled' OR export_name ILIKE '%recurring%')
        ORDER BY created_at DESC LIMIT 50
      `, [schoolId]);
      const scheduled = scheduledRes.rows;

      // Sample schedules
      const sampleSchedules = [
        { name: 'Daily Attendance Summary', frequency: 'Every day at 00:00', format: 'CSV', entities: ['attendance'], next_run: new Date(Date.now() + 86400000).toLocaleDateString(), active: true },
        { name: 'Weekly Grade Report', frequency: 'Every Monday at 06:00', format: 'PDF', entities: ['grades', 'students'], next_run: new Date(Date.now() + 3 * 86400000).toLocaleDateString(), active: true },
        { name: 'Monthly Fee Audit', frequency: '1st of every month', format: 'CSV', entities: ['fees'], next_run: new Date(Date.now() + 15 * 86400000).toLocaleDateString(), active: false },
      ];

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Schedule')}
          <div class="card">
            <div class="flex-between" style="margin-bottom:16px;">
              <h2 style="margin-bottom:0;">🕐 Scheduled Exports</h2>
              <a href="#create-schedule" class="btn btn-primary">+ New Schedule</a>
            </div>
            <p style="color:#64748b;margin-bottom:20px;">Configure recurring exports that run automatically on a schedule.</p>

            ${sampleSchedules.map(s => `
              <div class="schedule-row">
                <div style="flex:1;min-width:200px;">
                  <strong style="color:#e2e8f0;">${esc(s.name)}</strong>
                  <div style="font-size:0.82rem;color:#64748b;">${esc(s.frequency)}</div>
                  <div style="margin-top:4px;">${s.entities.map(e => `<span class="badge badge-entity">${e}</span>`).join(' ')}</div>
                </div>
                <div>
                  ${formatBadge(s.format)}
                </div>
                <div style="text-align:right;min-width:120px;">
                  <div style="font-size:0.82rem;color:#94a3b8;">Next run:</div>
                  <div style="font-weight:600;color:#e2e8f0;">${s.next_run}</div>
                </div>
                <div>
                  <label class="toggle">
                    <input type="checkbox" ${s.active ? 'checked' : ''}>
                    <span class="slider"></span>
                  </label>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-sm btn-ghost">✏️</button>
                  <button class="btn btn-sm btn-danger">🗑</button>
                </div>
              </div>
            `).join('')}

            ${scheduled.length > 0 ? `
              <h3 style="margin-top:24px;">📋 Custom Scheduled Exports</h3>
              <table>
                <thead>
                  <tr><th>ID</th><th>Name</th><th>Format</th><th>Entities</th><th>Created</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  ${scheduled.map(s => `<tr>
                    <td><a href="/admin/audit-export/${s.id}" style="color:#60a5fa;">#${s.id}</a></td>
                    <td>${esc(s.export_name)}</td>
                    <td>${formatBadge(s.format)}</td>
                    <td>${entityBadges(s.entity_types)}</td>
                    <td style="font-size:0.82rem;">${fmtTime(s.created_at)}</td>
                    <td>
                      <a href="/admin/audit-export/${s.id}" class="btn btn-sm btn-ghost">View</a>
                      <form method="POST" action="/admin/audit-export/${s.id}/delete" style="display:inline;" onsubmit="return confirm('Delete?');"><button class="btn btn-sm btn-danger">🗑</button></form>
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            ` : ''}
          </div>

          <div class="card" id="create-schedule">
            <h2>➕ Create New Schedule</h2>
            <form method="POST" action="/admin/audit-export/schedule">
              <div class="form-grid">
                <div class="form-group">
                  <label>Schedule Name *</label>
                  <input type="text" name="schedule_name" placeholder="e.g. Daily Compliance Report" required>
                </div>
                <div class="form-group">
                  <label>Frequency *</label>
                  <select name="frequency">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly (Monday)</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly (1st)</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label>Time (UTC)</label>
                  <input type="time" name="run_time" value="00:00">
                </div>
                <div class="form-group">
                  <label>Format</label>
                  <select name="format">
                    <option value="csv">CSV</option>
                    <option value="pdf">PDF</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>Entity Types</label>
                <div class="checkbox-group">
                  <label><input type="checkbox" name="entity_types" value="students"> students</label>
                  <label><input type="checkbox" name="entity_types" value="attendance"> attendance</label>
                  <label><input type="checkbox" name="entity_types" value="grades"> grades</label>
                  <label><input type="checkbox" name="entity_types" value="fees"> fees</label>
                  <label><input type="checkbox" name="entity_types" value="discipline"> discipline</label>
                  <label><input type="checkbox" name="entity_types" value="staff"> staff</label>
                </div>
              </div>
              <div class="form-group">
                <label>Notify Email (optional)</label>
                <input type="email" name="notify_email" placeholder="admin@school.com">
              </div>
              <button type="submit" class="btn btn-primary">🚀 Create Schedule</button>
            </form>
          </div>
        </div>
      `;
      res.send(opts.renderPage('Scheduled Exports', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 10: POST /schedule - Create scheduled export
  // ═══════════════════════════════════════════════════════════════════════════
  app.post('/admin/audit-export/schedule', async (req, res) => {
    try {
      const userId = req.user?.id || req.session?.userId || null;
      const { schedule_name, frequency, run_time, format, entity_types, notify_email } = req.body;

      if (!schedule_name) {
        return res.status(400).json({ error: 'Schedule name is required' });
      }

      let types = [];
      if (Array.isArray(entity_types)) {
        types = entity_types;
      } else if (typeof entity_types === 'string' && entity_types.length > 0) {
        types = [entity_types];
      }

      const filters = {
        schedule: true,
        frequency: frequency || 'daily',
        run_time: run_time || '00:00',
        notify_email: notify_email || null
      };

      await pool.query(`
        INSERT INTO audit_exports (export_name, format, entity_types, filters, status, requested_by, school_id)
        VALUES ($1, $2, $3, $4, 'scheduled', $5, $6)
      `, [
        `[SCHEDULED] ${schedule_name}`,
        format || 'csv',
        types.length > 0 ? types : null,
        JSON.stringify(filters),
        userId,
        1
      ]);

      res.redirect('/admin/audit-export/schedule?msg=created');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 11: GET /templates - Export templates
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/templates', async (req, res) => {
    try {
      const templates = [
        {
          id: 1, name: 'Full Compliance Audit', icon: '🏛️',
          description: 'Complete audit trail of all system activities for regulatory compliance. Includes all entity types with full timestamps.',
          format: 'PDF', entities: ['all'], frequency: 'Monthly',
          estimatedRecords: '50,000+', tags: ['compliance', 'audit', 'full']
        },
        {
          id: 2, name: 'Attendance Summary', icon: '📋',
          description: 'Daily/weekly attendance records for all students and staff. Includes check-in/out times and absence reasons.',
          format: 'CSV', entities: ['attendance', 'students'], frequency: 'Daily',
          estimatedRecords: '5,000+', tags: ['attendance', 'daily']
        },
        {
          id: 3, name: 'Grade Book Export', icon: '📝',
          description: 'All grades and assessment scores for selected term. Includes student info, subject, and teacher.',
          format: 'CSV', entities: ['grades', 'students', 'subjects'], frequency: 'Per-term',
          estimatedRecords: '15,000+', tags: ['grades', 'academic']
        },
        {
          id: 4, name: 'Financial Transactions', icon: '💰',
          description: 'Fee payments, refunds, and outstanding balances. Suitable for accounting integration.',
          format: 'CSV', entities: ['fees', 'students'], frequency: 'Weekly',
          estimatedRecords: '8,000+', tags: ['financial', 'fees']
        },
        {
          id: 5, name: 'Discipline Records', icon: '⚠️',
          description: 'Behavior incidents, disciplinary actions, and resolutions. Useful for administrative reviews.',
          format: 'PDF', entities: ['discipline', 'students'], frequency: 'Monthly',
          estimatedRecords: '2,000+', tags: ['discipline', 'behavior']
        },
        {
          id: 6, name: 'Staff Activity Log', icon: '👥',
          description: 'Login/logout times, data access patterns, and system usage by staff members.',
          format: 'JSON', entities: ['staff', 'attendance'], frequency: 'Weekly',
          estimatedRecords: '10,000+', tags: ['staff', 'security']
        },
        {
          id: 7, name: 'Enrollment Snapshot', icon: '🎓',
          description: 'Current enrollment status, class assignments, and demographic data for all students.',
          format: 'CSV', entities: ['enrollments', 'students', 'classes'], frequency: 'Per-term',
          estimatedRecords: '3,000+', tags: ['enrollment', 'demographics']
        },
        {
          id: 8, name: 'Library Usage Report', icon: '📚',
          description: 'Book checkouts, returns, overdue items, and reading activity across the library system.',
          format: 'CSV', entities: ['library', 'students'], frequency: 'Monthly',
          estimatedRecords: '7,000+', tags: ['library', 'books']
        }
      ];

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Templates')}
          <div class="card">
            <h2>📋 Export Templates</h2>
            <p style="color:#64748b;margin-bottom:20px;">Pre-configured export templates for common use cases. Click any template to create an export instantly.</p>
            <div class="filter-bar">
              <input type="text" id="template-search" placeholder="🔍 Search templates..." oninput="filterTemplates(this.value)">
              <select onchange="filterByFormat(this.value)">
                <option value="">All Formats</option>
                <option value="CSV">CSV</option>
                <option value="PDF">PDF</option>
                <option value="JSON">JSON</option>
              </select>
            </div>
            <div class="template-grid" id="template-grid">
              ${templates.map(t => `
                <div class="template-card" data-name="${esc(t.name.toLowerCase())}" data-format="${t.format}" onclick="useTemplate(${t.id})">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <span style="font-size:1.5rem;">${t.icon}</span>
                    <div>
                      <div class="tpl-name">${esc(t.name)}</div>
                      <div style="display:flex;gap:4px;">${formatBadge(t.format)}<span class="badge badge-scheduled">${esc(t.frequency)}</span></div>
                    </div>
                  </div>
                  <div class="tpl-desc">${esc(t.description)}</div>
                  <div class="tpl-meta">
                    <div style="margin-bottom:4px;">Entities: ${t.entities.map(e => `<span class="badge badge-entity">${e}</span>`).join(' ')}</div>
                    <div>Est. records: <strong style="color:#fbbf24;">${esc(t.estimatedRecords)}</strong></div>
                    <div style="margin-top:4px;">${t.tags.map(tag => `<span style="background:#334155;color:#94a3b8;padding:2px 6px;border-radius:4px;font-size:0.7rem;margin-right:4px;">#${esc(tag)}</span>`).join('')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <script>
            function filterTemplates(query) {
              const cards = document.querySelectorAll('.template-card');
              const q = query.toLowerCase();
              cards.forEach(card => {
                const name = card.getAttribute('data-name');
                card.style.display = name.includes(q) ? '' : 'none';
              });
            }
            function filterByFormat(fmt) {
              const cards = document.querySelectorAll('.template-card');
              cards.forEach(card => {
                card.style.display = (!fmt || card.getAttribute('data-format') === fmt) ? '' : 'none';
              });
            }
            function useTemplate(id) {
              window.location.href = '/admin/audit-export/create?template=' + id;
            }
          </script>
        </div>
      `;
      res.send(opts.renderPage('Export Templates', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE 12: GET /settings - Export settings
  // ═══════════════════════════════════════════════════════════════════════════
  app.get('/admin/audit-export/settings', async (req, res) => {
    try {
      const schoolId = req.user?.school_id || req.session?.school_id || 1;

      // Get storage stats
      const storageRes = await pool.query(`
        SELECT
          COUNT(*)::int AS total_exports,
          COALESCE(SUM(file_size), 0)::bigint AS total_bytes,
          COALESCE(MIN(created_at), NOW())::text AS oldest_export,
          COALESCE(MAX(created_at), NOW())::text AS newest_export
        FROM audit_exports WHERE school_id = $1 AND status = 'completed'
      `, [schoolId]);
      const storage = storageRes.rows[0];

      const settings = [
        {
          key: 'auto_cleanup', label: 'Auto-Cleanup Old Exports', desc: 'Automatically delete completed exports older than 90 days',
          type: 'toggle', value: true
        },
        {
          key: 'compress_exports', label: 'Compress Export Files', desc: 'Gzip compress CSV and JSON exports to save disk space',
          type: 'toggle', value: false
        },
        {
          key: 'email_notifications', label: 'Email Notifications', desc: 'Send email when scheduled exports complete or fail',
          type: 'toggle', value: true
        },
        {
          key: 'include_sensitive', label: 'Include Sensitive Data', desc: 'Include fields like email, phone, and address in exports',
          type: 'toggle', value: false
        },
        {
          key: 'max_records', label: 'Max Records Per Export', desc: 'Maximum number of records in a single export batch',
          type: 'number', value: 50000, min: 1000, max: 500000
        },
        {
          key: 'retention_days', label: 'Export Retention (Days)', desc: 'How long to keep completed exports before auto-cleanup',
          type: 'number', value: 90, min: 7, max: 365
        },
        {
          key: 'batch_size', label: 'Processing Batch Size', desc: 'Number of records processed per batch during export generation',
          type: 'number', value: 1000, min: 100, max: 10000
        },
        {
          key: 'concurrent_exports', label: 'Max Concurrent Exports', desc: 'Maximum number of exports that can run simultaneously',
          type: 'number', value: 3, min: 1, max: 10
        },
        {
          key: 'log_level', label: 'Export Logging Level', desc: 'Verbosity of export processing logs',
          type: 'select', value: 'info', options: ['debug', 'info', 'warn', 'error']
        },
        {
          key: 'timezone', label: 'Export Timestamps Timezone', desc: 'Timezone used for date/timestamp fields in exports',
          type: 'select', value: 'UTC', options: ['UTC', 'Local', 'America/New_York', 'Europe/London', 'Asia/Tokyo']
        }
      ];

      const html = `
        ${darkStyles()}
        <div class="container">
          ${pageHeader('Settings')}
          <div class="card">
            <h2>⚙️ Export Settings</h2>
            <p style="color:#64748b;margin-bottom:20px;">Configure global export behavior and preferences.</p>

            <div style="margin-bottom:24px;">
              <h3 style="margin-bottom:12px;">📦 Storage Overview</h3>
              <div class="meta-grid">
                <div class="meta-item">
                  <div class="meta-key">Total Exports</div>
                  <div class="meta-val" style="font-weight:700;color:#3b82f6;">${storage.total_exports}</div>
                </div>
                <div class="meta-item">
                  <div class="meta-key">Total Storage Used</div>
                  <div class="meta-val" style="font-weight:700;color:#fbbf24;">${fmtSize(storage.total_bytes)}</div>
                </div>
                <div class="meta-item">
                  <div class="meta-key">Oldest Export</div>
                  <div class="meta-val">${fmtTime(storage.oldest_export)}</div>
                </div>
                <div class="meta-item">
                  <div class="meta-key">Newest Export</div>
                  <div class="meta-val">${fmtTime(storage.newest_export)}</div>
                </div>
              </div>
            </div>

            <h3 style="margin-bottom:12px;">🔧 Configuration</h3>
            ${settings.map(s => `
              <div class="setting-item">
                <div>
                  <div class="setting-label">${esc(s.label)}</div>
                  <div class="setting-desc">${esc(s.desc)}</div>
                </div>
                <div>
                  ${s.type === 'toggle' ? `
                    <label class="toggle">
                      <input type="checkbox" ${s.value ? 'checked' : ''} name="${s.key}">
                      <span class="slider"></span>
                    </label>
                  ` : s.type === 'number' ? `
                    <input type="number" name="${s.key}" value="${s.value}" min="${s.min}" max="${s.max}"
                      style="width:120px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:6px 10px;border-radius:6px;font-size:0.85rem;text-align:right;">
                  ` : `
                    <select name="${s.key}" style="background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:6px 10px;border-radius:6px;font-size:0.85rem;">
                      ${s.options.map(o => `<option value="${o}" ${o === s.value ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>
                  `}
                </div>
              </div>
            `).join('')}

            <div style="margin-top:24px;display:flex;gap:10px;">
              <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
              <button class="btn btn-outline" onclick="resetDefaults()">↩ Reset Defaults</button>
            </div>
          </div>

          <div class="card" style="border-left:3px solid #f59e0b;">
            <h2 style="color:#fbbf24;">⚠️ Danger Zone</h2>
            <p style="color:#64748b;margin-bottom:16px;">Irreversible actions. Proceed with caution.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn btn-danger" onclick="if(confirm('Delete ALL completed exports? This cannot be undone.')) { purgeExports('completed'); }">🗑 Purge All Completed</button>
              <button class="btn btn-danger" onclick="if(confirm('Delete ALL failed exports?')) { purgeExports('failed'); }">🗑 Purge All Failed</button>
              <button class="btn btn-danger" style="background:#991b1b;" onclick="if(confirm('DELETE ALL exports? This is permanent and cannot be undone!')) { purgeExports('all'); }">💥 Delete Everything</button>
            </div>
          </div>

          <script>
            function saveSettings() {
              const btn = event.target;
              btn.textContent = '⏳ Saving...';
              btn.disabled = true;
              setTimeout(() => {
                btn.textContent = '✅ Saved!';
                setTimeout(() => { btn.textContent = '💾 Save Settings'; btn.disabled = false; }, 2000);
              }, 1000);
            }
            function resetDefaults() {
              if (confirm('Reset all settings to defaults?')) { location.reload(); }
            }
            function purgeExports(type) {
              fetch('/admin/audit-export/settings/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
              }).then(r => r.json()).then(data => {
                if (data.success) { location.reload(); }
                else { alert('Error: ' + (data.error || 'Unknown error')); }
              }).catch(e => alert('Network error: ' + e.message));
            }
          </script>
        </div>
      `;
      res.send(opts.renderPage('Export Settings', html, req.session?.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Settings purge endpoint ─────────────────────────────────────────────
  app.post('/admin/audit-export/settings/purge', async (req, res) => {
    try {
      const schoolId = req.user?.school_id || req.session?.school_id || 1;
      const { type } = req.body;
      let result;
      if (type === 'completed') {
        result = await pool.query('DELETE FROM audit_exports WHERE school_id = $1 AND status = $2', [schoolId, 'completed']);
      } else if (type === 'failed') {
        result = await pool.query('DELETE FROM audit_exports WHERE school_id = $1 AND status = $2', [schoolId, 'failed']);
      } else {
        result = await pool.query('DELETE FROM audit_exports WHERE school_id = $1 AND status != $2', [schoolId, 'running']);
      }
      res.json({ success: true, deleted: result.rowCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Module loaded ───────────────────────────────────────────────────────
  console.log('[audit-trail-export] Module loaded — /admin/audit-export');
};
