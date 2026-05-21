/**
 * Developer Portal — API keys, webhooks, sandbox
 * Comfort Zone SaaS Platform
 */
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const crypto = require('crypto');

  /* ── DB Migration ── */
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dev_api_keys (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(12) NOT NULL,
        permissions TEXT[] DEFAULT '{}',
        last_used TIMESTAMP,
        expires_at TIMESTAMP,
        revoked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dak_tenant ON dev_api_keys(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_dak_prefix ON dev_api_keys(tenant_id, key_prefix);
      CREATE INDEX IF NOT EXISTS idx_dak_hash ON dev_api_keys(key_hash);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dev_webhooks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        url VARCHAR(2048) NOT NULL,
        events TEXT[] DEFAULT '{}',
        secret VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        last_delivery TIMESTAMP,
        failure_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dw_tenant ON dev_webhooks(tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dev_webhook_deliveries (
        id SERIAL PRIMARY KEY,
        webhook_id INTEGER REFERENCES dev_webhooks(id) ON DELETE CASCADE,
        event VARCHAR(100) NOT NULL,
        payload JSONB DEFAULT '{}',
        status_code INTEGER,
        response_body TEXT,
        duration_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dwd_webhook ON dev_webhook_deliveries(webhook_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dev_api_usage (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        api_key_id INTEGER,
        endpoint VARCHAR(500) NOT NULL,
        method VARCHAR(10) NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_dau_tenant ON dev_api_usage(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_dau_key ON dev_api_usage(tenant_id, api_key_id);
      CREATE INDEX IF NOT EXISTS idx_dau_created ON dev_api_usage(tenant_id, created_at);
    `);
  }
  migrate().then(() => console.log('[dev-portal] migration done')).catch(e => console.error('[dev-portal] migration error:', e));

  /* ── Helpers ── */
  function generateApiKey() {
    const raw = 'cz_' + crypto.randomBytes(24).toString('hex');
    const prefix = raw.substring(0, 12);
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return { raw, prefix, hash };
  }

  function generateWebhookSecret() {
    return 'whsec_' + crypto.randomBytes(24).toString('hex');
  }

  function devPage(title, body, req) {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Comfort Zone Dev Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,monospace;background:#0d1117;color:#c9d1d9}
.topbar{background:#161b22;border-bottom:1px solid #30363d;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:20px;font-weight:600;color:#58a6ff}
.topbar a{color:#8b949e;text-decoration:none;font-size:14px}
.container{max-width:1200px;margin:24px auto;padding:0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px}
.stat-card h3{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.stat-card .val{font-size:28px;font-weight:700;color:#58a6ff}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;margin-bottom:16px}
.card h2{font-size:18px;margin-bottom:12px;color:#c9d1d9}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #21262d;font-size:14px}
th{color:#8b949e;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.3px}
code,.code{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:13px;background:#0d1117;padding:2px 6px;border-radius:4px;color:#79c0ff}
pre.code-block{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:16px;overflow-x:auto;font-size:13px;line-height:1.6;color:#c9d1d9;margin:12px 0}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:1px solid #30363d;transition:all .2s;color:#c9d1d9;background:#21262d}
.btn:hover{background:#30363d}
.btn-primary{background:#238636;border-color:#238636;color:#fff}.btn-primary:hover{background:#2ea043}
.btn-danger{background:#da3633;border-color:#da3633;color:#fff}.btn-danger:hover{background:#f85149}
.btn-sm{padding:5px 12px;font-size:12px}
nav.sub{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
nav.sub a{padding:8px 16px;background:#161b22;border:1px solid #30363d;border-radius:8px;text-decoration:none;color:#8b949e;font-size:14px;font-weight:500;transition:all .2s}
nav.sub a:hover,nav.sub a.active{background:#1f6feb;color:#fff;border-color:#1f6feb}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#8b949e}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;font-size:14px;color:#c9d1d9}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.badge-active{background:#1b4332;color:#40c057}
.badge-inactive{background:#3d1f1f;color:#ff6b6b}
.empty{text-align:center;padding:40px;color:#484f58}
.key-display{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin:8px 0}
.key-display code{flex:1;word-break:break-all}
</style></head>
<body>
<div class="topbar"><h1>⚡ Developer Portal</h1><a href="/">← Dashboard</a></div>
<div class="container">
<nav class="sub">
<a href="/dev-portal" class="active">Overview</a>
<a href="/dev-portal/api-keys">API Keys</a>
<a href="/dev-portal/webhooks">Webhooks</a>
<a href="/dev-portal/sandbox">Sandbox</a>
<a href="/dev-portal/docs">Docs</a>
<a href="/dev-portal/usage">Usage</a>
</nav>
${body}
</div></body></html>`;
    return renderPage('dev-portal', html, req);
  }

  /* ── GET /dev-portal ── */
  app.get('/dev-portal', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [keys] = await pool.query('SELECT COUNT(*) AS c FROM dev_api_keys WHERE tenant_id=? AND revoked=FALSE', [tid]);
    const [hooks] = await pool.query('SELECT COUNT(*) AS c FROM dev_webhooks WHERE tenant_id=? AND is_active=TRUE', [tid]);
    const [usage] = await pool.query('SELECT COUNT(*) AS c, AVG(response_time_ms) AS avg_rt FROM dev_api_usage WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)', [tid]);
    const [recent] = await pool.query(
      'SELECT endpoint, method, status_code, response_time_ms, created_at FROM dev_api_usage WHERE tenant_id=? ORDER BY created_at DESC LIMIT 10', [tid]);

    res.send(devPage('Developer Portal', `
<div class="stats">
  <div class="stat-card"><h3>Active API Keys</h3><div class="val">${keys[0].c}</div></div>
  <div class="stat-card"><h3>Active Webhooks</h3><div class="val">${hooks[0].c}</div></div>
  <div class="stat-card"><h3>Requests (24h)</h3><div class="val">${fmtNum(usage[0].c)}</div></div>
  <div class="stat-card"><h3>Avg Response</h3><div class="val">${Math.round(usage[0].avg_rt || 0)}ms</div></div>
</div>
<div class="card"><h2>Recent API Calls</h2>
<table><thead><tr><th>Method</th><th>Endpoint</th><th>Status</th><th>Time</th><th>When</th></tr></thead><tbody>
${recent.map(r => `<tr><td><code>${esc(r.method)}</code></td><td><code>${esc(r.endpoint)}</code></td><td>${r.status_code || '—'}</td><td>${r.response_time_ms}ms</td><td>${new Date(r.created_at).toLocaleString()}</td></tr>`).join('')}
${recent.length === 0 ? '<tr><td colspan="5" class="empty">No API calls yet</td></tr>' : ''}
</tbody></table></div>`, req));
  }));

  function fmtNum(n) { return (n || 0).toLocaleString(); }

  /* ── GET /dev-portal/api-keys ── */
  app.get('/dev-portal/api-keys', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [keys] = await pool.query('SELECT * FROM dev_api_keys WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <h2 style="color:#c9d1d9">API Keys</h2>
  <button onclick="document.getElementById('addKey').style.display='block'" class="btn btn-primary">+ Create Key</button>
</div>
<div id="addKey" class="card" style="display:none;margin-bottom:16px">
  <h2>Create API Key</h2>
  <form method="POST" action="/dev-portal/api-keys">
    <div class="form-group"><label>Key Name</label><input name="name" required placeholder="e.g., Production API"></div>
    <div class="form-group"><label>Permissions (comma separated)</label><input name="permissions" value="read,write" placeholder="read,write,admin"></div>
    <div class="form-group"><label>Expires (days, blank = never)</label><input name="expires_days" type="number" placeholder="365"></div>
    <button type="submit" class="btn btn-primary">Generate Key</button>
  </form>
</div>
<div id="newKeyDisplay" class="card" style="display:none;margin-bottom:16px;border-color:#238636">
  <h2 style="color:#40c057">🔑 New API Key — Save This Now!</h2>
  <p style="color:#8b949e;margin-bottom:8px">This key will not be shown again.</p>
  <div class="key-display"><code id="newKeyValue"></code><button class="btn btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('newKeyValue').textContent)">Copy</button></div>
</div>
<div class="card"><table><thead><tr><th>Name</th><th>Prefix</th><th>Permissions</th><th>Last Used</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead><tbody>
${keys.map(k => `<tr>
<td>${esc(k.name)}</td><td><code>${esc(k.key_prefix)}...</code></td>
<td>${(Array.isArray(k.permissions) ? k.permissions : (typeof k.permissions === 'string' ? k.permissions.replace('{','').replace('}','').split(',') : [])).map(p => `<span class="badge" style="background:#1f2937;color:#58a6ff;margin-right:4px">${esc(p.trim())}</span>`).join('')}</td>
<td>${k.last_used ? new Date(k.last_used).toLocaleDateString() : 'Never'}</td>
<td>${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</td>
<td><span class="badge ${k.revoked ? 'badge-inactive' : 'badge-active'}">${k.revoked ? 'Revoked' : 'Active'}</span></td>
<td>${!k.revoked ? `<form method="POST" action="/dev-portal/api-keys/${k.id}/revoke" style="display:inline" onsubmit="return confirm('Revoke this key?')">
  <button class="btn btn-sm btn-danger">Revoke</button></form>` : '—'}</td>
</tr>`).join('')}
${keys.length === 0 ? '<tr><td colspan="7" class="empty">No API keys yet</td></tr>' : ''}
</tbody></table></div>`;
    res.send(devPage('API Keys', html, req));
  }));

  /* ── POST /dev-portal/api-keys ── */
  app.post('/dev-portal/api-keys', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { raw, prefix, hash } = generateApiKey();
    const permissions = (req.body.permissions || 'read').split(',').map(p => p.trim()).filter(Boolean);
    let expiresAt = null;
    if (req.body.expires_days) {
      expiresAt = new Date(Date.now() + parseInt(req.body.expires_days) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    }
    await pool.query(
      'INSERT INTO dev_api_keys (tenant_id, name, key_hash, key_prefix, permissions, expires_at) VALUES (?,?,?,?,?,?)',
      [tid, req.body.name, hash, prefix, permissions, expiresAt]);
    audit({ actor: req.session.user.id, action: 'dev-portal:key-create', tid, meta: { name: req.body.name, prefix } });
    // Show key on redirect — we store temporarily in a cookie-less approach using query param
    res.redirect('/dev-portal/api-keys?new_key=' + encodeURIComponent(raw) + '&created=1');
  }));

  /* ── DELETE /dev-portal/api-keys/:id ── */
  app.delete('/dev-portal/api-keys/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [result] = await pool.query('UPDATE dev_api_keys SET revoked=TRUE WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  app.post('/dev-portal/api-keys/:id/revoke', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('UPDATE dev_api_keys SET revoked=TRUE WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ actor: req.session.user.id, action: 'dev-portal:key-revoke', tid, meta: { id: req.params.id } });
    res.redirect('/dev-portal/api-keys?msg=Key+revoked');
  }));

  /* ── GET /dev-portal/webhooks ── */
  app.get('/dev-portal/webhooks', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [hooks] = await pool.query('SELECT * FROM dev_webhooks WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <h2 style="color:#c9d1d9">Webhooks</h2>
  <button onclick="document.getElementById('addHook').style.display='block'" class="btn btn-primary">+ Create Webhook</button>
</div>
<div id="addHook" class="card" style="display:none;margin-bottom:16px">
  <h2>Create Webhook</h2>
  <form method="POST" action="/dev-portal/webhooks">
    <div class="form-group"><label>Name</label><input name="name" required placeholder="e.g., Slack Notifications"></div>
    <div class="form-group"><label>URL</label><input name="url" required placeholder="https://example.com/webhook"></div>
    <div class="form-group"><label>Events (comma separated)</label><input name="events" value="*"></div>
    <button type="submit" class="btn btn-primary">Create</button>
  </form>
</div>
<div class="card"><table><thead><tr><th>Name</th><th>URL</th><th>Events</th><th>Status</th><th>Failures</th><th>Last Delivery</th><th>Actions</th></tr></thead><tbody>
${hooks.map(h => {
  const events = Array.isArray(h.events) ? h.events : (typeof h.events === 'string' ? h.events.replace('{','').replace('}','').split(',') : []);
  return `<tr>
<td>${esc(h.name)}</td><td><code>${esc((h.url||'').substring(0, 50))}${(h.url||'').length > 50 ? '...' : ''}</code></td>
<td>${events.map(e => `<span class="badge" style="background:#1f2937;color:#79c0ff;margin-right:4px">${esc(e.trim())}</span>`).join('')}</td>
<td><span class="badge ${h.is_active ? 'badge-active' : 'badge-inactive'}">${h.is_active ? 'Active' : 'Inactive'}</span></td>
<td>${h.failure_count}</td>
<td>${h.last_delivery ? new Date(h.last_delivery).toLocaleString() : 'Never'}</td>
<td>
  <button onclick="editHook(${h.id},${JSON.stringify(h.name)},${JSON.stringify(h.url)},${JSON.stringify(events.join(','))})" class="btn btn-sm">Edit</button>
  <form method="POST" action="/dev-portal/webhooks/${h.id}/delete" style="display:inline" onsubmit="return confirm('Delete webhook?')">
    <button class="btn btn-sm btn-danger">Delete</button></form>
</td></tr>`;}).join('')}
${hooks.length === 0 ? '<tr><td colspan="7" class="empty">No webhooks configured</td></tr>' : ''}
</tbody></table></div>
<script>
function editHook(id,name,url,events){
  document.getElementById('addHook').style.display='block';
  const f=document.querySelector('#addHook form');
  f.querySelector('[name=name]').value=name;
  f.querySelector('[name=url]').value=url;
  f.querySelector('[name=events]').value=events;
  f.action='/dev-portal/webhooks/'+id;
}
</script>`;
    res.send(devPage('Webhooks', html, req));
  }));

  /* ── POST /dev-portal/webhooks ── */
  app.post('/dev-portal/webhooks', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const events = (req.body.events || '*').split(',').map(e => e.trim()).filter(Boolean);
    const secret = generateWebhookSecret();
    await pool.query(
      'INSERT INTO dev_webhooks (tenant_id, name, url, events, secret) VALUES (?,?,?,?,?)',
      [tid, req.body.name, req.body.url, events, secret]);
    audit({ actor: req.session.user.id, action: 'dev-portal:webhook-create', tid, meta: { name: req.body.name } });
    res.redirect('/dev-portal/webhooks?msg=Webhook+created&secret=' + encodeURIComponent(secret));
  }));

  /* ── PUT /dev-portal/webhooks/:id ── */
  app.put('/dev-portal/webhooks/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const events = (req.body.events || '*').split(',').map(e => e.trim()).filter(Boolean);
    const [result] = await pool.query(
      'UPDATE dev_webhooks SET name=?, url=?, events=?, is_active=? WHERE id=? AND tenant_id=?',
      [req.body.name, req.body.url, events, req.body.is_active !== 'false', req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  // POST fallback for HTML forms
  app.post('/dev-portal/webhooks/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const events = (req.body.events || '*').split(',').map(e => e.trim()).filter(Boolean);
    await pool.query(
      'UPDATE dev_webhooks SET name=?, url=?, events=? WHERE id=? AND tenant_id=?',
      [req.body.name, req.body.url, events, req.params.id, tid]);
    res.redirect('/dev-portal/webhooks?msg=Webhook+updated');
  }));

  /* ── DELETE /dev-portal/webhooks/:id ── */
  app.delete('/dev-portal/webhooks/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [result] = await pool.query('DELETE FROM dev_webhooks WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  app.post('/dev-portal/webhooks/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query('DELETE FROM dev_webhooks WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    res.redirect('/dev-portal/webhooks?msg=Webhook+deleted');
  }));

  /* ── GET /dev-portal/webhooks/logs ── */
  app.get('/dev-portal/webhooks/logs', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [logs] = await pool.query(
      `SELECT d.*, w.name AS webhook_name FROM dev_webhook_deliveries d
       JOIN dev_webhooks w ON d.webhook_id = w.id WHERE w.tenant_id=? ORDER BY d.created_at DESC LIMIT 100`, [tid]);
    const html = `<div class="card"><h2>Webhook Delivery Logs</h2>
<table><thead><tr><th>Webhook</th><th>Event</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead><tbody>
${logs.map(l => `<tr><td>${esc(l.webhook_name)}</td><td><code>${esc(l.event)}</code></td>
<td><span class="badge ${l.status_code && l.status_code < 400 ? 'badge-active' : 'badge-inactive'}">${l.status_code || 'N/A'}</span></td>
<td>${l.duration_ms}ms</td><td>${new Date(l.created_at).toLocaleString()}</td></tr>`).join('')}
${logs.length === 0 ? '<tr><td colspan="5" class="empty">No delivery logs</td></tr>' : ''}
</tbody></table></div>`;
    res.send(devPage('Webhook Logs', html, req));
  }));

  /* ── GET /dev-portal/sandbox ── */
  app.get('/dev-portal/sandbox', requireAuth, ah(async (req, res) => {
    const html = `
<div class="card"><h2>API Sandbox</h2>
<p style="color:#8b949e;margin-bottom:16px">Test API endpoints directly from your browser.</p>
<div class="form-group"><label>Method</label>
<select id="sbMethod" style="width:120px;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#c9d1d9;font-size:14px">
<option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
</select></div>
<div class="form-group"><label>Endpoint</label><input id="sbUrl" value="/api/v1/users" placeholder="/api/v1/..."></div>
<div class="form-group"><label>Headers (JSON)</label><textarea id="sbHeaders" rows="2">{}</textarea></div>
<div class="form-group"><label>Body (JSON, for POST/PUT)</label><textarea id="sbBody" rows="4">{}</textarea></div>
<button onclick="runSandbox()" class="btn btn-primary">Send Request</button>
</div>
<div class="card"><h2>Response</h2>
<pre class="code-block" id="sbResponse">Click "Send Request" to see the response here.</pre>
</div>
<script>
async function runSandbox(){
  const method=document.getElementById('sbMethod').value;
  const url=document.getElementById('sbUrl').value;
  let headers={};try{headers=JSON.parse(document.getElementById('sbHeaders').value)}catch(e){}
  let body=null;if(method!=='GET'&&method!=='DELETE'){try{body=document.getElementById('sbBody').value;if(body.trim()&&!headers['Content-Type'])headers['Content-Type']='application/json'}catch(e){}}
  const start=performance.now();
  try{
    const opts={method,headers};if(body)opts.body=body;
    const r=await fetch(url,opts);
    const dur=Math.round(performance.now()-start);
    const text=await r.text();
    let pretty=text;try{pretty=JSON.stringify(JSON.parse(text),null,2)}catch(e){}
    document.getElementById('sbResponse').textContent=r.status+' '+r.statusText+' ('+dur+'ms)\\n\\n'+pretty;
  }catch(e){
    document.getElementById('sbResponse').textContent='Error: '+e.message;
  }
}
</script>`;
    res.send(devPage('API Sandbox', html, req));
  }));

  /* ── GET /dev-portal/docs ── */
  app.get('/dev-portal/docs', requireAuth, ah(async (req, res) => {
    const html = `
<div class="card"><h2>API Documentation</h2>
<h3 style="color:#58a6ff;margin:16px 0 8px">Authentication</h3>
<p style="color:#8b949e;margin-bottom:12px">Include your API key in the <code>Authorization</code> header:</p>
<pre class="code-block">Authorization: Bearer cz_your_api_key_here</pre>

<h3 style="color:#58a6ff;margin:16px 0 8px">Base URL</h3>
<pre class="code-block">${esc(req.protocol + '://' + req.get('host'))}/api/v1</pre>

<h3 style="color:#58a6ff;margin:16px 0 8px">Endpoints</h3>
<table><thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead><tbody>
<tr><td><code>GET</code></td><td>/api/v1/users</td><td>List users</td></tr>
<tr><td><code>POST</code></td><td>/api/v1/users</td><td>Create user</td></tr>
<tr><td><code>GET</code></td><td>/api/v1/users/:id</td><td>Get user</td></tr>
<tr><td><code>PUT</code></td><td>/api/v1/users/:id</td><td>Update user</td></tr>
<tr><td><code>DELETE</code></td><td>/api/v1/users/:id</td><td>Delete user</td></tr>
<tr><td><code>GET</code></td><td>/api/v1/analytics</td><td>Get analytics</td></tr>
<tr><td><code>POST</code></td><td>/api/v1/events</td><td>Track event</td></tr>
<tr><td><code>GET</code></td><td>/api/v1/content</td><td>List content</td></tr>
<tr><td><code>POST</code></td><td>/api/v1/content</td><td>Create content</td></tr>
</tbody></table>

<h3 style="color:#58a6ff;margin:16px 0 8px">Rate Limits</h3>
<p style="color:#8b949e">1000 requests/minute per API key. Headers: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code></p>

<h3 style="color:#58a6ff;margin:16px 0 8px">Webhook Events</h3>
<table><thead><tr><th>Event</th><th>Description</th></tr></thead><tbody>
<tr><td><code>user.created</code></td><td>New user registered</td></tr>
<tr><td><code>user.updated</code></td><td>User profile updated</td></tr>
<tr><td><code>content.published</code></td><td>Content published</td></tr>
<tr><td><code>donation.received</code></td><td>New donation received</td></tr>
<tr><td><code>*.error</code></td><td>Error occurred</td></tr>
</tbody></table>
</div>`;
    res.send(devPage('API Documentation', html, req));
  }));

  /* ── GET /dev-portal/usage ── */
  app.get('/dev-portal/usage', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [dailyUsage] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS requests, AVG(response_time_ms) AS avg_rt,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
       FROM dev_api_usage WHERE tenant_id=? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
       GROUP BY DATE(created_at) ORDER BY day`, [tid]);
    const [topEndpoints] = await pool.query(
      'SELECT endpoint, method, COUNT(*) AS hits, AVG(response_time_ms) AS avg_rt FROM dev_api_usage WHERE tenant_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY endpoint, method ORDER BY hits DESC LIMIT 10', [tid]);
    const maxReq = dailyUsage.reduce((m, d) => Math.max(m, d.requests), 1);

    const html = `
<div class="card"><h2>API Usage (14 days)</h2>
<div class="chart-bar" style="height:180px;align-items:end;display:flex;gap:6px">${dailyUsage.map(d => {
  const h = Math.max(4, (d.requests / maxReq) * 160);
  return `<div style="flex:1;background:linear-gradient(to top,#1f6feb,#58a6ff);border-radius:4px 4px 0 0;height:${h}px;min-width:20px;position:relative">
    <span style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;color:#c9d1d9">${d.requests}</span>
    <span style="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#484f58;white-space:nowrap">${d.day ? new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</span>
  </div>`;
}).join('')}</div></div>
<div class="card"><h2>Top Endpoints (7d)</h2>
<table><thead><tr><th>Method</th><th>Endpoint</th><th>Requests</th><th>Avg Response</th></tr></thead><tbody>
${topEndpoints.map(e => `<tr><td><code>${esc(e.method)}</code></td><td><code>${esc(e.endpoint)}</code></td><td><strong>${e.hits}</strong></td><td>${Math.round(e.avg_rt)}ms</td></tr>`).join('')}
${topEndpoints.length === 0 ? '<tr><td colspan="4" class="empty">No usage data</td></tr>' : ''}
</tbody></table></div>`;
    res.send(devPage('API Usage', html, req));
  }));

  console.log('[dev-portal] 4 tables, 12 routes registered');
};
