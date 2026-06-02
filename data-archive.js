/**
 * School SaaS Portal — Data Archive & Management Module
 * Features: archival, soft-delete recovery (recycle bin), backup versioning,
 *           audit trail export, retention management, global search.
 */

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const who = (req) => req.session?.user?.email || 'system';
  const prefix = '/school/data-management';

  // ─── Inline CSS ──────────────────────────────────────────────
  const CSS = `
    <style>
      :root{--pri:#4f46e5;--pri-light:#e0e7ff;--pri-dark:#3730a3;--bg:#f8fafc;--card:#fff;
        --txt:#1e293b;--txt2:#64748b;--border:#e2e8f0;--danger:#dc2626;--success:#16a34a;--warn:#d97706;}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--txt);line-height:1.6}
      .wrap{max-width:1200px;margin:0 auto;padding:20px}
      h1{font-size:1.75rem;font-weight:700;margin-bottom:4px}
      h2{font-size:1.25rem;font-weight:600;margin:24px 0 12px}
      .subtitle{color:var(--txt2);margin-bottom:20px}
      .tabs{display:flex;gap:4px;border-bottom:2px solid var(--border);margin-bottom:24px;flex-wrap:wrap}
      .tabs a{padding:10px 18px;text-decoration:none;color:var(--txt2);font-weight:500;border-radius:8px 8px 0 0;transition:.2s}
      .tabs a:hover{background:var(--pri-light);color:var(--pri)}
      .tabs a.active{background:var(--pri);color:#fff}
      .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:28px}
      .stat-card{background:var(--card);border-radius:12px;padding:20px;border:1px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .stat-card .num{font-size:2rem;font-weight:700;color:var(--pri)}
      .stat-card .label{color:var(--txt2);font-size:.9rem}
      .stat-card .icon{float:right;font-size:1.5rem;opacity:.3}
      table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border);font-size:.9rem}
      th{background:var(--pri-light);color:var(--pri-dark);font-weight:600;white-space:nowrap}
      tr:hover td{background:#f1f5f9}
      .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600}
      .badge-info{background:#dbeafe;color:#1d4ed8}
      .badge-warn{background:#fef3c7;color:#92400e}
      .badge-danger{background:#fee2e2;color:#991b1b}
      .badge-success{background:#dcfce7;color:#166534}
      .btn{display:inline-block;padding:8px 16px;border-radius:8px;font-size:.875rem;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:.2s}
      .btn-pri{background:var(--pri);color:#fff}.btn-pri:hover{background:var(--pri-dark)}
      .btn-danger{background:var(--danger);color:#fff}.btn-danger:hover{background:#b91c1c}
      .btn-success{background:var(--success);color:#fff}.btn-success:hover{background:#15803d}
      .btn-outline{background:transparent;border:1px solid var(--border);color:var(--txt)}.btn-outline:hover{background:var(--pri-light)}
      .btn-sm{padding:5px 12px;font-size:.8rem}
      .form-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
      .form-row label{font-weight:500;font-size:.9rem}
      input,select{padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:.9rem;outline:none;transition:.2s}
      input:focus,select:focus{border-color:var(--pri);box-shadow:0 0 0 3px var(--pri-light)}
      .preview{background:#f1f5f9;border-radius:8px;padding:10px 14px;font-family:monospace;font-size:.82rem;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .empty-state{text-align:center;padding:48px 20px;color:var(--txt2)}
      .empty-state .icon{font-size:3rem;margin-bottom:12px;opacity:.4}
      .toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:10px;color:#fff;font-weight:600;z-index:9999;animation:fadeIn .3s}
      .toast-success{background:var(--success)}.toast-error{background:var(--danger)}
      @keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
      .progress-bar{height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-top:6px}
      .progress-bar .fill{height:100%;background:var(--pri);border-radius:4px;transition:width .4s}
      .meta{font-size:.8rem;color:var(--txt2)}
      .card{background:var(--card);border-radius:12px;padding:20px;border:1px solid var(--border);box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:16px}
      .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .detail-row{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)}
      .detail-row:last-child{border-bottom:none}
      .detail-label{font-weight:600;color:var(--txt2);min-width:120px;font-size:.85rem}
      .detail-value{font-size:.9rem}
      .highlight{background:var(--pri-light);border-radius:6px;padding:2px 6px}
      @media(max-width:768px){.grid-2{grid-template-columns:1fr}}
      @media(max-width:640px){.stats{grid-template-columns:1fr}th,td{padding:8px 10px;font-size:.82rem}.tabs a{padding:8px 12px;font-size:.82rem}}
    </style>`;

  // ─── Tab Helper ──────────────────────────────────────────────
  const tabs = (active) => {
    const items = [
      ['/','Dashboard'],['/recycle-bin','Recycle Bin'],['/archives','Archives'],
      ['/backups','Backups'],['/audit-export','Audit Export'],['/retention','Retention']
    ];
    return `<div class="tabs">${items.map(([href,label]) =>
      `<a href="${prefix}${href}" class="${active===label?'active':''}">${label}</a>`).join('')}</div>`;
  };

  // ─── Migrations (async IIFE) ─────────────────────────────────
  (async () => {
    const ddl = `
      CREATE TABLE IF NOT EXISTS data_recycle_bin (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, table_name VARCHAR(100),
        record_id INT, record_data JSONB, deleted_by VARCHAR(255),
        deleted_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
      );
      CREATE TABLE IF NOT EXISTS data_archives (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, table_name VARCHAR(100),
        record_ids JSONB, archived_data JSONB, archived_by VARCHAR(255),
        record_count INT DEFAULT 0, archived_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS data_backup_points (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255),
        description TEXT, table_counts JSONB, table_sizes JSONB,
        created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS data_retention_log (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, table_name VARCHAR(100),
        records_purged INT DEFAULT 0, policy_rule TEXT,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rb_tenant ON data_recycle_bin(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ar_tenant ON data_archives(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_bp_tenant ON data_backup_points(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_rl_tenant ON data_retention_log(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_rb_expires ON data_recycle_bin(expires_at);
    `;
    await migrateQuery(pool, 'DataArchive', ddl);
    console.log('[data-archive] Tables ready');
  })().catch(e => console.error('[data-archive] Migration error:', e.message));

  // ─── 1. Dashboard ────────────────────────────────────────────
  app.get(prefix, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [[rc], [bc], [ac], recent] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM data_recycle_bin WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_backup_points WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_archives WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT 'recycle' AS type, table_name AS tbl, deleted_at AS ts, deleted_by AS actor
        FROM data_recycle_bin WHERE tenant_id=$1 ORDER BY deleted_at DESC LIMIT 8
        UNION ALL
        SELECT 'archive', table_name, archived_at, archived_by FROM data_archives WHERE tenant_id=$1 ORDER BY archived_at DESC LIMIT 8
        ORDER BY ts DESC LIMIT 10`, [tid, tid])
    ]);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>📦 Data Management</h1>
        <p class="subtitle">Archive, recover &amp; manage your school data lifecycle</p>
        ${tabs('Dashboard')}
        <div class="stats">
          <div class="stat-card"><span class="icon">♻️</span><div class="num">${rc.n}</div><div class="label">Recycle Bin Items</div></div>
          <div class="stat-card"><span class="icon">🗄️</span><div class="num">${ac.n}</div><div class="label">Archived Records</div></div>
          <div class="stat-card"><span class="icon">💾</span><div class="num">${bc.n}</div><div class="label">Backup Points</div></div>
          <div class="stat-card"><span class="icon">📊</span><div class="num">${rc.n+ac.n}</div><div class="label">Total Managed Records</div></div>
        </div>
        <div class="card" style="margin-bottom:20px">
          <h2 style="margin:0 0 12px">Quick Actions</h2>
          <div class="form-row" style="margin-bottom:0">
            <a href="${prefix}/search" class="btn btn-pri">🔍 Global Search</a>
            <a href="${prefix}/archives" class="btn btn-outline">🗄️ Browse Archives</a>
            <form method="POST" action="${prefix}/recycle-bin/empty" style="display:inline"
              onsubmit="return confirm('Empty entire recycle bin? This cannot be undone.')">
              <button class="btn btn-danger btn-sm">🗑 Empty Recycle Bin</button></form>
            <a href="${prefix}/audit-export" class="btn btn-outline btn-sm">⬇ Export Audit Trail</a>
          </div>
        </div>
        <h2>Recent Activity</h2>
        ${recent.rows.length ? `<table><tr><th>Type</th><th>Table</th><th>Timestamp</th><th>Actor</th></tr>
          ${recent.rows.map(r => `<tr><td><span class="badge ${r.type==='recycle'?'badge-warn':'badge-info'}">${r.type}</span></td>
            <td>${esc(r.tbl)}</td><td>${r.ts?.toLocaleString?.()||r.ts}</td><td>${esc(r.actor)}</td></tr>`).join('')}
        </table>` : '<div class="empty-state"><div class="icon">📋</div><p>No recent activity</p></div>'}
      </div>`;
    res.send(renderPage('Data Management', body, req.session?.user));
  }));

  // ─── 2. Recycle Bin List ─────────────────────────────────────
  app.get(`${prefix}/recycle-bin`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tbl = req.query.table || '';
    let q = 'SELECT * FROM data_recycle_bin WHERE tenant_id=$1';
    const p = [tid];
    if (tbl) { q += ' AND table_name ILIKE $2'; p.push(`%${tbl}%`); }
    q += ' ORDER BY deleted_at DESC LIMIT 100';
    const { rows } = await pool.query(q, p);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>♻️ Recycle Bin</h1><p class="subtitle">Soft-deleted records awaiting restore or permanent purge</p>
        ${tabs('Recycle Bin')}
        <form method="GET" class="form-row">
          <input name="table" value="${esc(tbl)}" placeholder="Filter by table name...">
          <button class="btn btn-pri btn-sm" type="submit">Filter</button>
          <a href="${prefix}/recycle-bin" class="btn btn-outline btn-sm">Clear</a>
        </form>
        ${rows.length ? `
        <table>
          <tr><th>ID</th><th>Table</th><th>Record ID</th><th>Data Preview</th><th>Deleted By</th><th>Deleted At</th><th>Expires</th><th>Actions</th></tr>
          ${rows.map(r => `<tr>
            <td>${r.id}</td><td><span class="badge badge-info">${esc(r.table_name)}</span></td><td>${r.record_id||'—'}</td>
            <td><div class="preview" title="${esc(JSON.stringify(r.record_data||{}))}">${esc(JSON.stringify(r.record_data||{}).slice(0,60))}…</div></td>
            <td>${esc(r.deleted_by)}</td><td class="meta">${r.deleted_at?.toLocaleString?.()||r.deleted_at}</td>
            <td class="meta">${r.expires_at?.toLocaleDateString?.()||r.expires_at}</td>
            <td>
              <form method="POST" action="${prefix}/recycle-bin/${r.id}/restore" style="display:inline">
                <button class="btn btn-success btn-sm">↩ Restore</button></form>
              <form method="POST" action="${prefix}/recycle-bin/${r.id}/purge" style="display:inline" onsubmit="return confirm('Permanently delete this record?')">
                <button class="btn btn-danger btn-sm">🗑 Purge</button></form>
            </td></tr>`).join('')}
        </table>` : '<div class="empty-state"><div class="icon">♻️</div><p>Recycle bin is empty</p></div>'}
      </div>`;
    res.send(renderPage('Recycle Bin', body, req.session?.user));
  }));

  // ─── 3. Restore Record ───────────────────────────────────────
  app.post(`${prefix}/recycle-bin/:id/restore`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { rows: [rec] } = await pool.query(
      'SELECT * FROM data_recycle_bin WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rec) return res.status(404).send('Record not found in recycle bin');
    const data = rec.record_data || {};
    const cols = Object.keys(data).filter(k => k !== 'id');
    if (cols.length) {
      const setClauses = cols.map(c => `"${c}" = $${cols.indexOf(c)+2}`).join(', ');
      await pool.query(
        `INSERT INTO "${rec.table_name}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map((_,i)=>`$${i+2}`).join(',')})
         ON CONFLICT DO NOTHING
         SET ${setClauses}`, [rec.record_id, ...cols.map(c => data[c])]);
    }
    await pool.query('DELETE FROM data_recycle_bin WHERE id=$1', [id]);
    audit('restore_from_recycle_bin', { table: rec.table_name, recordId: rec.record_id }, req);
    res.redirect(`${prefix}/recycle-bin?msg=restored`);
  }));

  // ─── 4. Purge Record ─────────────────────────────────────────
  app.post(`${prefix}/recycle-bin/:id/purge`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { rows: [rec] } = await pool.query(
      'SELECT * FROM data_recycle_bin WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!rec) return res.status(404).send('Record not found');
    await pool.query('DELETE FROM data_recycle_bin WHERE id=$1', [id]);
    audit('purge_from_recycle_bin', { table: rec.table_name, recordId: rec.record_id }, req);
    res.redirect(`${prefix}/recycle-bin?msg=purged`);
  }));

  // ─── 5. Empty Recycle Bin ────────────────────────────────────
  app.post(`${prefix}/recycle-bin/empty`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rowCount } = await pool.query(
      'DELETE FROM data_recycle_bin WHERE tenant_id=$1', [tid]);
    audit('empty_recycle_bin', { purgedCount: rowCount }, req);
    res.redirect(`${prefix}/recycle-bin?msg=emptied`);
  }));

  // ─── 6. Archives Browse ──────────────────────────────────────
  app.get(`${prefix}/archives`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tbl = req.query.table || '', from = req.query.from || '', to = req.query.to || '', search = req.query.search || '';
    let q = 'SELECT * FROM data_archives WHERE tenant_id=$1';
    const p = [tid], c = 2;
    if (tbl) { q += ` AND table_name ILIKE $${c++}`; p.push(`%${tbl}%`); }
    if (from) { q += ` AND archived_at >= $${c++}`; p.push(from); }
    if (to) { q += ` AND archived_at <= $${c++}`; p.push(to + ' 23:59:59'); }
    if (search) { q += ` AND (archived_data::text ILIKE $${c++} OR table_name ILIKE $${c++})`; p.push(`%${search}%`,`%${search}%`); }
    q += ' ORDER BY archived_at DESC LIMIT 100';
    const { rows } = await pool.query(q, p);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>🗄️ Data Archives</h1><p class="subtitle">Browse and manage archived records across tables</p>
        ${tabs('Archives')}
        <form method="GET" class="form-row">
          <input name="table" value="${esc(tbl)}" placeholder="Table name">
          <input name="from" type="date" value="${esc(from)}" title="From date">
          <input name="to" type="date" value="${esc(to)}" title="To date">
          <input name="search" value="${esc(search)}" placeholder="Search data...">
          <button class="btn btn-pri btn-sm" type="submit">Search</button>
        </form>
        ${rows.length ? `<table>
          <tr><th>ID</th><th>Table</th><th>Records</th><th>Data Preview</th><th>Archived By</th><th>Date</th></tr>
          ${rows.map(r => `<tr><td>${r.id}</td><td><span class="badge badge-info">${esc(r.table_name)}</span></td>
            <td>${r.record_count}</td>
            <td><div class="preview">${esc(JSON.stringify(r.archived_data||{}).slice(0,80))}…</div></td>
            <td>${esc(r.archived_by)}</td>
            <td class="meta">${r.archived_at?.toLocaleString?.()||r.archived_at}</td></tr>`).join('')}
        </table>` : '<div class="empty-state"><div class="icon">🗄️</div><p>No archived records found</p></div>'}
      </div>`;
    res.send(renderPage('Archives', body, req.session?.user));
  }));

  // ─── 7. Archive Records ──────────────────────────────────────
  app.post(`${prefix}/archive`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), user = who(req);
    const { table_name, record_ids } = req.body;
    if (!table_name || !record_ids) return res.status(400).send('table_name and record_ids are required');
    const ids = String(record_ids).split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).send('No valid record IDs provided');
    // Fetch records from the source table
    const { rows } = await pool.query(
      `SELECT * FROM "${table_name}" WHERE id = ANY($1)`, [ids]);
    if (!rows.length) return res.status(404).send('No records found in source table');
    await pool.query(
      `INSERT INTO data_archives (tenant_id, table_name, record_ids, archived_data, archived_by, record_count)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, table_name, JSON.stringify(ids), JSON.stringify(rows), user, rows.length]);
    audit('archive_records', { table: table_name, count: rows.length, ids }, req);
    res.redirect(`${prefix}/archives?msg=archived`);
  }));

  // ─── 8. Backup History ───────────────────────────────────────
  app.get(`${prefix}/backups`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { rows } = await pool.query(
      'SELECT * FROM data_backup_points WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tid]);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>💾 Backup Points</h1><p class="subtitle">Manual backup snapshots with table counts and sizes</p>
        ${tabs('Backups')}
        <form method="POST" action="${prefix}/backups/create" class="form-row">
          <input name="name" placeholder="Backup name (e.g. Pre-term-start)" required>
          <input name="description" placeholder="Description (optional)">
          <button class="btn btn-pri btn-sm" type="submit">➕ Create Backup</button>
        </form>
        ${rows.length ? `<table>
          <tr><th>ID</th><th>Name</th><th>Description</th><th>Table Counts</th><th>Created By</th><th>Date</th><th>Actions</th></tr>
          ${rows.map(r => {
            const tc = r.table_counts || {};
            const totalRecs = Object.values(tc).reduce((a,b) => a + (Number(b)||0), 0);
            return `<tr><td>${r.id}</td><td><strong>${esc(r.name)}</strong></td>
              <td class="meta">${esc(r.description||'—')}</td>
              <td>${Object.entries(tc).map(([t,c]) => `${t}: ${c}`).join('<br>')}<br><small class="meta">Total: ${totalRecs}</small></td>
              <td>${esc(r.created_by)}</td><td class="meta">${r.created_at?.toLocaleString?.()||r.created_at}</td>
              <td><form method="POST" action="${prefix}/backups/${r.id}/restore" style="display:inline">
                <button class="btn btn-outline btn-sm">📋 Details</button></form></td></tr>`;
          }).join('')}
        </table>` : '<div class="empty-state"><div class="icon">💾</div><p>No backups created yet</p></div>'}
      </div>`;
    res.send(renderPage('Backups', body, req.session?.user));
  }));

  // ─── 9. Create Backup ────────────────────────────────────────
  app.post(`${prefix}/backups/create`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), user = who(req);
    const { name, description } = req.body;
    if (!name) return res.status(400).send('Backup name is required');
    // Snapshot record counts for known school tables
    const tables = ['students','teachers','classes','assignments','grades','attendance','fees','parents','subjects','enrollments'];
    const counts = {}, sizes = {};
    for (const t of tables) {
      try {
        const { rows: [{c}] } = await pool.query(
          `SELECT COUNT(*)::int AS c FROM "${t}" LIMIT 1`, []);
        if (c > 0) counts[t] = c;
        const { rows: [{s}] } = await pool.query(
          `SELECT pg_total_relation_size('"${t}"')::bigint AS s`, []);
        sizes[t] = s || 0;
      } catch { /* table may not exist */ }
    }
    await pool.query(
      `INSERT INTO data_backup_points (tenant_id, name, description, table_counts, table_sizes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, name, description, JSON.stringify(counts), JSON.stringify(sizes), user]);
    audit('create_backup', { name, tables: Object.keys(counts) }, req);
    res.redirect(`${prefix}/backups?msg=created`);
  }));

  // ─── 10. Backup Details / Restore Info ───────────────────────
  app.post(`${prefix}/backups/:id/restore`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { rows: [bp] } = await pool.query(
      'SELECT * FROM data_backup_points WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!bp) return res.status(404).send('Backup not found');
    const current = {};
    const tables = Object.keys(bp.table_counts || {});
    for (const t of tables) {
      try {
        const { rows: [{c}] } = await pool.query(`SELECT COUNT(*)::int AS c FROM "${t}" LIMIT 1`, []);
        current[t] = c;
      } catch { current[t] = 'N/A'; }
    }
    const changes = tables.map(t => {
      const then = bp.table_counts[t], now = current[t];
      const diff = typeof now === 'number' ? now - then : 0;
      const cls = diff > 0 ? 'badge-success' : diff < 0 ? 'badge-danger' : 'badge-info';
      const label = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0';
      return { table: t, then, now, diff, cls, label };
    });
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>📋 Backup: ${esc(bp.name)}</h1><p class="subtitle">${esc(bp.description||'No description')}</p>
        ${tabs('Backups')}
        <div class="card">
          <p><strong>Created:</strong> ${bp.created_at?.toLocaleString?.()||bp.created_at} &nbsp;|&nbsp;
            <strong>By:</strong> ${esc(bp.created_by)}</p>
        </div>
        <h2>Table Comparison (Then vs Now)</h2>
        <table>
          <tr><th>Table</th><th>At Backup</th><th>Current</th><th>Change</th></tr>
          ${changes.map(c => `<tr><td><span class="badge badge-info">${esc(c.table)}</span></td>
            <td>${c.then}</td><td>${c.now}</td>
            <td><span class="badge ${c.cls}">${c.label}</span></td></tr>`).join('')}
        </table>
        <div class="form-row" style="margin-top:20px">
          <a href="${prefix}/backups" class="btn btn-outline">← Back to Backups</a>
        </div>
        <div class="card" style="margin-top:20px;border-left:4px solid var(--warn)">
          <p><strong>⚠️ Note:</strong> Restore from backup is informational only. This shows what changed
          since the backup point. Contact your administrator for a full data restoration.</p>
        </div>
      </div>`;
    res.send(renderPage('Backup Details', body, req.session?.user));
  }));

  // ─── 11. Audit Export Page ───────────────────────────────────
  app.get(`${prefix}/audit-export`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    // Get retention logs as recent audit data
    const { rows: logs } = await pool.query(
      'SELECT * FROM data_retention_log WHERE tenant_id=$1 ORDER BY executed_at DESC LIMIT 50', [tid]);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>📝 Audit Export</h1><p class="subtitle">Export data management audit trails</p>
        ${tabs('Audit Export')}
        <form method="POST" action="${prefix}/audit-export/generate" class="form-row">
          <label>From</label><input name="from" type="date">
          <label>To</label><input name="to" type="date">
          <label>Format</label>
          <select name="format">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button class="btn btn-pri btn-sm" type="submit">⬇ Generate & Download</button>
        </form>
        <h2>Recent Retention Logs</h2>
        ${logs.length ? `<table>
          <tr><th>ID</th><th>Table</th><th>Purged</th><th>Policy</th><th>Executed At</th></tr>
          ${logs.map(l => `<tr><td>${l.id}</td><td><span class="badge badge-info">${esc(l.table_name)}</span></td>
            <td>${l.records_purged}</td><td>${esc(l.policy_rule||'—')}</td>
            <td class="meta">${l.executed_at?.toLocaleString?.()||l.executed_at}</td></tr>`).join('')}
        </table>` : '<div class="empty-state"><div class="icon">📝</div><p>No retention logs available</p></div>'}
      </div>`;
    res.send(renderPage('Audit Export', body, req.session?.user));
  }));

  // ─── 12. Generate Audit CSV / JSON ───────────────────────────
  app.post(`${prefix}/audit-export/generate`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { from, to, format } = req.body;
    // Combine recycle bin + archives + retention log as audit trail
    const p = [tid]; let c = 2;
    let rbQ = 'SELECT id, table_name, deleted_by AS actor, deleted_at AS ts, \'deleted\' AS action FROM data_recycle_bin WHERE tenant_id=$1';
    let arQ = 'SELECT id, table_name, archived_by AS actor, archived_at AS ts, \'archived\' AS action FROM data_archives WHERE tenant_id=$1';
    let rlQ = 'SELECT id, table_name, policy_rule AS actor, executed_at AS ts, \'purged\' AS action FROM data_retention_log WHERE tenant_id=$1';
    if (from) { rbQ += ` AND deleted_at >= $${c}`; arQ += ` AND archived_at >= $${c}`; rlQ += ` AND executed_at >= $${c}`; p.push(from); c++; }
    if (to) { rbQ += ` AND deleted_at <= $${c}`; arQ += ` AND archived_at <= $${c}`; rlQ += ` AND executed_at <= $${c}`; p.push(to+'T23:59:59'); c++; }
    const allQ = `(${rbQ}) UNION ALL (${arQ}) UNION ALL (${rlQ}) ORDER BY ts DESC LIMIT 10000`;
    const { rows } = await pool.query(allQ, p);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.json"');
      res.send(JSON.stringify(rows, null, 2));
    } else {
      const header = 'ID,Table,Action,Actor,Timestamp';
      const csv = [header, ...rows.map(r =>
        `${r.id},"${r.table_name}","${r.action}","${(r.actor||'').replace(/"/g,'""')}","${r.ts}"`)].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-trail.csv"');
      res.send(csv);
    }
    audit('export_audit_trail', { format, count: rows.length, from, to }, req);
  }));

  // ─── 13. Retention Policy Status ─────────────────────────────
  app.get(`${prefix}/retention`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    // Retention rules config (could come from DB — hardcoded here)
    const policies = [
      { table: 'data_recycle_bin', rule: 'auto-purge after 30 days', interval: '30d' },
      { table: 'data_archives', rule: 'keep 365 days', interval: '365d' },
      { table: 'data_retention_log', rule: 'keep 90 days', interval: '90d' },
    ];
    const statuses = [];
    for (const pol of policies) {
      try {
        const { rows: [{cnt}] } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM "${pol.table}" WHERE tenant_id=$1`, [tid]);
        const aging = await pool.query(
          `SELECT COUNT(*)::int AS expired FROM "${pol.table}" WHERE tenant_id=$1 AND expires_at < NOW()`, [tid]);
        const expiredCount = aging.rows[0]?.expired || 0;
        const cap = pol.interval === '30d' ? 500 : pol.interval === '365d' ? 5000 : 2000;
        const pct = Math.min(100, Math.round((cnt / cap) * 100));
        statuses.push({ ...pol, count: cnt, expired: expiredCount, cap, pct });
      } catch { statuses.push({ ...pol, count: 0, expired: 0, cap: 0, pct: 0 }); }
    }
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>⏱️ Retention Management</h1><p class="subtitle">View retention policy status and capacity per data table</p>
        ${tabs('Retention')}
        ${statuses.map(s => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div>
                <strong>${esc(s.table)}</strong>
                <span class="badge badge-info" style="margin-left:8px">${esc(s.rule)}</span>
              </div>
              <div style="text-align:right">
                <span style="font-weight:700;color:var(--pri)">${s.count}</span>
                <span class="meta"> / ${s.cap} records</span>
              </div>
            </div>
            <div class="progress-bar"><div class="fill" style="width:${s.pct}%;${s.pct>80?'background:var(--danger)':''}"></div></div>
            <div style="display:flex;justify-content:space-between;margin-top:6px" class="meta">
              <span>${s.pct}% capacity used</span>
              <span>${s.expired} expired &nbsp;
                ${s.expired ? `<form method="POST" action="${prefix}/retention/purge-expired" style="display:inline">
                  <input type="hidden" name="table" value="${esc(s.table)}">
                  <button class="btn btn-danger btn-sm" onclick="return confirm('Purge ${s.expired} expired records?')">Purge Expired</button>
                </form>` : ''}
              </span>
            </div>
          </div>`).join('')}
      </div>`;
    res.send(renderPage('Retention', body, req.session?.user));
  }));

  // ─── Purge Expired (Retention action) ────────────────────────
  app.post(`${prefix}/retention/purge-expired`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), tbl = req.body.table;
    if (!tbl) return res.status(400).send('Table name required');
    const { rowCount } = await pool.query(
      `DELETE FROM "${tbl}" WHERE tenant_id=$1 AND expires_at < NOW()`, [tid]);
    await pool.query(
      'INSERT INTO data_retention_log (tenant_id, table_name, records_purged, policy_rule) VALUES ($1,$2,$3,$4)',
      [tid, tbl, rowCount, 'expired_records_auto_purge']);
    audit('purge_expired', { table: tbl, purged: rowCount }, req);
    res.redirect(`${prefix}/retention?msg=purged`);
  }));

  // ─── Storage Summary API ─────────────────────────────────────
  app.get(`${prefix}/api/storage-summary`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [rbC, arC, bpC, rlC, expC] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM data_recycle_bin WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_archives WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_backup_points WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_retention_log WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS n FROM data_recycle_bin WHERE tenant_id=$1 AND expires_at < NOW()`, [tid])
    ]);
    res.json({
      recycleBin: rbC.rows[0].n,
      archives: arC.rows[0].n,
      backupPoints: bpC.rows[0].n,
      retentionLogs: rlC.rows[0].n,
      expiredRecyclable: expC.rows[0].n
    });
  }));

  // ─── Archive Detail View ─────────────────────────────────────
  app.get(`${prefix}/archives/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { rows: [arc] } = await pool.query(
      'SELECT * FROM data_archives WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!arc) return res.status(404).send('Archive not found');
    const data = arc.archived_data || [];
    const isArr = Array.isArray(data);
    const keys = isArr && data.length ? Object.keys(data[0]) : Object.keys(data);
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>📋 Archive #${arc.id}: ${esc(arc.table_name)}</h1>
        <p class="subtitle">${arc.record_count} record${arc.record_count!==1?'s':''} archived by ${esc(arc.archived_by)} on ${arc.archived_at?.toLocaleString?.()||arc.archived_at}</p>
        ${tabs('Archives')}
        <div class="form-row">
          <a href="${prefix}/archives" class="btn btn-outline">← Back to Archives</a>
          <form method="POST" action="${prefix}/archives/${arc.id}/restore" style="display:inline" onsubmit="return confirm('Restore all records to live table?')">
            <button class="btn btn-success">↩ Restore All Records</button></form>
        </div>
        <h2>Archived Data</h2>
        ${isArr && data.length ? `<table>
          <tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr>
          ${data.map(row => `<tr>${keys.map(k => `<td>${esc(String(row[k]??'')).slice(0,50)}</td>`).join('')}</tr>`).join('')}
        </table>` : `<div class="preview" style="max-width:100%;white-space:pre-wrap">${esc(JSON.stringify(data, null, 2))}</div>`}
      </div>`;
    res.send(renderPage('Archive Detail', body, req.session?.user));
  }));

  // ─── Restore Archived Records ────────────────────────────────
  app.post(`${prefix}/archives/:id/restore`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), id = req.params.id;
    const { rows: [arc] } = await pool.query(
      'SELECT * FROM data_archives WHERE id=$1 AND tenant_id=$2', [id, tid]);
    if (!arc) return res.status(404).send('Archive not found');
    const data = arc.archived_data || [];
    const items = Array.isArray(data) ? data : [data];
    let restored = 0;
    for (const row of items) {
      const cols = Object.keys(row).filter(k => k !== 'id');
      if (cols.length) {
        try {
          await pool.query(
            `INSERT INTO "${arc.table_name}" (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${cols.map((_,i)=>`$${i+1}`).join(',')})
             ON CONFLICT DO NOTHING`, cols.map(c => row[c]));
          restored++;
        } catch { /* skip individual failures */ }
      }
    }
    audit('restore_archived_records', { archiveId: id, table: arc.table_name, restored }, req);
    res.redirect(`${prefix}/archives?msg=restored_${restored}`);
  }));

  // ─── Soft-Delete Helper (POST to recycle bin) ────────────────
  app.post(`${prefix}/soft-delete`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), user = who(req);
    const { table_name, record_id } = req.body;
    if (!table_name || !record_id) return res.status(400).send('table_name and record_id required');
    const { rows: [rec] } = await pool.query(
      `SELECT * FROM "${table_name}" WHERE id=$1`, [Number(record_id)]);
    if (!rec) return res.status(404).send('Record not found in source table');
    await pool.query(
      `INSERT INTO data_recycle_bin (tenant_id, table_name, record_id, record_data, deleted_by)
       VALUES ($1,$2,$3,$4,$5)`, [tid, table_name, Number(record_id), JSON.stringify(rec), user]);
    audit('soft_delete', { table: table_name, recordId: record_id }, req);
    res.json({ ok: true, message: 'Record moved to recycle bin', recycleBinId: 'new' });
  }));

  // ─── 14. Global Search ───────────────────────────────────────
  app.get(`${prefix}/search`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), q = req.query.q || '';
    let recycleResults = [], archiveResults = [];
    if (q.trim()) {
      const pattern = `%${q}%`;
      const [rb, ar] = await Promise.all([
        pool.query(
          `SELECT id, table_name, record_id, record_data, deleted_at AS ts, 'recycle' AS source
           FROM data_recycle_bin WHERE tenant_id=$1 AND (record_data::text ILIKE $2 OR table_name ILIKE $2)
           ORDER BY deleted_at DESC LIMIT 50`, [tid, pattern]),
        pool.query(
          `SELECT id, table_name, record_ids, archived_data, archived_at AS ts, 'archive' AS source
           FROM data_archives WHERE tenant_id=$1 AND (archived_data::text ILIKE $2 OR table_name ILIKE $2)
           ORDER BY archived_at DESC LIMIT 50`, [tid, pattern])
      ]);
      recycleResults = rb.rows;
      archiveResults = ar.rows;
    }
    const total = recycleResults.length + archiveResults.length;
    const body = `
      ${CSS}<link rel="stylesheet" href="/css/sk.css">
      <div class="wrap">
        <h1>🔍 Global Search</h1><p class="subtitle">Search across recycle bin and archives</p>
        ${tabs('Dashboard')}
        <form method="GET" class="form-row" style="margin-bottom:20px">
          <input name="q" value="${esc(q)}" placeholder="Search records by content, table name..." style="flex:1;min-width:250px">
          <button class="btn btn-pri" type="submit">🔍 Search</button>
        </form>
        ${q ? `
          <p class="meta" style="margin-bottom:16px">${total} result${total!==1?'s':''} for "<strong>${esc(q)}</strong>"</p>
          ${recycleResults.length ? `<h2>♻️ Recycle Bin (${recycleResults.length})</h2>
            <table><tr><th>ID</th><th>Table</th><th>Record ID</th><th>Preview</th><th>Date</th><th>Actions</th></tr>
            ${recycleResults.map(r => `<tr><td>${r.id}</td><td><span class="badge badge-warn">${esc(r.table_name)}</span></td>
              <td>${r.record_id||'—'}</td><td><div class="preview">${esc(JSON.stringify(r.record_data||{}).slice(0,50))}…</div></td>
              <td class="meta">${r.ts?.toLocaleString?.()||r.ts}</td>
              <td><form method="POST" action="${prefix}/recycle-bin/${r.id}/restore" style="display:inline">
                <button class="btn btn-success btn-sm">↩ Restore</button></form></td></tr>`).join('')}
            </table>` : ''}
          ${archiveResults.length ? `<h2>🗄️ Archives (${archiveResults.length})</h2>
            <table><tr><th>ID</th><th>Table</th><th>Records</th><th>Preview</th><th>Date</th></tr>
            ${archiveResults.map(r => `<tr><td>${r.id}</td><td><span class="badge badge-info">${esc(r.table_name)}</span></td>
              <td>${r.record_ids ? JSON.parse(r.record_ids).length : 0}</td>
              <td><div class="preview">${esc(JSON.stringify(r.archived_data||{}).slice(0,50))}…</div></td>
              <td class="meta">${r.ts?.toLocaleString?.()||r.ts}</td></tr>`).join('')}
            </table>` : ''}
          ${!total ? '<div class="empty-state"><div class="icon">🔍</div><p>No results found</p></div>' : ''}
        ` : '<div class="empty-state"><div class="icon">🔍</div><p>Enter a search query to find records</p></div>'}
      </div>`;
    res.send(renderPage('Search', body, req.session?.user));
  }));
};
