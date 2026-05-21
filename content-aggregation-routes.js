/**
 * Content Aggregation (iPaaS) — Auto-publish tenant data to public hub
 * Comfort Zone SaaS Platform
 */
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ── DB Migration ── */
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_sources (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        source_type VARCHAR(50) NOT NULL DEFAULT 'rss',
        name VARCHAR(255) NOT NULL,
        config JSONB DEFAULT '{}',
        sync_interval INTEGER DEFAULT 3600,
        last_sync TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cs_tenant ON content_sources(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_cs_status ON content_sources(tenant_id, status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_sync_queue (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        source_id INTEGER REFERENCES content_sources(id) ON DELETE CASCADE,
        item_type VARCHAR(50) NOT NULL,
        item_id VARCHAR(255) NOT NULL,
        action VARCHAR(20) DEFAULT 'sync',
        status VARCHAR(20) DEFAULT 'pending',
        error_msg TEXT,
        retried INTEGER DEFAULT 0,
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_csq_tenant ON content_sync_queue(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_csq_status ON content_sync_queue(tenant_id, status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_sync_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        source_id INTEGER REFERENCES content_sources(id) ON DELETE SET NULL,
        items_synced INTEGER DEFAULT 0,
        items_failed INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        error_msg TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_csl_tenant ON content_sync_log(tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS content_published (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        source_id INTEGER REFERENCES content_sources(id) ON DELETE SET NULL,
        item_type VARCHAR(50) NOT NULL,
        item_id VARCHAR(255) NOT NULL,
        title VARCHAR(500),
        slug VARCHAR(500),
        content TEXT,
        published_at TIMESTAMP,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cp_tenant ON content_published(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_cp_slug ON content_published(tenant_id, slug);
      CREATE INDEX IF NOT EXISTS idx_cp_published ON content_published(tenant_id, published_at);
    `);
  }
  migrate().then(() => console.log('[content-aggregation] migration done')).catch(e => console.error('[content-aggregation] migration error:', e));

  /* ── Helpers ── */
  function dashPage(title, body, req) {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Comfort Zone</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1a1a2e}
.topbar{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:20px;font-weight:600}
.topbar a{color:#ddd;text-decoration:none;font-size:14px}
.container{max-width:1200px;margin:24px auto;padding:0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat-card h3{font-size:13px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.stat-card .val{font-size:28px;font-weight:700;color:#667eea}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
.card h2{font-size:18px;margin-bottom:12px;color:#333}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eee;font-size:14px}
th{background:#f8f9fa;color:#555;font-weight:600;text-transform:uppercase;font-size:12px;letter-spacing:.3px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.badge-active{background:#d4edda;color:#155724}
.badge-pending{background:#fff3cd;color:#856404}
.badge-failed{background:#f8d7da;color:#721c24}
.badge-completed{background:#d1ecf1;color:#0c5460}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:#667eea;color:#fff}.btn-primary:hover{background:#5a6fd6}
.btn-success{background:#28a745;color:#fff}.btn-success:hover{background:#218838}
.btn-danger{background:#dc3545;color:#fff}.btn-danger:hover{background:#c82333}
.btn-sm{padding:5px 12px;font-size:12px}
nav.sub{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
nav.sub a{padding:8px 16px;background:#fff;border-radius:8px;text-decoration:none;color:#333;font-size:14px;font-weight:500;transition:all .2s}
nav.sub a:hover,nav.sub a.active{background:#667eea;color:#fff}
.empty{text-align:center;padding:40px;color:#999}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#444}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px}
</style></head>
<body>
<div class="topbar"><h1>📡 Content Aggregation</h1><a href="/">← Dashboard</a></div>
<div class="container">
<nav class="sub">
<a href="/content-aggregation" class="active">Overview</a>
<a href="/content-aggregation/sources">Sources</a>
<a href="/content-aggregation/sync-queue">Sync Queue</a>
<a href="/content-aggregation/logs">Logs</a>
</nav>
${body}
</div></body></html>`;
    return renderPage('content-aggregation', html, req);
  }

  /* ── GET /content-aggregation ── */
  app.get('/content-aggregation', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [sources] = await pool.query('SELECT COUNT(*) AS c FROM content_sources WHERE tenant_id=?', [tid]);
    const [queue] = await pool.query('SELECT COUNT(*) AS c FROM content_sync_queue WHERE tenant_id=? AND status=?', [tid, 'pending']);
    const [published] = await pool.query('SELECT COUNT(*) AS c FROM content_published WHERE tenant_id=?', [tid]);
    const [recent] = await pool.query('SELECT * FROM content_sync_log WHERE tenant_id=? ORDER BY created_at DESC LIMIT 5', [tid]);
    const [latest] = await pool.query('SELECT id,title,item_type,published_at FROM content_published WHERE tenant_id=? ORDER BY published_at DESC LIMIT 8', [tid]);

    res.send(dashPage('Content Aggregation Dashboard', `
<div class="stats">
  <div class="stat-card"><h3>Content Sources</h3><div class="val">${sources[0].c}</div></div>
  <div class="stat-card"><h3>Pending Queue</h3><div class="val">${queue[0].c}</div></div>
  <div class="stat-card"><h3>Published Items</h3><div class="val">${published[0].c}</div></div>
</div>
<div style="display:flex;gap:12px;margin-bottom:24px">
  <a href="/content-aggregation/sync" class="btn btn-success">🔄 Trigger Sync</a>
  <a href="/content-aggregation/sources" class="btn btn-primary">➕ Add Source</a>
</div>
<div class="card"><h2>Recent Sync Activity</h2>
<table><thead><tr><th>ID</th><th>Items Synced</th><th>Failed</th><th>Duration</th><th>Time</th></tr></thead><tbody>
${recent.length ? recent.map(r => `<tr><td>#${r.id}</td><td>${r.items_synced}</td><td>${r.items_failed}</td><td>${r.duration_ms}ms</td><td>${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No sync activity yet</td></tr>'}
</tbody></table></div>
<div class="card"><h2>Latest Published Content</h2>
<table><thead><tr><th>Title</th><th>Type</th><th>Published</th></tr></thead><tbody>
${latest.length ? latest.map(r => `<tr><td>${esc(r.title||'Untitled')}</td><td>${esc(r.item_type)}</td><td>${r.published_at ? new Date(r.published_at).toLocaleString() : '—'}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">No published content</td></tr>'}
</tbody></table></div>`, req));
  }));

  /* ── GET /content-aggregation/sync-queue ── */
  app.get('/content-aggregation/sync-queue', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [items] = await pool.query(
      `SELECT q.*, s.name AS source_name FROM content_sync_queue q LEFT JOIN content_sources s ON q.source_id = s.id WHERE q.tenant_id=? ORDER BY q.created_at DESC LIMIT 100`, [tid]);
    const html = `
<div class="card"><h2>Sync Queue (${items.length})</h2>
<table><thead><tr><th>ID</th><th>Source</th><th>Type</th><th>Item ID</th><th>Action</th><th>Status</th><th>Retries</th><th>Created</th></tr></thead><tbody>
${items.length ? items.map(q => `<tr>
<td>#${q.id}</td><td>${esc(q.source_name||'—')}</td><td>${esc(q.item_type)}</td><td>${esc(q.item_id)}</td>
<td>${esc(q.action)}</td>
<td><span class="badge badge-${q.status === 'completed' ? 'completed' : q.status === 'failed' ? 'failed' : 'pending'}">${esc(q.status)}</span></td>
<td>${q.retried}</td><td>${new Date(q.created_at).toLocaleString()}</td>
</tr>`).join('') : '<tr><td colspan="8" class="empty">Queue is empty</td></tr>'}
</tbody></table></div>`;
    res.send(dashPage('Sync Queue', html, req));
  }));

  /* ── POST /content-aggregation/sync ── */
  app.post('/content-aggregation/sync', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [sources] = await pool.query('SELECT id, name FROM content_sources WHERE tenant_id=? AND status=?', [tid, 'active']);
    if (!sources.length) return res.redirect('/content-aggregation?msg=No+active+sources');

    const startTime = Date.now();
    let totalSynced = 0, totalFailed = 0;

    for (const src of sources) {
      try {
        // Enqueue items for sync
        await pool.query(
          `INSERT INTO content_sync_queue (tenant_id, source_id, item_type, item_id, action, status) VALUES (?,?, 'content', ?, 'sync', 'pending')`,
          [tid, src.id, 'src_' + src.id + '_' + Date.now()]);
        totalSynced++;
      } catch (err) {
        totalFailed++;
      }
    }

    const duration = Date.now() - startTime;
    await pool.query(
      `INSERT INTO content_sync_log (tenant_id, source_id, items_synced, items_failed, duration_ms) VALUES (?, NULL, ?, ?, ?)`,
      [tid, totalSynced, totalFailed, duration]);

    audit({ actor: req.session.user.id, action: 'content-aggregation:sync', tid, meta: { synced: totalSynced, failed: totalFailed } });
    res.redirect('/content-aggregation?msg=Sync+triggered+' + totalSynced + '+items');
  }));

  /* ── GET /content-aggregation/sources ── */
  app.get('/content-aggregation/sources', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [sources] = await pool.query('SELECT * FROM content_sources WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <h2 style="font-size:18px;color:#333">Content Sources</h2>
  <a href="#" onclick="document.getElementById('add-form').style.display=document.getElementById('add-form').style.display==='none'?'block':'none';return false" class="btn btn-primary">➕ Add Source</a>
</div>
<div id="add-form" class="card" style="display:none;margin-bottom:16px">
  <h2>Add Content Source</h2>
  <form method="POST" action="/content-aggregation/sources">
    <div class="form-group"><label>Name</label><input name="name" required placeholder="e.g., Company Blog RSS"></div>
    <div class="form-group"><label>Source Type</label>
      <select name="source_type"><option value="rss">RSS Feed</option><option value="api">REST API</option><option value="webhook">Webhook</option><option value="csv">CSV Import</option><option value="database">Database</option></select>
    </div>
    <div class="form-group"><label>Config (JSON)</label><textarea name="config" rows="3" placeholder='{"url":"https://example.com/feed.xml"}'></textarea></div>
    <div class="form-group"><label>Sync Interval (seconds)</label><input name="sync_interval" type="number" value="3600"></div>
    <button type="submit" class="btn btn-success">Create Source</button>
  </form>
</div>
<div class="card">
<table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Interval</th><th>Last Sync</th><th>Status</th><th>Actions</th></tr></thead><tbody>
${sources.length ? sources.map(s => `<tr>
<td>#${s.id}</td><td>${esc(s.name)}</td><td>${esc(s.source_type)}</td><td>${s.sync_interval}s</td>
<td>${s.last_sync ? new Date(s.last_sync).toLocaleString() : 'Never'}</td>
<td><span class="badge badge-${s.status === 'active' ? 'active' : 'failed'}">${esc(s.status)}</span></td>
<td>
  <button onclick="editSource(${s.id},${JSON.stringify(s.name)},'${s.source_type}','${esc(s.sync_interval)}',${JSON.stringify(s.config || '{}')})" class="btn btn-sm btn-primary">Edit</button>
  <form method="POST" action="/content-aggregation/sources/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete this source?')">
    <button class="btn btn-sm btn-danger">Delete</button>
  </form>
</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No content sources configured</td></tr>'}
</tbody></table></div>
<script>
function editSource(id,name,type,interval,config){
  document.getElementById('add-form').style.display='block';
  document.querySelector('#add-form h2').textContent='Edit Source #'+id;
  const form=document.querySelector('#add-form form');
  form.action='/content-aggregation/sources/'+id;
  form.querySelector('[name=name]').value=name;
  form.querySelector('[name=source_type]').value=type;
  form.querySelector('[name=sync_interval]').value=interval;
  form.querySelector('[name=config]').value=typeof config==='string'?config:JSON.stringify(config,null,2);
}
</script>`;
    res.send(dashPage('Content Sources', html, req));
  }));

  /* ── POST /content-aggregation/sources ── */
  app.post('/content-aggregation/sources', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let config = {};
    try { config = JSON.parse(req.body.config || '{}'); } catch (e) { /* ignore */ }
    await pool.query(
      `INSERT INTO content_sources (tenant_id, source_type, name, config, sync_interval) VALUES (?, ?, ?, ?, ?)`,
      [tid, req.body.source_type || 'rss', req.body.name, JSON.stringify(config), parseInt(req.body.sync_interval) || 3600]);
    audit({ actor: req.session.user.id, action: 'content-aggregation:source-create', tid, meta: { name: req.body.name } });
    res.redirect('/content-aggregation/sources?msg=Source+created');
  }));

  /* ── PUT /content-aggregation/sources/:id ── */
  app.put('/content-aggregation/sources/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let config = {};
    try { config = JSON.parse(req.body.config || '{}'); } catch (e) { /* ignore */ }
    const [result] = await pool.query(
      `UPDATE content_sources SET name=?, source_type=?, config=?, sync_interval=? WHERE id=? AND tenant_id=?`,
      [req.body.name, req.body.source_type || 'rss', JSON.stringify(config), parseInt(req.body.sync_interval) || 3600, req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  /* Support POST-based edit from form (no PUT support in HTML forms) */
  app.post('/content-aggregation/sources/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let config = {};
    try { config = JSON.parse(req.body.config || '{}'); } catch (e) { /* ignore */ }
    await pool.query(
      `UPDATE content_sources SET name=?, source_type=?, config=?, sync_interval=? WHERE id=? AND tenant_id=?`,
      [req.body.name, req.body.source_type || 'rss', JSON.stringify(config), parseInt(req.body.sync_interval) || 3600, req.params.id, tid]);
    audit({ actor: req.session.user.id, action: 'content-aggregation:source-update', tid, meta: { id: req.params.id } });
    res.redirect('/content-aggregation/sources?msg=Source+updated');
  }));

  /* ── DELETE /content-aggregation/sources/:id ── */
  app.delete('/content-aggregation/sources/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [result] = await pool.query('DELETE FROM content_sources WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  app.post('/content-aggregation/sources/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('DELETE FROM content_sources WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ actor: req.session.user.id, action: 'content-aggregation:source-delete', tid, meta: { id: req.params.id } });
    res.redirect('/content-aggregation/sources?msg=Source+deleted');
  }));

  /* ── GET /content-aggregation/logs ── */
  app.get('/content-aggregation/logs', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const [logs] = await pool.query(
      `SELECT l.*, s.name AS source_name FROM content_sync_log l LEFT JOIN content_sources s ON l.source_id = s.id WHERE l.tenant_id=? ORDER BY l.created_at DESC LIMIT ? OFFSET ?`, [tid, limit, offset]);
    const [total] = await pool.query('SELECT COUNT(*) AS c FROM content_sync_log WHERE tenant_id=?', [tid]);
    const totalPages = Math.ceil(total[0].c / limit);
    const html = `
<div class="card"><h2>Sync Logs</h2>
<table><thead><tr><th>ID</th><th>Source</th><th>Synced</th><th>Failed</th><th>Duration</th><th>Error</th><th>Time</th></tr></thead><tbody>
${logs.length ? logs.map(l => `<tr>
<td>#${l.id}</td><td>${esc(l.source_name||'Manual')}</td><td>${l.items_synced}</td><td>${l.items_failed}</td><td>${l.duration_ms}ms</td>
<td>${l.error_msg ? esc(l.error_msg.substring(0, 80)) : '—'}</td>
<td>${new Date(l.created_at).toLocaleString()}</td>
</tr>`).join('') : '<tr><td colspan="7" class="empty">No logs yet</td></tr>'}
</tbody></table>
${totalPages > 1 ? `<div style="text-align:center;margin-top:12px">
${page > 1 ? `<a href="?page=${page-1}" class="btn btn-sm btn-primary">← Prev</a>` : ''}
<span style="margin:0 12px;color:#666">Page ${page} of ${totalPages}</span>
${page < totalPages ? `<a href="?page=${page+1}" class="btn btn-sm btn-primary">Next →</a>` : ''}
</div>` : ''}
</div>`;
    res.send(dashPage('Sync Logs', html, req));
  }));

  /* ── GET /content-aggregation/stats ── */
  app.get('/content-aggregation/stats', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [srcCount] = await pool.query('SELECT source_type, COUNT(*) AS c FROM content_sources WHERE tenant_id=? GROUP BY source_type', [tid]);
    const [queueStats] = await pool.query('SELECT status, COUNT(*) AS c FROM content_sync_queue WHERE tenant_id=? GROUP BY status', [tid]);
    const [dailySync] = await pool.query(
      `SELECT DATE(created_at) AS day, SUM(items_synced) AS synced, SUM(items_failed) AS failed, COUNT(*) AS runs
       FROM content_sync_log WHERE tenant_id=? AND created_at > NOW() - INTERVAL 30 DAY GROUP BY DATE(created_at) ORDER BY day DESC`, [tid]);
    const [pubByType] = await pool.query('SELECT item_type, COUNT(*) AS c FROM content_published WHERE tenant_id=? GROUP BY item_type', [tid]);
    res.json({
      sources: Object.fromEntries(srcCount.map(s => [s.source_type, s.c])),
      queue: Object.fromEntries(queueStats.map(q => [q.status, q.c])),
      dailySync,
      publishedByType: Object.fromEntries(pubByType.map(p => [p.item_type, p.c]))
    });
  }));

  /* ── POST /content-aggregation/webhook/:provider ── */
  app.post('/content-aggregation/webhook/:provider', ah(async (req, res) => {
    const provider = req.params.provider;
    const payload = req.body;

    // Find active webhook source for this provider
    const [sources] = await pool.query(
      'SELECT id, tenant_id FROM content_sources WHERE source_type=? AND status=?', ['webhook', 'active']);

    if (sources.length === 0) {
      return res.json({ received: true, processed: 0, message: 'No active webhook sources' });
    }

    let processed = 0;
    for (const src of sources) {
      try {
        const item_type = provider;
        const item_id = payload.id || payload.event_id || ('wh_' + Date.now());
        const title = payload.title || payload.name || payload.subject || '';
        const content = payload.content || payload.body || payload.description || '';

        // Add to queue
        await pool.query(
          `INSERT INTO content_sync_queue (tenant_id, source_id, item_type, item_id, action, status) VALUES (?,?,?,?,'publish','pending')`,
          [src.tenant_id, src.id, item_type, String(item_id)]);

        // Publish immediately for real-time webhooks
        await pool.query(
          `INSERT INTO content_published (tenant_id, source_id, item_type, item_id, title, content, published_at) VALUES (?,?,?,?,?,?,NOW())`,
          [src.tenant_id, src.id, item_type, String(item_id), title.substring(0, 500), content]);

        processed++;
      } catch (err) {
        // Continue processing other sources
      }
    }

    res.json({ received: true, provider, processed, timestamp: new Date().toISOString() });
  }));

  // ── Summary ──
  console.log('[content-aggregation] 4 tables, 10 routes registered');
};
